/* =========================================================================
   Cedy, gráficos em SVG próprio (sem biblioteca). Responsivos por viewBox,
   com tooltip por hover/toque e tabela alternativa via aria-label.
   Cores por token: --blue, --teal, --green, --amber, --violet, --red.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, fmt } = C; const ui = C.ui;
  const TONES = { blue: 'var(--blue)', teal: 'var(--teal)', green: 'var(--green)', amber: 'var(--amber)', violet: 'var(--violet)', red: 'var(--red)', navy: 'var(--ink-2)', neutral: 'var(--ink-4)' };
  const tone = (t) => TONES[t] || t || TONES.blue;
  const nice = (max) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  let tipEl;
  function tip(html, x, y) { if (!tipEl) { tipEl = h('div.chart-tip', { role: 'tooltip' }); document.getElementById('overlay-root').appendChild(tipEl); } tipEl.innerHTML = html; tipEl.style.display = 'block'; const w = tipEl.offsetWidth; tipEl.style.left = Math.min(innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px'; tipEl.style.top = Math.max(8, y - tipEl.offsetHeight - 12) + 'px'; }
  const untip = () => { if (tipEl) tipEl.style.display = 'none'; };

  const chart = (ui.chart = {});

  /** sparkline: data = [n,...] */
  chart.spark = function (data, o = {}) {
    const w = 96, hh = 28, max = Math.max(...data), min = Math.min(...data); const rg = max - min || 1;
    const pts = data.map((v, i) => [(i / (data.length - 1)) * (w - 4) + 2, hh - 3 - ((v - min) / rg) * (hh - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return h('svg', { viewBox: `0 0 ${w} ${hh}`, class: 'spark', role: 'img', 'aria-label': 'Tendência: ' + data.join(', ') }, h('path', { d: d + ` L${w - 2} ${hh} L2 ${hh} Z`, fill: tone(o.tone), opacity: '0.12' }), h('path', { d, fill: 'none', stroke: tone(o.tone), 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), h('circle', { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: 2.5, fill: tone(o.tone) }));
  };

  /** Re-desenha o SVG na largura real do contêiner (fonte sempre legível em px). build(w) => svg */
  function responsive(build, legend, initialW = 560) {
    const box = h('figure.chartbox'); let cur = 0;
    const draw = (w) => { w = Math.max(240, Math.round(w)); if (Math.abs(w - cur) < 6) return; cur = w; const old = box.querySelector('svg'); const svg = build(w); if (old) old.replaceWith(svg); else box.prepend(svg); };
    box.append(legend || '');
    draw(initialW);
    if (window.ResizeObserver) { const ro = new ResizeObserver((es) => { const w = es[0].contentRect.width; if (w > 0) requestAnimationFrame(() => draw(w)); }); ro.observe(box); }
    return box;
  }
  const niceMin = (min, max) => (min > 0.55 * max ? Math.max(0, Math.floor((min - (max - min) * 0.6) * 10) / 10) : 0);

  /**
   * Linhas/área. o: {series:[{name, tone, data:[{x:label,y:number}]}], height, format, area, yTicks, tipFormat}
   * Todas as séries com o mesmo número de pontos. O eixo Y começa em zero, exceto quando a faixa é estreita.
   */
  chart.line = function (o) {
    const legend = o.series.length > 1 ? h('div.legend', o.series.map((s) => h('span', h('i', { style: { background: tone(s.tone) } }), s.name))) : null;
    return responsive((W) => {
      const H = o.height || 240, pr = 12, pt = 12, pb = 26; let pl = 48; const f = o.format || ((v) => fmt.compact(v));
      const n = o.series[0].data.length; const all = o.series.flatMap((s) => s.data.map((d) => d.y)); const maxData = Math.max(...all, 1); const minY = o.zero === false ? niceMin(Math.min(...all), maxData) : 0;
      const maxY = minY + nice(maxData - minY); const ticks = o.yTicks || 4; pl = axisPad(f, minY, maxY);
      const X = (i) => pl + (n === 1 ? 0 : (i / (n - 1))) * (W - pl - pr); const Y = (v) => pt + (1 - (v - minY) / (maxY - minY)) * (H - pt - pb);
      const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart chart-line', role: 'img', 'aria-label': o.aria || 'Gráfico de linhas: ' + o.series.map((s) => `${s.name} de ${f(s.data[0].y)} a ${f(s.data[n - 1].y)}`).join('; ') });
      for (let i = 0; i <= ticks; i++) { const v = minY + ((maxY - minY) / ticks) * i; svg.append(h('line', { x1: pl, x2: W - pr, y1: Y(v), y2: Y(v), class: 'grid-l' }), h('text', { x: pl - 8, y: Y(v) + 4, class: 'axis', 'text-anchor': 'end' }, f(v))); }
      const step = Math.ceil(n / Math.max(2, Math.floor((W - pl) / 56))); o.series[0].data.forEach((d, i) => { if ((i % step === 0 && (n - 1 - i) >= Math.ceil(step * 0.7)) || i === n - 1 || (i === 0)) svg.append(h('text', { x: X(i), y: H - 8, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, d.x)); });
      o.series.forEach((s, si) => {
        const pts = s.data.map((d, i) => [X(i), Y(d.y)]); const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        if (o.area !== false && si === 0) svg.append(h('path', { d: d + ` L${X(n - 1)} ${Y(minY)} L${X(0)} ${Y(minY)} Z`, fill: tone(s.tone), opacity: '0.10' }));
        svg.append(h('path', { d, fill: 'none', stroke: tone(s.tone), 'stroke-width': 2.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'draw', pathLength: '1' }));
      });
      const hover = h('line', { class: 'hover-l', y1: pt, y2: H - pb, opacity: 0 }); const dots = o.series.map((s) => h('circle', { r: 4, fill: 'var(--surface)', stroke: tone(s.tone), 'stroke-width': 2, opacity: 0 }));
      svg.append(hover, ...dots);
      const hit = h('rect', { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb, fill: 'transparent' }); svg.append(hit);
      const move = (e) => { const r = svg.getBoundingClientRect(); const cx = (e.touches ? e.touches[0].clientX : e.clientX); const px = cx - r.left; const i = Math.max(0, Math.min(n - 1, Math.round(((px - pl) / (W - pl - pr)) * (n - 1)))); hover.setAttribute('x1', X(i)); hover.setAttribute('x2', X(i)); hover.setAttribute('opacity', 1); dots.forEach((dd, k) => { dd.setAttribute('cx', X(i)); dd.setAttribute('cy', Y(o.series[k].data[i].y)); dd.setAttribute('opacity', 1); });
        tip(`<b>${o.series[0].data[i].x}</b>` + o.series.map((s) => `<div><i style="background:${tone(s.tone)}"></i>${s.name}: <b>${(o.tipFormat || f)(s.data[i].y)}</b></div>`).join(''), r.left + X(i), r.top + Y(o.series[0].data[i].y)); };
      const leave = () => { hover.setAttribute('opacity', 0); dots.forEach((dd) => dd.setAttribute('opacity', 0)); untip(); };
      hit.addEventListener('pointermove', move); hit.addEventListener('pointerleave', leave); hit.addEventListener('touchstart', move, { passive: true });
      return svg;
    }, legend);
  };

  /** margem esquerda que comporta os rótulos do eixo Y (mínimo 48px) */
  const axisPad = (f, lo, hi) => Math.max(48, Math.ceil([0, 0.25, 0.5, 0.75, 1].reduce((m, k) => Math.max(m, String(f(lo + (hi - lo) * k)).length), 0) * 6.4) + 14);
  /**
   * Barras verticais agrupadas/empilhadas. o: {categories:[...], series:[{name,tone,data:[n]}], stacked, height, format, tipFormat}
   */
  chart.bars = function (o) {
    const legend = o.series.length > 1 ? h('div.legend', o.series.map((s) => h('span', h('i', { style: { background: tone(s.tone) } }), s.name))) : null;
    return responsive((W) => {
      const H = o.height || 240, pr = 8, pt = 12, pb = 26; let pl = 48; const f = o.format || ((v) => fmt.compact(v)); const n = o.categories.length;
      const tot = (i) => o.stacked ? C.sum(o.series, (s) => s.data[i]) : Math.max(...o.series.map((s) => s.data[i]));
      const maxY = nice(Math.max(...o.categories.map((_, i) => tot(i)), 1)); const Y = (v) => pt + (1 - v / maxY) * (H - pt - pb); pl = axisPad(f, 0, maxY);
      const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart chart-bars', role: 'img', 'aria-label': o.aria || 'Gráfico de barras: ' + o.categories.map((c, i) => `${c} ${f(tot(i))}`).join(', ') });
      for (let i = 0; i <= 4; i++) { const v = (maxY / 4) * i; svg.append(h('line', { x1: pl, x2: W - pr, y1: Y(v), y2: Y(v), class: 'grid-l' }), h('text', { x: pl - 8, y: Y(v) + 4, class: 'axis', 'text-anchor': 'end' }, f(v))); }
      const bw = (W - pl - pr) / n; const gw = Math.min(46, bw * 0.62); const skip = Math.ceil(n / Math.max(2, Math.floor((W - pl) / 44)));
      o.categories.forEach((c, i) => {
        const cx = pl + bw * i + bw / 2; if (i % skip === 0) svg.append(h('text', { x: cx, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, c));
        let acc = 0; const k = o.series.length; const sw = o.stacked ? gw : gw / k;
        o.series.forEach((s, si) => { const v = s.data[i]; const x = o.stacked ? cx - gw / 2 : cx - gw / 2 + sw * si; const y0 = o.stacked ? Y(acc + v) : Y(v); const hh = o.stacked ? Y(acc) - Y(acc + v) : Y(0) - Y(v); acc += v;
          const r = h('rect', { x, y: y0, width: Math.max(2, sw - (o.stacked ? 0 : 2)), height: Math.max(0, hh), rx: 3, fill: tone(s.tone), class: 'bar', style: { '--d': i * 40 + 'ms' } });
          r.addEventListener('pointermove', (e) => tip(`<b>${c}</b><div><i style="background:${tone(s.tone)}"></i>${s.name}: <b>${(o.tipFormat || f)(v)}</b></div>`, e.clientX, e.clientY)); r.addEventListener('pointerleave', untip); svg.append(r); });
      });
      return svg;
    }, legend);
  };

  /** Barras horizontais ranqueadas. items: [{label, value, tone, hint}] */
  chart.hbars = function (items, o = {}) {
    const max = Math.max(...items.map((i) => i.value), 1); const f = o.format || ((v) => fmt.compact(v));
    return h('ul.hbars', { role: 'list' }, items.map((it, i) => h('li', h('div.hb-top', h('span.hb-lab', it.label), h('span.hb-val', f(it.value))), h('div.hb-track', h('i', { style: { width: (it.value / max) * 100 + '%', background: tone(it.tone), '--d': i * 50 + 'ms' } })), it.hint && h('small', it.hint))));
  };

  /** Rosca. items: [{label, value, tone}] ; centro: {label, value} */
  chart.donut = function (items, o = {}) {
    const total = C.sum(items, (i) => i.value) || 1; const R = 52, r = 36, cx = 60, cy = 60; let a0 = -Math.PI / 2;
    const svg = h('svg', { viewBox: '0 0 120 120', class: 'chart chart-donut', role: 'img', 'aria-label': o.aria || 'Distribuição: ' + items.map((i) => `${i.label} ${fmt.pct((i.value / total) * 100, 0)}`).join(', ') });
    items.forEach((it, i) => { const a1 = a0 + (it.value / total) * Math.PI * 2 - (items.length > 1 ? 0.03 : 0); const big = a1 - a0 > Math.PI ? 1 : 0; const p = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
      const path = h('path', { d: items.length === 1 ? `M${cx} ${cy - R} A${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L${cx - 0.01} ${cy - r} A${r} ${r} 0 1 0 ${cx} ${cy - r} Z` : `M${x0} ${y0} A${R} ${R} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${big} 0 ${x3} ${y3} Z`, fill: tone(it.tone), class: 'seg', style: { '--d': i * 60 + 'ms' } });
      path.addEventListener('pointermove', (e) => tip(`<b>${it.label}</b><div>${(o.format || fmt.compact)(it.value)} · ${fmt.pct((it.value / total) * 100, 1)}</div>`, e.clientX, e.clientY)); path.addEventListener('pointerleave', untip); svg.append(path); a0 += (it.value / total) * Math.PI * 2; });
    if (o.center) svg.append(h('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'donut-v' }, o.center.value), h('text', { x: cx, y: cy + 12, 'text-anchor': 'middle', class: 'donut-l' }, o.center.label));
    return h('figure.donutbox', svg, h('ul.legend.legend-col', items.map((it) => h('li', h('i', { style: { background: tone(it.tone) } }), h('span', it.label), h('b', fmt.pct((it.value / total) * 100, 0))))));
  };
})();
