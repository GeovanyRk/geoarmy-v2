'use strict';

if (new URLSearchParams(location.search).get('demo') !== '1') {
  const endpoint = 'https://geoarmy.duckdns.org/api/ruleta-subs/obs';
  const key = new URLSearchParams(location.hash.slice(1)).get('cola');
  const claim = key && crypto.randomUUID();
  const autoRequested = new URLSearchParams(location.hash.slice(1)).get('auto') === '1';
  const autoScene = window.GeoArmyAutoScene;
  const completed = new Set();
  let active;
  let timer;
  let sceneReturning = null;

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
    if (sceneReturning) {
      const returning = sceneReturning;
      await returning;
      if (sceneReturning === returning) sceneReturning = null;
    }
    if (active?.complete) {
      const response = await cola(active.id);
      if (response.ok || response.status === 409) active = undefined;
      return;
    }
    // Dejar terminar el sonido de premio en la escena anterior antes de
    // iniciar otro canje; la confirmación de la tirada ya no espera al audio.
    if (!active && overlay.isWinAudioTailPlaying()) return;
    // En modo automático la fuente debe vigilar la cola aunque la escena
    // Sub todavía no esté activa: el resultado confirmado inicia el cambio.
    if (!active && !overlay.isVisible() && !autoRequested) return;
    if (!active && autoRequested && !autoScene?.enabled) { overlay.setAutoStatus('No se pudo cargar el control de escenas.'); return; }
    if (!active && autoScene?.enabled && !(await autoScene.check())) return;
    const response = await cola();
    if (!response.ok) {
      if (autoScene?.enabled && response.status === 401) overlay.setAutoStatus('Revisa la clave privada de la ruleta en OBS.');
      return;
    }
    const event = await response.json();
    if (!event || active || (!overlay.isVisible() && !autoRequested)) return;
    if (autoRequested && !overlay.isValid(event)) { overlay.setAutoStatus('No se pudo interpretar la tirada.'); return; }
    const pending = { id: event.id, complete: false };
    active = pending;
    if (completed.has(event.id)) {
      pending.complete = true;
    } else {
      let sceneToken = null;
      if (autoScene?.enabled) {
        sceneToken = await autoScene.enter();
        if (!sceneToken) { active = undefined; return; }
      }
      if (!overlay.showConfirmed(event, shown => {
        if (shown) {
          completed.add(event.id);
          pending.complete = true;
        } else if (active === pending) {
          active = undefined;
          if (autoRequested) autoScene.block('No se pudo reproducir la animación. Actualiza la fuente.');
        }
        if (sceneToken) sceneReturning = autoScene.back(sceneToken).catch(() => false);
      })) {
        if (active === pending) active = undefined;
        if (autoRequested) autoScene.block('No se pudo iniciar la animación. Actualiza la fuente.');
        if (sceneToken) await autoScene.back(sceneToken);
      }
    }
  }
  let fetching = false;

  async function actualizarRuleta() {
    if (fetching) return;
    fetching = true;
    try {
      if (key) return await actualizarCola();
      if (autoRequested) { window.GeoArmyRuletaOBS.setAutoStatus('Falta la clave privada de la ruleta en OBS.'); return; }
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
