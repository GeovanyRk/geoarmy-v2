/* ============================================================================
   GEO ARMY Plus · proveedor real de las piñatas (window.GEOARMY_PINATA_PROVIDER) — BORRADOR LOCAL, NO CONECTADO A NINGUNA PÁGINA PUBLICADA.
   Habla con la Edge Function `plus-pinata` (acciones status / attempt / lookup).
   REGLAS:
   · La CUENTA sale SIEMPRE de la sesión autenticada (token de acceso de Supabase Auth). Este proveedor NO envía perfil ni cuenta en el cuerpo, y nada de lo que
     reciba la página puede cambiarla: el servidor deduce la cuenta del token. El `account_id` de la respuesta viene del servidor (del token).
   · Cambio de cuenta: se detecta por los eventos de Auth y se emite `ga-pinata-account-changed`. Además, TODA respuesta se descarta si, al volver, la
     sesión ya es de otra cuenta, o si el `account_id` devuelto no es el de la sesión con la que se pidió (nunca se muestra algo de una cuenta en otra).
   · Un fallo de red, un timeout o un 5xx en attempt() NO demuestran que no se haya procesado: se devuelve {status:'unconfirmed'} (NO definitivo) y la página conserva el
     request_id pendiente y lo recupera con lookup(); reintentar el mismo id nunca cobra ni acredita dos veces.
   Uso (sin dependencias; la página solo necesita este archivo antes de su propio script):
     GeoarmyPinataProvider.install({ endpoint, anonKey, getSession, onAuthChange })
       endpoint     URL de la función, p. ej. https://<proyecto>.supabase.co/functions/v1/plus-pinata
       anonKey      clave PÚBLICA (publishable) del proyecto: solo va como cabecera apikey
       getSession   async () => ({ access_token, user:{ id } }) | null          (típicamente supabase.auth.getSession())
       onAuthChange (callback) => unsubscribe                                   (típicamente supabase.auth.onAuthStateChange)
   ============================================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GeoarmyPinataProvider = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function createPinataProvider(opts) {
    opts = opts || {};
    var win = opts.win || (typeof window !== 'undefined' ? window : null);
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : undefined) : null);
    var timeoutMs = opts.timeoutMs || 12000;
    var getSession = opts.getSession, curUid = null, started = false;

    function uidOf(s) { return s && s.user && typeof s.user.id === 'string' ? s.user.id.toLowerCase() : null; }
    function emitChange() { if (win && typeof win.dispatchEvent === 'function') { try { win.dispatchEvent(new win.Event('ga-pinata-account-changed')); } catch (e) { /* sin DOM */ } } }
    function noteSession(s) { var u = uidOf(s); if (u !== curUid) { curUid = u; if (started) emitChange(); } }
    // Arranque: toma la cuenta actual SIN emitir evento (la página ya hace su primer status()), y escucha los cambios de Auth.
    var ready = Promise.resolve().then(function () { return getSession(); }).then(function (s) { curUid = uidOf(s); started = true; }, function () { started = true; });
    if (typeof opts.onAuthChange === 'function') opts.onAuthChange(function (_event, session) { noteSession(session); });

    function call(body, session) {
      if (!doFetch) return Promise.reject(new Error('no_fetch'));
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs);
      return doFetch(opts.endpoint, {
        method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: opts.anonKey || '' },
        body: JSON.stringify(body),            // SOLO action, pinata, request_id, max_cost: nunca cuenta ni perfil
      }).then(function (res) { clearTimeout(timer); return res.json().then(function (j) { return { http: res.status, body: j || {} }; }, function () { return { http: res.status, body: {} }; }); },
              function (e) { clearTimeout(timer); throw e; });
    }

    // Ejecuta una acción con la sesión VIGENTE y descarta la respuesta si la cuenta cambió mientras tanto. `shape(out, uid)` traduce al contrato de la página.
    function run(body, fallbacks, shape) {
      return ready.then(function () { return getSession(); }).then(function (s) {
        noteSession(s);
        var uid = uidOf(s);
        if (!uid || !s.access_token) return fallbacks.noSession();
        return call(body, s).then(function (out) {
          return getSession().then(function (s2) {
            if (uidOf(s2) !== uid) return fallbacks.stale();                            // la cuenta cambió mientras la petición iba y volvía: se descarta
            var b = out.body || {};
            if (b.state && typeof b.state === 'object' && b.state.account_id && String(b.state.account_id).toLowerCase() !== uid) return fallbacks.stale();
            if (b.account_id && String(b.account_id).toLowerCase() !== uid) return fallbacks.stale();   // el servidor contestó por OTRA cuenta: jamás se muestra
            return shape(out, uid);
          });
        }, function () { return fallbacks.network(); });
      });
    }

    var provider = {
      status: function (pinata) {
        return run({ action: 'status', pinata: pinata },
          { noSession: function () { return { state: 'no_session', account_id: null, prizes: [] }; }, stale: function () { return { state: 'no_session', account_id: null, prizes: [], stale: true }; }, network: function () { return Promise.reject(new Error('network')); } },
          function (out, uid) {
            var b = out.body;
            if (out.http === 401) return { state: 'no_session', account_id: null, prizes: [] };
            if (out.http === 403 && b.status === 'disabled') return { state: 'disabled', account_id: uid, prizes: [] };
            if (out.http === 200 && b.ok && b.state) return { state: b.state, account_id: uid, free_left: b.free_left, free_total: b.free_total, cost: b.cost, balance: b.balance, next_reset_at: b.next_reset_at, last_attempt: b.last_attempt, prizes: b.prizes || [] };
            if (out.http === 429) return Promise.reject(new Error('rate_limited'));
            return Promise.reject(new Error('status_failed'));       // la página muestra «No pudimos cargar el estado»
          });
      },
      attempt: function (pinata, requestId, maxCost) {
        if (typeof requestId !== 'string' || !UUID.test(requestId) || (maxCost !== 0 && maxCost !== 5)) return Promise.resolve({ status: 'error', error: 'bad_args' });
        return run({ action: 'attempt', pinata: pinata, request_id: requestId, max_cost: maxCost },
          { noSession: function () { return { status: 'error', error: 'no_session' }; }, stale: function () { return { status: 'error', error: 'account_changed' }; }, network: function () { return { status: 'unconfirmed', error: 'network' }; } },
          function (out, uid) {
            var b = out.body;
            if (out.http === 401) return { status: 'error', error: 'unauthenticated' };
            if (out.http === 429) return { status: 'rate_limited' };
            if (out.http === 403 && b.status === 'disabled') return { status: 'disabled' };
            if (out.http === 503 || out.http >= 500 || b.status === 'unconfirmed') return { status: 'unconfirmed' };   // resultado DESCONOCIDO (la base pudo haberlo procesado): NO definitivo; la página conserva el id y lo recupera con lookup()
            if (out.http !== 200 || typeof b.status !== 'string') return { status: 'error', error: 'bad_response' };
            var r = { status: b.status, attempt_id: b.attempt_id, outcome: b.outcome, prize_code: b.prize_code, paid: b.paid, cost: b.cost, authorized_cost: b.authorized_cost, credit: b.credit || null, required_cost: b.required_cost };
            // (rev. 7) CONSERVADOR: en las respuestas «sin intento» SOLO request_state 'none' (la base GUARDÓ una decisión definitiva bajo su bloqueo: ni siquiera una petición anterior con ese id que llegue tarde
            // podrá procesarse) permite descartar el id. Cualquier otra cosa —incluida la ausencia del campo (base antigua)— es 'unknown' y el id se conserva. credit_failed nunca es definitivo.
            if (b.status === 'paused' || b.status === 'closed' || b.status === 'confirm_required' || b.status === 'insufficient_funds') { r.request_state = b.request_state === 'none' ? 'none' : 'unknown'; }
            if (b.status === 'credit_failed') { r.request_state = 'unknown'; }
            if (b.state) { r.state = Object.assign({}, b.state, { account_id: uid }); }
            return r;
          });
      },
      lookup: function (pinata, requestId) {
        if (typeof requestId !== 'string' || !UUID.test(requestId)) return Promise.resolve({ status: 'error', error: 'bad_args' });
        return run({ action: 'lookup', pinata: pinata, request_id: requestId },
          { noSession: function () { return { status: 'error', error: 'no_session' }; }, stale: function () { return { status: 'error', error: 'account_changed' }; }, network: function () { return { status: 'error', error: 'network' }; } },
          function (out, uid) {
            var b = out.body;
            if (out.http === 200 && b.status === 'decided' && typeof b.decision === 'string') { var d = { status: 'decided', decision: b.decision }; if (b.state) d.state = Object.assign({}, b.state, { account_id: uid }); return d; }   // (rev. 7) decisión guardada: ese id no tiene intento ni lo tendrá
            if (out.http === 200 && (b.status === 'found' || b.status === 'not_found')) { var r = { status: b.status, attempt_id: b.attempt_id, outcome: b.outcome, prize_code: b.prize_code, paid: b.paid, cost: b.cost, authorized_cost: b.authorized_cost, credit: b.credit || null }; if (b.state) r.state = Object.assign({}, b.state, { account_id: uid }); return r; }
            return { status: 'error', error: 'lookup_failed' };
          });
      },
    };
    return provider;
  }

  function install(opts) {
    var w = opts && opts.win || (typeof window !== 'undefined' ? window : null);
    var p = createPinataProvider(opts); if (w) w.GEOARMY_PINATA_PROVIDER = p; return p;
  }
  return { createPinataProvider: createPinataProvider, install: install };
});
