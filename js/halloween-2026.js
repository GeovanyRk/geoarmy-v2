// =====================================================================
// HALLOWEEN 2026 — "La Heraldo" — sistema de batalla comunitaria
// =====================================================================
// Archivo NUEVO y aislado. Se carga SOLAMENTE desde las páginas dedicadas
// halloween/batalla.html, rol.html, contratos.html (producción), y
// también desde halloween/efectos.html/cronicas.html (huérfanas, sin
// enlace público, ver PASADA FINAL TEST -> PRODUCCIÓN más abajo).
// index.html/index-halloween-test.html NO lo cargan: los 3 pins sobre el
// planeta son <a href> simples, con el estado bloqueado/desbloqueado
// resuelto en puro CSS (ver css/halloween-2026.css, sección "Pins sobre
// el planeta").
//
// CAMBIO DE DIRECCIÓN (v2): se retiró el dashboard de 4 tarjetas + modal
// genérico. Ahora este archivo actúa como un pequeño "router": lee
// document.body.dataset.halloweenPage ("battle" | "role" | "missions" |
// "effects" | "feed") y solo inicializa/pollea lo que esa página
// necesita. La lógica de cada sección (antes los "openXModal") se
// conserva casi intacta, solo que ahora escribe directamente en un
// contenedor de la página en vez de abrir un modal.
//
// PASADA FINAL TEST -> PRODUCCIÓN (2026-09-26): se retiró por completo el
// sistema exclusivo de desarrollo (la bandera de modo prueba, el atributo
// data-testmode, el selector de escenarios, la barra de desarrollo, y
// todas las funciones de simulación). callRpc() ahora llama SIEMPRE la
// RPC real -- este archivo ya no simula nada.
//
// Reglas de seguridad que este archivo respeta siempre:
//  - NO usa service_role, solo el cliente anon ya existente
//    (window.GeoArmyAccount.client, creado en js/geoarmy-account.js).
//  - NO consulta tablas halloween_2026_* directamente: únicamente llama
//    las RPCs públicas ya construidas en Supabase.
//  - NO calcula combate/daño/HP en el navegador. Solo representa lo que
//    devuelven las RPCs.
//  - NO resuelve Cataclismo, NO envía user_id manualmente a choose_role.
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
  // sub acepta un string (una sola línea, comportamiento de siempre) o un
  // array de strings (varias líneas de ambientación, cada una escapada por
  // separado) -- Contratos usa 2 líneas en su estado vacío; el resto de
  // páginas sigue pasando un string y no cambia nada.
  function emptyStateHtml(icon, title, sub) {
    var subLines = Array.isArray(sub) ? sub : (sub ? [sub] : []);
    return '<div class="hw26-empty-state">' +
      '<div class="hw26-empty-icon">' + icon + '</div>' +
      '<div class="hw26-empty-title">' + esc(title) + '</div>' +
      subLines.map(function (line) { return '<div class="hw26-empty-sub">' + esc(line) + '</div>'; }).join('') +
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

  // ---------------------------------------------------------------------
  // 0) Router — qué página es esta.
  //    <body data-halloween-page="battle|role|missions|effects|feed">
  // ---------------------------------------------------------------------
  var PAGE = document.body.getAttribute('data-halloween-page') || '';

  // PASADA FINAL TEST -> PRODUCCIÓN (2026-09-26): se retiró por completo el
  // sistema exclusivo de desarrollo (la bandera de modo prueba, el
  // selector de escenario, la comprobación de rol simulada, las claves de
  // localStorage de prueba, y todas las funciones de simulación que
  // vivían aquí -- estado, participación, efectos, feed y misiones
  // simulados, y el resultado de RPC simulado). callRpc() ahora llama
  // SIEMPRE la RPC real (ver sección 2). Ningún dato de este archivo se
  // inventa más:
  // toda la lógica productiva (loadState, loadParticipation, chooseRole,
  // loadMissions, loadFeed, processBattleFeed, feedItemText, la cola de
  // movimientos, transición de fase, Cataclismo, render de Batalla/Rol/
  // Contratos, polling real) sigue intacta debajo.
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

  // Envoltorio único para llamar RPCs: SIEMPRE llama la RPC pública real,
  // nunca consulta tablas halloween_2026_* directamente. (El modo mock que
  // existía aquí se retiró por completo en la pasada final test ->
  // producción -- ver comentario de la sección 0.)
  function callRpc(client, name, args) {
    var p = args ? client.rpc(name, args) : client.rpc(name);
    return Promise.resolve(p);
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
  //     ni curación, NUNCA decide si algo ocurrió. NUNCA toca
  //     boss_hp/geoarmy_hp localmente -- eso lo fija exclusivamente
  //     renderBoss(lastState) con halloween_2026_get_public_state(), en
  //     cada poll.
  //
  //     Contrato REAL verificado de halloween_2026_get_public_feed(30):
  //     log_id, entry_type, actor_name, actor_role, action_key,
  //     boss_attack_key, boss_hp_delta, geoarmy_hp_delta,
  //     multiplier_applied, boss_hp_after, geoarmy_hp_after, phase_after,
  //     created_at. NO devuelve effect_key -- este bloque no lo usa en
  //     ningún lado, ni siquiera para 'effect_applied' (ver más abajo).
  //     Los buffs/escudos/curaciones/efectos se identifican con action_key
  //     (tabla halloween_2026_action_defs: aranazo_maldito,
  //     bendicion_guardia, curacion_menor, escudo_arcano, golpe_abismo,
  //     hechizo_vulnerabilidad, pocion_furia, pulso_vital, ritual_sangre,
  //     ruptura_arcana), nunca con un effect_key inexistente.
  //
  //     entry_type reales confirmados en halloween_2026_battle_log:
  //     boss_attack, boss_attack_announced, boss_heal, defeat,
  //     effect_applied, effect_consumed, heal, mission_damage,
  //     phase_change, player_attack, role_selected, shield, victory.
  //
  //     Dedupe: por log_id (el identificador estable real del log), nunca
  //     por nombre/daño/timestamp -- dos jugadores pueden generar el mismo
  //     ataque legítimamente.
  // ---------------------------------------------------------------------
  var MOVE_SEEN_IDS = {};      // log_id ya vistos esta sesión (dedupe real)
  var MOVE_QUEUE = [];         // logs nuevos pendientes de animar, en orden
  var MOVE_PLAYING = false;    // nunca se superponen dos movimientos
  var MOVE_BASELINE_DONE = false; // primera carga: registrar sin animar

  // entry_type que SÍ representa la cola como movimiento (lista confirmada
  // contra halloween_2026_battle_log real): player_attack, boss_attack,
  // boss_heal, heal, shield, mission_damage, y effect_applied SOLO cuando
  // trae un action_key reconocido (hechizo_vulnerabilidad / pocion_furia /
  // ruptura_arcana -- ver BUFF_ACTION_LABEL). Si effect_applied llega con
  // action_key null, se omite por completo (no se inventa qué efecto fue,
  // y un genérico "EFECTO APLICADO" no aporta información útil).
  //
  // Quedan fuera: boss_attack_announced (solo el aviso de Cataclismo, que
  // ya tiene su propia presentación vía pending_attack_key/countdown),
  // effect_consumed (demasiado granular, generaría ruido visual),
  // phase_change (ya tiene su propia transición "EL SELLO SE HA ROTO"),
  // role_selected (no es de combate), victory/defeat (los estados finales
  // de Batalla ya tienen presentación propia) y event_started.
  function isMovementEntry(it) {
    if (it.entry_type === 'effect_applied') {
      return !!(it.action_key && BUFF_ACTION_LABEL[it.action_key]);
    }
    return it.entry_type === 'player_attack' || it.entry_type === 'boss_attack' ||
      it.entry_type === 'boss_heal' || it.entry_type === 'heal' ||
      it.entry_type === 'shield' || it.entry_type === 'mission_damage';
  }

  function fmtDelta(n) {
    n = Math.round(Number(n) || 0);
    var sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    return sign + fmtNum(Math.abs(n));
  }
  function clampNum(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

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

  // (El sistema de HP simulado que existía aquí -- variable de HP de
  // prueba y sus funciones de activación/reconciliación/aplicación de
  // deltas -- se retiró por completo en la pasada final test -> producción.
  // El HP mostrado ahora es siempre el autoritativo de lastState, tal como
  // llega de halloween_2026_get_public_state().)

  // Geo Army ataca a Morvanna -- zona derecha (sobre la imagen), flash
  // blanco/violeta breve, micro shake SOLO de la imagen. golpe_abismo es
  // la única clave real (se eliminó el alias golpe_del_abismo).
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
  // marca_bruja/herida_profana son ataques normales de fase -- se animan
  // igual que cualquier otro golpe de Morvanna, con su daño real.
  // drenaje_alma/drenaje_demoniaco TAMBIÉN
  // pasan por aquí igual que cualquier boss_attack -- la curación de
  // Morvanna que generan llega como un log 'boss_heal' aparte (ver
  // playBossHeal()), nunca combinada en este mismo paso. Cataclismo, si
  // llega aquí como boss_attack normal (resolución real, no el aviso),
  // usa exactamente el mismo camino -- solo se anima el resultado, nunca
  // el anuncio de preparación (eso lo filtra isMovementEntry() al excluir
  // boss_attack_announced).
  function playGeoHit(item, done) {
    var label = BOSS_ATTACK_LABEL[item.boss_attack_key] || (item.boss_attack_key || 'ATAQUE').toUpperCase();
    spawnMovePop($('hw26MoveGeo'), label, fmtDelta(item.geoarmy_hp_delta) + ' RESISTENCIA', '', MOVE_DURATION_MS);
    shakeEl($('hw26GeoBarBlock'), 500);
    if ($('hw26GeoHpFill')) flashOnce($('hw26GeoHpFill'), 'hw26-flash-hit');
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Curación -- pulso dorado/verde sobre la barra Geo Army, con el valor
  // REAL de geoarmy_hp_delta (nunca hardcodeado). Si el log trae
  // action_key (curacion_menor/pulso_vital/bendicion_guardia) se usa ese
  // nombre; si llega null, se muestra "Curación" genérico sin inventar
  // cuál fue.
  function playHeal(item, done) {
    var label = HEAL_ACTION_LABEL[item.action_key] || 'Curación';
    spawnMovePop($('hw26MoveGeo'), label, fmtDelta(item.geoarmy_hp_delta) + ' RESISTENCIA', 'hw26-move-pop-heal', MOVE_DURATION_MS);
    if ($('hw26GeoHpFill')) flashOnce($('hw26GeoHpFill'), 'hw26-flash-heal');
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Escudo/buff/efecto (entry_type:'shield' o 'effect_applied' con
  // action_key reconocido) -- identificado por action_key
  // (escudo_arcano/pocion_furia/hechizo_vulnerabilidad/ruptura_arcana),
  // NUNCA por effect_key (no existe en el feed). isMovementEntry() ya
  // filtró los effect_applied sin action_key conocido, así que si esta
  // función se llama, siempre hay algo real que mostrar (el fallback
  // "ESCUDO ACTIVADO" queda solo para shield sin action_key, caso
  // defensivo). Solo animación, sin tocar HP (ni real ni mock).
  function playBuff(item, done) {
    var title = item.action_key && BUFF_ACTION_LABEL[item.action_key];
    spawnMovePop($('hw26MoveGeo'), title || 'ESCUDO ACTIVADO', title ? '' : 'Geo Army se protegió', 'hw26-move-pop-buff', MOVE_DURATION_MS);
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Curación de Morvanna (entry_type: 'boss_heal') -- log INDEPENDIENTE y
  // real, nunca fabricado a partir de un boss_attack de drenaje: los logs
  // reales confirman que drenaje_alma/drenaje_demoniaco llegan como dos
  // filas separadas (un boss_attack con geoarmy_hp_delta y, aparte, un
  // boss_heal con boss_hp_delta), cada una con su propio log_id y
  // created_at -- el orden cronológico de MOVE_QUEUE ya hace que se vean
  // uno detrás del otro sin necesidad de combinarlos aquí. Si trae
  // boss_attack_key de un drenaje conocido usa ese nombre; si no, mensaje
  // genérico. Valor SIEMPRE de boss_hp_delta.
  function playBossHeal(item, done) {
    var label = (item.boss_attack_key && BOSS_ATTACK_LABEL[item.boss_attack_key]) || 'MORVANNA SE CURA';
    spawnMovePop($('hw26MoveBoss'), label, fmtDelta(item.boss_hp_delta) + ' HP MORVANNA', 'hw26-move-pop-heal', MOVE_DURATION_MS);
    if ($('hw26BossHpFill')) flashOnce($('hw26BossHpFill'), 'hw26-flash-heal');
    setTimeout(done, MOVE_DURATION_MS);
  }

  // Contrato completado (entry_type: 'mission_damage') -- golpea a
  // Morvanna igual que un ataque de Geo Army (misma zona/flash/shake),
  // pero con identidad visual propia (ver .hw26-move-pop-mission en el
  // CSS) para distinguirlo de un golpe directo de jugador. Usa
  // EXCLUSIVAMENTE boss_hp_delta -- el feed todavía no expone el título
  // del contrato, así que no se inventa.
  function playMissionDamage(item, done) {
    spawnMovePop($('hw26MoveBoss'), 'CONTRATO COMPLETADO', fmtDelta(item.boss_hp_delta) + ' HP', 'hw26-move-pop-mission', MOVE_DURATION_MS);
    shakeEl($('hw26BossImg'), 500);
    flashHitOverlay();
    if ($('hw26BossHpFill')) flashOnce($('hw26BossHpFill'), 'hw26-flash-hit');
    setTimeout(done, MOVE_DURATION_MS);
  }

  function playMovement(item, done) {
    switch (item.entry_type) {
      case 'player_attack': return playBossHit(item, done);
      case 'boss_attack': return playGeoHit(item, done);
      case 'boss_heal': return playBossHeal(item, done);
      case 'heal': return playHeal(item, done);
      case 'shield': return playBuff(item, done);
      case 'effect_applied': return playBuff(item, done);
      case 'mission_damage': return playMissionDamage(item, done);
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

  // Orden cronológico real: created_at ascendente, log_id ascendente como
  // desempate -- así el más viejo siempre se anima primero aunque la RPC
  // devuelva los logs más nuevos primero (orden típico de un feed).
  function moveChronoSort(a, b) {
    var ta = new Date(a.created_at || 0).getTime();
    var tb = new Date(b.created_at || 0).getTime();
    if (ta !== tb) return ta - tb;
    return (a.log_id || 0) - (b.log_id || 0);
  }

  // Detecta logs nuevos del feed ya cargado (loadFeed(), mismo poll de
  // Batalla) y los mete en la cola, en orden cronológico. En la primera
  // carga de la página NUNCA anima el historial: solo registra los
  // log_id como ya vistos y muestra el último movimiento como texto --
  // desde ahí, solo los logs que aparezcan DESPUÉS entran a la cola.
  function processBattleFeed() {
    if (lastFeed == null) return; // error de carga -- nada que procesar
    var items = lastFeed.slice().sort(moveChronoSort);

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

  function initBattlePage() {
    loadState().then(function () { if (lastState) renderBoss(lastState); });
    // Simplificación de producto (2026-09-26): se quitó la llamada a
    // loadEffects().then(renderBattleEffects) -- la sección de efectos
    // dentro de batalla.html ya había sido eliminada antes (el elemento
    // #hw26SupportEffectsBody que renderBattleEffects() buscaba ya no
    // existe en el DOM), así que ese fetch a
    // halloween_2026_get_public_effects() era una llamada a Supabase cada
    // 5s sin ningún consumidor real. loadEffects()/renderBattleEffects()
    // NO se tocan: initEffectsPage() (halloween/efectos.html, huérfana
    // pero no borrada) sigue usándolas tal cual.
    // Mismo ciclo de poll que ya tenía Batalla (5s, ver POLL_INTERVAL_MS
    // más abajo) -- sin setInterval nuevo.
    loadFeed().then(processBattleFeed);
  }

  // ---------------------------------------------------------------------
  // 6) PÁGINA "role" (halloween/rol.html)
  // ---------------------------------------------------------------------
  var ROLE_META = {
    attacker: { icon: '⚔', name: 'ATACANTE', desc: 'Golpea a La Heraldo y participa en la ofensiva.' },
    support: { icon: '✚', name: 'SOPORTE', desc: 'Cura a Geo Army y mantén al ejército con vida.' },
    defender: { icon: '🛡', name: 'DEFENSOR', desc: 'Protege a Geo Army y reduce el daño de los ataques enemigos.' },
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
      '<span class="hw26-role-desc">' + esc(meta.desc) + '</span>' +
      '<span class="hw26-role-permanent">Tu rol es permanente durante Halloween 2026.</span></span>' +
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
        '<div class="hw26-role-state-label">TU ROL</div>' +
        '<div class="hw26-role-current hw26-role-current-big">' +
          '<span class="hw26-role-icon">' + meta.icon + '</span>' +
          '<div><div class="hw26-role-name">' + esc(meta.name) + '</div>' +
          '<div class="hw26-role-desc">' + esc(meta.desc) + '</div>' +
          '<div class="hw26-role-desc" style="margin-top:6px;">Tu elección ya está registrada y permanecerá activa durante Halloween 2026.</div></div>' +
        '</div>';
      return;
    }

    if (!lastParticipation || !lastParticipation.can_choose_role) {
      box.innerHTML = genericErrorHtml('La elección de rol no está disponible en este momento.');
      return;
    }

    var selected = null;
    var html =
      '<div class="hw26-role-intro">' +
        '<div class="hw26-role-intro-title">ELIGE TU ROL</div>' +
        '<div class="hw26-role-intro-text">Tu elección será permanente durante todo Halloween 2026.</div>' +
        '<div class="hw26-role-intro-warning">' +
          '<span class="hw26-role-intro-warning-icon">⚠️</span>' +
          '<span>IMPORTANTE: solo puedes usar las recompensas de Twitch correspondientes a tu rol. Si canjeas una recompensa de otro rol, la acción no contará y el canje será rechazado.</span>' +
        '</div>' +
      '</div>' +
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

      sbClient.rpc('halloween_2026_choose_role', { p_event_key: EVENT_KEY, p_role: selected })
      .then(function (res) {
        if (res.error) throw res.error;
        // No optimistic update permanente: se vuelve a consultar
        // participación real antes de reflejar el cambio.
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
  // Contrato REAL verificado de halloween_2026_get_public_missions():
  // mission_id, mission_key, category, title, description, mission_day,
  // opens_at, closes_at, availability ('upcoming'|'active'|'ended'),
  // is_final_battle, boss_damage, verification_mode, sort_order.
  // mission_id/mission_key/verification_mode son detalles técnicos --
  // NUNCA se muestran al usuario. No hay botones de "Completar"/"Enviar
  // evidencia"/"Subir"/"Aprobar": la verificación es server-side/oficial,
  // esta página es SOLO lectura. Cuando el backend confirme un contrato
  // (mission completion -> mission_damage), Batalla ya sabe representar
  // ese entry_type en su cola de movimientos -- esta página no necesita
  // ningún cambio para eso, solo muestra el catálogo de contratos.
  var MISSION_CATEGORY_LABEL = { fortnite: 'FORTNITE', overwatch: 'OVERWATCH', stream: 'STREAM' };
  var MISSION_STATUS_LABEL = { upcoming: 'PRÓXIMAMENTE', active: 'CONTRATO ACTIVO', ended: 'FINALIZADO' };
  var MISSION_WEEKDAY_ES = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  var MISSION_MONTH_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  // "2026-10-06" -> "MARTES 6 DE OCTUBRE" -- título del grupo del día.
  // Mediodía fijo al parsear para no correrse de día por zona horaria
  // (mission_day es una fecha del calendario, no un instante). Si el
  // formato no es el esperado, se muestra el valor tal cual (sin inventar).
  function missionDayLabel(dayStr) {
    if (!dayStr) return 'FECHA POR CONFIRMAR';
    var d = new Date(dayStr + 'T12:00:00');
    if (isNaN(d.getTime())) return esc(dayStr);
    return MISSION_WEEKDAY_ES[d.getDay()] + ' ' + d.getDate() + ' DE ' + MISSION_MONTH_ES[d.getMonth()];
  }

  // Fecha+hora corta legible a partir de un timestamp real
  // (opens_at/closes_at) -- nunca inventa una hora si el dato no llega.
  function missionShortDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var datePart = '', timePart = '';
    try { datePart = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }); } catch (e) {}
    try { timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); } catch (e) {}
    return (datePart + (timePart ? ' · ' + timePart : '')).toUpperCase();
  }

  // Ventana mostrada según el estado real: upcoming -> cuándo abre
  // (opens_at), active -> hasta cuándo sigue abierto (closes_at), ended ->
  // cuándo cerró (closes_at). Nunca calcula ni inventa una fecha que no
  // venga del backend.
  function missionWindowText(m) {
    if (m.availability === 'upcoming') {
      var opens = missionShortDateTime(m.opens_at);
      return opens ? ('ABRE ' + opens) : 'PRÓXIMAMENTE';
    }
    if (m.availability === 'ended') {
      var closed = missionShortDateTime(m.closes_at);
      return closed ? ('CERRÓ ' + closed) : 'FINALIZADO';
    }
    var closes = missionShortDateTime(m.closes_at);
    return closes ? ('HASTA ' + closes) : 'CONTRATO ACTIVO';
  }

  function missionDamageText(dmg) {
    return '−' + fmtNum(dmg) + ' HP A LA HERALDO';
  }

  // Orden pedido: mission_day asc, luego sort_order asc, luego opens_at
  // asc -- así el agrupado por día queda cronológico incluso si el backend
  // no devuelve los contratos ya ordenados.
  function missionSort(a, b) {
    var da = a.mission_day || '', db = b.mission_day || '';
    if (da !== db) return da < db ? -1 : 1;
    var sa = a.sort_order || 0, sb = b.sort_order || 0;
    if (sa !== sb) return sa - sb;
    var oa = a.opens_at || '', ob = b.opens_at || '';
    if (oa !== ob) return oa < ob ? -1 : 1;
    return 0;
  }

  function missionCardHtml(m) {
    var isFinal = m.is_final_battle === true;
    var catLabel = MISSION_CATEGORY_LABEL[m.category] || String(m.category || '').toUpperCase();
    var statusLabel = MISSION_STATUS_LABEL[m.availability] || String(m.availability || '').toUpperCase();
    return '<div class="hw26-mission-card' + (isFinal ? ' hw26-mission-card-final' : '') + '" data-status="' + esc(m.availability) + '" data-category="' + esc(m.category || '') + '">' +
      (isFinal ? '<div class="hw26-mission-final-tag">⚔ CONTRATO FINAL</div>' : '') +
      '<div class="hw26-mission-cat">' + esc(catLabel) + '</div>' +
      '<div class="hw26-mission-top">' +
        '<div class="hw26-mission-title">' + esc(m.title) + '</div>' +
        '<span class="hw26-mission-badge ' + esc(m.availability) + '">' + esc(statusLabel) + '</span>' +
      '</div>' +
      '<div class="hw26-mission-desc">' + esc(m.description || '') + '</div>' +
      '<div class="hw26-mission-meta">' +
        '<span class="hw26-mission-dmg">' + missionDamageText(m.boss_damage) + '</span>' +
        '<span class="hw26-mission-window">' + esc(missionWindowText(m)) + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderMissionsPage() {
    var box = $('hw26MissionsContent');
    if (!box) return;
    if (lastMissions == null) { box.innerHTML = genericErrorHtml('Contratos temporalmente no disponibles.'); return; }
    // Estado vacío real (nunca contratos falsos aquí -- si la RPC real
    // devuelve [], esto es exactamente lo que se muestra).
    if (!lastMissions.length) {
      box.innerHTML = emptyStateHtml('📜', 'SIN CONTRATOS DISPONIBLES', [
        'Morvanna guarda silencio... por ahora.',
        'Los contratos aparecen martes, jueves y sábados.',
      ]);
      return;
    }

    // Agrupado por mission_day, en el mismo orden cronológico del sort
    // (mission_day -> sort_order -> opens_at) -- ya no se agrupa por
    // categoría, la categoría ahora se distingue por card (ver CSS
    // data-category).
    var sorted = lastMissions.slice().sort(missionSort);
    var days = [];
    var byDay = {};
    sorted.forEach(function (m) {
      var key = m.mission_day || '';
      if (!byDay[key]) { byDay[key] = { day: key, items: [] }; days.push(byDay[key]); }
      byDay[key].items.push(m);
    });

    var html = days.map(function (group) {
      return '<div class="hw26-mission-day-group">' +
        '<div class="hw26-mission-day-title">' + esc(missionDayLabel(group.day)) + '</div>' +
        '<div class="hw26-mission-day-grid">' +
          group.items.map(missionCardHtml).join('') +
        '</div>' +
      '</div>';
    }).join('');

    box.innerHTML = html;
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
    // "vulnerabilidad" es el efecto interno real (confirmado en Supabase);
    // la acción que lo produce es "hechizo_vulnerabilidad", pero esa es una
    // action_key de halloween_2026_action_defs, no una effect_key -- por
    // eso NO vive aquí como alias. Esta página de Efectos sigue mostrando
    // "vulnerabilidad" tal cual, sin tocar nada más.
    ruptura_arcana: { icon: '📜', name: 'RUPTURA ARCANA', desc: 'Multiplica el daño del próximo Contrato completado.' },
    marca_bruja: { icon: '🩸', name: 'MARCA DE LA BRUJA', desc: 'Reduce el daño del próximo ataque de Geo Army.' },
    herida_profana: { icon: '💀', name: 'HERIDA PROFANA', desc: 'Reduce la próxima curación de Geo Army.' },
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
  // Batalla (misma fuente única, ver playBossHit/playGeoHit/playBossHeal) --
  // solo texto de presentación, no cambian ni calculan nada del combate.
  // Claves canon confirmadas en halloween_2026_action_defs -- alias
  // "golpe_del_abismo" eliminado, la única clave real es "golpe_abismo".
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
  // Curaciones -- el feed real solo expone entry_type:'heal' con el delta,
  // SIN un campo que diga cuál de las 3 curaciones canon fue (no hay
  // action_key poblado en los logs de heal vistos hasta ahora). Si el
  // backend real sí manda item.action_key en estos logs, se usa aquí; si
  // no, se cae a un nombre genérico -- ver playHeal().
  var HEAL_ACTION_LABEL = {
    curacion_menor: 'Curación Menor',
    pulso_vital: 'Pulso Vital',
    bendicion_guardia: 'Bendición de la Guardia',
  };
  // Buffs/escudos -- entry_type:'shield' en el feed real trae action_key
  // (confirmado en halloween_2026_action_defs); si llega null o una clave
  // no reconocida, playBuff() cae a un mensaje genérico. marca_bruja y
  // herida_profana ya NO tienen anuncio de debuff aparte: son simplemente
  // ataques de La Heraldo como cualquier otro, así que no necesitan
  // entrada aquí.
  var BUFF_ACTION_LABEL = {
    escudo_arcano: 'ESCUDO ARCANO ACTIVADO',
    pocion_furia: 'POCIÓN DE FURIA',
    hechizo_vulnerabilidad: 'HECHIZO DE VULNERABILIDAD',
    ruptura_arcana: 'RUPTURA ARCANA',
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
        // HOTFIX (2026-09-26): el contrato REAL de halloween_2026_get_public_feed
        // NO devuelve effect_key (ver nota en la sección 5b más abajo) -- este
        // caso dependía de un campo que nunca llega, así que 'effect_applied'
        // caía siempre al genérico. Se identifica igual que en isMovementEntry()/
        // playBuff(): por item.action_key contra BUFF_ACTION_LABEL.
        if (item.action_key && BUFF_ACTION_LABEL[item.action_key]) {
          return 'Geo Army activó <b>' + esc(titleCaseEs(BUFF_ACTION_LABEL[item.action_key])) + '</b>.';
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
  // 10) Router de inicialización por página
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
    function afterClient(client) {
      sbClient = client;
      if (client && client.auth && client.auth.onAuthStateChange) {
        client.auth.onAuthStateChange(function () {
          if (PAGE === 'role') { loadParticipation().then(renderRolePage); }
        });
      }
      if (didInitialLoad) return;
      didInitialLoad = true;
      runPageInit();
      startPolling();
    }

    waitForClient(afterClient);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
