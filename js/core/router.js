/* =========================================================================
   Cedy, roteador por hash (#/rota) com transições entre páginas.
   - Deep links funcionam e o botão voltar do navegador/celular funciona.
   - Transição: avançar (mais profundo) = desliza da direita; voltar = da esquerda;
     mesmo nível = fade + sobe 8px. Respeita prefers-reduced-motion.
   - Cada tela recebe ctx: {params, query, path, user, org, role, onCleanup(fn), go, can(perm)}.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h } = C;
  const routes = []; let current = null; let cleanups = []; let stack = []; let navId = 0;

  function compile(path) {
    const keys = []; const re = new RegExp('^' + path.replace(/\/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }).replace(/\/\*$/, '(?:/.*)?') + '/?$');
    return { re, keys };
  }
  function register(def) {
    (Array.isArray(def) ? def : [def]).forEach((d) => { const c = compile(d.path); routes.push(Object.assign({ depth: d.path.split('/').filter(Boolean).length }, d, c)); });
  }
  function parse(hash) {
    const raw = (hash || '').replace(/^#/, '') || '/'; const [p, q] = raw.split('?'); const query = {}; (q || '').split('&').filter(Boolean).forEach((kv) => { const [k, v] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    return { path: p.replace(/\/+$/, '') || '/', query };
  }
  function match(path) {
    for (const r of routes) { const m = path.match(r.re); if (m) { const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); return { def: r, params }; } }
    return null;
  }
  const go = (path, o = {}) => { const next = '#' + path; if (location.hash === next) { resolve(); return; } if (o.replace) location.replace(next); else location.hash = next; };

  function ctxFor(def, params, query, path) {
    const S = C.store.session;
    return { params, query, path, def, user: S.user(), org: S.org(), role: S.role(), go, can: C.can, onCleanup: (fn) => cleanups.push(fn), isMobile: C.isMobile() };
  }

  async function resolve() {
    const { path, query } = parse(location.hash);
    const S = C.store.session; const sess = S.get();
    let m = match(path);
    if (path === '/' || !m) {
      if (sess) return go(C.homeFor(sess), { replace: true });
      return go('/entrar', { replace: true });
    }
    const def = m.def;
    if (def.public && sess && ['/entrar', '/cadastro'].some((p) => path.startsWith(p)) && !query.force) return go(C.homeFor(sess), { replace: true });
    if (!def.public && !sess) { sessionStorage.setItem('cedy-after-login', location.hash); return go('/entrar', { replace: true }); }
    if (def.roles && sess && !def.roles.includes(sess.role)) return go(C.homeFor(sess), { replace: true });
    if (def.perfis && sess) { const uu = C.store.session.user(); if (!uu || !def.perfis.includes(uu.perfil)) { C.ui.toast('Acesso restrito', { type: 'warn', text: 'Esta área é do ' + (def.perfis.includes('superadmin') ? 'Superadmin' : 'perfil indicado') + '.' }); return go(C.homeFor(sess), { replace: true }); } }

    // direção da transição
    let dir = 'swap';
    if (stack.length >= 2 && stack[stack.length - 2] === path) { dir = 'back'; stack.pop(); }
    else { const prev = current ? current.def.depth : 0; if (stack[stack.length - 1] !== path) stack.push(path); dir = def.depth > prev ? 'forward' : def.depth < prev ? 'back' : 'swap'; if (!current || def.shell !== current.def.shell || (def.roles || []).join() !== (current.def.roles || []).join()) dir = 'swap'; }
    if (stack.length > 40) stack.shift();

    const my = ++navId;
    cleanups.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); cleanups = [];
    if (C.ui && C.ui.closeAll) C.ui.closeAll();
    const ctx = ctxFor(def, m.params, query, path);
    let node;
    try {
      if (def.shell === false) await C.shell.mountBare(); else await C.shell.mountApp();
      node = await def.render(ctx);
    } catch (e) { console.error(e); node = C.ui.empty({ icon: 'triangle-alert', title: 'Não foi possível abrir esta tela', text: String(e && e.message || e), action: C.ui.btn('Voltar ao início', { onclick: () => go('/') }) }); }
    if (my !== navId) return; // navegação mais nova venceu
    current = { def, params: m.params, path, query, ctx };
    await transition(node, dir, def);
    C.shell.afterRoute && C.shell.afterRoute(current);
    document.title = (def.title ? (typeof def.title === 'function' ? def.title(ctx) : def.title) + ' · ' : '') + 'Cedy';
  }

  const DUR = 280;
  async function transition(node, dir, def) {
    const view = document.getElementById('view'); if (!view) return;
    const reduced = C.prefersReduced();
    const old = view.firstElementChild;
    const page = h('div', { class: ['page', def.wide && 'page-wide', def.narrow && 'page-narrow'], tabindex: '-1', 'data-dir': dir }, node);
    if (old && !reduced) {
      const out = old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: dir === 'forward' ? 'translateX(-14px)' : dir === 'back' ? 'translateX(14px)' : 'translateY(-4px)' }], { duration: 110, easing: 'cubic-bezier(0.64,0,0.78,0)', fill: 'forwards' });
      try { await out.finished; } catch (e) { /* cancelado */ }
    }
    C.clear(view); view.appendChild(page); view.scrollTop = 0; window.scrollTo(0, 0);
    if (!reduced) {
      page.animate([{ opacity: 0, transform: dir === 'forward' ? 'translateX(28px)' : dir === 'back' ? 'translateX(-28px)' : 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: DUR, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    }
    page.classList.add('page-enter');
    animateTitle(page); C.ui.countUp(page);
    setTimeout(() => { try { page.focus({ preventScroll: true }); } catch (e) { /* */ } }, 20);
  }
  /** título: palavras sobem em sequência; sublinhado percorre em gradiente da marca */
  function animateTitle(page) {
    const t = page.querySelector('.page-title'); if (!t || C.prefersReduced() || t.dataset.animated) return; t.dataset.animated = '1';
    const text = t.textContent; if (!text || t.children.length) return; t.setAttribute('aria-label', text); C.clear(t);
    text.split(' ').forEach((w, i) => { t.append(h('span.pt-w', { style: { '--i': i }, 'aria-hidden': 'true' }, w), ' '); });
  }

  function start() { window.addEventListener('hashchange', resolve); resolve(); }
  C.router = { register, go, start, resolve, parse, get current() { return current; }, routes, resetStack() { stack = []; } };
})();
