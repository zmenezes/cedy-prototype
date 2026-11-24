/* Cedy auth: login, 2FA, recuperação, cadastro, convite, expiração de sessão.
   Rotas públicas (shell:false). Protótipo: qualquer senha não vazia vale no login. */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui;
  const { db, session, ledger, notify } = C.store;

  /* ----------------------------- validações ----------------------------- */
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const trim = (v) => String(v == null ? '' : v).trim();
  function dvCnpj(base) {
    const w = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = base.split('').reduce((a, d, i) => a + Number(d) * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  }
  const cnpjValido = (s) => { const d = digits(s); if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false; return dvCnpj(d.slice(0, 12)) === Number(d[12]) && dvCnpj(d.slice(0, 13)) === Number(d[13]); };
  const cpfValido = (s) => {
    const d = digits(s); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += Number(d[i]) * (n + 1 - i); const r = (t * 10) % 11; return (r === 10 ? 0 : r) === Number(d[n]); };
    return dv(9) && dv(10);
  };
  const emailValido = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trim(s));
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'empresa';
  const roleOf = (org) => (org.kind === 'cedy' ? 'ops' : org.kind);
  const perfilLabel = (p) => ({ admin: 'Administrador', operador: 'Operador', leitor: 'Leitor', superadmin: 'Superadmin', subparceiro: 'Subparceiro' }[p] || p);
  const DEMO_CODE = '123456';

  function completeLogin(user) {
    const org = db.get('orgs', user.orgId);
    db.patch('users', user.id, { ultimoAcesso: C.clock.now() });
    session.set({ userId: user.id, orgId: user.orgId, role: roleOf(org) });
    ledger.append({ actor: C.engine.actors.user(user.id), acao: 'acesso.login', entidade: { kind: 'org', id: org.id }, resumo: `${user.nome} entrou na plataforma`, classe: 'R1' });
    ui.toast(`Bem-vindo, ${user.nome.split(' ')[0]}`, { type: 'success', text: `${org.fantasia || org.nome} · ${C.roles[C.keyOfUser(user, org)].label}` });
    const after = sessionStorage.getItem('cedy-after-login'); sessionStorage.removeItem('cedy-after-login');
    const home = (after && after.startsWith('#/') && !after.startsWith('#/entrar') && !after.startsWith('#/cadastro')) ? after.slice(1) : C.roles[C.keyOfUser(user, org)].home;
    C.router.go(home);
  }

  let PENDING = null;
  try { PENDING = JSON.parse(sessionStorage.getItem('cedy-pending-2fa') || 'null'); } catch (e) { PENDING = null; }
  const setPending = (p) => { PENDING = p; if (p) sessionStorage.setItem('cedy-pending-2fa', JSON.stringify(p)); else sessionStorage.removeItem('cedy-pending-2fa'); };

  const A = {};
  A.logout = function (silent) { session.clear(); C.router.resetStack(); setPending(null); if (!silent) ui.toast('Sessão encerrada', { text: 'Até logo.' }); C.router.go('/entrar'); };
  A.login = completeLogin;
  A.expire = function () {
    const u = session.get() && session.user();
    const pwIn = ui.input({ type: 'password', placeholder: 'Sua senha de demonstração', autocomplete: 'current-password' });
    const pw = ui.field({ label: 'Senha', required: true }, pwIn);
    const m = ui.modal({ title: 'Sua sessão expirou', subtitle: 'Entre novamente para continuar de onde parou.', icon: 'lock', tone: 'amber', size: 'sm',
      body: h('div.stack.tight', ui.callout({ tone: 'warn', title: 'Demonstração', text: 'Nenhum dado foi perdido. Use qualquer senha não vazia.' }), u ? h('p.muted', `Conta: ${u.email}`) : null, pw),
      footer: (api) => [ui.btn('Sair', { variant: 'ghost', onclick: () => { api.close(); A.logout(); } }), ui.btn('Entrar novamente', { variant: 'primary', icon: 'arrow-right', onclick: () => {
        if (!String(pwIn.value || '').length) { pw.setError('Informe a senha.'); return; }
        pw.setError(''); api.close(); ui.toast('Sessão renovada', { type: 'success' });
      } })] });
    return m.promise;
  };
  C.auth = A;

  /* ------------------------- marca / layout público ---------------------- */
  let brandSeen = false;
  function brandPanel() {
    const segs = Array.from({ length: 8 }, (_, i) => h('i.auth-seg', { style: { '--i': i, '--c': `var(--brand-seg-${i + 1})` } }));
    const seen = brandSeen; brandSeen = true;
    return h('aside', { class: ['auth-brand', seen && 'is-seen'] },
      h('a.auth-logo', { href: '#/entrar', 'aria-label': 'Cedy, entrar' }, h('img', { src: 'assets/logo/horizontal-dark.svg', alt: 'Cedy' })),
      h('p.auth-slogan', 'Seu recebível vira ', h('em', 'caixa hoje.')),
      h('div.auth-props',
        h('div.auth-prop', h('span.auth-prop-ic', icon('gavel', 18)), h('div', h('strong', 'Leilão reverso entre financiadores'), h('small', 'Fundos e bancos disputam a sua operação com taxas cada vez menores.'))),
        h('div.auth-prop', h('span.auth-prop-ic', icon('file-signature', 18)), h('div', h('strong', 'Assinatura ICP-Brasil'), h('small', 'Cessão assinada com certificado digital pelas duas partes.'))),
        h('div.auth-prop', h('span.auth-prop-ic', icon('scroll-text', 18)), h('div', h('strong', 'Trilha de decisões auditável'), h('small', 'Cada aceite, lance e pagamento registrado com data, ator e classe de risco.')))),
      h('div.auth-motif', { 'aria-hidden': 'true' },
        h('div.auth-halo'),
        h('div.auth-segs', segs),
        h('p.auth-motif-t', 'Oito segmentos, do azul ao verde: o caminho do recebível até o caixa.')),
      h('p.auth-foot', 'Protótipo 0.1, ambiente de demonstração. Nada aqui move dinheiro de verdade.'));
  }
  function pubShell(...kids) {
    return h('div.auth-wrap', brandPanel(), h('main.auth-main', h('div.auth-card', kids)));
  }
  const authHead = (title, sub) => h('header.auth-head', h('h1.page-title', title), sub && h('p.page-sub', sub));

  /** seis caixas de código; onFull é chamado quando as 6 estão preenchidas */
  function otpBoxes(onFull) {
    const boxes = [];
    const wrap = h('div.auth-otp', { role: 'group', 'aria-label': 'Código de 6 dígitos' });
    const code = () => boxes.map((b) => b.value).join('');
    const fill = (str) => { const d = digits(str).slice(0, 6); boxes.forEach((b, i) => { b.value = d[i] || ''; }); };
    for (let i = 0; i < 6; i++) {
      const inp = h('input', { inputmode: 'numeric', autocomplete: i === 0 ? 'one-time-code' : 'off', maxlength: 1, 'aria-label': `Dígito ${i + 1}`,
        oninput: () => { inp.value = digits(inp.value).slice(0, 1); if (inp.value && i < 5) boxes[i + 1].focus(); if (onFull && code().length === 6) onFull(code()); },
        onkeydown: (e) => { if (e.key === 'Backspace' && !inp.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; } },
        onpaste: (e) => { e.preventDefault(); const d = digits((e.clipboardData || {}).getData ? e.clipboardData.getData('text') : '').slice(0, 6); if (!d) return; fill(d); boxes[Math.min(d.length, 5)].focus(); if (onFull && d.length === 6) onFull(d); } });
      boxes.push(inp); wrap.append(inp);
    }
    return { el: wrap, code, fill, focus: () => boxes[0].focus(), clear() { fill(''); boxes[0].focus(); }, shake() { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); } };
  }

  /* --------------------------------- login ------------------------------- */
  /** aviso de reinício: a versão dos dados mudou e o que o visitante tinha feito foi recriado (app.js grava a marca) */
  function resetNotice() {
    let marca = null; try { marca = localStorage.getItem('cedy-proto-notice'); } catch (e) { /* sem armazenamento */ }
    if (!marca) return null;
    const box = ui.callout({ tone: 'info', title: 'Protótipo atualizado: os dados foram reiniciados',
      text: 'Esta versão inclui a Central de comunicação (mensagens, chamados e comunicados). Para isso, os dados de demonstração foram recriados e o que você tinha feito antes foi descartado. Os dados são fictícios e ficam só no seu navegador.',
      actions: [ui.btn('Entendi', { size: 'sm', variant: 'secondary', onclick: () => { try { localStorage.removeItem('cedy-proto-notice'); } catch (e) { /* */ } box.remove(); } })] });
    return box;
  }
  function renderLogin() {
    const emailIn = ui.input({ type: 'email', placeholder: 'voce@empresa.com.br', autocomplete: 'username', onEnter: () => submit() });
    const email = ui.field({ label: 'E-mail corporativo', required: true }, emailIn);
    const pwIn = ui.input({ type: 'password', placeholder: 'Sua senha', autocomplete: 'current-password', onEnter: () => submit() });
    const pw = ui.field({ label: 'Senha', required: true, hint: 'Demonstração: qualquer senha não vazia funciona.' }, pwIn);
    emailIn.addEventListener('change', () => email.setError('')); pwIn.addEventListener('change', () => pw.setError(''));
    function submit() {
      const em = trim(emailIn.value).toLowerCase(); const s = String(pwIn.value || '');
      email.setError(''); pw.setError('');
      if (!emailValido(em)) { email.setError('Informe um e-mail válido.'); return; }
      if (!s.length) { pw.setError('Informe sua senha.'); return; }
      const user = db.all('users').find((x) => String(x.email).toLowerCase() === em);
      if (!user) { email.setError('Não encontramos esse e-mail. Confira ou crie uma conta.'); return; }
      const org = db.get('orgs', user.orgId);
      if (!org || org.status === 'suspenso') { email.setError(`A empresa ${org ? org.fantasia || org.nome : ''} está com o acesso suspenso. Fale com a Mesa de Operações.`); return; }
      if (org.status === 'inativo') { email.setError('Este cadastro está inativo. Fale com a Mesa de Operações.'); return; }
      setPending({ userId: user.id, attempts: 0 });
      C.router.go('/entrar/2fa');
    }
    const personas = db.all('users').filter((u) => u.demo);
    const groups = [['cedente', 'Cedente'], ['financiador', 'Financiador'], ['originador', 'Originador'], ['sacado', 'Sacado'], ['ops', 'Mesa Cedy'], ['superadmin', 'Superadmin']];
    const orgOf = (u) => db.get('orgs', u.orgId) || {};
    const personaGroups = groups.map(([kind, label]) => {
      const list = personas.filter((u) => C.keyOfUser(u, orgOf(u)) === kind || (kind === 'originador' && u.perfil === 'subparceiro'));
      if (!list.length) return null;
      return h('section.auth-pgroup', { 'aria-label': label },
        h('h3.auth-pgroup-t', C.roles[kind] && icon(C.roles[kind].icon, 14), label, h('span.auth-pgroup-n', list.length)),
        h('div.auth-pgrid', list.map((u) => {
          const o = orgOf(u);
          return h('button.auth-persona', { type: 'button', 'aria-label': `Entrar como ${u.nome}, ${o.fantasia || o.nome}, perfil ${perfilLabel(u.perfil).toLowerCase()}`,
            onclick: () => { emailIn.value = u.email; pwIn.value = 'demo1234'; submit(); } },
            ui.avatar(u.nome, { hue: u.hue, size: 'sm' }),
            h('span.auth-persona-t', h('strong', u.nome), h('small', `${o.fantasia || o.nome} · ${(o.kind === 'cedy' && u.perfil !== 'superadmin' && C.OPS_PAPEIS[u.papel]) ? C.OPS_PAPEIS[u.papel].label : perfilLabel(u.perfil).toLowerCase()}`)));
        })));
    });
    return pubShell(
      authHead('Entrar na Cedy', 'Acesse suas operações, lances e recebimentos.'),
      resetNotice(),
      ui.card({ title: 'Acesso com e-mail e senha' },
        email, pw,
        ui.btn('Entrar', { variant: 'primary', size: 'lg', block: true, icon: 'arrow-right', onclick: submit }),
        h('div.auth-links', ui.link('Esqueci minha senha', '/recuperar'), ui.link('Quero me cadastrar', '/cadastro'))),
      ui.card({ title: 'Entrar como (demonstração)', subtitle: 'Escolha uma pessoa para entrar direto. O código de verificação é 123456.' },
        h('div.auth-personas', personaGroups)));
  }

  /* ---------------------------------- 2FA -------------------------------- */
  function render2fa(ctx) {
    const p = PENDING;
    if (!p || !db.get('users', p.userId)) { setTimeout(() => C.router.go('/entrar'), 0); return h('div'); }
    const user = db.get('users', p.userId);
    if (!user.twofa) return enroll2fa(user);
    let left = 30; let timer = null;
    const err = h('div.field-error.auth-otp-err', { role: 'alert', hidden: true });
    const otp = otpBoxes(() => setTimeout(verify, 120));
    function fail(msg) { C.clear(err); err.hidden = false; err.append(icon('circle-alert', 13), msg); otp.shake(); }
    function verify() {
      if (otp.code().length < 6) { fail('Digite os 6 dígitos.'); return; }
      if (otp.code() === DEMO_CODE) { clearInterval(timer); setPending(null); completeLogin(user); return; }
      p.attempts = (p.attempts || 0) + 1; setPending(p);
      if (p.attempts >= 3) { clearInterval(timer); ui.toast('Código incorreto 3 vezes', { type: 'error', text: 'Voltando ao login por segurança.' }); setPending(null); C.router.go('/entrar'); return; }
      fail(`Código incorreto. Tentativa ${p.attempts} de 3.`);
      otp.clear();
    }
    const cd = h('span.auth-cd', '0:30');
    const resend = ui.btn('Reenviar código', { variant: 'ghost', size: 'sm', disabled: true, onclick: () => { left = 30; resend.disabled = true; draw(); ui.toast('Código reenviado', { text: 'Demonstração: continua 123456.' }); } });
    function draw() { cd.textContent = `0:${String(left).padStart(2, '0')}`; }
    timer = setInterval(() => { left--; if (left <= 0) { clearInterval(timer); resend.disabled = false; cd.textContent = 'agora'; } else draw(); }, 1000);
    ctx.onCleanup(() => clearInterval(timer));
    setTimeout(() => otp.focus(), 120);
    return pubShell(
      authHead('Confirme que é você', `Enviamos um código de 6 dígitos para ${user.email}.`),
      ui.card({ title: 'Código de verificação' }, otp.el, err,
        h('div.auth-links', h('span.small.muted', 'Reenviar em ', cd), resend),
        ui.callout({ tone: 'info', title: 'Demonstração: 123456', text: 'O código de demonstração é sempre 123456.', actions: ui.btn('Preencher', { size: 'sm', onclick: () => { otp.fill(DEMO_CODE); verify(); } }) }),
        ui.btn('Confirmar e entrar', { variant: 'primary', size: 'lg', block: true, icon: 'arrow-right', onclick: verify }),
        h('div.auth-links', ui.link('Voltar ao login', '/entrar'), h('span.small.muted', '3 tentativas erradas voltam ao login.'))));
  }
  function enroll2fa(user) {
    const seedN = [...user.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const N = 21; const cells = [];
    const finder = (x, y) => (x < 7 && y < 7) || (x > N - 8 && y < 7) || (x < 7 && y > N - 8);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (!finder(x, y) && ((x * 31 + y * 17 + seedN) % 7) < 3) cells.push(h('rect', { x, y, width: 1, height: 1 })); }
    const fsq = (ox, oy) => [h('rect', { x: ox + 0.5, y: oy + 0.5, width: 6, height: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1 }), h('rect', { x: ox + 2, y: oy + 2, width: 3, height: 3 })];
    const secret = 'CEDY ' + String(Math.abs(seedN * 7919) % 1000000).padStart(6, '0');
    const err = h('div.field-error.auth-otp-err', { role: 'alert', hidden: true });
    const otp = otpBoxes(() => setTimeout(confirm, 120));
    function confirm() {
      if (otp.code() !== DEMO_CODE) { C.clear(err); err.hidden = false; err.append(icon('circle-alert', 13), otp.code().length < 6 ? 'Digite os 6 dígitos do app autenticador.' : 'Código incorreto. Na demonstração, use 123456.'); otp.shake(); return; }
      db.patch('users', user.id, { twofa: true }); setPending(null); completeLogin(user);
    }
    setTimeout(() => otp.focus(), 150);
    return pubShell(
      authHead('Ative a verificação em 2 etapas', 'A política da Cedy exige 2FA para todos os usuários. Leva menos de 1 minuto.'),
      ui.card({ title: 'Etapa obrigatória de segurança' },
        ui.callout({ tone: 'warn', icon: 'shield-check', title: '2FA obrigatório', text: `A conta de ${user.nome.split(' ')[0]} ainda não tem o segundo fator. Ative agora para continuar.` }),
        h('div.auth-invite', h('div.auth-qr', h('svg', { viewBox: `0 0 ${N} ${N}`, width: 147, height: 147, role: 'img', 'aria-label': 'QR de demonstração' }, cells, fsq(0, 0), fsq(N - 7, 0), fsq(0, N - 7))),
          h('div', h('strong', 'Escaneie com o app autenticador'), h('p.small.muted', 'Ou digite a chave manual: ', h('span.mono.strong', secret)))),
        h('div.stack.tight', h('strong.small', 'Digite o código de 6 dígitos do app'), otp.el, err),
        ui.callout({ tone: 'info', title: 'Demonstração: 123456', text: 'Qualquer app autenticador é simulado. O código é sempre 123456.', actions: ui.btn('Preencher', { size: 'sm', onclick: () => { otp.fill(DEMO_CODE); confirm(); } }) }),
        ui.btn('Ativar e entrar', { variant: 'primary', size: 'lg', block: true, icon: 'arrow-right', onclick: confirm }),
        h('div.auth-links', ui.link('Voltar ao login', '/entrar'))));
  }

  /* ------------------------------- recuperar ------------------------------ */
  function renderRecuperar() {
    const emailIn = ui.input({ type: 'email', placeholder: 'voce@empresa.com.br', onEnter: () => send() });
    const email = ui.field({ label: 'E-mail da conta', required: true }, emailIn);
    emailIn.addEventListener('change', () => email.setError(''));
    function send() {
      const em = trim(emailIn.value).toLowerCase(); email.setError('');
      if (!emailValido(em)) { email.setError('Informe um e-mail válido.'); return; }
      if (!db.all('users').some((x) => String(x.email).toLowerCase() === em)) { email.setError('Não encontramos esse e-mail.'); return; }
      C.router.go('/recuperar/enviada?email=' + encodeURIComponent(em));
      ui.toast('Link enviado', { type: 'success', text: `Enviamos o link para ${em}.` });
    }
    return pubShell(
      authHead('Recuperar acesso', 'Enviamos um link para redefinir sua senha.'),
      ui.card({ title: 'Informe seu e-mail' }, email,
        ui.btn('Enviar link', { variant: 'primary', size: 'lg', block: true, icon: 'send', onclick: send }),
        h('div.auth-links', ui.link('Voltar ao login', '/entrar'), ui.link('Quero me cadastrar', '/cadastro'))));
  }
  function renderRecuperarEnviada(ctx) {
    const em = ctx.query.email || 'seu e-mail';
    return pubShell(
      authHead('Confira seu e-mail', `Enviamos um link de redefinição para ${em}.`),
      ui.card({ title: 'Enviamos o link' },
        ui.callout({ tone: 'success', title: 'Link a caminho', text: `Se ${em} estiver cadastrado, você recebe em instantes um link válido por 2 horas. Não achou? Confira a caixa de spam.` }),
        ui.btn('Definir nova senha', { variant: 'primary', size: 'lg', block: true, icon: 'arrow-right', onclick: () => C.router.go('/recuperar/nova?email=' + encodeURIComponent(em)) }),
        h('div.auth-links', ui.link('Voltar ao login', '/entrar'), ui.link('Usar outro e-mail', '/recuperar'))));
  }
  function passScore(s) { let n = 0; if (s.length >= 8) n++; if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n++; if (/\d/.test(s)) n++; if (/[^A-Za-z0-9]/.test(s)) n++; return n; }
  /** medidor de força com regras; retorna {el, update(valor)} */
  function strengthMeter(withRules) {
    const meter = h('div.auth-strength', [1, 2, 3, 4].map(() => h('i')));
    const rules = withRules ? h('ul.auth-rules') : null;
    const el = h('div.auth-meter', meter, rules);
    function update(v) {
      const n = passScore(v);
      [...meter.children].forEach((b, i) => (b.className = i < n ? 'on-' + n : ''));
      if (rules) C.mount(rules, [['8 ou mais caracteres', v.length >= 8], ['Maiúscula e minúscula', /[a-z]/.test(v) && /[A-Z]/.test(v)], ['Um número', /\d/.test(v)], ['Um símbolo (!@#…)', /[^A-Za-z0-9]/.test(v)]].map(([t, good]) => h('li', { class: good && 'ok' }, icon(good ? 'check' : 'circle', 13), t)));
    }
    update('');
    return { el, update };
  }
  function renderNovaSenha(ctx) {
    const pwIn = ui.input({ type: 'password', placeholder: 'Mínimo de 8 caracteres', autocomplete: 'new-password', onInput: (v) => sm.update(v) });
    const pw = ui.field({ label: 'Nova senha', required: true }, pwIn);
    pwIn.addEventListener('change', () => pw.setError(''));
    const sm = strengthMeter(true);
    function save() {
      const v = String(pwIn.value || ''); pw.setError('');
      if (passScore(v) < 2 || v.length < 8) { pw.setError('Escolha uma senha mais forte (mínimo de 8 caracteres, com letras e número).'); return; }
      C.router.go('/entrar'); ui.toast('Senha redefinida', { type: 'success', text: 'Entre com a nova senha.' });
    }
    return pubShell(
      authHead('Crie a nova senha', `Conta: ${ctx.query.email || 'verifique seu e-mail'}.`),
      ui.card({ title: 'Nova senha' }, pw, sm.el,
        ui.btn('Salvar e voltar ao login', { variant: 'primary', size: 'lg', block: true, icon: 'check', onclick: save })));
  }

  /* ------------------------------ cadastro -------------------------------- */
  const W0 = { perfil: 'cedente', cnpj: '', razao: '', fantasia: '', cidade: '', uf: '', porte: '', segmento: '', tel: '', faturamento: 0, receitaOk: false, nome: '', cpf: '', cargo: '', email: '', senha: '', termos: false, lgpd: false, convite: null };
  const W = Object.assign({}, W0);
  const resetW = () => Object.assign(W, W0);
  const STEPS = ['Perfil', 'Empresa', 'Responsável', 'Verificação'];
  function termoDrawer(kind) {
    const termos = [['Uso pessoal e intransferível', 'Sua conta é só sua. Não compartilhe senha nem segundo fator.'], ['2FA obrigatório', 'Todo acesso exige o código de 6 dígitos.'], ['1 a 3 administradores por empresa', 'A empresa mantém de 1 a 3 administradores ativos.'], ['Revisão semestral da lista de usuários', 'A cada 6 meses a empresa confirma quem segue com acesso.'], ['Automação só via API com credencial de agente', 'É proibido automatizar telas ou fazer engenharia reversa sem autorização. Integrações usam credencial própria de agente.']];
    const lgpd = [['O que tratamos', 'Dados de cadastro, documentos e operações, para operar a plataforma.'], ['Base e direitos', 'Tratamos conforme a LGPD. Você pode pedir acesso, correção e eliminação pelos canais da Cedy.'], ['Compartilhamento', 'Só com quem precisa para a operação: financiadores da Vitrine, banco parceiro e autoridades quando exigido.'], ['Segurança', 'Criptografia, controle de acesso e trilha auditável de cada decisão.']];
    ui.drawer({ title: kind === 'termos' ? 'Termos de Uso (resumo)' : 'Privacidade e LGPD (resumo)', subtitle: 'Resumo em linguagem simples. O texto integral vale na contratação.', icon: 'file-text', size: 'md',
      body: h('div.stack.tight', (kind === 'termos' ? termos : lgpd).map(([t, x]) => h('div.auth-term', h('strong', t), h('p.muted', x)))), footer: (api) => ui.btn('Fechar', { variant: 'primary', onclick: () => api.close() }) });
  }
  const WIZ_Q = () => (W.convite ? `?convite=${encodeURIComponent(W.convite)}&perfil=cedente` : '');
  const WIZ_BACK = (step) => (step <= 1 ? '/cadastro' : '/cadastro/' + step);
  function applyConvite(ctx) {
    if (ctx.query.convite && ctx.query.convite !== W.convite) {
      W.convite = ctx.query.convite; W.perfil = 'cedente';
      const cv = db.get('convites', W.convite);
      if (cv) { if (!W.fantasia) W.fantasia = cv.nome || ''; if (!W.email) W.email = cv.email || ''; }
    }
  }
  function wizardShell(step, ...body) {
    return pubShell(
      authHead('Criar conta da empresa', 'Cadastro público. A Mesa de Operações analisa em até 24h úteis.'),
      h('div.auth-steps', h('span.auth-steps-n', `Etapa ${step + 1} de ${STEPS.length}`), ui.stepper(STEPS, step)),
      ...body);
  }
  function navBtns(step, onBack, onNext, nextLabel) {
    return h('div.auth-nav', step > 0 ? ui.btn('Voltar', { variant: 'ghost', icon: 'arrow-left', onclick: onBack }) : ui.link('Voltar ao login', '/entrar'),
      ui.btn(nextLabel || 'Continuar', { variant: 'primary', iconRight: 'arrow-right', onclick: onNext }));
  }
  const cadastrosBloqueados = () => { try { return !C.engine.flag('novosCadastros') && !W.convite; } catch (e) { return false; } };
  function cadastroPausado(step) {
    return wizardShell(step, ui.card({ title: 'Cadastros pausados', subtitle: 'A plataforma suspendeu novos cadastros por ora.' },
      ui.callout({ tone: 'warn', title: 'Novos cadastros desativados', text: 'Fale com a Mesa de Operações ou tente de novo mais tarde. Convites de originador seguem valendo.' }),
      ui.link('Voltar ao login', '/entrar')));
  }
  function stepPerfil(ctx, step) {
    applyConvite(ctx);
    if (cadastrosBloqueados()) return cadastroPausado(step);
    if (!ctx.query.convite && ['cedente', 'financiador', 'originador'].includes(ctx.query.perfil)) W.perfil = ctx.query.perfil;
    const locked = !!ctx.query.convite;
    const radio = ui.radio({ layout: 'cards', aria: 'Perfil da empresa', value: W.perfil, onChange: (v) => (W.perfil = v), options: [
      { value: 'cedente', label: 'Cedente', hint: 'Minha empresa vende a prazo e quer antecipar recebíveis.', icon: 'banknote' },
      { value: 'financiador', label: 'Financiador', hint: 'FIDC, factoring, banco ou ESC que compra recebíveis.', icon: 'landmark', disabled: locked },
      { value: 'originador', label: 'Originador', hint: 'Parceiro que indica empresas e acompanha a carteira.', icon: 'handshake', disabled: locked }] });
    return wizardShell(step, ui.card({ title: 'Qual é o perfil da empresa?', subtitle: 'Você pode mudar isso depois falando com a Mesa de Operações.' },
      locked && ui.callout({ tone: 'info', title: 'Convite de originador', text: 'Este convite é para cadastro como cedente.' }),
      radio, navBtns(step, null, () => { W.perfil = radio.value; C.router.go('/cadastro/' + (step + 2) + WIZ_Q()); })));
  }
  function stepEmpresa(ctx, step) {
    applyConvite(ctx);
    if (cadastrosBloqueados()) return cadastroPausado(step);
    const cnpjIn = ui.input({ mask: 'cnpj', placeholder: '00.000.000/0001-00', value: W.cnpj });
    const cnpj = ui.field({ label: 'CNPJ', required: true, hint: 'Demonstração: 11.444.777/0001-61 é um CNPJ válido.' }, cnpjIn);
    const fantIn = ui.input({ placeholder: 'Como a empresa é conhecida', value: W.fantasia });
    const fant = ui.field({ label: 'Nome fantasia', required: true }, fantIn);
    const razaoIn = ui.input({ placeholder: 'Preenchida pela busca na Receita', value: W.razao });
    const razao = ui.field({ label: 'Razão social', required: true }, razaoIn);
    const locIn = ui.input({ placeholder: 'Ex.: Sorocaba / SP', value: W.cidade && W.uf ? `${W.cidade} / ${W.uf}` : '' });
    const loc = ui.field({ label: 'Cidade / UF', required: true }, locIn);
    const telIn = ui.input({ mask: 'phone', placeholder: '(11) 3000-0000', value: W.tel });
    const tel = ui.field({ label: 'Telefone comercial', required: true }, telIn);
    const seg = ui.select({ placeholder: 'Escolha o segmento', aria: 'Segmento', value: W.segmento || undefined, options: ['Indústria', 'Distribuição', 'Transporte', 'Agro', 'Construção', 'Serviços', 'Varejo', 'Saúde', 'Outro'].map((s) => ({ value: s, label: s })) });
    const segF = ui.field({ label: 'Segmento', required: true }, seg);
    const fatIn = ui.currency({ value: W.faturamento, aria: 'Faturamento mensal médio' });
    const fat = ui.field({ label: 'Faturamento mensal médio', required: true, hint: 'Usado para estimar o seu limite (LAR).' }, fatIn);
    const rc = h('div');
    [[cnpj, cnpjIn], [fant, fantIn], [razao, razaoIn], [loc, locIn], [tel, telIn], [segF, seg], [fat, fatIn]].forEach(([f, c]) => c.addEventListener('change', () => f.setError('')));
    function collect() {
      W.cnpj = cnpjIn.value; W.fantasia = fantIn.value; W.razao = razaoIn.value; W.faturamento = fatIn.value || 0; W.segmento = seg.value || ''; W.tel = telIn.value;
      const m = String(locIn.value || '').split('/'); W.cidade = trim(m[0]); W.uf = trim(m[1]).toUpperCase();
    }
    const busy = h('span.auth-busy');
    const buscarBtn = ui.btn('Buscar na Receita', { variant: 'secondary', icon: 'search', onclick: buscar });
    function buscar() {
      cnpj.setError('');
      if (!cnpjValido(cnpjIn.value)) { cnpj.setError('CNPJ inválido. Confira os 14 dígitos.'); return; }
      C.mount(busy, ui.spinner(18)); buscarBtn.disabled = true;
      setTimeout(() => {
        C.mount(busy, ''); buscarBtn.disabled = false;
        const nm = trim(fantIn.value || W.fantasia) || 'Sua Empresa';
        W.cnpj = cnpjIn.value; W.receitaOk = true; W.razao = nm.replace(/\s+(Ltda|LTDA|S\.?A\.?)\.?$/i, '') + ' Ltda'; W.fantasia = nm; W.cidade = 'São Paulo'; W.uf = 'SP'; W.porte = 'Pequeno';
        razaoIn.value = W.razao; fantIn.value = W.fantasia; locIn.value = 'São Paulo / SP';
        C.mount(rc, ui.callout({ tone: 'success', title: 'Dados encontrados na Receita', text: `${W.razao} · situação ativa, fundada há 6 anos · CNAE 46.39-7-01 · porte Pequeno. Confira e ajuste se preciso.` }));
      }, 800);
    }
    if (W.receitaOk) C.mount(rc, ui.callout({ tone: 'success', title: 'Dados da Receita confirmados', text: `${W.razao} · situação ativa.` }));
    function next() {
      collect();
      cnpj.setError(''); fant.setError(''); razao.setError(''); loc.setError(''); tel.setError(''); segF.setError(''); fat.setError('');
      let bad = false;
      if (!cnpjValido(W.cnpj)) { cnpj.setError('CNPJ inválido. Confira os 14 dígitos.'); bad = true; }
      else if (db.all('orgs').some((o) => digits(o.cnpj) === digits(W.cnpj))) { cnpj.setError('Este CNPJ já tem cadastro na Cedy. Entre com seu e-mail ou fale com a Mesa de Operações.'); bad = true; }
      if (!trim(W.fantasia)) { fant.setError('Informe o nome fantasia.'); bad = true; }
      if (!trim(W.razao)) { razao.setError('Informe a razão social.'); bad = true; }
      if (!W.cidade || !W.uf) { loc.setError('Informe cidade e UF, como em Sorocaba / SP.'); bad = true; }
      if (digits(W.tel).length < 10) { tel.setError('Informe o telefone com DDD.'); bad = true; }
      if (!W.segmento) { segF.setError('Escolha o segmento.'); bad = true; }
      if (!(W.faturamento > 0)) { fat.setError('Informe o faturamento mensal médio.'); bad = true; }
      if (bad) { const first = document.querySelector('.has-error'); if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      C.router.go('/cadastro/' + (step + 2) + WIZ_Q());
    }
    return wizardShell(step, ui.card({ title: 'Dados da empresa', subtitle: 'Buscamos na Receita para você não digitar tudo.' },
      h('div.auth-cnpj', cnpj, h('div.auth-cnpj-act', buscarBtn, busy)), rc,
      ui.grid(2, fant, razao), ui.grid(2, loc, tel), ui.grid(2, segF, fat),
      W.perfil === 'cedente' && ui.callout({ tone: 'info', title: 'Referência de elegibilidade', text: 'O programa Premium usa como referência cerca de R$ 400 mil/mês de faturamento. Empresas menores entram em lista de espera com outros programas, sem bloqueio: você pode concluir o cadastro.' }),
      navBtns(step, () => { collect(); C.router.go(WIZ_BACK(step) + WIZ_Q()); }, next)));
  }
  function stepResp(ctx, step) {
    if (cadastrosBloqueados()) return cadastroPausado(step);
    const nomeIn = ui.input({ placeholder: 'Quem responde pela empresa', value: W.nome });
    const nome = ui.field({ label: 'Nome completo', required: true }, nomeIn);
    const cpfIn = ui.input({ mask: 'cpf', placeholder: '000.000.000-00', value: W.cpf });
    const cpf = ui.field({ label: 'CPF', required: true, hint: 'Demonstração: 529.982.247-25 é um CPF válido.' }, cpfIn);
    const cargoIn = ui.input({ placeholder: 'Ex.: Diretora financeira', value: W.cargo });
    const cargo = ui.field({ label: 'Cargo', required: true }, cargoIn);
    const emailIn = ui.input({ type: 'email', placeholder: 'voce@empresa.com.br', value: W.email, autocomplete: 'email' });
    const email = ui.field({ label: 'E-mail corporativo', required: true }, emailIn);
    const sm = strengthMeter(false);
    const pwIn = ui.input({ type: 'password', value: W.senha, autocomplete: 'new-password', onInput: (v) => sm.update(v) });
    const pw = ui.field({ label: 'Senha', required: true, hint: 'Mínimo de 8 caracteres, com letras e número.' }, pwIn);
    setTimeout(() => sm.update(String(pwIn.value || '')), 0);
    const t1 = ui.checkbox({ label: h('span', 'Li e aceito os ', h('a.link', { href: '#/cadastro/3', onclick: (e) => { e.preventDefault(); e.stopPropagation(); termoDrawer('termos'); } }, 'Termos de Uso'), ' e o Termo Individual do Usuário'), checked: W.termos, onChange: (v) => (W.termos = v) });
    const t2 = ui.checkbox({ label: h('span', 'Autorizo o tratamento dos dados ', h('a.link', { href: '#/cadastro/3', onclick: (e) => { e.preventDefault(); e.stopPropagation(); termoDrawer('lgpd'); } }, 'conforme a LGPD')), checked: W.lgpd, onChange: (v) => (W.lgpd = v) });
    [[nome, nomeIn], [cpf, cpfIn], [cargo, cargoIn], [email, emailIn], [pw, pwIn]].forEach(([f, c]) => c.addEventListener('change', () => f.setError('')));
    function collect() { W.nome = nomeIn.value; W.cpf = cpfIn.value; W.cargo = cargoIn.value; W.email = trim(emailIn.value).toLowerCase(); W.senha = String(pwIn.value || ''); W.termos = t1.value; W.lgpd = t2.value; }
    function next() {
      collect();
      [nome, cpf, cargo, email, pw].forEach((f) => f.setError(''));
      let bad = false;
      if (trim(W.nome).length < 5) { nome.setError('Informe o nome completo.'); bad = true; }
      if (!cpfValido(W.cpf)) { cpf.setError('CPF inválido.'); bad = true; }
      if (!trim(W.cargo)) { cargo.setError('Informe o cargo.'); bad = true; }
      if (!emailValido(W.email)) { email.setError('Informe um e-mail válido.'); bad = true; }
      else if (db.all('users').some((x) => String(x.email).toLowerCase() === W.email)) { email.setError('Este e-mail já tem conta. Entre ou recupere o acesso.'); bad = true; }
      if (passScore(W.senha) < 2 || W.senha.length < 8) { pw.setError('Mínimo de 8 caracteres, com letras e número.'); bad = true; }
      if (!W.termos || !W.lgpd) { ui.toast('Aceites pendentes', { type: 'warn', text: 'Marque os dois aceites para continuar.' }); bad = true; }
      if (bad) return;
      C.router.go('/cadastro/' + (step + 2) + WIZ_Q());
    }
    return wizardShell(step, ui.card({ title: 'Quem responde pela empresa', subtitle: 'Esta pessoa será a primeira administradora da conta.' },
      ui.grid(2, nome, cpf), ui.grid(2, cargo, email),
      h('div.stack.tight', pw, sm.el),
      h('div.stack.tight', t1, t2),
      navBtns(step, () => { collect(); C.router.go(WIZ_BACK(step) + WIZ_Q()); }, next)));
  }
  function stepOtp(ctx, step) {
    if (cadastrosBloqueados()) return cadastroPausado(step);
    if (!W.email) { setTimeout(() => C.router.go('/cadastro/3' + WIZ_Q()), 0); return h('div'); }
    const err = h('div.field-error.auth-otp-err', { role: 'alert', hidden: true });
    const otp = otpBoxes(() => setTimeout(finish, 120));
    function finish() {
      if (otp.code() !== DEMO_CODE) { C.clear(err); err.hidden = false; err.append(icon('circle-alert', 13), otp.code().length < 6 ? 'Digite os 6 dígitos.' : 'Código incorreto. Na demonstração, use 123456.'); otp.shake(); return; }
      const org = finishSignup();
      if (!org || !org.id) return;
      C.router.go('/cadastro/ok?org=' + org.id);
    }
    setTimeout(() => otp.focus(), 120);
    return wizardShell(step, ui.card({ title: 'Verifique seu e-mail', subtitle: `Enviamos um código de 6 dígitos para ${W.email}.` },
      otp.el, err,
      ui.callout({ tone: 'info', title: 'Demonstração: 123456', text: 'O código de demonstração é sempre 123456.', actions: ui.btn('Preencher', { size: 'sm', onclick: () => { otp.fill(DEMO_CODE); finish(); } }) }),
      navBtns(step, () => C.router.go(WIZ_BACK(step) + WIZ_Q()), finish, 'Confirmar e concluir')));
  }
  const DOCS_CED = ['Contrato social consolidado', 'Cartão CNPJ', 'Documento dos sócios (RG ou CNH)', 'Comprovante de endereço', 'Faturamento dos últimos 12 meses (DRE ou balancete)', 'Certidão negativa de débitos federais', 'Comprovante da conta de liquidação'];
  const DOCS_FIN = ['Contrato ou estatuto social', 'Cartão CNPJ', 'Regulamento do fundo ou registro no órgão regulador', 'Política de risco e crédito', 'Documentos do administrador ou gestor', 'Comprovante de endereço'];
  function finishSignup() {
    if (cadastrosBloqueados()) { C.router.go('/cadastro'); ui.toast('Cadastros pausados', { type: 'warn', text: 'Novos cadastros estão desativados pela plataforma.' }); return { id: null }; }
    let id = 'c-' + slug(W.fantasia); let n = 2;
    while (db.get('orgs', id)) id = 'c-' + slug(W.fantasia) + '-' + (n++);
    const conv = W.convite && db.get('convites', W.convite);
    const org = db.put('orgs', { id, kind: W.perfil, nome: W.razao, fantasia: W.fantasia, cnpj: digits(W.cnpj), cidade: W.cidade, uf: W.uf, setor: W.segmento, porte: 'Pequeno', status: 'kyc', ativoDesde: null, faturamentoAnual: (W.faturamento || 0) * 12, prazoRecebimentoDias: 45, depositos90d: 0, indicadoPor: conv ? conv.origId : null, bloqueados: [], contaLiquidacao: { banco: 'A informar', agencia: '—', conta: '—', titular: W.razao, tipo: 'Conta de liquidação em nome do cedente' }, cadastroEm: C.clock.now() });
    let uid = 'u-' + slug(W.fantasia) + '-1'; let m = 2;
    while (db.get('users', uid)) uid = 'u-' + slug(W.fantasia) + '-' + (m++);
    db.put('users', { id: uid, nome: W.nome, email: W.email, cargo: W.cargo, orgId: id, perfil: 'admin', demo: false, twofa: true, ultimoAcesso: null, telefone: W.tel || '', cpf: digits(W.cpf) });
    db.put('kyc', { id: 'kyc-' + id, orgId: id, status: 'em_analise', docs: (W.perfil === 'financiador' ? DOCS_FIN : DOCS_CED).map((t) => ({ tipo: t, arquivo: null, status: 'pendente', agente: null })), criadoEm: C.clock.now(), atualizadoEm: C.clock.now(), agenteResumo: 'Cadastro recebido pelo site. Aguardando documentos.', risco: 'medio' });
    let avisoConvite = null;
    if (conv && conv.status !== 'cadastrado') {
      const outro = db.all('orgs').find((o) => o.id !== id && digits(o.cnpj || '') === digits(W.cnpj) && o.indicadoPor);
      if (outro) { db.patch('orgs', id, { indicadoPor: outro.indicadoPor }); avisoConvite = 'Este CNPJ já tinha indicação registrada, que foi mantida.'; }
      else { db.patch('convites', conv.id, { status: 'cadastrado', orgId: id }); }
    }
    notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: 'Novo cadastro para KYC: ' + (W.fantasia || W.razao), corpo: `${{ cedente: 'Cedente', financiador: 'Financiador', originador: 'Originador' }[W.perfil]} · ${fmt.cnpj(W.cnpj)}`, link: '/ops/kyc' });
    ledger.append({ actor: { tipo: 'sistema', id: 'cadastro', nome: 'Cadastro público' }, acao: 'cadastro.recebido', entidade: { kind: 'org', id }, resumo: `Cadastro recebido: ${W.razao} (${W.perfil})`, classe: 'R1' });
    if (avisoConvite) setTimeout(() => ui.toast('Indicação mantida', { type: 'info', text: avisoConvite }), 600);
    resetW();
    return org;
  }
  function renderCadastroOk(ctx) {
    const org = db.get('orgs', ctx.query.org);
    if (!org) { setTimeout(() => C.router.go('/cadastro'), 0); return h('div'); }
    const steps = [['upload', 'Envie os documentos', 'Contrato social, cartão CNPJ, certidões e comprovante da conta. A lista está no e-mail e na área de cadastro.'], ['clock', 'Análise da Mesa em até 24h úteis', 'Você recebe o resultado por e-mail e acompanha pelo login.'], ['gavel', 'Primeira operação', 'Com o cadastro ativo, importe títulos e publique na Vitrine.']];
    return pubShell(
      authHead('Cadastro recebido', 'Boas-vindas à Cedy. Falta pouco para operar.'),
      ui.card({ title: 'O que acontece agora' },
        ui.callout({ tone: 'success', title: `${org.fantasia}, conta criada`, text: 'Enviamos a confirmação para o seu e-mail.' }),
        ui.timeline(steps.map(([ic, t, x]) => ({ icon: ic, tone: 'green', title: t, text: x }))),
        ui.btn('Entrar na minha conta', { variant: 'primary', size: 'lg', block: true, icon: 'arrow-right', onclick: () => C.router.go('/entrar') })));
  }

  /* -------------------------------- convite -------------------------------- */
  function renderConvite(ctx) {
    const cv = db.get('convites', ctx.params.codigo);
    if (!cv) return pubShell(authHead('Convite não encontrado', 'Confira o link com quem convidou.'), ui.card({ title: 'Link inválido' }, ui.empty({ icon: 'link', title: 'Nada por aqui', text: 'Este convite não existe ou foi removido.', action: ui.btn('Ir ao login', { onclick: () => C.router.go('/entrar') }) })));
    const orig = db.get('orgs', cv.origId); const origNome = (orig && (orig.fantasia || orig.nome)) || 'Um parceiro';
    const done = ['cadastrado', 'kyc', 'ativo'].includes(cv.status);
    return pubShell(
      authHead('Você foi convidado', `${origNome} indicou sua empresa para a Cedy.`),
      ui.card({ title: 'Convite de originador' },
        h('div.auth-invite', ui.avatar(origNome, { size: 'lg' }), h('div', h('strong', cv.nome), h('div.small.muted', `Indicado por ${origNome} · convite ${cv.id}`))),
        ui.kv([['Empresa', cv.nome], ['E-mail', cv.email || '—'], ['Situação do convite', ui.status('convite', cv.status)]]),
        done ? ui.callout({ tone: 'info', title: 'Convite já utilizado', text: 'Esta empresa já concluiu o cadastro.' })
          : ui.btn('Continuar o cadastro como cedente', { variant: 'primary', size: 'lg', block: true, icon: 'arrow-right', onclick: () => { resetW(); W.perfil = 'cedente'; W.convite = cv.id; W.fantasia = cv.nome; W.email = cv.email || ''; C.router.go(`/cadastro?convite=${cv.id}&perfil=cedente`); } }),
        h('div.auth-links', ui.link('Voltar ao login', '/entrar'), h('span.small.muted', 'Janela de indicação: 24 meses após a 1ª operação.'))));
  }

  /* --------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/entrar', public: true, shell: false, title: 'Entrar', render: renderLogin },
    { path: '/entrar/2fa', public: true, shell: false, title: 'Verificação em 2 etapas', render: render2fa },
    { path: '/recuperar', public: true, shell: false, title: 'Recuperar acesso', render: renderRecuperar },
    { path: '/recuperar/enviada', public: true, shell: false, title: 'Link enviado', render: renderRecuperarEnviada },
    { path: '/recuperar/nova', public: true, shell: false, title: 'Nova senha', render: renderNovaSenha },
    { path: '/cadastro', public: true, shell: false, title: 'Criar conta', render: (ctx) => stepPerfil(ctx, 0) },
    { path: '/cadastro/2', public: true, shell: false, title: 'Criar conta', render: (ctx) => stepEmpresa(ctx, 1) },
    { path: '/cadastro/3', public: true, shell: false, title: 'Criar conta', render: (ctx) => stepResp(ctx, 2) },
    { path: '/cadastro/4', public: true, shell: false, title: 'Criar conta', render: (ctx) => stepOtp(ctx, 3) },
    { path: '/cadastro/ok', public: true, shell: false, title: 'Cadastro recebido', render: renderCadastroOk },
    { path: '/convite/:codigo', public: true, shell: false, title: 'Convite', render: renderConvite },
  ]);
})();
