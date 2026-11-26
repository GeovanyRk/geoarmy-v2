/* GEO ARMY Plus — cableado del proveedor de piñatas con la sesión REAL del sitio.
   Archivo NUEVO: no sustituye ni modifica ninguna utilidad compartida (geoarmy-account.js, geoarmy-config.js, geoarmy-plus-daily.js…).
   Verificado contra js/geoarmy-account.js vigente: expone `window.GeoArmyAccount = { client: sb, … }`, donde `sb` es el cliente de Supabase de la barra de cuenta
   (misma instancia y misma sesión). Es el mismo patrón que ya usa js/geoarmy-plus-daily.js (GeoArmyAccount.client, con respaldo a supabase.createClient).
   Orden de carga (el mismo de plus.html / misiones.html), y ESTE archivo después de geoarmy-account.js y de pinata-provider.js, antes del script de pinatas.html:
     supabase.min.js → js/geoarmy-config.js → js/premium.js → js/geoarmy-ranks.js → js/geoarmy-account.js → js/pinata-provider.js → js/geoarmy-pinata-wiring.js → (script de la página)
   Necesita de geoarmy-config.js: GEOARMY_SUPABASE_URL y GEOARMY_SUPABASE_ANON_KEY (clave PÚBLICA). No lee ni envía perfiles: la cuenta sale del token de la sesión.
   Si falta cualquier pieza NO instala nada (la página muestra «Próximamente») y NO pisa un proveedor ya instalado. */
(function (root) {
  'use strict';
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function wire(win) {
    win = win || root;
    var P = win.GeoarmyPinataProvider;
    if (!P || typeof P.install !== 'function') return { installed: false, reason: 'provider_missing' };
    if (win.GEOARMY_PINATA_PROVIDER) return { installed: false, reason: 'already_installed' };            // no se pisa lo que ya hay
    var url = win.GEOARMY_SUPABASE_URL, key = win.GEOARMY_SUPABASE_ANON_KEY;
    if (typeof url !== 'string' || !url || typeof key !== 'string' || !key) return { installed: false, reason: 'config_missing' };
    var c = win.GeoArmyAccount && win.GeoArmyAccount.client;                                              // MISMA instancia/sesión que la barra de cuenta
    if (!c && win.supabase && typeof win.supabase.createClient === 'function') { try { c = win.supabase.createClient(url, key); } catch (e) { c = null; } }
    if (!c || !c.auth || typeof c.auth.getSession !== 'function') return { installed: false, reason: 'client_missing' };
    P.install({
      win: win,
      endpoint: String(url).replace(/\/+$/, '') + '/functions/v1/plus-pinata',
      anonKey: key,
      getSession: function () { return withTimeout(c.auth.getSession(), 8000).then(function (r) { return r && r.data && r.data.session; }); },
      // El callback de Supabase se ejecuta dentro de su bloqueo interno: no se llama al SDK desde ahí. Se avisa a la página DESPUÉS (setTimeout 0).
      onAuthChange: function (cb) {
        var sub = null;
        try {
          var r = c.auth.onAuthStateChange(function (event, session) { setTimeout(function () { try { cb(event, session); } catch (e) { /* ignorar */ } }, 0); });
          sub = r && r.data && r.data.subscription;
        } catch (e) { /* sin escucha: el proveedor igual compara la sesión en cada llamada */ }
        return function () { try { if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe(); } catch (e) { /* ignorar */ } };
      },
    });
    return { installed: true };
  }
  root.GeoarmyPinataWiring = { wire: wire };
  try { root.GeoarmyPinataWiring.result = wire(root); } catch (e) { root.GeoarmyPinataWiring.result = { installed: false, reason: 'error' }; }
})(typeof window !== 'undefined' ? window : this);
