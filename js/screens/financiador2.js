/* Cedy protótipo 0.1, telas do financiador (parte 2: carteira, detalhe, repasses, política, agente, faturamento, relatórios).
   Persona: Vértice Capital (Rafael Tavares, admin). Classic script, sem módulos. */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui, F = C.flows, E = C.engine;
  const { db, ledger, notify, session } = C.store;

  /* ------------------------------ helpers -------------------------------- */
  const me = () => (session.get() || {}).orgId;
  const ME_ST = ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial', 'liquidada', 'recomprada'];
  const OPEN_ST = ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'];
  const myOps = () => db.where('operacoes', (o) => o.financiadorId === me() && ME_ST.includes(o.status));
  const myOpen = () => db.where('operacoes', (o) => o.financiadorId === me() && OPEN_ST.includes(o.status));
  const tits = (op) => (op.tituloIds || []).map((id) => db.get('titulos', id)).filter(Boolean);
  const openTits = (op) => tits(op).filter((t) => !['liquidado', 'recomprado'].includes(t.status));
  const abertaDe = (op) => (['liquidada', 'recomprada'].includes(op.status) ? 0 : (op.saldoAberto !== undefined ? op.saldoAberto : op.face));
  const vencMin = (op) => { const v = openTits(op).map((t) => t.vencimento); return v.length ? Math.min(...v) : null; };
  const diasAtraso = (op) => { const v = vencMin(op); return v == null ? 0 : Math.max(0, C.cal.daysBetween(v, C.clock.now())); };
  const sacIds = (op) => [...new Set(tits(op).map((t) => t.sacadoId))];
  const sacNames = (op) => sacIds(op).map((id) => (db.get('orgs', id) || {}).fantasia || 'Sacado').join(', ');
  const opFinLink = (op) => (op.status === 'aberta' ? '#/financiador/vitrine/' + op.id : '#/financiador/operacoes/' + op.id);
  const canOp = () => C.can('operar');
  const noPerm = (perm) => h('small.muted', 'Somente leitura para o seu perfil (' + perm + ' negada).');

  /** Resultado econômico da operação: usa os valores congelados no aceite e o
      detalhamento do spread via E.simular com a taxa e o prazo da operação. */
  const econ = (op) => E.simular({ face: op.face, prazoDias: op.prazoMedio || 30, taxaAm: op.taxaFinal, produtoId: op.produto });

  function downloadCSV(name, header, rows) {
    const q = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const csv = '﻿' + header.map(q).join(';') + '\n' + rows.map((r) => r.map(q).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 600);
  }
  const copyText = async (txt, okMsg) => {
    try { await navigator.clipboard.writeText(txt); ui.toast(okMsg || 'Copiado', { type: 'success' }); }
    catch (e) {
      const ta = h('textarea', { value: txt, style: 'position:fixed;opacity:0' }); document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); ui.toast(okMsg || 'Copiado', { type: 'success' }); } catch (e2) { ui.toast('Não foi possível copiar', { type: 'error' }); }
      ta.remove();
    }
  };

  const grupoCarteira = (op) => (op.status === 'cessao' || op.status === 'aguardando_pagamento') ? 'assinar'
    : op.status === 'paga' ? 'vencer'
    : (op.status === 'vencida' || op.status === 'parcial') ? 'vencidas'
    : op.status === 'liquidada' ? 'liquidadas' : 'recompradas';
  /* Ordem padrão: operações ativas primeiro, depois por vencimento. */
  const PRIO_ST = { cessao: 0, aguardando_pagamento: 1, paga: 2, vencida: 3, parcial: 4, liquidada: 5, recomprada: 6 };
  const cmpCarteira = (a, b) => (PRIO_ST[a.status] - PRIO_ST[b.status]) || ((vencMin(a) === null ? Infinity : vencMin(a)) - (vencMin(b) === null ? Infinity : vencMin(b)));

  /* ============================ 1. CARTEIRA ============================ */
  function carteira() {
    const ops = myOps();
    const state = { grupo: 'todas', ced: '', sac: '', de: null, ate: null };
    const cedList = [...new Map(ops.map((o) => [o.cedenteId, db.get('orgs', o.cedenteId)])).values()].filter(Boolean);
    const sacMap = new Map();
    ops.forEach((o) => sacIds(o).forEach((id) => { if (!sacMap.has(id)) sacMap.set(id, db.get('orgs', id)); }));
    const sacList = [...sacMap.values()].filter(Boolean);

    /* Abertas primeiro (assinar, a vencer, vencidas), encerradas por último; desempate pelo vencimento. */
    const PRI = { cessao: 0, aguardando_pagamento: 1, paga: 2, vencida: 3, parcial: 4, liquidada: 5, recomprada: 6 };
    const porPrioridade = (a, b) => (PRI[a.status] ?? 9) - (PRI[b.status] ?? 9) || (vencMin(a) ?? Infinity) - (vencMin(b) ?? Infinity) || (a.id < b.id ? -1 : 1);

    const filtradas = (list) => (list || ops).filter((o) => {
      if (state.grupo !== 'todas' && grupoCarteira(o) !== state.grupo) return false;
      if (state.ced && o.cedenteId !== state.ced) return false;
      if (state.sac && !sacIds(o).includes(state.sac)) return false;
      const v = vencMin(o);
      if (state.de && (v == null || v < state.de)) return false;
      if (state.ate && (v == null || v > state.ate + 86399999)) return false;
      return true;
    }).sort(porPrioridade);

    const kpisDe = (list) => {
      const ab = list.filter((o) => OPEN_ST.includes(o.status));
      const face = C.round2(C.sum(ab, abertaDe));
      const v30 = C.round2(C.sum(ab.filter((o) => { const v = vencMin(o); return v != null && C.cal.daysBetween(C.clock.now(), v) <= 30; }), abertaDe));
      const venc = ab.filter((o) => diasAtraso(o) > 0);
      const vv = C.round2(C.sum(venc, abertaDe));
      const enc = list.filter((o) => ['liquidada', 'recomprada'].includes(o.status));
      const rb = C.round2(C.sum(enc, (o) => o.desagio || 0));
      const pm = face > 0 ? Math.round(C.sum(ab, (o) => (o.prazoMedio || 0) * abertaDe(o)) / face) : 0;
      return { ab, face, v30, venc, vv, rb, pm };
    };

    const tbl = ui.table({
      rows: filtradas(),
      rowKey: (r) => r.id,
      sortKey: 'st', sortDir: 'asc',
      empty: ui.empty({ icon: 'briefcase', title: 'Nenhuma operação aqui', text: 'Ajuste os filtros ou acompanhe a Vitrine para comprar novas operações.', action: ui.btn('Ver Vitrine', { variant: 'primary', icon: 'store', route: '/financiador/vitrine' }) }),
      columns: [
        { key: 'id', label: 'Operação', mobile: 'primary', render: (o) => h('a', { class: 'mono strong', href: opFinLink(o) }, o.id) },
        { key: 'ced', label: 'Cedente', render: (o) => F.orgCell(db.get('orgs', o.cedenteId), { size: 'sm' }) },
        { key: 'produto', label: 'Programa', mobile: 'hide', render: (o) => h('span.nowrap', F.prod(o.produto).replace('Cedy ', '')) },
        { key: 'face', label: 'Face', align: 'right', width: '118px', sort: true, render: (o) => h('span.num', fmt.brl(o.face, { round: true })) },
        { key: 'taxa', label: 'Taxa', align: 'right', width: '96px', mobile: 'hide', render: (o) => h('span.num', fmt.taxa(o.taxaFinal)) },
        { key: 'prazo', label: 'Prazo', align: 'right', width: '72px', mobile: 'hide', render: (o) => h('span.num', (o.prazoMedio || 0) + 'd') },
        { key: 'venc', label: 'Vencimento', width: '132px', sort: (a, b) => (vencMin(a) === null ? Infinity : vencMin(a)) - (vencMin(b) === null ? Infinity : vencMin(b)), render: (o) => { const v = vencMin(o); const at = diasAtraso(o); return v == null ? h('span.muted', 'Encerrada') : h('span.num', { class: at > 0 ? 'money-red' : '' }, fmt.date(v) + (at > 0 ? ` (${at}d)` : '')); } },
        { key: 'st', label: 'Status', sort: cmpCarteira, render: (o) => ui.status('operacao', o.status) },
        { key: 'saldo', label: 'Saldo aberto', align: 'right', width: '124px', sort: (a, b) => abertaDe(a) - abertaDe(b), render: (o) => h('span.num', fmt.brl(abertaDe(o), { round: true })) },
        { key: 'ac', label: '', render: (o) => ui.moreMenu([
          { label: 'Ver detalhe', icon: 'eye', onclick: () => C.router.go('/financiador/operacoes/' + o.id) },
          o.financiadorId === me() && (o.status === 'vencida' || o.status === 'parcial') && o.regresso && !o.regressoAcionado ? { label: 'Acionar regresso', icon: 'rotate-ccw', onclick: () => acionarRegressoFlow(o.id) } : null,
          { label: 'Ver contrato', icon: 'file-text', onclick: () => { const ct = db.get('contratos', o.contratoId); if (ct) F.verContrato(ct); else ui.toast('Contrato ainda não gerado', { type: 'info' }); } },
        ]) },
      ],
    });

    const seg = ui.segmented({
      value: state.grupo, aria: 'Filtro de situação da carteira',
      options: [
        { value: 'todas', label: 'Todas', count: ops.length },
        { value: 'assinar', label: 'A pagar/assinar', count: ops.filter((o) => grupoCarteira(o) === 'assinar').length },
        { value: 'vencer', label: 'A vencer', count: ops.filter((o) => grupoCarteira(o) === 'vencer').length },
        { value: 'vencidas', label: 'Vencidas', count: ops.filter((o) => grupoCarteira(o) === 'vencidas').length },
        { value: 'liquidadas', label: 'Liquidadas', count: ops.filter((o) => grupoCarteira(o) === 'liquidadas').length },
        { value: 'recompradas', label: 'Recompradas', count: ops.filter((o) => grupoCarteira(o) === 'recompradas').length },
      ],
      onChange: (v) => { state.grupo = v; tbl.setRows(filtradas()); },
    });
    const selCed = ui.select({ placeholder: 'Cedente: todos', options: [{ value: '', label: 'Todos os cedentes' }, ...cedList.map((c) => ({ value: c.id, label: c.fantasia || c.nome }))], onChange: (v) => { state.ced = v; tbl.setRows(filtradas()); } });
    const selSac = ui.select({ placeholder: 'Sacado: todos', options: [{ value: '', label: 'Todos os sacados' }, ...sacList.map((s) => ({ value: s.id, label: s.fantasia || s.nome }))], onChange: (v) => { state.sac = v; tbl.setRows(filtradas()); } });
    const dtDe = ui.date({ placeholder: 'Venc. de', clearable: true, onChange: (v) => { state.de = v; tbl.setRows(filtradas()); } });
    const dtAte = ui.date({ placeholder: 'Venc. até', clearable: true, onChange: (v) => { state.ate = v; tbl.setRows(filtradas()); } });

    const live = ui.live(['operacoes', 'titulos', 'lances'], () => {
      const agora = myOps();
      if (!agora.length) { tbl.setRows([]); return ui.empty({ icon: 'briefcase', title: 'Carteira vazia', text: 'Você ainda não venceu nenhum leilão. As operações que você comprar aparecem aqui.', action: ui.btn('Ver Vitrine', { variant: 'primary', icon: 'store', route: '/financiador/vitrine' }) }); }
      tbl.setRows(filtradas(agora));
      const k = kpisDe(agora);
      return h('div.stack',
        ui.grid(4,
          ui.kpi({ label: 'Em carteira (face em aberto)', value: k.face, fmt: 'brl', icon: 'briefcase', tone: 'teal' }),
          ui.kpi({ label: 'A vencer em 30 dias', value: k.v30, fmt: 'brl', icon: 'calendar', hint: 'pelos vencimentos mais próximos' }),
          ui.kpi({ label: 'Vencido', value: k.vv, fmt: 'brl', icon: 'triangle-alert', tone: k.vv > 0 ? 'red' : undefined, hint: k.vv > 0 && k.face > 0 ? fmt.pct((k.vv / k.face) * 100, 1) + ' da carteira' : 'sem atraso' }),
          ui.kpi({ label: 'Retorno bruto acumulado', value: k.rb, fmt: 'brl', icon: 'trending-up', hint: 'deságio das encerradas' }),
          ui.kpi({ label: 'Prazo médio', display: k.pm + ' dias', icon: 'timer', hint: 'ponderado pela face em aberto' })),
        h('div', { class: 'grid g3 fn2-charts' },
          ui.card({ title: 'Exposição por sacado', subtitle: 'Face em aberto' }, chartSacado(k.ab)),
          ui.card({ title: 'Por programa', subtitle: 'Face em aberto' }, chartPrograma(k.ab)),
          ui.card({ title: 'Concentração por cedente', subtitle: 'Uso do limite da política' }, chartCedente(k.ab))),
        ui.card({ title: 'Aging de vencidos', subtitle: 'Valor em aberto por dias de atraso' }, agingVencidos(k.venc)));
    });

    return h('div.stack',
      ui.pageHeader({ title: 'Carteira', subtitle: 'Operações compradas pela Vértice Capital, do aceite à liquidação.', actions: [ui.btn('Vitrine', { icon: 'store', route: '/financiador/vitrine' })] }),
      h('div', { class: 'fn2-segwrap' }, seg),
      ui.toolbar(selCed, selSac, dtDe, dtAte),
      tbl,
      live);
  }

  function chartSacado(abertas) {
    const by = new Map();
    abertas.forEach((o) => openTits(o).forEach((t) => { by.set(t.sacadoId, (by.get(t.sacadoId) || 0) + t.valor); }));
    const items = [...by.entries()].map(([id, v], i) => ({ label: (db.get('orgs', id) || {}).fantasia || id, value: C.round2(v), tone: ['blue', 'teal', 'green', 'amber', 'violet', 'navy'][i % 6] }));
    if (!items.length) return ui.empty({ icon: 'chart-pie', title: 'Sem exposição aberta' });
    return ui.chart.donut(items, { format: (v) => fmt.brl(v, { round: true }) });
  }
  function chartPrograma(abertas) {
    const by = new Map();
    abertas.forEach((o) => by.set(o.produto, (by.get(o.produto) || 0) + abertaDe(o)));
    const items = [...by.entries()].map(([p, v], i) => ({ label: F.prod(p), value: C.round2(v), tone: ['teal', 'blue', 'green', 'amber', 'violet'][i % 5] }));
    if (!items.length) return ui.empty({ icon: 'chart-pie', title: 'Sem exposição aberta' });
    return ui.chart.donut(items, { format: (v) => fmt.brl(v, { round: true }) });
  }
  function chartCedente(abertas) {
    const pol = (db.get('orgs', me()) || {}).politica || {};
    const by = new Map();
    abertas.forEach((o) => by.set(o.cedenteId, (by.get(o.cedenteId) || 0) + abertaDe(o)));
    const items = [...by.entries()].map(([id, v]) => {
      const lim = ((pol.limiteCedente || {})[id] !== undefined ? pol.limiteCedente[id] : pol.limiteCedentePadrao);
      const uso = lim ? v / lim : 0;
      return { label: (db.get('orgs', id) || {}).fantasia || id, value: C.round2(v), tone: uso >= 1 ? 'red' : uso >= 0.8 ? 'amber' : 'teal', hint: lim ? `uso ${fmt.brl(v, { round: true })} de ${fmt.brl(lim, { round: true })}` : fmt.brl(v, { round: true }) };
    }).sort((a, b) => b.value - a.value);
    if (!items.length) return ui.empty({ icon: 'chart-column', title: 'Sem exposição aberta' });
    return ui.chart.hbars(items, { format: (v) => fmt.brl(v, { round: true }) });
  }
  function agingVencidos(vencidas) {
    const buckets = [['0 a 5 dias', 0, 5, 'teal'], ['6 a 15 dias', 6, 15, 'amber'], ['16 a 30 dias', 16, 30, 'amber'], ['Mais de 30 dias', 31, 1e9, 'red']];
    const items = buckets.map(([label, lo, hi, tone]) => {
      const v = C.round2(C.sum(vencidas.filter((o) => { const d = diasAtraso(o); return d >= lo && d <= hi; }), abertaDe));
      return { label, value: v, tone, hint: fmt.brl(v, { round: true }) };
    });
    if (!items.some((i) => i.value > 0)) return ui.empty({ icon: 'circle-check', title: 'Nada vencido', text: 'Nenhuma operação em atraso na carteira.' });
    return ui.chart.hbars(items, { format: (v) => fmt.brl(v, { round: true }) });
  }

  /** Fluxo de regresso compartilhado (carteira e detalhe). */
  function acionarRegressoFlow(opId) {
    const op = db.get('operacoes', opId);
    if (!op) return;
    if (!canOp()) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    if (!op.regresso) { ui.toast('Operação sem regresso', { type: 'info', text: 'Você assumiu o risco do sacado nesta operação: não há recompra a acionar. A cobrança segue com a Mesa.' }); return; }
    const tit = openTits(op);
    const vMin = Math.min(...tit.map((t) => t.vencimento));
    const dias = Math.max(1, C.cal.daysBetween(vMin, C.clock.now()));
    const saldo = E.saldoAberto(op);
    const encargos = C.round2(saldo * 0.02 + saldo * 0.01 * dias / 30);
    const total = C.round2(saldo + encargos);
    const ate = C.cal.addUteis(C.clock.now(), 5);
    ui.confirm({
      title: 'Acionar regresso em ' + op.id, icon: 'rotate-ccw', tone: 'danger', confirmLabel: 'Acionar regresso',
      text: 'O cedente será notificado e deverá recomprar os títulos em até 5 dias úteis.',
      children: ui.kv([['Saldo em aberto', fmt.brl(saldo)], ['Multa (2%)', fmt.brl(C.round2(saldo * 0.02))], ['Mora (1% a.m., ' + dias + ' dias)', fmt.brl(C.round2(saldo * 0.01 * dias / 30))], ['Total da recompra', h('strong', fmt.brl(total))], ['Prazo da recompra', fmt.date(ate) + ' (5 dias úteis)']]),
    }).then((okc) => {
      if (!okc) return;
      const r = E.acionarRegresso(opId, session.user().id);
      if (!r.ok) { ui.toast('Não foi possível acionar', { type: 'error', text: r.erro }); return; }
      ledger.append({ actor: E.actors.user(session.user().id), acao: 'regresso.acionado', entidade: { kind: 'operacao', id: opId }, resumo: 'Financiador acionou o regresso em ' + opId, classe: 'R3' });
      ui.toast('Regresso acionado', { type: 'success', text: `Recompra de ${fmt.brl(total)} devida até ${fmt.date(ate)}.` });
    });
  }

  /* ===================== 2. DETALHE DA OPERAÇÃO ===================== */
  const STEPS = ['Aceite', 'Cessão', 'Pagamento', 'Recebimento', 'Encerramento'];
  const stepIdx = (op) => op.status === 'cessao' ? 1 : op.status === 'aguardando_pagamento' ? 2
    : ['paga', 'vencida', 'parcial'].includes(op.status) ? 3 : 5;

  function opDetail(ctx) {
    const op0 = db.get('operacoes', ctx.params.id);
    if (!op0 || op0.financiadorId !== me()) {
      setTimeout(() => C.router.go('/financiador/carteira'), 0);
      return h('div.stack', ui.pageHeader({ title: 'Operação', back: '/financiador/carteira' }), ui.skeleton(4));
    }
    const renderAll = (op) => h('div.stack',
      ui.pageHeader({
        back: '/financiador/carteira', eyebrow: 'Carteira · ' + F.prod(op.produto),
        title: op.id,
        subtitle: `${fmt.brl(op.face, { round: true })} · ${fmt.taxa(op.taxaFinal)} · ${(db.get('orgs', op.cedenteId) || {}).fantasia || ''}`,
        actions: [ui.status('operacao', op.status), C.comUI.btnConversar({ kind: 'operacao', id: op.id }, { rotulo: 'Operação ' + op.id })],
      }),
      ui.stepper(STEPS, stepIdx(op)),
      statusPanel(op),
      h('div', { class: 'detail-grid' },
        h('div.stack',
          ui.card({ title: 'Títulos', subtitle: `${tits(op).length} título(s)` }, titulosTable(op)),
          ui.card({ title: 'Linha do tempo', subtitle: 'Trilha de decisões (ledger)' }, F.timeline('operacao', op.id)),
          repassesCard(op)),
        h('div.stack',
          econCard(op),
          cedenteCard(op),
          sacadosCard(op),
          contratoCard(op),
          snapshotCard(op))));

    return h('div.stack', ui.live(['operacoes', 'lances', 'contratos', 'repasses', 'titulos', 'ledger', 'extrato'], () => {
      const op = db.get('operacoes', ctx.params.id);
      if (!op || op.financiadorId !== me()) return ui.empty({ icon: 'lock', title: 'Operação indisponível', text: 'Esta operação não pertence à sua carteira.', action: ui.btn('Voltar à carteira', { variant: 'primary', route: '/financiador/carteira' }) });
      return renderAll(op);
    }));
  }

  function statusPanel(op) {
    const u = session.user();
    if (op.status === 'cessao') {
      const ct = db.get('contratos', op.contratoId);
      const euAssinei = ct && ct.assinaturas.some((s) => s.parte === 'financiador');
      const cedAssinou = ct && ct.assinaturas.some((s) => s.parte === 'cedente');
      return ui.card({ title: 'Assinatura da cessão', subtitle: 'Contrato só vale com ICP-Brasil das duas partes' },
        h('div.stack',
          ct ? F.contratoCard(ct) : h('p.muted', 'Contrato em geração.'),
          !cedAssinou ? ui.callout({ tone: 'info', title: 'Aguardando o cedente', text: 'Assim que o cedente assinar, você será avisado para assinar e pagar.' })
          : euAssinei ? ui.callout({ tone: 'success', title: 'Você já assinou', text: 'Falta a outra parte concluir para liberar o pagamento.' })
          : h('div.row', canOp() ? ui.btn('Assinar cessão', { variant: 'primary', icon: 'pen-line', onclick: async () => { await F.assinar(op.contratoId, 'financiador'); } }) : ui.btn('Assinar cessão', { variant: 'primary', icon: 'pen-line', disabled: true, title: C.cannotMsg('assinar') }), ui.btn('Ler contrato', { icon: 'file-text', onclick: () => F.verContrato(ct) })),
          !canOp() ? noPerm('assinar') : null));
    }
    if (op.status === 'aguardando_pagamento') {
      const late = C.clock.now() > op.pagamentoLimite;
      return ui.card({ title: 'Pagamento ao cedente' },
        h('div.stack',
          ui.callout(late
            ? { tone: 'error', title: 'Pagamento em atraso', text: `O limite era ${fmt.datetime(op.pagamentoLimite)}. O cedente já foi avisado. Regularize agora: após o limite incide tarifa de desistência de 0,5% a.m. pro rata (regra [INFERÊNCIA] da plataforma), além do registro na trilha.` }
            : { tone: 'info', title: 'Pagamento direto, sem custódia', text: `A Cedy não faz custódia dos recursos: o valor vai direto para a conta de liquidação do cedente. Limite: ${fmt.datetime(op.pagamentoLimite)}.` }),
          ui.kv([['Valor a pagar', h('strong', fmt.brl(op.liquido))], ['Limite', fmt.datetime(op.pagamentoLimite)], ['Situação', late ? h('strong.money-red', 'Em atraso') : ui.countdown(op.pagamentoLimite, { prefix: 'faltam' })]]),
          canOp() ? ui.btn(late ? 'Pagar agora (em atraso)' : 'Pagar via banco parceiro', { variant: 'primary', icon: 'send', onclick: async () => { await F.pagar(op.id); } }) : noPerm('pagar')));
    }
    if (op.status === 'paga') return cronogramaCard(op, false);
    if (op.status === 'vencida' || op.status === 'parcial') return h('div.stack', cronogramaCard(op, true), regressoCard(op));
    if (op.status === 'liquidada') {
      const rps = db.where('repasses', (r) => r.opId === op.id);
      return ui.card({ title: 'Operação liquidada', subtitle: 'Sacados pagaram, repasse programado' },
        h('div.stack',
          ui.callout({ tone: 'success', title: 'Liquidação total', text: op.liquidadaEm ? `Liquidada em ${fmt.date(op.liquidadaEm)}. O repasse chega em até 1 dia útil.` : 'Liquidação registrada.' }),
          repassesTable(rps)));
    }
    if (op.status === 'recomprada') {
      const rps = db.where('repasses', (r) => r.opId === op.id);
      return ui.card({ title: 'Operação recomprada', subtitle: 'Cedente recomprou após regresso' },
        h('div.stack',
          ui.callout({ tone: 'info', title: 'Recompra paga', text: op.recompra && op.recompra.pagaEm ? `Paga pelo cedente em ${fmt.date(op.recompra.pagaEm)}: ${fmt.brl(op.recompra.valor)}.` : 'Recompra quitada.' }),
          repassesTable(rps)));
    }
    return ui.card({ title: 'Situação', }, ui.status('operacao', op.status));
  }

  function cronogramaCard(op, atrasado) {
    const plano = op.planoSacado || [];
    const rows = plano.map((p) => ({ sac: db.get('orgs', p.sacadoId), ts: p.ts, valor: p.valor, emitido: p.emitido, titulos: (p.tituloIds || []).length }));
    const totalPrev = C.round2(C.sum(rows, (r) => r.valor));
    return ui.card({ title: atrasado ? 'Cobrança e recebimento' : 'Cronograma de recebimento', subtitle: 'Pagamentos previstos dos sacados' },
      h('div.stack',
        atrasado ? ui.callout({ tone: 'error', title: `Vencida há ${diasAtraso(op)} dias`, text: `Saldo em aberto: ${fmt.brl(abertaDe(op))}. Veja abaixo como acionar o regresso.` }) : null,
        rows.length ? ui.table({
          rows, dense: true,
          columns: [
            { key: 'sac', label: 'Sacado', render: (r) => F.orgCell(r.sac, { size: 'sm' }) },
            { key: 'ts', label: 'Previsto', width: '104px', render: (r) => h('span.num', fmt.date(r.ts)) },
            { key: 'tit', label: 'Títulos', align: 'right', width: '72px', render: (r) => h('span.num', r.titulos) },
            { key: 'valor', label: 'Valor', align: 'right', width: '124px', render: (r) => h('span.num', fmt.brl(r.valor)) },
            { key: 'st', label: 'Situação', render: (r) => r.emitido ? ui.badge('Creditado', 'green', { dot: true }) : ui.badge(atrasado ? 'Não pago' : 'A vencer', atrasado ? 'red' : 'blue', { dot: true }) },
          ],
        }) : h('p.muted', 'Cronograma em geração pelo feed bancário.'),
        h('p.small.muted', `Total previsto: ${fmt.brl(totalPrev)}. Após cada liquidação, o repasse a você sai em até 1 dia útil.`)));
  }

  function regressoCard(op) {
    const tit = openTits(op);
    const perSac = new Map();
    tit.forEach((t) => { const e = perSac.get(t.sacadoId) || { valor: 0, n: 0, maxAtraso: 0 }; e.valor += t.valor; e.n++; e.maxAtraso = Math.max(e.maxAtraso, Math.max(0, C.cal.daysBetween(t.vencimento, C.clock.now()))); perSac.set(t.sacadoId, e); });
    const histRow = [...perSac.entries()].map(([id, e]) => {
      const s = db.get('orgs', id) || {};
      return h('div.list-item', F.orgCell(s, { size: 'sm' }), h('div.grow', h('strong', fmt.brl(e.valor)), h('div.small.muted', `${e.n} título(s) em aberto · maior atraso ${e.maxAtraso} dias · média histórica ${s.pagamentoMedioDias >= 0 ? '+' + s.pagamentoMedioDias + 'd' : s.pagamentoMedioDias + 'd'}`)), F.ratingBadge(s.rating || 'D'));
    });
    let acao = null;
    if (!op.regresso) acao = ui.callout({ tone: 'warn', title: 'Operação sem regresso', text: 'Você assumiu integralmente o risco do sacado nesta operação: não há recompra a acionar. A cobrança segue com a Mesa e o time de cobrança.' });
    else if (op.recompra && op.recompra.status === 'devida') acao = ui.callout({ tone: 'warn', title: 'Recompra devida', text: `${fmt.brl(op.recompra.valor)} a receber até ${fmt.date(op.recompra.ate)}. O repasse entra automaticamente após o pagamento do cedente.` });
    else if (op.regressoAcionado) acao = ui.callout({ tone: 'info', title: 'Regresso em curso', text: 'A recompra já foi acionada e o cedente foi notificado.' });
    else acao = h('div.row', canOp() ? ui.btn('Acionar regresso', { variant: 'danger', icon: 'rotate-ccw', onclick: () => acionarRegressoFlow(op.id) }) : ui.btn('Acionar regresso', { variant: 'danger', icon: 'rotate-ccw', disabled: true, title: C.cannotMsg('operar') }), !canOp() ? noPerm('operar') : null);
    return ui.card({ title: 'Regresso e sacados', subtitle: op.regresso ? 'Operação com regresso' : 'Operação sem regresso' },
      h('div.stack', ui.kv([['Saldo em aberto', h('strong', fmt.brl(abertaDe(op)))], ['Dias de atraso', diasAtraso(op) + ' dias']]), h('div.list', histRow), acao));
  }

  function titulosTable(op) {
    return ui.table({
      rows: tits(op), dense: true, pageSize: 0,
      columns: [
        { key: 'numero', label: 'Título', mobile: 'primary', render: (t) => h('span.mono', t.numero) },
        { key: 'sac', label: 'Sacado', render: (t) => h('span', (db.get('orgs', t.sacadoId) || {}).fantasia || '') },
        { key: 'valor', label: 'Valor', align: 'right', width: '118px', render: (t) => h('span.num', fmt.brl(t.valor)) },
        { key: 'venc', label: 'Vencimento', width: '104px', mobile: 'hide', render: (t) => h('span.num', fmt.date(t.vencimento)) },
        { key: 'st', label: 'Status', render: (t) => ui.status('titulo', t.status) },
      ],
    });
  }

  function econCard(op) {
    const s = econ(op);
    const spread = C.round2(s.desagioValor - s.ts);
    return ui.card({ title: 'Resultado econômico', subtitle: 'Valores congelados no aceite' },
      ui.kv([
        ['Face', fmt.brl(op.face)],
        ['Valor pago ao cedente', h('strong', fmt.brl(op.liquido))],
        ['Deságio', fmt.brl(op.desagio)],
        ['Retorno bruto', h('strong', fmt.brl(s.desagioValor))],
        ['TS (taxa de serviço)', fmt.brl(op.ts) + ` (${fmt.pct(s.tsPct, 0)} do spread${s.tsNoPiso ? ', piso aplicado' : ''})`],
        ['Composição da TS', h('small', `spread ${fmt.brl(spread)} × ${fmt.pct(s.tsPct, 0)} = ${fmt.brl(s.tsBruto)}; piso ${fmt.brl(s.tsPiso)}`)],
        ['Retorno líquido', h('strong', fmt.brl(s.retornoFinanciador))],
        ['Rentabilidade líquida', `${fmt.pct(s.retornoFinanciadorAm, 2)} a.m.`],
        ['CET da operação', fmt.taxa(s.cetAm)],
      ]));
  }

  function cedenteCard(op) {
    const c = db.get('orgs', op.cedenteId) || {};
    return ui.card({ title: 'Cedente', actions: [ui.btn('Ver operações', { variant: 'ghost', size: 'sm', route: '/financiador/carteira' })] },
      h('div.stack', F.orgCell(c), ui.kv([['Cidade', `${c.cidade || ''}${c.uf ? '/' + c.uf : ''}`], ['Setor', c.setor || ''], ['CNPJ', fmt.cnpj(c.cnpj || '')]])));
  }

  function sacadosCard(op) {
    const pol = (db.get('orgs', me()) || {}).politica || {};
    const rows = sacIds(op).map((id) => {
      const s = db.get('orgs', id) || {};
      const exp = openTits(op).filter((t) => t.sacadoId === id).reduce((a, t) => a + t.valor, 0);
      const lim = ((pol.limiteSacado || {})[id] !== undefined ? pol.limiteSacado[id] : pol.limiteSacadoPadrao);
      return h('div.list-item', F.orgCell(s, { size: 'sm' }), h('div.grow', h('strong', fmt.brl(exp)), h('div.small.muted', lim ? `nesta operação · limite ${fmt.brl(lim, { round: true })}` : 'nesta operação')), F.ratingBadge(s.rating || 'D'));
    });
    return ui.card({ title: 'Sacados e exposição' }, h('div.list', rows));
  }

  function contratoCard(op) {
    const ct = db.get('contratos', op.contratoId);
    if (!ct) return ui.card({ title: 'Contrato de cessão' }, h('p.muted', 'Contrato ainda não gerado.'));
    return ui.card({ title: 'Contrato de cessão', actions: [ui.btn('Ver contrato', { variant: 'ghost', size: 'sm', icon: 'file-text', onclick: () => F.verContrato(ct) })] }, F.contratoCard(ct));
  }

  function snapshotCard(op) {
    const ev = ledger.forEntity('operacao', op.id).find((e) => e.acao === 'operacao.aceita');
    return ui.card({ title: 'O que foi exibido no aceite', subtitle: 'Snapshot registrado na trilha (R3)' }, F.snapshotView(ev && ev.snapshot));
  }

  function repassesTable(rps) {
    if (!rps.length) return h('p.muted', 'Nenhum repasse gerado ainda.');
    return ui.table({
      rows: rps, dense: true,
      columns: [
        { key: 'id', label: 'Repasse', render: (r) => h('span.mono.small', r.id.slice(-8)) },
        { key: 'valor', label: 'Valor', align: 'right', render: (r) => h('span.num', fmt.brl(r.valor)) },
        { key: 'origem', label: 'Origem', mobile: 'hide', render: (r) => h('span', r.origem === 'recompra' ? 'Recompra' : 'Liquidação do sacado') },
        { key: 'prev', label: 'Previsto para', render: (r) => h('span.num', fmt.date(r.previstoPara)) },
        { key: 'st', label: 'Status', render: (r) => r.status === 'pago' ? ui.badge('Pago', 'green', { dot: true }) : ui.badge('Agendado', 'amber', { dot: true }) },
      ],
    });
  }
  function repassesCard(op) {
    const rps = db.where('repasses', (r) => r.opId === op.id);
    return ui.card({ title: 'Repasses desta operação', actions: [ui.btn('Todos os repasses', { variant: 'ghost', size: 'sm', route: '/financiador/repasses' })] }, repassesTable(rps));
  }

  /* ===================== 3. REPASSES E CONCILIAÇÃO ===================== */
  function repasses(ctx) {
    const tab = (ctx.query && ctx.query.aba === 'conciliacao') ? 'conc' : 'rep';
    const tabs = ui.tabs({ value: tab, items: [{ id: 'rep', label: 'Repasses', icon: 'arrow-left-right' }, { id: 'conc', label: 'Conciliação', icon: 'git-compare' }], onChange: (v) => C.router.go('/financiador/repasses' + (v === 'conc' ? '?aba=conciliacao' : '')) });
    const host = h('div');
    const draw = () => C.mount(host, tabs.value === 'conc' ? concilTab() : repassesTab());
    tabs.addEventListener('change', draw);
    draw();
    return h('div.stack', ui.pageHeader({ title: 'Repasses', subtitle: 'Liquidações dos sacados e recompras, com previsão de até 1 dia útil.' }), tabs, host);
  }

  function repassesTab() {
    const all = () => db.where('repasses', (r) => r.finId === me()).sort((a, b) => b.criadoEm - a.criadoEm);
    const state = { st: 'todos', origem: 'todas', q: '' };
    const now = C.clock.now();
    const compOf = (ts) => { const t = C.cal.sp(ts); return t.y + '-' + String(t.m).padStart(2, '0'); };
    const compNow = compOf(now);

    const filtrados = () => all().filter((r) => {
      if (state.st !== 'todos' && r.status !== state.st) return false;
      const org = r.origem === 'recompra' ? 'recompra' : 'liquidacao';
      if (state.origem !== 'todas' && org !== state.origem) return false;
      if (state.q && !(r.opId.toLowerCase().includes(state.q) || String(r.valor).includes(state.q))) return false;
      return true;
    });
    const tbl = ui.table({
      rows: filtrados(),
      rowKey: (r) => r.id,
      empty: ui.empty({ icon: 'arrow-left-right', title: 'Nenhum repasse', text: 'Repasses aparecem aqui após liquidações dos sacados ou recompras.' }),
      columns: [
        { key: 'op', label: 'Operação', mobile: 'primary', render: (r) => h('a', { class: 'mono strong', href: '#/financiador/operacoes/' + r.opId }, r.opId) },
        { key: 'valor', label: 'Valor', align: 'right', width: '124px', sort: true, render: (r) => h('span.num', fmt.brl(r.valor)) },
        { key: 'origem', label: 'Origem', render: (r) => r.origem === 'recompra' ? ui.badge('Recompra', 'violet', { dot: true }) : ui.badge('Liquidação', 'teal', { dot: true }) },
        { key: 'prev', label: 'Previsto', width: '104px', sort: (a, b) => a.previstoPara - b.previstoPara, render: (r) => h('span.num', fmt.date(r.previstoPara)) },
        { key: 'linha', label: 'Linha do extrato', mobile: 'hide', render: (r) => r.linhaId ? h('span.mono.small', r.linhaId.slice(-8)) : h('span.muted', 'Recompra') },
        { key: 'st', label: 'Status', render: (r) => r.status === 'pago' ? ui.badge('Pago', 'green', { dot: true }) : ui.badge('Agendado', 'amber', { dot: true }) },
      ],
    });
    const seg = ui.segmented({ value: state.st, aria: 'Filtro de situação do repasse', options: [{ value: 'todos', label: 'Todos' }, { value: 'agendado', label: 'Agendados' }, { value: 'pago', label: 'Pagos' }], onChange: (v) => { state.st = v; tbl.setRows(filtrados()); } });
    const selOrg = ui.select({ options: [{ value: 'todas', label: 'Todas as origens' }, { value: 'liquidacao', label: 'Liquidação do sacado' }, { value: 'recompra', label: 'Recompra' }], onChange: (v) => { state.origem = v; tbl.setRows(filtrados()); } });
    const busca = ui.search({ placeholder: 'Buscar por operação ou valor', onInput: (v) => { state.q = String(v || '').toLowerCase(); tbl.setRows(filtrados()); } });
    const exportar = () => {
      const rows = filtrados().map((r) => [r.id, r.opId, r.valor.toFixed(2).replace('.', ','), r.origem === 'recompra' ? 'Recompra' : 'Liquidação do sacado', fmt.date(r.previstoPara), r.pagoEm ? fmt.date(r.pagoEm) : '', r.status === 'pago' ? 'Pago' : 'Agendado', r.linhaId || '']);
      downloadCSV('repasses-vertice.csv', ['Repasse', 'Operação', 'Valor (R$)', 'Origem', 'Previsto para', 'Pago em', 'Status', 'Linha do extrato'], rows);
      ui.toast('CSV exportado', { type: 'success', text: `${rows.length} repasse(s).` });
    };
    return h('div.stack',
      ui.live(['repasses'], () => {
        const rs = all();
        const rec = C.round2(C.sum(rs.filter((r) => r.status === 'agendado'), (r) => r.valor));
        const mes = C.round2(C.sum(rs.filter((r) => r.status === 'pago' && r.pagoEm && compOf(r.pagoEm) === compNow), (r) => r.valor));
        return ui.grid(2, ui.kpi({ label: 'A receber (agendados)', value: rec, fmt: 'brl', icon: 'hourglass', tone: rec > 0 ? 'amber' : undefined }), ui.kpi({ label: 'Recebido neste mês', value: mes, fmt: 'brl', icon: 'circle-check', tone: 'green' }));
      }),
      h('div', { class: 'fn2-segwrap' }, seg),
      ui.toolbar(busca, selOrg, ui.btn('Exportar CSV', { icon: 'download', onclick: exportar, class: 'fn2-no-print' })),
      tbl);
  }

  function concilTab() {
    const ops = myOps().filter((o) => ['paga', 'vencida', 'parcial', 'liquidada'].includes(o.status));
    const casosAbertos = db.where('casosMesa', (c) => c.status === 'aberto');
    const rows = ops.map((o) => {
      const ts = tits(o);
      const liq = ts.filter((t) => t.status === 'liquidado').length;
      const caso = casosAbertos.find((c) => { const l = db.get('extrato', c.linhaId); return l && l.orgId === o.cedenteId; });
      const rps = db.where('repasses', (r) => r.opId === o.id);
      return { op: o, liq, total: ts.length, caso, rep: C.round2(C.sum(rps, (r) => r.valor)) };
    });
    const tbl = ui.table({
      rows, rowKey: (r) => r.op.id,
      empty: ui.empty({ icon: 'git-compare', title: 'Nada a conciliar', text: 'Operações pagas ao cedente aparecem aqui com o estado de cada recebimento.' }),
      columns: [
        { key: 'op', label: 'Operação', mobile: 'primary', render: (r) => h('a', { class: 'mono strong', href: '#/financiador/operacoes/' + r.op.id }, r.op.id) },
        { key: 'ced', label: 'Cedente', mobile: 'hide', render: (r) => h('span', (db.get('orgs', r.op.cedenteId) || {}).fantasia || '') },
        { key: 'tit', label: 'Títulos liquidados', width: '140px', render: (r) => h('span.num', `${r.liq}/${r.total}`) },
        { key: 'prog', label: 'Progresso', mobile: 'hide', render: (r) => ui.progress(r.total ? (r.liq / r.total) * 100 : 100, { thin: true, tone: r.liq === r.total ? 'green' : 'blue' }) },
        { key: 'mesa', label: 'Mesa', render: (r) => r.caso ? ui.badge('Na Mesa', 'amber', { dot: true, title: r.caso.motivo }) : r.liq === r.total ? ui.badge('Conciliado', 'green', { dot: true }) : ui.badge('Aguardando sacado', 'blue', { dot: true }) },
        { key: 'rep', label: 'Repasse', align: 'right', render: (r) => h('span.num', r.rep ? fmt.brl(r.rep) : 'A gerar') },
        { key: 'ac', label: '', render: (r) => ui.iconBtn('eye', { label: 'Ver operação ' + r.op.id, size: 'sm', onclick: () => C.router.go('/financiador/operacoes/' + r.op.id) }) },
      ],
    });
    return h('div.stack',
      ui.callout({ tone: 'info', title: 'Conciliação por 3 fatores (somente leitura)', text: 'Cada crédito do sacado é conciliado por (1) fonte pagadora, (2) valor entre 50% e 110% do saldo e (3) data. Exato e único liquida; parcial ou sem fonte vai à Mesa Conciliadora. Sobra vira Recurso Livre do cedente. O repasse a você sai em até 1 dia útil após a liquidação.' }),
      ui.card({ title: 'Estado de recebimento por operação', subtitle: 'Toque no olho para abrir a operação' }, tbl));
  }

  /* ===================== 4. POLÍTICA DE CRÉDITO ===================== */
  const SETORES = ['Varejo', 'Automotivo', 'Construção', 'Energia', 'Imobiliário', 'Agro', 'Telecom', 'Alimentos', 'Siderurgia', 'Saúde', 'Indústria', 'Distribuição', 'Transporte'];
  const PRODS = ['premium', 'confia', 'boleto', 'carteira', 'contrato', 'frete'];
  const RATINGS = [{ value: 'A', label: 'A (mínimo alto)' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }, { value: 'D', label: 'D (aceita tudo)' }];

  const clonePol = (p) => JSON.parse(JSON.stringify(p || {}));
  const roChips = (vals) => h('div.chipbtns', (vals && vals.length ? vals : ['nenhum']).map((v) => ui.chip(v)));
  const POL_DEFAULTS = { taxaMinima: 1.5, prazoMin: 15, prazoMax: 150, ticketMin: 20000, ticketMax: 1000000, produtos: ['premium', 'confia'], ratingMin: 'C', limiteTotal: 10000000, limiteCedentePadrao: 2000000, limiteCedente: {}, limiteSacadoPadrao: 2500000, limiteSacado: {}, setoresBloqueados: [], cedentesBloqueados: [], exigeRegresso: false, autoLance: { ativo: false, valorMaxDia: 1500000, passoSobreMelhor: 0.01 }, historico: [] };

  function politica() {
    const fin = db.get('orgs', me());
    const saved = Object.assign(clonePol(POL_DEFAULTS), clonePol(fin.politica || {}));
    if (!saved.autoLance) saved.autoLance = clonePol(POL_DEFAULTS.autoLance);
    const draft = clonePol(saved);
    const isAdmin = C.can('admin');
    const errs = {};
    const state = { simOp: '', simTaxa: saved.taxaMinima };

    const root = h('div.stack');
    const bar = h('div', { class: 'fn2-savebar' });
    const formHost = h('div.stack');

    const setErr = (field, msg) => { if (msg) errs[field] = msg; else delete errs[field]; drawBar(); };
    const num = (v) => (v === null || v === undefined || v === '' || isNaN(v) ? null : Number(v));

    function validateAll() {
      const e = {};
      if (!(draft.taxaMinima > 0)) e.taxaMinima = 'Informe uma taxa mínima maior que zero.';
      if (!(draft.prazoMin >= 1)) e.prazoMin = 'Prazo mínimo inválido.';
      if (!(draft.prazoMax >= draft.prazoMin)) e.prazoMax = 'Prazo máximo abaixo do mínimo.';
      if (!(draft.ticketMin > 0)) e.ticketMin = 'Ticket mínimo inválido.';
      if (!(draft.ticketMax >= draft.ticketMin)) e.ticketMax = 'Ticket máximo abaixo do mínimo.';
      if (!(draft.limiteTotal > 0)) e.limiteTotal = 'Limite total inválido.';
      if (!(draft.limiteCedentePadrao > 0)) e.limCedPad = 'Limite padrão por cedente inválido.';
      if (!(draft.limiteSacadoPadrao > 0)) e.limSacPad = 'Limite padrão por sacado inválido.';
      if (!draft.produtos || !draft.produtos.length) e.produtos = 'Selecione ao menos um programa.';
      if (draft.autoLance.ativo && !(draft.autoLance.valorMaxDia > 0)) e.autoMax = 'Valor máximo por dia inválido.';
      Object.keys(errs).forEach((k) => delete errs[k]);
      Object.assign(errs, e);
      return e;
    }

    const dirty = () => JSON.stringify(stripHist(draft)) !== JSON.stringify(stripHist(saved));
    const stripHist = (p) => { const c = clonePol(p); delete c.historico; return c; };

    function drawBar() {
      C.mount(bar, !isAdmin ? ui.callout({ tone: 'info', title: 'Somente leitura', text: 'Seu perfil (' + (session.user() || {}).perfil + ') pode ver a política, mas só um administrador altera. Peça a Rafael Tavares para salvar mudanças.' })
        : h('div.fn2-savebar-in',
          h('div', Object.keys(errs).length ? h('strong.money-red', Object.values(errs)[0]) : dirty() ? h('span', 'Há alterações não salvas.') : h('span.muted', 'Nenhuma alteração pendente.')),
          ui.btn('Salvar política', { variant: 'primary', icon: 'check', disabled: !dirty() || Object.keys(validateAll()).length > 0, onclick: pedirConfirmacao })));
    }

    function pedirConfirmacao() {
      const diff = diffPolitica(saved, draft);
      const hist = h('div.stack.tight', (draft.historico || []).slice(-4).reverse().map((hh) => h('div.list-item', icon('history', 14), h('div.grow', h('strong', hh.resumo), h('div.small.muted', `${fmt.datetime(hh.ts)} · ${hh.userNome || ''}`)))));
      const m = ui.modal({
        title: 'O que mudaria', subtitle: `${diff.length} campo(s) alterado(s)`, icon: 'git-compare', size: 'md',
        body: h('div.stack', diff.length ? h('div.list', diff.map((d) => h('div.list-item', icon('pencil', 14), h('div.grow', h('strong', d.campo), h('div.small.muted', `de ${d.de} para ${d.para}`))))) : h('p.muted', 'Sem mudanças.'),
          ui.card({ title: 'Versões anteriores', subtitle: 'Histórico guardado na política' }, (draft.historico || []).length ? hist : h('p.muted', 'Primeira versão registrada.'))),
        footer: (api) => [ui.btn('Voltar e editar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Confirmar e salvar', { variant: 'primary', icon: 'check', onclick: () => api.close(true) })],
      });
      m.promise.then((okb) => { if (okb) salvar(); });
    }

    function salvar() {
      const diff = diffPolitica(saved, draft);
      const resumo = diff.length === 1 ? `${diff[0].campo}: ${diff[0].de} para ${diff[0].para}` : `${diff.length} campos alterados (${diff.slice(0, 3).map((d) => d.campo).join(', ')})`;
      draft.historico = [...(draft.historico || []), { ts: C.clock.now(), userId: session.user().id, userNome: session.user().nome, resumo }];
      db.patch('orgs', me(), { politica: clonePol(draft) });
      Object.assign(saved, clonePol(draft));
      ledger.append({ actor: E.actors.user(session.user().id), acao: 'politica.alterada', entidade: { kind: 'org', id: me() }, resumo: `Política de crédito alterada: ${resumo}`, classe: 'R2', detalhe: diff });
      notify.send({ to: { orgId: me() }, tipo: 'info', titulo: 'Política de crédito atualizada', corpo: resumo, link: '/financiador/politica' });
      ui.toast('Política salva', { type: 'success', text: resumo });
      buildForm(); drawBar();
    }

    const ro = () => !isAdmin;
    function buildForm() {
      const labMin = h('span', `Prazo mínimo: ${draft.prazoMin} dias`);
      const labMax = h('span', `Prazo máximo: ${draft.prazoMax} dias`);
      const labPasso = h('span', `Passo sobre o melhor: ${fmt.taxa(draft.autoLance.passoSobreMelhor)}`);
      let fPraMin = null, fPraMax = null;
      validateAll();
      const cedOpts = db.where('orgs', (o) => o.kind === 'cedente' && o.status === 'ativo').map((c) => ({ value: c.id, label: c.fantasia || c.nome }));
      const sacOpts = db.where('orgs', (o) => o.kind === 'sacado').map((s) => ({ value: s.id, label: (s.fantasia || s.nome) + ` (${s.rating})` }));

      const limCedRows = Object.entries(draft.limiteCedente || {}).map(([id, v]) => ({ id, nome: (db.get('orgs', id) || {}).fantasia || id, valor: v }));
      const limSacRows = Object.entries(draft.limiteSacado || {}).map(([id, v]) => ({ id, nome: (db.get('orgs', id) || {}).fantasia || id, valor: v }));

      const limCedTbl = ui.table({
        rows: limCedRows, dense: true,
        empty: h('p.muted.small', 'Vale o limite padrão para todos os cedentes.'),
        columns: [
          { key: 'nome', label: 'Cedente', render: (r) => h('span', r.nome) },
          { key: 'valor', label: 'Limite', align: 'right', render: (r) => h('span.num', fmt.brl(r.valor, { round: true })) },
          { key: 'ac', label: '', render: (r) => isAdmin ? ui.iconBtn('trash-2', { label: 'Remover exceção de ' + r.nome, size: 'sm', onclick: () => { delete draft.limiteCedente[r.id]; buildForm(); drawBar(); } }) : h('span') },
        ],
      });
      const limSacTbl = ui.table({
        rows: limSacRows, dense: true,
        empty: h('p.muted.small', 'Vale o limite padrão para todos os sacados.'),
        columns: [
          { key: 'nome', label: 'Sacado', render: (r) => h('span', r.nome) },
          { key: 'valor', label: 'Limite', align: 'right', render: (r) => h('span.num', fmt.brl(r.valor, { round: true })) },
          { key: 'ac', label: '', render: (r) => isAdmin ? ui.iconBtn('trash-2', { label: 'Remover exceção de ' + r.nome, size: 'sm', onclick: () => { delete draft.limiteSacado[r.id]; buildForm(); drawBar(); } }) : h('span') },
        ],
      });

      const addExcecao = (kind) => {
        let selOrg = kind === 'ced' ? cedOpts[0] && cedOpts[0].value : sacOpts[0] && sacOpts[0].value;
        let valor = kind === 'ced' ? draft.limiteCedentePadrao : draft.limiteSacadoPadrao;
        const sel = ui.select({ options: kind === 'ced' ? cedOpts : sacOpts, value: selOrg, onChange: (v) => (selOrg = v) });
        const cur = ui.currency({ value: valor, onInput: (v) => (valor = v) });
        const m = ui.modal({
          title: kind === 'ced' ? 'Exceção de limite por cedente' : 'Exceção de limite por sacado', icon: 'plus', size: 'sm',
          body: h('div.stack', ui.field({ label: kind === 'ced' ? 'Cedente' : 'Sacado' }, sel), ui.field({ label: 'Limite (R$)' }, cur)),
          footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Adicionar', { variant: 'primary', onclick: () => {
            if (!selOrg || !(valor > 0)) { ui.toast('Informe empresa e valor', { type: 'warn' }); return; }
            if (kind === 'ced') draft.limiteCedente[selOrg] = Math.round(valor); else draft.limiteSacado[selOrg] = Math.round(valor);
            api.close(true); buildForm(); drawBar();
          } })],
        });
        return m.promise;
      };

      const autoUso = usoAutoLanceHoje();

      C.mount(formHost,
        ui.card({ title: 'Limites', subtitle: 'Teto de exposição da Vértice' }, h('div.stack.tight',
          ui.field({ label: 'Limite total (R$)', hint: 'Teto somado de todas as operações em carteira.' }, ui.currency({ value: draft.limiteTotal, disabled: ro(), onInput: (v) => { draft.limiteTotal = Math.round(v); validateAll(); drawBar(); } })),
          ui.grid(2,
            ui.field({ label: 'Limite padrão por cedente (R$)' }, ui.currency({ value: draft.limiteCedentePadrao, disabled: ro(), onInput: (v) => { draft.limiteCedentePadrao = Math.round(v); validateAll(); drawBar(); } })),
            ui.field({ label: 'Limite padrão por sacado (R$)' }, ui.currency({ value: draft.limiteSacadoPadrao, disabled: ro(), onInput: (v) => { draft.limiteSacadoPadrao = Math.round(v); validateAll(); drawBar(); } }))),
          h('h4.fn2-h4', 'Exceções por cedente'),
          limCedTbl,
          isAdmin ? ui.btn('Adicionar exceção', { icon: 'plus', size: 'sm', onclick: () => addExcecao('ced') }) : null,
          h('h4.fn2-h4', 'Exceções por sacado'),
          limSacTbl,
          isAdmin ? ui.btn('Adicionar exceção', { icon: 'plus', size: 'sm', onclick: () => addExcecao('sac') }) : null)),
        ui.card({ title: 'Elegibilidade', subtitle: 'Que operações podem receber lance' }, h('div.stack.tight',
          h('h4.fn2-h4', 'Programas aceitos'),
          ro() ? roChips(draft.produtos.map((p) => F.prod(p))) : ui.chips({ value: draft.produtos, aria: 'Programas aceitos', options: PRODS.map((p) => ({ value: p, label: F.prod(p) })), onChange: (v) => { draft.produtos = v; validateAll(); drawBar(); } }),
          errs.produtos ? h('div.field-error', errs.produtos) : null,
          h('div.sp-3'),
          ro() ? ui.kv([['Prazo mínimo', draft.prazoMin + ' dias'], ['Prazo máximo', draft.prazoMax + ' dias']]) : ui.grid(2,
            fPraMin = ui.field({ label: labMin, error: errs.prazoMin }, ui.slider({ value: draft.prazoMin, min: 5, max: 180, step: 1, format: (v) => v + 'd', onChange: (v) => { draft.prazoMin = v; labMin.textContent = `Prazo mínimo: ${v} dias`; validateAll(); fPraMin.setError(errs.prazoMin || ''); fPraMax.setError(errs.prazoMax || ''); drawBar(); } })),
            fPraMax = ui.field({ label: labMax, error: errs.prazoMax }, ui.slider({ value: draft.prazoMax, min: 15, max: 360, step: 5, format: (v) => v + 'd', onChange: (v) => { draft.prazoMax = v; labMax.textContent = `Prazo máximo: ${v} dias`; validateAll(); fPraMin.setError(errs.prazoMin || ''); fPraMax.setError(errs.prazoMax || ''); drawBar(); } }))),
          ui.grid(2,
            ui.field({ label: 'Ticket mínimo (R$)', error: errs.ticketMin }, ui.currency({ value: draft.ticketMin, disabled: ro(), onInput: (v) => { draft.ticketMin = Math.round(v); validateAll(); drawBar(); } })),
            ui.field({ label: 'Ticket máximo (R$)', error: errs.ticketMax }, ui.currency({ value: draft.ticketMax, disabled: ro(), onInput: (v) => { draft.ticketMax = Math.round(v); validateAll(); drawBar(); } }))),
          ui.field({ label: 'Rating mínimo do sacado' }, ui.select({ value: draft.ratingMin, disabled: ro(), options: RATINGS, onChange: (v) => { draft.ratingMin = v; drawBar(); } })),
          h('h4.fn2-h4', 'Setores bloqueados'),
          ro() ? roChips(draft.setoresBloqueados) : ui.chips({ value: draft.setoresBloqueados, aria: 'Setores bloqueados', options: SETORES.map((s) => ({ value: s, label: s })), onChange: (v) => { draft.setoresBloqueados = v; drawBar(); } }),
          h('h4.fn2-h4', 'Cedentes bloqueados'),
          ro() ? roChips(draft.cedentesBloqueados.map((id) => (db.get('orgs', id) || {}).fantasia || id)) : ui.chips({ value: draft.cedentesBloqueados, aria: 'Cedentes bloqueados', options: cedOpts.map((c) => ({ value: c.value, label: c.label })), onChange: (v) => { draft.cedentesBloqueados = v; drawBar(); } }),
          ui.switch({ label: 'Exigir regresso em todas as operações', hint: 'Sem regresso, você assume o risco do sacado.', checked: draft.exigeRegresso, disabled: ro(), onChange: (v) => { draft.exigeRegresso = v; drawBar(); } }))),
        ui.card({ title: 'Preço', subtitle: 'Piso de remuneração' },
          ui.field({ label: 'Taxa mínima (% a.m.)', hint: 'Piso do lance automático e das sugestões do agente. O motor automático nunca dá lance abaixo disso.', error: errs.taxaMinima }, ui.numeric({ value: draft.taxaMinima, suffix: '% a.m.', decimals: 2, min: 0.1, disabled: ro(), onInput: (v) => { if (v !== null) draft.taxaMinima = v; validateAll(); drawBar(); } }))),
        ui.card({ title: 'Lance automático', subtitle: 'Envelope determinístico, sem decisão de IA' }, h('div.stack.tight',
          ui.switch({ label: 'Ativar lance automático', hint: 'O motor dá lances dentro do envelope; a IA nunca decide nem executa.', checked: draft.autoLance.ativo, disabled: ro(), onChange: (v) => { draft.autoLance.ativo = v; buildForm(); drawBar(); } }),
          draft.autoLance.ativo ? h('div.stack.tight',
            ui.field({ label: 'Valor máximo por dia (R$)', error: errs.autoMax }, ui.currency({ value: draft.autoLance.valorMaxDia, disabled: ro(), onInput: (v) => { draft.autoLance.valorMaxDia = Math.round(v); validateAll(); drawBar(); } })),
            ro() ? ui.kv([['Passo sobre o melhor', fmt.taxa(draft.autoLance.passoSobreMelhor)]]) : ui.field({ label: labPasso }, ui.slider({ value: draft.autoLance.passoSobreMelhor, min: 0.01, max: 0.2, step: 0.01, format: (v) => fmt.taxa(v), onChange: (v) => { draft.autoLance.passoSobreMelhor = v; labPasso.textContent = `Passo sobre o melhor: ${fmt.taxa(v)}`; drawBar(); } })),
            ui.callout({ tone: 'info', title: `Hoje: ${fmt.brl(autoUso.usado, { round: true })} de ${fmt.brl(draft.autoLance.valorMaxDia, { round: true })} usados`, text: `${autoUso.n} lance(s) automático(s) hoje. Quando o teto diário estoura, o motor para até o dia seguinte.` })) : h('p.muted', 'Desativado: só lances manuais seus ou da sua equipe.'))),
        simuladorCard(state, () => draft),
        sugestoesCard(draft, () => { buildForm(); drawBar(); }, isAdmin),
        historicoCard(draft));
      drawBar();
    }

    buildForm();
    C.mount(root, h('div.stack',
      ui.pageHeader({ title: 'Política de crédito', subtitle: 'Regras determinísticas que o motor usa para avaliar e dar lances. Quem aprova é você.', actions: [ui.ai('regras auditáveis')] }),
      bar, formHost));
    return root;
  }

  function usoAutoLanceHoje() {
    const ini = C.cal.startOfDay(C.clock.now());
    const lances = db.where('lances', (l) => l.finId === me() && l.auto && l.criadoEm >= ini);
    const faces = lances.map((l) => { const op = db.get('operacoes', l.opId); return op ? op.face : 0; });
    return { usado: C.round2(C.sum(faces)), n: lances.length };
  }

  function diffPolitica(a, b) {
    const out = [];
    const money = (v) => fmt.brl(v, { round: true });
    const cmp = (campo, x, y, f) => { if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ campo, de: f ? f(x) : String(x), para: f ? f(y) : String(y) }); };
    cmp('Taxa mínima', a.taxaMinima, b.taxaMinima, (v) => fmt.taxa(v));
    cmp('Prazo', [a.prazoMin, a.prazoMax], [b.prazoMin, b.prazoMax], (v) => `${v[0]} a ${v[1]} dias`);
    cmp('Ticket', [a.ticketMin, a.ticketMax], [b.ticketMin, b.ticketMax], (v) => `${money(v[0])} a ${money(v[1])}`);
    cmp('Limite total', a.limiteTotal, b.limiteTotal, money);
    cmp('Limite padrão por cedente', a.limiteCedentePadrao, b.limiteCedentePadrao, money);
    cmp('Limite padrão por sacado', a.limiteSacadoPadrao, b.limiteSacadoPadrao, money);
    cmp('Programas', (a.produtos || []).join(','), (b.produtos || []).join(','), (v) => String(v).split(',').map((p) => F.prod(p)).join(', '));
    cmp('Rating mínimo', a.ratingMin, b.ratingMin);
    cmp('Setores bloqueados', (a.setoresBloqueados || []).join(','), (b.setoresBloqueados || []).join(','));
    cmp('Cedentes bloqueados', (a.cedentesBloqueados || []).join(','), (b.cedentesBloqueados || []).join(','));
    cmp('Exige regresso', a.exigeRegresso, b.exigeRegresso, (v) => v ? 'sim' : 'não');
    cmp('Exceções por cedente', a.limiteCedente, b.limiteCedente, (v) => Object.keys(v || {}).length + ' exceção(ões)');
    cmp('Exceções por sacado', a.limiteSacado, b.limiteSacado, (v) => Object.keys(v || {}).length + ' exceção(ões)');
    cmp('Lance automático', [a.autoLance.ativo, a.autoLance.valorMaxDia], [b.autoLance.ativo, b.autoLance.valorMaxDia], (v) => (v[0] ? 'ativo' : 'inativo') + `, teto ${money(v[1])}`);
    return out;
  }

  function historicoCard(draft) {
    const hst = (draft.historico || []).slice().reverse();
    return ui.card({ title: 'Versões', subtitle: 'Cada salvamento guarda quem mudou e o quê' },
      hst.length ? h('div.list', hst.map((hh) => h('div.list-item', icon('history', 14), h('div.grow', h('strong', hh.resumo), h('div.small.muted', `${fmt.datetime(hh.ts)} · ${hh.userNome || ''}`))))) : h('p.muted', 'Nenhuma versão salva ainda nesta sessão de demonstração.'));
  }

  function simuladorCard(state, getDraft) {
    const abertas = db.where('operacoes', (o) => o.status === 'aberta').sort((a, b) => b.face - a.face);
    const host = h('div');
    const simTaxa = ui.numeric({ value: state.simTaxa, suffix: '% a.m.', decimals: 2, min: 0.1, onInput: (v) => { if (v !== null) { state.simTaxa = v; draw(); } } });
    const simSel = ui.select({
      placeholder: 'Escolha uma operação aberta', searchable: true,
      options: abertas.map((o) => ({ value: o.id, label: `${o.id} · ${fmt.brl(o.face, { round: true })}`, hint: `${(db.get('orgs', o.cedenteId) || {}).fantasia} · ${F.prod(o.produto)}` })),
      onChange: (v) => { state.simOp = v; draw(); },
    });
    function draw() {
      const op = db.get('operacoes', state.simOp);
      if (!op) { C.mount(host, h('p.muted', 'Selecione uma operação para ver regra por regra.')); return; }
      const draft = getDraft();
      const fin = db.get('orgs', me());
      const real = fin.politica;
      fin.politica = draft;
      let res;
      try { res = E.checarPolitica(me(), op, state.simTaxa); } finally { fin.politica = real; }
      const melhor = E.melhorLance(op.id);
      const cobrir = melhor ? C.round2(melhor.taxaAm - (draft.autoLance.passoSobreMelhor || 0.01)) : null;
      const daria = res.ok && state.simTaxa >= draft.taxaMinima && (cobrir === null || state.simTaxa <= cobrir + 1e-9) && draft.autoLance.ativo;
      C.mount(host, h('div.stack.tight',
        h('div.list',
          res.aprovados.map((t) => h('div.list-item', h('span.tl-dot', icon('check', 12)), h('div.grow', t))),
          res.motivos.map((t) => h('div.list-item', h('span.tl-dot', icon('x', 12)), h('div.grow', h('strong', t))))),
        ui.callout({ tone: daria ? 'success' : 'info', title: daria ? `O motor daria lance de ${fmt.taxa(state.simTaxa)}` : 'O motor não daria lance',
          text: !draft.autoLance.ativo ? 'Lance automático desativado no rascunho: a decisão seria manual.' : !res.ok ? 'A operação estoura o envelope da política neste rascunho.' : state.simTaxa < draft.taxaMinima ? 'Taxa abaixo do piso: o lance automático não agiria (o manual continua possível).' : (cobrir !== null && state.simTaxa > cobrir + 1e-9) ? `Para cobrir, a taxa precisaria ser no máximo ${fmt.taxa(cobrir)}.` : 'Dentro do envelope.' })));
    }
    draw();
    return ui.card({ title: 'Simulador de política', subtitle: 'Testa o rascunho contra operações reais, sem executar nada', actions: [ui.ai('simulação')] },
      h('div.stack', ui.field({ label: 'Operação aberta' }, simSel), ui.field({ label: 'Taxa a testar (% a.m.)' }, simTaxa), host));
  }

  function sugestoesCard(draft, refresh, isAdmin) {
    const abertas = db.where('operacoes', (o) => o.status === 'aberta');
    const host = h('div');
    function draw() {
      const sug = [];
      const byMotivo = { ticket: [], rating: [], prazo: [], produto: [] };
      abertas.forEach((o) => {
        const r = E.checarPolitica(me(), o, draft.taxaMinima);
        if (r.ok) return;
        const m = r.motivos.join(' | ');
        if (/ticket/i.test(m)) byMotivo.ticket.push(o);
        else if (/Rating/i.test(m)) byMotivo.rating.push(o);
        else if (/Prazo/i.test(m)) byMotivo.prazo.push(o);
        else if (/Produto/i.test(m)) byMotivo.produto.push(o);
      });
      if (byMotivo.ticket.length) {
        const menor = Math.min(...byMotivo.ticket.map((o) => E.metricasOp(o, draft.taxaMinima).face));
        const alvo = Math.max(5000, Math.floor(menor / 5000) * 5000);
        sug.push({ titulo: `Reduzir o ticket mínimo para ${fmt.brl(alvo, { round: true })}`, texto: `${byMotivo.ticket.length} oportunidade(s) aberta(s) ficam de fora só pelo ticket (${fmt.brl(draft.ticketMin, { round: true })} hoje).`, aplicar: () => { draft.ticketMin = alvo; } });
      }
      if (byMotivo.rating.length) {
        sug.push({ titulo: 'Revisar o rating mínimo (caso a caso)', texto: `${byMotivo.rating.length} oportunidade(s) barrada(s) pelo rating mínimo ${draft.ratingMin}. A sugestão é avaliar o sacado, não baixar o piso no escuro.`, aplicar: null });
      }
      if (byMotivo.prazo.length) {
        const prazos = byMotivo.prazo.map((o) => E.metricasOp(o, draft.taxaMinima).prazoMedio);
        sug.push({ titulo: `Alargar a janela de prazo (${Math.min(...prazos)} a ${Math.max(...prazos)} dias)`, texto: `${byMotivo.prazo.length} oportunidade(s) fora da janela ${draft.prazoMin} a ${draft.prazoMax} dias.`, aplicar: () => { draft.prazoMin = Math.min(draft.prazoMin, Math.min(...prazos)); draft.prazoMax = Math.max(draft.prazoMax, Math.max(...prazos)); } });
      }
      C.mount(host, sug.length ? h('div.stack.tight', sug.map((s) => ui.card({ class: 'card-ai', title: s.titulo },
        h('div.row.between', ui.ai('sugestão da IA'), isAdmin && s.aplicar ? ui.btn('Aplicar sugestão', { variant: 'ai', size: 'sm', icon: 'wand-sparkles', onclick: () => { s.aplicar(); refresh(); ui.toast('Sugestão aplicada ao rascunho', { type: 'info', text: 'Confira e salve a política para valer.' }); } }) : null),
        h('p.small', s.texto),
        h('p.small.muted', 'A sugestão só preenche o rascunho. Quem salva é você.')))) : h('p.muted', 'Nenhuma sugestão agora: as oportunidades abertas passam na política atual.'));
    }
    draw();
    return ui.card({ title: 'Sugestões do agente de crédito', subtitle: 'Calculadas sobre as operações abertas agora', actions: [ui.ai('IA')] }, host);
  }

  /* ===================== 5. AGENTE DE CRÉDITO ===================== */
  const NIVEIS = [
    { id: 'sombra', label: 'Sombra', hint: 'Só observa e compara' },
    { id: 'assistido', label: 'Assistido', hint: 'Propõe, você executa' },
  ];
  function agentes() {
    const ag = db.get('agentes', 'ag-credito') || {};
    const fin = db.get('orgs', me());
    const nivel = fin.agenteCreditoNivel || ag.nivel || 'assistido';
    const isAdmin = C.can('admin');
    const m = ag.metricas || {};

    const abertas = db.where('operacoes', (o) => o.status === 'aberta' && (o.canal === 'vitrine' || o.financiadorAlvoId === me()));
    const pareceres = abertas.map((o) => ({ op: o, p: E.ia.parecer(o, me()) })).sort((a, b) => b.p.score - a.p.score).slice(0, 5);
    const stored = db.where('propostas', (p) => p.agenteId === 'ag-credito' && p.entidade.kind === 'operacao');
    const decided = {};
    stored.forEach((p) => { if (['aprovada', 'rejeitada'].includes(p.status)) decided[p.entidade.id] = p; });
    const aprovadas = stored.filter((p) => p.status === 'aprovada').length;
    const rejeitadas = stored.filter((p) => p.status === 'rejeitada').length;
    const ajustes = stored.filter((p) => p.ajustada).length;
    const taxaAceite = aprovadas + rejeitadas ? Math.round((aprovadas / (aprovadas + rejeitadas)) * 100) : Math.round((m.aceitas || 0) * 100);

    let segNivel = null;
    const trocarNivel = (v) => {
      if (!isAdmin) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('admin') }); if (segNivel) segNivel.value = nivel; return; }
      if (v !== 'sombra' && v !== 'assistido') return;
      db.patch('orgs', me(), { agenteCreditoNivel: v });
      ledger.append({ actor: E.actors.user(session.user().id), acao: 'agente.nivel_alterado', entidade: { kind: 'agente', id: 'ag-credito' }, resumo: `Agente de crédito: nível ${v} (teto: assistido)`, classe: 'R2' });
      ui.toast('Nível atualizado', { type: 'success', text: `Agente de crédito em modo ${v}.` });
      C.router.go('/financiador/agentes');
    };

    const propCards = pareceres.length ? pareceres.map(({ op, p }) => propostaCard(op, p, decided[op.id], nivel)) : ui.empty({ icon: 'sparkles', title: 'Sem oportunidades agora', text: 'Quando houver leilões abertos, o agente propõe taxa e lance aqui.' });

    const decisionLedger = ledger.all().filter((e) => e.actor && e.actor.id === 'ag-credito').slice(-8).reverse();

    return h('div.stack',
      ui.pageHeader({ title: 'Agente de crédito', subtitle: 'IA que propõe dentro da sua política. Quem dá o lance é você ou o motor.', actions: [ui.ai('D3 + D5')] }),
      ui.card({ title: 'Escada de autonomia', subtitle: 'O agente de crédito nunca passa de Assistido' },
        h('ol.fn2-ladder',
          h('li', { class: nivel === 'sombra' ? 'is-cur' : '' }, h('strong', 'Sombra'), h('span', 'Observa as oportunidades e compara a sugestão com o resultado, sem propor ação.')),
          h('li', { class: nivel === 'assistido' ? 'is-cur' : '' }, h('strong', 'Assistido'), h('span', 'Propõe taxa e lance na caixa abaixo; cada execução exige seu clique ou uma regra do motor.')),
          h('li.is-locked', h('strong', 'Autônomo'), h('span', 'Bloqueado para crédito: decisões com dinheiro exigem regra do motor ou pessoa.')))),
      ui.grid(2,
        ui.card({ title: ag.nome || 'Agente de Crédito', subtitle: ag.escopo || '', actions: [ui.badge('R2', 'violet')] },
          ui.kv([['Nível máximo', ag.nivelMaximo || 'assistido'], ['Execuções (30d)', m.execucoes30d || 0], ['Tempo médio', m.tempoMedio || ''], ['Correções', m.correcoes ? fmt.pct(m.correcoes * 100, 0) : '']])),
        ui.card({ title: 'Nível na Vértice', subtitle: isAdmin ? 'Você pode alternar entre Sombra e Assistido' : 'Somente leitura para o seu perfil' },
          h('div.stack.tight',
            (segNivel = ui.segmented({ value: nivel, block: true, options: NIVEIS.map((n) => ({ value: n.id, label: n.label })), onChange: trocarNivel })),
            h('p.small.muted', nivel === 'sombra' ? 'Em Sombra, o agente só observa: a caixa de propostas mostra as sugestões sem botão de execução.' : 'Em Assistido, cada proposta exige sua aprovação explícita.')))),
      ui.grid(3,
        ui.kpi({ label: 'Taxa de aceite', display: taxaAceite + '%', icon: 'badge-check', hint: `${aprovadas} aprovadas, ${rejeitadas} rejeitadas` }),
        ui.kpi({ label: 'Ajustes seus', display: String(ajustes), icon: 'pencil', hint: 'taxa alterada antes de executar' }),
        ui.kpi({ label: 'Tempo poupado', display: (pareceres.length * 4) + ' s', icon: 'timer', hint: 'triagem automática por proposta' })),
      ui.card({ title: 'Caixa de propostas', subtitle: nivel === 'sombra' ? 'Modo Sombra: sugestões sem execução' : 'Geradas agora sobre os leilões abertos', actions: [ui.ai('IA')] }, h('div.stack', propCards)),
      ui.card({ title: 'Decisões do agente (trilha)', subtitle: 'Filtrado pelo ator ag-credito' },
        decisionLedger.length ? ui.timeline(decisionLedger.map((e) => ({ icon: 'sparkles', tone: 'violet', title: e.resumo, ts: e.ts, actor: e.actor.nome }))) : h('p.muted', 'Nenhuma decisão registrada para este agente ainda.')));
  }

  function propostaCard(op, p, dec, nivel) {
    const ced = db.get('orgs', op.cedenteId) || {};
    const sombra = nivel === 'sombra';
    const taxaTxt = fmt.taxa(p.taxaSugerida);
    const acaoDar = () => {
      if (!canOp()) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('lance') }); return; }
      const r = E.darLance(op.id, me(), p.taxaSugerida, { userId: session.user().id });
      if (!r.ok) { ui.toast('Lance recusado pelo motor', { type: 'error', text: r.erro }); return; }
      db.put('propostas', { id: C.uid('pp'), agenteId: 'ag-credito', tipo: 'dar_lance', entidade: { kind: 'operacao', id: op.id }, resumo: `Aprovada: lance de ${taxaTxt} em ${op.id}`, evidencias: p.racional, confianca: p.confianca, classe: 'R2', status: 'aprovada', ts: C.clock.now(), nivelAgente: nivel, taxa: p.taxaSugerida });
      ui.toast('Lance registrado', { type: 'success', text: `${taxaTxt} em ${op.id}.`, link: '/financiador/lances' });
    };
    const acaoAjustar = () => {
      if (!canOp()) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('lance') }); return; }
      let taxa = p.taxaSugerida;
      const inp = ui.numeric({ value: taxa, suffix: '% a.m.', decimals: 2, min: 0.1, onInput: (v) => { if (v !== null) taxa = v; } });
      const modal = ui.modal({
        title: 'Ajustar e dar lance', subtitle: `${op.id} · sugestão ${taxaTxt}`, icon: 'pencil', size: 'sm',
        body: h('div.stack', ui.callout({ tone: 'ai', title: 'Você decide a taxa final', text: 'O ajuste fica registrado como correção do agente.' }), ui.field({ label: 'Taxa final (% a.m.)' }, inp)),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Dar lance', { variant: 'primary', onclick: () => {
          const r = E.darLance(op.id, me(), taxa, { userId: session.user().id });
          if (!r.ok) { ui.toast('Lance recusado pelo motor', { type: 'error', text: r.erro }); return; }
          db.put('propostas', { id: C.uid('pp'), agenteId: 'ag-credito', tipo: 'dar_lance', entidade: { kind: 'operacao', id: op.id }, resumo: `Ajustada: lance de ${fmt.taxa(taxa)} em ${op.id} (sugestão ${taxaTxt})`, evidencias: p.racional, confianca: p.confianca, classe: 'R2', status: 'aprovada', ajustada: true, taxa, ts: C.clock.now(), nivelAgente: nivel });
          ui.toast('Lance registrado', { type: 'success', text: `${fmt.taxa(taxa)} em ${op.id}.` });
          api.close(true);
        } })],
      });
      return modal.promise;
    };
    const acaoRejeitar = () => {
      if (!canOp()) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('lance') }); return; }
      let motivo = '';
      const inp = ui.input({ placeholder: 'Motivo da rejeição (ex.: sacado concentrado)', onInput: (v) => (motivo = v) });
      const modal = ui.modal({
        title: 'Rejeitar proposta', subtitle: op.id, icon: 'x', size: 'sm',
        body: ui.field({ label: 'Motivo', required: true, hint: 'Vira feedback para o agente.' }, inp),
        footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Rejeitar', { variant: 'danger', onclick: () => {
          if (!String(motivo).trim()) { ui.toast('Informe o motivo', { type: 'warn' }); return; }
          db.put('propostas', { id: C.uid('pp'), agenteId: 'ag-credito', tipo: 'dar_lance', entidade: { kind: 'operacao', id: op.id }, resumo: `Rejeitada: ${op.id} (${motivo})`, evidencias: p.racional, confianca: p.confianca, classe: 'R2', status: 'rejeitada', motivo, ts: C.clock.now(), nivelAgente: nivel });
          ui.toast('Proposta rejeitada', { type: 'info', text: 'Feedback registrado para o agente.' });
          api.close(true);
        } })],
      });
      return modal.promise;
    };
    return ui.card({ class: 'card-ai' }, h('div.stack.tight',
      h('div.row.between', h('div', h('a', { class: 'mono strong', href: opFinLink(op) }, op.id), h('div.small.muted', `${ced.fantasia || ''} · ${fmt.brl(op.face, { round: true })} · ${F.prod(op.produto)}`)), h('div.row', ui.ai('nota ' + p.score), ui.badge('R2', 'violet'))),
      h('p', h('strong', `Dar lance de ${taxaTxt} em ${op.id}`), p.cobreMelhor ? h('span.small.muted', ` (cobre o melhor, ${fmt.taxa(p.cobreMelhor)})`) : null),
      h('ul.fn2-evid', p.racional.map((e) => h('li', e))),
      h('p.small.muted', `Confiança ${fmt.pct((p.confianca || 0) * 100, 0)} · pior rating ${p.pior} · ${p.politica.ok ? 'dentro da política' : 'fora da política: ' + (p.politica.motivos[0] || '')}`),
      dec ? ui.callout({ tone: dec.status === 'aprovada' ? 'success' : 'warn', title: dec.status === 'aprovada' ? 'Proposta executada' : 'Proposta rejeitada', text: dec.resumo })
      : sombra ? h('p.small.muted', 'Modo Sombra: sugestão registrada, sem execução.')
      : h('div.row', ui.btn('Aprovar e dar lance', { variant: 'ai', size: 'sm', icon: 'gavel', disabled: !p.politica.ok, title: p.politica.ok ? '' : 'Fora da política: ' + (p.politica.motivos[0] || ''), onclick: C.guard('lance', acaoDar) }), ui.btn('Ajustar', { size: 'sm', icon: 'pencil', onclick: acaoAjustar }), ui.btn('Rejeitar', { variant: 'ghost', size: 'sm', onclick: acaoRejeitar }))));
  }

  /* ===================== 6. FATURAMENTO ===================== */
  function compNow() { const t = C.cal.sp(C.clock.now()); return t.y + '-' + String(t.m).padStart(2, '0'); }
  function faturamento() {
    const comp = compNow();
    const fatAll = () => db.where('faturas', (f) => f.finId === me()).sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
    const aPagar = C.round2(C.sum(fatAll().filter((f) => ['aberta', 'vencida'].includes(f.status)), (f) => f.total));
    const ano = comp.slice(0, 4);
    const pagoAno = C.round2(C.sum(fatAll().filter((f) => f.status === 'paga' && f.competencia.startsWith(ano)), (f) => f.total));
    const opsFechadas = db.where('operacoes', (o) => o.financiadorId === me() && ['liquidada', 'recomprada'].includes(o.status));
    const tsMedio = opsFechadas.length ? C.round2(C.sum(opsFechadas, (o) => (o.tsPct || 0) * o.face) / C.sum(opsFechadas, (o) => o.face)) : 0;

    const accOps = db.where('operacoes', (o) => o.financiadorId === me() && o.pagoEm && fmtComp(o.pagoEm) === comp && ['paga', 'vencida', 'parcial', 'liquidada', 'recomprada'].includes(o.status));
    const accTS = C.round2(C.sum(accOps, (o) => o.ts || 0));
    const accrual = ui.card({ title: `Provisão de ${fmt.monthLong(comp)}`, subtitle: 'Operações pagas no mês; vira fatura no fechamento' },
      accOps.length ? h('div.stack.tight',
        ui.table({
          rows: accOps, dense: true,
          columns: [
            { key: 'op', label: 'Operação', render: (o) => h('a', { class: 'mono strong', href: '#/financiador/operacoes/' + o.id }, o.id) },
            { key: 'face', label: 'Face', align: 'right', width: '124px', render: (o) => h('span.num', fmt.brl(o.face, { round: true })) },
            { key: 'ts', label: 'TS', align: 'right', width: '118px', render: (o) => h('span.num', fmt.brl(o.ts)) },
            { key: 'piso', label: 'Piso', width: '110px', mobile: 'hide', render: (o) => h('span.small.nowrap', o.tsNoPiso ? 'Piso aplicado' : 'Pelo spread') },
          ],
          footer: () => [h('td', { colspan: 2 }, h('strong', 'Total provisionado'), h('span.small.muted', ' (TS congelada no aceite)')), h('td.ta-right', h('strong.num', fmt.brl(accTS))), h('td')],
        }))
        : ui.empty({ icon: 'receipt', title: 'Sem operações pagas no mês', text: 'A TS das operações pagas neste mês aparece aqui antes do fechamento.' }));

    const rows = fatAll();
    const tbl = ui.table({
      rows, rowKey: (r) => r.id,
      empty: ui.empty({ icon: 'receipt', title: 'Sem faturas', text: 'As faturas de TS e Taxa de Acesso aparecem aqui após o fechamento mensal.' }),
      columns: [
        { key: 'comp', label: 'Competência', mobile: 'primary', render: (f) => h('strong', fmt.monthLong(f.competencia)) },
        { key: 'ts', label: 'TS', align: 'right', width: '118px', render: (f) => h('span.num', fmt.brl(f.tsTotal)) },
        { key: 'acesso', label: 'Taxa de Acesso', align: 'right', width: '118px', render: (f) => h('span.num', f.taxaAcesso ? fmt.brl(f.taxaAcesso) : 'Isenta') },
        { key: 'motivo', label: 'Motivo', mobile: 'hide', render: (f) => h('span.small', motivoAcesso(f)) },
        { key: 'total', label: 'Total', align: 'right', width: '124px', render: (f) => h('strong.num', fmt.brl(f.total)) },
        { key: 'venc', label: 'Vencimento', width: '104px', mobile: 'hide', render: (f) => h('span.num', fmt.date(f.vencimento)) },
        { key: 'st', label: 'Status', render: (f) => ui.status('fatura', f.status) },
        { key: 'ac', label: '', render: (f) => ui.iconBtn('eye', { label: 'Ver fatura ' + f.competencia, size: 'sm', onclick: () => faturaDrawer(f) }) },
      ],
    });

    return h('div.stack',
      ui.pageHeader({ title: 'Faturamento', subtitle: 'TS sobre o spread mais Taxa de Acesso. Boleto com vencimento em +10 dias.' }),
      ui.grid(3,
        ui.kpi({ label: 'A pagar (abertas)', value: aPagar, fmt: 'brl', icon: 'receipt', tone: aPagar > 0 ? 'amber' : undefined }),
        ui.kpi({ label: 'Pago em ' + ano, value: pagoAno, fmt: 'brl', icon: 'circle-check', tone: 'green' }),
        ui.kpi({ label: 'TS média', display: fmt.pct(tsMedio, 0), icon: 'percent', hint: '% do spread, ponderada pela face' })),
      accrual,
      ui.card({ title: 'Faturas (jun a out e seguintes)', subtitle: 'Toque no olho para itemizar e ver o boleto' }, tbl),
      ui.callout({ tone: 'info', title: 'Regras de cobrança', text: 'TS em % do spread sobre a SELIC, congelada no aceite de cada operação (o % não muda depois). Taxa de Acesso de R$ 1.999/mês: carência de 2 meses para contas novas e isenta no mês com ao menos 1 operação paga. Reajuste anual pelo IPCA todo 1º de janeiro.' }));
  }
  const fmtComp = (ts) => { const t = C.cal.sp(ts); return t.y + '-' + String(t.m).padStart(2, '0'); };
  function motivoAcesso(f) {
    if (f.taxaAcesso && f.taxaAcesso > 0) return 'cobrada';
    return (f.taxaAcessoMotivo || '').includes('carência') ? 'Carência (conta nova)' : (f.taxaAcessoMotivo || '').includes('isenta') ? 'Isenta (operação paga)' : (f.taxaAcessoMotivo || 'Isenta');
  }
  function faturaDrawer(f) {
    const itens = (f.itens || []).map((it) => ({ op: db.get('operacoes', it.opId), face: it.face, tsPct: it.tsPct, noPiso: it.noPiso, ts: it.ts }));
    const body = h('div.stack',
      ui.kv([['Competência', fmt.monthLong(f.competencia)], ['Vencimento', fmt.date(f.vencimento) + ' (+10 dias, boleto)'], ['Status', ui.status('fatura', f.status)], ['TS total', fmt.brl(f.tsTotal)], ['Taxa de Acesso', f.taxaAcesso ? fmt.brl(f.taxaAcesso) + ' (' + motivoAcesso(f) + ')' : motivoAcesso(f)], ['Total', h('strong', fmt.brl(f.total))]]),
      ui.table({
        rows: itens, dense: true,
        columns: [
          { key: 'op', label: 'Operação', render: (it) => it.op ? h('a', { class: 'mono strong', href: '#/financiador/operacoes/' + it.op.id }, it.op.id) : h('span.mono', '') },
          { key: 'face', label: 'Face', align: 'right', width: '118px', render: (it) => h('span.num', fmt.brl(it.face, { round: true })) },
          { key: 'pct', label: 'TS %', align: 'right', width: '72px', render: (it) => h('span.num', fmt.pct(it.tsPct || 0, 0)) },
          { key: 'piso', label: 'Piso', width: '96px', mobile: 'hide', render: (it) => h('span.small.nowrap', it.noPiso ? 'Aplicado' : 'Spread') },
          { key: 'ts', label: 'TS (R$)', align: 'right', width: '118px', render: (it) => h('span.num', fmt.brl(it.ts)) },
        ],
      }),
      h('p.small.muted', 'TS % congelada no aceite de cada operação; não muda após o aceite.'),
      ui.card({ title: 'Boleto', subtitle: 'Linha digitável' },
        h('div.stack.tight', h('code.fn2-boleto', f.boleto || 'Sem linha digitável'),
          h('div.row',
            ui.btn('Copiar código', { icon: 'copy', size: 'sm', onclick: () => copyText(f.boleto || '', 'Linha digitável copiada') }),
            ['aberta', 'vencida'].includes(f.status) && canOp() ? ui.btn('Marcar como pago', { variant: 'primary', size: 'sm', icon: 'check', onclick: C.guard('operar', async () => {
              if (!await ui.confirm({ title: 'Confirmar pagamento?', text: `Baixar a fatura ${fmt.monthLong(f.competencia)} (${fmt.brl(f.total)}) como paga. Demonstração: sem integração bancária.`, confirmLabel: 'Marcar como pago' })) return;
              db.patch('faturas', f.id, { status: 'paga', pagaEm: C.clock.now() });
              ledger.append({ actor: E.actors.user(session.user().id), acao: 'fatura.paga', entidade: { kind: 'fatura', id: f.id }, resumo: `Fatura ${f.competencia} baixada como paga (${fmt.brl(f.total)})`, classe: 'R2' });
              ui.toast('Fatura baixada', { type: 'success', text: fmt.monthLong(f.competencia) });
              if (body._closeDrawer) body._closeDrawer();
              C.router.go('/financiador/faturamento');
            }) }) : null,
            !canOp() && ['aberta', 'vencida'].includes(f.status) ? noPerm('operar') : null))));
    const api = ui.drawer({ title: 'Fatura ' + fmt.monthLong(f.competencia), subtitle: f.id, icon: 'receipt', size: 'md', body });
    body._closeDrawer = () => api.close();
  }

  /* ===================== 7. RELATÓRIOS ===================== */
  function relatorios(ctx) {
    const per = (ctx.query && ctx.query.per) || '6M';
    const n = per === '3M' ? 3 : per === '12M' ? 12 : 6;
    const tabs = ui.segmented({ value: per, aria: 'Período do relatório', options: [{ value: '3M', label: '3 meses' }, { value: '6M', label: '6 meses' }, { value: '12M', label: '12 meses' }], onChange: (v) => C.router.go('/financiador/relatorios?per=' + v) });
    const months = lastMonths(n);
    const vol = months.map((m) => ({ x: m.label, y: volumeMes(m.comp) }));
    const ret = months.map((m) => ({ x: m.label, y: retornoMes(m.comp) }));
    const byOps = myOps().filter((o) => o.pagoEm && months.some((m) => m.comp === fmtComp(o.pagoEm)));
    const byCed = agg(byOps, (o) => (db.get('orgs', o.cedenteId) || {}).fantasia || o.cedenteId);
    const sacAgg = {};
    byOps.forEach((o) => openTitsAll(o).forEach((t) => { const k = (db.get('orgs', t.sacadoId) || {}).fantasia || t.sacadoId; sacAgg[k] = (sacAgg[k] || 0) + t.valor; }));
    const fechadas = byOps.filter((o) => ['liquidada', 'recomprada'].includes(o.status));
    const host = h('div');

    const tbl = ui.table({
      rows: fechadas.sort((a, b) => (b.liquidadaEm || b.pagoEm || 0) - (a.liquidadaEm || a.pagoEm || 0)),
      empty: ui.empty({ icon: 'list', title: 'Sem operações encerradas no período', text: 'Liquidações e recompras aparecem aqui com TS e retorno líquido.' }),
      columns: [
        { key: 'op', label: 'Operação', mobile: 'primary', render: (o) => h('a', { class: 'mono strong', href: '#/financiador/operacoes/' + o.id }, o.id) },
        { key: 'ced', label: 'Cedente', mobile: 'hide', render: (o) => h('span', (db.get('orgs', o.cedenteId) || {}).fantasia || '') },
        { key: 'face', label: 'Face', align: 'right', width: '118px', render: (o) => h('span.num', fmt.brl(o.face, { round: true })) },
        { key: 'taxa', label: 'Taxa', align: 'right', width: '96px', mobile: 'hide', render: (o) => h('span.num', fmt.taxa(o.taxaFinal)) },
        { key: 'ts', label: 'TS', align: 'right', width: '118px', render: (o) => h('span.num', fmt.brl(o.ts)) },
        { key: 'ret', label: 'Retorno líquido', align: 'right', width: '130px', sort: true, render: (o) => h('strong.num', fmt.brl(C.round2((o.desagio || 0) - (o.ts || 0)))) },
      ],
    });
    const exportar = () => {
      const rows = fechadas.map((o) => [o.id, fmtComp(o.pagoEm || 0), (db.get('orgs', o.cedenteId) || {}).fantasia || o.cedenteId, o.face.toFixed(2).replace('.', ','), String(o.taxaFinal).replace('.', ','), (o.ts || 0).toFixed(2).replace('.', ','), C.round2((o.desagio || 0) - (o.ts || 0)).toFixed(2).replace('.', ',')]);
      downloadCSV('relatorio-vertice.csv', ['Operação', 'Competência do pagamento', 'Cedente', 'Face (R$)', 'Taxa (% a.m.)', 'TS (R$)', 'Retorno líquido (R$)'], rows);
      ui.toast('CSV exportado', { type: 'success', text: `${rows.length} operação(ões).` });
    };

    return h('div.stack', { class: 'fn2-report' },
      ui.pageHeader({ title: 'Relatórios', subtitle: 'Desempenho da carteira no período.', actions: [ui.btn('Imprimir', { icon: 'printer', onclick: () => window.print(), class: 'fn2-no-print' }), ui.btn('Exportar CSV', { icon: 'download', onclick: exportar, class: 'fn2-no-print' })] }),
      h('div.fn2-no-print', tabs),
      ui.grid(2,
        ui.card({ title: 'Retorno líquido por mês', subtitle: 'Deságio menos TS das encerradas' }, ui.chart.line({ series: [{ name: 'Retorno líquido', tone: 'teal', data: ret }], format: (v) => fmt.brl(v, { round: true }), height: 200 })),
        ui.card({ title: 'Volume adquirido por mês', subtitle: 'Face das operações pagas' }, ui.chart.bars({ categories: vol.map((d) => d.x), series: [{ name: 'Face', tone: 'blue', data: vol.map((d) => Math.round(d.y)) }], format: (v) => fmt.brl(v, { round: true }), height: 200 }))),
      ui.grid(2,
        ui.card({ title: 'Por cedente', subtitle: 'Face no período' }, byCed.length ? ui.chart.hbars(byCed, { format: (v) => fmt.brl(v, { round: true }) }) : h('p.muted', 'Sem volume no período.')),
        ui.card({ title: 'Por sacado', subtitle: 'Face no período' }, Object.keys(sacAgg).length ? ui.chart.hbars(Object.entries(sacAgg).map(([label, value]) => ({ label, value: C.round2(value), tone: 'green' })), { format: (v) => fmt.brl(v, { round: true }) }) : h('p.muted', 'Sem volume no período.'))),
      ui.card({ title: 'Por programa', subtitle: 'Face no período' }, byProg(byOps)),
      ui.card({ title: 'Operações encerradas', subtitle: 'Com TS e retorno líquido' }, tbl));
  }
  function lastMonths(n) {
    const t = C.cal.sp(C.clock.now());
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      let m = t.m - i, y = t.y;
      while (m < 1) { m += 12; y--; }
      out.push({ comp: y + '-' + String(m).padStart(2, '0'), label: C.cal.MES[m - 1] + '/' + String(y).slice(2) });
    }
    return out;
  }
  function volumeMes(comp) { return C.round2(C.sum(db.where('operacoes', (o) => o.financiadorId === me() && o.pagoEm && fmtComp(o.pagoEm) === comp), (o) => o.face)); }
  function retornoMes(comp) {
    return C.round2(C.sum(db.where('operacoes', (o) => o.financiadorId === me() && ['liquidada', 'recomprada'].includes(o.status) && fmtComp(o.liquidadaEm || o.pagoEm || 0) === comp), (o) => (o.desagio || 0) - (o.ts || 0)));
  }
  function agg(ops, key) {
    const m = new Map();
    ops.forEach((o) => { const k = key(o); m.set(k, (m.get(k) || 0) + o.face); });
    const tones = ['blue', 'teal', 'green', 'amber', 'violet'];
    return [...m.entries()].map(([label, value], i) => ({ label, value: C.round2(value), tone: tones[i % tones.length] })).sort((a, b) => b.value - a.value);
  }
  function openTitsAll(op) { return tits(op); }
  function byProg(ops) {
    const m = new Map();
    ops.forEach((o) => m.set(o.produto, (m.get(o.produto) || 0) + o.face));
    const items = [...m.entries()].map(([p, v], i) => ({ label: F.prod(p), value: C.round2(v), tone: ['teal', 'blue', 'green', 'amber', 'violet'][i % 5] }));
    return items.length ? ui.chart.donut(items, { format: (v) => fmt.brl(v, { round: true }) }) : h('p.muted', 'Sem volume no período.');
  }

  /* ------------------------------ rotas ---------------------------------- */
  C.router.register([
    { path: '/financiador/carteira', roles: ['financiador'], title: 'Carteira', render: carteira },
    { path: '/financiador/operacoes/:id', roles: ['financiador'], title: 'Operação', render: opDetail },
    { path: '/financiador/repasses', roles: ['financiador'], title: 'Repasses', render: repasses },
    { path: '/financiador/politica', roles: ['financiador'], title: 'Política de crédito', render: politica },
    { path: '/financiador/agentes', roles: ['financiador'], title: 'Agente de crédito', render: agentes },
    { path: '/financiador/faturamento', roles: ['financiador'], title: 'Faturamento', render: faturamento },
    { path: '/financiador/relatorios', roles: ['financiador'], title: 'Relatórios', render: relatorios },
  ]);
})();
