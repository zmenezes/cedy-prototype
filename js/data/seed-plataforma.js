/* =========================================================================
   Cedy protótipo 0.1, extensão 0.2: Superadmin e Subparceiros.
   Chamado no fim de seed.build(): o store já está ativo (C.store.db,
   C.store.ledger, C.engine, C.rng, C.cal) e o relógio parado em
   C.clock.start (23/11/2026 10:12 BRT). Tudo determinístico (rng com
   semente fixa) e nenhum timestamp além de clock.start, exceto os
   campos prospectivos (prazoAte, expiraEm, retencaoAte).
   Nomes de empresas e pessoas fictícios.
   ========================================================================= */
(function () {
  window.Cedy.seedPlataforma = function (S) {
    const C = window.Cedy;
    const T = C.cal.spTs;
    const NOW = C.clock.start;
    const DAY = 86400000;
    const rnd = C.rng(20261124);
    const r2 = C.round2;
    const db = C.store.db, ledger = C.store.ledger;
    const d = (m, dd, h, mi) => T(2026, m, dd, h === undefined ? 10 : h, mi === undefined ? 0 : mi);
    const actor = (id) => ({ tipo: 'humano', id, nome: S.users[id] ? S.users[id].nome : id });
    const tel = () => '(11) 9' + String(6000 + Math.floor(rnd() * 3999)) + '-' + String(1000 + Math.floor(rnd() * 8999));

    /* ------------------------- 1. config ------------------------- */
    Object.assign(S.config, {
      mercadoPausado: false,
      manutencao: { ativo: false, msg: '', ate: null },
      flags: { vitrine: true, balcao: true, importacao: true, aceiteAutomatico: true, lanceAutomatico: true, agentes: true, novosCadastros: true },
      seguranca: { doisFatoresObrigatorio: true, sessaoMinutos: 60, senhaMin: 10, tentativasMax: 5, ipAllowlistInternos: true, verComoMaxMin: 30 },
      retencao: { ledgerAnos: 5, logsAdminDias: 90, logsAcessoMeses: 6, documentosKycAnos: 5, extratoAnos: 5, backupsDias: 35, titularesAnos: 5 },
      ia: { provedorPadrao: 'mdl-1', residenciaBR: true, tetoCustoMesBRL: 4000, fallback: true },
    });

    /* ------------------------- 2. usuários Cedy ------------------------- */
    S.users['u-ops-1'].papel = 'mesa';
    S.users['u-ops-2'].papel = 'conciliadora';
    Object.assign(S.users['u-ops-3'], { papel: 'compliance', demo: true });
    const usr = (o) => { S.users[o.id] = Object.assign({ twofa: true, demo: true, telefone: tel() }, o); };
    usr({ id: 'u-super-1', nome: 'Henrique Castro', email: 'henrique.castro@cedy.com.br', cargo: 'Diretor de tecnologia e plataforma', orgId: 'org-cedy', perfil: 'superadmin', papel: 'super', hue: 210, ultimoAcesso: NOW - 2 * 3600e3 });
    usr({ id: 'u-super-2', nome: 'Larissa Nogueira', email: 'larissa.nogueira@cedy.com.br', cargo: 'Head de risco e dados', orgId: 'org-cedy', perfil: 'superadmin', papel: 'super', hue: 280, ultimoAcesso: NOW - 5 * 3600e3 });
    usr({ id: 'u-ops-4', nome: 'Rodrigo Pacheco', email: 'rodrigo.pacheco@cedy.com.br', cargo: 'Analista financeiro', orgId: 'org-cedy', perfil: 'operador', papel: 'financeiro', hue: 35, ultimoAcesso: NOW - 1 * 3600e3 });
    usr({ id: 'u-ops-5', nome: 'Camila Duarte', email: 'camila.duarte@cedy.com.br', cargo: 'Analista de suporte', orgId: 'org-cedy', perfil: 'operador', papel: 'suporte', hue: 180, ultimoAcesso: NOW - 30 * 60e3 });
    usr({ id: 'u-ops-6', nome: 'Gabriel Moura', email: 'gabriel.moura@cedy.com.br', cargo: 'Auditor interno', orgId: 'org-cedy', perfil: 'leitor', papel: 'auditor', hue: 10, ultimoAcesso: NOW - 3 * DAY });
    // Achados para a revisão de usuários: 1 acesso há > 60 dias, 1 sem 2FA
    S.users['u-ops-7'] = { id: 'u-ops-7', nome: 'Paulo Henrique Sampaio', email: 'paulo.sampaio@cedy.com.br', cargo: 'Analista de operações', orgId: 'org-cedy', perfil: 'operador', papel: 'mesa', demo: false, twofa: true, hue: 55, ultimoAcesso: NOW - 75 * DAY, telefone: tel() };
    S.users['u-ops-8'] = { id: 'u-ops-8', nome: 'Fernanda Lima', email: 'fernanda.lima@cedy.com.br', cargo: 'Analista de suporte júnior', orgId: 'org-cedy', perfil: 'operador', papel: 'suporte', demo: false, twofa: false, hue: 320, ultimoAcesso: NOW - 2 * DAY, telefone: tel() };

    /* ------------------------- 3. subparceiros ------------------------- */
    const conta = (banco, agencia, contaN, titular) => ({ banco, agencia, conta: contaN, titular });
    const SP = [
      { id: 'sp-1', origId: 'o-lumen', nome: 'Marques & Antunes Assessoria Ltda', tipo: 'PJ', doc: '12345678000190', email: 'contato@marquesantunes.com.br', telefone: '(11) 3456-7890', regiao: 'Sudeste · SP', status: 'ativo', splitPct: 30, desde: T(2026, 4, 14, 10, 0), conviteEm: T(2026, 3, 20, 10, 0), ultimaAtividade: NOW - 2 * DAY, observacao: 'Indicador recorrente no setor industrial.', historicoSplit: [{ ts: T(2026, 4, 14, 10, 0), de: 25, para: 30, por: 'u-lumen-1' }], contaRepasse: conta('341 Itaú', '0421', '77812-3', 'Marques & Antunes Assessoria Ltda') },
      { id: 'sp-2', origId: 'o-lumen', nome: 'Patrícia Gomes de Souza', tipo: 'PF', doc: '38245678900', email: 'patricia@pgconsult.com.br', telefone: '(41) 99812-4455', regiao: 'Sul · PR', status: 'ativo', splitPct: 25, desde: T(2026, 9, 8, 10, 0), conviteEm: T(2026, 8, 11, 10, 0), ultimaAtividade: NOW - 5 * DAY, observacao: 'Atua com autopeças no interior do Paraná.', historicoSplit: [{ ts: T(2026, 9, 8, 10, 0), de: 20, para: 25, por: 'u-lumen-1' }], contaRepasse: conta('001 Banco do Brasil', '3310', '55410-8', 'Patrícia Gomes de Souza') },
      { id: 'sp-3', origId: 'o-lumen', nome: 'Rota Oeste Negócios Ltda', tipo: 'PJ', doc: '23456789000171', email: 'contato@rotaoeste.com.br', telefone: '(62) 3201-5566', regiao: 'Centro-Oeste · GO', status: 'ativo', splitPct: 40, desde: T(2026, 6, 9, 10, 0), conviteEm: T(2026, 5, 19, 10, 0), ultimaAtividade: NOW - 9 * DAY, observacao: 'Foco em transporte e logística.', historicoSplit: [{ ts: T(2026, 6, 9, 10, 0), de: 35, para: 40, por: 'u-lumen-1' }], contaRepasse: conta('237 Bradesco', '1102', '90314-0', 'Rota Oeste Negócios Ltda') },
      { id: 'sp-4', origId: 'o-lumen', nome: 'João Pedro Ferreira', tipo: 'PF', doc: '45678912355', email: 'jp.ferreira@mailbr.com.br', telefone: '(81) 98744-2010', regiao: 'Nordeste · PE', status: 'convidado', splitPct: 20, desde: T(2026, 9, 25, 10, 0), conviteEm: T(2026, 9, 10, 10, 0), ultimaAtividade: NOW - 12 * DAY, observacao: 'Aguardando aceite do termo de subparceria.', historicoSplit: [], contaRepasse: conta('260 Nu Pagamentos', '0001', '8812304-5', 'João Pedro Ferreira') },
      { id: 'sp-5', origId: 'o-lumen', nome: 'Atlântica Fomento e Serviços Ltda', tipo: 'PJ', doc: '34567890000182', email: 'contato@atlanticafomento.com.br', telefone: '(21) 2210-8899', regiao: 'Sudeste · RJ', status: 'suspenso', splitPct: 35, desde: T(2026, 5, 12, 10, 0), conviteEm: T(2026, 4, 22, 10, 0), ultimaAtividade: NOW - 85 * DAY, observacao: 'Suspenso por inatividade: sem indicados ativos há mais de 60 dias.', historicoSplit: [{ ts: T(2026, 5, 12, 10, 0), de: 30, para: 35, por: 'u-lumen-1' }], contaRepasse: conta('341 Itaú', '8840', '11209-1', 'Atlântica Fomento e Serviços Ltda') },
    ];
    SP.forEach((s) => { S.subparceiros[s.id] = s; });
    // Ligações com cedentes e convites existentes
    S.orgs['c-aurora'].subparceiroId = 'sp-1';
    S.orgs['c-tecnoparts'].subparceiroId = 'sp-2';
    S.orgs['c-vale'].subparceiroId = 'sp-1';
    S.convites['cv-1'].subId = 'sp-1'; S.convites['cv-2'].subId = 'sp-2'; S.convites['cv-3'].subId = 'sp-1';
    const newCv = (id, nome, email, cnpj, status, subId, diasAtras, atuDepoisDias) => {
      const env = NOW - diasAtras * DAY;
      S.convites[id] = { id, origId: 'o-lumen', subId, nome, email, cnpj, status, enviadoEm: env, orgId: null, ultimaAtividade: Math.min(NOW - 1 * 3600e3, env + atuDepoisDias * DAY) };
      ledger.append({ ts: env, actor: actor('u-lumen-1'), acao: 'convite.criado', entidade: { kind: 'convite', id }, resumo: `Convite criado para ${nome} (${email}) via subparceiro ${subId}`, classe: 'R1' });
    };
    newCv('cv-10', 'Vidraçaria Prisma Ltda', 'contato@vidracariaprisma.com.br', '45678901000163', 'convidado', 'sp-1', 6, 4);
    newCv('cv-11', 'FarmaVida Distribuidora Ltda', 'contato@farmavida.com.br', '56789012000174', 'cadastrado', 'sp-2', 21, 9);
    newCv('cv-12', 'Metalfort Estruturas S.A.', 'contato@metalfort.com.br', '67890123000185', 'inativo', 'sp-3', 60, 20);
    newCv('cv-13', 'Café Serra Alta Ltda', 'contato@cafeserraalta.com.br', '78901234000196', 'convidado', 'sp-1', 2, 1);
    // Histórico de splits na trilha
    SP.forEach((s) => s.historicoSplit.forEach((hh) => {
      ledger.append({ ts: hh.ts, actor: actor(hh.por), acao: 'subparceiro.split_alterado', entidade: { kind: 'subparceiro', id: s.id }, resumo: `Repasse de ${s.nome} ajustado de ${hh.de}% para ${hh.para}%`, classe: 'R2', detalhe: { de: hh.de, para: hh.para } });
    }));
    // Retrofit das premiações: congela o split vigente na competência
    const subOf = { 'c-aurora': 'sp-1', 'c-tecnoparts': 'sp-2', 'c-vale': 'sp-1' };
    Object.values(S.premiacoes).forEach((p) => {
      const sid = subOf[p.cedenteId]; if (!sid) return;
      const sub = S.subparceiros[sid];
      const [y, m] = p.competencia.split('-').map(Number);
      const compStart = T(y, m, 1, 0, 0);
      const ds = C.cal.sp(sub.desde);
      const vigente = compStart >= T(ds.y, ds.m, 1, 0, 0);
      const pct = vigente ? sub.splitPct : 0;
      p.subId = sid; p.splitPct = pct;
      p.parteSub = r2(p.total * pct / 100);
      p.parteOrig = r2(p.total - p.parteSub);
    });
    // Usuários subparceiros (menu reduzido do originador)
    S.users['u-sub-1'] = { id: 'u-sub-1', nome: 'Marcelo Antunes', email: 'marcelo@marquesantunes.com.br', cargo: 'Subparceiro (Sudeste)', orgId: 'o-lumen', perfil: 'subparceiro', subId: 'sp-1', demo: true, twofa: true, hue: 95, ultimoAcesso: NOW - 4 * 3600e3, telefone: '(11) 97654-3210' };
    S.users['u-sub-2'] = { id: 'u-sub-2', nome: 'Patrícia Gomes', email: 'patricia@pgconsult.com.br', cargo: 'Subparceira (Sul)', orgId: 'o-lumen', perfil: 'subparceiro', subId: 'sp-2', demo: true, twofa: true, hue: 160, ultimoAcesso: NOW - 26 * 3600e3, telefone: '(41) 99812-4455' };

    /* ------------------------- 4. aprovações ------------------------- */
    const putAp = (a) => { S.aprovacoes[a.id] = a; return a; };
    const sol = (id, tipo, titulo, resumo, payload, antes, depois, solicitanteId, solicitadoEm, motivo, expira) => {
      const t = C.engine.APROVACAO_TIPOS[tipo];
      const a = putAp({ id, tipo, classe: t.classe, titulo, resumo, payload, antes, depois, solicitanteId, solicitadoEm, expiraEm: expira === undefined ? C.cal.addUteis(solicitadoEm, 5) : expira, status: 'pendente', motivo, decididoPor: null, decididoEm: null, motivoDecisao: null });
      ledger.append({ ts: solicitadoEm, actor: actor(solicitanteId), acao: 'aprovacao.solicitada', entidade: { kind: 'aprovacao', id }, resumo: `Solicitação ${id}: ${titulo}`, classe: t.classe, detalhe: { motivo } });
      return a;
    };
    const dec = (a, decisao, por, em, motivoDecisao) => {
      a.status = decisao === 'aprovar' ? 'aprovada' : 'rejeitada';
      a.decididoPor = por; a.decididoEm = em; a.motivoDecisao = motivoDecisao || null;
      ledger.append({ ts: em, actor: actor(por), acao: decisao === 'aprovar' ? 'aprovacao.aprovada' : 'aprovacao.rejeitada', entidade: { kind: 'aprovacao', id: a.id }, resumo: `${decisao === 'aprovar' ? 'Aprovada' : 'Rejeitada'} a solicitação ${a.id}: ${a.titulo}${motivoDecisao ? ' (' + motivoDecisao + ')' : ''}`, classe: a.classe, snapshot: { antes: a.antes, depois: a.depois } });
    };
    // Pendentes
    sol('AP-0001', 'config', 'Reajustar SELIC de 14,00% para 14,25% a.a.', 'Acompanhar a alta da meta SELIC na precificação das operações.', { patch: { selicAa: 14.25 } }, { selicAa: 14.0 }, { selicAa: 14.25 }, 'u-ops-1', d(11, 21, 9, 30), 'A meta SELIC subiu e a precificação precisa acompanhar para preservar o spread.');
    const premAtual = S.produtos.premium;
    const premNovo = Object.assign({}, premAtual, { ticketMin: 15000, versao: premAtual.versao + 1, vigenteDesde: d(11, 20, 9, 0), historico: premAtual.historico.concat([{ versao: premAtual.versao, vigenteDesde: premAtual.vigenteDesde, tsPct: premAtual.tsPct, nota: 'Versão anterior' }]) });
    sol('AP-0002', 'programa', 'Reduzir o ticket mínimo do Cedy Premium para R$ 15 mil', '11 títulos recusados por ticket nos últimos 30 dias, 7 com sacados rating A.', { produto: premNovo }, { ticketMin: 20000, versao: premAtual.versao }, { ticketMin: 15000, versao: premNovo.versao }, 'u-ops-3', d(11, 20, 14, 0), 'Ampliar a elegibilidade do Premium sem mexer no spread: proposta do agente de pré-validação.');
    const paraPagar = Object.values(S.premiacoes).filter((p) => ['aprovado', 'pago'].includes(p.status)).sort((a, b) => (a.status === b.status ? (a.competencia < b.competencia ? 1 : -1) : (a.status === 'aprovado' ? -1 : 1))).slice(0, 2).map((p) => p.id);
    sol('AP-0003', 'premiacao_pagar', 'Pagar 2 premiações apuradas de outubro', 'Premiações conferidas pela Mesa, aguardando liberação do Superadmin.', { ids: paraPagar }, null, null, 'u-ops-4', NOW - 8 * 3600e3, 'Competência de outubro apurada e sem contestação: liberar o pagamento do dia 20.');
    // Prestes a expirar
    sol('AP-0004', 'autonomia', 'Elevar o Agente de Precificação a assistido', 'O agente saiu da sombra com 58 execuções e sugere tetos aderentes ao histórico.', { agenteId: 'ag-preco', patch: { nivel: 'assistido' } }, { nivel: 'sombra' }, { nivel: 'assistido' }, 'u-ops-2', NOW - 4 * DAY, 'A sombra convergiu com o resultado real: liberar sugestões assistidas com revisão humana.', NOW + 2 * 3600e3);
    // Decididas (quatro olhos: quem pediu não decide)
    const h1 = sol('AP-0005', 'config', 'Elevar o piso de premiação para R$ 150', 'Evitar micro-pagamentos cujo custo operacional supera o repasse.', { patch: { premiacaoMinima: 150 } }, { premiacaoMinima: 100 }, { premiacaoMinima: 150 }, 'u-ops-4', d(10, 14, 11, 0), 'Custo de TED e conciliação supera o valor nas faixas abaixo de R$ 150.');
    dec(h1, 'aprovar', 'u-super-2', d(10, 16, 15, 30), 'De acordo: vale a partir da competência de novembro.');
    Object.assign(S.config, h1.payload.patch);
    const h2 = sol('AP-0006', 'programa', 'Abrir o Cedy Contrato para operação sem regresso', 'Pedido de um financiador âncora para lotes com medição aprovada.', { produto: Object.assign({}, S.produtos.contrato, { permiteSemRegresso: true }) }, { permiteSemRegresso: true }, { permiteSemRegresso: true }, 'u-ops-1', d(10, 20, 10, 0), 'Financiador âncora condicionou volume à dispensa de regresso em lotes com medição.');
    dec(h2, 'rejeitar', 'u-super-2', d(10, 22, 16, 0), 'Programa Contrato mantém regresso obrigatório: risco de medição contestada.');
    const fatIsenta = Object.values(S.faturas).filter((f) => ['aberta', 'vencida'].includes(f.status) && f.total > 0)[0] || Object.values(S.faturas).filter((f) => f.total > 0)[0];
    const h3 = sol('AP-0007', 'fatura_isentar', 'Isentar fatura de Taxa de Acesso', 'Cobrança em duplicidade no mês de carência do financiador.', { faturaId: fatIsenta.id, motivo: 'Cobrança em duplicidade no mês de carência.' }, { status: fatIsenta.status }, { status: 'isenta' }, 'u-ops-4', d(9, 18, 11, 0), 'Fatura emitida em duplicidade dentro do período de carência: corrigir antes do vencimento.');
    dec(h3, 'aprovar', 'u-super-1', d(9, 21, 10, 0), 'Comprovada a duplicidade no extrato do mês.');
    db.patch('faturas', fatIsenta.id, { status: 'isenta', isentaMotivo: h3.payload.motivo, isentaEm: h3.decididoEm });
    const h4 = sol('AP-0008', 'premiacao_pagar', 'Antecipar pagamento de premiação de setembro', 'Originador pediu adiantamento por fluxo de caixa.', { ids: paraPagar.slice(0, 1) }, null, null, 'u-ops-4', d(10, 6, 10, 0), 'Originador com fluxo apertado pediu o adiantamento da parcela de setembro.');
    dec(h4, 'rejeitar', 'u-super-1', d(10, 7, 17, 0), 'Calendário do dia 20 vale para todos: sem exceção fora do contrato.');
    const h5 = sol('AP-0009', 'config', 'Estender a firmeza da oferta para 6h', 'Dar mais tempo ao cedente em operações do Balcão.', { patch: { firmezaHoras: 6 } }, { firmezaHoras: 3 }, { firmezaHoras: 6 }, 'u-ops-1', d(9, 2, 9, 0), 'Cedentes do Balcão pediram mais tempo para comparar a oferta firme com o banco.');
    dec(h5, 'rejeitar', 'u-super-2', d(9, 4, 12, 0), 'Firmeza maior trava o leilão: manter 3h e reavaliar no próximo trimestre.');

    /* ------------------------- 5. serviços ------------------------- */
    const serie = (latBase, latVar, reqBase, errBase) => {
      const lat = [], erro = [], reqs = [];
      for (let i = 0; i < 24; i++) {
        const pico = (i >= 9 && i <= 17) ? 1.35 : 0.55;
        lat.push(Math.round((latBase + (rnd() - 0.5) * latVar) * 10) / 10);
        erro.push(Math.round((Math.max(0.001, errBase * pico + (rnd() - 0.5) * errBase)) * 1000) / 1000);
        reqs.push(Math.round(reqBase * pico * (0.8 + rnd() * 0.4)));
      }
      return { lat, erro, reqs };
    };
    const svc = (o) => { S.servicos[o.id] = Object.assign({ sloAlvo: 99.5, tipo: 'interno', provedor: 'Cedy (interno)', regiao: 'sa-east-1', residenciaBR: true, simulado: false, status: 'operacional', ultimaChecagem: NOW - 5 * 60e3 }, o); };
    svc({ id: 'svc-api', nome: 'API REST', descricao: 'Camada de ferramentas REST da plataforma.', disp30d: 99.97, latP95ms: 180, taxaErro: 0.02, serie: serie(180, 60, 4200, 0.02) });
    svc({ id: 'svc-mcp', nome: 'Camada MCP (ferramentas)', descricao: 'Ferramentas dos agentes sobre o motor.', disp30d: 99.95, latP95ms: 240, taxaErro: 0.03, serie: serie(240, 80, 1900, 0.03) });
    svc({ id: 'svc-db', nome: 'Banco de dados (Postgres)', descricao: 'Transacional da plataforma.', disp30d: 99.99, latP95ms: 22, taxaErro: 0.001, serie: serie(22, 9, 15500, 0.001) });
    svc({ id: 'svc-fila', nome: 'Fila e jobs', descricao: 'Conciliação, extratos e apurações assíncronas.', disp30d: 99.93, latP95ms: 900, taxaErro: 0.05, serie: serie(900, 300, 640, 0.05) });
    svc({ id: 'svc-regras', nome: 'Motor de regras', descricao: 'Elegibilidade, leilão, aceite e prazos.', disp30d: 99.98, latP95ms: 95, taxaErro: 0.01, serie: serie(95, 30, 2300, 0.01) });
    svc({ id: 'svc-conciliacao', nome: 'Motor de conciliação', descricao: 'Três fatores, rateio e Recurso Livre.', disp30d: 99.91, latP95ms: 310, taxaErro: 0.06, serie: serie(310, 90, 480, 0.06) });
    svc({ id: 'svc-gateway-ia', nome: 'Gateway de IA', tipo: 'ia', descricao: 'Roteamento, guarda e custo dos agentes.', disp30d: 99.9, latP95ms: 1100, taxaErro: 0.08, serie: serie(1100, 350, 700, 0.08) });
    svc({ id: 'svc-llm-a', nome: 'Modelo de linguagem A', tipo: 'ia', provedor: 'Provedor B (nuvem EUA)', descricao: 'Avaliação em sombra, sem dados pessoais.', status: 'operacional', disp30d: 99.96, latP95ms: 1400, taxaErro: 0.04, serie: serie(1400, 400, 320, 0.04), regiao: 'us-east-1', residenciaBR: false });
    svc({ id: 'svc-llm-b', nome: 'Modelo de linguagem B', tipo: 'ia', provedor: 'Provedor A (nuvem BR)', descricao: 'Modelo padrão dos agentes em produção.', status: 'operacional', disp30d: 99.94, latP95ms: 1250, taxaErro: 0.05, serie: serie(1250, 380, 610, 0.05) });
    svc({ id: 'svc-receita', nome: 'Receita Federal (consulta CNPJ)', tipo: 'integracao', provedor: 'Receita Federal', descricao: 'Situação cadastral do CNPJ no KYC.', status: 'degradado', disp30d: 98.7, latP95ms: 4800, taxaErro: 2.4, serie: serie(4800, 2200, 90, 2.4), simulado: true });
    svc({ id: 'svc-scr', nome: 'SCR / Bacen', tipo: 'integracao', provedor: 'Banco Central', descricao: 'Endividamento e histórico de crédito.', status: 'operacional', disp30d: 99.88, latP95ms: 1600, taxaErro: 0.12, serie: serie(1600, 500, 140, 0.12), simulado: true });
    svc({ id: 'svc-restritivos', nome: 'Birô de restritivos', tipo: 'integracao', provedor: 'Birô de crédito', descricao: 'Protestos e apontamentos de sócios.', status: 'operacional', disp30d: 99.82, latP95ms: 1900, taxaErro: 0.15, serie: serie(1900, 600, 120, 0.15), simulado: true });
    svc({ id: 'svc-icp', nome: 'ICP-Brasil', tipo: 'integracao', provedor: 'AC Certisign', descricao: 'Assinatura da cessão de crédito.', status: 'operacional', disp30d: 99.99, latP95ms: 700, taxaErro: 0.01, serie: serie(700, 200, 60, 0.01), simulado: true });
    svc({ id: 'svc-bmp', nome: 'Banco parceiro (BMP)', tipo: 'integracao', provedor: 'BMP (Money Plus)', descricao: 'Conta de liquidação e confirmação de TED.', status: 'operacional', disp30d: 99.78, latP95ms: 950, taxaErro: 0.2, serie: serie(950, 280, 880, 0.2), simulado: true });
    svc({ id: 'svc-registradora', nome: 'Registradora de recebíveis', tipo: 'integracao', provedor: 'Registradora', descricao: 'Registro e unicidade dos recebíveis.', status: 'operacional', disp30d: 99.86, latP95ms: 1300, taxaErro: 0.1, serie: serie(1300, 400, 200, 0.1), simulado: true });
    svc({ id: 'svc-email', nome: 'E-mail transacional', tipo: 'integracao', provedor: 'Provedor de e-mail', descricao: 'Lembretes, comprovantes e avisos.', status: 'operacional', disp30d: 99.42, latP95ms: 600, taxaErro: 0.35, serie: serie(600, 220, 1500, 0.35), simulado: true });
    svc({ id: 'svc-whatsapp', nome: 'WhatsApp', tipo: 'integracao', provedor: 'Provedor de mensageria', descricao: 'Régua de cobrança e avisos curtos.', status: 'operacional', disp30d: 99.65, latP95ms: 850, taxaErro: 0.28, serie: serie(850, 260, 2100, 0.28), simulado: true });

    /* ------------------------- 6. incidentes ------------------------- */
    const inc = (o) => { S.incidentes[o.id] = o; };
    const L = (ts, autor, texto) => ({ ts, autor, texto });
    inc({ id: 'INC-2026-036', titulo: 'Lentidão na consulta de CNPJ (Receita Federal)', severidade: 'S2', status: 'monitorando', servicoIds: ['svc-receita'], inicioEm: d(11, 23, 8, 50), resolvidoEm: null, impacto: 'KYC de 3 empresas aguardando validação; consultas levam até 40 s.', causa: 'Em apuração: timeouts intermitentes no endpoint de consulta.', avisoClientesEm: null, posmortem: null,
      linha: [L(d(11, 23, 8, 50), 'Monitoramento', 'Alerta: p95 da consulta CNPJ acima de 4 s por 15 min.'), L(d(11, 23, 9, 5), 'Henrique Castro', 'Confirmada degradação no provedor; rotas de KYC enfileiradas, sem perda.'), L(d(11, 23, 9, 40), 'Camila Duarte', 'Aviso interno à Mesa: validar lotes sem a certidão enquanto durar.'), L(d(11, 23, 10, 0), 'Henrique Castro', 'Latência caindo após retry com backoff; segue em monitoramento.')] });
    inc({ id: 'INC-2026-031', titulo: 'Banco parceiro (BMP) indisponível', severidade: 'S1', status: 'resolvido', servicoIds: ['svc-bmp'], inicioEm: d(10, 14, 13, 12), resolvidoEm: d(10, 14, 13, 59), impacto: 'Confirmação de TED indisponível por 47 min; 2 pagamentos reagendados.', causa: 'Falha no link do parceiro (lado BMP).', avisoClientesEm: d(10, 14, 14, 30),
      linha: [L(d(10, 14, 13, 12), 'Monitoramento', ' Erros 5xx no webhook do BMP.'), L(d(10, 14, 13, 40), 'Henrique Castro', 'Contingência: conciliação pausada, repasses mantidos na fila.'), L(d(10, 14, 13, 59), 'Henrique Castro', 'Parceiro normalizado; fila reprocessada sem duplicidade.')],
      posmortem: { causa: 'Instabilidade no data center do parceiro, fora da Cedy.', acoes: 'Reprocessamento idempotente da fila e alerta dedicado ao webhook do BMP.', licoes: 'Resposta em 2h e aviso ao cliente em 36h cumpridos (metas da plataforma: RPO 8h, RTO 12h, disponibilidade 99,5%).' } });
    inc({ id: 'INC-2026-032', titulo: 'Conciliador lento no pico da manhã', severidade: 'S2', status: 'resolvido', servicoIds: ['svc-conciliacao', 'svc-fila'], inicioEm: d(9, 28, 9, 10), resolvidoEm: d(9, 28, 11, 40), impacto: 'Rateios com até 2h30 de atraso; nenhum vencimento perdido.', causa: 'Fila represada após reprocessamento do extrato.', avisoClientesEm: null,
      linha: [L(d(9, 28, 9, 10), 'Monitoramento', 'Atraso na fila de conciliação acima do SLO.'), L(d(9, 28, 11, 40), 'Henrique Castro', 'Fila drenada após escala de workers; tempos normais.')],
      posmortem: { causa: 'Consumidor da fila subdimensionado no pico.', acoes: 'Autoscale da fila e teto de reprocessamento por minuto.', licoes: 'SLO de conciliação revisto no painel de serviços.' } });
    inc({ id: 'INC-2026-033', titulo: 'E-mail transacional com atraso', severidade: 'S3', status: 'resolvido', servicoIds: ['svc-email'], inicioEm: d(9, 9, 8, 0), resolvidoEm: d(9, 9, 12, 20), impacto: 'Lembretes de vencimento entregues com até 4h de atraso.', causa: 'Fila do provedor de e-mail.', avisoClientesEm: null, posmortem: null,
      linha: [L(d(9, 9, 8, 0), 'Monitoramento', 'Taxa de entrega de e-mail abaixo de 98%.'), L(d(9, 9, 12, 20), 'Camila Duarte', 'Provedor normalizado; régua resincronizada.')] });
    inc({ id: 'INC-2026-034', titulo: 'Timeouts no gateway de IA', severidade: 'S2', status: 'resolvido', servicoIds: ['svc-gateway-ia', 'svc-llm-b'], inicioEm: d(8, 27, 15, 5), resolvidoEm: d(8, 27, 16, 50), impacto: 'Propostas de 6 lotes atrasadas; Mesa decidiu sem o resumo do agente.', causa: 'Pico de tokens no modelo padrão.', avisoClientesEm: null,
      linha: [L(d(8, 27, 15, 5), 'Monitoramento', 'P95 do gateway acima de 8 s.'), L(d(8, 27, 16, 50), 'Larissa Nogueira', 'Fallback para fila com retry; propostas retomadas.')],
      posmortem: { causa: 'Cota de tokens do provedor estourada no pico da tarde.', acoes: 'Fallback automático e teto mensal de custo (R$ 4.000) com alerta em 80%.', licoes: 'Agentes nunca bloqueiam a Mesa: proposta atrasada não trava decisão.' } });
    inc({ id: 'INC-2026-035', titulo: 'Entrega parcial de WhatsApp (operadora)', severidade: 'S3', status: 'resolvido', servicoIds: ['svc-whatsapp'], inicioEm: d(8, 12, 10, 30), resolvidoEm: d(8, 12, 13, 0), impacto: '12 lembretes reenviados por e-mail.', causa: 'Instabilidade na operadora em SP.', avisoClientesEm: null, posmortem: null,
      linha: [L(d(8, 12, 10, 30), 'Monitoramento', 'Confirmações de entrega abaixo de 90%.'), L(d(8, 12, 13, 0), 'Camila Duarte', 'Canal normalizado; pendências reenviadas.')] });

    /* ------------------------- 7. backups ------------------------- */
    const startDay = C.cal.startOfDay(NOW);
    const lastSunday = (ts) => { let x = C.cal.startOfDay(ts); while (C.cal.sp(x).wd !== 0) x -= DAY; const p = C.cal.sp(x); return T(p.y, p.m, p.d, 18, 0); };
    const mkbk = (ts, tipo, size, dur, status, suf) => {
      const p = C.cal.sp(ts);
      let id = 'bk-' + p.y + String(p.m).padStart(2, '0') + String(p.d).padStart(2, '0') + '-' + (tipo === 'completo' ? 'full' : String(p.h).padStart(2, '0') + 'h') + (suf || '');
      if (S.backups[id]) id += '-r2';
      S.backups[id] = { id, ts, tipo, tamanhoMB: Math.round(size * 10) / 10, duracaoS: Math.round(dur), status, retencaoAte: ts + 35 * DAY, restoreTestadoEm: tipo === 'completo' ? lastSunday(ts) : null };
    };
    for (let i = 34; i >= 0; i--) {
      const dayTs = startDay - i * DAY; const p = C.cal.sp(dayTs); const ts = T(p.y, p.m, p.d, 2, 0);
      const size = 6800 + (34 - i) * 52 + rnd() * 120;
      if (i === 9) { mkbk(ts, 'completo', size, size / 42, 'falhou'); mkbk(ts + 37 * 60e3, 'completo', size, size / 40, 'verificado', '-r2'); }
      else mkbk(ts, 'completo', size, size / 42, i > 7 ? 'verificado' : 'ok');
    }
    [8, 14, 20].forEach((h) => { mkbk(T(2026, 11, 21, h, 0), 'incremental', 380 + rnd() * 90, 150 + rnd() * 90, 'ok'); mkbk(T(2026, 11, 22, h, 0), 'incremental', 390 + rnd() * 90, 150 + rnd() * 90, 'ok'); });
    mkbk(T(2026, 11, 23, 8, 0), 'incremental', 395 + rnd() * 80, 160 + rnd() * 80, 'ok');

    /* ------------------------- 8. titulares (LGPD) ------------------------- */
    const mktit = (id, nome, tipoT, orgId, tipo, abertaEm, status, resp, base, resposta) => {
      S.titulares[id] = { id, titularNome: nome, titularTipo: tipoT, orgId, tipo, status, abertaEm, prazoAte: abertaEm + 15 * DAY, responsavelId: resp, baseLegal: base || null, resposta: resposta || null };
    };
    const GUARDA = 'Obrigação legal de guarda por 5 anos (LC 105 / regulação de crédito)';
    mktit('LGPD-001', 'Marina Aguiar', 'usuario', 'c-aurora', 'acesso', NOW - 13 * DAY, 'recebida', 'u-super-2');
    mktit('LGPD-002', 'Diego Matos', 'usuario', 'c-aurora', 'correcao', NOW - 14 * DAY, 'recebida', 'u-ops-3');
    mktit('LGPD-003', 'Gustavo Lemos', 'usuario', 'c-tecnoparts', 'exclusao', d(10, 30, 10, 15), 'em_analise', 'u-super-2');
    mktit('LGPD-004', 'Rosângela Pires', 'representante', 'c-sertao', 'portabilidade', d(10, 12, 9, 0), 'atendida', 'u-ops-3', GUARDA, 'Dados exportados em CSV e enviados ao e-mail cadastrado em 20/10/2026.');
    mktit('LGPD-005', 'Rafael Tavares', 'usuario', 'f-vertice', 'correcao', d(10, 5, 14, 30), 'atendida', 'u-ops-3', 'Consentimento do titular', 'Telefone e cargo atualizados em 09/10/2026.');
    mktit('LGPD-006', 'Carlos Bastos', 'usuario', 'o-lumen', 'exclusao', d(9, 28, 11, 0), 'negada', 'u-super-2', GUARDA, 'Exclusão negada: dados de originador seguem guardados por 5 anos (LC 105), mantido só o mínimo necessário.');
    mktit('LGPD-007', 'Ana Paula Ribeiro', 'usuario', 's-boacompra', 'revogacao', d(10, 20, 16, 10), 'atendida', 'u-ops-3', 'Consentimento do titular', 'Revogação do aceite de marketing registrada em 22/10/2026; dados operacionais mantidos.');
    mktit('LGPD-008', 'Sérgio Bittencourt', 'socio', 'o-norte', 'oposicao', d(9, 15, 10, 40), 'negada', 'u-super-2', GUARDA, 'Oposição improcedente: tratamento amparado em obrigação legal e execução de contrato.');

    /* ------------------------- 9. eventos de segurança ------------------------- */
    let esN = 0;
    const mkes = (ts, tipo, userId, orgId, ip, sev, detalhe) => { const id = 'es-' + String(++esN).padStart(3, '0'); S.eventosSeg[id] = { id, ts, tipo, userId, orgId, ip, severidade: sev, detalhe }; };
    const tAtk = d(11, 2, 3, 12);
    for (let k = 0; k < 6; k++) mkes(tAtk + k * 97e3, 'login_falho', 'u-tecno-1', 'c-tecnoparts', '45.227.19.44', k < 4 ? 'media' : 'alta', 'Senha incorreta (' + (k + 1) + 'a tentativa em minutos, fora do horário comercial)');
    mkes(tAtk + 9 * 60e3, 'ip_bloqueado', 'u-tecno-1', 'c-tecnoparts', '45.227.19.44', 'alta', 'IP bloqueado por 24h após 6 falhas seguidas; conta preservada, sem invasão.');
    mkes(d(11, 4, 9, 20), 'login_falho', 'u-aurora-2', 'c-aurora', '187.44.12.9', 'baixa', 'Senha incorreta, seguida de acesso bem-sucedido.');
    mkes(d(11, 10, 18, 44), 'login_falho', 'u-boa-2', 's-boacompra', '177.92.201.55', 'baixa', 'Senha incorreta, seguida de acesso bem-sucedido.');
    mkes(d(11, 15, 8, 2), 'login_falho', 'u-vertice-2', 'f-vertice', '189.33.77.210', 'media', '3 falhas seguidas e troca de senha em seguida.');
    mkes(d(11, 21, 7, 58), 'login_falho', 'u-lumen-2', 'o-lumen', '191.18.90.4', 'baixa', 'Senha incorreta, seguida de acesso bem-sucedido.');
    mkes(d(10, 26, 10, 11), 'mfa_reset', 'u-vertice-2', 'f-vertice', '10.20.0.14', 'media', 'Segundo fator reemitido após troca de aparelho, com validação por e-mail.');
    mkes(d(11, 6, 15, 33), 'mfa_reset', 'u-sertao-1', 'c-sertao', '10.20.0.14', 'media', 'Segundo fator reemitido após perda do aparelho, com validação por telefone.');
    mkes(d(11, 18, 9, 12), 'mfa_reset', 'u-ops-8', 'org-cedy', '10.20.0.14', 'baixa', 'Primeira ativação do segundo fator da conta.');
    mkes(d(11, 3, 10, 3), 'mfa_reset', 'u-horizonte-1', 'c-horizonte', '10.20.0.14', 'baixa', 'Segundo fator reemitido após troca de aparelho.');
    mkes(d(10, 20, 8, 14), 'login_falho', 'u-campo-1', 'c-campo', '177.15.66.8', 'baixa', 'Senha incorreta, seguida de acesso bem-sucedido.');
    mkes(d(10, 12, 22, 47), 'login_falho', 'u-prisma-1', 'f-prisma', '189.60.11.97', 'media', '4 falhas fora do horário comercial, sem bloqueio; conta monitorada.');
    mkes(d(11, 19, 14, 25), 'ver_como', 'u-ops-5', 'org-cedy', '10.20.0.14', 'alta', 'Ver como Marina Aguiar (Aurora Plásticos) por 20 min. Justificativa: acompanhar erro na tela de títulos relatado no chamado 4821.');
    mkes(d(11, 12, 11, 40), 'ver_como', 'u-ops-5', 'org-cedy', '10.20.0.14', 'alta', 'Ver como Rafael Tavares (Vértice Capital) por 15 min. Justificativa: reproduzir divergência da fatura de outubro para a Mesa.');
    mkes(d(10, 30, 13, 5), 'chave_criada', 'u-super-1', 'org-cedy', '10.20.0.14', 'baixa', 'Nova chave de API de leitura para o painel de saúde.');
    mkes(d(11, 9, 10, 48), 'chave_criada', 'u-ops-4', 'org-cedy', '10.20.0.14', 'media', 'Chave de exportação de faturas para o ERP financeiro.');
    mkes(d(11, 22, 16, 2), 'chave_criada', 'u-super-1', 'org-cedy', '10.20.0.14', 'baixa', 'Chave de webhook do banco parceiro rotacionada após o incidente S1.');
    mkes(d(10, 5, 12, 20), 'permissao_alterada', 'u-super-1', 'org-cedy', '10.20.0.14', 'media', 'Papel de Gabriel Moura definido como auditor (leitura da trilha).');
    mkes(d(11, 16, 9, 55), 'permissao_alterada', 'u-super-2', 'org-cedy', '10.20.0.14', 'media', 'Beatriz Lacerda passou a responder pelo compliance na Mesa (papel compliance).');
    mkes(d(10, 28, 17, 30), 'sessao_encerrada', 'u-ops-2', 'org-cedy', '10.20.0.14', 'baixa', 'Sessão encerrada por inatividade (60 min).');
    mkes(d(11, 7, 12, 15), 'sessao_encerrada', 'u-lumen-1', 'o-lumen', '187.44.12.9', 'baixa', 'Sessão encerrada pelo usuário.');
    mkes(d(11, 14, 20, 5), 'sessao_encerrada', 'u-nordeste-1', 'f-nordeste', '177.92.201.55', 'baixa', 'Sessão encerrada por inatividade (60 min).');
    mkes(d(11, 20, 19, 41), 'sessao_encerrada', 'u-sub-1', 'o-lumen', '191.18.90.4', 'baixa', 'Sessão encerrada pelo usuário.');

    /* ------------------------- 10. modelos e uso de IA ------------------------- */
    S.modelosIA['mdl-1'] = { id: 'mdl-1', nome: 'Cedy Atlas 1 (produção)', provedor: 'Provedor A (nuvem BR)', regiao: 'sa-east-1', residenciaBR: true, usos: ['ag-docs', 'ag-prevalidacao', 'ag-conciliacao'], custo1kIn: 0.27, custo1kOut: 1.08, status: 'ativo', versaoPrompt: 'v2026.10' };
    S.modelosIA['mdl-2'] = { id: 'mdl-2', nome: 'Cedy Atlas 2 (avaliação)', provedor: 'Provedor B', regiao: 'us-east', residenciaBR: false, usos: ['ag-preco', 'ag-credito'], custo1kIn: 0.45, custo1kOut: 1.80, status: 'sombra', versaoPrompt: 'v2026.11-rc' };
    S.modelosIA['mdl-3'] = { id: 'mdl-3', nome: 'Cedy Miúdo (cobrança)', provedor: 'Motor local (VPC Cedy)', regiao: 'sa-east-1', residenciaBR: true, usos: ['ag-cobranca'], custo1kIn: 0.03, custo1kOut: 0.09, status: 'ativo', versaoPrompt: 'v2026.09' };
    const usoCfg = [
      { agente: 'ag-docs', modelo: 'mdl-1', base: 214 / 30, tin: 22000, tout: 1600, lat: 6200 },
      { agente: 'ag-prevalidacao', modelo: 'mdl-1', base: 96 / 30, tin: 9000, tout: 800, lat: 2400 },
      { agente: 'ag-preco', modelo: 'mdl-2', base: 58 / 30, tin: 14000, tout: 1100, lat: 1800 },
      { agente: 'ag-credito', modelo: 'mdl-2', base: 131 / 30, tin: 28000, tout: 2000, lat: 3400 },
      { agente: 'ag-conciliacao', modelo: 'mdl-1', base: 27 / 30, tin: 12000, tout: 900, lat: 2200 },
      { agente: 'ag-cobranca', modelo: 'mdl-3', base: 342 / 30, tin: 2500, tout: 350, lat: 800 },
    ];
    usoCfg.forEach((a) => {
      const M = S.modelosIA[a.modelo];
      for (let i = 29; i >= 0; i--) {
        const diaTs = startDay - i * DAY; const p = C.cal.sp(diaTs);
        const util = C.cal.isUtil(diaTs);
        let reqs = Math.round(a.base * (0.6 + 0.8 * rnd()) * (util ? 1 : 0.3));
        if (!util && rnd() < 0.5) reqs = 0;
        reqs = Math.max(reqs, util ? 1 : 0);
        const tin = Math.round(reqs * a.tin * (0.8 + 0.4 * rnd()));
        const tout = Math.round(reqs * a.tout * (0.8 + 0.4 * rnd()));
        const id = 'uso-' + a.agente + '-' + p.y + String(p.m).padStart(2, '0') + String(p.d).padStart(2, '0');
        S.usoIA[id] = { id, dia: T(p.y, p.m, p.d, 0, 0), agenteId: a.agente, modeloId: a.modelo, reqs, tokensIn: tin, tokensOut: tout,
          custoBRL: r2(tin / 1000 * M.custo1kIn + tout / 1000 * M.custo1kOut), latMs: Math.round(a.lat * (0.8 + 0.4 * rnd())), erros: rnd() < 0.05 ? 1 : 0 };
      }
    });

    /* Garante o contrato temporal: nada além de clock.start, exceto os
       campos prospectivos. O cenário base cria as últimas notificações com
       C.clock.now(), que anda milissegundos durante o build. */
    Object.values(S.notifs).forEach((n) => { if (n.ts > NOW) n.ts = NOW; });

    /* ------------------------- 11. notificações ------------------------- */
    const notify = C.store.notify;
    notify.send({ to: { role: 'ops' }, tipo: 'alerta', titulo: 'S2 em andamento: consulta CNPJ degradada', corpo: 'Receita Federal com p95 em 4 s desde 08:50. KYC enfileirado; acompanhe em Incidentes.', link: '/super/incidentes/INC-2026-036', ts: d(11, 23, 9, 5) });
    notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: '4 solicitações aguardam decisão', corpo: 'SELIC, ticket do Premium, premiações de outubro e autonomia do Agente de Precificação. Uma expira hoje.', link: '/super/aprovacoes', ts: d(11, 23, 9, 40) });
    notify.send({ to: { userId: 'u-super-1' }, tipo: 'alerta', titulo: 'Uma aprovação expira hoje', corpo: 'Autonomia do Agente de Precificação (AP-0004) expira em 2h. Decida em Aprovações.', link: '/super/aprovacoes', ts: NOW - 20 * 60e3 });

    /* ------------------------- 12. integrações (credenciais) ------------------------- */
    const mkin = (id, orgId, kind, nome, extra, criadoAtras, usoAtras, status) => {
      S.integracoes[id] = Object.assign({ id, orgId, kind, nome, status: status || 'ativo',
        criadoEm: NOW - criadoAtras, ultimoUso: usoAtras === null ? null : NOW - usoAtras }, extra || {});
    };
    mkin('in-01', 'c-aurora', 'agente', 'Agente de conciliação da empresa', { escopos: ['leitura', 'operar_aprovado'] }, 20 * DAY, 3 * 3600e3);
    mkin('in-02', 'c-aurora', 'webhook', 'ERP', { url: 'https://erp.auroraplasticos.com.br/cedy', eventos: ['operacao.paga', 'titulo.liquidado'] }, 40 * DAY, 26 * 3600e3);
    mkin('in-03', 'c-tecnoparts', 'token', 'Token do TMS', { escopos: ['leitura'] }, 12 * DAY, 2 * DAY);
    mkin('in-04', 'f-vertice', 'token', 'Token do motor de risco', { escopos: ['leitura', 'operar_aprovado'] }, 30 * DAY, 5 * 3600e3);
    mkin('in-05', 'f-vertice', 'webhook', 'Webhook do custodiante', { url: 'https://custodia.verticecapital.com.br/hook', eventos: ['operacao.paga', 'titulo.liquidado'] }, 55 * DAY, 8 * 3600e3);
    mkin('in-06', 'f-nordeste', 'agente', 'Agente de cobrança do fomento', { escopos: ['leitura'] }, 120 * DAY, 65 * DAY);
    mkin('in-07', 'o-lumen', 'token', 'Token do CRM', { escopos: ['leitura'] }, 150 * DAY, 70 * DAY);
    mkin('in-08', 'c-tecnoparts', 'webhook', 'Webhook do ERP legado', { url: 'https://erp.tecnoparts.com.br/cedy', eventos: ['operacao.paga', 'titulo.liquidado'] }, 195 * DAY, 5 * DAY);
    mkin('in-09', 'c-aurora', 'token', 'Token antigo do BI', { escopos: ['leitura'] }, 100 * DAY, 90 * DAY, 'revogado');
    mkin('in-10', 'o-lumen', 'agente', 'Agente de indicações', { escopos: ['leitura'] }, 10 * DAY, null);
  };
})();
