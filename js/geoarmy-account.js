 // ===== MI GEO ARMY — cuentas con Supabase Auth + Twitch (Fase 1) =====
// Este archivo es independiente de main.js/premium.js — no los toca.
// Requiere, en el <head> o antes de este script:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
// Y en el header de la página, donde se quiera mostrar el botón/estado de cuenta:
//   <div id="geoAccountWidget"></div>
(function () {
  'use strict';
 
  // ====== Config real de Supabase: ver js/geoarmy-config.js ======
  // (un solo lugar para pegar SUPABASE_URL / SUPABASE_ANON_KEY; este archivo
  // debe cargarse ANTES que este script en cada página)
  const SUPABASE_URL = window.GEOARMY_SUPABASE_URL || 'https://TU-PROYECTO.supabase.co';
  const SUPABASE_ANON_KEY = window.GEOARMY_SUPABASE_ANON_KEY || 'TU-ANON-KEY-PUBLICA';
  // Mismo backend que ya usa tienda.html para el saldo real de G-Coins.
  const TIENDA_API_BASE = 'https://geoarmy.duckdns.org';
  const RETURN_TO_KEY = 'geoarmy_return_to_v1';
  // =======================================================================
 
  if (!window.supabase || !window.supabase.createClient) {
    console.warn('[geoarmy-account] Falta cargar supabase-js antes de este script.');
    return;
  }
  if (SUPABASE_URL.indexOf('TU-PROYECTO') !== -1) {
    console.warn('[geoarmy-account] Falta configurar SUPABASE_URL / SUPABASE_ANON_KEY en js/geoarmy-config.js');
  }
 
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
 
  // Carpeta base del sitio/beta (con barra final), ej. "/" en producción o
  // "/geoarmy-v2/" en esta beta.
  //
  // Se toma de window.GEOARMY_SITE_BASE, declarado explícitamente en
  // js/geoarmy-config.js — NO se adivina a partir de window.location.pathname.
  // Motivo: algunos hosts (Cloudflare/GitHub Pages sirviendo un subdirectorio)
  // normalizan/quitan la barra final de una URL de carpeta (ej.
  // "/geoarmy-v2/auth/callback/" puede llegar como "/geoarmy-v2/auth/callback"
  // sin barra), lo que hacía que adivinar la base a partir del pathname fuera
  // poco confiable y mandara al usuario a la raíz de producción. Con un valor
  // explícito por despliegue, esto queda resuelto sin depender de cómo cada
  // host maneje esa barra.
  function siteBase() {
    if (window.GEOARMY_SITE_BASE) return window.GEOARMY_SITE_BASE;
    console.warn('[geoarmy-account] Falta GEOARMY_SITE_BASE en js/geoarmy-config.js — usando "/" por defecto.');
    return '/';
  }
 
  // Guarda a dónde volver después del login (la página actual) y manda al
  // usuario a Twitch. auth/callback/index.html retoma esta ruta guardada
  // una vez Supabase confirma la sesión.
  async function signInWithTwitch(returnTo) {
    try {
      sessionStorage.setItem(RETURN_TO_KEY, returnTo || (window.location.pathname + window.location.hash));
    } catch (e) {}
    await sb.auth.signInWithOAuth({
      provider: 'twitch',
      // Debe registrarse en Supabase Auth -> URL Configuration -> Redirect
      // URLs EXACTAMENTE con esta barra final (ej. .../geoarmy-v2/auth/callback/).
      options: {
        redirectTo: window.location.origin + siteBase() + 'auth/callback/',
        scopes: 'user:read:email'
      },
    });
  }
 
  // Otras páginas (ej. mi-geoarmy.html) reusan esta misma instancia/sesión.
  window.GeoArmyAccount = {
    client: sb,
    openLogin: openLoginModal,
    refreshWidget: render,
    signInWithTwitch: signInWithTwitch,
    // Solo lectura: identidad confirmada ahora (undefined = aún no se sabe · null = sin sesión · uid). La usa js/geoarmy-cosmetics.js
    // cuando se carga tarde (después de que la barra ya se dibujó) para adoptar la cuenta vigente.
    identity: function () { return streakUid; },
  };
 
  // ===== Sincronización automática del perfil de Twitch (carga diferida) =====
  // Apagada por defecto: solo se carga si js/geoarmy-config.js trae
  // GEOARMY_PROFILE_SYNC_ENABLED = true. El módulo vive aparte (no toca nada de
  // lo de arriba) y se engancha por GeoArmyAccount.client / refreshWidget.
  (function loadProfileSyncModule() {
    try {
      if (window.GEOARMY_PROFILE_SYNC_ENABLED !== true || window.GeoArmyProfileSync) return;
      var s = document.createElement('script');
      s.src = siteBase() + 'js/geoarmy-profile-sync.js?v=1';
      s.async = true;
      s.onerror = function () { console.warn('[geoarmy-account] no se pudo cargar js/geoarmy-profile-sync.js'); };
      document.head.appendChild(s);
    } catch (e) { /* la sincronización nunca debe romper la cuenta */ }
  })();

  // ===== Misión diaria Plus de G-Coins (reclamo automático) — carga diferida, apagada por defecto =====
  // Solo se carga si js/geoarmy-config.js trae GEOARMY_PLUS_DAILY_ENABLED = true. El módulo vive aparte y NO toca nada de lo de arriba
  // ni las misiones de XP (no usa claim_daily_visit ni my_missions_status): reclama por la Edge Function `plus-daily-gcoin-claim`.
  (function loadPlusDailyModule() {
    try {
      if (window.GEOARMY_PLUS_DAILY_ENABLED !== true || window.GeoArmyPlusDaily) return;
      var s = document.createElement('script');
      s.src = siteBase() + 'js/geoarmy-plus-daily.js?v=1';
      s.async = true;
      s.onerror = function () { console.warn('[geoarmy-account] no se pudo cargar js/geoarmy-plus-daily.js'); };
      document.head.appendChild(s);
    } catch (e) { /* la misión diaria nunca debe romper la cuenta */ }
  })();

  // ===== Cosméticos (marco VIP) — carga diferida, apagada por defecto =====
  // Solo se carga si js/geoarmy-config.js trae GEOARMY_COSMETICS_ENABLED = true (y si la página no lo incluyó ya con
  // su propio <script>). El módulo es solo presentación y vive aparte; aquí solo hay 4 enganches mínimos con
  // try/catch (confirmSessionIdentity, render, renderLoggedIn) para pintar el marco en el pill de la cuenta.
  (function loadCosmeticsModule() {
    try {
      if (window.GEOARMY_COSMETICS_ENABLED !== true || window.GeoArmyCosmetics) return;
      if (document.querySelector('script[src*="geoarmy-cosmetics.js"]')) return;
      var s = document.createElement('script');
      s.src = siteBase() + 'js/geoarmy-cosmetics.js?v=2';
      s.async = true;
      s.onerror = function () { console.warn('[geoarmy-account] no se pudo cargar js/geoarmy-cosmetics.js'); };
      document.head.appendChild(s);
    } catch (e) { /* los cosméticos nunca deben romper la cuenta */ }
  })();

  var CACHE_KEY = 'geoarmy_gcoins_cache_v1';
 
  function cacheSaldo(valor) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ valor: valor, ts: Date.now() })); } catch (e) {}
  }
  function saldoCacheado() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
 
  // Lee el saldo REAL de G-Coins desde tienda-server, igual que ya hace
  // tienda.html — usando el access token de Twitch del propio usuario.
  // No inventa un balance nuevo: es el mismo saldo de siempre.
  async function fetchSaldoReal(twitchAccessToken) {
    if (!twitchAccessToken) return null;
    try {
      var res = await fetch(TIENDA_API_BASE + '/api/saldo', {
        headers: { Authorization: 'Bearer ' + twitchAccessToken },
      });
      if (!res.ok) return null;
      var data = await res.json();
      if (typeof data.oro === 'number') { cacheSaldo(data.oro); return data.oro; }
      return null;
    } catch (e) {
      console.warn('[geoarmy-account] no se pudo leer el saldo real', e);
      return null;
    }
  }
 
  // El trigger de Supabase (handle_new_user) ya crea el perfil en el primer
  // login — aquí solo lo leemos, nunca lo escribimos desde el cliente.
  async function fetchProfile(userId) {
    var r = await sb.from('profiles').select('*').eq('id', userId).single();
    if (r.error) { console.warn('[geoarmy-account] no se pudo leer el perfil', r.error); return null; }
    return r.data;
  }

  // Solo lectura, para el header compacto (avatar + nombre + bandera +
  // insignia mientras el usuario navega). RPC ya existente en Supabase,
  // no se toca ni se duplica su lógica acá. Si falla por lo que sea, el
  // header cae de vuelta a "sin bandera / sin insignia" sin romper nada.
  async function fetchCompactProfile() {
    try {
      var r = await sb.rpc('my_compact_profile');
      if (r.error) { console.warn('[geoarmy-account] no se pudo leer my_compact_profile()', r.error); return null; }
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      return row || null;
    } catch (e) {
      console.warn('[geoarmy-account] error leyendo my_compact_profile()', e);
      return null;
    }
  }
 
  // Lectura mínima y aislada, solo para los chips de resumen del widget global
  // (visible en todas las páginas). NO reemplaza ni duplica loadWallets() de
  // mi-geoarmy.html — es la misma tabla, filtrada al propio usuario (RLS
  // intacta, mismo cliente/sesión de siempre), pidiendo solo VBUCKS/OWCOINS y
  // los campos mínimos (balance, reserved) para calcular el disponible.
  async function fetchMiniWallets(userId) {
    try {
      var res = await sb.from('wallet_balances')
        .select('currency_code, balance, reserved')
        .eq('profile_id', userId)
        .in('currency_code', ['VBUCKS', 'OWCOINS']);
      if (res.error) {
        console.warn('[geoarmy-account] no se pudieron leer los saldos mini (VBUCKS/OWCOINS)', res.error);
        return {};
      }
      var byCode = {};
      (res.data || []).forEach(function (row) {
        byCode[row.currency_code] = Number(row.balance || 0) - Number(row.reserved || 0);
      });
      return byCode;
    } catch (e) {
      console.warn('[geoarmy-account] error leyendo saldos mini', e);
      return {};
    }
  }
 
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
 
  // ===== Racha Diaria en el header: chip "🔥 N" =====
  // Solo LECTURA: get_my_streak() (el servidor ya calcula la racha efectiva;
  // aquí NO se recalcula nada con fechas). Nunca se llama a
  // claim_daily_streak() desde el header: registrar asistencia es solo por
  // clic en la pestaña Racha de mi-geoarmy.html.
  //
  // Aislamiento por cuenta:
  //  - streakUid es la identidad vigente (la fija el propio evento de auth y
  //    el render MÁS RECIENTE; un render viejo que llega tarde no la cambia).
  //  - El dato en memoria lleva su uid y se descarta al cambiar de cuenta o
  //    cerrar sesión (nada se guarda en sessionStorage/localStorage).
  //  - El chip solo se pinta si el uid del dato, el de la sesión vigente y el
  //    del header que está en pantalla coinciden.
  //  - Una lectura (o evento) de otra cuenta se descarta; una sola lectura a
  //    la vez (promesa en vuelo compartida) y TTL de ~60 s.
  // Se muestra únicamente si current_streak > 0; con racha 0, cargando, error
  // o sin sesión el chip no existe (nunca un número inventado).
  var STREAK_TTL_OK = 60000;    // lectura buena: no se vuelve a pedir en ~60 s
  var STREAK_TTL_FAIL = 20000;  // lectura fallida: reintento no antes de ~20 s
  var streakUid;                // undefined = aún no se sabe · null = sin sesión
  var streakState = null;       // { uid, value, ok, ts }
  var streakFlight = null;      // { uid } lectura en curso (una sola)
  var streakDataVer = 0;        // sube cada vez que se acepta un dato nuevo
  var renderSeq = 0;            // secuencia de render(): solo el render más reciente puede pintar el header y fijar la identidad
  var streakPaintedUid = null;  // uid del header que está dibujado ahora

  function streakIsCount(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 9007199254740991;
  }
  // Fecha AAAA-MM-DD real (mismo criterio estricto que la pestaña Racha).
  function streakYmd(s) {
    if (typeof s !== 'string') return false;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  // Solo los campos del contrato que el header usa o de los que depende.
  function streakValid(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (!streakYmd(d.today) || typeof d.claimed_today !== 'boolean') return false;
    if (!streakIsCount(d.current_streak) || !streakIsCount(d.best_streak) || !streakIsCount(d.total_checkins)) return false;
    if (d.last_checkin_date !== null && d.last_checkin_date !== undefined && !streakYmd(d.last_checkin_date)) return false;
    return true;
  }
  function streakChipMarkup(uid, n) {
    var label = 'Racha de ' + n + (n === 1 ? ' día' : ' días');
    return '<span class="ga-streak" data-uid="' + esc(uid) + '" data-n="' + n + '" role="img" aria-label="' + label + '" title="' + label + '">' +
      '<span class="ga-streak-ic" aria-hidden="true">🔥</span><span class="ga-streak-n" aria-hidden="true">' + n + '</span></span>';
  }
  function streakVisibleFor(uid) {
    return !!uid && uid === streakUid && !!streakState && streakState.ok === true &&
      streakState.uid === uid && streakState.value > 0;
  }
  // Para el render del header: pintado síncrono desde memoria (el render
  // reconstruye todo el slot, así que sin esto el chip parpadearía).
  function streakChipHtml(uid) {
    return streakVisibleFor(uid) ? streakChipMarkup(uid, streakState.value) : '';
  }
  // Para cambios posteriores al render (llega la lectura, llega el evento,
  // cambia la cuenta): añade, actualiza o quita el chip sin tocar nada más.
  function syncStreakChip() {
    try {
      var btn = document.getElementById('gaToggleMenu');
      if (!btn) return;
      var chip = btn.querySelector('.ga-streak');
      if (!streakVisibleFor(streakPaintedUid)) { if (chip) chip.remove(); return; }
      var n = streakState.value;
      if (chip && chip.getAttribute('data-uid') === streakPaintedUid && chip.getAttribute('data-n') === String(n)) return;
      if (chip) chip.remove();
      btn.insertAdjacentHTML('beforeend', streakChipMarkup(streakPaintedUid, n));
    } catch (e) {}
  }
  function streakSetIdentity(uid) {
    uid = uid || null;
    if (uid === streakUid) return;
    streakUid = uid;
    streakState = null;
    streakFlight = null;   // la lectura en curso (si hay) queda huérfana y se descarta al llegar
    streakDataVer++;
    syncStreakChip();
  }
  function streakAccept(uid, value, ok) {
    streakState = { uid: uid, value: value, ok: ok, ts: Date.now() };
    streakDataVer++;
    syncStreakChip();
  }
  // Pide la racha SOLO si hace falta: sin lectura en curso y sin dato fresco.
  function ensureStreak(uid) {
    if (!uid || uid !== streakUid) return;
    if (streakFlight) return;
    if (streakState && streakState.uid === uid &&
        (Date.now() - streakState.ts) < (streakState.ok ? STREAK_TTL_OK : STREAK_TTL_FAIL)) return;
    var flight = { uid: uid };
    var ver = streakDataVer;
    streakFlight = flight;
    function mine() { return streakFlight === flight && streakUid === uid; }
    function finish(d) {
      if (!mine()) return;
      streakFlight = null;
      // Si mientras tanto llegó un dato más reciente (evento de la pestaña Racha), esta lectura se descarta.
      if (streakDataVer !== ver) return;
      if (streakValid(d)) streakAccept(uid, d.current_streak, true);
      else streakAccept(uid, null, false);
    }
    var p;
    try { p = sb.rpc('get_my_streak'); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (r) {
      finish(r && !r.error ? r.data : null);
    }, function () { finish(null); });
  }
  // La pestaña Racha avisa tras cada lectura válida (también después de
  // registrar asistencia): el chip se actualiza sin otra llamada a Supabase.
  // Se acepta solo si el uid del evento es el de la sesión vigente.
  document.addEventListener('geoarmy:streak-updated', function (e) {
    try {
      var d = e && e.detail;
      if (!d || typeof d.uid !== 'string' || d.uid !== streakUid) return;
      if (!streakIsCount(d.current_streak)) return;
      streakAccept(d.uid, d.current_streak, true);
    } catch (err) {}
  });

  function renderLoggedOut(slot) {
    streakPaintedUid = null;
    slot.innerHTML =
      '<button type="button" class="ga-account-btn ga-logged-out" id="gaOpenLogin">' +
        '<span class="ga-ic">👤</span><span>Mi Geo Army</span>' +
      '</button>';
    document.getElementById('gaOpenLogin').addEventListener('click', openLoginModal);
  }
 
  function renderLoggedIn(slot, profile, saldo, miniWallets, compact, uid) {
    var nombre = profile.display_name || profile.twitch_login || 'Miembro';
    var avatar = profile.avatar_url
      ? '<img src="' + esc(profile.avatar_url) + '" alt="" class="ga-avatar"/>'
      : '<span class="ga-avatar ga-avatar-fallback">' + esc(nombre[0] || '?') + '</span>';
    var saldoTxt = saldo == null ? '—' : Number(saldo).toLocaleString();

    // Bandera + insignia del pill compacto (header). country_code/rank_code
    // vienen de my_compact_profile() — ver fetchCompactProfile(). Si esa RPC
    // falló o el país no está configurado, simplemente no se muestra nada
    // ahí (sin placeholder raro, tal como se pidió).
    var ranks = window.GeoArmyRanks;
    var countryCode = compact && compact.country_code;
    var rankCode = compact && compact.rank_code;
    var flagHtml = (ranks && countryCode)
      ? '<img class="ga-flag" src="' + esc(ranks.flagImgUrl(countryCode)) + '" alt="" title="' + esc(countryCode) + '" onerror="this.remove()"/>'
      : '';
    var badgeHtml = (ranks && rankCode)
      ? '<img class="ga-badge" src="' + esc(ranks.rankBadgeUrl(rankCode, siteBase())) + '" alt="' + esc(ranks.rankName(rankCode)) + '" title="' + esc(ranks.rankName(rankCode)) + '" onerror="this.remove()"/>'
      : '';
 
    // Resumen rápido de saldos, arriba del listado de opciones del dropdown.
    // G-Coins reusa el mismo `saldo` que ya trae tienda-server (sin segunda
    // consulta); V-Bucks/OW Coins vienen de fetchMiniWallets() (wallet_balances,
    // solo lectura, ver arriba) — ambas fuentes se muestran juntas pero nunca
    // se combinan/mezclan.
    miniWallets = miniWallets || {};
    var vbucksTxt = miniWallets.VBUCKS == null ? '—' : Number(miniWallets.VBUCKS).toLocaleString();
    var owcoinsTxt = miniWallets.OWCOINS == null ? '—' : Number(miniWallets.OWCOINS).toLocaleString();
    var balancesRow =
      '<div class="ga-balances">' +
        '<span class="ga-chip ga-chip-gcoin" title="G-Coins disponibles">' +
          '<img class="ga-chip-ic ga-chip-ic-img" src="' + siteBase() + 'gcoin-icon.png" alt="" onerror="this.remove()"/>' + saldoTxt +
        '</span>' +
        '<span class="ga-chip ga-chip-vbucks" title="V-Bucks disponibles">' +
          '<img class="ga-chip-ic ga-chip-ic-img" src="' + siteBase() + 'icon-fortnite.png" alt="" onerror="this.remove()"/>' + vbucksTxt +
        '</span>' +
        '<span class="ga-chip ga-chip-owcoins" title="OW Coins disponibles">' +
          '<img class="ga-chip-ic ga-chip-ic-img" src="' + siteBase() + 'icon-overwatch.png" alt="" onerror="this.remove()"/>' + owcoinsTxt +
        '</span>' +
      '</div>';
 
    streakPaintedUid = uid || null;
    slot.innerHTML =
      '<div class="ga-account-wrap">' +
        '<button type="button" class="ga-account-btn ga-logged-in" id="gaToggleMenu">' +
          '<span class="ga-dot"></span>' + avatar +
          '<span class="ga-name">' + esc(nombre) + '</span>' +
          flagHtml + badgeHtml + streakChipHtml(uid) +
        '</button>' +
        '<div class="ga-dropdown" id="gaDropdown" hidden>' +
          balancesRow +
          '<a href="mi-geoarmy.html" class="ga-drop-item">👤 Mi perfil</a>' +
          // Antes usaba el emoji 🪙, que no lo soportan todas las fuentes del
          // sistema (se veía como un cuadro vacío) — se reemplaza por el mismo
          // ícono de imagen que ya usa el chip de G-Coins arriba, sin depender
          // de la fuente de emojis.
          '<a href="mi-geoarmy.html#gcoins" class="ga-drop-item">' +
            '<img class="ga-drop-ic-img" src="' + siteBase() + 'gcoin-icon.png" alt="" onerror="this.remove()"/> Mis G-Coins' +
          '</a>' +
          // Ranking NO va aquí a propósito — ya tiene acceso propio desde el
          // pin del mundo en index.html, la tarjeta resumen de mi-geoarmy.html
          // y ranking.html; este menú es solo opciones de cuenta.
          // Los enlaces de admin NUNCA aparecen en el navbar público — solo
          // aquí, dentro del dropdown de la propia cuenta, y solo si
          // profiles.role === 'admin'. Esto es únicamente ocultar el enlace
          // (UX): la protección real está del lado del servidor en
          // admin_list_redemption_requests()/admin_update_redemption_status()
          // (ver migracion-panel-admin-v2.sql) y en
          // admin_list_store_fulfillments_v2()/admin_update_store_fulfillment_v2()
          // (ver Migración 005 de Tienda V2) — ambas rechazan a cualquiera
          // que no sea admin aunque conozca la URL. Dos paneles admin
          // independientes hoy (recompensas de canje / fulfillments de
          // Tienda V2), cada uno su propio enlace -- no comparten backend.
          (profile.role === 'admin'
            ? '<a href="admin/recompensas/" class="ga-drop-item">🛠️ Recompensas</a>' +
              '<a href="admin/fulfillments/" class="ga-drop-item">📦 Fulfillments</a>'
            : '') +
          '<button type="button" class="ga-drop-item ga-drop-danger" id="gaLogout">🚪 Cerrar sesión</button>' +
        '</div>' +
      '</div>';
 
    // Abrir/cerrar el dropdown: NO se cablea acá con listeners nuevos en
    // cada render (eso es lo que causaba que dejara de cerrarse — cada
    // re-render de renderLoggedIn() sumaba otro listener de "click fuera"
    // pegado a document, que nunca se limpia). El comportamiento real vive
    // en initDropdownGlobalBehavior(), que se registra UNA sola vez para
    // toda la página sin importar cuántas veces se vuelva a dibujar este
    // botón/menú (ver esa función más abajo).
    document.getElementById('gaLogout').addEventListener('click', async function () {
      await sb.auth.signOut();
      try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
      location.href = 'index.html';
    });

    // Cosméticos: cada render reconstruye el botón, así que el marco se vuelve a poner aquí, siempre con el uid de ESTE render.
    try { if (window.GeoArmyCosmetics) window.GeoArmyCosmetics.decorateBar(uid); } catch (e) {}
  }
 
  function openLoginModal() {
    var overlay = document.createElement('div');
    overlay.className = 'ga-modal-overlay';
    overlay.innerHTML =
      '<div class="ga-modal">' +
        '<button type="button" class="ga-modal-close" aria-label="Cerrar">✕</button>' +
        '<div class="ga-modal-logo">👤</div>' +
        '<h3>Mi Geo Army</h3>' +
        '<p>Inicia sesión para ver tu perfil, tus G-Coins y tu posición en el ranking.</p>' +
        '<button type="button" class="ga-twitch-btn" id="gaTwitchLogin">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 2 2 6v14h6v2h4l2-2h4l4-4V2H4Zm16 12-3 3h-5l-2 2v-2H6V4h14v10Z"/><rect x="9" y="7" width="2" height="5"/><rect x="14" y="7" width="2" height="5"/></svg>' +
          'Continuar con Twitch' +
        '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.ga-modal-close').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#gaTwitchLogin').addEventListener('click', async function () {
      await signInWithTwitch();
    });
  }
 
  // ===== Auto-claim de DAILY_VISIT: primera visita autenticada del dia =====
  // Global a proposito -- vive aca (no en misiones.html ni en ninguna
  // pagina puntual) porque este es el unico lugar donde TODAS las paginas
  // del sitio confirman sesion. Se dispara una sola vez por carga de
  // pagina, apenas se sabe que hay sesion real, sin bloquear el resto de
  // render() (perfil/saldo/header siguen su curso en paralelo).
  //
  // Anti-duplicados: dailyVisitClaimStarted se pone en true de forma
  // SINCRONICA, antes de cualquier await -- render() se dispara tanto en
  // DOMContentLoaded como en CADA evento de onAuthStateChange (que puede
  // disparar varias veces por carga: INITIAL_SESSION, SIGNED_IN,
  // TOKEN_REFRESHED, etc.), asi que sin este flag se llamaria la RPC de
  // mas cada vez que render() se re-ejecuta. El motor (claim_daily_visit())
  // ya es idempotente por dia/usuario -- esto solo evita llamadas de red
  // innecesarias, no XP duplicado (eso ya esta resuelto en backend).
  //
  // No recalcula XP, no toca profiles, no toca SQL/RPC -- unicamente
  // invoca la RPC existente tal cual.
  var dailyVisitClaimStarted = false;
  function autoClaimDailyVisit() {
    if (dailyVisitClaimStarted) return;
    dailyVisitClaimStarted = true;
    sb.rpc('claim_daily_visit').then(function (res) {
      if (res.error) {
        // Nunca se muestra como error al usuario -- solo se registra.
        console.warn('[geoarmy-account] claim_daily_visit fallo', res.error);
        return;
      }
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      // applied=false significa "ya reclamada hoy" -- no es un error, no
      // se muestra ni se dispara nada.
      if (row && row.applied) {
        try {
          document.dispatchEvent(new CustomEvent('geoarmy:daily-visit-claimed', { detail: row }));
        } catch (e) {}
      }
    }).catch(function (e) {
      // Falla de red u otra: warning, nunca rompe la navegacion.
      console.warn('[geoarmy-account] claim_daily_visit error de red', e);
    });
  }


  // ===== Auto-vinculado de premios pendientes de Ganadores =====
  // Cuando el usuario ya tiene sesion/perfil, esta RPC toma SU auth.uid(),
  // enlaza winner_records cuyo twitch_login coincide con su perfil y acredita
  // unicamente premios pendientes elegibles que aun no tengan transaccion de
  // wallet. El backend es la autoridad: el cliente NO envia login, monto,
  // moneda ni profile_id.
  //
  // Se guarda la Promise (no solo un boolean) para que si render() se dispara
  // varias veces por onAuthStateChange, todas las llamadas concurrentes esperen
  // la MISMA ejecucion. Asi evitamos llamadas paralelas innecesarias y, ademas,
  // render() puede esperar a que termine antes de leer los mini-wallets, para
  // que un premio recien vinculado aparezca en el header desde esa misma carga.
  var pendingWinnersClaimPromise = null;
  function autoClaimPendingWinners() {
    if (pendingWinnersClaimPromise) return pendingWinnersClaimPromise;

    pendingWinnersClaimPromise = sb.rpc('claim_my_pending_winners').then(function (res) {
      if (res.error) {
        console.warn('[geoarmy-account] claim_my_pending_winners fallo', res.error);
        return null;
      }

      var data = res.data || null;
      if (data) {
        var linked = Number(data.linked_records || 0);
        var credited = Number(data.credited_rewards || 0);
        if (linked > 0 || credited > 0) {
          try {
            document.dispatchEvent(new CustomEvent('geoarmy:winners-claimed', { detail: data }));
          } catch (e) {}
        }
      }
      return data;
    }).catch(function (e) {
      console.warn('[geoarmy-account] claim_my_pending_winners error de red', e);
      return null;
    });

    return pendingWinnersClaimPromise;
  }

  // Al confirmarse una identidad distinta de la del header que está en
  // pantalla (cambio de cuenta o cierre de sesión), el header viejo se retira
  // de inmediato: nunca se ve el nombre/avatar/saldos de A con la sesión de B.
  // El render vigente pinta después el header que corresponde. Si la
  // identidad no cambió (TOKEN_REFRESHED, renders duplicados) no se toca nada.
  function confirmSessionIdentity(uid) {
    uid = uid || null;
    streakSetIdentity(uid);
    if (streakPaintedUid && streakPaintedUid !== uid) {
      streakPaintedUid = null;
      var slot = document.getElementById('geoAccountWidget');
      if (slot) slot.innerHTML = '';
    }
    // Cosméticos: la identidad vigente cambia aquí también (retira de inmediato el marco de la cuenta anterior).
    try { if (window.GeoArmyCosmetics) window.GeoArmyCosmetics.setIdentity(uid); } catch (e) {}
  }

  // Un render sigue vigente solo si es el más reciente Y la identidad
  // confirmada (evento de auth / getSession del render más reciente) sigue
  // siendo la suya. Un render viejo (otra cuenta, cierre de sesión o simple
  // duplicado) termina sin tocar el DOM del header ni la identidad del chip.
  function renderIsCurrent(seq, uid) {
    return seq === renderSeq && streakUid === (uid || null);
  }

  async function render() {
    var slot = document.getElementById('geoAccountWidget');
    if (!slot) return;
 
    var seq = ++renderSeq;
    var sessionRes = await sb.auth.getSession();
    // Render obsoleto: otro render más reciente ya está en curso y es el único que pinta.
    if (seq !== renderSeq) return;
    var session = sessionRes.data && sessionRes.data.session;
    var uid = session && session.user ? session.user.id : null;
    confirmSessionIdentity(uid);
    if (!session) { renderLoggedOut(slot); return; }

    // Fire-and-forget: no se espera este resultado para nada de lo que
    // sigue -- el header/perfil se renderiza igual, tarde o temprano la
    // visita del dia queda registrada.
    autoClaimDailyVisit();
 
    var profile = await fetchProfile(uid);
    if (!renderIsCurrent(seq, uid)) return;
    if (!profile) { renderLoggedOut(slot); return; }

    // Racha del header: lectura aparte, sin bloquear nada de lo demás.
    try { ensureStreak(uid); } catch (e) {}

    // Sincronización de perfil de Twitch: fire-and-forget (nunca se espera). El
    // servidor decide si ya toca (24 h); si hay un cambio real, el módulo llama
    // a refreshWidget() y dispara 'geoarmy:profile-synced'.
    try {
      if (window.GeoArmyProfileSync) window.GeoArmyProfileSync.ensure('auth', session).catch(function () {});
    } catch (e) {}

    // Espera el auto-vinculado antes de leer VBUCKS/OWCOINS para que, si esta
    // sesion acaba de heredar premios pendientes, el widget muestre el saldo
    // actualizado en esta misma carga. DAILY_VISIT sigue independiente.
    await autoClaimPendingWinners();
    if (!renderIsCurrent(seq, uid)) return;
 
    var saldo = null;
    if (session.provider_token) {
      saldo = await fetchSaldoReal(session.provider_token);
      if (!renderIsCurrent(seq, uid)) return;
    }
    if (saldo == null) {
      var cached = saldoCacheado();
      if (cached) saldo = cached.valor;
    }
    var miniWallets = await fetchMiniWallets(uid);
    if (!renderIsCurrent(seq, uid)) return;
    var compact = await fetchCompactProfile();
    if (!renderIsCurrent(seq, uid)) return;
    // Cosméticos: apariencia autorizada para ESTA cuenta (tope corto; si el proveedor tarda o falla, no se pinta nada).
    try {
      if (window.GeoArmyCosmetics) {
        await window.GeoArmyCosmetics.resolveSession(uid);
        if (!renderIsCurrent(seq, uid)) return;
      }
    } catch (e) {}
    renderLoggedIn(slot, profile, saldo, miniWallets, compact, uid);
  }
 
  // ===== Dropdown de cuenta: abrir/cerrar, GLOBAL y una sola vez =====
  // Se registra una única vez por carga de página (guardado en
  // window para blindarlo incluso si este script se llegara a incluir dos
  // veces por error). btn/dd se buscan por id en cada evento, nunca se
  // guardan en una variable capturada — así siempre apuntan al botón/menú
  // que existe AHORA en el DOM, sin importar cuántas veces render() haya
  // vuelto a dibujar #geoAccountWidget desde adentro (login, cambio de
  // saldo, refresh de sesión, etc.). Esto es lo que faltaba: antes cada
  // render() sumaba un listener nuevo de "click fuera" pegado a document
  // que nunca se limpiaba, y el menú dejaba de cerrarse bien después de
  // un rato. No toca sesión/login/datos — solo abrir/cerrar.
  function initDropdownGlobalBehavior() {
    if (window.__gaDropdownGlobalInit) return;
    window.__gaDropdownGlobalInit = true;

    function closeDropdown() {
      var dd = document.getElementById('gaDropdown');
      if (dd) dd.hidden = true;
    }

    // click (cubre tap en móvil: los navegadores disparan "click" al tocar).
    document.addEventListener('click', function (e) {
      var btn = document.getElementById('gaToggleMenu');
      var dd = document.getElementById('gaDropdown');
      if (!btn || !dd) return;

      if (btn.contains(e.target)) {
        dd.hidden = !dd.hidden;
        return;
      }
      if (dd.contains(e.target)) {
        // Clic en una opción del menú: se cierra ya mismo, antes de que
        // la navegación (si la hay) descargue la página.
        dd.hidden = true;
        return;
      }
      // Clic afuera de todo: cierra si estaba abierto.
      if (!dd.hidden) dd.hidden = true;
    });

    // Tecla ESC cierra el menú si está abierto.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeDropdown();
    });
  }
  initDropdownGlobalBehavior();

  sb.auth.onAuthStateChange(function (event, session) {
    // La identidad vigente (chip de racha y header en pantalla) sigue al evento de auth: cierre de sesión / cambio de cuenta.
    try { confirmSessionIdentity(session && session.user ? session.user.id : null); } catch (e) {}
    render();
  });
  document.addEventListener('DOMContentLoaded', render);
})();