/* ============================================================================
   GEO ARMY Plus — comportamiento de la PÁGINA EXCLUSIVA plus.html (js/geoarmy-plus-page.js).  SOLO PRESENTACIÓN + disparar reclamos.
   - Todo lo que se muestra de una cuenta sale de UNA llamada al servidor (RPC autenticada geo_plus_hub_v1). Sin Plus vigente el servidor devuelve
     solo {access:false, status}: esta página no recibe cifras, misiones ni recompensas que ocultar. El candado visual NO es la autorización.
   - NO calcula Plus, progreso, semanas, plazos ni montos. Textos con textContent (nunca innerHTML con datos).
   - Un fallo de red / de la base / respuesta rara NO es «sin Plus»: estado «unknown» con botón Reintentar; si ya había datos buenos de ESTA cuenta, se
     siguen mostrando con un aviso. Solo el servidor dice «sin Plus» (regla de 24 h).
   - Reclamo semanal: POST {mission, week} (lista cerrada) a la Edge Function plus-weekly-claim con el JWT; el servidor decide todo. Un resultado desconocido
     (timeout/corte) NO se muestra como «no se cobró»: se vuelve a comprobar y reintentar es seguro (idempotente).
   - La misión DIARIA no se reclama aquí: el reclamo automático sigue siendo el de js/geoarmy-plus-daily.js (cargado por geoarmy-account.js en TODAS las
     páginas). La tarjeta de esta página solo pinta su estado (evento/observador del módulo), igual que antes hacía Misiones.
   - Sin el interruptor GEOARMY_PLUS_PAGE_ENABLED === true la página muestra «próximamente» y no pregunta nada al servidor.
   ============================================================================ */
(function () {
  'use strict';
  var win = window, doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var root = $('plRoot');
  if (!root) return;
  var SUBS_URL = 'https://www.twitch.tv/subs/geovannyrk';
  var TIMEOUT_MS = 10000, CLAIM_TIMEOUT_MS = 25000, REFRESH_MS = 120000, WAKE_MIN_MS = 60000;
  var state = 'loading', hub = null, hubUid = null, ticket = 0, lastLoad = 0, timer = null, claimBusy = {};
  var MISSIONS = {
    chat_messages: { id: 'plChat', unit: 'mensajes', pendingText: null },
    redeem_points: { id: 'plRedeem', unit: 'puntos de canal', pendingText: 'en espera: cuentan cuando Geo los marque como cumplidos' }
  };

  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function client() { return win.GeoArmyAccount && win.GeoArmyAccount.client ? win.GeoArmyAccount.client : null; }
  function num(n) { try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); } }
  function setText(id, t) { var el = $(id); if (el) el.textContent = t == null ? '' : String(t); }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }

  function untilText(iso, prefix) {
    var ms = Date.parse(iso) - Date.now();
    if (!isFinite(ms) || ms <= 0) return '';
    var mins = Math.max(1, Math.ceil(ms / 60000)), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    var parts = [];
    if (d > 0) parts.push(d + ' d');
    if (h > 0) parts.push(h + ' h');
    if (d === 0) parts.push(m + ' min');
    return prefix + ' ' + parts.join(' ');
  }

  /* ---------- estados generales ---------- */
  function setState(next) {
    state = next; root.setAttribute('data-state', next);
    var chip = { loading: 'Comprobando…', anon: 'Sin sesión', noplus: 'Sin Plus activo', unverified: 'Sin confirmar', unknown: 'No pudimos comprobarlo', plus: 'Plus activo', off: 'Próximamente' }[next] || '';
    setText('plChip', chip);
    show('plSkel', next === 'loading');
    show('plGateAnon', next === 'anon'); show('plGateNoPlus', next === 'noplus'); show('plGateUnverified', next === 'unverified');
    show('plGateUnknown', next === 'unknown'); show('plGateOff', next === 'off'); show('plMain', next === 'plus');
  }

  /* ---------- pintar datos (solo si el servidor dijo access:true) ---------- */
  function renderWeekly(w) {
    var def = MISSIONS[w.mission]; if (!def) return;
    var card = $(def.id); if (!card) return;
    var st = w.status, target = Number(w.target) || 0, cur = Math.max(0, Number(w.current) || 0), pend = Math.max(0, Number(w.pending) || 0);
    var pct = target > 0 ? Math.min(100, Math.floor((cur / target) * 100)) : 0;
    var badge = $(def.id + 'Badge'), status = $(def.id + 'Status'), sub = $(def.id + 'Sub'), btn = $(def.id + 'Btn'), bar = $(def.id + 'Bar'), row = $(def.id + 'Row');
    card.setAttribute('data-status', st);
    setText(def.id + 'Reward', num(w.reward));
    status.className = 'pl-m-status'; badge.className = 'pl-badge'; btn.hidden = true; btn.disabled = false;
    var showBar = st === 'in_progress' || st === 'ready' || st === 'claimed';
    show(def.id + 'BarWrap', showBar); show(def.id + 'Row', showBar);
    if (showBar) { bar.style.width = (st === 'claimed' ? 100 : pct) + '%'; setText(def.id + 'Count', num(Math.min(cur, target || cur)) + ' / ' + num(target) + ' ' + def.unit); setText(def.id + 'Pct', (st === 'claimed' ? 100 : pct) + '%'); }
    var sublines = [];
    if (st === 'not_configured') { badge.textContent = 'Próximamente'; badge.className = 'pl-badge pl-badge--soon'; status.textContent = 'Esta misión aún se está preparando.'; }
    else if (st === 'disabled') { badge.textContent = 'Próximamente'; badge.className = 'pl-badge pl-badge--soon'; status.textContent = 'Esta misión aún no está activa.'; }
    else if (st === 'no_twitch_link') { badge.textContent = 'Falta vincular'; status.textContent = 'Vincula tu cuenta de Twitch para que podamos contar tu actividad.'; status.className = 'pl-m-status is-warn'; }
    else if (st === 'in_progress') { badge.textContent = 'En curso'; status.textContent = 'Te faltan ' + num(Math.max(0, target - cur)) + ' ' + def.unit + '.'; }
    else if (st === 'ready') {
      badge.textContent = 'Meta cumplida'; badge.className = 'pl-badge pl-badge--done';
      if (w.claim_open) { status.textContent = '¡Lista para reclamar!'; status.className = 'pl-m-status is-good'; btn.hidden = false; btn.textContent = 'Reclamar ' + num(w.reward) + ' G-Coins'; btn.setAttribute('data-mission', w.mission); btn.setAttribute('data-week', 'current'); }
      else { status.textContent = 'Meta cumplida. El reclamo aún no está abierto.'; }
    }
    else if (st === 'claimed') { badge.textContent = 'Reclamada'; badge.className = 'pl-badge pl-badge--done'; status.textContent = 'Ya reclamaste esta semana.'; status.className = 'pl-m-status is-good'; }
    else { badge.textContent = '—'; status.textContent = ''; }
    if (pend > 0 && def.pendingText && (st === 'in_progress' || st === 'ready' || st === 'claimed')) sublines.push('+' + num(pend) + ' ' + def.unit + ' ' + def.pendingText + '.');
    if (st === 'in_progress' || st === 'ready') { var t = untilText(hub && hub.week && hub.week.next_reset_at, 'La semana se reinicia en'); if (t) sublines.push(t + '.'); }
    else if (st === 'claimed') { var t2 = untilText(hub && hub.week && hub.week.next_reset_at, 'Vuelve el lunes: nueva misión en'); if (t2) sublines.push(t2 + '.'); }
    sub.textContent = sublines.join(' ');
  }
  function renderPrevious(list) {
    var box = $('plPrev'), ul = $('plPrevList'); ul.textContent = '';
    if (!list || !list.length) { box.hidden = true; return; }
    list.forEach(function (p) {
      var def = MISSIONS[p.mission]; if (!def) return;
      var row = doc.createElement('div'); row.className = 'pl-m-top'; row.style.alignItems = 'center'; row.style.justifyContent = 'space-between'; row.style.flexWrap = 'wrap';
      var t = doc.createElement('p'); t.className = 'pl-m-status'; t.style.margin = '4px 0';
      t.textContent = (p.mission === 'chat_messages' ? 'Mensajes de chat' : 'Ruletas del canal') + ' · ' + num(p.evidence) + ' / ' + num(p.target) + ' · ' + num(p.amount) + ' G-Coins';
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'pl-btn pl-btn--primary'; b.textContent = 'Reclamar';
      b.setAttribute('data-mission', p.mission); b.setAttribute('data-week', 'previous');
      row.appendChild(t); row.appendChild(b); ul.appendChild(row);
    });
    var until = hub && hub.week && hub.week.claim_until_prev ? untilText(hub.week.claim_until_prev, 'Tienes un plazo de gracia: quedan') : '';
    setText('plPrevUntil', until ? until + '.' : '');
    box.hidden = false;
  }
  function renderDailyFromHub(d) {   // respaldo solo si el módulo de la diaria no está disponible; la fuente principal es el módulo (ver más abajo)
    if (!d) return;
    if (win.GeoArmyPlusDaily && typeof win.GeoArmyPlusDaily.subscribe === 'function') return;
    var card = $('plDaily'); card.hidden = !d.enabled; if (!d.enabled) return;
    card.setAttribute('data-state', d.claimed_today ? 'already_claimed' : 'idle');
    setText('plDailyStatus', d.claimed_today ? 'Ya recibiste tus ' + num(d.amount) + ' G-Coins de hoy.' : 'Entra con tu sesión iniciada y se acreditan solos.');
    setText('plDailySub', untilText(d.next_reset_at, 'Se reinicia a medianoche (hora de Nueva York), en'));
  }
  function renderPlus() {
    (hub.weekly || []).forEach(renderWeekly);
    renderPrevious(hub.previous);
    renderDailyFromHub(hub.daily);
    show('plStale', false);
  }

  /* ---------- carga ---------- */
  function load(reason) {
    var mine = ++ticket, c = client();
    if (win.GEOARMY_PLUS_PAGE_ENABLED !== true) { setState('off'); return Promise.resolve(); }
    if (!c || !c.auth) { if (!hub) setState('loading'); return Promise.resolve(); }
    return withTimeout(c.auth.getSession(), TIMEOUT_MS).then(function (r) {
      if (mine !== ticket) return;
      var s = r && r.data && r.data.session;
      if (!s || !s.user) { hub = null; hubUid = null; setState('anon'); return; }
      var uid = s.user.id;
      if (hubUid && hubUid !== uid) { hub = null; }              // otra cuenta: nada de la anterior
      if (!hub) setState('loading');
      return withTimeout(c.rpc('geo_plus_hub_v1'), TIMEOUT_MS).then(function (resp) {
        if (mine !== ticket) return;
        if (resp && resp.error) throw new Error('rpc');
        var d = resp && resp.data;
        if (!d || typeof d.access !== 'boolean') throw new Error('shape');
        lastLoad = Date.now();
        if (d.access === true) { hub = d; hubUid = uid; setState('plus'); renderPlus(); }
        else { hub = null; hubUid = uid; setState(d.status === 'unverified' ? 'unverified' : 'noplus'); }
      });
    }).catch(function () {
      if (mine !== ticket) return;
      if (hub) { show('plStale', true); return; }                // ya había datos buenos de esta cuenta: se conservan con aviso
      setState('unknown');
    });
  }

  /* ---------- reclamo semanal ---------- */
  function claim(btn) {
    var mission = btn.getAttribute('data-mission'), week = btn.getAttribute('data-week'), key = mission + ':' + week;
    if (claimBusy[key]) return;
    var c = client(); if (!c || !win.GEOARMY_SUPABASE_URL) return;
    claimBusy[key] = true; btn.disabled = true; setText('plClaimMsg', 'Reclamando…');
    var done = function (msg) { claimBusy[key] = false; setText('plClaimMsg', msg || ''); load('claim'); try { if (win.GeoArmyAccount && win.GeoArmyAccount.refreshWidget) win.GeoArmyAccount.refreshWidget(); } catch (e) { /* ignorar */ } };
    withTimeout(c.auth.getSession(), TIMEOUT_MS).then(function (r) {
      var s = r && r.data && r.data.session; if (!s) throw new Error('nosession');
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); }, CLAIM_TIMEOUT_MS);
      return win.fetch(String(win.GEOARMY_SUPABASE_URL).replace(/\/+$/, '') + '/functions/v1/plus-weekly-claim', {
        method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Authorization': 'Bearer ' + s.access_token, 'apikey': win.GEOARMY_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ mission: mission, week: week })
      }).then(function (res) { clearTimeout(t); return res.json().catch(function () { return null; }); }, function (e) { clearTimeout(t); throw e; });
    }).then(function (b) {
      var st = b && b.status;
      if (st === 'granted') done('🎉 ¡Recompensa acreditada!');
      else if (st === 'already_claimed') done('Esta recompensa ya estaba reclamada.');
      else if (st === 'not_ready') done('Todavía no se cumple la meta.');
      else if (st === 'week_closed') done('El plazo para reclamar esa semana ya terminó.');
      else if (st === 'plus_required') done('Necesitas Plus activo para reclamar.');
      else if (st === 'disabled' || st === 'not_configured') done('El reclamo no está abierto en este momento.');
      else done('No pudimos confirmar si se acreditó. Lo comprobaremos de nuevo; puedes reintentar sin riesgo de cobro doble.');
    }).catch(function () {
      done('No pudimos confirmar si se acreditó. Lo comprobaremos de nuevo; puedes reintentar sin riesgo de cobro doble.');
    });
  }

  /* ---------- misión diaria: SOLO pinta lo que publica js/geoarmy-plus-daily.js ---------- */
  (function dailyCard() {
    if (win.GEOARMY_PLUS_DAILY_ENABLED !== true) return;
    var card = $('plDaily'), statusEl = $('plDailyStatus'), subEl = $('plDailySub'), retry = $('plDailyRetry'), tick = null;
    if (!card) return;
    function reset(iso) { var t = untilText(iso, 'Vuelve mañana: se reinicia a medianoche (hora de Nueva York), en'); return t ? t + '.' : 'Se reinicia a medianoche (hora de Nueva York).'; }
    function render(s) {
      s = s || {}; var phase = s.phase; if (tick) { clearInterval(tick); tick = null; } retry.hidden = true; retry.disabled = false;
      if (phase === 'idle' || phase === 'hidden' || !phase) { card.hidden = true; return; }
      if (phase === 'checking') { if (card.hidden) return; statusEl.textContent = 'Comprobando tu misión diaria…'; subEl.textContent = ''; return; }
      card.hidden = false; card.setAttribute('data-state', phase);
      var amount = typeof s.amount === 'number' ? s.amount : 10;
      if (phase === 'granted' || phase === 'already_claimed') {
        statusEl.textContent = phase === 'granted' && s.fresh ? '🎉 ¡+' + amount + ' G-Coins acreditadas!' : 'Ya recibiste tus ' + amount + ' G-Coins de hoy.';
        subEl.textContent = reset(s.nextResetAt); tick = setInterval(function () { subEl.textContent = reset(s.nextResetAt); }, 60000);
      } else if (phase === 'unconfirmed') {
        statusEl.textContent = typeof s.message === 'string' && s.message ? s.message : 'No pudimos confirmar tu reclamo. Lo comprobaremos de nuevo; también puedes reintentar.';
        subEl.textContent = s.autoRetry ? 'Comprobando de nuevo automáticamente…' : 'Pulsa «Reintentar» para comprobarlo ahora.'; retry.hidden = false;
      } else if (phase === 'plus_required') { card.hidden = true; }        // esta página solo se ve con Plus; si el módulo aún no se enteró, no se muestra nada raro
      else { card.hidden = true; }
    }
    retry.addEventListener('click', function () { var api = win.GeoArmyPlusDaily; if (api && typeof api.retry === 'function') { retry.disabled = true; api.retry(); } });
    var tries = 0;
    (function attach() {
      var api = win.GeoArmyPlusDaily;
      if (api && typeof api.subscribe === 'function' && api.isEnabled && api.isEnabled()) { api.subscribe(render); return; }
      if (++tries < 40) setTimeout(attach, 250);
    })();
  })();

  /* ---------- eventos ---------- */
  root.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== root && !(t.tagName === 'BUTTON')) t = t.parentNode;
    if (!t || t === root) return;
    if (t.hasAttribute('data-retry')) { load('manual'); return; }
    if (t.id === 'plLogin') { try { win.GeoArmyAccount.openLogin(); } catch (err) { /* ignorar */ } return; }
    if (t.hasAttribute('data-mission') && t.hasAttribute('data-week')) claim(t);
  });
  var a = $('plSubscribe'); if (a) a.href = SUBS_URL;

  function start() {
    setState(win.GEOARMY_PLUS_PAGE_ENABLED === true ? 'loading' : 'off');
    var tries = 0;
    (function wait() {                                            // geoarmy-account.js crea el cliente; se espera (hasta ~10 s)
      if (client() || ++tries > 40) { load('load'); return; }
      setTimeout(wait, 250);
    })();
    try {
      var c0 = null; var iv = setInterval(function () {
        c0 = client(); if (!c0) return; clearInterval(iv);
        if (c0.auth && c0.auth.onAuthStateChange) c0.auth.onAuthStateChange(function (ev) {
          if (ev === 'SIGNED_OUT') { ticket++; hub = null; hubUid = null; setState('anon'); }
          else if (ev === 'SIGNED_IN') setTimeout(function () { load('auth'); }, 0);
        });
      }, 250);
    } catch (e) { /* ignorar */ }
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'visible' && Date.now() - lastLoad > WAKE_MIN_MS) load('wake'); });
    timer = setInterval(function () { if (doc.visibilityState === 'visible' && state === 'plus') load('poll'); }, REFRESH_MS);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
