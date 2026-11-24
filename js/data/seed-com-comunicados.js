/* =========================================================================
   Cedy protótipo 0.3, Central de comunicação, seed de comunicados (S5).
   Roda no fim de seedCom via C.seedComExtras, com o relógio já em
   C.clock.start (seg 23/11/2026 10:12 BRT). Usa os motores
   (E.com.comunicado) e restaura o relógio no fim.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  (C.seedComExtras = C.seedComExtras || []).push(function () {
    const clock = C.clock;
    const MC = C.engine.com.comunicado;
    const start = C.clock.start;
    const at = (m, d, h, mi) => C.cal.spTs(2026, m, d, h, mi || 0);

    /* 1. Informativo publicado para todas as empresas clientes ativas. */
    clock.set(at(11, 20, 9, 30));
    const inf = MC.criar({
      userId: 'u-ops-1', tipo: 'informativo',
      titulo: 'Manutenção programada do módulo de relatórios',
      corpo: 'No domingo, dia 29/11, entre 2h e 6h, o módulo de relatórios fica indisponível para manutenção. As demais áreas seguem funcionando. Se algum relatório agendado atrasar, ele aparece na segunda pela manhã.',
      segmento: {}, faixa: false,
    });
    if (!inf.ok) throw new Error('seed-com-comunicados: ' + inf.erro);
    const pub = MC.publicar(inf.comunicado.id, 'u-ops-1');
    if (!pub.ok) throw new Error('seed-com-comunicados: ' + pub.erro);

    /* Ciência registrada por 6 empresas com usuário admin. */
    const ciencias = [
      ['c-aurora', 'u-aurora-1', at(11, 20, 11, 5)],
      ['c-tecnoparts', 'u-tecno-1', at(11, 20, 12, 40)],
      ['c-sertao', 'u-sertao-1', at(11, 20, 15, 10)],
      ['f-vertice', 'u-vertice-1', at(11, 21, 9, 20)],
      ['f-nordeste', 'u-nordeste-1', at(11, 21, 10, 45)],
      ['o-lumen', 'u-lumen-1', at(11, 21, 14, 5)],
    ];
    ciencias.forEach(([, userId, ts]) => {
      clock.set(ts);
      const r = MC.darCiencia(inf.comunicado.id, userId);
      if (!r.ok && !r.existente) throw new Error('seed-com-comunicados: ' + r.erro);
    });

    /* 2. Contratual aguardando aprovação do Superadmin. */
    clock.set(at(11, 23, 9, 30));
    const cont = MC.criar({
      userId: 'u-ops-1', tipo: 'contratual',
      titulo: 'Atualização do aviso de tarifas de acesso à Vitrine',
      corpo: 'A partir de 07/12 passam a valer as novas tarifas de acesso à Vitrine, publicadas no aviso anexo ao contrato. Nada muda para operações já contratadas. Em caso de dúvida, fale com a Mesa pelo chamado.',
      segmento: {}, vigenciaEm: at(12, 7, 0, 0), faixa: true,
    });
    if (!cont.ok) throw new Error('seed-com-comunicados: ' + cont.erro);
    const env = MC.enviarParaAprovacao(cont.comunicado.id, 'u-ops-1', 'As tarifas da Vitrine mudam em dezembro e as empresas precisam de 15 dias para se ajustar antes da vigência.');
    if (!env.ok) throw new Error('seed-com-comunicados: ' + env.erro);

    clock.set(start);
  });
})();
