// ===== Home: tarjeta "Racha diaria" (solo LECTURA) =====
// Muestra la racha actual y si hoy ya se registró la asistencia. Lee get_my_streak() (el servidor ya
// calcula la racha efectiva; aquí NO se recalcula nada con fechas) con el cliente compartido
// window.GeoArmyAccount.client. NUNCA llama claim_daily_streak(): el botón es un enlace normal a
// mi-geoarmy.html#racha, donde el registro se hace solo por clic.
//
// Aislamiento por cuenta: el dato en memoria lleva su uid y se descarta al cambiar de cuenta o cerrar
// sesión (la tarjeta se oculta al instante); una lectura que llega tarde de otra cuenta se descarta.
// Una sola lectura a la vez, TTL de ~60 s, nada se guarda en sessionStorage/localStorage.
// Sin sesión, cargando, error o respuesta inválida: la tarjeta queda oculta (nunca un número inventado).
(function () {
  'use strict';

  var TTL_OK = 60000;    // lectura buena: no se vuelve a pedir en ~60 s
  var TTL_FAIL = 20000;  // lectura fallida: reintento no antes de ~20 s

  var root = document.getElementById('gaRacha');
  var acct = window.GeoArmyAccount;
  if (!root || !acct || !acct.client || !acct.client.auth || typeof acct.client.rpc !== 'function') return;
  var sb = acct.client;

  var elStatus = root.querySelector('.ga-racha-status-text');
  var elNum = root.querySelector('.ga-racha-n');
  var elUnit = root.querySelector('.ga-racha-u');
  var elCta = root.querySelector('.ga-racha-cta');
  if (!elStatus || !elNum || !elUnit || !elCta) return;

  var uid;              // undefined = aún no se sabe · null = sin sesión · string = cuenta vigente
  var state = null;     // { uid, ts, ok }  (la vista ya se pintó si ok)
  var flight = null;    // lectura en curso (una sola)

  // ---------- Validación estricta del contrato (mismo criterio que la pestaña Racha y el header) ----------
  function isCount(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 9007199254740991;
  }
  function isYmd(s) {
    if (typeof s !== 'string') return false;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  function valid(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (!isYmd(d.today) || typeof d.claimed_today !== 'boolean') return false;
    if (!isCount(d.current_streak) || !isCount(d.best_streak) || !isCount(d.total_checkins)) return false;
    if (d.last_checkin_date !== null && d.last_checkin_date !== undefined && !isYmd(d.last_checkin_date)) return false;
    return true;
  }

  // ---------- Pintado ----------
  function hide() {
    root.hidden = true;
    root.removeAttribute('data-state');
  }
  function paint(d) {
    var view, status, cta;
    if (d.claimed_today) { view = 'done'; status = 'Ya activaste tu racha de hoy'; cta = 'Ver racha'; }
    else if (d.total_checkins === 0) { view = 'new'; status = 'Empieza tu racha hoy'; cta = 'Empezar ahora'; }
    else { view = 'pending'; status = 'Todavía no activas tu racha de hoy'; cta = 'Activar racha'; }
    elStatus.textContent = status;
    elNum.textContent = String(d.current_streak);
    elUnit.textContent = d.current_streak === 1 ? 'día' : 'días';
    elCta.textContent = cta;
    root.setAttribute('data-state', view);
    root.hidden = false;
  }

  // ---------- Lectura ----------
  function read(force) {
    if (!uid || flight) return;
    if (!force && state && state.uid === uid && (Date.now() - state.ts) < (state.ok ? TTL_OK : TTL_FAIL)) return;
    var mine = { uid: uid };
    flight = mine;
    function finish(d) {
      if (flight !== mine || uid !== mine.uid) return;   // otra cuenta / cierre de sesión: se descarta
      flight = null;
      if (valid(d)) { state = { uid: mine.uid, ts: Date.now(), ok: true }; paint(d); }
      else { state = { uid: mine.uid, ts: Date.now(), ok: false }; hide(); }
    }
    var p;
    try { p = sb.rpc('get_my_streak'); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (r) { finish(r && !r.error ? r.data : null); }, function () { finish(null); });
  }

  // ---------- Identidad (sigue a los eventos de auth del cliente compartido) ----------
  function setIdentity(next) {
    next = next || null;
    if (next === uid) return;      // TOKEN_REFRESHED / SIGNED_IN repetido de la misma cuenta: no se toca nada
    uid = next;
    state = null;
    flight = null;                 // la lectura en curso (si hay) queda huérfana y se descarta al llegar
    hide();                        // nunca se ve la racha de la cuenta anterior
    if (uid) read(false);
  }

  try {
    sb.auth.onAuthStateChange(function (event, session) {
      try { setIdentity(session && session.user ? session.user.id : null); } catch (e) {}
    });
  } catch (e) { return; }

  // La identidad que account.js ya confirmó (si la hay) y, como respaldo, getSession(): solo si todavía no se sabe nada.
  try {
    var known = typeof acct.identity === 'function' ? acct.identity() : undefined;
    if (known !== undefined) setIdentity(known);
  } catch (e) {}
  try {
    Promise.resolve(sb.auth.getSession()).then(function (r) {
      if (uid !== undefined) return;   // un evento de auth ya fijó la identidad: es más reciente
      var s = r && r.data && r.data.session;
      setIdentity(s && s.user ? s.user.id : null);
    }, function () {});
  } catch (e) {}

  // Al volver a la pestaña (p. ej. pasó la medianoche de Nueva York o se registró en otra pantalla) se relee, respetando el TTL.
  document.addEventListener('visibilitychange', function () {
    try { if (document.visibilityState === 'visible') read(false); } catch (e) {}
  });
  // Volver con "atrás" desde Mi Geo Army (bfcache): el estado de la tarjeta pudo cambiar al registrar; se relee de inmediato.
  window.addEventListener('pageshow', function (e) {
    try { if (e && e.persisted) read(true); } catch (err) {}
  });
})();
