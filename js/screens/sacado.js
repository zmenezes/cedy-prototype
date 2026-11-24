/* =========================================================================
   Cedy protótipo 0.1, Sacado (Rede Boa Compra, Ana Paula Ribeiro).
   Títulos a pagar com confirmação Confia, instruções de pagamento e
   conciliação via extrato, fornecedores. Programa silencioso nunca revela
   o financiamento: só NF, vencimento e conta de liquidação.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, fmt } = C; const ui = C.ui;
  const { db, session } = C.store; const E = C.engine;
  const F = C.flows; const cal = C.cal;
  const now = () => C.clock.now();
  const DAY = 86400000;

  /* ----------------------------- helpers -------------------------------- */
  const orgOf = (ctx) => ctx.org || db.get('orgs', session.get().orgId);
  const userOf = (ctx) => ctx.user || session.user();
  const onlyDigits = (v) => String(v || '').replace(/\D/g, '');
  const needOperar = () => C.can('operar');
  const noPerm = (p) => ({ disabled: true, title: C.cannotMsg(p) });
  const myTitulos = (orgId) => db.where('titulos', (t) => t.sacadoId === orgId);
  const prodOf = (t) => db.get('produtos', t.produto) || { nome: t.produto, silencioso: true };
  const silent = (t) => !!(prodOf(t) || {}).silencioso;
  /** programa só aparece para o sacado quando ele participa (Confia, Contrato); programa silencioso nunca revela o financiamento */
  const progLabel = (t) => (silent(t) ? (t.tipo || 'Título') : prodOf(t).nome);
  /** rótulo curto para eixos de valores em reais (a unidade vai no subtítulo do gráfico) */
  const axisBrl = (v) => (v === 0 ? '0' : v >= 1e6 ? (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi' : v >= 1e3 ? (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mil' : String(v));
  const cedenteOf = (t) => db.get('orgs', t.orgId) || null;
  const opOf = (t) => (t.operacaoId ? db.get('operacoes', t.operacaoId) : null);
  const aceiteOf = (t) => (t.lastro && t.lastro.aceiteSacado) || 'silencioso';
  /** status do título na visão do sacado (partição sem sobreposição) */
  function sacStatus(t) {
    const a = aceiteOf(t);
    if (t.status === 'liquidado') return 'pago';
    if (a === 'contestado') return 'contestado';
    if (a === 'pendente') return 'a_confirmar';
    if (t.status === 'vencido' || t.vencimento < cal.startOfDay(now())) return 'vencido';
    if (a === 'aceito') return 'confirmado';
    return 'a_vencer';
  }
  const ST_META = { a_confirmar: ['A confirmar', 'blue'], confirmado: ['Confirmado', 'green'], contestado: ['Contestado', 'red'], a_vencer: ['A vencer', 'teal'], vencido: ['Vencido', 'red'], pago: ['Pago', 'neutral'] };
  const sacBadge = (st) => { const m = ST_META[st] || [st, 'neutral']; return ui.badge(m[0], m[1], { dot: true }); };
  /** financiador só aparece para programa NÃO silencioso com cessão */
  function cessionarioDe(t) {
    if (silent(t)) return null;
    const op = opOf(t);
    if (!op || !op.financiadorId || !['paga', 'vencida', 'parcial', 'liquidada'].includes(op.status)) return null;
    return db.get('orgs', op.financiadorId) || null;
  }
  function contaDe(t) { const c = cedenteOf(t); return (c && c.contaLiquidacao) || null; }
  function copyText(t, okMsg) {
    const done = () => ui.toast('Copiado', { type: 'success', text: okMsg || t });
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fallback());
    else fallback();
    function fallback() {
      const ta = h('textarea', { style: 'position:fixed;opacity:0', value: t }); document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { ui.toast('Não foi possível copiar', { type: 'error', text: 'Selecione e copie manualmente: ' + t }); }
      ta.remove();
    }
  }
  function confirmarUm(t, onOk) {
    if (!needOperar()) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    if (aceiteOf(t) !== 'pendente') { ui.toast('Nada a confirmar', { type: 'info', text: 'Este título já foi respondido.' }); return; }
    const r = E.confirmarSacado(t.id, 'aceito', session.get().userId);
    if (r.ok) { ui.toast('Título confirmado', { type: 'success', text: `${t.numero} liberado para entrar em operação.` }); if (onOk) onOk(); }
    else ui.toast('Não foi possível confirmar', { type: 'error', text: r.erro });
  }
  function contestarModal(t, onOk) {
    if (!needOperar()) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    if (aceiteOf(t) !== 'pendente') { ui.toast('Nada a contestar', { type: 'info', text: 'Este título já foi respondido.' }); return; }
    const motivos = ['Valor divergente da entrega', 'Mercadoria não recebida', 'NF duplicada', 'Dados do sacado errados na NF', 'Outro motivo (descrever)'].map((m) => ({ value: m, label: m }));
    const sel = ui.select({ value: motivos[0].value, aria: 'Motivo da contestação', options: motivos });
    const txt = ui.input({ type: 'textarea', rows: 2, placeholder: 'Descreva a divergência (obrigatório).' });
    const wTxt = ui.field({ label: 'Detalhe', required: true }, txt);
    ui.modal({ title: 'Contestar ' + t.numero, subtitle: `${fmt.brl(t.valor)} · vencimento ${fmt.date(t.vencimento)}`, icon: 'flag', tone: 'red', size: 'sm',
      body: h('div.stack.tight',
        ui.callout({ tone: 'warn', title: 'O fornecedor é avisado na hora', text: 'A contestação trava o título para operação até a Mesa resolver. Use só com divergência real.' }),
        ui.field({ label: 'Motivo' }, sel), wTxt),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Enviar contestação', { variant: 'danger', onclick: () => {
        wTxt.setError(!String(txt.value).trim() ? 'Descreva a divergência.' : ''); if (!String(txt.value).trim()) return;
        const r = E.confirmarSacado(t.id, 'contestado', session.get().userId, `${sel.value}: ${String(txt.value).trim()}`);
        if (!r.ok) { ui.toast('Não foi possível contestar', { type: 'error', text: r.erro }); return; }
        ui.toast('Título contestado', { type: 'success', text: 'O fornecedor foi avisado e o título saiu da fila de confirmação.' });
        api.close(true); if (onOk) onOk();
      } })] });
  }
  /* -------------------------------- início --------------------------------- */
  function saudacao() { const t = cal.sp(now()); return t.h < 12 ? 'Bom dia' : t.h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function rHome(ctx) {
    const org = orgOf(ctx);
    return h('div.stack',
      ui.pageHeader({ eyebrow: `${org.fantasia || org.nome} · Sacado`, title: `${saudacao()}, ${String(userOf(ctx).nome).split(' ')[0]}`, subtitle: 'Confirme títulos Confia, pague na conta de liquidação do fornecedor e acompanhe a conciliação.', actions: [ui.btn('Pagar agora', { variant: 'primary', icon: 'banknote', onclick: () => ctx.go('/sacado/pagamentos') })] }),
      ui.live(['titulos', 'operacoes', 'extrato'], () => homeBody(ctx, org)));
  }
  function homeBody(ctx, org) {
    const ts = myTitulos(org.id);
    const pend = ts.filter((t) => sacStatus(t) === 'a_confirmar');
    const vencidos = ts.filter((t) => sacStatus(t) === 'vencido');
    const emAberto = ts.filter((t) => !['pago'].includes(sacStatus(t)));
    const hoje0 = cal.startOfDay(now());
    const a7 = emAberto.filter((t) => t.vencimento >= hoje0 && t.vencimento < hoje0 + 7 * DAY);
    const comp = (() => { const s = cal.sp(now()); return s.y + '-' + String(s.m).padStart(2, '0'); })();
    const pagoMes = ts.filter((t) => t.status === 'liquidado' && t.liquidadoEm && compOfTs(t.liquidadoEm) === comp);
    // contas a pagar por semana (próximas 8)
    const semanas = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ ini: hoje0 + i * 7 * DAY, fim: hoje0 + (i + 1) * 7 * DAY, label: i === 0 ? 'esta semana' : `+${i} sem` }));
    const porSem = semanas.map((s) => C.round2(C.sum(emAberto.filter((t) => t.vencimento >= s.ini && t.vencimento < s.fim), (t) => t.valor)));
    const atrasoW = C.round2(C.sum(vencidos, (t) => t.valor));
    // top fornecedores por volume
    const porCed = {};
    ts.forEach((t) => { porCed[t.orgId] = porCed[t.orgId] || { id: t.orgId, total: 0, n: 0 }; porCed[t.orgId].total += t.valor; porCed[t.orgId].n++; });
    const top = Object.values(porCed).sort((a, b) => b.total - a.total).slice(0, 5).map((g) => { const o = db.get('orgs', g.id); return { label: o ? (o.fantasia || o.nome) : g.id, value: Math.round(g.total), hint: fmt.plural(g.n, 'título', 'títulos') }; });
    // próximos vencimentos agrupados por dia
    const fut = emAberto.filter((t) => t.vencimento >= hoje0 - DAY).sort((a, b) => a.vencimento - b.vencimento).slice(0, 12);
    const grupos = C.groupBy(fut, (t) => cal.key(t.vencimento));
    const dias = Object.keys(grupos).sort().slice(0, 5);
    return h('div.stack',
      h('div.grid.g4.keep2',
        ui.kpi({ label: 'A pagar nos próximos 7 dias', value: Math.round(C.sum(a7, (t) => t.valor)), fmt: 'brl', icon: 'calendar-days', tone: a7.length ? 'amber' : null, hint: fmt.plural(a7.length, 'título', 'títulos'), onclick: () => ctx.go('/sacado/titulos') }),
        ui.kpi({ label: 'Aguardando sua confirmação', value: pend.length, icon: 'circle-question-mark', tone: pend.length ? 'blue' : null, hint: pend.length ? 'Programa Confia' : 'nada pendente', onclick: () => ctx.go('/sacado/titulos?st=a_confirmar') }),
        ui.kpi({ label: 'Em atraso', value: Math.round(C.sum(vencidos, (t) => t.valor)), fmt: 'brl', icon: 'triangle-alert', tone: vencidos.length ? 'red' : null, hint: fmt.plural(vencidos.length, 'título', 'títulos'), onclick: () => ctx.go('/sacado/titulos?st=vencido') }),
        ui.kpi({ label: 'Pago neste mês', value: Math.round(C.sum(pagoMes, (t) => t.valor)), fmt: 'brl', icon: 'circle-check', tone: 'green', hint: fmt.plural(pagoMes.length, 'título liquidado', 'títulos liquidados') })),
      pend.length ? ui.callout({ tone: 'info', icon: 'circle-question-mark', title: `${pend.length === 1 ? '1 título aguarda' : pend.length + ' títulos aguardam'} sua confirmação (Confia)`, text: 'Sem a sua confirmação o fornecedor não consegue antecipar. A contestação trava o título até a Mesa resolver.',
        actions: [ui.btn(`Confirmar agora`, Object.assign({ variant: 'primary', size: 'sm', icon: 'check', onclick: () => ctx.go('/sacado/titulos?st=a_confirmar') }, needOperar() ? {} : noPerm('operar')))] }) : null,
      vencidos.length ? ui.callout({ tone: 'error', icon: 'triangle-alert', title: 'Você tem títulos em atraso', text: `${fmt.brl(C.sum(vencidos, (t) => t.valor))} após o vencimento. Pague hoje na conta de liquidação do fornecedor para evitar a Mesa Conciliadora.`,
        actions: [ui.btn('Ver como pagar', { variant: 'secondary', size: 'sm', onclick: () => ctx.go('/sacado/pagamentos') })] }) : null,
      h('div.grid.g-main-side',
        h('div.stack',
          ui.card({ title: 'Próximos vencimentos', subtitle: 'Agrupados por dia, com o fornecedor e o valor.', actions: [ui.btn('Ver todos', { variant: 'ghost', size: 'sm', onclick: () => ctx.go('/sacado/titulos') })] },
            dias.length ? h('ul.sac-due', dias.map((d) => {
              const g = grupos[d];
              return h('li.sac-due-item', h('div.sac-due-dia', h('strong', fmt.dateShort(g[0].vencimento)), h('small', fmt.weekday(g[0].vencimento))),
                h('div.grow',
                  g.slice(0, 4).map((t) => { const c = cedenteOf(t); return h('div.sac-due-row', h('span.sac-due-name', `${c ? (c.fantasia || c.nome) : '—'} · ${t.numero}`), h('span.num.nowrap', fmt.brl(t.valor)), sacBadge(sacStatus(t))); }),
                  g.length > 4 ? h('div.small.muted', `+ ${fmt.plural(g.length - 4, 'título', 'títulos')}`) : null,
                  g.length > 1 ? h('div.sac-due-sum', h('span', 'Total do dia'), h('strong.num', fmt.brl(C.sum(g, (t) => t.valor)))) : null));
            })) : ui.empty({ icon: 'calendar-days', title: 'Nada a vencer', text: 'Nenhum título em aberto nos próximos dias.' })),
          ui.card({ title: 'Contas a pagar por semana', subtitle: 'Títulos em aberto nas próximas 8 semanas, mais o atraso, em reais.' },
            ui.chart.bars({ categories: ['em atraso', ...semanas.map((s) => s.label)], series: [{ name: 'A pagar', tone: 'amber', data: [Math.round(atrasoW), ...porSem.map(Math.round)] }], height: 220, format: axisBrl, tipFormat: (v) => fmt.brl(v) }))),
        h('div.stack',
          ui.card({ title: 'Ações', subtitle: 'O que só você pode fazer.' },
            h('div.stack.tight',
              ui.btn(`Confirmar títulos (${pend.length})`, Object.assign({ variant: 'primary', icon: 'check', block: true, onclick: () => ctx.go('/sacado/titulos?st=a_confirmar') }, (pend.length && needOperar()) ? {} : noPerm('operar'))),
              ui.btn('Pagar um vencimento', { variant: 'secondary', icon: 'banknote', block: true, onclick: () => ctx.go('/sacado/pagamentos') }),
              ui.btn('Falar com fornecedor', { variant: 'ghost', icon: 'message-circle', block: true, onclick: () => ctx.go('/sacado/fornecedores') }))),
          ui.card({ title: 'Principais fornecedores', subtitle: 'Por volume de títulos emitidos para você.' },
            top.length ? ui.chart.hbars(top, { format: (v) => fmt.brlCompact(v) }) : h('p.small.muted', 'Sem títulos.')))));
  }
  function compOfTs(ts) { const t = cal.sp(ts); return t.y + '-' + String(t.m).padStart(2, '0'); }
  /* ------------------------------- títulos --------------------------------- */
  const SAC_ST = [['todas', 'Todos'], ['a_confirmar', 'A confirmar'], ['confirmado', 'Confirmados'], ['contestado', 'Contestados'], ['a_vencer', 'A vencer'], ['vencido', 'Vencidos'], ['pago', 'Pagos']];
  function rTitulos(ctx) {
    let st = ctx.query.st || 'todas';
    let forn = ctx.query.forn || 'todos';
    let de = null, ate = null;
    let q = '';
    const sel = new Set();
    const wrap = h('div');
    const org = orgOf(ctx);
    const cedentes = [...new Map(myTitulos(org.id).map((t) => { const c = cedenteOf(t); return [t.orgId, c ? (c.fantasia || c.nome) : t.orgId]; })).entries()].map(([id, nome]) => ({ value: id, label: nome }));
    function filtrados() {
      let list = myTitulos(org.id);
      if (st !== 'todas') list = list.filter((t) => sacStatus(t) === st);
      if (forn !== 'todos') list = list.filter((t) => t.orgId === forn);
      if (de) list = list.filter((t) => t.vencimento >= de);
      if (ate) list = list.filter((t) => t.vencimento < ate + DAY);
      if (q) list = list.filter((t) => t.numero.toLowerCase().includes(q) || ((cedenteOf(t) || {}).nome || '').toLowerCase().includes(q) || ((cedenteOf(t) || {}).fantasia || '').toLowerCase().includes(q));
      return list.sort((a, b) => a.vencimento - b.vencimento);
    }
    function draw() {
      C.clear(wrap);
      const list = filtrados();
      const bulk = h('div');
      const tbl = ui.table({ rows: list, rowKey: (t) => t.id, selectable: needOperar(), selected: sel,
        onSelect: () => drawBulk(),
        onRowClick: (t) => drawerTitulo(ctx, t),
        empty: ui.empty({ icon: 'receipt-text', title: st === 'a_confirmar' ? 'Nada para confirmar' : 'Nenhum título aqui', text: st === 'a_confirmar' ? 'Todos os títulos Confia já foram respondidos.' : 'Ajuste os filtros para ver os títulos.', action: st === 'a_confirmar' ? null : ui.btn('Ver pagamentos', { onclick: () => ctx.go('/sacado/pagamentos') }) }),
        columns: [
          { key: 'nf', label: 'NF', mobile: 'primary', render: (t) => h('div', h('strong.mono', t.numero), h('div.small.muted', progLabel(t))) },
          { key: 'forn', label: 'Fornecedor', mobile: 'secondary', render: (t) => F.orgCell(cedenteOf(t), { sub: (cedenteOf(t) || {}).cidade ? `${cedenteOf(t).cidade}/${cedenteOf(t).uf}` : null }) },
          { key: 'venc', label: 'Vencimento', align: 'right', sort: (a, b) => a.vencimento - b.vencimento, render: (t) => h('div', h('div.num', fmt.date(t.vencimento)), h('div.small.muted', fmt.rel(t.vencimento))) },
          { key: 'valor', label: 'Valor', align: 'right', sort: (a, b) => a.valor - b.valor, render: (t) => h('span.num', { style: 'font-weight:650' }, fmt.brl(t.valor)) },
          { key: 'st', label: 'Status', render: (t) => sacBadge(sacStatus(t)) },
          { key: 'cred', label: 'Crédito', class: 'orig-col-wide', mobile: 'hide', render: (t) => credCell(t) },
        ] });
      wrap.append(bulk, ui.card({ flush: true, class: 'orig-tblcard' }, tbl)); drawBulk();
      function drawBulk() {
        C.clear(bulk);
        const ps = filtrados().filter((t) => sel.has(t.id) && aceiteOf(t) === 'pendente');
        if (!ps.length) return;
        bulk.append(ui.callout({ tone: 'info', icon: 'check', title: `${fmt.plural(ps.length, 'título pronto', 'títulos prontos')} para confirmar`,
          text: 'A confirmação libera o fornecedor para antecipar. Contestação é pelo detalhe de cada título.',
          actions: [ui.btn(`Confirmar ${ps.length}`, { variant: 'primary', size: 'sm', icon: 'check', onclick: () => {
            if (!needOperar()) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
            let n = 0;
            ps.forEach((t) => { const r = E.confirmarSacado(t.id, 'aceito', session.get().userId); if (r.ok) { n++; sel.delete(t.id); } });
            ui.toast(fmt.plural(n, 'título confirmado', 'títulos confirmados'), { type: 'success', text: n === 1 ? 'O fornecedor foi avisado.' : 'Os fornecedores foram avisados.' });
          } })] }));
      }
    }
    const stSel = ui.select({ value: st, aria: 'Status', options: SAC_ST.map(([v, l]) => ({ value: v, label: v === 'todas' ? 'Todos os status' : l, hint: v === 'todas' ? fmt.plural(myTitulos(org.id).length, 'título', 'títulos') : fmt.plural(myTitulos(org.id).filter((t) => sacStatus(t) === v).length, 'título', 'títulos') })), onChange: (v) => { st = v; draw(); } });
    const fornSel = ui.select({ value: forn, aria: 'Fornecedor', options: [{ value: 'todos', label: 'Todos os fornecedores' }, ...cedentes], onChange: (v) => { forn = v; draw(); } });
    const deCtl = ui.date({ aria: 'Vencimento de', placeholder: 'de', onChange: (v) => { de = v; draw(); } });
    const ateCtl = ui.date({ aria: 'Vencimento até', placeholder: 'até', onChange: (v) => { ate = v; draw(); } });
    const qCtl = ui.search({ placeholder: 'Buscar NF ou fornecedor', value: '', onInput: C.debounce((v) => { q = v.trim().toLowerCase(); draw(); }, 220) });
    draw();
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Sacado', title: 'Títulos a pagar', subtitle: 'Confirme o que é Confia, conteste divergências e veja onde pagar.', actions: pendCount(org) ? [ui.btn(`Confirmar pendentes (${pendCount(org)})`, { variant: 'primary', icon: 'check', onclick: () => { st = 'a_confirmar'; stSel.value = 'a_confirmar'; draw(); } })] : null }),
      ui.toolbar(qCtl, stSel, fornSel, deCtl, ateCtl),
      ui.live(['titulos', 'operacoes'], () => { draw(); return h('span'); }),
      wrap);
  }
  function pendCount(org) { return myTitulos(org.id).filter((t) => sacStatus(t) === 'a_confirmar').length; }
  /** o que aparece na coluna Crédito sem vazar programa silencioso */
  function credCell(t) {
    const st = t.status;
    if (st === 'liquidado') return h('span.small.muted', 'quitado');
    const ces = cessionarioDe(t);
    if (ces) return h('span.small', ui.badge('Crédito cedido', 'teal'), h('div.small.muted', `a ${ces.fantasia || ces.nome}`));
    if (st === 'cedido') return h('span.small.muted', 'a vencer');
    if (silent(t)) return h('span.small.muted', 'conta de liquidação');
    if (aceiteOf(t) === 'pendente') return ui.badge('Aguarda você', 'blue');
    return h('span.small.muted', 'com o fornecedor');
  }
  function drawerTitulo(ctx, t) {
    const c = cedenteOf(t);
    const st = sacStatus(t);
    const pend = aceiteOf(t) === 'pendente';
    const ces = cessionarioDe(t);
    const ct = contaDe(t);
    ui.drawer({ title: t.numero, subtitle: `${progLabel(t)} · ${fmt.brl(t.valor)} · vencimento ${fmt.date(t.vencimento)}`, icon: 'receipt-text', size: 'md',
      body: h('div.stack',
        h('div.row', sacBadge(st)),
        pend ? ui.callout({ tone: 'info', icon: 'circle-question-mark', title: 'Este título precisa da sua resposta', text: 'Confirmar libera o fornecedor para antecipar. Contestar trava o título até a Mesa resolver.' }) : null,
        st === 'contestado' ? ui.callout({ tone: 'error', title: 'Você contestou este título', text: (t.lastro && t.lastro.aceiteMotivo) || 'Motivo registrado na trilha.' }) : null,
        ui.kv([['Fornecedor', c ? (c.fantasia || c.nome) : '—'], ['CNPJ do emitente', c ? fmt.cnpj(c.cnpj) : '—'], ['Valor', fmt.brl(t.valor)], ['Vencimento', `${fmt.date(t.vencimento)} (${fmt.rel(t.vencimento)})`], ['Emissão', fmt.date(t.emissao)], ['Chave NF-e', h('span.mono.small', t.chave ? String(t.chave).slice(0, 22) + '…' : '—')]]),
        ces ? ui.card({ title: 'Crédito cedido', subtitle: 'Cessão notificada: você paga igual, na mesma conta.' },
          h('div.stack.tight', F.orgCell(ces),
            h('p.small.muted', 'A titularidade passou para este financiador, mas o banco repassa: pague na conta de liquidação abaixo.'))) : null,
        ct ? ui.card({ title: 'Onde pagar', subtitle: 'Conta de liquidação do fornecedor.' },
          h('div.stack.tight',
            ui.kv([['Banco', ct.banco], ['Agência / conta', `${ct.agencia} / ${ct.conta}`], ['Favorecido', ct.titular], ['Referência', t.numero]]),
            h('div.row', ui.btn('Copiar dados', { size: 'sm', icon: 'copy', onclick: () => copyText(`${ct.banco} · Ag ${ct.agencia} · Conta ${ct.conta} · ${ct.titular} · Ref ${t.numero} · ${fmt.brl(t.valor)}`, 'Dados para pagamento copiados.') }),
              ui.btn('Ir para pagamentos', { size: 'sm', variant: 'secondary', onclick: () => { C.router.go('/sacado/pagamentos'); } })))) : null,
        ui.card({ title: 'Histórico do título', subtitle: 'Confirmação e contestação.' }, (() => {
          const items = F.timelineItems('titulo', t.id).filter((it) => /sacado/i.test(it.title) || it.actor === userOf(ctx).nome);
          return items.length ? ui.timeline(items) : ui.empty({ icon: 'history', title: 'Sem eventos ainda', text: 'A sua resposta a este título aparece aqui.' });
        })())),
      footer: pend ? (api) => [ui.btn('Contestar', { variant: 'danger', icon: 'flag', onclick: () => { contestarModal(t, () => api.close()); } }), ui.btn('Confirmar título', Object.assign({ variant: 'primary', icon: 'check' }, needOperar() ? { onclick: () => confirmarUm(t, () => api.close()) } : noPerm('operar')))] : (api) => [ui.btn('Fechar', { variant: 'secondary', onclick: () => api.close() })] });
  }
  /* ------------------------------ pagamentos ------------------------------- */
  function rPagamentos(ctx) {
    const org = orgOf(ctx);
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Sacado', title: 'Pagamentos', subtitle: 'Pague na conta de liquidação do fornecedor. A conciliação é automática: valor exato liquida, o resto vai para a Mesa Conciliadora.' }),
      ui.live(['titulos', 'extrato', 'operacoes'], () => pagBody(ctx, org)));
  }
  const CONC = { conciliado: ['Conciliado', 'green', 'Liquidou o vencimento'], pendente_mesa: ['Em análise', 'amber', 'A Mesa Conciliadora confere em até 24 horas'], recurso_livre: ['Conciliado com diferença', 'teal', 'A diferença a mais fica com o fornecedor'], novo: ['Recebido', 'blue', 'Aguardando conciliação'] };
  function pagBody(ctx, org) {
    const hoje0 = cal.startOfDay(now());
    const abertos = myTitulos(org.id).filter((t) => sacStatus(t) !== 'pago');
    const porGrupo = {};
    abertos.forEach((t) => { const k = cal.key(t.vencimento) + '|' + t.orgId; (porGrupo[k] = porGrupo[k] || []).push(t); });
    const grupos = Object.keys(porGrupo).sort().map((k) => {
      const ts = porGrupo[k].sort((a, b) => a.valor - b.valor);
      return { key: k, dia: ts[0].vencimento, ced: cedenteOf(ts[0]), ts, total: C.round2(C.sum(ts, (t) => t.valor)) };
    });
    const hist = db.where('extrato', (x) => onlyDigits(x.pagadorCnpj) === onlyDigits(org.cnpj)).sort((a, b) => b.ts - a.ts).slice(0, 20);
    return h('div.stack',
      ui.callout({ tone: 'info', icon: 'landmark', title: 'Para onde vai o seu pagamento', text: 'Todo vencimento se paga na conta de liquidação do fornecedor, indicada em cada cartão abaixo. Pague o valor exato, na data, para não cair na Mesa Conciliadora.' }),
      grupos.length ? h('div.stack', grupos.map((g) => grupoCard(ctx, org, g))) : ui.empty({ icon: 'circle-check', title: 'Nada a pagar', text: 'Nenhum título em aberto.' }),
      ui.card({ class: 'orig-flat', title: 'Histórico de pagamentos', subtitle: 'Créditos que você enviou, com o resultado da conciliação.' },
        hist.length ? ui.table({ rows: hist, rowKey: (x) => x.id, columns: [
          { key: 'ts', label: 'Data', mobile: 'primary', render: (x) => h('div', h('div.num', fmt.date(x.ts)), h('div.small.muted', fmt.time(x.ts))) },
          { key: 'desc', label: 'Descrição', mobile: 'secondary', render: (x) => h('div', h('div.small', x.descricao || 'Crédito'), h('div.small.muted', (CONC[x.status] || CONC.novo)[2])) },
          { key: 'valor', label: 'Valor', align: 'right', render: (x) => h('span.num', { style: 'font-weight:650' }, fmt.brl(x.valor)) },
          { key: 'st', label: 'Conciliação', render: (x) => { const m = CONC[x.status] || CONC.novo; return ui.badge(m[0], m[1], { dot: true }); } },
        ] }) : ui.empty({ icon: 'inbox', title: 'Sem pagamentos ainda', text: 'Quando você pagar um vencimento pela simulação, o crédito aparece aqui.' })));
  }
  function grupoCard(ctx, org, g) {
    const ct = (g.ced && g.ced.contaLiquidacao) || null;
    const vencido = g.dia < cal.startOfDay(now());
    return ui.card({ title: h('span', `${fmt.dateLong(g.dia)} `, h('span.muted', `· ${g.ced ? (g.ced.fantasia || g.ced.nome) : 'fornecedor'}`)), subtitle: `${fmt.plural(g.ts.length, 'título', 'títulos')} · total ${fmt.brl(g.total)}${vencido ? ' · em atraso' : ''}`,
      actions: [vencido ? ui.badge('Em atraso', 'red', { dot: true }) : ui.badge(fmt.rel(g.dia), 'neutral')] },
      h('div.stack.tight', h('div.list', g.ts.map((t) => {
        const st = sacStatus(t);
        return h('div.sac-tit', sacBadge(st), h('div.grow', h('strong.mono.small', t.numero), h('div.small.muted', progLabel(t))), h('span.num.nowrap', { style: 'font-weight:650' }, fmt.brl(t.valor)),
          st === 'a_confirmar' ? ui.btn('Confirmar', { size: 'sm', variant: 'secondary', onclick: () => confirmarUm(t) }) : null);
      })),
      ct ? h('div.stack.tight', h('strong.small', 'Instruções de pagamento'),
        h('div.sac-paybox',
          [['Banco', ct.banco, false, 'Banco copiado.'], ['Agência / conta', `${ct.agencia} / ${ct.conta}`, true, 'Agência e conta copiadas.'], ['Favorecido', ct.titular, false, 'Favorecido copiado.'], ['Referência', g.ts.map((t) => t.numero).join(', '), true, 'Referência copiada.']].map(([lab, val, mono, msg]) =>
            h('div.sac-payline', h('div', h('div.small.muted', lab), h(mono ? 'strong.mono' : 'strong', val)), ui.iconBtn('copy', { label: `Copiar ${lab.toLowerCase()}`, size: 'sm', onclick: () => copyText(val, msg) }))))) : null,
      h('div.row.end', ui.btn('Copiar tudo', { variant: 'ghost', size: 'sm', icon: 'copy', onclick: () => copyText(`Pagar ${fmt.brl(g.total)} a ${ct ? ct.titular : ''} · ${ct ? ct.banco : ''} Ag ${ct ? ct.agencia : ''} Cc ${ct ? ct.conta : ''} · Ref ${g.ts.map((t) => t.numero).join(', ')}`, 'Instruções copiadas.') }),
        ui.btn('Pagar agora', Object.assign({ variant: 'primary', size: 'sm', icon: 'banknote' }, needOperar() ? { onclick: () => pagarModal(ctx, org, g) } : noPerm('operar'))))));
  }
  function pagarModal(ctx, org, g) {
    const valCtl = ui.currency({ value: g.total, aria: 'Valor a pagar' });
    const wVal = ui.field({ label: `Valor (vencimento: ${fmt.brl(g.total)})`, hint: 'Pague o valor exato para liquidar na hora. A diferença a mais fica com o fornecedor; a menos vai para a Mesa Conciliadora.', required: true }, valCtl);
    const formaCtl = ui.select({ value: 'pix', aria: 'Forma', options: [{ value: 'pix', label: 'Pix', hint: 'Compensa na hora' }, { value: 'ted', label: 'TED', hint: 'Mesmo dia útil' }] });
    const m = ui.modal({ title: `Pagar ${fmt.brl(g.total)}`, subtitle: `${g.ced ? (g.ced.fantasia || g.ced.nome) : ''} · ${fmt.date(g.dia)} (simulação do banco)`, icon: 'banknote', size: 'sm',
      body: h('div.stack.tight',
        ui.callout({ tone: 'info', title: 'Simulação do pagamento', text: 'O protótipo cria o crédito no extrato do fornecedor e roda a conciliação de verdade, com as mesmas regras da conta real.' }),
        wVal, ui.field({ label: 'Forma' }, formaCtl)),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Confirmar pagamento', { variant: 'primary', icon: 'send', onclick: () => {
        const v = valCtl.value;
        if (!(v > 0)) { wVal.setError('Informe um valor maior que zero.'); return; }
        wVal.setError('');
        const linha = E.entradaExtrato({ cedenteId: g.ced.id, valor: Math.round(v * 100) / 100, pagadorCnpj: org.cnpj, pagadorNome: org.nome, descricao: `${formaCtl.value === 'pix' ? 'Pix' : 'TED'} ${g.ts.map((t) => t.numero).join(', ')}` });
        const st = linha.status;
        if (st === 'conciliado') ui.toast('Pagamento conciliado', { type: 'success', text: `${fmt.brl(linha.valor)} liquidou o vencimento na conta do fornecedor.` });
        else if (st === 'recurso_livre') ui.toast('Pagamento conciliado com diferença', { type: 'success', text: `${fmt.brl(linha.valor)} recebido; a diferença a mais fica com o fornecedor.` });
        else ui.toast('Pagamento recebido', { type: 'warn', text: `${fmt.brl(linha.valor)} segue para a Mesa Conciliadora, que confere em até 24 horas. Pagamentos parciais ou fora da janela caem aqui.` });
        api.close(true);
      } })] });
    return m.promise;
  }

  /* ------------------------------ fornecedores ----------------------------- */
  function rFornecedores(ctx) {
    const org = orgOf(ctx);
    const ts = myTitulos(org.id);
    const ids = [...new Set(ts.map((t) => t.orgId))];
    const rows = ids.map((id) => {
      const lts = ts.filter((t) => t.orgId === id);
      const emAberto = lts.filter((t) => sacStatus(t) !== 'pago');
      const vencidos = lts.filter((t) => sacStatus(t) === 'vencido');
      const confia = lts.filter((t) => !silent(t));
      return { id, o: db.get('orgs', id), n: lts.length, total: C.round2(C.sum(lts, (t) => t.valor)), aberto: C.round2(C.sum(emAberto, (t) => t.valor)), vencidos: vencidos.length, confia: confia.length };
    }).sort((a, b) => b.total - a.total);
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Sacado', title: 'Fornecedores', subtitle: 'Quem emite títulos para você, com volumes, vencimentos e situação de cada um.' }),
      ui.card({ title: 'Sua pontualidade', subtitle: 'Média dos seus próprios pagamentos.' },
        h('div.row', h('div.sac-punct', h('strong.num', `${org.pagamentoMedioDias > 0 ? '+' : ''}${fmt.plural(org.pagamentoMedioDias, 'dia', 'dias')}`), h('small.muted', 'desvio médio do vencimento')),
          org.pagamentoMedioDias <= 1 ? ui.badge('Bom pagador', 'green', { dot: true }) : ui.badge('Atenção a atrasos', 'amber', { dot: true }),
          h('span.small.muted', 'Atrasos recorrentes travam confirmações e geram cobrança.'))),
      ui.card({ title: fmt.plural(rows.length, 'fornecedor', 'fornecedores'), subtitle: 'Toque para ver os títulos de cada um.' },
        rows.length ? h('div.list', rows.map((r) => h('button', { type: 'button', class: 'list-item clickable', onclick: () => drawerFornecedor(ctx, r) },
          ui.avatar(r.o ? (r.o.fantasia || r.o.nome) : '?', { size: 'sm', square: true }),
          h('div.grow', h('strong', r.o ? (r.o.fantasia || r.o.nome) : r.id), h('div.small.muted', `${fmt.plural(r.n, 'título', 'títulos')}${r.confia ? ' · inclui Confia' : ''}`)),
          h('div', { style: 'text-align:right' }, h('div.num', { style: 'font-weight:650' }, fmt.brlCompact(r.total)), r.vencidos ? h('div.small', ui.badge(fmt.plural(r.vencidos, 'vencido', 'vencidos'), 'red')) : h('div.small.muted.num', 'em aberto ' + fmt.brlCompact(r.aberto)))))) : ui.empty({ icon: 'factory', title: 'Sem fornecedores', text: 'Nenhum título emitido para você ainda.' })));
  }
  function drawerFornecedor(ctx, r) {
    const org = orgOf(ctx);
    const lts = myTitulos(org.id).filter((t) => t.orgId === r.id).sort((a, b) => a.vencimento - b.vencimento);
    const temConfia = lts.some((t) => !silent(t));
    ui.drawer({ title: r.o ? (r.o.fantasia || r.o.nome) : r.id, subtitle: `${fmt.plural(lts.length, 'título', 'títulos')} · ${fmt.brl(r.total)} no total`, icon: 'factory', size: 'md',
      body: h('div.stack',
        temConfia ? ui.callout({ tone: 'info', title: 'Títulos com confirmação', text: 'Os títulos Confia deste fornecedor precisam da sua resposta antes de o fornecedor poder antecipar.' }) : null,
        h('div.list', lts.map((t) => h('div.list-item', sacBadge(sacStatus(t)), h('div.grow', h('strong.mono.small', t.numero), h('div.small.muted', `${fmt.date(t.vencimento)} · ${progLabel(t)}`)), h('span.num', fmt.brl(t.valor)))))),
      footer: (api) => [ui.btn('Ver títulos', { variant: 'secondary', onclick: () => { api.close(); ctx.go('/sacado/titulos?forn=' + r.id); } }), ui.btn('Fechar', { variant: 'ghost', onclick: () => api.close() })] });
  }
  /* --------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/sacado', roles: ['sacado'], title: 'Início', render: rHome },
    { path: '/sacado/titulos', roles: ['sacado'], title: 'Títulos a pagar', render: rTitulos },
    { path: '/sacado/pagamentos', roles: ['sacado'], title: 'Pagamentos', render: rPagamentos },
    { path: '/sacado/fornecedores', roles: ['sacado'], title: 'Fornecedores', render: rFornecedores },
  ]);
})();
