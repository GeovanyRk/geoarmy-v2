// =====================================================================
// HALLOWEEN 2026 — "La Heraldo" — sistema de batalla comunitaria
// =====================================================================
// Archivo NUEVO y aislado. Se carga SOLAMENTE desde las páginas dedicadas
// halloween/batalla.html, rol.html, contratos.html, efectos.html,
// cronicas.html (todas de prueba por ahora). index-halloween-test.html ya
// NO lo carga: los 5 pins sobre el planeta son <a href> simples, con el
// estado bloqueado/desbloqueado resuelto en puro CSS (ver
// css/halloween-2026.css, sección "Pins sobre el planeta").
//
// CAMBIO DE DIRECCIÓN (v2): se retiró el dashboard de 4 tarjetas + modal
// genérico. Ahora este archivo actúa como un pequeño "router": lee
// document.body.dataset.halloweenPage ("battle" | "role" | "missions" |
// "effects" | "feed") y solo inicializa/pollea lo que esa página
// necesita. La lógica de cada sección (antes los "openXModal") se
// conserva casi intacta, solo que ahora escribe directamente en un
// contenedor de la página en vez de abrir un modal.
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
  // Empty state "trabajado": icono grande sutil + título + texto
  // secundario de ambientación (en vez de una caja gigante con una sola
  // línea). genericErrorHtml conserva su firma de un solo mensaje pero
  // usa la misma estructura visual con un icono de advertencia.
  function emptyStateHtml(icon, title, sub) {
    return '<div class="hw26-empty-state">' +
      '<div class="hw26-empty-icon">' + icon + '</div>' +
      '<div class="hw26-empty-title">' + esc(title) + '</div>' +
      (sub ? '<div class="hw26-empty-sub">' + esc(sub) + '</div>' : '') +
    '</div>';
  }
  function genericErrorHtml(msg) {
    return '<div class="hw26-empty-state hw26-empty-state-error">' +
      '<div class="hw26-empty-icon">⚠</div>' +
      '<div class="hw26-empty-title">ALGO SALIÓ MAL</div>' +
      '<div class="hw26-empty-sub">' + esc(msg) + '</div>' +
    '</div>';
  }
  // "ESCUDO ARCANO" -> "Escudo Arcano" — solo para el texto narrativo de
  // Crónicas, que se lee mejor en minúsculas/mayúscula inicial que en el
  // mayúsculas-fijas de las tarjetas de Efectos.
  function titleCaseEs(s) {
    return String(s || '').toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g, function (m, sp, c) { return sp + c.toUpperCase(); });
  }

  function safeLsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function safeLsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  // ---------------------------------------------------------------------
  // 0) Router — qué página es esta y si está en modo de pruebas.
  //    <body data-halloween-page="battle|role|missions|effects|feed"
  //          data-testmode="true">
  // ---------------------------------------------------------------------
  var PAGE = document.body.getAttribute('data-halloween-page') || '';
  var HALLOWEEN_TEST_MODE = document.body.getAttribute('data-testmode') === 'true';

  // ---------------------------------------------------------------------
  // 1) MODO DE PRUEBAS (mock) — SOLO afecta estas páginas de test.
  //    Se activa con el <select> del panel "TEST MODE" (#hw26DevScenario)
  //    o con ?hw_scenario=... en la URL. "off" = usa las RPCs reales.
  //    El escenario elegido también se guarda en localStorage (SOLO en
  //    test mode, nunca escribe nada en Supabase) para que, al navegar de
  //    una página Halloween a otra, se conserve el mismo escenario sin
  //    tener que repetir el parámetro en cada link -- pura conveniencia
  //    visual de pruebas, ver sección 15 del pedido original.
  // ---------------------------------------------------------------------
  var LS_SCENARIO_KEY = 'hw26_test_scenario';
  var LS_ROLE_KEY = 'hw26_test_role';

  var urlParams = new URLSearchParams(window.location.search);
  var currentScenario = 'off';
  var mockHasRole = false;
  if (HALLOWEEN_TEST_MODE) {
    currentScenario = urlParams.get('hw_scenario') || safeLsGet(LS_SCENARIO_KEY) || 'off';
    var roleParam = urlParams.get('hw_role');
    mockHasRole = roleParam != null ? roleParam === '1' : safeLsGet(LS_ROLE_KEY) === '1';
  }

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

  // Escenario MOCK "effects_active" -- puramente visual, para revisar de
  // un vistazo las tarjetas de los 5 efectos posibles juntas. NUNCA
  // escribe en Supabase.
  function mockEffectsFull() {
    var now = Date.now();
    return [
      { effect_key: 'escudo_arcano', scope: 'geoarmy', applies_to: null, multiplier: 0.5, remaining_uses: 1, expires_at: null, created_at: new Date(now - 30000).toISOString() },
      { effect_key: 'vulnerabilidad', scope: 'boss', applies_to: null, multiplier: 2, remaining_uses: 2, expires_at: null, created_at: new Date(now - 60000).toISOString() },
      { effect_key: 'ruptura_arcana', scope: 'boss', applies_to: null, multiplier: 2, remaining_uses: 1, expires_at: null, created_at: new Date(now - 90000).toISOString() },
      { effect_key: 'marca_bruja', scope: 'geoarmy', applies_to: null, multiplier: 0.5, remaining_uses: 1, expires_at: null, created_at: new Date(now - 120000).toISOString() },
      { effect_key: 'herida_profana', scope: 'geoarmy', applies_to: null, multiplier: 0.5, remaining_uses: 1, expires_at: null, created_at: new Date(now - 150000).toISOString() },
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

  // Escenario MOCK "feed_active" -- las 6 entradas de ejemplo pedidas,
  // pensadas para revisar la jerarquía visual de la crónica (hora, texto,
  // daño destacado, eventos de boss más agresivos). Las horas son de HOY
  // a las 20:41–20:50 para que se lean igual que el ejemplo sin depender
  // de cuándo se pruebe. Puramente visual: nunca escribe en Supabase.
  function mockFeedActive() {
    var d = new Date();
    function atTime(h, m) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).toISOString();
    }
    return [
      { log_id: 106, entry_type: 'phase_change', actor_name: null, actor_role: null, action_key: null, boss_attack_key: null, effect_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 999000, geoarmy_hp_after: 15000, phase_after: 2, created_at: atTime(20, 50) },
      { log_id: 105, entry_type: 'boss_attack', actor_name: null, actor_role: null, action_key: null, boss_attack_key: 'cataclismo', effect_key: null, boss_hp_delta: 0, geoarmy_hp_delta: -6000, multiplier_applied: 1, boss_hp_after: 1400000, geoarmy_hp_after: 21000, phase_after: 1, created_at: atTime(20, 46) },
      { log_id: 104, entry_type: 'boss_attack_announced', actor_name: null, actor_role: null, action_key: null, boss_attack_key: 'cataclismo', effect_key: null, boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 1400000, geoarmy_hp_after: 27000, phase_after: 1, created_at: atTime(20, 45) },
      { log_id: 103, entry_type: 'effect_applied', actor_name: 'Geo Army', actor_role: null, action_key: null, boss_attack_key: null, effect_key: 'escudo_arcano', boss_hp_delta: 0, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 1400000, geoarmy_hp_after: 27000, phase_after: 1, created_at: atTime(20, 43) },
      { log_id: 102, entry_type: 'boss_attack', actor_name: null, actor_role: null, action_key: null, boss_attack_key: 'fuego_infernal', effect_key: null, boss_hp_delta: 0, geoarmy_hp_delta: -9000, multiplier_applied: 1, boss_hp_after: 1403000, geoarmy_hp_after: 27000, phase_after: 1, created_at: atTime(20, 42) },
      { log_id: 101, entry_type: 'player_attack', actor_name: 'Geovannyrk', actor_role: 'attacker', action_key: 'golpe_del_abismo', boss_attack_key: null, effect_key: null, boss_hp_delta: -3000, geoarmy_hp_delta: 0, multiplier_applied: 1, boss_hp_after: 1403000, geoarmy_hp_after: 36000, phase_after: 1, created_at: atTime(20, 41) },
    ];
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

  // Escenarios MOCK exclusivos para revisar el diseño de Contratos con
  // contenido real de ejemplo (contratos_empty / contratos_upcoming /
  // contratos_active). Puramente visuales: NUNCA escriben en Supabase, y
  // cuando exista la RPC/tabla real de contratos se usará exclusivamente
  // halloween_2026_get_public_missions() sin pasar por aquí.
  function mockMissionsContratos(scenario) {
    if (scenario === 'contratos_empty') return [];
    var base = [
      { mission_id: 101, mission_key: 'fn_caza_nocturna', category: 'fortnite', title: 'CAZA NOCTURNA', description: 'Elimina 5 enemigos', mission_day: '2026-10-15', opens_at: '2026-10-15T00:00:00-04:00', closes_at: '2026-10-15T23:59:59-04:00', availability: 'active', is_final_battle: false, boss_damage: 5000, verification_mode: 'clip', sort_order: 1 },
      { mission_id: 102, mission_key: 'ow_sin_escapatoria', category: 'overwatch', title: 'SIN ESCAPATORIA', description: 'Gana 2 partidas', mission_day: '2026-10-18', opens_at: '2026-10-18T00:00:00-04:00', closes_at: '2026-10-18T23:59:59-04:00', availability: 'upcoming', is_final_battle: false, boss_damage: 8000, verification_mode: 'auto', sort_order: 2 },
      { mission_id: 103, mission_key: 'stream_ritual_comunidad', category: 'stream', title: 'RITUAL DE LA COMUNIDAD', description: 'Meta comunitaria', mission_day: '2026-10-24', opens_at: '2026-10-01T00:00:00-04:00', closes_at: '2026-10-31T23:59:59-04:00', availability: 'upcoming', is_final_battle: false, boss_damage: 15000, verification_mode: 'manual', sort_order: 3 },
    ];
    if (scenario === 'contratos_upcoming') {
      return base.map(function (m) { return Object.assign({}, m, { availability: 'upcoming' }); });
    }
    return base; // contratos_active: mezcla activo/próximo, tal como el ejemplo pedido
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
      case 'halloween_2026_get_public_effects':
        if (currentScenario === 'effects_active') return mockEffectsFull();
        return mockEffects(currentScenario);
      case 'halloween_2026_get_public_feed':
        if (currentScenario === 'feed_active') return mockFeedActive();
        return mockFeed(currentScenario);
      case 'halloween_2026_get_public_missions':
        if (currentScenario === 'contratos_empty' || currentScenario === 'contratos_upcoming' || currentScenario === 'contratos_active') {
          return mockMissionsContratos(currentScenario);
        }
        return mockMissions(currentScenario);
      default: return null;
    }
  }

  // ---------------------------------------------------------------------
  // 3) Estado en memoria + intervals (con guardas anti-duplicado)
  // ---------------------------------------------------------------------
  var sbClient = null;
  var lastState = null;
  var lastParticipation = null;
  var participationStatus = 'unknown'; // 'ok' | 'no-session' | 'error'
  var lastEffects = [];
  var lastFeed = [];
  var lastMissions = [];
  var cataclysmTimerId = null;
  var pollIds = { main: null };

  function clearAllIntervals() {
    Object.keys(pollIds).forEach(function (k) {
      if (pollIds[k]) { clearInterval(pollIds[k]); pollIds[k] = null; }
    });
    if (cataclysmTimerId) { clearInterval(cataclysmTimerId); cataclysmTimerId = null; }
  }
  window.addEventListener('beforeunload', clearAllIntervals);

  // ---------------------------------------------------------------------
  // 4) Carga de datos — cada función SOLO obtiene y guarda datos (no
  //    renderiza nada): así cada página dedicada decide qué cargar y qué
  //    hacer con el resultado, sin pedir datos que no va a mostrar.
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
      })
      .catch(function (e) {
        console.warn('[halloween-2026] fallo halloween_2026_get_public_state', e);
        lastState = null;
        showGlobalError('No se pudo cargar el estado de la batalla.');
      });
  }

  function loadParticipation() {
    var isMock = HALLOWEEN_TEST_MODE && currentScenario !== 'off';
    if (isMock) {
      return callRpc(sbClient, 'halloween_2026_get_my_participation').then(function (res) {
        lastParticipation = res.data;
        participationStatus = 'ok';
      });
    }
    if (!sbClient) { lastParticipation = null; participationStatus = 'no-session'; return Promise.resolve(); }
    return sbClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) { lastParticipation = null; participationStatus = 'no-session'; return; }
      return callRpc(sbClient, 'halloween_2026_get_my_participation')
        .then(function (res) {
          if (res.error) throw res.error;
          lastParticipation = Array.isArray(res.data) ? res.data[0] : res.data;
          participationStatus = 'ok';
        })
        .catch(function (e) {
          console.warn('[halloween-2026] fallo halloween_2026_get_my_participation', e);
          lastParticipation = null;
          participationStatus = 'error';
        });
    }).catch(function (e) {
      console.warn('[halloween-2026] fallo al obtener sesión', e);
      lastParticipation = null;
      participationStatus = 'error';
    });
  }

  function loadEffects() {
    // halloween_2026_get_public_effects() no recibe parámetros (ver spec).
    return callRpc(sbClient, 'halloween_2026_get_public_effects')
      .then(function (res) {
        if (res.error) throw res.error;
        lastEffects = res.data || [];
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
      })
      .catch(function (e) {
        console.warn('[halloween-2026] fallo halloween_2026_get_public_missions', e);
        lastMissions = null;
      });
  }

  // ---------------------------------------------------------------------
  // 5) PÁGINA "battle" (halloween/batalla.html) — el widget de La Heraldo
  // ---------------------------------------------------------------------
  var prevBossHp = null, prevGeoHp = null, prevBossPhase = null;

  // Transición de fase 1 -> 2 en la misma sesión: flash violeta/rojo +
  // texto temporal "EL SELLO SE HA ROTO" sobre la imagen grande, y un
  // glow más intenso en el marco. Puramente visual/CSS -- no recarga la
  // página ni cambia ningún dato, solo reacciona a que boss_phase pasó de
  // 1 a 2 entre dos polls. Duración total ~1.8s.
  function triggerPhaseTransition() {
    var boss = $('hw26Boss');
    var flashEl = $('hw26PhaseFlash');
    if (boss) {
      boss.classList.remove('hw26-phase-transitioning');
      void boss.offsetWidth; // reflow, por si se dispara dos veces seguidas
      boss.classList.add('hw26-phase-transitioning');
      setTimeout(function () { boss.classList.remove('hw26-phase-transitioning'); }, 1800);
    }
    if (flashEl) {
      flashEl.hidden = false;
      flashEl.classList.remove('is-active');
      void flashEl.offsetWidth;
      flashEl.classList.add('is-active');
      setTimeout(function () { flashEl.hidden = true; flashEl.classList.remove('is-active'); }, 1800);
    }
  }

  // Imagen de La Heraldo por fase: intenta assets/halloween/heraldo-faseN.webp
  // y si no existe (404 / onerror) cae al placeholder del planeta que ya
  // trae la etiqueta <img data-fallback="..."> en el HTML. HERO_IMG_MISSING
  // recuerda qué fases ya fallaron para no reintentar la misma URL rota en
  // cada poll (evita spam de requests fallidos).
  // cataclysmActive (booleano, leído de pending_attack_key === 'cataclismo'
  // en renderBoss) cambia la imagen a assets/halloween/cataclismo.webp
  // mientras dure; al desaparecer pending_attack_key vuelve sola a la
  // imagen de la fase actual en el siguiente poll -- puramente visual, el
  // backend sigue siendo el único que resuelve Cataclismo.
  var HERO_IMG_MISSING = {};
  function updateBossImg(phase, cataclysmActive) {
    var img = $('hw26BossImg');
    if (!img) return;
    var fallback = img.getAttribute('data-fallback') || img.src;
    var wanted = cataclysmActive
      ? '../assets/halloween/cataclismo.webp'
      : '../assets/halloween/heraldo-fase' + (phase === 2 ? 2 : 1) + '.webp';

    if (HERO_IMG_MISSING[wanted]) {
      if (img.getAttribute('src') !== fallback) img.src = fallback;
      return;
    }
    if (img.getAttribute('data-hero-src') === wanted) return; // ya es esta

    img.onerror = function () {
      HERO_IMG_MISSING[wanted] = true;
      img.onerror = null;
      img.removeAttribute('data-hero-src');
      img.src = fallback;
    };
    img.setAttribute('data-hero-src', wanted);
    img.src = wanted;
    img.alt = cataclysmActive ? 'La Heraldo prepara Cataclismo' : 'La Heraldo';
  }

  function renderBoss(state) {
    var boss = $('hw26Boss');
    if (!boss) return;

    // La fase se lee tal cual de boss_phase (nunca se calcula por HP). Un
    // evento todavía "scheduled" trae boss_phase 1 desde el backend, así
    // que esto ya muestra Fase I sin necesitar un caso especial aquí.
    var phase = state.boss_phase === 2 ? 2 : 1;

    // Cataclismo activo = presentación especial temporal (imagen +
    // ambiente), leído del mismo campo que ya usa renderCataclysm() para
    // el bloque de alerta y el countdown. Nunca decide si Cataclismo
    // "ocurrió" ni cuándo termina -- solo refleja lo que ya viene del
    // backend/mock en pending_attack_key.
    var isCataclysm = state.pending_attack_key === 'cataclismo';

    boss.setAttribute('data-phase', String(phase));
    boss.setAttribute('data-eventstatus', state.status || 'scheduled');
    boss.setAttribute('data-outcome', state.outcome || 'none');
    boss.setAttribute('data-cataclysm', isCataclysm ? '1' : '0');

    var badge = $('hw26PhaseBadge');
    var phaseText = $('hw26PhaseText');
    if (phase === 2) {
      if (badge) badge.textContent = 'FASE II';
      if (phaseText) phaseText.textContent = 'FASE II — FORMA DEMONÍACA';
    } else {
      if (badge) badge.textContent = 'FASE I';
      if (phaseText) phaseText.textContent = 'FASE I — FORMA SELLADA';
    }
    updateBossImg(phase, isCataclysm);

    // Transición 1 -> 2 detectada entre dos polls en la misma sesión.
    if (prevBossPhase != null && prevBossPhase === 1 && phase === 2) {
      triggerPhaseTransition();
    }
    prevBossPhase = phase;

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
    if (bossText) bossText.textContent = fmtNum(state.boss_hp) + ' / ' + fmtNum(state.boss_max_hp) + ' HP';
    if (geoText) geoText.textContent = fmtNum(state.geoarmy_hp) + ' / ' + fmtNum(state.geoarmy_max_hp) + ' HP';

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

  // Tarjeta de efecto compartida entre la mini-sección de batalla.html y
  // la página completa de efectos.html. "Trabajada": icono en círculo,
  // nombre, descripción corta, chip de multiplicador y píldora de usos.
  function effectCardHtml(fx) {
    var meta = EFFECT_META[fx.effect_key] || { icon: '✨', name: fx.effect_key, desc: '' };
    var mult = (fx.multiplier != null) ? ('×' + fx.multiplier) : '';
    var usesLabel = (fx.remaining_uses != null) ? (fx.remaining_uses + (fx.remaining_uses === 1 ? ' uso' : ' usos')) : '';
    var scopeLine = effectScopeLabel(fx.scope);
    return '<div class="hw26-effect-card">' +
      '<span class="hw26-effect-icon-circle"><span class="hw26-effect-icon">' + meta.icon + '</span></span>' +
      '<div class="hw26-effect-body">' +
        '<div class="hw26-effect-top">' +
          '<span class="hw26-effect-name">' + esc(meta.name) + '</span>' +
          (mult ? '<span class="hw26-effect-mult-chip">' + esc(mult) + '</span>' : '') +
        '</div>' +
        '<div class="hw26-effect-desc">' + esc(meta.desc) + '</div>' +
        '<div class="hw26-effect-meta-row">' +
          (scopeLine ? '<span class="hw26-effect-scope">' + esc(scopeLine) + '</span>' : '') +
          (usesLabel ? '<span class="hw26-effect-uses-pill">' + esc(usesLabel) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // Alimenta la tarjeta "EFECTOS" de la franja de apoyo debajo del hero,
  // con los mismos datos que ya carga initBattlePage() -- sin RPC nueva ni
  // polling adicional. A diferencia de las otras 3 tarjetas (teasers
  // estáticos), esta sí muestra estado real.
  function renderBattleEffects() {
    var box = $('hw26SupportEffectsBody');
    if (!box) return;
    if (lastEffects == null) {
      box.innerHTML = '<span class="hw26-support-text">Efectos no disponibles ahora.</span>';
      return;
    }
    if (!lastEffects.length) {
      box.innerHTML = '<span class="hw26-support-text hw26-support-text-muted">Ningún efecto activo ahora mismo.</span>';
      return;
    }
    box.innerHTML = lastEffects.slice(0, 3).map(effectCardHtml).join('');
  }

  // ---------------------------------------------------------------------
  // 5b) Cola visual de movimientos (Batalla) — SOLO presentación.
  //
  //     El motor/backend ya está cerrado: este bloque NUNCA calcula daño
  //     ni curación, NUNCA decide si algo ocurrió, y NUNCA toca boss_hp/
  //     geoarmy_hp localmente (eso lo sigue fijando renderBoss(lastState)
  //     con halloween_2026_get_public_state(), en cada poll, igual que
  //     antes). Esto solo LEE halloween_2026_get_public_feed(30) --mismo
  //     RPC y mismos campos que ya usa Crónicas (log_id, entry_type,
  //     actor_name, actor_role, action_key, boss_attack_key, effect_key,
  //     boss_hp_delta, geoarmy_hp_delta, created_at)-- y representa cada
  //     log nuevo como un movimiento breve, uno detrás de otro.
  //
  //     Dedupe: por log_id (el identificador estable real del log), nunca
  //     por nombre/daño/timestamp -- dos jugadores pueden generar el mismo
  //     ataque legítimamente.
  // ---------------------------------------------------------------------
  var MOVE_SEEN_IDS = {};      // log_id ya vistos esta sesión (dedupe real)
  var MOVE_QUEUE = [];         // logs nuevos pendientes de animar, en orden
  var MOVE_PLAYING = false;    // nunca se superponen dos movimientos
  var MOVE_BASELINE_DONE = false; // primera carga: registrar sin animar

  // entry_type que SÍ representa la cola como movimiento. role_selected,
  // mission_damage, boss_attack_announced, phase_change, victory, defeat
  // y event_started quedan fuera -- boss_attack_announced es solo el
  // aviso de Cataclismo (ya tiene su propia presentación vía
  // pending_attack_key/countdown, ver sección 10 del pedido) y el resto
  // no estaba en el set de movimientos pedido.
  function isMovementEntry(it) {
    return it.entry_type === 'player_attack' || it.entry_type === 'boss_attack' ||
      it.entry_type === 'heal' || it.entry_type === 'shield' ||
      it.entry_type === 'effect_applied';
  }
  var DRAIN_KEYS = { drenaje_alma: 1, drenaje_demoniaco: 1 };

  function fmtDelta(n) {
    n = Math.round(Number(n) || 0);
    var sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    return sign + fmtNum(Math.abs(n));
  }

  // Reutiliza feedItemText() (Crónicas) para no duplicar el formato
  // narrativo -- se limpia el HTML porque acá va en texto plano.
  function lastMoveText(item) {
    var html = feedItemText(item);
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }
  function renderLastMove(item) {
    var box = $('hw26LastMove');
    if (!box) return;
    box.textContent = 'ÚLTIMO MOVIMIENTO · ' + lastMoveText(item);
    box.hidden = false;
  }

  function shakeEl(el, ms) {
    if (!el) return;
    el.classList.remove('hw26-shake-local');
    void el.offsetWidth;
    el.classList.add('hw26-shake-local');
    setTimeout(function () { el.classList.remove('hw26-shake-local'); }, ms);
  }

  function flashHitOverlay() {
    var el = $('hw26BossHitFlash');
    if (!el) return;
    el.classList.remove('is-active');
    void el.offsetWidth;
    el.classList.add('is-active');
    setTimeout(function () { el.classList.remove('is-active'); }, 500);
  }

  // Crea el "pop" flotante (nombre + valor), lo saca solo del DOM al
  // terminar -- no deja basura acumulada en sesiones largas de stream.
  function spawnMovePop(zoneEl, nameText, valueText, extraCls, ms) {
    if (!zoneEl) return;
    var wrap = document.createElement('div');
    wrap.className = 'hw26-move-pop' + (extraCls ? ' ' + extraCls : '');
    wrap.style.animationDuration = ms + 'ms';
    wrap.innerHTML =
      (nameText ? '<div class="hw26-move-name">' + esc(nameText) + '</div>' : '') +
      (valueText ? '<div class="hw26-move-value">' + esc(valueText) + '</div>' : '');
    zoneEl.appendChild(wrap);
    setTimeout(function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, ms);
  }

  var MOVE_DURATION_MS = 1500; // dentro del rango pedido de 1.2-1.8s

  // Geo Army ataca a Morvanna -- zona derecha (sobre la imagen), flash
  // blanco/violeta breve, micro shake SOLO de la imagen.
  function playBossHit(item, done) {
    var label = ACTION_KEY_LABEL[item.action_key] || (item.action_key || 'ATAQUE').toUpperCase();
    spawnMovePop($('hw26MoveBoss'), label, fmtDelta(item.boss_hp_delta) + ' HP', '', MOVE_DURATION_MS);
    shakeEl($('hw26BossImg'), 500);
    flashHitOverlay();
    if ($('hw26BossHpFill')) flashOnce($('hw26BossHpFill'), 'hw26-flash-hit');
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Morvanna ataca a Geo Army -- zona izquierda (sobre la barra de
  // resistencia), flash rojo local, shake SOLO del bloque de resistencia.
  // Cataclismo, si llega aquí como boss_attack normal (resolución real,
  // no el aviso), usa exactamente el mismo camino -- solo se anima el
  // resultado, nunca el anuncio de preparación (eso lo filtra
  // isMovementEntry() al excluir boss_attack_announced).
  function playGeoHit(item, done) {
    var label = BOSS_ATTACK_LABEL[item.boss_attack_key] || (item.boss_attack_key || 'ATAQUE').toUpperCase();
    spawnMovePop($('hw26MoveGeo'), label, fmtDelta(item.geoarmy_hp_delta) + ' RESISTENCIA', '', MOVE_DURATION_MS);
    shakeEl($('hw26GeoBarBlock'), 500);
    if ($('hw26GeoHpFill')) flashOnce($('hw26GeoHpFill'), 'hw26-flash-hit');
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Curación -- pulso dorado/verde sobre la barra Geo Army, con el valor
  // REAL del log (nunca hardcodeado). El feed no expone qué curación
  // canon fue (curacion_menor/pulso_vital/bendicion_guardia): si el log
  // trae action_key se usa, si no, nombre genérico -- ver aviso final.
  function playHeal(item, done) {
    var label = HEAL_ACTION_LABEL[item.action_key] || 'Curación';
    spawnMovePop($('hw26MoveGeo'), label, fmtDelta(item.geoarmy_hp_delta) + ' RESISTENCIA', 'hw26-move-pop-heal', MOVE_DURATION_MS);
    if ($('hw26GeoHpFill')) flashOnce($('hw26GeoHpFill'), 'hw26-flash-heal');
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Escudo genérico (entry_type:'shield', sin sub-clave en el feed actual
  // -- distinto de un log effect_applied con effect_key:'escudo_arcano',
  // que si trae nombre propio vía playEffectAnnounce()).
  function playShieldGeneric(item, done) {
    spawnMovePop($('hw26MoveGeo'), 'Escudo', 'Geo Army se protegió', 'hw26-move-pop-buff', MOVE_DURATION_MS);
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Buff/debuff anunciado -- SOLO se muestra cuando el feed trae un log
  // effect_applied real con ese effect_key (nunca inferido por el nombre
  // de un ataque). El subtítulo de debuff (marca_bruja/herida_profana)
  // sale de DEBUFF_SUB_LABEL usando esa misma confirmación.
  function playEffectAnnounce(item, done) {
    var meta = EFFECT_META[item.effect_key];
    var title = meta ? (meta.name + ' ACTIVADO') : ((item.effect_key || 'EFECTO') + ' ACTIVADO').toUpperCase();
    var sub = DEBUFF_SUB_LABEL[item.effect_key] || '';
    spawnMovePop($('hw26MoveGeo'), title, sub, 'hw26-move-pop-buff', MOVE_DURATION_MS);
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Drenajes (drenaje_alma / drenaje_demoniaco) -- DOS pasos dentro del
  // MISMO movimiento: primero se ve drenada la resistencia de Geo Army
  // (izquierda), luego esa energía "llega" a Morvanna como HP (derecha).
  // Usa boss_hp_delta Y geoarmy_hp_delta del MISMO log -- el feed ya trae
  // ambos en una sola fila, no hace falta ningún cálculo nuevo.
  function playDrain(item, done) {
    var label = BOSS_ATTACK_LABEL[item.boss_attack_key] || (item.boss_attack_key || 'DRENAJE').toUpperCase();
    var stepMs = 880; // 2 pasos * 880ms = 1760ms, dentro de 1.2-1.8s
    spawnMovePop($('hw26MoveGeo'), label, fmtDelta(item.geoarmy_hp_delta) + ' RESISTENCIA', '', stepMs);
    shakeEl($('hw26GeoBarBlock'), 500);
    if ($('hw26GeoHpFill')) flashOnce($('hw26GeoHpFill'), 'hw26-flash-hit');
    setTimeout(function () {
      spawnMovePop($('hw26MoveBoss'), label, fmtDelta(item.boss_hp_delta) + ' HP MORVANNA', 'hw26-move-pop-heal', stepMs);
      shakeEl($('hw26BossImg'), 500);
      flashHitOverlay();
      if ($('hw26BossHpFill')) flashOnce($('hw26BossHpFill'), 'hw26-flash-heal');
      setTimeout(done, stepMs);
    }, stepMs);
  }

  function playMovement(item, done) {
    switch (item.entry_type) {
      case 'player_attack': return playBossHit(item, done);
      case 'boss_attack':
        return DRAIN_KEYS[item.boss_attack_key] ? playDrain(item, done) : playGeoHit(item, done);
      case 'heal': return playHeal(item, done);
      case 'shield': return playShieldGeneric(item, done);
      case 'effect_applied': return playEffectAnnounce(item, done);
      default: done();
    }
  }

  function processMoveQueue() {
    if (MOVE_PLAYING) return;
    var item = MOVE_QUEUE.shift();
    if (!item) return;
    MOVE_PLAYING = true;
    playMovement(item, function () {
      MOVE_PLAYING = false;
      processMoveQueue();
    });
  }

  // Detecta logs nuevos del feed ya cargado (loadFeed(), mismo poll de
  // Batalla) y los mete en la cola, en orden cronológico. En la primera
  // carga de la página NUNCA anima el historial: solo registra los
  // log_id como ya vistos y muestra el último movimiento como texto (ver
  // sección 3 del pedido) -- desde ahí, solo los logs que aparezcan
  // DESPUÉS entran a la cola.
  function processBattleFeed() {
    if (lastFeed == null) return; // error de carga -- nada que procesar
    var items = lastFeed.slice().sort(function (a, b) { return (a.log_id || 0) - (b.log_id || 0); });

    if (!MOVE_BASELINE_DONE) {
      items.forEach(function (it) { MOVE_SEEN_IDS[it.log_id] = true; });
      MOVE_BASELINE_DONE = true;
      var lastRelevant = null;
      for (var i = items.length - 1; i >= 0; i--) {
        if (isMovementEntry(items[i])) { lastRelevant = items[i]; break; }
      }
      if (lastRelevant) renderLastMove(lastRelevant);
      return;
    }

    items.forEach(function (it) {
      if (MOVE_SEEN_IDS[it.log_id]) return; // dedupe real por log_id
      MOVE_SEEN_IDS[it.log_id] = true;
      if (!isMovementEntry(it)) return;
      MOVE_QUEUE.push(it);
      renderLastMove(it);
    });
    processMoveQueue();
  }

  // Botones de TEST MODE (sección 15 del pedido): inyectan un log
  // sintético con id único directo a la cola, sin pasar por loadFeed() ni
  // Supabase -- puramente presentación, para poder probar cada tipo de
  // movimiento y que la cola nunca superponga. Ver wireDevBar().
  function moveTestItem(kind) {
    var id = 'test-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    switch (kind) {
      case 'geo_hit': return { log_id: id, entry_type: 'player_attack', action_key: 'golpe_abismo', actor_name: 'TesterMock', boss_hp_delta: -3000 };
      case 'boss_hit': return { log_id: id, entry_type: 'boss_attack', boss_attack_key: 'fuego_infernal', geoarmy_hp_delta: -6000 };
      case 'heal': return { log_id: id, entry_type: 'heal', action_key: 'pulso_vital', geoarmy_hp_delta: 5000 };
      case 'buff': return { log_id: id, entry_type: 'effect_applied', effect_key: 'escudo_arcano' };
      case 'debuff': return { log_id: id, entry_type: 'effect_applied', effect_key: 'marca_bruja' };
      case 'drain': return { log_id: id, entry_type: 'boss_attack', boss_attack_key: 'drenaje_alma', geoarmy_hp_delta: -8000, boss_hp_delta: 8000 };
      default: return null;
    }
  }

  function initBattlePage() {
    loadState().then(function () { if (lastState) renderBoss(lastState); });
    loadEffects().then(renderBattleEffects);
    // Mismo ciclo de poll que ya tenía Batalla (5s, ver POLL_INTERVAL_MS
    // más abajo) -- sin setInterval nuevo.
    loadFeed().then(processBattleFeed);
  }

  // ---------------------------------------------------------------------
  // 6) PÁGINA "role" (halloween/rol.html)
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

  // Tarjeta de rol compartida entre la vista bloqueada (preview, antes del
  // 1 de octubre) y la vista activa (seleccionable). opts.locked agrega el
  // badge "BLOQUEADO", desactiva el botón (disabled/aria-disabled) y deja
  // que el CSS la atenúe -- pero SIEMPRE se muestran las 3 tarjetas, nunca
  // una caja vacía con solo un candado.
  function roleCardHtml(key, meta, opts) {
    opts = opts || {};
    var cls = 'hw26-role-card' + (opts.locked ? ' is-locked' : '') + (opts.selected ? ' is-selected' : '');
    var attrs = 'type="button" class="' + cls + '" data-role="' + key + '"';
    if (opts.locked) attrs += ' disabled aria-disabled="true"';
    return '<button ' + attrs + '>' +
      (opts.locked ? '<span class="hw26-role-lock-badge">🔒 BLOQUEADO</span>' : '') +
      '<span class="hw26-role-icon">' + meta.icon + '</span>' +
      '<span class="hw26-role-body"><span class="hw26-role-name">' + esc(meta.name) + '</span>' +
      '<span class="hw26-role-desc">' + esc(meta.desc) + '</span></span>' +
    '</button>';
  }

  function renderRolePage() {
    var box = $('hw26RoleContent');
    if (!box) return;

    if (!lastState) { box.innerHTML = genericErrorHtml('No se pudo cargar el estado de la batalla.'); return; }

    // Aunque el evento todavía esté "scheduled", se muestran las 3
    // tarjetas de rol (atenuadas, no clickeables, con badge "BLOQUEADO")
    // para que el usuario pueda conocerlas antes de que empiece la
    // batalla -- nunca una caja vacía con solo un candado.
    if (lastState.status === 'scheduled') {
      box.innerHTML =
        '<div class="hw26-page-sub" style="margin:0 0 16px;">Conoce los roles disponibles antes de que comience la batalla.</div>' +
        '<div class="hw26-role-grid">' +
        Object.keys(ROLE_META).map(function (key) {
          return roleCardHtml(key, ROLE_META[key], { locked: true });
        }).join('') +
        '</div>' +
        '<div class="hw26-role-warning hw26-role-warning-locked">🔒 Disponible 1 OCT · 7:00 PM ET</div>';
      return;
    }

    if (participationStatus === 'no-session') {
      box.innerHTML =
        '<div class="hw26-locked-box hw26-locked-box-big">' +
          '<div class="hw26-lock-icon">👤</div>' +
          '<b>Necesitas iniciar sesión</b>' +
          '<div class="hw26-page-sub" style="margin:8px 0 14px;">Inicia sesión con Twitch para elegir tu rol en la batalla.</div>' +
          '<button type="button" class="hw26-role-confirm" id="hw26LoginFromPage">Iniciar sesión</button>' +
        '</div>';
      var loginBtn = $('hw26LoginFromPage');
      if (loginBtn) loginBtn.addEventListener('click', function () {
        if (window.GeoArmyAccount && window.GeoArmyAccount.openLogin) window.GeoArmyAccount.openLogin();
      });
      return;
    }

    if (participationStatus === 'error') {
      box.innerHTML = genericErrorHtml('No se pudo verificar tu participación. Intenta de nuevo más tarde.');
      return;
    }

    if (lastParticipation && lastParticipation.has_role) {
      var meta = ROLE_META[lastParticipation.role] || { icon: '⚔', name: lastParticipation.role, desc: '' };
      box.innerHTML =
        '<div class="hw26-role-current hw26-role-current-big">' +
          '<span class="hw26-role-icon">' + meta.icon + '</span>' +
          '<div><div class="hw26-role-name">' + esc(meta.name) + '</div>' +
          '<div class="hw26-role-desc">' + esc(meta.desc) + '</div>' +
          '<div class="hw26-role-desc" style="margin-top:6px;">Tu rol es permanente durante Halloween 2026.</div></div>' +
        '</div>';
      return;
    }

    if (!lastParticipation || !lastParticipation.can_choose_role) {
      box.innerHTML = genericErrorHtml('La elección de rol no está disponible en este momento.');
      return;
    }

    var selected = null;
    var html =
      '<div class="hw26-page-sub" style="margin:0 0 16px;">Cada participante elige un rol una sola vez para todo octubre.</div>' +
      '<div class="hw26-role-grid">' +
      Object.keys(ROLE_META).map(function (key) {
        return roleCardHtml(key, ROLE_META[key], {});
      }).join('') +
      '</div>' +
      '<div class="hw26-role-warning">Tu elección será permanente durante Halloween 2026.</div>' +
      '<button type="button" class="hw26-role-confirm" id="hw26ConfirmRole" disabled>Confirmar rol</button>';
    box.innerHTML = html;

    var cards = box.querySelectorAll('.hw26-role-card');
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

      var isMock = HALLOWEEN_TEST_MODE && currentScenario !== 'off';
      var confirmCall = isMock
        ? Promise.resolve({ data: { ok: true }, error: null }) // mock: NO escribe nada real
        : sbClient.rpc('halloween_2026_choose_role', { p_event_key: EVENT_KEY, p_role: selected });

      confirmCall.then(function (res) {
        if (res.error) throw res.error;
        // No optimistic update permanente: se vuelve a consultar
        // participación real (o mock) antes de reflejar el cambio.
        if (isMock) { mockHasRole = true; safeLsSet(LS_ROLE_KEY, '1'); }
        return loadParticipation();
      }).then(function () {
        renderRolePage();
      }).catch(function (e) {
        console.warn('[halloween-2026] fallo halloween_2026_choose_role', e);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar rol';
        box.insertAdjacentHTML('beforeend', genericErrorHtml('No se pudo guardar tu rol. Intenta de nuevo.'));
      });
    });
  }

  function initRolePage() {
    Promise.all([loadState(), loadParticipation()]).then(renderRolePage);
  }

  // ---------------------------------------------------------------------
  // 7) PÁGINA "missions" (halloween/contratos.html)
  // ---------------------------------------------------------------------
  var MISSION_CATEGORY_LABEL = { fortnite: 'FORTNITE', overwatch: 'OVERWATCH', stream: 'STREAM' };
  var MISSION_STATUS_LABEL = { upcoming: 'PRÓXIMO', active: 'ACTIVO', ended: 'TERMINADO' };

  function renderMissionsPage() {
    var box = $('hw26MissionsContent');
    if (!box) return;
    if (lastMissions == null) { box.innerHTML = genericErrorHtml('Contratos temporalmente no disponibles.'); return; }
    if (!lastMissions.length) { box.innerHTML = emptyStateHtml('📜', 'SIN CONTRATOS ACTIVOS', 'Todavía no hay contratos publicados.'); return; }

    var byCat = { fortnite: [], overwatch: [], stream: [] };
    lastMissions.forEach(function (m) { (byCat[m.category] || (byCat[m.category] = [])).push(m); });

    var html = '';
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
    box.innerHTML = html || emptyStateHtml('📜', 'SIN CONTRATOS ACTIVOS', 'Todavía no hay contratos publicados.');
  }

  function initMissionsPage() {
    loadMissions().then(renderMissionsPage);
  }

  // ---------------------------------------------------------------------
  // 8) PÁGINA "effects" (halloween/efectos.html)
  // ---------------------------------------------------------------------
  var EFFECT_META = {
    escudo_arcano: { icon: '🛡', name: 'ESCUDO ARCANO', desc: 'Reduce el daño del próximo ataque de La Heraldo.' },
    vulnerabilidad: { icon: '🔮', name: 'VULNERABILIDAD', desc: 'Multiplica el daño de los ataques de Geo Army.' },
    // "hechizo_vulnerabilidad" -- alias agregado para la cola de movimientos
    // de Batalla: el canon de efectos que ya tenía esta página usa
    // "vulnerabilidad", pero el pedido de movimientos en vivo lista
    // "hechizo_vulnerabilidad". Dejo las DOS claves apuntando al mismo
    // efecto para no romper nada ya aprobado en Efectos -- avisar cuál usa
    // realmente el backend para poder borrar la que sobre.
    hechizo_vulnerabilidad: { icon: '🔮', name: 'VULNERABILIDAD', desc: 'Multiplica el daño de los ataques de Geo Army.' },
    ruptura_arcana: { icon: '📜', name: 'RUPTURA ARCANA', desc: 'Multiplica el daño del próximo Contrato completado.' },
    marca_bruja: { icon: '🩸', name: 'MARCA DE LA BRUJA', desc: 'Reduce el daño del próximo ataque de Geo Army.' },
    herida_profana: { icon: '💀', name: 'HERIDA PROFANA', desc: 'Reduce la próxima curación de Geo Army.' },
    // "pocion_furia" -- clave nueva pedida para la cola de movimientos,
    // no existía antes en Efectos. Descripción de mejor esfuerzo (no hay
    // spec previa de qué hace exactamente) -- corregir si no es así.
    pocion_furia: { icon: '🔥', name: 'POCIÓN DE FURIA', desc: 'Aumenta temporalmente el daño de Geo Army.' },
  };
  function effectScopeLabel(scope) {
    if (scope === 'geoarmy') return 'Afecta a Geo Army';
    if (scope === 'boss') return 'Afecta a La Heraldo';
    return '';
  }

  function renderEffectsPage() {
    var box = $('hw26EffectsContent');
    if (!box) return;
    if (lastEffects == null) { box.innerHTML = genericErrorHtml('Efectos temporalmente no disponibles.'); return; }
    if (!lastEffects.length) { box.innerHTML = emptyStateHtml('🔮', 'NINGÚN EFECTO ACTIVO', 'El campo de batalla está estable… por ahora.'); return; }
    box.innerHTML = lastEffects.map(effectCardHtml).join('');
  }

  function initEffectsPage() {
    loadEffects().then(renderEffectsPage);
  }

  // ---------------------------------------------------------------------
  // 9) PÁGINA "feed" (halloween/cronicas.html)
  // ---------------------------------------------------------------------
  // Etiquetas narrativas para Crónicas Y para la cola de movimientos de
  // Batalla (misma fuente única, ver playBossHit/playGeoHit/playDrain) --
  // solo texto de presentación, no cambian ni calculan nada del combate.
  // "golpe_abismo" es la clave canon del pedido de movimientos en vivo;
  // dejo "golpe_del_abismo" (ya usada aquí antes) como alias por si el
  // backend real todavía manda esa -- avisar cuál es la real para borrar
  // la que sobre.
  var ACTION_KEY_LABEL = {
    golpe_del_abismo: 'Golpe del Abismo',
    golpe_abismo: 'Golpe del Abismo',
    aranazo_maldito: 'Arañazo Maldito',
    ritual_sangre: 'Ritual de Sangre',
  };
  var BOSS_ATTACK_LABEL = {
    fuego_infernal: 'Fuego Infernal',
    cataclismo: 'Cataclismo',
    zarpazo_sombrio: 'Zarpazo Sombrío',
    maldicion_carmesi: 'Maldición Carmesí',
    drenaje_alma: 'Drenaje de Alma',
    marca_bruja: 'Marca de la Bruja',
    garras_abismo: 'Garras del Abismo',
    drenaje_demoniaco: 'Drenaje Demoníaco',
    herida_profana: 'Herida Profana',
  };
  // Curaciones -- el feed real solo expone entry_type:'heal' con el delta,
  // SIN un campo que diga cuál de las 3 curaciones canon fue (no hay
  // action_key poblado en los logs de heal vistos hasta ahora). Si el
  // backend real sí manda item.action_key en estos logs, se usa aquí; si
  // no, se cae a un nombre genérico -- ver playHeal().
  var HEAL_ACTION_LABEL = {
    curacion_menor: 'Curación Menor',
    pulso_vital: 'Pulso Vital',
    bendicion_guardia: 'Bendición de Guardia',
  };
  // Subtítulo de debuff especial -- SOLO se usa cuando el propio feed
  // confirma con un log effect_applied que el efecto se aplicó (ver
  // playEffectAnnounce()), nunca inferido solo por el nombre del ataque.
  var DEBUFF_SUB_LABEL = {
    marca_bruja: 'PRÓXIMO ATAQUE DEBILITADO',
    herida_profana: 'PRÓXIMA CURACIÓN DEBILITADA',
  };

  function feedItemText(item) {
    var bossDmg = fmtNum(Math.abs(item.boss_hp_delta || 0));
    var geoDmg = fmtNum(Math.abs(item.geoarmy_hp_delta || 0));
    switch (item.entry_type) {
      case 'role_selected':
        return esc(item.actor_name || 'Alguien') + ' se unió a la batalla.';
      case 'player_attack':
        var actionLabel = ACTION_KEY_LABEL[item.action_key] || 'un ataque';
        return esc(item.actor_name || 'Un guerrero') + ' usó ' + esc(actionLabel) +
          ' — <span class="hw26-feed-dmg">' + bossDmg + ' daño</span>.';
      case 'heal':
        return 'Geo Army recuperó <span class="hw26-feed-heal">' + geoDmg + ' HP</span>.';
      case 'shield':
        return 'Geo Army activó un escudo.';
      case 'mission_damage':
        return 'Un Contrato golpeó a La Heraldo por <span class="hw26-feed-dmg">' + bossDmg + '</span>.';
      case 'effect_applied':
        if (item.effect_key && EFFECT_META[item.effect_key]) {
          return 'Geo Army activó <b>' + esc(titleCaseEs(EFFECT_META[item.effect_key].name)) + '</b>.';
        }
        return 'Un nuevo efecto se activó sobre el campo de batalla.';
      case 'effect_consumed':
        return 'Un efecto activo se consumió.';
      case 'boss_attack_announced':
        var announceLabel = BOSS_ATTACK_LABEL[item.boss_attack_key] ? BOSS_ATTACK_LABEL[item.boss_attack_key].toUpperCase() : 'UN ATAQUE';
        return 'LA HERALDO PREPARA ' + announceLabel + '.';
      case 'boss_attack':
        if (item.boss_attack_key === 'cataclismo') {
          return 'Cataclismo impactó — <span class="hw26-feed-dmg hw26-feed-dmg-boss">' + geoDmg + ' daño</span>.';
        }
        var bossLabel = BOSS_ATTACK_LABEL[item.boss_attack_key] || 'un ataque';
        return 'La Heraldo respondió con ' + esc(bossLabel) + ' — <span class="hw26-feed-dmg hw26-feed-dmg-boss">' + geoDmg + ' daño</span>.';
      case 'boss_heal':
        return 'La Heraldo recuperó <span class="hw26-feed-heal">' + bossDmg + ' HP</span>.';
      case 'phase_change':
        return 'EL SELLO SE ROMPIÓ. FASE ' + (item.phase_after === 2 ? 'II' : esc(item.phase_after || '')) + '.';
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

  // Eventos "de boss" -- se destacan con más fuerza visual (borde/fondo
  // más intensos vía CSS [data-type], ver sección 6 de halloween-2026.css).
  var BOSS_EVENT_TYPES = { boss_attack: 1, boss_attack_announced: 1, phase_change: 1, defeat: 1 };

  function renderFeedPage() {
    var box = $('hw26FeedContent');
    if (!box) return;
    if (lastFeed == null) { box.innerHTML = genericErrorHtml('Crónicas temporalmente no disponibles.'); return; }
    if (!lastFeed.length) { box.innerHTML = emptyStateHtml('📖', 'AÚN NO HAY CRÓNICAS', 'La historia de esta batalla todavía no se ha escrito.'); return; }
    var sorted = lastFeed.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    var html = '<div class="hw26-feed-list">';
    sorted.forEach(function (item) {
      var time = '';
      try { time = new Date(item.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); } catch (e) {}
      var isBoss = !!BOSS_EVENT_TYPES[item.entry_type];
      html +=
        '<div class="hw26-feed-item' + (isBoss ? ' is-boss-event' : '') + '" data-type="' + esc(item.entry_type) + '">' +
          '<span class="hw26-feed-time">' + esc(time) + '</span>' +
          '<span class="hw26-feed-text">' + feedItemText(item) + '</span>' +
        '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  }

  function initFeedPage() {
    loadFeed().then(renderFeedPage);
  }

  // ---------------------------------------------------------------------
  // 10) Panel de pruebas (dev bar) — SOLO test mode, en cada página
  // ---------------------------------------------------------------------
  var PAGE_INIT = {
    battle: initBattlePage,
    role: initRolePage,
    missions: initMissionsPage,
    effects: initEffectsPage,
    feed: initFeedPage,
  };

  function runPageInit() {
    var fn = PAGE_INIT[PAGE];
    if (fn) fn();
  }

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
        safeLsSet(LS_SCENARIO_KEY, currentScenario);
        var url = new URL(window.location.href);
        if (currentScenario === 'off') url.searchParams.delete('hw_scenario');
        else url.searchParams.set('hw_scenario', currentScenario);
        history.replaceState(null, '', url);
        runPageInit();
      });
    }
    if (roleCheck) {
      roleCheck.checked = mockHasRole;
      roleCheck.addEventListener('change', function () {
        mockHasRole = roleCheck.checked;
        safeLsSet(LS_ROLE_KEY, mockHasRole ? '1' : '0');
        var url = new URL(window.location.href);
        if (mockHasRole) url.searchParams.set('hw_role', '1'); else url.searchParams.delete('hw_role');
        history.replaceState(null, '', url);
        runPageInit();
      });
    }
    // Botones de prueba de la cola de movimientos (solo existen en
    // halloween/batalla.html) -- inyectan un log sintético directo a la
    // cola visual, ver moveTestItem()/processMoveQueue(). Nunca tocan
    // loadFeed() ni Supabase.
    var moveButtons = bar.querySelectorAll('[data-move-test]');
    moveButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = moveTestItem(btn.getAttribute('data-move-test'));
        if (!item) return;
        MOVE_QUEUE.push(item);
        renderLastMove(item);
        processMoveQueue();
      });
    });
  }

  // ---------------------------------------------------------------------
  // 11) Polling — solo el de la página actual, nada más
  //     (p.ej. cronicas.html NUNCA arranca un poll de misiones/efectos).
  // ---------------------------------------------------------------------
  var POLL_INTERVAL_MS = { battle: 5000, role: 20000, missions: 45000, effects: 9000, feed: 8000 };

  function startPolling() {
    clearAllIntervals();
    var ms = POLL_INTERVAL_MS[PAGE];
    if (!ms) return;
    pollIds.main = setInterval(runPageInit, ms);
  }

  // ---------------------------------------------------------------------
  // 12) Arranque
  // ---------------------------------------------------------------------
  var didInitialLoad = false;

  function init() {
    wireDevBar();

    function afterClient(client) {
      sbClient = client;
      if (client && client.auth && client.auth.onAuthStateChange) {
        client.auth.onAuthStateChange(function () {
          if (PAGE === 'role') { loadParticipation().then(renderRolePage); }
        });
      }
      if (didInitialLoad) return; // ya se arrancó con mock; solo llegamos aquí a enchufar el cliente real
      didInitialLoad = true;
      runPageInit();
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
