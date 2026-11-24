/* Cedy ops: Visão geral, Mesa de Operações, Mesa Conciliadora e KYC (Mesa Cedy). */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, ledger, notify, session } = C.store;
  const E = C.engine;
  const F = C.flows;
  const now = () => C.clock.now();
  const meId = () => (session.get() || {}).userId || 'u-ops-1';
  const meName = () => ((session.user() || {}).nome) || 'Mesa Cedy';

  /* ------------------- permissões e camadas (compartilhado com ops2/ops3) ------------------- */
  const Ops = (C.ops = {});
  /** Permissão fina do modelo de papéis (C.OPS_PAPEIS, C.can). Leitores/auditores só têm 'ver'. */
  Ops.can = (perm) => C.can(perm);
  Ops.need = (perm) => { if (C.can(perm)) return true; ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg(perm) }); return false; };
  /** Compatibilidade: líder da Mesa (perfil admin) ou Superadmin. */
  Ops.isAdmin = () => { const u = session.user() || {}; return u.perfil === 'admin' || u.perfil === 'superadmin'; };
  /** Compatibilidade: tem alguma permissão de escrita da Mesa (ou aplica config). */
  Ops.podeOperar = () => ['ops.lote', 'ops.conciliar', 'ops.kyc', 'ops.suspender', 'ops.agentes', 'ops.faturar', 'ops.config.solicitar', 'ops.verComo', 'ops.suporte', 'ops.config.aplicar'].some((p) => C.can(p));
  Ops.needOperar = () => { if (Ops.podeOperar()) return true; ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('ops.lote') }); return false; };
  Ops.needAdmin = () => { if (Ops.isAdmin()) return true; ui.toast('Ação restrita à Mesa admin', { type: 'warn', text: 'Peça ao líder da Mesa ou ao Superadmin para executar esta ação.' }); return false; };
  /** Guarda genérica (leitores/auditores não passam) ou por permissão: Ops.guard('ops.lote', fn). */
  Ops.guard = (permOrFn, fn) => {
    if (typeof permOrFn === 'function') return (...a) => (Ops.needOperar() ? permOrFn(...a) : undefined);
    return (...a) => (Ops.need(permOrFn) ? fn(...a) : undefined);
  };
  /** Props de botão que respeitam permissão: desabilita com o motivo em vez de sumir. */
  Ops.permBtn = (perm) => (C.can(perm) ? {} : { disabled: true, title: C.cannotMsg(perm) });
  Ops.meId = meId;
  /** Gavetas e modais abertos por estas telas fecham ao trocar de rota (o roteador não fecha camadas). */
  const layers = new Set();
  const track = (api) => { layers.add(api); api.promise.then(() => layers.delete(api)); return api; };
  window.addEventListener('hashchange', () => [...layers].forEach((l) => l.close()));
  Ops.modal = (o) => track(ui.modal(o));
  Ops.drawer = (o) => track(ui.drawer(o));

  /* ------------------------------ helpers -------------------------------- */
  const orgOf = (id) => db.get('orgs', id);
  const userOf = (id) => db.get('users', id);
  const over = (ts) => now() > ts;
  const homeOf = (org) => ({ cedente: '/cedente', financiador: '/financiador', originador: '/originador', sacado: '/sacado' }[org && org.kind] || '/');
  const kindBadge = (kind) => ui.badge({ cedente: 'Cedente', financiador: 'Financiador', originador: 'Originador', sacado: 'Sacado' }[kind] || kind, kind === 'cedente' ? 'blue' : kind === 'financiador' ? 'teal' : kind === 'sacado' ? 'amber' : 'neutral');
  const casoCode = (c) => 'CM-' + String(c.id).slice(-5).toUpperCase();
  const nomeCurto = (ag) => String((ag && ag.nome) || 'Agente').replace(/^Agente de /, '');

  /** SLA: contagem regressiva ou selo vermelho quando estourado. */
  function slaView(ts, o = {}) {
    if (!ts) return h('span.muted', 'sem prazo');
    if (over(ts)) return h('span.ops-over', icon('triangle-alert', 14), 'SLA estourado ', h('span.nowrap', fmt.rel(ts)));
    return ui.countdown(ts, { prefix: o.prefix || 'resta', warnMs: o.warnMs || 2 * 3600e3, endLabel: o.endLabel });
  }
  /** Propostas de agentes de uma entidade. A proposta de rateio do seed aponta para o caso aberto. */
  const propFor = (kind, id, onlyPending) => db.where('propostas', (p) => (p.entidade.kind === kind && p.entidade.id === id) || (kind === 'casoMesa' && p.tipo === 'ratear' && p.entidade.id === 'pendente' && (db.get('casosMesa', id) || {}).tipo === 'parcial')).filter((p) => !onlyPending || p.status === 'pendente');
  function agentChip(p) {
    if (!p) return null;
    return h('span.ops-agent', ui.ai(`${Math.round((p.confianca || 0) * 100)}%`), h('small.muted', nomeCurto(db.get('agentes', p.agenteId))));
  }
  const kycOf = (orgId) => db.get('kyc', 'kyc-' + orgId);
  const compNow = () => { const t = C.cal.sp(now()); return `${t.y}-${String(t.m).padStart(2, '0')}`; };
  const monthRange = (comp) => { const [y, m] = comp.split('-').map(Number); return [C.cal.spTs(y, m, 1, 0, 0), C.cal.spTs(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0)]; };
  const tsMes = (comp) => { const [ini, fim] = monthRange(comp); return C.round2(C.sum(db.where('operacoes', (o) => o.pagoEm && o.pagoEm >= ini && o.pagoEm < fim), (o) => o.ts || 0)); };
  const dayStops = (n) => { const out = []; const s = C.cal.startOfDay(now()); for (let i = n - 1; i >= 0; i--) out.push(s - i * 86400000); return out; };
  const within = (ts, a, b) => ts >= a && ts < b;
  const closeProps = (kind, id, status, extra) => db.where('propostas', (p) => p.status === 'pendente' && p.entidade.kind === kind && p.entidade.id === id).forEach((p) => db.patch('propostas', p.id, Object.assign({ status, decididoPor: meName(), decididoEm: now() }, extra)));

  /** Linha da trilha de uma entidade, em cartão (a trilha vazia vira texto curto, não estado vazio de operação). */
  function trilhaCard(kind, id, title) {
    const items = F.timelineItems(kind, id);
    return ui.card({ title: title || 'Trilha', subtitle: 'Eventos registrados, do mais antigo ao mais recente' }, items.length ? ui.timeline(items) : h('p.muted.small', 'Nenhum evento registrado para este item.'));
  }
  const checkRow = (st, label, detail) => h('div.ops-check', h('span', { class: ['ops-check-ic', 'st-' + st] }, icon(st === 'ok' ? 'circle-check' : st === 'warn' ? 'triangle-alert' : 'circle-alert', 16)), h('div.grow', h('div', h('strong', label)), h('div.small.muted', detail)));

  /** Cartão de propostas de agentes ligadas a uma entidade, com atalho para a caixa. */
  function agentPropsCard(kind, id) {
    const list = propFor(kind, id, false).slice().sort((a, b) => b.ts - a.ts);
    if (!list.length) return null;
    return ui.card({ title: 'Propostas de agentes', subtitle: 'A IA propõe, a Mesa decide.', class: 'card-ai', actions: [ui.btn('Abrir caixa', { variant: 'ghost', size: 'sm', icon: 'sparkles', route: '/ops/agentes' })] },
      h('div.stack.tight', list.map((p) => h('div.list-item', ui.ai(`${Math.round((p.confianca || 0) * 100)}%`),
        h('div.grow', h('div', h('strong', p.resumo)), h('div.small.muted', `${nomeCurto(db.get('agentes', p.agenteId))} · ${fmt.rel(p.ts)} · `, ui.status('proposta', p.status)))))));
  }

  /* ============================ 1. /ops ================================== */
  function vOps() {
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy', title: 'Visão geral', subtitle: 'Filas, mercado, alertas e atividade recente. Tudo atualiza ao vivo.', actions: [ui.btn('Painel de demonstração', { variant: 'secondary', icon: 'wand-sparkles', onclick: () => C.shell.openDemo() })] }),
      papelCard(),
      ui.live(['lotes', 'casosMesa', 'kyc', 'propostas', 'operacoes', 'lances', 'extrato', 'ledger', 'orgs'], overviewBody, { class: 'stack' }));
  }

  /** Consciência de papel: Superadmin vê tudo; os demais veem o que podem e o que não podem fazer. */
  function papelCard() {
    const u = session.user() || {};
    if (!u || u.perfil === 'superadmin') return null;
    const papel = C.OPS_PAPEIS[u.papel] || { label: u.papel || 'Sem papel', desc: '', perms: [] };
    const pode = (papel.perms || []).filter((p) => p !== '*').map((p) => C.OPS_PERMS[p] || p);
    const todas = Object.keys(C.OPS_PERMS).filter((p) => ['ops.lote', 'ops.conciliar', 'ops.kyc', 'ops.suspender', 'ops.agentes', 'ops.faturar'].includes(p));
    const naoPode = todas.filter((p) => !(papel.perms || []).includes(p)).map((p) => C.OPS_PERMS[p]);
    return ui.card({ title: 'Seu papel: ' + papel.label + (u.perfil === 'admin' ? ' (líder)' : ''), subtitle: papel.desc || undefined },
      h('div.stack.tight',
        pode.length ? h('div', h('div.small.strong', 'Você pode'), h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, pode.map((l) => ui.badge(l, 'green', { dot: true })))) : null,
        naoPode.length ? h('div', h('div.small.strong', 'Fora do seu papel'), h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, naoPode.map((l) => ui.badge(l, 'neutral')))) : null,
        h('small.muted', 'As ações fora do seu papel aparecem desabilitadas com o motivo. Alterações críticas vão ao Superadmin em Minhas solicitações.')));
  }

  function overviewBody() {
    const lotes = db.where('lotes', (l) => l.status === 'validando').sort((a, b) => a.slaAte - b.slaAte);
    const casos = db.where('casosMesa', (c) => c.status === 'aberto').sort((a, b) => a.slaAte - b.slaAte);
    const kycs = db.where('kyc', (k) => ['em_analise', 'pendencia'].includes(k.status)).sort((a, b) => a.atualizadoEm - b.atualizadoEm);
    const props = db.where('propostas', (p) => p.status === 'pendente').sort((a, b) => a.ts - b.ts);
    const leilao = db.where('operacoes', (o) => o.status === 'aberta');
    const volLeilao = C.round2(C.sum(leilao, (o) => o.face));
    return [
      h('div.ops-kpis',
        ui.kpi({ icon: 'list-checks', tone: 'amber', label: 'Lotes em validação', display: fmt.num(lotes.length), hint: lotes.length ? 'na Mesa de Operações' : 'fila zerada', onclick: () => C.router.go('/ops/mesa') }),
        ui.kpi({ icon: 'git-compare', tone: 'amber', label: 'Casos na Conciliadora', display: fmt.num(casos.length), hint: casos.length ? 'aguardando a Mesa' : 'fila zerada', onclick: () => C.router.go('/ops/conciliacao') }),
        ui.kpi({ icon: 'scan-line', tone: 'blue', label: 'Cadastros na fila', display: fmt.num(kycs.length), hint: kycs.length ? 'KYC em análise ou pendência' : 'fila zerada', onclick: () => C.router.go('/ops/kyc') }),
        ui.kpi({ icon: 'sparkles', tone: 'violet', label: 'Propostas de agentes', display: fmt.num(props.length), hint: 'aguardando decisão humana', onclick: () => C.router.go('/ops/agentes') }),
        ui.kpi({ icon: 'gavel', tone: 'teal', label: 'Volume em leilão agora', display: fmt.brlCompact(volLeilao), hint: fmt.plural(leilao.length, 'operação aberta', 'operações abertas') }),
        ui.kpi({ icon: 'badge-dollar-sign', tone: 'green', label: `TS apurada em ${fmt.month(now())}`, display: fmt.brl(tsMes(compNow())), hint: 'competência corrente', onclick: () => C.router.go('/ops/faturamento') })),
      h('div.grid.g-2-1',
        h('div.stack', filasCard(lotes, casos, kycs, props), alertasCard()),
        h('div.stack', ui.card({ title: 'Saúde do mercado', subtitle: 'Últimos 30 dias' }, mercadoBody()), ui.card({ title: 'Atividade recente', subtitle: 'Últimos eventos da trilha de decisões', actions: [ui.btn('Trilha', { variant: 'ghost', size: 'sm', icon: 'scroll-text', route: '/ops/trilha' })] }, atividadeBody())))];
  }

  function filasCard(lotes, casos, kycs, props) {
    const row = (iconN, label, items, oldest, link, slaOf) => {
      const okN = items.filter((x) => !over(slaOf(x))).length;
      const pct = items.length ? Math.round((okN / items.length) * 100) : 100;
      return h('div.ops-queue',
        h('span.ops-queue-ic', icon(iconN, 17)),
        h('div.grow.stack.tight', { style: { gap: '6px' } },
          h('div.row.between', h('strong', label, ' ', ui.badge(fmt.num(items.length), items.length ? 'blue' : 'neutral')), h('span.small.muted.nowrap', `${pct}% no SLA`)),
          ui.progress(pct, { tone: pct < 100 ? (pct < 70 ? 'red' : 'amber') : 'green', thin: true }),
          oldest ? h('div.small', h('span.muted', 'Mais antigo: '), h('strong', oldest), ' · ', slaView(slaOf(items[0]))) : h('div.small.muted', 'Fila zerada')),
        ui.btn('Abrir', { variant: 'ghost', size: 'sm', route: link }));
    };
    return ui.card({ title: 'Filas e SLAs', subtitle: 'Dias úteis, 8h às 18h. Lotes: meta de 6h (24h na primeira operação). Casos: 24h (48h em empate).' },
      h('div.ops-queues',
        row('list-checks', 'Lotes em validação', lotes, lotes.length ? lotes[0].id : null, '/ops/mesa', (l) => l.slaAte),
        row('git-compare', 'Casos da Conciliadora', casos, casos.length ? casoCode(casos[0]) : null, '/ops/conciliacao', (c) => c.slaAte),
        row('scan-line', 'Cadastros (KYC)', kycs, kycs.length ? (orgOf(kycs[0].orgId) || {}).fantasia : null, '/ops/kyc', (k) => k.atualizadoEm + 48 * 3600e3),
        row('sparkles', 'Propostas de agentes', props, props.length ? String(props[0].tipo).replace(/_/g, ' ') : null, '/ops/agentes', (p) => p.ts + 24 * 3600e3)));
  }

  function mercadoBody() {
    const days = dayStops(30);
    const vol = days.map((d) => ({ x: fmt.dateShort(d), y: C.round2(C.sum(db.where('operacoes', (o) => within(o.criadaEm, d, d + 86400000)), (o) => o.face)) }));
    const aceitas = db.where('operacoes', (o) => o.aceitaEm);
    const medGeral = aceitas.length ? C.round2(C.sum(aceitas, (o) => o.taxaFinal) / aceitas.length) : 0;
    const taxa = days.map((d) => { const ops = aceitas.filter((o) => within(o.aceitaEm, d, d + 86400000)); return { x: fmt.dateShort(d), y: ops.length ? C.round2(C.sum(ops, (o) => o.taxaFinal) / ops.length) : medGeral }; });
    const lances24 = db.where('lances', (l) => l.criadoEm > now() - 86400000).length;
    const ativos = db.where('lances', (l) => l.status === 'ativo').length;
    const tta = aceitas.length ? C.round2(C.sum(aceitas, (o) => o.aceitaEm - o.publicadaEm) / aceitas.length) : 0;
    return h('div.stack.tight',
      h('div', h('div.small.strong', 'Volume publicado por dia'), ui.chart.line({ series: [{ name: 'Volume', tone: 'blue', data: vol }], height: 170, format: (v) => fmt.brlCompact(v), tipFormat: (v) => fmt.brl(v), aria: 'Volume publicado por dia nos últimos 30 dias' })),
      h('div', h('div.small.strong', 'Taxa média de aceite por dia'), ui.chart.line({ series: [{ name: 'Taxa média', tone: 'teal', data: taxa }], height: 140, format: (v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`, tipFormat: (v) => fmt.taxa(v), area: false, aria: 'Taxa média de aceite por dia' })),
      h('div.row', ui.badge(`Lances ativos: ${ativos}`, 'teal', { icon: 'gavel' }), ui.badge(`Lances por hora: ${(lances24 / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`, 'blue', { icon: 'activity' }), ui.badge(`Tempo médio até o aceite: ${tta ? fmt.dur(tta) : 'sem dados'}`, 'neutral', { icon: 'timer' })));
  }

  function alertasCard() {
    const items = [];
    db.where('operacoes', (o) => o.status === 'aguardando_pagamento' && now() > o.pagamentoLimite).forEach((o) => items.push({ tone: 'error', icon: 'triangle-alert', title: `Pagamento em atraso: ${o.id}`, text: `${fmt.brl(o.liquido)} de ${(orgOf(o.financiadorId) || {}).fantasia}, o limite era ${fmt.datetime(o.pagamentoLimite)}.`, link: '/ops/empresas/' + o.financiadorId }));
    db.where('operacoes', (o) => o.status === 'vencida').forEach((o) => items.push({ tone: 'error', icon: 'hourglass', title: `Operação vencida: ${o.id}`, text: `${fmt.brl(E.saldoAberto(o))} em aberto, ${(orgOf(o.cedenteId) || {}).fantasia}. ${o.regresso ? 'Com regresso.' : 'Sem regresso.'}`, link: '/ops/empresas/' + o.cedenteId + '?op=' + o.id }));
    db.where('orgs', (o) => o.kind === 'sacado' && o.restricao).forEach((s) => items.push({ tone: 'warn', icon: 'shield', title: `Sacado com restrição: ${s.fantasia}`, text: s.restricao, link: '/ops/empresas/' + s.id }));
    db.where('casosMesa', (c) => c.status === 'aberto' && ['sem_fonte', 'valor'].includes(c.tipo) && now() - c.abertoEm > 12 * 3600e3).forEach((c) => items.push({ tone: 'warn', icon: 'circle-question-mark', title: `Crédito sem fonte há mais de 12h: ${fmt.brl(c.valor)}`, text: c.motivo, link: '/ops/conciliacao/' + c.id }));
    db.where('orgs', (o) => o.status === 'suspenso').forEach((o) => items.push({ tone: 'warn', icon: 'ban', title: `Cadastro suspenso: ${o.fantasia || o.nome}`, text: o.motivoSuspensao || 'Suspenso pela Mesa.', link: '/ops/empresas/' + o.id }));
    const np = db.where('propostas', (p) => p.status === 'pendente').length;
    if (np) items.push({ tone: 'ai', icon: 'sparkles', title: fmt.plural(np, 'proposta de agente aguardando', 'propostas de agentes aguardando'), text: 'Nenhum agente executa sozinho em R2 ou R3: a decisão é humana.', link: '/ops/agentes' });
    const ver = ledger.verify();
    items.push(ver.ok ? { tone: 'success', icon: 'lock', title: `Trilha íntegra: ${fmt.num(ver.count)} eventos verificados`, text: 'Cadeia de hashes conferida agora.', link: '/ops/trilha' } : { tone: 'error', icon: 'siren', title: `Falha de integridade na trilha (evento ${ver.id})`, text: 'Investigar antes de qualquer decisão financeira.', link: '/ops/trilha' });
    const atencao = items.filter((a) => a.tone !== 'success').length;
    return ui.card({ title: 'Alertas', subtitle: atencao ? `${fmt.plural(atencao, 'item pede atenção', 'itens pedem atenção')}` : 'Nada pedindo atenção agora', actions: atencao ? [ui.badge(fmt.num(atencao), 'red')] : null },
      h('ul.ops-alerts', items.map((a) => h('li', { class: ['ops-alert', 'tone-' + a.tone] }, icon(a.icon, 17), h('div.grow', h('div', h('strong', a.title)), h('div.small.muted', a.text)), a.link ? ui.btn('Ver', { variant: 'ghost', size: 'sm', route: a.link }) : null))));
  }

  function atividadeBody() {
    const evs = ledger.all().slice(-8).reverse();
    if (!evs.length) return ui.empty({ icon: 'history', title: 'Sem eventos ainda' });
    return ui.timeline(evs.map((e) => ({ icon: F.actorIcon(e.actor), tone: F.actorTone(e.actor), title: e.resumo, ts: e.ts, actor: e.actor.nome })));
  }

  /* ========================= 2. /ops/mesa ================================= */
  const decididosHoje = () => { const d = C.cal.startOfDay(now()); return db.where('lotes', (l) => l.status === 'aprovado' && l.decididoEm && l.decididoEm >= d); };

  function vMesa(ctx) {
    const state = { tab: ctx.query.aba || 'validando' };
    const box = h('div');
    const draw = () => C.mount(box, mesaTable(state.tab));
    ctx.onCleanup(db.on(['lotes', 'titulos', 'propostas'], () => { if (box.isConnected) draw(); }));
    draw();
    const tabs = ui.tabs({ value: state.tab, onChange: (v) => { state.tab = v; draw(); }, items: [
      { id: 'validando', label: 'Em validação', count: db.where('lotes', (l) => l.status === 'validando').length },
      { id: 'decididos', label: 'Decididos hoje', count: decididosHoje().length },
      { id: 'recusados', label: 'Recusados', count: db.where('lotes', (l) => l.status === 'recusado').length }] });
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa de Operações', title: 'Validação de lotes', subtitle: 'Fila ordenada pelo SLA, em dias úteis das 8h às 18h. Meta de 6h (24h na primeira operação).', back: '/ops' }),
      tabs, box);
  }

  function loteFlags(lote) {
    const ts = lote.titulos.map((id) => db.get('titulos', id)).filter(Boolean);
    return { erros: C.sum(ts, (t) => (t.flags || []).filter((f) => f.nivel === 'erro').length), avisos: C.sum(ts, (t) => (t.flags || []).filter((f) => f.nivel === 'aviso').length), n: ts.length };
  }

  function mesaTable(tab) {
    let rows;
    if (tab === 'validando') rows = db.where('lotes', (l) => l.status === 'validando').sort((a, b) => a.slaAte - b.slaAte);
    else if (tab === 'decididos') rows = decididosHoje().sort((a, b) => b.decididoEm - a.decididoEm);
    else rows = db.where('lotes', (l) => l.status === 'recusado').sort((a, b) => (b.decididoEm || 0) - (a.decididoEm || 0));
    return ui.table({
      rows, rowKey: (l) => l.id, onRowClick: (l) => C.router.go('/ops/mesa/' + l.id),
      empty: ui.empty({ icon: tab === 'validando' ? 'circle-check' : 'inbox', title: tab === 'validando' ? 'Fila zerada' : 'Nada por aqui', text: tab === 'validando' ? 'Nenhum lote aguardando validação.' : 'Nenhum lote nesta aba.', action: tab === 'validando' ? ui.btn('Ver visão geral', { route: '/ops' }) : null }),
      columns: [
        { key: 'id', label: 'Lote', mobile: 'primary', render: (l) => h('div.cell-main', h('strong.mono', l.id, l.primeiraOperacao ? ' ' : null, l.primeiraOperacao ? ui.badge('1ª operação', 'blue', { title: 'Meta de 24h' }) : null), h('small', `${fmt.date(l.criadoEm)} · ${l.origem === 'xml' ? 'XML' : l.origem}`)) },
        { key: 'ced', label: 'Cedente', mobile: 'show', render: (l) => F.orgCell(orgOf(l.cedenteId)) },
        { key: 'tit', label: 'Títulos', render: (l) => { const f = loteFlags(l); return h('div.row.nowrap', h('span.num.nowrap', fmt.plural(f.n, 'título', 'títulos')), f.erros ? ui.badge(fmt.plural(f.erros, 'erro', 'erros'), 'red') : null, f.avisos ? ui.badge(fmt.plural(f.avisos, 'aviso', 'avisos'), 'amber') : null); } },
        { key: 'valor', label: 'Valor', align: 'right', sort: (a, b) => a.total - b.total, render: (l) => h('span.num', fmt.brl(l.total)) },
        { key: 'agente', label: 'Agente', mobile: 'hide', render: (l) => agentChip(propFor('lote', l.id, true)[0]) || h('small.muted', 'sem proposta') },
        { key: 'sla', label: 'Prazo', sort: (a, b) => a.slaAte - b.slaAte, render: (l) => h('span.nowrap', l.status === 'validando' ? slaView(l.slaAte) : h('small.muted', l.status === 'aprovado' ? `aprovado ${fmt.rel(l.decididoEm)}` : `recusado ${fmt.rel(l.decididoEm || l.criadoEm)}`)) },
      ],
    });
  }

  /* ======================== 3. /ops/mesa/:id =============================== */
  const FLAG_LABEL = { AGUARDA_SACADO: 'Aguarda sacado', CHAVE: 'Chave inválida', CONTESTADO: 'Contestado', DUPLICADO: 'Duplicado', EMISSAO_FUTURA: 'Emissão futura', EMITENTE: 'Emitente', LASTRO_COMPROVANTE: 'Sem comprovante', LASTRO_XML: 'Sem XML', PRAZO_MAX: 'Prazo máximo', PRAZO_MIN: 'Prazo mínimo', SACADO_NOVO: 'Sacado novo', SACADO_RESTRICAO: 'Restrição', TICKET: 'Ticket', VENCIDO: 'Vencido' };
  const MOTIVOS_EXCLUSAO = [{ value: 'Ticket abaixo do mínimo do programa', label: 'Ticket mínimo' }, { value: 'Sacado com restrição cadastral', label: 'Sacado com restrição' }, { value: 'Lastro incompleto', label: 'Lastro incompleto' }, { value: 'Duplicidade de NF-e', label: 'Duplicidade' }];

  function vLote(ctx) {
    const lote = db.get('lotes', ctx.params.id);
    if (!lote) return h('div.stack.ops-page', ui.pageHeader({ title: 'Lote não encontrado', back: '/ops/mesa' }), ui.empty({ icon: 'search', title: 'Este lote não existe', action: ui.btn('Voltar para a fila', { route: '/ops/mesa' }) }));
    const ced = orgOf(lote.cedenteId);
    const imp = userOf(lote.userId);
    const decided = lote.status !== 'validando';
    const titulos = lote.titulos.map((id) => db.get('titulos', id)).filter(Boolean);
    const validos = titulos.filter((t) => t.status === 'validando');
    const excl = new Map();
    const sumBox = h('div');
    let btnParcial = null;
    const drawSum = () => {
      const mantidos = validos.filter((t) => !excl.has(t.id));
      C.mount(sumBox, h('div.ops-sum',
        h('span', h('strong.num', mantidos.length), h('span.muted', ` de ${validos.length} títulos mantidos`)),
        h('span', h('strong.num.nowrap', fmt.brl(C.round2(C.sum(mantidos, (t) => t.valor)))), h('span.muted', ' liberados se aprovar')),
        excl.size ? ui.badge(fmt.plural(excl.size, 'excluído', 'excluídos'), 'amber') : null));
      if (btnParcial) { const semPerm = !C.can('ops.lote'); btnParcial.disabled = semPerm || !excl.size; if (semPerm) btnParcial.title = C.cannotMsg('ops.lote'); const lab = btnParcial.querySelector('.btn-label'); if (lab) lab.textContent = excl.size ? `Aprovar parcialmente (${excl.size} excluído${excl.size > 1 ? 's' : ''})` : 'Aprovar parcialmente'; }
    };
    drawSum();

    const head = ui.pageHeader({ eyebrow: 'Mesa de Operações', back: '/ops/mesa', title: 'Lote ' + lote.id,
      subtitle: `${ced ? ced.fantasia || ced.nome : 'Cedente'} · importado por ${imp ? imp.nome : 'origem externa'} em ${fmt.datetime(lote.criadoEm)}`,
      actions: [ui.status('lote', lote.status), lote.primeiraOperacao ? ui.badge('1ª operação: meta de 24h', 'blue') : null, !decided ? slaView(lote.slaAte) : null] });

    if (decided) return h('div.stack.ops-page', head, loteOutcome(lote), h('div.grid.g-main-side', h('div.stack', ui.card({ title: 'Títulos do lote' }, titulosResumo(titulos)), trilhaCard('lote', lote.id, 'Trilha do lote')), h('div.stack', cedenteCtxCard(ced), agentPropsCard('lote', lote.id))));

    const hourOk = (() => { const t = C.cal.sp(now()); return C.cal.isUtil(now()) && t.h >= 8 && t.h < 18; })();
    return h('div.stack.ops-page', head,
      !hourOk ? ui.callout({ tone: 'info', icon: 'clock', title: 'Fora da janela de validação', text: 'O SLA corre em horas úteis (dias úteis, 8h às 18h). A decisão continua liberada, e a Mesa simulada aprova lotes sem erro ao fim do SLA.' }) : null,
      h('div.grid.g-main-side',
        h('div.stack',
          ui.card({ title: 'Títulos do lote', subtitle: 'Desmarque um título para excluí-lo da aprovação (aprovação parcial). Títulos recusados pelas regras não entram.', actions: [ui.badge(`${validos.length} aptos`, 'green')] }, titulosTable(titulos, excl, drawSum), h('div.sp-3'), sumBox),
          checksCard(titulos),
          agentPropsCard('lote', lote.id),
          trilhaCard('lote', lote.id, 'Trilha do lote')),
        h('div.stack',
          cedenteCtxCard(ced),
          ui.card({ title: 'Decisão da Mesa', subtitle: 'A proposta do agente não aprova nada sozinha.' },
            h('div.stack.tight',
              ui.btn('Aprovar lote', Object.assign({ variant: 'primary', icon: 'badge-check', block: true, onclick: Ops.guard('ops.lote', () => decidirLote(lote, 'aprovar', null, validos)) }, Ops.permBtn('ops.lote'))),
              (btnParcial = ui.btn('Aprovar parcialmente', Object.assign({ icon: 'list-checks', block: true, disabled: true, title: 'Desmarque títulos para habilitar', onclick: Ops.guard('ops.lote', () => decidirLote(lote, 'parcial', excl, validos)) }, Ops.permBtn('ops.lote')))),
              ui.btn('Recusar lote', Object.assign({ class: 'ops-btn-danger', icon: 'file-x', block: true, onclick: Ops.guard('ops.lote', () => recusarLote(lote)) }, Ops.permBtn('ops.lote'))),
              ui.btn('Pedir mais informação', Object.assign({ variant: 'ghost', icon: 'message-circle', block: true, onclick: Ops.guard('ops.lote', () => pedirInfoLote(lote)) }, Ops.permBtn('ops.lote'))))))));
  }

  function decidirLote(lote, modo, excl, validos) {
    const mantidos = validos.filter((t) => !(excl && excl.has(t.id)));
    if (!mantidos.length) { ui.toast('Nada para aprovar', { type: 'warn', text: 'Todos os títulos foram excluídos: recuse o lote com um motivo.' }); return; }
    const nomes = mantidos.slice(0, 3).map((t) => t.numero).join(', ') + (mantidos.length > 3 ? ` e mais ${mantidos.length - 3}` : '');
    ui.confirm({ title: modo === 'parcial' ? 'Aprovar parcialmente?' : 'Aprovar lote?', tone: 'primary', confirmLabel: 'Aprovar',
      text: `${fmt.plural(mantidos.length, 'título fica disponível', 'títulos ficam disponíveis')} (${fmt.brl(C.round2(C.sum(mantidos, (t) => t.valor)))}): ${nomes}.${excl && excl.size ? ` ${fmt.plural(excl.size, 'título será recusado', 'títulos serão recusados')}.` : ''} O cedente é avisado na hora.`,
    }).then((v) => {
      if (!v) return;
      if (modo === 'parcial') excl.forEach((motivo, id) => db.patch('titulos', id, { status: 'recusado', motivoRecusa: motivo || 'Excluído pela Mesa na aprovação parcial' }));
      const r = E.decidirLote(lote.id, 'aprovar', { userId: meId() });
      if (!r.ok) { ui.toast('Não foi possível decidir', { type: 'error', text: r.erro }); return; }
      ui.toast(modo === 'parcial' ? 'Lote aprovado parcialmente' : 'Lote aprovado', { type: 'success', text: `${fmt.plural(mantidos.length, 'título liberado', 'títulos liberados')} para antecipação.` });
      C.router.go('/ops/mesa/' + lote.id);
    });
  }

  function recusarLote(lote) {
    let motivo = 'Ticket abaixo do mínimo do programa'; let extra = '';
    const sel = ui.select({ value: motivo, aria: 'Motivo da recusa', onChange: (v) => (motivo = v), options: [{ value: 'Ticket abaixo do mínimo do programa', label: 'Ticket abaixo do mínimo' }, { value: 'Sacado com restrição cadastral', label: 'Sacado com restrição' }, { value: 'Lastro incompleto', label: 'Lastro incompleto' }, { value: 'Duplicidade de NF-e', label: 'Duplicidade de NF-e' }, { value: 'Outro motivo (descrito na trilha)', label: 'Outro motivo' }] });
    const txt = ui.input({ type: 'textarea', placeholder: 'Detalhe que vai para a trilha e para o cedente', onInput: (v) => (extra = v) });
    Ops.modal({ title: 'Recusar lote ' + lote.id, icon: 'file-x', tone: 'red', size: 'sm', body: h('div.stack.tight', ui.field({ label: 'Motivo' }, sel), ui.field({ label: 'Detalhe', optional: true }, txt)),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Recusar lote', { variant: 'danger', onclick: () => {
        const r = E.decidirLote(lote.id, 'recusar', { userId: meId(), motivo: extra.trim() ? `${motivo}: ${extra.trim()}` : motivo });
        if (!r.ok) { ui.toast('Não foi possível recusar', { type: 'error', text: r.erro }); return; }
        ui.toast('Lote recusado', { type: 'success', text: 'O cedente foi avisado com o motivo.' }); api.close(); C.router.go('/ops/mesa/' + lote.id);
      } })] });
  }

  function pedirInfoLote(lote) {
    let msg = '';
    const wrap = ui.field({ label: 'O que falta', required: true }, ui.input({ type: 'textarea', placeholder: 'Ex.: anexar comprovante de entrega das NF 48412 e 48413', onInput: (v) => (msg = v) }));
    Ops.modal({ title: 'Pedir informação ao cedente', icon: 'message-circle', size: 'sm', body: h('div.stack.tight', ui.callout({ tone: 'info', text: 'O lote continua em validação e o SLA segue correndo. O cedente recebe uma notificação.' }), wrap),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Enviar pedido', { variant: 'primary', onclick: () => {
        if (!msg.trim()) { wrap.setError('Descreva o que o cedente precisa enviar.'); return; }
        ledger.append({ actor: E.actors.user(meId()), acao: 'lote.info_pedida', entidade: { kind: 'lote', id: lote.id }, resumo: `Mesa pediu informação sobre ${lote.id}: ${msg.trim()}`, classe: 'R1' });
        notify.send({ to: { orgId: lote.cedenteId }, tipo: 'alerta', titulo: `Mesa pediu informação: ${lote.id}`, corpo: msg.trim(), link: '/cedente/titulos' });
        ui.toast('Pedido enviado ao cedente', { type: 'success' }); api.close();
      } })] });
  }

  function loteOutcome(lote) {
    const next = db.where('lotes', (l) => l.status === 'validando' && l.id !== lote.id).sort((a, b) => a.slaAte - b.slaAte)[0];
    const aprovado = lote.status === 'aprovado';
    return ui.callout({ tone: aprovado ? 'success' : 'error', icon: aprovado ? 'badge-check' : 'file-x',
      title: `${aprovado ? 'Lote aprovado' : 'Lote recusado'} por ${String(lote.decididoPor || 'Mesa').split(' · ')[0]}`,
      text: `${aprovado ? 'Títulos liberados no app do cedente.' : `Motivo: ${lote.motivo || 'não informado'}.`} Decidido ${fmt.rel(lote.decididoEm || lote.criadoEm)}.`,
      actions: [next ? ui.btn(`Próximo da fila: ${next.id}`, { variant: 'primary', size: 'sm', icon: 'arrow-right', route: '/ops/mesa/' + next.id }) : null, ui.btn('Voltar para a fila', { size: 'sm', route: '/ops/mesa' })] });
  }

  const sacadoCell = (t) => { const s = orgOf(t.sacadoId); return h('div.cell-main', h('strong', s ? s.fantasia : 'Não cadastrado'), h('div.row.nowrap', { style: { gap: '4px' } }, s ? F.ratingBadge(s.rating || 'D') : null, s && s.restricao ? ui.badge('Restrição', 'red', { title: s.restricao }) : null)); };

  /** Tabela do lote já decidido: só leitura. */
  function titulosResumo(titulos) {
    return ui.table({ rows: titulos, rowKey: (t) => t.id,
      columns: [
        { key: 'numero', label: 'Título', mobile: 'primary', render: (t) => h('div.cell-main', h('strong.mono', t.numero), h('small', `${t.tipo} · vence ${fmt.date(t.vencimento)}`)) },
        { key: 'sac', label: 'Sacado', render: sacadoCell },
        { key: 'valor', label: 'Valor', align: 'right', render: (t) => h('span.num', fmt.brl(t.valor)) },
        { key: 'st', label: 'Situação', render: (t) => ui.status('titulo', t.status) },
      ] });
  }

  function titulosTable(titulos, excl, drawSum) {
    return ui.table({ rows: titulos, rowKey: (t) => t.id,
      columns: [
        { key: 'numero', label: 'Título', mobile: 'primary', render: (t) => h('div.cell-main', h('strong.mono', t.numero), h('small', `${t.tipo} · vence ${fmt.date(t.vencimento)}`)) },
        { key: 'sac', label: 'Sacado', render: sacadoCell },
        { key: 'valor', label: 'Valor', align: 'right', render: (t) => h('span.num', fmt.brl(t.valor)) },
        { key: 'flags', label: 'Checagens', mobile: 'hide', render: (t) => h('div.ops-flags', (t.flags || []).map((f) => ui.badge(FLAG_LABEL[f.codigo] || f.codigo, f.nivel === 'erro' ? 'red' : 'amber', { title: f.msg }))) },
        { key: 'dec', label: 'Na aprovação', render: (t) => {
          if (t.status === 'recusado') return ui.badge('Recusado pelas regras', 'red');
          if (t.status !== 'validando') return ui.status('titulo', t.status);
          let sel = null;
          const selWrap = h('div.ops-excl', { hidden: !excl.has(t.id) });
          const chk = ui.checkbox({ label: 'Incluir', checked: !excl.has(t.id), onChange: (v) => { if (v) excl.delete(t.id); else excl.set(t.id, sel.value); selWrap.hidden = v; drawSum(); } });
          sel = ui.select({ value: 'Lastro incompleto', size: 'sm', aria: 'Motivo da exclusão de ' + t.numero, onChange: (v) => excl.set(t.id, v), options: MOTIVOS_EXCLUSAO });
          selWrap.append(sel);
          return h('div.ops-incl', chk, selWrap);
        } },
      ] });
  }

  function checksCard(titulos) {
    const has = (codes, nivel) => titulos.some((t) => (t.flags || []).some((f) => codes.includes(f.codigo) && (!nivel || f.nivel === nivel)));
    const chaveOk = titulos.filter((t) => t.tipo === 'NF-e' && t.chave).every((t) => E.chaveValida(t.chave));
    const dup = has(['DUPLICADO'], 'erro');
    const restr = titulos.some((t) => (orgOf(t.sacadoId) || {}).restricao);
    const sacNovo = has(['SACADO_NOVO'], 'aviso');
    const emit = has(['EMITENTE'], 'erro');
    const eleg = has(['TICKET', 'PRAZO_MIN', 'PRAZO_MAX', 'VENCIDO', 'EMISSAO_FUTURA'], 'erro');
    const contest = has(['CONTESTADO'], 'erro');
    const lastro = has(['LASTRO_XML', 'LASTRO_COMPROVANTE', 'AGUARDA_SACADO'], 'aviso');
    return ui.card({ title: 'Checagens da Mesa', subtitle: 'As regras determinísticas já rodaram; a Mesa confere e decide.' },
      h('div.stack.tight',
        checkRow(chaveOk ? 'ok' : 'fail', 'Chave da NF-e (dígito verificador)', chaveOk ? 'Todas as chaves conferem' : 'Há chave inválida no lote'),
        checkRow(dup ? 'fail' : 'ok', 'Duplicidade na plataforma', dup ? 'NF-e já cadastrada: veja os títulos marcados' : 'Nenhuma duplicidade encontrada'),
        checkRow(restr ? 'fail' : sacNovo ? 'warn' : 'ok', 'Sacado: SCR e restritivos (simulado)', restr ? 'Há sacado com restrição cadastral' : sacNovo ? 'Sacado novo: consulta simulada sem apontamentos' : 'Sacados consultados, sem apontamentos'),
        checkRow(emit ? 'fail' : 'ok', 'Emitente igual ao cedente', emit ? 'Há título com CNPJ de emitente divergente' : 'Emitente confere com o cedente'),
        checkRow(eleg ? 'fail' : 'ok', 'Ticket e prazo do programa', eleg ? 'Há título fora do ticket ou do prazo' : 'Ticket e prazo dentro do programa'),
        checkRow(contest ? 'fail' : lastro ? 'warn' : 'ok', 'Lastro anexado', contest ? 'O sacado contestou um título' : lastro ? 'Falta XML, comprovante ou confirmação do sacado' : 'Lastro completo')));
  }

  function cedenteCtxCard(ced) {
    if (!ced) return ui.card({ title: 'Cedente' }, ui.empty({ title: 'Empresa não encontrada' }));
    const lar = E.lar(ced.id);
    const ops = db.where('operacoes', (o) => o.cedenteId === ced.id);
    const liq = ops.filter((o) => o.status === 'liquidada').length;
    const prob = ops.filter((o) => ['vencida', 'parcial'].includes(o.status)).length;
    const kyc = kycOf(ced.id);
    return ui.card({ title: 'Contexto do cedente', actions: [ui.status('org', ced.status)] },
      h('div.stack.tight',
        F.orgCell(ced),
        ui.kv([['Score Cedy', ced.scoreCedy || 'em formação'], ['KYC', kyc ? ui.status('kyc', kyc.status) : 'sem registro'], ['LAR disponível', lar ? h('span.num.nowrap', fmt.brl(lar.disponivel)) : 'não calculado'], ['Operações', `${ops.length} (${liq} liquidadas${prob ? `, ${prob} com problema` : ''})`]]),
        ui.btn('Abrir empresa', { variant: 'ghost', size: 'sm', icon: 'building-2', route: '/ops/empresas/' + ced.id })));
  }

  /* ======================= 4. /ops/conciliacao ============================= */
  const CASO_TIPO = { parcial: ['Parcial', 'amber'], sem_fonte: ['Sem fonte', 'red'], valor: ['Valor divergente', 'amber'], empate: ['Empate', 'blue'] };
  const casoBadge = (t) => ui.badge.apply(null, CASO_TIPO[t] || [t, 'neutral']);

  function vConciliacao(ctx) {
    const state = { tab: ctx.query.aba || 'abertos' };
    const box = h('div');
    const draw = () => C.mount(box, casosTable(state.tab));
    ctx.onCleanup(db.on(['casosMesa', 'extrato', 'operacoes', 'propostas'], () => { if (box.isConnected) draw(); }));
    draw();
    const tabs = ui.tabs({ value: state.tab, onChange: (v) => { state.tab = v; draw(); }, items: [
      { id: 'abertos', label: 'Abertos', count: db.where('casosMesa', (c) => c.status === 'aberto').length },
      { id: 'resolvidos', label: 'Resolvidos', count: db.where('casosMesa', (c) => c.status !== 'aberto').length }] });
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Conciliadora', title: 'Conciliação', subtitle: 'Parcial e sem fonte em 24h, empate em 48h. Vencidas primeiro; a sobra vira Recurso Livre.', back: '/ops' }),
      tabs, box);
  }

  function casosTable(tab) {
    const rows = tab === 'abertos'
      ? db.where('casosMesa', (c) => c.status === 'aberto').sort((a, b) => a.slaAte - b.slaAte)
      : db.where('casosMesa', (c) => c.status !== 'aberto').sort((a, b) => (b.resolvidoEm || b.abertoEm) - (a.resolvidoEm || a.abertoEm));
    return ui.table({
      rows, rowKey: (c) => c.id, onRowClick: (c) => C.router.go('/ops/conciliacao/' + c.id),
      empty: ui.empty({ icon: tab === 'abertos' ? 'circle-check' : 'inbox', title: tab === 'abertos' ? 'Sem casos abertos' : 'Nenhum caso resolvido', text: tab === 'abertos' ? 'Créditos conciliados automaticamente não chegam aqui.' : 'Os casos resolvidos aparecem aqui.' }),
      columns: [
        { key: 'id', label: 'Caso', mobile: 'primary', render: (c) => h('div.cell-main', h('div.row.nowrap', casoBadge(c.tipo)), h('small.mono', casoCode(c))) },
        { key: 'ced', label: 'Cedente', mobile: 'show', render: (c) => F.orgCell(orgOf(c.cedenteId)) },
        { key: 'valor', label: 'Valor', align: 'right', sort: (a, b) => a.valor - b.valor, render: (c) => h('span.num', fmt.brl(c.valor)) },
        { key: 'motivo', label: 'Motivo', mobile: 'hide', class: 'ops-motivo', render: (c) => h('span.small.ops-clamp', { title: c.motivo }, c.motivo || '—') },
        { key: 'agente', label: 'Agente', mobile: 'hide', render: (c) => agentChip(propFor('casoMesa', c.id, false)[0] || (c.sugestao ? { agenteId: 'ag-conciliacao', confianca: 0.82 } : null)) || h('small.muted', '—') },
        { key: 'sla', label: 'Prazo', sort: (a, b) => a.slaAte - b.slaAte, render: (c) => h('span.nowrap', c.status === 'aberto' ? slaView(c.slaAte) : h('small.muted', 'resolvido ' + fmt.rel(c.resolvidoEm || c.abertoEm))) },
      ],
    });
  }

  /* ===================== 5. /ops/conciliacao/:id =========================== */
  const sacadoPagador = (linha) => { const cnpj = (v) => String(v || '').replace(/\D/g, ''); return db.where('orgs', (o) => o.kind === 'sacado' && cnpj(o.cnpj) === cnpj(linha.pagadorCnpj))[0] || null; };
  function candidatosDoCaso(caso, linha) {
    const sac = sacadoPagador(linha);
    return db.where('operacoes', (o) => o.cedenteId === caso.cedenteId && ['paga', 'vencida', 'parcial'].includes(o.status)).map((op) => {
      const tits = op.tituloIds.map((id) => db.get('titulos', id)).filter((t) => t && !['liquidado', 'recomprado'].includes(t.status));
      if (!tits.length) return null;
      const doPagador = sac ? tits.filter((t) => t.sacadoId === sac.id) : [];
      const venc = Math.min.apply(null, tits.map((t) => t.vencimento));
      return { op, tits, aberto: C.round2(C.sum(tits, (t) => t.valor)), abertoPagador: C.round2(C.sum(doPagador, (t) => t.valor)), venc, vencida: venc < C.cal.startOfDay(linha.ts) };
    }).filter(Boolean).sort((a, b) => ((b.abertoPagador > 0 ? 1 : 0) - (a.abertoPagador > 0 ? 1 : 0)) || ((b.vencida ? 1 : 0) - (a.vencida ? 1 : 0)) || (a.venc - b.venc));
  }

  function vCaso(ctx) {
    const caso = db.get('casosMesa', ctx.params.id);
    if (!caso) return h('div.stack.ops-page', ui.pageHeader({ title: 'Caso não encontrado', back: '/ops/conciliacao' }), ui.empty({ icon: 'search', title: 'Este caso não existe', action: ui.btn('Voltar para a fila', { route: '/ops/conciliacao' }) }));
    const ced = orgOf(caso.cedenteId);
    return caso.status === 'aberto' ? casoAbertoView(caso, ced) : casoResolvidoView(caso, ced);
  }

  function creditoCard(linha) {
    return ui.card({ title: 'Crédito no extrato', subtitle: 'Linha da conta de liquidação que gerou o caso' },
      ui.kv([['Data', fmt.datetime(linha.ts)], ['Valor', h('strong.num.nowrap', fmt.brl(linha.valor))], ['Pagador', linha.pagadorNome || '—', linha.pagadorCnpj ? 'CNPJ ' + fmt.cnpj(linha.pagadorCnpj) : null], ['Descrição', linha.descricao || '—'], ['Situação', ui.status('extrato', linha.status)]]));
  }

  function fatoresCard(linha, cand) {
    const sac = sacadoPagador(linha);
    const doPagador = cand.filter((c) => c.abertoPagador > 0).map((c) => Object.assign({}, c, { aberto: c.abertoPagador }));
    const total = C.round2(C.sum(doPagador, (c) => c.aberto));
    const exatos = doPagador.filter((c) => Math.abs(c.aberto - linha.valor) <= 0.5);
    const f2 = exatos.length > 1 ? ['ok', `Valor exato em ${exatos.length} operações (${exatos.map((c) => c.op.id).join(', ')}): empate`]
      : exatos.length === 1 ? ['ok', `Valor igual ao saldo aberto de ${exatos[0].op.id}`]
        : total > 0 && (doPagador.some((c) => linha.valor >= c.aberto * 0.5 && linha.valor <= c.aberto * 1.1) || linha.valor >= total * 0.5) ? ['ok', `${fmt.brl(linha.valor)} dentro da faixa de 50% a 110% do saldo (${fmt.pct((linha.valor / total) * 100, 0)} de ${fmt.brl(total)})`]
          : ['fail', total > 0 ? `${fmt.brl(linha.valor)} fora da faixa de 50% a 110% do saldo de ${fmt.brl(total)}` : 'Sem saldo aberto compatível'];
    const dataOk = doPagador.some((c) => c.tits.some((t) => t.sacadoId === sac.id && t.vencimento <= linha.ts + 2 * 86400000));
    return ui.card({ title: 'Três fatores', subtitle: 'Conciliação automática: fonte, valor e data' },
      h('div.stack.tight',
        checkRow(sac ? 'ok' : 'fail', 'Fonte pagadora', sac ? `O pagador é ${sac.fantasia || sac.nome}, sacado do cedente` : `${linha.pagadorNome || 'O pagador'} não está entre os sacados do cedente`),
        checkRow(sac ? f2[0] : 'warn', 'Valor', sac ? f2[1] : 'Não avaliado sem uma fonte pagadora reconhecida'),
        checkRow(dataOk ? 'ok' : (sac ? 'fail' : 'warn'), 'Data', dataOk ? 'Há vencimento dentro da janela (crédito a partir de 2 dias antes do vencimento)' : 'Nenhum vencimento dentro da janela de 2 dias')));
  }

  /** Efeito de um caso resolvido: operações, status, repasses e Recurso Livre, lidos do estado real. */
  function efeitoCard(linha) {
    const matches = (linha && linha.matches) || [];
    const repasses = linha ? db.where('repasses', (r) => r.linhaId === linha.id) : [];
    if (!matches.length) return null;
    return ui.card({ title: 'Efeito aplicado', subtitle: 'Operações liquidadas e repasses agendados a partir deste crédito' },
      ui.table({ rows: matches, rowKey: (m, i) => (m.opId || 'rl') + i,
        columns: [
          { key: 'op', label: 'Destino', mobile: 'primary', render: (m) => m.opId ? h('div.cell-main', h('a.mono.strong', { href: '#/ops/empresas/' + (linha.orgId) + '?op=' + m.opId }, m.opId), h('small', m.natureza === 'liquidacao' ? 'Liquidação total' : 'Liquidação parcial')) : h('div.cell-main', h('strong', 'Recurso Livre'), h('small', 'Fica com o cedente')) },
          { key: 'valor', label: 'Valor', align: 'right', render: (m) => h('span.num', fmt.brl(m.valor)) },
          { key: 'st', label: 'Operação agora', render: (m) => { const op = m.opId && db.get('operacoes', m.opId); return op ? ui.status('operacao', op.status) : h('small.muted', '—'); } },
          { key: 'rep', label: 'Repasse ao financiador', mobile: 'hide', render: (m) => { const r = repasses.find((x) => x.opId === m.opId); return r ? h('div.cell-main', h('span.num', fmt.brl(r.valor)), h('small', `${orgOf(r.finId) ? (orgOf(r.finId).fantasia || orgOf(r.finId).nome) : ''} · ${r.status === 'pago' ? 'pago' : 'previsto até ' + fmt.date(r.previstoPara)}`)) : h('small.muted', '—'); } },
        ] }));
  }

  function casoResolvidoView(caso, ced) {
    const linha = db.get('extrato', caso.linhaId);
    const devolvido = caso.resultado === 'nao_identificado';
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Mesa Conciliadora', back: '/ops/conciliacao', title: 'Caso ' + casoCode(caso), subtitle: `${ced ? ced.fantasia || ced.nome : ''} · resolvido ${fmt.rel(caso.resolvidoEm || caso.abertoEm)}`, actions: [casoBadge(caso.tipo), ui.badge('Resolvido', 'green', { dot: true })] }),
      ui.callout({ tone: 'success', icon: 'circle-check', title: devolvido ? 'Devolvido como Recurso Livre' : `Rateio aplicado por ${(userOf(caso.resolvidoPor) || {}).nome || 'Mesa'}`, text: devolvido ? caso.motivo : (linha ? `Crédito de ${fmt.brl(linha.valor)} conciliado.` : null), actions: [ui.btn('Voltar para a fila', { size: 'sm', route: '/ops/conciliacao' })] }),
      h('div.grid.g-main-side', h('div.stack', efeitoCard(linha), trilhaCard('extrato', caso.linhaId, 'Trilha do caso')), linha ? creditoCard(linha) : null));
  }

  function casoAbertoView(caso, ced) {
    const linha = db.get('extrato', caso.linhaId);
    if (!linha) return h('div.stack.ops-page', ui.pageHeader({ title: 'Caso sem crédito', back: '/ops/conciliacao' }), ui.empty({ icon: 'search', title: 'Extrato não encontrado' }));
    const cand = candidatosDoCaso(caso, linha);
    const sug = caso.sugestao || null;
    const prop = propFor('casoMesa', caso.id, false)[0];
    const vals = {}; const inputs = {};
    cand.forEach((c) => { vals[c.op.id] = 0; });
    const restoBox = h('div');
    const prevBox = h('div');
    const drawResto = () => {
      const soma = C.round2(C.sum(Object.keys(vals), (k) => vals[k] || 0));
      const resto = C.round2(linha.valor - soma);
      C.mount(restoBox, h('div.ops-sum',
        h('span', h('strong.num.nowrap', fmt.brl(soma)), h('span.muted', ' rateados')),
        resto < -0.01 ? ui.badge('Excede em ' + fmt.brl(-resto), 'red') : h('span', h('strong.num.nowrap', fmt.brl(resto)), h('span.muted', ' viram Recurso Livre'))));
      const linhasPrev = Object.keys(vals).filter((k) => (vals[k] || 0) > 0).map((k) => {
        const c = cand.find((x) => x.op.id === k);
        return h('div.small', h('span.mono', k), ' recebe ', h('strong.nowrap', fmt.brl(vals[k])), h('span.muted', c && vals[k] >= c.aberto - 0.5 ? ' e liquida' : ' (parcial)'));
      });
      C.mount(prevBox, h('div.stack.tight',
        linhasPrev.length ? h('div.stack', { style: { gap: '4px' } }, linhasPrev) : h('div.small.muted', 'Nenhum rateio ainda: o crédito segue pendente.'),
        h('div.small.muted', 'Ao aplicar: repasse ao financiador em até 1 dia útil, aviso ao cedente e ao financiador, registro R3 na trilha.')));
    };
    const aplicarSugestao = () => {
      cand.forEach((c) => { const a = ((sug && sug.alocacoes) || []).find((x) => x.opId === c.op.id); vals[c.op.id] = a ? a.valor : 0; inputs[c.op.id].value = vals[c.op.id]; });
      drawResto();
      ui.toast('Sugestão aplicada nos campos', { type: 'info', text: 'Confira e confirme: a decisão é humana.' });
    };
    cand.forEach((c) => { inputs[c.op.id] = ui.currency({ value: 0, aria: 'Rateio para ' + c.op.id, onInput: (v) => { vals[c.op.id] = v || 0; drawResto(); } }); });
    drawResto();

    const head = ui.pageHeader({ eyebrow: 'Mesa Conciliadora', back: '/ops/conciliacao', title: 'Caso ' + casoCode(caso),
      subtitle: `${ced ? ced.fantasia || ced.nome : ''} · ${caso.motivo}`, actions: [casoBadge(caso.tipo), slaView(caso.slaAte)] });
    const candCard = ui.card({ title: 'Operações candidatas', subtitle: 'Saldo aberto por operação. Vencidas primeiro, depois as mais antigas; o que sobrar vira Recurso Livre.' },
      cand.length ? ui.table({ rows: cand, rowKey: (c) => c.op.id,
        columns: [
          { key: 'op', label: 'Operação', mobile: 'primary', render: (c) => h('div.cell-main', h('div.row.nowrap', h('a.mono.strong', { href: '#/ops/empresas/' + c.op.cedenteId + '?op=' + c.op.id }, c.op.id), c.vencida ? ui.badge('Vencida', 'red') : null, c.abertoPagador > 0 ? ui.badge('Do pagador', 'blue', { title: 'Tem título do sacado que pagou este crédito' }) : null), h('small', `${fmt.plural(c.tits.length, 'título', 'títulos')} · vence ${fmt.date(c.venc)}`)) },
          { key: 'aberto', label: 'Em aberto', align: 'right', render: (c) => h('span.num', fmt.brl(c.aberto)) },
          { key: 'rateio', label: 'Rateio', align: 'right', render: (c) => h('div.ops-rateio', inputs[c.op.id]) },
        ] }) : ui.empty({ icon: 'inbox', title: 'Sem operações candidatas', text: 'Nenhuma operação paga, vencida ou parcial para este cedente.' }));
    const sugCard = ui.card({ title: 'Sugestão do agente', subtitle: sug ? `Agente de Conciliação · confiança de ${Math.round(((prop && prop.confianca) || 0.82) * 100)}%` : null, class: 'card-ai', actions: sug ? [ui.btn('Usar sugestão', { variant: 'ai', size: 'sm', icon: 'sparkles', onclick: aplicarSugestao })] : null },
      sug ? h('div.stack.tight',
        h('ul.ops-sug', (sug.alocacoes || []).map((a) => h('li.small', h('span.mono', a.opId), ' recebe ', h('strong.nowrap', fmt.brl(a.valor))))),
        sug.nota ? h('div.small.muted', sug.nota) : null,
        h('div.small.muted', 'A IA sugere, a Mesa aplica.'))
        : h('p.muted.small', 'O agente não tem sugestão para este crédito. Monte o rateio manualmente ou devolva como não identificado.'));
    return h('div.stack.ops-page', head,
      caso.tipo === 'empate' ? ui.callout({ tone: 'info', title: 'Empate: 48h para desempatar', text: 'Duas ou mais operações têm o mesmo valor exato. Desempate pela operação vencida, depois pela mais antiga. Só uma liquida com este crédito; a outra segue aberta.' }) : null,
      h('div.grid.g-main-side',
        h('div.stack', creditoCard(linha), fatoresCard(linha, cand), candCard, agentPropsCard('casoMesa', caso.id), trilhaCard('extrato', caso.linhaId, 'Trilha do caso')),
        h('div.stack', sugCard,
          ui.card({ title: 'Efeito previsto', subtitle: 'Antes de confirmar' }, restoBox, h('div.sp-3'), prevBox),
          ui.card({ title: 'Decisão da Mesa', subtitle: 'Classe R3: sempre uma pessoa confirma.' }, h('div.stack.tight',
            ui.btn('Aplicar rateio', Object.assign({ variant: 'primary', icon: 'check', block: true, onclick: Ops.guard('ops.conciliar', () => aplicarRateio(caso, linha, vals, cand)) }, Ops.permBtn('ops.conciliar'))),
            ui.btn('Devolver, não identificado', Object.assign({ icon: 'rotate-ccw', block: true, onclick: Ops.guard('ops.conciliar', () => devolverCaso(caso, linha)) }, Ops.permBtn('ops.conciliar'))),
            ui.btn('Pedir informação ao cedente', Object.assign({ variant: 'ghost', icon: 'message-circle', block: true, onclick: Ops.guard('ops.conciliar', () => pedirInfoCaso(caso)) }, Ops.permBtn('ops.conciliar'))))))));
  }

  const fechaRateioProps = (caso, status, extra) => db.where('propostas', (p) => p.status === 'pendente' && p.tipo === 'ratear' && (p.entidade.id === caso.id || p.entidade.id === 'pendente')).forEach((p) => db.patch('propostas', p.id, Object.assign({ status, decididoPor: meName(), decididoEm: now() }, extra)));

  function aplicarRateio(caso, linha, vals, cand) {
    const aloc = Object.keys(vals).filter((k) => (vals[k] || 0) > 0.005).map((k) => ({ opId: k, valor: C.round2(vals[k]) }));
    if (!aloc.length) { ui.toast('Nada para aplicar', { type: 'warn', text: 'Informe ao menos um valor de rateio.' }); return; }
    const soma = C.round2(C.sum(aloc, (a) => a.valor));
    if (soma > linha.valor + 0.01) { ui.toast('Rateio excede o crédito', { type: 'error', text: `A soma (${fmt.brl(soma)}) passa de ${fmt.brl(linha.valor)}.` }); return; }
    const sobra = C.round2(linha.valor - soma);
    const detalhe = aloc.map((a) => {
      const c = cand.find((x) => x.op.id === a.opId); const fin = orgOf(db.get('operacoes', a.opId).financiadorId);
      return h('div.small', h('span.mono', a.opId), ' recebe ', h('strong.nowrap', fmt.brl(a.valor)), h('span.muted', c && a.valor >= c.aberto - 0.5 ? ` e liquida. Repasse a ${(fin && fin.fantasia) || 'financiador'}.` : ' (parcial). Repasse parcial.'));
    });
    ui.confirm({ title: `Aplicar rateio de ${fmt.brl(linha.valor)}?`, tone: 'primary', confirmLabel: 'Aplicar rateio',
      text: `${fmt.brl(soma)} rateados e ${fmt.brl(sobra)} de sobra como Recurso Livre.`, children: h('div.stack.tight', detalhe, h('div.small.muted', 'Avisa cedente e financiador, agenda os repasses e registra R3 na trilha.')) })
      .then((okc) => {
        if (!okc) return;
        const r = E.resolverCaso(caso.id, aloc, { userId: meId() });
        if (!r.ok) { ui.toast('Não foi possível aplicar', { type: 'error', text: r.erro }); return; }
        fechaRateioProps(caso, 'aprovada');
        ui.toast('Rateio aplicado', { type: 'success', text: `${fmt.brl(soma)} conciliados${sobra > 0.5 ? `, ${fmt.brl(sobra)} como Recurso Livre` : ''}.` });
        C.router.go('/ops/conciliacao/' + caso.id);
      });
  }

  function devolverCaso(caso, linha) {
    let motivo = null;
    const campo = ui.field({ label: 'Motivo', required: true }, (motivo = ui.input({ type: 'textarea', placeholder: 'Ex.: pagador não é sacado do cedente, nenhum vencimento compatível' })));
    Ops.modal({ title: 'Devolver como não identificado', icon: 'rotate-ccw', size: 'sm',
      body: h('div.stack.tight', ui.callout({ tone: 'info', title: 'Vira Recurso Livre', text: 'O crédito fica com o cedente como Recurso Livre até a identificação. Não liquida nenhuma operação.' }), campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Devolver', { variant: 'primary', onclick: () => {
        const m = String(motivo.value).trim();
        if (!m) { campo.setError('Informe o motivo.'); return; }
        db.batch(() => {
          db.patch('casosMesa', caso.id, { status: 'resolvido', resultado: 'nao_identificado', resolvidoEm: now(), resolvidoPor: meId(), motivo: m });
          db.patch('extrato', linha.id, { status: 'recurso_livre', casoId: caso.id, matches: [{ opId: null, valor: linha.valor, natureza: 'recurso_livre' }] });
          fechaRateioProps(caso, 'rejeitada', { motivo: m });
          ledger.append({ actor: E.actors.user(meId()), acao: 'conciliacao.nao_identificada', entidade: { kind: 'extrato', id: linha.id }, resumo: `Crédito de ${fmt.brl(linha.valor)} devolvido como Recurso Livre: ${m}`, classe: 'R3' });
          notify.send({ to: { orgId: caso.cedenteId }, tipo: 'alerta', titulo: 'Crédito liberado como Recurso Livre', corpo: `${fmt.brl(linha.valor)}: ${m}`, link: '/cedente/conta' });
        });
        ui.toast('Caso devolvido', { type: 'success', text: 'Crédito como Recurso Livre do cedente.' });
        api.close(); C.router.go('/ops/conciliacao/' + caso.id);
      } })] });
  }

  function pedirInfoCaso(caso) {
    let msg = null;
    const campo = ui.field({ label: 'O que falta', required: true }, (msg = ui.input({ type: 'textarea', placeholder: 'Ex.: enviar comprovante do pagador e a nota de origem do TED' })));
    Ops.modal({ title: 'Pedir informação ao cedente', icon: 'message-circle', size: 'sm',
      body: h('div.stack.tight', ui.callout({ tone: 'info', text: 'O caso segue aberto e o SLA segue correndo. O cedente recebe uma notificação.' }), campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Enviar pedido', { variant: 'primary', onclick: () => {
        const m = String(msg.value).trim();
        if (!m) { campo.setError('Descreva o que o cedente precisa enviar.'); return; }
        ledger.append({ actor: E.actors.user(meId()), acao: 'conciliacao.info_pedida', entidade: { kind: 'extrato', id: caso.linhaId }, resumo: `Mesa pediu informação sobre o crédito de ${fmt.brl(caso.valor)}: ${m}`, classe: 'R1' });
        notify.send({ to: { orgId: caso.cedenteId }, tipo: 'alerta', titulo: 'Mesa pediu informação', corpo: m, link: '/cedente/conta' });
        ui.toast('Pedido enviado ao cedente', { type: 'success' }); api.close();
      } })] });
  }

  /* ============================ 6. /ops/kyc ================================= */
  const emFila = (k) => ['em_analise', 'pendencia'].includes(k.status);

  function vKyc(ctx) {
    const state = { tab: ctx.query.aba || 'fila', q: '' };
    const box = h('div');
    const draw = () => C.mount(box, kycTable(state));
    ctx.onCleanup(db.on(['kyc', 'orgs', 'propostas'], () => { if (box.isConnected) draw(); }));
    draw();
    const tabs = ui.tabs({ value: state.tab, onChange: (v) => { state.tab = v; draw(); }, items: [
      { id: 'fila', label: 'Na fila', count: db.where('kyc', emFila).length },
      { id: 'aprovados', label: 'Aprovados', count: db.where('kyc', (k) => k.status === 'aprovado').length },
      { id: 'reprovados', label: 'Reprovados', count: db.where('kyc', (k) => k.status === 'reprovado').length }] });
    const search = ui.search({ placeholder: 'Buscar empresa ou CNPJ', onInput: (v) => { state.q = String(v || '').toLowerCase(); draw(); } });
    return h('div.stack.ops-page',
      ui.pageHeader({ eyebrow: 'Cadastros', title: 'KYC e cadastros', subtitle: 'Análise e pendências primeiro. O agente resume, a Mesa aprova. SLA interno de 48h.', back: '/ops' }),
      tabs, ui.toolbar(search), box);
  }

  function kycTable(state) {
    let rows = db.all('kyc').slice();
    rows.sort((a, b) => b.atualizadoEm - a.atualizadoEm);
    if (state.tab === 'fila') rows = rows.filter(emFila);
    else if (state.tab === 'aprovados') rows = rows.filter((k) => k.status === 'aprovado');
    else rows = rows.filter((k) => k.status === 'reprovado');
    if (state.q) rows = rows.filter((k) => { const o = orgOf(k.orgId) || {}; return `${o.fantasia || o.nome || ''} ${o.nome || ''} ${o.cnpj || ''} ${fmt.cnpj(o.cnpj || '')}`.toLowerCase().includes(state.q); });
    return ui.table({ rows, rowKey: (k) => k.id, onRowClick: (k) => C.router.go('/ops/kyc/' + k.id),
      empty: ui.empty({ icon: 'scan-line', title: state.q ? 'Nenhum cadastro encontrado' : 'Nada por aqui', text: state.q ? 'Ajuste a busca.' : 'Nenhum cadastro nesta aba.' }),
      columns: [
        { key: 'org', label: 'Empresa', mobile: 'primary', render: (k) => { const o = orgOf(k.orgId); return o ? F.orgCell(o) : h('span.muted', k.orgId); } },
        { key: 'tipo', label: 'Tipo', mobile: 'hide', render: (k) => { const o = orgOf(k.orgId); return o ? kindBadge(o.kind) : '—'; } },
        { key: 'env', label: 'Na fila há', render: (k) => h('span.small.nowrap', fmt.rel(k.atualizadoEm).replace(/^há /, '')) },
        { key: 'docs', label: 'Documentos', align: 'right', render: (k) => h('span.num.nowrap', `${(k.docs || []).filter((d) => d.status === 'ok').length} de ${(k.docs || []).length}`) },
        { key: 'risco', label: 'Risco', mobile: 'hide', render: (k) => ui.badge(k.risco === 'baixo' ? 'Baixo' : k.risco === 'medio' ? 'Médio' : (k.risco || '—'), k.risco === 'baixo' ? 'green' : k.risco === 'medio' ? 'amber' : 'red') },
        { key: 'agente', label: 'Agente', mobile: 'hide', render: (k) => { const p = propFor('org', k.orgId, true)[0]; return p ? agentChip(p) : h('small.muted', '—'); } },
        { key: 'st', label: 'Situação', render: (k) => ui.status('kyc', k.status) },
      ] });
  }

  /* ========================== 7. /ops/kyc/:id ============================== */
  const DOC_ST = { ok: ['Conferido', 'green'], pendente: ['Pendente', 'amber'], divergente: ['Divergente', 'amber'], expirado: ['Expirado', 'red'] };

  function vKycId(ctx) {
    const k = db.get('kyc', ctx.params.id);
    if (!k) return h('div.stack.ops-page', ui.pageHeader({ title: 'Cadastro não encontrado', back: '/ops/kyc' }), ui.empty({ icon: 'search', title: 'Este cadastro não existe', action: ui.btn('Voltar para a fila', { route: '/ops/kyc' }) }));
    const org = orgOf(k.orgId);
    const decided = ['aprovado', 'reprovado'].includes(k.status);
    const users = org ? db.where('users', (u) => u.orgId === org.id) : [];
    const docs = k.docs || [];
    const expirado = docs.some((d) => d.status === 'expirado');
    const head = ui.pageHeader({ eyebrow: 'Cadastros', back: '/ops/kyc', title: org ? (org.fantasia || org.nome) : 'Cadastro',
      subtitle: org ? `${org.nome} · CNPJ ${fmt.cnpj(org.cnpj)} · ${org.cidade || ''}/${org.uf || ''}` : '', actions: [kindBadge(org ? org.kind : ''), ui.status('kyc', k.status)] });
    const agenteCard = ui.card({ title: 'Parecer do agente', subtitle: `Agente de Documentos · atualizado ${fmt.rel(k.atualizadoEm)}`, class: 'card-ai', actions: [ui.ai('IA')] },
      h('div.stack.tight', h('p', k.agenteResumo || 'Sem resumo do agente.'), h('div.row', ui.badge('Risco ' + ({ baixo: 'baixo', medio: 'médio', alto: 'alto' }[k.risco] || '—'), k.risco === 'baixo' ? 'green' : 'amber'))));
    const dadosCard = ui.card({ title: 'Dados da empresa' },
      org ? ui.kv([['Razão social', org.nome], ['Nome fantasia', org.fantasia || '—'], ['CNPJ', fmt.cnpj(org.cnpj)], ['Cidade/UF', `${org.cidade || ''}/${org.uf || ''}`], ['Setor', org.setor || org.tipo || '—'], ['Faturamento anual', org.faturamentoAnual ? h('span.nowrap', fmt.brl(org.faturamentoAnual)) : '—'], ['Score Cedy', org.scoreCedy || 'em formação'], ['Situação', ui.status('org', org.status)]], { cols: 2 }) : h('span.muted', '—'));
    const docsCard = ui.card({ title: 'Documentos', subtitle: `${docs.filter((d) => d.status === 'ok').length} de ${docs.length} conferidos` },
      h('div.list', docs.map((d, i) => h('div.list-item.ops-docrow',
        h('span', { class: ['ops-check-ic', 'st-' + (d.status === 'ok' ? 'ok' : d.status === 'expirado' ? 'fail' : 'warn')] }, icon(d.status === 'ok' ? 'circle-check' : d.status === 'pendente' ? 'clock' : 'circle-alert', 16)),
        h('div.grow', h('div', h('strong.small', d.tipo)), h('div.small.muted', d.arquivo ? h('span.mono.ops-file', { title: d.arquivo }, d.arquivo) : 'arquivo ausente'), d.agente && d.agente.nota ? h('div.small.muted', d.agente.nota) : null),
        d.agente && d.agente.confianca ? ui.ai(Math.round(d.agente.confianca * 100) + '%') : null,
        ui.badge((DOC_ST[d.status] || [d.status])[0], (DOC_ST[d.status] || [0, 'neutral'])[1], { dot: true }),
        ui.btn('Ver', { variant: 'ghost', size: 'sm', onclick: () => docDrawer(org, d, i) })))));
    const sociosCard = users.length ? ui.card({ title: 'Representantes cadastrados' }, h('div.list', users.map((u) => h('div.list-item', ui.avatar(u.nome, { hue: u.hue, size: 'sm' }), h('div.grow', h('div', h('strong.small', u.nome)), h('div.small.muted', `${u.cargo || ''} · ${u.perfil || ''}`)), h('span.small.muted', u.email || ''))))) : null;
    const scrCard = ui.card({ title: 'Consultas externas (simulado)', subtitle: 'SCR, restritivos e CND no momento da análise' },
      h('div.stack.tight',
        checkRow('ok', 'CNPJ na Receita', 'Ativo há 14 anos'),
        checkRow(org && org.restricao ? 'fail' : 'ok', 'Protestos e ações', org && org.restricao ? org.restricao : 'Nada consta'),
        checkRow(expirado ? 'fail' : 'ok', 'Certidão federal (CND)', expirado ? 'Vencida em 02/11/2026' : 'Válida'),
        checkRow('ok', 'Faturamento declarado', org && org.faturamentoAnual ? `${fmt.brl(org.faturamentoAnual, { round: true })} por ano, compatível com as NF-e de amostra` : 'Compatível com as NF-e de amostra')));
    const actionCard = decided ? ui.callout({ tone: k.status === 'aprovado' ? 'success' : 'error', title: k.status === 'aprovado' ? 'Cadastro aprovado' : 'Cadastro reprovado', text: `Atualizado ${fmt.rel(k.atualizadoEm)}.`, actions: [ui.btn('Voltar para a fila', { size: 'sm', route: '/ops/kyc' })] })
      : ui.card({ title: 'Decisão da Mesa', subtitle: 'A aprovação libera o app da empresa na hora.' }, h('div.stack.tight',
        ui.btn('Aprovar cadastro', Object.assign({ variant: 'primary', icon: 'badge-check', block: true, onclick: Ops.guard('ops.kyc', () => aprovarKyc(k, org)) }, Ops.permBtn('ops.kyc'))),
        ui.btn('Solicitar documentos', Object.assign({ icon: 'file-up', block: true, onclick: Ops.guard('ops.kyc', () => pedirDocsKyc(k, org)) }, Ops.permBtn('ops.kyc'))),
        ui.btn('Reprovar', Object.assign({ class: 'ops-btn-danger', icon: 'file-x', block: true, onclick: Ops.guard('ops.kyc', () => reprovarKyc(k, org)) }, Ops.permBtn('ops.kyc')))));
    return h('div.stack.ops-page', head,
      h('div.grid.g-main-side',
        h('div.stack', dadosCard, docsCard, sociosCard, trilhaCard('org', k.orgId, 'Trilha do cadastro')),
        h('div.stack', actionCard, agenteCard, scrCard, agentPropsCard('org', k.orgId))));
  }

  function docDrawer(org, doc, idx) {
    const st = DOC_ST[doc.status] || [doc.status, 'neutral'];
    const fields = [['Empresa', (org && (org.fantasia || org.nome)) || '—'], ['CNPJ', org ? fmt.cnpj(org.cnpj) : '—'], ['Documento', doc.tipo], ['Arquivo', doc.arquivo || 'ausente'], ['Situação', st[0]]];
    Ops.drawer({ title: doc.tipo, subtitle: `Documento ${idx + 1} · extração simulada do agente`, icon: 'file-text', size: 'md',
      body: h('div.stack.tight',
        h('div.ops-doc', h('div.ops-doc-head', h('strong', doc.tipo), doc.agente ? ui.ai(Math.round(doc.agente.confianca * 100) + '%') : null), h('div.ops-doc-body', fields.map((f) => h('div.ops-doc-row', h('span.muted', f[0]), h('strong', String(f[1])))))),
        doc.arquivo ? null : ui.callout({ tone: 'warn', title: 'Arquivo ausente', text: 'Solicite o envio na decisão do cadastro.' }),
        doc.agente && doc.agente.nota ? ui.callout({ tone: doc.status === 'ok' ? 'success' : 'warn', title: 'Veredicto do agente', text: doc.agente.nota }) : null,
        doc.status !== 'ok' ? ui.callout({ tone: 'error', title: 'Pendência', text: `Documento marcado como ${st[0].toLowerCase()}.` }) : null) });
  }

  function aprovarKyc(k, org) {
    ui.confirm({ title: `Aprovar ${(org && org.fantasia) || 'cadastro'}?`, tone: 'primary', confirmLabel: 'Aprovar cadastro', text: 'A empresa fica ativa na hora e os usuários entram no app. Propostas pendentes do agente para este cadastro são concluídas.' })
      .then((okc) => {
        if (!okc) return;
        const ts = now();
        db.batch(() => {
          db.patch('kyc', k.id, { status: 'aprovado', atualizadoEm: ts });
          if (org) db.patch('orgs', org.id, { status: 'ativo', ativoDesde: org.ativoDesde || ts });
          closeProps('org', k.orgId, 'aprovada');
          ledger.append({ actor: E.actors.user(meId()), acao: 'kyc.aprovado', entidade: { kind: 'org', id: k.orgId }, resumo: `Mesa aprovou o cadastro de ${(org && (org.fantasia || org.nome)) || k.orgId}`, classe: 'R2' });
          notify.send({ to: { orgId: k.orgId }, tipo: 'sucesso', titulo: 'Cadastro aprovado', corpo: `${(org && org.fantasia) || 'Sua empresa'} está ativa na Cedy.`, link: homeOf(org) });
        });
        ui.toast('Cadastro aprovado', { type: 'success', text: 'A empresa está ativa.' });
        C.router.go('/ops/kyc/' + k.id);
      });
  }

  function pedirDocsKyc(k, org) {
    const sel = new Set();
    const list = h('div.list', (k.docs || []).map((d, i) => {
      if (d.status !== 'ok') sel.add(i);
      return h('div.list-item', ui.checkbox({ label: d.tipo, hint: (DOC_ST[d.status] || [d.status])[0], checked: d.status !== 'ok', onChange: (v) => { if (v) sel.add(i); else sel.delete(i); } }));
    }));
    Ops.modal({ title: 'Solicitar documentos', subtitle: (org && org.fantasia) || '', icon: 'file-up', size: 'sm',
      body: h('div.stack.tight', ui.callout({ tone: 'info', text: 'Os marcados voltam para pendente e o cadastro vai para pendência. A empresa recebe a lista.' }), list),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Enviar solicitação', { variant: 'primary', onclick: () => {
        if (!sel.size) { ui.toast('Selecione ao menos um documento', { type: 'warn' }); return; }
        const ts = now();
        const docs = (k.docs || []).map((d, i) => (sel.has(i) ? Object.assign({}, d, { status: 'pendente', arquivo: null, agente: null }) : d));
        db.batch(() => {
          db.patch('kyc', k.id, { status: 'pendencia', atualizadoEm: ts, docs });
          closeProps('org', k.orgId, 'aprovada');
          ledger.append({ actor: E.actors.user(meId()), acao: 'kyc.pendencia', entidade: { kind: 'org', id: k.orgId }, resumo: `Mesa solicitou ${fmt.plural(sel.size, 'documento', 'documentos')} a ${(org && (org.fantasia || org.nome)) || k.orgId}`, classe: 'R1' });
          notify.send({ to: { orgId: k.orgId }, tipo: 'alerta', titulo: 'Pendências no cadastro', corpo: `${fmt.plural(sel.size, 'documento solicitado', 'documentos solicitados')} pela Mesa.`, link: homeOf(org) });
        });
        ui.toast('Solicitação enviada', { type: 'success' });
        api.close(); C.router.go('/ops/kyc/' + k.id);
      } })] });
  }

  function reprovarKyc(k, org) {
    let motivo = null;
    const campo = ui.field({ label: 'Motivo', required: true }, (motivo = ui.input({ type: 'textarea', placeholder: 'Ex.: documentos inconsistentes com a Receita' })));
    Ops.modal({ title: 'Reprovar cadastro', icon: 'file-x', tone: 'red', size: 'sm', body: campo,
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Reprovar', { variant: 'danger', onclick: () => {
        const m = String(motivo.value).trim();
        if (!m) { campo.setError('Informe o motivo.'); return; }
        const ts = now();
        db.batch(() => {
          db.patch('kyc', k.id, { status: 'reprovado', atualizadoEm: ts });
          if (org) db.patch('orgs', org.id, { status: 'inativo' });
          closeProps('org', k.orgId, 'rejeitada', { motivo: m });
          ledger.append({ actor: E.actors.user(meId()), acao: 'kyc.reprovado', entidade: { kind: 'org', id: k.orgId }, resumo: `Mesa reprovou o cadastro de ${(org && (org.fantasia || org.nome)) || k.orgId}: ${m}`, classe: 'R2' });
          notify.send({ to: { orgId: k.orgId }, tipo: 'erro', titulo: 'Cadastro não aprovado', corpo: m, link: homeOf(org) });
        });
        ui.toast('Cadastro reprovado', { type: 'info' });
        api.close(); C.router.go('/ops/kyc/' + k.id);
      } })] });
  }

  Ops.homeOf = homeOf;

  /* ------------------------------ rotas ---------------------------------- */
  C.router.register([
    { path: '/ops', roles: ['ops'], title: 'Visão geral', render: vOps },
    { path: '/ops/mesa', roles: ['ops'], title: 'Mesa de Operações', render: vMesa },
    { path: '/ops/mesa/:id', roles: ['ops'], title: 'Lote', render: vLote },
    { path: '/ops/conciliacao', roles: ['ops'], title: 'Mesa Conciliadora', render: vConciliacao },
    { path: '/ops/conciliacao/:id', roles: ['ops'], title: 'Caso de conciliação', render: vCaso },
    { path: '/ops/kyc', roles: ['ops'], title: 'Cadastros', render: vKyc },
    { path: '/ops/kyc/:id', roles: ['ops'], title: 'Cadastro', render: vKycId },
  ]);
})();
