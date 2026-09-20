// =====================================================================
// HALLOWEEN 2026 — "La Heraldo" — sistema de batalla comunitaria
// =====================================================================
// Archivo NUEVO y aislado. Por ahora se carga SOLAMENTE desde
// index-halloween-test.html (ver ese archivo) -- NO desde index.html de
// producción.
//
// Reglas de seguridad que este archivo respeta siempre:
//  - NO usa service_role, solo el cliente anon ya existente
//    (window.GeoArmyAccount.client, creado en js/geoarmy-account.js).
//  - NO consulta tablas halloween_2026_* directamente: únicamente llama
//    las RPCs públicas ya construidas en Supabase.
//  - NO calcula combate/daño/HP en el navegador. Solo representa lo que
//    devuelven las RPCs.
//  - NO resuelve Cataclismo, NO envía user_id manualmente a choose_role.
//  - El "modo de pruebas" (mock) es puramente visual: cuando está activo
//    NUNCA llama RPCs reales ni escribe nada en Supabase -- ver sección
//    "MOCK" más abajo.
// =====================================================================
(function () {
  'use strict';

  if (window.__hw26Init) return; // evita doble inicialización si el script se incluye más de una vez
  window.__hw26Init = true;

  var EVENT_KEY = 'halloween_2026';

  // ---------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Formato "2,000,000" explícito (no depende del locale del navegador,
  // que en es-ES agruparía con puntos).
  function fmtNum(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pad2(n) { n = Math.max(0, Math.floor(n)); return n < 10 ? '0' + n : '' + n; }
  function $(id) { return document.getElementById(id); }

  function showGlobalError(msg) {
    var box = $('hw26GlobalError');
    if (!box) return;
    box.textContent = msg;
    box.hidden = false;
  }
  function clearGlobalError() {
    var box = $('hw26GlobalError');
    if (box) box.hidden = true;
  }

  // ---------------------------------------------------------------------
  // 1) MODO DE PRUEBAS (mock) — SOLO afecta esta página de test.
  //    Se activa con el <select> del panel "TEST MODE" (#hw26DevScenario)
  //    o con ?hw_scenario=... en la URL. "off" = usa las RPCs reales.
  // ---------------------------------------------------------------------
  var urlParams = new URLSearchParams(window.location.search);
  var rootEl = $('hw26Root');
  var HALLOWEEN_TEST_MODE = !!(rootEl && rootEl.getAttribute('data-testmode') === 'true');

  var currentScenario = HALLOWEEN_TEST_MODE ? (urlParams.get('hw_scenario') || 'off') : 'off';
  var mockHasRole = urlParams.get('hw_role') === '1';

  var NOW_TEST_BASE = Date.now();

  function mockState(scenario) {
    var base = {
      event_key: EVENT_KEY,
      status: 'active',
      outcome: null,
      boss_hp: 1400000,
      boss_max_hp: 2000000,
      boss_phase: 1,
      phase2_threshold_hp: 1000000,
      geoarmy_hp: 62000,
      geoarmy_max_hp: 100000,
      pending_attack_key: null,
      pending_announced_at: null,
      pending_resolves_at: null,
      starts_at: '2026-10-01T19:00:00-04:00',
      ends_at: '2026-10-31T23:59:59-04:00',
      phase2_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    };
    switch (scenario) {
      case 'scheduled':
        return Object.assign({}, base, {
          status: 'scheduled', boss_hp: 2000000, geoarmy_hp: 100000, boss_phase: 1,
        });
      case 'active_p1':
        return base;
      case 'active_p2':
        return Object.assign({}, base, {
          boss_hp: 640000, boss_phase: 2, geoarmy_hp: 38000,
        });
      case 'cataclismo':
        return Object.assign({}, base, {
          boss_hp: 610000, boss_phase: 2, geoarmy_hp: 21000,
          pending_attack_key: 'cataclismo',
          pending_announced_at: new Date(NOW_TEST_BASE - 4000).toISOString(),
          pending_resolves_at: new Date(NOW_TEST_BASE + 17000).toISOString(),
        });
      case 'geoarmy_victory':
        return Object.assign({}, base, {
          status: 'finished', outcome: 'geoarmy_victory', boss_hp: 0, boss_phase: 2,
          geoarmy_hp: 15400, finished_at: new Date().toISOString(),
        });
      case 'herald_victory':
        return Object.assign({}, base, {
          status: 'finished', outcome: 'herald_victory', boss_hp: 610000, boss_phase: 2,
          geoarmy_hp: 0, finished_at: new Date().toISOString(),
        });
      default:
        return base;
    }
  }

  function mockParticipation(scenario) {
    var eventStatus = (scenario === 'scheduled') ? 'scheduled'
      : (scenario === 'geoarmy_victory' || scenario === 'herald_victory') ? 'finished'
      : 'active';
    if (!mockHasRole) {
      return {
        participant_id: null, role: null, display_name: 'TesterMock', joined_at: null,
        has_role: false, can_choose_role: eventStatus === 'active', event_status: eventStatus,
      };
    }
    return {
      participant_id: 'mock-participant-1', role: 'attacker', display_name: 'TesterMock',
      joined_at: new Date().toISOString(), has_role: true, can_choose_role: false,
      event_status: eventStatus,
    };
  }

  function mockEffects(scenario) {
    if (scenario === 'scheduled') return [];
    return [
      { effect_key: 'escudo_arcano', scope: 'geoarmy', applies_to: null, multiplier: 0.5, remaining_uses: null, expires_at: new Date(Date.now() + 9 * 60000).toISOString(), created_at: new Date().toISOString() },
      { effect_key: 'vulnerabilidad', scope: 'boss', applies_to: null, multiplier: 2, remaining_uses: 2, expires_at: null, created_at: new Date().toISOString() },
    ];
  }

  function mockFeed(scenario) {
    var now = Date.now();
    var items = [
      { log_id: 6, entry_type: 'player_attack', actor_name: 'geovannyrk', actor_role: 'attacker', action_key: 'golpe_del_abismo', boss_attack_key: null, boss_hp_delta: -3000, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 1400000, geoarmy_hp_after: 62000, phase_after: 1, created_at: new Date(now - 30000).toISOString() },
      { log_id: 5, entry_type: 'heal', actor_name: 'MissTwitch', actor_role: 'support', action_key: null, boss_attack_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 5000, multiplier_applied: 1, boss_hp_after: 1400000, geoarmy_hp_after: 62000, phase_after: 1, created_at: new Date(now - 90000).toISOString() },
      { log_id: 4, entry_type: 'shield', actor_name: 'ElDefensor', actor_role: 'defender', action_key: null, boss_attack_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 1400000, geoarmy_hp_after: 57000, phase_after: 1, created_at: new Date(now - 150000).toISOString() },
      { log_id: 3, entry_type: 'mission_damage', actor_name: null, actor_role: null, action_key: null, boss_attack_key: null, boss_hp_delta: -5000, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 1403000, geoarmy_hp_after: 57000, phase_after: 1, created_at: new Date(now - 240000).toISOString() },
      { log_id: 2, entry_type: 'boss_attack', actor_name: null, actor_role: null, action_key: null, boss_attack_key: 'fuego_infernal', boss_hp_delta: 0, geoarmy_hp_delta: -9000, multiplier_applied: 1, boss_hp_after: 1408000, geoarmy_hp_after: 57000, phase_after: 1, created_at: new Date(now - 300000).toISOString() },
      { log_id: 1, entry_type: 'event_started', actor_name: null, actor_role: null, action_key: null, boss_attack_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 2000000, geoarmy_hp_after: 100000, phase_after: 1, created_at: new Date(now - 600000).toISOString() },
    ];
    if (scenario === 'active_p2' || scenario === 'cataclismo') {
      items.unshift({ log_id: 7, entry_type: 'phase_change', actor_name: null, actor_role: null, action_key: null, boss_attack_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 999000, geoarmy_hp_after: 40000, phase_after: 2, created_at: new Date(now - 5000).toISOString() });
    }
    if (scenario === 'cataclismo') {
      items.unshift({ log_id: 8, entry_type: 'boss_attack_announced', actor_name: null, actor_role: null, action_key: null, boss_attack_key: 'cataclismo', boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 610000, geoarmy_hp_after: 21000, phase_after: 2, created_at: new Date(now - 2000).toISOString() });
    }
    if (scenario === 'geoarmy_victory') {
      items.unshift({ log_id: 9, entry_type: 'victory', actor_name: null, actor_role: null, action_key: null, boss_attack_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 0, geoarmy_hp_after: 15400, phase_after: 2, created_at: new Date(now - 1000).toISOString() });
    }
    if (scenario === 'herald_victory') {
      items.unshift({ log_id: 9, entry_type: 'defeat', actor_name: null, actor_role: null, action_key: null, boss_attack_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 610000, geoarmy_hp_after: 0, phase_after: 2, created_at: new Date(now - 1000).toISOString() });
    }
    return items;
  }

  function mockMissions(scenario) {
    var upcomingOnly = scenario === 'scheduled';
    return [
      { mission_id: 1, mission_key: 'fn_eliminaciones', category: 'fortnite', title: 'Elimina 5 enemigos', description: 'Consigue 5 eliminaciones en una partida de Fortnite y compártelo en el chat.', mission_day: '2026-10-06', opens_at: '2026-10-06T00:00:00-04:00', closes_at: '2026-10-06T23:59:59-04:00', availability: upcomingOnly ? 'upcoming' : 'active', is_final_battle: false, boss_damage: 5000, verification_mode: 'clip', sort_order: 1 },
      { mission_id: 2, mission_key: 'ow_victorias', category: 'overwatch', title: 'Gana 3 partidas', description: 'Consigue 3 victorias en Overwatch durante el stream.', mission_day: '2026-10-08', opens_at: '2026-10-08T00:00:00-04:00', closes_at: '2026-10-08T23:59:59-04:00', availability: 'upcoming', is_final_battle: false, boss_damage: 6000, verification_mode: 'auto', sort_order: 2 },
      { mission_id: 3, mission_key: 'stream_raid', category: 'stream', title: 'Trae un raid de 5+', description: 'Hazle raid al canal con 5 o más espectadores durante octubre.', mission_day: '2026-10-10', opens_at: '2026-10-01T00:00:00-04:00', closes_at: '2026-10-31T23:59:59-04:00', availability: 'active', is_final_battle: false, boss_damage: 4000, verification_mode: 'manual', sort_order: 3 },
      { mission_id: 4, mission_key: 'fn_batalla_final', category: 'fortnite', title: 'Batalla final: asalto', description: 'Contrato especial del 31 de octubre contra La Heraldo.', mission_day: '2026-10-31', opens_at: '2026-10-31T00:00:00-04:00', closes_at: '2026-10-31T23:59:59-04:00', availability: 'upcoming', is_final_battle: true, boss_damage: 20000, verification_mode: 'clip', sort_order: 4 },
    ];
  }

  // ---------------------------------------------------------------------
  // 2) Cliente Supabase real: reutiliza window.GeoArmyAccount.client
  //    (creado por js/geoarmy-account.js). Nunca se crea un cliente nuevo.
  // ---------------------------------------------------------------------
  function waitForClient(cb, triesLeft) {
    triesLeft = triesLeft == null ? 100 : triesLeft;
    if (window.GeoArmyAccount && window.GeoArmyAccount.client) { cb(window.GeoArmyAccount.client); return; }
    if (triesLeft <= 0) {
      console.error('[halloween-2026] No se encontró window.GeoArmyAccount.client. ¿Se cargó js/geoarmy-account.js antes que este script?');
      showGlobalError('No se pudo conectar con el sistema de cuentas de Geo Army.');
      return;
    }
    setTimeout(function () { waitForClient(cb, triesLeft - 1); }, 100);
  }

  // Envoltorio único para llamar RPCs: en modo mock nunca toca la red ni
  // Supabase; en modo real, llama la RPC pública tal cual y nunca consulta
  // tablas halloween_2026_* directamente.
  function callRpc(client, name, args) {
    if (HALLOWEEN_TEST_MODE && currentScenario !== 'off') {
      return Promise.resolve({ data: mockRpcResult(name), error: null });
    }
    var p = args ? client.rpc(name, args) : client.rpc(name);
    return Promise.resolve(p);
  }

  function mockRpcResult(name) {
    switch (name) {
      case 'halloween_2026_get_public_state': return mockState(currentScenario);
      case 'halloween_2026_get_my_participation': return mockParticipation(currentScenario);
      case 'halloween_2026_get_public_effects': return mockEffects(currentScenario);
      case 'halloween_2026_get_public_feed': return mockFeed(currentScenario);
      case 'halloween_2026_get_public_missions': return mockMissions(currentScenario);
      default: return null;
    }
  }

  // ---------------------------------------------------------------------
  // 3) Estado en memoria + intervals (con guardas anti-duplicado)
  // ---------------------------------------------------------------------
  var sbClient = null;
  var lastState = null;
  var lastParticipation = null;
  var lastEffects = [];
  var lastFeed = [];
  var lastMissions = [];
  var cataclysmTimerId = null;
  var pollIds = { state: null, effects: null, feed: null, missions: null };

  function clearAllIntervals() {
    Object.keys(pollIds).forEach(function (k) {
      if (pollIds[k]) { clearInterval(pollIds[k]); pollIds[k] = null; }
    });
    if (cataclysmTimerId) { clearInterval(cataclysmTimerId); cataclysmTimerId = null; }
  }
  window.addEventListener('beforeunload', clearAllIntervals);

  // ---------------------------------------------------------------------
  // 4) Carga de datos (cada módulo con su propio try/catch y fallback)
  // ---------------------------------------------------------------------
  function loadState() {
    // halloween_2026_get_public_state() no recibe parámetros (ver spec).
    return callRpc(sbClient, 'halloween_2026_get_public_state')
      .then(function (res) {
        if (res.error) throw res.error;
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!row) throw new Error('sin datos');
        lastState = row;
        clearGlobalError();
        renderBoss(row);
        renderPinsHeader();
      })
      .catch(function (e) {
        console.warn('[halloween-2026] fallo halloween_2026_get_public_state', e);
        showGlobalError('No se pudo cargar el estado de la batalla.');
      });
  }

  function loadParticipation() {
    // Solo tiene sentido con sesión real (en mock, sbClient puede no
    // existir todavía si test mode arrancó sin login -- igual usamos el
    // mock si currentScenario !== 'off').
    if (!HALLOWEEN_TEST_MODE || currentScenario === 'off') {
      if (!sbClient) return Promise.resolve();
      return sbClient.auth.getSession().then(function (sessionRes) {
        var session = sessionRes.data && sessionRes.data.session;
        if (!session) { lastParticipation = null; renderRoleStatus(); return; }
        return callRpc(sbClient, 'halloween_2026_get_my_participation')
          .then(function (res) {
            if (res.error) throw res.error;
            lastParticipation = Array.isArray(res.data) ? res.data[0] : res.data;
            renderRoleStatus();
          })
          .catch(function (e) {
            console.warn('[halloween-2026] fallo halloween_2026_get_my_participation', e);
            lastParticipation = null;
            renderRoleStatus(true);
          });
      });
    }
    return callRpc(sbClient, 'halloween_2026_get_my_participation').then(function (res) {
      lastParticipation = res.data;
      renderRoleStatus();
    });
  }

  function loadEffects() {
    // halloween_2026_get_public_effects() no recibe parámetros (ver spec).
    return callRpc(sbClient, 'halloween_2026_get_public_effects')
      .then(function (res) {
        if (res.error) throw res.error;
        lastEffects = res.data || [];
        renderEffectsPinSub();
      })
      .catch(function (e) {
        console.warn('[halloween-2026] fallo halloween_2026_get_public_effects', e);
        lastEffects = null; // null = error distinto de "vacío"
      });
  }

  function loadFeed() {
    // halloween_2026_get_public_feed(p_limit) -- solo ese parámetro (ver spec).
    return callRpc(sbClient, 'halloween_2026_get_public_feed', { p_limit: 30 })
      .then(function (res) {
        if (res.error) throw res.error;
        lastFeed = res.data || [];
        renderCronicasPinSub();
      })
      .catch(function (e) {
        console.warn('[halloween-2026] fallo halloween_2026_get_public_feed', e);
        lastFeed = null;
      });
  }

  function loadMissions() {
    // halloween_2026_get_public_missions() no recibe parámetros (ver spec).
    return callRpc(sbClient, 'halloween_2026_get_public_missions')
      .then(function (res) {
        if (res.error) throw res.error;
        lastMissions = res.data || [];
        renderContratosPinSub();
      })
      .catch(function (e) {
        console.warn('[halloween-2026] fallo halloween_2026_get_public_missions', e);
        lastMissions = null;
      });
  }

  // ---------------------------------------------------------------------
  // 5) Render — widget principal de La Heraldo
  // ---------------------------------------------------------------------
  var prevBossHp = null, prevGeoHp = null;

  function renderBoss(state) {
    var boss = $('hw26Boss');
    if (!boss) return;

    boss.setAttribute('data-phase', String(state.boss_phase || 1));
    boss.setAttribute('data-eventstatus', state.status || 'scheduled');
    boss.setAttribute('data-outcome', state.outcome || 'none');

    var badge = $('hw26PhaseBadge');
    var phaseText = $('hw26PhaseText');
    if (state.boss_phase === 2) {
      if (badge) badge.textContent = 'FASE II';
      if (phaseText) phaseText.textContent = 'FASE II — FORMA DEMONÍACA';
    } else {
      if (badge) badge.textContent = 'FASE I';
      if (phaseText) phaseText.textContent = 'FASE I — FORMA SELLADA';
    }

    // Barras — nunca se recalculan, solo se representan boss_hp/boss_max_hp
    // y geoarmy_hp/geoarmy_max_hp tal como vienen de Supabase.
    var bossPct = state.boss_max_hp > 0 ? Math.max(0, Math.min(100, (state.boss_hp / state.boss_max_hp) * 100)) : 0;
    var geoPct = state.geoarmy_max_hp > 0 ? Math.max(0, Math.min(100, (state.geoarmy_hp / state.geoarmy_max_hp) * 100)) : 0;

    var bossFill = $('hw26BossHpFill');
    var geoFill = $('hw26GeoHpFill');
    if (bossFill) bossFill.style.width = bossPct + '%';
    if (geoFill) geoFill.style.width = geoPct + '%';

    var bossText = $('hw26BossHpText');
    var geoText = $('hw26GeoHpText');
    if (bossText) bossText.textContent = fmtNum(state.boss_hp) + ' / ' + fmtNum(state.boss_max_hp) + ' HP (' + Math.round(bossPct) + '%)';
    if (geoText) geoText.textContent = fmtNum(state.geoarmy_hp) + ' / ' + fmtNum(state.geoarmy_max_hp) + ' HP (' + Math.round(geoPct) + '%)';

    // Flash de impacto/curación al detectar cambio respecto al poll anterior
    if (prevBossHp != null && bossFill) {
      if (state.boss_hp < prevBossHp) flashOnce(bossFill, 'hw26-flash-hit');
      else if (state.boss_hp > prevBossHp) flashOnce(bossFill, 'hw26-flash-heal');
    }
    if (prevGeoHp != null && geoFill) {
      if (state.geoarmy_hp < prevGeoHp) flashOnce(geoFill, 'hw26-flash-hit');
      else if (state.geoarmy_hp > prevGeoHp) flashOnce(geoFill, 'hw26-flash-heal');
    }
    prevBossHp = state.boss_hp;
    prevGeoHp = state.geoarmy_hp;

    renderStatusLine(state);
    renderCataclysm(state);
  }

  function flashOnce(el, cls) {
    el.classList.remove(cls);
    // reflow para poder re-disparar la animación si ya tenía la clase
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 600);
  }

  function renderStatusLine(state) {
    var badge = $('hw26StatusBadge');
    var detail = $('hw26StatusDetail');
    if (!badge || !detail) return;

    if (state.status === 'scheduled') {
      badge.textContent = 'BATALLA BLOQUEADA';
      detail.textContent = 'COMIENZA 1 OCT · 7:00 PM ET';
      return;
    }
    if (state.status === 'finished') {
      if (state.outcome === 'geoarmy_victory') {
        badge.textContent = 'LA HERALDO HA CAÍDO';
        detail.textContent = 'GEO ARMY SOBREVIVIÓ.';
      } else if (state.outcome === 'herald_victory') {
        badge.textContent = 'LA RESISTENCIA HA CAÍDO';
        detail.textContent = 'LA HERALDO VENCIÓ.';
      } else {
        badge.textContent = 'BATALLA FINALIZADA';
        detail.textContent = '';
      }
      return;
    }
    // active
    badge.textContent = 'BATALLA EN CURSO';
    detail.textContent = state.boss_phase === 2 ? 'La Heraldo ha despertado su forma demoníaca.' : 'El sello aún resiste.';
  }

  function renderCataclysm(state) {
    var box = $('hw26Cataclysm');
    var timerEl = $('hw26CataclysmTimer');
    if (!box) return;

    if (cataclysmTimerId) { clearInterval(cataclysmTimerId); cataclysmTimerId = null; }

    if (state.pending_attack_key !== 'cataclismo' || !state.pending_resolves_at) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var resolvesAt = new Date(state.pending_resolves_at).getTime();

    function tick() {
      // Solo presentación: el timer NUNCA resuelve el ataque, cambia HP
      // ni asume que Cataclismo ocurrió -- eso lo hace el backend.
      var diff = Math.max(0, resolvesAt - Date.now());
      var totalSec = Math.floor(diff / 1000);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      if (timerEl) timerEl.textContent = pad2(m) + ':' + pad2(s);
    }
    tick();
    cataclysmTimerId = setInterval(tick, 1000);
  }

  // ---------------------------------------------------------------------
  // 6) Render — subtítulos de los 4 pines
  // ---------------------------------------------------------------------
  function renderPinsHeader() {
    var pinRol = $('hw26PinRol');
    if (!lastState || !pinRol) return;
    if (lastState.status === 'scheduled') {
      $('hw26PinRolSub').textContent = 'Bloqueado hasta el 1 Oct';
    }
  }

  function renderRoleStatus(errored) {
    var sub = $('hw26PinRolSub');
    if (!sub) return;
    if (errored) { sub.textContent = 'No disponible'; return; }
    if (!lastState) { sub.textContent = '—'; return; }
    if (lastState.status === 'scheduled') { sub.textContent = 'Bloqueado hasta el 1 Oct'; return; }
    if (!lastParticipation) { sub.textContent = 'Inicia sesión'; return; }
    if (lastParticipation.has_role) {
      sub.textContent = roleLabel(lastParticipation.role);
    } else if (lastParticipation.can_choose_role) {
      sub.textContent = 'Elige tu rol';
      $('hw26PinRol').setAttribute('data-hw-urgent', 'true');
    } else {
      sub.textContent = 'Sin rol';
    }
  }

  function renderContratosPinSub() {
    var sub = $('hw26PinContratosSub');
    if (!sub) return;
    if (lastMissions == null) { sub.textContent = 'No disponible'; return; }
    var activos = lastMissions.filter(function (m) { return m.availability === 'active'; }).length;
    sub.textContent = activos > 0 ? (activos + ' activo' + (activos === 1 ? '' : 's')) : 'Sin contratos activos';
  }

  function renderEffectsPinSub() {
    var sub = $('hw26PinEfectosSub');
    if (!sub) return;
    if (lastEffects == null) { sub.textContent = 'No disponible'; return; }
    sub.textContent = lastEffects.length > 0 ? (lastEffects.length + ' activo' + (lastEffects.length === 1 ? '' : 's')) : 'Ninguno activo';
  }

  function renderCronicasPinSub() {
    var sub = $('hw26PinCronicasSub');
    if (!sub) return;
    if (lastFeed == null) { sub.textContent = 'No disponible'; return; }
    sub.textContent = lastFeed.length > 0 ? 'Últimos eventos' : 'Sin eventos todavía';
  }

  // ---------------------------------------------------------------------
  // 7) Modal genérico
  // ---------------------------------------------------------------------
  function openModal(html) {
    var overlay = $('hw26ModalOverlay');
    var body = $('hw26ModalBody');
    if (!overlay || !body) return;
    body.innerHTML = html;
    overlay.hidden = false;
  }
  function closeModal() {
    var overlay = $('hw26ModalOverlay');
    if (overlay) overlay.hidden = true;
  }

  function wireModalChrome() {
    var overlay = $('hw26ModalOverlay');
    var closeBtn = $('hw26ModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  // ---------------------------------------------------------------------
  // 8) PIN 1 — ROL
  // ---------------------------------------------------------------------
  var ROLE_META = {
    attacker: { icon: '⚔', name: 'ATACANTE', desc: 'Golpea a La Heraldo y participa en la ofensiva.' },
    support: { icon: '✚', name: 'SOPORTE', desc: 'Representa a quienes mantienen con vida a Geo Army.' },
    defender: { icon: '🛡', name: 'DEFENSOR', desc: 'Representa a quienes protegen la resistencia.' },
  };
  function roleLabel(role) {
    var m = ROLE_META[role];
    return m ? (m.icon + ' ' + m.name) : (role || '—');
  }

  function openRolModal() {
    if (!lastState) { openModal(genericErrorHtml('No se pudo cargar el estado de la batalla.')); return; }

    if (lastState.status === 'scheduled') {
      openModal(
        '<h3 class="hw26-modal-title">⚔ Rol</h3>' +
        '<div class="hw26-locked-box">' +
          '<div class="hw26-lock-icon">🔒</div>' +
          '<b>ELECCIÓN BLOQUEADA</b>' +
          '<div class="hw26-modal-sub" style="margin:0;">Disponible: 1 OCT · 7:00 PM ET</div>' +
        '</div>'
      );
      return;
    }

    var isMock = HALLOWEEN_TEST_MODE && currentScenario !== 'off';
    if (!isMock && !sbClient) { openModal(genericErrorHtml('No se pudo conectar con el sistema de cuentas.')); return; }

    var checkSession = isMock
      ? Promise.resolve({ data: { session: { user: { id: 'mock' } } } })
      : sbClient.auth.getSession();

    checkSession.then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        openModal(
          '<h3 class="hw26-modal-title">⚔ Rol</h3>' +
          '<div class="hw26-locked-box">' +
            '<div class="hw26-lock-icon">👤</div>' +
            '<b>Necesitas iniciar sesión</b>' +
            '<div class="hw26-modal-sub" style="margin:8px 0 14px;">Inicia sesión con Twitch para elegir tu rol en la batalla.</div>' +
            '<button type="button" class="hw26-role-confirm" id="hw26LoginFromModal">Iniciar sesión</button>' +
          '</div>'
        );
        var btn = $('hw26LoginFromModal');
        if (btn) btn.addEventListener('click', function () {
          closeModal();
          if (window.GeoArmyAccount && window.GeoArmyAccount.openLogin) window.GeoArmyAccount.openLogin();
        });
        return;
      }

      if (lastParticipation && lastParticipation.has_role) {
        var meta = ROLE_META[lastParticipation.role] || { icon: '⚔', name: lastParticipation.role, desc: '' };
        openModal(
          '<h3 class="hw26-modal-title">⚔ Rol</h3>' +
          '<div class="hw26-role-current">' +
            '<span class="hw26-role-icon">' + meta.icon + '</span>' +
            '<div><div class="hw26-role-name">' + esc(meta.name) + '</div>' +
            '<div class="hw26-role-desc">Tu rol es permanente durante Halloween 2026.</div></div>' +
          '</div>'
        );
        return;
      }

      if (!lastParticipation || !lastParticipation.can_choose_role) {
        openModal(genericErrorHtml('La elección de rol no está disponible en este momento.'));
        return;
      }

      var selected = null;
      var html =
        '<h3 class="hw26-modal-title">⚔ Elige tu rol</h3>' +
        '<div class="hw26-modal-sub">Cada participante elige un rol una sola vez para todo octubre.</div>' +
        Object.keys(ROLE_META).map(function (key) {
          var m = ROLE_META[key];
          return '<button type="button" class="hw26-role-card" data-role="' + key + '">' +
            '<span class="hw26-role-icon">' + m.icon + '</span>' +
            '<span><span class="hw26-role-name" style="display:block;">' + m.name + '</span>' +
            '<span class="hw26-role-desc">' + esc(m.desc) + '</span></span>' +
          '</button>';
        }).join('') +
        '<div class="hw26-role-warning">Tu elección será permanente durante Halloween 2026.</div>' +
        '<button type="button" class="hw26-role-confirm" id="hw26ConfirmRole" disabled>Confirmar rol</button>';
      openModal(html);

      var cards = document.querySelectorAll('.hw26-role-card');
      var confirmBtn = $('hw26ConfirmRole');
      cards.forEach(function (card) {
        card.addEventListener('click', function () {
          selected = card.getAttribute('data-role');
          cards.forEach(function (c) { c.classList.toggle('is-selected', c === card); });
          if (confirmBtn) confirmBtn.disabled = false;
        });
      });
      if (confirmBtn) confirmBtn.addEventListener('click', function () {
        if (!selected) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Guardando…';

        var confirmCall = (HALLOWEEN_TEST_MODE && currentScenario !== 'off')
          ? Promise.resolve({ data: { ok: true }, error: null }) // mock: NO escribe nada real
          : sbClient.rpc('halloween_2026_choose_role', { p_event_key: EVENT_KEY, p_role: selected });

        confirmCall.then(function (res) {
          if (res.error) throw res.error;
          // No optimistic update permanente: se vuelve a consultar
          // participación real (o mock) antes de reflejar el cambio.
          if (HALLOWEEN_TEST_MODE && currentScenario !== 'off') mockHasRole = true;
          return loadParticipation();
        }).then(function () {
          closeModal();
        }).catch(function (e) {
          console.warn('[halloween-2026] fallo halloween_2026_choose_role', e);
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirmar rol';
          openModal(genericErrorHtml('No se pudo guardar tu rol. Intenta de nuevo.'));
        });
      });
    }).catch(function (e) {
      console.warn('[halloween-2026] fallo al verificar sesión para Rol', e);
      openModal(genericErrorHtml('No se pudo verificar tu sesión.'));
    });
  }

  // ---------------------------------------------------------------------
  // 9) PIN 2 — CONTRATOS
  // ---------------------------------------------------------------------
  var MISSION_CATEGORY_LABEL = { fortnite: 'FORTNITE', overwatch: 'OVERWATCH', stream: 'STREAM' };
  var MISSION_STATUS_LABEL = { upcoming: 'PRÓXIMO', active: 'ACTIVO', ended: 'TERMINADO' };

  function openContratosModal() {
    if (lastMissions == null) { openModal(genericErrorHtml('Contratos temporalmente no disponibles.')); return; }
    if (!lastMissions.length) {
      openModal('<h3 class="hw26-modal-title">📜 Contratos</h3>' + emptyStateHtml('Todavía no hay contratos publicados.'));
      return;
    }
    var byCat = { fortnite: [], overwatch: [], stream: [] };
    lastMissions.forEach(function (m) { (byCat[m.category] || (byCat[m.category] = [])).push(m); });

    var html = '<h3 class="hw26-modal-title">📜 Contratos</h3>';
    ['fortnite', 'overwatch', 'stream'].forEach(function (cat) {
      var list = byCat[cat];
      if (!list || !list.length) return;
      html += '<div class="hw26-mission-group-title">' + (MISSION_CATEGORY_LABEL[cat] || cat.toUpperCase()) + '</div>';
      list.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      list.forEach(function (m) {
        html +=
          '<div class="hw26-mission-card" data-status="' + esc(m.availability) + '">' +
            '<div class="hw26-mission-top">' +
              '<div class="hw26-mission-title">' + esc(m.title) + '</div>' +
              '<span class="hw26-mission-badge ' + esc(m.availability) + '">' + (MISSION_STATUS_LABEL[m.availability] || m.availability) + '</span>' +
            '</div>' +
            '<div class="hw26-mission-desc">' + esc(m.description || '') + '</div>' +
            '<div class="hw26-mission-meta">' +
              '<span class="hw26-mission-dmg">' + fmtNum(m.boss_damage) + ' DAÑO</span>' +
              '<span>' + esc(m.mission_day || '') + '</span>' +
            '</div>' +
          '</div>';
      });
    });
    openModal(html);
  }

  // ---------------------------------------------------------------------
  // 10) PIN 3 — EFECTOS
  // ---------------------------------------------------------------------
  var EFFECT_META = {
    escudo_arcano: { icon: '🛡', name: 'ESCUDO ARCANO', desc: 'Próximo ataque de La Heraldo ×0.5' },
    vulnerabilidad: { icon: '🔮', name: 'VULNERABILIDAD', desc: 'Ataques de Geo Army ×2', showUses: true },
    ruptura_arcana: { icon: '📜', name: 'RUPTURA ARCANA', desc: 'Próximo Contrato ×2' },
    marca_bruja: { icon: '🩸', name: 'MARCA DE LA BRUJA', desc: 'Próximo ataque de Geo Army ×0.5' },
    herida_profana: { icon: '💀', name: 'HERIDA PROFANA', desc: 'Próxima curación ×0.5' },
  };

  function openEfectosModal() {
    if (lastEffects == null) { openModal(genericErrorHtml('Efectos temporalmente no disponibles.')); return; }
    var html = '<h3 class="hw26-modal-title">🔮 Efectos</h3>';
    if (!lastEffects.length) {
      html += emptyStateHtml('NINGÚN EFECTO ACTIVO');
      openModal(html);
      return;
    }
    lastEffects.forEach(function (fx) {
      var meta = EFFECT_META[fx.effect_key] || { icon: '✨', name: fx.effect_key, desc: '' };
      html +=
        '<div class="hw26-effect-card">' +
          '<span class="hw26-effect-icon">' + meta.icon + '</span>' +
          '<div>' +
            '<div class="hw26-effect-name">' + esc(meta.name) + '</div>' +
            '<div class="hw26-effect-desc">' + esc(meta.desc) + '</div>' +
            (meta.showUses && fx.remaining_uses != null ? '<div class="hw26-effect-uses">Usos restantes: ' + esc(fx.remaining_uses) + '</div>' : '') +
          '</div>' +
        '</div>';
    });
    openModal(html);
  }

  // ---------------------------------------------------------------------
  // 11) PIN 4 — CRÓNICAS
  // ---------------------------------------------------------------------
  function feedItemText(item) {
    var dmg = fmtNum(Math.abs(item.boss_hp_delta || 0));
    var heal = fmtNum(Math.abs(item.geoarmy_hp_delta || 0));
    switch (item.entry_type) {
      case 'role_selected':
        return esc(item.actor_name || 'Alguien') + ' se unió a la batalla.';
      case 'player_attack':
        return esc(item.actor_name || 'Un guerrero') + ' atacó a La Heraldo — ' + dmg + ' de daño.';
      case 'heal':
        return 'Geo Army recuperó ' + heal + ' HP.';
      case 'shield':
        return 'Geo Army activó un escudo.';
      case 'mission_damage':
        return 'Un Contrato golpeó a La Heraldo por ' + dmg + '.';
      case 'effect_applied':
        return 'Un nuevo efecto se activó sobre el campo de batalla.';
      case 'effect_consumed':
        return 'Un efecto activo se consumió.';
      case 'boss_attack_announced':
        return 'LA HERALDO PREPARA CATACLISMO.';
      case 'boss_attack':
        return 'La Heraldo atacó — ' + heal + ' de daño a Geo Army.';
      case 'boss_heal':
        return 'La Heraldo recuperó ' + dmg + ' HP.';
      case 'phase_change':
        return 'EL SELLO SE ROMPIÓ. LA HERALDO HA CAMBIADO.';
      case 'victory':
        return 'LA HERALDO HA CAÍDO.';
      case 'defeat':
        return 'LA RESISTENCIA DE GEO ARMY HA SIDO DESTRUIDA.';
      case 'event_started':
        return 'LA BATALLA HA COMENZADO.';
      default:
        return 'Actividad registrada en la batalla.';
    }
  }

  function openCronicasModal() {
    if (lastFeed == null) { openModal(genericErrorHtml('Crónicas temporalmente no disponibles.')); return; }
    var html = '<h3 class="hw26-modal-title">📖 Crónicas</h3>';
    if (!lastFeed.length) {
      html += emptyStateHtml('Todavía no hay crónicas que contar.');
      openModal(html);
      return;
    }
    var sorted = lastFeed.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    sorted.forEach(function (item) {
      var time = '';
      try { time = new Date(item.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
      html +=
        '<div class="hw26-feed-item" data-type="' + esc(item.entry_type) + '">' +
          feedItemText(item) +
          '<span class="hw26-feed-time">' + esc(time) + '</span>' +
        '</div>';
    });
    openModal(html);
  }

  // ---------------------------------------------------------------------
  // Helpers de modal compartidos
  // ---------------------------------------------------------------------
  function emptyStateHtml(msg) { return '<div class="hw26-empty-state">' + esc(msg) + '</div>'; }
  function genericErrorHtml(msg) { return '<div class="hw26-empty-state">' + esc(msg) + '</div>'; }

  // ---------------------------------------------------------------------
  // 12) Panel de pruebas (dev bar) — SOLO test mode
  // ---------------------------------------------------------------------
  function wireDevBar() {
    if (!HALLOWEEN_TEST_MODE) return;
    var bar = $('hw26DevBar');
    var select = $('hw26DevScenario');
    var roleCheck = $('hw26DevRole');
    if (!bar) return;
    bar.hidden = false;
    if (select) {
      select.value = currentScenario;
      select.addEventListener('change', function () {
        currentScenario = select.value;
        var url = new URL(window.location.href);
        if (currentScenario === 'off') url.searchParams.delete('hw_scenario');
        else url.searchParams.set('hw_scenario', currentScenario);
        history.replaceState(null, '', url);
        refreshAll();
      });
    }
    if (roleCheck) {
      roleCheck.checked = mockHasRole;
      roleCheck.addEventListener('change', function () {
        mockHasRole = roleCheck.checked;
        var url = new URL(window.location.href);
        if (mockHasRole) url.searchParams.set('hw_role', '1'); else url.searchParams.delete('hw_role');
        history.replaceState(null, '', url);
        refreshAll();
      });
    }
  }

  function refreshAll() {
    loadState();
    loadParticipation();
    loadEffects();
    loadFeed();
    loadMissions();
  }

  // ---------------------------------------------------------------------
  // 13) Arranque
  // ---------------------------------------------------------------------
  function wirePins() {
    var pinRol = $('hw26PinRol');
    var pinContratos = $('hw26PinContratos');
    var pinEfectos = $('hw26PinEfectos');
    var pinCronicas = $('hw26PinCronicas');
    if (pinRol) pinRol.addEventListener('click', openRolModal);
    if (pinContratos) pinContratos.addEventListener('click', openContratosModal);
    if (pinEfectos) pinEfectos.addEventListener('click', openEfectosModal);
    if (pinCronicas) pinCronicas.addEventListener('click', openCronicasModal);
  }

  function startPolling() {
    clearAllIntervals();
    pollIds.state = setInterval(loadState, 5000);
    pollIds.effects = setInterval(loadEffects, 9000);
    pollIds.feed = setInterval(loadFeed, 6000);
    pollIds.missions = setInterval(loadMissions, 45000);
  }

  var didInitialLoad = false;

  function init() {
    wireModalChrome();
    wirePins();
    wireDevBar();

    function afterClient(client) {
      sbClient = client;
      if (client && client.auth && client.auth.onAuthStateChange) {
        client.auth.onAuthStateChange(function () { loadParticipation(); });
      }
      if (didInitialLoad) return; // ya se arrancó con mock; solo llegamos aquí a enchufar el cliente real
      didInitialLoad = true;
      refreshAll();
      startPolling();
    }

    if (HALLOWEEN_TEST_MODE && currentScenario !== 'off') {
      // En mock puro no es obligatorio tener cliente real: arrancamos ya
      // mismo con datos simulados (sin bloquear en la red) y, en paralelo,
      // intentamos enchufar el cliente real solo para que "Iniciar sesión"
      // y la elección de rol real sigan disponibles si el usuario se loguea.
      afterClient(null);
      waitForClient(function (client) { sbClient = client; }, 20);
    } else {
      waitForClient(afterClient);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
