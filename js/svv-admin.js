/* =====================================================================
   Streamer vs Viewer V2 · Fase 6A-9 · Panel de control de Geo (solo administradores)
   Se carga SOLO desde admin/streamer-vs-viewer/index.html. No toca js/svv-v4.js ni la cuenta del sitio.

   Lectura (3 RPC de solo lectura, definidas en sql/95_6a9_admin_read_rpc.sql; solo admin):
     svv_admin_get_panel_state(p_event_key text default null)                      -> estado actual (partida abierta con 12 kills, 6 partidas recientes SIN kills); se consulta cada 3-8 s
     svv_admin_list_matches(p_event_key, p_before_seq, p_limit, p_status)           -> historial de partidas cerradas/anuladas, por cursor (solo a petición; páginas de 10)
     svv_admin_list_match_kills(p_event_key, p_match, p_before_at, p_before_id, p_limit) -> kills de UNA partida, por cursor (solo a petición; páginas de 25)
   Escritura (33 RPC ya instaladas en 6A-2…6A-6; contratos reales, sin inventar parámetros):
     svv_admin_create_event(p_request, p_event_key, p_edition_number, p_edition_label, p_is_test)
     svv_admin_save_rules(p_event, p_request, p_title, p_body_md, p_expected_revision)   svv_admin_publish_rules(p_event, p_request, p_expected_revision)
     svv_admin_schedule_event(p_event, p_request, p_scheduled_start_at)   svv_admin_set_queue_open(p_event, p_request, p_open)
     svv_admin_go_live(p_event, p_request)   svv_admin_activate_last_round(p_event, p_request, p_confirm)
     svv_admin_call_next(p_event, p_request)   svv_admin_remove_from_queue(p_event, p_request, p_entry, p_reason)   svv_admin_sweep(p_event, p_request)
     svv_admin_open_match(p_event, p_request, p_entries[])   svv_admin_set_lobby_ready(…, p_match)   svv_admin_record_lobby_entries(…, p_match, p_players[])
     svv_admin_start_bus(…, p_match, p_present[])   svv_admin_record_kill(…, p_match, p_player, p_kills, p_note)   svv_admin_reverse_kill(…, p_kill, p_reason)
     svv_admin_record_disconnect(…, p_match, p_player, p_note)   svv_admin_confirm_reconnect(…, p_match, p_player, p_note)
     svv_admin_close_match(…, p_match)   svv_admin_void_match(…, p_match, p_reason)   svv_admin_finish_turn(…, p_turn)   svv_admin_release_turn(…, p_turn, p_reason)
     svv_admin_restore_void(…, p_match, p_profile)   svv_admin_finish_event(p_event, p_request)   svv_admin_cancel_event(…, p_reason)
     svv_admin_compute_result(p_event, p_request)   svv_admin_confirm_result(…, p_note)   svv_admin_discard_result(…, p_reason)

   Liquidación económica (Fase 6B-2C, ya instalada; este panel NO crea ninguna operación económica nueva):
     lectura  svv_admin_get_settlement(p_event_key text)
     escribe  svv_admin_settlement_prepare(p_event, p_request)  ·  svv_admin_settlement_finalize(p_event, p_request)      (request_id UUID reutilizable: reintentos idempotentes)
     aplicar  Edge Function `svv-apply-payouts` (JWT de usuario + rol admin comprobado en servidor -> RPC de servicio svv_service_apply_payouts con la clave de servicio del servidor). El navegador NUNCA tiene la clave de servicio.

   Principios: Supabase es la única autoridad (estados, plazos, permisos, pesos ×2/×1); este código solo muestra lo que devuelve y pide acciones.
   El acceso lo decide el servidor (SV004 = sin sesión o sin rol admin); nunca se confía en el navegador. Ninguna clave privada: solo la anon pública.
   Un solo envío a la vez (S.busy) + una clave de operación por intención (reutilizada solo si el resultado es incierto): sin dobles acciones.
   Todo texto que viene del servidor se inserta con textContent (nunca como HTML).
   ===================================================================== */
(function () {
  'use strict';

  var RPC_TIMEOUT_MS = 12000, POLL_FAST_MS = 3000, POLL_SLOW_MS = 8000, POLL_MAX_MS = 15000, REQ_TTL_MS = 120000, TOAST_OK_MS = 5000, TOAST_ERR_MS = 11000;

  var S = {
    client: null, userId: null, gate: 'loading',
    panel: null, at: 0, eventKey: null, shownKey: null,
    req: 0, loading: false, fails: 0, conn: 'loading', lastOkAt: 0, pollTimer: null,
    busy: false, coolUntil: 0, pending: {}, nonce: 0, modalOpen: false,
    sel: {}, entered: {}, rsig: {}, cd: { q: {}, lobby: null, live: null },
    rulesBase: null, rulesRev: null,
    hist: null, mk: {}, restored: {}, settle: null, settleReq: 0, settleLoading: false
  };

  /* ------------------------------ utilidades ------------------------------ */
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function show(n, on) { if (n) n.hidden = !on; }
  function setText(id, v) { var n = $(id); if (n) n.textContent = v; }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function fmtInt(v) { try { return new Intl.NumberFormat('es').format(v); } catch (e) { return String(v); } }
  function fmtMoney(v) { try { return new Intl.NumberFormat('en-US').format(v); } catch (e) { return String(v); } }   // 1,000 como en el resto del sitio
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mmss(sec) { var s = Math.max(0, Math.floor(sec)); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function fmtClock(sec) { var s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600); s -= h * 3600; var m = Math.floor(s / 60); return h + ':' + pad(m) + ':' + pad(s - m * 60); }
  function fmtTime(d) { d = d instanceof Date ? d : new Date(d); if (isNaN(d.getTime())) return '—'; return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function fmtDateTime(iso) {
    if (!iso) return '—'; var d = new Date(iso); if (isNaN(d.getTime())) return '—';
    try { return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(d); } catch (e) { return d.toLocaleString(); }
  }
  function online() { return !(typeof navigator !== 'undefined' && navigator.onLine === false); }
  function elapsed() { return (performance.now() - S.at) / 1000; }
  function secLeft(base) { return (typeof base === 'number') ? Math.max(0, Math.ceil(base - elapsed())) : null; }
  function uuid() {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16), i;
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b); else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = []; for (i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }
  function pe() { return S.panel && S.panel.event ? S.panel.event : null; }

  var STATUS_ES = { draft: 'Borrador', scheduled: 'Programada', live: 'En vivo', finished: 'Finalizada', settled: 'Liquidada', cancelled: 'Cancelada' };
  var Q_ES = { waiting: 'Esperando', called: 'Llamado', confirmed: 'Confirmado', in_turn: 'En turno' };
  var VALID_ES = { pending: 'Pendiente', valid: 'Válido', invalid: 'Inválido' };
  var MODE_ES = { duo: 'Dúo', trio: 'Trío', squad: 'Squad' };
  var PHASE_ES = ['Preparando', 'Lobby', 'Battle Bus', 'Cierre'];
  var ACTION_ES = {
    create_event: 'Edición creada', save_rules: 'Reglamento guardado', publish_rules: 'Reglamento publicado', schedule_event: 'Edición programada',
    set_queue_open: 'Fila abierta/cerrada', go_live: 'Edición en vivo', activate_last_round: 'Última ronda', call_next: 'Llamado al siguiente',
    remove_from_queue: 'Retiro de la fila', sweep: 'Barrido de vencidos', open_match: 'Partida preparada', set_lobby_ready: 'Lobby listo',
    record_lobby_entries: 'Entradas al lobby', start_bus: 'Battle Bus iniciado', record_kill: 'Kills registradas', reverse_kill: 'Kill corregida',
    record_disconnect: 'Desconexión', confirm_reconnect: 'Reconexión confirmada', close_match: 'Partida cerrada', void_match: 'Partida anulada',
    finish_turn: 'Turno terminado', release_turn: 'Turno liberado', restore_void: 'Oportunidad restaurada', finish_event: 'Edición finalizada',
    cancel_event: 'Edición cancelada', compute_result: 'Resultado calculado', confirm_result: 'Resultado confirmado', discard_result: 'Resultado descartado',
    settlement_prepare: 'Liquidación preparada', settlement_finalize: 'Liquidación finalizada'
  };

  /* ------------------------------ avisos ------------------------------ */
  function toast(kind, text) {
    var box = $('sva-toasts'); if (!box) return;
    var t = el('div', 'sva-toast', text); t.setAttribute('data-kind', kind);
    box.appendChild(t);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, kind === 'ok' ? TOAST_OK_MS : TOAST_ERR_MS);
  }

  /* ------------------------------ RPC ------------------------------ */
  function classify(err, status) {
    var code = String(err.code || ''), msg = String(err.message || '');
    if (code === 'SV004' || status === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt|SV004|autenticado|rol admin/i.test(msg)) return 'auth';
    if (code === '42501' || status === 403) return 'denied';
    if (code === 'SV006') return 'revision';
    if (code === 'SV005') return 'conflict';
    if (code === 'SV003') return 'business';
    if (code === 'PGRST202' || code === '42883' || status === 404) return 'missing';
    if (/failed to fetch|network|load failed|timeout|fetch/i.test(msg) || status === 0 || (status && status >= 500)) return 'network';
    return 'other';
  }
  function rpcRaw(name, args) {
    var client = S.client;
    if (!client) return Promise.resolve({ ok: false, kind: 'network', message: 'sin cliente' });
    if (!online()) return Promise.resolve({ ok: false, kind: 'network', message: 'sin conexión' });
    var call;
    try { call = args ? client.rpc(name, args) : client.rpc(name); }
    catch (e) { return Promise.resolve({ ok: false, kind: 'other', message: String(e && e.message || e) }); }
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve({ __timeout: true }); }, RPC_TIMEOUT_MS); });
    return Promise.race([Promise.resolve(call), timeout]).then(function (res) {
      if (!res || res.__timeout) return { ok: false, kind: 'network', message: 'tiempo de espera' };
      if (res.error) return { ok: false, kind: classify(res.error, res.status), code: String(res.error.code || ''), message: String(res.error.message || '') };
      var d = res.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
      return { ok: true, data: d || {} };
    }, function (e) { return { ok: false, kind: 'network', message: String(e && e.message || e) }; });
  }

  var BUSINESS = [
    [/una partida abierta/i, 'Ya hay una partida abierta: ciérrala o anúlala antes de abrir otra.'],
    [/m[aá]ximo % viewers|m[aá]ximo \d+ viewers/i, 'Máximo de viewers por partida superado.'],
    [/no hay viewers elegibles/i, 'No hay viewers elegibles esperando en la fila.'],
    [/cupos est[aá]n ocupados/i, 'Los cupos están ocupados (llamados, confirmados o en turno).'],
    [/tres horas del evento terminaron/i, 'Las tres horas del evento terminaron.'],
    [/solo con la edici[oó]n en vivo/i, 'Esta acción solo se puede hacer con la edición en vivo.'],
    [/ya hay un resultado|ya tiene un resultado/i, 'La edición ya tiene un resultado: ya no se pueden cambiar partidas ni kills.'],
    [/el viewer figura desconectado/i, 'El viewer figura desconectado: confirma su reconexión antes de registrar más kills.'],
    [/solo suman kills los viewers con partida v[aá]lida/i, 'Solo suman kills los viewers con partida válida.'],
    [/kills solo se registran desde que inicia/i, 'Las kills se registran después de iniciar el Battle Bus.']
  ];
  function describe(r) {
    switch (r.kind) {
      case 'network': return 'No pudimos confirmar si la acción se completó (conexión). Vuelve a pulsarla: no se duplicará. El estado real se recarga.';
      case 'auth': return 'Tu sesión no es válida o esta cuenta no es administradora. Vuelve a iniciar sesión.';
      case 'denied': return 'Sin permiso para esta acción en Supabase.';
      case 'revision': return 'El reglamento cambió desde que lo leíste. Se recargó: revísalo y vuelve a intentarlo.';
      case 'conflict': return 'Esa operación ya se había usado con otro contenido. Se recargó el estado; inténtalo de nuevo.';
      case 'missing': return 'Esa función no está disponible en Supabase.';
      case 'business':
        for (var i = 0; i < BUSINESS.length; i++) if (BUSINESS[i][0].test(r.message || '')) return BUSINESS[i][1];
        return String(r.message || 'La acción no se pudo completar.').replace(/^svv:\s*/i, '').slice(0, 220);
      default: return 'Ocurrió un error inesperado. El estado real se recargó.';
    }
  }

  /* ------------------------------ puerta de acceso ------------------------------ */
  var GATE = {
    loading: ['Conectando con la Arena…', 'Verificando tu sesión.'],
    login: ['Panel de Geo', 'Inicia sesión con tu cuenta de Twitch de administrador para controlar Streamer vs Viewer V2.'],
    denied: ['Acceso restringido', 'Esta cuenta no tiene permisos de administrador (o la sesión expiró). El servidor es quien decide: no se muestra ningún control.'],
    error: ['No pudimos conectar', 'No se pudo leer el estado desde Supabase. Revisa tu conexión y reintenta.'],
    missing: ['Lectura administrativa no instalada', 'Falta instalar en Supabase la lectura del panel (sql/95_6a9_admin_read_rpc.sql). Sin ella el panel no puede ver la fila ni las partidas. No se muestra ninguna acción.'],
    config: ['Falta configuración', 'No se pudo cargar supabase-js o js/geoarmy-config.js.']
  };
  function setGate(state) {
    S.gate = state;
    var g = $('sva-gate'), ready = state === 'ready';
    show(g, !ready); show($('sva-app'), ready);
    if (!ready) {
      g.setAttribute('data-state', state);
      setText('sva-gate-title', GATE[state][0]); setText('sva-gate-msg', GATE[state][1]);
      show($('sva-gate-login'), state === 'login'); show($('sva-gate-retry'), state === 'error' || state === 'denied' || state === 'missing');
    }
    $('sva-ed-select').disabled = !ready; $('sva-refresh').disabled = !ready;
    if (!ready) setConn(state === 'loading' ? 'loading' : (state === 'error' ? 'offline' : 'idle'));
  }
  function setConn(state) {
    S.conn = state;
    var c = $('sva-conn'); if (!c) return;
    c.setAttribute('data-state', state);
    var txt = { loading: 'Conectando…', ok: 'En línea · ' + (S.lastOkAt ? fmtTime(S.lastOkAt) : ''), offline: 'Sin conexión', idle: 'Sin acceso' }[state] || '';
    setText('sva-conn-text', txt);
    var st = $('sva-stale');
    if (st) {
      var stale = state === 'offline' && !!S.panel;
      show(st, stale);
      if (stale) st.textContent = 'Sin conexión con Supabase desde ' + fmtTime(S.lastOkAt) + '. Mostramos el último estado conocido y las acciones están bloqueadas hasta recuperar la conexión: el navegador no decide nada.';
    }
  }

  /* ------------------------------ carga del estado (Supabase manda) ------------------------------ */
  function loadPanel() {
    if (!S.client || !S.userId) return Promise.resolve();
    if (S.loading) { S.again = true; return Promise.resolve(); }
    var key = S.eventKey, seq = ++S.req;
    S.loading = true;
    return rpcRaw('svv_admin_get_panel_state', key ? { p_event_key: key } : undefined).then(function (r) {
      S.loading = false;
      if (seq !== S.req || key !== S.eventKey || !S.userId) { schedulePoll(); return loadPanel(); }   // llegó tarde: se pide la edición/sesión actual
      if (r.ok) {
        S.panel = r.data; S.at = performance.now(); S.fails = 0; S.lastOkAt = Date.now();
        var ev = pe(); S.shownKey = ev ? ev.event_key : null;
        if (!S.eventKey && S.shownKey) S.eventKey = S.shownKey;   // la edición mostrada queda fija: el panel no salta de edición mientras trabajas
        if (S.gate !== 'ready') setGate('ready');
        setConn('ok'); renderAll(); maybeLoadSettle();
        var hd = $('sva-hist'); if (hd && hd.open && S.hist && !S.hist.loaded && !S.hist.loading && !S.hist.err) loadHist(true);   // se abrió antes de conocer la edición
      } else if (r.kind === 'auth' || r.kind === 'denied') {
        S.panel = null; setGate('denied'); S.rsig = {};
      } else if (r.kind === 'missing') {
        S.panel = null; setGate('missing'); S.rsig = {};
      } else {
        S.fails++;
        if (S.panel) { setConn('offline'); renderAll(); } else setGate('error');
      }
      schedulePoll();
      if (S.again) { S.again = false; return loadPanel(); }
    });
  }
  function pollDelay() {
    if (S.fails > 0) return Math.min(POLL_MAX_MS, POLL_FAST_MS * Math.pow(2, Math.min(S.fails, 3)));
    var ev = pe(); return ev && (ev.status === 'live' || (S.panel && S.panel.current_match)) ? POLL_FAST_MS : POLL_SLOW_MS;
  }
  function schedulePoll() {
    if (S.pollTimer) clearTimeout(S.pollTimer);
    if (!S.userId || (S.gate !== 'ready' && S.gate !== 'error')) { S.pollTimer = null; return; }
    S.pollTimer = setTimeout(function () { S.pollTimer = null; if (document.hidden) { schedulePoll(); return; } loadPanel(); }, pollDelay());
  }

  /* ------------------------------ confirmación (modal) ------------------------------ */
  // o: { title, body (texto o Node), ok, danger, reason:{label,min,max}, collect:fn }  ->  Promise<null | {reason, data}>
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      if (S.modalOpen) { resolve(null); return; }
      S.modalOpen = true;
      var root = $('sva-modal'), box = root.querySelector('.sva-modal__box'), ok = $('sva-modal-ok'), cancel = $('sva-modal-cancel');
      var rw = $('sva-modal-reason-w'), ri = $('sva-modal-reason'), err = $('sva-modal-err'), body = $('sva-modal-body');
      var prevFocus = document.activeElement, done = false;
      setText('sva-modal-title', o.title); clear(body);
      if (o.body && o.body.nodeType) body.appendChild(o.body); else body.appendChild(el('p', null, o.body || ''));
      show(rw, !!o.reason); ri.value = ''; show(err, false);
      if (o.reason) { setText('sva-modal-reason-l', o.reason.label || 'Motivo'); ri.maxLength = o.reason.max || 300; }
      ok.textContent = o.ok || 'Confirmar'; ok.disabled = false;
      ok.className = 'sva-btn ' + (o.danger ? 'sva-btn--danger' : 'sva-btn--primary');
      root.setAttribute('data-danger', o.danger ? '1' : '0');
      show(root, true);
      function close(val) {
        if (done) return; done = true; S.modalOpen = false; show(root, false);
        ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); $('sva-modal-bg').removeEventListener('click', onCancel); document.removeEventListener('keydown', onKey, true);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
        resolve(val);
      }
      function onOk() {
        if (done || ok.disabled) return;
        var reason = o.reason ? ri.value.trim() : null;
        var rmin = o.reason && o.reason.min != null ? o.reason.min : 3, rmax = o.reason && o.reason.max ? o.reason.max : 300;
        if (o.reason && (reason.length < rmin || reason.length > rmax)) {
          err.textContent = rmin ? 'Escribe un motivo de ' + rmin + ' a ' + rmax + ' caracteres.' : 'Máximo ' + rmax + ' caracteres.'; show(err, true); ri.focus(); return;
        }
        var data = o.collect ? o.collect() : null;
        if (o.validate) { var bad = o.validate(data); if (bad) { err.textContent = bad; show(err, true); return; } }
        ok.disabled = true;                                   // un solo envío por confirmación
        close({ reason: reason, data: data });
      }
      function onCancel() { close(null); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
        if (e.key === 'Tab') {   // el foco no sale del cuadro
          var f = box.querySelectorAll('button:not([disabled]), textarea, input, select, [tabindex="0"]'); f = [].filter.call(f, function (n) { return !n.closest('[hidden]'); });
          if (!f.length) return; var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); $('sva-modal-bg').addEventListener('click', onCancel); document.addEventListener('keydown', onKey, true);
      setTimeout(function () { (o.reason ? ri : (o.danger ? cancel : ok)).focus(); }, 0);
    });
  }

  /* ------------------------------ acciones (un envío a la vez, una clave por intención) ------------------------------ */
  var COOLDOWN_MS = 600;
  // tras cada acción el panel espera un instante: un doble clic no puede caer sobre el botón que cambia de sentido (abrir/cerrar) ni repetir una acción
  function canAct() { return S.conn === 'ok' && !S.busy && !S.modalOpen && S.gate === 'ready' && performance.now() >= S.coolUntil; }
  function sigFor(parts) { return [S.nonce].concat(parts).join('|'); }
  // La misma intención (misma acción, edición, contenido y turno de clic) reutiliza su clave mientras no se sepa el resultado:
  // si la red falló después de que Supabase la procesó, el reintento devuelve el mismo resultado (replayed) en vez de duplicar.
  function requestId(key, sig) {
    var now = Date.now(), p = S.pending[key];
    if (p && p.sig === sig && now - p.ts < REQ_TTL_MS) return p.id;
    S.pending = {};
    p = S.pending[key] = { id: uuid(), sig: sig, ts: now };
    return p.id;
  }
  // def: { key, rpc, args (sin p_event ni p_request), sig:[...], ok:(texto|fn), confirm:{...}, noEvent:bool, after:fn }
  function act(def) {
    if (!canAct()) return;
    var ev = pe(), eventId = ev ? ev.event_id : null;
    if (!def.noEvent && !eventId) return;
    if (def.confirm) {
      confirmDialog(def.confirm).then(function (r) { if (r) exec(def, eventId, r); else renderAll(); });
    } else exec(def, eventId, { reason: null, data: null });
  }
  function exec(def, eventId, r) {
    if (S.busy || S.gate !== 'ready') return;
    S.busy = true; renderAll();
    var args = typeof def.args === 'function' ? def.args(r) : (def.args || {});
    var sig = sigFor([def.key, eventId || ''].concat(def.sig ? (typeof def.sig === 'function' ? def.sig(r) : def.sig) : []).concat(JSON.stringify(args)));
    var full = {};
    if (!def.noEvent) full.p_event = eventId;
    full.p_request = requestId(def.key, sig);
    Object.keys(args).forEach(function (k) { full[k] = args[k]; });
    return rpcRaw(def.rpc, full).then(function (res) {
      S.busy = false; S.coolUntil = performance.now() + COOLDOWN_MS;
      setTimeout(function () { renderAll(); }, COOLDOWN_MS + 30);
      if (res.ok) {
        delete S.pending[def.key]; S.nonce++;
        var msg = typeof def.ok === 'function' ? def.ok(res.data) : (def.ok || 'Hecho.');
        toast('ok', res.data && res.data.replayed ? 'Esa acción ya estaba registrada (reintento): no se duplicó. Si querías repetirla, vuelve a pulsar.' : msg);
        if (def.after) def.after(res.data);
      } else if (res.kind === 'network') {
        toast('err', describe(res));                    // la clave se conserva: el reintento no duplica
      } else {
        delete S.pending[def.key]; S.nonce++;
        toast('err', describe(res));
      }
      renderAll();
      var okRes = !!res.ok;
      return loadPanel().then(function () { if (okRes && HIST_KEYS[def.key]) refreshHistory(); });
    });
  }
  var HIST_KEYS = { kill: 1, reverse_kill: 1, close_match: 1, void_match: 1, disconnect: 1, reconnect: 1, restore_void: 1 };

  /* ------------------------------ render ------------------------------ */
  function btn(text, cls, onClick, disabled) {
    var b = el('button', 'sva-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button';
    if (disabled || !canAct()) b.disabled = true;
    if (onClick) b.addEventListener('click', function () { if (!b.disabled) onClick(); });
    return b;
  }
  var DROP = { server_time: 1, response_seconds_left: 1, lobby_seconds_left: 1, live_seconds_remaining: 1, lobby_expired: 1, response_expired: 1 };
  function sigOf(obj, extra) { return JSON.stringify(obj, function (k, v) { return DROP[k] ? undefined : v; }) + '|' + (canAct() ? 1 : 0) + '|' + (S.busy ? 1 : 0) + '|' + (extra || ''); }
  function region(name, data, extra, fn) {
    var s = sigOf(data, extra);
    if (S.rsig[name] === s) return;
    S.rsig[name] = s; fn();
  }
  function renderAll() {
    if (S.gate !== 'ready' || !S.panel) return;
    var p = S.panel, ev = pe();
    // plazos: se cuentan desde que llegó la respuesta (el servidor decide el vencimiento real)
    S.cd.live = ev ? num(ev.live_seconds_remaining) : null; S.cd.liveOn = !!(ev && typeof ev.live_seconds_remaining === 'number');
    S.cd.q = {}; (p.queue || []).forEach(function (q) { if (q.status === 'called') S.cd.q[q.entry_id] = { s: num(q.response_seconds_left), x: !!q.response_expired }; });
    var cm = p.current_match; S.cd.lobby = cm && cm.phase === 'lobby' ? { s: num(cm.lobby_seconds_left), x: !!cm.lobby_expired } : null;
    renderSelect(); renderBoard(); renderEventCard(); renderMatch(); renderQueue(); renderTurns(); renderRecent(); renderHistory(); renderResult(); renderSettle(); renderAudit(); renderSetup();
    tick();
  }

  function renderSelect() {
    var sel = $('sva-ed-select'), eds = (S.panel && S.panel.editions) || [];
    region('select', { eds: eds, key: S.shownKey }, '', function () {
      clear(sel);
      if (!eds.length) { var o0 = el('option', null, 'Sin ediciones'); o0.value = ''; sel.appendChild(o0); return; }
      eds.forEach(function (e) {
        var o = el('option', null, (e.edition_number ? '#' + e.edition_number + ' · ' : (e.is_test ? 'Prueba · ' : '')) + e.event_key + ' — ' + (STATUS_ES[e.status] || e.status));
        o.value = e.event_key; if (e.event_key === S.shownKey) o.selected = true; sel.appendChild(o);
      });
    });
    sel.disabled = S.busy || S.conn !== 'ok' || !eds.length;
  }

  function renderBoard() {
    var p = S.panel, ev = pe(), sc = p.score || {}, g = num(sc.geo_points), v = num(sc.viewer_points);
    var b = $('sva-board'); b.setAttribute('data-leader', ev ? (g > v ? 'geo' : (g < v ? 'viewers' : 'tie')) : 'tie');
    var st = $('sva-b-status'); st.textContent = ev ? (STATUS_ES[ev.status] || ev.status) : 'Sin edición'; st.setAttribute('data-kind', ev ? ev.status : 'draft');
    setText('sva-b-edition', ev ? ((ev.edition_label || (ev.edition_number ? 'Edición #' + ev.edition_number : ev.event_key)) + (ev.is_test ? ' · prueba' : '')) : 'Crea una edición para empezar');
    var q = $('sva-b-queue'); var open = !!(ev && ev.queue_open); q.textContent = open ? 'Fila abierta' : 'Fila cerrada'; q.setAttribute('data-kind', open ? 'open' : 'closed');
    show($('sva-b-last'), !!(ev && ev.last_round_active));
    show($('sva-b-clock'), !!(ev && ev.status === 'live' && S.cd.liveOn));
    $('sva-s-geo').textContent = fmtInt(g); $('sva-s-vw').textContent = fmtInt(v);
    setText('sva-s-geo-k', fmtInt(num(sc.geo_kills))); setText('sva-s-vw-k', fmtInt(num(sc.viewer_kills)));
    setText('sva-b-lead', !ev ? '—' : (g > v ? 'Va ganando Geo por ' + fmtInt(g - v) : (g < v ? 'Van ganando los Viewers por ' + fmtInt(v - g) : 'Empate ' + fmtInt(g) + ' – ' + fmtInt(v))));
  }

  /* ---- control de la edición ---- */
  function renderEventCard() {
    var ev = pe(), p = S.panel;
    region('event', { ev: ev, res: p.result, m: !!p.current_match, turns: (p.turns || []).length }, '', function () {
      var hint = $('sva-ev-hint'), box = $('sva-ev-actions'); clear(box);
      if (!ev) { hint.textContent = 'No hay ediciones. Crea la primera en «Preparar edición y reglamento».'; return; }
      var st = ev.status, hasOpen = !!p.current_match, activeTurns = (p.turns || []).length;
      var H = {
        draft: 'Borrador: guarda y publica el reglamento, y luego programa el inicio (en «Preparar edición y reglamento»).',
        scheduled: 'Programada: puedes abrir las inscripciones; cuando estés listo, pasa la edición a en vivo (inicia las 3 horas).',
        live: 'En vivo: llama a los viewers, prepara partidas y registra kills. Geo ×2 · Viewers ×1.',
        finished: 'Finalizada: calcula y confirma el resultado (tarjeta «Resultado»).',
        settled: 'Liquidada.', cancelled: 'Edición cancelada' + (ev.cancel_reason ? ': ' + ev.cancel_reason : '.')
      };
      hint.textContent = H[st] || '';
      if (st === 'scheduled' || st === 'live') {
        var open = !!ev.queue_open;
        box.appendChild(btn(open ? 'Cerrar inscripciones' : 'Abrir inscripciones', open ? '' : 'sva-btn--primary', function () {
          act({ key: 'set_queue_open', rpc: 'svv_admin_set_queue_open', args: { p_open: !open }, ok: open ? 'Inscripciones cerradas.' : 'Inscripciones abiertas.' });
        }, ev.last_round_active && !open));
      }
      if (st === 'scheduled') box.appendChild(btn('Pasar a EN VIVO…', 'sva-btn--primary', function () {
        act({ key: 'go_live', rpc: 'svv_admin_go_live', ok: 'La edición está en vivo: corren las 3 horas.',
          confirm: { title: 'Pasar la edición a EN VIVO', body: 'Se inicia el reloj de 3 horas. Esta acción no se puede deshacer.', ok: 'Sí, ir en vivo', danger: true } });
      }));
      if (st === 'live') {
        box.appendChild(btn(ev.last_round_active ? 'Última ronda activada' : 'Activar Última ronda…', 'sva-btn--warn', function () {
          act({ key: 'last_round', rpc: 'svv_admin_activate_last_round', args: { p_confirm: true }, ok: 'Última ronda activada: las inscripciones se cerraron.',
            confirm: { title: 'Activar la Última ronda', body: 'Se cierran las inscripciones de forma IRREVERSIBLE. Quienes ya esperan seguirán siendo atendidos.', ok: 'Sí, activar', danger: true } });
        }, !!ev.last_round_active));
        box.appendChild(btn('Finalizar edición…', 'sva-btn--danger', function () {
          act({ key: 'finish_event', rpc: 'svv_admin_finish_event', ok: 'Edición finalizada.',
            confirm: { title: 'Finalizar la edición', body: 'Pasa a «Finalizada» y liquida inscripciones pendientes. Requiere 0 partidas abiertas y 0 turnos activos. No se puede deshacer.', ok: 'Sí, finalizar', danger: true } });
        }, hasOpen || activeTurns > 0));
        if (hasOpen || activeTurns > 0) box.appendChild(el('p', 'sva-hint sva-hint--inline', hasOpen ? 'Cierra o anula la partida abierta para poder finalizar.' : 'Termina o libera los turnos activos para poder finalizar.'));
      }
      if (st === 'draft' || st === 'scheduled' || st === 'live') box.appendChild(btn('Cancelar edición…', 'sva-btn--danger', function () {
        act({ key: 'cancel_event', rpc: 'svv_admin_cancel_event', args: function (r) { return { p_reason: r.reason }; }, ok: 'Edición cancelada.',
          confirm: { title: 'Cancelar la edición', body: 'La edición pasa a «Cancelada» (no se puede deshacer). Con partidas abiertas o turnos activos primero hay que anularlos/liberarlos.', ok: 'Cancelar edición', danger: true, reason: { label: 'Motivo (3 a 300 caracteres)', min: 3, max: 300 } } });
      }));
    });
  }

  /* ---- fila ---- */
  function renderQueue() {
    var p = S.panel, ev = pe(), q = p.queue || [], c = p.counts || {};
    var openMatch = !!p.current_match;
    region('queue', { q: q, c: c, st: ev && ev.status, sel: S.sel, om: openMatch }, '', function () {
      setText('sva-q-count', ev ? 'esperando ' + num(c.waiting) + ' · llamados ' + num(c.called) + ' · confirmados ' + num(c.confirmed) + ' · cupos ' + num(c.slots_used) + '/' + num(c.slots_max || 3) : '');
      var act0 = $('sva-q-actions'), list = $('sva-queue'); clear(act0); clear(list);
      var live = !!(ev && ev.status === 'live');
      act0.appendChild(btn('Llamar al siguiente', 'sva-btn--primary sva-btn--lg', function () {
        act({ key: 'call_next', rpc: 'svv_admin_call_next', ok: function (d) { return 'Llamaste a ' + nameOf(d.entry_id) + ': tiene ' + (d.response_seconds || 120) + ' s para confirmar.'; } });
      }, !live));
      act0.appendChild(btn('Barrer vencidos', '', function () {
        act({ key: 'sweep', rpc: 'svv_admin_sweep', ok: function (d) { return 'Barrido: ' + num(d.expired_count) + ' vencido(s), ' + num(d.requeued_count) + ' vuelven al final de la fila.'; } });
      }, !(ev && (ev.status === 'live' || ev.status === 'finished'))));
      show($('sva-queue-empty'), !q.length);
      q.forEach(function (e, i) {
        var li = el('li', 'sva-q'); li.setAttribute('data-status', e.status);
        li.appendChild(el('span', 'sva-q__pos', String(i + 1)));
        var who = el('div', 'sva-q__who'); who.appendChild(el('b', null, e.name || 'Viewer')); if (e.twitch_login && e.twitch_login !== e.name) who.appendChild(el('small', null, '@' + e.twitch_login));
        li.appendChild(who);
        var meta = el('div', 'sva-q__meta');
        meta.appendChild(el('span', 'sva-chip', Q_ES[e.status] || e.status));
        if (e.status === 'called') { var cd = el('span', 'sva-chip sva-chip--time'); cd.setAttribute('data-cd', 'q:' + e.entry_id); meta.appendChild(cd); }
        if (e.status === 'waiting' && e.eligible === false) meta.appendChild(el('span', 'sva-chip sva-chip--warn', 'No elegible por ahora'));
        meta.appendChild(el('span', 'sva-chip sva-chip--dim', 'Partidas jugadas ' + num(e.matches_consumed) + '/' + num(ev && ev.max_matches_per_turn || 2)));
        li.appendChild(meta);
        if (e.status !== 'in_turn') {
          var rm = btn('Quitar…', 'sva-btn--ghost sva-btn--sm', function () {
            act({ key: 'remove', rpc: 'svv_admin_remove_from_queue', sig: [e.entry_id], args: function (r) { return { p_entry: e.entry_id, p_reason: r.reason }; }, ok: 'Retiraste a ' + (e.name || 'el viewer') + ' de la fila.',
              confirm: { title: 'Quitar de la fila a ' + (e.name || 'este viewer'), body: 'Sale de la fila (no se puede deshacer; podrá volver a inscribirse si la fila lo permite).', ok: 'Quitar', danger: true, reason: { label: 'Motivo (3 a 300 caracteres)', min: 3, max: 300 } } });
          }, !(ev && (ev.status === 'live' || ev.status === 'scheduled')));
          li.appendChild(rm);
        }
        list.appendChild(li);
      });
    });
  }
  function nameOf(entryId) {
    var q = (S.panel && S.panel.queue || []).filter(function (e) { return e.entry_id === entryId; })[0];
    return q ? (q.name || 'el viewer') : 'el siguiente viewer';
  }

  /* ---- turnos activos ---- */
  function renderTurns() {
    var p = S.panel, ev = pe(), turns = p.turns || [];
    region('turns', { t: turns, st: ev && ev.status }, '', function () {
      var ul = $('sva-turns'); clear(ul); show($('sva-turns-empty'), !turns.length);
      turns.forEach(function (t) {
        var li = el('li', 'sva-row');
        var who = el('div', 'sva-row__main'); who.appendChild(el('b', null, t.name || 'Viewer'));
        who.appendChild(el('small', null, 'Partidas ' + num(t.matches_used) + '/' + num(t.matches_max) + (t.in_open_match ? ' · en la partida abierta' : '')));
        li.appendChild(who);
        var a = el('div', 'sva-row__act');
        a.appendChild(btn('Terminar turno', 'sva-btn--sm', function () {
          act({ key: 'finish_turn', rpc: 'svv_admin_finish_turn', sig: [t.turn_id], args: { p_turn: t.turn_id }, ok: 'Turno terminado.',
            confirm: { title: 'Terminar el turno de ' + (t.name || 'este viewer'), body: 'El viewer deja de tener turno activo. No se puede deshacer.', ok: 'Terminar turno', danger: true } });
        }, !!t.in_open_match));
        a.appendChild(btn('Liberar…', 'sva-btn--ghost sva-btn--sm', function () {
          act({ key: 'release_turn', rpc: 'svv_admin_release_turn', sig: [t.turn_id], args: function (r) { return { p_turn: t.turn_id, p_reason: r.reason }; }, ok: 'Turno liberado.',
            confirm: { title: 'Liberar el turno de ' + (t.name || 'este viewer'), body: 'Se libera el turno sin contarlo como jugado. No se puede deshacer.', ok: 'Liberar turno', danger: true, reason: { label: 'Motivo (3 a 300 caracteres)', min: 3, max: 300 } } });
        }, !!t.in_open_match));
        li.appendChild(a); ul.appendChild(li);
      });
    });
  }

  /* ---- partida actual ---- */
  function playerChips(pl) {
    var c = el('div', 'sva-q__meta');
    c.appendChild(el('span', 'sva-chip', pl.side === 'geo' ? 'Geo ×2' : 'Viewer ×1'));
    if (pl.side === 'viewer') {
      var v = el('span', 'sva-chip', VALID_ES[pl.validity] || pl.validity || '—'); v.setAttribute('data-valid', pl.validity || ''); c.appendChild(v);
      c.appendChild(el('span', 'sva-chip ' + (pl.entered_at ? 'sva-chip--ok' : 'sva-chip--dim'), pl.entered_at ? 'Entró al lobby' : 'Aún no entra'));
      if (pl.absent) c.appendChild(el('span', 'sva-chip sva-chip--bad', 'Desconectado'));
      if (num(pl.disconnects) || num(pl.reconnects)) c.appendChild(el('span', 'sva-chip sva-chip--dim', 'Desc. ' + num(pl.disconnects) + ' · Recon. ' + num(pl.reconnects)));
    }
    return c;
  }
  function killButtons(m, pl) {
    var box = el('div', 'sva-kills');
    [1, 2, 3].forEach(function (n) {
      var b = btn('+' + n, 'sva-btn--kill', function () {
        act({ key: 'kill', rpc: 'svv_admin_record_kill', sig: [pl.player_id, n], args: { p_match: m.match_id, p_player: pl.player_id, p_kills: n, p_note: null },
          ok: '+' + n + ' kill' + (n > 1 ? 's' : '') + ' para ' + (pl.name || (pl.side === 'geo' ? 'Geo' : 'viewer')) + '.' });
      });
      b.setAttribute('aria-label', 'Sumar ' + n + ' kill(s) a ' + (pl.name || ''));
      box.appendChild(b);
    });
    box.appendChild(btn('Otra cantidad…', 'sva-btn--ghost sva-btn--sm', function () {
      var inp = el('input'); inp.type = 'number'; inp.min = '1'; inp.max = '100'; inp.step = '1'; inp.value = '4'; inp.setAttribute('inputmode', 'numeric'); inp.id = 'sva-kills-n';
      var body = el('div'); body.appendChild(el('p', null, 'Kills a sumar a ' + (pl.name || '') + ' (1 a 100).')); body.appendChild(inp);
      act({ key: 'kill', rpc: 'svv_admin_record_kill', sig: function (r) { return [pl.player_id, r.data]; }, args: function (r) { return { p_match: m.match_id, p_player: pl.player_id, p_kills: r.data, p_note: null }; },
        ok: 'Kills registradas.',
        confirm: { title: 'Registrar kills', body: body, ok: 'Registrar', collect: function () { return parseInt(inp.value, 10); },
          validate: function (d) { return (d >= 1 && d <= 100) ? null : 'Escribe un número entero de 1 a 100.'; } } });
    }));
    return box;
  }
  function killLog(m, canReverse, kills) {
    var ks = kills || []; if (!ks.length) return null;
    var ul = el('ul', 'sva-klog');
    ks.forEach(function (k) {
      var li = el('li', k.reversed ? 'is-reversed' : (k.reverses_id ? 'is-fix' : '')); li.setAttribute('data-kill', k.kill_id);
      var who = (m.players || []).filter(function (x) { return x.player_id === k.player_id; })[0];
      li.appendChild(el('span', null, (who ? (who.name || 'Seat ' + who.seat) : 'Seat ' + k.seat) + ' · ' + (k.kills_delta > 0 ? '+' : '') + k.kills_delta + ' kill' + (Math.abs(k.kills_delta) === 1 ? '' : 's') + ' · ' + (k.points_delta > 0 ? '+' : '') + k.points_delta + ' pts' + (k.reversed ? ' · corregida' : (k.reverses_id ? ' · corrección' : ''))));
      li.appendChild(el('time', null, fmtTime(k.registered_at)));
      if (canReverse && !k.reversed && !k.reverses_id && k.kills_delta > 0) li.appendChild(btn('Corregir…', 'sva-btn--ghost sva-btn--xs', function () {
        act({ key: 'reverse_kill', rpc: 'svv_admin_reverse_kill', sig: [k.kill_id], args: function (r) { return { p_kill: k.kill_id, p_reason: r.reason }; }, ok: 'Kill corregida (se restó).',
          confirm: { title: 'Corregir esta kill', body: 'Se registra una resta que compensa estas ' + k.kills_delta + ' kill(s). El registro original queda en el historial.', ok: 'Corregir', danger: true, reason: { label: 'Motivo (3 a 300 caracteres)', min: 3, max: 300 } } });
      }));
      ul.appendChild(li);
    });
    return ul;
  }

  /* ---- lecturas bajo demanda (historial). Nunca se consultan en el sondeo periódico. ---- */
  var HIST_PAGE = 10, HIST_MAX = 50, KILLS_PAGE = 25, KILLS_MAX = 100;
  function newHist() { return { filter: '', items: [], hasMore: false, next: null, total: null, loading: false, err: null, loaded: false, gen: 0, dirty: false }; }
  function mkOf(id) { return S.mk[id] || (S.mk[id] = { open: false, items: [], hasMore: false, nextAt: null, nextId: null, total: null, loading: false, err: null, loaded: false, dirty: false }); }
  function resetHistory(closeIt) {
    S.hist = newHist(); S.mk = {}; S.restored = {};
    var d = $('sva-hist'); if (d && closeIt) d.open = false;
  }
  function readErr(r) {
    if (r.kind === 'missing') return 'Falta instalar la lectura de historial en Supabase (SQL 95).';
    if (r.kind === 'network') return 'Sin conexión con el servidor. Pulsa «Actualizar» para reintentar.';
    return describe(r);
  }
  function mergeBy(list, rows, idKey) {
    var seen = {}; list.forEach(function (x) { seen[x[idKey]] = 1; });
    rows.forEach(function (x) { if (!seen[x[idKey]]) { seen[x[idKey]] = 1; list.push(x); } });
    return list;
  }
  function loadHist(reset) {
    var h = S.hist, key = S.eventKey;
    if (!h || !S.client || !S.userId || !key) return Promise.resolve();
    if (h.loading) { if (reset) h.dirty = true; return Promise.resolve(); }
    var gen = h.gen, limit = reset ? Math.min(HIST_MAX, Math.max(HIST_PAGE, h.items.length + 2)) : HIST_PAGE;   // al recargar en sitio se pide lo ya visible (+2 por si se cerró/anuló alguna), con tope
    var args = { p_event_key: key, p_limit: limit };
    if (h.filter) args.p_status = h.filter;
    if (!reset && h.next != null) args.p_before_seq = h.next;
    h.loading = true; h.err = null; renderAll();
    return rpcRaw('svv_admin_list_matches', args).then(function (r) {
      if (S.hist !== h || h.gen !== gen || key !== S.eventKey) return;        // llegó tarde (otra edición, otro filtro o sesión)
      h.loading = false;
      if (r.ok) {
        var d = r.data, rows = Array.isArray(d.matches) ? d.matches : [];
        h.items = reset ? rows.slice() : mergeBy(h.items, rows, 'match_id');
        h.hasMore = !!d.has_more; h.next = (d.next_before_seq == null ? null : d.next_before_seq); h.total = (typeof d.total === 'number' ? d.total : null); h.loaded = true; h.err = null;
      } else {
        h.err = readErr(r);
        if (r.kind === 'auth' || r.kind === 'denied') loadPanel();
      }
      if (h.dirty) { h.dirty = false; return loadHist(true); }
      renderAll();
    });
  }
  function loadKills(id, reset) {
    var k = mkOf(id), key = S.eventKey;
    if (!S.client || !S.userId || !key) return Promise.resolve();
    if (k.loading) { if (reset) k.dirty = true; return Promise.resolve(); }
    var limit = reset ? Math.min(KILLS_MAX, Math.max(KILLS_PAGE, k.items.length + 5)) : KILLS_PAGE;   // idem (+5: una corrección añade una anotación)
    var args = { p_event_key: key, p_match: id, p_limit: limit };
    if (!reset && k.nextAt && k.nextId) { args.p_before_at = k.nextAt; args.p_before_id = k.nextId; }
    k.loading = true; k.err = null; renderAll();
    return rpcRaw('svv_admin_list_match_kills', args).then(function (r) {
      if (S.mk[id] !== k || key !== S.eventKey) return;
      k.loading = false;
      if (r.ok) {
        var d = r.data, rows = Array.isArray(d.kills) ? d.kills : [];
        k.items = reset ? rows.slice() : mergeBy(k.items, rows, 'kill_id');
        k.hasMore = !!d.has_more; k.nextAt = d.next_before_at || null; k.nextId = d.next_before_id || null; k.total = (typeof d.kills_total === 'number' ? d.kills_total : null); k.loaded = true; k.err = null;
      } else {
        k.err = readErr(r);
        if (r.kind === 'auth' || r.kind === 'denied') loadPanel();
      }
      if (k.dirty) { k.dirty = false; return loadKills(id, true); }
      renderAll();
    });
  }
  function openKills(id) { var k = mkOf(id); k.open = true; if (!k.loaded) loadKills(id, true); else renderAll(); }
  function closeKills(id) { var k = mkOf(id); k.open = false; renderAll(); }
  // tras una escritura relevante: se recarga en sitio solo lo que la persona ya tiene abierto
  function refreshHistory() {
    var d = $('sva-hist');
    if (S.hist && S.hist.loaded && d && d.open) loadHist(true);
    Object.keys(S.mk).forEach(function (id) { if (S.mk[id].open) loadKills(id, true); });
  }
  function readBtn(text, cls, onClick, disabled) {         // botones de LECTURA: no dependen de canAct (no escriben); solo de sesión lista y sin diálogo abierto
    var b = el('button', 'sva-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button';
    if (disabled || S.gate !== 'ready' || S.modalOpen) b.disabled = true;
    b.addEventListener('click', function () { if (!b.disabled) onClick(); });
    return b;
  }
  function killsBox(m, canRev) {                           // kills de una partida, paginadas
    var k = mkOf(m.match_id), box = el('div', 'sva-kbox');
    var ul = killLog(m, canRev, k.items);
    if (ul) box.appendChild(ul);
    else if (k.loaded && !k.err) box.appendChild(el('p', 'sva-hint', 'Esta partida no tiene kills registradas.'));
    if (k.loading) box.appendChild(el('p', 'sva-hint', 'Cargando kills…'));
    if (k.err) { var em = el('p', 'sva-form__msg', k.err); em.setAttribute('data-kind', 'err'); em.setAttribute('role', 'alert'); box.appendChild(em); }
    if (k.loaded && k.total != null) box.appendChild(el('small', 'sva-hint', 'Mostrando ' + k.items.length + ' de ' + k.total + ' anotaciones.'));
    var row = el('div', 'sva-row__act');
    if (k.hasMore) row.appendChild(readBtn('Cargar más kills', 'sva-btn--sm', function () { loadKills(m.match_id, false); }, k.loading));
    row.appendChild(readBtn('Actualizar', 'sva-btn--ghost sva-btn--xs', function () { loadKills(m.match_id, true); }, k.loading));
    row.appendChild(readBtn('Ocultar', 'sva-btn--ghost sva-btn--xs', function () { closeKills(m.match_id); }));
    box.appendChild(row);
    return box;
  }
  function killsSection(m, canRev, inline) {
    var n = num(m.kills_total), k = S.mk[m.match_id], ks = m.kills || [];
    if (inline) {
      if (!n && !ks.length) return null;
      var w = el('div');
      w.appendChild(el('h3', 'sva-h3', 'Kills de esta partida'));
      if (k && k.open) { w.appendChild(killsBox(m, canRev)); return w; }
      var ul = killLog(m, canRev, ks); if (ul) w.appendChild(ul);
      if (m.kills_has_more || n > ks.length) w.appendChild(readBtn('Ver todas las kills (' + n + ')', 'sva-btn--ghost sva-btn--sm', function () { openKills(m.match_id); }));
      return w;
    }
    var wrap = el('div', 'sva-rec__kills');
    if (k && k.open) wrap.appendChild(killsBox(m, canRev));
    else if (n > 0) wrap.appendChild(readBtn('Ver kills (' + n + ')', 'sva-btn--ghost sva-btn--xs', function () { openKills(m.match_id); }));
    else wrap.appendChild(el('small', 'sva-hint', 'Sin kills registradas.'));
    return wrap;
  }
  function renderMatch() {
    var p = S.panel, ev = pe(), m = p.current_match, hasResult = !!(p.result && p.result.resolution_status);
    var prep = (p.queue || []).filter(function (e) { return e.status === 'confirmed' || e.status === 'in_turn'; });
    region('match', { m: m, ev: ev && [ev.status, ev.max_viewers_per_match], prep: m ? null : prep, sel: S.sel, res: hasResult, mk: m ? S.mk[m.match_id] : null }, '', function () {
      var root = $('sva-match'); clear(root);
      var live = !!(ev && ev.status === 'live');
      if (!m) {
        var max = num(ev && ev.max_viewers_per_match) || 3;
        root.appendChild(el('p', 'sva-hint', !ev ? 'Sin edición.' : (live ? 'No hay una partida abierta. Elige de 1 a ' + max + ' viewers confirmados para prepararla.' : 'Las partidas se preparan cuando la edición está en vivo.')));
        if (live) {
          if (!prep.length) root.appendChild(el('p', 'sva-empty', 'Nadie confirmado todavía: llama al siguiente viewer desde la fila.'));
          var ul = el('ul', 'sva-pick');
          prep.forEach(function (e) {
            var li = el('li'), lab = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.sel[e.entry_id]; cb.disabled = !canAct();
            cb.addEventListener('change', function () {
              if (cb.checked && Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).length >= max) { cb.checked = false; toast('err', 'Máximo ' + max + ' viewers por partida.'); return; }
              if (cb.checked) S.sel[e.entry_id] = true; else delete S.sel[e.entry_id];
              S.rsig.match = null; renderMatch();
            });
            lab.appendChild(cb); lab.appendChild(el('b', null, e.name || 'Viewer')); lab.appendChild(el('span', 'sva-chip', Q_ES[e.status] || e.status));
            li.appendChild(lab); ul.appendChild(li);
          });
          root.appendChild(ul);
          var ids = prep.map(function (e) { return e.entry_id; }).filter(function (id) { return S.sel[id]; });
          var open = btn(ids.length ? 'Preparar partida con ' + ids.length + ' viewer' + (ids.length > 1 ? 's' : '') : 'Elige viewers', 'sva-btn--primary sva-btn--lg', function () {
            act({ key: 'open_match', rpc: 'svv_admin_open_match', sig: ids, args: { p_entries: ids }, ok: 'Partida preparada.', after: function () { S.sel = {}; } });
          }, !ids.length || hasResult);
          root.appendChild(open);
        }
        return;
      }
      // partida abierta
      var phaseIdx = m.phase === 'preparing' ? 0 : (m.phase === 'lobby' ? 1 : 2);
      var head = el('div', 'sva-mhead');
      head.appendChild(el('b', null, 'Partida #' + m.match_seq + ' · ' + (MODE_ES[m.mode] || m.mode || '')));
      head.appendChild(el('span', 'sva-pill', PHASE_ES[phaseIdx])); root.appendChild(head);
      var steps = el('ol', 'sva-steps'); ['Preparada', 'Lobby listo', 'Battle Bus'].forEach(function (t, i) { var li = el('li', i < phaseIdx ? 'is-done' : (i === phaseIdx ? 'is-now' : ''), t); steps.appendChild(li); }); root.appendChild(steps);
      if (m.phase === 'lobby') {
        var lc = el('p', 'sva-lobbyclock'); lc.appendChild(document.createTextNode('Entrada al lobby: ')); var b2 = el('b'); b2.setAttribute('data-cd', 'lobby'); lc.appendChild(b2); root.appendChild(lc);
      }
      var pend = (m.players || []).filter(function (x) { return x.side === 'viewer' && !x.entered_at && x.validity === 'pending'; });
      var list = el('ul', 'sva-players');
      (m.players || []).forEach(function (pl) {
        var li = el('li', 'sva-player'); li.setAttribute('data-side', pl.side);
        var top = el('div', 'sva-player__top');
        top.appendChild(el('b', 'sva-player__name', (pl.name || (pl.side === 'geo' ? 'Geo' : 'Viewer'))));
        top.appendChild(el('span', 'sva-player__pts', num(pl.kills) + ' kills · ' + num(pl.points) + ' pts'));
        li.appendChild(top); li.appendChild(playerChips(pl));
        var acts = el('div', 'sva-player__act');
        if (m.phase === 'lobby' && pl.side === 'viewer' && !pl.entered_at && pl.validity === 'pending') {
          acts.appendChild(btn('Marcar entrada al lobby', 'sva-btn--sm', function () {
            act({ key: 'lobby_in', rpc: 'svv_admin_record_lobby_entries', sig: [pl.player_id], args: { p_match: m.match_id, p_players: [pl.player_id] }, ok: (pl.name || 'El viewer') + ' entró al lobby.' });
          }, !!m.lobby_expired));
        }
        if (m.phase === 'bus_started') {
          var canKill = pl.side === 'geo' || (pl.validity === 'valid' && !pl.absent);
          if (canKill) acts.appendChild(killButtons(m, pl));
          else if (pl.side === 'viewer') acts.appendChild(el('small', 'sva-hint', pl.absent ? 'Desconectado: confirma su reconexión para seguir sumando.' : 'No suma kills (partida no válida).'));
          if (pl.side === 'viewer' && pl.validity === 'valid') {
            if (pl.absent) acts.appendChild(btn('Confirmar reconexión', 'sva-btn--sm sva-btn--primary', function () {
              act({ key: 'reconnect', rpc: 'svv_admin_confirm_reconnect', sig: [pl.player_id], args: { p_match: m.match_id, p_player: pl.player_id, p_note: null }, ok: (pl.name || 'El viewer') + ' volvió a la partida.' });
            }));
            else acts.appendChild(btn('Se desconectó…', 'sva-btn--ghost sva-btn--sm', function () {
              act({ key: 'disconnect', rpc: 'svv_admin_record_disconnect', sig: [pl.player_id], args: { p_match: m.match_id, p_player: pl.player_id, p_note: null }, ok: 'Desconexión registrada.',
                confirm: { title: (pl.name || 'El viewer') + ' se desconectó', body: 'Se registra la desconexión: mientras no se confirme su reconexión no suma kills.', ok: 'Registrar desconexión', danger: true } });
            }));
          }
        }
        if (acts.firstChild) li.appendChild(acts);
        list.appendChild(li);
      });
      root.appendChild(list);
      var main = el('div', 'sva-actions sva-actions--match');
      if (m.phase === 'preparing') main.appendChild(btn('Lobby listo · iniciar ' + num(m.lobby_entry_seconds || (ev && ev.lobby_entry_seconds) || 180) + ' s', 'sva-btn--primary sva-btn--lg', function () {
        act({ key: 'lobby_ready', rpc: 'svv_admin_set_lobby_ready', sig: [m.match_id], args: { p_match: m.match_id }, ok: 'Lobby listo: corre el plazo de entrada.' });
      }));
      if (m.phase === 'lobby') {
        var anyIn = (m.players || []).some(function (x) { return x.side === 'viewer' && x.entered_at; });
        if (pend.length > 1) main.appendChild(btn('Entraron todos (' + pend.length + ')', 'sva-btn--sm', function () {
          act({ key: 'lobby_in', rpc: 'svv_admin_record_lobby_entries', sig: pend.map(function (x) { return x.player_id; }), args: { p_match: m.match_id, p_players: pend.map(function (x) { return x.player_id; }) }, ok: 'Entradas al lobby registradas.' });
        }, !!m.lobby_expired));
        main.appendChild(btn('Iniciar Battle Bus…', 'sva-btn--primary sva-btn--lg', function () {
          var entered = (m.players || []).filter(function (x) { return x.side === 'viewer' && x.entered_at; });
          var absent = (m.players || []).filter(function (x) { return x.side === 'viewer' && !x.entered_at; });
          var body = el('div'); body.appendChild(el('p', null, 'Marca quién está presente. Quien NO esté marcado queda como inválido en esta partida y no suma kills. Esta decisión no se puede deshacer.'));
          var ul2 = el('ul', 'sva-pick');
          entered.forEach(function (x) { var li = el('li'), lab = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = true; cb.value = x.player_id; lab.appendChild(cb); lab.appendChild(el('b', null, x.name || 'Viewer')); li.appendChild(lab); ul2.appendChild(li); });
          body.appendChild(ul2);
          if (absent.length) body.appendChild(el('p', 'sva-hint', 'Sin entrada registrada (quedarán inválidos): ' + absent.map(function (x) { return x.name || 'Viewer'; }).join(', ') + '.'));
          act({ key: 'start_bus', rpc: 'svv_admin_start_bus', sig: function (r) { return r.data; }, args: function (r) { return { p_match: m.match_id, p_present: r.data }; }, ok: 'Battle Bus iniciado: ya se registran kills.',
            confirm: { title: 'Iniciar el Battle Bus', body: body, ok: 'Iniciar Battle Bus', danger: true,
              collect: function () { return [].map.call(body.querySelectorAll('input[type=checkbox]:checked'), function (c) { return c.value; }); },
              validate: function (d) { return d.length ? null : 'Marca al menos un viewer presente (o cancela y anula la partida).'; } } });
        }, !anyIn));
      }
      if (m.phase === 'bus_started') main.appendChild(btn('Cerrar partida…', 'sva-btn--primary sva-btn--lg', function () {
        act({ key: 'close_match', rpc: 'svv_admin_close_match', sig: [m.match_id], args: { p_match: m.match_id }, ok: 'Partida cerrada.',
          confirm: { title: 'Cerrar la partida #' + m.match_seq, body: 'Quedan firmadas las kills de esta partida (Geo ' + num(m.geo_points) + ' pts · Viewers ' + num(m.viewer_points) + ' pts). No se puede deshacer.', ok: 'Cerrar partida', danger: true } });
      }));
      main.appendChild(btn('Anular partida…', 'sva-btn--danger', function () {
        act({ key: 'void_match', rpc: 'svv_admin_void_match', sig: [m.match_id], args: function (r) { return { p_match: m.match_id, p_reason: r.reason }; }, ok: 'Partida anulada.',
          confirm: { title: 'Anular la partida #' + m.match_seq, body: 'Falla general (caída de servidor, lobby roto…). La partida no cuenta para el marcador. No se puede deshacer.', ok: 'Anular partida', danger: true, reason: { label: 'Motivo (3 a 300 caracteres)', min: 3, max: 300 } } });
      }));
      root.appendChild(main);
      var ksec = killsSection(m, live && !hasResult, true); if (ksec) root.appendChild(ksec);
    });
  }

  /* ---- partidas recientes + historial ---- */
  function restorable(m, x, ev, hasResult) {
    return m.status === 'voided' && !!m.bus_started_at && x.side === 'viewer' && x.validity === 'valid' && !!ev && ev.status === 'live' && !hasResult;
  }
  function matchRow(m, ev, hasResult) {
    var li = el('li', 'sva-rec'); li.setAttribute('data-status', m.status); li.setAttribute('data-seq', m.match_seq);
    var h = el('div', 'sva-rec__h'); h.appendChild(el('b', null, '#' + m.match_seq + ' · ' + (m.status === 'voided' ? 'Anulada' : 'Cerrada')));
    h.appendChild(el('span', null, 'Geo ' + num(m.geo_points) + ' · Viewers ' + num(m.viewer_points))); li.appendChild(h);
    li.appendChild(el('small', null, (m.players || []).filter(function (x) { return x.side === 'viewer'; }).map(function (x) { return (x.name || 'Viewer') + ' (' + num(x.kills) + ')'; }).join(', ') || 'Solo Geo'));
    if (m.status === 'voided') {
      if (m.void_reason) li.appendChild(el('small', 'sva-rec__why', 'Motivo: ' + m.void_reason));
      var ra = el('div', 'sva-row__act');
      (m.players || []).filter(function (x) { return restorable(m, x, ev, hasResult); }).forEach(function (x) {
        var rk = m.match_id + ':' + x.profile_id;
        if (S.restored[rk]) { ra.appendChild(el('small', 'sva-hint', 'Oportunidad de ' + (x.name || 'viewer') + ' restaurada.')); return; }
        ra.appendChild(btn('Restaurar oportunidad: ' + (x.name || 'viewer') + '…', 'sva-btn--ghost sva-btn--xs', function () {
          act({ key: 'restore_void', rpc: 'svv_admin_restore_void', sig: [m.match_id, x.profile_id], args: { p_match: m.match_id, p_profile: x.profile_id }, ok: 'Oportunidad restaurada: ' + (x.name || 'el viewer') + ' vuelve a la fila.',
            after: function () { S.restored[rk] = true; },
            confirm: { title: 'Restaurar la oportunidad de ' + (x.name || 'este viewer'), body: 'Como la partida se anuló por una falla general, vuelve a la fila para jugar de nuevo. No se puede deshacer.', ok: 'Restaurar', danger: true } });
        }));
      });
      if (ra.firstChild) li.appendChild(ra);
    }
    li.appendChild(killsSection(m, !!ev && ev.status === 'live' && !hasResult && m.status === 'closed', false));
    return li;
  }
  function renderRecent() {
    var p = S.panel, ev = pe(), rec = p.recent_matches || [], hasResult = !!(p.result && p.result.resolution_status);
    region('recent', { r: rec, st: ev && ev.status, res: hasResult, mk: S.mk, rs: S.restored }, '', function () {
      var ul = $('sva-recent'); clear(ul); show($('sva-recent-empty'), !rec.length);
      rec.forEach(function (m) { ul.appendChild(matchRow(m, ev, hasResult)); });
    });
  }
  function renderHistory() {
    var h = S.hist; if (!h || !$('sva-h-list')) return;
    var p = S.panel, ev = pe(), hasResult = !!(p && p.result && p.result.resolution_status);
    region('hist', { h: h, st: ev && ev.status, res: hasResult, mk: S.mk, rs: S.restored, md: S.modalOpen }, '', function () {
      var ul = $('sva-h-list'); clear(ul);
      h.items.forEach(function (m) { ul.appendChild(matchRow(m, ev, hasResult)); });
      show($('sva-h-empty'), h.loaded && !h.items.length && !h.err && !h.loading);
      setText('sva-h-empty', h.filter ? 'No hay partidas con ese filtro.' : 'Todavía no hay partidas cerradas o anuladas.');
      var msg = $('sva-h-msg'); show(msg, !!h.err); msg.textContent = h.err || '';
      var st = $('sva-h-status');
      st.textContent = h.loading ? 'Cargando…' : (h.loaded ? 'Mostrando ' + h.items.length + (h.total != null ? ' de ' + h.total : '') + ' partida' + (h.items.length === 1 ? '' : 's') + '.' : '');
      var more = $('sva-h-more'); show(more, h.hasMore); more.disabled = h.loading || S.gate !== 'ready' || S.modalOpen;
      $('sva-h-refresh').disabled = h.loading || S.gate !== 'ready' || S.modalOpen;
      $('sva-h-filter').value = h.filter;
    });
  }
  function wireHistory() {
    var d = $('sva-hist'); if (!d) return;
    d.addEventListener('toggle', function () { if (d.open && S.hist && !S.hist.loaded && !S.hist.loading && S.gate === 'ready') loadHist(true); });
    $('sva-h-filter').addEventListener('change', function () {
      var h = S.hist; if (!h) return;
      h.filter = this.value; h.gen++; h.items = []; h.hasMore = false; h.next = null; h.total = null; h.loaded = false; h.loading = false; h.err = null; h.dirty = false;
      loadHist(true);
    });
    $('sva-h-refresh').addEventListener('click', function () { loadHist(true); });
    $('sva-h-more').addEventListener('click', function () { loadHist(false); });
  }

  /* ---- resultado ---- */
  var OUT_ES = { geo_win: 'Ganó Geo', community_win: 'Ganó la comunidad', tie: 'Empate' };
  function renderResult() {
    var p = S.panel, ev = pe(), r = p.result;
    region('result', { r: r, st: ev && ev.status, m: !!p.current_match, t: (p.turns || []).length }, '', function () {
      var root = $('sva-result'); clear(root);
      if (!ev) { root.appendChild(el('p', 'sva-hint', 'Sin edición.')); return; }
      if (!r || !r.resolution_status) {
        if (ev.status === 'finished') {
          root.appendChild(el('p', 'sva-hint', 'La edición terminó. Calcula el resultado: se arma desde el libro de kills, sin partidas anuladas.'));
          root.appendChild(btn('Calcular resultado', 'sva-btn--primary sva-btn--lg', function () {
            act({ key: 'compute', rpc: 'svv_admin_compute_result', ok: 'Resultado calculado (provisional).' });
          }, !!p.current_match));
        } else root.appendChild(el('p', 'sva-hint', ev.status === 'live' ? 'El resultado se calcula cuando finalizas la edición.' : 'Aún no hay resultado.'));
        return;
      }
      var big = el('div', 'sva-res'); big.setAttribute('data-outcome', r.outcome || 'tie');
      big.appendChild(el('b', 'sva-res__out', OUT_ES[r.outcome] || '—'));
      big.appendChild(el('span', 'sva-res__n', 'Geo ' + fmtInt(num(r.geo_points)) + ' pts · Viewers ' + fmtInt(num(r.viewer_points)) + ' pts'));
      big.appendChild(el('span', 'sva-res__k', 'Kills: Geo ' + fmtInt(num(r.geo_kills)) + ' · Viewers ' + fmtInt(num(r.viewer_kills)) + ' · Participantes ' + num(r.participants) + ' (oficiales ' + num(r.official_participants) + ')'));
      var st = el('span', 'sva-pill', r.resolution_status === 'confirmed' ? 'Confirmado' : (r.resolution_status === 'provisional' ? 'Provisional' : r.resolution_status));
      st.setAttribute('data-kind', r.resolution_status === 'confirmed' ? 'live' : 'draft'); big.appendChild(st); root.appendChild(big);
      if (r.note) root.appendChild(el('p', 'sva-hint', 'Nota: ' + r.note));
      if (r.resolution_status === 'provisional') {
        root.appendChild(el('p', 'sva-hint', 'Revisa las cifras. Confirmar es definitivo; si algo no cuadra, descártalo y vuelve a calcular.'));
        var a = el('div', 'sva-actions');
        a.appendChild(btn('Confirmar resultado…', 'sva-btn--primary sva-btn--lg', function () {
          act({ key: 'confirm_result', rpc: 'svv_admin_confirm_result', args: function (x) { return { p_note: x.reason ? x.reason : null }; }, ok: 'Resultado confirmado.',
            confirm: { title: 'Confirmar el resultado', body: (OUT_ES[r.outcome] || '') + ': Geo ' + fmtInt(num(r.geo_points)) + ' – Viewers ' + fmtInt(num(r.viewer_points)) + '. Queda como resultado oficial y NO se puede deshacer.', ok: 'Confirmar resultado', danger: true, reason: { label: 'Nota (opcional, máx. 500)', min: 0, max: 500 } } });
        }));
        a.appendChild(btn('Descartar…', 'sva-btn--danger', function () {
          act({ key: 'discard_result', rpc: 'svv_admin_discard_result', args: function (x) { return { p_reason: x.reason }; }, ok: 'Resultado provisional descartado.',
            confirm: { title: 'Descartar el resultado provisional', body: 'Se borra el cálculo provisional para poder corregir y recalcular.', ok: 'Descartar', danger: true, reason: { label: 'Motivo (3 a 300 caracteres)', min: 3, max: 300 } } });
        }));
        root.appendChild(a);
      }
    });
  }

  /* ---- liquidación económica (Fase 6B-2C instalada; el panel solo muestra lo que devuelve Supabase y pide las acciones existentes) ---- */
  var PAY_ES = { applied: 'Aplicado', protected: 'Protegido', pending: 'Pendiente', error: 'Error' };
  var PAY_KIND_ES = { award: 'Premio', penalty: 'Penalización' };
  function settleEligible() {
    var ev = pe(), r = S.panel && S.panel.result;
    return !!(ev && r && r.resolution_status === 'confirmed' && (ev.status === 'finished' || ev.status === 'settled'));
  }
  function maybeLoadSettle() {
    if (!settleEligible()) { if (S.settle) { S.settle = null; S.settleReq++; renderAll(); } return; }
    var ev = pe(), d = S.settle && S.settle.key === ev.event_key && !S.settle.err ? S.settle.data : null;
    if (d && d.settlement && d.settlement.status === 'settled') return;   // cerrada: ya no cambia
    loadSettle();
  }
  function loadSettle() {
    var ev = pe();
    if (!ev || !S.client || !S.userId || S.settleLoading) return Promise.resolve();
    var key = ev.event_key, seq = ++S.settleReq, uid = S.userId;
    S.settleLoading = true;
    return rpcRaw('svv_admin_get_settlement', { p_event_key: key }).then(function (r) {
      S.settleLoading = false;
      var cur = pe();
      if (seq !== S.settleReq || uid !== S.userId || !cur || cur.event_key !== key) { if (uid === S.userId) maybeLoadSettle(); return; }   // llegó tarde: se vuelve a pedir la edición actual
      var prev = S.settle && S.settle.key === key ? S.settle.data : null;
      S.settle = r.ok ? { key: key, data: r.data, err: null } : { key: key, data: prev, err: r.kind };   // si falla se conserva lo último visto, pero NO se permite actuar con él
      renderAll();
    });
  }
  function payLine(p) {
    var amt = num(p.amount), parts = [];
    if (p.status === 'applied') {
      if (p.kind === 'award') {
        parts.push('Acreditado ' + fmtMoney(num(p.credited)) + ' V-Bucks');
        if (num(p.offset) > 0) parts.push(fmtMoney(num(p.offset)) + ' compensados contra deuda');
      } else {
        parts.push('Cobrado ' + fmtMoney(num(p.collected)) + ' de ' + fmtMoney(amt));
        if (num(p.debt) > 0) parts.push('deuda pendiente ' + fmtMoney(typeof p.debt_outstanding === 'number' ? p.debt_outstanding : num(p.debt)));
      }
    } else if (p.status === 'protected') parts.push('Escudo válido: no se cobra');
    else if (p.status === 'error') { parts.push(p.last_error ? String(p.last_error).replace(/^SV\d+:\s*svv:\s*/i, '').slice(0, 160) : 'Falló al aplicar'); parts.push('intentos ' + num(p.attempts)); }
    else parts.push('Esperando aplicarse');
    return parts.join(' · ');
  }
  function stat(label, value, sub) {
    var d = el('div', 'sva-stat'); d.appendChild(el('span', 'sva-stat__l', label)); d.appendChild(el('b', 'sva-stat__v', value));
    if (sub) d.appendChild(el('span', 'sva-stat__s', sub)); return d;
  }
  function applyBody(pays) {
    var todo = pays.filter(function (p) { return p.status === 'pending' || p.status === 'error'; });
    var aw = todo.filter(function (p) { return p.kind === 'award'; }), pn = todo.filter(function (p) { return p.kind === 'penalty'; });
    var wrap = el('div');
    wrap.appendChild(el('p', null, 'Vas a aplicar ' + todo.length + ' pago(s) en V-Bucks REALES: ' + aw.length + ' premio(s)' + (aw.length ? ' de +' + fmtMoney(num(aw[0].amount)) : '') +
      ' y ' + pn.length + ' penalización(es)' + (pn.length ? ' de −' + fmtMoney(num(pn[0].amount)) : '') + '.'));
    wrap.appendChild(el('p', 'sva-hint', 'Cada pago aplicado es definitivo. Los participantes con Escudo válido no se cobran y las deudas se registran y se compensan con futuras recompensas. Si algo falla, queda marcado y puedes reintentar: nunca se aplica dos veces el mismo premio.'));
    return wrap;
  }
  function invokeApply(key) {
    var client = S.client;
    if (!client || !client.functions || typeof client.functions.invoke !== 'function') return Promise.resolve({ ok: false, kind: 'missing', message: 'sin cliente' });
    if (!online()) return Promise.resolve({ ok: false, kind: 'network', message: 'sin conexión' });
    var call;
    try { call = client.functions.invoke('svv-apply-payouts', { body: { event_key: key } }); }   // solo la clave pública de la edición: el servidor decide identidad, rol y UUID
    catch (e) { return Promise.resolve({ ok: false, kind: 'other', message: String(e && e.message || e) }); }
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve({ __timeout: true }); }, RPC_TIMEOUT_MS * 5); });
    function fail(b, status) {
      if (status === 401 || status === 403) return { ok: false, kind: 'auth' };
      if (status === 404) return { ok: false, kind: 'missing', message: b && b.code === 'event' ? 'edición' : 'función' };
      if (status === 409 && b && b.message) return { ok: false, kind: 'business', message: String(b.message) };
      if (status === 400) return { ok: false, kind: 'other' };
      if (status >= 500) return { ok: false, kind: 'network', message: 'servidor' };
      return { ok: false, kind: 'other' };
    }
    return Promise.race([Promise.resolve(call), timeout]).then(function (res) {
      if (!res || res.__timeout) return { ok: false, kind: 'network', message: 'tiempo de espera' };
      if (!res.error) {
        var d = res.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
        if (d && d.ok === true && d.data && typeof d.data === 'object') return { ok: true, data: d.data };
        return fail(d, 0);
      }
      var ctx = res.error.context;                                  // FunctionsHttpError: la respuesta HTTP viene en context
      if (ctx && typeof ctx.json === 'function') return ctx.json().then(function (b) { return fail(b, ctx.status); }, function () { return fail(null, ctx.status || 500); });
      return { ok: false, kind: 'network', message: String(res.error.message || 'red') };
    }, function (e) { return { ok: false, kind: 'network', message: String(e && e.message || e) }; });
  }
  function runApply(key) {
    if (S.busy || S.gate !== 'ready') return;
    S.busy = true; renderAll();
    invokeApply(key).then(function (res) {
      S.busy = false; S.coolUntil = performance.now() + COOLDOWN_MS;
      setTimeout(function () { renderAll(); }, COOLDOWN_MS + 30);
      if (res.ok) {
        var d = res.data, left = num(d.pending_left), bad = num(d.in_error);
        toast(bad || left ? 'err' : 'ok', 'Pagos aplicados: ' + num(d.applied) + (left ? ' · quedan ' + left + ' pendiente(s)' : '') + (bad ? ' · ' + bad + ' con error (revísalos y reintenta)' : '') + '.');
      } else if (res.kind === 'missing') toast('err', res.message === 'edición' ? 'Edición no encontrada en el servidor.' : 'La Edge Function «svv-apply-payouts» no está desplegada.');
      else toast('err', describe(res));
      loadSettle(); loadPanel();
    });
  }
  function doApply() {
    if (!canAct()) return;
    var ev = pe(), d = S.settle && !S.settle.err ? S.settle.data : null; if (!ev || !d) return;
    var key = ev.event_key;
    confirmDialog({ title: 'Aplicar pagos', body: applyBody(d.payouts || []), ok: 'Sí, aplicar pagos', danger: true,
      reason: { label: 'Para confirmar escribe APLICAR', min: 0, max: 20 },
      collect: function () { return $('sva-modal-reason').value.trim().toUpperCase(); },
      validate: function (v) { return v === 'APLICAR' ? null : 'Escribe APLICAR (en mayúsculas o minúsculas) para confirmar.'; }
    }).then(function (r) { if (r) runApply(key); else renderAll(); });
  }
  function renderSettle() {
    var card = $('sva-settle-card'); if (!card) return;
    var on = settleEligible(); show(card, on);
    if (!on) return;
    var ev = pe(), res = S.panel.result, st = S.settle && S.settle.key === ev.event_key ? S.settle : null;
    region('settle', { s: st, k: ev.event_key, o: res.outcome, n: res.official_participants }, '', function () {
      var root = $('sva-settle'); clear(root);
      if (!st) { root.appendChild(el('p', 'sva-hint', 'Leyendo el estado de la liquidación en Supabase…')); return; }
      var d = st.data;
      if (!d) {
        root.appendChild(el('p', 'sva-form__msg', st.err === 'missing' ? 'La lectura de liquidación no está disponible en Supabase.' : 'No pudimos leer el estado de la liquidación. Se reintenta solo; no se muestra ninguna cifra mientras tanto.'));
        root.lastChild.setAttribute('data-kind', 'err'); return;
      }
      var fresh = !st.err, set = d.settings || {}, sm = d.summary || {}, sl = d.settlement, pays = d.payouts || [];
      var pend = num(sm.pending), errn = num(sm.error);
      if (!fresh) { var w = el('p', 'sva-form__msg', 'No pudimos actualizar esta sección: mostramos lo último leído y las acciones están bloqueadas hasta recuperar la conexión.'); w.setAttribute('data-kind', 'err'); root.appendChild(w); }

      var head = el('div', 'sva-setl__head');
      var pill = el('span', 'sva-pill', !sl ? 'Sin preparar' : (sl.status === 'settled' ? 'Liquidada' : 'Preparada'));
      pill.setAttribute('data-kind', !sl ? 'draft' : (sl.status === 'settled' ? 'live' : 'scheduled'));
      head.appendChild(pill);
      var rule = d.result && d.result.outcome === 'community_win' ? 'Ganó la comunidad: +' + fmtMoney(num(set.award_amount)) + ' V-Bucks a cada participante oficial.'
               : d.result && d.result.outcome === 'geo_win' ? 'Ganó Geo: −' + fmtMoney(num(set.penalty_amount)) + ' V-Bucks a cada participante oficial sin Escudo válido.'
               : 'Empate: no hay premios ni penalizaciones.';
      head.appendChild(el('span', 'sva-setl__rule', rule));
      root.appendChild(head);

      if (set.enabled === false) {
        var sw = el('p', 'sva-hint sva-hint--warn', 'El interruptor de pagos en V-Bucks está APAGADO: el servidor no permite preparar ni aplicar pagos. Este panel no lo activa.');
        root.appendChild(sw);
      } else if (set.readiness_missing && set.readiness_missing.length) {
        root.appendChild(el('p', 'sva-hint sva-hint--warn', 'Faltan protecciones económicas: ' + set.readiness_missing.join('; ') + '.'));
      }

      if (!sl) {   // ----- aún no preparada
        root.appendChild(el('p', 'sva-hint', 'Preparar congela la lista de pagos desde el resultado confirmado y las protecciones guardadas al confirmarlo. NO mueve dinero.'));
        if (d.blocker) root.appendChild(el('p', 'sva-hint sva-hint--warn', 'No se puede preparar todavía: ' + String(d.blocker)));
        var a0 = el('div', 'sva-actions');
        a0.appendChild(btn('Preparar liquidación…', 'sva-btn--primary sva-btn--lg', function () {
          act({ key: 'settle_prepare', rpc: 'svv_admin_settlement_prepare', ok: 'Liquidación preparada: la lista de pagos quedó congelada. Todavía no se movió dinero.',
            after: function () { loadSettle(); },
            confirm: { title: 'Preparar la liquidación', body: 'Se congela la lista de pagos de esta edición. No se mueve dinero hasta que pulses «Aplicar pagos».', ok: 'Preparar' } });
        }, !fresh || !d.can_prepare));
        root.appendChild(a0);
        return;
      }

      // ----- resumen
      var awards = pays.filter(function (p) { return p.kind === 'award'; }), pens = pays.filter(function (p) { return p.kind === 'penalty' && p.status !== 'protected'; });
      var grid = el('div', 'sva-stats');
      grid.appendChild(stat('Participantes oficiales', fmtMoney(num(res.official_participants))));
      grid.appendChild(stat('Premios', fmtMoney(awards.length), awards.length ? 'Acreditado ' + fmtMoney(num(sm.awards_credited)) + (num(sm.awards_offset_to_debts) ? ' · ' + fmtMoney(num(sm.awards_offset_to_debts)) + ' a deudas' : '') : null));
      grid.appendChild(stat('Penalizaciones', fmtMoney(pens.length), pens.length ? 'Cobrado ' + fmtMoney(num(sm.penalties_collected)) : null));
      grid.appendChild(stat('Escudos aplicados', fmtMoney(num(sm.protected))));
      grid.appendChild(stat('Deudas', fmtMoney(num(sm.debt_created)), 'Abiertas SvV: ' + fmtMoney(num(sm.debt_open_total_svv_vbucks)) + ' V-Bucks'));
      root.appendChild(grid);

      var counts = el('p', 'sva-hint', 'Pagos: ' + num(sm.applied) + ' aplicados · ' + num(sm.protected) + ' protegidos · ' + pend + ' pendientes · ' + errn + ' con error.');
      root.appendChild(counts);

      // ----- estado individual de cada pago
      var ul = el('ul', 'sva-pays');
      if (!pays.length) ul.appendChild(el('li', 'sva-empty', 'Esta edición no genera pagos.'));
      pays.forEach(function (p) {
        var li = el('li', 'sva-pay'); li.setAttribute('data-status', p.status);
        li.appendChild(el('b', 'sva-pay__n', p.name || '—'));
        li.appendChild(el('span', 'sva-pay__k', (PAY_KIND_ES[p.kind] || p.kind) + ' ' + (p.kind === 'award' ? '+' : '−') + fmtMoney(num(p.amount))));
        var ps = el('span', 'sva-pill sva-pay__s', PAY_ES[p.status] || p.status); ps.setAttribute('data-pay', p.status);
        li.appendChild(ps);
        li.appendChild(el('span', 'sva-pay__d', payLine(p)));
        ul.appendChild(li);
      });
      root.appendChild(ul);
      if (num(sl.payouts_total) > pays.length) root.appendChild(el('p', 'sva-hint', 'Se muestran los primeros ' + pays.length + ' de ' + fmtMoney(num(sl.payouts_total)) + ' pagos.'));

      if (sl.status === 'settled') { root.appendChild(el('p', 'sva-hint', 'Liquidación cerrada' + (sl.settled_at ? ' el ' + fmtDateTime(sl.settled_at) : '') + '. No admite más cambios.')); return; }

      // ----- acciones
      var todo = pend + errn, a = el('div', 'sva-actions');
      a.appendChild(btn('Aplicar pagos…', 'sva-btn--primary sva-btn--lg', doApply, !fresh || todo === 0 || set.enabled !== true));
      a.appendChild(btn('Finalizar liquidación…', 'sva-btn--lg', function () {
        act({ key: 'settle_finalize', rpc: 'svv_admin_settlement_finalize', ok: 'Liquidación finalizada: la edición quedó liquidada.', after: function () { loadSettle(); },
          confirm: { title: 'Finalizar la liquidación', body: 'No quedan pagos pendientes ni con error. La liquidación y la edición pasan a «Liquidada» y ya no admiten cambios.', ok: 'Finalizar', danger: true } });
      }, !fresh || todo !== 0));
      root.appendChild(a);
      root.appendChild(el('p', 'sva-hint', todo ? 'Finalizar se habilita cuando no queden pagos pendientes ni con error (' + pend + ' pendientes, ' + errn + ' con error).' : 'Todo aplicado: ya puedes finalizar.'));
    });
  }

  /* ---- registro de acciones ---- */
  function renderAudit() {
    var au = (S.panel && S.panel.audit) || [];
    region('audit', { a: au }, '', function () {
      var ol = $('sva-audit'); clear(ol);
      if (!au.length) { ol.appendChild(el('li', 'sva-empty', 'Todavía no hay acciones registradas.')); return; }
      au.forEach(function (a) { var li = el('li'); li.appendChild(el('time', null, fmtTime(a.at))); li.appendChild(el('span', null, ACTION_ES[a.action] || a.action)); ol.appendChild(li); });
    });
  }

  /* ---- preparar edición, reglamento y programación ---- */
  function formMsg(id, kind, text) { var n = $(id); if (!n) return; n.textContent = text || ''; n.setAttribute('data-kind', kind || ''); }
  function rulesInputsDirty() {
    var b = S.rulesBase; if (!b) return false;
    return $('sva-r-title').value !== b.title || $('sva-r-body').value !== b.body;
  }
  function renderSetup() {
    var p = S.panel, ev = pe(), rules = p.rules || null, ok = canAct();
    $('sva-n-btn').disabled = !ok; $('sva-n-test').disabled = !ok; $('sva-n-key').disabled = !ok; $('sva-n-label').disabled = !ok;
    $('sva-n-num').disabled = !ok || $('sva-n-test').checked;
    var draft = !!(ev && ev.status === 'draft');
    // reglamento: se carga desde el servidor mientras no haya cambios sin guardar
    var evId = ev ? ev.event_id : null, rev = rules ? rules.revision_sha256 : null;
    var base = S.rulesBase, dirty = rulesInputsDirty();
    if (!base || base.eventId !== evId) {
      S.rulesBase = base = { eventId: evId, rev: rev, title: rules ? (rules.title || '') : '', body: rules ? (rules.body_md || '') : '' };
      $('sva-r-title').value = base.title; $('sva-r-body').value = base.body; dirty = false;
    } else if (base.rev !== rev) {
      var sameAsServer = rules && $('sva-r-title').value === (rules.title || '') && $('sva-r-body').value === (rules.body_md || '');
      if (!dirty || sameAsServer) { S.rulesBase = base = { eventId: evId, rev: rev, title: rules ? (rules.title || '') : '', body: rules ? (rules.body_md || '') : '' }; $('sva-r-title').value = base.title; $('sva-r-body').value = base.body; dirty = false; }
    }
    var stale = dirty && base.rev !== rev;
    setText('sva-rules-state', !ev ? '' : (rules ? '· v' + num(rules.version_number) + ' ' + (rules.status === 'published' ? 'publicado' : 'borrador') : '· sin reglamento'));
    setText('sva-r-hint', !ev ? 'Crea o elige una edición.' : (!draft ? 'Solo se puede editar el reglamento de una edición en borrador.' :
      (stale ? 'Atención: el reglamento cambió en el servidor mientras editabas. Copia tu texto y pulsa «Actualizar»; no se sobrescribirá sin que lo notes.' :
        (dirty ? 'Tienes cambios sin guardar.' : (rules && rules.status === 'published' ? 'Reglamento publicado.' : 'Guarda el borrador y luego publícalo.')))));
    var title = $('sva-r-title'), body = $('sva-r-body');
    title.disabled = body.disabled = !(ok && draft);
    $('sva-r-save').disabled = !(ok && draft && dirty && !stale && title.value.trim() && body.value.trim());
    $('sva-r-publish').disabled = !(ok && draft && rules && rules.status !== 'published' && !dirty);
    // programación
    var sc = $('sva-sc-at'); sc.disabled = !(ok && draft); $('sva-sc-btn').disabled = !(ok && draft && sc.value);
  }
  function wireSetup() {
    $('sva-n-test').addEventListener('change', function () { if (this.checked) $('sva-n-num').value = ''; renderSetup(); });
    $('sva-new-form').addEventListener('submit', function (e) {
      e.preventDefault(); if (!canAct()) return;
      var key = $('sva-n-key').value.trim().toLowerCase(), test = $('sva-n-test').checked, numRaw = $('sva-n-num').value.trim(), label = $('sva-n-label').value.trim();
      var n = numRaw === '' ? null : parseInt(numRaw, 10);
      if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(key)) return formMsg('sva-n-msg', 'err', 'La clave usa 3 a 40 caracteres: minúsculas, números, guion o guion bajo.');
      if (test && n !== null) return formMsg('sva-n-msg', 'err', 'Una edición de prueba no lleva número.');
      if (!test && (n === null || !(n > 0) || String(n) !== numRaw)) return formMsg('sva-n-msg', 'err', 'Una edición real necesita un número entero positivo.');
      if (label.length > 80) return formMsg('sva-n-msg', 'err', 'La etiqueta admite hasta 80 caracteres.');
      formMsg('sva-n-msg', '', '');
      act({ key: 'create_event', noEvent: true, rpc: 'svv_admin_create_event', args: { p_event_key: key, p_edition_number: test ? null : n, p_edition_label: label || null, p_is_test: test },
        ok: 'Edición creada en borrador.', after: function (d) { if (d && d.event_key) S.eventKey = d.event_key; $('sva-new-form').reset(); formMsg('sva-n-msg', 'ok', 'Edición creada.'); } });
    });
    $('sva-rules-form').addEventListener('submit', function (e) {
      e.preventDefault(); if (!canAct()) return;
      var t = $('sva-r-title').value.trim(), b = $('sva-r-body').value, ev = pe(), rules = S.panel && S.panel.rules;
      if (!ev || ev.status !== 'draft') return;
      if (!t || t.length > 200) return formMsg('sva-r-msg', 'err', 'El título es obligatorio (máximo 200 caracteres).');
      if (!b.trim() || b.length > 60000) return formMsg('sva-r-msg', 'err', 'El texto es obligatorio (máximo 60.000 caracteres).');
      formMsg('sva-r-msg', '', '');
      var expected = S.rulesBase ? S.rulesBase.rev : null;
      act({ key: 'save_rules', rpc: 'svv_admin_save_rules', args: { p_title: t, p_body_md: b, p_expected_revision: expected || null }, ok: 'Borrador del reglamento guardado.',
        after: function (d) { S.rulesBase = { eventId: ev.event_id, rev: d && d.revision_sha256 ? d.revision_sha256 : null, title: t, body: b }; formMsg('sva-r-msg', 'ok', 'Guardado.'); } });
    });
    $('sva-r-publish').addEventListener('click', function () {
      var rules = S.panel && S.panel.rules, ev = pe(); if (!rules || !ev) return;
      act({ key: 'publish_rules', rpc: 'svv_admin_publish_rules', sig: [rules.revision_sha256], args: { p_expected_revision: rules.revision_sha256 }, ok: 'Reglamento publicado.',
        confirm: { title: 'Publicar el reglamento', body: 'Los viewers verán y deberán aceptar este texto. Una vez publicado ya no se edita.', ok: 'Publicar', danger: true } });
    });
    $('sva-r-title').addEventListener('input', renderSetup); $('sva-r-body').addEventListener('input', renderSetup);
    $('sva-sc-at').addEventListener('input', renderSetup);
    $('sva-sched-form').addEventListener('submit', function (e) {
      e.preventDefault(); if (!canAct()) return;
      var v = $('sva-sc-at').value; if (!v) return formMsg('sva-sc-msg', 'err', 'Elige fecha y hora.');
      var d = new Date(v); if (isNaN(d.getTime()) || d.getTime() <= Date.now() + 60000) return formMsg('sva-sc-msg', 'err', 'La fecha debe estar en el futuro.');
      formMsg('sva-sc-msg', '', '');
      act({ key: 'schedule', rpc: 'svv_admin_schedule_event', args: { p_scheduled_start_at: d.toISOString() }, ok: 'Edición programada.',
        confirm: { title: 'Programar la edición', body: 'Inicio previsto: ' + fmtDateTime(d.toISOString()) + '. Requiere el reglamento publicado.', ok: 'Programar', danger: false },
        after: function () { formMsg('sva-sc-msg', 'ok', 'Programada.'); } });
    });
  }

  /* ------------------------------ relojes (solo visuales; el servidor decide) ------------------------------ */
  function tick() {
    if (S.gate !== 'ready' || !S.panel) return;
    var e = elapsed();
    if (S.cd.liveOn) { var left = Math.max(0, S.cd.live - e); var t = $('sva-b-clock-t'); if (t) t.textContent = fmtClock(left); }
    var nodes = document.querySelectorAll('[data-cd]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-cd'), d = null, expired = false;
      if (k === 'lobby') d = S.cd.lobby; else if (k.indexOf('q:') === 0) d = S.cd.q[k.slice(2)];
      if (!d) continue;
      var rem = Math.max(0, Math.ceil(d.s - e)); expired = d.x || rem <= 0;
      var txt = expired ? 'Vencido' : mmss(rem);
      if (nodes[i].textContent !== txt) nodes[i].textContent = txt;
      nodes[i].parentNode && nodes[i].parentNode.setAttribute && nodes[i].parentNode.setAttribute('data-expired', expired ? '1' : '0');
    }
  }

  /* ------------------------------ sesión ------------------------------ */
  function onSession(session) {
    var uid = session && session.user ? session.user.id : null;
    if (uid === S.userId && (uid || S.gate === 'login')) return;
    S.userId = uid; S.panel = null; S.settle = null; S.settleReq++; S.rsig = {}; S.sel = {}; S.pending = {}; S.fails = 0; S.eventKey = null; S.shownKey = null; S.rulesBase = null; S.req++; resetHistory(true);
    if (S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; }
    if (!uid) { setGate('login'); return; }
    setGate('loading'); loadPanel();
  }
  function login() {
    try { sessionStorage.setItem('geoarmy_return_to_v1', location.pathname + location.search); } catch (e) {}
    var base = window.GEOARMY_SITE_BASE || '/';
    S.client.auth.signInWithOAuth({ provider: 'twitch', options: { redirectTo: location.origin + base + 'auth/callback/' } }).then(function (r) {
      if (r && r.error) toast('err', 'No pudimos iniciar el acceso con Twitch. Inténtalo de nuevo.');
    }, function () { toast('err', 'No pudimos iniciar el acceso con Twitch. Inténtalo de nuevo.'); });
  }

  function init() {
    document.body.classList.add('sva-page');
    resetHistory(false);
    wireSetup(); wireHistory();
    if (!window.supabase || !window.supabase.createClient || !window.GEOARMY_SUPABASE_URL || !window.GEOARMY_SUPABASE_ANON_KEY) { setGate('config'); return; }
    S.client = window.supabase.createClient(window.GEOARMY_SUPABASE_URL, window.GEOARMY_SUPABASE_ANON_KEY);   // solo la clave pública anon
    setGate('loading');
    $('sva-gate-login').addEventListener('click', login);
    $('sva-gate-retry').addEventListener('click', function () { if (S.userId) { setGate('loading'); loadPanel(); } else { setGate('loading'); S.client.auth.getSession().then(function (r) { onSession(r && r.data && r.data.session); }); } });
    $('sva-refresh').addEventListener('click', function () { if (S.gate === 'ready' && !S.busy) loadPanel(); });
    $('sva-ed-select').addEventListener('change', function () {
      if (S.busy || S.modalOpen) { this.value = S.shownKey || ''; return; }
      S.eventKey = this.value || null; S.sel = {}; S.rsig = {}; S.pending = {}; S.settle = null; S.settleReq++; resetHistory(false); loadPanel();
      var hd = $('sva-hist'); if (hd && hd.open) loadHist(true);
    });
    // setTimeout para no llamar a Supabase dentro del propio callback de auth
    S.client.auth.onAuthStateChange(function (ev, session) { setTimeout(function () { onSession(session); }, 0); });
    S.client.auth.getSession().then(function (r) { onSession(r && r.data && r.data.session); }, function () { setGate('error'); });
    setInterval(tick, 500);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.gate === 'ready') loadPanel(); });
    window.addEventListener('online', function () { if (S.userId) loadPanel(); });
    window.addEventListener('offline', function () { if (S.panel) { S.fails++; setConn('offline'); renderAll(); } });
    window.addEventListener('beforeunload', function (e) { if (S.busy) { e.preventDefault(); e.returnValue = ''; } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
