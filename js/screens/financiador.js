/* Cedy prototipo 0.1, telas do financiador (parte 1: inicio, vitrine, detalhe, balcao, lances).
   Persona principal: Rafael Tavares (f-vertice, admin). Classic script, sem modulos. */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt, cal } = C;
  const ui = C.ui, F = C.flows, E = C.engine;
  const { db, ledger, session } = C.store;

  const now = () => C.clock.now();
  const me = () => (session.get() || {}).orgId;
  const myUserId = () => (session.get() || {}).userId;
  const myOrg = () => db.get('orgs', me()) || {};
  const pol = () => myOrg().politica || {};
  const passo = () => (db.cfg().passoMinLance || 0.01);
  const r2 = C.round2;
  const dis = (p) => ({ disabled: true, title: C.cannotMsg(p) });
  const canLance = () => C.can('lance');

  const prodName = (id) => (db.get('produtos', id) || {}).nome || id;
  const finName = (id) => (db.get('orgs', id) || {}).fantasia || id;
  const sacName = (id) => (db.get('orgs', id) || {}).fantasia || id;

  function saudacao() { const t = cal.sp(now()); return t.h < 12 ? 'Bom dia' : t.h < 18 ? 'Boa tarde' : 'Boa noite'; }
  const firstName = (n) => String(n || '').split(' ')[0];
  const titulos = (op) => (op.tituloIds || []).map((id) => db.get('titulos', id)).filter(Boolean);
  const sacIds = (op) => [...new Set(titulos(op).map((t) => t.sacadoId))];
  const sacOrgs = (op) => sacIds(op).map((id) => db.get('orgs', id)).filter(Boolean);

  const OPEN = ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'];
  const myOps = () => db.where('operacoes', (o) => o.financiadorId === me() && OPEN.includes(o.status));
  const abertasVitrine = () => db.where('operacoes', (o) => o.status === 'aberta' && o.canal === 'vitrine').sort((a, b) => a.validadeAte - b.validadeAte);
  const meuBalcao = () => db.where('operacoes', (o) => o.canal === 'balcao' && o.financiadorAlvoId === me()).sort((a, b) => (b.publicadaEm || b.criadaEm) - (a.publicadaEm || a.criadaEm));

  /** Letras estaveis por operacao para os concorrentes anonimos. */
  function anonMap(opId) {
    const ids = [...new Set(E.lancesDaOp(opId).map((l) => l.finId))].sort();
    const m = {}; ids.forEach((id, i) => { m[id] = 'BCDEF'[i] || ('F' + (i + 2)); }); return m;
  }
  const anonLabel = (op, finId, map) => (finId === me() ? 'Você' : 'Financiador ' + ((map || anonMap(op.id))[finId] || '?'));

  /** Cedente anonimizado na Vitrine: setor, UF e inicio da fantasia, nome oculto ate o aceite. */
  function cedenteAnon(op) {
    const c = db.get('orgs', op.cedenteId) || {};
    const first = String(c.fantasia || c.nome || 'Empresa').split(' ')[0];
    return `${c.setor || 'Empresa'} · ${c.uf || ''} · ${first}…`.replace(' ·  · ', ' · ');
  }

  function minhaPosicao(op) {
    const m = E.melhorLance(op.id);
    if (m && m.finId === me()) return ui.badge('Líder', 'green', { dot: true });
    const mine = E.lancesDaOp(op.id).some((l) => l.finId === me() && ['ativo', 'superado'].includes(l.status));
    return mine ? ui.badge('Superada', 'amber', { dot: true }) : ui.badge('Sem lance', 'neutral');
  }

  function policyChip(op, taxa) {
    const p = E.checarPolitica(me(), op, taxa != null ? taxa : undefined);
    if (p.ok) return ui.badge('Cabe na política', 'green', { dot: true, title: (p.aprovados || []).slice(0, 3).join('; ') });
    return ui.badge('Fora da política', 'red', { dot: true, title: (p.motivos || []).join('; ') });
  }

  function minNext(op) { const m = E.melhorLance(op.id); return m ? r2(m.taxaAm - passo()) : null; }

  /** Fluxo de cobertura: oferta exatamente um passo abaixo da melhor, com confirmacao da firmeza. */
  function cobrirFlow(op) {
    if (!C.can('lance')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('lance') }); return; }
    const m = E.melhorLance(op.id);
    if (!m || m.finId === me()) { ui.toast('Nada a cobrir', { type: 'info', text: 'Você já lidera esta operação ou não há ofertas.' }); return; }
    const taxa = r2(m.taxaAm - passo());
    const met = E.metricasOp(op, taxa);
    ui.confirm({
      title: `Cobrir com ${fmt.taxa(taxa)} em ${op.id}`, icon: 'gavel',
      text: `Oferta firme por ${db.cfg().firmezaHoras}h: só pode ser retirada após esse prazo. Líquido ao cedente: ${fmt.brl(met.liquido)}.`,
      confirmLabel: 'Confirmar oferta',
    }).then((okc) => {
      if (!okc) return;
      const r = E.darLance(op.id, me(), taxa, { userId: myUserId() });
      if (r.ok) ui.toast(r.aceiteAutomatico ? 'Oferta aceita na hora' : 'Oferta registrada', { type: 'success', text: r.aceiteAutomatico ? 'O teto do cedente foi atingido.' : `Você lidera ${op.id} com ${fmt.taxa(taxa)}.` });
      else ui.toast('Não foi possível ofertar', { type: 'error', text: r.erro });
    });
  }

  /** Regresso a partir do financiador: confirmacao com valores, motor executa. */
  function regressoFlow(opId) {
    const op = db.get('operacoes', opId);
    if (!op) return;
    if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    const abertas = titulos(op).filter((t) => !['liquidado', 'recomprado'].includes(t.status));
    const vMin = Math.min(...abertas.map((t) => t.vencimento));
    const dias = Math.max(1, cal.daysBetween(vMin, now()));
    const saldo = E.saldoAberto(op);
    const encargos = r2(saldo * 0.02 + saldo * 0.01 * dias / 30);
    const total = r2(saldo + encargos);
    const ate = cal.addUteis(now(), 5);
    ui.confirm({
      title: 'Acionar regresso em ' + op.id, icon: 'rotate-ccw', tone: 'danger', confirmLabel: 'Acionar regresso',
      text: 'O cedente será notificado e deverá recomprar os títulos em até 5 dias úteis.',
      children: ui.kv([['Saldo em aberto', fmt.brl(saldo)], ['Multa (2%)', fmt.brl(r2(saldo * 0.02))], ['Mora (1% a.m., ' + dias + ' dias)', fmt.brl(r2(saldo * 0.01 * dias / 30))], ['Total da recompra', h('strong', fmt.brl(total))], ['Prazo da recompra', fmt.date(ate)]]),
    }).then((okc) => {
      if (!okc) return;
      const r = E.acionarRegresso(opId, myUserId());
      if (r.ok) ui.toast('Regresso acionado', { type: 'success', text: `Recompra de ${fmt.brl(total)} devida até ${fmt.date(ate)}.` });
      else ui.toast('Não foi possível acionar', { type: 'error', text: r.erro });
    });
  }
  /* ============================ /financiador (inicio) ============================ */
  function itensPendentes() {
    const items = [];
    const mine = myOps();
    mine.filter((o) => o.status === 'cessao').forEach((o) => {
      const ct = o.contratoId && db.get('contratos', o.contratoId);
      const euAssinei = ct && (ct.assinaturas || []).some((s) => s.parte === 'financiador');
      if (ct && !euAssinei) items.push({ icon: 'file-signature', tone: 'amber', title: `Assine a cessão de ${o.id}`, sub: `${fmt.brl(o.liquido)} a pagar, ${(db.get('orgs', o.cedenteId) || {}).fantasia || 'cedente'}`,
        side: o.pagamentoLimite ? ui.countdown(o.pagamentoLimite, { prefix: 'pagar até', endLabel: 'limite estourado' }) : null,
        action: C.can('assinar') ? ui.btn('Assinar', { size: 'sm', variant: 'primary', onclick: () => F.assinar(o.contratoId, 'financiador') }) : ui.btn('Assinar', Object.assign({ size: 'sm', variant: 'primary' }, dis('assinar'))) });
    });
    mine.filter((o) => o.status === 'aguardando_pagamento').forEach((o) => {
      const late = now() > o.pagamentoLimite;
      items.push({ icon: 'banknote', tone: late ? 'red' : 'amber', title: late ? `Pagamento em atraso: ${o.id}` : `Pagar ${o.id} até ${fmt.datetime(o.pagamentoLimite)}`, sub: `${fmt.brl(o.liquido)} para ${(db.get('orgs', o.cedenteId) || {}).fantasia || 'cedente'}`,
        side: ui.countdown(o.pagamentoLimite, { prefix: late ? 'em atraso há' : 'faltam', endLabel: 'limite estourado' }),
        action: C.can('pagar') ? ui.btn(late ? 'Pagar agora' : 'Pagar', { size: 'sm', variant: 'primary', onclick: () => F.pagar(o.id) }) : ui.btn('Pagar', Object.assign({ size: 'sm', variant: 'primary' }, dis('pagar'))) });
    });
    db.where('operacoes', (o) => o.status === 'aberta' && o.canal === 'vitrine').forEach((o) => {
      const m = E.melhorLance(o.id);
      const mineBid = E.lancesDaOp(o.id).some((l) => l.finId === me() && l.status === 'superado');
      if (mineBid && m && m.finId !== me()) items.push({ icon: 'gavel', tone: 'amber', title: `Sua oferta em ${o.id} foi superada`, sub: `Melhor agora: ${fmt.taxa(m.taxaAm)}`,
        side: ui.countdown(o.validadeAte, { prefix: 'encerra em', endLabel: 'leilão encerrado' }),
        action: C.can('lance') ? ui.btn('Cobrir', { size: 'sm', onclick: () => cobrirFlow(o) }) : ui.btn('Cobrir', Object.assign({ size: 'sm' }, dis('lance'))) });
    });
    meuBalcao().filter((o) => o.status === 'aberta').forEach((o) => {
      items.push({ icon: 'handshake', tone: 'teal', title: `Balcão: ${(db.get('orgs', o.cedenteId) || {}).fantasia || 'cedente'} aguarda sua oferta em ${o.id}`, sub: `${fmt.brl(o.face)} · prazo médio ${o.prazoMedio || '—'} dias`,
        side: ui.countdown(o.validadeAte, { prefix: 'encerra em', endLabel: 'oferta encerrada' }),
        action: ui.btn('Ver e ofertar', { size: 'sm', variant: 'primary', route: '/financiador/vitrine/' + o.id }) });
    });
    mine.filter((o) => ['vencida', 'parcial'].includes(o.status) && o.regresso && !o.regressoAcionado).forEach((o) => {
      items.push({ icon: 'rotate-ccw', tone: 'red', title: `${o.id} vencida: regresso disponível`, sub: `Saldo em aberto ${fmt.brl(E.saldoAberto(o))}`,
        action: C.can('operar') ? ui.btn('Acionar regresso', { size: 'sm', variant: 'danger', onclick: () => regressoFlow(o.id) }) : ui.btn('Acionar regresso', Object.assign({ size: 'sm', variant: 'danger' }, dis('operar'))) });
    });
    db.where('faturas', (f) => f.finId === me() && ['aberta', 'vencida'].includes(f.status)).forEach((f) => {
      items.push({ icon: 'receipt', tone: f.status === 'vencida' ? 'red' : 'amber', title: `Fatura ${f.competencia} ${f.status === 'vencida' ? 'vencida' : 'em aberto'}: ${fmt.brl(f.total)}`, sub: `Vence ${fmt.date(f.vencimento)} · TS ${fmt.brl(f.tsTotal)}`,
        action: ui.btn('Ver faturamento', { size: 'sm', route: '/financiador/faturamento' }) });
    });
    return items;
  }

  function cardPendentes() {
    return ui.live(['operacoes', 'lances', 'contratos', 'faturas'], () => {
      const items = itensPendentes();
      if (!items.length) return ui.card({ title: 'Ações pendentes' }, ui.empty({ icon: 'circle-check', title: 'Nada pendente', text: 'Nenhuma assinatura, pagamento, cobertura ou fatura precisa de você agora.' }));
      return ui.card({ title: 'Ações pendentes', subtitle: fmt.plural(items.length, 'item pedindo ação', 'itens pedindo ação') },
        h('ul.fin-attn', items.map((it) => h('li.fin-attn-item',
          h('span', { class: ['fin-attn-ic', 'tone-' + it.tone] }, icon(it.icon, 18)),
          h('div.grow', h('strong', it.title), it.sub && h('div.small.muted', it.sub)),
          it.side, it.action))));
    });
  }

  function kpisHome() {
    return ui.live(['operacoes', 'titulos', 'lances'], () => {
      const ops = myOps();
      const cap = r2(C.sum(ops, (o) => (['liquidada', 'recomprada'].includes(o.status) ? 0 : (o.saldoAberto !== undefined ? o.saldoAberto : o.face))));
      const comTaxa = ops.filter((o) => o.taxaFinal);
      const taxaMed = comTaxa.length ? C.sum(comTaxa, (o) => o.taxaFinal * o.face) / C.sum(comTaxa, (o) => o.face) : null;
      const t7 = now() + 7 * 86400000;
      const aReceber = r2(C.sum(ops, (o) => C.sum(titulos(o).filter((t) => ['cedido', 'vencido'].includes(t.status) && t.vencimento <= t7), (t) => t.valor)));
      const total = pol().limiteTotal || 0;
      const exp = E.exposicaoFin(me());
      const uso = total > 0 ? Math.min(100, (exp / total) * 100) : 0;
      return h('div.grid.g4',
        ui.kpi({ label: 'Capital alocado', icon: 'briefcase', display: fmt.brl(cap), hint: fmt.plural(ops.length, 'operação em carteira', 'operações em carteira'), onclick: () => C.router.go('/financiador/carteira') }),
        ui.kpi({ label: 'Taxa média bruta a.m.', icon: 'trending-up', display: taxaMed !== null ? fmt.taxa(taxaMed) : '—', hint: 'média ponderada pela face' }),
        ui.kpi({ label: 'A receber em 7 dias', icon: 'calendar', display: fmt.brl(aReceber), hint: 'pagamentos previstos de sacados' }),
        ui.kpi({ label: 'Limite disponível', icon: 'gauge', display: total ? fmt.brl(Math.max(0, total - exp)) : '—', hint: total ? `de ${fmt.brlCompact(total)} no total` : 'sem limite configurado' }));
    });
  }

  function limiteBar() {
    return ui.live(['operacoes', 'titulos'], () => {
      const total = pol().limiteTotal || 0;
      if (!total) return h('div');
      const exp = E.exposicaoFin(me());
      const uso = Math.min(100, (exp / total) * 100);
      return ui.card({ title: 'Uso do limite total', subtitle: `${fmt.brl(exp)} em uso de ${fmt.brl(total)}` },
        ui.progress(uso, { tone: uso >= 90 ? 'red' : uso >= 70 ? 'amber' : undefined }),
        h('div.small.muted', `${fmt.pct(uso, 1)} utilizado · exposição = face em aberto das operações em carteira`));
    });
  }

  function cardOportunidades() {
    return ui.live(['operacoes', 'lances'], () => {
      const cands = abertasVitrine().map((op) => ({ op, p: E.ia.parecer(op, me()) })).filter((x) => x.p.politica.ok).sort((a, b) => b.p.score - a.p.score).slice(0, 5);
      if (!cands.length) return ui.card({ class: 'card-ai', title: h('span', ui.ai('Agente de Crédito'), ' Oportunidades') }, ui.empty({ icon: 'sparkles', title: 'Nada que caiba na política agora', text: 'Ajuste os filtros da Vitrine ou revise a política de crédito para ver sugestões.' }));
      return ui.card({ class: 'card-ai', title: h('span', ui.ai('Agente de Crédito'), ' Oportunidades que cabem na sua política'), subtitle: 'A IA só aconselha: quem dá o lance é você, pelo motor',
        actions: [ui.btn('Ver Vitrine', { variant: 'ai', size: 'sm', icon: 'store', route: '/financiador/vitrine' })] },
        h('div.stack.tight', cands.map(({ op, p }) => {
          const met = E.metricasOp(op, p.taxaSugerida);
          const sacs = sacOrgs(op);
          return h('div.fin-opp',
            h('div.grow',
              h('div.row', h('a.mono.strong', { href: '#/financiador/vitrine/' + op.id }, op.id), ui.badge('IA ' + p.score, 'violet'), policyChip(op)),
              h('div.small.muted', `${fmt.brl(met.liquido)} líquidos de ${fmt.brl(met.face)} · ${met.prazoMedio}d · sugerida ${fmt.taxa(p.taxaSugerida)}`),
              h('div.small.muted', 'Sacados: ' + sacs.map((s) => `${s.fantasia} (${s.rating})`).join(', '))),
            ui.btn('Dar lance', Object.assign({ size: 'sm', variant: 'primary', route: '/financiador/vitrine/' + op.id }, canLance() ? {} : dis('lance'))));
        })));
    });
  }

  function cardVencSemana() {
    return ui.live(['operacoes', 'titulos'], () => {
      const hoje = cal.startOfDay(now());
      const linhas = [];
      myOps().forEach((o) => {
        titulos(o).filter((t) => ['cedido', 'vencido'].includes(t.status)).forEach((t) => {
          const s = db.get('orgs', t.sacadoId) || {};
          linhas.push({ ts: t.vencimento, atraso: t.vencimento < hoje, sacado: s.fantasia || '?', valor: t.valor, opId: o.id });
        });
      });
      const rel = linhas.filter((l) => l.ts <= hoje + 7 * 86400000);
      if (!rel.length) return ui.card({ title: 'Vencimentos da semana', subtitle: 'próximos 7 dias' }, ui.empty({ icon: 'calendar', title: 'Sem vencimentos previstos', text: 'Títulos cedidos a vencer aparecem aqui por dia.' }));
      const atr = rel.filter((l) => l.atraso);
      const dias = Array.from({ length: 7 }, (_, i) => hoje + i * 86400000);
      const grupos = dias.map((d0) => ({ d0, ls: rel.filter((l) => !l.atraso && cal.startOfDay(l.ts) === d0) })).filter((g) => g.ls.length);
      const atrNode = atr.length ? h('li.fin-week-item.fin-late',
        h('div.fin-week-dia', h('strong', 'Em atraso'), h('small', fmt.plural(atr.length, 'título', 'títulos'))),
        h('div.grow', atr.slice(0, 3).map((l) => h('div.small', `${l.sacado} · `, h('span.mono', l.opId)))),
        h('strong.num', fmt.brl(C.sum(atr, (l) => l.valor)))) : null;
      const diaNodes = grupos.map((g) => h('li.fin-week-item',
        h('div.fin-week-dia', h('strong', fmt.dateShort(g.d0)), h('small', fmt.weekday(g.d0))),
        h('div.grow', g.ls.slice(0, 3).map((l) => h('div.small', `${l.sacado} · `, h('span.mono', l.opId)))),
        h('strong.num', fmt.brl(C.sum(g.ls, (l) => l.valor)))));
      return ui.card({ title: 'Vencimentos da semana', subtitle: 'títulos cedidos por dia de vencimento' },
        h('ul.fin-week', atrNode, diaNodes));
    });
  }

  function cardFluxo() {
    const semanas = Array.from({ length: 8 }, (_, i) => now() + i * 7 * 86400000);
    const dados = semanas.map((s0) => {
      const s1 = s0 + 7 * 86400000;
      return r2(C.sum(myOps(), (o) => C.sum(titulos(o).filter((t) => ['cedido', 'vencido'].includes(t.status) && t.vencimento >= (s0 === semanas[0] ? now() - 86400000 : s0) && t.vencimento < s1), (t) => t.valor)));
    });
    return ui.card({ title: 'Fluxo de caixa esperado', subtitle: 'títulos cedidos por semana de vencimento' },
      ui.chart.bars({ categories: semanas.map((s) => fmt.dateShort(s)), series: [{ name: 'A receber', tone: 'teal', data: dados }], format: (v) => fmt.brlCompact(v), height: 200 }));
  }

  function cardConcentracao() {
    return ui.live(['operacoes', 'titulos'], () => {
      const by = new Map();
      myOps().forEach((o) => titulos(o).filter((t) => !['liquidado', 'recomprado'].includes(t.status)).forEach((t) => by.set(t.sacadoId, (by.get(t.sacadoId) || 0) + t.valor)));
      const items = [...by.entries()].map(([id, v]) => {
        const s = db.get('orgs', id) || {};
        const lim = ((pol().limiteSacado || {})[id] !== undefined ? pol().limiteSacado[id] : pol().limiteSacadoPadrao);
        const uso = lim ? v / lim : 0;
        return { label: s.fantasia || id, value: r2(v), tone: uso >= 1 ? 'red' : uso >= 0.8 ? 'amber' : 'teal', hint: lim ? `uso ${fmt.brl(v, { round: true })} de ${fmt.brl(lim, { round: true })}` : fmt.brl(v, { round: true }) };
      }).sort((a, b) => b.value - a.value).slice(0, 6);
      if (!items.length) return ui.card({ title: 'Concentração por sacado' }, ui.empty({ icon: 'chart-pie', title: 'Sem exposição aberta' }));
      return ui.card({ title: 'Concentração por sacado', subtitle: 'face em aberto com uso do limite' }, ui.chart.hbars(items, { format: (v) => fmt.brl(v, { round: true }) }));
    });
  }

  function cardMercado() {
    const fechadas = db.all('operacoes').filter((o) => o.taxaFinal).sort((a, b) => (a.aceitaEm || 0) - (b.aceitaEm || 0));
    const porProg = C.groupBy(fechadas, (o) => o.produto);
    const rows = Object.keys(porProg).map((p) => {
      const taxas = porProg[p].slice(-12).map((o) => o.taxaFinal);
      return h('div.fin-mkt-row', h('div.grow', h('strong', prodName(p)), h('div.small.muted', `${taxas.length} fechadas`)), taxas.length > 1 ? ui.chart.spark(taxas, { tone: 'blue' }) : h('span.muted.small', 'série curta'), h('strong.num', fmt.taxa(taxas[taxas.length - 1])));
    });
    if (!rows.length) return ui.card({ title: 'Mercado' }, h('p.muted.small', 'Sem histórico de taxas fechadas.'));
    return ui.card({ title: 'Mercado', subtitle: 'últimas taxas fechadas por programa' }, h('div.stack.tight', rows));
  }

  function renderHome(ctx) {
    const org = ctx.org || myOrg();
    const user = ctx.user || session.user();
    return h('div.stack',
      ui.pageHeader({ eyebrow: `${org.fantasia || org.nome} · Financiador`, title: `${saudacao()}, ${firstName(user && user.nome)}`, subtitle: `${fmt.dateLong(now())} · ${fmt.time(now())}. Ofertas firmes por ${db.cfg().firmezaHoras}h, o mercado responde em segundos.`, actions: [ui.btn('Vitrine', { variant: 'primary', icon: 'store', route: '/financiador/vitrine' }), ui.btn('Meus lances', { icon: 'gavel', route: '/financiador/lances' })] }),
      cardPendentes(),
      kpisHome(),
      h('div.grid.g-2-1', cardOportunidades(), cardVencSemana()),
      limiteBar(),
      h('div.grid.g2', cardFluxo(), cardConcentracao()),
      cardMercado());
  }
  /* ============================ /financiador/vitrine ============================ */
  function filtrarVitrine(ops, st) {
    return ops.filter((o) => {
      if (st.q && !(o.id.toLowerCase().includes(st.q) || cedenteAnon(o).toLowerCase().includes(st.q))) return false;
      if (st.progs.length && !st.progs.includes(o.produto)) return false;
      const met = E.metricasOp(o, 1.8);
      if (st.prazoMin != null && met.prazoMedio < st.prazoMin) return false;
      if (st.prazoMax != null && met.prazoMedio > st.prazoMax) return false;
      if (st.valorMin != null && met.face < st.valorMin) return false;
      if (st.valorMax != null && met.face > st.valorMax) return false;
      if (st.ratings.length && !sacOrgs(o).some((s) => st.ratings.includes(s.rating))) return false;
      if (st.regresso === 'com' && !o.regresso) return false;
      if (st.regresso === 'sem' && o.regresso) return false;
      if (st.soPolitica && !E.checarPolitica(me(), o, null).ok) return false;
      return true;
    });
  }

  function ordenarVitrine(ops, sort) {
    const arr = ops.slice();
    const taxaDe = (o) => { const m = E.melhorLance(o.id); return m ? m.taxaAm : 999; };
    if (sort === 'prazo') arr.sort((a, b) => E.metricasOp(a, 1.8).prazoMedio - E.metricasOp(b, 1.8).prazoMedio);
    else if (sort === 'valor') arr.sort((a, b) => b.face - a.face);
    else if (sort === 'taxa') arr.sort((a, b) => taxaDe(a) - taxaDe(b));
    else arr.sort((a, b) => a.validadeAte - b.validadeAte);
    return arr;
  }

  function vitrineCard(op) {
    const m = E.melhorLance(op.id);
    const met = E.metricasOp(op, m ? m.taxaAm : 1.8);
    const sacs = sacOrgs(op);
    const score = E.ia.parecer(op, me()).score;
    const map = anonMap(op.id);
    const mine = m && m.finId === me();
    const go = () => C.router.go('/financiador/vitrine/' + op.id);
    const stop = (e) => e.stopPropagation();
    return ui.card({ class: 'card-hover fin-card', onclick: go },
      h('div.fin-card-top',
        h('div.row', h('span.mono.strong', op.id), ui.badge(prodName(op.produto), 'blue'), o_regresso(op), minhaPosicao(op)),
        ui.countdown(op.validadeAte, { prefix: 'encerra em', endLabel: 'leilão encerrado' })),
      h('div.small.muted', `Cedente: ${cedenteAnon(op)} · ${op.nTitulos || met.nTitulos} títulos`),
      h('div.fin-card-nums', h('div', h('div.fin-num.num', fmt.brl(met.face, { round: true })), h('small', 'face')),
        h('div', h('div.fin-num.num', met.prazoMedio + 'd'), h('small', 'prazo médio')),
        h('div', h('div.fin-num.num', m ? fmt.taxa(m.taxaAm) : '—'), h('small', m ? `melhor (${anonLabel(op, m.finId, map)})` : 'sem ofertas'))),
      h('div.small', 'Sacados: ', sacs.map((s) => `${s.fantasia} `).join(''), h('span.fin-ratings', sacs.map((s) => F.ratingBadge(s.rating || 'D')))),
      h('div.row.between', h('div.row', policyChip(op), ui.badge('IA ' + score, 'violet', { title: 'Pontuação do Agente de Crédito (0 a 100)' })),
        h('div.row', (m && !mine && canLance()) ? ui.btn('Cobrir', { size: 'sm', onclick: (e) => { stop(e); cobrirFlow(op); } }) : null,
          ui.btn('Ver', { size: 'sm', variant: 'primary', onclick: (e) => { stop(e); go(); } }))));
  }
  const o_regresso = (op) => ui.badge(op.regresso ? 'Com regresso' : 'Sem regresso', op.regresso ? 'teal' : 'amber');

  function renderVitrine() {
    const progsAll = [...new Set(abertasVitrine().map((o) => o.produto))];
    const st = { q: '', progs: [], prazoMin: null, prazoMax: null, valorMin: null, valorMax: null, ratings: [], regresso: 'todos', soPolitica: true, sort: 'encerra', view: 'cards' };
    const bar = h('div.toolbar.fin-filterbar');
    const qCtl = ui.search({ placeholder: 'Buscar por operação', onInput: C.debounce((v) => { st.q = v.trim().toLowerCase(); C.store.emit('fin-fvit'); }, 220) });
    const progCtl = ui.chips({ aria: 'Programa', value: st.progs, options: progsAll.map((p) => ({ value: p, label: prodName(p) })), onChange: (v) => { st.progs = v; C.store.emit('fin-fvit'); } });
    const ratingCtl = ui.chips({ aria: 'Rating do sacado', value: st.ratings, options: ['A', 'B', 'C'].map((r) => ({ value: r, label: 'Rating ' + r })), onChange: (v) => { st.ratings = v; C.store.emit('fin-fvit'); } });
    const regrCtl = ui.select({ aria: 'Regresso', value: st.regresso, options: [{ value: 'todos', label: 'Com ou sem regresso' }, { value: 'com', label: 'Só com regresso' }, { value: 'sem', label: 'Só sem regresso' }], onChange: (v) => { st.regresso = v; C.store.emit('fin-fvit'); } });
    const sortCtl = ui.select({ aria: 'Ordenar', value: st.sort, options: [{ value: 'encerra', label: 'Encerrando primeiro' }, { value: 'prazo', label: 'Menor prazo' }, { value: 'valor', label: 'Maior valor' }, { value: 'taxa', label: 'Menor taxa atual' }], onChange: (v) => { st.sort = v; C.store.emit('fin-fvit'); } });
    const polCtl = ui.segmented({ value: st.soPolitica ? 'cabem' : 'todas', aria: 'Filtro de política', options: [{ value: 'cabem', label: 'Só as que cabem' }, { value: 'todas', label: 'Todas' }], onChange: (v) => { st.soPolitica = v === 'cabem'; C.store.emit('fin-fvit'); } });
    const viewCtl = ui.segmented({ value: st.view, aria: 'Exibição', options: [{ value: 'cards', label: 'Cartões', icon: 'layout-grid' }, { value: 'tabela', label: 'Tabela', icon: 'list' }], onChange: (v) => { st.view = v; C.store.emit('fin-fvit'); } });
    const pzMin = ui.numeric({ placeholder: 'Prazo mín (d)', aria: 'Prazo mínimo em dias', min: 1, max: 360, onInput: (v) => { st.prazoMin = v; C.store.emit('fin-fvit'); } });
    const pzMax = ui.numeric({ placeholder: 'Prazo máx (d)', aria: 'Prazo máximo em dias', min: 1, max: 360, onInput: (v) => { st.prazoMax = v; C.store.emit('fin-fvit'); } });
    const vlMin = ui.currency({ placeholder: 'Valor mín', aria: 'Valor mínimo', onInput: (v) => { st.valorMin = v || null; C.store.emit('fin-fvit'); } });
    const vlMax = ui.currency({ placeholder: 'Valor máx', aria: 'Valor máximo', onInput: (v) => { st.valorMax = v || null; C.store.emit('fin-fvit'); } });
    bar.append(qCtl, progCtl, ratingCtl, regrCtl, sortCtl);
    const bar2 = h('div.toolbar.fin-filterbar', ui.field({ label: 'Prazo (dias)' }, h('div.row', pzMin, pzMax)), ui.field({ label: 'Valor de face' }, h('div.row', vlMin, vlMax)), polCtl, viewCtl);

    const lista = ui.live(['operacoes', 'lances', 'fin-fvit'], () => {
      const ops = ordenarVitrine(filtrarVitrine(abertasVitrine(), st), st.sort);
      const count = h('div.small.muted', `${ops.length} ${ops.length === 1 ? 'oportunidade' : 'oportunidades'}${st.soPolitica ? ' dentro da sua política' : ''}`);
      if (!ops.length) return h('div.stack', count, ui.empty({ icon: 'store', title: 'Nenhuma oportunidade aqui', text: st.soPolitica ? 'Nenhuma operação aberta cabe na sua política agora. Veja todas ou revise os filtros.' : 'Ajuste os filtros para ver oportunidades.', action: st.soPolitica ? ui.btn('Ver todas', { onclick: () => { st.soPolitica = false; polCtl.value = 'todas'; C.store.emit('fin-fvit'); } }) : null }));
      if (st.view === 'tabela') {
        return h('div.stack', count, ui.table({
          rows: ops, rowKey: (o) => o.id, onRowClick: (o) => C.router.go('/financiador/vitrine/' + o.id),
          columns: [
            { key: 'id', label: 'Operação', mobile: 'primary', render: (o) => h('div', h('span.mono.strong', o.id), h('div.row', { style: 'margin-top:4px' }, ui.badge(prodName(o.produto), 'blue'))) },
            { key: 'ced', label: 'Cedente', mobile: 'hide', render: (o) => h('span.small', cedenteAnon(o)) },
            { key: 'face', label: 'Face', align: 'right', sort: true, render: (o) => h('span.num', fmt.brl(o.face, { round: true })) },
            { key: 'prazo', label: 'Prazo', align: 'right', mobile: 'hide', render: (o) => h('span.num', (o.prazoMedio || E.metricasOp(o, 1.8).prazoMedio) + 'd') },
            { key: 'taxa', label: 'Melhor taxa', align: 'right', render: (o) => { const m = E.melhorLance(o.id); return m ? h('span.num', fmt.taxa(m.taxaAm)) : h('span.muted', 'sem ofertas'); } },
            { key: 'pos', label: 'Posição', render: (o) => minhaPosicao(o) },
            { key: 'pol', label: 'Política', mobile: 'hide', render: (o) => policyChip(o) },
            { key: 'fim', label: 'Encerra', mobile: 'secondary', render: (o) => ui.countdown(o.validadeAte, { endLabel: 'encerrado' }) },
          ],
        }));
      }
      return h('div.stack', count, h('div.grid.g3', ops.map(vitrineCard)));
    });

    return h('div.stack',
      ui.pageHeader({ title: 'Vitrine', subtitle: 'Leilão reverso aberto: a menor taxa leva. Ofertas firmes por 3h, identidade oculta até o aceite.', actions: [ui.btn('Meus lances', { icon: 'gavel', route: '/financiador/lances' })] }),
      bar, bar2, lista);
  }
  /* ========================= /financiador/vitrine/:id (detalhe) ========================= */
  function calcNodes(op, taxa) {
    const met = E.metricasOp(op, taxa);
    const selic = E.selicAm();
    return ui.kv([
      ['Líquido pago ao cedente', h('strong', fmt.brl(met.liquido))],
      ['Deságio', `${fmt.brl(met.desagioValor)} (${fmt.pct(met.desagioPct)})`],
      ['CET da operação', fmt.taxa(met.cetAm)],
      ['Retorno bruto', fmt.brl(met.desagioValor)],
      ['TS (taxa de serviço)', `${fmt.brl(met.ts)} (${fmt.pct(met.tsPct, 0)} do spread${met.tsNoPiso ? ', piso aplicado' : ''})`],
      ['Composição da TS', h('small', `spread ${fmt.brl(met.spreadValor)} × ${fmt.pct(met.tsPct, 0)} = ${fmt.brl(met.tsBruto)}; piso ${fmt.brl(met.tsPiso)}`)],
      ['Retorno líquido', h('strong', fmt.brl(met.retornoFinanciador))],
      ['Rentabilidade líquida', `${fmt.pct(met.retornoFinanciadorAm, 2)} a.m. (SELIC ${fmt.taxa(selic)})`],
    ]);
  }

  function painelLance(op, parecer) {
    const wrap = h('div.fin-bid');
    if (!canLance()) {
      const lc = ui.card({ title: 'Dar lance' },
        ui.callout({ tone: 'info', title: 'Perfil de leitura', text: 'Seu perfil (' + (session.user() || {}).perfil + ') não pode ofertar. Os valores abaixo são simulados com a taxa sugerida.' }),
        h('div.sp-3'), calcNodes(op, parecer.taxaSugerida));
      lc._setTaxa = () => {};
      return lc;
    }
    const m0 = E.melhorLance(op.id);
    const minT = 1.20;
    const max0 = m0 ? r2(m0.taxaAm - passo()) : 2.50;
    const maxT = Math.max(minT, max0);
    let taxa = m0 ? maxT : r2(Math.min(Math.max(parecer.taxaSugerida, minT), maxT));

    const bestLine = h('div.small');
    const minLine = h('div.small.muted');
    const drawHead = () => {
      const m = E.melhorLance(op.id);
      C.clear(bestLine);
      bestLine.append(m ? h('span', 'Melhor agora: ', h('strong.num', fmt.taxa(m.taxaAm)), ` (${anonLabel(op, m.finId)})`) : h('span.muted', 'Sem ofertas: sua oferta abre o leilão'));
      const mine = E.lancesDaOp(op.id).filter((l) => l.finId === me() && ['ativo', 'superado'].includes(l.status)).sort((a, b) => a.taxaAm - b.taxaAm)[0];
      if (mine) bestLine.append(h('span.small.muted', ` · sua última: ${fmt.taxa(mine.taxaAm)}`));
      const mx = m ? r2(m.taxaAm - passo()) : null;
      C.clear(minLine);
      minLine.append(mx ? `Próxima oferta máxima aceita: ${fmt.taxa(mx)} (passo ${fmt.taxa(passo())})` : 'Sem teto de concorrência: vale qualquer taxa acima de zero');
    };
    drawHead();

    const calcEl = h('div.fin-calc');
    const recalc = (t) => C.mount(calcEl, calcNodes(op, t));
    const num = ui.numeric({ value: taxa, suffix: '% a.m.', decimals: 2, min: minT, max: maxT, aria: 'Taxa da oferta em % ao mês' });
    const sli = ui.slider({ value: taxa, min: minT, max: maxT, step: 0.01, format: (v) => fmt.taxa(v), aria: 'Taxa da oferta' });
    num.addEventListener('change', () => { if (num.value != null) { sli.value = Math.min(maxT, Math.max(minT, num.value)); recalc(sli.value); } });
    sli.addEventListener('change', () => { num.value = sli.value; recalc(sli.value); });
    recalc(taxa);
    const field = ui.field({ label: 'Sua taxa', hint: `Entre ${fmt.taxa(minT)} e ${fmt.taxa(maxT)}; quanto menor, maior a chance de levar.` }, num);

    const btnDar = ui.btn('Dar lance', { variant: 'primary', icon: 'gavel', onclick: () => attemptBid(op, num.value, field, wrap, drawHead, recalc) });
    const fechado = h('div.fin-closed', { hidden: true });
    const mNow = () => E.melhorLance(op.id);
    const btnCobrir = ui.btn('Cobrir', { icon: 'zap', onclick: () => {
      const m = mNow();
      if (!m || m.finId === me()) { ui.toast('Nada a cobrir', { type: 'info' }); return; }
      num.value = r2(m.taxaAm - passo()); sli.value = num.value; field.setError(''); recalc(num.value);
      attemptBid(op, num.value, field, wrap, drawHead, recalc);
    } });
    const autoBox = h('div.small.muted', 'Oferta firme por 3h após o registro. ', ui.link('Lance automático até um piso', '/financiador/politica'));
    wrap.append(bestLine, minLine, field, sli, calcEl,
      h('div.row', btnDar, btnCobrir),
      autoBox, fechado);
    wrap._lock = () => {
      num.input.disabled = true; btnDar.disabled = true; btnCobrir.disabled = true;
      field.setError(''); fechado.hidden = false;
      C.mount(fechado, ui.callout({ tone: 'warn', title: 'Leilão encerrado', text: 'Esta operação não aceita mais ofertas. Veja o desfecho abaixo.' }));
    };
    const card = ui.card({ title: 'Dar lance', subtitle: 'leilão reverso, firme por 3h' }, wrap);
    card._setTaxa = (v) => { const c = r2(Math.min(maxT, Math.max(minT, v))); num.value = c; sli.value = c; field.setError(''); recalc(c); };
    return card;
  }

  function attemptBid(op, taxa, field, wrap, drawHead, recalc) {
    if (taxa == null || !(taxa > 0)) { field.setError('Informe uma taxa maior que zero.'); shake(wrap); return; }
    const met = E.metricasOp(op, r2(taxa));
    ui.confirm({
      title: `Ofertar ${fmt.taxa(r2(taxa))} em ${op.id}`, icon: 'gavel', confirmLabel: 'Confirmar oferta',
      text: `Oferta firme por ${db.cfg().firmezaHoras}h: só pode ser retirada após esse prazo.`,
      children: ui.kv([['Taxa', fmt.taxa(r2(taxa))], ['Líquido ao cedente', fmt.brl(met.liquido)], ['Seu retorno líquido', `${fmt.brl(met.retornoFinanciador)} (${fmt.pct(met.retornoFinanciadorAm, 2)} a.m.)`]]),
    }).then((okc) => {
      if (!okc) return;
      const r = E.darLance(op.id, me(), r2(taxa), { userId: myUserId() });
      if (!r.ok) { field.setError(r.erro); shake(wrap); return; }
      field.setError('');
      drawHead();
      const mx = minNext(op);
      if (mx) recalc(mx);
      ui.toast(r.aceiteAutomatico ? 'Oferta aceita na hora' : 'Oferta registrada', { type: 'success', text: r.aceiteAutomatico ? `Teto do cedente atingido com ${fmt.taxa(r2(taxa))}.` : `Você lidera ${op.id} com ${fmt.taxa(r2(taxa))}.` });
    });
  }

  function shake(el) { el.classList.remove('fin-shake'); void el.offsetWidth; el.classList.add('fin-shake'); }

  function rankingVivo(op) {
    return ui.live(['lances', 'operacoes'], () => {
      const o = db.get('operacoes', op.id) || op;
      const map = anonMap(o.id);
      const ls = E.lancesDaOp(o.id).filter((l) => ['ativo', 'superado'].includes(l.status)).sort((a, b) => a.taxaAm - b.taxaAm || a.criadoEm - b.criadoEm);
      if (!ls.length) return ui.card({ title: 'Ofertas ao vivo' }, ui.empty({ icon: 'gavel', title: 'Sem ofertas ainda', text: 'O mercado simulado envia ofertas a cada poucos segundos. A sua pode ser a primeira.' }));
      const rows = ls.map((l, i) => {
        const mine = l.finId === me();
        const firme = l.firmeAte > now();
        if (mine && !C.can('lance')) return h('div', { class: ['fin-rank', 'is-me'] },
          h('div.grow', h('div.row', h('strong.num', fmt.taxa(l.taxaAm)), i === 0 ? ui.badge('Líder', 'green') : ui.badge('Superada', 'amber')),
            h('div.small.muted', `${anonLabel(o, l.finId, map)} · líquido ${fmt.brl(l.liquido)} · CET ${fmt.taxa(l.cetAm)}`)),
          ui.btn('Retirar', Object.assign({ size: 'sm' }, dis('lance'))));
        const retirar = mine ? (firme
          ? ui.btn('Retirar', Object.assign({ size: 'sm' }, { disabled: true, title: `Oferta firme até ${fmt.time(l.firmeAte)} (faltam ${fmt.dur(l.firmeAte - now())}). Só pode ser retirada após esse prazo.` }))
          : ui.btn('Retirar', { size: 'sm', variant: 'ghost', onclick: () => {
            ui.confirm({ title: `Retirar oferta de ${fmt.taxa(l.taxaAm)}?`, text: 'A melhor oferta seguinte assume a liderança.', confirmLabel: 'Retirar' }).then((okc) => {
              if (!okc) return;
              const r = E.retirarLance(l.id, myUserId());
              if (r.ok) ui.toast('Oferta retirada', { type: 'success' }); else ui.toast('Não foi possível retirar', { type: 'error', text: r.erro });
            });
          } })) : null;
        return h('div', { class: ['fin-rank', mine && 'is-me'] },
          h('div.grow', h('div.row', h('strong.num', fmt.taxa(l.taxaAm)), i === 0 ? ui.badge('Líder', 'green') : ui.badge('Superada', 'amber')),
            h('div.small.muted', `${anonLabel(o, l.finId, map)} · líquido ${fmt.brl(l.liquido)} · CET ${fmt.taxa(l.cetAm)}`, l.auto ? h('span', ' · ', ui.ai('automático')) : '')),
          mine ? ui.countdown(l.firmeAte, { prefix: 'firme por', endLabel: 'firmeza encerrada' }) : null,
          retirar);
      });
      const serie = ls.length > 1 ? [{ name: 'Taxa', tone: 'blue', data: E.lancesDaOp(o.id).slice().sort((a, b) => a.criadoEm - b.criadoEm).map((l) => ({ x: fmt.time(l.criadoEm), y: l.taxaAm })) }] : null;
      return h('div.stack',
        ui.card({ title: `Ofertas ao vivo (${ls.length})`, subtitle: o.canal === 'vitrine' ? 'Concorrentes anonimizados até o aceite' : 'Balcão bilateral' }, h('div.stack.tight', rows)),
        serie ? ui.card({ title: 'Taxa ao longo do leilão' }, ui.chart.line({ series: serie, height: 190, format: (v) => fmt.taxa(v), tipFormat: (v) => fmt.taxa(v) })) : null);
    });
  }

  function parecerCard(op, parecer, onUsar) {
    const p = parecer;
    const scoreTone = p.score >= 70 ? 'green' : p.score >= 45 ? 'amber' : 'red';
    return ui.card({ class: 'card-ai', title: 'Parecer do Agente de Crédito', actions: ui.ai('IA'), subtitle: `Confiança ${fmt.pct(p.confianca * 100, 0)}. Só aconselha: quem dá o lance é o motor ou você.` },
      h('div.stack.tight',
        h('div.fin-score', h('div.fin-score-n.num', h('strong', p.score), h('small', '/100')), h('div.grow', h('div.fin-meter', { role: 'progressbar', 'aria-valuenow': p.score, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Pontuação de crédito' }, h('i', { class: 'tone-' + scoreTone, style: `width:${p.score}%` })))),
        ui.kv([['Taxa sugerida', h('strong', fmt.taxa(p.taxaSugerida))], ['Para liderar agora', p.cobreMelhor ? h('strong', fmt.taxa(p.cobreMelhor)) : 'Sem ofertas concorrentes'], ['Pior rating dos sacados', p.pior]]),
        ui.btn('Usar taxa sugerida', { variant: 'ai', size: 'sm', icon: 'sparkles', block: true, onclick: onUsar }),
        h('div.fin-checks',
          (p.politica.aprovados || []).slice(0, 4).map((a) => h('div.fin-check.ok', icon('circle-check', 14), h('span.small', a))),
          (p.politica.motivos || []).map((m) => h('div.fin-check.no', icon('circle-alert', 14), h('span.small', m)))),
        ui.callout({ tone: 'ai', title: 'A IA nunca opera', text: 'O agente propõe a taxa e confere a política. Lance, aceite e pagamento passam pelo motor, com a sua confirmação.' })));
  }

  function ladoDetalhe(op) {
    const tits = titulos(op);
    const titCard = ui.card({ title: `Títulos (${tits.length})` }, h('div.stack.tight', tits.map((t) => {
      const s = db.get('orgs', t.sacadoId) || {};
      const aceite = t.lastro && t.lastro.aceiteSacado;
      return h('div.fin-tit-row',
        h('div.grow', h('div.strong.mono', t.numero), h('div.small.muted', `${s.fantasia || ''} · venc. ${fmt.date(t.vencimento)}`)),
        h('div', { style: 'text-align:right' }, h('div.num', fmt.brl(t.valor)), ui.status('titulo', t.status),
          aceite && aceite !== 'silencioso' ? h('div.small.muted', aceite === 'aceito' ? 'aceite do sacado' : aceite) : null,
          t.lastro && !t.lastro.comprovante ? h('div.small.muted', 'sem comprovante') : null),
        F.ratingBadge(s.rating || 'D'));
    })));
    const sacCard = ui.live(['operacoes', 'titulos'], () => {
      const o = db.get('operacoes', op.id) || op;
      return ui.card({ title: 'Sacados e exposição' }, h('div.stack.tight', sacOrgs(o).map((s) => {
        const face = titulos(o).filter((t) => t.sacadoId === s.id).reduce((a, t) => a + t.valor, 0);
        const totExp = E.exposicaoFin(me(), { sacadoId: s.id });
        const lim = ((pol().limiteSacado || {})[s.id] !== undefined ? pol().limiteSacado[s.id] : pol().limiteSacadoPadrao);
        const uso = lim ? Math.min(100, (totExp / lim) * 100) : 0;
        return h('div', F.orgCell(s, { size: 'sm' }),
          h('div.small.muted', `nesta operação ${fmt.brl(face)} · total exposto ${fmt.brl(totExp)}${lim ? ` de ${fmt.brl(lim, { round: true })}` : ''}`),
          lim ? ui.progress(uso, { thin: true, tone: uso >= 90 ? 'red' : uso >= 70 ? 'amber' : undefined }) : null);
      })));
    });
    const ced = db.get('orgs', op.cedenteId) || {};
    const opsCed = db.where('operacoes', (x) => x.cedenteId === op.cedenteId);
    const enc = opsCed.filter((x) => ['liquidada', 'recomprada'].includes(x.status));
    const liq = opsCed.filter((x) => x.status === 'liquidada').length;
    const prob = opsCed.filter((x) => ['vencida', 'parcial'].includes(x.status) || x.regressoAcionado).length;
    const cedCard = ui.card({ title: op.canal === 'balcao' ? 'Cedente' : 'Cedente (anonimizado)', subtitle: op.canal === 'balcao' ? ced.fantasia || ced.nome : cedenteAnon(op) },
      ui.kv([
        ['Setor', ced.setor || '—'],
        ['Cidade', `${ced.cidade || ''}${ced.uf ? '/' + ced.uf : ''}`],
        ['Na plataforma desde', ced.ativoDesde ? fmt.month(ced.ativoDesde) : '—'],
        ['Histórico', `${opsCed.length} operações · ${liq} liquidadas${prob ? ` · ${prob} com atraso ou recompra` : ''}`],
        op.canal === 'balcao' ? ['CNPJ', fmt.cnpj(ced.cnpj || '')] : null,
      ]));
    const tlCard = ui.card({ title: 'Linha do tempo' }, ui.live(['ledger'], () => F.timeline('operacao', op.id)));
    return h('div.stack', titCard, sacCard, cedCard, tlCard);
  }

  function desfechoCard(op) {
    if (op.financiadorId === me()) {
      return ui.card({ title: 'Você venceu esta operação', subtitle: `taxa ${op.taxaFinal ? fmt.taxa(op.taxaFinal) : '—'}` },
        ui.callout({ tone: 'success', title: 'Aceite registrado', text: 'A operação saiu do leilão e segue para cessão, pagamento e recebimento.' }),
        h('div.row', ui.btn('Abrir na Carteira', { variant: 'primary', icon: 'briefcase', route: '/financiador/operacoes/' + op.id }), ui.btn('Ver lances', { route: '/financiador/lances' })));
    }
    if (op.status === 'expirada') return ui.card({ title: 'Leilão expirado sem aceite' }, h('p.muted.small', 'Os títulos voltaram para o cedente. Acompanhe a Vitrine para novas oportunidades.'), h('div.row', ui.btn('Voltar à Vitrine', { variant: 'primary', route: '/financiador/vitrine' })));
    if (op.status === 'cancelada') return ui.card({ title: 'Operação cancelada pelo cedente' }, h('p.muted.small', 'Os títulos voltaram para o cedente.'), h('div.row', ui.btn('Voltar à Vitrine', { variant: 'primary', route: '/financiador/vitrine' })));
    return ui.card({ title: 'Fechada com outra oferta', subtitle: op.taxaFinal ? `taxa vencedora ${fmt.taxa(op.taxaFinal)}` : '' },
      h('p.muted.small', 'O cedente aceitou a melhor oferta no momento do aceite. Reveja a sua estratégia ou ative o lance automático na política.'),
      h('div.row', ui.btn('Voltar à Vitrine', { variant: 'primary', route: '/financiador/vitrine' }), ui.btn('Ver política', { route: '/financiador/politica' })));
  }

  function renderDetalhe(ctx) {
    const op0 = db.get('operacoes', ctx.params.id);
    const back = '/financiador/vitrine';
    if (!op0 || (op0.canal === 'vitrine' ? false : op0.financiadorAlvoId !== me())) {
      if (op0 && op0.canal === 'balcao' && op0.financiadorAlvoId !== me()) {
        return h('div.stack', ui.pageHeader({ title: op0.id, back, eyebrow: 'Balcão' }),
          ui.card({ title: 'Operação exclusiva de outro financiador' }, ui.empty({ icon: 'lock', title: 'Balcão bilateral', text: 'Esta operação do Balcão foi endereçada a outro financiador e não está visível para você.', action: ui.btn('Voltar à Vitrine', { variant: 'primary', route: back }) })));
      }
      return h('div.stack', ui.pageHeader({ title: 'Oportunidade', back }),
        ui.empty({ icon: 'search', title: 'Operação não encontrada', text: 'Ela pode ter sido removida ou o identificador está errado.', action: ui.btn('Voltar à Vitrine', { variant: 'primary', route: back }) }));
    }
    const op = op0;
    const head = ui.pageHeader({ back, eyebrow: `${op.canal === 'vitrine' ? 'Vitrine' : 'Balcão'} · ${prodName(op.produto)}`, title: op.id,
      subtitle: `${fmt.brl(op.face)} · ${(op.tituloIds || []).length} títulos · prazo médio ${op.prazoMedio || '—'} dias`,
      actions: [o_regresso(op), ui.status('operacao', op.status)] });
    const linhaTempo = op.status === 'aberta' ? h('div.row.between', ui.countdown(op.validadeAte, { prefix: 'encerra em', endLabel: 'leilão encerrado' }), h('span.small.muted', `publicada ${fmt.rel(op.publicadaEm || op.criadaEm)}`)) : null;

    if (op.status !== 'aberta') {
      return h('div.stack', head, desfechoCard(op),
        h('div', { class: 'detail-grid' }, rankingVivo(op), ladoDetalhe(op)));
    }

    const parecer = E.ia.parecer(op, me());
    const main = h('div.stack');
    const bidCard = painelLance(op, parecer);
    main.append(bidCard, rankingVivo(op));
    // "Usar taxa sugerida" preenche o campo e recalcula; o humano confirma com Dar lance.
    const usarSugerida = () => {
      const v = r2(Math.min(2.50, Math.max(1.20, parecer.taxaSugerida)));
      if (bidCard._setTaxa) bidCard._setTaxa(v);
      ui.toast('Taxa sugerida aplicada', { type: 'info', text: `Confira a simulação e clique em Dar lance para ofertar ${fmt.taxa(v)}.` });
    };
    const lat = h('div.stack', parecerCard(op, parecer, usarSugerida), ladoDetalhe(op));
    if (canLance()) {
      const lock = () => { const o = db.get('operacoes', op.id); const w = bidCard.querySelector('.fin-bid'); if (o && o.status !== 'aberta' && w && w._lock) w._lock(); };
      const off = C.store.on(['operacoes'], lock);
      ctx.onCleanup(off);
    }
    return h('div.stack', head, linhaTempo, h('div', { class: 'detail-grid' }, main, lat));
  }

  /* ============================ /financiador/balcao ============================ */
  function renderBalcao() {
    const mine = meuBalcao();
    const abertas = mine.filter((o) => o.status === 'aberta');
    const hist = mine.filter((o) => o.status !== 'aberta');
    const explica = ui.card({ title: 'Como funciona o Balcão', subtitle: 'bilateral, sem concorrência' },
      h('div.fin-how',
        h('div.fin-how-item', icon('handshake', 18), h('div', h('strong', 'Só para você'), h('div.small.muted', 'O cedente escolheu a sua empresa. Ninguém mais vê nem oferta.'))),
        h('div.fin-how-item', icon('zap', 18), h('div', h('strong', 'Aceite imediato'), h('div.small.muted', 'O cedente pode aceitar a qualquer momento, sem esperar o prazo.'))),
        h('div.fin-how-item', icon('timer', 18), h('div', h('strong', 'Oferta firme por 3h'), h('div.small.muted', 'Depois de ofertar, a taxa vale por 3h. A retirada só libera após esse prazo.')))));
    const fila = ui.live(['operacoes', 'lances'], () => {
      const ab = meuBalcao().filter((o) => o.status === 'aberta');
      if (!ab.length) return ui.empty({ icon: 'handshake', title: 'Nenhuma oferta aguardada', text: 'Quando um cedente endereçar uma operação do Balcão a você, ela aparece aqui com o nome dele.' });
      return h('div.grid.g2', ab.map((o) => {
        const m = E.melhorLance(o.id);
        const ced = db.get('orgs', o.cedenteId) || {};
        return ui.card({ class: 'card-hover fin-card', onclick: () => C.router.go('/financiador/vitrine/' + o.id) },
          h('div.fin-card-top', h('div.row', h('span.mono.strong', o.id), ui.badge(prodName(o.produto), 'blue'), o_regresso(o), m ? (m.finId === me() ? ui.badge('Sua oferta líder', 'green') : ui.badge('Oferta a avaliar', 'amber')) : ui.badge('Aguardando sua oferta', 'amber')),
            ui.countdown(o.validadeAte, { prefix: 'encerra em', endLabel: 'oferta encerrada' })),
          F.orgCell(ced),
          ui.kv([['Valor de face', fmt.brl(o.face)], ['Títulos', (o.tituloIds || []).length], ['Prazo médio', (o.prazoMedio || '—') + (o.prazoMedio ? ' dias' : '')], ['Melhor taxa', m ? fmt.taxa(m.taxaAm) : 'sem ofertas'], o.tetoTaxa ? ['Teto de aceite', `fecha automaticamente até ${fmt.taxa(o.tetoTaxa)}`] : null]),
          h('div.row', ui.btn('Ver e ofertar', { size: 'sm', variant: 'primary', onclick: (e) => { e.stopPropagation(); C.router.go('/financiador/vitrine/' + o.id); } }), policyChip(o)));
      }));
    });
    const histCard = hist.length ? ui.card({ title: `Histórico do Balcão (${hist.length})`, subtitle: 'aceitas e encerradas' },
      ui.table({ rows: hist, dense: true,
        columns: [
          { key: 'id', label: 'Operação', mobile: 'primary', render: (o) => h('a.mono.strong', { href: '#/financiador/vitrine/' + o.id }, o.id) },
          { key: 'ced', label: 'Cedente', render: (o) => h('span.small', finName(o.cedenteId)) },
          { key: 'face', label: 'Face', align: 'right', render: (o) => h('span.num', fmt.brl(o.face, { round: true })) },
          { key: 'taxa', label: 'Taxa', align: 'right', mobile: 'hide', render: (o) => h('span.num', o.taxaFinal ? fmt.taxa(o.taxaFinal) : '—') },
          { key: 'st', label: 'Desfecho', render: (o) => ui.status('operacao', o.status) },
        ] })) : null;
    return h('div.stack',
      ui.pageHeader({ title: 'Balcão', subtitle: `${abertas.length} ${abertas.length === 1 ? 'operação aguarda' : 'operações aguardam'} a sua oferta, com o cedente identificado.`, actions: [ui.btn('Vitrine', { icon: 'store', route: '/financiador/vitrine' })] }),
      explica, fila, histCard);
  }

  /* ============================ /financiador/lances ============================ */
  function grupoLance(l) {
    if (['ativo', 'superado'].includes(l.status)) { const o = db.get('operacoes', l.opId); return o && o.status === 'aberta' ? 'ativos' : 'perdidos'; }
    if (l.status === 'vencedor') return 'ganhos';
    if (l.status === 'retirado') return 'retirados';
    return 'perdidos';
  }

  function renderLances() {
    const st = { aba: 'ativos' };
    const meus = () => db.where('lances', (l) => l.finId === me()).sort((a, b) => b.criadoEm - a.criadoEm);
    const nAtivos = () => meus().filter((l) => grupoLance(l) === 'ativos').length;
    const nGanhos = () => meus().filter((l) => grupoLance(l) === 'ganhos').length;
    const nPerdidos = () => meus().filter((l) => grupoLance(l) === 'perdidos').length;
    const nRet = () => meus().filter((l) => grupoLance(l) === 'retirados').length;
    const tabs = ui.tabs({ value: st.aba, onChange: (v) => { st.aba = v; C.store.emit('fin-lc'); }, items: [
      { id: 'ativos', label: 'Ativos', count: nAtivos() }, { id: 'ganhos', label: 'Ganhos', count: nGanhos() }, { id: 'perdidos', label: 'Perdidos', count: nPerdidos() }, { id: 'retirados', label: 'Retirados', count: nRet() },
    ] });
    const resumo = ui.live(['operacoes', 'lances'], () => {
      const all = meus();
      const d30 = now() - 30 * 86400000;
      const dec30 = all.filter((l) => ['vencedor', 'perdido', 'encerrado'].includes(l.status) && l.criadoEm >= d30);
      const gan30 = dec30.filter((l) => l.status === 'vencedor');
      const ganhos = all.filter((l) => l.status === 'vencedor');
      const taxaMed = ganhos.length ? C.sum(ganhos, (l) => l.taxaAm) / ganhos.length : null;
      const vol = r2(C.sum(ganhos, (l) => (db.get('operacoes', l.opId) || {}).face || 0));
      const porProg = C.groupBy(all.filter((l) => ['vencedor', 'perdido', 'encerrado'].includes(l.status)), (l) => (db.get('operacoes', l.opId) || {}).produto || '?');
      const wr = Object.keys(porProg).map((p) => {
        const g = porProg[p].filter((l) => l.status === 'vencedor').length;
        return { label: prodName(p), value: g, tone: g ? 'teal' : 'neutral', hint: `${g} de ${porProg[p].length} decididos` };
      });
      return h('div.stack',
        h('div.grid.g4',
          ui.kpi({ label: 'Lances ativos', icon: 'gavel', display: String(all.filter((l) => grupoLance(l) === 'ativos').length), hint: 'líder ou superada' }),
          ui.kpi({ label: 'Taxa de vitória (30d)', icon: 'award', display: dec30.length ? fmt.pct((gan30.length / dec30.length) * 100, 0) : '—', hint: dec30.length ? `${gan30.length} de ${dec30.length} decididos` : 'sem decisões no período' }),
          ui.kpi({ label: 'Taxa média ganha', icon: 'percent', display: taxaMed !== null ? fmt.taxa(taxaMed) : '—', hint: 'média das vencedoras' }),
          ui.kpi({ label: 'Volume ganho', icon: 'banknote', display: fmt.brl(vol), hint: fmt.plural(ganhos.length, 'operação vencida', 'operações vencidas') })),
        wr.length ? ui.card({ title: 'Vitórias por programa', subtitle: 'lances decididos' }, ui.chart.hbars(wr, { format: (v) => String(v) })) : null);
    });
    const corpo = ui.live(['operacoes', 'lances', 'fin-lc'], () => {
      const rows = meus().filter((l) => grupoLance(l) === st.aba);
      const tbl = ui.table({
        rows, rowKey: (l) => l.id,
        empty: ui.empty({ icon: 'gavel', title: st.aba === 'ativos' ? 'Nenhum lance ativo' : st.aba === 'ganhos' ? 'Nenhuma vitória ainda' : st.aba === 'retirados' ? 'Nenhuma retirada' : 'Nenhuma derrota registrada', text: st.aba === 'ativos' ? 'Oferte na Vitrine ou no Balcão para disputar operações.' : 'Suas ofertas decididas aparecem aqui.', action: ui.btn('Ver Vitrine', { variant: 'primary', route: '/financiador/vitrine' }) }),
        columns: [
          { key: 'op', label: 'Operação', mobile: 'primary', render: (l) => {
            const o = db.get('operacoes', l.opId);
            const href = o && o.status === 'aberta' ? '#/financiador/vitrine/' + l.opId : (o && o.financiadorId === me() ? '#/financiador/operacoes/' + l.opId : '#/financiador/lances');
            return h('div', h('a.mono.strong', { href }, l.opId), h('div.small.muted', o ? prodName(o.produto) : ''));
          } },
          { key: 'ced', label: 'Cedente', mobile: 'hide', render: (l) => { const o = db.get('operacoes', l.opId) || {}; return h('span.small', l.status === 'vencedor' ? finName(o.cedenteId) : cedenteAnon(o)); } },
          { key: 'taxa', label: 'Sua taxa', align: 'right', render: (l) => h('span.num.strong', fmt.taxa(l.taxaAm)) },
          { key: 'melhor', label: 'Melhor atual', align: 'right', mobile: 'hide', render: (l) => {
            const m = E.melhorLance(l.opId);
            if (!m) return h('span.muted', '—');
            const dif = r2(l.taxaAm - m.taxaAm);
            return h('div', h('div.num', fmt.taxa(m.taxaAm)), h('div.small.muted', dif === 0 ? 'você lidera' : '+' + fmt.taxa(dif).replace(' a.m.', '') + ' acima'));
          } },
          { key: 'pos', label: 'Posição', render: (l) => {
            const o = db.get('operacoes', l.opId);
            if (l.status === 'vencedor') return ui.badge('Vencedor', 'green', { dot: true });
            if (l.status === 'retirado') return ui.badge('Retirado', 'neutral');
            if (['perdido', 'encerrado'].includes(l.status) || (o && o.status !== 'aberta')) return ui.badge('Perdido', 'neutral');
            const m = E.melhorLance(l.opId);
            return m && m.id === l.id ? ui.badge('Líder', 'green', { dot: true }) : ui.badge('Superada', 'amber', { dot: true });
          } },
          { key: 'firme', label: 'Firmeza', mobile: 'hide', render: (l) => (['ativo', 'superado'].includes(l.status) ? ui.countdown(l.firmeAte, { endLabel: 'liberada' }) : h('span.muted', '—')) },
          { key: 'ac', label: '', render: (l) => {
            const o = db.get('operacoes', l.opId);
            const aberta = o && o.status === 'aberta';
            const m = aberta && E.melhorLance(l.opId);
            return h('div.row', { style: 'justify-content:flex-end' },
              aberta && m && m.finId !== me() && canLance() ? ui.btn('Cobrir', { size: 'sm', onclick: () => cobrirFlow(o) }) : null,
              aberta && ['ativo', 'superado'].includes(l.status) && l.firmeAte <= now() && canLance() ? ui.btn('Retirar', { size: 'sm', variant: 'ghost', onclick: () => {
                ui.confirm({ title: `Retirar oferta de ${fmt.taxa(l.taxaAm)}?`, confirmLabel: 'Retirar' }).then((okc) => {
                  if (!okc) return;
                  const r = E.retirarLance(l.id, myUserId());
                  if (r.ok) ui.toast('Oferta retirada', { type: 'success' }); else ui.toast('Não foi possível retirar', { type: 'error', text: r.erro });
                });
              } }) : null,
              aberta ? ui.btn('Ver', { size: 'sm', route: '/financiador/vitrine/' + l.opId }) : null);
          } },
        ],
      });
      const counts = { ativos: meus().filter((l) => grupoLance(l) === 'ativos').length, ganhos: meus().filter((l) => grupoLance(l) === 'ganhos').length, perdidos: meus().filter((l) => grupoLance(l) === 'perdidos').length, retirados: meus().filter((l) => grupoLance(l) === 'retirados').length };
      tabs.querySelectorAll('.tab-count').forEach((el, i) => { el.textContent = [counts.ativos, counts.ganhos, counts.perdidos, counts.retirados][i]; });
      return tbl;
    });
    return h('div.stack',
      ui.pageHeader({ title: 'Meus lances', subtitle: 'Ofertas firmes por 3h, ranking ao vivo e histórico de vitórias.', actions: [ui.btn('Vitrine', { variant: 'primary', icon: 'store', route: '/financiador/vitrine' })] }),
      resumo, tabs, corpo);
  }

  /* --------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/financiador', roles: ['financiador'], title: 'Início', render: renderHome },
    { path: '/financiador/vitrine', roles: ['financiador'], title: 'Vitrine', render: renderVitrine },
    { path: '/financiador/vitrine/:id', roles: ['financiador'], title: 'Oportunidade', render: renderDetalhe },
    { path: '/financiador/balcao', roles: ['financiador'], title: 'Balcão', render: renderBalcao },
    { path: '/financiador/lances', roles: ['financiador'], title: 'Meus lances', render: renderLances },
  ]);
})();
