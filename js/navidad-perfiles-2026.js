/* GEO ARMY: adornos de perfil, solo visuales. Fechas en hora del Este. */
(function () {
  'use strict';
  var root = document.documentElement;
  var script = document.currentScript;
  var base = script && script.src ? new URL('../', script.src).href : './';
  var start = Date.parse('2026-12-01T00:00:00-05:00');
  var end = Date.parse('2027-01-01T00:00:00-05:00');
  var beta = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || (location.hostname === 'geovanyrk.github.io' && location.pathname.indexOf('/geoarmy-v2/') === 0);
  var preview = beta && new URLSearchParams(location.search).get('preview-perfiles-navidad') === '1';
  var sheet;
  function update() {
    var now = Date.now();
    var active = preview || (now >= start && now < end);
    if (active && !sheet) { sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = base + 'css/navidad-perfiles-2026.css?v=3'; document.head.appendChild(sheet); }
    if (active) root.setAttribute('data-ga-profile-christmas', 'on');
    else root.removeAttribute('data-ga-profile-christmas');
  }
  update();
  setInterval(update, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) update(); });
}());
