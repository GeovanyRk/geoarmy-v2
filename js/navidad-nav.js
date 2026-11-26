/* GEO ARMY · Navegación navideña unificada.
   Pinta, en el contenedor #gxTop (o al inicio del <body>): 1) la barra ORIGINAL de GEO ARMY con #geoAccountWidget
   (el perfil real lo dibuja js/geoarmy-account.js; este archivo NO toca autenticación ni la lógica del perfil)
   y 2) la barra de navegación del evento con la sección activa resaltada automáticamente.
   Debe ejecutarse ANTES de js/geoarmy-account.js. Solo presentación. */
(function () {
  'use strict';
  var REGALO_URL = null;   // lanzamiento público de "Mi regalo de Navidad": poner aquí 'navidad-regalo.html' y se habilita en todas las páginas
  var REGALO_PAGE = 'navidad-regalo.html';   // dentro de su propia página (revisión privada) la pestaña aparece resaltada
  var TABS = [
    { id: 'arbol',  href: 'navidad-arbol.html',  icon: 'tree',   label: 'Árbol de<br>Navidad' },
    { id: 'taller', href: 'navidad-taller.html', icon: 'hammer', label: 'Taller<br>de Santa' },
    { id: 'cartas', href: 'navidad-cartas.html', icon: 'mail',   label: 'Oficina<br>de Correos' },
    { id: 'lista',  href: 'navidad-lista.html',  icon: 'scroll', label: 'Lista<br>de Santa' },
    { id: 'viaje',  href: 'navidad-viaje.html',  icon: 'sleigh', label: 'Viaje<br>de Santa' }
  ];
  var ICONS = {
    tree: '<symbol id="gxn-i-tree" viewBox="0 0 24 24"><path d="M12 2l-5 7h3l-5 7h4l-4 5h14l-4-5h4l-5-7h3z" fill="currentColor"/></symbol>',
    hammer: '<symbol id="gxn-i-hammer" viewBox="0 0 24 24"><path d="M14 3l7 7-3 3-2-2-9 9-3-3 9-9-2-2z" fill="currentColor"/></symbol>',
    mail: '<symbol id="gxn-i-mail" viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 7l9 7 9-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol>',
    scroll: '<symbol id="gxn-i-scroll" viewBox="0 0 24 24"><path d="M6 3h12v15a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1h3V6a3 3 0 0 1-1-3zm3 5h6M9 11h6M9 14h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol>',
    sleigh: '<symbol id="gxn-i-sleigh" viewBox="0 0 28 24"><path d="M3 9h5l1 7h13l1-5h-4l2-5h3v2h-1l-1.4 3H25l-1 6.5c-.3 1-1 1.5-2 1.5H9.5L8.5 18H4V9z" fill="currentColor"/><path d="M2 21q8 2 20 0q4-1 3-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>',
    gift: '<symbol id="gxn-i-gift" viewBox="0 0 24 24"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-3-5-8-3-5 0M12 7c3-5 8-3 5 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol>'
  };
  function currentId() {
    var host = document.getElementById('gxTop');
    if (host && host.getAttribute('data-active')) return host.getAttribute('data-active');
    var f = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    for (var i = 0; i < TABS.length; i++) if (f === TABS[i].href.replace(/\.html$/, '')) return TABS[i].id;
    if (f === REGALO_PAGE.replace(/\.html$/, '')) return 'regalo';
    return '';
  }
  function icon(name, vb) { return '<svg viewBox="' + (vb || '0 0 24 24') + '" aria-hidden="true" focusable="false"><use href="#gxn-i-' + name + '"/></svg>'; }
  var cur = currentId();
  var tabs = TABS.map(function (t) {
    var on = t.id === cur;
    return '<li' + (on ? ' class="is-current"' : '') + '><a href="' + t.href + '"' + (on ? ' aria-current="page"' : '') + '>' + icon(t.icon, t.icon === 'sleigh' ? '0 0 28 24' : '') + '<span>' + t.label + '</span></a></li>';
  }).join('');
  tabs += (REGALO_URL || cur === 'regalo')
    ? '<li' + (cur === 'regalo' ? ' class="is-current"' : '') + '><a href="' + (REGALO_URL || REGALO_PAGE) + '"' + (cur === 'regalo' ? ' aria-current="page"' : '') + '>' + icon('gift') + '<span>Mi regalo<br>de Navidad</span></a></li>'
    : '<li class="is-soon"><span class="gxn-soon" role="link" aria-disabled="true" title="Próximamente">' + icon('gift') + '<span>Mi regalo<br>de Navidad</span></span></li>';
  var html =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' + Object.keys(ICONS).map(function (k) { return ICONS[k]; }).join('') + '</defs></svg>' +
    '<nav class="v3-nav" aria-label="GEO ARMY"><div class="v3-nav-inner">' +
      '<a href="index.html" class="v3-logo"><span class="v3-logo-mark"><img src="logo.png" alt="GeoArmy"/></span><span class="v3-wordmark">GEO ARMY</span></a>' +
      '<div class="v3-page-links"><a href="index.html#inicio">Inicio</a><a href="tienda.html">Tienda</a><a href="puntos.html">Puntos</a></div>' +
      '<div class="v3-auth"><div id="geoAccountWidget"></div></div>' +
    '</div></nav>' +
    '<nav class="gxn" aria-label="Evento de Navidad">' +
      '<a class="gxn-back" href="index.html" aria-label="Volver al Mundo 02"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span><span class="t-long">Volver al </span>Mundo 02</span></a>' +
      '<ul class="gxn-tabs">' + tabs + '</ul>' +
    '</nav>';
  var host = document.getElementById('gxTop');
  if (!host) { host = document.createElement('div'); host.id = 'gxTop'; document.body.insertBefore(host, document.body.firstChild); }
  host.className = 'gxm-top'; host.innerHTML = html;
  // Adornos navideños del perfil (módulo existente, el mismo que cargan las demás páginas vía geoarmy-season.js): solo visual.
  try {
    var me = document.currentScript || document.querySelector('script[src*="navidad-nav.js"]');
    if (me && me.src && !document.querySelector('script[src*="navidad-perfiles-2026.js"]')) {
      var ps = document.createElement('script'); ps.src = me.src.replace(/js\/navidad-nav\.js.*$/, '') + 'js/navidad-perfiles-2026.js?v=3'; ps.async = true; document.head.appendChild(ps);
    }
  } catch (e) { /* el adorno nunca debe impedir el uso de la página */ }
  // la pestaña activa queda visible en el desplazamiento horizontal (sin mover la página)
  var list = host.querySelector('.gxn-tabs'), act = host.querySelector('.is-current');
  function center() { if (list && act) list.scrollLeft = Math.max(0, act.offsetLeft - (list.clientWidth - act.offsetWidth) / 2); }
  center(); window.addEventListener('load', center); window.addEventListener('resize', center);
})();
