/* Mi Geo Army — Celebración visual de cumpleaños (Cumpleaños V1, Fase 2).
 *
 * SOLO PRESENTACIÓN. No acredita nada, no escribe en Supabase, no toca XP, rangos, misiones, tienda ni billeteras.
 * Lee una sola vez por identidad la RPC existente get_my_birthday_status() (solo la fecha de la propia sesión) a través
 * del cliente de js/geoarmy-account.js (window.GeoArmyAccount.client). No usa js/geoarmy-birthday.js (registro): es independiente.
 *
 * Reglas
 *  - "Hoy" se calcula en America/New_York (Intl). Cumpleaños 29-feb: 29 en año bisiesto, 28-feb en no bisiesto (nunca 1-mar, nunca ambos).
 *  - Se evalúa de nuevo cada ≤60 s (y al volver a la pestaña): no se asume que un día dura 24 h (cambios de horario).
 *  - Decoración con elementos PROPIOS (data-gcb / clases gcb-) dentro de #mgtIdentity; no reutiliza los data-mgt-slot ni toca
 *    título, insignia, rango, XP, país ni datos de Twitch. El nombre mostrado se lee de #mgNameText (dato que ya carga el perfil)
 *    y se inserta solo con textContent.
 *  - Confeti automático: una vez por usuario y año de celebración en este navegador (localStorage, solo para recordar la animación;
 *    nunca prueba de elegibilidad). Con prefers-reduced-motion: sin confeti ni animaciones; el icono de la tarta deja de ser botón.
 *  - Si Supabase falla o la respuesta no es válida: sin celebración (nunca con datos inventados). No bloquea la página.
 *  - Cambio de cuenta / cierre de sesión: se limpia la decoración y se evalúa la nueva identidad (contador de generación).
 * Cargar DESPUÉS de js/geoarmy-account.js. Solo hace algo si existe #mgtIdentity (Mi Geo Army).
 */
(function () {
  'use strict';
  if (window.__geoarmyBdayCelLoaded) return;
  window.__geoarmyBdayCelLoaded = true;

  var TZ = 'America/New_York';
  var TIMEOUT_MS = 8000;
  var DUR = 6500;                      // duración del confeti (ms)
  var MAX_PARTS = 34;                  // tope de piezas
  var KEY_PLAYED = 'geoarmy_bday_cel_v1:';    // localStorage: confeti ya reproducido (usuario + año)
  var KEY_CLOSED = 'geoarmy_bday_cel_x_v1:';  // localStorage: mensaje cerrado (usuario + año)
  var RETRY_MS = [30000, 120000, 300000];     // reintentos si la lectura inicial falla

  // ===== Fechas (puras; expuestas para pruebas) =====
  var DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function isMD(m, d) { return isInt(m) && isInt(d) && m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN[m - 1]; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function celebrationMD(m, d, y) { return (m === 2 && d === 29 && !isLeap(y)) ? { m: 2, d: 28 } : { m: m, d: d }; }

  var fmtNY = null;
  function nyParts(ms) {
    try {
      if (!fmtNY) fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
      var o = {}, p = fmtNY.formatToParts(new Date(ms));
      for (var i = 0; i < p.length; i++) o[p[i].type] = p[i].value;
      var r = { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second };
      return (isInt(r.y) && isInt(r.m) && isInt(r.d)) ? r : null;
    } catch (e) { return null; }    // zona no disponible: sin celebración
  }
  function isBirthdayNow(m, d, ms) {
    if (!isMD(m, d)) return false;
    var p = nyParts(ms);
    if (!p) return false;
    var c = celebrationMD(m, d, p.y);
    return p.m === c.m && p.d === c.d;
  }
  // Próxima revisión: nunca más de 60 s (no se asume un día de 24 h); se acerca a la medianoche de Nueva York.
  function msToNextCheck(ms) {
    var p = nyParts(ms);
    if (!p) return 60000;
    var secs = (23 - p.h) * 3600 + (59 - p.mi) * 60 + (60 - p.s);
    return Math.max(1000, Math.min(60000, secs * 1000 + 250));
  }

  var stats = { runs: 0, rafActive: 0, maxParts: 0, rpc: 0, resp: 0, builds: 0, headingWrites: 0, cardCb: 0 };
  window.GeoArmyBirthdayCelebration = { _t: { isLeap: isLeap, celebrationMD: celebrationMD, nyParts: nyParts, isBirthdayNow: isBirthdayNow, msToNextCheck: msToNextCheck, stats: stats } };

  var card = document.getElementById('mgtIdentity');
  var A = window.GeoArmyAccount;
  if (!card || !A || !A.client || !A.client.rpc || !A.client.auth) return;   // otra página o sin cliente: no hace nada
  var sb = A.client;

  // ===== Estado =====
  var uid = null, gen = 0;
  var st = null;               // { month, day } si hay cumpleaños registrado y válido (identidad vigente)
  var loading = false, lastQuery = 0, failures = 0, retryAt = 0;
  var on = false;              // celebración activa
  var tickTimer = 0, raf = 0, runStart = 0, parts = [];
  var visible = false;         // la tarjeta está a la vista (pestaña Resumen abierta)
  var year = 0;                // año NY de la celebración activa (claves de almacenamiento)
  var mem = {};
  var mqReduce = null, reduce = false;
  var ioObs = null, nameObs = null, cardObs = null, noticeObs = null;
  var sessionSeen = false, reqTimer = 0;

  // ===== Utilidades =====
  function storeGet(key) { try { var v = window.localStorage.getItem(key); if (v !== null) return v; } catch (e) {} return mem[key] || null; }
  function storeSet(key, val) { mem[key] = val; try { window.localStorage.setItem(key, val); } catch (e) {} }
  function $(sel, root) { return (root || card).querySelector(sel); }
  function dec(name) { return $('[data-gcb="' + name + '"]'); }
  function el(tag, cls, name) { var e = document.createElement(tag); if (cls) e.className = cls; if (name) e.setAttribute('data-gcb', name); return e; }
  function svg(html) { var s = document.createElement('span'); s.innerHTML = html; return s.firstChild; }   // solo constantes de este archivo

  var SVG_CAKE = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 27h20V17a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v10Z" fill="#2a1244" stroke="#ffd27a" stroke-width="1.6"/><path d="M6 21c2.5 2 4.5 2 6.7 0s4.3-2 6.6 0 4.5 2 6.7 0" stroke="#ffd27a" stroke-width="1.6"/><path d="M16 14v-4" stroke="#ffd27a" stroke-width="1.6" stroke-linecap="round"/><path d="M16 9.4c-1.4-1.2-1.6-2.6 0-4.4 1.6 1.8 1.4 3.2 0 4.4Z" fill="#ffd27a"/></svg>';
  var SVG_CAKE_MINI = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 27h20V17a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v10Z" stroke="#ffd27a" stroke-width="2.4"/><path d="M16 14v-4" stroke="#ffd27a" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var SVG_HAT = '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="gcbHatG" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#6b2fd1"/><stop offset="1" stop-color="#9147ff"/></linearGradient></defs><path d="M24 6 38 40H10L24 6Z" fill="url(#gcbHatG)" stroke="#ffd27a" stroke-width="2" stroke-linejoin="round"/><path d="M16 30c5 3 11 3 16 0M19.5 20c3 2 6 2 9 0" stroke="#ffd27a" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="24" cy="6" r="3.4" fill="#ffd27a"/></svg>';

  function played() { return storeGet(KEY_PLAYED + uid + ':' + year) === '1'; }
  function markPlayed() { storeSet(KEY_PLAYED + uid + ':' + year, '1'); }
  function closed() { return storeGet(KEY_CLOSED + uid + ':' + year) === '1'; }
  function markClosed() { storeSet(KEY_CLOSED + uid + ':' + year, '1'); }

  // Nombre que ya muestra el perfil (dato de Twitch ya cargado). Placeholder "—" o vacío = sin nombre.
  function shownName() {
    var n = document.getElementById('mgNameText');
    var t = n ? String(n.textContent || '').trim() : '';
    return (t && t !== '—') ? t.slice(0, 60) : '';
  }
  function updateHeading() {
    var h = dec('banner') && $('.gcb-h', dec('banner'));
    if (!h) return;
    var n = shownName();
    var txt = n ? '¡Feliz cumpleaños, ' + n + '!' : '¡Feliz cumpleaños!';
    if (h.textContent === txt) return;               // solo se escribe si el texto realmente cambió (evita mutaciones en cadena)
    h.textContent = txt; stats.headingWrites++;
  }
  // ¿falta algún elemento de la decoración? (comprobación sin escribir en el DOM)
  function decorMissing() {
    if (!card.classList.contains('mgt-id--bday')) return true;
    if (!dec('canvas')) return true;
    if (!dec('banner') && !closed()) return true;
    if (document.getElementById('mgName') && !dec('flourish')) return true;
    if ($('.mgt-id-meta') && !dec('chip')) return true;
    var av = $('.mgt-id-avatar');
    if (av && (!dec('hat') || av.querySelectorAll('.gcb-spark').length < 3)) return true;
    return false;
  }

  // ===== Decoración (idempotente: solo crea lo que falta) =====
  function ensureDecor() {
    var built = false;
    if (!card.classList.contains('mgt-id--bday')) card.classList.add('mgt-id--bday');

    if (!dec('banner') && !closed()) {
      var b = el('div', 'gcb-banner', 'banner');
      b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Felicitación de cumpleaños');
      var ic = el('button', 'gcb-ic gcb-replay'); ic.type = 'button'; ic.appendChild(svg(SVG_CAKE));
      var tx = el('div', 'gcb-tx'), h = el('strong', 'gcb-h'), s = el('span', 'gcb-s');
      s.textContent = 'Hoy el cuartel celebra contigo. Gracias por ser parte de Geo Army.';
      tx.appendChild(h); tx.appendChild(s);
      var x = el('button', 'gcb-x'); x.type = 'button'; x.setAttribute('aria-label', 'Ocultar el mensaje de hoy'); x.textContent = '×';
      x.addEventListener('click', function () { markClosed(); var bn = dec('banner'); if (bn && bn.parentNode) bn.parentNode.removeChild(bn); });
      ic.addEventListener('click', function () { if (!reduce) runConfetti(); });
      b.appendChild(ic); b.appendChild(tx); b.appendChild(x);
      var top = $('.mgt-id-top');
      if (top && top.parentNode === card) card.insertBefore(b, top); else card.insertBefore(b, card.firstChild);
      built = true;
    }
    var nameBox = document.getElementById('mgName');
    if (nameBox && !dec('flourish')) {
      var f = el('div', 'gcb-flourish', 'flourish'); f.setAttribute('aria-hidden', 'true');
      f.appendChild(el('i')); var st1 = el('b'); st1.textContent = '✦'; f.appendChild(st1); f.appendChild(el('i'));
      nameBox.parentNode.insertBefore(f, nameBox.nextSibling);
      built = true;
    }
    var meta = $('.mgt-id-meta');
    if (meta && meta.parentNode && !dec('chip')) {
      var row = el('div', 'gcb-chiprow', 'chip'), chip = el('span', 'gcb-chip');
      chip.appendChild(svg(SVG_CAKE_MINI)); chip.appendChild(document.createTextNode('Cumpleaños hoy'));
      row.appendChild(chip);
      meta.parentNode.insertBefore(row, meta);
      built = true;
    }
    var av = $('.mgt-id-avatar');
    if (av && !dec('hat')) {
      var hat = svg(SVG_HAT); hat.setAttribute('class', 'gcb-hat'); hat.setAttribute('data-gcb', 'hat'); av.appendChild(hat);
      built = true;
    }
    if (av) {
      ['s1', 's2', 's3'].forEach(function (c) {          // cada destello se repone por separado (nunca se duplican)
        if ($('.gcb-spark.' + c, av)) return;
        var sp = el('span', 'gcb-spark ' + c, 'spark'); sp.setAttribute('aria-hidden', 'true'); sp.textContent = '✦'; av.appendChild(sp); built = true;
      });
    }
    if (!dec('canvas')) { var cv = el('canvas', 'gcb-canvas', 'canvas'); cv.setAttribute('aria-hidden', 'true'); card.appendChild(cv); built = true; }
    if (built) stats.builds++;
    updateHeading();
    applyMotion();
  }

  function removeDecor() {
    stopConfetti();
    var nodes = card.querySelectorAll('[data-gcb]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    card.classList.remove('mgt-id--bday', 'gcb-anim');
  }

  // Movimiento reducido: sin animaciones, sin confeti, y el icono de la tarta deja de ser un botón.
  function applyMotion() {
    card.classList.toggle('gcb-anim', !reduce);
    var ic = dec('banner') && $('.gcb-ic', dec('banner'));
    if (ic) {
      if (reduce) { ic.disabled = true; ic.tabIndex = -1; ic.setAttribute('aria-hidden', 'true'); ic.removeAttribute('aria-label'); ic.removeAttribute('title'); }
      else { ic.disabled = false; ic.removeAttribute('tabindex'); ic.removeAttribute('aria-hidden'); ic.setAttribute('aria-label', 'Repetir el confeti'); ic.title = 'Repetir el confeti'; }
    }
    if (reduce) stopConfetti();
  }

  // ===== Confeti (canvas dentro de la tarjeta; ≤34 piezas; ~6,5 s; sin librerías) =====
  var COLORS = ['#ffd27a', '#e8a93d', '#fff3d0', '#9147ff', '#b78bff'];
  function stopConfetti() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; stats.rafActive = 0; }
    parts = [];
    var cv = dec('canvas');
    if (cv) { var c = cv.getContext && cv.getContext('2d'); if (c) c.clearRect(0, 0, cv.width, cv.height); }
  }
  function sizeCanvas(cv) {
    var r = card.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
    return { r: r, c: c };
  }
  function runConfetti() {
    var cv = dec('canvas');
    if (!on || reduce || !cv || !cv.getContext || document.hidden) return;
    stopConfetti();
    var s = sizeCanvas(cv), n = Math.round(Math.min(MAX_PARTS, Math.max(18, s.r.width / 16)));
    for (var i = 0; i < n; i++) parts.push({ x: Math.random() * s.r.width, y: -10 - Math.random() * s.r.height * 0.6, w: 4 + Math.random() * 5, h: 7 + Math.random() * 6,
      vy: 26 + Math.random() * 34, sw: 12 + Math.random() * 22, ph: Math.random() * 6.28, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 3, c: COLORS[i % COLORS.length], round: i % 4 === 0 });
    stats.runs++; stats.maxParts = Math.max(stats.maxParts, n);
    runStart = performance.now(); stats.rafActive = 1; raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    var cv = dec('canvas');
    if (!cv || !on || reduce || document.hidden) { raf = 0; stats.rafActive = 0; if (cv) { var c0 = cv.getContext('2d'); c0.clearRect(0, 0, cv.width, cv.height); } return; }
    var e = now - runStart, s = sizeCanvas(cv), ctx = s.c;
    ctx.clearRect(0, 0, s.r.width, s.r.height);
    if (e > DUR) { raf = 0; stats.rafActive = 0; parts = []; return; }
    var fade = e > DUR - 1500 ? (DUR - e) / 1500 : 1, dt = e / 1000;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], y = p.y + p.vy * dt, x = p.x + Math.sin(dt * 1.6 + p.ph) * p.sw;
      ctx.save(); ctx.globalAlpha = 0.9 * fade; ctx.fillStyle = p.c; ctx.translate(x, y); ctx.rotate(p.rot + p.vr * dt);
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    raf = requestAnimationFrame(tick);
  }
  // Automático: una vez por usuario y año, solo si la tarjeta está a la vista y hay movimiento permitido.
  function maybeAuto() {
    if (!on || reduce || !visible || document.hidden || !uid || played()) return;
    markPlayed();
    runConfetti();
  }

  // ===== Evaluación =====
  function activate() {
    var p = nyParts(Date.now());
    if (!p) { deactivate(); return; }
    if (!on || year !== p.y) { year = p.y; }
    on = true;
    ensureDecor();
    watchCard(true);
    maybeAuto();
  }
  function deactivate() {
    on = false;
    watchCard(false);
    removeDecor();
  }
  function evaluate() {
    clearTimeout(tickTimer); tickTimer = 0;
    if (!uid) { if (on) deactivate(); return; }
    if (st && isBirthdayNow(st.month, st.day, Date.now())) activate();
    else if (on) deactivate();
    // reintento escalonado si la lectura inicial falló
    if (!st && failures > 0 && failures <= RETRY_MS.length && !loading && Date.now() >= retryAt) loadStatus(uid, gen);
    tickTimer = setTimeout(evaluate, msToNextCheck(Date.now()));
  }

  // ===== Lectura de la fecha (RPC existente, solo lectura) =====
  function callRpc() {
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; resolve({ err: { message: 'timeout' } }); } }, TIMEOUT_MS);
      function fin(r) { if (done) return; done = true; clearTimeout(t); resolve(r); }
      try {
        Promise.resolve(sb.rpc('get_my_birthday_status')).then(function (r) { fin(r && r.error ? { err: r.error } : { data: r ? r.data : null }); },
          function (e) { fin({ err: e || { message: 'error' } }); });
      } catch (e) { fin({ err: e }); }
    });
  }
  function loadStatus(id, g) {
    loading = true; lastQuery = Date.now(); stats.rpc++;
    callRpc().then(function (r) {
      stats.resp++;
      if (g !== gen || id !== uid) return;            // respuesta de otra identidad: se descarta
      loading = false;
      var d = r.data;
      if (!r.err && d && typeof d === 'object' && d.registered === true && isMD(d.month, d.day)) { st = { month: d.month, day: d.day }; failures = 0; }
      else if (!r.err && d && typeof d === 'object' && d.registered === false) { st = null; failures = 0; }   // sin cumpleaños: sin celebración
      else { st = null; failures++; retryAt = Date.now() + (RETRY_MS[failures - 1] || 3600000); }              // error o respuesta inválida: sin celebración
      evaluate();
    });
  }

  function onSession(session) {
    var id = session && session.user ? session.user.id : null;
    if (id === uid) return;                          // refresco de token o evento duplicado
    if (on) deactivate();
    clearTimeout(tickTimer); tickTimer = 0; clearTimeout(reqTimer); reqTimer = 0;
    uid = id; gen++; st = null; loading = false; failures = 0; retryAt = 0;
    if (!id) return;
    loadStatus(id, gen);
  }

  // ===== Observadores ligeros =====
  function watchCard(enable) {
    if (!window.MutationObserver) return;
    if (!enable) { if (cardObs) { cardObs.disconnect(); cardObs = null; } return; }
    if (cardObs) return;
    var pend = false;
    cardObs = new MutationObserver(function () {   // si algo vuelve a pintar la tarjeta y se pierde un elemento, se repone (sin duplicar)
      stats.cardCb++;
      if (pend || !on || !decorMissing()) return;    // las mutaciones propias (mensaje, nombre, creación) no disparan nada más
      pend = true;
      requestAnimationFrame(function () { pend = false; if (on && decorMissing()) ensureDecor(); });
    });
    cardObs.observe(card, { childList: true, subtree: true });
  }

  function init() {
    mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reduce = !!(mqReduce && mqReduce.matches);
    if (mqReduce) {
      var onMq = function () { reduce = mqReduce.matches; if (on) { applyMotion(); if (!reduce) maybeAuto(); } };
      if (mqReduce.addEventListener) mqReduce.addEventListener('change', onMq); else if (mqReduce.addListener) mqReduce.addListener(onMq);
    }
    if (window.IntersectionObserver) {
      ioObs = new IntersectionObserver(function (es) { visible = es.some(function (e) { return e.isIntersecting; }); if (visible) maybeAuto(); });
      ioObs.observe(card);
    } else { visible = true; }
    var nm = document.getElementById('mgNameText');
    if (nm && window.MutationObserver) { nameObs = new MutationObserver(function () { if (on) updateHeading(); }); nameObs.observe(nm, { childList: true, characterData: true, subtree: true }); }
    // Si la persona registra su cumpleaños ahora (aviso de registro se oculta), se vuelve a leer UNA vez.
    var notice = document.getElementById('gaBdayNotice');
    if (notice && window.MutationObserver) {
      noticeObs = new MutationObserver(function () {
        if (!notice.hidden || !uid || st) return;
        clearTimeout(reqTimer);                          // como máximo una lectura cada 3 s (se aplaza, no se pierde)
        reqTimer = setTimeout(function () { if (uid && !st && !loading) loadStatus(uid, gen); }, Math.max(300, 3000 - (Date.now() - lastQuery)));
      });
      noticeObs.observe(notice, { attributes: true, attributeFilter: ['hidden'] });
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { evaluate(); if (on) maybeAuto(); } });
    window.addEventListener('pageshow', function () { evaluate(); });
    window.addEventListener('focus', function () { evaluate(); });
    // Nunca se llama a supabase DENTRO del callback de auth (riesgo de bloqueo): se difiere.
    sb.auth.onAuthStateChange(function (event, session) { sessionSeen = true; setTimeout(function () { onSession(session); }, 0); });
    Promise.resolve(sb.auth.getSession()).then(function (r) { if (!sessionSeen) onSession(r && r.data ? r.data.session : null); }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
