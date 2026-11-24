/* =========================================================================
   Cedy, Central de Comunicação, comunicados (S5): motor E.com.comunicado.
   Regras CC-19 e CC-20. Informativo: a Mesa emite e agenda. Contratual:
   rascunho da Mesa, aprovação de outro Superadmin (quatro olhos), com
   vigência, ciência por empresa e histórico imutável.
   ========================================================================= */
(function () {
  const C = window.Cedy;
  const { db, session, ledger, notify } = C.store;
  const E = C.engine; const K = E.com;
  const A = E.actors;
  const now = () => C.clock.now();
  const fail = (erro, codigo, extra) => Object.assign({ ok: false, erro, codigo }, extra || {});
  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const M = (E.com.comunicado = {});

  const U = (id) => db.get('users', id);
  const orgOf = (u) => u && db.get('orgs', u.orgId);

  /* Somente leitura no "ver como": segue o padrão do fim de com.js. */
  const somenteLeitura = () => { const s = session.get(); return !!(s && s.impersonando); };

  function normSegmento(seg) {
    seg = seg || {};
    const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
    return { perfis: arr(seg.perfis), programas: arr(seg.programas), orgIds: arr(seg.orgIds) };
  }
  M.normSegmento = normSegmento;
  M.TIPOS = { informativo: 'Informativo', contratual: 'Contratual' };

  /** Programas da empresa: produto das operações e dos títulos dela. */
  function programasDaEmpresa(orgId) {
    const set = new Set();
    db.where('operacoes', (o) => o.cedenteId === orgId || o.financiadorId === orgId).forEach((o) => { if (o.produto) set.add(o.produto); });
    db.where('titulos', (t) => t.orgId === orgId).forEach((t) => { if (t.produto) set.add(t.produto); });
    return [...set];
  }

  /** Empresas clientes ativas do segmento. Segmento vazio vale para todas. */
  M.empresasDoSegmento = function (segmento) {
    const s = normSegmento(segmento);
    return db.where('orgs', (o) => {
      if (!o || o.kind === 'cedy') return false;
      if (o.status !== 'ativo') return false;
      if (s.orgIds.length && !s.orgIds.includes(o.id)) return false;
      if (s.perfis.length && !s.perfis.includes(o.kind)) return false;
      if (s.programas.length) {
        const progs = programasDaEmpresa(o.id);
        if (!s.programas.some((p) => progs.includes(p))) return false;
      }
      return true;
    });
  };

  M.empresasAlvo = function (comunicado) {
    const c = typeof comunicado === 'string' ? db.get('comunicados', comunicado) : comunicado;
    if (!c) return [];
    return M.empresasDoSegmento(c.segmento);
  };

  /** Texto curto do segmento para exibir na Mesa e na fila de aprovações. */
  M.rotuloSegmento = function (segmento) {
    const s = normSegmento(segmento);
    const partes = [];
    if (s.perfis.length) partes.push(s.perfis.join(', '));
    if (s.programas.length) partes.push('programas ' + s.programas.join(', '));
    if (s.orgIds.length) partes.push(s.orgIds.length === 1 ? K.nomeOrg(s.orgIds[0]) : s.orgIds.length + ' empresas');
    return partes.length ? partes.join(' · ') : 'Todas as empresas clientes';
  };
  M.descSegmento = M.rotuloSegmento;

  M.estatisticas = function (id) {
    const c = typeof id === 'string' ? db.get('comunicados', id) : id;
    if (!c) return { total: 0, deram: 0, pendentes: [], lista: [] };
    const empresas = M.empresasAlvo(c);
    const ciencias = db.where('ciencias', (x) => x.comunicadoId === c.id);
    const porOrg = {};
    ciencias.forEach((x) => { if (!porOrg[x.orgId]) porOrg[x.orgId] = x; });
    const lista = empresas.map((o) => {
      const ci = porOrg[o.id] || null;
      const quem = ci ? U(ci.userId) : null;
      return { orgId: o.id, nome: K.nomeOrg(o.id), deu: !!ci, por: quem ? quem.nome : null, quando: ci ? ci.ts : null };
    }).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    return { total: empresas.length, deram: lista.filter((x) => x.deu).length, pendentes: lista.filter((x) => !x.deu).map((x) => x.orgId), lista };
  };

  function exigeComunicar(u) {
    if (!u) return fail('Usuário não encontrado.');
    if (somenteLeitura()) return fail('Modo "ver como": somente leitura.', 'SOMENTE_LEITURA');
    if (!K.temPerm(u, 'ops.com.comunicar')) return fail('Só a Mesa líder e o Superadmin emitem comunicados. ' + C.cannotMsg('ops.com.comunicar'), 'SEM_PERMISSAO');
    return null;
  }
  function blocoLigado() {
    if (K.cfg() && K.cfg().blocos && K.cfg().blocos.comunicados === false) return fail('O bloco de comunicados está pausado: nenhum comunicado novo é publicado agora.', 'BLOCO_PAUSADO');
    return null;
  }

  const proxId = () => 'CM-' + String(db.all('comunicados').length + 1).padStart(4, '0');

  /** Cria um rascunho. Contratual exige vigência no futuro. */
  M.criar = function ({ userId, tipo, titulo, corpo, segmento, vigenciaEm, faixa }) {
    const u = U(userId); const e = exigeComunicar(u); if (e) return e;
    tipo = tipo === 'contratual' ? 'contratual' : 'informativo';
    if (!String(titulo || '').trim()) return fail('Escreva o título do comunicado.');
    if (!String(corpo || '').trim()) return fail('Escreva o texto do comunicado.');
    if (tipo === 'contratual' && (!vigenciaEm || !(vigenciaEm > now()))) return fail('O comunicado contratual precisa de vigência futura: informe a partir de quando ele vale.');
    const c = db.put('comunicados', {
      id: proxId(), tipo, titulo: String(titulo).trim(), corpo: String(corpo).trim(),
      segmento: normSegmento(segmento), vigenciaEm: vigenciaEm || null,
      status: 'rascunho', criadoPor: u.id, criadoEm: now(),
      aprovacaoId: null, publicadoEm: null, agendadoPara: null, faixa: !!faixa,
    });
    ledger.append({ actor: A.user(u.id), acao: 'comunicado.criado', entidade: { kind: 'comunicado', id: c.id }, resumo: `Rascunho ${c.id} (${tipo}) criado por ${u.nome}: ${c.titulo}`, classe: 'R1' });
    return ok({ comunicado: c });
  };

  function buscaAtivo(id) {
    const c = db.get('comunicados', typeof id === 'string' ? id : (id && id.id));
    if (!c) return { erro: fail('Comunicado não encontrado.') };
    return { c };
  }

  /** Agenda um informativo para publicação pelo relógio. */
  M.agendar = function (id, ts, userId) {
    const u = U(userId); const e = exigeComunicar(u); if (e) return e;
    const r = buscaAtivo(id); if (r.erro) return r.erro;
    const c = r.c;
    if (c.tipo !== 'informativo') return fail('Só o informativo é agendado pela Mesa: o contratual passa por aprovação.');
    if (!['rascunho', 'agendado'].includes(c.status)) return fail('Só rascunho ou agendado pode ser agendado.');
    if (!(ts > now())) return fail('Escolha uma data futura para agendar.');
    db.patch('comunicados', c.id, { status: 'agendado', agendadoPara: ts });
    ledger.append({ actor: A.user(u.id), acao: 'comunicado.agendado', entidade: { kind: 'comunicado', id: c.id }, resumo: `Comunicado ${c.id} agendado por ${u.nome} para ${C.fmt.datetime(ts)}`, classe: 'R1' });
    return ok({ comunicado: db.get('comunicados', c.id) });
  };

  function rotaDaEmpresa(orgId, comunicadoId) {
    return '/' + C.roleOfOrg(db.get('orgs', orgId)) + '/mensagens' + (comunicadoId ? '?c=' + comunicadoId : '');
  }

  function efetivar(c, atorId) {
    const ts = now();
    db.patch('comunicados', c.id, { status: 'publicado', publicadoEm: ts, agendadoPara: null });
    const ator = atorId ? U(atorId) : null;
    const classe = c.tipo === 'contratual' ? 'R3' : 'R1';
    ledger.append({ actor: ator ? A.user(ator.id) : A.sistema('Relógio'), acao: 'comunicado.publicado', entidade: { kind: 'comunicado', id: c.id }, resumo: `Comunicado ${c.id} (${c.tipo}) publicado${ator ? ' por ' + ator.nome : ' pelo relógio'}: ${c.titulo}`, classe });
    const empresas = M.empresasAlvo(c);
    if (c.tipo === 'contratual') {
      empresas.forEach((o) => notify.send({ to: { orgId: o.id }, tipo: 'alerta', titulo: c.titulo, corpo: c.corpo, link: rotaDaEmpresa(o.id, c.id), classe: 'obrigatoria', exigeAcao: { ack: true } }));
    } else {
      empresas.forEach((o) => notify.send({ to: { orgId: o.id }, tipo: 'info', titulo: c.titulo, corpo: c.corpo.slice(0, 280), link: rotaDaEmpresa(o.id, c.id), classe: 'operacional' }));
    }
    return db.get('comunicados', c.id);
  }

  /** Publica um informativo agora. */
  M.publicar = function (id, userId) {
    const u = U(userId); const e = exigeComunicar(u); if (e) return e;
    const b = blocoLigado(); if (b) return b;
    const r = buscaAtivo(id); if (r.erro) return r.erro;
    const c = r.c;
    if (c.tipo !== 'informativo') return fail('O contratual só é publicado com aprovação do Superadmin.');
    if (!['rascunho', 'agendado'].includes(c.status)) return fail('Só rascunho ou agendado pode ser publicado.');
    return ok({ comunicado: efetivar(c, u.id) });
  };

  /** Publicação vinda da aprovação (quatro olhos já garantido por E.decidirAprovacao). */
  M._publicarAprovado = function (comunicadoId) {
    const c = db.get('comunicados', comunicadoId);
    if (!c) return null;
    if (c.status === 'publicado') return c;
    return efetivar(c, null);
  };

  /** Envia um contratual para aprovação do Superadmin. */
  M.enviarParaAprovacao = function (id, userId, motivo) {
    const u = U(userId); const e = exigeComunicar(u); if (e) return e;
    const r = buscaAtivo(id); if (r.erro) return r.erro;
    const c = r.c;
    if (c.tipo !== 'contratual') return fail('Só o contratual passa por aprovação: o informativo é publicado direto pela Mesa.');
    if (c.status !== 'rascunho') return fail('Só o rascunho vai para aprovação.');
    if (!motivo || String(motivo).trim().length < 10) return fail('Explique o motivo (mínimo de 10 caracteres): o Superadmin decide com este contexto.');
    const seg = M.rotuloSegmento(c.segmento);
    const resumo = `${c.titulo}. ${c.corpo.slice(0, 280)} Segmento: ${seg}. Vigência: ${c.vigenciaEm ? C.fmt.date(c.vigenciaEm) : 'sem vigência'}.`;
    const antes = { status: 'rascunho' };
    const depois = { status: 'publicado', titulo: c.titulo, tipo: c.tipo, segmento: seg, vigencia: c.vigenciaEm ? C.fmt.date(c.vigenciaEm) : 'sem vigência', faixa: c.faixa ? 'sim' : 'não' };
    const sol = E.solicitarAprovacao({ tipo: 'comunicado', titulo: 'Comunicado contratual: ' + c.titulo, resumo, payload: { comunicadoId: c.id }, antes, depois, userId: u.id, motivo: String(motivo).trim() });
    if (!sol.ok) return sol;
    db.patch('comunicados', c.id, { status: 'aguardando_aprovacao', aprovacaoId: sol.aprovacao.id });
    ledger.append({ actor: A.user(u.id), acao: 'comunicado.enviado_aprovacao', entidade: { kind: 'comunicado', id: c.id }, resumo: `Comunicado ${c.id} enviado para aprovação por ${u.nome}: ${c.titulo}`, classe: 'R3', detalhe: { aprovacaoId: sol.aprovacao.id } });
    return ok({ comunicado: db.get('comunicados', c.id), aprovacao: sol.aprovacao });
  };

  /** Cancela rascunho, agendado ou aguardando aprovação. */
  M.cancelar = function (id, userId, motivo) {
    const u = U(userId); const e = exigeComunicar(u); if (e) return e;
    const r = buscaAtivo(id); if (r.erro) return r.erro;
    const c = r.c;
    if (!['rascunho', 'agendado', 'aguardando_aprovacao'].includes(c.status)) return fail('Só rascunho, agendado ou aguardando aprovação pode ser cancelado.');
    if (c.status === 'aguardando_aprovacao' && c.aprovacaoId) {
      const a = db.get('aprovacoes', c.aprovacaoId);
      if (a && a.status === 'pendente') db.patch('aprovacoes', a.id, { status: 'cancelada', decididoPor: u.id, decididoEm: now(), motivoDecisao: 'Cancelada por quem solicitou.' });
    }
    db.patch('comunicados', c.id, { status: 'cancelado', agendadoPara: null });
    ledger.append({ actor: A.user(u.id), acao: 'comunicado.cancelado', entidade: { kind: 'comunicado', id: c.id }, resumo: `Comunicado ${c.id} cancelado por ${u.nome}${motivo ? ': ' + motivo : ''}`, classe: 'R1' });
    return ok({ comunicado: db.get('comunicados', c.id) });
  };

  /** Registra a ciência da empresa. Uma ciência vale pela empresa. */
  M.darCiencia = function (comunicadoId, userId) {
    if (somenteLeitura()) return fail('Modo "ver como": somente leitura.', 'SOMENTE_LEITURA');
    const u = U(userId);
    const c = db.get('comunicados', typeof comunicadoId === 'string' ? comunicadoId : (comunicadoId && comunicadoId.id));
    if (!c || !u) return fail('Comunicado não encontrado.');
    if (c.status !== 'publicado') return fail('Só comunicado publicado recebe ciência.');
    if (K.isCedy(u)) return fail('A ciência é registrada pela empresa cliente.');
    if (u.perfil === 'leitor') return fail('O perfil leitor só lê: peça a um administrador ou operador para registrar a ciência.', 'LEITOR');
    if (u.perfil !== 'admin' && u.perfil !== 'operador') return fail('Só administrador ou operador registra a ciência.');
    const alvo = M.empresasAlvo(c);
    if (!alvo.some((o) => o.id === u.orgId)) return fail('Este comunicado não é para a sua empresa.');
    const ex = db.where('ciencias', (x) => x.comunicadoId === c.id && x.orgId === u.orgId)[0];
    if (ex) {
      db.where('notifs', (n) => n.to && n.to.orgId === u.orgId && n.exigeAcao && n.exigeAcao.ack && n.titulo === c.titulo).forEach((n) => notify.resolve(n.id));
      return ok({ ciencia: ex, existente: true });
    }
    const ci = db.put('ciencias', { id: C.uid('ci'), comunicadoId: c.id, orgId: u.orgId, userId: u.id, ts: now() });
    db.where('notifs', (n) => n.to && n.to.orgId === u.orgId && n.exigeAcao && n.exigeAcao.ack && n.titulo === c.titulo).forEach((n) => notify.resolve(n.id));
    ledger.append({ actor: A.user(u.id), acao: 'comunicado.ciencia', entidade: { kind: 'comunicado', id: c.id }, resumo: `Ciência do comunicado ${c.id} por ${u.nome} (${K.nomeOrg(u.orgId)})`, classe: 'R1' });
    return ok({ ciencia: ci });
  };

  /** Rejeição na fila de quatro olhos devolve o contratual a rascunho. */
  if (!E.decidirAprovacao.__comunicados) {
    const dec0 = E.decidirAprovacao;
    const dec = function (id, decisao, userId, motivo) {
      const r = dec0(id, decisao, userId, motivo);
      if (!r.ok) return r;
      try {
        const a = db.get('aprovacoes', id);
        if (a && a.tipo === 'comunicado' && a.payload && a.payload.comunicadoId) {
          const c = db.get('comunicados', a.payload.comunicadoId);
          if (c && decisao === 'rejeitar' && c.status === 'aguardando_aprovacao') db.patch('comunicados', c.id, { status: 'rascunho', aprovacaoId: null });
          if (c && decisao === 'aprovar' && c.status !== 'publicado') M._publicarAprovado(c.id);
        }
      } catch (err) { /* sem efeito na decisão já registrada */ }
      return r;
    };
    dec.__comunicados = true;
    E.decidirAprovacao = dec;
  }

  /* Publica informativos agendados quando o relógio avança. */
  if (!E.tick.__comunicados) {
    const tick0 = E.tick;
    const tick = function () {
      tick0();
      try {
        if (K.cfg() && K.cfg().blocos && K.cfg().blocos.comunicados === false) return;
        db.where('comunicados', (c) => c.tipo === 'informativo' && c.status === 'agendado' && c.agendadoPara && c.agendadoPara <= now()).forEach((c) => efetivar(c, c.criadoPor));
      } catch (err) { /* relógio nunca quebra por causa de comunicado */ }
    };
    tick.__comunicados = true;
    E.tick = tick;
  }

  /* Comunicados na caixa: inclui o filtro por programa além de perfil e empresa. */
  K.comunicadosPara = function (u) {
    if (!u) return [];
    const o = orgOf(u);
    if (K.isCedy(u)) return [];
    const progs = o ? programasDaEmpresa(o.id) : [];
    return db.where('comunicados', (c) => {
      if (c.status !== 'publicado') return false;
      const s = normSegmento(c.segmento);
      if (s.orgIds.length && !s.orgIds.includes(u.orgId)) return false;
      if (s.perfis.length && o && !s.perfis.includes(o.kind)) return false;
      if (s.programas.length && !s.programas.some((p) => progs.includes(p))) return false;
      return true;
    });
  };
})();
