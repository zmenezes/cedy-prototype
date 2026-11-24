/* =========================================================================
   Cedy protótipo 0.1, motor determinístico.
   Princípio (D3/D5): o motor decide e executa as regras; agentes de IA apenas
   propõem (Cedy.engine.ia.*); toda ação relevante vai para a trilha (ledger)
   com ator, classe de risco e, quando financeira, snapshot do que foi exibido.

   Regras de negócio da modelagem do protótipo. Parâmetros marcados
   [INFERÊNCIA] são premissas ainda não validadas e estão em config/produtos
   para serem editados.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { db, ledger, notify } = C.store;
  const { fmt, cal } = C;
  const E = {};
  const now = () => C.clock.now();
  const cfg = () => db.cfg();
  const r2 = C.round2;

  /* ------------------------------ atores -------------------------------- */
  const A = {
    user(userId) { const u = db.get('users', userId); const o = u && db.get('orgs', u.orgId); return { tipo: 'humano', id: userId, nome: u ? `${u.nome}${o ? ' · ' + (o.fantasia || o.nome) : ''}` : 'Usuário' }; },
    motor(nome = 'Motor de regras') { return { tipo: 'motor', id: 'motor', nome }; },
    agente(id) { const a = db.get('agentes', id); return { tipo: 'agente', id, nome: a ? a.nome : id }; },
    sistema(nome = 'Sistema') { return { tipo: 'sistema', id: 'sistema', nome }; },
  };
  E.actors = A;
  const fail = (erro, codigo) => ({ ok: false, erro, codigo });
  const ok = (extra) => Object.assign({ ok: true }, extra || {});

  /* ------------------------------ precificação -------------------------- */
  const selicAm = () => (Math.pow(1 + cfg().selicAa / 100, 1 / 12) - 1) * 100;
  E.selicAm = selicAm;

  /**
   * Simula a operação. taxaAm em % a.m. (desconto simples sobre o prazo: deságio = taxa × prazo/30).
   * TS (taxa de serviço, paga pelo financiador): % do spread sobre a SELIC, com piso.
   */
  E.simular = function ({ face, prazoDias, taxaAm, produtoId }) {
    const p = db.get('produtos', produtoId) || db.get('produtos', 'premium');
    prazoDias = Math.max(1, prazoDias);
    const desagioPct = taxaAm * prazoDias / 30;
    const desagioValor = r2(face * desagioPct / 100);
    const liquido = r2(face - desagioValor);
    const cetAm = liquido > 0 ? (Math.pow(face / liquido, 30 / prazoDias) - 1) * 100 : 0;
    const selicPeriodo = face * selicAm() / 100 * prazoDias / 30;
    const spreadValor = Math.max(0, desagioValor - selicPeriodo);
    const spreadAm = Math.max(0, cetAm - selicAm());
    const tsBruto = r2(spreadValor * p.tsPct / 100);
    const piso = r2(Math.max(cfg().tsPiso, face * cfg().tsPisoPctAm / 100 * prazoDias / 30));
    const ts = Math.max(tsBruto, piso);
    return { face, prazoDias, taxaAm, desagioPct, desagioValor, liquido, cetAm, spreadAm, spreadValor, tsPct: p.tsPct, tsBruto, tsPiso: piso, ts, tsNoPiso: piso >= tsBruto,
      retornoFinanciador: r2(desagioValor - ts), retornoFinanciadorAm: face > 0 ? ((desagioValor - ts) / (face - desagioValor)) * 30 / prazoDias * 100 : 0, selicAm: selicAm() };
  };

  /** Prazo de pagamento ao cedente (AP): aceite até 14h30 => fundos até 17h do mesmo dia útil; senão próximo dia útil 17h. */
  E.prazoPagamento = function (ts) {
    const [ch, cm] = cfg().cutoffAceite.split(':').map(Number);
    const [ph, pm] = cfg().cutoffPagamento.split(':').map(Number);
    const t = cal.sp(ts);
    if (cal.isUtil(ts) && t.h * 60 + t.mi <= ch * 60 + cm) return { limite: cal.spTs(t.y, t.m, t.d, ph, pm), mesmoDia: true };
    return { limite: cal.nextUtil(ts, ph, pm), mesmoDia: false };
  };

  /** Métricas da operação para uma taxa, usando o prazo médio ponderado até o vencimento. */
  E.metricasOp = function (op, taxaAm, baseTs) {
    const tit = op.tituloIds.map((id) => db.get('titulos', id)).filter(Boolean);
    const face = r2(C.sum(tit, (t) => t.valor));
    const base = E.prazoPagamento(baseTs || now()).limite;
    const prazoMedio = face ? Math.max(1, Math.round(C.sum(tit, (t) => t.valor * Math.max(1, cal.daysBetween(base, t.vencimento))) / face)) : 1;
    return Object.assign({ prazoMedio, nTitulos: tit.length }, E.simular({ face, prazoDias: prazoMedio, taxaAm, produtoId: op.produto }));
  };

  /* ------------------------------ validação ----------------------------- */
  function mod11(num43) { let peso = 2, s = 0; for (let i = num43.length - 1; i >= 0; i--) { s += Number(num43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; } const r = s % 11; return r < 2 ? 0 : 11 - r; }
  E.chaveValida = (chave) => /^\d{44}$/.test(chave) && mod11(chave.slice(0, 43)) === Number(chave[43]);
  E.gerarChave = function ({ uf = 35, aamm = '2611', cnpj, modelo = 55, serie = 1, numero }) {
    const base = String(uf) + aamm + String(cnpj).replace(/\D/g, '').padStart(14, '0') + String(modelo).padStart(2, '0') + String(serie).padStart(3, '0') + String(numero).padStart(9, '0') + '1' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    return base + mod11(base);
  };

  /** Regras de elegibilidade do título para o programa de produto; devolve flags {nivel:'erro'|'aviso'|'ok', codigo, msg} */
  E.validarTitulo = function (t, cedente) {
    const p = db.get('produtos', t.produto) || db.get('produtos', 'premium');
    const f = [];
    const prazo = cal.daysBetween(now(), t.vencimento);
    if (t.valor < p.ticketMin) f.push({ nivel: 'erro', codigo: 'TICKET', msg: `Valor abaixo do ticket mínimo do programa ${p.nome} (${fmt.brl(p.ticketMin, { round: true })}).` });
    if (prazo < p.prazoMin) f.push({ nivel: 'erro', codigo: 'PRAZO_MIN', msg: `Prazo de ${prazo} dias é menor que o mínimo do programa (${p.prazoMin} dias).` });
    if (prazo > p.prazoMax) f.push({ nivel: 'erro', codigo: 'PRAZO_MAX', msg: `Prazo de ${prazo} dias excede o máximo do programa (${p.prazoMax} dias).` });
    if (t.vencimento <= now()) f.push({ nivel: 'erro', codigo: 'VENCIDO', msg: 'Título já vencido.' });
    if (t.emissao > now() + 86400000) f.push({ nivel: 'erro', codigo: 'EMISSAO_FUTURA', msg: 'Data de emissão no futuro.' });
    if (t.tipo === 'NF-e' && t.chave) {
      if (!E.chaveValida(t.chave)) f.push({ nivel: 'erro', codigo: 'CHAVE', msg: 'Chave de acesso da NF-e inválida (44 dígitos, dígito verificador não confere).' });
      const dup = db.all('titulos').find((x) => x.id !== t.id && x.chave && x.chave === t.chave && (x.numero || '') === (t.numero || '') && x.status !== 'recusado');
      if (dup) f.push({ nivel: 'erro', codigo: 'DUPLICADO', msg: `NF-e já cadastrada na plataforma (${dup.id}).` });
    }
    if (t.cnpjEmitente && cedente && t.cnpjEmitente.replace(/\D/g, '') !== cedente.cnpj.replace(/\D/g, '')) f.push({ nivel: 'erro', codigo: 'EMITENTE', msg: 'O emitente da NF-e não é a empresa cedente.' });
    const sac = db.get('orgs', t.sacadoId);
    if (!sac) f.push({ nivel: 'aviso', codigo: 'SACADO_NOVO', msg: 'Sacado ainda não cadastrado: será consultado (SCR e restritivos) pela Mesa de Operações.' });
    else if (sac.restricao) f.push({ nivel: 'erro', codigo: 'SACADO_RESTRICAO', msg: `Sacado com restrição cadastral (${sac.restricao}).` });
    if (!t.lastro || !t.lastro.xml) f.push({ nivel: 'aviso', codigo: 'LASTRO_XML', msg: 'XML da NF-e não anexado.' });
    if ((p.lastro || []).some((l) => /entrega|aceite/i.test(l)) && !(t.lastro && t.lastro.comprovante)) f.push({ nivel: 'aviso', codigo: 'LASTRO_COMPROVANTE', msg: 'Comprovante de entrega/aceite não anexado (exigido pelo programa).' });
    if (!p.silencioso && p.id === 'confia' && !(t.lastro && t.lastro.aceiteSacado === 'aceito')) f.push({ nivel: 'aviso', codigo: 'AGUARDA_SACADO', msg: 'Aguardando a confirmação do sacado (programa Confia).' });
    if (t.lastro && t.lastro.aceiteSacado === 'contestado') f.push({ nivel: 'erro', codigo: 'CONTESTADO', msg: 'Sacado contestou a NF-e.' });
    return f;
  };

  /* --------------------------------- LAR -------------------------------- */
  /** Limite de Antecipação de Recebíveis (CM): meses 1-3 = 80% de faturamento/365 × prazo médio; depois pelos depósitos de sacados (90d). */
  E.exposicao = (orgId) => r2(C.sum(db.where('operacoes', (o) => o.cedenteId === orgId && ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'].includes(o.status)), (o) => o.saldoAberto !== undefined ? o.saldoAberto : o.face));
  E.lar = function (orgId) {
    const o = db.get('orgs', orgId); if (!o || o.kind !== 'cedente') return null;
    const meses = Math.max(0, Math.floor((now() - (o.ativoDesde || now())) / (30 * 86400000)));
    const base = (o.faturamentoAnual || 0) / 365 * (o.prazoRecebimentoDias || 45);
    const porDepositos = (o.depositos90d || 0) / 90 * (o.prazoRecebimentoDias || 45);
    const inicial = meses < 3;
    const manual = o.larManual !== undefined && o.larManual !== null ? Number(o.larManual) : null;
    const limite = r2(manual !== null && !isNaN(manual) ? manual : (inicial ? base * 0.8 : porDepositos));
    const exposicao = E.exposicao(orgId);
    return { limite, exposicao, disponivel: Math.max(0, r2(limite - exposicao)), meses, fase: manual !== null && !isNaN(manual) ? 'manual' : (inicial ? 'inicial' : 'depositos'), base, porDepositos, manual };
  };

  /* ----------------------------- lotes e títulos ------------------------- */
  /** Cria lote de importação (borderô) com os títulos já validados pelas regras determinísticas. Agente de pré-validação propõe; Mesa decide. */
  E.importarTitulos = function ({ cedenteId, userId, itens, origem = 'xml', nomeArquivo }) {
    if (!E.flag('importacao')) return fail('A importação de títulos está desativada pela plataforma.', 'IMPORTACAO_DESATIVADA');
    const ced = db.get('orgs', cedenteId);
    const loteId = 'LT-' + String(db.all('lotes').length + 1).padStart(4, '0');
    const criados = [];
    db.batch(() => {
      itens.forEach((it, i) => {
        const id = 'T-' + (30000 + db.all('titulos').length + 1);
        const t = Object.assign({ id, orgId: cedenteId, tipo: 'NF-e', produto: 'premium', status: 'validando', operacaoId: null, loteId, criadoEm: now(), origem, lastro: { xml: origem === 'xml', pdf: false, comprovante: false, aceiteSacado: 'silencioso' } }, it);
        t.flags = E.validarTitulo(t, ced);
        t.temErro = t.flags.some((f) => f.nivel === 'erro');
        if (t.temErro) t.status = 'recusado';
        db.put('titulos', t); criados.push(t);
      });
      const validos = criados.filter((t) => !t.temErro);
      const primeira = db.where('operacoes', (o) => o.cedenteId === cedenteId).length === 0;
      const slaH = primeira ? cfg().slaPrimeiraOpH : cfg().slaValidacaoH;
      const lote = { id: loteId, cedenteId, userId, nomeArquivo: nomeArquivo || 'importação manual', origem, criadoEm: now(), titulos: criados.map((t) => t.id), total: r2(C.sum(validos, (t) => t.valor)), primeiraOperacao: primeira, slaAte: E.slaAte(now(), slaH), status: validos.length ? 'validando' : 'recusado' };
      db.put('lotes', lote);
      ledger.append({ actor: A.user(userId), acao: 'titulos.importados', entidade: { kind: 'lote', id: loteId }, resumo: `${criados.length} título(s) importados (${validos.length} aptos, ${criados.length - validos.length} recusados pelas regras)`, classe: 'R1', detalhe: { origem, arquivo: nomeArquivo } });
      if (validos.length) {
        const ag = db.get('agentes', 'ag-prevalidacao');
        const avisos = C.sum(validos, (t) => t.flags.filter((f) => f.nivel === 'aviso').length);
        db.put('propostas', { id: C.uid('pp'), agenteId: 'ag-prevalidacao', tipo: 'aprovar_lote', entidade: { kind: 'lote', id: loteId }, resumo: `Aprovar lote ${loteId} de ${ced.fantasia || ced.nome}: ${validos.length} título(s), ${fmt.brl(lote.total)}`,
          evidencias: [`Regras determinísticas: ${validos.length} de ${criados.length} títulos sem erro`, avisos ? `${avisos} aviso(s) de lastro para a Mesa conferir` : 'Sem avisos de lastro', `Sacado(s): ${[...new Set(validos.map((t) => (db.get('orgs', t.sacadoId) || { fantasia: 'novo' }).fantasia))].join(', ')}`],
          confianca: avisos ? 0.78 : 0.94, classe: 'R1', status: 'pendente', ts: now(), nivelAgente: ag ? ag.nivel : 'assistido' });
      }
      notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: `Novo lote para validação: ${loteId}`, corpo: `${ced.fantasia || ced.nome}, ${validos.length} título(s), meta até ${fmt.datetime(lote.slaAte)}`, link: '/ops/mesa' });
    });
    return { ok: true, loteId, titulos: criados };
  };
  /** SLA em horas úteis dentro da janela 8h-18h de dias úteis. */
  E.slaAte = function (ts, horas) {
    const [ini, fim] = [cfg().horarioValidacao.ini, cfg().horarioValidacao.fim];
    let t = ts, restante = horas * 60;
    const aberto = (x) => { const p = cal.sp(x); return cal.isUtil(x) && p.h >= ini && p.h < fim; };
    // pula para a próxima janela aberta
    const proximaJanela = (x) => { if (aberto(x)) return x; const p = cal.sp(x); if (cal.isUtil(x) && p.h < ini) return cal.spTs(p.y, p.m, p.d, ini, 0); return cal.nextUtil(x, ini, 0); };
    t = proximaJanela(t);
    while (restante > 0) {
      const p = cal.sp(t); const fimDia = cal.spTs(p.y, p.m, p.d, fim, 0); const disp = Math.round((fimDia - t) / 60000);
      if (restante <= disp) return t + restante * 60000;
      restante -= disp; t = cal.nextUtil(t, ini, 0);
    }
    return t;
  };
  E.decidirLote = function (loteId, decisao, { userId, actor, motivo } = {}) {
    const lote = db.get('lotes', loteId); if (!lote) return fail('Lote não encontrado');
    if (lote.status !== 'validando') return fail('Lote já decidido');
    const act = actor || A.user(userId);
    db.batch(() => {
      lote.titulos.forEach((id) => { const t = db.get('titulos', id); if (t && t.status === 'validando') db.patch('titulos', id, { status: decisao === 'aprovar' ? 'disponivel' : 'recusado', motivoRecusa: decisao === 'aprovar' ? null : (motivo || 'Recusado pela Mesa de Operações') }); });
      db.patch('lotes', loteId, { status: decisao === 'aprovar' ? 'aprovado' : 'recusado', decididoEm: now(), decididoPor: act.nome, motivo: motivo || null });
      db.all('propostas').filter((p) => p.entidade.kind === 'lote' && p.entidade.id === loteId && p.status === 'pendente').forEach((p) => db.patch('propostas', p.id, { status: 'aprovada', decididoPor: act.nome, decididoEm: now() }));
      ledger.append({ actor: act, acao: decisao === 'aprovar' ? 'lote.aprovado' : 'lote.recusado', entidade: { kind: 'lote', id: loteId }, resumo: decisao === 'aprovar' ? `Lote ${loteId} aprovado pela Mesa: títulos liberados para antecipação` : `Lote ${loteId} recusado${motivo ? ': ' + motivo : ''}`, classe: 'R2' });
      notify.send({ to: { orgId: lote.cedenteId }, tipo: decisao === 'aprovar' ? 'sucesso' : 'alerta', titulo: decisao === 'aprovar' ? `Lote ${loteId} validado` : `Lote ${loteId} recusado`, corpo: decisao === 'aprovar' ? 'Seus títulos estão disponíveis para antecipar.' : (motivo || 'Veja o motivo no detalhe do lote.'), link: '/cedente/titulos' });
    });
    return ok();
  };

  /* --------------------------- política / avaliação --------------------- */
  E.exposicaoFin = function (finId, { cedenteId, sacadoId } = {}) {
    const ops = db.where('operacoes', (o) => o.financiadorId === finId && ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'].includes(o.status));
    let v = 0;
    ops.forEach((o) => {
      if (cedenteId && o.cedenteId !== cedenteId) return;
      o.tituloIds.forEach((id) => { const t = db.get('titulos', id); if (!t || ['liquidado', 'recomprado'].includes(t.status)) return; if (sacadoId && t.sacadoId !== sacadoId) return; v += t.valor; });
    });
    return r2(v);
  };
  /** Confere a operação contra a política do financiador. Determinístico, auditável. */
  E.checarPolitica = function (finId, op, taxaAm) {
    const fin = db.get('orgs', finId); const pol = fin && fin.politica; const motivos = []; const okk = [];
    if (!pol) return { ok: true, motivos: [], aprovados: [], sem_politica: true };
    const m = E.metricasOp(op, taxaAm || pol.taxaMinima);
    const check = (cond, bom, ruim) => (cond ? okk.push(bom) : motivos.push(ruim));
    if (taxaAm != null) check(taxaAm + 1e-9 >= pol.taxaMinima, `Taxa ${fmt.taxa(taxaAm)} respeita o piso`, `Taxa ${fmt.taxa(taxaAm)} abaixo do piso da política (${fmt.taxa(pol.taxaMinima)})`);
    check(!pol.produtos || pol.produtos.includes(op.produto), 'Produto aceito pela política', `Produto ${op.produto} fora da política`);
    check(m.prazoMedio >= pol.prazoMin && m.prazoMedio <= pol.prazoMax, `Prazo médio ${m.prazoMedio}d dentro de ${pol.prazoMin}-${pol.prazoMax}d`, `Prazo médio ${m.prazoMedio}d fora de ${pol.prazoMin}-${pol.prazoMax}d`);
    check(m.face >= pol.ticketMin && m.face <= pol.ticketMax, 'Valor dentro do ticket', `Valor ${fmt.brl(m.face, { round: true })} fora do ticket (${fmt.brl(pol.ticketMin, { round: true })} a ${fmt.brl(pol.ticketMax, { round: true })})`);
    const ced = db.get('orgs', op.cedenteId);
    const limCed = (pol.limiteCedente || {})[op.cedenteId] ?? pol.limiteCedentePadrao;
    const expCed = E.exposicaoFin(finId, { cedenteId: op.cedenteId });
    if (limCed != null) check(expCed + m.face <= limCed, `Limite do cedente: ${fmt.brl(expCed + m.face, { round: true })} de ${fmt.brl(limCed, { round: true })}`, `Excede o limite do cedente (${fmt.brl(expCed + m.face, { round: true })} > ${fmt.brl(limCed, { round: true })})`);
    const sacs = [...new Set(op.tituloIds.map((id) => (db.get('titulos', id) || {}).sacadoId))];
    sacs.forEach((sid) => {
      const s = db.get('orgs', sid); if (!s) return;
      const face = C.sum(op.tituloIds.map((id) => db.get('titulos', id)).filter((t) => t && t.sacadoId === sid), (t) => t.valor);
      const lim = (pol.limiteSacado || {})[sid] ?? pol.limiteSacadoPadrao;
      if (lim != null) { const e = E.exposicaoFin(finId, { sacadoId: sid }); check(e + face <= lim, `Limite do sacado ${s.fantasia}: ${fmt.brl(e + face, { round: true })} de ${fmt.brl(lim, { round: true })}`, `Excede o limite do sacado ${s.fantasia}`); }
      const ordem = 'ABCD'; if (pol.ratingMin) check(ordem.indexOf(s.rating || 'D') <= ordem.indexOf(pol.ratingMin), `Rating do sacado ${s.fantasia} (${s.rating}) atende`, `Rating do sacado ${s.fantasia} (${s.rating}) abaixo do mínimo (${pol.ratingMin})`);
      if ((pol.setoresBloqueados || []).includes(s.setor)) motivos.push(`Setor do sacado bloqueado (${s.setor})`);
    });
    if (pol.exigeRegresso && !op.regresso) motivos.push('Política exige operação com regresso');
    if ((pol.cedentesBloqueados || []).includes(op.cedenteId)) motivos.push('Cedente na lista de bloqueio');
    if (ced && (ced.bloqueados || []).includes(finId)) motivos.push('Você foi bloqueado por este cedente');
    return { ok: motivos.length === 0, motivos, aprovados: okk, metricas: m };
  };

  /* ------------------------------ operações ----------------------------- */
  const OPEN_ST = ['aberta'];
  E.melhorLance = (opId) => db.where('lances', (l) => l.opId === opId && ['ativo', 'superado'].includes(l.status)).sort((a, b) => a.taxaAm - b.taxaAm || a.criadoEm - b.criadoEm)[0] || null;
  E.lancesDaOp = (opId) => db.where('lances', (l) => l.opId === opId).sort((a, b) => b.criadoEm - a.criadoEm);
  const nextOpId = () => 'OP-26-' + String(430 + db.all('operacoes').length).padStart(4, '0');

  /** Rascunho -> publica na Vitrine/Balcão. regresso é OBRIGATÓRIO (true/false); na omissão a plataforma assume com regresso e registra. */
  E.criarOperacao = function ({ cedenteId, userId, tituloIds, canal = 'vitrine', financiadorAlvoId = null, regresso, tetoTaxa = null, validadeH = 24, snapshotTela }) {
    if (!E.mercadoAberto()) return fail('Mercado pausado pela plataforma: novas operações estão suspensas.', 'MERCADO_PAUSADO');
    if (!E.flag(canal === 'balcao' ? 'balcao' : 'vitrine')) return fail('O canal ' + (canal === 'balcao' ? 'Balcão' : 'Vitrine') + ' está desativado pela plataforma.', 'CANAL_DESATIVADO');
    const ced = db.get('orgs', cedenteId);
    if (!ced || ced.status !== 'ativo') return fail('Cadastro do cedente não está ativo.', 'CADASTRO');
    if (!tituloIds || !tituloIds.length) return fail('Selecione ao menos um título.');
    const tit = tituloIds.map((id) => db.get('titulos', id));
    if (tit.some((t) => !t || t.orgId !== cedenteId || t.status !== 'disponivel')) return fail('Há título indisponível na seleção.');
    if (tit.some((t) => t.produto === 'confia' && !(t.lastro && t.lastro.aceiteSacado === 'aceito'))) return fail('Título do programa Confia ainda sem confirmação do sacado.', 'SACADO');
    const prods = [...new Set(tit.map((t) => t.produto))]; if (prods.length > 1) return fail('Uma operação aceita um programa de produto por vez.');
    const regressoOmitido = regresso === undefined || regresso === null;
    const reg = regressoOmitido ? true : !!regresso;
    const prod = db.get('produtos', prods[0]);
    if (!reg && !prod.permiteSemRegresso) return fail(`O programa ${prod.nome} só admite operação com regresso.`, 'REGRESSO');
    const face = r2(C.sum(tit, (t) => t.valor));
    const lar = E.lar(cedenteId);
    if (lar && face > lar.disponivel) return fail(`Valor acima do limite disponível (LAR): ${fmt.brl(lar.disponivel)}.`, 'LAR');
    if (canal === 'balcao' && !financiadorAlvoId) return fail('Selecione o financiador do Balcão.');
    const op = { id: nextOpId(), cedenteId, tituloIds, produto: prods[0], canal, financiadorAlvoId, regresso: reg, tetoTaxa: tetoTaxa || null, status: 'aberta', criadaEm: now(), publicadaEm: now(), validadeAte: now() + validadeH * 3600e3,
      face, nTitulos: tit.length, financiadorId: null, lanceVencedorId: null, userId };
    const met = E.metricasOp(op, 0); op.prazoMedio = met.prazoMedio;
    db.batch(() => {
      db.put('operacoes', op);
      tit.forEach((t) => db.patch('titulos', t.id, { status: 'em_operacao', operacaoId: op.id }));
      ledger.append({ actor: A.user(userId), acao: 'operacao.publicada', entidade: { kind: 'operacao', id: op.id }, resumo: `Operação ${op.id} publicada na ${canal === 'vitrine' ? 'Vitrine' : 'Balcão'}: ${tit.length} título(s), ${fmt.brl(face)}, prazo médio ${met.prazoMedio}d, ${reg ? 'com' : 'sem'} regresso${tetoTaxa ? `, aceite automático até ${fmt.taxa(tetoTaxa)}` : ''}`, classe: 'R2',
        snapshot: Object.assign({ tela: 'Revisão e publicação da operação', modalidadeRegresso: reg ? 'com regresso' : 'sem regresso', regressoOmitido, tetoTaxa }, snapshotTela || {}) });
      const alvos = canal === 'balcao' ? [db.get('orgs', financiadorAlvoId)] : db.where('orgs', (o) => o.kind === 'financiador' && o.status === 'ativo');
      alvos.filter(Boolean).forEach((f) => notify.send({ to: { orgId: f.id }, tipo: 'info', titulo: canal === 'balcao' ? 'Nova operação no seu Balcão' : 'Nova operação na Vitrine', corpo: `${op.id} · ${fmt.brl(face, { round: true })} · ${met.prazoMedio} dias`, link: '/financiador/vitrine/' + op.id }));
    });
    return ok({ op });
  };

  E.cancelarOperacao = function (opId, userId, motivo) {
    const op = db.get('operacoes', opId); if (!op) return fail('Operação não encontrada');
    if (op.status !== 'aberta') return fail('Só é possível cancelar operações em leilão.');
    db.batch(() => {
      db.patch('operacoes', opId, { status: 'cancelada', encerradaEm: now(), motivo: motivo || 'Cancelada pelo cedente' });
      op.tituloIds.forEach((id) => db.patch('titulos', id, { status: 'disponivel', operacaoId: null }));
      db.where('lances', (l) => l.opId === opId && ['ativo', 'superado'].includes(l.status)).forEach((l) => { db.patch('lances', l.id, { status: 'encerrado' }); notify.send({ to: { orgId: l.finId }, tipo: 'alerta', titulo: `${opId} cancelada pelo cedente`, link: '/financiador/lances' }); });
      ledger.append({ actor: A.user(userId), acao: 'operacao.cancelada', entidade: { kind: 'operacao', id: opId }, resumo: `Operação ${opId} cancelada pelo cedente${motivo ? ': ' + motivo : ''}`, classe: 'R2' });
    });
    return ok();
  };

  E.darLance = function (opId, finId, taxaAm, { userId, auto = false, actor } = {}) {
    const op = db.get('operacoes', opId); const fin = db.get('orgs', finId);
    if (!op || !fin) return fail('Operação ou financiador inválido');
    if (!E.mercadoAberto()) return fail('Mercado pausado pela plataforma: novos lances estão suspensos.', 'MERCADO_PAUSADO');
    if (op.status !== 'aberta') return fail('Esta operação não está mais em leilão.', 'ENCERRADA');
    if (now() > op.validadeAte) return fail('Oferta encerrada por prazo.', 'PRAZO');
    if (fin.status !== 'ativo') return fail('Cadastro do financiador não está ativo.');
    if (op.canal === 'balcao' && op.financiadorAlvoId !== finId) return fail('Operação exclusiva de outro financiador (Balcão).');
    const ced = db.get('orgs', op.cedenteId); if ((ced.bloqueados || []).includes(finId)) return fail('O cedente não aceita ofertas deste financiador.');
    taxaAm = r2(taxaAm);
    if (!(taxaAm > 0)) return fail('Informe uma taxa maior que zero.');
    const melhor = E.melhorLance(opId); const passo = cfg().passoMinLance;
    if (melhor && taxaAm > r2(melhor.taxaAm - passo) + 1e-9) return fail(`Leilão reverso: a oferta precisa ser menor que ${fmt.taxa(melhor.taxaAm)} (passo mínimo ${fmt.taxa(passo)}). Máximo aceito agora: ${fmt.taxa(r2(melhor.taxaAm - passo))}`, 'LANCE_ALTO');
    const pol = E.checarPolitica(finId, op, taxaAm);
    if (!pol.ok) return fail('Fora da sua política de crédito: ' + pol.motivos[0], 'POLITICA');
    const met = E.metricasOp(op, taxaAm);
    if (met.liquido <= 0) return fail('Taxa inválida para o prazo.');
    let lance;
    db.batch(() => {
      db.where('lances', (l) => l.opId === opId && l.status === 'ativo').forEach((l) => {
        db.patch('lances', l.id, { status: 'superado', superadoPor: finId, superadoEm: now() });
        if (l.finId !== finId) notify.send({ to: { orgId: l.finId }, tipo: 'alerta', titulo: `Sua oferta em ${opId} foi superada`, corpo: `Nova melhor taxa: ${fmt.taxa(taxaAm)}`, link: '/financiador/vitrine/' + opId });
      });
      lance = db.put('lances', { id: C.uid('lc'), opId, finId, taxaAm, criadoEm: now(), firmeAte: now() + cfg().firmezaHoras * 3600e3, status: 'ativo', auto, userId: userId || null, liquido: met.liquido, cetAm: met.cetAm });
      ledger.append({ actor: actor || (auto ? A.motor('Política de crédito (lance automático)') : A.user(userId)), acao: 'lance.registrado', entidade: { kind: 'operacao', id: opId }, resumo: `${fin.fantasia || fin.nome} ofertou ${fmt.taxa(taxaAm)} em ${opId} (líquido ${fmt.brl(met.liquido)})`, classe: 'R2', detalhe: { lanceId: lance.id, auto, firmeAte: lance.firmeAte } });
      notify.send({ to: { orgId: op.cedenteId }, tipo: 'info', titulo: `Nova oferta em ${opId}: ${fmt.taxa(taxaAm)}`, corpo: `${fmt.brl(met.liquido)} líquidos · ${op.canal === 'balcao' ? (fin.fantasia || fin.nome) : 'financiador anônimo até o aceite'}`, link: '/cedente/operacoes/' + opId });
    });
    if (op.tetoTaxa && taxaAm <= op.tetoTaxa + 1e-9 && E.flag('aceiteAutomatico')) {
      const r = E.aceitarLance(opId, lance.id, { auto: true });
      return Object.assign(r, { lance, aceiteAutomatico: true });
    }
    return ok({ lance });
  };

  E.retirarLance = function (lanceId, userId) {
    const l = db.get('lances', lanceId); if (!l) return fail('Oferta não encontrada');
    if (!['ativo', 'superado'].includes(l.status)) return fail('Oferta não está ativa.');
    if (now() < l.firmeAte) return fail(`Oferta firme: só pode ser retirada após ${fmt.time(l.firmeAte)} (${fmt.dur(l.firmeAte - now())}).`, 'FIRME');
    db.batch(() => {
      db.patch('lances', lanceId, { status: 'retirado', retiradoEm: now() });
      const m = E.melhorLance(l.opId); if (m && m.status !== 'ativo') db.patch('lances', m.id, { status: 'ativo' });
      ledger.append({ actor: A.user(userId), acao: 'lance.retirado', entidade: { kind: 'operacao', id: l.opId }, resumo: `Oferta de ${fmt.taxa(l.taxaAm)} retirada após o período de firmeza`, classe: 'R2' });
      notify.send({ to: { orgId: db.get('operacoes', l.opId).cedenteId }, tipo: 'alerta', titulo: `Oferta retirada em ${l.opId}`, corpo: m ? `Melhor oferta agora: ${fmt.taxa(m.taxaAm)}` : 'Sem ofertas ativas.', link: '/cedente/operacoes/' + l.opId });
    });
    return ok();
  };

  E.aceitarLance = function (opId, lanceId, { userId, auto = false, snapshotTela } = {}) {
    const op = db.get('operacoes', opId); const l = db.get('lances', lanceId);
    if (!op || !l) return fail('Operação ou oferta inválida'); if (op.status !== 'aberta') return fail('Operação não está em leilão.');
    if (!['ativo', 'superado'].includes(l.status)) return fail('Oferta não está mais disponível.');
    const melhor = E.melhorLance(opId); if (melhor && melhor.id !== l.id && !auto) return fail('Existe oferta com taxa menor. O aceite vale para a menor taxa no momento do aceite.', 'NAO_MELHOR');
    const met = E.metricasOp(op, l.taxaAm, now());
    const pg = E.prazoPagamento(now());
    const fin = db.get('orgs', l.finId); const ced = db.get('orgs', op.cedenteId);
    let contrato;
    db.batch(() => {
      db.where('lances', (x) => x.opId === opId && x.id !== l.id && ['ativo', 'superado'].includes(x.status)).forEach((x) => { db.patch('lances', x.id, { status: 'perdido' }); notify.send({ to: { orgId: x.finId }, tipo: 'info', titulo: `${opId} foi fechada com outra oferta`, link: '/financiador/lances' }); });
      db.patch('lances', l.id, { status: 'vencedor' });
      db.patch('operacoes', opId, { status: 'cessao', aceitaEm: now(), lanceVencedorId: l.id, financiadorId: l.finId, taxaFinal: l.taxaAm, prazoMedio: met.prazoMedio, desagioPct: met.desagioPct, desagio: met.desagioValor, liquido: met.liquido, cetAm: met.cetAm, ts: met.ts, tsPct: met.tsPct, tsNoPiso: met.tsNoPiso, pagamentoLimite: pg.limite, pagamentoMesmoDia: pg.mesmoDia, aceiteAutomatico: auto, saldoAberto: met.face });
      contrato = db.put('contratos', { id: 'CC-' + opId.slice(3), opId, status: 'gerado', versao: 'Cessão Cedy v0.1', geradoEm: now(), assinaturas: [], hashDoc: C.store.hash(opId + now()).toUpperCase(), partes: { cedenteId: op.cedenteId, financiadorId: l.finId } });
      db.patch('operacoes', opId, { contratoId: contrato.id });
      ledger.append({ actor: auto ? A.motor('Aceite automático (teto do cedente)') : A.user(userId), acao: 'operacao.aceita', entidade: { kind: 'operacao', id: opId }, resumo: `${auto ? 'Aceite automático' : 'Aceite'} da oferta ${fmt.taxa(l.taxaAm)} em ${opId}: líquido ${fmt.brl(met.liquido)}, CET ${fmt.taxa(met.cetAm)}, TS ${fmt.brl(met.ts)}`, classe: 'R3',
        snapshot: Object.assign({ tela: auto ? 'Teto de aceite automático configurado na publicação' : 'Aceite da oferta', versaoTela: 'ui-0.1', taxaAm: l.taxaAm, liquido: met.liquido, desagio: met.desagioValor, cetAm: r2(met.cetAm), regresso: op.regresso ? 'com regresso' : 'sem regresso', tsPct: met.tsPct, pagamentoPrevisto: fmt.datetime(pg.limite), termos: 'Termos Cedy 0.1 + Contrato de Cessão v0.1' }, snapshotTela || {}) });
      notify.send({ to: { orgId: l.finId }, tipo: 'sucesso', titulo: `Você venceu ${opId}`, corpo: `${fmt.taxa(l.taxaAm)}. Assine a cessão e pague até ${fmt.datetime(pg.limite)}.`, link: '/financiador/operacoes/' + opId });
      notify.send({ to: { orgId: op.cedenteId }, tipo: 'sucesso', titulo: auto ? `Aceite automático em ${opId}` : `Aceite registrado em ${opId}`, corpo: `Financiador: ${fin.fantasia || fin.nome}. Assine a cessão com certificado ICP-Brasil.`, link: '/cedente/operacoes/' + opId });
    });
    return ok({ contrato, metricas: met });
  };

  E.assinarContrato = function (contratoId, parte, userId, cert) {
    const c = db.get('contratos', contratoId); if (!c) return fail('Contrato não encontrado');
    if (c.assinaturas.some((s) => s.parte === parte)) return fail('Esta parte já assinou.');
    const u = db.get('users', userId);
    const sig = { parte, userId, nome: u.nome, em: now(), icp: Object.assign({ emissor: 'AC Certisign RFB G5', tipo: 'A3 (token)', serie: '4F2A' + Math.floor(1000 + Math.random() * 8999) }, cert || {}), hash: C.store.hash(c.hashDoc + userId + now()).toUpperCase() };
    db.batch(() => {
      const assin = c.assinaturas.concat([sig]);
      const completo = assin.length >= 2;
      db.patch('contratos', contratoId, { assinaturas: assin, status: completo ? 'assinado' : 'parcial', assinadoEm: completo ? now() : null });
      ledger.append({ actor: A.user(userId), acao: 'contrato.assinado', entidade: { kind: 'operacao', id: c.opId }, resumo: `${parte === 'cedente' ? 'Cedente' : 'Financiador'} assinou a cessão ${contratoId} com certificado ICP-Brasil`, classe: 'R3', detalhe: { hash: sig.hash, serie: sig.icp.serie } });
      const op = db.get('operacoes', c.opId);
      if (completo) {
        db.patch('operacoes', c.opId, { status: 'aguardando_pagamento' });
        notify.send({ to: { orgId: c.partes.financiadorId }, tipo: 'alerta', titulo: `Cessão ${contratoId} assinada: pague até ${fmt.datetime(op.pagamentoLimite)}`, link: '/financiador/operacoes/' + c.opId });
        notify.send({ to: { orgId: c.partes.cedenteId }, tipo: 'sucesso', titulo: `Cessão assinada por ambas as partes`, corpo: `Pagamento previsto até ${fmt.datetime(op.pagamentoLimite)}.`, link: '/cedente/operacoes/' + c.opId });
      } else {
        const outro = parte === 'cedente' ? c.partes.financiadorId : c.partes.cedenteId;
        notify.send({ to: { orgId: outro }, tipo: 'info', titulo: `Falta a sua assinatura em ${contratoId}`, link: (parte === 'cedente' ? '/financiador/operacoes/' : '/cedente/operacoes/') + c.opId });
      }
    });
    return ok({ completo: db.get('contratos', contratoId).status === 'assinado' });
  };

  /** Financiador paga direto ao cedente (D1: a Cedy não custodia). O banco parceiro confirma e o crédito aparece no extrato da conta de liquidação. */
  E.registrarPagamento = function (opId, userId) {
    const op = db.get('operacoes', opId); if (!op) return fail('Operação não encontrada');
    if (op.status !== 'aguardando_pagamento') return fail(op.status === 'cessao' ? 'Aguardando assinaturas da cessão.' : 'Operação não está aguardando pagamento.');
    const noPrazo = now() <= op.pagamentoLimite;
    const fin = db.get('orgs', op.financiadorId); const ced = db.get('orgs', op.cedenteId);
    db.batch(() => {
      db.patch('operacoes', opId, { status: 'paga', pagoEm: now(), pagamentoNoPrazo: noPrazo, atrasoAvisado: true });
      op.tituloIds.forEach((id) => db.patch('titulos', id, { status: 'cedido' }));
      db.put('extrato', { id: C.uid('ex'), orgId: op.cedenteId, ts: now(), valor: op.liquido, tipo: 'credito', pagadorNome: fin.nome, pagadorCnpj: fin.cnpj, descricao: `Antecipação ${opId}`, status: 'conciliado', matches: [{ opId, valor: op.liquido, natureza: 'antecipacao' }] });
      ledger.append({ actor: A.user(userId), acao: 'operacao.paga', entidade: { kind: 'operacao', id: opId }, resumo: `Financiador pagou ${fmt.brl(op.liquido)} ao cedente${noPrazo ? '' : ' (após o limite de ' + fmt.datetime(op.pagamentoLimite) + ')'}; titularidade dos créditos transferida`, classe: 'R3' });
      notify.send({ to: { orgId: op.cedenteId }, tipo: 'sucesso', titulo: `Recebido: ${fmt.brl(op.liquido)} (${opId})`, corpo: noPrazo ? 'Dentro do prazo.' : 'Pagamento após o limite previsto.', link: '/cedente/operacoes/' + opId });
      agendarPagamentosSacado(db.get('operacoes', opId));
    });
    return ok({ noPrazo });
  };

  /* --------------------- liquidação e conciliação (3 fatores) ------------ */
  // Simula o feed bancário: cada título cedido tem um plano de pagamento do sacado (determinístico por id).
  function agendarPagamentosSacado(op) {
    const r = C.rng(C.store.hash(op.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    const porSacado = C.groupBy(op.tituloIds.map((id) => db.get('titulos', id)).filter(Boolean), (t) => t.sacadoId + '|' + cal.key(t.vencimento));
    const plano = [];
    Object.values(porSacado).forEach((grupo) => {
      const venc = grupo[0].vencimento; const valor = r2(C.sum(grupo, (t) => t.valor)); const x = r();
      let ts = cal.spTs(cal.sp(venc).y, cal.sp(venc).m, cal.sp(venc).d, 11, 30), v = valor, cenario = 'exato';
      if (x > 0.82) { cenario = 'atrasado'; ts = cal.addUteis(ts, 2 + Math.floor(r() * 5)); }
      else if (x > 0.7) { cenario = 'parcial'; v = r2(valor * (0.6 + r() * 0.3)); }
      plano.push({ sacadoId: grupo[0].sacadoId, tituloIds: grupo.map((t) => t.id), ts: cal.toUtil(ts), valor: v, cenario, emitido: false });
    });
    db.patch('operacoes', op.id, { planoSacado: plano });
  }
  E.agendarPagamentosSacado = agendarPagamentosSacado;

  /** Cria uma linha no extrato da conta de liquidação (entrada do feed bancário) e roda a conciliação. */
  E.entradaExtrato = function ({ cedenteId, valor, pagadorCnpj, pagadorNome, ts, descricao }) {
    const l = db.put('extrato', { id: C.uid('ex'), orgId: cedenteId, ts: ts || now(), valor: r2(valor), tipo: 'credito', pagadorNome, pagadorCnpj, descricao: descricao || 'Crédito recebido', status: 'novo', matches: [] });
    E.conciliar(l.id);
    return db.get('extrato', l.id);
  };

  function abertoOp(op) { return r2(C.sum(op.tituloIds.map((id) => db.get('titulos', id)).filter((t) => t && !['liquidado', 'recomprado'].includes(t.status)), (t) => t.valor)); }
  E.saldoAberto = abertoOp;

  /**
   * Conciliação por 3 fatores (CM/AP): (1) fonte pagadora = CNPJ do sacado; (2) valor entre 50% e 110% do saldo aberto;
   * (3) data a partir de 2 dias antes do vencimento. Exato e único => liquida; vários exatos => empate (Mesa, 48h);
   * cobre tudo => rateio (vencidas primeiro) e sobra vira Recurso Livre; parcial/sem fonte => Mesa Conciliadora (24h).
   */
  E.conciliar = function (linhaId, { userId } = {}) {
    const l = db.get('extrato', linhaId); if (!l || !['novo', 'pendente_mesa'].includes(l.status)) return fail('Linha já tratada');
    const cedId = l.orgId; const tol = 0.5;
    const sac = db.where('orgs', (o) => o.kind === 'sacado' && o.cnpj.replace(/\D/g, '') === String(l.pagadorCnpj).replace(/\D/g, ''));
    const act = userId ? A.user(userId) : A.motor('Conciliação automática (3 fatores)');
    const abrir = (motivo, tipo, horas, sugestao) => {
      const caso = db.put('casosMesa', { id: C.uid('cm'), linhaId, cedenteId: cedId, tipo, motivo, abertoEm: now(), slaAte: now() + horas * 3600e3, status: 'aberto', sugestao: sugestao || null, valor: l.valor });
      db.patch('extrato', linhaId, { status: 'pendente_mesa', casoId: caso.id, motivo });
      ledger.append({ actor: act, acao: 'conciliacao.encaminhada', entidade: { kind: 'extrato', id: linhaId }, resumo: `Crédito de ${fmt.brl(l.valor)} encaminhado à Mesa Conciliadora: ${motivo}`, classe: 'R2' });
      notify.send({ to: { role: 'ops' }, tipo: 'alerta', titulo: 'Novo caso na Mesa Conciliadora', corpo: `${fmt.brl(l.valor)} · ${motivo}`, link: '/ops/conciliacao' });
      notify.send({ to: { orgId: cedId }, tipo: 'alerta', titulo: 'Crédito em análise pela Mesa Conciliadora', corpo: `${fmt.brl(l.valor)}: ${motivo}. Prazo de ${horas}h.`, link: '/cedente/conta' });
      return ok({ encaminhado: true, casoId: caso.id });
    };
    if (!sac.length) return abrir('fonte pagadora não identificada entre seus sacados', 'sem_fonte', 24);
    const sid = sac[0].id;
    const ops = db.where('operacoes', (o) => o.cedenteId === cedId && ['paga', 'vencida', 'parcial'].includes(o.status) && o.tituloIds.some((id) => (db.get('titulos', id) || {}).sacadoId === sid && !['liquidado', 'recomprado'].includes((db.get('titulos', id) || {}).status)));
    const cand = ops.map((o) => {
      const tits = o.tituloIds.map((id) => db.get('titulos', id)).filter((t) => t && t.sacadoId === sid && !['liquidado', 'recomprado'].includes(t.status) && t.vencimento <= l.ts + 2 * 86400000); // fator 3: data (vence até 2 dias depois do crédito)
      if (!tits.length) return null;
      const aberto = r2(C.sum(tits, (t) => t.valor)); const venc = Math.min(...tits.map((t) => t.vencimento));
      return { op: o, tits, aberto, venc, vencida: venc < cal.startOfDay(l.ts) };
    }).filter(Boolean);
    if (!cand.length) return abrir('pagamento sem vencimento compatível (data fora da janela)', 'sem_fonte', 24);
    const exatos = cand.filter((c) => Math.abs(c.aberto - l.valor) <= tol);
    const totalAberto = r2(C.sum(cand, (c) => c.aberto));
    const ordenado = cand.slice().sort((a, b) => (b.vencida - a.vencida) || (a.venc - b.venc));
    if (exatos.length === 1) { aplicar(l, [{ c: exatos[0], valor: exatos[0].aberto }], act); return ok({ conciliado: true }); }
    if (exatos.length > 1) return abrir(`empate: ${exatos.length} operações com o mesmo valor (${exatos.map((c) => c.op.id).join(', ')})`, 'empate', 48, { alocacoes: ordenado.slice(0, 1).map((c) => ({ opId: c.op.id, valor: c.aberto })), nota: 'Priorizar a operação vencida / mais antiga.' });
    if (l.valor >= totalAberto - tol) {
      aplicar(l, ordenado.map((c) => ({ c, valor: c.aberto })), act, r2(l.valor - totalAberto));
      return ok({ conciliado: true, rateio: true });
    }
    const dentroFaixa = cand.some((c) => l.valor >= c.aberto * 0.5 && l.valor <= c.aberto * 1.1) || (l.valor >= totalAberto * 0.5);
    if (dentroFaixa) {
      let restante = l.valor; const aloc = [];
      for (const c of ordenado) { if (restante <= 0.005) break; const v = r2(Math.min(restante, c.aberto)); aloc.push({ opId: c.op.id, valor: v, parcial: v < c.aberto }); restante = r2(restante - v); }
      return abrir(`pagamento parcial (${fmt.pct((l.valor / totalAberto) * 100, 0)} do saldo aberto de ${fmt.brl(totalAberto)})`, 'parcial', 24, { alocacoes: aloc, nota: 'Rateio sugerido: operações vencidas primeiro.' });
    }
    return abrir('valor fora da faixa de 50% a 110% do saldo aberto', 'valor', 24);
  };

  /** aplica alocações; sobra vira Recurso Livre; repasse ao financiador em até 1 dia útil. */
  function aplicar(linha, aloc, act, sobra = 0) {
    db.batch(() => {
      const matches = [];
      aloc.forEach(({ c, valor }) => {
        const op = db.get('operacoes', c.op.id); const pago = valor >= c.aberto - 0.5;
        let restante = valor;
        c.tits.slice().sort((a, b) => a.vencimento - b.vencimento).forEach((t) => { if (restante >= t.valor - 0.01) { db.patch('titulos', t.id, { status: 'liquidado', liquidadoEm: linha.ts }); restante = r2(restante - t.valor); } });
        const aberto = abertoOp(db.get('operacoes', op.id));
        const novoStatus = aberto <= 0.5 ? 'liquidada' : (op.status === 'vencida' ? 'vencida' : 'parcial');
        db.patch('operacoes', op.id, { status: novoStatus, saldoAberto: aberto, liquidadaEm: novoStatus === 'liquidada' ? linha.ts : op.liquidadaEm });
        matches.push({ opId: op.id, valor, natureza: pago ? 'liquidacao' : 'parcial' });
        const rp = cal.addUteis(Math.max(linha.ts, now()), 1);
        db.put('repasses', { id: C.uid('rp'), opId: op.id, finId: op.financiadorId, valor, criadoEm: now(), previstoPara: rp, status: 'agendado', linhaId: linha.id });
        notify.send({ to: { orgId: op.financiadorId }, tipo: 'sucesso', titulo: `Liquidação ${novoStatus === 'liquidada' ? 'total' : 'parcial'} de ${op.id}: ${fmt.brl(valor)}`, corpo: `Repasse previsto até ${fmt.date(rp)}.`, link: '/financiador/repasses' });
      });
      if (sobra > 0.5) matches.push({ opId: null, valor: sobra, natureza: 'recurso_livre' });
      db.patch('extrato', linha.id, { status: sobra > 0.5 ? 'recurso_livre' : 'conciliado', matches });
      ledger.append({ actor: act, acao: 'conciliacao.aplicada', entidade: { kind: 'extrato', id: linha.id }, resumo: `Crédito de ${fmt.brl(linha.valor)} conciliado em ${matches.filter((m) => m.opId).map((m) => m.opId).join(', ')}${sobra > 0.5 ? `; ${fmt.brl(sobra)} liberados como Recurso Livre` : ''}`, classe: 'R3' });
      notify.send({ to: { orgId: linha.orgId }, tipo: 'sucesso', titulo: `Crédito de ${fmt.brl(linha.valor)} conciliado`, corpo: sobra > 0.5 ? `${fmt.brl(sobra)} liberados como Recurso Livre.` : 'Liquidação registrada.', link: '/cedente/conta' });
    });
  }

  /** Mesa Conciliadora: aplica o rateio (sugerido ou editado). */
  E.resolverCaso = function (casoId, alocacoes, { userId, motivo } = {}) {
    const caso = db.get('casosMesa', casoId); if (!caso || caso.status !== 'aberto') return fail('Caso já resolvido');
    const l = db.get('extrato', caso.linhaId);
    const total = r2(C.sum(alocacoes, (a) => a.valor));
    if (total > l.valor + 0.01) return fail('A soma do rateio excede o valor do crédito.');
    const aloc = alocacoes.filter((a) => a.valor > 0).map((a) => {
      const op = db.get('operacoes', a.opId);
      const tits = op.tituloIds.map((id) => db.get('titulos', id)).filter((t) => t && !['liquidado', 'recomprado'].includes(t.status));
      return { c: { op, tits, aberto: r2(C.sum(tits, (t) => t.valor)) }, valor: a.valor };
    });
    const sobra = r2(l.valor - total);
    aplicar(l, aloc, A.user(userId), sobra);
    db.patch('casosMesa', casoId, { status: 'resolvido', resolvidoEm: now(), resolvidoPor: userId, motivo: motivo || null });
    return ok();
  };

  /** Recurso Livre passa a ser do cedente: sem retenção. */
  E.sacarRecursoLivre = (linhaId, userId) => { const l = db.get('extrato', linhaId); if (!l) return fail('Linha não encontrada'); db.patch('extrato', linhaId, { status: 'conciliado', liberadoEm: now() }); ledger.append({ actor: A.user(userId), acao: 'recurso_livre.liberado', entidade: { kind: 'extrato', id: linhaId }, resumo: 'Recurso Livre liberado para movimentação do cedente', classe: 'R2' }); return ok(); };

  /** Regresso: financiador aciona a recompra de operação vencida; cedente recompra. [INFERÊNCIA] encargos: multa 2% + mora 1% a.m. pro rata. */
  E.acionarRegresso = function (opId, userId) {
    const op = db.get('operacoes', opId); if (!op || !['vencida', 'parcial'].includes(op.status)) return fail('Operação não está vencida.');
    if (!op.regresso) return fail('Operação sem regresso: não há recompra.');
    if (op.regressoAcionado) return fail('Regresso já acionado.');
    const dias = Math.max(1, cal.daysBetween(Math.min(...op.tituloIds.map((id) => db.get('titulos', id).vencimento)), now()));
    const saldo = abertoOp(op); const encargos = r2(saldo * 0.02 + saldo * 0.01 * dias / 30);
    db.batch(() => {
      db.patch('operacoes', opId, { regressoAcionado: true, recompra: { valor: r2(saldo + encargos), saldo, encargos, ate: cal.addUteis(now(), 5), status: 'devida' } });
      ledger.append({ actor: A.user(userId), acao: 'regresso.acionado', entidade: { kind: 'operacao', id: opId }, resumo: `Regresso acionado em ${opId}: recompra de ${fmt.brl(saldo + encargos)} (saldo ${fmt.brl(saldo)} + encargos ${fmt.brl(encargos)})`, classe: 'R3' });
      notify.send({ to: { orgId: op.cedenteId }, tipo: 'erro', titulo: `Recompra devida: ${opId}`, corpo: `${fmt.brl(saldo + encargos)} até ${fmt.date(cal.addUteis(now(), 5))}.`, link: '/cedente/operacoes/' + opId });
    });
    return ok();
  };
  E.pagarRecompra = function (opId, userId) {
    const op = db.get('operacoes', opId); if (!op || !op.recompra || op.recompra.status !== 'devida') return fail('Sem recompra devida.');
    db.batch(() => {
      op.tituloIds.forEach((id) => { const t = db.get('titulos', id); if (t && t.status !== 'liquidado') db.patch('titulos', id, { status: 'recomprado' }); });
      db.patch('operacoes', opId, { status: 'recomprada', saldoAberto: 0, recompra: Object.assign({}, op.recompra, { status: 'paga', pagaEm: now() }) });
      db.put('repasses', { id: C.uid('rp'), opId, finId: op.financiadorId, valor: op.recompra.valor, criadoEm: now(), previstoPara: cal.addUteis(now(), 1), status: 'agendado', origem: 'recompra' });
      ledger.append({ actor: A.user(userId), acao: 'regresso.recompra_paga', entidade: { kind: 'operacao', id: opId }, resumo: `Recompra de ${opId} paga pelo cedente (${fmt.brl(op.recompra.valor)})`, classe: 'R3' });
      notify.send({ to: { orgId: op.financiadorId }, tipo: 'sucesso', titulo: `Recompra recebida: ${opId}`, corpo: fmt.brl(op.recompra.valor), link: '/financiador/repasses' });
    });
    return ok();
  };

  /* --------------------------- passagem do tempo ------------------------- */
  /** Idempotente. Chamado a cada poucos segundos e após saltos do relógio de simulação. */
  E.tick = function () {
    const t = now();
    db.batch(() => {
      // 1) ofertas que passaram da validade sem aceite
      db.where('operacoes', (o) => o.status === 'aberta' && t > o.validadeAte).forEach((o) => {
        db.patch('operacoes', o.id, { status: 'expirada', encerradaEm: t });
        o.tituloIds.forEach((id) => db.patch('titulos', id, { status: 'disponivel', operacaoId: null }));
        db.where('lances', (l) => l.opId === o.id && ['ativo', 'superado'].includes(l.status)).forEach((l) => db.patch('lances', l.id, { status: 'encerrado' }));
        ledger.append({ ts: t, actor: A.sistema('Relógio'), acao: 'operacao.expirada', entidade: { kind: 'operacao', id: o.id }, resumo: `Operação ${o.id} expirou sem aceite`, classe: 'R1' });
        notify.send({ to: { orgId: o.cedenteId }, tipo: 'alerta', titulo: `${o.id} expirou sem aceite`, corpo: 'Os títulos voltaram a ficar disponíveis.', link: '/cedente/titulos' });
      });
      // 2) pagamento do financiador em atraso
      db.where('operacoes', (o) => o.status === 'aguardando_pagamento' && t > o.pagamentoLimite && !o.atrasoAvisado).forEach((o) => {
        db.patch('operacoes', o.id, { atrasoAvisado: true });
        notify.send({ to: { orgId: o.cedenteId }, tipo: 'alerta', titulo: `Pagamento de ${o.id} em atraso`, corpo: 'O financiador não pagou até o limite. A Cedy já acionou o financiador.', link: '/cedente/operacoes/' + o.id });
        notify.send({ to: { orgId: o.financiadorId }, tipo: 'erro', titulo: `Pagamento de ${o.id} em atraso`, corpo: 'Regularize para evitar desistência e tarifa.', link: '/financiador/operacoes/' + o.id });
        ledger.append({ ts: t, actor: A.sistema('Relógio'), acao: 'operacao.pagamento_atrasado', entidade: { kind: 'operacao', id: o.id }, resumo: `Pagamento de ${o.id} passou do limite (${fmt.datetime(o.pagamentoLimite)})`, classe: 'R2' });
      });
      // 3) feed bancário simulado: pagamentos de sacados com data ≤ agora
      db.where('operacoes', (o) => ['paga', 'vencida', 'parcial'].includes(o.status) && o.planoSacado).forEach((o) => {
        let changed = false;
        o.planoSacado.forEach((p) => {
          if (p.emitido || p.ts > t) return;
          p.emitido = true; changed = true;
          const s = db.get('orgs', p.sacadoId);
          E.entradaExtrato({ cedenteId: o.cedenteId, valor: p.valor, pagadorCnpj: s.cnpj, pagadorNome: s.nome, ts: p.ts, descricao: p.cenario === 'parcial' ? 'Pagamento duplicata (parcial)' : 'Pagamento duplicata' });
        });
        if (changed) db.patch('operacoes', o.id, { planoSacado: o.planoSacado });
      });
      // 4) vencimento sem pagamento => vencida
      db.where('operacoes', (o) => ['paga', 'parcial'].includes(o.status)).forEach((o) => {
        const venc = o.tituloIds.map((id) => db.get('titulos', id)).filter((x) => x && !['liquidado', 'recomprado'].includes(x.status));
        if (venc.length && venc.every((x) => x.vencimento + 86400000 < t) || (venc.some((x) => x.vencimento + 86400000 < t) && o.status === 'paga')) {
          venc.filter((x) => x.vencimento + 86400000 < t).forEach((x) => db.patch('titulos', x.id, { status: 'vencido' }));
          db.patch('operacoes', o.id, { status: 'vencida', saldoAberto: abertoOp(o) });
          ledger.append({ ts: t, actor: A.sistema('Relógio'), acao: 'operacao.vencida', entidade: { kind: 'operacao', id: o.id }, resumo: `Operação ${o.id} vencida com saldo em aberto de ${fmt.brl(abertoOp(o))}`, classe: 'R2' });
          notify.send({ to: { orgId: o.financiadorId }, tipo: 'alerta', titulo: `${o.id} vencida sem liquidação`, corpo: o.regresso ? 'Você pode acionar o regresso.' : 'Operação sem regresso.', link: '/financiador/operacoes/' + o.id });
          notify.send({ to: { orgId: o.cedenteId }, tipo: 'alerta', titulo: `${o.id} vencida sem liquidação`, corpo: 'Verifique com o sacado.', link: '/cedente/operacoes/' + o.id });
        }
      });
      // 5) repasses agendados vencidos viram "pago"
      db.where('repasses', (r) => r.status === 'agendado' && r.previstoPara <= t).forEach((r) => db.patch('repasses', r.id, { status: 'pago', pagoEm: r.previstoPara }));
      // 6) lotes: Mesa simulada decide no fim do SLA se não houve decisão humana (apenas lotes sem erro)
      if (cfg().mesaSimulada) db.where('lotes', (l) => l.status === 'validando' && t >= l.slaAte).forEach((l) => E.decidirLote(l.id, 'aprovar', { actor: A.user('u-ops-1'), motivo: null }));
    });
  };

  /* ------------------------- mercado simulado --------------------------- */
  // Outros financiadores dão lances em operações abertas, dentro da própria política; o financiador da persona
  // só recebe lance automático quando habilitou o "lance automático" na política (decisão do motor, não da IA).
  E.mercadoTick = function (forcar) {
    if (!E.mercadoAberto()) return;
    if (!forcar && !C.store.prefs.market) return;
    const abertas = db.where('operacoes', (o) => o.status === 'aberta' && o.canal === 'vitrine' && now() < o.validadeAte);
    if (!abertas.length) return;
    const sess = C.store.session.get();
    const fins = db.where('orgs', (o) => o.kind === 'financiador' && o.status === 'ativo');
    const op = abertas[Math.floor(Math.random() * abertas.length)];
    const f = fins[Math.floor(Math.random() * fins.length)];
    const isPersona = sess && sess.orgId === f.id;
    if (isPersona && !(f.politica && f.politica.autoLance && f.politica.autoLance.ativo && E.flag('lanceAutomatico'))) return;
    if (Math.random() > 0.55 && !forcar) return;
    const m = E.melhorLance(op.id);
    const base = m ? m.taxaAm : (1.9 + Math.random() * 0.9);
    const piso = (f.politica && f.politica.taxaMinima) || 1.2;
    const taxa = r2(base - (0.01 + Math.floor(Math.random() * 5) * 0.01));
    if (taxa < piso) return;
    if (m && m.finId === f.id) return;
    E.darLance(op.id, f.id, taxa, { auto: isPersona, actor: A.motor(isPersona ? 'Política de crédito (lance automático)' : 'Mercado simulado') });
  };

  /* --------------------------- fechamento mensal ------------------------- */
  /** Gera faturas de TS/Taxa de Acesso por financiador e premiações por originador para a competência 'AAAA-MM'. */
  E.fecharMes = function (comp, { userId } = {}) {
    const [y, m] = comp.split('-').map(Number);
    const ini = cal.spTs(y, m, 1, 0, 0), fim = cal.spTs(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0);
    const ops = db.where('operacoes', (o) => o.pagoEm && o.pagoEm >= ini && o.pagoEm < fim);
    const criadas = { faturas: 0, premiacoes: 0 };
    db.batch(() => {
      const porFin = C.groupBy(ops, (o) => o.financiadorId);
      db.where('orgs', (o) => o.kind === 'financiador').forEach((f) => {
        if (db.where('faturas', (x) => x.finId === f.id && x.competencia === comp).length) return;
        const lista = porFin[f.id] || [];
        const mesesAtivo = Math.floor((fim - (f.ativoDesde || ini)) / (30 * 86400000));
        const carencia = mesesAtivo <= cfg().carenciaMeses;
        const isento = lista.length >= 1;
        const taxaAcesso = (carencia || isento) ? 0 : cfg().taxaAcessoMensal;
        const tsTotal = r2(C.sum(lista, (o) => o.ts));
        const total = r2(tsTotal + taxaAcesso);
        if (!lista.length && taxaAcesso === 0) return;
        db.put('faturas', { id: `FT-${comp}-${f.id.slice(-2)}`, finId: f.id, competencia: comp, itens: lista.map((o) => ({ opId: o.id, face: o.face, ts: o.ts, tsPct: o.tsPct, noPiso: o.tsNoPiso })), tsTotal, taxaAcesso, taxaAcessoMotivo: taxaAcesso ? 'cobrada' : carencia ? 'carência' : 'isenta (≥1 operação paga)', total, emitidaEm: fim, vencimento: cal.toUtil(fim + 10 * 86400000), status: total > 0 ? 'aberta' : 'isenta', boleto: '34191.' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') + ' 1' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') + ' 0' });
        criadas.faturas++;
      });
      const porCed = C.groupBy(ops, (o) => o.cedenteId);
      Object.entries(porCed).forEach(([cid, lista]) => {
        const ced = db.get('orgs', cid); if (!ced || !ced.indicadoPor) return;
        if (db.where('premiacoes', (p) => p.origId === ced.indicadoPor && p.cedenteId === cid && p.competencia === comp).length) return;
        const base = r2(C.sum(lista, (o) => o.ts));
        const primeira = Math.min(...db.where('operacoes', (o) => o.cedenteId === cid && o.pagoEm).map((o) => o.pagoEm));
        const dentro24 = (fim - primeira) < cfg().premiacaoJanelaMeses * 30 * 86400000;
        const ativo = db.where('operacoes', (o) => o.cedenteId === cid && o.pagoEm && o.pagoEm >= fim - cfg().inatividadeDias * 86400000).length >= 1;
        const indic = dentro24 ? r2(base * cfg().premiacaoIndicacao) : 0; const gest = ativo ? r2(base * cfg().premiacaoGestao) : 0;
        db.put('premiacoes', { id: C.uid('pm'), origId: ced.indicadoPor, cedenteId: cid, competencia: comp, baseTS: base, indicacao: indic, gestao: gest, total: r2(indic + gest), subId: E.splitSub(ced).subId, splitPct: E.splitSub(ced).splitPct, parteSub: r2((indic + gest) * E.splitSub(ced).splitPct / 100), parteOrig: r2((indic + gest) - r2((indic + gest) * E.splitSub(ced).splitPct / 100)), nOps: lista.length, status: 'apurado', relatorioEm: cal.nthUtil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 5), pagamentoEm: cal.toUtil(cal.spTs(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 20, 12, 0)), contestavelAte: cal.nthUtil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 5) + 10 * 86400000 });
        criadas.premiacoes++;
      });
      ledger.append({ actor: userId ? A.user(userId) : A.motor('Apuração mensal'), acao: 'mes.fechado', entidade: { kind: 'competencia', id: comp }, resumo: `Competência ${comp} apurada: ${criadas.faturas} fatura(s) de TS/acesso e ${criadas.premiacoes} premiação(ões) de originadores`, classe: 'R2' });
    });
    return ok(criadas);
  };

  /* ---------------------- IA (somente propõe; motor decide) -------------- */
  /** Sacado confirma ou contesta o título (programa Confia / lastro). */
  E.confirmarSacado = function (tituloId, decisao, userId, motivo) {
    const t = db.get('titulos', tituloId); if (!t) return fail('Título não encontrado');
    const ced = db.get('orgs', t.orgId); const sac = db.get('orgs', t.sacadoId);
    db.batch(() => {
      const contestado = decisao !== 'aceito';
      db.patch('titulos', tituloId, Object.assign({ lastro: Object.assign({}, t.lastro, { aceiteSacado: contestado ? 'contestado' : 'aceito', aceiteEm: now(), aceiteMotivo: motivo || null }), flags: (t.flags || []).filter((f) => f.codigo !== 'AGUARDA_SACADO').concat(contestado ? [{ nivel: 'erro', codigo: 'CONTESTADO', msg: 'Sacado contestou a NF-e' + (motivo ? ': ' + motivo : '.') }] : []) },
        contestado && ['validando', 'disponivel'].includes(t.status) ? { status: 'recusado', temErro: true, motivoRecusa: 'Contestado pelo sacado' + (motivo ? ': ' + motivo : '') } : {}));
      ledger.append({ actor: A.user(userId), acao: decisao === 'aceito' ? 'titulo.confirmado_sacado' : 'titulo.contestado_sacado', entidade: { kind: 'titulo', id: tituloId }, resumo: `${sac.fantasia} ${decisao === 'aceito' ? 'confirmou' : 'contestou'} ${t.numero} (${fmt.brl(t.valor)})${motivo ? ': ' + motivo : ''}`, classe: 'R2' });
      notify.send({ to: { orgId: t.orgId }, tipo: decisao === 'aceito' ? 'sucesso' : 'erro', titulo: `${sac.fantasia} ${decisao === 'aceito' ? 'confirmou' : 'contestou'} ${t.numero}`, corpo: decisao === 'aceito' ? 'O título pode entrar em uma operação.' : (motivo || 'Veja o motivo.'), link: '/cedente/titulos' });
    });
    return ok();
  };

  E.ia = {
    /** Agente de Precificação: sugere teto/taxa ao cedente com base no histórico de lances fechados do produto. */
    sugerirTaxa(op) {
      const fechadas = db.where('operacoes', (o) => o.taxaFinal && o.produto === op.produto);
      const taxas = fechadas.map((o) => o.taxaFinal).sort((a, b) => a - b);
      const med = taxas.length ? taxas[Math.floor(taxas.length / 2)] : 1.85;
      const p25 = taxas.length ? taxas[Math.floor(taxas.length * 0.25)] : med - 0.15;
      const p75 = taxas.length ? taxas[Math.floor(taxas.length * 0.75)] : med + 0.2;
      const ajuste = (op.prazoMedio || 45) > 90 ? 0.12 : (op.prazoMedio || 45) < 30 ? -0.05 : 0;
      return { sugerida: r2(med + ajuste), faixa: [r2(p25 + ajuste), r2(p75 + ajuste)], amostra: taxas.length, confianca: Math.min(0.95, 0.5 + taxas.length * 0.04),
        racional: [`Mediana das últimas ${taxas.length} operações ${op.produto}: ${fmt.taxa(med)}`, ajuste ? `Ajuste de prazo (${op.prazoMedio}d): ${ajuste > 0 ? '+' : ''}${fmt.taxa(ajuste)}` : 'Prazo na faixa típica, sem ajuste', 'Sugestão apenas: o aceite e o teto são decisões suas.'] };
    },
    /** Agente de Crédito do financiador: parecer sobre uma oportunidade; o lance só ocorre pelo motor/humano. */
    parecer(op, finId) {
      const pol = E.checarPolitica(finId, op, null); const m = pol.metricas || E.metricasOp(op, 1.8);
      const sacs = [...new Set(op.tituloIds.map((id) => (db.get('titulos', id) || {}).sacadoId))].map((id) => db.get('orgs', id)).filter(Boolean);
      const pior = sacs.reduce((a, s) => ('ABCD'.indexOf(s.rating) > 'ABCD'.indexOf(a) ? s.rating : a), 'A');
      const score = Math.max(0, Math.min(100, Math.round(92 - 'ABCD'.indexOf(pior) * 14 - Math.max(0, m.prazoMedio - 60) * 0.15 - (op.regresso ? 0 : 12) - pol.motivos.length * 15)));
      const piso = (db.get('orgs', finId).politica || {}).taxaMinima || 1.5;
      const rec = r2(Math.max(piso, 1.55 + 'ABCD'.indexOf(pior) * 0.28 + Math.max(0, m.prazoMedio - 45) * 0.004));
      const melhor = E.melhorLance(op.id);
      return { score, taxaSugerida: rec, cobreMelhor: melhor ? r2(melhor.taxaAm - cfg().passoMinLance) : null, pior, politica: pol,
        racional: [...pol.aprovados.slice(0, 3), ...pol.motivos, `Pior rating entre sacados: ${pior}`, op.regresso ? 'Operação com regresso reduz risco de crédito' : 'Sem regresso: risco do sacado integral'], confianca: 0.62 + score / 300 };
    },
  };

  /* ====================== Plataforma: modo de mercado e funcionalidades ===================== */
  /** Funcionalidade ligada? (config.flags[nome] !== false) */
  E.flag = (nome) => ((cfg().flags || {})[nome]) !== false;
  E.mercadoAberto = () => !cfg().mercadoPausado;

  /* ====================== Subparceiros (originador de 2º nível) ===================== */
  /** Quanto da premiação de um indicado vai ao subparceiro (apenas subparceiro ativo). Congelado na apuração da competência. */
  E.splitSub = function (ced) {
    const sub = ced && ced.subparceiroId && db.get('subparceiros', ced.subparceiroId);
    return sub && sub.status === 'ativo' ? { subId: sub.id, splitPct: sub.splitPct || 0 } : { subId: sub ? sub.id : null, splitPct: 0 };
  };
  E.SPLIT_MIN = 10; E.SPLIT_MAX = 70;

  /* ====================== Aprovação em dois passos (quatro olhos) ===================== */
  E.APROVACAO_TIPOS = {
    config: { label: 'Parâmetro da plataforma', classe: 'R2' },
    programa: { label: 'Versão de programa de produto', classe: 'R2' },
    autonomia: { label: 'Autonomia de agente', classe: 'R3' },
    premiacao_pagar: { label: 'Pagamento de premiação', classe: 'R3' },
    fatura_isentar: { label: 'Isenção de fatura', classe: 'R2' },
  };
  /** Quem não é Superadmin pede; outro Superadmin aprova. payload define o efeito; antes/depois são só para exibir. */
  E.solicitarAprovacao = function ({ tipo, titulo, resumo, payload, antes, depois, userId, motivo }) {
    const t = E.APROVACAO_TIPOS[tipo]; if (!t) return fail('Tipo de solicitação desconhecido.');
    if (!motivo || String(motivo).trim().length < 10) return fail('Explique o motivo (mínimo de 10 caracteres).');
    const a = db.put('aprovacoes', { id: 'AP-' + String(db.all('aprovacoes').length + 1).padStart(4, '0'), tipo, classe: t.classe, titulo, resumo, payload, antes: antes || null, depois: depois || null, solicitanteId: userId, solicitadoEm: now(), expiraEm: cal.addUteis(now(), 5), status: 'pendente', motivo });
    ledger.append({ actor: A.user(userId), acao: 'aprovacao.solicitada', entidade: { kind: 'aprovacao', id: a.id }, resumo: `Solicitação ${a.id}: ${titulo}`, classe: t.classe, detalhe: { motivo } });
    notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: 'Nova solicitação para aprovação: ' + titulo, corpo: resumo || '', link: '/super/aprovacoes' });
    return ok({ aprovacao: a });
  };
  E.aplicadoresAprovacao = {
    config: (p) => db.setCfg(p.patch),
    programa: (p) => { db.put('produtos', p.produto); },
    autonomia: (p) => db.patch('agentes', p.agenteId, p.patch),
    premiacao_pagar: (p) => (p.ids || []).forEach((id) => db.patch('premiacoes', id, { status: 'pago', pagoEm: now() })),
    fatura_isentar: (p) => db.patch('faturas', p.faturaId, { status: 'isenta', isentaMotivo: p.motivo || null, isentaEm: now() }),
  };
  E.decidirAprovacao = function (id, decisao, userId, motivo) {
    const a = db.get('aprovacoes', id); if (!a) return fail('Solicitação não encontrada.');
    if (a.status !== 'pendente') return fail('Solicitação já decidida.');
    if (a.solicitanteId === userId) return fail('Dois olhos: quem solicitou não pode aprovar a própria solicitação.', 'MESMA_PESSOA');
    const u = db.get('users', userId); if (!u || u.perfil !== 'superadmin') return fail('Só o Superadmin decide solicitações.', 'SEM_PERMISSAO');
    if (decisao === 'rejeitar' && (!motivo || motivo.trim().length < 5)) return fail('Informe o motivo da rejeição.');
    db.batch(() => {
      if (decisao === 'aprovar') E.aplicadoresAprovacao[a.tipo](a.payload);
      db.patch('aprovacoes', id, { status: decisao === 'aprovar' ? 'aprovada' : 'rejeitada', decididoPor: userId, decididoEm: now(), motivoDecisao: motivo || null });
      ledger.append({ actor: A.user(userId), acao: decisao === 'aprovar' ? 'aprovacao.aprovada' : 'aprovacao.rejeitada', entidade: { kind: 'aprovacao', id }, resumo: `${decisao === 'aprovar' ? 'Aprovada' : 'Rejeitada'} a solicitação ${id}: ${a.titulo}${motivo ? ' (' + motivo + ')' : ''}`, classe: a.classe, snapshot: { antes: a.antes, depois: a.depois } });
      notify.send({ to: { userId: a.solicitanteId }, tipo: decisao === 'aprovar' ? 'sucesso' : 'alerta', titulo: `Solicitação ${decisao === 'aprovar' ? 'aprovada' : 'rejeitada'}: ${a.titulo}`, corpo: motivo || '', link: '/ops/solicitacoes' });
    });
    return ok();
  };

  /* ====================== "Ver como": acesso de suporte, somente leitura e auditado ===================== */
  E.iniciarVerComo = function ({ alvoUserId, justificativa, minutos }) {
    const S = C.store.session; const sess = S.get(); if (!sess) return fail('Sem sessão.');
    if (sess.impersonando) return fail('Já existe um acesso "ver como" ativo.');
    const por = db.get('users', sess.userId); if (!C.can('ops.verComo') && !(por && por.perfil === 'superadmin')) return fail('Sem permissão para "ver como".', 'SEM_PERMISSAO');
    if (!justificativa || justificativa.trim().length < 15) return fail('Escreva a justificativa (mínimo de 15 caracteres): ela fica na trilha e o cliente é avisado.');
    const alvo = db.get('users', alvoUserId); const org = alvo && db.get('orgs', alvo.orgId);
    if (!alvo || !org || org.kind === 'cedy') return fail('Usuário inválido: só é possível ver como usuário de empresa cliente.');
    const max = (cfg().seguranca || {}).verComoMaxMin || 30; const min = Math.min(Math.max(5, minutos || 15), max);
    ledger.append({ actor: A.user(por.id), acao: 'acesso.ver_como_iniciado', entidade: { kind: 'usuario', id: alvo.id }, resumo: `${por.nome} iniciou "ver como" ${alvo.nome} (${org.fantasia || org.nome}) por ${min} min. Justificativa: ${justificativa}`, classe: 'R3', detalhe: { justificativa, minutos: min } });
    db.put('eventosSeg', { id: C.uid('es'), ts: now(), tipo: 'ver_como', userId: por.id, orgId: org.id, severidade: 'alta', ip: '10.20.0.14', detalhe: `${por.nome} entrou como ${alvo.nome}: ${justificativa}` });
    notify.send({ to: { orgId: org.id }, tipo: 'alerta', titulo: 'Acesso de suporte da Cedy à sua conta', corpo: `${por.nome} acessou a conta em modo somente leitura por até ${min} min. Motivo: ${justificativa}`, link: '/' + C.roleOfOrg(org) + '/notificacoes' });
    S.set({ userId: alvo.id, orgId: alvo.orgId, role: C.roleOfOrg(org), impersonando: { por: { userId: por.id, orgId: por.orgId, role: sess.role }, ate: now() + min * 60e3, justificativa, alvoUserId: alvo.id } });
    return ok({ rota: C.homeFor(S.get()) });
  };
  E.encerrarVerComo = function (motivo) {
    const S = C.store.session; const sess = S.get(); if (!sess || !sess.impersonando) return fail('Nenhum acesso "ver como" ativo.');
    const im = sess.impersonando; const por = db.get('users', im.por.userId); const alvo = db.get('users', im.alvoUserId);
    ledger.append({ actor: A.user(por.id), acao: 'acesso.ver_como_encerrado', entidade: { kind: 'usuario', id: alvo.id }, resumo: `${por.nome} encerrou "ver como" ${alvo.nome}${motivo ? ' (' + motivo + ')' : ''}`, classe: 'R3' });
    S.set({ userId: por.id, orgId: por.orgId, role: im.por.role });
    C.router.resetStack(); C.router.go(C.homeFor(S.get()));
    return ok();
  };

  /* Somente leitura no "ver como": as funções que mudam estado recusam enquanto o acesso está ativo */
  ['importarTitulos', 'decidirLote', 'criarOperacao', 'cancelarOperacao', 'darLance', 'retirarLance', 'aceitarLance', 'assinarContrato', 'registrarPagamento', 'resolverCaso', 'sacarRecursoLivre', 'acionarRegresso', 'pagarRecompra', 'confirmarSacado', 'fecharMes', 'solicitarAprovacao', 'decidirAprovacao'].forEach((n) => {
    const f = E[n]; E[n] = function (...args) { const s = C.store.session.get(); if (s && s.impersonando) return { ok: false, erro: 'Modo "ver como": somente leitura.', codigo: 'SOMENTE_LEITURA' }; return f.apply(E, args); };
  });

  /* Relógio: expira "ver como" e solicitações vencidas */
  const tick0 = E.tick;
  E.tick = function () {
    tick0();
    const s = C.store.session.get(); if (s && s.impersonando && now() > s.impersonando.ate) E.encerrarVerComo('expirou');
    db.where('aprovacoes', (a) => a.status === 'pendente' && now() > a.expiraEm).forEach((a) => db.patch('aprovacoes', a.id, { status: 'expirada' }));
  };

  C.engine = E;
})();
