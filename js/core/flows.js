/* =========================================================================
   Cedy, fluxos de UI compartilhados entre perfis (assinatura da cessão,
   linha do tempo vinda da trilha, células padrão). As telas de cada perfil
   chamam estes helpers para manter o mesmo vocabulário visual.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui; const { db, ledger, session } = C.store; const E = C.engine;
  const F = (C.flows = {});

  /* ------------------------- células e rótulos padrão -------------------- */
  F.orgCell = (org, o = {}) => org ? h('div.cell-row', ui.avatar(org.fantasia || org.nome, { size: o.size || 'sm', square: true }), h('div.cell-main', h('strong', org.fantasia || org.nome), o.sub !== false && h('small', o.sub || `${org.cidade || ''}${org.uf ? '/' + org.uf : ''}`))) : h('span.muted', '—');
  F.opLink = (opId, role) => h('a', { class: 'mono strong', href: '#' + ({ cedente: '/cedente/operacoes/', financiador: '/financiador/operacoes/', ops: '/ops/empresas/' }[role] || '/cedente/operacoes/') + opId }, opId);
  F.prod = (id) => (db.get('produtos', id) || { nome: id }).nome;
  F.ratingBadge = (r) => ui.badge('Rating ' + r, { A: 'green', B: 'teal', C: 'amber', D: 'red' }[r] || 'neutral');
  F.actorLabel = (a) => (a.tipo === 'agente' ? 'Agente de IA' : a.tipo === 'motor' ? 'Motor de regras' : a.tipo === 'sistema' ? 'Sistema' : 'Pessoa');
  F.actorIcon = (a) => ({ humano: 'user', agente: 'sparkles', motor: 'scale', sistema: 'server' }[a.tipo] || 'user');
  F.actorTone = (a) => ({ humano: 'blue', agente: 'violet', motor: 'teal', sistema: 'neutral' }[a.tipo]);

  /* ------------------------ linha do tempo (trilha) ---------------------- */
  const ACAO = {
    'operacao.publicada': ['megaphone', 'blue'], 'lance.registrado': ['gavel', 'blue'], 'lance.retirado': ['rotate-ccw', 'amber'], 'operacao.aceita': ['circle-check', 'green'], 'contrato.assinado': ['file-signature', 'green'],
    'operacao.paga': ['banknote', 'green'], 'operacao.cancelada': ['ban', 'red'], 'operacao.expirada': ['hourglass', 'neutral'], 'operacao.pagamento_atrasado': ['triangle-alert', 'amber'], 'operacao.vencida': ['triangle-alert', 'red'],
    'conciliacao.aplicada': ['git-compare', 'green'], 'conciliacao.encaminhada': ['git-compare', 'amber'], 'regresso.acionado': ['rotate-ccw', 'red'], 'regresso.recompra_paga': ['circle-check', 'violet'], 'titulos.importados': ['file-up', 'blue'], 'lote.aprovado': ['badge-check', 'green'], 'lote.recusado': ['file-x', 'red'], 'recurso_livre.liberado': ['wallet', 'teal'],
  };
  /** entradas da trilha para uma entidade ({kind:'operacao'|'lote'|'titulo'|'extrato', id}) como itens de ui.timeline, mais antigas primeiro */
  F.timelineItems = (kind, id, o = {}) => ledger.forEntity(kind, id).slice().sort((a, b) => a.ts - b.ts).map((e) => { const [ic, tone] = ACAO[e.acao] || ['circle', 'neutral']; return { icon: ic, tone, title: e.resumo, ts: e.ts, actor: e.actor.nome, tag: e.classe === 'R3' ? h('span.badge.badge-neutral', { style: 'margin-left:8px', title: 'Classe de risco R3: ação com dinheiro ou cessão' }, 'R3') : null }; });
  F.timeline = (kind, id, o = {}) => { const items = F.timelineItems(kind, id, o); return items.length ? ui.timeline(items) : ui.empty({ icon: 'history', title: 'Sem eventos ainda', text: 'Os eventos desta operação aparecem aqui assim que acontecerem.' }); };

  /* ---------------------- assinatura com ICP-Brasil ---------------------- */
  /** Abre o fluxo de assinatura. parte: 'cedente' | 'financiador'. Resolve true se assinou. */
  F.assinar = function (contratoId, parte) {
    const ct = db.get('contratos', contratoId); const op = db.get('operacoes', ct.opId); const ced = db.get('orgs', ct.partes.cedenteId); const fin = db.get('orgs', ct.partes.financiadorId);
    if (!C.can('assinar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('assinar') }); return Promise.resolve(false); }
    let cert = 'a3'; let pin;
    const pinField = ui.field({ label: 'PIN do certificado', hint: 'Demonstração: qualquer PIN com 4 ou mais dígitos.', required: true }, (pin = ui.input({ type: 'password', mask: 'otp', placeholder: '••••', inputmode: 'numeric', maxlength: 6 })));
    const m = ui.modal({
      title: 'Assinar contrato de cessão', subtitle: `${ct.id} · ${ct.versao}`, icon: 'file-signature', size: 'md', staticBackdrop: true,
      body: h('div.stack.tight',
        ui.callout({ tone: 'info', title: 'Assinatura qualificada ICP-Brasil', text: 'O contrato só vale com certificado ICP-Brasil das duas partes. A Cedy não rebaixa o nível da assinatura.' }),
        ui.kv([['Cedente', ced.nome], ['Financiador', parte === 'cedente' ? 'Identificado após o aceite: ' + (fin.fantasia || fin.nome) : fin.nome], ['Operação', op.id + ' · ' + op.nTitulos + ' título(s)'], ['Valor de face', fmt.brl(op.face)], ['Taxa aceita', fmt.taxa(op.taxaFinal)], ['Valor líquido ao cedente', fmt.brl(op.liquido)], ['Modalidade', op.regresso ? 'Com regresso' : 'Sem regresso'], ['Impressão digital do documento', h('span.mono', ct.hashDoc)]]),
        ui.field({ label: 'Certificado digital' }, ui.radio({ layout: 'stack', value: cert, onChange: (v) => (cert = v), options: [{ value: 'a3', label: 'Token A3 (Certisign)', hint: 'Série 4F2A••, válido até 14/08/2027', icon: 'key-round' }, { value: 'cloud', label: 'Certificado em nuvem (BirdID)', hint: 'Aprovação no aplicativo do celular', icon: 'smartphone' }, { value: 'a1', label: 'Arquivo A1 (.pfx)', hint: 'Instalado neste dispositivo', icon: 'file-check' }] })),
        pinField),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Assinar com certificado', { variant: 'primary', icon: 'pen-line', onclick: async () => {
        if (String(pin.value).length < 4) { pinField.setError('Informe o PIN (4 a 6 dígitos).'); return; } pinField.setError('');
        await new Promise((r) => setTimeout(r, 900));
        const r = E.assinarContrato(contratoId, parte, session.get().userId, { tipo: { a3: 'A3 (token)', cloud: 'Nuvem (BirdID)', a1: 'A1 (arquivo)' }[cert] });
        if (!r.ok) { ui.toast('Não foi possível assinar', { type: 'error', text: r.erro }); return; }
        ui.toast(r.completo ? 'Cessão assinada pelas duas partes' : 'Sua assinatura foi registrada', { type: 'success', text: r.completo ? 'Aguardando o pagamento do financiador.' : 'Falta a assinatura da outra parte.' }); api.close(true);
      } })] });
    return m.promise.then((v) => !!v);
  };

  /** cartão do contrato com as assinaturas */
  F.contratoCard = function (ct) {
    const sigs = ct.assinaturas || []; const row = (parte, label) => { const s = sigs.find((x) => x.parte === parte); return h('div.list-item', h('span', { class: ['tl-dot'], style: 'flex:none' }, icon(s ? 'circle-check' : 'clock', 14)), h('div.grow', h('strong', label), h('div.small.muted', s ? `${s.nome} · ${s.icp.tipo}, série ${s.icp.serie}` : 'Aguardando assinatura')), s ? h('span.small.muted', fmt.datetime(s.em)) : null); };
    return h('div.stack.tight', h('div.row.between', h('div', h('strong', ct.id), h('div.small.muted', ct.versao)), ui.status('contrato', ct.status)), h('div.list', row('cedente', 'Cedente'), row('financiador', 'Financiador')), h('div.small.muted', 'Impressão digital: ', h('span.mono', ct.hashDoc)));
  };

  /** abre o PDF simulado do contrato (visualizador próprio) */
  F.verContrato = function (ct) {
    const op = db.get('operacoes', ct.opId); const ced = db.get('orgs', ct.partes.cedenteId); const fin = db.get('orgs', ct.partes.financiadorId);
    ui.drawer({ title: 'Contrato de cessão ' + ct.id, subtitle: ct.versao + ' · modelo de demonstração', icon: 'file-text', size: 'lg', body: h('div.doc',
      h('h3', 'Instrumento particular de cessão de créditos'), h('p.muted.small', 'Texto ilustrativo do protótipo. O modelo definitivo depende de parecer jurídico (P13).'),
      h('p', h('strong', 'Cedente: '), `${ced.nome}, CNPJ ${fmt.cnpj(ced.cnpj)}.`), h('p', h('strong', 'Cessionário: '), `${fin.nome}, CNPJ ${fmt.cnpj(fin.cnpj)}.`),
      h('p', `Objeto: cessão de ${op.nTitulos} título(s) de crédito, valor de face de ${fmt.brl(op.face)}, pelo preço de ${fmt.brl(op.liquido)}, à taxa de ${fmt.taxa(op.taxaFinal)}, ${op.regresso ? 'com' : 'sem'} regresso.`),
      h('ol', op.tituloIds.map((id) => { const t = db.get('titulos', id); return h('li', `${t.numero}, sacado ${(db.get('orgs', t.sacadoId) || {}).nome}, ${fmt.brl(t.valor)}, vencimento ${fmt.date(t.vencimento)}`); })),
      h('p', 'O pagamento será feito diretamente pelo cessionário na conta de liquidação do cedente. A Cedy atua como intermediadora e não custodia recursos.'),
      h('hr.divider'), (ct.assinaturas || []).map((s) => h('p.small', h('strong', s.parte === 'cedente' ? 'Cedente: ' : 'Cessionário: '), `${s.nome}, assinado em ${fmt.datetime(s.em)} (${s.icp.emissor}, série ${s.icp.serie}). Hash ${s.hash}`)), !(ct.assinaturas || []).length && h('p.muted.small', 'Ainda sem assinaturas.')) });
  };

  /** mostra o snapshot (o que cada parte viu no aceite) de forma legível */
  F.snapshotView = (snap) => snap ? ui.kv(Object.entries(snap).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), typeof v === 'number' ? String(v) : String(v)])) : h('span.muted', 'Sem snapshot');

  /** dados de pagamento do financiador ao cedente */
  F.pagar = function (opId) {
    const op = db.get('operacoes', opId); const ced = db.get('orgs', op.cedenteId);
    if (!C.can('pagar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('pagar') }); return Promise.resolve(false); }
    const late = C.clock.now() > op.pagamentoLimite;
    const m = ui.modal({ title: 'Registrar pagamento ao cedente', icon: 'banknote', size: 'md',
      body: h('div.stack.tight', late ? ui.callout({ tone: 'warn', title: 'Fora do prazo', text: `O limite era ${fmt.datetime(op.pagamentoLimite)}. A Cedy registra o atraso e avisa o cedente.` }) : ui.callout({ tone: 'info', title: 'Pagamento direto', text: `A Cedy não custodia recursos: o pagamento vai direto para a conta de liquidação do cedente, no banco parceiro. Limite: ${fmt.datetime(op.pagamentoLimite)}.` }),
        ui.kv([['Valor a pagar', h('strong', fmt.brl(op.liquido))], ['Favorecido', ced.nome], ['CNPJ', fmt.cnpj(ced.cnpj)], ['Banco', ced.contaLiquidacao.banco], ['Agência / conta', `${ced.contaLiquidacao.agencia} / ${ced.contaLiquidacao.conta}`], ['Referência', op.id]])),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Pagar via banco parceiro', { variant: 'primary', icon: 'send', onclick: async () => { await new Promise((r) => setTimeout(r, 900)); const r = E.registrarPagamento(opId, session.get().userId); if (!r.ok) { ui.toast('Não foi possível registrar', { type: 'error', text: r.erro }); return; } ui.toast('Pagamento confirmado pelo banco', { type: 'success', text: `${fmt.brl(op.liquido)} para ${ced.fantasia}` }); api.close(true); } })] });
    return m.promise.then((v) => !!v);
  };
})();
