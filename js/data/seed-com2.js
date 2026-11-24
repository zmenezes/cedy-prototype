/* =========================================================================
   Cedy protótipo 0.3, Central de comunicação, dados de exemplo da onda 2:
   esclarecimentos no leilão, conversa pós-aceite com alerta de contato e
   denúncia, bloqueio ativo, leitura da Cedy com motivo e (em com-ia) o
   agente de atendimento com o histórico de respostas. Roda ao fim de
   seedCom, com o relógio em C.clock.start (seg 23/11/2026 10:12 BRT), e o
   restaura no fim. Tudo passa pelo motor E.com.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  (C.seedComExtras = C.seedComExtras || []).push(function (S) {
    const db = C.store.db; const K = C.engine.com; const clock = C.clock; const NOW = C.clock.start;
    const at = (m, d, h, mi) => C.cal.spTs(2026, m, d, h, mi || 0);
    const quando = (m, d, h, mi) => clock.set(at(m, d, h, mi));
    const ok = (r, ctx) => { if (!r.ok) throw new Error('seed-com2: ' + (r.erro || r.codigo) + ' (' + ctx + ')'); return r; };
    const abrir = (when, o) => { quando(...when); return ok(K.abrirConversa(o), 'abrir ' + (o.canal || '')).conv.id; };
    const dizer = (when, convId, userId, texto, extra) => { quando(...when); const r = K.enviar(Object.assign({ convId, userId, texto }, extra || {})); return r; };

    /* ---------- esclarecimentos no leilão (Vitrine): resposta pública e anônima ---------- */
    const op = db.get('operacoes', 'OP-26-0464');
    if (op && op.status === 'aberta') {
      const cid = abrir([11, 23, 8, 50], { userId: 'u-vertice-1', canal: 'esclarecimentos', ancora: { kind: 'operacao', id: op.id }, contraOrgId: op.cedenteId, titulo: 'Esclarecimentos da operação ' + op.id, estruturada: { modelo: 'pedir_documento', valor: 'Nota fiscal (XML)' } });
      const adm = db.where('users', (x) => x.orgId === op.cedenteId && x.perfil === 'admin')[0];
      dizer([11, 23, 9, 20], cid, adm.id, '', { estruturada: { modelo: 'documento_anexado' }, anexos: [{ nome: 'nfe_48201.xml', tamanho: 18400 }] });
      dizer([11, 23, 9, 40], cid, 'u-nordeste-1', '', { estruturada: { modelo: 'esclarecer_sacado', valor: 'Prazo médio de pagamento' } });
    }

    /* ---------- pós-aceite (cedente x financiador vencedor): alerta de contato e denúncia ---------- */
    const op2 = db.get('operacoes', 'OP-26-0461');
    let pos = null;
    if (op2 && op2.financiadorId === 'f-nordeste') {
      pos = abrir([11, 23, 8, 40], { userId: 'u-nordeste-1', canal: 'pos_aceite', ancora: { kind: 'operacao', id: op2.id }, contraOrgId: op2.cedenteId, titulo: 'Operação ' + op2.id, texto: 'Marina, recebemos a cessão assinada. Podemos alinhar por aqui a liberação do pagamento?' });
      dizer([11, 23, 8, 55], pos, 'u-aurora-1', 'Bom dia, Eduardo. Já assinamos. O pagamento sai dentro do limite previsto, certo?');
      dizer([11, 23, 9, 5], pos, 'u-aurora-1', 'Se preferir, me liga no (11) 98765-4321 que resolvemos mais rápido.');
      dizer([11, 23, 9, 8], pos, 'u-aurora-1', 'Ou me chama no zap, é mais fácil.');
      dizer([11, 23, 9, 30], pos, 'u-aurora-1', 'Vocês demoram demais para pagar e isso é um absurdo. Vou comentar com o mercado inteiro.');
      const ofensiva = K.mensagens(pos).filter((m) => /absurdo/.test(m.texto || '')).pop();
      quando(11, 23, 9, 42); ok(K.denunciar({ userId: 'u-nordeste-1', convId: pos, msgId: ofensiva && ofensiva.id, motivo: 'A mensagem tem tom ofensivo e ameaça expor a empresa publicamente. Pedimos a análise da Cedy.' }), 'denúncia');
      quando(11, 23, 9, 50); ok(K.registrarAcesso(pos, 'u-ops-3', 'Apuração de caso em análise pela Mesa'), 'acesso');
    }

    /* ---------- bloqueio ativo ("só conversa") ---------- */
    quando(11, 20, 14, 0); K.bloquear({ userId: 'u-sertao-1', contraOrgId: 'f-orla', tipo: 'conversa', motivo: 'Insistência em contato por telefone fora da plataforma' });

    /* ---------- agente de atendimento: histórico simulado de respostas revisadas e promoção (CC-31) ----------
       200 respostas assistidas revisadas entre 14/09 e 16/10 (192 sem edição = 96%), nenhum incidente; promoção
       aprovada em 19/10 e 40 respostas autônomas desde então. Tudo marcado como simulado. */
    const IA = C.engine.ia.com; const cfg = K.cfg();
    cfg.agentes = Object.assign({}, cfg.agentes, { categorias: { informativa_fonte: { modo: 'autonomo', cicloDesde: at(9, 14, 8, 0), desde: at(10, 19, 10, 0), promovidaPor: 'u-super-1', simulado: true } } });
    const revisores = ['u-ops-1', 'u-ops-2', 'u-ops-5']; const dias = [];
    for (let d = 14; d <= 30; d++) if ([1, 2, 3, 4, 5].includes(new Date(Date.UTC(2026, 8, d)).getUTCDay())) dias.push([9, d]);
    for (let d = 1; d <= 16; d++) if ([1, 2, 3, 4, 5].includes(new Date(Date.UTC(2026, 9, d)).getUTCDay())) dias.push([10, d]);
    for (let i = 0; i < 200; i++) {
      const [m, d] = dias[i % dias.length]; const ts = at(m, d, 8 + (i * 7) % 9, (i * 13) % 60);
      IA.registrar({ categoria: 'informativa_fonte', modo: 'assistido', editada: i % 25 === 3, revisadaPor: revisores[i % 3], origem: 'chamado', simulado: true, ts });
    }
    for (let i = 0; i < 40; i++) {
      const d = 19 + Math.floor(i / 2); const m = d > 31 ? 11 : 10; const dd = d > 31 ? d - 31 : d; if (m === 11 && dd > 22) break;
      IA.registrar({ categoria: 'informativa_fonte', modo: 'autonomo', editada: false, revisadaPor: null, origem: 'chamado', simulado: true, ts: at(m, dd, 8 + (i * 5) % 9, (i * 11) % 60) });
    }
    quando(10, 19, 10, 0); C.store.ledger.append({ actor: C.engine.actors.user('u-super-1'), acao: 'com.agente_promovido', entidade: { kind: 'agente', id: 'ag-atendimento' }, resumo: 'Agente de atendimento promovido a autônomo na categoria informativa com fonte (200 revisadas, 96% sem edição, 0 incidentes). Histórico simulado do protótipo.', classe: 'R3', detalhe: { categoria: 'informativa_fonte', revisadas: 200, semEdicao: 0.96, incidentes: 0, simulado: true } });

    clock.set(NOW);
  });
})();
