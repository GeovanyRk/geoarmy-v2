/* =====================================================================
   GEO ARMY · COSMÉTICOS · SIMULACIÓN LOCAL   (js/geoarmy-cosmetics-sim.js, v1)
   SOLO PARA PRUEBAS EN UN EQUIPO LOCAL. Ninguna página de la web lo referencia con <script>.
   Lo carga js/geoarmy-cosmetics.js únicamente si se cumplen LAS TRES condiciones:
     1) window.GEOARMY_COSMETICS_ENABLED    === true   (js/geoarmy-config.js)
     2) window.GEOARMY_COSMETICS_SIMULATION === true   (js/geoarmy-config.js)
     3) la página corre en localhost / 127.0.0.1 / archivo local (en geoarmy.tv NUNCA, aunque el interruptor quedara en true)

   Qué hace: registra un TRANSPORTE falso (GeoArmyCosmetics.useTransport) que responde con las respuestas CRUDAS del contrato
   simulado (ver js/geoarmy-cosmetics-adapter.js): { appearance } para la sesión y filas con `appearance` para el ranking.
     - Modo simple: sesión VIP para las cuentas de vipUids (botón del panel); ranking: filas de la consulta normal + VIP por posición
       (la posición solo la usa el "servidor" simulado; el módulo nunca empareja por posición ni por nombre).
     - Modo servidor (people/accounts): base simulada con id interno estable que NO sale en las respuestas.
     - sessionRaw / rankingRaw: respuestas literales para probar respuestas inválidas.
   Muestra un panel fijo "SIMULACIÓN COSMÉTICOS · solo local" (abajo a la izquierda) para que no pase desapercibido.
   Estado: solo en memoria de esta pestaña + sessionStorage de ESTA pestaña (clave geoarmy_cos_sim_v1). No toca datos reales.
   ===================================================================== */
(function () {
  'use strict';
  var API = window.GeoArmyCosmetics;
  if (!API || !API.isEnabled || !API.isEnabled()) return;
  if (window.GEOARMY_COSMETICS_SIMULATION !== true) return;
  var h = String(location.hostname || '');
  if (!(location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.local$/.test(h))) return;

  var KEY = 'geoarmy_cos_sim_v1';
  var CODE = 'vip_violet_silver';
  // Configuración (se guarda solo en sessionStorage de ESTA pestaña):
  //  vipUids        modo simple: cuentas (uid) cuya sesión devuelve VIP
  //  rankPositions  modo simple (demo): filas del ranking normal a las que el "servidor" simulado añade VIP (por posición, SOLO aquí dentro)
  //  people/accounts  modo "servidor": base simulada de personas con id interno estable (NUNCA sale en las respuestas) y
  //                 accounts {uid → id de persona}. Sesión y ranking salen de la misma asignación, como haría el servidor real.
  //  sessionRaw / rankingRaw   si no son null, se devuelven TAL CUAL (para probar respuestas inválidas, incompletas, códigos desconocidos…)
  //  delayMs, rankingDelayMs, failSession, failNext/failMode, failRanking ('async'|'sync'|'hang') simulan latencia y errores.
  var cfg = { vipUids: [], rankPositions: [1, 6, 13], people: null, accounts: {}, sessionRaw: null, rankingRaw: null,
              delayMs: 0, rankingDelayMs: 0, failSession: false, failNext: 0, failMode: 'async', failRanking: false };
  var calls = { session: 0, ranking: 0 };
  try { var raw = sessionStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') cfg = Object.assign(cfg, o); } } catch (e) {}
  // ?cosSimVip=<uid>,<uid>  &cosRank=1,6,13  &cosDelay=ms (sesión)  &cosRankDelay=ms (ranking)   (útil para abrir la página ya configurada)
  try {
    var q = new URLSearchParams(location.search);
    if (q.has('cosSimVip')) cfg.vipUids = String(q.get('cosSimVip') || '').split(',').filter(Boolean);
    if (q.has('cosRank')) cfg.rankPositions = String(q.get('cosRank') || '').split(',').map(Number).filter(function (n) { return n > 0; });
    // ?cosSimCode=<código>  (solo modo simple) código de apariencia que devuelve la simulación en lugar del VIP; solo se acepta un código con forma válida
    // y, como siempre, el módulo solo lo pinta si ese código está en el catálogo (para una apariencia nueva: definirla en el catálogo, ver LEEME).
    if (q.has('cosSimCode') && /^[a-z][a-z0-9_]{2,63}$/.test(String(q.get('cosSimCode')))) CODE = String(q.get('cosSimCode'));
    if (q.has('cosDelay')) cfg.delayMs = Math.max(0, Number(q.get('cosDelay')) || 0);
    if (q.has('cosRankDelay')) cfg.rankingDelayMs = Math.max(0, Number(q.get('cosRankDelay')) || 0);
  } catch (e) {}
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
  function later(v, ms) { return ms ? new Promise(function (r) { setTimeout(function () { r(v); }, ms); }) : Promise.resolve(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  // ---- "servidor" simulado (modo people): una respuesta de ranking sale de UNA instantánea de la base ----
  function personById(id) { var l = cfg.people || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function sessionAppearanceFor(uid) {
    if (cfg.people) { var p = personById(cfg.accounts && cfg.accounts[uid]); return p && p.appearance ? p.appearance : null; }
    return cfg.vipUids.indexOf(uid) !== -1 ? CODE : null;
  }
  function rankingFromPeople() {
    var list = cfg.people.slice().sort(function (a, b) { return (b.xp - a.xp) || (a.id < b.id ? -1 : 1); });
    return list.map(function (p, i) {
      var r = {};
      Object.keys(p).forEach(function (k) { if (k !== 'id' && k !== 'appearance') r[k] = p[k]; });   // el id interno NO sale
      r.position = i + 1;
      r.appearance = p.appearance || null;
      return r;
    });
  }

  // ---- transporte simulado (misma firma que el real): devuelve la respuesta CRUDA del contrato ----
  var transport = {
    session: function (ctx) {
      calls.session++;
      if (cfg.failNext > 0) {
        cfg.failNext--;
        if (cfg.failMode === 'sync') throw new Error('sim: excepción síncrona del transporte');
        return later(Promise.reject(new Error('sim: rechazo asíncrono del transporte')), cfg.delayMs);
      }
      if (cfg.failSession === 'sync') throw new Error('sim: excepción síncrona del transporte');
      if (cfg.failSession) return later(Promise.reject(new Error('sim: fallo del transporte')), cfg.delayMs);
      if (cfg.sessionRaw !== null && cfg.sessionRaw !== undefined) return later(clone(cfg.sessionRaw), cfg.delayMs);
      return later({ appearance: sessionAppearanceFor(ctx && ctx.uid) }, cfg.delayMs);
    },
    ranking: function (ctx) {
      calls.ranking++;
      if (cfg.failRanking === 'sync') throw new Error('sim: excepción síncrona del ranking');
      if (cfg.failRanking === 'hang') return new Promise(function () {});
      if (cfg.failRanking) return later(Promise.reject(new Error('sim: fallo del ranking')), cfg.rankingDelayMs);
      if (cfg.rankingRaw !== null && cfg.rankingRaw !== undefined) return later(clone(cfg.rankingRaw), cfg.rankingDelayMs);
      if (cfg.people) return later(rankingFromPeople(), cfg.rankingDelayMs);
      // Modo demo: toma las filas de la consulta normal que ya hace la página y el "servidor" les añade la apariencia
      // (por posición, solo dentro de la simulación; el módulo nunca empareja por posición).
      return Promise.resolve(ctx.plain()).then(function (res) {
        if (!res || res.error || !Array.isArray(res.data)) throw new Error('sim: consulta normal sin datos');
        return later(res.data.map(function (r) {
          var c = {}; Object.keys(r).forEach(function (k) { c[k] = r[k]; });
          c.appearance = cfg.rankPositions.indexOf(Number(r.position)) !== -1 ? CODE : null;
          return c;
        }), cfg.rankingDelayMs);
      });
    }
  };
  API.useTransport(transport);

  function currentUid() {
    try { var A = window.GeoArmyAccount; return A && A.client ? A.client.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; return s && s.user ? s.user.id : null; }) : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }

  // API de pruebas (consola o Playwright)
  function apply() { save(); API.useTransport(transport); }
  window.GeoArmyCosmeticsSim = {
    config: function () { return clone(cfg); },
    calls: function () { return clone(calls); },
    set: function (patch) { cfg = Object.assign(cfg, patch || {}); apply(); },
    toggleSession: function (uid) {
      var i = cfg.vipUids.indexOf(uid);
      if (i === -1) cfg.vipUids.push(uid); else cfg.vipUids.splice(i, 1);
      apply(); return cfg.vipUids.indexOf(uid) !== -1;
    },
    // modo servidor: cambia la base simulada (sin tocar nada real)
    setPeople: function (people, accounts) { cfg.people = clone(people); if (accounts) cfg.accounts = clone(accounts); apply(); },
    updatePerson: function (id, patch) { var p = personById(id); if (p) Object.assign(p, clone(patch)); save(); },   // no refresca solo: la siguiente consulta ya verá el cambio
    refresh: function () { apply(); }
  };

  // Panel visible (para que la simulación nunca pase inadvertida)
  function panel() {
    if (document.getElementById('gcosSimPanel')) return;
    var d = document.createElement('div');
    d.id = 'gcosSimPanel';
    d.setAttribute('style', 'position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:260px;padding:8px 10px;border-radius:10px;background:#2b0b66;color:#fff;font:600 11px/1.35 Inter,system-ui,sans-serif;border:1px solid #c9a8ff;box-shadow:0 4px 18px rgba(0,0,0,.5)');
    d.innerHTML = '<div style="letter-spacing:.06em;font-weight:800">SIMULACIÓN COSMÉTICOS · solo local</div>' +
      '<div style="margin-top:4px"><button type="button" id="gcosSimSess" style="cursor:pointer;font:inherit;padding:3px 8px;border-radius:6px;border:1px solid #c9a8ff;background:#120726;color:#fff"></button></div>' +
      '<div style="margin-top:4px">Ranking VIP (posiciones): <input id="gcosSimRank" size="10" style="font:inherit;padding:2px 4px;border-radius:5px;border:1px solid #c9a8ff;background:#120726;color:#fff"/> ' +
      '<button type="button" id="gcosSimApply" style="cursor:pointer;font:inherit;padding:2px 6px;border-radius:6px;border:1px solid #c9a8ff;background:#120726;color:#fff">Aplicar y recargar</button></div>';
    document.body.appendChild(d);
    var btn = document.getElementById('gcosSimSess'), inp = document.getElementById('gcosSimRank');
    inp.value = cfg.rankPositions.join(',');
    function label() {
      currentUid().then(function (uid) {
        btn.disabled = !uid;
        btn.textContent = !uid ? 'Sin sesión (inicia sesión para simular)' : (cfg.vipUids.indexOf(uid) !== -1 ? 'Mi sesión: VIP ✓ (clic = quitar)' : 'Mi sesión: sin cosmético (clic = dar VIP)');
      });
    }
    btn.addEventListener('click', function () { currentUid().then(function (uid) { if (uid) { window.GeoArmyCosmeticsSim.toggleSession(uid); label(); } }); });
    document.getElementById('gcosSimApply').addEventListener('click', function () {
      cfg.rankPositions = inp.value.split(',').map(Number).filter(function (n) { return n > 0; }); save(); location.reload();
    });
    label();
    try { var A = window.GeoArmyAccount; if (A && A.client) A.client.auth.onAuthStateChange(function () { setTimeout(label, 50); }); } catch (e) {}
  }
  if (document.body) panel(); else document.addEventListener('DOMContentLoaded', panel);
})();
