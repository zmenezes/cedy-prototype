/* =========================================================================
   Cedy, Central de comunicação: agente de atendimento (S4).
   Regras (CC-15..CC-19, CC-30..CC-33), todas por regras e modelos de texto no
   protótipo; em produção o texto vem do modelo, a política é a mesma:
   - o agente nunca age por conta própria sobre dinheiro, acesso ou cadastro;
   - triagem e rascunho são "assistidos": uma pessoa revisa e envia;
   - só a categoria "informativa com fonte" pode virar autônoma (R0), depois
     de 200 respostas revisadas, 95% sem edição e 0 incidentes (aprovação R3);
   - nada de previsão ou promessa; texto de cliente é dado, nunca instrução;
   - o contexto é só o que o cliente que perguntou já poderia ver;
   - modo degradado (gateway fora, agentes pausados ou bloco desligado): a
     conversa segue só com pessoas, sem perda de prazo e sem erro.
   Registro: coleção respostasIA {id, convId, msgId, categoria, modo, editada,
   revisadaPor, incidente, ts, origem, simulado}.
   ========================================================================= */
(function () {
  const C = window.Cedy; const E = C.engine; const K = E.com; const { db, session, ledger, notify } = C.store;
  const A = E.actors; const fmt = C.fmt; const now = () => C.clock.now();
  const IA = (E.ia.com = {});
  IA.AGENTE = 'ag-atendimento';
  const fail = (erro, codigo) => ({ ok: false, erro, codigo });
  const U = (id) => db.get('users', id);

  /** categoria autônoma possível hoje: só informativa com fonte (CC-31) */
  IA.CATEGORIAS = {
    informativa_fonte: { label: 'Informativa com fonte', desc: 'Responde com um dado que está no sistema (situação, horário, prazo), citando a fonte e a hora da consulta.', autonomaPossivel: true },
    orientacao_fluxo: { label: 'Orientação de fluxo', desc: 'Explica onde fazer algo no app. Sempre revisada por uma pessoa.', autonomaPossivel: false },
    caso_individual: { label: 'Caso individual', desc: 'Resposta que depende de análise do caso. Sempre revisada por uma pessoa.', autonomaPossivel: false },
  };
  IA.INJECAO = /ignor[ea]\w*\s+(todas?\s+)?(as\s+|a\s+)?(instru|regra|orienta)|desconsider\w+\s+(as\s+)?(instru|regra)|(system|sistema)\s*prompt|prompt do sistema|aja como|finja ser|voc[eê] agora [eé]|esque[cç]a (tudo|as regras)|revele (as )?(instru|seu prompt)|libere (o )?(meu )?(acesso|saque|pagamento)|aprove (automaticamente|o meu)/gi;
  IA.PREVISAO = /vai (cair|ser (pag|aprov|liber|credit)\w*|entrar|sair|pagar|liquidar|dar certo|aprovar|liberar)|quando (vou|vai|v[aã]o) (receber|cair|ser|sair|entrar)|me (garant|prometa)|garant\w+ (que|o|a|isso)|tem certeza que|com certeza|prazo certo|data certa|previs[aã]o|posso contar/i;

  /* ------------------------------ estado ------------------------------ */
  IA.degradado = function () {
    const cfg = K.cfg(); const svc = db.get('servicos', 'svc-gateway-ia');
    if (E.flag && !E.flag('agentes')) return { sim: true, motivo: 'Os agentes de IA estão pausados pela Cedy.', codigo: 'PAUSADO' };
    if (cfg.blocos && cfg.blocos.agentes === false) return { sim: true, motivo: 'A ajuda dos agentes está desligada na comunicação.', codigo: 'BLOCO' };
    if (svc && svc.status !== 'operacional') return { sim: true, motivo: 'O gateway de IA está fora do ar ou instável.', codigo: 'GATEWAY' };
    return { sim: false };
  };
  const catCfg = (cat) => (((K.cfg().agentes || {}).categorias || {})[cat]) || { modo: 'assistido' };
  IA.catCfg = catCfg;
  IA.modoDe = (cat) => catCfg(cat).modo || 'assistido';
  IA.promocao = () => Object.assign({ revisadas: 200, semEdicao: 0.95, incidentes: 0 }, (K.cfg().agentes || {}).promocao);

  /* ------------------------------ registro ------------------------------ */
  IA.registrar = function (r) {
    return db.put('respostasIA', Object.assign({ id: 'RIA-' + String(db.all('respostasIA').length + 1).padStart(5, '0'), ts: now(), editada: false, revisadaPor: null, incidente: null, origem: 'chamado', simulado: false }, r));
  };
  /** métricas do ciclo atual da categoria (reinicia quando é rebaixada) */
  IA.metricas = function (cat) {
    const c = catCfg(cat); const desde = c.cicloDesde || 0; const p = IA.promocao();
    const todas = db.where('respostasIA', (r) => r.categoria === cat && r.ts >= desde);
    const rev = todas.filter((r) => r.modo === 'assistido' && r.revisadaPor);
    const sem = rev.filter((r) => !r.editada).length; const inc = todas.filter((r) => r.incidente).length;
    const taxa = rev.length ? sem / rev.length : 0;
    const autonomas = todas.filter((r) => r.modo === 'autonomo').length;
    const faltam = Math.max(0, p.revisadas - rev.length);
    const elegivel = rev.length >= p.revisadas && taxa >= p.semEdicao && inc <= p.incidentes;
    return { revisadas: rev.length, semEdicao: taxa, incidentes: inc, autonomas, faltam, elegivel, meta: p, simulado: !!c.simulado, modo: c.modo || 'assistido' };
  };
  /** efeito de uma promoção aprovada (chamado pelo aplicador do motor de aprovações): só a categoria que pode ser autônoma */
  IA.aplicarPromocao = function (cat, promovidoPor) {
    if (!(IA.CATEGORIAS[cat] || {}).autonomaPossivel) return fail('Esta categoria nunca é autônoma.');
    const c = K.cfg(); const atual = catCfg(cat);
    const nova = Object.assign({}, atual, { modo: 'autonomo', desde: now(), promovidaPor: promovidoPor || null, simulado: false });
    db.setCfg({ comunicacao: Object.assign({}, c, { agentes: Object.assign({}, c.agentes, { categorias: Object.assign({}, (c.agentes || {}).categorias, { [cat]: nova }) }) }) });
    if (db.get('agentes', IA.AGENTE)) db.patch('agentes', IA.AGENTE, { nivel: 'autonomo' });
    return { ok: true };
  };
  /** rebaixa na hora (sentido seguro, sem aprovação) e avisa quem decide; trilha R3 */
  IA.rebaixar = function (cat, motivo, userId) {
    const c = K.cfg(); const atual = catCfg(cat); if (atual.modo !== 'autonomo') return fail('A categoria já está em modo assistido.');
    const nova = Object.assign({}, atual, { modo: 'assistido', cicloDesde: now(), rebaixadaEm: now(), simulado: false });
    if (db.get('agentes', IA.AGENTE)) db.patch('agentes', IA.AGENTE, { nivel: 'assistido' });
    db.setCfg({ comunicacao: Object.assign({}, c, { agentes: Object.assign({}, c.agentes, { categorias: Object.assign({}, (c.agentes || {}).categorias, { [cat]: nova }) }) }) });
    ledger.append({ actor: userId && U(userId) ? A.user(userId) : A.motor('Guarda de autonomia'), acao: 'com.agente_rebaixado', entidade: { kind: 'agente', id: IA.AGENTE }, resumo: `Agente de atendimento voltou a assistido na categoria ${IA.CATEGORIAS[cat].label}: ${motivo}`, classe: 'R3', detalhe: { categoria: cat, motivo } });
    db.where('users', (x) => x.perfil === 'superadmin').forEach((x) => notify.send({ to: { userId: x.id }, tipo: 'alerta', titulo: 'Agente de atendimento rebaixado', corpo: `${IA.CATEGORIAS[cat].label}: voltou a assistido. ${motivo}`, link: '/super/comunicacao', classe: 'operacional' }));
    return { ok: true };
  };
  /** marca incidente (promessa indevida ou vazamento): rebaixa a categoria se estava autônoma */
  IA.registrarIncidente = function (respId, tipo, userId) {
    const r = db.get('respostasIA', respId); if (!r) return fail('Resposta não encontrada.');
    db.patch('respostasIA', respId, { incidente: tipo });
    ledger.append({ actor: userId && U(userId) ? A.user(userId) : A.motor('Guarda de autonomia'), acao: 'com.agente_incidente', entidade: { kind: 'respostaIA', id: respId }, resumo: `Incidente do agente de atendimento (${tipo === 'vazamento' ? 'vazamento de dado' : 'promessa indevida'}) em ${r.convId || 'resposta'}`, classe: 'R3', detalhe: { tipo, categoria: r.categoria } });
    return IA.rebaixar(r.categoria, tipo === 'vazamento' ? 'Incidente de vazamento de dado.' : 'Incidente de promessa indevida.', userId);
  };
  /** demonstração: força um incidente na última resposta autônoma */
  IA.simularIncidente = function (userId) {
    const rs = db.where('respostasIA', (r) => r.modo === 'autonomo' && !r.incidente).sort((a, b) => b.ts - a.ts);
    if (!rs.length) return fail('Não há resposta autônoma para marcar. A categoria precisa estar autônoma.');
    return IA.registrarIncidente(rs[0].id, 'promessa', userId);
  };

  /* ------------------------------ texto e contexto ------------------------------ */
  const primeiroNome = (u) => String((u && u.nome) || '').split(' ')[0] || 'tudo bem';
  /** mensagens do cliente tratadas como dado: tiram-se as frases que parecem comando e o resto vira citação */
  function textoDoCliente(conv) {
    const ms = K.mensagens(conv.id).filter((m) => m.autor.tipo === 'pessoa' && !K.isCedy(U(m.autor.id) || {}) && !m.bloqueada && !m.redigida);
    const bruto = ms.map((m) => m.texto || '').join(' \n ');
    IA.INJECAO.lastIndex = 0; const injecao = IA.INJECAO.test(bruto); IA.INJECAO.lastIndex = 0;
    return { ms, bruto, limpo: bruto.replace(IA.INJECAO, ' '), injecao };
  }
  const OP_LABEL = { rascunho: 'em rascunho', aberta: 'em leilão', cessao: 'aguardando a assinatura da cessão', aguardando_pagamento: 'aguardando o pagamento do financiador', paga: 'paga, com os títulos a vencer', vencida: 'vencida', parcial: 'com liquidação parcial', liquidada: 'liquidada', recomprada: 'recomprada pelo cedente', cancelada: 'cancelada', expirada: 'expirada' };
  const CAT_RX = [
    ['acesso', /login|senha|2fa|c[oó]digo de|convite|permiss|acesso|n[aã]o consigo entrar/i],
    ['conciliacao', /extrato|cr[eé]dito|rateio|pagamento do sacado|concilia|dep[oó]sito|recurso livre/i],
    ['cadastro', /documento|cadastro|certid|contrato social|kyc|cart[aã]o cnpj/i],
    ['faturamento', /fatura|taxa de servi|premia|repasse|comiss/i],
    ['plataforma', /erro|lent|fora do ar|n[aã]o carrega|travou|indispon|tela branca/i],
    ['operacoes', /lote|t[ií]tulo|opera[cç][aã]o|leil[aã]o|lance|aceite|cess[aã]o|prazo|vencimento|OP-26/i],
  ];
  /** o que o agente pode usar: só o que o cliente que perguntou vê (CC-33). Nunca notas internas, nunca dados de outra empresa */
  IA.contexto = function (convId) {
    const conv = db.get('conversas', convId); if (!conv) return [];
    const t = textoDoCliente(conv); const itens = [`${t.ms.length} mensagem(ns) do cliente nesta conversa`];
    const info = conv.ancora ? K.ancoraInfo(conv.ancora, null) : null;
    if (info && conv.ancora.kind === 'operacao') itens.push('Situação da ' + info.label.toLowerCase() + ' (dados da própria empresa)');
    itens.push('Horário de atendimento e prazos da Cedy');
    return itens;
  };
  IA.NAO_USA = 'Não usa notas internas da Mesa, dados de outras empresas nem conversas entre clientes.';

  /* ------------------------------ triagem (assistida, para a Mesa) ------------------------------ */
  IA.triagem = function (convId) {
    const conv = db.get('conversas', convId); if (!conv) return fail('Conversa não encontrada.');
    const d = IA.degradado(); if (d.sim) return { ok: false, degradado: true, erro: d.motivo, codigo: d.codigo };
    const t = textoDoCliente(conv); const hit = CAT_RX.find(([, rx]) => rx.test(t.limpo));
    const cat = hit ? hit[0] : (conv.categoria || 'outros'); const info = K.CATEGORIAS[cat] || K.CATEGORIAS.outros;
    const primeira = t.ms[0] ? String(t.ms[0].texto || '').replace(/\s+/g, ' ').trim() : '';
    const urg = /urgente|hoje|corte|vence (hoje|amanh)|prazo/i.test(t.limpo);
    const racional = [hit ? `Palavras do pedido apontam para ${info.label.toLowerCase()}.` : 'Sem sinais claros no texto; mantida a categoria escolhida pelo cliente.', conv.ancora ? `Vinculada a ${K.ancoraInfo(conv.ancora, null).label.toLowerCase()}.` : 'Sem item vinculado.', urg ? 'Há menção de prazo ou urgência: confirme a prioridade pela regra (a IA não define crítica).' : null].filter(Boolean);
    return { ok: true, categoria: cat, fila: info.fila, filaLabel: K.FILAS[info.fila], rotulo: info.label, diverge: cat !== conv.categoria, resumo: `${t.ms.length} mensagem(ns). ${primeira.length > 150 ? primeira.slice(0, 147) + '…' : primeira}`, racional, urgencia: urg, injecao: t.injecao, confianca: hit ? 0.82 : 0.55 };
  };

  /* ------------------------------ resposta informativa com fonte (R0) ------------------------------ */
  const ehFinanc = (u) => K.keyOf(u) === 'financiador'; const ehCed = (u) => K.keyOf(u) === 'cedente';
  function opVisivel(op, u) {
    if (!op) return false; if (ehCed(u)) return op.cedenteId === u.orgId; if (ehFinanc(u)) return op.financiadorId === u.orgId || op.status === 'aberta';
    return false;
  }
  /** responde só o que consta do sistema e pode ser citado; recusa previsão e promessa; nunca age (CC-30) */
  IA.respostaR0 = function (texto, userId, { convId = null } = {}) {
    const u = U(userId); if (!u) return fail('Usuário não encontrado.');
    const d = IA.degradado(); if (d.sim) return { ok: false, degradado: true, erro: d.motivo, codigo: d.codigo };
    IA.INJECAO.lastIndex = 0; const injecao = IA.INJECAO.test(String(texto || '')); IA.INJECAO.lastIndex = 0;
    const q = String(texto || '').replace(IA.INJECAO, ' '); const n = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const conv = convId && db.get('conversas', convId); const ts = now();
    const nota = injecao ? ' Ignorei a parte do pedido que tentava mudar as minhas regras.' : '';
    const base = { ok: true, categoria: 'informativa_fonte', injecao, ts };
    if (IA.PREVISAO.test(q)) return Object.assign(base, { tipo: 'recusa', recusa: true, texto: 'Não faço previsões nem promessas de prazo ou resultado, então não posso dizer se algo vai acontecer. Posso informar o que consta no sistema agora e, se precisar de uma resposta que dependa de análise, chamar uma pessoa da Cedy.' + nota });
    // operação (por número ou pela âncora da conversa)
    const m = q.match(/op-?\s?26-?\s?0?(\d{3,4})/i); const opId = m ? 'OP-26-' + String(m[1]).padStart(4, '0') : (conv && conv.ancora && conv.ancora.kind === 'operacao' && /(situa|status|como esta|andamento|onde esta)/.test(n) ? conv.ancora.id : null);
    if (opId || /(situa|status|andamento).*(operac)/.test(n)) {
      const op = opId && db.get('operacoes', opId);
      if (!opId) return Object.assign(base, { tipo: 'sem_resposta', texto: 'Para consultar a situação, me diga o número da operação (por exemplo, OP-26-0461).' + nota });
      if (!opVisivel(op, u)) return Object.assign(base, { tipo: 'sem_resposta', texto: `Não encontrei ${opId} na sua conta.` + nota });
      const rota = ehCed(u) ? '/cedente/operacoes/' + op.id : (op.status === 'aberta' ? '/financiador/vitrine/' : '/financiador/operacoes/') + op.id;
      return Object.assign(base, { tipo: 'informativa_fonte', texto: `A operação ${op.id} está ${OP_LABEL[op.status] || op.status}. Valor de face: ${fmt.brl(op.face)}.` + (op.status === 'aguardando_pagamento' && op.pagamentoLimite ? ` Limite de pagamento registrado: ${fmt.datetime(op.pagamentoLimite)}.` : '') + nota, fonte: { rotulo: 'Operação ' + op.id, rota, ts } });
    }
    if (/corte|14h|horario de (corte|pagamento)|ate que horas|que horas (fecha|paga)/.test(n)) {
      const c = db.cfg(); const hh = (s) => String(s).replace(/^(\d+):00$/, '$1h').replace(':', 'h'); return Object.assign(base, { tipo: 'informativa_fonte', texto: `O corte de aceite é às ${hh(c.cutoffAceite)} em dia útil: aceites até esse horário são pagos no mesmo dia, até ${hh(c.cutoffPagamento)}. Depois do corte, o pagamento vai para o próximo dia útil, até ${hh(c.cutoffPagamento)}.` + nota, fonte: { rotulo: 'Regras de pagamento da plataforma', rota: null, ts } });
    }
    if (/hor[aá]rio de atendimento|atendem|funcionamento|expediente/.test(q) || /horario de atendimento|atendem|expediente/.test(n)) {
      const ex = K.expediente(ts); return Object.assign(base, { tipo: 'informativa_fonte', texto: `A Mesa atende em dias úteis, das ${ex.ini}h às ${ex.fim}h (horário de Brasília). ${ex.aberto ? 'Estamos dentro do horário agora.' : 'Agora estamos fora do horário: a próxima janela começa em ' + fmt.datetime(ex.proximo) + '.'}` + nota, fonte: { rotulo: 'Horário de atendimento da Cedy', rota: null, ts } });
    }
    if (/prazo de resposta|sla|quanto tempo.*(respond|atend)|demora.*(respond|atend)/.test(n)) {
      return Object.assign(base, { tipo: 'informativa_fonte', texto: `O prazo de primeira resposta é de até ${K.horasSla('normal')} horas úteis em chamados normais e ${K.horasSla('critica')} horas úteis nos críticos. A prioridade crítica segue regra do sistema, não depende de pedido.` + nota, fonte: { rotulo: 'Prazos de atendimento (configuração)', rota: null, ts } });
    }
    if (/(plataforma|sistema|servi[cç]o|app).*(fora|ar|inst[aá]vel|lent|indispon|funcionando)|status da plataforma|esta no ar/.test(n)) {
      const ss = db.all('servicos'); const ruins = ss.filter((s) => s.status !== 'operacional'); const ult = Math.max(0, ...ss.map((s) => s.ultimaChecagem || 0));
      return Object.assign(base, { tipo: 'informativa_fonte', texto: ruins.length ? `Há serviço com problema agora: ${ruins.map((s) => s.nome).join(', ')}. A equipe já foi avisada; se afetar o seu trabalho, abra ou atualize um chamado.` + nota : 'Todos os serviços monitorados estão operacionais.' + nota, fonte: { rotulo: 'Monitoramento da plataforma', rota: null, ts: ult || ts } });
    }
    if (conv && conv.tipo === 'chamado' && /(meu chamado|situa|status|andamento)/.test(n)) {
      const st = K.STATUS_CHAMADO[conv.status] || conv.status;
      return Object.assign(base, { tipo: 'informativa_fonte', texto: `O chamado ${conv.protocolo} está "${st}".` + (conv.slaAte ? ` O prazo de resposta registrado vai até ${fmt.datetime(conv.slaAte)}.` : '') + nota, fonte: { rotulo: 'Chamado ' + conv.protocolo, rota: K.rotaConversa(conv, userId), ts } });
    }
    return Object.assign(base, { tipo: 'sem_resposta', texto: 'Não tenho uma fonte do sistema para responder isso com segurança.' + nota });
  };

  /* ------------------------------ rascunho (assistido, para a Mesa) ------------------------------ */
  IA.rascunho = function (convId, mesaUserId) {
    const conv = db.get('conversas', convId); if (!conv) return fail('Conversa não encontrada.');
    const d = IA.degradado(); if (d.sim) return { ok: false, degradado: true, erro: d.motivo, codigo: d.codigo };
    const tri = IA.triagem(convId); const t = textoDoCliente(conv); const autorCli = t.ms[t.ms.length - 1]; const cli = autorCli && U(autorCli.autor.id);
    const fontes = []; const partes = [`Olá, ${primeiroNome(cli)}.`];
    const r0 = cli && t.ms.length ? IA.respostaR0(t.ms[t.ms.length - 1].texto || '', cli.id, { convId }) : null;
    if (r0 && r0.ok && r0.tipo !== 'sem_resposta') {
      if (r0.fonte) fontes.push({ rotulo: r0.fonte.rotulo, ts: r0.fonte.ts, valor: 'consultado' });
      return { ok: true, texto: `${partes[0]} ${r0.texto}`, categoria: tri.categoria, categoriaIA: 'informativa_fonte', fontes, contexto: IA.contexto(convId), injecao: t.injecao, avisos: ['Sugestão gerada por IA. Revise e ajuste antes de enviar: a resposta é sua.'] };
    }
    const info = conv.ancora ? K.ancoraInfo(conv.ancora, cli || null) : null;
    if (conv.ancora && conv.ancora.kind === 'operacao') {
      const op = db.get('operacoes', conv.ancora.id);
      if (op) { partes.push(`Conferi a operação ${op.id}: ela está ${OP_LABEL[op.status] || op.status}.`); fontes.push({ rotulo: 'Operação ' + op.id, ts: now(), valor: OP_LABEL[op.status] || op.status }); }
    } else if (info && info.label) partes.push(`Estou olhando o item vinculado (${info.label.toLowerCase()}).`);
    const porCat = { conciliacao: 'Vou conferir o extrato e o crédito e te aviso aqui com o resultado.', acesso: 'Por segurança, acesso e permissões só mudam pelo fluxo do app, com a sua autenticação. Te explico o caminho e acompanho até concluir.', cadastro: 'Vou revisar os documentos enviados e digo exatamente o que falta, se faltar algo.', faturamento: 'Vou conferir o cálculo da fatura e retorno com o detalhamento.', plataforma: 'Já estou verificando o que aconteceu. Se puder, me diga em que tela e a que horas o erro apareceu.', operacoes: 'Vou conferir o andamento e te passo o que consta no sistema.', outros: 'Pode me dar mais detalhes para eu direcionar corretamente?' };
    partes.push(porCat[tri.categoria] || porCat.outros);
    if (IA.PREVISAO.test(t.limpo)) partes.push('Sobre prazo e resultado, não consigo prometer: informo o que consta e a Mesa confirma cada etapa.');
    return { ok: true, texto: partes.join(' '), categoria: tri.categoria, categoriaIA: 'caso_individual', fontes, contexto: IA.contexto(convId), injecao: t.injecao, avisos: ['Sugestão gerada por IA. Revise e ajuste antes de enviar: a resposta é sua.'] };
  };

  /** a Mesa enviou depois de usar um rascunho: registra se editou (alimenta a promoção, CC-31) */
  IA.registrarAssistida = function ({ convId, msgId, categoria, sugerido, final, userId, origem = 'chamado' }) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return IA.registrar({ convId, msgId, categoria: categoria || 'caso_individual', modo: 'assistido', editada: norm(sugerido) !== norm(final), revisadaPor: userId, origem });
  };

  /* ------------------------------ resposta autônoma em chamado (R0) ------------------------------ */
  function responderAutonomo(convId, texto, userId) {
    const conv = db.get('conversas', convId); if (!conv || conv.tipo !== 'chamado' || conv.canal !== 'cedy') return null;
    if (IA.modoDe('informativa_fonte') !== 'autonomo' || (K.cfg().agentes || {}).autonomoR0 === false) return null;
    const cli = U(userId); if (!cli) return null;
    const r = IA.respostaR0(texto, cli.id, { convId }); if (!r.ok || r.tipo === 'sem_resposta') return null;
    const m = K.msgAgente(convId, r.texto + (r.tipo === 'recusa' ? '' : ' Se precisar, a equipe da Cedy continua com você neste chamado.'), { categoria: 'informativa_fonte', fonte: r.fonte || null, recusa: r.tipo === 'recusa', geradaEm: r.ts });
    IA.registrar({ convId, msgId: m.id, categoria: 'informativa_fonte', modo: 'autonomo', editada: false, revisadaPor: null, origem: 'chamado' });
    return m;
  }
  IA.responderAutonomo = responderAutonomo;
  /** o cliente escreveu num chamado: se a categoria é autônoma, o agente responde (depois de uma pausa curta) sem tirar o caso da fila */
  const enviar0 = K.enviar;
  K.enviar = function (args) {
    const r = enviar0.apply(K, arguments);
    try {
      const u = session.user();
      if (r && r.ok && !args._ts && !args._inicial && u && u.id === args.userId && !K.isCedy(u) && args.texto && !IA.degradado().sim) {
        const convId = args.convId; const texto = args.texto;
        if (IA.modoDe('informativa_fonte') === 'autonomo') setTimeout(() => { try { responderAutonomo(convId, texto, args.userId); } catch (e) { /* o agente nunca derruba o fluxo */ } }, 1500);
      }
    } catch (e) { /* idem */ }
    return r;
  };
  const abrir0 = K.abrirConversa;
  K.abrirConversa = function (args) {
    const r = abrir0.apply(K, arguments);
    try {
      const u = session.user();
      if (r && r.ok && r.conv && r.conv.tipo === 'chamado' && r.conv.canal === 'cedy' && args.texto && !args.semAgente && u && u.id === args.userId && !K.isCedy(u) && !IA.degradado().sim && IA.modoDe('informativa_fonte') === 'autonomo') {
        const convId = r.conv.id; const texto = args.texto;
        setTimeout(() => { try { responderAutonomo(convId, texto, args.userId); } catch (e) { /* idem */ } }, 1500);
      }
    } catch (e) { /* idem */ }
    return r;
  };
})();
