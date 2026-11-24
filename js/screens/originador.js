/* =========================================================================
   Cedy protótipo 0.1, Originador (Lumen Consultoria, Carlos Bastos).
   Carteira de indicados, convites com first-registration wins, premiação
   (10% por 24 meses + 30% de gestão) com contestação em 10 dias, e
   relatórios mensais a partir do 5º dia útil.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui;
  const { db, ledger, notify, session } = C.store; const E = C.engine;
  const cal = C.cal;
  const ORG = 'o-lumen';
  const isSub = () => { const u = session.user(); return !!(u && u.perfil === 'subparceiro'); };
  const mySubId = () => { const u = session.user(); return u ? u.subId : null; };
  const subNameOf = (sid) => { const s = sid && db.get('subparceiros', sid); return s ? s.nome : 'Direto Lumen'; };
  const repasseOf = (p) => {
    if (!p.parteSub || p.parteSub <= 0) return 'nao_aplica';
    if (p.repasseSub && p.repasseSub.status === 'repassado') return 'repassado';
    return 'pendente';
  };
  const subList = () => db.where('subparceiros', (s) => s.origId === ORG).sort((a, b) => (b.ultimaAtividade || 0) - (a.ultimaAtividade || 0));
  const subAtivoDe = (sid) => { const s = sid && db.get('subparceiros', sid); return s && s.status === 'ativo' ? s : null; };
  /** parte do sub na estimativa do mês (split atual; o congelado vale só após a apuração) */
  function estSplitOf(org, indic, gest) {
    const s = org && org.subparceiroId && subAtivoDe(org.subparceiroId);
    if (!s) return 0;
    return C.round2((indic + gest) * (s.splitPct || 0) / 100);
  }
  /** estimativa do mês corrente (ainda sem apuração) para um conjunto de indicados: total e parte dos subs */
  function estMes(orgs) {
    const comp = compOf(now()); let tot = 0, sub = 0;
    orgs.forEach((o) => { const e = premEstimate(o.id, comp); tot += e.indic + e.gest; sub += estSplitOf(o, e.indic, e.gest); });
    return { tot: C.round2(tot), sub: C.round2(sub) };
  }
  C.premiacaoEstMes = estMes;
  const liquidoOf = (p) => C.round2((p.parteOrig !== undefined && p.parteOrig !== null ? p.parteOrig : p.total));
  function falarComOriginador() {
    notify.send({ to: { orgId: ORG }, tipo: 'info', titulo: 'Subparceiro quer falar com você', corpo: `${session.user().nome} pediu contato sobre a comissão.`, link: '/originador/subparceiros' });
    ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.contato', entidade: { kind: 'org', id: ORG }, resumo: `${session.user().nome} pediu contato com o originador`, classe: 'R1' });
    ui.toast('Mensagem enviada', { type: 'success', text: 'A Lumen Consultoria recebe seu pedido de contato.' });
  }
  const now = () => C.clock.now();
  const DAY = 86400000;

  /* ----------------------------- helpers -------------------------------- */
  const compOf = (ts) => { const t = cal.sp(ts); return t.y + '-' + String(t.m).padStart(2, '0'); };
  const onlyDigits = (v) => String(v || '').replace(/\D/g, '');
  const daysAgo = (ts) => Math.max(0, Math.floor((now() - ts) / DAY));
  /** rótulo curto para eixos de valores em reais (a unidade vai no subtítulo do gráfico) */
  const axisBrl = (v) => (v === 0 ? '0' : v >= 1e6 ? (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi' : v >= 1e3 ? (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mil' : String(v));
  const me = () => db.get('orgs', ORG);
  const myConvites = () => db.where('convites', (c) => c.origId === ORG);
  const convitesVisiveis = () => (isSub() ? myConvites().filter((c) => c.subId === mySubId()) : myConvites());
  const indicatedOrgs = () => db.where('orgs', (o) => o.indicadoPor === ORG);
  function cnpjValido(v) {
    const d = onlyDigits(v); if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const dv = (base) => { let s = 0, w = 2; for (let i = base.length - 1; i >= 0; i--) { s += Number(base[i]) * w; w = w === 9 ? 2 : w + 1; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
  }
  function paidOps(cedId) { return db.where('operacoes', (o) => o.cedenteId === cedId && o.pagoEm).sort((a, b) => a.pagoEm - b.pagoEm); }
  function firstPaidOp(cedId) { return paidOps(cedId)[0] || null; }
  function lastPaidTs(cedId) { const p = paidOps(cedId); return p.length ? p[p.length - 1].pagoEm : null; }
  function vol30(cedId) { const c = now() - 30 * DAY; return C.round2(C.sum(paidOps(cedId).filter((o) => o.pagoEm >= c), (o) => o.face)); }
  function myPremiacoes() { return db.where('premiacoes', (p) => p.origId === ORG).sort((a, b) => a.competencia < b.competencia ? 1 : -1); }
  /** entradas unificadas: org indicada (+ convite, se houver) e convites sem org */
  function indicadoEntries() {
    const out = []; const seen = new Set();
    indicatedOrgs().forEach((org) => { out.push({ key: org.id, org, conv: myConvites().find((c) => c.orgId === org.id) || null }); seen.add(org.id); });
    myConvites().filter((c) => !c.orgId || !seen.has(c.orgId)).forEach((cv) => out.push({ key: cv.id, org: cv.orgId ? db.get('orgs', cv.orgId) : null, conv: cv }));
    return out;
  }
  function lastActivity(e) {
    const cands = [];
    if (e.conv && e.conv.ultimaAtividade) cands.push(e.conv.ultimaAtividade);
    if (e.conv && e.conv.enviadoEm) cands.push(e.conv.enviadoEm);
    const lp = e.org ? lastPaidTs(e.org.id) : null; if (lp) cands.push(lp);
    return cands.length ? Math.max(...cands) : null;
  }
  /** status no vocabulário de ui.status('convite', ...) */
  function indStatus(e) {
    if (e.conv && ['convidado', 'cadastrado', 'recusado'].includes(e.conv.status)) return e.conv.status;
    if (e.org && e.org.status !== 'ativo') return 'kyc';
    const la = lastActivity(e);
    if (e.org && la && (now() - la) >= db.cfg().inatividadeDias * DAY) return 'inativo';
    if (e.conv && e.conv.status === 'inativo') return 'inativo';
    if (e.org) return 'ativo';
    return (e.conv && e.conv.status) || 'convidado';
  }
  function indName(e) { return e.org ? (e.org.fantasia || e.org.nome) : e.conv.nome; }
  function janelaMeses(e) {
    if (!e.org) return null;
    const fp = firstPaidOp(e.org.id); if (!fp) return null;
    const elapsed = Math.floor((now() - fp.pagoEm) / (30 * DAY));
    return Math.max(0, db.cfg().premiacaoJanelaMeses - elapsed);
  }
  function premEstimate(cedId, comp) {
    const ops = paidOps(cedId).filter((o) => compOf(o.pagoEm) === comp);
    const base = C.round2(C.sum(ops, (o) => o.ts || 0));
    const fp = firstPaidOp(cedId);
    const dentro = fp && (now() - fp.pagoEm) < db.cfg().premiacaoJanelaMeses * 30 * DAY;
    const lp = lastPaidTs(cedId);
    const ativo = lp && (now() - lp) < db.cfg().inatividadeDias * DAY;
    return { base, nOps: ops.length, indic: dentro ? C.round2(base * db.cfg().premiacaoIndicacao) : 0, gest: ativo ? C.round2(base * db.cfg().premiacaoGestao) : 0, dentro24: !!dentro, ativo: !!ativo };
  }
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
  function needOperar() { return C.can('operar'); }
  /** convidar vale para o originador (operar) e para o subparceiro (convidar): escopo próprio */
  function canConvidar() { return C.can('operar') || C.can('convidar'); }
  function guardMsg(perm) { return C.cannotMsg(perm || 'operar'); }
  /** QR ilustrativo determinístico (padrão visual, não carrega valor fiscal) */
  function qrLike(seedStr) {
    let hh = 7; for (const ch of seedStr) hh = (Math.imul(hh ^ ch.charCodeAt(0), 2654435761)) >>> 0;
    const r = C.rng(hh); const N = 25; const cells = [];
    const finder = (fx, fy) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { const edge = x === 0 || x === 6 || y === 0 || y === 6; const core = x >= 2 && x <= 4 && y >= 2 && y <= 4; cells.push([fx + x, fy + y, edge || core]); } };
    const inFinder = (x, y) => (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!inFinder(x, y)) cells.push([x, y, r() > 0.52]);
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    return h('svg', { viewBox: `0 0 ${N} ${N}`, class: 'orig-qr', role: 'img', 'aria-label': 'Código ilustrativo do link de indicação' },
      cells.filter((c) => c[2]).map(([x, y]) => h('rect', { x, y, width: 1, height: 1 })));
  }
  function inviteUrl(cvId) { return location.origin + location.pathname + '#/convite/' + cvId; }
  function sendReminder(e) {
    if (!canConvidar()) { ui.toast('Sem permissão', { type: 'warn', text: guardMsg() }); return; }
    if (!e.org) { ui.toast('Sem contato vinculado', { type: 'info', text: 'Reenvie o convite pela tela Convidar.' }); C.router.go('/originador/convites'); return; }
    const u = session.user();
    notify.send({ to: { orgId: e.org.id }, tipo: 'info', titulo: 'Lembrete da Lumen Consultoria', corpo: `${u.nome} retomou o contato para acompanhar a ativação da conta.`, link: null });
    ledger.append({ actor: E.actors.user(u.id), acao: 'indicado.lembrete', entidade: { kind: 'org', id: e.org.id }, resumo: `Lembrete enviado a ${indName(e)}`, classe: 'R1' });
    ui.toast('Lembrete enviado', { type: 'success', text: `Aviso registrado na trilha para ${indName(e)}.` });
  }
  function resendConvite(cv) {
    if (!canConvidar()) { ui.toast('Sem permissão', { type: 'warn', text: guardMsg() }); return; }
    const since = now() - cv.enviadoEm;
    if (since < 24 * 3600e3) { ui.toast('Aguarde para reenviar', { type: 'warn', text: `O último envio foi ${fmt.rel(cv.enviadoEm)}. Reenvie após 24 horas para não sobrecarregar o contato.` }); return; }
    db.patch('convites', cv.id, { enviadoEm: now(), ultimaAtividade: now(), status: cv.status === 'recusado' ? 'convidado' : cv.status });
    ledger.append({ actor: E.actors.user(session.user().id), acao: 'convite.reenviado', entidade: { kind: 'convite', id: cv.id }, resumo: `Convite reenviado a ${cv.nome} (${cv.email})`, classe: 'R1' });
    ui.toast('Convite reenviado', { type: 'success', text: `Novo contato enviado a ${cv.email}.` });
  }
  /* ------------------------------- início -------------------------------- */
  function saudacao() { const t = cal.sp(now()); return t.h < 12 ? 'Bom dia' : t.h < 18 ? 'Boa tarde' : 'Boa noite'; }
  function rHome(ctx) {
    if (isSub()) return rSubHome(ctx);
    const comp = compOf(now());
    const estRows0 = indicatedOrgs().map((o) => { const e = premEstimate(o.id, comp); return { org: o, tot: e.indic + e.gest, sub: estSplitOf(o, e.indic, e.gest) }; });
    const est = C.round2(C.sum(estRows0, (r) => r.tot - r.sub));
    const aReceber = C.round2(C.sum(myPremiacoes().filter((p) => ['apurado', 'aprovado'].includes(p.status)), liquidoOf));
    const vol = C.round2(C.sum(indicatedOrgs().map((o) => vol30(o.id)), (x) => x));
    // premiação por mês (últimos 6), empilhada indicação + gestão
    const comps = []; { const t = cal.sp(now()); for (let i = 5; i >= 0; i--) { let m = t.m - i, y = t.y; while (m < 1) { m += 12; y--; } comps.push(y + '-' + String(m).padStart(2, '0')); } }
    const perComp = comps.map((c) => { const rows = myPremiacoes().filter((p) => p.competencia === c); return { c, ind: C.round2(C.sum(rows, (p) => p.indicacao)), gest: C.round2(C.sum(rows, (p) => p.gestao)) }; });
    const funnel = [['Convidado', 0, 'neutral'], ['Cadastrado', 0, 'blue'], ['KYC', 0, 'amber'], ['Ativo', 0, 'green'], ['Inativo', 0, 'red']];
    const t = cal.sp(now()); const relDate = cal.nthUtil(t.m === 12 ? t.y + 1 : t.y, t.m === 12 ? 1 : t.m + 1, 5);
    const best = indicatedOrgs().map((o) => ({ o, v: C.sum(paidOps(o.id), (x) => x.face) })).sort((a, b) => b.v - a.v)[0];
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Originador · Lumen Consultoria', title: `${saudacao()}, ${ctx.user.nome.split(' ')[0]}`, subtitle: 'Sua carteira de indicados, a premiação do mês e os próximos vencimentos de relatório.', actions: [ui.btn('Convidar empresa', { variant: 'primary', icon: 'user-plus', onclick: () => ctx.go('/originador/convites') })] }),
      ui.live(['convites', 'orgs', 'operacoes', 'premiacoes', 'contestacoes'], () => {
        const e2 = indicadoEntries(); const by2 = (s) => e2.filter((x) => indStatus(x) === s);
        const at2 = by2('ativo'); const fu2 = funnel.map(([lab, , tone]) => [lab, by2(lab === 'KYC' ? 'kyc' : lab === 'Inativo' ? 'inativo' : lab === 'Ativo' ? 'ativo' : lab === 'Cadastrado' ? 'cadastrado' : 'convidado').length, tone]);
        const fm2 = Math.max(1, ...fu2.map((f) => f[1]));
        const inat2 = e2.filter((x) => x.org && indStatus(x) === 'ativo' && lastActivity(x) && (now() - lastActivity(x)) >= 80 * DAY);
        const sem2 = myConvites().filter((c) => c.status === 'convidado' && (now() - c.enviadoEm) > 7 * DAY);
        const contest2 = myPremiacoes().filter((p) => p.status === 'em_contestacao');
        const pendKyc2 = e2.filter((x) => indStatus(x) === 'kyc');
        return h('div.stack',
          h('div.grid.g4.keep2',
            ui.kpi({ label: 'Indicados ativos', value: at2.length, icon: 'users', tone: 'green', hint: `${e2.length} vínculos no total`, onclick: () => ctx.go('/originador/indicados') }),
            ui.kpi({ label: 'Premiação estimada do mês', value: Math.round(est), fmt: 'brl', icon: 'award', tone: 'amber', hint: `${fmt.monthLong(comp)} · líquido, já sem a parte dos subs`, onclick: () => ctx.go('/originador/premiacao') }),
            ui.kpi({ label: 'Premiação a receber', value: Math.round(aReceber), fmt: 'brl', icon: 'hand-coins', tone: 'blue', hint: 'Líquido da Lumen: apurada ou aprovada, ainda não paga', onclick: () => ctx.go('/originador/premiacao') }),
            ui.kpi({ label: 'Volume originado, 30 dias', value: Math.round(vol), fmt: 'brl', icon: 'trending-up', tone: 'teal', hint: 'Face das operações pagas dos indicados' })),
          h('div.grid.g-main-side',
            h('div.stack',
              ui.card({ title: 'Funil de indicados', subtitle: 'Do convite à ativação. Clique em uma etapa para filtrar a carteira.', actions: [ui.btn('Ver carteira', { variant: 'ghost', size: 'sm', onclick: () => ctx.go('/originador/indicados') })] },
                h('div.orig-funnel', fu2.map(([lab, n, tone]) => h('button', { type: 'button', class: 'orig-fstep', onclick: () => ctx.go('/originador/indicados?st=' + encodeURIComponent(lab === 'KYC' ? 'kyc' : lab === 'Inativo' ? 'inativo' : lab === 'Ativo' ? 'ativo' : lab === 'Cadastrado' ? 'cadastrado' : 'convidado')), 'aria-label': `${lab}: ${n}` },
                  h('span.orig-flab', lab), h('span.orig-fbar', { dataset: { tone }, style: { '--w': Math.max(8, Math.round((n / fm2) * 100)) + '%' } }, h('b', String(n))))))),
              ui.card({ title: 'Premiação por mês', subtitle: 'Indicação (10%) e gestão (30%) sobre a TS apurada, em reais.', actions: [ui.btn('Ver extrato', { variant: 'ghost', size: 'sm', onclick: () => ctx.go('/originador/premiacao') })] },
                ui.chart.bars({ categories: perComp.map((p) => fmt.month(compOfEnd(p.c))), series: [{ name: 'Indicação 10%', tone: 'blue', data: perComp.map((p) => p.ind) }, { name: 'Gestão 30%', tone: 'teal', data: perComp.map((p) => p.gest) }], stacked: true, format: axisBrl, tipFormat: (v) => fmt.brl(v) })),
            ),
            h('div.stack',
              ui.card({ title: 'Atenção', subtitle: 'Itens que precisam da sua ação.' }, attentionList(ctx, { inatRisco: inat2, semResp: sem2, contest: contest2, pendKyc: pendKyc2, relDate })),
              h('div', { class: 'card card-ai' }, h('div.card-body', h('div.stack.tight',
                h('div.row', ui.ai('Sugestão da IA'), h('span.small.muted', 'Agente de carteira')),
                h('strong', best ? `Reative quem parou e replique o que deu certo com ${best.o.fantasia}` : 'Comece convidando empresas do seu relacionamento'),
                h('p.small.muted', best ? `A ${best.o.fantasia} originou ${fmt.brlCompact(best.v)} em operações pagas. Convites para empresas do mesmo setor costumam ativar mais rápido.` : 'Convide empresas com faturamento e prazo de recebimento parecidos com os da sua rede.'),
                h('div.row', ui.btn('Reativar indicado', { variant: 'ai', size: 'sm', icon: 'send', onclick: () => { const tgt = inat2[0] || e2.find((x) => indStatus(x) === 'inativo'); if (tgt) sendReminder(tgt); else ctx.go('/originador/convites'); } }),
                  ui.btn('Convidar do mesmo setor', { variant: 'secondary', size: 'sm', icon: 'user-plus', onclick: () => ctx.go('/originador/convites') }))))),
            )),
          redeCard(ctx));
      }),
    );
  }
  function compOfEnd(c) { const [y, m] = c.split('-').map(Number); return cal.spTs(y, m, 15, 12, 0); }
  function attentionList(ctx, { inatRisco, semResp, contest, pendKyc, relDate }) {
    const items = [];
    inatRisco.forEach((e) => { const d = daysAgo(lastActivity(e)); const left = Math.max(0, 90 - d);
      items.push(h('div.list-item', h('span.tl-dot', { style: 'background:var(--amber-tint);color:var(--amber-ink)' }, icon('timer', 14)),
        h('div.grow', h('strong', indName(e)), h('div.small.muted', `${d} dias sem atividade. Perde a gestão (30%) em ${left} dias.`)),
        ui.btn('Reativar', { size: 'sm', onclick: () => sendReminder(e) }))); });
    semResp.forEach((c) => items.push(h('div.list-item', h('span.tl-dot', { style: 'background:var(--blue-tint);color:var(--blue-ink)' }, icon('mail', 14)),
      h('div.grow', h('strong', c.nome), h('div.small.muted', `Convite sem resposta há ${daysAgo(c.enviadoEm)} dias.`)),
      ui.btn('Reenviar', { size: 'sm', onclick: () => resendConvite(c) }))));
    contest.forEach((p) => { const ced = db.get('orgs', p.cedenteId); items.push(h('div.list-item', h('span.tl-dot', { style: 'background:var(--amber-tint);color:var(--amber-ink)' }, icon('flag', 14)),
      h('div.grow', h('strong', 'Premiação em contestação'), h('div.small.muted', `${fmt.monthLong(p.competencia)} · ${ced ? ced.fantasia : ''} · ${fmt.brl(p.total)}`)),
      ui.btn('Acompanhar', { size: 'sm', onclick: () => ctx.go('/originador/premiacao') }))); });
    pendKyc.forEach((e) => items.push(h('div.list-item', h('span.tl-dot', { style: 'background:var(--violet-tint);color:var(--violet-ink)' }, icon('scan-line', 14)),
      h('div.grow', h('strong', indName(e)), h('div.small.muted', 'Cadastro em análise pelo KYC. Acompanhe para destravar a ativação.')),
      ui.btn('Ver', { size: 'sm', onclick: () => ctx.go('/originador/indicados/' + e.key) }))));
    items.push(h('div.list-item', h('span.tl-dot', { style: 'background:var(--surface-3);color:var(--ink-2)' }, icon('calendar-days', 14)),
      h('div.grow', h('strong', 'Relatório mensal'), h('div.small.muted', `Sai em ${fmt.date(relDate)} (5º dia útil), faltam ${fmt.dur(relDate - now())}.`)),
      ui.btn('Ver', { size: 'sm', onclick: () => ctx.go('/originador/relatorios') })));
    return items.length ? h('div.list', items) : ui.empty({ icon: 'circle-check', title: 'Tudo em dia', text: 'Nenhum item pedindo sua atenção agora.' });
  }
  /* ------------------------- rede de subparceiros (home) ------------------- */
  function redeCard(ctx) {
    return ui.live(['subparceiros', 'premiacoes', 'orgs', 'operacoes'], () => {
      const subs = subList().filter((s) => s.status !== 'encerrado');
      if (!subs.length) return ui.card({ title: 'Rede de subparceiros', subtitle: 'Amplie a carteira com um segundo nível.' },
        h('div.row', h('p.small.muted', 'Nenhum subparceiro ainda.'), ui.btn('Convidar subparceiro', { variant: 'primary', size: 'sm', icon: 'user-plus', onclick: () => ctx.go('/originador/subparceiros') })));
      const comp = compOf(now());
      const rows = subs.map((s) => {
        const orgs = db.where('orgs', (o) => o.indicadoPor === ORG && o.subparceiroId === s.id);
        const v30 = C.round2(C.sum(orgs, (o) => vol30(o.id)));
        const parteMes = estMes(orgs).sub;
        const pend = myPremiacoes().filter((p) => p.subId === s.id && repasseOf(p) === 'pendente').length;
        const d = s.ultimaAtividade ? daysAgo(s.ultimaAtividade) : null;
        return { s, orgs: orgs.length, v30, parteMes, pend, d };
      }).sort((a, b) => b.v30 - a.v30);
      const pendTot = rows.filter((r) => r.pend > 0);
      const quase = rows.filter((r) => r.d !== null && r.d >= 60 && r.s.status === 'ativo');
      return ui.card({ title: 'Rede de subparceiros', subtitle: `${subs.length} ${subs.length === 1 ? 'vínculo' : 'vínculos'} · repasse é responsabilidade da Lumen [INFERÊNCIA].`, actions: [ui.btn('Gerenciar rede', { variant: 'ghost', size: 'sm', icon: 'network', onclick: () => ctx.go('/originador/subparceiros') })] },
        h('div.list', rows.slice(0, 4).map((r) => h('button', { type: 'button', class: 'list-item clickable', onclick: () => ctx.go('/originador/subparceiros/' + r.s.id) },
          ui.avatar(r.s.nome, { size: 'sm', square: true }),
          h('div.grow', h('strong', r.s.nome), h('div.small.muted', `${r.orgs} ${r.orgs === 1 ? 'indicado' : 'indicados'} · ${fmt.brlCompact(r.v30)} em 30d · parte do sub no mês ${fmt.brl(r.parteMes)}`)),
          r.pend ? h('span.badge.badge-amber', `${r.pend} repasse${r.pend === 1 ? '' : 's'}`) : r.d !== null && r.d >= 90 ? h('span.badge.badge-red', 'inativo') : r.d !== null && r.d >= 60 ? h('span.badge.badge-amber', `há ${r.d} dias`) : h('span.small.muted', `${r.s.splitPct}%`)))),
        pendTot.length || quase.length ? h('p.small.muted', [
          pendTot.length ? `${fmt.plural(pendTot.length, 'subparceiro', 'subparceiros')} com repasse pendente` : null,
          pendTot.length && quase.length ? ' · ' : null,
          quase.length ? `${quase.map((r) => r.s.nome.split(' ')[0]).join(', ')} perto dos 90 dias de inatividade` : null,
        ].filter(Boolean).join('')) : h('p.small.muted', 'Rede em dia: sem repasses pendentes nem inatividade próxima.'));
    });
  }
  /* ------------------------------ início (sub) ----------------------------- */
  function rSubHome(ctx) {
    const sid = mySubId();
    const s = sid && db.get('subparceiros', sid);
    const comp = compOf(now());
    if (!s) return h('div.stack', ui.pageHeader({ eyebrow: 'Subparceiro', title: 'Sem vínculo', subtitle: 'Sua conta não está ligada a nenhum subparceiro.' }),
      ui.empty({ icon: 'users', title: 'Nada aqui', text: 'Fale com a Lumen Consultoria para regularizar seu acesso.', action: ui.btn('Falar com meu originador', { variant: 'primary', icon: 'send', onclick: falarComOriginador }) }));
    const orgs = db.where('orgs', (o) => o.indicadoPor === ORG && o.subparceiroId === sid);
    const convs = db.where('convites', (c) => c.origId === ORG && c.subId === sid && !c.orgId);
    const prem = myPremiacoes().filter((p) => p.subId === sid);
    const parteMes = estMes(orgs).sub;
    const comissaoTotal = C.round2(C.sum(prem, (p) => p.parteSub || 0));
    const pend = prem.filter((p) => repasseOf(p) === 'pendente');
    const vol = C.round2(C.sum(orgs, (o) => vol30(o.id)));
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Subparceiro · ' + s.nome, title: `${saudacao()}, ${ctx.user.nome.split(' ')[0]}`, subtitle: `Sua comissão é ${s.splitPct}% da premiação dos seus indicados, congelada por competência.`, actions: [ui.btn('Convidar empresa', { variant: 'primary', icon: 'user-plus', onclick: () => ctx.go('/originador/convites') }), ui.btn('Falar com meu originador', { variant: 'secondary', icon: 'send', onclick: falarComOriginador })] }),
      h('div.grid.g4.keep2',
        ui.kpi({ label: 'Meus indicados', value: orgs.length, icon: 'users', tone: 'green', onclick: () => ctx.go('/originador/indicados') }),
        ui.kpi({ label: 'Volume 30 dias', value: Math.round(vol), fmt: 'brl', icon: 'trending-up', hint: 'Face das operações pagas' }),
        ui.kpi({ label: 'Comissão estimada do mês', value: Math.round(parteMes), fmt: 'brl', icon: 'hand-coins', tone: 'amber', hint: `${fmt.monthLong(comp)} · split ${s.splitPct}% · até a apuração`, onclick: () => ctx.go('/originador/premiacao') }),
        ui.kpi({ label: 'Repasses pendentes', value: pend.length, icon: 'flag', tone: pend.length ? 'amber' : 'green', hint: pend.length ? 'Aguardando repasse da Lumen' : 'Tudo repassado', onclick: () => ctx.go('/originador/premiacao') })),
      ui.card({ title: 'Meus indicados', subtitle: 'Status e volume. Sem dados financeiros ou bancários dos indicados.', actions: [ui.btn('Ver todos', { variant: 'ghost', size: 'sm', onclick: () => ctx.go('/originador/indicados') })] },
        orgs.length ? h('div.list', orgs.slice(0, 5).map((o) => {
          const ops = paidOps(o.id);
          return h('button', { type: 'button', class: 'list-item clickable', onclick: () => ctx.go('/originador/indicados/' + o.id) },
            ui.avatar(o.fantasia || o.nome, { size: 'sm', square: true }),
            h('div.grow', h('strong', o.fantasia || o.nome), h('div.small.muted', `${fmt.plural(ops.length, 'operação paga', 'operações pagas')} · ${fmt.brlCompact(vol30(o.id))} em 30d`)));
        })) : ui.empty({ icon: 'users', title: 'Sem indicados ainda', text: 'Convide uma empresa para começar.', action: ui.btn('Convidar empresa', { variant: 'primary', size: 'sm', icon: 'user-plus', onclick: () => ctx.go('/originador/convites') }) })),
      pend.length ? ui.callout({ tone: 'warn', title: `${fmt.plural(pend.length, 'Repasse pendente', 'Repasses pendentes')} (${fmt.brl(C.round2(C.sum(pend, (p) => p.parteSub || 0)))})`, text: 'A Lumen marca cada competência como repassada após o pagamento. Acompanhe em Minha comissão.' }) : null,
      ui.card({ title: 'Como é calculada', subtitle: 'Sem letras miúdas.' },
        h('p.small', `De cada R$ 100 de premiação gerada pelos seus indicados, R$ ${s.splitPct} ficam com você e R$ ${100 - s.splitPct} com a Lumen. O percentual congela na apuração de cada competência: mudanças futuras não retroagem. A Cedy paga só a Lumen no dia 20 (mínimo de R$ 100 no total da Lumen); o repasse a você é responsabilidade da Lumen [INFERÊNCIA].`)));
  }
  /* --------------------------- carteira de indicados ----------------------- */
  const STFILTER = [['todas', 'Todas'], ['convidado', 'Convidados'], ['cadastrado', 'Cadastrados'], ['kyc', 'KYC'], ['ativo', 'Ativos'], ['inativo', 'Inativos'], ['recusado', 'Recusados']];
  function ownerSidOf(e) { return (e.org && e.org.subparceiroId) || (e.conv && e.conv.subId) || null; }
  function rIndicados(ctx) {
    let q = (ctx.query.q || '').toLowerCase();
    let st = ctx.query.st || 'todas';
    let view = 'lista';
    let sortK = 'atividade';
    let subf = isSub() ? mySubId() : 'todos';
    const wrap = h('div');
    function rows() {
      let list = indicadoEntries().map((e) => {
        const ops = e.org ? paidOps(e.org.id) : [];
        return { e, st: indStatus(e), ops, nOps: ops.length, vol: C.round2(C.sum(ops, (o) => o.face)), v30: e.org ? vol30(e.org.id) : 0,
          prem: C.round2(C.sum(myPremiacoes().filter((p) => e.org && p.cedenteId === e.org.id), liquidoOf)),
          comissao: C.round2(C.sum(myPremiacoes().filter((p) => e.org && p.cedenteId === e.org.id), (p) => p.parteSub || 0)),
          la: lastActivity(e), jan: janelaMeses(e), fp: e.org ? firstPaidOp(e.org.id) : null };
      });
      if (isSub()) list = list.filter((r) => ownerSidOf(r.e) === mySubId());
      else if (subf === 'diretos') list = list.filter((r) => !ownerSidOf(r.e));
      else if (subf !== 'todos') list = list.filter((r) => ownerSidOf(r.e) === subf);
      if (st !== 'todas') list = list.filter((r) => r.st === st);
      if (q) list = list.filter((r) => indName(r.e).toLowerCase().includes(q) || (r.e.org && r.e.org.cidade.toLowerCase().includes(q)));
      const key = { empresa: (r) => indName(r.e), atividade: (r) => -(r.la || 0), volume: (r) => -r.vol, premio: (r) => -r.prem }[sortK] || ((r) => -(r.la || 0));
      return list.sort((a, b) => { const x = key(a), y = key(b); return x > y ? 1 : x < y ? -1 : 0; });
    }
    function draw() {
      const list = rows();
      C.clear(wrap);
      if (view === 'funil') { wrap.append(funnelView(ctx, list)); return; }
      const tbl = ui.table({
        rows: list, rowKey: (r) => r.e.key, onRowClick: (r) => ctx.go('/originador/indicados/' + r.e.key),
        empty: (q || st !== 'todas')
          ? ui.empty({ icon: 'search', title: 'Nenhum indicado encontrado', text: 'Nada corresponde à busca ou ao status escolhido.', action: ui.btn('Limpar filtros', { icon: 'x', onclick: () => { q = ''; st = 'todas'; search.value = ''; stSel.value = 'todas'; draw(); } }) })
          : ui.empty({ icon: 'users', title: 'Nenhum indicado ainda', text: 'Convide uma empresa para começar a sua carteira.', action: ui.btn('Convidar empresa', { variant: 'primary', icon: 'user-plus', onclick: () => ctx.go('/originador/convites') }) }),
        columns: [
          { key: 'empresa', label: 'Empresa', width: '30%', sort: (a, b) => indName(a.e).localeCompare(indName(b.e)), mobile: 'primary', render: (r) => h('div.cell-row', ui.avatar(indName(r.e), { size: 'sm', square: true }), h('div.cell-main', h('strong', indName(r.e)), h('small', r.e.org ? `${r.e.org.cidade}/${r.e.org.uf} · ${r.e.org.setor}` : 'Ainda sem cadastro'))) },
          { key: 'status', label: 'Status', render: (r) => ui.status('convite', r.st) },
          ...(isSub() ? [] : [{ key: 'sub', label: 'Subparceiro', mobile: 'hide', render: (r) => { const sid = ownerSidOf(r.e); return sid ? h('button.linklike.small', { onclick: (ev) => { ev.stopPropagation(); ctx.go('/originador/subparceiros/' + sid); } }, subNameOf(sid)) : h('span.muted', 'Direto Lumen'); } }]),
          { key: 'op1', label: '1ª operação paga', class: 'orig-col-wide', mobile: 'hide', render: (r) => r.fp ? h('div', h('div.small.num.nowrap', fmt.date(r.fp.pagoEm)), h('div.small.muted.nowrap', r.jan === 0 ? 'janela termina neste mês' : `${r.jan} meses de janela`)) : h('div', h('div.small.muted.nowrap', 'ainda não'), h('div.small.muted.nowrap', r.e.org ? 'janela abre na 1ª operação' : '—')) },
          { key: 'vol', label: 'Volume 30d / total', align: 'right', sort: (a, b) => a.vol - b.vol, mobile: 'hide', render: (r) => h('div', h('div.num.nowrap', { style: 'font-weight:650' }, fmt.brlCompact(r.v30)), h('div.small.muted.num.nowrap', `total ${fmt.brlCompact(r.vol)} · ${fmt.plural(r.nOps, 'operação', 'operações')}`)) },
          { key: 'prem', label: isSub() ? 'Sua comissão' : 'Sua premiação', align: 'right', sort: (a, b) => (isSub() ? a.comissao - b.comissao : a.prem - b.prem), render: (r) => h('span.num.nowrap', { style: 'font-weight:650' }, fmt.brl(isSub() ? r.comissao : r.prem)) },
          { key: 'atividade', label: 'Última atividade', align: 'right', sort: (a, b) => (a.la || 0) - (b.la || 0), render: (r) => {
            if (!r.la) return h('span.muted', '—');
            const d = daysAgo(r.la); const inat = d >= 90;
            const txt = d === 0 ? 'hoje' : d === 1 ? 'há 1 dia' : `há ${d} dias`;
            return h('span.nowrap', { class: inat ? 'orig-inat' : d >= 60 ? 'orig-warn' : '' }, inat ? `inativo ${txt}` : txt);
          } },
        ],
      });
      wrap.append(ui.card({ flush: true, class: 'orig-tblcard' }, tbl));
    }
    const scopedEntries = () => (isSub() ? indicadoEntries().filter((e) => ownerSidOf(e) === mySubId()) : indicadoEntries());
    const counts = (v) => (v === 'todas' ? scopedEntries().length : scopedEntries().filter((e) => indStatus(e) === v).length);
    const stSel = ui.select({ value: st, aria: 'Filtrar por status', options: STFILTER.map(([v, l]) => ({ value: v, label: `${l} (${counts(v)})` })), onChange: (v) => { st = v; draw(); } });
    const subSel = isSub() ? null : ui.select({ value: subf, aria: 'Filtrar por subparceiro', options: [{ value: 'todos', label: 'Todos (diretos + rede)' }, { value: 'diretos', label: 'Diretos da Lumen' }].concat(subList().filter((s) => s.status !== 'encerrado').map((s) => ({ value: s.id, label: s.nome }))), onChange: (v) => { subf = v; draw(); } });
    const seg = ui.segmented({ options: [{ value: 'lista', label: 'Lista', icon: 'list' }, { value: 'funil', label: 'Funil', icon: 'funnel' }], value: view, onChange: (v) => { view = v; draw(); } });
    const sortSel = ui.select({ value: sortK, aria: 'Ordenar', options: [{ value: 'atividade', label: 'Última atividade' }, { value: 'empresa', label: 'Empresa (A-Z)' }, { value: 'volume', label: 'Maior volume' }, { value: 'premio', label: 'Maior premiação' }], onChange: (v) => { sortK = v; draw(); } });
    const search = ui.search({ placeholder: 'Buscar empresa ou cidade', value: ctx.query.q || '', onInput: (v) => { q = v.toLowerCase(); draw(); } });
    draw();
    return h('div.stack',
      ui.pageHeader({ eyebrow: isSub() ? 'Subparceiro' : 'Originador', title: isSub() ? 'Meus indicados' : 'Carteira de indicados', subtitle: isSub() ? 'Empresas que você indicou. Status, volume e sua comissão, sem dados financeiros ou bancários do indicado.' : 'Empresas que você indicou. Valores agregados de volume e status, sem dados bancários ou documentos do indicado.', actions: [ui.btn('Convidar empresa', { variant: 'primary', icon: 'user-plus', onclick: () => ctx.go('/originador/convites') })] }),
      ui.toolbar(search, stSel, subSel, sortSel, h('span.grow'), seg),
      wrap);
  }
  function funnelView(ctx, list) {
    const stages = [['convidado', 'Convidado'], ['cadastrado', 'Cadastrado'], ['kyc', 'KYC'], ['ativo', 'Ativo'], ['inativo', 'Inativo']];
    return h('div.stack', stages.map(([s, lab]) => {
      const rs = list.filter((r) => r.st === s);
      return ui.card({ title: `${lab} (${rs.length})`, subtitle: s === 'ativo' ? 'Gerando gestão de 30% enquanto houver operação nos últimos 90 dias.' : s === 'inativo' ? 'Sem atividade há 90 dias ou mais. A gestão de 30% para.' : s === 'kyc' ? 'Cadastro em análise pela Mesa Cedy.' : s === 'convidado' ? 'Convite enviado, aguardando cadastro.' : 'Cadastro feito, ainda sem operação.' },
        rs.length ? h('div.list', rs.slice(0, 6).map((r) => h('button', { type: 'button', class: 'list-item clickable', onclick: () => ctx.go('/originador/indicados/' + r.e.key) }, ui.avatar(indName(r.e), { size: 'sm', square: true }), h('div.grow', h('strong', indName(r.e)), h('div.small.muted', r.e.org ? `${fmt.plural(r.nOps, 'operação paga', 'operações pagas')} · ${fmt.brlCompact(r.vol)}` : 'Ainda sem cadastro')), r.e.org ? h('span.small.num', fmt.brl(r.prem)) : null))) : h('p.small.muted', 'Ninguém nesta etapa.'));
    }));
  }
  function premMesCard(prem) {
    if (isSub()) {
      const rows = prem.filter((p) => p.subId === mySubId());
      return ui.card({ class: 'orig-flat', title: 'Sua comissão por mês', subtitle: 'Parte do sub congelada na apuração. O repasse é marcado pela Lumen.' },
        rows.length ? ui.table({ rows: rows.slice().sort((a, b) => a.competencia < b.competencia ? 1 : -1), rowKey: (p) => p.id, columns: [
          { key: 'competencia', label: 'Competência', mobile: 'primary', render: (p) => h('strong.nowrap', fmt.monthLong(p.competencia)) },
          { key: 'split', label: 'Split', align: 'right', render: (p) => h('span.num', (p.splitPct || 0) + '%') },
          { key: 'parte', label: 'Sua comissão', align: 'right', render: (p) => h('strong.num.nowrap', fmt.brl(p.parteSub || 0)) },
          { key: 'rep', label: 'Repasse', render: (p) => repasseOf(p) === 'repassado' ? ui.badge('Repassado', 'green', { dot: true }) : repasseOf(p) === 'pendente' ? ui.badge('Pendente', 'amber', { dot: true }) : h('span.muted', '—') },
        ] }) : h('p.small.muted', 'Sua comissão aparece aqui a partir da primeira operação paga deste indicado.'));
    }
    return ui.card({ class: 'orig-flat', title: 'Premiação por mês', subtitle: 'Indicação (10%) e gestão (30%) sobre a base de TS das operações pagas deste indicado. Valores líquidos da Lumen quando há split.' },
      prem.length ? ui.table({ rows: prem.slice().sort((a, b) => a.competencia < b.competencia ? 1 : -1), rowKey: (p) => p.id, columns: [
        { key: 'competencia', label: 'Competência', mobile: 'primary', render: (p) => h('strong.nowrap', fmt.monthLong(p.competencia)) },
        { key: 'baseTS', label: 'Base TS', align: 'right', mobile: 'hide', render: (p) => h('span.num.nowrap', fmt.brl(p.baseTS)) },
        { key: 'indicacao', label: '10%', align: 'right', mobile: 'hide', render: (p) => h('span.num.nowrap', fmt.brl(p.indicacao)) },
        { key: 'gestao', label: '30%', align: 'right', mobile: 'hide', render: (p) => h('span.num.nowrap', fmt.brl(p.gestao)) },
        { key: 'total', label: 'Total', align: 'right', mobile: 'hide', render: (p) => h('span.num.nowrap', fmt.brl(p.total)) },
        { key: 'sub', label: 'Parte do sub', align: 'right', mobile: 'hide', render: (p) => (p.parteSub ? h('span.num.nowrap', '−' + fmt.brl(p.parteSub)) : h('span.muted', '—')) },
        { key: 'liq', label: 'Líquido', align: 'right', render: (p) => h('strong.num.nowrap', fmt.brl(liquidoOf(p))) },
        { key: 'status', label: 'Status', render: (p) => ui.status('premio', p.status) },
      ] }) : h('p.small.muted', 'A premiação aparece aqui a partir da primeira operação paga deste indicado.'));
  }
  function openReassign(ctx, e) {
    if (!needOperar()) { ui.toast('Sem permissão', { type: 'warn', text: guardMsg() }); return; }
    if (isSub()) { ui.toast('Sem permissão', { type: 'warn', text: 'O vínculo é gerenciado pela Lumen.' }); return; }
    const cur = ownerSidOf(e);
    const opts = [{ value: '', label: 'Direto da Lumen (sem subparceiro)' }].concat(subList().filter((s) => s.status === 'ativo').map((s) => ({ value: s.id, label: `${s.nome} · ${s.splitPct}%` })));
    const sel = ui.select({ value: cur || '', aria: 'Novo vínculo', options: opts });
    ui.modal({ title: 'Alterar vínculo', subtitle: indName(e), icon: 'users',
      body: h('div.stack.tight', ui.field({ label: 'Vínculo', required: true }, sel),
        ui.callout({ tone: 'info', title: 'Primeiro cadastro vence', text: 'O histórico é mantido. A mudança só altera o split das próximas competências; as já apuradas ficam congeladas.' })),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Salvar vínculo', { variant: 'primary', onclick: () => {
        const v = sel.value || null;
        if (v === cur) { api.close(false); return; }
        ui.confirm({ title: 'Confirmar mudança de vínculo?', text: `${indName(e)} passa a ser ${v ? subNameOf(v) : 'direto da Lumen'}. Vale para as próximas competências.`, tone: 'warn', confirmLabel: 'Confirmar' }).then((ok) => {
          if (!ok) return;
          db.batch(() => {
            if (e.org) db.patch('orgs', e.org.id, { subparceiroId: v });
            db.where('convites', (c) => (e.org && c.orgId === e.org.id) || c.id === (e.conv && e.conv.id)).forEach((c) => db.patch('convites', c.id, { subId: v }));
          });
          ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.indicado_reatribuido', entidade: { kind: 'org', id: e.org ? e.org.id : e.conv.id }, resumo: `${indName(e)} agora é ${v ? subNameOf(v) : 'direto da Lumen'}`, classe: 'R2' });
          ui.toast('Vínculo atualizado', { type: 'success', text: `${indName(e)} agora é ${v ? subNameOf(v) : 'direto da Lumen'}.` });
          api.close(true);
        });
      } })],
    });
  }
  function vinculoCard(ctx, e) {
    if (isSub()) return null;
    const sid = ownerSidOf(e);
    return ui.card({ title: 'Vínculo de indicação', subtitle: 'Quem pontua o split deste indicado.', actions: [ui.btn('Alterar', { variant: 'secondary', size: 'sm', icon: 'pencil', onclick: () => openReassign(ctx, e) })] },
      h('p.small', sid ? h('span', 'Vinculado a ', h('button.linklike', { onclick: () => ctx.go('/originador/subparceiros/' + sid) }, subNameOf(sid)), ` · split ${(subAtivoDe(sid) || db.get('subparceiros', sid)).splitPct}%`) : 'Direto da Lumen: todo o apurado é líquido da Lumen.'));
  }
  function rIndicadoDetalhe(ctx) {
    const id = ctx.params.id;
    const e = indicadoEntries().find((x) => x.key === id);
    if (!e) return h('div.stack', ui.pageHeader({ title: 'Indicado não encontrado', back: '/originador/indicados' }), ui.empty({ icon: 'search', title: 'Nada aqui', text: 'Este indicado não existe na sua carteira.', action: ui.btn('Voltar', { onclick: () => ctx.go('/originador/indicados') }) }));
    const ops = e.org ? paidOps(e.org.id) : [];
    const fp = ops[0] || null;
    const la = lastActivity(e);
    const st = indStatus(e);
    const prem = e.org ? myPremiacoes().filter((p) => p.cedenteId === e.org.id) : [];
    const totPrem = C.round2(C.sum(prem, liquidoOf));
    const totComissao = C.round2(C.sum(prem, (p) => p.parteSub || 0));
    if (isSub() && ownerSidOf(e) !== mySubId()) { ui.toast('Acesso restrito', { type: 'warn', text: 'Este indicado pertence a outro vínculo.' }); ctx.go('/originador/indicados'); return h('div'); }
    const vol = C.round2(C.sum(ops, (o) => o.face));
    const byM = {}; ops.forEach((o) => { const c = compOf(o.pagoEm); byM[c] = (byM[c] || 0) + o.face; });
    const cats = Object.keys(byM).sort().slice(-8);
    const kyc = e.org ? db.get('kyc', 'kyc-' + e.org.id) : null;
    const miles = [];
    if (e.conv && (!e.org || e.conv.enviadoEm <= e.org.cadastroEm)) miles.push({ icon: 'mail', title: 'Convite enviado', ts: e.conv.enviadoEm, tone: 'blue' });
    if (e.org) miles.push({ icon: 'building-2', title: 'Cadastro criado', ts: e.org.cadastroEm, tone: 'blue' });
    if (kyc && kyc.atualizadoEm) miles.push({ icon: 'scan-line', title: `KYC: ${ui.statusLabel('kyc', kyc.status)}`, ts: kyc.atualizadoEm, tone: kyc.status === 'aprovado' ? 'green' : 'amber' });
    if (fp) miles.push({ icon: 'banknote', title: '1ª operação paga', text: fmt.brl(fp.face), ts: fp.pagoEm, tone: 'green' });
    if (la) miles.push({ icon: 'activity', title: 'Última atividade registrada', ts: la, tone: 'neutral' });
    miles.sort((a, b) => a.ts - b.ts);
    const jan = janelaMeses(e);
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Indicado', back: '/originador/indicados', title: indName(e), subtitle: e.org ? `${e.org.cidade}/${e.org.uf} · ${e.org.setor} · cliente desde ${e.org.cadastroEm ? fmt.date(e.org.cadastroEm) : 'cadastro em análise'}` : 'Convite enviado, cadastro ainda não concluído.',
        actions: e.conv && !e.org ? [ui.btn('Reenviar convite', { variant: 'primary', icon: 'send', onclick: () => resendConvite(e.conv) }), ui.btn('Copiar link', { variant: 'secondary', icon: 'link', onclick: () => copyText(inviteUrl(e.conv.id), 'Link de indicação copiado.') })]
          : [ui.btn('Enviar lembrete', { variant: 'primary', icon: 'send', onclick: () => sendReminder(e) }), e.conv ? ui.btn('Copiar link', { variant: 'secondary', icon: 'link', onclick: () => copyText(inviteUrl(e.conv.id), 'Link de indicação copiado.') }) : null] }),
      h('div.grid.g4.keep2',
        ui.kpi({ label: 'Status', display: ui.status('convite', st), icon: 'flag' }),
        ui.kpi({ label: 'Operações pagas', value: ops.length, icon: 'repeat', hint: fp ? `1ª em ${fmt.date(fp.pagoEm)}` : 'Nenhuma ainda' }),
        ui.kpi({ label: 'Volume total', value: Math.round(vol), fmt: 'brl', icon: 'banknote', hint: `30d: ${fmt.brlCompact(vol30(e.org ? e.org.id : ''))}` }),
        ui.kpi({ label: isSub() ? 'Sua comissão' : 'Sua premiação', value: Math.round(isSub() ? totComissao : totPrem), fmt: 'brl', icon: 'award', tone: 'amber', hint: jan === null ? 'Janela abre na 1ª operação paga' : `Janela de 24 meses: ${jan} restantes` })),
      premMesCard(prem),
      h('div.grid.g-main-side',
        h('div.stack',
          cats.length ? ui.card({ title: 'Volume por mês', subtitle: 'Face das operações pagas, em reais.' }, ui.chart.bars({ categories: cats.map((c) => fmt.month(compOfEnd(c))), series: [{ name: 'Volume', tone: 'blue', data: cats.map((c) => byM[c]) }], format: axisBrl, tipFormat: (v) => fmt.brl(v) })) : null,
          ui.card({ title: 'Janela de indicação', subtitle: '10% por 24 meses desde a 1ª operação paga.' },
            jan === null ? h('p.small.muted', 'A janela abre quando a primeira operação deste indicado for paga.') :
              h('div.stack.tight', ui.progress(Math.round(((24 - jan) / 24) * 100)), h('p.small.muted', `${jan} de 24 meses restantes. Gestão de 30% enquanto houver operação nos últimos 90 dias.`))),
        ),
        h('div.stack',
          ui.card({ title: 'Marcos', subtitle: 'Do convite à atividade.' }, miles.length ? ui.timeline(miles) : ui.empty({ icon: 'history', title: 'Sem marcos', text: 'Os eventos deste indicado aparecem aqui.' })),
          vinculoCard(ctx, e),
          ui.callout({ tone: 'info', title: isSub() ? 'Visão do subparceiro' : 'Visão do originador', text: isSub() ? 'Você vê status, volume e a sua comissão. A base de TS e os dados bancários, documentos e detalhes financeiros ficam só com a Lumen e a Mesa Cedy.' : 'Você vê volumes e status. Dados bancários, documentos e detalhes financeiros do indicado ficam só com a Mesa Cedy.' }),
        )),
    );
  }
  /* -------------------------------- convites -------------------------------- */
  function rConvites(ctx) {
    const nomeI = ui.input({ placeholder: 'Razão social da empresa', autocomplete: 'off' });
    const nomeF = ui.field({ label: 'Nome da empresa', required: true, hint: 'Razão social ou nome fantasia para identificar o convite.' }, nomeI);
    const cnpjI = ui.input({ mask: 'cnpj', placeholder: '00.000.000/0000-00', inputmode: 'numeric' });
    const cnpjF = ui.field({ label: 'CNPJ', required: true, hint: 'Validamos o dígito verificador na hora.' }, cnpjI);
    const emailI = ui.input({ type: 'email', placeholder: 'contato@empresa.com.br', autocomplete: 'off' });
    const emailF = ui.field({ label: 'E-mail do contato', required: true }, emailI);
    const msgI = ui.input({ type: 'textarea', rows: 2, placeholder: 'Mensagem opcional de apresentação (aparece no convite).' });
    const msgF = ui.field({ label: 'Mensagem', optional: true }, msgI);
    const progS = ui.select({ value: 'premium', aria: 'Programa de interesse', options: db.all('produtos').map((p) => ({ value: p.id, label: p.nome, hint: p.desc })) });
    const progF = ui.field({ label: 'Programa de interesse', hint: 'Sugestão inicial. A Mesa confirma o melhor programa no cadastro.' }, progS);
    const subAtribS = isSub() ? null : ui.select({ value: '', aria: 'Atribuir ao subparceiro', options: [{ value: '', label: 'Direto da Lumen (sem subparceiro)' }].concat(subList().filter((s) => s.status === 'ativo').map((s) => ({ value: s.id, label: `${s.nome} · split ${s.splitPct}%` }))) });
    const subAtribF = isSub() ? null : ui.field({ label: 'Atribuir ao subparceiro', optional: true, hint: 'Opcional. O indicado já nasce vinculado e pontua split.' }, subAtribS);
    const firstBox = h('div.orig-first');
    function checkFirst() {
      C.clear(firstBox);
      const d = onlyDigits(cnpjI.value);
      if (d.length < 14) return null;
      const org = db.all('orgs').find((o) => o.cnpj && onlyDigits(o.cnpj) === d);
      if (org) {
        if (org.indicadoPor === ORG) { firstBox.append(ui.callout({ tone: 'info', title: 'Você já indicou esta empresa', text: `${org.fantasia || org.nome} já está na sua carteira. Não é preciso convidar de novo.` })); return 'mine'; }
        if (org.indicadoPor) { firstBox.append(ui.callout({ tone: 'warn', title: 'Primeiro cadastro vence', text: `${org.fantasia || org.nome} já foi indicada por outro parceiro e está cadastrada. O vínculo de premiação fica com quem indicou primeiro.` })); return 'other'; }
        firstBox.append(ui.callout({ tone: 'warn', title: 'Empresa já cadastrada', text: `${org.fantasia || org.nome} já tem cadastro na Cedy sem indicação vinculada. Fale com a Mesa antes de convidar.` })); return 'other';
      }
      const other = db.where('convites', (c) => c.origId !== ORG && onlyDigits(c.cnpj) === d && c.status !== 'recusado')[0];
      if (other) { firstBox.append(ui.callout({ tone: 'warn', title: 'Primeiro cadastro vence', text: `Este CNPJ já foi convidado por outro parceiro em ${fmt.date(other.enviadoEm)}. Se ele se cadastrar pelo outro link, a premiação vai para o outro parceiro.` })); return 'other'; }
      const mine = myConvites().find((c) => onlyDigits(c.cnpj) === d && c.status !== 'recusado');
      if (mine) { firstBox.append(ui.callout({ tone: 'info', title: 'Convite já enviado por você', text: `${mine.nome} recebeu seu convite em ${fmt.date(mine.enviadoEm)} (${ui.statusLabel('convite', mine.status)}).` })); return 'mine'; }
      return null;
    }
    cnpjI.addEventListener('change', checkFirst);
    async function submit() {
      let okc = true;
      const nome = nomeI.value.trim(), cnpjD = onlyDigits(cnpjI.value), email = emailI.value.trim();
      nomeF.setError(nome.length < 3 ? 'Informe o nome da empresa.' : ''); if (nome.length < 3) okc = false;
      cnpjF.setError(!cnpjValido(cnpjI.value) ? 'CNPJ inválido. Confira os 14 dígitos.' : ''); if (!cnpjValido(cnpjI.value)) okc = false;
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      emailF.setError(!emailOk ? 'Informe um e-mail válido do contato.' : ''); if (!emailOk) okc = false;
      if (!okc) return;
      const first = checkFirst();
      if (first === 'mine') return;
      if (first === 'other') {
        const go = await ui.confirm({ title: 'Convidar mesmo assim?', text: 'Este CNPJ já tem vínculo com outro parceiro ou com a plataforma. O primeiro cadastro vence: sua premiação só vale se a empresa se cadastrar pelo seu link primeiro.', tone: 'warn', confirmLabel: 'Convidar mesmo assim' });
        if (!go) return;
      }
      if (!canConvidar()) { ui.toast('Sem permissão', { type: 'warn', text: guardMsg() }); return; }
      const atrib = isSub() ? mySubId() : (subAtribS.value || null);
      const cv = db.put('convites', { id: C.uid('cv'), origId: ORG, subId: atrib, nome, nomeFantasia: nome, email, cnpj: cnpjD, mensagem: msgI.value.trim() || null, programa: progS.value, status: 'convidado', enviadoEm: now(), ultimaAtividade: now(), orgId: null });
      ledger.append({ actor: E.actors.user(session.user().id), acao: 'convite.criado', entidade: { kind: 'convite', id: cv.id }, resumo: `Convite criado para ${nome} (${email})${atrib ? ` via subparceiro ${subNameOf(atrib)}` : ''}`, classe: 'R1' });
      ui.toast('Convite criado', { type: 'success', text: `Link de indicação pronto para ${nome}.` });
      nomeI.value = ''; cnpjI.value = ''; emailI.value = ''; msgI.value = ''; C.clear(firstBox);
    }
    // convite em lote
    const bulkI = ui.input({ type: 'textarea', rows: 3, placeholder: 'um e-mail por linha, ou separados por vírgula ou ponto e vírgula' });
    const bulkBox = h('div');
    function bulkSubmit() {
      if (!canConvidar()) { ui.toast('Sem permissão', { type: 'warn', text: guardMsg() }); return; }
      const parts = String(bulkI.value).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) { ui.toast('Nada para importar', { type: 'warn', text: 'Cole ao menos um e-mail.' }); return; }
      const seen = new Set(myConvites().map((c) => c.email.toLowerCase()));
      const res = { created: [], dup: [], invalid: [] };
      parts.forEach((em) => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { res.invalid.push(em); return; }
        if (seen.has(em.toLowerCase())) { res.dup.push(em); return; }
        seen.add(em.toLowerCase());
        const nm = em.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        db.put('convites', { id: C.uid('cv'), origId: ORG, subId: isSub() ? mySubId() : null, nome: nm, email: em, cnpj: '', mensagem: null, programa: 'premium', status: 'convidado', enviadoEm: now(), ultimaAtividade: now(), orgId: null });
        res.created.push(em);
      });
      ledger.append({ actor: E.actors.user(session.user().id), acao: 'convite.lote', entidade: { kind: 'org', id: ORG }, resumo: `Convite em lote: ${res.created.length} criados, ${res.dup.length} já existiam, ${res.invalid.length} inválidos`, classe: 'R1' });
      C.clear(bulkBox);
      bulkBox.append(ui.callout({ tone: res.invalid.length || res.dup.length ? 'warn' : 'success', title: `${res.created.length} convites criados`,
        text: [res.dup.length ? `${res.dup.length} já existiam: ${res.dup.slice(0, 3).join(', ')}${res.dup.length > 3 ? ', …' : ''}` : null, res.invalid.length ? `${res.invalid.length} inválidos: ${res.invalid.slice(0, 3).join(', ')}${res.invalid.length > 3 ? ', …' : ''}` : null].filter(Boolean).join(' · ') || 'Todos os e-mails foram aproveitados.' }));
      bulkI.value = '';
      ui.toast('Lote processado', { type: 'success', text: `${res.created.length} criados, ${res.invalid.length} inválidos, ${res.dup.length} duplicados.` });
    }
    return h('div.stack',
      ui.pageHeader({ eyebrow: isSub() ? 'Subparceiro' : 'Originador', title: isSub() ? 'Convidar empresas' : 'Convidar empresas', subtitle: isSub() ? 'Seus convites já nascem com o seu vínculo e a sua comissão. Primeiro cadastro vence.' : 'O indicado recebe um link público, cria a conta e passa pelo KYC. Você acompanha o status, nunca os dados financeiros dele.', actions: [ui.btn('Ver carteira', { variant: 'secondary', icon: 'users', onclick: () => ctx.go('/originador/indicados') })] }),
      h('div.grid.g-main-side',
        h('div.stack',
          ui.card({ title: 'Novo convite', subtitle: 'Primeiro cadastro vence: se a empresa já foi indicada, o vínculo fica com quem chegou primeiro.' },
            h('div.stack.tight',
              h('div.grid.g2', nomeF, cnpjF, emailF, progF, subAtribF),
              msgF, firstBox,
              h('div.row.end', ui.btn('Criar convite e gerar link', { variant: 'primary', icon: 'send', onclick: submit })))),
          ui.card({ title: 'Convidar em lote', subtitle: 'Vários e-mails de uma vez. O nome é derivado do e-mail e pode ser ajustado depois.' },
            h('div.stack.tight',
              ui.field({ label: 'E-mails', hint: 'Um por linha, vírgula ou ponto e vírgula.' }, bulkI), bulkBox,
              h('div.row.end', ui.btn('Criar convites', { variant: 'secondary', icon: 'mail', onclick: bulkSubmit })))),
          ui.card({ class: 'orig-flat', title: 'Convites enviados', subtitle: 'Reenvio liberado 24 horas após o último envio.' },
            ui.live(['convites'], () => {
              const list = convitesVisiveis().slice().sort((a, b) => b.enviadoEm - a.enviadoEm);
              if (!list.length) return ui.empty({ icon: 'mail', title: 'Nenhum convite ainda', text: 'Crie o primeiro convite no formulário acima.' });
              return ui.table({ rows: list, rowKey: (c) => c.id, columns: [
                { key: 'nome', label: 'Empresa', mobile: 'primary', render: (c) => h('div', h('strong', c.nome), h('div.small.muted', c.email)) },
                { key: 'status', label: 'Status', render: (c) => ui.status('convite', c.status) },
                { key: 'enviadoEm', label: 'Enviado em', align: 'right', mobile: 'hide', render: (c) => h('span.small.num', fmt.date(c.enviadoEm)) },
                { key: 'acoes', label: 'Ações', align: 'right', render: (c) => h('div.orig-actions', [
                  ui.iconBtn('link', { label: 'Copiar link de indicação', onclick: (ev) => { ev.stopPropagation(); copyText(inviteUrl(c.id), 'Link copiado.'); } }),
                  c.status === 'convidado' ? ui.iconBtn('send', { label: 'Reenviar convite', onclick: (ev) => { ev.stopPropagation(); resendConvite(c); } }) : h('span.orig-slot'),
                  ['convidado', 'recusado'].includes(c.status) ? ui.iconBtn('trash-2', { label: 'Cancelar convite', onclick: async (ev) => { ev.stopPropagation(); if (!canConvidar()) { ui.toast('Sem permissão', { type: 'warn', text: guardMsg() }); return; } if (await ui.confirm({ title: 'Cancelar convite?', text: `O link de ${c.nome} deixa de valer.`, tone: 'danger', confirmLabel: 'Cancelar convite' })) { db.del('convites', c.id); ledger.append({ actor: E.actors.user(session.user().id), acao: 'convite.cancelado', entidade: { kind: 'convite', id: c.id }, resumo: `Convite de ${c.nome} cancelado`, classe: 'R1' }); ui.toast('Convite cancelado', { type: 'success' }); } } }) : h('span.orig-slot'),
                ]) },
              ] });
            })),
        ),
        h('div.stack',
          ui.card({ title: 'Seu link de indicação', subtitle: 'Cada convite gera um link próprio. O QR é ilustrativo.' },
            ui.live(['convites'], () => {
              const last = convitesVisiveis().slice().sort((a, b) => b.enviadoEm - a.enviadoEm)[0];
              if (!last) return h('p.small.muted', 'O link aparece aqui depois do primeiro convite.');
              return h('div.stack.tight', h('div.orig-linkbox', qrLike(last.id), h('div', h('strong.small', last.nome), h('div.small.muted.mono.orig-url', inviteUrl(last.id).split(/(?<=[\/#])/).flatMap((s) => [s, h('wbr')])))),
                h('div.row', ui.btn('Copiar link', { size: 'sm', icon: 'copy', onclick: () => copyText(inviteUrl(last.id), 'Link copiado.') }),
                  ui.btn('Texto para WhatsApp', { size: 'sm', variant: 'secondary', icon: 'message-circle', onclick: () => copyText(`Olá! A Lumen Consultoria indica a Cedy para antecipar recebíveis com leilão reverso entre financiadores. Cadastre sua empresa pelo link: ${inviteUrl(last.id)}`, 'Texto copiado. Cole no WhatsApp.') })));
            })),
          ui.card({ title: 'O que o indicado vê', subtitle: 'Página pública de convite.' },
            h('div.stack.tight',
              h('p.small', 'Uma página com a sua apresentação, os programas da Cedy e o botão de criar conta. Ao concluir o cadastro, o vínculo com você é fixado: indicações posteriores de outros parceiros não tiram a sua premiação.'),
              ui.btn('Abrir página pública', { variant: 'ghost', size: 'sm', icon: 'external-link', onclick: () => { const l = convitesVisiveis().sort((a, b) => b.enviadoEm - a.enviadoEm)[0]; if (l) window.open(inviteUrl(l.id), '_blank'); else ui.toast('Sem convites', { type: 'info', text: 'Crie um convite para ver a página pública.' }); } }))),
          ui.callout({ tone: 'info', title: 'Você não vê as finanças do indicado', text: 'Saldos, limites, operações e documentos ficam só com o indicado e a Mesa Cedy. Aqui aparecem volumes agregados e status.' }),
        )),
    );
  }
  /* -------------------------------- premiação -------------------------------- */
  function contestWindow(p) { return now() <= p.contestavelAte && ['apurado', 'aprovado'].includes(p.status); }
  function openContest(p) {
    if (!needOperar()) { ui.toast('Sem permissão', { type: 'warn', text: guardMsg() }); return; }
    const ced = db.get('orgs', p.cedenteId);
    const MOTIVOS = [
      { value: 'operacao_ausente', label: 'Operação paga não aparece no relatório' },
      { value: 'base_divergente', label: 'Base de TS divergente' },
      { value: 'janela', label: 'Janela de 24 meses aplicada errado' },
      { value: 'gestao', label: 'Gestão de 30% não reconhecida' },
      { value: 'outro', label: 'Outro motivo' }];
    const motivoS = ui.select({ value: 'operacao_ausente', aria: 'Motivo da contestação', options: MOTIVOS });
    const motivoF = ui.field({ label: 'Motivo', required: true }, motivoS);
    const detI = ui.input({ type: 'textarea', rows: 3, placeholder: 'Descreva a divergência com valores e datas.' });
    const detF = ui.field({ label: 'Detalhes', required: true, hint: 'Exemplo: a operação OP-26-0443, paga em 28/10, não entrou na base de outubro.' }, detI);
    let files = [];
    const dz = ui.dropzone({ label: 'Anexar evidência (opcional)', hint: 'Extrato, planilha ou print. Fica anexado à contestação.', onFiles: (f) => { files = f; ui.toast('Anexo recebido', { type: 'success', text: f.map((x) => x.name).join(', ') }); } });
    const m = ui.modal({ title: 'Contestar premiação', subtitle: `${fmt.monthLong(p.competencia)} · ${ced ? ced.fantasia : ''} · ${fmt.brl(p.total)}`, icon: 'flag', size: 'md',
      body: h('div.stack.tight',
        ui.callout({ tone: 'warn', title: `Prazo até ${fmt.date(p.contestavelAte)}`, text: `Contestação em até 10 dias após o relatório (${fmt.date(p.relatorioEm)}). Depois disso o valor é fechado para pagamento.` }),
        motivoF, detF, dz),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Enviar contestação', { variant: 'primary', icon: 'send', onclick: () => {
        if (!detI.value.trim()) { detF.setError('Descreva a divergência para a Mesa analisar.'); return; }
        const ct = db.put('contestacoes', { id: C.uid('ct'), premiacaoId: p.id, origId: ORG, motivo: MOTIVOS.find((x) => x.value === motivoS.value).label + ': ' + detI.value.trim(), anexo: files.length ? files[0].name : null, abertaEm: now(), status: 'em_analise' });
        db.patch('premiacoes', p.id, { status: 'em_contestacao' });
        ledger.append({ actor: E.actors.user(session.user().id), acao: 'premiacao.contestada', entidade: { kind: 'premiacao', id: p.id }, resumo: `Premiação de ${fmt.monthLong(p.competencia)} contestada: ${detI.value.trim().slice(0, 80)}`, classe: 'R2', detalhe: { contestacaoId: ct.id } });
        notify.send({ to: { role: 'ops' }, tipo: 'alerta', titulo: 'Premiação contestada', corpo: `${fmt.monthLong(p.competencia)} · ${ced ? ced.fantasia : ''} · ${fmt.brl(p.total)}`, link: '/ops/faturamento' });
        ui.toast('Contestação enviada', { type: 'success', text: 'A Mesa Cedy analisa em até 5 dias úteis. O pagamento desta linha fica suspenso.' });
        api.close(true);
      } })] });
  }
  function premioDrawer(p) {
    const ced = db.get('orgs', p.cedenteId);
    const [y, m] = p.competencia.split('-').map(Number);
    const ini = cal.spTs(y, m, 1, 0, 0), fim = cal.spTs(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0);
    const ops = paidOps(p.cedenteId).filter((o) => o.pagoEm >= ini && o.pagoEm < fim);
    const ct = db.where('contestacoes', (c) => c.premiacaoId === p.id)[0];
    ui.drawer({ title: `${fmt.monthLong(p.competencia)} · ${ced ? ced.fantasia : ''}`, subtitle: `Base TS ${fmt.brl(p.baseTS)} · ${fmt.plural(p.nOps, 'operação', 'operações')} no relatório · pagamento em ${fmt.date(p.pagamentoEm)}`, icon: 'award', size: 'lg',
      body: h('div.stack',
        ui.kv([['Indicação (10%)', fmt.brl(p.indicacao)], ['Gestão (30%)', fmt.brl(p.gestao)], ['Total', fmt.brl(p.total)], ['Parte do sub' + (p.subId ? ` (${subNameOf(p.subId)} · ${p.splitPct || 0}%)` : ''), p.parteSub ? '−' + fmt.brl(p.parteSub) : '—'], ['Líquido da Lumen', h('strong', fmt.brl(liquidoOf(p)))], ['Status', ui.status('premio', p.status)], ['Relatório em', fmt.date(p.relatorioEm)], ['Pagamento em', fmt.date(p.pagamentoEm)], ['Contestável até', fmt.date(p.contestavelAte)]]),
        ct ? ui.callout({ tone: 'warn', title: 'Em contestação', text: `${ct.motivo} (aberta em ${fmt.date(ct.abertaEm)}). O pagamento desta linha está suspenso até a Mesa decidir.` }) : null,
        ops.length > p.nOps && contestWindow(p) ? ui.callout({ tone: 'info', title: 'Há operações pagas fora da base', text: `O relatório considerou ${fmt.plural(p.nOps, 'operação', 'operações')}, mas o indicado tem ${ops.length} pagas na competência. Se faltou alguma, conteste a premiação.` }) : null,
        h('div.stack.tight', h('h3', 'Operações da competência'), h('p.small.muted', 'Cada linha mostra a TS que compôs a base.')),
        ui.table({ rows: ops, rowKey: (o) => o.id, empty: ui.empty({ icon: 'repeat', title: 'Sem operações', text: 'Nenhuma operação paga deste indicado nesta competência.' }), columns: [
          { key: 'id', label: 'Operação', render: (o) => h('span.mono.strong', o.id) },
          { key: 'pagoEm', label: 'Paga em', render: (o) => h('span.small', fmt.date(o.pagoEm)), mobile: 'hide' },
          { key: 'face', label: 'Face', align: 'right', render: (o) => h('span.num', fmt.brl(o.face)), mobile: 'hide' },
          { key: 'ts', label: 'TS', align: 'right', render: (o) => h('strong.num', fmt.brl(o.ts || 0)) },
        ] }),
        contestWindow(p) ? ui.btn('Contestar esta premiação', { variant: 'secondary', icon: 'flag', onclick: () => openContest(p) })
          : p.status === 'em_contestacao' ? h('p.small.muted', 'Contestação em análise pela Mesa Cedy.')
          : h('p.small.muted', `Fora da janela de contestação (até ${fmt.date(p.contestavelAte)}). O valor segue para pagamento ou já foi pago.`),
      ) });
  }
  function rPremiacao(ctx) {
    if (isSub()) return rSubPremiacao(ctx);
    const all = myPremiacoes();
    const tot = C.round2(C.sum(all, (p) => p.total));
    const parteSubs = C.round2(C.sum(all, (p) => p.parteSub || 0));
    const liquido = C.round2(C.sum(all, liquidoOf));
    const receber = C.round2(C.sum(all.filter((p) => ['apurado', 'aprovado', 'em_contestacao'].includes(p.status)), liquidoOf));
    const ty = cal.sp(now()).y;
    const pagoAno = C.round2(C.sum(all.filter((p) => p.status === 'pago' && p.competencia.startsWith(String(ty))), liquidoOf));
    const retido = C.round2(C.sum(all.filter((p) => p.status === 'retido'), liquidoOf));
    const comp = compOf(now());
    const estRows = indicatedOrgs().map((o) => Object.assign({ org: o }, premEstimate(o.id, comp))).filter((r) => r.base > 0);
    estRows.forEach((r) => { r.sub = estSplitOf(r.org, r.indic, r.gest); r.liq = C.round2(r.indic + r.gest - r.sub); });
    const estTot = C.round2(C.sum(estRows, (r) => r.liq));
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Originador', title: 'Premiação', subtitle: '10% da TS por 24 meses desde a 1ª operação paga, mais 30% de gestão enquanto o indicado estiver ativo. Valores líquidos da Lumen: total menos a parte dos subparceiros.', actions: [ui.btn('Ver relatórios', { variant: 'secondary', icon: 'file-text', onclick: () => ctx.go('/originador/relatorios') })] }),
      h('div.grid.g4.keep2',
        ui.kpi({ label: 'Total apurado', value: Math.round(tot), fmt: 'brl', icon: 'award', tone: 'amber', hint: 'Bruto, antes do split' }),
        ui.kpi({ label: 'Parte dos subparceiros', value: Math.round(parteSubs), fmt: 'brl', icon: 'users', hint: 'Congelada por competência na apuração' }),
        ui.kpi({ label: 'Líquido da Lumen', value: Math.round(liquido), fmt: 'brl', icon: 'hand-coins', tone: 'green', hint: 'Apurado menos parte dos subs' }),
        ui.kpi({ label: 'A receber (líquido)', value: Math.round(receber), fmt: 'brl', icon: 'hand-coins', tone: 'blue', hint: 'Apurada, aprovada ou em contestação' })),
      h('div.grid.g4.keep2',
        ui.kpi({ label: `Pago em ${ty} (líquido)`, value: Math.round(pagoAno), fmt: 'brl', icon: 'circle-check', tone: 'green' }),
        ui.kpi({ label: 'Retido (mín. R$ 100)', value: Math.round(retido), fmt: 'brl', icon: 'pause', hint: 'Sobre o total da Lumen; acumula para o próximo mês' })),
      estRows.length ? ui.card({ class: 'orig-flat', title: `Em apuração · ${fmt.monthLong(comp)}`, subtitle: `Estimativa de ${fmt.brl(estTot)} sobre a TS paga até aqui. Entra no relatório do 5º dia útil do próximo mês.` },
        ui.table({ rows: estRows, rowKey: (r) => r.org.id, columns: [
          { key: 'org', label: 'Indicado', mobile: 'primary', render: (r) => h('strong', r.org.fantasia) },
          { key: 'base', label: 'Base TS', align: 'right', render: (r) => h('span.num', fmt.brl(r.base)) },
          { key: 'indic', label: '10%', align: 'right', render: (r) => h('span.num', fmt.brl(r.indic) + (r.dentro24 ? '' : ' (fora da janela)')) },
          { key: 'gest', label: '30%', align: 'right', render: (r) => h('span.num', fmt.brl(r.gest) + (r.ativo ? '' : ' (inativo)')) },
          { key: 'sub', label: 'Parte sub (est.)', align: 'right', mobile: 'hide', render: (r) => (r.sub ? h('span.num', '−' + fmt.brl(r.sub)) : h('span.muted', '—')) },
          { key: 'tot', label: 'Líquido (est.)', align: 'right', render: (r) => h('strong.num', fmt.brl(r.liq)) },
        ] })) : null,
      ui.card({ class: 'orig-flat', title: 'Extrato por competência', subtitle: 'Toque em uma linha para ver as operações que compuseram a base.' },
        ui.live(['premiacoes', 'contestacoes', 'operacoes'], () => {
          const rows = myPremiacoes();
          if (!rows.length) return ui.empty({ icon: 'award', title: 'Sem premiação ainda', text: 'A premiação aparece após a primeira operação paga de um indicado.' });
          return ui.table({ rows, rowKey: (p) => p.id, onRowClick: premioDrawer, columns: [
            { key: 'competencia', label: 'Competência', mobile: 'primary', render: (p) => h('div', h('strong.nowrap', fmt.monthLong(p.competencia)), h('div.small.muted', (db.get('orgs', p.cedenteId) || {}).fantasia || '')) },
            { key: 'baseTS', label: 'Base TS', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.baseTS)) },
            { key: 'indicacao', label: '10%', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.indicacao)) },
            { key: 'gestao', label: '30%', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.gestao)) },
            { key: 'total', label: 'Total', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.total)) },
            { key: 'parteSub', label: 'Parte dos subs', align: 'right', mobile: 'hide', render: (p) => (p.parteSub ? h('span.num', '−' + fmt.brl(p.parteSub)) : h('span.muted', '—')) },
            { key: 'liq', label: 'Líquido', align: 'right', render: (p) => h('strong.num', fmt.brl(liquidoOf(p))) },
            { key: 'status', label: 'Status', render: (p) => ui.status('premio', p.status) },
            { key: 'pagamentoEm', label: 'Pagamento', align: 'right', mobile: 'hide', render: (p) => h('span.small.num', fmt.date(p.pagamentoEm)) },
            { key: 'acao', label: '', align: 'right', render: (p) => contestWindow(p) ? ui.btn('Contestar', { size: 'sm', icon: 'flag', onclick: (ev) => { ev.stopPropagation(); openContest(p); } }) : h('span.small.muted.nowrap', p.status === 'em_contestacao' ? 'em análise' : p.status === 'pago' ? '' : 'janela encerrada') },
          ] });
        })),
      h('div.grid.g-2-1',
        ui.card({ title: 'Regras da premiação', subtitle: 'Relatório no 5º dia útil, contestação em 10 dias, pagamento no dia 20 do mês seguinte e mínimo de R$ 100. Janelas ao vivo da sua carteira.' },
          ui.live(['operacoes', 'orgs'], () => h('div.list', indicatedOrgs().map((o) => {
            const fp = firstPaidOp(o.id); const lp = lastPaidTs(o.id);
            const jan = janelaMeses({ org: o });
            const gestOk = lp && (now() - lp) < db.cfg().inatividadeDias * DAY;
            return h('div.list-item', ui.avatar(o.fantasia, { size: 'sm', square: true }),
              h('div.grow', h('strong', o.fantasia), h('div.small.muted', fp ? `1ª operação paga em ${fmt.date(fp.pagoEm)}` : 'Sem operação paga ainda')),
              h('div', { style: 'text-align:right' }, h('div.small', jan === null ? 'janela abre na 1ª operação paga' : `${jan} meses restantes`), h('div.small', { class: gestOk ? 'orig-ok' : 'orig-warn' }, gestOk ? 'gestão de 30% ativa' : 'gestão de 30% pausada')));
          })))),
        h('div.stack',
          ui.card({ title: 'Conta de premiação', subtitle: 'Pagamento sempre na conta do mesmo CNPJ.' },
            (() => { const c = me().contaPremiacao || {}; return ui.kv([['Banco', c.banco || '—'], ['Agência / conta', `${c.agencia || '—'} / ${c.conta || '—'}`], ['Titularidade', 'Mesmo CNPJ da Lumen']]); })(),
            h('div.sp-2'), ui.btn('Gerenciar em Configurações', { variant: 'ghost', size: 'sm', icon: 'settings', onclick: () => ctx.go('/originador/configuracoes') })),
          ui.callout({ tone: 'info', title: 'Tributação da premiação', text: 'PIS, COFINS, ISS, CBS e IBS da premiação em revisão fiscal [INFERÊNCIA]. Fale com o seu contador antes de emitir a nota.' }),
        )),
    );
  }
  /* ------------------------------ comissão (sub) ----------------------------- */
  function subDemoDrawer(p, s) {
    const ced = db.get('orgs', p.cedenteId) || {};
    ui.drawer({ title: `Demonstrativo · ${fmt.monthLong(p.competencia)}`, subtitle: `${ced.fantasia || ced.nome || ''} · split ${p.splitPct || 0}% congelado na apuração`, icon: 'file-text', size: 'md',
      body: h('div.stack',
        ui.kv([['Competência', fmt.monthLong(p.competencia)], ['Indicado', ced.fantasia || ced.nome || '—'], ['Split congelado', (p.splitPct || 0) + '%'], ['Sua comissão', h('strong', fmt.brl(p.parteSub || 0))], ['Repasse', repasseOf(p) === 'repassado' ? `Repassado em ${fmt.date(p.repasseSub.em)}` : 'Pendente (a Lumen confirma após o pagamento da Cedy)'], ['Apuração', ui.status('premio', p.status)]]),
        h('p.small.muted', 'A base de TS e os valores totais da Lumen não aparecem aqui: o demonstrativo mostra só a sua parte. Dúvidas? Fale com seu originador.'),
        h('div.row', ui.btn('Falar com meu originador', { variant: 'secondary', size: 'sm', icon: 'send', onclick: falarComOriginador })) ) });
  }
  function rSubPremiacao(ctx) {
    const sid = mySubId();
    const s = sid && db.get('subparceiros', sid);
    if (!s) { ui.toast('Acesso restrito', { type: 'warn', text: 'Sua conta não está ligada a nenhum subparceiro.' }); ctx.go('/originador'); return h('div'); }
    const prem = myPremiacoes().filter((p) => p.subId === sid).sort((a, b) => a.competencia < b.competencia ? 1 : -1);
    const comp = compOf(now());
    const parteMes = estMes(db.where('orgs', (o) => o.indicadoPor === ORG && o.subparceiroId === sid)).sub;
    const total = C.round2(C.sum(prem, (p) => p.parteSub || 0));
    const pend = prem.filter((p) => repasseOf(p) === 'pendente');
    const pendTot = C.round2(C.sum(pend, (p) => p.parteSub || 0));
    const t = cal.sp(now());
    const prox20 = t.d < 20 ? cal.spTs(t.y, t.m, 20, 12, 0) : cal.spTs(t.m === 12 ? t.y + 1 : t.y, t.m === 12 ? 1 : t.m + 1, 20, 12, 0);
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Subparceiro · ' + s.nome, title: 'Minha comissão', subtitle: `${s.splitPct}% da premiação dos seus indicados, congelada por competência. O repasse é marcado pela Lumen após o pagamento da Cedy no dia 20.`, actions: [ui.btn('Falar com meu originador', { variant: 'secondary', icon: 'send', onclick: falarComOriginador })] }),
      h('div.grid.g4.keep2',
        ui.kpi({ label: 'Comissão estimada do mês', value: Math.round(parteMes), fmt: 'brl', icon: 'hand-coins', tone: 'amber', hint: `${fmt.monthLong(comp)} · split ${s.splitPct}% · até a apuração` }),
        ui.kpi({ label: 'Comissão acumulada', value: Math.round(total), fmt: 'brl', icon: 'award', hint: `${fmt.plural(prem.length, 'competência', 'competências')} apuradas` }),
        ui.kpi({ label: 'Aguardando repasse', value: Math.round(pendTot), fmt: 'brl', icon: 'flag', tone: pend.length ? 'amber' : 'green', hint: pend.length ? `${fmt.plural(pend.length, 'competência pendente', 'competências pendentes')}` : 'Tudo repassado' }),
        ui.kpi({ label: 'Próximo pagamento Cedy', value: 'dia 20', icon: 'calendar-days', hint: fmt.date(prox20) })),
      ui.card({ class: 'orig-flat', title: 'Extrato por competência', subtitle: 'Toque numa linha para ver o demonstrativo da competência.' },
        prem.length ? ui.table({ rows: prem, rowKey: (p) => p.id, onRowClick: (p) => subDemoDrawer(p, s), columns: [
          { key: 'competencia', label: 'Competência', mobile: 'primary', render: (p) => h('div', h('strong.nowrap', fmt.monthLong(p.competencia)), h('div.small.muted', (db.get('orgs', p.cedenteId) || {}).fantasia || '')) },
          { key: 'split', label: 'Split', align: 'right', render: (p) => h('span.num', (p.splitPct || 0) + '%') },
          { key: 'parte', label: 'Sua comissão', align: 'right', render: (p) => h('strong.num.nowrap', fmt.brl(p.parteSub || 0)) },
          { key: 'rep', label: 'Repasse', render: (p) => repasseOf(p) === 'repassado' ? ui.badge('Repassado', 'green', { dot: true }) : repasseOf(p) === 'pendente' ? ui.badge('Pendente', 'amber', { dot: true }) : h('span.muted', '—') },
          { key: 'status', label: 'Apuração', mobile: 'hide', render: (p) => ui.status('premio', p.status) },
        ] }) : ui.empty({ icon: 'hand-coins', title: 'Sem comissão ainda', text: 'Sua comissão aparece após a primeira apuração com indicados seus.' })),
      ui.card({ title: 'Como é calculada', subtitle: 'Sem letras miúdas.' },
        h('div.stack.tight',
          h('p.small', `De cada R$ 100 de premiação gerada pelos seus indicados, R$ ${s.splitPct} ficam com você. O percentual congela na apuração de cada competência (coluna Split): mudanças futuras nunca retroagem.`),
          h('p.small', 'A Cedy paga só a Lumen no dia 20 (mínimo de R$ 100 no total da Lumen). O repasse a você é responsabilidade da Lumen [INFERÊNCIA]: cada competência muda para Repassado quando a Lumen confirma. Dúvidas? Fale com seu originador.'),
          h('div.row', ui.btn('Falar com meu originador', { variant: 'secondary', size: 'sm', icon: 'send', onclick: falarComOriginador })))));
  }
  /* -------------------------------- relatórios ------------------------------- */
  function compsWithVolume() {
    const byC = {};
    indicatedOrgs().forEach((o) => paidOps(o.id).forEach((op) => {
      const c = compOf(op.pagoEm);
      byC[c] = byC[c] || { face: 0, ts: 0 };
      byC[c].face = C.round2(byC[c].face + op.face); byC[c].ts = C.round2(byC[c].ts + (op.ts || 0));
    }));
    const comps = Object.keys(byC).sort();
    const cur = compOf(now());
    if (!comps.includes(cur)) comps.push(cur);
    return comps.sort().map((c) => {
      const [y, m] = c.split('-').map(Number);
      const nm = m === 12 ? [y + 1, 1] : [y, m + 1];
      return { comp: c, relEm: cal.nthUtil(nm[0], nm[1], 5), face: (byC[c] || { face: 0 }).face, ts: (byC[c] || { ts: 0 }).ts, prem: myPremiacoes().filter((p) => p.competencia === c) };
    });
  }
  function downloadCSV(name, head, rows) {
    const esc = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function printReport(title, bodyNode) {
    const doc = h('div', { class: 'orig-print-doc' }, h('h1', 'Cedy · ' + title), h('p', `Emitido em ${fmt.datetime(now())} · Lumen Consultoria`), bodyNode);
    document.body.appendChild(doc);
    document.body.classList.add('is-printing');
    const done = () => { document.body.classList.remove('is-printing'); doc.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 60);
    setTimeout(done, 4000);
  }
  function reportBody(rep) {
    const rows = rep.prem.map((p) => {
      const ced = db.get('orgs', p.cedenteId) || {};
      const n2 = (v) => v.toFixed(2).replace('.', ',');
      return [fmt.monthLong(p.competencia), ced.fantasia || ced.nome || '', n2(p.baseTS), n2(p.indicacao), n2(p.gestao), n2(p.total), p.subId ? subNameOf(p.subId) : 'Direto Lumen', String(p.splitPct || 0) + '%', n2(p.parteSub || 0), n2(liquidoOf(p)), ui.statusLabel('premio', p.status)];
    });
    const tbl = h('table', { class: 'orig-print-tbl' }, h('thead', h('tr', ['Competência', 'Indicado', 'Base TS (R$)', 'Indicação 10% (R$)', 'Gestão 30% (R$)', 'Total (R$)', 'Subparceiro', 'Split', 'Parte do sub (R$)', 'Líquido Lumen (R$)', 'Status'].map((c) => h('th', c)))),
      h('tbody', rows.map((r) => h('tr', r.map((c) => h('td', c))))));
    return { rows, tbl };
  }
  function openReport(rep) {
    const { rows, tbl } = reportBody(rep);
    const head = ['Competência', 'Indicado', 'Base TS (R$)', 'Indicação 10% (R$)', 'Gestão 30% (R$)', 'Total (R$)', 'Subparceiro', 'Split', 'Parte do sub (R$)', 'Líquido Lumen (R$)', 'Status'];
    const tot = C.round2(C.sum(rep.prem, liquidoOf));
    ui.drawer({ title: `Relatório · ${fmt.monthLong(rep.comp)}`, subtitle: `Disponível desde ${fmt.date(rep.relEm)} · total ${fmt.brl(tot)}`, icon: 'file-text', size: 'lg',
      body: h('div.stack',
        ui.table({ class: 'orig-dense', rows: rep.prem, rowKey: (p) => p.id, onRowClick: premioDrawer, empty: ui.empty({ icon: 'file-text', title: 'Sem linhas nesta competência', text: 'Nenhuma premiação foi apurada para este mês.' }), columns: [
          { key: 'ced', label: 'Indicado', render: (p) => h('strong.nowrap', (db.get('orgs', p.cedenteId) || {}).fantasia || '') },
          { key: 'sub', label: 'Subparceiro', mobile: 'hide', render: (p) => p.subId ? h('span.small', `${subNameOf(p.subId)} · ${p.splitPct || 0}%`) : h('span.muted.small', 'Direto') },
          { key: 'baseTS', label: 'Base TS', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.baseTS)) },
          { key: 'indicacao', label: '10%', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.indicacao)) },
          { key: 'gestao', label: '30%', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.gestao)) },
          { key: 'total', label: 'Total', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.total)) },
          { key: 'parteSub', label: 'Parte do sub', align: 'right', mobile: 'hide', render: (p) => (p.parteSub ? h('span.num', '−' + fmt.brl(p.parteSub)) : h('span.muted', '—')) },
          { key: 'liq', label: 'Líquido', align: 'right', render: (p) => h('strong.num', fmt.brl(liquidoOf(p))) },
          { key: 'status', label: 'Status', render: (p) => ui.status('premio', p.status) },
        ] }),
        h('div.row', ui.btn('Baixar CSV', { size: 'sm', icon: 'download', onclick: () => { downloadCSV(`cedy-premiacao-${rep.comp}.csv`, head, rows); ui.toast('CSV baixado', { type: 'success', text: `cedy-premiacao-${rep.comp}.csv` }); } }),
          ui.btn('Imprimir / PDF', { size: 'sm', variant: 'secondary', icon: 'printer', onclick: () => printReport(`Relatório de premiação · ${fmt.monthLong(rep.comp)}`, tbl.cloneNode(true)) }))),
    });
  }
  function rRelatorios(ctx) {
    if (isSub()) { ui.toast('Acesso restrito', { type: 'warn', text: 'Relatórios são da Lumen. Mostramos a sua comissão.' }); ctx.go('/originador/premiacao'); return h('div'); }
    const reps = compsWithVolume().slice().reverse();
    const faces = compsWithVolume();
    const cohort = {};
    indicatedOrgs().forEach((o) => { const fp = firstPaidOp(o.id); if (!fp) return; const c = compOf(fp.pagoEm); cohort[c] = cohort[c] || { n: 0, vol: 0 }; cohort[c].n++; cohort[c].vol = C.round2(cohort[c].vol + C.sum(paidOps(o.id), (x) => x.face)); });
    const cats = Object.keys(cohort).sort();
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Originador', title: 'Relatórios mensais', subtitle: 'O relatório de cada competência sai no 5º dia útil do mês seguinte. Antes disso, a competência atual fica bloqueada com a data de liberação.' }),
      ui.card({ title: 'Competências', subtitle: 'Toque em um mês liberado para ver o demonstrativo, baixar CSV ou imprimir.' },
        h('div.list', reps.map((r) => {
          const locked = now() < r.relEm;
          return h(locked ? 'div' : 'button', { type: locked ? undefined : 'button', class: ['list-item', !locked && 'clickable'], onclick: locked ? null : () => openReport(r) },
            h('span.tl-dot', { style: locked ? 'background:var(--surface-3);color:var(--ink-3)' : 'background:var(--green-tint);color:var(--green-ink)' }, icon(locked ? 'lock' : 'file-text', 14)),
            h('div.grow', h('strong', fmt.monthLong(r.comp)), h('div.small.muted', locked ? `Disponível em ${fmt.date(r.relEm)} (5º dia útil)` : `${fmt.plural(r.prem.length, 'linha', 'linhas')} · líquido ${fmt.brl(C.round2(C.sum(r.prem, liquidoOf)))}`)),
            locked ? h('span.small.muted', 'em apuração') : icon('chevron-right', 16));
        }))),
      h('div.grid.g2',
        ui.card({ title: 'Volume originado por mês', subtitle: 'Face das operações pagas dos indicados, em reais.' },
          ui.chart.bars({ categories: faces.map((r) => fmt.month(compOfEnd(r.comp))), series: [{ name: 'Volume', tone: 'blue', data: faces.map((r) => r.face) }], format: axisBrl, tipFormat: (v) => fmt.brl(v) })),
        ui.card({ title: 'TS gerada por mês', subtitle: 'Base da sua premiação, em reais.' },
          ui.chart.bars({ categories: faces.map((r) => fmt.month(compOfEnd(r.comp))), series: [{ name: 'TS', tone: 'teal', data: faces.map((r) => r.ts) }], format: axisBrl, tipFormat: (v) => fmt.brl(v) }))),
      ui.card({ class: 'orig-flat', title: 'Coorte por 1ª operação', subtitle: 'Indicados agrupados pelo mês em que a primeira operação foi paga.' },
        cats.length ? ui.table({ rows: cats.map((c) => ({ c, n: cohort[c].n, vol: cohort[c].vol })), rowKey: (r) => r.c, columns: [
          { key: 'c', label: 'Coorte', render: (r) => h('strong', fmt.monthLong(r.c)) },
          { key: 'n', label: 'Indicados', align: 'right', render: (r) => h('span.num', r.n) },
          { key: 'vol', label: 'Volume acumulado', align: 'right', render: (r) => h('strong.num', fmt.brl(r.vol)) },
        ] }) : ui.empty({ icon: 'users', title: 'Sem coortes', text: 'A coorte monta quando um indicado paga a primeira operação.' })),
    );
  }
  /* --------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/originador', roles: ['originador', 'subparceiro'], title: 'Início', render: rHome },
    { path: '/originador/indicados', roles: ['originador', 'subparceiro'], title: 'Carteira de indicados', render: rIndicados },
    { path: '/originador/indicados/:id', roles: ['originador', 'subparceiro'], title: 'Indicado', render: rIndicadoDetalhe },
    { path: '/originador/convites', roles: ['originador', 'subparceiro'], title: 'Convidar empresas', render: rConvites },
    { path: '/originador/premiacao', roles: ['originador', 'subparceiro'], title: 'Premiação', render: rPremiacao },
    { path: '/originador/relatorios', roles: ['originador', 'subparceiro'], title: 'Relatórios mensais', render: rRelatorios },
  ]);
})();
