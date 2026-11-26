/* ==========================================================================
   GEO ARMY — Sistema de TEMPORADAS (tema estacional centralizado)
   --------------------------------------------------------------------------
   UN solo archivo decide qué tema visual lleva el sitio y lo aplica en todas las páginas públicas
   que lo incluyan. Es SOLO presentación: no lee ni escribe cuentas, economía, XP, rangos, premios,
   membresías ni Supabase.

   CÓMO SE USA
   - En el <head> de cada página pública (lo antes posible, antes de los CSS de la página):
         <script src="js/geoarmy-season.js?v=1"></script>        (en subcarpetas: ../js/...)
   - Para CAMBIAR de temporada solo se edita CONFIG.active (más abajo):
         'original' · 'navidad-2026' · 'ano-nuevo-2027' (reservado) · futuras temporadas
   - Para PREVISUALIZAR sin tocar el código:  ?season=original  |  ?season=navidad-2026  |  ?season=reset
     (se recuerda solo durante la pestaña actual, sessionStorage).

   QUÉ HACE
   1) Marca <html data-ga-season="..." data-ga-scope="..." data-ga-page="...">.
   2) Carga el CSS del tema desde css/seasons/ (maquinaria base compartida + arte del tema).
   3) Añade (por JS, sin tocar el HTML de la página) las capas decorativas aria-hidden:
      luces superiores, nieve y esquinas.  Nada de eso recibe clics (pointer-events:none).
   4) Es una LISTA BLANCA: una página que no figure en PAGES no recibe nada (admin, autenticación,
      overlays de OBS y mini pase One Piece quedan fuera por diseño).

   AÑADIR UNA TEMPORADA: agregar su entrada en SEASONS, sus archivos en THEMES y su CSS en css/seasons/.
   ========================================================================== */
(function () {
  'use strict';

  /* ===================== CONFIGURACIÓN (único punto de cambio) ===================== */
  var CONFIG = {
    mode: 'manual',          // 'manual' = usa "active" · 'auto' = elige por fechas (campos from/until de SEASONS)
    active: 'navidad-2026',  // temporada activa en modo manual
    allowUrlPreview: true    // permite ?season=<id> para previsualizar (solo en esa pestaña)
  };

  /* Temporadas disponibles. ready:false = entrada reservada: NO se aplica (se cae al tema original). */
  var SEASONS = {
    'original':       { ready: true,  label: 'Tema original' },
    'navidad-2026':   { ready: true,  label: 'Navidad 2026',   bodyClass: 'ga-theme-christmas',
                        from: '2026-11-26T00:00:00-05:00', until: '2026-12-31T00:00:00-05:00' },
    'ano-nuevo-2027': { ready: false, label: 'Año Nuevo 2027 (reservado, sin diseño)', bodyClass: 'ga-theme-newyear',
                        from: '2026-12-31T00:00:00-05:00', until: '2027-01-08T00:00:00-05:00' }
  };

  /* Archivos de cada tema (rutas relativas a la raíz del sitio).
     core   = CSS que se carga en las páginas interiores (maquinaria base + arte del tema)
     native = CSS propio de la portada (referencia visual; ya enlazado en index.html)
     guide  = colores del asistente virtual (solo páginas que lo incluyen: GUIDE_PAGES) */
  var THEMES = {
    'navidad-2026': {
      core:   ['css/seasons/season-base.css?v=1', 'css/seasons/navidad-2026.css?v=1'],
      native: ['css/christmas-home.css'],
      guide:  'css/seasons/navidad-2026-guide.css?v=1'
    },
    'ano-nuevo-2027': {
      core:   ['css/seasons/season-base.css?v=1', 'css/seasons/ano-nuevo-2027.css?v=1'],
      native: [],
      guide:  null
    }
  };

  /* Lista blanca de páginas y su perfil:
       native  portada (tiene su propio CSS/capas en el HTML; el sistema solo la conecta al interruptor)
       full    lienzo de fondo invernal + capas
       overlay solo capas, respeta el fondo propio de la página
       lights  solo luces superiores (Tienda: sistema delicado, cero cambios de estructura)  */
  var PAGES = {
    'index': 'native',
    'ranking': 'full', 'ganadores': 'full', 'mi-geoarmy': 'full', 'plus': 'full', 'misiones': 'full',
    'comunidad': 'full', 'puntos': 'full', 'guia': 'full', 'pinatas': 'full', 'streamer-vs-viewer': 'full',
    'tienda': 'lights'
  };
  var GUIDE_PAGES = { 'index': true };   // páginas donde existe el asistente virtual

  /* ================================ NÚCLEO ================================ */
  var root = document.documentElement;
  var KEY = 'ga_season_preview';
  var LOG = '[geoarmy-season] ';

  try {
    var me = document.currentScript;
    var src = me && me.src ? new URL(me.src, location.href) : null;
    var basePath = src ? src.pathname.replace(/js\/geoarmy-season\.js$/, '') : '/';
    var baseHref = src ? src.href.replace(/js\/geoarmy-season\.js.*$/, '') : '';

    /* Página actual (relativa a la raíz del sitio) */
    var rel = location.pathname.indexOf(basePath) === 0 ? location.pathname.slice(basePath.length) : location.pathname.replace(/^\//, '');
    var page = rel.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '') || 'index';
    root.setAttribute('data-ga-page', page);

    var profile = PAGES[page];
    if (!profile) return;                                   // fuera de la lista blanca: no hace nada

    /* Temporada elegida */
    var id = CONFIG.active;
    if (CONFIG.mode === 'auto') {
      var now = Date.now(), best = null;
      Object.keys(SEASONS).forEach(function (k) {
        var s = SEASONS[k]; if (!s.from || !s.until || !s.ready) return;
        if (now >= Date.parse(s.from) && now < Date.parse(s.until)) best = k;
      });
      id = best || 'original';
    }
    if (CONFIG.allowUrlPreview) {
      var q = /[?&]season=([a-z0-9-]+)/.exec(location.search);
      try {
        if (q) { if (q[1] === 'reset') sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY, q[1]); }
        var saved = sessionStorage.getItem(KEY); if (saved) id = saved;
      } catch (e) { if (q && q[1] !== 'reset') id = q[1]; }
    }
    var def = SEASONS[id];
    if (!def || !def.ready) {
      if (def && !def.ready) console.info(LOG + '"' + id + '" está reservada y aún no tiene diseño: se muestra el tema original.');
      id = 'original'; def = SEASONS.original;
    }

    var theme = THEMES[id];
    var active = id !== 'original' && !!theme;
    var scope = profile === 'native' ? 'native' : profile;
    if (active) {
      root.setAttribute('data-ga-season', id);
      root.setAttribute('data-ga-scope', scope);
    }

    /* API mínima para pruebas / consola */
    window.GeoArmySeason = {
      id: id, page: page, profile: profile, active: active,
      seasons: Object.keys(SEASONS),
      preview: function (s) { try { sessionStorage.setItem(KEY, s); } catch (e) {} location.reload(); }
    };

    function linkTag(href) { return '<link rel="stylesheet" href="' + baseHref + href + '" data-ga-season-css>'; }
    function addLink(href) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = baseHref + href; l.setAttribute('data-ga-season-css', '');
      document.head.appendChild(l);
    }
    function loadCss(list) {
      list.forEach(function (h) {
        if (document.readyState === 'loading') document.write(linkTag(h)); else addLink(h);   // en <head>: sin parpadeo
      });
    }

    if (active) {
      if (profile !== 'native') loadCss(theme.core);
      if (theme.guide && GUIDE_PAGES[page]) loadCss([theme.guide]);
    }

    /* Capas decorativas (aria-hidden, sin clics) */
    var LAYERS = {
      snow: '<div class="ga-xmas-snow"><i class="ga-sn-far"></i><i class="ga-sn-near"></i></div>',
      lights: '<div class="ga-xmas-garland"><i class="ga-gl-a"></i><i class="ga-gl-b"></i></div>',
      corners: '<span class="ga-xmas-corner ga-xmas-corner--tl"></span><span class="ga-xmas-corner ga-xmas-corner--tr"></span>' +
               '<span class="ga-xmas-corner ga-xmas-corner--bl"></span><span class="ga-xmas-corner ga-xmas-corner--br"></span>'
    };

    function onReady() {
      var body = document.body; if (!body) return;
      if (!active) {
        /* Tema original: la portada trae su tema navideño incrustado; se apaga sin tocar su lógica */
        if (profile === 'native') {
          body.classList.remove('ga-theme-christmas');
          var old = document.querySelectorAll('link[href*="christmas-home.css"]');
          for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
        }
        return;
      }
      if (def.bodyClass) body.classList.add(def.bodyClass);
      if (profile === 'native') {
        /* La portada ya enlaza su CSS; si faltara, se añade */
        (theme.native || []).forEach(function (h) {
          var base = h.split('?')[0];
          if (!document.querySelector('link[href*="' + base + '"]')) addLink(h);
        });
        return;                                           // sus capas ya están en index.html
      }
      var host = document.querySelector('.v3-page');
      if (!host) { host = body; root.setAttribute('data-ga-nov3', ''); }
      if (document.querySelector('.ga-xmas-fx')) return;
      var fx = document.createElement('div');
      fx.className = 'ga-xmas-fx'; fx.setAttribute('aria-hidden', 'true');
      fx.innerHTML = (profile === 'lights' ? '' : LAYERS.snow) + LAYERS.lights + (profile === 'lights' ? '' : LAYERS.corners);
      host.insertBefore(fx, host.firstChild);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();
  } catch (err) {
    /* Nunca debe romper una página: ante cualquier fallo, el sitio queda con su aspecto normal */
    if (window.console) console.warn(LOG + 'desactivado por error:', err);
  }
})();

/* Perfiles de Navidad: capa visual independiente del calendario de las páginas. */
(function () {
  'use strict';
  try {
    if (!window.GeoArmySeason || window.GeoArmySeason.profile === 'lights') return;
    var source = document.currentScript;
    if (!source || !source.src) return;
    var base = source.src.replace(/js\/geoarmy-season\.js.*$/, '');
    var script = document.createElement('script');
    script.src = base + 'js/navidad-perfiles-2026.js?v=4';
    script.async = true;
    document.head.appendChild(script);
  } catch (e) { /* el adorno nunca debe impedir el uso de la página */ }
}());
