/* =====================================================================
   GEO ARMY · COSMÉTICOS · ADAPTADOR DEL CONTRATO   (js/geoarmy-cosmetics-adapter.js, v2)
   ÚNICO archivo que conoce la FORMA de las respuestas del servidor y el TRANSPORTE. js/geoarmy-cosmetics.js solo pinta lo que este
   adaptador entrega ya validado. Se carga solo cuando GEOARMY_COSMETICS_ENABLED === true (lo carga el propio módulo).

   ---- CONTRATO REAL (definido y verificado en Supabase por ChatGPT; aquí solo se CONSUME) ----
   1) APARIENCIA DE LA SESIÓN (barra superior y tarjeta de Mi Geo Army)
        RPC sin parámetros:  geo_vip_my_appearance_v1()      (disponible para `authenticated`, no para `anon`)
        La cuenta se identifica EN EL SERVIDOR por la sesión autenticada: NO se envía uid, login ni nombre.
        Respuesta:  { "appearance": "vip_violet_silver" }   o   { "appearance": null }
   2) RANKING CON APARIENCIA
        Vista pública de solo lectura:  geo_vip_ranking_v1   (funciona con y sin sesión)
        Columnas:  position, avatar_url, display_name, country_code, rank_code, rank_name, xp, appearance
        Se consulta ordenando por position ascendente y limitando a 50 filas. La apariencia viene junto a SU fila en UNA sola
        respuesta; no se devuelve ni se usa ningún id interno; el frontend nunca empareja por nombre, posición ni índice.
   Cualquier error, tiempo agotado, respuesta inválida, vista vacía o código desconocido → apariencia normal; el ranking usa su
   consulta de siempre (xp_leaderboard) como respaldo.

   Validación de la respuesta de ranking, por fila:  appearance obligatoria (string o null) · position entero ≥ 1 sin repetirse ·
   xp número finito ≥ 0 · display_name, avatar_url, country_code, rank_code, rank_name opcionales (null/ausente válidos; si traen
   valor, texto). UNA fila inválida invalida TODA la respuesta. Un código string desconocido solo deja esa fila normal.

   Este archivo NO contiene claves, URLs ni tokens: usa el cliente Supabase que ya tiene la página (ctx.client).
   La simulación local (js/geoarmy-cosmetics-sim.js) es independiente: solo en equipo local y con GEOARMY_COSMETICS_SIMULATION=true
   sustituye este transporte mediante GeoArmyCosmetics.useTransport(...).
   ===================================================================== */
(function () {
  'use strict';
  if (window.GeoArmyCosmeticsAdapter) return;

  // Nombre del campo con el código de apariencia (en la respuesta de sesión y en cada fila del ranking) según el contrato real.
  var FIELD_APPEARANCE = 'appearance';

  function isPlain(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // raw de sesión → string (código) | null (sin cosmético) | undefined (respuesta INVÁLIDA = fallo)
  function parseSession(raw) {
    if (!isPlain(raw) || !has(raw, FIELD_APPEARANCE)) return undefined;
    var v = raw[FIELD_APPEARANCE];
    if (v === null) return null;
    if (typeof v === 'string') return v || null;
    return undefined;
  }

  // Campos que ranking.html necesita de verdad para dibujar una fila (revisado contra rowParts/renderTop3/renderRest):
  //   OBLIGATORIOS: position (entero ≥ 1, reparte podio/resto y se muestra) · xp (número finito ≥ 0, se muestra con toLocaleString).
  //   OPCIONALES (la página ya tolera null/ausente: avatar de inicial, sin bandera, sin insignia, "Miembro"): display_name, avatar_url,
  //   country_code, rank_code, rank_name. Si vienen con valor, deben ser texto: un número/objeto se pintaría como "[object Object]".
  var OPTIONAL_TEXT = ['display_name', 'avatar_url', 'country_code', 'rank_code', 'rank_name'];
  function validRow(r) {
    if (typeof r.position !== 'number' || !isFinite(r.position) || r.position < 1 || Math.floor(r.position) !== r.position) return false;
    if (typeof r.xp !== 'number' || !isFinite(r.xp) || r.xp < 0) return false;
    for (var i = 0; i < OPTIONAL_TEXT.length; i++) {
      var v = r[OPTIONAL_TEXT[i]];
      if (v !== undefined && v !== null && typeof v !== 'string') return false;
    }
    return true;
  }

  // raw de ranking → Array<{ row, code }> | undefined (INVÁLIDA = fallo). `row` es una COPIA de los datos de la fila sin el campo de apariencia.
  // UNA sola fila inválida invalida TODA la respuesta (el ranking usa entonces su consulta normal, sin cosméticos).
  function parseRanking(raw) {
    if (!Array.isArray(raw) || !raw.length) return undefined;
    var out = [], seen = {};
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (!isPlain(r) || !has(r, FIELD_APPEARANCE)) return undefined;
      var v = r[FIELD_APPEARANCE];
      if (!(v === null || typeof v === 'string')) return undefined;
      if (!validRow(r)) return undefined;
      if (seen[r.position]) return undefined;            // dos filas con la misma posición: no es una instantánea coherente
      seen[r.position] = 1;
      var row = {};
      Object.keys(r).forEach(function (k) { if (k !== FIELD_APPEARANCE) row[k] = r[k]; });
      out.push({ row: row, code: v || null });
    }
    return out;
  }

  // ---------- Transporte REAL (contrato de Supabase) ----------
  var RPC_SESSION = 'geo_vip_my_appearance_v1';
  var VIEW_RANKING = 'geo_vip_ranking_v1';
  var RANKING_COLUMNS = 'position,avatar_url,display_name,country_code,rank_code,rank_name,xp,appearance';
  var RANKING_LIMIT = 50;

  function unwrap(res) {
    if (!res || res.error) throw new Error('cosmetics: error del servidor');     // el módulo lo trata como "apariencia normal"
    return res.data;
  }
  var transport = {
    // Sesión: RPC SIN parámetros. ctx.uid existe solo para la caché local del módulo y NO se envía: el servidor identifica la cuenta por el JWT.
    session: function (ctx) {
      var c = ctx && ctx.client;
      if (!c || typeof c.rpc !== 'function') return Promise.reject(new Error('cosmetics: sin cliente'));
      return Promise.resolve(c.rpc(RPC_SESSION)).then(unwrap);
    },
    // Ranking: vista pública, columnas del contrato, orden por position ascendente, 50 filas. (ctx.plain, el respaldo, lo usa la página.)
    ranking: function (ctx) {
      var c = ctx && ctx.client;
      if (!c || typeof c.from !== 'function') return Promise.reject(new Error('cosmetics: sin cliente'));
      return Promise.resolve(c.from(VIEW_RANKING).select(RANKING_COLUMNS).order('position', { ascending: true }).limit(RANKING_LIMIT)).then(unwrap);
    }
  };

  window.GeoArmyCosmeticsAdapter = {
    contract: 'geo-vip-v1 (RPC geo_vip_my_appearance_v1 + vista geo_vip_ranking_v1)',
    FIELD_APPEARANCE: FIELD_APPEARANCE,
    parseSession: parseSession,
    parseRanking: parseRanking,
    transport: transport
  };
})();
