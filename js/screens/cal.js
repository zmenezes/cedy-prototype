/* =========================================================================
   Cedy: tela do agente de calibração (E.ia.cal).
   - /super/calibracao: indicadores monitorados, pedidos abertos, histórico,
     reversão e as famílias protegidas (sem agente). Só o Superadmin age.
   - aba "Calibração" em /ops/comunicacao: o mesmo relatório, só leitura, para o
     líder da Mesa. Prefixo CSS: cal-.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session } = C.store;
  const E = C.engine; const K = E.com; const CAL = E.ia.cal; const UI = C.comUI;
  const me = () => session.user();
  const ehSuper = (u) => !!u && u.perfil === 'superadmin';
  const nomeUser = (id) => { const u = db.get('users', id); return u ? u.nome : id; };

  const ESTADO = {
    em_pedido: ['Pedido aberto', 'blue', 'A recomendação já virou solicitação e aguarda aprovação.'],
    recomendar: ['Recomendação pronta', 'violet', 'Vira pedido no próximo ciclo semanal.'],
    aguarda_cadencia: ['Aguarda o limite semanal', 'amber', 'O limite de pedidos novos por semana foi atingido.'],
    recusado_sem_dado_novo: ['Recusado, aguarda dado novo', 'neutral', 'Um pedido igual foi recusado. Só volta com dado novo (amostra 20% maior ou valor diferente).'],
    sem_mudanca: ['Sem mudança', 'green', 'O indicador não pede mudança.'],
    amostra_insuficiente: ['Amostra insuficiente', 'neutral', 'Sem amostra mínima o agente não abre pedido.'],
  };
  const REC = { pedido: ['Aguardando aprovação', 'blue'], agendada: ['Agendada', 'amber'], aplicada: ['Aplicada', 'green'], rejeitada: ['Rejeitada', 'red'], revertida: ['Revertida', 'neutral'] };
  const stBadge = (s) => { const m = ESTADO[s] || [s, 'neutral']; return m[1] === 'violet' ? ui.ai(m[0]) : ui.badge(m[0], m[1], { dot: true }); };
  const recBadge = (r) => { const m = REC[r.status] || [r.status, 'neutral']; return ui.badge(m[0] + (r.status === 'agendada' && r.vigenteEm ? ' · ' + fmt.date(r.vigenteEm) : ''), m[1], { dot: true }); };
  const fv = (a, v) => (v === null || v === undefined ? '—' : CAL.fmtVal(a.param || a, v));

  /* ------------------------------ detalhe ------------------------------ */
  function detalheItem(a, podeAgir) {
    const rec = a.rec || (db.where('recomendacoes', (r) => r.paramId === a.id).sort((x, y) => y.criadaEm - x.criadaEm)[0]);
    const ap = rec && rec.aprovacaoId && db.get('aprovacoes', rec.aprovacaoId);
    const ass = ap ? (ap.assinaturas || []) : [];
    const corpo = h('div.stack',
      ui.kv([['Família', CAL.FAMILIAS[a.familia]], ['Valor atual', fv(a, a.atual)], ['Valor recomendado', a.sugerido !== null && a.sugerido !== undefined ? fv(a, a.sugerido) : '—'], ['Amostra', `${a.n} de ${a.amostraMin} necessárias (${a.periodo})`], ['Situação', stBadge(a.estado)], a.economico ? ['Tipo', ui.badge('Econômico: dois Superadmins', 'amber', { icon: 'lock' })] : null].filter(Boolean)),
      ui.callout({ tone: 'info', text: (ESTADO[a.estado] || [])[2] }),
      a.evidencia && a.evidencia.length ? ui.card({ title: 'Evidência' }, h('ul.cal-ev', a.evidencia.map((x) => h('li', x)))) : null,
      a.efeito && a.sugerido !== null && a.sugerido !== undefined ? ui.card({ title: 'Efeito esperado' }, h('p', a.efeito), a.economico ? h('p.small.muted', 'Vale a partir da próxima competência, no mínimo 15 dias depois da aprovação. Os afetados recebem um comunicado antes de a regra entrar em vigor. Nunca é retroativa nem muda operação em andamento.') : h('p.small.muted', 'Vale a partir do próximo dia útil.')) : null,
      ap ? ui.card({ title: 'Solicitação ' + ap.id }, ui.kv([['Situação', { pendente: 'Pendente de aprovação', aprovada: 'Aprovada', rejeitada: 'Rejeitada', expirada: 'Expirada' }[ap.status] || ap.status], ['Aberta por', 'Agente de calibração'], a.economico ? ['Assinaturas', `${ass.length} de 2${ass.length ? ': ' + ass.map((x) => nomeUser(x.userId)).join(', ') : ''}`] : null, ap.motivoDecisao ? ['Decisão', ap.motivoDecisao] : null].filter(Boolean)), ap.status === 'pendente' && podeAgir ? ui.btn('Decidir em Aprovações', { variant: 'secondary', icon: 'stamp', route: '/super/aprovacoes' }) : null) : null);
    ui.drawer({ title: a.rotulo, subtitle: CAL.FAMILIAS[a.familia], icon: 'sliders-horizontal', size: 'lg', body: corpo,
      footer: (api) => [rec && ['agendada', 'aplicada'].includes(rec.status) && podeAgir ? ui.btn('Reverter', { variant: 'danger', icon: 'rotate-ccw', onclick: () => reverter(rec, api) }) : null, ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() })].filter(Boolean) });
  }
  async function reverter(rec, api) {
    const ok = await ui.confirm({ title: 'Reverter esta calibração?', text: `${rec.rotulo} volta para ${CAL.fmtVal(rec, rec.atual)}. ${rec.status === 'agendada' ? 'A mudança ainda não entrou em vigor; o agendamento é cancelado.' : 'A mudança já estava em vigor.'} Fica na trilha com o seu nome.`, tone: 'danger', confirmLabel: 'Reverter' });
    if (!ok) return;
    const r = CAL.reverter(rec.id, me().id);
    if (!r.ok) { ui.toast('Não foi possível reverter', { type: 'error', text: r.erro }); return; }
    ui.toast('Calibração revertida', { type: 'success', text: rec.rotulo }); if (api) api.close();
  }

  /* ------------------------------ painel (superadmin e líder) ------------------------------ */
  function painel(podeAgir) {
    let fam = new Set();
    const host = h('div.stack');
    const draw = () => {
      const ana = CAL.analisar(); const cfg = CAL.cfg(); const recs = db.all('recomendacoes').sort((a, b) => b.criadaEm - a.criadaEm);
      const semana = recs.filter((r) => r.criadaEm >= C.clock.now() - 7 * 86400e3).length;
      const dec = recs.filter((r) => ['aplicada', 'agendada', 'revertida', 'rejeitada'].includes(r.status)); const aceitas = dec.filter((r) => r.status !== 'rejeitada').length;
      const rows = ana.filter((a) => !fam.size || fam.has(a.familia));
      const chips = ui.chips({ aria: 'Família', value: [...fam], options: Object.entries(CAL.FAMILIAS).map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { fam = new Set(v); draw(); } });
      C.mount(host,
        ui.callout({ tone: 'ai', icon: 'sparkles', title: 'O agente mede e recomenda; pessoas decidem', text: 'Cada pedido traz métrica, período, amostra, antes e depois e efeito esperado. Sem amostra mínima ele não abre pedido, mantém no máximo um pedido por parâmetro e só reabre um pedido recusado com dado novo. Parâmetros econômicos exigem dois Superadmins, valem só a partir de uma data futura e avisam os afetados. O agente nunca altera um parâmetro.' }),
        h('div.cal-kpis',
          ui.kpi({ icon: 'hourglass', label: 'Pedidos aguardando', display: String(recs.filter((r) => r.status === 'pedido').length), hint: 'na fila de aprovações' }),
          ui.kpi({ icon: 'calendar', label: 'Agendadas ou aplicadas', display: String(recs.filter((r) => ['agendada', 'aplicada'].includes(r.status)).length), hint: 'mudanças aprovadas' }),
          ui.kpi({ icon: 'check-check', label: 'Aceitação das recomendações', display: dec.length ? fmt.pct((aceitas / dec.length) * 100, 0) : '—', hint: `${aceitas} de ${dec.length} decididas` }),
          ui.kpi({ icon: 'timer', label: 'Pedidos nesta semana', display: `${semana} de ${cfg.maxPedidosSemana}`, hint: cfg.ultimoCicloEm ? 'último ciclo ' + fmt.rel(cfg.ultimoCicloEm) : 'sem ciclo ainda' })),
        ui.card({ title: 'Indicadores monitorados', subtitle: 'Cada linha é um parâmetro que o agente acompanha. Clique para ver a evidência.' }, chips,
          ui.table({ rows, rowKey: (a) => a.id, onRowClick: (a) => detalheItem(a, podeAgir), pageSize: 12, empty: ui.empty({ icon: 'sliders-horizontal', title: 'Nenhum parâmetro nesta família' }),
            columns: [
              { key: 'p', label: 'Parâmetro', mobile: 'primary', render: (a) => h('div.cell-main', h('strong', a.rotulo), h('small', CAL.FAMILIAS[a.familia], a.economico ? ' · econômico' : '')) },
              { key: 'a', label: 'Atual', align: 'right', render: (a) => h('span.num', fv(a, a.atual)) },
              { key: 's', label: 'Recomendado', align: 'right', mobile: 'hide', render: (a) => h('span.num', fv(a, a.sugerido)) },
              { key: 'n', label: 'Amostra', align: 'right', mobile: 'hide', render: (a) => h('span.num', `${a.n} / ${a.amostraMin}`) },
              { key: 'e', label: 'Situação', render: (a) => stBadge(a.estado) },
            ] })),
        ui.card({ title: 'Histórico de recomendações', subtitle: 'Mais recentes primeiro' },
          ui.table({ rows: recs, rowKey: (r) => r.id, pageSize: 8, empty: ui.empty({ icon: 'history', title: 'Nenhuma recomendação ainda', text: 'O primeiro ciclo semanal abre os pedidos elegíveis.' }),
            columns: [
              { key: 'p', label: 'Parâmetro', mobile: 'primary', render: (r) => h('div.cell-main', h('strong', r.rotulo), h('small', `${CAL.fmtVal(r, r.atual)} para ${CAL.fmtVal(r, r.sugerido)} · ${fmt.date(r.criadaEm)}`)) },
              { key: 's', label: 'Situação', render: (r) => recBadge(r) },
              { key: 'x', label: '', render: (r) => (podeAgir && ['agendada', 'aplicada'].includes(r.status) ? ui.btn('Reverter', { size: 'sm', variant: 'ghost', icon: 'rotate-ccw', onclick: (e) => { e.stopPropagation(); reverter(r); } }) : null) },
            ] })),
        ui.card({ title: 'Sem agente: só pessoas decidem', subtitle: 'Estas áreas protegem a plataforma e os clientes. O agente não monitora nem recomenda mudança nelas.' },
          h('div.cal-prot', CAL.PROTEGIDAS.map((p) => h('div.cal-prot-i', icon('lock', 16), h('div', h('strong', p.rotulo), h('small', p.itens)))))));
    };
    return ui.live(['recomendacoes', 'aprovacoes', 'config'], () => { draw(); return host; });
  }

  function simularCiclo() {
    if (!ehSuper(me())) return;
    const r = CAL.executarCiclo();
    ui.toast('Ciclo semanal executado', { type: 'success', text: `${r.abertos.length} pedido(s) aberto(s)${r.bloqueados.length ? `, ${r.bloqueados.length} aguardando o limite semanal` : ''}.` });
  }

  function pgCalibracao() {
    const u = me(); const agir = ehSuper(u);
    const ag = db.get('agentes', CAL.AGENTE) || {};
    return h('div.sh-page.cal-page',
      ui.pageHeader({ eyebrow: 'Superadmin · Plataforma', title: 'Calibração de parâmetros', subtitle: 'O agente de calibração mede os indicadores e recomenda mudanças. Aprovação em Aprovações.',
        actions: [agir ? ui.btn('Executar o ciclo semanal', { variant: 'secondary', icon: 'refresh-cw', onclick: simularCiclo, title: 'Demonstração: o ciclo roda sozinho a cada 7 dias de relógio' }) : null, ui.btn('Aprovações', { variant: 'ghost', icon: 'stamp', route: '/super/aprovacoes' })].filter(Boolean) }),
      ag.nivel === 'inativo' ? ui.callout({ tone: 'warn', title: 'Agentes pausados', text: 'O interruptor geral de agentes está desligado: não há ciclo nem pedido novo até a retomada.' }) : null,
      painel(agir));
  }
  C.router.register({ path: '/super/calibracao', roles: ['ops'], perfis: ['superadmin'], title: 'Calibração de parâmetros', render: pgCalibracao });

  /* aba na central da Mesa: só leitura, para o líder */
  const veAba = (x) => !!x && K.isCedy(x) && (x.perfil === 'admin' || x.perfil === 'superadmin');
  UI.opsTabs.push({ id: 'calibracao', label: 'Calibração', icon: 'sliders-horizontal', ordem: 45, visivel: veAba, contagem: () => db.where('recomendacoes', (r) => r.status === 'pedido').length || undefined,
    render: () => h('div.stack', ui.callout({ tone: 'info', text: 'Relatório do agente de calibração. Quem aprova é o Superadmin; aqui você acompanha o que está sendo recomendado.' }), painel(false)) });
})();
