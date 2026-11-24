/* =========================================================================
   Cedy cedente2: Operações (lista + detalhe), Conta de liquidação, Limites
   e sacados, Relatórios. Persona principal: Marina Aguiar (c-aurora).
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { h, icon, fmt, cal } = C;
  const ui = C.ui;
  const { db, ledger, notify, session } = C.store;
  const E = C.engine;
  const F = C.flows;

  const now = () => C.clock.now();
  const me = () => session.get() || {};
  const myOrgId = () => me().orgId;
  const myUserId = () => me().userId;
  const myOrg = () => db.get('orgs', myOrgId());
  const can = (p) => C.can(p);
  const noPerm = (p) => ({ disabled: true, title: C.cannotMsg(p) });
  const myOps = () => db.where('operacoes', (o) => o.cedenteId === myOrgId()).sort((a, b) => (b.publicadaEm || b.criadaEm) - (a.publicadaEm || a.criadaEm));
  const prodName = (id) => (db.get('produtos', id) || {}).nome || id;
  const sacName = (id) => (db.get('orgs', id) || {}).fantasia || id;
  const finName = (id) => (db.get('orgs', id) || {}).fantasia || id;

  /** Letras estáveis por operação para financiadores anônimos na Vitrine. */
  function anonMap(opId) {
    const ids = [...new Set(E.lancesDaOp(opId).map((l) => l.finId))].sort();
    const m = {};
    ids.forEach((id, i) => { m[id] = 'ABCDEF'[i] || ('F' + (i + 1)); });
    return m;
  }
  const anonLabel = (op, finId) => (op.canal === 'balcao' ? finName(finId) : 'Financiador ' + (anonMap(op.id)[finId] || '?'));

  function condicao(op) {
    if (op.status === 'aberta') {
      const ls = E.lancesDaOp(op.id).filter((l) => ['ativo', 'superado'].includes(l.status));
      if (!ls.length) return 'Sem ofertas';
      const m = E.melhorLance(op.id);
      return `${fmt.taxa(m.taxaAm)} · ${ls.length} oferta${ls.length === 1 ? '' : 's'}`;
    }
    return op.taxaFinal ? fmt.taxa(op.taxaFinal) : '—';
  }

  /** [texto, timestampParaCountdown|null] */
  function proximoPasso(op) {
    switch (op.status) {
      case 'aberta': {
        const m = E.melhorLance(op.id);
        return [m ? 'Aceitar a melhor oferta' : 'Aguardar ofertas do mercado', op.validadeAte];
      }
      case 'cessao': {
        const ct = op.contratoId && db.get('contratos', op.contratoId);
        const signed = ct && ct.assinaturas.some((s) => s.parte === 'cedente');
        return [signed ? 'Aguardar assinatura do financiador' : 'Assinar a cessão', null];
      }
      case 'aguardando_pagamento': return ['Receber até o limite', op.pagamentoLimite];
      case 'paga': {
        const fut = (op.planoSacado || []).filter((p) => !p.emitido);
        if (!fut.length) return ['Aguardar conciliação', null];
        const nx = Math.min(...fut.map((p) => p.ts));
        return [`Próximo recebimento ${fmt.date(nx)}`, nx];
      }
      case 'vencida':
      case 'parcial':
        return [op.recompra && op.recompra.status === 'devida' ? 'Pagar a recompra' : 'Acompanhar cobrança do sacado', (op.recompra && op.recompra.ate) || null];
      case 'liquidada': return ['Liquidada, repasse ao financiador agendado', null];
      case 'recomprada': return ['Recomprada, títulos de volta com você', null];
      case 'cancelada': return ['Cancelada, títulos liberados', null];
      case 'expirada': return ['Expirou sem aceite, títulos liberados', null];
      default: return ['—', null];
    }
  }

  function precisaAcao(op) {
    if (op.status === 'cessao') {
      const ct = op.contratoId && db.get('contratos', op.contratoId);
      return !(ct && ct.assinaturas.some((s) => s.parte === 'cedente'));
    }
    if (op.status === 'aberta') return !!E.melhorLance(op.id);
    if (op.status === 'aguardando_pagamento') return now() > op.pagamentoLimite;
    if (['vencida', 'parcial'].includes(op.status)) return !!(op.recompra && op.recompra.status === 'devida');
    return false;
  }

  const canalBadge = (op) => ui.badge(op.canal === 'vitrine' ? 'Vitrine' : 'Balcão', op.canal === 'vitrine' ? 'blue' : 'teal');

  /* ============================ /cedente/operacoes ============================ */
  function listaOperacoes() {
    let seg = 'todas', q = '', prog = 'todos', canais = [];
    const refiltrar = () => C.store.emit('ced2-fop');
    const progs = [...new Set(myOps().map((o) => o.produto))];
    const qCtl = ui.search({ placeholder: 'Buscar por ID (OP-26-…)', onInput: C.debounce((v) => { q = v.trim().toLowerCase(); refiltrar(); }, 220) });
    const progCtl = ui.select({ value: prog, aria: 'Programa', options: [{ value: 'todos', label: 'Todos os programas' }, ...progs.map((p) => ({ value: p, label: prodName(p) }))], onChange: (v) => { prog = v; refiltrar(); } });
    const canalCtl = ui.chips({ value: canais, aria: 'Canal', options: [{ value: 'vitrine', label: 'Vitrine' }, { value: 'balcao', label: 'Balcão' }], onChange: (v) => { canais = v; refiltrar(); } });

    const ENCERRADAS = ['liquidada', 'recomprada', 'cancelada', 'expirada'];
    const SEGS = {
      todas: () => true,
      aberta: (o) => o.status === 'aberta',
      acao: precisaAcao,
      vencer: (o) => o.status === 'paga',
      encerradas: (o) => ENCERRADAS.includes(o.status),
    };
    function filtradas() {
      return myOps().filter((o) => SEGS[seg](o) && (prog === 'todos' || o.produto === prog) && (!canais.length || canais.includes(o.canal)) && (!q || o.id.toLowerCase().includes(q)));
    }
    const segBox = ui.live(['operacoes', 'lances', 'contratos'], () => {
      const all = myOps();
      const n = (k) => all.filter(SEGS[k]).length;
      return ui.segmented({ value: seg, aria: 'Filtrar por situação', options: [
        { value: 'todas', label: 'Todas', count: n('todas') }, { value: 'aberta', label: 'Em leilão', count: n('aberta') },
        { value: 'acao', label: 'Aguardando você', count: n('acao') }, { value: 'vencer', label: 'A vencer', count: n('vencer') },
        { value: 'encerradas', label: 'Encerradas', count: n('encerradas') },
      ], onChange: (v) => { seg = v; refiltrar(); } });
    });
    const tabela = ui.live(['operacoes', 'lances', 'contratos', 'ced2-fop'], () => ui.table({
      columns: [
        { key: 'id', label: 'Operação', mobile: 'primary', render: (o) => h('div', h('span', { class: ['mono', 'cd2-opid'] }, o.id), h('div.cd2-chan', canalBadge(o), h('span.small.muted', prodName(o.produto)))) },
        { key: 'face', label: 'Face', align: 'right', sort: (a, b) => a.face - b.face, render: (o) => h('div', h('strong.num.nowrap', fmt.brl(o.face)), h('div.small.muted.nowrap', `${fmt.plural(o.tituloIds.length, 'título', 'títulos')}${o.prazoMedio ? ' · ' + o.prazoMedio + ' d' : ''}`)) },
        { key: 'cond', label: 'Condição', mobile: 'hide', render: (o) => h('span.num.nowrap', condicao(o)) },
        { key: 'liq', label: 'Líquido', align: 'right', mobile: 'hide', sort: (a, b) => (a.liquido || 0) - (b.liquido || 0), render: (o) => h('span.num.nowrap', o.liquido ? fmt.brl(o.liquido) : '—') },
        { key: 'st', label: 'Situação', render: (o) => ui.status('operacao', o.status) },
        { key: 'next', label: 'Próximo passo', mobile: 'secondary', render: (o) => { const [t, ts] = proximoPasso(o); return h('div.cd2-next', h('span.small', t), ts ? ui.countdown(ts, { endLabel: 'prazo estourado' }) : null); } },
      ],
      rows: filtradas(), rowKey: (o) => o.id, onRowClick: (o) => C.router.go('/cedente/operacoes/' + o.id),
      rowClass: (o) => (precisaAcao(o) ? 'cd2-need' : ''),
      empty: ui.empty({ icon: 'repeat', title: 'Nenhuma operação aqui', text: 'Ajuste os filtros ou publique uma operação a partir dos títulos disponíveis.', action: ui.btn('Ver títulos', { route: '/cedente/titulos' }) }),
    }));
    return h('div.stack',
      ui.pageHeader({ title: 'Operações', subtitle: 'Leilões, aceite, cessão e recebimento, tudo com a trilha registrada.', actions: [ui.btn('Nova operação', Object.assign({ variant: 'primary', icon: 'plus', route: '/cedente/nova-operacao' }, can('publicar') ? {} : noPerm('publicar')))] }),
      h('div.stack.tight', segBox, ui.toolbar(qCtl, progCtl, canalCtl)),
      tabela);
  }

  /* ========================= /cedente/operacoes/:id ========================= */
  const STEPS = ['Publicada', 'Leilão', 'Aceite', 'Cessão assinada', 'Paga', 'Liquidada'];
  function stepIndex(op) {
    switch (op.status) {
      case 'aberta': return 1;
      case 'cessao': return 3;
      case 'aguardando_pagamento': case 'paga': case 'vencida': case 'parcial': return 4;
      case 'liquidada': case 'recomprada': return 6;
      default: return 1;
    }
  }

  function detalheOperacao(ctx) {
    const op0 = db.get('operacoes', ctx.params.id);
    if (!op0 || op0.cedenteId !== myOrgId()) {
      ui.toast('Operação não encontrada', { type: 'warn', text: 'Verifique o identificador ou a empresa da sessão.' });
      setTimeout(() => C.router.go('/cedente/operacoes'), 30);
      return h('div', ui.pageHeader({ title: 'Operação', back: '/cedente/operacoes' }), ui.empty({ icon: 'search', title: 'Operação não encontrada', text: 'Ela pode ser de outra empresa ou o identificador está errado.' }));
    }
    const opId = op0.id;
    return h('div.stack', ui.live(['operacoes', 'lances', 'contratos', 'titulos', 'ledger'], () => {
      const op = db.get('operacoes', opId);
      if (!op) return ui.empty({ icon: 'search', title: 'Operação não encontrada' });
      const term = ['cancelada', 'expirada'].includes(op.status);
      const aviso = term ? ui.callout({ tone: op.status === 'cancelada' ? 'error' : 'warn', title: op.status === 'cancelada' ? 'Operação cancelada' : 'Leilão expirado sem aceite', text: 'Os títulos voltaram a ficar disponíveis para uma nova publicação.' })
        : ['vencida', 'parcial'].includes(op.status) ? ui.callout({ tone: 'error', title: op.status === 'vencida' ? 'Operação vencida' : 'Liquidação parcial', text: 'Veja abaixo o saldo em aberto, o sacado e a recompra, quando devida.' })
        : ['liquidada', 'recomprada'].includes(op.status) ? ui.callout({ tone: 'success', title: op.status === 'liquidada' ? 'Operação liquidada' : 'Operação recomprada', text: 'Resumo do encerramento abaixo, com a trilha completa ao lado.' }) : null;
      let mainNode;
      if (op.status === 'aberta') mainNode = leilao(op);
      else if (op.status === 'cessao') mainNode = secaoCessao(op);
      else if (op.status === 'aguardando_pagamento') mainNode = secaoAguardando(op);
      else if (op.status === 'paga') mainNode = secaoAgenda(op);
      else if (['vencida', 'parcial'].includes(op.status)) mainNode = secaoVencida(op);
      else mainNode = secaoEncerrada(op);
      return h('div.stack',
        ui.pageHeader({ title: op.id, back: '/cedente/operacoes', eyebrow: `${op.canal === 'vitrine' ? 'Vitrine' : 'Balcão'} · ${prodName(op.produto)}`,
          subtitle: `${fmt.plural(op.tituloIds.length, 'título', 'títulos')} · face ${fmt.brl(op.face)}${op.prazoMedio ? ` · prazo médio ${op.prazoMedio} dias` : ''}`,
          actions: [ui.status('operacao', op.status), C.comUI.btnConversar({ kind: 'operacao', id: op.id }, { rotulo: 'Operação ' + op.id })] }),
        aviso,
        ui.stepper(STEPS, stepIndex(op)),
        h('div.detail-grid', mainNode, ladoOp(op)));
    }));
  }

  /* ---- aberta: ofertas ao vivo ---- */
  function leilao(op) {
    const canAceitar = can('aceitar');
    const list = ui.live(['lances', 'operacoes'], () => {
      const o = db.get('operacoes', op.id);
      const ls = E.lancesDaOp(o.id).filter((l) => ['ativo', 'superado'].includes(l.status)).sort((a, b) => a.taxaAm - b.taxaAm || a.criadoEm - b.criadoEm);
      if (!ls.length) {
        const sug = E.ia.sugerirTaxa(o);
        return h('div.stack', ui.empty({ icon: 'gavel', title: 'Sem ofertas ainda', text: `Validade até ${fmt.datetime(o.validadeAte)}. O mercado simulado envia ofertas a cada poucos segundos.` }),
          ui.card({ title: 'Sugestão da precificação', subtitle: 'Agente de Precificação, em sombra', class: 'card-ai' },
            h('div.stack.tight', h('div', ui.ai(`Taxa sugerida ${fmt.taxa(sug.sugerida)}`)), h('div.small.muted', `Faixa de ${fmt.taxa(sug.faixa[0])} a ${fmt.taxa(sug.faixa[1])}, mediana de ${fmt.plural(sug.amostra, 'operação', 'operações')} ${prodName(o.produto)}.`),
              h('ul.ced-why', sug.racional.map((r) => h('li.small', r))),
              h('div', ui.btn(o.tetoTaxa ? 'Revisar teto de aceite' : 'Usar como teto de aceite', Object.assign({ variant: 'ai', size: 'sm', icon: 'sparkles', onclick: () => tetoModal(o) }, canAceitar ? {} : noPerm('aceitar')))))));
      }
      const best = ls[0];
      const met = E.metricasOp(o, best.taxaAm);
      const rows = ls.map((l, i) => {
        const m2 = E.metricasOp(o, l.taxaAm);
        return h('div.cd2-offer', { class: i === 0 && 'is-best' },
          h('div.cd2-offer-main', h('div.cd2-offer-taxa.num', fmt.taxa(l.taxaAm)), h('div.cd2-offer-sub', `${anonLabel(o, l.finId)} · líquido ${fmt.brl(m2.liquido)} · CET ${fmt.taxa(m2.cetAm)}`)),
          i === 0 ? ui.badge('Líder', 'green') : ui.badge('Superada', 'amber'),
          h('div.cd2-offer-sub', l.firmeAte > now() ? ['Firme ', ui.countdown(l.firmeAte, { endLabel: 'liberada' })] : 'Firmeza encerrada', l.auto ? h('div', ui.ai('Lance automático')) : null));
      });
      const series = ls.length > 1 ? [{ name: 'Taxa', tone: 'blue', data: ls.slice().sort((a, b) => a.criadoEm - b.criadoEm).map((l) => ({ x: fmt.time(l.criadoEm), y: l.taxaAm })) }] : null;
      return h('div.stack',
        ui.card({ title: 'Melhor oferta', actions: [ui.countdown(o.validadeAte, { prefix: 'Validade', endLabel: 'leilão encerrado' })] },
          h('div.cd2-kv-hero', h('span.cd2-best-liq.num', fmt.brl(met.liquido)), h('span', ui.badge(fmt.taxa(best.taxaAm), 'green'))),
          h('div.small.muted', `Deságio ${fmt.brl(met.desagioValor)} (${fmt.pct(met.desagioPct)}) · CET ${fmt.taxa(met.cetAm)} · ${anonLabel(o, best.finId)}`),
          h('div.row.cd2-hero-act', canAceitar ? ui.btn('Aceitar esta oferta', { variant: 'primary', icon: 'circle-check', onclick: () => aceitarModal(o, best) })
            : ui.btn('Aceitar esta oferta', { variant: 'primary', icon: 'circle-check', disabled: true, title: C.cannotMsg('aceitar') })),
          !canAceitar ? h('div.small.muted', 'Seu perfil é de leitura: o aceite precisa de um administrador ou operador.') : null),
        ui.card({ title: `Ofertas ao vivo (${ls.length})`, subtitle: o.canal === 'vitrine' ? 'Identidade do financiador oculta até o aceite.' : 'Balcão: financiador identificado.' }, h('div.stack.tight', rows)),
        series ? ui.card({ title: 'Taxa ao longo do leilão', subtitle: 'Ofertas em ordem de chegada.' }, ui.chart.line({ series, height: 200, zero: false, format: (v) => fmt.taxa(v), tipFormat: (v) => fmt.taxa(v) })) : null);
    });
    const tetoCard = ui.live(['operacoes'], () => {
      const o = db.get('operacoes', op.id);
      return ui.card({ title: 'Teto de aceite automático', subtitle: o.tetoTaxa ? `Fecha sozinho até ${fmt.taxa(o.tetoTaxa)}` : 'Desligado' },
        h('div.stack.tight', h('div.small.muted', o.tetoTaxa ? 'Se uma oferta chegar a essa taxa ou abaixo, o motor aceita na hora e registra na trilha.' : 'Defina um teto e não precise acompanhar o leilão minuto a minuto.'),
          h('div.row', canAceitar ? ui.btn(o.tetoTaxa ? 'Editar teto' : 'Definir teto', { variant: 'secondary', size: 'sm', onclick: () => tetoModal(o) })
            : ui.btn(o.tetoTaxa ? 'Editar teto' : 'Definir teto', { variant: 'secondary', size: 'sm', disabled: true, title: C.cannotMsg('aceitar') }),
            o.tetoTaxa && can('aceitar') ? ui.btn('Remover teto', { variant: 'ghost', size: 'sm', onclick: () => { db.patch('operacoes', o.id, { tetoTaxa: null }); ledger.append({ actor: E.actors.user(myUserId()), acao: 'operacao.teto_alterado', entidade: { kind: 'operacao', id: o.id }, resumo: `Teto de aceite automático removido em ${o.id}`, classe: 'R2' }); } }) : null)));
    });
    const cancel = can('aceitar') ? h('div.row.end', ui.btn('Cancelar operação', { variant: 'danger', onclick: async () => {
      if (!await ui.confirm({ title: 'Cancelar ' + op.id + '?', text: 'Os títulos voltam a ficar disponíveis e as ofertas são encerradas.', tone: 'danger', confirmLabel: 'Cancelar operação' })) return;
      const r = E.cancelarOperacao(op.id, myUserId(), 'Cancelada pelo cedente no detalhe');
      if (r.ok) ui.toast('Operação cancelada', { type: 'success' });
      else ui.toast('Não foi possível cancelar', { type: 'error', text: r.erro });
    } })) : null;
    return h('div.stack', list, C.comUI.esclarecimentosCard(op.id), tetoCard, cancel);
  }

  function aceitarModal(op, lance) {
    const met = E.metricasOp(op, lance.taxaAm);
    const pg = E.prazoPagamento(now());
    const confirmBtn = ui.btn('Aceitar oferta', { variant: 'primary', disabled: true, onclick: async () => {
      const r = E.aceitarLance(op.id, lance.id, { userId: myUserId(), snapshotTela: { tela: 'Aceite da oferta (detalhe da operação)', taxaExibida: lance.taxaAm, liquidoExibido: met.liquido, cetExibido: Math.round(met.cetAm * 100) / 100 } });
      if (!r.ok) {
        if (r.codigo === 'NAO_MELHOR') { ui.toast('Chegou oferta menor', { type: 'warn', text: 'A lista foi atualizada. Confira a nova líder antes de aceitar.' }); m.close(false); }
        else ui.toast('Não foi possível aceitar', { type: 'error', text: r.erro });
        return;
      }
      ui.toast('Oferta aceita', { type: 'success', text: `Líquido ${fmt.brl(met.liquido)}, pagamento até ${fmt.datetime(pg.limite)}.` });
      m.close(true);
    } });
    const chk = ui.checkbox({ label: 'Entendo que vale a menor taxa no momento do aceite', hint: 'Se chegar oferta menor antes de confirmar, o aceite usa a menor.', onChange: (v) => { confirmBtn.disabled = !v; } });
    const m = ui.modal({ title: 'Aceitar ' + fmt.taxa(lance.taxaAm) + ' em ' + op.id, subtitle: anonLabel(op, lance.finId), icon: 'circle-check',
      body: h('div.stack.tight',
        ui.callout({ tone: 'info', title: pg.mesmoDia ? 'Pagamento hoje' : 'Pagamento no próximo dia útil', text: `Aceite agora: fundos até ${fmt.datetime(pg.limite)}. A regra das 14h30 define o prazo (aceite até 14h30 paga no mesmo dia).` }),
        ui.kv([['Taxa', fmt.taxa(lance.taxaAm)], ['Valor de face', fmt.brl(met.face)], ['Deságio', `${fmt.brl(met.desagioValor)} (${fmt.pct(met.desagioPct)})`], ['Líquido para você', fmt.brl(met.liquido)], ['CET', fmt.taxa(met.cetAm)], ['Regresso', op.regresso ? 'Com regresso' : 'Sem regresso'], ['Pagamento previsto', fmt.datetime(pg.limite)], ['Financiador', anonLabel(op, lance.finId)]]),
        ui.field({ label: 'Confirmação' }, chk)),
      footer: [ui.btn('Voltar', { variant: 'ghost', onclick: () => m.close(false) }), confirmBtn] });
    return m.promise;
  }

  function tetoModal(op) {
    if (!can('aceitar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('aceitar') }); return; }
    const sug = E.ia.sugerirTaxa(op);
    const num = ui.numeric({ value: op.tetoTaxa || sug.sugerida, suffix: '% a.m.', decimals: 2, min: 0.5, max: 10, aria: 'Teto de aceite' });
    const m = ui.modal({ title: 'Teto de aceite automático', subtitle: op.id, icon: 'bot',
      body: h('div.stack.tight', ui.callout({ tone: 'ai', icon: 'sparkles', title: 'Sugestão da precificação', text: `${fmt.taxa(sug.sugerida)} (faixa ${fmt.taxa(sug.faixa[0])} a ${fmt.taxa(sug.faixa[1])}, ${sug.amostra} operações). A decisão é sua: o motor só executa.` }),
        ui.field({ label: 'Teto máximo aceito', hint: 'Oferta igual ou abaixo disso fecha sozinha.' }, num)),
      footer: [ui.btn('Cancelar', { variant: 'ghost', onclick: () => m.close(false) }), ui.btn('Salvar teto', { variant: 'primary', onclick: () => {
        const v = num.value;
        if (v === null || !(v > 0)) { ui.toast('Informe um teto válido', { type: 'error' }); return; }
        db.patch('operacoes', op.id, { tetoTaxa: Math.round(v * 100) / 100 });
        ledger.append({ actor: E.actors.user(myUserId()), acao: 'operacao.teto_alterado', entidade: { kind: 'operacao', id: op.id }, resumo: `Teto de aceite automático de ${op.id} ajustado para ${fmt.taxa(v)}`, classe: 'R2' });
        const best = E.melhorLance(op.id);
        ui.toast('Teto salvo', { type: 'success', text: `Fecha sozinho até ${fmt.taxa(v)}` });
        m.close(true);
        if (best && best.taxaAm <= v + 1e-9) {
          const r = E.aceitarLance(op.id, best.id, { auto: true });
          ui.toast(r.ok ? 'Teto atingido: aceite automático' : 'Teto atingido, mas o aceite falhou', { type: r.ok ? 'success' : 'warn', text: r.ok ? `Oferta ${fmt.taxa(best.taxaAm)} aceita pelo motor.` : r.erro });
        }
      } })] });
  }

  /* ---- cessao ---- */
  function secaoCessao(op) {
    return ui.live(['contratos', 'operacoes'], () => {
      const o = db.get('operacoes', op.id);
      const ct = o.contratoId && db.get('contratos', o.contratoId);
      if (!ct) return ui.empty({ icon: 'file-text', title: 'Contrato em emissão', text: 'O motor gera o contrato em instantes.' });
      const signed = ct.assinaturas.some((s) => s.parte === 'cedente');
      const finSigned = ct.assinaturas.some((s) => s.parte === 'financiador');
      return h('div.stack',
        ui.card({ title: 'Cessão dos créditos', subtitle: `${finName(o.financiadorId)} · taxa ${fmt.taxa(o.taxaFinal)}` },
          h('div.stack.tight', F.contratoCard(ct),
            !signed ? h('div.stack.tight', ui.callout({ tone: 'warn', title: 'Falta a sua assinatura', text: 'Assine com certificado ICP-Brasil para liberar o pagamento. O financiador já vê o contrato do lado dele.' }),
              h('div.row', ui.btn('Assinar cessão', Object.assign({ variant: 'primary', icon: 'pen-line', onclick: () => F.assinar(ct.id, 'cedente') }, can('assinar') ? {} : noPerm('assinar'))),
                ui.btn('Ver contrato', { variant: 'ghost', onclick: () => F.verContrato(ct) })))
            : h('div.stack.tight', ui.callout({ tone: finSigned ? 'success' : 'info', title: finSigned ? 'Assinada pelas duas partes' : `Você assinou, falta ${finName(o.financiadorId)}`, text: finSigned ? 'O pagamento entra na conta de liquidação até o limite.' : 'Avisamos o financiador. Assim que ele assinar, o prazo de pagamento começa a contar.' }),
              h('div.row', ui.btn('Ver contrato', { variant: 'secondary', onclick: () => F.verContrato(ct) }))))),
        ui.card({ title: 'O que acontece agora' }, h('div.stack.tight',
          h('div.small', '1. As duas partes assinam a cessão com ICP-Brasil.'),
          h('div.small', `2. O financiador paga ${fmt.brl(o.liquido)} direto na sua conta de liquidação até ${fmt.datetime(o.pagamentoLimite)}.`),
          h('div.small', '3. A Cedy só lê o extrato: ela não custodia nem movimenta o dinheiro.'))));
    });
  }

  /* ---- aguardando_pagamento ---- */
  function secaoAguardando(op) {
    return ui.live(['operacoes'], () => {
      const o = db.get('operacoes', op.id);
      const late = now() > o.pagamentoLimite;
      return h('div.stack',
        late ? ui.callout({ tone: 'error', title: 'O financiador passou do prazo', text: `O limite era ${fmt.datetime(o.pagamentoLimite)}. A Cedy já registrou o atraso e acionou o financiador.`,
          actions: [ui.btn('Cobrar financiador', { variant: 'secondary', size: 'sm', icon: 'send', onclick: () => {
            notify.send({ to: { orgId: o.financiadorId }, tipo: 'alerta', titulo: `Cobrança de pagamento: ${o.id}`, corpo: `O cedente cobra o pagamento de ${fmt.brl(o.liquido)}.`, link: '/financiador/operacoes/' + o.id });
            ui.toast('Cobrança enviada', { type: 'success', text: 'O financiador foi avisado pela trilha.' });
          } })] })
        : ui.card({ title: 'Pagamento a caminho', actions: [ui.countdown(o.pagamentoLimite, { prefix: 'Limite', endLabel: 'limite estourado' })] },
          h('div.cd2-kv-hero', h('span.cd2-best-liq.num', fmt.brl(o.liquido)), h('span.small.muted', `até ${fmt.datetime(o.pagamentoLimite)}`))),
        ui.card({ title: 'Detalhe do pagamento' }, ui.kv([['Valor', fmt.brl(o.liquido)], ['Pagador', finName(o.financiadorId)], ['Limite', fmt.datetime(o.pagamentoLimite)], ['Situação', late ? 'Em atraso' : 'No prazo']])),
        ui.callout({ tone: 'info', title: 'Sem desistência nesta etapa', text: 'Com a cessão assinada, o pagamento é obrigação do financiador e a trilha registra cada passo.' }));
    });
  }

  /* ---- paga: agenda de recebimento ---- */
  function secaoAgenda(op) {
    const org = db.get('orgs', op.cedenteId);
    const plano = (op.planoSacado || []).slice().sort((a, b) => a.ts - b.ts);
    return h('div.stack',
      ui.card({ title: 'Agenda de recebimento', subtitle: 'O sacado paga na sua conta de liquidação. A conciliação é automática.' },
        plano.length ? ui.table({ columns: [
          { key: 'sac', label: 'Sacado', mobile: 'primary', render: (p) => sacName(p.sacadoId) },
          { key: 'ts', label: 'Vencimento', sort: true, render: (p) => fmt.date(p.ts) },
          { key: 'v', label: 'Valor esperado', align: 'right', render: (p) => h('span.num', fmt.brl(p.valor)) },
          { key: 'sit', label: 'Situação', mobile: 'hide', render: (p) => p.emitido ? ui.badge('Recebido', 'green') : (p.ts < now() ? ui.badge('Atrasado', 'red') : ui.badge('A vencer', 'blue')) },
          { key: 'prazo', label: 'Prazo', mobile: 'hide', render: (p) => h('span.small.muted', fmt.rel(p.ts)) },
        ], rows: plano })
        : h('div.small.muted', 'Agenda em formação: o plano de pagamentos do sacado aparece aqui.')),
      ui.card({ title: 'Como o sacado paga' }, h('div.stack.tight',
        ui.kv([['Banco', org.contaLiquidacao.banco], ['Agência / conta', `${org.contaLiquidacao.agencia} / ${org.contaLiquidacao.conta}`], ['Titular', org.contaLiquidacao.titular]]),
        h('div.small.muted', 'O sacado paga direto nesta conta. A Cedy só lê o extrato para conciliar: não retém, não debita, não movimenta.'))));
  }

  /* ---- vencida / parcial ---- */
  function secaoVencida(op) {
    return ui.live(['operacoes'], () => {
      const o = db.get('operacoes', op.id);
      const tit = o.tituloIds.map((id) => db.get('titulos', id)).filter(Boolean);
      const sacs = [...new Set(tit.map((t) => t.sacadoId))];
      const vencMax = Math.max(...tit.map((t) => t.vencimento));
      const dias = Math.max(0, cal.daysBetween(vencMax, now()));
      const aberto = (o.saldoAberto !== undefined && o.saldoAberto !== null) ? o.saldoAberto : C.sum(tit.filter((t) => !['liquidado', 'recomprado'].includes(t.status)), (t) => t.valor);
      const cards = [ui.card({ title: o.status === 'vencida' ? 'Em aberto' : 'Saldo em aberto' },
        h('div.cd2-kv-hero', h('span.cd2-best-liq.num', fmt.brl(aberto)), h('span', ui.badge(`${dias} dias de atraso`, 'red'))),
        h('div.small.muted', `Sacado: ${sacs.map(sacName).join(', ')}. Vencimento em ${fmt.date(vencMax)}.`),
        !o.regresso ? h('div', ui.callout({ tone: 'info', title: 'Operação sem regresso', text: 'Não há recompra: o risco é do financiador e a cobrança segue com a Mesa. Você não precisa fazer nada.' }))
        : !o.regressoAcionado ? h('div', ui.callout({ tone: 'info', title: 'Regresso ainda não acionado', text: 'Enquanto o financiador não aciona o regresso, acompanhe a cobrança do sacado. Se ele acionar, a recompra aparece aqui com valor e prazo.' })) : null)];
      if (o.recompra && o.recompra.status === 'devida') {
        cards.push(ui.card({ title: 'Recompra devida', subtitle: `Prazo até ${fmt.date(o.recompra.ate)}` },
          h('div.stack.tight',
            ui.kv([['Saldo', fmt.brl(o.recompra.saldo)], ['Encargos (multa 2% + mora 1% a.m.)', fmt.brl(o.recompra.encargos)], ['Total', fmt.brl(o.recompra.valor)]]),
            ui.countdown(o.recompra.ate, { prefix: 'Prazo', endLabel: 'prazo estourado' }),
            h('div.row', can('pagar') ? ui.btn('Pagar recompra', { variant: 'primary', icon: 'rotate-ccw', onclick: async () => {
              if (!await ui.confirm({ title: `Pagar recompra de ${fmt.brl(o.recompra.valor)}?`, text: 'Os títulos voltam para você e o repasse ao financiador é agendado.', tone: 'danger', confirmLabel: 'Pagar recompra' })) return;
              const r = E.pagarRecompra(o.id, myUserId());
              if (r.ok) ui.toast('Recompra paga', { type: 'success' });
              else ui.toast('Não foi possível pagar', { type: 'error', text: r.erro });
            } }) : ui.btn('Pagar recompra', { variant: 'primary', disabled: true, title: C.cannotMsg('pagar') })))));
      }
      if (o.recompra && o.recompra.status === 'paga') cards.push(ui.callout({ tone: 'success', title: 'Recompra paga', text: `Quitada em ${fmt.datetime(o.recompra.pagaEm)}.` }));
      return h('div.stack', cards);
    });
  }

  /* ---- liquidada / recomprada / cancelada / expirada ---- */
  function secaoEncerrada(op) {
    return h('div.stack', ui.card({ title: 'Resumo do encerramento' }, ui.kv([
      ['Desfecho', ui.statusLabel('operacao', op.status)],
      ['Taxa final', op.taxaFinal ? fmt.taxa(op.taxaFinal) : '—'],
      ['Líquido', op.liquido ? fmt.brl(op.liquido) : '—'],
      ['Deságio', op.desagio ? `${fmt.brl(op.desagio)} (${fmt.pct(op.desagioPct)})` : '—'],
      op.aceitaEm ? ['Aceita em', fmt.datetime(op.aceitaEm)] : null,
      op.pagoEm ? ['Paga em', fmt.datetime(op.pagoEm)] : null,
      op.liquidadaEm ? ['Liquidada em', fmt.datetime(op.liquidadaEm)] : null,
      op.encerradaEm ? ['Encerrada em', fmt.datetime(op.encerradaEm)] : null,
    ])));
  }

  /* ---- coluna lateral ---- */
  /** Snapshot da tela no aceite, com rótulos e formatos pt-BR. */
  const SNAP_ROTULOS = {
    tela: ['Tela'], versaoTela: ['Versão da tela'], taxaAm: ['Taxa', fmt.taxa], liquido: ['Líquido', fmt.brl], desagio: ['Deságio', fmt.brl], cetAm: ['CET', fmt.taxa],
    regresso: ['Regresso'], tsPct: ['TS (percentual)', (v) => v + '%'], tsValor: ['TS', fmt.brl], pagamentoPrevisto: ['Pagamento previsto', (v) => (typeof v === 'number' ? fmt.datetime(v) : String(v))],
    termos: ['Termos'], modalidadeRegresso: ['Modalidade de regresso'], tetoTaxa: ['Teto automático', (v) => (v ? fmt.taxa(v) : 'desligado')],
    taxaExibida: ['Taxa exibida', fmt.taxa], liquidoExibido: ['Líquido exibido', fmt.brl], cetExibido: ['CET exibido', fmt.taxa],
  };
  const SNAP_DUP = { taxaExibida: 'taxaAm', liquidoExibido: 'liquido', cetExibido: 'cetAm' };
  function snapshotView(snap) {
    const rows = Object.entries(snap).filter(([k, v]) => !(SNAP_DUP[k] && snap[SNAP_DUP[k]] === v)).map(([k, v]) => {
      const r = SNAP_ROTULOS[k];
      const label = r ? r[0] : k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      return [label, r && r[1] && v !== null && v !== undefined ? r[1](v) : String(v === null || v === undefined ? '—' : v)];
    });
    return ui.kv(rows);
  }

  function ladoOp(op) {
    const selic = E.selicAm();
    const resumo = ui.live(['operacoes'], () => {
      const o = db.get('operacoes', op.id);
      if (!o.taxaFinal) return ui.card({ title: 'Resumo financeiro' }, h('div.small.muted', 'Os valores finais aparecem após o aceite. Face e prazo abaixo.'),
        ui.kv([['Valor de face', fmt.brl(o.face)], ['Prazo médio', (o.prazoMedio || '—') + (o.prazoMedio ? ' dias' : '')], ['Regresso', o.regresso ? 'Com regresso' : 'Sem regresso']]));
      return ui.card({ title: 'Resumo financeiro' }, ui.kv([
        ['Valor de face', fmt.brl(o.face)],
        ['Deságio', `${fmt.brl(o.desagio)} (${fmt.pct(o.desagioPct)})`],
        ['Líquido', fmt.brl(o.liquido)],
        ['CET', fmt.taxa(o.cetAm)],
        ['SELIC', fmt.taxa(selic)],
        ['Prazo médio', `${o.prazoMedio} dias`],
        ['Regresso', o.regresso ? 'Com regresso' : 'Sem regresso'],
      ]), h('div.small.muted', 'Valores fechados no aceite. A TS é paga pelo financiador e não reduz o seu líquido.'));
    });
    const tits = op.tituloIds.map((id) => db.get('titulos', id)).filter(Boolean);
    const titCard = ui.card({ title: `Títulos (${tits.length})` }, h('div', ...tits.map((t) => h('div.cd2-tit-row',
      h('div', h('div.strong', t.numero), h('div.small.muted', `${sacName(t.sacadoId)} · venc. ${fmt.date(t.vencimento)}`)),
      h('div.cd2-tit-val', h('div.num', fmt.brl(t.valor)), ui.status('titulo', t.status))))));
    const ct = op.contratoId && db.get('contratos', op.contratoId);
    const ctCard = ct && op.status !== 'cessao' ? ui.card({ title: 'Contrato' }, F.contratoCard(ct)) : null;
    const snapEntry = ledger.forEntity('operacao', op.id).find((e) => e.acao === 'operacao.aceita');
    const snapCard = snapEntry && snapEntry.snapshot ? ui.card({ title: 'O que foi exibido no aceite' }, snapshotView(snapEntry.snapshot)) : null;
    const tlCard = ui.card({ title: 'Linha do tempo' }, ui.live(['ledger'], () => F.timeline('operacao', op.id)));
    return h('div.stack', resumo, titCard, ctCard, snapCard, tlCard);
  }

  /* ============================ /cedente/conta ============================ */
  function extratoDoOrg() { return db.where('extrato', (x) => x.orgId === myOrgId()).sort((a, b) => b.ts - a.ts); }
  function recursoLivre() {
    return C.sum(extratoDoOrg().filter((x) => x.status === 'recurso_livre'), (x) => {
      const rl = (x.matches || []).filter((m) => !m.opId);
      return rl.length ? C.sum(rl, (m) => m.valor) : x.valor;
    });
  }

  function telaConta() {
    const org = myOrg();
    let tab = 'extrato';
    let fSt = 'todos', fPer = 'tudo', fq = '';
    const tabs = ui.tabs({ value: tab, items: [
      { id: 'extrato', label: 'Extrato', count: extratoDoOrg().length },
      { id: 'concil', label: 'Conciliação', count: db.where('casosMesa', (c) => c.cedenteId === myOrgId() && c.status === 'aberto').length },
      { id: 'agenda', label: 'Agenda' },
    ], onChange: (v) => { tab = v; C.store.emit('ced2-tab'); } });
    const body = ui.live(['casosMesa', 'operacoes', 'ledger', 'ced2-tab'], () => {
      if (tab === 'concil') return secaoConcil();
      if (tab === 'agenda') return secaoAgendaConta();
      return secaoExtrato();
    });
    function linhasFiltradas() {
      let ls = extratoDoOrg();
      if (fSt !== 'todos') ls = ls.filter((x) => x.status === fSt);
      if (fPer !== 'tudo') { const cut = now() - Number(fPer) * 86400000; ls = ls.filter((x) => x.ts >= cut); }
      if (fq) ls = ls.filter((x) => `${x.descricao} ${x.pagadorNome} ${x.valor}`.toLowerCase().includes(fq));
      return ls;
    }
    function secaoExtrato() {
      const stCtl = ui.select({ value: fSt, aria: 'Situação', options: [{ value: 'todos', label: 'Todas as situações' }, { value: 'conciliado', label: 'Conciliado' }, { value: 'pendente_mesa', label: 'Na Mesa' }, { value: 'recurso_livre', label: 'Recurso Livre' }, { value: 'novo', label: 'Novo' }], onChange: (v) => { fSt = v; C.store.emit('ced2-fconta'); } });
      const perCtl = ui.select({ value: fPer, aria: 'Período', options: [{ value: 'tudo', label: 'Todo o período' }, { value: '7', label: 'Últimos 7 dias' }, { value: '30', label: 'Últimos 30 dias' }], onChange: (v) => { fPer = v; C.store.emit('ced2-fconta'); } });
      const qCtl = ui.search({ placeholder: 'Buscar descrição, pagador ou valor', value: fq, onInput: C.debounce((v) => { fq = v.trim().toLowerCase(); C.store.emit('ced2-fconta'); }, 220) });
      const tabela = ui.live(['extrato', 'ced2-fconta'], () => ui.table({ columns: [
        { key: 'ts', label: 'Data', sort: (a, b) => a.ts - b.ts, mobile: 'secondary', render: (x) => h('div', h('div.nowrap', fmt.date(x.ts)), h('div.small.muted', fmt.time(x.ts))) },
        { key: 'd', label: 'Descrição', mobile: 'primary', render: (x) => h('div', h('div.strong', x.descricao), h('div.small.muted', x.pagadorNome || '')) },
        { key: 'ops', label: 'Operações', mobile: 'hide', render: (x) => (x.matches || []).filter((m) => m.opId).map((m) => m.opId).join(', ') || '—' },
        { key: 'v', label: 'Valor', align: 'right', sort: (a, b) => a.valor - b.valor, render: (x) => h('strong.num.nowrap.tone-green', '+' + fmt.brl(x.valor)) },
        { key: 'st', label: 'Situação', render: (x) => ui.status('extrato', x.status) },
      ], rows: linhasFiltradas(), rowKey: (x) => x.id, onRowClick: (x) => drawerExtrato(x),
        empty: ui.empty({ icon: 'wallet', title: 'Sem lançamentos', text: 'Ajuste os filtros. Créditos de sacados e do financiador aparecem aqui.' }) }));
      return h('div.stack',
        ui.callout({ tone: 'info', title: 'Conciliação em 3 fatores', text: 'Cada crédito é conferido em fonte pagadora (CNPJ do sacado), valor (50% a 110% do saldo) e data (a partir de 2 dias antes do vencimento). O que não fecha vai para a Mesa Conciliadora. Sobra vira Recurso Livre, seu, sem retenção.' }),
        ui.toolbar(qCtl, stCtl, perCtl),
        tabela);
    }
    function fatores(x) {
      const sac = db.where('orgs', (o) => o.kind === 'sacado' && o.cnpj.replace(/\D/g, '') === String(x.pagadorCnpj || '').replace(/\D/g, ''))[0];
      const ops = db.where('operacoes', (o) => o.cedenteId === myOrgId() && ['paga', 'vencida', 'parcial'].includes(o.status)).filter((o) => !sac || o.tituloIds.some((id) => { const t = db.get('titulos', id); return t && t.sacadoId === sac.id; }));
      const total = C.sum(ops, (o) => o.face);
      const tratado = ['conciliado', 'recurso_livre'].includes(x.status);
      let dataOk = true;
      if (sac) {
        const vencs = ops.flatMap((o) => o.tituloIds.map((id) => db.get('titulos', id)).filter((t) => t && t.sacadoId === sac.id).map((t) => t.vencimento));
        dataOk = tratado ? true : (vencs.length ? x.ts >= Math.min(...vencs) - 2 * 86400000 : false);
      }
      return { fonteOk: !!sac, valorOk: tratado ? true : (total > 0 && x.valor >= total * 0.5 && x.valor <= total * 1.1), dataOk, sac };
    }
    const TIPO_CASO = { parcial: 'Pagamento parcial', empate: 'Empate de saldos', sem_fonte: 'Fonte não identificada', valor: 'Valor fora da faixa' };
    function drawerExtrato(x) {
      const f = fatores(x);
      const caso = x.casoId && db.get('casosMesa', x.casoId);
      const matchRow = (ok, label, detail) => h('div.cd2-match', h('span', { class: ok ? 'ok' : 'no' }, icon(ok ? 'circle-check' : 'circle-alert', 15)), h('div', h('div.strong', label), h('div.small.muted', detail)));
      ui.drawer({ title: fmt.brl(x.valor) + ' · ' + fmt.date(x.ts), subtitle: x.descricao, icon: 'wallet', body: h('div.stack',
        ui.kv([['Pagador', x.pagadorNome || '—'], ['CNPJ', x.pagadorCnpj ? fmt.cnpj(x.pagadorCnpj) : '—'], ['Situação', ui.statusLabel('extrato', x.status)], ['Lançado em', fmt.datetime(x.ts)]]),
        ui.divider(), h('h4', 'Como foi conciliado'), h('div.stack.tight',
          matchRow(f.fonteOk, 'Fonte pagadora', f.sac ? `CNPJ confere com ${f.sac.fantasia}` : 'CNPJ não é de nenhum sacado seu'),
          matchRow(f.valorOk, 'Valor entre 50% e 110%', `Crédito de ${fmt.brl(x.valor)} contra o saldo em aberto`),
          matchRow(f.dataOk, 'Data compatível', 'A partir de 2 dias antes do vencimento')),
        (x.matches || []).length ? h('div', h('h4', 'Rateio'), ui.table({ dense: true, columns: [
          { key: 'op', label: 'Operação', render: (m) => m.opId || 'Recurso Livre' },
          { key: 'nat', label: 'Natureza', render: (m) => m.natureza },
          { key: 'v', label: 'Valor', align: 'right', render: (m) => h('span.num', fmt.brl(m.valor)) },
        ], rows: x.matches })) : null,
        caso && caso.status === 'aberto' ? h('div.stack.tight', ui.callout({ tone: 'warn', title: 'Na Mesa Conciliadora: ' + (TIPO_CASO[caso.tipo] || caso.tipo), text: caso.motivo, actions: [ui.countdown(caso.slaAte, { prefix: 'SLA', endLabel: 'SLA estourado' })] }),
          caso.sugestao ? h('div', h('div', ui.ai('Sugestão do agente de conciliação')), h('div.small.muted', (caso.sugestao.nota || '') + ' ' + (caso.sugestao.alocacoes || []).map((a) => `${a.opId}: ${fmt.brl(a.valor)}`).join(', '))) : null) : null,
        x.status === 'recurso_livre' ? h('div.row', can('pagar') ? ui.btn('Liberar para movimentação', { variant: 'primary', icon: 'wallet', onclick: async () => {
          const r = E.sacarRecursoLivre(x.id, myUserId());
          if (r.ok) ui.toast('Recurso Livre liberado', { type: 'success', text: 'O valor já pode ser movimentado na conta.' });
          else ui.toast('Não foi possível liberar', { type: 'error', text: r.erro });
        } }) : ui.btn('Liberar para movimentação', { variant: 'primary', disabled: true, title: C.cannotMsg('pagar') })) : null) });
    }
    function secaoConcil() {
      const casos = db.where('casosMesa', (c) => c.cedenteId === myOrgId() && c.status === 'aberto').sort((a, b) => a.slaAte - b.slaAte);
      const tipoTxt = { parcial: 'Pagamento menor que o saldo: a Mesa define o rateio, com prioridade para operações vencidas.', empate: 'Dois ou mais saldos com o mesmo valor: a Mesa escolhe a operação correta.', sem_fonte: 'Pagador não identificado entre seus sacados: a Mesa investiga a origem.', valor: 'Valor fora da faixa de 50% a 110%: a Mesa confere se é erro ou novo cenário.' };
      if (!casos.length) return ui.empty({ icon: 'git-compare', title: 'Nenhum caso aberto', text: 'Créditos que não fecham nos 3 fatores aparecem aqui para acompanhamento.' });
      return h('div.stack', ui.callout({ tone: 'info', title: 'Você só acompanha', text: 'A decisão é da Mesa Conciliadora em até 24h (48h em empates). Nada aqui pede ação sua, mas cada caso mostra o relógio.' }),
        ...casos.map((c) => {
          const l = db.get('extrato', c.linhaId);
          return h('div.cd2-case', { class: now() > c.slaAte - 4 * 3600e3 && 'is-urgent' },
            h('div.row.between', h('strong', fmt.brl(c.valor)), ui.countdown(c.slaAte, { prefix: 'SLA', endLabel: 'SLA estourado' })),
            h('div.small', ui.badge(TIPO_CASO[c.tipo] || c.tipo, 'amber'), ' ', c.motivo),
            h('div.small.muted', tipoTxt[c.tipo] || ''),
            l ? h('div.small.muted', `Crédito de ${fmt.datetime(l.ts)} · ${l.pagadorNome || 'pagador desconhecido'}`) : null,
            c.sugestao ? h('div', ui.ai('Sugestão do agente: ' + (c.sugestao.nota || '') + ' ' + (c.sugestao.alocacoes || []).map((a) => `${a.opId} ${fmt.brl(a.valor)}`).join(', '))) : null);
        }));
    }
    function secaoAgendaConta() {
      const agora = now(), fim = agora + 30 * 86400000;
      const itens = [];
      myOps().filter((o) => ['paga', 'vencida', 'parcial'].includes(o.status)).forEach((o) => (o.planoSacado || []).forEach((p) => { if (p.ts >= agora && p.ts <= fim) itens.push({ op: o, p }); }));
      const weeks = {};
      itens.forEach(({ op, p }) => { const k = cal.startOfDay(p.ts - ((cal.sp(p.ts).wd + 6) % 7) * 86400000); const kk = fmt.date(k); (weeks[kk] = weeks[kk] || { ts: k, total: 0, itens: [] }); weeks[kk].total += p.valor; weeks[kk].itens.push({ op, p }); });
      const ws = Object.values(weeks).sort((a, b) => a.ts - b.ts);
      const total = C.sum(itens, ({ p }) => p.valor);
      if (!ws.length) return ui.empty({ icon: 'calendar', title: 'Sem recebimentos previstos', text: 'Os próximos 30 dias não têm vencimentos na sua carteira.' });
      return h('div.stack', ui.card({ title: 'Próximos 30 dias', subtitle: `${fmt.plural(itens.length, 'recebimento', 'recebimentos')} · total ${fmt.brl(total)}` },
        ui.chart.bars({ categories: ws.map((w) => fmt.dateShort(w.ts)), series: [{ name: 'A receber', tone: 'teal', data: ws.map((w) => w.total) }], height: 180, format: (v) => fmt.brlCompact(v), tipFormat: (v) => fmt.brl(v) })),
        ...ws.map((w) => h('div.cd2-agenda-week', h('div.row.between', h('strong', 'Semana de ' + fmt.date(w.ts)), h('span.num', fmt.brl(w.total))),
          ...w.itens.map(({ op, p }) => h('div.cd2-tit-row', h('div', h('span.mono.strong', op.id), h('div.small.muted', sacName(p.sacadoId))), h('div.num', fmt.brl(p.valor)))))));
    }
    function contaHead() {
      const rl = recursoLivre();
      return ui.card({ title: 'Dados da conta', subtitle: 'Em seu nome, somente leitura para a Cedy', actions: [ui.badge('Somente leitura', 'teal')] },
        h('div.stack.tight', ui.kv([['Banco', org.contaLiquidacao.banco], ['Agência / conta', `${org.contaLiquidacao.agencia} / ${org.contaLiquidacao.conta}`], ['Titular', org.contaLiquidacao.titular], ['Recurso Livre disponível', fmt.brl(rl)]]),
          h('div.small.muted', 'O dinheiro entra e sai por esta conta em seu nome. A Cedy lê o extrato para conciliar e nunca movimenta valores.')));
    }
    return h('div.stack', ui.pageHeader({ title: 'Conta de liquidação', subtitle: 'Extrato, conciliação e agenda da conta em seu nome.' }),
      ui.live(['extrato'], () => contaHead()), tabs, body);
  }

  /* =========================== /cedente/limites =========================== */
  const OPS_EXPOSTAS = ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'];
  function sacadoStats() {
    const titIds = new Set();
    myOps().forEach((o) => o.tituloIds.forEach((id) => titIds.add(id)));
    const bySac = {};
    titIds.forEach((id) => {
      const t = db.get('titulos', id);
      if (!t) return;
      const b = (bySac[t.sacadoId] = bySac[t.sacadoId] || { sacadoId: t.sacadoId, titulos: [], ops: new Set(), atrasos: 0, exp: 0 });
      b.titulos.push(t);
      if (t.operacaoId) b.ops.add(t.operacaoId);
      if (t.status === 'vencido') b.atrasos++;
      const op = t.operacaoId && db.get('operacoes', t.operacaoId);
      if (op && OPS_EXPOSTAS.includes(op.status) && !['liquidado', 'recomprado'].includes(t.status)) b.exp += t.valor;
    });
    const rows = Object.values(bySac);
    const expTotal = C.sum(rows, (b) => b.exp);
    return rows.map((b) => ({ sacadoId: b.sacadoId, sac: db.get('orgs', b.sacadoId) || {}, n: b.titulos.length, nOps: b.ops.size, opIds: [...b.ops], exp: C.round2(b.exp), share: expTotal ? b.exp / expTotal : 0, atrasos: b.atrasos }))
      .sort((a, b) => b.exp - a.exp);
  }

  function telaLimites() {
    const org = myOrg();
    const lar = E.lar(myOrgId());
    const pct = lar.limite ? Math.min(100, (lar.exposicao / lar.limite) * 100) : 0;
    const stats = sacadoStats();
    const over = stats.filter((s) => s.share > 0.3);
    const larCard = ui.card({ title: 'Limite de antecipação (LAR)', subtitle: lar.fase === 'inicial' ? `Fase inicial: mês ${Math.min(3, lar.meses + 1)} de 3` : 'Fase por depósitos de sacados' },
      h('div.stack.tight',
        h('div.row.between', h('div.cd2-best-liq.num', fmt.brl(lar.disponivel)), h('span.small.muted', `de ${fmt.brl(lar.limite)}`)),
        ui.progress(pct, { tone: pct > 85 ? 'red' : pct > 60 ? 'amber' : undefined }),
        h('div.small.muted', `Em uso ${fmt.brl(lar.exposicao)} (${fmt.pct(pct, 0)}).`),
        ui.divider(),
        ui.kv(lar.fase === 'inicial' ? [['Como é calculado', '80% do faturamento anual / 365 x prazo médio'], ['Faturamento anual', fmt.brl(org.faturamentoAnual)], ['Prazo médio de recebimento', `${org.prazoRecebimentoDias} dias`], ['Base', fmt.brl(lar.base)]]
        : [['Como é calculado', 'Depósitos de sacados (90d) / 90 x prazo médio'], ['Depósitos 90 dias', fmt.brl(org.depositos90d)], ['Prazo médio de recebimento', `${org.prazoRecebimentoDias} dias`], ['Base', fmt.brl(lar.porDepositos)]]),
        h('div.row', ui.btn('Aumentar limite', { variant: 'secondary', size: 'sm', onclick: aumentoModal }))));
    function aumentoModal() {
      const m = ui.modal({ title: 'Aumentar limite', subtitle: 'Pedido vai para a Mesa de Operações', icon: 'gauge',
        body: h('div.stack.tight', h('div.small', 'Para revisar seu LAR, a Mesa precisa de documentos atualizados:'),
          h('div', ...['DRE ou balancete dos últimos 12 meses', 'Extratos da conta de liquidação (90 dias)', 'Certidão negativa de débitos federais vigente'].map((d) => h('div.small', '· ' + d))),
          h('div.small.muted', 'Nenhum documento é enviado agora: o pedido abre uma ocorrência na Mesa e a equipe chama você.')),
        footer: [ui.btn('Fechar', { variant: 'ghost', onclick: () => m.close(false) }), ui.btn('Pedir revisão', { variant: 'primary', onclick: () => {
          notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: `Revisão de LAR: ${org.fantasia}`, corpo: `Limite atual ${fmt.brl(lar.limite)}, em uso ${fmt.brl(lar.exposicao)}.`, link: '/ops/empresas' });
          ledger.append({ actor: E.actors.user(myUserId()), acao: 'limite.revisao_solicitada', entidade: { kind: 'org', id: org.id }, resumo: `${org.fantasia} pediu revisão do LAR (atual ${fmt.brl(lar.limite)})`, classe: 'R1' });
          ui.toast('Pedido enviado', { type: 'success', text: 'A Mesa chama você para os documentos.' });
          m.close(true);
        } })] });
    }
    const concCard = ui.card({ title: 'Concentração por sacado' },
      stats.some((s) => s.exp > 0) ? ui.chart.donut(stats.filter((s) => s.exp > 0).slice(0, 6).map((s, i) => ({ label: s.sac.fantasia || s.sacadoId, value: s.exp, tone: ['blue', 'teal', 'green', 'amber', 'neutral', 'navy'][i % 6] })), { center: { label: 'R$ em aberto', value: fmt.brlCompact(C.sum(stats, (s) => s.exp)).replace('R$ ', '') } })
      : h('div.small.muted', 'Sem exposição no momento.'));
    const sacTable = ui.table({ columns: [
      { key: 'sac', label: 'Sacado', mobile: 'primary', render: (s) => h('div', h('div.strong', s.sac.fantasia || s.sacadoId), h('div.small.muted', `${fmt.plural(s.nOps, 'operação', 'operações')} · ${fmt.plural(s.n, 'título', 'títulos')}`)) },
      { key: 'share', label: 'Concentração', sort: true, render: (s) => h('span.num', fmt.pct(s.share * 100, 1)) },
      { key: 'exp', label: 'Exposição', align: 'right', sort: true, render: (s) => h('span.num', fmt.brl(s.exp)) },
      { key: 'rt', label: 'Rating', mobile: 'hide', render: (s) => F.ratingBadge(s.sac.rating || '—') },
      { key: 'pm', label: 'Pontualidade', align: 'right', mobile: 'hide', render: (s) => { const d = s.sac.pagamentoMedioDias || 0; return h('span.nowrap', d > 0 ? `${d} d de atraso` : d < 0 ? `${-d} d adiantado` : 'no vencimento'); } },
      { key: 'at', label: 'Atrasos', align: 'right', mobile: 'hide', render: (s) => s.atrasos ? h('strong.tone-red', s.atrasos) : '0' },
      { key: 'st', label: 'Situação', render: (s) => ui.status('org', s.sac.status || 'ativo') },
    ], rows: stats, rowKey: (s) => s.sacadoId, onRowClick: (s) => drawerSacado(s),
      empty: ui.empty({ icon: 'building-2', title: 'Sem sacados', text: 'Publique uma operação para ver a concentração.' }) });
    function drawerSacado(s) {
      const ops = (s.opIds || []).map((id) => db.get('operacoes', id)).filter(Boolean);
      ui.drawer({ title: s.sac.fantasia, subtitle: `${s.sac.setor || ''} · rating ${s.sac.rating || '—'}`, icon: 'building-2', body: h('div.stack',
        ui.kv([['Exposição', fmt.brl(s.exp)], ['Concentração', fmt.pct(s.share * 100, 1)], ['Operações', s.nOps], ['Títulos', s.n], ['Títulos com atraso', s.atrasos], ['Restrição', s.sac.restricao || 'Nenhuma']]),
        ops.length ? h('div', h('h4', 'Operações'), ui.table({ dense: true, columns: [
          { key: 'id', label: 'Operação', render: (o) => h('span.mono.strong', o.id) },
          { key: 'st', label: 'Situação', render: (o) => ui.status('operacao', o.status) },
          { key: 'v', label: 'Face', align: 'right', render: (o) => h('span.num', fmt.brl(o.face)) },
        ], rows: ops })) : null) });
    }
    const fins = db.where('orgs', (o) => o.kind === 'financiador' && o.status === 'ativo');
    const finRows = fins.map((f) => {
      const ops = myOps().filter((o) => o.financiadorId === f.id && o.taxaFinal);
      return { fin: f, n: ops.length, media: ops.length ? C.sum(ops, (o) => o.taxaFinal) / ops.length : null };
    }).filter((r) => r.n > 0);
    const finCard = ui.card({ title: 'Financiadores', subtitle: 'Quem já comprou seus recebíveis. Favoritar prioriza no Balcão; bloquear impede novas ofertas.' },
      finRows.length ? ui.table({ dense: true, columns: [
        { key: 'f', label: 'Financiador', mobile: 'primary', render: (r) => h('div', h('div.strong', r.fin.fantasia), h('div.small.muted', fmt.plural(r.n, 'operação', 'operações'))) },
        { key: 'tx', label: 'Taxa média', align: 'right', render: (r) => h('span.num', fmt.taxa(r.media)) },
        { key: 'fav', label: 'Favorito', render: (r) => ui.switch({ checked: (org.favoritos || []).includes(r.fin.id), aria: 'Favoritar ' + r.fin.fantasia, onChange: (v) => {
          const cur = new Set(org.favoritos || []); v ? cur.add(r.fin.id) : cur.delete(r.fin.id);
          db.patch('orgs', org.id, { favoritos: [...cur] });
          ledger.append({ actor: E.actors.user(myUserId()), acao: 'cedente.favorito_alterado', entidade: { kind: 'org', id: r.fin.id }, resumo: `${org.fantasia} ${v ? 'favoritou' : 'removeu o favorito de'} ${r.fin.fantasia}`, classe: 'R1' });
        } }) },
        { key: 'bl', label: 'Bloqueado', render: (r) => ui.switch({ checked: (org.bloqueados || []).includes(r.fin.id), aria: 'Bloquear ' + r.fin.fantasia, onChange: (v) => {
          const cur = new Set(org.bloqueados || []); v ? cur.add(r.fin.id) : cur.delete(r.fin.id);
          db.patch('orgs', org.id, { bloqueados: [...cur] });
          ledger.append({ actor: E.actors.user(myUserId()), acao: 'cedente.bloqueio_alterado', entidade: { kind: 'org', id: r.fin.id }, resumo: `${org.fantasia} ${v ? 'bloqueou' : 'desbloqueou'} ${r.fin.fantasia}`, classe: 'R1' });
        } }) },
      ], rows: finRows }) : h('div.small.muted', 'Nenhum financiador fechou com você ainda.'));
    return h('div', ui.pageHeader({ title: 'Limites e sacados', subtitle: 'Quanto você pode antecipar e com quem está exposto.' }),
      h('div.stack', over.length ? ui.callout({ tone: 'warn', title: 'Concentração alta', text: `${over.map((s) => `${s.sac.fantasia} (${fmt.pct(s.share * 100, 0)})`).join(', ')} ${over.length === 1 ? 'passa' : 'passam'} de 30% da exposição. Pulverizar sacados costuma melhorar taxas.` }) : null,
        h('div.grid.g2', larCard, concCard), sacTable, finCard));
  }

  /* ========================== /cedente/relatorios ========================== */
  function opsNoPeriodo(per) {
    const cut = per === 'ano' ? cal.spTs(cal.sp(now()).y, 1, 1) : now() - per * 30 * 86400000;
    return myOps().filter((o) => o.aceitaEm && o.aceitaEm >= cut && o.taxaFinal);
  }
  function telaRelatorios() {
    let per = 3;
    const segCtl = ui.segmented({ value: per, aria: 'Período', options: [
      { value: 3, label: '3m' }, { value: 6, label: '6m' }, { value: 12, label: '12m' }, { value: 'ano', label: 'Ano' },
    ], onChange: (v) => { per = v; C.store.emit('ced2-rel'); } });
    const body = ui.live(['operacoes', 'ced2-rel'], () => relatorio(per));
    function relatorio(m) {
      const ops = opsNoPeriodo(m);
      if (!ops.length) return ui.empty({ icon: 'chart-column', title: 'Sem operações no período', text: 'Alargue o período ou publique uma operação.' });
      const totLiq = C.sum(ops, (o) => o.liquido);
      const totDes = C.sum(ops, (o) => o.desagio);
      const taxaMed = C.sum(ops, (o) => o.taxaFinal) / ops.length;
      const cetMed = C.sum(ops, (o) => o.cetAm) / ops.length;
      const prazoMed = Math.round(C.sum(ops, (o) => o.prazoMedio) / ops.length);
      const selic = E.selicAm();
      const kpis = h('div.grid.g3.keep2', ui.kpi({ label: 'Total antecipado', display: fmt.brl(totLiq), icon: 'banknote', tone: 'blue' }),
        ui.kpi({ label: 'Deságio pago', display: fmt.brl(totDes), icon: 'trending-down', tone: 'amber' }),
        ui.kpi({ label: 'CET médio', display: fmt.taxa(cetMed), icon: 'percent', tone: 'teal' }),
        ui.kpi({ label: 'Taxa média', display: fmt.taxa(taxaMed), hint: `SELIC ${fmt.taxa(selic)}`, icon: 'gauge', tone: 'green' }),
        ui.kpi({ label: 'Operações', value: ops.length, icon: 'repeat' }),
        ui.kpi({ label: 'Prazo médio', display: `${prazoMed}d`, icon: 'calendar' }));
      const buckets = {};
      ops.forEach((o) => { const k = fmt.month(o.aceitaEm); (buckets[k] = buckets[k] || { k, ts: o.aceitaEm, vol: 0, taxas: [] }); buckets[k].vol += o.liquido; buckets[k].taxas.push(o.taxaFinal); });
      const bs = Object.values(buckets).sort((a, b) => a.ts - b.ts);
      const porFin = C.groupBy(ops.filter((o) => o.financiadorId), (o) => o.financiadorId);
      const porProg = C.groupBy(ops, (o) => o.produto);
      const csv = () => {
        const L = [['Operação', 'Programa', 'Canal', 'Financiador', 'Face (R$)', 'Taxa (% a.m.)', 'Deságio (R$)', 'Líquido (R$)', 'Aceita em', 'Situação']];
        ops.forEach((o) => L.push([o.id, prodName(o.produto), o.canal, finName(o.financiadorId),
          o.face.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), String(o.taxaFinal).replace('.', ','),
          (o.desagio || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), (o.liquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
          fmt.date(o.aceitaEm), ui.statusLabel('operacao', o.status)]));
        const blob = new Blob(['\ufeff' + L.map((r) => r.join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `cedy-relatorio-${myOrgId()}.csv` });
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
        ui.toast('CSV exportado', { type: 'success', text: fmt.plural(ops.length, 'operação exportada', 'operações exportadas') + '.' });
      };
      return h('div.stack', kpis,
        h('div.grid.g2',
          ui.card({ title: 'Volume por mês' }, ui.chart.bars({ categories: bs.map((b) => b.k), series: [{ name: 'Líquido', tone: 'blue', data: bs.map((b) => Math.round(b.vol)) }], height: 200, format: (v) => fmt.brlCompact(v), tipFormat: (v) => fmt.brl(v) })),
          ui.card({ title: 'Taxa média por mês' }, ui.chart.line({ series: [{ name: 'Taxa', tone: 'blue', data: bs.map((b) => ({ x: b.k, y: Math.round(C.sum(b.taxas, (t) => t) / b.taxas.length * 100) / 100 })) }], height: 200, zero: false, format: (v) => fmt.taxa(v), tipFormat: (v) => fmt.taxa(v) }))),
        h('div.grid.g2',
          ui.card({ title: 'Por financiador', subtitle: 'Nomes visíveis só em operações fechadas.' }, ui.chart.hbars(Object.entries(porFin).map(([fid, list], i) => ({ label: finName(fid), value: C.sum(list, (o) => o.liquido), tone: ['blue', 'teal', 'green', 'amber', 'navy'][i % 5] })), { format: (v) => fmt.brlCompact(v) })),
          ui.card({ title: 'Por programa' }, ui.chart.donut(Object.entries(porProg).map(([pid, list], i) => ({ label: prodName(pid), value: C.sum(list, (o) => o.liquido), tone: ['blue', 'teal', 'green', 'amber', 'navy'][i % 5] }))))),
        ui.card({ title: `Operações (${ops.length})`, actions: [
          ui.btn('Exportar CSV', { variant: 'secondary', size: 'sm', icon: 'download', onclick: csv }),
          ui.btn('Imprimir', { variant: 'ghost', size: 'sm', icon: 'printer', onclick: () => window.print() })] },
          ui.table({ columns: [
            { key: 'id', label: 'Operação', mobile: 'primary', sort: (a, b) => a.id.localeCompare(b.id), render: (o) => h('span.mono.strong', o.id) },
            { key: 'ac', label: 'Aceita em', sort: (a, b) => a.aceitaEm - b.aceitaEm, mobile: 'hide', render: (o) => fmt.date(o.aceitaEm) },
            { key: 'fin', label: 'Financiador', mobile: 'hide', render: (o) => finName(o.financiadorId) },
            { key: 'tx', label: 'Taxa', align: 'right', sort: (a, b) => a.taxaFinal - b.taxaFinal, render: (o) => h('span.num', fmt.taxa(o.taxaFinal)) },
            { key: 'liq', label: 'Líquido', align: 'right', sort: (a, b) => a.liquido - b.liquido, render: (o) => h('span.num.nowrap', fmt.brl(o.liquido)) },
            { key: 'st', label: 'Situação', render: (o) => ui.status('operacao', o.status) },
          ], rows: ops.slice().sort((a, b) => b.aceitaEm - a.aceitaEm), rowKey: (o) => o.id, onRowClick: (o) => C.router.go('/cedente/operacoes/' + o.id) })));
    }
    return h('div.stack', ui.pageHeader({ title: 'Relatórios', subtitle: 'Volume, taxas e deságio das operações fechadas.' }), ui.toolbar(segCtl), body);
  }

  /* -------------------------------- rotas -------------------------------- */
  C.router.register([
    { path: '/cedente/operacoes', roles: ['cedente'], title: 'Operações', render: () => listaOperacoes() },
    { path: '/cedente/operacoes/:id', roles: ['cedente'], title: 'Operação', render: (ctx) => detalheOperacao(ctx) },
    { path: '/cedente/conta', roles: ['cedente'], title: 'Conta de liquidação', render: () => telaConta() },
    { path: '/cedente/limites', roles: ['cedente'], title: 'Limites e sacados', render: () => telaLimites() },
    { path: '/cedente/relatorios', roles: ['cedente'], title: 'Relatórios', render: () => telaRelatorios() },
  ]);
})();
