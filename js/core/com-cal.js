/* =========================================================================
   Cedy: agente de calibração (8º agente), E.ia.cal.
   Mede indicadores da plataforma e recomenda mudança de parâmetro. Quando há
   evidência suficiente, abre a solicitação já preenchida (antes e depois,
   evidência, efeito esperado) para o Superadmin. Nunca altera parâmetro, nem
   promove ou rebaixa agente: só pessoas aprovam. Regras (D9, CC-47):
   - famílias com agente: atendimento, conciliação, mercado e leilão, programas,
     econômicos, IA e custo; sem agente: segurança e retenção/residência
   - sem amostra mínima não abre pedido; no máximo 1 pedido aberto por parâmetro
     e 3 pedidos novos por semana; recusado só volta com dado novo
   - parâmetro econômico: dois Superadmins distintos, vigência futura, aviso
     prévio aos afetados e reversão registrada na trilha
   ========================================================================= */
(function () {
  const C = window.Cedy; const E = C.engine; const K = E.com; const { db, ledger, notify } = C.store;
  const A = E.actors; const fmt = C.fmt; const now = () => C.clock.now(); const cal = C.cal;
  const DAY = 86400000;
  const CAL = (E.ia.cal = {}); CAL.AGENTE = 'ag-calibracao';
  const fail = (erro, codigo) => ({ ok: false, erro, codigo });

  CAL.FAMILIAS = { atendimento: 'Atendimento', conciliacao: 'Conciliação', mercado: 'Mercado e leilão', programas: 'Programas de produto', economicos: 'Econômicos', ia_custo: 'IA e custo' };
  CAL.PROTEGIDAS = [
    { id: 'seguranca', rotulo: 'Segurança', itens: 'tentativas de login, duração da sessão, senha mínima, 2FA e lista de IP' },
    { id: 'retencao', rotulo: 'Retenção e residência de dados', itens: 'prazos de retenção e residência dos dados no Brasil' },
  ];
  const DEF = { maxPedidosSemana: 3, antecedenciaEconomicaDias: 15, ultimoCicloEm: 0, agendadas: [] };
  CAL.cfg = () => Object.assign({}, DEF, db.cfg().calibracao || {});
  const salvarCfg = (patch) => db.setCfg({ calibracao: Object.assign({}, CAL.cfg(), patch) });

  /* ------------------------------ leitura e escrita de parâmetros ------------------------------ */
  const lerCfg = (caminho) => caminho.reduce((o, k) => (o == null ? o : o[k]), db.cfg());
  /** o setCfg é raso: o patch leva o objeto de topo inteiro, com o valor novo no caminho */
  function patchDe(caminho, valor) {
    if (caminho.length === 1) return { [caminho[0]]: valor };
    const topo = JSON.parse(JSON.stringify(db.cfg()[caminho[0]] || {})); let o = topo;
    caminho.slice(1, -1).forEach((k) => { o = o[k] = o[k] || {}; });
    o[caminho[caminho.length - 1]] = valor; return { [caminho[0]]: topo };
  }
  function gravarValor(p, valor) {
    if (p.produtoId) {
      const prod = db.get('produtos', p.produtoId); if (!prod) return;
      const hist = [{ versao: prod.versao, vigenteDesde: prod.vigenteDesde, tsPct: prod.tsPct, ticketMin: prod.ticketMin, nota: 'Versão anterior à calibração' }, ...(prod.historico || [])];
      db.put('produtos', Object.assign({}, prod, { ticketMin: valor, versao: (prod.versao || 1) + 1, vigenteDesde: now(), historico: hist })); return;
    }
    db.setCfg(patchDe(p.caminho, valor));
  }
  const valorAtual = (p) => (p.produtoId ? (db.get('produtos', p.produtoId) || {}).ticketMin : lerCfg(p.caminho));

  /* ------------------------------ estatística simples ------------------------------ */
  const quantil = (xs, q) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
  const arred = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const num = (v, d = 1) => String(arred(v, d)).replace('.', ',');
  const brl = (v) => fmt.brl(v, { round: true });

  /* ------------------------------ parâmetros monitorados ------------------------------ */
  /** avaliar() devolve {n, atual, sugerido|null, evidencia[], efeito}; sem recomendação quando sugerido é null */
  const PARAMS = [
    { id: 'atend.sla.normal', familia: 'atendimento', rotulo: 'Prazo de primeira resposta, prioridade normal', un: 'h úteis', caminho: ['comunicacao', 'sla', 'normal'], amostraMin: 8, periodo: '30 dias',
      avaliar() {
        const t = now(); const xs = db.where('conversas', (c) => c.tipo === 'chamado' && c.canal === 'cedy' && c.prioridade === 'normal' && c.primeiraRespostaEm && c.criadaEm >= t - 30 * DAY).map((c) => K.minutosUteis(c.criadaEm, c.primeiraRespostaEm) / 60);
        const atual = lerCfg(this.caminho); const p90 = quantil(xs, 0.9); const med = quantil(xs, 0.5); const dentro = xs.filter((h) => h <= atual).length;
        const ev = xs.length ? [`Mediana ${num(med)} h úteis e percentil 90 de ${num(p90)} h úteis`, `${dentro} de ${xs.length} chamados normais respondidos dentro das ${atual} h úteis atuais`] : [];
        let sug = null;
        if (xs.length >= this.amostraMin) { if (p90 <= atual * 0.5) sug = Math.max(2, Math.ceil(p90 * 1.5)); else if (p90 > atual) sug = Math.ceil(p90 * 1.1); }
        return { n: xs.length, atual, sugerido: sug !== null && sug !== atual ? sug : null, evidencia: ev, efeito: sug !== null && sug < atual ? 'O prazo passa a refletir o que a Mesa entrega; estouros aparecem mais cedo e o líder é avisado antes.' : 'O prazo passa a refletir a realidade; vale também avaliar reforço da fila.' };
      } },
    { id: 'atend.limites.usuarioMsgHora', familia: 'atendimento', rotulo: 'Limite de mensagens por usuário por hora', un: 'msgs', caminho: ['comunicacao', 'limites', 'usuarioMsgHora'], amostraMin: 50, periodo: '30 dias',
      avaliar() {
        const t = now(); const ms = db.where('mensagens', (m) => m.autor.tipo === 'pessoa' && m.ts >= t - 30 * DAY); const por = {};
        ms.forEach((m) => { const k = m.autor.id + '|' + Math.floor(m.ts / 3600e3); por[k] = (por[k] || 0) + 1; }); const max = Math.max(0, ...Object.values(por));
        const atual = lerCfg(this.caminho); const sug = ms.length >= this.amostraMin && max <= atual * 0.2 ? Math.max(10, Math.ceil(max * 3)) : null;
        return { n: ms.length, atual, sugerido: sug !== null && sug < atual ? sug : null, evidencia: ms.length ? [`Maior volume de um usuário em uma hora: ${max} mensagens`, `${ms.length} mensagens de pessoas no período`] : [], efeito: 'Reduz a margem para envio em massa sem atrapalhar o uso normal.' };
      } },
    { id: 'conc.slaH', familia: 'conciliacao', rotulo: 'Prazo de resolução de caso de conciliação', un: 'h', caminho: ['conciliacao', 'slaH'], amostraMin: 6, periodo: '60 dias',
      avaliar() {
        const t = now(); const xs = db.where('casosMesa', (c) => c.resolvidoEm && c.tipo !== 'empate' && c.abertoEm >= t - 60 * DAY).map((c) => (c.resolvidoEm - c.abertoEm) / 3600e3);
        const atual = lerCfg(this.caminho); const p90 = quantil(xs, 0.9); let sug = null;
        if (xs.length >= this.amostraMin) { if (p90 <= atual * 0.5) sug = Math.max(4, Math.ceil(p90 * 1.5)); else if (p90 > atual) sug = Math.ceil(p90 * 1.1); }
        return { n: xs.length, atual, sugerido: sug !== null && sug !== atual ? sug : null, evidencia: xs.length ? [`Percentil 90 de ${num(p90)} h para resolver`, `${xs.length} casos resolvidos`] : [], efeito: 'O prazo do caso acompanha o que a Mesa Conciliadora entrega.' };
      } },
    { id: 'merc.slaValidacaoH', familia: 'mercado', rotulo: 'Prazo de validação de lote pela Mesa', un: 'h', caminho: ['slaValidacaoH'], amostraMin: 15, periodo: '90 dias',
      avaliar() {
        const t = now(); const xs = db.where('lotes', (l) => l.decididoEm && l.criadoEm >= t - 90 * DAY).map((l) => (l.decididoEm - l.criadoEm) / 3600e3);
        const atual = lerCfg(this.caminho); const p90 = quantil(xs, 0.9); let sug = null;
        if (xs.length >= this.amostraMin) { if (p90 <= atual * 0.5) sug = Math.max(1, Math.ceil(p90 * 1.5)); else if (p90 > atual) sug = Math.ceil(p90 * 1.1); }
        return { n: xs.length, atual, sugerido: sug !== null && sug !== atual ? sug : null, evidencia: xs.length ? [`Percentil 90 de ${num(p90)} h entre o envio e a decisão`, `${xs.length} lotes decididos`] : [], efeito: 'O cedente vê um prazo de validação mais próximo do real.' };
      } },
    { id: 'merc.passoMinLance', familia: 'mercado', rotulo: 'Passo mínimo entre lances', un: 'p.p. a.m.', caminho: ['passoMinLance'], amostraMin: 20, periodo: '90 dias',
      avaliar() {
        const por = {}; db.all('lances').forEach((l) => { (por[l.opId] = por[l.opId] || []).push(l); }); const passo = lerCfg(this.caminho); const difs = [];
        Object.values(por).forEach((ls) => { ls.sort((a, b) => a.criadoEm - b.criadoEm); for (let i = 1; i < ls.length; i++) { const d = ls[i - 1].taxaAm - ls[i].taxaAm; if (d > 0) difs.push(d); } });
        const noMin = difs.filter((d) => d <= passo * 1.01).length; const share = difs.length ? noMin / difs.length : 0;
        const sug = difs.length >= this.amostraMin && share >= 0.6 ? arred(passo * 2, 2) : null;
        return { n: difs.length, atual: passo, sugerido: sug, evidencia: difs.length ? [`${noMin} de ${difs.length} melhorias de lance (${num(share * 100, 0)}%) foram de exatamente o passo mínimo`] : [], efeito: 'Menos lances de centavos; o leilão converge por saltos maiores.' };
      } },
    { id: 'econ.premiacaoMinima', familia: 'economicos', rotulo: 'Valor mínimo para pagar premiação', un: 'R$', caminho: ['premiacaoMinima'], amostraMin: 10, periodo: '4 competências', economico: true, aviso: { perfis: ['originador'], quem: 'originadores' },
      avaliar() {
        const atual = lerCfg(this.caminho); const ps = db.all('premiacoes'); const abaixo = ps.filter((p) => p.total < atual); const share = ps.length ? abaixo.length / ps.length : 0;
        const sug = ps.length >= this.amostraMin && share >= 0.05 ? Math.max(25, Math.floor(atual / 2 / 25) * 25) : null;
        return { n: ps.length, atual, sugerido: sug !== null && sug < atual ? sug : null, evidencia: ps.length ? [`${abaixo.length} de ${ps.length} premiações (${num(share * 100, 1)}%) ficaram abaixo do mínimo de ${brl(atual)} e retidas`, abaixo.length ? `Total retido: ${brl(C.sum(abaixo, (p) => p.total))}` : null].filter(Boolean) : [], efeito: 'Originadores recebem comissões pequenas em vez de acumulá-las; custo estimado baixo, abaixo de R$ 100 por competência.' };
      } },
    { id: 'econ.tsPiso', familia: 'economicos', rotulo: 'Piso da taxa de serviço por operação', un: 'R$', caminho: ['tsPiso'], amostraMin: 20, periodo: 'todas as faturas', economico: true, aviso: { perfis: ['financiador'], quem: 'financiadores' },
      avaliar() {
        const it = db.all('faturas').flatMap((f) => f.itens || []); const noPiso = it.filter((i) => i.noPiso).length; const atual = lerCfg(this.caminho);
        const sug = it.length >= this.amostraMin && noPiso / it.length >= 0.4 ? Math.ceil(atual * 1.2) : null;
        return { n: it.length, atual, sugerido: sug, evidencia: it.length ? [`O piso foi o que definiu a TS em ${noPiso} de ${it.length} itens faturados`] : [], efeito: 'Ajusta a TS onde o piso está determinando o preço.' };
      } },
    { id: 'ia.tetoCustoMesBRL', familia: 'ia_custo', rotulo: 'Teto de custo mensal de IA', un: 'R$', caminho: ['ia', 'tetoCustoMesBRL'], amostraMin: 20, periodo: '30 dias',
      avaliar() {
        const t = now(); const uso = db.where('usoIA', (u) => u.dia >= t - 30 * DAY); const custo = C.sum(uso, (u) => u.custoBRL); const atual = lerCfg(this.caminho); const r = atual ? custo / atual : 0; let sug = null;
        if (uso.length >= this.amostraMin) { if (r >= 0.8) sug = Math.ceil((custo * 1.3) / 500) * 500; else if (r <= 0.4) sug = Math.ceil((custo * 1.5) / 500) * 500; }
        return { n: uso.length, atual, sugerido: sug !== null && sug !== atual ? sug : null, evidencia: uso.length ? [`Custo dos últimos 30 dias: ${brl(custo)}, ${num(r * 100, 0)}% do teto de ${brl(atual)}`, `${uso.length} registros diários de uso`] : [], efeito: r >= 0.8 ? 'Evita que os agentes entrem em modo degradado por teto de custo no fim do mês.' : 'Teto mais próximo do consumo real melhora o alerta de custo.' };
      } },
  ];
  /** um parâmetro por programa: o ticket mínimo (versão nova do programa ao aplicar) */
  function paramsDeProdutos() {
    return db.all('produtos').map((pr) => ({ id: 'prog.' + pr.id + '.ticketMin', familia: 'programas', rotulo: `Ticket mínimo do ${pr.nome}`, un: 'R$', produtoId: pr.id, caminho: ['produtos', pr.id, 'ticketMin'], amostraMin: 15, periodo: '180 dias',
      avaliar() {
        const t = now(); const p = db.get('produtos', pr.id); const fs = db.where('operacoes', (o) => o.produto === pr.id && o.criadaEm >= t - 180 * DAY).map((o) => o.face);
        const perto = fs.filter((f) => f < p.ticketMin * 1.5).length; const share = fs.length ? perto / fs.length : 0;
        const sug = fs.length >= this.amostraMin && share >= 0.3 ? Math.floor((p.ticketMin * 0.8) / 500) * 500 : null;
        return { n: fs.length, atual: p.ticketMin, sugerido: sug, evidencia: fs.length ? [`${perto} de ${fs.length} operações (${num(share * 100, 0)}%) ficaram a menos de 1,5 vez o mínimo de ${brl(p.ticketMin)}`, `Menor operação: ${brl(Math.min(...fs))}`] : [], efeito: 'Libera operações menores no programa; nova versão do programa com histórico.' };
      } }));
  }
  const todosParams = () => [...PARAMS, ...paramsDeProdutos()];
  const fmtVal = (p, v) => (p.un === 'R$' ? brl(v) : p.un === 'p.p. a.m.' ? num(v, 2) + ' p.p. a.m.' : `${v} ${p.un}`);
  CAL.fmtVal = fmtVal;

  /* ------------------------------ análise ------------------------------ */
  const recsDe = (paramId) => db.where('recomendacoes', (r) => r.paramId === paramId).sort((a, b) => b.criadaEm - a.criadaEm);
  const abertos = (paramId) => db.where('recomendacoes', (r) => r.paramId === paramId && r.status === 'pedido');
  const pedidosNaSemana = () => db.where('recomendacoes', (r) => r.criadaEm >= now() - 7 * DAY).length;
  /** estado de cada parâmetro: em_pedido, aguarda_cadencia, recusado_sem_dado_novo, recomendar, sem_mudanca, amostra_insuficiente */
  CAL.analisar = function () {
    const semana = pedidosNaSemana(); const cap = CAL.cfg().maxPedidosSemana; let usados = semana;
    return todosParams().map((p) => {
      const ev = p.avaliar(); const base = Object.assign({ param: p, id: p.id, familia: p.familia, rotulo: p.rotulo, un: p.un, economico: !!p.economico, amostraMin: p.amostraMin, periodo: p.periodo }, ev);
      const rs = recsDe(p.id); const aberto = abertos(p.id)[0];
      if (aberto) return Object.assign(base, { estado: 'em_pedido', rec: aberto });
      if (ev.n < p.amostraMin) return Object.assign(base, { estado: 'amostra_insuficiente' });
      if (ev.sugerido === null || ev.sugerido === undefined) return Object.assign(base, { estado: 'sem_mudanca' });
      const rej = rs.find((r) => r.status === 'rejeitada' && r.sugerido === ev.sugerido);
      if (rej && ev.n < rej.n * 1.2) return Object.assign(base, { estado: 'recusado_sem_dado_novo', recusa: rej });
      if (usados >= cap) return Object.assign(base, { estado: 'aguarda_cadencia' });
      usados++; return Object.assign(base, { estado: 'recomendar' });
    });
  };

  /* ------------------------------ pedido ------------------------------ */
  function abrirPedido(a) {
    const p = a.param; const economico = !!p.economico;
    const rec = db.put('recomendacoes', { id: 'RC-' + String(db.all('recomendacoes').length + 1).padStart(4, '0'), paramId: p.id, familia: p.familia, rotulo: p.rotulo, un: p.un, atual: a.atual, sugerido: a.sugerido, n: a.n, periodo: p.periodo, evidencia: a.evidencia, efeito: a.efeito, economico, status: 'pedido', criadaEm: now(), aprovacaoId: null });
    const motivo = `Evidência (${p.periodo}, amostra de ${a.n}): ${a.evidencia.join('; ')}. Efeito esperado: ${a.efeito}`;
    const r = E.solicitarAprovacao({ tipo: economico ? 'calibracao_economica' : 'calibracao', titulo: `${p.rotulo}: ${fmtVal(p, a.atual)} para ${fmtVal(p, a.sugerido)}`, resumo: `Recomendação do agente de calibração (${CAL.FAMILIAS[p.familia]}).`,
      payload: { recId: rec.id, paramId: p.id, valor: a.sugerido, antesValor: a.atual, economico, aviso: p.aviso || null, evidencia: a.evidencia, efeito: a.efeito, amostra: a.n, periodo: p.periodo },
      antes: { [p.rotulo]: fmtVal(p, a.atual) }, depois: { [p.rotulo]: fmtVal(p, a.sugerido) }, userId: CAL.AGENTE, motivo });
    if (!r.ok) { db.del('recomendacoes', rec.id); return r; }
    db.patch('recomendacoes', rec.id, { aprovacaoId: r.aprovacao.id });
    return { ok: true, rec: db.get('recomendacoes', rec.id), aprovacao: r.aprovacao };
  }
  CAL._abrirPedido = abrirPedido;
  /** ciclo semanal (simulado no relógio): abre os pedidos elegíveis dentro do limite da semana e avisa quem decide */
  CAL.executarCiclo = function () {
    const ana = CAL.analisar(); const abertosAgora = []; const bloqueados = [];
    ana.forEach((a) => { if (a.estado === 'recomendar') { const r = abrirPedido(a); if (r.ok) abertosAgora.push(r.rec); } else if (a.estado === 'aguarda_cadencia') bloqueados.push(a); });
    salvarCfg({ ultimoCicloEm: now() });
    const resumo = `Ciclo semanal de calibração: ${abertosAgora.length} pedido(s) aberto(s)${bloqueados.length ? `, ${bloqueados.length} aguardando o limite semanal` : ''}.`;
    ledger.append({ actor: A.agente(CAL.AGENTE), acao: 'calibracao.ciclo', entidade: { kind: 'agente', id: CAL.AGENTE }, resumo, classe: 'R1', detalhe: { abertos: abertosAgora.map((r) => r.paramId), bloqueados: bloqueados.map((b) => b.id) } });
    db.where('users', (u) => (u.perfil === 'superadmin') || (u.orgId === 'org-cedy' && u.perfil === 'admin')).forEach((u) => notify.send({ to: { userId: u.id }, tipo: 'info', titulo: 'Relatório semanal de calibração', corpo: resumo, link: u.perfil === 'superadmin' ? '/super/calibracao' : '/ops/comunicacao?aba=calibracao', classe: 'operacional' }));
    return { ok: true, abertos: abertosAgora, bloqueados };
  };

  /* ------------------------------ aplicação, vigência, aviso e reversão ------------------------------ */
  function vigenciaDe(p, economico) {
    const t = now();
    if (economico) { const d = cal.sp(t); const proxMes = cal.spTs(d.y, d.m + 1, 1, 8, 0); return Math.max(proxMes, t + CAL.cfg().antecedenciaEconomicaDias * DAY); }
    return cal.nextUtil(t, 8, 0);
  }
  const paramPorId = (id) => todosParams().find((p) => p.id === id);
  function avisarAfetados(p, rec, vigenteEm, userId) {
    const M = K.comunicado; if (!M || !p.aviso) return null;
    const corpo = `A partir de ${fmt.date(vigenteEm)}, "${p.rotulo.toLowerCase()}" passa de ${fmtVal(p, rec.atual)} para ${fmtVal(p, rec.sugerido)}. Valem as regras novas só para o que for apurado ou contratado depois dessa data; nada muda para o que já foi apurado. Dúvidas: fale com a Mesa pelo chamado.`;
    const c = M.criar({ userId, tipo: 'informativo', titulo: `Mudança em ${p.rotulo.toLowerCase()} a partir de ${fmt.date(vigenteEm)}`, corpo, segmento: { perfis: p.aviso.perfis }, vigenciaEm: null, faixa: false });
    if (!c.ok) return c; const pub = M.publicar(c.comunicado.id, userId); return pub.ok ? pub.comunicado : pub;
  }
  /** efeito de uma aprovação (aplicador do motor): agenda se há vigência futura, senão aplica na hora */
  CAL.aplicar = function (pl, ctx) {
    const p = paramPorId(pl.paramId); const rec = db.get('recomendacoes', pl.recId); if (!p || !rec) return fail('Parâmetro ou recomendação não encontrados.');
    const vigenteEm = vigenciaDe(p, pl.economico); const userId = ctx && ctx.userId;
    const aviso = avisarAfetados(p, rec, vigenteEm, userId);
    if (vigenteEm > now()) {
      salvarCfg({ agendadas: [...CAL.cfg().agendadas, { recId: rec.id, paramId: p.id, valor: pl.valor, aplicarEm: vigenteEm }] });
      db.patch('recomendacoes', rec.id, { status: 'agendada', vigenteEm, avisoId: aviso && aviso.id || null });
      ledger.append({ actor: userId ? A.user(userId) : A.agente(CAL.AGENTE), acao: 'calibracao.agendada', entidade: { kind: 'parametro', id: p.id }, resumo: `${p.rotulo}: ${fmtVal(p, rec.atual)} para ${fmtVal(p, rec.sugerido)}, vale a partir de ${fmt.date(vigenteEm)}`, classe: pl.economico ? 'R3' : 'R2', snapshot: { antes: { valor: rec.atual }, depois: { valor: pl.valor } } });
    } else {
      gravarValor(p, pl.valor); db.patch('recomendacoes', rec.id, { status: 'aplicada', aplicadaEm: now(), avisoId: aviso && aviso.id || null });
      ledger.append({ actor: userId ? A.user(userId) : A.agente(CAL.AGENTE), acao: 'calibracao.aplicada', entidade: { kind: 'parametro', id: p.id }, resumo: `${p.rotulo}: ${fmtVal(p, rec.atual)} para ${fmtVal(p, rec.sugerido)}`, classe: pl.economico ? 'R3' : 'R2', snapshot: { antes: { valor: rec.atual }, depois: { valor: pl.valor } } });
    }
  };
  CAL.aplicarAgendadas = function () {
    const c = CAL.cfg(); const t = now(); const vencidas = (c.agendadas || []).filter((x) => x.aplicarEm <= t); if (!vencidas.length) return;
    salvarCfg({ agendadas: c.agendadas.filter((x) => x.aplicarEm > t) });
    vencidas.forEach((x) => { const p = paramPorId(x.paramId); const rec = db.get('recomendacoes', x.recId); if (!p || !rec || rec.status !== 'agendada') return; gravarValor(p, x.valor); db.patch('recomendacoes', rec.id, { status: 'aplicada', aplicadaEm: t });
      ledger.append({ actor: A.agente(CAL.AGENTE), acao: 'calibracao.vigencia', entidade: { kind: 'parametro', id: p.id }, resumo: `${p.rotulo}: nova regra em vigor (${fmtVal(p, x.valor)})`, classe: rec.economico ? 'R3' : 'R2' }); });
  };
  /** reversão em um clique, na trilha: restaura o valor anterior ou cancela o agendamento */
  CAL.reverter = function (recId, userId) {
    const rec = db.get('recomendacoes', recId); const u = db.get('users', userId); if (!rec) return fail('Recomendação não encontrada.');
    if (!u || u.perfil !== 'superadmin') return fail('Só o Superadmin reverte uma calibração.', 'SEM_PERMISSAO');
    if (!['agendada', 'aplicada'].includes(rec.status)) return fail('Só uma calibração agendada ou aplicada pode ser revertida.');
    const p = paramPorId(rec.paramId); if (!p) return fail('Parâmetro não encontrado.');
    if (rec.status === 'agendada') salvarCfg({ agendadas: CAL.cfg().agendadas.filter((x) => x.recId !== rec.id) }); else gravarValor(p, rec.atual);
    db.patch('recomendacoes', rec.id, { status: 'revertida', revertidaEm: now(), revertidaPor: userId });
    ledger.append({ actor: A.user(userId), acao: 'calibracao.revertida', entidade: { kind: 'parametro', id: p.id }, resumo: `${p.rotulo} revertido para ${fmtVal(p, rec.atual)}${rec.status === 'agendada' ? ' (antes de entrar em vigor)' : ''}`, classe: rec.economico ? 'R3' : 'R2', snapshot: { antes: { valor: rec.sugerido }, depois: { valor: rec.atual } } });
    return { ok: true };
  };
  /** a decisão alimenta a avaliação do agente (aceitas sobre decididas) */
  CAL.aposDecisao = function (a, decisao, motivo) {
    const rec = a.payload && db.get('recomendacoes', a.payload.recId); if (!rec) return;
    if (decisao === 'rejeitar') db.patch('recomendacoes', rec.id, { status: 'rejeitada', recusadaEm: now(), motivoRecusa: motivo || null });
    const dec = db.where('recomendacoes', (r) => ['aplicada', 'agendada', 'revertida', 'rejeitada'].includes(r.status)); const ok = dec.filter((r) => r.status !== 'rejeitada').length;
    if (db.get('agentes', CAL.AGENTE)) db.patch('agentes', CAL.AGENTE, { metricas: Object.assign({}, db.get('agentes', CAL.AGENTE).metricas, { execucoes30d: db.where('recomendacoes', (r) => r.criadaEm >= now() - 30 * DAY).length, aceitas: dec.length ? ok / dec.length : 0, correcoes: dec.length ? 1 - ok / dec.length : 0 }) });
  };

  /* ------------------------------ relógio: ciclo semanal e vigências ------------------------------ */
  const tick0 = E.tick;
  E.tick = function () {
    tick0();
    const c = CAL.cfg(); const ag = db.get('agentes', CAL.AGENTE);
    CAL.aplicarAgendadas();
    if (ag && ag.nivel !== 'inativo' && E.flag('agentes') && c.ultimoCicloEm && now() - c.ultimoCicloEm >= 7 * DAY) CAL.executarCiclo();
  };
})();
