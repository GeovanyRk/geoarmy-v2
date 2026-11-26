/* =====================================================================
   GEO ARMY · APARIENCIAS (cosméticos) · lógica común de lectura y presentación   (js/geoarmy-cosmetics.js, v2)
   Pinta CUALQUIER apariencia registrada en el catálogo controlado (js/geoarmy-cosmetics-catalog.js); aquí no hay nada propio de un diseño
   concreto (ni textos como «VIP», ni clases, ni rutas): todo eso sale de la definición de cada apariencia.
   SOLO PRESENTACIÓN. No habla con Supabase, Twitch ni ningún servidor. No toca puntos, G-Coins, XP,
   rangos, recompensas ni compras. No decide QUIÉN tiene un cosmético: eso lo decide un PROVEEDOR
   (ver "PUNTO DE INTEGRACIÓN"), que más adelante será el backend. Este archivo solo PINTA lo que el
   proveedor autoriza, en tres espacios: barra superior, filas del ranking y tarjeta de Mi Geo Army.

   INTERRUPTORES (js/geoarmy-config.js, ambos false por defecto):
     GEOARMY_COSMETICS_ENABLED    false → este archivo queda INERTE (API vacía: no carga CSS, no escucha nada, no pinta nada).
     GEOARMY_COSMETICS_SIMULATION true (solo en equipo local) → carga js/geoarmy-cosmetics-sim.js (usuarios simulados).

   PUNTO DE INTEGRACIÓN (único): js/geoarmy-cosmetics-adapter.js (carga este módulo cuando está activado).
     El adaptador conoce la FORMA de las respuestas del servidor (contrato) y el TRANSPORTE; este archivo solo valida y pinta:
       transport.session({client, uid})  → respuesta cruda → adapter.parseSession(raw)  → código | null | undefined(inválida)
       transport.ranking({client, plain}) → respuesta cruda → adapter.parseRanking(raw) → [{row, code}] | undefined(inválida)
     El ranking llega en UNA sola respuesta con la apariencia de cada fila ya decidida por el servidor: aquí NUNCA se empareja
     por posición ni por nombre; el código queda ligado al propio objeto fila (WeakMap) y solo ese objeto lo pinta.
     Un código desconocido (no está en el catálogo), una definición inválida o una apariencia con recursos que no cargan se ignora:
     el usuario/fila se ve con su apariencia normal. La lista blanca vive en js/geoarmy-cosmetics-catalog.js.
     Sin transporte, respuesta inválida, vista vacía, error o tope de tiempo → apariencia normal (falla cerrada). El transporte real (RPC de sesión + vista de ranking) vive en el adaptador.
   CARGAS QUE NO TERMINAN: nada de lo que este módulo espera puede quedarse colgado. El catálogo, el adaptador y la simulación tienen tope de
   tiempo (LOAD_TIMEOUT); la consulta enriquecida del ranking tiene un tope TOTAL (RANKING_TIMEOUT) que incluye esas esperas, el servidor y los
   recursos; la preparación de cada apariencia (hoja común, hoja propia, dibujo del marco) tiene su propio tope (PREP_TIMEOUT). Pasado el tope:
   ranking → consulta normal (xp_leaderboard) · barra y Mi Geo Army → apariencia normal · nada se pinta a medias. Una respuesta o archivo que llegue
   tarde nunca pinta sobre otra cuenta ni sobre un ranking ya dibujado (cada consulta comprueba que sigue vigente al terminar).
   VERSIÓN DEL CATÁLOGO: el catálogo, el adaptador, la simulación y la hoja común dinámica se piden con ?v=<GEOARMY_COSMETICS_REV> (js/geoarmy-config.js);
   los recursos de cada apariencia con ?v=<REV>.<rev de la definición>. Procedimiento en GUIA_ANADIR_UN_DISENO.md.
     useTransport(t) permite inyectar un transporte (la simulación local y las pruebas lo usan).

   Identidad: la cuenta vigente se fija con setIdentity(uid) (la llama js/geoarmy-account.js) y se vigila con
   onAuthStateChange. Al cambiar de cuenta o cerrar sesión se retiran de inmediato el marco de la barra y de la
   tarjeta, y cualquier respuesta tardía de la cuenta anterior se descarta. Nada se guarda en localStorage/sessionStorage.
   ===================================================================== */
(function () {
  'use strict';
  if (window.GeoArmyCosmetics) return;

  var NOOP = function () {};
  var INERT = {
    version: 1, isEnabled: function () { return false; },
    useTransport: NOOP, setIdentity: NOOP, resolveSession: function () { return Promise.resolve(null); },
    sessionCode: function () { return null; }, decorateBar: NOOP, showIdentityFor: NOOP, clearIdentity: NOOP,
    fetchRanking: function () { return Promise.resolve(null); }, rowMarkup: function () { return { cls: '', frame: '', sr: '' }; },
    avatarFallback: NOOP, refresh: NOOP
  };
  if (window.GEOARMY_COSMETICS_ENABLED !== true) { window.GeoArmyCosmetics = INERT; return; }

  // ---------- Catálogo (lista blanca) ----------
  // La define js/geoarmy-cosmetics-catalog.js (se carga junto al adaptador). Sin catálogo todo queda como apariencia normal.
  // El código que llega de la base de datos SOLO se usa como clave de búsqueda; nunca se ejecuta, ni se inserta como HTML, ni como ruta.
  var broken = Object.create(null);   // código → instante en que sus recursos (CSS o dibujo del marco) fallaron o no llegaron a tiempo: se trata como apariencia normal (BROKEN_TTL)
  function catalog() { var c = window.GeoArmyCosmeticsCatalog; return c && typeof c.get === 'function' ? c : null; }
  function defOf(code) { var c = catalog(); return c && typeof code === 'string' ? c.get(code) : null; }
  function isBroken(code) {
    var t = broken[code];
    if (!t) return false;
    if (Date.now() - t < BROKEN_TTL) return true;
    delete broken[code]; if (prep[code] && prep[code].status === 'failed') delete prep[code];   // caducó: se podrá reintentar
    return false;
  }
  function known(code) { return !!defOf(code) && !isBroken(code); }
  function usableDef(code, surface) { var d = known(code) ? defOf(code) : null; return d && d.surfaces[surface] ? d : null; }

  var SESSION_TIMEOUT = 1500;   // ms: la barra no espera más que esto al proveedor (después se pinta si llega a tiempo)
  var LOAD_TIMEOUT = 3000;      // ms: tope de espera de cada componente que se carga como script (catálogo, adaptador, simulación)
  var RETRY_GAP = 20000;        // ms: tras fallar un componente no se vuelve a pedir hasta pasado este tiempo (y solo si alguien lo necesita)
  var RANKING_TIMEOUT = 6000;   // ms: tope TOTAL de la consulta enriquecida del ranking (componentes + servidor + recursos); pasado el tope se usa la consulta normal
  var RANKING_QUERY = 5000;     // ms: tope de la propia consulta al servidor dentro del tope total
  var PREP_TIMEOUT = 4000;      // ms: tope de preparación de una apariencia (hoja común + hoja propia + dibujo del marco)
  var BROKEN_TTL = 60000;       // ms: una apariencia cuyos recursos fallaron se trata como normal este tiempo; luego se puede reintentar
  var SESSION_TTL = 300000;     // 5 min de caché en memoria por cuenta
  var SESSION_FAIL_TTL = 20000; // 20 s: tras un fallo/tope del proveedor se puede volver a preguntar (no queda bloqueado)
  var SESSION_HARD = SESSION_TIMEOUT * 4;   // tope duro de una consulta al proveedor (la barra espera solo SESSION_TIMEOUT)

  // ---------- Rutas relativas al propio script (sirven igual en "/" que en una subcarpeta o en local) ----------
  var cs = document.currentScript;
  var SRC = cs && cs.src ? cs.src : '';
  var BASE = SRC ? SRC.replace(/js\/geoarmy-cosmetics\.js[^\/]*$/, '') : '';
  // Revisión global de los archivos de apariencias (js/geoarmy-config.js → GEOARMY_COSMETICS_REV). Un solo número: se sube +1 en cada publicación.
  var REV = (function () {
    var r = window.GEOARMY_COSMETICS_REV;
    if (typeof r === 'number' && isFinite(r)) r = String(r);
    return typeof r === 'string' && /^[A-Za-z0-9._-]{1,16}$/.test(r) ? r : '1';
  })();
  function rv(rel) { return BASE + rel + '?v=' + REV; }

  var state = {
    uid: undefined,          // identidad vigente: undefined = aún no se sabe · null = sin sesión · string = uid
    session: null,           // { uid, code, ts }
    inflight: null,          // { uid, promise }
    cardWanted: null,        // { uid, alive } cuando mi-geoarmy.html pidió pintar la tarjeta
    transport: null,         // transporte inyectado con useTransport (tiene prioridad sobre GeoArmyCosmeticsAdapter.transport)
    rows: new WeakMap()      // fila del ranking (objeto) → código
  };

  // ---------- Estilos comunes (se enlazan solo si hace falta, y se espera a que carguen antes de pintar) ----------
  // ranking.html enlaza esta hoja SIN bloquear la página (media="print" + onload="this.media='all'"): si el servidor no responde, la página sigue.
  var cssState = 'none';     // none | loading | ready
  var cssWaiters = [];       // { ok, fail }
  function cssLink() {
    var all = document.querySelectorAll('link[data-gcos-css], link[href*="geoarmy-cosmetics.css"]');
    for (var i = 0; i < all.length; i++) if (!all[i].getAttribute('data-gcos-dead')) return all[i];
    return null;
  }
  function hasRules(l) {              // una respuesta de error (p. ej. 404) a veces deja una hoja VACÍA en vez de un evento de error: cuenta como no cargada
    try { return l.sheet.cssRules.length > 0; } catch (e) { return true; }
  }
  function sheetReady(l) {            // hoja cargada y aplicada (si el enlace espera el cambio media=print → all, se hace aquí también: es idempotente)
    if (!l || !l.sheet || !hasRules(l)) return false;
    if (l.media === 'print') l.media = 'all';
    return true;
  }
  function whenCss(cb, fail) {
    var l = cssLink();
    if (l && l.sheet && !hasRules(l)) { l.setAttribute('data-gcos-dead', '1'); if (l.hasAttribute('data-gcos-css')) l.remove(); l = null; cssState = 'none'; }   // llegó vacía (error): se pide de nuevo
    if (sheetReady(l)) { cssState = 'ready'; cb(); return; }
    cssWaiters.push({ ok: cb, fail: fail || function () {} });
    if (cssState === 'loading' && l) return;
    cssState = 'loading';
    if (!l) {
      l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = rv('css/geoarmy-cosmetics.css'); l.setAttribute('data-gcos-css', '1');
      document.head.appendChild(l);
    }
    var mine = l;
    function done() {
      if (mine.getAttribute('data-gcos-dead')) return;
      if (!sheetReady(mine)) { mine.dispatchEvent(new Event('error')); return; }      // cargó vacía = fallo
      cssState = 'ready';
      var w = cssWaiters.splice(0); w.forEach(function (x) { try { x.ok(); } catch (e) {} });
    }
    mine.addEventListener('load', done);
    mine.addEventListener('error', function () {
      mine.setAttribute('data-gcos-dead', '1');                // enlace fallido: el siguiente intento crea uno nuevo
      if (mine.hasAttribute('data-gcos-css')) mine.remove();
      cssState = 'none';
      var w = cssWaiters.splice(0); w.forEach(function (x) { try { x.fail(); } catch (e) {} });
    });
    if (mine.sheet) done();
  }
  // La preparación venció sin que la hoja común llegara: si el enlace es el que creó este módulo se cancela (el siguiente intento lo pide de nuevo).
  function abortCss() {
    var l = cssLink();
    if (cssState === 'loading' && l && !l.sheet && l.hasAttribute('data-gcos-css')) { l.setAttribute('data-gcos-dead', '1'); l.remove(); cssState = 'none'; cssWaiters.splice(0); }
  }

  // ---------- Preparación de una apariencia: variables de color, hoja de estilos propia y dibujo del marco ----------
  // prepare(code, cb): llama a cb() (una vez) cuando todo está listo. Si algo no carga (404, red, dibujo roto) o no llega en PREP_TIMEOUT, la apariencia
  // se marca como "rota" (broken) durante BROKEN_TTL y se quita de todo lo ya pintado: el usuario queda con su apariencia normal. Nunca lanza.
  var prep = Object.create(null);   // código → { status: 'loading'|'ready'|'failed', waiters: [], timer, cancel }
  var varsSheet = null, varsDone = Object.create(null);
  function ensureVars(def) {
    try {
      if (varsDone[def.id]) return; varsDone[def.id] = true;
      var keys = Object.keys(def.colors || {}); if (!keys.length) return;
      if (!varsSheet) { var st = document.createElement('style'); st.setAttribute('data-gcos-vars', '1'); document.head.appendChild(st); varsSheet = st.sheet; }
      var map = { accent: '--gcos-accent', accent2: '--gcos-accent2', ink: '--gcos-ink', text: '--gcos-text' };
      var decl = keys.map(function (k) { return map[k] + ':' + def.colors[k]; }).join(';');
      varsSheet.insertRule('.gcos-ap-' + def.id + '{' + decl + '}', varsSheet.cssRules.length);   // id y colores ya validados por el catálogo
    } catch (e) {}
  }
  function assetUrl(def, rel) { return BASE + rel + '?v=' + REV + '.' + def.rev; }
  function loadDefCss(def, cb) {            // devuelve una función que cancela la espera (quita el enlace pendiente)
    if (!def.css) { cb(true); return NOOP; }
    var l = document.querySelector('link[data-gcos-ap="' + def.id + '"]');
    if (l && l.sheet && hasRules(l)) { cb(true); return NOOP; }
    if (l && (l.getAttribute('data-gcos-dead') || l.sheet)) { l.remove(); l = null; }
    if (!l) {
      l = document.createElement('link'); l.rel = 'stylesheet'; l.href = assetUrl(def, def.css); l.setAttribute('data-gcos-ap', def.id);
      document.head.appendChild(l);
    }
    var mine = l;
    mine.addEventListener('load', function () { if (hasRules(mine)) cb(true); else { mine.setAttribute('data-gcos-dead', '1'); cb(false); } });
    mine.addEventListener('error', function () { mine.setAttribute('data-gcos-dead', '1'); cb(false); });
    return function () { mine.setAttribute('data-gcos-dead', '1'); if (!mine.sheet) mine.remove(); };
  }
  function probeFrame(def, cb) {
    if (!def.frame) { cb(true); return NOOP; }
    var im = new Image(), done = false;
    function fin(v) { if (!done) { done = true; cb(v); } }
    im.onload = function () { fin(true); }; im.onerror = function () { fin(false); };
    im.src = assetUrl(def, def.frame.src);
    return function () { done = true; im.onload = im.onerror = null; try { im.src = ''; } catch (e) {} };
  }
  function stripAll(code) {
    try {
      var d = defOf(code); if (!d) return;
      Array.prototype.slice.call(document.querySelectorAll('.gcos-ap-' + code)).forEach(function (el) {
        if (el.id === 'gaToggleMenu') { undecorateBar(el); return; }
        if (el.id === 'mgtIdentity') { clearIdentityCard(); return; }
        var fr = el.querySelectorAll('.gcos-frame'), sr = el.querySelectorAll('.gcos-sr');    // fila del ranking
        Array.prototype.forEach.call(fr, function (n) { n.remove(); }); Array.prototype.forEach.call(sr, function (n) { n.remove(); });
        stripClasses(el);
      });
    } catch (e) {}
  }
  function isReady(code) { return !!(prep[code] && prep[code].status === 'ready'); }
  function prepare(code, cb, onFail) {
    var def = known(code) ? defOf(code) : null;
    if (!def) { if (onFail) onFail(); return; }
    var st = prep[code];
    if (st && st.status === 'ready') { cb(); return; }
    if (st && st.status === 'failed') { if (onFail) onFail(); return; }
    if (st) { st.waiters.push({ ok: cb, fail: onFail }); return; }
    st = prep[code] = { status: 'loading', waiters: [{ ok: cb, fail: onFail }], timer: null, cancel: [] };
    ensureVars(def);
    st.timer = setTimeout(function () { finish(false, 'no respondió a tiempo'); }, PREP_TIMEOUT);
    whenCss(function () {                                    // 1) base común (css/geoarmy-cosmetics.css)  2) estilos propios  3) dibujo
      if (st.status !== 'loading') return;
      st.cancel.push(loadDefCss(def, function (okCss) {
        if (st.status !== 'loading') return;
        if (!okCss) return finish(false, 'hoja propia');
        st.cancel.push(probeFrame(def, function (okImg) { finish(okImg, 'dibujo del marco'); }));
      }));
    }, function () { finish(false, 'hoja común'); });
    function finish(ok, why) {
      if (st.status !== 'loading') return;
      clearTimeout(st.timer);
      var w = st.waiters.splice(0);
      if (ok) { st.status = 'ready'; w.forEach(function (x) { try { x.ok(); } catch (e) {} }); }
      else {
        st.status = 'failed'; broken[code] = Date.now();
        st.cancel.forEach(function (f) { try { f(); } catch (e) {} });      // cancela lo que siga pendiente: nada llega después a pintar
        if (why === 'no respondió a tiempo') abortCss();
        try { console.warn('[cosmetics] recursos de la apariencia no disponibles (' + why + '); se muestra la normal: ' + code); } catch (e) {}
        stripAll(code); refresh();
        w.forEach(function (x) { try { if (x.fail) x.fail(); } catch (e) {} });
      }
    }
  }

  // ---------- Simulación local (solo si el interruptor lo pide Y la página corre en un equipo local) ----------
  function isLocalHost() {
    var h = String(location.hostname || '');
    return location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.local$/.test(h);
  }
  // ---------- Componentes (catálogo, adaptador, simulación): se piden al arrancar, con tope de tiempo y reintento acotado ----------
  // 0) catálogo de apariencias (lista blanca)  1) adaptador del contrato (siempre que el módulo esté activado y no esté ya presente)  2) simulación local (solo si procede)
  // whenComponents() → Promise<boolean>: true si catálogo y adaptador están disponibles; false si alguno no llegó en LOAD_TIMEOUT (nunca se queda esperando).
  // Un archivo que llegue DESPUÉS del tope queda disponible para las siguientes consultas (no pinta nada por sí mismo).
  var comp = {};   // clave → { st: 'idle'|'loading'|'failed', at, p }
  var COMPS = [
    { key: 'catalog', url: 'js/geoarmy-cosmetics-catalog.js', ok: function () { return !!catalog(); } },
    { key: 'adapter', url: 'js/geoarmy-cosmetics-adapter.js', ok: function () { return !!adapterObj(); } }
  ];
  function ensureComp(c) {
    if (c.ok()) return Promise.resolve(true);
    var s = comp[c.key] || (comp[c.key] = { st: 'idle', at: 0, p: null });
    if (s.st === 'loading') return s.p;
    if (!SRC) return Promise.resolve(false);
    if (s.st === 'failed' && Date.now() - s.at < RETRY_GAP) return Promise.resolve(false);
    s.st = 'loading'; s.at = Date.now();
    s.p = new Promise(function (resolve) {
      var sc = document.createElement('script'), done = false, timer;
      function fin(ok, why) {
        if (done) return; done = true; clearTimeout(timer);
        var good = !!ok && c.ok();
        s.st = good ? 'idle' : 'failed'; s.at = Date.now();
        if (!good) { try { console.warn('[cosmetics] no disponible: ' + c.url + ' (' + why + '); se muestra la apariencia normal'); } catch (e) {} }
        resolve(good);
      }
      sc.onload = function () { fin(true, 'carga'); };
      sc.onerror = function () { fin(false, 'error de carga'); };
      timer = setTimeout(function () { fin(false, 'sin respuesta a tiempo'); }, LOAD_TIMEOUT);
      sc.src = rv(c.url);
      document.head.appendChild(sc);
    });
    return s.p;
  }
  var simP = null;
  function ensureSim() {      // la simulación solo se pide una vez; que falle no impide el uso normal
    if (!(window.GEOARMY_COSMETICS_SIMULATION === true && isLocalHost() && SRC)) return Promise.resolve(true);
    if (simP) return simP;
    simP = new Promise(function (resolve) {
      var sc = document.createElement('script'), done = false, timer;
      function fin() { if (done) return; done = true; clearTimeout(timer); resolve(true); }
      sc.onload = fin; sc.onerror = function () { try { console.warn('[cosmetics] no se pudo cargar js/geoarmy-cosmetics-sim.js'); } catch (e) {} fin(); };
      timer = setTimeout(fin, LOAD_TIMEOUT);
      sc.src = rv('js/geoarmy-cosmetics-sim.js');
      document.head.appendChild(sc);
    });
    return simP;
  }
  function whenComponents() {
    return Promise.all(COMPS.map(ensureComp)).then(function (r) {
      if (!r.every(Boolean)) return false;
      return ensureSim();
    }, function () { return false; });
  }
  if (window.GEOARMY_COSMETICS_SIMULATION === true && !isLocalHost()) {
    console.warn('[cosmetics] GEOARMY_COSMETICS_SIMULATION=true ignorado: esta página no corre en un equipo local.');
  }
  function adapterObj() {
    var a = window.GeoArmyCosmeticsAdapter;
    return a && typeof a.parseSession === 'function' && typeof a.parseRanking === 'function' ? a : null;
  }
  function getTransport() { return state.transport || (window.GeoArmyCosmeticsAdapter && window.GeoArmyCosmeticsAdapter.transport) || null; }
  function accountClient() { var A = window.GeoArmyAccount; return A && A.client ? A.client : null; }
  whenComponents();     // arranque: empieza a pedir catálogo y adaptador ya (con tope de tiempo)

  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(undefined); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(undefined); });
    });
  }
  // Llama al proveedor sin que una excepción SÍNCRONA (o un valor no-promesa) escape: siempre devuelve una promesa.
  function safeCall(fn) {
    try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function byId(id) { return document.getElementById(id); }

  // ---------- Piezas de marcado (todo sale de la definición de la apariencia) ----------
  function frameStyleVars(def) {
    var f = def.frame; if (!f) return null;
    return { img: 'url("' + assetUrl(def, f.src) + '")', fs: String(f.scale), fh: String(-f.scale / 2), fy: String(f.anchorY) };
  }
  function frameEl(def) {
    var f = document.createElement('span');
    f.className = 'gcos-frame'; f.setAttribute('aria-hidden', 'true');
    var v = frameStyleVars(def);
    if (v) { f.style.setProperty('--gcos-frame-img', v.img); f.style.setProperty('--gcos-fs', v.fs); f.style.setProperty('--gcos-fh', v.fh); f.style.setProperty('--gcos-fy', v.fy); }
    if (def.badge) { var i = document.createElement('i'); i.className = 'gcos-badge'; var b = document.createElement('b'); b.textContent = def.badge.text; i.appendChild(b); f.appendChild(i); }
    return f;
  }
  function frameHtml(def) {
    var v = frameStyleVars(def);
    var style = v ? ' style="--gcos-frame-img:' + esc(v.img) + ';--gcos-fs:' + esc(v.fs) + ';--gcos-fh:' + esc(v.fh) + ';--gcos-fy:' + esc(v.fy) + '"' : '';
    return '<span class="gcos-frame" aria-hidden="true"' + style + '>' + (def.badge ? '<i class="gcos-badge"><b>' + esc(def.badge.text) + '</b></i>' : '') + '</span>';
  }
  function srText(def) { return def.sr ? ' (' + def.sr + ')' : ''; }
  function srHtml(def) { return def.sr ? '<span class="gcos-sr">' + esc(srText(def)) + '</span>' : ''; }
  function srEl(def) { var s = document.createElement('span'); s.className = 'gcos-sr'; s.textContent = srText(def); return s; }
  // Clases de estado: genérica (gcos-on), de la apariencia (gcos-ap-<id>) y las propias de su definición.
  function stateClasses(def) { return ['gcos-on', 'gcos-ap-' + def.id].concat(def.cls); }
  function applyClasses(el, def) { stateClasses(def).forEach(function (c) { el.classList.add(c); }); el.setAttribute('data-gcos', def.id); }
  function stripClasses(el) {
    var code = el.getAttribute('data-gcos'), d = defOf(code);
    el.classList.remove('gcos-on');
    Array.prototype.slice.call(el.classList).forEach(function (c) { if (c.indexOf('gcos-ap-') === 0) el.classList.remove(c); });
    if (d) d.cls.forEach(function (c) { el.classList.remove(c); });
    el.removeAttribute('data-gcos');
  }

  // Si la foto no carga: se sustituye por la inicial (solo en elementos con cosmético; los demás quedan como siempre).
  function avatarFallback(img) {
    try {
      if (!img || !img.parentNode) return;
      var root = img.closest('.rk-top-card, .rk-row, .ga-account-btn');
      var nameEl = root && root.querySelector('.rk-top-name, .rk-row-name, .ga-name');
      var t = String((nameEl && nameEl.textContent) || '?'), srn = nameEl && nameEl.querySelector('.gcos-sr');
      if (srn) t = t.replace(srn.textContent, '');            // sin el texto para lectores de la apariencia
      t = t.trim();
      var base = String(img.className || '').split(' ')[0] || 'rk-avatar';
      var sp = document.createElement('span');
      sp.className = base + ' ' + base + '-fallback';
      sp.textContent = t.charAt(0) || '?';
      img.parentNode.replaceChild(sp, img);
    } catch (e) {}
  }
  function guardImg(img, onFail) {
    if (!img || img.getAttribute('data-gcos-guard')) return;
    img.setAttribute('data-gcos-guard', '1');
    img.addEventListener('error', onFail);
    if (img.complete && !img.naturalWidth && (img.getAttribute('src') || '') !== '' && img.style.display !== 'none') onFail();
  }

  // ---------- BARRA SUPERIOR ----------
  function undecorateBar(btn) {
    if (!btn) btn = byId('gaToggleMenu');
    if (!btn || !btn.classList.contains('gcos-on')) return;
    stripClasses(btn);
    var wrap = btn.querySelector('.gcos-avatar-wrap');
    if (wrap) {
      var av = wrap.querySelector('.ga-avatar');
      if (av) btn.insertBefore(av, wrap);
      wrap.remove();
    }
    var sr = btn.querySelector('.gcos-sr'); if (sr) sr.remove();
  }
  function decorateBar(uid) {
    try {
      var btn = byId('gaToggleMenu');
      if (!btn) return;
      var code = sessionCode(uid), def = usableDef(code, 'bar');
      if (!uid || uid !== state.uid || !def) { undecorateBar(btn); return; }
      if (btn.classList.contains('gcos-on') && btn.getAttribute('data-gcos') !== def.id) undecorateBar(btn);   // cambió la apariencia de la misma cuenta
      prepare(def.id, function () {
        // el botón pudo redibujarse mientras cargaban los recursos: se vuelve a comprobar identidad, apariencia y botón
        var b = byId('gaToggleMenu'), d2 = usableDef(sessionCode(uid), 'bar');
        if (!b || state.uid !== uid || !d2 || d2.id !== def.id) return;
        if (b.classList.contains('gcos-on') && b.querySelector('.gcos-avatar-wrap')) return;   // ya pintado (idempotente)
        var av = b.querySelector('.ga-avatar');
        if (!av) return;
        var wrap = document.createElement('span');
        wrap.className = 'gcos-avatar-wrap';
        b.insertBefore(wrap, av); wrap.appendChild(av); wrap.appendChild(frameEl(def));
        applyClasses(b, def);
        var nm = b.querySelector('.ga-name'); if (nm && !b.querySelector('.gcos-sr') && def.sr) nm.parentNode.insertBefore(srEl(def), nm.nextSibling);
        if (av.tagName === 'IMG') guardImg(av, function () { avatarFallback(av); });
      });
    } catch (e) { /* la presentación nunca debe romper la cuenta */ }
  }

  // ---------- TARJETA DE MI GEO ARMY ----------
  function clearIdentityCard() {
    var card = byId('mgtIdentity');
    if (!card) return;
    if (card.classList.contains('gcos-on')) stripClasses(card);
    var f = card.querySelector('.mgt-id-avatar > .gcos-frame'); if (f) f.remove();
    var s = card.querySelector('.gcos-sr'); if (s) s.remove();
  }
  function applyIdentityCard(uid) {
    try {
      var card = byId('mgtIdentity');
      if (!card) return;
      var code = sessionCode(uid), def = usableDef(code, 'card');
      if (!uid || uid !== state.uid || !def) { clearIdentityCard(); return; }
      if (card.classList.contains('gcos-on') && card.getAttribute('data-gcos') !== def.id) clearIdentityCard();   // cambió la apariencia de la misma cuenta
      prepare(def.id, function () {
        var c = byId('mgtIdentity'), d2 = usableDef(sessionCode(uid), 'card');
        if (!c || state.uid !== uid || !d2 || d2.id !== def.id) return;
        if (state.cardWanted && state.cardWanted.alive && !state.cardWanted.alive()) return;   // carga antigua de la página
        applyClasses(c, def);
        var av = c.querySelector('.mgt-id-avatar');
        if (av && !av.querySelector(':scope > .gcos-frame')) {
          var ring = av.querySelector('.mgt-id-ring');
          var fr = frameEl(def); if (def.frame && def.frame.animateInCard) fr.classList.add('gcos-frame--anim');   // única instancia visible: aquí sí va el brillo suave
          av.insertBefore(fr, ring ? ring.nextSibling : av.firstChild);
        }
        var nm = byId('mgNameText');
        if (nm && !c.querySelector('.gcos-sr') && def.sr) nm.parentNode.insertBefore(srEl(def), nm.nextSibling);
        var img = byId('mgAvatar');
        if (img) guardImg(img, function () { img.style.display = 'none'; });
      });
    } catch (e) {}
  }

  // ---------- Identidad y caché por cuenta ----------
  function sessionCode(uid) {
    return sessionFresh(uid) ? state.session.code : null;
  }
  function sessionFresh(uid) { return !!(state.session && uid && state.session.uid === uid && (Date.now() - state.session.ts) < state.session.ttl); }
  function setIdentity(uid) {
    uid = uid || null;
    if (uid === state.uid) return;
    state.uid = uid;
    state.session = null; state.inflight = null; state.cardWanted = null;
    undecorateBar(); clearIdentityCard();   // retirada inmediata: nunca se ve el marco de A con la sesión de B
  }
  function refresh() { try { decorateBar(state.uid); if (state.cardWanted) applyIdentityCard(state.uid); } catch (e) {} }

  function resolveSession(uid) {
    uid = uid || null;
    if (!uid) return Promise.resolve(null);
    if (state.uid !== uid) setIdentity(uid);
    if (sessionFresh(uid)) return Promise.resolve(state.session.code);
    if (state.inflight && state.inflight.uid === uid) return capped(state.inflight.promise);   // misma consulta en curso; este llamador también espera como máximo SESSION_TIMEOUT
    var entry = { uid: uid, promise: null };
    entry.promise = withTimeout(whenComponents().then(function (comps) {
      // Si mientras esperaba (p. ej. a que cargara el adaptador / la simulación) esta consulta ya fue sustituida por otra
      // (useTransport, cambio de cuenta), NO llama al proveedor: evita consultas duplicadas.
      if (state.inflight !== entry || state.uid !== uid) return undefined;
      if (!comps) return undefined;                                        // catálogo/adaptador no disponibles: FALLO (se reintenta en 20 s), no «sin apariencia» durante 5 min
      var ad = adapterObj(), tr = getTransport();
      if (!ad || !tr || typeof tr.session !== 'function') return null;     // sin transporte: sin llamadas de red, apariencia normal
      // safeCall: un throw síncrono del transporte cuenta como fallo (no deja la consulta "en curso" para siempre)
      return withTimeout(safeCall(function () { return tr.session({ client: accountClient(), uid: uid }); }), SESSION_HARD).then(function (raw) {
        if (raw === undefined) return undefined;                           // error / tope
        try { return ad.parseSession(raw); } catch (e) { return undefined; }   // respuesta inválida → undefined (fallo)
      });
    }), SESSION_HARD).then(null, function () { return undefined; })   // cualquier excepción = fallo (undefined), nunca una promesa rechazada colgada
      .then(function (code) {
        if (state.uid !== uid || state.inflight !== entry) return null;           // cambió la cuenta / cerró sesión mientras tanto: respuesta descartada
        state.inflight = null;                                                      // la consulta terminó (bien o mal): se libera siempre
        var ok = defOf(code) ? code : null;                                          // vale el catálogo; que sus recursos estén sanos se comprueba al pintar (usableDef)
        // éxito (con o sin cosmético) → 5 min en memoria; fallo/tope → solo 20 s, para volver a preguntar pronto
        state.session = { uid: uid, code: ok, ts: Date.now(), ttl: code === undefined ? SESSION_FAIL_TTL : SESSION_TTL };
        refresh();                                                                   // por si llegó después de pintar la barra/tarjeta
        return ok;
      });
    state.inflight = entry;
    // Quien llama (la barra) espera como máximo SESSION_TIMEOUT; si llega después, refresh() lo pinta igual.
    return capped(entry.promise);
  }
  function capped(pr) { return withTimeout(pr, SESSION_TIMEOUT).then(function (v) { return v === undefined ? null : v; }); }

  // La tarjeta de Mi Geo Army la pide mi-geoarmy.html cuando ya conoce la cuenta; `alive` dice si esa carga sigue vigente.
  function showIdentityFor(uid, alive) {
    if (!uid) { clearIdentityCard(); state.cardWanted = null; return; }
    if (state.uid !== uid) setIdentity(uid);
    state.cardWanted = { uid: uid, alive: alive };
    applyIdentityCard(uid);                          // si ya está en caché se pinta ya
    resolveSession(uid).then(function () { if (state.uid === uid && state.cardWanted) applyIdentityCard(uid); });
  }

  // ---------- RANKING ----------
  // Consulta enriquecida del ranking: UNA respuesta del servidor con las filas y la apariencia de cada una.
  // Devuelve { data: rows, error: null } (misma forma que la consulta normal) o null → el llamador usa su consulta normal.
  // Las filas devueltas son COPIAS sin el campo de apariencia; el código queda ligado a cada objeto fila (WeakMap).
  // Una respuesta inválida (aunque sea en una sola fila), un error, un tope de tiempo o la falta de transporte → null (sin cosméticos).
  // Si la respuesta llega después del tope, se descarta: nunca modifica nada.
  function fetchRanking(ctx) {
    ctx = ctx || {};
    var job = { dead: false };      // se marca al vencer el tope total: lo que llegue después ya no hace nada
    var inner = whenComponents().then(function (comps) {
      if (job.dead || !comps) return null;                                  // catálogo/adaptador sin llegar a tiempo → consulta normal
      var ad = adapterObj(), tr = getTransport();
      if (!ad || !tr || typeof tr.ranking !== 'function') return null;
      return withTimeout(safeCall(function () { return tr.ranking({ client: ctx.client || accountClient(), plain: ctx.plain }); }), RANKING_QUERY).then(function (raw) {
        if (job.dead || raw === undefined) return null;
        var parsed;
        try { parsed = ad.parseRanking(raw); } catch (e) { parsed = undefined; }
        if (!parsed || !parsed.length) return null;
        var rows = [], codes = [];
        parsed.forEach(function (it) {
          rows.push(it.row);
          if (defOf(it.code)) { state.rows.set(it.row, it.code); if (codes.indexOf(it.code) === -1) codes.push(it.code); }
        });
        // Antes de devolver las filas se preparan (como mucho ASSET_WAIT ms) los recursos de las apariencias que aparecen: así las filas
        // nacen ya con sus estilos y, si un recurso falta, esa apariencia no se pinta. Pasado el tope se continúa sin bloquear el ranking
        // (y esas filas salen normales: rowMarkup solo pinta apariencias con todos sus recursos listos).
        return waitPrepared(codes).then(function () { return job.dead ? null : { data: rows, error: null }; });
      });
    }).then(null, function () { return null; });
    return withTimeout(inner, RANKING_TIMEOUT).then(function (v) { if (v === undefined) { job.dead = true; return null; } return v; });
  }
  var ASSET_WAIT = 1500;   // ms: tope de espera de los recursos de las apariencias del ranking
  function waitPrepared(codes) {
    if (!codes.length) return Promise.resolve();
    return withTimeout(Promise.all(codes.map(function (c) {
      return new Promise(function (res) { prepare(c, res, res); });                    // listo o fallido: en ambos casos se continúa
    })), ASSET_WAIT).then(function () {});
  }
  // Marcado para una fila: { cls, frame, sr }. Sin código autorizado → cadenas vacías (la fila queda exactamente como siempre).
  function rowMarkup(row) {
    var code = row && typeof row === 'object' ? state.rows.get(row) : null;
    var def = usableDef(code, 'ranking');
    if (!def) return { cls: '', frame: '', sr: '' };
    if (!isReady(def.id)) { prepare(def.id, function () {}, function () {}); return { cls: '', frame: '', sr: '' }; }   // sin TODOS sus recursos listos no se pinta nada a medias
    return { cls: ' ' + stateClasses(def).join(' '), frame: frameHtml(def), sr: srHtml(def) };
  }

  // ---------- Vigilancia de sesión (cambio de cuenta / cierre de sesión sin recargar) ----------
  var authHooked = false;
  function hookAuth() {
    if (authHooked) return;
    var A = window.GeoArmyAccount, c = A && A.client;
    if (!c || !c.auth || typeof c.auth.onAuthStateChange !== 'function') return;
    authHooked = true;
    c.auth.onAuthStateChange(function (event, session) {
      try {
        var uid = session && session.user ? session.user.id : null;
        if (event === 'SIGNED_OUT' || uid !== state.uid) setIdentity(uid);
      } catch (e) {}
    });
  }
  hookAuth();
  if (!authHooked) document.addEventListener('DOMContentLoaded', hookAuth);

  // CARGA TARDÍA: en páginas que no incluyen este archivo con <script>, js/geoarmy-account.js lo carga de forma asíncrona y la
  // sesión/barra pueden estar ya resueltas. Aquí se lee la identidad vigente (GeoArmyAccount.identity(): undefined = aún no
  // confirmada · null = sin sesión · uid) y se adopta: se consulta al proveedor y, al llegar, refresh() decora la barra sin
  // esperar a otro evento de autenticación. Es idempotente (misma identidad = no hace nada nuevo) y no emite eventos.
  function adoptCurrentIdentity() {
    try {
      var A = window.GeoArmyAccount;
      if (!A || typeof A.identity !== 'function') return;
      var id = A.identity();
      if (id === undefined) return;          // el render inicial aún no confirmó identidad: lo harán los enganches normales
      setIdentity(id || null);
      if (id) resolveSession(id);
    } catch (e) {}
  }
  adoptCurrentIdentity();

  window.GeoArmyCosmetics = {
    version: 1,
    isEnabled: function () { return true; },
    useTransport: function (t) {
      state.transport = t && typeof t === 'object' ? t : null; state.session = null; state.inflight = null;
      refresh();                                                   // retira lo pintado con el transporte anterior
      if (state.uid) resolveSession(state.uid);                    // y vuelve a preguntar con el nuevo (pinta si autoriza)
    },
    setIdentity: setIdentity,
    resolveSession: resolveSession,
    sessionCode: sessionCode,
    decorateBar: decorateBar,
    showIdentityFor: showIdentityFor,
    clearIdentity: function () { state.cardWanted = null; clearIdentityCard(); },
    fetchRanking: fetchRanking,
    rowMarkup: rowMarkup,
    avatarFallback: avatarFallback,
    refresh: refresh,
    _adopt: adoptCurrentIdentity,
    _ready: function () { return whenComponents(); },
    _rev: function () { return REV; },
    _known: function () { var c = catalog(); return c ? c.codes() : []; }
  };
})();
