/* =========================================================================
   Cedy, Central de comunicação: agente de atendimento na interface (S4).
   - painel "Agente de atendimento" na conversa da Mesa: triagem e rascunho
     (assistido: a pessoa revisa e envia; o envio registra se houve edição)
   - fonte e hora da consulta nas respostas do agente (C.comUI.msgFonte)
   - aba "Respostas de IA" em /ops/comunicacao: métricas de promoção e histórico
   Prefixo CSS: cm4-. O motor é E.ia.com (core/com-ia.js).
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt } = C;
  const ui = C.ui;
  const { db, session } = C.store;
  const E = C.engine; const K = E.com; const IA = E.ia.com; const UI = C.comUI;
  const me = () => session.user();
  const userName = (id) => { const u = id && db.get('users', id); return u ? u.nome : '—'; };
  const rasc = {}; const drafts = {}; // rascunho adotado e sugestão em exibição por conversa: sobrevivem ao redesenho do painel

  /* ------------------------------ fonte da resposta ------------------------------ */
  UI.msgFonte = function (m) {
    if (!m.ia || m.autor.tipo !== 'agente') return null;
    const f = m.ia.fonte;
    return h('div.cm4-fonte',
      f ? h('span.cm4-fonte-l', icon('link', 12), 'Fonte: ', f.rota ? h('a', { href: '#' + f.rota }, f.rotulo) : h('strong', f.rotulo), ' · consultado em ', fmt.datetime(f.ts || m.ts)) : null,
      h('span.cm4-fonte-n', icon('info', 12), m.ia.recusa ? 'Resposta automática. O agente não faz previsões nem promessas.' : 'Resposta automática e informativa: não é promessa nem decisão. Uma pessoa da Cedy acompanha o chamado.'));
  };

  /* ------------------------------ painel na conversa da Mesa ------------------------------ */
  UI.agentePanel = function (conv) {
    const u = me(); if (!K.isCedy(u) || u.papel === 'auditor') return null;
    if (!K.podeEscrever(conv, u).ok) return null;
    const host = h('div.stack.tight');
    let tri = null; let draft = drafts[conv.id] || null;
    const draw = () => {
      const d = IA.degradado();
      if (d.sim) { C.mount(host, ui.callout({ tone: 'warn', icon: 'plug-zap', title: 'Agente indisponível', text: `${d.motivo} Siga normalmente: a conversa, o prazo e as ações da Mesa não dependem dele.` })); return; }
      tri = IA.triagem(conv.id); const nodes = [];
      const cur = db.get('conversas', conv.id) || conv;
      if (tri.ok) {
        nodes.push(h('div.cm4-sug', h('small.muted', 'Sugestão de triagem'), h('strong', tri.rotulo), h('small', 'Fila sugerida: ', tri.filaLabel, ' · confiança ', fmt.pct(tri.confianca * 100, 0).replace(',0', ''))));
        nodes.push(h('p.cm4-resumo', tri.resumo));
        nodes.push(h('ul.cm4-why', tri.racional.map((x) => h('li', x))));
        if (tri.injecao) nodes.push(ui.callout({ tone: 'warn', icon: 'shield-alert', text: 'O texto do cliente trazia comandos dirigidos à IA. Foram ignorados: mensagens são tratadas como dado, nunca como instrução.' }));
        if (tri.diverge && cur.fila !== tri.fila) nodes.push(ui.btn('Encaminhar para ' + tri.filaLabel, { size: 'sm', variant: 'secondary', icon: 'arrow-right', onclick: () => { const r = K.atribuir(conv.id, { fila: tri.fila, responsavelId: null, nota: 'Encaminhado por sugestão do agente de atendimento.' }, me().id); r.ok ? ui.toast('Chamado encaminhado', { type: 'success', text: 'Fila: ' + tri.filaLabel }) : ui.toast('Não foi possível', { type: 'error', text: r.erro }); } }));
      }
      nodes.push(ui.btn(draft ? 'Gerar outra sugestão' : 'Sugerir resposta', { size: 'sm', variant: 'secondary', icon: 'sparkles', onclick: () => { const r = IA.rascunho(conv.id, me().id); if (!r.ok) { ui.toast('Agente indisponível', { type: 'warn', text: r.erro }); draw(); return; } draft = drafts[conv.id] = r; draw(); } }));
      if (draft) {
        nodes.push(h('div.cm4-draft', h('div.cm4-draft-h', ui.ai('Sugestão'), h('small', 'Rascunho para você revisar')), h('p', draft.texto),
          draft.fontes.length ? h('small.muted', 'Fontes: ', draft.fontes.map((f) => `${f.rotulo} (${f.valor}, ${fmt.time(f.ts)})`).join('; ')) : null,
          h('details.cm4-ctx', h('summary', 'O que o agente pode usar'), h('ul', draft.contexto.map((x) => h('li', x))), h('small.muted', IA.NAO_USA)),
          h('div.row', ui.btn('Usar no campo de resposta', { size: 'sm', variant: 'primary', icon: 'arrow-left', onclick: () => { if (UI.composerApi) { UI.composerApi.setTexto(draft.texto); rasc[conv.id] = { texto: draft.texto, categoria: draft.categoriaIA }; ui.toast('Sugestão no campo de resposta', { type: 'info', text: 'Revise, ajuste e envie. A resposta é sua.' }); } } }))));
      }
      C.mount(host, nodes);
    };
    draw();
    return ui.card({ title: 'Agente de atendimento', subtitle: 'Sugere; a decisão e o envio são seus.', class: 'cm4-card' }, ui.live(['config', 'servicos', 'agentes'], () => { draw(); return host; }));
  };

  /** a Mesa enviou depois de adotar um rascunho: registra se editou (alimenta a promoção) */
  UI.aposEnviarThread = function (conv, r) {
    const u = me(); const a = rasc[conv.id]; if (!a || !u || !K.isCedy(u) || !r || !r.msg) return;
    delete rasc[conv.id]; delete drafts[conv.id]; IA.registrarAssistida({ convId: conv.id, msgId: r.msg.id, categoria: a.categoria, sugerido: a.texto, final: r.msg.texto, userId: u.id });
  };

  /* ------------------------------ aba: respostas de IA ------------------------------ */
  const cat = 'informativa_fonte';
  const podeVer = (u) => K.isCedy(u) && (K.ehLider(u) || u.perfil === 'superadmin' || u.papel === 'auditor' || u.papel === 'compliance');
  const podeMarcar = (u) => K.isCedy(u) && (u.papel === 'compliance' || K.ehLider(u) || u.perfil === 'superadmin') && u.papel !== 'auditor';
  UI.metricasIA = function () {
    const m = IA.metricas(cat); const p = m.meta; const c = IA.catCfg(cat);
    const pct = (v) => Math.round(v * 1000) / 10 + '%';
    return h('div.cm4-met',
      ui.kpi({ icon: 'sparkles', label: 'Modo da categoria', display: m.modo === 'autonomo' ? 'Autônomo' : 'Assistido', hint: m.modo === 'autonomo' ? (c.desde ? 'desde ' + fmt.date(c.desde) : 'categoria informativa com fonte') : 'uma pessoa revisa cada resposta' }),
      ui.kpi({ icon: 'check-check', label: 'Revisadas no ciclo', display: `${m.revisadas} de ${p.revisadas}`, hint: m.faltam ? `faltam ${m.faltam}` : 'meta atingida' }),
      ui.kpi({ icon: 'pencil', label: 'Sem edição', display: m.revisadas ? pct(m.semEdicao) : '—', hint: `meta ${pct(p.semEdicao)}` }),
      ui.kpi({ icon: 'triangle-alert', tone: m.incidentes ? 'red' : null, label: 'Incidentes', display: String(m.incidentes), hint: `limite ${p.incidentes}` }));
  };
  function tabIA() {
    return ui.live(['respostasIA', 'config', 'agentes'], () => {
      const u = me(); const m = IA.metricas(cat);
      const rows = db.all('respostasIA').filter((r) => r.categoria === cat).sort((a, b) => b.ts - a.ts);
      return h('div.stack',
        ui.callout({ tone: 'ai', icon: 'sparkles', title: 'Como o agente chega a responder sozinho', text: `Só a categoria "informativa com fonte" pode virar autônoma: respostas que citam um dado do sistema, com a fonte e a hora da consulta. Para isso, o agente precisa de ${m.meta.revisadas} respostas revisadas por pessoas, ${Math.round(m.meta.semEdicao * 100)}% sem edição e nenhum incidente. A promoção passa pela aprovação do Superadmin. Qualquer incidente devolve a categoria para o modo assistido na hora.` }),
        m.simulado ? ui.callout({ tone: 'info', icon: 'info', text: 'Histórico simulado para o protótipo: os números ilustram o critério, não uma operação real.' }) : null,
        UI.metricasIA(),
        ui.card({ title: 'Respostas registradas', subtitle: 'Mais recentes primeiro. Marque incidente se uma resposta prometeu algo ou expôs dado indevido.' },
          ui.table({ rows, rowKey: (r) => r.id, pageSize: 10, empty: ui.empty({ icon: 'sparkles', title: 'Nenhuma resposta registrada ainda' }),
            columns: [
              { key: 't', label: 'Quando', render: (r) => h('span.nowrap', fmt.datetime(r.ts)) },
              { key: 'm', label: 'Modo', mobile: 'primary', render: (r) => (r.modo === 'autonomo' ? ui.badge('Autônoma', 'violet', { icon: 'sparkles' }) : ui.badge('Assistida', 'neutral')) },
              { key: 'e', label: 'Revisão', render: (r) => (r.modo === 'autonomo' ? h('small.muted', 'Sem revisão prévia') : h('div.cell-main', h('span', r.editada ? 'Com edição' : 'Sem edição'), h('small', userName(r.revisadaPor)))) },
              { key: 'c', label: 'Conversa', mobile: 'hide', render: (r) => (r.convId ? h('span.mono', r.convId) : h('small.muted', r.simulado ? 'Simulado' : '—')) },
              { key: 'i', label: 'Incidente', render: (r) => (r.incidente ? ui.badge(r.incidente === 'vazamento' ? 'Vazamento' : 'Promessa', 'red', { dot: true }) : h('small.muted', '—')) },
              { key: 'a', label: '', render: (r) => (r.incidente || !podeMarcar(u) ? null : ui.btn('Marcar incidente', { size: 'sm', variant: 'ghost', onclick: (e) => { e.stopPropagation(); incidenteModal(r); } })) },
            ] })));
    });
  }
  function incidenteModal(r) {
    let tipo = 'promessa';
    ui.modal({ title: 'Marcar incidente', icon: 'triangle-alert', size: 'md',
      body: h('div.stack.tight', ui.radio({ aria: 'Tipo de incidente', value: tipo, options: [{ value: 'promessa', label: 'Promessa indevida', hint: 'A resposta prometeu prazo, resultado ou aprovação.' }, { value: 'vazamento', label: 'Vazamento de dado', hint: 'A resposta expôs dado que o cliente não deveria ver.' }], onChange: (v) => { tipo = v; } }),
        ui.callout({ tone: 'warn', text: 'A categoria volta para o modo assistido na hora e o ciclo de métricas recomeça. Fica na trilha como R3.' })),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close() }), ui.btn('Marcar e rebaixar', { variant: 'danger', onclick: () => { const x = IA.registrarIncidente(r.id, tipo, me().id); if (!x.ok) { ui.toast('Não foi possível', { type: 'error', text: x.erro }); return; } api.close(); ui.toast('Incidente registrado', { type: 'success', text: 'Categoria devolvida ao modo assistido.' }); } })] });
  }
  UI.opsTabs.push({ id: 'ia', label: 'Respostas de IA', icon: 'sparkles', ordem: 40, visivel: podeVer, render: tabIA });
})();
