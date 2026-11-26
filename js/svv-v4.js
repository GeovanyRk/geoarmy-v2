/* =========================================================================
   STREAMER VS VIEWER V2 — "LA ARENA" · js/svv-v4.js
   Usa el cliente compartido window.GeoArmyAccount.client (js/geoarmy-account.js; la sesión Twitch/Supabase
   y su JWT los gestiona esa librería: aquí nunca hay claves de servicio).
   Lectura:  svv_get_public_state · svv_get_rules · svv_get_history · svv_get_my_state
   Fase 6A-8 · participación del viewer (solo `authenticated`, validado por Supabase):
     svv_accept_rules(p_event_key, p_request, p_decision, p_version_number)
     svv_join_queue(p_event_key, p_request) · svv_leave_queue(p_event_key, p_request)
     svv_confirm_call(p_event_key, p_request)
   - Supabase es la autoridad de estados y plazos; la página solo refleja lo que devuelve y pregunta de nuevo
     tras cada acción. Cada acción usa una clave de operación (uuid) idempotente y un candado anti doble clic.
   - Fase 6C-1 · Escudo: svv_get_my_shield(p_event_key) (lectura) y la compra por la Edge Function `svv-shield-buy` (el navegador NO mueve G-Coins:
     solo envía el event_key y una clave de operación; el servidor valida la sesión, cobra y registra en una sola transacción).
   - No hay premios ni penalizaciones aquí: la página solo refleja lo que Supabase decide. El Escudo es el ÚNICO comodín del evento (Salto de fila y Revancha se retiraron).
   - Todo texto que viene del servidor se inserta con textContent (nunca innerHTML).
   - Si las RPC todavía no están instaladas, la página lo dice (no inventa cifras).
   ========================================================================= */
(function () {
  'use strict';

  var RPC_TIMEOUT_MS = 12000;
  var POLL_LIVE_MS = 10000;
  var POLL_FAST_MS = 5000;
  var POLL_IDLE_MS = 30000;
  var HISTORY_PAGE = 10;
  var DURATION_S = 10800; // 3 h (formato V2, solo para el reloj en reposo)

  var S = {
    pub: null,          // última respuesta de svv_get_public_state
    mode: 'loading',    // loading | unavailable | error | empty | ok
    offsetMs: 0,        // servidor - cliente
    pollTimer: null,
    histShown: 0,
    histTotal: 0,
    eventKey: null,
    rulesKey: undefined, // clave con la que se cargó el reglamento
    // 4B: protección contra respuestas de sesiones/solicitudes anteriores
    userId: undefined,   // id de la sesión actual (undefined = aún no sabemos; null = sin sesión)
    epoch: 0,            // sube cada vez que cambia la identidad (login, logout, otra cuenta)
    myReq: 0, pubReq: 0, rulesReq: 0, histReq: 0, // número de la última solicitud de cada tipo
    // 6A-8 · participación
    my: null,            // última respuesta de svv_get_my_state (solo si es de la edición visible)
    myState: 'loading',  // loading | ok | locked | error | unavailable
    myAt: 0,             // performance.now() al recibir `my` (los segundos restantes se cuentan desde ahí)
    pubAt: 0,
    rulesShown: null,    // versión del reglamento que se está mostrando (null = no hay reglamento vigente visible)
    rulesState: 'loading', rulesFails: 0, rulesTimer: null, // lectura del reglamento: estado y reintentos
    busy: null,          // acción de escritura en curso (candado anti doble clic)
    pending: {},         // claves de operación en vuelo (se reutilizan solo si el resultado es incierto)
    fb: {},              // mensajes de resultado por área ('rules' | 'queue')
    needLogin: false,    // una acción devolvió «sesión no válida»
    leaveArmed: false,   // el usuario pulsó «Salir de la fila» y falta confirmar
    shield: null,        // última respuesta de svv_get_my_shield (6C-1)
    shieldState: 'idle', // idle | ok | locked | error | unavailable
    shieldReq: 0, shieldArmed: false, shieldTimer: null, shieldAt: 0,
    zeroFired: {}        // refrescos ya disparados al llegar a 0 un plazo
  };

  /* ------------------------------ utilidades ------------------------------ */
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setText(id, v) { var n = $(id); if (n) n.textContent = v; }
  function show(n, on) { if (n) n.hidden = !on; }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function fmtInt(v) { try { return new Intl.NumberFormat('es').format(v); } catch (e) { return String(v); } }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    try { return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
    catch (e) { return d.toLocaleString(); }
  }
  function fmtDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return new Intl.DateTimeFormat('es', { dateStyle: 'long' }).format(d); } catch (e) { return d.toLocaleDateString(); }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    return (d > 0 ? d + 'd ' : '') + (d > 0 ? pad(h) : h) + ':' + pad(m) + ':' + pad(s);
  }
  function nowServer() { return Date.now() + S.offsetMs; }
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function animateNumber(node, to) {
    if (!node) return;
    var from = parseInt(node.getAttribute('data-n'), 10);
    node.setAttribute('data-n', String(to));
    if (reduceMotion || isNaN(from) || from === to) { node.textContent = fmtInt(to); return; }
    var t0 = performance.now(), dur = 700;
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      node.textContent = fmtInt(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* --------------------------- cliente / RPC --------------------------- */
  function getClient() {
    if (window.GeoArmyAccount && window.GeoArmyAccount.client) return window.GeoArmyAccount.client;
    return null;
  }

  // Devuelve {ok, data} o {ok:false, kind:'missing'|'auth'|'network'|'other', error}
  function rpc(name, args) {
    var client = getClient();
    if (!client) return Promise.resolve({ ok: false, kind: 'network', error: 'sin cliente' });
    var call;
    try { call = args ? client.rpc(name, args) : client.rpc(name); }
    catch (e) { return Promise.resolve({ ok: false, kind: 'other', error: e }); }
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve({ __timeout: true }); }, RPC_TIMEOUT_MS);
    });
    return Promise.race([Promise.resolve(call), timeout]).then(function (res) {
      if (!res || res.__timeout) return { ok: false, kind: 'network', error: 'tiempo de espera' };
      if (res.error) return { ok: false, kind: classify(res.error, res.status), error: res.error };
      return { ok: true, data: res.data };
    }, function (e) { return { ok: false, kind: 'network', error: e }; });
  }
  function classify(err, status) {
    var code = String(err.code || ''), msg = String(err.message || '');
    if (code === 'PGRST202' || code === '42883' || status === 404 || /could not find the function|does not exist/i.test(msg)) return 'missing';
    if (code === 'SV004' || /SV004|autenticado/i.test(msg) || status === 401) return 'auth';
    if (/failed to fetch|network|timeout/i.test(msg)) return 'network';
    if (code === '42501' || status === 403) return 'missing'; // sin permiso => aún no instalada/concedida
    return 'other';
  }

  /* ------------------------- markdown mínimo y seguro ------------------------- */
  function inline(parent, text) {
    var re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var tok = m[0];
      if (tok.indexOf('**') === 0) parent.appendChild(el('strong', null, tok.slice(2, -2)));
      else parent.appendChild(el('em', null, tok.slice(1, -1)));
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function renderMarkdown(container, md) {
    clear(container);
    var lines = String(md || '').slice(0, 30000).replace(/\r\n?/g, '\n').split('\n');
    var list = null, listType = null, para = [];
    function flushPara() { if (para.length) { var p = el('p'); inline(p, para.join(' ')); container.appendChild(p); para = []; } }
    function flushList() { list = null; listType = null; }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, ''), m;
      if (!line.trim()) { flushPara(); flushList(); return; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flushPara(); flushList();
        var h = el('h' + Math.min(6, Math.max(4, m[1].length + 3)));
        inline(h, m[2]); container.appendChild(h); return;
      }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
        flushPara();
        if (listType !== 'ul') { list = el('ul'); listType = 'ul'; container.appendChild(list); }
        var li = el('li'); inline(li, m[1]); list.appendChild(li); return;
      }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        flushPara();
        if (listType !== 'ol') { list = el('ol'); listType = 'ol'; container.appendChild(list); }
        var li2 = el('li'); inline(li2, m[1]); list.appendChild(li2); return;
      }
      flushList(); para.push(line.trim());
    });
    flushPara();
  }

  /* ------------------------------ estado global ------------------------------ */
  var STATUS_TEXT = {
    loading: 'Conectando con la Arena…',
    unavailable: 'Datos en vivo próximamente',
    error: 'Sin conexión con la Arena',
    empty: 'Próxima edición'
  };

  function setStatus(kind, text) {
    var st = $('svv-status');
    if (st) st.setAttribute('data-state', kind);
    setText('svv-status-text', text);
  }

  function setBanner(kind, msg, withRetry) {
    var b = $('svv-score-banner');
    if (!b) return;
    clear(b);
    if (!msg) { b.hidden = true; return; }
    b.hidden = false;
    b.setAttribute('data-kind', kind || 'info');
    b.appendChild(el('span', null, msg));
    if (withRetry) {
      var btn = el('button', null, 'Reintentar');
      btn.type = 'button';
      btn.addEventListener('click', function () { loadPublic(true); loadRules(true); loadHistory(true); loadMy(); });
      b.appendChild(btn);
    }
  }

  function resetScoreView(note) {
    ['svv-geo-points', 'svv-viewer-points', 'svv-geo-kills', 'svv-viewer-kills'].forEach(function (id) {
      var n = $(id); if (n) { n.textContent = '—'; n.removeAttribute('data-n'); }
    });
    var g = $('svv-bar-geo'), mk = $('svv-bar-marker');
    if (g) g.style.width = '50%';
    if (mk) mk.style.left = '50%';
    var bar = $('svv-bar'); if (bar) bar.setAttribute('aria-label', note || 'Marcador sin resultados');
    setText('svv-score-note', note || 'Marcador sin resultados');
    show($('svv-match'), false);
    show($('svv-counts'), false);
  }

  function applyMode(mode) {
    S.mode = mode;
    var sec = $('svv-score'); if (sec) sec.setAttribute('data-state', mode);
  }

  /* ------------------------------ render público ------------------------------ */
  function renderPublic(pub) {
    var ev = pub && pub.event;
    if (!ev) { renderEmpty(); return; }
    applyMode('ok');
    S.eventKey = ev.key;

    var label = ev.edition_label || (ev.edition_number ? 'Edición #' + ev.edition_number : 'Edición especial');
    setText('svv-edition', label);

    var statusMap = {
      scheduled: ['scheduled', 'Programado'],
      live: ['live', 'En vivo'],
      finished: ['finished', pub.result ? 'Finalizado' : 'Finalizado · resultado en revisión'],
      settled: ['finished', 'Finalizado']
    };
    var sm = statusMap[ev.status] || ['empty', 'Edición'];
    setStatus(sm[0], sm[1]);
    if (ev.status === 'scheduled') setText('svv-start-info', fmtDate(ev.scheduled_start_at));
    else if (ev.status === 'live') setText('svv-start-info', 'Comenzó ' + fmtDate(ev.live_started_at));
    else setText('svv-start-info', fmtDate(ev.live_started_at || ev.scheduled_start_at));

    renderScore(pub);
    renderMatch(pub);
    renderCounts(pub);
    renderQueue(pub);
    tickClock();
  }

  function renderEmpty() {
    applyMode('empty');
    S.eventKey = null;
    setStatus('empty', STATUS_TEXT.empty);
    setText('svv-edition', '—');
    setText('svv-start-info', 'Por anunciar');
    setBanner('info', 'Próxima edición por anunciar. Cuando haya una edición abierta, el marcador y la inscripción aparecerán aquí.', false);
    resetScoreView('Marcador sin resultados');
    renderQueue(null);
    tickClock();
  }

  function renderUnavailable() {
    applyMode('unavailable');
    S.pub = null; S.eventKey = null;
    setStatus('unavailable', STATUS_TEXT.unavailable);
    setText('svv-edition', '—');
    setText('svv-start-info', '—');
    setBanner('info', 'Función próximamente disponible: los datos en vivo todavía no están conectados.', false);
    resetScoreView('Marcador sin resultados');
    renderQueue(null);
    tickClock();
  }

  function renderError() {
    applyMode('error');
    setStatus('error', STATUS_TEXT.error);
    setBanner('error', 'No pudimos conectar con la Arena. Revisa tu conexión e inténtalo otra vez.', true);
    if (!S.pub) resetScoreView('Marcador no disponible');
    tickClock();
  }

  function renderScore(pub) {
    var ev = pub.event, sc = pub.score;
    if (!sc) {
      resetScoreView(ev.status === 'scheduled' ? 'El marcador se activa cuando comience la edición' : 'Marcador sin resultados');
      setBanner(null, ev.status === 'scheduled' ? '' : '', false);
      if (ev.status === 'scheduled') setBanner('info', 'Evento programado. El marcador arranca en cero cuando comience la edición.', false);
      return;
    }
    setBanner(null, '', false);
    var gp = num(sc.geo_points), vp = num(sc.viewer_points), gk = num(sc.geo_kills), vk = num(sc.viewer_kills);
    if (gp == null || vp == null) { resetScoreView('Marcador sin resultados'); return; }
    animateNumber($('svv-geo-points'), gp);
    animateNumber($('svv-viewer-points'), vp);
    setText('svv-geo-kills', gk == null ? '—' : fmtInt(gk));
    setText('svv-viewer-kills', vk == null ? '—' : fmtInt(vk));

    var total = gp + vp, share = total > 0 ? gp / total : 0.5;
    var g = $('svv-bar-geo'), mk = $('svv-bar-marker');
    if (g) g.style.width = (share * 100).toFixed(2) + '%';
    if (mk) mk.style.left = (share * 100).toFixed(2) + '%';

    var note;
    if (total === 0) note = ev.status === 'live' ? 'Aún sin puntos' : 'Marcador sin resultados';
    else if (gp === vp) note = 'Empate';
    else if (gp > vp) note = 'Geo lidera por ' + fmtInt(gp - vp);
    else note = 'La comunidad lidera por ' + fmtInt(vp - gp);
    if (pub.result && pub.result.outcome) {
      note = pub.result.outcome === 'geo_win' ? 'Resultado final: ganó Geo'
           : pub.result.outcome === 'community_win' ? 'Resultado final: ganó la comunidad' : 'Resultado final: empate';
    }
    setText('svv-score-note', note);
    renderStakesNote(pub.result && pub.result.outcome);
    var bar = $('svv-bar');
    if (bar) bar.setAttribute('aria-label', 'Geo ' + gp + ' puntos, comunidad ' + vp + ' puntos. ' + note);
  }

  // Aviso del resultado CONFIRMADO por el servidor (pub.result). No calcula ni descuenta nada: solo explica qué regla aplica; la posición real vive en Mi Geo Army.
  var STAKES_BASE = 'Los montos los confirma y aplica el servidor cuando Geo cierra el resultado y los pagos de la edición están habilitados; esta página no descuenta nada.';
  function renderStakesNote(outcome) {
    var msg = STAKES_BASE;
    if (outcome === 'community_win') msg = 'Resultado confirmado: ganaron los Viewers. Los participantes oficiales reciben +1,000 V-Bucks cuando los pagos de la edición están habilitados. Tu saldo real está en Mi Geo Army.';
    else if (outcome === 'geo_win') msg = 'Resultado confirmado: ganó Geo. A los participantes oficiales sin Escudo se les aplica −1,000 V-Bucks cuando los pagos de la edición están habilitados (con Escudo válido, no). Tu saldo real y tu deuda, si existe, están en Mi Geo Army.';
    else if (outcome === 'tie') msg = 'Resultado confirmado: empate. Revisa tu posición real en Mi Geo Army.';
    setText('svv-stakes-note', msg);
  }

  function renderMatch(pub) {
    var box = $('svv-match'), list = $('svv-match-players'), cm = pub.current_match;
    if (!cm || !list) { show(box, false); return; }
    clear(list);
    var modes = { duo: 'Dúos', trio: 'Tríos', squad: 'Squad' };
    setText('svv-match-mode', '#' + cm.match_seq + ' · ' + (modes[cm.mode] || ''));
    (cm.players || []).forEach(function (p) {
      var li = el('li'); li.setAttribute('data-side', p.side === 'geo' ? 'geo' : 'viewer');
      li.appendChild(el('span', null, String(p.name || '')));
      li.appendChild(el('em', null, fmtInt(num(p.kills) || 0) + ' kills'));
      list.appendChild(li);
    });
    show(box, true);
  }

  function renderCounts(pub) {
    var c = pub.counts, n = $('svv-counts');
    if (!c || !n) { show(n, false); return; }
    n.textContent = 'Partidas jugadas: ' + fmtInt(c.matches_total || 0) + ' · Turnos activos: ' + fmtInt(c.active_turns || 0) +
      ' · En espera: ' + fmtInt(c.waiting || 0) + ' · Participantes oficiales: ' + fmtInt(c.official_participants || 0);
    show(n, true);
  }

  function renderQueue(pub) {
    var seats = $('svv-seats'), wl = $('svv-waiting-list');
    clear(seats); clear(wl);
    var active = (pub && pub.active_players) || [];
    var queue = (pub && pub.queue) || [];
    var i;
    for (i = 0; i < 3; i++) {
      var p = active[i];
      var li = el('li', 'svv-seat'); li.setAttribute('data-filled', p ? 'true' : 'false');
      li.appendChild(el('span', 'svv-seat__n', 'SLOT ' + (i + 1)));
      li.appendChild(el('span', 'svv-seat__name', p ? String(p.name) : 'Libre'));
      if (p) {
        var used = num(p.matches_consumed) != null ? p.matches_consumed : (p.matches_used || 0), rsv = num(p.matches_reserved) || 0;
        var pips = el('span', 'svv-seat__pips');
        pips.setAttribute('aria-label', 'Partidas consumidas ' + used + ' de ' + p.matches_max + (rsv ? ', ' + rsv + ' reservada' + (rsv > 1 ? 's' : '') : ''));
        for (var k = 0; k < (p.matches_max || 0); k++) { var b = el('i'); if (k < used) b.className = 'on'; else if (k < used + rsv) b.className = 'rsv'; pips.appendChild(b); }
        li.appendChild(pips);
      }
      seats.appendChild(li);
    }
    var sn = $('svv-seats-note');
    if (!pub || !pub.event) sn.textContent = 'No hay participantes registrados.';
    else if (!active.length) sn.textContent = pub.event.status === 'live' ? 'Nadie en la arena ahora mismo.' : 'No hay participantes registrados.';
    else if (active.length > 3) sn.textContent = '+' + (active.length - 3) + ' jugadores activos más.';
    else sn.textContent = '';

    var waiting = pub && pub.counts ? (pub.counts.waiting || 0) : 0;
    setText('svv-waiting-count', String(waiting));
    queue.forEach(function (q) {
      var li = el('li');
      li.appendChild(el('span', 'svv-ladder__pos', q.position ? '#' + q.position : '·'));
      li.appendChild(el('span', 'svv-ladder__name', String(q.name || '')));
      if (q.status === 'called') li.appendChild(el('span', 'svv-ladder__tag', 'Llamado'));
      else if (q.status === 'confirmed') li.appendChild(el('span', 'svv-ladder__tag', 'Confirmado'));
      wl.appendChild(li);
    });
    var wn = $('svv-waiting-note');
    if (!queue.length) wn.textContent = 'No hay participantes registrados.';
    else if (waiting > queue.filter(function (q) { return q.status === 'waiting'; }).length) wn.textContent = 'Se muestran los primeros de la fila.';
    else wn.textContent = '';
  }

  /* ------------------------------ reloj de 3 horas ------------------------------ */
  function tickClock() {
    var box = $('svv-clock'), ring = $('svv-clock-ring');
    if (!box) return;
    var ev = S.pub && S.pub.event, phase = 'none', label = 'Duración de la edición', text = fmtClock(DURATION_S), pct = 0;
    if (S.mode === 'ok' && ev) {
      var now = nowServer();
      if (ev.status === 'scheduled' && ev.scheduled_start_at) {
        phase = 'scheduled'; label = 'Comienza en';
        text = fmtClock((Date.parse(ev.scheduled_start_at) - now) / 1000);
      } else if (ev.status === 'live' && ev.live_started_at && ev.live_ends_at) {
        var st = Date.parse(ev.live_started_at), en = Date.parse(ev.live_ends_at), total = Math.max(1, en - st);
        var left = en - now;
        phase = 'live'; pct = Math.min(100, Math.max(0, ((now - st) / total) * 100));
        if (left > 0) { label = 'Tiempo restante'; text = fmtClock(left / 1000); }
        else { label = 'Tiempo cumplido'; text = fmtClock(0); }
      } else if (ev.status === 'finished' || ev.status === 'settled') {
        phase = 'done'; label = 'Edición finalizada'; text = fmtClock(0); pct = 100;
      }
    }
    box.setAttribute('data-phase', phase);
    setText('svv-clock-label', label);
    setText('svv-clock-text', text);
    if (ring) ring.style.strokeDashoffset = String(100 - pct);
  }

  /* ------------------------------ carga: público ------------------------------ */
  function loadPublic(manual) {
    var seq = ++S.pubReq;
    if (manual) { setStatus('loading', STATUS_TEXT.loading); }
    return rpc('svv_get_public_state').then(function (r) {
      if (seq !== S.pubReq) return; // llegó una respuesta más nueva: esta ya no vale
      if (r.ok) {
        var d = r.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
        if (!d || typeof d !== 'object') { renderError(); return; }
        var t = Date.parse(d.server_time);
        if (!isNaN(t)) S.offsetMs = t - Date.now();
        S.pub = d;
        if (!d.event) renderEmpty(); else renderPublic(d);
        // si cambió la edición visible, recarga reglamento y ficha
        S.pubAt = performance.now();
        if (S.eventKey !== S.rulesKey) { loadRules(); loadMy(); }
      } else if (r.kind === 'missing') {
        renderUnavailable();
        if (S.rulesKey === undefined) loadRules();
      } else {
        renderError();
      }
      renderParticipation();
      schedulePoll();
    });
  }

  function schedulePoll() {
    if (S.pollTimer) clearTimeout(S.pollTimer);
    var live = S.pub && S.pub.event && S.pub.event.status === 'live';
    // en vivo y con participación activa (fila, llamado o partida) se consulta más seguido
    var q = S.my && S.my.queue, fast = live && myReady() && ((q && ACTIVE_Q[q.status]) || S.my.current_match);
    S.pollTimer = setTimeout(function () {
      if (document.hidden) { schedulePoll(); return; }
      loadPublic();
      if (S.eventKey) loadMy();
    }, fast ? POLL_FAST_MS : (live ? POLL_LIVE_MS : POLL_IDLE_MS));
  }

  /* ------------------------------ reglamento ------------------------------ */
  // Estados: loading | ok | empty | error | unavailable.  `S.rulesKey` es la edición PEDIDA; solo `rulesState === 'ok'` (con
  // `S.rulesShown` = versión mostrada) permite decidir sobre el reglamento. Un fallo temporal se reintenta solo (con espera
  // creciente de 3, 6, 12, 20 y 30 s), al volver la conexión y al pulsar «Reintentar».
  var RULES_RETRY_MS = [3000, 6000, 12000, 20000, 30000];

  function clearRulesRetry() { if (S.rulesTimer) { clearTimeout(S.rulesTimer); S.rulesTimer = null; } }
  function scheduleRulesRetry() {
    clearRulesRetry();
    var key = S.rulesKey, n = Math.min(S.rulesFails, RULES_RETRY_MS.length) - 1;
    S.rulesTimer = setTimeout(function () {
      S.rulesTimer = null;
      if (S.rulesKey !== key || S.rulesState !== 'error') return;      // cambió la edición o ya se recuperó
      if (document.hidden || !online()) { scheduleRulesRetry(); return; } // sin pestaña visible o sin red: no se gasta un intento
      loadRules(true);
    }, RULES_RETRY_MS[Math.max(0, n)]);
  }

  function rulesPlaceholder(msg) {
    var body = $('svv-rules-body'); clear(body);
    body.appendChild(el('p', 'svv-muted', msg));
    show($('svv-rules-version'), false); show($('svv-rules-hash'), false);
  }

  function loadRules(force) {
    var key = S.eventKey || null, changed = S.rulesKey !== key;
    if (!force && !changed && (S.rulesState === 'ok' || S.rulesState === 'loading' || S.rulesState === 'empty')) return Promise.resolve();
    S.rulesKey = key;
    if (changed) {
      // otra edición: se descarta YA el reglamento anterior (nunca se decide sobre un texto que no es el vigente)
      clearRulesRetry(); S.rulesFails = 0; S.rulesShown = null; S.rulesState = 'loading';
      $('svv-rules').setAttribute('data-state', 'loading');
      rulesPlaceholder('Cargando reglamento…');
      renderParticipation();
    }
    var seq = ++S.rulesReq;
    var box = $('svv-rules');
    return rpc('svv_get_rules', key ? { p_event_key: key } : undefined).then(function (r) {
      if (seq !== S.rulesReq || key !== (S.eventKey || null)) return; // respuesta vieja (otra solicitud o edición): se ignora
      clearRulesRetry();
      if (!r.ok) {
        S.rulesShown = null;
        if (r.kind === 'missing') {
          S.rulesState = 'unavailable'; box.setAttribute('data-state', 'unavailable');
          rulesPlaceholder('Función próximamente disponible: el reglamento se mostrará aquí.');
        } else {
          S.rulesState = 'error'; S.rulesFails++; box.setAttribute('data-state', 'error');
          rulesPlaceholder('No pudimos cargar el reglamento. Reintentamos solos; también puedes reintentar ahora. Hasta verlo no puedes aceptarlo ni rechazarlo.');
          var rb = el('button', 'svv-btn svv-btn--ghost', 'Reintentar'); rb.type = 'button'; rb.id = 'svv-rules-retry';
          rb.addEventListener('click', function () {
            rb.disabled = true; rb.setAttribute('aria-disabled', 'true');
            S.rulesFails = 0; loadRules(true);
          });
          $('svv-rules-body').appendChild(rb);
          scheduleRulesRetry();
        }
        renderParticipation();
        return;
      }
      S.rulesFails = 0;
      var d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
      var rules = d && d.rules;
      if (!rules) {
        S.rulesState = 'empty'; S.rulesShown = null;
        box.setAttribute('data-state', 'empty');
        rulesPlaceholder('El reglamento se publicará antes de la primera edición.');
        renderParticipation();
        return;
      }
      S.rulesState = 'ok';
      box.setAttribute('data-state', 'ok');
      setText('svv-rules-title', rules.title || 'Reglamento');
      var v = $('svv-rules-version'); v.textContent = 'v' + rules.version_number; show(v, true);
      renderMarkdown($('svv-rules-body'), rules.body_md);
      var h = $('svv-rules-hash');
      if (rules.body_sha256) { h.textContent = 'SHA-256 ' + rules.body_sha256; show(h, true); } else show(h, false);
      S.rulesShown = num(rules.version_number);
      renderParticipation();
    });
  }

  /* ------------------------------ historial ------------------------------ */
  var OUTCOME = { geo_win: 'Ganó Geo', community_win: 'Ganó la comunidad', tie: 'Empate' };

  function loadHistory(reset) {
    var list = $('svv-history-list'), note = $('svv-history-note'), more = $('svv-history-more');
    if (reset) { S.histShown = 0; clear(list); }
    show(more, false);
    var seq = ++S.histReq;
    return rpc('svv_get_history', { p_limit: HISTORY_PAGE, p_offset: S.histShown }).then(function (r) {
      if (seq !== S.histReq) return;
      if (!r.ok) {
        note.textContent = r.kind === 'missing' ? 'Función próximamente disponible.' : 'No pudimos cargar el historial.';
        if (r.kind !== 'missing') { more.textContent = 'Reintentar'; more.setAttribute('data-mode', 'retry'); show(more, true); }
        return;
      }
      var d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
      var eds = (d && d.editions) || [];
      S.histTotal = (d && d.total) || 0;
      eds.forEach(function (e) { list.appendChild(renderEdition(e)); });
      S.histShown += eds.length;
      if (!S.histShown) note.textContent = 'Aún no hay ediciones oficiales de V2 finalizadas.';
      else note.textContent = S.histShown < S.histTotal ? 'Mostrando ' + S.histShown + ' de ' + S.histTotal + ' ediciones.' : '';
      if (S.histShown < S.histTotal) { more.textContent = 'Ver más ediciones'; more.setAttribute('data-mode', 'more'); show(more, true); }
    });
  }

  function renderEdition(e) {
    var li = el('li', 'svv-ed');
    var head = el('div', 'svv-ed__head');
    head.appendChild(el('h3', 'svv-ed__title', e.edition_label || (e.edition_number ? 'Edición #' + e.edition_number : 'Edición')));
    head.appendChild(el('span', 'svv-ed__date', fmtDay(e.finished_at)));
    li.appendChild(head);
    var res = el('div', 'svv-ed__result');
    var g = el('div', 'svv-ed__pts'); g.setAttribute('data-side', 'geo'); g.appendChild(document.createTextNode(fmtInt(num(e.geo_points) || 0))); g.appendChild(el('small', null, 'GEO'));
    var v = el('div', 'svv-ed__pts'); v.setAttribute('data-side', 'viewer'); v.appendChild(document.createTextNode(fmtInt(num(e.viewer_points) || 0))); v.appendChild(el('small', null, 'VIEWERS'));
    var out = el('span', 'svv-ed__out', OUTCOME[e.outcome] || ''); out.setAttribute('data-kind', e.outcome || '');
    res.appendChild(g); res.appendChild(out); res.appendChild(v);
    li.appendChild(res);
    li.appendChild(el('p', 'svv-ed__meta', 'Participantes oficiales: ' + fmtInt(e.official_participants || 0) + ' · Kills: Geo ' + fmtInt(e.geo_kills || 0) + ' / Viewers ' + fmtInt(e.viewer_kills || 0)));
    var top = e.top_participants || [];
    if (top.length) {
      var ul = el('ul', 'svv-ed__top');
      top.forEach(function (p) {
        var t = el('li'); t.appendChild(el('b', null, String(p.name || ''))); t.appendChild(document.createTextNode(' · ' + fmtInt(p.points || 0) + ' pts'));
        ul.appendChild(t);
      });
      li.appendChild(ul);
    }
    return li;
  }

  /* ------------------------------ ficha personal ------------------------------ */
  var BADGE = {
    official: ['official', 'Participante oficial'],
    pending: ['pending', 'En revisión'],
    not_official: ['not_official', 'No oficial'],
    not_played: ['none', 'Aún sin partidas']
  };

  function showFighter(kind, msg, withLogin, withRetry) {
    var sec = $('svv-ficha'); sec.setAttribute('data-state', kind);
    show($('svv-fighter-locked'), kind !== 'ok');
    show($('svv-fighter-sheet'), kind === 'ok');
    if (kind !== 'ok') {
      setText('svv-fighter-locked-msg', msg);
      show($('svv-fighter-login'), !!withLogin);
      retryButton().hidden = !withRetry;
    } else {
      var rb = $('svv-fighter-retry'); if (rb) rb.hidden = true;
    }
  }

  // Botón "Reintentar" de la ficha: se crea aquí para no tocar el HTML aprobado.
  function retryButton() {
    var b = $('svv-fighter-retry');
    if (b) return b;
    b = el('button', 'svv-btn svv-btn--ghost', 'Reintentar');
    b.type = 'button'; b.id = 'svv-fighter-retry'; b.hidden = true;
    b.addEventListener('click', function () { loadMy(); });
    $('svv-fighter-locked').appendChild(b);
    return b;
  }

  // 4B: borra de inmediato TODO dato personal de la ficha (el DOM no conserva nada del usuario anterior)
  function clearFighter() {
    setText('svv-id-name', '—'); setText('svv-id-initial', 'V');
    var badge = $('svv-id-badge'); if (badge) { badge.textContent = '—'; badge.setAttribute('data-kind', 'none'); }
    setText('svv-id-rules', '');
    ['svv-st-matches', 'svv-st-kills', 'svv-st-points', 'svv-st-pos'].forEach(function (id) { setText(id, '—'); });
    clear($('svv-past-list')); show($('svv-past'), false);
  }

  // 4B: la identidad cambió (login, logout u otra cuenta). Invalida TODO lo pendiente de la sesión anterior.
  function identityChanged(newId) {
    S.epoch++;          // las respuestas que salieron con la identidad anterior ya no se aplican
    S.myReq++;          // y cualquier solicitud de ficha en vuelo queda obsoleta
    S.userId = newId;
    S.my = null; S.myState = newId ? 'loading' : 'locked'; S.pending = {}; S.fb = {}; S.needLogin = false; S.leaveArmed = false;
    S.shieldReq++; S.shield = null; S.shieldState = 'idle'; S.shieldArmed = false; S.shieldAt = 0;
    clearFighter();
    renderParticipation();
  }

  function loadMy() {
    var client = getClient();
    if (!client || !client.auth) { showFighter('locked', 'Ficha: función próximamente disponible.', false); S.myState = 'unavailable'; renderParticipation(); return Promise.resolve(); }
    var seq = ++S.myReq;
    return client.auth.getSession().then(function (res) {
      if (seq !== S.myReq) return; // otra solicitud más nueva (o un cambio de identidad) la reemplazó
      var session = res && res.data && res.data.session;
      var id = (session && session.user && session.user.id) || null;
      if (id !== S.userId) { identityChanged(id); seq = S.myReq; }
      if (!id) { showFighter('locked', 'Inicia sesión con Twitch para ver tus partidas, kills y posición.', true); S.my = null; S.myState = 'locked'; renderParticipation(); return; }
      var epoch = S.epoch;
      return rpc('svv_get_my_state', S.eventKey ? { p_event_key: S.eventKey } : undefined).then(function (r) {
        // descarta la respuesta si cambió la identidad o llegó una solicitud más nueva
        if (seq !== S.myReq || epoch !== S.epoch) return;
        if (!r.ok) {
          // ante un fallo NO se conserva el estado anterior: sin lectura fiable no se ofrecen acciones
          if (r.kind === 'missing') { S.myState = 'unavailable'; showFighter('unavailable', 'Ficha: función próximamente disponible.', false); }
          else if (r.kind === 'auth') { S.myState = 'locked'; S.needLogin = true; showFighter('locked', 'Tu sesión no es válida para ver la ficha. Vuelve a iniciar sesión.', true); }
          else { S.myState = 'error'; showFighter('error', 'No pudimos cargar tu ficha. Revisa tu conexión e inténtalo de nuevo.', false, true); }
          renderParticipation();
          return;
        }
        var d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
        if (!d) { S.myState = 'error'; showFighter('error', 'No pudimos cargar tu ficha.', false, true); renderParticipation(); return; }
        S.my = d; S.myState = 'ok'; S.myAt = performance.now(); S.needLogin = false;
        renderFighter(d);
        renderParticipation();
        schedulePoll(); // con participación activa el sondeo pasa al ritmo rápido
        return loadShield();
      });
    }, function () {
      if (seq !== S.myReq) return;
      S.my = null; S.myState = 'error';
      showFighter('error', 'No pudimos comprobar tu sesión. Revisa tu conexión e inténtalo de nuevo.', false, true);
      renderParticipation();
    });
  }

  function renderFighter(d) {
    showFighter('ok');
    var name = (d.profile && d.profile.display_name) || 'Combatiente';
    setText('svv-id-name', name);
    setText('svv-id-initial', String(name).charAt(0).toUpperCase() || 'V');
    var badge = $('svv-id-badge'), rules = $('svv-id-rules');
    if (!d.event) {
      badge.textContent = 'Sin edición activa'; badge.setAttribute('data-kind', 'none');
      rules.textContent = '';
      ['svv-st-matches', 'svv-st-kills', 'svv-st-points', 'svv-st-pos'].forEach(function (id) { setText(id, '—'); });
    } else {
      var b = BADGE[d.official_status] || BADGE.not_played;
      badge.textContent = b[1]; badge.setAttribute('data-kind', b[0]);
      var dec = d.rules && d.rules.decision;
      rules.textContent = dec === 'accepted' ? (d.rules.accepted_current ? 'Reglamento aceptado' : 'Aceptaste otra versión del reglamento')
                        : dec === 'rejected' ? 'Reglamento rechazado' : 'Reglamento pendiente de aceptación';
      var st = d.stats || {};
      setText('svv-st-matches', fmtInt(num(st.matches_played) || 0));
      setText('svv-st-kills', fmtInt(num(st.kills) || 0));
      setText('svv-st-points', fmtInt(num(st.points) || 0));
      var pos = '—';
      if (d.queue) pos = d.queue.status === 'waiting' && d.queue.position ? '#' + d.queue.position
                       : d.queue.status === 'in_turn' ? 'En turno' : d.queue.status === 'called' ? 'Llamado' : d.queue.status === 'confirmed' ? 'Confirmado' : '—';
      setText('svv-st-pos', pos);
    }
    var past = d.past_editions || [], box = $('svv-past'), ul = $('svv-past-list');
    clear(ul);
    past.forEach(function (p) {
      var li = el('li');
      li.appendChild(el('b', null, p.edition_label || (p.edition_number ? 'Edición #' + p.edition_number : 'Edición')));
      li.appendChild(el('span', null, fmtInt(p.matches_played || 0) + ' partidas'));
      li.appendChild(el('span', null, fmtInt(p.kills || 0) + ' kills'));
      li.appendChild(el('span', null, fmtInt(p.points || 0) + ' pts'));
      li.appendChild(el('span', null, p.is_official ? 'Oficial' : 'No oficial'));
      ul.appendChild(li);
    });
    show(box, past.length > 0);
  }

  /* =========================================================================
     6A-8 · PARTICIPACIÓN DEL VIEWER
     Todo estado y todo plazo los decide Supabase. Los segundos restantes se cuentan desde el instante en que
     llegó la respuesta (`response_seconds_left` / `lobby_seconds_left`), no desde el reloj del dispositivo.
     ========================================================================= */
  var ACTIVE_Q = { waiting: 1, called: 1, confirmed: 1, in_turn: 1 };
  var REQ_TTL_MS = 30000;   // una clave de operación incierta (sin respuesta) solo se reutiliza este tiempo
  var FB_OK_MS = 8000, FB_ERR_MS = 25000;

  var JOIN_REASON = {
    event_not_open: 'Esta edición no admite inscripciones ahora.',
    last_round: 'Última ronda: ya no se aceptan inscripciones.',
    queue_closed: 'La fila está cerrada por ahora.',
    rules_not_accepted: 'Acepta el reglamento para poder inscribirte.',
    already_in_queue: 'Ya estás inscrito en la fila.',
    turn_already_used: 'Ya usaste tu turno en esta edición.',
    matches_exhausted: 'Ya usaste todas tus oportunidades de partida.'
  };

  function online() { return !(typeof navigator !== 'undefined' && navigator.onLine === false); }
  function logged() { return typeof S.userId === 'string' && S.userId.length > 0; }
  // `my` es fiable solo si pertenece a la sesión y a la edición que se están mostrando
  function myReady() {
    return logged() && S.myState === 'ok' && !!S.my && !!S.my.event && !!S.eventKey && S.my.event.key === S.eventKey;
  }
  function secLeft(base) { // segundos restantes de un plazo, contados desde que llegó la respuesta del servidor
    if (typeof base !== 'number') return null;
    return Math.max(0, Math.ceil(base - (performance.now() - S.myAt) / 1000));
  }
  function mmss(sec) { var s = Math.max(0, Math.floor(sec)); return Math.floor(s / 60) + ':' + pad(s % 60); }

  /* ------------------------------ claves de operación ------------------------------ */
  function uuid() {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16), i;
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = []; for (i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }
  // La misma intención (misma acción, usuario, edición y contenido) reutiliza su clave mientras no se sepa el resultado:
  // si la red falló después de que Supabase la procesó, el reintento devuelve el mismo resultado (replayed) en vez de duplicar.
  function requestId(action, sig) {
    var now = Date.now(), p = S.pending[action];
    if (p && p.sig === sig && now - p.ts < REQ_TTL_MS) return p.id;
    S.pending = {}; // una intención distinta descarta las inciertas anteriores
    p = S.pending[action] = { id: uuid(), sig: sig, ts: now };
    return p.id;
  }

  /* ------------------------------ escritura ------------------------------ */
  function classifyWrite(err, status) {
    var code = String(err.code || ''), msg = String(err.message || '');
    if (code === 'SV004' || status === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt/i.test(msg)) return 'auth';
    if (code === '42501' || status === 403) return 'auth';
    if (code === 'SV006') return 'rules_version';
    if (code === 'SV005') return 'conflict';
    if (code === 'SV003') return 'business';
    if (code === 'PGRST202' || code === '42883' || status === 404) return 'missing';
    if (/failed to fetch|network|load failed|timeout|fetch/i.test(msg) || status === 0 || (status && status >= 500)) return 'network';
    return 'other';
  }
  // Devuelve {ok:true,data} o {ok:false,kind,code,message}. Nunca lanza.
  function rpcWrite(name, args) {
    var client = getClient();
    if (!client) return Promise.resolve({ ok: false, kind: 'network', message: 'sin cliente' });
    if (!online()) return Promise.resolve({ ok: false, kind: 'network', message: 'sin conexión' });
    var call;
    try { call = client.rpc(name, args); }
    catch (e) { return Promise.resolve({ ok: false, kind: 'other', message: String(e && e.message || e) }); }
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve({ __timeout: true }); }, RPC_TIMEOUT_MS); });
    return Promise.race([Promise.resolve(call), timeout]).then(function (res) {
      if (!res || res.__timeout) return { ok: false, kind: 'network', message: 'tiempo de espera' };
      if (res.error) return { ok: false, kind: classifyWrite(res.error, res.status), code: String(res.error.code || ''), message: String(res.error.message || '') };
      var d = res.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
      return { ok: true, data: d || {} };
    }, function (e) { return { ok: false, kind: 'network', message: String(e && e.message || e) }; });
  }

  var BUSINESS = [
    [/ya tienes una inscripci/i, 'Ya tienes una inscripción activa en esta edición.'],
    [/la fila no est/i, 'La fila no está abierta en este momento.'],
    [/Última ronda/i, 'Última ronda activa: ya no se aceptan inscripciones.'],
    [/aceptar el reglamento/i, 'Debes aceptar el reglamento de esta edición para inscribirte.'],
    [/plazo de respuesta/i, 'El plazo de respuesta venció: ya no puedes confirmar este llamado.'],
    [/todav[ií]a no has sido llamado/i, 'Todavía no te han llamado.'],
    [/ya fue confirmado/i, 'Tu llamado ya estaba confirmado.'],
    [/tu turno ya comenz/i, 'Tu turno ya comenzó: no puedes salir de la fila.'],
    [/no tienes una inscripci/i, 'No tienes una inscripción activa.'],
    [/ret[ií]rate de la fila antes de rechazar/i, 'Primero sal de la fila y luego podrás rechazar el reglamento.'],
    [/solo se confirman con la edici/i, 'Los llamados solo se confirman con la edición en vivo.'],
    [/la edici[oó]n no existe|no est[aá] disponible/i, 'La edición ya no está disponible.']
  ];
  function describeError(r) {
    if (r.friendly) return r.friendly;
    switch (r.kind) {
      case 'network': return 'No pudimos confirmar si la operación se completó (problema de conexión). Puedes reintentar: no se duplicará.';
      case 'auth': return 'Tu sesión no es válida o expiró. Vuelve a iniciar sesión con Twitch.';
      case 'rules_version': return 'El reglamento cambió. Lo recargamos: léelo y decide de nuevo.';
      case 'conflict': return 'No pudimos procesar esa solicitud. Inténtalo de nuevo.';
      case 'missing': return 'Esta función todavía no está disponible.';
      case 'business':
        for (var i = 0; i < BUSINESS.length; i++) if (BUSINESS[i][0].test(r.message || '')) return BUSINESS[i][1];
        return String(r.message || 'La operación no se pudo completar.').replace(/^svv:\s*/i, '').slice(0, 180);
      default: return 'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.';
    }
  }

  function fbSet(area, kind, text) { S.fb[area] = { kind: kind, text: text, at: Date.now() }; }
  function fbGet(area) {
    var f = S.fb[area];
    if (!f) return null;
    if (Date.now() - f.at > (f.kind === 'ok' ? FB_OK_MS : FB_ERR_MS)) { delete S.fb[area]; return null; }
    return f;
  }

  function refreshAll() {
    return Promise.all([loadPublic(), loadMy()]).catch(function () {});
  }

  // Candado anti doble clic: una sola escritura a la vez; se libera tras releer el estado desde Supabase.
  function runAction(action, area, call, okText) {
    if (S.busy) return;
    var client = getClient();
    if (!client || !client.auth) return;
    S.busy = action; S.leaveArmed = false; S.shieldArmed = false; delete S.fb[area];
    var uid = S.userId, epoch = S.epoch;
    renderParticipation();
    client.auth.getSession().then(function (res) {
      var sess = res && res.data && res.data.session;
      if (!sess || !sess.user) {
        fbSet(area, 'error', 'Tu sesión no está activa. Inicia sesión con Twitch para continuar.'); S.needLogin = true;
        return { skipped: true };
      }
      if (sess.user.id !== uid || epoch !== S.epoch) {
        fbSet(area, 'error', 'Tu sesión cambió. Revisa tu estado e inténtalo de nuevo.');
        return { skipped: true };
      }
      return call();
    }, function () { return { ok: false, kind: 'network', message: 'sesión' }; }).then(function (r) {
      if (!r || r.skipped) return;
      if (epoch !== S.epoch) return; // cambió la identidad mientras tanto: no se muestra nada de la anterior
      if (r.ok) {
        delete S.pending[action];
        fbSet(area, 'ok', okText(r.data || {}));
      } else {
        if (r.kind !== 'network' && r.kind !== 'other') delete S.pending[action]; // resultado definitivo: la próxima intención usa otra clave
        if (r.kind === 'auth') S.needLogin = true;
        if (r.kind === 'rules_version') loadRules(true);
        fbSet(area, 'error', describeError(r));
      }
    }).catch(function () {
      fbSet(area, 'error', 'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.');
    }).then(function () {
      S.shieldAt = 0;                                  // tras cualquier acción se vuelve a leer el Escudo
      return refreshAll();
    }).then(function () { S.busy = null; renderParticipation(); }, function () { S.busy = null; renderParticipation(); });
  }

  /* ------------------------------ acciones ------------------------------ */
  function doDecide(decision) {
    if (S.busy || !myReady() || !online()) return;
    var ev = S.my.event, ver = num(ev.rules_version_number), key = S.eventKey;
    if (S.rulesState !== 'ok') return;                                    // sin reglamento visible no se decide (el reintento lo gestiona loadRules)
    if (ver == null || S.rulesShown !== ver) { loadRules(true); return; } // el texto mostrado no es el vigente
    var sig = [S.userId, key, decision, ver].join('|');
    runAction('accept', 'rules', function () {
      return rpcWrite('svv_accept_rules', { p_event_key: key, p_request: requestId('accept', sig), p_decision: decision, p_version_number: ver });
    }, function () { return decision === 'accepted' ? 'Reglamento aceptado (v' + ver + ').' : 'Reglamento rechazado.'; });
  }
  function doJoin() {
    if (!logged()) { openLogin(); return; }
    if (S.busy || !myReady() || !online()) return;
    var opp = S.my.opportunities;
    if (!opp || !opp.can_join) return;
    var key = S.eventKey, sig = [S.userId, key].join('|');
    runAction('join', 'queue', function () {
      return rpcWrite('svv_join_queue', { p_event_key: key, p_request: requestId('join', sig) });
    }, function () { return 'Listo: estás en la fila. Tu lugar se muestra abajo.'; });
  }
  function doLeave() {
    if (S.busy || !myReady() || !online()) return;
    var q = S.my.queue;
    if (!q || !(q.status === 'waiting' || q.status === 'called' || q.status === 'confirmed')) return;
    var key = S.eventKey, sig = [S.userId, key].join('|');
    runAction('leave', 'queue', function () {
      return rpcWrite('svv_leave_queue', { p_event_key: key, p_request: requestId('leave', sig) });
    }, function () { return 'Saliste de la fila. Si vuelves a entrar, quedarás al final.'; });
  }
  function doConfirm() {
    if (S.busy || !myReady() || !online()) return;
    var q = S.my.queue;
    if (!q || q.status !== 'called' || !q.can_confirm) return;
    var left = secLeft(num(q.response_seconds_left));
    if (left == null || left <= 0) return; // el plazo local terminó: se vuelve a preguntar a Supabase, no se envía
    var key = S.eventKey, sig = [S.userId, key].join('|');
    runAction('confirm', 'queue', function () {
      return rpcWrite('svv_confirm_call', { p_event_key: key, p_request: requestId('confirm', sig) });
    }, function () { return '¡Llamado confirmado! Prepárate: Geo abrirá tu partida.'; });
  }

  /* ------------------------------ Escudo (6C-1) ------------------------------ */
  var SHIELD_BASE = 'Se compra antes de tu primera partida. Máximo 1 por edición, no se transfiere y solo vale en esa edición.';
  var SHIELD_REASON = {
    event_unavailable: 'La edición ya no admite la compra de Escudos.',
    not_money_edition: 'Esta edición no tiene premio ni penalización: el Escudo no se vende.',
    payments_off: 'La venta del Escudo está en pausa: los pagos de esta edición aún no están habilitados.',
    gcoin_unavailable: 'No pudimos cobrar los G-Coins ahora mismo. No se te descontó nada; inténtalo más tarde.',
    protections_off: 'La venta del Escudo está en pausa: faltan protecciones económicas por habilitar.',
    result_exists: 'El resultado de la edición ya está calculado: el Escudo ya no se puede comprar.',
    rules_not_accepted: 'Acepta el reglamento de esta edición para poder comprar el Escudo.',
    not_in_queue: 'Debes estar inscrito en la fila de esta edición para comprar el Escudo.',
    already_bought: 'Ya compraste el Escudo de esta edición.',
    match_started: 'Tu primera partida válida ya empezó: el Escudo solo se compra antes del Battle Bus.',
    insufficient_funds: 'No tienes G-Coins suficientes (el Escudo cuesta 2,000).',
    disabled: 'La venta de Escudos todavía no está disponible.'
  };
  function loadShield() {
    if (!S.eventKey || !logged()) { S.shield = null; S.shieldState = logged() ? 'idle' : 'locked'; renderShield(); return Promise.resolve(); }
    if (S.shieldState === 'ok' && S.shieldAt && performance.now() - S.shieldAt < 8000) { renderShield(); return Promise.resolve(); }   // no repetir la lectura en cada sondeo
    var seq = ++S.shieldReq, epoch = S.epoch;
    return rpc('svv_get_my_shield', { p_event_key: S.eventKey }).then(function (r) {
      if (seq !== S.shieldReq || epoch !== S.epoch) return;
      if (!r.ok) {
        S.shield = null;
        S.shieldState = r.kind === 'missing' ? 'unavailable' : r.kind === 'auth' ? 'locked' : 'error';
        renderShield(); return;
      }
      var d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
      S.shield = d && typeof d === 'object' ? d : null; S.shieldState = S.shield ? 'ok' : 'error'; S.shieldAt = performance.now();
      renderShield();
    });
  }
  // La compra NO es una RPC del navegador: es la Edge Function (service_role en el servidor). Devuelve {ok,data} o {ok:false,kind,friendly}.
  function shieldFail(body, status) {
    var reason = body && body.reason, code = body && body.code;
    if (status === 401 || status === 403) return { ok: false, kind: 'auth', message: 'sesión' };
    if (status === 404) return { ok: false, kind: 'missing', message: 'no instalada' };
    if (code === 'SV005') return { ok: false, kind: 'conflict', message: 'clave' };
    if (reason && SHIELD_REASON[reason]) return { ok: false, kind: 'business', message: reason, friendly: SHIELD_REASON[reason] };
    if (status && status >= 500) return { ok: false, kind: 'network', message: 'servidor' };   // incierto: se conserva la clave; el reintento devuelve lo mismo (replayed)
    return { ok: false, kind: 'other', message: 'respuesta inesperada' };
  }
  function invokeShield(key, reqId) {
    var client = getClient();
    if (!client || !client.functions || typeof client.functions.invoke !== 'function') return Promise.resolve({ ok: false, kind: 'missing', message: 'sin cliente' });
    if (!online()) return Promise.resolve({ ok: false, kind: 'network', message: 'sin conexión' });
    var call;
    try { call = client.functions.invoke('svv-shield-buy', { body: { event_key: key, request_id: reqId } }); }
    catch (e) { return Promise.resolve({ ok: false, kind: 'other', message: String(e && e.message || e) }); }
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve({ __timeout: true }); }, RPC_TIMEOUT_MS * 2); });
    return Promise.race([Promise.resolve(call), timeout]).then(function (res) {
      if (!res || res.__timeout) return { ok: false, kind: 'network', message: 'tiempo de espera' };
      if (!res.error) {
        var d = res.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
        if (d && d.ok === true) return { ok: true, data: d.data || {} };
        return shieldFail(d, 0);
      }
      var ctx = res.error.context;                                   // FunctionsHttpError: la respuesta HTTP viene en context
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().then(function (b) { return shieldFail(b, ctx.status); }, function () { return shieldFail(null, ctx.status || 500); });
      }
      return { ok: false, kind: 'network', message: String(res.error.message || 'red') };
    }, function (e) { return { ok: false, kind: 'network', message: String(e && e.message || e) }; });
  }
  function doBuyShield() {
    if (S.busy || !myReady() || !online()) return;
    var sh = S.shield;
    if (!sh || !sh.can_buy || !S.eventKey) return;
    var key = S.eventKey, sig = [S.userId, key].join('|');
    runAction('shield', 'shield', function () {
      return invokeShield(key, requestId('shield', sig));
    }, function () { return 'Escudo comprado: quedó activo para esta edición.'; });
  }
  function renderShield() {
    var card = $('svv-shield'); if (!card) return;
    var badge = $('svv-shield-badge'), note = $('svv-shield-note'), act = $('svv-shield-act'), btn = $('svv-btn-shield');
    var state = 'soon', label = 'Próximamente', msg = SHIELD_BASE, canBuy = false;
    var sh = S.shield, f = fbGet('shield');
    if (!logged()) { msg = SHIELD_BASE + ' Inicia sesión con Twitch para comprarlo.'; }
    else if (S.shieldState === 'error') { label = 'Sin datos'; msg = 'No pudimos cargar el estado de tu Escudo. Se reintenta al actualizar.'; }
    else if (S.shieldState !== 'ok' || !sh) { /* cargando / no instalado: se queda «Próximamente» */ }
    else {
      var p = sh.purchase;
      if (p && p.status === 'active') {
        state = 'active'; label = 'Activo';
        msg = 'Tienes el Escudo de esta edición. Si Geo gana, no se te descuentan los 1,000 V-Bucks.';
        if (p.refund_state === 'wait_result') msg += ' Su destino se decide cuando se confirma el resultado (si ganan los Viewers o se cancela, se reembolsa solo).';
      } else if (p && p.status === 'refund_pending') {
        state = 'refund'; label = 'Reembolso en proceso';
        msg = p.refund_reason === 'viewers_win' ? 'Ganaron los Viewers: tu Escudo se reembolsa automáticamente (2,000 G-Coins).'
            : p.refund_reason === 'event_cancelled' ? 'La edición se canceló: tu Escudo se reembolsa automáticamente (2,000 G-Coins).'
            : 'Tu Escudo no se usó en esta edición: se reembolsa automáticamente (2,000 G-Coins).';
        if (p.refund_retrying) msg += ' El abono se está reintentando; no tienes que hacer nada.';
      } else if (p && p.status === 'used') {
        state = 'used'; label = 'Usado';
        msg = p.used_reason === 'protected' ? 'Tu Escudo te protegió: no se te descontó la penalización.'
                                           : 'Tu Escudo se consideró utilizado en esta edición (participaste de forma oficial). No es reembolsable.';
      } else if (p && p.status === 'refunded') {
        state = 'refunded'; label = 'Reembolsado'; msg = 'Tu Escudo fue reembolsado: se te devolvieron 2,000 G-Coins.';
      } else if (!sh.available) { /* venta apagada: «Próximamente» */ }
      else if (sh.can_buy) { state = 'buy'; label = 'Disponible'; canBuy = true; }
      else { state = 'locked'; label = 'No disponible'; msg = SHIELD_REASON[sh.block_reason] || 'El Escudo no está disponible ahora.'; }
    }
    if (f) msg = f.text;
    card.setAttribute('data-state', state);
    if (badge) badge.textContent = label;
    if (note) note.textContent = msg;
    show(act, canBuy);
    if (!canBuy) S.shieldArmed = false;
    if (btn) {
      btn.textContent = S.shieldArmed ? 'Confirmar compra · 2,000 G-Coins' : 'Comprar Escudo';
      btn.disabled = !canBuy || !!S.busy || !online(); btn.setAttribute('aria-disabled', btn.disabled ? 'true' : 'false');
      if (S.busy === 'shield') btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    }
  }
  function onShieldClick() {
    if (S.busy || !S.shield || !S.shield.can_buy) return;
    if (!S.shieldArmed) {                    // primer clic: pide confirmar (se desarma solo a los 8 s)
      S.shieldArmed = true; renderShield();
      clearTimeout(S.shieldTimer); S.shieldTimer = setTimeout(function () { S.shieldArmed = false; renderShield(); }, 8000);
      return;
    }
    clearTimeout(S.shieldTimer); S.shieldArmed = false;
    doBuyShield();
  }
  function openLogin() {
    if (window.GeoArmyAccount && window.GeoArmyAccount.openLogin) window.GeoArmyAccount.openLogin();
  }

  /* ------------------------------ render ------------------------------ */
  function setBtn(id, disabled, label) {
    var b = $(id); if (!b) return;
    b.disabled = !!disabled; b.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (label != null) b.textContent = label;
    if (S.busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
  }
  function setNote(boxId, textId, kind, text) {
    var box = $(boxId); if (box) box.setAttribute('data-kind', kind || 'info');
    setText(textId, text);
  }

  function renderParticipation() {
    var hasEvent = !!(S.pub && S.pub.event);
    var ready = myReady(), isLogged = logged(), onl = online(), busy = !!S.busy;
    var my = ready ? S.my : null;
    var ev = my && my.event, q = my && my.queue, opp = my && my.opportunities, rl = my && my.rules, cm = my && my.current_match;
    var evOpen = !!ev && (ev.status === 'scheduled' || ev.status === 'live');
    var activeQ = !!q && !!ACTIVE_Q[q.status];

    /* ---- reglamento: aceptar / rechazar ---- */
    var accDis = true, rejDis = true, rmsg, rkind = 'info';
    if (!hasEvent) rmsg = 'Cuando haya una edición abierta podrás aceptar o rechazar su reglamento.';
    else if (!isLogged) rmsg = 'Inicia sesión con Twitch para aceptar o rechazar el reglamento.';
    else if (S.myState === 'error') { rmsg = 'No pudimos verificar tu estado. Reintenta para decidir sobre el reglamento.'; rkind = 'error'; }
    else if (S.myState === 'unavailable') rmsg = 'La participación todavía no está disponible.';
    else if (!ready) rmsg = 'Cargando tu estado…';
    else if (!evOpen) rmsg = 'Esta edición ya no admite decisiones sobre el reglamento.';
    else if (S.rulesState === 'error' || S.rulesState === 'unavailable') { rmsg = 'No pudimos cargar el reglamento vigente: no puedes aceptarlo ni rechazarlo hasta verlo. Reintentando…'; rkind = 'error'; }
    else if (num(ev.rules_version_number) == null || S.rulesShown !== num(ev.rules_version_number)) rmsg = 'Actualizando el reglamento vigente…';
    else {
      var cur = !!(rl && rl.accepted_current), dec = rl && rl.decision;
      accDis = cur || busy || !onl;
      rejDis = dec === 'rejected' || activeQ || busy || !onl;
      if (dec === 'accepted' && cur) { rmsg = 'Aceptaste el reglamento vigente (v' + ev.rules_version_number + ').'; rkind = 'ok'; }
      else if (dec === 'accepted') rmsg = 'Tu aceptación corresponde a otra versión del reglamento.';
      else if (dec === 'rejected') rmsg = 'Rechazaste el reglamento. Acéptalo cuando quieras para poder inscribirte.';
      else rmsg = 'Aún no has decidido. Acepta el reglamento para poder unirte a la fila.';
      if (activeQ && dec !== 'rejected') rmsg += ' Para rechazarlo primero debes salir de la fila.';
      if (!onl) rmsg = 'Sin conexión. Las acciones se reactivan al volver a conectar.';
    }
    var fr = fbGet('rules');
    setBtn('svv-btn-accept', accDis); setBtn('svv-btn-reject', rejDis);
    var ba = $('svv-btn-accept'), br = $('svv-btn-reject');
    if (ba) ba.setAttribute('aria-pressed', String(!!(rl && rl.accepted_current)));
    if (br) br.setAttribute('aria-pressed', String(!!(rl && rl.decision === 'rejected')));
    setNote('svv-rules-note', 'svv-rules-note-text', fr ? fr.kind : rkind, fr ? fr.text : rmsg);

    /* ---- unirme a la fila ---- */
    var joinDis = true, joinLabel = 'Unirme a la fila', jmsg, jkind = 'info';
    if (!hasEvent) jmsg = 'Próxima edición: la inscripción se abrirá cuando Geo la anuncie.';
    else if (!isLogged) { joinDis = false; joinLabel = 'Iniciar sesión para unirme'; jmsg = 'Necesitas iniciar sesión con Twitch para inscribirte.'; }
    else if (S.myState === 'error') { jmsg = 'No pudimos verificar tu estado. Reintenta desde «Tu participación».'; jkind = 'error'; }
    else if (S.myState === 'unavailable') jmsg = 'La inscripción todavía no está disponible.';
    else if (!ready) jmsg = 'Cargando tu estado…';
    else if (!onl) jmsg = 'Sin conexión. Se reactiva al volver a conectar.';
    else if (opp && opp.can_join) { joinDis = busy; jmsg = 'Puedes unirte ahora. Entrarás al final de la fila.'; jkind = 'ok'; }
    else if (activeQ) jmsg = q.status === 'waiting' && q.position ? 'Ya estás en la fila · posición #' + q.position + '.' : 'Ya estás inscrito en esta edición.';
    else jmsg = JOIN_REASON[opp && opp.join_blocked_reason] || 'La inscripción no está disponible ahora.';
    var fq = fbGet('queue');
    setBtn('svv-btn-join', joinDis, joinLabel);
    setNote('svv-join-note-box', 'svv-join-note', fq ? fq.kind : jkind, fq ? fq.text : jmsg);

    renderShield();
    renderMe({ hasEvent: hasEvent, ready: ready, isLogged: isLogged, my: my, ev: ev, q: q, opp: opp, cm: cm, activeQ: activeQ, busy: busy, onl: onl, fq: fq });
    tickParticipation();
  }

  function renderMe(c) {
    var box = $('svv-me'); if (!box) return;
    var pill = 'Cargando…', msg = 'Cargando tu estado…', kind = 'none', state = 'loading';
    var showCall = false, showLobby = false, showLogin = false, showRetry = false;
    var my = c.my, ev = c.ev, q = c.q, cm = c.cm, opp = c.opp;

    if (!c.hasEvent) {
      if (S.mode === 'error') { pill = 'Sin conexión'; msg = 'No pudimos conectar con la Arena. Revisa tu conexión e inténtalo otra vez.'; state = 'error'; kind = 'error'; showRetry = true; }
      else if (S.mode === 'unavailable') { pill = 'Próximamente'; msg = 'La participación todavía no está disponible.'; state = 'empty'; }
      else if (S.mode === 'loading') { pill = 'Cargando…'; msg = 'Conectando con la Arena…'; }
      else { pill = 'Próxima edición'; msg = 'Aún no hay una edición abierta. Cuando Geo la anuncie podrás aceptar el reglamento y unirte a la fila.'; state = 'empty'; kind = 'soon'; }
    } else if (!c.isLogged) {
      pill = 'Sin sesión'; msg = 'Inicia sesión con Twitch para aceptar el reglamento, unirte a la fila y seguir tu llamado.'; state = 'locked'; showLogin = true;
    } else if (S.myState === 'error') {
      pill = 'Sin datos'; msg = 'No pudimos cargar tu estado. Revisa tu conexión e inténtalo de nuevo.'; state = 'error'; kind = 'error'; showRetry = true;
    } else if (S.myState === 'unavailable') {
      pill = 'Próximamente'; msg = 'La participación todavía no está disponible.'; state = 'empty';
    } else if (!c.ready) {
      pill = 'Cargando…'; msg = 'Cargando tu estado…';
      if (S.needLogin || S.myState === 'locked') { showLogin = true; pill = 'Sesión no válida'; msg = 'Tu sesión no es válida. Vuelve a iniciar sesión con Twitch.'; state = 'locked'; }
    } else {
      state = 'ok';
      var done = ev.status === 'finished' || ev.status === 'settled';
      if (done) {
        pill = 'Edición finalizada'; kind = 'done';
        var mr = my.my_result;
        msg = mr ? (mr.is_official ? 'La edición terminó. Resultado confirmado: fuiste participante oficial.' : mr.participated ? 'La edición terminó. Resultado confirmado: esta vez no quedaste como participante oficial.' : 'La edición terminó. Resultado confirmado.')
                 : 'La edición terminó. El resultado oficial está en revisión.';
      } else if (cm) {
        var st = cm.my_status;
        if (st === 'waiting_to_enter' && cm.phase === 'preparing') { pill = 'Partida abierta'; kind = 'prep'; msg = 'Geo está preparando tu partida. Mantente atento: pronto se abrirá el lobby.'; }
        else if (st === 'waiting_to_enter') { pill = 'Lobby abierto'; kind = 'lobby'; showLobby = true; msg = cm.lobby_expired ? 'El plazo para entrar al lobby terminó. Geo decidirá cómo continuar.' : 'El lobby está abierto: entra antes de que termine el plazo.'; }
        else if (st === 'in_lobby') { pill = 'En el lobby'; kind = 'lobby'; showLobby = true; msg = 'Ya estás en el lobby. Esperando el comienzo del Battle Bus.'; }
        else if (st === 'playing') { pill = 'En juego'; kind = 'live'; msg = 'El Battle Bus comenzó. ¡A jugar! Tus kills suman al marcador de la comunidad.'; }
        else if (st === 'disconnected') { pill = 'Desconectado'; kind = 'warn'; msg = 'Se detectó una desconexión. Tus kills anteriores se conservan; si vuelves, Geo debe confirmar tu reconexión.'; }
        else if (st === 'not_started') { pill = 'Ausente al iniciar'; kind = 'warn'; msg = 'No estabas presente cuando comenzó el Battle Bus: esta partida no consume tu oportunidad.'; }
        else { pill = 'Partida abierta'; kind = 'prep'; msg = 'Tienes una partida abierta.'; }
      } else if (q && q.status === 'called') {
        if (q.response_expired) { pill = 'Llamado vencido'; kind = 'warn'; msg = 'El plazo de respuesta venció: ya no puedes confirmar. Geo actualizará la fila y volverás al final.'; }
        else { pill = 'Llamado de Geo'; kind = 'call'; showCall = true; msg = '¡Geo te está llamando! Confirma antes de que termine la cuenta regresiva.'; }
      } else if (q && q.status === 'confirmed') { pill = 'Confirmado'; kind = 'ok'; msg = 'Llamado confirmado. Espera: Geo abrirá tu partida.'; }
      else if (q && q.status === 'in_turn') { pill = 'Turno activo'; kind = 'live'; msg = 'Tu turno está activo. Entre partidas Geo preparará la siguiente.'; }
      else if (q && q.status === 'waiting') {
        pill = q.position ? 'En fila · #' + q.position : 'En fila'; kind = 'wait';
        msg = ev.status === 'live' ? 'Estás en la fila. Espera a que Geo te llame: tendrás 120 segundos para confirmar.' : 'Estás en la fila. Los llamados comienzan cuando la edición esté en vivo.';
      } else if (opp && opp.can_join) { pill = 'Listo para unirte'; kind = 'ok'; msg = 'Puedes unirte a la fila cuando quieras.'; }
      else if (opp && opp.join_blocked_reason === 'rules_not_accepted') { pill = 'Falta el reglamento'; kind = 'warn'; msg = 'Acepta el reglamento (arriba) para poder unirte a la fila.'; }
      else if (opp && (opp.join_blocked_reason === 'turn_already_used' || opp.join_blocked_reason === 'matches_exhausted')) { pill = 'Turno usado'; kind = 'done'; msg = JOIN_REASON[opp.join_blocked_reason]; }
      else { pill = 'Inscripción cerrada'; kind = 'none'; msg = JOIN_REASON[opp && opp.join_blocked_reason] || 'La inscripción no está disponible ahora.'; }
      if (!c.onl) { pill = 'Sin conexión'; kind = 'error'; msg = 'Sin conexión. Mostramos el último estado conocido; las acciones se reactivan al volver a conectar.'; }
    }
    if (S.needLogin && c.isLogged && c.hasEvent) showLogin = true;

    box.setAttribute('data-state', state); box.setAttribute('data-kind', kind);
    setText('svv-me-pill', pill); setText('svv-me-msg', msg);

    show($('svv-call'), showCall); show($('svv-lobby'), showLobby);
    show($('svv-btn-login-me'), showLogin); show($('svv-btn-me-retry'), showRetry);

    // oportunidades: consumidas / reservadas / disponibles, sin mezclarlas
    var showOpps = c.ready && !!opp;
    show($('svv-opps'), showOpps); show($('svv-opps-legend'), showOpps);
    if (showOpps) {
      setText('svv-op-consumed', fmtInt(num(opp.consumed) || 0)); setText('svv-op-reserved', fmtInt(num(opp.reserved) || 0));
      setText('svv-op-remaining', fmtInt(num(opp.remaining) || 0)); setText('svv-op-max', fmtInt(num(opp.max) || 0));
    }
    // kills y puntos propios
    var st2 = c.ready && my.stats, showMine = !!st2 && ((num(st2.matches_played) || 0) > 0 || !!cm);
    show($('svv-mine'), showMine);
    if (showMine) {
      setText('svv-mine-kills', fmtInt(num(st2.kills) || 0)); setText('svv-mine-points', fmtInt(num(st2.points) || 0));
      show($('svv-mine-match-box'), !!cm && cm.phase === 'bus_started'); setText('svv-mine-match', fmtInt(cm ? (num(cm.kills) || 0) : 0));
    }

    // salir de la fila (solo antes de comenzar el turno)
    var canLeave = c.ready && !!q && (q.status === 'waiting' || q.status === 'called' || q.status === 'confirmed');
    if (!canLeave) S.leaveArmed = false;
    show($('svv-btn-leave'), canLeave && !S.leaveArmed);
    setBtn('svv-btn-leave', c.busy || !c.onl);
    show($('svv-leave-confirm'), canLeave && S.leaveArmed);
    setBtn('svv-btn-leave-yes', c.busy || !c.onl); setBtn('svv-btn-leave-no', c.busy);

    var f = $('svv-me-feedback');
    if (f) {
      if (c.fq) { f.textContent = c.fq.text; f.setAttribute('data-kind', c.fq.kind); f.hidden = false; }
      else { f.textContent = ''; f.hidden = true; }
    }
  }

  // Parte que cambia cada segundo: cuentas regresivas y estado del botón de confirmar.
  function tickParticipation() {
    var ready = myReady(), my = ready ? S.my : null, q = my && my.queue, cm = my && my.current_match;
    var callOn = false;
    if (ready && q && q.status === 'called' && !q.response_expired) {
      var left = secLeft(num(q.response_seconds_left)), tot = num(my.event.call_response_seconds) || 120;
      if (left != null) {
        callOn = left > 0;
        setText('svv-call-time', mmss(left)); setText('svv-callbar-time', mmss(left));
        var fill = $('svv-call-fill'); if (fill) fill.style.width = Math.max(0, Math.min(100, (left / tot) * 100)).toFixed(1) + '%';
        var urgent = left <= 30; var box = $('svv-call'); if (box) box.setAttribute('data-urgent', urgent ? 'true' : 'false');
        if (left === 0) zeroRefresh('call');
        var can = !!q.can_confirm && left > 0 && !S.busy && online();
        setBtn('svv-btn-confirm', !can); setBtn('svv-btn-confirm2', !can);
        setText('svv-call-note', left > 0 ? 'Confirma antes de que termine el plazo (lo decide Supabase).' : 'Plazo terminado: verificando con Supabase…');
      }
    }
    show($('svv-callbar'), callOn && ready);
    if (!callOn) { setBtn('svv-btn-confirm', true); setBtn('svv-btn-confirm2', true); }

    if (ready && cm && cm.phase === 'lobby' && typeof cm.lobby_seconds_left === 'number') {
      var ll = secLeft(cm.lobby_seconds_left), tl = num(my.event.lobby_entry_seconds) || 180;
      setText('svv-lobby-title', cm.my_status === 'in_lobby' ? 'Ya estás en el lobby' : 'Entra al lobby');
      setText('svv-lobby-time', cm.lobby_expired || ll === 0 ? '0:00' : mmss(ll));
      setText('svv-lobby-text', cm.lobby_expired || ll === 0 ? 'Plazo de ' + tl + ' s terminado. Supabase decide si tu partida continúa.' : 'Tienes ' + tl + ' segundos desde que se abrió el lobby.');
      if (ll === 0 && !cm.lobby_expired) zeroRefresh('lobby');
    }
    // los mensajes de resultado caducan solos
    var before = Object.keys(S.fb).length;
    if (before) { fbGet('rules'); fbGet('queue'); if (Object.keys(S.fb).length !== before) renderParticipationSoft(); }
  }
  var softPending = false;
  function renderParticipationSoft() { if (softPending) return; softPending = true; setTimeout(function () { softPending = false; renderParticipation(); }, 0); }

  // Al llegar a 0 un plazo se pregunta UNA vez a Supabase (por cada lectura recibida); él decide si venció.
  function zeroRefresh(kind) {
    var key = kind + ':' + S.myAt;
    if (S.zeroFired[key]) return;
    S.zeroFired = {}; S.zeroFired[key] = true;
    setTimeout(function () { loadMy(); loadPublic(); }, 600);
  }

  function bindParticipation() {
    function on(id, fn) { var b = $(id); if (b) b.addEventListener('click', fn); }
    on('svv-btn-accept', function () { doDecide('accepted'); });
    on('svv-btn-reject', function () { doDecide('rejected'); });
    on('svv-btn-join', function () { doJoin(); });
    on('svv-btn-shield', function () { onShieldClick(); });
    on('svv-btn-confirm', function () { doConfirm(); });
    on('svv-btn-confirm2', function () { doConfirm(); });
    on('svv-btn-leave', function () { if (S.busy) return; S.leaveArmed = true; renderParticipation(); var y = $('svv-btn-leave-no'); if (y) y.focus(); });
    on('svv-btn-leave-no', function () { S.leaveArmed = false; renderParticipation(); });
    on('svv-btn-leave-yes', function () { doLeave(); });
    on('svv-btn-login-me', function () { openLogin(); });
    on('svv-btn-me-retry', function () { S.myState = S.myState === 'error' ? 'loading' : S.myState; renderParticipation(); loadPublic(true); loadMy(); });
    window.addEventListener('online', function () {
      renderParticipation(); refreshAll();
      if (S.rulesState === 'error' || S.rulesState === 'unavailable') { S.rulesFails = 0; loadRules(true); } // al volver la conexión se recupera el reglamento
    });
    window.addEventListener('offline', function () { renderParticipation(); });
  }

  /* ------------------------------ arranque ------------------------------ */
  function init() {
    // reveal al hacer scroll (sin JS la página se ve completa)
    var secs = document.querySelectorAll('.svv-score, .svv-protocol, .svv-queue, .svv-fighter, .svv-arsenal, .svv-history');
    if ('IntersectionObserver' in window && !reduceMotion) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
      }, { threshold: 0.08 });
      secs.forEach(function (s) { s.classList.add('svv-reveal'); io.observe(s); });
    }

    bindParticipation();
    renderParticipation();
    var login = $('svv-fighter-login');
    if (login) login.addEventListener('click', function () {
      if (window.GeoArmyAccount && window.GeoArmyAccount.openLogin) window.GeoArmyAccount.openLogin();
    });
    var more = $('svv-history-more');
    if (more) more.addEventListener('click', function () { loadHistory(more.getAttribute('data-mode') === 'retry' && S.histShown === 0); });

    var client = getClient();
    if (client && client.auth && client.auth.onAuthStateChange) {
      // Se conserva la autenticación de GeoArmyAccount: solo escuchamos sus eventos.
      client.auth.onAuthStateChange(function (event, session) {
        var id = (session && session.user && session.user.id) || null;
        if (id === S.userId && event !== 'SIGNED_OUT') return; // renovación de token / evento repetido: nada cambió
        // Cierre de sesión u otra cuenta: limpiar YA y descartar lo pendiente de la sesión anterior
        identityChanged(id);
        if (!id) showFighter('locked', 'Inicia sesión con Twitch para ver tus partidas, kills y posición.', true);
        else showFighter('loading', 'Cargando tu ficha…', false);
        if (id) setTimeout(loadMy, 0); // no se llama a Supabase dentro del callback de auth
      });
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { loadPublic(); if (S.eventKey) loadMy(); } });

    tickClock();
    setInterval(function () { tickClock(); tickParticipation(); }, 1000);
    setStatus('loading', STATUS_TEXT.loading);
    loadPublic().then(function () {
      if (S.rulesKey === undefined) loadRules();
      loadHistory(true);
      if (S.myReq === 0) loadMy(); // si loadPublic ya la pidió, no se duplica
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
