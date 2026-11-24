/* =========================================================================
   Cedy Superadmin (dados): /super/dados, /super/catalogo, /super/backups,
   /super/lgpd. Persona: Larissa Nogueira (dados e risco). Prefixo CSS: sdt-.
   Clássico, sem dependências. Tudo deriva do db; mutações passam pelo
   motor ou por db + trilha (ledger) e avisam por notify quando relevante.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui; const F = C.flows;
  const { db, session, ledger, notify } = C.store; const E = C.engine; const cal = C.cal;
  const now = () => C.clock.now(); const DAY = 86400000;
  const me = () => E.actors.user(session.get().userId);
  const RO = () => !!(session.get() || {}).impersonando;
  const orgName = (id) => { const o = db.get('orgs', id); return o ? (o.fantasia || o.nome) : (id || '—'); };
  const userName = (id) => { const u = db.get('users', id); return u ? u.nome : (id || '—'); };
  const shortId = (id) => (String(id).length > 16 ? String(id).slice(0, 3) + '…' + String(id).slice(-5) : String(id));

  function download(nome, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo || 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  const csvCell = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';

  /* ------------------------- mascaramento (LGPD) ------------------------- */
  function maskEmail(v) { const s = String(v || ''); const [l, d] = s.split('@'); if (!d) return '—'; return (l ? l[0] + '***' : '***') + '@' + d; }
  function maskNome(v) { const p = String(v || '').split(/\s+/).filter(Boolean); if (!p.length) return '—'; return p.map((w) => w[0] + '***').join(' '); }
  function maskDoc(v) { const d = String(v || '').replace(/\D/g, ''); if (d.length < 4) return '—'; return '***' + d.slice(-4); }
  function maskFone(v) { const d = String(v || '').replace(/\D/g, ''); if (d.length < 2) return '—'; return '(**) *****-' + d.slice(-4); }
  function maskVal(key, v) {
    if (v === null || v === undefined || v === '') return '—';
    const k = String(key).toLowerCase();
    if (/(email|e-mail)/.test(k)) return maskEmail(v);
    if (/(nome|titular|responsavel|socio|representante|favorecido)/.test(k)) return maskNome(v);
    if (/(cnpj|cpf|doc)/.test(k)) return maskDoc(v);
    if (/(telefone|celular|fone)/.test(k)) return maskFone(v);
    if (/(conta|agencia|banco)/.test(k) && typeof v === 'string' && /\d/.test(v)) return maskDoc(v);
    if (typeof v === 'object') return '[registro]';
    const s = String(v); return s.length > 42 ? s.slice(0, 42) + '…' : s;
  }

  /* ============================ /super/dados ============================= */
  const SEV_W = { alta: 8, media: 4, baixa: 2 };
  const SEV_TONE = { alta: 'red', media: 'amber', baixa: 'neutral' };
  const DOMS = { ID: 'Identidade e acesso', KYC: 'Cadastro e KYC', REC: 'Recebíveis', RSK: 'Risco e crédito', MKT: 'Indicações', LIQ: 'Liquidação', WF: 'Fluxos e Mesa', GOV: 'Governança e trilha', FRM: 'Financeiro' };

  const RULES = [
    { id: 'tit-orfao', sev: 'alta', dom: 'REC', titulo: 'Títulos órfãos em operação', desc: 'Títulos com status em operação sem operação válida vinculada. Travam a carteira e somem dos fluxos.',
      run() { const rows = db.where('titulos', (t) => t.status === 'em_operacao' && (!t.operacaoId || !db.get('operacoes', t.operacaoId))).map((t) => ({ id: t.id, label: t.numero || t.id, detail: orgName(t.orgId) + ' · ' + fmt.brl(t.valor), link: '/ops/empresas/' + t.orgId, rec: t })); return rows; },
      fix: (rows, uid) => rows.forEach((r) => db.patch('titulos', r.id, { status: 'disponivel', operacaoId: null })), fixLabel: 'Reabrir como disponível' },
    { id: 'op-paga-sem-cessao', sev: 'alta', dom: 'REC', titulo: 'Operações pagas sem cessão assinada', desc: 'Operação com status paga cujo contrato não está assinado pelas duas partes. O dinheiro saiu sem a garantia formal.',
      run() { return db.where('operacoes', (o) => o.status === 'paga' && (!o.contratoId || (db.get('contratos', o.contratoId) || {}).status !== 'assinado')).map((o) => ({ id: o.id, label: o.id, detail: orgName(o.cedenteId) + ' · ' + fmt.brl(o.face), link: '/ops/empresas/' + o.cedenteId })); } },
    { id: 'contrato-parcial', sev: 'media', dom: 'REC', titulo: 'Contratos parciais há mais de 1 dia útil', desc: 'Cessões com só uma assinatura paradas há mais de um dia útil. Risco de atraso no pagamento ao cedente.',
      run() { const lim = now(); return db.where('contratos', (c) => c.status === 'parcial' && cal.addUteis(c.geradoEm || c.criadoEm || lim, 1) < lim).map((c) => ({ id: c.id, label: c.id, detail: 'Operação ' + c.opId, link: '/ops/empresas/' + ((db.get('operacoes', c.opId) || {}).cedenteId || '') })); } },
    { id: 'nfe-dup', sev: 'alta', dom: 'REC', titulo: 'Chaves de NF-e duplicadas', desc: 'A mesma chave aparece em mais de um título. Indica duplicidade de lastro ou reimportação indevida.',
      run() { const g = C.groupBy(db.all('titulos').filter((t) => t.chave), (t) => String(t.chave).replace(/\D/g, '')); const rows = []; Object.values(g).forEach((l) => { if (l.length > 1) l.forEach((t) => rows.push({ id: t.id, label: t.numero || t.id, detail: 'Chave repetida em ' + l.length + ' títulos · ' + orgName(t.orgId), link: '/ops/empresas/' + t.orgId, rec: t })); }); return rows; } },
    { id: 'tit-venc-sem-acao', sev: 'alta', dom: 'REC', titulo: 'Títulos vencidos sem ação', desc: 'Títulos vencidos que ainda aguardam cobrança, regresso ou recompra. Cada dia parado é perda esperada.',
      run() { return db.where('titulos', (t) => t.status === 'vencido').map((t) => ({ id: t.id, label: t.numero || t.id, detail: orgName(t.orgId) + ' · venceu ' + fmt.date(t.vencimento), link: '/ops/empresas/' + t.orgId, rec: t })); } },
    { id: 'ext-novo-24h', sev: 'media', dom: 'LIQ', titulo: 'Créditos novos parados há mais de 24 h', desc: 'Linhas de extrato ainda como novas depois de um dia. A conciliação automática deveria ter tentado.',
      run() { return db.where('extrato', (x) => x.status === 'novo' && x.ts < now() - DAY).map((x) => ({ id: x.id, label: fmt.brl(x.valor), detail: (x.pagadorNome || 'Pagador desconhecido') + ' · há ' + fmt.rel(x.ts), link: '/ops/conciliacao', rec: x })); } },
    { id: 'ext-conc-sem-match', sev: 'alta', dom: 'LIQ', titulo: 'Extratos conciliados sem correspondência', desc: 'Linhas marcadas como conciliadas sem nenhum vínculo com operação. O saldo pode estar sem lastro.',
      run() { return db.where('extrato', (x) => x.status === 'conciliado' && !(x.matches || []).length).map((x) => ({ id: x.id, label: fmt.brl(x.valor), detail: orgName(x.orgId) + ' · ' + fmt.datetime(x.ts), link: '/ops/conciliacao', rec: x })); } },
    { id: 'mesa-sla', sev: 'alta', dom: 'WF', titulo: 'Casos da Mesa com SLA vencido', desc: 'Casos abertos cujo prazo de decisão já passou. Atrasam liquidação e repasse.',
      run() { return db.where('casosMesa', (c) => c.status === 'aberto' && c.slaAte < now()).map((c) => ({ id: c.id, label: shortId(c.id), detail: (c.motivo || c.tipo) + ' · ' + fmt.brl(c.valor), link: '/ops/conciliacao/' + c.id, rec: c })); } },
    { id: 'repasse-vencido', sev: 'alta', dom: 'LIQ', titulo: 'Repasses agendados vencidos e não pagos', desc: 'Repasses ao financiador com data prevista passada e ainda agendados. Dinheiro do investidor parado.',
      run() { return db.where('repasses', (r) => r.status === 'agendado' && r.previstoPara < now()).map((r) => ({ id: r.id, label: fmt.brl(r.valor), detail: 'Operação ' + r.opId + ' · previsto ' + fmt.date(r.previstoPara), link: '/ops/faturamento', rec: r })); } },
    { id: 'op-venc-sem-regresso', sev: 'alta', dom: 'RSK', titulo: 'Operações vencidas sem regresso há 5+ dias úteis', desc: 'Operações vencidas com regresso disponível e ainda não acionado depois de cinco dias úteis.',
      run() { return db.where('operacoes', (o) => o.status === 'vencida' && o.regresso && !o.regressoAcionado && cal.addUteis(Math.min(...o.tituloIds.map((id) => (db.get('titulos', id) || {}).vencimento || now())), 5) < now()).map((o) => ({ id: o.id, label: o.id, detail: orgName(o.cedenteId) + ' · saldo ' + fmt.brl(o.saldoAberto), link: '/ops/empresas/' + o.cedenteId, rec: o })); } },
    { id: 'empresa-sem-kyc', sev: 'alta', dom: 'KYC', titulo: 'Empresas ativas sem KYC aprovado', desc: 'Cedentes, financiadores ou originadores operando sem cadastro aprovado. Exposição regulatória direta.',
      run() { return db.where('orgs', (o) => ['cedente', 'financiador', 'originador'].includes(o.kind) && o.status === 'ativo' && (db.get('kyc', 'kyc-' + o.id) || {}).status !== 'aprovado').map((o) => ({ id: o.id, label: o.fantasia || o.nome, detail: o.kind + ' · desde ' + fmt.date(o.ativoDesde), link: '/ops/empresas/' + o.id, rec: o })); } },
    { id: 'user-sem-2fa', sev: 'media', dom: 'ID', titulo: 'Usuários sem segundo fator', desc: 'Contas sem 2FA ativo, contra a política de segurança da plataforma.',
      run() { return db.where('users', (u) => !u.twofa && !u.inativo).map((u) => ({ id: u.id, label: u.nome, detail: u.email + ' · ' + (orgName(u.orgId)), link: '/super/usuarios', rec: u })); } },
    { id: 'user-inativo-60d', sev: 'baixa', dom: 'ID', titulo: 'Usuários sem acesso há mais de 60 dias', desc: 'Contas paradas que mantêm acesso. Candidatas a revisão ou desativação.',
      run() { return db.where('users', (u) => u.ultimoAcesso && u.ultimoAcesso < now() - 60 * DAY && !u.inativo).map((u) => ({ id: u.id, label: u.nome, detail: 'Último acesso ' + fmt.date(u.ultimoAcesso), link: '/super/usuarios', rec: u })); } },
    { id: 'org-admins', sev: 'media', dom: 'ID', titulo: 'Empresas com 0 ou mais de 3 admins', desc: 'Empresas sem nenhum administrador ficam órfãs; mais de três admins amplia a superfície de fraude.',
      run() { const rows = []; db.all('orgs').filter((o) => o.kind !== 'cedy').forEach((o) => { const n = db.where('users', (u) => u.orgId === o.id && u.perfil === 'admin' && !u.inativo).length; if (n === 0 || n > 3) rows.push({ id: o.id, label: o.fantasia || o.nome, detail: n === 0 ? 'Sem administrador' : n + ' administradores', link: '/ops/empresas/' + o.id, rec: o }); }); return rows; } },
    { id: 'prem-split', sev: 'alta', dom: 'FRM', titulo: 'Premiações com divisão inconsistente', desc: 'Parte do subparceiro mais parte do originador diferente do total, ou subparceiro inexistente.',
      run() { return db.where('premiacoes', (p) => Math.abs((p.parteSub || 0) + (p.parteOrig || 0) - (p.total || 0)) > 0.011 || (p.subId && !db.get('subparceiros', p.subId))).map((p) => ({ id: p.id, label: p.competencia + ' · ' + orgName(db.get('orgs', p.cedenteId) && p.cedenteId), detail: 'Total ' + fmt.brl(p.total) + ' contra ' + fmt.brl((p.parteSub || 0) + (p.parteOrig || 0)), link: '/ops/faturamento', rec: p })); },
      fix: (rows) => rows.forEach((r) => { const p = db.get('premiacoes', r.id); const ok = p.subId && db.get('subparceiros', p.subId); db.patch('premiacoes', r.id, ok ? { parteSub: C.round2(p.total * (p.splitPct || 0) / 100), parteOrig: C.round2(p.total - C.round2(p.total * (p.splitPct || 0) / 100)) } : { subId: null, splitPct: 0, parteSub: 0, parteOrig: p.total }); }), fixLabel: 'Recalcular a divisão' },
    { id: 'convite-cnpj-dup', sev: 'media', dom: 'KYC', titulo: 'Convites com CNPJ duplicado', desc: 'O mesmo CNPJ convidado mais de uma vez. Pode quebrar a regra de primeiro cadastro.',
      run() { const g = C.groupBy(db.all('convites').filter((c) => c.cnpj), (c) => String(c.cnpj).replace(/\D/g, '')); const rows = []; Object.values(g).forEach((l) => { if (l.length > 1) l.forEach((c) => rows.push({ id: c.id, label: c.nome, detail: fmt.cnpj(c.cnpj) + ' · ' + l.length + ' convites', link: '/originador/indicados', rec: c })); }); return rows; } },
    { id: 'sub-inativo-90d', sev: 'baixa', dom: 'MKT', titulo: 'Subparceiros ativos sem indicados há 90 dias', desc: 'Subparceiros ativos sem movimento de indicação há três meses. Base para revisão de splits.',
      run() { return db.where('subparceiros', (s) => s.status === 'ativo').filter((s) => { const cands = [s.ultimaAtividade || 0].concat(db.where('convites', (c) => c.subId === s.id).map((c) => c.ultimaAtividade || c.enviadoEm || 0)); return Math.max(...cands) < now() - 90 * DAY; }).map((s) => ({ id: s.id, label: s.nome, detail: 'Última atividade ' + fmt.date(s.ultimaAtividade), link: '/originador/subparceiros/' + s.id, rec: s })); } },
    { id: 'notif-sem-dest', sev: 'baixa', dom: 'GOV', titulo: 'Notificações sem destinatário', desc: 'Avisos sem alvo definido que nunca chegam a ninguém. Lixo que polui as consultas.',
      run() { return db.where('notifs', (n) => !n.to || !Object.keys(n.to).length).map((n) => ({ id: n.id, label: n.titulo || n.id, detail: fmt.datetime(n.ts), link: null, rec: n })); },
      fix: (rows) => rows.forEach((r) => db.del('notifs', r.id)), fixLabel: 'Remover órfãs' },
    { id: 'ts-futuro', sev: 'media', dom: 'GOV', titulo: 'Registros com data no futuro', desc: 'Eventos passados carimbados depois da hora atual. Quebram ordenação, SLA e auditoria.',
      run() { const FIELDS = ['ts', 'criadoEm', 'atualizadoEm', 'pagoEm', 'emitidaEm', 'abertaEm', 'solicitadoEm', 'decididoEm', 'inicioEm', 'resolvidoEm', 'enviadoEm', 'geradoEm', 'aceitaEm', 'liquidadaEm']; const rows = []; const tol = now() + 5 * 60e3; C.store.COLLECTIONS.forEach((c) => db.all(c).forEach((r) => FIELDS.forEach((f) => { if (typeof r[f] === 'number' && r[f] > tol) rows.push({ id: r.id, label: c + ' · ' + shortId(r.id), detail: f + ' em ' + fmt.datetime(r[f]), link: null, rec: r }); }))); return rows.slice(0, 60); } },
    { id: 'limite-estourado', sev: 'alta', dom: 'RSK', titulo: 'Exposição acima do limite', desc: 'Financiadores cuja exposição em operações ativas supera o limite total da política.',
      run() { return db.where('orgs', (o) => o.kind === 'financiador' && o.status === 'ativo').map((f) => { const exp = C.round2(C.sum(db.where('operacoes', (o) => o.financiadorId === f.id && ['cessao', 'aguardando_pagamento', 'paga', 'vencida', 'parcial'].includes(o.status)), (o) => o.face || 0)); const lim = (f.politica || {}).limiteTotal; return { f, exp, lim }; }).filter((x) => x.lim && x.exp > x.lim).map((x) => ({ id: x.f.id, label: x.f.fantasia || x.f.nome, detail: 'Exposição ' + fmt.brl(x.exp, { round: true }) + ' acima de ' + fmt.brl(x.lim, { round: true }), link: '/ops/empresas/' + x.f.id, rec: x.f })); } },
    { id: 'lar-negativo', sev: 'alta', dom: 'RSK', titulo: 'Cedentes com LAR estourado', desc: 'Limite de antecipação com disponível negativo: exposição acima do limite calculado pelo motor. Exige revisão de limite ou recompra.',
      run() { return db.where('orgs', (o) => o.kind === 'cedente' && o.status === 'ativo').map((o) => ({ o, lar: E.lar(o.id) })).filter((x) => x.lar && x.lar.disponivel < -0.005).map((x) => ({ id: x.o.id, label: x.o.fantasia || x.o.nome, detail: 'Disponível ' + fmt.brl(x.lar.disponivel) + ' · limite ' + fmt.brl(x.lar.limite, { round: true }), link: '/ops/empresas/' + x.o.id, rec: x.o })); } },
    { id: 'trilha-integra', sev: 'alta', dom: 'GOV', titulo: 'Integridade da trilha de decisões', desc: 'Verifica a cadeia de hashes da trilha. Qualquer quebra indica adulteração e invalida a auditoria.',
      run() { const v = ledger.verify(); return v.ok ? [] : [{ id: v.id || '?', label: 'Quebra na sequência ' + (v.brokenAt || '?'), detail: 'Entrada ' + (v.id || '?') + ' com hash divergente', link: '/ops/trilha', rec: null }]; } },
    { id: 'storage-cota', sev: 'media', dom: 'GOV', titulo: 'Armazenamento perto da cota', desc: 'Tamanho do estado no navegador contra a cota estimada de 5 MB. Acima de 90% há risco de perda de escrita.',
      run() { let bytes = 0; try { bytes = (localStorage.getItem('cedy-proto-0.1') || '').length; } catch (e) { bytes = JSON.stringify(db.state).length; } const pct = bytes / (5 * 1048576); return pct > 0.7 ? [{ id: 'localStorage', label: 'Estado local', detail: fmt.bytes(bytes) + ' (' + Math.round(pct * 100) + '% da cota)', link: null, rec: null }] : []; } },
  ];
  const HIST_KEY = 'cedy-dados-hist-v1';
  function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }
  function saveHist(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-60))); } catch (e) { /* sem espaço */ } }
  function evalRules() { return RULES.map((r) => { let rows = []; try { rows = r.run() || []; } catch (e) { console.error(e); rows = []; } return { rule: r, rows,Fails: rows.length, status: rows.length ? (r.sev === 'alta' ? 'falha' : 'atenção') : 'ok' }; }); }
  function scoreOf(ev) { let pen = 0; ev.forEach((e) => { if (e.rows.length) pen += SEV_W[e.rule.sev]; }); return Math.max(0, 100 - pen); }

  function sevBadge(s) { return ui.badge({ alta: 'Alta', media: 'Média', baixa: 'Baixa' }[s], SEV_TONE[s], { dot: true }); }
  function stBadge(st) { return ui.badge(st === 'ok' ? 'Ok' : st === 'atenção' ? 'Atenção' : 'Falha', st === 'ok' ? 'green' : st === 'atenção' ? 'amber' : 'red', { dot: true }); }

  function downloadCsv(nome, linhas) { download(nome, '﻿' + linhas.map((l) => l.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8'); }

  function pgDados(ctx) {
    let dom = 'todos'; let sevs = []; let q = '';
    let ev = evalRules(); let score = scoreOf(ev); let hist = loadHist(); let running = false;
    let prevCounts = hist.length && hist[hist.length - 1].counts ? hist[hist.length - 1].counts : null;
    function tendencia(e) {
      if (!prevCounts || prevCounts[e.rule.id] === undefined) return h('span.muted', { title: 'Sem execução anterior para comparar' }, '—');
      const d = e.rows.length - prevCounts[e.rule.id];
      if (!d) return h('span.sdt-tend.is-igual', { title: 'Igual à verificação anterior' }, '=');
      return h('span.sdt-tend', { class: [d > 0 ? 'is-alta' : 'is-queda'], title: (d > 0 ? '+' : '') + d + ' afetados contra a verificação anterior' }, (d > 0 ? '▲ +' : '▼ ') + d);
    }
    const page = h('div.stack.sdt-page');
    const head = ui.pageHeader({ eyebrow: 'Superadmin · dados', title: 'Qualidade dos dados',
      subtitle: 'Regras avaliadas ao vivo sobre o estado atual. Nada aqui muda dados sozinho: cada correção pede confirmação e fica na trilha.',
      actions: [ui.btn('Injetar inconsistência de teste', { variant: 'secondary', icon: 'microscope', title: 'Demonstração: cria um título órfão, uma chave duplicada e um extrato sem correspondência', onclick: injetar }), ui.btn('Exportar achados (CSV)', { variant: 'secondary', icon: 'download', onclick: () => exportar() }), ui.btn('Executar verificação', { variant: 'primary', icon: 'play', onclick: executar })] });
    page.append(head);
    if (RO()) page.append(ui.callout({ tone: 'warn', title: 'Modo ver como: somente leitura', text: 'Correções e a injeção de teste estão desativadas enquanto o acesso auditado estiver ativo.' }));
    const top = h('div'); page.append(top);
    const list = h('div'); page.append(list);
    const histBox = h('div'); page.append(histBox);
    function drawTop() {
      C.clear(top);
      const fails = ev.filter((e) => e.rows.length);
      top.append(ui.grid(4,
        ui.kpi({ label: 'Pontuação de qualidade', value: score, display: score + ' / 100', hint: fails.length ? fmt.plural(fails.length, 'regra com falha', 'regras com falha') : 'Nenhuma regra com falha', tone: score >= 85 ? 'green' : score >= 60 ? 'amber' : 'red', icon: 'database' }),
        ui.kpi({ label: 'Falhas graves', value: fails.filter((e) => e.rule.sev === 'alta').length, icon: 'triangle-alert', tone: 'red', hint: 'Severidade alta' }),
        ui.kpi({ label: 'Registros afetados', value: C.sum(ev, (e) => e.rows.length), icon: 'list-filter', hint: 'Somados em todas as regras' }),
        ui.kpi({ label: 'Última verificação', value: 1, display: hist.length ? fmt.rel(hist[hist.length - 1].ts) : 'agora', icon: 'history', hint: hist.length + ' execuções guardadas' })));
      top.append(ui.card({ title: 'Como a pontuação é calculada', subtitle: 'Pesos por severidade, teto em zero' },
        h('p.small.muted', 'Cada regra com falha desconta pontos da nota 100: alta desconta 8, média desconta 4, baixa desconta 2. O valor não passa de zero e não depende do volume de registros, só da quantidade de regras com falha. O gráfico guarda o histórico das execuções neste navegador.')));
    }
    function drawHist() {
      C.clear(histBox);
      if (hist.length < 2) { histBox.append(ui.card({ title: 'Tendência', subtitle: 'Histórico de execuções' }, h('p.small.muted', 'Execute a verificação ao menos duas vezes para ver a tendência. O histórico fica neste navegador.'))); return; }
      const data = hist.slice(-20).map((hh) => ({ x: fmt.dateShort(hh.ts), y: hh.score }));
      histBox.append(ui.card({ title: 'Tendência da pontuação', subtitle: 'Últimas ' + data.length + ' execuções', actions: [ui.btn('Limpar histórico', { variant: 'ghost', size: 'sm', onclick: () => { hist = []; saveHist(hist); drawHist(); } })] },
        ui.chart.line({ series: [{ name: 'Pontuação', tone: 'teal', data }], height: 180, format: (v) => String(Math.round(v)), zero: false })));
    }
    function filtrados() {
      return ev.filter((e) => (dom === 'todos' || e.rule.dom === dom) && (!sevs.length || sevs.includes(e.rule.sev)) && (!q || (e.rule.titulo + ' ' + e.rule.desc).toLowerCase().includes(q)));
    }
    function drawList() {
      C.clear(list);
      const rows = filtrados();
      if (!rows.length) { list.append(ui.empty({ icon: 'circle-check', title: 'Nenhuma regra neste filtro', text: 'Ajuste o domínio ou a severidade para ver mais regras.' })); return; }
      list.append(ui.table({ rows, rowKey: (r) => r.rule.id, onRowClick: (r) => abrirRegra(r), columns: [
        { key: 'titulo', label: 'Regra', mobile: 'primary', render: (e) => h('div.cell-main', h('strong', e.rule.titulo), h('small.muted', e.rule.id)) },
        { key: 'dom', label: 'Domínio', mobile: 'hide', render: (e) => h('span.small', DOMS[e.rule.dom]) },
        { key: 'sev', label: 'Severidade', render: (e) => sevBadge(e.rule.sev) },
        { key: 'n', label: 'Afetados', align: 'right', render: (e) => h('strong', fmt.num(e.rows.length)) },
        { key: 'tend', label: 'Tendência', align: 'right', mobile: 'hide', render: (e) => tendencia(e) },
        { key: 'st', label: 'Estado', render: (e) => stBadge(e.status) },
      ] }));
    }
    function toolbar() {
      const domOpts = [{ value: 'todos', label: 'Todos os domínios' }].concat(Object.entries(DOMS).map(([v, label]) => ({ value: v, label })));
      const sel = ui.select({ value: dom, options: domOpts, aria: 'Filtrar por domínio', onChange: (v) => { dom = v; drawList(); } });
      const chips = ui.chips({ aria: 'Filtrar por severidade', options: [{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Média' }, { value: 'baixa', label: 'Baixa' }], onChange: (v) => { sevs = v; drawList(); } });
      const busca = ui.search({ placeholder: 'Buscar regra', onInput: C.debounce((v) => { q = String(v || '').toLowerCase(); drawList(); }, 200) });
      return ui.toolbar(sel, chips, busca);
    }
    page.insertBefore(toolbar(), top);
    drawTop(); drawList(); drawHist();
    function refresh(silent) { ev = evalRules(); score = scoreOf(ev); drawTop(); drawList(); if (!silent) ui.toast('Verificação concluída', { type: score >= 85 ? 'success' : 'warn', text: 'Pontuação ' + score + ' de 100.' }); }

    function executar() {
      if (running) return; running = true;
      const bar = ui.progress(0); let pct = 0; let i = 0;
      const m = ui.modal({ title: 'Executando verificação', icon: 'play', size: 'sm', dismissable: false, body: h('div.stack.tight', h('p.small.muted.step-label', 'Preparando…'), bar) });
      const label = m.body.querySelector('.step-label');
      const step = () => {
        if (i < RULES.length) { const r = RULES[i]; if (label) label.textContent = `Regra ${i + 1} de ${RULES.length}: ${r.titulo}`; pct = Math.round(((i + 1) / RULES.length) * 100); m.body.querySelector('.progress').setAttribute('aria-valuenow', pct); const fill = m.body.querySelector('.progress i'); if (fill) fill.style.width = pct + '%'; i++; setTimeout(step, 55); return; }
        prevCounts = Object.fromEntries(ev.map((e) => [e.rule.id, e.rows.length]));
        ev = evalRules(); score = scoreOf(ev); hist = loadHist(); hist.push({ ts: now(), score, falhas: ev.filter((e) => e.rows.length).length, counts: Object.fromEntries(ev.map((e) => [e.rule.id, e.rows.length])) }); saveHist(hist);
        drawTop(); drawList(); drawHist(); running = false; m.close(true);
        ui.toast('Verificação concluída', { type: score >= 85 ? 'success' : 'warn', text: 'Pontuação ' + score + ' de 100.' });
      };
      setTimeout(step, 120);
    }
    function exportar() {
      const linhas = [['regra', 'titulo', 'severidade', 'dominio', 'estado', 'afetados']].concat(ev.map((e) => [e.rule.id, e.rule.titulo, e.rule.sev, DOMS[e.rule.dom], e.status, e.rows.length]));
      downloadCsv('achados-qualidade-dados.csv', linhas);
      ui.toast('Arquivo exportado', { type: 'success', text: 'achados-qualidade-dados.csv com ' + ev.length + ' regras.' });
    }
    async function injetar() {
      if (RO()) { ui.toast('Somente leitura', { type: 'warn', text: 'O modo ver como impede a injeção de teste.' }); return; }
      const okc = await ui.confirm({ title: 'Injetar inconsistência de teste?', icon: 'microscope', tone: 'danger', text: 'Demonstração: cria um título órfão em operação, um título com chave duplicada e um extrato conciliado sem correspondência. Tudo fica marcado como teste e pode ser corrigido na tela.', confirmLabel: 'Injetar' });
      if (!okc) return;
      const base = db.all('titulos').find((t) => t.chave) || {};
      const t1 = db.put('titulos', { id: C.uid('tt'), orgId: 'c-aurora', sacadoId: 's-boacompra', tipo: 'NF-e', numero: 'NF TESTE/001', chave: 'TESTE-INJECAO-' + now(), cnpjEmitente: (db.get('orgs', 'c-aurora') || {}).cnpj, valor: 1000, emissao: now() - DAY, vencimento: now() + 30 * DAY, produto: 'premium', status: 'em_operacao', operacaoId: 'OP-INEXISTENTE', loteId: null, lastro: { xml: true }, teste: true });
      db.put('titulos', { id: C.uid('tt'), orgId: 'c-aurora', sacadoId: 's-boacompra', tipo: 'NF-e', numero: 'NF TESTE/002', chave: base.chave, cnpjEmitente: (db.get('orgs', 'c-aurora') || {}).cnpj, valor: 1000, emissao: now() - DAY, vencimento: now() + 30 * DAY, produto: 'premium', status: 'disponivel', operacaoId: null, loteId: null, lastro: { xml: true }, teste: true });
      db.put('extrato', { id: C.uid('ex'), orgId: 'c-aurora', ts: now(), valor: 999.99, tipo: 'credito', pagadorNome: 'Teste de inconsistência', pagadorCnpj: '00.000.000/0001-00', descricao: 'Demonstração de qualidade de dados', status: 'conciliado', matches: [], teste: true });
      ledger.append({ actor: me(), acao: 'dados.inconsistencia_injetada', entidade: { kind: 'titulo', id: t1.id }, resumo: 'Demonstração: inconsistências de teste injetadas (título órfão, chave duplicada, extrato sem correspondência)', classe: 'R2', detalhe: { demonstracao: true } });
      refresh(true);
      ui.toast('Inconsistências injetadas', { type: 'warn', text: 'Três novos achados de demonstração. Execute a verificação para vê-los na lista.' });
    }
    function abrirRegra(e) {
      const r = e.rule;
      const rows = e.rows;
      const body = h('div.stack.tight',
        h('div.row.sdt-badges', sevBadge(r.sev), ui.badge(DOMS[r.dom], 'blue'), stBadge(e.status), h('span.small.muted', fmt.plural(rows.length, 'registro afetado', 'registros afetados'))),
        h('p.small', r.desc),
        rows.length ? ui.table({ rows, rowKey: (x) => x.id + (x.label || ''), pageSize: 10, columns: [
          { key: 'label', label: 'Registro', mobile: 'primary', render: (x) => x.link ? h('a', { href: '#' + x.link }, x.label) : h('span', x.label) },
          { key: 'detail', label: 'Detalhe', mobile: 'hide', render: (x) => h('span.small.muted', x.detail || '—') },
          { key: 'abrir', label: 'Abrir', align: 'right', render: (x) => x.link ? ui.btn('Abrir', { size: 'sm', route: x.link }) : h('span.muted', '—') },
        ] }) : ui.empty({ icon: 'circle-check', title: 'Sem achados', text: 'Esta regra passou na última avaliação.' }),
        r.id === 'trilha-integra' ? ui.callout({ tone: 'info', title: 'Cadeia de hashes', text: 'Cada entrada carrega o hash da anterior (FNV-1a de demonstração). A verificação recalcula tudo; qualquer edição manual quebra a cadeia.' }) : null);
      const foot = [];
      if (r.fix && rows.length && !RO()) foot.push(ui.btn(r.fixLabel + ' (' + rows.length + ')', { variant: 'primary', icon: 'pencil', onclick: async (ev2, btn) => {
        const okc = await ui.confirm({ title: r.fixLabel + '?', icon: 'pencil', tone: 'danger', text: rows.length + ' registros serão ajustados de forma reversível. A ação fica na trilha como R2.', confirmLabel: 'Corrigir' });
        if (!okc) return;
        db.batch(() => r.fix(rows, session.get().userId));
        ledger.append({ actor: me(), acao: 'dados.correcao', entidade: { kind: 'regra', id: r.id }, resumo: `Correção de qualidade (${r.id}): ${rows.length} registros ajustados`, classe: 'R2', detalhe: { regra: r.id, qtd: rows.length } });
        notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: 'Correção de dados aplicada', corpo: `${r.titulo}: ${rows.length} registros.`, link: '/super/dados' });
        ui.toast('Correção aplicada', { type: 'success', text: rows.length + ' registros ajustados. Execute a verificação de novo.' });
        refresh(true);
      } }));
      if (r.fix && RO()) foot.push(ui.btn(r.fixLabel, { disabled: true, title: 'Modo ver como: somente leitura' }));
      ui.drawer({ title: r.titulo, subtitle: 'Regra ' + r.id, icon: 'database', size: 'lg', body, footer: foot.length ? (() => { const f = h('div'); foot.forEach((b) => f.append(b)); return f; })() : null });
    }
    return page;
  }

  /* =========================== /super/catalogo =========================== */
  const CAT = {
    orgs: { dom: 'KYC', cls: 'Dados pessoais', desc: 'Empresas clientes e a própria Cedy: cadastro, documento, conta de liquidação e vínculos.', ret: null, base: 'Execução de contrato e obrigação legal [INFERÊNCIA]' },
    users: { dom: 'ID', cls: 'Dados pessoais', desc: 'Pessoas com acesso: identificação, contato, cargo, perfil e último acesso.', ret: 'logsAcessoMeses', base: 'Execução de contrato e legítimo interesse [INFERÊNCIA]' },
    titulos: { dom: 'REC', cls: 'Operacional', desc: 'Recebíveis importados: valor, vencimento, sacado, lastro e estado no fluxo.', ret: 'extratoAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    operacoes: { dom: 'REC', cls: 'Operacional', desc: 'Ofertas, leilão, aceite, cessão, pagamento e liquidação de cada operação.', ret: 'extratoAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    lances: { dom: 'REC', cls: 'Operacional', desc: 'Ofertas de taxa dos financiadores no leilão reverso.', ret: 'extratoAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    contratos: { dom: 'REC', cls: 'Dados pessoais', desc: 'Cessões de crédito e assinaturas ICP-Brasil das partes.', ret: 'documentosKycAnos', base: 'Execução de contrato e obrigação legal [INFERÊNCIA]' },
    extrato: { dom: 'LIQ', cls: 'Financeiro sensível', desc: 'Movimento da conta de liquidação e resultado da conciliação.', ret: 'extratoAnos', base: 'Obrigação legal de guarda, 5 anos [INFERÊNCIA]' },
    repasses: { dom: 'LIQ', cls: 'Financeiro sensível', desc: 'Repasses ao financiador e recursos liberados.', ret: 'extratoAnos', base: 'Obrigação legal de guarda, 5 anos [INFERÊNCIA]' },
    faturas: { dom: 'FRM', cls: 'Financeiro sensível', desc: 'Cobrança de taxa de serviço e taxa de acesso por financiador.', ret: 'extratoAnos', base: 'Obrigação legal e fiscal, 5 anos [INFERÊNCIA]' },
    premiacoes: { dom: 'FRM', cls: 'Financeiro sensível', desc: 'Apuração de premiação de originadores e divisão com subparceiros.', ret: 'extratoAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    kyc: { dom: 'KYC', cls: 'Dados pessoais', desc: 'Dossiês de cadastro: documentos, análise do agente e decisão.', ret: 'documentosKycAnos', base: 'Obrigação legal de KYC, 5 anos [INFERÊNCIA]' },
    convites: { dom: 'MKT', cls: 'Dados pessoais', desc: 'Convites de indicação com dados do contato e estado do funil.', ret: 'titularesAnos', base: 'Consentimento e legítimo interesse [INFERÊNCIA]' },
    agentes: { dom: 'WF', cls: 'Operacional', desc: 'Agentes de IA: escopo, nível de autonomia e métricas.', ret: null, base: 'Legítimo interesse [INFERÊNCIA]' },
    propostas: { dom: 'WF', cls: 'Operacional', desc: 'Propostas dos agentes aguardando decisão humana.', ret: 'logsAdminDias', base: 'Legítimo interesse [INFERÊNCIA]' },
    produtos: { dom: 'GOV', cls: 'Público', desc: 'Programas de produto: parâmetros, versões e histórico.', ret: null, base: 'Não contém dados pessoais' },
    notifs: { dom: 'GOV', cls: 'Operacional', desc: 'Avisos entregues no app, com destinatário e link.', ret: 'logsAdminDias', base: 'Legítimo interesse [INFERÊNCIA]' },
    lotes: { dom: 'REC', cls: 'Operacional', desc: 'Lotes de títulos importados e decisão da Mesa.', ret: 'extratoAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    contestacoes: { dom: 'FRM', cls: 'Operacional', desc: 'Contestações de premiação e seu estado.', ret: 'extratoAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    casosMesa: { dom: 'WF', cls: 'Operacional', desc: 'Casos da Mesa Conciliadora: motivo, SLA e rateio.', ret: 'extratoAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    subparceiros: { dom: 'MKT', cls: 'Dados pessoais', desc: 'Subparceiros do originador: documento, contato, split e conta de repasse.', ret: 'documentosKycAnos', base: 'Execução de contrato [INFERÊNCIA]' },
    aprovacoes: { dom: 'GOV', cls: 'Operacional', desc: 'Solicitações em dois passos: pedido, decisão e efeito aplicado.', ret: 'ledgerAnos', base: 'Obrigação legal e governança [INFERÊNCIA]' },
    incidentes: { dom: 'GOV', cls: 'Operacional', desc: 'Incidentes de plataforma: severidade, linha do tempo e pós-morte.', ret: 'ledgerAnos', base: 'Legítimo interesse [INFERÊNCIA]' },
    servicos: { dom: 'GOV', cls: 'Público', desc: 'Serviços e integrações monitorados, sem dados pessoais.', ret: null, base: 'Não contém dados pessoais' },
    backups: { dom: 'GOV', cls: 'Operacional', desc: 'Cópias de segurança: tipo, tamanho, retenção e teste de restauração.', ret: 'backupsDias', base: 'Legítimo interesse [INFERÊNCIA]' },
    titulares: { dom: 'GOV', cls: 'Dados pessoais', desc: 'Pedidos de titulares (LGPD): tipo, prazo, resposta e decisão.', ret: 'titularesAnos', base: 'Obrigação legal, 5 anos [INFERÊNCIA]' },
    eventosSeg: { dom: 'ID', cls: 'Dados pessoais', desc: 'Eventos de segurança: acessos, bloqueios e acessos ver como.', ret: 'logsAdminDias', base: 'Legítimo interesse e obrigação legal [INFERÊNCIA]' },
    usoIA: { dom: 'WF', cls: 'Operacional', desc: 'Uso diário de modelos por agente: requisições, tokens e custo.', ret: 'logsAdminDias', base: 'Legítimo interesse [INFERÊNCIA]' },
    modelosIA: { dom: 'WF', cls: 'Público', desc: 'Modelos disponíveis: provedor, região e residência dos dados.', ret: null, base: 'Não contém dados pessoais' },
    integracoes: { dom: 'ID', cls: 'Dados pessoais', desc: 'Credenciais de integração: identidades de agente, tokens de API e webhooks por empresa.', ret: 'logsAcessoMeses', base: 'Execução de contrato e legítimo interesse [INFERÊNCIA]' },
    ledger: { dom: 'GOV', cls: 'Dados pessoais', desc: 'Trilha de decisões com cadeia de hashes: quem fez o quê, quando e por quê.', ret: 'ledgerAnos', base: 'Obrigação legal de guarda, 5 anos [INFERÊNCIA]' },
    config: { dom: 'GOV', cls: 'Público', desc: 'Parâmetros da plataforma: mercado, segurança, retenção e IA.', ret: null, base: 'Não contém dados pessoais' },
    session: { dom: 'ID', cls: 'Dados pessoais', desc: 'Sessão atual: usuário, empresa e papel. Só existe uma por navegador.', ret: null, base: 'Execução de contrato [INFERÊNCIA]' },
  };
  const LINHAGEM = { orgs: ['Cadastro e KYC', 'Motor de regras'], users: ['Cadastro e KYC', 'Segurança'], integracoes: ['Configurações da empresa', 'Segurança'], titulos: ['Importação', 'Motor de regras'], operacoes: ['Leilão', 'Motor de regras'], lances: ['Leilão'], contratos: ['Cessão ICP-Brasil'], extrato: ['Conciliação'], repasses: ['Conciliação'], faturas: ['Fechamento mensal'], premiacoes: ['Fechamento mensal'], kyc: ['Cadastro e KYC'], convites: ['Indicações'], agentes: ['Mesa Cedy'], propostas: ['Agentes de IA', 'Mesa Cedy'], notifs: ['Motor de regras'], lotes: ['Mesa de Operações'], casosMesa: ['Mesa Conciliadora'], subparceiros: ['Originador'], aprovacoes: ['Superadmin'], incidentes: ['Monitoramento'], servicos: ['Monitoramento'], backups: ['Plataforma'], titulares: ['Privacidade (LGPD)'], eventosSeg: ['Segurança'], usoIA: ['Gateway de IA'], modelosIA: ['Plataforma'], ledger: ['Motor de regras'], config: ['Superadmin'] };
  const RET_LABEL = { ledgerAnos: 'Trilha de decisões', logsAdminDias: 'Registros de administração', logsAcessoMeses: 'Registros de acesso', documentosKycAnos: 'Documentos de KYC', extratoAnos: 'Extrato e liquidação', backupsDias: 'Backups', titularesAnos: 'Pedidos de titulares' };
  const RET_UN = { ledgerAnos: 'anos', logsAdminDias: 'dias', logsAcessoMeses: 'meses', documentosKycAnos: 'anos', extratoAnos: 'anos', backupsDias: 'dias', titularesAnos: 'anos' };
  const RET_MIN = { ledgerAnos: 5, logsAdminDias: 90, logsAcessoMeses: 6, documentosKycAnos: 5, extratoAnos: 5, backupsDias: 35, titularesAnos: 5 };

  function collRows(coll) {
    if (coll === 'ledger') return ledger.all();
    if (coll === 'config') return [db.cfg()];
    if (coll === 'session') { const s = session.get(); return s ? [s] : []; }
    return db.all(coll);
  }
  function typeOf(v) { if (v === null || v === undefined) return 'nulo'; if (Array.isArray(v)) return 'lista'; if (typeof v === 'number') return (v > 1e11 && v < 2e12) ? 'data' : 'número'; if (typeof v === 'boolean') return 'sim ou não'; if (typeof v === 'object') return 'registro'; return 'texto'; }
  function dictOf(coll) {
    const rows = collRows(coll).slice(0, 200); const keys = {};
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => { keys[k] = keys[k] || { total: rows.length, n: 0, ex: undefined }; keys[k].n++; if (keys[k].ex === undefined && r[k] !== null && r[k] !== undefined && r[k] !== '') keys[k].ex = r[k]; }));
    return Object.entries(keys).map(([k, v]) => ({ campo: k, tipo: typeOf(v.ex), preenchido: Math.round(v.n / v.total * 100), exemplo: maskVal(k, v.ex) }));
  }
  function sampleRow(coll) {
    const r = collRows(coll)[0]; if (!r) return null;
    const out = {}; Object.entries(r).forEach(([k, v]) => { out[k] = (typeof v === 'object' && v !== null) ? (Array.isArray(v) ? `[${v.length} itens]` : '{…}') : maskVal(k, v); });
    return out;
  }

  function pgCatalogo(ctx) {
    let q = ''; let doms = [];
    const page = h('div.stack.sdt-page',
      ui.pageHeader({ eyebrow: 'Superadmin · dados', title: 'Catálogo e retenção', subtitle: 'Todas as coleções da plataforma: o que guardam, por que guardam e por quanto tempo. Estimativas calculadas do estado real.' }));
    if (RO()) page.append(ui.callout({ tone: 'warn', title: 'Modo ver como: somente leitura', text: 'A edição da retenção está desativada no acesso auditado.' }));
    const kpis = h('div'); page.append(kpis);
    const list = h('div'); page.append(list);
    const ret = h('div'); page.append(ret);
    const sim = h('div'); page.append(sim);
    function cols() { return C.store.COLLECTIONS.concat(['ledger', 'config', 'session']).filter((c) => CAT[c]); }
    function drawKpis() {
      C.clear(kpis);
      let bytes = 0; cols().forEach((c) => { try { bytes += JSON.stringify(collRows(c)).length; } catch (e) { /* */ } });
      kpis.append(ui.grid(4,
        ui.kpi({ label: 'Coleções', value: cols().length, icon: 'book-open' }),
        ui.kpi({ label: 'Registros', value: C.sum(cols(), (c) => collRows(c).length), icon: 'database' }),
        ui.kpi({ label: 'Tamanho estimado', value: 1, display: fmt.bytes(bytes), icon: 'hard-drive', hint: 'JSON do estado' }),
        ui.kpi({ label: 'Com dados pessoais', value: cols().filter((c) => CAT[c].cls !== 'Operacional' && CAT[c].cls !== 'Público').length, icon: 'user', hint: 'Pessoal ou financeiro sensível' })));
    }
    function filtradas() {
      return cols().filter((c) => (!doms.length || doms.includes(CAT[c].dom)) && (!q || (c + ' ' + CAT[c].desc).toLowerCase().includes(q)));
    }
    function drawList() {
      C.clear(list);
      const rows = filtradas().map((c) => ({ c, n: collRows(c).length, bytes: JSON.stringify(collRows(c)).length }));
      if (!rows.length) { list.append(ui.empty({ icon: 'search', title: 'Nada encontrado', text: 'Ajuste a busca ou os domínios.' })); return; }
      list.append(ui.table({ rows, rowKey: (r) => r.c, onRowClick: (r) => abrirCol(r.c), columns: [
        { key: 'c', label: 'Coleção', mobile: 'primary', render: (r) => h('div.cell-main', h('strong.mono', r.c), h('small.muted', CAT[r.c].desc)) },
        { key: 'dom', label: 'Domínio', mobile: 'hide', render: (r) => h('span.small', DOMS[CAT[r.c].dom]) },
        { key: 'cls', label: 'Classificação', render: (r) => ui.badge(CAT[r.c].cls, { 'Dados pessoais': 'amber', 'Financeiro sensível': 'red', 'Operacional': 'teal', 'Público': 'neutral' }[CAT[r.c].cls] || 'neutral') },
        { key: 'n', label: 'Registros', align: 'right', render: (r) => h('span', fmt.num(r.n)) },
        { key: 'bytes', label: 'Tamanho', align: 'right', mobile: 'hide', render: (r) => h('span.small', fmt.bytes(r.bytes)) },
        { key: 'ret', label: 'Retenção', mobile: 'hide', render: (r) => h('span.small', CAT[r.c].ret ? RET_LABEL[CAT[r.c].ret] : 'Sem expurgo') },
      ] }));
    }
    function toolbar() {
      const chips = ui.chips({ aria: 'Filtrar por domínio', options: Object.entries(DOMS).map(([value, label]) => ({ value, label })), onChange: (v) => { doms = v; drawList(); } });
      const busca = ui.search({ placeholder: 'Buscar coleção', onInput: C.debounce((v) => { q = String(v || '').toLowerCase(); drawList(); }, 200) });
      return ui.toolbar(busca, chips);
    }
    page.insertBefore(toolbar(), kpis);
    drawKpis(); drawList(); drawRet(); drawSim();
    function abrirCol(c) {
      const meta = CAT[c]; const dict = dictOf(c); const sample = sampleRow(c); const rows = collRows(c);
      const body = h('div.stack.tight',
        h('div.row.sdt-badges', ui.badge(DOMS[meta.dom], 'blue'), ui.badge(meta.cls, 'amber'), ui.badge('Reside no Brasil', 'green')),
        h('p.small', meta.desc),
        ui.kv([['Registros', fmt.num(rows.length)], ['Tamanho estimado', fmt.bytes(JSON.stringify(rows).length)], ['Retenção', meta.ret ? `${RET_LABEL[meta.ret]} (${db.cfg().retencao[meta.ret]} ${RET_UN[meta.ret]})` : 'Sem expurgo automático'], ['Base legal', meta.base], ['Quem lê e escreve', (LINHAGEM[c] || ['Plataforma']).join(' · ')]]),
        h('h4.sdt-h', 'Dicionário de campos'),
        ui.table({ rows: dict, rowKey: (r) => r.campo, pageSize: 12, columns: [
          { key: 'campo', label: 'Campo', mobile: 'primary', render: (r) => h('span.mono', r.campo) },
          { key: 'tipo', label: 'Tipo', render: (r) => h('span.small', r.tipo) },
          { key: 'preenchido', label: 'Preenchido', align: 'right', render: (r) => h('span.small', r.preenchido + '%') },
          { key: 'exemplo', label: 'Exemplo', mobile: 'hide', render: (r) => h('span.small.mono', r.exemplo) },
        ] }),
        sample ? h('div', h('h4.sdt-h', 'Amostra (dados pessoais mascarados)'), h('pre.sdt-pre', JSON.stringify(sample, null, 1))) : ui.empty({ icon: 'inbox', title: 'Sem registros', text: 'Nenhum exemplo para mostrar.' }));
      ui.drawer({ title: 'Coleção ' + c, subtitle: meta.desc, icon: 'book-open', size: 'lg', body });
    }
    function drawRet() {
      C.clear(ret);
      const cfg = db.cfg().retencao || {};
      const inputs = {};
      const fields = Object.keys(RET_LABEL).map((k) => {
        inputs[k] = ui.numeric({ value: cfg[k], aria: RET_LABEL[k] });
        return ui.field({ label: `${RET_LABEL[k]} (${RET_UN[k]})`, hint: `Mínimo de referência ${RET_MIN[k]} ${RET_UN[k]} [INFERÊNCIA]` }, inputs[k]);
      });
      const card = ui.card({ title: 'Política de retenção', subtitle: 'Editar exige confirmação e fica na trilha como R2',
        actions: RO() ? [ui.btn('Salvar', { variant: 'primary', disabled: true, title: 'Modo ver como: somente leitura' })] : [ui.btn('Salvar política', { variant: 'primary', icon: 'check', onclick: salvar })] },
        h('div.sdt-retgrid', fields));
      ret.append(card);
      async function salvar() {
        const patch = {}; let bad = null;
        Object.keys(RET_LABEL).forEach((k) => { const v = inputs[k].value; if (v === null || !(v > 0)) bad = [k, 'Informe um valor maior que zero.']; else if (v < RET_MIN[k]) bad = [k, `Abaixo do mínimo de referência (${RET_MIN[k]} ${RET_UN[k]}). [INFERÊNCIA]`]; else patch[k] = v; });
        Object.keys(RET_LABEL).forEach((k) => { const f = inputs[k].closest('.field'); if (f && f.setError) f.setError(bad && bad[0] === k ? bad[1] : ''); });
        if (bad) { ui.toast('Verifique os valores', { type: 'error', text: bad[1] }); return; }
        const antes = Object.assign({}, db.cfg().retencao);
        const diff = Object.keys(patch).filter((k) => patch[k] !== antes[k]).map((k) => `${RET_LABEL[k]}: ${antes[k]} para ${patch[k]} ${RET_UN[k]}`).join('; ');
        if (!diff) { ui.toast('Nada mudou', { type: 'info', text: 'Os valores são iguais aos atuais.' }); return; }
        const okc = await ui.confirm({ title: 'Salvar política de retenção?', icon: 'database-backup', text: diff, confirmLabel: 'Salvar' });
        if (!okc) return;
        db.setCfg({ retencao: Object.assign({}, antes, patch) });
        ledger.append({ actor: me(), acao: 'retencao.alterada', entidade: { kind: 'config', id: 'retencao' }, resumo: 'Política de retenção atualizada: ' + diff, classe: 'R2', detalhe: { antes, depois: db.cfg().retencao } });
        ui.toast('Política salva', { type: 'success', text: diff });
        drawSim();
      }
    }
    function expurgoCounts() {
      const rc = db.cfg().retencao || {}; const t = now();
      const older = (ts, v, un) => (un === 'anos' ? t - v * 365 * DAY : un === 'meses' ? t - v * 30 * DAY : t - v * DAY) > ts;
      const out = [];
      out.push({ coll: 'ledger', pol: RET_LABEL.ledgerAnos + ' (' + rc.ledgerAnos + ' anos)', n: ledger.all().filter((e) => older(e.ts, rc.ledgerAnos, 'anos')).length });
      out.push({ coll: 'eventosSeg', pol: RET_LABEL.logsAdminDias + ' (' + rc.logsAdminDias + ' dias)', n: db.where('eventosSeg', (e) => older(e.ts, rc.logsAdminDias, 'dias')).length });
      out.push({ coll: 'extrato', pol: RET_LABEL.extratoAnos + ' (' + rc.extratoAnos + ' anos)', n: db.where('extrato', (e) => older(e.ts, rc.extratoAnos, 'anos')).length });
      out.push({ coll: 'backups', pol: RET_LABEL.backupsDias + ' (' + rc.backupsDias + ' dias)', n: db.where('backups', (b) => (b.retencaoAte || Infinity) < t).length });
      out.push({ coll: 'titulares', pol: RET_LABEL.titularesAnos + ' (' + rc.titularesAnos + ' anos)', n: db.where('titulares', (x) => older(x.abertaEm, rc.titularesAnos, 'anos')).length });
      out.push({ coll: 'kyc', pol: RET_LABEL.documentosKycAnos + ' (' + rc.documentosKycAnos + ' anos)', n: db.where('kyc', (k) => older(k.atualizadoEm || k.criadoEm || t, rc.documentosKycAnos, 'anos')).length });
      return out;
    }
    function drawSim() {
      C.clear(sim);
      sim.append(ui.card({ title: 'Simulação de expurgo', subtitle: 'Projeção seca: nada é apagado',
        actions: [ui.btn('Recalcular', { variant: 'secondary', size: 'sm', icon: 'refresh-cw', onclick: () => { drawSim(); ui.toast('Simulação atualizada', { type: 'info', text: 'Contagens recalculadas sobre o estado atual.' }); } })] },
        ui.table({ rows: expurgoCounts(), rowKey: (r) => r.coll, columns: [
          { key: 'coll', label: 'Coleção', mobile: 'primary', render: (r) => h('span.mono', r.coll) },
          { key: 'pol', label: 'Política aplicada', mobile: 'hide', render: (r) => h('span.small', r.pol) },
          { key: 'n', label: 'Registros para expurgo', align: 'right', render: (r) => h('strong', fmt.num(r.n)) },
        ] }),
        h('p.small.muted', 'A simulação conta registros mais antigos que a política. O expurgo real exige rotina própria e fica fora deste protótipo.')));
    }
    return page;
  }

  /* =========================== /super/backups ============================ */
  const BK_REQ = ['orgs', 'users', 'titulos', 'operacoes', 'lances', 'contratos', 'extrato', 'repasses', 'faturas', 'premiacoes', 'kyc', 'convites', 'ledger'];
  function lastGoodBackup() { return db.where('backups', (b) => ['ok', 'verificado'].includes(b.status)).sort((a, b) => b.ts - a.ts)[0] || null; }

  function pgBackups(ctx) {
    let tipo = 'todos'; let st = 'todos';
    const page = h('div.stack.sdt-page',
      ui.pageHeader({ eyebrow: 'Superadmin · dados', title: 'Backups e restauração', subtitle: 'Cópias diárias completas e incrementais ao longo do dia. Restaurar exige a frase RESTAURAR e fica na trilha como R3.',
        actions: RO() ? [ui.btn('Fazer backup agora', { variant: 'primary', icon: 'database-backup', disabled: true, title: 'Modo ver como: somente leitura' })] : [ui.btn('Testar restauração', { variant: 'secondary', icon: 'microscope', onclick: testar }), ui.btn('Fazer backup agora', { variant: 'primary', icon: 'database-backup', onclick: fazer })] }));
    if (RO()) page.append(ui.callout({ tone: 'warn', title: 'Modo ver como: somente leitura', text: 'Backup, teste e restauração estão desativados no acesso auditado.' }));
    const kpis = h('div'); page.append(kpis);
    const calBox = h('div'); page.append(calBox);
    const tbl = h('div'); page.append(tbl);
    const dz = h('div'); page.append(dz);
    const danger = h('div'); page.append(danger);
    function drawKpis() {
      C.clear(kpis);
      const all = db.all('backups');
      const last = lastGoodBackup();
      const rpoH = last ? (now() - last.ts) / 3600e3 : null;
      const m30 = all.filter((b) => b.ts > now() - 30 * DAY);
      const taxa = m30.length ? m30.filter((b) => ['ok', 'verificado'].includes(b.status)).length / m30.length * 100 : 100;
      const rc = db.cfg().retencao || {};
      kpis.append(ui.grid(3,
        ui.kpi({ label: 'Último backup', value: 1, display: last ? fmt.rel(last.ts) : '—', icon: 'database-backup', hint: last ? fmt.datetime(last.ts) + ' · ' + last.tipo : 'Sem cópias' }),
        ui.kpi({ label: 'RPO atual', value: rpoH === null ? 0 : rpoH, display: rpoH === null ? '—' : fmt.dur(now() - last.ts), icon: 'timer', tone: rpoH !== null && rpoH > 8 ? 'red' : 'green', hint: 'Meta: 8 h' }),
        ui.kpi({ label: 'RTO de referência', value: 12, display: '12 h', icon: 'history', hint: 'Meta da plataforma' }),
        ui.kpi({ label: 'Taxa de sucesso (30 dias)', value: taxa, fmt: 'pct', icon: 'circle-check', tone: taxa >= 95 ? 'green' : 'amber', hint: m30.length + ' execuções' }),
        ui.kpi({ label: 'Tamanho da última cópia', value: 1, display: last ? fmt.bytes(last.tamanhoMB * 1048576) : '—', icon: 'hard-drive', hint: last ? 'Em ' + fmt.dur((last.duracaoS || 0) * 1000) : 'Sem cópias' }),
        ui.kpi({ label: 'Retenção', value: rc.backupsDias || 35, display: (rc.backupsDias || 35) + ' dias', icon: 'archive', hint: 'Cópias além do prazo saem da lista' })));
    }
    function dayStatus(ts00) {
      const ini = ts00; const fim = ts00 + DAY;
      const bs = db.where('backups', (b) => b.ts >= ini && b.ts < fim);
      if (!bs.length) return { cls: 'vazio', label: 'Sem backup' };
      if (bs.some((b) => b.status === 'falhou')) return { cls: 'falha', label: 'Falha com nova tentativa' };
      if (bs.some((b) => b.tipo === 'completo')) return { cls: 'ok', label: 'Completo diário' };
      return { cls: 'incr', label: 'Só incrementais' };
    }
    function drawCal() {
      C.clear(calBox);
      const cells = [];
      const start = cal.startOfDay(now() - 34 * DAY);
      for (let i = 0; i < 35; i++) {
        const d = start + i * DAY; const s = dayStatus(d); const t = cal.sp(d);
        cells.push(h('div', { class: ['sdt-day', 'is-' + s.cls], tabindex: 0, role: 'img', 'aria-label': `${t.d}/${t.m}: ${s.label}`, title: `${fmt.date(d)}: ${s.label}` }, h('span', t.d), s.cls === 'ok' ? icon('check', 12) : s.cls === 'falha' ? icon('x', 12) : s.cls === 'incr' ? icon('plus', 12) : null));
      }
      calBox.append(ui.card({ title: 'Calendário de 35 dias', subtitle: 'Verde: completo diário. Azul: só incrementais. Vermelho: falha com nova tentativa.' }, h('div.sdt-cal', cells),
        h('div.row.sdt-legend', h('span.small', h('i.sdt-swatch.is-ok'), ' Completo'), h('span.small', h('i.sdt-swatch.is-incr'), ' Incremental'), h('span.small', h('i.sdt-swatch.is-falha'), ' Falha'), h('span.small', h('i.sdt-swatch.is-vazio'), ' Sem backup'))));
    }
    function drawTbl() {
      C.clear(tbl);
      const rows = db.all('backups').sort((a, b) => b.ts - a.ts).filter((b) => (tipo === 'todos' || b.tipo === tipo) && (st === 'todos' || (st === 'sucesso' ? ['ok', 'verificado'].includes(b.status) : b.status === 'falhou')));
      const tsel = ui.select({ value: tipo, options: [{ value: 'todos', label: 'Todos os tipos' }, { value: 'completo', label: 'Completos' }, { value: 'incremental', label: 'Incrementais' }], aria: 'Filtrar por tipo', onChange: (v) => { tipo = v; drawTbl(); } });
      const ssel = ui.select({ value: st, options: [{ value: 'todos', label: 'Todos os estados' }, { value: 'sucesso', label: 'Sucesso' }, { value: 'falhou', label: 'Falha' }], aria: 'Filtrar por estado', onChange: (v) => { st = v; drawTbl(); } });
      tbl.append(ui.toolbar(tsel, ssel));
      if (!rows.length) { tbl.append(ui.empty({ icon: 'database-backup', title: 'Sem backups neste filtro', text: 'Ajuste os filtros ou faça um backup agora.' })); return; }
      tbl.append(ui.table({ rows, rowKey: (r) => r.id, pageSize: 12, columns: [
        { key: 'id', label: 'Cópia', mobile: 'primary', render: (b) => h('div.cell-main', h('strong.mono', b.id), h('small.muted', fmt.datetime(b.ts))) },
        { key: 'tipo', label: 'Tipo', render: (b) => ui.badge(b.tipo === 'completo' ? 'Completo' : 'Incremental', b.tipo === 'completo' ? 'blue' : 'teal') },
        { key: 'status', label: 'Estado', render: (b) => ui.badge({ ok: 'Ok', verificado: 'Verificado', falhou: 'Falhou' }[b.status] || b.status, b.status === 'falhou' ? 'red' : 'green', { dot: true }) },
        { key: 'tam', label: 'Tamanho', align: 'right', mobile: 'hide', render: (b) => h('span.small', fmt.bytes((b.tamanhoMB || 0) * 1048576)) },
        { key: 'ret', label: 'Retido até', mobile: 'hide', render: (b) => h('span.small', fmt.date(b.retencaoAte)) },
        { key: 'teste', label: 'Restauração testada', mobile: 'hide', render: (b) => h('span.small', b.restoreTestadoEm ? fmt.date(b.restoreTestadoEm) : '—') },
      ] }));
    }
    function drawDz() {
      C.clear(dz);
      if (RO()) return;
      const box = ui.card({ title: 'Restaurar de arquivo', subtitle: 'Aceita um JSON exportado por Fazer backup agora. Valida, mostra o diff e só troca o estado com a frase RESTAURAR e um motivo.' },
        ui.dropzone({ title: 'Arraste o JSON do backup ou clique para selecionar', hint: 'Arquivo .json com v e coleções', accept: '.json,application/json', onFiles: receber }));
      dz.append(box);
    }
    function drawDanger() {
      C.clear(danger);
      const btnDemo = ui.btn('Abrir painel de demonstração', { variant: 'secondary', icon: 'settings', onclick: () => C.shell.openDemo() });
      const btnReset = RO() ? ui.btn('Restaurar demonstração', { variant: 'danger', disabled: true, title: 'Modo ver como: somente leitura' }) : ui.btn('Restaurar dados de demonstração', { variant: 'danger', icon: 'rotate-ccw', onclick: async () => {
        const okc = await ui.confirm({ title: 'Restaurar demonstração?', icon: 'rotate-ccw', tone: 'danger', text: 'Todo o progresso local será perdido e os dados de demonstração voltam ao estado inicial.', confirmLabel: 'Restaurar' });
        if (!okc) return;
        C.store.reset(C.seed.build); C.router.resetStack(); C.auth.logout(true);
      } });
      danger.append(ui.card({ title: 'Zona de perigo', tone: 'danger' },
        h('p.small', 'Apaga tudo o que foi feito neste navegador e volta aos dados de demonstração.'),
        h('div.row', btnDemo, btnReset)));
      danger.append(h('p.small.muted', 'Retenção: backups guardados por ' + (db.cfg().retencao.backupsDias || 35) + ' dias, conforme a política de retenção.'));
    }
    drawKpis(); drawCal(); drawTbl(); drawDz(); drawDanger();

    async function fazer() {
      if (RO()) return;
      let pct = 0;
      const bar = ui.progress(0);
      const m = ui.modal({ title: 'Criando backup', icon: 'database-backup', size: 'sm', dismissable: false, body: h('div.stack.tight', h('p.small.muted.step-label', 'Compactando coleções…'), bar) });
      const label = m.body.querySelector('.step-label');
      const fases = ['Compactando coleções…', 'Calculando hashes…', 'Gravando cópia…', 'Verificando…'];
      await new Promise((res) => {
        let i = 0;
        const step = () => { if (label && fases[i]) label.textContent = fases[i]; pct = Math.min(100, pct + 25); const fill = m.body.querySelector('.progress i'); if (fill) fill.style.width = pct + '%'; m.body.querySelector('.progress').setAttribute('aria-valuenow', pct); i++; if (i <= fases.length) setTimeout(step, 220); else res(); };
        setTimeout(step, 150);
      });
      const t = cal.sp(now());
      const id = 'bk-' + t.y + String(t.m).padStart(2, '0') + String(t.d).padStart(2, '0') + '-' + String(t.h).padStart(2, '0') + 'h-manual';
      const sizeMB = Math.round(JSON.stringify(db.state).length / 1048576 * 10) / 10;
      db.put('backups', { id, ts: now(), tipo: 'completo', tamanhoMB: sizeMB, duracaoS: 96, status: 'ok', retencaoAte: now() + (db.cfg().retencao.backupsDias || 35) * DAY, restoreTestadoEm: null, manual: true });
      ledger.append({ actor: me(), acao: 'backup.criado', entidade: { kind: 'backup', id }, resumo: `Backup manual ${id} criado (${sizeMB} MB)`, classe: 'R2' });
      m.close(true);
      drawKpis(); drawCal(); drawTbl();
      const okc = await ui.confirm({ title: 'Baixar o JSON agora?', icon: 'download', text: `A cópia ${id} está registrada. Baixe o arquivo para guardar fora do navegador.`, confirmLabel: 'Baixar JSON' });
      if (okc) download(id + '.json', JSON.stringify(db.state), 'application/json');
      else ui.toast('Backup registrado', { type: 'success', text: id });
    }
    async function testar() {
      const items = [];
      const v = db.state.v;
      items.push({ ok: v === C.store.VERSION, t: 'Versão do esquema', d: 'Arquivo na versão ' + v + ', esperada ' + C.store.VERSION });
      const integ = ledger.verify();
      items.push({ ok: integ.ok, t: 'Integridade da trilha', d: integ.ok ? integ.count + ' entradas verificadas' : 'Quebra na sequência ' + integ.brokenAt });
      const counts = C.store.COLLECTIONS.map((c) => `${c}: ${db.all(c).length}`).join(', ');
      items.push({ ok: true, t: 'Contagens por coleção', d: counts });
      let fkBad = 0;
      db.all('titulos').slice(0, 400).forEach((t) => { if (t.status === 'em_operacao' && t.operacaoId && !db.get('operacoes', t.operacaoId)) fkBad++; });
      db.all('premiacoes').forEach((p) => { if (p.subId && !db.get('subparceiros', p.subId)) fkBad++; });
      items.push({ ok: fkBad === 0, t: 'Chaves estrangeiras (amostra)', d: fkBad ? fkBad + ' referências quebradas' : 'Títulos, operações e premiações consistentes' });
      const last = lastGoodBackup();
      items.push({ ok: !!last, t: 'Tempo estimado', d: last ? 'Restauração estimada em menos de 12 h (RTO de referência) a partir de ' + last.id : 'Sem cópia válida para estimar' });
      if (last && !RO()) db.patch('backups', last.id, { restoreTestadoEm: now() });
      if (!RO()) ledger.append({ actor: me(), acao: 'backup.teste_restauracao', entidade: { kind: 'backup', id: last ? last.id : 'nenhum' }, resumo: `Teste de restauração executado: ${items.filter((i) => i.ok).length} de ${items.length} itens ok`, classe: 'R2' });
      drawTbl();
      ui.drawer({ title: 'Teste de restauração', subtitle: 'Prova seca, sem trocar nenhum dado', icon: 'microscope', size: 'md',
        body: h('div.stack.tight', ui.callout({ tone: items.every((i) => i.ok) ? 'success' : 'warn', title: items.every((i) => i.ok) ? 'Pronto para restaurar se preciso' : 'Há itens com falha', text: 'Registro do teste gravado na cópia mais recente.' }),
          h('ol.timeline', items.map((it) => h('li', { class: 'tl-item' }, h('span.tl-dot', icon(it.ok ? 'circle-check' : 'circle-alert', 12)), h('div.tl-body', h('div.tl-title', it.t), h('div.tl-text', it.d)))))) });
    }
    async function receber(files) {
      const f = (files || [])[0]; if (!f) return;
      let st;
      try { st = JSON.parse(await f.text()); } catch (e) { ui.toast('Arquivo inválido', { type: 'error', text: 'Não foi possível ler o JSON.' }); return; }
      const faltam = BK_REQ.filter((c) => !st[c]);
      if (st.v !== C.store.VERSION || faltam.length) {
        ui.drawer({ title: 'Arquivo rejeitado', icon: 'circle-alert', size: 'sm', body: h('div.stack.tight', ui.callout({ tone: 'error', title: 'Validação falhou', text: (st.v !== C.store.VERSION ? `Versão ${st.v}, esperada ${C.store.VERSION}. ` : '') + (faltam.length ? 'Coleções ausentes: ' + faltam.join(', ') + '.' : '') })) });
        return;
      }
      const diff = BK_REQ.map((c) => {
        const a = Object.keys(db.state[c] || {}).length; const b = Array.isArray(st[c]) ? st[c].length : Object.keys(st[c] || {}).length;
        return { c, a, b };
      });
      let frase = ''; let motivo = '';
      const fFrase = ui.field({ label: 'Digite RESTAURAR para confirmar', required: true }, (frase = ui.input({ placeholder: 'RESTAURAR', autocomplete: 'off' })));
      const fMot = ui.field({ label: 'Motivo', required: true, hint: 'Fica na trilha com o seu nome.' }, (motivo = ui.input({ type: 'textarea', placeholder: 'Por que restaurar este arquivo?' })));
      const m = ui.modal({ title: 'Restaurar o estado do arquivo?', icon: 'database-backup', size: 'md', alert: true,
        body: h('div.stack.tight',
          ui.callout({ tone: 'error', title: 'Ação irreversível neste navegador', text: 'O estado atual será substituído pelo arquivo. O app recarrega em /super.' }),
          ui.table({ rows: diff, rowKey: (r) => r.c, columns: [
            { key: 'c', label: 'Coleção', mobile: 'primary', render: (r) => h('span.mono', r.c) },
            { key: 'a', label: 'Atual', align: 'right', render: (r) => h('span', fmt.num(r.a)) },
            { key: 'b', label: 'Arquivo', align: 'right', render: (r) => h('span', fmt.num(r.b)) },
          ] }),
          fFrase, fMot),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Restaurar', { variant: 'danger', onclick: () => {
          if (String(frase.value).trim() !== 'RESTAURAR') { fFrase.setError('Digite exatamente RESTAURAR.'); return; }
          if (String(motivo.value).trim().length < 10) { fMot.setError('Explique o motivo (mínimo de 10 caracteres).'); return; }
          api.close(true);
        } })] });
      const go = await m.promise;
      if (!go) return;
      C.store._set(st);
      ledger.append({ actor: me(), acao: 'backup.restaurado', entidade: { kind: 'backup', id: f.name }, resumo: `Estado restaurado do arquivo ${f.name}. Motivo: ${String(motivo.value).trim()}`, classe: 'R3' });
      C.store.save();
      location.hash = '#/super';
      setTimeout(() => location.reload(), 150);
    }
    return page;
  }

  /* ============================= /super/lgpd ============================= */
  const LG_TIPOS = { acesso: 'Acesso', correcao: 'Correção', exclusao: 'Exclusão', portabilidade: 'Portabilidade', revogacao: 'Revogação', oposicao: 'Oposição' };
  const LG_GUARDA = 'Obrigação legal de guarda por 5 anos (LC 105 e regulação de crédito)';

  function mapaDoTitular(t) {
    const nome = (t.titularNome || '').toLowerCase();
    const primeiro = nome.split(/\s+/)[0] || '';
    const user = db.where('users', (u) => (u.nome || '').toLowerCase() === nome || ((u.nome || '').toLowerCase().split(/\s+/)[0] === primeiro && u.orgId === t.orgId))[0]
      || db.where('users', (u) => u.orgId === t.orgId && u.nome && nome.includes(u.nome.toLowerCase().split(/\s+/)[0]) && u.nome.toLowerCase().split(/\s+/)[0].length > 2)[0] || null;
    const uid = user ? user.id : null;
    const kyc = db.where('kyc', (k) => (db.get('orgs', k.orgId) || {}).id === t.orgId);
    const convs = db.where('convites', (c) => (c.nome || '').toLowerCase() === nome || (uid && c.email === (user || {}).email));
    const subs = db.where('subparceiros', (s) => (s.nome || '').toLowerCase() === nome || (s.email && user && s.email === user.email));
    const led = uid ? ledger.forEntity('usuario', uid).concat(ledger.all().filter((e) => (e.actor || {}).id === uid)).slice(0, 50) : [];
    const nts = db.where('notifs', (n) => (n.to && (n.to.userId === uid || (t.orgId && n.to.orgId === t.orgId))));
    const evs = db.where('eventosSeg', (e) => e.userId === uid || (t.orgId && e.orgId === t.orgId));
    return { user, fontes: [
      { nome: 'Usuários', n: user ? 1 : 0, linhas: user ? [{ id: user.id, label: user.nome, detail: maskEmail(user.email) + ' · ' + maskFone(user.telefone) }] : [] },
      { nome: 'KYC e documentos', n: kyc.length, linhas: kyc.map((k) => ({ id: k.id, label: 'Dossiê ' + orgName(k.orgId), detail: k.status })) },
      { nome: 'Convites', n: convs.length, linhas: convs.map((c) => ({ id: c.id, label: c.nome, detail: maskEmail(c.email) })) },
      { nome: 'Subparceiros', n: subs.length, linhas: subs.map((s) => ({ id: s.id, label: s.nome, detail: maskDoc(s.doc) })) },
      { nome: 'Trilha de decisões', n: led.length, linhas: led.slice(0, 5).map((e) => ({ id: e.id, label: e.acao, detail: fmt.date(e.ts) })) },
      { nome: 'Notificações', n: nts.length, linhas: nts.slice(0, 5).map((x) => ({ id: x.id, label: x.titulo || x.id, detail: fmt.date(x.ts) })) },
      { nome: 'Eventos de segurança', n: evs.length, linhas: evs.slice(0, 5).map((e) => ({ id: e.id, label: e.tipo, detail: fmt.date(e.ts) })) },
    ] };
  }

  function pgLgpd(ctx) {
    let tab = ['abertas', 'analise', 'concluidas'].includes(ctx.query.tab) ? ctx.query.tab : 'abertas';
    const page = h('div.stack.sdt-page',
      ui.pageHeader({ eyebrow: 'Superadmin · dados', title: 'Privacidade (LGPD)', subtitle: 'Pedidos de titulares com prazo de 15 dias. Nada aqui toca dados de terceiros: cada ação mira só o titular do pedido.',
        actions: RO() ? [ui.btn('Nova solicitação', { variant: 'primary', icon: 'plus', disabled: true, title: 'Modo ver como: somente leitura' })] : [ui.btn('Nova solicitação', { variant: 'primary', icon: 'plus', onclick: nova })] }));
    if (RO()) page.append(ui.callout({ tone: 'warn', title: 'Modo ver como: somente leitura', text: 'Respostas, correções e anonimização estão desativadas no acesso auditado.' }));
    const kpis = h('div'); page.append(kpis);
    const tabsBox = h('div'); page.append(tabsBox);
    const list = h('div'); page.append(list);
    const inv = h('div'); page.append(inv);
    function todas() { return db.all('titulares'); }
    function abertas() { return todas().filter((t) => t.status === 'recebida'); }
    function analise() { return todas().filter((t) => t.status === 'em_analise'); }
    function concluidas() { return todas().filter((t) => ['atendida', 'negada'].includes(t.status)); }
    function drawKpis() {
      C.clear(kpis);
      const ab = abertas().concat(analise());
      const venc3 = ab.filter((t) => t.prazoAte > now() && t.prazoAte - now() < 3 * DAY).length;
      const conc = concluidas().filter((t) => t.atendidaEm);
      const media = conc.length ? C.sum(conc, (t) => t.atendidaEm - t.abertaEm) / conc.length : null;
      const prazo = conc.length ? conc.filter((t) => t.atendidaEm <= t.prazoAte).length / conc.length * 100 : null;
      kpis.append(ui.grid(4,
        ui.kpi({ label: 'Pedidos abertos', value: ab.length, icon: 'file-lock', tone: ab.length ? 'amber' : 'green' }),
        ui.kpi({ label: 'Vencendo em 3 dias', value: venc3, icon: 'hourglass', tone: venc3 ? 'red' : 'green' }),
        ui.kpi({ label: 'Tempo médio de atendimento', value: 1, display: media === null ? '—' : fmt.dur(media), icon: 'timer', hint: conc.length ? 'Sobre ' + conc.length + ' concluídos' : 'Sem conclusões registradas' }),
        ui.kpi({ label: 'Atendidos no prazo', value: prazo === null ? 0 : prazo, fmt: 'pct', icon: 'circle-check', display: prazo === null ? '—' : undefined, hint: 'Meta: 100%' })));
    }
    function drawTabs() {
      C.clear(tabsBox);
      const tabs = ui.tabs({ value: tab, items: [
        { id: 'abertas', label: 'Abertas', icon: 'inbox', count: abertas().length },
        { id: 'analise', label: 'Em análise', icon: 'search', count: analise().length },
        { id: 'concluidas', label: 'Concluídas', icon: 'archive', count: concluidas().length },
      ], onChange: (v) => { tab = v; drawList(); } });
      tabsBox.append(tabs);
    }
    function drawList() {
      C.clear(list);
      const rows = (tab === 'abertas' ? abertas() : tab === 'analise' ? analise() : concluidas()).sort((a, b) => a.prazoAte - b.prazoAte);
      if (!rows.length) { list.append(ui.empty({ icon: 'file-lock', title: 'Sem pedidos aqui', text: tab === 'concluidas' ? 'Nenhum pedido concluído ainda.' : 'Nenhum pedido aguardando nesta etapa.' })); return; }
      list.append(ui.table({ rows, rowKey: (r) => r.id, onRowClick: (r) => abrirPedido(r.id, () => { drawKpis(); drawTabs(); drawList(); }), columns: [
        { key: 'id', label: 'Pedido', mobile: 'primary', render: (t) => h('div.cell-main', h('strong.mono', t.id), h('small.muted', t.titularNome)) },
        { key: 'tipo', label: 'Tipo', render: (t) => ui.badge(LG_TIPOS[t.tipo] || t.tipo, 'blue') },
        { key: 'prazo', label: 'Prazo', render: (t) => h('span.sdt-prazo', ui.countdown(t.prazoAte, { prefix: 'vence', endLabel: 'vencido' }), t.prazoAte < now() && !['atendida', 'negada'].includes(t.status) ? ui.badge('Vencido', 'red', { dot: true }) : null) },
        { key: 'st', label: 'Estado', render: (t) => ui.badge({ recebida: 'Recebida', em_analise: 'Em análise', atendida: 'Atendida', negada: 'Negada' }[t.status], { recebida: 'amber', em_analise: 'blue', atendida: 'green', negada: 'neutral' }[t.status], { dot: true }) },
      ] }));
    }
    function drawInv() {
      C.clear(inv);
      const nb = db.all('modelosIA').filter((m) => !m.residenciaBR);
      inv.append(ui.card({ title: 'Inventário de tratamento', subtitle: 'Finalidades, bases legais e compartilhamentos. Residência R19: dados no Brasil.' },
        ui.table({ rows: [
          { f: 'Cadastro e KYC', cat: 'Identificação e documentos', base: 'Obrigação legal', ret: '5 anos', comp: 'Receita Federal, SCR e birô de restritivos' },
          { f: 'Operação de crédito', cat: 'Recebíveis e cessão', base: 'Execução de contrato', ret: '5 anos', comp: 'Banco parceiro (conta de liquidação) e registradora' },
          { f: 'Cobrança e conciliação', cat: 'Pagamentos', base: 'Execução de contrato', ret: '5 anos', comp: 'Banco parceiro' },
          { f: 'Agentes de IA', cat: 'Documentos do dossiê', base: 'Legítimo interesse', ret: '90 dias', comp: 'Provedor A (nuvem BR, residência nacional)' },
          { f: 'Avaliação de modelos', cat: 'Amostras anonimizadas', base: 'Legítimo interesse', ret: '90 dias', comp: nb.map((m) => m.nome + ' (' + m.regiao + ', análise de transferência pendente)').join('; ') || 'Nenhum modelo fora do Brasil' },
          { f: 'Atendimento de titulares', cat: 'Pedidos LGPD', base: 'Obrigação legal', ret: '5 anos', comp: 'Sem compartilhamento' },
        ], rowKey: (r) => r.f, columns: [
          { key: 'f', label: 'Finalidade', mobile: 'primary', render: (r) => h('strong', r.f) },
          { key: 'cat', label: 'Categoria', mobile: 'hide', render: (r) => h('span.small', r.cat) },
          { key: 'base', label: 'Base legal', render: (r) => h('span.small', r.base) },
          { key: 'ret', label: 'Retenção', render: (r) => h('span.small', r.ret) },
          { key: 'comp', label: 'Compartilhamento', mobile: 'hide', render: (r) => h('span.small', r.comp) },
        ] })));
      inv.append(ui.card({ title: 'Encarregado (DPO)', subtitle: 'Canal do titular' },
        ui.kv([['Nome', 'Larissa Nogueira'], ['Cargo', 'Head de risco e dados'], ['E-mail', 'dpo@cedy.com.br [INFERÊNCIA]'], ['Prazo de resposta', '15 dias corridos']]),
        h('p.small.muted', 'Pedidos chegam pela central e entram na fila acima como recebidos.')));
    }
    drawKpis(); drawTabs(); drawList(); drawInv();

    async function nova() {
      if (RO()) return;
      const users = db.all('users').filter((u) => !u.inativo).sort((a, b) => a.nome.localeCompare(b.nome));
      const selTipo = ui.select({ value: 'acesso', options: Object.entries(LG_TIPOS).map(([value, label]) => ({ value, label })) });
      const sel = ui.select({ value: users[0] ? users[0].id : '', searchable: true, options: users.map((u) => ({ value: u.id, label: u.nome, hint: u.email + ' · ' + orgName(u.orgId) })) });
      const fAlvo = ui.field({ label: 'Titular', required: true, hint: 'Escolha um usuário existente ou crie um usuário de teste abaixo.' }, sel);
      let criarTeste = false;
      let nn = ''; let ne = '';
      const iN = ui.input({ placeholder: 'Nome do usuário de teste', onInput: (v) => (nn = v) });
      const iE = ui.input({ placeholder: 'teste@exemplo.com.br', onInput: (v) => (ne = v) });
      const fNome = ui.field({ label: 'Nome do teste' }, iN); const fEmail = ui.field({ label: 'E-mail do teste' }, iE);
      const fTeste = ui.checkbox({ label: 'Criar usuário de teste', hint: 'Cria uma conta não essencial para exercitar o fluxo de ponta a ponta.', onChange: (v) => { criarTeste = v; } });
      const m = ui.modal({ title: 'Nova solicitação', subtitle: 'Entra na fila como recebida, com prazo de 15 dias.', icon: 'plus', size: 'sm',
        body: h('div.stack.tight', ui.field({ label: 'Tipo de pedido', required: true }, selTipo), fAlvo, fTeste, fNome, fEmail),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(null) }), ui.btn('Abrir pedido', { variant: 'primary', onclick: () => {
          const tid = String(sel.value || '');
          if (!criarTeste && !db.get('users', tid)) { fAlvo.setError('Escolha o titular.'); return; }
          let u = db.get('users', tid);
          if (criarTeste) {
            if (!nn.trim() || !/.+@.+\..+/.test(ne)) { ui.toast('Dados do teste', { type: 'error', text: 'Informe nome e e-mail válido para o usuário de teste.' }); return; }
            u = db.put('users', { id: C.uid('u'), nome: nn.trim(), email: ne.trim(), cargo: 'Usuário de teste', orgId: 'c-brisa', perfil: 'leitor', demo: false, twofa: false, hue: 200, ultimoAcesso: now(), telefone: '(11) 90000-0000', teste: true });
          }
          const ids = db.all('titulares').map((t) => Number(String(t.id).split('-')[1]) || 0);
          const nid = 'LGPD-' + String(Math.max(0, ...ids) + 1).padStart(3, '0');
          const ped = db.put('titulares', { id: nid, titularNome: u.nome, titularTipo: 'usuario', orgId: u.orgId, tipo: selTipo.value, status: 'recebida', abertaEm: now(), prazoAte: now() + 15 * DAY, responsavelId: session.get().userId, baseLegal: null, resposta: null });
          ledger.append({ actor: me(), acao: 'lgpd.recebido', entidade: { kind: 'titular', id: nid }, resumo: `Pedido ${nid} (${LG_TIPOS[ped.tipo]}) de ${u.nome} recebido`, classe: 'R2' });
          notify.send({ to: { role: 'ops' }, tipo: 'info', titulo: `Novo pedido LGPD: ${nid}`, corpo: `${LG_TIPOS[ped.tipo]} de ${u.nome}. Prazo de 15 dias.`, link: '/super/lgpd' });
          ui.toast('Pedido aberto', { type: 'success', text: nid + ' entra na fila como recebido.' });
          api.close(true);
        } })] });
      await m.promise;
      drawKpis(); drawTabs(); drawList();
    }

    function abrirPedido(id, redraw) {
      const t = db.get('titulares', id); if (!t) return;
      const mapa = mapaDoTitular(t);
      const total = C.sum(mapa.fontes, (f) => f.n);
      const conc = ['atendida', 'negada'].includes(t.status);
      const body = h('div.stack.tight');
      const foot = h('div.sdt-foot');
      function paint() {
        const tt = db.get('titulares', id);
        C.clear(body); C.clear(foot);
        body.append(
          h('div.row.sdt-badges', ui.badge(LG_TIPOS[tt.tipo], 'blue'), ui.badge({ recebida: 'Recebida', em_analise: 'Em análise', atendida: 'Atendida', negada: 'Negada' }[tt.status], 'neutral', { dot: true }), h('span.small', 'Responsável: ' + userName(tt.responsavelId))),
          ui.kv([['Titular', tt.titularNome], ['Organização', orgName(tt.orgId)], ['Aberto em', fmt.datetime(tt.abertaEm)], ['Prazo', fmt.datetime(tt.prazoAte)], ['Base legal', tt.baseLegal || '—'], ['Resposta', tt.resposta || '—']]),
          ui.countdown(tt.prazoAte, { prefix: 'vence', endLabel: 'vencido' }),
          h('h4.sdt-h', 'Mapa de dados do titular (' + total + ' referências)'),
          h('p.small.muted', 'Busca em usuários, KYC, convites, subparceiros, trilha, notificações e segurança. Valores pessoais mascarados.'),
          ui.table({ rows: mapa.fontes.filter((f) => f.n), rowKey: (r) => r.nome, columns: [
            { key: 'nome', label: 'Fonte', mobile: 'primary', render: (f) => h('strong', f.nome) },
            { key: 'n', label: 'Referências', align: 'right', render: (f) => h('span', fmt.num(f.n)) },
            { key: 'ex', label: 'Exemplo', mobile: 'hide', render: (f) => h('span.small.muted', f.linhas[0] ? f.linhas[0].label + ' · ' + f.linhas[0].detail : '—') },
          ] }),
          tt.tipo === 'exclusao' ? ui.callout({ tone: 'warn', title: 'O que é retido e o que sai', text: `Retidos por obrigação legal (${LG_GUARDA}): trilha de decisões, documentos de KYC e extrato. Sai por anonimização: nome, e-mail, telefone e acesso do usuário.` }) : null,
          tt.tipo === 'acesso' || tt.tipo === 'portabilidade' ? ui.callout({ tone: 'info', title: 'Entrega', text: 'O relatório sai em JSON e CSV com os dados do mapa acima, mascarados onde houver terceiros.' }) : null,
          conc ? ui.callout({ tone: tt.status === 'atendida' ? 'success' : 'neutral', title: tt.status === 'atendida' ? 'Pedido concluído' : 'Pedido negado', text: (tt.resposta || '') + (tt.baseLegal ? ' Base legal: ' + tt.baseLegal + '.' : '') + (tt.atendidaEm ? ' Em ' + fmt.datetime(tt.atendidaEm) + '.' : '') }) : null);
        if (!conc && !RO()) {
          let resp = tt.resposta || '';
          const fResp = ui.field({ label: 'Resposta ao titular', required: true, hint: 'Texto que será entregue ao titular.' }, ui.input({ type: 'textarea', value: resp, onInput: (v) => (resp = v) }));
          body.append(fResp);
          const acts = [];
          if (tt.tipo === 'acesso' || tt.tipo === 'portabilidade') acts.push(ui.btn('Gerar relatório', { variant: 'secondary', icon: 'download', onclick: () => gerarRelatorio(tt, mapa) }));
          if (tt.tipo === 'correcao') acts.push(ui.btn('Editar dados da pessoa', { variant: 'secondary', icon: 'pencil', onclick: () => editarPessoa(tt, mapa, () => { paint(); redraw(); }) }));
          if (tt.tipo === 'exclusao') acts.push(ui.btn('Anonimizar', { variant: 'danger', icon: 'user', onclick: () => anonimizar(tt, mapa, () => { paint(); redraw(); }) }));
          if (tt.tipo === 'revogacao' || tt.tipo === 'oposicao') acts.push(ui.btn('Registrar e aplicar', { variant: 'secondary', icon: 'check', onclick: () => aplicarRevogacao(tt, resp, fResp, () => { paint(); redraw(); }) }));
          if (tt.status === 'recebida') acts.push(ui.btn('Iniciar análise', { variant: 'secondary', icon: 'search', onclick: () => { db.patch('titulares', id, { status: 'em_analise' }); ledger.append({ actor: me(), acao: 'lgpd.em_analise', entidade: { kind: 'titular', id }, resumo: `Pedido ${id} em análise`, classe: 'R1' }); paint(); redraw(); } }));
          acts.push(ui.btn('Marcar como atendida', { variant: 'primary', icon: 'check', onclick: () => concluir(tt, resp, fResp, () => { paint(); redraw(); }) }));
          acts.push(ui.btn('Negar', { variant: 'ghost', icon: 'x', onclick: () => negar(tt, resp, fResp, () => { paint(); redraw(); }) }));
          acts.forEach((b) => foot.append(b));
        }
        if (!conc && RO()) body.append(ui.callout({ tone: 'warn', title: 'Somente leitura', text: 'O modo ver como impede responder ou alterar este pedido.' }));
      }
      paint();
      ui.drawer({ title: 'Pedido ' + t.id, subtitle: t.titularNome + ' · ' + LG_TIPOS[t.tipo], icon: 'file-lock', size: 'lg', body, footer: foot });
    }
    function gerarRelatorio(tt, mapa) {
      const rows = [];
      mapa.fontes.forEach((f) => f.linhas.forEach((l) => rows.push({ fonte: f.nome, registro: l.id, descricao: l.label, detalhe: l.detail })));
      download(tt.id + '-mapa.json', JSON.stringify({ pedido: tt.id, titular: maskNome(tt.titularNome), tipo: tt.tipo, geradoEm: fmt.datetime(now()), referencias: rows }, null, 1), 'application/json');
      downloadCsv(tt.id + '-mapa.csv', [['fonte', 'registro', 'descricao', 'detalhe']].concat(rows.map((r) => [r.fonte, r.registro, r.descricao, r.detalhe])));
      ledger.append({ actor: me(), acao: 'lgpd.relatorio_gerado', entidade: { kind: 'titular', id: tt.id }, resumo: `Relatório de ${LG_TIPOS[tt.tipo].toLowerCase()} gerado para ${tt.titularNome} (JSON e CSV)`, classe: 'R2' });
      ui.toast('Relatório gerado', { type: 'success', text: 'JSON e CSV baixados com o mapa do titular.' });
    }
    async function editarPessoa(tt, mapa, done) {
      const u = mapa.user;
      if (!u) { ui.toast('Sem usuário vinculado', { type: 'warn', text: 'O titular não tem conta para corrigir.' }); return; }
      let nn = u.nome; let ne = u.email; let nt = u.telefone || '';
      const fN = ui.field({ label: 'Nome', required: true }, ui.input({ value: nn, onInput: (v) => (nn = v) }));
      const fE = ui.field({ label: 'E-mail', required: true }, ui.input({ value: ne, onInput: (v) => (ne = v) }));
      const fT = ui.field({ label: 'Telefone', required: true }, ui.input({ value: nt, mask: 'phone', onInput: (v) => (nt = v) }));
      const m = ui.modal({ title: 'Corrigir dados', subtitle: u.nome, icon: 'pencil', size: 'sm', body: h('div.stack.tight', fN, fE, fT),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Salvar correção', { variant: 'primary', onclick: () => {
          if (!nn.trim()) { fN.setError('Informe o nome.'); return; }
          if (!/.+@.+\..+/.test(ne)) { fE.setError('E-mail inválido.'); return; }
          db.patch('users', u.id, { nome: nn.trim(), email: ne.trim(), telefone: nt });
          db.patch('titulares', tt.id, { titularNome: nn.trim(), status: 'em_analise' });
          ledger.append({ actor: me(), acao: 'lgpd.dados_corrigidos', entidade: { kind: 'titular', id: tt.id }, resumo: `Dados de ${nn.trim()} corrigidos a pedido do titular`, classe: 'R2' });
          ui.toast('Dados corrigidos', { type: 'success', text: 'Alteração registrada na trilha.' });
          api.close(true);
        } })] });
      await m.promise; done();
    }
    async function anonimizar(tt, mapa, done) {
      const u = mapa.user;
      if (!u) { ui.toast('Sem usuário vinculado', { type: 'warn', text: 'O titular não tem conta para anonimizar.' }); return; }
      let frase = '';
      const fF = ui.field({ label: 'Digite ANONIMIZAR para confirmar', required: true, hint: 'Nome, e-mail e telefone são substituídos; o acesso é desativado. Trilha, KYC e extrato seguem guardados (' + LG_GUARDA + ').' }, (frase = ui.input({ placeholder: 'ANONIMIZAR', autocomplete: 'off' })));
      const m = ui.modal({ title: 'Anonimizar ' + u.nome + '?', icon: 'user', size: 'sm', alert: true, body: h('div.stack.tight', ui.callout({ tone: 'error', title: 'Irreversível neste protótipo', text: 'A conta perde o acesso e os dados somem das telas. A base legal da guarda segue na trilha.' }), fF),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Anonimizar', { variant: 'danger', onclick: () => {
          if (String(frase.value).trim() !== 'ANONIMIZAR') { fF.setError('Digite exatamente ANONIMIZAR.'); return; }
          db.patch('users', u.id, { nome: 'Titular anonimizado (' + tt.id + ')', email: 'anon-' + tt.id.toLowerCase() + '@anonimo.local', telefone: '', twofa: false, inativo: true });
          db.patch('titulares', tt.id, { status: 'em_analise' });
          ledger.append({ actor: me(), acao: 'lgpd.anonimizado', entidade: { kind: 'titular', id: tt.id }, resumo: `Titular ${tt.id} anonimizado; acesso desativado. Guarda mantida (${LG_GUARDA})`, classe: 'R2', detalhe: { baseLegal: LG_GUARDA } });
          notify.send({ to: { orgId: tt.orgId }, tipo: 'info', titulo: 'Pedido de exclusão em andamento', corpo: `${tt.id}: dados anonimizados, guarda legal mantida.`, link: '/super/lgpd' });
          ui.toast('Titular anonimizado', { type: 'success', text: 'Acesso desativado e dados substituídos.' });
          api.close(true);
        } })] });
      await m.promise; done();
    }
    async function aplicarRevogacao(tt, resp, fResp, done) {
      if (String(resp).trim().length < 10) { fResp.setError('Escreva a resposta ao titular (mínimo de 10 caracteres).'); return; }
      db.patch('titulares', tt.id, { resposta: String(resp).trim(), status: 'em_analise', revogadoEm: now() });
      ledger.append({ actor: me(), acao: 'lgpd.revogacao_registrada', entidade: { kind: 'titular', id: tt.id }, resumo: `Revogação ou oposição de ${tt.titularNome} registrada e aplicada`, classe: 'R2', detalhe: { resposta: String(resp).trim() } });
      ui.toast('Registro aplicado', { type: 'success', text: 'A revogação fica valendo daqui em diante.' });
      done();
    }
    async function concluir(tt, resp, fResp, done) {
      if (String(resp).trim().length < 10) { fResp.setError('Escreva a resposta ao titular (mínimo de 10 caracteres).'); return; }
      db.patch('titulares', tt.id, { resposta: String(resp).trim(), status: 'atendida', atendidaEm: now() });
      ledger.append({ actor: me(), acao: 'lgpd.atendido', entidade: { kind: 'titular', id: tt.id }, resumo: `Pedido ${tt.id} atendido: ${String(resp).trim().slice(0, 120)}`, classe: 'R2' });
      ui.toast('Pedido atendido', { type: 'success', text: tt.id + ' concluído dentro do fluxo.' });
      done();
    }
    async function negar(tt, resp, fResp, done) {
      if (String(resp).trim().length < 10) { fResp.setError('Escreva a justificativa (mínimo de 10 caracteres).'); return; }
      let base = LG_GUARDA;
      const fB = ui.field({ label: 'Base legal da negativa', required: true }, (base = ui.select({ value: base, options: [{ value: LG_GUARDA, label: 'Guarda legal (LC 105)' }, { value: 'Execução de contrato', label: 'Execução de contrato' }, { value: 'Exercício de direitos em processo', label: 'Exercício de direitos em processo' }] })));
      void fB;
      const m = ui.modal({ title: 'Negar pedido ' + tt.id + '?', icon: 'x', size: 'sm', body: h('div.stack.tight', ui.callout({ tone: 'warn', title: 'Negativa fundamentada', text: 'A negativa exige base legal e vai para a trilha com o seu nome.' }), ui.field({ label: 'Base legal' }, base)),
        footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Negar pedido', { variant: 'danger', onclick: () => { api.close(true); } })] });
      const okc = await m.promise;
      if (!okc) return;
      db.patch('titulares', tt.id, { resposta: String(resp).trim(), status: 'negada', baseLegal: base.value, atendidaEm: now() });
      ledger.append({ actor: me(), acao: 'lgpd.negado', entidade: { kind: 'titular', id: tt.id }, resumo: `Pedido ${tt.id} negado com base em ${base.value}`, classe: 'R2', detalhe: { baseLegal: base.value } });
      ui.toast('Pedido negado', { type: 'info', text: tt.id + ' negado com base legal.' });
      done();
    }
    return page;
  }

  /* ------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/super/dados', roles: ['ops'], perfis: ['superadmin'], title: 'Qualidade dos dados', render: pgDados },
    { path: '/super/catalogo', roles: ['ops'], perfis: ['superadmin'], title: 'Catálogo e retenção', render: pgCatalogo },
    { path: '/super/backups', roles: ['ops'], perfis: ['superadmin'], title: 'Backups e restauração', render: pgBackups },
    { path: '/super/lgpd', roles: ['ops'], perfis: ['superadmin'], title: 'Privacidade (LGPD)', render: pgLgpd },
  ]);
})();
