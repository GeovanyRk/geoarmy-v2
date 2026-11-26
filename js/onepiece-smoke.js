/* GEO ARMY — Diagnóstico no comercial (un solo despliegue).
 * Activo SOLO con ?opdiag=1 en onepiece.html, requiere sesión.
 * La única llamada HTTP de escritura es un POST intencionalmente inválido:
 * {profile_id:"invalid-test-field"}; el pipeline rechaza el cuerpo antes de
 * ejecutar límites de negocio o RPCs. Nunca envía solicitudes de compra/respuesta válidas.
 * No muestra ni guarda token, identificador de usuario, saldos ni respuestas.
 */
(function () {
  'use strict';
  try { if (new URLSearchParams(window.location.search).get('opdiag') !== '1') return; }
  catch (err) { return; }
  var panel, body, rows = [], working = false;
  function mk(tag, cls, text) {
    var e = document.createElement(tag); if (cls) e.className=cls;
    if (typeof text === 'string') e.textContent=text; return e;
  }
  function add(label, ok, detail) {
    rows.push({ test:label, result:ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP', detail:detail||'' });
    var li=mk('li','', (ok===true?'✓ ':ok===false?'✗ ':'– ')+label+(detail?' — '+detail:''));
    li.style.cssText='border-top:1px solid #604a2b;padding:8px 0;color:'+(ok===true?'#a9dfbb':ok===false?'#ffd2b5':'#cfc6ae');
    body.appendChild(li);
  }
  function withLimit(p,ms) {
    return Promise.race([Promise.resolve(p),new Promise(function(_,rej){setTimeout(function(){rej(new Error('timeout'));},ms);})]);
  }
  function sleep(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  async function clientReady() {
    for (var i=0;i<40;i++) {
      var c=window.GeoArmyAccount && window.GeoArmyAccount.client;
      if(c && c.auth && typeof c.auth.getSession==='function' && typeof c.rpc==='function')return c;
      await sleep(150);
    }
    return null;
  }
  async function read(client,name,judge,label) {
    try {
      var result=await withLimit(client.rpc(name),9500);
      if(result.error) {add(label,false,'RPC rechazada');return;}
      add(label,judge(result.data),'Respuesta leída sin escribir datos');
    } catch(err) {add(label,false,'Tiempo de espera o error de conexión');}
  }
  async function authProbe(url,token,label) {
    // El servidor rechaza esta petición *después de validar Auth* pero
    // *antes de cualquier operación comercial o progreso de misiones*.
    var ctl=typeof AbortController==='function'?new AbortController():null;
    var tm=setTimeout(function(){if(ctl)ctl.abort();},10000);
    try{
      var r=await fetch(url,{method:'POST',mode:'cors',cache:'no-store',credentials:'omit',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:JSON.stringify({profile_id:'invalid-test-field'}),
        signal:ctl?ctl.signal:undefined});
      var data=await r.json();
      add(label,r.status===400 && !!data && data.ok===false && data.error==='invalid_request',
        'HTTP '+r.status+' · cuerpo inválido rechazado');
    } catch(err) {add(label,false,'No se completó la petición HTTP / CORS');}
    finally {clearTimeout(tm);}
  }
  async function start() {
    if(working)return;working=true;body.textContent='';rows=[];
    add('Modo seguro',!!document.getElementById('opRoot') &&
      document.getElementById('opRoot').getAttribute('data-op-purchase')==='on' &&
      document.getElementById('opRoot').getAttribute('data-op-answers')==='on',
      'Frontend listo; Supabase controla si se habilitan las operaciones');
    var client=await clientReady();
    if(!client){add('Cliente Supabase',false,'No está disponible GeoArmyAccount.client');working=false;return;}
    add('Cliente Supabase',true,'Cliente original del sitio');
    var sess;
    try{var r=await withLimit(client.auth.getSession(),8500);sess=r&&r.data&&r.data.session;}catch(err){}
    if(!sess || !sess.access_token){add('Sesión Twitch/Supabase',null,'Inicia sesión desde la web y recarga');working=false;return;}
    add('Sesión Twitch/Supabase',true,'Sesión disponible; token oculto');
    await read(client,'onepiece_2026_my_access',function(d){return d && typeof d.has_access==='boolean';},'Acceso al Mini Pase');
    await read(client,'onepiece_2026_get_my_progress',function(d){return d && typeof d.has_access==='boolean' && d.authenticated===true;},'Progreso del jugador');
    await read(client,'onepiece_2026_get_mission_catalog',function(d){return d&&typeof d.has_access==='boolean' && Array.isArray(d.chapters);},'Catálogo protegido');
    await read(client,'onepiece_2026_get_purchase_offer',function(d){return d && typeof d.available==='boolean';},'Estado de oferta desde Supabase');
    var origin=window.GEOARMY_SUPABASE_URL || client.supabaseUrl;
    if(typeof origin!=='string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin)){
      add('Origen de funciones',false,'Configuración Supabase no reconocida');working=false;return;
    }
    await authProbe(origin+'/functions/v1/onepiece-submit-answer',sess.access_token,'HTTP autenticado: respuestas');
    await authProbe(origin+'/functions/v1/onepiece-purchase',sess.access_token,'HTTP autenticado: compras');
    working=false;
    var ok=rows.filter(function(x){return x.result==='PASS';}).length;
    var failed=rows.filter(function(x){return x.result==='FAIL';}).length;
    var sum=mk('p','', 'Resultado: '+ok+' correctas, '+failed+' fallidas. Ninguna compra ni XP enviados.');
    sum.style.cssText='font-weight:700;color:#f5d58a'; body.appendChild(sum);
  }
  function init(){
    panel=mk('section','',''); panel.id='opDiag7g';panel.setAttribute('aria-label','Diagnóstico seguro One Piece');
    panel.style.cssText='box-sizing:border-box;position:fixed;z-index:99999;right:12px;bottom:12px;max-height:80vh;overflow:auto;width:min(390px,calc(100vw - 24px));padding:16px;background:#131922;color:#f7e6c5;font:14px/1.4 Arial,sans-serif;border:2px solid #caa050;border-radius:12px;box-shadow:0 14px 48px #000b';
    var head=mk('div','', 'ONE PIECE · Diagnóstico de conexión');head.style.cssText='font-weight:800;font-size:16px;padding-right:28px;color:#f7d887';panel.appendChild(head);
    var desc=mk('p','','Solo lectura + dos POST inválidos para comprobar Auth/CORS. No compra ni responde misiones.');desc.style.cssText='font-size:12px;margin:8px 0';panel.appendChild(desc);
    var close=mk('button','','×');close.setAttribute('aria-label','Cerrar diagnóstico');close.type='button';close.style.cssText='position:absolute;right:9px;top:7px;background:transparent;color:#fff;border:0;font-size:24px;cursor:pointer';close.addEventListener('click',function(){panel.remove();});panel.appendChild(close);
    body=mk('ul','','');body.style.cssText='padding:0;margin:4px 0;list-style:none;';panel.appendChild(body);
    var retry=mk('button','','Repetir comprobación');retry.type='button';retry.style.cssText='border:1px solid #d6b366;background:#34291e;color:#ffe2a5;padding:8px 12px;border-radius:7px;cursor:pointer';retry.addEventListener('click',start);panel.appendChild(retry);
    document.body.appendChild(panel);start();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
