/* =========================================================================
   Cedy protótipo 0.1, estado único (db), pub/sub por tópico, persistência
   em localStorage e trilha de decisões (ledger) encadeada por hash.

   Regras de uso (contrato para as telas):
   - Estado só muda por Cedy.db.* ou Cedy.engine.*; telas nunca mutam objetos diretamente.
   - Coleções: orgs, users, titulos, operacoes, lances, contratos, extrato, repasses,
     faturas, premiacoes, kyc, convites, agentes, propostas, produtos, notifs, lotes, contestacoes, casosMesa
   - Cada escrita emite o tópico da coleção. Cedy.ui.live(['operacoes','lances'], fn) re-renderiza.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const KEY = 'cedy-proto-0.1';
  const VERSION = 8;

  const COLLECTIONS = ['orgs', 'users', 'titulos', 'operacoes', 'lances', 'contratos', 'extrato', 'repasses', 'faturas', 'premiacoes',
    'kyc', 'convites', 'agentes', 'propostas', 'produtos', 'notifs', 'lotes', 'contestacoes', 'casosMesa', 'subparceiros', 'aprovacoes', 'incidentes', 'servicos', 'backups', 'titulares', 'eventosSeg', 'usoIA', 'modelosIA', 'integracoes'];

  let S = null;           // estado
  const subs = new Map(); // tópico -> Set(fn)
  let saveTimer = null;
  let batching = 0, pending = new Set();

  function emit(topic) {
    if (batching) { pending.add(topic); return; }
    const set = subs.get(topic); if (set) [...set].forEach((fn) => { try { fn(topic); } catch (e) { console.error(e); } });
    const all = subs.get('*'); if (all) [...all].forEach((fn) => { try { fn(topic); } catch (e) { console.error(e); } });
    scheduleSave();
  }
  /** agrupa várias escritas; emite cada tópico uma vez no final */
  function batch(fn) { batching++; try { return fn(); } finally { batching--; if (!batching) { const t = [...pending]; pending = new Set(); t.forEach(emit); } } }
  function on(topics, fn) {
    const list = Array.isArray(topics) ? topics : [topics];
    list.forEach((t) => { if (!subs.has(t)) subs.set(t, new Set()); subs.get(t).add(fn); });
    return () => list.forEach((t) => subs.get(t) && subs.get(t).delete(fn));
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function save() {
    try { S.clockNow = C.clock.now(); localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* cota cheia: ignora no protótipo */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.v === VERSION) return s; }
    } catch (e) { /* ignora */ }
    return null;
  }

  /* ------------------------------ db ------------------------------------ */
  const db = {
    get state() { return S; },
    all(coll) { return Object.values(S[coll] || {}); },
    get(coll, id) { return (S[coll] || {})[id] || null; },
    where(coll, fn) { return Object.values(S[coll] || {}).filter(fn); },
    put(coll, obj) { if (!obj.id) obj.id = C.uid(coll.slice(0, 3)); S[coll][obj.id] = obj; emit(coll); return obj; },
    patch(coll, id, patch) { const o = S[coll][id]; if (!o) return null; Object.assign(o, typeof patch === 'function' ? patch(o) : patch); emit(coll); return o; },
    del(coll, id) { delete S[coll][id]; emit(coll); },
    cfg() { return S.config; },
    setCfg(patch) { Object.assign(S.config, patch); emit('config'); },
    batch, on, emit,
  };

  /* ------------------------------ sessão -------------------------------- */
  const session = {
    get() { return S.session; },
    user() { return S.session ? S.users[S.session.userId] : null; },
    org() { return S.session ? S.orgs[S.session.orgId] : null; },
    role() { return S.session ? S.session.role : null; },
    set(sess) { S.session = sess; emit('session'); },
    clear() { S.session = null; emit('session'); },
  };
  const prefs = {
    get theme() { return S.theme || 'auto'; },
    setTheme(t) { S.theme = t; emit('theme'); },
    get collapsed() { return !!S.navCollapsed; },
    setCollapsed(v) { S.navCollapsed = !!v; emit('prefs'); },
    get market() { return S.marketOn !== false; },
    setMarket(v) { S.marketOn = !!v; emit('prefs'); },
    get tour() { return S.tourDone; }, setTour(v) { S.tourDone = v; emit('prefs'); },
  };

  /* ------------------------------ ledger -------------------------------- */
  // Trilha de decisões: append-only, cada entrada leva o hash da anterior (cadeia). FNV-1a 64 bits (hex) apenas
  // para demonstrar integridade; produção usaria SHA-256 + carimbo de tempo.
  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; h2 ^= h1 >>> 13; }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  }
  const ledger = {
    all() { return S.ledger; },
    /**
     * actor: {tipo:'humano'|'agente'|'motor'|'sistema', id, nome}
     * classe de risco (D5): R0 leitura, R1 reversível, R2 financeiro com envelope, R3 dinheiro/cessão (portão humano sempre)
     */
    append({ ts, actor, acao, entidade, resumo, detalhe, classe = 'R1', snapshot }) {
      const prev = S.ledger.length ? S.ledger[S.ledger.length - 1].hash : '0'.repeat(16);
      const e = { id: 'L' + String(S.ledger.length + 1).padStart(5, '0'), seq: S.ledger.length + 1, ts: ts || C.clock.now(), actor, acao, entidade, resumo, detalhe: detalhe || null, classe, snapshot: snapshot || null, prev };
      e.hash = hash(prev + '|' + e.ts + '|' + JSON.stringify(actor) + '|' + acao + '|' + JSON.stringify(entidade) + '|' + resumo + '|' + JSON.stringify(detalhe || null) + '|' + JSON.stringify(snapshot || null));
      S.ledger.push(e); emit('ledger'); return e;
    },
    forEntity(kind, id) { return S.ledger.filter((e) => e.entidade && e.entidade.kind === kind && e.entidade.id === id); },
    verify() {
      let prev = '0'.repeat(16);
      for (const e of S.ledger) {
        const h = hash(prev + '|' + e.ts + '|' + JSON.stringify(e.actor) + '|' + e.acao + '|' + JSON.stringify(e.entidade) + '|' + e.resumo + '|' + JSON.stringify(e.detalhe || null) + '|' + JSON.stringify(e.snapshot || null));
        if (e.prev !== prev || e.hash !== h) return { ok: false, brokenAt: e.seq, id: e.id };
        prev = e.hash;
      }
      return { ok: true, count: S.ledger.length };
    },
    /** adulteração proposital, só para a demonstração de integridade no console de Ops */
    _tamper(seq) { const e = S.ledger[seq - 1]; if (e) { e.resumo += ' (alterado)'; emit('ledger'); } },
    /** só para o seed: ordena por data e recalcula a cadeia de hashes */
    rebuild() {
      S.ledger.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
      let prev = '0'.repeat(16);
      S.ledger.forEach((e, i) => { e.seq = i + 1; e.id = 'L' + String(i + 1).padStart(5, '0'); e.prev = prev; e.hash = hash(prev + '|' + e.ts + '|' + JSON.stringify(e.actor) + '|' + e.acao + '|' + JSON.stringify(e.entidade) + '|' + e.resumo + '|' + JSON.stringify(e.detalhe || null) + '|' + JSON.stringify(e.snapshot || null)); prev = e.hash; });
    },
  };

  /* ---------------------------- notificações ---------------------------- */
  const notify = {
    /** to: {userId} | {orgId} | {role:'ops'} */
    send({ to, tipo = 'info', titulo, corpo = '', link = null, ts }) {
      const n = { id: C.uid('nt'), to, tipo, titulo, corpo, link, ts: ts || C.clock.now(), lida: false };
      S.notifs[n.id] = n; emit('notifs');
      const me = session.get();
      if (me && C.ui && C.ui.toast && !n.silent && matches(n, me) && n.ts >= C.clock.now() - 5000) C.ui.toast(titulo, { type: tipo === 'erro' ? 'error' : tipo === 'sucesso' ? 'success' : tipo === 'alerta' ? 'warn' : 'info', text: corpo, link });
      return n;
    },
    mine() { const me = session.get(); if (!me) return []; return Object.values(S.notifs).filter((n) => matches(n, me)).sort((a, b) => b.ts - a.ts); },
    unread() { return notify.mine().filter((n) => !n.lida).length; },
    read(id) { const n = S.notifs[id]; if (n && !n.lida) { n.lida = true; emit('notifs'); } },
    readAll() { notify.mine().forEach((n) => { n.lida = true; }); emit('notifs'); },
  };
  function matches(n, me) {
    const t = n.to || {};
    return (t.userId && t.userId === me.userId) || (t.orgId && t.orgId === me.orgId) || (t.role && t.role === me.role) || (t.all === true);
  }

  /* ------------------------------ ciclo --------------------------------- */
  function init(buildSeed) {
    let st = load();
    if (!st) { st = buildSeed(); }
    S = st;
    for (const c of COLLECTIONS) if (!S[c]) S[c] = {};
    if (!S.ledger) S.ledger = [];
    if (S.clockNow) C.clock.set(S.clockNow);
    window.addEventListener('beforeunload', save);
    setInterval(save, 5000);
  }
  function reset(buildSeed) {
    localStorage.removeItem(KEY);
    S = buildSeed();
    for (const c of COLLECTIONS) if (!S[c]) S[c] = {};
    C.clock.set(C.clock.start);
    save();
    emit('*reset');
    ['orgs', 'users', 'titulos', 'operacoes', 'lances', 'ledger', 'notifs', 'session', 'config', 'prefs', 'theme'].forEach(emit);
  }

  function _set(st) { S = st; for (const c of COLLECTIONS) if (!S[c]) S[c] = {}; if (!S.ledger) S.ledger = []; }
  C.store = { db, session, prefs, ledger, notify, init, reset, save, on, batch, emit, hash, COLLECTIONS, VERSION, _set };
  C.db = db;
})();
