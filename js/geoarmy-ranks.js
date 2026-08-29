// ===== MI GEO ARMY — sistema de rangos (solo frontend/visual) =====
// Este archivo NO habla con Supabase. Es únicamente el mapeo estático
// rank_code -> nombre en español / archivo de insignia, para que el header
// compacto, el ranking y el perfil grande usen siempre el mismo mapa sin
// duplicar código.
//
// Los datos reales (xp, rank_code, position, progress_pct, etc.) siempre
// vienen de las funciones de Supabase ya existentes:
//   my_compact_profile() / my_rank_summary() / xp_leaderboard
// Este archivo NUNCA calcula XP ni porcentajes — solo traduce un rank_code
// a texto/imagen.
(function () {
  'use strict';

  // Orden y nombres oficiales (ver especificación del backend).
  var RANK_NAMES = {
    BRONZE_3:   'Bronce III',
    BRONZE_2:   'Bronce II',
    BRONZE_1:   'Bronce I',
    SILVER_3:   'Plata III',
    SILVER_2:   'Plata II',
    SILVER_1:   'Plata I',
    GOLD_3:     'Oro III',
    GOLD_2:     'Oro II',
    GOLD_1:     'Oro I',
    PLATINUM_3: 'Platino III',
    PLATINUM_2: 'Platino II',
    PLATINUM_1: 'Platino I',
    DIAMOND:    'Diamante',
    MASTER:     'Maestro',
    LEGENDARY:  'Legendario'
  };

  function rankName(code) {
    return RANK_NAMES[code] || code || '';
  }

  // Archivo de insignia esperado para cada rango. Todavía no existen los
  // archivos (el usuario los va a pasar más adelante) — por eso todo el
  // código que consume esto SIEMPRE agrega onerror="this.remove()" (o
  // equivalente) sobre el <img>, igual que ya se hace con gcoin-icon.png,
  // icon-fortnite.png, etc. Si el archivo no existe, el slot de insignia
  // simplemente desaparece en vez de mostrar un ícono roto.
  //
  // Convención de nombre: rank-badges/<rank_code en minúsculas>.png
  // Ej: BRONZE_3 -> rank-badges/bronze_3.png
  function rankBadgeUrl(code, siteBase) {
    if (!code) return null;
    var base = siteBase || '';
    return base + 'rank-badges/' + code.toLowerCase() + '.png';
  }

  // Imagen de bandera vía flagcdn.com — mismo servicio que ya usa
  // mi-geoarmy.html para el país del perfil (ver renderCountryDisplay /
  // flagImgUrl ahí). Se usa imagen en vez de emoji Unicode a propósito:
  // en Windows el emoji de bandera se renderiza como texto plano (ej. "MX")
  // en vez de la bandera, bug ya detectado en este mismo proyecto.
  function flagImgUrl(code, size) {
    if (!code) return null;
    return 'https://flagcdn.com/' + (size || '24x18') + '/' + code.toLowerCase() + '.png';
  }

  window.GeoArmyRanks = {
    names: RANK_NAMES,
    rankName: rankName,
    rankBadgeUrl: rankBadgeUrl,
    flagImgUrl: flagImgUrl
  };
})();
