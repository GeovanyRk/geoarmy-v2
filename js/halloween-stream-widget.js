// =========================================================================
// HALLOWEEN 2026 — Widget de stream (OBS Browser Source)
// =========================================================================
// Archivo NUEVO y AISLADO. Se carga ÚNICAMENTE desde
// halloween/stream-widget.html. NO depende del DOM de batalla.html ni de
// ninguna otra página -- tiene sus propios ids (hsw*) y su propia copia
// de la lógica de cola/dedupe de movimientos (MOVE_SEEN_IDS/MOVE_QUEUE/
// isMovementEntry), reutilizada CONCEPTUALMENTE de js/halloween-2026.js
// pero reimplementada aquí sin tocar ni requerir ese archivo.
//
// Reglas de seguridad que este archivo respeta siempre:
//  - Solo lectura. NUNCA escribe nada en Supabase.
//  - NUNCA usa service_role -- reutiliza el mismo cliente anon compartido
//    (window.GeoArmyAccount.client, creado por js/geoarmy-account.js),
//    exactamente como ya hace js/halloween-2026.js. Nunca crea un cliente
//    nuevo.
//  - NUNCA consulta tablas halloween_2026_* directamente (nada de
//    .from('halloween_2026_...')). Solo 2 RPC públicas:
//    halloween_2026_get_public_state() y
//    halloween_2026_get_public_feed({ p_limit: 30 }).
//  - NUNCA calcula daño/HP/resultado en el navegador. Las barras SOLO
//    representan boss_hp/boss_max_hp/geoarmy_hp/geoarmy_max_hp tal como
//    llegan. El resultado final (outcome) se lee tal cual, nunca se
//    infiere.
//  - Cataclismo es SOLO presentación: el countdown lee pending_resolves_at
//    y nunca resuelve el ataque ni cambia HP -- al llegar a 00:00 sigue
//    esperando el próximo public_state.
//  - No requiere user_id ni sesión/auth -- las 2 RPC son públicas.
//  - Modo demo (?demo=...) NUNCA llama Supabase ni escribe nada -- usa
//    exclusivamente datos mock locales, y vive solo en este archivo (no
//    toca HALLOWEEN_TEST_MODE ni ningún otro modo de prueba existente).
// =========================================================================
(function () {
  'use strict';

  if (window.__hswInit) return; // evita doble inicialización
  window.__hswInit = true;

  // -----------------------------------------------------------------
  // Utilidades (copias aisladas, mismo comportamiento que el resto del
  // proyecto para consistencia visual: coma como separador de miles,
  // signo −/+ explícito, etc.)
  // -----------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtNum(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtDelta(n) {
    n = Math.round(Number(n) || 0);
    var sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    return sign + fmtNum(Math.abs(n));
  }
  function pad2(n) { n = Math.max(0, Math.floor(n)); return n < 10 ? '0' + n : '' + n; }
  function clampNum(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // -----------------------------------------------------------------
  // Etiquetas narrativas -- copia aislada de las claves canon reales
  // (halloween_2026_action_defs), NUNCA inventadas. Mismos valores que
  // ACTION_KEY_LABEL/BOSS_ATTACK_LABEL/HEAL_ACTION_LABEL de
  // js/halloween-2026.js, pero esta es una copia propia e independiente.
  // -----------------------------------------------------------------
  var ACTION_KEY_LABEL = {
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
  var HEAL_ACTION_LABEL = {
    curacion_menor: 'Curación Menor',
    pulso_vital: 'Pulso Vital',
    bendicion_guardia: 'Bendición de la Guardia',
  };
  // effect_applied: el contrato REAL de halloween_2026_get_public_feed NO
  // devuelve effect_key -- se identifica EXCLUSIVAMENTE por action_key.
  // Labels pedidos explícitamente para este widget (mayúsculas, distintos
  // de BUFF_ACTION_LABEL de halloween-2026.js, que agrega "ACTIVADO").
  var EFFECT_ACTION_LABEL = {
    escudo_arcano: 'ESCUDO ARCANO',
    pocion_furia: 'POCIÓN DE FURIA',
    hechizo_vulnerabilidad: 'HECHIZO DE VULNERABILIDAD',
    ruptura_arcana: 'RUPTURA ARCANA',
  };

  // -----------------------------------------------------------------
  // 1) Cliente Supabase real -- reutiliza window.GeoArmyAccount.client
  //    (creado por js/geoarmy-account.js). Nunca se crea un cliente nuevo.
  //    En modo demo esta función jamás se llama.
  // -----------------------------------------------------------------
  var sbClient = null;

  function waitForClient(cb, triesLeft) {
    triesLeft = triesLeft == null ? 100 : triesLeft;
    if (window.GeoArmyAccount && window.GeoArmyAccount.client) { cb(window.GeoArmyAccount.client); return; }
    if (triesLeft <= 0) {
      console.error('[halloween-stream-widget] No se encontró window.GeoArmyAccount.client. ¿Se cargaron premium.js/geoarmy-config.js/geoarmy-ranks.js/geoarmy-account.js antes que este script?');
      setReconnect(true, 'state');
      setReconnect(true, 'feed');
      return;
    }
    setTimeout(function () { waitForClient(cb, triesLeft - 1); }, 100);
  }

  function callRpc(name, args) {
    var p = args ? sbClient.rpc(name, args) : sbClient.rpc(name);
    return Promise.resolve(p);
  }
  function loadState() {
    return callRpc('halloween_2026_get_public_state').then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }
  function loadFeed() {
    return callRpc('halloween_2026_get_public_feed', { p_limit: 30 }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  // -----------------------------------------------------------------
  // 2) Indicador discreto de reconexión -- si falla una llamada se
  //    mantiene el último estado bueno en pantalla (nunca se vacían las
  //    barras por un fallo temporal), y solo se muestra un ícono chico.
  // -----------------------------------------------------------------
  var reconnectBad = { state: false, feed: false };
  function setReconnect(bad, which) {
    reconnectBad[which] = bad;
    var el = $('hswReconnect');
    if (!el) return;
    el.hidden = !(reconnectBad.state || reconnectBad.feed);
  }

  // -----------------------------------------------------------------
  // 3) Render de estado -- SOLO representación, nunca cálculo.
  // -----------------------------------------------------------------
  var lastState = null;
  var prevBossPhase = null;
  var cataclysmTimerId = null;

  function applyPhase(state, root) {
    // La fase se lee tal cual de boss_phase, NUNCA se calcula por HP.
    var phase = state.boss_phase === 2 ? 2 : 1;
    if (root) root.setAttribute('data-phase', String(phase));
    var badge = $('hswPhaseBadge');
    if (badge) badge.textContent = phase === 2 ? 'FASE II' : 'FASE I';
    // Transición 1 -> 2 detectada entre dos polls de la misma sesión.
    if (prevBossPhase != null && prevBossPhase === 1 && phase === 2) {
      triggerPhaseFlash();
    }
    prevBossPhase = phase;
    return phase;
  }

  function triggerPhaseFlash() {
    var el = $('hswPhaseFlash');
    if (!el) return;
    el.hidden = false;
    el.classList.remove('is-active');
    void el.offsetWidth; // reflow, por si se dispara dos veces seguidas
    el.classList.add('is-active');
    setTimeout(function () { el.hidden = true; el.classList.remove('is-active'); }, 1800);
  }

  function flashOnce(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 600);
  }

  var prevBossHp = null, prevGeoHp = null;
  function renderBars(state) {
    var bossPct = state.boss_max_hp > 0 ? clampNum((state.boss_hp / state.boss_max_hp) * 100, 0, 100) : 0;
    var geoPct = state.geoarmy_max_hp > 0 ? clampNum((state.geoarmy_hp / state.geoarmy_max_hp) * 100, 0, 100) : 0;
    var bossFill = $('hswBossFill'), geoFill = $('hswGeoFill');
    if (bossFill) bossFill.style.width = bossPct + '%';
    if (geoFill) geoFill.style.width = geoPct + '%';
    var bossText = $('hswBossText'), geoText = $('hswGeoText');
    if (bossText) bossText.textContent = fmtNum(state.boss_hp) + ' / ' + fmtNum(state.boss_max_hp) + ' HP';
    if (geoText) geoText.textContent = fmtNum(state.geoarmy_hp) + ' / ' + fmtNum(state.geoarmy_max_hp) + ' HP';

    if (prevBossHp != null && bossFill) {
      if (state.boss_hp < prevBossHp) flashOnce(bossFill, 'hsw-flash-hit');
      else if (state.boss_hp > prevBossHp) flashOnce(bossFill, 'hsw-flash-heal');
    }
    if (prevGeoHp != null && geoFill) {
      if (state.geoarmy_hp < prevGeoHp) flashOnce(geoFill, 'hsw-flash-hit');
      else if (state.geoarmy_hp > prevGeoHp) flashOnce(geoFill, 'hsw-flash-heal');
    }
    prevBossHp = state.boss_hp;
    prevGeoHp = state.geoarmy_hp;
  }

  function setBottomLine(text, cls) {
    var box = $('hswBottomLine');
    if (!box) return;
    box.textContent = text;
    box.className = 'hsw-bottom-line' + (cls ? ' ' + cls : '');
    box.hidden = false;
  }

  function renderScheduled() {
    var root = $('hswRoot');
    if (root) root.setAttribute('data-state', 'scheduled');
    stopCataclysmTimer();
    // NO simula HP moviéndose: no se toca renderBars aquí a propósito.
  }

  function renderFinished(state) {
    var root = $('hswRoot');
    if (root) { root.setAttribute('data-state', 'finished'); applyPhase(state, root); }
    renderBars(state); // "Mantener HP finales visibles"
    stopCataclysmTimer();
    var title = $('hswFinishedTitle'), sub = $('hswFinishedSub');
    if (state.outcome === 'geoarmy_victory') {
      if (title) title.textContent = 'LA HERALDO HA CAÍDO';
      if (sub) sub.textContent = 'GEO ARMY SOBREVIVIÓ';
    } else if (state.outcome === 'herald_victory') {
      if (title) title.textContent = 'LA RESISTENCIA HA CAÍDO';
      if (sub) sub.textContent = 'LA HERALDO VENCIÓ';
    } else {
      // outcome desconocido/null -- nunca se inventa un resultado.
      if (title) title.textContent = 'BATALLA FINALIZADA';
      if (sub) sub.textContent = '';
    }
  }

  function renderBattle(state) {
    var root = $('hswRoot');
    if (root) root.setAttribute('data-state', 'battle');
    applyPhase(state, root);
    renderBars(state);
    renderCataclysm(state);
    processMoveQueue(); // por si Cataclismo acaba de terminar, reanuda la cola
  }

  // Dispatcher único a partir de public_state -- status/outcome se leen
  // tal cual, nunca se infiere ni se calcula.
  function applyState(state) {
    if (!state) return; // sin dato bueno -- se conserva lo que ya había en pantalla
    lastState = state;
    if (state.status === 'scheduled') { renderScheduled(); return; }
    if (state.status === 'finished') { renderFinished(state); return; }
    renderBattle(state); // 'active' o cualquier otro valor no final
  }

  // -----------------------------------------------------------------
  // 4) Cataclismo -- SOLO presentación. El countdown lee
  //    pending_resolves_at y jamás resuelve el ataque, cambia HP o
  //    asume que impactó. Al llegar a 00:00 sigue esperando el próximo
  //    public_state; al desaparecer pending_attack_key, vuelve sola al
  //    widget normal (siguiente poll ya no entra a esta rama).
  // -----------------------------------------------------------------
  function isCataclysmActive(state) {
    return !!(state && state.pending_attack_key === 'cataclismo' && state.pending_resolves_at);
  }
  function cataclysmActiveNow() { return isCataclysmActive(lastState); }

  function renderCataclysm(state) {
    var root = $('hswRoot');
    var active = isCataclysmActive(state);
    if (root) root.setAttribute('data-cataclysm', active ? '1' : '0');

    if (!active) { stopCataclysmTimer(); return; }

    var resolvesAt = new Date(state.pending_resolves_at).getTime();
    if (cataclysmTimerId) clearInterval(cataclysmTimerId);

    function tick() {
      var diff = Math.max(0, resolvesAt - Date.now());
      var totalSec = Math.floor(diff / 1000);
      var m = Math.floor(totalSec / 60), s = totalSec % 60;
      setBottomLine('⚠ CATACLISMO · ' + pad2(m) + ':' + pad2(s) + ' · PREPAREN LAS DEFENSAS', 'hsw-bottom-cataclysm');
      // Nunca se hace nada especial al llegar a 00:00 -- se sigue
      // esperando el próximo public_state, tal como pide la spec.
    }
    tick();
    cataclysmTimerId = setInterval(tick, 1000);
  }
  function stopCataclysmTimer() {
    if (cataclysmTimerId) { clearInterval(cataclysmTimerId); cataclysmTimerId = null; }
  }

  // -----------------------------------------------------------------
  // 5) Cola de movimientos -- reutiliza CONCEPTUALMENTE
  //    MOVE_SEEN_IDS/MOVE_QUEUE/isMovementEntry de js/halloween-2026.js,
  //    pero con su propia implementación aislada (no importa ni depende
  //    de ese archivo). Dedupe por log_id. Primera carga = baseline, sin
  //    animar historial. Nunca se superponen dos movimientos.
  //
  //    Movimientos relevantes: player_attack, boss_attack, boss_heal,
  //    heal, shield, mission_damage, y effect_applied SOLO si trae un
  //    action_key reconocido (nunca effect_key -- no existe en el feed
  //    real). Quedan fuera: role_selected, effect_consumed,
  //    event_started, boss_attack_announced, phase_change (transición
  //    propia vía boss_phase), victory/defeat (estados finales propios
  //    vía status/outcome).
  // -----------------------------------------------------------------
  var MOVE_SEEN_IDS = {};
  var MOVE_QUEUE = [];
  var MOVE_PLAYING = false;
  var MOVE_BASELINE_DONE = false;

  function isMovementEntry(it) {
    if (it.entry_type === 'effect_applied') {
      return !!(it.action_key && EFFECT_ACTION_LABEL[it.action_key]);
    }
    return it.entry_type === 'player_attack' || it.entry_type === 'boss_attack' ||
      it.entry_type === 'boss_heal' || it.entry_type === 'heal' ||
      it.entry_type === 'shield' || it.entry_type === 'mission_damage';
  }

  // Texto de una sola línea por movimiento -- mismo espíritu que
  // feedItemText() de js/halloween-2026.js, formato pedido explícitamente
  // para este widget ("Actor usó/recuperó Etiqueta · ΔHP").
  function movementText(item) {
    switch (item.entry_type) {
      case 'player_attack': {
        var who = item.actor_name || 'Un guerrero';
        var label = ACTION_KEY_LABEL[item.action_key] || 'un ataque';
        return esc(who) + ' usó ' + esc(label) + ' · ' + fmtDelta(item.boss_hp_delta) + ' HP';
      }
      case 'boss_attack': {
        var bLabel = BOSS_ATTACK_LABEL[item.boss_attack_key] || 'un ataque';
        return 'La Heraldo usó ' + esc(bLabel) + ' · ' + fmtDelta(item.geoarmy_hp_delta) + ' HP';
      }
      case 'boss_heal':
        return 'Morvanna recuperó ' + fmtDelta(item.boss_hp_delta) + ' HP';
      case 'heal':
        return 'Geo Army recuperó ' + fmtDelta(item.geoarmy_hp_delta) + ' HP';
      case 'shield':
        return 'Geo Army activó un escudo';
      case 'mission_damage':
        // Solo boss_hp_delta -- el feed público no expone el título del
        // contrato, así que no se inventa.
        return 'Contrato completado · ' + fmtDelta(item.boss_hp_delta) + ' HP';
      case 'effect_applied': {
        var fxLabel = item.action_key && EFFECT_ACTION_LABEL[item.action_key];
        // isMovementEntry() ya filtró los casos sin label reconocido, así
        // que si llegamos aquí siempre hay algo real que mostrar -- pero
        // se deja un fallback defensivo sin inventar cuál fue.
        return 'Geo Army activó ' + (fxLabel || 'EFECTO ACTIVADO');
      }
      default:
        return '';
    }
  }

  function movementClass(item) {
    return item.entry_type === 'mission_damage' ? 'hsw-bottom-mission' : 'hsw-bottom-move';
  }
  function movementDurationMs(item) {
    // Contrato completado: animación "ligeramente más importante", 2.5-3s.
    // El resto: rango 1.2-1.8s ya probado en Batalla.
    return item.entry_type === 'mission_damage' ? 2800 : 1700;
  }

  function playMovement(item, done) {
    setBottomLine(movementText(item), movementClass(item));
    setTimeout(done, movementDurationMs(item));
  }

  function processMoveQueue() {
    if (MOVE_PLAYING) return;
    if (cataclysmActiveNow()) return; // Cataclismo tiene prioridad visual
    var item = MOVE_QUEUE.shift();
    if (!item) return;
    MOVE_PLAYING = true;
    playMovement(item, function () {
      MOVE_PLAYING = false;
      processMoveQueue();
    });
  }

  // Orden cronológico real: created_at ascendente, log_id como desempate.
  function moveChronoSort(a, b) {
    var ta = new Date(a.created_at || 0).getTime();
    var tb = new Date(b.created_at || 0).getTime();
    if (ta !== tb) return ta - tb;
    return (a.log_id || 0) - (b.log_id || 0);
  }

  // Primera carga: registra baseline SIN animar. Después: solo log_id
  // nuevos, en orden cronológico, encolados si llegan varios entre polls.
  function processBattleFeed(feed) {
    if (feed == null) return; // error de carga -- se conserva lo último bueno
    var items = feed.slice().sort(moveChronoSort);

    if (!MOVE_BASELINE_DONE) {
      items.forEach(function (it) { MOVE_SEEN_IDS[it.log_id] = true; });
      MOVE_BASELINE_DONE = true;
      var lastRelevant = null;
      for (var i = items.length - 1; i >= 0; i--) {
        if (isMovementEntry(items[i])) { lastRelevant = items[i]; break; }
      }
      if (lastRelevant && !cataclysmActiveNow()) {
        setBottomLine(movementText(lastRelevant), movementClass(lastRelevant));
      }
      return;
    }

    items.forEach(function (it) {
      if (MOVE_SEEN_IDS[it.log_id]) return; // dedupe real por log_id
      MOVE_SEEN_IDS[it.log_id] = true;
      if (!isMovementEntry(it)) return;
      MOVE_QUEUE.push(it);
    });
    processMoveQueue();
  }

  // -----------------------------------------------------------------
  // 6) Polling -- un solo ciclo cada 5s (public_state + public_feed),
  //    sin setInterval superpuestos. Si una llamada falla, se conserva
  //    el último estado bueno (nunca se vacían las barras).
  // -----------------------------------------------------------------
  var pollTimer = null;

  function doPoll() {
    loadState().then(function (state) {
      setReconnect(false, 'state');
      applyState(state);
    }).catch(function (e) {
      console.warn('[halloween-stream-widget] fallo halloween_2026_get_public_state', e);
      setReconnect(true, 'state');
    });

    loadFeed().then(function (feed) {
      setReconnect(false, 'feed');
      processBattleFeed(feed);
    }).catch(function (e) {
      console.warn('[halloween-stream-widget] fallo halloween_2026_get_public_feed', e);
      setReconnect(true, 'feed');
    });
  }

  // -----------------------------------------------------------------
  // 7) Modo demo -- SOLO para probar OBS antes del evento. NUNCA llama
  //    Supabase, NUNCA escribe nada. Reutiliza el MISMO pipeline de
  //    render (applyState/renderBattle/renderFinished/renderCataclysm)
  //    que el modo real, así que lo que se ve en demo es fiel a lo que
  //    se vería en vivo -- solo cambia el origen del dato (mock local en
  //    vez de RPC).
  // -----------------------------------------------------------------
  var DEMO_BASE = {
    event_key: 'halloween_2026', boss_max_hp: 2000000, geoarmy_max_hp: 100000,
    starts_at: '2026-10-01T19:00:00-04:00', ends_at: '2026-11-01T00:00:00-04:00',
  };
  var DEMO_SCENARIOS = {
    active_p1: function () {
      return {
        state: Object.assign({}, DEMO_BASE, {
          status: 'active', outcome: null, boss_phase: 1,
          boss_hp: 1200000, geoarmy_hp: 45000,
          pending_attack_key: null, pending_resolves_at: null,
        }),
        lastMove: { entry_type: 'player_attack', actor_name: 'Geovannyrk', action_key: 'golpe_abismo', boss_hp_delta: -3000, geoarmy_hp_delta: 0 },
      };
    },
    active_p2: function () {
      return {
        state: Object.assign({}, DEMO_BASE, {
          status: 'active', outcome: null, boss_phase: 2,
          boss_hp: 640000, geoarmy_hp: 38000,
          pending_attack_key: null, pending_resolves_at: null,
        }),
        lastMove: { entry_type: 'boss_attack', boss_attack_key: 'fuego_infernal', boss_hp_delta: 0, geoarmy_hp_delta: -9000 },
      };
    },
    cataclismo: function () {
      return {
        state: Object.assign({}, DEMO_BASE, {
          status: 'active', outcome: null, boss_phase: 2,
          boss_hp: 610000, geoarmy_hp: 21000,
          pending_attack_key: 'cataclismo',
          pending_resolves_at: new Date(Date.now() + 17000).toISOString(),
        }),
        lastMove: null,
      };
    },
    geoarmy_victory: function () {
      return {
        state: Object.assign({}, DEMO_BASE, {
          status: 'finished', outcome: 'geoarmy_victory', boss_phase: 2,
          boss_hp: 0, geoarmy_hp: 52000,
          pending_attack_key: null, pending_resolves_at: null,
        }),
        lastMove: null,
      };
    },
    herald_victory: function () {
      return {
        state: Object.assign({}, DEMO_BASE, {
          status: 'finished', outcome: 'herald_victory', boss_phase: 2,
          boss_hp: 610000, geoarmy_hp: 0,
          pending_attack_key: null, pending_resolves_at: null,
        }),
        lastMove: null,
      };
    },
  };

  function getDemoParam() {
    var m = /(?:^|[?&])demo=([^&]+)/.exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function initDemo(key) {
    var build = DEMO_SCENARIOS[key];
    if (!build) {
      console.warn('[halloween-stream-widget] ?demo desconocido: "' + key + '" -- usando active_p1. Valores válidos: ' + Object.keys(DEMO_SCENARIOS).join(', '));
      build = DEMO_SCENARIOS.active_p1;
    }
    var tag = $('hswDemoTag');
    if (tag) tag.hidden = false;

    var data = build();
    applyState(data.state); // mismo pipeline que el modo real, dato mock
    if (data.lastMove && !cataclysmActiveNow()) {
      setBottomLine(movementText(data.lastMove), movementClass(data.lastMove));
    }
    // Sin setInterval, sin fetch, sin sbClient -- el único timer que puede
    // quedar corriendo es el countdown de Cataclismo (renderCataclysm, ya
    // disparado por applyState/renderBattle arriba), que es matemática
    // pura sobre Date.now(), nunca una llamada de red.
  }

  // -----------------------------------------------------------------
  // 8) Arranque
  // -----------------------------------------------------------------
  function init() {
    var demo = getDemoParam();
    if (demo) { initDemo(demo); return; }

    waitForClient(function (client) {
      sbClient = client;
      doPoll();
      pollTimer = setInterval(doPoll, 5000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
