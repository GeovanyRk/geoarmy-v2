// =====================================================================
// SALÓN DE GANADORES — Geo Army.
// Única fuente de datos: la vista pública de Supabase `public_winners`
// (columnas: id, usuario, prize_label, currency_code, amount, event,
// won_at). NO se consulta winner_records ni ningún dato histórico.
// NO se usa ganadores.json ni service_role — solo la config pública
// (window.GEOARMY_SUPABASE_URL / GEOARMY_SUPABASE_ANON_KEY) que ya usa
// el resto del sitio, protegida por RLS del lado de Supabase.
//
// FOTOS DEL PODIO Y EL HISTORIAL (solo presentación): se leen de la vista pública
// gw_winner_avatars_v1 (winner_id -> avatar_url, puede ser null). Se
// relacionan SOLO por winner_id === public_winners.id (nunca por nombre),
// con consultas agrupadas. Si no hay foto, la imagen
// falla, la consulta no responde, o el mismo ganador tiene fotos distintas
// y no se puede saber cuál corresponde, se conserva la silueta y el resto
// de la página funciona igual. No altera podio, contador, historial ni buscador.
// =====================================================================
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Esta página tiene su PROPIO cliente de Supabase, igual que
  // ranking.html/misiones.html — misma URL/anon key públicas de
  // js/geoarmy-config.js, sin depender de window.GeoArmyAccount.
  function getGanadoresClient() {
    try {
      if (!window.supabase || !window.supabase.createClient) return null;
      if (!window.GEOARMY_SUPABASE_URL || !window.GEOARMY_SUPABASE_ANON_KEY) return null;
      return window.supabase.createClient(window.GEOARMY_SUPABASE_URL, window.GEOARMY_SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('[ganadores] no se pudo crear el cliente de Supabase', e);
      return null;
    }
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, ms);
      }),
    ]);
  }

  // Nombres visibles para los códigos de moneda internos -- nunca se le
  // muestra al usuario un código feo como "VBUCKS" u "OWCOINS".
  var CURRENCY_LABELS = { VBUCKS: 'V-Bucks', OWCOINS: 'OW Coins', PAYPAL_USD: 'USD', GCOIN: 'G-Coins' };

  function prizeLabel(row) {
    if (row.prize_label && String(row.prize_label).trim()) return String(row.prize_label).trim();
    var label = CURRENCY_LABELS[row.currency_code] || row.currency_code || '';
    var cantidad = typeof row.amount === 'number' ? row.amount.toLocaleString() : (row.amount != null ? row.amount : '');
    return (cantidad + ' ' + label).trim();
  }

  function fmtFecha(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // ===================================================================
  // PODIO -- se calcula 100% en el cliente a partir de public_winners:
  // 1) agrupar por usuario, 2) contar victorias, 3) ordenar de mayor a
  // menor, 4) en empate usar la victoria más reciente, 5) si sigue
  // empatado, ordenar por nombre. Nunca se suman montos de premios
  // (serían monedas distintas: V-Bucks, OW Coins, etc.) -- el podio es
  // solo por NÚMERO de victorias.
  // ===================================================================
  function computePodium(rows) {
    var mapa = {};
    rows.forEach(function (r) {
      var key = String(r.usuario || '').toLowerCase().trim();
      if (!key) return;
      if (!mapa[key]) mapa[key] = { usuario: r.usuario, count: 0, lastWonAt: 0 };
      mapa[key].count += 1;
      var t = r.won_at ? new Date(r.won_at).getTime() : 0;
      if (!isNaN(t) && t > mapa[key].lastWonAt) mapa[key].lastWonAt = t;
    });
    var lista = Object.keys(mapa).map(function (k) { return mapa[k]; });
    lista.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      if (b.lastWonAt !== a.lastWonAt) return b.lastWonAt - a.lastWonAt;
      return String(a.usuario).localeCompare(String(b.usuario));
    });
    return lista.slice(0, 3);
  }

  function renderPodium(top3) {
    var slots = [
      { el: $('gwSlot1'), rank: 1 },
      { el: $('gwSlot2'), rank: 2 },
      { el: $('gwSlot3'), rank: 3 },
    ];
    var totalGanadores = top3.length; // 0 solo cuando public_winners no tiene ningún registro
    slots.forEach(function (slot) {
      if (!slot.el) return;
      var data = top3[slot.rank - 1];
      var nameEl = slot.el.querySelector('.gw-slot-name');
      var countEl = slot.el.querySelector('.gw-slot-count');
      if (data) {
        nameEl.textContent = data.usuario;
        countEl.textContent = data.count + (data.count === 1 ? ' victoria' : ' victorias');
        slot.el.classList.remove('is-empty');
      } else {
        var esPodioTotalmenteVacio = totalGanadores === 0 && slot.rank === 1;
        nameEl.textContent = esPodioTotalmenteVacio ? 'EL PODIO TE ESPERA' : '—';
        countEl.textContent = '';
        slot.el.classList.add('is-empty');
      }
    });
    var nota = $('gwEmptyNote');
    if (nota) nota.hidden = totalGanadores !== 0;
  }

  function renderCounter(n) {
    var numEl = $('gwCounterNum');
    var labelEl = $('gwCounterLabel');
    if (numEl) numEl.textContent = n.toLocaleString();
    if (labelEl) labelEl.textContent = n === 1 ? 'PREMIO REGISTRADO' : 'PREMIOS REGISTRADOS';
  }

  var ALL_ROWS = [];
  // La clave es el id del premio, nunca el nombre visible del ganador.
  var HISTORY_AVATARS = Object.create(null);

  function renderHistory(rows) {
    var list = $('gwHistoryList');
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = '<div class="gw-empty-history">Sin resultados.</div>';
      return;
    }
    list.innerHTML = rows.map(function (r) {
      return (
        '<div class="gw-row">' +
          '<span class="gw-row-user">' +
            '<span class="gw-row-avatar" aria-hidden="true" data-winner-id="' + esc(r.id) + '"></span>' +
            '<span class="gw-row-name">' + esc(r.usuario || '') + '</span>' +
          '</span>' +
          '<span class="gw-row-prize">' + esc(prizeLabel(r)) + '</span>' +
          '<span class="gw-row-event">' + esc(r.event || 'General') + '</span>' +
          '<span class="gw-row-date">' + esc(fmtFecha(r.won_at)) + '</span>' +
        '</div>'
      );
    }).join('');
    pintarFotosHistorial();
  }

  // Filtro 100% del lado del cliente, sobre los mismos registros ya
  // cargados -- usuario, premio (ya formateado) y evento.
  function applyFiltro() {
    var input = $('gwSearch');
    var q = input ? input.value.trim().toLowerCase() : '';
    if (!q) { renderHistory(ALL_ROWS); return; }
    var filtradas = ALL_ROWS.filter(function (r) {
      var texto = ((r.usuario || '') + ' ' + prizeLabel(r) + ' ' + (r.event || '')).toLowerCase();
      return texto.indexOf(q) > -1;
    });
    renderHistory(filtradas);
  }

  function mostrarError() {
    var wrap = $('gwPodium'); if (wrap && wrap.parentElement) wrap.parentElement.hidden = true;
    var counter = $('gwCounter'); if (counter) counter.hidden = true;
    var nota = $('gwEmptyNote'); if (nota) nota.hidden = true;
    var historia = $('gwHistorySection'); if (historia) historia.hidden = true;
    var err = $('gwErrorBox'); if (err) err.hidden = false;
  }

  // ===================================================================
  // FOTOS DEL PODIO -- ver nota de cabecera. Nada de aquí puede romper la
  // página: cualquier fallo deja la silueta que ya trae el HTML.
  // ===================================================================
  var AVATAR_TIMEOUT_MS = 6000;

  // Misma clave de agrupación que computePodium (usuario en minúsculas, sin espacios).
  function groupKey(u) { return String(u || '').toLowerCase().trim(); }

  // Solo URLs https (nada de javascript:, data:, http:, etc.).
  function safeAvatarUrl(u) {
    if (typeof u !== 'string') return null;
    var t = u.trim();
    if (!t) return null;
    try { return new URL(t).protocol === 'https:' ? t : null; } catch (e) { return null; }
  }

  function setSlotPhoto(slotEl, url) {
    var holder = slotEl && slotEl.querySelector('.gw-slot-avatar');
    if (!holder) return;
    var img = new Image();
    img.className = 'gw-avatar-img';
    img.alt = ''; // decorativa: el nombre ya está en el texto del puesto
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    // La foto solo reemplaza a la silueta cuando YA cargó bien; si falla, no pasa nada.
    img.onload = function () {
      if (!img.naturalWidth) return;
      holder.appendChild(img);
      holder.classList.add('has-photo');
    };
    img.onerror = function () { /* se conserva la silueta */ };
    img.src = url;
  }

  // Adjuntar solo URLs validadas desde la vista; la silueta sigue visible
  // hasta que el navegador haya cargado correctamente cada imagen.
  function pintarFotosHistorial() {
    var list = $('gwHistoryList');
    if (!list) return;
    list.querySelectorAll('.gw-row-avatar').forEach(function (holder) {
      var url = HISTORY_AVATARS[holder.getAttribute('data-winner-id')];
      if (!url || holder.querySelector('img')) return;
      var img = document.createElement('img');
      img.className = 'gw-row-avatar-img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload = function () {
        if (img.naturalWidth) holder.classList.add('has-photo');
      };
      img.onerror = function () { /* se conserva la silueta */ };
      holder.appendChild(img);
      img.src = url;
    });
  }

  async function cargarFotosHistorial(sb, rows) {
    var vistos = Object.create(null);
    var ids = [];
    rows.forEach(function (r) {
      if (r.id == null || vistos[String(r.id)]) return;
      vistos[String(r.id)] = true;
      ids.push(r.id);
    });
    // Lotes acotados mantienen pequeñas las URLs de consulta y permiten
    // mostrar las fotos disponibles aunque falle otro lote.
    for (var i = 0; i < ids.length; i += 80) {
      try {
        var res = await withTimeout(
          sb.from('gw_winner_avatars_v1').select('winner_id, avatar_url').in('winner_id', ids.slice(i, i + 80)),
          AVATAR_TIMEOUT_MS
        );
        if (res.error) throw res.error;
        (res.data || []).forEach(function (a) {
          if (!a || a.winner_id == null) return;
          var url = safeAvatarUrl(a.avatar_url);
          if (url) HISTORY_AVATARS[String(a.winner_id)] = url;
        });
        // El buscador podría haber cambiado mientras llegaban las fotos.
        pintarFotosHistorial();
      } catch (e) {
        console.warn('[ganadores] no se pudieron cargar algunas fotos del historial; se conserva la silueta', e);
      }
    }
  }

  async function cargarFotosPodio(sb, rows, top3) {
    try {
      if (!top3.length) return;
      // Ids de premios (public_winners.id) de cada uno de los 3 grupos del podio.
      var idsPorGrupo = top3.map(function (g) {
        var k = groupKey(g.usuario);
        return rows
          .filter(function (r) { return r.id != null && groupKey(r.usuario) === k; })
          .map(function (r) { return r.id; });
      });
      var todos = [].concat.apply([], idsPorGrupo);
      if (!todos.length) return;

      // UNA sola consulta para los 3 puestos (no una por registro).
      var res = await withTimeout(
        sb.from('gw_winner_avatars_v1').select('winner_id, avatar_url').in('winner_id', todos),
        AVATAR_TIMEOUT_MS
      );
      if (res.error) throw res.error;
      var porId = {};
      (res.data || []).forEach(function (a) {
        if (a && a.winner_id != null) porId[String(a.winner_id)] = a.avatar_url;
      });

      top3.forEach(function (g, i) {
        var urls = [];
        idsPorGrupo[i].forEach(function (id) {
          var u = safeAvatarUrl(porId[String(id)]);
          if (u && urls.indexOf(u) === -1) urls.push(u);
        });
        if (urls.length === 1) {
          setSlotPhoto($('gwSlot' + (i + 1)), urls[0]); // top3[i] <-> gwSlot(i+1), igual que renderPodium
        } else if (urls.length > 1) {
          console.warn('[ganadores] "' + g.usuario + '" tiene ' + urls.length +
            ' fotos distintas entre sus premios; no se puede saber cuál corresponde, se conserva la silueta');
        }
      });
    } catch (e) {
      console.warn('[ganadores] no se pudieron cargar las fotos del podio; se conserva la silueta', e);
    }
  }

  async function cargar() {
    var sb = getGanadoresClient();
    if (!sb) {
      console.error('[ganadores] cliente de Supabase no disponible (falta config pública o el SDK)');
      mostrarError();
      return;
    }
    try {
      var res = await withTimeout(
        sb.from('public_winners')
          .select('id, usuario, prize_label, currency_code, amount, event, won_at')
          .order('won_at', { ascending: false }),
        12000
      );
      if (res.error) throw res.error;
      var rows = res.data || [];
      ALL_ROWS = rows;
      var top3 = computePodium(rows);
      renderPodium(top3);
      renderCounter(rows.length);
      renderHistory(rows);
      // Las fotos se piden DESPUÉS de pintar todo y sin bloquear nada.
      cargarFotosPodio(sb, rows, top3);
      cargarFotosHistorial(sb, rows);
    } catch (e) {
      console.error('[ganadores] error cargando public_winners', e);
      mostrarError();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var search = $('gwSearch');
    if (search) search.addEventListener('input', applyFiltro);
    cargar();
  });
})();
