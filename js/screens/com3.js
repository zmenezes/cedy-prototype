/* =========================================================================
   Cedy, Central de comunicação, pares e moderação (S3):
   - esclarecimentos no leilão (perguntas de modelo fechado, resposta pública e anônima)
   - denúncia, bloqueio e "Relacionamentos bloqueados" (cliente)
   - leitura de conversa entre clientes com motivo, redação de mensagem (Mesa)
   - página /ops/comunicacao com abas plugáveis (C.comUI.opsTabs): alertas de
     contato, denúncias e acessos; comunicados e respostas de IA se registram
     nesse array. Prefixo CSS: cm3-.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session } = C.store;
  const E = C.engine; const K = E.com; const UI = C.comUI;
  const me = () => session.user();
  const userName = (id) => { const u = id && db.get('users', id); return u ? u.nome : '—'; };
  const toastErr = (r) => ui.toast('Não foi possível', { type: 'error', text: r.erro });
  const PARES = ['esclarecimentos', 'pos_aceite', 'cedente_sacado', 'orig_indicado'];

  /* ------------------------------ leitura com motivo ------------------------------ */
  /** A Cedy só lê conversa entre clientes informando o motivo; o acesso vai à trilha (R3) e os participantes são avisados */
  UI.gateMotivo = function (conv, ctx, retry) {
    const u = me(); const aviso = h('div'); const motivo = ui.input({ type: 'textarea', rows: 3, placeholder: 'Ex.: apuração de alerta de contato externo ALERTA-0001', value: ctx.query.m || '' });
    const campo = ui.field({ label: 'Motivo da leitura', required: true, hint: 'Mínimo de 10 caracteres. Fica registrado com o seu nome, o papel e a hora.' }, motivo);
    return h('div.sh-page.cm3-gate',
      ui.pageHeader({ eyebrow: 'Mesa Cedy', title: 'Ler conversa entre clientes', back: '/ops/comunicacao' }),
      ui.card({ title: conv.titulo, subtitle: `${conv.orgIds.map(K.nomeOrg).join(' e ')} · ${UI.canalLabel(conv.canal)}` },
        ui.callout({ tone: 'warn', icon: 'eye', title: 'Leitura registrada', text: 'Conversas entre clientes só são lidas com motivo. O acesso vai para a trilha como R3 e as empresas participantes veem, na conversa, que a Cedy leu e por quê. A Cedy não escreve nesta conversa.' }),
        campo, aviso,
        h('div.row.end', ui.btn('Cancelar', { variant: 'ghost', route: '/ops/comunicacao' }), ui.btn('Registrar e ler', { variant: 'primary', icon: 'eye', onclick: () => {
          C.clear(aviso); const r = K.registrarAcesso(conv.id, u.id, motivo.value);
          if (!r.ok) { campo.setError(r.erro); return; } campo.setError(''); retry();
        } }))));
  };

  /* ------------------------------ ações por mensagem ------------------------------ */
  UI.msgAcoes = function (m, conv, viewer) {
    if (!viewer || m.autor.tipo !== 'pessoa') return [];
    const out = [];
    if (!K.isCedy(viewer) && PARES.includes(conv.canal) && m.autor.id !== viewer.id && m.autor.orgId !== viewer.orgId && !m.redigida && !m.bloqueada) {
      out.push(ui.iconBtn('flag', { label: 'Denunciar esta mensagem', size: 'sm', class: 'cm3-flag', onclick: () => denunciarModal(conv, m) }));
    }
    if (K.isCedy(viewer) && (viewer.papel === 'compliance' || K.ehLider(viewer)) && !m.redigida && PARES.concat(['cedy', 'pos_aceite']).includes(conv.canal) && K.acesso(conv, viewer) !== null) {
      out.push(ui.iconBtn('eraser', { label: 'Redigir conteúdo (oculta o texto e preserva o registro)', size: 'sm', class: 'cm3-flag', onclick: () => redigirModal(m) }));
    }
    return out;
  };
  function redigirModal(m) {
    const motivo = ui.input({ type: 'textarea', rows: 3, placeholder: 'Por que o conteúdo precisa ser ocultado?' }); const campo = ui.field({ label: 'Motivo da redação', required: true, hint: 'O texto some para todos. O registro (autor, hora e código) permanece e o motivo fica visível às partes. Vai à trilha como R3.' }, motivo);
    ui.modal({ title: 'Redigir mensagem', icon: 'eraser', size: 'md', body: h('div.stack.tight', ui.callout({ tone: 'warn', text: 'A mensagem não é apagada nem editada: o conteúdo é ocultado e o fato da redação fica registrado.' }), campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Redigir', { variant: 'danger', icon: 'eraser', onclick: () => { const r = K.redigir(m.id, motivo.value, me().id); if (!r.ok) { campo.setError(r.erro); return; } api.close(); ui.toast('Mensagem redigida', { type: 'success', text: 'Registro preservado e trilha R3 gravada.' }); } })] });
  }

  /* ------------------------------ denúncia e bloqueio ------------------------------ */
  UI.acoesConversa = function (conv, u) {
    if (K.isCedy(u) || !PARES.includes(conv.canal)) return [];
    const ac = K.acesso(conv, u); if (ac !== 'escreve' && ac !== 'le') return [];
    const itens = [{ label: 'Denunciar a conversa', icon: 'flag', hint: 'Vai ao compliance, com o contexto', onclick: () => denunciarModal(conv, null) }];
    if (conv.canal !== 'esclarecimentos') itens.push({ label: 'Bloquear esta empresa', icon: 'ban', hint: u.perfil === 'admin' ? 'Impede novas conversas' : 'Só o administrador bloqueia', disabled: u.perfil !== 'admin', onclick: () => bloquearModal(conv, u) });
    return itens;
  };
  function denunciarModal(conv, msg) {
    const motivo = ui.input({ type: 'textarea', rows: 4, placeholder: 'O que aconteceu? Ex.: a outra parte pediu para continuar a negociação por fora da plataforma.' });
    const campo = ui.field({ label: 'Motivo', required: true, hint: 'Mínimo de 10 caracteres.' }, motivo);
    ui.modal({ title: msg ? 'Denunciar mensagem' : 'Denunciar conversa', subtitle: conv.titulo, icon: 'flag', size: 'md',
      body: h('div.stack.tight', msg ? h('blockquote.cm3-quote', msg.texto) : null, ui.callout({ tone: 'info', icon: 'shield-check', text: 'O compliance recebe a denúncia com o contexto da conversa e decide. A outra parte não é avisada por esta tela e nada é apagado.' }), campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Enviar denúncia', { variant: 'primary', icon: 'send', onclick: () => { const r = K.denunciar({ userId: me().id, convId: conv.id, msgId: msg ? msg.id : null, motivo: motivo.value }); if (!r.ok) { campo.setError(r.erro); return; } api.close(); ui.toast('Denúncia enviada', { type: 'success', text: `Protocolo ${r.denuncia.id}. O compliance analisa.` }); } })] });
  }
  function bloquearModal(conv, u) {
    const contraId = conv.orgIds.find((o) => o !== u.orgId); const org = db.get('orgs', u.orgId); const contra = db.get('orgs', contraId);
    const podeOfertas = org.kind === 'cedente' && contra && contra.kind === 'financiador'; let tipo = 'conversa';
    const motivo = ui.input({ type: 'textarea', rows: 2, placeholder: 'Motivo (opcional, só a sua empresa e a Cedy veem)' });
    const radio = ui.radio({ aria: 'Tipo de bloqueio', value: tipo, options: [{ value: 'conversa', label: 'Bloquear só a conversa', hint: 'A empresa não abre novas conversas com a sua. Ofertas e operações seguem como estão.' }, podeOfertas ? { value: 'ofertas', label: 'Bloquear ofertas e conversa', hint: 'A empresa deixa de ver as suas operações e de ofertar. Isso também impede novas conversas.' } : null].filter(Boolean), onChange: (v) => { tipo = v; } });
    ui.modal({ title: 'Bloquear ' + (contra ? contra.fantasia || contra.nome : 'empresa'), icon: 'ban', size: 'md',
      body: h('div.stack.tight', radio, ui.field({ label: 'Motivo', optional: true }, motivo), ui.callout({ tone: 'info', text: 'O bloqueio não altera operação em andamento nem apaga o histórico. Você desfaz quando quiser em "Relacionamentos bloqueados".' })),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Bloquear', { variant: 'danger', icon: 'ban', onclick: () => { const r = K.bloquear({ userId: u.id, contraOrgId: contraId, tipo, motivo: motivo.value }); if (!r.ok) return toastErr(r); api.close(); ui.toast('Empresa bloqueada', { type: 'success', text: tipo === 'ofertas' ? 'Ofertas e novas conversas bloqueadas.' : 'Novas conversas bloqueadas.' }); } })] });
  }
  UI.abrirBloqueios = function () {
    const u = me(); const admin = u.perfil === 'admin';
    const corpo = ui.live(['bloqueiosCom', 'orgs'], () => {
      const lista = K.bloqueiosDe(u.orgId);
      if (!lista.length) return ui.empty({ icon: 'ban', title: 'Nenhum relacionamento bloqueado', text: 'Para bloquear, abra uma conversa com a empresa e use "Mais ações da conversa".' });
      return ui.table({ rows: lista, rowKey: (b) => b.id, columns: [
        { key: 'n', label: 'Empresa', mobile: 'primary', render: (b) => h('strong', b.nome) },
        { key: 't', label: 'O que está bloqueado', render: (b) => b.tipo === 'ofertas' ? ui.badge('Ofertas e conversa', 'red', { dot: true }) : ui.badge('Só conversa', 'amber', { dot: true }) },
        { key: 'd', label: 'Desde', mobile: 'hide', render: (b) => (b.desde ? fmt.date(b.desde) : '—') },
        { key: 'm', label: 'Motivo', mobile: 'hide', render: (b) => h('small.muted', b.motivo || '—') },
        { key: 'a', label: '', render: (b) => ui.btn('Desbloquear', { size: 'sm', variant: 'secondary', disabled: !admin, title: admin ? null : 'Só o administrador desbloqueia.', onclick: () => { const r = K.desbloquear(b.id, u.id); r.ok ? ui.toast('Desbloqueado', { type: 'success' }) : toastErr(r); } }) },
      ] });
    });
    ui.drawer({ title: 'Relacionamentos bloqueados', subtitle: 'Uma lista só, com os dois tipos de bloqueio', icon: 'ban', size: 'lg',
      body: h('div.stack', ui.callout({ tone: 'info', text: 'Bloquear ofertas (cedente e financiador) também bloqueia a conversa. Bloquear só a conversa não impede ofertas nem operações. Operações em andamento e o histórico nunca são afetados.' }), corpo) });
  };

  /* ---------------------------- esclarecimentos no leilão ---------------------------- */
  /** Perguntas de modelo fechado, resposta pública e anônima a todos os financiadores com acesso à operação (CC-01, CC-02) */
  UI.esclarecimentosCard = function (opId) {
    const u = me(); const op = db.get('operacoes', opId); if (!u || !op) return null;
    const key = K.keyOf(u);
    if (!(key === 'cedente' && op.cedenteId === u.orgId) && key !== 'financiador') return null;
    const encontra = () => db.all('conversas').find((c) => c.canal === 'esclarecimentos' && c.ancora && c.ancora.id === opId);
    const compBox = h('div'); let compMontado = null;
    const aberta = () => (db.get('operacoes', opId) || {}).status === 'aberta';
    function drawComp() {
      const c = encontra(); if (!c || !aberta() || compMontado === c.id) return; compMontado = c.id; C.mount(compBox, UI.composer(c, me(), {}));
    }
    const lista = ui.live(['mensagens', 'conversas', 'operacoes'], () => {
      const c = encontra(); const o = db.get('operacoes', opId);
      if (!c || !K.acesso(c, me())) return h('div.cm3-vazio', icon('messages-square', 20), h('strong', 'Nenhuma pergunta ainda'), h('small', key === 'financiador' ? 'Faça uma pergunta de modelo fechado. A resposta fica visível aos financiadores com acesso a esta operação, e você aparece como anônimo.' : 'Quando um financiador perguntar, a pergunta e a sua resposta aparecem aqui, sem identificar quem perguntou.'));
      setTimeout(drawComp, 0);
      const nodes = UI.listaMensagens(c, me());
      return h('div.cm3-qa', nodes.length ? nodes : h('small.muted', 'Sem mensagens.'), o && o.status !== 'aberta' ? h('small.muted', 'O leilão terminou. A partir do aceite, a conversa segue em "Conversar", entre cedente e financiador vencedor.') : null);
    });
    const pergunta = key === 'financiador' && u.perfil !== 'leitor' && !encontra() ? ui.btn('Fazer uma pergunta', { variant: 'secondary', icon: 'messages-square', onclick: () => {
      const r = K.abrirConversa({ userId: u.id, canal: 'esclarecimentos', ancora: { kind: 'operacao', id: opId }, contraOrgId: op.cedenteId, titulo: 'Esclarecimentos da operação ' + opId });
      if (!r.ok) return toastErr(r); drawComp();
    } }) : null;
    const pausado = K.cfg().blocos && K.cfg().blocos.pares === false;
    return ui.card({ title: 'Esclarecimentos', subtitle: 'Perguntas e respostas públicas aos financiadores com acesso a esta operação. Quem pergunta fica anônimo.', class: 'cm3-qa-card' },
      pausado ? ui.callout({ tone: 'warn', icon: 'octagon-pause', title: 'Canal pausado pela Cedy', text: 'Perguntas e respostas entre empresas estão suspensas por enquanto. As operações seguem normalmente.' }) : null,
      lista, pergunta ? h('div.row', pergunta) : null, compBox);
  };

  /* ------------------------------------ abas ------------------------------------ */
  UI.opsTabs = [];
  const ehCedy = (u) => !!u && K.isCedy(u);
  const veModeracao = (u) => ehCedy(u) && (K.temPerm(u, 'ops.com.moderar') || u.papel === 'auditor' || u.perfil === 'superadmin');
  const podeModerar = () => K.temPerm(me(), 'ops.com.moderar');
  const semPerm = () => C.cannotMsg('ops.com.moderar');
  const ST_ALERTA = { aberto: ['Aberto', 'red'], em_analise: ['Em análise', 'amber'], resolvido: ['Resolvido', 'green'], dispensado: ['Dispensado', 'neutral'] };
  const ST_DEN = { pendente: ['Pendente', 'red'], em_analise: ['Em análise', 'amber'], procedente: ['Procedente', 'green'], improcedente: ['Improcedente', 'neutral'] };
  const PADRAO = { telefone: 'Telefone', email: 'E-mail', url: 'Endereço de internet', handle: 'Usuário de rede social', ofuscado: 'Contato disfarçado' };
  const stBadge = (map, s) => ui.badge((map[s] || [s])[0], (map[s] || [s, 'neutral'])[1], { dot: true });

  function pedeMotivo({ titulo, rotulo, ok: okLabel, perigo, dica, onSend }) {
    const motivo = ui.input({ type: 'textarea', rows: 3, placeholder: 'Descreva a decisão' }); const campo = ui.field({ label: rotulo, required: true, hint: dica || 'Mínimo de 10 caracteres. Vai à trilha.' }, motivo);
    ui.modal({ title: titulo, icon: perigo ? 'triangle-alert' : 'check', size: 'md', body: campo,
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn(okLabel, { variant: perigo ? 'danger' : 'primary', onclick: () => { const r = onSend(motivo.value); if (!r.ok) { campo.setError(r.erro); return; } api.close(); } })] });
  }

  /* ---- alertas de contato externo ---- */
  function tabAlertas() {
    let st = new Set(['aberto', 'em_analise']);
    const host = h('div.stack');
    const draw = () => {
      const todos = db.all('alertasContato'); const rows = todos.filter((a) => !st.size || st.has(a.status)).sort((a, b) => (K.alertaSlaEstourado(b) - K.alertaSlaEstourado(a)) || (b.ultimaEm - a.ultimaEm));
      const abertos = todos.filter((a) => ['aberto', 'em_analise'].includes(a.status));
      const chips = ui.chips({ aria: 'Situação', value: [...st], options: Object.entries(ST_ALERTA).map(([v, l]) => ({ value: v, label: l[0], count: todos.filter((a) => a.status === v).length || undefined })), onChange: (v) => { st = new Set(v); draw(); } });
      C.mount(host,
        h('div.cm3-kpis', ui.kpi({ icon: 'triangle-alert', tone: 'red', label: 'Em aberto', display: fmt.num(abertos.length), hint: 'casos por usuário e dia' }), ui.kpi({ icon: 'timer', tone: 'amber', label: 'Prazo vencido', display: fmt.num(abertos.filter(K.alertaSlaEstourado).length), hint: 'SLA do compliance: 1 dia útil' }), ui.kpi({ icon: 'repeat', tone: 'blue', label: 'Tentativas hoje', display: fmt.num(C.sum(todos.filter((a) => a.dia === C.cal.key(C.clock.now())), (a) => a.tentativas)), hint: 'filtro e agente' })),
        ui.callout({ tone: 'info', icon: 'shield-check', title: 'O agente só classifica; a pessoa decide', text: 'Cada caso agrupa as tentativas de um usuário no dia. O filtro bloqueia telefone, e-mail, endereço e usuário de rede; o agente sinaliza escrita disfarçada e a mensagem segue. Dispensar, advertir ou escalar é sempre decisão sua.' }),
        chips,
        ui.table({ rows, rowKey: (a) => a.id, onRowClick: (a) => alertaDrawer(a.id), pageSize: 12, empty: ui.empty({ icon: 'shield-check', title: 'Nenhum alerta com esses filtros', text: 'Tentativas de compartilhar contato fora da plataforma aparecem aqui.' }),
          columns: [
            { key: 'c', label: 'Caso', mobile: 'primary', render: (a) => h('div.cell-main', h('strong', K.nomeOrg(a.orgId)), h('small', userName(a.userId), ' · ', h('span.mono', a.id))) },
            { key: 'p', label: 'Padrão', render: (a) => h('div.cell-main', h('span', PADRAO[a.padrao] || a.padrao), h('small', a.trechoMascarado)) },
            { key: 't', label: 'Tentativas', align: 'right', render: (a) => h('span.num', a.tentativas) },
            { key: 'o', label: 'Origem', mobile: 'hide', render: (a) => (a.origem === 'agente' ? ui.ai('Agente') : ui.badge('Filtro', 'neutral')) },
            { key: 'pr', label: 'Prioridade', render: (a) => ui.badge({ normal: 'Normal', media: 'Média', alta: 'Alta' }[a.prioridade] || a.prioridade, { normal: 'neutral', media: 'amber', alta: 'red' }[a.prioridade]) },
            { key: 's', label: 'Situação', render: (a) => stBadge(ST_ALERTA, a.status) },
            { key: 'sla', label: 'Prazo', mobile: 'hide', render: (a) => (['aberto', 'em_analise'].includes(a.status) ? ui.countdown(a.slaAte, { prefix: 'em', endLabel: 'vencido', warnMs: 3600e3 }) : h('small.muted', '—')) },
          ] }));
    };
    return ui.live(['alertasContato'], () => { draw(); return host; });
  }
  function alertaDrawer(id) {
    const a = db.get('alertasContato', id); if (!a) return; const u = me(); const bl = podeModerar() ? null : semPerm();
    const conv = a.convId && db.get('conversas', a.convId);
    const msgs = (a.msgIds || []).map((mid) => db.get('mensagens', mid)).filter(Boolean);
    const corpo = h('div.stack',
      ui.kv([['Empresa', K.nomeOrg(a.orgId)], ['Usuário', userName(a.userId)], ['Padrão', PADRAO[a.padrao] || a.padrao], ['Tentativas hoje', String(a.tentativas)], ['Origem', a.origem === 'agente' ? 'Agente (escrita disfarçada), mensagem enviada' : 'Filtro, mensagem bloqueada'], ['Situação', stBadge(ST_ALERTA, a.status)], ['Prazo do compliance', ['aberto', 'em_analise'].includes(a.status) ? ui.countdown(a.slaAte, { prefix: 'em', endLabel: 'vencido' }) : '—'], a.decisaoMotivo ? ['Decisão', `${a.decisao || a.status} por ${userName(a.decididoPor)}: ${a.decisaoMotivo}`] : null].filter(Boolean)),
      ui.card({ title: 'Tentativas' }, msgs.length ? msgs.map((m) => h('div.cm3-tent', h('div.row', h('strong', fmt.datetime(m.ts)), m.bloqueada ? ui.badge('Bloqueada', 'red', { icon: 'ban' }) : ui.badge('Enviada, sinalizada', 'amber', { icon: 'flag' })), h('p.cm-text', m.redigida ? 'Conteúdo redigido.' : m.texto), h('small.muted', 'Código ', h('span.mono', m.hash)))) : h('p.muted', 'A tentativa foi barrada antes de existir uma conversa (abertura de chamado): só o trecho mascarado é guardado: ' + a.trechoMascarado + '.')),
      conv ? ui.btn('Ler a conversa (pede o motivo)', { variant: 'secondary', icon: 'eye', route: K.rotaConversa(conv, u.id) + '?m=' + encodeURIComponent('Apuração de caso em análise pela Mesa') }) : null);
    const ativo = ['aberto', 'em_analise'].includes(a.status);
    ui.drawer({ title: `Alerta ${a.id}`, subtitle: `${K.nomeOrg(a.orgId)} · ${userName(a.userId)}`, icon: 'triangle-alert', size: 'lg', body: corpo,
      footer: (api) => ativo ? [
        a.status === 'aberto' ? ui.btn('Assumir', { variant: 'secondary', icon: 'user-check', disabled: !!bl, title: bl, onclick: () => { const r = K.assumirAlerta(a.id, u.id); r.ok ? api.close() : toastErr(r); } }) : null,
        ui.btn('Dispensar', { variant: 'ghost', disabled: !!bl, title: bl, onclick: () => pedeMotivo({ titulo: 'Dispensar alerta', rotulo: 'Motivo (falso positivo?)', ok: 'Dispensar', onSend: (m) => { const r = K.decidirAlerta(a.id, 'dispensar', m, u.id); if (r.ok) api.close(); return r; } }) }),
        ui.btn('Escalar ao líder', { variant: 'secondary', disabled: !!bl, title: bl, onclick: () => pedeMotivo({ titulo: 'Escalar ao líder da Mesa', rotulo: 'Contexto para o líder', ok: 'Escalar', onSend: (m) => { const r = K.decidirAlerta(a.id, 'escalar', m, u.id); if (r.ok) api.close(); return r; } }) }),
        ui.btn('Advertir a empresa', { variant: 'primary', icon: 'send', disabled: !!bl, title: bl, onclick: () => pedeMotivo({ titulo: 'Advertir a empresa', rotulo: 'Motivo da advertência', ok: 'Advertir', dica: 'Os administradores da empresa recebem um lembrete da regra. Mínimo de 10 caracteres. Vai à trilha.', onSend: (m) => { const r = K.decidirAlerta(a.id, 'advertir', m, u.id); if (r.ok) api.close(); return r; } }) }),
      ].filter(Boolean) : [ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() })] });
  }

  /* ---- denúncias ---- */
  function tabDenuncias() {
    let st = new Set(['pendente', 'em_analise']);
    const host = h('div.stack');
    const draw = () => {
      const todas = db.all('denuncias'); const rows = todas.filter((d) => !st.size || st.has(d.status)).sort((a, b) => b.criadaEm - a.criadaEm);
      const chips = ui.chips({ aria: 'Situação', value: [...st], options: Object.entries(ST_DEN).map(([v, l]) => ({ value: v, label: l[0], count: todas.filter((d) => d.status === v).length || undefined })), onChange: (v) => { st = new Set(v); draw(); } });
      C.mount(host, chips, ui.table({ rows, rowKey: (d) => d.id, onRowClick: (d) => denunciaDrawer(d.id), empty: ui.empty({ icon: 'flag', title: 'Nenhuma denúncia com esses filtros', text: 'Quando um cliente denuncia uma conversa ou mensagem, ela chega aqui com o contexto.' }),
        columns: [
          { key: 'd', label: 'Denúncia', mobile: 'primary', render: (d) => h('div.cell-main', h('strong', d.id), h('small', d.msgId ? 'Mensagem' : 'Conversa', ' · ', fmt.rel(d.criadaEm))) },
          { key: 'p', label: 'Quem denunciou', render: (d) => h('div.cell-main', h('span', K.nomeOrg(d.por.orgId)), h('small', userName(d.por.userId))) },
          { key: 'c', label: 'Contra', mobile: 'hide', render: (d) => K.nomeOrg(d.contraOrgId) },
          { key: 'm', label: 'Motivo', mobile: 'hide', render: (d) => h('small', d.motivo.length > 70 ? d.motivo.slice(0, 67) + '…' : d.motivo) },
          { key: 's', label: 'Situação', render: (d) => stBadge(ST_DEN, d.status) },
        ] }));
    };
    return ui.live(['denuncias'], () => { draw(); return host; });
  }
  function denunciaDrawer(id) {
    const d = db.get('denuncias', id); if (!d) return; const u = me(); const bl = podeModerar() ? null : semPerm();
    const conv = db.get('conversas', d.convId); const m = d.msgId && db.get('mensagens', d.msgId);
    const aberta = ['pendente', 'em_analise'].includes(d.status);
    ui.drawer({ title: `Denúncia ${d.id}`, subtitle: `${K.nomeOrg(d.por.orgId)} contra ${K.nomeOrg(d.contraOrgId)}`, icon: 'flag', size: 'lg',
      body: h('div.stack',
        ui.kv([['Situação', stBadge(ST_DEN, d.status)], ['Denunciante', `${userName(d.por.userId)} (${K.nomeOrg(d.por.orgId)})`], ['Contra', K.nomeOrg(d.contraOrgId)], ['Conversa', conv ? conv.titulo : '—'], ['Feita em', fmt.datetime(d.criadaEm)], d.decisaoMotivo ? ['Decisão', `${userName(d.decididoPor)}: ${d.decisaoMotivo}`] : null].filter(Boolean)),
        ui.card({ title: 'Motivo do denunciante' }, h('p.cm-text', d.motivo)),
        m ? ui.card({ title: 'Mensagem denunciada', subtitle: `${m.autor.nome} (${m.autor.orgNome}) · ${fmt.datetime(m.ts)}` }, h('p.cm-text', m.redigida ? 'Conteúdo redigido.' : m.texto), h('small.muted', 'Código ', h('span.mono', m.hash))) : null,
        conv ? ui.btn('Ler a conversa inteira (pede o motivo)', { variant: 'secondary', icon: 'eye', route: K.rotaConversa(conv, u.id) + '?m=' + encodeURIComponent('Apuração de caso em análise pela Mesa') }) : null,
        aberta ? ui.callout({ tone: 'info', text: 'Denúncia procedente não bloqueia nem suspende ninguém por si só: a consequência segue os fluxos próprios (por exemplo, suspensão de empresa em Empresas).' }) : null),
      footer: (api) => aberta ? [
        d.status === 'pendente' ? ui.btn('Pôr em análise', { variant: 'secondary', disabled: !!bl, title: bl, onclick: () => { const r = K.decidirDenuncia(d.id, 'em_analise', '', u.id); r.ok ? api.close() : toastErr(r); } }) : null,
        ui.btn('Improcedente', { variant: 'ghost', disabled: !!bl, title: bl, onclick: () => pedeMotivo({ titulo: 'Denúncia improcedente', rotulo: 'Motivo', ok: 'Registrar', onSend: (mm) => { const r = K.decidirDenuncia(d.id, 'improcedente', mm, u.id); if (r.ok) api.close(); return r; } }) }),
        ui.btn('Procedente', { variant: 'primary', disabled: !!bl, title: bl, onclick: () => pedeMotivo({ titulo: 'Denúncia procedente', rotulo: 'Motivo e providência', ok: 'Registrar', onSend: (mm) => { const r = K.decidirDenuncia(d.id, 'procedente', mm, u.id); if (r.ok) api.close(); return r; } }) }),
      ].filter(Boolean) : [ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() })] });
  }

  /* ---- acessos ---- */
  function tabAcessos() {
    return ui.live(['acessosCom'], () => {
      const rows = db.all('acessosCom').sort((a, b) => b.ts - a.ts);
      return h('div.stack', ui.callout({ tone: 'info', icon: 'eye', title: 'Quem leu o quê e por quê', text: 'Toda leitura de conversa entre clientes, fora da fila própria, exige motivo e fica aqui e na trilha como R3. Os participantes veem o aviso na própria conversa.' }),
        ui.table({ rows, rowKey: (a) => a.id, pageSize: 12, empty: ui.empty({ icon: 'eye', title: 'Nenhum acesso registrado', text: 'As leituras com motivo aparecem aqui.' }),
          columns: [
            { key: 'ts', label: 'Quando', render: (a) => h('div.cell-main', h('span.nowrap', fmt.datetime(a.ts)), h('small', fmt.rel(a.ts))) },
            { key: 'u', label: 'Quem leu', mobile: 'primary', render: (a) => (a.userId === 'sistema' ? h('strong', 'Sistema') : h('div.cell-main', h('strong', userName(a.userId)), h('small', a.papel))) },
            { key: 'c', label: 'Conversa', render: (a) => { const c = db.get('conversas', a.convId); return h('div.cell-main', h('span', c ? c.titulo : a.convId), h('small', c ? c.orgIds.map(K.nomeOrg).join(' e ') : '')); } },
            { key: 'm', label: 'Motivo', mobile: 'secondary', render: (a) => h('small', a.motivo) },
          ] }));
    });
  }

  UI.opsTabs.push(
    { id: 'alertas', label: 'Alertas de contato', icon: 'triangle-alert', ordem: 10, visivel: veModeracao, contagem: () => db.where('alertasContato', (a) => ['aberto', 'em_analise'].includes(a.status)).length || undefined, render: tabAlertas },
    { id: 'denuncias', label: 'Denúncias', icon: 'flag', ordem: 20, visivel: veModeracao, contagem: () => db.where('denuncias', (d) => ['pendente', 'em_analise'].includes(d.status)).length || undefined, render: tabDenuncias },
    { id: 'acessos', label: 'Acessos', icon: 'eye', ordem: 50, visivel: veModeracao, render: tabAcessos });

  function pgComunicacao(ctx) {
    const u = me();
    const abas = UI.opsTabs.filter((t) => !t.visivel || t.visivel(u)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    if (!abas.length) return h('div.ops-page', ui.pageHeader({ eyebrow: 'Mesa Cedy · Central de comunicação', title: 'Comunicação' }), ui.empty({ icon: 'lock', title: 'Sem abas para o seu papel', text: 'Alertas, denúncias, comunicados e respostas de IA aparecem conforme as permissões do seu papel.' }));
    const cur = abas.find((t) => t.id === ctx.query.aba) || abas[0];
    const tabs = ui.tabs({ value: cur.id, items: abas.map((t) => ({ id: t.id, label: t.label, icon: t.icon, count: t.contagem ? t.contagem() : undefined })), onChange: (v) => C.router.go('/ops/comunicacao?aba=' + v) });
    return h('div.ops-page.cm3-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · Central de comunicação', title: 'Comunicação', subtitle: 'Alertas de contato externo, denúncias, comunicados, respostas de IA e quem leu o quê.' }),
      h('div.sh-tabs', tabs), cur.render(ctx));
  }
  C.router.register({ path: '/ops/comunicacao', roles: ['ops'], title: 'Comunicação', render: pgComunicacao });
})();
