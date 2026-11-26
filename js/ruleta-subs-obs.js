'use strict';

if (new URLSearchParams(location.search).get('demo') !== '1') {
  const endpoint = 'https://geoarmy.duckdns.org/api/ruleta-subs/obs';
  const key = new URLSearchParams(location.hash.slice(1)).get('cola');
  const claim = key && crypto.randomUUID();
  const completed = new Set();
  let active;
  let timer;

  async function cola(id) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim, id }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  }

  async function actualizarCola() {
    const overlay = window.GeoArmyRuletaOBS;
    if (active?.complete) {
      const response = await cola(active.id);
      if (response.ok || response.status === 409) active = undefined;
      return;
    }
    if (!active && !overlay.isVisible()) return;
    const response = await cola();
    if (!response.ok) return;
    const event = await response.json();
    if (!event || active || !overlay.isVisible()) return;
    const pending = { id: event.id, complete: false };
    active = pending;
    if (completed.has(event.id)) {
      pending.complete = true;
    } else if (!overlay.showConfirmed(event, shown => {
      if (shown) {
        completed.add(event.id);
        pending.complete = true;
      } else if (active === pending) active = undefined;
    })) active = undefined;
  }
  let fetching = false;

  async function actualizarRuleta() {
    if (fetching) return;
    fetching = true;
    try {
      if (key) return await actualizarCola();
      const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const eventos = await response.json();
        if (Array.isArray(eventos)) {
          for (const evento of eventos) window.GeoArmyRuletaOBS.showConfirmed(evento);
        }
      }
    } catch {
      // Mantener transparente la fuente si el servicio aún no está disponible.
    } finally {
      fetching = false;
      clearTimeout(timer);
      timer = setTimeout(actualizarRuleta, 1500);
    }
  }

  window.addEventListener('obsSourceVisibleChanged', event => {
    if (event.detail?.visible && !fetching) {
      clearTimeout(timer);
      void actualizarRuleta();
    }
  });
  actualizarRuleta();
}
