/* ============================================================================
   GEO ARMY Plus — autorización de Twitch del BROADCASTER (MODO SOMBRA, no conectado).
   ----------------------------------------------------------------------------
   Lo usa SOLO plus-autorizacion.html. Ninguna otra página lo carga.
   Qué hace:
     1) Al pulsar el botón, pide al servidor (con la sesión del usuario, sin cuerpo) la URL de autorización y navega a ella.
     2) Al volver de Twitch, el servidor redirige a esta página con ?r=<resultado>: se muestra un mensaje fijo
        y se BORRA ?r de la barra de direcciones (history.replaceState).
   Qué NO hace:
     - No ve, no recibe y no muestra tokens, códigos ni "state" (el code y el state solo viajan Twitch → servidor).
     - No muestra la URL de autorización: solo navega a ella, y SOLO si empieza por https://id.twitch.tv/oauth2/authorize?
     - No usa innerHTML: todo el texto sale de una lista cerrada y se inserta con textContent.
   ============================================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GeoArmyPlusAuthorizeFactory = api.create;
  root.GeoArmyPlusAuthorize = api.auto(root);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var AUTHORIZE_PREFIX = 'https://id.twitch.tv/oauth2/authorize?';
  var TIMEOUT_MS = 20000;

  // Lista CERRADA de mensajes. Cualquier otro valor de ?r se trata como 'state'.
  var RESULTS = {
    ok: { tone: 'ok', text: 'Listo: la cuenta de Twitch quedó autorizada. Puedes cerrar esta página.' },
    denied: { tone: 'warn', text: 'Cancelaste la autorización en Twitch. No se guardó nada.' },
    state: { tone: 'warn', text: 'El enlace de autorización venció, ya se usó o no es válido. Vuelve a empezar desde el botón.' },
    config: { tone: 'error', text: 'La configuración cambió mientras autorizabas. No se guardó nada; vuelve a empezar.' },
    code: { tone: 'error', text: 'Twitch rechazó el código de autorización. No se guardó nada; vuelve a empezar.' },
    twitch_error: { tone: 'error', text: 'Twitch no respondió como se esperaba. No se guardó nada; inténtalo más tarde.' },
    wrong_app: { tone: 'error', text: 'La autorización pertenece a otra aplicación de Twitch. No se guardó nada.' },
    wrong_account: { tone: 'error', text: 'Autorizaste con otra cuenta de Twitch. Entra con la cuenta del broadcaster y vuelve a empezar.' },
    missing_scope: { tone: 'error', text: 'Faltó el permiso requerido. Acepta todo lo que pide Twitch y vuelve a empezar.' },
    unexpected_scopes: { tone: 'error', text: 'La autorización incluía permisos de más. No se guardó nada.' },
    store_failed: { tone: 'error', text: 'No se pudo confirmar el guardado. Revisa el estado antes de repetir (ver AUTORIZACION_TWITCH.md).' },
  };
  var START_ERRORS = {
    unauthenticated: 'Tu sesión no es válida. Inicia sesión en el sitio y vuelve a intentar.',
    not_broadcaster: 'Esta sesión no es la cuenta del broadcaster. Entra con la cuenta correcta.',
    disabled: 'La autorización está apagada en el servidor.',
    server_misconfigured: 'El servidor no está configurado para autorizar.',
    origin_not_allowed: 'Esta página no está permitida para iniciar la autorización.',
    too_many: 'Hay demasiados intentos pendientes. Espera unos minutos.',
    auth_unavailable: 'No se pudo verificar la sesión. Inténtalo en un momento.',
    db_unavailable: 'El servidor no pudo registrar el intento. Inténtalo en un momento.',
  };
  var GENERIC = 'No se pudo iniciar la autorización. Inténtalo más tarde.';
  // Estado de la sesión al abrir la página (no muestra identidad ni datos de la sesión).
  var PREPARE = {
    ready: { tone: 'info', text: 'Sesión encontrada. Puedes autorizar con Twitch.' },
    no_session: { tone: 'warn', text: 'No hay una sesión iniciada. Inicia sesión en el sitio con la cuenta del canal y recarga esta página.' },
    no_config: { tone: 'error', text: 'Falta la configuración del sitio (js/geoarmy-config.js). No se puede autorizar.' },
    no_library: { tone: 'error', text: 'No se cargó la biblioteca de cuentas (lib/supabase.min.js). No se puede autorizar.' },
    session_error: { tone: 'error', text: 'No se pudo leer la sesión. Recarga la página.' },
  };

  function resultFor(code) { return Object.prototype.hasOwnProperty.call(RESULTS, code) ? RESULTS[code] : RESULTS.state; }

  function create(deps) {
    // deps: endpoint, anonKey, getSession() -> {access_token}|null, fetch, navigate(url), setMessage(tone,text), setBusy(bool),
    //       location ({search, pathname}), history ({replaceState})
    function say(tone, text) { try { deps.setMessage(tone, text); } catch (e) { /* ignorar */ } }
    function busy(v) { try { if (deps.setBusy) deps.setBusy(v); } catch (e) { /* ignorar */ } }
    var running = false;

    // Al cargar: muestra el resultado (si hay ?r) y limpia la dirección. Nunca lanza.
    function showReturn() {
      try {
        var params = new URLSearchParams(deps.location.search || '');
        if (!params.has('r')) return { shown: false };
        var r = resultFor(params.get('r'));
        say(r.tone, r.text);
        // Quita TODA la cadena de consulta: lo que no sea ?r tampoco debe quedar en el historial.
        try { deps.history.replaceState(null, '', deps.location.pathname); } catch (e) { /* ignorar */ }
        return { shown: true, tone: r.tone };
      } catch (e) { return { shown: false }; }
    }

    // Al cargar: ¿hay sesión? Solo LEE la sesión que ya guarda el sitio (no inicia sesión, no la crea, no llama a Twitch ni al servidor).
    // El botón solo se habilita si hay sesión. keepMessage: no pisa el mensaje de un resultado recién mostrado (?r=).
    async function prepare(opts) {
      var keep = !!(opts && opts.keepMessage);
      function done(reason, enabled) {
        try { if (deps.setEnabled) deps.setEnabled(!!enabled); } catch (e) { /* ignorar */ }
        var m = PREPARE[reason];
        if (!keep || reason !== 'ready') say(m.tone, m.text);
        return { ready: !!enabled, reason: reason };
      }
      if (!deps.endpoint || !deps.anonKey) return done('no_config', false);
      if (!deps.getSession) return done('no_library', false);
      var session = null;
      try { session = await deps.getSession(); } catch (e) { return done('session_error', false); }
      if (!session || typeof session.access_token !== 'string' || !session.access_token) return done('no_session', false);
      return done('ready', true);
    }

    async function start() {
      if (running) return { skipped: 'busy' };
      running = true; busy(true);
      var timer = null;
      try {
        var session = null;
        try { session = await deps.getSession(); } catch (e) { session = null; }
        if (!session || typeof session.access_token !== 'string' || !session.access_token) {
          say('error', START_ERRORS.unauthenticated); return { ok: false, status: 'unauthenticated' };
        }
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        timer = setTimeout(function () { if (controller) controller.abort(); }, deps.timeoutMs || TIMEOUT_MS);
        var res = await deps.fetch(deps.endpoint, {
          method: 'POST', // sin cuerpo a propósito: el servidor toma la identidad del JWT
          headers: { Authorization: 'Bearer ' + session.access_token, apikey: deps.anonKey },
          credentials: 'omit', referrerPolicy: 'no-referrer',
          signal: controller ? controller.signal : undefined,
        });
        var body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        if (res.ok && body && body.ok === true && body.status === 'ready' && typeof body.authorize_url === 'string' && body.authorize_url.indexOf(AUTHORIZE_PREFIX) === 0) {
          say('info', 'Redirigiendo a Twitch…');
          deps.navigate(body.authorize_url); // la URL no se muestra, no se registra y no se guarda
          return { ok: true, status: 'redirecting' };
        }
        var code = body && typeof body.status === 'string' ? body.status : '';
        say('error', Object.prototype.hasOwnProperty.call(START_ERRORS, code) ? START_ERRORS[code] : GENERIC);
        return { ok: false, status: Object.prototype.hasOwnProperty.call(START_ERRORS, code) ? code : 'error' };
      } catch (e) {
        say('error', GENERIC); return { ok: false, status: 'error' };
      } finally {
        if (timer) clearTimeout(timer);
        running = false; busy(false);
      }
    }
    return { start: start, showReturn: showReturn, prepare: prepare };
  }

  // Cableado del navegador. Reutiliza la infraestructura del sitio, sin crear otra sesión:
  //   - configuración: window.GEOARMY_SUPABASE_URL / GEOARMY_SUPABASE_ANON_KEY (js/geoarmy-config.js; valores públicos);
  //   - biblioteca: lib/supabase.min.js (copia fijada del sitio) → window.supabase.createClient;
  //   - cliente: el de la cuenta (window.GeoArmyAccount.client) si esta página lo cargó; si no, createClient(URL, KEY) con las
  //     opciones por defecto, EXACTAMENTE como hacen misiones.html y ranking.html. Con las opciones por defecto supabase-js lee la
  //     sesión que el sitio ya guardó en localStorage (misma clave); esta página nunca inicia sesión, nunca la guarda y nunca la muestra.
  function siteClient(root) {
    try {
      if (root.GeoArmyAccount && root.GeoArmyAccount.client) return { client: root.GeoArmyAccount.client };
      if (!root.supabase || !root.supabase.createClient) return { error: 'no_library' };
      if (!root.GEOARMY_SUPABASE_URL || !root.GEOARMY_SUPABASE_ANON_KEY || String(root.GEOARMY_SUPABASE_URL).indexOf('TU-PROYECTO') !== -1) return { error: 'no_config' };
      return { client: root.supabase.createClient(root.GEOARMY_SUPABASE_URL, root.GEOARMY_SUPABASE_ANON_KEY) };
    } catch (e) { return { error: 'no_library' }; }
  }

  function auto(root) {
    return {
      mount: function () {
        if (!root.document) return null;
        var doc = root.document;
        var msg = doc.getElementById('plus-auth-message');
        var btn = doc.getElementById('plus-auth-start');
        var url = root.GEOARMY_SUPABASE_URL; var anon = root.GEOARMY_SUPABASE_ANON_KEY;
        var made = siteClient(root);
        var ready = false;
        var configured = !!(url && anon && String(url).indexOf('TU-PROYECTO') === -1);
        var api = create({
          endpoint: configured ? String(url).replace(/\/+$/, '') + '/functions/v1/twitch-plus-auth' : '',
          anonKey: configured ? anon : '',
          getSession: made.client ? async function () { var r = await made.client.auth.getSession(); return r && r.data ? r.data.session : null; } : null,
          fetch: function (u, i) { return root.fetch(u, i); },
          navigate: function (u) { root.location.assign(u); },
          setMessage: function (tone, text) { if (msg) { msg.textContent = text; msg.setAttribute('data-tone', tone); } },
          setBusy: function (b) { if (btn) btn.disabled = !!b || !ready; },
          setEnabled: function (e) { ready = !!e; if (btn) btn.disabled = !e; },
          location: root.location, history: root.history,
        });
        if (btn) btn.disabled = true;   // hasta comprobar que hay sesión
        var shown = api.showReturn();
        api.prepare({ keepMessage: shown.shown });
        if (btn) btn.addEventListener('click', function () { api.start(); });
        return api;
      },
    };
  }

  return { create: create, auto: auto, AUTHORIZE_PREFIX: AUTHORIZE_PREFIX, RESULTS: RESULTS };
});
