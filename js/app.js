/* Cedy protótipo 0.1, inicialização */
(function () {
  const C = window.Cedy;
  function boot() {
    const t0 = performance.now();
    if (/[?&]reset\b/.test(location.search)) { localStorage.removeItem('cedy-proto-0.1'); history.replaceState(null, '', location.pathname + location.hash); }
    else {
      // dados salvos de uma versão anterior são recriados: deixa a marca para o aviso na tela de entrada
      try { const raw = localStorage.getItem('cedy-proto-0.1'); if (raw) { const s = JSON.parse(raw); if (s && s.v !== C.store.VERSION) localStorage.setItem('cedy-proto-notice', String(s.v)); } } catch (e) { /* ignora */ }
    }
    try {
      C.store.init(C.seed.build);
    } catch (e) {
      console.error('Falha ao carregar dados salvos; reconstruindo', e);
      localStorage.removeItem('cedy-proto-0.1'); C.store.init(C.seed.build);
    }
    C.shell.applyTheme();
    C.store.on(['session'], () => { if (!C.store.session.get() && location.hash !== '#/entrar') C.router.go('/entrar'); });
    setInterval(() => C.engine.tick(), 4000);
    setInterval(() => C.engine.mercadoTick(), 9000);
    C.clock.onJump(() => C.engine.tick());
    C.router.start();
    console.info(`[cedy] pronto em ${Math.round(performance.now() - t0)} ms; ${C.store.db.all('operacoes').length} operações, ${C.store.ledger.all().length} eventos na trilha`);
    const b = document.getElementById('boot'); b.classList.add('done'); setTimeout(() => b.remove(), 450);
  }
  window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 30));
  window.addEventListener('error', (e) => console.error('[cedy] erro', e.message));
})();
