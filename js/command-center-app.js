/* ============================================================================
 * GEO ARMY COMMAND CENTER — interfaz
 * ----------------------------------------------------------------------------
 * - Reutiliza la sesión Supabase existente (mismo almacenamiento que el resto del sitio).
 * - Autorización: SOLO la decide el backend (403). No hay comprobaciones locales de rol.
 * - Todo texto de la API se inserta con textContent (nunca HTML no confiable).
 * - Sin tokens en consola ni en almacenamiento propio.
 * - DEMO (?demo=1): servidor falso en memoria, banner permanente. Producción nunca cae a DEMO.
 * ========================================================================== */
(function () {
  'use strict';

  var CC = window.GeoArmyCC;
  var BOOT = window.GEOARMY_CC_BOOT || { siteBase: '/', demo: false };
  var DEMO = !!BOOT.demo;
  var ROOT = document.getElementById('cc-root');

  /* ================================================================= helpers DOM */
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'key') el.setAttribute('data-key', v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    if (kids == null) return el;
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var ICONS = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    commands: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>',
    config: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    audit: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    arcade: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 10v5M4.5 12.5h5"/><circle cx="16" cy="11.5" r=".8"/><circle cx="18.5" cy="14" r=".8"/>',
    bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17v4M17 19h4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><path d="M12 19.5h.01"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    broadcast: '<circle cx="12" cy="12" r="2"/><path d="M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9M4.5 4.5a10 10 0 0 0 0 15M19.5 4.5a10 10 0 0 1 0 15"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/>',
    unplug: '<path d="M3 3l18 18"/><path d="M9 3v4M15 3v4M7 7h10v3.5a5 5 0 0 1-.9 2.9M7.4 10.5A5 5 0 0 0 12 16v5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'
  };
  function icon(name, cls) {
    var t = document.createElement('template');
    // Solo constantes internas: ninguna cadena de la API llega aquí.
    t.innerHTML = '<svg class="cc-ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
    return t.content.firstChild;
  }
  function chip(tone, text, o) {
    o = o || {};
    return h('span', { class: 'cc-chip', 'data-tone': tone }, [o.dot === false ? null : h('i', { class: 'cc-dot', 'data-live': o.live ? '1' : '0' }), text]);
  }
  function skel(w, hgt, extra) { return h('div', { class: 'cc-skel' + (extra ? ' ' + extra : ''), style: 'width:' + w + ';height:' + hgt, 'aria-hidden': 'true' }); }
  function nfmt(n) { return typeof n === 'number' ? n.toLocaleString('es') : '—'; }
  function btn(label, o) {
    o = o || {};
    return h('button', {
      type: 'button', class: 'cc-btn' + (o.cls ? ' ' + o.cls : ''), onclick: o.onclick, disabled: o.disabled, key: o.key,
      'aria-label': o.aria, title: o.title
    }, [o.icon ? icon(o.icon, 'cc-ico--sm') : null, label]);
  }

  /* ================================================================= estado */
  var NAV = [
    { id: 'overview', label: 'Vista general', short: 'General', icon: 'overview' },
    { id: 'commands', label: 'Comandos', short: 'Comandos', icon: 'commands' },
    { id: 'config', label: 'Configuración', short: 'Config', icon: 'config' },
    { id: 'stats', label: 'Estadísticas', short: 'Stats', icon: 'stats' },
    { id: 'audit', label: 'Historial administrativo', short: 'Historial', icon: 'audit' }
  ];
  var FUTURE = [
    { label: 'Geo Army Arcade', icon: 'arcade' },
    { label: 'Notificaciones automáticas', icon: 'bell' },
    { label: 'Overlays OBS', icon: 'monitor' },
    { label: 'Inteligencia artificial', icon: 'ai' }
  ];

  function slot() { return { data: null, error: null, loading: false, loadedAt: 0 }; }
  var S = {
    phase: 'boot',          // boot | loggedout | forbidden | expired | fatal | ready
    gateInfo: null,         // { code } para forbidden/expired/fatal
    user: null,             // { id, label }  (solo presentación)
    api: null, sb: null, demoSrv: null,
    data: { status: slot(), config: slot(), commands: slot(), stats: slot(), audit: slot() },
    etag: null,             // ETag (con comillas) de la configuración CONFIRMADA
    draft: null,            // cambios pendientes (copia editable) o null
    saving: false,
    route: 'overview',
    ui: { cmdQuery: '', cmdFilter: 'all', auditLimit: CC.AUDIT_DEFAULT, auditLimitText: String(CC.AUDIT_DEFAULT), cdText: {}, simOpen: false, auditStale: false }
  };
  var scope = new AbortController();      // se cancela al cerrar sesión / cambiar de cuenta
  var poller = null;
  var shell = null;                       // referencias al armazón (cuando phase === 'ready')

  function confirmed() { return S.data.config.data; }
  function pendingPatch() { var c = confirmed(); return c && S.draft ? CC.diffConfig(c, S.draft) : {}; }
  function pendingCount() { return CC.countChanges(pendingPatch()); }

  /* ================================================================= red */
  // `my` = alcance (sesión) de la operación. Si la sesión cambió mientras tanto, la operación se descarta:
  // ni se renueva el token de la sesión nueva ni se reintenta con el cliente de otra cuenta.
  async function guarded(fn, my) {
    try { return await fn(); }
    catch (e) {
      // Un 401 puede ser solo un token vencido: se intenta UNA renovación de la sesión existente y se reintenta una vez.
      if (e && e.kind === 'http' && e.status === 401 && S.sb) {
        if (my !== scope) throw CC.ApiError('aborted');
        var r = null;
        try { r = await S.sb.auth.refreshSession(); } catch (x) { r = null; }
        if (my !== scope) throw CC.ApiError('aborted');
        if (r && r.data && r.data.session) return await fn();
      }
      throw e;
    }
  }

  // `call(signal, api)` usa el cliente capturado al iniciar (nunca S.api en el momento de ejecución).
  // `commit(out)` aplica efectos laterales (p. ej. el ETag) y SOLO se ejecuta si la sesión sigue siendo la misma.
  async function loadSlot(key, call, commit) {
    var my = scope, api = S.api, sl = S.data[key];
    sl.loading = true;
    requestRender();
    try {
      var out = await guarded(function () { return call(my.signal, api); }, my);
      if (my !== scope) return;
      if (commit) out = commit(out);
      sl.data = out; sl.error = null; sl.loadedAt = Date.now();
    } catch (e) {
      if (my !== scope || (e && e.kind === 'aborted')) return;
      sl.error = e;
    }
    sl.loading = false;
    if (my === scope) { checkGate(); requestRender(); }
  }

  var loaders = {
    status: function () { return loadSlot('status', function (sg, api) { return api.status(sg); }); },
    stats: function () { return loadSlot('stats', function (sg, api) { return api.stats(sg); }); },
    commands: function () { return loadSlot('commands', function (sg, api) { return api.commands(sg); }); },
    audit: function () {
      S.ui.auditStale = false;
      var limit = S.ui.auditLimit;
      return loadSlot('audit', function (sg, api) { return api.audit(limit, sg); });
    },
    config: function () {
      // El ETag viaja junto con la config y solo se guarda tras comprobar que la sesión sigue vigente.
      return loadSlot('config', function (sg, api) { return api.config(sg); }, function (r) { S.etag = r.etag; return r.config; });
    }
  };

  // 401 / 403 de cualquier solicitud ⇒ puerta de acceso (la decisión es del backend).
  function checkGate() {
    if (S.phase !== 'ready') return;
    var keys = Object.keys(S.data);
    for (var i = 0; i < keys.length; i++) {
      var e = S.data[keys[i]].error;
      if (e && e.kind === 'http' && (e.status === 403 || e.status === 401)) {
        var code = e.code;
        wipe();
        S.gateInfo = { code: code };
        setPhase(e.status === 403 ? 'forbidden' : 'expired');
        return;
      }
    }
  }

  function refreshLive() { return Promise.all([loaders.status(), loaders.stats()]); }
  function refreshAll() { return Promise.all([loaders.status(), loaders.stats(), loaders.commands()]); }

  /* ================================================================ sesión */
  // Cancela solicitudes pendientes y retira TODO dato administrativo de memoria e interfaz.
  function wipe() {
    scope.abort();
    scope = new AbortController();
    if (poller) poller.stop();
    S.data = { status: slot(), config: slot(), commands: slot(), stats: slot(), audit: slot() };
    S.etag = null; S.draft = null; S.saving = false; S.api = null;
    S.ui.cdText = {}; S.ui.cmdQuery = ''; S.ui.cmdFilter = 'all'; S.ui.auditStale = false;
    closeModal(true);
    clear(document.getElementById('cc-toasts'));
    shell = null;
    clear(ROOT);
  }

  function enter() {
    if (S.phase === 'ready') return;
    buildApi();
    setPhase('ready');
    Promise.all([loaders.status(), loaders.config(), loaders.commands(), loaders.stats()]);
    if (S.route === 'audit') loaders.audit();
    if (!poller) {
      poller = CC.createPoller({ intervalMs: CC.POLL_MS, task: refreshLive, isVisible: function () { return !document.hidden; } });
      document.addEventListener('visibilitychange', function () { if (poller) poller.setVisible(!document.hidden); });
    }
    poller.start(false);
  }

  function buildApi() {
    if (DEMO) {
      S.demoSrv = window.GeoArmyCCDemo.create();
      S.api = CC.createApiClient({ fetch: S.demoSrv.fetch, getToken: function () { return Promise.resolve('demo'); } });
    } else {
      var boundUid = S.user && S.user.id, sb = S.sb;
      S.api = CC.createApiClient({
        fetch: window.fetch.bind(window),
        // El token solo se lee aquí, en el momento de cada solicitud; no se guarda ni se imprime.
        // Este cliente pertenece a UNA cuenta: si la sesión activa es de otra, la solicitud se cancela y no sale ningún token ajeno.
        getToken: async function () {
          var r = await sb.auth.getSession();
          var ses = r && r.data && r.data.session;
          if (!ses) return null;
          if (!ses.user || ses.user.id !== boundUid) throw CC.ApiError('aborted');
          return ses.access_token;
        }
      });
    }
  }

  function userLabel(session) {
    var m = (session && session.user && session.user.user_metadata) || {};
    return String(m.preferred_username || m.user_name || m.name || m.full_name || 'Cuenta de Twitch');
  }

  function applySession(session) {
    if (!session || !session.user) {
      if (S.phase === 'ready' || S.user) wipe();
      S.user = null; S.gateInfo = null;
      setPhase('loggedout');
      return;
    }
    var uid = session.user.id;
    if (S.phase === 'forbidden' && S.user && S.user.id === uid) return;     // el backend ya negó a esta cuenta
    if (S.user && S.user.id !== uid) { wipe(); S.phase = 'boot'; }          // cambio de cuenta
    S.user = { id: uid, label: userLabel(session) };
    if (S.phase === 'ready') { requestRender(); return; }                   // renovación de token: nada que hacer
    enter();
  }

  async function startReal() {
    if (!window.supabase || !window.supabase.createClient || !window.GEOARMY_SUPABASE_URL || String(window.GEOARMY_SUPABASE_URL).indexOf('TU-PROYECTO') !== -1) {
      S.gateInfo = { code: null, text: 'No se pudo cargar el sistema de cuentas (supabase-js o js/geoarmy-config.js).' };
      setPhase('fatal'); return;
    }
    // Misma configuración y mismo almacenamiento de sesión que el resto del sitio → no se pide otro inicio de sesión.
    S.sb = window.supabase.createClient(window.GEOARMY_SUPABASE_URL, window.GEOARMY_SUPABASE_ANON_KEY);
    S.sb.auth.onAuthStateChange(function (event, session) {
      // Diferido: no se llama a Supabase dentro del propio callback de auth.
      setTimeout(function () {
        if (event === 'SIGNED_OUT') applySession(null);
        else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
          if (!session) { if (event !== 'INITIAL_SESSION') applySession(null); return; }
          applySession(session);
        }
      }, 0);
    });
    var r = await S.sb.auth.getSession();
    applySession(r && r.data ? r.data.session : null);
  }

  function login() {
    if (!S.sb) return;
    try { sessionStorage.setItem('geoarmy_return_to_v1', window.location.pathname); } catch (e) { /* no crítico */ }
    S.sb.auth.signInWithOAuth({
      provider: 'twitch',
      options: { redirectTo: window.location.origin + BOOT.siteBase + 'auth/callback/', scopes: 'user:read:email' }
    });
  }
  function logout() {
    if (DEMO) { window.location.href = window.location.pathname; return; }
    if (S.sb) S.sb.auth.signOut();
  }

  /* ================================================================ render */
  var renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    Promise.resolve().then(function () { renderQueued = false; render(); });
  }

  function setPhase(p) { S.phase = p; render(); }

  function render() {
    if (S.phase === 'ready') {
      if (!shell) buildShell();
      renderChrome();
      renderMain();
    } else if (S.phase !== 'boot') {
      renderGate();
    }
  }

  /* ---- puertas de acceso ---- */
  function renderGate() {
    shell = null;
    var g = S.gateInfo || {};
    var cfg = {
      loggedout: { icon: null, title: 'Acceso al Command Center', text: 'Inicia sesión con tu cuenta de Twitch. Si ya iniciaste sesión en geoarmy.tv, se reutiliza esa sesión.', act: [btn('Continuar con Twitch', { cls: 'cc-btn--gold', onclick: login, key: 'login' })] },
      forbidden: { icon: 'shield', title: 'Acceso denegado', text: 'El backend no autoriza a esta cuenta. El Command Center es exclusivo del propietario del canal.', act: [btn('Cerrar sesión', { onclick: logout, key: 'logout' }), h('a', { class: 'cc-btn', href: BOOT.siteBase + 'index.html' }, 'Volver al inicio')] },
      expired: { icon: 'clock', title: 'Sesión vencida', text: 'La sesión no es válida o ha vencido. Los datos administrativos se retiraron de la pantalla.', act: [btn(DEMO ? 'Reiniciar DEMO' : 'Iniciar sesión', { cls: 'cc-btn--gold', onclick: DEMO ? function () { window.location.href = window.location.pathname + '?demo=1'; } : login, key: 'login' })] },
      fatal: { icon: 'alert', title: 'No se pudo iniciar', text: g.text || 'Falló la carga de recursos necesarios.', act: [btn('Reintentar', { cls: 'cc-btn--gold', onclick: function () { window.location.reload(); }, key: 'retry' })] }
    }[S.phase];
    if (!cfg) return;
    var card = h('section', { class: 'cc-card cc-gate-card', 'aria-labelledby': 'cc-gate-h' }, [
      h('div', { class: 'cc-mark cc-mark--lg', 'aria-hidden': 'true' }, h('b', { text: 'G' })),
      h('h1', { id: 'cc-gate-h', text: cfg.title, tabindex: '-1' }),
      h('p', { text: cfg.text }),
      g.code ? h('p', { class: 'cc-code', text: 'código: ' + g.code }) : null,
      h('div', { class: 'cc-acts' }, cfg.act)
    ]);
    clear(ROOT);
    ROOT.appendChild(h('main', { class: 'cc-gate', id: 'cc-main' }, [DEMO ? demoBannerEl(false) : null, card]));
    var hd = document.getElementById('cc-gate-h'); if (hd) hd.focus({ preventScroll: true });
    document.title = cfg.title + ' · Geo Army Command Center';
  }

  /* ---- armazón ---- */
  function buildShell() {
    clear(ROOT);
    var navList = h('ul', { class: 'cc-nav' }, NAV.map(function (n) {
      return h('li', null, h('a', { href: '#/' + n.id, key: 'nav-' + n.id, 'data-route': n.id }, [icon(n.icon), h('span', { text: n.label }), n.id === 'config' ? h('span', { class: 'cc-badge', 'data-pendbadge': '1', hidden: true }) : null]));
    }));
    var futList = h('ul', { class: 'cc-nav' }, FUTURE.map(function (f) {
      return h('li', null, h('button', { type: 'button', class: 'cc-locked', 'aria-disabled': 'true', title: 'Módulo futuro: todavía no disponible' }, [icon(f.icon), h('span', { text: f.label }), icon('lock', 'cc-lockico cc-ico--sm')]));
    }));
    var side = h('aside', { class: 'cc-side', 'aria-label': 'Navegación del Command Center' }, [
      h('div', { class: 'cc-brand' }, [h('div', { class: 'cc-mark', 'aria-hidden': 'true' }, h('b', { text: 'G' })), h('div', null, [h('strong', { text: 'Geo Army' }), h('small', { text: 'Command Center' })])]),
      h('nav', { 'aria-label': 'Secciones' }, [h('div', { class: 'cc-navgroup', text: 'Operaciones' }), navList]),
      h('div', { class: 'cc-navgroup', text: 'Próximamente' }), futList,
      h('div', { class: 'cc-side-foot' }, [
        h('div', { class: 'cc-who' }, [icon('shield', 'cc-ico--sm'), h('span', { 'data-who': '1' })]),
        btn(DEMO ? 'Salir de DEMO' : 'Cerrar sesión', { onclick: logout, icon: 'logout', cls: 'cc-btn--sm', key: 'logout' })
      ])
    ]);

    var top = h('header', { class: 'cc-top' }, [
      h('div', { class: 'cc-mark', 'aria-hidden': 'true' }, h('b', { text: 'G' })),
      h('div', { class: 'cc-crumb' }, ['GEO ARMY // COMMAND CENTER // ', h('b', { 'data-crumb': '1' })]),
      h('div', { class: 'cc-top-r', 'data-topr': '1' })
    ]);
    var main = h('main', { class: 'cc-main', id: 'cc-main', tabindex: '-1' });
    var pending = h('div', { class: 'cc-pending', role: 'region', 'aria-label': 'Cambios pendientes', hidden: true });
    var tabs = h('nav', { class: 'cc-tabs', 'aria-label': 'Secciones' }, NAV.map(function (n) {
      return h('a', { href: '#/' + n.id, 'data-route': n.id }, [icon(n.icon), h('span', { text: n.short })]);
    }));
    var body = h('div', { class: 'cc-body' }, [top, DEMO ? demoBannerEl(true) : null, main, pending]);
    ROOT.appendChild(h('div', { class: 'cc-shell' }, [side, body]));
    ROOT.appendChild(tabs);
    shell = { main: main, top: top, pending: pending, side: side, tabs: tabs, body: body };
  }

  function demoBannerEl(withSim) {
    var wrap = h('div', { 'data-demo': '1' });
    var bar = h('div', { class: 'cc-demo', role: 'note' }, [
      icon('flask', 'cc-ico--sm'), h('strong', { text: 'MODO DEMO' }),
      h('span', { text: 'Datos simulados en memoria. No se envía ninguna solicitud a la API real ni se usa tu sesión.' }),
      h('div', { class: 'cc-demo-r' }, [
        withSim ? btn(S.ui.simOpen ? 'Ocultar simulador' : 'Simulador', { cls: 'cc-btn--sm', key: 'sim-toggle', onclick: function () { S.ui.simOpen = !S.ui.simOpen; render(); } }) : null,
        h('a', { class: 'cc-btn cc-btn--sm', href: window.location.pathname }, 'Salir de DEMO')
      ])
    ]);
    wrap.appendChild(bar);
    if (withSim && S.demoSrv) wrap.appendChild(simPanel());
    return wrap;
  }

  function simPanel() {
    var c = S.demoSrv.controls, snap = c.snapshot().sim;
    function sb(label, fn, on) { return h('button', { type: 'button', class: 'cc-btn cc-btn--sm', 'aria-pressed': on ? 'true' : 'false', key: 'sim-' + label, onclick: function () { fn(); refreshAll(); } }, label); }
    return h('div', { class: 'cc-sim', 'data-open': S.ui.simOpen ? '1' : '0', 'aria-label': 'Simulador DEMO' }, [
      h('b', { text: 'Simular' }),
      sb(snap.network ? 'Restaurar API' : 'API inaccesible', function () { c.setNetworkDown(!snap.network); }, snap.network),
      sb(snap.httpStatus === 503 ? 'Quitar 503' : 'Error 503', function () { c.setHttpStatus(snap.httpStatus === 503 ? 0 : 503); }, snap.httpStatus === 503),
      sb('Sesión vencida (401)', function () { c.setHttpStatus(401); }),
      sb('Acceso denegado (403)', function () { c.setHttpStatus(403); }),
      sb('Canal en directo', function () { c.setStream('live'); }),
      sb('Canal offline', function () { c.setStream('offline'); }),
      sb('Canal desconocido', function () { c.setStream('unknown'); }),
      sb('IRC desconectado', function () { c.setIrc(false); }),
      sb('IRC conectado', function () { c.setIrc(true); }),
      sb('Discord desconectado', function () { c.setDiscord(false); }),
      sb('Otra sesión cambia la config', function () { c.externalConfigChange(); })
    ]);
  }

  function connectionChip() {
    var st = S.data.status;
    if (DEMO) return chip('gold', 'DEMO', { dot: false });
    if (st.error && st.data) return chip('warn', 'Sin conexión · datos antiguos');
    if (st.error) return chip('warn', 'API inaccesible');
    if (st.data) return chip('ok', 'API conectada', { live: true });
    return chip('unk', 'Conectando…');
  }

  function withFocus(container, fn) {
    var a = document.activeElement, key = a && container.contains(a) ? a.getAttribute('data-key') : null;
    fn();
    if (key) { var el = container.querySelector('[data-key="' + key + '"]'); if (el) el.focus({ preventScroll: true }); }
  }

  function renderChrome() {
    if (!shell) return;
    if (DEMO) {
      var old = shell.body.querySelector('[data-demo]');
      if (old) withFocus(shell.body, function () { old.replaceWith(demoBannerEl(true)); });
    }
    var route = NAV.filter(function (n) { return n.id === S.route; })[0] || NAV[0];
    shell.side.querySelectorAll('a[data-route]').forEach(function (a) { setCurrent(a, a.getAttribute('data-route') === route.id); });
    shell.tabs.querySelectorAll('a[data-route]').forEach(function (a) { setCurrent(a, a.getAttribute('data-route') === route.id); });
    shell.top.querySelector('[data-crumb]').textContent = route.label.toUpperCase();
    shell.side.querySelector('[data-who]').textContent = S.user ? S.user.label : '';
    var tr = shell.top.querySelector('[data-topr]');
    clear(tr);
    var st = S.data.status.data;
    if (st && st.mode && !S.data.status.error) tr.appendChild(chip(st.mode === 'PUBLIC' ? 'warn' : st.mode === 'OFF' ? 'unk' : 'gold', 'Modo ' + st.mode, { dot: false }));
    tr.appendChild(connectionChip());
    var anyLoading = ['status', 'stats', 'commands'].some(function (k) { return S.data[k].loading; });
    tr.appendChild(h('button', { type: 'button', class: 'cc-btn cc-btn--icon cc-btn--sm', 'aria-label': 'Actualizar estado y estadísticas', title: 'Actualizar', key: 'top-refresh', onclick: refreshAll, disabled: anyLoading }, anyLoading ? h('span', { class: 'cc-spin' }) : icon('refresh')));

    var n = pendingCount();
    var badge = shell.side.querySelector('[data-pendbadge]');
    if (badge) { badge.hidden = n === 0; badge.textContent = String(n); }
    renderPendingBar(n);
    document.title = route.label + ' · Geo Army Command Center';
  }
  function setCurrent(a, on) { if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }

  function renderPendingBar(n) {
    var bar = shell.pending;
    if (!n) { bar.hidden = true; clear(bar); return; }
    var wasHidden = bar.hidden;
    bar.hidden = false;
    var keep = document.activeElement && bar.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
    clear(bar);
    var errs = CC.validateDraft(confirmed(), S.draft);
    var invalid = Object.keys(errs).length > 0;
    append(bar, [
      h('div', null, [icon('alert'), h('span', null, [n + (n === 1 ? ' cambio pendiente' : ' cambios pendientes'), h('br'), h('small', { text: invalid ? 'Hay valores no válidos: corrígelos antes de guardar.' : 'Sin guardar · la configuración confirmada no ha cambiado.' })])]),
      h('div', { class: 'cc-pend-act' }, [
        btn('Descartar', { key: 'pend-discard', onclick: discardDraft, disabled: S.saving }),
        btn('Revisar y guardar', { key: 'pend-review', cls: 'cc-btn--gold', onclick: openSaveModal, disabled: S.saving })
      ])
    ]);
    if (keep) { var el = bar.querySelector('[data-key="' + keep + '"]'); if (el) el.focus({ preventScroll: true }); }
    if (!wasHidden) bar.style.animation = 'none';
  }

  /* ---- main ---- */
  function renderMain() {
    if (!shell) return;
    var active = document.activeElement, key = null, selStart = null, selEnd = null;
    if (active && shell.main.contains(active)) {
      key = active.getAttribute('data-key');
      try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) { /* sin selección */ }
    }
    var view = ({ overview: viewOverview, commands: viewCommands, config: viewConfig, stats: viewStats, audit: viewAudit })[S.route] || viewOverview;
    clear(shell.main);
    shell.main.appendChild(view());
    if (key) {
      var el = shell.main.querySelector('[data-key="' + key + '"]');
      if (el) { el.focus({ preventScroll: true }); try { if (selStart != null) el.setSelectionRange(selStart, selEnd); } catch (e) { /* idem */ } }
    }
  }

  function pageHead(kicker, title, desc, right) {
    return h('div', { class: 'cc-pagehead' }, [
      h('div', null, [h('h1', { id: 'cc-h1', tabindex: '-1' }, [h('small', { text: kicker }), title]), desc ? h('p', { text: desc }) : null]),
      right ? h('div', null, right) : null
    ]);
  }

  function slotAlerts(keys, retry) {
    var seen = {}, out = [];
    keys.forEach(function (k) {
      var e = S.data[k].error;
      if (!e || e.kind === 'aborted') return;
      var d = CC.describeError(e), id = d.title + '|' + (d.code || '');
      if (seen[id]) return; seen[id] = 1;
      var stale = S.data[k].data ? ' Se muestra el último dato recibido (' + CC.relativeTime(new Date(S.data[k].loadedAt).toISOString()) + ').' : '';
      out.push(h('div', { class: 'cc-alert', role: 'alert', 'data-tone': d.severity === 'warn' ? 'warn' : 'bad' }, [
        icon(e.kind === 'network' ? 'unplug' : 'alert'),
        h('div', null, [h('h3', { text: d.title }), h('p', null, [d.detail + stale, d.code ? [' ', h('code', { text: d.code })] : null])]),
        h('div', { class: 'cc-alert-act' }, btn('Reintentar', { cls: 'cc-btn--sm', key: 'retry-' + k, onclick: retry || refreshAll }))
      ]));
    });
    return out;
  }

  /* ======================================================== vista: general */
  function botState() {
    var sl = S.data.status, d = sl.data;
    if (!d) {
      if (sl.error) {
        var de = CC.describeError(sl.error);
        return { tone: 'unk', icon: 'unplug', title: de.title, text: 'Sin datos del bot: no se puede saber si está conectado o no.', live: false };
      }
      return null;
    }
    if (!d.irc || !d.irc.connected) return { tone: 'bad', icon: 'power', title: 'IRC desconectado', text: 'El bot está activo, pero no está conectado al chat de Twitch.', live: false };
    if (d.discordConnected === false) return { tone: 'warn', icon: 'chat', title: 'Discord desconectado', text: 'El bot responde en el chat; su conexión con Discord está caída.', live: true };
    if (d.mode === 'OFF') return { tone: 'warn', icon: 'power', title: 'Comandos suspendidos', text: 'El bot está conectado, pero el modo OFF suspende todos los comandos.', live: true };
    return { tone: 'ok', icon: 'bolt', title: 'Bot operativo', text: d.mode === 'TEST' ? 'Conectado. Modo TEST: solo responde a usuarios autorizados.' : 'Conectado y respondiendo a toda la comunidad.', live: true };
  }

  function metric(label, ico, value, sub, o) {
    o = o || {};
    return h('article', { class: 'cc-card cc-metric', 'data-tone': o.tone || '' }, [
      h('div', { class: 'cc-lab' }, [icon(ico, 'cc-ico--sm'), label]),
      h('div', { class: 'cc-val' + (o.sm ? ' sm' : '') }, value),
      sub ? h('div', { class: 'cc-sub' }, sub) : null
    ]);
  }

  function viewOverview() {
    var wrap = h('div', { class: 'cc-stack' });
    var st = S.data.status, d = st.data, stale = !!(st.error && d);
    var refreshing = st.loading || S.data.stats.loading;
    wrap.appendChild(pageHead('01 / Operaciones', 'Vista general', 'Estado real del bot de Twitch de GeoArmy.tv. Se actualiza cada 30 s mientras esta pestaña está visible.', [
      h('div', { class: 'cc-top-r' }, [
        d && st.loadedAt ? h('span', { class: 'cc-mono', style: 'font-size:12.5px;color:var(--cc-dim)', text: 'Datos de ' + CC.relativeTime(new Date(st.loadedAt).toISOString()) }) : null,
        btn(refreshing ? 'Actualizando…' : 'Actualizar', { icon: 'refresh', key: 'ov-refresh', onclick: refreshAll, disabled: refreshing })
      ])
    ]));
    slotAlerts(['status', 'stats', 'commands']).forEach(function (a) { wrap.appendChild(a); });

    var bs = botState();
    var hero = h('section', { class: 'cc-card cc-hero' + (stale ? ' cc-stale' : ''), 'aria-label': 'Estado del bot' });
    if (!bs && !d) {
      append(hero, [h('div', { class: 'cc-hero-state' }, [skel('84px', '84px', 'cc-skel--round'), h('div', { style: 'flex:1' }, [skel('220px', '30px'), h('div', { style: 'height:10px' }), skel('90%', '14px')])]), h('div', { class: 'cc-hero-links' }, [skel('100%', '46px'), skel('100%', '46px')])]);
    } else {
      var orbIcon = bs ? bs.icon : 'unplug';
      append(hero, [
        h('div', { class: 'cc-hero-state' }, [
          h('div', { class: 'cc-orb', 'data-tone': bs ? bs.tone : 'unk', 'data-live': bs && bs.live ? '1' : '0' }, icon(orbIcon)),
          h('div', null, [h('h2', { text: bs ? bs.title : 'Sin datos' }), h('p', { text: bs ? bs.text : '' })])
        ]),
        h('div', { class: 'cc-hero-links' }, d ? [
          linkRow('wifi', 'Conexión IRC', d.irc ? (d.irc.connected ? chip('ok', 'Conectado', { live: true }) : chip('bad', 'Desconectado')) : chip('unk', 'Sin dato'), d.irc && d.irc.connected && d.irc.uptimeSeconds != null ? CC.formatDuration(d.irc.uptimeSeconds) : null),
          linkRow('chat', 'Conexión Discord', d.discordConnected === null ? chip('unk', 'Sin dato') : d.discordConnected ? chip('ok', 'Conectado', { live: true }) : chip('bad', 'Desconectado'))
        ] : [h('p', { style: 'margin:0;color:var(--cc-mute);font-size:14px', text: 'Las conexiones IRC y Discord se mostrarán cuando la API responda.' })])
      ]);
    }
    wrap.appendChild(hero);

    var cmds = S.data.commands.data;
    var enabledN = cmds ? cmds.filter(function (c) { return c.enabled; }).length : null;
    var grid = h('div', { class: 'cc-grid cc-g4 cc-keep2' + (stale ? ' cc-stale' : '') });
    if (!d && !st.error) {
      for (var i = 0; i < 4; i++) grid.appendChild(h('article', { class: 'cc-card' }, [skel('60%', '12px'), h('div', { style: 'height:14px' }), skel('50%', '34px'), h('div', { style: 'height:10px' }), skel('80%', '12px')]));
    } else if (d) {
      var sState = d.stream.state;
      var sChip = sState === 'live' ? chip('ok', 'En directo', { live: true }) : sState === 'offline' ? chip('unk', 'Offline') : chip('unk', 'Sin confirmar');
      var chk = d.stream.checkedAt;
      append(grid, [
        metric('Tiempo activo', 'clock', CC.formatDuration(d.uptimeSeconds), 'Proceso del bot (valor de la última consulta)'),
        metric('Modo actual', 'shield', d.mode || '—', d.mode ? CC.modeLabel(d.mode).split(' — ')[1] : '', { tone: d.mode === 'PUBLIC' ? 'bad' : 'gold' }),
        metric('Canal de Twitch', 'broadcast', sChip, d.channel ? '@' + d.channel : null, { sm: true }),
        metric('Última comprobación Helix', 'refresh', chk ? CC.relativeTime(chk) : 'Sin comprobar', chk ? CC.formatDateTime(chk).time : 'Helix es la API de Twitch que informa del directo.', { sm: true })
      ]);
    }
    wrap.appendChild(grid);

    var row = h('div', { class: 'cc-grid cc-g3' + (stale ? ' cc-stale' : '') });
    row.appendChild(h('article', { class: 'cc-card cc-metric', 'data-tone': 'gold' }, [
      h('div', { class: 'cc-lab' }, [icon('commands', 'cc-ico--sm'), 'Comandos habilitados']),
      cmds ? h('div', { class: 'cc-val' }, [String(enabledN), h('span', { style: 'color:var(--cc-dim);font-size:.6em', text: ' / ' + cmds.length })]) : (S.data.commands.error ? h('div', { class: 'cc-val', style: 'color:var(--cc-dim)', text: '—' }) : skel('90px', '38px', 'cc-skel--val')),
      h('div', { class: 'cc-sub' }, h('a', { href: '#/commands', text: 'Administrar comandos' }))
    ]));
    var ss = S.data.stats.data;
    var sum = h('article', { class: 'cc-card cc-span2' }, [
      h('h2', null, [icon('stats'), 'Resumen de estadísticas']),
      ss ? h('div', { class: 'cc-grid cc-g4 cc-keep2' }, [mini('Ejecuciones', ss.totals.executed), mini('Errores', ss.totals.errors, ss.totals.errors ? 'bad' : ''), mini('Envíos aceptados por IRC', ss.totals.sent, 'ok'), mini('Descartes', ss.totals.discarded)])
        : (S.data.stats.error ? h('p', { style: 'margin:0;color:var(--cc-mute);font-size:14px', text: 'Sin datos de estadísticas: la API no respondió.' }) : h('div', { class: 'cc-grid cc-g4 cc-keep2' }, [skel('100%', '52px'), skel('100%', '52px'), skel('100%', '52px'), skel('100%', '52px')])),
      ss ? h('p', { class: 'cc-sub', style: 'margin:14px 0 0;font-size:12.5px;color:var(--cc-mute)' }, ['Desde el último arranque del proceso. ', h('a', { href: '#/stats', text: 'Ver estadísticas completas' })]) : null
    ]);
    row.appendChild(sum);
    wrap.appendChild(row);

    var fut = h('section', { class: 'cc-card cc-future-panel', 'aria-label': 'Próximos módulos' }, [
      h('h2', null, [icon('lock'), 'Próximos módulos']),
      h('ul', { class: 'cc-future' }, FUTURE.map(function (f) { return h('li', { 'aria-disabled': 'true' }, [icon(f.icon), h('div', null, [h('span', { text: f.label }), h('small', { text: 'Bloqueado' })])]); }))
    ]);
    wrap.appendChild(fut);
    return wrap;
  }
  function mini(label, v, tone) {
    return h('div', { class: 'cc-metric', 'data-tone': tone || '' }, [h('div', { class: 'cc-lab', text: label }), h('div', { class: 'cc-val sm', style: 'margin-top:8px' }, nfmt(v))]);
  }
  function linkRow(ico, label, right, small) {
    return h('div', { class: 'cc-linkrow' }, [h('span', null, [icon(ico, 'cc-ico--sm'), label, small ? h('small', { text: small }) : null]), right]);
  }

  /* ========================================================= vista: comandos */
  function draftView() { var c = confirmed(); return S.draft || (c ? CC.editableOf(c) : null); }
  function commandState(name, apiEnabled) {
    var c = confirmed(), dv = draftView();
    var editable = !!(c && dv && Object.prototype.hasOwnProperty.call(c.commands, name));
    var value = editable ? dv.commands[name] : apiEnabled;
    var pending = editable && dv.commands[name] !== c.commands[name];
    return { editable: editable, value: value, pending: pending };
  }

  function toggleCommand(name) {
    var c = confirmed(); if (!c || !Object.prototype.hasOwnProperty.call(c.commands, name)) return;
    if (!S.draft) S.draft = CC.editableOf(c);
    S.draft.commands[name] = !S.draft.commands[name];
    afterDraftChange();
  }
  function afterDraftChange() {
    var c = confirmed();
    if (c && S.draft && CC.countChanges(CC.diffConfig(c, S.draft)) === 0) { S.draft = null; S.ui.cdText = {}; }
    renderChrome(); renderMain();
  }
  function discardDraft() { S.draft = null; S.ui.cdText = {}; renderChrome(); renderMain(); toast('Cambios pendientes descartados.', 'ok'); }

  function viewCommands() {
    var wrap = h('div', { class: 'cc-stack' });
    var sl = S.data.commands, list = sl.data;
    wrap.appendChild(pageHead('02 / Operaciones', 'Comandos', 'Catálogo dinámico desde la API. Los interruptores preparan cambios pendientes: nada se guarda hasta que lo confirmes.', [btn('Actualizar', { icon: 'refresh', key: 'cmd-refresh', onclick: function () { loaders.commands(); loaders.status(); }, disabled: sl.loading })]));
    slotAlerts(['commands', 'config'], function () { loaders.commands(); if (S.data.config.error) reloadConfig(); }).forEach(function (a) { wrap.appendChild(a); });

    if (!list) {
      var g = h('div', { class: 'cc-cmds' });
      if (!sl.error) for (var i = 0; i < 6; i++) g.appendChild(h('article', { class: 'cc-card cc-cmd' }, [skel('45%', '28px'), skel('90%', '14px'), skel('60%', '14px'), skel('100%', '34px')]));
      wrap.appendChild(g);
      return wrap;
    }

    var q = S.ui.cmdQuery.trim().toLowerCase().replace(/^!/, ''), filt = S.ui.cmdFilter;
    var items = list.map(function (c) { return { c: c, st: commandState(c.name, c.enabled) }; });
    var counts = { all: items.length, enabled: 0, disabled: 0, pending: 0 };
    items.forEach(function (it) { if (it.st.value) counts.enabled++; else counts.disabled++; if (it.st.pending) counts.pending++; });
    var shown = items.filter(function (it) {
      if (filt === 'enabled' && !it.st.value) return false;
      if (filt === 'disabled' && it.st.value) return false;
      if (filt === 'pending' && !it.st.pending) return false;
      if (!q) return true;
      return it.c.name.toLowerCase().indexOf(q) !== -1 || it.c.aliases.some(function (a) { return a.toLowerCase().indexOf(q) !== -1; });
    });

    var search = h('div', { class: 'cc-search' }, [icon('search', 'cc-ico--sm'),
      h('input', { class: 'cc-input', type: 'search', key: 'cmd-q', id: 'cmd-q', value: null, placeholder: 'Buscar comando o alias…', 'aria-label': 'Buscar comando o alias', autocomplete: 'off', oninput: function (ev) { S.ui.cmdQuery = ev.target.value; renderMain(); } })]);
    search.querySelector('input').value = S.ui.cmdQuery;
    var seg = h('div', { class: 'cc-seg', role: 'group', 'aria-label': 'Filtrar por estado' }, [
      ['all', 'Todos'], ['enabled', 'Habilitados'], ['disabled', 'Deshabilitados'], ['pending', 'Con cambios']
    ].map(function (f) {
      return h('button', { type: 'button', key: 'flt-' + f[0], 'aria-pressed': filt === f[0] ? 'true' : 'false', onclick: function () { S.ui.cmdFilter = f[0]; renderMain(); } }, f[1] + ' ' + counts[f[0]]);
    }));
    wrap.appendChild(h('div', { class: 'cc-toolbar' }, [search, seg]));
    wrap.appendChild(h('p', { class: 'cc-sr', 'aria-live': 'polite', text: shown.length + ' comandos mostrados' }));

    if (!shown.length) {
      wrap.appendChild(h('div', { class: 'cc-card cc-empty' }, [icon(q || filt !== 'all' ? 'search' : 'commands'), h('h3', { text: list.length ? 'Sin resultados' : 'Sin comandos' }), h('p', { text: list.length ? 'Ningún comando coincide con la búsqueda o el filtro actual.' : 'La API no devolvió ningún comando.' }),
        list.length ? btn('Limpiar filtros', { key: 'clear-f', onclick: function () { S.ui.cmdQuery = ''; S.ui.cmdFilter = 'all'; renderMain(); } }) : null]));
      return wrap;
    }

    var ctx = { status: S.data.status.error ? null : S.data.status.data, config: confirmed() };
    var grid = h('div', { class: 'cc-cmds' });
    shown.forEach(function (it) {
      var c = it.c, st = it.st, info = CC.commandInfo(c.name);
      var av = CC.commandAvailability({ enabled: c.enabled }, ctx);
      var tone = ({ on: 'ok', limited: 'gold', off: 'unk', blocked: 'bad', unknown: 'unk' })[av.state];
      var sw = h('button', { type: 'button', class: 'cc-switch', role: 'switch', key: 'sw-' + c.name, 'aria-checked': st.value ? 'true' : 'false', 'aria-label': 'Comando !' + c.name + ' habilitado', 'data-pending': st.pending ? '1' : null, disabled: !st.editable || S.saving, title: st.editable ? null : 'La configuración no está cargada o no incluye este comando', onclick: function () { toggleCommand(c.name); } });
      grid.appendChild(h('article', { class: 'cc-card cc-cmd', 'data-pending': st.pending ? '1' : null }, [
        h('div', { class: 'cc-cmd-head' }, [h('h2', { class: 'cc-cmd-name' }, [h('i', { text: '!' }), c.name]), sw]),
        h('p', { class: 'cc-cmd-desc' + (info ? '' : ' none'), text: info || 'Sin descripción registrada en la interfaz.' }),
        h('div', { class: 'cc-alias' }, c.aliases.length ? ['Alias:', c.aliases.map(function (a) { return h('code', { text: '!' + a }); })] : [h('span', { text: 'Sin alias' })]),
        h('div', { class: 'cc-cmd-foot' }, [
          h('span', { title: av.reason }, chip(tone, av.label, { live: av.state === 'on' })),
          h('small', { text: st.pending ? 'Pendiente: se ' + (st.value ? 'habilitará' : 'deshabilitará') : av.reason })
        ])
      ]));
    });
    wrap.appendChild(grid);
    wrap.appendChild(h('p', { class: 'cc-note' }, [icon('info', 'cc-ico--sm'), 'La disponibilidad efectiva se calcula con la configuración confirmada, el modo, la conexión IRC y el estado del canal. Las descripciones son textos locales de la interfaz; la API solo entrega nombre, alias y estado.']));
    return wrap;
  }

  /* ======================================================== vista: configuración */
  function viewConfig() {
    var wrap = h('div', { class: 'cc-stack' });
    var sl = S.data.config, c = sl.data;
    wrap.appendChild(pageHead('03 / Sistema', 'Configuración', 'Se muestra la configuración confirmada por el servidor. Tus ediciones quedan como cambios pendientes hasta que las guardes.', [btn('Recargar', { icon: 'refresh', key: 'cfg-reload', onclick: function () { reloadConfig(); }, disabled: sl.loading || S.saving })]));
    slotAlerts(['config'], function () { reloadConfig(); }).forEach(function (a) { wrap.appendChild(a); });
    if (!c) {
      if (!sl.error) append(wrap, [h('div', { class: 'cc-card' }, [skel('30%', '16px'), h('div', { style: 'height:14px' }), skel('100%', '90px')]), h('div', { class: 'cc-card' }, [skel('30%', '16px'), h('div', { style: 'height:14px' }), skel('100%', '60px')])]);
      return wrap;
    }
    if (!S.etag) wrap.appendChild(h('div', { class: 'cc-alert', role: 'alert', 'data-tone': 'warn' }, [icon('alert'), h('div', null, [h('h3', { text: 'Edición bloqueada' }), h('p', { text: 'La API no entregó el ETag de la configuración (o el navegador no pudo leerlo). Sin él no se puede guardar de forma segura; la configuración es de solo lectura.' })])]));
    var dv = draftView(), locked = !S.etag || S.saving;
    var errs = S.draft ? CC.validateDraft(c, S.draft) : {};

    // Modo
    var modeInfo = { OFF: 'Comandos suspendidos.', TEST: 'Acceso limitado a usuarios autorizados.', PUBLIC: 'Acceso para toda la comunidad.' };
    wrap.appendChild(h('section', { class: 'cc-card', 'aria-labelledby': 'cfg-mode-h' }, [
      h('h2', { id: 'cfg-mode-h' }, [icon('shield'), 'Modo de operación']),
      h('div', { class: 'cc-modes', role: 'radiogroup', 'aria-labelledby': 'cfg-mode-h' }, CC.MODES.map(function (m) {
        return h('button', { type: 'button', class: 'cc-mode', role: 'radio', key: 'mode-' + m, 'data-mode': m, 'aria-checked': dv.mode === m ? 'true' : 'false', 'data-pending': dv.mode === m && m !== c.mode ? '1' : null, disabled: locked, onclick: function () { setMode(m); } }, [h('strong', { text: m }), h('span', { text: modeInfo[m] })]);
      })),
      h('p', { class: 'cc-note', style: 'margin-top:14px' }, [icon('info', 'cc-ico--sm'), 'PUBLIC abre los comandos a toda la comunidad y exige una confirmación explícita al guardar.'])
    ]));

    // Comportamiento + cooldowns
    var two = h('div', { class: 'cc-grid cc-g2' });
    two.appendChild(h('section', { class: 'cc-card' }, [
      h('h2', null, [icon('broadcast'), 'Canal offline']),
      h('div', { class: 'cc-swrow' }, [
        h('div', null, [h('div', { class: 'cc-flab', id: 'ao-l', style: 'font:700 15px var(--cc-font-d);letter-spacing:.14em;text-transform:uppercase', text: 'Permitir comandos offline' }), h('p', { text: 'Si está desactivado, los comandos solo responden con el canal en directo.' })]),
        h('button', { type: 'button', class: 'cc-switch', role: 'switch', key: 'sw-allowOffline', 'aria-checked': dv.allowOffline ? 'true' : 'false', 'aria-labelledby': 'ao-l', 'data-pending': dv.allowOffline !== c.allowOffline ? '1' : null, disabled: locked, onclick: function () { editDraft(function (d) { d.allowOffline = !d.allowOffline; }); } })
      ])
    ]));
    function cdField(k, label) {
      var b = c.cooldownBounds[k], err = errs[k];
      var txt = S.ui.cdText[k] != null ? S.ui.cdText[k] : String(dv.cooldowns[k]);
      return h('div', { class: 'cc-field' }, [
        h('label', { for: 'cd-' + k, text: label }),
        h('div', { class: 'cc-numrow' }, [h('input', { class: 'cc-input', id: 'cd-' + k, key: 'cd-' + k, type: 'text', inputmode: 'numeric', autocomplete: 'off', value: null, disabled: locked, 'aria-invalid': err ? 'true' : null, 'aria-describedby': 'cd-' + k + '-h', oninput: function (ev) { onCooldownInput(k, ev.target.value); } }), h('span', { text: 'segundos' })]),
        h('div', { class: 'cc-hint', id: 'cd-' + k + '-h' }, 'Permitido: ' + b.min + ' – ' + b.max + ' s (límites de la API). Guardado: ' + c.cooldowns[k] + ' s.'),
        err ? h('div', { class: 'cc-err', role: 'alert', text: err }) : null
      ]);
    }
    var cd = h('section', { class: 'cc-card' }, [h('h2', null, [icon('clock'), 'Cooldowns']), h('div', { class: 'cc-stack' }, [cdField('userSeconds', 'Por usuario'), cdField('commandSeconds', 'Por comando')])]);
    cd.querySelectorAll('input').forEach(function (inp) { var k = inp.id.replace('cd-', ''); inp.value = S.ui.cdText[k] != null ? S.ui.cdText[k] : String(dv.cooldowns[k]); });
    two.appendChild(cd);
    wrap.appendChild(two);

    // Comandos (resumen)
    var onN = Object.keys(dv.commands).filter(function (k) { return dv.commands[k]; }).length, totN = Object.keys(dv.commands).length;
    var chg = Object.keys(dv.commands).filter(function (k) { return dv.commands[k] !== c.commands[k]; }).length;
    wrap.appendChild(h('section', { class: 'cc-card' }, [
      h('h2', null, [icon('commands'), 'Comandos']),
      h('div', { class: 'cc-swrow' }, [h('p', { style: 'margin:0;color:var(--cc-mute)' }, [onN + ' de ' + totN + ' habilitados' + (chg ? ' · ' + chg + (chg === 1 ? ' cambio pendiente' : ' cambios pendientes') : '') + '.']), h('a', { class: 'cc-btn', href: '#/commands' }, 'Administrar comandos')])
    ]));

    // Solo lectura
    wrap.appendChild(h('section', { class: 'cc-card' }, [
      h('h2', null, [icon('lock'), 'Solo lectura']),
      h('ul', { class: 'cc-ro' }, [
        h('li', null, [h('span', { text: 'Propietario (ownerUserId)' }), h('span', { class: 'cc-mono', text: c.ownerUserId || '—' })]),
        h('li', null, [h('span', { text: 'Usuarios autorizados (allowedUserIds)' }), h('span', { class: 'cc-mono', text: c.allowedUserIds.length ? c.allowedUserIds.join(', ') : '—' })]),
        h('li', null, [h('span', { text: 'Límite cooldown por usuario' }), h('span', { class: 'cc-mono', text: c.cooldownBounds.userSeconds.min + ' – ' + c.cooldownBounds.userSeconds.max + ' s' })]),
        h('li', null, [h('span', { text: 'Límite cooldown por comando' }), h('span', { class: 'cc-mono', text: c.cooldownBounds.commandSeconds.min + ' – ' + c.cooldownBounds.commandSeconds.max + ' s' })]),
        h('li', null, [h('span', { text: 'Versión confirmada (ETag)' }), h('span', { class: 'cc-mono', text: S.etag || 'no disponible' })])
      ])
    ]));
    return wrap;
  }

  function editDraft(mut) {
    var c = confirmed(); if (!c) return;
    if (!S.draft) S.draft = CC.editableOf(c);
    mut(S.draft);
    afterDraftChange();
  }
  function setMode(m) { editDraft(function (d) { d.mode = m; }); }
  function onCooldownInput(k, text) {
    var c = confirmed(); if (!c) return;
    S.ui.cdText[k] = text;
    var t = text.trim(), n = /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN;
    if (!S.draft) S.draft = CC.editableOf(c);
    S.draft.cooldowns[k] = n;
    afterDraftChange();
  }

  /* ======================================================== vista: estadísticas */
  function viewStats() {
    var wrap = h('div', { class: 'cc-stack' });
    var sl = S.data.stats, d = sl.data;
    wrap.appendChild(pageHead('04 / Telemetría', 'Estadísticas', 'Contadores del proceso del bot. Se reinician cada vez que el proceso se reinicia: no existen históricos diarios, semanales ni mensuales.', [btn('Actualizar', { icon: 'refresh', key: 'st-refresh', onclick: function () { loaders.stats(); }, disabled: sl.loading })]));
    slotAlerts(['stats'], function () { loaders.stats(); }).forEach(function (a) { wrap.appendChild(a); });
    if (!d) {
      if (!sl.error) { var g = h('div', { class: 'cc-grid cc-g4' }); for (var i = 0; i < 4; i++) g.appendChild(h('article', { class: 'cc-card' }, [skel('60%', '12px'), h('div', { style: 'height:14px' }), skel('50%', '34px')])); append(wrap, [g, h('div', { class: 'cc-card' }, [skel('100%', '180px')])]); }
      return wrap;
    }
    var stale = !!sl.error;
    var body = h('div', { class: 'cc-stack' + (stale ? ' cc-stale' : '') });
    body.appendChild(h('div', { class: 'cc-grid cc-g4 cc-keep2' }, [
      metric('Ejecuciones', 'bolt', nfmt(d.totals.executed), 'Comandos procesados'),
      metric('Errores', 'alert', nfmt(d.totals.errors), 'Fallos al ejecutar', { tone: d.totals.errors ? 'bad' : '' }),
      metric('Envíos aceptados por IRC', 'chat', nfmt(d.totals.sent), 'Respuestas aceptadas por el chat', { tone: 'ok' }),
      metric('Descartes', 'x', nfmt(d.totals.discarded), 'Respuestas no enviadas')
    ]));
    body.appendChild(h('p', { class: 'cc-note' }, [icon('info', 'cc-ico--sm'), 'Errores y envíos no son necesariamente categorías excluyentes entre sí. ' + (d.startedAt ? 'Contadores desde ' + CC.formatDateTime(d.startedAt).date + ' ' + CC.formatDateTime(d.startedAt).time + ' (' + CC.relativeTime(d.startedAt) + ').' : '')]));

    var rows = CC.commandRows(d);
    if (!rows.length) {
      body.appendChild(h('div', { class: 'cc-card cc-empty' }, [icon('stats'), h('h3', { text: 'Aún sin actividad' }), h('p', { text: 'Todavía no se ha ejecutado ningún comando desde que se inició el proceso del bot.' })]));
    } else {
      var max = Math.max.apply(null, rows.map(function (r) { return r.executed; })) || 1;
      var top = rows.slice(0, 3).map(function (r) { return '!' + r.name + ' (' + r.executed + ')'; }).join(', ');
      body.appendChild(h('div', { class: 'cc-grid cc-g2' }, [
        h('section', { class: 'cc-card', 'aria-labelledby': 'st-chart-h' }, [
          h('h2', { id: 'st-chart-h' }, [icon('stats'), 'Uso por comando (ejecuciones)']),
          h('ol', { class: 'cc-bars', role: 'img', 'aria-label': 'Gráfico de barras de ejecuciones por comando. Más usados: ' + top + '.' }, rows.map(function (r, i) {
            return h('li', { class: 'cc-bar' }, [h('span', { text: '!' + r.name }), h('div', { class: 'cc-bar-track' }, h('div', { class: 'cc-bar-fill', style: 'width:' + Math.max(2, Math.round(r.executed / max * 100)) + '%;animation-delay:' + (i * 50) + 'ms' })), h('b', { text: nfmt(r.executed) })]);
          })),
          h('p', { class: 'cc-sub', style: 'margin:14px 0 0;font-size:12.5px;color:var(--cc-mute)', text: 'Ordenado de mayor a menor. El detalle exacto está en la tabla.' })
        ]),
        h('section', { class: 'cc-card' }, [
          h('h2', null, [icon('bolt'), 'Más utilizados']),
          h('ol', { class: 'cc-ro', style: 'list-style:none' }, rows.slice(0, 5).map(function (r, i) {
            return h('li', null, [h('span', null, [h('b', { class: 'cc-mono', style: 'color:var(--cc-gold);margin-right:10px', text: String(i + 1).padStart(2, '0') }), '!' + r.name]), h('span', { class: 'cc-mono', text: nfmt(r.executed) + ' ejec.' })]);
          }))
        ])
      ]));
      var tbl = h('table', { class: 'cc-table' }, [
        h('caption', { class: 'cc-sr', text: 'Estadísticas por comando desde el último arranque del bot' }),
        h('thead', null, h('tr', null, ['Comando', 'Ejecuciones', 'Errores', 'Enviados', 'Descartes'].map(function (t) { return h('th', { scope: 'col', text: t }); }))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, [h('td', { text: '!' + r.name })].concat(['executed', 'errors', 'sent', 'discarded'].map(function (k) { return h('td', { class: r[k] === 0 ? 'zero' : '', text: nfmt(r[k]) }); })));
        })),
        h('tfoot', null, h('tr', null, [h('td', { text: 'Total (API)' })].concat(['executed', 'errors', 'sent', 'discarded'].map(function (k) { return h('td', { text: nfmt(d.totals[k]) }); }))))
      ]);
      body.appendChild(h('section', { class: 'cc-card' }, [h('h2', null, [icon('list'), 'Estadísticas por comando']), h('div', { class: 'cc-tablewrap', tabindex: '0', role: 'region', 'aria-label': 'Tabla de estadísticas por comando (desplazable)' }, tbl)]));
    }
    wrap.appendChild(body);
    return wrap;
  }

  /* ======================================================== vista: historial */
  function viewAudit() {
    var wrap = h('div', { class: 'cc-stack' });
    var sl = S.data.audit;
    wrap.appendChild(pageHead('05 / Registro', 'Historial administrativo', 'Cambios de configuración del más reciente al más antiguo. Se muestran los valores NUEVOS: el servidor no registra los anteriores.'));

    var inp = h('input', { class: 'cc-input', id: 'audit-limit', key: 'audit-limit', type: 'text', inputmode: 'numeric', style: 'max-width:110px', autocomplete: 'off', 'aria-describedby': 'audit-hint', oninput: function (ev) { S.ui.auditLimitText = ev.target.value; } });
    inp.value = S.ui.auditLimitText;
    var ok = /^\d+$/.test(S.ui.auditLimitText.trim()) && +S.ui.auditLimitText >= CC.AUDIT_MIN && +S.ui.auditLimitText <= CC.AUDIT_MAX;
    function consult() {
      var t = S.ui.auditLimitText.trim();
      if (!/^\d+$/.test(t) || +t < CC.AUDIT_MIN || +t > CC.AUDIT_MAX) { renderMain(); return; }
      S.ui.auditLimit = +t; loaders.audit();
    }
    inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); consult(); } });
    wrap.appendChild(h('div', { class: 'cc-card' }, [
      h('div', { class: 'cc-toolbar', style: 'margin:0;align-items:flex-end' }, [
        h('div', { class: 'cc-field' }, [h('label', { for: 'audit-limit', text: 'Entradas a consultar' }), inp]),
        btn(sl.loading ? 'Consultando…' : 'Consultar', { cls: 'cc-btn--gold', key: 'audit-go', onclick: consult, disabled: sl.loading, icon: 'refresh' })
      ]),
      h('div', { class: 'cc-hint', id: 'audit-hint', style: 'margin-top:10px;font-size:12.5px;color:' + (!ok && S.ui.auditLimitText !== '' ? 'var(--cc-bad)' : 'var(--cc-dim)'), text: 'Entre ' + CC.AUDIT_MIN + ' y ' + CC.AUDIT_MAX + ' entradas por solicitud. El servidor conserva las últimas 200 modificaciones.' })
    ]));
    slotAlerts(['audit'], function () { loaders.audit(); }).forEach(function (a) { wrap.appendChild(a); });

    var list = sl.data;
    if (!list) {
      if (sl.loading || !sl.error) {
        var s = h('div', { class: 'cc-stack' });
        for (var i = 0; i < 4; i++) s.appendChild(h('div', { class: 'cc-card' }, [skel('40%', '14px'), h('div', { style: 'height:12px' }), skel('80%', '16px')]));
        wrap.appendChild(s);
      }
      return wrap;
    }
    if (!list.length) {
      wrap.appendChild(h('div', { class: 'cc-card cc-empty' }, [icon('audit'), h('h3', { text: 'Sin cambios registrados' }), h('p', { text: 'Todavía no hay modificaciones de configuración en el historial del servidor.' })]));
      return wrap;
    }
    var owner = confirmed() ? confirmed().ownerUserId : null;
    wrap.appendChild(h('ol', { class: 'cc-timeline' + (sl.error ? ' cc-stale' : ''), 'aria-label': list.length + ' cambios de configuración' }, list.map(function (e) {
      var dt = CC.formatDateTime(e.at), lines = CC.describeAudit(e.changed);
      return h('li', { class: 'cc-tl' }, [
        h('div', { class: 'cc-tl-head' }, [h('span', null, [h('b', { text: dt.date }), ' · ' + dt.time + ' · ' + CC.relativeTime(e.at)]), h('span', { class: 'cc-who-tag', text: e.actorTwitchId && e.actorTwitchId === owner ? 'Propietario' : e.actorTwitchId ? 'Twitch ID ' + e.actorTwitchId : 'Actor desconocido' })]),
        lines.length ? h('ul', null, lines.map(function (t) { return h('li', { text: t }); })) : h('p', { style: 'margin:0;color:var(--cc-dim)', text: 'Entrada sin campos modificados.' })
      ]);
    })));
    return wrap;
  }

  /* ================================================================= guardar */
  function openSaveModal() {
    var c = confirmed(); if (!c || !S.draft || S.saving) return;
    var patch = CC.diffConfig(c, S.draft), flat = CC.flatten(patch), errs = CC.validateDraft(c, S.draft);
    var invalid = Object.keys(errs).length > 0, isPublic = patch.mode === 'PUBLIC';
    var state = { checked: false, typed: '' };
    var errBox = h('div', { 'data-save-err': '1' });
    var saveBtn, confirmBox = null;

    function canSave() { return !invalid && !!S.etag && flat.length > 0 && (!isPublic || (state.checked && state.typed.trim() === 'PUBLIC')); }
    function sync() { saveBtn.disabled = !canSave() || S.saving; }

    var list = h('ul', { class: 'cc-chglist' }, flat.map(function (f) {
      var before = CC.getPath(c, f.path);
      return h('li', null, [h('span', { text: CC.describeChange(f.path, f.value) }), h('small', null, ['Antes: ', String(before), ' → Ahora: ', h('em', { text: String(f.value) })])]);
    }));
    if (isPublic) {
      var chk = h('input', { type: 'checkbox', key: 'pub-check', id: 'pub-check', onchange: function (ev) { state.checked = ev.target.checked; sync(); } });
      var typed = h('input', { class: 'cc-input', type: 'text', id: 'pub-type', key: 'pub-type', autocomplete: 'off', 'aria-describedby': 'pub-type-h', oninput: function (ev) { state.typed = ev.target.value; sync(); } });
      confirmBox = h('div', { class: 'cc-confirm', role: 'group', 'aria-label': 'Confirmación explícita del modo PUBLIC' }, [
        h('strong', { text: 'Vas a activar el modo PUBLIC' }),
        h('span', { text: 'Todos los comandos habilitados responderán a cualquier persona de la comunidad.' }),
        h('label', { for: 'pub-check' }, [chk, h('span', { text: 'Entiendo que PUBLIC abre los comandos a toda la comunidad.' })]),
        h('label', { for: 'pub-type', style: 'display:grid;gap:6px' }, [h('span', { id: 'pub-type-h', text: 'Escribe PUBLIC para confirmar' }), typed])
      ]);
    }
    if (invalid) errBox.appendChild(h('div', { class: 'cc-alert', role: 'alert', 'data-tone': 'bad' }, [icon('alert'), h('div', null, [h('h3', { text: 'Valores no válidos' }), h('p', { text: Object.keys(errs).map(function (k) { return errs[k]; }).join(' ') })])]));
    if (!S.etag) errBox.appendChild(h('div', { class: 'cc-alert', role: 'alert', 'data-tone': 'warn' }, [icon('alert'), h('div', null, [h('h3', { text: 'Sin ETag' }), h('p', { text: 'No hay versión confirmada de la configuración; no se puede guardar de forma segura.' })])]));

    saveBtn = btn('Guardar cambios', { cls: 'cc-btn--gold', key: 'save-go', icon: 'check', onclick: function () { doSave(patch, modal, saveBtn, errBox); } });
    var cancel = btn('Cancelar', { key: 'save-cancel', onclick: function () { modal.close(); } });
    var content = h('div', null, [
      h('h2', { id: 'cc-modal-h', text: 'Revisar y guardar' }),
      h('p', { text: flat.length + (flat.length === 1 ? ' campo modificado' : ' campos modificados') + '. Solo se envían los campos cambiados, con la versión (ETag) que estás editando.' }),
      list, confirmBox, errBox, h('div', { class: 'cc-modal-act' }, [cancel, saveBtn])
    ]);
    var modal = openModal(content, { labelledBy: 'cc-modal-h', focus: confirmBox ? '#pub-check' : '[data-key="save-go"]' });
    sync();
  }

  async function doSave(patch, modal, saveBtn, errBox) {
    if (S.saving) return;
    var c = confirmed(), oldConfirmed = c, oldEtag = S.etag, my = scope, api = S.api;
    S.saving = true; modal.lock(true);
    clear(errBox);
    saveBtn.disabled = true; clear(saveBtn); append(saveBtn, [h('span', { class: 'cc-spin' }), 'Guardando…']);
    renderChrome();
    try {
      var res = await guarded(function () { return api.patchConfig(patch, oldEtag, my.signal); }, my);
      if (my !== scope) return;
      // Éxito solo con HTTP 200 real.
      if (res.status !== 200) throw CC.ApiError('invalid', res.status, null, 'La API respondió ' + res.status + ' en lugar de 200.');
      if (res.config && res.etag) { S.data.config.data = res.config; S.etag = res.etag; S.data.config.loadedAt = Date.now(); S.data.config.error = null; }
      else { await reloadConfigSilently(my, api); if (my !== scope) return; }   // la respuesta no trajo config/ETag: se pide la real
      S.draft = null; S.ui.cdText = {};
      S.saving = false; modal.lock(false); modal.close();
      toast('Configuración guardada y confirmada por el servidor.', 'ok');
      loaders.commands(); loaders.status();
      if (S.data.audit.data) { S.ui.auditStale = true; if (S.route === 'audit') loaders.audit(); }
      renderChrome(); renderMain();
      var hd = document.getElementById('cc-h1'); if (hd) hd.focus({ preventScroll: true });
    } catch (e) {
      if (my !== scope) return;
      S.saving = false; modal.lock(false);
      if (e && e.kind === 'aborted') return;
      if (e && e.kind === 'http' && (e.status === 401 || e.status === 403)) { S.data.config.error = e; checkGate(); return; }
      if (e && e.kind === 'http' && e.status === 412) { modal.close(); await handleStale(oldConfirmed); return; }
      var d = CC.describeError(e);
      var net = e && e.kind === 'network';
      clear(saveBtn); append(saveBtn, [icon('check', 'cc-ico--sm'), 'Reintentar guardado']); saveBtn.disabled = false;
      append(errBox, h('div', { class: 'cc-alert', role: 'alert', 'data-tone': d.severity === 'warn' ? 'warn' : 'bad' }, [icon('alert'), h('div', null, [h('h3', { text: 'No se guardó: ' + d.title }), h('p', null, [d.detail + (net ? ' No se sabe si la API llegó a recibir el cambio: recarga la configuración antes de repetirlo. ' : ' La configuración confirmada se mantiene intacta y tus cambios siguen pendientes. '), d.code ? h('code', { text: d.code }) : null])])]));
      renderChrome();
    }
  }

  async function reloadConfigSilently(my, api) {
    var r = await guarded(function () { return api.config(my.signal); }, my);
    if (my !== scope) throw CC.ApiError('aborted');
    S.data.config.data = r.config; S.etag = r.etag; S.data.config.loadedAt = Date.now(); S.data.config.error = null;
  }

  // Recarga la configuración conservando los cambios pendientes; nunca guarda nada por sí sola.
  async function reloadConfig() {
    var old = confirmed(), my = scope, api = S.api;
    S.data.config.loading = true; renderMain();
    try {
      var r = await guarded(function () { return api.config(my.signal); }, my);
      if (my !== scope) return;
      S.data.config.loading = false;
      if (S.draft && old) return applyRebase(old, r.config, r.etag, false);
      S.data.config.data = r.config; S.etag = r.etag; S.data.config.error = null; S.data.config.loadedAt = Date.now();
      loaders.commands();
      renderChrome(); renderMain();
    } catch (e) {
      if (my !== scope || (e && e.kind === 'aborted')) return;
      S.data.config.loading = false; S.data.config.error = e; checkGate(); renderMain();
    }
  }

  async function handleStale(oldConfirmed) {
    var my = scope, api = S.api;
    try {
      var r = await guarded(function () { return api.config(my.signal); }, my);
      if (my !== scope) return;
      applyRebase(oldConfirmed, r.config, r.etag, true);
    } catch (e) {
      if (my !== scope || (e && e.kind === 'aborted')) return;
      toast('La configuración cambió en el servidor y no se pudo recuperar la versión actual (' + CC.describeError(e).title + '). Tus cambios siguen pendientes; usa «Recargar».', 'bad');
      renderChrome(); renderMain();
    }
  }

  function applyRebase(oldConfirmed, freshCfg, freshEtag, fromConflict) {
    var rb = CC.rebaseDraft(oldConfirmed, freshCfg, S.draft);
    S.data.config.data = freshCfg; S.etag = freshEtag; S.data.config.error = null; S.data.config.loadedAt = Date.now();
    S.draft = rb.kept.length ? rb.draft : null; if (!S.draft) S.ui.cdText = {};
    loaders.commands();
    renderChrome(); renderMain();
    if (fromConflict || rb.conflicts.length || rb.serverChanges.length || rb.dropped.length) openConflictModal(rb, fromConflict);
    else toast('Configuración recargada.', 'ok');
  }

  function openConflictModal(rb, fromConflict) {
    var cfg = confirmed();
    function line(path, val) { return CC.describeChange(path, val); }
    var items = [];
    rb.conflicts.forEach(function (c) { items.push(h('li', { 'data-conflict': '1' }, [h('span', { text: 'Conflicto: ' + line(c.path, c.mine) }), h('small', null, ['Antes editabas desde: ', String(c.before), ' · El servidor ahora tiene: ', h('em', { text: String(c.theirs) }), ' · Tu valor: ', h('em', { text: String(c.mine) })])])); });
    rb.serverChanges.forEach(function (c) { items.push(h('li', null, [h('span', { text: 'Otra sesión cambió: ' + line(c.path, c.now) }), h('small', { text: 'Antes: ' + String(c.before) })])); });
    rb.dropped.forEach(function (c) { items.push(h('li', null, [h('span', { text: 'Ya aplicado en el servidor: ' + line(c.path, c.value) }), h('small', { text: 'Ese cambio pendiente se retiró porque ya coincide.' })])); });
    var kept = rb.kept.length;
    var actions = [];
    if (kept) {
      actions.push(btn('Descartar mis cambios', { key: 'cf-discard', onclick: function () { S.draft = null; S.ui.cdText = {}; m.close(); renderChrome(); renderMain(); toast('Cambios pendientes descartados.', 'ok'); } }));
      actions.push(btn('Revisar mis cambios', { key: 'cf-review', cls: 'cc-btn--gold', onclick: function () { m.close(); location.hash = '#/config'; } }));
    } else actions.push(btn('Entendido', { key: 'cf-ok', cls: 'cc-btn--gold', onclick: function () { m.close(); } }));
    var content = h('div', null, [
      h('h2', { id: 'cc-modal-h', text: fromConflict ? 'La configuración cambió' : 'Configuración actualizada' }),
      h('p', { text: (fromConflict ? 'Otra sesión modificó la configuración mientras editabas (HTTP 412, versión desactualizada). No se guardó nada. ' : 'El servidor tiene cambios respecto a lo que veías. ') + (kept ? 'Tus ' + kept + (kept === 1 ? ' cambio sigue pendiente' : ' cambios siguen pendientes') + ' sobre la versión actual; revísalos y guarda de nuevo si siguen siendo correctos. Nada se sobrescribe automáticamente.' : 'No quedan cambios tuyos por guardar.') }),
      items.length ? h('ul', { class: 'cc-chglist' }, items) : null,
      h('div', { class: 'cc-modal-act' }, actions)
    ]);
    var m = openModal(content, { labelledBy: 'cc-modal-h', focus: kept ? '[data-key="cf-review"]' : '[data-key="cf-ok"]' });
    void cfg;
  }

  /* ================================================================ modal / aviso */
  var modalState = null;
  function openModal(content, o) {
    closeModal(true);
    var opener = document.activeElement;
    var card = h('div', { class: 'cc-card cc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': o.labelledBy }, content);
    var ovl = h('div', { class: 'cc-ovl' }, card);
    var st = { locked: false, ovl: ovl, card: card, opener: opener };
    function onKey(ev) {
      if (ev.key === 'Escape' && !st.locked) { ev.preventDefault(); api.close(); return; }
      if (ev.key !== 'Tab') return;
      var f = Array.prototype.filter.call(card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) { ev.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      else if (!card.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    ovl.addEventListener('mousedown', function (ev) { if (ev.target === ovl && !st.locked) api.close(); });
    document.getElementById('cc-modal-root').appendChild(ovl);
    var api = {
      close: function () { document.removeEventListener('keydown', onKey, true); if (ovl.parentNode) ovl.parentNode.removeChild(ovl); if (modalState === st) modalState = null; if (st.opener && document.contains(st.opener)) { try { st.opener.focus({ preventScroll: true }); } catch (e) { /* ok */ } } },
      lock: function (v) { st.locked = !!v; },
      el: card
    };
    st.api = api; st.onKey = onKey; modalState = st;
    var target = o.focus ? card.querySelector(o.focus) : null;
    (target || card.querySelector('button, input') || card).focus({ preventScroll: true });
    return api;
  }
  function closeModal(silent) {
    if (!modalState) return;
    var st = modalState; modalState = null;
    document.removeEventListener('keydown', st.onKey, true);
    if (st.ovl.parentNode) st.ovl.parentNode.removeChild(st.ovl);
    if (!silent && st.opener) { try { st.opener.focus(); } catch (e) { /* ok */ } }
  }

  function toast(msg, tone) {
    var box = document.getElementById('cc-toasts');
    var t = h('div', { class: 'cc-toast', 'data-tone': tone || 'ok' }, [icon(tone === 'bad' ? 'alert' : 'check'), h('span', { text: msg })]);
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, tone === 'bad' ? 9000 : 5000);
  }

  /* ================================================================ rutas / arranque */
  function routeFromHash() {
    var id = (location.hash || '').replace(/^#\/?/, '');
    return NAV.some(function (n) { return n.id === id; }) ? id : 'overview';
  }
  function onRoute() {
    var next = routeFromHash();
    if (next === S.route && shell) return;
    S.route = next;
    if (S.phase !== 'ready') return;
    if (next === 'audit' && (!S.data.audit.data || S.ui.auditStale) && !S.data.audit.loading) loaders.audit();
    renderChrome(); renderMain();
    var h1 = document.getElementById('cc-h1'); if (h1) h1.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', onRoute);
  window.addEventListener('beforeunload', function (ev) { if (pendingCount() > 0) { ev.preventDefault(); ev.returnValue = ''; } });

  S.route = routeFromHash();
  if (DEMO) {
    S.user = { id: 'demo', label: 'Demo (simulado)' };
    enter();
  } else {
    startReal().catch(function () { S.gateInfo = { code: null, text: 'No se pudo comprobar la sesión.' }; setPhase('fatal'); });
  }
  // Ganchos de depuración/pruebas (solo lectura del estado; sin tokens).
  window.__ccDebug = { state: function () { return { phase: S.phase, route: S.route, pending: pendingCount(), etag: S.etag }; } };
})();
