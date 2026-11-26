// onepiece-mision.js — Página dinámica de misiones del Mini Pase Pirata (One Piece 2026) · FASE ÚNICA DE LANZAMIENTO.
//
// UNA sola página para las 20 misiones: onepiece-mision.html?m=<id|code>. El modo demo está desactivado.
//
// Qué hace:
//   - Reutiliza el cliente de Supabase Auth del sitio (window.GeoArmyAccount.client). NO crea otro cliente.
//   - Modo real: lee SOLO la RPC ya instalada onepiece_2026_get_mission_catalog() (solo lectura) para saber si la misión
//     existe, su capítulo y si el servidor la marca como disponible/completada. No calcula fechas ni desbloquea nada.
//   - Pinta el desafío a partir del `public_payload` del catálogo protegido (28 etapas cargadas en Supabase). Cada tipo
//     tiene su validador; un payload inválido o ausente muestra un estado seguro, nunca rompe la página.
//   - Modo demo (?demo=1): SOLO si DEMO_ENABLED=true y existe js/onepiece-mision-fixtures.js (datos FICTICIOS, no se publica).
//     No hay sesión, ni RPC, ni envío: la demo nunca evalúa respuestas ni otorga XP.
//   - Fase final: circuito de envío listo. Se usa POST cuando la misión esté publicada y abierta por Supabase
//     onepiece-submit-answer con { mission_id, step_number, answer } y el access_token de la sesión; tras cada resultado
//     se vuelve a leer el catálogo (el servidor decide cuál es la etapa siguiente).
//
// Qué NO hace (a propósito):
//   - Sin misión activa del servidor no hay respuestas enviables. Nunca llama a onepiece-purchase. No envía profile_id.
//   - No contiene respuestas correctas ni verificadores: JavaScript no decide si una respuesta es buena ni acredita XP;
//     solo muestra lo que devuelve el servidor.
//   - Todo texto que viene de datos entra por textContent; las imágenes salen de un catálogo local (art_key en lista blanca),
//     nunca de URLs recibidas.
(function () {
  'use strict';

  var ANSWERS_ENABLED = true;    // envío preparado; SQL decide si capítulo, misión, etapa y recompensas están activos
  var DEMO_ENABLED = false;      // producción: sin demo (y sin js/onepiece-mision-fixtures.js en el servidor)
  var SUBMIT_FN = 'onepiece-submit-answer';
  var SUBMIT_TIMEOUT_MS = 12000;
  var MAX_ANSWER_BYTES = 64;
  var RPC_TIMEOUT_MS = 8000;
  var TYPES = ['treasure_map', 'den_den_mushi', 'wanted_posters', 'poneglyph', 'grand_line_route'];
  var TYPE_LABEL = { treasure_map: 'Mapa del tesoro', den_den_mushi: 'Den Den Mushi', wanted_posters: 'Carteles', poneglyph: 'Poneglyph', grand_line_route: 'Ruta Grand Line' };
  var CHAPTER_NAME = { 1: 'East Blue', 2: 'Grand Line', 3: 'New World', 4: 'Laugh Tale' };
  var IMG_W = 1374, IMG_H = 1145;
  var PLANET = 'assets/onepiece/planeta-diez-islas.webp';
  // Recortes del planeta (centro y ancho en px de la imagen 1374x1145) usados como ilustración de islas.
  var ISLAND_CROPS = {
    isla_puerto: { cx: 285, cy: 925, w: 330 },
    isla_calavera: { cx: 648, cy: 640, w: 280 },
    isla_volcan: { cx: 1040, cy: 650, w: 340 }
  };

  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };

  // ---------- utilidades ----------
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function s(tag, attrs, kids) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function svg(vb, cls, kids) { return s('svg', { viewBox: vb, 'class': cls || '', 'aria-hidden': 'true', focusable: 'false' }, kids); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function use(id, cls) { var sv = s('svg', { 'class': cls || 'op-ic', 'aria-hidden': 'true', focusable: 'false' }); sv.appendChild(s('use', { href: '#' + id })); return sv; }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function getClient() { var A = window.GeoArmyAccount; return (A && A.client) ? A.client : null; }
  function waitForClient(maxMs) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() { var c = getClient(); if (c) return resolve(c); if (Date.now() - t0 > maxMs) return resolve(null); setTimeout(poll, 100); })();
    });
  }
  function openLogin() {
    var A = window.GeoArmyAccount;
    if (A && typeof A.openLogin === 'function') A.openLogin();
    else if (A && typeof A.signInWithTwitch === 'function') A.signInWithTwitch();
  }
  function param(name) {
    try { var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }
  function backHref(n) { return (isInt(n) && n >= 1 && n <= 4) ? 'onepiece.html#opCap' + n : 'onepiece.html#capitulos'; }

  // ---------- validación de payloads públicos (solo forma; nunca correctitud) ----------
  function str(v, max) { return (typeof v === 'string' && v.length > 0 && v.length <= max) ? v : null; }
  function optStr(v, max) { return (typeof v === 'string' && v.length <= max) ? v : ''; }
  function strs(a, maxN, maxLen) {
    if (!Array.isArray(a) || a.length > maxN) return null;
    for (var i = 0; i < a.length; i++) if (!str(a[i], maxLen)) return null;
    return a.slice();
  }
  function idOf(v) { return (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v)) ? v : null; }
  function enumOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function answerCfg(a) {
    var max = (a && isInt(a.max_length) && a.max_length >= 1 && a.max_length <= 60) ? a.max_length : 30;
    return { max_length: max, placeholder: optStr(a && a.placeholder, 60) || 'Escribe tu respuesta' };
  }
  function cleanOptions(arr, min, max) {
    if (!Array.isArray(arr) || arr.length < min || arr.length > max) return null;
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i], id = idOf(o && o.id), label = str(o && o.label, 40);
      if (!id || !label || seen[id]) return null;
      seen[id] = 1;
      out.push({ id: id, label: label, caption: optStr(o.caption, 120), art_key: idOf(o.art_key) || '' });
    }
    return out;
  }
  var VALIDATE = {
    treasure_map: function (p) {
      var opts = cleanOptions(p.options, 3, 3), clues = p.clues === undefined ? [] : strs(p.clues, 4, 200), intro = optStr(p.intro, 300);
      return (opts && clues) ? { intro: intro, clues: clues, options: opts } : null;
    },
    den_den_mushi: function (p) {
      var msg = (typeof p.message === 'string' && /^[A-Z ]{1,80}$/.test(p.message)) ? p.message : null;
      var intro = optStr(p.intro, 300), hint = optStr(p.hint, 300);
      var shift = (p.key && p.key.type === 'caesar' && isInt(p.key.shift) && p.key.shift >= 1 && p.key.shift <= 25) ? p.key.shift : null;
      return (msg) ? { intro: intro, message: msg, hint: hint, shift: shift, answer: answerCfg(p.answer) } : null;
    },
    wanted_posters: function (p) {
      var intro = optStr(p.intro, 300), clue = str(p.clue, 300), arr = p.options;
      if (!clue || !Array.isArray(arr) || arr.length < 3 || arr.length > 4) return null;
      var out = [], seen = {};
      for (var i = 0; i < arr.length; i++) {
        var o = arr[i], id = idOf(o && o.id), name = str(o && o.name, 40), t = (o && o.traits) || {}, notes = strs(o && o.notes, 4, 60);
        if (!id || !name || seen[id] || !notes) return null;
        seen[id] = 1;
        out.push({ id: id, name: name, bounty: optStr(o.bounty, 30), notes: notes, traits: {
          hat: enumOf(t.hat, ['none', 'red', 'blue', 'black'], 'none'), patch: enumOf(t.patch, ['none', 'left', 'right'], 'none'),
          scar: enumOf(t.scar, ['none', 'left', 'right'], 'none'), beard: enumOf(t.beard, ['none', 'full', 'goatee'], 'none'),
          hair: enumOf(t.hair, ['black', 'red', 'blond', 'white'], 'black') } });
      }
      return { intro: intro, clue: clue, options: out };
    },
    poneglyph: function (p) {
      var intro = optStr(p.intro, 300), sym = p.symbols, key = p.key;
      if (!Array.isArray(sym) || sym.length < 3 || sym.length > 10 || !Array.isArray(key) || key.length < 2 || key.length > 16) return null;
      for (var i = 0; i < sym.length; i++) if (!/^g\d{1,2}$/.test(sym[i])) return null;
      var k = [];
      for (var j = 0; j < key.length; j++) {
        if (!key[j] || !/^g\d{1,2}$/.test(key[j].glyph) || !/^[A-Z]$/.test(key[j].letter)) return null;
        k.push({ glyph: key[j].glyph, letter: key[j].letter });
      }
      return { intro: intro, symbols: sym.slice(), key: k, answer: answerCfg(p.answer) };
    },
    grand_line_route: function (p) {
      var intro = optStr(p.intro, 300), total = p.total_stages, cur = p.current_stage, st = p.stage;
      if (!isInt(total) || total < 2 || total > 5 || !isInt(cur) || cur < 1 || cur > total) return null;
      var stage = null;
      var sn = st ? (st.stage_number !== undefined ? st.stage_number : st.step_number) : undefined;
      if (st && sn === cur && (st.kind === 'choice' || st.kind === 'text')) {
        var title = optStr(st.title, 60) || ('Etapa ' + cur), prompt = str(st.prompt, 300);
        if (!prompt) return null;
        stage = { stage_number: cur, kind: st.kind, title: title, prompt: prompt };
        if (st.kind === 'choice') { stage.options = cleanOptions(st.options, 2, 4); if (!stage.options) return null; }
        else stage.answer = answerCfg(st.answer);
        if (st.visual && st.visual.type === 'count' && st.visual.icon === 'ancla' && isInt(st.visual.count) && st.visual.count >= 1 && st.visual.count <= 9) stage.visual = { type: 'count', icon: 'ancla', count: st.visual.count };
      } else if (st) return null;
      return { intro: intro, total: total, current: cur, completed: isInt(p.completed_stages) ? Math.max(0, Math.min(p.completed_stages, total)) : cur - 1, stage: stage };
    }
  };

  // ---------- arte (catálogo local; art_key en lista blanca) ----------
  function islandArt(key) {
    var c = ISLAND_CROPS[key];
    var d = h('div', { class: 'om-isle', 'aria-hidden': 'true' });
    if (!c) { d.classList.add('om-isle-none'); d.appendChild(use('i-anchor', 'op-ic')); return d; }
    var ww = c.w, hh = ww * 3 / 4;
    var x0 = Math.min(Math.max(c.cx - ww / 2, 0), IMG_W - ww), y0 = Math.min(Math.max(c.cy - hh / 2, 0), IMG_H - hh);
    d.style.backgroundImage = "url('" + PLANET + "')";
    d.style.backgroundSize = (IMG_W / ww * 100).toFixed(2) + '% auto';
    d.style.backgroundPosition = (x0 / (IMG_W - ww) * 100).toFixed(2) + '% ' + (y0 / (IMG_H - hh) * 100).toFixed(2) + '%';
    return d;
  }
  function arrowArt(dir) {
    var rot = { rumbo_norte: 0, rumbo_este: 90, rumbo_sur: 180, rumbo_oeste: 270 }[dir];
    var letter = { rumbo_norte: 'N', rumbo_este: 'E', rumbo_sur: 'S', rumbo_oeste: 'O' }[dir];
    var g = s('g', { transform: 'rotate(' + rot + ' 50 50)' }, [
      s('path', { d: 'M50 10 L62 50 L50 42 L38 50 Z', fill: '#f5c451', stroke: '#5b3513', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      s('path', { d: 'M50 90 L62 50 L50 58 L38 50 Z', fill: '#7b5b3a', stroke: '#2b1a0c', 'stroke-width': 2.5, 'stroke-linejoin': 'round' })
    ]);
    var t = s('text', { x: 50, y: 98, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: '#3a2008' }); t.textContent = letter;
    return svg('0 0 100 104', 'om-art-svg', [s('circle', { cx: 50, cy: 50, r: 44, fill: '#f2dfae', stroke: '#8a5a1c', 'stroke-width': 4 }), g, t]);
  }
  function flagArt(key) {
    var col = { bandera_roja: '#b3261e', bandera_negra: '#14141c', bandera_azul: '#1d4fa8' }[key] || '#555';
    var mark;
    if (key === 'bandera_negra') mark = s('g', { fill: '#f4efe2' }, [s('circle', { cx: 50, cy: 38, r: 13 }), s('rect', { x: 42, y: 48, width: 16, height: 9, rx: 2 }), s('circle', { cx: 45, cy: 37, r: 3.2, fill: col }), s('circle', { cx: 55, cy: 37, r: 3.2, fill: col })]);
    else if (key === 'bandera_roja') mark = s('path', { d: 'M50 22 V58 M40 32 H60 M34 48 Q50 64 66 48', fill: 'none', stroke: '#f4efe2', 'stroke-width': 5, 'stroke-linecap': 'round' });
    else mark = s('path', { d: 'M50 20 L55 36 L72 36 L58 46 L63 62 L50 52 L37 62 L42 46 L28 36 L45 36 Z', fill: '#f4efe2' });
    return svg('0 0 100 84', 'om-art-svg', [s('rect', { x: 8, y: 6, width: 4, height: 76, fill: '#5b3513' }), s('rect', { x: 12, y: 8, width: 82, height: 54, rx: 3, fill: col, stroke: '#2b1a0c', 'stroke-width': 3 }), mark]);
  }
  function routeArt(key) {
    if (/^rumbo_/.test(key)) return arrowArt(key);
    if (/^bandera_/.test(key)) return flagArt(key);
    return null;
  }
  function anchors(n) {
    var box = h('div', { class: 'om-count', role: 'img', 'aria-label': 'Dibujo con anclas en la costa' });
    var pos = [[8, 62], [24, 30], [40, 66], [56, 28], [70, 60], [84, 34], [18, 82], [62, 82], [90, 74]];
    for (var i = 0; i < n; i++) {
      var a = use('i-anchor', 'op-ic om-anchor'); a.style.left = pos[i][0] + '%'; a.style.top = pos[i][1] + '%'; box.appendChild(a);
    }
    return box;
  }

  // retrato de un cartel: se dibuja desde los rasgos (lista blanca), así la imagen siempre coincide con el texto
  function portrait(t) {
    var hairCol = { black: '#1a1412', red: '#a8381c', blond: '#d9ad3a', white: '#e9e4d6' }[t.hair];
    var hatCol = { red: '#b3261e', blue: '#1d4fa8', black: '#1a1a22' }[t.hat];
    var k = [];
    k.push(s('path', { d: 'M14 140 Q14 104 60 98 Q106 104 106 140 Z', fill: '#6b3b1b' }));
    k.push(s('rect', { x: 50, y: 86, width: 20, height: 18, fill: '#d4a173' }));
    k.push(s('path', { d: 'M30 66 Q28 28 60 28 Q92 28 90 66 Q86 46 60 46 Q34 46 30 66 Z', fill: hairCol }));
    k.push(s('ellipse', { cx: 60, cy: 68, rx: 28, ry: 31, fill: '#e2b184' }));
    k.push(s('path', { d: 'M32 60 Q34 40 60 40 Q86 40 88 60 Q80 48 60 48 Q40 48 32 60 Z', fill: hairCol }));
    if (t.beard === 'full') k.push(s('path', { d: 'M32 72 Q34 106 60 108 Q86 106 88 72 Q80 92 60 92 Q40 92 32 72 Z', fill: hairCol }));
    if (t.beard === 'goatee') k.push(s('ellipse', { cx: 60, cy: 98, rx: 9, ry: 10, fill: hairCol }));
    if (t.patch !== 'none') k.push(s('path', { d: t.patch === 'left' ? 'M31 58 L89 50' : 'M31 50 L89 58', stroke: '#111', 'stroke-width': 3, fill: 'none' }));
    [48, 72].forEach(function (x) {
      var side = x === 48 ? 'left' : 'right';
      if (t.patch === side) k.push(s('ellipse', { cx: x, cy: 66, rx: 9, ry: 8, fill: '#111' }));
      else k.push(s('circle', { cx: x, cy: 66, r: 3.4, fill: '#1a1210' }));
    });
    k.push(s('path', { d: 'M50 83 Q60 89 70 83', stroke: '#6b2a1a', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round' }));
    if (t.scar !== 'none') {
      var x = t.scar === 'left' ? 40 : 80, d = t.scar === 'left' ? 1 : -1;
      k.push(s('path', { d: 'M' + x + ' 68 L' + (x + 8 * d) + ' 92 M' + (x - 3) + ' 74 L' + (x + 3) + ' 76 M' + (x + 1 * d) + ' 82 L' + (x + 7 * d) + ' 84', stroke: '#9c2a2a', 'stroke-width': 2.6, fill: 'none', 'stroke-linecap': 'round' }));
    }
    if (t.hat !== 'none') {
      k.push(s('path', { d: 'M30 44 Q30 12 60 12 Q90 12 90 44 Z', fill: hatCol, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 2 }));
      k.push(s('ellipse', { cx: 60, cy: 44, rx: 42, ry: 9, fill: hatCol, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 2 }));
      k.push(s('path', { d: 'M31 38 Q60 46 89 38', stroke: 'rgba(0,0,0,.4)', 'stroke-width': 4, fill: 'none' }));
    }
    return svg('0 0 120 140', 'om-portrait', k);
  }

  // caracol de comunicaciones (ilustración vectorial provisional)
  function snail() {
    return svg('0 0 250 200', 'om-snail', [
      s('defs', {}, [s('radialGradient', { id: 'omShell', cx: '40%', cy: '35%', r: '75%' }, [s('stop', { offset: 0, 'stop-color': '#ffe9a3' }), s('stop', { offset: 0.6, 'stop-color': '#e3a93b' }), s('stop', { offset: 1, 'stop-color': '#9b5d12' })])]),
      s('path', { d: 'M10 172 Q8 150 40 150 L206 150 Q242 150 242 174 Q242 188 220 188 L30 188 Q10 188 10 172 Z', fill: '#9ec27e', stroke: '#4d6b34', 'stroke-width': 3 }),
      s('path', { d: 'M16 160 Q4 118 30 98 Q46 90 52 110 Q58 138 56 156 Z', fill: '#9ec27e', stroke: '#4d6b34', 'stroke-width': 3 }),
      s('path', { d: 'M30 98 L22 66 M44 96 L52 64', stroke: '#4d6b34', 'stroke-width': 9, 'stroke-linecap': 'round' }),
      s('path', { d: 'M30 98 L22 66 M44 96 L52 64', stroke: '#9ec27e', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
      s('circle', { cx: 22, cy: 62, r: 9, fill: '#fff', stroke: '#4d6b34', 'stroke-width': 2.5 }), s('circle', { cx: 52, cy: 60, r: 9, fill: '#fff', stroke: '#4d6b34', 'stroke-width': 2.5 }),
      s('circle', { cx: 24, cy: 63, r: 3.6, fill: '#1a1210' }), s('circle', { cx: 54, cy: 61, r: 3.6, fill: '#1a1210' }),
      s('path', { d: 'M24 128 Q34 138 46 128', stroke: '#2f4a1f', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }),
      s('circle', { cx: 150, cy: 100, r: 62, fill: 'url(#omShell)', stroke: '#6d3f08', 'stroke-width': 4 }),
      s('circle', { cx: 150, cy: 100, r: 44, fill: 'none', stroke: '#7a4a05', 'stroke-width': 3, 'stroke-dasharray': '150 40' }),
      s('circle', { cx: 150, cy: 100, r: 27, fill: 'none', stroke: '#7a4a05', 'stroke-width': 3, 'stroke-dasharray': '90 30' }),
      s('circle', { cx: 150, cy: 100, r: 11, fill: '#7a4a05' }),
      s('rect', { x: 128, y: 24, width: 44, height: 16, rx: 8, fill: '#5a3413', stroke: '#2b1a0c', 'stroke-width': 2.5 }),
      s('circle', { cx: 130, cy: 32, r: 9, fill: '#3b2209' }), s('circle', { cx: 170, cy: 32, r: 9, fill: '#3b2209' }),
      s('path', { d: 'M150 40 V50', stroke: '#2b1a0c', 'stroke-width': 4 })
    ]);
  }

  // glifos del Poneglyph (formas propias, lista blanca g1..g13)
  var GLYPHS = {
    g1: 'M20 6 L34 32 H6 Z', g2: 'M20 20 m-12 0 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 M20 6 V34', g3: 'M10 6 V34 H30',
    g4: 'M20 5 L34 20 L20 35 L6 20 Z', g5: 'M20 20 m-12 0 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 M20 20 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
    g6: 'M27 6 A14 14 0 1 0 27 34 A10 10 0 1 1 27 6 Z', g7: 'M6 10 L15 30 L23 10 L32 30', g8: 'M6 10 H34 M20 10 V34',
    g9: 'M8 8 H32 V32 H8 Z', g10: 'M4 22 Q12 8 20 22 T36 22', g11: 'M13 6 V34 M27 6 V34', g12: 'M20 5 V35 M5 20 H35 M10 10 L30 30',
    g13: 'M7 9 H33 V22 L20 35 L7 22 Z M20 13 V23 M20 28 H20.1'
  };
  function glyph(id, cls) {
    var p = GLYPHS[id];
    var sv = svg('0 0 40 40', cls || 'om-glyph', []);
    sv.setAttribute('fill', 'none'); sv.setAttribute('stroke', 'currentColor'); sv.setAttribute('stroke-width', '3.4'); sv.setAttribute('stroke-linecap', 'round'); sv.setAttribute('stroke-linejoin', 'round');
    sv.appendChild(p ? s('path', { d: p }) : s('path', { d: 'M12 12 H28 V28 H12 Z M16 20 H24' }));
    return sv;
  }

  // ---------- piezas reutilizables ----------
  function noteList(items) {
    var ul = h('ul', { class: 'om-notes' });
    items.forEach(function (t) { ul.appendChild(h('li', {}, [use('i-scroll', 'op-ic'), h('span', { text: t })])); });
    return ul;
  }
  // grupo de opciones seleccionables (radiogroup accesible con flechas)
  function choiceGroup(label, count, buildCard, ctx) {
    var wrap = h('div', { class: 'om-options om-n' + count, role: 'radiogroup', 'aria-label': label });
    var btns = [], picked = -1;
    function pick(i, focus) {
      picked = i;
      btns.forEach(function (b, j) {
        var on = j === i;
        b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('data-selected', on ? 'true' : 'false'); b.tabIndex = on || (i < 0 && j === 0) ? 0 : -1;
      });
      if (focus) btns[i].focus();
      ctx.change(i, btns[i]);
    }
    for (var i = 0; i < count; i++) {
      (function (i) {
        var b = buildCard(i);
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false'); b.setAttribute('data-selected', 'false'); b.type = 'button'; b.tabIndex = i === 0 ? 0 : -1;
        b.appendChild(h('span', { class: 'om-tick', 'aria-hidden': 'true' }, [use('i-check', 'op-ic')]));
        b.addEventListener('click', function () { pick(i, false); });
        b.addEventListener('keydown', function (e) {
          var k = e.key;
          if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); pick((i + 1) % count, true); }
          else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); pick((i - 1 + count) % count, true); }
        });
        btns.push(b); wrap.appendChild(b);
      })(i);
    }
    return wrap;
  }
  // bytes UTF-8 y caracteres de control: reglas del contrato del servidor (la correctitud NUNCA se decide aquí)
  function utf8Len(str) { try { return new TextEncoder().encode(str).length; } catch (e) { return str.length * 4; } }
  function answerFormatError(v) {
    if (typeof v !== 'string' || !v) return 'Escribe una respuesta.';
    if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) return 'La respuesta tiene caracteres no válidos.';
    if (utf8Len(v) > MAX_ANSWER_BYTES) return 'La respuesta es demasiado larga (máximo ' + MAX_ANSWER_BYTES + ' bytes).';
    return null;
  }
  // campo de texto: valida el FORMATO y entrega el texto tal cual se escribió (sin los espacios de los extremos)
  function textField(cfg, labelText, ctx) {
    var id = 'omAns' + Math.floor(Math.random() * 1e6);
    var input = h('input', { type: 'text', id: id, class: 'om-input', maxlength: (isInt(cfg.max_length) && cfg.max_length >= 1 && cfg.max_length <= MAX_ANSWER_BYTES) ? cfg.max_length : MAX_ANSWER_BYTES, placeholder: cfg.placeholder, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-describedby': id + 'e' });
    var err = h('p', { class: 'om-field-err', id: id + 'e', role: 'alert', hidden: true });
    input.addEventListener('input', function () {
      var v = input.value.trim();
      if (!v) { err.hidden = true; ctx.change(null); return; }
      var e = answerFormatError(v);
      if (e) { err.textContent = e; err.hidden = false; ctx.change(null); return; }
      err.hidden = true; ctx.change(v);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var b = document.getElementById('omConfirm'); if (b && !b.disabled) b.click(); } });
    return h('div', { class: 'om-field' }, [h('label', { for: id, text: labelText }), input, err]);
  }

  // ---------- componentes por tipo: devuelven { el, afterConfirm?() } ----------
  var RENDER = {};

  RENDER.treasure_map = function (p, ctx) {
    var pins = [], map = svg('0 0 640 170', 'om-mapsvg', [
      s('path', { d: 'M40 120 C140 40 210 150 300 80 S500 130 600 50', fill: 'none', stroke: '#7a4a05', 'stroke-width': 4, 'stroke-dasharray': '3 11', 'stroke-linecap': 'round' }),
      s('circle', { cx: 585, cy: 124, r: 20, fill: 'none', stroke: '#7a4a05', 'stroke-width': 3 }),
      s('path', { d: 'M585 100 L591 124 L585 148 L579 124 Z M561 124 L585 118 L609 124 L585 130 Z', fill: '#7a4a05' })
    ]);
    [[90, 96], [310, 76], [520, 108]].forEach(function (xy, i) {
      var g = s('g', { 'class': 'om-pin', transform: 'translate(' + xy[0] + ' ' + xy[1] + ')' }, [
        s('circle', { r: 17, fill: '#f6e3ae', stroke: '#7a4a05', 'stroke-width': 3 }),
        s('path', { 'class': 'om-pin-x', d: 'M-9 -9 L9 9 M9 -9 L-9 9', stroke: '#b3261e', 'stroke-width': 5, 'stroke-linecap': 'round' })
      ]);
      var t = s('text', { 'class': 'om-pin-n', y: 6, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 800, fill: '#3a2008' }); t.textContent = 'ABC'.charAt(i); g.appendChild(t);
      pins.push(g); map.appendChild(g);
    });
    var picked = h('p', { class: 'om-picked', 'aria-live': 'polite' });
    var group = choiceGroup('Destinos del mapa', 3, function (i) {
      var o = p.options[i];
      return h('button', { class: 'om-card om-dest' }, [
        h('span', { class: 'om-badge-n', text: 'ABC'.charAt(i) }), islandArt(o.art_key),
        h('strong', { text: o.label }), o.caption ? h('small', { text: o.caption }) : null
      ]);
    }, { change: function (i) {
      pins.forEach(function (g, j) { g.setAttribute('data-on', j === i ? 'true' : 'false'); });
      picked.textContent = 'Destino elegido: ' + p.options[i].label;
      ctx.change({ option_id: p.options[i].id }, 'Confirmar destino');
    } });
    return { el: h('div', { class: 'om-board om-treasure' }, [
      h('div', { class: 'om-map' }, [map]), h('p', { class: 'om-intro', text: p.intro }), noteList(p.clues), group, picked
    ]) };
  };

  RENDER.den_den_mushi = function (p, ctx) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var table = null;
    if (p.shift) {
      table = h('div', { class: 'om-cipher', role: 'img', 'aria-label': 'Tabla de descifrado: cada letra del mensaje se lee ' + p.shift + ' lugares antes en el alfabeto' });
      for (var i = 0; i < 26; i++) table.appendChild(h('span', { class: 'om-cell' }, [h('b', { text: A[(i + p.shift) % 26] }), h('i', { text: A[i] })]));
      table = h('div', { class: 'om-cipher-wrap' }, [h('p', { class: 'om-cipher-cap', text: 'Letra del mensaje (arriba) → se lee como (abajo)' }), table]);
    }
    return { el: h('div', { class: 'om-board om-den' }, [
      h('div', { class: 'om-den-top' }, [
        snail(),
        h('div', { class: 'om-bubble' }, [h('small', { text: 'Mensaje secreto' }), h('p', { class: 'om-msg', text: p.message, 'aria-label': 'Mensaje cifrado: ' + p.message.split('').join(' ') })])
      ]),
      h('p', { class: 'om-intro', text: p.intro }),
      h('div', { class: 'om-hint' }, [use('i-compass', 'op-ic'), h('p', {}, [h('b', { text: 'Pista: ' }), p.hint])]),
      table,
      textField(p.answer, 'Mensaje descifrado', { change: function (v) { ctx.change(v ? { text: v } : null, 'Confirmar respuesta'); } })
    ]) };
  };

  RENDER.wanted_posters = function (p, ctx) {
    var picked = h('p', { class: 'om-picked', 'aria-live': 'polite' });
    var group = choiceGroup('Carteles de recompensa', p.options.length, function (i) {
      var o = p.options[i];
      return h('button', { class: 'om-card om-poster', 'aria-label': 'Cartel de ' + o.name }, [
        h('span', { class: 'om-poster-h', text: 'SE BUSCA' }), portrait(o.traits), h('strong', { text: o.name }),
        o.bounty ? h('small', { class: 'om-bounty', text: 'Recompensa: ' + o.bounty }) : null, noteList(o.notes)
      ]);
    }, { change: function (i) { picked.textContent = 'Cartel elegido: ' + p.options[i].name; ctx.change({ option_id: p.options[i].id }, 'Confirmar cartel'); } });
    return { el: h('div', { class: 'om-board om-wanted' }, [
      h('p', { class: 'om-intro', text: p.intro }), h('div', { class: 'om-hint om-hint-big' }, [use('i-scroll', 'op-ic'), h('p', { text: p.clue })]), group, picked
    ]) };
  };

  RENDER.poneglyph = function (p, ctx) {
    var slab = h('div', { class: 'om-slab', role: 'img', 'aria-label': 'Piedra con ' + p.symbols.length + ' símbolos grabados' });
    p.symbols.forEach(function (g) { slab.appendChild(h('span', { class: 'om-slab-g' }, [glyph(g)])); });
    var key = h('ul', { class: 'om-key', 'aria-label': 'Clave de descifrado' });
    p.key.forEach(function (k) { key.appendChild(h('li', {}, [glyph(k.glyph, 'om-glyph om-glyph-s'), h('b', { text: '=' }), h('span', { text: k.letter })])); });
    return { el: h('div', { class: 'om-board om-poneglyph' }, [
      h('p', { class: 'om-intro', text: p.intro }),
      h('div', { class: 'om-pg-grid' }, [
        h('div', { class: 'om-stone' }, [slab]),
        h('div', { class: 'om-keybox' }, [h('small', { text: 'Clave de descifrado' }), key])
      ]),
      textField(p.answer, 'Palabra descifrada', { change: function (v) { ctx.change(v ? { text: v } : null, 'Confirmar solución'); } })
    ]) };
  };

  RENDER.grand_line_route = function (p, ctx, state) {
    // `state` = { total, current, completed, stage, intro } y se re-renderiza al avanzar (en demo) o al recibir datos nuevos del servidor
    var nodes = h('ol', { class: 'om-route', 'aria-label': 'Progreso de la ruta' });
    for (var n = 1; n <= p.total; n++) {
      var st = n <= p.completed ? 'done' : n === p.current ? 'current' : 'locked';
      nodes.appendChild(h('li', { 'data-state': st, 'aria-current': st === 'current' ? 'step' : null }, [
        h('span', { class: 'om-route-dot' }, [st === 'done' ? use('i-check', 'op-ic') : st === 'locked' ? use('i-lock', 'op-ic') : document.createTextNode(String(n))]),
        h('small', { text: 'Etapa ' + n + '/' + p.total })
      ]));
    }
    var body = h('div', { class: 'om-stage' });
    var stage = p.stage;
    if (stage) {
      body.appendChild(h('h3', { class: 'om-stage-t', text: stage.title }));
      body.appendChild(h('p', { class: 'om-intro', text: stage.prompt }));
      if (stage.visual) body.appendChild(anchors(stage.visual.count));
      if (stage.kind === 'choice') {
        var picked = h('p', { class: 'om-picked', 'aria-live': 'polite' });
        body.appendChild(choiceGroup(stage.title, stage.options.length, function (i) {
          var o = stage.options[i], art = routeArt(o.art_key);
          return h('button', { class: 'om-card om-opt' }, [art, h('strong', { text: o.label }), o.caption ? h('small', { text: o.caption }) : null]);
        }, { change: function (i) { picked.textContent = 'Elegiste: ' + stage.options[i].label; ctx.change({ stage: stage.stage_number, option_id: stage.options[i].id }, 'Confirmar etapa ' + stage.stage_number); } }));
        body.appendChild(picked);
      } else {
        body.appendChild(textField(stage.answer, 'Tu respuesta', { change: function (v) { ctx.change(v ? { stage: stage.stage_number, text: v } : null, 'Confirmar etapa ' + stage.stage_number); } }));
      }
    } else {
      body.appendChild(h('p', { class: 'om-muted', text: 'El contenido de esta etapa aún no está publicado.' }));
    }
    return { el: h('div', { class: 'om-board om-routeboard' }, [
      h('p', { class: 'om-intro', text: p.intro }),
      h('div', { class: 'om-route-head' }, [h('b', { class: 'om-route-count', text: 'Etapa ' + p.current + '/' + p.total }), h('small', { text: 'Sin XP por etapa: la misión otorga su XP solo al terminar la ruta.' })]),
      nodes, body
    ]) };
  };

  // ---------- envío de respuestas (Fase 7D: preparado, APAGADO con ANSWERS_ENABLED=false) ----------
  var SENDING = false, FLASH = null, cooldownTimer = null;
  function clearCooldown() { if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; } }
  function fmtUnlock(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
    try {
      var d = new Date(iso); if (isNaN(d.getTime())) return null;
      return d.toLocaleString('es', { timeZone: 'America/New_York', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) { return null; }   // solo para MOSTRAR: la apertura la decide el servidor
  }
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Traduce la selección a la respuesta de TEXTO que pide el contrato. NO decide si es correcta.
  //   treasure_map / wanted_posters / opción de ruta -> el id de la opción elegida; den_den_mushi / poneglyph / texto de ruta -> el texto escrito.
  function toSubmission(view, a) {
    var text = (a && typeof a.option_id === 'string') ? a.option_id : (a && typeof a.text === 'string' ? a.text : null);
    var step = (a && isInt(a.stage)) ? a.stage : 1;
    if (text === null || answerFormatError(text) || !UUID_RE.test(String(view.id)) || step < 1 || step > 50) return null;
    return { mission_id: view.id, step_number: step, answer: text };   // exactamente estas 3 claves: nunca profile_id
  }
  function functionUrl() {
    // Usa la configuración pública existente; fallback al origen del mismo cliente Supabase Auth.
    // No incluye llaves ni acepta dominios arbitrarios.
    var client = getClient();
    var b = window.GEOARMY_SUPABASE_URL;
    if (typeof b !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(b)) {
      b = client && client.supabaseUrl;
    }
    return (typeof b === 'string' && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(b)) ? b + '/functions/v1/' + SUBMIT_FN : null;
  }
  function say(ui, kind, text, node) {
    ui.feedback.setAttribute('data-kind', kind); ui.feedback.textContent = text;
    if (node) ui.feedback.appendChild(node);
  }
  function cooldown(ui, secs, text) {
    clearCooldown(); var left = secs; ui.btn.disabled = true;
    (function tick() {
      if (left <= 0) { ui.btn.disabled = !confirmCfg; say(ui, 'info', 'Ya puedes intentarlo de nuevo.'); return; }
      say(ui, 'warn', text + (secs ? ' Reintenta en ' + left + ' s.' : '')); left--; cooldownTimer = setTimeout(tick, 1000);
    })();
  }
  function intOf(v) { return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 1000000) ? v : null; }
  function refresh(flash) { FLASH = flash || null; loadReal(); }   // el servidor dice cuál es la etapa siguiente: se vuelve a leer el catálogo

  async function submitAnswer(view, a, ui) {
    if (!ANSWERS_ENABLED || SENDING) return;
    var sub = toSubmission(view, a), url = functionUrl(), client = getClient();
    if (!sub || !url || !client) { say(ui, 'error', 'No pudimos preparar el envío. Recarga la página e inténtalo de nuevo.'); return; }
    SENDING = true; ui.btn.disabled = true; say(ui, 'info', 'Enviando…');
    var token = null;
    try { var sr = await withTimeout(client.auth.getSession(), RPC_TIMEOUT_MS); token = sr && sr.data && sr.data.session && sr.data.session.access_token; } catch (e) { token = null; }
    if (!token) {
      SENDING = false; ui.btn.disabled = !confirmCfg;
      var lb = h('button', { type: 'button', class: 'op-btn op-btn-ghost op-btn-sm', text: 'Iniciar sesión' }); lb.addEventListener('click', openLogin);
      say(ui, 'error', 'Tu sesión venció. Inicia sesión de nuevo.', lb); return;
    }
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, SUBMIT_TIMEOUT_MS);
    var res = null, data = null;
    try {
      res = await fetch(url, {
        method: 'POST', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },   // sin apikey, sin ids de usuario
        body: JSON.stringify(sub)
      });
      try { data = await res.json(); } catch (e) { data = null; }
    } catch (e) {
      clearTimeout(timer); SENDING = false; ui.btn.disabled = !confirmCfg;
      say(ui, 'error', 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'); return;
    }
    clearTimeout(timer); SENDING = false;
    handleResult(view, res.status, data, ui);
  }

  function handleResult(view, status, data, ui) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    ui.btn.disabled = !confirmCfg;
    if (d.ok === true && typeof d.result === 'string') {
      var done = intOf(d.completed_steps), tot = intOf(d.total_steps), xa = intOf(d.xp_added), xt = intOf(d.xp_total), lv = intOf(d.level), vb = intOf(d.vbucks_credited);
      var bits = [];
      if (xa) bits.push('+' + xa + ' XP'); if (xt !== null) bits.push('Total: ' + xt + ' XP'); if (lv) bits.push('Nivel ' + lv); if (vb) bits.push(vb + ' VBUCKS acreditados');
      switch (d.result) {
        case 'incorrect':
          say(ui, 'warn', 'Esa respuesta no es correcta. Revisa las pistas e inténtalo de nuevo (hay un límite de intentos por etapa).'); return;
        case 'step_completed':
          return refresh({ kind: 'ok', text: 'Etapa completada' + (done !== null && tot ? ' (' + done + '/' + tot + ')' : '') + '. ' + 'La ruta continúa.' });
        case 'mission_completed':
          return refresh({ kind: 'ok', text: 'Misión completada' + (bits.length ? ' · ' + bits.join(' · ') : '') });
        case 'step_already_completed':
        case 'already_completed':
          return refresh({ kind: 'info', text: 'Ya habías completado esto. Mostramos tu progreso actual.' });
        default:
          say(ui, 'error', 'Recibimos una respuesta inesperada del servidor.'); return;
      }
    }
    var code = typeof d.error === 'string' ? d.error : '';
    switch (code) {
      case 'unauthorized': {
        var lb = h('button', { type: 'button', class: 'op-btn op-btn-ghost op-btn-sm', text: 'Iniciar sesión' }); lb.addEventListener('click', openLogin);
        say(ui, 'error', 'Tu sesión venció. Inicia sesión de nuevo.', lb); return; }
      case 'no_pass': say(ui, 'error', 'Necesitas el Mini Pase Pirata para responder misiones.'); return;
      case 'profile_not_found': say(ui, 'error', 'No encontramos tu perfil de GeoArmy.'); return;
      case 'not_available': return refresh({ kind: 'info', text: 'Esta misión ya no está disponible.' });
      case 'previous_step_required': return refresh({ kind: 'info', text: 'Primero hay que completar la etapa anterior.' });
      case 'rate_limited': {
        var ra = intOf(d.retry_after_sec);
        cooldown(ui, (ra && ra <= 3600) ? Math.min(ra, 3600) : 10, ra ? 'Demasiados intentos.' : 'Demasiados intentos en esta etapa. Espera un momento.'); return; }
      case 'invalid_request': say(ui, 'error', 'El servidor no aceptó esa respuesta. Revisa que sea válida.'); return;
      case 'service_unavailable': say(ui, 'error', 'El servicio no está disponible ahora. Inténtalo de nuevo en unos minutos.'); return;
      default: say(ui, 'error', 'Ocurrió un error inesperado. Inténtalo más tarde.'); return;
    }
  }

  // ---------- estado y shell ----------
  var V = null;           // vista actual
  var demoList = null;
  var demoState = { stageIdx: 0, mode: 'available' };
  var confirmCfg = null;  // { answer, label }

  function root() { return $('opRoot'); }
  function stageEl() { return $('omStage'); }

  function panel(icon, title, text, extra) {
    return h('div', { class: 'om-state' }, [use(icon, 'op-ic om-state-ico'), h('h2', { text: title }), text ? h('p', { text: text }) : null, extra]);
  }
  function backLink(chap, label) {
    return h('a', { class: 'op-btn op-btn-ghost op-btn-sm', href: backHref(chap), text: label || 'Volver al capítulo' });
  }

  function renderShell(view) {
    V = view;
    var r = stageEl(); clear(r); clearCooldown(); SENDING = false;
    var chap = view.chapter_number;
    if (FLASH) { r.appendChild(h('div', { class: 'om-flash', 'data-kind': FLASH.kind, role: 'status' }, [use(FLASH.kind === 'ok' ? 'i-check' : 'i-anchor', 'op-ic'), h('span', { text: FLASH.text })])); FLASH = null; }
    // cabecera
    var top = $('omHead'); clear(top);
    var cname = view.chapter_title || CHAPTER_NAME[chap] || 'Capítulo';
    top.appendChild(h('div', { class: 'om-crumbs' }, [
      h('a', { class: 'om-back', href: backHref(chap) }, [use('i-anchor', 'op-ic'), h('span', { text: 'Volver al capítulo ' + (isInt(chap) ? cname : '') })]),
      h('span', { class: 'om-crumb-sep', text: '›' }), h('span', { class: 'om-crumb', text: 'Mini Pase Pirata' })
    ]));
    if (view.status === 'locked') {
      top.appendChild(h('h1', { class: 'om-title', text: 'Misión bloqueada' }));
      document.title = 'Misión bloqueada — Mini Pase Pirata · GeoArmy';
    } else {
      top.appendChild(h('p', { class: 'op-plank' }, [h('span', { text: (isInt(chap) ? 'Capítulo ' + chap + ' · ' : '') + cname })]));
      top.appendChild(h('h1', { class: 'om-title', text: view.title }));
      var meta = h('ul', { class: 'om-meta' });
      meta.appendChild(h('li', { class: 'om-xp' }, [use('i-vcoin', 'op-ic'), h('span', {}, [h('b', { text: 'Hasta +' + (isInt(view.xp_reward) ? view.xp_reward : 75) + ' XP' }), h('small', { text: 'según límite de temporada' })])]));
      var stTxt = { available: 'Pendiente', completed: 'Completada', pending: 'Pendiente' }[view.status] || 'Pendiente';
      meta.appendChild(h('li', { class: 'om-status', 'data-status': view.status }, [use(view.status === 'completed' ? 'i-check' : 'i-anchor', 'op-ic'), h('span', { text: stTxt })]));
      if (TYPE_LABEL[view.type]) meta.appendChild(h('li', { class: 'om-type' }, [use('i-map', 'op-ic'), h('span', { text: TYPE_LABEL[view.type] })]));
      top.appendChild(meta);
      document.title = view.title + ' — Mini Pase Pirata · GeoArmy';
    }
    // cuerpo
    if (view.status === 'locked') {
      var when = fmtUnlock(view.unlocks_at);
      r.appendChild(panel('i-lock', 'Esta misión no está disponible', when ? 'Se abre el ' + when + ' (hora de Nueva York).' : 'El servidor la habilitará cuando corresponda. No se muestra su contenido.', backLink(chap)));
      return;
    }
    if (view.status === 'completed') {
      r.appendChild(panel('i-check', 'Misión completada', 'Ya cobraste la XP de esta misión.', backLink(chap, 'Volver al capítulo')));
      return;
    }
    var payload = null, type = view.type;
    if (view.payload) { try { payload = VALIDATE[type](view.payload); } catch (e) { payload = null; } }
    if (!view.payload) { r.appendChild(panel('i-scroll', 'El desafío todavía no está publicado', view.description || 'Vuelve más tarde: aquí aparecerán las pistas y la forma de responder.', backLink(chap))); return; }
    if (TYPES.indexOf(type) < 0) { r.appendChild(panel('i-skull', 'Tipo de desafío no reconocido', 'Esta misión usa un formato que la página aún no soporta.', backLink(chap))); return; }
    if (!payload) { r.appendChild(panel('i-skull', 'No pudimos mostrar este desafío', 'Los datos del desafío no tienen el formato esperado.', backLink(chap))); return; }

    // desafío disponible
    confirmCfg = null;
    var feedback = h('div', { class: 'om-feedback', id: 'omFeedback', role: 'status', 'aria-live': 'polite' });
    var confirmBtn = h('button', { type: 'button', class: 'op-btn op-btn-gold', id: 'omConfirm', text: 'Confirmar selección', disabled: true });
    var ctx = { change: function (answer, label) {
      if (SENDING) return;
      clearCooldown();
      confirmCfg = answer ? { answer: answer } : null;
      if (label) confirmBtn.textContent = label;
      confirmBtn.disabled = !answer; feedback.textContent = ''; feedback.removeAttribute('data-kind');
    } };
    var comp = RENDER[type](payload, ctx);
    var wrap = h('div', { class: 'om-challenge' }, [comp.el]);
    var notice = view.demo
      ? 'Demo: tu selección solo se anota en pantalla. No se envía, no se verifica y no otorga XP.'
      : (ANSWERS_ENABLED ? '' : 'El envío de respuestas todavía no está habilitado.');
    var actions = h('div', { class: 'om-actions' }, [confirmBtn, notice ? h('p', { class: 'om-notice', text: notice }) : null, feedback]);
    wrap.appendChild(actions);
    r.appendChild(wrap);
    confirmBtn.addEventListener('click', function () {
      if (!confirmCfg || SENDING) return;
      feedback.setAttribute('data-kind', 'info');
      if (view.demo) {
        // Demo: solo se anota la selección. No hay red, no hay XP, no hay veredicto.
        feedback.textContent = 'Selección anotada en la demo. Nada se envió ni se verificó.';
        if (type === 'grand_line_route') advanceDemoRoute();
      } else if (!ANSWERS_ENABLED) {
        // Circuito apagado: ninguna petición sale del navegador.
        feedback.textContent = 'Tu selección no se envió: las respuestas aún no están habilitadas.';
      } else {
        submitAnswer(view, confirmCfg.answer, { btn: confirmBtn, feedback: feedback });
      }
    });
  }

  // ---------- demo ----------
  function loadFixtures() {
    return new Promise(function (resolve) {
      if (window.OP_MISSION_FIXTURES) return resolve(window.OP_MISSION_FIXTURES);
      var sc = document.createElement('script');
      sc.src = 'js/onepiece-mision-fixtures.js?v=7c1'; sc.onload = function () { resolve(window.OP_MISSION_FIXTURES || null); }; sc.onerror = function () { resolve(null); };
      document.head.appendChild(sc);
    });
  }
  function demoView(fx) {
    var v = { id: fx.id, code: fx.code, type: fx.type, title: fx.title, xp_reward: fx.xp_reward, chapter_number: fx.chapter_number, chapter_title: fx.chapter_title, demo: true,
      status: demoState.mode === 'locked' ? 'locked' : demoState.mode === 'completed' ? 'completed' : 'available', payload: fx.public_payload };
    if (fx.type === 'grand_line_route' && fx.demo_sequence) {
      var i = Math.min(demoState.stageIdx, fx.demo_sequence.length - 1);
      v.payload = { schema: 1, intro: fx.public_payload.intro, total_stages: 3, current_stage: i + 1, completed_stages: i, stage: fx.demo_sequence[i] };
    }
    return v;
  }
  var demoType = null;
  function advanceDemoRoute() {
    var fx = demoList.filter(function (f) { return f.type === 'grand_line_route'; })[0];
    if (!fx) return;
    var fb = $('omFeedback');
    if (demoState.stageIdx >= fx.demo_sequence.length - 1) {
      if (fb) fb.textContent = 'Ruta completada en la demo. No se otorgó XP: la demo no se conecta con el servidor.';
      var btn = $('omConfirm'); if (btn) btn.disabled = true;
      return;
    }
    demoState.stageIdx++;
    renderDemo(true);
    var fb2 = $('omFeedback'); if (fb2) { fb2.setAttribute('data-kind', 'info'); fb2.textContent = 'Etapa ' + demoState.stageIdx + ' anotada en la demo. Nada se envió ni se verificó.'; }
  }
  function renderDemo(keepNotice) {
    var fx = demoList.filter(function (f) { return f.type === demoType; })[0] || demoList[0];
    var bar = $('omDemoBar'); clear(bar);
    bar.hidden = false;
    bar.appendChild(h('p', { class: 'om-demo-tag' }, [h('b', { text: 'DEMO' }), ' Datos ficticios. Nada se envía ni se verifica y no se otorga XP.']));
    var tabs = h('div', { class: 'om-tabs', role: 'tablist', 'aria-label': 'Tipos de misión' });
    demoList.forEach(function (f) {
      var on = f.type === fx.type;
      var b = h('button', { type: 'button', class: 'om-tab', role: 'tab', 'aria-selected': on ? 'true' : 'false', text: TYPE_LABEL[f.type] || f.type });
      b.addEventListener('click', function () { demoType = f.type; demoState.stageIdx = 0; try { history.replaceState(null, '', '?demo=' + f.type); } catch (e) {} renderDemo(); });
      tabs.appendChild(b);
    });
    bar.appendChild(tabs);
    var modes = h('div', { class: 'om-modes', role: 'group', 'aria-label': 'Estado de la misión (vista previa)' }, [h('small', { text: 'Estado:' })]);
    [['available', 'Disponible'], ['locked', 'Bloqueada'], ['completed', 'Completada']].forEach(function (m) {
      var b = h('button', { type: 'button', class: 'om-mode', 'aria-pressed': demoState.mode === m[0] ? 'true' : 'false', text: m[1] });
      b.addEventListener('click', function () { demoState.mode = m[0]; renderDemo(); });
      modes.appendChild(b);
    });
    bar.appendChild(modes);
    renderShell(demoView(fx));
  }

  // ---------- modo real ----------
  function findMission(cat, key) {
    var chs = (cat && Array.isArray(cat.chapters)) ? cat.chapters : [];
    for (var i = 0; i < chs.length; i++) {
      var ms = Array.isArray(chs[i] && chs[i].missions) ? chs[i].missions : [];
      for (var j = 0; j < ms.length; j++) {
        var m = ms[j];
        if (m && ((typeof m.id === 'string' && m.id === key) || (typeof m.code === 'string' && m.code === key))) return { m: m, c: chs[i] };
      }
    }
    return null;
  }
  async function loadReal() {
    var key = param('m');
    var r = stageEl(); clear(r); r.appendChild(h('p', { class: 'om-muted', text: 'Cargando misión…' }));
    if (!key || !/^[A-Za-z0-9_-]{1,64}$/.test(key)) { renderShell({ status: 'locked', chapter_number: null }); return; }
    var client = await waitForClient(6000);
    if (!client) { showError(); return; }
    var sess;
    try { sess = await withTimeout(client.auth.getSession(), RPC_TIMEOUT_MS); } catch (e) { showError(); return; }
    var session = sess && sess.data && sess.data.session;
    if (!session) {
      var rr = stageEl(); clear(rr);
      var lb = h('button', { type: 'button', class: 'op-btn op-btn-gold', text: 'Iniciar sesión con Twitch' }); lb.addEventListener('click', openLogin);
      $('omHead').appendChild(h('div', { class: 'om-crumbs' }, [h('a', { class: 'om-back', href: 'onepiece.html#capitulos' }, [use('i-anchor', 'op-ic'), h('span', { text: 'Volver al mapa' })])]));
      rr.appendChild(panel('i-lock', 'Inicia sesión para ver la misión', 'Las misiones se muestran solo a quien tiene el pase y una sesión activa.', lb));
      return;
    }
    var res;
    try { res = await withTimeout(client.rpc('onepiece_2026_get_mission_catalog'), RPC_TIMEOUT_MS); } catch (e) { showError(); return; }
    if (!res || res.error || !res.data || typeof res.data !== 'object') { showError(); return; }
    var cat = res.data;
    var f = (cat.has_access === true) ? findMission(cat, key) : null;
    if (!f) { renderShell({ status: 'locked', chapter_number: null }); return; }   // sin pase / no publicada / no existe: mismo estado, sin contenido
    var m = f.m, c = f.c;
    var status = m.completed === true ? 'completed' : (m.available === true ? 'available' : 'locked');
    renderShell({
      id: m.id, code: m.code, type: typeof m.type === 'string' ? m.type : '', title: typeof m.title === 'string' && m.title ? m.title : 'Misión',
      description: typeof m.description === 'string' ? m.description : '', xp_reward: m.xp_reward, chapter_number: isInt(c.chapter_number) ? c.chapter_number : null,
      chapter_title: (typeof c.title === 'string' && c.title.trim()) ? c.title : null, status: status,
      unlocks_at: typeof m.unlocks_at === 'string' ? m.unlocks_at : null,
      payload: (m.public_payload && typeof m.public_payload === 'object') ? m.public_payload : null, demo: false
    });
  }
  function showError() {
    var r = stageEl(); clear(r);
    var rb = h('button', { type: 'button', class: 'op-btn op-btn-gold op-btn-sm', text: 'Reintentar' }); rb.addEventListener('click', loadReal);
    r.appendChild(panel('i-skull', 'No pudimos cargar la misión', 'Revisa tu conexión e inténtalo de nuevo.', h('div', { class: 'om-row' }, [rb, backLink(null, 'Volver al mapa')])));
  }

  function init() {
    if (!root()) return;
    var demo = param('demo');
    if (demo !== null && DEMO_ENABLED) {
      demoType = TYPES.indexOf(demo) >= 0 ? demo : TYPES[0];
      loadFixtures().then(function (list) {
        if (!Array.isArray(list) || !list.length) { var r = stageEl(); clear(r); r.appendChild(panel('i-skull', 'No hay datos de demo', 'Falta js/onepiece-mision-fixtures.js.', backLink(null, 'Volver al mapa'))); return; }
        demoList = list; renderDemo();
      });
      return;
    }
    loadReal();
    waitForClient(6000).then(function (c) {
      if (c && c.auth && typeof c.auth.onAuthStateChange === 'function') c.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(function () { $('omHead') && clear($('omHead')); loadReal(); }, 0); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
