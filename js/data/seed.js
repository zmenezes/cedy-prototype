/* =========================================================================
   Cedy protótipo 0.1, dados de demonstração.
   Empresas, usuários, programas de produto, agentes e um histórico gerado
   RODANDO o próprio motor (Cedy.engine) com o relógio de simulação, de modo que
   operações, lances, assinaturas, extrato, conciliação, repasses, faturas e a
   trilha (ledger, com cadeia de hashes) sejam consistentes entre si.
   Todos os nomes de empresas e pessoas são fictícios.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { cal } = C; const T = cal.spTs;
  const rnd = C.rng(20261123);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + rnd() * (b - a);
  const round = (n, step) => Math.round(n / step) * step;

  function cnpj(b8, filial = '0001') {
    const n = (b8 + filial).split('').map(Number);
    const dv = (arr) => { const w = arr.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = arr.reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    const d1 = dv(n); const d2 = dv([...n, d1]); return [...n, d1, d2].join('');
  }
  const conta = (nome) => ({ banco: 'BMP (Money Plus)', agencia: '0001', conta: String(Math.floor(100000 + rnd() * 899999)) + '-' + Math.floor(rnd() * 9), titular: nome, tipo: 'Conta de liquidação em nome do cedente' });

  /* ------------------------------ base ----------------------------------- */
  function base() {
    const NOW = C.clock.start;
    const S = { v: C.store.VERSION, session: null, theme: 'auto', marketOn: true, orgs: {}, users: {}, ledger: [], config: {}, produtos: {}, agentes: {} };
    const add = (o) => { S.orgs[o.id] = o; return o; };

    S.config = { selicAa: 14.0, horarioValidacao: { ini: 8, fim: 18 }, cutoffAceite: '14:30', cutoffPagamento: '17:00', firmezaHoras: 3, taxaAcessoMensal: 1999, carenciaMeses: 2, tsPiso: 15, tsPisoPctAm: 0.08,
      tarifaDesistenciaPctAm: 0.5, premiacaoIndicacao: 0.10, premiacaoGestao: 0.30, premiacaoJanelaMeses: 24, inatividadeDias: 90, premiacaoMinima: 100, slaValidacaoH: 6, slaPrimeiraOpH: 24, passoMinLance: 0.01,
      conciliacao: { valorMin: 0.5, valorMax: 1.1, slaH: 24, slaEmpateH: 48 }, repasseDiasUteis: 1, mesaSimulada: true, reajusteIPCA: 'Todo 1º de janeiro' };

    const prod = (p) => { S.produtos[p.id] = Object.assign({ versao: 3, vigenteDesde: T(2026, 8, 1), historico: [{ versao: 2, vigenteDesde: T(2026, 3, 1), tsPct: p.tsPct + 5, nota: 'Versão anterior' }, { versao: 1, vigenteDesde: T(2026, 1, 15), tsPct: p.tsPct + 5, nota: 'Lançamento' }] }, p); };
    prod({ id: 'premium', nome: 'Cedy Premium', desc: 'Operação silenciosa: o sacado não é notificado. Nota fiscal com comprovante de entrega. Sempre com regresso.', silencioso: true, ticketMin: 20000, prazoMin: 15, prazoMax: 180, lastro: ['NF-e (XML)', 'Comprovante de entrega ou aceite'], permiteSemRegresso: false, tsPct: 30, fonte: 'Premium (ticket ≥ R$ 20 mil, 15–180 dias); TS 30% é [INFERÊNCIA]' });
    prod({ id: 'confia', nome: 'Cedy Confia', desc: 'Convênio com sacado âncora: o sacado confirma o título e é notificado. Taxas menores.', silencioso: false, ticketMin: 5000, prazoMin: 10, prazoMax: 150, lastro: ['NF-e (XML)', 'Confirmação do sacado'], permiteSemRegresso: true, tsPct: 25, fonte: 'Confia; parâmetros [INFERÊNCIA]' });
    prod({ id: 'boleto', nome: 'Cedy Boleto', desc: 'Recebíveis em boleto bancário registrado.', silencioso: true, ticketMin: 3000, prazoMin: 10, prazoMax: 120, lastro: ['NF-e (XML)', 'Boleto registrado'], permiteSemRegresso: false, tsPct: 30, fonte: 'Boleto; parâmetros [INFERÊNCIA]' });
    prod({ id: 'carteira', nome: 'Cedy Carteira', desc: 'Lotes de duplicatas mercantis pulverizadas.', silencioso: true, ticketMin: 2000, prazoMin: 5, prazoMax: 180, lastro: ['NF-e (XML)'], permiteSemRegresso: false, tsPct: 35, fonte: 'Carteira; parâmetros [INFERÊNCIA]' });
    prod({ id: 'contrato', nome: 'Cedy Contrato', desc: 'Medições e parcelas de contratos de serviço e obra.', silencioso: false, ticketMin: 50000, prazoMin: 30, prazoMax: 360, lastro: ['Contrato', 'Medição aprovada'], permiteSemRegresso: true, tsPct: 40, fonte: 'Contrato; parâmetros [INFERÊNCIA]' });
    prod({ id: 'frete', nome: 'Cedy Frete', desc: 'Conhecimentos de transporte (CT-e) de embarcadores.', silencioso: true, ticketMin: 3000, prazoMin: 10, prazoMax: 90, lastro: ['CT-e (XML)', 'Comprovante de entrega'], permiteSemRegresso: false, tsPct: 35, fonte: 'Frete; parâmetros [INFERÊNCIA]' });

    // Cedy
    add({ id: 'org-cedy', kind: 'cedy', nome: 'Cedy Tecnologia e Intermediação de Recebíveis S.A.', fantasia: 'Cedy', cnpj: cnpj('50123456'), cidade: 'São Paulo', uf: 'SP', status: 'ativo' });

    // Cedentes
    const ced = (id, nome, fantasia, b8, cidade, uf, setor, st, desde, fat, prazo, dep, ind, extra) => add(Object.assign({ id, kind: 'cedente', nome, fantasia, cnpj: cnpj(b8), cidade, uf, setor, porte: fat > 50e6 ? 'Médio' : 'Pequeno', status: st, ativoDesde: desde, faturamentoAnual: fat, prazoRecebimentoDias: prazo, depositos90d: dep, indicadoPor: ind, bloqueados: [], favoritos: [], contaLiquidacao: conta(nome), scoreCedy: Math.round(560 + rnd() * 380), cadastroEm: desde ? desde - 12 * 86400000 : NOW - 5 * 86400000 }, extra || {}));
    ced('c-aurora', 'Plásticos Aurora Indústria Ltda', 'Aurora Plásticos', '12345678', 'Sorocaba', 'SP', 'Indústria', 'ativo', T(2026, 2, 9), 38.4e6, 52, 9.1e6, 'o-lumen');
    ced('c-tecnoparts', 'TecnoParts Autopeças S.A.', 'TecnoParts', '23456789', 'Joinville', 'SC', 'Indústria', 'ativo', T(2026, 3, 16), 72.0e6, 48, 17.2e6, 'o-lumen');
    ced('c-vale', 'Metalúrgica Vale do Aço Ltda', 'Vale do Aço', '34567890', 'Ipatinga', 'MG', 'Indústria', 'kyc', null, 22.5e6, 55, 0, 'o-lumen');
    ced('c-sertao', 'Distribuidora Sertão Alimentos Ltda', 'Sertão Alimentos', '45678901', 'Caruaru', 'PE', 'Distribuição', 'ativo', T(2026, 4, 6), 31.0e6, 38, 7.3e6, 'o-norte');
    ced('c-brisa', 'Brisa Embalagens Ltda', 'Brisa Embalagens', '56789012', 'Caxias do Sul', 'RS', 'Indústria', 'pendente', null, 14.2e6, 60, 0, 'o-bridge');
    ced('c-horizonte', 'Horizonte Logística e Transportes Ltda', 'Horizonte Logística', '67890123', 'Goiânia', 'GO', 'Transporte', 'ativo', T(2026, 5, 4), 26.8e6, 40, 6.2e6, null);
    ced('c-nova', 'Nova Era Construções Ltda', 'Nova Era', '78901234', 'Belo Horizonte', 'MG', 'Construção', 'suspenso', T(2026, 3, 2), 19.6e6, 70, 3.1e6, 'o-norte', { motivoSuspensao: 'Recompra vencida há mais de 10 dias úteis (OP-26-0377)' });
    ced('c-campo', 'Campo Verde Agroinsumos Ltda', 'Campo Verde', '89012345', 'Rondonópolis', 'MT', 'Agro', 'ativo', T(2026, 10, 5), 18.0e6, 75, 0, 'o-bridge');
    // Financiadores
    const fin = (id, nome, fantasia, b8, tipo, st, desde, politica) => add({ id, kind: 'financiador', nome, fantasia, cnpj: cnpj(b8), cidade: 'São Paulo', uf: 'SP', tipo, status: st, ativoDesde: desde, politica, regulacao: tipo === 'FIDC' ? 'CVM + gestora' : tipo === 'Banco' ? 'Banco Central' : 'Fomento mercantil (ANFAC)', cadastroEm: desde || NOW });
    const pol = (o) => Object.assign({ taxaMinima: 1.5, prazoMin: 15, prazoMax: 150, ticketMin: 20000, ticketMax: 1000000, produtos: ['premium', 'confia', 'boleto', 'carteira', 'frete'], ratingMin: 'C', limiteCedentePadrao: 2000000, limiteSacadoPadrao: 2500000, setoresBloqueados: [], cedentesBloqueados: [], exigeRegresso: false, autoLance: { ativo: false, valorMaxDia: 1500000, passoSobreMelhor: 0.01 }, limiteTotal: 10000000 }, o);
    fin('f-vertice', 'Vértice Capital FIDC Multissetorial', 'Vértice Capital', '90123456', 'FIDC', 'ativo', T(2026, 1, 20), pol({ taxaMinima: 1.45, ticketMax: 1500000, limiteTotal: 12000000, limiteCedentePadrao: 2500000, limiteSacadoPadrao: 3000000, setoresBloqueados: ['Construção'], limiteCedente: { 'c-aurora': 3500000 } }));
    fin('f-nordeste', 'Nordeste Fomento Mercantil Ltda', 'Nordeste Fomento', '01234567', 'Factoring', 'ativo', T(2026, 2, 2), pol({ taxaMinima: 1.65, ticketMax: 400000, ratingMin: 'C', exigeRegresso: true }));
    fin('f-atlas', 'Atlas Securitizadora de Créditos S.A.', 'Atlas Securitizadora', '11223344', 'Securitizadora', 'ativo', T(2026, 3, 9), pol({ taxaMinima: 1.55, ticketMax: 900000 }));
    fin('f-prisma', 'Banco Prisma S.A.', 'Banco Prisma', '22334455', 'Banco', 'ativo', T(2026, 4, 13), pol({ taxaMinima: 1.40, ticketMin: 50000, ticketMax: 2500000, ratingMin: 'B', limiteTotal: 40000000 }));
    fin('f-orla', 'Orla Crédito ESC Ltda', 'Orla Crédito', '33445566', 'ESC', 'ativo', T(2026, 6, 1), pol({ taxaMinima: 2.0, ticketMax: 250000, ratingMin: 'D', prazoMax: 120 }));
    fin('f-kappa', 'Kappa Gestão de Recursos FIDC', 'Kappa FIDC', '44556677', 'FIDC', 'kyc', null, pol({}));
    // Sacados
    const sac = (id, nome, fantasia, b8, setor, rating, extra) => add(Object.assign({ id, kind: 'sacado', nome, fantasia, cnpj: cnpj(b8), cidade: pick(['São Paulo', 'Campinas', 'Curitiba', 'Recife', 'Salvador', 'Betim']), uf: pick(['SP', 'PR', 'PE', 'BA', 'MG']), setor, rating, status: 'ativo', porteSacado: 'Grande', pagamentoMedioDias: Math.round(between(-1, 4)) }, extra || {}));
    sac('s-boacompra', 'Rede Boa Compra Supermercados S.A.', 'Boa Compra', '55667788', 'Varejo', 'A');
    sac('s-montrel', 'Montrel Montadora de Veículos S.A.', 'Montrel', '66778899', 'Automotivo', 'A');
    sac('s-cimentar', 'Cimentar Materiais de Construção S.A.', 'Cimentar', '77889900', 'Construção', 'B');
    sac('s-fortaleza', 'Atacadão Fortaleza Distribuidora Ltda', 'Atacadão Fortaleza', '88990011', 'Varejo', 'B');
    sac('s-solaris', 'Solaris Energia Renovável S.A.', 'Solaris Energia', '99001122', 'Energia', 'A');
    sac('s-metropol', 'Metrópole Shopping Centers S.A.', 'Metrópole Shopping', '10112233', 'Imobiliário', 'B');
    sac('s-agrovia', 'Agrovia Cooperativa Agroindustrial', 'Agrovia', '20223344', 'Agro', 'B');
    sac('s-tempus', 'Tempus Eletrodomésticos Ltda', 'Tempus', '30334455', 'Varejo', 'C', { pagamentoMedioDias: 6 });
    sac('s-nexo', 'Nexo Telecomunicações S.A.', 'Nexo Telecom', '40445566', 'Telecom', 'A');
    sac('s-docevida', 'Doce Vida Alimentos S.A.', 'Doce Vida', '50556677', 'Alimentos', 'B');
    sac('s-ferrobras', 'Ferrobrás Siderúrgica S.A.', 'Ferrobrás', '60667788', 'Siderurgia', 'A');
    sac('s-vida', 'Rede Vida Hospitalar S.A.', 'Rede Vida', '70778899', 'Saúde', 'C');
    sac('s-pilar', 'Construtora Pilar Ltda', 'Construtora Pilar', '80889900', 'Construção', 'D', { restricao: 'protesto em aberto (tabelionato)' });
    // Originadores
    const orig = (id, nome, fantasia, b8, desde) => add({ id, kind: 'originador', nome, fantasia, cnpj: cnpj(b8), cidade: 'São Paulo', uf: 'SP', status: 'ativo', ativoDesde: desde, contaPremiacao: { banco: '341 Itaú', agencia: '3201', conta: '45871-0', titularCnpj: true } });
    orig('o-lumen', 'Lumen Consultoria Financeira Ltda', 'Lumen Consultoria', '91011121', T(2026, 1, 12));
    orig('o-norte', 'Norte Gestão Empresarial Ltda', 'Norte Gestão', '92021222', T(2026, 3, 23));
    orig('o-bridge', 'Bridge Contabilidade e Crédito Ltda', 'Bridge', '93031323', T(2026, 6, 15));

    // Usuários (demo = aparece no seletor de perfis)
    const usr = (id, nome, email, cargo, orgId, perfil, demo, hue, extra) => { S.users[id] = Object.assign({ id, nome, email, cargo, orgId, perfil, demo: !!demo, hue, twofa: true, ultimoAcesso: NOW - Math.round(rnd() * 5e6), telefone: '(11) 9' + String(Math.floor(1e7 + rnd() * 8e7)).slice(0, 4) + '-' + String(Math.floor(1000 + rnd() * 8999)) }, extra || {}); };
    usr('u-aurora-1', 'Marina Aguiar', 'marina@auroraplasticos.com.br', 'Diretora financeira', 'c-aurora', 'admin', true, 215);
    usr('u-aurora-2', 'Diego Matos', 'diego@auroraplasticos.com.br', 'Analista financeiro', 'c-aurora', 'operador', true, 30);
    usr('u-aurora-3', 'Paula Reis', 'paula@contabreis.com.br', 'Contadora (externa)', 'c-aurora', 'leitor', true, 140, { twofa: false });
    usr('u-tecno-1', 'Gustavo Lemos', 'gustavo@tecnoparts.com.br', 'Tesoureiro', 'c-tecnoparts', 'admin', true, 260);
    usr('u-sertao-1', 'Rosângela Pires', 'rosangela@sertaoalimentos.com.br', 'Sócia-administradora', 'c-sertao', 'admin', false, 20);
    usr('u-horizonte-1', 'Fabrício Alves', 'fabricio@horizontelog.com.br', 'Gerente financeiro', 'c-horizonte', 'admin', false, 40);
    usr('u-nova-1', 'Marcos Tadeu', 'marcos@novaeraconstrucoes.com.br', 'Sócio', 'c-nova', 'admin', false, 5);
    usr('u-campo-1', 'Bianca Rocha', 'bianca@campoverdeagro.com.br', 'Controller', 'c-campo', 'admin', false, 125);
    usr('u-vertice-1', 'Rafael Tavares', 'rafael.tavares@verticecapital.com.br', 'Gestor de crédito', 'f-vertice', 'admin', true, 190);
    usr('u-vertice-2', 'Helena Souza', 'helena.souza@verticecapital.com.br', 'Analista de crédito', 'f-vertice', 'operador', true, 330);
    usr('u-vertice-3', 'Otávio Campos', 'otavio@verticecapital.com.br', 'Compliance', 'f-vertice', 'leitor', false, 60);
    usr('u-nordeste-1', 'Eduardo Neves', 'eduardo@nordestefomento.com.br', 'Diretor', 'f-nordeste', 'admin', true, 100);
    usr('u-atlas-1', 'Camila Furtado', 'camila@atlassec.com.br', 'Head de crédito', 'f-atlas', 'admin', false, 280);
    usr('u-prisma-1', 'Roberto Salles', 'roberto@bancoprisma.com.br', 'Superintendente', 'f-prisma', 'admin', false, 10);
    usr('u-orla-1', 'Vanessa Cunha', 'vanessa@orlacredito.com.br', 'Sócia', 'f-orla', 'admin', false, 170);
    usr('u-lumen-1', 'Carlos Bastos', 'carlos@lumenconsultoria.com.br', 'Sócio', 'o-lumen', 'admin', true, 150);
    usr('u-lumen-2', 'Juliana Freitas', 'juliana@lumenconsultoria.com.br', 'Consultora', 'o-lumen', 'operador', false, 310);
    usr('u-norte-1', 'Sérgio Bittencourt', 'sergio@nortegestao.com.br', 'Sócio', 'o-norte', 'admin', false, 80);
    usr('u-boa-1', 'Ana Paula Ribeiro', 'ana.ribeiro@boacompra.com.br', 'Gerente de contas a pagar', 's-boacompra', 'admin', true, 350);
    usr('u-boa-2', 'Leandro Cruz', 'leandro.cruz@boacompra.com.br', 'Analista de pagamentos', 's-boacompra', 'operador', false, 120);
    usr('u-ops-1', 'Juliana Prado', 'juliana.prado@cedy.com.br', 'Analista sênior, Mesa de Operações', 'org-cedy', 'admin', true, 290);
    usr('u-ops-2', 'Thiago Neri', 'thiago.neri@cedy.com.br', 'Analista, Mesa Conciliadora', 'org-cedy', 'operador', true, 45);
    usr('u-ops-3', 'Beatriz Lacerda', 'beatriz.lacerda@cedy.com.br', 'Compliance e risco', 'org-cedy', 'admin', false, 200);

    // Agentes de IA (autonomia por classe de risco: D3 + D5)
    const ag = (id, nome, escopo, nivel, max, classe, m) => { S.agentes[id] = { id, nome, escopo, nivel, nivelMaximo: max, classe, metricas: m, desde: T(2026, 8, 17), modelo: 'Gateway Cedy', identidade: 'agente:' + id }; };
    ag('ag-docs', 'Agente de Documentos (KYC)', 'Lê contrato social, cartão CNPJ e certidões; confere consistência e sugere aprovação ou pendência.', 'assistido', 'autonomo', 'R1', { execucoes30d: 214, aceitas: 0.93, correcoes: 0.05, tempoMedio: '38 s' });
    ag('ag-prevalidacao', 'Agente de Pré-validação de Títulos', 'Confere chave da NF-e, duplicidade, sacado, lastro e elegibilidade do programa; propõe aprovar o lote.', 'assistido', 'assistido', 'R2', { execucoes30d: 96, aceitas: 0.91, correcoes: 0.07, tempoMedio: '12 s' });
    ag('ag-preco', 'Agente de Precificação', 'Sugere taxa e teto de aceite ao cedente a partir do histórico de leilões. Só aconselha.', 'sombra', 'assistido', 'R2', { execucoes30d: 58, aceitas: 0.0, correcoes: 0, tempoMedio: '3 s', obs: 'Em sombra: compara a sugestão com o resultado real.' });
    ag('ag-credito', 'Agente de Crédito', 'Avalia oportunidades contra a política do financiador e propõe taxa. Quem dá o lance é o motor de política ou um humano.', 'assistido', 'assistido', 'R2', { execucoes30d: 131, aceitas: 0.74, correcoes: 0.18, tempoMedio: '4 s' });
    ag('ag-conciliacao', 'Agente de Conciliação', 'Sugere rateio e prioridade de operações vencidas para casos parciais e empates. A Mesa aprova.', 'assistido', 'assistido', 'R3', { execucoes30d: 27, aceitas: 0.85, correcoes: 0.11, tempoMedio: '6 s' });
    ag('ag-cobranca', 'Agente de Cobrança e Régua', 'Lembretes a sacados e cedentes antes e depois do vencimento. Não altera valores.', 'autonomo', 'autonomo', 'R1', { execucoes30d: 342, aceitas: 0.99, correcoes: 0.0, tempoMedio: '1 s' });
    ag('ag-atendimento', 'Agente de atendimento', 'Triagem e rascunho de resposta para a Mesa e resposta informativa com fonte nos chamados. Só chega a autônomo na categoria informativa; nunca age sobre dinheiro, acesso ou cadastro.', 'autonomo', 'autonomo', 'R0', { execucoes30d: 238, aceitas: 0.96, correcoes: 0.04, tempoMedio: '2 s', obs: 'Autônomo só na categoria "informativa com fonte", depois de 200 respostas revisadas, 95% sem edição e nenhum incidente.' });
    return S;
  }

  /* ------------------------------ cenário -------------------------------- */
  function scenario(S) {
    const E = C.engine; const db = C.store.db; const L = C.store.ledger; const clock = C.clock;
    const sacadosPorCed = { 'c-aurora': ['s-boacompra', 's-montrel', 's-cimentar', 's-fortaleza', 's-nexo'], 'c-tecnoparts': ['s-montrel', 's-ferrobras', 's-solaris', 's-boacompra'], 'c-sertao': ['s-fortaleza', 's-boacompra', 's-docevida', 's-agrovia'], 'c-horizonte': ['s-montrel', 's-ferrobras', 's-nexo'], 'c-nova': ['s-cimentar', 's-metropol'], 'c-campo': ['s-agrovia', 's-docevida'] };
    const userOf = { 'c-aurora': 'u-aurora-1', 'c-tecnoparts': 'u-tecno-1', 'c-sertao': 'u-sertao-1', 'c-horizonte': 'u-horizonte-1', 'c-nova': 'u-nova-1', 'c-campo': 'u-campo-1', 'f-vertice': 'u-vertice-1', 'f-nordeste': 'u-nordeste-1', 'f-atlas': 'u-atlas-1', 'f-prisma': 'u-prisma-1', 'f-orla': 'u-orla-1' };
    const opsUser = 'u-ops-1'; let nf = 48100;
    S.orgs['c-nova'].status = 'ativo';
    const setClock = (ts) => clock.set(ts);
    const at = (d, h = 10, mi = 0) => T(d[0], d[1], d[2], h, mi);

    function mkTitulos(cedId, n, { prazo = 45, vmin = 28000, vmax = 190000, produto = 'premium', sacados, aceite = 'silencioso', comprov = true, uniform = false } = {}) {
      const sc = sacados || sacadosPorCed[cedId]; const nowT = clock.now(); const ced = S.orgs[cedId];
      const s0 = pick(sc); const d0 = Math.round(prazo + between(-8, 14));
      return Array.from({ length: n }, () => { const s = uniform ? s0 : pick(sc); const num = nf++; const v = round(between(vmin, vmax), 10) + Math.round(rnd() * 99) / 100; const d = uniform ? d0 : Math.round(prazo + between(-8, 14)); const emissao = nowT - Math.round(between(1, 9)) * 86400000;
        return { sacadoId: s, tipo: 'NF-e', numero: 'NF ' + num + '/001', chave: E.gerarChave({ uf: 35, aamm: '2609', cnpj: ced.cnpj, numero: num }), cnpjEmitente: ced.cnpj, valor: v, emissao, vencimento: cal.addDays(cal.startOfDay(nowT), d) + 12 * 3600e3, produto, lastro: { xml: true, pdf: true, comprovante: comprov, aceiteSacado: aceite } }; });
    }
    /** roda o fluxo completo até o estágio pedido; devolve a operação */
    function fluxo(o) {
      setClock(o.start);
      const uid = userOf[o.ced];
      const itens = o.itens || mkTitulos(o.ced, o.n || 3, o.tit || {});
      itens.forEach((t) => { if (t.emissao > o.start - 86400000) t.emissao = o.start - 3 * 86400000; });
      const imp = E.importarTitulos({ cedenteId: o.ced, userId: uid, itens, nomeArquivo: o.arq || ('NFe_lote_' + clock.now().toString(36).slice(-5) + '.zip') });
      if (!imp.ok) throw new Error('import falhou');
      if (o.lote === 'validando') return { lote: imp.loteId, titulos: imp.titulos };
      setClock(clock.now() + (o.mesaMin || 95) * 60e3);
      if (!db.get('lotes', imp.loteId).status === 'validando') { /* já decidido */ }
      E.decidirLote(imp.loteId, 'aprovar', { userId: opsUser });
      if (o.stop === 'disponivel') return { lote: imp.loteId, titulos: imp.titulos };
      setClock(clock.now() + (o.pubMin || 40) * 60e3);
      const ids = imp.titulos.filter((t) => !t.temErro).map((t) => t.id);
      const r = E.criarOperacao({ cedenteId: o.ced, userId: uid, tituloIds: ids, canal: o.canal || 'vitrine', financiadorAlvoId: o.alvo || null, regresso: o.regresso === undefined ? true : o.regresso, tetoTaxa: o.teto || null, validadeH: o.validadeH || 48 });
      if (!r.ok) throw new Error('criarOperacao: ' + r.erro + ' | ' + o.ced + ' | ' + C.fmt.datetime(o.start) + ' | stop=' + o.stop + ' | flags=' + JSON.stringify(imp.titulos.map((t) => t.flags.map((f) => f.codigo + ':' + f.msg.slice(0, 40)))));
      const op = r.op; let last = null;
      for (const [fid, taxa, dm] of (o.lances || [])) { setClock(clock.now() + (dm === undefined ? 25 : dm) * 60e3); const lr = E.darLance(op.id, fid, taxa, { userId: userOf[fid] }); if (!lr.ok) continue; last = lr; if (lr.aceiteAutomatico) break; }
      if (o.stop !== 'aberta' && db.get('operacoes', op.id).status === 'aberta' && !E.melhorLance(op.id)) { for (const fid of ['f-vertice', 'f-atlas', 'f-prisma', 'f-nordeste', 'f-orla']) { const lr = E.darLance(op.id, fid, 2.2, { userId: userOf[fid] }); if (lr.ok) break; } }
      if (o.stop === 'aberta') return op;
      const cur = () => db.get('operacoes', op.id);
      if (cur().status === 'aberta') { setClock(clock.now() + (o.aceiteMin || 60) * 60e3); const m = E.melhorLance(op.id); const ar = E.aceitarLance(op.id, m.id, { userId: uid }); if (!ar.ok) throw new Error('aceite ' + ar.erro); }
      if (o.stop === 'cessao') return cur();
      const fin = cur().financiadorId; const sig = (parte) => { setClock(clock.now() + (o.sigMin || 12) * 60e3); const c = E.assinarContrato(cur().contratoId, parte, parte === 'cedente' ? uid : userOf[fin]); if (!c.ok) throw new Error('assina ' + c.erro); };
      sig('cedente'); if (o.stop === 'cessao1') return cur();
      sig('financiador'); if (o.stop === 'aguardando') return cur();
      if (o.pagarEm) setClock(o.pagarEm); else setClock(Math.min(clock.now() + (o.payMin || 55) * 60e3, E.prazoPagamento(cur().aceitaEm).limite - 20 * 60e3));
      const pr = E.registrarPagamento(op.id, userOf[fin]); if (!pr.ok) throw new Error('pagar ' + pr.erro);
      if (o.plano) { const o2 = cur(); const pl = o2.planoSacado.map((p) => Object.assign({}, p, o.plano(p))); db.patch('operacoes', op.id, { planoSacado: pl }); }
      return cur();
    }
    const laterTick = (ts) => { setClock(ts); E.tick(); };
    const fins5 = ['f-vertice', 'f-nordeste', 'f-atlas', 'f-prisma', 'f-orla'];
    const fullV = (p) => C.round2(C.sum(p.tituloIds, (id) => db.get('titulos', id).valor));
    const dueTs = (p) => { const v = db.get('titulos', p.tituloIds[0]).vencimento; const t = cal.sp(v); return cal.toUtil(T(t.y, t.m, t.d, 11, 30)); };
    const histLances = (base) => { const f = fins5.slice().sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 3)); let t = base; return f.map((id) => { t = Math.round((t - between(0.03, 0.12)) * 100) / 100; return [id, t, Math.round(between(6, 55))]; }); };

    /* ---- histórico (jun a nov): operações já liquidadas, para gráficos, faturas e premiações ---- */
    const hist = [];
    const cedHist = ['c-aurora', 'c-aurora', 'c-tecnoparts', 'c-sertao', 'c-tecnoparts', 'c-horizonte', 'c-aurora', 'c-sertao', 'c-tecnoparts', 'c-horizonte', 'c-aurora', 'c-nova', 'c-tecnoparts', 'c-sertao'];
    let day = [2026, 6, 8];
    for (let i = 0; i < 26; i++) {
      const c = cedHist[i % cedHist.length]; const ds = Math.round(4 + rnd() * 4); const t = new Date(Date.UTC(day[0], day[1] - 1, day[2]) + ds * 86400000); day = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
      if (day[0] === 2026 && day[1] === 11 && day[2] > 4) break; const dt = T(day[0], day[1], day[2], 9, 30); if (!cal.isUtil(dt)) continue;
      const sc = i % 9 === 4 ? 'atraso' : i % 11 === 7 ? 'parcial' : 'ok';
      hist.push({ ced: c, start: dt, scenario: sc, produto: i % 7 === 3 && c === 'c-horizonte' ? 'frete' : 'premium' });
    }
    hist.forEach((h) => {
      const room = Math.floor((C.clock.start - 13 * 86400000 - h.start) / 86400000) - 14; // vencimento + folga para atraso, Mesa e recompra antes de "agora"
      const prazo = Math.min(h.produto === 'frete' ? 20 : Math.round(30 + rnd() * 55), room);
      if (prazo < (h.produto === 'frete' ? 18 : 23)) return;
      const taxa0 = Math.round((2.0 + rnd() * 0.35) * 100) / 100;
      let op;
      try { op = fluxo({ ced: h.ced, start: h.start, n: 2 + Math.floor(rnd() * 3), tit: { prazo, uniform: true, produto: h.produto, vmin: h.produto === 'frete' ? 6000 : 30000, vmax: h.produto === 'frete' ? 22000 : 240000 }, lances: histLances(taxa0), regresso: true,
        plano: h.scenario === 'parcial' ? (p) => ({ cenario: 'parcial', valor: Math.round(fullV(p) * 0.7 * 100) / 100, ts: dueTs(p) }) : h.scenario === 'atraso' ? (p) => ({ cenario: 'atrasado', valor: fullV(p), ts: cal.addUteis(dueTs(p), 3) }) : (p) => ({ cenario: 'exato', valor: fullV(p), ts: dueTs(p) }) }); } catch (e) { console.warn('seed hist', e.message); return; }
      const opNow = db.get('operacoes', op.id); const lastVenc = Math.max(...opNow.tituloIds.map((id) => db.get('titulos', id).vencimento));
      laterTick(lastVenc + 6 * 86400000);
      let caso; while ((caso = db.where('casosMesa', (c) => c.status === 'aberto' && db.get('extrato', c.linhaId).orgId === h.ced)[0])) { if (!caso.sugestao) break; setClock(clock.now() + 3600e3); E.resolverCaso(caso.id, caso.sugestao.alocacoes, { userId: 'u-ops-2' }); laterTick(clock.now() + 2 * 86400000); }
      const cur = db.get('operacoes', op.id);
      if (cur.status === 'vencida' && cur.regresso) { setClock(clock.now() + 86400000); E.acionarRegresso(op.id, userOf[cur.financiadorId]); setClock(clock.now() + 3 * 86400000); if (S.orgs[h.ced].status !== 'suspenso') E.pagarRecompra(op.id, userOf[h.ced]); }
    });


    /* ---- o presente: 23/11/2026 10:12 ---- */
    const NOW = clock.start;
    const d = (m, dd, h = 10, mi = 0) => T(2026, m, dd, h, mi);

    // títulos disponíveis da Aurora (aprovados em 20/11) para a pessoa criar uma operação nova
    setClock(d(11, 19, 16, 10));
    const disp = fluxo({ ced: 'c-aurora', start: d(11, 19, 16, 10), n: 9, stop: 'disponivel', tit: { prazo: 58, vmin: 26000, vmax: 215000 }, arq: 'NFe_aurora_nov_19.zip' });
    // dois títulos da Aurora com sacado Boa Compra, produto Confia, aguardando confirmação do sacado
    const conf = mkTitulos('c-aurora', 3, { prazo: 40, vmin: 9000, vmax: 36000, produto: 'confia', sacados: ['s-boacompra'], aceite: 'pendente', comprov: false });
    fluxo({ ced: 'c-aurora', start: d(11, 20, 14, 5), itens: conf, stop: 'disponivel', arq: 'NFe_confia_BoaCompra.xml' });

    // operações pagas a vencer (carteira do financiador, vencimentos entre 25/11 e fev)
    const pagas = [
      { ced: 'c-aurora', start: d(10, 20, 9, 40), prazo: 38, fin: 'f-vertice', taxa: 1.92 }, { ced: 'c-tecnoparts', start: d(10, 27, 11, 5), prazo: 31, fin: 'f-vertice', taxa: 1.88 },
      { ced: 'c-sertao', start: d(11, 3, 10, 20), prazo: 24, fin: 'f-nordeste', taxa: 2.1 }, { ced: 'c-aurora', start: d(11, 5, 9, 15), prazo: 62, fin: 'f-atlas', taxa: 1.97 },
      { ced: 'c-horizonte', start: d(11, 9, 13, 0), prazo: 21, fin: 'f-prisma', taxa: 1.78, produto: 'premium' }, { ced: 'c-tecnoparts', start: d(11, 10, 9, 50), prazo: 75, fin: 'f-vertice', taxa: 1.84 },
      { ced: 'c-aurora', start: d(11, 12, 10, 30), prazo: 95, fin: 'f-prisma', taxa: 1.69 }, { ced: 'c-campo', start: d(11, 13, 9, 30), prazo: 120, fin: 'f-orla', taxa: 2.34 },
      { ced: 'c-sertao', start: d(11, 17, 10, 10), prazo: 33, fin: 'f-vertice', taxa: 2.01 },
    ];
    pagas.forEach((p) => {
      const base = p.taxa + 0.25; const outros = fins5.filter((f) => f !== p.fin).slice(0, 2);
      fluxo({ ced: p.ced, start: p.start, n: 2 + Math.floor(rnd() * 3), tit: { prazo: p.prazo, uniform: true, vmin: 38000, vmax: 280000 }, mesaMin: p.ced === 'c-campo' ? 600 : 80, lances: [[outros[0], base, 20], [outros[1], Math.round((base - 0.09) * 100) / 100, 14], [p.fin, p.taxa, 18]], regresso: true });
    });
    // vencida: sacado Tempus não pagou (Aurora / Vértice), vencimento 17/11; regresso ainda não acionado
    fluxo({ ced: 'c-aurora', start: d(10, 8, 10, 0), itens: mkTitulos('c-aurora', 2, { prazo: 40, vmin: 60000, vmax: 130000, sacados: ['s-tempus'] }).map((t) => Object.assign(t, { vencimento: d(11, 17, 12, 0) })), lances: [['f-nordeste', 2.2, 20], ['f-vertice', 2.07, 10]], regresso: true, plano: () => ({ cenario: 'atrasado', ts: d(12, 24, 12, 0), emitido: false }) });
    // sem pagamento + regresso acionado + recompra devida (Nova Era, suspensa)
    const nova = fluxo({ ced: 'c-nova', start: d(9, 29, 10, 0), itens: mkTitulos('c-nova', 2, { prazo: 35, vmin: 70000, vmax: 120000, sacados: ['s-cimentar'] }).map((t) => Object.assign(t, { vencimento: d(11, 9, 12, 0) })), lances: [['f-atlas', 2.25, 20], ['f-prisma', 2.12, 10]], regresso: true, plano: () => ({ cenario: 'atrasado', ts: d(12, 31, 12, 0), emitido: false }) });
    // liquidação parcial na Mesa (hoje 09:30)
    const par = fluxo({ ced: 'c-tecnoparts', start: d(10, 14, 9, 30), itens: mkTitulos('c-tecnoparts', 1, { prazo: 40, vmin: 210000, vmax: 260000, sacados: ['s-ferrobras'] }).map((t) => Object.assign(t, { vencimento: d(11, 23, 12, 0), valor: 240000 })), lances: [['f-vertice', 1.9, 20], ['f-atlas', 1.84, 8]], regresso: true, plano: (p) => ({ cenario: 'parcial', ts: d(11, 23, 9, 30), valor: 168000 }) });
    // empate: duas operações com o mesmo valor do mesmo sacado; só um pagamento chegou
    const emp = (v) => mkTitulos('c-tecnoparts', 1, { prazo: 30, sacados: ['s-montrel'] }).map((t) => Object.assign(t, { valor: 100000, vencimento: d(11, 23, 12, 0) }));
    const e1 = fluxo({ ced: 'c-tecnoparts', start: d(10, 22, 9, 10), itens: emp(), lances: [['f-nordeste', 1.99, 15], ['f-atlas', 1.9, 10]], regresso: true, plano: () => ({ cenario: 'exato', ts: d(11, 23, 8, 45), valor: 100000 }) });
    const e2 = fluxo({ ced: 'c-tecnoparts', start: d(10, 22, 14, 40), itens: emp(), lances: [['f-vertice', 1.95, 15], ['f-prisma', 1.82, 10]], regresso: true, plano: () => ({ cenario: 'exato', ts: d(11, 24, 12, 0), valor: 100000 }) });
    // excesso que vira Recurso Livre (Sertão, ontem/hoje)
    const rl = fluxo({ ced: 'c-sertao', start: d(10, 21, 10, 0), itens: mkTitulos('c-sertao', 1, { prazo: 33, sacados: ['s-fortaleza'] }).map((t) => Object.assign(t, { valor: 54320, vencimento: d(11, 23, 12, 0) })), lances: [['f-orla', 2.4, 20], ['f-nordeste', 2.18, 10]], regresso: true, plano: () => ({ cenario: 'exato', ts: d(11, 23, 7, 30), valor: 59190 }) });

    // aguardando pagamento em atraso (Prisma): aceite 18/11 15:00, assinadas, não pago
    fluxo({ ced: 'c-tecnoparts', start: d(11, 18, 11, 40), n: 3, tit: { prazo: 52, vmin: 90000, vmax: 180000 }, lances: [['f-atlas', 1.85, 5], ['f-prisma', 1.71, 20]], aceiteMin: 130, stop: 'aguardando', sigMin: 20 });
    // aguardando pagamento hoje: Vértice venceu (Aurora), assinou; prazo 17h de hoje
    fluxo({ ced: 'c-aurora', start: d(11, 23, 7, 30), n: 3, tit: { prazo: 47, vmin: 70000, vmax: 150000 }, lances: [['f-nordeste', 2.05, 15], ['f-vertice', 1.89, 15]], mesaMin: 30, pubMin: 10, aceiteMin: 20, sigMin: 8, stop: 'aguardando' });
    // cessão: cedente assinou, Vértice não (Sertão, aceita 08:30)
    fluxo({ ced: 'c-sertao', start: d(11, 23, 7, 50), n: 2, tit: { prazo: 36, vmin: 60000, vmax: 110000 }, lances: [['f-atlas', 2.12, 15], ['f-vertice', 2.0, 20]], mesaMin: 30, pubMin: 10, aceiteMin: 10, sigMin: 15, stop: 'cessao1' });
    // cessão: aceite automático hoje 09:40, ninguém assinou (TecnoParts, Atlas)
    fluxo({ ced: 'c-tecnoparts', start: d(11, 23, 8, 30), n: 2, tit: { prazo: 44, vmin: 120000, vmax: 200000 }, teto: 1.8, lances: [['f-nordeste', 1.95, 30], ['f-atlas', 1.79, 15]], mesaMin: 30, pubMin: 10, stop: 'cessao' });

    // leilões abertos hoje e ontem
    const aberta = (o) => fluxo(Object.assign({ stop: 'aberta' }, o));
    aberta({ ced: 'c-aurora', start: d(11, 23, 7, 30), n: 4, tit: { prazo: 52, vmin: 60000, vmax: 130000 }, lances: [['f-nordeste', 2.09, 12], ['f-atlas', 1.98, 20], ['f-vertice', 1.93, 18]], validadeH: 24, mesaMin: 20, pubMin: 20 });
    aberta({ ced: 'c-tecnoparts', start: d(11, 23, 7, 0), n: 3, tit: { prazo: 41, vmin: 140000, vmax: 210000, sacados: ['s-ferrobras'] }, teto: 1.7, lances: [['f-atlas', 1.95, 18], ['f-prisma', 1.84, 25]], validadeH: 30, mesaMin: 20, pubMin: 40 });
    aberta({ ced: 'c-sertao', start: d(11, 22, 17, 10), n: 2, tit: { prazo: 33, vmin: 50000, vmax: 90000, sacados: ['s-fortaleza'] }, lances: [['f-vertice', 2.15, 20], ['f-nordeste', 2.04, 30]], validadeH: 40, mesaMin: 20, pubMin: 10 });
    aberta({ ced: 'c-horizonte', start: d(11, 23, 8, 30), n: 4, tit: { prazo: 27, vmin: 12000, vmax: 26000, produto: 'frete', sacados: ['s-montrel', 's-nexo'] }, lances: [], validadeH: 36, mesaMin: 20, pubMin: 15 });
    aberta({ ced: 'c-aurora', start: d(11, 23, 8, 45), n: 2, tit: { prazo: 66, vmin: 40000, vmax: 70000, sacados: ['s-cimentar'] }, canal: 'balcao', alvo: 'f-vertice', lances: [], validadeH: 48, mesaMin: 20, pubMin: 20, regresso: true });
    aberta({ ced: 'c-tecnoparts', start: d(11, 23, 7, 40), n: 2, tit: { prazo: 58, vmin: 90000, vmax: 120000, sacados: ['s-solaris'] }, canal: 'balcao', alvo: 'f-nordeste', lances: [['f-nordeste', 1.9, 20]], validadeH: 48, mesaMin: 20, pubMin: 15 });
    aberta({ ced: 'c-campo', start: d(11, 23, 8, 30), n: 1, tit: { prazo: 88, vmin: 62000, vmax: 66000, sacados: ['s-agrovia'] }, lances: [], validadeH: 5, mesaMin: 5, pubMin: 5 });

    // lotes em validação (Mesa de Operações): Aurora (hoje 09:41, 3 títulos, 1 com aviso e 1 recusado), Campo Verde (primeira operação) e Vale do Aço (negado)
    setClock(d(11, 23, 9, 41));
    const itensA = mkTitulos('c-aurora', 3, { prazo: 49, vmin: 38000, vmax: 120000 });
    itensA[1].lastro.comprovante = false;
    itensA.push(Object.assign(mkTitulos('c-aurora', 1, { prazo: 49 })[0], { valor: 12400, numero: 'NF 48990/001' }));
    E.importarTitulos({ cedenteId: 'c-aurora', userId: 'u-aurora-2', itens: itensA, nomeArquivo: 'NFe_aurora_23nov.zip' });
    setClock(d(11, 23, 9, 55));
    E.importarTitulos({ cedenteId: 'c-campo', userId: 'u-tecno-1', itens: mkTitulos('c-campo', 2, { prazo: 70, vmin: 80000, vmax: 140000 }), nomeArquivo: 'NFe_campoverde.xml' });
    setClock(d(11, 21, 15, 0));
    const lt = E.importarTitulos({ cedenteId: 'c-sertao', userId: 'u-sertao-1', itens: mkTitulos('c-sertao', 2, { prazo: 30 }).map((t) => Object.assign(t, { sacadoId: 's-pilar' })), nomeArquivo: 'NFe_sertao.xml' });

    // extrato: crédito de fonte não identificada (Aurora)
    setClock(d(11, 23, 7, 55));
    E.entradaExtrato({ cedenteId: 'c-aurora', valor: 37420, pagadorCnpj: cnpj('11199988'), pagadorNome: 'DISTR RIO VERDE COM LTDA', ts: d(11, 23, 7, 55), descricao: 'TED recebida' });

    /* ---- fechamentos mensais (jun a out), depois de todas as operações existirem ---- */
    for (let m = 6; m <= 10; m++) { setClock(T(2026, m + 1, 3, 9, 0)); E.fecharMes(`2026-${String(m).padStart(2, '0')}`, { userId: opsUser }); }
    // alcançar "agora": pagamentos do feed bancário de hoje 07:30–09:30
    laterTick(NOW);
    const novaOp = db.get('operacoes', nova.id); if (novaOp.status === 'vencida' && novaOp.regresso && !novaOp.regressoAcionado) { E.acionarRegresso(nova.id, userOf[novaOp.financiadorId]); }
    setClock(NOW);
    ['c-nova'].forEach((id) => { S.orgs[id].status = 'suspenso'; });

    // faturas: situações realistas
    db.all('faturas').forEach((f) => { const venc = f.vencimento < NOW; if (!venc) return; const m = Number(f.competencia.slice(5)); if (f.total === 0) { db.patch('faturas', f.id, { status: 'isenta' }); return; } if (m <= 9 || f.finId === 'f-vertice' || f.finId === 'f-prisma') db.patch('faturas', f.id, { status: 'paga', pagaEm: f.vencimento - 2 * 86400000 }); else if (f.finId === 'f-nordeste') db.patch('faturas', f.id, { status: 'vencida' }); else db.patch('faturas', f.id, { status: 'paga', pagaEm: f.vencimento }); });
    db.all('premiacoes').forEach((p) => { const [y, m] = p.competencia.split('-').map(Number); if (p.pagamentoEm < NOW) db.patch('premiacoes', p.id, { status: p.total >= 100 ? 'pago' : 'retido', pagoEm: p.pagamentoEm }); else if (p.relatorioEm < NOW) db.patch('premiacoes', p.id, { status: p.total >= 100 ? 'aprovado' : 'retido' }); });
    const ultimaP = db.all('premiacoes').filter((p) => p.origId === 'o-lumen' && p.competencia === '2026-10')[0]; if (ultimaP) { db.put('contestacoes', { id: 'ct-1', premiacaoId: ultimaP.id, origId: 'o-lumen', motivo: 'A operação OP-26-0443 não aparece no relatório de outubro.', abertaEm: d(11, 12, 15, 0), status: 'em_analise' }); db.patch('premiacoes', ultimaP.id, { status: 'em_contestacao' }); }
    return { lt };
  }

  /* -------------------- cadastro, convites, KYC, propostas -------------------- */
  function extras(S) {
    const db = C.store.db; const NOW = C.clock.start; const d = (m, dd, h = 10) => T(2026, m, dd, h, 0); const ids = 0;
    // convites do originador Lumen
    const inv = (id, nome, st, dias, orgId, email) => db.put('convites', { id, origId: 'o-lumen', nome, email: email || ('contato@' + nome.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) + '.com.br'), cnpj: cnpj(String(40000000 + Math.floor(rnd() * 5e7))), status: st, enviadoEm: NOW - dias * 86400000, orgId: orgId || null, ultimaAtividade: NOW - Math.round(dias / 2) * 86400000 });
    inv('cv-1', 'Plásticos Aurora Indústria Ltda', 'ativo', 290, 'c-aurora'); inv('cv-2', 'TecnoParts Autopeças S.A.', 'ativo', 255, 'c-tecnoparts'); inv('cv-3', 'Metalúrgica Vale do Aço Ltda', 'kyc', 6, 'c-vale', 'financeiro@valedoaco.com.br');
    inv('cv-4', 'Têxtil Fio Dourado Ltda', 'convidado', 3); inv('cv-5', 'Transportadora Rota Sul Ltda', 'convidado', 11); inv('cv-6', 'Gráfica Impressão Rápida Ltda', 'cadastrado', 8); inv('cv-7', 'Calçados Passo Firme Ltda', 'recusado', 40); inv('cv-8', 'Química Delta Indústria Ltda', 'inativo', 130); inv('cv-9', 'Móveis Serra Azul Ltda', 'convidado', 1);
    // KYC
    const docs = (kind, extra) => (kind === 'financiador' ? ['Contrato/estatuto social', 'Cartão CNPJ', 'Regulamento do fundo / registro no órgão regulador', 'Política de risco e crédito', 'Documentos do administrador/gestor', 'Comprovante de endereço'] : ['Contrato social consolidado', 'Cartão CNPJ', 'Documento dos sócios (RG ou CNH)', 'Comprovante de endereço', 'Faturamento dos últimos 12 meses (DRE ou balancete)', 'Certidão negativa de débitos federais', 'Comprovante da conta de liquidação']).map((t, i) => Object.assign({ tipo: t, arquivo: t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) + '.pdf', status: 'ok', agente: { confianca: Math.round((0.9 + rnd() * 0.09) * 100) / 100, nota: 'Dados conferem com a Receita e entre os documentos.' } }, extra && extra[i]));
    const kyc = (orgId, st, kind, ex, resumo, risco) => db.put('kyc', { id: 'kyc-' + orgId, orgId, status: st, docs: docs(kind, ex), criadoEm: NOW - 3 * 86400000, atualizadoEm: NOW - 4e6, agenteResumo: resumo, risco: risco || 'baixo' });
    kyc('c-vale', 'em_analise', 'cedente', null, 'Documentos consistentes. Sócios sem apontamentos. Faturamento declarado compatível com as NF-e de amostra. Recomendo aprovar.', 'baixo');
    kyc('c-brisa', 'pendencia', 'cedente', { 4: { status: 'divergente', agente: { confianca: 0.52, nota: 'DRE informa faturamento 18% menor que a soma das NF-e de amostra.' } }, 5: { status: 'expirado', agente: { confianca: 0.98, nota: 'Certidão vencida em 02/11/2026.' } }, 6: { status: 'pendente', arquivo: null, agente: null } }, 'Faltam o comprovante da conta de liquidação e a certidão atualizada; faturamento divergente. Solicitar documentos.', 'medio');
    kyc('f-kappa', 'em_analise', 'financiador', { 2: { status: 'pendente', arquivo: null, agente: null } }, 'Falta o regulamento do fundo; demais documentos conferem. Não recomendo aprovar sem ele.', 'medio');
    kyc('c-campo', 'aprovado', 'cedente', null, 'Aprovado em 05/10/2026.', 'baixo'); db.patch('kyc', 'kyc-c-campo', { atualizadoEm: d(10, 5) });
    ['c-aurora', 'c-tecnoparts', 'c-sertao', 'c-horizonte', 'c-nova', 'f-vertice', 'f-nordeste', 'f-atlas', 'f-prisma', 'f-orla'].forEach((o) => kyc(o, 'aprovado', S.orgs[o].kind, null, 'Aprovado na abertura da conta.', 'baixo'));
    // Propostas dos agentes aguardando decisão humana
    const pr = (agenteId, tipo, ent, resumo, ev, conf, classe, extra) => db.put('propostas', Object.assign({ id: C.uid('pp'), agenteId, tipo, entidade: ent, resumo, evidencias: ev, confianca: conf, classe, status: 'pendente', ts: NOW - Math.round(rnd() * 1.2e7), nivelAgente: S.agentes[agenteId].nivel }, extra || {}));
    pr('ag-docs', 'aprovar_kyc', { kind: 'org', id: 'c-vale' }, 'Aprovar o cadastro da Metalúrgica Vale do Aço (cedente)', ['7 de 7 documentos legíveis e consistentes', 'CNPJ ativo há 14 anos, sem restrições', 'Sócios sem apontamentos em listas restritivas', 'Faturamento declarado: R$ 22,5 mi/ano, compatível'], 0.95, 'R1');
    pr('ag-docs', 'pedir_documentos', { kind: 'org', id: 'c-brisa' }, 'Solicitar à Brisa Embalagens: certidão atualizada e comprovante da conta', ['Certidão federal vencida em 02/11', 'Comprovante da conta de liquidação ausente', 'DRE diverge das NF-e (−18%)'], 0.88, 'R1');
    pr('ag-docs', 'reprovar_kyc', { kind: 'org', id: 'f-kappa' }, 'Manter Kappa FIDC em pendência até receber o regulamento do fundo', ['Regulamento ausente', 'Demais documentos conferem'], 0.71, 'R1');
    pr('ag-conciliacao', 'ratear', { kind: 'casoMesa', id: 'pendente' }, 'Rateio sugerido para pagamento parcial da Ferrobrás (R$ 168.000)', ['Operação vencida hoje tem prioridade', 'Pagamento cobre 70% do saldo aberto', 'Sacado costuma pagar o restante em D+2'], 0.82, 'R3');
    pr('ag-prevalidacao', 'ajustar_politica', { kind: 'plataforma', id: 'premium' }, 'Reduzir o ticket mínimo do Cedy Premium de R$ 20 mil para R$ 15 mil', ['11 títulos recusados por ticket nos últimos 30 dias', '7 deles com sacados rating A', 'Financiadores ativos com ticket mínimo ≤ R$ 15 mil: 3 de 5'], 0.64, 'R2');
    pr('ag-cobranca', 'regua', { kind: 'org', id: 's-tempus' }, 'Enviar lembrete reforçado à Tempus: título vencido há 6 dias', ['Vencido em 17/11', 'Histórico: 3 atrasos em 90 dias', 'Canal preferido: e-mail do contas a pagar'], 0.9, 'R1');
    return true;
  }

  function build() {
    const S = base(); C.store._set(S);
    C.clock.set(C.clock.start);
    scenario(S);
    extras(S);
    if (C.seedPlataforma) C.seedPlataforma(S);
    if (C.seedCom) C.seedCom(S);
    // marca notificações antigas como lidas; mantém as das últimas 36h não lidas
    const db = C.store.db; const NOW = C.clock.start;
    db.all('notifs').forEach((n) => { if (n.ts < NOW - 36 * 3600e3) n.lida = true; });
    S.ledger.forEach((e) => (e.ts = Math.min(e.ts, NOW)));
    C.store.ledger.rebuild();
    // preferências/estado inicial
    S.session = null; S.theme = 'auto'; S.marketOn = true; S.clockNow = NOW; S.tourDone = false;
    C.clock.set(NOW);
    return S;
  }
  C.seed = { build };
})();
