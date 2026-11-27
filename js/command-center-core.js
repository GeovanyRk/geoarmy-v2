/* ============================================================================
 * GEO ARMY COMMAND CENTER — núcleo lógico (sin DOM)
 * ----------------------------------------------------------------------------
 * Cliente de la API real, modelo de configuración (confirmada vs. pendiente),
 * descripciones legibles, disponibilidad efectiva y sondeo sin solapamientos.
 *
 * - No toca el DOM, no guarda tokens, no imprime nada en consola.
 * - Funciona en el navegador (window.GeoArmyCC) y en Node (module.exports) para
 *   las pruebas de tests/command-center.test.cjs.
 * - El token de Supabase solo se obtiene en el momento de cada solicitud
 *   (getToken) y solo se envía a API_BASE.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeoArmyCC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var API_BASE = 'https://geoarmy.duckdns.org/api/bot-admin/v1';
  var MODES = ['OFF', 'TEST', 'PUBLIC'];
  var POLL_MS = 30000;
  var AUDIT_MIN = 1, AUDIT_MAX = 100, AUDIT_DEFAULT = 20;

  /* ------------------------------------------------------------------ errores */
  function ApiError(kind, status, code, detail) {
    var e = new Error(kind + (status ? ' ' + status : '') + (code ? ' ' + code : ''));
    e.name = 'ApiError';
    e.kind = kind;          // 'http' | 'network' | 'aborted' | 'invalid'
    e.status = status || 0;
    e.code = code || null;  // valor de {"error":"codigo"} si la API lo envió
    e.detail = detail || null;
    return e;
  }

  var HTTP_MESSAGES = {
    400: ['Solicitud o configuración inválida', 'La API rechazó los datos enviados. No se guardó nada.'],
    401: ['Sesión inválida o vencida', 'Inicia sesión de nuevo para continuar.'],
    403: ['Acceso denegado', 'Esta cuenta no está autorizada por el backend. El Command Center es exclusivo del propietario.'],
    404: ['Ruta inexistente', 'La API no reconoce esta ruta. Puede ser una versión distinta del backend.'],
    412: ['Configuración desactualizada', 'Otra sesión modificó la configuración mientras editabas.'],
    413: ['Cuerpo demasiado grande', 'La solicitud superó el tamaño que acepta la API.'],
    415: ['Formato incorrecto', 'La API solo acepta JSON.'],
    428: ['Falta If-Match', 'No se envió la versión (ETag) de la configuración que se está editando.'],
    500: ['Error interno del bot', 'El backend falló al procesar la solicitud. La configuración confirmada no cambió.'],
    503: ['Servicio o persistencia no disponible', 'El backend no pudo atender o guardar la solicitud ahora mismo.']
  };

  // → { title, detail, severity: 'error'|'warn', code }
  function describeError(err) {
    if (!err) return { title: 'Error desconocido', detail: '', severity: 'error', code: null };
    if (err.kind === 'aborted') return { title: 'Solicitud cancelada', detail: '', severity: 'warn', code: null };
    if (err.kind === 'network') {
      return {
        title: 'API inaccesible',
        detail: 'No se pudo contactar con la API (red, CORS o servidor caído). Esto no significa que el bot esté desconectado: no hay datos nuevos.',
        severity: 'warn', code: null
      };
    }
    if (err.kind === 'invalid') {
      return { title: 'Respuesta inesperada', detail: err.detail || 'La API respondió con un formato que la interfaz no reconoce.', severity: 'error', code: err.code };
    }
    var m = HTTP_MESSAGES[err.status];
    if (m) return { title: m[0], detail: m[1], severity: err.status === 503 || err.status === 401 ? 'warn' : 'error', code: err.code };
    return { title: 'Error HTTP ' + err.status, detail: 'La API devolvió un estado no previsto.', severity: 'error', code: err.code };
  }

  /* --------------------------------------------------------------- cliente API */
  // opts: { fetch, getToken: async () => string|null, baseUrl? }
  function createApiClient(opts) {
    var base = (opts && opts.baseUrl) || API_BASE;
    var fetchImpl = opts.fetch;
    var getToken = opts.getToken;

    async function request(method, path, o) {
      o = o || {};
      var token = await getToken();
      if (!token) throw ApiError('http', 401, 'no_session');
      var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };
      var init = { method: method, headers: headers, cache: 'no-store', credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer' };
      if (o.signal) init.signal = o.signal;
      if (o.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(o.body);
      }
      if (o.ifMatch) headers['If-Match'] = o.ifMatch;   // se conservan las comillas del ETag

      var res;
      try { res = await fetchImpl(base + path, init); }
      catch (e) {
        if ((o.signal && o.signal.aborted) || (e && e.name === 'AbortError')) throw ApiError('aborted');
        throw ApiError('network');
      }

      var text = '';
      try { text = await res.text(); }
      catch (e) {
        if ((o.signal && o.signal.aborted) || (e && e.name === 'AbortError')) throw ApiError('aborted');
        throw ApiError('network');
      }
      var data = null;
      if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }

      if (!res.ok) {
        var code = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : null;
        throw ApiError('http', res.status, code);
      }
      if (data === null || typeof data !== 'object') throw ApiError('invalid', res.status, null, 'La respuesta no es un objeto JSON.');
      return { status: res.status, data: data, etag: res.headers.get('ETag') };
    }

    return {
      base: base,
      status: function (signal) { return request('GET', '/status', { signal: signal }).then(function (r) { return normStatus(r.data); }); },
      commands: function (signal) { return request('GET', '/commands', { signal: signal }).then(function (r) { return normCommands(r.data); }); },
      stats: function (signal) { return request('GET', '/stats', { signal: signal }).then(function (r) { return normStats(r.data); }); },
      audit: function (limit, signal) {
        return request('GET', '/audit?limit=' + clampInt(limit, AUDIT_MIN, AUDIT_MAX, AUDIT_DEFAULT), { signal: signal })
          .then(function (r) { return normAudit(r.data); });
      },
      config: function (signal) {
        return request('GET', '/config', { signal: signal }).then(function (r) {
          return { config: normConfig(r.data), etag: r.etag || null };
        });
      },
      // Envía SOLO el parche (campos modificados) con If-Match.
      patchConfig: function (patch, etag, signal) {
        return request('PATCH', '/config', { body: patch, ifMatch: etag, signal: signal }).then(function (r) {
          var d = r.data && r.data.config && typeof r.data.config === 'object' ? r.data.config : r.data;
          return { config: looksLikeConfig(d) ? normConfig(d) : null, etag: r.etag || null, status: r.status };
        });
      }
    };
  }

  /* -------------------------------------------------------------- normalizar */
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function num(x, d) { return typeof x === 'number' && isFinite(x) ? x : d; }
  function clampInt(v, min, max, d) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return d;
    return Math.min(max, Math.max(min, n));
  }
  function looksLikeConfig(d) { return isObj(d) && typeof d.mode === 'string' && isObj(d.cooldowns) && isObj(d.commands); }

  function normStatus(d) {
    var irc = isObj(d.irc) ? { connected: d.irc.connected === true, uptimeSeconds: num(d.irc.uptimeSeconds, null) } : null;
    var st = isObj(d.stream) ? d.stream : null;
    var state = st && (st.state === 'live' || st.state === 'offline') ? st.state : 'unknown';
    return {
      channel: typeof d.channel === 'string' ? d.channel : null,
      mode: typeof d.mode === 'string' ? d.mode : null,
      uptimeSeconds: num(d.uptimeSeconds, null),
      discordConnected: typeof d.discordConnected === 'boolean' ? d.discordConnected : null,
      irc: irc,
      stream: { state: state, checkedAt: st && typeof st.checkedAt === 'string' ? st.checkedAt : null }
    };
  }

  function normCommands(d) {
    var list = Array.isArray(d.commands) ? d.commands : [];
    return list.filter(function (c) { return isObj(c) && typeof c.name === 'string'; }).map(function (c) {
      return { name: c.name, aliases: Array.isArray(c.aliases) ? c.aliases.filter(function (a) { return typeof a === 'string'; }) : [], enabled: c.enabled === true };
    });
  }

  function normStats(d) {
    var t = isObj(d.totals) ? d.totals : {};
    var by = {};
    if (isObj(d.byCommand)) Object.keys(d.byCommand).forEach(function (k) {
      var c = isObj(d.byCommand[k]) ? d.byCommand[k] : {};
      by[k] = { executed: num(c.executed, 0), errors: num(c.errors, 0), sent: num(c.sent, 0), discarded: num(c.discarded, 0) };
    });
    return {
      startedAt: typeof d.startedAt === 'string' ? d.startedAt : null,
      totals: { executed: num(t.executed, 0), errors: num(t.errors, 0), sent: num(t.sent, 0), discarded: num(t.discarded, 0) },
      byCommand: by
    };
  }

  function normAudit(d) {
    var list = Array.isArray(d.entries) ? d.entries : [];
    var out = list.filter(function (e) { return isObj(e) && typeof e.at === 'string'; }).map(function (e) {
      return { at: e.at, actorTwitchId: e.actorTwitchId == null ? null : String(e.actorTwitchId), changed: isObj(e.changed) ? e.changed : {} };
    });
    // Orden del más reciente al más antiguo (defensivo; la API ya debería enviarlo así).
    out.sort(function (a, b) { return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0); });
    return out;
  }

  function normConfig(d) {
    if (!looksLikeConfig(d)) throw ApiError('invalid', 200, null, 'La configuración recibida no tiene el formato esperado.');
    var cd = isObj(d.cooldownBounds) ? d.cooldownBounds : {};
    function bound(k, dmin, dmax) {
      var b = isObj(cd[k]) ? cd[k] : {};
      return { min: num(b.min, dmin), max: num(b.max, dmax) };
    }
    var cmds = {};
    Object.keys(d.commands).forEach(function (k) { cmds[k] = d.commands[k] === true; });
    return {
      mode: d.mode,
      ownerUserId: d.ownerUserId == null ? null : String(d.ownerUserId),
      allowedUserIds: Array.isArray(d.allowedUserIds) ? d.allowedUserIds.map(String) : [],
      allowOffline: d.allowOffline === true,
      cooldowns: { userSeconds: num(d.cooldowns.userSeconds, null), commandSeconds: num(d.cooldowns.commandSeconds, null) },
      commands: cmds,
      cooldownBounds: { userSeconds: bound('userSeconds', 5, 300), commandSeconds: bound('commandSeconds', 2, 120) }
    };
  }

  /* ---------------------------------------- configuración: confirmada vs draft */
  // Copia de SOLO los campos editables (mode, allowOffline, cooldowns, commands).
  function editableOf(cfg) {
    return {
      mode: cfg.mode,
      allowOffline: cfg.allowOffline,
      cooldowns: { userSeconds: cfg.cooldowns.userSeconds, commandSeconds: cfg.cooldowns.commandSeconds },
      commands: Object.assign({}, cfg.commands)
    };
  }

  // Parche mínimo: únicamente lo que difiere de la configuración confirmada.
  function diffConfig(confirmed, draft) {
    var p = {};
    if (!draft) return p;
    if (draft.mode !== confirmed.mode) p.mode = draft.mode;
    if (draft.allowOffline !== confirmed.allowOffline) p.allowOffline = draft.allowOffline;
    ['userSeconds', 'commandSeconds'].forEach(function (k) {
      if (draft.cooldowns[k] !== confirmed.cooldowns[k]) { p.cooldowns = p.cooldowns || {}; p.cooldowns[k] = draft.cooldowns[k]; }
    });
    Object.keys(draft.commands).forEach(function (k) {
      if (draft.commands[k] !== confirmed.commands[k]) { p.commands = p.commands || {}; p.commands[k] = draft.commands[k]; }
    });
    return p;
  }

  // Lista plana [{path, value}] de un parche o del campo `changed` de auditoría.
  function flatten(obj, prefix, out) {
    out = out || [];
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k], p = prefix ? prefix + '.' + k : k;
      if (isObj(v)) flatten(v, p, out); else out.push({ path: p, value: v });
    });
    return out;
  }
  function getPath(o, path) {
    return path.split('.').reduce(function (acc, k) { return acc == null ? undefined : acc[k]; }, o);
  }
  function countChanges(patch) { return flatten(patch).length; }

  // Valida el draft con los límites REALES recibidos de la API. → { field: mensaje }
  function validateDraft(confirmed, draft) {
    var errors = {};
    if (MODES.indexOf(draft.mode) === -1) errors.mode = 'Modo no válido.';
    [['userSeconds', 'por usuario'], ['commandSeconds', 'por comando']].forEach(function (pair) {
      var k = pair[0], v = draft.cooldowns[k], b = confirmed.cooldownBounds[k];
      if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v) errors[k] = 'Escribe un número entero de segundos.';
      else if (v < b.min || v > b.max) errors[k] = 'El cooldown ' + pair[1] + ' debe estar entre ' + b.min + ' y ' + b.max + ' s.';
    });
    return errors;
  }

  // Tras un 412: aplica MI parche sobre la configuración nueva del servidor, sin guardar nada.
  // conflicts = campos que yo edité y que el servidor también cambió por su lado.
  // dropped   = cambios míos que el servidor ya tiene (ya no hacen falta).
  function rebaseDraft(oldConfirmed, newConfirmed, draft) {
    var mine = flatten(diffConfig(oldConfirmed, draft));
    var next = editableOf(newConfirmed);
    var conflicts = [], dropped = [], kept = [];
    mine.forEach(function (m) {
      var before = getPath(oldConfirmed, m.path), now = getPath(newConfirmed, m.path);
      if (now === m.value) { dropped.push(m); return; }
      if (now !== before) conflicts.push({ path: m.path, mine: m.value, theirs: now, before: before });
      applyPath(next, m.path, m.value);
      kept.push(m);
    });
    var mineSet = {}; mine.forEach(function (m) { mineSet[m.path] = 1; });
    var serverChanges = flatten(diffConfig(oldConfirmed, editableOf(newConfirmed)))
      .filter(function (c) { return !mineSet[c.path]; })
      .map(function (c) { return { path: c.path, before: getPath(oldConfirmed, c.path), now: c.value }; });
    return { draft: next, conflicts: conflicts, dropped: dropped, kept: kept, serverChanges: serverChanges };
  }
  function applyPath(o, path, value) {
    var ks = path.split('.'), last = ks.pop(), cur = o;
    ks.forEach(function (k) { cur = cur[k]; });
    cur[last] = value;
  }

  /* ------------------------------------------------------------ legibilidad */
  var MODE_LABELS = { OFF: 'OFF — comandos suspendidos', TEST: 'TEST — solo usuarios autorizados', PUBLIC: 'PUBLIC — toda la comunidad' };
  function modeLabel(m) { return MODE_LABELS[m] || String(m); }
  function onOff(v) { return v === true ? 'habilitado' : v === false ? 'deshabilitado' : String(v); }

  // Texto legible de un cambio (valores nuevos; el servidor no guarda los anteriores).
  function describeChange(path, value) {
    if (path === 'mode') return 'Modo cambiado a ' + modeLabel(value);
    if (path === 'allowOffline') return value === true ? 'Comandos permitidos con el canal offline' : 'Comandos bloqueados mientras el canal está offline';
    if (path === 'cooldowns.userSeconds') return 'Cooldown por usuario: ' + value + ' s';
    if (path === 'cooldowns.commandSeconds') return 'Cooldown por comando: ' + value + ' s';
    if (path.indexOf('commands.') === 0) return 'Comando !' + path.slice(9) + ' ' + onOff(value);
    return path + ': ' + (isObj(value) ? JSON.stringify(value) : String(value));
  }
  function describeAudit(changed) {
    return flatten(changed).map(function (c) { return describeChange(c.path, c.value); });
  }

  function formatDuration(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '—';
    sec = Math.floor(sec);
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (d) return d + ' d ' + h + ' h ' + pad(m) + ' m';
    if (h) return h + ' h ' + pad(m) + ' m';
    if (m) return m + ' m ' + pad(s) + ' s';
    return s + ' s';
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function relativeTime(iso, nowMs) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '—';
    var diff = Math.round(((nowMs == null ? Date.now() : nowMs) - t) / 1000);
    if (diff < 5) return 'ahora mismo';
    if (diff < 60) return 'hace ' + diff + ' s';
    if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + ' h';
    return 'hace ' + Math.floor(diff / 86400) + ' d';
  }
  function formatDateTime(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return { date: '—', time: '' };
    var d = new Date(t);
    return {
      date: d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  }

  /* ------------------------------------------------- catálogo (solo textos UI) */
  // La API no entrega descripciones: estos textos son locales de la interfaz y se
  // indexan por nombre. Un comando nuevo de la API se muestra igual, sin descripción.
  var COMMAND_INFO = {
    gcoin: 'Consulta el saldo de G-Coins del espectador.',
    pavos: 'Consulta el saldo de V-Bucks (Fortnite).',
    owcoins: 'Consulta el saldo de OW Coins (Overwatch).',
    puntos: 'Consulta los puntos del espectador.',
    xp: 'Muestra la experiencia del espectador.',
    rango: 'Muestra el rango del espectador.',
    plus: 'Consulta el estado de GEO ARMY Plus.',
    top: 'Muestra el ranking de la comunidad.',
    misiones: 'Consulta las misiones.',
    geoarmy: 'Comparte el enlace de la web de Geo Army.',
    comandos: 'Lista los comandos disponibles (ayuda).'
  };
  function commandInfo(name) { return COMMAND_INFO[name] || null; }

  // Disponibilidad EFECTIVA según modo, conexión, canal y estado del comando (datos confirmados).
  // → { state: 'on'|'limited'|'off'|'blocked'|'unknown', label, reason }
  function commandAvailability(cmd, ctx) {
    var status = ctx.status, config = ctx.config;
    if (!status || !config) return { state: 'unknown', label: 'Sin datos', reason: 'Falta el estado del bot o la configuración.' };
    if (!cmd.enabled) return { state: 'off', label: 'Deshabilitado', reason: 'Apagado individualmente.' };
    var mode = config.mode;
    if (mode === 'OFF') return { state: 'blocked', label: 'Suspendido', reason: 'El modo OFF suspende todos los comandos.' };
    if (!status.irc || !status.irc.connected) return { state: 'blocked', label: 'Sin IRC', reason: 'El bot no está conectado al chat (IRC).' };
    if (config.allowOffline === false) {
      if (status.stream.state === 'offline') return { state: 'blocked', label: 'Canal offline', reason: 'allowOffline está desactivado y el canal no está en directo.' };
      if (status.stream.state === 'unknown') return { state: 'unknown', label: 'Sin confirmar', reason: 'allowOffline está desactivado y no se pudo confirmar si el canal está en directo.' };
    }
    if (mode === 'TEST') return { state: 'limited', label: 'Solo autorizados', reason: 'Modo TEST: solo responde a usuarios autorizados.' };
    if (mode === 'PUBLIC') return { state: 'on', label: 'Disponible', reason: 'Modo PUBLIC: responde a toda la comunidad.' };
    return { state: 'unknown', label: 'Sin confirmar', reason: 'Modo no reconocido.' };
  }

  /* ----------------------------------------------------------------- stats */
  // Orden por ejecuciones desc, desempate por nombre (estable).
  function commandRows(stats) {
    return Object.keys(stats.byCommand).map(function (k) { return Object.assign({ name: k }, stats.byCommand[k]); })
      .sort(function (a, b) { return b.executed - a.executed || (a.name < b.name ? -1 : 1); });
  }

  /* --------------------------------------------------------------- sondeo */
  // Una sola solicitud en curso; el siguiente ciclo se programa al TERMINAR el anterior.
  // Pausa con la pestaña oculta y, al volver, refresca de inmediato si hace falta.
  function createPoller(o) {
    var every = o.intervalMs || POLL_MS;
    var now = o.now || Date.now, st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
    var visible = o.isVisible ? o.isVisible() : true;
    var timer = null, running = false, active = false, lastEnd = 0, generation = 0;

    function schedule(delay) {
      if (timer) ct(timer);
      timer = null;
      if (!active || !visible) return;
      timer = st(tick, delay);
    }
    async function tick() {
      timer = null;
      if (!active || !visible || running) return;
      running = true;
      var gen = generation;
      try { await o.task(); } catch (e) { /* la tarea gestiona sus propios errores */ }
      running = false;
      lastEnd = now();
      if (gen === generation) schedule(every);
    }
    return {
      start: function (immediate) { active = true; generation++; if (immediate) tick(); else schedule(every); },
      stop: function () { active = false; generation++; if (timer) ct(timer); timer = null; },
      setVisible: function (v) {
        visible = !!v;
        if (!active) return;
        if (!visible) { if (timer) ct(timer); timer = null; return; }
        if (running) return;
        schedule(now() - lastEnd >= every ? 0 : every - (now() - lastEnd));
      },
      isRunning: function () { return running; },
      isScheduled: function () { return timer !== null; }
    };
  }

  return {
    API_BASE: API_BASE, MODES: MODES, POLL_MS: POLL_MS, AUDIT_MIN: AUDIT_MIN, AUDIT_MAX: AUDIT_MAX, AUDIT_DEFAULT: AUDIT_DEFAULT,
    ApiError: ApiError, describeError: describeError, createApiClient: createApiClient,
    normStatus: normStatus, normCommands: normCommands, normStats: normStats, normAudit: normAudit, normConfig: normConfig,
    editableOf: editableOf, diffConfig: diffConfig, flatten: flatten, getPath: getPath, countChanges: countChanges,
    validateDraft: validateDraft, rebaseDraft: rebaseDraft,
    modeLabel: modeLabel, describeChange: describeChange, describeAudit: describeAudit,
    formatDuration: formatDuration, relativeTime: relativeTime, formatDateTime: formatDateTime, clampInt: clampInt,
    commandInfo: commandInfo, commandAvailability: commandAvailability, commandRows: commandRows,
    createPoller: createPoller
  };
});
