/* Mi Geo Army — subpestañas (Fase 1A)
 *
 * Solo navegación y presentación. No consulta Supabase, no llama a ninguna RPC, no toca
 * XP, G-Coins, wallets, rangos, país ni cuentas vinculadas: los bloques originales siguen
 * en el DOM con sus mismos ids y los llena el script en línea de mi-geoarmy.html.
 *
 * Espejos (mgtSumGcoins, mgtSumFlag, mgtAcctAvatar, mgtAcctName): copias de presentación
 * de datos que loadDashboard() ya cargó. Se actualizan SOLO con MgTabs.sync() (explícito),
 * sin MutationObserver ni polling. sync() se protege con una "generación" de carga:
 * cada loadDashboard() pide un número con beginLoad() y únicamente la carga más reciente
 * puede sincronizar, así una ejecución antigua (aunque sea de la misma cuenta) no pisa nada.
 *
 * Si este archivo no carga, la página queda como antes (columna larga) porque todo el
 * comportamiento de pestañas depende de la clase html.mgt-ready que se pone aquí.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  var TAB_IDS = ['billetera', 'resumen', 'progreso', 'racha', 'cuenta'];
  var DEFAULT_TAB = 'billetera';

  // Hashes heredados / ancla -> pestaña, y elemento al que hacer scroll.
  var HASH_MAP = {
    billetera: { tab: 'billetera' },
    resumen:   { tab: 'resumen' },
    progreso:  { tab: 'progreso' },
    racha:     { tab: 'racha' },
    cuenta:    { tab: 'cuenta' },
    gcoins:             { tab: 'billetera', target: 'gcoins' },
    missolicitudes:     { tab: 'billetera', target: 'misSolicitudes' },
    cuentasvinculadas:  { tab: 'cuenta',    target: 'cuentasVinculadas' },
    mgstreak:           { tab: 'racha',     target: 'mgStreak' }
  };

  var nav = doc.getElementById('mgtNav');
  if (!nav) return; // marcado incompleto: no activar nada, la página queda en columna larga

  var tabs = {};
  var panels = {};
  var i;
  for (i = 0; i < TAB_IDS.length; i++) {
    tabs[TAB_IDS[i]] = doc.getElementById('mgtTab-' + TAB_IDS[i]);
    panels[TAB_IDS[i]] = doc.getElementById('mgtPanel-' + TAB_IDS[i]);
    if (!tabs[TAB_IDS[i]] || !panels[TAB_IDS[i]]) return;
  }

  // ?x_connect=... : se lee ahora, antes de que initXAccountUI() limpie la URL.
  var cameFromXConnect = false;
  try { cameFromXConnect = new URLSearchParams(window.location.search).has('x_connect'); } catch (e) {}

  var current = null;
  var pendingScroll = null; // id de un elemento al que ir cuando el dashboard ya sea visible

  // ---------- Pestañas ----------
  function isEnabled(name) { return !!tabs[name] && !tabs[name].hidden; }

  function visibleTabs() {
    var out = [];
    for (var k = 0; k < TAB_IDS.length; k++) if (isEnabled(TAB_IDS[k])) out.push(TAB_IDS[k]);
    return out;
  }

  function show(name, opts) {
    opts = opts || {};
    if (!isEnabled(name)) name = DEFAULT_TAB;
    for (var k = 0; k < TAB_IDS.length; k++) {
      var id = TAB_IDS[k];
      var on = id === name;
      tabs[id].classList.toggle('is-active', on);
      tabs[id].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[id].tabIndex = on ? 0 : -1;
      if (id === 'racha' && !isEnabled('racha')) continue; // el panel de Racha sigue oculto (Fase 2)
      panels[id].classList.toggle('is-active', on);
    }
    current = name;
    // Al mostrar una pestaña se refrescan los espejos, pero solo si los datos de la carga
    // más reciente ya fueron confirmados por sync(). Nunca consulta nada.
    if (confirmedGen === gen && gen > 0) copyMirrors();
    // En pantallas angostas la barra puede desplazarse: deja visible la pestaña activa
    // (solo ajusta el scroll horizontal de la barra, no el de la página).
    if (nav.scrollWidth > nav.clientWidth) {
      var t = tabs[name];
      nav.scrollLeft = Math.max(0, t.offsetLeft - (nav.clientWidth - t.offsetWidth) / 2);
    }
    if (opts.focus) tabs[name].focus();
  }

  function writeHash(name) {
    try {
      var url = window.location.pathname + window.location.search + '#' + name;
      window.history.replaceState(window.history.state, '', url);
    } catch (e) {}
  }

  function scrollToTarget(id) {
    var el = doc.getElementById(id);
    if (!el || !el.offsetParent) return false; // todavía oculto (dashboard sin cargar)
    try { el.scrollIntoView({ block: 'start' }); } catch (e) { el.scrollIntoView(); }
    return true;
  }

  // Lee el hash actual y muestra la pestaña correspondiente. NO modifica el hash:
  // #mgStreak durante la Fase 1A muestra Billetera pero la URL conserva #mgStreak.
  // Reglas (sin estado previo, salvo el retorno de X de esta carga):
  //   1. ?x_connect= presente al cargar -> Cuenta (aunque la URL traiga otro hash). Una sola vez.
  //   2. hash conocido -> su pestaña (y scroll a su ancla si la tiene).
  //   3. sin hash, o hash desconocido -> Billetera (pestaña predeterminada).
  function route() {
    if (cameFromXConnect) {
      cameFromXConnect = false;
      pendingScroll = null;
      show('cuenta');
      return;
    }
    var raw = '';
    try { raw = decodeURIComponent((window.location.hash || '').replace(/^#/, '')); } catch (e) { raw = (window.location.hash || '').replace(/^#/, ''); }
    var entry = raw ? HASH_MAP[raw.toLowerCase()] : null;
    if (!entry) { pendingScroll = null; show(DEFAULT_TAB); return; }
    show(entry.tab);
    pendingScroll = entry.target && entry.tab === current ? entry.target : null;
    if (pendingScroll && scrollToTarget(pendingScroll)) pendingScroll = null;
  }

  function onTabClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-mgt-tab]') : null;
    if (!btn || !nav.contains(btn)) return;
    var name = btn.getAttribute('data-mgt-tab');
    if (!isEnabled(name)) return;
    pendingScroll = null;
    show(name);
    writeHash(name);
  }

  function onTabKey(e) {
    var key = e.key;
    var vertical = nav.getAttribute('aria-orientation') === 'vertical';
    var prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    var next = vertical ? 'ArrowDown' : 'ArrowRight';
    if (key !== prev && key !== next && key !== 'Home' && key !== 'End') return;
    var list = visibleTabs();
    var idx = list.indexOf(current);
    if (idx < 0) idx = 0;
    var to;
    if (key === 'Home') to = 0;
    else if (key === 'End') to = list.length - 1;
    else if (key === next) to = (idx + 1) % list.length;
    else to = (idx - 1 + list.length) % list.length;
    e.preventDefault();
    pendingScroll = null;
    show(list[to], { focus: true });
    writeHash(list[to]);
  }

  // Orientación accesible: riel vertical desde 1100px, pestañas horizontales debajo.
  function applyOrientation(mq) {
    nav.setAttribute('aria-orientation', mq.matches ? 'vertical' : 'horizontal');
  }

  // ---------- Espejos de presentación + protección por generación ----------
  var gen = 0;            // generación de la carga más reciente (beginLoad)
  var confirmedGen = 0;   // generación cuyos datos ya fueron confirmados por sync()
  var confirmedUid = null;

  function byId(id) { return doc.getElementById(id); }

  function resetMirrors() {
    var g = byId('mgtSumGcoins');
    if (g) g.innerHTML = '—<span>G</span>';
    var f = byId('mgtSumFlag');
    if (f) { f.hidden = true; f.removeAttribute('src'); f.alt = ''; }
    var a = byId('mgtAcctAvatar');
    if (a) { a.removeAttribute('src'); a.style.display = 'none'; }
    var n = byId('mgtAcctName');
    if (n) n.textContent = '—';
    resetIdentityMirrors();
  }

  // ---------- Espejos de la tarjeta de identidad (Resumen, Fase 1B) ----------
  // Copias de solo presentación de nodos que ya llenan las funciones originales (Progreso y Cuenta).
  // Se llenan únicamente desde copyMirrors() (sync / mostrar pestaña) y se limpian con resetMirrors().
  function setTxt(id, txt) { var e = byId(id); if (e) e.textContent = txt; }
  function setHidden(id, h) { var e = byId(id); if (e) e.hidden = !!h; }
  function setImg(id, src, alt) {
    var e = byId(id);
    if (!e) return;
    if (src) { e.src = src; e.alt = alt || ''; e.hidden = false; }
    else { e.hidden = true; e.removeAttribute('src'); e.alt = ''; }
  }
  function setBar(pct) {
    var f = byId('mgtProgFill'), t = byId('mgtProgTrack');
    var v = Math.max(0, Math.min(100, parseFloat(pct) || 0));
    if (f) f.style.width = v + '%';
    if (t) t.setAttribute('aria-valuenow', String(Math.round(v)));
  }

  function resetIdentityMirrors() {
    setImg('mgtBadge', null);
    setHidden('mgtRankChip', true);
    setHidden('mgtCountryWrap', true); setTxt('mgtSumCountry', '');
    setHidden('mgtProgBlock', true); setHidden('mgtMaxBlock', true); setHidden('mgtNextWrap', true);
    setTxt('mgtProgText', '— / — XP'); setTxt('mgtProgPct', '—%'); setTxt('mgtProgNote', '');
    setBar(0);
    setImg('mgtNextBadge', null); setTxt('mgtNextName', '—'); setTxt('mgtNextXp', '— XP');
    setTxt('mgtXp', '— XP'); setTxt('mgtTopSub', '');
  }

  function copyIdentityMirrors() {
    var q = function (id) { var e = byId(id); return e ? e.textContent : ''; };
    var badge = byId('rankBadgeBig');
    setImg('mgtBadge', badge && !badge.hidden ? badge.getAttribute('src') : null, badge ? badge.alt : '');

    var lvl = (q('mgLevel') || '').trim();
    setHidden('mgtRankChip', lvl === '' || lvl === '—');

    var flag = byId('mgNameFlag');
    var hasCountry = !!(flag && !flag.hidden && flag.getAttribute('src'));
    setHidden('mgtCountryWrap', !hasCountry);
    setTxt('mgtSumCountry', hasCountry ? q('mgCountryName') : '');

    var pb = byId('rankProgressBlock'), mb = byId('rankMaxBlock'), nw = byId('rankNextWrap');
    setHidden('mgtProgBlock', !pb || pb.hidden);
    setHidden('mgtMaxBlock', !mb || mb.hidden);
    setHidden('mgtNextWrap', !nw || nw.hidden);
    setTxt('mgtProgText', q('rankProgressText')); setTxt('mgtProgPct', q('rankProgressPct')); setTxt('mgtProgNote', q('rankProgressNote'));
    var fill = byId('rankProgressFill');
    setBar(fill ? fill.style.width : 0);
    var nb = byId('rankNextBadge');
    setImg('mgtNextBadge', nb && !nb.hidden ? nb.getAttribute('src') : null, nb ? nb.alt : '');
    setTxt('mgtNextName', q('rankNextName')); setTxt('mgtNextXp', q('rankNextXp'));

    setTxt('mgtXp', q('rankXpBig'));
    setTxt('mgtTopSub', q('rankPositionSub'));
  }

  function copyMirrors() {
    var srcG = byId('mgGcoins'), dstG = byId('mgtSumGcoins');
    if (srcG && dstG) {
      while (dstG.firstChild) dstG.removeChild(dstG.firstChild);
      for (var c = srcG.firstChild; c; c = c.nextSibling) dstG.appendChild(c.cloneNode(true));
    }
    var srcF = byId('mgNameFlag'), dstF = byId('mgtSumFlag');
    if (srcF && dstF) {
      if (srcF.hidden || !srcF.getAttribute('src')) {
        dstF.hidden = true; dstF.removeAttribute('src'); dstF.alt = '';
      } else {
        dstF.src = srcF.getAttribute('src');
        dstF.alt = srcF.alt || '';
        dstF.hidden = false;
      }
    }
    var srcA = byId('mgAvatar'), dstA = byId('mgtAcctAvatar');
    if (srcA && dstA) {
      var av = srcA.getAttribute('src');
      if (av) { dstA.src = av; dstA.style.display = ''; }
      else { dstA.removeAttribute('src'); dstA.style.display = 'none'; }
    }
    var srcN = byId('mgNameText'), dstN = byId('mgtAcctName');
    if (srcN && dstN) dstN.textContent = srcN.textContent;
    copyIdentityMirrors();
  }

  // ---------- Aislamiento entre sesiones ----------
  // "epoch" = identidad vigente. Sube cada vez que se confirma un cierre de sesión o un cambio de cuenta.
  // Toda lectura de Supabase hecha con guard() se descarta (la promesa no se resuelve) si la epoch cambió
  // mientras estaba en vuelo: la función original que la esperaba simplemente no continúa y no escribe.
  // No hay espera ni tope de tiempo: una petición vieja puede tardar lo que quiera, nunca escribe en otra cuenta.
  var epoch = 0;

  var DATA_IDS = ['mgGcoins', 'mgWalletGrid', 'mgRequestsList', 'mgNameText', 'mgLevel', 'mgRank', 'mgRankName',
    'mgRankSub', 'mgRankLink', 'mgAvatar', 'mgNameFlag', 'mgCountryName', 'mgCountryBtn', 'mgCountryMsg',
    'rankBadgeBig', 'rankNameBig', 'rankXpBig', 'rankProgressText', 'rankProgressPct', 'rankProgressFill',
    'rankProgressNote', 'rankNextBadge', 'rankNextName', 'rankNextXp', 'rankPositionValue', 'rankPositionSub',
    'xUsername', 'xConnectBtn', 'xConnectBannerIc', 'xConnectBannerText'];
  var ATTR_ONLY_IDS = ['rankProgressBlock', 'rankMaxBlock', 'rankNextWrap', 'xNotConnected', 'xConnected', 'xConnectBanner'];
  var snapshots = [];
  (function takeSnapshots() {
    function snap(id, withHtml) {
      var el = doc.getElementById(id);
      if (!el) return;
      snapshots.push({
        id: id, withHtml: withHtml,
        html: withHtml ? el.innerHTML : null,
        hidden: el.hidden, cls: el.className, style: el.getAttribute('style'),
        src: el.getAttribute('src'), alt: el.getAttribute('alt'), disabled: el.disabled
      });
    }
    var a;
    for (a = 0; a < DATA_IDS.length; a++) snap(DATA_IDS[a], true);
    for (a = 0; a < ATTR_ONLY_IDS.length; a++) snap(ATTR_ONLY_IDS[a], false);
  })();

  // refreshSaldo() lee su saldo por fetch (no por el cliente de Supabase) y guarda el nodo #mgGcoins
  // al empezar. Al cambiar de identidad ese nodo se reemplaza por uno limpio: si la petición vieja
  // termina después, escribe en el nodo huérfano, no en pantalla. Las demás funciones reciben guard().
  function swapNode(id) {
    var old = doc.getElementById(id);
    if (!old || !old.parentNode) return;
    var fresh = old.cloneNode(false);
    old.parentNode.replaceChild(fresh, old);
  }

  function resetData() {
    swapNode('mgGcoins');
    for (var a = 0; a < snapshots.length; a++) {
      var s = snapshots[a], el = doc.getElementById(s.id);
      if (!el) continue;
      if (s.withHtml) el.innerHTML = s.html;
      el.hidden = s.hidden;
      el.className = s.cls;
      if (s.style == null) el.removeAttribute('style'); else el.setAttribute('style', s.style);
      if (s.src == null) el.removeAttribute('src'); else el.setAttribute('src', s.src);
      if (s.alt == null) el.removeAttribute('alt'); else el.setAttribute('alt', s.alt);
      if (typeof s.disabled === 'boolean') el.disabled = s.disabled;
    }
    resetMirrors();
    confirmedUid = null;
  }

  var currentUid = null;

  // Identidad cambió o se cerró sesión: invalida lecturas en vuelo, oculta y limpia YA los datos privados.
  function identityChanged(loggedOut) {
    epoch += 1;
    currentUid = null;
    resetData();
    var dash = byId('mgDashboard');
    if (dash) dash.hidden = true;
    var lo = byId('mgLoggedOut');
    if (lo && loggedOut) lo.hidden = false;
  }

  /**
   * Lo llama onAuthStateChange con el evento y el uid que el propio evento trae (sin consultar nada).
   * Devuelve 'skip' si no hay que recargar (TOKEN_REFRESHED del mismo usuario con datos ya confirmados).
   */
  function authEvent(event, uid) {
    if (event === 'SIGNED_OUT') { identityChanged(true); return 'reload'; }
    if (uid && currentUid && uid !== currentUid) { identityChanged(false); return 'reload'; }
    if (event === 'TOKEN_REFRESHED' && uid && uid === currentUid && confirmedUid === uid && confirmedGen === gen) return 'skip';
    return 'reload';
  }

  /** uid de la cuenta que se está cargando (null = sin sesión). Si difiere de la vigente, se limpia. */
  function setUser(uid) {
    if (currentUid !== null && currentUid !== uid) identityChanged(false);
    currentUid = uid;
  }

  /** Envuelve el cliente de Supabase: from()/rpc() resueltos tras un cambio de identidad nunca continúan. */
  function guard(sb) {
    var myEpoch = epoch;
    function alive() { return epoch === myEpoch; }
    function never() { return new Promise(function () {}); }
    function wrap(obj) {
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return obj;
      return new Proxy(obj, {
        get: function (target, prop) {
          var v = target[prop];
          if (prop === 'then' && typeof v === 'function') {
            return function (onOk, onErr) {
              return v.call(target, function (r) { return alive() ? (onOk ? onOk(r) : r) : never(); },
                                    function (e) { return alive() ? (onErr ? onErr(e) : Promise.reject(e)) : never(); });
            };
          }
          if (typeof v === 'function') return function () { return wrap(v.apply(target, arguments)); };
          return v;
        }
      });
    }
    return new Proxy(sb, {
      get: function (target, prop) {
        var v = target[prop];
        if ((prop === 'from' || prop === 'rpc') && typeof v === 'function') {
          return function () { return wrap(v.apply(target, arguments)); };
        }
        return typeof v === 'function' ? v.bind(target) : v;
      }
    });
  }

  /** Lo llama loadDashboard() al empezar. Devuelve el número de esta carga. */
  function beginLoad() {
    gen += 1;
    // Con el dashboard oculto (sin sesión / primera carga) no puede haber datos válidos
    // de otra cuenta en los espejos: se limpian. En recargas con sesión (TOKEN_REFRESHED,
    // etc.) se conservan hasta el próximo sync() para no parpadear.
    var dash = byId('mgDashboard');
    if (!dash || dash.hidden) { resetMirrors(); confirmedUid = null; }
    return gen;
  }

  /** Lo llama loadDashboard() al terminar de cargar. Solo la carga más reciente sincroniza. */
  function sync(loadGen, uid) {
    if (loadGen !== gen) return false;            // ejecución antigua (misma cuenta o no)
    if (!uid) return false;
    if (confirmedUid && confirmedUid !== uid) resetMirrors();
    confirmedUid = uid;
    confirmedGen = loadGen;
    copyMirrors();
    if (pendingScroll && scrollToTarget(pendingScroll)) pendingScroll = null;
    return true;
  }

  // ---------- Arranque ----------
  root.classList.add('mgt-ready');
  nav.addEventListener('click', onTabClick);
  nav.addEventListener('keydown', onTabKey);
  window.addEventListener('hashchange', route);

  if (window.matchMedia) {
    var mq = window.matchMedia('(min-width: 1100px)');
    applyOrientation(mq);
    if (mq.addEventListener) mq.addEventListener('change', function () { applyOrientation(mq); });
    else if (mq.addListener) mq.addListener(function () { applyOrientation(mq); });
  }

  // Los enlaces internos "#billetera" etc. (p. ej. "Ver billetera") los resuelve hashchange.
  route();

  window.MgTabs = {
    beginLoad: beginLoad,
    authEvent: authEvent,
    setUser: setUser,
    guard: guard,
    sync: sync,
    show: function (name) { show(name); },
    isCurrent: function (loadGen) { return loadGen === gen; },
    current: function () { return current; }
  };
})();
