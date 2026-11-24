/* =========================================================================
   Cedy super3: governança do Superadmin (usuários internos, segurança e
   aprovações em quatro olhos). Prefixo CSS sgv-. Rotas /super/usuarios,
   /super/seguranca e /super/aprovacoes (roles ops, perfil superadmin).
   Regras: 2 a 3 Superadmins, ninguém muda o próprio papel, alerta de
   segregação de funções, ver como com C.flows.verComo.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui; const F = C.flows;
  const { db, session, ledger, notify } = C.store; const E = C.engine;
  const now = () => C.clock.now();
  const DAY = 86400000;
  const meId = () => (session.get() || {}).userId;
  const meActor = () => E.actors.user(meId());

  /* ------------------------------ helpers ------------------------------ */
  const internos = () => db.where('users', (u) => u.orgId === 'org-cedy').sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  const supers = () => internos().filter((u) => u.perfil === 'superadmin' && statusUser(u) === 'ativo');
  const nomeUser = (id) => { const u = db.get('users', id); return u ? u.nome : (id || '—'); };
  const orgCurta = (id) => { const o = db.get('orgs', id); return o ? (o.fantasia || o.nome) : (id || '—'); };
  const papelLabel = (u) => (u.perfil === 'superadmin' ? 'Superadmin' : (C.OPS_PAPEIS[u.papel] || {}).label || u.papel || '—');
  const perfilLabel = (p) => ({ superadmin: 'Superadmin', admin: 'Admin (líder)', operador: 'Operador', leitor: 'Leitor' }[p] || p || '—');
  const statusUser = (u) => u.status || 'ativo';
  const statusBadge = (u) => ui.badge(statusUser(u) === 'ativo' ? 'Ativo' : 'Suspenso', statusUser(u) === 'ativo' ? 'green' : 'red', { dot: true });
  const perfilBadge = (p) => ui.badge(perfilLabel(p), p === 'superadmin' ? 'blue' : p === 'admin' ? 'teal' : 'neutral');
  const papelBadge = (u) => ui.badge(papelLabel(u), u.perfil === 'superadmin' ? 'blue' : 'neutral');
  const twofaBadge = (u) => (u.twofa ? ui.badge('Ativo', 'green', { dot: true }) : ui.badge('Inativo', 'amber', { dot: true }));
  function acessoCell(u) {
    if (!u.ultimoAcesso) return h('span.sgv-never', 'Nunca acessou');
    const velho = now() - u.ultimoAcesso > 60 * DAY;
    return h('span', { class: velho && 'sgv-old-access', title: fmt.datetime(u.ultimoAcesso) }, fmt.rel(u.ultimoAcesso));
  }

  /** Mesma regra de C.can para usuários internos, avaliada para um usuário qualquer (usada no teste de permissão). */
  function podeFazer(u, perm) {
    if (!u) return false;
    if (u.perfil === 'superadmin') return true;
    if (perm === 'ver') return true;
    if (u.perfil === 'leitor') return false;
    if (perm.indexOf('ops.') === 0) {
      if (perm === 'ops.config.aplicar') return false;
      if (u.perfil === 'admin' && perm !== 'ops.verComo') return true;
      const p = C.OPS_PAPEIS[u.papel];
      return !!(p && (p.perms.includes('*') || p.perms.includes(perm)));
    }
    if (perm === 'admin') return u.perfil === 'admin';
    return u.papel !== 'auditor';
  }
  const OPS_TODAS = () => Object.keys(C.OPS_PERMS);
  function permsDe(perfil, papel) {
    if (perfil === 'superadmin') return ['*'];
    if (perfil === 'admin') return OPS_TODAS().filter((p) => p !== 'ops.verComo' && p !== 'ops.config.aplicar');
    if (perfil === 'leitor') return [];
    const d = C.OPS_PAPEIS[papel]; return d ? d.perms.slice() : [];
  }
  const permLabel = (p) => (p === '*' ? 'Todas (Superadmin)' : (C.OPS_PERMS[p] || p));

  /** Pares de funções conflitantes: o líder acumula todas as permissões operacionais, então acumular um lado exige justificativa. */
  const SOD_PARES = { financeiro: 'suporte', suporte: 'financeiro', conciliadora: 'financeiro', mesa: 'compliance', compliance: 'mesa' };
  function sodAlerta(perfil, papel) {
    if (perfil === 'admin' && SOD_PARES[papel]) return `O perfil líder acumula todas as permissões operacionais, incluindo deveres conflitantes (${papel} × ${SOD_PARES[papel]}). Prossiga somente com justificativa e programe nova revisão em 90 dias.`;
    return null;
  }

  function fmtVal(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (typeof v === 'number') {
      if (/selic|spread/i.test(k)) return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% a.a.';
      if (/taxa/i.test(k)) return fmt.taxa(v);
      if (/min|valor|total|piso|teto|premio|repasse|multa|mora|fatura/i.test(k)) return fmt.brl(v);
      return fmt.num(v);
    }
    return String(v);
  }
  const CONFIG_ROT = { selicAa: 'SELIC (% a.a.)', taxaAcessoMensal: 'Taxa de Acesso mensal', premiacaoMinima: 'Piso de premiação', firmezaHoras: 'Firmeza da oferta', carenciaMeses: 'Carência (meses)', premiacaoIndicacao: 'Premiação indicação', premiacaoGestao: 'Premiação gestão', inatividadeDias: 'Janela de atividade', premiacaoJanelaMeses: 'Janela da premiação' };

  /** Renderizador genérico antes e depois: chave e valor, linhas alteradas com destaque (sem faixa lateral). */
  function diffKv(antes, depois, rotulos) {
    antes = antes || {}; depois = depois || {};
    const keys = [...new Set([...Object.keys(antes), ...Object.keys(depois)])];
    if (!keys.length) return h('p.small.muted', 'Sem detalhamento de valores.');
    return h('div.sgv-diff', keys.map((k) => {
      const a = antes[k], b = depois[k];
      const mudou = JSON.stringify(a) !== JSON.stringify(b);
      return h('div', { class: ['sgv-kv', mudou && 'is-chg'] }, h('span.sgv-k', (rotulos || {})[k] || k),
        mudou ? h('span.sgv-v', h('span.sgv-old', fmtVal(k, a)), icon('arrow-right', 13), h('strong.sgv-new', fmtVal(k, b))) : h('span.sgv-v', fmtVal(k, b)));
    }));
  }

  function segEvento(tipo, userId, orgId, sev, detalhe) {
    return db.put('eventosSeg', { id: C.uid('es'), ts: now(), tipo, userId, orgId: orgId || 'org-cedy', ip: '10.20.0.14', severidade: sev, detalhe });
  }

  /* ============================ /super/usuarios ============================ */
  const PAPEL_OPTS = () => Object.entries(C.OPS_PAPEIS).map(([value, d]) => ({ value, label: d.label, hint: d.desc }));
  const PERFIL_OPTS = [{ value: 'admin', label: 'Admin (líder)', hint: 'Todas as permissões operacionais, exceto ver como e aplicar configuração' }, { value: 'operador', label: 'Operador', hint: 'Só as permissões do papel' }, { value: 'leitor', label: 'Leitor', hint: 'Só leitura' }];

  /** Região viva sem altura: só dispara o redesenho quando a coleção muda. */
  function sync(cols, fn) {
    const l = ui.live(cols, () => { setTimeout(fn, 0); return h('span'); }, { tag: 'span' });
    l.style.display = 'none';
    return l;
  }

  function pgUsuarios(ctx) {
    const tabs = ['equipe', 'papeis', 'revisao', 'clientes'];
    const st = { tab: tabs.includes(ctx.query.tab) ? ctx.query.tab : 'equipe', q: '', papel: 'todos', status: 'todos' };
    const bar = h('div');
    const body = h('div');
    const counts = () => ({ equipe: internos().length, revisao: internos().filter((u) => statusUser(u) === 'ativo').length });
    function drawBar() {
      C.clear(bar);
      const c = counts();
      bar.append(ui.tabs({ value: st.tab, items: [
        { id: 'equipe', label: 'Equipe', icon: 'users', count: c.equipe },
        { id: 'papeis', label: 'Papéis e permissões', icon: 'key-round' },
        { id: 'revisao', label: 'Revisão de acessos', icon: 'user-check', count: c.revisao },
        { id: 'clientes', label: 'Clientes (ver como)', icon: 'eye' },
      ], onChange: (v) => { st.tab = v; draw(); } }));
    }
    function draw() { drawBar(); C.clear(body); body.append(st.tab === 'equipe' ? equipeTab(st) : st.tab === 'papeis' ? papeisTab() : st.tab === 'revisao' ? revisaoTab() : clientesTab()); }
    draw();
    return h('div.stack', ui.pageHeader({ eyebrow: 'Governança', title: 'Usuários internos e papéis', subtitle: 'Quem acessa a plataforma, o que cada papel pode fazer e a recertificação semestral.' }), bar, body);
  }

  function equipeLista(st) {
    const q = st.q.trim().toLowerCase();
    return internos().filter((u) => {
      if (st.papel !== 'todos' && (u.perfil === 'superadmin' ? 'super' : u.papel) !== st.papel) return false;
      if (st.status !== 'todos' && statusUser(u) !== st.status) return false;
      return !q || (u.nome + ' ' + u.email + ' ' + (u.cargo || '')).toLowerCase().includes(q);
    });
  }

  function acoesEquipe(u) {
    const eu = u.id === meId();
    const items = [
      { label: 'Alterar papel', icon: 'key-round', disabled: eu, hint: eu ? 'Você não pode mudar o próprio papel' : null, onclick: () => alterarPapelModal(u) },
      { divider: true },
      statusUser(u) === 'ativo'
        ? { label: 'Suspender', icon: 'ban', disabled: eu, hint: eu ? 'Você não pode suspender o próprio acesso' : null, onclick: () => suspenderFlow(u) }
        : { label: 'Reativar', icon: 'user-check', onclick: () => reativarFlow(u) },
      { label: 'Redefinir 2FA', icon: 'fingerprint-pattern', hint: 'A pessoa ativa de novo no próximo acesso', onclick: () => mfaFlow(u) },
      { label: 'Encerrar sessões', icon: 'power', onclick: () => encerrarSessoesFlow(u) },
      { divider: true },
      { label: 'Remover', icon: 'trash-2', danger: true, disabled: eu, hint: eu ? 'Você não pode remover a si mesmo' : 'Exige digitar REMOVER', onclick: () => removerFlow(u) },
    ];
    return ui.moreMenu(items, { label: 'Ações de ' + u.nome });
  }

  function convidarModal() {
    let papel = 'mesa', perfil = 'operador';
    const fNome = ui.input({ placeholder: 'Ex.: Beatriz Lacerda' });
    const wNome = ui.field({ label: 'Nome completo', required: true }, fNome);
    const fMail = ui.input({ placeholder: 'nome@cedy.com.br', inputmode: 'email' });
    const wMail = ui.field({ label: 'E-mail corporativo', required: true, hint: 'Só endereços @cedy.com.br.' }, fMail);
    const fCargo = ui.input({ placeholder: 'Ex.: Analista de risco' });
    const wCargo = ui.field({ label: 'Cargo', required: true }, fCargo);
    const sodBox = h('div');
    function drawSod() { C.clear(sodBox); const a = sodAlerta(perfil, papel); if (a) sodBox.append(ui.callout({ tone: 'warn', title: 'Segregação de funções', text: a })); }
    const papelSel = ui.select({ value: papel, options: PAPEL_OPTS(), onChange: (v) => { papel = v; if (v === 'super') { perfil = 'superadmin'; perfilSel.value = 'superadmin'; } else if (perfil === 'superadmin') { perfil = 'operador'; perfilSel.value = 'operador'; } drawSod(); } });
    const perfilSel = ui.select({ value: perfil, options: [...PERFIL_OPTS, { value: 'superadmin', label: 'Superadmin', hint: 'Dono da plataforma, com quatro olhos' }], onChange: (v) => { perfil = v; drawSod(); } });
    const fMot = ui.input({ type: 'textarea', placeholder: 'Por que esta pessoa precisa deste acesso?' });
    const wPapel = ui.field({ label: 'Papel', hint: 'Define o que a pessoa pode fazer.' }, papelSel);
    const wPerfil = ui.field({ label: 'Perfil', hint: 'Líder acumula todas as permissões operacionais.' }, perfilSel);
    const wMot = ui.field({ label: 'Justificativa', hint: 'Obrigatória quando há alerta de segregação (mínimo de 10 caracteres).' }, fMot);
    drawSod();
    ui.modal({ title: 'Convidar usuário interno', icon: 'user-plus', size: 'md',
      body: h('div.stack.tight', ui.callout({ tone: 'info', text: 'O convite cria o acesso com 2FA desligado: a pessoa ativa o segundo fator no primeiro acesso.' }), wNome, wMail, wCargo, wPapel, wPerfil, sodBox, wMot),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Enviar convite', { variant: 'primary', icon: 'send', onclick: () => {
        const nome = fNome.value.trim(), mail = fMail.value.trim().toLowerCase(), cargo = fCargo.value.trim(), mot = fMot.value.trim();
        wNome.setError(nome ? '' : 'Informe o nome completo.');
        wMail.setError(!mail ? 'Informe o e-mail.' : !/^[^@\s]+@cedy\.com\.br$/i.test(mail) ? 'Use um e-mail @cedy.com.br.' : db.where('users', (x) => x.email.toLowerCase() === mail).length ? 'Este e-mail já tem acesso.' : '');
        wCargo.setError(cargo ? '' : 'Informe o cargo.');
        const precisaJust = !!sodAlerta(perfil, papel);
        wMot.setError(precisaJust && mot.length < 10 ? 'Explique o motivo (mínimo de 10 caracteres).' : '');
        if (!nome || !/^[^@\s]+@cedy\.com\.br$/i.test(mail) || db.where('users', (x) => x.email.toLowerCase() === mail).length || !cargo || (precisaJust && mot.length < 10)) return;
        if (perfil === 'superadmin' && papel !== 'super') { wPapel.setError('Superadmin usa o papel Superadmin.'); return; }
        if (papel === 'super' && perfil !== 'superadmin') { wPerfil.setError('O papel Superadmin exige o perfil Superadmin.'); return; }
        if (perfil === 'superadmin' && supers().length >= 3) { ui.toast('Limite de Superadmins', { type: 'error', text: 'A plataforma admite no máximo 3 Superadmins. Revogue um acesso antes de criar outro.' }); return; }
        const u = db.put('users', { id: C.uid('u'), nome, email: mail, cargo, orgId: 'org-cedy', perfil, papel: perfil === 'superadmin' ? 'super' : papel, twofa: false, ultimoAcesso: null, status: 'ativo', demo: false, hue: (nome.length * 47) % 360 });
        ledger.append({ actor: meActor(), acao: 'usuario.convidado', entidade: { kind: 'usuario', id: u.id }, resumo: `${meActor().nome} convidou ${nome} (${papelLabel(u)}, ${perfilLabel(perfil)})`, classe: 'R3', detalhe: { motivo: mot || null } });
        ui.toast('Convite criado', { type: 'success', text: `${nome} entra com 2FA a ativar no primeiro acesso.` });
        api.close(true);
      } })] });
  }

  function alterarPapelModal(u) {
    let papel = u.perfil === 'superadmin' ? 'super' : u.papel, perfil = u.perfil;
    const antes = permsDe(u.perfil, u.papel);
    const prevBox = h('div');
    function drawPrev() {
      const depois = permsDe(perfil, papel);
      const add = depois.filter((p) => !antes.includes(p) && !(antes.includes('*')));
      const del = antes.includes('*') ? (depois.includes('*') ? [] : ['*']) : antes.filter((p) => !depois.includes(p));
      C.clear(prevBox);
      prevBox.append(h('div.sgv-diff', h('div.sgv-kv', h('span.sgv-k', 'Antes'), h('span.sgv-v', papelLabel(u) + ' · ' + perfilLabel(u.perfil))),
        h('div.sgv-kv', h('span.sgv-k', 'Depois'), h('span.sgv-v', (perfil === 'superadmin' ? 'Superadmin' : (C.OPS_PAPEIS[papel] || {}).label) + ' · ' + perfilLabel(perfil)))),
        (add.length || del.length) ? h('div.sgv-permchg',
          add.map((p) => h('span.sgv-add', '+' + permLabel(p))),
          del.map((p) => h('span.sgv-del', (p === '*' ? '−Todas (Superadmin)' : '−' + permLabel(p))))) : h('p.small.muted', 'Nenhuma permissão muda.'));
      C.clear(sodBox); const a = sodAlerta(perfil, papel); if (a) sodBox.append(ui.callout({ tone: 'warn', title: 'Segregação de funções', text: a }));
      precisaJust = !!sodAlerta(perfil, papel);
    }
    let precisaJust = !!sodAlerta(u.perfil, u.papel);
    const papelSel = ui.select({ value: papel, options: PAPEL_OPTS(), onChange: (v) => { papel = v; if (v === 'super') { perfil = 'superadmin'; perfilSel.value = 'superadmin'; } drawPrev(); } });
    const perfilSel = ui.select({ value: perfil, options: [...PERFIL_OPTS, { value: 'superadmin', label: 'Superadmin', hint: 'Dono da plataforma, com quatro olhos' }], onChange: (v) => { perfil = v; drawPrev(); } });
    const sodBox = h('div');
    const fMot = ui.input({ type: 'textarea', placeholder: 'Ex.: Beatriz assume o compliance com a saída da Lacerda' });
    const wMot = ui.field({ label: 'Motivo da mudança', required: true, hint: 'Fica na trilha com o seu nome (mínimo de 10 caracteres).' }, fMot);
    drawPrev();
    ui.modal({ title: 'Alterar papel de ' + u.nome, icon: 'key-round', size: 'md',
      body: h('div.stack.tight', ui.field({ label: 'Papel' }, papelSel), ui.field({ label: 'Perfil' }, perfilSel), sodBox, prevBox, wMot),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Salvar mudança', { variant: 'primary', onclick: () => {
        const mot = fMot.value.trim();
        wMot.setError(mot.length < 10 ? 'Explique o motivo (mínimo de 10 caracteres).' : '');
        if (mot.length < 10) return;
        if (perfil === 'superadmin' && papel !== 'super') { ui.toast('Papel inválido', { type: 'error', text: 'Superadmin usa o papel Superadmin.' }); return; }
        if (papel === 'super' && perfil !== 'superadmin') { ui.toast('Perfil inválido', { type: 'error', text: 'O papel Superadmin exige o perfil Superadmin.' }); return; }
        if (u.perfil === 'superadmin' && perfil !== 'superadmin' && supers().length <= 2) { ui.toast('Quatro olhos em risco', { type: 'error', text: 'É preciso manter ao menos 2 Superadmins: promova outra pessoa antes de rebaixar.' }); return; }
        if (perfil === 'superadmin' && u.perfil !== 'superadmin' && supers().length >= 3) { ui.toast('Limite de Superadmins', { type: 'error', text: 'A plataforma admite no máximo 3 Superadmins.' }); return; }
        const de = { papel: papelLabel(u), perfil: perfilLabel(u.perfil) };
        db.patch('users', u.id, { papel: perfil === 'superadmin' ? 'super' : papel, perfil });
        const para = { papel: papelLabel(db.get('users', u.id)), perfil: perfilLabel(perfil) };
        ledger.append({ actor: meActor(), acao: 'permissao_alterada', entidade: { kind: 'usuario', id: u.id }, resumo: `${meActor().nome} mudou ${u.nome} de ${de.papel}/${de.perfil} para ${para.papel}/${para.perfil}: ${mot}`, classe: 'R3', snapshot: { antes: de, depois: para }, detalhe: { motivo: mot } });
        segEvento('permissao_alterada', meId(), 'org-cedy', 'media', `Papel de ${u.nome} alterado de ${de.papel} (${de.perfil}) para ${para.papel} (${para.perfil}). Motivo: ${mot}`);
        notify.send({ to: { userId: u.id }, tipo: 'alerta', titulo: 'Seu papel na Cedy mudou', corpo: `Agora: ${para.papel} · ${para.perfil}. Motivo: ${mot}`, link: '/ops/configuracoes' });
        ui.toast('Papel atualizado', { type: 'success', text: `${u.nome}: ${para.papel} · ${para.perfil}.` });
        api.close(true);
      } })] });
  }

  async function suspenderFlow(u) {
    if (u.perfil === 'superadmin' && supers().length <= 2) { ui.toast('Quatro olhos em risco', { type: 'error', text: 'É preciso manter ao menos 2 Superadmins ativos: não é possível suspender.' }); return; }
    if (!(await ui.confirm({ title: 'Suspender ' + u.nome + '?', text: 'A pessoa perde o acesso na hora e as sessões são encerradas. A trilha registra quem suspendeu e por quê.', tone: 'danger', confirmLabel: 'Suspender' }))) return;
    db.patch('users', u.id, { status: 'suspenso' });
    ledger.append({ actor: meActor(), acao: 'usuario.suspenso', entidade: { kind: 'usuario', id: u.id }, resumo: `${meActor().nome} suspendeu o acesso de ${u.nome}`, classe: 'R2' });
    segEvento('sessao_encerrada', u.id, 'org-cedy', 'baixa', `Sessões de ${u.nome} encerradas pela suspensão do acesso.`);
    ui.toast('Acesso suspenso', { type: 'warn', text: u.nome + ' não acessa mais a plataforma.' });
  }
  async function reativarFlow(u) {
    if (u.perfil === 'superadmin' && supers().length >= 3) { ui.toast('Limite de Superadmins', { type: 'error', text: 'A plataforma admite no máximo 3 Superadmins ativos.' }); return; }
    if (!(await ui.confirm({ title: 'Reativar ' + u.nome + '?', text: 'A pessoa volta a acessar com o mesmo papel e perfil.', confirmLabel: 'Reativar' }))) return;
    db.patch('users', u.id, { status: 'ativo' });
    ledger.append({ actor: meActor(), acao: 'usuario.reativado', entidade: { kind: 'usuario', id: u.id }, resumo: `${meActor().nome} reativou o acesso de ${u.nome}`, classe: 'R2' });
    ui.toast('Acesso reativado', { type: 'success', text: u.nome });
  }
  async function mfaFlow(u) {
    if (!(await ui.confirm({ title: 'Redefinir o 2FA de ' + u.nome + '?', text: 'O segundo fator atual deixa de valer e a pessoa cadastra um novo no próximo acesso.', confirmLabel: 'Redefinir 2FA' }))) return;
    db.patch('users', u.id, { twofa: false });
    segEvento('mfa_reset', u.id, 'org-cedy', 'media', `Segundo fator de ${u.nome} redefinido por ${meActor().nome}: nova ativação no próximo acesso.`);
    ledger.append({ actor: meActor(), acao: 'usuario.mfa_redefinido', entidade: { kind: 'usuario', id: u.id }, resumo: `2FA de ${u.nome} redefinido por ${meActor().nome}`, classe: 'R2' });
    ui.toast('2FA redefinido', { type: 'success', text: 'Ativação nova no próximo acesso.' });
  }
  async function encerrarSessoesFlow(u) {
    if (!(await ui.confirm({ title: 'Encerrar sessões de ' + u.nome + '?', text: 'Todos os dispositivos perdem o acesso e precisam entrar de novo.', confirmLabel: 'Encerrar sessões' }))) return;
    SESS_OFF.add(u.id);
    segEvento('sessao_encerrada', u.id, 'org-cedy', 'baixa', `Sessões de ${u.nome} encerradas por ${meActor().nome}.`);
    ui.toast('Sessões encerradas', { type: 'success', text: u.nome });
  }
  async function removerFlow(u) {
    if (u.perfil === 'superadmin' && supers().length <= 2) { ui.toast('Quatro olhos em risco', { type: 'error', text: 'É preciso manter ao menos 2 Superadmins: não é possível remover.' }); return; }
    let v = '';
    const inp = ui.input({ placeholder: 'REMOVER', onInput: (x) => (v = x) });
    const campo = ui.field({ label: 'Digite REMOVER para confirmar', required: true, hint: 'A remoção apaga o acesso e fica na trilha com o seu nome.' }, inp);
    const m = ui.modal({ title: 'Remover ' + u.nome + '?', icon: 'trash-2', size: 'sm', body: h('div.stack.tight', ui.callout({ tone: 'error', title: 'Ação permanente', text: 'O acesso some na hora. O histórico da trilha continua com o nome da pessoa.' }), campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Remover acesso', { variant: 'danger', onclick: () => {
        if (v.trim() !== 'REMOVER') { campo.setError('Digite REMOVER em maiúsculas.'); return; }
        db.del('users', u.id);
        ledger.append({ actor: meActor(), acao: 'usuario.removido', entidade: { kind: 'usuario', id: u.id }, resumo: `${meActor().nome} removeu o acesso de ${u.nome}`, classe: 'R3' });
        ui.toast('Acesso removido', { type: 'warn', text: u.nome }); api.close(true);
      } })] });
    return m.promise;
  }

  function equipeTab(st) {
    let tbl;
    const base = () => equipeLista(st);
    const aplica = () => tbl.setRows(base());
    tbl = ui.table({ rows: base(), rowKey: (r) => r.id, pageSize: 12,
      columns: [
        { key: 'n', label: 'Pessoa', mobile: 'primary', render: (u) => h('div.cell-row', { title: u.email }, ui.avatar(u.nome, { size: 'sm', hue: u.hue }), h('div.cell-main', h('strong', u.nome), h('small', (u.cargo || u.email)))) },
        { key: 'papel', label: 'Papel', render: papelBadge },
        { key: 'perfil', label: 'Perfil', mobile: 'hide', render: (u) => perfilBadge(u.perfil) },
        { key: '2fa', label: '2FA', render: twofaBadge },
        { key: 'ac', label: 'Último acesso', mobile: 'hide', render: acessoCell },
        { key: 'st', label: 'Situação', render: statusBadge },
        { key: 'a', label: 'Ações', class: 'ta-right', render: (u) => acoesEquipe(u) },
      ],
      empty: ui.empty({ icon: 'users', title: 'Ninguém por aqui', text: 'Ajuste os filtros ou convide a primeira pessoa da equipe.' }) });
    const fPapel = ui.select({ value: st.papel, aria: 'Filtrar por papel', options: [{ value: 'todos', label: 'Todos os papéis' }, ...PAPEL_OPTS()], onChange: (v) => { st.papel = v; aplica(); } });
    const fStatus = ui.select({ value: st.status, aria: 'Filtrar por situação', options: [{ value: 'todos', label: 'Todas as situações' }, { value: 'ativo', label: 'Ativos' }, { value: 'suspenso', label: 'Suspensos' }], onChange: (v) => { st.status = v; aplica(); } });
    return h('div.stack',
      ui.live(['users'], () => ui.callout({ tone: 'info', icon: 'shield-user', title: 'Quatro olhos começa aqui', text: `A plataforma exige de 2 a 3 Superadmins ativos (${supers().length} agora). Ninguém altera o próprio papel e funções conflitantes pedem justificativa.` })),
      ui.toolbar(ui.search({ placeholder: 'Buscar por nome, e-mail ou cargo', value: st.q, onInput: (v) => { st.q = v; aplica(); } }), fPapel, fStatus,
        ui.btn('Convidar usuário', { variant: 'primary', icon: 'user-plus', onclick: convidarModal })),
      sync(['users'], aplica),
      tbl);
  }

  function papeisTab() {
    const perms = OPS_TODAS();
    const linhas = [
      ...Object.entries(C.OPS_PAPEIS).filter(([k]) => k !== 'super').map(([k, d]) => ({ id: k, nome: d.label, desc: d.desc, get: (p) => (d.perms.includes('*') || d.perms.includes(p)) })),
      { id: 'lider', nome: 'Líder da Mesa (perfil admin)', desc: 'Quem tem perfil admin acumula todas as permissões operacionais, menos ver como e aplicar configuração.', get: (p) => p !== 'ops.verComo' && p !== 'ops.config.aplicar' },
      { id: 'super', nome: 'Superadmin', desc: 'Dono da plataforma: configura, aprova em quatro olhos e acessa saúde, dados e governança.', get: () => true },
    ];
    const head = h('tr', h('th', 'Papel'), perms.map((p) => h('th.sgv-ph', { title: permLabel(p) }, h('span', permLabel(p)))));
    const grid = h('div.tbl-scroll', h('table.tbl.sgv-matrix', h('thead', head),
      h('tbody', linhas.map((l) => h('tr', h('td.sgv-papel', h('strong', l.nome)), perms.map((p) => h('td', { class: 'ta-center' }, l.get(p) ? h('span.sgv-yes', { title: 'Pode: ' + permLabel(p) }, icon('check', 15)) : h('span.sgv-no', { title: 'Não pode: ' + permLabel(p) }, icon('x', 13)))))))));
    const cards = h('div.sgv-grid2', linhas.map((l) => {
      const tem = perms.filter((p) => l.get(p));
      const nao = perms.filter((p) => !l.get(p));
      return ui.card({ title: l.nome, subtitle: l.desc }, h('div.stack.tight',
        h('p.small', h('strong', 'Pode: '), tem.length ? tem.map(permLabel).join(', ') : 'só leitura'),
        nao.length ? h('p.small.muted', h('strong', 'Não pode: '), nao.map(permLabel).join(', ')) : h('p.small.sgv-ok', 'Sem restrições operacionais.')));
    }));
    return h('div.stack',
      ui.card({ title: 'Matriz papel × permissão', subtitle: 'Leitura da mesma regra que o app usa para liberar cada ação.' }, grid),
      h('h3.sgv-h', 'O que cada papel pode e não pode'),
      cards,
      testarPermissao());
  }

  function testarPermissao() {
    let uid = meId(), perm = 'ops.lote';
    const box = ui.card({ title: 'Testar permissão', subtitle: 'Avalia com a mesma regra de liberação do app.' }, h('div'));
    function draw() {
      const u = db.get('users', uid);
      const ok = podeFazer(u, perm);
      C.clear(box.querySelector('.card-body'));
      box.querySelector('.card-body').append(h('div.sgv-testrow',
        ui.field({ label: 'Usuário' }, ui.select({ value: uid, searchable: true, options: internos().map((x) => ({ value: x.id, label: x.nome, hint: papelLabel(x) })), onChange: (v) => { uid = v; draw(); } })),
        ui.field({ label: 'Permissão' }, ui.select({ value: perm, options: [{ value: 'ver', label: 'Ver (leitura)' }, { value: 'admin', label: 'Administrar empresa' }, ...OPS_TODAS().map((p) => ({ value: p, label: permLabel(p) }))], onChange: (v) => { perm = v; draw(); } })),
        h('div.sgv-veredito', ui.badge(ok ? 'Pode' : 'Não pode', ok ? 'green' : 'red', { dot: true }), h('small.muted', u ? `${u.nome} (${papelLabel(u)} · ${perfilLabel(u.perfil)}) ${ok ? 'tem' : 'não tem'} "${permLabel(perm)}".` : 'Usuário não encontrado.'))));
    }
    draw();
    return box;
  }

  const REV = { dec: {} };
  function cicloRev() {
    const t = C.cal.sp(now());
    return t.m >= 7 ? { id: 'rev-' + t.y + '-2', nome: '2º semestre de ' + t.y, fim: C.cal.spTs(t.y, 12, 31, 23, 59) } : { id: 'rev-' + t.y + '-1', nome: '1º semestre de ' + t.y, fim: C.cal.spTs(t.y, 6, 30, 23, 59) };
  }
  function revisaoTab() {
    const ciclo = cicloRev();
    const getFeita = () => ((db.cfg().revisaoAcessosInternos || {}).ciclo === ciclo.id ? db.cfg().revisaoAcessosInternos : null);
    const lista = internos().filter((u) => statusUser(u) === 'ativo');
    const body = h('div.sgv-stack');
    function draw() {
      C.clear(body);
      const feita = getFeita();
      if (feita) {
        body.append(ui.card({ title: 'Revisão concluída', subtitle: ciclo.nome },
          ui.kv([['Concluída em', fmt.datetime(feita.em)], ['Concluída por', nomeUser(feita.por)], ['Resumo', feita.resumo]]),
          ui.callout({ tone: 'success', title: 'Acessos recertificados', text: 'A próxima revisão semestral abre no ciclo seguinte. Para mudanças imediatas, use a aba Equipe.' })));
        return;
      }
      const dec = REV.dec;
      const nd = lista.filter((u) => dec[u.id]).length;
      body.append(
        ui.card({ title: 'Campanha de recertificação', subtitle: ciclo.nome },
          h('div.sgv-camp', h('div', h('strong.sgv-big', `${nd} de ${lista.length}`), h('div.small.muted', 'pessoas decididas')), ui.countdown(ciclo.fim, { prefix: 'prazo termina em' }), ui.progress(lista.length ? (nd / lista.length) * 100 : 0)),
          h('p.small.muted', 'Manter confirma o acesso com papel e perfil atuais. Revogar suspende o acesso na conclusão. A conclusão grava R3 na trilha.')),
        ui.live(['users'], () => ui.table({ rows: lista, rowKey: (r) => r.id,
          columns: [
            { key: 'n', label: 'Pessoa', mobile: 'primary', render: (u) => h('div.cell-row', ui.avatar(u.nome, { size: 'sm', hue: u.hue }), h('div.cell-main', h('strong', u.nome), h('small', papelLabel(u) + ' · ' + perfilLabel(u.perfil)))) },
            { key: 'ac', label: 'Último acesso', mobile: 'hide', render: acessoCell },
            { key: 'd', label: 'Decisão', render: (u) => dec[u.id] ? ui.badge(dec[u.id] === 'manter' ? 'Manter' : 'Revogar', dec[u.id] === 'manter' ? 'green' : 'red', { dot: true }) : h('span.muted.small', 'Pendente') },
            { key: 'a', label: 'Ações', class: 'ta-right', render: (u) => h('div.row.nowrap', ui.btn('Manter', { size: 'sm', variant: 'secondary', icon: dec[u.id] === 'manter' ? 'check' : undefined, onclick: () => { dec[u.id] = 'manter'; draw(); } }), ui.btn('Revogar', { size: 'sm', variant: dec[u.id] === 'revogar' ? 'danger' : 'secondary', onclick: () => { dec[u.id] = 'revogar'; draw(); } })) },
          ] })),
        h('div.sgv-footbar', ui.btn(`Concluir revisão (${nd}/${lista.length})`, { variant: 'primary', icon: 'stamp', disabled: nd < lista.length, title: nd < lista.length ? 'Decida Manter ou Revogar para todas as pessoas' : 'Gravar a revisão na trilha', onclick: concluirRevisao })));
    }
    async function concluirRevisao() {
      const dec = REV.dec;
      const revogados = lista.filter((u) => dec[u.id] === 'revogar');
      if (!(await ui.confirm({ title: 'Concluir a revisão?', text: `${fmt.plural(lista.length - revogados.length, 'acesso mantido', 'acessos mantidos')} e ${fmt.plural(revogados.length, 'revogado', 'revogados')}. A conclusão grava R3 na trilha com o seu nome.`, confirmLabel: 'Concluir revisão' }))) return;
      revogados.forEach((u) => db.patch('users', u.id, { status: 'suspenso' }));
      const resumo = `${fmt.plural(lista.length, 'acesso revisado', 'acessos revisados')} no ${ciclo.nome}: ${fmt.plural(lista.length - revogados.length, 'mantido', 'mantidos')}, ${fmt.plural(revogados.length, 'revogado', 'revogados')}${revogados.length ? ' (' + revogados.map((u) => u.nome).join(', ') + ')' : ''}.`;
      db.setCfg({ revisaoAcessosInternos: { ciclo: ciclo.id, em: now(), por: meId(), resumo } });
      ledger.append({ actor: meActor(), acao: 'revisao_acessos.concluida', entidade: { kind: 'revisao', id: ciclo.id }, resumo: `${meActor().nome} concluiu a revisão de acessos (${ciclo.nome}): ${resumo}`, classe: 'R3', detalhe: { mantidos: lista.length - revogados.length, revogados: revogados.map((u) => u.id) } });
      ui.toast('Revisão concluída', { type: 'success', text: resumo });
      draw();
    }
    draw();
    return h('div.stack', body);
  }

  const KIND_LABEL = { cedente: 'Cedente', financiador: 'Financiador', originador: 'Originador', sacado: 'Sacado' };
  function clientesTab() {
    let q = '';
    let tbl;
    const base = () => db.where('users', (u) => { const o = db.get('orgs', u.orgId); return o && o.kind !== 'cedy'; }).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const filtra = () => { const t = q.trim().toLowerCase(); return base().filter((u) => !t || (u.nome + ' ' + u.email + ' ' + orgCurta(u.orgId)).toLowerCase().includes(t)); };
    tbl = ui.table({ rows: filtra(), rowKey: (r) => r.id, pageSize: 12,
      columns: [
        { key: 'n', label: 'Pessoa', mobile: 'primary', render: (u) => h('div.cell-row', ui.avatar(u.nome, { size: 'sm', hue: u.hue }), h('div.cell-main', h('strong', u.nome), h('small', u.email))) },
        { key: 'e', label: 'Empresa', render: (u) => h('div.cell-main', h('strong', orgCurta(u.orgId)), h('small', KIND_LABEL[(db.get('orgs', u.orgId) || {}).kind] || '')) },
        { key: 'p', label: 'Perfil', mobile: 'hide', render: (u) => h('span.small', u.perfil === 'subparceiro' ? 'Subparceiro' : perfilLabel(u.perfil)) },
        { key: 'a', label: 'Ações', class: 'ta-right', render: (u) => ui.btn('Ver como', { size: 'sm', icon: 'eye', onclick: () => verComoModal(u.id) }) },
      ],
      empty: ui.empty({ icon: 'eye', title: 'Nenhum cliente encontrado', text: 'Ajuste a busca para ver outro usuário.' }) });
    const hist = ledger.all().filter((e) => e.acao === 'acesso.ver_como_iniciado' || e.acao === 'acesso.ver_como_encerrado').slice().sort((a, b) => b.ts - a.ts).slice(0, 20);
    return h('div.stack',
      ui.callout({ tone: 'info', icon: 'eye', title: 'Somente leitura e auditado', text: 'O acesso entra no lugar do cliente sem poder mudar nada, grava R3 na trilha, avisa o cliente e expira sozinho. O suporte da Mesa usa o mesmo fluxo a partir da tela da empresa.' }),
      ui.toolbar(ui.search({ placeholder: 'Buscar por cliente ou empresa', onInput: (v) => { q = v; tbl.setRows(filtra()); } })),
      tbl,
      ui.card({ title: 'Sessões anteriores de ver como', subtitle: 'Inícios e encerramentos registrados na trilha.' },
        hist.length ? ui.table({ rows: hist, rowKey: (r) => r.id, pageSize: 8,
          columns: [
            { key: 'ts', label: 'Quando', render: (e) => h('span.small', { title: fmt.datetime(e.ts) }, fmt.rel(e.ts)) },
            { key: 'q', label: 'Quem', mobile: 'primary', render: (e) => h('span.small', e.actor.nome) },
            { key: 'a', label: 'Evento', render: (e) => ui.badge(e.acao === 'acesso.ver_como_iniciado' ? 'Início' : 'Fim', e.acao === 'acesso.ver_como_iniciado' ? 'amber' : 'neutral', { dot: true }) },
            { key: 'r', label: 'Resumo', render: (e) => h('span.small.muted.sgv-clip', e.resumo) },
          ] }) : ui.empty({ icon: 'history', title: 'Nenhuma sessão ainda', text: 'Os acessos de ver como aparecem aqui.' })));
  }

  /** Fluxo compartilhado de ver como, usado também pela Mesa. C.flows.verComo(userId?) */
  function verComoModal(alvoFixo) {
    let alvo = alvoFixo || null, mins = 15;
    const max = (db.cfg().seguranca || {}).verComoMaxMin || 30;
    if (mins > max) mins = max;
    const durOpts = [10, 15, 30].filter((m) => m <= max);
    if (!durOpts.length) durOpts.push(max);
    const selQuem = ui.select({ value: alvo, placeholder: 'Escolha a pessoa', searchable: true, options: db.where('users', (u) => { const o = db.get('orgs', u.orgId); return o && o.kind !== 'cedy'; }).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')).map((u) => ({ value: u.id, label: u.nome, hint: orgCurta(u.orgId) })), onChange: (v) => { alvo = v; } });
    const wQuem = ui.field({ label: 'Usuário cliente', required: true }, selQuem);
    const fJust = ui.input({ type: 'textarea', placeholder: 'Ex.: acompanhar erro na tela de títulos relatado no chamado 4821' });
    const wJust = ui.field({ label: 'Justificativa', required: true, hint: 'Mínimo de 15 caracteres. Fica na trilha e o cliente é avisado.' }, fJust);
    const selDur = ui.select({ value: mins, options: durOpts.map((m) => ({ value: m, label: m + ' minutos' })), onChange: (v) => (mins = v) });
    const wDur = ui.field({ label: 'Duração máxima', hint: `Teto da política: ${max} min.` }, selDur);
    ui.modal({ title: alvoFixo ? 'Ver como ' + nomeUser(alvoFixo) : 'Ver como cliente', icon: 'eye', size: 'md',
      body: h('div.stack.tight',
        ui.callout({ tone: 'warn', title: 'Acesso auditado', text: 'Somente leitura: o motor recusa qualquer mudança com SOMENTE_LEITURA. O cliente recebe um aviso e a sessão expira sozinha.' }),
        alvoFixo ? h('p.small', h('strong', nomeUser(alvoFixo)), ' · ', orgCurta((db.get('users', alvoFixo) || {}).orgId)) : wQuem, wJust, wDur),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Iniciar ver como', { variant: 'primary', icon: 'eye', onclick: () => {
        if (!alvo) { wQuem.setError('Escolha o usuário cliente.'); return; }
        const just = fJust.value.trim();
        wJust.setError(just.length < 15 ? 'Escreva ao menos 15 caracteres: a justificativa fica na trilha.' : '');
        if (just.length < 15) return;
        const r = E.iniciarVerComo({ alvoUserId: alvo, justificativa: just, minutos: mins });
        if (!r.ok) { ui.toast('Não foi possível iniciar', { type: 'error', text: r.erro }); return; }
        ui.toast('Ver como ativo', { type: 'success', text: 'Somente leitura, auditado e com expiração automática.' });
        api.close(true);
        C.router.go(r.rota);
      } })] });
  }
  F.verComo = function (userId) { verComoModal(userId || null); };

  /* ============================ /super/seguranca ============================ */
  const SESS_OFF = new Set();
  const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/;

  function pgSeguranca(ctx) {
    const tabs = ['politicas', 'sessoes', 'eventos', 'credenciais', 'postura'];
    const st = { tab: tabs.includes(ctx.query.tab) ? ctx.query.tab : 'politicas' };
    const bar = h('div');
    const body = h('div');
    function drawBar() {
      C.clear(bar);
      bar.append(ui.tabs({ value: st.tab, items: [
        { id: 'politicas', label: 'Políticas', icon: 'shield-check' },
        { id: 'sessoes', label: 'Sessões', icon: 'monitor' },
        { id: 'eventos', label: 'Eventos', icon: 'activity' },
        { id: 'credenciais', label: 'Credenciais', icon: 'key-round' },
        { id: 'postura', label: 'Postura', icon: 'radar' },
      ], onChange: (v) => { st.tab = v; draw(); } }));
    }
    function draw() { drawBar(); C.clear(body); body.append(st.tab === 'politicas' ? politicasTab() : st.tab === 'sessoes' ? sessoesTab() : st.tab === 'eventos' ? eventosTab() : st.tab === 'credenciais' ? credenciaisTab() : posturaTab()); }
    draw();
    return h('div.stack', ui.pageHeader({ eyebrow: 'Governança', title: 'Segurança e acessos', subtitle: 'Políticas, sessões ativas, eventos auditados, credenciais e a nota de postura da plataforma.' }), bar, body);
  }

  const POL_ROT = { sessaoMinutos: 'Sessão expira após', tentativasMax: 'Tentativas máximas', senhaMin: 'Tamanho mínimo de senha', ipAllowlistInternos: 'Lista de IPs internos', ipsPermitidos: 'Faixas de IP', verComoMaxMin: 'Teto do ver como', doisFatoresObrigatorio: 'Dois fatores' };

  function politicasTab() {
    const cfg = db.cfg().seguranca || {};
    const nSess = ui.numeric({ value: cfg.sessaoMinutos ?? 60, suffix: 'min', min: 15, max: 480, aria: 'Sessão expira após' });
    const nTent = ui.numeric({ value: cfg.tentativasMax ?? 5, min: 3, max: 10, aria: 'Tentativas máximas' });
    const nSenha = ui.numeric({ value: cfg.senhaMin ?? 10, min: 8, max: 20, aria: 'Tamanho mínimo de senha' });
    const nVer = ui.numeric({ value: cfg.verComoMaxMin ?? 30, suffix: 'min', min: 5, max: 120, aria: 'Duração máxima do ver como' });
    let allow = cfg.ipAllowlistInternos !== false;
    const swAllow = ui.switch({ label: 'Exigir IPs da lista para usuários internos', hint: 'Fora da lista, o acesso interno é recusado.', checked: allow, onChange: (v) => (allow = v) });
    let ips = (cfg.ipsPermitidos || []).slice();
    const ipBox = h('div');
    function drawIps() {
      C.clear(ipBox);
      ipBox.append(ips.length ? h('div.sgv-ips', ips.map((ip) => h('span.chip', icon('globe', 13), h('span.mono.small', ip), h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover ' + ip, onclick: () => { ips = ips.filter((x) => x !== ip); drawIps(); } }, icon('x', 12))))) : h('p.small.muted', 'Nenhum IP registrado: adicione as faixas da rede interna em CIDR.'));
    }
    drawIps();
    const fIp = ui.input({ placeholder: 'Ex.: 10.20.0.0/16', inputmode: 'numeric' });
    const wIp = ui.field({ label: 'Adicionar faixa (CIDR)' }, fIp);
    return h('div.stack',
      ui.card({ title: 'Autenticação interna', subtitle: 'Vale para usuários da Cedy (org-cedy).' },
        h('div.sgv-lockrow', h('div', h('strong', 'Dois fatores obrigatório'), h('div.small.muted', 'Bloqueado: exigido para usuários internos por política da plataforma.')), ui.badge('Sempre ativo', 'green', { icon: 'lock', dot: true })),
        ui.kv([['Cobertura de 2FA na equipe', (() => { const t = internos(); const c = t.filter((u) => u.twofa).length; return `${c} de ${t.length} (${t.length ? Math.round((c / t.length) * 100) : 0}%)`; })()]])),
      ui.card({ title: 'Sessão e senha', subtitle: 'Limites aplicados no próximo acesso.' },
        h('div.sgv-grid3', ui.field({ label: 'Sessão expira após' }, nSess), ui.field({ label: 'Tentativas máximas' }, nTent), ui.field({ label: 'Tamanho mínimo de senha' }, nSenha))),
      ui.card({ title: 'Rede interna', subtitle: 'Faixas liberadas para usuários da Cedy.' }, swAllow, h('div.sp-3'), drawIps && ipBox,
        h('div.sgv-addrow', wIp, ui.btn('Adicionar', { variant: 'secondary', icon: 'plus', onclick: () => {
          const v = fIp.value.trim();
          const m = CIDR.exec(v);
          const octetos = m ? v.split('/')[0].split('.').map(Number) : [];
          const ok = m && Number(m[2]) <= 32 && octetos.every((o) => o >= 0 && o <= 255);
          wIp.setError(ok ? '' : 'Use CIDR válido, ex.: 10.20.0.0/16.');
          if (!ok || ips.includes(v)) return;
          ips.push(v); fIp.value = ''; drawIps();
        } }))),
      ui.card({ title: 'Ver como', subtitle: 'Teto aplicado a suportes e Superadmins.' }, ui.field({ label: 'Duração máxima', hint: 'O acesso expira sozinho ao atingir o teto.' }, nVer)),
      h('div.sgv-footbar', ui.btn('Salvar políticas', { variant: 'primary', icon: 'check', onclick: async () => {
        const novos = { doisFatoresObrigatorio: true, sessaoMinutos: nSess.value, tentativasMax: nTent.value, senhaMin: nSenha.value, ipAllowlistInternos: allow, ipsPermitidos: ips, verComoMaxMin: nVer.value };
        const antesNorm = Object.assign({ ipsPermitidos: [] }, cfg);
        const linhas = Object.keys(novos).filter((k) => JSON.stringify(antesNorm[k]) !== JSON.stringify(novos[k]));
        if (!linhas.length) { ui.toast('Nada para salvar', { type: 'info', text: 'As políticas já estão com estes valores.' }); return; }
        const antes = Object.assign({}, cfg);
        const depois = Object.assign({}, cfg, novos);
        const fmtV = (k, v) => (k === 'ipAllowlistInternos' ? (v ? 'ligada' : 'desligada') : k === 'ipsPermitidos' ? fmt.plural((v || []).length, 'faixa', 'faixas') : /Min$/.test(k) && k !== 'senhaMin' ? v + ' min' : String(v));
        if (!(await ui.confirm({ title: 'Salvar políticas de segurança?', text: linhas.map((k) => `${POL_ROT[k] || k}: ${fmtV(k, antesNorm[k])} para ${fmtV(k, novos[k])}`).join(' · '), confirmLabel: 'Salvar' }))) return;
        db.setCfg({ seguranca: depois });
        ledger.append({ actor: meActor(), acao: 'seguranca.politica_alterada', entidade: { kind: 'config', id: 'seguranca' }, resumo: `${meActor().nome} atualizou as políticas de segurança (${linhas.map((k) => POL_ROT[k] || k).join(', ')})`, classe: 'R2', snapshot: { antes, depois } });
        ui.toast('Políticas salvas', { type: 'success', text: 'Valem para os próximos acessos.' });
      } })));
  }

  const DEVICES = ['Notebook corporativo · Chrome', 'Celular · app Cedy', 'Desktop · Edge', 'Notebook · Safari'];
  const CIDADES = ['São Paulo/SP', 'Rio de Janeiro/RJ', 'Belo Horizonte/MG', 'Curitiba/PR', 'Recife/PE'];
  function sessoesAtivas() {
    return db.all('users').filter((u) => u.ultimoAcesso && !SESS_OFF.has(u.id) && (statusUser(u) === 'ativo') && now() - u.ultimoAcesso <= ((db.cfg().seguranca || {}).sessaoMinutos || 60) * 60e3).sort((a, b) => b.ultimoAcesso - a.ultimoAcesso).slice(0, 14).map((u) => {
      const n = [...u.id].reduce((s, c) => s + c.charCodeAt(0), 0);
      return { user: u, disp: DEVICES[n % DEVICES.length], cidade: CIDADES[n % CIDADES.length], ip: `10.20.${n % 40}.${(n % 200) + 10}` };
    });
  }
  function sessoesTab() {
    const lista = sessoesAtivas();
    return h('div.stack',
      ui.callout({ tone: 'info', icon: 'monitor', title: 'Sessões simuladas', text: 'Demonstração a partir do último acesso de cada pessoa. Encerrar grava um evento de segurança.' }),
      ui.card({ title: 'Sessões ativas', subtitle: fmt.plural(lista.length, 'sessão ativa', 'sessões ativas'), actions: [ui.btn('Encerrar todas', { variant: 'danger', icon: 'power', disabled: !lista.length, onclick: async () => {
        if (!(await ui.confirm({ title: 'Encerrar todas as sessões?', text: `${lista.length} pessoas precisam entrar de novo, incluindo você.`, tone: 'danger', confirmLabel: 'Encerrar todas' }))) return;
        lista.forEach((s) => { SESS_OFF.add(s.user.id); segEvento('sessao_encerrada', s.user.id, s.user.orgId, 'baixa', `Sessão encerrada em massa por ${meActor().nome}.`); });
        ui.toast('Sessões encerradas', { type: 'warn', text: fmt.plural(lista.length, 'sessão encerrada', 'sessões encerradas') + '.' });
        C.router.go('/super/seguranca?tab=sessoes');
      } })] },
        lista.length ? ui.table({ rows: lista, rowKey: (r) => r.user.id,
          columns: [
            { key: 'u', label: 'Pessoa', mobile: 'primary', render: (s) => h('div.cell-row', ui.avatar(s.user.nome, { size: 'sm', hue: s.user.hue }), h('div.cell-main', h('strong', s.user.nome), h('small', orgCurta(s.user.orgId)))) },
            { key: 'd', label: 'Dispositivo', mobile: 'hide', render: (s) => h('span.small', s.disp) },
            { key: 'c', label: 'Cidade', mobile: 'hide', render: (s) => h('span.small', s.cidade) },
            { key: 'ip', label: 'IP', render: (s) => h('span.mono.small', s.ip) },
            { key: 'a', label: 'Última atividade', render: (s) => h('span.small', fmt.rel(s.user.ultimoAcesso)) },
            { key: 'x', label: 'Ações', class: 'ta-right', render: (s) => ui.btn('Encerrar', { size: 'sm', variant: 'secondary', onclick: async () => {
              if (!(await ui.confirm({ title: 'Encerrar sessão de ' + s.user.nome + '?', text: 'A pessoa precisa entrar de novo.', confirmLabel: 'Encerrar' }))) return;
              SESS_OFF.add(s.user.id);
              segEvento('sessao_encerrada', s.user.id, s.user.orgId, 'baixa', `Sessão encerrada por ${meActor().nome}.`);
              ui.toast('Sessão encerrada', { type: 'success', text: s.user.nome });
              C.router.go('/super/seguranca?tab=sessoes');
            } }) },
          ] }) : ui.empty({ icon: 'monitor', title: 'Nenhuma sessão ativa', text: 'Todas as sessões foram encerradas ou expiraram.' })));
  }

  const SEV_TONE = { baixa: 'neutral', media: 'amber', alta: 'red' };
  const SEV_LABEL = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };
  const TIPO_LABEL = { login_falho: 'Login com falha', mfa_reset: '2FA redefinido', ver_como: 'Ver como', chave_criada: 'Chave criada', ip_bloqueado: 'IP bloqueado', permissao_alterada: 'Permissão alterada', sessao_encerrada: 'Sessão encerrada' };
  function detectarBruteforce() {
    const porIp = C.groupBy(db.where('eventosSeg', (e) => e.tipo === 'login_falho'), (e) => e.ip);
    const achados = [];
    Object.entries(porIp).forEach(([ip, evs]) => {
      const ord = evs.slice().sort((a, b) => a.ts - b.ts);
      for (let i = 0; i < ord.length; i++) {
        const janela = ord.filter((e) => e.ts >= ord[i].ts && e.ts - ord[i].ts <= 30 * 60e3);
        if (janela.length >= 5) { achados.push({ ip, qtd: janela.length, desde: janela[0].ts, ate: janela[janela.length - 1].ts, usuarios: [...new Set(janela.map((e) => e.userId))] }); break; }
      }
    });
    return achados;
  }
  function eventosTab() {
    const st = { tipo: 'todos', sev: 'todas', periodo: 'todos', q: '' };
    let tbl;
    const base = () => db.all('eventosSeg').slice().sort((a, b) => b.ts - a.ts);
    const filtra = () => base().filter((e) => {
      if (st.tipo !== 'todos' && e.tipo !== st.tipo) return false;
      if (st.sev !== 'todas' && e.severidade !== st.sev) return false;
      if (st.periodo !== 'todos' && now() - e.ts > Number(st.periodo) * DAY) return false;
      if (st.q.trim() && !(nomeUser(e.userId) + ' ' + e.ip + ' ' + e.detalhe).toLowerCase().includes(st.q.trim().toLowerCase())) return false;
      return true;
    });
    tbl = ui.table({ rows: filtra(), rowKey: (r) => r.id, pageSize: 15,
      columns: [
        { key: 'ts', label: 'Quando', render: (e) => h('span.small', { title: fmt.datetime(e.ts) }, fmt.rel(e.ts)) },
        { key: 't', label: 'Tipo', mobile: 'primary', render: (e) => ui.badge(TIPO_LABEL[e.tipo] || e.tipo, e.tipo === 'login_falho' || e.tipo === 'ip_bloqueado' ? 'red' : e.tipo === 'ver_como' ? 'amber' : 'neutral', { dot: true }) },
        { key: 's', label: 'Severidade', render: (e) => ui.badge(SEV_LABEL[e.severidade] || e.severidade, SEV_TONE[e.severidade] || 'neutral') },
        { key: 'u', label: 'Usuário', mobile: 'hide', render: (e) => h('span.small', nomeUser(e.userId)) },
        { key: 'ip', label: 'IP', render: (e) => h('span.mono.small', e.ip) },
        { key: 'd', label: 'Detalhe', mobile: 'hide', render: (e) => h('span.small.muted.sgv-clip', e.detalhe) },
      ],
      onRowClick: (e) => ui.drawer({ title: TIPO_LABEL[e.tipo] || e.tipo, subtitle: fmt.datetime(e.ts), icon: 'activity', size: 'md',
        body: h('div.stack.tight', ui.kv([['Tipo', TIPO_LABEL[e.tipo] || e.tipo], ['Severidade', SEV_LABEL[e.severidade] || e.severidade], ['Usuário', nomeUser(e.userId)], ['Empresa', orgCurta(e.orgId)], ['IP', h('span.mono', e.ip)]]), h('h4.sgv-h', 'Detalhe'), h('p.small', e.detalhe)) }),
      empty: ui.empty({ icon: 'activity', title: 'Nenhum evento', text: 'Ajuste os filtros para ver outros eventos.' }) });
    const aplica = () => tbl.setRows(filtra());
    const bloqueados = (db.cfg().seguranca || {}).ipsBloqueados || [];
    const ataques = detectarBruteforce();
    return h('div.stack',
      ataques.length ? ui.card({ title: 'Possível força bruta', subtitle: 'Mesmo IP com 5 ou mais falhas de login em 30 minutos.' },
        h('div.stack.tight', ataques.map((a) => {
          const bloqueado = bloqueados.includes(a.ip);
          return h('div.sgv-atk', h('div', h('strong.mono', a.ip), h('div.small.muted', `${a.qtd} falhas entre ${fmt.datetime(a.desde)} e ${fmt.datetime(a.ate)} · ${a.usuarios.map(nomeUser).join(', ')}`)),
            bloqueado ? h('div.row.nowrap', ui.badge('Bloqueado', 'red', { dot: true }), ui.btn('Desbloquear', { size: 'sm', variant: 'secondary', onclick: async () => {
              if (!(await ui.confirm({ title: 'Desbloquear ' + a.ip + '?', text: 'O IP volta a alcançar o acesso.', confirmLabel: 'Desbloquear' }))) return;
              const cfg = db.cfg().seguranca || {};
              db.setCfg({ seguranca: Object.assign({}, cfg, { ipsBloqueados: (cfg.ipsBloqueados || []).filter((x) => x !== a.ip) }) });
              segEvento('ip_bloqueado', meId(), 'org-cedy', 'media', `IP ${a.ip} desbloqueado por ${meActor().nome} após revisão.`);
              ui.toast('IP desbloqueado', { type: 'success', text: a.ip });
              C.router.go('/super/seguranca?tab=eventos');
            } })) : ui.btn('Bloquear IP', { size: 'sm', variant: 'danger', icon: 'ban', onclick: async () => {
              if (!(await ui.confirm({ title: 'Bloquear ' + a.ip + '?', text: `${a.qtd} falhas em 30 minutos. O bloqueio entra na hora e fica auditado.`, tone: 'danger', confirmLabel: 'Bloquear IP' }))) return;
              const cfg = db.cfg().seguranca || {};
              db.setCfg({ seguranca: Object.assign({}, cfg, { ipsBloqueados: [...(cfg.ipsBloqueados || []), a.ip] }) });
              segEvento('ip_bloqueado', meId(), 'org-cedy', 'alta', `IP ${a.ip} bloqueado por ${meActor().nome} após ${a.qtd} falhas de login em 30 min.`);
              ui.toast('IP bloqueado', { type: 'warn', text: a.ip });
              C.router.go('/super/seguranca?tab=eventos');
            } }));
        }))) : null,
      ui.toolbar(
        ui.select({ value: st.tipo, aria: 'Filtrar por tipo', options: [{ value: 'todos', label: 'Todos os tipos' }, ...Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }))], onChange: (v) => { st.tipo = v; aplica(); } }),
        ui.select({ value: st.sev, aria: 'Filtrar por severidade', options: [{ value: 'todas', label: 'Todas as severidades' }, { value: 'baixa', label: 'Baixa' }, { value: 'media', label: 'Média' }, { value: 'alta', label: 'Alta' }], onChange: (v) => { st.sev = v; aplica(); } }),
        ui.select({ value: st.periodo, aria: 'Filtrar por período', options: [{ value: 'todos', label: 'Qualquer período' }, { value: '1', label: 'Últimas 24h' }, { value: '7', label: 'Últimos 7 dias' }, { value: '30', label: 'Últimos 30 dias' }], onChange: (v) => { st.periodo = v; aplica(); } }),
        ui.search({ placeholder: 'Buscar usuário, IP ou detalhe', onInput: (v) => { st.q = v; aplica(); } })),
      sync(['eventosSeg'], aplica),
      tbl);
  }

  const ESCOPO_LABEL = { leitura: 'Leitura', operar_aprovado: 'Operar com aprovação', admin: 'Administração' };
  const escoposDe = (r) => r.escopos || r.eventos || [];
  const ehElevada = (r) => escoposDe(r).includes('operar_aprovado') || escoposDe(r).includes('admin');
  const diasSemUso = (r) => (r.ultimoUso ? Math.floor((now() - r.ultimoUso) / DAY) : Math.floor((now() - r.criadoEm) / DAY));
  const ehObsoleta = (r) => diasSemUso(r) >= 60;
  function credenciaisTab() {
    const todas = db.all('integracoes').slice().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
    const st = { q: '' };
    let tbl;
    const filtra = () => { const t = st.q.trim().toLowerCase(); return todas.filter((r) => !t || (r.nome + ' ' + orgCurta(r.orgId) + ' ' + escoposDe(r).join(' ')).toLowerCase().includes(t)); };
    tbl = ui.table({ rows: filtra(), rowKey: (r) => r.id, pageSize: 12,
      columns: [
        { key: 'n', label: 'Credencial', mobile: 'primary', render: (r) => h('div.cell-row', icon(r.kind === 'agente' ? 'bot' : r.kind === 'webhook' ? 'webhook' : 'key-round', 16), h('div.cell-main', h('strong', r.nome), h('small', r.kind === 'agente' ? 'Identidade de agente' : r.kind === 'webhook' ? 'Webhook' : 'Token de API'))) },
        { key: 'e', label: 'Empresa', render: (r) => h('span.small', orgCurta(r.orgId)) },
        { key: 'esc', label: 'Escopos', mobile: 'hide', render: (r) => h('span.small', escoposDe(r).map((s) => ESCOPO_LABEL[s] || s).join(', ') || '—') },
        { key: 'c', label: 'Criada em', mobile: 'hide', render: (r) => h('span.small', fmt.date(r.criadoEm)) },
        { key: 'u', label: 'Último uso', render: (r) => h('span.small', r.ultimoUso ? fmt.rel(r.ultimoUso) : 'nunca') },
        { key: 's', label: 'Situação', render: (r) => h('div.sgv-flags', ui.badge(r.status === 'ativo' ? 'Ativa' : 'Revogada', r.status === 'ativo' ? 'green' : 'neutral', { dot: true }), r.status === 'ativo' && ehObsoleta(r) ? ui.badge('Sem uso há 60+ dias', 'amber') : null, r.status === 'ativo' && ehElevada(r) ? ui.badge('Elevada', 'amber', { title: 'Escopo além de leitura' }) : null) },
        { key: 'a', label: 'Ações', class: 'ta-right', render: (r) => r.status === 'ativo' ? ui.btn('Revogar', { size: 'sm', variant: 'ghost', onclick: () => revogarCred(r) }) : h('span') },
      ],
      empty: ui.empty({ icon: 'key-round', title: 'Nenhuma credencial', text: 'As credenciais criadas nas empresas aparecem aqui.' }) });
    const velhas = todas.filter((r) => r.status === 'ativo' && now() - r.criadoEm > 180 * DAY);
    const syncCred = sync(['integracoes'], () => tbl.setRows(filtra()));
    return h('div.stack',
      ui.callout({ tone: 'info', icon: 'key-round', title: 'Visão de todas as empresas', text: 'Identidades de agente, tokens e webhooks de cada empresa em um lugar só. Sem uso há 60 dias ou mais pede rotação ou revogação. Escopo além de leitura aparece como elevado.' }),
      ui.toolbar(ui.search({ placeholder: 'Buscar por nome, empresa ou escopo', onInput: (v) => { st.q = v; tbl.setRows(filtra()); } })),
      syncCred,
      tbl,
      ui.card({ title: 'Lembretes de rotação de segredo', subtitle: 'Credenciais ativas criadas há mais de 180 dias. Rotacionar aqui é demonstração: gera um novo segredo simulado.' },
        velhas.length ? ui.table({ rows: velhas, rowKey: (r) => r.id,
          columns: [
            { key: 'n', label: 'Credencial', mobile: 'primary', render: (r) => h('div.cell-main', h('strong', r.nome), h('small', orgCurta(r.orgId))) },
            { key: 'c', label: 'Criada há', render: (r) => h('span.small', fmt.rel(r.criadoEm)) },
            { key: 'u', label: 'Último uso', mobile: 'hide', render: (r) => h('span.small', r.ultimoUso ? fmt.rel(r.ultimoUso) : 'nunca') },
            { key: 'a', label: 'Ações', class: 'ta-right', render: (r) => ui.btn('Rotacionar', { size: 'sm', variant: 'secondary', icon: 'refresh-cw', title: 'Demonstração: gera um segredo simulado', onclick: () => {
              db.patch('integracoes', r.id, { rotacionadoEm: now() });
              ledger.append({ actor: meActor(), acao: 'integracao.rotacionada', entidade: { kind: 'integracao', id: r.id }, resumo: `${meActor().nome} rotacionou o segredo de ${r.nome} (${orgCurta(r.orgId)}) em demonstração`, classe: 'R2' });
              ui.toast('Segredo rotacionado (demonstração)', { type: 'success', text: r.nome });
            } }) },
          ] }) : ui.empty({ icon: 'check', title: 'Nada para rotacionar', text: 'Nenhuma credencial ativa passa de 180 dias.' })));
  }
  function posturaTab() {
    const t = internos();
    const com2fa = t.filter((u) => u.twofa).length;
    const pct2fa = t.length ? (com2fa / t.length) * 100 : 100;
    const nunca = t.filter((u) => !u.ultimoAcesso);
    const porOrg = C.groupBy(db.where('users', (u) => { const o = db.get('orgs', u.orgId); return o && o.kind !== 'cedy' && u.perfil === 'admin'; }), (u) => u.orgId);
    const orgsFora = Object.entries(porOrg).filter(([, us]) => us.length > 3);
    const orgsSemAdmin = db.where('orgs', (o) => { if (o.kind === 'cedy' || o.status !== 'ativo') return false; const us = db.where('users', (u) => u.orgId === o.id); return us.length > 0 && !us.some((u) => u.perfil === 'admin'); });
    const obsoletas = db.where('integracoes', (r) => r.status === 'ativo' && ehObsoleta(r));
    const altas = db.where('eventosSeg', (e) => e.severidade === 'alta' && now() - e.ts < 30 * DAY);
    const sessMin = (db.cfg().seguranca || {}).sessaoMinutos || 60;
    const F = [];
    F.push({ id: '2fa', titulo: 'Cobertura de 2FA na equipe', peso: 25, st: pct2fa >= 90 ? 'ok' : pct2fa >= 70 ? 'warn' : 'crit', detalhe: `${com2fa} de ${t.length} com segundo fator (${Math.round(pct2fa)}%).`, fix: ['Ativar na Equipe', '/super/usuarios'] });
    F.push({ id: 'nunca', titulo: 'Acessos nunca usados', peso: 10, st: !nunca.length ? 'ok' : nunca.length === 1 ? 'warn' : 'crit', detalhe: nunca.length ? nunca.map((u) => u.nome).join(', ') + ' nunca acessaram.' : 'Todo mundo já acessou ao menos uma vez.', fix: ['Ver equipe', '/super/usuarios'] });
    const probs = [...orgsFora.map(([id, us]) => `${orgCurta(id)} com ${us.length} admins`), ...orgsSemAdmin.map((o) => `${o.fantasia || o.nome} sem admin`)];
    F.push({ id: 'adm', titulo: 'Administradores por empresa', peso: 15, st: !probs.length ? 'ok' : probs.length <= 2 ? 'warn' : 'crit', detalhe: !probs.length ? 'Toda empresa com usuários tem de 1 a 3 administradores.' : probs.slice(0, 3).join(' · ') + (probs.length > 3 ? ` e mais ${probs.length - 3}` : '') + '.', fix: ['Ver clientes', '/super/usuarios?tab=clientes'] });
    F.push({ id: 'cred', titulo: 'Credenciais obsoletas', peso: 15, st: !obsoletas.length ? 'ok' : obsoletas.length <= 2 ? 'warn' : 'crit', detalhe: obsoletas.length ? obsoletas.map((r) => `${r.nome} (${orgCurta(r.orgId)})`).join(', ') + ' sem uso há 60 dias ou mais.' : 'Nenhuma credencial ativa sem uso há 60 dias.', fix: ['Rotacionar ou revogar', '/super/seguranca?tab=credenciais'] });
    F.push({ id: 'sev', titulo: 'Eventos graves em 30 dias', peso: 20, st: !altas.length ? 'ok' : altas.length <= 2 ? 'warn' : 'crit', detalhe: altas.length ? fmt.plural(altas.length, 'evento de severidade alta', 'eventos de severidade alta') + ' nos últimos 30 dias.' : 'Nenhum evento de severidade alta nos últimos 30 dias.', fix: ['Investigar eventos', '/super/seguranca?tab=eventos'] });
    F.push({ id: 'idle', titulo: 'Tempo de sessão', peso: 15, st: sessMin <= 60 ? 'ok' : sessMin <= 120 ? 'warn' : 'crit', detalhe: `A sessão expira após ${sessMin} min de inatividade (recomendado: até 60 min).`, fix: ['Ajustar na política', '/super/seguranca?tab=politicas'] });
    const nota = Math.max(0, Math.round(100 - C.sum(F, (f) => (f.st === 'ok' ? 0 : f.st === 'warn' ? f.peso / 2 : f.peso))));
    const tone = nota >= 85 ? 'green' : nota >= 65 ? 'amber' : 'red';
    const rotulo = nota >= 85 ? 'Saudável' : nota >= 65 ? 'Atenção' : 'Crítica';
    return h('div.stack',
      ui.card({ title: 'Nota de postura de segurança', subtitle: 'Calculada na hora a partir dos dados da plataforma.' },
        h('div.sgv-score', h('div', h('strong.sgv-big', nota + '/100'), h('div.small.muted', rotulo)), ui.progress(nota, { tone }), h('p.small.muted', 'Pesos: 2FA 25, eventos graves 20, admins por empresa 15, credenciais 15, tempo de sessão 15, acessos nunca usados 10.')),
        ui.live(['users', 'integracoes', 'eventosSeg'], () => h('span.small.muted', 'Atualizado ' + fmt.time(now())), { tag: 'span' })),
      ui.grid(2, F.map((f) => ui.card({ title: f.titulo },
        h('div.sgv-fator', ui.badge(f.st === 'ok' ? 'Sob controle' : f.st === 'warn' ? 'Atenção' : 'Crítico', f.st === 'ok' ? 'green' : f.st === 'warn' ? 'amber' : 'red', { dot: true })),
        h('p.small', f.detalhe),
        ui.link(f.fix[0] + ' →', f.fix[1])))));
  }

  async function revogarCred(r) {
    if (!(await ui.confirm({ title: 'Revogar ' + r.nome + '?', text: `Chamadas desta credencial de ${orgCurta(r.orgId)} passam a falhar na hora.`, tone: 'danger', confirmLabel: 'Revogar' }))) return;
    db.patch('integracoes', r.id, { status: 'revogado' });
    ledger.append({ actor: meActor(), acao: 'integracao.revogada', entidade: { kind: 'integracao', id: r.id }, resumo: `${meActor().nome} revogou a credencial ${r.nome} (${orgCurta(r.orgId)})`, classe: 'R2' });
    ui.toast('Credencial revogada', { type: 'warn', text: r.nome });
  }

  /* ============================ /super/aprovacoes ============================ */
  const CLASSE_TONE = { R2: 'amber', R3: 'red' };
  const classeBadge = (c) => ui.badge(c, CLASSE_TONE[c] || 'neutral', { title: c === 'R3' ? 'Classe R3: dinheiro ou cessão, sempre com pessoa' : 'Classe R2: financeiro dentro do envelope de regras' });
  const tipoLabel = (t) => (E.APROVACAO_TIPOS[t] || {}).label || t;

  function diffPorTipo(a) {
    const p = a.payload || {};
    if (a.tipo === 'config') return diffKv(a.antes, a.depois, CONFIG_ROT);
    if (a.tipo === 'programa') {
      const prod = (a.depois && db.get('produtos', a.depois.id)) || a.depois || {};
      const va = (a.antes || {}).versao, vd = (a.depois || {}).versao;
      const temVersao = (va !== undefined && va !== null && va !== '') || (vd !== undefined && vd !== null && vd !== '');
      return h('div.stack.tight', h('p.small', h('strong', prod.nome || 'Programa'), temVersao ? ' · nova versão publicada' : null), diffKv(a.antes, a.depois, { versao: 'Versão', ticketMin: 'Ticket mínimo', permiteSemRegresso: 'Dispensa regresso', vigenteDesde: 'Vigente desde' }));
    }
    if (a.tipo === 'autonomia') {
      const ag = db.get('agentes', p.agenteId);
      return h('div.stack.tight', h('p.small', 'Agente: ', h('strong', ag ? ag.nome : p.agenteId)), diffKv({ nivel: (a.antes || {}).nivel }, { nivel: (a.depois || {}).nivel }, { nivel: 'Nível' }));
    }
    if (a.tipo === 'premiacao_pagar') {
      const lista = (p.ids || []).map((id) => db.get('premiacoes', id)).filter((x) => x && x.competencia);
      const total = C.sum(lista, (x) => x.total || 0);
      if (!lista.length) return h('p.small.muted', 'Nenhuma premiação localizada.');
      return h('div.stack.tight', ui.table({ rows: lista, rowKey: (r) => r.id,
        columns: [
          { key: 'id', label: 'Premiação', mobile: 'primary', render: (x) => h('span.mono.small', x.id) },
          { key: 'c', label: 'Competência', render: (x) => h('span.small', fmt.monthLong(x.competencia)) },
          { key: 'ced', label: 'Cedente', mobile: 'hide', render: (x) => h('span.small', orgCurta(x.cedenteId)) },
          { key: 'v', label: 'Valor', align: 'right', render: (x) => ui.money(x.total) },
        ] }), h('p.small', h('strong', 'Total a pagar: '), ui.money(total)));
    }
    if (a.tipo === 'fatura_isentar') {
      const f = db.get('faturas', p.faturaId);
      return h('div.stack.tight', ui.kv([['Fatura', h('span.mono', p.faturaId)], ['Financiador', f ? orgCurta(f.finId) : '—'], ['Valor', f ? fmt.brl(f.total) : '—'], ['Situação', 'aberta para isenta'], ['Motivo', p.motivo || a.motivo || '—']]));
    }
    return diffKv(a.antes, a.depois);
  }

  function textoAplicado(a) {
    const p = a.payload || {};
    if (a.tipo === 'config') return 'Parâmetro aplicado: ' + Object.keys(p.patch || {}).map((k) => CONFIG_ROT[k] || k).join(', ') + '.';
    if (a.tipo === 'programa') return `Nova versão publicada: ${(p.produto || {}).nome || 'programa'}.`;
    if (a.tipo === 'autonomia') { const ag = db.get('agentes', p.agenteId); return `Nível atualizado: ${ag ? ag.nome : p.agenteId}.`; }
    if (a.tipo === 'premiacao_pagar') return fmt.plural((p.ids || []).length, 'premiação marcada como paga', 'premiações marcadas como pagas') + '.';
    if (a.tipo === 'fatura_isentar') return 'Fatura marcada como isenta.';
    return 'Efeito aplicado.';
  }

  function listaVazia(tab) {
    return ui.empty({ icon: tab === 'pendentes' ? 'circle-check' : 'stamp', title: tab === 'pendentes' ? 'Nada pendente' : 'Nada por aqui', text: tab === 'pendentes' ? 'Todas as solicitações foram decididas. Bom trabalho de quatro olhos.' : 'Ajuste os filtros para ver outras solicitações.' });
  }
  function pgAprovacoes(ctx) {
    const tabs = ['pendentes', 'decididas', 'expiradas', 'todas'];
    const st = { tab: tabs.includes(ctx.query.tab) ? ctx.query.tab : 'pendentes', tipo: 'todos', classe: 'todas', sol: 'todos' };
    const bar = h('div');
    const listaBox = h('div');
    const todas = () => db.all('aprovacoes').slice().sort((a, b) => b.solicitadoEm - a.solicitadoEm);
    const porTab = (t) => todas().filter((a) => t === 'todas' ? true : t === 'pendentes' ? a.status === 'pendente' : t === 'decididas' ? ['aprovada', 'rejeitada'].includes(a.status) : a.status === 'expirada');
    function drawBar() {
      C.clear(bar);
      bar.append(ui.tabs({ value: st.tab, items: [
        { id: 'pendentes', label: 'Pendentes', icon: 'hourglass', count: porTab('pendentes').length },
        { id: 'decididas', label: 'Decididas', icon: 'stamp', count: porTab('decididas').length },
        { id: 'expiradas', label: 'Expiradas', icon: 'calendar', count: porTab('expiradas').length },
        { id: 'todas', label: 'Todas', icon: 'list', count: todas().length },
      ], onChange: (v) => { st.tab = v; drawLista(); } }));
    }
    function filtra() {
      return porTab(st.tab).filter((a) => {
        if (st.tipo !== 'todos' && a.tipo !== st.tipo) return false;
        if (st.classe !== 'todas' && a.classe !== st.classe) return false;
        return st.sol === 'todos' || a.solicitanteId === st.sol;
      });
    }
    function drawLista() {
      drawBar();
      C.clear(listaBox);
      const rows = filtra();
      listaBox.append(rows.length ? h('div.stack', rows.map((a) => aprovCard(a))) : listaVazia(st.tab));
    }
    const solicitantes = [...new Set(todas().map((a) => a.solicitanteId))].map((id) => ({ value: id, label: nomeUser(id) }));
    drawLista();
    const syncAp = sync(['aprovacoes'], drawLista);
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Governança', title: 'Aprovações', subtitle: 'Central de quatro olhos: quem pediu não decide, só o Superadmin aprova.' }),
      ui.live(['aprovacoes'], () => faixaResumo()),
      bar,
      ui.toolbar(
        ui.select({ value: st.tipo, aria: 'Filtrar por tipo', options: [{ value: 'todos', label: 'Todos os tipos' }, ...Object.entries(E.APROVACAO_TIPOS).map(([value, d]) => ({ value, label: d.label }))], onChange: (v) => { st.tipo = v; drawLista(); } }),
        ui.select({ value: st.classe, aria: 'Filtrar por classe', options: [{ value: 'todas', label: 'Todas as classes' }, { value: 'R2', label: 'Classe R2' }, { value: 'R3', label: 'Classe R3' }], onChange: (v) => { st.classe = v; drawLista(); } }),
        ui.select({ value: st.sol, aria: 'Filtrar por solicitante', options: [{ value: 'todos', label: 'Todos os solicitantes' }, ...solicitantes], onChange: (v) => { st.sol = v; drawLista(); } })),
      syncAp,
      listaBox);
  }

  function faixaResumo() {
    const todas = db.all('aprovacoes');
    const pend = todas.filter((a) => a.status === 'pendente');
    const dec = todas.filter((a) => ['aprovada', 'rejeitada'].includes(a.status));
    const apr = todas.filter((a) => a.status === 'aprovada');
    const media = dec.length ? C.sum(dec, (a) => a.decididoEm - a.solicitadoEm) / dec.length : 0;
    return h('div.sgv-strip', ui.kpi({ label: 'Pendentes', value: pend.length, hint: pend.length ? pend.filter((x) => x.classe === 'R3').length + ' em R3 e ' + pend.filter((x) => x.classe !== 'R3').length + ' em R2' : 'Nada aguardando decisão', icon: 'hourglass', tone: pend.length ? 'amber' : 'green' }),
      ui.kpi({ label: 'Tempo médio de decisão', display: dec.length ? fmt.dur(media) : '—', hint: fmt.plural(dec.length, 'decisão', 'decisões'), icon: 'timer' }),
      ui.kpi({ label: 'Aprovadas', display: dec.length ? fmt.pct((apr.length / dec.length) * 100, 0) : '—', hint: fmt.plural(apr.length, 'aprovada', 'aprovadas') + ' de ' + fmt.plural(dec.length, 'decidida', 'decididas'), icon: 'stamp' }));
  }

  function aprovCard(a) {
    const eu = meId();
    const souSolicitante = a.solicitanteId === eu;
    const decidida = a.status === 'aprovada' || a.status === 'rejeitada';
    const foot = a.status === 'pendente'
      ? h('div.sgv-aprfoot', h('div.small.muted', 'Solicitada por ', h('strong', nomeUser(a.solicitanteId)), ' · ', fmt.rel(a.solicitadoEm)),
        h('div.row.nowrap', ui.btn('Rejeitar', { size: 'sm', variant: 'ghost', disabled: souSolicitante, title: souSolicitante ? 'Dois olhos: outra pessoa precisa decidir' : 'Recusar com motivo', onclick: () => rejeitarFlow(a) }),
          ui.btn('Aprovar', { size: 'sm', variant: 'primary', icon: 'check', disabled: souSolicitante, title: souSolicitante ? 'Dois olhos: outra pessoa precisa aprovar' : 'Aplicar o efeito e registrar na trilha', onclick: () => aprovarFlow(a) })),
          souSolicitante ? h('p.small.sgv-dois', 'Dois olhos: quem solicitou não pode decidir. Outra pessoa Superadmin precisa aprovar.') : null)
      : h('div.sgv-aprfoot', ui.badge(a.status === 'aprovada' ? 'Aprovada' : a.status === 'rejeitada' ? 'Rejeitada' : 'Expirada', a.status === 'aprovada' ? 'green' : a.status === 'rejeitada' ? 'red' : 'neutral', { dot: true }),
        h('div.small.muted', decidida ? `Por ${nomeUser(a.decididoPor)} em ${fmt.datetime(a.decididoEm)}${a.motivoDecisao ? ': ' + a.motivoDecisao : ''}` : `Expirou em ${fmt.datetime(a.expiraEm)} sem decisão`));
    return ui.card({ class: 'sgv-apr' },
      h('div.sgv-aprhead', ui.badge(tipoLabel(a.tipo), 'blue'), classeBadge(a.classe),
        a.status === 'pendente' ? ui.countdown(a.expiraEm, { prefix: 'expira em' }) : h('span.mono.small.muted', a.id)),
      h('h3.sgv-aprt', a.titulo),
      a.resumo ? h('p.small.muted', a.resumo) : null,
      h('p.small', h('strong', 'Motivo do pedido: '), a.motivo || '—'),
      h('h4.sgv-h', 'Antes e depois'),
      diffPorTipo(a),
      ui.divider(), foot);
  }

  async function aprovarFlow(a) {
    if (!(await ui.confirm({ title: 'Aprovar ' + a.id + '?', text: textoAplicado(a) + ' O efeito entra na hora e a decisão grava ' + a.classe + ' na trilha com o seu nome.', confirmLabel: 'Aprovar e aplicar' }))) return;
    const r = E.decidirAprovacao(a.id, 'aprovar', meId());
    if (!r.ok) { ui.toast('Não foi possível aprovar', { type: 'error', text: r.erro }); return; }
    ui.toast('Solicitação aprovada', { type: 'success', text: textoAplicado(a) });
  }
  async function rejeitarFlow(a) {
    const fMot = ui.input({ type: 'textarea', placeholder: 'Ex.: firmeza maior trava o leilão, manter 3h' });
    const wMot = ui.field({ label: 'Motivo da rejeição', required: true, hint: 'O solicitante recebe este motivo.' }, fMot);
    const m = ui.modal({ title: 'Rejeitar ' + a.id, icon: 'stamp', size: 'sm', body: wMot,
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Rejeitar', { variant: 'danger', onclick: () => {
        const mot = fMot.value.trim();
        wMot.setError(mot.length < 5 ? 'Informe o motivo da rejeição.' : '');
        if (mot.length < 5) return;
        const r = E.decidirAprovacao(a.id, 'rejeitar', meId(), mot);
        if (!r.ok) { ui.toast('Não foi possível rejeitar', { type: 'error', text: r.erro }); return; }
        ui.toast('Solicitação rejeitada', { type: 'warn', text: 'O solicitante recebe o motivo.' });
        api.close(true);
      } })] });
    return m.promise;
  }

  /* ------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/super/usuarios', roles: ['ops'], perfis: ['superadmin'], title: 'Usuários internos e papéis', render: pgUsuarios },
    { path: '/super/seguranca', roles: ['ops'], perfis: ['superadmin'], title: 'Segurança e acessos', render: pgSeguranca },
    { path: '/super/aprovacoes', roles: ['ops'], perfis: ['superadmin'], title: 'Aprovações', render: pgAprovacoes },
  ]);
})();



