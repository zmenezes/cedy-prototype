/* =========================================================================
   Cedy super: Superadmin, saúde da plataforma, serviços, incidentes,
   IA e mercado (perfis:['superadmin']). Prefixo CSS: sup-.
   Henrique Castro (u-super-1): Diretor de tecnologia e plataforma.
   Clássico, sem dependências. Usa C.engine/C.db + ledger em tudo.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui; const F = C.flows;
  const { db, session, ledger, notify } = C.store; const E = C.engine;
  const now = () => C.clock.now();
  const me = () => E.actors.user(session.get().userId);
  const meName = () => (session.user() || {}).nome || 'Superadmin';
  const orgName = (id) => { const o = db.get('orgs', id); return o ? (o.fantasia || o.nome) : id; };
  const R2 = (n) => C.round2(n);
  const DAY = 86400000;

  /* Camadas abertas por estas telas fecham ao trocar de rota. */
  const layers = new Set();
  const track = (api) => { layers.add(api); api.promise.then(() => layers.delete(api)); return api; };
  window.addEventListener('hashchange', () => [...layers].forEach((l) => { try { l.close(); } catch (e) { /* rota já tratou */ } }));
  const modal = (o) => track(ui.modal(o));
  const drawer = (o) => track(ui.drawer(o));

  const log = (acao, entidade, resumo, classe, detalhe) => ledger.append({ actor: me(), acao, entidade, resumo, classe: classe || 'R2', detalhe: detalhe || null });
  const notifyOps = (tipo, titulo, corpo, link) => notify.send({ to: { role: 'ops' }, tipo, titulo, corpo, link });
  const notifyAllOrgs = (tipo, titulo, corpo, link) => db.where('orgs', (o) => o.status === 'ativo' && o.kind !== 'cedy').forEach((o) => notify.send({ to: { orgId: o.id }, tipo, titulo, corpo, link }));

  /* ------------------------------ selos --------------------------------- */
  const SVC_TONE = { operacional: 'green', degradado: 'amber', fora: 'red' };
  const svcBadge = (st) => ui.badge({ operacional: 'Operacional', degradado: 'Degradado', fora: 'Fora do ar' }[st] || st, SVC_TONE[st] || 'neutral', { dot: true });
  const SEV_TONE = { S1: 'red', S2: 'amber', S3: 'neutral' };
  const sevBadge = (s) => ui.badge(s, SEV_TONE[s] || 'neutral', { title: { S1: 'Crítica: resposta em até 2 h', S2: 'Alta: acompanhamento próximo', S3: 'Moderada: rotina da plataforma' }[s] || s });
  const INC_ST = { investigando: ['Investigando', 'amber'], identificado: ['Identificado', 'blue'], monitorando: ['Monitorando', 'teal'], resolvido: ['Resolvido', 'green'] };
  const incBadge = (st) => ui.badge((INC_ST[st] || [st, 'neutral'])[0], (INC_ST[st] || [st, 'neutral'])[1], { dot: true });
  const TIPO_LB = { interno: 'Núcleo', integracao: 'Integração', ia: 'IA' };
  const tipoBadge = (t) => ui.badge(TIPO_LB[t] || t, t === 'interno' ? 'blue' : t === 'ia' ? 'violet' : 'teal');
  const resBadge = (br) => (br ? ui.badge('Residência BR', 'green', { icon: 'shield-check', title: 'Dados processados no Brasil' }) : ui.badge('Fora do BR', 'amber', { icon: 'globe', title: 'Processamento fora do Brasil: atenção à LGPD' }));
  const simBadge = () => ui.badge('Simulado', 'neutral', { icon: 'activity', title: 'Integração simulada no protótipo: respostas e métricas são de demonstração' });
  const critBadge = () => ui.badge('Crítico', 'red', { icon: 'triangle-alert', title: 'Serviço crítico: queda abre incidente S1' });

  function actorCell(a) {
    const parts = String(a.nome || a.id).split(' · ');
    return h('span.cell-row', h('span', { class: ['tl-dot', 'tone-' + (F.actorTone(a) || 'neutral')], style: { width: '26px', height: '26px', flex: 'none' } }, icon(F.actorIcon(a), 13)),
      h('span.cell-main', h('strong', parts[0]), h('small', F.actorLabel(a) + (parts[1] ? ' · ' + parts[1] : ''))));
  }

  /** Confirmação com frase digitada, para ações perigosas. Com withReason, resolve com o motivo (string) ou false. */
  function confirmPhrase(o) {
    let btn = null; let reasonCtl = null; let reasonWrap = null;
    if (o.withReason) { reasonCtl = ui.input({ type: 'textarea', placeholder: 'Descreva de forma objetiva', aria: 'Motivo' }); reasonWrap = ui.field({ label: 'Motivo', required: true, hint: 'Fica registrado na trilha com o seu nome.' }, reasonCtl); }
    const campo = ui.field({ label: 'Digite ' + o.phrase + ' para confirmar', required: true, hint: 'A confirmação evita ações acidentais e fica na trilha.' },
      ui.input({ placeholder: o.phrase, aria: 'Frase de confirmação', onInput: (v) => { if (btn) btn.disabled = String(v).trim() !== o.phrase; } }));
    const m = modal({ title: o.title, icon: o.icon || 'triangle-alert', tone: 'red', size: 'sm', alert: true,
      body: h('div.stack.tight', o.text && h('p', o.text), reasonWrap, campo),
      footer: (api) => { const b = ui.btn(o.confirmLabel || 'Confirmar', { variant: 'danger', onclick: () => {
        if (reasonCtl && !String(reasonCtl.value || '').trim()) { reasonWrap.setError('Informe o motivo.'); return; }
        api.close(reasonCtl ? String(reasonCtl.value).trim() : true);
      } }); btn = b; b.disabled = true;
        return [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), b]; } });
    return m.promise.then((v) => (typeof v === 'string' ? v : !!v));
  }

  async function reasonModal(title, label) {
    const wrap = ui.field({ label: label || 'Motivo', required: true, hint: 'Fica registrado na trilha com o seu nome.' }, ui.input({ type: 'textarea', placeholder: 'Descreva de forma objetiva' }));
    const m = modal({ title, icon: 'message-circle', size: 'sm',
      body: wrap,
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(null) }),
        ui.btn('Confirmar', { variant: 'primary', onclick: () => { const v = String(wrap.querySelector('textarea,input').value).trim(); if (!v) { wrap.setError('Informe o motivo.'); return; } api.close(v); } })] });
    return m.promise;
  }

  /* --------------------------- dados de serviço -------------------------- */
  const CRITICOS = ['svc-bmp', 'svc-icp', 'svc-db'];
  const isCritico = (id) => CRITICOS.includes(id);
  const OPCFG_DEFAULT = () => ({ timeoutMs: 8000, retries: 3, breaker: true, rateLimit: 120 });
  const opcfgOf = (s) => Object.assign(OPCFG_DEFAULT(), s.opcfg || {});
  /** Orçamento de erro: quanto da indisponibilidade tolerada (100 menos SLO) já foi consumido. */
  const errBudget = (s) => { const orc = R2(100 - (s.sloAlvo || 99.5)); const usado = R2(100 - s.disp30d); return { orc, usado, resto: R2(orc - usado) }; };
  const lastIncUpdate = (inc) => (inc.linha && inc.linha.length ? inc.linha[inc.linha.length - 1].ts : inc.inicioEm);
  const openForSvc = (svcId) => db.where('incidentes', (i) => i.status !== 'resolvido' && (i.servicoIds || []).includes(svcId));
  const nextIncId = () => 'INC-2026-' + String(Math.max(0, ...db.all('incidentes').map((i) => Number(String(i.id).split('-').pop()) || 0)) + 1).padStart(3, '0');
  const agentShort = (ag) => String((ag && ag.nome) || 'Agente').replace(/^Agente de /, '');
  const modelOfAgent = (agId) => db.all('modelosIA').find((m) => (m.usos || []).includes(agId)) || null;

  /* ---------------------- gaveta de serviço (saúde e serviços) ---------------------- */
  function openSvcDrawer(svcId) {
    const s = db.get('servicos', svcId); if (!s) return;
    const rel = db.where('incidentes', (i) => (i.servicoIds || []).includes(svcId)).sort((a, b2) => b2.inicioEm - a.inicioEm).slice(0, 5);
    const cats = s.serie.lat.map((_, i) => ({ x: 'há ' + (23 - i) + 'h', y: s.serie.lat[i] }));
    const erros = s.serie.erro.map((v, i) => ({ x: 'há ' + (23 - i) + 'h', y: v }));
    const reqs = s.serie.reqs.map((v, i) => ({ x: 'há ' + (23 - i) + 'h', y: v }));
    const cfg = opcfgOf(s);
    const fTimeout = ui.field({ label: 'Timeout por chamada (ms)', required: true }, ui.numeric({ value: cfg.timeoutMs, aria: 'Timeout em milissegundos' }));
    const fRetries = ui.field({ label: 'Tentativas (com backoff)', required: true }, ui.numeric({ value: cfg.retries, aria: 'Tentativas' }));
    const fRate = ui.field({ label: 'Limite (requisições por minuto)', required: true }, ui.numeric({ value: cfg.rateLimit, aria: 'Limite por minuto' }));
    const fBreaker = ui.switch({ label: 'Circuit breaker', hint: 'Abre o circuito após falhas seguidas e usa resposta degradada.', checked: cfg.breaker });
    const rl = ui.live(['servicos'], () => {
      const bb = errBudget(s);
      return h('div.stack.tight',
        h('div.row', svcBadge(s.status), tipoBadge(s.tipo), s.simulado ? simBadge() : null, isCritico(s.id) ? critBadge() : null),
        ui.kv([['Provedor', s.provedor], ['Região', s.regiao], ['Residência de dados', resBadge(s.residenciaBR)], ['Descrição', s.descricao],
          ['SLO de disponibilidade', fmt.pct(s.sloAlvo)], ['Disponibilidade (30 d)', fmt.pct(s.disp30d)],
          ['Orçamento de erro restante', bb.resto >= 0 ? fmt.pct(bb.resto) + ' de ' + fmt.pct(bb.orc) : 'estourado em ' + fmt.pct(-bb.resto), bb.resto >= 0 ? 'Margem antes de descumprir o SLO.' : 'O SLO de 30 dias foi descumprido.'],
          ['Latência p95', Math.round(s.latP95ms) + ' ms'], ['Taxa de erro', fmt.pct(s.taxaErro)], ['Última checagem', fmt.rel(s.ultimaChecagem) + ' (' + fmt.datetime(s.ultimaChecagem) + ')']]),
        ui.progress(Math.max(0, Math.min(100, (bb.resto / bb.orc) * 100)), { tone: bb.resto >= 0 ? undefined : 'red', thin: true }));
    });
    const body = h('div.stack',
      rl,
      ui.card({ title: 'Latência p95 nas últimas 24 h', subtitle: s.simulado ? 'Séries de demonstração (telemetria simulada).' : 'Amostra das últimas 24 horas.' }, ui.chart.line({ series: [{ name: s.nome, tone: 'blue', data: cats }], height: 180, format: (v) => Math.round(v) + ' ms', zero: false })),
      ui.card({ title: 'Taxa de erro e volume', subtitle: 'Erros em % e requisições por hora.' }, ui.chart.line({ series: [{ name: 'Erro (%)', tone: 'red', data: erros }], height: 150, format: (v) => fmt.pct(v) }), ui.chart.bars({ categories: reqs.map((r) => r.x).filter((_, i) => i % 4 === 0), series: [{ name: 'Requisições', tone: 'teal', data: reqs.filter((_, i) => i % 4 === 0).map((r) => r.y) }], height: 150 })),
      rel.length ? ui.card({ title: 'Incidentes relacionados', subtitle: 'Que citaram este serviço.' }, h('div.stack.tight', rel.map((i) => h('div.row', sevBadge(i.severidade), h('span.grow', h('a', { href: '#/super/incidentes/' + i.id }, i.id), h('div.small.muted', i.titulo)), incBadge(i.status))))) : null,
      ui.card({ title: 'Configuração operacional', subtitle: 'Vale na próxima chamada. A alteração fica na trilha (R2).',
        actions: [ui.btn('Salvar', { variant: 'primary', size: 'sm', onclick: () => {
          const t = Number(fTimeout.querySelector('input').value.replace(/\D/g, '')); const r = Number(fRetries.querySelector('input').value.replace(/\D/g, '')); const l = Number(fRate.querySelector('input').value.replace(/\D/g, ''));
          if (!(t >= 500 && t <= 60000)) { fTimeout.setError('Use entre 500 e 60000 ms.'); return; }
          if (!(r >= 0 && r <= 10)) { fRetries.setError('Use entre 0 e 10 tentativas.'); return; }
          if (!(l >= 1 && l <= 10000)) { fRate.setError('Use entre 1 e 10000 por minuto.'); return; }
          fTimeout.setError(null); fRetries.setError(null); fRate.setError(null);
          const antes = opcfgOf(s);
          db.patch('servicos', s.id, { opcfg: { timeoutMs: t, retries: r, breaker: !!fBreaker.value, rateLimit: l } });
          log('servico.opcfg', { kind: 'servico', id: s.id }, `Configuração operacional de ${s.nome}: timeout ${t} ms, ${r} tentativas, breaker ${fBreaker.value ? 'ligado' : 'desligado'}, limite ${l}/min`, 'R2', { antes, depois: opcfgOf(db.get('servicos', s.id)) });
          ui.toast('Configuração salva', { type: 'success', text: s.nome + ' usa os novos parâmetros na próxima chamada.' });
        } })] }, h('div.sup-formgrid', fTimeout, fRetries, fRate, fBreaker)),
      ui.card({ title: 'Checagem e demonstração', subtitle: 'Os controles de simulação alteram o estado de verdade e abrem incidentes reais.' },
        h('div.row', ui.btn('Executar checagem agora', { variant: 'secondary', icon: 'refresh-cw', onclick: async () => {
          await new Promise((res) => setTimeout(res, 900));
          const j = (v, p) => R2(v * (1 + (Math.random() - 0.5) * p));
          const lat = s.serie.lat.slice(); lat[lat.length - 1] = Math.max(1, Math.round(j(lat[lat.length - 1], 0.06)));
          const er = s.serie.erro.slice(); er[er.length - 1] = Math.max(0, R2(j(er[er.length - 1], 0.2), 3));
          db.patch('servicos', s.id, { ultimaChecagem: now(), latP95ms: lat[lat.length - 1], taxaErro: er[er.length - 1], serie: Object.assign({}, s.serie, { lat, erro: er }) });
          log('servico.checagem', { kind: 'servico', id: s.id }, `Checagem manual em ${s.nome}: p95 de ${Math.round(lat[lat.length - 1])} ms, erro de ${fmt.pct(er[er.length - 1])}`, 'R1');
          ui.toast('Checagem concluída', { type: 'success', text: `${s.nome}: p95 de ${Math.round(lat[lat.length - 1])} ms.` });
        } })),
        h('div.sup-demo', h('small.muted', 'Demonstração: simulam falha de verdade no protótipo e abrem incidente.'),
          h('div.row', ui.btn('Simular degradação', { variant: 'secondary', icon: 'triangle-alert', onclick: () => simularFalha(s, 'degradado') }),
            ui.btn('Simular queda', { variant: 'danger', icon: 'octagon-pause', onclick: () => simularFalha(s, 'fora') }),
            openForSvc(s.id).length ? ui.btn('Restaurar', { variant: 'primary', icon: 'circle-check', onclick: () => restaurarServico(s) }) : null))));
    drawer({ title: s.nome, subtitle: s.provedor + ' · ' + s.regiao, icon: 'server-cog', size: 'lg', body });
  }

  async function simularFalha(s, novo) {
    const crit = isCritico(s.id);
    const ok = await modal({ title: novo === 'fora' ? 'Simular queda de ' + s.nome + '?' : 'Simular degradação de ' + s.nome + '?', icon: 'triangle-alert', tone: 'danger', size: 'sm', alert: true,
      body: h('div.stack.tight', ui.callout({ tone: 'warn', title: 'Controle de demonstração', text: `Isto muda o estado de ${s.nome} de verdade no protótipo e abre um incidente ${crit ? 'S1 (serviço crítico)' : 'S2'} com aviso à Mesa.` }),
        h('p', novo === 'fora' ? 'O serviço passa a responder como fora do ar até ser restaurado.' : 'A latência e a taxa de erro sobem até a restauração.')),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Simular ' + (novo === 'fora' ? 'queda' : 'degradação'), { variant: 'danger', onclick: () => api.close(true) })] }).promise;
    if (!ok) return;
    const sev = crit ? 'S1' : 'S2';
    const id = nextIncId();
    db.batch(() => {
      db.patch('servicos', s.id, { status: novo, latP95ms: novo === 'fora' ? s.latP95ms : Math.round(s.latP95ms * 3.2), taxaErro: novo === 'fora' ? s.taxaErro : R2(s.taxaErro + 1.8) });
      db.put('incidentes', { id, titulo: (novo === 'fora' ? 'Queda simulada: ' : 'Degradação simulada: ') + s.nome, severidade: sev, status: 'investigando', servicoIds: [s.id], inicioEm: now(), resolvidoEm: null,
        impacto: `Demonstração: ${s.nome} com resposta ${novo === 'fora' ? 'indisponível' : 'lenta'}. Rotas dependentes enfileiradas.`, causa: 'Em apuração.',
        linha: [{ ts: now(), autor: meName(), texto: `Demonstração iniciada pelo Superadmin: estado de ${s.nome} alterado para ${novo === 'fora' ? 'fora do ar' : 'degradado'}.` }], avisoClientesEm: null, posmortem: null });
      log('servico.status_alterado', { kind: 'servico', id: s.id }, `${s.nome} marcado como ${novo} (demonstração). Incidente ${id} aberto (${sev}).`, 'R2');
      log('incidente.aberto', { kind: 'incidente', id }, `Incidente ${id} aberto (${sev}): ${s.nome} ${novo}.`, sev === 'S1' ? 'R3' : 'R2');
      notifyOps('erro', `${sev} em demonstração: ${s.nome} ${novo}`, `Incidente ${id} aberto. Restaure o serviço na tela de Serviços.`, '/super/incidentes/' + id);
    });
    ui.toast('Demonstração em curso', { type: 'warn', text: `${s.nome} ${novo}. Incidente ${id} (${sev}) aberto.` });
  }

  async function restaurarServico(s) {
    const abertos = openForSvc(s.id);
    const ok = await modal({ title: 'Restaurar ' + s.nome + '?', icon: 'circle-check', tone: 'primary', size: 'sm',
      body: h('p', `O serviço volta a operacional e ${abertos.length ? fmt.plural(abertos.length, 'o incidente aberto é', 'os incidentes abertos são') + ' resolvidos' : 'nenhum incidente segue aberto'}.`),
      footer: (api) => [ui.btn('Cancelar', { variant: 'ghost', onclick: () => api.close(false) }), ui.btn('Restaurar', { variant: 'primary', onclick: () => api.close(true) })] }).promise;
    if (!ok) return;
    db.batch(() => {
      db.patch('servicos', s.id, { status: 'operacional', ultimaChecagem: now() });
      abertos.forEach((i) => {
        db.patch('incidentes', i.id, { status: 'resolvido', resolvidoEm: now(), causa: (i.causa && i.causa !== 'Em apuração.' ? i.causa + ' ' : '') + 'Serviço restaurado após demonstração.', linha: i.linha.concat([{ ts: now(), autor: meName(), texto: 'Serviço restaurado pelo Superadmin: retorno a operacional, sem perda residual.' }]) });
        log('incidente.resolvido', { kind: 'incidente', id: i.id }, `Incidente ${i.id} resolvido: ${s.nome} restaurado após demonstração.`, 'R2');
      });
      log('servico.status_alterado', { kind: 'servico', id: s.id }, `${s.nome} restaurado a operacional.`, 'R2');
      notifyOps('sucesso', s.nome + ' restaurado', abertos.length ? `Incidente(s) ${abertos.map((i) => i.id).join(', ')} resolvidos.` : 'Sem incidentes abertos.', '/super/servicos');
    });
    ui.toast('Serviço restaurado', { type: 'success', text: s.nome + ' voltou a operacional.' });
  }
  /* ------------------------------ /super (saúde) ------------------------------ */
  function platformStatus() {
    const svcs = db.all('servicos');
    const abertos = db.where('incidentes', (i) => i.status !== 'resolvido');
    if (abertos.some((i) => i.severidade === 'S1') || svcs.some((s) => s.status === 'fora')) return { k: 'fora', label: 'Fora de operação', tone: 'red', icon: 'octagon-pause' };
    if (abertos.length || svcs.some((s) => s.status === 'degradado')) return { k: 'deg', label: 'Degradado', tone: 'amber', icon: 'triangle-alert' };
    return { k: 'ok', label: 'Operacional', tone: 'green', icon: 'circle-check' };
  }
  function monthBounds() {
    const t = C.cal.sp(now()); const ini = C.cal.spTs(t.y, t.m, 1, 0, 0);
    const fim = C.cal.spTs(t.m === 12 ? t.y + 1 : t.y, t.m === 12 ? 1 : t.m + 1, 1, 0, 0);
    return { ini, fim, dias: new Date(Date.UTC(t.y, t.m, 0)).getUTCDate(), comp: t.y + '-' + String(t.m).padStart(2, '0') };
  }
  function custoMesIA() {
    const { ini, fim } = monthBounds();
    return R2(C.sum(db.where('usoIA', (u) => u.dia >= ini && u.dia < fim), (u) => u.custoBRL));
  }
  function lastGoodBackup() {
    const oks = db.all('backups').filter((b) => b.status === 'ok' || b.status === 'verificado').sort((a, b2) => b2.ts - a.ts);
    return oks[0] || null;
  }

  /** Alertas e pendências a partir dos dados vivos. Cada item: {sev, icon, titulo, texto, link, drawer} */
  function collectAlerts() {
    const out = []; const t = now();
    db.all('servicos').filter((s) => s.status !== 'operacional').forEach((s) => out.push({
      sev: s.status === 'fora' ? 'alta' : 'media', icon: s.status === 'fora' ? 'octagon-pause' : 'triangle-alert',
      titulo: s.nome + (s.status === 'fora' ? ' fora do ar' : ' degradado'),
      texto: `P95 de ${Math.round(s.latP95ms)} ms, erro de ${fmt.pct(s.taxaErro)}, disponibilidade de ${fmt.pct(s.disp30d)} em 30 dias.`,
      drawer: s.id, link: '/super/servicos' }));
    db.where('incidentes', (i) => i.status !== 'resolvido').forEach((i) => {
      const semUp = t - lastIncUpdate(i);
      if (i.severidade === 'S1') out.push({ sev: 'alta', icon: 'siren', titulo: i.id + ': resposta S1 em curso',
        texto: `${fmt.dur(t - i.inicioEm)} desde a abertura (meta da plataforma: resposta em até 2 h). Sem atualização há ${fmt.dur(semUp)}.`, link: '/super/incidentes/' + i.id });
      else if (semUp > 2 * 3600e3) out.push({ sev: i.severidade === 'S2' ? 'media' : 'baixa', icon: 'history', titulo: i.id + ' sem atualização há ' + fmt.dur(semUp), texto: i.titulo, link: '/super/incidentes/' + i.id });
    });
    const allBk = db.all('backups').sort((a, b2) => b2.ts - a.ts);
    if (allBk[0] && (allBk[0].status !== 'ok' && allBk[0].status !== 'verificado')) out.push({ sev: 'alta', icon: 'database-backup', titulo: 'Último backup falhou', texto: `${allBk[0].tipo === 'completo' ? 'Completo' : 'Incremental'} de ${fmt.datetime(allBk[0].ts)} com falha. RPO de 8 h em risco.`, link: '/super/backups' });
    const good = lastGoodBackup();
    if (good && t - good.ts > 8 * 3600e3) out.push({ sev: 'media', icon: 'database-backup', titulo: 'Sem backup íntegro há ' + fmt.dur(t - good.ts), texto: 'Último backup íntegro: ' + fmt.datetime(good.ts) + '. RPO de referência: 8 h.', link: '/super/backups' });
    db.all('servicos').filter((s) => s.status === 'operacional' && s.latP95ms > 2000).forEach((s) => out.push({ sev: 'baixa', icon: 'timer', titulo: s.nome + ': p95 acima de 2 s', texto: `P95 de ${Math.round(s.latP95ms)} ms na última checagem (${fmt.rel(s.ultimaChecagem)}).`, drawer: s.id, link: '/super/servicos' }));
    if ((cfgOf().ia.residenciaBR)) db.all('modelosIA').filter((m) => m.status === 'ativo' && !m.residenciaBR).forEach((m) => out.push({ sev: 'media', icon: 'globe', titulo: m.nome + ' ativo fora do Brasil', texto: 'A residência BR está ligada e este modelo processa em ' + m.regiao + '. Mova para sombra ou desligue a exigência com justificativa.', link: '/super/ia' }));
    const ap = db.where('aprovacoes', (a) => a.status === 'pendente');
    if (ap.length) { const exp = ap.filter((a) => a.expiraEm - t < 24 * 3600e3);
      out.push({ sev: exp.length ? 'alta' : 'baixa', icon: 'stamp', titulo: fmt.plural(ap.length, 'aprovação pendente', 'aprovações pendentes'), texto: exp.length ? exp.map((a) => a.id + ' expira ' + fmt.rel(a.expiraEm)).join('; ') : 'Aguardando decisão do Superadmin.', link: '/super/aprovacoes' }); }
    db.where('titulares', (x) => ['recebida', 'em_analise'].includes(x.status) && x.prazoAte - t < 3 * DAY).forEach((x) => out.push({ sev: x.prazoAte - t < DAY ? 'alta' : 'media', icon: 'file-lock',
      titulo: x.id + ': prazo LGPD em ' + fmt.dur(x.prazoAte - t), texto: `${x.tipo} de ${x.titularNome} (${orgName(x.orgId)}).`, link: '/super/lgpd' }));
    const sem2fa = db.where('users', (u) => { const o = db.get('orgs', u.orgId); return o && o.kind === 'cedy' && !u.twofa; });
    if (sem2fa.length) out.push({ sev: 'media', icon: 'key-round', titulo: fmt.plural(sem2fa.length, 'usuário interno sem 2FA', 'usuários internos sem 2FA'), texto: sem2fa.map((u) => u.nome).join(', '), link: '/super/usuarios' });
    const cfg = cfgOf();
    if (cfg.mercadoPausado) out.push({ sev: 'alta', icon: 'octagon-pause', titulo: 'Mercado pausado', texto: 'Novas operações e lances suspensos pelo Superadmin.', link: '/super/mercado' });
    Object.keys(cfg.flags || {}).filter((k) => cfg.flags[k] === false).forEach((k) => out.push({ sev: 'baixa', icon: 'toggle-right', titulo: 'Funcionalidade desligada: ' + flagMeta(k).nome, texto: flagMeta(k).afeta, link: '/super/mercado' }));
    if (cfg.manutencao && cfg.manutencao.ativo) out.push({ sev: 'baixa', icon: 'settings', titulo: 'Modo de manutenção ativo', texto: cfg.manutencao.msg || 'Aviso exibido a todos os perfis.', link: '/super/mercado' });
    const rank = { alta: 0, media: 1, baixa: 2 };
    return out.sort((a, b2) => rank[a.sev] - rank[b2.sev]);
  }
  const cfgOf = () => db.cfg();
  const SEV_TXT = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

  function alertItem(a) {
    return h('div', { class: ['sup-alert', 'sev-' + a.sev] }, icon(a.icon, 17),
      h('div.grow', h('strong', a.titulo), h('div.small.muted', a.texto)),
      ui.badge(SEV_TXT[a.sev], a.sev === 'alta' ? 'red' : a.sev === 'media' ? 'amber' : 'neutral'),
      a.drawer ? ui.btn('Abrir serviço', { variant: 'ghost', size: 'sm', onclick: () => openSvcDrawer(a.drawer) }) : ui.btn('Ver', { variant: 'ghost', size: 'sm', route: a.link }));
  }

  function hourBuckets() {
    const t = now(); const out = [];
    for (let i = 23; i >= 0; i--) { const ts = t - i * 3600e3; const p = C.cal.sp(ts); out.push({ ini: ts - (ts % 3600e3), label: fmt.time(ts), h: p.h }); }
    return out;
  }

  function pgSuper() {
    const body = h('div');
    const draw = () => {
      const st = platformStatus();
      const svcs = db.all('servicos');
      const abertos = db.where('incidentes', (i) => i.status !== 'resolvido');
      const disp = R2(C.sum(svcs, (s) => s.disp30d) / Math.max(1, svcs.length));
      const lat = Math.round(C.sum(svcs, (s) => s.latP95ms) / Math.max(1, svcs.length));
      const err = R2(C.sum(svcs, (s) => s.taxaErro) / Math.max(1, svcs.length));
      const good = lastGoodBackup(); const t = now();
      const rpoOk = good && t - good.ts <= 8 * 3600e3;
      const custo = custoMesIA(); const teto = cfgOf().ia.tetoCustoMesBRL;
      const ap = db.where('aprovacoes', (a) => a.status === 'pendente');
      const alerts = collectAlerts();
      const groups = [['interno', 'Núcleo', 'Motor, dados e API da Cedy.'], ['integracao', 'Integrações externas', 'Parceiros, governo e mensageria (simuladas no protótipo).'], ['ia', 'IA', 'Gateway e modelos de IA da Cedy.']];
      const feed = ledger.all().filter((e) => e.classe === 'R3' || /^(mercado|servico|incidente|ia|plataforma|aprovacao|agente)/.test(e.acao)).slice(-12).reverse();
      C.mount(body, h('div.stack.sup-page',
        ui.pageHeader({ eyebrow: 'Superadmin · plataforma', title: 'Saúde da plataforma', subtitle: 'Visão calma do que importa: disponibilidade, incidentes, custo de IA e pendências com ação direta.', actions: [ui.btn('Abrir incidente', { variant: 'secondary', icon: 'siren', route: '/super/incidentes' }), ui.btn('Ver serviços', { variant: 'primary', icon: 'server-cog', route: '/super/servicos' })] }),
        h('div', { class: ['sup-status', 'tone-' + st.tone] }, icon(st.icon, 22), h('div', h('strong', st.label), h('div.small', st.k === 'ok' ? 'Todos os serviços operacionais e nenhum incidente aberto.' : st.k === 'deg' ? 'Há degradação ou incidente aberto: veja os alertas abaixo.' : 'Há incidente crítico ou serviço fora do ar: resposta imediata.')),
          h('span.small.muted', 'atualizado ' + fmt.time(t))),
        h('div.sup-kpis',
          ui.kpi({ label: 'Disponibilidade (30 d)', value: disp, fmt: 'pct', hint: 'alvo ' + fmt.pct(99.5), tone: disp >= 99.5 ? 'green' : 'amber', icon: 'activity' }),
          ui.kpi({ label: 'Incidentes abertos', display: String(abertos.length), hint: abertos.filter((i) => i.severidade === 'S1').length ? abertos.filter((i) => i.severidade === 'S1').length + ' S1 em curso' : abertos.length ? 'maior: ' + abertos.map((i) => i.severidade).sort()[0] : 'nenhum em curso', tone: abertos.some((i) => i.severidade === 'S1') ? 'red' : abertos.length ? 'amber' : 'green', icon: 'siren', onclick: abertos.length ? (() => C.router.go('/super/incidentes')) : null }),
          ui.kpi({ label: 'Latência p95 média', display: fmt.num(lat) + ' ms', hint: 'média dos serviços', icon: 'timer' }),
          ui.kpi({ label: 'Taxa de erro média', display: fmt.pct(err), hint: 'média dos serviços', icon: 'triangle-alert' }),
          ui.kpi({ label: 'Último backup íntegro', display: good ? fmt.rel(good.ts) : 'nenhum', hint: good ? ('RPO ' + (rpoOk ? 'dentro de 8 h' : 'acima de 8 h')) : 'verifique os backups', tone: !good ? 'red' : rpoOk ? 'green' : 'amber', icon: 'database-backup', onclick: () => C.router.go('/super/backups') }),
          ui.kpi({ label: 'Aprovações pendentes', display: String(ap.length), hint: ap.length ? 'decisão do Superadmin' : 'caixa livre', tone: ap.length ? 'amber' : 'green', icon: 'stamp', onclick: ap.length ? (() => C.router.go('/super/aprovacoes')) : null }),
          ui.kpi({ label: 'Custo de IA no mês', value: custo, fmt: 'brl', hint: 'teto ' + fmt.brl(teto, { round: true }) + (custo > teto ? ' (acima do teto)' : ''), tone: custo > teto ? 'red' : custo > teto * 0.8 ? 'amber' : undefined, icon: 'sparkles', onclick: () => C.router.go('/super/ia') }),
          ui.kpi({ label: 'Serviços monitorados', display: String(svcs.length), hint: svcs.filter((s) => s.status !== 'operacional').length ? svcs.filter((s) => s.status !== 'operacional').length + ' com problema' : 'todos operacionais', icon: 'server-cog', onclick: () => C.router.go('/super/servicos') })),
        ui.card({ title: 'Situação dos serviços', subtitle: 'Toque em um serviço para abrir o detalhe. Séries de demonstração (telemetria simulada).' },
          groups.map(([tipo, nome, desc]) => h('div.sup-group', h('h4.sup-group-t', nome, h('small.muted', ' ' + desc)),
            ui.table({ rows: svcs.filter((s) => s.tipo === tipo), rowKey: (r) => r.id,
              columns: [
                { key: 'nome', label: 'Serviço', mobile: 'primary', render: (s) => h('div.cell-main', h('strong', s.nome, isCritico(s.id) ? ' ' : null, isCritico(s.id) ? ui.badge('Crítico', 'red') : null), h('small.muted', s.provedor + ' · ' + s.regiao)) },
                { key: 'st', label: 'Estado', render: (s) => svcBadge(s.status) },
                { key: 'disp', label: 'Disp. 30 d', align: 'right', mobile: 'hide', render: (s) => h('span.num', fmt.pct(s.disp30d)) },
                { key: 'spark', label: 'Tendência', mobile: 'hide', render: (s) => ui.chart.spark(s.serie.lat, { tone: s.status === 'operacional' ? 'green' : 'amber' }) },
                { key: 'p95', label: 'P95', align: 'right', mobile: 'hide', render: (s) => h('span.num.nowrap', Math.round(s.latP95ms) + ' ms') },
                { key: 'erro', label: 'Erro', align: 'right', mobile: 'show', render: (s) => h('span.num', fmt.pct(s.taxaErro)) },
              ], onRowClick: (s) => openSvcDrawer(s.id) })))),
        h('div.sup-grid2',
          ui.card({ title: 'Latência p95 (24 h)', subtitle: 'Média dos serviços por hora (telemetria simulada).' }, liveChart(h('div'), (jit) => latChart(jit))),
          ui.card({ title: 'Taxa de erro (24 h)', subtitle: 'Média dos serviços por hora (telemetria simulada).' }, liveChart(h('div'), (jit) => errChart(jit)))),
        ui.card({ title: 'Movimento da plataforma (24 h)', subtitle: 'Operações publicadas e lances registrados por hora, direto do banco.' }, volumeChart()),
        alerts.length ? ui.card({ title: 'Alertas e pendências', subtitle: fmt.plural(alerts.length, 'item precisa', 'itens precisam') + ' da sua atenção, cada um com ação direta.', actions: [ui.badge(alerts.filter((a) => a.sev === 'alta').length + ' altas', 'red')] },
          h('div.stack.tight', alerts.map(alertItem))) : ui.card({ title: 'Alertas e pendências' }, ui.empty({ icon: 'circle-check', title: 'Tudo calmo', text: 'Nenhum alerta ativo: serviços operacionais, backups em dia e caixas livres.' })),
        ui.card({ title: 'Atividade recente da plataforma', subtitle: 'Entradas R3 e ações de plataforma na trilha, das mais novas às mais antigas.', actions: [ui.btn('Abrir trilha', { variant: 'ghost', size: 'sm', icon: 'scroll-text', route: '/ops/trilha' })] },
          feed.length ? h('div.stack.tight', feed.map((e) => h('div.sup-feed', actorCell(e.actor), h('div.grow', h('div', e.resumo), h('div.small.muted', fmt.datetime(e.ts) + ' · ' + fmt.rel(e.ts))), ui.badge(e.classe, e.classe === 'R3' ? 'red' : e.classe === 'R2' ? 'amber' : 'neutral')))) : h('p.muted.small', 'Sem atividade de plataforma registrada.'))
      ));
    };
    const box = ui.live(['servicos', 'incidentes', 'backups', 'titulares', 'aprovacoes', 'users', 'ledger', 'config', 'usoIA', 'modelosIA', 'operacoes', 'lances'], draw);
    draw();
    return body;
  }

  /** Gráficos vivos: o último ponto oscila a cada 5 s (não persiste). Contêiner fora de região viva. */
  function liveChart(box, build) {
    let n = 0;
    ui.every(box, () => { n++; if (n % 5) return; if (!box.isConnected) return; C.mount(box, build(true)); });
    C.mount(box, build(false));
    return box;
  }
  const jit = (v, p) => R2(v * (1 + (Math.random() - 0.5) * p));
  function latChart(jittered) {
    const svcs = db.all('servicos');
    const data = svcs[0].serie.lat.map((_, i) => ({ x: 'há ' + (23 - i) + 'h', y: Math.round(R2(C.sum(svcs, (s) => s.serie.lat[i]) / svcs.length)) }));
    if (jittered) data[data.length - 1].y = Math.max(1, Math.round(jit(data[data.length - 1].y, 0.05)));
    return ui.chart.line({ series: [{ name: 'P95 médio (ms)', tone: 'blue', data }], height: 200, format: (v) => Math.round(v) + ' ms', zero: false });
  }
  function errChart(jittered) {
    const svcs = db.all('servicos');
    const data = svcs[0].serie.erro.map((_, i) => ({ x: 'há ' + (23 - i) + 'h', y: R2(C.sum(svcs, (s) => s.serie.erro[i]) / svcs.length) }));
    if (jittered) data[data.length - 1].y = Math.max(0, jit(data[data.length - 1].y, 0.15));
    return ui.chart.line({ series: [{ name: 'Erro médio (%)', tone: 'red', data }], height: 200, format: (v) => fmt.pct(v) });
  }
  function volumeChart() {
    const hs = hourBuckets();
    const ops = db.all('operacoes'); const lcs = db.all('lances');
    const co = hs.map((hh) => ops.filter((o) => o.criadaEm >= hh.ini && o.criadaEm < hh.ini + 3600e3).length);
    const cl = hs.map((hh) => lcs.filter((l) => l.criadoEm >= hh.ini && l.criadoEm < hh.ini + 3600e3).length);
    return ui.chart.bars({ categories: hs.map((hh, i) => (i % 4 === 0 ? hh.label : '')), series: [{ name: 'Operações', tone: 'blue', data: co }, { name: 'Lances', tone: 'teal', data: cl }], height: 200 });
  }
  /* --------------------------- /super/servicos --------------------------- */
  function pgServicos() {
    let fTipo = '', fStatus = '', q = '';
    const lista = h('div');
    const selTipo = ui.select({ options: [{ value: '', label: 'Todos os tipos' }, { value: 'interno', label: 'Núcleo' }, { value: 'integracao', label: 'Integrações' }, { value: 'ia', label: 'IA' }], value: '', aria: 'Filtrar por tipo', onChange: (v) => { fTipo = v || ''; draw(); } });
    const selStatus = ui.select({ options: [{ value: '', label: 'Todos os estados' }, { value: 'operacional', label: 'Operacional' }, { value: 'degradado', label: 'Degradado' }, { value: 'fora', label: 'Fora do ar' }], value: '', aria: 'Filtrar por estado', onChange: (v) => { fStatus = v || ''; draw(); } });
    const busca = ui.search({ placeholder: 'Buscar por nome, provedor ou região', onInput: C.debounce((v) => { q = String(v || '').toLowerCase(); draw(); }, 200) });
    function draw() {
      let rows = db.all('servicos').sort((a, b) => a.nome.localeCompare(b.nome));
      if (fTipo) rows = rows.filter((s) => s.tipo === fTipo);
      if (fStatus) rows = rows.filter((s) => s.status === fStatus);
      if (q) rows = rows.filter((s) => (s.nome + ' ' + s.provedor + ' ' + s.regiao).toLowerCase().includes(q));
      C.mount(lista, ui.table({ rows, rowKey: (r) => r.id,
        empty: ui.empty({ icon: 'server-cog', title: 'Nenhum serviço com estes filtros', text: 'Ajuste o tipo, o estado ou a busca.', action: ui.btn('Limpar filtros', { variant: 'secondary', onclick: () => { fTipo = ''; fStatus = ''; q = ''; busca.value = ''; selTipo.value = ''; selStatus.value = ''; draw(); } }) }),
        columns: [
          { key: 'nome', label: 'Serviço', mobile: 'primary', render: (s) => h('div.cell-main', h('strong', s.nome, s.simulado ? ' ' : null, s.simulado ? simBadge() : null, isCritico(s.id) ? ' ' : null, isCritico(s.id) ? ui.badge('Crítico', 'red') : null), h('small.muted', s.descricao)) },
          { key: 'tipo', label: 'Tipo', mobile: 'hide', render: (s) => tipoBadge(s.tipo) },
          { key: 'prov', label: 'Provedor e região', mobile: 'hide', render: (s) => h('div.cell-main', h('strong.small', s.provedor), h('small', s.regiao, ' ', resBadge(s.residenciaBR))) },
          { key: 'st', label: 'Estado', render: (s) => svcBadge(s.status) },
          { key: 'disp', label: 'Disp. 30 d', align: 'right', mobile: 'hide', render: (s) => h('div.cell-main', { style: { alignItems: 'flex-end' } }, h('span.num', fmt.pct(s.disp30d)), h('small.muted', 'alvo ' + fmt.pct(s.sloAlvo))) },
          { key: 'p95', label: 'P95', align: 'right', mobile: 'hide', render: (s) => h('span.num.nowrap', Math.round(s.latP95ms) + ' ms') },
          { key: 'erro', label: 'Erro', align: 'right', mobile: 'show', render: (s) => h('span.num', fmt.pct(s.taxaErro)) },
          { key: 'chk', label: 'Checagem', mobile: 'hide', render: (s) => h('small.nowrap', { title: fmt.datetime(s.ultimaChecagem) }, fmt.rel(s.ultimaChecagem)) },
        ], onRowClick: (s) => openSvcDrawer(s.id) }));
    }
    draw();
    const live = ui.live(['servicos'], () => { if (lista.isConnected) draw(); });
    return h('div.stack.sup-page',
      ui.pageHeader({ eyebrow: 'Superadmin · plataforma', title: 'Serviços e integrações', subtitle: 'Núcleo, integrações externas (simuladas no protótipo) e IA. Toque em uma linha para operar.', actions: [ui.btn('Ver saúde', { variant: 'ghost', icon: 'heart-pulse', route: '/super' })] }),
      ui.toolbar(selTipo, selStatus, busca), live, lista);
  }
  /* --------------------------- flags da plataforma --------------------------- */
  const FLAG_META = {
    vitrine: { nome: 'Vitrine', afeta: 'Leilão aberto: operações e lances de todos os cedentes e financiadores.', risco: 'R3', conta: () => db.where('operacoes', (o) => o.canal === 'vitrine' && o.status === 'aberta').length + ' operações abertas na Vitrine' },
    balcao: { nome: 'Balcão', afeta: 'Ofertas diretas a um financiador escolhido.', risco: 'R3', conta: () => db.where('operacoes', (o) => o.canal === 'balcao' && o.status === 'aberta').length + ' operações abertas no Balcão' },
    importacao: { nome: 'Importação (borderô)', afeta: 'Criação de lotes por planilha ou arquivo.', risco: 'R3', conta: () => db.where('lotes', (l) => l.status === 'rascunho').length + ' lotes em rascunho' },
    aceiteAutomatico: { nome: 'Aceite automático', afeta: 'Aceite pelo teto do cedente sem clique.', risco: 'R2', conta: () => db.where('operacoes', (o) => o.tetoTaxa && o.status === 'aberta').length + ' operações com teto ativo' },
    lanceAutomatico: { nome: 'Lance automático', afeta: 'Políticas de financiadores dão lance sozinhas.', risco: 'R2', conta: () => db.where('financiadores', () => true).length + ' políticas avaliadas' },
    agentes: { nome: 'Agentes de IA', afeta: 'Todos os agentes param de propor e de responder; a Mesa decide sem resumo e as conversas seguem só com pessoas.', risco: 'R2', conta: () => db.where('propostas', (p) => p.status === 'pendente').length + ' propostas pendentes' },
    novosCadastros: { nome: 'Novos cadastros', afeta: 'Cadastro público de empresas (wizard em /cadastro).', risco: 'R2', conta: () => db.where('orgs', (o) => o.status === 'kyc').length + ' empresas em análise' },
  };
  const flagMeta = (k) => FLAG_META[k] || { nome: k, afeta: 'Funcionalidade da plataforma.', risco: 'R2', conta: () => '' };

  /* --------------------------- /super/incidentes --------------------------- */
  function pgIncidentes() {
    let aba = 'abertos', sev = '', q = '';
    const lista = h('div');
    const tabs = ui.tabs({ value: aba, items: [{ id: 'abertos', label: 'Abertos' }, { id: 'resolvidos', label: 'Resolvidos' }, { id: 'todos', label: 'Todos' }],
      onChange: (v) => { aba = v; draw(); } });
    const chips = ui.chips({ aria: 'Filtrar por severidade', options: [{ value: 'S1', label: 'S1' }, { value: 'S2', label: 'S2' }, { value: 'S3', label: 'S3' }], value: [], onChange: (v) => { sev = (v && v[0]) || ''; draw(); } });
    const busca = ui.search({ placeholder: 'Buscar por título ou serviço', onInput: C.debounce((v) => { q = String(v || '').toLowerCase(); draw(); }, 200) });
    const btnNovo = ui.btn('Abrir incidente', { variant: 'primary', icon: 'siren', onclick: () => modalIncidente() });
    function mttr() {
      const res = db.where('incidentes', (i) => i.status === 'resolvido' && i.resolvidoEm && i.inicioEm);
      if (!res.length) return null;
      return R2(C.sum(res, (i) => i.resolvidoEm - i.inicioEm) / res.length);
    }
    function draw() {
      let rows = db.all('incidentes').sort((a, b) => b.inicioEm - a.inicioEm);
      if (aba === 'abertos') rows = rows.filter((i) => i.status !== 'resolvido');
      if (aba === 'resolvidos') rows = rows.filter((i) => i.status === 'resolvido');
      if (sev) rows = rows.filter((i) => i.severidade === sev);
      if (q) rows = rows.filter((i) => (i.titulo + ' ' + i.id + ' ' + (i.servicoIds || []).join(' ')).toLowerCase().includes(q));
      const abertos = db.where('incidentes', (i) => i.status !== 'resolvido');
      const m = mttr();
      C.mount(lista, h('div.stack',
        h('div.grid.g4.keep2', ui.kpi({ label: 'Abertos agora', display: String(abertos.length), tone: abertos.some((i) => i.severidade === 'S1') ? 'red' : abertos.length ? 'amber' : 'green', icon: 'siren' }),
          ui.kpi({ label: 'S1 em curso', display: String(abertos.filter((i) => i.severidade === 'S1').length), tone: abertos.some((i) => i.severidade === 'S1') ? 'red' : undefined, icon: 'triangle-alert' }),
          ui.kpi({ label: 'MTTR (resolvidos)', display: m ? fmt.dur(m) : 'sem dados', icon: 'timer' })),
        h('p.small.muted', 'Metas da plataforma: S1 com resposta em até 2 h e aviso ao cliente em até 36 h.'),
        ui.table({ rows, rowKey: (r) => r.id,
          empty: ui.empty({ icon: 'siren', title: 'Nenhum incidente aqui', text: 'Ajuste a aba, a severidade ou a busca, ou abra um incidente.', action: ui.btn('Abrir incidente', { variant: 'secondary', onclick: () => modalIncidente() }) }),
          columns: [
            { key: 'id', label: 'Incidente', mobile: 'primary', render: (i) => h('div.cell-main', h('strong', i.id), h('small.muted', i.titulo)) },
            { key: 'sev', label: 'Sev.', render: (i) => sevBadge(i.severidade) },
            { key: 'st', label: 'Estado', mobile: 'hide', render: (i) => incBadge(i.status) },
            { key: 'svc', label: 'Serviços', mobile: 'hide', render: (i) => h('small', (i.servicoIds || []).map((s) => (db.get('servicos', s) || {}).nome || s).join(', ') || '—') },
            { key: 'ini', label: 'Abertura', align: 'right', mobile: 'hide', render: (i) => h('small.nowrap', { title: fmt.datetime(i.inicioEm) }, fmt.rel(i.inicioEm)) },
          ], onRowClick: (i) => C.router.go('/super/incidentes/' + i.id) })));
    }
    draw();
    const live = ui.live(['incidentes', 'servicos'], () => { if (lista.isConnected) draw(); });
    return h('div.stack.sup-page',
      ui.pageHeader({ eyebrow: 'Superadmin · plataforma', back: '/super', title: 'Incidentes', subtitle: 'Resposta, comunicação e pós-mortem. Abrir, acompanhar e resolver com trilha.', actions: [btnNovo] }),
      ui.toolbar(tabs, chips, busca), live, lista);
  }
  function modalIncidente(preset) {
    const svcs = db.all('servicos').sort((a, b) => a.nome.localeCompare(b.nome));
    const fT = ui.field({ label: 'Título', required: true }, ui.input({ placeholder: 'Ex.: Lentidão na conciliação', aria: 'Título do incidente' }));
    const fSev = ui.select({ aria: 'Severidade', value: (preset && preset.severidade) || 'S2', options: [{ value: 'S1', label: 'S1 · crítica (resposta em 2 h)' }, { value: 'S2', label: 'S2 · alta' }, { value: 'S3', label: 'S3 · moderada' }] });
    const fImp = ui.field({ label: 'Impacto', required: true }, ui.input({ type: 'textarea', placeholder: 'Quem sente, por quanto tempo, o que fica indisponível', aria: 'Impacto' }));
    const sel = new Set((preset && preset.servicoIds) || []);
    const chipBox = h('div.chips');
    svcs.forEach((s) => { const b = ui.btn((sel.has(s.id) ? '✓ ' : '') + s.nome, { variant: sel.has(s.id) ? 'primary' : 'ghost', size: 'sm', onclick: () => { sel.has(s.id) ? sel.delete(s.id) : sel.add(s.id); b.textContent = (sel.has(s.id) ? '✓ ' : '') + s.nome; } }); chipBox.append(b); });
    const m = modal({ title: 'Abrir incidente', icon: 'siren', size: 'md',
      body: h('div.stack', fT, ui.field({ label: 'Severidade' }, fSev), ui.field({ label: 'Serviços afetados' }, chipBox), fImp),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(null) }),
        ui.btn('Abrir incidente', { variant: 'danger', onclick: () => {
          const t = fT.querySelector('input,textarea').value.trim(); const im = fImp.querySelector('input,textarea').value.trim();
          if (t.length < 8) { fT.setError('Descreva com pelo menos 8 caracteres.'); return; }
          if (!im) { fImp.setError('Descreva o impacto para a Mesa e os clientes.'); return; }
          const id = nextIncId();
          db.put('incidentes', { id, titulo: t, severidade: fSev.value || 'S2', status: 'investigando', servicoIds: [...sel], inicioEm: now(), resolvidoEm: null, impacto: im, causa: '', avisoClientesEm: null, posmortem: null, linha: [{ ts: now(), autor: meName(), texto: 'Incidente aberto pelo Superadmin.' }] });
          log('incidente.aberto', { kind: 'incidente', id }, 'Incidente ' + id + ' aberto (' + (fSev.value || 'S2') + '): ' + t, 'R3');
          notifyOps('erro', 'Incidente ' + id + ' aberto', t, '/super/incidentes/' + id);
          ui.toast('Incidente ' + id + ' aberto', { type: 'warn', text: t });
          api.close(id);
        } })] });
    return m.promise;
  }

  function pgIncidente(ctx) {
    const id = ctx.params.id;
    const box = h('div');
    const draw = () => {
      const i = db.get('incidentes', id);
      if (!i) { C.mount(box, h('div.stack.sup-page', ui.pageHeader({ eyebrow: 'Superadmin · plataforma', back: '/super/incidentes', title: 'Incidente não encontrado' }),
        ui.empty({ icon: 'siren', title: 'Nada com este código', text: 'O incidente ' + id + ' não existe ou foi removido.', action: ui.btn('Ver incidentes', { variant: 'primary', route: '/super/incidentes' }) }))); return; }
      const steps = ['investigando', 'identificado', 'monitorando', 'resolvido'];
      const dur = (i.resolvidoEm || now()) - i.inicioEm;
      const semUp = now() - lastIncUpdate(i);
      const s1rest = i.severidade === 'S1' && i.status !== 'resolvido' ? Math.max(0, 2 * 3600e3 - (now() - i.inicioEm)) : null;
      const avisoH = i.avisoClientesEm ? fmt.dur(i.avisoClientesEm - i.inicioEm) : (i.status !== 'resolvido' ? fmt.dur(now() - i.inicioEm) : '—');
      const updWrap = ui.field({ label: 'Nova atualização' }, ui.input({ type: 'textarea', placeholder: 'O que mudou desde a última nota', aria: 'Texto da atualização' }));
      const updSt = ui.select({ aria: 'Mudar estado junto', value: '', options: [{ value: '', label: 'Manter o estado' }, { value: 'identificado', label: 'Identificado' }, { value: 'monitorando', label: 'Monitorando' }, { value: 'resolvido', label: 'Resolvido (pede causa e pós-mortem)' }] });
      C.mount(box, h('div.stack.sup-page',
        ui.pageHeader({ eyebrow: 'Superadmin · plataforma', back: '/super/incidentes', title: i.id, subtitle: i.titulo,
          actions: [i.status !== 'resolvido' ? ui.btn('Resolver', { variant: 'primary', icon: 'check', onclick: () => resolverIncidente(i.id) }) : null] }),
        h('div.row', sevBadge(i.severidade), incBadge(i.status)),
        s1rest !== null ? ui.callout({ tone: s1rest <= 0 ? 'danger' : 'warn', title: s1rest <= 0 ? 'Prazo de resposta S1 estourado' : 'Resposta S1: resta ' + fmt.dur(s1rest), text: 'Meta da plataforma: resposta em até 2 h. Sem atualização há ' + fmt.dur(semUp) + '.' }) : null,
        ui.stepper(['Investigando', 'Identificado', 'Monitorando', 'Resolvido'], steps.indexOf(i.status)),
        h('div.grid.g4.keep2', ui.kpi({ label: 'Duração', display: fmt.dur(dur), icon: 'timer' }),
          ui.kpi({ label: 'Sem atualização há', display: fmt.dur(semUp), icon: 'history' }),
          ui.kpi({ label: 'Aviso ao cliente', display: i.avisoClientesEm ? 'enviado em ' + avisoH : 'pendente (' + avisoH + ' / 36 h)', icon: 'send' })),
        ui.card({ title: 'Escopo e causa', subtitle: (i.servicoIds || []).map((s) => (db.get('servicos', s) || {}).nome || s).join(', ') || 'Sem serviço vinculado' },
          ui.kv([['Impacto', i.impacto], ['Causa provável', i.causa || 'Em apuração'], ['Abertura', fmt.datetime(i.inicioEm) + ' (' + fmt.rel(i.inicioEm) + ')'], i.resolvidoEm ? ['Resolução', fmt.datetime(i.resolvidoEm)] : null])),
        ui.card({ title: 'Linha do tempo', subtitle: 'Notas em ordem, com autor e hora.' },
          ui.timeline(i.linha.map((l) => ({ title: l.texto, ts: l.ts, actor: l.autor, icon: 'message-circle' })))),
        i.status !== 'resolvido' ? ui.card({ title: 'Adicionar atualização', subtitle: 'Fica na linha do tempo com o seu nome.' }, updWrap,
          h('div.row', updSt, ui.btn('Publicar atualização', { variant: 'secondary', icon: 'send', onclick: () => {
            const t = updWrap.querySelector('input,textarea').value.trim();
            if (t.length < 4) { updWrap.setError('Escreva a atualização.'); return; }
            const patch = { linha: i.linha.concat([{ ts: now(), autor: meName(), texto: t }]) };
            if (updSt.value === 'resolvido') { resolverIncidente(i.id); return; }
            if (updSt.value) patch.status = updSt.value;
            db.patch('incidentes', i.id, patch);
            log('incidente.atualizado', { kind: 'incidente', id: i.id }, 'Atualização em ' + i.id + (patch.status ? ' (estado: ' + patch.status + ')' : ''), 'R2');
            ui.toast('Atualização publicada', { type: 'ok', text: i.id });
          } }))) : null,
        i.status !== 'resolvido' ? ui.card({ title: 'Avisar clientes', subtitle: 'Compõe um aviso e envia a todas as orgs ativas. Fica registrado quando foi enviado.' },
          h('p.small.muted', i.avisoClientesEm ? 'Último aviso em ' + fmt.datetime(i.avisoClientesEm) + ' (' + fmt.rel(i.avisoClientesEm) + ').' : 'Nenhum aviso enviado. Referência: avisar em até 36 h.'),
          ui.btn(i.avisoClientesEm ? 'Reenviar aviso' : 'Avisar clientes', { variant: 'secondary', icon: 'send', onclick: () => avisarClientes(i.id) })) : null,
        i.status !== 'resolvido' ? null : (i.posmortem ? ui.card({ title: 'Pós-mortem', subtitle: 'Causa, correções e lições. Exigido para S1 e S2.' },
          ui.kv([['Causa raiz', i.posmortem.causa], ['Ações corretivas', i.posmortem.acoes], ['Lições', i.posmortem.licoes]])) : ui.callout({ tone: 'warn', title: 'Sem pós-mortem registrado', text: 'Incidentes S3 podem ser encerrados sem pós-mortem formal.' })),
      ));
    };
    draw();
    const live = ui.live(['incidentes'], () => { if (box.isConnected) draw(); });
    const root = h('div', live, box);
    return root;
  }
  async function avisarClientes(id) {
    const i = db.get('incidentes', id); if (!i) return;
    const fT = ui.field({ label: 'Título do aviso', required: true }, ui.input({ value: 'Instabilidade: ' + i.titulo, aria: 'Título do aviso' }));
    const fC = ui.field({ label: 'Mensagem', required: true }, ui.input({ type: 'textarea', value: 'Identificamos ' + i.titulo.toLowerCase() + '. Impacto: ' + (i.impacto || 'em apuração') + '. Nossa equipe atua na resolução e atualizaremos por este canal.', aria: 'Mensagem do aviso' }));
    const m = modal({ title: 'Avisar clientes', icon: 'send', size: 'md',
      body: h('div.stack', fT, fC, h('p.small.muted', 'O aviso chega a todas as empresas ativas e fica registrado na trilha.')),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }),
        ui.btn('Enviar aviso', { variant: 'primary', icon: 'send', onclick: () => {
          const t = fT.querySelector('input,textarea').value.trim(); const c = fC.querySelector('input,textarea').value.trim();
          if (t.length < 8) { fT.setError('Título curto demais.'); return; }
          if (c.length < 20) { fC.setError('Descreva a situação com mais detalhe.'); return; }
          notifyAllOrgs('alerta', t, c, '/super/incidentes/' + id);
          db.patch('incidentes', id, { avisoClientesEm: now(), linha: i.linha.concat([{ ts: now(), autor: meName(), texto: 'Aviso aos clientes enviado: ' + t }]) });
          log('incidente.aviso', { kind: 'incidente', id }, 'Aviso aos clientes enviado em ' + id + ': ' + t, 'R2');
          ui.toast('Aviso enviado', { type: 'ok', text: 'Todas as empresas ativas foram notificadas.' });
          api.close(true);
        } })] });
    await m.promise;
  }

  async function resolverIncidente(id) {
    const i = db.get('incidentes', id); if (!i || i.status === 'resolvido') return;
    const fCausa = ui.field({ label: 'Causa confirmada', required: true }, ui.input({ type: 'textarea', value: i.causa || '', placeholder: 'O que de fato causou o incidente', aria: 'Causa confirmada' }));
    let pm = null;
    if (i.severidade === 'S1' || i.severidade === 'S2') {
      pm = { causa: ui.field({ label: 'Causa raiz', required: true }, ui.input({ type: 'textarea', placeholder: 'Causa raiz do pós-mortem', aria: 'Causa raiz' })),
        acoes: ui.field({ label: 'Ações corretivas', required: true }, ui.input({ type: 'textarea', placeholder: 'Uma por linha', aria: 'Ações corretivas' })),
        licoes: ui.field({ label: 'Lições aprendidas', required: true }, ui.input({ type: 'textarea', placeholder: 'O que muda no processo', aria: 'Lições' })) };
    }
    const m = modal({ title: 'Resolver ' + id, icon: 'check', tone: 'green', size: 'md',
      body: h('div.stack', fCausa, pm ? h('div.stack', h('h4', 'Pós-mortem (obrigatório para ' + i.severidade + ')'), pm.causa, pm.acoes, pm.licoes) : h('p.small.muted', 'S3 dispensa pós-mortem formal, mas registre a causa.'),
        h('p.small.muted', 'Serviços afetados voltam a operacional ao resolver, salvo outro incidente aberto.')),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }),
        ui.btn('Resolver incidente', { variant: 'primary', onclick: () => {
          const causa = fCausa.querySelector('input,textarea').value.trim();
          if (causa.length < 8) { fCausa.setError('Registre a causa com mais detalhe.'); return; }
          let pos = i.posmortem || null;
          if (pm) {
            const c = pm.causa.querySelector('input,textarea').value.trim(); const a = pm.acoes.querySelector('input,textarea').value.trim(); const l = pm.licoes.querySelector('input,textarea').value.trim();
            if (c.length < 8) { pm.causa.setError('Descreva a causa raiz.'); return; }
            if (a.length < 8) { pm.acoes.setError('Liste ao menos uma ação corretiva.'); return; }
            if (l.length < 8) { pm.licoes.setError('Registre ao menos uma lição.'); return; }
            pos = { causa: c, acoes: a, licoes: l };
          }
          const patch = { status: 'resolvido', resolvidoEm: now(), causa, posmortem: pos, linha: i.linha.concat([{ ts: now(), autor: meName(), texto: 'Incidente resolvido. Causa: ' + causa }]) };
          db.patch('incidentes', id, patch);
          (i.servicoIds || []).forEach((s) => { if (!openForSvc(s).filter((x) => x.id !== id).length) { const sv = db.get('servicos', s); if (sv && sv.status !== 'operacional') db.patch('servicos', s, { status: 'operacional', ultimaChecagem: now() }); } });
          log('incidente.resolvido', { kind: 'incidente', id }, 'Incidente ' + id + ' resolvido. Causa: ' + causa, 'R3');
          notifyOps('sucesso', 'Incidente ' + id + ' resolvido', i.titulo, '/super/incidentes/' + id);
          ui.toast('Incidente resolvido', { type: 'ok', text: id });
          api.close(true);
        } })] });
    await m.promise;
  }
  /* -------------------------------- /super/ia -------------------------------- */
  const AG_META = {
    'ag-docs': { risco: 'R1', max: 'autonomo' }, 'ag-prevalidacao': { risco: 'R2', max: 'assistido' },
    'ag-preco': { risco: 'R2', max: 'assistido' }, 'ag-credito': { risco: 'R2', max: 'assistido' },
    'ag-conciliacao': { risco: 'R3', max: 'assistido' }, 'ag-cobranca': { risco: 'R1', max: 'autonomo' },
  };
  const NIVEIS = ['inativo', 'sombra', 'assistido', 'autonomo'];
  const maxPermitido = (ag) => ((AG_META[ag.id] || {}).max) || 'assistido';

  function pgIA(ctx) {
    let tab = (ctx.query && ctx.query.tab) || 'modelos';
    const box = h('div');
    function draw() {
      const cfg = db.cfg();
      const tabs = ui.tabs({ value: tab, items: [{ id: 'modelos', label: 'Modelos' }, { id: 'custo', label: 'Uso e custo' }, { id: 'agentes', label: 'Agentes' }, { id: 'avaliacoes', label: 'Avaliações' }, { id: 'guardrails', label: 'Guardrails' }],
        onChange: (v) => { tab = v; C.router.go('/super/ia?tab=' + v, { replace: true }); draw(); } });
      let corpo = null;
      if (tab === 'modelos') corpo = iaModelos(cfg);
      else if (tab === 'custo') corpo = iaCusto(cfg);
      else if (tab === 'agentes') corpo = iaAgentes();
      else if (tab === 'avaliacoes') corpo = iaAval();
      else corpo = iaGuards(cfg);
      C.mount(box, h('div.stack.sup-page',
        ui.pageHeader({ eyebrow: 'Superadmin · plataforma', back: '/super', title: 'IA e agentes',
          subtitle: 'A IA propõe, o motor decide, a pessoa garante. Modelos, custo, autonomia e guardrails com trilha.',
          actions: [ui.btn('Ver saúde', { variant: 'ghost', icon: 'heart-pulse', route: '/super' })] }),
        ui.callout({ tone: 'info', icon: 'sparkles', title: 'Gateway de IA', text: 'Nenhum modelo decide sozinho: propostas passam pelo motor e uma pessoa aprova (portão humano R3). Séries e amostras marcadas como simuladas.' }),
        tabs, corpo));
    }
    draw();
    return h('div', ui.live(['modelosIA', 'usoIA', 'agentes', 'config'], () => { if (box.isConnected) draw(); }), box);
  }

  function iaModelos(cfg) {
    const rows = db.all('modelosIA').sort((a, b) => a.nome.localeCompare(b.nome));
    return ui.table({ rows, rowKey: (r) => r.id,
      empty: ui.empty({ icon: 'bot', title: 'Sem modelos', text: 'Nenhum modelo cadastrado no gateway.' }),
      columns: [
        { key: 'nome', label: 'Modelo', mobile: 'primary', render: (m) => h('div.cell-main', h('strong', m.nome + (cfg.ia.provedorPadrao === m.id ? ' · padrão' : '')), h('small.muted', m.provedor + ' · ' + m.regiao + ' · prompt ' + m.versaoPrompt)) },
        { key: 'res', label: 'Residência', mobile: 'hide', render: (m) => resBadge(m.residenciaBR) },
        { key: 'st', label: 'Estado', render: (m) => ui.badge({ ativo: 'Ativo', sombra: 'Sombra', inativo: 'Inativo' }[m.status] || m.status, m.status === 'ativo' ? 'green' : m.status === 'sombra' ? 'blue' : 'neutral', { dot: true }) },
        { key: 'uso', label: 'Agentes', mobile: 'hide', render: (m) => h('small', (m.usos || []).map((a) => agentShort(db.get('agentes', a) || { nome: a })).join(', ') || '—') },
        { key: 'custo', label: 'Custo / 1k', align: 'right', mobile: 'hide', render: (m) => h('small.nowrap', fmt.brl(m.custo1kIn) + ' / ' + fmt.brl(m.custo1kOut)) },
        { key: 'ac', label: 'Ações', render: (m) => h('div.row', m.status !== 'ativo' ? ui.btn('Ativar', { size: 'sm', variant: 'secondary', onclick: () => mudarModelo(m.id, 'ativo') }) : null,
          m.status !== 'sombra' ? ui.btn('Sombra', { size: 'sm', variant: 'ghost', onclick: () => mudarModelo(m.id, 'sombra') }) : null,
          cfg.ia.provedorPadrao !== m.id ? ui.btn('Padrão', { size: 'sm', variant: 'ghost', onclick: () => setModeloPadrao(m.id) }) : null) },
      ] });
  }

  async function mudarModelo(id, novo) {
    const m = db.get('modelosIA', id); if (!m) return;
    if (novo === 'ativo' && !m.residenciaBR && db.cfg().ia.residenciaBR) {
      ui.toast('Residência BR bloqueou a ativação', { type: 'err', text: m.nome + ' processa em ' + m.regiao + '. Rode em sombra ou desligue a exigência com justificativa.' });
      return;
    }
    const ok = await ui.confirm({ title: (novo === 'ativo' ? 'Ativar ' : novo === 'sombra' ? 'Mover para sombra: ' : 'Inativar ') + m.nome + '?', icon: 'bot',
      text: novo === 'ativo' ? 'O modelo passa a responder pelos agentes vinculados.' : novo === 'sombra' ? 'O modelo só observa e compara, sem decidir nem responder.' : 'Os agentes vinculados ficam sem este modelo até outra escolha.',
      confirmLabel: 'Confirmar' });
    if (!ok) return;
    db.patch('modelosIA', id, { status: novo });
    log('ia.modelo', { kind: 'modeloIA', id }, 'Modelo ' + m.nome + ' movido para ' + novo, 'R2');
    notifyOps('info', 'Modelo ' + novo + ': ' + m.nome, 'Gateway de IA atualizado pelo Superadmin.', '/super/ia?tab=modelos');
    ui.toast('Modelo atualizado', { type: 'ok', text: m.nome + ' em ' + novo + '.' });
  }
  async function setModeloPadrao(id) {
    const m = db.get('modelosIA', id); if (!m) return;
    if (!m.residenciaBR && db.cfg().ia.residenciaBR) {
      ui.toast('Residência BR bloqueou o padrão', { type: 'err', text: m.nome + ' processa fora do Brasil. Escolha um modelo com residência BR.' });
      return;
    }
    const ok = await ui.confirm({ title: 'Definir ' + m.nome + ' como padrão?', icon: 'bot', text: 'Novos agentes passam a usar este modelo. A troca fica na trilha.', confirmLabel: 'Definir padrão' });
    if (!ok) return;
    const cfg = db.cfg(); db.setCfg({ ia: Object.assign({}, cfg.ia, { provedorPadrao: id }) });
    log('ia.padrao', { kind: 'modeloIA', id }, 'Modelo padrão do gateway: ' + m.nome, 'R2');
    ui.toast('Padrão atualizado', { type: 'ok', text: m.nome });
  }

  function iaCusto(cfg) {
    const t = C.cal.sp(now()); const ini = C.cal.spTs(t.y, t.m, 1, 0, 0);
    const fim = C.cal.spTs(t.m === 12 ? t.y + 1 : t.y, t.m === 12 ? 1 : t.m + 1, 1, 0, 0);
    const rows = db.where('usoIA', (u) => u.dia >= ini && u.dia < fim);
    const custo = R2(C.sum(rows, (u) => u.custoBRL));
    const teto = cfg.ia.tetoCustoMesBRL || 4000;
    const porAg = {};
    rows.forEach((u) => { porAg[u.agenteId] = (porAg[u.agenteId] || 0) + u.custoBRL; });
    const hb = Object.keys(porAg).map((a) => ({ label: agentShort(db.get('agentes', a) || { nome: a }), value: R2(porAg[a]) })).sort((a, b) => b.value - a.value);
    const dias = {}; rows.forEach((u) => { const d = C.cal.sp(u.dia); const k = String(d.d).padStart(2, '0') + '/' + String(d.m).padStart(2, '0'); dias[k] = dias[k] || { c: 0, lat: [], err: 0, req: 0 }; dias[k].c += u.custoBRL; dias[k].lat.push(u.latMs); dias[k].err += u.erros; dias[k].req += u.reqs; });
    const cats = Object.keys(dias);
    const fTeto = ui.field({ label: 'Teto mensal (R$)', required: true }, ui.numeric({ value: teto, aria: 'Teto mensal em reais' }));
    const fFb = ui.switch({ label: 'Fallback automático', hint: 'Sem cota ou com erro, a fila retenta em modelo local antes de falhar.', checked: !!cfg.ia.fallback });
    return h('div.stack',
      ui.card({ title: 'Custo do mês', subtitle: 'Somado do uso diário por agente (telemetria simulada). Teto de referência: ' + fmt.brl(teto, { round: true }) + '.' },
        h('div.grid.g4.keep2', ui.kpi({ label: 'Gasto até agora', display: fmt.brl(custo), tone: custo > teto ? 'red' : custo > teto * 0.8 ? 'amber' : undefined, icon: 'coins' }),
          ui.kpi({ label: 'Projeção do mês', display: fmt.brl(R2(custo * 30 / Math.max(1, t.d))), icon: 'trending-up' })),
        ui.progress(Math.min(100, (custo / teto) * 100), { tone: custo > teto ? 'red' : custo > teto * 0.8 ? 'amber' : undefined, thin: true }),
        h('p.small.muted', fmt.brl(custo) + ' de ' + fmt.brl(teto) + (custo > teto ? ' (acima do teto)' : ''))),
      ui.card({ title: 'Custo diário', subtitle: 'Simulado a partir do uso registrado.' }, ui.chart.line({ series: [{ name: 'Custo (R$)', tone: 'violet', data: cats.map((c) => ({ x: c, y: R2(dias[c].c) })) }], height: 180, format: (v) => fmt.brl(v) })),
      ui.card({ title: 'Custo por agente', subtitle: 'Mês atual, em reais.' }, hb.length ? ui.chart.hbars(hb, { format: (v) => fmt.brl(v) }) : h('p.muted', 'Sem uso no mês.')),
      ui.card({ title: 'Amostra de uso (tokens)', subtitle: 'Últimos dias com volume, em milhares de tokens.' },
        ui.table({ rows: rows.sort((a, b) => b.dia - a.dia).slice(0, 10), rowKey: (r) => r.id,
          columns: [{ key: 'dia', label: 'Dia', render: (u) => h('small', fmt.date(u.dia)) },
            { key: 'ag', label: 'Agente', mobile: 'primary', render: (u) => h('strong.small', agentShort(db.get('agentes', u.agenteId) || { nome: u.agenteId })) },
            { key: 'req', label: 'Reqs', align: 'right', render: (u) => h('span.num', u.reqs) },
            { key: 'tok', label: 'Tokens in/out', align: 'right', mobile: 'hide', render: (u) => h('small.nowrap', fmt.num(u.tokensIn) + ' / ' + fmt.num(u.tokensOut)) },
            { key: 'c', label: 'Custo', align: 'right', render: (u) => h('span.num', fmt.brl(u.custoBRL)) }] })),
      ui.card({ title: 'Orçamento do gateway', subtitle: 'Teto e fallback. A alteração vai para aprovação? Não: aplica direto com trilha R2.' }, fTeto, fFb,
        ui.btn('Salvar orçamento', { variant: 'primary', onclick: () => {
          const v = Number(String(fTeto.querySelector('input').value).replace(/\D/g, ''));
          if (!(v >= 500 && v <= 100000)) { fTeto.setError('Use entre R$ 500 e R$ 100.000.'); return; }
          fTeto.setError(null);
          const c0 = db.cfg(); db.setCfg({ ia: Object.assign({}, c0.ia, { tetoCustoMesBRL: v, fallback: !!fFb.value }) });
          log('ia.orcamento', { kind: 'config', id: 'ia' }, 'Orçamento de IA: teto ' + fmt.brl(v) + ', fallback ' + (!!fFb.value ? 'ligado' : 'desligado'), 'R2');
          ui.toast('Orçamento salvo', { type: 'ok', text: 'Teto de ' + fmt.brl(v) + '.' });
        } })));
  }
  function iaAgentes() {
    const cfg = db.cfg();
    const agentes = db.all('agentes').sort((a, b) => a.nome.localeCompare(b.nome));
    const kill = ui.btn(cfg.flags && cfg.flags.agentes === false ? 'Retomar agentes' : 'Pausar todos (kill-switch)', { variant: 'danger', icon: 'octagon-pause', onclick: () => killSwitch() });
    return h('div.stack',
      cfg.flags && cfg.flags.agentes === false ? ui.callout({ tone: 'danger', title: 'Agentes pausados globalmente', text: 'Nenhum agente propõe até a retomada. A Mesa decide sem resumos. A pausa e a retomada ficam na trilha (R3).' }) : null,
      ui.card({ title: 'Controle global', subtitle: 'Kill-switch: pausa todos de uma vez com frase de confirmação.', actions: [kill] },
        h('p.small.muted', 'Agentes pausados individualmente mostram selo próprio. O interruptor global usa a flag agentes do motor.')),
      ui.table({ rows: agentes, rowKey: (r) => r.id,
        empty: ui.empty({ icon: 'bot', title: 'Sem agentes', text: 'Nenhum agente cadastrado.' }),
        columns: [
          { key: 'nome', label: 'Agente', mobile: 'primary', render: (a) => h('div.cell-main', h('strong', agentShort(a)), h('small.muted', a.escopo)) },
          { key: 'nv', label: 'Nível', render: (a) => ui.badge(a.nivel, a.nivel === 'autonomo' ? 'violet' : a.nivel === 'assistido' ? 'blue' : a.nivel === 'sombra' ? 'neutral' : 'neutral', { dot: true }) },
          { key: 'max', label: 'Teto', mobile: 'hide', render: (a) => h('small', 'máx. ' + maxPermitido(a)) },
          { key: 'cl', label: 'Classe', mobile: 'hide', render: (a) => ui.badge(a.classe, a.classe === 'R3' ? 'red' : a.classe === 'R2' ? 'amber' : 'green') },
          { key: 'ex', label: '30 d', align: 'right', mobile: 'hide', render: (a) => h('small.nowrap', (a.metricas ? a.metricas.execucoes30d : 0) + ' exec.') },
          { key: 'ac', label: 'Ações', render: (a) => h('div.row', ui.btn('Nivelar', { size: 'sm', variant: 'ghost', onclick: () => nivelarAgente(a.id) }),
            a.nivel === 'inativo' ? ui.btn('Retomar', { size: 'sm', variant: 'secondary', onclick: () => pausarAgente(a.id, false) }) : ui.btn('Pausar', { size: 'sm', variant: 'ghost', onclick: () => pausarAgente(a.id, true) })) },
        ] }));
  }

  async function nivelarAgente(id) {
    const a = db.get('agentes', id); if (!a) return;
    const max = maxPermitido(a);
    const permitidos = NIVEIS.filter((n) => NIVEIS.indexOf(n) <= NIVEIS.indexOf(max));
    const sel = ui.select({ aria: 'Nível máximo', value: a.nivel, options: NIVEIS.map((n) => ({ value: n, label: n + (NIVEIS.indexOf(n) > NIVEIS.indexOf(max) ? ' (bloqueado pelo teto do agente)' : ''), disabled: NIVEIS.indexOf(n) > NIVEIS.indexOf(max) })) });
    const m = modal({ title: 'Nivelar ' + agentShort(a), icon: 'gauge', size: 'sm',
      body: h('div.stack', ui.field({ label: 'Nível de autonomia' }, sel),
        h('p.small.muted', 'Regra: R3 e R2 param em assistido; R1 chega a autônomo. ' + a.nome + ' é ' + a.classe + ', teto ' + max + '.')),
      footer: (api) => [ui.btn('Voltar', { variant: 'ghost', onclick: () => api.close(false) }),
        ui.btn('Aplicar nível', { variant: 'primary', onclick: () => {
          const v = sel.value;
          if (NIVEIS.indexOf(v) > NIVEIS.indexOf(max)) { ui.toast('Nível bloqueado pelo teto do agente', { type: 'err', text: a.classe + ' não passa de ' + max + '.' }); return; }
          db.patch('agentes', id, { nivel: v, nivelMaximo: max });
          log('ia.agente.nivel', { kind: 'agente', id }, 'Agente ' + agentShort(a) + ' nivelado em ' + v + ' (teto ' + max + ')', 'R3');
          ui.toast('Nível aplicado', { type: 'ok', text: agentShort(a) + ' em ' + v + '.' });
          api.close(true);
        } })] });
    await m.promise;
  }

  async function pausarAgente(id, pausar) {
    const a = db.get('agentes', id); if (!a) return;
    const ok = await ui.confirm({ title: (pausar ? 'Pausar ' : 'Retomar ') + agentShort(a) + '?', icon: pausar ? 'pause' : 'play',
      text: pausar ? 'O agente para de propor até a retomada. A Mesa decide sem o resumo dele.' : 'O agente volta a propor no nível ' + a.nivel + '.',
      confirmLabel: pausar ? 'Pausar agente' : 'Retomar agente' });
    if (!ok) return;
    db.patch('agentes', id, { nivel: pausar ? 'inativo' : (a.nivelMaximo && a.nivelMaximo !== 'autonomo' ? 'assistido' : 'sombra') });
    const volta = db.get('agentes', id);
    if (!pausar && volta.nivel === 'sombra' && NIVEIS.indexOf('sombra') > NIVEIS.indexOf(maxPermitido(a))) db.patch('agentes', id, { nivel: 'assistido' });
    log('ia.agente.' + (pausar ? 'pausado' : 'retomado'), { kind: 'agente', id }, 'Agente ' + agentShort(a) + (pausar ? ' pausado' : ' retomado'), 'R2');
    ui.toast(pausar ? 'Agente pausado' : 'Agente retomado', { type: pausar ? 'warn' : 'ok', text: agentShort(a) });
  }

  async function killSwitch() {
    const cfg = db.cfg();
    const desligado = cfg.flags && cfg.flags.agentes === false;
    if (!desligado) {
      const ok = await confirmPhrase({ phrase: 'PAUSAR AGENTES', title: 'Pausar todos os agentes?', icon: 'octagon-pause',
        text: `Todos os ${db.all('agentes').length} agentes param de propor e de responder agora, inclusive o agente de atendimento (as conversas seguem só com pessoas). A Mesa decide sem resumos até a retomada. Ação crítica com trilha R3 e aviso à operação.` });
      if (!ok) return;
      db.setCfg({ flags: Object.assign({}, cfg.flags, { agentes: false }) });
      db.all('agentes').forEach((a) => db.patch('agentes', a.id, { nivelAnterior: a.nivel, nivel: 'inativo' }));
      log('ia.killswitch', { kind: 'config', id: 'agentes' }, 'Kill-switch acionado por ' + meName() + ': todos os agentes pausados', 'R3');
      notifyOps('erro', 'Kill-switch: agentes pausados', 'Todas as propostas de IA suspensas pelo Superadmin.', '/super/ia?tab=agentes');
      ui.toast('Agentes pausados', { type: 'err', text: 'Kill-switch acionado. Retome quando a causa sair.' });
    } else {
      const ok = await ui.confirm({ title: 'Retomar todos os agentes?', icon: 'play', text: 'Cada agente volta ao nível anterior à pausa.', confirmLabel: 'Retomar todos' });
      if (!ok) return;
      db.setCfg({ flags: Object.assign({}, cfg.flags, { agentes: true }) });
      db.all('agentes').forEach((a) => db.patch('agentes', a.id, { nivel: a.nivelAnterior && a.nivelAnterior !== 'inativo' ? a.nivelAnterior : 'sombra' }));
      log('ia.killswitch.retomado', { kind: 'config', id: 'agentes' }, 'Kill-switch revertido por ' + meName() + ': agentes retomados', 'R3');
      notifyOps('sucesso', 'Agentes retomados', 'Propostas de IA voltaram a fluir.', '/super/ia?tab=agentes');
      ui.toast('Agentes retomados', { type: 'ok', text: 'Propostas voltaram a fluir.' });
    }
  }
  function iaAval() {
    const agentes = db.all('agentes');
    const acordo = agentes.map((a) => ({ ag: a, acordo: a.metricas && a.metricas.execucoes30d ? R2((a.metricas.aceitas || 0)) : null }));
    const casos = db.where('propostas', () => true).sort((a, b) => b.ts - a.ts).slice(0, 8);
    return h('div.stack',
      ui.card({ title: 'Taxa de aceite por agente', subtitle: 'Propostas aceitas sobre decididas em 30 dias (simulado).' },
        ui.chart.bars({ categories: acordo.map((r) => agentShort(r.ag)), series: [{ name: 'Aceite', tone: 'violet', data: acordo.map((r) => Math.round((r.acordo || 0) * 100)) }], height: 200, format: (v) => v + '%' })),
      ui.card({ title: 'Sombra contra real', subtitle: 'Amostra: o que o agente sugeriu e o que a Mesa decidiu (simulado).' },
        ui.table({ rows: casos, rowKey: (r) => r.id,
          empty: ui.empty({ icon: 'git-compare', title: 'Sem casos', text: 'Nenhuma proposta registrada para comparar.' }),
          columns: [
            { key: 'ag', label: 'Agente', mobile: 'primary', render: (p) => h('strong.small', agentShort(db.get('agentes', p.agenteId) || { nome: p.agenteId })) },
            { key: 'res', label: 'Sugestão', mobile: 'hide', render: (p) => h('small', p.resumo) },
            { key: 'st', label: 'Decisão', render: (p) => ui.badge(p.status, p.status === 'aprovada' ? 'green' : p.status === 'rejeitada' ? 'red' : 'neutral') },
            { key: 'cf', label: 'Confiança', align: 'right', mobile: 'hide', render: (p) => h('span.num', Math.round((p.confianca || 0) * 100) + '%') },
          ] })),
      ui.card({ title: 'Últimos erros', subtitle: 'Falhas de proposta ou timeout por agente (da trilha e do uso).' },
        h('div.stack.tight', agentes.slice(0, 6).map((a) => h('div.row', icon('bot', 15),
          h('span.grow', h('strong.small', agentShort(a)), h('div.small.muted', 'correções: ' + Math.round(((a.metricas || {}).correcoes || 0) * 100) + '% · tempo médio ' + ((a.metricas || {}).tempoMedio || '—'))),
          ui.badge(a.nivel, 'neutral'))))));
  }

  const GUARDS = [
    { id: 'humano-r3', nome: 'Portão humano em R3', texto: 'Nada de dinheiro, cessão ou taxa sai sem aprovação de uma pessoa.', fixo: true },
    { id: 'sem-decisao', nome: 'LLM nunca decide', texto: 'Modelo sugere e resume; quem decide é o motor (regras) e a Mesa (pessoas).', fixo: true },
    { id: 'residencia', nome: 'Residência BR', texto: 'Com a exigência ligada, modelo fora do Brasil não ativa nem vira padrão.', chave: 'residenciaBR' },
    { id: 'pii', nome: 'Remoção de dados pessoais', texto: 'CPF, telefone e e-mail saem do prompt antes do envio ao modelo.', chave: 'pii' },
    { id: 'injection', nome: 'Barreira a injeção de prompt', texto: 'Anexos e textos de cliente passam por filtro antes de virar contexto.', chave: 'injection' },
    { id: 'teto', nome: 'Teto de custo com trava', texto: 'Acima do teto, o gateway usa fila e modelo local antes de chamar o pago.', chave: 'teto' },
  ];
  function iaGuards(cfg) {
    const g = cfg.ia.guards || { pii: true, injection: true, teto: true };
    const swRes = ui.switch({ label: 'Exigir residência BR', hint: 'Bloqueia ativação e padrão de modelo fora do Brasil.', checked: !!cfg.ia.residenciaBR });
    const cards = GUARDS.map((gd) => {
      if (gd.chave === 'residenciaBR') return ui.card({ title: gd.nome, subtitle: gd.texto }, swRes,
        ui.btn('Aplicar exigência', { variant: 'primary', size: 'sm', onclick: async () => {
          const antes = !!cfg.ia.residenciaBR; const depois = !!swRes.value;
          if (antes === depois) { ui.toast('Sem mudança', { type: 'info', text: 'A exigência segue ' + (depois ? 'ligada' : 'desligada') + '.' }); return; }
          let motivo = '';
          if (!depois) { motivo = await reasonModal('Desligar residência BR', 'Justificativa'); if (!motivo) return; }
          else { const ok = await ui.confirm({ title: 'Ligar residência BR?', text: 'Modelos ativos fora do Brasil passam a constar como pendência até irem para sombra.', confirmLabel: 'Ligar exigência' }); if (!ok) return; }
          db.setCfg({ ia: Object.assign({}, db.cfg().ia, { residenciaBR: depois }) });
          log('ia.residencia', { kind: 'config', id: 'ia' }, 'Residência BR ' + (depois ? 'ligada' : 'desligada por ' + meName() + ': ' + motivo), 'R3');
          notifyOps('info', 'Residência BR ' + (depois ? 'ligada' : 'desligada'), motivo || 'Exigência atualizada.', '/super/ia?tab=guardrails');
          ui.toast('Residência atualizada', { type: depois ? 'ok' : 'warn', text: depois ? 'Exigência ligada.' : 'Exigência desligada com justificativa.' });
        } }));
      if (gd.fixo) return ui.card({ title: gd.nome, subtitle: gd.texto }, ui.badge('Sempre ligado', 'green', { icon: 'lock' }));
      const chave = gd.chave;
      const sw = ui.switch({ label: 'Ligado', checked: g[chave] !== false });
      return ui.card({ title: gd.nome, subtitle: gd.texto + ' (simulado: controle de demonstração).' }, sw,
        ui.btn('Salvar', { variant: 'secondary', size: 'sm', onclick: () => {
          const gg = Object.assign({}, db.cfg().ia.guards || {}, { [chave]: !!sw.value });
          db.setCfg({ ia: Object.assign({}, db.cfg().ia, { guards: gg }) });
          log('ia.guard', { kind: 'config', id: 'ia' }, 'Guardrail ' + gd.nome + ' ' + (!!sw.value ? 'ligado' : 'desligado'), 'R2');
          ui.toast('Guardrail salvo', { type: 'ok', text: gd.nome });
        } }));
    });
    return h('div.stack', ui.callout({ tone: 'info', title: 'Guardrails do gateway', text: 'Dois nunca desligam (portão humano e LLM sem decisão). Os demais têm interruptor com trilha.' }), ...cards);
  }
  /* ------------------------------ /super/mercado ------------------------------ */
  function pgMercado() {
    const box = h('div');
    function draw() {
      const cfg = db.cfg();
      const abertas = db.where('operacoes', (o) => o.status === 'aberta');
      const valorAberto = R2(C.sum(abertas, (o) => o.face || 0));
      const flags = Object.keys(FLAG_META);
      const mudancas = C.store.ledger.all().filter((e) => /mercado|manutencao|flag|config/.test(e.acao)).slice(-8).reverse();
      C.mount(box, h('div.stack.sup-page',
        ui.pageHeader({ eyebrow: 'Superadmin · plataforma', back: '/super', title: 'Mercado e funcionalidades', subtitle: 'Pausar, avisar e ligar ou desligar canais com impacto medido e trilha.' }),
        cfg.mercadoPausado ? ui.callout({ tone: 'danger', title: 'Mercado pausado', text: abertas.length + ' operações abertas (' + fmt.brl(valorAberto) + ') pararam de receber lances. Novas publicações devolvem erro MERCADO_PAUSADO e a faixa avisa todos os perfis.' })
          : ui.callout({ tone: 'info', title: 'Mercado aberto', text: abertas.length + ' operações em leilão somam ' + fmt.brl(valorAberto) + '. Pausar trava lances e publicações na hora.' }),
        ui.card({ title: cfg.mercadoPausado ? 'Retomar o mercado' : 'Pausar o mercado', subtitle: 'Ação crítica com frase de confirmação, motivo, trilha R3 e aviso a todas as orgs.' },
          ui.btn(cfg.mercadoPausado ? 'Retomar mercado' : 'Pausar mercado', { variant: cfg.mercadoPausado ? 'primary' : 'danger', icon: 'octagon-pause', onclick: () => pausarMercado() })),
        ui.card({ title: 'Modo de manutenção', subtitle: 'Faixa para todos os perfis com a mensagem e o horário. Pré-visualize antes de ligar.' },
          manutencaoForm(),
          cfg.manutencao && cfg.manutencao.ativo ? h('div.banner.banner-warn', { role: 'status' }, icon('triangle-alert', 16), h('span.banner-t', h('strong', 'Pré-visualização: '), cfg.manutencao.msg || 'a plataforma pode oscilar.', cfg.manutencao.ate ? ' até ' + fmt.datetime(cfg.manutencao.ate) : '')) : null),
        ui.card({ title: 'Funcionalidades', subtitle: 'Cada mudança pede confirmação; desligar Vitrine, Balcão ou importação é R3 com motivo e mostra o impacto agora.' },
          h('div.stack.tight', flags.map((k) => flagRow(k)))),
        ui.card({ title: 'Linha do tempo de mudanças', subtitle: 'Últimas alterações de mercado, manutenção e flags na trilha.' },
          mudancas.length ? ui.timeline(mudancas.map((e) => ({ title: e.resumo, ts: e.ts, actor: (e.actor || {}).nome || 'sistema', icon: 'toggle-right' }))) : h('p.muted', 'Sem mudanças registradas.'))));
    }
    function flagRow(k) {
      const cfg = db.cfg(); const meta = flagMeta(k); const on = (cfg.flags || {})[k] !== false;
      const sw = ui.switch({ label: meta.nome, hint: meta.afeta + ' Impacto agora: ' + meta.conta(), checked: on, onChange: () => toggleFlag(k, !on, () => { if (sw.isConnected) sw.value = on; }) });
      return h('div.sup-flag', sw, ui.badge(meta.risco, meta.risco === 'R3' ? 'red' : 'amber'), !on ? ui.badge('Desligado', 'neutral') : null);
    }
    draw();
    return h('div', ui.live(['config', 'operacoes', 'propostas', 'ledger'], () => { if (box.isConnected) draw(); }), box);
  }

  async function pausarMercado() {
    const cfg = db.cfg();
    if (!cfg.mercadoPausado) {
      const ok = await confirmPhrase({ phrase: 'PAUSAR MERCADO', title: 'Pausar o mercado?', icon: 'octagon-pause', withReason: true,
        text: 'Lances e publicações param agora. Operações em andamento seguem. Todas as empresas recebem aviso e a trilha registra R3 com o seu nome.' });
      if (!ok) return;
      const motivo = typeof ok === 'string' ? ok : 'pausa operacional';
      db.setCfg({ mercadoPausado: true });
      const t = fmt.datetime(now());
      log('mercado.pausado', { kind: 'config', id: 'mercado' }, 'Mercado pausado por ' + meName() + ' em ' + t + '. Motivo: ' + motivo, 'R3');
      notifyAllOrgs('alerta', 'Mercado pausado pela plataforma', 'Novos lances e publicações suspensos. Motivo: ' + motivo, '/super/mercado');
      ui.toast('Mercado pausado', { type: 'err', text: 'Lances e publicações suspensos.' });
    } else {
      const ok = await ui.confirm({ title: 'Retomar o mercado?', icon: 'play', text: 'Lances e publicações voltam na hora. A trilha registra a retomada com o seu nome.', confirmLabel: 'Retomar mercado' });
      if (!ok) return;
      db.setCfg({ mercadoPausado: false });
      log('mercado.retomado', { kind: 'config', id: 'mercado' }, 'Mercado retomado por ' + meName(), 'R3');
      notifyAllOrgs('info', 'Mercado retomado', 'Lances e publicações voltaram ao normal.', '/super/mercado');
      ui.toast('Mercado retomado', { type: 'ok', text: 'Lances e publicações liberados.' });
    }
  }
  function manutencaoForm() {
    const cfg = db.cfg(); const m = cfg.manutencao || { ativo: false, msg: '', ate: null };
    const fMsg = ui.field({ label: 'Mensagem da faixa' }, ui.input({ value: m.msg || '', placeholder: 'Ex.: manutenção programada, a plataforma pode oscilar', aria: 'Mensagem de manutenção' }));
    const fAte = ui.date({ value: m.ate || null, aria: 'Manutenção até', onChange: () => {} });
    const ativo = m.ativo;
    return h('div.stack.tight', fMsg, fAte,
      h('div.row', !ativo ? ui.btn('Ativar manutenção', { variant: 'secondary', icon: 'settings', onclick: async () => {
          const msg = fMsg.querySelector('input,textarea').value.trim();
          if (msg.length < 8) { fMsg.setError('Escreva a mensagem que os usuários vão ver.'); return; }
          fMsg.setError(null);
          const ate = fAte.value || null;
          const ok = await ui.confirm({ title: 'Ativar manutenção?', icon: 'settings', text: 'A faixa aparece para todos os perfis agora' + (ate ? ' até ' + fmt.datetime(ate) : '') + '.', confirmLabel: 'Ativar faixa' });
          if (!ok) return;
          db.setCfg({ manutencao: { ativo: true, msg, ate } });
          log('manutencao.ativada', { kind: 'config', id: 'manutencao' }, 'Manutenção ativada por ' + meName() + ': ' + msg, 'R2');
          ui.toast('Manutenção ativada', { type: 'warn', text: 'Faixa visível para todos os perfis.' });
        } }) : ui.btn('Desativar manutenção', { variant: 'primary', onclick: async () => {
          const ok = await ui.confirm({ title: 'Desativar manutenção?', text: 'A faixa some para todos os perfis.', confirmLabel: 'Desativar' });
          if (!ok) return;
          db.setCfg({ manutencao: { ativo: false, msg: m.msg || '', ate: null } });
          log('manutencao.desativada', { kind: 'config', id: 'manutencao' }, 'Manutenção desativada por ' + meName(), 'R2');
          ui.toast('Manutenção desativada', { type: 'ok', text: 'Faixa removida.' });
        } })));
  }

  async function toggleFlag(k, ligar, revert) {
    const meta = flagMeta(k);
    const cfg = db.cfg();
    const back = () => { if (revert) revert(); };
    if (meta.risco === 'R3' && !ligar) {
      const motivo = await reasonModal('Desligar ' + meta.nome, 'Motivo do desligamento');
      if (!motivo) { back(); return; }
      db.setCfg({ flags: Object.assign({}, cfg.flags, { [k]: false }) });
      log('flag.desligada', { kind: 'config', id: k }, meta.nome + ' desligado por ' + meName() + ': ' + motivo + '. ' + meta.conta(), 'R3');
      notifyOps('alerta', meta.nome + ' desligado', motivo, '/super/mercado');
      ui.toast(meta.nome + ' desligado', { type: 'warn', text: 'Impacto: ' + meta.conta() });
    } else {
      const ok = await ui.confirm({ title: (ligar ? 'Ligar ' : 'Desligar ') + meta.nome + '?', icon: 'toggle-right',
        text: meta.afeta + ' Impacto agora: ' + meta.conta() + '.', confirmLabel: ligar ? 'Ligar' : 'Desligar' });
      if (!ok) { back(); return; }
      db.setCfg({ flags: Object.assign({}, cfg.flags, { [k]: !!ligar }) });
      log('flag.' + (ligar ? 'ligada' : 'desligada'), { kind: 'config', id: k }, meta.nome + (ligar ? ' ligado' : ' desligado') + ' por ' + meName(), meta.risco);
      ui.toast(meta.nome + (ligar ? ' ligado' : ' desligado'), { type: ligar ? 'ok' : 'warn', text: meta.conta() });
    }
  }

  /* --------------------------------- rotas --------------------------------- */
  C.router.register([
    { path: '/super', roles: ['ops'], perfis: ['superadmin'], title: 'Saúde da plataforma', render: pgSuper },
    { path: '/super/servicos', roles: ['ops'], perfis: ['superadmin'], title: 'Serviços e integrações', render: pgServicos },
    { path: '/super/incidentes', roles: ['ops'], perfis: ['superadmin'], title: 'Incidentes', render: pgIncidentes },
    { path: '/super/incidentes/:id', roles: ['ops'], perfis: ['superadmin'], title: (ctx) => { const i = db.get('incidentes', ctx.params.id); return i ? i.id : 'Incidente'; }, render: pgIncidente },
    { path: '/super/ia', roles: ['ops'], perfis: ['superadmin'], title: 'IA e agentes', render: pgIA },
    { path: '/super/mercado', roles: ['ops'], perfis: ['superadmin'], title: 'Mercado e funcionalidades', render: pgMercado },
  ]);
})();
