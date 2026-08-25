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
      options: { redirectTo: window.location.origin + siteBase() + 'auth/callback/' },
    });
  }
 
  // Otras páginas (ej. mi-geoarmy.html) reusan esta misma instancia/sesión.
  window.GeoArmyAccount = {
    client: sb,
    openLogin: openLoginModal,
    refreshWidget: render,
    signInWithTwitch: signInWithTwitch,
  };
 
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
 
  function renderLoggedOut(slot) {
    slot.innerHTML =
      '<button type="button" class="ga-account-btn ga-logged-out" id="gaOpenLogin">' +
        '<span class="ga-ic">👤</span><span>Mi Geo Army</span>' +
      '</button>';
    document.getElementById('gaOpenLogin').addEventListener('click', openLoginModal);
  }
 
  function renderLoggedIn(slot, profile, saldo, miniWallets) {
    var nombre = profile.display_name || profile.twitch_login || 'Miembro';
    var avatar = profile.avatar_url
      ? '<img src="' + esc(profile.avatar_url) + '" alt="" class="ga-avatar"/>'
      : '<span class="ga-avatar ga-avatar-fallback">' + esc(nombre[0] || '?') + '</span>';
    var saldoTxt = saldo == null ? '—' : Number(saldo).toLocaleString();
 
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
          '<img class="ga-chip-ic ga-chip-ic-img" src="gcoin-icon.png" alt=""/>' + saldoTxt +
        '</span>' +
        '<span class="ga-chip ga-chip-vbucks" title="V-Bucks disponibles">' +
          '<span class="ga-chip-ic">🎮</span>' + vbucksTxt +
        '</span>' +
        '<span class="ga-chip ga-chip-owcoins" title="OW Coins disponibles">' +
          '<span class="ga-chip-ic">🕹️</span>' + owcoinsTxt +
        '</span>' +
      '</div>';
 
    slot.innerHTML =
      '<div class="ga-account-wrap">' +
        '<button type="button" class="ga-account-btn ga-logged-in" id="gaToggleMenu">' +
          '<span class="ga-dot"></span>' + avatar +
          '<span class="ga-name">' + esc(nombre) + '</span>' +
          '<span class="ga-sep">·</span>' +
          '<span class="ga-gcoins">' + saldoTxt + ' G</span>' +
        '</button>' +
        '<div class="ga-dropdown" id="gaDropdown" hidden>' +
          balancesRow +
          '<a href="mi-geoarmy.html" class="ga-drop-item">👤 Mi perfil</a>' +
          '<a href="mi-geoarmy.html#gcoins" class="ga-drop-item">🪙 Mis G-Coins</a>' +
          '<a href="mi-geoarmy.html#ranking" class="ga-drop-item">🏆 Ranking</a>' +
          // "Panel Admin" NUNCA aparece en el navbar público — solo aquí, dentro
          // del dropdown de la propia cuenta, y solo si profiles.role === 'admin'.
          // Esto es únicamente ocultar el enlace (UX): la protección real está
          // del lado del servidor en admin_list_redemption_requests()/
          // admin_update_redemption_status() (ver migracion-panel-admin-v2.sql),
          // que rechazan a cualquiera que no sea admin aunque conozca la URL.
          (profile.role === 'admin'
            ? '<a href="admin/recompensas/" class="ga-drop-item">🛠️ Panel Admin</a>'
            : '') +
          '<button type="button" class="ga-drop-item ga-drop-danger" id="gaLogout">🚪 Cerrar sesión</button>' +
        '</div>' +
      '</div>';
 
    var btn = document.getElementById('gaToggleMenu');
    var dd = document.getElementById('gaDropdown');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dd.hidden = !dd.hidden;
    });
    document.addEventListener('click', function () { dd.hidden = true; });
    dd.addEventListener('click', function (e) { e.stopPropagation(); });
    document.getElementById('gaLogout').addEventListener('click', async function () {
      await sb.auth.signOut();
      try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
      location.href = 'index.html';
    });
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
 
  async function render() {
    var slot = document.getElementById('geoAccountWidget');
    if (!slot) return;
 
    var sessionRes = await sb.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session;
    if (!session) { renderLoggedOut(slot); return; }
 
    var profile = await fetchProfile(session.user.id);
    if (!profile) { renderLoggedOut(slot); return; }
 
    var saldo = null;
    if (session.provider_token) {
      saldo = await fetchSaldoReal(session.provider_token);
    }
    if (saldo == null) {
      var cached = saldoCacheado();
      if (cached) saldo = cached.valor;
    }
    var miniWallets = await fetchMiniWallets(session.user.id);
    renderLoggedIn(slot, profile, saldo, miniWallets);
  }
 
  sb.auth.onAuthStateChange(function () { render(); });
  document.addEventListener('DOMContentLoaded', render);
})();