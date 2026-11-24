/* =========================================================================
   Cedy ops3: aprovação em dois passos (quatro olhos) na Mesa + página
   /ops/solicitacoes. Prefixo CSS: op3-. Clássico, sem módulos.
   Depende de ops.js (C.ops) e do motor (E.solicitarAprovacao).
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session, ledger } = C.store;
  const E = C.engine;
  const Ops = C.ops;
  const now = () => C.clock.now();
  const meId = () => (session.get() || {}).userId || 'u-ops-1';
  const me = () => E.actors.user(meId());
  const userName = (id) => { const u = id && db.get('users', id); return u ? u.nome : '—'; };

  /* ------------------------- antes/depois ------------------------- */
  const disp = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'ligado' : 'desligado';
    if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; }
    return String(v);
  };
  /** Linhas de diff entre dois objetos simples {rótulo: valor exibível}. */
  Ops.diffRows = function (antes, depois) {
    const a = antes || {}; const d = depois || {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(d)])];
    return keys.map((k) => ({ k, a: disp(a[k]), d: disp(d[k]), mudou: JSON.stringify(a[k]) !== JSON.stringify(d[k]) }));
  };
  Ops.diffTable = function (antes, depois) {
    const rows = Ops.diffRows(antes, depois);
    if (!rows.length) return h('p.muted.small', 'Sem antes e depois registrados para esta solicitação.');
    return ui.table({ rows, rowKey: (r) => r.k,
      columns: [
        { key: 'k', label: 'Parâmetro', mobile: 'primary', render: (r) => h('strong', r.k) },
        { key: 'a', label: 'Antes', render: (r) => h('span', { class: r.mudou && 'strong' }, r.a) },
        { key: 'd', label: 'Depois', render: (r) => h('span', { class: r.mudou && 'strong' }, r.d) },
        { key: 'm', label: '', render: (r) => (r.mudou ? ui.badge('Mudou', 'amber', { dot: true }) : h('small.muted', 'igual')) },
      ] });
  };

  /* ------------------------- quatro olhos ------------------------- */
  /**
   * Quatro olhos para mudanças críticas. Quem tem ops.config.aplicar
   * (Superadmin) aplica direto com confirmação e R3 na trilha; os demais
   * abrem 'Solicitar alteração' (motivo obrigatório) via E.solicitarAprovacao
   * e acompanham em /ops/solicitacoes.
   * o: {tipo, titulo, resumo, payload, antes, depois, entidade,
   *     acaoDireto, resumoDireto, aplicar(motivo), motivoFixo, notaMercado}
   */
  Ops.solicitarOuAplicar = async function (o) {
    const tipoInfo = (E.APROVACAO_TIPOS || {})[o.tipo] || { label: o.tipo, classe: 'R2' };
    if (C.can('ops.config.aplicar')) {
      const m = Ops.modal({ title: 'Aplicar diretamente', subtitle: o.titulo + ' · Superadmin', icon: 'stamp', tone: 'violet', size: 'md',
        body: h('div.stack.tight',
          ui.callout({ tone: 'info', title: 'Aplicado direto (Superadmin)', text: 'Entra na hora e na trilha como R3, com antes e depois. Quem não é Superadmin passa pela fila de aprovação.' }),
          Ops.diffTable(o.antes, o.depois),
          o.notaMercado ? h('p.small.muted', o.notaMercado) : null),
        footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Aplicar agora', { variant: 'primary', icon: 'stamp', onclick: () => { api.close(true); } })] });
      const okc = await m.promise;
      if (!okc) return { ok: false, erro: 'cancelado' };
      o.aplicar('aplicação direta');
      ledger.append({ actor: me(), acao: o.acaoDireto, entidade: o.entidade || { kind: 'aprovacao', id: '-' }, resumo: o.resumoDireto, classe: 'R3', snapshot: { antes: o.antes || null, depois: o.depois || null } });
      ui.toast('Aplicado direto (Superadmin)', { type: 'success', text: o.resumoDireto });
      return { ok: true, direto: true };
    }
    let motivo = null;
    const campo = ui.field({ label: 'Motivo da solicitação', required: true, hint: 'Mínimo de 10 caracteres: o Superadmin decide com este contexto.' }, (motivo = ui.input({ type: 'textarea', value: o.motivoFixo || '', placeholder: 'Ex.: a meta SELIC subiu e a precificação precisa acompanhar para preservar o spread' })));
    const m = Ops.modal({ title: 'Solicitar alteração', subtitle: o.titulo, icon: 'stamp', size: 'md',
      body: h('div.stack.tight',
        ui.callout({ tone: 'info', title: 'Vai ao Superadmin (quatro olhos)', text: 'Quem pediu não aprova a própria solicitação. Acompanhe em Minhas solicitações.' }),
        Ops.diffTable(o.antes, o.depois),
        o.notaMercado ? h('p.small.muted', o.notaMercado) : null,
        campo),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Enviar solicitação', { variant: 'primary', icon: 'send', onclick: () => {
        const t = String(motivo.value).trim();
        if (t.length < 10) { campo.setError('Escreva ao menos 10 caracteres.'); return; }
        api.close(t);
      } })] });
    const mot = await m.promise;
    if (!mot) return { ok: false, erro: 'cancelado' };
    const r = E.solicitarAprovacao({ tipo: o.tipo, titulo: o.titulo, resumo: o.resumo, payload: o.payload, antes: o.antes || null, depois: o.depois || null, userId: meId(), motivo: mot });
    if (!r.ok) { ui.toast('Não foi possível solicitar', { type: 'error', text: r.erro }); return r; }
    ui.toast('Solicitação enviada ao Superadmin', { type: 'success', text: `Pedido ${r.aprovacao.id}: acompanhe em Minhas solicitações.`, link: '/ops/solicitacoes' });
    return r;
  };

  /* ------------------------- /ops/solicitacoes ------------------------- */
  const TIPO_LABEL = () => E.APROVACAO_TIPOS || {};
  const tipoLabel = (t) => (TIPO_LABEL()[t] || {}).label || t;

  function pgSolicitacoes(ctx) {
    const uid = meId();
    const mine = () => db.where('aprovacoes', (a) => a.solicitanteId === uid).sort((a, b) => (b.status === 'pendente') - (a.status === 'pendente') || b.solicitadoEm - a.solicitadoEm);
    const corpo = h('div');
    const draw = () => C.mount(corpo, solicitacoesBody(mine()));
    ctx.onCleanup(db.on('aprovacoes', () => { if (corpo.isConnected) draw(); }));
    draw();
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · quatro olhos', title: 'Minhas solicitações', subtitle: 'Pedidos de alteração que você enviou ao Superadmin: parâmetro, programa, autonomia, pagamento e isenção.', actions: C.can('ops.config.aplicar') ? [ui.btn('Fila de aprovações', { variant: 'secondary', icon: 'stamp', route: '/super/aprovacoes' })] : [] }),
      C.can('ops.config.aplicar') ? ui.callout({ tone: 'info', title: 'Você é Superadmin', text: 'Suas solicitações aparecem aqui; as de toda a Mesa estão na fila de aprovações.', actions: [ui.btn('Abrir aprovações', { size: 'sm', route: '/super/aprovacoes' })] }) : null,
      corpo);
  }

  function solicitacoesBody(rows) {
    const pend = rows.filter((a) => a.status === 'pendente');
    const apr = rows.filter((a) => a.status === 'aprovada');
    const rej = rows.filter((a) => a.status === 'rejeitada');
    const kpis = h('div.op3-kpis',
      ui.kpi({ icon: 'clock', tone: 'amber', label: 'Pendentes', display: fmt.num(pend.length), hint: pend.length ? 'aguardando o Superadmin' : 'nada na fila' }),
      ui.kpi({ icon: 'circle-check', tone: 'green', label: 'Aprovadas', display: fmt.num(apr.length), hint: 'efeito aplicado' }),
      ui.kpi({ icon: 'x', tone: 'red', label: 'Rejeitadas', display: fmt.num(rej.length), hint: rej.length ? 'ver o motivo na lista' : 'nenhuma rejeição' }));
    if (!rows.length) {
      return h('div.stack', kpis, ui.empty({ icon: 'stamp', title: 'Nenhuma solicitação ainda',
        text: 'Quando você propõe uma mudança crítica (um parâmetro da plataforma, uma versão de programa, a autonomia de um agente, o pagamento de uma premiação ou uma isenção de fatura), o pedido aparece aqui até o Superadmin decidir.',
        action: ui.btn('Ver programas de produto', { route: '/ops/programas' }) }));
    }
    return h('div.stack', kpis,
      ui.table({ rows, rowKey: (r) => r.id,
        columns: [
          { key: 't', label: 'Solicitação', mobile: 'primary', render: (a) => h('div.cell-main', h('strong', a.titulo), h('small', h('span.mono', a.id), ' · ', tipoLabel(a.tipo), ' · ', ui.badge(a.classe, a.classe === 'R3' ? 'red' : 'amber'))) },
          { key: 's', label: 'Situação', render: (a) => h('div.op3-status', ui.status('proposta', a.status), a.status === 'pendente' ? ui.countdown(a.expiraEm, { prefix: 'expira em', endLabel: 'expirada' }) : null) },
          { key: 'p', label: 'Pedida em', mobile: 'hide', render: (a) => h('span.small.nowrap', fmt.rel(a.solicitadoEm), h('br'), fmt.date(a.solicitadoEm)) },
          { key: 'd', label: 'Decisão', mobile: 'hide', render: (a) => (a.status === 'pendente' ? h('small.muted', 'aguardando o Superadmin') : h('div.cell-main', h('small', `${a.status === 'aprovada' ? 'Aprovada' : a.status === 'rejeitada' ? 'Rejeitada' : a.status === 'cancelada' ? 'Cancelada' : 'Expirada'} por ${userName(a.decididoPor)}`), a.decididoEm ? h('small.muted', fmt.rel(a.decididoEm)) : null)) },
        ], onRowClick: (a) => solicitacaoDrawer(a) }));
  }

  function solicitacaoDrawer(a) {
    const decidida = a.status !== 'pendente';
    const corpo = h('div.stack',
      h('div.row', ui.badge(a.id, 'neutral', { icon: 'stamp' }), ui.badge(tipoLabel(a.tipo), 'blue'), ui.badge('Classe ' + a.classe, a.classe === 'R3' ? 'red' : 'amber'), ui.status('proposta', a.status)),
      a.status === 'pendente' ? ui.countdown(a.expiraEm, { prefix: 'Expira em', endLabel: 'Prazo esgotado' }) : null,
      a.resumo ? h('p', a.resumo) : null,
      ui.card({ title: 'Motivo do pedido' }, h('p', a.motivo || '—'), h('small.muted', `Pedido por ${userName(a.solicitanteId)} ${fmt.rel(a.solicitadoEm)} (${fmt.datetime(a.solicitadoEm)}).`)),
      ui.card({ title: 'Antes e depois' }, Ops.diffTable(a.antes, a.depois)),
      decidida ? ui.card({ title: 'Decisão' }, ui.kv([[a.status === 'aprovada' ? 'Aprovada por' : a.status === 'rejeitada' ? 'Rejeitada por' : 'Encerrada', userName(a.decididoPor)], ['Quando', a.decididoEm ? fmt.datetime(a.decididoEm) + ' (' + fmt.rel(a.decididoEm) + ')' : '—'], ['Motivo', a.motivoDecisao || '—']])) : null);
    Ops.drawer({ title: a.titulo, subtitle: 'Solicitação ' + a.id, icon: 'stamp', size: 'lg', body: corpo,
      footer: (api) => [a.status === 'pendente' ? ui.btn('Cancelar solicitação', { variant: 'danger', icon: 'x', onclick: async () => {
        const okc = await ui.confirm({ title: 'Cancelar a solicitação ' + a.id + '?', icon: 'x', tone: 'danger', text: 'O Superadmin não vai mais decidir sobre este pedido. O efeito proposto não é aplicado.', confirmLabel: 'Cancelar solicitação' });
        if (!okc) return;
        db.patch('aprovacoes', a.id, { status: 'cancelada', decididoPor: meId(), decididoEm: now(), motivoDecisao: 'Cancelada por quem solicitou.' });
        ledger.append({ actor: me(), acao: 'aprovacao.cancelada', entidade: { kind: 'aprovacao', id: a.id }, resumo: `Solicitação ${a.id} cancelada por ${userName(meId())}: ${a.titulo}`, classe: a.classe || 'R2' });
        ui.toast('Solicitação cancelada', { type: 'info', text: a.id });
        api.close();
      } }) : null, ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() })] });
  }

  C.router.register([
    { path: '/ops/solicitacoes', roles: ['ops'], title: 'Minhas solicitações', render: pgSolicitacoes },
  ]);
})();
