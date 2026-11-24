/* =========================================================================
   Cedy, Central de Comunicação, comunicados (S5): aba da Mesa, drawer do
   cliente e faixas globais. Prefixo CSS: cm5-. Regras de negócio ficam em
   E.com.comunicado (core/com-comunicados.js); aqui só apresentação.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session } = C.store;
  const E = C.engine; const K = E.com; const MC = E.com.comunicado;
  const me = () => session.user();
  /* escreve: líder da Mesa e Superadmin; compliance e auditor só leem */
  const pode = (u) => !!(u && K.temPerm(u, 'ops.com.comunicar') && u.perfil !== 'leitor' && u.papel !== 'auditor' && u.papel !== 'compliance');
  const semMsg = () => C.cannotMsg('ops.com.comunicar');

  const TIPO_LABEL = (MC && MC.TIPOS) || { informativo: 'Informativo', contratual: 'Contratual' };
  const STATUS_LABEL = { rascunho: 'Rascunho', agendado: 'Agendado', aguardando_aprovacao: 'Aguardando aprovação', publicado: 'Publicado', cancelado: 'Cancelado' };
  const TIPO_TONE = { informativo: 'blue', contratual: 'amber' };
  const STATUS_TONE = { rascunho: 'neutral', agendado: 'teal', aguardando_aprovacao: 'amber', publicado: 'green', cancelado: 'neutral' };
  const tipoBadge = (t) => ui.badge(TIPO_LABEL[t] || t, TIPO_TONE[t] || 'neutral', { dot: true });
  const statusBadge = (s) => ui.badge(STATUS_LABEL[s] || s, STATUS_TONE[s] || 'neutral', { dot: true });

  const PERFIS_OPTS = [
    { value: 'cedente', label: 'Cedente' },
    { value: 'financiador', label: 'Financiador' },
    { value: 'originador', label: 'Originador' },
    { value: 'sacado', label: 'Sacado' },
  ];
  /* preguiçoso: db só existe depois do seed (na carga o estado ainda é nulo) */
  const programasOpts = () => ['premium', 'confia', 'boleto', 'carteira', 'contrato', 'frete'].map((id) => {
    const p = db.get('produtos', id);
    return { value: id, label: (p && p.nome) || id };
  });

  function cienciaDe(c, orgId) {
    return db.where('ciencias', (x) => x.comunicadoId === c.id && x.orgId === orgId)[0] || null;
  }

  /* ------------------------- drawer do cliente ------------------------- */
  function abrirComunicado(cOrId) {
    const c0 = typeof cOrId === 'string' ? db.get('comunicados', cOrId) : cOrId;
    if (!c0) { ui.toast('Comunicado não encontrado', { type: 'error' }); return; }
    const u = me();
    const corpo = h('div');
    function draw() {
      const c = db.get('comunicados', c0.id) || c0;
      C.clear(corpo);
      const minha = u && !K.isCedy(u) ? cienciaDe(c, u.orgId) : null;
      const quem = minha ? db.get('users', minha.userId) : null;
      corpo.append(...[
        h('div.row', tipoBadge(c.tipo), statusBadge(c.status), c.faixa ? ui.badge('Faixa no topo', 'amber', { icon: 'megaphone' }) : null),
        c.tipo === 'contratual' && c.vigenciaEm ? h('p.cm5-vig', icon('calendar', 14), `Vale desde ${fmt.date(c.vigenciaEm)}`) : null,
        ui.card({ title: 'Texto' }, h('p.cm5-corpo', c.corpo)),
        c.tipo === 'contratual' ? ui.card({ title: 'Ciência da empresa' },
          minha
            ? ui.callout({ tone: 'success', icon: 'circle-check', title: 'Ciência registrada', text: `Registrada por ${quem ? quem.nome : 'sua empresa'} em ${fmt.date(minha.ts)} (${fmt.time(minha.ts)}). Uma ciência vale pela empresa.` })
            : K.isCedy(u)
              ? h('p.small.muted', 'A ciência é registrada pela empresa cliente, na conta dela.')
              : (u && u.perfil === 'leitor')
                ? ui.callout({ tone: 'info', title: 'Perfil leitor', text: 'Você lê o texto, mas só administrador ou operador registra a ciência da empresa.' })
                : ui.btn('Li e entendi', { variant: 'primary', icon: 'check', onclick: () => {
                  const r = MC.darCiencia(c.id, u.id);
                  if (!r.ok) { ui.toast('Não foi possível registrar', { type: 'error', text: r.erro }); return; }
                  ui.toast('Ciência registrada', { type: 'success', text: 'Obrigado. A Mesa acompanha a leitura por empresa.' });
                } })) : null,
        c.publicadoEm ? h('p.small.muted', `Publicado em ${fmt.datetime(c.publicadoEm)}.`) : null].filter((n) => n !== null && n !== undefined && n !== false));
    }
    draw();
    const off = db.on(['comunicados', 'ciencias'], () => { if (corpo.isConnected) draw(); });
    ui.drawer({ title: c0.titulo, subtitle: TIPO_LABEL[c0.tipo] || 'Comunicado', icon: 'megaphone', size: 'md', body: corpo, onClose: off });
  }

  /* ------------------------------ faixas ------------------------------- */
  function faixas() {
    const u = me();
    if (!u || K.isCedy(u)) return [];
    return K.comunicadosPara(u)
      .filter((c) => c.faixa && !cienciaDe(c, u.orgId))
      .map((c) => h('div.banner.banner-warn.cm5-faixa', { role: 'status' }, icon('megaphone', 16),
        h('span.banner-t', h('strong', c.titulo), h('span.small', c.tipo === 'contratual' && c.vigenciaEm ? ` Vale desde ${fmt.date(c.vigenciaEm)}. Para dispensar este aviso, registre a ciência.` : ' Para dispensar este aviso, registre a ciência.')),
        h('span.cm5-faixa-act', ui.btn('Li e entendi', { size: 'sm', variant: 'secondary', onclick: () => {
          const r = MC.darCiencia(c.id, u.id);
          if (!r.ok) ui.toast('Não foi possível registrar', { type: 'error', text: r.erro });
        } }))));
  }

  /* --------------------------- drawer da Mesa -------------------------- */
  function drawerMesa(cOrId) {
    const c0 = typeof cOrId === 'string' ? db.get('comunicados', cOrId) : cOrId;
    if (!c0) return;
    const u = me();
    const sem = !pode(u);
    const dica = sem ? semMsg() : null;
    const corpo = h('div');
    function acoes(c) {
      const btns = [];
      if (c.status === 'rascunho' && c.tipo === 'informativo') {
        btns.push(ui.btn('Publicar agora', { size: 'sm', variant: 'primary', icon: 'send', disabled: sem, title: dica, onclick: () => {
          const r = MC.publicar(c.id, u.id);
          if (!r.ok) { ui.toast('Não foi possível publicar', { type: 'error', text: r.erro }); return; }
          ui.toast('Comunicado publicado', { type: 'success', text: c.titulo });
        } }));
        btns.push(ui.btn('Agendar', { size: 'sm', variant: 'secondary', icon: 'calendar', disabled: sem, title: dica, onclick: () => modalAgendar(c) }));
      }
      if (c.status === 'rascunho' && c.tipo === 'contratual') {
        btns.push(ui.btn('Enviar para aprovação', { size: 'sm', variant: 'primary', icon: 'stamp', disabled: sem, title: dica, onclick: () => modalAprovar(c) }));
      }
      if (c.status === 'agendado' && c.tipo === 'informativo') {
        btns.push(ui.btn('Publicar agora', { size: 'sm', variant: 'primary', icon: 'send', disabled: sem, title: dica, onclick: () => {
          const r = MC.publicar(c.id, u.id);
          if (!r.ok) { ui.toast('Não foi possível publicar', { type: 'error', text: r.erro }); return; }
          ui.toast('Comunicado publicado', { type: 'success', text: c.titulo });
        } }));
      }
      if (['rascunho', 'agendado', 'aguardando_aprovacao'].includes(c.status)) {
        btns.push(ui.btn('Cancelar', { size: 'sm', variant: 'ghost', disabled: sem, title: dica, onclick: () => modalCancelar(c) }));
      }
      if (c.status === 'aguardando_aprovacao' && c.aprovacaoId) {
        btns.push(ui.btn('Ver solicitação', { size: 'sm', variant: 'secondary', icon: 'stamp', route: '/super/aprovacoes' }));
      }
      return btns;
    }
    function draw() {
      const c = db.get('comunicados', c0.id) || c0;
      C.clear(corpo);
      const est = MC.estatisticas(c.id);
      const criador = db.get('users', c.criadoPor);
      corpo.append(...[
        h('div.row', ui.badge(c.id, 'neutral', { icon: 'megaphone' }), tipoBadge(c.tipo), statusBadge(c.status)),
        c.status === 'publicado' ? ui.callout({ tone: 'info', title: `Ciência: ${est.deram} de ${est.total} empresas`, text: est.total ? 'A lista abaixo mostra quem já registrou e quem está pendente.' : 'Nenhuma empresa no segmento.' }) : null,
        ui.card({ title: 'Conteúdo' },
          ui.kv([
            ['Título', c.titulo],
            ['Tipo', TIPO_LABEL[c.tipo]],
            ['Situação', STATUS_LABEL[c.status]],
            c.vigenciaEm ? ['Vigência', fmt.date(c.vigenciaEm)] : null,
            ['Segmento', MC.rotuloSegmento(c.segmento)],
            ['Faixa no topo', c.faixa ? 'Sim' : 'Não'],
            ['Criado por', criador ? `${criador.nome} em ${fmt.datetime(c.criadoEm)}` : fmt.datetime(c.criadoEm)],
            c.publicadoEm ? ['Publicado em', fmt.datetime(c.publicadoEm)] : null,
            c.agendadoPara ? ['Agendado para', fmt.datetime(c.agendadoPara)] : null,
            c.aprovacaoId ? ['Solicitação', h('span.mono', c.aprovacaoId)] : null,
          ]),
          h('h4.cm5-h', 'Texto'),
          h('p.cm5-corpo', c.corpo)),
        c.status === 'publicado' ? ui.card({ title: 'Ciência por empresa' },
          est.lista.length ? ui.table({ rows: est.lista, rowKey: (r) => r.orgId,
            columns: [
              { key: 'e', label: 'Empresa', mobile: 'primary', render: (r) => h('strong', r.nome) },
              { key: 's', label: 'Situação', render: (r) => (r.deu ? ui.badge('Registrada', 'green', { dot: true }) : ui.badge('Pendente', 'amber', { dot: true })) },
              { key: 'q', label: 'Quem e quando', mobile: 'hide', render: (r) => (r.deu ? h('span.small', `${r.por || 'sua equipe'} em ${fmt.date(r.quando)}`) : h('span.small.muted', 'aguardando a empresa')) },
            ] }) : h('p.small.muted', 'Nenhuma empresa no segmento.')) : null,
        sem ? ui.callout({ tone: 'warn', title: 'Somente leitura para o seu papel', text: dica }) : null].filter((n) => n !== null && n !== undefined && n !== false));
      const bar = corpo.parentElement && corpo.parentElement.querySelector('.cm5-foot');
      if (bar) { C.clear(bar); bar.append(...acoes(c), ui.btn('Fechar', { size: 'sm', variant: 'ghost', onclick: () => { if (api) api.close(); } })); }
    }
    let api = null;
    draw();
    const off = db.on(['comunicados', 'ciencias', 'aprovacoes'], () => { if (corpo.isConnected) draw(); });
    const foot = h('div.cm5-foot');
    api = ui.drawer({ title: c0.titulo, subtitle: 'Comunicado ' + c0.id, icon: 'megaphone', size: 'lg', body: h('div.stack', corpo, foot), onClose: off });
    draw();
    return api;
  }

  /* ------------------------------- modais ------------------------------ */
  function modalAgendar(c) {
    const u = me();
    const aviso = h('div');
    const d = ui.date({ aria: 'Data do agendamento', onChange: () => {} });
    const wD = ui.field({ label: 'Publicar em', required: true, hint: 'O relógio publica sozinho quando chegar a hora.' }, d);
    ui.modal({ title: 'Agendar comunicado', subtitle: c.titulo, icon: 'calendar', size: 'sm',
      body: h('div.stack.tight', wD, aviso),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Agendar', { variant: 'primary', icon: 'calendar', onclick: () => {
        C.clear(aviso);
        const ts = d.value;
        if (!(ts > C.clock.now())) { aviso.append(ui.callout({ tone: 'error', text: 'Escolha uma data futura.' })); return; }
        const r = MC.agendar(c.id, ts, u.id);
        if (!r.ok) { aviso.append(ui.callout({ tone: 'error', text: r.erro })); return; }
        ui.toast('Comunicado agendado', { type: 'success', text: 'O relógio publica sozinho na data.' });
        api.close(true);
      } })] });
  }

  function modalAprovar(c) {
    const u = me();
    const aviso = h('div');
    const mot = ui.input({ type: 'textarea', rows: 3, placeholder: 'Ex.: as tarifas da Vitrine mudam em dezembro e as empresas precisam de 15 dias para se ajustar' });
    const wM = ui.field({ label: 'Motivo do pedido', required: true, hint: 'Mínimo de 10 caracteres. Outro Superadmin aprova, quem pediu não aprova.' }, mot);
    ui.modal({ title: 'Enviar para aprovação', subtitle: c.titulo, icon: 'stamp', size: 'md',
      body: h('div.stack.tight',
        ui.callout({ tone: 'info', title: 'Contratual com quatro olhos', text: 'O Superadmin decide na fila de aprovações. Se aprovar, o comunicado é publicado na hora com ciência obrigatória por empresa. Se rejeitar, volta a rascunho.' }),
        ui.kv([['Texto', c.corpo.slice(0, 280)], ['Segmento', MC.rotuloSegmento(c.segmento)], ['Vigência', c.vigenciaEm ? fmt.date(c.vigenciaEm) : 'sem vigência']]),
        wM, aviso),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Enviar', { variant: 'primary', icon: 'send', onclick: () => {
        C.clear(aviso);
        const t = String(mot.value).trim();
        if (t.length < 10) { wM.setError('Escreva ao menos 10 caracteres.'); return; }
        const r = MC.enviarParaAprovacao(c.id, u.id, t);
        if (!r.ok) { aviso.append(ui.callout({ tone: 'error', text: r.erro })); return; }
        ui.toast('Enviado ao Superadmin', { type: 'success', text: `Pedido ${r.aprovacao.id}: acompanhe em Minhas solicitações.`, link: '/ops/solicitacoes' });
        api.close(true);
      } })] });
  }

  function modalCancelar(c) {
    const u = me();
    const aviso = h('div');
    const mot = ui.input({ type: 'textarea', rows: 2, placeholder: 'Motivo do cancelamento (opcional)' });
    ui.modal({ title: 'Cancelar comunicado', subtitle: c.titulo, icon: 'x', size: 'sm',
      body: h('div.stack.tight', h('p', 'O comunicado sai da fila e não é publicado. Dá para criar outro depois.'), ui.field({ label: 'Motivo', optional: true }, mot), aviso),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Cancelar comunicado', { variant: 'danger', onclick: () => {
        const r = MC.cancelar(c.id, u.id, String(mot.value).trim());
        if (!r.ok) { aviso.append(ui.callout({ tone: 'error', text: r.erro })); return; }
        ui.toast('Comunicado cancelado', { type: 'info', text: c.id });
        api.close(true);
      } })] });
  }

  function modalNovo() {
    const u = me();
    if (!pode(u)) { ui.toast('Sem permissão', { type: 'warn', text: semMsg() }); return; }
    let tipo = 'informativo';
    const aviso = h('div');
    const selTipo = ui.select({ aria: 'Tipo de comunicado', value: tipo, options: [{ value: 'informativo', label: 'Informativo', hint: 'A Mesa publica direto, agora ou agendado' }, { value: 'contratual', label: 'Contratual', hint: 'Passa pelo Superadmin, com vigência e ciência obrigatória' }], onChange: (v) => { tipo = v; drawTipo(); } });
    const fTitulo = ui.input({ placeholder: 'Ex.: manutenção programada do módulo de relatórios', maxlength: 120 });
    const wT = ui.field({ label: 'Título', required: true }, fTitulo);
    const fCorpo = ui.input({ type: 'textarea', rows: 5, placeholder: 'Texto curto e direto, sem jargão.' });
    const wC = ui.field({ label: 'Texto', required: true }, fCorpo);
    const perfis = PERFIS_OPTS.map((p) => ({ opt: p, box: ui.checkbox({ label: p.label }) }));
    const programas = programasOpts().map((p) => ({ opt: p, box: ui.checkbox({ label: p.label }) }));
    const ativas = db.where('orgs', (o) => o.kind !== 'cedy' && o.status === 'ativo').sort((a, b) => String(a.fantasia || a.nome).localeCompare(String(b.fantasia || b.nome), 'pt-BR'));
    let orgId = '';
    const selOrg = ui.select({ aria: 'Empresa específica', value: '', searchable: true, options: [{ value: '', label: 'Todas as empresas do segmento' }].concat(ativas.map((o) => ({ value: o.id, label: o.fantasia || o.nome, hint: o.kind }))), onChange: (v) => { orgId = v; } });
    const wO = ui.field({ label: 'Empresa específica', optional: true, hint: 'Vazio vale para todas do segmento.' }, selOrg);
    const dVig = ui.date({ aria: 'Vigência do contratual' });
    const wVig = ui.field({ label: 'Vigência', required: true, hint: 'A partir de quando o contratual vale.' }, dVig);
    const boxFaixa = ui.checkbox({ label: 'Mostrar como faixa no topo', hint: 'Para avisos que ninguém pode perder. Sai quando a empresa registra a ciência.' });
    let modo = 'agora';
    const selModo = ui.select({ aria: 'Quando publicar', value: modo, options: [{ value: 'agora', label: 'Publicar agora' }, { value: 'agendar', label: 'Agendar' }], onChange: (v) => { modo = v; drawTipo(); } });
    const dAg = ui.date({ aria: 'Data do agendamento' });
    const wModo = ui.field({ label: 'Publicação do informativo' }, selModo);
    const wAg = ui.field({ label: 'Publicar em', required: true }, dAg);
    const tipoBox = h('div');
    function drawTipo() {
      C.clear(tipoBox);
      tipoBox.append(tipo === 'contratual'
        ? [wVig, ui.callout({ tone: 'info', title: 'Contratual com quatro olhos', text: 'Fica como rascunho e segue para o Superadmin na lista abaixo. A publicação sai com ciência obrigatória por empresa.' })]
        : [wModo, modo === 'agendar' ? wAg : null]);
    }
    drawTipo();
    ui.modal({ title: 'Novo comunicado', subtitle: 'A Mesa escreve, o motor publica e a ciência fica por empresa.', icon: 'megaphone', size: 'lg',
      body: h('div.stack.tight',
        ui.field({ label: 'Tipo', required: true }, selTipo),
        wT, wC,
        ui.field({ label: 'Perfis (vazio vale para todos)' }, h('div.cm5-checks', perfis.map((p) => p.box))),
        ui.field({ label: 'Programas (vazio vale para todos)' }, h('div.cm5-checks', programas.map((p) => p.box))),
        wO, boxFaixa, tipoBox, aviso),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Criar comunicado', { variant: 'primary', icon: 'plus', onclick: () => {
        C.clear(aviso);
        wT.setError(''); wC.setError('');
        const titulo = String(fTitulo.value).trim();
        const corpo = String(fCorpo.value).trim();
        if (!titulo) { wT.setError('Escreva o título.'); return; }
        if (!corpo) { wC.setError('Escreva o texto.'); return; }
        const segmento = {
          perfis: perfis.filter((p) => p.box.value).map((p) => p.opt.value),
          programas: programas.filter((p) => p.box.value).map((p) => p.opt.value),
          orgIds: orgId ? [orgId] : [],
        };
        const args = { userId: u.id, tipo, titulo, corpo, segmento, faixa: !!boxFaixa.value };
        if (tipo === 'contratual') {
          const vig = dVig.value;
          if (!(vig > C.clock.now())) { aviso.append(ui.callout({ tone: 'error', text: 'Informe a vigência futura do contratual.' })); return; }
          args.vigenciaEm = vig;
        }
        const r = MC.criar(args);
        if (!r.ok) { aviso.append(ui.callout({ tone: 'error', text: r.erro })); return; }
        if (tipo === 'informativo' && modo === 'agendar') {
          const ts = dAg.value;
          if (!(ts > C.clock.now())) { aviso.append(ui.callout({ tone: 'error', text: 'Escolha uma data futura para agendar. O rascunho foi criado.' })); return; }
          const g = MC.agendar(r.comunicado.id, ts, u.id);
          if (!g.ok) { aviso.append(ui.callout({ tone: 'error', text: g.erro })); return; }
          ui.toast('Comunicado agendado', { type: 'success', text: 'O relógio publica sozinho na data.' });
        } else if (tipo === 'informativo') {
          const p = MC.publicar(r.comunicado.id, u.id);
          if (!p.ok) { aviso.append(ui.callout({ tone: 'error', text: p.erro })); return; }
          ui.toast('Comunicado publicado', { type: 'success', text: titulo });
        } else {
          ui.toast('Rascunho criado', { type: 'success', text: 'Envie para aprovação na lista de comunicados.' });
        }
        api.close(true);
      } })] });
  }

  /* ------------------------------ aba Mesa ----------------------------- */
  function abaComunicados() {
    const st = { tipo: 'todos', status: 'todos', q: '' };
    const host = h('div.cm5');
    function draw() {
      const u = me();
      const sem = !pode(u);
      C.clear(host);
      const todas = db.all('comunicados').slice().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
      const pub = todas.filter((c) => c.status === 'publicado');
      const aguard = todas.filter((c) => c.status === 'aguardando_aprovacao');
      const agend = todas.filter((c) => c.status === 'agendado');
      const rasc = todas.filter((c) => c.status === 'rascunho');
      const pendCiencia = pub.filter((c) => c.tipo === 'contratual' && MC.estatisticas(c.id).pendentes.length);
      host.append(...[
        h('div.cm5-kpis',
          ui.kpi({ icon: 'megaphone', tone: 'blue', label: 'Publicados', display: fmt.num(pub.length), hint: pub.length ? `${pendCiencia.length} contratuais com ciência pendente` : 'nada publicado' }),
          ui.kpi({ icon: 'hourglass', tone: aguard.length ? 'amber' : 'neutral', label: 'Aguardando aprovação', display: fmt.num(aguard.length), hint: aguard.length ? 'na fila do Superadmin' : 'fila vazia' }),
          ui.kpi({ icon: 'calendar', tone: 'teal', label: 'Agendados', display: fmt.num(agend.length), hint: agend.length ? 'o relógio publica sozinho' : 'nada agendado' }),
          ui.kpi({ icon: 'file-text', tone: 'neutral', label: 'Rascunhos', display: fmt.num(rasc.length), hint: rasc.length ? 'termine e publique ou envie' : 'nada em edição' })),
        sem ? ui.callout({ tone: 'warn', title: 'Somente leitura para o seu papel', text: semMsg() }) : null,
        h('div.toolbar.cm5-bar',
          ui.select({ aria: 'Filtrar por tipo', value: st.tipo, options: [{ value: 'todos', label: 'Todos os tipos' }, { value: 'informativo', label: 'Informativo' }, { value: 'contratual', label: 'Contratual' }], onChange: (v) => { st.tipo = v; draw(); } }),
          ui.select({ aria: 'Filtrar por situação', value: st.status, options: [{ value: 'todos', label: 'Todas as situações' }, { value: 'rascunho', label: 'Rascunho' }, { value: 'agendado', label: 'Agendado' }, { value: 'aguardando_aprovacao', label: 'Aguardando aprovação' }, { value: 'publicado', label: 'Publicado' }, { value: 'cancelado', label: 'Cancelado' }], onChange: (v) => { st.status = v; draw(); } }),
          ui.search({ placeholder: 'Buscar por título', onInput: (v) => { st.q = String(v || '').trim().toLowerCase(); draw(); } }),
          h('span.cm5-grow'),
          ui.btn('Novo comunicado', { variant: 'primary', icon: 'plus', disabled: sem, title: sem ? semMsg() : null, onclick: modalNovo })),
        tabela(filtra(todas))].filter((n) => n !== null && n !== undefined && n !== false));
    }
    function filtra(todas) {
      return todas.filter((c) => {
        if (st.tipo !== 'todos' && c.tipo !== st.tipo) return false;
        if (st.status !== 'todos' && c.status !== st.status) return false;
        if (st.q && !(c.titulo + ' ' + c.corpo).toLowerCase().includes(st.q)) return false;
        return true;
      });
    }
    function tabela(rows) {
      if (!rows.length) return ui.card({}, ui.empty({ icon: 'megaphone', title: 'Nenhum comunicado com estes filtros', text: 'Ajuste os filtros ou crie o primeiro comunicado da lista.' }));
      return ui.card({ flush: true, class: 'cm5-card' }, ui.table({ rows, rowKey: (r) => r.id,
        columns: [
          { key: 't', label: 'Comunicado', mobile: 'primary', render: (c) => h('div.cell-main', h('strong', c.titulo), h('small', h('span.mono', c.id), c.faixa ? ' · faixa no topo' : '')) },
          { key: 'ti', label: 'Tipo', render: (c) => tipoBadge(c.tipo) },
          { key: 's', label: 'Situação', render: (c) => statusBadge(c.status) },
          { key: 'sg', label: 'Segmento', mobile: 'hide', render: (c) => h('span.small', MC.rotuloSegmento(c.segmento)) },
          { key: 'v', label: 'Vigência', mobile: 'hide', render: (c) => h('span.small', c.vigenciaEm ? fmt.date(c.vigenciaEm) : 'sem vigência') },
          { key: 'ci', label: 'Ciência', render: (c) => {
            if (c.status !== 'publicado') return h('span.small.muted', 'ainda não publicado');
            const e = MC.estatisticas(c.id);
            return h('span.small', `${e.deram} de ${e.total} empresas`);
          } },
        ], onRowClick: (c) => drawerMesa(c),
        empty: ui.empty({ icon: 'megaphone', title: 'Nada por aqui', text: 'Ajuste os filtros.' }) }));
    }
    const live = ui.live(['comunicados', 'ciencias', 'aprovacoes', 'session'], () => { draw(); return host; });
    draw();
    return live;
  }

  C.comUI = C.comUI || {};
  C.comUI.abrirComunicado = abrirComunicado;
  C.comUI.faixas = faixas;
  C.comUI.opsTabs = C.comUI.opsTabs || [];
  if (!C.comUI.opsTabs.some((t) => t.id === 'comunicados')) {
    C.comUI.opsTabs.push({
      id: 'comunicados', label: 'Comunicados', icon: 'megaphone', ordem: 30,
      visivel: (u) => {
        if (!u || !K.isCedy(u)) return false;
        if (u.perfil === 'superadmin') return true;
        if (u.perfil === 'admin') return true;
        return u.papel === 'compliance' || u.papel === 'auditor';
      },
      contagem: () => db.where('comunicados', (c) => ['rascunho', 'agendado', 'aguardando_aprovacao'].includes(c.status)).length,
      render: () => abaComunicados(),
    });
  }

  /* Abre o drawer pelo link da caixa (?c=CM-0001 nas mensagens). */
  let ultimoC = null;
  function checaHash() {
    const m = String(location.hash || '').match(/[?&]c=(CM-\d+)/);
    if (!m) { ultimoC = null; return; }
    if (m[1] === ultimoC) return;
    const u = me();
    if (!u || K.isCedy(u)) return;
    const c = db.get('comunicados', m[1]);
    if (!c || c.status !== 'publicado') return;
    if (!K.comunicadosPara(u).some((x) => x.id === c.id)) return;
    ultimoC = m[1];
    abrirComunicado(c);
  }
  window.addEventListener('hashchange', () => setTimeout(checaHash, 50));
  setTimeout(checaHash, 800);
})();
