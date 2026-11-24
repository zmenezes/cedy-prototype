/* =========================================================================
   Cedy, Central de Comunicação: motor de conversas, chamados, filtro de
   contato externo, SLA, ações reversíveis (R1), redação e trilha de acesso.
   Namespace E.com. Carregado depois do shell; as telas usam só E.com.*.
   Regras: mensagem não é autorização (só a lista fechada R1 é executada pela
   Mesa), mensagens são imutáveis com hash encadeado, a Cedy lê por papel e
   com motivo. Tudo simulado e determinístico no protótipo.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { db, session, ledger, notify } = C.store;
  const E = C.engine; const cal = C.cal;
  const A = E.actors;
  const now = () => C.clock.now();
  const fail = (erro, codigo, extra) => Object.assign({ ok: false, erro, codigo }, extra || {});
  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const K = (E.com = {});

  /* ------------------------------ constantes ------------------------------ */
  const DEF = {
    blocos: { pares: true, agentes: true, comunicados: true, anexos: true },
    limites: { usuarioMsgHora: 30, usuarioAnexosDia: 10, empresaMsgHora: 120 },
    sla: { critica: 2, normal: 8, baixa: 10, compliance: 10 },
    retencao: { operacaoAnos: 5, chamadoAnos: 2 },
    agentes: { autonomoR0: true, promocao: { revisadas: 200, semEdicao: 0.95, incidentes: 0 } },
  };
  K.cfg = () => db.cfg().comunicacao || DEF;

  K.CATEGORIAS = {
    operacoes: { label: 'Operações, lotes e títulos', icon: 'repeat', fila: 'mesa', dica: 'Lote, título, operação ou prazo.' },
    conciliacao: { label: 'Conciliação e pagamentos', icon: 'git-compare', fila: 'conciliadora', dica: 'Extrato, crédito, rateio ou pagamento do sacado.' },
    cadastro: { label: 'Cadastro e documentos', icon: 'id-card', fila: 'compliance', soAdmin: true, dica: 'Documentos, dados cadastrais e revisão do cadastro.' },
    acesso: { label: 'Acesso e segurança', icon: 'shield-check', fila: 'suporte', soAdmin: true, dica: 'Login, 2FA, convites e permissões.' },
    faturamento: { label: 'Faturamento e premiação', icon: 'receipt', fila: 'financeiro', dica: 'Faturas, taxas, premiação e repasses.' },
    plataforma: { label: 'Plataforma indisponível ou lenta', icon: 'server-cog', fila: 'suporte', dica: 'Erro na tela, lentidão ou indisponibilidade.' },
    outros: { label: 'Outros assuntos', icon: 'circle-question-mark', fila: 'suporte', dica: 'Qualquer outro assunto.' },
  };
  K.FILAS = { mesa: 'Operações', conciliadora: 'Conciliação', compliance: 'Compliance e risco', financeiro: 'Financeiro', suporte: 'Suporte' };
  K.PRIORIDADES = { critica: 'Crítica', normal: 'Normal', baixa: 'Baixa' };
  K.STATUS_CHAMADO = { aberto: 'Aberto', em_atendimento: 'Em atendimento', aguardando_cliente: 'Aguardando você', resolvido: 'Resolvido', encerrado: 'Encerrado' };
  K.TIPOS_FEED = [
    { id: 'conversas', label: 'Conversas', icon: 'messages-square' },
    { id: 'chamados', label: 'Chamados', icon: 'life-buoy' },
    { id: 'comunicados', label: 'Comunicados', icon: 'megaphone' },
    { id: 'obrigatorias', label: 'Obrigatórias', icon: 'shield-alert' },
    { id: 'operacionais', label: 'Operacionais', icon: 'bell' },
    { id: 'informativas', label: 'Informativas', icon: 'info' },
    { id: 'alertas', label: 'Alertas', icon: 'triangle-alert' },
    { id: 'aprovacoes', label: 'Aprovações', icon: 'stamp' },
  ];
  /** Lista fechada de ações reversíveis (R1) que a Mesa executa por chamado (CC-08) */
  K.ACOES = {
    reenviar_convite: { label: 'Reenviar convite ou lembrete', icon: 'mail', desc: 'Reenvia um convite que ainda não foi aceito.' },
    reabrir_lote: { label: 'Reabrir lote recusado', icon: 'rotate-ccw', desc: 'O lote volta para a validação. A Mesa não o aprova por esse pedido.' },
    corrigir_cadastro: { label: 'Corrigir dado cadastral não sensível', icon: 'pencil', desc: 'Cidade, UF, nome fantasia, cargo ou telefone. Dados bancários e de acesso ficam de fora.' },
    iniciar_reset_2fa: { label: 'Iniciar redefinição de 2FA', icon: 'smartphone', soAdmin: true, desc: 'A Mesa inicia e a pessoa conclui no app. Só o administrador pede.' },
    segunda_via: { label: 'Segunda via de documento', icon: 'file-text', desc: 'Reemite a fatura, o contrato ou o relatório.' },
    reatribuir: { label: 'Priorizar ou reatribuir este chamado', icon: 'arrow-left-right', desc: 'Pede à Mesa para mudar a área responsável ou a prioridade.' },
  };
  /** Pedidos fora da lista nunca são feitos por mensagem (CC-07, CC-08): devolvem FLUXO_FORMAL */
  K.FORA_DA_LISTA = [
    { id: 'cancelar_operacao', rx: /cancel\w*[^.\n]{0,40}(opera|cess|leil)/i, titulo: 'Cancelar uma operação', rota: (b) => b + '/operacoes' },
    { id: 'desbloquear_login', rx: /(desbloque|destrav|liber)\w*[^.\n]{0,30}(login|acesso|senha|usu[aá]rio|conta)/i, titulo: 'Desbloquear login ou redefinir senha', rota: (b) => b + '/configuracoes?aba=seguranca' },
    { id: 'exportar_dados', rx: /(export|baix|me envi|extrair)\w*[^.\n]{0,30}(dados|base|cadastro|todos)/i, titulo: 'Exportar dados', rota: (b) => b + '/configuracoes?aba=empresa' },
    { id: 'conta_bancaria', rx: /(alter|troc|mud|atualiz)\w*[^.\n]{0,30}(conta|banc[aá]ri|ag[eê]ncia|pix)/i, titulo: 'Alterar conta bancária', rota: (b) => b + '/configuracoes?aba=empresa' },
    { id: 'acesso_perfil', rx: /(d[eê]|alter|troc|mud|inclu|remov|revog)\w*[^.\n]{0,30}(acesso|permiss|perfil de|administrador)/i, titulo: 'Alterar acesso ou perfil de usuário', rota: (b) => b + '/configuracoes?aba=usuarios' },
    { id: 'limite_taxa', rx: /(aument|alter|mud|libera|reduz)\w*[^.\n]{0,30}(limite|taxa|lar\b)/i, titulo: 'Alterar limite ou taxa', rota: (b) => b + '/limites' },
    { id: 'mexer_dinheiro', rx: /(liber|pag|transfer|estorn|devolv)\w*[^.\n]{0,30}(dinheiro|valor|pagamento|recurso|saldo|repasse)/i, titulo: 'Movimentar dinheiro', rota: (b) => b },
  ];
  K.MODELOS = {
    esclarecimentos: {
      perguntas: [
        { id: 'pedir_documento', label: 'Pedir um documento', campo: { id: 'documento', label: 'Documento', opcoes: ['Nota fiscal (XML)', 'Comprovante de entrega', 'Contrato com o sacado', 'Última conciliação do sacado'] } },
        { id: 'esclarecer_sacado', label: 'Esclarecer algo sobre o sacado', campo: { id: 'assunto', label: 'Assunto', opcoes: ['Histórico de pagamento', 'Prazo médio de pagamento', 'Concentração na carteira', 'Relação comercial com o cedente'] } },
        { id: 'confirmar_dado', label: 'Confirmar um dado do título', campo: { id: 'dado', label: 'Dado', opcoes: ['Valor', 'Vencimento', 'Número da nota', 'Sacado'] } },
      ],
    },
    cedente_sacado: {
      perguntas: [
        { id: 'confirmar_titulo', label: 'Pedir confirmação de um título', campo: { id: 'prazo', label: 'Prazo desejado', opcoes: ['Hoje', 'Em 1 dia útil', 'Em 3 dias úteis'] } },
        { id: 'informar_pagamento', label: 'Perguntar a data prevista de pagamento', campo: { id: 'titulo', label: 'Referente a', opcoes: ['Título desta conversa', 'Todos os títulos em aberto'] } },
        { id: 'segunda_via_boleto', label: 'Pedir a segunda via do boleto', campo: { id: 'motivo', label: 'Motivo', opcoes: ['Extravio', 'Vencimento ajustado', 'Dados incorretos'] } },
      ],
    },
    orig_indicado: {
      perguntas: [
        { id: 'lembrar_cadastro', label: 'Lembrar de concluir o cadastro', campo: { id: 'etapa', label: 'Etapa', opcoes: ['Dados da empresa', 'Documentos', 'Conta de liquidação', 'Aceite dos termos'] } },
        { id: 'pendencia_doc', label: 'Avisar sobre pendência de documento', campo: { id: 'documento', label: 'Documento', opcoes: ['Contrato social', 'Cartão CNPJ', 'Certidão federal', 'Comprovante da conta'] } },
        { id: 'reenvio_convite', label: 'Avisar que o convite foi reenviado', campo: { id: 'via', label: 'Via', opcoes: ['E-mail', 'Link do convite'] } },
      ],
    },
    respostas: [
      { id: 'entendido', label: 'Entendido, vou providenciar' },
      { id: 'enviado', label: 'Já enviei, pode conferir' },
      { id: 'confirmo', label: 'Confirmo a informação' },
      { id: 'documento_anexado', label: 'Documento anexado a esta mensagem' },
      { id: 'indisponivel', label: 'Informação indisponível no momento' },
      { id: 'preciso_ajuda', label: 'Preciso de ajuda com isso' },
      { id: 'nao_se_aplica', label: 'Não se aplica ao meu caso' },
    ],
  };
  K.modelosDe = (canal) => ((K.MODELOS[canal] || {}).perguntas || []);

  /* ------------------------------ identidade ------------------------------ */
  const U = (id) => db.get('users', id);
  const orgOf = (u) => u && db.get('orgs', u.orgId);
  const keyOf = (u) => (u ? C.keyOfUser(u, orgOf(u)) : null);
  const isCedy = (u) => !!u && !!orgOf(u) && orgOf(u).kind === 'cedy';
  K.isCedy = isCedy;
  K.keyOf = keyOf;
  const ehLider = (u) => isCedy(u) && (u.perfil === 'admin' || u.perfil === 'superadmin');
  K.ehLider = ehLider;
  function temPerm(u, perm) {
    if (!u || !isCedy(u)) return false;
    if (u.perfil === 'superadmin') return true;
    if (u.perfil === 'leitor') return false;
    if (u.perfil === 'admin') return true;
    const p = C.OPS_PAPEIS[u.papel]; return !!p && (p.perms.includes('*') || p.perms.includes(perm));
  }
  K.temPerm = temPerm;
  /** raiz de rotas do usuário (cliente, Mesa ou Superadmin) */
  K.base = (u) => (C.roles[keyOf(u)] || C.roles.cedente).home;
  K.nomeOrg = (id) => { const o = db.get('orgs', id); return o ? (o.fantasia || o.nome) : '—'; };
  const autorDe = (u) => {
    const o = orgOf(u); const cedy = isCedy(u);
    return { tipo: 'pessoa', id: u.id, nome: u.nome, orgId: u.orgId, orgNome: o ? (o.fantasia || o.nome) : '', perfil: u.perfil, chave: keyOf(u), papel: cedy ? (u.perfil === 'superadmin' ? 'Superadmin' : (C.OPS_PAPEIS[u.papel] || {}).label || 'Mesa Cedy') : ({ admin: 'Administrador', operador: 'Operador', leitor: 'Leitor', subparceiro: 'Subparceiro' }[u.perfil] || u.perfil) };
  };
  K.autorDe = autorDe;
  const SISTEMA = { tipo: 'sistema', id: 'sistema', nome: 'Cedy', orgNome: 'Regra automática', papel: 'Sistema' };

  /* ------------------------------ horário e SLA ---------------------------- */
  const janela = () => { const h = db.cfg().horarioValidacao || { ini: 8, fim: 18 }; return [h.ini, h.fim]; };
  /** Mesa atende em dias úteis, das 8h às 18h (CC-11); fora disso diz quando volta (CC-36) */
  K.expediente = function (ts = now()) {
    const [ini, fim] = janela(); const p = cal.sp(ts); const aberto = cal.isUtil(ts) && p.h >= ini && p.h < fim;
    const proximo = aberto ? ts : (cal.isUtil(ts) && p.h < ini ? cal.spTs(p.y, p.m, p.d, ini, 0) : cal.nextUtil(ts, ini, 0));
    return { aberto, proximo, ini, fim };
  };
  /** minutos úteis entre a e b (janela de atendimento) */
  function minutosUteis(a, b) {
    if (b <= a) return 0; const [ini, fim] = janela(); let t = a, total = 0;
    while (t < b) { const p = cal.sp(t); if (cal.isUtil(t)) { const s = Math.max(t, cal.spTs(p.y, p.m, p.d, ini, 0)); const e = Math.min(b, cal.spTs(p.y, p.m, p.d, fim, 0)); if (e > s) total += (e - s) / 60000; } t = cal.spTs(p.y, p.m, p.d + 1, 0, 0); }
    return Math.round(total);
  }
  K.minutosUteis = minutosUteis;
  K.horasSla = (prio) => (K.cfg().sla || DEF.sla)[prio] || DEF.sla.normal;
  K.slaDe = (prio, desde = now()) => E.slaAte(desde, K.horasSla(prio));
  K.slaEstourado = (conv) => !!conv && conv.tipo === 'chamado' && !!conv.slaAte && conv.slaAte < now() && ['aberto', 'em_atendimento'].includes(conv.status);

  /* ------------------------------ âncoras -------------------------------- */
  /** rótulo, empresa dona e rota por perfil de quem olha */
  K.ancoraInfo = function (a, viewer) {
    if (!a) return null; const key = viewer ? keyOf(viewer) : 'cedente'; const b = C.roles[key] ? C.roles[key].home : '/cedente';
    if (a.kind === 'operacao') { const op = db.get('operacoes', a.id); if (!op) return { label: 'Operação ' + a.id, rota: null };
      const rota = key === 'ops' || key === 'superadmin' ? '/ops/empresas/' + op.cedenteId : key === 'financiador' ? (op.status === 'aberta' ? '/financiador/vitrine/' : '/financiador/operacoes/') + op.id : key === 'cedente' ? '/cedente/operacoes/' + op.id : null;
      return { label: 'Operação ' + op.id, rota, orgs: [op.cedenteId, op.financiadorId].filter(Boolean), cedenteId: op.cedenteId, financiadorId: op.financiadorId || null }; }
    if (a.kind === 'titulo') { const t = db.get('titulos', a.id); if (!t) return { label: 'Título', rota: null };
      return { label: 'Título ' + t.numero, rota: key === 'cedente' ? '/cedente/titulos?q=' + encodeURIComponent(t.numero) : key === 'sacado' ? '/sacado/titulos' : '/ops/empresas/' + t.orgId, orgs: [t.orgId], cedenteId: t.orgId, sacadoId: t.sacadoId }; }
    if (a.kind === 'lote') { const l = db.get('lotes', a.id); return { label: 'Lote ' + a.id, rota: key === 'cedente' ? '/cedente/titulos' : '/ops/mesa', orgs: l ? [l.cedenteId] : [], cedenteId: l && l.cedenteId }; }
    if (a.kind === 'caso') { const c = db.get('casosMesa', a.id); return { label: 'Caso de conciliação', rota: key === 'cedente' ? '/cedente/conta' : '/ops/conciliacao', orgs: c ? [c.cedenteId] : [], cedenteId: c && c.cedenteId }; }
    if (a.kind === 'cadastro') { const o = db.get('orgs', a.id); return { label: 'Cadastro' + (o ? ' de ' + (o.fantasia || o.nome) : ''), rota: key === 'ops' || key === 'superadmin' ? '/ops/kyc' : b + '/cadastro', orgs: [a.id] }; }
    if (a.kind === 'competencia') { const pm = db.get('premiacoes', a.id); return { label: 'Competência ' + (pm ? C.fmt.month(cal.spTs(+pm.competencia.slice(0, 4), +pm.competencia.slice(5, 7), 1)) : a.id), rota: key === 'ops' || key === 'superadmin' ? '/ops/faturamento' : b + '/premiacao', orgs: pm ? [pm.origId] : [] }; }
    return { label: a.label || 'Conversa', rota: null, orgs: [] };
  };
  const FILA_POR_ANCORA = { operacao: 'mesa', titulo: 'mesa', lote: 'mesa', caso: 'conciliadora', cadastro: 'compliance', competencia: 'financeiro' };

  /* ------------------------------ bloqueios ------------------------------- */
  /** Há bloqueio entre as empresas? (CC-23, CC-39) Bloquear ofertas implica bloquear conversa. */
  K.bloqueado = function (orgA, orgB) {
    if (!orgA || !orgB) return false;
    const a = db.get('orgs', orgA), b = db.get('orgs', orgB);
    if ((a && (a.bloqueados || []).includes(orgB)) || (b && (b.bloqueados || []).includes(orgA))) return true;
    return db.where('bloqueiosCom', (x) => (x.orgId === orgA && x.contraOrgId === orgB) || (x.orgId === orgB && x.contraOrgId === orgA)).length > 0;
  };

  /* ------------------------------ matriz ---------------------------------- */
  /**
   * Quem pode falar com quem (CC-01 a CC-03). de/para = chaves de perfil.
   * ctx: {aceita, silencioso, mesmaEmpresa, bloqueado}. Devolve {modo:'nenhum'|'estruturada'|'ancorada', canal, motivo}.
   */
  K.matriz = function (de, para, ctx = {}) {
    const par = [de, para].sort().join('|'); let r;
    if (ctx.mesmaEmpresa) r = { modo: 'ancorada', canal: 'interna' };
    else if (de === 'ops' || para === 'ops' || de === 'superadmin' || para === 'superadmin') r = { modo: 'ancorada', canal: 'cedy' };
    else if (par === 'cedente|financiador') r = ctx.aceita ? { modo: 'ancorada', canal: 'pos_aceite' } : { modo: 'estruturada', canal: 'esclarecimentos' };
    else if (par === 'cedente|sacado') r = ctx.silencioso ? { modo: 'nenhum', motivo: 'Neste programa o sacado não é notificado: a plataforma nunca inicia contato com ele.' } : { modo: 'estruturada', canal: 'cedente_sacado' };
    else if (par === 'cedente|originador') r = { modo: 'estruturada', canal: 'orig_indicado' };
    else if (par === 'originador|subparceiro') r = { modo: 'ancorada', canal: 'orig_sub' };
    else if (par === 'financiador|sacado') r = { modo: 'nenhum', motivo: 'Não há canal entre financiador e sacado: a cobrança passa pela Cedy.' };
    else r = { modo: 'nenhum', motivo: 'Não há canal entre estes perfis.' };
    if (r.modo !== 'nenhum' && r.canal !== 'cedy' && r.canal !== 'interna') {
      if (K.cfg().blocos && K.cfg().blocos.pares === false) return { modo: 'nenhum', motivo: 'O canal entre empresas está pausado pela Cedy.', pausado: true };
      if (ctx.bloqueado) return { modo: 'nenhum', motivo: 'Há um bloqueio entre as duas empresas.', bloqueado: true };
    }
    return r;
  };

  /* --------------------------- visibilidade (CC-21) ------------------------ */
  function podeVerOp(op, org) {
    if (!op || !org) return false;
    if (op.cedenteId === org.id || op.financiadorId === org.id) return true;
    if (org.kind !== 'financiador' || op.status !== 'aberta') return false;
    const ced = db.get('orgs', op.cedenteId); if (ced && (ced.bloqueados || []).includes(org.id)) return false;
    return op.canal === 'vitrine' || op.financiadorAlvoId === org.id;
  }
  /** 'escreve' | 'atende' | 'le' | 'motivo' (precisa informar o motivo) | null */
  K.acesso = function (conv, u) {
    if (!conv || !u) return null;
    if (isCedy(u)) {
      if (conv.canal === 'cedy') {
        if (u.perfil === 'superadmin' || u.perfil === 'admin') return 'atende';
        if (u.perfil === 'leitor' || u.papel === 'auditor') return 'le';
        if (!temPerm(u, 'ops.com.atender')) return null;
        return conv.fila === u.papel || conv.responsavelId === u.id ? 'atende' : null;
      }
      if (conv.canal === 'interna' || u.papel === 'auditor') return null;
      if (!temPerm(u, 'ops.com.ler_pares')) return null;
      // chamado aberto pelas partes a partir desta conversa: a Cedy lê a origem (acesso já registrado)
      if (db.all('conversas').some((x) => x.promovidaDe === conv.id && x.canal === 'cedy' && K.acesso(x, u) === 'atende')) return 'le';
      return 'motivo';
    }
    const key = keyOf(u);
    if (conv.canal === 'esclarecimentos' && key === 'financiador' && !conv.orgIds.includes(u.orgId)) {
      const op = conv.ancora && db.get('operacoes', conv.ancora.id);
      return podeVerOp(op, orgOf(u)) ? (u.perfil === 'leitor' ? 'le' : 'escreve') : null;
    }
    if (!conv.orgIds.includes(u.orgId)) return null;
    if (key === 'subparceiro' && !(conv.subId && conv.subId === u.subId) && conv.criadaPor !== u.id) return null;
    if (key === 'sacado' && !['cedente_sacado', 'cedy'].includes(conv.canal)) return null;
    if (conv.tipo === 'chamado' && (K.CATEGORIAS[conv.categoria] || {}).soAdmin && u.perfil !== 'admin') return null;
    return u.perfil === 'leitor' ? 'le' : 'escreve';
  };
  K.visiveis = function (userId) { const u = U(userId); if (!u) return []; return db.all('conversas').filter((c) => K.acesso(c, u) && c.tipo !== 'comunicado'); };

  /** nome exibido: o financiador é sempre anônimo no esclarecimento (CC-02) */
  K.autorExibido = function (msg, conv, viewer) {
    const a = msg.autor;
    if (a.tipo === 'sistema') return { nome: 'Cedy', sub: 'regra automática', tom: 'sistema' };
    if (a.tipo === 'agente') return { nome: a.nome, sub: 'Agente de IA da Cedy', tom: 'ia' };
    if (conv.canal === 'esclarecimentos') {
      const cedyVe = isCedy(viewer);
      if (a.chave === 'financiador') return viewer && viewer.orgId === a.orgId ? { nome: a.nome, sub: 'Sua equipe (anônimo para os demais)', tom: 'proprio' } : cedyVe ? { nome: a.nome, sub: a.orgNome + ' · anônimo para os financiadores', tom: 'outro' } : { nome: 'Financiador anônimo', sub: 'Identidade protegida até o aceite', tom: 'anonimo' };
      if (a.chave === 'cedente' && viewer && viewer.orgId !== a.orgId && !cedyVe) return { nome: 'Cedente', sub: 'Identidade protegida até o aceite', tom: 'anonimo' };
    }
    const ao = db.get('orgs', a.orgId); if (ao && ao.kind === 'cedy') return { nome: a.nome, sub: a.papel + ' · Cedy', tom: 'cedy' };
    return { nome: a.nome, sub: (a.orgNome ? a.orgNome + ' · ' : '') + a.papel, tom: viewer && viewer.orgId === a.orgId ? 'proprio' : 'outro' };
  };

  /* ------------------------------ filtro de contato ------------------------ */
  const MASK = {
    telefone: (s) => { const d = s.replace(/\D/g, ''); return d.length > 4 ? d.slice(0, 2) + '*'.repeat(Math.max(1, d.length - 4)) + d.slice(-2) : '****'; },
    email: (s) => { const [u, d] = s.split('@'); return (u[0] || '*') + '***@' + (d || '***'); },
    url: (s) => s.replace(/^(https?:\/\/)?(www\.)?/i, '').slice(0, 4) + '***',
    handle: (s) => s.slice(0, 2) + '***',
  };
  const NUM_EXT = '(?:zero|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove)';
  const PADROES = [
    { padrao: 'email', rx: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
    { padrao: 'url', rx: /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com\.br|com|net|org|io|app|me|co)\b\S*/gi },
    { padrao: 'telefone', rx: /(?<!\d)(?:\+?\s?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)9?\d{4}[\s.-]?\d{4}(?!\d)|(?<!\d)9?\d{4}[\s.-]\d{4}(?!\d)/g },
    { padrao: 'handle', rx: /(?<![\w@])@[a-zA-Z][\w.]{2,}/g },
  ];
  const SUSPEITAS = [
    { padrao: 'ofuscado', rx: new RegExp('(?:\\b' + NUM_EXT + '\\b[\\s,.-]*){6,}', 'i') },
    { padrao: 'ofuscado', rx: /\b(zap|zapzap|whats|whatsapp|wpp|telegram|signal|insta(gram)?)\b|me (liga|chama|ligue|chame)|fora (da|do) (plataforma|app|cedy)|(meu|seu) (n[uú]mero|celular|contato)/i },
  ];
  /** Bloqueia o explícito e só sinaliza a ofuscação (CC-04). Só pessoa decide consequência. */
  K.filtro = function (texto) {
    const t = String(texto || ''); const achados = [];
    PADROES.forEach(({ padrao, rx }) => { (t.match(rx) || []).forEach((m) => { if (!achados.some((a) => a.trecho.includes(m) || m.includes(a.trecho))) achados.push({ padrao, trecho: m.trim(), mascarado: MASK[padrao](m.trim()) }); }); });
    let suspeito = null;
    if (!achados.length) for (const s of SUSPEITAS) { const m = t.match(s.rx); if (m) { suspeito = { padrao: s.padrao, trecho: m[0].trim(), mascarado: m[0].trim().slice(0, 3) + '***' }; break; } }
    return { bloquear: achados.length > 0, achados, suspeito };
  };
  const NOMES_PADRAO = { telefone: 'telefone', email: 'e-mail', url: 'endereço de internet', handle: 'usuário de rede social', ofuscado: 'contato escrito de forma disfarçada' };
  K.explicacaoFiltro = (achados) => `A mensagem não foi enviada: ela contém ${[...new Set(achados.map((a) => NOMES_PADRAO[a.padrao]))].join(' e ')}. Antes e durante a operação, as conversas ficam na plataforma, ancoradas no item e registradas. Escreva sem o contato; a Cedy foi avisada da tentativa.`;

  /** Um caso por usuário e dia (CC-38): conta tentativas, guarda trecho mascarado e sobe a prioridade na reincidência */
  K.registrarAlertaContato = function ({ conv, msgId, user, padrao, mascarado, origem, ts = now() }) {
    const dia = cal.key(ts);
    let al = db.where('alertasContato', (x) => x.userId === user.id && x.dia === dia && !['resolvido', 'dispensado'].includes(x.status))[0];
    const prio = (n) => (n >= 4 ? 'alta' : n >= 2 ? 'media' : 'normal');
    if (al) {
      const n = al.tentativas + 1;
      db.patch('alertasContato', al.id, { tentativas: n, prioridade: prio(n), trechoMascarado: mascarado, ultimaEm: ts, msgIds: [...(al.msgIds || []), msgId].filter(Boolean), padroes: [...new Set([...(al.padroes || []), padrao])] });
      if (prio(n) !== al.prioridade) notificarCompliance('Alerta de contato externo reincidente', `${user.nome} (${K.nomeOrg(user.orgId)}): ${n} tentativas hoje.`);
      return db.get('alertasContato', al.id);
    }
    al = db.put('alertasContato', { id: 'AL-' + String(db.all('alertasContato').length + 1).padStart(4, '0'), convId: conv ? conv.id : null, msgIds: msgId ? [msgId] : [], orgId: user.orgId, userId: user.id, padrao, padroes: [padrao], trechoMascarado: mascarado, origem, tentativas: 1, prioridade: 'normal', status: 'aberto', dia, criadoEm: ts, ultimaEm: ts, slaAte: E.slaAte(ts, (K.cfg().sla || DEF.sla).compliance), decididoPor: null, decisaoMotivo: null });
    ledger.append({ actor: A.motor('Filtro de contato externo'), acao: 'com.alerta_contato', entidade: { kind: 'alertaContato', id: al.id }, resumo: `Tentativa de contato externo (${NOMES_PADRAO[padrao]}) por ${user.nome}, ${K.nomeOrg(user.orgId)}`, classe: 'R1', detalhe: { origem, convId: conv ? conv.id : null } });
    notificarCompliance('Alerta de contato externo', `${user.nome} (${K.nomeOrg(user.orgId)}) tentou compartilhar ${NOMES_PADRAO[padrao]}.`);
    return al;
  };
  function notificarCompliance(titulo, corpo) {
    db.where('users', (x) => isCedy(x) && temPerm(x, 'ops.com.moderar') && x.perfil !== 'superadmin').forEach((x) => notify.send({ to: { userId: x.id }, tipo: 'alerta', titulo, corpo, link: '/ops/comunicacao?aba=alertas', classe: 'operacional' }));
  }

  /* -------------------------------- anexos -------------------------------- */
  const TIPOS_ANEXO = ['pdf', 'xml', 'png', 'jpg', 'jpeg', 'xlsx', 'xls', 'csv'];
  K.TIPOS_ANEXO = TIPOS_ANEXO; K.ANEXO_MAX = 10 * 1048576;
  /** tipos aceitos, tamanho, varredura simulada e marcação de dado pessoal (CC-18) */
  K.validarAnexo = function ({ nome, tamanho = 0, pii = false }) {
    const ext = (String(nome).split('.').pop() || '').toLowerCase();
    if (!TIPOS_ANEXO.includes(ext)) return fail(`Tipo não aceito (${ext || 'sem extensão'}). Use PDF, XML, imagem ou planilha.`, 'ANEXO_TIPO');
    if (tamanho > K.ANEXO_MAX) return fail('O arquivo passa de 10 MB.', 'ANEXO_TAMANHO');
    if (/eicar|virus|malware/i.test(nome)) return fail('A varredura de segurança recusou este arquivo.', 'ANEXO_VARREDURA');
    const temPii = !!pii || /cpf|\brg\b|cnh|passaporte|selfie|prontu/i.test(nome);
    return ok({ anexo: { nome, tipo: ext, tamanho, varredura: 'limpo', pii: temPii } });
  };

  /* --------------------------- mensagens e hash --------------------------- */
  const HASH0 = '0'.repeat(16);
  const hashMsg = (m, prev) => C.store.hash(prev + '|' + m.convId + '|' + m.seq + '|' + m.autor.id + '|' + m.ts + '|' + (m.texto || '') + '|' + JSON.stringify(m.estruturada || null) + '|' + (m.anexos || []).map((a) => a.nome).join(','));
  K.mensagens = (convId) => db.where('mensagens', (m) => m.convId === convId).sort((a, b) => a.seq - b.seq);
  K.verificar = function (convId) {
    let prev = HASH0;
    for (const m of K.mensagens(convId)) { if (m.prev !== prev || m.hash !== hashMsg(m, prev)) return { ok: false, seq: m.seq }; prev = m.hash; }
    return { ok: true };
  };
  function gravar(conv, autor, dados, ts) {
    const ms = K.mensagens(conv.id); const prev = ms.length ? ms[ms.length - 1].hash : HASH0; const seq = ms.length + 1;
    const m = Object.assign({ id: `${conv.id}-${String(seq).padStart(3, '0')}`, convId: conv.id, seq, autor, texto: '', estruturada: null, anexos: [], ts, ia: null, bloqueada: null, redigida: null, acao: null }, dados);
    m.prev = prev; m.hash = hashMsg(m, prev); db.put('mensagens', m); return m;
  }
  /** nova mensagem de sistema (sem autor humano), usada por regras e ações */
  K.msgSistema = function (convId, texto, { acao = null, ts } = {}) {
    const conv = db.get('conversas', convId); if (!conv) return null;
    const m = gravar(conv, SISTEMA, { texto, acao }, ts || now());
    db.patch('conversas', convId, { ultimaMsgEm: m.ts, previa: texto.slice(0, 120), ultimoAutor: 'Cedy' }); return m;
  };
  /** resposta do agente de atendimento (R0, informativa): não conta como primeira resposta humana nem mexe no SLA (CC-15, CC-30) */
  K.msgAgente = function (convId, texto, ia = {}) {
    const conv = db.get('conversas', convId); if (!conv) return null;
    const autor = { tipo: 'agente', id: 'ag-atendimento', nome: 'Assistente Cedy', orgNome: 'Agente de IA da Cedy', papel: 'Agente de IA' };
    const m = gravar(conv, autor, { texto, ia: Object.assign({ agente: 'ag-atendimento' }, ia) }, now());
    db.patch('conversas', convId, { ultimaMsgEm: m.ts, previa: texto.slice(0, 120), ultimoAutor: 'Assistente Cedy', naoLidaPor: incrementaNaoLida(db.get('conversas', convId), 'ag-atendimento') }); return m;
  };

  /* ------------------------------- limites -------------------------------- */
  K.limites = function (user, comAnexo) {
    const l = K.cfg().limites || DEF.limites; const t = now();
    const doUsuario = db.where('mensagens', (m) => m.autor.id === user.id && m.ts > t - 3600e3).length;
    if (doUsuario >= l.usuarioMsgHora) return fail(`Limite de ${l.usuarioMsgHora} mensagens por hora atingido. Tente novamente mais tarde ou abra um chamado.`, 'LIMITE_USUARIO');
    const daEmpresa = db.where('mensagens', (m) => m.autor.orgId === user.orgId && m.autor.tipo === 'pessoa' && m.ts > t - 3600e3).length;
    if (!isCedy(user) && daEmpresa >= l.empresaMsgHora) return fail(`A empresa atingiu o limite de ${l.empresaMsgHora} mensagens por hora.`, 'LIMITE_EMPRESA');
    if (comAnexo) { const n = db.where('mensagens', (m) => m.autor.id === user.id && m.anexos && m.anexos.length && m.ts > t - 86400e3).length; if (n >= l.usuarioAnexosDia) return fail(`Limite de ${l.usuarioAnexosDia} mensagens com anexo por dia atingido.`, 'LIMITE_ANEXO'); }
    return ok();
  };

  /* ------------------------------ prioridade ------------------------------- */
  const fimDoDia = () => { const p = cal.sp(now()); return cal.spTs(p.y, p.m, p.d, 23, 59, 59); };
  const adminsAtivos = (orgId) => db.where('users', (x) => x.orgId === orgId && x.perfil === 'admin' && x.status !== 'revogacao_agendada').length;
  /** Crítica só por regra objetiva (CC-12); devolve o motivo para mostrar ao cliente */
  K.criticoPorRegra = function (orgId, categoria, sinais = {}) {
    const hoje = fimDoDia();
    // as regras de dinheiro e prazo só valem para assuntos ligados a elas (operações e conciliação)
    const financeiro = ['operacoes', 'conciliacao'].includes(categoria);
    const ops = financeiro ? db.where('operacoes', (o) => o.cedenteId === orgId || o.financiadorId === orgId) : [];
    const pend = ops.find((o) => o.cedenteId === orgId && o.status === 'aguardando_pagamento' && o.pagamentoLimite && o.pagamentoLimite <= hoje);
    if (pend) return { critico: true, motivo: `Pagamento ao cedente pendente hoje (${pend.id}).` };
    const rec = ops.find((o) => o.recompra && o.recompra.status === 'devida' && o.recompra.ate && o.recompra.ate <= hoje);
    if (rec) return { critico: true, motivo: `Recompra de ${rec.id} vence hoje.` };
    const ven = ops.find((o) => ['paga', 'parcial'].includes(o.status) && o.tituloIds.some((id) => { const t = db.get('titulos', id); return t && !['liquidado', 'recomprado'].includes(t.status) && t.vencimento >= cal.startOfDay(now()) && t.vencimento <= hoje; }));
    if (ven) return { critico: true, motivo: `Título de ${ven.id} vence hoje.` };
    if (categoria === 'acesso' && sinais.semAcesso && adminsAtivos(orgId) <= 1) return { critico: true, motivo: 'A empresa tem um único administrador e ele está sem acesso.' };
    if (categoria === 'plataforma' && db.all('incidentes').some((i) => i.severidade === 'S1' && i.status !== 'resolvido')) return { critico: true, motivo: 'Há um incidente crítico (S1) aberto na plataforma.' };
    return { critico: false };
  };
  K.prioridade = function (orgId, categoria, sinais = {}) {
    const r = K.criticoPorRegra(orgId, categoria, sinais);
    if (r.critico) return { prioridade: 'critica', motivo: r.motivo };
    return { prioridade: categoria === 'outros' ? 'baixa' : 'normal', motivo: null };
  };

  /* --------------------------- abrir e promover --------------------------- */
  const proxId = () => 'CV-' + String(db.all('conversas').length + 1).padStart(4, '0');
  const protocolo = () => { const ano = cal.sp(now()).y; const n = db.all('conversas').filter((c) => c.protocolo).length + 1; return `CH-${ano}-${String(n).padStart(4, '0')}`; };

  function destinatarios(conv, autorId) {
    return db.all('users').filter((x) => {
      if (x.id === autorId) return false; const a = K.acesso(conv, x);
      if (isCedy(x)) return a === 'atende' && temPerm(x, 'ops.com.atender') && (x.papel === conv.fila || x.id === conv.responsavelId);
      return a === 'escreve' || a === 'le';
    }).map((x) => x.id);
  }
  function incrementaNaoLida(conv, autorId) {
    const n = Object.assign({}, conv.naoLidaPor || {}); destinatarios(conv, autorId).forEach((id) => { n[id] = (n[id] || 0) + 1; }); return n;
  }
  /** avisa na tela quem está logado agora (o tempo real é simulado) */
  function avisar(ids, titulo, texto, link) {
    const me = session.get(); if (me && ids.includes(me.userId) && C.ui && C.ui.toast) C.ui.toast(titulo, { type: 'info', text: texto, link });
  }
  const BLOQ_TIPOS = ['esclarecimentos', 'pos_aceite', 'cedente_sacado', 'orig_indicado', 'orig_sub'];
  const OP_ACEITA = ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial', 'liquidada', 'recomprada'];
  /** confere a matriz (CC-01 a CC-03), os bloqueios e o vínculo real entre as partes; devolve as empresas donas da conversa */
  function validarPar(u, canal, ancora, contraOrgId, subId) {
    const key = keyOf(u); const op = ancora && ancora.kind === 'operacao' ? db.get('operacoes', ancora.id) : null; const tit = ancora && ancora.kind === 'titulo' ? db.get('titulos', ancora.id) : null;
    const outra = contraOrgId && db.get('orgs', contraOrgId);
    if (canal === 'orig_sub') {
      if (key !== 'originador' && key !== 'subparceiro') return fail('Só o originador e os seus subparceiros usam este canal.', 'MATRIZ');
      return { orgIds: [u.orgId], subId: key === 'subparceiro' ? u.subId : subId, ctx: {} };
    }
    if (!outra) return fail('Escolha a empresa do outro lado.');
    if (K.bloqueado(u.orgId, contraOrgId)) return fail('Há um bloqueio entre as duas empresas: não é possível abrir nova conversa.', 'BLOQUEADO');
    const ctx = {};
    if (canal === 'esclarecimentos') {
      if (!op || op.cedenteId !== contraOrgId) return fail('Esclarecimentos ficam presos a uma operação em leilão.', 'MATRIZ');
      if (key !== 'financiador' || !podeVerOp(op, orgOf(u)) || op.financiadorId) return fail('Só financiadores com acesso à operação ainda em leilão fazem perguntas.', 'MATRIZ');
      return { orgIds: [op.cedenteId], ctx };
    }
    if (canal === 'pos_aceite') {
      if (!op || !OP_ACEITA.includes(op.status) || ![op.cedenteId, op.financiadorId].includes(u.orgId) || ![op.cedenteId, op.financiadorId].includes(contraOrgId)) return fail('Depois do aceite, a conversa fica presa à operação entre cedente e financiador vencedor.', 'MATRIZ');
      return { orgIds: [op.cedenteId, op.financiadorId], ctx: { aceita: true } };
    }
    if (canal === 'cedente_sacado') {
      const prod = db.get('produtos', (tit && tit.produto) || (op && op.produto)); const t0 = tit || (op && db.get('titulos', op.tituloIds[0]));
      const sacId = t0 && t0.sacadoId; const cedId = tit ? tit.orgId : op && op.cedenteId;
      if (!sacId || !cedId || ![sacId, cedId].includes(u.orgId) || contraOrgId !== (u.orgId === cedId ? sacId : cedId)) return fail('A conversa com o sacado fica presa a um título ou operação entre o cedente e o sacado dele.', 'MATRIZ');
      const mz = K.matriz('cedente', 'sacado', { silencioso: !!(prod && prod.silencioso) });
      if (mz.modo === 'nenhum') return fail(mz.motivo, 'MATRIZ');
      return { orgIds: [cedId, sacId], ctx: { silencioso: false } };
    }
    if (canal === 'orig_indicado') {
      const souOrig = key === 'originador' || key === 'subparceiro'; const orig = souOrig ? u.orgId : contraOrgId; const ced = souOrig ? contraOrgId : u.orgId; const co = db.get('orgs', ced);
      if (!co || co.kind !== 'cedente' || co.indicadoPor !== orig) return fail('Só o originador e as empresas que ele indicou usam este canal.', 'MATRIZ');
      return { orgIds: [orig, ced], subId: co.subparceiroId || null, ctx: {} };
    }
    return fail('Canal desconhecido.');
  }
  /** canais disponíveis ao usuário num item (botão "Conversar"): sempre a Cedy; entre clientes só o que a matriz permite */
  K.canaisPara = function (userId, ancora) {
    const u = U(userId); if (!u || !ancora) return []; const key = keyOf(u); const out = [];
    const achar = (canal, contra) => db.all('conversas').find((c) => c.canal === canal && c.ancora && c.ancora.id === ancora.id && c.ancora.kind === ancora.kind && c.orgIds.includes(u.orgId) && (!contra || c.orgIds.includes(contra)));
    const cedy = achar('cedy'); out.push({ canal: 'cedy', rotulo: 'Falar com a Cedy', desc: 'A Mesa responde nesta conversa.', modo: 'ancorada', ok: true, existente: cedy ? cedy.id : null });
    if (isCedy(u) || u.perfil === 'leitor') return out;
    const op = ancora.kind === 'operacao' ? db.get('operacoes', ancora.id) : null; const tit = ancora.kind === 'titulo' ? db.get('titulos', ancora.id) : null;
    if (op && key === 'financiador' && op.status === 'aberta' && podeVerOp(op, orgOf(u))) { const ex = db.all('conversas').find((c) => c.canal === 'esclarecimentos' && c.ancora && c.ancora.id === op.id); out.push({ canal: 'esclarecimentos', contraOrgId: op.cedenteId, rotulo: 'Perguntar ao cedente', desc: 'Pergunta de modelo fechado. A resposta é pública para os financiadores da operação e você fica anônimo.', modo: 'estruturada', ok: !K.bloqueado(u.orgId, op.cedenteId), motivo: K.bloqueado(u.orgId, op.cedenteId) ? 'Há um bloqueio entre as empresas.' : null, existente: ex ? ex.id : null }); }
    if (op && OP_ACEITA.includes(op.status) && [op.cedenteId, op.financiadorId].includes(u.orgId)) { const contra = u.orgId === op.cedenteId ? op.financiadorId : op.cedenteId; out.push({ canal: 'pos_aceite', contraOrgId: contra, rotulo: 'Conversar com ' + (u.orgId === op.cedenteId ? 'o financiador' : 'o cedente'), desc: 'Texto ancorado nesta operação. Não vale passar telefone, e-mail ou link: a Cedy registra e pode ler.', modo: 'ancorada', ok: !K.bloqueado(u.orgId, contra), motivo: K.bloqueado(u.orgId, contra) ? 'Há um bloqueio entre as empresas.' : null, existente: (achar('pos_aceite', contra) || {}).id || null }); }
    if ((op || tit) && (key === 'cedente' || key === 'sacado')) {
      const t0 = tit || (op && db.get('titulos', op.tituloIds[0])); const prod = db.get('produtos', (tit && tit.produto) || (op && op.produto));
      if (t0 && ((key === 'cedente' && t0.orgId === u.orgId) || (key === 'sacado' && t0.sacadoId === u.orgId))) {
        const mz = K.matriz('cedente', 'sacado', { silencioso: !!(prod && prod.silencioso) }); const contra = key === 'cedente' ? t0.sacadoId : t0.orgId;
        out.push({ canal: 'cedente_sacado', contraOrgId: contra, rotulo: key === 'cedente' ? 'Falar com o sacado' : 'Falar com o fornecedor', desc: 'Mensagem de modelo fechado sobre este título.', modo: 'estruturada', ok: mz.modo !== 'nenhum', motivo: mz.motivo || null, existente: (achar('cedente_sacado', contra) || {}).id || null });
      }
    }
    if ((key === 'originador' || key === 'subparceiro') && ancora.kind === 'competencia') {
      const pm = db.get('premiacoes', ancora.id); const subId = key === 'subparceiro' ? u.subId : pm && pm.subId;
      const ex = db.all('conversas').find((c) => c.canal === 'orig_sub' && c.ancora && c.ancora.id === ancora.id && c.subId === subId);
      out.push({ canal: 'orig_sub', subId, rotulo: key === 'subparceiro' ? 'Falar com o originador' : 'Falar com o subparceiro', desc: 'Conversa ancorada nesta competência. Sem telefone, e-mail ou link: a Cedy registra e pode ler.', modo: 'ancorada', ok: !!subId, motivo: subId ? null : 'Esta competência não tem subparceiro.', existente: ex ? ex.id : null });
    }
    if (key === 'originador' && ancora.kind === 'cadastro') {
      const co = db.get('orgs', ancora.id);
      if (co && co.kind === 'cedente' && co.indicadoPor === u.orgId) { const ex = db.all('conversas').find((c) => c.canal === 'orig_indicado' && c.ancora && c.ancora.id === ancora.id && c.orgIds.includes(u.orgId)); out.push({ canal: 'orig_indicado', contraOrgId: co.id, rotulo: 'Falar com o indicado', desc: 'Mensagem de modelo fechado: lembrete de cadastro, pendência de documento e convite.', modo: 'estruturada', ok: !K.bloqueado(u.orgId, co.id), motivo: null, existente: ex ? ex.id : null }); }
    }
    if (K.cfg().blocos && K.cfg().blocos.pares === false) out.forEach((c) => { if (c.canal !== 'cedy') { c.ok = false; c.motivo = 'O canal entre empresas está pausado pela Cedy.'; } });
    return out;
  };
  /**
   * Abre (ou reaproveita) uma conversa. canal 'cedy' sem âncora é chamado.
   * contraOrgId: empresa do outro lado nos canais entre clientes.
   */
  K.abrirConversa = function ({ userId, canal = 'cedy', tipo, ancora = null, titulo, categoria, texto = '', estruturada = null, anexos = [], urgente = false, sinais = {}, contraOrgId = null, subId = null, _ts = null }) {
    const u = U(userId); if (!u) return fail('Usuário não encontrado.');
    const ts = _ts || now(); const cliente = !isCedy(u);
    if (cliente && u.perfil === 'leitor') return fail('O perfil leitor só lê: peça a um administrador ou operador para abrir a conversa.', 'LEITOR');
    if (BLOQ_TIPOS.includes(canal) && K.cfg().blocos && K.cfg().blocos.pares === false) return fail('O canal entre empresas está pausado pela Cedy.', 'BLOCO_PAUSADO');
    tipo = tipo || (ancora ? 'item' : 'chamado');
    let orgIds = cliente ? [u.orgId] : [];
    if (canal === 'cedy') {
      if (!cliente) { const info = K.ancoraInfo(ancora, u); orgIds = (info && info.cedenteId ? [info.cedenteId] : info && info.orgs || []).slice(0, 1); if (contraOrgId) orgIds = [contraOrgId]; if (!orgIds.length) return fail('Escolha a empresa da conversa.'); }
    } else if (canal === 'interna') { orgIds = [u.orgId]; }
    else {
      const v = validarPar(u, canal, ancora, contraOrgId, subId); if (!v.ok && v.ok === false) return v;
      orgIds = v.orgIds; subId = v.subId || subId;
    }
    if (tipo === 'item' && ancora) {
      const ex = db.all('conversas').find((c) => c.tipo === 'item' && c.canal === canal && c.ancora && c.ancora.kind === ancora.kind && c.ancora.id === ancora.id && orgIds.every((o) => c.orgIds.includes(o)) && (canal !== 'orig_sub' || c.subId === subId));
      if (ex) return ok({ conv: ex, existente: true });
    }
    let cat = categoria, fila = null, prio = null, pm = null;
    if (tipo === 'chamado') {
      cat = cat || 'outros'; const ci = K.CATEGORIAS[cat]; if (!ci) return fail('Categoria inválida.');
      if (cliente && ci.soAdmin && u.perfil !== 'admin') return fail('Só administradores abrem chamados de cadastro e de acesso e segurança.', 'SO_ADMIN');
      fila = ci.fila; const orgId = orgIds[0];
      pm = K.prioridade(orgId, cat, sinais); prio = pm.prioridade;
    } else fila = FILA_POR_ANCORA[ancora && ancora.kind] || 'suporte';
    if (texto) { const f = K.filtro(texto); if (f.bloquear) { K.registrarAlertaContato({ conv: null, msgId: null, user: u, padrao: f.achados[0].padrao, mascarado: f.achados[0].mascarado, origem: 'filtro' }); return fail(K.explicacaoFiltro(f.achados), 'CONTATO_EXTERNO'); } }
    const info = ancora ? K.ancoraInfo(ancora, u) : null;
    const conv = db.put('conversas', { id: proxId(), tipo, canal, orgIds, subId: subId || null, ancora, titulo: titulo || (info ? info.label : (K.CATEGORIAS[cat] || {}).label || 'Conversa'), status: tipo === 'chamado' ? 'aberto' : 'ativa', criadaPor: u.id, criadaEm: ts, ultimaMsgEm: ts, naoLidaPor: {}, aguarda: null, previa: '', fila: canal === 'cedy' ? fila : null,
      protocolo: tipo === 'chamado' ? protocolo() : null, categoria: tipo === 'chamado' ? cat : null, prioridade: prio, prioridadeMotivo: pm ? pm.motivo : null, urgentePedido: !!urgente && prio !== 'critica', slaAte: tipo === 'chamado' ? K.slaDe(prio, ts) : null, slaInicio: tipo === 'chamado' ? ts : null, slaPausado: null, primeiraRespostaEm: null, responsavelId: null, promovidaDe: null, historico: [] });
    ledger.append({ ts, actor: A.user(u.id), acao: tipo === 'chamado' ? 'chamado.aberto' : 'conversa.aberta', entidade: { kind: 'conversa', id: conv.id }, resumo: tipo === 'chamado' ? `Chamado ${conv.protocolo} aberto: ${conv.titulo}` : `Conversa aberta em ${conv.titulo} (${canal})`, classe: 'R1' });
    if (tipo === 'chamado') avisoFila(conv, ts);
    if (texto || estruturada || anexos.length) {
      const r = K.enviar({ convId: conv.id, userId, texto, estruturada, anexos, _ts: ts, _inicial: true });
      if (!r.ok && r.codigo !== 'CONTATO_EXTERNO') { db.del('conversas', conv.id); return r; }
    }
    return ok({ conv: db.get('conversas', conv.id) });
  };
  /** chamado novo: avisa a fila e, fora do expediente ou se crítico, o líder e o plantão simulado (CC-36) */
  function avisoFila(conv, ts) {
    const exp = K.expediente(ts); const crit = conv.prioridade === 'critica';
    const fila = db.where('users', (x) => isCedy(x) && x.perfil !== 'superadmin' && (x.papel === conv.fila));
    avisar(fila.map((x) => x.id), `Novo chamado ${conv.protocolo}`, conv.titulo, '/ops/chamados/' + conv.id);
    if (crit) {
      const lideres = db.where('users', (x) => isCedy(x) && x.perfil === 'admin');
      lideres.forEach((x) => notify.send({ ts, to: { userId: x.id }, tipo: 'erro', titulo: `Chamado crítico ${conv.protocolo}`, corpo: `${K.nomeOrg(conv.orgIds[0])}: ${conv.prioridadeMotivo || conv.titulo}`, link: '/ops/chamados/' + conv.id, classe: 'obrigatoria' }));
      if (!exp.aberto) { const plantao = U('u-super-1'); if (plantao) notify.send({ ts, to: { userId: plantao.id }, tipo: 'erro', titulo: `Plantão: chamado crítico ${conv.protocolo}`, corpo: 'Aberto fora do expediente. Plantão simulado: o protótipo não promete prazo de resposta.', link: '/ops/chamados/' + conv.id, classe: 'obrigatoria' }); }
    }
  }
  /**
   * Qualquer conversa vira chamado (CC-06). Na conversa com a Cedy a promoção é no próprio fio; numa conversa entre
   * empresas nasce um chamado novo ligado a ela, e a Cedy lê a origem com acesso registrado.
   */
  K.promoverAChamado = function (convId, { userId, categoria = 'outros', motivo = '', sinais = {} }) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Conversa não encontrada.');
    if (conv.tipo === 'chamado') return fail('Esta conversa já é um chamado.');
    const ac = K.acesso(conv, u); if (ac !== 'escreve' && ac !== 'atende') return fail('Só quem participa da conversa pode promovê-la.');
    const ci = K.CATEGORIAS[categoria]; if (!ci) return fail('Categoria inválida.');
    if (!isCedy(u) && ci.soAdmin && u.perfil !== 'admin') return fail('Só administradores abrem chamados de cadastro e de acesso e segurança.', 'SO_ADMIN');
    const orgId = conv.orgIds[0]; const pm = K.prioridade(orgId, categoria, sinais); const ts = now();
    if (conv.canal !== 'cedy') {
      const r = K.abrirConversa({ userId, canal: 'cedy', tipo: 'chamado', categoria, ancora: conv.ancora, titulo: 'Sobre: ' + conv.titulo, texto: motivo || `Peço ajuda da Cedy na conversa ${conv.id} (${conv.titulo}).`, sinais, _ts: ts });
      if (!r.ok) return r;
      db.patch('conversas', r.conv.id, { promovidaDe: conv.id });
      registrarAcessoInterno(r.conv, `Chamado aberto pelas partes a partir da conversa ${conv.id}`, conv.id);
      K.msgSistema(r.conv.id, `Chamado aberto a partir da conversa ${conv.id}. A Cedy passa a ler a conversa de origem, com acesso registrado.`);
      return ok({ conv: db.get('conversas', r.conv.id), origem: conv.id });
    }
    db.patch('conversas', convId, { tipo: 'chamado', promovidaTipo: conv.tipo, protocolo: protocolo(), categoria, fila: ci.fila, prioridade: pm.prioridade, prioridadeMotivo: pm.motivo, status: 'aberto', slaAte: K.slaDe(pm.prioridade, ts), slaInicio: ts, slaPausado: null, primeiraRespostaEm: null });
    const c2 = db.get('conversas', convId);
    ledger.append({ actor: A.user(u.id), acao: 'chamado.promovido', entidade: { kind: 'conversa', id: convId }, resumo: `Conversa promovida a chamado ${c2.protocolo} por ${u.nome}${motivo ? ': ' + motivo : ''}`, classe: 'R1' });
    K.msgSistema(convId, `Conversa promovida a chamado ${c2.protocolo}. O histórico foi preservado.${pm.motivo ? ' Prioridade crítica: ' + pm.motivo : ''}`);
    avisoFila(c2, ts);
    return ok({ conv: db.get('conversas', convId) });
  };
  function registrarAcessoInterno(conv, motivo, origemId) { db.put('acessosCom', { id: C.uid('ac'), convId: origemId || conv.id, userId: 'sistema', papel: 'Sistema', motivo, ts: now() }); }

  /* -------------------------------- enviar -------------------------------- */
  K.podeEscrever = function (conv, u) {
    if (!conv || !u) return { ok: false, motivo: 'Conversa não encontrada.' };
    if (conv.status === 'encerrado') return { ok: false, motivo: 'Este chamado foi encerrado. Abra um novo se precisar.' };
    const a = K.acesso(conv, u);
    if (a === 'le') return { ok: false, motivo: isCedy(u) ? 'Seu papel só lê esta conversa.' : 'O perfil leitor só lê. Peça a um administrador ou operador para responder.', codigo: 'LEITOR' };
    if (a === 'motivo') return { ok: false, motivo: 'A Cedy só lê conversas entre clientes, não escreve nelas.', codigo: 'SO_LEITURA_CEDY' };
    if (a !== 'escreve' && a !== 'atende') return { ok: false, motivo: 'Você não participa desta conversa.' };
    return { ok: true, lado: a === 'atende' ? 'cedy' : 'cliente' };
  };
  /** payload: {convId, userId, texto, estruturada:{modelo,campo,valor}, anexos:[{nome,tamanho,pii}], status?, _ts, _inicial} */
  K.enviar = function ({ convId, userId, texto = '', estruturada = null, anexos = [], status = null, _ts = null, _inicial = false }) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Conversa não encontrada.');
    const ts = _ts || now(); const pode = K.podeEscrever(conv, u); if (!pode.ok) return fail(pode.motivo, pode.codigo || 'SEM_PERMISSAO');
    const entreClientes = BLOQ_TIPOS.includes(conv.canal);
    const cfgc = K.cfg();
    if (entreClientes && cfgc.blocos && cfgc.blocos.pares === false) return fail('O canal entre empresas está pausado pela Cedy.', 'BLOCO_PAUSADO');
    const modo = pode.lado !== 'cedy' && entreClientes && conv.canal !== 'pos_aceite' && conv.canal !== 'orig_sub' ? 'estruturada' : 'ancorada';
    texto = String(texto || '').trim();
    if (modo === 'estruturada') {
      if (texto) return fail('Neste canal só há mensagens de modelo: escolha uma opção da lista. Texto livre só é permitido depois do aceite.', 'SO_ESTRUTURADA');
      const e = estruturada; const lista = K.modelosDe(conv.canal); const modelo = e && (lista.find((m) => m.id === e.modelo) || K.MODELOS.respostas.find((m) => m.id === e.modelo));
      if (!modelo) return fail('Escolha um modelo de mensagem.', 'MODELO');
      if (modelo.campo && (!e.valor || !modelo.campo.opcoes.includes(e.valor))) return fail('Escolha uma opção para completar a mensagem.', 'MODELO');
      texto = modelo.campo ? `${modelo.label}: ${e.valor}.` : modelo.label + '.';
      estruturada = { modelo: modelo.id, campo: modelo.campo ? modelo.campo.id : null, valor: modelo.campo ? e.valor : null };
    } else if (!texto && !anexos.length && !estruturada) return fail('Escreva a mensagem.', 'VAZIA');
    if (texto.length > 2000) return fail('A mensagem passa de 2.000 caracteres.', 'TAMANHO');
    if (anexos.length && cfgc.blocos && cfgc.blocos.anexos === false) return fail('O envio de anexos está pausado pela Cedy.', 'BLOCO_PAUSADO');
    const anexosOk = [];
    for (const a of anexos) { const v = K.validarAnexo(a); if (!v.ok) return v; anexosOk.push(v.anexo); }
    if (!_ts) { const lim = K.limites(u, anexosOk.length > 0); if (!lim.ok) return lim; }
    const autor = autorDe(u); let bloqueada = null; let suspeito = null;
    if (modo !== 'estruturada' && texto && conv.canal !== 'interna') { const f = K.filtro(texto); if (f.bloquear) bloqueada = { padrao: f.achados[0].padrao, mascarado: f.achados[0].mascarado, achados: f.achados.map((x) => ({ padrao: x.padrao, mascarado: x.mascarado })) }; else if (f.suspeito && !(E.ia.com && E.ia.com.degradado().sim)) suspeito = f.suspeito; }
    const m = gravar(conv, autor, { texto, estruturada, anexos: anexosOk, bloqueada, ia: suspeito ? { suspeitaContato: suspeito.padrao } : null }, ts);
    if (bloqueada) {
      K.registrarAlertaContato({ conv, msgId: m.id, user: u, padrao: bloqueada.padrao, mascarado: bloqueada.mascarado, origem: 'filtro', ts });
      db.patch('conversas', convId, { ultimaMsgEm: conv.ultimaMsgEm });
      return Object.assign(fail(K.explicacaoFiltro(bloqueada.achados), 'CONTATO_EXTERNO'), { msg: m });
    }
    if (suspeito) K.registrarAlertaContato({ conv, msgId: m.id, user: u, padrao: 'ofuscado', mascarado: suspeito.mascarado, origem: 'agente', ts });
    const lado = pode.lado; const patch = { ultimaMsgEm: ts, previa: (texto || (anexosOk[0] ? 'Anexo: ' + anexosOk[0].nome : '')).slice(0, 120), ultimoAutor: conv.canal === 'esclarecimentos' ? (autor.chave === 'financiador' ? 'Financiador anônimo' : 'Cedente') : u.nome, naoLidaPor: incrementaNaoLida(conv, u.id) };
    const nl = Object.assign({}, patch.naoLidaPor); delete nl[u.id]; patch.naoLidaPor = nl;
    if (conv.tipo === 'chamado') Object.assign(patch, slaNaMensagem(conv, lado, status, ts));
    const pergunta = /\?/.test(texto) || (!!estruturada && K.modelosDe(conv.canal).some((x) => x.id === estruturada.modelo));
    if (conv.canal === 'cedy' && conv.tipo === 'chamado') patch.aguarda = lado === 'cedy' ? ((status || conv.status) === 'aguardando_cliente' ? 'cliente' : null) : null;
    else if (pergunta) { patch.aguarda = 'contraparte'; patch.aguardaDe = u.orgId; }
    else if (conv.aguarda === 'contraparte' && conv.aguardaDe !== u.orgId) { patch.aguarda = null; patch.aguardaDe = null; }
    db.patch('conversas', convId, patch);
    if (lado === 'cliente' && conv.canal === 'cedy') K.respostaAutomatica(db.get('conversas', convId), u, m);
    if (!_inicial) avisar(destinatarios(db.get('conversas', convId), u.id), conv.tipo === 'chamado' ? `${conv.protocolo}: nova mensagem` : `Nova mensagem em ${conv.titulo}`, `${u.nome}: ${patch.previa}`, K.rotaConversa(conv, destinatarios(conv, u.id)[0]));
    return ok({ msg: m, conv: db.get('conversas', convId), alerta: suspeito ? true : false });
  };
  /** regras de SLA a cada mensagem (CC-11): a Mesa responde = fecha o prazo; resposta do cliente = novo prazo */
  function slaNaMensagem(conv, lado, status, ts) {
    const p = {};
    if (lado === 'cedy') {
      if (!conv.primeiraRespostaEm) p.primeiraRespostaEm = ts;
      p.slaAte = null; p.slaPausado = null; p.status = status || (['aguardando_cliente', 'resolvido', 'encerrado'].includes(conv.status) ? conv.status : 'em_atendimento');
      if (status === 'aguardando_cliente') p.aguarda = 'cliente';
    } else {
      const retoma = conv.slaPausado ? conv.slaPausado.restanteMin / 60 : null;
      if (['aguardando_cliente', 'resolvido'].includes(conv.status) || !conv.slaAte) { p.status = conv.status === 'resolvido' ? 'aberto' : 'em_atendimento'; p.slaAte = retoma !== null ? E.slaAte(ts, retoma) : K.slaDe(conv.prioridade, ts); p.slaPausado = null; if (conv.status === 'resolvido') p.slaInicio = ts; }
    }
    return p;
  }
  /** pedido fora da lista nunca é atendido por mensagem: responde com o fluxo formal (CC-07, CC-08) */
  K.respostaAutomatica = function (conv, u, msg) {
    const hit = K.FORA_DA_LISTA.find((f) => f.rx.test(msg.texto || ''));
    if (!hit) return null; const b = K.base(u);
    K.msgSistema(conv.id, `Este pedido não pode ser feito por mensagem: ${hit.titulo.toLowerCase()}. Por segurança, ele só é feito dentro do app, com a sua autenticação e o 2FA quando exigido. Nada foi alterado.`, { acao: { codigo: 'FLUXO_FORMAL', titulo: hit.titulo, rota: hit.rota(b) } });
    db.put('acoesChamado', { id: 'AC-' + String(db.all('acoesChamado').length + 1).padStart(4, '0'), convId: conv.id, msgId: msg.id, msgHash: msg.hash, acao: hit.id, pedidaPor: u.id, executadaPor: null, alvo: null, antes: null, depois: null, ts: now(), status: 'recusada', codigo: 'FLUXO_FORMAL', revertidaEm: null });
    ledger.append({ actor: A.motor('Regra de pedido por mensagem'), acao: 'chamado.pedido_recusado', entidade: { kind: 'conversa', id: conv.id }, resumo: `Pedido fora da lista recusado no chamado ${conv.protocolo || conv.id}: ${hit.titulo} (fluxo formal indicado)`, classe: 'R1', detalhe: { msgHash: msg.hash } });
    return hit;
  };
  K.rotaConversa = function (conv, userId) {
    const u = U(userId) || session.user(); if (!conv || !u) return null;
    if (isCedy(u)) return conv.tipo === 'chamado' ? '/ops/chamados/' + conv.id : '/ops/mensagens/' + conv.id;
    return K.base(u) + '/mensagens/' + conv.id;
  };

  /* ------------------------------ leitura --------------------------------- */
  K.lida = function (convId, userId) {
    const conv = db.get('conversas', convId); if (!conv || !(conv.naoLidaPor || {})[userId]) return;
    const n = Object.assign({}, conv.naoLidaPor); delete n[userId]; db.patch('conversas', convId, { naoLidaPor: n });
  };
  /** quem precisa agir agora (CC-31, CC-33): chamado aguardando o cliente, pergunta dirigida à sua empresa */
  K.precisaDeVoce = function (conv, u) {
    if (!conv || !u || conv.status === 'encerrado') return false;
    const ac = K.acesso(conv, u); if (!ac || ac === 'le' || ac === 'motivo') return false;
    if (isCedy(u)) return conv.tipo === 'chamado' && ['aberto', 'em_atendimento'].includes(conv.status) && (conv.responsavelId ? conv.responsavelId === u.id : conv.fila === u.papel);
    if (conv.tipo === 'chamado' && conv.status === 'aguardando_cliente') return true;
    if (conv.aguarda === 'contraparte') return !!conv.aguardaDe && conv.aguardaDe !== u.orgId;
    return false;
  };

  /* ------------------------ atendimento (lado Cedy) ----------------------- */
  const logConv = (u, acao, conv, resumo, classe = 'R1', detalhe) => ledger.append({ actor: A.user(u.id), acao, entidade: { kind: 'conversa', id: conv.id }, resumo, classe, detalhe });
  const exigeAtende = (conv, u) => (K.acesso(conv, u) === 'atende' ? null : fail('Você não atende este chamado.', 'SEM_PERMISSAO'));
  K.alterarStatus = function (convId, status, userId) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Chamado não encontrado.');
    const e = exigeAtende(conv, u); if (e) return e; if (conv.tipo !== 'chamado') return fail('Só chamados têm status.');
    if (!K.STATUS_CHAMADO[status]) return fail('Status inválido.'); const ts = now(); const p = { status };
    if (status === 'aguardando_cliente' && conv.slaAte) { p.slaPausado = { em: ts, restanteMin: Math.max(1, minutosUteis(ts, conv.slaAte)) }; p.slaAte = null; p.aguarda = 'cliente'; }
    if (status === 'em_atendimento' && !conv.slaAte && !conv.primeiraRespostaEm) p.slaAte = conv.slaPausado ? E.slaAte(ts, conv.slaPausado.restanteMin / 60) : K.slaDe(conv.prioridade, ts);
    if (status === 'resolvido' || status === 'encerrado') { p.slaAte = null; p.aguarda = null; }
    db.patch('conversas', convId, Object.assign(p, { historico: [...(conv.historico || []), { ts, userId: u.id, acao: 'status', de: conv.status, para: status }] }));
    logConv(u, 'chamado.status', conv, `Chamado ${conv.protocolo}: ${K.STATUS_CHAMADO[conv.status]} → ${K.STATUS_CHAMADO[status]} por ${u.nome}`);
    K.msgSistema(convId, `Status alterado para "${K.STATUS_CHAMADO[status]}" por ${u.nome}.`);
    return ok({ conv: db.get('conversas', convId) });
  };
  K.assumir = function (convId, userId) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Chamado não encontrado.');
    const e = exigeAtende(conv, u); if (e) return e; const ts = now();
    db.patch('conversas', convId, { responsavelId: u.id, status: conv.status === 'aberto' ? 'em_atendimento' : conv.status, historico: [...(conv.historico || []), { ts, userId: u.id, acao: 'assumiu', para: u.id }] });
    logConv(u, 'chamado.assumido', conv, `${u.nome} assumiu o chamado ${conv.protocolo}`);
    return ok({ conv: db.get('conversas', convId) });
  };
  /** líder reatribui; passagem entre filas ou pessoas exige nota de contexto (CC-22) */
  K.atribuir = function (convId, { fila, responsavelId, nota }, userId) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Chamado não encontrado.');
    if (!ehLider(u) && conv.responsavelId !== u.id) return fail('Só o líder da Mesa ou o responsável atual reatribui o chamado.', 'SEM_PERMISSAO');
    if (!nota || String(nota).trim().length < 10) return fail('Escreva a nota de passagem (mínimo de 10 caracteres): quem recebe precisa do contexto.', 'NOTA');
    const ts = now(); const p = { historico: [...(conv.historico || []), { ts, userId: u.id, acao: 'reatribuiu', de: { fila: conv.fila, responsavelId: conv.responsavelId }, para: { fila: fila || conv.fila, responsavelId: responsavelId || null } }] };
    if (fila && K.FILAS[fila]) p.fila = fila; p.responsavelId = responsavelId || null;
    db.patch('conversas', convId, p); K.nota(convId, userId, nota, 'passagem', true);
    logConv(u, 'chamado.reatribuido', conv, `Chamado ${conv.protocolo} reatribuído por ${u.nome}: ${K.FILAS[p.fila || conv.fila]}${responsavelId ? ' · ' + (U(responsavelId) || {}).nome : ''}`);
    return ok({ conv: db.get('conversas', convId) });
  };
  K.nota = function (convId, userId, texto, tipo = 'nota', _interno = false) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u || !isCedy(u)) return fail('Só a Cedy escreve notas internas.');
    if (!_interno && conv.canal === 'cedy' && K.acesso(conv, u) !== 'atende') return fail('Você não atende este chamado.', 'SEM_PERMISSAO');
    if (!String(texto || '').trim()) return fail('Escreva a nota.');
    const n = db.put('notasCedy', { id: C.uid('nc'), convId, autorId: u.id, texto: String(texto).trim(), tipo, ts: now() });
    return ok({ nota: n });
  };
  K.notas = (convId) => db.where('notasCedy', (n) => n.convId === convId).sort((a, b) => a.ts - b.ts);
  /** o cliente pediu "urgente": a Mesa confirma ou recusa (CC-12) */
  K.confirmarUrgente = function (convId, aceitar, userId) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Chamado não encontrado.');
    const e = exigeAtende(conv, u); if (e) return e; if (!conv.urgentePedido) return fail('Não há pedido de urgência pendente.');
    const ts = now(); const p = { urgentePedido: false };
    if (aceitar) { p.prioridade = 'critica'; p.prioridadeMotivo = 'Urgência pedida pelo cliente e confirmada pela Mesa.'; if (conv.slaAte) p.slaAte = E.slaAte(conv.slaInicio || ts, K.horasSla('critica')); }
    db.patch('conversas', convId, p); logConv(u, 'chamado.urgencia', conv, `Urgência do chamado ${conv.protocolo} ${aceitar ? 'confirmada' : 'recusada'} por ${u.nome}`);
    K.msgSistema(convId, aceitar ? 'A Mesa confirmou a urgência: a prioridade passou para crítica.' : 'A Mesa manteve a prioridade original: o pedido não atende à regra de prioridade crítica.');
    return ok();
  };
  K.fixarPrioridade = function (convId, prioridade, userId) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Chamado não encontrado.');
    const e = exigeAtende(conv, u); if (e) return e; if (!K.PRIORIDADES[prioridade] || prioridade === 'critica') return fail('A prioridade crítica só vem da regra ou da confirmação de urgência.');
    db.patch('conversas', convId, { prioridade, urgentePedido: false, slaAte: conv.slaAte ? E.slaAte(conv.slaInicio || now(), K.horasSla(prioridade)) : null });
    logConv(u, 'chamado.prioridade', conv, `Prioridade do chamado ${conv.protocolo} ajustada para ${K.PRIORIDADES[prioridade]} por ${u.nome}`);
    return ok();
  };

  /* -------------------- pedido de ação e execução R1 --------------------- */
  const soAdminAcao = (acao, params) => acao === 'iniciar_reset_2fa' || (acao === 'corrigir_cadastro' && params && params.campo === 'email_contato');
  /** opções para o formulário "Pedir ação" (alvos da própria empresa) */
  K.alvosAcao = function (acao, orgId) {
    const o = db.get('orgs', orgId); if (!o) return [];
    if (acao === 'reenviar_convite') return [...db.where('users', (x) => x.orgId === orgId && !x.ultimoAcesso).map((x) => ({ value: 'usuario:' + x.id, label: `${x.nome} (${x.email})` })), ...db.where('convites', (x) => x.origId === orgId && x.status === 'convidado').map((x) => ({ value: 'convite:' + x.id, label: `${x.nome} (${x.email})` }))];
    if (acao === 'reabrir_lote') return db.where('lotes', (l) => l.cedenteId === orgId && l.status === 'recusado').map((l) => ({ value: l.id, label: `Lote ${l.id}, ${l.nomeArquivo || ''}` }));
    if (acao === 'iniciar_reset_2fa') return db.where('users', (x) => x.orgId === orgId).map((x) => ({ value: x.id, label: `${x.nome} (${x.email})` }));
    if (acao === 'segunda_via') return [...db.where('faturas', (f) => f.finId === orgId).map((f) => ({ value: 'fatura:' + f.id, label: 'Fatura ' + f.id })), ...db.where('contratos', (c) => c.partes && (c.partes.cedenteId === orgId || c.partes.financiadorId === orgId)).map((c) => ({ value: 'contrato:' + c.id, label: 'Contrato de cessão ' + c.id })), ...db.where('premiacoes', (p) => p.origId === orgId).slice(0, 6).map((p) => ({ value: 'relatorio:' + p.id, label: 'Relatório mensal ' + p.competencia }))];
    if (acao === 'corrigir_cadastro') return [{ value: 'org:fantasia', label: 'Nome fantasia da empresa' }, { value: 'org:cidade', label: 'Cidade da empresa' }, { value: 'org:uf', label: 'UF da empresa' }, ...db.where('users', (x) => x.orgId === orgId).flatMap((x) => [{ value: `user:${x.id}:cargo`, label: `Cargo de ${x.nome}` }, { value: `user:${x.id}:telefone`, label: `Telefone de ${x.nome}` }, { value: `user:${x.id}:email_contato`, label: `E-mail de contato de ${x.nome} (só administrador)` }])];
    return [];
  };
  /** O cliente pede uma ação por chamado. Só a lista fechada chega à Mesa; o resto vira FLUXO_FORMAL (CC-07, CC-08, CC-09) */
  K.pedirAcao = function ({ convId, userId, acao, alvo = null, valor = '', texto = '' }) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Chamado não encontrado.');
    if (isCedy(u)) return fail('O pedido é feito pelo cliente.'); if (conv.canal !== 'cedy' || conv.tipo !== 'chamado') return fail('Pedidos de ação só existem em chamados com a Cedy.');
    if (u.perfil === 'leitor') return fail('O perfil leitor só lê: não pede ações.', 'LEITOR');
    const def = K.ACOES[acao]; if (!def) return fail('Ação fora da lista.', 'FLUXO_FORMAL');
    const params = { alvo, valor: String(valor || '').trim(), campo: alvo && String(alvo).split(':').pop() };
    if (soAdminAcao(acao, params) && u.perfil !== 'admin') return fail(acao === 'iniciar_reset_2fa' ? 'Só o administrador da empresa pode pedir a redefinição de 2FA.' : 'Só o administrador pode pedir a correção do e-mail de contato.', 'SO_ADMIN');
    if (acao !== 'reatribuir' && !alvo) return fail('Escolha a que o pedido se refere.');
    if (acao === 'corrigir_cadastro' && !params.valor) return fail('Informe o novo valor.');
    const rotulo = def.label + (alvo ? ` (${alvo})` : '');
    const r = K.enviar({ convId, userId, texto: texto || `Pedido de ação: ${rotulo}.` });
    if (!r.ok) return r;
    const ac = db.put('acoesChamado', { id: 'AC-' + String(db.all('acoesChamado').length + 1).padStart(4, '0'), convId, msgId: r.msg.id, msgHash: r.msg.hash, acao, params, pedidaPor: u.id, executadaPor: null, alvo: null, antes: null, depois: null, ts: now(), status: 'pedida', revertidaEm: null });
    db.patch('mensagens', r.msg.id, { acao: { codigo: 'PEDIDO_ACAO', acaoId: ac.id, acao } });
    return ok({ acao: ac, msg: r.msg });
  };
  const checaAlvoOrg = (tipo, id, orgId) => {
    if (tipo === 'usuario') { const x = db.get('users', id); return !!x && x.orgId === orgId; }
    if (tipo === 'convite') { const x = db.get('convites', id); return !!x && x.origId === orgId; }
    return false;
  };
  /** Mesa executa a ação reversível pedida: confere o solicitante, aplica só na empresa dele, registra antes e depois (CC-07 a CC-09) */
  K.executarR1 = function (acaoId, userId) {
    const ac = db.get('acoesChamado', acaoId); const u = U(userId); if (!ac || !u) return fail('Pedido não encontrado.');
    const conv = db.get('conversas', ac.convId); if (!K.temPerm(u, 'ops.com.atender') || (conv && K.acesso(conv, u) !== 'atende')) return fail('Seu papel não atende este chamado.', 'SEM_PERMISSAO');
    if (ac.status !== 'pedida') return fail('Este pedido já foi tratado.');
    const sol = U(ac.pedidaPor); const orgId = sol.orgId; const def = K.ACOES[ac.acao];
    if (!def) return fail('Ação fora da lista fechada: use o fluxo formal.', 'FLUXO_FORMAL');
    if (sol.perfil === 'leitor') return fail('O solicitante é leitor.', 'LEITOR');
    if (soAdminAcao(ac.acao, ac.params) && sol.perfil !== 'admin') return fail('Esta ação só vale quando pedida por administrador.', 'SO_ADMIN');
    const p = ac.params || {}; let antes = null, depois = null, alvo = null, aviso = '', classeNot = 'operacional';
    const ts = now();
    try { db.batch(() => {
      if (ac.acao === 'reenviar_convite') {
        const [tipo, id] = String(p.alvo).split(':'); if (!checaAlvoOrg(tipo, id, orgId)) throw fail('O convite não pertence à empresa do solicitante.', 'ALVO_FORA');
        const col = tipo === 'usuario' ? 'users' : 'convites'; const o = db.get(col, id); antes = { ultimoEnvio: o.convidadoReenviadoEm || null }; depois = { ultimoEnvio: ts };
        db.patch(col, id, { convidadoReenviadoEm: ts }); alvo = { kind: tipo, id }; aviso = `Convite reenviado para ${o.nome || o.email}.`;
      } else if (ac.acao === 'reabrir_lote') {
        const l = db.get('lotes', p.alvo); if (!l || l.cedenteId !== orgId) throw fail('O lote não pertence à empresa do solicitante.', 'ALVO_FORA');
        if (l.status !== 'recusado') throw fail('Só lotes recusados podem ser reabertos.');
        antes = { status: l.status, titulos: l.titulos.map((id) => (db.get('titulos', id) || {}).status), slaAte: l.slaAte }; depois = { status: 'validando' };
        l.titulos.forEach((id) => { const t = db.get('titulos', id); if (t && t.status === 'recusado') db.patch('titulos', id, { status: 'validando', motivoRecusa: null }); });
        db.patch('lotes', l.id, { status: 'validando', slaAte: E.slaAte(ts, 4), reabertoPor: u.id, motivo: null }); alvo = { kind: 'lote', id: l.id }; aviso = `Lote ${l.id} reaberto: volta para a validação da Mesa (sem aprovação automática).`;
      } else if (ac.acao === 'corrigir_cadastro') {
        const partes = String(p.alvo).split(':');
        if (partes[0] === 'org') { const campo = partes[1]; const o = db.get('orgs', orgId); antes = { [campo]: o[campo] }; depois = { [campo]: p.valor }; db.patch('orgs', orgId, { [campo]: p.valor }); alvo = { kind: 'org', id: orgId, campo }; }
        else { const id = partes[1]; const campo = partes[2]; if (!checaAlvoOrg('usuario', id, orgId)) throw fail('O usuário não pertence à empresa do solicitante.', 'ALVO_FORA'); const x = db.get('users', id); const real = campo === 'email_contato' ? 'email' : campo; antes = { [campo]: x[real] }; depois = { [campo]: p.valor }; db.patch('users', id, { [real]: p.valor }); alvo = { kind: 'user', id, campo }; if (campo === 'email_contato') classeNot = 'obrigatoria'; }
        aviso = 'Dado cadastral corrigido pela Mesa.';
      } else if (ac.acao === 'iniciar_reset_2fa') {
        if (!checaAlvoOrg('usuario', p.alvo, orgId)) throw fail('O usuário não pertence à empresa do solicitante.', 'ALVO_FORA');
        const x = db.get('users', p.alvo); antes = { twofaReset: x.twofaReset || null }; depois = { twofaReset: { iniciadoEm: ts, expiraEm: ts + 24 * 3600e3 } };
        db.patch('users', x.id, { twofaReset: depois.twofaReset }); alvo = { kind: 'user', id: x.id }; aviso = `Redefinição de 2FA iniciada para ${x.nome}: a pessoa conclui no app em até 24 h.`; classeNot = 'obrigatoria';
        notify.send({ to: { userId: x.id }, tipo: 'alerta', titulo: 'Redefinição de 2FA iniciada', corpo: 'A Cedy iniciou a redefinição a pedido de um administrador da sua empresa. Conclua no app em até 24 horas. Se você não reconhece, avise a Cedy.', link: K.base(x) + '/configuracoes?aba=seguranca', classe: 'obrigatoria' });
      } else if (ac.acao === 'segunda_via') {
        const [tipo, id] = String(p.alvo).split(':'); antes = null; depois = { segundaViaEm: ts }; alvo = { kind: tipo, id }; aviso = `Segunda via emitida (${tipo} ${id}) e disponível na área do solicitante.`;
      } else if (ac.acao === 'reatribuir') {
        antes = { fila: conv.fila, prioridade: conv.prioridade }; depois = { fila: conv.fila, prioridade: conv.prioridade }; alvo = { kind: 'conversa', id: conv.id }; aviso = 'Pedido de priorização registrado: o líder da Mesa decide a área e a prioridade.';
      }
      const ex = db.patch('acoesChamado', ac.id, { executadaPor: u.id, alvo, antes, depois, status: 'executada', executadaEm: ts });
      ledger.append({ actor: A.user(u.id), acao: 'chamado.acao_r1', entidade: { kind: 'conversa', id: conv.id }, resumo: `${def.label}, executada por ${u.nome} a pedido de ${sol.nome} (${K.nomeOrg(orgId)}), chamado ${conv.protocolo}`, classe: 'R1', detalhe: { msgHash: ac.msgHash, alvo }, snapshot: { antes, depois } });
      K.msgSistema(conv.id, `Ação executada pela Mesa: ${aviso} Pedida por ${sol.nome} (mensagem ${String(ac.msgHash).slice(0, 8)}). Pode ser desfeita pela Mesa.`, { acao: { codigo: 'ACAO_EXECUTADA', acaoId: ac.id } });
      db.where('users', (x) => x.orgId === orgId && x.perfil === 'admin').forEach((x) => notify.send({ to: { userId: x.id }, tipo: 'info', titulo: `Ação da Mesa: ${def.label}`, corpo: `${aviso} Pedida por ${sol.nome}.`, link: K.rotaConversa(conv, x.id), classe: classeNot }));
      return ex;
    }); } catch (e) { if (e && e.ok === false) return e; throw e; }
    return ok({ acao: db.get('acoesChamado', acaoId) });
  };
  /** ação reversível: devolve ao estado de antes */
  K.reverterAcao = function (acaoId, userId) {
    const ac = db.get('acoesChamado', acaoId); const u = U(userId); if (!ac || !u || ac.status !== 'executada') return fail('Nada a reverter.');
    if (!K.temPerm(u, 'ops.com.atender')) return fail('Seu papel não reverte ações.', 'SEM_PERMISSAO'); const alvo = ac.alvo || {}; const antes = ac.antes || {};
    db.batch(() => {
      if (ac.acao === 'reabrir_lote') { const l = db.get('lotes', alvo.id); db.patch('lotes', l.id, { status: antes.status }); l.titulos.forEach((id, i) => { if (antes.titulos[i]) db.patch('titulos', id, { status: antes.titulos[i] }); }); }
      else if (alvo.kind === 'org') db.patch('orgs', alvo.id, antes);
      else if (alvo.kind === 'user' && ac.acao === 'corrigir_cadastro') db.patch('users', alvo.id, { [alvo.campo === 'email_contato' ? 'email' : alvo.campo]: antes[alvo.campo] });
      else if (ac.acao === 'iniciar_reset_2fa') db.patch('users', alvo.id, { twofaReset: null });
      else if (ac.acao === 'reenviar_convite') db.patch(alvo.kind === 'usuario' ? 'users' : 'convites', alvo.id, { convidadoReenviadoEm: antes.ultimoEnvio });
      db.patch('acoesChamado', ac.id, { status: 'revertida', revertidaEm: now(), revertidaPor: u.id });
      const conv = db.get('conversas', ac.convId);
      ledger.append({ actor: A.user(u.id), acao: 'chamado.acao_revertida', entidade: { kind: 'conversa', id: ac.convId }, resumo: `Ação ${K.ACOES[ac.acao].label} revertida por ${u.nome}, chamado ${conv.protocolo}`, classe: 'R1', detalhe: { msgHash: ac.msgHash } });
      K.msgSistema(ac.convId, `Ação revertida pela Mesa: ${K.ACOES[ac.acao].label}. O estado anterior foi restaurado.`);
    });
    return ok();
  };
  K.acoesDe = (convId) => db.where('acoesChamado', (a) => a.convId === convId).sort((a, b) => a.ts - b.ts);
  /** a Mesa não executa o pedido: explica o motivo no fio e registra (nada é alterado) */
  K.recusarAcao = function (acaoId, motivo, userId) {
    const ac = db.get('acoesChamado', acaoId); const u = U(userId); if (!ac || !u || ac.status !== 'pedida') return fail('Pedido não encontrado ou já tratado.');
    const conv = db.get('conversas', ac.convId); if (!K.temPerm(u, 'ops.com.atender') || (conv && K.acesso(conv, u) !== 'atende')) return fail('Seu papel não atende este chamado.', 'SEM_PERMISSAO');
    if (!motivo || String(motivo).trim().length < 10) return fail('Explique ao cliente por que o pedido não foi executado (mínimo de 10 caracteres).');
    db.patch('acoesChamado', ac.id, { status: 'recusada', codigo: 'RECUSADA_PELA_MESA', executadaPor: u.id, motivoRecusa: String(motivo).trim() });
    ledger.append({ actor: A.user(u.id), acao: 'chamado.acao_recusada', entidade: { kind: 'conversa', id: conv.id }, resumo: `Pedido ${K.ACOES[ac.acao] ? K.ACOES[ac.acao].label : ac.acao} recusado por ${u.nome}, chamado ${conv.protocolo}: ${motivo}`, classe: 'R1', detalhe: { msgHash: ac.msgHash } });
    K.msgSistema(conv.id, `A Mesa não executou o pedido (${K.ACOES[ac.acao] ? K.ACOES[ac.acao].label.toLowerCase() : ac.acao}): ${String(motivo).trim()} Nada foi alterado.`);
    return ok();
  };

  /* ------------------- redação, acesso e pares (CC-05, CC-16) ------------- */
  /** só compliance ou líder; oculta o conteúdo mas preserva hash, autor, hora e o fato da redação */
  K.redigir = function (msgId, motivo, userId) {
    const m = db.get('mensagens', msgId); const u = U(userId); if (!m || !u) return fail('Mensagem não encontrada.');
    if (!isCedy(u) || !(u.papel === 'compliance' || ehLider(u))) return fail('Só o compliance ou o líder da Mesa redige mensagens.', 'SEM_PERMISSAO');
    if (!motivo || String(motivo).trim().length < 10) return fail('Explique o motivo da redação (mínimo de 10 caracteres).');
    if (m.redigida) return fail('A mensagem já está redigida.');
    db.patch('mensagens', msgId, { redigida: { por: u.id, motivo: String(motivo).trim(), ts: now() } });
    ledger.append({ actor: A.user(u.id), acao: 'com.mensagem_redigida', entidade: { kind: 'mensagem', id: msgId }, resumo: `Mensagem ${msgId} redigida por ${u.nome}: ${motivo}`, classe: 'R3', detalhe: { hash: m.hash, conv: m.convId } });
    return ok();
  };
  /** Leitura de conversa entre clientes fora da fila própria: exige motivo, grava acesso e R3 (CC-05) */
  K.registrarAcesso = function (convId, userId, motivo) {
    const conv = db.get('conversas', convId); const u = U(userId); if (!conv || !u) return fail('Conversa não encontrada.');
    if (K.acesso(conv, u) !== 'motivo') return fail('Seu papel não lê conversas entre clientes.', 'SEM_PERMISSAO');
    if (!motivo || String(motivo).trim().length < 10) return fail('Informe o motivo da leitura (mínimo de 10 caracteres): ele fica registrado.', 'MOTIVO');
    const ac = db.put('acessosCom', { id: C.uid('ac'), convId, userId: u.id, papel: (C.OPS_PAPEIS[u.papel] || {}).label || u.papel, motivo: String(motivo).trim(), ts: now() });
    ledger.append({ actor: A.user(u.id), acao: 'com.leitura_conversa', entidade: { kind: 'conversa', id: convId }, resumo: `${u.nome} leu a conversa ${convId} (${conv.titulo}): ${motivo}`, classe: 'R3' });
    return ok({ acesso: ac });
  };
  K.acessoLiberado = (convId, userId, janelaMin = 30) => db.all('acessosCom').some((a) => a.convId === convId && a.userId === userId && a.ts > now() - janelaMin * 60e3);

  /* ---------------------- caixa de entrada unificada ---------------------- */
  K.tiposPara = function (u) {
    const t = ['conversas', 'chamados', 'comunicados', 'obrigatorias', 'operacionais', 'informativas'];
    if (isCedy(u)) { if (temPerm(u, 'ops.com.moderar')) t.push('alertas'); t.push('aprovacoes'); }
    return K.TIPOS_FEED.filter((x) => t.includes(x.id));
  };
  /** comunicados visíveis à empresa (segmentação por perfil, programa e empresa) */
  K.comunicadosPara = function (u) {
    if (!u) return []; const o = orgOf(u); const key = keyOf(u); if (isCedy(u)) return [];
    return db.where('comunicados', (c) => {
      if (c.status !== 'publicado') return false; const s = c.segmento || {};
      if ((s.orgIds || []).length && !s.orgIds.includes(u.orgId)) return false;
      if ((s.perfis || []).length && !s.perfis.includes(key) && !s.perfis.includes(o.kind)) return false;
      return true;
    });
  };
  const comunicadoPendente = (c, u) => c.tipo === 'contratual' && !db.all('ciencias').some((x) => x.comunicadoId === c.id && x.orgId === u.orgId);
  const tomPrio = { critica: 'red', normal: 'blue', baixa: 'neutral' };
  /** linhas da caixa, em ordem cronológica, sem filtro padrão (CC-31) */
  K.feed = function (userId) {
    const u = U(userId); if (!u) return []; const out = [];
    K.visiveis(userId).filter((c) => c.canal !== 'interna').forEach((c) => {
      const ac = K.acesso(c, u); if (ac === 'motivo') return;
      const n = (c.naoLidaPor || {})[u.id] || 0; const info = K.ancoraInfo(c.ancora, u);
      out.push({ key: 'c:' + c.id, tipo: c.tipo === 'chamado' ? 'chamados' : 'conversas', kind: 'conversa', id: c.id, ts: c.ultimaMsgEm, titulo: c.tipo === 'chamado' ? `${c.protocolo} · ${c.titulo}` : c.titulo, previa: (c.ultimoAutor ? c.ultimoAutor + ': ' : '') + (c.previa || 'Sem mensagens ainda'), naoLida: n > 0, qtd: n, precisa: K.precisaDeVoce(c, u), ancora: info && info.label, link: K.rotaConversa(c, u.id), conv: c, icone: c.tipo === 'chamado' ? 'life-buoy' : 'messages-square', tom: c.tipo === 'chamado' ? tomPrio[c.prioridade] || 'blue' : 'blue' });
    });
    const optIn = Object.values(((u.notifPrefs || {}).informativas) || {}).some(Boolean);
    notify.mine().forEach((nt) => {
      if (nt.classe === 'informativa' && !optIn) return;
      const pend = notify.pending(nt); const tipo = { obrigatoria: 'obrigatorias', operacional: 'operacionais', informativa: 'informativas' }[nt.classe || 'operacional'];
      out.push({ key: 'n:' + nt.id, tipo, kind: 'notif', id: nt.id, ts: nt.ts, titulo: nt.titulo, previa: nt.corpo, naoLida: !nt.lida, qtd: nt.lida ? 0 : 1, precisa: pend, link: nt.link, notif: nt, icone: { sucesso: 'circle-check', alerta: 'triangle-alert', erro: 'circle-alert', info: 'info' }[nt.tipo] || 'info', tom: { sucesso: 'green', alerta: 'amber', erro: 'red', info: 'blue' }[nt.tipo] || 'blue' });
    });
    K.comunicadosPara(u).forEach((c) => {
      const lido = db.all('ciencias').some((x) => x.comunicadoId === c.id && x.userId === u.id); const pend = comunicadoPendente(c, u);
      out.push({ key: 'm:' + c.id, tipo: 'comunicados', kind: 'comunicado', id: c.id, ts: c.publicadoEm, titulo: c.titulo, previa: c.corpo.slice(0, 140), naoLida: !lido && !db.all('ciencias').some((x) => x.comunicadoId === c.id && x.orgId === u.orgId), qtd: 0, precisa: pend, link: K.base(u) + '/mensagens?c=' + c.id, comunicado: c, icone: 'megaphone', tom: c.tipo === 'contratual' ? 'amber' : 'blue' });
    });
    if (isCedy(u) && temPerm(u, 'ops.com.moderar')) db.where('alertasContato', (a) => ['aberto', 'em_analise'].includes(a.status)).forEach((a) => out.push({ key: 'a:' + a.id, tipo: 'alertas', kind: 'alerta', id: a.id, ts: a.ultimaEm, titulo: `Contato externo: ${K.nomeOrg(a.orgId)}`, previa: `${(U(a.userId) || {}).nome || ''}, ${a.tentativas} ${a.tentativas === 1 ? 'tentativa' : 'tentativas'} hoje · ${a.trechoMascarado}`, naoLida: a.status === 'aberto', qtd: a.status === 'aberto' ? 1 : 0, precisa: true, link: '/ops/comunicacao?aba=alertas', icone: 'triangle-alert', tom: a.prioridade === 'alta' ? 'red' : 'amber' }));
    if (isCedy(u)) db.where('aprovacoes', (a) => a.status === 'pendente' && (u.perfil === 'superadmin' ? a.solicitanteId !== u.id : a.solicitanteId === u.id)).forEach((a) => out.push({ key: 'p:' + a.id, tipo: 'aprovacoes', kind: 'aprovacao', id: a.id, ts: a.solicitadoEm, titulo: a.titulo, previa: u.perfil === 'superadmin' ? 'Aguardando a sua decisão (quatro olhos).' : 'Aguardando o Superadmin.', naoLida: u.perfil === 'superadmin', qtd: u.perfil === 'superadmin' ? 1 : 0, precisa: u.perfil === 'superadmin', link: u.perfil === 'superadmin' ? '/super/aprovacoes' : '/ops/solicitacoes', icone: 'stamp', tom: 'violet' }));
    return out.sort((a, b) => b.ts - a.ts);
  };
  K.contadores = function (userId) {
    const feed = K.feed(userId); const por = {}; K.TIPOS_FEED.forEach((t) => { por[t.id] = 0; });
    feed.forEach((i) => { if (i.naoLida) por[i.tipo] += 1; });
    return { por, naoLidas: feed.filter((i) => i.naoLida).length, precisa: feed.filter((i) => i.precisa).length, total: feed.length };
  };
  /** marca como lido o que não exige ação nem ciência (CC-33) */
  K.marcarTodasLidas = function (userId) {
    notify.readAll(); const u = U(userId);
    db.where('conversas', (c) => (c.naoLidaPor || {})[userId] && !K.precisaDeVoce(c, u)).forEach((c) => K.lida(c.id, userId));
  };
  /** e-mail simulado das obrigatórias: prévia sem dado sensível, com link ao app (CC-37) */
  K.emailSimulado = function (n, user) {
    const mascara = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');
    return { de: 'avisos@cedy.com.br', para: mascara((user || session.user() || {}).email), assunto: 'Cedy: há um aviso importante na sua conta', corpo: 'Você tem uma notificação obrigatória na plataforma. Por segurança, não incluímos detalhes neste e-mail. Entre no app para ver e, se for o caso, agir.', link: n && n.link ? 'app.cedy.com.br/#' + n.link : 'app.cedy.com.br', enviadoEm: n ? n.ts : now() };
  };

  /* ------------------ tempo real simulado (CC-37) -------------------------- */
  const RESP_CEDY = { operacoes: ['Olá! Já estou olhando o seu caso. Pode confirmar o número do lote ou da operação?', 'Conferi aqui: o lote está na fila de validação da Mesa. Retorno ainda hoje.'], conciliacao: ['Recebi. Estou conferindo o extrato e já retorno com o rateio.'], cadastro: ['Recebi os documentos. Falta apenas a certidão atualizada para concluir a análise.'], acesso: ['Entendi. Pode me confirmar o e-mail da pessoa para eu seguir com o pedido?'], faturamento: ['Conferi a fatura e os cálculos. Posso enviar a memória de cálculo por aqui, se quiser.'], plataforma: ['Estamos acompanhando. Já registrei o seu caso no incidente em andamento.'], outros: ['Olá! Recebi a sua mensagem e já estou verificando.'] };
  /** a contraparte responde depois de alguns segundos, com indicador de digitação */
  K.simularResposta = function (convId, { atraso = 2200 } = {}) {
    const conv = db.get('conversas', convId); if (!conv) return fail('Conversa não encontrada.');
    const me = session.user(); let autor = null, payload = {};
    if (conv.canal === 'cedy') {
      autor = isCedy(me) ? db.where('users', (x) => !isCedy(x) && conv.orgIds.includes(x.orgId) && x.perfil !== 'leitor')[0] : db.where('users', (x) => isCedy(x) && x.papel === conv.fila && x.perfil !== 'leitor')[0] || db.where('users', (x) => isCedy(x) && x.perfil === 'admin')[0];
      const pool = isCedy(me) ? ['Obrigado, vou conferir e retorno.', 'Certo, pode seguir.'] : RESP_CEDY[conv.categoria] || RESP_CEDY.outros; payload = { texto: pool[Math.floor(now() / 7919) % pool.length] };
    } else {
      const outroOrg = conv.orgIds.find((o) => !me || o !== me.orgId) || conv.orgIds[0];
      autor = db.where('users', (x) => x.orgId === outroOrg && x.perfil !== 'leitor' && x.perfil !== 'subparceiro')[0];
      if (['esclarecimentos', 'cedente_sacado', 'orig_indicado'].includes(conv.canal)) payload = { estruturada: { modelo: 'entendido' } }; else payload = { texto: 'Combinado. Sigo com isso e retorno com novidades aqui mesmo.' };
    }
    if (!autor) return fail('Não há outra parte disponível para responder.');
    db.patch('conversas', convId, { digitando: { nome: autor.nome, ate: Date.now() + atraso + 400 } });
    setTimeout(() => { K.enviar(Object.assign({ convId, userId: autor.id, _ts: now() }, payload)); db.patch('conversas', convId, { digitando: null }); }, atraso);
    return ok();
  };

  /* --------------------------- passagem do tempo ------------------------- */
  /** SLA estourado avisa o líder uma vez e entra no painel (CC-11) */
  const tick0 = E.tick;
  E.tick = function () {
    tick0();
    db.where('conversas', (c) => K.slaEstourado(c) && !c.estouroNotificado).forEach((c) => {
      db.patch('conversas', c.id, { estouroNotificado: now() });
      db.where('users', (x) => isCedy(x) && x.perfil === 'admin').forEach((x) => notify.send({ to: { userId: x.id }, tipo: 'erro', titulo: `Prazo estourado: ${c.protocolo}`, corpo: `${K.nomeOrg(c.orgIds[0])}, prioridade ${K.PRIORIDADES[c.prioridade].toLowerCase()}, fila ${K.FILAS[c.fila]}.`, link: '/ops/chamados/' + c.id, classe: 'operacional' }));
      ledger.append({ actor: A.sistema('Relógio'), acao: 'chamado.sla_estourado', entidade: { kind: 'conversa', id: c.id }, resumo: `Prazo de resposta do chamado ${c.protocolo} estourou`, classe: 'R1' });
    });
    db.where('users', (x) => x.twofaReset && x.twofaReset.expiraEm < now()).forEach((x) => db.patch('users', x.id, { twofaReset: null }));
  };

  /* ----------------- denúncia, bloqueio e decisão de alertas (CC-04, CC-23, CC-38, CC-39) ----------------- */
  const compliancePeople = () => db.where('users', (x) => isCedy(x) && temPerm(x, 'ops.com.moderar') && x.perfil !== 'superadmin');
  /** denúncia vai ao compliance com o contexto; só quem participa da conversa denuncia, e só em conversa entre empresas */
  K.denunciar = function ({ userId, convId, msgId = null, motivo }) {
    const u = U(userId); const conv = db.get('conversas', convId); if (!u || !conv) return fail('Conversa não encontrada.');
    if (isCedy(u)) return fail('A denúncia é feita pelo cliente.'); if (K.acesso(conv, u) !== 'escreve' && K.acesso(conv, u) !== 'le') return fail('Você não participa desta conversa.');
    if (!BLOQ_TIPOS.includes(conv.canal)) return fail('Só conversas entre empresas podem ser denunciadas. Para a Cedy, abra um chamado.', 'MATRIZ');
    if (!motivo || String(motivo).trim().length < 10) return fail('Explique a denúncia (mínimo de 10 caracteres).');
    const m = msgId ? db.get('mensagens', msgId) : null; if (msgId && (!m || m.convId !== convId)) return fail('Mensagem não encontrada nesta conversa.');
    const contra = conv.orgIds.find((o) => o !== u.orgId) || null;
    const d = db.put('denuncias', { id: 'DN-' + String(db.all('denuncias').length + 1).padStart(4, '0'), convId, msgId, msgHash: m ? m.hash : null, por: { orgId: u.orgId, userId: u.id }, contraOrgId: contra, motivo: String(motivo).trim(), status: 'pendente', criadaEm: now(), decididoPor: null, decisaoMotivo: null });
    ledger.append({ actor: A.user(u.id), acao: 'com.denuncia', entidade: { kind: 'denuncia', id: d.id }, resumo: `${u.nome} (${K.nomeOrg(u.orgId)}) denunciou ${m ? 'uma mensagem' : 'a conversa'} ${convId}`, classe: 'R1', detalhe: { convId, msgHash: d.msgHash } });
    compliancePeople().forEach((x) => notify.send({ to: { userId: x.id }, tipo: 'alerta', titulo: 'Nova denúncia em conversa entre empresas', corpo: `${K.nomeOrg(u.orgId)} denunciou ${m ? 'uma mensagem' : 'a conversa'} (${conv.titulo}).`, link: '/ops/comunicacao?aba=denuncias', classe: 'operacional' }));
    return ok({ denuncia: d });
  };
  K.decidirDenuncia = function (id, decisao, motivo, userId) {
    const d = db.get('denuncias', id); const u = U(userId); if (!d || !u) return fail('Denúncia não encontrada.');
    if (!isCedy(u) || !temPerm(u, 'ops.com.moderar')) return fail('Só o compliance decide denúncias.', 'SEM_PERMISSAO');
    if (!['procedente', 'improcedente', 'em_analise'].includes(decisao)) return fail('Decisão inválida.');
    if (decisao !== 'em_analise' && (!motivo || String(motivo).trim().length < 10)) return fail('Registre o motivo da decisão (mínimo de 10 caracteres).');
    db.patch('denuncias', id, { status: decisao, decididoPor: u.id, decisaoMotivo: motivo ? String(motivo).trim() : null, decididaEm: now() });
    ledger.append({ actor: A.user(u.id), acao: 'com.denuncia_decidida', entidade: { kind: 'denuncia', id }, resumo: `Denúncia ${id} ${decisao === 'em_analise' ? 'em análise' : decisao} por ${u.nome}${motivo ? ': ' + motivo : ''}`, classe: decisao === 'procedente' ? 'R2' : 'R1' });
    if (decisao !== 'em_analise') notify.send({ to: { userId: d.por.userId }, tipo: 'info', titulo: `Sua denúncia foi analisada (${decisao})`, corpo: 'A Cedy analisou o caso. O detalhe da decisão fica com a Cedy.', link: '/' + C.roleOfOrg(db.get('orgs', d.por.orgId)) + '/mensagens', classe: 'operacional' });
    return ok();
  };
  /** Bloqueio de relacionamento (CC-23, CC-39): "conversa" bloqueia novas conversas; "ofertas" (cedente x financiador) também bloqueia a conversa. Nunca mexe em operação em andamento nem apaga histórico. */
  K.bloquear = function ({ userId, contraOrgId, tipo = 'conversa', motivo = '' }) {
    const u = U(userId); if (!u || isCedy(u)) return fail('O bloqueio é feito pelo cliente.');
    if (u.perfil !== 'admin') return fail('Só o administrador da empresa bloqueia um relacionamento.', 'SO_ADMIN');
    const outra = db.get('orgs', contraOrgId); if (!outra || outra.kind === 'cedy' || contraOrgId === u.orgId) return fail('Empresa inválida.');
    const org = orgOf(u);
    if (tipo === 'ofertas' && !(org.kind === 'cedente' && outra.kind === 'financiador')) return fail('Bloquear ofertas só existe entre cedente e financiador.');
    if (db.where('bloqueiosCom', (x) => x.orgId === u.orgId && x.contraOrgId === contraOrgId).length || (org.bloqueados || []).includes(contraOrgId)) return fail('Esta empresa já está bloqueada.');
    const b = db.put('bloqueiosCom', { id: 'BL-' + String(db.all('bloqueiosCom').length + 1).padStart(4, '0'), orgId: u.orgId, contraOrgId, ofertas: tipo === 'ofertas', desde: now(), motivo: String(motivo).trim(), por: u.id });
    if (tipo === 'ofertas') db.patch('orgs', u.orgId, { bloqueados: [...(org.bloqueados || []), contraOrgId] });
    ledger.append({ actor: A.user(u.id), acao: 'com.bloqueio', entidade: { kind: 'bloqueio', id: b.id }, resumo: `${K.nomeOrg(u.orgId)} bloqueou ${tipo === 'ofertas' ? 'ofertas e conversa com' : 'conversa com'} ${K.nomeOrg(contraOrgId)}`, classe: 'R2', detalhe: { motivo } });
    return ok({ bloqueio: b });
  };
  /** lista única "Relacionamentos bloqueados": junta o bloqueio de ofertas já existente (orgs.bloqueados) e o de conversa */
  K.bloqueiosDe = function (orgId) {
    const org = db.get('orgs', orgId); if (!org) return [];
    const dos = db.where('bloqueiosCom', (x) => x.orgId === orgId).map((x) => ({ id: x.id, contraOrgId: x.contraOrgId, nome: K.nomeOrg(x.contraOrgId), tipo: x.ofertas ? 'ofertas' : 'conversa', desde: x.desde, motivo: x.motivo }));
    (org.bloqueados || []).filter((o) => !dos.some((x) => x.contraOrgId === o)).forEach((o) => dos.push({ id: 'org:' + o, contraOrgId: o, nome: K.nomeOrg(o), tipo: 'ofertas', desde: null, motivo: '' }));
    return dos;
  };
  K.desbloquear = function (id, userId) {
    const u = U(userId); if (!u || isCedy(u)) return fail('O desbloqueio é feito pelo cliente.'); if (u.perfil !== 'admin') return fail('Só o administrador da empresa desbloqueia.', 'SO_ADMIN');
    const org = orgOf(u); let contra = null;
    if (String(id).startsWith('org:')) contra = id.slice(4); else { const b = db.get('bloqueiosCom', id); if (!b || b.orgId !== u.orgId) return fail('Bloqueio não encontrado.'); contra = b.contraOrgId; db.del('bloqueiosCom', id); }
    if ((org.bloqueados || []).includes(contra)) db.patch('orgs', u.orgId, { bloqueados: org.bloqueados.filter((x) => x !== contra) });
    ledger.append({ actor: A.user(u.id), acao: 'com.desbloqueio', entidade: { kind: 'bloqueio', id: String(id) }, resumo: `${K.nomeOrg(u.orgId)} desbloqueou ${K.nomeOrg(contra)}`, classe: 'R2' });
    return ok();
  };
  K.assumirAlerta = function (id, userId) {
    const a = db.get('alertasContato', id); const u = U(userId); if (!a || !u || !isCedy(u) || !temPerm(u, 'ops.com.moderar')) return fail('Só o compliance trata alertas de contato.', 'SEM_PERMISSAO');
    if (a.status !== 'aberto') return fail('O alerta já está em tratamento.');
    db.patch('alertasContato', id, { status: 'em_analise', decididoPor: u.id, assumidoEm: now() }); return ok();
  };
  /** só pessoa decide a consequência (CC-04): dispensar (falso positivo), advertir a empresa ou escalar ao líder */
  K.decidirAlerta = function (id, decisao, motivo, userId) {
    const a = db.get('alertasContato', id); const u = U(userId); if (!a || !u) return fail('Alerta não encontrado.');
    if (!isCedy(u) || !temPerm(u, 'ops.com.moderar')) return fail('Só o compliance decide sobre alertas de contato.', 'SEM_PERMISSAO');
    if (!['dispensar', 'advertir', 'escalar'].includes(decisao)) return fail('Decisão inválida.');
    if (!motivo || String(motivo).trim().length < 10) return fail('Registre o motivo (mínimo de 10 caracteres).');
    const alvo = U(a.userId); const status = decisao === 'dispensar' ? 'dispensado' : decisao === 'advertir' ? 'resolvido' : 'em_analise';
    db.patch('alertasContato', id, { status, decisao, decididoPor: u.id, decisaoMotivo: String(motivo).trim(), decididoEm: now(), escalado: decisao === 'escalar' || undefined });
    ledger.append({ actor: A.user(u.id), acao: 'com.alerta_decidido', entidade: { kind: 'alertaContato', id }, resumo: `Alerta ${id} (${K.nomeOrg(a.orgId)}): ${decisao} por ${u.nome}. ${motivo}`, classe: decisao === 'dispensar' ? 'R1' : 'R2' });
    if (decisao === 'advertir' && alvo) db.where('users', (x) => x.orgId === a.orgId && x.perfil === 'admin').forEach((x) => notify.send({ to: { userId: x.id }, tipo: 'alerta', titulo: 'A Cedy lembrou a regra de conversas na plataforma', corpo: `${alvo.nome} tentou compartilhar contato externo numa conversa. Mantenha as conversas na plataforma: elas ficam registradas e protegem as duas partes.`, link: '/' + C.roleOfOrg(db.get('orgs', x.orgId)) + '/mensagens', classe: 'operacional' }));
    if (decisao === 'escalar') db.where('users', (x) => isCedy(x) && x.perfil === 'admin').forEach((x) => notify.send({ to: { userId: x.id }, tipo: 'alerta', titulo: 'Alerta de contato escalado ao líder', corpo: `${K.nomeOrg(a.orgId)}: ${a.tentativas} tentativas. ${String(motivo).trim()}`, link: '/ops/comunicacao?aba=alertas', classe: 'operacional' }));
    return ok();
  };
  K.alertaSlaEstourado = (a) => ['aberto', 'em_analise'].includes(a.status) && a.slaAte && a.slaAte < now();
  /** acessos da Cedy à conversa, para o aviso aos participantes (CC-05) */
  K.acessosDaConversa = (convId) => db.where('acessosCom', (a) => a.convId === convId).sort((a, b) => b.ts - a.ts);

  /* somente leitura no "ver como" e com o bloco de comunicação pausado */
  ['abrirConversa', 'enviar', 'promoverAChamado', 'pedirAcao', 'executarR1', 'recusarAcao', 'reverterAcao', 'alterarStatus', 'assumir', 'atribuir', 'nota', 'confirmarUrgente', 'fixarPrioridade', 'redigir', 'registrarAcesso', 'marcarTodasLidas', 'lida', 'denunciar', 'decidirDenuncia', 'bloquear', 'desbloquear', 'assumirAlerta', 'decidirAlerta'].forEach((n) => {
    const f = K[n]; K[n] = function (...args) { const s = session.get(); if (s && s.impersonando && n !== 'lida') return fail('Modo "ver como": somente leitura.', 'SOMENTE_LEITURA'); if (s && s.impersonando) return undefined; return f.apply(K, args); };
  });
})();
