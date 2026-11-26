'use strict';

(() => {
  const estado = document.querySelector('#estado-control');
  const entrar = document.querySelector('#entrar-control');
  const actualizar = document.querySelector('#actualizar-control');
  const cola = document.querySelector('#cola-control');
  const account = window.GeoArmyAccount;
  if (!account) { estado.textContent = 'No se pudo cargar Mi Geo Army.'; return; }

  async function api(ruta, token, body) {
    const response = await fetch('https://geoarmy.duckdns.org/api/ruleta-subs/' + ruta, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'El servicio no está disponible');
    return data;
  }

  let version = 0;
  async function cargar(mensaje) {
    const actual = ++version;
    cola.replaceChildren();
    const { data } = await account.client.auth.getSession();
    if (actual !== version) return;
    entrar.hidden = Boolean(data?.session);
    actualizar.hidden = !data?.session;
    if (!data?.session) { estado.textContent = 'Inicia sesión con tu cuenta de moderación.'; return; }
    try {
      const rows = await api('cola', data.session.access_token);
      if (actual !== version) return;
      estado.textContent = mensaje || (rows.length ? `${rows.length} canjes listos.` : 'La cola está vacía.');
      for (const row of rows) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `${row.game === 'fortnite' ? 'Fortnite' : 'Overwatch'} · ${row.viewer}`;
        const giro = document.createElement('button');
        giro.textContent = 'Girar';
        giro.addEventListener('click', async () => {
          giro.disabled = true;
          try {
            const { data: auth } = await account.client.auth.getSession();
            if (!auth?.session) throw new Error('Inicia sesión de nuevo');
            await api('girar', auth.session.access_token, { id: row.id });
            await cargar('Tirada confirmada. La fuente de OBS ya puede mostrarla.');
          } catch (error) {
            estado.textContent = error.message;
            giro.disabled = false;
          }
        });
        li.append(label, giro);
        cola.append(li);
      }
    } catch (error) {
      if (actual === version) estado.textContent = error.message;
    }
  }

  entrar.addEventListener('click', () => account.signInWithTwitch(location.pathname));
  actualizar.addEventListener('click', () => cargar());
  account.client.auth.onAuthStateChange(() => setTimeout(cargar, 0));
})();
