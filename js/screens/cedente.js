/* Cedy protótipo 0.1, telas do cedente (A): início, títulos, importar, nova operação.
   Rotas: /cedente, /cedente/titulos, /cedente/importar, /cedente/nova-operacao. */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt, cal } = C;
  const ui = C.ui;
  const { db, session, ledger } = C.store;
  const E = C.engine;
  const F = C.flows;

  const now = () => C.clock.now();
  const orgOf = (ctx) => ctx.org || db.get('orgs', session.get().orgId);
  const userOf = (ctx) => ctx.user || session.user();
  const can = (p) => C.can(p);
  const noPerm = (p) => ({ disabled: true, title: C.cannotMsg(p) });

  function titulosDoCedente(orgId) { return db.where('titulos', (t) => t.orgId === orgId); }
  function opsDoCedente(orgId) { return db.where('operacoes', (o) => o.cedenteId === orgId); }
  function lotesDoCedente(orgId) { return db.where('lotes', (l) => l.cedenteId === orgId).sort((a, b) => b.criadoEm - a.criadoEm); }
  function sacadoDe(t) { return t.sacadoId ? db.get('orgs', t.sacadoId) : null; }
  function diasAte(ts) { return cal.daysBetween(now(), ts); }
  function produtoDe(t) { return db.get('produtos', t.produto) || { nome: t.produto }; }

  function saudacao() { const t = cal.sp(now()); return t.h < 12 ? 'Bom dia' : t.h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function primeiroNome(nome) { return String(nome || '').split(' ')[0]; }

  /* ============================ ATENÇÃO (início) ============================ */
  function itensAtencao(org, user) {
    const items = [];
    const ops = opsDoCedente(org.id);
    // ofertas em leilões abertos
    ops.filter((o) => o.status === 'aberta').forEach((o) => {
      const lances = E.lancesDaOp(o.id).filter((l) => ['ativo', 'superado'].includes(l.status));
      const melhor = E.melhorLance(o.id);
      if (melhor) items.push({ icon: 'gavel', tone: 'blue', title: `${o.id} tem ${lances.length === 1 ? '1 oferta' : lances.length + ' ofertas'}, melhor a ${fmt.taxa(melhor.taxaAm)}`, sub: o.canal === 'balcao' ? 'Balcão, oferta firme por 3h' : 'Vitrine, leilão reverso', side: ui.countdown(o.validadeAte, { prefix: 'encerra em', endLabel: 'oferta encerrada' }), action: ui.btn('Ver ofertas', { size: 'sm', route: '/cedente/operacoes/' + o.id }) });
    });
    // cessão aguardando assinatura do cedente
    ops.filter((o) => o.status === 'cessao').forEach((o) => {
      const ct = o.contratoId && db.get('contratos', o.contratoId);
      const falta = !ct || !(ct.assinaturas || []).some((s) => s.parte === 'cedente');
      if (falta) items.push({ icon: 'file-signature', tone: 'amber', title: `Assine a cessão de ${o.id}`, sub: `${fmt.brl(o.liquido)} líquidos, ${(db.get('orgs', o.financiadorId) || {}).fantasia || 'financiador'}`, action: ui.btn('Assinar', Object.assign({ size: 'sm', variant: 'primary', onclick: () => F.assinar(o.contratoId, 'cedente') }, can('assinar') ? {} : noPerm('assinar'))) });
    });
    // pagamento do financiador em atraso
    ops.filter((o) => o.status === 'aguardando_pagamento' && now() > o.pagamentoLimite).forEach((o) => {
      items.push({ icon: 'triangle-alert', tone: 'amber', title: `Pagamento de ${o.id} em atraso`, sub: `${fmt.brl(o.liquido)} previstos até ${fmt.datetime(o.pagamentoLimite)}`, action: ui.btn('Ver operação', { size: 'sm', route: '/cedente/operacoes/' + o.id }) });
    });
    // vencidas e recompra
    ops.filter((o) => ['vencida', 'parcial'].includes(o.status)).forEach((o) => {
      if (o.recompra && o.recompra.status === 'devida') items.push({ icon: 'rotate-ccw', tone: 'red', title: `Recompra devida em ${o.id}: ${fmt.brl(o.recompra.valor)}`, sub: `Prazo até ${fmt.date(o.recompra.ate)}. Multa e mora já incluídas.`, action: ui.btn('Ver operação', { size: 'sm', route: '/cedente/operacoes/' + o.id }) });
      else if (o.status === 'vencida') items.push({ icon: 'triangle-alert', tone: 'red', title: `${o.id} vencida sem liquidação`, sub: 'Verifique com o sacado, a régua de cobrança já foi acionada', action: ui.btn('Ver operação', { size: 'sm', route: '/cedente/operacoes/' + o.id }) });
    });
    // lotes em validação / recusados
    lotesDoCedente(org.id).filter((l) => l.status === 'validando').forEach((l) => {
      items.push({ icon: 'hourglass', tone: 'amber', title: `Lote ${l.id} em validação na Mesa`, sub: `${fmt.plural(l.titulos.length, 'título', 'títulos')}, ${fmt.brl(l.total)}`, side: ui.countdown(l.slaAte, { prefix: 'meta em', endLabel: 'meta estourada' }), action: ui.btn('Ver lote', { size: 'sm', route: '/cedente/titulos' }) });
    });
    lotesDoCedente(org.id).filter((l) => l.status === 'recusado').slice(0, 2).forEach((l) => {
      items.push({ icon: 'file-x', tone: 'red', title: `Lote ${l.id} recusado`, sub: l.motivo || 'Veja o motivo no detalhe do lote', action: ui.btn('Ver lote', { size: 'sm', route: '/cedente/titulos' }) });
    });
    // mesa conciliadora
    db.where('casosMesa', (c) => c.cedenteId === org.id && c.status === 'aberto').forEach((c) => {
      items.push({ icon: 'git-compare', tone: 'amber', title: `Crédito de ${fmt.brl(c.valor)} na Mesa Conciliadora`, sub: c.motivo, side: ui.countdown(c.slaAte, { prefix: 'prazo em', endLabel: 'prazo estourado' }), action: ui.btn('Ver conta', { size: 'sm', route: '/cedente/conta' }) });
    });
    // cadastro / kyc
    if (org.status === 'suspenso') items.push({ icon: 'ban', tone: 'red', title: 'Cadastro suspenso', sub: org.motivoSuspensao || 'Fale com a Mesa de Operações', action: ui.btn('Ver cadastro', { size: 'sm', route: '/cedente/cadastro' }) });
    else if (['kyc', 'pendente'].includes(org.status)) {
      const k = db.get('kyc', 'kyc-' + org.id);
      items.push({ icon: 'id-card', tone: 'amber', title: 'Cadastro com pendências', sub: (k && k.agenteResumo) || 'Envie os documentos solicitados', action: ui.btn('Ver cadastro', { size: 'sm', route: '/cedente/cadastro' }) });
    }
    // confia aguardando sacado
    const confia = titulosDoCedente(org.id).filter((t) => t.produto === 'confia' && t.lastro && t.lastro.aceiteSacado === 'pendente' && !['recusado', 'liquidado'].includes(t.status));
    if (confia.length) items.push({ icon: 'user', tone: 'blue', title: `${fmt.plural(confia.length, 'título aguarda', 'títulos aguardam')} confirmação do sacado (Confia)`, sub: [...new Set(confia.map((t) => (sacadoDe(t) || {}).fantasia).filter(Boolean))].slice(0, 3).join(', '), action: ui.btn('Ver títulos', { size: 'sm', route: '/cedente/titulos?q=confia' }) });
    return items;
  }

  function cardAtencao(org, user) {
    return ui.live(['operacoes', 'lances', 'titulos', 'lotes', 'casosMesa', 'contratos', 'orgs'], () => {
      const items = itensAtencao(org, user);
      if (!items.length) return ui.card({ title: 'Precisa da sua atenção' }, ui.empty({ icon: 'circle-check', title: 'Nada pendente', text: 'Nenhuma oferta, assinatura, validação ou cobrança precisa de você agora.' }));
      return ui.card({ title: 'Precisa da sua atenção', subtitle: fmt.plural(items.length, 'item pedindo ação', 'itens pedindo ação') },
        h('ul.ced-attn', items.map((it) => h('li.ced-attn-item',
          h('span', { class: ['ced-attn-ic', 'tone-' + it.tone] }, icon(it.icon, 18)),
          h('div.grow', h('strong', it.title), it.sub && h('div.small.muted', it.sub)),
          h('div.ced-attn-act', it.side, it.action)))));
    });
  }

  /* ============================ INÍCIO ============================ */
  function kpisInicio(org) {
    return ui.live(['titulos', 'operacoes'], () => {
      const disp = titulosDoCedente(org.id).filter((t) => t.status === 'disponivel');
      const somaDisp = C.sum(disp, (t) => t.valor);
      const lar = E.lar(org.id);
      const ult30 = opsDoCedente(org.id).filter((o) => o.pagoEm && o.pagoEm >= now() - 30 * 86400000 && ['paga', 'parcial', 'vencida', 'liquidada'].includes(o.status));
      const face30 = C.sum(ult30, (o) => o.face);
      const comCet = ult30.filter((o) => o.cetAm);
      const cetMed = comCet.length ? C.sum(comCet, (o) => o.cetAm * o.face) / C.sum(comCet, (o) => o.face) : null;
      const selic = E.selicAm();
      const pctLar = lar && lar.limite ? Math.max(0, Math.min(100, (lar.disponivel / lar.limite) * 100)) : 0;
      return [h('div.grid.g4',
        ui.kpi({ label: 'Disponível para antecipar', icon: 'banknote', display: fmt.brl(somaDisp), hint: fmt.plural(disp.length, 'título liberado', 'títulos liberados'), onclick: () => C.router.go('/cedente/titulos') }),
        ui.kpi({ label: 'Limite disponível (LAR)', icon: 'gauge', display: lar ? fmt.brl(lar.disponivel) : '—', hint: lar ? `de ${fmt.brlCompact(lar.limite)} no total` : 'sem limite calculado', tone: lar && lar.disponivel <= 0 ? 'red' : null }),
        ui.kpi({ label: 'Antecipado em 30 dias', icon: 'trending-up', display: fmt.brl(face30), hint: fmt.plural(ult30.length, 'operação paga', 'operações pagas') }),
        ui.kpi({ label: 'Custo efetivo médio', icon: 'percent', display: cetMed !== null ? fmt.taxa(cetMed) : '—', hint: `SELIC ${fmt.taxa(selic)}`, delta: cetMed !== null ? Math.abs(cetMed - selic) * -1 : undefined, deltaGood: false })),
        lar && lar.limite ? h('div.ced-larline', h('div.row.between.small', h('span.muted', 'Limite livre do total'), h('strong.num', `${fmt.num(pctLar, 0)}%`)), ui.progress(pctLar, { tone: pctLar < 15 ? 'red' : pctLar < 40 ? 'amber' : null })) : null];
    });
  }

  function mesesJunNov() { return [6, 7, 8, 9, 10, 11].map((m) => ({ comp: `2026-${String(m).padStart(2, '0')}`, ini: cal.spTs(2026, m, 1, 0, 0), fim: m === 12 ? cal.spTs(2027, 1, 1, 0, 0) : cal.spTs(2026, m + 1, 1, 0, 0) })); }
  function cardVolume(org) {
    const meses = mesesJunNov();
    const porMes = meses.map((mm) => opsDoCedente(org.id).filter((o) => o.pagoEm && o.pagoEm >= mm.ini && o.pagoEm < mm.fim));
    const vols = porMes.map((ops) => C.round2(C.sum(ops, (o) => o.face)));
    const taxas = porMes.map((ops) => { const c = ops.filter((o) => o.taxaFinal); return c.length ? C.round2(C.sum(c, (o) => o.taxaFinal * o.face) / C.sum(c, (o) => o.face)) : null; });
    return ui.card({ title: 'Volume antecipado', subtitle: 'Junho a novembro, por mês de pagamento' },
      ui.chart.bars({ categories: ['jun', 'jul', 'ago', 'set', 'out', 'nov'], series: [{ name: 'Antecipado', tone: 'blue', data: vols }], format: (v) => fmt.brlCompact(v), height: 200 }),
      h('div.ced-taxrow', taxas.map((t, i) => h('span.ced-taxcell', h('small', ['jun', 'jul', 'ago', 'set', 'out', 'nov'][i]), h('strong.num', t !== null ? fmt.taxa(t) : '—')))),
      h('div.small.muted', 'Taxa média ponderada de cada mês.'));
  }

  function proximosRecebimentos(org) {
    return ui.live(['operacoes'], () => {
      const linhas = [];
      opsDoCedente(org.id).filter((o) => ['paga', 'parcial'].includes(o.status) && o.planoSacado).forEach((o) => {
        o.planoSacado.filter((p) => !p.emitido && p.ts >= now() - 86400000).forEach((p) => {
          const s = db.get('orgs', p.sacadoId);
          linhas.push({ ts: p.ts, dia: cal.key(p.ts), sacado: s ? (s.fantasia || s.nome) : 'Sacado', valor: p.valor, opId: o.id });
        });
      });
      linhas.sort((a, b) => a.ts - b.ts);
      if (!linhas.length) return ui.card({ title: 'Próximos recebimentos' }, ui.empty({ icon: 'calendar', title: 'Sem recebimentos previstos', text: 'Pagamentos de sacados aparecem aqui quando entram no plano da operação.' }));
      const grupos = C.groupBy(linhas, (l) => l.dia);
      const dias = Object.keys(grupos).sort().slice(0, 5);
      return ui.card({ title: 'Próximos recebimentos', subtitle: 'Sacados pagando na sua conta de liquidação', actions: [ui.btn('Ver agenda', { variant: 'ghost', size: 'sm', route: '/cedente/conta' })] },
        h('ul.ced-rec', dias.map((d) => {
          const g = grupos[d];
          return h('li.ced-rec-item', h('div.ced-rec-dia', h('strong', fmt.dateShort(g[0].ts)), h('small', fmt.weekday(g[0].ts))), h('div.grow', g.map((l) => h('div.small', `${l.sacado} · `, h('span.mono', l.opId)))), h('strong.num', fmt.brl(C.sum(g, (l) => l.valor))));
        })));
    });
  }

  /** Faixa de preço da sugestão (P25 a P75) com marcador na taxa sugerida. */
  function faixaPreco(sug, lo, hi) {
    const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    return h('div',
      h('div.ced-range', h('i.ced-range-bar', { style: { left: pos(sug.faixa[0]) + '%', width: Math.max(3, pos(sug.faixa[1]) - pos(sug.faixa[0])) + '%' } }), h('i.ced-range-pin', { style: { left: pos(sug.sugerida) + '%' } })),
      h('div.row.between.nowrap.small', h('span', `P25 ${fmt.num(sug.faixa[0], 2)}%`), h('strong', `Sugerida ${fmt.taxa(sug.sugerida)}`), h('span', `P75 ${fmt.num(sug.faixa[1], 2)}%`)));
  }

  function cardSugestao(org) {
    return ui.live(['titulos'], () => {
      const disp = titulosDoCedente(org.id).filter((t) => t.status === 'disponivel');
      if (!disp.length) return ui.card({ tone: 'ai', class: 'card-ai', title: h('span', ui.ai('Assistente'), ' Sugestão') }, h('p', 'Sem títulos disponíveis agora. Importe NF-e para receber uma sugestão de taxa e teto.'));
      const soma = C.sum(disp, (t) => t.valor);
      const prods = C.groupBy(disp, (t) => t.produto);
      const prodTop = Object.keys(prods).sort((a, b) => prods[b].length - prods[a].length)[0];
      const prazoMed = Math.round(C.sum(disp, (t) => t.valor * Math.max(1, diasAte(t.vencimento))) / soma);
      let sug = null;
      try { sug = E.ia.sugerirTaxa({ produto: prodTop, prazoMedio: prazoMed }); } catch (e) { sug = null; }
      const pub = can('publicar');
      const ids = disp.map((t) => t.id).join(',');
      return ui.card({ class: 'card-ai', title: h('span', ui.ai('Assistente'), ' Sugestão para você') },
        h('p', ['Você tem ', h('strong', fmt.plural(disp.length, 'título disponível', 'títulos disponíveis')), ' somando ', h('strong', fmt.brl(soma)), `, prazo médio de ${prazoMed} dias.`]),
        sug && faixaPreco(sug, 1, 3.5),
        sug && h('ul.ced-why', sug.racional.slice(0, 3).map((r) => h('li.small.muted', r))),
        h('div.row',
          sug ? ui.btn('Usar sugestão', Object.assign({ variant: 'ai', icon: 'sparkles', onclick: () => C.router.go('/cedente/nova-operacao?titulos=' + ids + '&taxa=' + sug.sugerida) }, pub ? {} : noPerm('publicar'))) : null,
          ui.btn('Montar operação', Object.assign({ route: '/cedente/nova-operacao?titulos=' + ids }, pub ? {} : noPerm('publicar')))));
    });
  }

  function cardMercado() {
    const fechadas = db.all('operacoes').filter((o) => o.taxaFinal).sort((a, b) => (b.aceitaEm || 0) - (a.aceitaEm || 0)).slice(0, 14).map((o) => o.taxaFinal);
    if (fechadas.length < 2) return ui.card({ title: 'Mercado' }, h('p.muted.small', 'Sem histórico suficiente de taxas fechadas.'));
    const stat = (label, v) => h('div', h('div.small.muted', label), h('strong.num', fmt.taxa(v)));
    return ui.card({ title: 'Mercado', subtitle: `Últimas ${fechadas.length} taxas fechadas na plataforma` },
      h('div.row.between', h('div', h('div.ced-big.num', fmt.taxa(fechadas[0])), h('div.small.muted', 'última taxa fechada')), ui.chart.spark(fechadas.slice().reverse(), { tone: 'blue' })),
      h('div.ced-mkt', stat('Menor', Math.min(...fechadas)), stat('Média', C.sum(fechadas, (v) => v) / fechadas.length), stat('Maior', Math.max(...fechadas))));
  }

  function renderHome(ctx) {
    const org = orgOf(ctx);
    const user = userOf(ctx);
    const pub = can('publicar'), imp = can('importar');
    return h('div.stack',
      ui.pageHeader({ eyebrow: `${org.fantasia || org.nome} · Cedente`, title: `${saudacao()}, ${primeiroNome(user.nome)}`, subtitle: `${fmt.dateLong(now())}, ${fmt.time(now())}. Aceite até 14h30 em dia útil e receba no mesmo dia.`, actions: [ui.btn('Importar títulos', Object.assign({ icon: 'upload', route: '/cedente/importar' }, imp ? {} : noPerm('importar'))), ui.btn('Nova operação', Object.assign({ variant: 'primary', icon: 'plus', route: '/cedente/nova-operacao' }, pub ? {} : noPerm('publicar')))] }),
      cardAtencao(org, user),
      kpisInicio(org),
      h('div.grid.g-2-1', cardVolume(org), cardSugestao(org)),
      h('div.grid.g2', proximosRecebimentos(org), cardMercado()));
  }

  /* ============================ TÍTULOS ============================ */
  const FILTROS_TIT = [
    { id: 'todos', label: 'Todos', test: () => true },
    { id: 'validando', label: 'Em validação', test: (t) => t.status === 'validando' },
    { id: 'disponiveis', label: 'Disponíveis', test: (t) => t.status === 'disponivel' },
    { id: 'em_operacao', label: 'Em operação', test: (t) => ['em_operacao', 'cedido'].includes(t.status) },
    { id: 'vencidos', label: 'Vencidos', test: (t) => ['vencido', 'vencida'].includes(t.status) || (t.vencimento < now() && !['liquidado', 'recomprado', 'recusado'].includes(t.status)) },
    { id: 'recusados', label: 'Recusados', test: (t) => t.status === 'recusado' },
  ];

  function flagsResumo(t) {
    const flags = t.flags || [];
    const erros = flags.filter((f) => f.nivel === 'erro').length;
    const avisos = flags.filter((f) => f.nivel === 'aviso').length;
    if (!flags.length) return null;
    const el = h('span.ced-flags', { tabindex: 0, role: 'img', 'aria-label': `${fmt.plural(erros, 'erro', 'erros')}, ${fmt.plural(avisos, 'aviso', 'avisos')}` }, icon(erros ? 'triangle-alert' : 'info', 15), `${erros + avisos}`);
    ui.tip(el, flags.map((f) => `${f.nivel === 'erro' ? 'Erro' : 'Aviso'}: ${f.msg}`).join('\n'));
    return el;
  }

  function colunasTitulos() {
    return [
      { key: 'numero', label: 'Título', mobile: 'primary', sort: (a, b) => String(a.numero).localeCompare(String(b.numero)), render: (t) => h('div', h('strong.mono.nowrap', t.numero), h('div.small.muted.mono', t.chave ? t.chave.slice(0, 10) + '…' + t.chave.slice(-4) : 'sem chave')) },
      { key: 'sacado', label: 'Sacado', sort: (a, b) => String(((sacadoDe(a) || {}).fantasia) || '').localeCompare(String(((sacadoDe(b) || {}).fantasia) || '')), render: (t) => { const s = sacadoDe(t); return h('div.ced-sac', F.orgCell(s || { fantasia: 'Novo sacado', cidade: '', uf: '' }, { sub: s ? undefined : 'aguardando validação' }), s && s.rating ? F.ratingBadge(s.rating) : null); } },
      { key: 'valor', label: 'Valor', align: 'right', sort: (a, b) => a.valor - b.valor, render: (t) => h('div', h('strong.num.nowrap', fmt.brl(t.valor)), h('div.small.muted.nowrap', produtoDe(t).nome)) },
      { key: 'vencimento', label: 'Vencimento', align: 'right', sort: (a, b) => a.vencimento - b.vencimento, render: (t) => { const d = diasAte(t.vencimento); return h('div', h('div.num.nowrap', fmt.date(t.vencimento)), h('div.small.nowrap', { class: d < 0 ? 'tone-red' : d <= 7 ? 'tone-amber' : 'muted' }, d < 0 ? `há ${fmt.plural(Math.abs(d), 'dia', 'dias')}` : d === 0 ? 'hoje' : `em ${d} d`)); } },
      { key: 'status', label: 'Situação', sort: true, render: (t) => h('div.row.nowrap', ui.status('titulo', t.status), flagsResumo(t)) },
    ];
  }

  function comoCorrigir(f) {
    const mapa = { TICKET: 'Agrupe com outros títulos do mesmo programa ou use um programa com ticket menor.', PRAZO_MIN: 'O vencimento está próximo demais para o programa.', PRAZO_MAX: 'O vencimento é longo demais para o programa.', VENCIDO: 'Títulos vencidos não entram em operação.', EMISSAO_FUTURA: 'Confira a data de emissão da NF-e.', CHAVE: 'Confira os 44 dígitos da chave de acesso.', DUPLICADO: 'Esta NF-e já está na plataforma, veja o título indicado.', EMITENTE: 'Só entram NF-e emitidas pelo seu CNPJ.', SACADO_NOVO: 'A Mesa confere o sacado antes de liberar.', SACADO_RESTRICAO: 'Sacado com restrição não passa na validação.', LASTRO_XML: 'Reenvie o XML da NF-e pelo botão Reenviar documento.', LASTRO_COMPROVANTE: 'Anexe o comprovante de entrega ou aceite.', AGUARDA_SACADO: 'Aguarde a confirmação do sacado no programa Confia.', CONTESTADO: 'O sacado contestou. Fale com ele antes de reenviar.' };
    return mapa[f.codigo] || 'Fale com a Mesa de Operações.';
  }

  function lastroChecklist(t) {
    const L = t.lastro || {};
    const linha = (ok, label, detalhe) => h('li.ced-doc', h('span', { class: ['ced-doc-ic', ok ? 'ok' : 'falta'] }, icon(ok ? 'circle-check' : 'clock', 15)), h('div.grow', h('strong.small', label), detalhe && h('div.small.muted', detalhe)));
    const aceite = L.aceiteSacado;
    return h('ul.ced-docs', [
      linha(!!L.xml, 'XML da NF-e', L.xml ? 'anexado' : 'não anexado'),
      linha(!!L.pdf, 'PDF da NF-e (DANFE)', L.pdf ? 'anexado' : 'não anexado'),
      linha(!!L.comprovante, 'Comprovante de entrega ou aceite', L.comprovante ? 'anexado' : 'não anexado'),
      t.produto === 'confia' ? linha(aceite === 'aceito', 'Confirmação do sacado (Confia)', aceite === 'aceito' ? 'confirmado' : aceite === 'contestado' ? 'contestado' : aceite === 'pendente' ? 'aguardando o sacado' : 'silencioso') : null,
    ]);
  }

  function abrirTitulo(t0) {
    const pub = can('publicar');
    const flags0 = t0.flags || [];
    let drawer = null;
    const acoes = [];
    if (t0.status === 'disponivel') acoes.push(ui.btn('Antecipar', Object.assign({ variant: 'primary', icon: 'plus', onclick: () => C.router.go('/cedente/nova-operacao?titulos=' + t0.id) }, pub ? {} : noPerm('publicar'))));
    if (['validando', 'recusado'].includes(t0.status) && flags0.some((f) => f.codigo.startsWith('LASTRO'))) acoes.push(ui.btn('Reenviar documento', { icon: 'upload', onclick: () => reenviarDoc(t0) }));
    if (t0.status === 'recusado') acoes.push(ui.btn('Remover', { variant: 'danger', icon: 'trash-2', onclick: async () => {
      if (!await ui.confirm({ title: 'Remover título recusado?', text: `${t0.numero}, ${fmt.brl(t0.valor)}. A remoção sai da sua base e fica na trilha.`, tone: 'danger', confirmLabel: 'Remover' })) return;
      ledger.append({ actor: E.actors.user(session.get().userId), acao: 'titulo.removido', entidade: { kind: 'titulo', id: t0.id }, resumo: `Título recusado ${t0.numero} removido pelo cedente`, classe: 'R1' });
      db.del('titulos', t0.id);
      ui.toast('Título removido', { type: 'success' });
      if (drawer) drawer.close(true);
    } }));
    const corpo = () => {
      const t = db.get('titulos', t0.id) || t0;
      const s = sacadoDe(t);
      const flags = t.flags || [];
      const lote = t.loteId && db.get('lotes', t.loteId);
      const op = t.operacaoId && db.get('operacoes', t.operacaoId);
      return h('div.stack',
        h('div.row', ui.status('titulo', t.status), h('span.small.muted', produtoDe(t).nome), op && ui.link(op.id, '/cedente/operacoes/' + op.id)),
        ui.card({ title: 'NF-e' }, ui.kv([['Número', t.numero], ['Chave de acesso', t.chave ? h('span', h('span.mono', t.chave), ' ', ui.iconBtn('copy', { label: 'Copiar chave de acesso', size: 'sm', onclick: () => { const done = () => ui.toast('Chave copiada', { type: 'success' }); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.chave).then(done, done); else done(); } })) : '—'], ['Emissão', fmt.date(t.emissao)], ['Valor', fmt.brl(t.valor)], ['Vencimento', `${fmt.date(t.vencimento)} (${fmt.plural(diasAte(t.vencimento), 'dia', 'dias')})`], lote && ['Lote', `${lote.id} · ${ui.statusLabel('lote', lote.status)}`]])),
        ui.card({ title: 'Sacado' }, s ? h('div.stack.tight', F.orgCell(s), h('div.row', s.rating ? F.ratingBadge(s.rating) : null, s.restricao ? ui.badge('Restrição: ' + s.restricao, 'red') : ui.badge('Sem restrições', 'green')), h('div.small.muted', `CNPJ ${fmt.cnpj(s.cnpj)}`)) : h('p.muted.small', 'Sacado ainda não cadastrado, a Mesa confere antes de liberar.')),
        ui.card({ title: 'Lastro' }, lastroChecklist(t)),
        flags.length ? ui.card({ title: 'Ocorrências' }, h('ul.ced-flaglist', flags.map((f) => h('li.ced-flag', h('span', { class: ['ced-flag-ic', f.nivel] }, icon(f.nivel === 'erro' ? 'circle-alert' : 'info', 15)), h('div.grow', h('strong.small', (f.nivel === 'erro' ? 'Erro: ' : 'Aviso: ') + f.msg), h('div.small.muted', comoCorrigir(f))))))) : null,
        t.motivoRecusa ? ui.callout({ tone: 'error', title: 'Motivo da recusa', text: t.motivoRecusa }) : null,
        h('div', h('h3', 'Histórico'), F.timeline('titulo', t.id)),
        lote && h('div', h('h3', 'Lote ' + lote.id), F.timeline('lote', lote.id)));
    };
    drawer = ui.drawer({ title: t0.numero, subtitle: `${fmt.brl(t0.valor)} · vencimento ${fmt.date(t0.vencimento)}`, icon: 'receipt-text', size: 'md',
      body: ui.live(['titulos', 'lotes', 'operacoes', 'ledger'], corpo),
      footer: acoes.length ? acoes : null });
  }

  function reenviarDoc(t0) {
    const m = ui.modal({ title: 'Reenviar documento', subtitle: t0.numero, icon: 'upload', size: 'md',
      body: h('div.stack', ui.callout({ tone: 'info', text: 'Anexe o XML ou o comprovante que faltava. O título volta para validação com o lastro completo.' }), ui.dropzone({ title: 'Arraste o XML ou PDF aqui', hint: 'Aceita .xml e .pdf. Demonstração: qualquer arquivo conta como o documento.', accept: '.xml,.pdf', multiple: true, onFiles: async (files) => {
        const nomes = files.map((f) => f.name.toLowerCase());
        const patch = {};
        if (nomes.some((n) => n.endsWith('.xml'))) patch.xml = true;
        if (nomes.some((n) => n.endsWith('.pdf'))) patch.pdf = true;
        patch.comprovante = true;
        const t = db.get('titulos', t0.id) || t0;
        const ced = db.get('orgs', t.orgId);
        const novo = Object.assign({}, t.lastro, patch);
        const flags = E.validarTitulo(Object.assign({}, t, { lastro: novo }), ced);
        const aindaErro = flags.some((f) => f.nivel === 'erro');
        db.patch('titulos', t.id, { lastro: novo, flags, temErro: aindaErro, status: aindaErro ? 'recusado' : (t.status === 'recusado' ? 'validando' : t.status) });
        ledger.append({ actor: E.actors.user(session.get().userId), acao: 'titulo.documento_reenviado', entidade: { kind: 'titulo', id: t.id }, resumo: `Documento reenviado para ${t.numero} (${fmt.plural(files.length, 'arquivo', 'arquivos')})`, classe: 'R1' });
        ui.toast('Documento anexado', { type: 'success', text: aindaErro ? 'Ainda há erros, veja as ocorrências.' : 'Lastro completo, título em validação.' });
        m.close(true);
      } })) });
  }

  function renderTitulos(ctx) {
    const org = orgOf(ctx);
    const st = { aba: ctx.query.aba === 'lotes' ? 'lotes' : 'titulos', filtro: 'todos', q: (ctx.query.q || '').toLowerCase(), produto: '', sacado: '', de: null, ate: null, sel: new Set(), loteFiltro: '' };
    const pub = can('publicar'), imp = can('importar');
    const root = h('div.stack',
      ui.pageHeader({ eyebrow: `${org.fantasia || org.nome} · Títulos`, title: 'Meus títulos', subtitle: 'NF-e e duplicatas importadas, com validação da Mesa e situação de cada uma.', actions: [ui.btn('Importar', Object.assign({ icon: 'upload', route: '/cedente/importar' }, imp ? {} : noPerm('importar'))), ui.btn('Nova operação', Object.assign({ variant: 'primary', icon: 'plus', route: '/cedente/nova-operacao' }, pub ? {} : noPerm('publicar')))] }));
    const tabs = ui.tabs({ items: [{ id: 'titulos', label: 'Títulos' }, { id: 'lotes', label: 'Lotes de importação', count: lotesDoCedente(org.id).length }], value: st.aba, onChange: (v) => { st.aba = v; st.sel.clear(); st.loteFiltro = ''; desenhar(); } });
    root.append(tabs);
    const corpo = h('div.stack');
    root.append(corpo);
    const sticky = h('div.ced-sticky', { hidden: true });
    root.append(sticky);

    function linhasBase() { return titulosDoCedente(org.id).slice().sort((a, b) => b.criadoEm - a.criadoEm); }
    function filtradas() {
      const f = FILTROS_TIT.find((x) => x.id === st.filtro) || FILTROS_TIT[0];
      return linhasBase().filter((t) => {
        if (!f.test(t)) return false;
        if (st.loteFiltro && t.loteId !== st.loteFiltro) return false;
        if (st.produto && t.produto !== st.produto) return false;
        if (st.sacado && t.sacadoId !== st.sacado) return false;
        if (st.de && t.vencimento < st.de) return false;
        if (st.ate && t.vencimento > st.ate + 86399999) return false;
        if (st.q) {
          const s = sacadoDe(t);
          const alvo = `${t.numero} ${(s && (s.fantasia + ' ' + s.nome)) || ''} ${t.chave || ''} ${t.produto}`.toLowerCase();
          if (!alvo.includes(st.q)) return false;
        }
        return true;
      });
    }
    function atualizarSticky() {
      const ids = [...st.sel].map((id) => db.get('titulos', id)).filter(Boolean);
      if (!ids.length) { sticky.hidden = true; C.clear(sticky); return; }
      const soma = C.sum(ids, (t) => t.valor);
      const prazoMed = Math.round(ids.reduce((s, t) => s + t.valor * Math.max(1, diasAte(t.vencimento)), 0) / soma);
      const naoDisp = ids.filter((t) => t.status !== 'disponivel');
      const ok = !naoDisp.length && pub;
      sticky.hidden = false;
      C.mount(sticky, h('div.ced-sticky-in', h('div', h('strong', fmt.plural(ids.length, 'título selecionado', 'títulos selecionados')), h('div.small', `${fmt.brl(soma)} · prazo médio ${prazoMed} dias`)), naoDisp.length ? h('span.small.tone-red', `Só títulos disponíveis entram: ${naoDisp.length} fora`) : null, !pub ? h('span.small.tone-red', C.cannotMsg('publicar')) : null,
        ui.btn('Antecipar selecionados', Object.assign({ variant: 'primary', icon: 'plus', disabled: !ok, title: !pub ? C.cannotMsg('publicar') : naoDisp.length ? 'Retire os títulos indisponíveis da seleção' : '', onclick: () => C.router.go('/cedente/nova-operacao?titulos=' + ids.map((t) => t.id).join(',')) }))));
    }
    let tbl = null;
    function desenhar() {
      C.clear(corpo); tbl = null;
      if (st.aba === 'lotes') { corpo.append(abaLotes(org, (id) => { st.loteFiltro = id; st.aba = 'titulos'; tabs.value = 'titulos'; desenhar(); })); return; }
      const segBox = ui.live(['titulos'], () => {
        const t2 = linhasBase(); const c2 = {};
        FILTROS_TIT.forEach((f) => { c2[f.id] = t2.filter((t) => (!st.loteFiltro || t.loteId === st.loteFiltro) && f.test(t)).length; });
        return ui.segmented({ options: FILTROS_TIT.map((f) => ({ value: f.id, label: f.label, count: c2[f.id] })), value: st.filtro, onChange: (v) => { st.filtro = v; if (tbl) tbl.setRows(filtradas()); } });
      });
      const todos = linhasBase();
      const prods = [...new Set(todos.map((t) => t.produto))];
      const sacs = [...new Map(todos.map((t) => { const s = sacadoDe(t); return [t.sacadoId || 'novo', s ? (s.fantasia || s.nome) : 'Novo sacado']; })).entries()];
      const busca = ui.search({ placeholder: 'Buscar por nº, sacado ou chave', value: ctx.query.q || '', onInput: C.debounce((v) => { st.q = String(v || '').toLowerCase(); tbl && tbl.setRows(filtradas()); }, 180) });
      const selProd = ui.select({ placeholder: 'Programa', options: [{ value: '', label: 'Todos os programas' }].concat(prods.map((p) => ({ value: p, label: (db.get('produtos', p) || {}).nome || p }))), value: '', onChange: (v) => { st.produto = v; tbl && tbl.setRows(filtradas()); } });
      const selSac = ui.select({ placeholder: 'Sacado', searchable: true, options: [{ value: '', label: 'Todos os sacados' }].concat(sacs.map(([id, nome]) => ({ value: id, label: nome }))), value: '', onChange: (v) => { st.sacado = v; tbl && tbl.setRows(filtradas()); } });
      const dtDe = ui.date({ placeholder: 'Venc. de', onChange: (v) => { st.de = v; tbl && tbl.setRows(filtradas()); } });
      const dtAte = ui.date({ placeholder: 'Venc. até', onChange: (v) => { st.ate = v; tbl && tbl.setRows(filtradas()); } });
      const chipLote = st.loteFiltro ? ui.chip('Lote ' + st.loteFiltro, { onremove: () => { st.loteFiltro = ''; desenhar(); } }) : null;
      corpo.append(...[segBox, chipLote, ui.toolbar(busca, selProd, selSac, dtDe, dtAte)].filter(Boolean));
      const lista = h('div');
      corpo.append(lista);
      const redraw = () => { if (tbl) { tbl.setRows(filtradas()); atualizarSticky(); } };
      const off = db.on(['titulos', 'lotes', 'operacoes'], redraw);
      ctx.onCleanup(off);
      tbl = ui.table({ rows: filtradas(), pageSize: 20, rowKey: (r) => r.id, selectable: true, selected: st.sel, onSelect: () => atualizarSticky(), onRowClick: (t) => abrirTitulo(db.get('titulos', t.id) || t), columns: colunasTitulos(), empty: ui.empty({ icon: 'receipt-text', title: 'Nenhum título aqui', text: 'Ajuste os filtros ou importe NF-e para começar.', action: imp ? ui.btn('Importar títulos', { variant: 'primary', icon: 'upload', route: '/cedente/importar' }) : null }) });
      lista.append(tbl);
      atualizarSticky();
    }
    desenhar();
    return root;
  }

  function abaLotes(org, onVer) {
    const lotes = lotesDoCedente(org.id);
    if (!lotes.length) return ui.empty({ icon: 'file-up', title: 'Nenhum lote importado', text: 'O borderô de cada importação aparece aqui com o prazo da Mesa.', action: can('importar') ? ui.btn('Importar títulos', { variant: 'primary', icon: 'upload', route: '/cedente/importar' }) : null });
    return h('div.grid.g2', lotes.map((l) => {
      const user = db.get('users', l.userId);
      return ui.card({ title: l.id, subtitle: (l.nomeArquivo || 'importação') + ' · ' + (user ? user.nome : ''), actions: [ui.status('lote', l.status)] },
        ui.kv([['Títulos', String(l.titulos.length)], ['Valor apto', fmt.brl(l.total)], ['Enviado em', fmt.datetime(l.criadoEm)], l.status === 'validando' && ['Meta da Mesa', ui.countdown(l.slaAte, { prefix: 'em', endLabel: 'meta estourada' })], l.decididoEm && ['Decidido em', fmt.datetime(l.decididoEm)], l.motivo && ['Motivo', l.motivo]]),
        h('div.row', ui.btn('Ver títulos', { size: 'sm', onclick: () => onVer(l.id) })));
    }));
  }

  /* ============================ IMPORTAR ============================ */
  function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }
  function acharSacadoPorCnpj(cnpj) {
    const d = soDigitos(cnpj);
    return db.where('orgs', (o) => o.kind === 'sacado' && soDigitos(o.cnpj) === d)[0] || null;
  }
  function elLocal(root, local) {
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].localName === local) return all[i];
    return null;
  }
  function elsLocal(root, local) {
    const out = []; const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].localName === local) out.push(all[i]);
    return out;
  }
  const txt = (root, local) => { const e = elLocal(root, local); return e ? e.textContent.trim() : ''; };
  function parseDataVenc(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    if (m) return cal.spTs(Number(m[1]), Number(m[2]), Number(m[3]), 12, 0);
    const b = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
    if (b) return cal.spTs(Number(b[3]), Number(b[2]), Number(b[1]), 12, 0);
    return null;
  }

  /** NF-e 4.00 (namespace http://www.portalfiscal.inf.br/nfe): uma linha por duplicata da cobranca. */
  function parseNFeXml(texto, nomeArq) {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`Arquivo ${nomeArq || ''} não é um XML válido.`);
    const infs = elsLocal(doc, 'infNFe');
    if (!infs.length) throw new Error(`Arquivo ${nomeArq || ''} não parece uma NF-e (sem infNFe).`);
    const linhas = [];
    infs.forEach((inf) => {
      const chave = (inf.getAttribute('Id') || '').replace(/^NFe/, '');
      const ide = elLocal(inf, 'ide'); const emit = elLocal(inf, 'emit'); const dest = elLocal(inf, 'dest');
      const icmsTot = elLocal(inf, 'ICMSTot');
      const numero = txt(ide, 'nNF') ? 'NF ' + txt(ide, 'nNF') + '/' + (txt(ide, 'serie') || '1').padStart(3, '0') : 'NF s/n';
      const dhEmi = txt(ide, 'dhEmi') || txt(ide, 'dEmi');
      const emissao = dhEmi && dhEmi.length >= 10 ? Date.parse(dhEmi) || now() - 3 * 86400000 : now() - 3 * 86400000;
      const cnpjEmit = txt(emit, 'CNPJ');
      const sacCnpj = txt(dest, 'CNPJ') || txt(dest, 'CPF');
      const sacNome = txt(dest, 'xNome') || 'Sacado ' + sacCnpj.slice(-4);
      const vNF = parseFloat((txt(icmsTot, 'vNF') || '0').replace(',', '.')) || 0;
      const dups = elsLocal(inf, 'dup');
      if (!dups.length) {
        const venc = cal.addDays(cal.startOfDay(now()), 45) + 12 * 3600e3;
        linhas.push({ numero, chave, cnpjEmitente: cnpjEmit, emitNome: txt(emit, 'xNome'), sacadoCnpj: sacCnpj, sacadoNome: sacNome, valor: C.round2(vNF), emissao, vencimento: venc });
      } else dups.forEach((d) => {
        linhas.push({ numero: numero + (dups.length > 1 ? ' parc. ' + (txt(d, 'nDup') || '') : ''), chave, cnpjEmitente: cnpjEmit, emitNome: txt(emit, 'xNome'), sacadoCnpj: sacCnpj, sacadoNome: sacNome, valor: C.round2(parseFloat((txt(d, 'vDup') || '0').replace(',', '.')) || 0), emissao, vencimento: parseDataVenc(txt(d, 'dVenc')) || (cal.addDays(cal.startOfDay(now()), 45) + 12 * 3600e3) });
      });
    });
    return linhas;
  }

  function xmlExemplo(ced, sac, numero, dups, chaveFixa) {
    const chave = chaveFixa || E.gerarChave({ cnpj: ced.cnpj, numero });
    const f = (ts) => { const t = cal.sp(ts); return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`; };
    const e = cal.sp(now() - 4 * 86400000);
    const emissao = `${f(now() - 4 * 86400000)}T${String(e.h).padStart(2, '0')}:${String(e.mi).padStart(2, '0')}:00-03:00`;
    const total = C.round2(C.sum(dups, (d) => d.valor));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">\n<NFe><infNFe Id="NFe${chave}" versao="4.00">\n<ide><cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>${numero}</nNF><dhEmi>${emissao}</dhEmi><tpNF>1</tpNF></ide>\n<emit><CNPJ>${ced.cnpj}</CNPJ><xNome>${ced.nome}</xNome></emit>\n<dest><CNPJ>${sac.cnpj}</CNPJ><xNome>${sac.nome}</xNome></dest>\n<total><ICMSTot><vNF>${total.toFixed(2)}</vNF></ICMSTot></total>\n<cobr><fat><nFat>${numero}</nFat><vOrig>${total.toFixed(2)}</vOrig></fat>${dups.map((d, i) => `<dup><nDup>${String(i + 1).padStart(3, '0')}</nDup><dVenc>${f(d.venc)}</dVenc><vDup>${d.valor.toFixed(2)}</vDup></dup>`).join('')}</cobr>\n</infNFe></NFe></nfeProc>`;
  }

  function gerarExemplos(ced, comProblema) {
    const sacs = db.where('orgs', (o) => o.kind === 'sacado' && !o.restricao).slice(0, 4);
    const pilar = db.where('orgs', (o) => o.id === 's-pilar')[0];
    const d = (dias) => cal.addDays(cal.startOfDay(now()), dias) + 12 * 3600e3;
    const n1 = 49200 + Math.floor(Math.random() * 600);
    const n2 = n1 + 1;
    const a = xmlExemplo(ced, sacs[0] || {}, n1, [{ venc: d(38), valor: 86420.55 }, { venc: d(66), valor: 86420.55 }]);
    const b = xmlExemplo(ced, sacs[1] || sacs[0] || {}, n2, [{ venc: d(52), valor: 112300 }, { venc: d(81), valor: 54780.4 }, { venc: d(45), valor: 38900 }]);
    if (!comProblema) return [{ nome: `NFe_${n1}.xml`, texto: a }, { nome: `NFe_${n2}.xml`, texto: b }];
    const existente = titulosDoCedente(ced.id).find((t) => t.chave && /^NF \d+\//.test(t.numero) && t.status !== 'recusado');
    const chaveDup = (existente && existente.chave) || (a.match(/Id="NFe(\d{44})"/) || [])[1];
    const numDup = existente ? Number(existente.numero.match(/^NF (\d+)\//)[1]) : n1;
    const baseC = xmlExemplo(ced, sacs[0] || {}, numDup, [{ venc: d(40), valor: 50000 }], chaveDup);
    const c = baseC.replace(/<dest><CNPJ>[^<]*<\/CNPJ><xNome>[^<]*<\/xNome><\/dest>/, `<dest><CNPJ>${pilar.cnpj}</CNPJ><xNome>${pilar.nome}</xNome></dest>`);
    const dbaixo = xmlExemplo({ cnpj: '11222333000181', nome: 'Outro Emitente Ltda' }, sacs[2] || sacs[0] || {}, n2 + 5, [{ venc: d(30), valor: 12400 }]);
    return [{ nome: `NFe_${n1}.xml`, texto: a }, { nome: `NFe_prob_${n2}.xml`, texto: c }, { nome: `NFe_ticket_${n2 + 5}.xml`, texto: dbaixo }];
  }

  function parseCSV(texto) {
    const linhas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    linhas.forEach((ln, i) => {
      if (i === 0 && /numero/i.test(ln) && /sacado/i.test(ln)) return;
      const p = ln.split(/;/).map((x) => x.trim().replace(/^"|"$/g, ''));
      if (p.length < 4) throw new Error(`Linha ${i + 1}: use numero;sacado_cnpj;valor;vencimento.`);
      const v = C.parseBRL(p[2]);
      const venc = parseDataVenc(p[3]);
      if (!v || !venc) throw new Error(`Linha ${i + 1}: valor ou vencimento inválido (dd/mm/aaaa).`);
      out.push({ numero: p[0], sacadoCnpj: p[1], sacadoNome: '', valor: C.round2(v), vencimento: venc, emissao: now() - 3 * 86400000, cnpjEmitente: '', chave: '', origem: 'csv' });
    });
    return out;
  }

  function validarLinha(row, ced) {
    return E.validarTitulo({ id: 'tmp', orgId: ced.id, tipo: 'NF-e', numero: row.numero, valor: row.valor, produto: row.produto, vencimento: row.vencimento, emissao: row.emissao, chave: row.chave, cnpjEmitente: row.cnpjEmitente, sacadoId: row.sacadoId, lastro: row.lastro }, ced);
  }

  function paraRevisao(org, brutas) {
    const ced = db.get('orgs', org.id);
    return brutas.map((b, i) => {
      const sac = b.sacadoCnpj ? acharSacadoPorCnpj(b.sacadoCnpj) : (b.sacadoId ? db.get('orgs', b.sacadoId) : null);
      const row = { key: 'r' + i + '-' + Math.random().toString(36).slice(2, 7), numero: b.numero || `NF s/n ${i + 1}`, chave: b.chave || '', cnpjEmitente: b.cnpjEmitente || ced.cnpj, sacadoId: sac ? sac.id : null, sacadoCnpj: b.sacadoCnpj || (sac ? sac.cnpj : ''), sacadoNome: sac ? (sac.fantasia || sac.nome) : (b.sacadoNome || 'Novo sacado'), valor: b.valor, emissao: b.emissao || now() - 3 * 86400000, vencimento: b.vencimento, produto: b.produto || 'premium', lastro: { xml: b.origem === 'csv' ? false : true, pdf: false, comprovante: false, aceiteSacado: 'silencioso' }, incluir: true };
      const flags = validarLinha(row, ced);
      row.flags = flags;
      row.temErro = flags.some((f) => f.nivel === 'erro');
      if (row.temErro) row.incluir = false;
      return row;
    });
  }

  function exemploCSV(org) {
    const sac = db.where('orgs', (o) => o.kind === 'sacado' && !o.restricao)[0];
    const v = (dias) => fmt.date(cal.addDays(cal.startOfDay(now()), dias) + 12 * 3600e3);
    return 'numero;sacado_cnpj;valor;vencimento\n'
      + `NF 49210/001;${sac ? sac.cnpj : '00000000000000'};86420,55;${v(38)}\n`
      + `NF 49210/002;${sac ? sac.cnpj : '00000000000000'};112300,00;${v(66)}\n`;
  }

  function baixarModeloCSV(org) {
    const blob = new Blob([exemploCSV(org)], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'modelo_titulos.csv' });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    ui.toast('Modelo baixado', { type: 'success', text: 'Preencha e arraste o CSV de volta para cá.' });
  }

  function lerArquivos(files) {
    const brutas = [];
    const avisos = [];
    const jobs = [...files].map((f) => {
      const nome = f.name || 'arquivo';
      if (/\.zip$/i.test(nome)) {
        avisos.push(`${nome}: ZIP não é lido neste protótipo, use os arquivos de exemplo ou envie XML e CSV avulsos.`);
        return Promise.resolve();
      }
      return f.text().then((texto) => {
        if (/\.csv$/i.test(nome)) {
          parseCSV(texto).forEach((b) => brutas.push(Object.assign(b, { origem: 'csv', nomeArquivo: nome })));
        } else {
          parseNFeXml(texto, nome).forEach((b) => brutas.push(Object.assign(b, { origem: 'xml', nomeArquivo: nome })));
        }
      }).catch((e) => avisos.push(e.message));
    });
    return Promise.all(jobs).then(() => ({ brutas, avisos }));
  }

  function renderImportar(ctx) {
    const org = orgOf(ctx);
    const imp = can('importar');
    if (!imp) {
      return h('div.stack',
        ui.pageHeader({ eyebrow: `${org.fantasia || org.nome} · Importar`, title: 'Importar títulos', subtitle: 'Envie NF-e para validação da Mesa de Operações.' }),
        ui.callout({ tone: 'warn', icon: 'lock', title: 'Sem permissão para importar', text: C.cannotMsg('importar') }),
        ui.card({ title: 'Importações recentes' }, listaRecentes(org)));
    }
    const st = { passo: 0, modo: 'arquivo', nomes: [], brutas: [], linhas: [], erro: '', avisos: [], comProblema: false, enviado: null, aceite: false,
      manual: { sacadoId: '', novoCnpj: '', novoNome: '', numero: '', valor: null, emissao: null, vencimento: null, programa: 'premium' }, manLista: [] };
    const root = h('div.stack',
      ui.pageHeader({ eyebrow: `${org.fantasia || org.nome} · Importar`, title: 'Importar títulos', subtitle: 'XML ou CSV na etapa 1, revisão com validação na 2, envio à Mesa na 3.' }));
    const barra = h('div');
    const corpo = h('div.stack');
    root.append(barra, corpo);

    function draw() {
      C.mount(barra, ui.stepper(['Arquivos', 'Revisão', 'Envio'], st.passo));
      C.clear(corpo);
      if (st.passo === 0) corpo.append(passoArquivos());
      else if (st.passo === 1) corpo.append(passoRevisao());
      else corpo.append(passoEnvio());
      corpo.append(ui.card({ title: 'Importações recentes', subtitle: 'Últimos borderôs enviados pela empresa' }, listaRecentes(org)));
    }

    function listaRecentes(org2) {
      return ui.live(['lotes'], () => {
        const lotes = lotesDoCedente(org2.id).slice(0, 5);
        if (!lotes.length) return h('p.muted.small', 'Nenhum lote enviado ainda.');
        return h('ul.ced-lotes', lotes.map((l) => h('li.ced-lote',
          h('div.grow', h('strong.small', l.id), h('div.small.muted', `${fmt.plural(l.titulos.length, 'título', 'títulos')} · ${fmt.brl(l.total)} · ${fmt.rel(l.criadoEm)}`)),
          l.status === 'validando' ? ui.countdown(l.slaAte, { prefix: 'meta em', endLabel: 'meta estourada' }) : ui.status('lote', l.status))));
      });
    }

    function irParaRevisao() {
      if (!st.brutas.length) { st.erro = 'Nenhum título para revisar. Envie um arquivo ou digite manualmente.'; draw(); return; }
      st.linhas = paraRevisao(org, st.brutas);
      st.erro = ''; st.passo = 1; draw();
      const nErr = st.linhas.filter((l) => l.temErro).length;
      if (nErr) ui.toast('Revisão com erros', { type: 'warn', text: `${fmt.plural(nErr, 'linha com erro sai', 'linhas com erro saem')} excluída${nErr === 1 ? '' : 's'}, você pode corrigir e incluir.` });
    }

    function passoArquivos() {
      const seg = ui.segmented({ value: st.modo, aria: 'Origem dos títulos', options: [{ value: 'arquivo', label: 'Arquivo XML/CSV', icon: 'upload' }, { value: 'manual', label: 'Digitar manualmente', icon: 'pencil' }], onChange: (v) => { st.modo = v; st.erro = ''; draw(); } });
      const erros = st.erro ? ui.callout({ tone: 'error', title: 'Não foi possível ler', text: st.erro }) : null;
      const avisos = st.avisos.length ? ui.callout({ tone: 'warn', title: 'Avisos de leitura', text: st.avisos.join(' ') }) : null;
      return h('div.stack', seg, erros, avisos, st.modo === 'arquivo' ? paneArquivo() : paneManual());
    }

    function paneArquivo() {
      const dz = ui.dropzone({ title: 'Arraste XML ou CSV aqui, ou clique para escolher', hint: 'NF-e 4.00 (.xml) e planilha (.csv). ZIP não é lido no protótipo.', accept: '.xml,.csv,.zip', multiple: true, onFiles: async (files) => {
        const r = await lerArquivos(files);
        st.avisos = r.avisos;
        if (!r.brutas.length && !r.avisos.length) { st.erro = 'Nenhum título encontrado nos arquivos.'; draw(); return; }
        if (!r.brutas.length) { st.erro = ''; draw(); return; }
        st.brutas = st.brutas.concat(r.brutas);
        st.nomes = st.nomes.concat([...files].map((f) => f.name));
        irParaRevisao();
      } });
      const swProb = ui.switch({ label: 'Incluir casos com problema no exemplo', hint: 'Chave duplicada, sacado com restrição, valor abaixo do ticket e emitente diferente, para ver as validações.', checked: st.comProblema, onChange: (v) => { st.comProblema = v; } });
      return ui.card({ title: 'Arquivos da NF-e', subtitle: 'O XML passa pelo mesmo leitor da validação, duplicata a duplicata.' },
        dz,
        h('div.sp-3'),
        h('div.row',
          ui.btn('Usar arquivos de exemplo', { variant: 'primary', icon: 'sparkles', onclick: () => {
            const ex = gerarExemplos(org, st.comProblema);
            st.brutas = [];
            ex.forEach((e) => parseNFeXml(e.texto, e.nome).forEach((b) => st.brutas.push(Object.assign(b, { origem: 'xml', nomeArquivo: e.nome }))));
            st.nomes = ex.map((e) => e.nome);
            irParaRevisao();
          } }),
          ui.btn('Baixar modelo CSV', { icon: 'download', onclick: () => baixarModeloCSV(org) })),
        h('div.sp-3'), swProb,
        st.brutas.length ? h('p.small.muted', `${fmt.plural(st.brutas.length, 'linha lida', 'linhas lidas')} de ${st.nomes.join(', ')}.`) : null);
    }

    function paneManual() {
      const m = st.manual;
      const sacs = db.where('orgs', (o) => o.kind === 'sacado').sort((a, b) => String(a.fantasia).localeCompare(String(b.fantasia)));
      const selSac = ui.select({ searchable: true, aria: 'Sacado', value: m.sacadoId, options: [{ value: '', label: 'Escolha o sacado' }].concat(sacs.map((s) => ({ value: s.id, label: `${s.fantasia || s.nome} · ${s.rating || 'sem rating'}`, hint: fmt.cnpj(s.cnpj) }))).concat([{ value: '__novo', label: 'Novo sacado (informar CNPJ)' }]), onChange: (v) => { m.sacadoId = v; draw(); } });
      const fCnpj = ui.input({ mask: 'cnpj', placeholder: '00.000.000/0000-00', value: m.novoCnpj, onInput: (v) => { m.novoCnpj = v; } });
      const fNome = ui.input({ placeholder: 'Razão social do novo sacado', value: m.novoNome, onInput: (v) => { m.novoNome = v; } });
      const fNum = ui.input({ placeholder: 'NF 49210/001', value: m.numero, onInput: (v) => { m.numero = v; } });
      const fVal = ui.currency({ value: m.valor || 0, onInput: (v) => { m.valor = v; } });
      const fEmi = ui.date({ value: m.emissao, placeholder: 'Emissão', onChange: (v) => { m.emissao = v; } });
      const fVen = ui.date({ value: m.vencimento, placeholder: 'Vencimento', onChange: (v) => { m.vencimento = v; } });
      const prods = db.all('produtos');
      const selProg = ui.select({ aria: 'Programa', value: m.programa, options: prods.map((p) => ({ value: p.id, label: `${p.nome} (ticket ${fmt.brl(p.ticketMin, { round: true })})` })), onChange: (v) => { m.programa = v; } });
      const wNum = ui.field({ label: 'Número', required: true }, fNum);
      const wVal = ui.field({ label: 'Valor', required: true }, fVal);
      const wVen = ui.field({ label: 'Vencimento', required: true }, fVen);
      const lista = st.manLista.length ? h('ul.ced-manlist', st.manLista.map((b, i) => h('li.ced-lote',
        h('div.grow', h('strong.small', b.numero), h('div.small.muted', `${b.sacadoNome} · ${fmt.brl(b.valor)} · vence ${fmt.date(b.vencimento)}`)),
        ui.iconBtn('x', { label: 'Remover ' + b.numero, size: 'sm', onclick: () => { st.manLista.splice(i, 1); draw(); } })))) : h('p.muted.small', 'Nenhuma linha digitada ainda.');
      return ui.card({ title: 'Digitar títulos', subtitle: 'Para 1 ou 2 títulos avulsos. O sacado novo passa por consulta da Mesa.' },
        ui.grid(2, ui.field({ label: 'Sacado', required: true }, selSac), m.sacadoId === '__novo' ? ui.field({ label: 'CNPJ do novo sacado', required: true }, fCnpj) : ui.field({ label: 'Programa', required: true }, selProg)),
        m.sacadoId === '__novo' ? ui.grid(2, ui.field({ label: 'Nome do novo sacado', required: true }, fNome), ui.field({ label: 'Programa', required: true }, selProg)) : null,
        ui.grid(3, wNum, wVal, wVen),
        ui.grid(2, ui.field({ label: 'Emissão', optional: true }, fEmi), h('div.row.end', { style: 'align-self:end' }, ui.btn('Adicionar à lista', { icon: 'plus', onclick: () => {
          let okk = true;
          wNum.setError(!String(m.numero).trim() ? 'Informe o número.' : ''); if (!String(m.numero).trim()) okk = false;
          wVal.setError(!(m.valor > 0) ? 'Informe o valor.' : ''); if (!(m.valor > 0)) okk = false;
          wVen.setError(!m.vencimento ? 'Informe o vencimento.' : ''); if (!m.vencimento) okk = false;
          if (!m.sacadoId) { ui.toast('Escolha o sacado', { type: 'warn' }); okk = false; }
          if (m.sacadoId === '__novo' && soDigitos(m.novoCnpj).length !== 14) { ui.toast('CNPJ do novo sacado incompleto', { type: 'warn' }); okk = false; }
          if (!okk) return;
          const sac = m.sacadoId !== '__novo' ? db.get('orgs', m.sacadoId) : null;
          st.manLista.push({ numero: String(m.numero).trim(), sacadoId: sac ? sac.id : null, sacadoCnpj: sac ? sac.cnpj : soDigitos(m.novoCnpj), sacadoNome: sac ? (sac.fantasia || sac.nome) : (String(m.novoNome).trim() || 'Novo sacado'), valor: C.round2(m.valor), emissao: m.emissao || now() - 3 * 86400000, vencimento: m.vencimento, cnpjEmitente: org.cnpj, chave: '', produto: m.programa, origem: 'manual' });
          m.numero = ''; m.valor = null; m.vencimento = null; draw();
        } }))),
        h('div.sp-2'), h('h4', 'Na lista'), lista,
        h('div.sp-2'),
        h('div.row.end', ui.btn('Revisar títulos digitados', { variant: 'primary', icon: 'arrow-right', disabled: !st.manLista.length, onclick: () => { st.brutas = st.manLista.slice(); st.nomes = ['digitação manual']; irParaRevisao(); } })));
    }

    function recalcLinha(row) {
      const ced = db.get('orgs', org.id);
      row.flags = validarLinha(row, ced);
      row.temErro = row.flags.some((f) => f.nivel === 'erro');
    }

    function passoRevisao() {
      const prods = db.all('produtos');
      const validas = st.linhas.filter((l) => l.incluir && !l.temErro);
      const soma = C.round2(C.sum(validas, (l) => l.valor));
      const excluidas = st.linhas.filter((l) => !l.incluir || l.temErro);
      const tbl = ui.table({
        rows: st.linhas, rowKey: (r) => r.key, dense: true,
        columns: [
          { key: 'incl', label: 'Incluir', render: (r) => ui.checkbox({ checked: r.incluir && !r.temErro, disabled: r.temErro, aria: 'Incluir ' + r.numero, onChange: (v) => { r.incluir = v; draw(); } }) },
          { key: 'numero', label: 'Título', mobile: 'primary', render: (r) => h('div', h('strong.small.mono', r.numero), h('div.small.muted', `${r.sacadoNome} · vence ${fmt.date(r.vencimento)}`)) },
          { key: 'valor', label: 'Valor', align: 'right', render: (r) => h('span.num', fmt.brl(r.valor)) },
          { key: 'prog', label: 'Programa', mobile: 'hide', class: 'ced-col-prog', render: (r) => ui.select({ aria: 'Programa de ' + r.numero, value: r.produto, options: prods.map((p) => ({ value: p.id, label: p.nome })), onChange: (v) => { r.produto = v; recalcLinha(r); if (r.temErro) r.incluir = false; draw(); } }) },
          { key: 'flags', label: 'Validação', render: (r) => r.flags.length ? h('ul.ced-flaglist', r.flags.map((f) => h('li.ced-flag.small', h('span', { class: ['ced-flag-ic', f.nivel] }, icon(f.nivel === 'erro' ? 'circle-alert' : 'info', 14)), h('span', h('strong', f.nivel === 'erro' ? 'Erro: ' : 'Aviso: '), f.msg)))) : h('span.small.tone-green', 'Pronto para envio') },
          { key: 'x', label: '', render: (r) => ui.iconBtn('x', { label: 'Remover ' + r.numero, size: 'sm', onclick: () => { st.linhas = st.linhas.filter((l) => l.key !== r.key); draw(); } }) },
        ],
        empty: ui.empty({ icon: 'receipt-text', title: 'Nada para revisar', text: 'Volte e envie arquivos ou digite títulos.' }),
      });
      return h('div.stack',
        ui.callout({ tone: validas.length ? 'info' : 'warn', title: `${fmt.plural(validas.length, 'válida', 'válidas')} somando ${fmt.brl(soma)}`, text: excluidas.length ? `${fmt.plural(excluidas.length, 'linha fora do envio', 'linhas fora do envio')} (com erro ou desmarcadas). Linhas com erro saem excluídas por padrão.` : 'Todas as linhas entram no envio.' }),
        ui.card({ title: 'Revisão', subtitle: `De ${st.nomes.join(', ')}`, flush: true }, tbl),
        h('div.row.between', ui.btn('Voltar aos arquivos', { variant: 'ghost', icon: 'arrow-left', onclick: () => { st.passo = 0; draw(); } }),
          ui.btn('Continuar para envio', { variant: 'primary', icon: 'arrow-right', disabled: !validas.length, title: validas.length ? '' : 'Nenhuma linha válida para enviar', onclick: () => { st.passo = 2; draw(); } })));
    }

    function slaMensagem() {
      const primeira = opsDoCedente(org.id).length === 0;
      const horas = primeira ? db.cfg().slaPrimeiraOpH : db.cfg().slaValidacaoH;
      const ate = E.slaAte(now(), horas);
      return { primeira, horas, ate };
    }

    function passoEnvio() {
      if (st.enviado) {
        const l = db.get('lotes', st.enviado);
        return ui.card({ title: 'Lote enviado para validação', subtitle: 'A Mesa de Operações confere lastro e sacados.' },
          h('div.stack.tight',
            ui.callout({ tone: 'success', title: `Lote ${st.enviado} criado`, text: `${fmt.plural(l ? l.titulos.length : 0, 'título entrou', 'títulos entraram')} na fila da Mesa, vindos de ${st.nomes.join(', ')}.` }),
            l && l.status === 'validando' ? h('div.small', 'Meta da Mesa: ', ui.countdown(l.slaAte, { prefix: 'em', endLabel: 'meta estourada' })) : l ? h('div.small', 'Situação: ', ui.status('lote', l.status)) : null,
            h('div.row', ui.btn('Ver lote nos títulos', { variant: 'primary', route: '/cedente/titulos?aba=lotes' }), ui.btn('Importar mais', { onclick: () => { st.passo = 0; st.brutas = []; st.linhas = []; st.enviado = null; st.aceite = false; draw(); } }))));
      }
      const validas = st.linhas.filter((l) => l.incluir && !l.temErro);
      const soma = C.round2(C.sum(validas, (l) => l.valor));
      const excl = st.linhas.length - validas.length;
      const sla = slaMensagem();
      const chk = ui.checkbox({ label: 'Declaro que os títulos são lícitos e não estão cedidos a terceiros', checked: st.aceite, onChange: (v) => { st.aceite = v; draw(); } });
      return h('div.stack',
        ui.card({ title: 'Resumo do envio' },
          ui.kv([['Linhas válidas', `${validas.length} somando ${fmt.brl(soma)}`], ['Linhas fora do envio', String(excl)], ['Origem', st.nomes.join(', ')]])),
        ui.callout({ tone: 'info', icon: 'hourglass', title: `A Mesa responde em até ${sla.horas}h úteis`, text: `${sla.primeira ? 'Primeira operação da empresa, a meta é de 24h úteis. ' : ''}A Mesa trabalha das 8h às 18h em dias úteis. Previsão: ${fmt.datetime(sla.ate)}.` }),
        ui.card({ title: 'Confirmar e enviar' }, chk,
          h('div.sp-3'),
          h('div.row.between', ui.btn('Voltar à revisão', { variant: 'ghost', icon: 'arrow-left', onclick: () => { st.passo = 1; draw(); } }),
            ui.btn('Enviar para validação', { variant: 'primary', icon: 'send', disabled: !st.aceite || !validas.length, title: !st.aceite ? 'Marque a declaração para enviar' : '', onclick: async () => {
              const itens = validas.map((l) => ({ numero: l.numero, chave: l.chave, cnpjEmitente: l.cnpjEmitente, valor: l.valor, emissao: l.emissao, vencimento: l.vencimento, produto: l.produto, sacadoId: l.sacadoId, lastro: l.lastro, tipo: 'NF-e' }));
              const r = E.importarTitulos({ cedenteId: org.id, userId: session.get().userId, itens, origem: 'xml', nomeArquivo: st.nomes.join(', ') });
              if (!r.ok) { ui.toast('Não foi possível enviar', { type: 'error', text: r.erro }); return; }
              st.enviado = r.loteId;
              ui.toast('Lote enviado', { type: 'success', text: `Lote ${r.loteId} em validação na Mesa.` });
              draw();
            } }))));
    }

    draw();
    return root;
  }

  /* ============================ NOVA OPERAÇÃO ============================ */
  function prazoMedioDe(tits, baseTs) {
    const face = C.sum(tits, (t) => t.valor);
    if (!face) return 1;
    const base = baseTs || now();
    return Math.max(1, Math.round(C.sum(tits, (t) => t.valor * Math.max(1, cal.daysBetween(base, t.vencimento))) / face));
  }

  function renderNova(ctx) {
    const org = orgOf(ctx);
    const pub = can('publicar');
    const bloqueada = org.status !== 'ativo';
    const pre = String(ctx.query.titulos || '').split(',').map((s) => s.trim()).filter(Boolean);
    const taxaQ = parseFloat(String(ctx.query.taxa || '').replace(',', '.'));
    const disp = () => titulosDoCedente(org.id).filter((t) => t.status === 'disponivel');
    const st = { passo: 0, sel: new Set(pre.filter((id) => { const t = db.get('titulos', id); return t && t.orgId === org.id && t.status === 'disponivel'; })),
      canal: 'vitrine', finAlvo: null, regresso: null, tetoOn: false, teto: null, validadeH: 24,
      taxa: taxaQ > 0 ? taxaQ : 1.85, aceite: false, erro: '' };
    const root = h('div.stack',
      ui.pageHeader({ eyebrow: `${org.fantasia || org.nome} · Nova operação`, title: 'Nova operação', subtitle: 'Escolha títulos, canal e condições, simule a taxa e publique na Vitrine ou no Balcão.' }));
    if (bloqueada) root.append(ui.callout({ tone: 'error', icon: 'ban', title: org.status === 'suspenso' ? 'Cadastro suspenso, publicação bloqueada' : 'Cadastro em análise, publicação bloqueada', text: org.motivoSuspensao || 'Conclua o cadastro com a Mesa de Operações para publicar. Você pode montar a simulação, mas não publicar.' }));
    if (!pub) root.append(ui.callout({ tone: 'warn', icon: 'lock', title: 'Seu perfil é somente leitura', text: C.cannotMsg('publicar') }));
    if (pre.length && !st.sel.size) root.append(ui.callout({ tone: 'warn', title: 'Seleção anterior indisponível', text: 'Os títulos vindos da outra tela não estão mais disponíveis e foram desmarcados.' }));
    const barra = h('div');
    const grade = h('div.grid.g-main-side');
    const main = h('div.stack');
    const lado = h('aside.stack.ced-aside');
    grade.append(main, lado);
    root.append(barra, grade);
    const PASSOS = ['Títulos', 'Canal e condições', 'Simulação', 'Revisão e publicação'];

    function selTitulos() { return [...st.sel].map((id) => db.get('titulos', id)).filter(Boolean); }
    function faceSel() { return C.round2(C.sum(selTitulos(), (t) => t.valor)); }
    function prodsSel() { return [...new Set(selTitulos().map((t) => t.produto))]; }

    function draw() {
      C.mount(barra, ui.stepper(PASSOS, st.passo));
      C.clear(main);
      st.erro = st.erro || '';
      if (st.passo === 0) main.append(passoTitulos());
      else if (st.passo === 1) main.append(passoCanal());
      else if (st.passo === 2) main.append(passoSimulacao());
      else main.append(passoRevisao());
      atualizaLado();
    }

    function atualizaLado() { C.clear(lado); lado.append(cardResumo()); }

    function podeAvancar() {
      if (!pub || bloqueada) return false;
      if (st.passo === 0) {
        if (!st.sel.size) return false;
        if (prodsSel().length > 1) return false;
        const lar = E.lar(org.id);
        if (lar && faceSel() > lar.disponivel) return false;
        return true;
      }
      if (st.passo === 1) {
        if (!st.regresso) return false;
        if (st.canal === 'balcao' && !st.finAlvo) return false;
        return true;
      }
      if (st.passo === 2) return st.taxa >= 1.2 && st.taxa <= 3.5;
      return st.aceite;
    }

    function nav() {
      return h('div.row.between',
        st.passo > 0 ? ui.btn('Voltar', { variant: 'ghost', icon: 'arrow-left', onclick: () => { st.passo--; draw(); } }) : ui.btn('Cancelar', { variant: 'ghost', onclick: async () => {
          if (st.sel.size && !(await ui.confirm({ title: 'Sair sem publicar?', text: 'A seleção de títulos será perdida.', confirmLabel: 'Sair sem salvar' }))) return;
          C.router.go('/cedente/titulos');
        } }),
        st.passo < 3 ? ui.btn('Continuar', { variant: 'primary', icon: 'arrow-right', disabled: !podeAvancar(), title: !pub ? C.cannotMsg('publicar') : bloqueada ? 'Cadastro não ativo' : '', onclick: () => { st.passo++; draw(); } }) : null);
    }

    function cardResumo() {
      const tits = selTitulos();
      const face = faceSel();
      const lar = E.lar(org.id);
      const pm = tits.length ? prazoMedioDe(tits) : 0;
      const liq = tits.length && st.taxa ? E.simular({ face, prazoDias: pm, taxaAm: st.taxa, produtoId: prodsSel()[0] || 'premium' }).liquido : 0;
      const pctLar = lar && lar.limite ? Math.max(0, Math.min(100, (lar.disponivel / lar.limite) * 100)) : 0;
      return ui.card({ title: 'Resumo', subtitle: tits.length ? `${fmt.plural(tits.length, 'título na operação', 'títulos na operação')}` : 'Nenhum título escolhido' },
        ui.kv([['Face', fmt.brl(face)], ['Prazo médio', tits.length ? pm + ' dias' : '—'], ['LAR disponível', lar ? fmt.brl(lar.disponivel) : '—'], ['Líquido estimado', liq ? fmt.brl(liq) : '—']]),
        lar ? h('div', h('div.sp-2'), ui.progress(pctLar, { tone: pctLar < 15 ? 'red' : pctLar < 40 ? 'amber' : null }), h('div.small.muted', `${fmt.num(Math.round(pctLar))}% do limite livre`)) : null,
        h('div.small.muted', `Taxa simulada: ${fmt.taxa(st.taxa)} (o líquido final sai do aceite).`));
    }

    function passoTitulos() {
      const todos = disp();
      if (!todos.length) return ui.card({ title: 'Títulos disponíveis' }, ui.empty({ icon: 'receipt-text', title: 'Nenhum título disponível', text: 'Importe NF-e e aguarde a validação da Mesa antes de montar a operação.', action: ui.btn('Importar títulos', { variant: 'primary', icon: 'upload', route: '/cedente/importar' }) }));
      const prods = prodsSel();
      const travaOutro = prods.length === 1 ? prods[0] : null;
      const lar = E.lar(org.id);
      const face = faceSel();
      const estourou = lar && face > lar.disponivel;
      const tbl = ui.table({
        rows: todos, rowKey: (r) => r.id, selectable: true, selected: st.sel,
        onSelect: () => { sanitizarPrograma(); draw(); },
        columns: [
          { key: 'numero', label: 'Título', mobile: 'primary', render: (t) => {
            const outro = travaOutro && t.produto !== travaOutro && !st.sel.has(t.id);
            return h('div', h('strong.small.mono', t.numero), h('div.small.muted', `${(produtoDe(t).nome)} · ${(sacadoDe(t) || {}).fantasia || 'sacado'}`), outro ? h('div.small.tone-amber', 'Outro programa, limpe a seleção para usar') : null);
          } },
          { key: 'valor', label: 'Valor', align: 'right', render: (t) => h('span.num', fmt.brl(t.valor)) },
          { key: 'venc', label: 'Vencimento', align: 'right', mobile: 'hide', render: (t) => h('span.num.nowrap', fmt.date(t.vencimento)) },
        ],
        empty: ui.empty({ icon: 'receipt-text', title: 'Nada por aqui', text: 'Nenhum título disponível.' }),
      });
      const pm = selTitulos().length ? prazoMedioDe(selTitulos()) : 0;
      return h('div.stack',
        ui.card({ title: 'Escolha os títulos', subtitle: 'Uma operação aceita um programa de produto por vez.' }, tbl),
        ui.callout({ tone: 'info', title: st.sel.size ? `${fmt.plural(st.sel.size, 'selecionado', 'selecionados')}, face ${fmt.brl(face)}, prazo médio ${pm} dias` : 'Nenhum título selecionado', text: travaOutro ? `Programa travado em ${(db.get('produtos', travaOutro) || {}).nome}. Desmarque tudo para trocar.` : 'Selecione títulos do mesmo programa.' }),
        estourou ? ui.callout({ tone: 'error', title: 'Acima do limite disponível (LAR)', text: `Face ${fmt.brl(face)} supera os ${fmt.brl(lar.disponivel)} livres. Retire títulos ou aguarde liberações.` }) : null,
        nav());
    }

    function sanitizarPrograma() {
      const ps = prodsSel();
      if (ps.length > 1) {
        const keep = ps[0];
        [...st.sel].forEach((id) => { const t = db.get('titulos', id); if (t && t.produto !== keep) st.sel.delete(id); });
        ui.toast('Um programa por operação', { type: 'warn', text: `Mantidos só os títulos ${(db.get('produtos', keep) || {}).nome}. Desmarque tudo para trocar de programa.` });
      }
    }

    function passoCanal() {
      const prodId = prodsSel()[0] || 'premium';
      const prod = db.get('produtos', prodId) || {};
      const fins = db.where('orgs', (o) => o.kind === 'financiador' && o.status === 'ativo');
      const favs = new Set(org.favoritos || []);
      const bloqueados = new Set(org.bloqueados || []);
      const finsOrd = fins.slice().sort((a, b) => (favs.has(b.id) - favs.has(a.id)) || String(a.fantasia).localeCompare(String(b.fantasia)));
      const optFin = finsOrd.map((f) => ({ value: f.id, label: `${f.fantasia || f.nome}${favs.has(f.id) ? ' ★' : ''}`, hint: bloqueados.has(f.id) ? 'Bloqueado por você' : (f.tipo || ''), disabled: bloqueados.has(f.id) }));
      if (st.finAlvo && bloqueados.has(st.finAlvo)) st.finAlvo = null;

      const radioCanal = ui.radio({ layout: 'cards', aria: 'Canal da operação', value: st.canal, onChange: (v) => { st.canal = v; draw(); }, options: [
        { value: 'vitrine', label: 'Vitrine', hint: 'Leilão aberto a todos os financiadores, 24h por dia, 7 dias por semana', icon: 'store' },
        { value: 'balcao', label: 'Balcão', hint: 'Oferta dirigida a um financiador da sua relação', icon: 'handshake' },
      ] });
      const selFin = st.canal === 'balcao' ? ui.field({ label: 'Financiador do Balcão', required: true }, ui.select({ aria: 'Financiador', value: st.finAlvo, placeholder: 'Escolha o financiador', options: optFin, onChange: (v) => { st.finAlvo = v; draw(); } })) : null;

      const semRegressoOff = !prod.permiteSemRegresso;
      const radioReg = ui.radio({ layout: 'cards', aria: 'Regresso', value: st.regresso, onChange: (v) => { st.regresso = v; draw(); }, options: [
        { value: 'com', label: 'Com regresso', hint: 'Se o sacado não pagar, você recompra o título (regra do mercado)', icon: 'rotate-ccw' },
        { value: 'sem', label: 'Sem regresso', hint: semRegressoOff ? `O programa ${prod.nome} só admite operação com regresso` : 'Risco do sacado, taxa maior', icon: 'shield-check', disabled: semRegressoOff },
      ] });
      const drawerRegresso = h('div', ui.link('O que é regresso?', '#', { onclick: (e) => { e.preventDefault(); ui.drawer({ title: 'Regresso', icon: 'rotate-ccw', body: h('div.stack',
        h('p', 'Com regresso, se o sacado não pagar no vencimento, o financiador pode pedir a recompra e você paga o saldo mais multa de 2% e mora de 1% ao mês.'),
        h('p', 'Sem regresso, quem assume o risco do sacado é o financiador, e a taxa reflete isso. Nem todo programa admite: o Premium, por exemplo, só opera com regresso.'),
        h('p.small.muted', 'A modalidade escolhida aqui fica registrada na trilha da operação.')) }); } }));

      const pm = prazoMedioDe(selTitulos());
      let sug = null;
      try { sug = E.ia.sugerirTaxa({ produto: prodId, prazoMedio: pm }); } catch (e) { sug = null; }
      if (st.teto === null && sug) st.teto = sug.sugerida;
      const swTeto = ui.switch({ label: 'Teto de aceite automático', hint: 'Ofertas iguais ou melhores que o teto fecham sozinhas, mesmo de madrugada', checked: st.tetoOn, onChange: (v) => { st.tetoOn = v; draw(); } });
      const numTeto = ui.numeric({ suffix: '% a.m.', value: st.teto, min: 1.2, max: 3.5, decimals: 2, onInput: (v) => { st.teto = v; }, onBlur: (v) => { st.teto = v; draw(); } });
      const sldTeto = ui.slider({ min: 1.2, max: 3.5, step: 0.01, value: st.teto || 1.85, format: (v) => fmt.taxa(v), aria: 'Teto de aceite', onChange: (v) => { st.teto = C.round2(v); try { numTeto.value = st.teto; } catch (e) { /* */ } atualizaLado(); } });
      const cardTeto = ui.card({ title: 'Aceite automático', subtitle: 'Opcional. Sem teto, cada oferta espera o seu clique.' }, swTeto,
        st.tetoOn ? h('div.stack.tight', ui.field({ label: 'Aceitar sozinho até', required: true }, numTeto), sldTeto,
          h('div.small.muted', 'O motor só aceita ofertas dentro da sua política e do seu limite. O teto fica na trilha.')) : null);
      const cardIA = sug ? ui.card({ class: 'card-ai', title: h('span', ui.ai('Assistente'), ' Sugestão de preço') },
        faixaPreco(sug, Math.max(1, sug.faixa[0] - 0.3), sug.faixa[1] + 0.3),
        h('ul.ced-why', sug.racional.slice(0, 3).map((r) => h('li.small.muted', r))),
        h('div.row', ui.btn('Usar sugestão', { variant: 'ai', icon: 'sparkles', onclick: () => { st.teto = sug.sugerida; st.tetoOn = true; draw(); ui.toast('Sugestão aplicada no teto', { type: 'success', text: `Você decide: o aceite automático usa até ${fmt.taxa(sug.sugerida)}` }); } }))) : null;

      const selVal = ui.select({ aria: 'Validade da oferta', value: st.validadeH, options: [{ value: 6, label: '6 horas' }, { value: 24, label: '24 horas' }, { value: 48, label: '48 horas' }, { value: 72, label: '72 horas' }], onChange: (v) => { st.validadeH = v; draw(); } });
      return h('div.stack',
        ui.card({ title: 'Canal', subtitle: 'Onde a operação aparece para os financiadores' }, radioCanal, selFin ? h('div', h('div.sp-3'), selFin) : null),
        ui.card({ title: 'Regresso', subtitle: 'Escolha obrigatória, registrada na trilha', actions: [drawerRegresso] },
          radioReg,
          !st.regresso ? h('p.small.tone-amber', 'Escolha uma modalidade para continuar.') : null),
        h('div.grid.g2', cardTeto, cardIA || h('span')),
        ui.card({ title: 'Validade da oferta', subtitle: 'Depois do prazo sem aceite, os títulos voltam a ficar disponíveis' }, ui.field({ label: 'Oferta válida por', required: true }, selVal)),
        nav());
    }

    function passoSimulacao() {
      const face = faceSel();
      const pm = prazoMedioDe(selTitulos());
      const prodId = prodsSel()[0] || 'premium';
      const selic = E.selicAm();
      const pg = E.prazoPagamento(now());
      const corte = (() => { const t = cal.sp(now()); return cal.spTs(t.y, t.m, t.d, 14, 30); })();
      const antesCorte = cal.isUtil(now()) && now() <= corte;
      const bigEl = h('div.ced-big.num', fmt.taxa(st.taxa));
      const resBox = h('div.stack');
      const sld = ui.slider({ min: 1.2, max: 3.5, step: 0.01, value: st.taxa, format: (v) => fmt.taxa(v), aria: 'Taxa que você aceitaria', onChange: (v) => { st.taxa = C.round2(v); bigEl.textContent = fmt.taxa(st.taxa); pintar(); atualizaLado(); } });
      function pintar() {
        const sim = E.simular({ face, prazoDias: pm, taxaAm: st.taxa, produtoId: prodId });
        C.mount(resBox,
          h('div.grid.g2.keep2',
            ui.kpi({ label: 'Líquido para você', icon: 'banknote', display: fmt.brl(sim.liquido) }),
            ui.kpi({ label: 'Deságio', icon: 'percent', display: fmt.brl(sim.desagioValor), hint: `${fmt.num(sim.desagioPct, 2)}% da face` }),
            ui.kpi({ label: 'CET', icon: 'trending-up', display: fmt.taxa(sim.cetAm), hint: `SELIC ${fmt.taxa(selic)}` }),
            ui.kpi({ label: 'Prazo médio', icon: 'calendar', display: pm + ' dias' })),
          ui.callout({ tone: sim.cetAm <= selic ? 'success' : 'info', icon: 'scale', title: sim.cetAm <= selic ? 'Nesta taxa, o custo fica abaixo da SELIC' : 'Custo acima da SELIC',
            text: sim.cetAm <= selic ? `CET de ${fmt.taxa(sim.cetAm)} contra SELIC de ${fmt.taxa(selic)}.` : `O CET de ${fmt.taxa(sim.cetAm)} fica ${fmt.num(sim.cetAm - selic, 2)} p.p. acima da SELIC de ${fmt.taxa(selic)}. Avalie se o giro compensa o custo.` }));
      }
      const taxas = [1.2, 1.6, 2, 2.5, 3].map((tx) => Object.assign({ taxa: tx }, E.simular({ face, prazoDias: pm, taxaAm: tx, produtoId: prodId })));
      pintar();
      return h('div.stack',
        ui.card({ title: 'Quanto você aceita pagar?', subtitle: 'Arraste e veja o líquido na hora. A taxa final sai do leilão, não daqui.' },
          sld, bigEl, h('div.small.muted', 'taxa simulada ao mês')),
        ui.card({ title: 'Resultado na taxa simulada' }, resBox,
          h('div.sp-3'),
          ui.callout({ tone: antesCorte ? 'success' : 'warn', icon: 'clock', title: antesCorte ? 'Você está antes do corte das 14h30' : 'Você está após o corte das 14h30',
            text: `Aceite até 14h30 em dia útil paga no mesmo dia até 17h. Agora: ${fmt.time(now())}${antesCorte ? `, faltam ${fmt.dur(corte - now())} para o corte` : ', o pagamento cai no próximo dia útil'}. Previsão desta simulação: ${fmt.datetime(pg.limite)}.` })),
        ui.card({ title: 'Comparar taxas', subtitle: 'Mesma face e prazo, 5 cenários' },
          ui.table({ dense: true, rows: taxas, rowKey: (r) => r.taxa, columns: [
            { key: 'taxa', label: 'Taxa a.m.', render: (r) => h('strong.num', fmt.taxa(r.taxa)) },
            { key: 'liq', label: 'Líquido', align: 'right', render: (r) => h('span.num', fmt.brl(r.liquido)) },
            { key: 'des', label: 'Deságio', align: 'right', mobile: 'hide', render: (r) => h('span.num', fmt.brl(r.desagioValor)) },
            { key: 'cet', label: 'CET a.m.', align: 'right', render: (r) => h('span.num', fmt.taxa(r.cetAm)) },
          ], empty: h('span') })),
        nav());
    }

    function passoRevisao() {
      const tits = selTitulos();
      const face = faceSel();
      const pm = prazoMedioDe(tits);
      const prodId = prodsSel()[0] || 'premium';
      const sim = E.simular({ face, prazoDias: pm, taxaAm: st.taxa, produtoId: prodId });
      const fin = st.canal === 'balcao' ? db.get('orgs', st.finAlvo) : null;
      const chk = ui.checkbox({ label: 'Li e aceito os Termos de uso e o modelo de cessão', checked: st.aceite, onChange: (v) => { st.aceite = v; draw(); } });
      return h('div.stack',
        st.erro ? ui.callout({ tone: 'error', title: 'Não foi possível publicar', text: st.erro }) : null,
        ui.card({ title: 'Títulos', subtitle: `${fmt.plural(tits.length, 'título', 'títulos')}, programa ${(db.get('produtos', prodId) || {}).nome}` },
          h('ul.ced-manlist', tits.map((t) => h('li.ced-lote', h('div.grow', h('strong.small.mono', t.numero), h('div.small.muted', `${(sacadoDe(t) || {}).fantasia || 'sacado'} · vence ${fmt.date(t.vencimento)}`)), h('span.num', fmt.brl(t.valor)))))),
        ui.card({ title: 'Condições' },
          ui.kv([['Canal', st.canal === 'vitrine' ? 'Vitrine (leilão aberto)' : `Balcão (${(fin && (fin.fantasia || fin.nome)) || '—'})`], ['Regresso', st.regresso === 'com' ? 'Com regresso' : 'Sem regresso'], ['Teto automático', st.tetoOn ? `até ${fmt.taxa(st.teto)}` : 'desligado'], ['Validade', `${st.validadeH} horas`], ['Taxa simulada', fmt.taxa(st.taxa)], ['Líquido estimado', fmt.brl(sim.liquido)]])),
        ui.card({ title: 'Confirmar e publicar' }, chk,
          h('div.sp-3'),
          h('div.row.between', ui.btn('Voltar à simulação', { variant: 'ghost', icon: 'arrow-left', onclick: () => { st.passo = 2; draw(); } }),
            ui.btn('Publicar operação', { variant: 'primary', icon: 'megaphone', disabled: !st.aceite || !pub || bloqueada, title: !pub ? C.cannotMsg('publicar') : bloqueada ? 'Cadastro não ativo' : !st.aceite ? 'Aceite os termos para publicar' : '', onclick: async () => {
              const regTxt = st.regresso === 'com' ? 'com regresso' : 'sem regresso';
              const okk = await ui.confirm({ title: 'Publicar operação?', text: `Face ${fmt.brl(face)}, ${fmt.plural(tits.length, 'título', 'títulos')}, ${regTxt}. A publicação e o snapshot do que você viu entram na trilha.`, confirmLabel: 'Publicar' });
              if (!okk) return;
              const r = E.criarOperacao({ cedenteId: org.id, userId: session.get().userId, tituloIds: tits.map((t) => t.id), canal: st.canal, financiadorAlvoId: st.finAlvo, regresso: st.regresso === 'com', tetoTaxa: st.tetoOn ? st.teto : null, validadeH: st.validadeH,
                snapshotTela: { tela: 'Revisão e publicação da operação', taxaSimulada: st.taxa, liquidoEstimado: sim.liquido, face, prazoMedio: pm, tetoTaxa: st.tetoOn ? st.teto : null, validadeH: st.validadeH, canal: st.canal, regresso: regTxt, termos: 'Termos Cedy 0.1 + modelo de cessão v0.1' } });
              if (!r.ok) { st.erro = r.erro; draw(); return; }
              ui.toast('Operação publicada', { type: 'success', text: `${r.op.id} na ${st.canal === 'vitrine' ? 'Vitrine' : 'Balcão'}.` });
              C.router.go('/cedente/operacoes/' + r.op.id);
            } }))));
    }

    draw();
    return root;
  }

  /* --------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/cedente', roles: ['cedente'], title: 'Início', render: renderHome },
    { path: '/cedente/titulos', roles: ['cedente'], title: 'Meus títulos', render: renderTitulos },
    { path: '/cedente/importar', roles: ['cedente'], title: 'Importar títulos', render: renderImportar },
    { path: '/cedente/nova-operacao', roles: ['cedente'], title: 'Nova operação', render: renderNova },
  ]);
})();
