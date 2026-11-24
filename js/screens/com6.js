/* =========================================================================
   Cedy, Central de comunicação: Saúde da comunicação do Superadmin (S6).
   Rota /super/comunicacao (perfil superadmin). Seções: saúde, controles
   (blocos, limites e prazos), autonomia do agente de atendimento e demonstração.
   Mudança de bloco: trilha R3 com motivo. Limites e prazos: Ops.solicitarOuAplicar
   (o objeto comunicacao vai inteiro porque db.setCfg é raso). Prefixo CSS: cm6-.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui; const Ops = { solicitarOuAplicar: (o) => C.ops.solicitarOuAplicar(o) }; // ops3.js carrega depois
  const { db, session, ledger } = C.store;
  const E = C.engine; const K = E.com; const IA = E.ia.com; const UI = C.comUI;
  const now = () => C.clock.now();
  const me = () => session.user();
  const DAY = 86400000;
  const CAT = 'informativa_fonte';

  /* ------------------------------ métricas de saúde ------------------------------ */
  const mediana = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const horasTxt = (v) => (v === null ? '—' : v < 1 ? Math.round(v * 60) + ' min' : (Math.round(v * 10) / 10).toString().replace('.', ',') + ' h');
  function saude() {
    const t = now(); const chamados = db.where('conversas', (c) => c.tipo === 'chamado' && c.canal === 'cedy');
    const recentes = chamados.filter((c) => c.criadaEm >= t - 30 * DAY);
    const respostas = recentes.filter((c) => c.primeiraRespostaEm).map((c) => K.minutosUteis(c.criadaEm, c.primeiraRespostaEm) / 60);
    const abertos = chamados.filter((c) => ['aberto', 'em_atendimento'].includes(c.status));
    const msgs7 = db.where('mensagens', (m) => m.ts >= t - 7 * DAY && ['pessoa', 'agente'].includes(m.autor.tipo));
    const filas = Object.keys(K.FILAS).map((f) => { const cs = abertos.filter((c) => c.fila === f); const rs = recentes.filter((c) => c.fila === f && c.primeiraRespostaEm).map((c) => K.minutosUteis(c.criadaEm, c.primeiraRespostaEm) / 60); return { fila: f, abertos: cs.length, estourados: cs.filter(K.slaEstourado).length, mediana: mediana(rs) }; });
    const met = IA.metricas(CAT); const ini = t - 30 * DAY;
    const uso = db.where('usoIA', (u) => u.agenteId === IA.AGENTE && u.dia >= ini);
    return { mediana: mediana(respostas), n30: recentes.length, abertos: abertos.length, estourados: abertos.filter(K.slaEstourado).length,
      alertas: db.where('alertasContato', (a) => ['aberto', 'em_analise'].includes(a.status)).length, denuncias: db.where('denuncias', (d) => ['pendente', 'em_analise'].includes(d.status)).length,
      msgs7: msgs7.length, doAgente7: msgs7.filter((m) => m.autor.tipo === 'agente').length, filas,
      edicao: met.revisadas ? 1 - met.semEdicao : null, custo: C.sum(uso, (u) => u.custoBRL), reqs: C.sum(uso, (u) => u.reqs || 0) };
  }
  function secSaude() {
    return ui.live(['conversas', 'mensagens', 'alertasContato', 'denuncias', 'respostasIA', 'usoIA'], () => {
      const s = saude();
      return h('div.stack',
        h('div.cm6-kpis',
          ui.kpi({ icon: 'timer', label: 'Primeira resposta (mediana)', display: horasTxt(s.mediana), hint: `${s.n30} chamados em 30 dias, em horas úteis` }),
          ui.kpi({ icon: 'inbox', label: 'Fila aberta', display: fmt.num(s.abertos), hint: `${s.estourados} com prazo vencido`, tone: s.estourados ? 'red' : null }),
          ui.kpi({ icon: 'triangle-alert', label: 'Alertas e denúncias', display: `${s.alertas} · ${s.denuncias}`, hint: 'alertas de contato · denúncias abertas' }),
          ui.kpi({ icon: 'messages-square', label: 'Mensagens em 7 dias', display: fmt.num(s.msgs7), hint: `${s.doAgente7} do agente de atendimento` }),
          ui.kpi({ icon: 'pencil', label: 'Taxa de edição do agente', display: s.edicao === null ? '—' : fmt.pct(s.edicao * 100, 1), hint: 'rascunhos revisados e alterados' }),
          ui.kpi({ icon: 'cpu', label: 'Custo de IA (30 dias)', display: fmt.brl(s.custo), hint: `${fmt.num(s.reqs)} chamadas ao modelo` })),
        ui.card({ title: 'Por fila', subtitle: 'Chamados abertos agora e primeira resposta dos últimos 30 dias' },
          ui.table({ rows: s.filas, rowKey: (r) => r.fila, columns: [
            { key: 'f', label: 'Fila', mobile: 'primary', render: (r) => h('strong', K.FILAS[r.fila]) },
            { key: 'a', label: 'Abertos', align: 'right', render: (r) => h('span.num', String(r.abertos)) },
            { key: 'e', label: 'Prazo vencido', align: 'right', render: (r) => (r.estourados ? ui.badge(String(r.estourados), 'red', { dot: true }) : h('span.num', '0')) },
            { key: 'm', label: 'Primeira resposta (mediana)', align: 'right', mobile: 'hide', render: (r) => h('span.num', horasTxt(r.mediana)) },
          ] })));
    });
  }

  /* ------------------------------ controles ------------------------------ */
  const BLOCOS = [
    { id: 'pares', rotulo: 'Conversas entre empresas', hint: 'Esclarecimentos, pós-aceite e demais canais entre clientes. Pausar não afeta operações, leilão nem chamados à Cedy.' },
    { id: 'agentes', rotulo: 'Ajuda dos agentes de IA', hint: 'Triagem, rascunhos e respostas informativas. Pausar liga o modo degradado: as conversas seguem só com pessoas.' },
    { id: 'comunicados', rotulo: 'Comunicados', hint: 'Publicação de comunicados aos clientes. Pausar impede novos envios; os já publicados continuam visíveis.' },
    { id: 'anexos', rotulo: 'Anexos em conversas', hint: 'Envio de arquivos. Pausar mantém o texto funcionando.' },
  ];
  function alterarBloco(b, ligar) {
    const motivo = ui.input({ type: 'textarea', rows: 3, placeholder: ligar ? 'Por que religar?' : 'Por que pausar?' });
    const campo = ui.field({ label: 'Motivo', required: true, hint: 'Mínimo de 10 caracteres. Vai à trilha como R3.' }, motivo);
    const m = ui.modal({ title: (ligar ? 'Religar: ' : 'Pausar: ') + b.rotulo.toLowerCase(), icon: ligar ? 'play' : 'octagon-pause', size: 'md',
      body: h('div.stack.tight', ui.callout({ tone: ligar ? 'info' : 'warn', text: b.hint }), campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn(ligar ? 'Religar' : 'Pausar agora', { variant: ligar ? 'primary' : 'danger', icon: ligar ? 'play' : 'octagon-pause', onclick: () => {
        const t = String(motivo.value).trim(); if (t.length < 10) { campo.setError('Escreva ao menos 10 caracteres.'); return; }
        const cfg = K.cfg(); const antes = (cfg.blocos || {})[b.id] !== false;
        db.setCfg({ comunicacao: Object.assign({}, cfg, { blocos: Object.assign({}, cfg.blocos, { [b.id]: ligar }) }) });
        ledger.append({ actor: E.actors.user(me().id), acao: 'com.bloco_alterado', entidade: { kind: 'config', id: 'comunicacao.' + b.id }, resumo: `${b.rotulo}: ${ligar ? 'religado' : 'pausado'}. ${t}`, classe: 'R3', snapshot: { antes: { ligado: antes }, depois: { ligado: ligar } } });
        ui.toast(ligar ? 'Religado' : 'Pausado', { type: ligar ? 'success' : 'warn', text: b.rotulo });
        api.close(true);
      } })] });
    return m.promise.then((v) => v === true);
  }
  function secBlocos() {
    return ui.card({ title: 'Blocos da central', subtitle: 'Interruptores por função. Cada mudança pede motivo e vai à trilha.' },
      ui.live(['config'], () => h('div.cm6-blocos', BLOCOS.map((b) => {
        const on = (K.cfg().blocos || {})[b.id] !== false;
        return h('div.cm6-bloco', ui.switch({ checked: on, label: b.rotulo, hint: b.hint, aria: b.rotulo, onChange: async (v) => { const ok = await alterarBloco(b, v); if (!ok) db.setCfg({ comunicacao: Object.assign({}, K.cfg()) }); } }), on ? null : ui.badge('Pausado', 'amber', { dot: true }));
      }))));
  }

  const CAMPOS = [
    { grupo: 'limites', id: 'usuarioMsgHora', rotulo: 'Mensagens por usuário por hora', un: 'msgs' },
    { grupo: 'limites', id: 'usuarioAnexosDia', rotulo: 'Anexos por usuário por dia', un: 'anexos' },
    { grupo: 'limites', id: 'empresaMsgHora', rotulo: 'Mensagens por empresa por hora', un: 'msgs' },
    { grupo: 'sla', id: 'critica', rotulo: 'Primeira resposta, prioridade crítica', un: 'h úteis' },
    { grupo: 'sla', id: 'normal', rotulo: 'Primeira resposta, prioridade normal', un: 'h úteis' },
    { grupo: 'sla', id: 'baixa', rotulo: 'Primeira resposta, prioridade baixa', un: 'h úteis' },
    { grupo: 'sla', id: 'compliance', rotulo: 'Análise de alerta de contato', un: 'h úteis' },
  ];
  function secLimites() {
    const host = h('div');
    const draw = () => {
      const cfg = K.cfg(); const inputs = {};
      const linhas = CAMPOS.map((c) => { const inp = ui.input({ type: 'number', value: String((cfg[c.grupo] || {})[c.id] ?? ''), min: 1, aria: c.rotulo }); inputs[c.grupo + '.' + c.id] = inp; return ui.field({ label: c.rotulo, hint: c.un }, inp); });
      const aplicar = async () => {
        const novoCfg = Object.assign({}, K.cfg(), { limites: Object.assign({}, cfg.limites), sla: Object.assign({}, cfg.sla) }); const antes = {}; const depois = {};
        for (const c of CAMPOS) {
          const v = Number(inputs[c.grupo + '.' + c.id].value);
          if (!Number.isInteger(v) || v < 1) { ui.toast('Valor inválido', { type: 'error', text: `${c.rotulo}: use um número inteiro maior que zero.` }); return; }
          const ant = (cfg[c.grupo] || {})[c.id]; if (v !== ant) { antes[c.rotulo] = `${ant} ${c.un}`; depois[c.rotulo] = `${v} ${c.un}`; novoCfg[c.grupo][c.id] = v; }
        }
        if (!Object.keys(depois).length) { ui.toast('Nada mudou', { type: 'info', text: 'Altere ao menos um valor.' }); return; }
        const r = await Ops.solicitarOuAplicar({ tipo: 'config', titulo: 'Comunicação: limites e prazos', resumo: 'Ajustar limites de envio e prazos de atendimento da central de comunicação.', payload: { patch: { comunicacao: novoCfg } }, antes, depois, entidade: { kind: 'config', id: 'comunicacao' }, acaoDireto: 'config.comunicacao_aplicado_direto', resumoDireto: 'Limites e prazos da comunicação alterados: ' + Object.keys(depois).join(', '), aplicar: () => db.setCfg({ comunicacao: novoCfg }) });
        if (r && r.ok) draw();
      };
      C.mount(host, h('div.cm6-form', linhas), h('div.row.end', ui.btn('Revisar e aplicar', { variant: 'primary', icon: 'stamp', onclick: aplicar })));
    };
    draw();
    return ui.card({ title: 'Limites e prazos', subtitle: 'Valores de referência', actions: ui.badge('Valor de referência', 'amber', { icon: 'info' }) },
      ui.callout({ tone: 'info', text: 'Estes números são ponto de partida, não regra definitiva: calibre com o volume real depois do piloto. O prazo conta em horas úteis (dias úteis, das 8h às 18h).' }), host);
  }

  /* ------------------------------ autonomia ------------------------------ */
  async function promover() {
    const m = IA.metricas(CAT); const u = me(); const c = IA.catCfg(CAT);
    await Ops.solicitarOuAplicar({ tipo: 'autonomia', titulo: 'Agente de atendimento: informativa com fonte passa a autônoma', resumo: `Promoção com ${m.revisadas} respostas revisadas, ${Math.round(m.semEdicao * 1000) / 10}% sem edição e ${m.incidentes} incidente(s).`,
      payload: { categoriaCom: CAT, promovidoPor: u.id, agenteId: IA.AGENTE }, antes: { 'Informativa com fonte': 'Assistido' }, depois: { 'Informativa com fonte': 'Autônomo' },
      entidade: { kind: 'agente', id: IA.AGENTE }, acaoDireto: 'com.agente_promovido', resumoDireto: `Agente de atendimento promovido a autônomo na categoria informativa com fonte (${m.revisadas} revisadas, ${Math.round(m.semEdicao * 1000) / 10}% sem edição, ${m.incidentes} incidentes)`,
      aplicar: () => IA.aplicarPromocao(CAT, u.id) });
    void c;
  }
  function rebaixarModal() {
    const motivo = ui.input({ type: 'textarea', rows: 3, placeholder: 'Por que devolver ao modo assistido?' }); const campo = ui.field({ label: 'Motivo', required: true, hint: 'Mínimo de 10 caracteres. Vai à trilha como R3.' }, motivo);
    ui.modal({ title: 'Devolver ao modo assistido', icon: 'rotate-ccw', size: 'md', body: h('div.stack.tight', ui.callout({ tone: 'warn', text: 'O agente deixa de responder sozinho. Os rascunhos para a Mesa continuam e o ciclo de métricas recomeça.' }), campo),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Devolver', { variant: 'danger', onclick: () => { const t = String(motivo.value).trim(); if (t.length < 10) { campo.setError('Escreva ao menos 10 caracteres.'); return; } const r = IA.rebaixar(CAT, t, me().id); if (!r.ok) { campo.setError(r.erro); return; } api.close(); ui.toast('Categoria devolvida ao modo assistido', { type: 'success' }); } })] });
  }
  function secAutonomia() {
    return ui.live(['respostasIA', 'config', 'agentes', 'aprovacoes'], () => {
      const m = IA.metricas(CAT); const ag = db.get('agentes', IA.AGENTE) || {};
      const pend = db.where('aprovacoes', (a) => a.tipo === 'autonomia' && a.status === 'pendente' && a.payload && a.payload.categoriaCom === CAT).length;
      const acao = m.modo === 'autonomo'
        ? ui.btn('Devolver ao modo assistido', { variant: 'secondary', icon: 'rotate-ccw', onclick: rebaixarModal })
        : ui.btn('Promover a autônomo', { variant: 'primary', icon: 'arrow-up', disabled: !m.elegivel || !!pend, title: m.elegivel ? null : 'Os critérios de promoção ainda não foram atingidos.', onclick: promover });
      return ui.card({ title: 'Autonomia do agente de atendimento', subtitle: 'Por categoria. Só a informativa com fonte pode chegar a autônoma.', actions: ui.ai('Agente') },
        h('div.stack',
          UI.metricasIA(),
          m.simulado ? h('small.muted', 'Histórico simulado do protótipo. Os números ilustram o critério.') : null,
          h('div.cm6-cats', Object.entries(IA.CATEGORIAS).map(([id, c]) => h('div.cm6-cat',
            h('div.cm6-cat-h', h('strong', c.label), id === CAT ? (m.modo === 'autonomo' ? ui.badge('Autônomo', 'violet', { icon: 'sparkles' }) : ui.badge('Assistido', 'neutral')) : ui.badge('Sempre assistido', 'neutral', { icon: 'lock' })),
            h('small.muted', c.desc)))),
          m.incidentes ? ui.callout({ tone: 'warn', text: 'Há incidente no ciclo atual: a categoria não pode ser promovida até o ciclo recomeçar.' }) : null,
          pend ? ui.callout({ tone: 'info', text: 'Há uma promoção aguardando aprovação.' }) : null,
          h('div.row.end', ag.nivel === 'inativo' ? ui.badge('Agentes pausados pelo interruptor geral', 'amber', { dot: true }) : null, acao)));
    });
  }

  /* ------------------------------ demonstração ------------------------------ */
  function simularGateway() {
    const s = db.get('servicos', 'svc-gateway-ia'); if (!s) return;
    const cai = s.status === 'operacional';
    db.patch('servicos', s.id, { status: cai ? 'degradado' : 'operacional', ultimaChecagem: now() });
    ledger.append({ actor: E.actors.user(me().id), acao: cai ? 'demo.gateway_ia_degradado' : 'demo.gateway_ia_restaurado', entidade: { kind: 'servico', id: s.id }, resumo: `Demonstração: Gateway de IA ${cai ? 'degradado' : 'restaurado'} (modo degradado da comunicação ${cai ? 'ligado' : 'desligado'})`, classe: 'R2' });
    ui.toast(cai ? 'Gateway de IA degradado' : 'Gateway de IA restaurado', { type: cai ? 'warn' : 'success', text: cai ? 'Triagem e rascunhos saem do ar; as conversas seguem só com pessoas.' : 'Agentes de volta.' });
  }
  function secDemo() {
    return ui.live(['servicos', 'respostasIA', 'config'], () => {
      const d = IA.degradado(); const m = IA.metricas(CAT);
      return ui.card({ title: 'Demonstração', subtitle: 'Só para mostrar o comportamento no protótipo', actions: ui.badge('Simulado', 'neutral', { icon: 'info' }) },
        h('div.stack.tight',
          d.sim ? ui.callout({ tone: 'warn', icon: 'plug-zap', title: 'Modo degradado ligado', text: `${d.motivo} Triagem, rascunhos e respostas automáticas estão fora; o filtro de contato externo continua barrando o explícito.` }) : ui.callout({ tone: 'info', text: 'Agentes operando normalmente.' }),
          h('div.row', ui.btn(db.get('servicos', 'svc-gateway-ia') && db.get('servicos', 'svc-gateway-ia').status === 'operacional' ? 'Simular queda do gateway de IA' : 'Restaurar o gateway de IA', { variant: 'secondary', icon: 'plug-zap', onclick: simularGateway }),
            ui.btn('Simular incidente de promessa indevida', { variant: 'secondary', icon: 'triangle-alert', disabled: m.modo !== 'autonomo', title: m.modo === 'autonomo' ? null : 'A categoria já está em modo assistido.', onclick: () => { const r = IA.simularIncidente(me().id); r.ok ? ui.toast('Incidente simulado', { type: 'warn', text: 'A categoria voltou para o modo assistido e o ciclo recomeçou.' }) : ui.toast('Não foi possível', { type: 'error', text: r.erro }); } }))));
    });
  }
  /** cartão do painel de demonstração: simula a outra parte, o tempo, o gateway de IA e um incidente do agente */
  const convAtual = () => { const m = String(location.hash).match(/mensagens\/(CV-\d+)/); return m ? db.get('conversas', m[1]) : null; };
  UI.demoCard = function () {
    const u = me(); if (!u) return null;
    const comConversa = (fn) => () => { const c = convAtual(); if (!c) { ui.toast('Abra uma conversa primeiro', { type: 'info', text: 'Vá em Mensagens, abra a conversa e volte a este painel.' }); return; } fn(c); };
    return ui.card({ title: 'Comunicação', subtitle: 'Simula a outra parte, o tempo e o agente de atendimento' },
      h('div.demo-jumps',
        ui.btn('Simular resposta da outra parte', { size: 'sm', icon: 'messages-square', onclick: comConversa((c) => { const r = K.simularResposta(c.id); if (!r.ok) ui.toast('Não foi possível', { type: 'error', text: r.erro }); }) }),
        ui.btn('Avançar 2 h', { size: 'sm', icon: 'timer', onclick: () => { C.clock.advance(2 * 3600e3); E.tick(); ui.toast('Relógio avançou 2 h', { type: 'info', text: 'Prazos de atendimento e de alertas são reavaliados.' }); } }),
        ui.btn('Gerar tentativa de contato externo', { size: 'sm', icon: 'ban', onclick: comConversa((c) => { const r = K.enviar({ convId: c.id, userId: u.id, texto: 'Me liga no (11) 91234-5678 para combinarmos.' }); if (r.codigo === 'CONTATO_EXTERNO') ui.toast('Barrada pelo filtro', { type: 'warn', text: 'O compliance recebeu o alerta.' }); else if (!r.ok) ui.toast('Não foi possível', { type: 'error', text: r.erro }); }) })),
      h('div.sp-3'),
      h('div.demo-jumps',
        ui.btn(db.get('servicos', 'svc-gateway-ia') && db.get('servicos', 'svc-gateway-ia').status === 'operacional' ? 'Simular queda do gateway de IA' : 'Restaurar o gateway de IA', { size: 'sm', icon: 'plug-zap', onclick: simularGateway }),
        ui.btn('Simular incidente de promessa indevida', { size: 'sm', icon: 'triangle-alert', onclick: () => { const r = IA.simularIncidente(u.id); r.ok ? ui.toast('Incidente simulado', { type: 'warn', text: 'O agente voltou ao modo assistido.' }) : ui.toast('Não foi possível', { type: 'error', text: r.erro }); } })));
  };

  function pgSaudeComunicacao() {
    return h('div.sh-page.cm6-page',
      ui.pageHeader({ eyebrow: 'Superadmin · Plataforma', title: 'Saúde da comunicação', subtitle: 'Tempo de resposta, fila, alertas, custo de IA e controles da central de comunicação.', actions: ui.btn('Abrir a central da Mesa', { variant: 'secondary', icon: 'external-link', route: '/ops/comunicacao' }) }),
      secSaude(), h('div.cm6-cols', h('div.stack', secBlocos(), secLimites()), h('div.stack', secAutonomia(), secDemo())));
  }
  C.router.register({ path: '/super/comunicacao', roles: ['ops'], perfis: ['superadmin'], title: 'Saúde da comunicação', render: pgSaudeComunicacao });
})();
