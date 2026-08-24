// ===== CONFIG =====
const TWITCH_CLIENT_ID = '3spb0xbi38qc8ng1zwcoz5081lp524';
const BROADCASTER_LOGIN = 'geovannyrk';

// ===== TWITCH STATUS =====
const STREAM_STATUS_API = 'https://geoarmy.duckdns.org/api/stream-status';

async function fetchTwitchStatus() {
  try {
    // El backend consulta a Twitch por nosotros (sin exponer el client secret aquí)
    const streamRes = await fetch(STREAM_STATUS_API);
    const stream = await streamRes.json();

    const dot = document.querySelector('.live-dot');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const liveLabel = document.getElementById('live-label');
    const gameEl = document.getElementById('stream-game');
    const viewersEl = document.getElementById('stream-viewers');

    if (stream && stream.live) {
      // EN VIVO
      dot.classList.add('live');
      statusDot.classList.add('live');
      statusText.textContent = 'En vivo ahora';
      liveLabel.textContent = 'En vivo ahora';
      gameEl.textContent = '🎮 ' + stream.game_name;
      viewersEl.textContent = '👥 ' + stream.viewer_count.toLocaleString() + ' viewers';
    } else {
      // OFFLINE
      dot.classList.add('offline');
      statusDot.style.background = '#6b6b80';
      statusText.textContent = 'Sin conexión';
      liveLabel.textContent = 'Fuera de línea';
      gameEl.textContent = 'Próximo stream a las 7:00 PM';
      viewersEl.textContent = '';
    }
  } catch (err) {
    console.log('No se pudo obtener estado de Twitch:', err.message);
    document.getElementById('live-label').textContent = 'geovannyrk';
    document.getElementById('status-text').textContent = 'Ver en Twitch';
  }
}

// ===== COPY CODE =====
function copyCode() {
  navigator.clipboard.writeText('SORTEOSRK').then(() => {
    showToast();
    const arrow = document.getElementById('copy-arrow');
    if (arrow) {
      arrow.textContent = '✓';
      setTimeout(() => { arrow.textContent = '→'; }, 2000);
    }
  });
}

function showToast() {
  const toast = document.getElementById('toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  fetchTwitchStatus();
  // Actualizar estado de Twitch cada 2 minutos
  setInterval(fetchTwitchStatus, 120000);
});
