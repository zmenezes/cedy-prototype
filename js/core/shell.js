/* =========================================================================
   Cedy, shell do app: perfis, permissões, navegação (sidebar/bottom nav),
   topbar, notificações, menu do usuário, painel de demonstração (relógio,
   mercado simulado), paleta de comandos e fundo com parallax.
   ========================================================================= */
(function () {
  const C = window.Cedy; const { h, icon, fmt } = C; const ui = C.ui; const { db, session, prefs, notify } = C.store;

  /* ------------------------------- perfis -------------------------------- */
  C.roles = {
    cedente: { label: 'Cedente', long: 'Empresa que antecipa recebíveis', icon: 'banknote', home: '/cedente', tone: 'blue' },
    financiador: { label: 'Financiador', long: 'Fundo, banco ou fomento que compra recebíveis', icon: 'landmark', home: '/financiador', tone: 'teal' },
    originador: { label: 'Originador', long: 'Parceiro que indica empresas', icon: 'handshake', home: '/originador', tone: 'green' },
    sacado: { label: 'Sacado', long: 'Empresa que paga o título', icon: 'building-2', home: '/sacado', tone: 'amber' },
    ops: { label: 'Mesa Cedy', long: 'Operações, conciliação e compliance', icon: 'shield-check', home: '/ops', tone: 'violet' },
    // chaves de exibição (nunca são session.role): o papel de sessão do Superadmin é 'ops' e o do Subparceiro é 'originador'
    superadmin: { label: 'Superadmin', long: 'Dono da plataforma: saúde, dados, governança e configuração', icon: 'shield-user', home: '/super', tone: 'violet' },
    subparceiro: { label: 'Subparceiro', long: 'Parceiro indicado por um originador', icon: 'users', home: '/originador', tone: 'green' },
  };
  /** Chave de exibição do usuário logado: define menu, rótulo e página inicial */
  C.shellKey = () => { const u = session.user(); const r = session.role(); if (u && u.perfil === 'superadmin') return 'superadmin'; if (u && u.perfil === 'subparceiro') return 'subparceiro'; return r; };
  C.keyOfUser = (u, org) => (u && u.perfil === 'superadmin' ? 'superadmin' : u && u.perfil === 'subparceiro' ? 'subparceiro' : org && org.kind === 'cedy' ? 'ops' : org && org.kind);
  /** Papel de sessão de um usuário (o que vai em session.role) */
  C.roleOfOrg = (org) => (org && org.kind === 'cedy' ? 'ops' : org && org.kind);
  C.homeFor = (sess) => { const u = sess && C.store.db.get('users', sess.userId); const k = u && u.perfil === 'superadmin' ? 'superadmin' : u && u.perfil === 'subparceiro' ? 'subparceiro' : sess && sess.role; return (C.roles[k] || C.roles.cedente).home; };
  /** Papéis internos da Cedy (user.papel quando a empresa é a Cedy). Perfil admin da Mesa = líder: todas as permissões operacionais, nunca as de plataforma. */
  C.OPS_PAPEIS = {
    super: { label: 'Superadmin', perms: ['*'], desc: 'Configura a plataforma, aprova alterações críticas e acessa dados e saúde.' },
    mesa: { label: 'Analista da Mesa de Operações', perms: ['ops.lote', 'ops.agentes', 'ops.config.solicitar', 'ops.com.atender'], desc: 'Valida lotes de títulos, decide propostas dos agentes e atende chamados de operações.' },
    conciliadora: { label: 'Analista da Mesa Conciliadora', perms: ['ops.conciliar', 'ops.config.solicitar', 'ops.com.atender'], desc: 'Resolve parciais, empates e créditos sem fonte e atende chamados de conciliação.' },
    compliance: { label: 'Compliance e risco', perms: ['ops.kyc', 'ops.suspender', 'ops.agentes', 'ops.config.solicitar', 'ops.com.atender', 'ops.com.moderar', 'ops.com.ler_pares'], desc: 'Aprova cadastros, suspende empresas, acompanha alertas e modera conversas.' },
    financeiro: { label: 'Financeiro', perms: ['ops.faturar', 'ops.config.solicitar', 'ops.com.atender'], desc: 'Fechamento mensal, faturas de TS e premiações; atende chamados de faturamento.' },
    suporte: { label: 'Suporte', perms: ['ops.suporte', 'ops.verComo', 'ops.com.atender', 'ops.com.ler_pares'], desc: 'Atende clientes e chamados, entra em modo "ver como" (só leitura, auditado) e lê conversas com motivo.' },
    auditor: { label: 'Auditor', perms: [], desc: 'Leitura da trilha e dos cadastros, sem ações.' },
  };
  C.OPS_PERMS = { 'ops.lote': 'Validar lotes', 'ops.conciliar': 'Resolver casos de conciliação', 'ops.kyc': 'Aprovar cadastros (KYC)', 'ops.suspender': 'Suspender e reativar empresas', 'ops.agentes': 'Decidir propostas dos agentes', 'ops.faturar': 'Fechamento, faturas e premiações', 'ops.config.solicitar': 'Solicitar alteração de configuração', 'ops.verComo': 'Entrar em "ver como" (auditado)', 'ops.suporte': 'Atender clientes', 'ops.config.aplicar': 'Aplicar configuração, programas e autonomia (Superadmin)', 'ops.com.atender': 'Atender chamados e conversas da sua fila', 'ops.com.moderar': 'Moderar: alertas de contato, denúncias e redação', 'ops.com.comunicar': 'Emitir comunicados informativos', 'ops.com.ler_pares': 'Ler conversas entre clientes, com motivo' };
  /** Perfil dentro da organização: admin | operador | leitor */
  const PERMS = { admin: ['ver', 'operar', 'aceitar', 'lance', 'publicar', 'assinar', 'pagar', 'importar', 'admin'], operador: ['ver', 'operar', 'aceitar', 'lance', 'publicar', 'assinar', 'pagar', 'importar'], leitor: ['ver'] };
  PERMS.subparceiro = ['ver', 'convidar'];
  C.can = (perm) => {
    const u = session.user(); if (!u) return false;
    const sess = session.get(); if (sess && sess.impersonando) return perm === 'ver';
    if (session.role() === 'ops') {
      if (u.perfil === 'superadmin') return true;
      if (perm === 'ver') return true;
      if (u.perfil === 'leitor') return false;
      if (perm.indexOf('ops.') === 0) { if (perm === 'ops.config.aplicar') return false; if (u.perfil === 'admin' && perm !== 'ops.verComo') return true; const p = C.OPS_PAPEIS[u.papel]; return !!p && (p.perms.includes('*') || p.perms.includes(perm)); }
      if (perm === 'admin') return u.perfil === 'admin';
      return u.papel !== 'auditor';
    }
    return (PERMS[u.perfil] || []).includes(perm);
  };
  C.cannotMsg = (perm) => { const u = session.user() || {}; if (session.get() && session.get().impersonando) return 'Modo "ver como": somente leitura.'; if (perm.indexOf('ops.') === 0) return `${(C.OPS_PAPEIS[u.papel] || {}).label || 'Seu papel'} não tem a permissão "${C.OPS_PERMS[perm] || perm}". ${perm === 'ops.config.aplicar' ? 'Só o Superadmin aplica; use Solicitar alteração.' : 'Peça ao líder da Mesa ou ao Superadmin.'}`; return `O perfil ${u.perfil || ''} não tem permissão para esta ação (${perm}). Peça a um administrador da empresa.`; };
  /** botão/ação que respeita permissão */
  C.guard = (perm, fn) => (...a) => { if (!C.can(perm)) { ui.toast('Sem permissão', { type: 'warn', text: C.cannotMsg(perm) }); return; } return fn(...a); };

  /* ------------------------------ navegação ------------------------------ */
  const NAV = {
    cedente: [
      { group: null, items: [
        { id: 'inicio', label: 'Início', icon: 'house', path: '/cedente', mobile: 1, exact: true },
        { id: 'titulos', label: 'Meus títulos', short: 'Títulos', icon: 'receipt-text', path: '/cedente/titulos', mobile: 2 },
        { id: 'operacoes', label: 'Operações', icon: 'repeat', path: '/cedente/operacoes', mobile: 3, badge: () => db.where('operacoes', (o) => o.cedenteId === session.get().orgId && (['cessao'].includes(o.status) || (o.status === 'aberta' && C.engine.melhorLance(o.id)))).length },
        { id: 'conta', label: 'Conta e recebimentos', short: 'Conta', icon: 'wallet', path: '/cedente/conta', mobile: 4, badge: () => db.where('extrato', (x) => x.orgId === session.get().orgId && x.status === 'pendente_mesa').length },
      ] },
      { group: 'Gestão', items: [
        { id: 'limites', label: 'Limites e sacados', icon: 'gauge', path: '/cedente/limites' },
        { id: 'relatorios', label: 'Relatórios', icon: 'chart-column', path: '/cedente/relatorios' },
        { id: 'cadastro', label: 'Cadastro e documentos', icon: 'id-card', path: '/cedente/cadastro' },
        { id: 'config', label: 'Configurações', icon: 'settings', path: '/cedente/configuracoes' },
        { id: 'ajuda', label: 'Ajuda', icon: 'circle-question-mark', path: '/cedente/ajuda' },
      ] },
    ],
    financiador: [
      { group: null, items: [
        { id: 'inicio', label: 'Início', icon: 'house', path: '/financiador', mobile: 1, exact: true },
        { id: 'vitrine', label: 'Vitrine', icon: 'store', path: '/financiador/vitrine', mobile: 2, badge: () => db.where('operacoes', (o) => o.status === 'aberta' && o.canal === 'vitrine').length },
        { id: 'balcao', label: 'Balcão', icon: 'handshake', path: '/financiador/balcao', badge: () => db.where('operacoes', (o) => o.status === 'aberta' && o.canal === 'balcao' && o.financiadorAlvoId === session.get().orgId).length },
        { id: 'lances', label: 'Meus lances', short: 'Lances', icon: 'gavel', path: '/financiador/lances', mobile: 3 },
        { id: 'carteira', label: 'Carteira', icon: 'briefcase', path: '/financiador/carteira', mobile: 4 },
      ] },
      { group: 'Gestão', items: [
        { id: 'repasses', label: 'Repasses', icon: 'arrow-left-right', path: '/financiador/repasses' },
        { id: 'politica', label: 'Política de crédito', icon: 'sliders-horizontal', path: '/financiador/politica' },
        { id: 'agentes', label: 'Agente de crédito', icon: 'sparkles', path: '/financiador/agentes' },
        { id: 'faturamento', label: 'Faturamento', icon: 'receipt', path: '/financiador/faturamento' },
        { id: 'relatorios', label: 'Relatórios', icon: 'chart-column', path: '/financiador/relatorios' },
        { id: 'cadastro', label: 'Cadastro e documentos', icon: 'id-card', path: '/financiador/cadastro' },
        { id: 'config', label: 'Configurações', icon: 'settings', path: '/financiador/configuracoes' },
        { id: 'ajuda', label: 'Ajuda', icon: 'circle-question-mark', path: '/financiador/ajuda' },
      ] },
    ],
    originador: [
      { group: null, items: [
        { id: 'inicio', label: 'Início', icon: 'house', path: '/originador', mobile: 1, exact: true },
        { id: 'indicados', label: 'Carteira de indicados', short: 'Indicados', icon: 'users', path: '/originador/indicados', mobile: 2 },
        { id: 'convites', label: 'Convidar', icon: 'user-plus', path: '/originador/convites', mobile: 3 },
        { id: 'premiacao', label: 'Premiação', short: 'Prêmios', icon: 'award', path: '/originador/premiacao', mobile: 4 },
      ] },
      { group: 'Gestão', items: [
        { id: 'relatorios', label: 'Relatórios mensais', icon: 'file-text', path: '/originador/relatorios' },
        { id: 'cadastro', label: 'Cadastro e documentos', icon: 'id-card', path: '/originador/cadastro' },
        { id: 'config', label: 'Configurações', icon: 'settings', path: '/originador/configuracoes' },
        { id: 'ajuda', label: 'Ajuda', icon: 'circle-question-mark', path: '/originador/ajuda' },
      ] },
    ],
    sacado: [
      { group: null, items: [
        { id: 'inicio', label: 'Início', icon: 'house', path: '/sacado', mobile: 1, exact: true },
        { id: 'titulos', label: 'Títulos a pagar', short: 'Títulos', icon: 'receipt-text', path: '/sacado/titulos', mobile: 2, badge: () => C.engine && db.where('titulos', (t) => t.sacadoId === session.get().orgId && t.lastro && t.lastro.aceiteSacado === 'pendente').length },
        { id: 'pagamentos', label: 'Pagamentos', icon: 'banknote', path: '/sacado/pagamentos', mobile: 3 },
        { id: 'fornecedores', label: 'Fornecedores', icon: 'factory', path: '/sacado/fornecedores', mobile: 4 },
      ] },
      { group: 'Gestão', items: [
        { id: 'config', label: 'Configurações', icon: 'settings', path: '/sacado/configuracoes' },
        { id: 'ajuda', label: 'Ajuda', icon: 'circle-question-mark', path: '/sacado/ajuda' },
      ] },
    ],
    ops: [
      { group: null, items: [
        { id: 'inicio', label: 'Visão geral', short: 'Visão', icon: 'layout-dashboard', path: '/ops', mobile: 1, exact: true },
        { id: 'mesa', label: 'Mesa de Operações', short: 'Mesa', icon: 'list-checks', path: '/ops/mesa', mobile: 2, badge: () => db.where('lotes', (l) => l.status === 'validando').length },
        { id: 'conciliacao', label: 'Mesa Conciliadora', short: 'Concil.', icon: 'git-compare', path: '/ops/conciliacao', mobile: 3, badge: () => db.where('casosMesa', (c) => c.status === 'aberto').length },
        { id: 'kyc', label: 'Cadastros (KYC)', short: 'KYC', icon: 'scan-line', path: '/ops/kyc', mobile: 4, badge: () => db.where('kyc', (k) => ['em_analise', 'pendencia'].includes(k.status)).length },
      ] },
      { group: 'Plataforma', items: [
        { id: 'agentes', label: 'Agentes e autonomia', icon: 'sparkles', path: '/ops/agentes', badge: () => db.where('propostas', (p) => p.status === 'pendente').length },
        { id: 'trilha', label: 'Trilha de decisões', icon: 'scroll-text', path: '/ops/trilha' },
        { id: 'empresas', label: 'Empresas', icon: 'building-2', path: '/ops/empresas' },
        { id: 'faturamento', label: 'Faturamento e premiações', icon: 'receipt', path: '/ops/faturamento' },
        { id: 'programas', label: 'Programas de produto', icon: 'layers', path: '/ops/programas' },
        { id: 'plataforma', label: 'Plataforma', icon: 'settings', path: '/ops/plataforma' },
      ] },
    ],
  };
  NAV.superadmin = [
    { group: null, items: [
      { id: 'inicio', label: 'Saúde da plataforma', short: 'Saúde', icon: 'heart-pulse', path: '/super', mobile: 1, exact: true },
      { id: 'servicos', label: 'Serviços e integrações', short: 'Serviços', icon: 'server-cog', path: '/super/servicos', mobile: 2 },
      { id: 'incidentes', label: 'Incidentes', icon: 'siren', path: '/super/incidentes', mobile: 3, badge: () => db.where('incidentes', (i) => i.status !== 'resolvido').length },
      { id: 'aprovacoes', label: 'Aprovações', icon: 'stamp', path: '/super/aprovacoes', mobile: 4, badge: () => db.where('aprovacoes', (a) => a.status === 'pendente').length },
    ] },
    { group: 'Governança', items: [
      { id: 'usuarios', label: 'Usuários internos e papéis', icon: 'user-cog', path: '/super/usuarios' },
      { id: 'seguranca', label: 'Segurança e acessos', icon: 'shield-check', path: '/super/seguranca' },
      { id: 'trilha', label: 'Trilha de decisões', icon: 'scroll-text', path: '/ops/trilha' },
      { id: 'empresas', label: 'Empresas', icon: 'building-2', path: '/ops/empresas' },
    ] },
    { group: 'Dados', items: [
      { id: 'dados', label: 'Qualidade dos dados', icon: 'database', path: '/super/dados' },
      { id: 'catalogo', label: 'Catálogo e retenção', icon: 'book-open', path: '/super/catalogo' },
      { id: 'backups', label: 'Backups e restauração', icon: 'database-backup', path: '/super/backups' },
      { id: 'lgpd', label: 'Privacidade (LGPD)', icon: 'file-lock', path: '/super/lgpd', badge: () => db.where('titulares', (t) => ['recebida', 'em_analise'].includes(t.status)).length },
    ] },
    { group: 'Configuração', items: [
      { id: 'plataforma', label: 'Parâmetros', icon: 'settings', path: '/ops/plataforma' },
      { id: 'programas', label: 'Programas de produto', icon: 'layers', path: '/ops/programas' },
      { id: 'ia', label: 'IA e agentes', icon: 'sparkles', path: '/super/ia' },
      { id: 'mercado', label: 'Mercado e funcionalidades', icon: 'toggle-right', path: '/super/mercado' },
      { id: 'config', label: 'Meu perfil', icon: 'user', path: '/ops/configuracoes' },
      { id: 'ajuda', label: 'Ajuda', icon: 'circle-question-mark', path: '/ops/ajuda' },
    ] },
  ];
  NAV.subparceiro = [
    { group: null, items: [
      { id: 'inicio', label: 'Início', icon: 'house', path: '/originador', mobile: 1, exact: true },
      { id: 'indicados', label: 'Meus indicados', short: 'Indicados', icon: 'users', path: '/originador/indicados', mobile: 2 },
      { id: 'convites', label: 'Convidar', icon: 'user-plus', path: '/originador/convites', mobile: 3 },
      { id: 'premiacao', label: 'Minha comissão', short: 'Comissão', icon: 'award', path: '/originador/premiacao', mobile: 4 },
    ] },
    { group: 'Gestão', items: [
      { id: 'config', label: 'Configurações', icon: 'settings', path: '/originador/configuracoes' },
      { id: 'ajuda', label: 'Ajuda', icon: 'circle-question-mark', path: '/originador/ajuda' },
    ] },
  ];
  // Mesa: solicitações de alteração (aprovação em dois passos)
  NAV.ops[1].items.push({ id: 'solicitacoes', label: 'Minhas solicitações', icon: 'stamp', path: '/ops/solicitacoes', badge: () => db.where('aprovacoes', (a) => a.status === 'pendente' && a.solicitanteId === (session.get() || {}).userId).length });
  // Originador: subparceiros
  NAV.originador[0].items.splice(2, 0, { id: 'subparceiros', label: 'Subparceiros', icon: 'network', path: '/originador/subparceiros' });
  // Central de comunicação: Mensagens para todos; Chamados para a Mesa e o Superadmin
  const msgBadge = () => { const s = session.get(); const E = C.engine; if (!s || !E.com) return 0; const c = E.com.contadores(s.userId); return c.por.conversas + c.por.chamados; };
  ['cedente', 'financiador', 'originador', 'sacado'].forEach((r) => NAV[r][0].items.push({ id: 'mensagens', label: 'Mensagens', icon: 'messages-square', path: '/' + r + '/mensagens', badge: msgBadge }));
  NAV.subparceiro[0].items.push({ id: 'mensagens', label: 'Mensagens', icon: 'messages-square', path: '/originador/mensagens', badge: msgBadge });
  const chamBadge = () => { const s = session.get(); const E = C.engine; if (!s || !E.com) return 0; return E.com.feed(s.userId).filter((i) => i.tipo === 'chamados' && i.precisa).length; };
  NAV.ops[0].items.push({ id: 'chamados', label: 'Chamados', icon: 'life-buoy', path: '/ops/chamados', badge: chamBadge }, { id: 'mensagens', label: 'Mensagens', icon: 'messages-square', path: '/ops/mensagens', badge: msgBadge });
  NAV.superadmin[0].items.push({ id: 'chamados', label: 'Chamados', icon: 'life-buoy', path: '/ops/chamados', badge: chamBadge }, { id: 'mensagens', label: 'Mensagens', icon: 'messages-square', path: '/ops/mensagens', badge: msgBadge });
  const comBadge = () => { const E = C.engine; return E.com ? db.where('alertasContato', (a) => ['aberto', 'em_analise'].includes(a.status)).length + db.where('denuncias', (d) => ['pendente', 'em_analise'].includes(d.status)).length : 0; };
  NAV.ops[1].items.push({ id: 'comunicacao', label: 'Comunicação', icon: 'megaphone', path: '/ops/comunicacao', badge: comBadge });
  NAV.superadmin[3].items.splice(3, 0, { id: 'comunicacao', label: 'Saúde da comunicação', icon: 'messages-square', path: '/super/comunicacao' });
  NAV.superadmin[3].items.splice(4, 0, { id: 'calibracao', label: 'Calibração', icon: 'sliders-horizontal', path: '/super/calibracao', badge: () => (C.engine.ia && C.engine.ia.cal ? db.where('recomendacoes', (r) => r.status === 'pedido').length : 0) });
  C.NAV = NAV;
  const flat = (role) => (NAV[role] || []).flatMap((g) => g.items);

  /* ---------------------------- fundo com parallax ----------------------- */
  function buildBg() {
    const dark = () => document.documentElement.dataset.resolved === 'dark';
    const el = h('div.bgfx', { 'aria-hidden': 'true' },
      h('div.bg-layer.bg-l1', h('div.bg-blob.b1'), h('div.bg-blob.b2')),
      h('div.bg-layer.bg-l2', h('img.bg-sym.s1', { src: 'assets/logo/symbol-light.svg', alt: '' })),
      h('div.bg-layer.bg-l3', h('img.bg-sym.s2', { src: 'assets/logo/symbol-light.svg', alt: '' }), h('i.bg-ring')));
    return el;
  }
  let px = 0, py = 0, sy = 0, raf = 0, bgEl;
  function applyParallax() { raf = 0; if (!bgEl) return; bgEl.style.setProperty('--px', px.toFixed(3)); bgEl.style.setProperty('--py', py.toFixed(3)); bgEl.style.setProperty('--sy', sy.toFixed(1) + 'px'); }
  function schedule() { if (!raf) raf = requestAnimationFrame(applyParallax); }
  window.addEventListener('pointermove', (e) => { if (C.prefersReduced() || e.pointerType === 'touch') return; px = (e.clientX / innerWidth - 0.5) * 2; py = (e.clientY / innerHeight - 0.5) * 2; schedule(); }, { passive: true });
  window.addEventListener('scroll', () => { sy = window.scrollY; schedule(); }, { passive: true });
  document.addEventListener('scroll', (e) => { if (e.target && e.target.id === 'view') { sy = e.target.scrollTop; schedule(); } }, true);

  /* -------------------------------- tema --------------------------------- */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = prefs.theme; const res = t === 'auto' ? (mq.matches ? 'dark' : 'light') : t;
    document.documentElement.dataset.theme = res; document.documentElement.dataset.resolved = res;
    document.querySelectorAll('.bg-sym').forEach((i) => { i.src = 'assets/logo/symbol-' + (res === 'dark' ? 'dark' : 'light') + '.svg'; });
    const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = res === 'dark' ? '#0a1730' : '#001F42';
  }
  mq.addEventListener && mq.addEventListener('change', applyTheme);

  /* ------------------------------ montagem -------------------------------- */
  let shellEl = null, shellKey = '';
  function app() { return document.getElementById('app'); }
  function ensureBg() { const a = app(); if (!a.querySelector('.bgfx')) { bgEl = buildBg(); a.prepend(bgEl); applyTheme(); } else bgEl = a.querySelector('.bgfx'); }

  async function mountBare() {
    ensureBg(); const a = app(); shellEl = null; shellKey = '';
    if (!a.querySelector('main#view.bare')) { [...a.children].forEach((c) => { if (!c.classList.contains('bgfx')) c.remove(); }); a.append(h('main#view.view.bare', { 'aria-live': 'polite' })); }
    a.dataset.mode = 'bare';
  }
  async function mountApp() {
    ensureBg(); const a = app(); const s = session.get(); const sk = C.shellKey(); const key = s.userId + '|' + s.role + '|' + sk;
    a.dataset.mode = 'app';
    if (shellEl && shellKey === key && a.contains(shellEl)) return;
    [...a.children].forEach((c) => { if (!c.classList.contains('bgfx')) c.remove(); });
    shellKey = key; shellEl = buildShell(sk); a.append(shellEl);
  }

  /** Faixas de aviso globais: modo "ver como" (auditado, só leitura) e mercado pausado/manutenção */
  function buildBanners() {
    return ui.live(['session', 'config', 'users', 'comunicados', 'ciencias', 'servicos'], () => {
      const out = []; const sess = session.get(); const cfg = db.cfg();
      if (sess && sess.impersonando) {
        const im = sess.impersonando; const u = session.user(); const o = session.org();
        out.push(h('div.banner.banner-ver', { role: 'status' }, icon('eye', 16), h('span.banner-t', h('strong', 'Ver como: '), `${u.nome} (${o.fantasia || o.nome})`, ' · somente leitura · justificativa: ' + im.justificativa), ui.countdown(im.ate, { prefix: 'expira em', endLabel: 'expirado' }), ui.btn('Encerrar', { size: 'sm', variant: 'secondary', onclick: () => C.engine.encerrarVerComo() })));
      }
      if (cfg.manutencao && cfg.manutencao.ativo) out.push(h('div.banner.banner-warn', { role: 'status' }, icon('triangle-alert', 16), h('span.banner-t', h('strong', 'Manutenção programada: '), cfg.manutencao.msg || 'a plataforma pode oscilar.'), cfg.manutencao.ate ? h('span.small', 'até ' + fmt.datetime(cfg.manutencao.ate)) : null));
      if (cfg.mercadoPausado) out.push(h('div.banner.banner-warn', { role: 'status' }, icon('octagon-pause', 16), h('span.banner-t', h('strong', 'Mercado pausado pela plataforma: '), 'novas operações e lances estão suspensos. Operações em andamento seguem normalmente.')));
      if (C.comUI && C.comUI.faixas) C.comUI.faixas().forEach((f) => out.push(f));
      return out;
    }, { class: 'banners' });
  }
  function buildShell(role) {
    const side = h('aside.sidebar', { 'aria-label': 'Navegação principal' }, buildSidebar(role));
    const top = h('header.topbar', buildTopbar(role));
    const view = h('main#view.view', { 'aria-live': 'polite' });
    const bottom = h('nav.bottomnav', { 'aria-label': 'Navegação principal' }, buildBottom(role));
    const root = h('div', { class: ['shell', prefs.collapsed && 'is-collapsed'], dataset: { role } }, side, h('div.main-col', buildBanners(), top, view), bottom);
    return root;
  }

  function isActive(it, path) { return it.exact ? path === it.path : path === it.path || path.startsWith(it.path + '/'); }
  function activePath() { return (C.router.current && C.router.current.path) || location.hash.replace('#', ''); }

  function buildSidebar(role) {
    const R = C.roles[role];
    return [
      h('div.sb-top', h('a.sb-logo', { href: '#' + R.home, 'aria-label': 'Cedy, início' }, h('img.logo-full', { src: 'assets/logo/horizontal-dark.svg', alt: 'Cedy', height: 30 }), h('img.logo-sym', { src: 'assets/logo/symbol-dark.svg', alt: 'Cedy', height: 30 })),
        h('button.sb-collapse', { type: 'button', 'aria-label': 'Recolher menu', onclick: () => { prefs.setCollapsed(!prefs.collapsed); shellEl.classList.toggle('is-collapsed', prefs.collapsed); } }, icon('panel-left', 18))),
      ui.live(['session', 'orgs'], () => { const o = session.org(); return h('button.sb-org', { type: 'button', onclick: (e) => userMenu(e.currentTarget), 'aria-label': 'Empresa e perfil' }, ui.avatar(o.fantasia || o.nome, { square: true }), h('span.sb-org-t', h('strong', o.fantasia || o.nome), h('small', (() => { const u = session.user(); if (u.perfil === 'superadmin') return 'Superadmin · plataforma'; if (u.perfil === 'subparceiro') return 'Subparceiro'; if (o.kind === 'cedy' && C.OPS_PAPEIS[u.papel]) return C.OPS_PAPEIS[u.papel].label.replace('Analista da ', '') + (u.perfil === 'admin' ? ' (líder)' : ''); return R.label + ' · ' + u.perfil.charAt(0).toUpperCase() + u.perfil.slice(1); })())), icon('chevrons-up-down', 14)); }),
      ui.live(['operacoes', 'extrato', 'lotes', 'casosMesa', 'kyc', 'propostas', 'titulos', 'session', 'aprovacoes', 'incidentes', 'titulares', 'conversas', 'notifs', 'comunicados', 'ciencias', 'alertasContato'], () => h('nav.sb-nav', NAV[role].map((g) => h('div.sb-group', g.group && h('div.sb-gt', g.group), g.items.map((it) => {
        const n = it.badge ? it.badge() : 0; const act = isActive(it, activePath());
        return h('a', { class: ['sb-item', act && 'is-active'], href: '#' + it.path, 'aria-current': act ? 'page' : null, title: it.label, dataset: { id: it.id } }, icon(it.icon, 19), h('span.sb-lab', it.label), n ? h('span.sb-badge', n > 99 ? '99+' : n) : null);
      }))))),
      h('div.sb-foot', h('button.sb-assist', { type: 'button', onclick: () => C.assistant && C.assistant.open() }, h('span.sb-assist-ic', icon('sparkles', 18)), h('span.sb-lab', h('strong', 'Assistente Cedy'), h('small', 'Pergunte ou peça uma ação'))),
        h('div.sb-ver', h('span', 'Protótipo 0.1'))),
    ];
  }
  function buildBottom(role) {
    const items = flat(role).filter((i) => i.mobile).sort((a, b) => a.mobile - b.mobile);
    return ui.live(['operacoes', 'extrato', 'lotes', 'casosMesa', 'kyc', 'titulos', 'session', 'aprovacoes', 'incidentes', 'titulares', 'conversas', 'notifs'], () => [...items.map((it) => { const n = it.badge ? it.badge() : 0; const act = isActive(it, activePath()); return h('a', { class: ['bn-item', act && 'is-active'], href: '#' + it.path, 'aria-current': act ? 'page' : null }, h('span.bn-ic', icon(it.icon, 22), n ? h('i.bn-badge', n > 9 ? '9+' : n) : null), h('span.bn-lab', it.short || it.label.split(' ')[0])); }),
      h('button.bn-item', { type: 'button', onclick: () => openMore(role) }, h('span.bn-ic', icon('menu', 22)), h('span.bn-lab', 'Mais'))], { class: 'bn-live' });
  }
  function openMore(role) {
    ui.sheet({ title: 'Menu', body: (api) => h('div.more-menu', NAV[role].map((g) => h('div', g.group && h('div.sb-gt', g.group), g.items.map((it) => h('a', { class: 'more-item', href: '#' + it.path, onclick: () => api.close() }, icon(it.icon, 20), it.label)))), h('hr.divider'), h('button.more-item', { type: 'button', onclick: () => { api.close(); C.assistant && C.assistant.open(); } }, icon('sparkles', 20), 'Assistente Cedy'), h('button.more-item', { type: 'button', onclick: () => { api.close(); userMenu(document.querySelector('.tb-user')); } }, icon('user', 20), 'Perfil e trocar de usuário')) });
  }

  function buildTopbar(role) {
    const R = C.roles[role];
    return [
      h('a.tb-logo', { href: '#' + R.home, 'aria-label': 'Cedy' }, h('img', { src: 'assets/logo/symbol-light.svg', alt: 'Cedy', height: 30, class: 'tb-logo-light' }), h('img', { src: 'assets/logo/symbol-dark.svg', alt: 'Cedy', height: 30, class: 'tb-logo-dark' })),
      h('div.tb-ctx', ui.live(['session'], () => [h('span.tb-role', { class: 'tone-' + R.tone }, icon(R.icon, 14), R.label), h('span.tb-org', (session.org() || {}).fantasia || '')])),
      h('button.tb-search', { type: 'button', onclick: openPalette, 'aria-label': 'Buscar e navegar (Ctrl K)' }, icon('search', 16), h('span', 'Buscar ou ir para…'), h('kbd', 'Ctrl K')),
      h('div.tb-spacer'),
      ui.live([], () => h('button.tb-clock', { type: 'button', onclick: openDemo, 'aria-label': 'Painel de demonstração: relógio simulado', title: 'Relógio de simulação' }, icon('clock', 15), h('span.tb-clock-t', clockText()), h('span.tb-sim', 'simulado')), { tag: 'span' }),
      ui.iconBtn('sparkles', { label: 'Assistente Cedy', class: 'tb-ai', onclick: () => C.assistant && C.assistant.open() }),
      ui.live(['notifs', 'session', 'conversas', 'comunicados', 'ciencias', 'alertasContato', 'aprovacoes'], () => { const s = session.get(); const n = s && C.engine.com ? C.engine.com.contadores(s.userId).naoLidas : notify.unread(); return ui.iconBtn('bell', { label: 'Mensagens e avisos' + (n ? `, ${n} não lidos` : ''), badge: n ? (n > 9 ? '9+' : n) : null, onclick: (e) => notifPop(e.currentTarget) }); }, { tag: 'span' }),
      ui.live(['session', 'users'], () => { const u = session.user(); return h('button.tb-user', { type: 'button', onclick: (e) => userMenu(e.currentTarget), 'aria-label': 'Menu do usuário ' + u.nome }, ui.avatar(u.nome, { hue: u.hue })); }, { tag: 'span' }),
    ];
  }
  const clockText = () => `${fmt.weekday(C.clock.now())} ${fmt.dateShort(C.clock.now())} · ${fmt.time(C.clock.now())}`;
  setInterval(() => { document.querySelectorAll('.tb-clock-t').forEach((e) => (e.textContent = clockText())); }, 1000);

  /* ------------------------- notificações / usuário ----------------------- */
  function notifPop(anchor) {
    let api; const body = C.comUI.bell(() => api && api.close());
    api = ui.popover(anchor, body, { align: 'end', class: 'pop-notif', title: 'Mensagens e avisos' });
  }
  function userMenu(anchor) {
    const u = session.user(); const o = session.org(); const all = db.all('users').filter((x) => x.id !== u.id);
    const themeLabel = { auto: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' }[prefs.theme];
    ui.menu(anchor, [
      { header: h('div.um-head', ui.avatar(u.nome, { hue: u.hue }), h('div', h('strong', u.nome), h('small', `${o.fantasia || o.nome} · ${u.perfil}`))) },
      { label: 'Meu perfil e segurança', icon: 'user', onclick: () => C.router.go(`/${session.role()}/configuracoes?aba=seguranca`) },
      { label: themeLabel, icon: prefs.theme === 'dark' ? 'moon' : prefs.theme === 'light' ? 'sun' : 'monitor', onclick: () => { const n = { auto: 'light', light: 'dark', dark: 'auto' }[prefs.theme]; prefs.setTheme(n); } },
      { label: 'Painel de demonstração', icon: 'wand-sparkles', onclick: openDemo },
      { divider: true },
      { header: 'Trocar de usuário (demonstração)' },
      ...personasList().slice(0, 40).filter((p) => p.userId !== u.id).map((p) => ({ label: p.nome, hint: `${C.roles[p.key].label} · ${p.empresa} · ${p.perfil}`, icon: C.roles[p.key].icon, onclick: () => switchTo(p) })),
      { divider: true },
      { label: 'Sair', icon: 'log-out', danger: true, onclick: () => C.auth.logout() },
    ], { align: 'end', title: 'Conta' });
  }
  function personasList() { return db.all('users').filter((u) => u.demo).map((u) => { const o = db.get('orgs', u.orgId); return { userId: u.id, orgId: u.orgId, role: C.roleOfOrg(o), key: C.keyOfUser(u, o), nome: u.nome, empresa: o.fantasia, perfil: u.perfil, papel: u.papel }; }).sort((a, b) => a.key.localeCompare(b.key)); }
  function switchTo(p) { session.set({ userId: p.userId, orgId: p.orgId, role: p.role }); C.router.resetStack(); ui.toast('Usuário alterado', { type: 'success', text: `${p.nome}, ${C.roles[p.key].label}` }); C.router.go(C.roles[p.key].home); }
  C.shell = { personas: personasList, switchTo };

  /* ------------------------- painel de demonstração ---------------------- */
  function openDemo() {
    const cl = C.clock;
    const jumps = [['+15 min', 15 * 60e3], ['+1 h', 3600e3], ['+3 h (fim da firmeza)', 3 * 3600e3], ['+1 dia', 86400e3], ['+7 dias', 7 * 86400e3], ['+30 dias', 30 * 86400e3]];
    const toTime = (hh, mm) => { const t = cal().sp(cl.now()); let ts = cal().spTs(t.y, t.m, t.d, hh, mm); if (ts <= cl.now()) ts = cal().nextUtil(cl.now(), hh, mm); cl.set(ts); };
    const cal = () => C.cal;
    const body = h('div.demo',
      ui.callout({ tone: 'info', title: 'Protótipo sem servidor', text: 'Os dados ficam no seu navegador. Aqui você controla o tempo e o mercado para testar regras de prazo, firmeza, corte das 14h30 e vencimentos.' }),
      ui.card({ title: 'Relógio de simulação', subtitle: 'Fuso de Brasília. Avançar dispara vencimentos, expiração e extrato bancário simulado.' },
        ui.live([], () => h('div.demo-now', icon('clock', 18), h('strong', fmt.dateLong(cl.now())), h('span', fmt.time(cl.now()) + ' · ' + (cal().isUtil(cl.now()) ? 'dia útil' : 'sem expediente')))),
        h('div.demo-jumps', jumps.map(([l, ms]) => ui.btn(l, { size: 'sm', onclick: () => { cl.advance(ms); C.engine.tick(); } }))),
        h('div.demo-jumps', ui.btn('Ir para 14h25 (antes do corte)', { size: 'sm', onclick: () => { toTime(14, 25); C.engine.tick(); } }), ui.btn('Ir para 14h35 (depois do corte)', { size: 'sm', onclick: () => { toTime(14, 35); C.engine.tick(); } }), ui.btn('Próximo dia útil 8h', { size: 'sm', onclick: () => { cl.set(cal().nextUtil(cl.now(), 8, 0)); C.engine.tick(); } }),
          ui.btn('Fim do próximo vencimento', { size: 'sm', onclick: () => { const t = db.all('titulos').filter((x) => x.status === 'cedido' && x.vencimento > cl.now()).sort((a, b) => a.vencimento - b.vencimento)[0]; if (t) { cl.set(cal().spTs(cal().sp(t.vencimento).y, cal().sp(t.vencimento).m, cal().sp(t.vencimento).d, 12, 0)); C.engine.tick(); } else ui.toast('Nenhum título cedido a vencer'); } }))),
      ui.card({ title: 'Mercado e Mesa' },
        ui.switch({ label: 'Mercado simulado dando lances', hint: 'Outros financiadores cobrem ofertas abertas (dentro das próprias políticas).', checked: prefs.market, onChange: (v) => prefs.setMarket(v) }),
        h('div.sp-3'), ui.switch({ label: 'Mesa de Operações simulada', hint: 'Aprova lotes sem erro ao fim do SLA se ninguém decidir antes.', checked: db.cfg().mesaSimulada, onChange: (v) => db.setCfg({ mesaSimulada: v }) }),
        h('div.sp-3'), h('div.demo-jumps', ui.btn('Forçar lance de mercado', { size: 'sm', icon: 'gavel', onclick: () => C.engine.mercadoTick(true) }), ui.btn('Gerar crédito de sacado', { size: 'sm', icon: 'banknote', onclick: () => demoCredit() }))),
      C.comUI && C.comUI.demoCard ? C.comUI.demoCard() : null,
      ui.card({ title: 'Dados' }, h('p.muted', 'Restaura as empresas, títulos, operações e a trilha ao estado inicial.'), ui.btn('Restaurar dados de demonstração', { variant: 'danger', icon: 'rotate-ccw', onclick: async () => { if (await ui.confirm({ title: 'Restaurar dados?', text: 'Tudo o que você fez neste navegador será descartado.', tone: 'danger', confirmLabel: 'Restaurar' })) { C.store.reset(C.seed.build); C.router.resetStack(); C.auth.logout(true); } } })));
    ui.drawer({ title: 'Painel de demonstração', icon: 'wand-sparkles', body, size: 'md' });
  }
  function demoCredit() {
    const pagas = db.all('operacoes').filter((o) => ['paga', 'vencida', 'parcial'].includes(o.status));
    if (!pagas.length) return ui.toast('Nenhuma operação a vencer');
    const o = pagas[Math.floor(Math.random() * pagas.length)]; const t = db.get('titulos', o.tituloIds.find((id) => !['liquidado', 'recomprado'].includes(db.get('titulos', id).status)) || o.tituloIds[0]); const s = db.get('orgs', t.sacadoId);
    C.engine.entradaExtrato({ cedenteId: o.cedenteId, valor: C.engine.saldoAberto(o) * (0.62 + Math.random() * 0.4), pagadorCnpj: s.cnpj, pagadorNome: s.nome, descricao: 'Pagamento duplicata (demonstração)' }); ui.toast('Crédito simulado lançado', { type: 'success', text: s.fantasia });
  }
  C.shell.openDemo = openDemo;

  /* ---------------------------- paleta de comandos ------------------------ */
  function openPalette() {
    const role = session.role(); let sel = 0; let results = [];
    const input = h('input', { class: 'pal-input', placeholder: 'Buscar tela, operação, título ou empresa…', 'aria-label': 'Buscar', autofocus: true, oninput: render });
    const list = h('div.pal-list', { role: 'listbox' });
    function data() {
      const me = session.get(); const out = [];
      flat(C.shellKey()).forEach((i) => out.push({ k: 'Ir para', label: i.label, icon: i.icon, go: i.path }));
      out.push({ k: 'Ação', label: 'Abrir assistente', icon: 'sparkles', run: () => C.assistant && C.assistant.open() }, { k: 'Ação', label: 'Painel de demonstração', icon: 'wand-sparkles', run: openDemo }, { k: 'Ação', label: 'Alternar tema claro/escuro', icon: 'moon', run: () => prefs.setTheme(prefs.theme === 'dark' ? 'light' : 'dark') });
      const own = (o) => role === 'ops' || o.cedenteId === me.orgId || o.financiadorId === me.orgId || (role === 'financiador' && o.status === 'aberta');
      db.all('operacoes').filter(own).slice(0, 80).forEach((o) => out.push({ k: 'Operação', label: `${o.id} · ${fmt.brl(o.face, { round: true })}`, hint: ui.statusLabel('operacao', o.status), icon: 'repeat', go: role === 'financiador' ? (o.status === 'aberta' ? '/financiador/vitrine/' : '/financiador/operacoes/') + o.id : role === 'ops' ? '/ops/empresas/' + o.cedenteId : '/cedente/operacoes/' + o.id }));
      if (role === 'cedente') db.all('titulos').filter((t) => t.orgId === me.orgId).forEach((t) => out.push({ k: 'Título', label: `${t.numero} · ${fmt.brl(t.valor, { round: true })}`, hint: (db.get('orgs', t.sacadoId) || {}).fantasia, icon: 'receipt-text', go: '/cedente/titulos?q=' + encodeURIComponent(t.numero) }));
      if (role === 'ops') db.all('orgs').filter((o) => o.kind !== 'cedy').forEach((o) => out.push({ k: 'Empresa', label: o.fantasia || o.nome, hint: o.kind, icon: 'building-2', go: '/ops/empresas/' + o.id }));
      return out;
    }
    const all = data();
    function render() { const q = input.value.trim().toLowerCase(); results = (q ? all.filter((r) => (r.label + ' ' + (r.hint || '') + ' ' + r.k).toLowerCase().includes(q)) : all.slice(0, 9)).slice(0, 12); sel = 0; paint(); }
    function paint() { C.clear(list); if (!results.length) list.append(h('div.pal-empty', 'Nada encontrado')); results.forEach((r, i) => list.append(h('button', { type: 'button', role: 'option', class: ['pal-item', i === sel && 'is-sel'], onmouseenter: () => { sel = i; paint2(); }, onclick: () => pick(r) }, icon(r.icon, 17), h('span.pal-l', r.label, r.hint && h('small', r.hint)), h('span.pal-k', r.k)))); }
    function paint2() { list.querySelectorAll('.pal-item').forEach((b, i) => b.classList.toggle('is-sel', i === sel)); }
    function pick(r) { m.close(); if (r.go) C.router.go(r.go); else if (r.run) r.run(); }
    input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); paint2(); } if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint2(); } if (e.key === 'Enter' && results[sel]) { e.preventDefault(); pick(results[sel]); } });
    const m = ui.modal({ size: 'md', class: 'palette', dismissable: true, mobileSheet: true, body: h('div.pal', h('div.pal-box', icon('search', 18), input), list) });
    render(); setTimeout(() => input.focus(), 80);
  }
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (session.get() && !document.querySelector('.layer')) openPalette(); } });

  /* ------------------------------ ganchos --------------------------------- */
  C.shell.mountApp = mountApp; C.shell.mountBare = mountBare; C.shell.applyTheme = applyTheme;
  C.shell.afterRoute = () => {
    document.querySelectorAll('.sb-item').forEach((a) => { const it = flat(C.shellKey()).find((i) => i.id === a.dataset.id); if (!it) return; const act = isActive(it, activePath()); a.classList.toggle('is-active', act); act ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
    document.querySelectorAll('.bn-item[href]').forEach((a) => { const act = activePath() === a.getAttribute('href').slice(1) || activePath().startsWith(a.getAttribute('href').slice(1) + '/'); a.classList.toggle('is-active', act && a.getAttribute('href') !== '#' + C.roles[C.shellKey()].home || activePath() === a.getAttribute('href').slice(1)); });
  };
  C.store.on(['theme'], applyTheme);
  C.store.on(['session'], () => { shellEl = null; shellKey = ''; });
})();
