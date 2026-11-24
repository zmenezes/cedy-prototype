/* Cedy: dados de exemplo do agente de calibração: um pedido recusado em 11/11 (volta só com dado novo)
   e o ciclo semanal de segunda 23/11 às 8h, que abriu os pedidos elegíveis. Roda ao fim de seedCom
   e restaura o relógio. */
(function () {
  const C = window.Cedy;
  (C.seedComExtras = C.seedComExtras || []).push(function () {
    const E = C.engine; const CAL = E.ia.cal; const clock = C.clock; const NOW = clock.start;
    const quando = (m, d, h) => clock.set(C.cal.spTs(2026, m, d, h, 0));
    quando(11, 11, 9);
    const a = CAL.analisar().find((x) => x.id === 'merc.slaValidacaoH');
    if (a && a.estado === 'recomendar') { const r = CAL._abrirPedido(a); if (r.ok) E.decidirAprovacao(r.aprovacao.id, 'rejeitar', 'u-super-1', 'Manter 6 h até fechar o mês: há lotes grandes no fim da competência.'); }
    quando(11, 23, 8);
    CAL.executarCiclo();
    clock.set(NOW);
  });
})();
