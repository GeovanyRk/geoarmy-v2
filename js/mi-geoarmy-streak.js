/* Mi Geo Army — Racha Diaria (Fase 2)
 *
 * Solo lectura/registro por RPC ya existentes:
 *   get_my_streak()      -> estado (today, claimed_today, current_streak, best_streak, last_checkin_date,
 *                           total_checkins, week_start, week_claimed[], next_milestone, achievements[])
 *   claim_daily_streak() -> { status: claimed | already_claimed, checkin_date, current_streak, best_streak,
 *                           new_milestones[], reason?, last_checkin_date? }
 *
 * Reglas de este módulo:
 *  - La fecha de registro la decide SIEMPRE el servidor (America/New_York). Aquí no se usa Date.now()/new Date()
 *    para decidir nada: las fechas se tratan como texto AAAA-MM-DD y la aritmética de calendario es pura.
 *  - claim_daily_streak() solo se llama por clic explícito. Nunca automático, nunca al cargar.
 *  - Nada se incrementa de forma optimista: tras registrar se vuelve a leer get_my_streak() y eso es lo que se pinta.
 *  - Aislamiento por identidad: cada operación asíncrona captura una "epoch" y un número de lectura; si cambió la
 *    cuenta / se cerró sesión / llegó una lectura más nueva, su resultado se descarta sin tocar la pantalla.
 *  - No usa MutationObserver ni polling. No depende de js/mi-geoarmy-tabs.js más allá del DOM de la pestaña.
 */
(function () {
  'use strict';

  var doc = document;
  var MILESTONES = [3, 7, 14, 30, 60, 100, 365];
  var BADGE_DIR = 'assets/racha-insignia/';
  function onBadgeImgError(e) { var li = e.target.closest('.mgs-badge'); if (li) li.classList.add('is-noimg'); }
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var STALE_MS = 30000; // una pestaña ya leída se vuelve a leer al reabrirla si pasaron más de 30 s

  var root = doc.getElementById('mgStreak');
  var panel = doc.getElementById('mgtPanel-racha');
  if (!root || !panel) return;

  function $(id) { return doc.getElementById(id); }
  var el = {
    live: $('mgsLive'), status: $('mgsStatus'), num: $('mgsNum'), numLabel: $('mgsNumLabel'), medal: $('mgsMedal'),
    headline: $('mgsHeadline'), sub: $('mgsSub'), claim: $('mgsClaim'), claimLabel: $('mgsClaimLabel'), note: $('mgsNote'),
    best: $('mgsBest'), total: $('mgsTotal'), last: $('mgsLast'),
    nextTitle: $('mgsNextTitle'), nextText: $('mgsNextText'), nextBar: $('mgsNextBar'), nextFill: $('mgsNextFill'),
    week: $('mgsWeek'), badges: $('mgsBadges'),
    err: $('mgsError'), errText: $('mgsErrorText'), retry: $('mgsRetry'), signedout: $('mgsSignedOut')
  };
  for (var k in el) if (!el[k]) return; // marcado incompleto: no activar nada

  // ---------- Estado ----------
  // Cada lectura y cada registro es una OPERACIÓN con dueño: un objeto {epoch, seq, uid}. "Leyendo" y "registrando"
  // no son banderas sueltas: son readOp / claimOp, la operación vigente (o null). Solo la operación vigente puede
  // liberar su propio bloqueo o tocar la pantalla; una operación vieja (otra cuenta, otra lectura) ya no es la
  // vigente y sus callbacks salen sin modificar nada.
  var epoch = 0;        // sube con cada cierre de sesión / cambio de cuenta
  var readSeq = 0;      // secuencia de lecturas
  var claimSeq = 0;     // secuencia de registros
  var readOp = null;    // lectura vigente
  var claimOp = null;   // registro vigente
  var currentUid = null;
  var data = null;      // última lectura válida de la cuenta vigente
  var loadedAt = 0;     // marca de tiempo (solo para antigüedad de la lectura, nunca para fechas de racha)
  function isReading() { return readOp !== null; }
  function isClaiming() { return claimOp !== null; }
  var unknownAfterClaim = false; // se intentó registrar y aún no hay lectura confirmada: no se ofrece registrar de nuevo

  function sb() { return window.GeoArmyAccount && window.GeoArmyAccount.client; }

  // ---------- Fechas: texto AAAA-MM-DD estricto, aritmética de calendario pura ----------
  function parseYmd(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return null;
    var t = new Date(Date.UTC(y, mo - 1, d));
    // ida y vuelta: rechaza fechas imposibles (30 de febrero, 31 de abril…)
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d, dow: t.getUTCDay() };
  }
  function addDays(s, n) {
    var p = parseYmd(s);
    if (!p) return null;
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + t.getUTCDate()).slice(-2);
  }
  function fmtDate(s) {
    var p = parseYmd(s);
    if (!p) return '—';
    return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }
  // Contadores: enteros no negativos (nada de decimales, NaN, Infinity, cadenas ni negativos).
  function isCount(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0; }
  function isDays(v) { return isCount(v) && v > 0; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------- Validación del contrato (nada se inventa: si algo no cuadra, toda la respuesta se rechaza) ----------
  function validState(d) {
    var i, a, p;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (!parseYmd(d.today) || typeof d.claimed_today !== 'boolean') return false;
    if (!isCount(d.current_streak) || !isCount(d.best_streak) || !isCount(d.total_checkins)) return false;
    p = parseYmd(d.week_start);
    if (!p || p.dow !== 1) return false;                       // la semana debe empezar en lunes
    if (!Array.isArray(d.week_claimed) || !Array.isArray(d.achievements)) return false;
    for (i = 0; i < d.week_claimed.length; i++) if (!parseYmd(d.week_claimed[i])) return false;
    if (d.next_milestone !== null && !isDays(d.next_milestone)) return false;
    if (d.last_checkin_date !== null && d.last_checkin_date !== undefined && !parseYmd(d.last_checkin_date)) return false;
    for (i = 0; i < d.achievements.length; i++) {
      a = d.achievements[i];
      if (!a || typeof a !== 'object' || Array.isArray(a) || !isDays(a.days)) return false;
      if (a.unlocked_on !== null && a.unlocked_on !== undefined && !parseYmd(a.unlocked_on)) return false;
    }
    return true;
  }

  // ---------- Pintado (solo textContent / atributos: nunca innerHTML con datos) ----------
  function setState(name) { root.setAttribute('data-state', name); }
  function say(msg) { el.live.textContent = ''; el.live.textContent = msg; }

  function buildStatic() {
    var i, n, li, img;
    el.week.textContent = '';
    for (i = 0; i < 7; i++) {
      li = doc.createElement('li');
      li.className = 'mgs-day';
      li.innerHTML = '<span class="mgs-day-name"></span><span class="mgs-day-dot" aria-hidden="true"></span><span class="mgs-day-num"></span><span class="mgs-sr"></span>';
      el.week.appendChild(li);
    }
    el.badges.textContent = '';
    for (i = 0; i < MILESTONES.length; i++) {
      n = MILESTONES[i];
      li = doc.createElement('li');
      li.className = 'mgs-badge';
      li.setAttribute('data-days', String(n));
      // Imagen real de la insignia (assets/racha-insignia/N-dias.webp, cuadrada y con transparencia). Si no carga,
      // queda visible la medalla de texto de respaldo; el estado (bloqueada/desbloqueada) siempre sale de achievements.
      li.innerHTML = '<span class="mgs-badge-art">' +
        '<img class="mgs-badge-img" width="512" height="512" decoding="async" loading="lazy" alt="">' +
        '<svg class="mgs-badge-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Zm3 4a1.5 1.5 0 0 0-.75 2.8V18h1.5v-1.2A1.5 1.5 0 0 0 12 14Z"/></svg>' +
        '<span class="mgs-badge-fb" aria-hidden="true"><b></b><i>días</i></span>' +
        '</span><span class="mgs-badge-state"></span>';
      li.querySelector('.mgs-badge-fb b').textContent = String(n);
      img = li.querySelector('.mgs-badge-img');
      img.alt = 'Insignia de ' + n + ' días';
      img.addEventListener('error', onBadgeImgError);
      img.src = BADGE_DIR + n + '-dias.webp';
      el.badges.appendChild(li);
    }
  }

  function clearView() {
    data = null; loadedAt = 0; unknownAfterClaim = false;
    el.num.textContent = '—';
    el.numLabel.textContent = 'Racha actual';
    el.headline.textContent = '';
    el.sub.textContent = '';
    el.best.textContent = '—'; el.total.textContent = '—'; el.last.textContent = '—';
    el.nextTitle.textContent = 'Próximo hito'; el.nextText.textContent = '—';
    el.nextFill.style.width = '0%'; el.nextBar.setAttribute('aria-valuenow', '0');
    el.medal.style.setProperty('--p', '0');
    el.claim.hidden = true; el.note.textContent = ''; el.note.hidden = true;
    var days = el.week.children, i;
    for (i = 0; i < days.length; i++) {
      days[i].className = 'mgs-day';
      days[i].querySelector('.mgs-day-name').textContent = DAYS[i];
      days[i].querySelector('.mgs-day-num').textContent = '';
      days[i].querySelector('.mgs-sr').textContent = '';
    }
    var bs = el.badges.children;
    for (i = 0; i < bs.length; i++) {
      bs[i].classList.remove('is-unlocked', 'is-locked');
      bs[i].querySelector('.mgs-badge-state').textContent = '';
    }
    root.setAttribute('data-day', 'none');
    el.err.hidden = true;
  }

  function render(d) {
    var today = d.today;
    var yesterday = addDays(today, -1);
    var last = d.last_checkin_date || null;
    var hasHistory = d.total_checkins > 0 || !!last;
    // Interrumpida: no registró hoy y su último registro es anterior a ayer (fechas del servidor), o el servidor ya devuelve 0 con historial.
    var broken = !d.claimed_today && hasHistory && ((last && yesterday && last < yesterday) || d.current_streak === 0);
    var shown = broken ? 0 : d.current_streak;

    var day = d.claimed_today ? 'claimed' : (broken ? 'broken' : (hasHistory ? 'available' : 'new'));
    root.setAttribute('data-day', day);
    setState('ready');
    el.err.hidden = true;

    el.num.textContent = String(shown);
    el.numLabel.textContent = shown === 1 ? 'día de racha' : 'días de racha';
    el.status.textContent = { claimed: 'Registrada hoy', broken: 'Racha interrumpida', available: 'Disponible hoy', 'new': 'Empieza hoy' }[day];

    var headline, sub;
    if (day === 'claimed') { headline = 'Asistencia de hoy registrada'; sub = 'Vuelve mañana para mantener tu racha.'; }
    else if (day === 'broken') { headline = 'Tu racha se interrumpió'; sub = 'Registra tu asistencia hoy para empezar una nueva. Tu mejor racha se conserva.'; }
    else if (day === 'available') { headline = 'Hoy aún no has registrado'; sub = 'Registra tu asistencia para sumar un día a tu racha.'; }
    else { headline = 'Empieza tu racha'; sub = 'Registra tu primera asistencia de Racha Diaria.'; }
    el.headline.textContent = headline;
    el.sub.textContent = sub;

    syncClaimButton();

    el.best.textContent = plural(d.best_streak, 'día', 'días');
    el.total.textContent = String(d.total_checkins);
    el.last.textContent = last ? fmtDate(last) : 'Sin registros';

    // Próximo hito
    var nm = d.next_milestone;
    var pct;
    if (nm === null) {
      el.nextTitle.textContent = 'Hitos completados';
      el.nextText.textContent = 'No hay más hitos por delante.';
      pct = 100;
    } else {
      var left = Math.max(0, nm - shown);
      el.nextTitle.textContent = 'Próximo hito: ' + plural(nm, 'día', 'días');
      el.nextText.textContent = left === 0 ? 'Hito al alcance.' : (left === 1 ? 'Falta 1 día.' : 'Faltan ' + left + ' días.');
      pct = nm > 0 ? Math.max(0, Math.min(100, Math.round(shown / nm * 100))) : 0;
    }
    el.nextFill.style.width = pct + '%';
    el.nextBar.setAttribute('aria-valuenow', String(pct));
    el.medal.style.setProperty('--p', String(pct));

    // Semana lunes–domingo a partir de week_start (del servidor)
    var claimedSet = {}, i, j;
    for (i = 0; i < d.week_claimed.length; i++) claimedSet[d.week_claimed[i]] = true;
    var cells = el.week.children;
    for (i = 0; i < 7; i++) {
      var ds = addDays(d.week_start, i);
      var p = parseYmd(ds);
      var cls = 'mgs-day';
      var state;
      if (claimedSet[ds]) { cls += ' is-done'; state = 'registrado'; }
      else if (ds === today) { cls += ' is-pending'; state = 'pendiente'; }
      else if (ds < today) { cls += ' is-missed'; state = 'sin registro'; }
      else { cls += ' is-future'; state = 'por venir'; }
      if (ds === today) cls += ' is-today';
      cells[i].className = cls;
      cells[i].querySelector('.mgs-day-name').textContent = DAYS[i];
      cells[i].querySelector('.mgs-day-num').textContent = p ? String(p.d) : '';
      cells[i].querySelector('.mgs-sr').textContent = ' ' + (p ? p.d + ' de ' + MONTHS[p.m - 1] : '') + ': ' + state + (ds === today ? ' (hoy)' : '');
    }

    // Insignias: desbloqueadas únicamente las que aparecen en achievements
    var unlocked = {};
    for (i = 0; i < d.achievements.length; i++) {
      var a = d.achievements[i];
      unlocked[a.days] = a.unlocked_on || true;
    }
    var bs = el.badges.children;
    for (j = 0; j < bs.length; j++) {
      var days = MILESTONES[j];
      var u = unlocked[days];
      var stEl = bs[j].querySelector('.mgs-badge-state');
      if (u) {
        bs[j].classList.remove('is-locked'); bs[j].classList.add('is-unlocked');
        stEl.textContent = typeof u === 'string' ? 'Desde ' + fmtDate(u) : 'Desbloqueada';
      } else {
        bs[j].classList.remove('is-unlocked'); bs[j].classList.add('is-locked');
        stEl.textContent = 'Bloqueada';
      }
    }
  }

  // Único lugar que decide visibilidad/bloqueo del botón. El botón existe solo si el servidor dice que hoy no se
  // ha registrado, la lectura es confiable y la vista está lista; está bloqueado mientras haya un registro o una
  // lectura vigentes (de la cuenta actual).
  function syncClaimButton() {
    var busy = isClaiming();
    el.claim.hidden = !data || data.claimed_today || unknownAfterClaim || root.getAttribute('data-state') !== 'ready';
    el.claim.disabled = busy || isReading();
    el.claimLabel.textContent = busy ? 'Registrando…' : 'Registrar asistencia';
    el.claim.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function showError(msg) {
    setState('error');
    el.errText.textContent = msg;
    el.err.hidden = false;
    el.claim.hidden = true; // con el estado desconocido no se ofrece registrar
  }

  function showNote(msg) { el.note.textContent = msg; el.note.hidden = !msg; }

  // ---------- Identidad ----------
  function identityChanged() {
    epoch += 1; readSeq += 1; claimSeq += 1;
    readOp = null; claimOp = null;      // las operaciones de la cuenta anterior dejan de ser vigentes
    root.setAttribute('aria-busy', 'false');
    clearView();
  }

  function signedOut() {
    if (currentUid !== null || data) identityChanged();
    currentUid = null;
    setState('signedout');
    el.signedout.hidden = false;
  }

  // ---------- Lectura ----------
  // Devuelve una promesa que se resuelve con: 'ok' | 'error' | 'signedout' | 'stale'.
  // Solo la lectura vigente (readOp) pinta, libera readOp y cambia aria-busy.
  function load() {
    var client = sb();
    if (!client) return Promise.resolve('stale');
    var op = { epoch: epoch, seq: ++readSeq };
    readOp = op;
    el.signedout.hidden = true;
    if (!data) { setState('loading'); el.err.hidden = true; }
    root.setAttribute('aria-busy', 'true');
    syncClaimButton();

    function mine() { return readOp === op && op.epoch === epoch; }
    function done() { readOp = null; root.setAttribute('aria-busy', 'false'); } // solo se llama si mine()

    function fail() {
      if (!mine()) return 'stale';
      done();
      showError('No pudimos cargar tu racha. Revisa tu conexión e inténtalo de nuevo.');
      return 'error';
    }

    return client.auth.getSession().then(function (res) {
      if (!mine()) return 'stale';
      var session = res && res.data && res.data.session;
      if (!session || !session.user) { done(); signedOut(); return 'signedout'; }
      var uid = session.user.id;
      if (currentUid !== null && currentUid !== uid) {
        // cambió la cuenta sin que llegara el evento: se limpia antes de pintar nada y esta lectura pasa a la cuenta nueva
        identityChanged();
        op = { epoch: epoch, seq: ++readSeq };
        readOp = op;
        root.setAttribute('aria-busy', 'true');
        setState('loading');
      }
      currentUid = uid;
      return client.rpc('get_my_streak').then(function (r) {
        if (!mine() || currentUid !== uid) return 'stale';
        if (r && r.error) return fail();
        var d = r && r.data;
        if (!validState(d)) {
          done();
          showError('Recibimos una respuesta inesperada de la racha. Inténtalo de nuevo.');
          return 'error';
        }
        done();
        data = d; loadedAt = Date.now(); unknownAfterClaim = false;
        render(d);
        // Aviso para el chip 🔥 N del header: solo tras una lectura vigente y válida, con el uid de esta lectura.
        try { doc.dispatchEvent(new CustomEvent('geoarmy:streak-updated', { detail: { uid: uid, current_streak: d.current_streak } })); } catch (e) {}
        return 'ok';
      }, fail);
    }, fail);
  }

  // ---------- Registro (solo por clic) ----------
  // El registro vigente (claimOp) es el único que puede liberar el bloqueo, cambiar el botón, escribir la nota
  // o mover el foco. Cualquier callback de un registro que ya no es el vigente (otra cuenta, otro registro)
  // termina sin tocar claimOp, readOp, el botón ni la pantalla.
  function onClaim() {
    if (isClaiming() || isReading() || el.claim.hidden || !data || data.claimed_today || unknownAfterClaim) return;
    var client = sb();
    if (!client || !currentUid) return;
    var op = { epoch: epoch, seq: ++claimSeq, uid: currentUid };
    claimOp = op;
    var hadFocus = doc.activeElement === el.claim;
    var settled = false;
    function mine() { return claimOp === op && op.epoch === epoch && currentUid === op.uid; }

    showNote('');
    syncClaimButton();

    // Cierra el registro: relee el estado definitivo y solo entonces libera el bloqueo (si sigue siendo el vigente).
    function settle(msg, announce) {
      if (settled || !mine()) return;
      settled = true;
      // Desde que se envió el registro el estado local es incierto: no se ofrece registrar de nuevo
      // hasta que una lectura posterior lo confirme.
      unknownAfterClaim = true;
      load().then(function (status) {
        if (!mine()) return;               // operación vieja: no libera ni pinta nada
        claimOp = null;                    // libera el bloqueo de ESTE registro
        syncClaimButton();
        if (status === 'ok') {
          if (announce) say(announce);
          if (msg) showNote(msg);
          if (hadFocus) { try { el.status.focus(); } catch (e) {} }
        }
      }, function () {
        if (!mine()) return;
        claimOp = null;
        syncClaimButton();
      });
    }
    function fallback(msg) { settle(msg, ''); }

    function onResponse(r) {
      if (!mine()) return;                 // respuesta atrasada de otra operación/cuenta: se ignora por completo
      if (r && r.error) { fallback('No pudimos confirmar el registro. Mostramos el estado actual de tu racha.'); return; }
      var c = r && r.data;
      var ok = c && typeof c === 'object' && !Array.isArray(c);
      if (ok && c.reason === 'older_than_last_checkin') {
        fallback('El servidor indicó que hoy no se puede registrar como nuevo día. Mostramos tu estado actual.');
        return;
      }
      if (ok && c.status === 'claimed') {
        var ms = Array.isArray(c.new_milestones) ? c.new_milestones.filter(isDays) : [];
        var msg = '¡Asistencia registrada!';
        if (ms.length) msg += ' Nuevo hito: ' + ms.map(function (n) { return plural(n, 'día', 'días'); }).join(', ') + '.';
        settle(msg, msg);
        return;
      }
      if (ok && c.status === 'already_claimed') {
        var im = 'Ya habías registrado tu asistencia de hoy.';
        settle(im, im);
        return;
      }
      fallback('Respuesta inesperada al registrar. Mostramos el estado actual de tu racha.');
    }
    function onFailure() {
      if (!mine()) return;
      fallback('No pudimos confirmar el registro. Mostramos el estado actual de tu racha.');
    }

    client.auth.getSession().then(function (res) {
      if (!mine()) return;
      var session = res && res.data && res.data.session;
      if (!session || !session.user || session.user.id !== op.uid) {
        // la sesión ya no es la que se ve en pantalla: no se registra nada
        claimOp = null; syncClaimButton();
        load();
        return;
      }
      unknownAfterClaim = true;            // a partir de aquí el servidor puede haber registrado
      var p;
      try { p = client.rpc('claim_daily_streak'); } catch (e) { onFailure(); return; }
      return p.then(function (r) { try { onResponse(r); } catch (e) { onFailure(); } }, onFailure);
    }, onFailure);
  }

  // ---------- Activación de la pestaña ----------
  function maybeLoadOnShow() {
    if (!panel.classList.contains('is-active') || panel.hidden) return;
    if (isReading() || isClaiming()) return;
    if (root.getAttribute('data-state') === 'signedout') { load(); return; }
    if (!data || (Date.now() - loadedAt) > STALE_MS) load();
  }
  function afterNav() { setTimeout(maybeLoadOnShow, 0); }

  function init() {
    var client = sb();
    buildStatic();
    clearView();
    setState('loading');
    el.claim.addEventListener('click', onClaim);
    el.retry.addEventListener('click', function () { if (!isReading() && !isClaiming()) load(); });

    var nav = $('mgtNav');
    if (nav) { nav.addEventListener('click', afterNav); nav.addEventListener('keydown', afterNav); }
    window.addEventListener('hashchange', afterNav);

    client.auth.onAuthStateChange(function (event, session) {
      var uid = session && session.user ? session.user.id : null;
      if (event === 'SIGNED_OUT' || !uid) { signedOut(); return; }
      if (currentUid !== null && uid !== currentUid) { identityChanged(); currentUid = uid; el.signedout.hidden = true; setState('loading'); setTimeout(maybeLoadOnShow, 0); return; }
      if (event === 'TOKEN_REFRESHED') return;
      if (currentUid === null) { currentUid = uid; el.signedout.hidden = true; if (!data) setState('loading'); setTimeout(maybeLoadOnShow, 0); }
      // mismo usuario: no hay nada que recargar si ya hay datos; la pestaña refresca al abrirse
    });

    maybeLoadOnShow();
  }

  function whenReady(cb) {
    if (sb()) { cb(); return; }
    setTimeout(function () { whenReady(cb); }, 60);
  }
  whenReady(init);
})();
