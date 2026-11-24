/* =========================================================================
   Cedy protótipo 0.3, Central de comunicação: configuração e dados de
   exemplo. Chamado no fim de seed.build(), depois de seedPlataforma. O
   relógio de simulação anda para trás e para frente durante a geração (cada
   mensagem leva a data em que "aconteceu") e termina em C.clock.start
   (seg 23/11/2026 10:12 BRT). As mensagens passam pelo motor (E.com), então
   têm hash encadeado, prazos e regras reais. Tudo fictício e determinístico.
   ========================================================================= */
(function () {
  window.Cedy.seedCom = function (S) {
    const C = window.Cedy;
    const db = C.store.db; const K = C.engine.com; const clock = C.clock;
    const NOW = C.clock.start;
    const at = (m, d, h, mi) => C.cal.spTs(2026, m, d, h, mi || 0);

    /* ------------------------- configuração ------------------------- */
    // SLA em horas úteis (janela 8h a 18h) [INFERÊNCIA]: valores de referência, editáveis pelo Superadmin com quatro olhos.
    S.config.comunicacao = {
      blocos: { pares: true, agentes: true, comunicados: true, anexos: true },
      limites: { usuarioMsgHora: 30, usuarioAnexosDia: 10, empresaMsgHora: 120 },
      sla: { critica: 2, normal: 8, baixa: 10, compliance: 10 },
      retencao: { operacaoAnos: 5, chamadoAnos: 2 },
      agentes: { autonomoR0: true, promocao: { revisadas: 200, semEdicao: 0.95, incidentes: 0 } },
    };

    /* ------------------------- gerador ------------------------- */
    const quando = (m, d, h, mi) => clock.set(at(m, d, h, mi));
    const abrir = (when, o) => { quando(...when); const r = K.abrirConversa(o); if (!r.ok) throw new Error('seed-com: ' + r.erro); return r.conv.id; };
    const dizer = (when, convId, userId, texto, extra) => { quando(...when); const r = K.enviar(Object.assign({ convId, userId, texto }, extra || {})); if (!r.ok) throw new Error('seed-com: ' + r.erro + ' (' + convId + ')'); return r; };

    // convite pendente usado no chamado de reenvio
    db.put('users', { id: 'u-aurora-8', nome: 'Bruno Teixeira', email: 'bruno@auroraplasticos.com.br', cargo: 'Analista financeiro', orgId: 'c-aurora', perfil: 'operador', demo: false, twofa: false, ultimoAcesso: null, telefone: '', hue: 70 });

    /* ------------------------- 14 chamados, em ordem de criação ------------------------- */
    // 1. cadastro: resolvido
    let c = abrir([11, 12, 9, 20], { userId: 'u-aurora-1', canal: 'cedy', categoria: 'cadastro', titulo: 'Atualização do contrato social', texto: 'Bom dia. Fizemos uma alteração no contrato social, com a entrada de um novo sócio. Posso enviar o documento por aqui para atualizar o cadastro?' });
    dizer([11, 12, 10, 5], c, 'u-ops-3', 'Bom dia, Marina. Pode enviar o contrato social consolidado em PDF. Assim que chegar, abro a revisão do cadastro.', { status: 'aguardando_cliente' });
    dizer([11, 12, 11, 40], c, 'u-aurora-1', 'Segue o documento consolidado.', { anexos: [{ nome: 'contrato_social_consolidado.pdf', tamanho: 482000 }] });
    dizer([11, 12, 15, 10], c, 'u-ops-3', 'Recebi e conferi. O cadastro foi atualizado e a revisão ficou registrada. Se precisar de mais alguma coisa, é só avisar.', { status: 'resolvido' });
    // 2. faturamento: resolvido
    c = abrir([11, 13, 14, 5], { userId: 'u-vertice-2', canal: 'cedy', categoria: 'faturamento', titulo: 'Dúvida sobre o cálculo da TS de outubro', texto: 'Gostaria de entender como o piso da TS foi aplicado nas operações menores de outubro.' });
    dizer([11, 13, 16, 20], c, 'u-ops-4', 'Olá, Helena. O piso é o maior valor entre R$ 15 e 0,08% a.m. proporcional ao prazo. Em outubro, algumas operações menores ficaram no piso. Deixei a memória de cálculo anexa à fatura do mês.', { status: 'resolvido' });
    // 3. operações: encerrado
    c = abrir([11, 16, 10, 10], { userId: 'u-sertao-1', canal: 'cedy', categoria: 'operacoes', titulo: 'Lote recusado por divergência de sacado', texto: 'O lote foi recusado por divergência no sacado de uma NF-e. Já corrigi o cadastro. Podem reavaliar?' });
    dizer([11, 16, 11, 30], c, 'u-ops-1', 'Olá, Rosângela. Conferi: o sacado agora confere com o XML. Reenvie o lote pelo app para uma nova validação; assim ele entra na fila com prazo.', { status: 'aguardando_cliente' });
    dizer([11, 16, 14, 0], c, 'u-sertao-1', 'Reenviei o lote, obrigada.');
    dizer([11, 16, 15, 20], c, 'u-ops-1', 'Perfeito, o lote já está na validação. Encerro o chamado; se algo mudar, abra outro.', { status: 'encerrado' });
    // 4. cadastro: resolvido
    c = abrir([11, 17, 9, 0], { userId: 'u-orla-1', canal: 'cedy', categoria: 'cadastro', titulo: 'Regulamento do fundo atualizado', texto: 'O regulamento do nosso fundo foi atualizado em outubro. Como substituímos o documento no cadastro?' });
    dizer([11, 17, 10, 30], c, 'u-ops-3', 'Olá, Vanessa. Envie o novo regulamento na tela Cadastro e documentos, no item "Regulamento", e avise aqui. A versão anterior fica guardada no histórico.', { status: 'resolvido' });
    // 5. outros (baixa): sem resposta, prazo vencido
    abrir([11, 17, 14, 0], { userId: 'u-campo-1', canal: 'cedy', categoria: 'outros', titulo: 'Sugestão para o relatório mensal', texto: 'Seria possível incluir o prazo médio por sacado no relatório mensal da nossa carteira? Ajudaria muito na revisão interna.' });
    // 6. conciliação: sem resposta, prazo vencido
    abrir([11, 18, 10, 0], { userId: 'u-horizonte-1', canal: 'cedy', categoria: 'conciliacao', titulo: 'Crédito de R$ 41 mil sem conciliação', texto: 'Recebemos um crédito de R$ 41.200,00 do sacado Montrel e ele ainda não aparece conciliado na nossa conta. Podem verificar?' });
    // 7. acesso: ação R1 executada (reenvio de convite)
    c = abrir([11, 18, 11, 0], { userId: 'u-aurora-1', canal: 'cedy', categoria: 'acesso', titulo: 'Convite do novo colega não chegou', texto: 'Convidei o Bruno Teixeira na semana passada e ele diz que não recebeu o e-mail do convite.' });
    quando(11, 18, 11, 5); const pedido = K.pedirAcao({ convId: c, userId: 'u-aurora-1', acao: 'reenviar_convite', alvo: 'usuario:u-aurora-8', texto: 'Podem reenviar o convite para o Bruno Teixeira, por favor?' });
    quando(11, 18, 11, 40); K.executarR1(pedido.acao.id, 'u-ops-5');
    dizer([11, 18, 11, 45], c, 'u-ops-5', 'Reenviei o convite para o Bruno. Peça para ele olhar também a caixa de spam. Se não chegar até o fim do dia, me avise por aqui.', { status: 'resolvido' });
    // 8. operações: pedido fora da lista, resposta automática com o fluxo formal
    c = abrir([11, 18, 16, 30], { userId: 'u-tecno-1', canal: 'cedy', categoria: 'operacoes', titulo: 'Cancelamento de operação', texto: 'Podem cancelar a operação OP-26-0300? O sacado pediu para refazermos o lote.' });
    dizer([11, 19, 9, 5], c, 'u-ops-1', 'Olá, Gustavo. Por segurança, o cancelamento só é feito pelo app, na tela da operação, com a sua autenticação. Se a operação já tiver sido aceita, o cancelamento depende do financiador. Se precisar de ajuda no passo a passo, me avise.');
    // 9. cadastro: aguardando o cliente
    c = abrir([11, 19, 15, 15], { userId: 'u-vertice-1', canal: 'cedy', categoria: 'cadastro', titulo: 'Troca do representante legal', texto: 'Precisamos trocar o representante legal do fundo no cadastro. Como fazemos?' });
    dizer([11, 19, 16, 0], c, 'u-ops-3', 'Olá, Rafael. Para trocar o representante preciso da ata de eleição e do documento do novo representante. Envie por aqui, em PDF.', { status: 'aguardando_cliente' });
    // 10. acesso: crítico por regra (único administrador sem acesso) e pedido de redefinição de 2FA aguardando a Mesa
    c = abrir([11, 23, 8, 30], { userId: 'u-tecno-1', canal: 'cedy', categoria: 'acesso', titulo: 'Perdi o celular do 2FA e não consigo entrar', texto: 'Perdi o celular com o aplicativo de autenticação e não consigo entrar. Sou o único administrador da empresa e hoje há uma cessão aguardando a minha assinatura.', sinais: { semAcesso: true } });
    quando(11, 23, 8, 35); K.pedirAcao({ convId: c, userId: 'u-tecno-1', acao: 'iniciar_reset_2fa', alvo: 'u-tecno-1', texto: 'Peço que iniciem a redefinição do meu 2FA. Concluo pelo app com o novo celular.' });
    // 11. faturamento: aberto
    abrir([11, 23, 9, 10], { userId: 'u-atlas-1', canal: 'cedy', categoria: 'faturamento', titulo: 'Fatura de outubro com valor diferente do esperado', texto: 'A fatura de outubro veio com um valor maior que o previsto na nossa conciliação interna. Podem enviar a memória de cálculo?' });
    // 12. plataforma: em atendimento, ligado a incidente em monitoramento
    c = abrir([11, 23, 9, 20], { userId: 'u-nordeste-1', canal: 'cedy', categoria: 'plataforma', titulo: 'Vitrine lenta ao abrir o detalhe', texto: 'A Vitrine está levando muito tempo para abrir o detalhe das operações desde cedo.' });
    dizer([11, 23, 9, 45], c, 'u-ops-5', 'Olá, Eduardo. Há um incidente em monitoramento com a consulta de CNPJ que pode afetar a abertura de detalhes. Estamos acompanhando e aviso aqui quando normalizar.');
    // 13. outros (baixa): aberto
    abrir([11, 23, 9, 45], { userId: 'u-lumen-1', canal: 'cedy', categoria: 'outros', titulo: 'Sugestão: filtro por subparceiro nos relatórios', texto: 'Seria possível filtrar os relatórios mensais por subparceiro? Facilitaria o repasse.' });
    // 14. plataforma: status que não atualizou, aberto
    abrir([11, 23, 9, 55], { userId: 'u-prisma-1', canal: 'cedy', categoria: 'plataforma', titulo: 'Status da OP-26-0449 não atualizou após o pagamento', texto: 'Pagamos a OP-26-0449 hoje cedo e a tela da operação ainda mostra aguardando pagamento. Pode ser atraso de atualização?' });

    /* ------------------------- conversas de item ------------------------- */
    // cedente x Cedy sobre uma operação: a Mesa informa, sem prometer prazo
    c = abrir([11, 19, 17, 20], { userId: 'u-aurora-1', canal: 'cedy', ancora: { kind: 'operacao', id: 'OP-26-0461' }, texto: 'Boa tarde. A cessão da OP-26-0461 já foi assinada pelas duas partes. Onde acompanho o pagamento do financiador?' });
    dizer([11, 19, 17, 50], c, 'u-ops-1', 'Boa tarde, Marina. O pagamento aparece na tela da operação, com o limite previsto pela regra de corte. Se passar do limite, o sistema avisa você e o financiador. Não consigo antecipar a hora exata do crédito.');
    // cedente x sacado (programa com sacado notificado): perguntas de modelo fechado
    const conf = db.all('titulos').find((t) => t.produto === 'confia');
    if (conf) {
      const cedAdmin = db.where('users', (x) => x.orgId === conf.orgId && x.perfil === 'admin')[0];
      const sacAdmin = db.where('users', (x) => x.orgId === conf.sacadoId && x.perfil === 'admin')[0];
      if (cedAdmin && sacAdmin) {
        c = abrir([11, 19, 11, 0], { userId: cedAdmin.id, canal: 'cedente_sacado', ancora: { kind: 'titulo', id: conf.id }, contraOrgId: conf.sacadoId, estruturada: { modelo: 'confirmar_titulo', valor: 'Em 1 dia útil' } });
        dizer([11, 19, 14, 10], c, sacAdmin.id, '', { estruturada: { modelo: 'entendido' } });
      }
    }
    // originador x indicado (modelo fechado) e originador x subparceiro (texto ancorado)
    c = abrir([11, 19, 10, 30], { userId: 'u-lumen-1', canal: 'orig_indicado', ancora: { kind: 'cadastro', id: 'c-aurora' }, contraOrgId: 'c-aurora', estruturada: { modelo: 'pendencia_doc', valor: 'Certidão federal' } });
    dizer([11, 19, 14, 0], c, 'u-aurora-1', '', { estruturada: { modelo: 'enviado' } });
    const prem = db.all('premiacoes').find((p) => p.subId === 'sp-1');
    if (prem) {
      c = abrir([11, 19, 16, 40], { userId: 'u-sub-1', canal: 'orig_sub', ancora: { kind: 'competencia', id: prem.id }, texto: 'Carlos, pode conferir comigo a minha comissão de outubro antes do repasse?' });
      dizer([11, 20, 10, 15], c, 'u-lumen-1', 'Claro, Marcelo. Fecho a conferência hoje e te passo o detalhe por aqui.');
    }

    clock.set(NOW);
    // prazos já estourados na geração: o líder foi avisado no momento do estouro (evita aviso repetido ao abrir o app)
    db.where('conversas', (cv) => K.slaEstourado(cv) && !cv.estouroNotificado).forEach((cv) => {
      db.patch('conversas', cv.id, { estouroNotificado: cv.slaAte });
      db.where('users', (x) => K.isCedy(x) && x.perfil === 'admin').forEach((x) => C.store.notify.send({ ts: cv.slaAte, to: { userId: x.id }, tipo: 'erro', titulo: `Prazo estourado: ${cv.protocolo}`, corpo: `${K.nomeOrg(cv.orgIds[0])}, prioridade ${K.PRIORIDADES[cv.prioridade].toLowerCase()}, fila ${K.FILAS[cv.fila]}.`, link: '/ops/chamados/' + cv.id, classe: 'operacional' }));
      C.store.ledger.append({ ts: cv.slaAte, actor: C.engine.actors.sistema('Relógio'), acao: 'chamado.sla_estourado', entidade: { kind: 'conversa', id: cv.id }, resumo: `Prazo de resposta do chamado ${cv.protocolo} estourou`, classe: 'R1' });
    });
    (C.seedComExtras || []).forEach((f) => f(S));
  };
})();
