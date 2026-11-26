/* ============================================================================
   GEO ARMY Plus — Misión diaria de G-Coins: RECLAMO AUTOMÁTICO al entrar con sesión iniciada (MODO SOMBRA).
   ----------------------------------------------------------------------------
   NO ESTÁ CONECTADO: este archivo vive en plus-twitch/js/ y ninguna página lo carga. Para activarlo (fase posterior, aprobada) se copia
   a js/, se añade el cargador diferido a js/geoarmy-account.js y la línea GEOARMY_PLUS_DAILY_ENABLED a js/geoarmy-config.js
   (ver PROPUESTA_MISION_DIARIA_PLUS.md §8 y plus-twitch/sitio/). Con el interruptor ausente o distinto de true NO se carga ni hace nada.

   Qué hace: con sesión iniciada, pide UNA vez al servidor que reclame la misión diaria Plus (POST sin cuerpo a la Edge Function
   `plus-daily-gcoin-claim`) y publica el resultado para la tarjeta de Misiones. La identidad la toma el servidor del JWT; Plus, el día
   de America/New_York, el límite de una vez por día y el crédito los decide la base. Funciona sin que Geo esté en directo (nada de
   este archivo mira transmisiones).

   Qué NO hace:
     - No decide nada de dinero ni de Plus: no calcula días, montos ni acceso. Solo repite lo que dice el servidor.
     - No envía cuerpo (ni perfil, ni monto, ni día).
     - No toca las misiones de XP (no llama a claim_daily_visit ni a my_missions_status ni lee su evento).
     - Un fallo, un tiempo agotado o una respuesta perdida NO se interpreta como «no se cobró»: el resultado es DESCONOCIDO. Se vuelve a
       comprobar solo (y a mano con retry()); el servidor es idempotente (un reintento no paga dos veces; si ya se acreditó responde
       «already_claimed»).
     - El resultado definitivo del día (acreditada / ya recibida) vale SOLO hasta el reinicio que indicó el servidor (next_reset_at): con la página
       abierta se vuelve a comprobar solo al llegar ese instante (más un margen aleatorio) y al volver a la pestaña. No hace falta recargar.
     - Una respuesta pertenece solo a la cuenta que inició la petición: si se cierra sesión o se cambia de cuenta mientras está pendiente, la
       petición se cancela y, si aun así llega, se descarta (ni estado, ni tarjeta, ni caché, ni refresco de saldo). La cuenta nueva reclama por su cuenta.
     - Nunca lanza ni rechaza: es seguro llamarlo sin esperar.
   ============================================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GeoArmyPlusDailyFactory = api.create;
  root.GeoArmyPlusDaily = api.auto(root);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var STORAGE_PREFIX = 'geoarmy_plus_daily_v1:';
  var REQUEST_TIMEOUT_MS = 25000;                 // > tope de Auth (5 s) + tope de la base (8 s) de la Edge Function
  var RETRY_DELAYS_MS = [4000, 15000, 45000];     // re-comprobaciones automáticas tras un resultado desconocido
  var PLUS_REQUIRED_CACHE_MS = 10 * 60 * 1000;    // quien no es Plus: no se pregunta en cada página (por si se suscribe, se re-comprueba a los 10 min)
  var HIDDEN_PAUSE_MS = 30 * 60 * 1000;           // misión apagada / función no disponible: se deja de insistir (solo en memoria)
  var EXPIRY_MARGIN_MIN_MS = 1000;                // al llegar el reinicio del servidor se re-comprueba solo, 1 s + un margen aleatorio después...
  var EXPIRY_MARGIN_JITTER_MS = 14000;            // ...de hasta 14 s más (para no llegar todas las pestañas a la vez)
  var EXPIRY_REPEAT_FLOOR_MS = 60000;             // si ya se re-comprobó para ese reinicio (reloj del navegador adelantado), no antes de 60 s
  var WAKE_MIN_INTERVAL_MS = 60000;               // al volver a la pestaña / recuperar el foco no se pregunta más de una vez por minuto
  var MAX_TIMER_MS = 2147483647;
  var DEFAULT_UNCONFIRMED_MSG = 'No pudimos confirmar si tus 10 G-Coins ya se acreditaron. Lo comprobaremos de nuevo; también puedes reintentar. Un reintento no los acredita dos veces.';

  function isSession(s) {
    return !!(s && typeof s.access_token === 'string' && s.access_token && s.user && typeof s.user.id === 'string' && s.user.id);
  }

  function create(deps) {
    var enabled = deps.enabled === true;
    var now = function () { return deps.now ? deps.now() : Date.now(); };
    var setT = deps.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    var clearT = deps.clearTimeout || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
    var rand = deps.random || Math.random;

    var state = { phase: 'idle' };      // idle | checking | granted | already_claimed | plus_required | unconfirmed | hidden
    var uid = null;                     // cuenta a la que pertenece TODO el estado en memoria
    var epoch = 0;                      // «generación» de la sesión: sube al cerrar sesión o cambiar de cuenta; una petición solo puede escribir si sigue siendo la suya
    var pending = null;                 // petición en vuelo: { uid, epoch, controller, promise } (una por cuenta)
    var doneUid = null;                 // cuenta con resultado definitivo (acreditada / ya recibida)...
    var doneUntil = 0;                  // ...válido hasta el reinicio que indicó el SERVIDOR (ms); pasado ese instante se vuelve a preguntar solo
    var lastExpiryResetMs = 0;          // reinicio para el que ya se re-comprobó una vez (evita bucles si el reloj del navegador va adelantado)
    var lastClaimAt = 0;
    var retryTimer = null;
    var expiryTimer = null;
    var attempts = 0;
    var hiddenUntil = 0;
    var listeners = [];

    function copy() { return JSON.parse(JSON.stringify(state)); }
    function setState(next) {
      state = next;
      var snap = copy();
      for (var i = 0; i < listeners.length; i++) { try { listeners[i](snap); } catch (e) { /* un oyente roto no afecta a los demás */ } }
      try { if (deps.emit) deps.emit(snap); } catch (e) { /* ignorar */ }
    }
    function cancelRetry() { if (retryTimer !== null && clearT) { clearT(retryTimer); } retryTimer = null; }
    function cancelExpiry() { if (expiryTimer !== null && clearT) { clearT(expiryTimer); } expiryTimer = null; }
    // Temporizador que no mantiene vivo un proceso de Node (en el navegador setTimeout devuelve un número y esto no hace nada).
    function timer(fn, ms) { var id = setT(fn, ms); try { if (id && typeof id.unref === 'function') id.unref(); } catch (e) { /* ignorar */ } return id; }

    // Cierre de sesión o cambio de cuenta: todo lo de la cuenta anterior queda invalidado. Lo que la petición en vuelo conteste después ya no
    // se escribe en el estado, la tarjeta ni la caché (se compara la «generación»), y la petición se cancela.
    function invalidate() {
      epoch += 1; cancelRetry(); cancelExpiry(); attempts = 0; hiddenUntil = 0; doneUid = null; doneUntil = 0; uid = null;
      if (pending) { try { if (pending.controller) pending.controller.abort(); } catch (e) { /* ignorar */ } pending = null; }
    }

    function key(u) { return STORAGE_PREFIX + u; }
    function readCache(u) {
      try {
        var raw = deps.storage && deps.storage.getItem(key(u));
        if (!raw) return null;
        var c = JSON.parse(raw);
        if (!c || typeof c.until !== 'number' || c.until <= now()) return null;
        if (c.status !== 'granted' && c.status !== 'already_claimed' && c.status !== 'plus_required') return null;
        return c;
      } catch (e) { return null; }
    }
    function writeCache(u, c) { try { if (deps.storage) deps.storage.setItem(key(u), JSON.stringify(c)); } catch (e) { /* ignorar */ } }

    // El resultado definitivo del día caduca en el reinicio que dio el SERVIDOR: con la página abierta se vuelve a comprobar solo (con un
    // pequeño margen aleatorio para que todas las pestañas no lleguen a la vez). El navegador no calcula el día.
    function scheduleExpiry(resetMs) {
      cancelExpiry();
      if (!setT || !isFinite(resetMs)) return;
      var myEpoch = epoch;
      var delay = Math.max(resetMs - now(), 0) + EXPIRY_MARGIN_MIN_MS + Math.floor(rand() * EXPIRY_MARGIN_JITTER_MS);
      if (resetMs === lastExpiryResetMs) delay = Math.max(delay, EXPIRY_REPEAT_FLOOR_MS);   // ya se re-comprobó para este reinicio: no insistir cada pocos segundos
      delay = Math.min(delay, MAX_TIMER_MS);
      expiryTimer = timer(function () {
        expiryTimer = null;
        if (epoch !== myEpoch) return;
        if (now() < resetMs) { scheduleExpiry(resetMs); return; }                           // se disparó antes de tiempo (reloj o límite del temporizador)
        lastExpiryResetMs = resetMs; doneUntil = 0;
        ensure('expire');
      }, delay);
    }
    function isDone(u) { return doneUid === u && doneUntil > now() && (state.phase === 'granted' || state.phase === 'already_claimed'); }

    function applyDefinitive(u, body, resetMs) {
      var amount = typeof body.amount === 'number' ? body.amount : 10;
      var next = { phase: body.status, amount: amount, claimDay: typeof body.claim_day === 'string' ? body.claim_day : null,
        nextResetAt: body.next_reset_at, fresh: body.status === 'granted' };
      // Solo se recuerda lo DEFINITIVO del día, hasta el reinicio que indica el SERVIDOR (el navegador no calcula el día).
      writeCache(u, { status: body.status, amount: amount, claim_day: next.claimDay, next_reset_at: next.nextResetAt, until: resetMs });
      doneUid = u; doneUntil = resetMs;
      setState(next);
      scheduleExpiry(resetMs);
    }

    function unconfirmed(message) {
      attempts += 1;
      var willRetry = attempts <= RETRY_DELAYS_MS.length;
      setState({ phase: 'unconfirmed', message: typeof message === 'string' && message && message.length < 400 ? message : DEFAULT_UNCONFIRMED_MSG, autoRetry: willRetry });
      if (willRetry && setT) {
        cancelRetry();
        retryTimer = timer(function () { retryTimer = null; ensure('auto-retry'); }, RETRY_DELAYS_MS[attempts - 1]);
      }
      return { done: false, phase: 'unconfirmed' };
    }

    // La respuesta pertenece SOLO a la cuenta `u` que inició la petición, en la generación `myEpoch`. Si entretanto se cerró sesión o se cambió
    // de cuenta, se descarta por completo (ni estado, ni tarjeta, ni caché, ni refresco de saldo): el servidor es idempotente, así que la
    // cuenta original verá «ya recibida» cuando vuelva a entrar, y la cuenta nueva hace su propio reclamo.
    async function claim(session, u, myEpoch, controller) {
      var live = function () { return epoch === myEpoch && uid === u; };
      lastClaimAt = now();
      setState({ phase: 'checking' });
      var tmr = setT ? timer(function () { if (controller) controller.abort(); }, deps.timeoutMs || REQUEST_TIMEOUT_MS) : null;
      var res = null; var body = null;
      try {
        res = await deps.fetch(deps.endpoint, {
          method: 'POST',
          // Sin body a propósito: el servidor resuelve usuario, Plus, día, monto e idempotencia por su cuenta.
          headers: { 'Authorization': 'Bearer ' + session.access_token, 'apikey': deps.anonKey, 'Accept': 'application/json' },
          signal: controller ? controller.signal : undefined,
        });
        body = await res.json().catch(function () { return null; });
      } catch (e) {
        if (!live()) return { skipped: 'superseded' };
        // Red caída, tiempo agotado o respuesta perdida: el servidor PUDO haber acreditado. Resultado desconocido (no «no se cobró»).
        return unconfirmed(null);
      } finally {
        if (tmr !== null && clearT) clearT(tmr);
      }
      if (!live()) return { skipped: 'superseded' };

      var status = body && typeof body.status === 'string' ? body.status : null;
      if (status === 'granted' || status === 'already_claimed') {
        var resetMs = body && typeof body.next_reset_at === 'string' ? Date.parse(body.next_reset_at) : NaN;
        if (body.ok !== true || !isFinite(resetMs)) return unconfirmed(null);     // sin reinicio válido no hay forma de saber hasta cuándo vale: se comprueba de nuevo
        attempts = 0; cancelRetry(); applyDefinitive(u, body, resetMs);
        if (status === 'granted') { try { if (deps.onGranted) deps.onGranted(); } catch (e) { /* refrescar el saldo nunca rompe nada */ } }
        return { done: true, phase: status };
      }
      if (status === 'plus_required') {
        attempts = 0; cancelRetry();
        writeCache(u, { status: 'plus_required', until: now() + PLUS_REQUIRED_CACHE_MS });
        setState({ phase: 'plus_required' });
        return { done: true, phase: 'plus_required' };
      }
      if (status === 'disabled' || status === 'profile_not_found' || status === 'origin_not_allowed' || status === 'server_misconfigured' ||
          status === 'unauthenticated' || (res && (res.status === 401 || res.status === 403 || res.status === 404))) {
        // Misión apagada, función no disponible o sesión no válida: no es un error para el usuario; la tarjeta no se muestra y no se insiste.
        attempts = 0; cancelRetry(); hiddenUntil = now() + HIDDEN_PAUSE_MS;
        setState({ phase: 'hidden' });
        return { done: true, phase: 'hidden' };
      }
      // 5xx, «unconfirmed», «internal_error», «auth_unavailable», cuerpo ilegible...: resultado desconocido.
      return unconfirmed(body && typeof body.message === 'string' ? body.message : null);
    }

    function startClaim(session, u) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var rec = { uid: u, epoch: epoch, controller: controller, promise: null };
      pending = rec;
      rec.promise = claim(session, u, rec.epoch, controller).then(
        function (r) { if (pending === rec) pending = null; return r; },
        function () { if (pending === rec) pending = null; return { done: false }; });
      return rec.promise;
    }

    async function run(reason) {
      var startEpoch = epoch;
      var session = null;
      try { session = await deps.getSession(); } catch (e) { session = null; }
      // Si mientras se leía la sesión hubo un cierre de sesión o un cambio de cuenta, esta lectura puede ser de la cuenta anterior: la descarta
      // (el evento de la sesión nueva lanza su propia comprobación).
      if (epoch !== startEpoch) return { skipped: 'superseded' };
      if (!isSession(session)) {
        invalidate();
        if (state.phase !== 'idle') setState({ phase: 'idle' });
        return { skipped: 'no_session' };
      }
      var u = session.user.id;
      if (uid && uid !== u) { invalidate(); setState({ phase: 'idle' }); }   // cambio de cuenta: nada de la anterior (y se cancela su petición)
      uid = u;

      if (reason !== 'manual') {
        if (hiddenUntil > now()) return { skipped: 'hidden' };
        // Ya hay un resultado definitivo para ESTA cuenta y TODAVÍA vale (no ha llegado el reinicio del servidor): no se vuelve a preguntar.
        if (isDone(u)) return { skipped: 'done' };
        if (reason === 'wake' && lastClaimAt && now() - lastClaimAt < WAKE_MIN_INTERVAL_MS) return { skipped: 'recent' };
        var c = readCache(u);
        if (c) {
          if (c.status === 'plus_required') { setState({ phase: 'plus_required' }); return { skipped: 'cached' }; }
          doneUid = u; doneUntil = c.until;
          setState({ phase: c.status, amount: c.amount, claimDay: c.claim_day, nextResetAt: c.next_reset_at, fresh: false });
          scheduleExpiry(c.until);
          return { skipped: 'cached' };
        }
      }
      if (pending && pending.uid === u) return pending.promise;    // una sola petición por cuenta
      return startClaim(session, u);
    }

    // reason: 'load' | 'auth' | 'wake' | 'expire' | 'auto-retry' (respetan caché y pausas) | 'manual' (botón «Reintentar»: pregunta de nuevo ya)
    function ensure(reason) {
      try {
        if (!enabled) return Promise.resolve({ skipped: 'disabled' });
        if (reason === 'manual') { cancelRetry(); attempts = 0; }
        return run(reason || 'load').then(function (r) { return r; }, function () { return { done: false }; });
      } catch (e) {
        return Promise.resolve({ skipped: 'error' });
      }
    }

    return {
      isEnabled: function () { return enabled; },
      ensure: ensure,
      retry: function () { return ensure('manual'); },
      state: function () { return copy(); },
      // El oyente recibe el estado actual de inmediato y cada cambio posterior (la tarjeta puede cargarse antes o después que este archivo).
      subscribe: function (fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        try { fn(copy()); } catch (e) { /* ignorar */ }
        return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
      },
      // Cierre de sesión: se invalida todo lo de la cuenta (incluida su petición en vuelo). La caché por cuenta en localStorage se queda con la
      // caducidad que dio el servidor.
      reset: function () { invalidate(); if (state.phase !== 'idle') setState({ phase: 'idle' }); },
    };
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); })]);
  }

  // Construcción automática en el navegador (solo si el interruptor es exactamente true).
  function auto(win) {
    try {
      var on = !!win && win.GEOARMY_PLUS_DAILY_ENABLED === true;
      if (!on || !win.GEOARMY_SUPABASE_URL || !win.GEOARMY_SUPABASE_ANON_KEY || typeof win.fetch !== 'function') return create({ enabled: false });
      var storage = null;
      try { storage = win.localStorage; } catch (e) { storage = null; }
      var ownClient = null;
      var clientOf = function () {
        if (win.GeoArmyAccount && win.GeoArmyAccount.client) return win.GeoArmyAccount.client;   // misma instancia/sesión que la barra de cuenta
        if (!ownClient && win.supabase && win.supabase.createClient) ownClient = win.supabase.createClient(win.GEOARMY_SUPABASE_URL, win.GEOARMY_SUPABASE_ANON_KEY);
        return ownClient;
      };
      var api = create({
        enabled: true,
        endpoint: String(win.GEOARMY_SUPABASE_URL).replace(/\/+$/, '') + '/functions/v1/plus-daily-gcoin-claim',
        anonKey: win.GEOARMY_SUPABASE_ANON_KEY,
        fetch: function (url, init) { return win.fetch(url, init); },
        storage: storage,
        getSession: function () {
          var c = clientOf();
          if (!c) return Promise.resolve(null);
          return withTimeout(c.auth.getSession(), 8000).then(function (r) { return r && r.data && r.data.session; });
        },
        emit: function (snap) {
          try { if (typeof win.CustomEvent === 'function' && win.document) win.document.dispatchEvent(new win.CustomEvent('geoarmy:plus-daily-claim', { detail: snap })); } catch (e) { /* ignorar */ }
        },
        // Tras acreditar, la barra vuelve a pedir el saldo con su propio mecanismo (no se inventa ni se suma nada aquí).
        onGranted: function () { try { if (win.GeoArmyAccount && typeof win.GeoArmyAccount.refreshWidget === 'function') win.GeoArmyAccount.refreshWidget(); } catch (e) { /* ignorar */ } },
      });
      var start = function () {
        api.ensure('load');
        try {
          var c = clientOf();
          if (c && c.auth && typeof c.auth.onAuthStateChange === 'function') {
            c.auth.onAuthStateChange(function (event) {
              // Cerrar sesión se procesa YA (invalida la petición en vuelo; no llama al SDK). Iniciar sesión, fuera del callback de Supabase.
              if (event === 'SIGNED_OUT') { api.reset(); return; }
              if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(function () { api.ensure('auth'); }, 0);
            });
          }
        } catch (e) { /* ignorar */ }
        // Pestaña dormida o en segundo plano: al volver, si ya pasó el reinicio, comprueba el día nuevo (sin recargar).
        try {
          if (win.document && typeof win.document.addEventListener === 'function') {
            win.document.addEventListener('visibilitychange', function () { if (win.document.visibilityState === 'visible') api.ensure('wake'); });
          }
          if (typeof win.addEventListener === 'function') win.addEventListener('focus', function () { api.ensure('wake'); });
        } catch (e) { /* ignorar */ }
      };
      if (win.document && win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', start);
      else start();
      return api;
    } catch (e) {
      return create({ enabled: false });
    }
  }

  return { create: create, auto: auto };
});
