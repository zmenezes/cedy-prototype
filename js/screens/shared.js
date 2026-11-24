/* Cedy protótipo 0.1, telas compartilhadas: configurações, cadastro, ajuda, notificações.
   Registradas uma vez por prefixo de papel. Clássico, sem módulos. Prefixo CSS: sh-. */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session, prefs, ledger, notify } = C.store;
  const E = C.engine;
  const F = C.flows;

  const me = () => session.user();
  const org = () => session.org();
  const isAdmin = () => C.can('admin');
  const trim = (v) => String(v == null ? '' : v).trim();
  const perfilLabel = (p) => ({ admin: 'Administrador', operador: 'Operador', leitor: 'Leitor' }[p] || p);
  function log(acao, resumo, classe, entidade) {
    return ledger.append({ actor: E.actors.user(me().id), acao, entidade: entidade || { kind: 'org', id: org().id }, resumo, classe: classe || 'R1' });
  }
  function readOnlyNote(what) {
    return ui.callout({ tone: 'info', icon: 'eye', title: 'Somente leitura', text: `Seu perfil (${perfilLabel(me().perfil).toLowerCase()}) pode ver ${what}, mas não pode alterar. Peça a um administrador da empresa.` });
  }
  function needAdmin() { if (!isAdmin()) { ui.toast('Somente administradores', { type: 'warn', text: C.cannotMsg('admin') }); return false; } return true; }
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trim(v));
  function ensureArr(o, k) { if (!Array.isArray(o[k])) o[k] = []; return o[k]; }
  function validCpf(d) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return (r === 10 ? 0 : r) === Number(d[n]); };
    return dv(9) && dv(10);
  }
  /** linha de preferência: título e dica à esquerda, controle à direita */
  const prefRow = (title, hint, control) => h('div.sh-pref', h('div.sh-pref-t', h('strong', title), hint && h('small', hint)), h('div.sh-pref-c', control));

  /* ------------------------- preferências de notificação ------------------------- */
  const NOTIF_EVENTS = {
    cedente: [['nova_oferta', 'Nova oferta recebida'], ['aceite_auto', 'Aceite automático executado'], ['assinatura_pendente', 'Assinatura pendente'], ['pagamento_recebido', 'Pagamento recebido'], ['venc_proximo', 'Vencimento próximo'], ['credito_mesa', 'Crédito enviado à Mesa'], ['lote_validado', 'Lote validado ou recusado']],
    financiador: [['oportunidade', 'Oportunidade que cabe na política'], ['lance_superado', 'Lance superado'], ['pagamento_fazer', 'Pagamento a fazer'], ['liquidacao', 'Liquidação recebida'], ['vencida', 'Operação vencida'], ['fatura_ts', 'Fatura de TS emitida']],
    originador: [['indicado', 'Indicado cadastrado'], ['premiacao', 'Premiação apurada'], ['relatorio', 'Relatório disponível']],
    sacado: [['titulo_confirmar', 'Título para confirmar'], ['venc_proximo', 'Vencimento próximo'], ['cessao', 'Cessão do crédito']],
    ops: [['sla', 'SLA estourando'], ['caso_novo', 'Caso novo na Mesa'], ['proposta_agente', 'Proposta de agente'], ['kyc_novo', 'KYC novo para analisar']],
  };
  function notifPrefs(u) {
    u.notifPrefs = u.notifPrefs || {};
    u.notifPrefs.eventos = u.notifPrefs.eventos || {};
    (NOTIF_EVENTS[session.role()] || NOTIF_EVENTS.cedente).forEach(([id]) => { u.notifPrefs.eventos[id] = u.notifPrefs.eventos[id] || { email: true, push: true, wa: false }; });
    if (u.notifPrefs.digest === undefined) u.notifPrefs.digest = false;
    return u.notifPrefs;
  }
  function setNotif(u, ev, ch, v) { const p = notifPrefs(u); p.eventos[ev][ch] = v; db.patch('users', u.id, { notifPrefs: p }); }
  const HOURS = Array.from({ length: 24 }, (_, i) => { const t = String(i).padStart(2, '0') + ':00'; return { value: t, label: t }; });

  /* =====================================================================
     CONFIGURAÇÕES (todas as abas, ?aba= para deep link)
     ===================================================================== */
  const TABS = [
    { id: 'empresa', label: 'Empresa', icon: 'building-2', sub: 'Dados cadastrais, conta e regras da empresa nesta plataforma.' },
    { id: 'usuarios', label: 'Usuários e acessos', icon: 'users', sub: 'Quem pode entrar, com qual perfil, e a revisão semestral da lista.' },
    { id: 'seguranca', label: 'Segurança', icon: 'shield-check', sub: 'Seu acesso pessoal: perfil, senha, 2FA e sessões ativas.' },
    { id: 'notificacoes', label: 'Notificações', icon: 'bell', sub: 'O que você recebe, por qual canal e em qual horário.' },
    { id: 'preferencias', label: 'Preferências', icon: 'sliders-horizontal', sub: 'Tema, tabelas, menu e comportamento do protótipo.' },
    { id: 'integracoes', label: 'Integrações e agentes', icon: 'webhook', sub: 'Identidades de agente, tokens de API e webhooks.' },
  ];

  function renderConfig(ctx) {
    const role = ctx.role;
    const cur = TABS.find((t) => t.id === ctx.query.aba) || TABS[0];
    const builders = { empresa: tabEmpresa, usuarios: tabUsuarios, seguranca: tabSeguranca, notificacoes: tabNotifPrefs, preferencias: tabPrefs, integracoes: tabIntegracoes };
    return h('div.sh-page',
      ui.pageHeader({ eyebrow: 'Configurações', title: cur.label, subtitle: cur.sub }),
      h('div.sh-tabs', ui.tabs({ items: TABS.map(({ id, label, icon: ic }) => ({ id, label, icon: ic })), value: cur.id, onChange: (v) => C.router.go('/' + role + '/configuracoes?aba=' + v) })),
      builders[cur.id](ctx));
  }

  /* ------------------------------ aba Empresa ------------------------------ */
  function tabEmpresa(ctx) {
    const o = org(); const role = ctx.role; const ro = !isAdmin();
    const fNome = ui.input({ value: o.nome, disabled: ro });
    const fFant = ui.input({ value: o.fantasia, disabled: ro });
    const fCnpj = ui.input({ value: fmt.cnpj(o.cnpj), disabled: true });
    const fEnd = ui.input({ value: o.endereco || '', placeholder: 'Rua, número, bairro, cidade/UF', disabled: ro });
    const fTel = ui.input({ value: o.telefone || '', mask: 'phone', placeholder: '(11) 90000-0000', disabled: ro });
    const wNome = ui.field({ label: 'Razão social', required: true }, fNome);
    const wFant = ui.field({ label: 'Nome fantasia', required: true }, fFant);
    const wTel = ui.field({ label: 'Telefone', optional: true }, fTel);
    function salvar() {
      const nome = trim(fNome.value), fant = trim(fFant.value), tel = String(fTel.value).replace(/\D/g, '');
      wNome.setError(nome ? '' : 'Informe a razão social.');
      wFant.setError(fant ? '' : 'Informe o nome fantasia.');
      wTel.setError(tel && tel.length < 10 ? 'Telefone incompleto.' : '');
      if (!nome || !fant || (tel && tel.length < 10)) return;
      db.patch('orgs', o.id, { nome, fantasia: fant, endereco: trim(fEnd.value), telefone: trim(fTel.value) });
      log('org.dados_atualizados', `Dados da empresa atualizados: ${fant}`, 'R1');
      ui.toast('Dados salvos', { type: 'success', text: 'Alterações registradas na trilha.' });
    }
    const cards = [ui.card({ title: 'Dados da empresa', subtitle: ro ? 'Somente administradores editam.' : 'Salvo na hora, com registro na trilha (R1).', actions: ro ? null : [ui.btn('Salvar alterações', { variant: 'primary', onclick: salvar })] },
      ro ? readOnlyNote('estes dados') : null,
      ui.grid(2, wNome, wFant),
      ui.grid(2, ui.field({ label: 'CNPJ', hint: 'Não editável. Mudança de CNPJ exige novo cadastro.' }, fCnpj), wTel),
      ui.field({ label: 'Endereço', optional: true }, fEnd))];
    if (role === 'cedente') cards.push(cardContaLiquidacao(ro));
    if (role === 'financiador') cards.push(cardFinDados(ro));
    if (role === 'originador') cards.push(cardOrigConta(ro));
    if (role === 'sacado') cards.push(cardSacadoDados(ro));
    return h('div.stack', cards);
  }

  function cardContaLiquidacao(ro) {
    const o = org(); const c = o.contaLiquidacao || {};
    const fAg = ui.input({ value: c.agencia || '', placeholder: '0001', maxlength: 8, disabled: ro });
    const fCc = ui.input({ value: c.conta || '', placeholder: '123456-7', maxlength: 16, disabled: ro });
    const wAg = ui.field({ label: 'Agência', required: true }, fAg);
    const wCc = ui.field({ label: 'Conta', required: true }, fCc);
    const mandato = ui.switch({ label: 'Mandato de repasse ao financiador', hint: 'Somente leitura: o repasse acontece em até 1 dia útil após a conciliação, direto pela conta de liquidação.', checked: true, disabled: true });
    const lar = E.lar(o.id);
    function salvar() {
      wAg.setError(trim(fAg.value) ? '' : 'Informe a agência.');
      wCc.setError(trim(fCc.value) ? '' : 'Informe a conta.');
      if (!trim(fAg.value) || !trim(fCc.value)) return;
      db.patch('orgs', o.id, { contaLiquidacao: Object.assign({}, c, { banco: 'BMP (Money Plus)', agencia: trim(fAg.value), conta: trim(fCc.value) }) });
      log('org.conta_atualizada', 'Conta de liquidação atualizada', 'R1');
      ui.toast('Conta salva', { type: 'success', text: 'Usada para receber antecipações e pagar sacados.' });
    }
    return ui.card({ title: 'Conta de liquidação', subtitle: 'Banco parceiro BMP. A Cedy só lê o extrato desta conta; a movimentação é sua.', actions: ro ? null : [ui.btn('Salvar conta', { variant: 'primary', onclick: salvar })] },
      ui.callout({ tone: 'info', icon: 'landmark', title: 'A Cedy não custodia recursos', text: 'O financiador paga direto nesta conta. A plataforma apenas lê o extrato para conciliar.' }),
      ui.kv([['Banco', 'BMP (Money Plus)'], ['Titularidade', o.nome + ' (precisa ser o próprio cedente)']], { cols: 2 }),
      ui.grid(2, wAg, wCc), mandato, ui.divider(),
      h('h4', 'Limite de antecipação (LAR)'),
      lar ? ui.kv([['Fase', lar.fase === 'inicial' ? 'Inicial (baseada em faturamento)' : 'Por depósitos de sacados'], ['Limite', fmt.brl(lar.limite)], ['Em uso', fmt.brl(lar.exposicao)], ['Disponível', fmt.brl(lar.disponivel)], ['Faturamento anual', fmt.brl(o.faturamentoAnual || 0)], ['Prazo médio de recebimento', (o.prazoRecebimentoDias || 0) + ' dias']], { cols: 2 })
        : h('p.muted', 'LAR disponível apenas para cedentes.'));
  }

  function cardFinDados(ro) {
    const o = org();
    const sTipo = ui.select({ options: ['FIDC', 'Banco', 'Factoring', 'Securitizadora', 'ESC'].map((t) => ({ value: t, label: t })), value: o.tipo || 'FIDC', disabled: ro });
    const fReg = ui.input({ value: o.regulacao || '', placeholder: 'Ex.: CVM + gestora', disabled: ro });
    const fMail = ui.input({ value: o.emailCobranca || '', placeholder: 'cobranca@empresa.com.br', disabled: ro });
    const fAdm = ui.input({ value: o.adminNome || '', placeholder: 'Nome do administrador ou gestor', disabled: ro });
    const wMail = ui.field({ label: 'E-mail para boletos de TS', hint: 'As faturas mensais de taxa de serviço chegam aqui.', required: true }, fMail);
    function salvar() {
      wMail.setError(validEmail(fMail.value) ? '' : 'Informe um e-mail válido.'); if (!validEmail(fMail.value)) return;
      db.patch('orgs', o.id, { tipo: sTipo.value, regulacao: trim(fReg.value), emailCobranca: trim(fMail.value), adminNome: trim(fAdm.value) });
      log('org.dados_atualizados', 'Dados do financiador atualizados', 'R1');
      ui.toast('Dados salvos', { type: 'success' });
    }
    return ui.card({ title: 'Dados do financiador', actions: ro ? null : [ui.btn('Salvar', { variant: 'primary', onclick: salvar })] },
      ro ? readOnlyNote('estes dados') : null,
      ui.grid(2, ui.field({ label: 'Tipo' }, sTipo), ui.field({ label: 'Regulação', optional: true }, fReg)),
      wMail, ui.field({ label: 'Administrador ou gestor', optional: true }, fAdm));
  }

  function cardOrigConta(ro) {
    const o = org(); const c = o.contaPremiacao || {};
    const fBanco = ui.input({ value: c.banco || '', placeholder: 'Ex.: 341 Itaú', disabled: ro });
    const fAg = ui.input({ value: c.agencia || '', placeholder: '3201', disabled: ro });
    const fCc = ui.input({ value: c.conta || '', placeholder: '45871-0', disabled: ro });
    const wBanco = ui.field({ label: 'Banco', required: true }, fBanco);
    const wAg = ui.field({ label: 'Agência', required: true }, fAg);
    const wCc = ui.field({ label: 'Conta', required: true }, fCc);
    function salvar() {
      wBanco.setError(trim(fBanco.value) ? '' : 'Informe o banco.');
      wAg.setError(trim(fAg.value) ? '' : 'Informe a agência.');
      wCc.setError(trim(fCc.value) ? '' : 'Informe a conta.');
      if (!trim(fBanco.value) || !trim(fAg.value) || !trim(fCc.value)) return;
      db.patch('orgs', o.id, { contaPremiacao: { banco: trim(fBanco.value), agencia: trim(fAg.value), conta: trim(fCc.value), titularCnpj: true } });
      log('org.conta_atualizada', 'Conta de premiação atualizada', 'R1');
      ui.toast('Conta salva', { type: 'success' });
    }
    return ui.card({ title: 'Conta de premiação', subtitle: 'A premiação é paga na conta do mesmo CNPJ.', actions: ro ? null : [ui.btn('Salvar conta', { variant: 'primary', onclick: salvar })] },
      ui.callout({ tone: 'info', icon: 'info', text: 'Por regra fiscal, a premiação só pode ser paga em conta do mesmo CNPJ cadastrado.' }),
      ui.grid(3, wBanco, wAg, wCc));
  }

  function cardSacadoDados(ro) {
    const o = org();
    const fMail = ui.input({ value: o.emailAP || '', placeholder: 'contasapagar@empresa.com.br', disabled: ro });
    const fCc = ui.input({ value: o.centroCusto || '', placeholder: 'Ex.: CC-1042 Suprimentos', disabled: ro });
    const fInstr = ui.input({ type: 'textarea', value: o.instrucoesPagamento || '', placeholder: 'Ex.: pagar sempre por TED até as 16h, com o número da NF no histórico.', disabled: ro, rows: 3 });
    const wMail = ui.field({ label: 'E-mail do contas a pagar', hint: 'Lembretes de confirmação e vencimento vão para este e-mail.', required: true }, fMail);
    function salvar() {
      wMail.setError(validEmail(fMail.value) ? '' : 'Informe um e-mail válido.'); if (!validEmail(fMail.value)) return;
      db.patch('orgs', o.id, { emailAP: trim(fMail.value), centroCusto: trim(fCc.value), instrucoesPagamento: trim(fInstr.value) });
      log('org.dados_atualizados', 'Dados de pagamento do sacado atualizados', 'R1');
      ui.toast('Dados salvos', { type: 'success' });
    }
    return ui.card({ title: 'Dados de pagamento', actions: ro ? null : [ui.btn('Salvar', { variant: 'primary', onclick: salvar })] },
      ro ? readOnlyNote('estes dados') : null,
      ui.grid(2, wMail, ui.field({ label: 'Centro de custos', optional: true }, fCc)),
      ui.field({ label: 'Instruções de pagamento padrão', optional: true }, fInstr));
  }

  /* ------------------------- aba Usuários e acessos ------------------------- */
  const PERM_ROWS = [['ver', 'Ver dados'], ['operar', 'Operar (criar e editar)'], ['aceitar', 'Aceitar ofertas'], ['lance', 'Dar lances'], ['publicar', 'Publicar operações'], ['assinar', 'Assinar cessão'], ['pagar', 'Pagar e liquidar'], ['importar', 'Importar títulos'], ['admin', 'Administrar (usuários e conta)']];
  const PERM_BY_PERFIL = { admin: PERM_ROWS.map((r) => r[0]), operador: PERM_ROWS.map((r) => r[0]).filter((k) => k !== 'admin'), leitor: ['ver'] };
  const perfilBadge = (p) => ui.badge(perfilLabel(p), { admin: 'blue', operador: 'teal', leitor: 'neutral' }[p] || 'neutral');
  const orgUsers = (o) => db.where('users', (u) => u.orgId === o.id);
  const adminCount = (o) => orgUsers(o).filter((u) => u.perfil === 'admin' && u.status !== 'revogacao_agendada').length;

  function tabUsuarios() {
    const o = org(); const ro = !isAdmin();
    const banner = ui.live(['orgs'], () => db.get('orgs', o.id).revisaoUsuariosEm
      ? ui.callout({ tone: 'success', icon: 'circle-check', title: 'Revisão semestral em dia', text: 'Última confirmação em ' + fmt.date(db.get('orgs', o.id).revisaoUsuariosEm) + '.' })
      : ui.callout({ tone: 'warn', icon: 'triangle-alert', title: 'Revisão semestral da lista de usuários: prazo 31/12/2026',
        text: 'Confirme que todas as pessoas da lista ainda precisam de acesso. Saídas e trocas de função devem revogar o acesso.',
        actions: ro ? null : [ui.btn('Confirmar revisão', { variant: 'primary', size: 'sm', onclick: () => {
          db.patch('orgs', o.id, { revisaoUsuariosEm: C.clock.now() });
          log('org.revisao_usuarios', 'Revisão semestral da lista de usuários confirmada', 'R1');
          ui.toast('Revisão confirmada', { type: 'success', text: 'Registrada na trilha com data e responsável.' });
        } })] }));
    const table = ui.live(['users'], () => {
      const rows = orgUsers(o).slice().sort((a, b) => (a.perfil === 'admin' ? 0 : 1) - (b.perfil === 'admin' ? 0 : 1) || a.nome.localeCompare(b.nome));
      const agendada = (u) => u.status === 'revogacao_agendada';
      return ui.table({ rows, rowKey: (u) => u.id,
        columns: [
          { key: 'nome', label: 'Usuário', mobile: 'primary', render: (u) => h('div.cell-row', ui.avatar(u.nome, { hue: u.hue, size: 'sm' }), h('div.cell-main', h('strong', u.nome), h('small', u.email))) },
          { key: 'cargo', label: 'Cargo', mobile: 'hide', class: 'sh-col-cargo', render: (u) => u.cargo || '—' },
          { key: 'perfil', label: 'Perfil', render: (u) => perfilBadge(u.perfil) },
          { key: 'twofa', label: '2FA', render: (u) => u.twofa ? ui.badge('Ativo', 'green', { dot: true }) : ui.badge('Pendente', 'amber', { dot: true, title: 'Todo usuário precisa de 2FA ativo' }) },
          { key: 'acesso', label: 'Último acesso', mobile: 'hide', class: 'sh-col-acesso', render: (u) => h('span.muted.small', u.ultimoAcesso ? fmt.rel(u.ultimoAcesso) : 'nunca') },
          { key: 'st', label: 'Situação', mobile: 'hide', render: (u) => agendada(u) ? ui.badge('Revogação agendada', 'amber', { dot: true, title: 'Acesso revogado em 1 dia útil' }) : ui.badge('Ativo', 'green', { dot: true }) },
          { key: 'acoes', label: 'Ações', mobile: ro ? 'hide' : undefined, class: 'ta-right', render: (u) => ro ? h('span') : ui.moreMenu([
            { header: u.nome },
            { label: 'Mudar para administrador', icon: 'shield-check', disabled: u.perfil === 'admin' || agendada(u), onclick: () => changePerfil(o, u, 'admin') },
            { label: 'Mudar para operador', icon: 'briefcase', disabled: u.perfil === 'operador' || agendada(u), onclick: () => changePerfil(o, u, 'operador') },
            { label: 'Mudar para leitor', icon: 'eye', disabled: u.perfil === 'leitor' || agendada(u), onclick: () => changePerfil(o, u, 'leitor') },
            { divider: true },
            { label: 'Redefinir 2FA', icon: 'key-round', disabled: agendada(u), onclick: () => { db.patch('users', u.id, { twofa: false }); log('usuario.2fa_reset', `2FA de ${u.nome} redefinido`, 'R1', { kind: 'user', id: u.id }); ui.toast('2FA redefinido', { type: 'info', text: u.nome + ' precisará configurar de novo no próximo acesso.' }); } },
            { label: 'Revogar acesso', icon: 'ban', danger: true, disabled: agendada(u) || u.id === me().id, hint: u.id === me().id ? 'você mesmo' : 'efetivo em 1 dia útil', onclick: () => revokeUser(o, u) },
          ], { label: 'Ações de ' + u.nome }) },
        ], empty: ui.empty({ icon: 'users', title: 'Nenhum usuário', text: 'Convide a primeira pessoa da empresa.' }) });
    });
    return h('div.stack', ro ? readOnlyNote('a lista (alterações são de administradores)') : null, banner,
      ui.card({ title: 'Usuários da empresa', subtitle: 'De 1 a 3 administradores por empresa. Todo usuário precisa de 2FA.',
        actions: ro ? null : [ui.btn('Convidar usuário', { variant: 'primary', icon: 'user-plus', onclick: () => inviteModal(o) })] }, table),
      ui.card({ title: 'O que cada perfil pode fazer' }, permMatrix()));
  }

  function permMatrix() {
    return h('div.tbl-wrap', h('div.tbl-scroll', h('table.tbl.sh-matrix', h('thead', h('tr', h('th', 'Permissão'), h('th', 'Administrador'), h('th', 'Operador'), h('th', 'Leitor'))),
      h('tbody', PERM_ROWS.map(([k, lab]) => h('tr', h('td', lab),
        ['admin', 'operador', 'leitor'].map((p) => h('td', { 'aria-label': PERM_BY_PERFIL[p].includes(k) ? 'Permitido' : 'Não permitido' }, PERM_BY_PERFIL[p].includes(k) ? h('span.sh-yes', icon('check', 15)) : h('span.muted', '—')))))))));
  }

  function changePerfil(o, u, novo) {
    if (!needAdmin()) return;
    if (novo === 'admin' && adminCount(o) >= 3 && u.perfil !== 'admin') { ui.toast('Limite de administradores', { type: 'error', text: 'A empresa já tem 3 administradores. Rebaixe alguém antes de promover ' + u.nome + '.' }); return; }
    if (u.perfil === 'admin' && novo !== 'admin' && adminCount(o) <= 1) { ui.toast('Não é possível', { type: 'error', text: 'Toda empresa precisa de ao menos 1 administrador. Promova outra pessoa antes.' }); return; }
    db.patch('users', u.id, { perfil: novo });
    log('usuario.perfil_alterado', `Perfil de ${u.nome} alterado para ${perfilLabel(novo).toLowerCase()}`, 'R1', { kind: 'user', id: u.id });
    ui.toast('Perfil atualizado', { type: 'success', text: `${u.nome} agora é ${perfilLabel(novo).toLowerCase()}.` });
  }

  async function revokeUser(o, u) {
    if (!needAdmin()) return;
    if (u.perfil === 'admin' && adminCount(o) <= 1) { ui.toast('Não é possível', { type: 'error', text: 'Toda empresa precisa de ao menos 1 administrador ativo.' }); return; }
    const okk = await ui.confirm({ title: 'Revogar acesso de ' + u.nome + '?', icon: 'ban', tone: 'danger', confirmLabel: 'Agendar revogação',
      text: 'A revogação passa a valer em 1 dia útil. Até lá, o acesso continua com 2FA obrigatório. A pessoa sai da lista de revisão e o evento fica na trilha.' });
    if (!okk) return;
    db.patch('users', u.id, { status: 'revogacao_agendada', revogadoEm: C.cal.addUteis(C.clock.now(), 1) });
    log('usuario.revogacao_agendada', `Acesso de ${u.nome} com revogação agendada (1 dia útil)`, 'R1', { kind: 'user', id: u.id });
    ui.toast('Revogação agendada', { type: 'warn', text: 'Efetiva em 1 dia útil.' });
  }

  function inviteModal(o) {
    if (!needAdmin()) return;
    const fMail = ui.input({ type: 'email', placeholder: 'nome@empresa.com.br' });
    const fNome = ui.input({ placeholder: 'Nome completo' });
    const fCargo = ui.input({ placeholder: 'Ex.: Analista financeiro' });
    const sPerfil = ui.select({ options: [{ value: 'operador', label: 'Operador', hint: 'Opera, publica, assina' }, { value: 'admin', label: 'Administrador', hint: 'Tudo, inclui usuários' }, { value: 'leitor', label: 'Leitor', hint: 'Somente leitura' }], value: 'operador' });
    const wMail = ui.field({ label: 'E-mail corporativo', required: true }, fMail);
    const wNome = ui.field({ label: 'Nome', required: true }, fNome);
    ui.modal({ title: 'Convidar usuário', icon: 'user-plus', size: 'md',
      body: h('div.stack.tight', ui.grid(2, wNome, ui.field({ label: 'Cargo', optional: true }, fCargo)), wMail, ui.field({ label: 'Perfil' }, sPerfil),
        h('h4.sh-sub', 'O que cada perfil pode fazer'), permMatrix(),
        ui.callout({ tone: 'info', icon: 'info', text: 'O convite exige 2FA no primeiro acesso. Revogações passam a valer em 1 dia útil.' })),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Enviar convite', { variant: 'primary', onclick: () => {
        wMail.setError(validEmail(fMail.value) ? '' : 'Informe um e-mail corporativo válido.');
        wNome.setError(trim(fNome.value) ? '' : 'Informe o nome.');
        if (!validEmail(fMail.value) || !trim(fNome.value)) return;
        if (db.all('users').some((x) => String(x.email).toLowerCase() === trim(fMail.value).toLowerCase())) { wMail.setError('Este e-mail já tem conta na Cedy.'); return; }
        if (sPerfil.value === 'admin' && adminCount(o) >= 3) { ui.toast('Limite de administradores', { type: 'error', text: 'A empresa já tem 3 administradores.' }); return; }
        const id = C.uid('u'); const nome = trim(fNome.value);
        db.put('users', { id, nome, email: trim(fMail.value), cargo: trim(fCargo.value), orgId: o.id, perfil: sPerfil.value, demo: false, twofa: false, ultimoAcesso: null, telefone: '' });
        log('usuario.convidado', `Convite enviado para ${nome} (${perfilLabel(sPerfil.value).toLowerCase()})`, 'R1', { kind: 'user', id });
        ui.toast('Convite enviado', { type: 'success', text: '2FA obrigatório no primeiro acesso.' });
        api.close(true);
      } })] });
  }

  /* ------------------------------ aba Segurança ------------------------------ */
  function tabSeguranca() {
    const u = me();
    const fNome = ui.input({ value: u.nome });
    const fMail = ui.input({ type: 'email', value: u.email });
    const fTel = ui.input({ mask: 'phone', value: u.telefone || '', placeholder: '(11) 90000-0000' });
    const wNome = ui.field({ label: 'Nome' }, fNome);
    const wMail = ui.field({ label: 'E-mail', required: true }, fMail);
    function salvar() {
      wMail.setError(validEmail(fMail.value) ? '' : 'Informe um e-mail válido.'); if (!validEmail(fMail.value)) return;
      db.patch('users', u.id, { nome: trim(fNome.value) || u.nome, email: trim(fMail.value), telefone: trim(fTel.value) });
      ui.toast('Perfil salvo', { type: 'success' });
    }
    const roleTxt = perfilLabel(u.perfil) + (session.role() === 'ops' ? ' · Mesa Cedy' : '');
    const prof = ui.card({ title: 'Meu perfil', subtitle: 'Dados usados para identificar você na trilha de decisões.', actions: [ui.btn('Salvar', { variant: 'primary', onclick: salvar })] },
      ui.grid(2, wNome, wMail),
      ui.grid(2, ui.field({ label: 'Telefone', optional: true }, fTel), ui.field({ label: 'Perfil na empresa' }, ui.input({ value: roleTxt, disabled: true }))));
    const sec = ui.live(['users'], () => {
      const cur = db.get('users', u.id);
      return h('div.stack',
        ui.card({ title: 'Senha e verificação em 2 etapas', subtitle: 'Obrigatórias para todos os usuários da plataforma.' },
          prefRow('Senha', 'Mínimo de 8 caracteres, com número e letra.', ui.btn('Trocar senha', { variant: 'secondary', icon: 'key-round', onclick: () => pwdModal(cur) })),
          prefRow(h('span.row', 'Verificação em 2 etapas', cur.twofa ? ui.badge('Ativa', 'green', { dot: true }) : ui.badge('Pendente', 'amber', { dot: true })), cur.twofa ? 'Código de demonstração: 123456. Perdeu o acesso? Um administrador pode redefinir seu 2FA.' : 'Sua conta fica sinalizada em âmbar para os administradores até você ativar.',
            ui.btn(cur.twofa ? 'Reconfigurar' : 'Ativar', { variant: cur.twofa ? 'secondary' : 'primary', icon: 'smartphone', onclick: () => mfaModal(cur) }))),
        cardSessions(cur), cardSecEvents(cur));
    });
    return h('div.stack', prof, sec);
  }

  function pwdModal(u) {
    const f1 = ui.input({ type: 'password', placeholder: 'Nova senha', autocomplete: 'new-password' });
    const f2 = ui.input({ type: 'password', placeholder: 'Repita a nova senha', autocomplete: 'new-password' });
    const bar = ui.progress(0, { thin: true });
    const lab = h('small.muted', 'Força: —');
    const w1 = ui.field({ label: 'Nova senha' }, f1);
    const w2 = ui.field({ label: 'Confirmação' }, f2);
    const score = (v) => (v.length >= 8 ? 25 : 0) + (v.length >= 12 ? 25 : 0) + (/[0-9]/.test(v) ? 25 : 0) + (/[^a-zA-Z0-9]/.test(v) ? 25 : 0);
    f1.addEventListener('change', () => { const s = score(f1.value); bar.firstChild.style.width = s + '%'; bar.setAttribute('aria-valuenow', s); lab.textContent = 'Força: ' + (s < 50 ? 'fraca' : s < 75 ? 'razoável' : 'forte'); });
    ui.modal({ title: 'Trocar senha', icon: 'key-round', size: 'sm',
      body: h('div.stack.tight', w1, h('div.sh-strength', bar, lab), w2),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Salvar senha', { variant: 'primary', onclick: () => {
        const v = f1.value; const s = score(v);
        w1.setError(v.length < 8 ? 'Mínimo de 8 caracteres.' : !/[0-9]/.test(v) ? 'Inclua ao menos um número.' : !/[a-zA-Z]/.test(v) ? 'Inclua ao menos uma letra.' : '');
        if (v.length < 8 || !/[0-9]/.test(v) || !/[a-zA-Z]/.test(v)) return;
        w2.setError(v !== f2.value ? 'As senhas não conferem.' : ''); if (v !== f2.value) return;
        log('usuario.senha_trocada', 'Senha alterada (' + (s >= 75 ? 'forte' : 'razoável') + ')', 'R1', { kind: 'user', id: u.id });
        ui.toast('Senha atualizada', { type: 'success' }); api.close(true);
      } })] });
  }

  function qrSvg(seedStr) {
    const r = C.rng([...seedStr].reduce((a, c) => a + c.charCodeAt(0) * 31, 7));
    const n = 21, s = 8, cells = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const finder = (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
      if (!finder && r() > 0.52) cells.push(h('rect', { x: x * s, y: y * s, width: s - 0.5, height: s - 0.5 }));
    }
    const finderSq = (ox, oy) => [h('rect', { x: ox + 1, y: oy + 1, width: 7 * s - 2, height: 7 * s - 2, style: 'fill:none;stroke:currentColor;stroke-width:2' }), h('rect', { x: ox + 2 * s, y: oy + 2 * s, width: 3 * s, height: 3 * s })];
    return h('svg', { viewBox: `0 0 ${n * s} ${n * s}`, width: 168, height: 168, role: 'img', 'aria-label': 'QR de configuração do 2FA' }, cells, finderSq(0, 0), finderSq((n - 7) * s, 0), finderSq(0, (n - 7) * s));
  }

  function mfaModal(u) {
    const fCode = ui.input({ mask: 'otp', placeholder: '123456', maxlength: 6 });
    const wCode = ui.field({ label: 'Código de 6 dígitos', hint: 'Demonstração: use 123456.', required: true }, fCode);
    ui.modal({ title: 'Configurar 2FA', icon: 'smartphone', subtitle: 'Escaneie com o app autenticador e confirme.', size: 'sm',
      body: h('div.stack.tight', h('div.sh-qr', qrSvg(u.id + (u.email || ''))), h('p.small.muted', 'Ou digite a chave: ', h('span.mono.strong', 'CEDY ' + String(u.id).toUpperCase().slice(-6))), wCode),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Confirmar e ativar', { variant: 'primary', onclick: () => {
        const ok = trim(fCode.value) === '123456';
        wCode.setError(ok ? '' : 'Código inválido. Na demonstração, use 123456.'); if (!ok) return;
        db.patch('users', u.id, { twofa: true });
        log('usuario.2fa_ativado', '2FA (re)configurado', 'R1', { kind: 'user', id: u.id });
        ui.toast('2FA ativo', { type: 'success', text: 'Conta protegida com segunda etapa.' }); api.close(true);
      } })] });
  }

  function sessionsOf(u) {
    if (Array.isArray(u.sessoes) && u.sessoes.length) return u.sessoes;
    const now = C.clock.now();
    return [
      { id: 's-atual', dispositivo: 'Este navegador', navegador: 'Chrome', cidade: 'São Paulo/SP', vistoEm: now, atual: true },
      { id: 's-cel', dispositivo: 'Celular Android', navegador: 'App Cedy', cidade: 'São Paulo/SP', vistoEm: now - 5 * 3600e3 },
      { id: 's-casa', dispositivo: 'Notebook pessoal', navegador: 'Firefox', cidade: 'São Paulo/SP', vistoEm: now - 2 * 86400000 },
    ];
  }
  function cardSessions(u0) {
    return ui.live(['users'], () => {
      const cur = db.get('users', u0.id); const ls = sessionsOf(cur);
      return ui.card({ title: 'Sessões ativas', subtitle: fmt.plural(ls.length, 'dispositivo com acesso', 'dispositivos com acesso') + '.',
        actions: ls.length > 1 ? [ui.btn('Encerrar todas as outras', { variant: 'ghost', size: 'sm', onclick: async () => {
          if (!(await ui.confirm({ title: 'Encerrar outras sessões?', text: 'Todos os outros dispositivos perdem o acesso na hora.', tone: 'danger', confirmLabel: 'Encerrar' }))) return;
          db.patch('users', cur.id, { sessoes: ls.filter((s) => s.atual) }); ui.toast('Outras sessões encerradas', { type: 'success' });
        } })] : null },
        h('div.sh-sess-list', ls.map((s) => h('div.sh-sess', h('span.sh-sess-ic', icon(s.dispositivo.includes('Celular') ? 'smartphone' : 'monitor', 18)),
          h('div.grow', h('strong', s.dispositivo + (s.atual ? ' (atual)' : '')), h('div.small.muted', `${s.navegador} · ${s.cidade} · visto ${fmt.rel(s.vistoEm)}`)),
          s.atual ? ui.badge('Atual', 'blue') : ui.btn('Encerrar', { variant: 'ghost', size: 'sm', onclick: () => { db.patch('users', cur.id, { sessoes: ls.filter((x) => x.id !== s.id) }); ui.toast('Sessão encerrada', { type: 'info' }); } })))));
    });
  }

  function cardSecEvents(u) {
    const evs = ledger.all().filter((e) => e.actor && e.actor.id === u.id).slice(-8).reverse();
    const now = C.clock.now();
    const items = evs.length ? evs.map((e) => ({ icon: 'circle', title: e.resumo, ts: e.ts, actor: F.actorLabel(e.actor) }))
      : [{ icon: 'key-round', title: 'Login com 2FA neste dispositivo', ts: now - 2 * 3600e3, actor: 'Você' }, { icon: 'key-round', title: 'Senha criada no convite', ts: (u.ultimoAcesso || now) - 86400000, actor: 'Sistema' }];
    return ui.card({ title: 'Eventos recentes de segurança', subtitle: 'Da trilha de decisões, filtrados por você.' }, ui.timeline(items));
  }

  /* ----------------------- aba Notificações (preferências) ----------------------- */
  function tabNotifPrefs(ctx) {
    const u = me();
    const evs = NOTIF_EVENTS[ctx.role] || NOTIF_EVENTS.cedente;
    const matrix = ui.live(['users'], () => {
      const cur = db.get('users', u.id); const p = notifPrefs(cur);
      const rows = evs.map(([id, lab]) => {
        const st = p.eventos[id];
        const sw = (ch, nome) => h('td', ui.switch({ aria: `${lab}, ${nome}`, checked: !!st[ch], onChange: (v) => setNotif(cur, id, ch, v) }));
        return h('tr', h('td', lab), sw('email', 'e-mail'), sw('push', 'push'), sw('wa', 'WhatsApp'));
      });
      return h('div.tbl-wrap', h('div.tbl-scroll', h('table.tbl.sh-matrix', h('thead', h('tr', h('th', 'Evento'), h('th', 'E-mail'), h('th', 'Push'), h('th', 'WhatsApp'))), h('tbody', rows))));
    });
    const p0 = notifPrefs(u);
    const saveQuiet = (k, v) => { const p = notifPrefs(db.get('users', u.id)); p[k] = v; db.patch('users', u.id, { notifPrefs: p }); ui.toast('Horário de silêncio salvo', { type: 'success' }); };
    const sFrom = ui.select({ options: HOURS, value: p0.quietFrom || '22:00', aria: 'Silenciar a partir de', onChange: (v) => saveQuiet('quietFrom', v) });
    const sTo = ui.select({ options: HOURS, value: p0.quietTo || '07:00', aria: 'Voltar a avisar às', onChange: (v) => saveQuiet('quietTo', v) });
    const digest = ui.switch({ aria: 'Resumo diário', checked: !!p0.digest,
      onChange: (v) => { const p = notifPrefs(db.get('users', u.id)); p.digest = v; db.patch('users', u.id, { notifPrefs: p }); ui.toast(v ? 'Resumo diário ativado' : 'Resumo diário desativado', { type: 'success' }); } });
    return h('div.stack',
      ui.card({ title: 'Eventos e canais', subtitle: 'Escolha onde receber cada aviso. A alteração vale na hora.' }, matrix),
      ui.card({ title: 'Horário de silêncio', subtitle: 'Avisos push e WhatsApp esperam até o fim do silêncio. E-mails continuam chegando.' },
        ui.grid(2, ui.field({ label: 'Silenciar a partir de' }, sFrom), ui.field({ label: 'Voltar a avisar às' }, sTo))),
      ui.card({ title: 'Resumo' }, prefRow('Resumo diário', 'Um e-mail por manhã com tudo do dia anterior, em vez de avisos avulsos fora do horário comercial.', digest)));
  }

  /* ----------------------------- aba Preferências ----------------------------- */
  const density = () => (db.state && db.state.densidade) || 'confortavel';
  function setDensity(v) { db.state.densidade = v; document.documentElement.dataset.density = v; }
  function tabPrefs(ctx) {
    const segTema = ui.segmented({ aria: 'Tema', value: prefs.theme, options: [{ value: 'light', label: 'Claro', icon: 'sun' }, { value: 'dark', label: 'Escuro', icon: 'moon' }, { value: 'auto', label: 'Automático', icon: 'monitor' }],
      onChange: (v) => { prefs.setTheme(v); ui.toast('Tema ' + ({ light: 'claro', dark: 'escuro', auto: 'automático' }[v]), { type: 'success' }); } });
    const segDens = ui.segmented({ aria: 'Densidade da tabela', value: density(), options: [{ value: 'confortavel', label: 'Confortável' }, { value: 'compacta', label: 'Compacta' }],
      onChange: (v) => { setDensity(v); ui.toast('Tabelas ' + (v === 'compacta' ? 'compactas' : 'confortáveis'), { type: 'success' }); } });
    const swMenu = ui.switch({ aria: 'Menu lateral recolhido por padrão', checked: prefs.collapsed, onChange: (v) => prefs.setCollapsed(v) });
    const swMerc = ui.switch({ aria: 'Mercado simulado', checked: prefs.market, onChange: (v) => prefs.setMarket(v) });
    const sIdioma = ui.select({ options: [{ value: 'pt-BR', label: 'Português (Brasil)' }], value: 'pt-BR', disabled: true, aria: 'Idioma' });
    const out = [
      ui.card({ title: 'Aparência e tabelas' },
        prefRow('Tema', 'Claro, escuro ou o do seu sistema.', segTema),
        prefRow('Densidade da tabela', 'Compacta mostra mais linhas por tela.', segDens),
        prefRow('Menu lateral recolhido', 'Vale para o próximo acesso neste navegador.', swMenu)),
      ui.card({ title: 'Protótipo', subtitle: 'Opções que só existem na demonstração.' },
        prefRow('Mercado simulado', 'Outros financiadores cobrem ofertas abertas sozinhos. Desligue para dar cada lance à mão.', swMerc),
        prefRow('Idioma', 'O protótipo só fala português.', h('div.sh-pref-sel', sIdioma)))];
    if (ctx.role === 'cedente') out.push(cardMercado());
    return h('div.stack', out);
  }

  function cardMercado() {
    const o = org();
    const fins = db.where('orgs', (x) => x.kind === 'financiador' && x.status === 'ativo');
    if (!Array.isArray(o.favoritos) || !Array.isArray(o.bloqueados)) db.patch('orgs', o.id, { favoritos: o.favoritos || [], bloqueados: o.bloqueados || [] });
    const nome = (f) => f.fantasia || f.nome;
    const rows = ui.live(['orgs'], () => {
      const cur = db.get('orgs', o.id);
      return ui.table({ rows: fins, rowKey: (f) => f.id,
        columns: [
          { key: 'f', label: 'Financiador', mobile: 'primary', render: (f) => F.orgCell(f) },
          { key: 'fav', label: 'Favorito', render: (f) => ui.switch({ aria: 'Favoritar ' + nome(f), checked: (cur.favoritos || []).includes(f.id), onChange: (v) => {
            const arr = (cur.favoritos || []).filter((id) => id !== f.id); if (v) arr.push(f.id);
            db.patch('orgs', o.id, { favoritos: arr }); ui.toast(v ? 'Marcado como favorito' : 'Favorito removido', { type: 'success' });
          } }) },
          { key: 'bloq', label: 'Bloquear', render: (f) => { const sw = ui.switch({ aria: 'Bloquear ' + nome(f), checked: (cur.bloqueados || []).includes(f.id), onChange: async (v) => {
            const arr = (cur.bloqueados || []).filter((id) => id !== f.id);
            if (v) {
              if (!(await ui.confirm({ title: 'Bloquear ' + nome(f) + '?', text: 'Ele não vê mais as suas operações e o motor recusa os lances dele. Vale na hora.', tone: 'danger', confirmLabel: 'Bloquear' }))) { sw.value = false; return; }
              arr.push(f.id);
              log('org.financiador_bloqueado', `Financiador ${nome(f)} bloqueado`, 'R2');
            }
            db.patch('orgs', o.id, { bloqueados: arr });
            ui.toast(v ? 'Financiador bloqueado' : 'Bloqueio removido', { type: v ? 'warn' : 'success' });
          } }); return sw; } },
        ], empty: ui.empty({ icon: 'landmark', title: 'Sem financiadores ativos' }) });
    });
    return ui.card({ title: 'Mercado: favoritos e bloqueios', subtitle: 'Bloqueados não participam dos seus leilões (o motor já aplica).' },
      ui.callout({ tone: 'info', icon: 'info', text: 'Favorito só organiza a sua visão. Bloqueio é sério: use para conflito comercial ou descumprimento.' }), rows);
  }

  /* ------------------------ aba Integrações e agentes ------------------------ */
  const integAll = (o) => db.where('integracoes', (x) => x.orgId === o.id);
  function ensureIntegSeed(o) {
    if (integAll(o).length) return;
    db.batch(() => {
      db.put('integracoes', { id: C.uid('in'), orgId: o.id, kind: 'agente', nome: 'Agente de conciliação da empresa', escopos: ['leitura', 'operar_aprovado'], status: 'ativo', criadoEm: C.clock.now() - 20 * 86400000, ultimoUso: C.clock.now() - 3 * 3600e3 });
      db.put('integracoes', { id: C.uid('in'), orgId: o.id, kind: 'webhook', nome: 'ERP', url: 'https://erp.exemplo.com.br/cedy', eventos: ['operacao.paga', 'titulo.liquidado'], status: 'ativo', criadoEm: C.clock.now() - 40 * 86400000, ultimoUso: C.clock.now() - 26 * 3600e3 });
    });
  }
  const SCOPE_LABEL = { leitura: 'Leitura (ver dados)', operar_aprovado: 'Operar com aprovação humana' };
  function tabIntegracoes() {
    const o = org(); const ro = !isAdmin();
    ensureIntegSeed(o);
    const tbl = ui.live(['integracoes'], () => ui.table({ rows: integAll(o), rowKey: (r) => r.id,
      columns: [
        { key: 'nome', label: 'Credencial', mobile: 'primary', render: (r) => h('div.cell-row', icon(r.kind === 'agente' ? 'bot' : r.kind === 'webhook' ? 'webhook' : 'key-round', 16), h('div.cell-main', h('strong', r.nome), h('small', r.kind === 'agente' ? 'Identidade de agente' : r.kind === 'webhook' ? r.url : 'Token de API'))) },
        { key: 'esc', label: 'Escopos', mobile: 'hide', render: (r) => (r.escopos || r.eventos || []).map((e) => SCOPE_LABEL[e] || e).join(', ') || '—' },
        { key: 'uso', label: 'Último uso', mobile: 'hide', render: (r) => h('span.muted.small', r.ultimoUso ? fmt.rel(r.ultimoUso) : 'nunca') },
        { key: 'st', label: 'Situação', render: (r) => ui.badge(r.status === 'ativo' ? 'Ativo' : 'Revogado', r.status === 'ativo' ? 'green' : 'neutral', { dot: true }) },
        { key: 'a', label: 'Ações', mobile: ro ? 'hide' : undefined, class: 'ta-right', render: (r) => ro || r.status !== 'ativo' ? h('span') : h('div.row.nowrap', r.kind === 'webhook' && ui.btn('Testar', { variant: 'secondary', size: 'sm', onclick: () => testWebhook(r) }), ui.btn('Revogar', { variant: 'ghost', size: 'sm', onclick: () => revokeInteg(r) })) },
      ], empty: ui.empty({ icon: 'webhook', title: 'Sem credenciais', text: 'Crie uma identidade de agente para automatizar.' }) }));
    return h('div.stack',
      ui.callout({ tone: 'ai', icon: 'sparkles', title: 'Uma camada de ferramenta: API + MCP', text: 'Automação por scripts ou agentes usa uma identidade de agente separada, nunca a credencial de uma pessoa. Dinheiro e cessão exigem pessoa com certificado (classe R3).' }),
      ui.card({ title: 'Credenciais e webhooks', subtitle: ro ? 'Somente administradores criam ou revogam.' : 'Tokens aparecem uma vez, na criação.',
        actions: ro ? null : [ui.btn('Criar credencial de agente', { variant: 'primary', icon: 'plus', onclick: () => integModal(o) }), ui.btn('Novo webhook', { variant: 'secondary', icon: 'webhook', onclick: () => webhookModal(o) })] },
        ro ? readOnlyNote('estas credenciais') : null, tbl),
      ui.card({ title: 'Referência da API (protótipo)', subtitle: 'Documentação resumida para integrar o ERP.' },
        ui.kv([['GET /operacoes', 'Lista operações da empresa, com status e melhor lance'], ['POST /titulos/importar', 'Envia XML ou PDF de NF-e para a fila de validação'], ['GET /extrato?conta=liquidacao', 'Lê as linhas da conta de liquidação já conciliadas'], ['POST /webhooks', 'Cadastra URL para eventos (operacao.paga, titulo.liquidado)']].map(([k, v]) => [h('span.mono', k), v])),
        ui.callout({ tone: 'info', icon: 'info', title: 'Limites [INFERÊNCIA]', text: '100 requisições por minuto por token, 1.000 por hora. Respostas em até 2 s no protótipo.' })));
  }

  function integModal(o) {
    const fNome = ui.input({ placeholder: 'Ex.: robô do financeiro' });
    const cRead = ui.checkbox({ label: 'Leitura (ver dados)', checked: true, disabled: true });
    const cOp = ui.checkbox({ label: 'Operar com aprovação humana', hint: 'A IA propõe, uma pessoa aprova.', checked: false });
    const cMoney = ui.checkbox({ label: 'Movimentar dinheiro', hint: 'Desabilitado: dinheiro e cessão exigem pessoa (classe R3).', checked: false, disabled: true });
    const wNome = ui.field({ label: 'Nome da identidade', required: true }, fNome);
    ui.modal({ title: 'Criar credencial de agente', icon: 'bot', size: 'sm',
      body: h('div.stack.tight', wNome, ui.field({ label: 'Escopos' }, h('div.stack.tight', cRead, cOp, cMoney))),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Criar', { variant: 'primary', onclick: () => {
        wNome.setError(trim(fNome.value) ? '' : 'Dê um nome para a identidade.'); if (!trim(fNome.value)) return;
        const token = 'cedy_' + C.uid('tk').replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
        const rec = db.put('integracoes', { id: C.uid('in'), orgId: o.id, kind: 'agente', nome: trim(fNome.value), escopos: ['leitura'].concat(cOp.value ? ['operar_aprovado'] : []), status: 'ativo', criadoEm: C.clock.now(), ultimoUso: null });
        log('integracao.criada', `Credencial de agente criada: ${rec.nome}`, 'R1', { kind: 'integracao', id: rec.id });
        api.close(true);
        const copiar = () => {
          const done = () => ui.toast('Token copiado', { type: 'success', text: 'Guarde agora: ele não aparece de novo.' });
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(token).then(done, () => fallbackCopy(token, done)); else fallbackCopy(token, done);
        };
        ui.modal({ title: 'Token criado (aparece uma vez)', icon: 'key-round', size: 'sm',
          body: h('div.stack.tight', ui.callout({ tone: 'warn', icon: 'triangle-alert', text: 'Copie agora. Depois de fechar, só é possível revogar e criar outro.' }), h('div.sh-token-box', h('code.mono.small', token), ui.btn('Copiar', { variant: 'secondary', size: 'sm', icon: 'copy', onclick: copiar }))),
          footer: (ap) => [ui.btn('Fechar', { variant: 'primary', onclick: () => ap.close() })] });
      } })] });
  }
  function fallbackCopy(text, done) {
    try { const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
    catch (e) { ui.toast('Copie manualmente', { type: 'warn', text }); }
  }
  async function revokeInteg(r) {
    if (!(await ui.confirm({ title: 'Revogar ' + r.nome + '?', text: 'Chamadas com esta credencial passam a falhar na hora.', tone: 'danger', confirmLabel: 'Revogar' }))) return;
    db.patch('integracoes', r.id, { status: 'revogado' });
    log('integracao.revogada', `Credencial revogada: ${r.nome}`, 'R1', { kind: 'integracao', id: r.id });
    ui.toast('Credencial revogada', { type: 'warn' });
  }
  function testWebhook(r) {
    const sample = { evento: 'operacao.paga', operacao: 'OP-26-0443', valor: 182340.55, conta: 'BMP 0001/482103-4', em: fmt.datetime(C.clock.now()) };
    db.patch('integracoes', r.id, { ultimoUso: C.clock.now() });
    ui.toast('Webhook testado', { type: 'success', text: 'Evento de exemplo enviado para ' + r.url });
    ui.drawer({ title: 'Resposta do teste', icon: 'webhook', size: 'sm', body: h('div.stack.tight', h('p.small.muted', 'POST ' + r.url), h('pre.sh-json', h('code', JSON.stringify(sample, null, 2)))) });
  }
  function webhookModal(o) {
    const fUrl = ui.input({ placeholder: 'https://erp.empresa.com.br/cedy' });
    const wUrl = ui.field({ label: 'URL', required: true }, fUrl);
    ui.modal({ title: 'Novo webhook', icon: 'webhook', size: 'sm',
      body: h('div.stack.tight', wUrl, ui.field({ label: 'Eventos' }, h('p.small.muted', 'operacao.paga, titulo.liquidado, operacao.vencida (fixo no protótipo)'))),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Salvar', { variant: 'primary', onclick: () => {
        const v = trim(fUrl.value); const ok = /^https:\/\/.+\..+/.test(v);
        wUrl.setError(ok ? '' : 'Use uma URL https válida.'); if (!ok) return;
        const rec = db.put('integracoes', { id: C.uid('in'), orgId: o.id, kind: 'webhook', nome: 'Webhook ERP', url: v, eventos: ['operacao.paga', 'titulo.liquidado'], status: 'ativo', criadoEm: C.clock.now(), ultimoUso: null });
        log('integracao.criada', 'Webhook cadastrado: ' + v, 'R1', { kind: 'integracao', id: rec.id });
        ui.toast('Webhook salvo', { type: 'success', text: 'Use Testar para ver o formato do evento.' }); api.close(true);
      } })] });
  }

  /* =====================================================================
     CADASTRO (KYC e documentos): cedente, financiador, originador
     ===================================================================== */
  const DOC_TONE = { ok: 'green', pendente: 'amber', divergente: 'red', expirado: 'red', em_analise: 'violet', enviando: 'blue' };
  const DOC_LABEL = { ok: 'Verificado', pendente: 'Pendente', divergente: 'Divergente', expirado: 'Expirado', em_analise: 'Em análise do agente', enviando: 'Enviando' };
  const docBadge = (st) => ui.badge(DOC_LABEL[st] || st, DOC_TONE[st] || 'neutral', { dot: true });

  function renderCadastro() {
    const o0 = org();
    if (!['cedente', 'financiador', 'originador'].includes(o0.kind)) return h('div.sh-page', ui.pageHeader({ eyebrow: 'Cadastro', title: 'Cadastro e documentos' }), ui.empty({ icon: 'id-card', title: 'Não se aplica', text: 'Esta tela existe para cedentes, financiadores e originadores.' }));
    return ui.live(['kyc', 'orgs'], () => {
      const o = db.get('orgs', o0.id); const k = db.get('kyc', 'kyc-' + o.id);
      const st = k ? k.status : 'em_analise';
      const stepIdx = st === 'aprovado' ? 3 : st === 'em_analise' ? 2 : 1;
      const accountCard = o.kind === 'cedente' ? cardContasCad(o) : o.kind === 'originador' ? cardOrigContaCad(o) : cardFinCad(o);
      const pendente = (o.status === 'kyc' || o.status === 'pendente') && st !== 'aprovado';
      return h('div.sh-page',
        ui.pageHeader({ eyebrow: 'Cadastro', title: 'Cadastro e documentos', subtitle: st === 'aprovado' ? 'Documentos, representantes e declarações da empresa.' : 'O resto do app continua usável enquanto o cadastro é analisado.', actions: [ui.status('kyc', st)] }),
        h('div.stack',
          ui.card({ class: 'sh-stepcard' }, ui.stepper(['Dados', 'Documentos', 'Análise da Mesa', 'Aprovado'], stepIdx)),
          pendente ? ui.callout({ tone: 'warn', icon: 'triangle-alert', title: 'Cadastro em análise', text: 'Você pode operar normalmente. Assim que a Mesa aprovar, o selo muda aqui na hora.' }) : null,
          st === 'pendencia' ? ui.callout({ tone: 'error', icon: 'circle-alert', title: 'A Mesa aguarda você', text: k ? k.agenteResumo : '' }) : null,
          st === 'aprovado' ? viewAprovado(o, k) : ui.card({ title: 'Documentos', subtitle: 'Envie cada item. O agente confere e a Mesa decide.' }, k && k.docs.length ? h('div.sh-doc-grid', k.docs.map((d, i) => docCard(o, k, i))) : ui.empty({ icon: 'file-text', title: 'Nenhum documento solicitado', text: 'A Mesa de Operações avisa aqui quando precisar de algum documento.' })),
          h('div.sh-grid-2', cardReps(o), accountCard), cardDeclaracoes(o), cardCadTimeline(o)));
    });
  }

  function viewAprovado(o, k) {
    const docs = k ? k.docs : [];
    const okk = docs.filter((d) => d.status === 'ok').length;
    return h('div.stack',
      ui.callout({ tone: 'success', icon: 'badge-check', title: 'Cadastro aprovado', text: (k && k.agenteResumo) || 'Documentos verificados pela Mesa.' }),
      ui.grid(3,
        ui.kpi({ label: 'Documentos verificados', value: okk + '/' + docs.length, icon: 'file-check' }),
        ui.kpi({ label: 'Próxima revisão', display: fmt.date(C.cal.addDays(C.clock.now(), 320)), icon: 'calendar', hint: 'anual' }),
        ui.kpi({ label: 'Validade das certidões', display: '90 dias', icon: 'timer', hint: 'reenviar ao vencer' })),
      ui.card({ title: 'Documentos', subtitle: 'Reenvie quando vencer.' }, h('div.sh-doc-grid', docs.map((d, i) => docCard(o, k, i)))));
  }

  function docCard(o, k, i) {
    const d = k.docs[i]; const ag = d.agente;
    return h('div.sh-doc',
      h('div.sh-doc-top', h('div.sh-doc-file', h('span.sh-doc-ic', icon('file-text', 18)), h('div.cell-main', h('strong', d.tipo), h('small', d.arquivo || 'nenhum arquivo enviado'))), docBadge(d.status)),
      ag && d.status !== 'divergente' ? h('div.sh-doc-ai', ui.ai('Agente: ' + Math.round((ag.confianca || 0) * 100) + '%'), h('span', ag.nota)) : null,
      ag && d.status === 'divergente' ? h('div.sh-doc-ai', ui.ai('Agente: ' + Math.round((ag.confianca || 0) * 100) + '% de confiança')) : null,
      d.status === 'divergente' ? ui.callout({ tone: 'error', icon: 'circle-alert', title: 'Divergência', text: (ag && ag.nota) || 'Confira o documento e reenvie.' }) : null,
      d.status === 'expirado' ? ui.callout({ tone: 'warn', icon: 'timer', text: 'Documento vencido. Envie a versão atualizada.' }) : null,
      h('div.row',
        isAdmin() ? ui.btn(d.arquivo ? 'Substituir' : 'Enviar', { variant: 'secondary', size: 'sm', icon: 'upload', onclick: () => docUpload(o, k, i) }) : null,
        d.arquivo ? ui.btn('Ver', { variant: 'ghost', size: 'sm', icon: 'eye', onclick: () => ui.toast(d.arquivo, { type: 'info', text: 'Prévia simulada do documento.' }) }) : null,
        isAdmin() && d.arquivo ? ui.btn('Remover', { variant: 'ghost', size: 'sm', onclick: async () => {
          if (!(await ui.confirm({ title: 'Remover documento?', text: 'O item volta para pendente e a Mesa é avisada.', tone: 'danger', confirmLabel: 'Remover' }))) return;
          const docs = k.docs.slice(); docs[i] = Object.assign({}, d, { arquivo: null, status: 'pendente', agente: null });
          db.patch('kyc', k.id, { docs, atualizadoEm: C.clock.now() });
          log('kyc.doc_removido', `Documento removido: ${d.tipo}`, 'R1', { kind: 'kyc', id: k.id });
        } }) : null));
  }

  function docUpload(o, k, i) {
    const d = k.docs[i];
    const bar = ui.progress(0, { thin: true });
    const st = h('p.small.muted', 'Escolha o arquivo do documento. Dica da demonstração: um arquivo com "errado" no nome simula divergência do agente.');
    const dz = ui.dropzone({ title: 'Arraste o documento ou clique', hint: 'PDF ou imagem, até 10 MB', accept: '.pdf,.png,.jpg,.jpeg', onFiles: (files) => {
      const f = files[0]; if (!f) return;
      st.textContent = 'Enviando ' + f.name + '…';
      const docs0 = k.docs.slice(); docs0[i] = Object.assign({}, d, { arquivo: f.name, status: 'enviando', agente: null });
      db.patch('kyc', k.id, { docs: docs0 });
      let p = 0;
      const timer = setInterval(() => {
        p = Math.min(100, p + 20 + Math.random() * 25); bar.firstChild.style.width = p + '%';
        if (p < 100) return;
        clearInterval(timer);
        const docs1 = db.get('kyc', k.id).docs.slice();
        docs1[i] = Object.assign({}, docs1[i], { status: 'em_analise' });
        db.patch('kyc', k.id, { docs: docs1 });
        st.textContent = 'Arquivo recebido. O agente de documentos está analisando…';
        setTimeout(() => {
          const bad = /errado/i.test(f.name);
          const docs2 = db.get('kyc', k.id).docs.slice();
          docs2[i] = Object.assign({}, docs2[i], { status: bad ? 'divergente' : 'ok',
            agente: bad ? { confianca: 0.41, nota: 'Nome ou número diverge do cadastro. Confira e reenvie (dica: o nome do arquivo não deve conter "errado").' } : { confianca: Math.round((0.9 + Math.random() * 0.09) * 100) / 100, nota: 'Dados conferem com a Receita e entre os documentos.' } });
          db.patch('kyc', k.id, { docs: docs2, atualizadoEm: C.clock.now() });
          log('kyc.doc_enviado', `Documento ${bad ? 'divergente' : 'verificado'}: ${d.tipo}`, 'R1', { kind: 'kyc', id: k.id });
          ui.toast(bad ? 'Documento divergente' : 'Documento verificado', { type: bad ? 'error' : 'success', text: bad ? 'Veja o apontamento do agente.' : 'O agente conferiu; a Mesa decide no passo seguinte.' });
          api.close();
        }, 1500);
      }, 240);
    } });
    const api = ui.drawer({ title: 'Enviar: ' + d.tipo, icon: 'upload', size: 'sm', body: h('div.stack.tight', dz, h('div.sh-upload-bar', bar), st) });
  }

  function cardReps(o) {
    const list = ui.live(['orgs'], () => {
      const reps = ensureArr(db.get('orgs', o.id), 'representantes');
      if (!reps.length) return ui.empty({ icon: 'users', title: 'Nenhum representante', text: 'Adicione quem pode assinar pela empresa.' });
      return h('div.sh-sess-list', reps.map((r) => h('div.sh-sess', ui.avatar(r.nome, { size: 'sm' }), h('div.grow', h('strong', r.nome), h('div.small.muted', r.cargo + ' · CPF ' + fmt.cpf(r.cpf))), isAdmin() ? ui.iconBtn('trash-2', { label: 'Remover ' + r.nome, size: 'sm', onclick: async () => {
        if (!(await ui.confirm({ title: 'Remover representante?', text: r.nome + ' deixa de poder assinar pela empresa.', tone: 'danger', confirmLabel: 'Remover' }))) return;
        db.patch('orgs', o.id, { representantes: ensureArr(db.get('orgs', o.id), 'representantes').filter((x) => x.cpf !== r.cpf) });
        log('org.representante_removido', 'Representante legal removido', 'R1');
      } }) : null)));
    });
    const open = () => {
      const fN = ui.input({ placeholder: 'Nome completo' });
      const fC = ui.input({ placeholder: 'Ex.: Sócia-administradora' });
      const fP = ui.input({ mask: 'cpf', placeholder: '000.000.000-00' });
      const wN = ui.field({ label: 'Nome', required: true }, fN);
      const wC = ui.field({ label: 'Cargo', required: true }, fC);
      const wP = ui.field({ label: 'CPF', required: true }, fP);
      ui.modal({ title: 'Adicionar representante', icon: 'user-plus', size: 'sm',
        body: h('div.stack.tight', wN, wC, wP),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Adicionar', { variant: 'primary', onclick: () => {
          const dg = String(fP.value).replace(/\D/g, '');
          wN.setError(trim(fN.value) ? '' : 'Informe o nome.');
          wC.setError(trim(fC.value) ? '' : 'Informe o cargo.');
          wP.setError(dg.length !== 11 ? 'O CPF precisa de 11 dígitos.' : !validCpf(dg) ? 'CPF inválido.' : '');
          if (!trim(fN.value) || !trim(fC.value) || dg.length !== 11 || !validCpf(dg)) return;
          const arr = ensureArr(db.get('orgs', o.id), 'representantes').concat([{ nome: trim(fN.value), cargo: trim(fC.value), cpf: dg }]);
          db.patch('orgs', o.id, { representantes: arr });
          log('org.representante_adicionado', 'Representante legal adicionado', 'R1');
          api.close(true);
        } })] });
    };
    return ui.card({ title: 'Representantes legais', subtitle: 'Quem pode assinar pela empresa.', actions: isAdmin() ? [ui.btn('Adicionar', { variant: 'secondary', size: 'sm', icon: 'plus', onclick: open })] : null }, list);
  }

  const editRoute = () => '/' + session.role() + '/configuracoes?aba=empresa';
  function cardContasCad(o) {
    const c = o.contaLiquidacao || {};
    return ui.card({ title: 'Contas bancárias', subtitle: 'Conta de liquidação (edite em Configurações > Empresa).' },
      ui.kv([['Banco', c.banco || '—'], ['Agência / conta', (c.agencia || '—') + ' / ' + (c.conta || '—')], ['Titular', c.titular || o.nome]]),
      h('div.row', ui.btn('Editar conta', { variant: 'secondary', size: 'sm', route: editRoute() })));
  }
  function cardOrigContaCad(o) {
    const c = o.contaPremiacao || {};
    return ui.card({ title: 'Conta de premiação', subtitle: 'Mesmo CNPJ (edite em Configurações > Empresa).' },
      ui.kv([['Banco', c.banco || '—'], ['Agência / conta', (c.agencia || '—') + ' / ' + (c.conta || '—')]]),
      h('div.row', ui.btn('Editar conta', { variant: 'secondary', size: 'sm', route: editRoute() })));
  }
  function cardFinCad(o) {
    return ui.card({ title: 'Dados do cadastro', subtitle: 'Tipo, regulação e contatos (edite em Configurações > Empresa).' },
      ui.kv([['Tipo', o.tipo || o.kind], ['Regulação', o.regulacao || '—'], ['E-mail de cobrança', o.emailCobranca || '—'], ['Administrador', o.adminNome || '—']]),
      h('div.row', ui.btn('Editar dados', { variant: 'secondary', size: 'sm', route: editRoute() })));
  }

  function cardDeclaracoes(o) {
    const d0 = o.declaracoes || {};
    const items = [['veracidade', 'As informações e documentos enviados são verdadeiros.'], ['titularidade', 'A conta de liquidação está em nome da empresa.'], ['lgpd', 'Autorizo o tratamento dos dados para KYC, crédito e conciliação (LGPD).']];
    const boxes = items.map(([k, lab]) => ui.checkbox({ label: lab, checked: !!d0[k], disabled: !isAdmin(), onChange: (v) => {
      db.patch('orgs', o.id, { declaracoes: Object.assign({}, db.get('orgs', o.id).declaracoes, { [k]: v }) });
      log('org.declaracao', `Declaração ${v ? 'aceita' : 'desmarcada'}: ${lab}`, 'R1');
    } }));
    return ui.card({ title: 'Declarações', subtitle: isAdmin() ? 'Obrigatórias para a Mesa aprovar.' : 'Somente administradores marcam.' }, h('div.stack.tight', boxes));
  }

  function cardCadTimeline(o) {
    const lotes = db.where('lotes', (l) => l.cedenteId === o.id);
    const items = ledger.all()
      .filter((e) => e.entidade && (e.entidade.id === 'kyc-' + o.id || e.entidade.id === o.id || (e.entidade.kind === 'lote' && lotes.some((l) => l.id === e.entidade.id))))
      .slice().sort((a, b) => a.ts - b.ts)
      .map((e) => ({ icon: 'circle', title: e.resumo, ts: e.ts, actor: e.actor.nome }));
    return ui.card({ title: 'Histórico do cadastro', subtitle: 'Eventos da trilha ligados à empresa e aos lotes.' },
      items.length ? ui.timeline(items) : ui.empty({ icon: 'history', title: 'Sem eventos', text: 'Os eventos do cadastro aparecem aqui.' }));
  }

  /* =====================================================================
     AJUDA (todos os papéis)
     ===================================================================== */
  function faqFor(role) {
    const base = [
      ['Como funciona o leilão reverso?', 'Você publica títulos e os financiadores competem oferecendo taxas cada vez menores. Só vale lance menor que o melhor atual, com passo mínimo de 0,01% a.m. O aceite é sempre seu (ou do teto automático que você configurou).'],
      ['O que é o corte das 14h30?', 'Aceites até 14h30 em dia útil geram pagamento até 17h do mesmo dia. Depois disso, o pagamento cai no próximo dia útil até 17h.'],
      ['O que é a firmeza de 3h?', 'Toda oferta fica firme por 3 horas: o financiador não pode retirá-la nesse período. Depois, pode retirar e o próximo melhor assume.'],
      ['O que é regresso?', 'Com regresso, se o sacado não pagar, você recompra o título (multa de 2% mais mora de 1% a.m. pro rata, [INFERÊNCIA]). O programa Premium só admite operações com regresso.'],
      ['O que são a TS e a Taxa de Acesso?', 'TS é a taxa de serviço paga pelo financiador: de 20% a 40% do spread sobre a SELIC, com piso de R$ 15 ou 0,08% a.m. A Taxa de Acesso é R$ 1.999 por mês, com 2 meses de carência e isenção no mês com ao menos 1 operação paga.'],
      ['O que é o LAR?', 'Limite de Antecipação de Recebíveis. Nos 3 primeiros meses, 80% do faturamento anual dividido por 365, vezes o seu prazo médio. Depois, passa a considerar os depósitos de sacados dos últimos 90 dias.'],
      ['O que é Recurso Livre?', 'Quando o sacado paga mais do que o saldo em aberto, a sobra vira Recurso Livre: dinheiro do cedente, sem retenção, liberado na conta de liquidação.'],
      ['Como funciona a conciliação?', 'O motor confere 3 fatores: fonte pagadora (CNPJ do sacado), valor entre 50% e 110% do saldo e data a partir de 2 dias antes do vencimento. Exato e único liquida na hora. Empate, parcial ou fonte desconhecida vão para a Mesa Conciliadora (24h; 48h no empate).'],
      ['Não leve operações para fora da plataforma', 'Negociar por fora com contrapartes conhecidas na Cedy (anti-bypass) gera multa de 12 meses de TS [INFERÊNCIA do valor]. Mantenha tudo na trilha.'],
      ['Como funcionam a segurança e o 2FA?', 'Todo usuário tem 2FA obrigatório e senha com força mínima. As sessões aparecem em Configurações > Segurança e podem ser encerradas à distância. A trilha registra quem fez o quê, com hash encadeado.'],
      ['Como a LGPD é tratada?', 'Dados pessoais servem só para KYC, crédito e conciliação. Você pode pedir exportação ou exclusão pelo canal Falar com a Mesa. Compartilhamos o mínimo com cada contraparte (anonimato até o aceite).'],
    ];
    if (role === 'financiador') base.splice(4, 0, ['Como o motor avalia a minha política?', 'Cada lance é checado contra ticket, prazo, rating mínimo, setores e limites por cedente e sacado. Fora da política, o lance é recusado com o motivo. Dá para automatizar com lance automático dentro da política.']);
    if (role === 'originador') base.push(['Como ganho premiação?', '10% da TS das suas indicadas por 24 meses desde a 1ª operação paga, mais 30% de gestão enquanto a cedente estiver ativa (1 operação em 90 dias). Relatório no 5º dia útil, pagamento no dia 20 do mês seguinte, mínimo de R$ 100.']);
    if (role === 'sacado') base.push(['Por que confirmam os meus títulos?', 'No programa Confia, a sua confirmação libera o título para leilão. Confirmar é rápido e evita travar o fornecedor. Contestar abre análise da Mesa.']);
    if (role === 'ops') base.push(['Quais são os SLAs da Mesa?', 'Validação de lote em 6h (24h na primeira operação), janela das 8h às 18h em dias úteis. Mesa Conciliadora: 24h (48h em empate). Cadastro: análise em até 1 dia útil.']);
    return base;
  }
  const GLOSS = [['Aceite', 'Ato do cedente que fecha o leilão na melhor oferta.'], ['Balcão', 'Operação dirigida a um único financiador.'], ['Cessão', 'Transferência do crédito ao financiador, assinada por ambas as partes com ICP-Brasil.'], ['CET', 'Custo efetivo total da operação ao mês.'], ['Deságio', 'Desconto aplicado sobre o valor de face pela antecipação.'], ['Firmeza', 'Período de 3h em que a oferta não pode ser retirada.'], ['LAR', 'Limite de Antecipação de Recebíveis por cedente.'], ['Lastro', 'Documentos que provam o crédito (XML da NF-e, comprovantes).'], ['Mesa Conciliadora', 'Time Cedy que resolve créditos sem conciliação automática.'], ['Mesa de Operações', 'Time Cedy que valida lotes e cadastros.'], ['Recurso Livre', 'Sobra paga além do saldo em aberto, liberada ao cedente.'], ['Regresso', 'Recompra do título pelo cedente quando o sacado não paga.'], ['TS', 'Taxa de serviço da Cedy, paga pelo financiador.']];

  function renderAjuda(ctx) {
    const role = ctx.role; let q = '';
    const listWrap = h('div.sh-faq');
    const draw = () => {
      const items = faqFor(role).filter(([t, x]) => !q || (t + ' ' + x).toLowerCase().includes(q)).map(([t, x]) => faqItem(t, x));
      C.mount(listWrap, items.length ? items : ui.empty({ icon: 'search', title: 'Nada encontrado', text: 'Tente outra palavra ou fale com a Mesa.' }));
    };
    const search = ui.search({ placeholder: 'Buscar nas perguntas frequentes', onInput: (v) => { q = String(v).toLowerCase(); draw(); } });
    draw();
    const fAssunto = ui.select({ aria: 'Assunto', options: [{ value: 'duvida', label: 'Dúvida sobre operação' }, { value: 'documento', label: 'Documento ou cadastro' }, { value: 'erro', label: 'Erro ou divergência' }, { value: 'lgpd', label: 'Privacidade e LGPD' }, { value: 'outro', label: 'Outro assunto' }], value: 'duvida' });
    const fMsg = ui.input({ type: 'textarea', rows: 4, placeholder: 'Conte o que aconteceu, com números de operação ou título se houver.' });
    const wMsg = ui.field({ label: 'Mensagem', required: true }, fMsg);
    const fAnx = ui.dropzone({ title: 'Anexar print ou arquivo', hint: 'Opcional', icon: 'paperclip' });
    return h('div.sh-page',
      ui.pageHeader({ eyebrow: 'Ajuda', title: 'Ajuda e suporte', subtitle: 'Respostas rápidas, glossário e canal com a Mesa.' }),
      h('div.stack',
        h('div.sh-grid-2',
          ui.card({ title: 'Perguntas frequentes' }, search, listWrap),
          ui.card({ title: 'Falar com a Mesa', subtitle: 'Resposta em até 1 dia útil. Vira notificação para a Mesa.' },
            ui.field({ label: 'Assunto' }, fAssunto), wMsg, ui.field({ label: 'Anexo', optional: true }, fAnx),
            h('div.row.end', ui.btn('Enviar mensagem', { variant: 'primary', icon: 'send', onclick: () => sendMesa(role, fAssunto, fMsg, wMsg) })))),
        h('div.sh-grid-2',
          ui.card({ title: 'Glossário' }, h('dl.sh-gloss', GLOSS.map(([t, d]) => [h('dt', t), h('dd', d)]).flat())),
          h('div.stack',
            ui.card({ title: 'Atalhos de teclado' }, h('div.sh-kbd-list', [['Ctrl K', 'Busca geral e comandos'], ['Ctrl /', 'Abrir o assistente'], ['Esc', 'Fechar janelas e menus']].map(([a, b]) => h('div.sh-kbd-row', h('span', b), h('kbd', a))))),
            ui.card({ title: 'Situação do serviço', subtitle: 'Referência do protótipo.' },
              ui.kv([['Disponibilidade', '99,5% ao mês (meta de referência)'], ['Incidentes ativos', 'Nenhum'], ['Resposta S1 (crítico)', '2 h (referência)'], ['Resposta S2/S3', '8 h / 1 dia útil (referência)']]),
              h('div.row', ui.btn('Termos de uso', { variant: 'ghost', size: 'sm', icon: 'file-text', onclick: () => legalDrawer('Termos de uso', 'Resumo do protótipo: a Cedy intermedia antecipações e não custodia recursos. Operações exigem cessão assinada com ICP-Brasil. Taxas e prazos seguem a tela de aceite e o contrato de cessão. Reclamações e disputas passam pela Mesa antes de qualquer medida externa.') }),
                ui.btn('Privacidade', { variant: 'ghost', size: 'sm', icon: 'shield-check', onclick: () => legalDrawer('Política de privacidade', 'Resumo do protótipo: coletamos dados de empresa, documentos e operações para KYC, crédito e conciliação. Compartilhamos o mínimo com cada contraparte. Você pode pedir exportação, correção ou exclusão pelo canal Falar com a Mesa.') })))))));
  }
  function faqItem(t, x) {
    let open = false;
    const btn = h('button', { type: 'button', class: 'sh-faq-q', 'aria-expanded': 'false', onclick: () => { open = !open; wrap.dataset.open = open ? '1' : '0'; btn.setAttribute('aria-expanded', String(open)); } }, h('span.grow', t), icon('chevron-down', 16));
    const wrap = h('div.sh-faq-item', { dataset: { open: '0' } }, btn, h('div.sh-faq-a', h('div.sh-faq-a-in', h('div', x))));
    return wrap;
  }
  function sendMesa(role, fAssunto, fMsg, wMsg) {
    const txt = trim(fMsg.value);
    if (!txt) { wMsg.setError('Escreva a mensagem para a Mesa.'); fMsg.input.focus(); return; }
    wMsg.setError('');
    const prot = 'MESA-' + Math.floor(C.clock.now() / 1000).toString(36).toUpperCase().slice(-6);
    const assunto = { duvida: 'dúvida sobre operação', documento: 'documento ou cadastro', erro: 'erro ou divergência', lgpd: 'privacidade e LGPD', outro: 'outro assunto' }[fAssunto.value] || 'outro assunto';
    notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: 'Pedido de ajuda: ' + assunto, corpo: `${me().nome} (${org().fantasia || org().nome}): ${txt.slice(0, 140)} [${prot}]`, link: '/ops/notificacoes' });
    log('ajuda.contato', `Contato com a Mesa aberto (${prot})`, 'R1');
    ui.toast('Enviado à Mesa', { type: 'success', text: 'Protocolo ' + prot + '. Respondemos em até 1 dia útil.' });
    fMsg.value = '';
  }
  function legalDrawer(title, text) {
    ui.drawer({ title, icon: 'file-text', size: 'sm', body: h('div.stack.tight', h('p.small.muted', 'Resumo em linguagem simples. O texto jurídico final sai com o parecer (P13).'), h('p', text)) });
  }

  /* =====================================================================
     NOTIFICAÇÕES (lista completa)
     ===================================================================== */
  const TIPO_ICON = { info: 'info', sucesso: 'circle-check', alerta: 'triangle-alert', erro: 'circle-alert' };
  const TIPO_TONE = { info: 'blue', sucesso: 'green', alerta: 'amber', erro: 'red' };
  function renderNotifs(ctx) {
    let onlyUnread = ctx.query.f === 'nao-lidas'; let tipos = new Set();
    const seg = ui.segmented({ aria: 'Filtro de leitura', value: onlyUnread ? 'nao' : 'todas', options: [{ value: 'todas', label: 'Todas' }, { value: 'nao', label: 'Não lidas' }], onChange: (v) => { onlyUnread = v === 'nao'; draw(); } });
    const chips = ui.chips({ aria: 'Tipos de notificação', options: [['info', 'Informação'], ['sucesso', 'Sucesso'], ['alerta', 'Alerta'], ['erro', 'Erro']].map(([value, label]) => ({ value, label })), onChange: (v) => { tipos = new Set(v); draw(); } });
    const list = h('div.sh-notifs');
    const dayKey = (ts) => C.cal.key(ts);
    function draw() {
      let rows = notify.mine().slice().sort((a, b) => b.ts - a.ts);
      if (onlyUnread) rows = rows.filter((n) => !n.lida);
      if (tipos.size) rows = rows.filter((n) => tipos.has(n.tipo));
      C.clear(list);
      if (!rows.length) { list.append(ui.card({}, ui.empty({ icon: 'bell', title: tipos.size ? 'Nada com esses filtros' : onlyUnread ? 'Tudo lido' : 'Sem notificações', text: tipos.size ? 'Remova um filtro para ver mais avisos.' : onlyUnread ? 'Nada pendente por aqui.' : 'Quando algo acontecer, avisamos aqui.' }))); return; }
      const now = C.clock.now(); const today = dayKey(now), yest = dayKey(now - 86400000);
      const groups = [['Hoje', []], ['Ontem', []], ['Esta semana', []], ['Anteriores', []]];
      rows.forEach((n) => { const k = dayKey(n.ts); groups[k === today ? 0 : k === yest ? 1 : (now - n.ts) < 7 * 86400000 ? 2 : 3][1].push(n); });
      groups.forEach(([lab, arr]) => {
        if (!arr.length) return;
        list.append(h('div.sh-day', lab + ' · ' + arr.length), ui.card({ flush: true, class: 'sh-notif-card' }, arr.map(notifRow)));
      });
    }
    function notifRow(n) {
      return h('button', { type: 'button', class: ['notif-item', 'sh-notif-row', !n.lida && 'unread'], onclick: () => { notify.read(n.id); if (n.link) C.router.go(n.link); } },
        h('span', { class: ['notif-ic', 'tone-' + (TIPO_TONE[n.tipo] || 'blue')] }, icon(TIPO_ICON[n.tipo] || 'info', 16)),
        h('span.notif-t', h('strong', n.titulo), n.corpo && h('small', n.corpo), h('time', fmt.rel(n.ts))));
    }
    const body = ui.live(['notifs'], () => { draw(); return list; });
    return h('div.sh-page',
      ui.pageHeader({ eyebrow: 'Central', title: 'Notificações', subtitle: 'Tudo que a plataforma mandou para você.', actions: [ui.btn('Marcar todas como lidas', { variant: 'secondary', icon: 'check', onclick: () => notify.readAll() })] }),
      h('div.toolbar', seg, chips), body);
  }

  /* =====================================================================
     Registro de rotas (uma vez por papel)
     ===================================================================== */
  ['cedente', 'financiador', 'originador', 'sacado', 'ops'].forEach((role) => {
    C.router.register({ path: '/' + role + '/configuracoes', roles: [role], title: 'Configurações', render: renderConfig });
    C.router.register({ path: '/' + role + '/ajuda', roles: [role], title: 'Ajuda', render: renderAjuda });
    C.router.register({ path: '/' + role + '/notificacoes', roles: [role], title: 'Notificações', render: renderNotifs });
  });
  ['cedente', 'financiador', 'originador'].forEach((role) => {
    C.router.register({ path: '/' + role + '/cadastro', roles: [role], title: 'Cadastro', render: renderCadastro });
  });

  /* aplica a densidade salva ao carregar */
  try { if (db.state && db.state.densidade) document.documentElement.dataset.density = db.state.densidade; } catch (e) { /* */ }
})();
