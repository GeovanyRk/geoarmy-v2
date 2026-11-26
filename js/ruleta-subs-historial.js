'use strict';

(() => {
  const estado = document.querySelector('#estado-ruleta');
  const aviso = document.querySelector('#aviso-suscripcion');
  const login = document.querySelector('#iniciar-sesion-ruleta');
  const lista = document.querySelector('#historial-ruleta');
  const account = window.GeoArmyAccount;
  if (!account) {
    estado.textContent = 'No se pudo cargar el historial.';
    return;
  }
  const fecha = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
  let version = 0;

  async function cargarSuscripcion(request) {
    let timer;
    try {
      const result = await Promise.race([
        account.client.rpc('geo_plus_my_access_v1'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 8000); })
      ]);
      if (request !== version) return;
      const access = result?.data;
      if (result?.error || typeof access?.access !== 'boolean' || typeof access.status !== 'string') throw new Error('subscription unavailable');
      if (access.access && access.status === 'active') return;
      aviso.textContent = ['none', 'ended'].includes(access.status)
        ? 'Aún no hemos confirmado una suscripción activa en esta cuenta. Se comprobará al canjear en Twitch.'
        : 'No pudimos comprobar tu suscripción en este momento. Se comprobará al canjear en Twitch.';
    } catch (_) {
      if (request !== version) return;
      aviso.textContent = 'No pudimos comprobar tu suscripción en este momento. Se comprobará al canjear en Twitch.';
    } finally {
      clearTimeout(timer);
    }
    if (request === version) aviso.hidden = false;
  }

  async function cargar() {
    const request = ++version;
    lista.replaceChildren();
    estado.textContent = 'Cargando tu historial…';
    if (aviso) {
      aviso.textContent = '';
      aviso.hidden = true;
    }
    const { data } = await account.client.auth.getSession();
    if (request !== version) return;
    login.hidden = Boolean(data?.session);
    if (!data?.session) {
      estado.textContent = 'Inicia sesión para ver tus tiradas y premios.';
      return;
    }
    if (aviso) void cargarSuscripcion(request);
    const result = await account.client.from('ruleta_subs_intentos')
      .select('id,game,drawn_at,guaranteed,prize,currency,wallet_tx,loss_streak')
      .order('draw_number', { ascending: false }).limit(100);
    if (request !== version) return;
    if (result.error) {
      estado.textContent = 'No se pudo cargar el historial. Vuelve a intentar.';
      return;
    }

    const tiradas = result.data;
    const faltan = 30 - (tiradas[0]?.loss_streak ?? 0);
    estado.textContent = faltan === 1 ? 'Tu próxima tirada tiene premio garantizado.'
      : `El premio está garantizado como máximo en ${faltan} tiradas.`;
    for (const row of tiradas) {
      const item = document.createElement('li');
      const nombre = row.game === 'fortnite' ? 'Fortnite' : 'Overwatch';
      const moneda = row.currency === 'VBUCKS' ? 'V-Bucks' : 'monedas de Overwatch';
      const premio = row.prize ? `${row.prize} ${moneda} · ${row.wallet_tx ? 'procesado en la billetera' : 'entrega pendiente'}` : 'Sin premio';
      item.textContent = `${fecha.format(new Date(row.drawn_at))} · ${nombre} · ${premio}${row.guaranteed ? ' · Garantizado' : ''}`;
      lista.append(item);
    }
  }

  login.addEventListener('click', () => account.signInWithTwitch(location.pathname));
  account.client.auth.onAuthStateChange(() => setTimeout(cargar, 0));
})();
