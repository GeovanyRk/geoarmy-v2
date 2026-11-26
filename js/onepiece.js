// onepiece.js — Mini Pase Pirata (One Piece 2026) · FASE FINAL (un solo despliegue, control servidor).
//
// Funciones: autenticación existente, lecturas de acceso/progreso/catálogo y, con
// PURCHASE_ENABLED=true, oferta de precio por RPC autenticada y POST a onepiece-purchase.
// El precio y las recompensas se verifican en Supabase; el navegador nunca envía profile_id.
// Seguridad: interfaz preparada; el servidor Supabase mantiene el producto cerrado hasta aprobar el lanzamiento.
// sessionStorage guarda únicamente el UUID de solicitud para reintentos seguros, nunca tokens.
(function () {
  'use strict';

  var PURCHASE_ENABLED = true;    // LA VENTA SOLO SE HABILITA CUANDO LA RPC DE OFERTA SERVIDOR LA AUTORIZA
  var ANSWERS_ENABLED = true;     // misiones solo pasan a disponibles cuando el servidor las publica

  var RPC_TIMEOUT_MS = 8000;
  var MAX_XP = 900;
  var TOTAL_LEVELS = 10;
  var TOTAL_MISSIONS = 20;

  var CHAPTER_FALLBACK = [
    { n: 1, name: 'East Blue' }, { n: 2, name: 'Grand Line' },
    { n: 3, name: 'New World' }, { n: 4, name: 'Laugh Tale' }
  ];

  // Centro de cada número de nivel DENTRO de la imagen del planeta (px sobre 1374x1145).
  // Las zonas interactivas se superponen a los números ya dibujados en la imagen.
  var IMG_W = 1374, IMG_H = 1145;
  var NODES = [
    { x: 323.7, y: 903.7 }, { x: 591.8, y: 808.8 }, { x: 765.8, y: 768.9 }, { x: 637.3, y: 597.4 },
    { x: 762.7, y: 449.8 }, { x: 1037.4, y: 627.7 }, { x: 1145.0, y: 483.0 }, { x: 975.5, y: 366.0 },
    { x: 1035.8, y: 226.9 }, { x: 1212.8, y: 132.9 }
  ];
  // Ilustraciones definitivas (Fase 2D): <img> diferido, decorativo; las rutas viven solo aquí.
  var ART = {
    chapter: { 1: 'assets/onepiece/capitulo-1-east-blue.webp', 2: 'assets/onepiece/capitulo-2-grand-line.webp', 3: 'assets/onepiece/capitulo-3-new-world.webp', 4: 'assets/onepiece/capitulo-4-laugh-tale.webp' },
    chestSmall: { src: 'assets/onepiece/cofre-pequeno.webp', w: 380, h: 309 },
    chestPass: { src: 'assets/onepiece/cofre-pase-batalla.webp', w: 440, h: 440 },
    chestBuy: { src: 'assets/onepiece/cofre-tesoro-monedas.webp', w: 480, h: 392 }
  };
  function art(src, w, h2, cls) {
    return h('img', { src: src, width: String(w), height: String(h2), alt: '', loading: 'lazy', decoding: 'async', class: cls || '' });
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };

  // ---------- utilidades de DOM (todo texto de la BD entra por textContent) ----------
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
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function fmt(n) { return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('en-US') : '—'; }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof iso === 'string' ? iso : '');
    if (!m) return null;
    var mo = parseInt(m[2], 10) - 1;
    if (mo < 0 || mo > 11) return null;
    return parseInt(m[3], 10) + ' ' + MONTHS[mo];
  }
  function dateRange(a, b) {
    var x = shortDate(a), y = shortDate(b);
    return (x && y) ? x + ' – ' + y : (x || y || null);
  }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // iconos (sprite inline en onepiece.html)
  function use(id, cls) {
    var sv = s('svg', { 'class': cls || 'op-ic', 'aria-hidden': 'true', focusable: 'false' });
    var u = s('use', { href: '#' + id });
    sv.appendChild(u);
    return sv;
  }

  // ---------- estado ----------
  var S = { phase: 'loading', hasPass: false, access: null, progress: null, catalog: null, selected: null };
  var loadSeq = 0;
  var currentUid;
  var routeLens = null;
  var purchaseOffer = null;
  var purchaseBusy = false;
  var purchaseMessage = '';
  var PURCHASE_FN = 'onepiece-purchase';
  var PURCHASE_TIMEOUT_MS = 12000;
  var PURCHASE_PRICE = 3750;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function root() { return $('opRoot'); }
  function setPhase(p) { S.phase = p; var r = root(); if (r) r.setAttribute('data-op-state', p + (S.hasPass ? ' pass' : '')); }

  function getClient() { var A = window.GeoArmyAccount; return (A && A.client) ? A.client : null; }
  function waitForClient(maxMs) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var c = getClient();
        if (c) return resolve(c);
        if (Date.now() - t0 > maxMs) return resolve(null);
        setTimeout(poll, 100);
      })();
    });
  }
  function openLogin() {
    var A = window.GeoArmyAccount;
    if (A && typeof A.openLogin === 'function') A.openLogin();
    else if (A && typeof A.signInWithTwitch === 'function') A.signInWithTwitch();
  }

  // ---------- normalización defensiva ----------
  function normAccess(d) { return { has_access: !!d && typeof d === 'object' && d.has_access === true }; }
  function normProgress(d) {
    if (!d || typeof d !== 'object') return null;
    if (!(d.authenticated === true && d.has_access === true)) return { has_access: false };
    return {
      has_access: true,
      level: isInt(d.level) ? Math.min(Math.max(d.level, 1), TOTAL_LEVELS) : 1,
      xp_total: isInt(d.xp_total) ? Math.max(d.xp_total, 0) : 0,
      next_level_xp: isInt(d.next_level_xp) ? d.next_level_xp : null,
      max_xp: isInt(d.max_xp) && d.max_xp > 0 ? d.max_xp : MAX_XP,
      completed_missions: isInt(d.completed_missions) ? Math.max(d.completed_missions, 0) : 0,
      total_missions: isInt(d.total_missions) && d.total_missions > 0 ? d.total_missions : TOTAL_MISSIONS
    };
  }
  function normCatalog(d) {
    if (!d || typeof d !== 'object') return null;
    var chapters = Array.isArray(d.chapters) ? d.chapters.filter(function (c) { return c && isInt(c.chapter_number); }) : [];
    var levels = Array.isArray(d.levels) ? d.levels.filter(function (l) { return l && isInt(l.level) && isInt(l.required_xp); }) : [];
    levels.sort(function (a, b) { return a.level - b.level; });
    chapters.sort(function (a, b) { return a.chapter_number - b.chapter_number; });
    var st = ['upcoming', 'active', 'closed', 'unknown'].indexOf(d.season_status) >= 0 ? d.season_status : 'unknown';
    return { has_access: d.has_access === true, season_status: st, chapters: chapters, levels: levels };
  }
  function chapterStatus(c) { return (c && (c.status === 'open' || c.status === 'closed')) ? c.status : 'locked'; }

  // ---------- carga ----------
  async function load() {
    var seq = ++loadSeq;
    setPhase('loading');
    renderAll();

    var client = await waitForClient(6000);
    if (seq !== loadSeq) return;
    if (!client) { S.hasPass = false; S.access = S.progress = S.catalog = null; setPhase('error'); renderAll(); return; }

    var sessionRes;
    try { sessionRes = await withTimeout(client.auth.getSession(), RPC_TIMEOUT_MS); }
    catch (e) { if (seq === loadSeq) { setPhase('error'); renderAll(); } return; }
    if (seq !== loadSeq) return;

    var session = sessionRes && sessionRes.data && sessionRes.data.session;
    var uid = session && session.user ? session.user.id : null;
    if (uid !== currentUid) { S.selected = null; purchaseOffer = null; purchaseMessage = ''; }
    currentUid = uid;

    if (!session) {
      // Sin sesión: solo información pública. No se llama a ninguna RPC (todas exigen autenticación).
      S.hasPass = false; S.access = S.progress = S.catalog = null;
      setPhase('public'); renderAll();
      return;
    }

    try {
      var results = await Promise.all([
        withTimeout(client.rpc('onepiece_2026_my_access'), RPC_TIMEOUT_MS),
        withTimeout(client.rpc('onepiece_2026_get_my_progress'), RPC_TIMEOUT_MS),
        withTimeout(client.rpc('onepiece_2026_get_mission_catalog'), RPC_TIMEOUT_MS)
      ]);
      if (seq !== loadSeq) return;
      if (results[0].error || results[1].error || results[2].error) throw new Error('rpc');
      var access = normAccess(results[0].data), progress = normProgress(results[1].data), catalog = normCatalog(results[2].data);
      if (!progress || !catalog) throw new Error('shape');
      // Pase confirmado solo si las TRES lecturas coinciden (falla cerrada).
      S.hasPass = access.has_access && progress.has_access && catalog.has_access;
      S.access = access;
      S.progress = S.hasPass ? progress : null;
      S.catalog = catalog;
      purchaseOffer = null;
      if (PURCHASE_ENABLED && !S.hasPass) {
        try {
          var priceRes = await withTimeout(client.rpc('onepiece_2026_get_purchase_offer'), RPC_TIMEOUT_MS);
          if (seq !== loadSeq) return;
          var o = priceRes && !priceRes.error ? priceRes.data : null;
          if (o && o.available === true && o.currency_code === 'GCOIN' &&
              o.expected_amount_minor === PURCHASE_PRICE && UUID_RE.test(String(o.expected_price_id))) {
            purchaseOffer = { id: o.expected_price_id, amount: PURCHASE_PRICE };
          }
        } catch (e) { purchaseOffer = null; }
      }
      setPhase('ready');
    } catch (e) {
      if (seq !== loadSeq) return;
      S.hasPass = false; S.access = S.progress = S.catalog = null;
      setPhase('error');
    }
    renderAll();
  }

  // ---------- helpers de dominio ----------
  function levelState(n) {
    if (!S.hasPass || !S.progress) return 'preview';
    if (n < S.progress.level) return 'done';
    if (n === S.progress.level) return 'current';
    return 'todo';
  }
  function rewardOf(n) {
    if (n === 1) return { kind: 'start', short: 'Zarpar', title: 'Zarpar', sub: 'Punto de partida' };
    if (n === 10) return { kind: 'pass', short: 'Pase de Batalla', title: 'Pase de Batalla', sub: 'Entrega manual · pendiente' };
    return { kind: 'vbucks', short: 'VBUCKS', title: 'Recompensa VBUCKS', sub: 'Parte de los 1,500 VBUCKS' };
  }
  function levelXp(n) {
    var L = S.catalog && S.catalog.levels;
    if (L) for (var i = 0; i < L.length; i++) if (L[i].level === n) return L[i].required_xp;
    return n === 10 ? MAX_XP : null;
  }
  function chapterList() {
    if (S.catalog && S.catalog.chapters.length) {
      return S.catalog.chapters.map(function (c) {
        var fb = CHAPTER_FALLBACK[c.chapter_number - 1] || { name: 'Capítulo ' + c.chapter_number };
        return { n: c.chapter_number, name: (typeof c.title === 'string' && c.title.trim()) ? c.title : fb.name,
                 dates: dateRange(c.start_date, c.end_date), status: chapterStatus(c), src: c };
      });
    }
    return CHAPTER_FALLBACK.map(function (c) { return { n: c.n, name: c.name, dates: null, status: null, src: null }; });
  }
  // capítulo actual = el último que Supabase marca como abierto
  function currentChapter() {
    var list = chapterList(), cur = null;
    list.forEach(function (c) { if (c.status === 'open') cur = c; });
    return cur;
  }
  var STATUS_TXT = { locked: 'Bloqueado', open: 'Abierto', closed: 'Cerrado' };
  function statusIcon(st) { return use(st === 'locked' ? 'i-lock' : st === 'closed' ? 'i-check' : 'i-anchor', 'op-ic'); }
  function seasonLabel(st) { return { upcoming: 'Próximamente', closed: 'Temporada terminada', unknown: 'Estado no disponible' }[st] || null; }

  function loginButton(label, cls) {
    var b = h('button', { type: 'button', class: 'op-btn ' + (cls || 'op-btn-gold'), text: label || 'Iniciar sesión con Twitch' });
    b.addEventListener('click', openLogin);
    return b;
  }
  function retryButton() {
    var b = h('button', { type: 'button', class: 'op-btn op-btn-ghost', text: 'Reintentar' });
    b.addEventListener('click', load);
    return b;
  }
  function xpBar(xp, max) {
    var pct = max > 0 ? Math.min(100, Math.max(0, Math.round(xp * 1000 / max) / 10)) : 0;
    var fill = h('div', { class: 'op-bar-fill' }); fill.style.width = pct + '%';
    return h('div', { class: 'op-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': xp, 'aria-label': 'XP de temporada' }, [fill]);
  }

  // ---------- RENDER ----------
  function renderAll() {
    renderHero();
    renderNodes();
    renderPop();
    renderProgress();
    renderChapters();
    renderMedals();
    renderMissions();
    renderBuy();
  }

  function renderHero() {
    var cta = $('opCta'); if (!cta) return;
    clear(cta);
    var chip = $('opSeasonChip');
    var lbl = (S.phase === 'ready' && S.catalog) ? seasonLabel(S.catalog.season_status) : null;
    if (chip) { if (lbl) { chip.textContent = lbl; chip.hidden = false; } else { chip.hidden = true; } }

    if (S.phase === 'loading') { cta.appendChild(h('span', { class: 'op-cta-loading', text: 'Cargando…' })); return; }
    if (S.phase === 'error') { cta.appendChild(retryButton()); return; }
    if (S.phase === 'public') {
      cta.appendChild(loginButton('Iniciar sesión para zarpar'));
      cta.appendChild(h('a', { class: 'op-link', href: '#niveles', text: 'Ver recompensas' }));
      return;
    }
    if (!S.hasPass) {
      cta.appendChild(h('a', { class: 'op-btn op-btn-gold', href: '#pase', text: 'Conseguir el Mini Pase' }));
      cta.appendChild(h('a', { class: 'op-link', href: '#niveles', text: 'Ver recompensas' }));
      return;
    }
    cta.appendChild(h('a', { class: 'op-btn op-btn-gold', href: '#misiones', text: 'Ver mis misiones' }));
    cta.appendChild(h('a', { class: 'op-link', href: '#progreso', text: 'Mi progreso' }));
  }

  // ---------- planeta: 10 zonas interactivas sobre los números de la imagen ----------
  function pct(v, total) { return (v / total * 100).toFixed(3) + '%'; }
  function renderNodes() {
    var box = $('opNodes'); if (!box) return;
    clear(box);
    NODES.forEach(function (nd, i) {
      var n = i + 1, st = levelState(n), rw = rewardOf(n);
      var b = h('button', {
        type: 'button', class: 'op-node', 'data-state': st, 'data-level': n, 'data-selected': S.selected === n ? 'true' : 'false',
        'aria-label': 'Isla ' + n + ': ' + rw.title + (st === 'done' ? ' (alcanzada)' : st === 'current' ? ' (isla actual)' : ''),
        'aria-pressed': S.selected === n ? 'true' : 'false'
      });
      b.style.left = pct(nd.x, IMG_W); b.style.top = pct(nd.y, IMG_H);
      if (st === 'current') b.appendChild(h('span', { class: 'op-node-here', text: 'Estás aquí' }));
      b.addEventListener('click', function (e) { e.stopPropagation(); selectLevel(S.selected === n ? null : n); });
      box.appendChild(b);
    });
  }

  function selectLevel(n) { S.selected = n; renderNodes(); renderPop(); }

  function renderPop() {
    var pop = $('opPop'), hint = $('opStageHint'); if (!pop) return;
    clear(pop);
    var n = S.selected;
    if (!n) { pop.hidden = true; if (hint) hint.hidden = false; return; }
    if (hint) hint.hidden = true;
    var nd = NODES[n - 1], rw = rewardOf(n), st = levelState(n), xp = levelXp(n);
    pop.style.left = Math.max(16, Math.min(84, nd.x / IMG_W * 100)).toFixed(2) + '%';
    pop.style.top = (nd.y / IMG_H * 100).toFixed(2) + '%';
    pop.setAttribute('data-below', nd.y < 330 ? 'true' : 'false');
    pop.appendChild(h('div', { class: 'op-pop-head' }, [
      h('span', { class: 'op-pop-lv', text: 'Isla ' + n }),
      st === 'done' ? h('span', { class: 'op-chip', text: 'Alcanzada' }) :
      st === 'current' ? h('span', { class: 'op-chip op-chip-on', text: 'Estás aquí' }) : null
    ]));
    pop.appendChild(h('strong', { text: rw.title }));
    if (rw.sub) pop.appendChild(h('span', { class: 'op-pop-sub', text: rw.sub }));
    if (xp !== null && n > 1) pop.appendChild(h('span', { class: 'op-pop-xp', text: fmt(xp) + ' XP' }));
    pop.hidden = false;
  }

  // ---------- progreso: una sola barra compacta ----------
  function renderProgress() {
    var box = $('opProgress'); if (!box) return;
    clear(box);
    box.setAttribute('data-kind', S.hasPass ? 'pass' : 'invite');
    function row(icon, textNodes, action) {
      box.appendChild(h('div', { class: 'op-invite' }, [h('i', { class: 'op-invite-ico' }, [use(icon, 'op-ic')]), h('p', {}, textNodes), action]));
    }
    if (S.phase === 'loading') { box.appendChild(h('p', { class: 'op-muted', text: 'Cargando tu travesía…' })); return; }
    if (S.phase === 'error') { row('i-anchor', [h('b', { text: 'No pudimos leer tu pase.' })], retryButton()); return; }
    if (S.phase === 'public') {
      row('i-compass', [h('b', { text: 'Zarpa con tu cuenta.' }), h('span', { class: 'op-hide-m', text: ' Entra con Twitch para ver tu pase y tu progreso.' })], loginButton('Iniciar sesión', 'op-btn-gold op-btn-sm'));
      return;
    }
    if (!S.hasPass) {
      row('i-compass', [h('b', { text: 'Aún no tienes el pase.' }), h('span', { class: 'op-hide-m', text: ' Consíguelo y empieza tu aventura en la Grand Line.' })], h('a', { class: 'op-btn op-btn-gold op-btn-sm', href: '#pase', text: 'Ver el pase' }));
      return;
    }
    var p = S.progress, ch = currentChapter();
    var chTxt = ch ? ch.name : (S.catalog && S.catalog.season_status === 'closed' ? 'Temporada terminada' : 'Próximamente');
    box.appendChild(h('div', { class: 'op-prog-top' }, [
      h('div', { class: 'op-stat' }, [h('small', { text: 'Nivel' }), h('strong', { text: p.level + ' / ' + TOTAL_LEVELS })]),
      h('div', { class: 'op-stat' }, [h('small', { text: 'XP' }), h('strong', { text: fmt(p.xp_total) + ' / ' + fmt(p.max_xp) })]),
      h('div', { class: 'op-stat' }, [h('small', { text: 'Capítulo' }), h('strong', { text: chTxt })]),
      h('div', { class: 'op-stat op-hide-m' }, [h('small', { text: 'Misiones' }), h('strong', { text: p.completed_missions + ' / ' + p.total_missions })])
    ]));
    box.appendChild(xpBar(p.xp_total, p.max_xp));
    box.appendChild(h('p', { class: 'op-tiny', text: p.next_level_xp === null ? 'Nivel máximo alcanzado' : 'Faltan ' + fmt(Math.max(0, p.next_level_xp - p.xp_total)) + ' XP para el siguiente nivel' }));
  }

  // ---------- capítulos: cards con ilustración (slot) ----------
  function renderChapters() {
    var ol = $('opChapters'); if (!ol) return;
    clear(ol);
    chapterList().forEach(function (c) {
      var st = c.status || 'locked';
      var artBox = h('i', { class: 'op-chapter-art', 'aria-hidden': 'true' }, ART.chapter[c.n] ? [art(ART.chapter[c.n], 640, 360)] : []);
      ol.appendChild(h('li', { class: 'op-chapter', 'data-status': c.status || 'unknown', 'data-chapter': c.n }, [
        artBox,
        h('span', { class: 'op-chapter-n', text: String(c.n) }),
        h('strong', { class: 'op-cn' }, [h('a', { class: 'op-chapter-link', href: '#misiones', 'data-cap': String(c.n), text: c.name })]),
        h('span', { class: 'op-chapter-date', text: c.dates || '· · ·' }),
        h('span', { class: 'op-chapter-state' }, [statusIcon(st), h('em', { text: c.status ? STATUS_TXT[st] : 'Por abrir' })])
      ]));
    });
  }

  // ---------- recompensas: 10 pergaminos ----------
  function renderMedals() {
    var ol = $('opMedals'); if (!ol) return;
    clear(ol);
    for (var n = 1; n <= TOTAL_LEVELS; n++) {
      var rw = rewardOf(n), st = levelState(n);
      var iconBox;
      if (rw.kind === 'vbucks') iconBox = h('span', { class: 'op-scroll-ico op-slot-wrap', 'data-slot': 'moneda-vbucks' }, [use('i-vcoin', 'op-ic')]);
      else { var cz = rw.kind === 'pass' ? ART.chestPass : ART.chestSmall; iconBox = h('span', { class: 'op-scroll-ico op-scroll-chest' }, [art(cz.src, cz.w, cz.h)]); }
      var li = h('li', { class: 'op-scroll', 'data-state': st, 'data-kind': rw.kind, title: 'Nivel ' + n + ' · ' + rw.title }, [
        h('b', { class: 'op-scroll-n', text: String(n) }),
        iconBox,
        h('small', { text: rw.kind === 'vbucks' ? 'VBUCKS' : rw.short })
      ]);
      if (st === 'done') li.appendChild(h('i', { class: 'op-scroll-ok', 'aria-hidden': 'true' }, [use('i-check', 'op-ic')]));
      ol.appendChild(li);
    }
  }

  // ---------- misiones: teaser o lista compacta ----------
  function renderMissions() {
    var box = $('opMissions'); if (!box) return;
    clear(box);
    var block = $('misiones');
    function teaser(text, action) {
      block.setAttribute('data-mode', 'teaser');
      box.appendChild(h('div', { class: 'op-teaser' }, [use('i-lock', 'op-ic op-ic-lock'), h('p', { text: text }), action]));
    }
    block.setAttribute('data-mode', 'list');
    if (S.phase === 'loading') { box.appendChild(h('p', { class: 'op-muted', text: 'Cargando…' })); return; }
    if (S.phase === 'public') { teaser('20 misiones en 4 capítulos. Inicia sesión para verlas.', loginButton('Iniciar sesión', 'op-btn-gold op-btn-sm')); return; }
    if (S.phase === 'error') { teaser('No pudimos cargar las misiones.', retryButton()); return; }
    if (!S.hasPass) { teaser('20 misiones se abren con el pase.', h('a', { class: 'op-btn op-btn-gold op-btn-sm', href: '#pase', text: 'Ver el pase' })); return; }

    var chs = chapterList(), cur = currentChapter(), anyMissions = false;
    chs.forEach(function (c) {
      var missions = (c.src && Array.isArray(c.src.missions)) ? c.src.missions : [];
      var det = h('details', { class: 'op-mch', id: 'opCap' + c.n, 'data-status': c.status });
      if (cur && c.n === cur.n) det.setAttribute('open', '');
      var done = missions.filter(function (m) { return m && m.completed === true; }).length;
      det.appendChild(h('summary', {}, [
        h('span', { class: 'op-chapter-n', text: String(c.n) }),
        h('strong', { text: c.name }),
        h('span', { class: 'op-mch-meta', text: c.status === 'locked' ? (c.dates ? 'Abre ' + c.dates.split(' – ')[0] : 'Bloqueado') : (missions.length ? done + '/' + missions.length : '—') }),
        h('span', { class: 'op-chapter-state' }, [statusIcon(c.status)])
      ]));
      if (c.status === 'locked') {
        det.appendChild(h('p', { class: 'op-muted op-pad', text: 'Se abre en su fecha.' }));
      } else if (!missions.length) {
        det.appendChild(h('p', { class: 'op-muted op-pad', text: 'Sin misiones publicadas todavía.' }));
      } else {
        anyMissions = true;
        var grid = h('div', { class: 'op-mgrid' });
        missions.forEach(function (m) { grid.appendChild(missionCard(m)); });
        det.appendChild(grid);
      }
      box.appendChild(det);
    });
    if (!anyMissions && S.catalog && S.catalog.season_status === 'unknown') {
      box.appendChild(h('p', { class: 'op-muted', text: 'Misiones cerradas hasta confirmar el estado de la temporada.' }));
    }
    applyHash();
  }

  function fmtUnlock(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
    try {
      var d = new Date(iso); if (isNaN(d.getTime())) return null;
      return d.toLocaleString('es', { timeZone: 'America/New_York', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + ' NY';
    } catch (e) { return null; }
  }
  function missionCard(m) {
    var completed = m && m.completed === true, available = m && m.available === true;
    var state = completed ? 'done' : available ? 'available' : 'closed';
    var label = completed ? 'Completada' : available ? 'Disponible' : 'No disponible';
    var title = (m && typeof m.title === 'string') ? m.title : 'Misión';
    var desc = (m && typeof m.description === 'string') ? m.description : '';
    var xp = (m && isInt(m.xp_reward)) ? m.xp_reward : null;
    var key = (m && typeof m.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(m.id)) ? m.id : null;
    // Disponibles y completadas abren la página dinámica (onepiece-mision.html). El servidor sigue decidiendo qué se ve allí:
    // este enlace no desbloquea nada ni envía respuestas.
    var linkable = key && (available || completed);
    // Fase 7D: si el servidor trae unlocks_at para una misión aún cerrada, se muestra la fecha de apertura (solo informativo; el servidor decide).
    var when = (!completed && !available) ? fmtUnlock(m && m.unlocks_at) : null;
    if (when) label = 'Abre ' + when;
    var card = h(linkable ? 'a' : 'article', { class: 'op-mission', 'data-state': state, href: linkable ? 'onepiece-mision.html?m=' + encodeURIComponent(key) : null }, [
      h('div', { class: 'op-mission-top' }, [h('span', { class: 'op-mission-badge', text: label }), xp !== null ? h('span', { class: 'op-mission-xp', text: 'Hasta +' + xp + ' XP' }) : null]),
      h('h3', { text: title }),
      desc ? h('p', { text: desc }) : null
    ]);
    if (linkable) card.appendChild(h('span', { class: 'op-go', text: completed ? 'Ver misión' : 'Abrir misión' }));
    return card;
  }

  // abre el capítulo n en la lista de misiones y baja hasta él (los enlaces de las tarjetas de capítulo y el "volver" de la misión)
  function openChapter(n, smooth) {
    var d = $('opCap' + n);
    var target = d || $('misiones');
    if (!target) return;
    if (d) d.setAttribute('open', '');
    var reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    try { target.scrollIntoView({ behavior: (smooth && !reduce) ? 'smooth' : 'auto', block: 'start' }); } catch (e) { target.scrollIntoView(); }
    var sm = d && d.querySelector('summary'); if (sm && sm.focus) { try { sm.focus({ preventScroll: true }); } catch (e) {} }
  }
  var hashDone = false;
  function applyHash() {
    if (hashDone) return;
    var m = /^#opCap([1-4])$/.exec(location.hash || '');
    if (!m) { hashDone = true; return; }
    if (!S.hasPass) return;   // sin pase no existe la lista; se reintenta tras la siguiente carga
    hashDone = true; setTimeout(function () { openChapter(parseInt(m[1], 10), false); }, 0);
  }

  // ---------- compra: bloqueada mientras Supabase no publica la oferta ----------
  // Precio consultado de la base mediante RPC autenticada de solo lectura.
  // La Edge Function comprueba el precio y la identidad de nuevo en el servidor.
  function purchaseUrl() {
    var c = getClient(), u = window.GEOARMY_SUPABASE_URL;
    if (typeof u !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(u)) u = c && c.supabaseUrl;
    return (typeof u === 'string' && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(u))
      ? u + '/functions/v1/' + PURCHASE_FN : null;
  }
  function pendingRequestKey() { return 'op26_purchase_request_' + String(currentUid); }
  function getPurchaseRequestId() {
    if (!currentUid || !UUID_RE.test(currentUid)) return null;
    var k = pendingRequestKey(), id = null;
    try { id = sessionStorage.getItem(k); } catch (e) {}
    if (id && UUID_RE.test(id)) return id;
    if (!window.crypto || typeof window.crypto.randomUUID !== 'function') return null;
    id = window.crypto.randomUUID();
    try { sessionStorage.setItem(k, id); } catch (e) {}
    return id;
  }
  function clearPurchaseRequestId() {
    try { sessionStorage.removeItem(pendingRequestKey()); } catch (e) {}
  }
  async function buyPass(confirm, checkbox) {
    if (!PURCHASE_ENABLED || purchaseBusy || S.phase !== 'ready' || S.hasPass || !purchaseOffer ||
        !checkbox.checked || !currentUid) return;
    var c = getClient(), url = purchaseUrl(), rid = getPurchaseRequestId();
    if (!c || !url || !rid) { purchaseMessage = 'No se pudo preparar la compra. Recarga la página.'; renderBuy(); return; }
    purchaseBusy = true;
    confirm.disabled = true;
    purchaseMessage = 'Procesando compra…';
    var statusEl = $('opBuyFeedback'); if (statusEl) statusEl.textContent = purchaseMessage;
    var token = null;
    try {
      var sess = await withTimeout(c.auth.getSession(), RPC_TIMEOUT_MS);
      var ss = sess && sess.data && sess.data.session;
      if (ss && ss.user && ss.user.id !== currentUid) throw new Error('account_changed');
      token = ss && ss.access_token;
    } catch (e) { token = null; }
    if (!token) { purchaseBusy = false; purchaseMessage = 'Sesión vencida. Inicia sesión de nuevo.'; renderBuy(); return; }
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (ctl) ctl.abort(); }, PURCHASE_TIMEOUT_MS);
    var data = null, response = null;
    try {
      response = await fetch(url, {
        method: 'POST', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ client_request_id: rid, expected_price_id: purchaseOffer.id, expected_amount_minor: PURCHASE_PRICE })
      });
      try { data = await response.json(); } catch (e) { data = null; }
    } catch (e) {
      purchaseBusy = false;
      clearTimeout(timeout);
      purchaseMessage = 'No se pudo confirmar la respuesta. Reintenta: se conservará el mismo identificador de compra.';
      renderBuy(); return;
    }
    clearTimeout(timeout);
    purchaseBusy = false;
    if (data && data.ok === true && (data.status === 'purchased' || data.status === 'already_processed')) {
      purchaseMessage = '';
      await load();
      if (S.hasPass) clearPurchaseRequestId();
      else { purchaseMessage = 'Pedido procesado, pero aún no se refleja el pase. Si reintentas, se usará la misma solicitud.'; renderBuy(); }
      return;
    }
    var code = data && typeof data.error === 'string' ? data.error : '';
    if (code === 'already_owned') { clearPurchaseRequestId(); await load(); return; }
    var errors = {
      insufficient_funds: 'No tienes suficientes G-Coins para comprar el pase.',
      price_changed: 'El precio cambió. Actualiza antes de volver a intentar.',
      not_available: 'El pase aún no está disponible para comprar.',
      unauthorized: 'Tu sesión venció. Inicia sesión de nuevo.',
      rate_limited: 'Demasiados intentos. Vuelve a intentarlo más tarde.',
      request_conflict: 'Esta solicitud ya fue utilizada con otros datos. Contacta a soporte.',
      service_unavailable: 'Servicio temporalmente no disponible. Reintenta sin cambiar de sesión.'
    };
    purchaseMessage = errors[code] || 'No se pudo confirmar la compra. No vuelvas a intentarlo con otra cuenta.';
    // No borrar rid ante error ambiguo: evita un segundo cobro tras timeout/reintento.
    renderBuy();
  }
  function renderBuy() {
    var box = $('opBuy'); if (!box) return;
    clear(box);
    if (S.phase === 'ready' && S.hasPass) {
      box.setAttribute('data-owned', 'true');
      box.appendChild(h('div', { class: 'op-owned' }, [
        h('i', { class: 'op-invite-ico' }, [use('i-skull', 'op-ic')]),
        h('div', {}, [h('strong', { text: 'Ya tienes el Mini Pase Pirata' }), h('span', { class: 'op-hide-m', text: 'Activo durante toda la temporada.' })])
      ]));
      return;
    }
    box.removeAttribute('data-owned');

    function chip(icon, nodes) { return h('li', {}, [use(icon, 'op-ic'), h('span', {}, nodes)]); }
    var left = h('div', { class: 'op-buy-left' }, [
      h('span', { class: 'op-buy-tag', text: 'Mini Pase Pirata' }),
      h('div', { class: 'op-price' }, [use('i-coin', 'op-ic op-ic-coin'), h('b', { text: '3,750' }), h('span', { text: 'G-Coins' })])
    ]);
    var chest = h('i', { class: 'op-buy-chest', 'aria-hidden': 'true' }, [art(ART.chestBuy.src, ART.chestBuy.w, ART.chestBuy.h)]);

    var canBuy = PURCHASE_ENABLED && S.phase === 'ready' && !S.hasPass && !!purchaseOffer &&
      !purchaseBusy && !!currentUid;
    var chk = h('input', { type: 'checkbox', id: 'opAck', disabled: !canBuy });
    var confirm = h('button', { type: 'button', class: 'op-btn op-btn-gold', id: 'opConfirm', disabled: true, 'aria-disabled': 'true', text: purchaseBusy ? 'Procesando…' : 'Confirmar compra' });
    chk.addEventListener('change', function () {
      confirm.disabled = !(canBuy && chk.checked);
      confirm.setAttribute('aria-disabled', confirm.disabled ? 'true' : 'false');
    });
    confirm.addEventListener('click', function () { buyPass(confirm, chk); });
    var right = h('div', { class: 'op-buy-right' }, [
      h('ul', { class: 'op-buy-chips' }, [
        chip('i-wheel', ['10 niveles']), chip('i-map', ['20 misiones']), chip('i-vcoin', ['1,500 VBUCKS']), chip('i-crown', ['Pase de Batalla'])
      ]),
      h('p', { class: 'op-notice' }, [h('b', { text: 'Compra final · sin reembolso.' }), h('span', { text: ' Se descuentan 3,750 G-Coins y no se puede cancelar.' })]),
      h('div', { class: 'op-buy-confirm' }, [
        h('div', {}, [
          h('label', { class: 'op-ack', for: 'opAck' }, [chk, h('span', { text: 'Entiendo que no hay reembolso.' })]),
          h('p', { class: 'op-tiny', text: !PURCHASE_ENABLED ? 'Se habilita en el lanzamiento · 3 nov 2026.' : (canBuy ? 'Precio validado por Supabase. Marca la casilla para confirmar.' : 'Compra no disponible por ahora.') }),
          h('p', { class: 'op-tiny', id: 'opBuyFeedback', role: 'status', text: purchaseMessage })
        ]),
        confirm
      ])
    ]);
    if (S.phase === 'public') right.appendChild(h('div', { class: 'op-buy-login' }, [loginButton('Iniciar sesión para comprar', 'op-btn-ghost op-btn-sm')]));
    var rope = h('i', { class: 'op-slot op-buy-rope', 'data-slot': 'cuerda-ancla', 'aria-hidden': 'true' });
    var wanted = h('aside', { class: 'op-slot op-wanted', 'data-slot': 'cartel-wanted', 'aria-hidden': 'true' }, [h('b', { text: 'WANTED' }), h('span', { text: 'Mini Pase Pirata' })]);
    box.appendChild(rope);
    box.appendChild(h('div', { class: 'op-buy-grid' }, [left, chest, right, wanted]));
  }

  // ---------- arranque ----------
  function wireAuth() {
    var c = getClient();
    if (!c || !c.auth || typeof c.auth.onAuthStateChange !== 'function') return;
    c.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(load, 0);
    });
  }
  function init() {
    var r = root(); if (!r) return;
    r.setAttribute('data-op-purchase', PURCHASE_ENABLED ? 'on' : 'off');
    r.setAttribute('data-op-answers', ANSWERS_ENABLED ? 'on' : 'off');
    // ?slots=1 -> muestra etiquetas sobre cada recurso gráfico pendiente (solo para revisión)
    try { if (/[?&]slots=1\b/.test(location.search)) r.classList.add('op-show-slots'); } catch (e) {}
    document.addEventListener('click', function (e) { var pop = $('opPop'); if (S.selected && pop && !pop.contains(e.target)) selectLevel(null); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.selected) selectLevel(null); });
    var chs = $('opChapters');
    if (chs) chs.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a.op-chapter-link') : null;
      if (!a) return;
      e.preventDefault();
      openChapter(parseInt(a.getAttribute('data-cap'), 10), true);
    });
    renderAll();
    waitForClient(6000).then(function (c) { if (c) wireAuth(); });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
