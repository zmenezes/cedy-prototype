/* =========================================================================
   Cedy ops2: governança da Mesa (agentes, trilha, empresas, faturamento,
   programas, plataforma). Perfis: Juliana Prado (admin), Thiago (operador).
   Prefixo CSS: op2-. Clássico, sem módulos. Depende de ops.js (C.ops).
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui; const F = C.flows;
  const { db, session, ledger, notify } = C.store; const E = C.engine; const Ops = C.ops;

  const { isAdmin, podeOperar, needAdmin, needOperar } = Ops;
  const needMesa = () => needOperar() && needAdmin();
  const need = (perm) => Ops.need(perm);
  const permBtn = (perm) => Ops.permBtn(perm);
  const me = () => E.actors.user(session.get().userId);
  const orgName = (id) => { const o = db.get('orgs', id); return o ? (o.fantasia || o.nome) : id; };
  const now = () => C.clock.now();
  const PERFIL = { admin: 'Admin', operador: 'Operador', leitor: 'Leitor' };
  const perfilBadge = (p) => ui.badge(PERFIL[p] || p, p === 'admin' ? 'blue' : p === 'operador' ? 'teal' : 'neutral');
  const twofaBadge = (u) => (u.twofa ? ui.badge('Ativo', 'green', { dot: true }) : ui.badge('Inativo', 'amber', { dot: true }));
  const shortId = (id) => (String(id).length > 14 ? String(id).slice(0, 3) + '…' + String(id).slice(-5) : String(id));

  const CLASSE_TONE = { R0: 'neutral', R1: 'teal', R2: 'amber', R3: 'red' };
  const CLASSE_DESC = { R0: 'Leitura, sem efeito', R1: 'Reversível e de baixo impacto', R2: 'Financeiro dentro de envelope de regras', R3: 'Dinheiro e cessão, sempre com pessoa' };
  const classeBadge = (cl) => ui.badge(cl, CLASSE_TONE[cl] || 'neutral', { title: CLASSE_DESC[cl] || cl });
  const NIVEIS = [{ value: 'sombra', label: 'Sombra' }, { value: 'assistido', label: 'Assistido' }, { value: 'autonomo', label: 'Autônomo' }];
  const RANK = { sombra: 0, assistido: 1, autonomo: 2 };
  const nivelLabel = (v) => (NIVEIS.find((n) => n.value === v) || {}).label || v;

  /* Link da entidade da trilha para a tela correspondente. */
  function entidadeLink(ent) {
    if (!ent || !ent.id) return h('span.muted', '—');
    const k = ent.kind; const id = ent.id; const lbl = shortId(id);
    if (k === 'operacao') { const op = db.get('operacoes', id); return op ? h('a', { class: 'mono strong', href: '#/ops/empresas/' + op.cedenteId + '?op=' + id }, id) : h('span.mono', id); }
    if (k === 'org') return h('a', { href: '#/ops/empresas/' + id }, orgName(id));
    if (k === 'lote') return h('a', { class: 'mono', href: '#/ops/mesa/' + id }, id);
    if (k === 'casoMesa') return h('a', { class: 'mono', href: '#/ops/conciliacao/' + id }, lbl);
    if (k === 'titulo') { const t = db.get('titulos', id); return t ? h('a', { href: '#/ops/empresas/' + t.orgId }, t.numero || lbl) : h('span.mono', lbl); }
    if (k === 'extrato') { const caso = db.where('casosMesa', (c) => c.linhaId === id)[0]; return h('a', { class: 'mono', href: '#/ops/conciliacao' + (caso ? '/' + caso.id : '') }, lbl); }
    if (k === 'competencia') return h('a', { href: '#/ops/faturamento?comp=' + id }, fmt.monthLong(id));
    if (k === 'fatura' || k === 'premiacao') return h('a', { class: 'mono', href: '#/ops/faturamento' }, lbl);
    if (k === 'produto' || (k === 'plataforma' && db.get('produtos', id))) return h('a', { href: '#/ops/programas' }, (db.get('produtos', id) || {}).nome || id);
    if (k === 'plataforma' || k === 'config') return h('a', { href: '#/ops/plataforma' }, 'Plataforma');
    if (k === 'agente') return h('a', { href: '#/ops/agentes?tab=agentes' }, (db.get('agentes', id) || {}).nome || id);
    return h('span.muted', k + ' ' + lbl);
  }
  function atorCell(a) {
    const [nome, org] = String(a.nome || a.id).split(' · ');
    return h('span.cell-row.op2-ator', h('span', { class: ['tl-dot', 'tone-' + (F.actorTone(a) || 'neutral')], style: { width: '26px', height: '26px', flex: 'none' } }, icon(F.actorIcon(a), 13)), h('span.cell-main', h('strong', nome), h('small', F.actorLabel(a) + (org ? ' · ' + org : ''))));
  }
  function download(nome, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo || 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  const csvCell = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
  const isoDay = (ts) => { const t = C.cal.sp(ts); return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`; };
  /** cada tela guarda os assinantes de coleção e os solta ao sair */
  function subs(ctx) {
    let offs = [];
    return { on: (topics, fn) => { offs.push(C.store.on(topics, fn)); }, clear: () => { offs.forEach((f) => f()); offs = []; }, bind() { ctx.onCleanup(() => this.clear()); return this; } };
  }

  async function motivoModal(titulo, label, placeholder) {
    let v = null;
    const campo = ui.field({ label, required: true, hint: 'Mínimo de 10 caracteres: o motivo fica registrado na trilha.' }, (v = ui.input({ type: 'textarea', placeholder: placeholder || 'Descreva de forma objetiva' })));
    const m = Ops.modal({ title: titulo, icon: 'message-circle', size: 'sm', body: campo,
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(null) }), ui.btn('Confirmar', { variant: 'primary', onclick: () => { const t = String(v.value).trim(); if (t.length < 10) { campo.setError('Escreva ao menos 10 caracteres.'); return; } api.close(t); } })] });
    return m.promise;
  }

  /* ============================ /ops/agentes ============================ */
  const casoDaProposta = (p) => db.get('casosMesa', p.entidade.id) || db.where('casosMesa', (c) => c.status === 'aberto' && c.tipo === 'parcial')[0] || null;
  const AG_SUGESTAO = {
    aprovar_lote: { abrir: (p) => '/ops/mesa/' + p.entidade.id },
    aprovar_kyc: { abrir: (p) => '/ops/kyc/kyc-' + p.entidade.id },
    pedir_documentos: { abrir: (p) => '/ops/kyc/kyc-' + p.entidade.id },
    reprovar_kyc: { abrir: (p) => '/ops/kyc/kyc-' + p.entidade.id },
    ratear: { abrir: (p) => { const c = casoDaProposta(p); return c ? '/ops/conciliacao/' + c.id : '/ops/conciliacao'; }, dica: 'Classe R3: a decisão final é de uma pessoa na Mesa Conciliadora. Aprovar aqui abre o caso.' },
    ajustar_politica: { abrir: (p) => { const m = /para R\$ (\d+) mil/.exec(p.resumo); return '/ops/programas?editar=' + p.entidade.id + (m ? '&ticketMin=' + Number(m[1]) * 1000 : ''); }, dica: 'Mudança de programa vira nova versão. Aprovar aqui abre o editor com o valor proposto.' },
    regua: { abrir: (p) => '/ops/empresas/' + p.entidade.id, dica: 'Classe R1: o envio é reversível e fica registrado.' },
  };

  function pgAgentes(ctx) {
    let tab = ['caixa', 'agentes', 'shadow'].includes(ctx.query.tab) ? ctx.query.tab : 'caixa';
    const S = subs(ctx).bind();
    const pend = () => db.where('propostas', (p) => p.status === 'pendente').length;
    const body = h('div');
    const tabs = ui.tabs({ value: tab, items: [
      { id: 'caixa', label: 'Caixa de decisões', icon: 'inbox', count: pend() },
      { id: 'agentes', label: 'Agentes', icon: 'sparkles', count: db.all('agentes').length },
      { id: 'shadow', label: 'Sombra e acordo', icon: 'git-compare' },
    ], onChange: (v) => { tab = v; draw(); } });
    function draw() {
      S.clear(); S.on(['propostas'], () => { const c = tabs.querySelector('[data-v=caixa] .tab-count'); if (c) c.textContent = pend(); });
      body.replaceChildren(tab === 'caixa' ? caixaTab(S) : tab === 'agentes' ? agentesTab(S) : shadowTab());
    }
    draw();
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · governança', title: 'Agentes e autonomia', subtitle: 'A IA propõe, o motor decide, uma pessoa garante. Nenhum agente dá lance, aceita oferta ou move dinheiro.', actions: [ui.btn('Ver trilha', { variant: 'secondary', icon: 'scroll-text', route: '/ops/trilha' })] }),
      tabs, body);
  }

  function escadaCard() {
    return ui.card({ title: 'Escada de autonomia e classes de risco', subtitle: 'O teto de cada agente é definido na homologação. Sombra observa, assistido propõe, autônomo só age sozinho em classe R1.' },
      h('div.stack.tight',
        h('ol.op2-ladder',
          [['Sombra', 'Observa e compara, não age. As sugestões ficam registradas para medir o acerto.', 'eye'],
            ['Assistido', 'Propõe com evidências; uma pessoa aprova ou rejeita na caixa de decisões.', 'user'],
            ['Autônomo', 'Age sozinho somente em classe R1. Pausável a qualquer momento.', 'zap']].map((s, i) => h('li.op2-step', h('span.op2-step-n', String(i + 1)), h('span.op2-step-ic', icon(s[2], 18)), h('div', h('strong', s[0]), h('div.small.muted', s[1]))))),
        h('div.row.op2-classes', ['R0', 'R1', 'R2', 'R3'].map((c) => h('span.row', { style: { gap: '6px' } }, classeBadge(c), h('small.muted', { R0: 'leitura', R1: 'reversível', R2: 'envelope de regras', R3: 'sempre pessoa' }[c]))))));
  }

  function nivelSeg(ag) {
    const max = RANK[ag.nivelMaximo] !== undefined ? RANK[ag.nivelMaximo] : 2;
    const semAdmin = !isAdmin();
    return h('div.op2-seg', { role: 'group', 'aria-label': 'Nível de autonomia de ' + ag.nome },
      NIVEIS.map((n) => {
        const acima = RANK[n.value] > max;
        const b = h('button', { type: 'button', class: ['op2-seg-btn', ag.nivel === n.value && 'is-on'], disabled: acima || ag.pausado || semAdmin,
          title: acima ? `Acima do teto deste agente (${nivelLabel(ag.nivelMaximo)}). O teto é definido na homologação.` : semAdmin ? 'Só a Mesa admin propõe e o Superadmin aplica mudanças de autonomia.' : (ag.pausado ? 'Agente pausado' : 'Mudar para ' + n.label),
          onclick: (e) => { e.stopPropagation(); mudarNivel(ag, n.value); }, 'aria-pressed': String(ag.nivel === n.value) }, n.label);
        return b;
      }));
  }

  async function mudarNivel(ag, novo) {
    if (novo === ag.nivel) return;
    if (!needAdmin()) return;
    if (ag.id === 'ag-atendimento' && novo === 'autonomo') { ui.toast('Autonomia por categoria', { type: 'info', text: 'O agente de atendimento só fica autônomo na categoria informativa, com métricas de promoção. Isso é feito em Saúde da comunicação.' }); if (C.store.session.user().perfil === 'superadmin') C.router.go('/super/comunicacao'); return; }
    if (RANK[novo] > (RANK[ag.nivelMaximo] !== undefined ? RANK[ag.nivelMaximo] : 2)) { ui.toast('Acima do teto', { type: 'warn', text: `O teto de ${ag.nome} é ${nivelLabel(ag.nivelMaximo)}.` }); return; }
    const de = ag.nivel;
    await Ops.solicitarOuAplicar({
      tipo: 'autonomia', titulo: `Autonomia de ${ag.nome}: ${nivelLabel(de)} para ${nivelLabel(novo)}`,
      resumo: `Mudar a autonomia de ${ag.nome} de ${nivelLabel(de)} para ${nivelLabel(novo)} (teto: ${nivelLabel(ag.nivelMaximo)}). A mudança vale para as próximas propostas.`,
      payload: { agenteId: ag.id, patch: { nivel: novo } }, antes: { nivel: nivelLabel(de) }, depois: { nivel: nivelLabel(novo) },
      entidade: { kind: 'agente', id: ag.id }, acaoDireto: 'autonomia.aplicado_direto',
      resumoDireto: `${ag.nome}: autonomia aplicada direto de ${nivelLabel(de)} para ${nivelLabel(novo)}`,
      aplicar: (motivo) => {
        db.patch('agentes', ag.id, { nivel: novo });
        ledger.append({ actor: me(), acao: 'agente.autonomia_alterada', entidade: { kind: 'agente', id: ag.id }, resumo: `${ag.nome}: autonomia de ${nivelLabel(de)} para ${nivelLabel(novo)} (${motivo})`, classe: 'R2', detalhe: { de, para: novo, motivo } });
        ui.toast('Autonomia atualizada', { type: 'success', text: `${ag.nome} agora opera em modo ${nivelLabel(novo).toLowerCase()}.` });
      },
    });
  }

  async function pausarAgente(ag) {
    if (!needAdmin()) return;
    const vaiPausar = !ag.pausado;
    const okc = await ui.confirm({ title: vaiPausar ? 'Pausar agente?' : 'Retomar agente?', icon: 'pause', tone: vaiPausar ? 'danger' : 'primary',
      text: vaiPausar ? `${ag.nome} para de propor imediatamente. As propostas pendentes continuam na caixa para decisão humana.` : `${ag.nome} volta a propor no nível ${nivelLabel(ag.nivel).toLowerCase()}.`,
      confirmLabel: vaiPausar ? 'Pausar' : 'Retomar' });
    if (!okc) return;
    await Ops.solicitarOuAplicar({
      tipo: 'autonomia', titulo: `${vaiPausar ? 'Pausar' : 'Retomar'} ${ag.nome}`,
      resumo: vaiPausar ? `${ag.nome} para de propor imediatamente; as pendentes seguem na caixa.` : `${ag.nome} volta a propor no nível ${nivelLabel(ag.nivel).toLowerCase()}.`,
      payload: { agenteId: ag.id, patch: { pausado: vaiPausar } }, antes: { estado: ag.pausado ? 'Pausado' : 'Ativo' }, depois: { estado: vaiPausar ? 'Pausado' : 'Ativo' },
      entidade: { kind: 'agente', id: ag.id }, acaoDireto: 'autonomia.aplicado_direto',
      resumoDireto: `${ag.nome} ${vaiPausar ? 'pausado' : 'retomado'} com aplicação direta`,
      aplicar: (motivo) => {
        db.patch('agentes', ag.id, { pausado: vaiPausar });
        ledger.append({ actor: me(), acao: vaiPausar ? 'agente.pausado' : 'agente.retomado', entidade: { kind: 'agente', id: ag.id }, resumo: `${ag.nome} ${vaiPausar ? 'pausado' : 'retomado'} pela Mesa (${motivo})`, classe: 'R2', detalhe: { motivo } });
        ui.toast(vaiPausar ? 'Agente pausado' : 'Agente retomado', { type: vaiPausar ? 'warn' : 'success', text: ag.nome });
      },
    });
  }

  function agentesTab(S) {
    const box = h('div');
    const draw = () => C.mount(box, ui.table({ rows: db.all('agentes'), rowKey: (r) => r.id,
      columns: [
        { key: 'nome', label: 'Agente', mobile: 'primary', render: (a) => h('div.cell-row', h('span.tl-dot.tone-violet', { style: { width: '30px', height: '30px', flex: 'none' } }, icon('sparkles', 15)), h('div.cell-main', h('strong', a.nome, a.pausado ? ' ' : null, a.pausado ? ui.badge('Pausado', 'red') : null), h('small.mono', 'agente:' + a.id))) },
        { key: 'nivel', label: 'Nível atual', mobile: 'show', render: (a) => nivelSeg(a) },
        { key: 'classe', label: 'Classe', render: (a) => classeBadge(a.classe) },
        { key: 'exec', label: 'Execuções (30 d)', align: 'right', mobile: 'hide', render: (a) => h('span.num', fmt.num(a.metricas.execucoes30d)) },
        { key: 'aceit', label: 'Aceitação', align: 'right', mobile: 'hide', render: (a) => a.metricas.aceitas ? h('span.num', fmt.pct(a.metricas.aceitas * 100, 0)) : h('span.muted.nowrap', 'em sombra') },
        { key: 'tempo', label: 'Tempo médio', align: 'right', mobile: 'hide', render: (a) => h('span.nowrap', a.metricas.tempoMedio) },
        { key: 'ac', label: '', render: (a) => { const sem = !isAdmin(); return ui.btn(a.pausado ? 'Retomar' : 'Pausar', { variant: 'ghost', size: 'sm', disabled: sem, title: sem ? 'Só a Mesa admin propõe e o Superadmin aplica mudanças de autonomia.' : null, onclick: (e) => { e.stopPropagation(); pausarAgente(a); } }); } },
      ], onRowClick: (a) => agenteDrawer(a) }));
    draw(); S.on(['agentes'], () => { if (box.isConnected) draw(); });
    return h('div.stack', escadaCard(), box);
  }

  function agenteDrawer(ag) {
    const props = db.where('propostas', (p) => p.agenteId === ag.id).sort((a, b) => b.ts - a.ts);
    const ap = props.filter((p) => p.status === 'aprovada' || p.status === 'auto').length;
    const rej = props.filter((p) => p.status === 'rejeitada').length;
    const led = ledger.all().filter((e) => e.actor && e.actor.tipo === 'agente' && e.actor.id === ag.id).slice(-8).reverse();
    const corpo = h('div.stack',
      ui.callout({ tone: 'ai', title: 'Identidade do agente', text: ag.escopo, children: ui.kv([['Identidade', h('span.mono', 'agente:' + ag.id)], ['Modelo', ag.modelo || 'Gateway Cedy'], ['Nível', `${nivelLabel(ag.nivel)} (teto: ${nivelLabel(ag.nivelMaximo)})`], ['Estado', ag.pausado ? 'Pausado' : 'Ativo']]), actions: [(() => { const sem = !isAdmin(); return ui.btn(ag.pausado ? 'Retomar' : 'Pausar agente', { variant: ag.pausado ? 'primary' : 'danger', size: 'sm', icon: 'pause', disabled: sem, title: sem ? 'Só a Mesa admin propõe e o Superadmin aplica mudanças de autonomia.' : null, onclick: () => pausarAgente(ag) }); })()] }),
      ui.card({ title: 'Decisões sobre as propostas', subtitle: `${ap} aprovadas, ${rej} rejeitadas` }, (ap + rej) ? ui.chart.bars({ categories: ['Aprovadas', 'Rejeitadas'], series: [{ name: 'Propostas', tone: 'violet', data: [ap, rej] }], height: 160 }) : ui.empty({ icon: 'inbox', title: 'Sem decisões ainda', text: 'As propostas deste agente ainda aguardam decisão humana.' })),
      ui.card({ title: 'Propostas recentes' }, props.length ? h('div.list', props.slice(0, 6).map((p) => h('div.list-item', h('span.grow', h('strong', p.resumo), h('div.small.muted', `${fmt.rel(p.ts)} · confiança de ${fmt.pct(p.confianca * 100, 0)}`)), ui.status('proposta', p.status)))) : ui.empty({ icon: 'inbox', title: 'Nenhuma proposta', text: 'Este agente ainda não gerou propostas.' })),
      ui.card({ title: 'Na trilha', subtitle: 'Entradas com este agente como ator' }, led.length ? ui.timeline(led.map((e) => ({ icon: 'sparkles', tone: 'violet', title: e.resumo, ts: e.ts, actor: e.actor.nome }))) : h('p.muted.small', 'Nenhuma entrada com este agente como ator.')));
    Ops.drawer({ title: ag.nome, subtitle: 'Agente de IA · ' + nivelLabel(ag.nivel), icon: 'sparkles', size: 'lg', body: corpo });
  }

  function caixaTab(S) {
    let fAg = ''; let fCl = [];
    const lista = h('div');
    const agSel = ui.select({ options: [{ value: '', label: 'Todos os agentes' }].concat(db.all('agentes').map((a) => ({ value: a.id, label: a.nome }))), value: '', onChange: (v) => { fAg = v || ''; draw(); }, aria: 'Filtrar por agente' });
    const chips = ui.chips({ aria: 'Filtrar por classe de risco', options: ['R0', 'R1', 'R2', 'R3'].map((c) => ({ value: c, label: c })), onChange: (v) => { fCl = v; draw(); } });
    const filtros = h('div.toolbar', agSel, h('div.row', { style: { gap: '8px' } }, h('span.small.muted', 'Classe'), chips));
    function draw() {
      let ps = db.where('propostas', (p) => p.status === 'pendente').sort((a, b) => b.ts - a.ts);
      const total = ps.length;
      if (fAg) ps = ps.filter((p) => p.agenteId === fAg);
      if (fCl.length) ps = ps.filter((p) => fCl.includes(p.classe));
      C.mount(lista, ps.length ? h('div.stack.tight', ps.map(propostaCard)) : ui.empty({ icon: 'inbox', title: total ? 'Nada com estes filtros' : 'Caixa vazia', text: total ? 'Ajuste o agente ou a classe para ver as propostas pendentes.' : 'Quando um agente propuser algo, aparece aqui.' }));
    }
    draw(); S.on(['propostas'], () => { if (lista.isConnected) draw(); });
    return h('div', filtros, lista);
  }

  function propostaCard(p) {
    const ag = db.get('agentes', p.agenteId);
    const cfg = AG_SUGESTAO[p.tipo] || {};
    const semPerm = !C.can('ops.agentes');
    const dica = semPerm ? C.cannotMsg('ops.agentes') : null;
    return ui.card({ class: 'op2-prop' },
      h('div.row.between', h('div.row', ui.ai(ag ? ag.nome : p.agenteId), classeBadge(p.classe)), h('small.muted', `${fmt.rel(p.ts)} · ${fmt.datetime(p.ts)}`)),
      h('h4.op2-prop-title', p.resumo),
      h('ul.op2-ev', (p.evidencias || []).map((e) => h('li', icon('check', 13), h('span', e)))),
      h('div.op2-prop-meta', h('div.op2-conf', h('small.muted', 'Confiança de ' + fmt.pct(p.confianca * 100, 0)), ui.progress(Math.round(p.confianca * 100), { tone: p.confianca >= 0.85 ? 'green' : p.confianca >= 0.7 ? undefined : 'amber', thin: true })), h('div.small', h('span.muted', 'Item: '), entidadeLink(p.entidade))),
      cfg.dica ? ui.callout({ tone: 'warn', text: cfg.dica }) : null,
      h('div.row', ui.btn('Aprovar', { variant: 'primary', size: 'sm', icon: 'check', disabled: semPerm, title: dica, onclick: () => decidirProposta(p, true) }),
        ui.btn('Rejeitar', { variant: 'secondary', size: 'sm', disabled: semPerm, title: dica, onclick: () => decidirProposta(p, false) }),
        ui.btn('Abrir item', { variant: 'ghost', size: 'sm', icon: 'arrow-up-right', onclick: () => C.router.go(cfg.abrir ? cfg.abrir(p) : '/ops/trilha') })));
  }

  async function decidirProposta(p, aprovar) {
    if (!need('ops.agentes')) return;
    const cfg = AG_SUGESTAO[p.tipo] || {};
    if (aprovar && (p.tipo === 'ratear' || p.tipo === 'ajustar_politica')) {
      ui.toast('Abrindo para decisão humana', { type: 'info', text: `Classe ${p.classe}: a decisão final é de uma pessoa.` });
      C.router.go(cfg.abrir(p));
      return;
    }
    let motivo = null;
    if (!aprovar) { motivo = await motivoModal('Rejeitar proposta', 'Motivo da rejeição'); if (motivo === null || motivo === undefined) return; }
    else if (p.classe === 'R2' || p.classe === 'R3') {
      const okc = await ui.confirm({ title: `Aprovar proposta (${p.classe})?`, icon: 'check', text: `${p.resumo}. O efeito é aplicado agora e registrado na trilha com o seu nome.`, confirmLabel: 'Aprovar e aplicar' });
      if (!okc) return;
    }
    aplicarProposta(p, aprovar, motivo);
  }

  function aplicarProposta(p, aprovar, motivo) {
    const human = me(); const ent = p.entidade || {}; const ts = now();
    const decide = (status) => db.patch('propostas', p.id, { status, decididoPor: human.nome, decididoEm: ts, motivo: motivo || null });
    const org = db.get('orgs', ent.id);
    const kycDe = () => db.get('kyc', 'kyc-' + ent.id);
    db.batch(() => {
      if (!aprovar) {
        decide('rejeitada');
        ledger.append({ actor: human, acao: 'proposta.rejeitada', entidade: ent, resumo: `Mesa rejeitou a proposta: ${p.resumo}${motivo ? ' (' + motivo + ')' : ''}`, classe: p.classe, detalhe: { propostaId: p.id, motivo } });
        ui.toast('Proposta rejeitada', { type: 'info', text: 'Registrado na trilha com o motivo.' });
        return;
      }
      if (p.tipo === 'aprovar_lote') {
        const r = E.decidirLote(ent.id, 'aprovar', { userId: session.get().userId });
        if (!r.ok) { decide('expirada'); ui.toast('Proposta sem efeito', { type: 'warn', text: r.erro + '. A proposta foi encerrada.' }); return; }
      } else if (p.tipo === 'aprovar_kyc') {
        const k = kycDe();
        if (k) db.patch('kyc', k.id, { status: 'aprovado', atualizadoEm: ts });
        if (org && ['kyc', 'pendente'].includes(org.status)) db.patch('orgs', ent.id, { status: 'ativo', ativoDesde: org.ativoDesde || ts });
        notify.send({ to: { orgId: ent.id }, tipo: 'sucesso', titulo: 'Cadastro aprovado', corpo: orgName(ent.id) + ' está ativa na Cedy.', link: Ops.homeOf(org) });
        ledger.append({ actor: human, acao: 'kyc.aprovado', entidade: { kind: 'org', id: ent.id }, resumo: `Mesa aprovou o cadastro de ${orgName(ent.id)} (proposta do agente)`, classe: 'R2' });
        decide('aprovada');
      } else if (p.tipo === 'pedir_documentos' || p.tipo === 'reprovar_kyc') {
        // "reprovar_kyc" do agente é manter em pendência até o documento chegar: não encerra o cadastro
        const k = kycDe();
        if (k) db.patch('kyc', k.id, { status: 'pendencia', atualizadoEm: ts, pendenciaNota: (p.evidencias || []).join('; ') });
        notify.send({ to: { orgId: ent.id }, tipo: 'alerta', titulo: 'Pendências no cadastro', corpo: (p.evidencias || []).slice(0, 2).join('; '), link: Ops.homeOf(org) });
        ledger.append({ actor: human, acao: 'kyc.pendencia', entidade: { kind: 'org', id: ent.id }, resumo: `Mesa manteve ${orgName(ent.id)} em pendência até receber os documentos`, classe: 'R1' });
        decide('aprovada');
      } else if (p.tipo === 'regua') {
        notify.send({ to: { orgId: ent.id }, tipo: 'alerta', titulo: 'Lembrete de vencimento', corpo: 'Há títulos vencidos vinculados a operações na Cedy. Regularize para evitar regresso.', link: '/sacado/pagamentos' });
        ledger.append({ actor: human, acao: 'cobranca.regua_enviada', entidade: ent, resumo: 'Mesa executou a régua de cobrança para ' + orgName(ent.id), classe: 'R1' });
        decide('auto');
      } else {
        decide('aprovada');
      }
      ledger.append({ actor: human, acao: 'proposta.aprovada', entidade: ent, resumo: 'Mesa aprovou a proposta: ' + p.resumo, classe: p.classe, detalhe: { propostaId: p.id, tipo: p.tipo } });
      ui.toast('Proposta aprovada', { type: 'success', text: 'Efeito aplicado e registrado na trilha.' });
    });
  }

  function shadowTab() {
    const ags = db.all('agentes');
    const fechadas = db.where('operacoes', (o) => o.taxaFinal && o.produto).slice(-12);
    const linhas = fechadas.map((o) => { const s = E.ia.sugerirTaxa(o); return { op: o, sug: s.sugerida, real: o.taxaFinal, ok: Math.abs(s.sugerida - o.taxaFinal) <= 0.15 }; });
    const acordoShadow = linhas.length ? linhas.filter((l) => l.ok).length / linhas.length : null;
    const porAg = ags.map((a) => {
      const ps = db.where('propostas', (p) => p.agenteId === a.id && ['aprovada', 'auto'].includes(p.status)).length;
      const rej = db.where('propostas', (p) => p.agenteId === a.id && p.status === 'rejeitada').length;
      if (ps + rej) return { ag: a, acordo: ps / (ps + rej), base: `${fmt.plural(ps + rej, 'decisão', 'decisões')} na Mesa` };
      if (a.id === 'ag-preco' && acordoShadow !== null) return { ag: a, acordo: acordoShadow, base: `${linhas.length} operações comparadas` };
      if (a.metricas.aceitas) return { ag: a, acordo: a.metricas.aceitas, base: `${fmt.num(a.metricas.execucoes30d)} execuções em 30 dias` };
      return { ag: a, acordo: null, base: 'sem base ainda' };
    });
    return h('div.stack',
      ui.callout({ tone: 'ai', title: 'O que a sombra teria feito', text: 'Comparamos a sugestão do agente em modo sombra com o resultado real. Há acordo quando a sugestão fica a até 0,15 p.p. da taxa final.' }),
      ui.card({ title: 'Acordo por agente', subtitle: 'Propostas aceitas sobre decididas' }, h('div.stack.tight', ui.chart.bars({ categories: porAg.map((r) => r.ag.nome.replace('Agente de ', '')), series: [{ name: 'Acordo', tone: 'violet', data: porAg.map((r) => (r.acordo === null ? 0 : Math.round(r.acordo * 100))) }], height: 200, format: (v) => fmt.pct(v, 0), tipFormat: (v) => fmt.pct(v, 0) }),
        ui.kv(porAg.map((r) => [r.ag.nome, (r.acordo === null ? '—' : fmt.pct(r.acordo * 100, 0)) + ' · ' + r.base])))),
      ui.card({ title: 'Precificação em sombra e taxa final', subtitle: acordoShadow === null ? null : `Acordo em ${Math.round(acordoShadow * 100)}% das últimas ${linhas.length} operações` },
        ui.table({ rows: linhas.slice().reverse(), rowKey: (l) => l.op.id, pageSize: 8,
          columns: [
            { key: 'op', label: 'Operação', mobile: 'primary', render: (l) => h('a', { class: 'mono strong', href: '#/ops/empresas/' + l.op.cedenteId + '?op=' + l.op.id }, l.op.id) },
            { key: 'sug', label: 'Sombra sugeria', align: 'right', render: (l) => h('span.num.nowrap', fmt.taxa(l.sug)) },
            { key: 'real', label: 'Taxa final', align: 'right', render: (l) => h('span.num.nowrap', fmt.taxa(l.real)) },
            { key: 'ok', label: 'Acordo', render: (l) => (l.ok ? ui.badge('Acordo', 'green', { dot: true }) : ui.badge('Divergiu', 'amber', { dot: true })) },
          ] })));
  }

  /* ============================ /ops/trilha ============================= */
  let lastVerify = null;
  let trilhaRedraw = null;
  const KIND_OPTS = [['operacao', 'Operação'], ['titulo', 'Título'], ['lote', 'Lote'], ['org', 'Empresa'], ['extrato', 'Extrato'], ['casoMesa', 'Caso de Mesa'], ['fatura', 'Fatura'], ['premiacao', 'Premiação'], ['competencia', 'Competência'], ['produto', 'Produto'], ['agente', 'Agente'], ['plataforma', 'Plataforma']];
  const ATOR_OPTS = [['humano', 'Pessoa'], ['motor', 'Motor'], ['agente', 'Agente'], ['sistema', 'Sistema']];

  function pgTrilha(ctx) {
    const S = { de: null, ate: null, atores: [], classes: [], kind: '', acao: '', q: '' };
    const resumo = h('div'); const tabela = h('div'); const novos = h('div');
    let shown = ledger.all().length;
    const ativo = () => S.de || S.ate || S.atores.length || S.classes.length || S.kind || S.acao || S.q;
    const acoes = [...new Set(ledger.all().map((e) => e.acao))].sort();
    const busca = ui.search({ placeholder: 'Buscar na trilha', onInput: (v) => { S.q = String(v || '').toLowerCase(); draw(); } });
    const selKind = ui.select({ options: [{ value: '', label: 'Todas as entidades' }].concat(KIND_OPTS.map(([v, l]) => ({ value: v, label: l }))), value: '', onChange: (v) => { S.kind = v; draw(); }, aria: 'Filtrar por tipo de entidade' });
    const selAcao = ui.select({ options: [{ value: '', label: 'Todas as ações' }].concat(acoes.map((a) => ({ value: a, label: a }))), value: '', searchable: true, onChange: (v) => { S.acao = v; draw(); }, aria: 'Filtrar por ação' });
    const dDe = ui.date({ placeholder: 'Data inicial', clearable: true, aria: 'Data inicial', onChange: (v) => { S.de = v; draw(); } });
    const dAte = ui.date({ placeholder: 'Data final', clearable: true, aria: 'Data final', onChange: (v) => { S.ate = v ? v + 86400000 - 1 : null; draw(); } });
    const chAtor = ui.chips({ aria: 'Filtrar por ator', options: ATOR_OPTS.map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { S.atores = v; draw(); } });
    const chClasse = ui.chips({ aria: 'Filtrar por classe de risco', options: ['R0', 'R1', 'R2', 'R3'].map((c) => ({ value: c, label: c })), onChange: (v) => { S.classes = v; draw(); } });
    const limpar = ui.btn('Limpar filtros', { variant: 'ghost', size: 'sm', icon: 'x', onclick: () => { Object.assign(S, { de: null, ate: null, atores: [], classes: [], kind: '', acao: '', q: '' }); busca.value = ''; selKind.value = ''; selAcao.value = ''; dDe.value = null; dAte.value = null; chAtor.value = []; chClasse.value = []; draw(); } });
    const filtros = h('div.op2-filters', h('div.toolbar', busca, selKind, selAcao, dDe, dAte), h('div.toolbar', h('div.row', { style: { gap: '8px' } }, h('span.small.muted', 'Ator'), chAtor), h('div.row', { style: { gap: '8px' } }, h('span.small.muted', 'Classe'), chClasse), h('span.grow'), limpar));

    function filtradas() {
      let all = ledger.all().slice().sort((a, b) => b.seq - a.seq);
      if (S.de) all = all.filter((e) => e.ts >= S.de);
      if (S.ate) all = all.filter((e) => e.ts <= S.ate);
      if (S.atores.length) all = all.filter((e) => S.atores.includes(e.actor.tipo));
      if (S.classes.length) all = all.filter((e) => S.classes.includes(e.classe));
      if (S.kind) all = all.filter((e) => e.entidade && e.entidade.kind === S.kind);
      if (S.acao) all = all.filter((e) => e.acao === S.acao);
      if (S.q) all = all.filter((e) => `${e.resumo} ${e.acao} ${e.actor.nome || ''} ${(e.entidade && e.entidade.id) || ''} #${e.seq}`.toLowerCase().includes(S.q));
      return all;
    }
    function integridade() {
      const ver = ledger.verify();
      const estado = lastVerify || (ver.ok ? null : ver);
      return h('div.stack.tight', h('div.small.strong', 'Integridade da cadeia'),
        estado ? (estado.ok ? ui.callout({ tone: 'success', title: 'Cadeia íntegra', text: `${fmt.num(estado.count)} eventos conferidos em ${fmt.datetime(estado.em)}.` }) : ui.callout({ tone: 'error', title: 'Cadeia quebrada', text: `A divergência começa no evento ${estado.id} (sequência ${estado.brokenAt}).` })) : h('p.muted.small', 'Ainda não verificada nesta sessão.'),
        h('div.row', ui.btn('Verificar integridade', { variant: 'primary', size: 'sm', icon: 'lock', onclick: () => verificarCadeia() }),
          !ver.ok ? ui.btn('Restaurar evento', { variant: 'secondary', size: 'sm', icon: 'rotate-ccw', disabled: !podeOperar(), onclick: () => restaurarAdulteracao() }) : ui.btn('Simular adulteração', { variant: 'secondary', size: 'sm', icon: 'triangle-alert', disabled: !podeOperar(), title: podeOperar() ? null : 'O perfil leitor é somente leitura', onclick: () => simularAdulteracao() })));
    }
    function draw() {
      const all = filtradas(); shown = ledger.all().length; C.clear(novos); limpar.disabled = !ativo();
      const porAtor = ATOR_OPTS.map(([t, l]) => ({ label: t === 'humano' ? 'Pessoas' : t === 'motor' ? 'Motor' : t === 'agente' ? 'Agentes' : 'Sistema', value: all.filter((e) => e.actor.tipo === t).length, tone: F.actorTone({ tipo: t }) })).filter((x) => x.value);
      const porClasse = ['R0', 'R1', 'R2', 'R3'].map((c) => ({ label: c, value: all.filter((e) => e.classe === c).length, tone: CLASSE_TONE[c] }));
      C.mount(resumo, ui.card({ title: 'Resumo do filtro', subtitle: `${fmt.plural(all.length, 'entrada', 'entradas')}${ativo() ? ' com os filtros aplicados' : ' na trilha'}` },
        h('div.grid.g3',
          h('div', h('div.small.strong', 'Por ator'), ui.chart.donut(porAtor, { center: { value: fmt.num(all.length), label: 'entradas' } })),
          h('div', h('div.small.strong', 'Por classe de risco'), ui.chart.donut(porClasse.filter((x) => x.value), { center: { value: 'R3: ' + porClasse[3].value, label: 'portão humano' } })),
          integridade())));
      C.mount(tabela, h('div.stack.tight',
        h('div.row.between', h('span.small.muted', all.length === ledger.all().length ? 'Todas as entradas, da mais recente para a mais antiga' : `${fmt.plural(all.length, 'entrada', 'entradas')} de ${fmt.num(ledger.all().length)}`),
          h('div.row', ui.btn('Exportar CSV', { variant: 'secondary', size: 'sm', icon: 'download', onclick: () => exportarTrilha(all, 'csv') }), ui.btn('Exportar JSON', { variant: 'secondary', size: 'sm', icon: 'download', onclick: () => exportarTrilha(all, 'json') }))),
        ui.table({ rows: all, rowKey: (r) => r.id, pageSize: 25,
          empty: ui.empty({ icon: 'search', title: 'Nenhuma entrada encontrada', text: 'Ajuste ou limpe os filtros.', action: ui.btn('Limpar filtros', { onclick: () => limpar.click() }) }),
          columns: [
            { key: 'evt', label: 'Evento', mobile: 'primary', render: (e) => h('div.cell-main.op2-evt', h('span.small', e.resumo), h('small.mono', `#${e.seq} · ${e.acao}`)) },
            { key: 'ts', label: 'Data e hora', render: (e) => h('span.nowrap.small', fmt.datetime(e.ts)) },
            { key: 'ator', label: 'Ator', render: (e) => atorCell(e.actor) },
            { key: 'ent', label: 'Entidade', mobile: 'hide', render: (e) => h('span.nowrap', entidadeLink(e.entidade)) },
            { key: 'classe', label: 'Classe', render: (e) => classeBadge(e.classe) },
          ], onRowClick: (e) => trilhaDrawer(e) })));
    }
    ctx.onCleanup(db.on('ledger', () => {
      if (!tabela.isConnected) return;
      const n = ledger.all().length - shown;
      if (n > 0) C.mount(novos, ui.callout({ tone: 'info', text: `${fmt.plural(n, 'novo evento', 'novos eventos')} na trilha desde que você abriu esta tela.`, actions: [ui.btn('Atualizar', { size: 'sm', onclick: draw })] }));
    }));
    trilhaRedraw = draw; ctx.onCleanup(() => { if (trilhaRedraw === draw) trilhaRedraw = null; });
    draw();
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · auditoria', title: 'Trilha de decisões', subtitle: 'Toda ação relevante, encadeada por hash. A classe R3 sempre tem portão humano.' }),
      h('div.stack.tight', filtros, novos), resumo, tabela);
  }

  function trilhaDrawer(e) {
    const rel = ledger.all().filter((x) => x.id !== e.id && e.entidade && x.entidade && x.entidade.kind === e.entidade.kind && x.entidade.id === e.entidade.id).sort((a, b) => b.ts - a.ts).slice(0, 8);
    const json = JSON.stringify(e, null, 2);
    const corpo = h('div.stack',
      h('div.row', ui.badge('#' + e.seq, 'neutral'), ui.badge(e.acao, 'blue'), classeBadge(e.classe), h('small.muted', `${fmt.datetime(e.ts)} (${fmt.rel(e.ts)})`)),
      ui.card({ title: 'Resumo' }, h('div.stack.tight', h('p', e.resumo), ui.kv([['Ator', `${e.actor.nome} (${F.actorLabel(e.actor)})`], ['Entidade', e.entidade ? h('span', ((KIND_OPTS.find((k) => k[0] === e.entidade.kind) || [0, e.entidade.kind])[1]) + ' ', entidadeLink(e.entidade)) : '—'], ['Hash', h('span.mono.small.op2-hash', e.hash)], ['Hash anterior', h('span.mono.small.op2-hash', e.prev)]]))),
      ui.card({ title: 'Snapshot da tela', subtitle: 'O que a pessoa viu ao decidir', actions: [ui.btn('Copiar JSON', { variant: 'ghost', size: 'sm', icon: 'copy', onclick: () => copiar(json) })] },
        h('div.stack.tight', e.snapshot ? F.snapshotView(e.snapshot) : h('p.muted.small', 'Sem snapshot registrado para esta entrada.'), h('div.small.strong', 'JSON da entrada'), h('pre.op2-json', json))),
      rel.length ? ui.card({ title: 'Entradas relacionadas', subtitle: 'Mesma entidade' }, h('div.list', rel.map((r) => h('button', { type: 'button', class: 'list-item clickable op2-rel', onclick: () => trilhaDrawer(r) }, h('span.grow', h('strong.small', r.resumo), h('div.small.muted', `#${r.seq} · ${fmt.datetime(r.ts)}`)), classeBadge(r.classe))))) : null);
    Ops.drawer({ title: `Evento #${e.seq}`, subtitle: e.acao + ' · ' + e.actor.nome, icon: 'scroll-text', size: 'lg', body: corpo });
  }
  function copiar(txt) {
    const done = () => ui.toast('Copiado', { type: 'success', text: 'JSON da entrada copiado.' });
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (err) { ui.toast('Não foi possível copiar', { type: 'error' }); } ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
  }
  function exportarTrilha(all, formato) {
    const rows = all.slice().sort((a, b) => a.seq - b.seq);
    const nome = 'trilha-' + isoDay(now());
    if (formato === 'json') download(nome + '.json', JSON.stringify(rows, null, 2), 'application/json');
    else {
      const head = ['seq', 'data', 'ator_tipo', 'ator', 'acao', 'entidade_tipo', 'entidade_id', 'resumo', 'classe', 'hash', 'hash_anterior'];
      download(nome + '.csv', [head.join(',')].concat(rows.map((e) => [e.seq, new Date(e.ts).toISOString(), e.actor.tipo, e.actor.nome, e.acao, (e.entidade || {}).kind || '', (e.entidade || {}).id || '', e.resumo, e.classe, e.hash, e.prev].map(csvCell).join(','))).join('\n'), 'text/csv;charset=utf-8');
    }
    ui.toast('Exportação pronta', { type: 'success', text: `${fmt.plural(rows.length, 'entrada', 'entradas')} em ${formato.toUpperCase()}.` });
  }
  async function verificarCadeia() {
    const all = ledger.all();
    const blocos = h('div.op2-chain'); const msg = h('div');
    let fechar = null;
    const m = Ops.modal({ title: 'Verificando integridade', subtitle: fmt.plural(all.length, 'evento encadeado por hash', 'eventos encadeados por hash'), icon: 'lock', size: 'md', dismissable: false,
      body: h('div.stack.tight', h('p.small.muted', 'Cada bloco carrega o hash do anterior. Um bloco adulterado quebra todos os seguintes.'), blocos, msg),
      footer: (api) => [(fechar = ui.btn('Fechar', { variant: 'primary', disabled: true, onclick: () => api.close() }))] });
    const N = Math.min(28, all.length);
    const idx = Array.from({ length: N }, (_, i) => Math.floor(((i + 1) * all.length) / (N + 1)) - 1).filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    idx.forEach((i) => blocos.append(h('span.op2-block', { title: 'Evento #' + all[i].seq })));
    const cells = [...blocos.children]; const res = ledger.verify();
    for (let i = 0; i < cells.length; i++) {
      await new Promise((r) => setTimeout(r, C.prefersReduced() ? 1 : 60));
      const ruim = !res.ok && all[idx[i]].seq >= res.brokenAt;
      cells[i].classList.add(ruim ? 'bad' : 'ok');
      if (ruim) { cells.slice(i + 1).forEach((c) => c.classList.add('dead')); break; }
    }
    lastVerify = Object.assign({ em: now() }, res);
    msg.append(res.ok ? ui.callout({ tone: 'success', title: 'Cadeia íntegra', text: `${fmt.num(res.count)} eventos verificados, nenhum hash divergente.` }) : ui.callout({ tone: 'error', title: 'Cadeia quebrada', text: `Divergência no evento ${res.id} (sequência ${res.brokenAt}). Todos os eventos seguintes deixam de ser confiáveis. Use "Restaurar evento" na trilha.` }));
    fechar.disabled = false;
    C.store.emit('ledger'); if (trilhaRedraw) trilhaRedraw();
  }
  async function simularAdulteracao() {
    if (!needMesa()) return;
    const all = ledger.all();
    if (all.length < 3) { ui.toast('Trilha curta demais', { type: 'warn', text: 'São necessários ao menos 3 eventos para a demonstração.' }); return; }
    const okc = await ui.confirm({ title: 'Simular adulteração?', icon: 'triangle-alert', tone: 'danger', text: 'Um evento do meio da trilha será alterado de propósito para mostrar a quebra da cadeia. Depois você pode restaurá-lo na própria tela.', confirmLabel: 'Adulterar e verificar' });
    if (!okc) return;
    const seq = Math.floor(all.length / 2);
    ledger._tamper(seq);
    ui.toast('Trilha adulterada (demonstração)', { type: 'warn', text: `O evento #${seq} foi modificado. Verificando agora.` });
    verificarCadeia();
  }
  function restaurarAdulteracao() {
    if (!needMesa()) return;
    const res = ledger.verify();
    if (!res.ok) { const e = ledger.all()[res.brokenAt - 1]; if (e) e.resumo = String(e.resumo).replace(/( \(alterado\))+$/, ''); }
    lastVerify = Object.assign({ em: now() }, ledger.verify());
    C.store.emit('ledger'); if (trilhaRedraw) trilhaRedraw();
    ui.toast('Evento restaurado', { type: lastVerify.ok ? 'success' : 'warn', text: lastVerify.ok ? 'A cadeia voltou a ser íntegra.' : 'A cadeia ainda tem divergência.' });
  }

  /* ====================== /ops/empresas e detalhe ======================= */
  const KINDS = [{ id: 'cedente', label: 'Cedentes' }, { id: 'financiador', label: 'Financiadores' }, { id: 'sacado', label: 'Sacados' }, { id: 'originador', label: 'Originadores' }];
  const KIND_LABEL = { cedente: 'Cedente', financiador: 'Financiador', sacado: 'Sacado', originador: 'Originador' };

  function volumeCell(o) {
    if (o.kind === 'cedente') { const lar = E.lar(o.id); return lar ? h('div.cell-main', h('strong.num.nowrap', fmt.brl(lar.disponivel, { round: true }) + ' livres'), h('small.nowrap', `LAR ${fmt.brl(lar.limite, { round: true })} · ${lar.fase}${o.larManual != null ? ' (manual)' : ''}`)) : h('span.muted', '—'); }
    if (o.kind === 'financiador') { const exp = E.exposicaoFin(o.id); const lim = (o.politica && o.politica.limiteTotal) || 0; return h('div.cell-main', h('strong.num.nowrap', fmt.brl(exp, { round: true })), h('small.nowrap', lim ? 'de ' + fmt.brl(lim, { round: true }) + ' de limite' : 'sem limite total')); }
    if (o.kind === 'sacado') { const ab = C.sum(db.where('titulos', (t) => t.sacadoId === o.id && ['cedido', 'em_operacao', 'vencido'].includes(t.status)), (t) => t.valor); return h('div.cell-main', h('strong.num.nowrap', fmt.brl(ab, { round: true }) + ' em aberto'), h('small', h('span', 'Rating ', F.ratingBadge(o.rating)))); }
    const at = db.where('convites', (c) => c.origId === o.id && c.status === 'ativo').length;
    return h('div.cell-main', h('strong.nowrap', fmt.plural(at, 'indicado ativo', 'indicados ativos')), h('small.nowrap', fmt.plural(db.where('convites', (c) => c.origId === o.id).length, 'convite', 'convites') + ' no total'));
  }
  function responsavel(o) {
    const u = db.where('users', (x) => x.orgId === o.id && x.perfil === 'admin')[0] || db.where('users', (x) => x.orgId === o.id)[0];
    return u ? h('div.cell-main', h('strong', u.nome), h('small', u.cargo || PERFIL[u.perfil])) : h('span.muted', '—');
  }

  function pgEmpresas(ctx) {
    let kind = 'cedente'; let q = ''; let st = '';
    const lista = h('div');
    function draw() {
      let orgs = db.where('orgs', (o) => o.kind === kind);
      if (st) orgs = orgs.filter((o) => o.status === st);
      if (q) { const s = q.toLowerCase(); orgs = orgs.filter((o) => `${o.fantasia || ''} ${o.nome} ${o.cnpj} ${fmt.cnpj(o.cnpj)} ${o.cidade || ''}`.toLowerCase().includes(s)); }
      orgs = orgs.sort((a, b) => (a.fantasia || a.nome).localeCompare(b.fantasia || b.nome));
      C.mount(lista, ui.table({ rows: orgs, rowKey: (r) => r.id,
        columns: [
          { key: 'nome', label: 'Empresa', mobile: 'primary', render: (o) => F.orgCell(o, { sub: 'CNPJ ' + fmt.cnpj(o.cnpj) }) },
          { key: 'cid', label: 'Cidade', mobile: 'hide', render: (o) => h('span.nowrap', (o.cidade || '—') + (o.uf ? '/' + o.uf : '')) },
          { key: 'status', label: 'Situação', render: (o) => ui.status('org', o.status) },
          { key: 'desde', label: 'Cliente desde', mobile: 'hide', render: (o) => (o.ativoDesde ? h('span.nowrap', fmt.date(o.ativoDesde)) : h('span.muted', '—')) },
          { key: 'vol', label: kind === 'cedente' ? 'Limite (LAR)' : kind === 'financiador' ? 'Exposição' : kind === 'sacado' ? 'Títulos' : 'Carteira', render: volumeCell },
          { key: 'resp', label: 'Responsável', mobile: 'hide', render: responsavel },
        ], onRowClick: (o) => C.router.go('/ops/empresas/' + o.id),
        empty: ui.empty({ icon: 'building-2', title: 'Nenhuma empresa encontrada', text: 'Ajuste a busca ou o filtro de situação.' }) }));
    }
    const counts = Object.fromEntries(KINDS.map((k) => [k.id, db.where('orgs', (o) => o.kind === k.id).length]));
    const tabs = ui.tabs({ value: kind, items: KINDS.map((k) => ({ id: k.id, label: k.label, count: counts[k.id] })), onChange: (v) => { kind = v; draw(); } });
    const bar = h('div.toolbar', ui.search({ placeholder: 'Buscar por nome, CNPJ ou cidade', onInput: (v) => { q = String(v || ''); draw(); } }),
      ui.select({ options: [{ value: '', label: 'Todas as situações' }, { value: 'ativo', label: 'Ativo' }, { value: 'kyc', label: 'KYC em análise' }, { value: 'pendente', label: 'Pendências' }, { value: 'suspenso', label: 'Suspenso' }, { value: 'inativo', label: 'Inativo' }], value: '', aria: 'Filtrar por situação', onChange: (v) => { st = v; draw(); } }));
    ctx.onCleanup(db.on('orgs', () => { if (lista.isConnected) draw(); }));
    draw();
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · cadastros', title: 'Empresas', subtitle: 'Todas as empresas da plataforma, por papel. Abra uma empresa para ver a visão 360.' }),
      tabs, bar, lista);
  }

  function pgEmpresa(ctx) {
    if (/^OP-/.test(ctx.params.id)) return pgOperacaoFull(ctx.params.id);
    const o = db.get('orgs', ctx.params.id);
    if (!o || o.kind === 'cedy') return h('div.stack.ops-page', ui.pageHeader({ title: 'Empresa não encontrada', back: '/ops/empresas' }), ui.empty({ icon: 'building-2', title: 'Esta empresa não existe', text: 'Verifique o link ou volte ao diretório.', action: ui.btn('Voltar às empresas', { route: '/ops/empresas' }) }));
    if (ctx.query.op) setTimeout(() => abrirOp360(ctx.query.op), 60);
    let aba = 'resumo';
    const corpo = h('div');
    const comTitulos = ['cedente', 'sacado'].includes(o.kind);
    const abas = ui.tabs({ value: aba, items: [
      { id: 'resumo', label: 'Resumo' }, { id: 'ops', label: 'Operações', count: opsDaEmpresa(o).length }, comTitulos ? { id: 'titulos', label: 'Títulos', count: titulosDaEmpresa(o).length } : null,
      { id: 'usuarios', label: 'Usuários', count: db.where('users', (u) => u.orgId === o.id).length },
      { id: 'kyc', label: 'Documentos e KYC' }, o.kind === 'sacado' ? null : { id: 'fin', label: 'Financeiro' }, { id: 'trilha', label: 'Trilha' },
    ].filter(Boolean), onChange: (v) => { aba = v; draw(); } });
    function draw() {
      C.mount(corpo, aba === 'resumo' ? empResumo(o) : aba === 'ops' ? empOps(o) : aba === 'titulos' ? empTitulos(o) : aba === 'usuarios' ? empUsuarios(o) : aba === 'kyc' ? empKyc(o) : aba === 'fin' ? empFinanceiro(o) : empTrilha(o));
    }
    ctx.onCleanup(C.store.on(['orgs', 'operacoes', 'titulos', 'kyc'], () => { if (corpo.isConnected) draw(); }));
    draw();
    const badges = () => { const kyc = db.get('kyc', 'kyc-' + o.id); return h('div.row', ui.status('org', o.status), o.rating ? F.ratingBadge(o.rating) : null, kyc ? ui.status('kyc', kyc.status) : null, o.restricao ? ui.badge('Restrição: ' + o.restricao, 'red') : null, o.motivoSuspensao ? ui.badge('Motivo: ' + o.motivoSuspensao, 'red') : null); };
    return h('div.stack.ops-page',
      ui.pageHeader({ back: '/ops/empresas', eyebrow: KIND_LABEL[o.kind] || o.kind, title: o.fantasia || o.nome, subtitle: `${o.nome} · CNPJ ${fmt.cnpj(o.cnpj)}`, actions: [menuEmpresa(o)] }),
      ui.live(['orgs', 'kyc'], badges),
      abas, corpo);
  }

  function menuEmpresa(o) {
    const suspensa = o.status === 'suspenso';
    const sem = !C.can('ops.suspender');
    const dica = sem ? C.cannotMsg('ops.suspender') : null;
    return ui.moreMenu([
      suspensa ? { label: 'Reativar empresa', icon: 'circle-check', disabled: sem, hint: dica, onclick: () => suspenderEmpresa(o, false) } : { label: 'Suspender empresa', icon: 'pause', danger: true, disabled: sem, hint: dica, onclick: () => suspenderEmpresa(o, true) },
      o.kind === 'cedente' && { label: 'Alterar limite (LAR manual)', icon: 'gauge', disabled: sem, hint: dica, onclick: () => limiteEmpresa(o) },
      o.kind === 'sacado' && (o.restricao ? { label: 'Remover restrição do sacado', icon: 'circle-check', disabled: sem, hint: dica, onclick: () => bloquearSacado(o, false) } : { label: 'Bloquear sacado', icon: 'ban', danger: true, disabled: sem, hint: dica, onclick: () => bloquearSacado(o, true) }),
    ].filter(Boolean), { label: 'Ações da Mesa sobre ' + (o.fantasia || o.nome) });
  }

  async function suspenderEmpresa(o, suspender) {
    if (!need('ops.suspender')) return;
    let motivo = null;
    const campo = ui.field({ label: 'Motivo', required: true, hint: suspender ? 'Um cedente suspenso não publica operação: o motor barra na publicação.' : null }, (motivo = ui.input({ type: 'textarea', placeholder: 'Ex.: recompra vencida há mais de 10 dias úteis' })));
    const nome = o.fantasia || o.nome;
    const m = Ops.modal({ title: (suspender ? 'Suspender ' : 'Reativar ') + nome, icon: suspender ? 'pause' : 'play', tone: suspender ? 'red' : 'blue', size: 'sm', body: campo,
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn(suspender ? 'Suspender' : 'Reativar', { variant: suspender ? 'danger' : 'primary', onclick: () => {
        const mot = String(motivo.value).trim();
        if (!mot) { campo.setError('Informe o motivo.'); return; }
        db.patch('orgs', o.id, suspender ? { status: 'suspenso', motivoSuspensao: mot } : { status: 'ativo', motivoSuspensao: null });
        ledger.append({ actor: me(), acao: suspender ? 'empresa.suspensa' : 'empresa.reativada', entidade: { kind: 'org', id: o.id }, resumo: `${suspender ? 'Mesa suspendeu ' : 'Mesa reativou '}${nome}: ${mot}`, classe: 'R2' });
        notify.send({ to: { orgId: o.id }, tipo: suspender ? 'erro' : 'sucesso', titulo: suspender ? 'Cadastro suspenso' : 'Cadastro reativado', corpo: mot, link: Ops.homeOf(o) });
        ui.toast(suspender ? 'Empresa suspensa' : 'Empresa reativada', { type: suspender ? 'warn' : 'success', text: nome });
        api.close(true);
      } })] });
    await m.promise;
  }

  async function limiteEmpresa(o) {
    if (!need('ops.suspender')) return;
    const lar = E.lar(o.id);
    const atual = o.larManual !== undefined && o.larManual !== null ? o.larManual : (lar ? lar.limite : 0);
    let vCtl = null;
    const campo = ui.field({ label: 'Limite manual', hint: `Limite calculado hoje: ${lar ? fmt.brl(lar.limite) + ' (' + lar.fase + ')' : 'indisponível'}. Deixe zerado para voltar ao cálculo automático.` }, (vCtl = ui.currency({ value: atual })));
    const m = Ops.modal({ title: 'Alterar limite de ' + (o.fantasia || o.nome), icon: 'gauge', size: 'sm', body: campo,
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Salvar limite', { variant: 'primary', onclick: () => {
        const antes = o.larManual !== undefined && o.larManual !== null ? fmt.brl(o.larManual) : 'automático';
        const nv = vCtl.value;
        db.patch('orgs', o.id, { larManual: nv ? Math.round(nv) : null });
        const depois = nv ? fmt.brl(nv) : 'automático';
        ledger.append({ actor: me(), acao: 'empresa.limite_alterado', entidade: { kind: 'org', id: o.id }, resumo: `Mesa alterou o LAR de ${o.fantasia || o.nome}: ${antes} para ${depois}`, classe: 'R2', detalhe: { antes, depois } });
        ui.toast('Limite atualizado', { type: 'success', text: 'Novo limite: ' + depois + '.' });
        api.close(true);
      } })] });
    await m.promise;
  }

  async function bloquearSacado(o, bloquear) {
    if (!need('ops.suspender')) return;
    let motivo = null;
    const campo = ui.field({ label: bloquear ? 'Motivo da restrição' : 'Restrição atual', required: bloquear, hint: bloquear ? 'Os títulos deste sacado passam a ser recusados na validação.' : 'A restrição sai e novos títulos deste sacado voltam a ser aceitos.' }, (motivo = ui.input({ value: o.restricao || '', placeholder: 'Ex.: protesto em aberto (tabelionato)', readonly: !bloquear })));
    const nome = o.fantasia || o.nome;
    const m = Ops.modal({ title: bloquear ? 'Bloquear ' + nome : 'Remover restrição de ' + nome, icon: bloquear ? 'ban' : 'circle-check', tone: bloquear ? 'red' : 'blue', size: 'sm', body: campo,
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn(bloquear ? 'Bloquear sacado' : 'Remover restrição', { variant: bloquear ? 'danger' : 'primary', onclick: () => {
        const mot = String(motivo.value).trim();
        if (bloquear && !mot) { campo.setError('Informe o motivo.'); return; }
        db.patch('orgs', o.id, { restricao: bloquear ? mot : null });
        ledger.append({ actor: me(), acao: bloquear ? 'sacado.bloqueado' : 'sacado.desbloqueado', entidade: { kind: 'org', id: o.id }, resumo: (bloquear ? 'Mesa bloqueou o sacado ' : 'Mesa removeu a restrição de ') + nome + (bloquear ? ': ' + mot : ''), classe: 'R2' });
        ui.toast(bloquear ? 'Sacado bloqueado' : 'Restrição removida', { type: bloquear ? 'warn' : 'success', text: nome });
        api.close(true);
      } })] });
    await m.promise;
  }

  function opsDaEmpresa(o) {
    if (o.kind === 'cedente') return db.where('operacoes', (x) => x.cedenteId === o.id);
    if (o.kind === 'financiador') return db.where('operacoes', (x) => x.financiadorId === o.id || (x.canal === 'balcao' && x.financiadorAlvoId === o.id));
    if (o.kind === 'sacado') { const ids = new Set(db.where('titulos', (t) => t.sacadoId === o.id && t.operacaoId).map((t) => t.operacaoId)); return db.where('operacoes', (x) => ids.has(x.id)); }
    const ceds = new Set(db.where('convites', (c) => c.origId === o.id && c.orgId).map((c) => c.orgId));
    return db.where('operacoes', (x) => ceds.has(x.cedenteId));
  }
  function titulosDaEmpresa(o) {
    if (o.kind === 'cedente') return db.where('titulos', (t) => t.orgId === o.id);
    if (o.kind === 'sacado') return db.where('titulos', (t) => t.sacadoId === o.id);
    return [];
  }
  const kpis = (...k) => h('div.grid.g4.keep2', k);

  function empResumo(o) {
    if (o.kind === 'cedente') {
      const lar = E.lar(o.id);
      const ops = opsDaEmpresa(o).filter((x) => ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'].includes(x.status));
      return h('div.stack',
        kpis(ui.kpi({ label: 'Limite disponível (LAR)', display: lar ? fmt.brl(lar.disponivel, { round: true }) : '—', icon: 'gauge', tone: 'blue', hint: lar ? `de ${fmt.brl(lar.limite, { round: true })} · ${lar.fase}` : '' }),
          ui.kpi({ label: 'Volume antecipado', display: fmt.brl(C.sum(ops, (x) => x.face), { round: true }), icon: 'banknote', tone: 'teal', hint: fmt.plural(ops.length, 'operação em andamento', 'operações em andamento') }),
          ui.kpi({ label: 'Títulos disponíveis', display: fmt.num(db.where('titulos', (t) => t.orgId === o.id && t.status === 'disponivel').length), icon: 'receipt-text', tone: 'green', hint: 'prontos para antecipar' }),
          ui.kpi({ label: 'Score Cedy', display: o.scoreCedy ? String(o.scoreCedy) : '—', icon: 'star', tone: 'amber', hint: o.scoreCedy ? 'de 0 a 1.000' : 'em formação' })),
        ui.card({ title: 'Cadastro' }, ui.kv([['Razão social', o.nome], ['CNPJ', fmt.cnpj(o.cnpj)], ['Cidade', (o.cidade || '—') + (o.uf ? '/' + o.uf : '')], ['Setor', o.setor || '—'], ['Porte', o.porte || '—'], ['Cliente desde', o.ativoDesde ? fmt.date(o.ativoDesde) : '—'], ['Limite manual', o.larManual ? fmt.brl(o.larManual) : 'automático'], o.motivoSuspensao && ['Motivo da suspensão', o.motivoSuspensao]], { cols: 2 })));
    }
    if (o.kind === 'financiador') {
      const ops = opsDaEmpresa(o);
      return h('div.stack',
        kpis(ui.kpi({ label: 'Exposição atual', display: fmt.brl(E.exposicaoFin(o.id), { round: true }), icon: 'briefcase', tone: 'teal' }),
          ui.kpi({ label: 'Limite total', display: fmt.brl((o.politica && o.politica.limiteTotal) || 0, { round: true }), icon: 'gauge', tone: 'blue' }),
          ui.kpi({ label: 'Operações', display: fmt.num(ops.length), icon: 'repeat', tone: 'green' }),
          ui.kpi({ label: 'Taxa mínima', display: fmt.taxa((o.politica && o.politica.taxaMinima) || 0), icon: 'percent', tone: 'amber' })),
        ui.card({ title: 'Cadastro e regulação' }, ui.kv([['Razão social', o.nome], ['CNPJ', fmt.cnpj(o.cnpj)], ['Tipo', o.tipo || '—'], ['Regulação', o.regulacao || '—']], { cols: 2 })));
    }
    if (o.kind === 'sacado') {
      const ab = C.sum(titulosDaEmpresa(o).filter((t) => ['cedido', 'em_operacao', 'vencido'].includes(t.status)), (t) => t.valor);
      return h('div.stack',
        kpis(ui.kpi({ label: 'Títulos em aberto', display: fmt.brl(ab, { round: true }), icon: 'receipt-text', tone: 'amber' }),
          ui.kpi({ label: 'Rating', display: o.rating || '—', icon: 'star', tone: 'teal' }),
          ui.kpi({ label: 'Pagamento médio', display: fmt.plural(o.pagamentoMedioDias || 0, 'dia', 'dias'), icon: 'clock', tone: 'blue' }),
          ui.kpi({ label: 'Restrição', display: o.restricao ? 'Sim' : 'Não', icon: 'ban', tone: o.restricao ? 'red' : 'green' })),
        o.restricao ? ui.callout({ tone: 'error', title: 'Sacado com restrição', text: o.restricao + '. Os títulos deste sacado são recusados na validação.' }) : null,
        ui.card({ title: 'Cadastro' }, ui.kv([['Razão social', o.nome], ['CNPJ', fmt.cnpj(o.cnpj)], ['Setor', o.setor || '—'], ['Porte', o.porteSacado || '—']], { cols: 2 })));
    }
    const convs = db.where('convites', (c) => c.origId === o.id);
    return h('div.stack',
      kpis(ui.kpi({ label: 'Indicados ativos', display: fmt.num(convs.filter((c) => c.status === 'ativo').length), icon: 'users', tone: 'green' }),
        ui.kpi({ label: 'Convites enviados', display: fmt.num(convs.length), icon: 'user-plus', tone: 'blue' }),
        ui.kpi({ label: 'Premiação em aberto', display: fmt.brl(C.sum(db.where('premiacoes', (p) => p.origId === o.id && p.status !== 'pago'), (p) => p.total)), icon: 'award', tone: 'amber' }),
        ui.kpi({ label: 'Conta de premiação', display: o.contaPremiacao ? o.contaPremiacao.banco : '—', icon: 'wallet', tone: 'teal' })),
      ui.card({ title: 'Indicados' }, convs.length ? h('div.list', convs.map((c) => h('div.list-item', h('span.grow', h('strong', c.nome), h('div.small.muted', 'Convidado ' + fmt.rel(c.enviadoEm))), ui.status('convite', c.status)))) : ui.empty({ icon: 'users', title: 'Sem indicados', text: 'Os convites deste originador aparecem aqui.' })));
  }

  function empOps(o) {
    const ops = opsDaEmpresa(o).sort((a, b) => b.criadaEm - a.criadaEm);
    if (!ops.length) return ui.empty({ icon: 'repeat', title: 'Sem operações', text: 'Nenhuma operação vinculada a esta empresa.' });
    return ui.table({ rows: ops, rowKey: (r) => r.id, pageSize: 15,
      columns: [
        { key: 'id', label: 'Operação', mobile: 'primary', render: (x) => h('span.mono.strong', x.id) },
        { key: 'st', label: 'Situação', render: (x) => ui.status('operacao', x.status) },
        { key: 'face', label: 'Valor de face', align: 'right', render: (x) => h('span.num', fmt.brl(x.face, { round: true })) },
        { key: 'taxa', label: 'Taxa final', align: 'right', mobile: 'hide', render: (x) => (x.taxaFinal ? h('span.num.nowrap', fmt.taxa(x.taxaFinal)) : h('span.muted', 'em leilão')) },
        { key: 'criada', label: 'Criada em', mobile: 'hide', render: (x) => h('span.nowrap', fmt.date(x.criadaEm)) },
        { key: 'fin', label: o.kind === 'financiador' ? 'Cedente' : 'Financiador', mobile: 'hide', render: (x) => (o.kind === 'financiador' ? orgName(x.cedenteId) : (x.financiadorId ? orgName(x.financiadorId) : h('span.muted', 'em leilão'))) },
      ], onRowClick: (x) => abrirOp360(x.id) });
  }

  function empTitulos(o) {
    const ts = titulosDaEmpresa(o).sort((a, b) => b.emissao - a.emissao);
    if (!ts.length) return ui.empty({ icon: 'receipt-text', title: 'Sem títulos', text: 'Nenhum título vinculado a esta empresa.' });
    return ui.table({ rows: ts, rowKey: (r) => r.id, pageSize: 15,
      columns: [
        { key: 'n', label: 'Título', mobile: 'primary', render: (t) => h('div.cell-main', h('strong', t.numero || t.id), h('small', (db.get('orgs', t.sacadoId) || {}).fantasia || '')) },
        { key: 'v', label: 'Valor', align: 'right', render: (t) => h('span.num', fmt.brl(t.valor)) },
        { key: 'venc', label: 'Vencimento', render: (t) => h('span.nowrap', fmt.date(t.vencimento)) },
        { key: 'st', label: 'Situação', render: (t) => ui.status('titulo', t.status) },
        { key: 'op', label: 'Operação', mobile: 'hide', render: (t) => (t.operacaoId ? h('span.mono', t.operacaoId) : h('span.muted', '—')) },
      ], onRowClick: (t) => { if (t.operacaoId) abrirOp360(t.operacaoId); } });
  }

  function empUsuarios(o) {
    const us = db.where('users', (u) => u.orgId === o.id);
    if (!us.length) return ui.empty({ icon: 'users', title: 'Sem usuários', text: 'Nenhum usuário vinculado a esta empresa.' });
    return ui.table({ rows: us, rowKey: (r) => r.id,
      columns: [
        { key: 'n', label: 'Usuário', mobile: 'primary', render: (u) => h('div.cell-row', ui.avatar(u.nome, { size: 'sm', hue: u.hue }), h('div.cell-main', h('strong', u.nome), h('small', u.email))) },
        { key: 'p', label: 'Perfil', render: (u) => perfilBadge(u.perfil) },
        { key: 'c', label: 'Cargo', mobile: 'hide', render: (u) => u.cargo || '—' },
        { key: '2fa', label: '2FA', render: twofaBadge },
        { key: 'ac', label: 'Último acesso', mobile: 'hide', render: (u) => (u.ultimoAcesso ? fmt.rel(u.ultimoAcesso) : h('span.muted', '—')) },
        { key: 'ver', label: '', render: (u) => { const sem = !C.can('ops.verComo'); return ui.btn('Ver como', { variant: 'ghost', size: 'sm', icon: 'eye', disabled: sem, title: sem ? C.cannotMsg('ops.verComo') : `Entrar como ${u.nome} em modo somente leitura (auditado)`, onclick: () => verComoUsuario(u) }); } },
      ] });
  }

  /** 'Ver como' por usuário: suporte e Superadmin, sempre auditado e somente leitura. */
  async function verComoUsuario(alvo) {
    if (!need('ops.verComo')) return;
    if (C.flows.verComo) { C.flows.verComo(alvo.id); return; }
    let just = null; let min = null;
    const campo = ui.field({ label: 'Justificativa', required: true, hint: 'Mínimo de 15 caracteres: fica na trilha e o cliente é avisado.' }, (just = ui.input({ type: 'textarea', placeholder: 'Ex.: reproduzir o erro da tela de títulos relatado no chamado 4821' })));
    const campoMin = ui.field({ label: 'Duração (minutos)' }, (min = ui.numeric({ value: 15, min: 5, max: 30, aria: 'Duração em minutos' })));
    const m = Ops.modal({ title: 'Ver como ' + alvo.nome, subtitle: 'Somente leitura, com contagem regressiva. O cliente recebe um aviso.', icon: 'eye', size: 'sm',
      body: h('div.stack.tight', campo, campoMin),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Entrar em modo Ver como', { variant: 'primary', icon: 'eye', onclick: () => {
        const j = String(just.value).trim();
        if (j.length < 15) { campo.setError('Escreva ao menos 15 caracteres.'); return; }
        const r = E.iniciarVerComo({ alvoUserId: alvo.id, justificativa: j, minutos: min.value || 15 });
        if (!r.ok) { ui.toast('Não foi possível iniciar', { type: 'error', text: r.erro }); return; }
        ui.toast('Modo "ver como" ativo', { type: 'info', text: 'Somente leitura. Encerre no topo quando terminar.' });
        api.close(true);
      } })] });
    await m.promise;
  }

  const DOC_ST = { ok: ['Conferido', 'green'], divergente: ['Divergente', 'amber'], expirado: ['Expirado', 'red'], pendente: ['Pendente', 'neutral'] };
  function empKyc(o) {
    const k = db.get('kyc', 'kyc-' + o.id);
    if (!k) return ui.empty({ icon: 'scan-line', title: 'Sem dossiê KYC', text: 'Esta empresa ainda não tem dossiê de cadastro.' });
    return h('div.stack',
      h('div.row', ui.status('kyc', k.status), h('small.muted', 'Atualizado ' + fmt.rel(k.atualizadoEm)), ui.btn('Abrir na Mesa de cadastros', { variant: 'secondary', size: 'sm', icon: 'arrow-up-right', route: '/ops/kyc/' + k.id })),
      k.agenteResumo ? ui.callout({ tone: 'ai', title: 'Parecer do agente', text: k.agenteResumo }) : null,
      ui.table({ rows: k.docs || [], rowKey: (r) => r.tipo,
        columns: [
          { key: 't', label: 'Documento', mobile: 'primary', render: (d) => h('div.cell-main', h('strong', d.tipo), d.arquivo ? h('small.mono', d.arquivo) : h('small.muted', 'arquivo ausente')) },
          { key: 's', label: 'Situação', render: (d) => ui.badge((DOC_ST[d.status] || [d.status])[0], (DOC_ST[d.status] || [0, 'neutral'])[1], { dot: true }) },
          { key: 'c', label: 'Confiança da IA', align: 'right', mobile: 'hide', render: (d) => (d.agente ? h('span.num', fmt.pct(d.agente.confianca * 100, 0)) : h('span.muted', '—')) },
        ] }));
  }

  function empFinanceiro(o) {
    const card = (title, rows, actions, cols, vazio) => ui.card({ title, actions }, rows.length ? ui.table({ rows, rowKey: (r) => r.id, columns: cols }) : h('p.muted', vazio));
    if (o.kind === 'cedente') {
      const linhas = db.where('extrato', (x) => x.orgId === o.id).sort((a, b) => b.ts - a.ts).slice(0, 10);
      return h('div.stack', ui.card({ title: 'Conta de liquidação', subtitle: 'Últimas movimentações' }, linhas.length ? ui.table({ rows: linhas, rowKey: (r) => r.id, columns: [
        { key: 'v', label: 'Valor', align: 'right', mobile: 'primary', render: (l) => h('span.num', fmt.brl(l.valor)) },
        { key: 'd', label: 'Data', render: (l) => h('span.nowrap', fmt.datetime(l.ts)) },
        { key: 's', label: 'Situação', render: (l) => ui.status('extrato', l.status) },
        { key: 'x', label: 'Descrição', mobile: 'hide', render: (l) => h('span.small', l.descricao || '') },
      ] }) : h('p.muted', 'Sem movimentações.')));
    }
    if (o.kind === 'financiador') {
      const fats = db.where('faturas', (x) => x.finId === o.id).sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
      return h('div.stack', card('Faturas de TS e acesso', fats, [ui.btn('Ver faturamento', { variant: 'ghost', size: 'sm', route: '/ops/faturamento' })], [
        { key: 'c', label: 'Competência', mobile: 'primary', render: (x) => fmt.monthLong(x.competencia) },
        { key: 't', label: 'Total', align: 'right', render: (x) => h('span.num', fmt.brl(x.total)) },
        { key: 'v', label: 'Vencimento', mobile: 'hide', render: (x) => fmt.date(x.vencimento) },
        { key: 's', label: 'Situação', render: (x) => ui.status('fatura', x.status) },
      ], 'Sem faturas.'));
    }
    if (o.kind === 'originador') {
      const prs = db.where('premiacoes', (p) => p.origId === o.id).sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
      return h('div.stack', card('Premiações', prs, [ui.btn('Ver faturamento', { variant: 'ghost', size: 'sm', route: '/ops/faturamento' })], [
        { key: 'c', label: 'Competência', mobile: 'primary', render: (x) => fmt.monthLong(x.competencia) },
        { key: 'i', label: 'Indicado', mobile: 'hide', render: (x) => orgName(x.cedenteId) },
        { key: 't', label: 'Total', align: 'right', render: (x) => h('span.num', fmt.brl(x.total)) },
        { key: 's', label: 'Situação', render: (x) => ui.status('premio', x.status) },
      ], 'Sem premiações.'));
    }
    return ui.empty({ icon: 'wallet', title: 'Sem dados financeiros', text: 'O sacado paga na conta de liquidação do cedente; não há movimento financeiro com a Cedy.' });
  }

  function empTrilha(o) {
    const ops = new Set(opsDaEmpresa(o).map((x) => x.id));
    const es = ledger.all().filter((e) => e.entidade && ((e.entidade.kind === 'org' && e.entidade.id === o.id) || (e.entidade.kind === 'operacao' && ops.has(e.entidade.id)))).sort((a, b) => b.seq - a.seq);
    if (!es.length) return ui.empty({ icon: 'scroll-text', title: 'Sem eventos', text: 'Nenhuma entrada da trilha cita esta empresa.' });
    return ui.table({ rows: es, rowKey: (r) => r.id, pageSize: 15,
      columns: [
        { key: 'a', label: 'Evento', mobile: 'primary', render: (e) => h('div.cell-main.op2-evt', h('span.small', e.resumo), h('small.mono', `#${e.seq} · ${e.acao}`)) },
        { key: 'd', label: 'Data e hora', render: (e) => h('span.nowrap.small', fmt.datetime(e.ts)) },
        { key: 'c', label: 'Classe', render: (e) => classeBadge(e.classe) },
      ], onRowClick: (e) => trilhaDrawer(e) });
  }

  /* ---------------------------- detalhe da operação --------------------------- */
  function opLances(op, drawer) {
    const lances = E.lancesDaOp(op.id).slice().sort((a, b) => (drawer ? b.criadoEm - a.criadoEm : a.taxaAm - b.taxaAm));
    return ui.card({ title: 'Lances', subtitle: `${fmt.plural(lances.length, 'oferta', 'ofertas')}, ${drawer ? 'da mais recente para a mais antiga' : 'menor taxa primeiro'}. Identidades visíveis à Mesa.` }, lances.length ? ui.table({ rows: lances, rowKey: (r) => r.id, pageSize: 10, columns: [
      { key: 'f', label: 'Financiador', mobile: 'primary', render: (l) => F.orgCell(db.get('orgs', l.finId)) },
      { key: 't', label: 'Taxa', align: 'right', render: (l) => h('strong.num.nowrap', fmt.taxa(l.taxaAm)) },
      { key: 'd', label: 'Quando', mobile: 'hide', render: (l) => h('span.small.nowrap', fmt.datetime(l.criadoEm)) },
      { key: 's', label: 'Situação', render: (l) => ui.status('lance', l.status) },
    ] }) : ui.empty({ icon: 'gavel', title: 'Sem lances ainda' }));
  }
  const opContrato = (op) => { const ct = op.contratoId ? db.get('contratos', op.contratoId) : null; return ct ? ui.card({ title: 'Contrato de cessão', actions: [ui.btn('Ver contrato', { variant: 'ghost', size: 'sm', onclick: () => F.verContrato(ct) })] }, F.contratoCard(ct)) : null; };
  const opLiquidacao = (op) => { const ext = db.where('extrato', (l) => (l.matches || []).some((mm) => mm.opId === op.id)); return ext.length ? ui.card({ title: 'Liquidação', subtitle: 'Linhas do extrato vinculadas à operação' }, ui.table({ rows: ext, rowKey: (r) => r.id, columns: [
    { key: 'v', label: 'Valor', align: 'right', mobile: 'primary', render: (l) => h('span.num', fmt.brl(l.valor)) },
    { key: 'd', label: 'Data', render: (l) => h('span.small.nowrap', fmt.datetime(l.ts)) },
    { key: 'p', label: 'Pagador', mobile: 'hide', render: (l) => h('span.small', l.pagadorNome || '') },
    { key: 's', label: 'Situação', render: (l) => ui.status('extrato', l.status) },
  ] })) : null; };
  const opTrilha = (op) => { const items = F.timelineItems('operacao', op.id); return ui.card({ title: 'Trilha da operação' }, items.length ? ui.timeline(items) : h('p.muted.small', 'Nenhum evento registrado.')); };

  function pgOperacaoFull(opId) {
    const op = db.get('operacoes', opId);
    if (!op) return h('div.stack.ops-page', ui.pageHeader({ title: 'Operação não encontrada', back: '/ops/empresas' }), ui.empty({ icon: 'repeat', title: 'Esta operação não existe', action: ui.btn('Voltar às empresas', { route: '/ops/empresas' }) }));
    const ced = db.get('orgs', op.cedenteId); const fin = op.financiadorId ? db.get('orgs', op.financiadorId) : null;
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · operação', title: 'Operação ' + op.id, subtitle: `${ced ? ced.fantasia || ced.nome : ''} · ${fmt.brl(op.face)} · ${F.prod(op.produto)}`, back: '/ops/empresas/' + op.cedenteId, actions: [ui.status('operacao', op.status)] }),
      ui.callout({ tone: 'info', title: 'Visão da Mesa: identidades reveladas', text: 'Fora da Mesa, o financiador em leilão é anônimo para o cedente até o aceite. Aqui todas as identidades aparecem.' }),
      kpis(ui.kpi({ label: 'Valor de face', display: fmt.brl(op.face, { round: true }), icon: 'banknote', tone: 'blue' }),
        ui.kpi({ label: 'Líquido ao cedente', display: op.liquido ? fmt.brl(op.liquido, { round: true }) : 'em leilão', icon: 'wallet', tone: 'teal', hint: op.taxaFinal ? 'taxa ' + fmt.taxa(op.taxaFinal) : '' }),
        ui.kpi({ label: 'TS da Cedy', display: op.ts !== undefined ? fmt.brl(op.ts) : 'a definir', icon: 'percent', tone: 'green', hint: op.tsPct ? `${op.tsPct}% do spread${op.tsNoPiso ? ' (piso)' : ''}` : '' }),
        ui.kpi({ label: 'Regresso', display: op.regresso ? 'Com regresso' : 'Sem regresso', icon: 'shield-check', tone: op.regresso ? 'teal' : 'amber' })),
      opLances(op, false), opContrato(op), opLiquidacao(op), opTrilha(op),
      h('div.row', ui.btn('Abrir empresa do cedente', { variant: 'secondary', icon: 'building-2', route: '/ops/empresas/' + op.cedenteId }), fin ? ui.btn('Abrir financiador', { variant: 'ghost', icon: 'landmark', route: '/ops/empresas/' + fin.id }) : null));
  }

  function abrirOp360(opId) {
    const op = db.get('operacoes', opId);
    if (!op) { ui.toast('Operação não encontrada', { type: 'error', text: opId }); return; }
    const ced = db.get('orgs', op.cedenteId); const fin = op.financiadorId ? db.get('orgs', op.financiadorId) : null;
    Ops.drawer({ title: 'Operação ' + op.id, subtitle: ui.statusLabel('operacao', op.status) + ' · identidades reveladas à Mesa', icon: 'repeat', size: 'lg',
      body: h('div.stack',
        h('div.row', ui.status('operacao', op.status), op.regresso ? ui.badge('Com regresso', 'teal') : ui.badge('Sem regresso', 'amber'), ui.badge(F.prod(op.produto), 'blue')),
        ui.card({ title: 'Termos' }, ui.kv([['Cedente', F.orgCell(ced)], ['Financiador', fin ? F.orgCell(fin) : 'Em leilão (anônimo fora da Mesa)'], ['Valor de face', fmt.brl(op.face)], ['Taxa final', op.taxaFinal ? fmt.taxa(op.taxaFinal) : '—'], ['Líquido', op.liquido ? fmt.brl(op.liquido) : '—'], ['TS', op.ts !== undefined ? `${fmt.brl(op.ts)} (${op.tsPct}% do spread)` : '—'], ['Pagamento até', op.pagamentoLimite ? fmt.datetime(op.pagamentoLimite) : '—'], ['Títulos', `${op.nTitulos} · prazo médio de ${op.prazoMedio || '—'} dias`]], { cols: 2 })),
        opLances(op, true), opContrato(op), opLiquidacao(op), opTrilha(op),
        ui.btn('Abrir empresa do cedente', { variant: 'secondary', icon: 'building-2', onclick: () => C.router.go('/ops/empresas/' + op.cedenteId) })) });
  }

  /* ========================= /ops/faturamento =========================== */
  function competencias() {
    const set = new Set(db.all('faturas').map((f) => f.competencia).concat(db.all('premiacoes').map((p) => p.competencia)));
    const t = C.cal.sp(now());
    for (let i = 0; i < 4; i++) { let m = t.m - i; let y = t.y; while (m < 1) { m += 12; y--; } set.add(y + '-' + String(m).padStart(2, '0')); }
    return [...set].sort().reverse();
  }
  function compRange(comp) {
    const [y, m] = comp.split('-').map(Number);
    return [C.cal.spTs(y, m, 1, 0, 0), C.cal.spTs(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0)];
  }

  function pgFaturamento(ctx) {
    const comps = competencias();
    let comp = (ctx.query.comp && comps.includes(ctx.query.comp)) ? ctx.query.comp : comps[0];
    let aba = 'faturas';
    const corpo = h('div'); const prev = h('div');
    const sel = ui.select({ options: comps.map((c) => ({ value: c, label: fmt.monthLong(c) })), value: comp, aria: 'Competência', onChange: (v) => { comp = v; draw(); } });
    const abas = ui.tabs({ value: aba, items: [{ id: 'faturas', label: 'Faturas de TS' }, { id: 'premios', label: 'Premiações' }, { id: 'receita', label: 'Receita' }], onChange: (v) => { aba = v; draw(); } });
    function draw() {
      C.mount(prev, previewApuracao(comp));
      C.mount(corpo, aba === 'faturas' ? fatFaturas(comp) : aba === 'premios' ? fatPremios(comp) : fatReceita());
    }
    ctx.onCleanup(C.store.on(['faturas', 'premiacoes', 'operacoes'], () => { if (corpo.isConnected) draw(); }));
    draw();
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · financeiro', title: 'Faturamento e premiações', subtitle: 'A TS do financiador e a premiação do originador, apuradas por competência.',
        actions: [ui.btn('Rodar apuração', Object.assign({ variant: 'primary', icon: 'calculator', onclick: () => rodarApuracao(comp) }, permBtn('ops.faturar')))] }),
      ui.card({ title: 'Fechamento mensal', subtitle: 'A apuração é idempotente: meses já apurados não geram duplicatas.' },
        h('div.stack.tight', h('div.op2-comp', h('span.small.muted', 'Competência'), sel), prev, h('small.muted', `Relatório no 5º dia útil, contestação em 10 dias, pagamento no dia 20, mínimo de ${fmt.brl(100)}.`))),
      abas, corpo);
  }

  function previewApuracao(comp) {
    const [ini, fim] = compRange(comp);
    const ops = db.where('operacoes', (o) => o.pagoEm && o.pagoEm >= ini && o.pagoEm < fim);
    if (!ops.length) return h('p.muted', 'Nenhuma operação paga nesta competência. A apuração não cria faturas nem premiações.');
    const fins = new Set(ops.map((o) => o.financiadorId)).size;
    return h('div.row', ui.badge(fmt.plural(ops.length, 'operação paga', 'operações pagas'), 'blue'), ui.badge('TS total de ' + fmt.brl(C.round2(C.sum(ops, (o) => o.ts))), 'teal'), ui.badge(fmt.plural(fins, 'financiador', 'financiadores'), 'neutral'));
  }

  async function rodarApuracao(comp) {
    if (!need('ops.faturar')) return;
    const okc = await ui.confirm({ title: 'Rodar a apuração de ' + fmt.monthLong(comp) + '?', icon: 'calculator',
      text: 'Gera as faturas de TS e Taxa de Acesso por financiador e as premiações por originador. Meses já apurados são ignorados.', confirmLabel: 'Apurar competência' });
    if (!okc) return;
    const r = E.fecharMes(comp, { userId: session.get().userId });
    if (!r.ok) { ui.toast('A apuração falhou', { type: 'error', text: r.erro }); return; }
    if (!r.faturas && !r.premiacoes) { ui.toast('Nada a gerar', { type: 'info', text: `${fmt.monthLong(comp)} já foi apurado ou não tem operações pagas.` }); return; }
    ui.toast('Competência apurada', { type: 'success', text: `${fmt.monthLong(comp)}: ${fmt.plural(r.faturas, 'fatura', 'faturas')} e ${fmt.plural(r.premiacoes, 'premiação', 'premiações')}.` });
  }

  function fatFaturas(comp) {
    const fats = db.where('faturas', (x) => x.competencia === comp).sort((a, b) => b.total - a.total);
    const inad = fats.filter((x) => x.status === 'vencida');
    const tot = Math.max(1, C.sum(fats, (x) => x.total));
    const k = kpis(
      ui.kpi({ label: 'TS apurada', display: fmt.brl(C.sum(fats, (x) => x.tsTotal), { round: true }), icon: 'percent', tone: 'teal' }),
      ui.kpi({ label: 'Taxa de Acesso', display: fmt.brl(C.sum(fats, (x) => x.taxaAcesso), { round: true }), icon: 'receipt', tone: 'blue' }),
      ui.kpi({ label: 'Total faturado', display: fmt.brl(C.sum(fats, (x) => x.total), { round: true }), icon: 'banknote', tone: 'green' }),
      ui.kpi({ label: 'Inadimplência', display: fats.length ? fmt.pct((C.sum(inad, (x) => x.total) / tot) * 100, 1) : '—', icon: 'triangle-alert', tone: inad.length ? 'red' : 'green', hint: inad.length ? fmt.plural(inad.length, 'fatura vencida', 'faturas vencidas') : 'nada vencido' }));
    if (!fats.length) return h('div.stack', k, ui.empty({ icon: 'receipt', title: 'Sem faturas nesta competência', text: 'Rode a apuração para gerar as faturas de TS e Taxa de Acesso.' }));
    const exportar = ui.btn('Exportar CSV', { variant: 'secondary', size: 'sm', icon: 'download', onclick: () => {
      download('faturas-' + comp + '.csv', ['financiador,competencia,ts,acesso,total,vencimento,situacao'].concat(fats.map((x) => [csvCell(orgName(x.finId)), x.competencia, x.tsTotal, x.taxaAcesso, x.total, isoDay(x.vencimento), x.status].join(','))).join('\n'), 'text/csv;charset=utf-8');
      ui.toast('Exportação pronta', { type: 'success', text: fmt.plural(fats.length, 'fatura', 'faturas') + ' em CSV.' });
    } });
    return h('div.stack', k, h('div.stack.tight', h('div.row.between', h('span.small.muted', `${fmt.plural(fats.length, 'fatura emitida', 'faturas emitidas')} em ${fmt.monthLong(comp)}`), exportar),
      ui.table({ rows: fats, rowKey: (r) => r.id,
        columns: [
          { key: 'fin', label: 'Financiador', mobile: 'primary', render: (x) => F.orgCell(db.get('orgs', x.finId)) },
          { key: 'ts', label: 'TS', align: 'right', render: (x) => h('span.num', fmt.brl(x.tsTotal)) },
          { key: 'ac', label: 'Acesso', align: 'right', mobile: 'hide', render: (x) => (x.taxaAcesso ? h('span.num', fmt.brl(x.taxaAcesso)) : h('small.muted', x.taxaAcessoMotivo || 'isenta')) },
          { key: 'tot', label: 'Total', align: 'right', render: (x) => h('strong.num', fmt.brl(x.total)) },
          { key: 'venc', label: 'Vencimento', mobile: 'hide', render: (x) => h('span.nowrap', fmt.date(x.vencimento)) },
          { key: 'st', label: 'Situação', render: (x) => ui.status('fatura', x.status) },
          { key: 'ac2', label: '', render: (x) => ui.moreMenu(faturaMenu(x), { label: 'Ações da fatura ' + x.id }) },
        ] })));
  }

  function faturaMenu(x) {
    const itens = [];
    const sem = !C.can('ops.faturar');
    const dica = sem ? C.cannotMsg('ops.faturar') : null;
    if (x.status !== 'paga' && x.status !== 'isenta') itens.push({ label: 'Marcar como paga', icon: 'circle-check', disabled: sem, hint: dica, onclick: () => faturaPagar(x) });
    if (x.status !== 'isenta') {
      itens.push({ label: 'Reenviar boleto', icon: 'send', disabled: sem, hint: dica, onclick: () => { if (!need('ops.faturar')) return; notify.send({ to: { orgId: x.finId }, tipo: 'info', titulo: 'Boleto reenviado: ' + fmt.monthLong(x.competencia), corpo: `Total de ${fmt.brl(x.total)}, vencimento em ${fmt.date(x.vencimento)}.`, link: '/financiador/faturamento' }); ui.toast('Boleto reenviado', { type: 'success', text: orgName(x.finId) }); } });
      itens.push({ label: 'Isentar com motivo', icon: 'ban', disabled: sem, hint: dica, onclick: () => faturaIsentar(x) });
    }
    itens.push({ label: 'Ver financiador', icon: 'building-2', onclick: () => C.router.go('/ops/empresas/' + x.finId) });
    return itens;
  }
  function faturaPagar(x) {
    if (!need('ops.faturar')) return;
    db.patch('faturas', x.id, { status: 'paga', pagaEm: now() });
    ledger.append({ actor: me(), acao: 'fatura.paga', entidade: { kind: 'fatura', id: x.id }, resumo: `Mesa registrou o pagamento da fatura ${x.id} (${fmt.brl(x.total)})`, classe: 'R2' });
    notify.send({ to: { orgId: x.finId }, tipo: 'sucesso', titulo: 'Pagamento de fatura confirmado', corpo: `${fmt.monthLong(x.competencia)} · ${fmt.brl(x.total)}`, link: '/financiador/faturamento' });
    ui.toast('Fatura marcada como paga', { type: 'success', text: x.id });
  }
  async function faturaIsentar(x) {
    if (!need('ops.faturar')) return;
    const motivo = await motivoModal('Isentar a fatura ' + x.id, 'Motivo da isenção');
    if (!motivo) return;
    await Ops.solicitarOuAplicar({
      tipo: 'fatura_isentar', titulo: `Isentar a fatura ${x.id} (${fmt.brl(x.total)})`,
      resumo: `Isentar a fatura ${x.id} de ${orgName(x.finId)}, competência ${fmt.monthLong(x.competencia)}: ${motivo}`,
      payload: { faturaId: x.id, motivo }, antes: { status: ui.statusLabel('fatura', x.status) }, depois: { status: 'Isenta' },
      entidade: { kind: 'fatura', id: x.id }, acaoDireto: 'fatura.aplicado_direto',
      resumoDireto: `Mesa isentou a fatura ${x.id} com aplicação direta: ${motivo}`,
      aplicar: (mot) => {
        db.patch('faturas', x.id, { status: 'isenta', motivoIsencao: mot, isentaMotivo: mot, isentaEm: now() });
        ledger.append({ actor: me(), acao: 'fatura.isenta', entidade: { kind: 'fatura', id: x.id }, resumo: `Mesa isentou a fatura ${x.id}: ${mot}`, classe: 'R2', detalhe: { motivo: mot } });
        notify.send({ to: { orgId: x.finId }, tipo: 'info', titulo: 'Fatura isenta', corpo: `${fmt.monthLong(x.competencia)}: ${mot}`, link: '/financiador/faturamento' });
        ui.toast('Fatura isenta', { type: 'success', text: x.id });
      },
      motivoFixo: motivo,
    });
  }

  function fatPremios(comp) {
    const prs = db.where('premiacoes', (p) => p.competencia === comp).sort((a, b) => b.total - a.total);
    const regras = ui.callout({ tone: 'info', title: 'Regras da premiação', text: `10% de indicação por 24 meses desde a 1ª operação paga e 30% de gestão com cedente ativo (1 operação em 90 dias). Relatório no 5º dia útil, contestação em até 10 dias, mínimo de ${fmt.brl(100)} para pagar, pagamento no dia 20.` });
    if (!prs.length) return h('div.stack', regras, ui.empty({ icon: 'award', title: 'Sem premiações nesta competência', text: 'Rode a apuração para gerar as premiações dos originadores.' }));
    const exportar = ui.btn('Exportar CSV', { variant: 'secondary', size: 'sm', icon: 'download', onclick: () => {
      download('premiacoes-' + comp + '.csv', ['originador,indicado,competencia,base_ts,indicacao,gestao,total,situacao'].concat(prs.map((p) => [csvCell(orgName(p.origId)), csvCell(orgName(p.cedenteId)), p.competencia, p.baseTS, p.indicacao, p.gestao, p.total, p.status].join(','))).join('\n'), 'text/csv;charset=utf-8');
      ui.toast('Exportação pronta', { type: 'success', text: fmt.plural(prs.length, 'premiação', 'premiações') + ' em CSV.' });
    } });
    return h('div.stack', regras, h('div.stack.tight', h('div.row.between', h('span.small.muted', `${fmt.plural(prs.length, 'premiação apurada', 'premiações apuradas')} em ${fmt.monthLong(comp)}`), exportar),
      ui.table({ rows: prs, rowKey: (r) => r.id,
        columns: [
          { key: 'orig', label: 'Originador', mobile: 'primary', render: (p) => h('div.cell-main', h('strong', orgName(p.origId)), h('small', 'indicado: ' + orgName(p.cedenteId))) },
          { key: 'base', label: 'Base de TS', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.baseTS)) },
          { key: 'ind', label: 'Indicação (10%)', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.indicacao)) },
          { key: 'ges', label: 'Gestão (30%)', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.gestao)) },
          { key: 'tot', label: 'Total', align: 'right', render: (p) => h('strong.num', fmt.brl(p.total)) },
          { key: 'st', label: 'Situação', render: (p) => ui.status('premio', p.status) },
          { key: 'ac', label: '', render: (p) => ui.moreMenu(premioMenu(p), { label: 'Ações da premiação' }) },
        ] })));
  }

  function premioMenu(p) {
    const itens = [];
    const sem = !C.can('ops.faturar');
    const dica = sem ? C.cannotMsg('ops.faturar') : null;
    if (p.status === 'em_contestacao') { const ct = db.where('contestacoes', (c) => c.premiacaoId === p.id && c.status !== 'resolvida')[0]; itens.push({ label: 'Resolver contestação', icon: 'scale', disabled: sem, hint: dica, onclick: () => resolverContestacao(p, ct) }); }
    if (['apurado'].includes(p.status) && p.total >= 100) itens.push({ label: 'Aprovar', icon: 'check', disabled: sem, hint: dica, onclick: () => premioAprovar(p) });
    if (p.status === 'aprovado') itens.push({ label: 'Marcar como paga', icon: 'banknote', disabled: sem, hint: dica, onclick: () => premioPagar(p) });
    itens.push({ label: 'Ver originador', icon: 'handshake', onclick: () => C.router.go('/ops/empresas/' + p.origId) });
    return itens;
  }
  function premioAprovar(p) {
    if (!need('ops.faturar')) return;
    db.patch('premiacoes', p.id, { status: 'aprovado', aprovadoEm: now(), aprovadoPor: me().nome });
    ledger.append({ actor: me(), acao: 'premiacao.aprovada', entidade: { kind: 'premiacao', id: p.id }, resumo: `Mesa aprovou a premiação de ${orgName(p.origId)} (${fmt.brl(p.total)}, competência ${p.competencia})`, classe: 'R2' });
    ui.toast('Premiação aprovada', { type: 'success', text: `${fmt.brl(p.total)} para ${orgName(p.origId)}` });
  }
  async function premioPagar(p) {
    if (!need('ops.faturar')) return;
    await Ops.solicitarOuAplicar({
      tipo: 'premiacao_pagar', titulo: `Pagar premiação de ${orgName(p.origId)} (${fmt.brl(p.total)})`,
      resumo: `Pagar ${fmt.brl(p.total)} a ${orgName(p.origId)}, competência ${fmt.monthLong(p.competencia)}. O pagamento sai no dia 20.`,
      payload: { ids: [p.id] }, antes: { status: 'Aprovada' }, depois: { status: 'Paga' },
      entidade: { kind: 'premiacao', id: p.id }, acaoDireto: 'premiacao.aplicado_direto',
      resumoDireto: `Mesa pagou ${fmt.brl(p.total)} a ${orgName(p.origId)} (competência ${p.competencia}) com aplicação direta`,
      aplicar: (motivo) => {
        db.patch('premiacoes', p.id, { status: 'pago', pagoEm: now() });
        ledger.append({ actor: me(), acao: 'premiacao.paga', entidade: { kind: 'premiacao', id: p.id }, resumo: `Mesa pagou ${fmt.brl(p.total)} a ${orgName(p.origId)} (competência ${p.competencia})`, classe: 'R3', detalhe: { motivo } });
        notify.send({ to: { orgId: p.origId }, tipo: 'sucesso', titulo: 'Premiação paga', corpo: `${fmt.brl(p.total)} · competência ${p.competencia}`, link: '/originador/premiacao' });
        ui.toast('Premiação paga', { type: 'success', text: fmt.brl(p.total) });
      },
    });
  }
  async function resolverContestacao(p, ct) {
    if (!need('ops.faturar')) return;
    let decisao = null; let nota = null;
    const selDec = ui.field({ label: 'Decisão' }, (decisao = ui.select({ options: [{ value: 'manter', label: 'Manter os valores apurados' }, { value: 'ajustar', label: 'Ajustar e aprovar' }], value: 'manter', aria: 'Decisão da contestação' })));
    const campo = ui.field({ label: 'Nota da decisão', required: true }, (nota = ui.input({ type: 'textarea', placeholder: 'Ex.: a operação citada entrou na competência seguinte, os valores conferem' })));
    const m = Ops.modal({ title: 'Resolver contestação', subtitle: (ct ? ct.motivo : 'Sem detalhe da contestação') + ' · ' + orgName(p.origId), icon: 'scale', size: 'sm',
      body: h('div.stack.tight', selDec, campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Resolver', { variant: 'primary', onclick: () => {
        const n = String(nota.value).trim();
        if (!n) { campo.setError('Registre a nota da decisão.'); return; }
        db.batch(() => {
          if (ct) db.patch('contestacoes', ct.id, { status: 'resolvida', resolvidaEm: now(), decisao: decisao.value, nota: n });
          db.patch('premiacoes', p.id, { status: 'aprovado', aprovadoEm: now(), aprovadoPor: me().nome });
          ledger.append({ actor: me(), acao: 'contestacao.resolvida', entidade: { kind: 'premiacao', id: p.id }, resumo: `Mesa resolveu a contestação de ${orgName(p.origId)} (${decisao.value === 'manter' ? 'valores mantidos' : 'valores ajustados'}): ${n}`, classe: 'R2', detalhe: { decisao: decisao.value, nota: n } });
          notify.send({ to: { orgId: p.origId }, tipo: 'sucesso', titulo: 'Contestação resolvida', corpo: n, link: '/originador/premiacao' });
        });
        ui.toast('Contestação resolvida', { type: 'success' });
        api.close(true);
      } })] });
    await m.promise;
  }

  function fatReceita() {
    const comps = competencias().slice().reverse();
    const porComp = comps.map((c) => { const fs = db.where('faturas', (x) => x.competencia === c); return { c, ts: C.sum(fs, (x) => x.tsTotal), acesso: C.sum(fs, (x) => x.taxaAcesso), total: C.sum(fs, (x) => x.total) }; }).filter((r) => r.total > 0);
    const take = porComp.map((r) => { const [ini, fim] = compRange(r.c); const v = C.sum(db.where('operacoes', (o) => o.pagoEm && o.pagoEm >= ini && o.pagoEm < fim), (o) => o.face); return { c: r.c, t: v ? r.ts / v : 0 }; });
    const porFin = db.all('orgs').filter((o) => o.kind === 'financiador').map((o) => ({ label: o.fantasia || o.nome, value: C.sum(db.all('faturas').filter((x) => x.finId === o.id), (x) => x.total), tone: 'teal' })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const rot = (c) => c.slice(5) + '/' + c.slice(2, 4);
    return h('div.stack',
      h('div.grid.g2',
        ui.card({ title: 'Receita por competência', subtitle: 'TS mais Taxa de Acesso' }, porComp.length ? ui.chart.bars({ categories: porComp.map((r) => rot(r.c)), series: [{ name: 'TS', tone: 'teal', data: porComp.map((r) => Math.round(r.ts)) }, { name: 'Acesso', tone: 'blue', data: porComp.map((r) => Math.round(r.acesso)) }], stacked: true, height: 220, format: (v) => fmt.brlCompact(v), tipFormat: (v) => fmt.brl(v) }) : h('p.muted', 'Sem receita apurada.')),
        ui.card({ title: 'Take rate', subtitle: 'TS sobre o volume antecipado, por competência' }, take.length ? ui.chart.bars({ categories: take.map((r) => rot(r.c)), series: [{ name: 'Take rate', tone: 'blue', data: take.map((r) => C.round2(r.t * 100)) }], height: 220, format: (v) => fmt.pct(v, 2), tipFormat: (v) => fmt.pct(v, 2) }) : h('p.muted', 'Sem dados.'))),
      ui.card({ title: 'Receita por financiador', subtitle: 'Acumulado de todas as competências' }, porFin.length ? ui.chart.hbars(porFin.slice(0, 8), { format: (v) => fmt.brlCompact(v) }) : h('p.muted', 'Sem dados.')));
  }

  /* ========================== /ops/programas ============================ */
  const INF = (fonte) => /INFERÊNCIA/.test(fonte || '');
  const LASTRO_OPTS = ['NF-e (XML)', 'Comprovante de entrega ou aceite', 'Confirmação do sacado', 'Boleto registrado', 'Contrato', 'Medição aprovada', 'CT-e (XML)', 'Comprovante de entrega'];

  function pgProgramas(ctx) {
    const prods = db.all('produtos').sort((a, b) => a.nome.localeCompare(b.nome));
    if (ctx.query.editar) setTimeout(() => { const p = db.get('produtos', ctx.query.editar); if (p && isAdmin()) programaEditor(p, ctx.query.ticketMin ? Number(ctx.query.ticketMin) : null); else if (p) programaDrawer(p); }, 80);
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · produto como dado', title: 'Programas de produto', subtitle: 'Cada mudança de parâmetro cria uma nova versão. As operações já publicadas mantêm a TS congelada no aceite; a nova versão vale para as operações novas.' }),
      ui.table({ rows: prods, rowKey: (r) => r.id,
        columns: [
          { key: 'n', label: 'Programa', mobile: 'primary', render: (p) => h('div.cell-main', h('strong', p.nome, ' ', ui.badge('v' + p.versao, 'blue')), h('small.op2-desc', p.desc)) },
          { key: 'vig', label: 'Vigente desde', mobile: 'hide', render: (p) => h('span.nowrap', fmt.date(p.vigenteDesde)) },
          { key: 'ticket', label: 'Ticket mínimo', align: 'right', render: (p) => h('span.num', fmt.brl(p.ticketMin, { round: true })) },
          { key: 'prazo', label: 'Prazo', mobile: 'hide', render: (p) => h('span.nowrap', p.prazoMin + ' a ' + p.prazoMax + ' dias') },
          { key: 'ts', label: 'TS', align: 'right', render: (p) => h('span.num', fmt.pct(p.tsPct, 0)) },
          { key: 'reg', label: 'Regresso', render: (p) => (p.permiteSemRegresso ? h('small.muted', 'opcional') : ui.badge('Exigido', 'teal', { dot: true })) },
          { key: 'sil', label: 'Sacado', mobile: 'hide', render: (p) => h('small.muted', p.silencioso ? 'silencioso' : 'notificado') },
          { key: 'inf', label: '', mobile: 'hide', render: (p) => (INF(p.fonte) ? ui.badge('Inferência', 'amber', { title: 'Parâmetro inferido na modelagem, ainda não validado' }) : null) },
        ], onRowClick: (p) => programaDrawer(p) }));
  }

  function progVersaoData(p, v) {
    if (v === p.versao) return { versao: p.versao, vigenteDesde: p.vigenteDesde, ticketMin: p.ticketMin, prazoMin: p.prazoMin, prazoMax: p.prazoMax, tsPct: p.tsPct, permiteSemRegresso: p.permiteSemRegresso, lastro: p.lastro, nota: 'Versão vigente' };
    const hx = (p.historico || []).find((x) => x.versao === v);
    return hx ? Object.assign({ ticketMin: p.ticketMin, prazoMin: p.prazoMin, prazoMax: p.prazoMax, permiteSemRegresso: p.permiteSemRegresso, lastro: p.lastro }, hx) : null;
  }

  function programaDrawer(p) {
    const vers = [p.versao].concat((p.historico || []).map((x) => x.versao)).sort((a, b) => b - a);
    let vA = vers[0]; let vB = vers[1] !== undefined ? vers[1] : vers[0];
    const diffBox = h('div');
    function drawDiff() {
      const a = progVersaoData(p, vA); const b = progVersaoData(p, vB);
      if (!a || !b) { C.mount(diffBox, h('p.muted', 'Selecione duas versões.')); return; }
      const chaves = [['ticketMin', 'Ticket mínimo', (v) => fmt.brl(v)], ['prazoMin', 'Prazo mínimo', (v) => v + ' dias'], ['prazoMax', 'Prazo máximo', (v) => v + ' dias'], ['tsPct', 'TS sobre o spread', (v) => fmt.pct(v, 0)], ['permiteSemRegresso', 'Sem regresso', (v) => (v ? 'permitido' : 'exigido')], ['vigenteDesde', 'Vigente desde', (v) => fmt.date(v)]];
      C.mount(diffBox, ui.table({ rows: chaves, rowKey: (r) => r[0], columns: [
        { key: 'k', label: 'Parâmetro', mobile: 'primary', render: (r) => r[1] },
        { key: 'a', label: 'v' + vA, render: (r) => h('span', { class: a[r[0]] !== b[r[0]] ? 'strong' : '' }, r[2](a[r[0]])) },
        { key: 'b', label: 'v' + vB, render: (r) => h('span', { class: a[r[0]] !== b[r[0]] ? 'strong' : '' }, r[2](b[r[0]])) },
        { key: 'd', label: '', render: (r) => (a[r[0]] !== b[r[0]] ? ui.badge('Mudou', 'amber', { dot: true }) : h('small.muted', 'igual')) },
      ] }));
    }
    const optsV = vers.map((v) => ({ value: String(v), label: 'Versão ' + v }));
    const selA = ui.select({ options: optsV, value: String(vA), aria: 'Primeira versão', onChange: (v) => { vA = Number(v); drawDiff(); } });
    const selB = ui.select({ options: optsV, value: String(vB), aria: 'Segunda versão', onChange: (v) => { vB = Number(v); drawDiff(); } });
    drawDiff();
    const corpo = h('div.stack',
      h('div.row', ui.badge('Versão ' + p.versao, 'blue'), h('small.muted', 'vigente desde ' + fmt.date(p.vigenteDesde))),
      h('p', p.desc),
      ui.card({ title: 'Parâmetros vigentes' }, ui.kv([['Ticket mínimo', fmt.brl(p.ticketMin)], ['Prazo', p.prazoMin + ' a ' + p.prazoMax + ' dias'], ['TS', fmt.pct(p.tsPct, 0) + ' do spread sobre a SELIC'], ['Regresso', p.permiteSemRegresso ? 'Sem regresso permitido' : 'Sempre com regresso'], ['Lastro exigido', (p.lastro || []).join(', ')], ['Sacado', p.silencioso ? 'Silencioso (não notificado)' : 'Notificado'], ['Fonte', String(p.fonte || '').replace(' [INFERÊNCIA]', '')]], { cols: 2 })),
      INF(p.fonte) ? ui.callout({ tone: 'warn', title: 'Parâmetros inferidos', text: 'Parte dos parâmetros deste programa foi inferida na modelagem do protótipo e ainda não foi validada. Revise antes de publicar.' }) : null,
      ui.card({ title: 'Comparar versões', actions: [selA, selB] }, diffBox),
      ui.card({ title: 'Histórico de versões' }, h('div.list', vers.map((v) => { const d = progVersaoData(p, v); return h('div.list-item', h('span.grow', h('strong', 'Versão ' + v), h('div.small.muted', (d && d.nota) || '')), h('small.muted', d ? fmt.date(d.vigenteDesde) : '')); }))));
    Ops.drawer({ title: p.nome, subtitle: 'Programa de produto versionado', icon: 'layers', size: 'lg', body: corpo,
      footer: (api) => (isAdmin() ? [ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Criar nova versão', { variant: 'primary', icon: 'pen-line', onclick: () => { api.close(); programaEditor(p); } })] : [h('small.muted', 'Somente a Mesa admin edita programas. O perfil operador vê os parâmetros.'), ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() })]) });
  }

  async function programaEditor(p, ticketSugerido) {
    if (!needAdmin()) return;
    let ticket = null; let pmin = null; let pmax = null; let ts = null; let semReg = null; let lastro = null; let desc = null; let vig = null;
    const fTicket = ui.field({ label: 'Ticket mínimo', hint: ticketSugerido ? 'Valor proposto pelo agente: ' + fmt.brl(ticketSugerido) + '.' : null }, (ticket = ui.currency({ value: ticketSugerido || p.ticketMin })));
    const fPmin = ui.field({ label: 'Prazo mínimo' }, (pmin = ui.numeric({ value: p.prazoMin, min: 1, max: 360, suffix: 'dias', decimals: 0 })));
    const fPmax = ui.field({ label: 'Prazo máximo' }, (pmax = ui.numeric({ value: p.prazoMax, min: 1, max: 720, suffix: 'dias', decimals: 0 })));
    const fTs = ui.field({ label: 'TS sobre o spread', hint: 'Entre 20% e 40% do spread sobre a SELIC.' }, (ts = ui.slider({ min: 20, max: 40, step: 1, value: p.tsPct, format: (v) => fmt.pct(v, 0), aria: 'TS sobre o spread' })));
    const fReg = ui.field({ label: 'Regresso' }, (semReg = ui.switch({ checked: !!p.permiteSemRegresso, label: 'Permitir operação sem regresso', hint: 'Programas com lastro frágil costumam exigir regresso.' })));
    const fLastro = ui.field({ label: 'Lastro exigido' }, (lastro = ui.chips({ value: p.lastro || [], options: LASTRO_OPTS.map((l) => ({ value: l, label: l })), aria: 'Lastro exigido' })));
    const fDesc = ui.field({ label: 'Descrição' }, (desc = ui.input({ type: 'textarea', value: p.desc })));
    const padraoVig = C.cal.nextUtil(now(), 0, 0);
    const fVig = ui.field({ label: 'Vigente desde', hint: 'Padrão: próximo dia útil, às 0h.' }, (vig = ui.date({ value: padraoVig, aria: 'Vigente desde' })));
    const direto = C.can('ops.config.aplicar');
    const m = Ops.modal({ title: 'Nova versão de ' + p.nome, subtitle: `A v${p.versao} continua valendo para as operações já publicadas`, icon: 'layers', size: 'lg',
      body: h('div.op2-form', fTicket, h('div.grid.g2', fPmin, fPmax), fTs, fReg, fLastro, fDesc, fVig),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn(direto ? 'Criar versão ' + (p.versao + 1) : 'Solicitar versão ' + (p.versao + 1), { variant: 'primary', icon: 'plus', onclick: () => {
        fTicket.setError(''); fPmin.setError('');
        if (!ticket.value || ticket.value < 100) { fTicket.setError('Informe um ticket mínimo de ao menos R$ 100,00.'); return; }
        if (pmin.value === null || pmax.value === null || pmin.value < 1 || pmax.value <= pmin.value) { fPmin.setError('O prazo mínimo deve ser menor que o máximo.'); return; }
        if (!lastro.value.length) { fLastro.setError('Escolha ao menos um tipo de lastro.'); return; }
        const novo = { ticketMin: Math.round(ticket.value), prazoMin: Math.round(pmin.value), prazoMax: Math.round(pmax.value), tsPct: ts.value, permiteSemRegresso: !!semReg.value, lastro: lastro.value, desc: String(desc.value) };
        const vigTs = vig.value || padraoVig;
        const anterior = { versao: p.versao, vigenteDesde: p.vigenteDesde, ticketMin: p.ticketMin, prazoMin: p.prazoMin, prazoMax: p.prazoMax, tsPct: p.tsPct, permiteSemRegresso: p.permiteSemRegresso, lastro: p.lastro, nota: 'Substituída pela v' + (p.versao + 1) };
        const chaves = [['ticketMin', 'Ticket mínimo', (v) => fmt.brl(v)], ['prazoMin', 'Prazo mínimo', (v) => v + ' dias'], ['prazoMax', 'Prazo máximo', (v) => v + ' dias'], ['tsPct', 'TS sobre o spread', (v) => fmt.pct(v, 0)], ['permiteSemRegresso', 'Sem regresso', (v) => (v ? 'permitido' : 'exigido')]];
        const mudou = (k) => JSON.stringify(novo[k]) !== JSON.stringify(p[k]);
        if (!Object.keys(novo).some((k) => JSON.stringify(novo[k]) !== JSON.stringify(k === 'desc' ? p.desc : p[k]))) { ui.toast('Nada mudou', { type: 'warn', text: 'Altere ao menos um parâmetro para criar uma versão.' }); return; }
        const nv = p.versao + 1;
        const produtoNovo = Object.assign({}, p, novo, { versao: nv, vigenteDesde: vigTs, historico: [anterior].concat(p.historico || []) });
        const antes = {}; const depois = {};
        chaves.filter((c) => mudou(c[0])).forEach((c) => { antes[c[1]] = c[2](p[c[0]]); depois[c[1]] = c[2](novo[c[0]]); });
        api.close(true);
        Ops.solicitarOuAplicar({
          tipo: 'programa', titulo: `${p.nome}: criar a versão ${nv}`,
          resumo: `${p.nome} v${nv} vigente desde ${fmt.date(vigTs)}: ${chaves.filter((c) => mudou(c[0])).map((c) => c[1]).join(', ')}.`,
          payload: { produto: produtoNovo }, antes, depois,
          entidade: { kind: 'produto', id: p.id }, acaoDireto: 'programa.aplicado_direto',
          resumoDireto: `${p.nome}: versão ${nv} criada com aplicação direta, vigente desde ${fmt.date(vigTs)}`,
          aplicar: (motivo) => {
            const mudancas = chaves.filter((c) => mudou(c[0])).map((c) => `${c[0]}: ${JSON.stringify(p[c[0]])} para ${JSON.stringify(novo[c[0]])}`);
            db.batch(() => {
              db.patch('produtos', p.id, produtoNovo);
              ledger.append({ actor: me(), acao: 'programa.versao_criada', entidade: { kind: 'produto', id: p.id }, resumo: `${p.nome}: versão ${nv} vigente desde ${fmt.date(vigTs)} (${motivo})`, classe: 'R2', detalhe: { mudancas, motivo } });
              db.where('propostas', (x) => x.status === 'pendente' && x.tipo === 'ajustar_politica' && x.entidade.id === p.id).forEach((x) => db.patch('propostas', x.id, { status: 'aprovada', decididoPor: me().nome, decididoEm: now() }));
            });
            ui.toast('Versão criada', { type: 'success', text: `${p.nome} v${nv} vigente desde ${fmt.date(vigTs)}.` });
            C.router.go('/ops/programas');
          },
        });
      } })] });
    await m.promise;
  }

  /* ========================= /ops/plataforma ============================= */
  const ROTULO_CFG = { selicAa: 'SELIC ao ano', passoMinLance: 'Passo mínimo de lance', firmezaHoras: 'Firmeza da oferta (h)', validadePadraoH: 'Validade padrão (h)', cutoffAceite: 'Corte de aceite', cutoffPagamento: 'Corte de pagamento', horarioValidacao: 'Janela de validação', slaValidacaoH: 'SLA de validação (h)', slaPrimeiraOpH: 'SLA da primeira operação (h)', repasseDiasUteis: 'Repasse (dias úteis)', taxaAcessoMensal: 'Taxa de Acesso', carenciaMeses: 'Carência (meses)', tsPiso: 'Piso de TS', tsPisoPctAm: 'Piso de TS (% a.m.)', premiacaoJanelaMeses: 'Janela de premiação (meses)', inatividadeDias: 'Inatividade (dias)', premiacaoMinima: 'Mínimo para pagar premiação', tarifaDesistenciaPctAm: 'Desistência (% a.m.)', conciliacao: 'SLAs da conciliação', premiacaoIndicacao: 'Indicação', premiacaoGestao: 'Gestão', mesaSimulada: 'Mesa simulada', mercado: 'Mercado simulado' };
  const UNID_CFG = { selicAa: ' % a.a.', passoMinLance: ' % a.m.', tsPisoPctAm: ' % a.m.', tarifaDesistenciaPctAm: ' % a.m.', firmezaHoras: ' h', validadePadraoH: ' h', slaValidacaoH: ' h úteis', slaPrimeiraOpH: ' h úteis', repasseDiasUteis: ' dias úteis', carenciaMeses: ' meses', premiacaoJanelaMeses: ' meses', inatividadeDias: ' dias' };
  const valCfg = (k, v) => (v === undefined || v === null ? '—' : k === 'horarioValidacao' ? `${v.ini}h às ${v.fim}h` : k === 'conciliacao' ? `${v.slaH}h, empate ${v.slaEmpateH}h` : /^premiacao(Indicacao|Gestao)$/.test(k) ? fmt.pct(v * 100, 0) : typeof v === 'boolean' ? (v ? 'ligada' : 'desligada') : /taxaAcessoMensal|tsPiso$|premiacaoMinima/.test(k) ? fmt.brl(v) : String(v).replace('.', ',') + (UNID_CFG[k] || ''));

  function timeField(label, valor, onChange, disabled) {
    const partes = String(valor).split(':'); let hh = partes[0]; let mm = partes[1] || '00';
    const horas = Array.from({ length: 24 }, (_, i) => ({ value: String(i).padStart(2, '0'), label: String(i).padStart(2, '0') + 'h' }));
    const mins = ['00', '15', '30', '45'].map((x) => ({ value: x, label: x + ' min' }));
    return ui.field({ label }, h('div.op2-time',
      ui.select({ options: horas, value: hh, disabled: !!disabled, aria: label + ', hora', onChange: (v) => { hh = v; onChange(hh + ':' + mm); } }),
      ui.select({ options: mins, value: mins.some((x) => x.value === mm) ? mm : '00', disabled: !!disabled, aria: label + ', minuto', onChange: (v) => { mm = v; onChange(hh + ':' + mm); } })));
  }

  function pgPlataforma() {
    const cfg = db.cfg();
    const draft = {
      selicAa: cfg.selicAa, passoMinLance: cfg.passoMinLance, firmezaHoras: cfg.firmezaHoras, validadePadraoH: cfg.validadePadraoH || 24,
      horarioIni: cfg.horarioValidacao.ini, horarioFim: cfg.horarioValidacao.fim, cutoffAceite: cfg.cutoffAceite, cutoffPagamento: cfg.cutoffPagamento,
      slaValidacaoH: cfg.slaValidacaoH, slaPrimeiraOpH: cfg.slaPrimeiraOpH, slaConcH: cfg.conciliacao.slaH, slaEmpateH: cfg.conciliacao.slaEmpateH, repasseDiasUteis: cfg.repasseDiasUteis,
      taxaAcessoMensal: cfg.taxaAcessoMensal, carenciaMeses: cfg.carenciaMeses, tsPiso: cfg.tsPiso, tsPisoPctAm: cfg.tsPisoPctAm, tarifaDesistencia: cfg.tarifaDesistenciaPctAm,
      premiacaoIndicacao: Math.round(cfg.premiacaoIndicacao * 100), premiacaoGestao: Math.round(cfg.premiacaoGestao * 100), premiacaoJanelaMeses: cfg.premiacaoJanelaMeses, inatividadeDias: cfg.inatividadeDias, premiacaoMinima: cfg.premiacaoMinima,
      mesaSimulada: cfg.mesaSimulada,
    };
    const ro = !isAdmin();
    const dica = (o) => (o && o.hint) || null;
    const num = (label, chave, o = {}) => {
      const c = ui.numeric({ value: draft[chave], suffix: o.suffix, min: o.min, max: o.max, decimals: o.dec, disabled: ro, aria: label });
      c.addEventListener('change', () => { draft[chave] = c.value; });
      return ui.field({ label, hint: dica(o) }, c);
    };
    const din = (label, chave, o = {}) => {
      const c = ui.currency({ value: draft[chave], disabled: ro, aria: label });
      c.addEventListener('change', () => { draft[chave] = c.value; });
      return ui.field({ label, hint: dica(o) }, c);
    };
    const secao = (titulo, subtitulo, corpo) => ui.card({ title: titulo, subtitle: subtitulo }, corpo);
    const mercado = { on: C.store.prefs.market };
    const corpo = h('div.stack',
      ro ? ui.callout({ tone: 'warn', title: 'Somente leitura', text: 'O perfil operador vê os parâmetros. As mudanças são feitas pela Mesa admin (Juliana Prado).' }) : null,
      secao('Parâmetros de mercado', 'Entram no cálculo de preço e do leilão',
        h('div.op2-grid', num('SELIC ao ano', 'selicAa', { suffix: '% a.a.', min: 0, max: 60, hint: 'Muda o spread e a TS simulada na hora.' }), num('Passo mínimo de lance', 'passoMinLance', { suffix: '% a.m.', min: 0.01, hint: 'O leilão reverso só aceita lance menor que o melhor menos este passo.' }), num('Firmeza da oferta', 'firmezaHoras', { suffix: 'horas', min: 1, max: 72, hint: 'Uma oferta firme só pode ser retirada depois deste prazo.' }), num('Validade padrão', 'validadePadraoH', { suffix: 'horas', min: 1, max: 168, hint: 'Sugestão de validade na publicação. [INFERÊNCIA]' }))),
      secao('Janelas e cortes', 'Horário de validação e cortes de aceite e de pagamento',
        h('div.op2-grid', timeField('Início da validação', String(draft.horarioIni).padStart(2, '0') + ':00', (v) => { draft.horarioIni = Number(v.split(':')[0]); }, ro), timeField('Fim da validação', String(draft.horarioFim).padStart(2, '0') + ':00', (v) => { draft.horarioFim = Number(v.split(':')[0]); }, ro),
          timeField('Corte de aceite', draft.cutoffAceite, (v) => { draft.cutoffAceite = v; }, ro), timeField('Corte de pagamento', draft.cutoffPagamento, (v) => { draft.cutoffPagamento = v; }, ro))),
      secao('SLAs', 'Metas de atendimento da Mesa',
        h('div.op2-grid', num('Validação de lote', 'slaValidacaoH', { suffix: 'h úteis', min: 1 }), num('Primeira operação', 'slaPrimeiraOpH', { suffix: 'h úteis', min: 1 }), num('Conciliação', 'slaConcH', { suffix: 'horas', min: 1 }), num('Conciliação com empate', 'slaEmpateH', { suffix: 'horas', min: 1 }), num('Repasse ao financiador', 'repasseDiasUteis', { suffix: 'dias úteis', min: 0, max: 5 }))),
      secao('Tarifas e premiação', 'Valores cobrados e pagos pela plataforma',
        h('div.stack.tight',
          h('div.op2-grid', din('Taxa de Acesso (por mês)', 'taxaAcessoMensal'), num('Carência da Taxa de Acesso', 'carenciaMeses', { suffix: 'meses', min: 0 }), din('Piso de TS', 'tsPiso'), num('Piso de TS sobre o valor', 'tsPisoPctAm', { suffix: '% a.m.', min: 0 }), num('Tarifa de desistência', 'tarifaDesistencia', { suffix: '% a.m.', min: 0, hint: '[INFERÊNCIA] Multa de 2% mais mora de 1% a.m. pro rata no regresso.' })),
          h('div.op2-grid', num('Premiação de indicação', 'premiacaoIndicacao', { suffix: '% da TS', min: 0, max: 100 }), num('Premiação de gestão', 'premiacaoGestao', { suffix: '% da TS', min: 0, max: 100 }), num('Janela da indicação', 'premiacaoJanelaMeses', { suffix: 'meses', min: 1 }), num('Inatividade do cedente', 'inatividadeDias', { suffix: 'dias', min: 1 }), din('Mínimo para pagar', 'premiacaoMinima')),
          ui.callout({ tone: 'info', text: 'Reajuste anual pelo IPCA todo dia 1º de janeiro. A Taxa de Acesso é isenta no mês com 1 ou mais operações pagas.' }))),
      secao('Calendário de feriados', 'Dias sem expediente para cortes, repasses e SLAs', feriadosSecao(ro)),
      secao('Mesa e mercado simulado', 'Interruptores de demonstração',
        h('div.stack.tight',
          ui.switch({ checked: draft.mesaSimulada, disabled: ro, label: 'Mesa de Operações simulada', hint: 'Aprova lotes sem erro ao fim do SLA se ninguém decidir antes.', onChange: (v) => { draft.mesaSimulada = v; } }),
          ui.switch({ checked: mercado.on, disabled: ro, label: 'Mercado simulado dando lances', hint: 'Outros financiadores cobrem as ofertas abertas.', onChange: (v) => { mercado.on = v; } }))),
      secao('Usuários internos e permissões', 'Quem opera a Mesa e o que cada perfil pode fazer', usuariosSecao()),
      secao('Retenção de dados', 'Prazos de guarda (referência)', ui.kv([['Trilha e eventos', '90 dias'], ['Acesso e auditoria', '6 meses']])));

    function salvar() {
      if (!needAdmin()) return;
      const antes = db.cfg();
      const vazio = Object.keys(draft).find((k) => draft[k] === null || Number.isNaN(draft[k]));
      if (vazio) { ui.toast('Há campos vazios', { type: 'error', text: 'Preencha todos os parâmetros numéricos antes de salvar.' }); return; }
      if (draft.horarioFim <= draft.horarioIni) { ui.toast('Janela inválida', { type: 'error', text: 'O fim da validação deve ser depois do início.' }); return; }
      const patch = {};
      ['selicAa', 'passoMinLance', 'firmezaHoras', 'cutoffAceite', 'cutoffPagamento', 'slaValidacaoH', 'slaPrimeiraOpH', 'repasseDiasUteis', 'taxaAcessoMensal', 'carenciaMeses', 'tsPiso', 'tsPisoPctAm', 'premiacaoJanelaMeses', 'inatividadeDias', 'premiacaoMinima', 'mesaSimulada'].forEach((k) => { if (draft[k] !== antes[k]) patch[k] = draft[k]; });
      if (draft.validadePadraoH !== (antes.validadePadraoH || 24)) patch.validadePadraoH = draft.validadePadraoH;
      if (draft.horarioIni !== antes.horarioValidacao.ini || draft.horarioFim !== antes.horarioValidacao.fim) patch.horarioValidacao = { ini: draft.horarioIni, fim: draft.horarioFim };
      if (draft.tarifaDesistencia !== antes.tarifaDesistenciaPctAm) patch.tarifaDesistenciaPctAm = draft.tarifaDesistencia;
      if (draft.slaConcH !== antes.conciliacao.slaH || draft.slaEmpateH !== antes.conciliacao.slaEmpateH) patch.conciliacao = Object.assign({}, antes.conciliacao, { slaH: draft.slaConcH, slaEmpateH: draft.slaEmpateH });
      if (draft.premiacaoIndicacao / 100 !== antes.premiacaoIndicacao) patch.premiacaoIndicacao = draft.premiacaoIndicacao / 100;
      if (draft.premiacaoGestao / 100 !== antes.premiacaoGestao) patch.premiacaoGestao = draft.premiacaoGestao / 100;
      const mercadoMudou = mercado.on !== C.store.prefs.market;
      if (!Object.keys(patch).length && !mercadoMudou) { ui.toast('Nada para salvar', { type: 'info', text: 'Nenhum parâmetro mudou.' }); return; }
      const linhas = Object.keys(patch).map((k) => ({ k, rot: ROTULO_CFG[k] || k, a: valCfg(k, antes[k]), d: valCfg(k, patch[k]) }));
      if (mercadoMudou) linhas.push({ k: 'mercado', rot: ROTULO_CFG.mercado, a: valCfg('mercado', C.store.prefs.market), d: valCfg('mercado', mercado.on) });
      const nomes = linhas.map((l) => l.rot).join(', ');
      const antesObj = Object.fromEntries(linhas.map((l) => [l.rot, l.a]));
      const depoisObj = Object.fromEntries(linhas.map((l) => [l.rot, l.d]));
      if (mercadoMudou) {
        C.store.prefs.setMarket(mercado.on);
        if (!Object.keys(patch).length) {
          ui.toast('Mercado simulado atualizado', { type: 'success', text: 'Interruptor de demonstração aplicado na hora.' });
          return;
        }
      }
      Ops.solicitarOuAplicar({
        tipo: 'config', titulo: `Ajustar parâmetros da plataforma (${fmt.plural(linhas.length, 'mudança', 'mudanças')})`,
        resumo: `Mesa alterou ${fmt.plural(linhas.length, 'parâmetro', 'parâmetros')} da plataforma: ${nomes}.`,
        payload: { patch }, antes: antesObj, depois: depoisObj,
        entidade: { kind: 'plataforma', id: 'config' }, acaoDireto: 'config.aplicado_direto',
        resumoDireto: `Plataforma atualizada com aplicação direta: ${nomes}`,
        aplicar: (motivo) => {
          db.batch(() => {
            if (Object.keys(patch).length) db.setCfg(patch);
            ledger.append({ actor: me(), acao: 'config.alterada', entidade: { kind: 'plataforma', id: 'config' }, resumo: `Mesa alterou ${fmt.plural(linhas.length, 'parâmetro', 'parâmetros')} da plataforma: ${nomes} (${motivo})`, classe: 'R2', detalhe: { antes: antesObj, depois: depoisObj, motivo } });
          });
          ui.toast('Plataforma atualizada', { type: 'success', text: 'As mudanças valem agora e foram registradas na trilha (R2).' });
        },
        notaMercado: mercadoMudou ? 'O interruptor do mercado simulado é de demonstração e já entrou na hora, fora da aprovação.' : null,
      });
    }
    const direto = C.can('ops.config.aplicar');
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · plataforma', title: 'Configurações da plataforma', subtitle: 'Parâmetros de mercado, janelas, SLAs, tarifas, feriados e permissões. As mudanças entram na trilha como R2.',
        actions: ro ? [] : [ui.btn(direto ? 'Revisar e aplicar' : 'Revisar e solicitar', { variant: 'primary', icon: 'check', onclick: salvar })] }),
      corpo);
  }

  function feriadosSecao(ro) {
    const lista = h('div'); const grade = h('div');
    const fmtDia = (d) => d.slice(8) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
    function drawLista() {
      const dias = [...C.cal.FERIADOS].sort();
      C.mount(lista, h('div.op2-feriados',
        dias.length ? dias.map((d) => h('span.op2-fer', h('span.mono', fmtDia(d)), ro ? null : ui.iconBtn('x', { label: 'Remover o feriado de ' + fmtDia(d), size: 'sm', onclick: async () => {
          if (!needAdmin()) return;
          if (await ui.confirm({ title: 'Remover feriado?', text: `${fmtDia(d)} volta a ser dia útil para cortes e repasses.`, tone: 'danger', confirmLabel: 'Remover' })) { C.cal.FERIADOS.delete(d); drawLista(); drawGrade(); ui.toast('Feriado removido', { type: 'warn', text: fmtDia(d) }); }
        } }))) : h('p.muted', 'Nenhum feriado cadastrado.'),
        ro ? null : ui.btn('Adicionar feriado', { variant: 'secondary', size: 'sm', icon: 'plus', onclick: () => {
          if (!needAdmin()) return;
          let dia = null;
          const campo = ui.field({ label: 'Data do feriado' }, (dia = ui.date({ aria: 'Data do feriado' })));
          Ops.modal({ title: 'Adicionar feriado', icon: 'calendar', size: 'sm', body: campo,
            footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Adicionar', { variant: 'primary', onclick: () => {
              if (!dia.value) { campo.setError('Escolha a data.'); return; }
              const k = isoDay(dia.value);
              C.cal.FERIADOS.add(k); drawLista(); drawGrade(); ui.toast('Feriado adicionado', { type: 'success', text: fmtDia(k) }); api.close(true);
            } })] });
        } })));
    }
    function drawGrade() {
      const meses = []; const base = C.cal.sp(now());
      for (let i = -1; i <= 4; i++) { let m = base.m + i; let y = base.y; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } meses.push(y + '-' + String(m).padStart(2, '0')); }
      C.mount(grade, h('div.op2-meses', meses.map((mk) => {
        const [y, m] = mk.split('-').map(Number);
        const wd = C.cal.sp(C.cal.spTs(y, m, 1)).wd; const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const cels = [];
        for (let k = 0; k < wd; k++) cels.push(h('span'));
        for (let d = 1; d <= dias; d++) { const ts = C.cal.spTs(y, m, d); const util = C.cal.isUtil(ts); cels.push(h('span', { class: ['op2-dia', util && 'util'], title: fmt.date(ts) + (util ? ' (dia útil)' : ' (sem expediente)') }, d)); }
        return h('div.op2-mes', h('strong.small', C.cal.MES_LONGO[m - 1] + ' de ' + y), h('div.op2-grade', ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w) => h('span.op2-wd', w)), cels));
      })));
    }
    drawLista(); drawGrade();
    return h('div.stack.tight', lista, grade, h('small.muted', 'Dias úteis em verde. Alterar feriados muda cortes, repasses e SLAs na hora; a lista não persiste entre restaurações da demonstração.'));
  }

  function usuariosSecao() {
    const COLS = [['ops.lote', 'Lotes'], ['ops.conciliar', 'Conciliar'], ['ops.kyc', 'KYC'], ['ops.suspender', 'Suspender'], ['ops.agentes', 'Agentes'], ['ops.faturar', 'Faturar'], ['ops.verComo', 'Ver como'], ['ops.config.solicitar', 'Solicitar'], ['ops.config.aplicar', 'Aplicar']];
    const tem = (papeis, perm) => {
      if (papeis === 'super') return true;
      if (papeis === 'admin') return perm !== 'ops.verComo' && perm !== 'ops.config.aplicar';
      return (C.OPS_PAPEIS[papeis] || { perms: [] }).perms.includes(perm);
    };
    const linhas = [{ papel: 'super', nome: 'Superadmin', dica: 'Aplica direto, decide solicitações' }, { papel: 'admin', nome: 'Líder da Mesa (perfil admin)', dica: 'Todas as operacionais; pede alteração crítica' }, { papel: 'mesa' }, { papel: 'conciliadora' }, { papel: 'compliance' }, { papel: 'financeiro' }, { papel: 'suporte' }, { papel: 'auditor' }]
      .map((l) => l.nome ? l : Object.assign(l, { nome: (C.OPS_PAPEIS[l.papel] || {}).label || l.papel, dica: (C.OPS_PAPEIS[l.papel] || {}).desc || '' }));
    const internos = db.where('users', (u) => db.get('orgs', u.orgId) && db.get('orgs', u.orgId).kind === 'cedy');
    const papelDe = (u) => (u.perfil === 'superadmin' ? 'Superadmin' : (u.perfil === 'admin' ? (C.OPS_PAPEIS[u.papel] ? C.OPS_PAPEIS[u.papel].label + ' (líder)' : 'Líder') : (C.OPS_PAPEIS[u.papel] || {}).label || u.papel || '—'));
    return h('div.stack.tight',
      ui.callout({ tone: 'info', title: 'Quem pode o quê', text: 'O líder (perfil admin) tem todas as permissões operacionais. Mudança crítica (parâmetro, programa, autonomia, pagamento, isenção) só o Superadmin aplica; os demais pedem em Minhas solicitações.' }),
      ui.table({ rows: linhas, rowKey: (r) => r.papel, columns: [{ key: 'p', label: 'Papel', mobile: 'primary', render: (r) => h('div.cell-main', h('strong', r.nome), h('small', r.dica)) }].concat(COLS.map(([perm, rot]) => ({ key: perm, label: rot, align: 'center', mobile: 'hide', render: (r) => (tem(r.papel, perm) ? h('span.op2-yes', icon('check', 14)) : h('span.muted', '—')) })))}),
      h('h4.op2-sub', 'Equipe interna'),
      ui.table({ rows: internos, rowKey: (r) => r.id, columns: [
        { key: 'n', label: 'Pessoa', mobile: 'primary', render: (u) => h('div.cell-row', ui.avatar(u.nome, { size: 'sm', hue: u.hue }), h('div.cell-main', h('strong', u.nome), h('small', u.email))) },
        { key: 'p', label: 'Perfil', render: (u) => perfilBadge(u.perfil) },
        { key: 'papel', label: 'Papel', mobile: 'hide', render: (u) => h('small', papelDe(u)) },
        { key: '2fa', label: '2FA', render: twofaBadge },
      ] }));
  }

  /* ------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/ops/agentes', roles: ['ops'], title: 'Agentes e autonomia', render: pgAgentes },
    { path: '/ops/trilha', roles: ['ops'], title: 'Trilha de decisões', render: pgTrilha },
    { path: '/ops/empresas', roles: ['ops'], title: 'Empresas', render: pgEmpresas },
    { path: '/ops/empresas/:id', roles: ['ops'], title: (ctx) => { const o = db.get('orgs', ctx.params.id); return o ? (o.fantasia || o.nome) : 'Empresa'; }, render: pgEmpresa },
    { path: '/ops/faturamento', roles: ['ops'], title: 'Faturamento e premiações', render: pgFaturamento },
    { path: '/ops/programas', roles: ['ops'], title: 'Programas de produto', render: pgProgramas },
    { path: '/ops/plataforma', roles: ['ops'], title: 'Configurações da plataforma', render: pgPlataforma },
  ]);
})();
