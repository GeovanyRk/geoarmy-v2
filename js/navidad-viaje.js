/* ==========================================================================
   GEO ARMY — Viaje de Santa · lógica de presentación (solo frontend visual)
   --------------------------------------------------------------------------
   · No escribe en Supabase, no acredita premios ni revela ganadores.
   · La FASE (preparación / recorrido / completado) sale de la fecha oficial
     (24 y 25 de diciembre, hora del Este). Hoy se usa el reloj del navegador; cuando se conecte
     el backend se sincroniza con la hora del servidor (applyServerData → serverNow).
   · El horario de llegada a cada país NO existe todavía: sin datos del servidor la página NO inventa
     posiciones, tiempos ni países visitados durante el recorrido real ("por sincronizar").
   · Para REVISAR el diseño hay una vista previa explícita y etiquetada (?preview=prep|ruta|fin,
     opcional &paso=N y &ritmo=segundos). Usa datos de ejemplo y muestra un aviso visible.

   CÓMO SE CONECTARÁ EL BACKEND (sin tocar el diseño):
     GeoArmyViaje.applyServerData({
       serverNow: '2026-12-24T14:00:00Z',                         // hora oficial del servidor
       destinations: [{ code:'KR', order:2, arrives_at:'…ISO…' }, …],  // países registrados, en orden de visita
       user: { country:'MX', eligible:true }                       // país del usuario (o country:null)
     });
   Un país nuevo solo necesita su entrada en CATALOG (nombre, bandera en assets/navidad/banderas/,
   posición en js/navidad-viaje-geo.js) para aparecer en el mapa.
   ========================================================================== */
(function () {
  'use strict';
  const GEO = window.GA_VIAJE_GEO; if (!GEO) return;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const W = GEO.w, H = GEO.h, FLAGS = 'assets/navidad/banderas/';
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Catálogo visual (geometría de interfaz; el servidor decide qué países participan) ---------- */
  /* tz = huso horario (para el orden provisional: la medianoche llega primero al este), lon = longitud de la sede.
     lab = [x, y, lado] posición de la etiqueta en el mapa de 1440×694 ('r' = a la derecha del punto, 'l' = a la izquierda). */
  const CATALOG = {
    UM: { n: 'Islas menores de EE. UU.', short: 'Islas menores de EE. UU.', f: 'um', tz: 12,  lon: 166.7, lab: [1250, 392, 'l'], disp: true },
    KR: { n: 'Corea del Sur', f: 'kr', tz: 9,  lon: 127.0, lab: [1128, 236, 'r'] },
    ES: { n: 'España',        f: 'es', tz: 1,  lon: -3.7,  lab: [566, 220, 'l'] },
    UY: { n: 'Uruguay',       f: 'uy', tz: -3, lon: -56.2, lab: [404, 548, 'r'] },
    AR: { n: 'Argentina',     f: 'ar', tz: -3, lon: -58.4, lab: [404, 590, 'r'] },
    VE: { n: 'Venezuela',     f: 've', tz: -4, lon: -66.9, lab: [352, 374, 'r'] },
    DO: { n: 'Rep. Dominicana', long: 'República Dominicana', f: 'do', tz: -4, lon: -69.9, lab: [350, 322, 'r'] },
    CO: { n: 'Colombia',      f: 'co', tz: -5, lon: -74.1, lab: [334, 412, 'r'] },
    PE: { n: 'Perú',          f: 'pe', tz: -5, lon: -77.0, lab: [168, 492, 'l'] },
    EC: { n: 'Ecuador',       f: 'ec', tz: -5, lon: -78.5, lab: [168, 462, 'l'] },
    PA: { n: 'Panamá',        f: 'pa', tz: -5, lon: -79.5, lab: [168, 432, 'l'] },
    CR: { n: 'Costa Rica',    f: 'cr', tz: -6, lon: -84.1, lab: [168, 402, 'l'] },
    SV: { n: 'El Salvador',   f: 'sv', tz: -6, lon: -89.2, lab: [168, 372, 'l'] },
    GT: { n: 'Guatemala',     f: 'gt', tz: -6, lon: -90.5, lab: [168, 342, 'l'] },
    MX: { n: 'México',        f: 'mx', tz: -6, lon: -99.1, lab: [168, 312, 'l'] }
  };
  const DEFAULT_CODES = ['KR', 'ES', 'AR', 'UY', 'DO', 'VE', 'CO', 'PE', 'EC', 'PA', 'MX', 'GT', 'CR', 'SV', 'UM'];
  const POLE = [1300, 92];                       // Polo Norte (referencia visual en el mapa)
  const START = Date.UTC(2026, 11, 24, 5, 0, 0);  // 24 dic 00:00 ET
  const END = Date.UTC(2026, 11, 25, 5, 0, 0);    // 25 dic 00:00 ET
  const STAY = 0.28;                              // fracción del intervalo que Santa permanece en cada país

  const P = (c) => { const p = GEO.pts[c]; return p ? [p[0] * W / 100, p[1] * H / 100] : null; };
  const nm = (c) => (CATALOG[c] && CATALOG[c].n) || c;
  const longName = (c) => (CATALOG[c] && (CATALOG[c].long || CATALOG[c].n)) || c;

  /* ---------- Estado ---------- */
  const q = new URLSearchParams(location.search);
  const PREVIEW = ['prep', 'ruta', 'fin'].includes(q.get('preview')) ? q.get('preview') : null;
  const model = { codes: DEFAULT_CODES.slice(), arr: null, user: null, offset: 0, loggedIn: null, schedule: 'none' };
  let route = [];            // [{code, pt, label}] en orden de visita
  let legs = [];             // [{dim, glow, lit, len}] pole→d0, d0→d1 …
  let demo = null;           // { t0, L, frozen }
  let popFor = null, lastSig = '', ang = 0, lastEmit = 0;

  function ordered(codes) {   // orden PROVISIONAL: la medianoche llega antes al este (hasta que el servidor indique otro)
    return codes.filter((c) => CATALOG[c] && P(c)).sort((a, b) => (CATALOG[b].tz - CATALOG[a].tz) || (CATALOG[b].lon - CATALOG[a].lon));
  }
  function setDestinations(list) {   // list: [{code, order?, arrives_at?}]
    const known = list.filter((d) => d && CATALOG[d.code] && P(d.code));
    const hasOrder = known.every((d) => Number.isFinite(+d.order));
    const sorted = hasOrder ? known.slice().sort((a, b) => a.order - b.order) : ordered(known.map((d) => d.code)).map((c) => known.find((d) => d.code === c));
    model.codes = sorted.map((d) => d.code);
    const withTimes = sorted.every((d) => d.arrives_at && !isNaN(Date.parse(d.arrives_at)));
    model.arr = withTimes ? sorted.map((d) => Date.parse(d.arrives_at)) : null;
    model.schedule = withTimes ? 'server' : 'none';
    build();
  }

  /* ---------- Mapa (datos reales: Natural Earth; ciudades GeoNames) ---------- */
  function mk(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function buildBase() {
    $('v-land').setAttribute('d', GEO.land); $('v-land-glow').setAttribute('d', GEO.land); $('v-borders').setAttribute('d', GEO.borders);
    $('v-cb').setAttribute('d', GEO.cityBig); $('v-cm').setAttribute('d', GEO.cityMid); $('v-cb-g').setAttribute('d', GEO.cityBig); $('v-cm-g').setAttribute('d', GEO.cityMid);
    const R = W / (2 * Math.PI), merc = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const y0 = merc(GEO.meta.latN), g = $('v-grat'); let d = '';
    for (let lon = -150; lon <= 210; lon += 30) { const x = (lon + 150) / 360 * W; d += 'M' + x.toFixed(1) + ' 0V' + H; }
    for (let lat = -45; lat <= 60; lat += 15) { const y = y0 - merc(lat); d += 'M0 ' + y.toFixed(1) + 'H' + W; }
    mk('path', { d }, g);
  }

  function legPath(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), k = Math.min(len * 0.22, 120);
    let nx = -dy / (len || 1), ny = dx / (len || 1);
    if (Math.abs(dx) >= Math.abs(dy)) { if (ny > 0) { nx = -nx; ny = -ny; } } else if (nx < 0) { nx = -nx; ny = -ny; }
    const cx = (a[0] + b[0]) / 2 + nx * k, cy = (a[1] + b[1]) / 2 + ny * k;
    return 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1);
  }

  function build() {
    route = model.codes.map((c) => ({ code: c, pt: P(c) }));
    // países resaltados
    const cn = $('v-cn'); cn.replaceChildren();
    for (const r of route) if (GEO.countries[r.code]) mk('path', { d: GEO.countries[r.code], class: 'cn', 'data-c': r.code }, cn);
    // ruta (tres capas independientes por tramo)
    const rg = $('v-route'); rg.replaceChildren(); legs = [];
    const pts = [POLE].concat(route.map((r) => r.pt));
    for (let i = 0; i < route.length; i++) {
      const d = legPath(pts[i], pts[i + 1]);
      const dim = mk('path', { d, class: 'rt-dim' }, rg), glow = mk('path', { d, class: 'rt-glow', pathLength: 1 }, rg), lit = mk('path', { d, class: 'rt-lit', pathLength: 1 }, rg);
      glow.style.strokeDashoffset = 1; lit.style.strokeDashoffset = 1;
      legs.push({ dim, glow, lit, len: dim.getTotalLength() });
    }
    // polo norte
    const pg = mk('g', { class: 'pole' }, rg); mk('circle', { cx: POLE[0], cy: POLE[1], r: 26, fill: 'url(#gGlow)', opacity: '.6' }, pg); mk('circle', { cx: POLE[0], cy: POLE[1], r: 4, fill: '#fff6cf' }, pg);
    // etiquetas, marcadores y líneas guía
    const pins = $('v-pins'), lines = $('v-lines'); pins.replaceChildren(); lines.replaceChildren(); $('v-chips').replaceChildren();
    for (const r of route) {
      const c = r.code, cat = CATALOG[c], pt = r.pt;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pin'; b.dataset.c = c; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true');
      b.style.left = (pt[0] / W * 100) + '%'; b.style.top = (pt[1] / H * 100) + '%'; b.appendChild(document.createElement('i')); if (cat.disp) b.classList.add('is-disp'); pins.appendChild(b);
      const lb = document.createElement('button'); lb.type = 'button'; lb.className = 'lab ' + cat.lab[2]; lb.dataset.c = c;
      lb.style.left = (cat.lab[0] / W * 100) + '%'; lb.style.top = (cat.lab[1] / H * 100) + '%';
      const im = new Image(); im.src = FLAGS + cat.f + '.svg'; im.alt = ''; im.width = 24; im.height = 18; im.decoding = 'async'; lb.appendChild(im);
      const sp = document.createElement('span'); sp.textContent = cat.short || cat.n; lb.appendChild(sp); pins.appendChild(lb);
      const ax = cat.lab[2] === 'l' ? cat.lab[0] : cat.lab[0];
      mk('line', { x1: pt[0], y1: pt[1], x2: ax, y2: cat.lab[1], class: 'ln' }, lines);
      const li = document.createElement('li'), cb = document.createElement('button'); cb.type = 'button'; cb.dataset.c = c;
      cb.innerHTML = '<img alt="" width="30" height="22" src="' + FLAGS + cat.f + '.svg"><span>' + longName(c) + '</span><i class="dot"></i>'; li.appendChild(cb); $('v-chips').appendChild(li);
    }
    $('v-ncount').textContent = route.length + (route.length === 1 ? ' país' : ' países');
    lastSig = ''; render();
  }

  /* ---------- Cálculo del estado (sin inventar datos) ---------- */
  function clock() {
    if (demo) {
      const n = route.length; if (!n) return Date.now();
      if (demo.frozen != null) return demo.base + demo.frozen;
      const span = (n + 2.5) * demo.L; return demo.base + ((Date.now() - demo.t0) % span);
    }
    return Date.now() + model.offset;
  }
  function snapshot(now) {
    const n = route.length;
    let phase = PREVIEW === 'prep' ? 'prep' : PREVIEW === 'fin' ? 'fin' : (now < START ? 'prep' : now < END ? 'ruta' : 'fin');
    if (demo && PREVIEW === 'ruta') phase = 'ruta';
    const S = { phase, now, n, synced: false, cur: -1, next: n ? 0 : -1, travelling: false, frac: 0, visited: 0, toNext: null, toStart: Math.max(0, START - now), leg: 0 };
    if (phase === 'fin') { S.cur = -1; S.next = -1; S.visited = n; S.synced = true; S.done = true; return S; }
    if (phase === 'prep') return S;
    const arr = model.arr; if (!arr || !n) return S;       // recorrido real sin horario del servidor → "por sincronizar"
    S.synced = true; const t0 = PREVIEW ? arr[0] - demo.L : START;
    if (now < arr[0]) { S.travelling = true; S.leg = 0; S.frac = Math.min(1, Math.max(0, (now - t0) / (arr[0] - t0))); S.next = 0; S.toNext = arr[0] - now; return S; }
    for (let i = 0; i < n; i++) {
      const a = arr[i], b = i + 1 < n ? arr[i + 1] : null;
      if (b == null) { S.cur = i; S.next = -1; S.visited = i; S.leg = i; return S; }
      if (now < b) {
        const span = b - a, stayEnd = a + span * STAY;
        S.visited = i;
        if (now < stayEnd) { S.cur = i; S.next = i + 1; S.leg = i; S.toNext = b - now; }
        else { S.cur = -2; S.prev = i; S.next = i + 1; S.travelling = true; S.leg = i + 1; S.frac = (now - stayEnd) / (b - stayEnd); S.toNext = b - now; S.visited = i + 1; }
        return S;
      }
    }
    return S;
  }

  /* ---------- Render ---------- */
  const fmt = (ms, withDays) => {
    let s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); s -= d * 86400; const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60;
    const p = (x) => String(x).padStart(2, '0'); return (withDays && d ? d + ' d ' : '') + p(h) + ':' + p(m) + ':' + p(s);
  };
  const stateOf = (S, i) => (S.phase === 'fin' ? 'visited' : i === S.cur ? 'current' : (S.synced && i < S.visited) ? 'visited' : i === S.next ? 'next' : 'pending');
  const stLabel = { pending: 'Pendiente', visited: 'Visitado', current: 'Destino actual', next: 'Próximo destino' };

  function render(force) {
    const S = snapshot(clock()), n = route.length;
    const sig = [S.phase, S.cur, S.next, S.visited, S.synced, S.travelling, model.user && model.user.country, model.loggedIn, model.schedule].join('|');
    if (sig !== lastSig || force) {
      lastSig = sig;
      route.forEach((r, i) => {
        const st = stateOf(S, i);
        document.querySelectorAll('[data-c="' + r.code + '"]').forEach((el) => { el.classList.remove('is-visited', 'is-current', 'is-next'); if (st !== 'pending') el.classList.add('is-' + st); });
      });
      steps(S); panels(S);
    }
    tick(S); return S;
  }
  function tick(S) {   // partes que cambian cada segundo
    const cnt = $('v-count');
    if (S.phase === 'prep') {
      cnt.hidden = false; cnt.innerHTML = 'Santa parte en <b>' + fmt(S.toStart, true) + '</b>'; $('t-time').textContent = fmt(S.toStart, true);
    } else { cnt.hidden = true; $('t-time').textContent = S.phase === 'ruta' && S.synced && S.toNext != null ? fmt(S.toNext) : '—'; }
  }
  function steps(S) {
    const lis = document.querySelectorAll('#v-steps li'), st = ['pending', 'pending', 'pending', 'pending'], tx = ['', '', '', ''];
    if (S.phase === 'prep') { st[0] = 'current'; tx[0] = 'En progreso'; tx[1] = 'Comienza el 24 de dic.'; tx[2] = 'En espera'; tx[3] = 'Pendiente'; }
    else if (S.phase === 'ruta') { st[0] = 'done'; st[1] = 'current'; tx[0] = 'Listo'; tx[1] = 'En progreso (24 de dic.)'; tx[2] = 'En espera'; tx[3] = 'Pendiente'; if (S.synced && S.visited > 0) { st[2] = 'current'; tx[2] = S.visited + ' de ' + S.n; } }
    else { st.fill('done'); tx[0] = 'Listo'; tx[1] = 'Listo'; tx[2] = 'Listo'; tx[3] = 'Completada'; }
    lis.forEach((li, i) => { li.className = st[i]; li.querySelector('small').textContent = tx[i]; });
  }
  function setFlag(img, code) { if (code && CATALOG[code]) { img.src = FLAGS + CATALOG[code].f + '.svg'; img.hidden = false; } else img.hidden = true; }
  function panels(S) {
    const n = S.n, note = $('t-note'); note.hidden = true;
    const fl = $('t-flag'), pole = $('t-pole'); fl.hidden = true; pole.hidden = true;
    let nowL = 'Santa está ahora en:', now = '—', next = '—', vis = '—', tl = 'Tiempo restante:', pill = ['—', ''];
    if (S.phase === 'prep') {
      nowL = 'Santa está ahora en:'; now = 'Polo Norte'; pole.hidden = false; next = route[0] ? longName(route[0].code) : '—'; vis = '0 de ' + n; tl = 'Salida de Santa en:'; pill = ['En preparación', 'wait'];
    } else if (S.phase === 'fin') {
      nowL = 'Recorrido:'; now = 'Entrega completada'; pole.hidden = false; next = '—'; vis = n + ' de ' + n; tl = 'Tiempo restante:'; pill = ['Completado', 'done'];
    } else if (!S.synced) {
      now = 'Por sincronizar'; pole.hidden = false; next = '—'; vis = '—'; tl = 'Próxima llegada en:'; pill = ['En ruta', 'wait'];
      note.hidden = false; note.textContent = 'Los datos del recorrido oficial se mostrarán aquí cuando el servidor los publique.';
    } else {
      tl = 'Próxima llegada en:'; pill = ['En ruta', ''];
      if (S.cur >= 0) { now = longName(route[S.cur].code); setFlag(fl, route[S.cur].code); } else if (S.travelling) { nowL = 'Santa va en vuelo hacia:'; const tgt = S.next >= 0 ? route[S.next].code : null; now = tgt ? longName(tgt) : 'Polo Norte'; if (tgt) setFlag(fl, tgt); else pole.hidden = false; }
      next = S.next >= 0 ? longName(route[S.next].code) : '—'; vis = S.visited + ' de ' + n;
      if (S.cur < 0 && !S.travelling) { now = 'Último destino'; }
    }
    const lead = document.querySelector('.v-lead'); if (lead) lead.textContent = S.phase === 'fin' ? 'Santa completó su recorrido por los países de la comunidad GeoArmy.' : S.phase === 'ruta' ? 'Santa recorre el mundo visitando los países de la comunidad GeoArmy.' : 'Santa se prepara para recorrer el mundo y visitar los países de la comunidad GeoArmy.';
    $('t-now-l').textContent = nowL; $('t-now').textContent = now; $('t-next').textContent = next; $('t-visited').textContent = vis; $('t-time-l').textContent = tl;
    const pe = $('t-state'); pe.textContent = pill[0]; pe.className = 'v-pill ' + pill[1];
    me(S);
  }
  function me(S) {
    const u = model.user, mf = $('m-flag'), mi = $('m-flag-ic'), login = $('v-login');
    let country = '—', elig = '—', via = '—', st = '—', gift = 'El resultado final de tu regalo se revelará cuando Santa complete su recorrido.'; mf.hidden = true; mi.style.display = '';
    login.hidden = !(model.loggedIn === false && !u);
    if (!u) {
      if (model.loggedIn === false) { country = 'Inicia sesión'; st = 'Sin sesión'; }
      else { country = 'Pendiente de conexión'; elig = 'Pendiente'; st = 'Pendiente'; }
    } else if (!u.country) {
      country = 'Sin país'; elig = 'No elegible'; st = 'Sin país registrado'; gift = 'Sin país registrado no eres elegible para recibir V-Bucks. Recibirás carbón simbólico. Registra tu país en Mi Geo Army.';
    } else {
      country = longName(u.country); if (CATALOG[u.country]) { setFlag(mf, u.country); mi.style.display = 'none'; }
      elig = u.eligible === false ? 'No elegible' : 'Aprobada';
      const idx = route.findIndex((r) => r.code === u.country); via = idx >= 0 ? longName(u.country) : 'Sin parada registrada';
      if (S.phase === 'prep') st = 'En espera de salida';
      else if (S.phase === 'fin') st = 'Recorrido completado';
      else if (!S.synced) st = 'Por sincronizar';
      else st = idx < 0 ? '—' : (idx === S.cur ? 'Santa está en tu país' : (idx < S.visited ? 'Santa ya pasó por tu país' : 'En espera de entrega'));
    }
    $('m-country').textContent = country; $('m-elig').textContent = elig; $('m-route').textContent = via; $('m-state').textContent = st; $('m-note').querySelector('span').textContent = gift;
    const el = $('m-elig'); el.style.color = elig === 'Aprobada' ? '#7ee2a0' : elig === 'No elegible' ? '#ff9aa4' : '';
    $('v-cta-sub').textContent = u && u.country ? 'y descubre cuándo llegará a ' + longName(u.country) + '.' : 'y descubre cuándo llegará a tu país.';
  }

  /* ---------- Trineo ---------- */
  function sleighPos(S) {
    if (!legs.length) return { x: POLE[0], y: POLE[1], dx: -1, dy: 0 };
    const at = (leg, f) => { const L = legs[leg]; const l = L.len * f, p = L.dim.getPointAtLength(l), p2 = L.dim.getPointAtLength(Math.min(L.len, l + 2)), p1 = L.dim.getPointAtLength(Math.max(0, l - 2)); return { x: p.x, y: p.y, dx: p2.x - p1.x, dy: p2.y - p1.y }; };
    if (S.phase === 'prep' || (S.phase === 'ruta' && !S.synced)) return { x: POLE[0], y: POLE[1] + 4, dx: -1, dy: 0, idle: true };
    if (S.phase === 'fin') { const l = legs.length - 1, p = at(l, 1); return { x: p.x, y: p.y - 40, dx: p.dx, dy: p.dy, idle: true }; }
    if (S.travelling) return at(S.leg, S.frac);
    if (S.cur >= 0) { const l = S.cur, p = at(l, 1); return { x: p.x, y: p.y - 40, dx: p.dx, dy: p.dy, idle: true }; }
    return { x: POLE[0], y: POLE[1], dx: -1, dy: 0, idle: true };
  }
  function lightRoute(S) {
    legs.forEach((L, i) => {
      let f = 0;
      if (S.phase === 'fin') f = 1;
      else if (S.phase === 'ruta' && S.synced) { if (S.travelling) f = i < S.leg ? 1 : i === S.leg ? S.frac : 0; else if (S.cur >= 0) f = i <= S.cur ? 1 : 0; else f = 1; }
      const v = (1 - f).toFixed(4); if (L.lit.style.strokeDashoffset !== v) { L.lit.style.strokeDashoffset = v; L.glow.style.strokeDashoffset = v; }
    });
  }
  function placeSleigh(S) {
    const s = sleighPos(S), el = $('v-sleigh'), svg = el.firstElementChild, mapW = $('v-map').clientWidth || 1;
    el.style.left = (s.x / W * 100).toFixed(3) + '%'; el.style.top = (s.y / H * 100).toFixed(3) + '%';
    const west = s.dx < 0, raw = Math.atan2(s.dy, west ? -s.dx : s.dx) * 180 / Math.PI, target = Math.max(-26, Math.min(26, s.idle ? 0 : raw));
    ang += (target - ang) * 0.12; svg.style.transform = (west ? 'scaleX(-1) ' : '') + 'rotate(' + ang.toFixed(2) + 'deg)';
    el.dataset.west = west ? '1' : '0'; return { x: s.x / W * mapW, y: s.y / H * ($('v-map').clientHeight || 1), west, idle: !!s.idle };
  }

  /* ---------- Partículas doradas (estela) ---------- */
  const fx = $('v-fx'), fctx = fx.getContext('2d'); let parts = [], fxW = 0, fxH = 0, dpr = 1, running = false, visible = true;
  function sizeFx() { const r = $('v-map').getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); fxW = r.width; fxH = r.height; fx.width = Math.round(fxW * dpr); fx.height = Math.round(fxH * dpr); }
  function emit(p, S, t) {
    const sw = $('v-sleigh').clientWidth, dir = p.west ? 1 : -1, rate = p.idle ? 0.22 : 1;
    if (Math.random() > rate) return;
    const rx = p.x + dir * sw * 0.46, ry = p.y + sw * 0.06;
    for (let i = 0; i < 2; i++) parts.push({ x: rx + (Math.random() - .5) * 8, y: ry + (Math.random() - .5) * 8, vx: dir * (10 + Math.random() * 26), vy: (Math.random() - .3) * 14, life: 0, max: 0.9 + Math.random() * 1.1, r: 0.8 + Math.random() * 2.1 });
    if (parts.length > 140) parts.splice(0, parts.length - 140);
  }
  function drawFx(dt) {
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.clearRect(0, 0, fxW, fxH); fctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt; if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; const a = 1 - p.life / p.max, g = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.4);
      g.addColorStop(0, 'rgba(255,240,180,' + (a * .95).toFixed(3) + ')'); g.addColorStop(.4, 'rgba(255,196,80,' + (a * .5).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,170,40,0)');
      fctx.fillStyle = g; fctx.beginPath(); fctx.arc(p.x, p.y, p.r * 3.4, 0, 6.2832); fctx.fill();
    }
  }
  let last = 0;
  function frame(ts) {
    if (!running) return; requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
    const S = render(), p = placeSleigh(S); lightRoute(S);
    if (!reduce()) { emit(p, S, ts); drawFx(dt); }
  }
  function startLoop() { if (running || !visible || document.hidden) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
  function stopLoop() { running = false; }

  /* ---------- Nieve suave (fija, ligera) ---------- */
  (function snow() {
    const cv = $('v-snow'), c = cv.getContext('2d'); if (reduce()) return; let fl = [], w = 0, h = 0, on = true, lt = 0;
    function size() { w = innerWidth; h = innerHeight; const d = Math.min(2, devicePixelRatio || 1); cv.width = w * d; cv.height = h * d; c.setTransform(d, 0, 0, d, 0, 0); const n = Math.round(Math.min(90, Math.max(36, w / 16))); fl = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: .8 + Math.random() * 2, v: 14 + Math.random() * 34, s: Math.random() * 6.28, a: .35 + Math.random() * .55 })); }
    function step(ts) { requestAnimationFrame(step); if (!on || document.hidden || ts - lt < 33) return; const dt = (ts - lt) / 1000; lt = ts; c.clearRect(0, 0, w, h); c.fillStyle = '#fff';
      for (const f of fl) { f.y += f.v * dt; f.s += dt * .8; f.x += Math.sin(f.s) * 12 * dt; if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; } c.globalAlpha = f.a; c.beginPath(); c.arc(f.x, f.y, f.r, 0, 6.2832); c.fill(); } c.globalAlpha = 1; }
    size(); addEventListener('resize', size); requestAnimationFrame(step);
  })();

  /* ---------- Interacción con destinos ---------- */
  function openPop(code, focusBtn) {
    const idx = route.findIndex((r) => r.code === code); if (idx < 0) return; const S = snapshot(clock()), st = stateOf(S, idx), cat = CATALOG[code], pop = $('v-pop');
    let when = 'Horario por confirmar'; if (model.arr && model.arr[idx]) { when = 'Llegada prevista: ' + new Date(model.arr[idx]).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    if (S.phase === 'fin') when = 'Santa ya completó su recorrido.';
    pop.innerHTML = '<button type="button" aria-label="Cerrar">×</button><header><img src="' + FLAGS + cat.f + '.svg" alt=""><div><h3>' + longName(code) + '</h3><span class="st ' + st + '">' + stLabel[st] + '</span></div></header><p>' + when + '</p>' + (cat.disp ? '<p>Territorio disperso (Wake, Midway, Johnston, Palmyra…). El marcador usa la isla Wake como referencia visual.</p>' : '') + (model.user && model.user.country === code ? '<p><b>Es tu país registrado.</b></p>' : '');
    pop.hidden = false; popFor = code;
    const map = $('v-map'), mw = map.clientWidth, mh = map.clientHeight, pt = route[idx].pt, px = pt[0] / W * mw, py = pt[1] / H * mh, pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = Math.max(6, Math.min(mw - pw - 6, px - pw / 2)) + 'px'; pop.style.top = (py + ph + 30 > mh ? Math.max(6, py - ph - 22) : py + 22) + 'px';
    pop.querySelector('button').focus({ preventScroll: true });
    if (!focusBtn) { const sc = $('v-mapscroll'); if (sc.scrollWidth > sc.clientWidth) sc.scrollTo({ left: Math.max(0, px - sc.clientWidth / 2), behavior: reduce() ? 'auto' : 'smooth' }); }
  }
  function closePop() { const p = $('v-pop'); if (p.hidden) return; p.hidden = true; const b = popFor && document.querySelector('.lab[data-c="' + popFor + '"]'); popFor = null; if (b) b.focus({ preventScroll: true }); }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-c]'); const pop = $('v-pop');
    if (t && (t.matches('.pin,.lab,.cn') || t.closest('#v-chips'))) { openPop(t.dataset.c); return; }
    if (e.target.closest('#v-pop button')) { closePop(); return; }
    if (!e.target.closest('#v-pop') && !pop.hidden) { pop.hidden = true; popFor = null; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  $('v-cta').addEventListener('click', () => {
    const S = snapshot(clock()); let code = model.user && model.user.country && route.some((r) => r.code === model.user.country) ? model.user.country : (S.cur >= 0 ? route[S.cur].code : S.next >= 0 ? route[S.next].code : (route[0] && route[0].code));
    if (code) { $('v-map').scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' }); setTimeout(() => openPop(code), reduce() ? 0 : 450); }
  });

  /* ---------- Sesión (solo para saber si hay usuario; no se lee ni escribe ninguna tabla) ---------- */
  function initAuth() {
    if (!window.supabase || !window.GEOARMY_SUPABASE_URL || !window.GEOARMY_SUPABASE_ANON_KEY) return;
    try {
      const sb = window.supabase.createClient(window.GEOARMY_SUPABASE_URL, window.GEOARMY_SUPABASE_ANON_KEY);
      sb.auth.getSession().then(({ data }) => { model.loggedIn = !!(data && data.session); render(true); }).catch(() => {});
      $('v-login').addEventListener('click', async () => { try { sessionStorage.setItem('geoarmy_return_to_v1', location.pathname); await sb.auth.signInWithOAuth({ provider: 'twitch', options: { redirectTo: location.origin + window.GEOARMY_SITE_BASE + 'auth/callback/', scopes: 'user:read:email' } }); } catch (e) {} });
    } catch (e) {}
  }

  /* ---------- API pública para conectar el backend ---------- */
  window.GeoArmyViaje = {
    applyServerData(d) {
      if (!d) return;
      if (d.serverNow && !isNaN(Date.parse(d.serverNow))) model.offset = Date.parse(d.serverNow) - Date.now();
      if (d.user !== undefined) model.user = d.user ? { country: d.user.country || null, eligible: d.user.eligible } : { country: null };
      if (Array.isArray(d.destinations)) setDestinations(d.destinations); else render(true);
    },
    snapshot: () => snapshot(clock())
  };

  /* ---------- Vista previa de diseño (explícita, etiquetada, nunca por defecto) ---------- */
  function setupPreview() {
    if (!PREVIEW) return;
    const L = Math.max(2, Math.min(60, +q.get('ritmo') || 7)) * 1000, paso = q.get('paso') !== null ? +q.get('paso') : null, n = route.length;
    const t0 = Date.now(), base = PREVIEW === 'ruta' ? Date.UTC(2026, 11, 24, 12, 0, 0) : START;
    if (PREVIEW === 'ruta') {
      model.arr = route.map((r, i) => base + (i + 1) * L); demo = { t0, L, base, frozen: null }; model.schedule = 'demo';
      if (paso !== null && !isNaN(paso)) demo.frozen = Math.max(0, Math.min(n - 1, paso)) * L + L + L * 0.08 - 0;
      if (paso !== null && !isNaN(paso)) { demo.frozen = (Math.max(0, Math.min(n - 1, paso)) + 1) * L + L * 0.06; }
    }
    model.user = { country: 'MX', eligible: true }; model.loggedIn = true;
    const b = $('v-preview'); b.hidden = false; b.textContent = 'VISTA PREVIA DE DISEÑO · datos de ejemplo, no son el recorrido real';
  }

  /* ---------- Arranque ---------- */
  buildBase(); setDestinations(DEFAULT_CODES.map((c) => ({ code: c }))); setupPreview(); render(true); sizeFx(); initAuth();
  new ResizeObserver(() => sizeFx()).observe($('v-map'));
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; visible ? startLoop() : stopLoop(); }, { threshold: 0 }).observe($('v-map'));
  document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));
  const S0 = render(); placeSleigh(S0); lightRoute(S0);
  if (!reduce()) startLoop(); else setInterval(() => { const S = render(); placeSleigh(S); lightRoute(S); }, 1000);
  setInterval(() => render(), 1000);
  // en móvil: centrar el mapa en Latinoamérica o en el país del usuario
  setTimeout(() => { const sc = $('v-mapscroll'); if (sc.scrollWidth > sc.clientWidth) { const c = model.user && model.user.country, pt = c && P(c); sc.scrollLeft = pt && pt[0] / W > 0.3 ? Math.max(0, pt[0] / W * $('v-map').clientWidth - sc.clientWidth / 2) : 0; } }, 60);
})();
