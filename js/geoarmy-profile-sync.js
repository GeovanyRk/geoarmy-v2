/* ===== MI GEO ARMY — sincronización automática del perfil de Twitch (cliente) =====
 *
 * Qué hace: de vez en cuando le pide al servidor (Edge Function
 * `sync-twitch-profile`) que actualice twitch_login, display_name y avatar_url
 * del perfil de la persona con sesión abierta. El servidor decide TODO:
 *   - quién es la persona (verifica la sesión de Supabase),
 *   - si ya toca sincronizar (mínimo 24 h desde la última sincronización exitosa),
 *   - si hay otra sincronización en curso, y cuánto esperar tras un fallo.
 * Este archivo NO manda nombre, login, avatar ni IDs: el cuerpo va vacío y solo
 * viaja el token de sesión de Supabase (nunca el provider_token de Twitch).
 *
 * El control local (memoria + localStorage) es solo una optimización para no
 * llamar de más; NO es la protección. Si falla o se borra, el servidor sigue
 * aplicando los límites.
 *
 * Nunca bloquea nada: sin await en el flujo de inicio de sesión, y cualquier
 * error se traga con una espera local antes del siguiente intento.
 *
 * Tiempos y garantías (honestos):
 *   - La función DEJA DE ESPERAR y responde en ≤ 49 s (plazos por paso). Eso NO garantiza
 *     que una operación de Postgres ya iniciada haya terminado: puede seguir ejecutándose y
 *     confirmar después. El navegador espera 60 s por la respuesta.
 *   - Si el resultado es INCIERTO (timeout, red, 5xx, JSON roto), no se supone nada sobre
 *     cuándo termina la base. Antes de llamar se guarda una "huella" del perfil (login,
 *     nombre y avatar) y, tras el fallo, se vuelve a leer el perfil en sondeos acotados
 *     (51 s, 2 min, 5 min y 15 min desde el inicio). Si la huella cambió, se avisa UNA vez a la
 *     interfaz y se termina; si no cambió, no se avisa. Pasado el último sondeo se deja de
 *     mirar: el dato correcto aparecerá en la siguiente carga o render de la página.
 *   - Cada sondeo comprueba que la cuenta con sesión AHORA sea la de la operación.
 *
 * Cuenta: antes de avisar a la interfaz se comprueba que la cuenta con sesión AHORA
 * sea la de la operación terminada. Si hubo cierre de sesión o cambio de cuenta, no
 * se avisa y nada de la cuenta anterior se muestra.
 *
 * Apagado por defecto: solo actúa si js/geoarmy-config.js trae
 * window.GEOARMY_PROFILE_SYNC_ENABLED = true.
 *
 * Eventos: al aplicarse un cambio real, se llama a GeoArmyAccount.refreshWidget()
 * y se dispara document 'geoarmy:profile-synced' ({ detail: { uid } }).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) {
    root.GeoArmyProfileSyncKit = api;
    api.bootstrap(root);
  }
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var MIN_WAIT_S = 30;          // nunca se vuelve a llamar antes de esto
  var MAX_WAIT_S = 86400;
  var FAIL_WAIT_S = 900;        // error de red / 5xx / respuesta rara: 15 min
  var AUTH_FAIL_WAIT_S = 300;   // 401: la sesión puede estar renovándose
  var CLAIM_TTL_MS = 30000;     // marca "otra pestaña ya está llamando"
  // Peor caso del servidor en UNA petición (espejo de WORST_CASE_MS en handler.js):
  // Auth 5 s + begin 8 s + Twitch 4 x 5 s + complete 8 s + fail 8 s = 49 s.
  var SERVER_WORST_CASE_MS = 49000;
  // El navegador espera MÁS que el peor caso del servidor, para no abandonar una
  // respuesta válida que todavía puede llegar.
  var DEFAULT_TIMEOUT_MS = 60000;
  // Primer sondeo = peor caso de espera del servidor + 2 s. Es solo "la primera mirada":
  // NO se afirma que la base haya terminado para entonces.
  var RECOVERY_MARGIN_MS = 2000;
  // Sondeos de recuperación, en ms desde el inicio de la petición (acotados y finitos).
  var PROBE_OFFSETS_MS = [SERVER_WORST_CASE_MS + RECOVERY_MARGIN_MS, 120000, 300000, 900000];
  var READ_TIMEOUT_MS = 5000;   // tope de cada lectura del perfil (huella / sondeo)
  var STORAGE_PREFIX = 'geoarmy_profile_sync_v1:';

  function clampWait(value, fallback) {
    // Solo números reales: null, '', booleanos o texto NO se convierten en 0.
    if (typeof value !== 'number' || !isFinite(value)) return fallback;
    return Math.min(MAX_WAIT_S, Math.max(MIN_WAIT_S, Math.ceil(value)));
  }

  function validPending(p) {
    if (!p || typeof p !== 'object' || !isFinite(p.started)) return null;
    var step = Math.floor(Number(p.step) || 0);
    if (step < 0 || step >= PROBE_OFFSETS_MS.length) return null;
    return { started: Number(p.started), baseline: typeof p.baseline === 'string' ? p.baseline : null, step: step };
  }

  function probeDue(p) { return p.started + PROBE_OFFSETS_MS[p.step]; }

  function createProfileSync(deps) {
    deps = deps || {};
    var enabled = deps.enabled === true;
    var mem = {};         // uid -> { next, claim, pending }
    var flights = {};     // uid -> promesa: una sola llamada a la vez POR CUENTA en esta pestaña
    var timers = {};      // uid -> temporizador del siguiente sondeo
    var probing = {};     // uid -> sondeo en curso
    var pageStart = (deps.now ? deps.now() : Date.now());

    function now() { return deps.now ? deps.now() : Date.now(); }

    function readState(uid) {
      var s = mem[uid] || { next: 0, claim: 0, pending: null };
      if (deps.storage) {
        try {
          var raw = deps.storage.getItem(STORAGE_PREFIX + uid);
          if (raw) {
            var o = JSON.parse(raw);
            if (o && typeof o === 'object') {
              s = {
                next: Math.max(s.next, Number(o.next) || 0),
                claim: Math.max(s.claim, Number(o.claim) || 0),
                pending: validPending(o.pending) || s.pending
              };
            }
          }
        } catch (e) { /* sin almacenamiento: queda la memoria */ }
      }
      return s;
    }

    function writeState(uid, s) {
      mem[uid] = s;
      if (deps.storage) {
        try { deps.storage.setItem(STORAGE_PREFIX + uid, JSON.stringify(s)); } catch (e) { /* ignorar */ }
      }
    }

    // ¿Quién tiene la sesión AHORA? (no quién la tenía cuando empezó la operación)
    function currentUid() {
      var get = deps.getCurrentSession || deps.getSession;
      if (typeof get !== 'function') return Promise.resolve(null);
      try {
        return Promise.resolve(get()).then(function (s) {
          return s && s.user && s.user.id ? String(s.user.id) : null;
        }, function () { return null; });
      } catch (e) { return Promise.resolve(null); }
    }

    // Único camino hacia la interfaz: solo avisa si la cuenta actual es la de la operación
    // terminada. Si no se puede saber quién es la cuenta actual, NO avisa.
    function notifyIfCurrent(uid) {
      if (typeof deps.onChanged !== 'function') return Promise.resolve(false);
      return currentUid().then(function (cur) {
        if (cur !== uid) return false;
        try { deps.onChanged({ uid: uid }); } catch (e) { /* una falla visual no afecta nada más */ }
        return true;
      });
    }

    // Respuesta definitiva del servidor (200 válido, 401, 4xx): no hay nada que recuperar.
    function settle(uid, waitSeconds, result) {
      writeState(uid, { next: now() + waitSeconds * 1000, claim: 0, pending: null });
      return result;
    }

    // Resultado incierto (timeout, red, 5xx, JSON roto): el servidor PUDO terminar de aplicar
    // el cambio aunque aquí no llegó la respuesta. Se deja una marca y se vuelve a leer el
    // perfil cuando el servidor ya no puede seguir trabajando en esa petición.
    function settleUncertain(uid, waitSeconds, result) {
      var st = readState(uid);
      writeState(uid, { next: now() + waitSeconds * 1000, claim: 0, pending: st.pending });
      var rec = scheduleRecovery(uid);
      return rec ? rec.then(function () { return result; }) : result;
    }

    // Huella del perfil (string) o null si no se pudo leer (sin lector, error o plazo vencido).
    function readFingerprint(uid) {
      if (typeof deps.readProfile !== 'function') return Promise.resolve(null);
      return new Promise(function (resolve) {
        var done = false;
        var tm = setTimeout(function () { if (!done) { done = true; resolve(null); } }, READ_TIMEOUT_MS);
        if (tm && typeof tm.unref === 'function') tm.unref();
        function end(v) { if (!done) { done = true; clearTimeout(tm); resolve(typeof v === 'string' ? v : null); } }
        try { Promise.resolve(deps.readProfile(uid)).then(end, function () { end(null); }); } catch (e) { end(null); }
      });
    }

    function scheduleRecovery(uid) {
      var p = readState(uid).pending;
      if (!p) return null;
      var wait = probeDue(p) - now();
      if (wait <= 0) return runProbe(uid);
      if (!timers[uid]) {
        var schedule = deps.schedule || function (fn, ms) { return setTimeout(fn, ms); };
        var h = schedule(function () { delete timers[uid]; runProbe(uid); }, wait);
        if (h && typeof h.unref === 'function') h.unref();
        timers[uid] = h;
      }
      return null;
    }

    // Un sondeo: relee el perfil y lo compara con la huella de ANTES de la llamada.
    // Avisa solo si cambió (una vez) y solo si la cuenta actual es la de la operación.
    function runProbe(uid) {
      if (probing[uid]) return probing[uid];
      var p0 = readState(uid).pending;
      if (!p0) return Promise.resolve(false);
      var canRead = typeof deps.readProfile === 'function';
      var pr = currentUid().then(function (cur) {
        if (cur !== uid) return { skip: true };   // otra cuenta: ni se lee ni se avisa
        if (!canRead) return { fp: null };
        return readFingerprint(uid).then(function (fp) { return { fp: fp }; });
      }).then(function (r) {
        var st = readState(uid), q = st.pending;
        if (!q || q.started !== p0.started) return false;   // otra operación tomó el relevo
        var last = p0.step >= PROBE_OFFSETS_MS.length - 1;
        var notify = false;
        if (!r.skip) {
          if (!canRead || (r.fp !== null && q.baseline === null)) {
            // Sin huella de referencia: un solo refresco conservador si esta página pudo mostrar datos viejos.
            notify = pageStart < probeDue(q);
            last = true;
          } else if (r.fp !== null && r.fp !== q.baseline) {
            notify = true;   // el perfil SÍ cambió (p. ej. un complete tardío)
            last = true;
          }
        }
        if (last) {
          writeState(uid, { next: st.next, claim: st.claim, pending: null });
        } else {
          writeState(uid, { next: st.next, claim: st.claim, pending: { started: q.started, baseline: q.baseline, step: p0.step + 1 } });
          scheduleRecovery(uid);
        }
        return notify ? notifyIfCurrent(uid) : false;
      });
      probing[uid] = pr;
      var clear = function () { if (probing[uid] === pr) delete probing[uid]; };
      pr.then(clear, clear);
      return pr;
    }

    function finish(uid, httpStatus, body) {
      if (httpStatus === 200 && body && typeof body === 'object') {
        var wait = clampWait(body.next_check_seconds, FAIL_WAIT_S);
        var changed = body.ok === true && body.changed === true;
        // La espera se fija ANTES de avisar, para que el re-render que sigue no vuelva a llamar.
        var result = settle(uid, wait, { status: String(body.status || 'unknown'), changed: changed, uid: uid, notified: false });
        if (!changed) return result;
        return notifyIfCurrent(uid).then(function (ok) { result.notified = ok; return result; });
      }
      if (httpStatus === 401) return settle(uid, AUTH_FAIL_WAIT_S, { status: 'unauthenticated', changed: false, uid: uid });
      if (httpStatus >= 500 || httpStatus === 200) return settleUncertain(uid, FAIL_WAIT_S, { status: 'error', changed: false, uid: uid });
      return settle(uid, FAIL_WAIT_S, { status: 'error', changed: false, uid: uid });
    }

    function call(uid, session) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); }, deps.timeoutMs || DEFAULT_TIMEOUT_MS);
      var request;
      try {
        request = deps.fetch(deps.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + session.access_token,
            'apikey': deps.anonKey,
            'Content-Type': 'application/json'
          },
          body: '{}',
          signal: controller ? controller.signal : undefined
        });
      } catch (e) {
        clearTimeout(timer);
        return Promise.resolve(settleUncertain(uid, FAIL_WAIT_S, { status: 'error', changed: false, uid: uid }));
      }
      return Promise.resolve(request).then(function (res) {
        return Promise.resolve(res.json()).then(function (b) { return b; }, function () { return null; })
          .then(function (body) { clearTimeout(timer); return finish(uid, res.status, body); });
      }, function () {
        clearTimeout(timer);
        return settleUncertain(uid, FAIL_WAIT_S, { status: 'error', changed: false, uid: uid });
      });
    }

    function start(uid, session) {
      var t = now();
      var st = readState(uid);
      // Una marca pendiente (de esta página o de una anterior) se atiende antes que nada.
      scheduleRecovery(uid);
      st = readState(uid);
      if (st.next > t) return { status: 'wait', changed: false, uid: uid };
      if (st.claim && t - st.claim < CLAIM_TTL_MS) return { status: 'other_tab', changed: false, uid: uid };
      writeState(uid, { next: st.next, claim: t, pending: { started: t, baseline: null, step: 0 } });
      if (typeof deps.readProfile !== 'function') return call(uid, session);
      // Huella de referencia ANTES de llamar (acotada a 5 s; si falla, se sigue sin ella).
      return readFingerprint(uid).then(function (fp) {
        var cur = readState(uid);
        if (cur.pending && cur.pending.started === t) {
          writeState(uid, { next: cur.next, claim: cur.claim, pending: { started: t, baseline: fp, step: 0 } });
        }
        return call(uid, session);
      });
    }

    function resolveSession(sessionHint) {
      return sessionHint ? Promise.resolve(sessionHint) : Promise.resolve(deps.getSession ? deps.getSession() : null);
    }

    // ensure() nunca rechaza y nunca lanza: es seguro llamarla sin esperar.
    // Una llamada en curso por cuenta: dos cuentas distintas no se estorban ni se mezclan.
    function ensure(reason, sessionHint) {
      if (!enabled) return Promise.resolve({ status: 'disabled', changed: false });
      var p;
      try {
        p = resolveSession(sessionHint).then(function (session) {
          if (!session || !session.access_token || !session.user || !session.user.id) return { status: 'no_session', changed: false };
          var uid = String(session.user.id);
          if (flights[uid]) return flights[uid];
          var f;
          try { f = Promise.resolve(start(uid, session)); } catch (e) { f = Promise.resolve({ status: 'error', changed: false, uid: uid }); }
          f = f.then(function (r) { return r; }, function () { return { status: 'error', changed: false, uid: uid }; });
          flights[uid] = f;
          var clear = function () { if (flights[uid] === f) delete flights[uid]; };
          f.then(clear, clear);
          return f;
        });
      } catch (e) {
        return Promise.resolve({ status: 'error', changed: false });
      }
      return p.then(function (r) { return r; }, function () { return { status: 'error', changed: false }; });
    }

    function reset(uid) {
      if (uid) {
        delete mem[uid];
        delete timers[uid];
        delete probing[uid];
        if (deps.storage) { try { deps.storage.removeItem(STORAGE_PREFIX + uid); } catch (e) { /* ignorar */ } }
      } else {
        mem = {};
        timers = {};
        probing = {};
      }
    }

    return { ensure: ensure, reset: reset, isEnabled: function () { return enabled; } };
  }

  // Cableado real en el navegador (se omite en pruebas de Node).
  function bootstrap(win) {
    try {
      if (!win || !win.document || win.GeoArmyProfileSync) return;
      if (win.GEOARMY_PROFILE_SYNC_ENABLED !== true) return;
      var acc = win.GeoArmyAccount;
      if (!acc || !acc.client || !win.GEOARMY_SUPABASE_URL || !win.GEOARMY_SUPABASE_ANON_KEY) return;

      var storage = null;
      try { storage = win.localStorage; } catch (e) { storage = null; }

      var sync = createProfileSync({
        enabled: true,
        endpoint: String(win.GEOARMY_SUPABASE_URL).replace(/\/+$/, '') + '/functions/v1/sync-twitch-profile',
        anonKey: win.GEOARMY_SUPABASE_ANON_KEY,
        storage: storage,
        fetch: function (url, init) { return win.fetch(url, init); },
        getSession: function () {
          return acc.client.auth.getSession().then(function (r) {
            return (r && r.data && r.data.session) || null;
          }, function () { return null; });
        },
        schedule: function (fn, ms) { return win.setTimeout(fn, ms); },
        // Lectura del propio perfil (misma lectura que ya usa el widget) para la huella de recuperación.
        readProfile: function (uid) {
          return acc.client.from('profiles').select('twitch_login,display_name,avatar_url').eq('id', uid).maybeSingle().then(function (r) {
            var d = r && r.data;
            if (!d) return null;
            return JSON.stringify([d.twitch_login || null, d.display_name || null, d.avatar_url || null]);
          }, function () { return null; });
        },
        onChanged: function (info) {
          try { if (typeof acc.refreshWidget === 'function') acc.refreshWidget(); } catch (e) { /* ignorar */ }
          try {
            win.document.dispatchEvent(new win.CustomEvent('geoarmy:profile-synced', { detail: { uid: info.uid } }));
          } catch (e) { /* ignorar */ }
        }
      });
      win.GeoArmyProfileSync = sync;

      // Volver a la pestaña / regresar desde el historial: se vuelve a comprobar
      // (el servidor decide si ya pasaron 24 h).
      win.document.addEventListener('visibilitychange', function () {
        if (!win.document.hidden) sync.ensure('visible');
      });
      win.addEventListener('pageshow', function (e) {
        if (e && e.persisted) sync.ensure('pageshow');
      });

      // Primera comprobación al cargar, sin competir con el render inicial.
      var delay = typeof win.GEOARMY_PROFILE_SYNC_START_DELAY_MS === 'number' ? win.GEOARMY_PROFILE_SYNC_START_DELAY_MS : 1500;
      setTimeout(function () { sync.ensure('load'); }, delay);
    } catch (e) {
      /* la sincronización jamás debe romper la página */
    }
  }

  return { createProfileSync: createProfileSync, bootstrap: bootstrap, _const: { MIN_WAIT_S: MIN_WAIT_S, MAX_WAIT_S: MAX_WAIT_S, FAIL_WAIT_S: FAIL_WAIT_S, AUTH_FAIL_WAIT_S: AUTH_FAIL_WAIT_S, CLAIM_TTL_MS: CLAIM_TTL_MS, SERVER_WORST_CASE_MS: SERVER_WORST_CASE_MS, DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS, RECOVERY_MARGIN_MS: RECOVERY_MARGIN_MS, PROBE_OFFSETS_MS: PROBE_OFFSETS_MS } };
}));
