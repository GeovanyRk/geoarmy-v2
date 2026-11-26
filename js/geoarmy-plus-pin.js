/* ============================================================================
   GEO ARMY Plus — comportamiento del PIN del mundo principal (js/geoarmy-plus-pin.js).  SOLO PRESENTACIÓN.
   - Pregunta al servidor (RPC autenticada geo_plus_my_access_v1, mínima: {access}) si la cuenta tiene Plus VIGENTE según la regla única
     plus_access_decision (la misma que usan la misión diaria y las apariencias). NO deduce Plus de apariencias, del VIP ni de datos locales.
   - El candado es solo visual: la autorización real de plus.html y de cada recompensa vive en el servidor.
   - Un fallo de red / de la base / un tiempo agotado NO es «sin Plus»: el pin queda en estado «unverified» (neutro, borde punteado y «?», SIN candado) y el clic lleva a plus.html,
     que vuelve a preguntar. Solo el servidor, con la regla de 24 h, dice «sin Plus».
   - Sin sesión: bloqueado (no hay nada que preguntar).  Una respuesta pertenece a la cuenta que preguntó (si cambia la sesión, se descarta).
   - Nunca lanza ni rompe la página: el pin viaja en el HTML con el atributo `hidden`; solo con GEOARMY_PLUS_PAGE_ENABLED = true se muestra. Sin el interruptor, no se ve ni hace nada.
   ============================================================================ */
(function () {
  'use strict';
  var win = window, doc = document;
  var SUBS_URL = 'https://www.twitch.tv/subs/geovannyrk';
  var TIMEOUT_MS = 8000;
  var pin = null, dlg = null, state = 'unknown', ticket = 0;

  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function client() { return win.GeoArmyAccount && win.GeoArmyAccount.client ? win.GeoArmyAccount.client : null; }
  function apply(next) {
    state = next;
    if (!pin) return;
    if (next === 'unknown') pin.removeAttribute('data-plus'); else pin.setAttribute('data-plus', next);
    var base = 'Geo Army Plus';
    pin.setAttribute('aria-label', next === 'locked' ? base + ' (bloqueado: requiere suscripción activa de Twitch)' : next === 'open' ? base + ' (acceso activo)' : next === 'unverified' ? base + ' (no se pudo verificar ahora; entra para reintentar)' : base);
  }
  function refresh() {
    var mine = ++ticket, c = client();
    if (!c || !c.auth) return;
    withTimeout(c.auth.getSession(), TIMEOUT_MS).then(function (r) {
      var s = r && r.data && r.data.session;
      if (mine !== ticket) return;
      if (!s || !s.user) { apply('locked'); return; }                       // sin sesión
      var uid = s.user.id;
      return withTimeout(c.rpc('geo_plus_my_access_v1'), TIMEOUT_MS).then(function (resp) {
        if (mine !== ticket) return;
        if (resp && resp.error) { apply('unverified'); return; }                // error ≠ sin Plus
        var d = resp && resp.data;
        if (d && d.access === true) apply('open');
        else if (d && d.access === false) apply('locked');
        else apply('unverified');
        void uid;
      });
    }).catch(function () { if (mine === ticket) apply('unverified'); });
  }
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = doc.createElement('dialog');
    dlg.className = 'ga-plus-dialog';
    dlg.setAttribute('aria-labelledby', 'gaPlusDlgTitle');
    dlg.innerHTML =
      '<div class="ga-plus-dialog__top"><span class="ga-plus-dialog__badge">◆ GEO ARMY PLUS</span><h2 id="gaPlusDlgTitle"></h2></div>' +
      '<div class="ga-plus-dialog__body"><p id="gaPlusDlgLead"></p>' +
      '<ul><li>Misión diaria de 10 G-Coins con solo entrar</li><li>Misiones semanales de Twitch con G-Coins</li><li>Apariencia esmeralda en tu perfil y en el ranking</li></ul></div>' +
      '<div class="ga-plus-dialog__actions"></div>' +
      '<p class="ga-plus-dialog__note">Plus se activa solo con una suscripción activa al canal de Geo en Twitch. Si ya eres suscriptor, entra con tu cuenta de Twitch y se reconoce automáticamente.</p>';
    doc.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    return dlg;
  }
  function mk(tag, cls, text, href) {
    var el = doc.createElement(tag); el.className = cls; el.textContent = text;
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; }
    return el;
  }
  function openDialog() {
    var d = ensureDialog(), anon = state === 'locked' && !(win.GeoArmyAccount && win.GeoArmyAccount.identity && win.GeoArmyAccount.identity());
    d.querySelector('h2').textContent = anon ? 'Zona exclusiva para suscriptores' : 'Esta zona es para suscriptores de Twitch';
    d.querySelector('#gaPlusDlgLead').textContent = anon
      ? 'Inicia sesión con Twitch para comprobar si tienes Geo Army Plus.'
      : 'Geo Army Plus se activa con una suscripción activa a mi canal de Twitch. Aún no vemos una suscripción vigente en tu cuenta.';
    var box = d.querySelector('.ga-plus-dialog__actions'); box.textContent = '';
    if (anon) {
      var b = mk('button', 'ga-plus-dialog__btn ga-plus-dialog__btn--primary', 'Iniciar sesión con Twitch');
      b.type = 'button';
      b.addEventListener('click', function () { d.close(); try { win.GeoArmyAccount.openLogin(); } catch (e) { /* ignorar */ } });
      box.appendChild(b);
    } else {
      box.appendChild(mk('a', 'ga-plus-dialog__btn ga-plus-dialog__btn--primary', 'Suscribirme en Twitch', SUBS_URL));
    }
    var c = mk('button', 'ga-plus-dialog__btn', 'Cerrar'); c.type = 'button';
    c.addEventListener('click', function () { d.close(); });
    box.appendChild(c);
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function init() {
    pin = doc.getElementById('gaPlusPin');
    if (!pin || win.GEOARMY_PLUS_PAGE_ENABLED !== true) return;
    pin.hidden = false;
    pin.addEventListener('click', function (e) {
      if (state === 'locked') { e.preventDefault(); openDialog(); }        // 'open' y 'unverified': navega; plus.html decide en el servidor
    });
    refresh();
    try {
      var c = client();
      if (c && c.auth && c.auth.onAuthStateChange) c.auth.onAuthStateChange(function (ev) {
        if (ev === 'SIGNED_OUT') { ticket++; apply('locked'); }
        else if (ev === 'SIGNED_IN') setTimeout(refresh, 0);
      });
    } catch (e) { /* ignorar */ }
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'visible') refresh(); });
  }
  try { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init(); } catch (e) { /* nunca rompe la página */ }
})();
