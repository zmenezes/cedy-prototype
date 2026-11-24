/* =========================================================================
   Cedy Design System, componentes (protótipo 0.1)
   Todos os controles são desenhados no sistema próprio (nada de <select>,
   <input type=checkbox/date/file/range> nativos na superfície), mantendo o
   comportamento padrão: teclado, foco visível, ARIA, alvos de toque >= 44px.

   Convenção dos controles: retornam um Element com `.value` (get/set) e
   disparam o evento 'change' (CustomEvent com detail=valor) + callback onChange.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = (C.ui = C.ui || {});

  const overlayRoot = () => document.getElementById('overlay-root');
  const tick = (fn) => requestAnimationFrame(fn);

  /** define .value e dispara 'change' */
  function ctl(el, get, set) {
    Object.defineProperty(el, 'value', { get, set: (v) => { set(v); }, configurable: true });
    el.emitChange = () => el.dispatchEvent(new CustomEvent('change', { detail: get(), bubbles: false }));
    return el;
  }
  let uidn = 0; const nid = (p = 'c') => `${p}${++uidn}`;

  /* ------------------------------ botões -------------------------------- */
  /** variant: primary | secondary | ghost | danger | ai | link ; size: sm | md | lg */
  ui.btn = function (label, o = {}) {
    const el = h('button', { type: o.type || 'button', class: ['btn', 'btn-' + (o.variant || 'secondary'), 'btn-' + (o.size || 'md'), o.block && 'btn-block', o.class], disabled: o.disabled, 'aria-label': o.aria, title: o.title, onclick: async (ev) => {
      if (el.disabled || el.classList.contains('is-loading')) return;
      if (o.onclick) {
        const r = o.onclick(ev, el);
        if (r && typeof r.then === 'function') { el.classList.add('is-loading'); el.setAttribute('aria-busy', 'true'); try { await r; } finally { el.classList.remove('is-loading'); el.removeAttribute('aria-busy'); } }
      }
      if (o.route) C.router.go(o.route);
    } },
    o.icon && icon(o.icon, o.size === 'lg' ? 20 : 16), label !== null && label !== undefined && h('span.btn-label', label), o.iconRight && icon(o.iconRight, 16), h('span.btn-spin', ui.spinner(16)));
    return el;
  };
  ui.iconBtn = function (name, o = {}) {
    return h('button', { type: 'button', class: ['iconbtn', o.variant && 'iconbtn-' + o.variant, o.size === 'sm' && 'iconbtn-sm', o.class], 'aria-label': o.label || name, title: o.label, onclick: o.onclick, disabled: o.disabled }, icon(name, o.size === 'sm' ? 16 : 18), o.badge ? h('span.iconbtn-badge', o.badge) : null);
  };
  ui.link = (label, route, o = {}) => h('a', { href: '#' + route, class: ['link', o.class], onclick: (e) => { if (o.onclick) o.onclick(e); } }, label);

  /* --------------------------- spinner (8 segmentos) --------------------- */
  ui.spinner = function (size = 20) {
    const segs = [];
    for (let i = 0; i < 8; i++) segs.push(h('i', { style: { '--i': i } }));
    return h('span.spin8', { style: { width: size + 'px', height: size + 'px' }, role: 'status', 'aria-label': 'Carregando' }, segs);
  };

  /* -------------------------------- badges ------------------------------- */
  ui.badge = (text, tone = 'neutral', o = {}) => h('span', { class: ['badge', 'badge-' + tone, o.class, o.solid && 'badge-solid'], title: o.title }, o.dot ? h('i.badge-dot') : null, o.icon ? icon(o.icon, 12) : null, text);
  const ST = {
    operacao: { rascunho: ['Rascunho', 'neutral'], aberta: ['Em leilão', 'blue'], cessao: ['Assinar cessão', 'amber'], aguardando_pagamento: ['Aguardando pagamento', 'amber'], paga: ['Paga, a vencer', 'teal'], vencida: ['Vencida', 'red'], parcial: ['Liquidação parcial', 'amber'], liquidada: ['Liquidada', 'green'], cancelada: ['Cancelada', 'neutral'], expirada: ['Expirada', 'neutral'], recomprada: ['Recomprada', 'violet'] },
    titulo: { validando: ['Em validação', 'amber'], disponivel: ['Disponível', 'green'], em_operacao: ['Em operação', 'blue'], cedido: ['Cedido', 'teal'], liquidado: ['Liquidado', 'green'], vencido: ['Vencido', 'red'], recusado: ['Recusado', 'red'], recomprado: ['Recomprado', 'violet'] },
    lote: { validando: ['Em validação', 'amber'], aprovado: ['Aprovado', 'green'], recusado: ['Recusado', 'red'] },
    org: { ativo: ['Ativo', 'green'], kyc: ['KYC em análise', 'amber'], pendente: ['Pendências', 'amber'], suspenso: ['Suspenso', 'red'], inativo: ['Inativo', 'neutral'], convidado: ['Convidado', 'neutral'] },
    contrato: { gerado: ['Aguardando assinaturas', 'amber'], parcial: ['1 de 2 assinaturas', 'amber'], assinado: ['Assinado', 'green'] },
    lance: { ativo: ['Líder', 'green'], superado: ['Superado', 'amber'], vencedor: ['Vencedor', 'green'], retirado: ['Retirado', 'neutral'], perdido: ['Perdido', 'neutral'], encerrado: ['Encerrado', 'neutral'] },
    extrato: { novo: ['Novo', 'blue'], conciliado: ['Conciliado', 'green'], pendente_mesa: ['Na Mesa', 'amber'], recurso_livre: ['Recurso Livre', 'teal'] },
    fatura: { aberta: ['Em aberto', 'amber'], paga: ['Paga', 'green'], vencida: ['Vencida', 'red'], isenta: ['Isenta', 'neutral'] },
    premio: { apurado: ['Apurado', 'blue'], em_contestacao: ['Em contestação', 'amber'], aprovado: ['Aprovado', 'green'], pago: ['Pago', 'green'], retido: ['Retido (mín. R$ 100)', 'neutral'] },
    kyc: { em_analise: ['Em análise', 'amber'], pendencia: ['Pendência', 'amber'], aprovado: ['Aprovado', 'green'], reprovado: ['Reprovado', 'red'] },
    proposta: { pendente: ['Aguardando você', 'violet'], aprovada: ['Aprovada', 'green'], rejeitada: ['Rejeitada', 'red'], auto: ['Executada', 'teal'], expirada: ['Expirada', 'neutral'], cancelada: ['Cancelada', 'neutral'] },
    convite: { convidado: ['Convidado', 'neutral'], cadastrado: ['Cadastrado', 'blue'], kyc: ['KYC', 'amber'], ativo: ['Ativo', 'green'], inativo: ['Inativo 90d', 'red'], recusado: ['Recusado', 'red'] },
  };
  ui.ST = ST;
  ui.status = (kind, st, o = {}) => { const m = (ST[kind] || {})[st] || [st, 'neutral']; return ui.badge(m[0], m[1], Object.assign({ dot: true }, o)); };
  ui.statusLabel = (kind, st) => ((ST[kind] || {})[st] || [st])[0];

  /* ------------------------------ avatar --------------------------------- */
  ui.avatar = function (name, o = {}) {
    const hue = o.hue !== undefined ? o.hue : [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    return h('span', { class: ['avatar', o.square && 'avatar-sq', o.size && 'avatar-' + o.size], style: { '--h': hue }, 'aria-hidden': 'true' }, fmt.initials(name));
  };

  /* ------------------------------ cards ---------------------------------- */
  ui.card = function (o = {}, ...body) {
    if (o instanceof Node || typeof o === 'string' || Array.isArray(o)) { body.unshift(o); o = {}; }
    const head = (o.title || o.actions) ? h('header.card-head', h('div.card-titles', o.title && h(o.titleTag || 'h3.card-title', o.title), o.subtitle && h('p.card-sub', o.subtitle)), o.actions ? h('div.card-actions', o.actions) : null) : null;
    return h('section', { class: ['card', o.flush && 'card-flush', o.tone && 'card-' + o.tone, o.class, o.interactive && 'card-hover'], onclick: o.onclick, style: o.style, tabindex: o.onclick ? 0 : null, role: o.onclick ? 'button' : null, onkeydown: o.onclick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onclick(e); } } : null }, head, o.flush ? body : h('div.card-body', body));
  };
  /** KPI sóbrio (sem template "hero metric"): rótulo, valor, contexto. */
  ui.kpi = function (o) {
    const kf = { brl: (v) => fmt.brl(v, { round: v > 1000 }), brlc: (v) => fmt.brlCompact(v), pct: (v) => fmt.pct(v) }[o.fmt] || ((v) => fmt.num(Math.round(v)));
    const valEl = h('div.kpi-value', typeof o.value === 'number' && o.count !== false && o.display === undefined ? { 'data-count': o.value, 'data-fmt': o.fmt || 'num' } : null, o.display !== undefined ? o.display : (typeof o.value === 'number' ? kf(o.value) : o.value));
    return h('div', { class: ['kpi', o.tone && 'kpi-' + o.tone, o.onclick && 'kpi-click'], onclick: o.onclick, tabindex: o.onclick ? 0 : null, role: o.onclick ? 'link' : null, onkeydown: o.onclick ? (e) => { if (e.key === 'Enter') o.onclick(e); } : null },
      h('div.kpi-top', o.icon && h('span.kpi-icon', icon(o.icon, 16)), h('span.kpi-label', o.label)), valEl,
      (o.delta !== undefined || o.hint) && h('div.kpi-foot', o.delta !== undefined && h('span', { class: ['delta', o.delta >= 0 ? 'up' : 'down', o.deltaGood === false && 'bad'] }, icon(o.delta >= 0 ? 'arrow-up-right' : 'arrow-down-right', 13), fmt.pct(Math.abs(o.delta), 1)), o.hint && h('span.kpi-hint', o.hint)),
      o.spark && h('div.kpi-spark', ui.chart.spark(o.spark, { tone: o.tone })));
  };

  ui.empty = (o) => h('div.empty', h('div.empty-art', icon(o.icon || 'inbox', 28)), h('h4.empty-title', o.title || 'Nada por aqui'), o.text && h('p.empty-text', o.text), o.action ? h('div.empty-action', o.action) : null);
  ui.skeleton = (n = 3, o = {}) => h('div.skel-wrap', Array.from({ length: n }, (_, i) => h('div.skel', { style: { width: o.widths ? o.widths[i % o.widths.length] : (90 - (i % 3) * 18) + '%', height: o.h || '14px' } })));
  ui.callout = (o) => h('div', { class: ['callout', 'callout-' + (o.tone || 'info'), o.class], role: o.tone === 'error' ? 'alert' : 'status' }, h('span.callout-ic', icon(o.icon || ({ info: 'info', warn: 'triangle-alert', error: 'circle-alert', success: 'circle-check', ai: 'sparkles' }[o.tone || 'info']), 18)), h('div.callout-body', o.title && h('strong', o.title), o.text && h('div', o.text), o.children), o.actions ? h('div.callout-actions', o.actions) : null);
  ui.progress = (value, o = {}) => h('div', { class: ['progress', o.tone && 'progress-' + o.tone, o.thin && 'progress-thin'], role: 'progressbar', 'aria-valuenow': Math.round(value), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: Math.max(0, Math.min(100, value)) + '%' } }));
  ui.divider = () => h('hr.divider');
  ui.money = (n, o = {}) => h('span', { class: ['money', o.strong && 'money-strong', o.tone && 'money-' + o.tone] }, fmt.brl(n, o));
  ui.kv = (pairs, o = {}) => h('dl', { class: ['kv', o.cols && 'kv-cols-' + o.cols, o.class] }, pairs.filter(Boolean).map(([k, v, hint]) => h('div.kv-row', h('dt', k), h('dd', v === null || v === undefined || v === '' ? '—' : v, hint && h('small', hint)))));
  ui.chip = (label, o = {}) => h('span', { class: ['chip', o.class] }, o.icon && icon(o.icon, 13), label, o.onremove && h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover ' + label, onclick: o.onremove }, icon('x', 12)));
  ui.ai = (text, o = {}) => h('span', { class: ['ai-tag', o.class], title: 'Gerado por agente de IA (simulado no protótipo). A IA propõe; o motor de regras decide; um humano garante.' }, icon('sparkles', 12), text || 'IA');

  /* ------------------------------ campos --------------------------------- */
  ui.field = function (o, control) {
    const id = nid('f');
    const lab = o.label ? h('label.field-label', { for: id }, o.label, o.required && h('i.req', '*'), o.optional && h('span.opt', 'opcional')) : null;
    const hint = o.hint ? h('div.field-hint', { id: id + '-h' }, o.hint) : null;
    const err = h('div.field-error', { id: id + '-e', role: 'alert', hidden: !o.error }, o.error ? [icon('circle-alert', 13), o.error] : null);
    const wrap = h('div', { class: ['field', o.error && 'has-error', o.class] }, lab, control, hint, err);
    const inner = control.querySelector ? (control.matches('input,textarea,button') ? control : control.querySelector('input,textarea,button')) : null;
    if (inner) { inner.id = inner.id || id; inner.setAttribute('aria-describedby', (hint ? id + '-h ' : '') + id + '-e'); if (o.required) inner.setAttribute('aria-required', 'true'); }
    wrap.setError = (msg) => { wrap.classList.toggle('has-error', !!msg); err.hidden = !msg; C.clear(err); if (msg) { err.append(icon('circle-alert', 13), msg); if (inner) inner.setAttribute('aria-invalid', 'true'); } else if (inner) inner.removeAttribute('aria-invalid'); };
    return wrap;
  };

  const MASK = {
    cnpj: (v) => { const d = v.replace(/\D/g, '').slice(0, 14); return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'); },
    cpf: (v) => v.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'),
    phone: (v) => { const d = v.replace(/\D/g, '').slice(0, 11); return d.length > 10 ? d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, ''); },
    cep: (v) => v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2'),
    otp: (v) => v.replace(/\D/g, '').slice(0, 6),
  };
  /** type: text | email | password | tel | search | number | textarea ; mask: cnpj|cpf|phone|cep|otp */
  ui.input = function (o = {}) {
    const tag = o.type === 'textarea' ? 'textarea' : 'input';
    let pwVisible = false;
    const inp = h(tag, { class: 'input-el', type: tag === 'input' ? (o.type === 'password' ? 'password' : o.type === 'number' ? 'text' : o.type || 'text') : null, rows: o.rows || 3, placeholder: o.placeholder, value: o.value, inputmode: o.inputmode || (o.mask === 'cnpj' || o.mask === 'cpf' || o.mask === 'phone' || o.mask === 'cep' || o.mask === 'otp' ? 'numeric' : null), autocomplete: o.autocomplete || 'off', maxlength: o.maxlength, disabled: o.disabled, readonly: o.readonly, name: o.name, 'aria-label': o.aria,
      oninput: () => { if (o.mask) { inp.value = MASK[o.mask](inp.value); } if (o.onInput) o.onInput(inp.value); wrap.emitChange(); },
      onblur: () => o.onBlur && o.onBlur(inp.value), onkeydown: (e) => { if (e.key === 'Enter' && o.onEnter && tag === 'input') { e.preventDefault(); o.onEnter(inp.value); } } });
    if (o.value !== undefined && o.value !== null) inp.value = o.value;
    const pwBtn = o.type === 'password' ? h('button', { type: 'button', class: 'input-aff', 'aria-label': 'Mostrar senha', onclick: () => { pwVisible = !pwVisible; inp.type = pwVisible ? 'text' : 'password'; C.clear(pwBtn); pwBtn.append(icon(pwVisible ? 'eye-off' : 'eye', 16)); } }, icon('eye', 16)) : null;
    const wrap = h('div', { class: ['input', o.size && 'input-' + o.size, tag === 'textarea' && 'input-area', o.disabled && 'is-disabled', o.class], onclick: (e) => { if (e.target === wrap) inp.focus(); } },
      o.icon && h('span.input-ic', icon(o.icon, 16)), o.prefix && h('span.input-pre', o.prefix), inp, o.suffix && h('span.input-suf', o.suffix), pwBtn, o.clearable && h('button', { type: 'button', class: 'input-aff input-clear', 'aria-label': 'Limpar', onclick: () => { inp.value = ''; inp.focus(); if (o.onInput) o.onInput(''); wrap.emitChange(); } }, icon('x', 14)));
    ctl(wrap, () => inp.value, (v) => { inp.value = v == null ? '' : o.mask ? MASK[o.mask](String(v)) : v; });
    wrap.input = inp; return wrap;
  };
  /** valor numérico em R$ */
  ui.currency = function (o = {}) {
    const wrap = ui.input({ prefix: 'R$', inputmode: 'numeric', placeholder: o.placeholder || '0,00', class: ['input-num', o.class], size: o.size, disabled: o.disabled, aria: o.aria, name: o.name });
    const inp = wrap.input; let cents = Math.round((o.value || 0) * 100);
    const draw = () => { inp.value = cents ? (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; };
    inp.addEventListener('input', () => { const d = inp.value.replace(/\D/g, ''); cents = d ? parseInt(d.slice(0, 13), 10) : 0; draw(); if (o.onInput) o.onInput(cents / 100); wrap.emitChange(); });
    inp.oninput = null; draw();
    ctl(wrap, () => cents / 100, (v) => { cents = Math.round((v || 0) * 100); draw(); });
    return wrap;
  };
  /** número decimal com sufixo (ex.: % a.m.) */
  ui.numeric = function (o = {}) {
    const wrap = ui.input({ suffix: o.suffix, inputmode: 'decimal', placeholder: o.placeholder, class: 'input-num', size: o.size, disabled: o.disabled, aria: o.aria });
    const inp = wrap.input; let val = o.value === undefined ? null : o.value;
    const draw = () => { inp.value = val === null || isNaN(val) ? '' : String(val).replace('.', ','); };
    inp.addEventListener('input', () => { const t = inp.value.replace(/[^\d,]/g, ''); const n = parseFloat(t.replace(',', '.')); inp.value = t; val = isNaN(n) ? null : n; if (o.onInput) o.onInput(val); wrap.emitChange(); });
    inp.addEventListener('blur', () => { if (val !== null && o.min !== undefined) val = Math.max(o.min, val); if (val !== null && o.max !== undefined) val = Math.min(o.max, val); if (val !== null && o.decimals !== undefined) val = Number(val.toFixed(o.decimals)); draw(); wrap.emitChange(); if (o.onBlur) o.onBlur(val); });
    draw(); ctl(wrap, () => val, (v) => { val = v; draw(); });
    return wrap;
  };

  /* -------------------------- checkbox / radio / switch ------------------ */
  ui.checkbox = function (o = {}) {
    let on = !!o.checked;
    const btn = h('button', { type: 'button', role: 'checkbox', class: 'check', 'aria-checked': String(on), disabled: o.disabled, 'aria-label': o.aria || (typeof o.label === 'string' ? o.label : null), onclick: (e) => { e.stopPropagation(); set(!on, true); } }, h('span.check-box', icon('check', 14)));
    const el = h('label', { class: ['checkrow', o.disabled && 'is-disabled', o.class], onclick: (e) => { if (e.target.closest('button')) return; e.preventDefault(); if (!o.disabled) set(!on, true); } }, btn, o.label && h('span.check-label', o.label, o.hint && h('small', o.hint)));
    function set(v, user) { on = !!v; btn.setAttribute('aria-checked', String(on)); el.classList.toggle('is-on', on); if (user) { if (o.onChange) o.onChange(on); el.emitChange(); } }
    set(on); ctl(el, () => on, (v) => set(v)); el.btn = btn; return el;
  };
  ui.switch = function (o = {}) {
    let on = !!o.checked;
    const btn = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(on), disabled: o.disabled, 'aria-label': o.aria || (typeof o.label === 'string' ? o.label : null), onclick: () => set(!on, true) }, h('i.switch-knob'));
    const el = h('div', { class: ['switchrow', o.class] }, btn, o.label && h('span.switch-label', { onclick: () => !o.disabled && set(!on, true) }, o.label, o.hint && h('small', o.hint)));
    function set(v, user) { on = !!v; btn.setAttribute('aria-checked', String(on)); el.classList.toggle('is-on', on); if (user) { if (o.onChange) o.onChange(on); el.emitChange(); } }
    set(on); ctl(el, () => on, (v) => set(v)); return el;
  };
  /** options: [{value,label,hint,icon,disabled}] ; layout: 'stack' | 'row' | 'cards' */
  ui.radio = function (o) {
    let val = o.value; const name = nid('rg');
    const items = o.options.map((op) => {
      const b = h('button', { type: 'button', role: 'radio', class: ['radio', o.layout === 'cards' && 'radio-card'], 'aria-checked': String(op.value === val), disabled: op.disabled, dataset: { v: op.value }, onclick: () => set(op.value, true),
        onkeydown: (e) => { const i = o.options.findIndex((x) => x.value === val); if (['ArrowDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); const n = o.options[(i + 1) % o.options.length]; set(n.value, true); focusSel(); } if (['ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); const n = o.options[(i - 1 + o.options.length) % o.options.length]; set(n.value, true); focusSel(); } } },
        h('span.radio-dot'), op.icon && h('span.radio-ic', icon(op.icon, 18)), h('span.radio-text', h('strong', op.label), op.hint && h('small', op.hint)), op.right && h('span.radio-right', op.right));
      return b;
    });
    const el = h('div', { class: ['radiogroup', 'rg-' + (o.layout || 'stack'), o.class], role: 'radiogroup', 'aria-label': o.aria }, items);
    function focusSel() { const s = items.find((b) => b.getAttribute('aria-checked') === 'true'); if (s) s.focus(); }
    function set(v, user) { val = v; items.forEach((b) => { const on = b.dataset.v === String(v); b.setAttribute('aria-checked', String(on)); b.tabIndex = on || (val === undefined && b === items[0]) ? 0 : -1; }); if (user) { if (o.onChange) o.onChange(v); el.emitChange(); } }
    set(val); ctl(el, () => val, (v) => set(v)); return el;
  };
  ui.segmented = function (o) {
    let val = o.value;
    const btns = o.options.map((op) => h('button', { type: 'button', role: 'tab', class: 'seg-btn', dataset: { v: op.value }, 'aria-selected': String(op.value === val), onclick: () => set(op.value, true) }, op.icon && icon(op.icon, 15), op.label, op.count !== undefined && h('span.seg-count', op.count)));
    const thumb = h('i.seg-thumb');
    const el = h('div', { class: ['seg', o.size === 'sm' && 'seg-sm', o.block && 'seg-block', o.class], role: 'tablist', 'aria-label': o.aria }, thumb, btns);
    function place() { const b = btns.find((x) => x.dataset.v === String(val)); if (!b || !el.isConnected) return; thumb.style.width = b.offsetWidth + 'px'; thumb.style.transform = `translateX(${b.offsetLeft}px)`; }
    function set(v, user) { val = v; btns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === String(v)))); place(); if (user) { if (o.onChange) o.onChange(v); el.emitChange(); } }
    ctl(el, () => val, (v) => set(v)); el.place = place; tick(() => { place(); setTimeout(place, 120); }); window.addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    return el;
  };
  /** abas de página: items [{id,label,count,icon}] */
  ui.tabs = function (o) {
    let val = o.value || o.items[0].id;
    const btns = o.items.map((it) => h('button', { type: 'button', role: 'tab', class: 'tab', dataset: { v: it.id }, 'aria-selected': String(it.id === val), onclick: () => set(it.id, true) }, it.icon && icon(it.icon, 15), it.label, it.count !== undefined && it.count !== null && h('span.tab-count', it.count)));
    const bar = h('i.tab-bar');
    const el = h('div', { class: ['tabs', o.class], role: 'tablist' }, h('div.tabs-scroll', btns, bar));
    function place() { const b = btns.find((x) => x.dataset.v === String(val)); if (!b || !el.isConnected) return; bar.style.width = b.offsetWidth + 'px'; bar.style.transform = `translateX(${b.offsetLeft}px)`; b.scrollIntoView && b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    function set(v, user) { val = v; btns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === String(v)))); place(); if (user) { if (o.onChange) o.onChange(v); el.emitChange(); } }
    ctl(el, () => val, (v) => set(v)); tick(() => { place(); setTimeout(place, 150); }); window.addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    return el;
  };
  ui.chips = function (o) { // multi-seleção em chips filtráveis
    let val = new Set(o.value || []);
    const btns = o.options.map((op) => h('button', { type: 'button', class: 'chipbtn', dataset: { v: op.value }, 'aria-pressed': String(val.has(op.value)), onclick: () => { val.has(op.value) ? val.delete(op.value) : val.add(op.value); sync(); if (o.onChange) o.onChange([...val]); el.emitChange(); } }, op.icon && icon(op.icon, 13), op.label, op.count !== undefined && h('span.chip-n', op.count)));
    const el = h('div', { class: ['chipbtns', o.class], role: 'group', 'aria-label': o.aria }, btns);
    function sync() { btns.forEach((b) => b.setAttribute('aria-pressed', String(val.has(b.dataset.v)))); }
    ctl(el, () => [...val], (v) => { val = new Set(v || []); sync(); }); return el;
  };

  /* ------------------------------ slider --------------------------------- */
  ui.slider = function (o) {
    const { min = 0, max = 100, step = 1 } = o; let val = o.value === undefined ? min : o.value; let dragging = false;
    const fill = h('i.slider-fill'), thumb = h('button', { type: 'button', class: 'slider-thumb', role: 'slider', 'aria-valuemin': min, 'aria-valuemax': max, 'aria-label': o.aria || 'Valor' });
    const track = h('div.slider-track', fill, thumb);
    const out = o.format ? h('output.slider-out') : null;
    const el = h('div', { class: ['slider', o.class] }, track, out);
    const snap = (v) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
    function draw() { const p = ((val - min) / (max - min)) * 100; fill.style.width = p + '%'; thumb.style.left = p + '%'; thumb.setAttribute('aria-valuenow', val); thumb.setAttribute('aria-valuetext', o.format ? o.format(val) : String(val)); if (out) out.textContent = o.format(val); }
    function fromEvent(e) { const r = track.getBoundingClientRect(); const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; return snap(min + (x / r.width) * (max - min)); }
    function set(v, user) { val = Number(snap(v).toFixed(6)); draw(); if (user) { if (o.onChange) o.onChange(val); el.emitChange(); } }
    track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); thumb.focus(); set(fromEvent(e), true); el.classList.add('is-drag'); });
    track.addEventListener('pointermove', (e) => { if (dragging) set(fromEvent(e), true); });
    track.addEventListener('pointerup', () => { dragging = false; el.classList.remove('is-drag'); });
    thumb.addEventListener('keydown', (e) => { const k = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 }[e.key]; if (k) { e.preventDefault(); set(val + k, true); } if (e.key === 'Home') set(min, true); if (e.key === 'End') set(max, true); });
    ctl(el, () => val, (v) => set(v)); draw(); return el;
  };

  /* ------------------------ popover / menu / select ---------------------- */
  const openPops = new Set();
  function closeAllPops(except) { [...openPops].forEach((p) => p !== except && p.close()); }
  /**
   * Abre conteúdo ancorado. Em telas estreitas vira bottom sheet quando o.sheet !== false.
   * Retorna { close, el }
   */
  ui.popover = function (anchor, content, o = {}) {
    if (o.exclusive !== false) closeAllPops();
    if (C.isMobile() && o.sheet !== false) {
      const m = ui.sheet({ title: o.title, body: content, onClose: o.onClose, compact: true });
      const api = { close: m.close, el: m.el }; return api;
    }
    const pop = h('div', { class: ['pop', o.class], role: o.role || 'dialog', style: { opacity: 0 } }, content);
    overlayRoot().appendChild(pop);
    function place() {
      const r = anchor.getBoundingClientRect(); const pw = pop.offsetWidth, ph = pop.offsetHeight; const vw = innerWidth, vh = innerHeight; const gap = 6;
      if (o.matchWidth) pop.style.width = r.width + 'px';
      let top = r.bottom + gap, up = false;
      if (top + ph > vh - 8 && r.top - gap - ph > 8) { top = r.top - gap - ph; up = true; }
      let left = (o.align === 'end') ? r.right - pop.offsetWidth : r.left;
      left = Math.min(Math.max(8, left), vw - pop.offsetWidth - 8);
      pop.style.top = Math.max(8, top) + 'px'; pop.style.left = left + 'px'; pop.dataset.up = up ? '1' : '0';
      if (top + ph > vh - 8 && !up) pop.style.maxHeight = vh - top - 12 + 'px';
    }
    tick(() => { place(); pop.style.opacity = ''; pop.classList.add('in'); });
    const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) api.close(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); anchor.focus && anchor.focus(); } };
    const rs = () => place();
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
    document.addEventListener('keydown', esc, true); window.addEventListener('resize', rs); window.addEventListener('scroll', rs, true);
    const api = { el: pop, place, close() { if (api.closed) return; api.closed = true; openPops.delete(api); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); window.removeEventListener('resize', rs); window.removeEventListener('scroll', rs, true); pop.classList.remove('in'); pop.classList.add('out'); setTimeout(() => pop.remove(), 120); if (o.onClose) o.onClose(); } };
    openPops.add(api); return api;
  };

  /** Menu de ações: items [{label, icon, onclick, danger, divider, disabled, hint, header}] */
  ui.menu = function (anchor, items, o = {}) {
    let api; const list = h('div.menu', { role: 'menu' }, items.filter(Boolean).map((it) => it.divider ? h('hr.menu-div') : it.header ? h('div.menu-head', it.header) : h('button', { type: 'button', role: 'menuitem', class: ['menu-item', it.danger && 'danger', it.active && 'is-active'], disabled: it.disabled, onclick: () => { api.close(); if (it.onclick) it.onclick(); } }, it.icon && icon(it.icon, 16), h('span.menu-lab', it.label, it.hint && h('small', it.hint)), it.right)));
    api = ui.popover(anchor, list, Object.assign({ align: 'end', role: 'menu', title: o.title }, o));
    const first = list.querySelector('.menu-item:not([disabled])'); if (first) setTimeout(() => first.focus(), 30);
    list.addEventListener('keydown', (e) => { const its = [...list.querySelectorAll('.menu-item:not([disabled])')]; const i = its.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); its[(i + 1) % its.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); } });
    return api;
  };
  ui.moreMenu = (items, o = {}) => { const b = ui.iconBtn('ellipsis', { label: o.label || 'Mais ações', size: 'sm', onclick: (e) => { e.stopPropagation(); ui.menu(b, items); } }); return b; };

  /** options: [{value,label,hint,icon,group,disabled}] */
  ui.select = function (o) {
    let val = o.value; const opts = o.options;
    const labelOf = (v) => { const x = opts.find((y) => y.value === v); return x ? x.label : null; };
    const txt = h('span.select-text'); const btn = h('button', { type: 'button', class: ['select', o.size && 'input-' + o.size, o.class], 'aria-haspopup': 'listbox', 'aria-expanded': 'false', disabled: o.disabled, 'aria-label': o.aria, onclick: open, onkeydown: (e) => { if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } } }, o.icon && icon(o.icon, 16), txt, icon('chevron-down', 16, 'select-chev'));
    function draw() { const l = labelOf(val); txt.textContent = l || o.placeholder || 'Selecionar'; txt.classList.toggle('is-ph', !l); }
    function open() {
      if (btn.disabled) return; let q = '';
      const search = o.searchable ? h('div.select-search', icon('search', 15), h('input', { placeholder: 'Buscar…', 'aria-label': 'Buscar opção', oninput: (e) => { q = e.target.value.toLowerCase(); render(); } })) : null;
      const list = h('div.select-list', { role: 'listbox', tabindex: '-1' });
      let api, idx = 0, shown = [];
      function render() {
        C.clear(list); shown = opts.filter((x) => !q || x.label.toLowerCase().includes(q) || (x.hint || '').toLowerCase().includes(q)); let lastG;
        if (!shown.length) list.append(h('div.select-empty', 'Nada encontrado'));
        shown.forEach((x, i) => { if (x.group && x.group !== lastG) { list.append(h('div.select-group', x.group)); lastG = x.group; } list.append(h('button', { type: 'button', role: 'option', class: ['select-opt', x.value === val && 'is-sel', i === idx && 'is-hi'], 'aria-selected': String(x.value === val), disabled: x.disabled, dataset: { i }, onmouseenter: () => { idx = i; hi(); }, onclick: () => pick(x) }, x.icon && icon(x.icon, 16), h('span.opt-lab', x.label, x.hint && h('small', x.hint)), x.value === val && icon('check', 16, 'opt-check'))); });
      }
      function hi() { list.querySelectorAll('.select-opt').forEach((b) => b.classList.toggle('is-hi', Number(b.dataset.i) === idx)); const e = list.querySelector('.select-opt.is-hi'); if (e) e.scrollIntoView({ block: 'nearest' }); }
      function pick(x) { val = x.value; draw(); api.close(); btn.focus(); if (o.onChange) o.onChange(val); btn.emitChange(); }
      const body = h('div.select-pop', search, list);
      body.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); hi(); } if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); hi(); } if (e.key === 'Enter') { e.preventDefault(); if (shown[idx]) pick(shown[idx]); } });
      idx = Math.max(0, opts.findIndex((x) => x.value === val)); render();
      btn.setAttribute('aria-expanded', 'true');
      api = ui.popover(btn, body, { matchWidth: true, align: 'start', role: 'listbox', title: o.title || o.aria || 'Selecionar', onClose: () => btn.setAttribute('aria-expanded', 'false') });
      setTimeout(() => { const f = search ? search.querySelector('input') : list; f.focus(); hi(); }, 30);
    }
    draw(); ctl(btn, () => val, (v) => { val = v; draw(); }); btn.setOptions = (n) => { opts.length = 0; n.forEach((x) => opts.push(x)); draw(); };
    return btn;
  };

  /** Seletor de data (calendário próprio). value: timestamp (meia-noite BRT) */
  ui.date = function (o = {}) {
    let val = o.value || null; const cal = C.cal;
    const txt = h('span.select-text'); const btn = h('button', { type: 'button', class: ['select', o.size && 'input-' + o.size], 'aria-haspopup': 'dialog', 'aria-label': o.aria || 'Escolher data', onclick: open }, icon('calendar', 16), txt, o.clearable && val ? null : null);
    const draw = () => { txt.textContent = val ? fmt.date(val) : (o.placeholder || 'dd/mm/aaaa'); txt.classList.toggle('is-ph', !val); };
    function open() {
      const ref = val || C.clock.now(); let { y, m } = cal.sp(ref); let api;
      const grid = h('div.cal-grid'); const title = h('div.cal-title');
      const body = h('div.cal', h('div.cal-head', ui.iconBtn('chevron-left', { label: 'Mês anterior', size: 'sm', onclick: () => { m--; if (m < 1) { m = 12; y--; } render(); } }), title, ui.iconBtn('chevron-right', { label: 'Próximo mês', size: 'sm', onclick: () => { m++; if (m > 12) { m = 1; y++; } render(); } })), h('div.cal-week', ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => h('span', d))), grid,
        h('div.cal-foot', ui.btn('Hoje', { variant: 'ghost', size: 'sm', onclick: () => pick(cal.startOfDay(C.clock.now())) }), o.clearable && ui.btn('Limpar', { variant: 'ghost', size: 'sm', onclick: () => pick(null) })));
      function render() {
        title.textContent = `${cal.MES_LONGO[m - 1]} de ${y}`; C.clear(grid);
        const first = cal.spTs(y, m, 1); const wd = cal.sp(first).wd; const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        for (let i = 0; i < wd; i++) grid.append(h('span'));
        for (let d = 1; d <= dim; d++) { const ts = cal.spTs(y, m, d); const dis = (o.min && ts < o.min) || (o.max && ts > o.max) || (o.onlyUtil && !cal.isUtil(ts)); const sel = val && cal.startOfDay(val) === ts; const today = cal.startOfDay(C.clock.now()) === ts;
          grid.append(h('button', { type: 'button', class: ['cal-day', sel && 'is-sel', today && 'is-today', !cal.isUtil(ts) && 'is-off'], disabled: dis, 'aria-label': fmt.dateLong(ts), 'aria-pressed': String(!!sel), onclick: () => pick(ts) }, d)); }
      }
      function pick(ts) { val = ts; draw(); api.close(); btn.focus(); if (o.onChange) o.onChange(val); btn.emitChange(); }
      render(); api = ui.popover(btn, body, { align: 'start', title: 'Escolher data' });
    }
    draw(); ctl(btn, () => val, (v) => { val = v; draw(); }); return btn;
  };

  /** Dropzone desenhada; aceita arquivos por clique/arrastar. onFiles(File[]) */
  ui.dropzone = function (o = {}) {
    const input = h('input', { type: 'file', multiple: !!o.multiple, accept: o.accept, tabindex: '-1', 'aria-hidden': 'true', style: 'display:none', onchange: () => { if (input.files.length) o.onFiles && o.onFiles([...input.files]); input.value = ''; } });
    const el = h('div', { class: ['dropzone', o.class], tabindex: 0, role: 'button', 'aria-label': o.label || 'Selecionar arquivos', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      ondragover: (e) => { e.preventDefault(); el.classList.add('is-over'); }, ondragleave: () => el.classList.remove('is-over'), ondrop: (e) => { e.preventDefault(); el.classList.remove('is-over'); if (e.dataTransfer.files.length) o.onFiles && o.onFiles([...e.dataTransfer.files]); } },
      h('div.dz-ic', icon(o.icon || 'upload', 24)), h('div.dz-t', o.title || 'Arraste arquivos aqui ou clique para selecionar'), o.hint && h('div.dz-h', o.hint), input);
    return el;
  };

  /* --------------------------- modal / drawer / sheet -------------------- */
  const focusables = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  let modalDepth = 0;
  function layer(kind, o) {
    const prev = document.activeElement; modalDepth++;
    const id = nid('m');
    const close = (val) => { if (api.closed) return; api.closed = true; modalDepth--; document.removeEventListener('keydown', onKey, true); root.classList.add('out'); setTimeout(() => { root.remove(); if (!modalDepth) document.documentElement.classList.remove('lock'); }, 180); if (prev && prev.focus) try { prev.focus(); } catch (e) { /* */ } if (o.onClose) o.onClose(val); resolve(val); };
    let resolve; const promise = new Promise((r) => (resolve = r));
    const api = { close, promise, closed: false };
    const bodyEl = h('div.layer-body', typeof o.body === 'function' ? o.body(api) : o.body);
    const foot = o.footer ? h('footer.layer-foot', typeof o.footer === 'function' ? o.footer(api) : o.footer) : null;
    const panel = h('div', { class: ['layer-panel', 'layer-' + kind, o.size && 'size-' + o.size, o.compact && 'compact', o.class], role: o.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: '-1' },
      kind === 'sheet' && h('i.sheet-grip'),
      (o.title || o.dismissable !== false) && h('header.layer-head', h('div.layer-titles', o.icon && h('span.layer-ic', { class: o.tone && 'tone-' + o.tone }, icon(o.icon, 20)), h('div', h('h2.layer-title', { id }, o.title || ''), o.subtitle && h('p.layer-sub', o.subtitle))), o.headerRight, o.dismissable !== false && ui.iconBtn('x', { label: 'Fechar', onclick: () => close(undefined) })),
      bodyEl, foot);
    const root = h('div', { class: ['layer', 'layer-k-' + kind], ref: (el) => { el.__api = api; } }, h('div.layer-scrim', { onclick: () => o.dismissable !== false && !o.staticBackdrop && close(undefined) }), panel);
    overlayRoot().appendChild(root); document.documentElement.classList.add('lock'); closeAllPops();
    function onKey(e) {
      if (e.key === 'Escape' && o.dismissable !== false) { e.stopPropagation(); close(undefined); return; }
      if (e.key === 'Tab') { const f = [...panel.querySelectorAll(focusables)].filter((x) => x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }
    document.addEventListener('keydown', onKey, true);
    tick(() => { root.classList.add('in'); const af = panel.querySelector('[autofocus],.layer-body input,.layer-body textarea') || panel.querySelector('.layer-foot .btn-primary,.layer-foot .btn-danger') || panel; setTimeout(() => af.focus && af.focus({ preventScroll: true }), 60); });
    api.el = panel; api.root = root; api.body = bodyEl; return api;
  }
  /** size: sm | md | lg | xl. footer: Node|Array|fn(api). body: Node|fn(api) */
  ui.modal = (o) => layer(C.isMobile() && o.mobileSheet !== false ? 'sheet' : 'modal', o);
  ui.drawer = (o) => layer(C.isMobile() ? 'sheet' : 'drawer', o);
  ui.sheet = (o) => layer('sheet', o);
  /** Fecha todas as camadas abertas (usado na troca de rota) */
  ui.closeAll = function () { closeAllPops(); document.querySelectorAll('#overlay-root .layer').forEach((l) => { if (l.__api && !l.__api.closed) l.__api.close(undefined); }); };
  /** Confirmação própria. Retorna Promise<boolean> */
  ui.confirm = function (o) {
    const tone = o.tone || 'primary';
    const m = ui.modal({ title: o.title, icon: o.icon || (tone === 'danger' ? 'triangle-alert' : 'circle-question-mark'), tone: tone === 'danger' ? 'red' : 'blue', size: 'sm', alert: true, body: h('div.confirm-body', o.text && h('p', o.text), o.children), footer: (api) => [ui.btn(o.cancelLabel || 'Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn(o.confirmLabel || 'Confirmar', { variant: tone === 'danger' ? 'danger' : 'primary', onclick: () => api.close(true) })] });
    return m.promise.then((v) => !!v);
  };

  /* -------------------------------- toast -------------------------------- */
  ui.toast = function (title, o = {}) {
    let host = document.getElementById('toast-host'); if (!host) return;
    const type = o.type || 'info'; const ic = { info: 'info', success: 'circle-check', warn: 'triangle-alert', error: 'circle-alert' }[type];
    const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
    const t = h('div', { class: ['toast', 'toast-' + type], role: type === 'error' ? 'alert' : 'status' }, h('span.toast-ic', icon(ic, 18)), h('div.toast-body', h('strong', title), o.text && h('span', o.text)), o.link ? ui.btn('Ver', { variant: 'ghost', size: 'sm', onclick: () => { C.router.go(o.link); kill(); } }) : null, ui.iconBtn('x', { label: 'Dispensar', size: 'sm', onclick: kill }), h('i.toast-timer', { style: { animationDuration: (o.ms || 5200) + 'ms' } }));
    host.appendChild(t); tick(() => t.classList.add('in'));
    const timer = setTimeout(kill, o.ms || 5200); t.addEventListener('pointerenter', () => { clearTimeout(timer); t.querySelector('.toast-timer').style.animationPlayState = 'paused'; });
    while (host.children.length > 4) host.firstChild.remove();
    return { close: kill };
  };

  /* ------------------------------ tooltip -------------------------------- */
  ui.tip = function (el, text) {
    let tip; const show = () => { if (tip || C.isMobile()) return; tip = h('div.tip', { role: 'tooltip' }, text); overlayRoot().appendChild(tip); const r = el.getBoundingClientRect(); tip.style.left = Math.min(Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2), innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (r.top - tip.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - tip.offsetHeight - 8) + 'px'; tick(() => tip && tip.classList.add('in')); };
    const hide = () => { if (tip) { tip.remove(); tip = null; } };
    el.addEventListener('pointerenter', show); el.addEventListener('pointerleave', hide); el.addEventListener('focus', show); el.addEventListener('blur', hide); el.addEventListener('pointerdown', hide);
    if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', text);
    return el;
  };

  /* ------------------------ live / timers / countdown -------------------- */
  /** Container que se re-renderiza quando as coleções mudam. fn() => Node|Array */
  ui.live = function (topics, fn, o = {}) {
    const el = h(o.tag || 'div', { class: ['live', o.class] }); let off, raf, mounted = false;
    const draw = () => { const st = el.scrollTop; const kids = fn(); C.mount(el, kids); if (st) el.scrollTop = st; };
    const on = () => { if (!el.isConnected) { if (mounted) off && off(); return; } mounted = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (el.isConnected) draw(); }); };
    off = C.store.on(topics, on); draw(); return el;
  };
  const tickers = new Set();
  setInterval(() => { tickers.forEach((t) => { if (!t.el.isConnected) { if (t.seen) tickers.delete(t); return; } t.seen = true; try { t.fn(); } catch (e) { /* */ } }); }, 1000);
  ui.every = (el, fn) => { const t = { el, fn, seen: false }; tickers.add(t); return t; };
  /** contagem regressiva até ts (hora de simulação). o.prefix, o.endLabel, o.tone */
  ui.countdown = function (ts, o = {}) {
    const el = h('span', { class: ['countdown', o.class] }, icon(o.icon || 'timer', 14), h('span.cd-t'));
    const txt = el.querySelector('.cd-t');
    const draw = () => { const ms = ts - C.clock.now(); txt.textContent = ms <= 0 ? (o.endLabel || 'encerrado') : (o.prefix ? o.prefix + ' ' : '') + (ms > 86400000 ? fmt.dur(ms) : fmt.clock(ms)); el.classList.toggle('is-end', ms <= 0); el.classList.toggle('is-warn', ms > 0 && ms < (o.warnMs || 600000)); };
    draw(); ui.every(el, draw); C.clock.onJump(draw); return el;
  };
  /** valores com animação de contagem [data-count] dentro de root */
  ui.countUp = function (root) {
    if (C.prefersReduced()) return;
    root.querySelectorAll('[data-count]').forEach((el) => {
      const to = parseFloat(el.dataset.count); const kind = el.dataset.fmt; const f = kind === 'brl' ? (v) => fmt.brl(v, { round: to > 1000 }) : kind === 'brlc' ? (v) => fmt.brlCompact(v) : kind === 'pct' ? (v) => fmt.pct(v) : (v) => fmt.num(Math.round(v));
      const t0 = performance.now(), dur = 700; const step = (t) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 4); el.textContent = f(to * e); if (p < 1) requestAnimationFrame(step); else el.textContent = f(to); }; requestAnimationFrame(step);
    });
  };

  /* -------------------------- stepper / timeline ------------------------- */
  ui.stepper = (steps, current) => h('ol.stepper', steps.map((s, i) => h('li', { class: [i < current && 'done', i === current && 'cur'], 'aria-current': i === current ? 'step' : null }, h('span.step-dot', i < current ? icon('check', 13) : i + 1), h('span.step-lab', s))));
  /** items [{icon, title, text, ts, tone, actor, tag}] */
  ui.timeline = (items) => h('ol.timeline', items.map((it) => h('li', { class: 'tl-item', dataset: { tone: it.tone || 'neutral' } }, h('span.tl-dot', icon(it.icon || 'circle', 12)), h('div.tl-body', h('div.tl-title', it.title, it.tag), it.text && h('div.tl-text', it.text), h('div.tl-meta', it.actor, it.actor && it.ts ? ' · ' : '', it.ts ? h('time', { title: fmt.datetime(it.ts) }, fmt.datetime(it.ts)) : null)))));
  ui.pager = function (page, pages, onChange) {
    if (pages <= 1) return h('span');
    return h('nav.pager', { 'aria-label': 'Paginação' }, ui.iconBtn('chevron-left', { label: 'Anterior', size: 'sm', disabled: page <= 1, onclick: () => onChange(page - 1) }), h('span.pager-t', `${page} de ${pages}`), ui.iconBtn('chevron-right', { label: 'Próxima', size: 'sm', disabled: page >= pages, onclick: () => onChange(page + 1) }));
  };
  ui.search = (o = {}) => ui.input({ icon: 'search', type: 'search', placeholder: o.placeholder || 'Buscar', onInput: o.onInput, clearable: true, class: ['search', o.class], aria: o.placeholder || 'Buscar', value: o.value });

  /* ------------------------------- tabela -------------------------------- */
  /**
   * columns: [{key, label, render(row)=>Node|string, align:'right'|'center', sort:(a,b)=>n | true, width, mobile:'primary'|'secondary'|'hide'|'show', class}]
   * o: {rows, rowKey, onRowClick, selectable, selected:Set, onSelect(set), pageSize, empty:Node, dense, sortKey, sortDir, footer(rows), caption}
   * Em telas estreitas as linhas viram cartões (rótulo via data-label).
   */
  ui.table = function (o) {
    let sortKey = o.sortKey || null, sortDir = o.sortDir || 'desc', page = 1; const ps = o.pageSize || 0;
    const sel = o.selected || new Set(); const root = h('div', { class: ['tbl-wrap', o.dense && 'dense', o.class] });
    const rowKey = o.rowKey || ((r) => r.id);
    function sorted() {
      let rows = o.rows.slice();
      if (sortKey) { const col = o.columns.find((c) => c.key === sortKey); const cmp = col && typeof col.sort === 'function' ? col.sort : (a, b) => { const x = a[sortKey], y = b[sortKey]; return x > y ? 1 : x < y ? -1 : 0; }; rows.sort((a, b) => (sortDir === 'asc' ? 1 : -1) * cmp(a, b)); }
      return rows;
    }
    function draw() {
      const all = sorted(); const pages = ps ? Math.max(1, Math.ceil(all.length / ps)) : 1; page = Math.min(page, pages); const rows = ps ? all.slice((page - 1) * ps, page * ps) : all;
      C.clear(root);
      if (!all.length) { root.append(o.empty || ui.empty({ title: 'Nenhum registro', text: 'Ajuste os filtros para ver resultados.' })); return; }
      const allSel = rows.length && rows.every((r) => sel.has(rowKey(r)));
      const head = h('tr', o.selectable && h('th.td-sel', ui.checkbox({ checked: allSel, aria: 'Selecionar todos', onChange: (v) => { rows.forEach((r) => (v ? sel.add(rowKey(r)) : sel.delete(rowKey(r)))); o.onSelect && o.onSelect(sel); draw(); } })),
        o.columns.map((c) => h('th', { class: [c.align && 'ta-' + c.align, c.sort && 'sortable', c.class, c.mobile === 'hide' && 'm-hide'], style: c.width ? { width: c.width } : null, 'aria-sort': sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : null },
          c.sort ? h('button', { type: 'button', class: 'th-btn', onclick: () => { if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = c.key; sortDir = 'desc'; } draw(); } }, c.label, h('span.th-arrow', icon(sortKey === c.key ? (sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down', 12))) : c.label)));
      const body = rows.map((r) => {
        const k = rowKey(r);
        const tr = h('tr', { class: [o.onRowClick && 'clickable', sel.has(k) && 'is-sel', o.rowClass && o.rowClass(r)], tabindex: o.onRowClick ? 0 : null, onclick: (e) => { if (e.target.closest('button,a,.check,.checkrow,input')) return; o.onRowClick && o.onRowClick(r); }, onkeydown: (e) => { if (o.onRowClick && e.key === 'Enter' && e.target === tr) o.onRowClick(r); } },
          o.selectable && h('td.td-sel', ui.checkbox({ checked: sel.has(k), aria: 'Selecionar linha', onChange: (v) => { v ? sel.add(k) : sel.delete(k); o.onSelect && o.onSelect(sel); tr.classList.toggle('is-sel', v); } })),
          o.columns.map((c) => h('td', { class: [c.align && 'ta-' + c.align, c.class, c.mobile && 'm-' + c.mobile], dataset: { label: c.label } }, c.render ? c.render(r) : r[c.key])));
        return tr;
      });
      const foot = o.footer ? h('tfoot', h('tr', o.footer(all))) : null;
      root.append(h('div.tbl-scroll', h('table', { class: 'tbl' }, o.caption && h('caption.sr', o.caption), h('thead', head), h('tbody', body), foot)));
      if (ps && pages > 1) root.append(h('div.tbl-foot', h('span.tbl-count', `${(page - 1) * ps + 1}–${Math.min(page * ps, all.length)} de ${all.length}`), ui.pager(page, pages, (p) => { page = p; draw(); root.scrollIntoView({ block: 'nearest' }); })));
      else root.append(h('div.tbl-foot', h('span.tbl-count', fmt.plural(all.length, 'registro', 'registros'))));
    }
    root.setRows = (rows) => { o.rows = rows; draw(); };
    root.selected = sel; draw(); return root;
  };

  /** Barra de filtros: aplica ao array de linhas e devolve re-render. Ver telas para uso. */
  ui.toolbar = (...kids) => h('div.toolbar', kids);
  ui.pageHeader = function (o) {
    return h('header.page-head', h('div.page-head-main', o.back && ui.btn('Voltar', { variant: 'ghost', size: 'sm', icon: 'arrow-left', onclick: () => (typeof o.back === 'string' ? C.router.go(o.back) : history.back()) }), o.eyebrow && h('div.eyebrow', o.eyebrow), h('h1.page-title', o.title), o.subtitle && h('p.page-sub', o.subtitle)), o.actions ? h('div.page-actions', o.actions) : null);
  };
  ui.grid = (cols, ...kids) => h('div', { class: ['grid', 'g' + cols] }, kids);
  ui.stack = (...kids) => h('div.stack', kids);
  ui.row = (...kids) => h('div.row', kids);
})();
