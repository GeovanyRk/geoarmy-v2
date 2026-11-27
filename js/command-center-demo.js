/* ============================================================================
 * GEO ARMY COMMAND CENTER — MODO DEMO (datos SIMULADOS)
 * ----------------------------------------------------------------------------
 * Servidor falso en memoria con el MISMO contrato que la API real
 * (https://geoarmy.duckdns.org/api/bot-admin/v1), expuesto como una función
 * `fetch` para que la interfaz use exactamente el mismo cliente en DEMO y en
 * producción. NO hace ninguna solicitud de red.
 *
 * Solo se carga cuando la página se abre con ?demo=1 (ver admin/command-center/).
 * El modo producción NUNCA recurre a este archivo cuando la API falla.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeoArmyCCDemo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'https://geoarmy.duckdns.org/api/bot-admin/v1';
  var OWNER = '265793827';

  // Catálogo del contrato real (sin ningún alias !overwatch: no existe).
  var CATALOG = [
    ['gcoin', ['gcoins']], ['pavos', ['vbucks']], ['owcoins', []], ['puntos', []],
    ['xp', ['experiencia']], ['rango', ['rank']], ['plus', []], ['top', ['ranking']],
    ['misiones', []], ['geoarmy', ['web']], ['comandos', ['ayuda']]
  ];

  function create(opts) {
    opts = opts || {};
    var latency = opts.latencyMs == null ? 320 : opts.latencyMs;
    var nowFn = opts.now || Date.now;
    var bootAt = nowFn() - 864 * 1000;                       // «activo desde hace 14 min»
    var version = 1;

    var config = {
      mode: 'TEST', ownerUserId: OWNER, allowedUserIds: [OWNER], allowOffline: true,
      cooldowns: { userSeconds: 15, commandSeconds: 5 },
      commands: {},
      cooldownBounds: { userSeconds: { min: 5, max: 300 }, commandSeconds: { min: 2, max: 120 } }
    };
    CATALOG.forEach(function (c) { config.commands[c[0]] = true; });

    var stream = { state: 'offline', checkedAt: new Date(nowFn() - 22000).toISOString() };
    var statusCtl = { ircConnected: true, discordConnected: true };

    var stats = {
      startedAt: new Date(bootAt).toISOString(),
      totals: { executed: 0, errors: 0, sent: 0, discarded: 0 }, byCommand: {}
    };
    [['gcoin', 38, 1, 36, 1], ['xp', 24, 0, 24, 0], ['rango', 17, 0, 16, 1], ['top', 12, 2, 9, 1], ['geoarmy', 9, 0, 9, 0],
     ['comandos', 7, 0, 7, 0], ['pavos', 5, 0, 4, 1], ['puntos', 4, 0, 4, 0], ['misiones', 3, 1, 2, 0], ['plus', 2, 0, 2, 0]]
      .forEach(function (r) {
        stats.byCommand[r[0]] = { executed: r[1], errors: r[2], sent: r[3], discarded: r[4] };
        stats.totals.executed += r[1]; stats.totals.errors += r[2]; stats.totals.sent += r[3]; stats.totals.discarded += r[4];
      });

    var audit = [];
    (function seed() {
      var t = nowFn();
      [
        [3, { cooldowns: { userSeconds: 20 } }], [27, { commands: { pavos: false } }], [58, { mode: 'TEST' }],
        [140, { allowOffline: false }], [420, { commands: { top: false, plus: false } }], [1500, { cooldowns: { commandSeconds: 8 } }],
        [4000, { commands: { top: true, plus: true } }], [9000, { allowOffline: true }], [30000, { mode: 'OFF' }], [90000, { mode: 'TEST', cooldowns: { userSeconds: 15, commandSeconds: 5 } }]
      ].forEach(function (r) { audit.push({ at: new Date(t - r[0] * 60000).toISOString(), actorTwitchId: OWNER, changed: r[1] }); });
    })();

    // Controles de simulación (solo DEMO): fallos y conflicto 412.
    var sim = { network: false, httpStatus: 0 };

    function etag() { return '"cfg-' + version + '"'; }
    function json(status, body, extra) {
      var h = { 'Content-Type': 'application/json' };
      Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
      return new Response(JSON.stringify(body), { status: status, headers: h });
    }
    function err(status, code) { return json(status, { error: code }); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function wait(ms, signal) {
      return new Promise(function (resolve, reject) {
        if (signal && signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        var t = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', function () { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
      });
    }
    function hdr(init, name) {
      var h = init.headers || {}, k = Object.keys(h).filter(function (x) { return x.toLowerCase() === name.toLowerCase(); })[0];
      return k ? h[k] : null;
    }

    function applyPatch(body) {
      var allowed = { mode: 1, allowOffline: 1, cooldowns: 1, commands: 1 };
      var keys = Object.keys(body);
      if (!keys.length) return 'empty';
      for (var i = 0; i < keys.length; i++) if (!allowed[keys[i]]) return 'invalid_config';
      if ('mode' in body && ['OFF', 'TEST', 'PUBLIC'].indexOf(body.mode) === -1) return 'invalid_config';
      if ('allowOffline' in body && typeof body.allowOffline !== 'boolean') return 'invalid_config';
      if ('cooldowns' in body) {
        var cd = body.cooldowns;
        if (!cd || typeof cd !== 'object') return 'invalid_config';
        var ck = Object.keys(cd);
        for (var j = 0; j < ck.length; j++) {
          var b = config.cooldownBounds[ck[j]], v = cd[ck[j]];
          if (!b || typeof v !== 'number' || Math.floor(v) !== v || v < b.min || v > b.max) return 'invalid_config';
        }
      }
      if ('commands' in body) {
        var cm = body.commands;
        if (!cm || typeof cm !== 'object') return 'invalid_config';
        var mk = Object.keys(cm);
        for (var m = 0; m < mk.length; m++) if (!(mk[m] in config.commands) || typeof cm[mk[m]] !== 'boolean') return 'invalid_config';
      }
      if ('mode' in body) config.mode = body.mode;
      if ('allowOffline' in body) config.allowOffline = body.allowOffline;
      if ('cooldowns' in body) Object.assign(config.cooldowns, body.cooldowns);
      if ('commands' in body) Object.assign(config.commands, body.commands);
      return null;
    }

    async function fetchImpl(url, init) {
      init = init || {};
      var signal = init.signal;
      if (String(url).indexOf(BASE) !== 0) throw new TypeError('DEMO: solo atiende la URL de la API simulada');
      await wait(latency, signal);
      if (sim.network) throw new TypeError('Failed to fetch');
      if (sim.httpStatus) return err(sim.httpStatus, ({ 401: 'unauthorized', 403: 'forbidden', 500: 'internal_error', 503: 'unavailable' })[sim.httpStatus] || 'error');

      var auth = hdr(init, 'Authorization');
      if (!auth || auth.indexOf('Bearer ') !== 0) return err(401, 'unauthorized');

      var rest = String(url).slice(BASE.length), path = rest.split('?')[0], query = rest.indexOf('?') > -1 ? rest.slice(rest.indexOf('?') + 1) : '';
      var method = (init.method || 'GET').toUpperCase();

      if (method === 'GET' && path === '/status') {
        var up = Math.floor((nowFn() - bootAt) / 1000);
        return json(200, {
          channel: 'geovannyrk', mode: config.mode, uptimeSeconds: up, discordConnected: statusCtl.discordConnected,
          irc: { connected: statusCtl.ircConnected, uptimeSeconds: statusCtl.ircConnected ? Math.max(0, up - 3) : 0 },
          stream: { state: stream.state, checkedAt: stream.checkedAt }
        });
      }
      if (method === 'GET' && path === '/config') return json(200, clone(config), { ETag: etag() });
      if (method === 'GET' && path === '/commands') {
        return json(200, { commands: CATALOG.map(function (c) { return { name: c[0], aliases: c[1].slice(), enabled: config.commands[c[0]] === true }; }) });
      }
      if (method === 'GET' && path === '/stats') return json(200, clone(stats));
      if (method === 'GET' && path === '/audit') {
        var m = /(?:^|&)limit=([^&]*)/.exec(query), lim = m ? parseInt(m[1], 10) : 20;
        if (!isFinite(lim) || lim < 1 || lim > 100) return err(400, 'invalid_limit');
        return json(200, { entries: audit.slice().sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); }).slice(0, lim).map(clone) });
      }
      if (method === 'PATCH' && path === '/config') {
        var ct = hdr(init, 'Content-Type');
        if (!ct || ct.indexOf('application/json') !== 0) return err(415, 'unsupported_media_type');
        var raw = init.body == null ? '' : String(init.body);
        if (raw.length > 4096) return err(413, 'payload_too_large');
        var im = hdr(init, 'If-Match');
        if (!im) return err(428, 'if_match_required');
        var body; try { body = JSON.parse(raw); } catch (e) { return err(400, 'invalid_json'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return err(400, 'invalid_config');
        if (im !== etag()) return err(412, 'stale_config');
        var snapshot = clone(config);
        var bad = applyPatch(body);
        if (bad) { config = snapshot; return err(400, bad === 'empty' ? 'invalid_config' : bad); }
        version++;
        audit.push({ at: new Date(nowFn()).toISOString(), actorTwitchId: OWNER, changed: clone(body) });
        if (audit.length > 200) audit.splice(0, audit.length - 200);
        return json(200, clone(config), { ETag: etag() });
      }
      return err(404, 'not_found');
    }

    return {
      fetch: fetchImpl,
      // Controles del simulador (no existen en la API real).
      controls: {
        setNetworkDown: function (on) { sim.network = !!on; },
        setHttpStatus: function (code) { sim.httpStatus = code || 0; },
        setStream: function (state) { stream.state = state; stream.checkedAt = new Date(nowFn()).toISOString(); },
        setIrc: function (on) { statusCtl.ircConnected = !!on; },
        setDiscord: function (on) { statusCtl.discordConnected = !!on; },
        // Simula que OTRA sesión cambió la configuración: la versión (ETag) avanza.
        externalConfigChange: function () {
          config.cooldowns.userSeconds = config.cooldowns.userSeconds >= 60 ? 30 : 60;
          version++;
          audit.push({ at: new Date(nowFn()).toISOString(), actorTwitchId: OWNER, changed: { cooldowns: { userSeconds: config.cooldowns.userSeconds } } });
        },
        snapshot: function () { return { config: clone(config), etag: etag(), audit: clone(audit), sim: clone(sim) }; }
      }
    };
  }

  return { create: create, CATALOG: CATALOG, BASE: BASE };
});
