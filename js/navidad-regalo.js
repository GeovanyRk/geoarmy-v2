/* ==========================================================================
   GEO ARMY — Pin 06 · Mi regalo de Navidad  ·  SOLO PRESENTACIÓN
   --------------------------------------------------------------------------
   Esta página NO decide ganadores, NO genera resultados aleatorios, NO acredita V-Bucks, NO escribe en Supabase y NO
   llama a ningún RPC. Solo dibuja lo que el servidor le entregue por el adaptador window.GeoArmyRegalo.
   El contrato completo está documentado en docs/navidad-regalo-contrato.md (resumen abajo).

   window.GeoArmyRegalo
     .applyServerData(d)        Estado autorizado por el servidor (puede llamarse varias veces; cada llamada fusiona campos presentes).
     .setOpenHandler(fn)        fn(): Promise<d>  — el backend ejecuta la apertura (idempotente) y devuelve el MISMO formato `d`
                                con gift.state = 'opened' y result.authorized = true. Sin handler el botón no hace nada.
     .setConnectionError(bool)  true = no se pudo consultar al servidor (se muestra el aviso; no se inventa ningún estado).
     .snapshot()                Copia de solo lectura del estado interno (útil para pruebas).

   d = {
     serverNow : ISO-8601 (hora oficial; sin ella la página permanece en "sincronizando"),
     member    : { loggedIn: bool, displayName: string|null, country: 'MX'|null },
     participation : { status: 'participant'|'not_participating'|'unknown' },          // informativo; NO revela el resultado
     gift      : { state: 'waiting'|'available'|'opened'|'unavailable', availableAt: ISO|null },
     result    : null | { authorized: true, kind: 'vbucks'|'coal', amount?: number },   // solo con gift.state='opened'
     opened    : null | { at: ISO },
     credit    : null | { status: 'pending'|'credited'|'review'|'not_applicable', at?: ISO },
     message   : null | { body: string },                                                // carta de Santa (párrafos separados por \n\n)
     journey   : { tree|workshop|post|list|travel: 'completed'|'pending'|'unknown' }     // opcional; sin dato = "Sin confirmar"
   }

   Vistas previas (solo simulación, sin red ni operaciones): ?preview=espera|disponible|ganador|carbon|abierto
   (opcional &resultado=carbon para disponible/abierto).
   ========================================================================== */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var page = $('g-page'), gift = $('g-gift');
  var reduce = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var q = new URLSearchParams(location.search);
  var PV = ['espera', 'disponible', 'ganador', 'carbon', 'abierto'].indexOf(q.get('preview')) >= 0 ? q.get('preview') : null;
  var PV_KIND = (PV === 'carbon' || q.get('resultado') === 'carbon') ? 'coal' : 'vbucks';
  var JKEYS = { arbol: 'tree', taller: 'workshop', correos: 'post', lista: 'list', viaje: 'travel' };

  /* ---------- Estado (solo lo que el servidor entrega) ---------- */
  var model = {
    connected: false, error: false, serverNow: null, serverAt: 0,
    member: { loggedIn: null, displayName: null, country: null }, participation: { status: 'unknown' },
    gift: { state: 'unknown', availableAt: null }, result: null, opened: null, credit: null, message: null, journey: {}
  };
  var ui = { busy: false, phase: 'closed', tab: 'journey', refreshAsked: false };
  var openHandler = null;

  function now() { return model.serverNow === null ? null : model.serverNow + (performance.now() - model.serverAt); }
  function isIso(s) { return typeof s === 'string' && !isNaN(Date.parse(s)); }
  function hasResult() { return !!model.result && (model.result.kind === 'vbucks' || model.result.kind === 'coal'); }
  function validResult(r) { return !!r && r.authorized === true && (r.kind === 'vbucks' || r.kind === 'coal'); }
  function fmtN(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtCount(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var p = function (v) { return (v < 10 ? '0' : '') + v; };
    return (d ? d + ' d ' : '') + p(h) + ':' + p(m) + ':' + p(x);
  }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }

  function view() {
    if (!model.connected) return 'sync';
    var s = model.gift.state;
    if (s === 'opened' && hasResult()) return 'abierto';
    if (s === 'available') return 'disponible';
    if (s === 'waiting') return 'espera';
    return 'sync';
  }

  /* ---------- Fusión de datos autorizados ---------- */
  function merge(d) {
    if (!d || typeof d !== 'object') return;
    if (isIso(d.serverNow)) { model.serverNow = Date.parse(d.serverNow); model.serverAt = performance.now(); model.connected = true; model.error = false; }
    if (d.member && typeof d.member === 'object') {
      if ('loggedIn' in d.member) model.member.loggedIn = !!d.member.loggedIn;
      if ('displayName' in d.member) model.member.displayName = typeof d.member.displayName === 'string' ? d.member.displayName.slice(0, 40) : null;
      if ('country' in d.member) model.member.country = typeof d.member.country === 'string' ? d.member.country : null;
    }
    if (d.participation && typeof d.participation.status === 'string') model.participation = { status: d.participation.status };
    if (d.gift && typeof d.gift === 'object') {
      var st = ['waiting', 'available', 'opened', 'unavailable'].indexOf(d.gift.state) >= 0 ? d.gift.state : 'unknown';
      model.gift = { state: st, availableAt: isIso(d.gift.availableAt) ? Date.parse(d.gift.availableAt) : null };
      ui.refreshAsked = false;
    }
    // El resultado solo se adopta si el servidor lo autoriza explícitamente y el regalo figura como abierto.
    if ('result' in d) model.result = (validResult(d.result) && model.gift.state === 'opened') ? { kind: d.result.kind, amount: Number(d.result.amount) > 0 ? Number(d.result.amount) : 1000 } : null;
    if (model.gift.state !== 'opened') model.result = null;
    if ('opened' in d) model.opened = d.opened && isIso(d.opened.at) ? { at: d.opened.at } : null;
    if ('credit' in d) model.credit = d.credit && ['pending', 'credited', 'review', 'not_applicable'].indexOf(d.credit.status) >= 0 ? { status: d.credit.status, at: isIso(d.credit.at) ? d.credit.at : null } : null;
    if ('message' in d) model.message = d.message && typeof d.message.body === 'string' ? d.message.body.slice(0, 2400) : null;
    if (d.journey && typeof d.journey === 'object') {
      var j = {}; Object.keys(JKEYS).forEach(function (k) { var v = d.journey[JKEYS[k]]; j[k] = (v === 'completed' || v === 'pending') ? v : 'unknown'; });
      model.journey = j;
    }
  }

  /* ---------- Textos ---------- */
  var T = {
    leadSync: 'Tu regalo se mostrará cuando el servidor de Santa confirme su estado.',
    leadWait: 'Santa sigue ocupado en el Polo Norte. Pronto podrás abrir tu regalo y descubrir qué dejó para ti en Geo Army.',
    leadReady: '¡Llegó el momento! Santa ya tiene tu regalo preparado. Ábrelo y descubre qué dejó para ti en Geo Army.',
    leadDone: 'Tu regalo ya está abierto. Santa lo dejó para ti con mucho cariño.',
    wait: 'Santa todavía está preparando tu regalo',
    sync: 'Esperando la confirmación del servidor…',
    err: 'No pudimos consultar el servidor. Inténtalo de nuevo en unos minutos.',
    openErr: 'No pudimos abrir tu regalo en este momento. Inténtalo de nuevo en unos minutos.'
  };
  function letterParas(kind, amount) {
    var n = model.member.displayName, hi = n ? 'Querido/a ' + n + ',' : 'Querido miembro de GEO ARMY,';
    if (model.message) return { hi: hi, paras: model.message.split(/\n\s*\n/).filter(Boolean).map(function (s) { return s.trim(); }), sign: '— Santa Claus' };
    if (kind === 'vbucks') return { hi: hi, sign: '— Santa Claus', paras: [
      'Este año recorrí el mundo entero y, entre tantos nombres, el tuyo brilló en mi lista. Gracias por acompañar a la comunidad GEO ARMY durante estas fiestas.',
      'Por eso dejé algo especial para ti: ' + fmtN(amount) + ' V-Bucks, preparados por mis duendes con todo el cariño del Polo Norte.',
      'Disfrútalos, comparte la alegría con tu equipo y sigue participando. ¡Felices fiestas!'] };
    var ps = [
      'Gracias por acompañarme durante esta Navidad en GEO ARMY. Esta vez mi bolsa de V-Bucks no alcanzó para todos y, en tu regalo, dejé un carbón de Santa.',
      'No te preocupes: es un detalle simbólico. No pierdes monedas ni recibes ninguna penalización, y sigues siendo parte de la comunidad.'];
    if (!model.member.country) ps.push('Si todavía no registraste tu país, hazlo en Mi Geo Army para poder participar por V-Bucks el próximo año.');
    ps.push('El año que viene te espero con más ganas: visita el Taller, escríbeme una carta y acompáñame en el viaje. ¡Felices fiestas!');
    return { hi: hi, paras: ps, sign: '— Santa Claus' };
  }
  function creditView(kind) {
    var c = model.credit;
    if (kind === 'coal') return { s: 'na', t: 'Regalo simbólico · no requiere acreditación' };
    if (c && c.status === 'credited') return { s: 'credited', t: 'V-Bucks acreditados' + (c.at ? ' · ' + fmtDate(c.at) : '') };
    if (c && c.status === 'review') return { s: 'review', t: 'Acreditación en revisión · el equipo de GEO ARMY te contactará' };
    if (c && c.status === 'not_applicable') return { s: 'na', t: 'Sin acreditación pendiente' };
    return { s: 'pending', t: 'Acreditación pendiente de confirmación del servidor' };
  }

  /* ---------- Render ---------- */
  var lastKey = '';
  function render() {
    var v = view(), opening = ui.phase === 'opening', result = !opening && (ui.phase === 'result' || v === 'abierto');
    if (v !== 'abierto' && ui.phase === 'result' && !hasResult()) { ui.phase = 'closed'; result = false; }
    var kind = model.result ? model.result.kind : null;
    page.dataset.view = v; page.dataset.mode = ui.phase === 'opening' ? 'opening' : (result ? 'result' : 'closed');
    page.dataset.res = result && kind ? (kind === 'coal' ? 'carbon' : 'vbucks') : '';

    // textos y botón
    var lead = $('g-lead'), status = $('g-status'), count = $('g-count'), btn = $('g-open');
    if (ui.phase === 'opening') { /* no cambiar textos durante la animación */ }
    else if (result) lead.textContent = T.leadDone;
    else lead.textContent = v === 'disponible' ? T.leadReady : v === 'espera' ? T.leadWait : T.leadSync;
    if (!result && ui.phase !== 'opening') {
      if (v === 'sync') { status.textContent = model.member.loggedIn === false ? 'Inicia sesión con Twitch desde tu perfil para consultar tu regalo.' : model.gift.state === 'unavailable' ? 'Tu cuenta no dispone de un regalo navideño.' : model.error ? T.err : T.sync; }
      else if (v === 'espera') status.textContent = model.gift.availableAt ? T.wait : 'Santa todavía está confirmando la lista definitiva.';
      else if (!status.dataset.err) status.textContent = '';
    }
    btn.disabled = !(v === 'disponible' && ui.phase === 'closed' && !ui.busy && !model.error && (PV || openHandler));
    btn.setAttribute('aria-disabled', btn.disabled ? 'true' : 'false');
    count.hidden = !(v === 'espera' && model.gift.availableAt);
    tick();

    // recorrido
    KEYS_ROWS.forEach(function (li) {
      var s = model.journey[li.dataset.k] || 'unknown', pill = li.querySelector('.g-pill');
      li.dataset.s = s; pill.textContent = s === 'completed' ? 'Completado' : s === 'pending' ? 'Pendiente' : 'Sin confirmar';
    });
    $('g-journey-note').hidden = false;

    // paneles izquierdo
    var showLetter = result && ui.tab === 'letter';
    $('g-journey').hidden = showLetter; $('g-letter').hidden = !showLetter;
    $('g-to-letter').hidden = !result;

    // regalo + resultado
    var item = $('g-item');
    if (result && kind) {
      var ik = kind === 'coal' ? 'carbon' : 'vbucks';
      if (item.dataset.k !== ik) { item.dataset.k = ik; item.src = 'assets/navidad/regalo/' + (ik === 'carbon' ? 'carbon.webp' : 'vbucks.webp'); }
      item.hidden = false;
      renderResult(kind); renderLetter(kind);
      if (ui.phase === 'result' && !gift.classList.contains('is-open')) { gift.classList.add('is-static', 'is-open'); }
    } else if (!opening) {
      $('g-result').hidden = true; item.hidden = true; item.removeAttribute('data-k');
      gift.classList.remove('is-open', 'is-static', 'is-burst', 'is-shake');
    }
  }
  var KEYS_ROWS = [].slice.call(document.querySelectorAll('#g-rows li'));
  function renderResult(kind) {
    var name = model.member.displayName, el = $('g-result'), amount = model.result.amount;
    el.hidden = false;
    $('g-r-eyebrow').textContent = kind === 'vbucks' ? (name ? '¡Felicidades, ' + name + '!' : '¡Felicidades!') : 'Santa pasó por tu casa';
    $('g-r-title').textContent = kind === 'vbucks' ? fmtN(amount) + ' V-Bucks' : 'Un carbón de Santa';
    $('g-r-sub').textContent = kind === 'vbucks' ? 'Santa te seleccionó para recibir este regalo.' : 'Es un regalo simbólico: no pierdes monedas ni tienes penalizaciones. ¡El próximo año te esperamos!';
    var c = creditView(kind), ce = $('g-r-credit'); ce.textContent = c.t; ce.dataset.s = c.s;
    var op = $('g-r-opened');
    if (!ui.fresh && model.opened) { op.hidden = false; op.textContent = 'Abriste este regalo el ' + fmtDate(model.opened.at) + '. No se repite la entrega.'; }
    else if (!ui.fresh) { op.hidden = false; op.textContent = 'Regalo abierto anteriormente. No se repite la entrega.'; }
    else op.hidden = true;
    el.classList.toggle('no-anim', !ui.fresh);
  }
  function renderLetter(kind) {
    var L = letterParas(kind, model.result.amount), body = $('g-letter-body'); body.textContent = '';
    var hi = document.createElement('p'); hi.className = 'hi'; hi.textContent = L.hi; body.appendChild(hi);
    L.paras.forEach(function (t) { var p = document.createElement('p'); p.textContent = t; body.appendChild(p); });
    var sg = document.createElement('p'); sg.className = 'sign'; sg.textContent = L.sign; body.appendChild(sg);
  }
  function tick() {
    var v = view(), c = $('g-count'); if (v !== 'espera' || !model.gift.availableAt) return;
    var n = now(), left = model.gift.availableAt - n;
    if (left > 0) { c.innerHTML = '<small>Santa entrega tu regalo en</small>' + fmtCount(left); ui.refreshAsked = false; }
    else {
      c.innerHTML = '<small>Santa está terminando de envolverlo</small>…';
      if (!ui.refreshAsked) { ui.refreshAsked = true; try { document.dispatchEvent(new CustomEvent('geoarmy:regalo-refresh')); } catch (e) {} }   // el backend responde con applyServerData
    }
  }

  /* ---------- Apertura ---------- */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function previewPayload() {
    var coal = PV_KIND === 'coal';
    return { serverNow: new Date().toISOString(), gift: { state: 'opened', availableAt: null }, result: { authorized: true, kind: PV_KIND, amount: 1000 },
      opened: { at: new Date().toISOString() }, credit: { status: coal ? 'not_applicable' : 'pending' }, message: null };
  }
  async function requestOpen() {
    if (ui.busy || view() !== 'disponible' || ui.phase !== 'closed') return;
    ui.busy = true; var st = $('g-status'); delete st.dataset.err; st.textContent = ''; render();
    var payload;
    try {
      if (PV) payload = previewPayload();
      else if (openHandler) payload = await openHandler();
      if (!payload) throw new Error('sin respuesta');
      merge(payload);
    } catch (e) { fail(); return; }
    if (!(model.gift.state === 'opened' && hasResult())) { fail(); return; }
    ui.fresh = true; ui.tab = 'letter'; ui.phase = 'opening'; render();
    var item = $('g-item'); item.dataset.k = model.result.kind === 'coal' ? 'carbon' : 'vbucks'; item.src = 'assets/navidad/regalo/' + (model.result.kind === 'coal' ? 'carbon.webp' : 'vbucks.webp'); item.hidden = false;
    if (reduce()) { gift.classList.add('is-static', 'is-open'); }
    else {
      gift.classList.add('is-shake'); await wait(720); gift.classList.remove('is-shake');
      gift.classList.add('is-burst'); fx.burst(); await wait(240);
      gift.classList.add('is-open'); await wait(2100);
    }
    ui.phase = 'result'; ui.busy = false; render(); $('g-result').scrollIntoView && matchMedia('(max-width:1020px)').matches && $('g-result').scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'nearest' });
  }
  function fail() {
    ui.busy = false; var st = $('g-status'); st.dataset.err = '1'; st.textContent = T.openErr; render();
  }
  $('g-open').addEventListener('click', requestOpen);
  $('g-to-letter').addEventListener('click', function () { ui.tab = 'letter'; render(); });
  $('g-to-journey').addEventListener('click', function () { ui.tab = 'journey'; render(); });

  /* ---------- Partículas doradas (canvas) ---------- */
  var fx = (function () {
    var cv = $('g-fx'), c = cv.getContext('2d'), W = 0, H = 0, dpr = 1, gx = 0, gy = 0, gw = 0, gh = 0, parts = [], running = false, vis = true, last = 0, acc = 0;
    function size() {
      var r = cv.getBoundingClientRect(), g = $('g-giftwrap').getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      gx = g.left - r.left; gy = g.top - r.top; gw = g.width; gh = g.height;
    }
    function ambientRate() { var v = page.dataset.view, m = page.dataset.mode; if (m === 'opening') return 0; if (m === 'result') return 16; return v === 'disponible' ? 14 : v === 'espera' ? 3 : 2; }
    function spawn(n) {
      for (var i = 0; i < n; i++) parts.push({ x: gx + gw * (0.05 + Math.random() * 0.9), y: gy + gh * (0.15 + Math.random() * 0.85), vx: (Math.random() - .5) * 14, vy: -(14 + Math.random() * 30), life: 0, max: 1.8 + Math.random() * 2.2, r: .8 + Math.random() * 2.2, burst: false });
    }
    function burst() {
      if (reduce()) return; size();
      var ox = gx + gw / 2, oy = gy + gh * 0.41;
      for (var i = 0; i < 170; i++) { var a = (-Math.PI / 2) + (Math.random() - .5) * Math.PI * 1.7, sp = 120 + Math.random() * 520;
        parts.push({ x: ox + (Math.random() - .5) * gw * .4, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 1.1 + Math.random() * 1.5, r: 1 + Math.random() * 3, burst: true }); }
    }
    function draw(dt) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i]; p.life += dt; if (p.life >= p.max) { parts.splice(i, 1); continue; }
        if (p.burst) { p.vy += 280 * dt; p.vx *= (1 - 0.9 * dt); }
        p.x += p.vx * dt; p.y += p.vy * dt;
        var a = Math.sin(Math.PI * Math.min(1, p.life / p.max)), rr = p.r * 3.2, g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        g.addColorStop(0, 'rgba(255,244,196,' + (a * .95).toFixed(3) + ')'); g.addColorStop(.4, 'rgba(255,200,90,' + (a * .5).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,170,40,0)');
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, rr, 0, 6.2832); c.fill();
      }
      if (parts.length > 320) parts.splice(0, parts.length - 320);
    }
    function frame(ts) {
      if (!running) return; requestAnimationFrame(frame);
      var dt = Math.min(.05, (ts - last) / 1000 || .016); last = ts;
      acc += ambientRate() * dt; if (acc >= 1) { spawn(Math.floor(acc)); acc -= Math.floor(acc); }
      draw(dt);
    }
    function start() { if (running || !vis || document.hidden || reduce()) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
    function stop() { running = false; }
    window.addEventListener('resize', size);
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(gift);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { vis = e[0].isIntersecting; vis ? start() : stop(); }, { threshold: 0 }).observe(gift);
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    size(); start();
    return { burst: burst, size: size };
  })();

  /* ---------- Nieve suave (30 fps, en pausa si no se ve) ---------- */
  (function () {
    var cv = $('g-snow'); if (!cv || reduce()) { if (cv) cv.hidden = true; return; }
    var c = cv.getContext('2d'), W = 0, H = 0, fl = [], dpr = 1, last = 0, run = false;
    function size() { dpr = Math.min(1.5, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); var n = Math.round(Math.min(90, W / 18)); while (fl.length < n) fl.push(mk(true)); fl.length = n; }
    function mk(r) { return { x: Math.random() * W, y: r ? Math.random() * H : -8, r: .7 + Math.random() * 2, s: 14 + Math.random() * 30, w: Math.random() * 6.28, a: .35 + Math.random() * .5 }; }
    function frame(ts) {
      if (!run) return; requestAnimationFrame(frame); if (ts - last < 33) return; var dt = Math.min(.1, (ts - last) / 1000); last = ts;
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.fillStyle = '#fff';
      for (var i = 0; i < fl.length; i++) { var f = fl[i]; f.y += f.s * dt; f.w += dt; f.x += Math.sin(f.w) * 12 * dt; if (f.y > H + 8) fl[i] = mk(false);
        c.globalAlpha = f.a; c.beginPath(); c.arc(f.x, f.y, f.r, 0, 6.2832); c.fill(); }
      c.globalAlpha = 1;
    }
    function go() { if (run || document.hidden) return; run = true; last = 0; requestAnimationFrame(frame); }
    window.addEventListener('resize', size); document.addEventListener('visibilitychange', function () { document.hidden ? (run = false) : go(); });
    size(); go();
  })();

  /* ---------- Vistas previas (simulación) ---------- */
  function setupPreview() {
    var b = $('g-preview'), txt = $('g-preview-txt'), t = Date.now(), done = { arbol: 'completed', taller: 'completed', correos: 'completed', lista: 'completed', viaje: 'completed' };
    var mixed = { arbol: 'completed', taller: 'pending', correos: 'completed', lista: 'pending', viaje: 'completed' };
    var wait3 = { arbol: 'completed', taller: 'completed', correos: 'pending', lista: 'pending', viaje: 'pending' };
    function J(o) { return { tree: o.arbol, workshop: o.taller, post: o.correos, list: o.lista, travel: o.viaje }; }
    var base = { serverNow: new Date(t).toISOString(), member: { loggedIn: true, displayName: 'Miembro de ejemplo', country: 'MX' }, participation: { status: 'participant' } };
    var d = { espera: { gift: { state: 'waiting', availableAt: new Date(t + ((2 * 24 + 4) * 3600 + 12 * 60 + 9) * 1000).toISOString() }, journey: J(wait3) },
      disponible: { gift: { state: 'available', availableAt: null }, journey: J(PV_KIND === 'coal' ? mixed : done) },
      ganador: { gift: { state: 'available', availableAt: null }, journey: J(done) },
      carbon: { gift: { state: 'available', availableAt: null }, journey: J(mixed) },
      abierto: { gift: { state: 'opened', availableAt: null }, result: { authorized: true, kind: PV_KIND, amount: 1000 }, opened: { at: new Date(t - 3600e3 * 5).toISOString() }, credit: { status: PV_KIND === 'coal' ? 'not_applicable' : 'credited', at: new Date(t - 3600e3 * 5 + 120e3).toISOString() }, journey: J(PV_KIND === 'coal' ? mixed : done) } }[PV];
    var o = {}; [base, d].forEach(function (x) { Object.keys(x).forEach(function (k) { o[k] = x[k]; }); });
    if (PV === 'carbon') o.member = { loggedIn: true, displayName: 'Miembro de ejemplo', country: null };
    merge(o);
    b.hidden = false; txt.textContent = 'VISTA PREVIA DE DISEÑO · simulación · no entrega ni registra premios';
    if (PV === 'abierto') { ui.phase = 'result'; ui.tab = 'letter'; ui.fresh = false; }
    if (PV === 'ganador' || PV === 'carbon') {
      $('g-replay').hidden = false;
      $('g-replay').addEventListener('click', function () {
        if (ui.busy) return; var keep = o.journey; ui.phase = 'closed'; ui.tab = 'journey'; ui.fresh = false; model.gift = { state: 'available', availableAt: null }; model.result = null; model.opened = null; model.credit = null;
        gift.classList.remove('is-open', 'is-static', 'is-burst', 'is-shake'); render(); setTimeout(requestOpen, 700);
      });
      render(); setTimeout(requestOpen, reduce() ? 300 : 1100); return;
    }
    render();
  }

  /* ---------- API pública ---------- */
  window.GeoArmyRegalo = {
    applyServerData: function (d) { if (PV) return; merge(d); if (ui.phase === 'result' && !(model.gift.state === 'opened' && hasResult())) ui.phase = 'closed'; render(); },
    setOpenHandler: function (fn) { openHandler = typeof fn === 'function' ? fn : null; render(); },
    setConnectionError: function (v) { if (PV) return; model.error = !!v; render(); },
    snapshot: function () { return JSON.parse(JSON.stringify({ view: view(), mode: page.dataset.mode, model: model })); }
  };


  function connectServer(){
    const api=window.GeoArmyRegalo, base=window.GEOARMY_SUPABASE_URL, key=window.GEOARMY_SUPABASE_ANON_KEY;
    if(!window.supabase||!base||!key){api.setConnectionError(true);return;}
    const sb=window.supabase.createClient(base,key);
    let uid, seq=0, opening=false, syncing=false;
    async function call(action){
      const {data:s,error:e}=await sb.auth.getSession();
      if(e)throw e;
      if(!s.session)return null;
      const expected=s.session.user.id;
      const res=await fetch(base+'/functions/v1/christmas-gift',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+s.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action}),cache:'no-store'});
      const data=await res.json();
      const {data:latest}=await sb.auth.getSession();
      if(latest.session?.user.id!==expected||!res.ok||!data?.serverNow||!data?.gift)throw Error('gift_unavailable');
      return data;
    }
    async function refresh(){
      if(opening||syncing||ui.busy)return;
      const turn=++seq;syncing=true;
      try{
        const {data:s,error}=await sb.auth.getSession();if(error)throw error;
        const next=s.session?.user.id||null;
        if(uid!==undefined&&uid!==next){location.reload();return;}uid=next;
        if(!next){api.setOpenHandler(null);api.applyServerData({member:{loggedIn:false,displayName:null,country:null},gift:{state:'unavailable',availableAt:null},result:null,credit:null,opened:null,message:null,journey:{}});return;}
        const data=await call('status');if(turn!==seq||opening||!data)return;
        api.applyServerData(data);api.setOpenHandler(openGift);
      }catch(_){if(turn===seq){api.setOpenHandler(null);api.setConnectionError(true);}}
      finally{syncing=false;}
    }
    async function openGift(){
      if(opening)throw Error('busy');opening=true;++seq;
      try{const data=await call('open');if(!data)throw Error('login_required');return data;}
      catch(e){setTimeout(refresh,400);throw e;}
      finally{opening=false;}
    }
    sb.auth.onAuthStateChange((event,session)=>{
      const next=session?.user.id||null;
      if(uid!==undefined&&uid!==next){++seq;api.setOpenHandler(null);location.reload();return;}
      if(event==='INITIAL_SESSION'||event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(refresh,0);
    });
    document.addEventListener('geoarmy:regalo-refresh',()=>setTimeout(refresh,0));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    setInterval(refresh,60000);refresh();
  }

  /* ---------- Arranque ---------- */
  if (PV) setupPreview(); else { render(); connectServer(); }
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
})();
