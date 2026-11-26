/* =====================================================================
   GEO ARMY · APARIENCIAS · CATÁLOGO CONTROLADO   (js/geoarmy-cosmetics-catalog.js, v1)
   SOLO PRESENTACIÓN. Lo carga js/geoarmy-cosmetics.js (y solo cuando GEOARMY_COSMETICS_ENABLED === true).

   Qué es: la ÚNICA lista de apariencias que la web sabe pintar. Cada apariencia es una DEFINICIÓN (datos) que vive aquí, dentro de
   la web, junto a su paquete de recursos (assets/cosmetics/<id>/ y, si hace falta, css/cosmetics/<slug>.css). La base de datos solo
   dice QUÉ CÓDIGO tiene cada usuario; el aspecto sale de este catálogo:
     · un código que no esté aquí  → apariencia normal.
     · nada que venga de la base de datos se ejecuta, se inserta como HTML ni se usa como ruta: el código solo se busca como CLAVE.
     · las rutas de recursos de cada definición se validan (carpeta fija, sin "..", sin URLs) y los textos se insertan con textContent.
     · una definición inválida se descarta entera (queda como código desconocido) y se avisa en la consola.

   Campos de una definición (todos validados en define()):
     id         código EXACTO que devuelve Supabase (minúsculas, números y _ ; 3–64; empieza por letra).
     label      nombre accesible de la apariencia (1–60 caracteres; documentación y lectores).
     sr         texto para lectores de pantalla que se añade tras el nombre, p. ej. "VIP" → " (VIP)" (0–30; "" = nada).
     cls        clases CSS propias (cada una "gcos-…") que se ponen en el elemento decorado; los estilos propios cuelgan de ellas.
     css        hoja de estilos propia opcional: "css/cosmetics/<slug>.css" (se carga solo si se usa la apariencia).
     rev        revisión de ESTE diseño (1–999). Sus recursos se piden con ?v=<GEOARMY_COSMETICS_REV>.<rev>; el catálogo con ?v=<GEOARMY_COSMETICS_REV>
                (js/geoarmy-config.js). Súbela si cambias archivos de este diseño; la REV global se sube siempre (ver GUIA_ANADIR_UN_DISENO.md).
     frame      marco opcional: { src: "assets/cosmetics/<carpeta>/<archivo>.svg|png|webp", scale: 0.5–4 (tamaño del marco / foto),
                anchorY: 0–2 (distancia, en diámetros de foto, desde el borde SUPERIOR del marco hasta el centro de la foto), animateInCard: bool (brillo suave en la tarjeta) }.
     badge      distintivo opcional con texto propio: { text: "1–12 caracteres" }. null = sin distintivo.
     colors     paleta opcional (#rrggbb) → variables CSS --gcos-accent, --gcos-accent2, --gcos-ink, --gcos-text en los elementos decorados.
     surfaces   dónde se pinta: { bar, ranking, card } (true por defecto; false desactiva ese espacio para esta apariencia).

   Nada de aquí toca XP, G-Coins, saldos, pagos ni rangos.
   ===================================================================== */
(function () {
  'use strict';
  if (window.GeoArmyCosmeticsCatalog) return;

  var ID_RE = /^[a-z][a-z0-9_]{2,63}$/;
  var CLS_RE = /^gcos-[a-z0-9-]{1,40}$/;
  var CSS_RE = /^css\/cosmetics\/[a-z0-9-]{1,60}\.css$/;
  var IMG_RE = /^assets\/cosmetics\/[a-z0-9-]{1,60}\/[a-z0-9_-]{1,60}(\.[a-z0-9_-]{1,20})*\.(svg|png|webp)$/;
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var COLOR_KEYS = ['accent', 'accent2', 'ink', 'text'];

  var defs = Object.create(null);     // id → definición congelada
  var order = [];

  function isPlain(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function num(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }
  function str(v, min, max) { return typeof v === 'string' && v.length >= min && v.length <= max && !/[\u0000-\u001f<>]/.test(v); }

  // Devuelve la definición normalizada (copia congelada) o lanza Error con el motivo. Los campos desconocidos se IGNORAN (no se copian).
  function normalize(d) {
    if (!isPlain(d)) throw new Error('definición no es un objeto');
    if (typeof d.id !== 'string' || !ID_RE.test(d.id)) throw new Error('id inválido');
    if (!str(d.label, 1, 60)) throw new Error('label inválido');
    var sr = d.sr === undefined ? d.label : d.sr;
    if (!str(sr, 0, 30)) throw new Error('sr inválido');
    var cls = d.cls === undefined ? [] : (typeof d.cls === 'string' ? [d.cls] : d.cls);
    if (!Array.isArray(cls) || cls.length > 4) throw new Error('cls inválido');
    cls.forEach(function (c) { if (typeof c !== 'string' || !CLS_RE.test(c)) throw new Error('clase inválida: ' + c); });
    var css = d.css === undefined ? null : d.css;
    if (css !== null && (typeof css !== 'string' || !CSS_RE.test(css))) throw new Error('css inválido');
    var rev = d.rev === undefined ? 1 : d.rev;
    if (!(typeof rev === 'number' && Math.floor(rev) === rev && rev >= 1 && rev <= 999)) throw new Error('rev inválido');
    var frame = d.frame === undefined ? null : d.frame;
    if (frame !== null) {
      if (!isPlain(frame) || typeof frame.src !== 'string' || !IMG_RE.test(frame.src) || frame.src.indexOf('..') !== -1) throw new Error('frame.src inválido');
      if (!num(frame.scale, 0.5, 4)) throw new Error('frame.scale inválido');
      if (!num(frame.anchorY, 0, 2)) throw new Error('frame.anchorY inválido');
      if (frame.animateInCard !== undefined && typeof frame.animateInCard !== 'boolean') throw new Error('frame.animateInCard inválido');
      frame = { src: frame.src, scale: frame.scale, anchorY: frame.anchorY, animateInCard: frame.animateInCard === true };
    }
    var badge = d.badge === undefined ? null : d.badge;
    if (badge !== null) {
      if (!isPlain(badge) || !str(badge.text, 1, 12)) throw new Error('badge.text inválido');
      badge = { text: badge.text };
    }
    var colors = {};
    if (d.colors !== undefined) {
      if (!isPlain(d.colors)) throw new Error('colors inválido');
      Object.keys(d.colors).forEach(function (k) {
        if (COLOR_KEYS.indexOf(k) === -1 || typeof d.colors[k] !== 'string' || !HEX_RE.test(d.colors[k])) throw new Error('color inválido: ' + k);
        colors[k] = d.colors[k].toLowerCase();
      });
    }
    var s = d.surfaces === undefined ? {} : d.surfaces;
    if (!isPlain(s)) throw new Error('surfaces inválido');
    ['bar', 'ranking', 'card'].forEach(function (k) { if (s[k] !== undefined && typeof s[k] !== 'boolean') throw new Error('surfaces.' + k + ' inválido'); });
    var out = {
      id: d.id, label: d.label, sr: sr, cls: Object.freeze(cls.slice()), css: css, rev: rev, frame: frame ? Object.freeze(frame) : null,
      badge: badge ? Object.freeze(badge) : null, colors: Object.freeze(colors),
      surfaces: Object.freeze({ bar: s.bar !== false, ranking: s.ranking !== false, card: s.card !== false }),
      testOnly: false
    };
    return out;
  }

  function define(d, testOnly) {
    try {
      var n = normalize(d);
      if (defs[n.id]) throw new Error('id repetido: ' + n.id);
      n.testOnly = testOnly === true;
      defs[n.id] = Object.freeze(n); order.push(n.id);
      return true;
    } catch (e) {
      try { console.warn('[cosmetics] apariencia descartada' + (d && d.id ? ' (' + String(d.id).slice(0, 40) + ')' : '') + ': ' + e.message); } catch (e2) {}
      return false;
    }
  }

  // ===================================================================
  // CATÁLOGO DE PRODUCCIÓN — añadir un diseño nuevo = añadir UNA definición aquí (ver LEEME_PLATAFORMA_APARIENCIAS.md)
  // ===================================================================
  define({
    id: 'vip_violet_silver',
    label: 'VIP violeta y plata',
    sr: 'VIP',                                   // la etiqueta «VIP» pertenece SOLO a este diseño
    cls: ['gcos-vip'],                           // los estilos propios del VIP cuelgan de .gcos-vip (css/cosmetics/vip-violet-silver.css)
    css: 'css/cosmetics/vip-violet-silver.css',
    rev: 1,
    frame: { src: 'assets/cosmetics/vip-violet-silver/frame.svg', scale: 1.6375, anchorY: 0.9125, animateInCard: true },
    badge: { text: 'VIP' },
    colors: { accent: '#9b3cff', accent2: '#b45cff', ink: '#120726', text: '#e6e9f2' },
    surfaces: { bar: true, ranking: true, card: true }
  });

  // ---------- Familia Geo Army Plus (maqueta visual) ----------
  // plus_emerald       aspecto de Geo Army Plus: marco esmeralda aprobado por Geo (imagen real, assets/cosmetics/plus-emerald/frame.png) con su placa «PLUS» incluida. Solo se muestra si el servidor devuelve este código.
  // normal_gray_orange aspecto NORMAL con tema gris/negro/naranja (sin marco, sin distintivo). Se pinta si el servidor lo devuelve o, SI se activa
  //                    GEOARMY_COSMETICS_DEFAULT = 'normal_gray_orange' en js/geoarmy-config.js, a quien el servidor confirma sin apariencia (código null).
  //                    Sin esa línea los usuarios sin código siguen viéndose exactamente igual que siempre.
  // Quién tiene Plus lo decide el sistema de membresía (suscripción activa de Twitch), NO este archivo. VIP + Plus = solo VIP (lo resuelve el servidor).
  define({
    id: 'plus_emerald',
    label: 'Plus esmeralda',
    sr: 'Plus',
    cls: ['gcos-plus'],
    css: 'css/cosmetics/plus-emerald.css',
    rev: 4,
    frame: { src: 'assets/cosmetics/plus-emerald/frame.png', scale: 1.405, anchorY: 0.701, animateInCard: false },
    badge: null,                                  // la placa «PLUS» YA viene dentro de la imagen del marco (aprobada por Geo): no se añade otra
    colors: { accent: '#19d98b', accent2: '#7dffc6', ink: '#04140d', text: '#e9fff6' },
    surfaces: { bar: true, ranking: true, card: true }
  });
  define({
    id: 'normal_gray_orange',
    label: 'Normal gris y naranja',
    sr: '',
    cls: ['gcos-normal'],
    css: 'css/cosmetics/normal-gray-orange.css',
    rev: 1,
    badge: null,
    colors: { accent: '#ff7a2f', accent2: '#ffb84a', ink: '#14161b', text: '#e6e9f2' },
    surfaces: { bar: true, ranking: true, card: true }
  });

  // ---------- Apariencias de PRUEBA (solo equipo local) ----------
  // Si la página corre en un equipo local (archivo / localhost / 127.0.0.1 / *.local) y existe window.GEOARMY_COSMETICS_TEST_DEFS
  // (lista de definiciones), se registran marcadas como testOnly. En geoarmy.tv se ignora siempre. Ninguna página ni archivo de la web
  // define esa variable: solo el entorno de pruebas.
  function isLocalHost() {
    var h = String(location.hostname || '');
    return location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.local$/.test(h);
  }
  var testDefs = window.GEOARMY_COSMETICS_TEST_DEFS;
  if (Array.isArray(testDefs)) {
    if (isLocalHost()) {
      testDefs.forEach(function (d) { define(d, true); });
      try { console.warn('[cosmetics] apariencias de PRUEBA registradas (solo equipo local): ' + order.filter(function (i) { return defs[i].testOnly; }).join(', ')); } catch (e) {}
    }
  }

  window.GeoArmyCosmeticsCatalog = Object.freeze({
    version: 1,
    get: function (code) { return typeof code === 'string' && defs[code] ? defs[code] : null; },     // clave de búsqueda, nunca ejecutada ni insertada
    has: function (code) { return typeof code === 'string' && !!defs[code]; },
    codes: function () { return order.slice(); }
  });
})();
