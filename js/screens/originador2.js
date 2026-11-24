(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui;
  const { db, ledger, notify, session } = C.store; const E = C.engine; const cal = C.cal;
  const ORG = 'o-lumen';
  const now = () => C.clock.now();
  const DAY = 86400000;
  const compOf = (ts) => { const t = cal.sp(ts); return t.y + '-' + String(t.m).padStart(2, '0'); };
  const onlyDigits = (v) => String(v || '').replace(/\D/g, '');
  const daysAgo = (ts) => Math.max(0, Math.floor((now() - ts) / DAY));
  const isSub = () => { const u = session.user(); return !!(u && u.perfil === 'subparceiro'); };
  const mySubId = () => { const u = session.user(); return u ? u.subId : null; };
  const canOperar = () => C.can('convidar') || C.can('operar');
  function cnpjValido(v) {
    const d = onlyDigits(v); if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const dv = (base) => { let s = 0, w = 2; for (let i = base.length - 1; i >= 0; i--) { s += Number(base[i]) * w; w = w === 9 ? 2 : w + 1; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
  }
  function cpfValido(v) {
    const d = onlyDigits(v); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let s = 0; for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
    let r = (s * 10) % 11; if (r === 10) r = 0; if (r !== Number(d[9])) return false;
    s = 0; for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
    r = (s * 10) % 11; if (r === 10) r = 0; return r === Number(d[10]);
  }
  function paidOps(cedId) { return db.where('operacoes', (o) => o.cedenteId === cedId && o.pagoEm).sort((a, b) => a.pagoEm - b.pagoEm); }
  function vol30(cedId) { const c = now() - 30 * DAY; return C.round2(C.sum(paidOps(cedId).filter((o) => o.pagoEm >= c), (o) => o.face)); }
  function ts30(cedId) { const c = now() - 30 * DAY; return C.round2(C.sum(paidOps(cedId).filter((o) => o.pagoEm >= c), (o) => o.ts || 0)); }
  function myPremiacoes() { return db.where('premiacoes', (p) => p.origId === ORG).sort((a, b) => a.competencia < b.competencia ? 1 : -1); }
  function subList() { return db.where('subparceiros', (s) => s.origId === ORG).sort((a, b) => (b.ultimaAtividade || 0) - (a.ultimaAtividade || 0)); }
  function subOrgs(sid) { return db.where('orgs', (o) => o.subparceiroId === sid); }
  function subConvites(sid) { return db.where('convites', (c) => c.origId === ORG && c.subId === sid); }
  function subName(sid) { const s = sid && db.get('subparceiros', sid); return s ? s.nome : 'Direto Lumen'; }
  function repasseStatus(p) {
    if (!p.parteSub || p.parteSub <= 0) return 'nao_aplica';
    if (p.repasseSub && p.repasseSub.status === 'repassado') return 'repassado';
    return 'pendente';
  }
  function downloadCSV(name, head, rows) {
    const esc = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [head].concat(rows).map((r) => r.map(esc).join(';')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function printDoc(title, bodyNode) {
    const doc = h('div', { class: 'orig-print-doc' }, h('h1', 'Cedy · ' + title), h('p', 'Emitido em ' + fmt.datetime(now()) + ' · Lumen Consultoria'), bodyNode);
    document.body.appendChild(doc); document.body.classList.add('is-printing');
    const done = () => { document.body.classList.remove('is-printing'); doc.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(() => window.print(), 60); setTimeout(done, 4000);
  }

  /* ------------------------- convidar subparceiro ------------------------- */
  function openInviteModal(ctx, preset) {
    if (isSub()) { ui.toast('Sem permissão', { type: 'warn', text: 'O perfil subparceiro não gerencia subparceiros.' }); return; }
    if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    const tipoR = ui.radio({ value: (preset && preset.tipo) || 'PJ', layout: 'row', aria: 'Tipo de pessoa', options: [{ value: 'PJ', label: 'Pessoa jurídica' }, { value: 'PF', label: 'Pessoa física' }] });
    const nomeI = ui.input({ placeholder: 'Razão social ou nome completo' });
    const nomeF = ui.field({ label: 'Nome', required: true }, nomeI);
    const docOpts = { mask: 'cnpj', placeholder: '00.000.000/0000-00', inputmode: 'numeric' };
    const docI = ui.input(docOpts);
    const docF = ui.field({ label: 'CNPJ', required: true, hint: 'Validamos o dígito verificador na hora.' }, docI);
    const emailI = ui.input({ type: 'email', placeholder: 'contato@empresa.com.br' });
    const emailF = ui.field({ label: 'E-mail', required: true }, emailI);
    const telI = ui.input({ mask: 'phone', placeholder: '(11) 90000-0000' });
    const telF = ui.field({ label: 'Telefone', optional: true }, telI);
    const regI = ui.input({ placeholder: 'Sudeste · SP' });
    const regF = ui.field({ label: 'Região', optional: true, hint: 'Rótulo livre para organizar a rede.' }, regI);
    let split = 30;
    const prev = h('p.small', { style: 'margin:4px 0 0' });
    const drawPrev = () => { prev.textContent = 'De cada R$ 100 de premiação, R$ ' + split + ' ficam com o subparceiro e R$ ' + (100 - split) + ' com a Lumen.'; };
    const slider = ui.slider({ min: E.SPLIT_MIN || 10, max: E.SPLIT_MAX || 70, step: 1, value: split, aria: 'Percentual de repasse', format: (v) => v + '%', onChange: (v) => { split = v; drawPrev(); } });
    drawPrev();
    const splitF = h('div.field', h('label.field-label', 'Repasse (split) ', h('i.req', '*')), slider, prev, h('div.field-hint', 'Entre 10% e 70%. Vale para as próximas competências, nunca retroage.'));
    const contaI = ui.input({ placeholder: 'Banco, agência e conta para o demonstrativo' });
    const contaF = ui.field({ label: 'Conta de repasse', optional: true, hint: 'Informativo: a Cedy paga só a Lumen, o repasse é da Lumen.' }, contaI);
    const aceiteC = ui.checkbox({ label: 'O subparceiro aceitou os termos da subparceria (convite).' });
    tipoR.addEventListener('change', () => {
      const t = tipoR.value;
      docOpts.mask = t === 'PF' ? 'cpf' : 'cnpj';
      docI.value = ''; docF.setError('');
      docI.input.placeholder = t === 'PF' ? '000.000.000-00' : '00.000.000/0000-00';
      docF.querySelector('.field-label').childNodes[0].textContent = t === 'PF' ? 'CPF ' : 'CNPJ ';
    });
    const m = ui.modal({
      title: 'Convidar subparceiro', subtitle: 'Segundo nível: um nível só, sem sub do sub. O convite cria o cadastro como convidado.', icon: 'user-plus', size: 'md',
      body: h('div.stack.tight', h('div.grid.g2', nomeF, tipoR), h('div.grid.g2', docF, emailF), h('div.grid.g2', telF, regF), splitF, contaF, aceiteC,
        ui.callout({ tone: 'info', title: 'Regras do convite', text: 'Primeiro cadastro vence. A Cedy paga só a Lumen no dia 20 (mínimo R$ 100 no total da Lumen); o repasse ao subparceiro é responsabilidade da Lumen, com demonstrativo nesta tela. [INFERÊNCIA]' })),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }),
        ui.btn('Enviar convite', {
          variant: 'primary', icon: 'send', onclick: () => {
            let ok = true;
            const nome = nomeI.value.trim();
            nomeF.setError(nome.length < 3 ? 'Informe o nome do subparceiro.' : ''); if (nome.length < 3) ok = false;
            const tipo = tipoR.value;
            const docOk = tipo === 'PF' ? cpfValido(docI.value) : cnpjValido(docI.value);
            docF.setError(!docOk ? (tipo === 'PF' ? 'CPF inválido. Confira os 11 dígitos.' : 'CNPJ inválido. Confira os 14 dígitos.') : ''); if (!docOk) ok = false;
            const em = emailI.value.trim();
            const emOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em);
            emailF.setError(!emOk ? 'Informe um e-mail válido.' : ''); if (!emOk) ok = false;
            if (!aceiteC.value) { ui.toast('Falta o aceite', { type: 'warn', text: 'Confirme que o subparceiro aceitou os termos.' }); ok = false; }
            const dup = db.where('subparceiros', (s) => s.origId === ORG && onlyDigits(s.doc) === onlyDigits(docI.value))[0];
            if (dup) { docF.setError('Este documento já está na sua rede (' + dup.nome + ').'); ok = false; }
            if (!ok) return;
            const sp = db.put('subparceiros', {
              id: C.uid('sp'), origId: ORG, nome, tipo, doc: onlyDigits(docI.value), email: em,
              telefone: telI.value.trim() || null, regiao: regI.value.trim() || 'Sem região',
              status: 'convidado', splitPct: split, desde: now(), conviteEm: now(), ultimaAtividade: now(),
              observacao: '', historicoSplit: [{ ts: now(), de: null, para: split, por: session.user().id }], contaRepasse: contaI.value.trim() ? { banco: contaI.value.trim(), agencia: '', conta: '', titular: nome } : null,
            });
            ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.convidado', entidade: { kind: 'subparceiro', id: sp.id }, resumo: 'Convite enviado a ' + nome + ' (' + em + '), split ' + split + '%', classe: 'R2', detalhe: { splitPct: split } });
            ui.toast('Convite enviado', { type: 'success', text: nome + ' entrou como convidado. Simule o aceite para ativar.' });
            api.close(true);
            if (ctx && ctx.go) ctx.go('/originador/subparceiros/' + sp.id);
          },
        })],
    });
  }
  function simulateAccept(sp) {
    if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    db.batch(() => {
      db.patch('subparceiros', sp.id, { status: 'ativo', ultimaAtividade: now() });
      const exists = db.where('users', (u) => u.subId === sp.id)[0];
      if (!exists) {
        db.put('users', { id: C.uid('u-sub'), nome: sp.nome.split(' Ltda')[0].split(' S.A')[0].slice(0, 28), email: sp.email, cargo: 'Subparceiro', orgId: ORG, perfil: 'subparceiro', subId: sp.id, demo: false, twofa: true, hue: 95, ultimoAcesso: now(), telefone: sp.telefone || '' });
      }
    });
    ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.ativado', entidade: { kind: 'subparceiro', id: sp.id }, resumo: sp.nome + ' aceitou o convite e ativou o acesso (demonstração)', classe: 'R2' });
    notify.send({ to: { orgId: ORG }, tipo: 'sucesso', titulo: 'Subparceiro ativo', corpo: sp.nome + ' aceitou o convite.', link: '/originador/subparceiros/' + sp.id });
    ui.toast('Aceite simulado', { type: 'success', text: sp.nome + ' agora está ativo com acesso de subparceiro (demonstração).' });
  }

  /* ------------------------------ lista ---------------------------------- */
  function rSubs(ctx) {
    if (isSub()) { ui.toast('Acesso restrito', { type: 'warn', text: 'Subparceiros não acessam a rede. Mostramos só a sua comissão.' }); ctx.go('/originador/premiacao'); return h('div'); }
    let q = '', stf = 'todos', sortK = 'atividade';
    const wrap = h('div');
    function stats() {
      const subs = subList();
      const ativos = subs.filter((s) => s.status === 'ativo');
      const comp = compOf(now());
      const premMes = myPremiacoes().filter((p) => p.competencia === comp && p.subId);
      const gerada = C.round2(C.sum(premMes, (p) => p.total));
      const parteSub = C.round2(C.sum(premMes, (p) => p.parteSub || 0));
      const liquido = C.round2(C.sum(premMes, (p) => (p.parteOrig !== undefined ? p.parteOrig : p.total)));
      const pend = myPremiacoes().filter((p) => repasseStatus(p) === 'pendente').length;
      const indVia = db.where('orgs', (o) => o.indicadoPor === ORG && o.subparceiroId);
      return { subs, ativos, gerada, parteSub, liquido, pend, indVia };
    }
    function rows() {
      const comp = compOf(now());
      let list = subList().map((s) => {
        const orgs = subOrgs(s.id);
        const ativos = orgs.filter((o) => { const ops = paidOps(o.id); const lp = ops.length ? ops[ops.length - 1].pagoEm : null; return lp && (now() - lp) < db.cfg().inatividadeDias * DAY; });
        const v30 = C.round2(C.sum(orgs, (o) => vol30(o.id)));
        const ts30v = C.round2(C.sum(orgs, (o) => ts30(o.id)));
        const premMes = myPremiacoes().filter((p) => p.competencia === comp && p.subId === s.id);
        const parteMes = C.round2(C.sum(premMes, (p) => p.parteSub || 0));
        const pend = myPremiacoes().filter((p) => p.subId === s.id && repasseStatus(p) === 'pendente');
        return { s, orgs, ativos, v30, ts30v, parteMes, pend: pend.length, pendTotal: C.round2(C.sum(pend, (p) => p.parteSub || 0)) };
      });
      if (stf !== 'todos') list = list.filter((r) => r.s.status === stf);
      if (q) list = list.filter((r) => (r.s.nome + ' ' + (r.s.regiao || '') + ' ' + (r.s.email || '')).toLowerCase().includes(q));
      const key = { nome: (r) => r.s.nome, atividade: (r) => -(r.s.ultimaAtividade || 0), volume: (r) => -r.v30, split: (r) => -r.s.splitPct, repasse: (r) => -r.pendTotal }[sortK] || ((r) => -(r.s.ultimaAtividade || 0));
      return list.sort((a, b) => { const x = key(a), y = key(b); return x > y ? 1 : x < y ? -1 : 0; });
    }
    function draw() {
      C.clear(wrap);
      const list = rows();
      if (!subList().length) {
        wrap.append(ui.empty({ icon: 'network', title: 'Nenhum subparceiro ainda', text: 'Convide um parceiro de segundo nível para ampliar a rede. O split fica entre 10% e 70% e só vale para as próximas competências.', action: ui.btn('Convidar subparceiro', { variant: 'primary', icon: 'user-plus', onclick: () => openInviteModal(ctx) }) }));
        return;
      }
      const tbl = ui.table({
        rows: list, rowKey: (r) => r.s.id, onRowClick: (r) => ctx.go('/originador/subparceiros/' + r.s.id),
        empty: ui.empty({ icon: 'search', title: 'Nenhum subparceiro encontrado', text: 'Ajuste a busca ou o filtro de status.', action: ui.btn('Limpar filtros', { icon: 'x', onclick: () => { q = ''; stf = 'todos'; search.value = ''; stSel.value = 'todos'; draw(); } }) }),
        columns: [
          { key: 'nome', label: 'Subparceiro', width: '26%', mobile: 'primary', sort: (a, b) => a.s.nome.localeCompare(b.s.nome), render: (r) => h('div.cell-row', ui.avatar(r.s.nome, { size: 'sm', square: true }), h('div.cell-main', h('strong', r.s.nome), h('small', h('span.badge.badge-neutral', r.s.tipo), ' · ' + (r.s.regiao || 'Sem região')))) },
          { key: 'status', label: 'Status', render: (r) => { const m = { ativo: ['Ativo', 'green'], convidado: ['Convidado', 'neutral'], suspenso: ['Suspenso', 'amber'], encerrado: ['Encerrado', 'neutral'] }[r.s.status] || [r.s.status, 'neutral']; return ui.badge(m[0], m[1], { dot: true }); } },
          { key: 'ind', label: 'Indicados ativos', align: 'right', mobile: 'hide', render: (r) => h('span.num', r.ativos.length + '/' + r.orgs.length) },
          { key: 'vol', label: 'Volume 30d', align: 'right', mobile: 'hide', sort: (a, b) => a.v30 - b.v30, render: (r) => h('span.num.nowrap', { style: 'font-weight:650' }, fmt.brlCompact(r.v30)) },
          { key: 'ts', label: 'TS gerada 30d', align: 'right', mobile: 'hide', render: (r) => h('span.num.nowrap', fmt.brlCompact(r.ts30v)) },
          { key: 'split', label: 'Split', align: 'right', sort: (a, b) => a.s.splitPct - b.s.splitPct, render: (r) => h('strong.num.nowrap', r.s.splitPct + '%') },
          { key: 'parte', label: 'Parte do sub no mês', align: 'right', render: (r) => h('span.num.nowrap', fmt.brl(r.parteMes)) },
          {
            key: 'repasse', label: 'Repasse pendente', align: 'right', render: (r) => r.pend ? h('span.num.nowrap', { style: 'font-weight:650;color:var(--amber-ink)' }, fmt.brl(r.pendTotal) + ' (' + r.pend + ')') : h('span.muted', '—'),
          },
          {
            key: 'atividade', label: 'Última atividade', align: 'right', sort: (a, b) => (a.s.ultimaAtividade || 0) - (b.s.ultimaAtividade || 0), render: (r) => {
              if (!r.s.ultimaAtividade) return h('span.muted', '—');
              const d = daysAgo(r.s.ultimaAtividade);
              const txt = d === 0 ? 'hoje' : d === 1 ? 'há 1 dia' : 'há ' + d + ' dias';
              const cls = d >= 90 ? 'orig-inat' : d >= 60 ? 'orig-warn' : '';
              return h('span.nowrap', { class: cls }, d >= 90 ? 'inativo ' + txt : txt);
            },
          },
          {
            key: 'acoes', label: '', align: 'right', render: (r) => ui.moreMenu([
              { label: 'Ver', icon: 'eye', onclick: () => ctx.go('/originador/subparceiros/' + r.s.id) },
              { label: 'Editar split', icon: 'percent', onclick: () => ctx.go('/originador/subparceiros/' + r.s.id + '?aba=condicoes') },
              r.s.status === 'convidado' ? { label: 'Reenviar convite', icon: 'send', onclick: () => resendSub(r.s) } : null,
              r.s.status === 'convidado' ? { label: 'Simular aceite (demonstração)', icon: 'check', onclick: () => simulateAccept(r.s) } : null,
              r.s.status === 'ativo' ? { label: 'Suspender', icon: 'pause', onclick: () => setStatus(r.s, 'suspenso') } : null,
              r.s.status === 'suspenso' ? { label: 'Reativar', icon: 'play', onclick: () => setStatus(r.s, 'ativo') } : null,
              !['encerrado'].includes(r.s.status) ? { label: 'Encerrar', icon: 'x', danger: true, onclick: () => encerrarSub(ctx, r.s) } : null,
            ].filter(Boolean)),
          },
        ],
      });
      wrap.append(ui.card({ flush: true, class: 'orig-tblcard' }, tbl));
    }
    function setStatus(s, st) {
      if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
      ui.confirm({ title: st === 'ativo' ? 'Reativar subparceiro?' : 'Suspender subparceiro?', text: s.nome + (st === 'ativo' ? ' volta a pontuar split nas próximas competências.' : ' deixa de pontuar split enquanto durar a suspensão.'), tone: st === 'ativo' ? 'primary' : 'danger', confirmLabel: st === 'ativo' ? 'Reativar' : 'Suspender' }).then((ok) => {
        if (!ok) return;
        db.patch('subparceiros', s.id, { status: st, ultimaAtividade: now() });
        ledger.append({ actor: E.actors.user(session.user().id), acao: st === 'ativo' ? 'subparceiro.reativado' : 'subparceiro.suspenso', entidade: { kind: 'subparceiro', id: s.id }, resumo: s.nome + (st === 'ativo' ? ' reativado' : ' suspenso'), classe: 'R2' });
        ui.toast(st === 'ativo' ? 'Subparceiro reativado' : 'Subparceiro suspenso', { type: 'success' });
      });
    }
    const search = ui.search({ placeholder: 'Buscar por nome, região ou e-mail', onInput: (v) => { q = v.toLowerCase(); draw(); } });
    const stSel = ui.select({ value: stf, aria: 'Filtrar por status', options: [{ value: 'todos', label: 'Todos os status' }, { value: 'ativo', label: 'Ativos' }, { value: 'convidado', label: 'Convidados' }, { value: 'suspenso', label: 'Suspensos' }, { value: 'encerrado', label: 'Encerrados' }], onChange: (v) => { stf = v; draw(); } });
    const sortSel = ui.select({ value: sortK, aria: 'Ordenar', options: [{ value: 'atividade', label: 'Última atividade' }, { value: 'nome', label: 'Nome (A-Z)' }, { value: 'volume', label: 'Maior volume 30d' }, { value: 'split', label: 'Maior split' }, { value: 'repasse', label: 'Maior repasse pendente' }], onChange: (v) => { sortK = v; draw(); } });
    draw();
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Originador · Rede', title: 'Subparceiros', subtitle: 'Segundo nível da sua rede: um nível só, split de 10% a 70% congelado por competência.', actions: [ui.btn('Convidar subparceiro', { variant: 'primary', icon: 'user-plus', onclick: () => openInviteModal(ctx) })] }),
      ui.live(['subparceiros', 'premiacoes', 'orgs', 'operacoes'], () => {
        const s = stats();
        return h('div.grid.g4.keep2',
          ui.kpi({ label: 'Subparceiros ativos', value: s.ativos.length, icon: 'network', tone: 'green', hint: s.subs.length + ' no total' }),
          ui.kpi({ label: 'Indicados via subparceiros', value: s.indVia.length, icon: 'users', tone: 'blue' }),
          ui.kpi({ label: 'Premiação da rede no mês', value: Math.round(s.gerada), fmt: 'brl', icon: 'award', tone: 'amber', hint: 'Total apurado com subparceiro' }),
          ui.kpi({ label: 'Repasses pendentes', value: s.pend, icon: 'hand-coins', tone: 'amber', hint: 'Competências a repassar' }));
      }),
      ui.live(['subparceiros', 'premiacoes', 'orgs', 'operacoes'], () => {
        const s = stats();
        return ui.card({ title: 'Composição do mês', subtitle: 'Parte dos subparceiros, líquido da Lumen e pendências.' },
          h('div.grid.g3', ui.kpi({ label: 'Parte dos subparceiros', value: Math.round(s.parteSub), fmt: 'brl', icon: 'users' }), ui.kpi({ label: 'Líquido da Lumen', value: Math.round(s.liquido), fmt: 'brl', icon: 'hand-coins', tone: 'green' }), ui.kpi({ label: 'Indicados diretos x rede', value: s.indVia.length, icon: 'building-2', hint: db.where('orgs', (o) => o.indicadoPor === ORG && !o.subparceiroId).length + ' diretos' })));
      }),
      ui.toolbar(search, stSel, sortSel),
      wrap,
      ui.card({ title: 'Regras da rede', subtitle: 'O que vale para todo subparceiro.' }, h('div.list',
        h('div.list-item', h('span.tl-dot', icon('network', 14)), h('div.grow', h('strong', 'Um nível só'), h('div.small.muted', 'Subparceiro não tem subparceiro. O vínculo é direto com a Lumen.'))),
        h('div.list-item', h('span.tl-dot', icon('hash', 14)), h('div.grow', h('strong', 'Split de 10% a 70%'), h('div.small.muted', 'Congelado por competência na apuração. Mudança só vale para as próximas competências.'))),
        h('div.list-item', h('span.tl-dot', icon('hand-coins', 14)), h('div.grow', h('strong', 'Repasse é da Lumen [INFERÊNCIA]'), h('div.small.muted', 'A Cedy paga só a Lumen no dia 20, mínimo R$ 100 no total. O app gera o demonstrativo e controla o repassado.'))),
        h('div.list-item', h('span.tl-dot', icon('flag', 14)), h('div.grow', h('strong', 'Primeiro cadastro vence'), h('div.small.muted', 'Indicado já registrado mantém o dono original.'))),
        h('div.list-item', h('span.tl-dot', icon('eye', 14)), h('div.grow', h('strong', 'O que o subparceiro vê'), h('div.small.muted', 'Só os próprios indicados, sem TS, sem financeiro e sem dados de outros subparceiros.'))))));
  }
  function resendSub(s) {
    if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    db.patch('subparceiros', s.id, { conviteEm: now(), ultimaAtividade: now() });
    ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.convite_reenviado', entidade: { kind: 'subparceiro', id: s.id }, resumo: 'Convite reenviado a ' + s.nome, classe: 'R1' });
    ui.toast('Convite reenviado', { type: 'success', text: 'Novo contato enviado a ' + s.email + '.' });
  }
  function encerrarSub(ctx, s) {
    if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
    const nomeI = ui.input({ placeholder: 'Digite o nome para confirmar' });
    const nomeF = ui.field({ label: 'Confirmação', required: true, hint: 'Digite "' + s.nome + '" para encerrar. Os indicados ficam com a Lumen.' }, nomeI);
    const m = ui.modal({
      title: 'Encerrar subparceiro', subtitle: s.nome, icon: 'triangle-alert', tone: 'red',
      body: h('div.stack.tight', ui.callout({ tone: 'warn', title: 'Ação definitiva', text: 'Os indicados dele continuam com a Lumen (limpamos o vínculo). O split congela nas competências já apuradas.' }), nomeF),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Encerrar', {
        variant: 'danger', onclick: () => {
          if (nomeI.value.trim() !== s.nome) { nomeF.setError('Digite exatamente "' + s.nome + '".'); return; }
          db.batch(() => {
            db.patch('subparceiros', s.id, { status: 'encerrado', ultimaAtividade: now() });
            subOrgs(s.id).forEach((o) => db.patch('orgs', o.id, { subparceiroId: null }));
            db.where('convites', (c) => c.subId === s.id && c.status === 'convidado').forEach((c) => db.patch('convites', c.id, { subId: null }));
          });
          ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.encerrado', entidade: { kind: 'subparceiro', id: s.id }, resumo: s.nome + ' encerrado; indicados mantidos com a Lumen', classe: 'R2' });
          ui.toast('Subparceiro encerrado', { type: 'success', text: 'Os indicados foram mantidos com a Lumen.' });
          api.close(true); ctx.go('/originador/subparceiros');
        },
      })],
    });
  }

  /* ------------------------------ detalhe -------------------------------- */
  function rSubDetalhe(ctx) {
    if (isSub()) { ui.toast('Acesso restrito', { type: 'warn', text: 'Subparceiros não acessam a rede.' }); ctx.go('/originador/premiacao'); return h('div'); }
    const id = ctx.params.id;
    const s = db.get('subparceiros', id);
    if (!s || s.origId !== ORG) {
      return h('div.stack', ui.pageHeader({ eyebrow: 'Subparceiro', back: '/originador/subparceiros', title: 'Subparceiro não encontrado', subtitle: 'O vínculo pode ter sido movido ou o link está errado.' }),
        ui.empty({ icon: 'search', title: 'Nada aqui', text: 'Este subparceiro não existe na sua rede.', action: ui.btn('Voltar para a rede', { onclick: () => ctx.go('/originador/subparceiros') }) }));
    }
    const aba = ctx.query.aba || 'visao';
    const tabs = ui.tabs({ value: aba, onChange: (v) => ctx.go('/originador/subparceiros/' + s.id + (v === 'visao' ? '' : '?aba=' + v)), items: [{ id: 'visao', label: 'Visão geral', icon: 'house' }, { id: 'indicados', label: 'Indicados', icon: 'users' }, { id: 'comissao', label: 'Comissão', icon: 'hand-coins' }, { id: 'condicoes', label: 'Condições', icon: 'file-text' }, { id: 'acesso', label: 'Acesso', icon: 'key-round' }, { id: 'atividade', label: 'Atividade', icon: 'history' }] });
    function headerActions() {
      const out = [];
      if (s.status === 'convidado') out.push(ui.btn('Simular aceite (demonstração)', { variant: 'secondary', icon: 'check', onclick: () => simulateAccept(s) }));
      if (s.status === 'ativo') out.push(ui.btn('Suspender', { variant: 'secondary', icon: 'pause', onclick: () => { db.patch('subparceiros', s.id, { status: 'suspenso', ultimaAtividade: now() }); ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.suspenso', entidade: { kind: 'subparceiro', id: s.id }, resumo: s.nome + ' suspenso', classe: 'R2' }); } }));
      if (s.status === 'suspenso') out.push(ui.btn('Reativar', { variant: 'primary', icon: 'play', onclick: () => { db.patch('subparceiros', s.id, { status: 'ativo', ultimaAtividade: now() }); ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.reativado', entidade: { kind: 'subparceiro', id: s.id }, resumo: s.nome + ' reativado', classe: 'R2' }); } }));
      if (s.status !== 'encerrado') out.push(ui.btn('Encerrar', { variant: 'danger', icon: 'x', onclick: () => encerrarSub(ctx, s) }));
      return out;
    }
    return h('div.stack',
      ui.pageHeader({ eyebrow: 'Subparceiro · ' + s.regiao, back: '/originador/subparceiros', title: s.nome, subtitle: s.tipo + ' · split ' + s.splitPct + '% · ' + s.email, actions: headerActions() }),
      tabs,
      ui.live(['subparceiros', 'premiacoes', 'orgs', 'operacoes', 'convites', 'ledger', 'users'], () => {
        const cur = db.get('subparceiros', s.id);
        if (aba === 'indicados') return tabIndicados(ctx, cur);
        if (aba === 'comissao') return tabComissao(ctx, cur);
        if (aba === 'condicoes') return tabCondicoes(ctx, cur);
        if (aba === 'acesso') return tabAcesso(ctx, cur);
        if (aba === 'atividade') return tabAtividade(cur);
        return tabVisao(ctx, cur);
      }));
  }
  function orgFunnel(orgs) {
    const st = (o) => {
      const ops = paidOps(o.id);
      if (o.status !== 'ativo') return 'kyc';
      if (!ops.length) return 'cadastrado';
      const lp = ops[ops.length - 1].pagoEm;
      return (now() - lp) >= db.cfg().inatividadeDias * DAY ? 'inativo' : 'ativo';
    };
    const f = { convidado: 0, cadastrado: 0, kyc: 0, ativo: 0, inativo: 0 };
    orgs.forEach((o) => { f[st(o)] = (f[st(o)] || 0) + 1; });
    return f;
  }
  function tabVisao(ctx, s) {
    const orgs = subOrgs(s.id);
    const v30 = C.round2(C.sum(orgs, (o) => vol30(o.id)));
    const comp = compOf(now());
    const premMes = myPremiacoes().filter((p) => p.competencia === comp && p.subId === s.id);
    const parteMes = C.round2(C.sum(premMes, (p) => p.parteSub || 0));
    const pend = myPremiacoes().filter((p) => p.subId === s.id && repasseStatus(p) === 'pendente');
    const f = orgFunnel(orgs);
    const cats = []; { const t = cal.sp(now()); for (let i = 5; i >= 0; i--) { let m = t.m - i, y = t.y; while (m < 1) { m += 12; y--; } cats.push(y + '-' + String(m).padStart(2, '0')); } }
    const per = cats.map((c) => ({ c, v: C.round2(C.sum(myPremiacoes().filter((p) => p.competencia === c && p.subId === s.id), (p) => p.total)) }));
    const inat = orgs.filter((o) => { const ops = paidOps(o.id); if (!ops.length) return false; return (now() - ops[ops.length - 1].pagoEm) >= 60 * DAY; });
    return h('div.stack',
      h('div.grid.g4.keep2',
        ui.kpi({ label: 'Indicados', value: orgs.length, icon: 'users' }),
        ui.kpi({ label: 'Volume 30d', value: Math.round(v30), fmt: 'brl', icon: 'trending-up' }),
        ui.kpi({ label: 'Comissão do sub no mês', value: Math.round(parteMes), fmt: 'brl', icon: 'hand-coins', tone: 'amber', hint: 'Split ' + s.splitPct + '%' }),
        ui.kpi({ label: 'Repasses pendentes', value: pend.length, icon: 'flag', tone: pend.length ? 'amber' : 'green' })),
      h('div.grid.g-main-side',
        h('div.stack',
          ui.card({ title: 'Comissão por mês', subtitle: 'Total apurado com este subparceiro, em reais.' }, ui.chart.bars({ categories: cats.map((c) => { const [yy, mm] = c.split('-').map(Number); return fmt.month(cal.spTs(yy, mm, 15, 12, 0)); }), series: [{ name: 'Comissão', tone: 'amber', data: per.map((p) => p.v) }], format: (v) => (v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : String(v)), tipFormat: (v) => fmt.brl(v) })),
          ui.card({ title: 'Funil dos indicados dele', subtitle: 'Do cadastro à atividade.' }, h('div.grid.g4.keep2', ui.kpi({ label: 'Ativos', value: f.ativo, icon: 'circle-check', tone: 'green' }), ui.kpi({ label: 'Cadastrados', value: f.cadastrado, icon: 'users' }), ui.kpi({ label: 'KYC', value: f.kyc, icon: 'scan-line' }), ui.kpi({ label: 'Inativos', value: f.inativo, icon: 'timer', tone: 'red' })))),
        h('div.stack',
          ui.card({ title: 'Alertas', subtitle: 'Inatividade e pendências.' }, inat.length || pend.length ? h('div.list', inat.slice(0, 4).map((o) => h('div.list-item', h('span.tl-dot', { style: 'background:var(--amber-tint);color:var(--amber-ink)' }, icon('timer', 14)), h('div.grow', h('strong', o.fantasia || o.nome), h('div.small.muted', 'Sem operação paga há ' + daysAgo(paidOps(o.id).slice(-1)[0].pagoEm) + ' dias.')))), pend.length ? h('div.list-item', h('span.tl-dot', { style: 'background:var(--blue-tint);color:var(--blue-ink)' }, icon('hand-coins', 14)), h('div.grow', h('strong', 'Repasse pendente'), h('div.small.muted', pend.length + ' competências aguardando marcação.')), ui.btn('Ver comissão', { size: 'sm', onclick: () => ctx.go('/originador/subparceiros/' + s.id + '?aba=comissao') })) : null) : ui.empty({ icon: 'circle-check', title: 'Tudo em dia', text: 'Sem alertas para este subparceiro.' })),
          ui.kv([['Status', s.status], ['Split atual', s.splitPct + '%'], ['Desde', fmt.date(s.desde)], ['Última atividade', s.ultimaAtividade ? fmt.rel(s.ultimaAtividade) : '—'], ['Conta de repasse', s.contaRepasse ? (s.contaRepasse.banco + ' ' + (s.contaRepasse.conta || '')) : 'Não informada']]))));
  }
  function tabIndicados(ctx, s) {
    const orgs = subOrgs(s.id);
    const convs = subConvites(s.id).filter((c) => !c.orgId);
    function doAssign() {
      if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
      const livres = db.where('orgs', (o) => o.indicadoPor === ORG && !o.subparceiroId);
      if (!livres.length) { ui.toast('Nada para atribuir', { type: 'info', text: 'Todos os indicados já têm subparceiro ou são diretos mantidos.' }); return; }
      const sel = ui.select({ value: livres[0].id, aria: 'Indicado para atribuir', options: livres.map((o) => ({ value: o.id, label: o.fantasia || o.nome, hint: fmt.brlCompact(vol30(o.id)) + ' em 30d' })) });
      const m = ui.modal({
        title: 'Atribuir indicado', subtitle: 'Vínculo com ' + s.nome, icon: 'users',
        body: h('div.stack.tight', ui.field({ label: 'Indicado direto da Lumen', required: true }, sel), ui.callout({ tone: 'info', title: 'Primeiro cadastro vence', text: 'O indicado mantém o histórico. A atribuição só muda o split das próximas competências.' })),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Atribuir', {
          variant: 'primary', onclick: () => {
            const o = db.get('orgs', sel.value);
            if (o && o.subparceiroId && o.subparceiroId !== s.id) {
              ui.confirm({ title: 'Reatribuir indicado?', text: (o.fantasia || o.nome) + ' está com ' + subName(o.subparceiroId) + '. A mudança vale para as próximas competências.', tone: 'warn', confirmLabel: 'Reatribuir' }).then((ok) => { if (!ok) return; db.patch('orgs', o.id, { subparceiroId: s.id }); db.where('convites', (c) => c.orgId === o.id).forEach((c) => db.patch('convites', c.id, { subId: s.id })); ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.indicado_reatribuido', entidade: { kind: 'org', id: o.id }, resumo: (o.fantasia || o.nome) + ' reatribuído a ' + s.nome, classe: 'R2' }); ui.toast('Indicado reatribuído', { type: 'success' }); api.close(true); });
              return;
            }
            db.patch('orgs', o.id, { subparceiroId: s.id });
            db.where('convites', (c) => c.orgId === o.id).forEach((c) => db.patch('convites', c.id, { subId: s.id }));
            ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.indicado_atribuido', entidade: { kind: 'org', id: o.id }, resumo: (o.fantasia || o.nome) + ' atribuído a ' + s.nome, classe: 'R2' });
            ui.toast('Indicado atribuído', { type: 'success', text: (o.fantasia || o.nome) + ' agora pontua para ' + s.nome + '.' });
            api.close(true);
          },
        })],
      });
    }
    function unassign(o) {
      if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
      ui.confirm({ title: 'Remover atribuição?', text: (o.fantasia || o.nome) + ' volta a ser direto da Lumen. Vale para as próximas competências.', confirmLabel: 'Remover' }).then((ok) => {
        if (!ok) return;
        db.patch('orgs', o.id, { subparceiroId: null });
        ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.indicado_removido', entidade: { kind: 'org', id: o.id }, resumo: (o.fantasia || o.nome) + ' removido de ' + s.nome, classe: 'R2' });
        ui.toast('Atribuição removida', { type: 'success' });
      });
    }
    return h('div.stack',
      ui.card({ title: 'Indicados de ' + s.nome, subtitle: 'Você vê volumes e status, sem dados bancários ou documentos.', actions: [ui.btn('Atribuir indicado', { variant: 'primary', size: 'sm', icon: 'plus', onclick: doAssign })] },
        orgs.length ? ui.table({
          rows: orgs, rowKey: (o) => o.id, onRowClick: (o) => ctx.go('/originador/indicados/' + o.id),
          columns: [
            { key: 'nome', label: 'Empresa', mobile: 'primary', render: (o) => h('div.cell-row', ui.avatar(o.fantasia || o.nome, { size: 'sm', square: true }), h('div.cell-main', h('strong', o.fantasia || o.nome), h('small', (o.cidade || '') + '/' + (o.uf || '')))) },
            { key: 'vol', label: 'Volume 30d', align: 'right', render: (o) => h('span.num', fmt.brlCompact(vol30(o.id))) },
            { key: 'ops', label: 'Operações pagas', align: 'right', render: (o) => h('span.num', paidOps(o.id).length) },
            { key: 'acao', label: '', align: 'right', render: (o) => ui.btn('Remover', { size: 'sm', variant: 'ghost', onclick: (ev) => { ev.stopPropagation(); unassign(o); } }) },
          ],
        }) : ui.empty({ icon: 'users', title: 'Sem indicados vinculados', text: 'Atribua um indicado direto da Lumen para este subparceiro.', action: ui.btn('Atribuir indicado', { variant: 'primary', icon: 'plus', onclick: doAssign }) })),
      convs.length ? ui.card({ title: 'Convites pendentes via ' + s.nome, subtitle: 'Aguardando cadastro.' }, ui.table({ rows: convs, rowKey: (c) => c.id, columns: [{ key: 'nome', label: 'Empresa', render: (c) => h('strong', c.nome) }, { key: 'status', label: 'Status', render: (c) => ui.status('convite', c.status) }, { key: 'env', label: 'Enviado em', align: 'right', render: (c) => h('span.small', fmt.date(c.enviadoEm)) }] })) : null);
  }
  function tabComissao(ctx, s) {
    const rows = myPremiacoes().filter((p) => p.subId === s.id).sort((a, b) => a.competencia < b.competencia ? 1 : -1);
    const totSub = C.round2(C.sum(rows, (p) => p.parteSub || 0));
    const pend = rows.filter((p) => repasseStatus(p) === 'pendente');
    function markPaid(p) {
      if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
      let dt = now(); let comprovante = null;
      const dateC = ui.date({ value: dt, aria: 'Data do repasse', onChange: (v) => { dt = v || now(); } });
      const dz = ui.dropzone({ label: 'Anexar comprovante (opcional)', hint: 'Fica registrado na trilha.', onFiles: (f) => { comprovante = f[0] ? f[0].name : null; ui.toast('Anexo recebido', { type: 'success', text: comprovante }); } });
      const m = ui.modal({
        title: 'Marcar como repassado', subtitle: fmt.monthLong(p.competencia) + ' · ' + fmt.brl(p.parteSub), icon: 'hand-coins',
        body: h('div.stack.tight', ui.field({ label: 'Data do repasse', required: true }, dateC), dz),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Confirmar repasse', {
          variant: 'primary', onclick: () => {
            db.patch('premiacoes', p.id, { repasseSub: { status: 'repassado', em: dt, por: session.user().id, comprovante } });
            ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.repasse_marcado', entidade: { kind: 'premiacao', id: p.id }, resumo: 'Repasse de ' + fmt.brl(p.parteSub) + ' (' + fmt.monthLong(p.competencia) + ') marcado como repassado a ' + s.nome, classe: 'R2', detalhe: { comprovante } });
            ui.toast('Repasse marcado', { type: 'success', text: 'Competência ' + fmt.monthLong(p.competencia) + ' registrada como repassada.' });
            api.close(true);
          },
        })],
      });
    }
    function demonstrativo(p) {
      const ced = db.get('orgs', p.cedenteId) || {};
      return { ced, head: ['Competência', 'Indicado', 'Base TS (R$)', 'Premiação total (R$)', 'Split congelado (%)', 'Parte do subparceiro (R$)', 'Status do repasse'], row: [fmt.monthLong(p.competencia), ced.fantasia || ced.nome || '', (p.baseTS || 0).toFixed(2).replace('.', ','), (p.total || 0).toFixed(2).replace('.', ','), String(p.splitPct || 0), (p.parteSub || 0).toFixed(2).replace('.', ','), p.repasseSub && p.repasseSub.status === 'repassado' ? 'repassado em ' + fmt.date(p.repasseSub.em) : 'pendente'] };
    }
    return h('div.stack',
      h('div.grid.g3.keep2', ui.kpi({ label: 'Comissão acumulada', value: Math.round(totSub), fmt: 'brl', icon: 'hand-coins', tone: 'amber' }), ui.kpi({ label: 'Competências', value: rows.length, icon: 'file-text' }), ui.kpi({ label: 'Repasses pendentes', value: pend.length, icon: 'flag', tone: pend.length ? 'amber' : 'green' })),
      ui.card({ title: 'Extrato por competência', subtitle: 'Split congelado na apuração. Mudança de split nunca retroage.' },
        rows.length ? ui.table({
          rows, rowKey: (p) => p.id,
          columns: [
            { key: 'comp', label: 'Competência', mobile: 'primary', render: (p) => h('div', h('strong.nowrap', fmt.monthLong(p.competencia)), h('div.small.muted', (db.get('orgs', p.cedenteId) || {}).fantasia || '')) },
            { key: 'total', label: 'Premiação', align: 'right', mobile: 'hide', render: (p) => h('span.num', fmt.brl(p.total)) },
            { key: 'split', label: 'Split', align: 'right', render: (p) => h('span.num', (p.splitPct || 0) + '%') },
            { key: 'parte', label: 'Parte do sub', align: 'right', render: (p) => h('strong.num', fmt.brl(p.parteSub || 0)) },
            { key: 'rep', label: 'Repasse', render: (p) => repasseStatus(p) === 'repassado' ? ui.badge('Repassado', 'green', { dot: true }) : repasseStatus(p) === 'pendente' ? ui.badge('Pendente', 'amber', { dot: true }) : h('span.muted', '—') },
            {
              key: 'acao', label: '', align: 'right', render: (p) => h('div.orig-actions',
                repasseStatus(p) === 'pendente' ? ui.btn('Marcar repassado', { size: 'sm', onclick: () => markPaid(p) }) : h('span.small.muted', p.repasseSub && p.repasseSub.em ? fmt.date(p.repasseSub.em) : ''),
                ui.moreMenu([
                  { label: 'Baixar demonstrativo (CSV)', icon: 'download', onclick: () => { const d = demonstrativo(p); downloadCSV('demonstrativo-' + s.id + '-' + p.competencia + '.csv', d.head, [d.row]); ui.toast('CSV baixado', { type: 'success' }); } },
                  { label: 'Imprimir demonstrativo', icon: 'printer', onclick: () => { const d = demonstrativo(p); printDoc('Demonstrativo de repasse · ' + fmt.monthLong(p.competencia), h('table', { class: 'orig-print-tbl' }, h('tbody', d.head.map((hh, i) => h('tr', h('th', hh), h('td', d.row[i])))))); } },
                ])),
            },
          ],
        }) : ui.empty({ icon: 'hand-coins', title: 'Sem comissão ainda', text: 'A comissão aparece após a primeira apuração com indicados deste subparceiro.' })));
  }
  function tabCondicoes(ctx, s) {
    let novo = s.splitPct; let motivo = '';
    const prev = h('p.small');
    const draw = () => { prev.textContent = 'De cada R$ 100 de premiação, R$ ' + novo + ' ficam com o subparceiro. Vale só para competências futuras.'; };
    const slider = ui.slider({ min: E.SPLIT_MIN || 10, max: E.SPLIT_MAX || 70, step: 1, value: novo, aria: 'Novo split', format: (v) => v + '%', onChange: (v) => { novo = v; draw(); } });
    draw();
    const motivoI = ui.input({ type: 'textarea', rows: 2, placeholder: 'Motivo da mudança (vai para a trilha).' });
    const hist = (s.historicoSplit || []).slice().reverse();
    const last3 = myPremiacoes().filter((p) => p.subId === s.id).slice(0, 3);
    const simBase = C.round2(C.sum(last3, (p) => p.total) / Math.max(1, last3.length));
    function save() {
      if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
      motivo = motivoI.value.trim();
      if (novo === s.splitPct) { ui.toast('Sem mudança', { type: 'info', text: 'O split já é ' + s.splitPct + '%.' }); return; }
      if (motivo.length < 10) { ui.toast('Explique o motivo', { type: 'warn', text: 'Mínimo de 10 caracteres para a trilha.' }); return; }
      const de = s.splitPct;
      db.patch('subparceiros', s.id, { splitPct: novo, ultimaAtividade: now(), historicoSplit: (s.historicoSplit || []).concat([{ ts: now(), de, para: novo, por: session.user().id, motivo }]) });
      ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.split_alterado', entidade: { kind: 'subparceiro', id: s.id }, resumo: 'Repasse de ' + s.nome + ' ajustado de ' + de + '% para ' + novo + '%: ' + motivo, classe: 'R2', detalhe: { de, para: novo } });
      ui.toast('Split atualizado', { type: 'success', text: 'De ' + de + '% para ' + novo + '%. Vale para as próximas competências.' });
    }
    return h('div.stack',
      ui.card({ title: 'Split atual: ' + s.splitPct + '%', subtitle: 'Congelado por competência na apuração. A mudança nunca retroage.', actions: [ui.btn('Salvar novo split', { variant: 'primary', icon: 'check', onclick: save })] },
        h('div.stack.tight', slider, prev, ui.field({ label: 'Motivo da mudança', required: true, hint: 'Mínimo de 10 caracteres.' }, motivoI),
          h('p.small.muted', 'Simulação com a média das últimas ' + last3.length + ' competências (' + fmt.brl(simBase) + '): a parte do sub iria de ' + fmt.brl(simBase * s.splitPct / 100) + ' para ' + fmt.brl(simBase * novo / 100) + ' por competência.'))),
      ui.card({ title: 'Histórico de splits', subtitle: 'Quem mudou, quando e por quê.' }, hist.length ? ui.table({ rows: hist, rowKey: (x, i) => i + '-' + x.ts, columns: [{ key: 'ts', label: 'Quando', render: (x) => h('span.small', fmt.datetime(x.ts)) }, { key: 'mud', label: 'Mudança', render: (x) => h('span', (x.de === null ? 'início ' : x.de + '% → ') + x.para + '%') }, { key: 'por', label: 'Por', render: (x) => h('span.small', (db.get('users', x.por) || {}).nome || x.por) }] }) : h('p.small.muted', 'Sem mudanças registradas.')));
  }
  function tabAcesso(ctx, s) {
    const users = db.where('users', (u) => u.subId === s.id);
    function inviteUser() {
      if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
      const nomeI = ui.input({ placeholder: 'Nome completo' });
      const emailI = ui.input({ type: 'email', placeholder: 'nome@empresa.com.br' });
      const m = ui.modal({
        title: 'Convidar usuário', subtitle: 'Acesso com perfil subparceiro, só aos dados de ' + s.nome + '.', icon: 'user-plus',
        body: h('div.stack.tight', ui.field({ label: 'Nome', required: true }, nomeI), ui.field({ label: 'E-mail', required: true }, emailI)),
        footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Convidar', {
          variant: 'primary', onclick: () => {
            const nm = nomeI.value.trim(), em = emailI.value.trim();
            if (nm.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { ui.toast('Confira os dados', { type: 'warn', text: 'Nome e e-mail válido são obrigatórios.' }); return; }
            const u = db.put('users', { id: C.uid('u-sub'), nome: nm, email: em, cargo: 'Subparceiro', orgId: ORG, perfil: 'subparceiro', subId: s.id, demo: false, twofa: true, hue: 95, ultimoAcesso: null, telefone: '' });
            ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.usuario_convidado', entidade: { kind: 'usuario', id: u.id }, resumo: nm + ' convidado como subparceiro de ' + s.nome, classe: 'R2' });
            ui.toast('Usuário convidado', { type: 'success', text: nm + ' acessa como subparceiro.' });
            api.close(true);
          },
        })],
      });
    }
    function revoke(u) {
      if (!C.can('operar')) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg('operar') }); return; }
      ui.confirm({ title: 'Revogar acesso?', text: u.nome + ' perde o acesso imediatamente.', tone: 'danger', confirmLabel: 'Revogar' }).then((ok) => {
        if (!ok) return;
        db.del('users', u.id);
        ledger.append({ actor: E.actors.user(session.user().id), acao: 'subparceiro.usuario_revogado', entidade: { kind: 'subparceiro', id: s.id }, resumo: 'Acesso de ' + u.nome + ' revogado', classe: 'R2' });
        ui.toast('Acesso revogado', { type: 'success' });
      });
    }
    return ui.card({ title: 'Usuários com perfil subparceiro', subtitle: 'Enxergam só os indicados e a comissão de ' + s.nome + '.', actions: [ui.btn('Convidar usuário', { variant: 'primary', size: 'sm', icon: 'user-plus', onclick: inviteUser })] },
      users.length ? ui.table({ rows: users, rowKey: (u) => u.id, columns: [{ key: 'nome', label: 'Nome', mobile: 'primary', render: (u) => h('div', h('strong', u.nome), h('div.small.muted', u.email)) }, { key: 'acesso', label: 'Último acesso', align: 'right', render: (u) => h('span.small', u.ultimoAcesso ? fmt.rel(u.ultimoAcesso) : 'nunca acessou') }, { key: 'acao', label: '', align: 'right', render: (u) => ui.btn('Revogar', { size: 'sm', variant: 'ghost', onclick: () => revoke(u) }) }] }) : ui.empty({ icon: 'user-plus', title: 'Nenhum usuário vinculado', text: 'O aceite do convite cria o primeiro acesso automaticamente. Convide mais pessoas da equipe do subparceiro aqui.' }));
  }
  function tabAtividade(s) {
    const evs = C.store.ledger.all().filter((e) => (e.entidade && e.entidade.id === s.id) || (e.entidade && e.entidade.kind === 'premiacao' && (db.get('premiacoes', e.entidade.id) || {}).subId === s.id)).sort((a, b) => b.ts - a.ts).slice(0, 60);
    return ui.card({ title: 'Atividade', subtitle: 'Trilha de decisões deste subparceiro.' }, evs.length ? ui.timeline(evs.map((e) => ({ icon: 'circle', title: e.resumo, ts: e.ts, actor: (e.actor || {}).nome, tone: e.classe === 'R3' ? 'red' : e.classe === 'R2' ? 'amber' : 'neutral' }))) : ui.empty({ icon: 'history', title: 'Sem eventos', text: 'As ações deste subparceiro aparecem aqui.' }));
  }

  C.router.register([
    { path: '/originador/subparceiros', roles: ['originador', 'subparceiro'], title: 'Subparceiros', render: rSubs },
    { path: '/originador/subparceiros/:id', roles: ['originador', 'subparceiro'], title: 'Subparceiro', render: rSubDetalhe },
  ]);
  C.originador2 = { openInviteModal, simulateAccept, repasseStatus, subName };
})();
