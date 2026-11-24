/* Cedy assistente: chat em drawer, respostas por regras sobre dados reais.
   A IA sugere; o humano decide. Nenhuma ação financeira é executada aqui. */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui;
  const { db, session, ledger } = C.store; const E = C.engine;
  const FOOT = 'A IA sugere; você decide.';

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const day = (ts) => C.cal.startOfDay(ts);
  const inWeek = (ts) => ts >= day(C.clock.now()) && ts <= day(C.clock.now()) + 7 * 86400000;
  const orgName = (id) => { const o = db.get('orgs', id); return o ? (o.fantasia || o.nome) : '—'; };
  const opRoute = (op) => { const r = session.role(); if (r === 'cedente') return '/cedente/operacoes/' + op.id; if (r === 'financiador') return '/financiador/operacoes/' + op.id; if (r === 'ops') return '/ops/mesa'; return C.roles[r].home; };
  function safeGo(route) {
    let hit = true;
    try { const p = C.router.parse(route).path; hit = C.router.routes.some((r) => r.re.test(p)); } catch (e) { hit = true; }
    if (hit) { close(); C.router.go(route); }
    else ui.toast('Tela indisponível', { type: 'info', text: 'Não encontrei essa tela no protótipo.' });
  }

  const CHIPS = {
    cedente: ['Quanto vou receber esta semana?', 'O que precisa da minha atenção?', 'Qual a melhor oferta agora?', 'Quanto posso antecipar?', 'Como funciona o corte das 14h30?', 'Por que meu lote foi recusado?'],
    financiador: ['Oportunidades que cabem na minha política', 'Minha exposição por sacado', 'O que vence esta semana?', 'Operações vencidas e regresso', 'Quanto vou pagar de TS este mês?', 'Onde estou perdendo lances?'],
    originador: ['Minha premiação do mês', 'Quais indicados estão inativos?', 'Como funciona a janela de 24 meses?', 'O que mudou hoje?'],
    sacado: ['O que pago esta semana?', 'Títulos aguardando minha confirmação', 'Para quem e onde pago?', 'O que mudou hoje?'],
    ops: ['Filas e SLAs', 'Casos críticos', 'Propostas de agentes aguardando', 'Verificar integridade da trilha', 'O que mudou hoje?', 'Que horas são na simulação?'],
    subparceiro: ['Minha comissão do mês', 'Quanto falta o originador me repassar?', 'Quais indicados estão parados?', 'Como funciona o meu split?', 'O que mudou hoje?'],
    superadmin: ['Aprovações pendentes', 'Incidentes e serviços com problema', 'Custo de IA no mês', 'Estado do mercado', 'Último backup e RPO', 'Pedidos LGPD abertos', 'Segurança e acessos', 'Verificar integridade da trilha'],
  };

  /* ------------------------------- estado -------------------------------- */
  let api = null; let listEl = null; let inputEl = null;
  const mem = {};
  const key = () => 'cedy-asst-' + ((session.get() || {}).userId || 'anon');
  function loadHist() {
    if (mem[key()]) return mem[key()];
    try { mem[key()] = JSON.parse(sessionStorage.getItem(key()) || '[]'); } catch (e) { mem[key()] = []; }
    return mem[key()];
  }
  function saveHist() { try { sessionStorage.setItem(key(), JSON.stringify(loadHist().slice(-40))); } catch (e) { /* */ } }

  function scrollEnd() { const sc = listEl && listEl.closest('.layer-body'); if (sc) sc.scrollTop = sc.scrollHeight; }
  const actBtn = (a) => ui.btn(a.label, { size: 'sm', variant: a.primary ? 'primary' : 'secondary', icon: a.icon, onclick: () => { if (a.route) safeGo(a.route); else if (a.run) a.run(); } });
  function bubble(role, nodes, acts) {
    const el = h('div', { class: ['asst-msg', role === 'user' ? 'user' : 'bot'] });
    el.append(...[nodes].flat().filter((x) => x !== null && x !== undefined && x !== false));
    listEl.append(el);
    const hist = loadHist();
    hist.push({ r: role, t: role === 'user' ? String(nodes) : el.innerText.trim(), acts: (acts || []).filter((a) => a.route).map((a) => ({ label: a.label, route: a.route })) });
    saveHist();
    if (role === 'b') {
      if (acts && acts.length) el.append(h('div.asst-actions', acts.map(actBtn)));
      el.append(h('div.asst-foot', ui.ai('IA'), FOOT));
    }
    scrollEnd();
    return el;
  }
  function send(text) {
    const q = String(text || '').trim(); if (!q) return;
    bubble('user', q);
    const t = h('div', { class: ['asst-msg', 'bot'] }, h('span.asst-typing', [0, 1, 2].map((i) => h('i', { style: { '--i': i } }))));
    listEl.append(t); scrollEnd();
    setTimeout(() => { t.remove(); answer(q); }, 500 + Math.random() * 400);
  }

  /* ------------------------------ respostas ------------------------------ */
  function answer(q) {
    const me = session.get(); const role = session.role(); const org = session.org();
    const ctx = { me, role, org, user: session.user(), key: C.shellKey() };
    const r = route(q, ctx);
    if (r) { bubble('b', r.nodes, r.acts); return; }
    bubble('b', ['Não entendi. Tente uma destas perguntas:'],
      CHIPS[ctx.key].slice(0, 4).map((c) => ({ label: c, run: () => send(c) })));
  }
  function kvActs(pairs, acts) { return { nodes: [ui.kv(pairs)], acts }; }
  function say(text, acts) { return { nodes: [text], acts }; }

  function route(q, ctx) {
    const n = norm(q);
    const opm = q.match(/op-?\s?26-?\s?0?(\d{3,4})/i) || n.match(/op-?\s?26-?\s?0?(\d{3,4})/);
    if (opm) return intentOp(opm, ctx);
    if (/hora|sao |relogio|simulacao/.test(n) && /hora|relogio|simul/.test(n)) return intentClock(ctx);
    if (/mudou hoje|novidade|hoje/.test(n)) return intentHoje(ctx);
    if (/glossario|termo|significa|o que e /.test(n)) { const g = intentGloss(n); if (g) return g; }
    if (/desagio|cet\b/.test(n)) return intentGloss(n);
    if (/\bts\b|taxa de servico/.test(n) && ctx.role !== 'financiador') return intentGloss(n);
    if (/regresso/.test(n) && !/vencida|acion|recompra/.test(n)) return intentGloss(n);
    if (/recurso livre/.test(n)) return intentGloss(n);
    if (/firmeza|firme/.test(n)) return intentGloss(n);
    if (/\blar\b|limite de antecip/.test(n)) return intentGloss(n);
    if (ctx.key === 'cedente') { const r = cedenteRoute(n, ctx); if (r) return r; }
    if (ctx.key === 'financiador') { const r = finRoute(n, ctx); if (r) return r; }
    if (ctx.key === 'originador') { const r = origRoute(n, ctx); if (r) return r; }
    if (ctx.key === 'subparceiro') { const r = subRoute(n, ctx); if (r) return r; }
    if (ctx.key === 'sacado') { const r = sacRoute(n, ctx); if (r) return r; }
    if (ctx.key === 'superadmin') { const r = superRoute(n, ctx); if (r) return r; }
    if (ctx.key === 'ops' || ctx.key === 'superadmin') { const r = opsRoute(n, ctx); if (r) return r; }
    if (/ajuda|o que voce|como funciona|comecar|o que sabe/.test(n)) return intentAjuda(ctx);
    return null;
  }

  function intentClock() {
    const now = C.clock.now(); const pg = E.prazoPagamento(now);
    return { nodes: [`Na simulação são ${fmt.datetime(now)} (Brasília). O corte de aceite é 14h30 em dia útil: aceites até esse horário pagam no mesmo dia até 17h; depois, no próximo dia útil até 17h. Agora, um aceite pagaria até ${fmt.datetime(pg.limite)}${pg.mesmoDia ? ' (hoje).' : '.'}`],
      acts: [{ label: 'Ver relógio no painel demo', run: () => { close(); C.shell.openDemo(); } }] };
  }
  /** a trilha é de todos; cada perfil só vê o que é da sua empresa (e lances só o próprio financiador, que são anônimos para os demais) */
  function eventoVisivel(e, ctx) {
    if (ctx.key === 'subparceiro') {
      const ent0 = e.entidade || {};
      if (ent0.kind !== 'premiacao') return false;
      const p0 = db.get('premiacoes', ent0.id);
      return !!p0 && p0.subId === ctx.user.subId;
    }
    if (ctx.role === 'ops') return true;
    const orgId = ctx.org.id; const ent = e.entidade || {}; const u = e.actor ? db.get('users', e.actor.id) : null;
    if (/^lance\./.test(e.acao)) return ctx.role === 'financiador' && !!u && u.orgId === orgId;
    if (ent.kind === 'org') return ent.id === orgId;
    if (ent.kind === 'operacao') {
      const op = db.get('operacoes', ent.id); if (!op) return false;
      if (op.cedenteId === orgId || op.financiadorId === orgId) return true;
      if (ctx.role === 'sacado') return op.tituloIds.some((id) => { const t = db.get('titulos', id); return t && t.sacadoId === orgId; });
      if (ctx.role === 'originador') return (db.get('orgs', op.cedenteId) || {}).indicadoPor === orgId;
      return false;
    }
    if (ent.kind === 'titulo') { const t = db.get('titulos', ent.id); return !!t && (t.orgId === orgId || t.sacadoId === orgId); }
    if (ent.kind === 'lote') { const l = db.get('lotes', ent.id); return !!l && l.cedenteId === orgId; }
    if (ent.kind === 'extrato') { const x = db.get('extrato', ent.id); return !!x && x.orgId === orgId; }
    return !!u && u.orgId === orgId;
  }
  function intentHoje(ctx) {
    const start = day(C.clock.now());
    const mine = notifyMine(ctx).slice(0, 6);
    const evs = ledger.all().filter((e) => e.ts >= start && eventoVisivel(e, ctx)).slice(-8).reverse();
    const items = evs.map((e) => `${fmt.time(e.ts)} · ${e.resumo}`);
    const nEv = fmt.plural(items.length, 'evento', 'eventos');
    return { nodes: [items.length ? `Desde 0h da simulação: ${nEv} na trilha${ctx.role === 'ops' ? '' : ' da sua conta'}.` : 'Nada novo na trilha desde 0h da simulação.',
      items.length ? h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, items.slice(0, 6).map((t) => h('li.small', t))) : null,
      mine.length ? `Você tem ${fmt.plural(mine.length, 'notificação não lida', 'notificações não lidas')}.` : null].filter(Boolean),
      acts: mine.length ? [{ label: 'Ver notificações', primary: true, route: '/' + ctx.role + '/notificacoes' }] : [{ label: 'Ir para o início', route: C.homeFor(ctx.me) }] };
  }
  function notifyMine(ctx) { try { return C.store.notify.mine().filter((x) => !x.lida); } catch (e) { return []; } }
  const GLOSS = [
    [/desagio/, ['Deságio', 'Desconto aplicado sobre o valor de face, proporcional à taxa e ao prazo. É de onde saem o líquido do cedente, a TS e o retorno do financiador.']],
    [/\bcet\b/, ['CET', 'Custo Efetivo Total ao mês: quanto o desconto pesa sobre o líquido, anualizado pelo prazo. Compare operações pelo CET, não só pela taxa.']],
    [/\bts\b|taxa de servico/, ['TS (taxa de serviço)', 'Remuneração da Cedy, paga pelo financiador: % do spread sobre a SELIC (20 a 40% conforme o programa), com piso de R$ 15 ou 0,08% a.m. Fatura mensal por boleto, vence em +10 dias.']],
    [/regresso/, ['Regresso', 'Regra: se o sacado não paga, o cedente recompra o título (saldo + multa de 2% + mora de 1% a.m.). O Premium só admite com regresso. Sem regresso, o risco é todo do financiador.']],
    [/\blar\b|limite de antecip/, ['LAR', 'Limite de Antecipação de Recebíveis. Meses 1 a 3: 80% de (faturamento/365 × prazo médio). Depois: pelos depósitos de sacados dos últimos 90 dias.']],
    [/recurso livre/, ['Recurso Livre', 'Sobra de um pagamento maior que o saldo aberto: fica liberada para o cedente movimentar, sem retenção.']],
    [/firmeza|firme/, ['Firmeza (3h)', 'Após dar um lance, o financiador só pode retirá-lo depois de 3 horas. Evita piscar oferta no leilão.']],
  ];
  function intentGloss(n) {
    const g = GLOSS.find(([re]) => re.test(n));
    if (!g) {
      return { nodes: ['Glossário rápido: deságio (desconto sobre a face), CET (custo efetivo ao mês), TS (taxa de serviço paga pelo financiador), regresso (recompra pelo cedente se o sacado não pagar), LAR (seu limite de antecipação), Recurso Livre (sobra liberada ao cedente) e firmeza (lance firme por 3h).'],
        acts: [{ label: 'Perguntar um termo', run: () => send('O que é regresso?') }] };
    }
    return say(`${g[1][0]}: ${g[1][1]}`);
  }
  function intentAjuda(ctx) {
    return { nodes: [`Sou o assistente da Cedy, ${ctx.user.nome.split(' ')[0]}. Respondo com números reais da sua conta (${orgName(ctx.org.id)}, perfil ${ctx.user.perfil}). Escolha um atalho:`],
      acts: CHIPS[ctx.key].map((c) => ({ label: c.length > 34 ? c.slice(0, 34) + '…' : c, run: () => send(c) })) };
  }
  /* --------------------------------- cedente ------------------------------- */
  function cedenteRoute(n, ctx) {
    const orgId = ctx.org.id;
    const myOps = db.where('operacoes', (o) => o.cedenteId === orgId);
    if (/receber.*semana|a receber|recebo/.test(n)) {
      const sev = db.where('titulos', (t) => t.orgId === orgId && t.status === 'cedido' && inWeek(t.vencimento));
      const tot = C.round2(C.sum(sev, (t) => t.valor));
      const rl = db.where('extrato', (x) => x.orgId === orgId && x.status === 'recurso_livre');
      return { nodes: [`Esta semana ${sev.length === 1 ? 'vence' : 'vencem'} ${fmt.plural(sev.length, 'título cedido', 'títulos cedidos')}, somando ${fmt.brl(tot)}. O crédito cai na sua conta de liquidação e a conciliação distribui aos financiadores; sobra vira Recurso Livre${rl.length ? ` (você tem ${fmt.plural(rl.length, 'linha liberada', 'linhas liberadas')}).` : '.'}`],
        acts: [{ label: 'Ver conta e recebimentos', primary: true, route: '/cedente/conta' }, { label: 'Ver títulos', route: '/cedente/titulos' }] };
    }
    if (/proximos? vencimento|vencimento/.test(n)) {
      const nx = db.where('titulos', (t) => t.orgId === orgId && ['cedido', 'em_operacao', 'disponivel'].includes(t.status) && t.vencimento >= C.clock.now()).sort((a, b) => a.vencimento - b.vencimento).slice(0, 5);
      if (!nx.length) return say('Nenhum título a vencer na sua carteira.', [{ label: 'Ver títulos', route: '/cedente/titulos' }]);
      return { nodes: [`Seus próximos vencimentos:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, nx.map((t) => h('li.small', `${t.numero} · ${orgName(t.sacadoId)} · ${fmt.brl(t.valor)} · vence ${fmt.date(t.vencimento)} (${ui.statusLabel('titulo', t.status)})`)))],
        acts: [{ label: 'Ver títulos', primary: true, route: '/cedente/titulos' }] };
    }
    if (/atencao|pendencia|precisa|ponto critico|falta/.test(n)) {
      const pend = [];
      db.where('lotes', (l) => l.cedenteId === orgId && l.status === 'recusado').slice(-2).forEach((l) => pend.push(`Lote ${l.id} recusado: ${l.motivo || 'ver motivo no detalhe'}`));
      db.where('operacoes', (o) => o.cedenteId === orgId && o.status === 'cessao').forEach((o) => pend.push(`${o.id} aguardando assinatura da cessão`));
      db.where('operacoes', (o) => o.cedenteId === orgId && o.status === 'aberta' && !E.melhorLance(o.id)).forEach((o) => pend.push(`${o.id} em leilão sem ofertas`));
      db.where('operacoes', (o) => o.cedenteId === orgId && o.recompra && o.recompra.status === 'devida').forEach((o) => pend.push(`${o.id} com recompra devida de ${fmt.brl(o.recompra.valor)}`));
      db.where('extrato', (x) => x.orgId === orgId && x.status === 'pendente_mesa').forEach((x) => pend.push(`Crédito de ${fmt.brl(x.valor)} na Mesa Conciliadora`));
      if (!pend.length) return say('Nada urgente: sem lotes recusados, cessões pendentes, leilões vazios ou recompras devidas.', [{ label: 'Ver início', route: '/cedente' }]);
      return { nodes: [`O que precisa da sua atenção agora:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, pend.slice(0, 6).map((t) => h('li.small', t)))],
        acts: [{ label: 'Ver operações', primary: true, route: '/cedente/operacoes' }] };
    }
    if (/melhor oferta|melhor taxa|oferta agora/.test(n)) {
      const abertas = myOps.filter((o) => o.status === 'aberta');
      const comLance = abertas.map((o) => ({ o, m: E.melhorLance(o.id) })).filter((x) => x.m);
      if (!comLance.length) return say(abertas.length ? 'Suas operações abertas ainda não receberam ofertas. O mercado simulado responde em minutos.' : 'Você não tem operações em leilão agora.', [{ label: 'Ver operações', route: '/cedente/operacoes' }]);
      comLance.sort((a, b) => a.m.taxaAm - b.m.taxaAm);
      const top = comLance[0]; const met = E.metricasOp(top.o, top.m.taxaAm); const sug = E.ia.sugerirTaxa(top.o);
      return { nodes: [`A melhor oferta agora é ${fmt.taxa(top.m.taxaAm)} em ${top.o.id} (líquido ${fmt.brl(met.liquido)}).`,
          ui.callout({ tone: 'ai', title: 'Agente de precificação', text: [ui.ai('Sugestão'), ` Teto sugerido de ${fmt.taxa(sug.sugerida)} (faixa ${fmt.taxa(sug.faixa[0])} a ${fmt.taxa(sug.faixa[1])}, ${sug.amostra} operações na amostra). O aceite e o teto são decisões suas.`] })],
        acts: [{ label: 'Abrir ' + top.o.id, primary: true, icon: 'arrow-right', route: opRoute(top.o) }] };
    }
    if (/disponivel|antecipar|quanto posso|lar\b|limite/.test(n)) {
      const disp = db.where('titulos', (t) => t.orgId === orgId && t.status === 'disponivel');
      const lar = E.lar(orgId);
      const tot = C.round2(C.sum(disp, (t) => t.valor));
      return { nodes: [`Você tem ${disp.length} títulos disponíveis somando ${fmt.brl(tot)}. Seu LAR: limite ${fmt.brl(lar.limite)}, em uso ${fmt.brl(lar.exposicao)}, disponível ${fmt.brl(lar.disponivel)} (${lar.fase === 'inicial' ? 'fase inicial, meses 1 a 3' : 'fase por depósitos'}).`],
        acts: [{ label: 'Ver títulos disponíveis', primary: true, route: '/cedente/titulos' }, { label: 'Ver limites', route: '/cedente/limites' }] };
    }
    if (/corte|14h30|14:30/.test(n)) {
      const pg = E.prazoPagamento(C.clock.now());
      return say(`O corte é 14h30 em dia útil. Aceites até esse horário: pagamento no mesmo dia até 17h. Depois: próximo dia útil até 17h. Agora, um aceite pagaria até ${fmt.datetime(pg.limite)}${pg.mesmoDia ? ' (hoje).' : '.'}`);
    }
    if (/recusad|lote /.test(n) && /recus|motivo|por que|porque/.test(n)) return intentLoteRecusado(ctx);
    if (/recus/.test(n)) return intentLoteRecusado(ctx);
    return null;
  }
  function intentLoteRecusado(ctx) {
    const lotes = db.where('lotes', (l) => l.cedenteId === ctx.org.id && l.status === 'recusado').sort((a, b) => b.criadoEm - a.criadoEm);
    if (!lotes.length) return say('Nenhum lote recusado na sua conta. Os lotes em validação aparecem com o motivo da Mesa.', [{ label: 'Ver títulos', route: '/cedente/titulos' }]);
    const l = lotes[0];
    const tit = (l.titulos || []).map((id) => db.get('titulos', id)).filter(Boolean);
    const erros = tit.flatMap((t) => (t.flags || []).filter((f) => f.nivel === 'erro').map((f) => `${t.numero}: ${f.msg}`));
    return { nodes: [`O lote ${l.id} foi recusado${l.motivo ? ': ' + l.motivo : '.'}`, erros.length ? h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, erros.slice(0, 5).map((t) => h('li.small', t))) : null].filter(Boolean),
      acts: [{ label: 'Ver títulos', primary: true, route: '/cedente/titulos' }] };
  }

  /* ------------------------------- financiador ---------------------------- */
  function finRoute(n, ctx) {
    const orgId = ctx.org.id;
    if (/oportunidade|cabe.*politica|onde investir|cabem/.test(n)) {
      const abertas = db.where('operacoes', (o) => o.status === 'aberta' && (o.canal === 'vitrine' || o.financiadorAlvoId === orgId));
      const scored = abertas.map((o) => ({ o, p: E.checarPolitica(orgId, o, (E.melhorLance(o.id) || { taxaAm: 1.9 }).taxaAm), par: E.ia.parecer(o, orgId) })).filter((x) => x.p.ok).sort((a, b) => b.par.score - a.par.score).slice(0, 3);
      if (!scored.length) return say('Nenhuma operação aberta cabe na sua política agora. Ajuste ticket, prazo ou limites na política de crédito.', [{ label: 'Ver política', route: '/financiador/politica' }]);
      return { nodes: [`${scored.length} oportunidades cabem na sua política:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, scored.map((x) => h('li.small', `${x.o.id} · ${fmt.brl(x.o.face)} · score ${x.par.score}, taxa sugerida ${fmt.taxa(x.par.taxaSugerida)} · pior rating ${x.par.pior}`)))],
        acts: scored.map((x, i) => ({ label: (i === 0 ? 'Abrir ' : '') + x.o.id, primary: i === 0, route: '/financiador/operacoes/' + x.o.id })) };
    }
    if (/exposicao/.test(n)) {
      const ops = db.where('operacoes', (o) => o.financiadorId === orgId && ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'].includes(o.status));
      const porCed = {};
      ops.forEach((o) => o.tituloIds.forEach((id) => { const t = db.get('titulos', id); if (!t || ['liquidado', 'recomprado'].includes(t.status)) return; porCed[o.cedenteId] = (porCed[o.cedenteId] || 0) + t.valor; }));
      const porSac = {};
      ops.forEach((o) => o.tituloIds.forEach((id) => { const t = db.get('titulos', id); if (!t || ['liquidado', 'recomprado'].includes(t.status)) return; porSac[t.sacadoId] = (porSac[t.sacadoId] || 0) + t.valor; }));
      const tot = C.round2(C.sum(Object.values(porCed)));
      const top = Object.entries(porSac).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ label: orgName(k), value: C.round2(v), tone: 'teal' }));
      return { nodes: [`Sua exposição ativa soma ${fmt.brl(tot)} em ${ops.length} operações.`, top.length ? C.ui.chart.hbars(top, { format: (v) => fmt.brlCompact(v) }) : null].filter(Boolean),
        acts: [{ label: 'Ver carteira', primary: true, route: '/financiador/carteira' }] };
    }
    if (/vence.*semana|vencimento/.test(n)) {
      const ops = db.where('operacoes', (o) => o.financiadorId === orgId && ['aguardando_pagamento', 'paga', 'parcial'].includes(o.status));
      const sev = ops.filter((o) => o.tituloIds.some((id) => { const t = db.get('titulos', id); return t && !['liquidado', 'recomprado'].includes(t.status) && inWeek(t.vencimento); }));
      const tot = C.round2(C.sum(sev, (o) => E.saldoAberto(o)));
      return say(sev.length ? `${fmt.plural(sev.length, 'operação vence', 'operações vencem')} esta semana, com saldo em aberto de ${fmt.brl(tot)}: ${sev.slice(0, 4).map((o) => o.id).join(', ')}.` : 'Nada vencendo esta semana na sua carteira.', [{ label: 'Ver carteira', route: '/financiador/carteira' }]);
    }
    if (/vencida|regresso|recompra/.test(n)) {
      const venc = db.where('operacoes', (o) => o.financiadorId === orgId && ['vencida', 'parcial'].includes(o.status));
      if (!venc.length) return say('Nenhuma operação vencida na sua carteira.', [{ label: 'Ver carteira', route: '/financiador/carteira' }]);
      const com = venc.filter((o) => o.regressoAcionado).length;
      return { nodes: [`${fmt.plural(venc.length, 'operação vencida', 'operações vencidas')}, saldo ${fmt.brl(C.round2(C.sum(venc, (o) => E.saldoAberto(o))))}. Regresso acionado em ${com}. ${venc.some((o) => !o.regresso) ? 'Atenção: há operação sem regresso.' : venc.length === 1 ? 'Ela tem regresso.' : 'Todas têm regresso.'}`],
        acts: venc.slice(0, 2).map((o) => ({ label: o.id, route: '/financiador/operacoes/' + o.id })) };
    }
    if (/\bts\b|taxa de servico|fatura/.test(n)) {
      const t = C.cal.sp(C.clock.now());
      const ops = db.where('operacoes', (o) => o.financiadorId === orgId && o.pagoEm && C.cal.sp(o.pagoEm).y === t.y && C.cal.sp(o.pagoEm).m === t.m);
      const tot = C.round2(C.sum(ops, (o) => o.ts));
      const fat = db.all('faturas').find((f) => f.finId === orgId && f.competencia === `${t.y}-${String(t.m).padStart(2, '0')}`);
      return say(`${ops.length} operações pagas em ${fmt.monthLong(`${t.y}-${String(t.m).padStart(2, '0')}`)}, TS de ${fmt.brl(tot)}.${fat ? ` Fatura ${fat.id}: total ${fmt.brl(fat.total)} (${ui.statusLabel('fatura', fat.status)}).` : ''}`, [{ label: 'Ver faturamento', primary: true, route: '/financiador/faturamento' }]);
    }
    if (/perdendo|lance|superad/.test(n)) {
      const meus = db.where('lances', (l) => l.finId === orgId && ['superado', 'perdido'].includes(l.status)).sort((a, b) => b.criadoEm - a.criadoEm).slice(0, 4);
      if (!meus.length) return say('Você não perdeu lances recentemente. Suas ofertas ativas seguem líderes.', [{ label: 'Ver meus lances', route: '/financiador/carteira' }]);
      return { nodes: [`Você foi superado ou perdeu em ${fmt.plural(meus.length, 'oferta recente', 'ofertas recentes')}:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, meus.map((l) => h('li.small', `${l.opId} · sua oferta ${fmt.taxa(l.taxaAm)} · agora ${ui.statusLabel('lance', l.status)}`)))],
        acts: [{ label: 'Ver meus lances', primary: true, route: '/financiador/carteira' }] };
    }
    return null;
  }

  function intentOp(opm, ctx) {
    const num = opm[1].padStart(4, '0');
    const op = db.get('operacoes', 'OP-26-' + num) || db.all('operacoes').find((o) => norm(o.id).includes(num));
    if (op && ctx.key === 'subparceiro') return say('Subparceiros acompanham status e volume dos indicados, não o detalhe das operações.', [{ label: 'Ver meus indicados', route: '/originador/indicados' }]);
    if (!op || !opVisivel(op, ctx)) return say(`Não encontrei operação com final ${num}. Confira o número na lista de operações.`, [{ label: 'Ver operações', route: C.homeFor(ctx.me) }]);
    const m = op.taxaFinal ? E.metricasOp(op, op.taxaFinal) : null;
    return { nodes: [`Operação ${op.id} (${ui.statusLabel('operacao', op.status)}), face ${fmt.brl(op.face)}:`, ui.kv([['Status', ui.statusLabel('operacao', op.status)], ['Face', fmt.brl(op.face)], ['Taxa', op.taxaFinal ? fmt.taxa(op.taxaFinal) : 'em leilão'], ['Líquido', m ? fmt.brl(m.liquido) : '—']])],
      acts: [{ label: 'Abrir ' + op.id, primary: true, icon: 'arrow-right', route: opRoute(op) }] };
  }

  /* ------------------------------ originador ----------------------------- */
  function origRoute(n, ctx) {
    const myId = ctx.org.id;
    if (/premia|pagamento|receber|quanto/.test(n)) {
      const t = C.cal.sp(C.clock.now());
      const comp = `${t.y}-${String(t.m).padStart(2, '0')}`;
      const list = db.where('premiacoes', (p) => p.origId === myId).sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
      const cur = list.find((p) => p.competencia === comp) || list[0];
      if (!cur) return say('Ainda não há premiação apurada para sua carteira.', [{ label: 'Ver premiação', route: '/originador/premiacao' }]);
      return { nodes: [`Competência ${fmt.monthLong(cur.competencia)}: indicação ${fmt.brl(cur.indicacao)} + gestão ${fmt.brl(cur.gestao)} = ${fmt.brl(cur.total)} (${ui.statusLabel('premio', cur.status)}${cur.pagamentoEm ? ', pagamento em ' + fmt.date(cur.pagamentoEm) : ''}). Mínimo de R$ 100 para pagar; abaixo disso fica retido.`],
        acts: [{ label: 'Ver premiação', primary: true, route: '/originador/premiacao' }] };
    }
    if (/inativo|indicado|parado/.test(n)) {
      const cutoff = C.clock.now() - 90 * 86400000;
      const semResp = db.where('convites', (c) => c.origId === myId && ['convidado', 'recusado', 'inativo'].includes(c.status) && c.enviadoEm < cutoff);
      const ceds = db.where('orgs', (o) => o.indicadoPor === myId && o.status === 'ativo');
      const parados = ceds.filter((o) => !db.where('operacoes', (op) => op.cedenteId === o.id && op.pagoEm && op.pagoEm >= cutoff).length);
      return { nodes: [`${fmt.plural(parados.length, 'indicado ativo sem operação paga há 90 dias', 'indicados ativos sem operação paga há 90 dias')}${semResp.length ? ` e ${fmt.plural(semResp.length, 'convite sem resposta', 'convites sem resposta')} há 90 dias ou mais` : ''}: ${(parados.slice(0, 4).map((o) => o.fantasia || o.nome).concat(semResp.slice(0, 2).map((c) => c.nome))).join(', ') || '—'}. Perde a gestão (30%) se o indicado ficar 90 dias sem operar.`],
        acts: [{ label: 'Ver indicados', primary: true, route: '/originador/indicados' }, { label: 'Ver convites', route: '/originador/convites' }] };
    }
    if (/janela|24 meses/.test(n)) {
      return say('A janela é de 24 meses desde a 1ª operação paga de cada indicado: 10% da TS como indicação + 30% como gestão (cedente ativo = 1 operação em 90 dias). Relatório no 5º dia útil, contestação em 10 dias, pagamento dia 20 do mês seguinte, mínimo de R$ 100.', [{ label: 'Ver premiação', route: '/originador/premiacao' }]);
    }
    return null;
  }

  /** a operação só aparece para quem é parte dela (ou para a Cedy) */
  function opVisivel(op, ctx) {
    const id = ctx.org.id; const k = ctx.key;
    if (k === 'ops' || k === 'superadmin') return true;
    if (k === 'cedente') return op.cedenteId === id;
    if (k === 'financiador') return op.financiadorId === id || (op.status === 'aberta' && (op.canal === 'vitrine' || op.financiadorAlvoId === id));
    if (k === 'sacado') return op.tituloIds.some((tid) => { const t = db.get('titulos', tid); return !!t && t.sacadoId === id; });
    if (k === 'originador') return (db.get('orgs', op.cedenteId) || {}).indicadoPor === id;
    return false;
  }

  /* ------------------------------- subparceiro ----------------------------- */
  function subRoute(n, ctx) {
    const sid = ctx.user.subId; const sp = sid && db.get('subparceiros', sid);
    if (!sp) return say('Sua conta não está ligada a nenhum subparceiro. Fale com o seu originador.', [{ label: 'Ir para o início', route: C.homeFor(ctx.me) }]);
    const prem = db.where('premiacoes', (p) => p.subId === sid).sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
    const repassado = (p) => !!(p.repasseSub && p.repasseSub.status === 'repassado');
    if (/split|como.*comissao|como funciona/.test(n)) {
      return say(`Seu split é ${sp.splitPct}% da premiação dos seus indicados. Ele fica congelado em cada competência: mudar o percentual vale só para as próximas. O repasse é feito pelo seu originador, não pela Cedy.`, [{ label: 'Ver minha premiação', primary: true, route: '/originador/premiacao' }]);
    }
    if (/repass|falta|pendente/.test(n)) {
      const pend = prem.filter((p) => p.parteSub > 0 && !repassado(p));
      const tot = C.round2(C.sum(pend, (p) => p.parteSub));
      if (!pend.length) return say('Nada pendente: o originador já repassou todas as competências com comissão.', [{ label: 'Ver minha premiação', route: '/originador/premiacao' }]);
      return { nodes: [`${fmt.plural(pend.length, 'competência aguarda', 'competências aguardam')} repasse do originador, somando ${fmt.brl(tot)}:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, pend.slice(0, 5).map((p) => h('li.small', `${fmt.monthLong(p.competencia)} · ${fmt.brl(p.parteSub)}`)))],
        acts: [{ label: 'Ver minha premiação', primary: true, route: '/originador/premiacao' }] };
    }
    if (/comissao|premia|receber|quanto/.test(n)) {
      const t = C.cal.sp(C.clock.now());
      const comp = `${t.y}-${String(t.m).padStart(2, '0')}`;
      const cur = prem.find((p) => p.competencia === comp) || prem[0];
      if (!cur) return say('Ainda não há comissão apurada para os seus indicados.', [{ label: 'Ver minha premiação', route: '/originador/premiacao' }]);
      return { nodes: [`Competência ${fmt.monthLong(cur.competencia)}: sua comissão é ${fmt.brl(cur.parteSub || 0)} (${sp.splitPct}% da premiação dos seus indicados), repasse ${repassado(cur) ? 'feito' : 'pendente'}.`],
        acts: [{ label: 'Ver minha premiação', primary: true, route: '/originador/premiacao' }] };
    }
    if (/parado|inativo|indicado/.test(n)) {
      const cutoff = C.clock.now() - 90 * 86400000;
      const ceds = db.where('orgs', (o) => o.indicadoPor === ctx.org.id && o.subparceiroId === sid && o.status === 'ativo');
      const parados = ceds.filter((o) => !db.where('operacoes', (op) => op.cedenteId === o.id && op.pagoEm && op.pagoEm >= cutoff).length);
      return { nodes: [parados.length ? `${fmt.plural(parados.length, 'indicado seu está', 'indicados seus estão')} sem operação paga há 90 dias: ${parados.slice(0, 4).map((o) => o.fantasia || o.nome).join(', ')}. Sem atividade, a gestão deixa de render.` : 'Todos os seus indicados ativos operaram nos últimos 90 dias.'],
        acts: [{ label: 'Ver meus indicados', primary: true, route: '/originador/indicados' }] };
    }
    return null;
  }

  /* -------------------------------- superadmin ----------------------------- */
  function superRoute(n, ctx) {
    const nomeDe = (uid) => (db.get('users', uid) || {}).nome || 'alguém';
    if (/aprovac|quatro olhos/.test(n)) {
      const pend = db.where('aprovacoes', (a) => a.status === 'pendente').sort((a, b) => a.expiraEm - b.expiraEm);
      if (!pend.length) return say('Nenhuma aprovação pendente.', [{ label: 'Ver aprovações', route: '/super/aprovacoes' }]);
      const minhas = pend.filter((a) => a.solicitanteId === ctx.user.id).length;
      return { nodes: [`${fmt.plural(pend.length, 'aprovação aguarda', 'aprovações aguardam')} decisão${minhas ? ` (${fmt.plural(minhas, 'foi pedida por você e precisa de outro Superadmin', 'foram pedidas por você e precisam de outro Superadmin')})` : ''}:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, pend.slice(0, 5).map((a) => h('li.small', `${a.titulo} · pedida por ${nomeDe(a.solicitanteId)} · expira ${fmt.rel(a.expiraEm)}`)))],
        acts: [{ label: 'Decidir aprovações', primary: true, route: '/super/aprovacoes' }] };
    }
    if (/incidente|servico|saude|degrad|fora do ar/.test(n)) {
      const inc = db.where('incidentes', (i) => i.status !== 'resolvido');
      const prob = db.where('servicos', (s) => s.status !== 'operacional');
      if (!inc.length && !prob.length) return say('Tudo operacional: sem incidentes abertos e sem serviços degradados.', [{ label: 'Ver saúde', route: '/super' }]);
      return { nodes: [`${fmt.plural(inc.length, 'incidente aberto', 'incidentes abertos')} e ${fmt.plural(prob.length, 'serviço com problema', 'serviços com problema')}.`,
        h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, [...inc.slice(0, 3).map((i) => h('li.small', `${i.id} (${i.severidade}): ${i.titulo}`)), ...prob.slice(0, 3).map((s) => h('li.small', `${s.nome}: ${s.status}`))])],
        acts: [{ label: 'Ver incidentes', primary: true, route: '/super/incidentes' }, { label: 'Ver serviços', route: '/super/servicos' }] };
    }
    if (/custo|gasto|teto|orcamento/.test(n) && /ia|modelo|token|custo/.test(n)) {
      const t = C.cal.sp(C.clock.now()); const ini = C.cal.spTs(t.y, t.m, 1, 0, 0);
      const fim = C.cal.spTs(t.m === 12 ? t.y + 1 : t.y, t.m === 12 ? 1 : t.m + 1, 1, 0, 0);
      const custo = C.round2(C.sum(db.where('usoIA', (u) => u.dia >= ini && u.dia < fim), (u) => u.custoBRL));
      const teto = (db.cfg().ia || {}).tetoCustoMesBRL || 4000;
      return say(`O custo de IA no mês é ${fmt.brl(custo)} de um teto de ${fmt.brl(teto)} (${fmt.pct(custo / teto * 100, 0)}). Acima do teto, o gateway usa a fila e o modelo local antes de chamar o modelo pago.`, [{ label: 'Ver IA e agentes', primary: true, route: '/super/ia' }]);
    }
    if (/mercado|manutencao|pausa|funcionalidade|flag/.test(n)) {
      const cfg = db.cfg(); const off = Object.entries(cfg.flags || {}).filter(([, v]) => v === false).map(([k]) => k);
      return { nodes: [[cfg.mercadoPausado ? 'O mercado está pausado: lances e publicações estão suspensos.' : 'O mercado está aberto.', cfg.manutencao && cfg.manutencao.ativo ? 'A faixa de manutenção está ativa.' : 'Sem faixa de manutenção.', off.length ? `Funcionalidades desligadas: ${off.join(', ')}.` : 'Todas as funcionalidades estão ligadas.'].join(' ')],
        acts: [{ label: 'Ver mercado', primary: true, route: '/super/mercado' }] };
    }
    if (/backup|rpo|restaur/.test(n)) {
      const ok = db.all('backups').filter((b) => ['ok', 'verificado'].includes(b.status)).sort((a, b) => b.ts - a.ts)[0];
      if (!ok) return say('Não há backup íntegro registrado.', [{ label: 'Ver backups', route: '/super/backups' }]);
      return say(`O último backup íntegro é de ${fmt.datetime(ok.ts)} (${fmt.rel(ok.ts)}, ${ok.tipo}). A meta de RPO é de 8 h.`, [{ label: 'Ver backups', primary: true, route: '/super/backups' }]);
    }
    if (/lgpd|titular|privacidade/.test(n)) {
      const ab = db.where('titulares', (x) => ['recebida', 'em_analise'].includes(x.status)).sort((a, b) => a.prazoAte - b.prazoAte);
      if (!ab.length) return say('Nenhum pedido de titular aberto.', [{ label: 'Ver LGPD', route: '/super/lgpd' }]);
      const TIPOS = { acesso: 'acesso', correcao: 'correção', exclusao: 'exclusão', portabilidade: 'portabilidade', revogacao: 'revogação', oposicao: 'oposição' };
      const venc = ab.filter((x) => x.prazoAte < C.clock.now()).length;
      return { nodes: [`${fmt.plural(ab.length, 'pedido de titular aberto', 'pedidos de titular abertos')}${venc ? `, ${fmt.plural(venc, 'com prazo vencido', 'com prazo vencido')}` : ''}. O mais urgente é ${ab[0].id} (${TIPOS[ab[0].tipo] || ab[0].tipo}), ${ab[0].prazoAte < C.clock.now() ? 'vencido' : 'vence'} ${fmt.rel(ab[0].prazoAte)}.`],
        acts: [{ label: 'Ver LGPD', primary: true, route: '/super/lgpd' }] };
    }
    if (/seguranca|acesso|login|2fa|ataque/.test(n)) {
      const sem = C.clock.now() - 7 * 86400000;
      const falhas = db.where('eventosSeg', (e) => e.tipo === 'login_falho' && e.ts >= sem).length;
      const bloq = db.where('eventosSeg', (e) => e.tipo === 'ip_bloqueado' && e.ts >= sem).length;
      const equipe = db.where('users', (u) => u.orgId === 'org-cedy');
      const sem2fa = equipe.filter((u) => u.twofa === false).length;
      return { nodes: [`Em 7 dias: ${fmt.plural(falhas, 'login com falha', 'logins com falha')} e ${fmt.plural(bloq, 'IP bloqueado', 'IPs bloqueados')}. ${sem2fa ? `${fmt.plural(sem2fa, 'usuário da equipe está', 'usuários da equipe estão')} sem segundo fator.` : 'Toda a equipe tem segundo fator.'}`],
        acts: [{ label: 'Ver segurança', primary: true, route: '/super/seguranca' }] };
    }
    return null;
  }

  /* --------------------------------- sacado ------------------------------ */
  function sacRoute(n, ctx) {
    const orgId = ctx.org.id;
    if (/pago.*semana|pagar|o que pago|venc/.test(n)) {
      const sev = db.where('titulos', (t) => t.sacadoId === orgId && inWeek(t.vencimento) && !['liquidado', 'recomprado'].includes(t.status));
      const tot = C.round2(C.sum(sev, (t) => t.valor));
      if (!sev.length) return say('Nada vencendo esta semana para sua empresa.', [{ label: 'Ver títulos', route: '/sacado/titulos' }]);
      return { nodes: [`Esta semana: ${fmt.plural(sev.length, 'título', 'títulos')}, ${fmt.brl(tot)}.`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, sev.slice(0, 5).map((t) => h('li.small', `${t.numero} · ${orgName(t.orgId)} · ${fmt.brl(t.valor)} · vence ${fmt.date(t.vencimento)}`)))],
        acts: [{ label: 'Ver títulos a pagar', primary: true, route: '/sacado/titulos' }] };
    }
    if (/confirm|aguardando|pendente/.test(n)) {
      const pend = db.where('titulos', (t) => t.sacadoId === orgId && ((t.lastro && t.lastro.aceiteSacado === 'pendente') || (t.flags || []).some((f) => f.codigo === 'AGUARDA_SACADO')));
      if (!pend.length) return say('Nenhum título aguardando sua confirmação.', [{ label: 'Ver títulos', route: '/sacado/titulos' }]);
      return { nodes: [`${fmt.plural(pend.length, 'título aguarda', 'títulos aguardam')} sua confirmação (programa Confia):`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, pend.slice(0, 5).map((t) => h('li.small', `${t.numero} · ${orgName(t.orgId)} · ${fmt.brl(t.valor)}`)))],
        acts: [{ label: 'Confirmar títulos', primary: true, route: '/sacado/titulos' }] };
    }
    if (/para quem|onde pago|conta|quem/.test(n)) {
      const ops = db.where('operacoes', (o) => ['paga', 'parcial'].includes(o.status) && o.tituloIds.some((id) => { const t = db.get('titulos', id); return t && t.sacadoId === orgId && !['liquidado', 'recomprado'].includes(t.status); })).slice(0, 3);
      if (!ops.length) return say('Nenhum pagamento pendente: seus títulos liquidados aparecem no extrato.', [{ label: 'Ver pagamentos', route: '/sacado/pagamentos' }]);
      return { nodes: [`Você paga na conta de liquidação de cada cedente (a Cedy não recebe por você):`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, ops.map((o) => { const c = db.get('orgs', o.cedenteId); return h('li.small', `${o.id} · ${(c && (c.fantasia || c.nome)) || ''} · ${c && c.contaLiquidacao ? `${c.contaLiquidacao.banco}, ag. ${c.contaLiquidacao.agencia}` : ''}`); }))],
        acts: [{ label: 'Ver pagamentos', primary: true, route: '/sacado/pagamentos' }] };
    }
    return null;
  }

  /* ----------------------------------- ops ------------------------------- */
  function opsRoute(n, ctx) {
    if (/fila|sla/.test(n)) {
      const lotes = db.where('lotes', (l) => l.status === 'validando');
      const casos = db.where('casosMesa', (c) => c.status === 'aberto');
      const kyc = db.where('kyc', (k) => ['em_analise', 'pendencia'].includes(k.status));
      const sla = (ts) => { const ms = ts - C.clock.now(); return ms <= 0 ? 'SLA estourado' : 'SLA em ' + fmt.dur(ms); };
      return { nodes: [`Filas agora: ${fmt.plural(lotes.length, 'lote', 'lotes')} na Mesa de Operações, ${fmt.plural(casos.length, 'caso', 'casos')} na Conciliadora, ${fmt.plural(kyc.length, 'cadastro', 'cadastros')} em KYC.`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, [...lotes.slice(0, 2).map((l) => h('li.small', `Lote ${l.id} · ${orgName(l.cedenteId)} · ${sla(l.slaAte)}`)), ...casos.slice(0, 2).map((c) => h('li.small', `Caso ${c.id} · ${c.motivo} · ${sla(c.slaAte)}`))])],
        acts: [{ label: 'Abrir Mesa de Operações', primary: true, route: '/ops/mesa' }, { label: 'Abrir Conciliadora', route: '/ops/conciliacao' }, { label: 'Abrir KYC', route: '/ops/kyc' }] };
    }
    if (/critico/.test(n)) {
      const crit = [];
      db.where('orgs', (o) => o.status === 'suspenso').forEach((o) => crit.push(`${o.fantasia || o.nome} suspensa${o.motivoSuspensao ? ': ' + o.motivoSuspensao : ''}`));
      db.where('operacoes', (o) => o.status === 'vencida' && !o.regresso).forEach((o) => crit.push(`${o.id} vencida sem regresso (${fmt.brl(E.saldoAberto(o))})`));
      db.where('faturas', (f) => f.status === 'vencida').forEach((f) => crit.push(`Fatura ${f.id} vencida (${orgName(f.finId)}, ${fmt.brl(f.total)})`));
      if (!crit.length) return say('Nenhum caso crítico agora: sem suspensões, vencidas sem regresso ou faturas vencidas.', [{ label: 'Ver visão geral', route: '/ops' }]);
      return { nodes: [`Casos críticos agora:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, crit.slice(0, 6).map((t) => h('li.small', t)))], acts: [{ label: 'Ver visão geral', primary: true, route: '/ops' }] };
    }
    if (/proposta|agente/.test(n)) {
      const ps = db.where('propostas', (p) => p.status === 'pendente').sort((a, b) => b.confianca - a.confianca);
      if (!ps.length) return say('Nenhuma proposta de agente aguardando decisão.', [{ label: 'Ver agentes', route: '/ops/agentes' }]);
      return { nodes: [`${fmt.plural(ps.length, 'proposta aguarda', 'propostas aguardam')} decisão humana:`, h('ul', { style: 'margin:6px 0 0 16px;list-style:disc' }, ps.slice(0, 4).map((p) => h('li.small', `${(db.get('agentes', p.agenteId) || {}).nome || p.agenteId}: ${p.resumo} (confiança ${Math.round(p.confianca * 100)}%)`)))],
        acts: [{ label: 'Ver agentes', primary: true, route: '/ops/agentes' }] };
    }
    if (/trilha|integridade|auditoria|verificar/.test(n)) {
      const v = ledger.verify();
      return { nodes: [v.ok ? `Trilha íntegra: ${v.count} eventos encadeados por hash, sem quebra.` : `Trilha com quebra no evento ${v.seq} (${v.id}). Não opere até a Mesa revisar.`],
        acts: [{ label: 'Ver trilha', primary: true, route: '/ops/trilha' }] };
    }
    return null;
  }

  /* ------------------------------ abrir/fechar --------------------------- */
  function close() { if (api) { const a = api; api = null; try { a.close(); } catch (e) { /* */ } } }
  function open(seedQuery) {
    const me = session.get();
    if (!me) { ui.toast('Entre primeiro', { type: 'warn', text: 'O assistente precisa de uma conta.' }); return; }
    if (api) { if (seedQuery) send(seedQuery); return; }
    const role = session.role(); const user = session.user();
    listEl = h('div.asst-msgs');
    const chips = h('div.asst-chips', CHIPS[C.shellKey()].map((c) => ui.btn(c.length > 30 ? c.slice(0, 30) + '…' : c, { size: 'sm', onclick: () => send(c), title: c })));
    const inp = ui.input({ placeholder: 'Pergunte sobre sua conta…', aria: 'Pergunta ao assistente', onEnter: (v) => { inputEl.value = ''; send(v); } });
    inputEl = inp;
    const sendBtn = ui.iconBtn('send', { label: 'Enviar pergunta', onclick: () => { const v = String(inputEl.value || '').trim(); inputEl.value = ''; send(v); } });
    api = ui.drawer({ title: 'Assistente Cedy', subtitle: 'Respostas por regras no protótipo, sem modelo de linguagem', icon: 'sparkles', size: 'md',
      headerRight: ui.ai('IA'),
      body: h('div.asst-body', listEl, h('div.asst-dock', chips, h('div.asst-input', inp, sendBtn))),
      onClose: () => { api = null; } });
    loadHist().forEach((en) => {
      const el = h('div', { class: ['asst-msg', en.r === 'user' ? 'user' : 'bot', 'is-restored'] }, en.t || '—');
      if (en.r === 'b') {
        if (en.acts && en.acts.length) el.append(h('div.asst-actions', en.acts.map(actBtn)));
        el.append(h('div.asst-foot', ui.ai('IA'), FOOT));
      }
      listEl.append(el);
    });
    if (!loadHist().length) bubble('b', [`Olá, ${user.nome.split(' ')[0]}. Sou o assistente da Cedy e respondo com os números reais da sua conta. Escolha um atalho ou pergunte:`]);
    scrollEnd();
    setTimeout(() => { const i = inputEl && inputEl.querySelector('input'); if (i) i.focus(); }, 150);
    if (seedQuery) send(seedQuery);
  }
  C.assistant = { open, close };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); if (api) { close(); return; } if (session.get() && !document.querySelector('.layer')) open(); }
  });
  C.store.on(['session'], () => { if (api) close(); });
})();
