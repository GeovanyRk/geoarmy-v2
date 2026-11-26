/* GEO ARMY Assistant 2.0: chat de IA pública con backend propio en VPS.
   Nunca contiene una API key. Aísla errores, protege la interfaz y evita HTML de la IA. */
(function () {
  'use strict';
  const ENDPOINT = 'https://geoarmy.duckdns.org/api/assistant';
  const launcher = document.getElementById('ga-guide-launcher');
  const panel = document.getElementById('ga-guide-panel');
  const feed = document.getElementById('ga-guide-feed');
  const close = document.getElementById('ga-guide-close');
  const form = document.getElementById('ga-guide-form');
  const input = document.getElementById('ga-guide-input');
  const sendButton = form?.querySelector('button[type="submit"]');
  const status = document.getElementById('ga-guide-subtitle');
  const nudge = document.getElementById('ga-guide-nudge');
  const nudgeOpen = document.getElementById('ga-guide-nudge-open');
  const nudgeDismiss = document.getElementById('ga-guide-nudge-dismiss');
  const nudgeMessage = document.getElementById('ga-guide-nudge-message');
  if (!launcher || !panel || !feed || !close || !form || !input || !sendButton) return;

  const quick = {
    horario: '¿A qué hora transmite Geovannyrk?',
    misiones: '¿Cómo funcionan las misiones de GEO ARMY?',
    puntos: '¿Cómo subo de rango y gano XP?',
    tienda: '¿Qué son los G-Coins y cómo se usan en la Tienda de GEO ARMY?',
    pavos: '¿Cómo puedo conseguir PaVos de Fortnite mediante las recompensas de la Tienda GEO ARMY?',
    comunidad: 'Soy nuevo, ¿cómo puedo unirme a GEO ARMY?'
  };
  const hints = {
    horario: ['Ver Twitch', 'https://www.twitch.tv/geovannyrk'],
    misiones: ['Ver Misiones', 'misiones.html'],
    puntos: ['Ver rangos', 'puntos.html'],
    tienda: ['Ir a Tienda', 'tienda.html'],
    pavos: ['Explorar la Tienda', 'tienda.html'],
    comunidad: ['Conocer la comunidad', 'comunidad.html']
  };
  const defaultReply = 'El asistente no pudo responder ahora. Puedes consultar Misiones, Puntos, Tienda o Comunidad desde esta página.';
  const history = [];
  let initialized = false;
  let busy = false;
  let lastSent = 0;
  const NUDGE_LAST_KEY = 'geoarmy:geovany-nudge-last-v1';
  const NUDGE_OPENED_KEY = 'geoarmy:geovany-chat-opened-v1';
  const NUDGE_DELAY_MS = 12000;
  const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const nudgeLines = [
    '¿Sabes cómo conseguir PaVos de Fortnite?',
    '¿No sabes para qué sirven los G-Coins?',
    '¿Necesitas ayuda con la Tienda de GEO ARMY?'
  ];
  let nudgeWasAttempted = false;

  function hideNudge() {
    if (nudge) nudge.hidden = true;
  }
  function storeValue(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* sin almacenamiento */ }
  }
  function maybeShowNudge() {
    if (nudgeWasAttempted || !nudge || !panel.hidden || document.visibilityState !== 'visible') return;
    // No competir con el popup de reclutamiento que aparece a los 5 segundos.
    const welcome = document.getElementById('gaWelcomeDialog');
    if (welcome?.open) return;
    nudgeWasAttempted = true;
    try {
      if (localStorage.getItem(NUDGE_OPENED_KEY) === '1') return;
      const last = Number(localStorage.getItem(NUDGE_LAST_KEY) || 0);
      if (last && Date.now() - last < NUDGE_COOLDOWN_MS) return;
      if (nudgeMessage) {
        const day = Math.floor(Date.now() / NUDGE_COOLDOWN_MS);
        nudgeMessage.textContent = nudgeLines[day % nudgeLines.length];
      }
      localStorage.setItem(NUDGE_LAST_KEY, String(Date.now()));
      nudge.hidden = false;
    } catch (_) { /* Si localStorage no está disponible, no mostramos avisos */ }
  }

  // Vuelve enlaces https en texto clicable sin interpretar HTML del modelo.
  function appendSafeText(target, value) {
    const parts = String(value).split(/(https:\/\/[^\s<>"']+)/g);
    for (const part of parts) {
      let u;
      try { u = new URL(part.replace(/[),.;!?]+$/, '')); } catch (_) { /* texto */ }
      if (u && u.protocol === 'https:' && ['geoarmy.tv','www.geoarmy.tv','www.twitch.tv','twitch.tv'].includes(u.hostname)) {
        const link = document.createElement('a');
        link.href = u.href;
        link.textContent = u.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        target.appendChild(link);
        const tail = part.slice(u.href.length);
        if (tail) target.appendChild(document.createTextNode(tail));
      } else {
        target.appendChild(document.createTextNode(part));
      }
    }
  }
  function bubble(message, user, link) {
    const el = document.createElement('div');
    el.className = 'ga-guide-bubble' + (user ? ' ga-guide-bubble--user' : '');
    appendSafeText(el, message);
    if (link) {
      el.appendChild(document.createElement('br'));
      const a = document.createElement('a');
      a.href = link[1]; a.textContent = link[0] + ' ↗';
      if (/^https:\/\//.test(link[1])) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      el.appendChild(a);
    }
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
    return el;
  }
  function setBusy(state) {
    busy = state;
    input.disabled = state;
    sendButton.disabled = state;
    panel.querySelectorAll('[data-ga-guide-topic]').forEach(b => b.disabled = state);
    sendButton.setAttribute('aria-busy', String(state));
  }
  function openPanel() {
    hideNudge();
    storeValue(NUDGE_OPENED_KEY, '1');
    launcher.hidden = true;
    panel.hidden = false;
    launcher.setAttribute('aria-expanded','true');
    if (!initialized) {
      initialized = true;
      bubble('¡Qué onda! 👋 Soy el asistente con IA de Geovany, tu streamer. Estoy aquí para ayudarte con GEO ARMY.', false);
      bubble('🪙 Los G-Coins son la moneda del canal. Con ellos puedes conseguir recompensas en la Tienda, según los artículos y requisitos disponibles.', false);
      bubble('🎮 ¿Quieres saber cómo ganar G-Coins, conseguir PaVos de Fortnite o completar misiones? ¡Pregúntame!', false);
    }
    input.focus({preventScroll:true});
  }
  function closePanel() {
    panel.hidden = true; launcher.hidden = false;
    launcher.setAttribute('aria-expanded','false');
    launcher.focus({preventScroll:true});
  }
  async function ask(message, key) {
    const q = String(message || '').trim().slice(0, 280);
    if (!q || busy) return;
    const remaining = 8100 - (Date.now() - lastSent);
    if (lastSent && remaining > 0) {
      bubble('Espera unos segundos antes de enviar otra pregunta.',false);
      return;
    }
    bubble(q, true);
    input.value = '';
    const prior = history.slice(-4);
    lastSent = Date.now();
    setBusy(true);
    const loading = bubble('Escribiendo respuesta…', false);
    loading.setAttribute('aria-label', 'Consultando asistente de IA');
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 28000);
      let resp;
      try {
        resp = await fetch(ENDPOINT, {
          method: 'POST', mode: 'cors', cache: 'no-store', credentials: 'omit',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({message: q, history: prior}),
          signal: controller.signal
        });
      } finally { window.clearTimeout(timer); }
      let data = {};
      try { data = await resp.json(); } catch (_) {}
      loading.remove();
      if (resp.status === 429) {
        bubble(data.mode === 'budget' ? 'El asistente alcanzó su presupuesto de IA por ahora. Consulta nuestras páginas oficiales.' : 'Has enviado muchos mensajes. Intenta de nuevo más tarde.', false, key ? hints[key] : undefined);
      } else if (!resp.ok || typeof data.reply !== 'string' || !data.reply.trim()) {
        bubble(typeof data.reply === 'string' && data.reply ? data.reply : defaultReply, false, key ? hints[key] : undefined);
      } else {
        bubble(data.reply.slice(0, 2200), false, key ? hints[key] : undefined);
        if (data.mode === 'ai') {
          history.push({role:'user',content:q.slice(0,400)});
          history.push({role:'assistant',content:data.reply.slice(0,400)});
          while (history.length > 4) history.shift();
        }
      }
    } catch (_) {
      loading.remove();
      bubble('No hay conexión con la IA en este momento. Revisa tu conexión o inténtalo más tarde.', false, key ? hints[key] : undefined);
    } finally {
      setBusy(false);
      if (!panel.hidden) input.focus({preventScroll:true});
    }
  }
  launcher.addEventListener('click',openPanel);
  if (nudgeOpen) nudgeOpen.addEventListener('click', openPanel);
  if (nudgeDismiss) nudgeDismiss.addEventListener('click', hideNudge);
  window.setTimeout(maybeShowNudge, NUDGE_DELAY_MS);
  close.addEventListener('click',closePanel);
  panel.addEventListener('keydown',e=>{ if(e.key==='Escape'){e.preventDefault();closePanel();} });
  document.querySelectorAll('[data-ga-guide-topic]').forEach(b => b.addEventListener('click', () => {
    const k = b.getAttribute('data-ga-guide-topic');
    ask(quick[k] || b.textContent.trim(), k);
  }));
  form.addEventListener('submit', e => {e.preventDefault();ask(input.value);});
  if (status) status.innerHTML = '<span class="ga-guide-dot" aria-hidden="true"></span> Asistente virtual con IA';
})();
