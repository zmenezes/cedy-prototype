/* =========================================================================
   Cedy, Central de comunicação, lado da Mesa: fila de chamados por papel,
   página de atendimento (status, prazo, notas internas, passagem, ações
   reversíveis R1 e reversão). Prefixo CSS: cm2-. Depende de screens/com.js
   (C.comUI) e do motor E.com.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session } = C.store;
  const E = C.engine; const K = E.com; const UI = C.comUI;
  const me = () => session.user();
  const userName = (id) => { const u = id && db.get('users', id); return u ? u.nome : '—'; };
  const cedyLabel = (u) => (u.perfil === 'superadmin' ? 'Superadmin' : (C.OPS_PAPEIS[u.papel] || {}).label || 'Mesa') + (u.perfil === 'admin' ? ' (líder)' : '');
  const ABERTOS = ['aberto', 'em_atendimento'];
  const rascunhos = {}; // rascunhos de notas por chamado: sobrevivem ao redesenho do painel
  const filaOf = (c) => K.FILAS[c.fila] || '—';

  /* ----------------------------------- fila ----------------------------------- */
  function pgChamados(ctx) {
    const u = me(); const lider = K.ehLider(u) || u.papel === 'auditor';
    let escopo = lider ? 'todas' : 'minha'; let fila = new Set(); let st = new Set(); let pr = new Set(); let q = '';
    const minha = (c) => c.fila === u.papel || c.responsavelId === u.id;
    const todos = () => K.visiveis(u.id).filter((c) => c.tipo === 'chamado' && c.canal === 'cedy');
    const seg = lider ? ui.segmented({ aria: 'Escopo da fila', value: escopo, options: [{ value: 'todas', label: 'Todas as filas' }, { value: 'minha', label: 'Minha fila' }], onChange: (v) => { escopo = v; draw(); } }) : null;
    const search = ui.search({ placeholder: 'Buscar por protocolo, assunto ou empresa', onInput: (v) => { q = String(v).trim().toLowerCase(); draw(); } });
    const host = h('div.stack');
    function filtrar(rows) {
      if (escopo === 'minha') rows = rows.filter(minha);
      if (fila.size) rows = rows.filter((c) => fila.has(c.fila));
      if (st.size) rows = rows.filter((c) => (st.has('abertos') && ABERTOS.includes(c.status)) || (st.has('aguardando') && c.status === 'aguardando_cliente') || (st.has('fechados') && ['resolvido', 'encerrado'].includes(c.status)) || (st.has('vencidos') && K.slaEstourado(c)));
      if (pr.size) rows = rows.filter((c) => pr.has(c.prioridade));
      if (q) rows = rows.filter((c) => (c.protocolo + ' ' + c.titulo + ' ' + K.nomeOrg(c.orgIds[0])).toLowerCase().includes(q));
      return rows;
    }
    const ord = (a, b) => (K.slaEstourado(b) - K.slaEstourado(a)) || ((ABERTOS.includes(b.status) ? 1 : 0) - (ABERTOS.includes(a.status) ? 1 : 0)) || ((a.slaAte || Infinity) - (b.slaAte || Infinity)) || (b.ultimaMsgEm - a.ultimaMsgEm);
    function draw() {
      const base = todos(); const esc = escopo === 'minha' ? base.filter(minha) : base;
      const abertos = esc.filter((c) => ABERTOS.includes(c.status)); const venc = esc.filter((c) => K.slaEstourado(c)); const crit = abertos.filter((c) => c.prioridade === 'critica');
      const resp = base.filter((c) => c.primeiraRespostaEm && c.slaInicio); const medio = resp.length ? C.sum(resp, (c) => K.minutosUteis(c.slaInicio, c.primeiraRespostaEm)) / resp.length / 60 : null;
      const kpis = h('div.cm2-kpis',
        ui.kpi({ icon: 'life-buoy', tone: 'blue', label: 'Em aberto', display: fmt.num(abertos.length), hint: escopo === 'minha' ? 'na sua fila' : 'em todas as filas' }),
        ui.kpi({ icon: 'timer', tone: 'red', label: 'Prazo vencido', display: fmt.num(venc.length), hint: venc.length ? 'sem resposta no prazo' : 'nenhum' }),
        ui.kpi({ icon: 'siren', tone: 'amber', label: 'Críticos', display: fmt.num(crit.length), hint: 'só por regra objetiva' }),
        ui.kpi({ icon: 'hourglass', tone: 'teal', label: 'Aguardando cliente', display: fmt.num(esc.filter((c) => c.status === 'aguardando_cliente').length), hint: 'prazo pausado' }),
        ui.kpi({ icon: 'clock', tone: 'green', label: '1ª resposta (média)', display: medio === null ? '—' : fmt.num(medio, 1) + ' h úteis', hint: 'chamados já respondidos' }));
      const cont = (f) => esc.filter(f).length;
      const chipsFila = lider ? ui.chips({ aria: 'Fila', value: [...fila], options: Object.entries(K.FILAS).map(([v, l]) => ({ value: v, label: l, count: base.filter((c) => c.fila === v && ABERTOS.includes(c.status)).length || undefined })), onChange: (v) => { fila = new Set(v); draw(); } }) : null;
      const chipsSt = ui.chips({ aria: 'Situação', value: [...st], options: [{ value: 'abertos', label: 'Abertos', count: cont((c) => ABERTOS.includes(c.status)) || undefined }, { value: 'vencidos', label: 'Prazo vencido', count: venc.length || undefined }, { value: 'aguardando', label: 'Aguardando cliente' }, { value: 'fechados', label: 'Resolvidos' }], onChange: (v) => { st = new Set(v); draw(); } });
      const chipsPr = ui.chips({ aria: 'Prioridade', value: [...pr], options: Object.entries(K.PRIORIDADES).map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { pr = new Set(v); draw(); } });
      const rows = filtrar(base).sort(ord);
      C.mount(host, kpis, h('div.cm2-filters', chipsFila, chipsSt, chipsPr),
        ui.table({ rows, rowKey: (c) => c.id, onRowClick: (c) => C.router.go('/ops/chamados/' + c.id), rowClass: (c) => K.slaEstourado(c) && 'is-late', pageSize: 15,
          empty: ui.empty({ icon: 'life-buoy', title: 'Nenhum chamado com estes filtros', text: 'Chamados dos clientes aparecem aqui, por fila, com prazo de resposta.' }),
          columns: [
            { key: 'p', label: 'Chamado', mobile: 'primary', render: (c) => h('div.cell-main', h('strong', c.titulo), h('small', h('span.mono', c.protocolo), ' · ', (K.CATEGORIAS[c.categoria] || {}).label, ' · ', fmt.rel(c.criadaEm))) },
            { key: 'e', label: 'Empresa', render: (c) => h('div.cell-main', h('span', K.nomeOrg(c.orgIds[0])), h('small', userName(c.criadaPor))) },
            { key: 'pr', label: 'Prioridade', render: (c) => h('span.cm2-prio', UI.prioBadge(c.prioridade), c.urgentePedido ? ui.badge('Urgência pedida', 'amber', { icon: 'timer' }) : null) },
            { key: 's', label: 'Situação', render: (c) => UI.statusBadge(c.status) },
            { key: 'sla', label: 'Prazo', render: (c) => UI.slaChip(c) || h('small.muted', 'encerrado') },
            { key: 'r', label: 'Fila e responsável', mobile: 'secondary', render: (c) => h('div.cell-main', h('span', filaOf(c)), h('small', c.responsavelId ? userName(c.responsavelId) : 'sem responsável')) },
          ] }));
    }
    const live = ui.live(['conversas', 'users'], () => { draw(); return host; });
    return h('div.ops-page.cm2-page',
      ui.pageHeader({ eyebrow: 'Mesa Cedy · Central de comunicação', title: 'Chamados', subtitle: lider ? 'Todas as filas, com prazo de resposta. Cada fila é atendida pelo papel correspondente da Mesa.' : 'Chamados da sua fila e os atribuídos a você, com prazo de resposta.' }),
      ui.callout({ tone: 'info', icon: 'shield-check', title: 'Mensagem não é autorização', text: 'A Mesa só executa, por chamado, as ações reversíveis da lista fechada. O que mexe em dinheiro, acesso, conta bancária, limite ou taxa é feito pelo cliente no fluxo autenticado do app.' }),
      h('div.toolbar.cm2-toolbar', search, seg), live);
  }

  /* ------------------------------ atendimento -------------------------------- */
  const STATUS_OPS = [{ value: 'em_atendimento', label: 'Em atendimento' }, { value: 'aguardando_cliente', label: 'Aguardando o cliente' }, { value: 'resolvido', label: 'Resolvido' }, { value: 'encerrado', label: 'Encerrado' }];
  function podeAtender(conv) { return K.acesso(conv, me()) === 'atende'; }
  const bloqueio = (conv) => (podeAtender(conv) ? null : 'Seu papel só lê este chamado.');
  const toastErr = (r) => ui.toast('Não foi possível', { type: 'error', text: r.erro });

  function cardEmpresa(conv) {
    const org = db.get('orgs', conv.orgIds[0]); const por = db.get('users', conv.criadaPor);
    return ui.card({ title: 'Empresa e solicitante' }, ui.kv([['Empresa', org ? h('a.link', { href: '#/ops/empresas/' + org.id }, org.fantasia || org.nome) : '—'], ['Aberto por', por ? `${por.nome} (${por.perfil})` : '—'], ['Fila', filaOf(conv)], ['Responsável', conv.responsavelId ? userName(conv.responsavelId) : 'ninguém assumiu'], conv.promovidaDe ? ['Promovido de', h('span.mono', conv.promovidaDe)] : null].filter(Boolean)));
  }
  function cardAtendimento(conv) {
    const u = me(); const bl = bloqueio(conv); const chamado = conv.tipo === 'chamado';
    if (!chamado) return ui.card({ title: 'Conversa com a empresa' }, h('p.small.muted', 'Conversa ancorada em item, sem prazo. Se precisar de prazo, protocolo e fila, promova a chamado.'),
      ui.btn('Promover a chamado', { variant: 'secondary', icon: 'life-buoy', disabled: !!bl, title: bl, onclick: () => promoverMesa(conv) }));
    const sel = ui.select({ aria: 'Alterar status', options: STATUS_OPS, value: conv.status === 'aberto' ? 'em_atendimento' : conv.status, disabled: !!bl, onChange: (v) => { const r = K.alterarStatus(conv.id, v, u.id); if (!r.ok) toastErr(r); } });
    return ui.card({ title: 'Atendimento' },
      conv.urgentePedido ? h('div.cm2-urg', h('div.cm2-urg-t', icon('timer', 15), h('strong', 'O cliente pediu urgência')),
        h('p', 'Confirme só se o caso atender à regra de prioridade crítica.'),
        h('div.row.wrap', ui.btn('Confirmar urgência', { size: 'sm', variant: 'primary', disabled: !!bl, onclick: () => { const r = K.confirmarUrgente(conv.id, true, u.id); if (!r.ok) toastErr(r); } }), ui.btn('Manter prioridade', { size: 'sm', variant: 'secondary', disabled: !!bl, onclick: () => { const r = K.confirmarUrgente(conv.id, false, u.id); if (!r.ok) toastErr(r); } }))) : null,
      ui.field({ label: 'Status' }, sel),
      conv.slaPausado ? h('small.muted', `Prazo pausado com ${fmt.num(Math.round(conv.slaPausado.restanteMin / 6) / 10, 1)} h úteis restantes.`) : null,
      conv.prioridade !== 'critica' ? ui.field({ label: 'Prioridade', hint: 'Crítica só vem de regra ou de urgência confirmada.' }, ui.select({ aria: 'Prioridade', options: [{ value: 'normal', label: 'Normal' }, { value: 'baixa', label: 'Baixa' }], value: conv.prioridade, disabled: !!bl, onChange: (v) => { const r = K.fixarPrioridade(conv.id, v, u.id); if (!r.ok) toastErr(r); } })) : h('small.muted', 'Prioridade crítica: ' + (conv.prioridadeMotivo || 'por regra objetiva')),
      h('div.row.wrap', ui.btn(conv.responsavelId === u.id ? 'Você é o responsável' : 'Assumir', { variant: 'secondary', size: 'sm', icon: 'user-check', disabled: !!bl || conv.responsavelId === u.id, title: bl, onclick: () => { const r = K.assumir(conv.id, u.id); if (!r.ok) toastErr(r); } }),
        ui.btn('Reatribuir', { variant: 'secondary', size: 'sm', icon: 'arrow-left-right', disabled: !!bl || !(K.ehLider(u) || conv.responsavelId === u.id), title: bl || (K.ehLider(u) || conv.responsavelId === u.id ? null : 'Só o líder ou o responsável atual reatribui.'), onclick: () => reatribuir(conv) })));
  }
  function promoverMesa(conv) {
    let cat = 'outros'; const aviso = h('div');
    ui.modal({ title: 'Promover a chamado', subtitle: 'A conversa ganha protocolo, fila, prioridade e prazo.', icon: 'life-buoy', size: 'md',
      body: h('div.stack.tight', ui.field({ label: 'Assunto', required: true }, ui.select({ aria: 'Assunto', options: Object.entries(K.CATEGORIAS).map(([v, c]) => ({ value: v, label: c.label })), value: cat, onChange: (v) => { cat = v; } })), aviso),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Promover', { variant: 'primary', onclick: () => { const r = K.promoverAChamado(conv.id, { userId: me().id, categoria: cat }); if (!r.ok) return aviso.append(ui.callout({ tone: 'error', text: r.erro })); api.close(); C.router.go('/ops/chamados/' + r.conv.id); } })] });
  }
  function reatribuir(conv) {
    const aviso = h('div'); let fila = conv.fila; let resp = null;
    const pessoas = () => db.where('users', (x) => K.isCedy(x) && x.perfil !== 'leitor' && K.temPerm(x, 'ops.com.atender') && (x.papel === fila || x.perfil === 'admin') && x.perfil !== 'superadmin');
    const respHost = h('div'); const nota = ui.input({ type: 'textarea', rows: 3, placeholder: 'O que a próxima pessoa precisa saber: o que já foi feito, o que falta e onde olhar.' });
    const drawResp = () => { resp = null; C.mount(respHost, ui.field({ label: 'Responsável', optional: true }, ui.select({ aria: 'Responsável', options: [{ value: '', label: 'Sem responsável (a fila escolhe)' }, ...pessoas().map((x) => ({ value: x.id, label: `${x.nome} · ${cedyLabel(x)}` }))], value: '', onChange: (v) => { resp = v || null; } }))); };
    drawResp();
    ui.modal({ title: 'Reatribuir chamado', subtitle: conv.protocolo, icon: 'arrow-left-right', size: 'md',
      body: h('div.stack.tight', ui.field({ label: 'Fila', required: true }, ui.select({ aria: 'Fila', options: Object.entries(K.FILAS).map(([v, l]) => ({ value: v, label: l })), value: fila, onChange: (v) => { fila = v; drawResp(); } })), respHost, ui.field({ label: 'Nota de passagem', required: true, hint: 'Obrigatória: quem recebe precisa do contexto. Só a Cedy vê.' }, nota), aviso),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Reatribuir', { variant: 'primary', icon: 'arrow-left-right', onclick: () => { const r = K.atribuir(conv.id, { fila, responsavelId: resp, nota: nota.value }, me().id); if (!r.ok) return aviso.append(ui.callout({ tone: 'error', text: r.erro })); api.close(); ui.toast('Chamado reatribuído', { type: 'success', text: K.FILAS[fila] }); } })] });
  }

  /* ---- ações reversíveis (R1) ---- */
  const ST_ACAO = { pedida: ['Aguardando a Mesa', 'amber'], executada: ['Executada', 'green'], recusada: ['Não executada', 'neutral'], revertida: ['Revertida', 'blue'] };
  const soAdmin = (ac) => ac.acao === 'iniciar_reset_2fa' || (ac.acao === 'corrigir_cadastro' && ac.params && ac.params.campo === 'email_contato');
  function conferencias(ac, conv) {
    const sol = db.get('users', ac.pedidaPor) || {}; const list = [];
    list.push([sol.perfil !== 'leitor', `Solicitante com perfil que pode pedir: ${sol.nome} (${sol.perfil})`]);
    if (soAdmin(ac)) list.push([sol.perfil === 'admin', 'Ação sensível: só vale se pedida por administrador']);
    const alvo = ac.params && ac.params.alvo; let ok = true;
    if (['reenviar_convite', 'iniciar_reset_2fa'].includes(ac.acao) && alvo) { const id = String(alvo).split(':').pop(); const x = db.get('users', id) || db.get('convites', id); ok = !!x && (x.orgId === sol.orgId || x.origId === sol.orgId); }
    list.push([ok, 'O alvo pertence à empresa de quem pediu']);
    list.push([true, 'Ação reversível, de classe R1, dentro da lista fechada']);
    return list;
  }
  function antesDepois(ac) {
    const rows = []; const a = ac.antes || {}; const d = ac.depois || {};
    [...new Set([...Object.keys(a), ...Object.keys(d)])].forEach((k) => { const f = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? (v.expiraEm ? 'redefinição iniciada' : JSON.stringify(v)) : typeof v === 'number' && v > 1e12 ? fmt.datetime(v) : Array.isArray(v) ? v.join(', ') : String(v)); rows.push([k, `${f(a[k])}  →  ${f(d[k])}`]); });
    return rows.length ? ui.kv(rows) : null;
  }
  function cardAcoes(conv) {
    const lista = K.acoesDe(conv.id).filter((a) => a.acao); const bl = bloqueio(conv);
    if (!lista.length) return null;
    return ui.card({ title: 'Pedidos de ação', subtitle: 'Só a lista fechada de ações reversíveis. Cada execução guarda quem pediu, a mensagem (hash) e o antes e depois.' },
      lista.map((ac) => {
        const def = K.ACOES[ac.acao]; const st = ST_ACAO[ac.status] || [ac.status, 'neutral']; const sol = db.get('users', ac.pedidaPor) || {};
        const titulo = def ? def.label : ((K.FORA_DA_LISTA.find((f) => f.id === ac.acao) || {}).titulo || ac.acao);
        return h('div.cm2-acao', h('div.cm2-acao-h', h('strong', titulo), ui.badge(st[0], st[1], { dot: true })),
          h('small.muted', `Pedido por ${sol.nome} (${sol.perfil}) · ${fmt.rel(ac.ts)} · mensagem `, h('span.mono', String(ac.msgHash || '').slice(0, 8))),
          ac.codigo === 'FLUXO_FORMAL' ? h('small', icon('shield-check', 12), ' Fora da lista: o cliente foi orientado a usar o fluxo seguro. Nada foi executado.') : null,
          ac.status === 'pedida' ? h('ul.cm2-checks', conferencias(ac, conv).map(([ok, t]) => h('li', { class: !ok && 'is-bad' }, icon(ok ? 'circle-check' : 'circle-alert', 13), t))) : null,
          ac.status === 'executada' || ac.status === 'revertida' ? antesDepois(ac) : null,
          ac.motivoRecusa ? h('small.muted', 'Motivo: ' + ac.motivoRecusa) : null,
          ac.status === 'pedida' ? h('div.row.wrap', ui.btn('Executar', { size: 'sm', variant: 'primary', icon: 'play', disabled: !!bl || !conferencias(ac, conv).every((x) => x[0]), title: bl, onclick: () => { const r = K.executarR1(ac.id, me().id); r.ok ? ui.toast('Ação executada', { type: 'success', text: 'Os administradores da empresa foram avisados. Pode ser revertida.' }) : toastErr(r); } }),
            ui.btn('Não executar', { size: 'sm', variant: 'secondary', disabled: !!bl, onclick: () => recusarAcao(ac) })) : null,
          ac.status === 'executada' ? h('div.row.wrap', ui.btn('Reverter', { size: 'sm', variant: 'secondary', icon: 'rotate-ccw', disabled: !!bl, onclick: async () => { if (!(await ui.confirm({ title: 'Reverter a ação?', text: 'O estado anterior é restaurado e o cliente vê o registro no chamado.', confirmLabel: 'Reverter' }))) return; const r = K.reverterAcao(ac.id, me().id); r.ok ? ui.toast('Ação revertida', { type: 'success' }) : toastErr(r); } })) : null);
      }));
  }
  function recusarAcao(ac) {
    const motivo = ui.input({ type: 'textarea', rows: 3, placeholder: 'Explique ao cliente por que não foi executado.' }); const aviso = h('div');
    ui.modal({ title: 'Não executar o pedido', icon: 'ban', size: 'md', body: h('div.stack.tight', ui.field({ label: 'Motivo (o cliente vê)', required: true }, motivo), aviso),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Registrar', { variant: 'primary', onclick: () => { const r = K.recusarAcao(ac.id, motivo.value, me().id); if (!r.ok) return aviso.append(ui.callout({ tone: 'error', text: r.erro })); api.close(); } })] });
  }

  /* ---- notas internas, passagem e histórico ---- */
  function cardNotas(conv) {
    const bl = bloqueio(conv); const area = ui.input({ type: 'textarea', rows: 2, placeholder: 'Nota interna (o cliente não vê)', value: rascunhos[conv.id] || '', onInput: (v) => { rascunhos[conv.id] = v; } });
    const notas = K.notas(conv.id);
    return ui.card({ title: 'Notas internas da Mesa', subtitle: 'Invisíveis ao cliente. Quem lê segue o papel.' },
      notas.length ? notas.map((n) => h('div.cm-nota', h('strong', userName(n.autorId)), n.tipo === 'passagem' ? ui.badge('Passagem', 'violet') : null, h('small', fmt.rel(n.ts)), h('p', n.texto))) : h('small.muted', 'Nenhuma nota ainda.'),
      area, h('div.row.end', ui.btn('Adicionar nota', { size: 'sm', variant: 'secondary', icon: 'plus', disabled: !!bl, title: bl, onclick: () => { const r = K.nota(conv.id, me().id, area.value); if (!r.ok) return toastErr(r); area.value = ''; rascunhos[conv.id] = ''; } })));
  }
  function cardHistorico(conv) {
    const hs = (conv.historico || []).slice().reverse(); if (!hs.length) return null;
    const txt = (e) => ({ status: `Status: ${K.STATUS_CHAMADO[e.de] || e.de} para ${K.STATUS_CHAMADO[e.para] || e.para}`, assumiu: 'Assumiu o chamado', reatribuiu: `Reatribuiu para ${K.FILAS[e.para.fila] || ''}${e.para.responsavelId ? ' · ' + userName(e.para.responsavelId) : ''}` }[e.acao] || e.acao);
    return ui.card({ title: 'Histórico de quem assumiu' }, ui.timeline(hs.map((e) => ({ icon: 'history', title: txt(e), actor: userName(e.userId), ts: e.ts }))));
  }
  const mesaSide = (conv) => [cardEmpresa(conv), cardAtendimento(conv), conv.tipo === 'chamado' && UI.agentePanel ? UI.agentePanel(conv) : null, conv.tipo === 'chamado' ? cardAcoes(conv) : null, cardNotas(conv), cardHistorico(conv)].filter(Boolean);

  function mesaThread(ctx) {
    let replyStatus = 'em_atendimento';
    const statusSel = () => ui.select({ aria: 'Status depois de enviar', options: [{ value: 'em_atendimento', label: 'Depois: em atendimento' }, { value: 'aguardando_cliente', label: 'Depois: aguardando o cliente' }, { value: 'resolvido', label: 'Depois: resolvido' }], value: replyStatus, onChange: (v) => { replyStatus = v; } });
    const conv = db.get('conversas', ctx.params.id);
    const chamado = conv && conv.tipo === 'chamado';
    return UI.threadPage(ctx, { cedy: true, voltar: conv && conv.canal !== 'cedy' ? '/ops/comunicacao' : '/ops/chamados', status: chamado ? () => replyStatus : null, extras: chamado ? statusSel : null, side: (c) => [ui.live(['conversas', 'notasCedy', 'acoesChamado', 'users'], () => { const cc = db.get('conversas', c.id) || c; return h('div.stack', mesaSide(cc)); })] });
  }

  /** botão "Conversar com a empresa" nas telas da Mesa: abre ou cria a conversa ancorada no item */
  function btnConversarMesa(ancora, o = {}) {
    const u = me();
    return ui.btn(o.label || 'Conversar com a empresa', { variant: o.variant || 'secondary', size: o.size || 'md', icon: 'messages-square', disabled: !K.temPerm(u, 'ops.com.atender'), title: K.temPerm(u, 'ops.com.atender') ? null : 'Seu papel não atende conversas com clientes.', onclick: () => {
      const info = K.ancoraInfo(ancora, u); const org = (info && (info.cedenteId || (info.orgs || [])[0])) || null;
      const ex = db.all('conversas').find((c) => c.canal === 'cedy' && c.tipo === 'item' && c.ancora && c.ancora.kind === ancora.kind && c.ancora.id === ancora.id);
      if (ex) return C.router.go(K.rotaConversa(ex, u.id));
      const r = K.abrirConversa({ userId: u.id, canal: 'cedy', ancora: Object.assign({}, ancora, { label: o.rotulo }), titulo: o.rotulo, contraOrgId: org }); if (!r.ok) return toastErr(r);
      C.router.go(K.rotaConversa(r.conv, u.id));
    } });
  }
  UI.btnConversarMesa = btnConversarMesa;
  /** pedido de informação da Mesa ao cliente: vira mensagem na conversa ancorada no item (ex.: lote, caso), com registro */
  UI.pedirInformacao = function ({ ancora, rotulo, orgId, texto }) {
    const u = me();
    let conv = db.all('conversas').find((c) => c.canal === 'cedy' && c.tipo === 'item' && c.ancora && c.ancora.kind === ancora.kind && c.ancora.id === ancora.id);
    if (!conv) { const r = K.abrirConversa({ userId: u.id, canal: 'cedy', ancora: Object.assign({}, ancora, { label: rotulo }), titulo: rotulo, contraOrgId: orgId }); if (!r.ok) return r; conv = r.conv; }
    const m = K.enviar({ convId: conv.id, userId: u.id, texto });
    if (!m.ok) return m;
    return { ok: true, conv, rota: K.rotaConversa(conv, u.id) };
  };

  C.router.register([
    { path: '/ops/chamados', roles: ['ops'], title: 'Chamados', render: pgChamados },
    { path: '/ops/chamados/:id', roles: ['ops'], title: 'Chamado', render: mesaThread },
    { path: '/ops/mensagens/:id', roles: ['ops'], title: 'Conversa', render: mesaThread },
  ]);
})();
