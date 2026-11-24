/* =========================================================================
   Cedy, Central de Comunicação (telas dos perfis cliente e componentes
   compartilhados com a Mesa): caixa de entrada, sino, conversa, novo
   chamado, pedido de ação e botão "Conversar". Prefixo CSS: cm-.
   Regras de negócio ficam em E.com (core/com.js); aqui só apresentação.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session, notify } = C.store;
  const E = C.engine; const K = E.com;
  const me = () => session.user();
  const meId = () => (session.get() || {}).userId;
  const TONE = { critica: 'red', normal: 'blue', baixa: 'neutral' };
  const TIPO_LABEL = Object.fromEntries(K.TIPOS_FEED.map((t) => [t.id, t.label]));
  const day = (ts) => C.cal.key(ts);

  /* ------------------------------ peças pequenas ------------------------------ */
  const prioBadge = (p) => ui.badge(K.PRIORIDADES[p] || p, TONE[p] || 'neutral', { dot: true });
  const statusBadge = (s) => ui.badge(K.STATUS_CHAMADO[s] || s, { aberto: 'blue', em_atendimento: 'teal', aguardando_cliente: 'amber', resolvido: 'green', encerrado: 'neutral' }[s] || 'neutral', { dot: true });
  /** prazo de resposta da Cedy: contagem regressiva, pausado, ou estourado */
  function slaChip(conv) {
    if (conv.tipo !== 'chamado') return null;
    if (['resolvido', 'encerrado'].includes(conv.status)) return null;
    if (conv.slaPausado || conv.status === 'aguardando_cliente') return ui.badge('Prazo pausado: aguardando o cliente', 'amber', { icon: 'hourglass' });
    if (!conv.slaAte) return ui.badge('Respondido', 'green', { icon: 'check' });
    return ui.countdown(conv.slaAte, { prefix: 'responde em', endLabel: 'prazo vencido', warnMs: 30 * 60e3, class: 'cm-sla' });
  }
  const tamanho = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
  const ICONE_ARQ = { pdf: 'file-text', xml: 'file', png: 'image', jpg: 'image', jpeg: 'image', xlsx: 'file-spreadsheet', xls: 'file-spreadsheet', csv: 'file-spreadsheet' };
  const goConv = (conv) => C.router.go(K.rotaConversa(conv, meId()));
  const rascunhos = {}; // rascunhos de notas por conversa: sobrevivem ao redesenho do painel

  /* ----------------------------- e-mail simulado ----------------------------- */
  function emailPreview(n) {
    const em = K.emailSimulado(n, me());
    ui.modal({ title: 'E-mail simulado', subtitle: 'As obrigatórias também chegam por e-mail. Aqui está o que seria enviado.', icon: 'mail', size: 'md',
      body: h('div.stack.tight',
        ui.callout({ tone: 'info', text: 'Simulação do protótipo: nenhum e-mail foi enviado. O e-mail real não traz valores nem dados sensíveis, só um aviso e o caminho de volta ao app.' }),
        h('div.cm-mail',
          ui.kv([['De', em.de], ['Para', em.para], ['Assunto', em.assunto], ['Enviado', fmt.datetime(em.enviadoEm)]]),
          h('hr.divider'), h('p', em.corpo), h('p.mono.small', em.link))),
      footer: (api) => [ui.btn('Fechar', { variant: 'primary', onclick: () => api.close() })] });
  }

  /* ------------------------------ linha da caixa ------------------------------ */
  function openRow(r, close) {
    if (close) close();
    if (r.kind === 'notif') { notify.read(r.id); }
    if (r.kind === 'comunicado' && C.comUI.abrirComunicado) return C.comUI.abrirComunicado(r.comunicado);
    if (r.link) C.router.go(r.link);
  }
  function feedRow(r, o = {}) {
    const n = r.notif;
    const tags = [
      !o.compact && h('span.cm-tipo', TIPO_LABEL[r.tipo]),
      r.precisa && ui.badge('Precisa de você', 'amber', { dot: true }),
      r.conv && r.conv.tipo === 'chamado' && r.conv.prioridade === 'critica' && ui.badge('Crítica', 'red', { dot: true }),
      r.conv && r.conv.slaAte && K.slaEstourado(r.conv) && ui.badge('Prazo vencido', 'red', { icon: 'timer' }),
      n && n.classe === 'obrigatoria' && (n.canal || []).includes('email_simulado') && h('button', { type: 'button', class: 'cm-mailchip', 'aria-label': 'Ver o e-mail simulado desta notificação', onclick: (e) => { e.stopPropagation(); emailPreview(n); } }, icon('mail', 12), 'E-mail simulado'),
    ].filter(Boolean);
    return h('div', { class: ['cm-row', r.naoLida && 'is-unread', r.precisa && 'is-need', o.compact && 'is-compact'], role: 'button', tabindex: 0, 'aria-label': r.titulo + (r.naoLida ? ', não lida' : ''),
      onclick: () => openRow(r, o.close), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(r, o.close); } } },
      h('span', { class: ['cm-row-ic', 'tone-' + r.tom] }, icon(r.icone, 16)),
      h('span.cm-row-t', h('span.cm-row-top', h('strong', r.titulo), tags), r.previa && h('small.cm-row-pre', r.previa), r.ancora && h('small.cm-row-anc', icon('link', 11), r.ancora)),
      h('span.cm-row-r', h('time', fmt.rel(r.ts)), r.qtd ? h('i.cm-dot', r.qtd) : (r.naoLida ? h('i.cm-dot.is-plain') : null)));
  }
  const TOPICOS = ['conversas', 'mensagens', 'notifs', 'comunicados', 'ciencias', 'alertasContato', 'aprovacoes', 'session', 'users'];

  /* --------------------------------- sino ------------------------------------ */
  /** resumo das últimas 8 sem filtros, com "Ver todas" (CC-31) */
  function bell(close) {
    return ui.live(TOPICOS, () => {
      const u = me(); if (!u) return h('div');
      const feed = K.feed(u.id); const rows = feed.slice(0, 8); const c = K.contadores(u.id);
      const ficam = feed.filter((i) => i.precisa && !i.naoLida).length;
      return h('div.notif.cm-bell',
        h('div.notif-head', h('strong', 'Mensagens e avisos'), h('span.notif-head-r', ui.btn('Marcar todas como lidas', { variant: 'ghost', size: 'sm', onclick: () => K.marcarTodasLidas(u.id) }))),
        rows.length ? h('div.notif-list.cm-bell-list', rows.map((r) => feedRow(r, { compact: true, close }))) : ui.empty({ icon: 'bell', title: 'Tudo em dia', text: 'Quando algo acontecer nas suas operações, avisamos aqui.' }),
        h('div.cm-bell-foot', c.precisa ? h('small.muted', `${fmt.plural(c.precisa, 'item precisa', 'itens precisam')} de você. Avisos obrigatórios com ação pendente não saem até você agir.`) : (ficam ? null : h('small.muted', 'Mostrando as últimas 8.')),
          ui.link(`Ver todas (${fmt.num(c.total)})`, K.base(u) === '/super' ? '/ops/mensagens' : (K.isCedy(u) ? '/ops/mensagens' : K.base(u) + '/mensagens'), { onclick: () => close && close(), class: 'cm-bell-all' })));
    });
  }

  /* ------------------------------ caixa de entrada --------------------------- */
  function pgInbox(ctx) {
    const u = me(); const cedy = K.isCedy(u);
    let sel = new Set((ctx.query.t || '').split(',').filter(Boolean)); if (ctx.query.f === 'precisa') sel.add('precisa');
    let q = ''; let periodo = 'tudo';
    const periodos = { tudo: Infinity, hoje: 1, '7d': 7, '30d': 30 };
    const search = ui.search({ placeholder: 'Buscar por assunto, protocolo ou item', onInput: (v) => { q = String(v).trim().toLowerCase(); redraw(); } });
    const per = ui.select({ aria: 'Período', options: [{ value: 'tudo', label: 'Todo o período' }, { value: 'hoje', label: 'Hoje' }, { value: '7d', label: 'Últimos 7 dias' }, { value: '30d', label: 'Últimos 30 dias' }], value: 'tudo', onChange: (v) => { periodo = v; redraw(); } });
    const chipsHost = h('div.cm-chips'); const listHost = h('div.cm-list');
    function filtrar(rows) {
      const tipos = [...sel].filter((x) => x !== 'precisa');
      if (tipos.length) rows = rows.filter((r) => tipos.includes(r.tipo));
      if (sel.has('precisa')) rows = rows.filter((r) => r.precisa);
      if (periodo !== 'tudo') { const lim = periodo === 'hoje' ? C.cal.startOfDay(C.clock.now()) : C.clock.now() - periodos[periodo] * 86400000; rows = rows.filter((r) => r.ts >= lim); }
      if (q) rows = rows.filter((r) => (r.titulo + ' ' + (r.previa || '') + ' ' + (r.ancora || '')).toLowerCase().includes(q));
      return rows;
    }
    function redraw() {
      const feed = K.feed(u.id); const c = K.contadores(u.id);
      const opts = [...K.tiposPara(u).map((t) => ({ value: t.id, label: t.label, icon: t.icon, count: c.por[t.id] || undefined })), { value: 'precisa', label: 'Precisa de você', icon: 'circle-alert', count: c.precisa || undefined }];
      C.mount(chipsHost, ui.chips({ aria: 'Filtrar por tipo', options: opts, value: [...sel], onChange: (v) => { sel = new Set(v); redraw(); } }));
      const rows = filtrar(feed);
      C.clear(listHost);
      if (!rows.length) {
        const ctp = [...sel].filter((x) => x !== 'precisa');
        listHost.append(ui.card({}, ui.empty({ icon: 'inbox', title: feed.length ? 'Nada com esses filtros' : 'Nenhuma mensagem ainda', text: ctp.includes('informativas') && !feed.some((r) => r.tipo === 'informativas') ? 'Informativas são opt-in: ative os temas em Configurações > Notificações.' : feed.length ? 'Remova um filtro para ver mais.' : 'Conversas, chamados, comunicados e avisos aparecem aqui, em ordem cronológica.' })));
        return;
      }
      const hoje = day(C.clock.now()), ontem = day(C.clock.now() - 86400000); const grupos = [['Hoje', []], ['Ontem', []], ['Esta semana', []], ['Anteriores', []]];
      rows.forEach((r) => { const k = day(r.ts); grupos[k === hoje ? 0 : k === ontem ? 1 : C.clock.now() - r.ts < 7 * 86400000 ? 2 : 3][1].push(r); });
      grupos.forEach(([lab, arr]) => { if (arr.length) listHost.append(h('div.sh-day', lab + ' · ' + arr.length), ui.card({ flush: true, class: 'cm-card' }, arr.map((r) => feedRow(r)))); });
    }
    const live = ui.live(TOPICOS, () => { redraw(); return [chipsHost, listHost]; });
    const podeAbrir = !cedy && u.perfil !== 'leitor';
    return h('div.sh-page.cm-page',
      ui.pageHeader({ eyebrow: 'Central de comunicação', title: 'Mensagens', subtitle: cedy ? 'Conversas, chamados e avisos da Mesa, em ordem cronológica.' : 'Conversas, chamados, comunicados e avisos, em ordem cronológica. Sem filtro por padrão.',
        actions: [ui.btn('Marcar todas como lidas', { variant: 'secondary', icon: 'check-check', onclick: () => K.marcarTodasLidas(u.id) }), !cedy && ui.btn('Relacionamentos bloqueados', { variant: 'ghost', icon: 'ban', onclick: () => C.comUI.abrirBloqueios && C.comUI.abrirBloqueios() }), podeAbrir && ui.btn('Novo chamado', { variant: 'primary', icon: 'plus', onclick: () => openNovoChamado() })].filter(Boolean) }),
      !cedy && u.perfil === 'leitor' ? ui.callout({ tone: 'info', title: 'Perfil leitor', text: 'Você lê as conversas e avisos da empresa, mas não escreve nem abre chamados.' }) : null,
      h('div.toolbar.cm-toolbar', search, per),
      live);
  }

  /* --------------------------------- conversa -------------------------------- */
  function msgNode(m, conv, viewer) {
    const a = m.autor; const meu = viewer && a.id === viewer.id; const quem = K.autorExibido(m, conv, viewer);
    if (a.tipo === 'sistema') {
      const ac = m.acao;
      return h('div.cm-sys', h('span.cm-sys-ic', icon(ac && ac.codigo === 'FLUXO_FORMAL' ? 'shield-check' : 'info', 14)), h('div.cm-sys-b', h('span', m.texto),
        ac && ac.codigo === 'FLUXO_FORMAL' ? ui.btn('Ir para o fluxo seguro', { size: 'sm', variant: 'secondary', icon: 'external-link', onclick: () => C.router.go(ac.rota) }) : null,
        h('time', fmt.time(m.ts))));
    }
    if (m.bloqueada) {
      const veOculta = meu || (K.isCedy(viewer) && K.temPerm(viewer, 'ops.com.moderar'));
      if (!veOculta) return null;
      return h('div', { class: ['cm-msg', meu && 'is-own'] }, h('div.cm-bubble.is-blocked', h('div.cm-bubble-h', h('strong', quem.nome), ui.badge('Mensagem não enviada', 'red', { icon: 'ban' })), h('p.cm-text', m.texto), h('small', 'Contém contato externo (' + m.bloqueada.achados.map((x) => x.padrao).join(', ') + '). Só você e o compliance veem esta tentativa.')));
    }
    const redigida = m.redigida;
    const ex = m.estruturada && h('span.cm-struct', icon('list-checks', 13), 'Mensagem de modelo');
    return h('div', { class: ['cm-msg', meu && 'is-own', 'tom-' + quem.tom] },
      !meu && ui.avatar(quem.nome, { size: 'sm' }),
      h('div.cm-bubble', h('div.cm-bubble-h', h('strong', quem.nome), quem.tom === 'ia' ? ui.ai('IA') : null, h('span.cm-sub', quem.sub), h('time', { title: fmt.datetime(m.ts) }, fmt.time(m.ts)), h('span.cm-hash', { title: 'Registro imutável. Código ' + m.hash }, icon('lock', 11)), ...(C.comUI.msgAcoes ? C.comUI.msgAcoes(m, conv, viewer) : [])),
        redigida ? h('p.cm-text.is-redigida', icon('eraser', 13), `Conteúdo redigido pela Cedy em ${fmt.date(redigida.ts)}. Motivo: ${redigida.motivo}`) : h('p.cm-text', ex, m.texto),
        !redigida && m.anexos && m.anexos.length ? h('div.cm-files', m.anexos.map((x) => h('span.cm-file', icon(ICONE_ARQ[x.tipo] || 'file', 14), h('span', x.nome), h('small', tamanho(x.tamanho)), x.pii ? ui.badge('dado pessoal', 'amber') : null, x.varredura === 'limpo' ? h('small.cm-scan', icon('shield-check', 11), 'varrido') : null))) : null,
        !redigida && C.comUI.msgFonte ? C.comUI.msgFonte(m) : null));
  }
  function listaMensagens(conv, viewer) {
    const out = []; let ultimo = null; const ms = K.mensagens(conv.id);
    ms.forEach((m) => { const n = msgNode(m, conv, viewer); if (!n) return; const d = day(m.ts); if (d !== ultimo) { ultimo = d; out.push(h('div.cm-day', fmt.dateLong(m.ts))); } out.push(n); });
    return out;
  }

  /** compositor: texto ancorado ou mensagem de modelo, com anexo e marcação de dado pessoal */
  function composer(conv, u, o = {}) {
    const pode = K.podeEscrever(conv, u);
    if (!pode.ok) return h('div.cm-composer.is-off', icon('lock', 16), h('span', pode.motivo));
    const estruturada = pode.lado !== 'cedy' && ['esclarecimentos', 'cedente_sacado', 'orig_indicado'].includes(conv.canal);
    const aviso = h('div'); let arquivos = []; const filesBox = h('div.cm-files.is-draft');
    const pii = ui.checkbox({ label: 'Contém dado pessoal sensível', hint: 'Fica retido: o agente de IA não lê.' });
    const input = h('input', { type: 'file', multiple: true, 'aria-hidden': 'true', tabindex: '-1', style: 'display:none', onchange: () => { [...input.files].forEach((f) => arquivos.push({ nome: f.name, tamanho: f.size })); input.value = ''; drawFiles(); } });
    function drawFiles() { C.mount(filesBox, arquivos.map((a, i) => h('span.cm-file', icon(ICONE_ARQ[(a.nome.split('.').pop() || '').toLowerCase()] || 'file', 14), h('span', a.nome), h('small', tamanho(a.tamanho)), h('button', { type: 'button', 'aria-label': 'Remover ' + a.nome, onclick: () => { arquivos.splice(i, 1); drawFiles(); } }, icon('x', 12))))); filesBox.hidden = !arquivos.length; piiRow.hidden = !arquivos.length; }
    const piiRow = h('div.cm-pii', pii); piiRow.hidden = true;
    const area = ui.input({ type: 'textarea', rows: 2, placeholder: o.placeholder || (conv.canal === 'interna' ? 'Escreva uma nota para a sua equipe (a contraparte e a Cedy não veem)' : 'Escreva a mensagem. Ctrl+Enter envia.'), aria: 'Mensagem', value: rascunhos['c:' + conv.id] || '', onInput: (v) => { rascunhos['c:' + conv.id] = v; } });
    const lista = estruturada ? [...K.modelosDe(conv.canal).map((m) => ({ value: m.id, label: m.label, group: 'Perguntar' })), ...K.MODELOS.respostas.map((m) => ({ value: m.id, label: m.label, group: 'Responder' }))] : [];
    let modelo = lista[0] && lista[0].value; let valor = null; const valorHost = h('div');
    const selModelo = estruturada ? ui.select({ aria: 'Tipo de mensagem', options: lista, value: modelo, onChange: (v) => { modelo = v; valor = null; drawValor(); } }) : null;
    function drawValor() {
      const def = K.modelosDe(conv.canal).find((m) => m.id === modelo);
      C.mount(valorHost, def && def.campo ? ui.field({ label: def.campo.label }, ui.select({ aria: def.campo.label, options: def.campo.opcoes.map((x) => ({ value: x, label: x })), value: valor, placeholder: 'Escolha uma opção', onChange: (v) => { valor = v; } })) : null);
    }
    if (estruturada) drawValor();
    const sendBtn = ui.btn('Enviar', { variant: 'primary', icon: 'send', onclick: enviar });
    let avisoT = 0;
    /** aviso do compositor: tem botão de fechar e some sozinho */
    function mostrarAviso(tone, title, text) {
      C.clear(aviso); clearTimeout(avisoT);
      aviso.append(h('div.cm-aviso', ui.callout({ tone, title, text }), h('button', { type: 'button', class: 'cm-aviso-x', 'aria-label': 'Fechar aviso', onclick: () => { clearTimeout(avisoT); C.clear(aviso); } }, icon('x', 14))));
      avisoT = setTimeout(() => C.clear(aviso), 12000);
    }
    function enviar() {
      C.clear(aviso);
      const payload = { convId: conv.id, userId: u.id, anexos: arquivos.map((a) => ({ nome: a.nome, tamanho: a.tamanho, pii: !!pii.value })) };
      if (estruturada) payload.estruturada = { modelo, valor }; else payload.texto = area.value;
      if (o.status) payload.status = o.status();
      const r = K.enviar(payload);
      if (!r.ok) { mostrarAviso(r.codigo === 'CONTATO_EXTERNO' ? 'warn' : 'error', r.codigo === 'CONTATO_EXTERNO' ? 'Mensagem não enviada' : 'Não foi possível enviar', r.erro); return; }
      area.value = ''; rascunhos['c:' + conv.id] = ''; arquivos = []; drawFiles(); if (o.aposEnviar) o.aposEnviar(r);
    }
    if (!estruturada) area.input.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); enviar(); } });
    if (o.onReady) o.onReady({ setTexto: (t) => { area.value = t; rascunhos['c:' + conv.id] = t; area.input.focus(); }, getTexto: () => area.value });
    const dica = conv.canal === 'interna' ? null : BLOQ.includes(conv.canal) || conv.canal === 'cedy' ? h('small.cm-hint', icon('shield-check', 12), BLOQ.includes(conv.canal) ? 'Não escreva telefone, e-mail, link ou usuário de rede social: a mensagem é bloqueada e a Cedy é avisada.' : 'Esta conversa é registrada. Não envie senha nem código de 2FA.') : null;
    return h('div.cm-composer', aviso,
      estruturada ? h('div.cm-struct-box', h('small.cm-hint', icon('list-checks', 12), 'Neste canal só há mensagens de modelo, escolhidas em lista. Texto livre só depois do aceite.'), ui.field({ label: 'Mensagem' }, selModelo), valorHost) : area,
      filesBox, piiRow,
      h('div.cm-composer-bar', o.extras ? o.extras() : null, h('span.cm-grow'), ui.btn('Anexar', { variant: 'ghost', size: 'sm', icon: 'paperclip', onclick: () => input.click() }), input, sendBtn), dica);
  }
  const BLOQ = ['esclarecimentos', 'pos_aceite', 'cedente_sacado', 'orig_indicado', 'orig_sub'];

  /** notas internas da empresa (CC-21): conversa "interna" presa à conversa, invisível à contraparte e à Cedy */
  function notasEquipe(conv, u) {
    const ex = () => db.all('conversas').find((c) => c.canal === 'interna' && c.ancora && c.ancora.kind === 'conversa' && c.ancora.id === conv.id && c.orgIds.includes(u.orgId));
    const lista = ui.live(['mensagens', 'conversas'], () => { const c = ex(); const ms = c ? K.mensagens(c.id) : []; return ms.length ? ms.map((m) => h('div.cm-nota', h('strong', m.autor.nome), h('small', fmt.rel(m.ts)), h('p', m.texto))) : h('small.muted', 'Nenhuma nota ainda.'); });
    const podeEscrever = u.perfil !== 'leitor' && !K.isCedy(u);
    const area = ui.input({ type: 'textarea', rows: 2, placeholder: 'Nota para a equipe', value: rascunhos[conv.id] || '', onInput: (v) => { rascunhos[conv.id] = v; } });
    const add = () => {
      const t = String(area.value).trim(); if (!t) return;
      let c = ex(); if (!c) { const r = K.abrirConversa({ userId: u.id, canal: 'interna', ancora: { kind: 'conversa', id: conv.id, label: conv.titulo }, titulo: 'Notas da equipe: ' + conv.titulo }); if (!r.ok) return ui.toast('Não foi possível salvar', { type: 'error', text: r.erro }); c = r.conv; }
      const r2 = K.enviar({ convId: c.id, userId: u.id, texto: t }); if (!r2.ok) return ui.toast('Não foi possível salvar', { type: 'error', text: r2.erro });
      area.value = ''; rascunhos[conv.id] = '';
    };
    return ui.card({ title: 'Notas da sua equipe', subtitle: 'Só quem é da sua empresa vê. A contraparte e a Cedy não leem.' }, lista, podeEscrever ? [area, h('div.row.end', ui.btn('Adicionar nota', { size: 'sm', variant: 'secondary', icon: 'plus', onclick: add }))] : null);
  }

  function infoPanel(conv, u, o) {
    const info = K.ancoraInfo(conv.ancora, u); const cliente = !K.isCedy(u);
    const contra = conv.orgIds.filter((x) => x !== u.orgId).map((x) => K.nomeOrg(x));
    const exp = K.expediente();
    const linhas = [
      ['Conversa com', conv.canal === 'cedy' ? (K.isCedy(u) ? K.nomeOrg(conv.orgIds[0]) : 'Cedy') : conv.canal === 'esclarecimentos' ? (K.isCedy(u) ? 'Financiadores da operação (anônimos)' : u.perfil && C.keyOfUser(u, db.get('orgs', u.orgId)) === 'financiador' ? 'Cedente (identidade protegida até o aceite)' : 'Financiadores da operação (anônimos)') : (contra.join(', ') || 'Sua equipe')],
      conv.protocolo ? ['Protocolo', h('span.mono', conv.protocolo)] : null,
      conv.categoria ? ['Assunto', (K.CATEGORIAS[conv.categoria] || {}).label] : null,
      conv.tipo === 'chamado' ? ['Prioridade', h('span', prioBadge(conv.prioridade), conv.prioridadeMotivo ? h('small', ' ' + conv.prioridadeMotivo) : null)] : null,
      conv.tipo === 'chamado' ? ['Status', statusBadge(conv.status)] : null,
      conv.tipo === 'chamado' && slaChip(conv) ? ['Prazo de resposta', slaChip(conv)] : null,
      conv.tipo === 'chamado' && o.cedy ? ['Fila', K.FILAS[conv.fila]] : null,
      ['Aberta em', fmt.datetime(conv.criadaEm)],
    ].filter(Boolean);
    const aviso = ui.callout({ tone: 'info', icon: 'lock', title: 'Esta conversa é registrada', text: 'Fica na plataforma, com registro imutável, e pode ser lida pela Cedy conforme o papel de cada pessoa.' });
    const foraExp = conv.tipo === 'chamado' && !exp.aberto && ['aberto', 'em_atendimento'].includes(conv.status) ? ui.callout({ tone: 'warn', icon: 'clock', title: 'Fora do expediente', text: `A Mesa atende de segunda a sexta, das ${exp.ini}h às ${exp.fim}h. Atendimento a partir de ${fmt.datetime(exp.proximo)}.${conv.prioridade === 'critica' ? ' Como o chamado é crítico, o líder da Mesa e o plantão (simulado) foram avisados, mas não prometemos prazo fora do horário.' : ''}` }) : null;
    const urg = conv.urgentePedido ? ui.callout({ tone: 'info', icon: 'timer', title: 'Urgência pedida', text: 'A Mesa confirma se o caso atende à regra de prioridade crítica.' }) : null;
    const detalhes = ui.card({ title: info ? info.label : 'Detalhes' }, ui.kv(linhas), info && info.rota ? ui.btn('Abrir o item', { variant: 'secondary', size: 'sm', icon: 'external-link', route: info.rota }) : null);
    if (o.cedy && BLOQ.includes(conv.canal)) return h('aside.cm-side', ui.callout({ tone: 'warn', icon: 'eye', title: 'Conversa entre clientes', text: 'Leitura com acesso registrado e motivo. A Cedy não escreve nesta conversa. Para ocultar um conteúdo, use a borracha na mensagem (compliance e líder).' }), detalhes);
    if (o.cedy) return h('aside.cm-side', ...(o.side ? o.side(conv) : []), detalhes, foraExp);
    const acs = cliente && BLOQ.includes(conv.canal) ? K.acessosDaConversa(conv.id) : [];
    const acessosAviso = acs.length ? ui.callout({ tone: 'warn', icon: 'eye', title: 'A Cedy leu esta conversa', text: h('ul.cm-acessos', acs.slice(0, 4).map((a) => h('li', `${fmt.date(a.ts)} · ${a.papel}: ${a.motivo}`))) }) : null;
    const leituraCedy = !cliente && BLOQ.includes(conv.canal) ? ui.callout({ tone: 'warn', icon: 'eye', title: 'Conversa entre clientes', text: 'Leitura com acesso registrado e motivo. A Cedy não escreve nesta conversa.' }) : null;
    return h('aside.cm-side', leituraCedy, detalhes, urg, foraExp, acessosAviso, aviso, ...(o.side ? o.side(conv) : []), cliente ? notasEquipe(conv, u) : null);
  }

  /** página de conversa; opts: {cedy, side(conv)=>Node[], status(), extras(), voltar} */
  function threadPage(ctx, opts = {}) {
    const u = me(); const conv0 = db.get('conversas', ctx.params.id);
    const acesso = conv0 && K.acesso(conv0, u);
    const base = K.isCedy(u) ? '/ops' : K.base(u);
    if (!conv0 || !acesso || (acesso === 'motivo' && !K.acessoLiberado(conv0.id, u.id))) {
      if (acesso === 'motivo' && C.comUI.gateMotivo) return C.comUI.gateMotivo(conv0, ctx, () => C.router.resolve());
      return h('div.sh-page', ui.pageHeader({ title: 'Conversa não encontrada', back: base + '/mensagens' }), ui.empty({ icon: 'lock', title: 'Sem acesso a esta conversa', text: 'Ela não existe ou o seu perfil não participa dela.', action: ui.btn('Voltar às mensagens', { route: base + '/mensagens' }) }));
    }
    const area = h('div.cm-msgs', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Mensagens da conversa' });
    const draw = () => {
      const conv = db.get('conversas', conv0.id) || conv0; const perto = innerHeight + scrollY >= document.documentElement.scrollHeight - 200;
      const nodes = listaMensagens(conv, u);
      C.mount(area, nodes.length ? nodes : h('div.cm-vazio', icon('messages-square', 22), h('strong', 'Sem mensagens ainda'), h('small', 'Escreva a primeira mensagem abaixo.')));
      if (conv.digitando && conv.digitando.ate > Date.now()) area.append(h('div.cm-typing', ui.avatar(conv.digitando.nome, { size: 'sm' }), h('span', conv.digitando.nome + ' está digitando'), h('i.cm-dots', h('b'), h('b'), h('b'))));
      if ((conv.naoLidaPor || {})[u.id]) setTimeout(() => K.lida(conv.id, u.id), 0);
      if (perto || !draw.visto) requestAnimationFrame(() => { const c = document.querySelector('.cm-composer'); if (c && draw.visto) c.scrollIntoView({ block: 'end', behavior: C.prefersReduced() ? 'auto' : 'smooth' }); });
      draw.visto = true;
    };
    const live = ui.live(['mensagens', 'conversas'], () => { draw(); return area; });
    const head = ui.live(['conversas'], () => { const conv = db.get('conversas', conv0.id) || conv0; return h('div.cm-head', h('div.cm-head-t', h('h2.cm-title', conv.titulo), h('div.row', conv.tipo === 'chamado' ? [h('span.mono.cm-proto', conv.protocolo), prioBadge(conv.prioridade), statusBadge(conv.status), slaChip(conv)] : [ui.badge(K.isCedy(u) && conv.canal === 'cedy' ? 'Conversa com o cliente' : canalLabel(conv.canal), 'neutral')])), h('div.cm-head-r', headerActions(conv, u, opts))); });
    return h('div.sh-page.cm-page.cm-conv-page',
      ui.pageHeader({ eyebrow: conv0.tipo === 'chamado' ? 'Chamado' : 'Conversa', title: conv0.tipo === 'chamado' ? conv0.protocolo : 'Conversa', back: opts.voltar || base + '/mensagens' }),
      h('div.cm-conv',
        h('div.cm-main', ui.card({ flush: true, class: 'cm-thread-card' }, head, live, h('div.cm-composer-wrap', composer(conv0, u, { status: opts.status, extras: opts.extras, aposEnviar: (r) => { if (C.comUI.aposEnviarThread) C.comUI.aposEnviarThread(conv0, r); if (opts.aposEnviar) opts.aposEnviar(r); }, onReady: (api) => { C.comUI.composerApi = api; } })))),
        ui.live(['conversas', 'acoesChamado'], () => infoPanel(db.get('conversas', conv0.id) || conv0, me(), opts), { class: 'cm-side-wrap' })));
  }
  const CANAIS = { cedy: 'Conversa com a Cedy', esclarecimentos: 'Esclarecimentos da operação', pos_aceite: 'Conversa da operação', cedente_sacado: 'Conversa com o sacado', orig_indicado: 'Conversa com o indicado', orig_sub: 'Conversa com o subparceiro', interna: 'Notas da equipe' };
  const canalLabel = (c) => CANAIS[c] || 'Conversa';

  function headerActions(conv, u, opts) {
    if (K.isCedy(u)) return [];
    const ac = K.acesso(conv, u); const escreve = ac === 'escreve';
    const btns = [conv.tipo !== 'chamado' && escreve && conv.canal !== 'interna' ? ui.btn('Promover a chamado', { variant: 'secondary', size: 'sm', icon: 'life-buoy', onclick: () => openPromover(conv) }) : null, conv.tipo === 'chamado' && conv.canal === 'cedy' && escreve ? ui.btn('Pedir ação', { variant: 'secondary', size: 'sm', icon: 'arrow-left-right', onclick: () => openPedirAcao(conv) }) : null].filter(Boolean);
    const extras = C.comUI.acoesConversa ? C.comUI.acoesConversa(conv, u) : [];
    if (extras.length) btns.push(ui.moreMenu(extras, { label: 'Mais ações da conversa' }));
    return btns;
  }

  /* ---------------------------------- modais --------------------------------- */
  function catRadio(u, valor, onChange) {
    return ui.select({ aria: 'Assunto', value: valor, placeholder: 'Escolha o assunto', onChange, options: Object.entries(K.CATEGORIAS).map(([id, c]) => ({ value: id, label: c.label, icon: c.icon, hint: c.soAdmin && u.perfil !== 'admin' ? 'Só administradores abrem' : c.dica, disabled: !!c.soAdmin && u.perfil !== 'admin' })) });
  }
  /** prazos em uma nota curta (valores de referência); o detalhe da regra de prioridade crítica fica no ícone de ajuda */
  function slaTexto() {
    const exp = K.expediente();
    return [h('div.cm-sla-note', { title: 'Crítica só vem de regra objetiva: pagamento ou vencimento no dia, único administrador sem acesso ou incidente S1.' }, icon('timer', 14),
      h('span', `Prazo de primeira resposta (valor de referência): crítica ${K.horasSla('critica')} h, normal ${K.horasSla('normal')} h úteis, baixa ${K.horasSla('baixa')} h úteis. Atendimento de segunda a sexta, das ${exp.ini}h às ${exp.fim}h.`)),
      !exp.aberto ? h('div.cm-sla-note.is-warn', icon('clock', 14), h('span', `Fora do expediente: atendimento a partir de ${fmt.datetime(exp.proximo)}. Se for crítico, o líder da Mesa e o plantão (simulado) são avisados, sem promessa de prazo.`)) : null];
  }
  function openNovoChamado(o = {}) {
    const u = me(); if (K.isCedy(u) || u.perfil === 'leitor') return ui.toast('Sem permissão', { type: 'warn', text: u.perfil === 'leitor' ? 'O perfil leitor só lê.' : 'O chamado é aberto pelo cliente.' });
    let cat = o.categoria || null; const aviso = h('div');
    const titulo = ui.input({ placeholder: 'Resumo em uma linha', maxlength: 90, value: o.titulo || '' }); const msg = ui.input({ type: 'textarea', rows: 4, placeholder: 'Conte o que aconteceu, com números de operação, lote ou título.' });
    const urg = ui.checkbox({ label: 'Peço urgência', hint: 'A Mesa confirma. Crítica só por regra objetiva.' });
    const sem = ui.checkbox({ label: 'Sou o único administrador e estou sem acesso', hint: 'Entra na regra de prioridade crítica.' }); const semRow = h('div'); semRow.hidden = true;
    semRow.append(sem);
    const wT = ui.field({ label: 'Assunto do chamado', required: true }, titulo); const wM = ui.field({ label: 'Mensagem', required: true }, msg);
    const cards = catRadio(u, cat, (v) => { cat = v; semRow.hidden = !(v === 'acesso' && u.perfil === 'admin'); });
    const m = ui.modal({ title: 'Novo chamado', subtitle: 'A Cedy responde no prazo abaixo.', icon: 'life-buoy', size: 'md',
      body: h('div.stack.tight', ui.field({ label: 'Sobre o quê', required: true }, cards), wT, wM, h('div.cm-checks', urg, semRow), aviso, ...slaTexto()),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Abrir chamado', { variant: 'primary', icon: 'send', onclick: () => {
        C.clear(aviso); wT.setError(''); wM.setError('');
        if (!cat) return aviso.append(ui.callout({ tone: 'error', text: 'Escolha sobre o quê é o chamado.' }));
        if (!String(titulo.value).trim()) return wT.setError('Escreva o assunto.');
        if (!String(msg.value).trim()) return wM.setError('Escreva a mensagem.');
        const r = K.abrirConversa({ userId: u.id, canal: 'cedy', categoria: cat, titulo: String(titulo.value).trim(), texto: msg.value, urgente: !!urg.value, sinais: { semAcesso: !!sem.value }, ancora: o.ancora ? Object.assign({}, o.ancora, { label: o.ancoraLabel }) : null, tipo: 'chamado' });
        if (!r.ok) return aviso.append(ui.callout({ tone: r.codigo === 'CONTATO_EXTERNO' ? 'warn' : 'error', title: r.codigo === 'CONTATO_EXTERNO' ? 'Mensagem não enviada' : 'Não foi possível abrir', text: r.erro }));
        api.close(); ui.toast(`Chamado ${r.conv.protocolo} aberto`, { type: 'success', text: r.conv.prioridade === 'critica' ? 'Prioridade crítica: ' + r.conv.prioridadeMotivo : `Prioridade ${K.PRIORIDADES[r.conv.prioridade].toLowerCase()}.` }); goConv(r.conv);
      } })] });
    return m;
  }
  function openPromover(conv) {
    const u = me(); let cat = 'outros'; const aviso = h('div'); const motivo = ui.input({ type: 'textarea', rows: 3, placeholder: 'O que você precisa da Cedy nesta conversa?' });
    const sem = ui.checkbox({ label: 'Sou o único administrador e estou sem acesso' });
    const entre = conv.canal !== 'cedy';
    ui.modal({ title: 'Promover a chamado', subtitle: entre ? 'A Cedy passa a ver esta conversa, com acesso registrado.' : 'A conversa ganha protocolo, prioridade e prazo de resposta.', icon: 'life-buoy', size: 'md',
      body: h('div.stack.tight', entre ? ui.callout({ tone: 'warn', icon: 'eye', title: 'A Cedy vai poder ler esta conversa', text: 'Abrimos um chamado novo ligado a ela. A contraparte vê que o chamado foi aberto e o histórico não é apagado.' }) : null,
        ui.field({ label: 'Assunto', required: true }, catRadio(u, cat, (v) => { cat = v; })), ui.field({ label: 'Mensagem', optional: true }, motivo), u.perfil === 'admin' ? sem : null, aviso, ...slaTexto()),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Promover', { variant: 'primary', icon: 'life-buoy', onclick: () => {
        C.clear(aviso); const r = K.promoverAChamado(conv.id, { userId: u.id, categoria: cat, motivo: String(motivo.value).trim(), sinais: { semAcesso: !!(sem && sem.value) } });
        if (!r.ok) return aviso.append(ui.callout({ tone: 'error', text: r.erro }));
        api.close(); ui.toast(`Chamado ${r.conv.protocolo} aberto`, { type: 'success' }); if (r.conv.id !== conv.id) goConv(r.conv);
      } })] });
  }
  function openPedirAcao(conv) {
    const u = me(); const aviso = h('div'); let acao = null, alvo = null; const host = h('div.stack.tight');
    const valor = ui.input({ placeholder: 'Novo valor' }); const texto = ui.input({ type: 'textarea', rows: 2, placeholder: 'Detalhe para a Mesa (opcional)' });
    const admin = u.perfil === 'admin';
    const radio = ui.field({ label: 'Ação', required: true }, ui.select({ aria: 'Ação', placeholder: 'Escolha a ação', options: Object.entries(K.ACOES).map(([id, a]) => ({ value: id, label: a.label, icon: a.icon, hint: a.soAdmin && !admin ? 'Só o administrador pede' : a.desc, disabled: !!a.soAdmin && !admin })), onChange: (v) => { acao = v; alvo = null; drawAlvo(); } }));
    function drawAlvo() {
      if (!acao) return C.clear(host);
      const ops = K.alvosAcao(acao, u.orgId).filter((x) => admin || !/email_contato/.test(x.value));
      C.mount(host, h('small.muted', K.ACOES[acao].desc), acao === 'reatribuir' ? ui.callout({ tone: 'info', text: 'A Mesa decide a área e a prioridade. Você não precisa escolher nada além de explicar o motivo.' })
        : ops.length ? [ui.field({ label: acao === 'corrigir_cadastro' ? 'O que corrigir' : 'A que se refere', required: true }, ui.select({ aria: 'Alvo', options: ops, value: alvo, placeholder: 'Escolha', onChange: (v) => { alvo = v; } })), acao === 'corrigir_cadastro' ? ui.field({ label: 'Novo valor', required: true }, valor) : null]
          : ui.callout({ tone: 'warn', text: 'Não há nada elegível para esta ação na sua empresa agora (por exemplo, nenhum convite pendente ou lote recusado).' }));
    }
    ui.modal({ title: 'Pedir uma ação à Mesa', subtitle: 'Só ações reversíveis da lista. A Mesa confere o seu pedido e avisa os administradores.', icon: 'arrow-left-right', size: 'md',
      body: h('div.stack.tight', radio, host, ui.field({ label: 'Mensagem', optional: true }, texto), aviso,
        ui.callout({ tone: 'info', icon: 'shield-check', title: 'O que não se pede por mensagem', text: 'Cancelar operação, desbloquear login, exportar dados, trocar conta bancária, mandato, acesso, limite, taxa e qualquer movimentação de dinheiro. Isso é feito dentro do app, com a sua autenticação (e 2FA quando exigido).' })),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Enviar pedido', { variant: 'primary', icon: 'send', onclick: () => {
        C.clear(aviso); if (!acao) return aviso.append(ui.callout({ tone: 'error', text: 'Escolha a ação.' }));
        const r = K.pedirAcao({ convId: conv.id, userId: u.id, acao, alvo, valor: valor.value, texto: texto.value }); if (!r.ok) return aviso.append(ui.callout({ tone: 'error', text: r.erro }));
        api.close(); ui.toast('Pedido enviado à Mesa', { type: 'success', text: 'A Mesa executa e você é avisado.' });
      } })] });
  }

  /** botão "Conversar" nas telas de item: abre ou cria a conversa ancorada */
  function openConversar(ancora, label) {
    const u = me(); if (!u) return;
    const canais = K.canaisPara(u.id, ancora);
    const abrir = (c) => {
      if (c.existente) return goConv(db.get('conversas', c.existente));
      const r = K.abrirConversa({ userId: u.id, canal: c.canal, ancora: Object.assign({}, ancora, { label }), titulo: label || undefined, contraOrgId: c.contraOrgId || null, subId: c.subId || null });
      if (!r.ok) return ui.toast('Não foi possível abrir', { type: 'error', text: r.erro });
      goConv(r.conv);
    };
    if (canais.length === 1) return abrir(canais[0]);
    const m = ui.modal({ title: 'Conversar sobre ' + (label || 'este item'), subtitle: 'Escolha com quem.', icon: 'messages-square', size: 'md',
      body: h('div.stack.tight', canais.map((c) => h('div', { class: ['cm-canal', !c.ok && 'is-off'] }, h('div.cm-canal-t', h('strong', c.rotulo), h('small', c.ok ? c.desc : c.motivo), c.existente ? ui.badge('Conversa já aberta', 'blue') : null), ui.btn(c.existente ? 'Abrir' : 'Iniciar', { variant: c.canal === 'cedy' ? 'primary' : 'secondary', size: 'sm', disabled: !c.ok, onclick: () => { m.close(); abrir(c); } })))),
      footer: (api) => [ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() })] });
  }
  function btnConversar(ancora, o = {}) {
    const u = me(); const leitor = u && u.perfil === 'leitor';
    return ui.btn(o.label || 'Conversar', { variant: o.variant || 'secondary', size: o.size || 'md', icon: 'messages-square', disabled: !!leitor, title: leitor ? 'O perfil leitor só lê as conversas.' : null, onclick: () => openConversar(ancora, o.rotulo) });
  }

  /* ----------------------------- notificações (prefs) ------------------------ */
  C.comUI = { feedRow, bell, msgNode, listaMensagens, composer, threadPage, infoPanel, prioBadge, statusBadge, slaChip, openNovoChamado, openPromover, openPedirAcao, openConversar, btnConversar, emailPreview, canalLabel, goConv, TOPICOS };

  /* ---------------------------------- rotas ---------------------------------- */
  ['cedente', 'financiador', 'originador', 'sacado'].forEach((role) => {
    C.router.register({ path: '/' + role + '/mensagens', roles: [role], title: 'Mensagens', render: pgInbox });
    C.router.register({ path: '/' + role + '/mensagens/:id', roles: [role], title: 'Conversa', render: (ctx) => threadPage(ctx) });
  });
  C.router.register({ path: '/ops/mensagens', roles: ['ops'], title: 'Mensagens', render: pgInbox });
  // /ops/mensagens/:id e /ops/chamados/:id são da Mesa (screens/com2.js)
})();
