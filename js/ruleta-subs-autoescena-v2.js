'use strict';

// El cambio de escena es optativo y solo actúa dentro de OBS.
(() => {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const preview = query.get('demo') === '1';
  const options = preview ? query : fragment;
  const enabled = options.get('auto') === '1';
  const target = (options.get('escena') || 'Sub').trim();
  let blocked = false;

  function status(message) {
    window.GeoArmyRuletaOBS?.setAutoStatus(message || '');
  }
  function block(message) {
    blocked = true;
    status(message);
  }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function obsCall(name) {
    return new Promise((resolve, reject) => {
      const obs = window.obsstudio;
      if (!obs || typeof obs[name] !== 'function') return reject(new Error('OBS no disponible'));
      let complete = false;
      const timer = setTimeout(() => {
        if (!complete) { complete = true; reject(new Error('OBS no respondió')); }
      }, 2000);
      try {
        obs[name](value => {
          if (complete) return;
          complete = true; clearTimeout(timer); resolve(value);
        });
      } catch (error) {
        if (!complete) { complete = true; clearTimeout(timer); reject(error); }
      }
    });
  }

  async function check() {
    if (!enabled || blocked) return !enabled;
    const obs = window.obsstudio;
    if (!obs || typeof obs.setCurrentScene !== 'function') {
      status('Abre esta fuente en OBS para activar el cambio de escena.');
      return false;
    }
    try {
      const level = await obsCall('getControlLevel');
      if (typeof level !== 'number' || level < 4) {
        status('En Propiedades, activa el acceso avanzado a OBS.');
        return false;
      }
      const scenes = await obsCall('getScenes');
      if (!Array.isArray(scenes) || !scenes.includes(target)) {
        status(`Crea en OBS la escena «${target}».`);
        return false;
      }
      const current = await obsCall('getCurrentScene');
      if (!current || typeof current.name !== 'string' || !current.name) {
        status('No se pudo comprobar la escena actual de OBS.');
        return false;
      }
      status('');
      return true;
    } catch {
      status('No se pudo conectar con el control de escenas de OBS.');
      return false;
    }
  }

  async function back(token) {
    if (!token?.switched || !token.previous) return false;
    try {
      const current = await obsCall('getCurrentScene');
      if (current?.name !== target) return false; // Respetar un cambio manual.
      const scenes = await obsCall('getScenes');
      if (!Array.isArray(scenes) || !scenes.includes(token.previous)) return false;
      window.obsstudio.setCurrentScene(token.previous);
      for (let i = 0; i < 20; i++) {
        await wait(150);
        const next = await obsCall('getCurrentScene');
        if (next?.name === token.previous) {
          await wait(900);
          return true;
        }
        if (next?.name && next.name !== target) return false;
      }
      return false;
    } catch { return false; }
  }

  async function enter() {
    if (!enabled || !(await check())) return null;
    let token;
    try {
      const current = await obsCall('getCurrentScene');
      if (!current?.name) return null;
      token = { previous: current.name, switched: current.name !== target };
      if (token.switched) {
        window.obsstudio.setCurrentScene(target);
        let arrived = false;
        for (let i = 0; i < 20; i++) {
          await wait(150);
          const next = await obsCall('getCurrentScene');
          if (next?.name === target) { arrived = true; break; }
          if (next?.name && next.name !== token.previous) return null;
        }
        if (!arrived) {
          blocked = true;
          status('No se pudo cambiar a la escena de la ruleta.');
          return null;
        }
        // Dejar terminar la transición habitual antes de reproducir.
        await wait(900);
      }
      const latest = await obsCall('getCurrentScene');
      if (latest?.name !== target) return null;
      // El aviso de visibilidad de la fuente puede llegar después del cambio
      // de escena, especialmente con transiciones y fuentes en segundo plano.
      for (let i = 0; i < 30 && !window.GeoArmyRuletaOBS?.isVisible(); i++) {
        await wait(150);
        const duringWait = await obsCall('getCurrentScene');
        if (duringWait?.name !== target) return null;
      }
      if (!window.GeoArmyRuletaOBS?.isVisible()) {
        blocked = true;
        await back(token);
        status(`Agrega esta fuente también a la escena «${target}» y actualízala.`);
        return null;
      }
      status('');
      return token;
    } catch {
      if (token) await back(token);
      status('No se pudo cambiar de escena en OBS.');
      return null;
    }
  }

  window.GeoArmyAutoScene = Object.freeze({ enabled, target, check, enter, back, block });
})();
