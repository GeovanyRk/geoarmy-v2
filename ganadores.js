// =====================================================================
// SALÓN DE GANADORES — Geo Army.
// Única fuente de datos: la vista pública de Supabase `public_winners`
// (columnas: id, usuario, prize_label, currency_code, amount, event,
// won_at). NO se consulta winner_records ni ningún dato histórico.
// NO se usa ganadores.json ni service_role — solo la config pública
// (window.GEOARMY_SUPABASE_URL / GEOARMY_SUPABASE_ANON_KEY) que ya usa
// el resto del sitio, protegida por RLS del lado de Supabase.
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
          '<span class="gw-row-user">' + esc(r.usuario || '') + '</span>' +
          '<span class="gw-row-prize">' + esc(prizeLabel(r)) + '</span>' +
          '<span class="gw-row-event">' + esc(r.event || 'General') + '</span>' +
          '<span class="gw-row-date">' + esc(fmtFecha(r.won_at)) + '</span>' +
        '</div>'
      );
    }).join('');
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
      renderPodium(computePodium(rows));
      renderCounter(rows.length);
      renderHistory(rows);
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
