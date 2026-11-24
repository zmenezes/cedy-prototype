/* =========================================================================
   Cedy protótipo 0.1, utilitários: DOM (h), ícones, formatação, calendário
   útil e relógio de simulação. Sem dependências. Script clássico (funciona
   por duplo clique em index.html, sem servidor).
   ========================================================================= */
(function () {
  const C = (window.Cedy = window.Cedy || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ------------------------------ DOM: h() ------------------------------ */
  /**
   * h('div.card.big#id', { class, style, onclick, dataset, aria-*, ref, ... }, ...children)
   * - 'tag.a.b#id' atalho de classes e id.
   * - class aceita string | array | objeto {cls: bool}.
   * - style aceita string | objeto (aceita variáveis CSS '--x').
   * - children: string, número, Node, array (achatado); null/false/undefined ignorados.
   */
  function h(tag, props, ...children) {
    if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
      children.unshift(props); props = null;
    }
    let name = tag, cls = [], id;
    if (typeof tag === 'string') {
      const m = tag.match(/^([a-zA-Z0-9-]*)((?:[.#][\w-]+)*)$/);
      if (m) {
        name = m[1] || 'div';
        (m[2].match(/[.#][\w-]+/g) || []).forEach((p) => (p[0] === '.' ? cls.push(p.slice(1)) : (id = p.slice(1))));
      }
    }
    const svgTags = /^(svg|path|g|circle|rect|line|polyline|polygon|ellipse|defs|linearGradient|radialGradient|stop|text|tspan|clipPath|mask|use|title|filter|feGaussianBlur)$/;
    const el = svgTags.test(name) ? document.createElementNS(SVGNS, name) : document.createElement(name);
    if (id) el.id = id;
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') {
          if (typeof v === 'string') cls.push(v);
          else if (Array.isArray(v)) v.filter(Boolean).forEach((c) => (Array.isArray(c) ? cls.push(...c.filter(Boolean)) : cls.push(c)));
          else for (const c in v) if (v[c]) cls.push(c);
        } else if (k === 'style') {
          if (typeof v === 'string') el.setAttribute('style', v);
          else for (const s in v) (s.startsWith('--') ? el.style.setProperty(s, v[s]) : (el.style[s] = v[s]));
        } else if (k === 'ref') v(el);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    if (cls.length) el.setAttribute('class', cls.join(' '));
    append(el, children);
    return el;
  }
  function append(el, kids) {
    for (const c of kids) {
      if (c === null || c === undefined || c === false || c === true) continue;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function mount(el, ...kids) { clear(el); append(el, kids); return el; }

  /* ------------------------------ ícones -------------------------------- */
  function icon(name, size = 18, cls = '') {
    const inner = (C.ICONS && C.ICONS[name]) || (C.ICONS && C.ICONS.circle) || '';
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.75');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    s.innerHTML = inner;
    return s;
  }

  /* ----------------------------- formatação ----------------------------- */
  const nfBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const nfBRL0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const nfNum = new Intl.NumberFormat('pt-BR');
  const nfCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DIA_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const p2 = (n) => String(n).padStart(2, '0');

  /** Brasília é UTC-3 sem horário de verão (desde 2019): todo cálculo de calendário usa offset fixo. */
  function sp(ts) {
    const d = new Date(ts - 3 * 3600e3);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
  }
  function spTs(y, m, d, h = 0, mi = 0, s = 0) { return Date.UTC(y, m - 1, d, h + 3, mi, s); }

  const fmt = {
    brl: (n, o = {}) => (n === null || n === undefined || isNaN(n) ? '—' : o.round ? nfBRL0.format(n) : nfBRL.format(n)),
    brlCompact: (n) => (n >= 1e6 ? 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi' : n >= 1e4 ? 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : nfBRL.format(n)),
    num: (n, d) => (d === undefined ? nfNum.format(n) : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })),
    compact: (n) => nfCompact.format(n),
    /** pct(1.2345) => "1,23%"; valores já em % */
    pct: (n, d = 2) => (n === null || n === undefined || isNaN(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%'),
    taxa: (n) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% a.m.'),
    date: (ts) => { if (!ts) return '—'; const t = sp(ts); return `${p2(t.d)}/${p2(t.m)}/${t.y}`; },
    dateShort: (ts) => { if (!ts) return '—'; const t = sp(ts); return `${p2(t.d)} ${MES[t.m - 1]}`; },
    dateLong: (ts) => { const t = sp(ts); return `${DIA_SEM[t.wd]}, ${t.d} de ${MES_LONGO[t.m - 1]} de ${t.y}`; },
    time: (ts) => { if (!ts) return '—'; const t = sp(ts); return `${p2(t.h)}:${p2(t.mi)}`; },
    datetime: (ts) => { if (!ts) return '—'; const t = sp(ts); return `${p2(t.d)}/${p2(t.m)}/${t.y} ${p2(t.h)}:${p2(t.mi)}`; },
    month: (ts) => { const t = sp(ts); return `${MES[t.m - 1]}/${String(t.y).slice(2)}`; },
    monthLong: (comp) => { const [y, m] = comp.split('-').map(Number); return `${MES_LONGO[m - 1]} de ${y}`; },
    weekday: (ts) => DIA_SEM[sp(ts).wd],
    /** tempo relativo à hora de simulação */
    rel: (ts, now = C.clock.now()) => {
      const diff = ts - now, a = Math.abs(diff), fut = diff > 0;
      const s = Math.round(a / 1000), m = Math.round(a / 60000), hh = Math.round(a / 3600000), d = Math.round(a / 86400000);
      let txt;
      if (s < 45) txt = 'agora'; else if (m < 60) txt = `${m} min`; else if (hh < 24) txt = `${hh} h`; else if (d < 45) txt = `${d} ${d === 1 ? 'dia' : 'dias'}`; else txt = `${Math.round(d / 30)} meses`;
      return txt === 'agora' ? 'agora' : fut ? 'em ' + txt : 'há ' + txt;
    },
    /** duração em ms => "2h 14min" | "35min" | "48s" */
    dur: (ms) => {
      const neg = ms < 0; ms = Math.abs(ms);
      const s = Math.floor(ms / 1000), m = Math.floor(s / 60), hh = Math.floor(m / 60), d = Math.floor(hh / 24);
      const out = d ? `${d}d ${hh % 24}h` : hh ? `${hh}h ${p2(m % 60)}min` : m ? `${m}min ${p2(s % 60)}s` : `${s}s`;
      return (neg ? '-' : '') + out;
    },
    clock: (ms) => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${p2(hh)}:${p2(m)}:${p2(s % 60)}`; },
    cnpj: (v) => { const d = String(v).replace(/\D/g, '').padEnd(14, '0').slice(0, 14); return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`; },
    cpf: (v) => { const d = String(v).replace(/\D/g, '').padEnd(11, '0').slice(0, 11); return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`; },
    initials: (name) => String(name || '?').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(),
    plural: (n, one, many) => `${fmt.num(n)} ${n === 1 ? one : many}`,
    bytes: (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'),
  };

  /** "1.234,56" -> 1234.56 ; aceita "R$ 1.234,56" */
  function parseBRL(s) {
    if (typeof s === 'number') return s;
    const c = String(s || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(c);
    return isNaN(n) ? 0 : n;
  }

  /* ------------------------------ ids / rng ------------------------------ */
  let seq = 0;
  const uid = (p = 'id') => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  /** PRNG determinístico (mulberry32) para a geração dos dados de demonstração */
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const groupBy = (arr, f) => arr.reduce((m, x) => { (m[f(x)] = m[f(x)] || []).push(x); return m; }, {});
  const prefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => window.matchMedia('(max-width: 859px)').matches;

  /* ------------------------- calendário de dias úteis ------------------- */
  // Feriados nacionais e pontos bancários (fonte: calendário FEBRABAN; conferir antes de produção).
  const FERIADOS = new Set(['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
    '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01', '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25']);
  const key = (ts) => { const t = sp(ts); return `${t.y}-${p2(t.m)}-${p2(t.d)}`; };
  const isUtil = (ts) => { const t = sp(ts); return t.wd !== 0 && t.wd !== 6 && !FERIADOS.has(key(ts)); };
  const startOfDay = (ts) => { const t = sp(ts); return spTs(t.y, t.m, t.d, 0, 0, 0); };
  const addDays = (ts, n) => ts + n * 86400000;
  /** próximo dia útil estritamente depois de ts, às h:mi */
  function nextUtil(ts, h = 8, mi = 0) { let d = startOfDay(ts); do { d = addDays(d, 1); } while (!isUtil(d)); const t = sp(d); return spTs(t.y, t.m, t.d, h, mi); }
  /** soma n dias úteis (n>=0) mantendo hora */
  function addUteis(ts, n) { let d = ts; let c = 0; while (c < n) { d = addDays(d, 1); if (isUtil(d)) c++; } return d; }
  /** ajusta para dia útil: se ts cai em não útil, vai para o próximo útil (mesma hora) */
  function toUtil(ts) { let d = ts; while (!isUtil(d)) d = addDays(d, 1); return d; }
  /** n-ésimo dia útil do mês de ts (1 = primeiro) */
  function nthUtil(y, m, n) { let d = spTs(y, m, 1, 9, 0); let c = 0; while (true) { if (isUtil(d)) { c++; if (c === n) return d; } d = addDays(d, 1); } }
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

  /* ------------------------------ relógio ------------------------------- */
  // Hora de simulação (BRT). Começa em 23/11/2026 10:12 e continua de onde parou ao recarregar.
  const SIM_START = spTs(2026, 11, 23, 10, 12, 0);
  const clock = {
    _base: SIM_START, _real: Date.now(),
    now() { return this._base + (Date.now() - this._real); },
    set(ts) { this._base = ts; this._real = Date.now(); clock.emit(); },
    advance(ms) { this.set(this.now() + ms); },
    start: SIM_START,
    _subs: new Set(),
    onJump(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
    emit() { this._subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); },
  };

  Object.assign(C, { h, append, clear, mount, icon, fmt, parseBRL, uid, rng, clamp, sum, round2, debounce, groupBy, prefersReduced, isMobile,
    clock, cal: { sp, spTs, isUtil, startOfDay, addDays, nextUtil, addUteis, toUtil, nthUtil, daysBetween, FERIADOS, key, MES, MES_LONGO } });
})();
