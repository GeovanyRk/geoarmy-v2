/* GEO ARMY · Año Nuevo 2027. Solo lectura. Reutiliza el RPC de Navidad
   únicamente para los códigos de país y la hora oficial. Sus horas de
   llegada de Santa NO se usan en este evento. */
(function(){
  'use strict';
  if(!window.GeoArmySeason || window.GeoArmySeason.id!=='ano-nuevo-2027')return;
  var doc=document, account=window.GeoArmyAccount, fx=window.GeoArmyNewYearFX;
  var panel=doc.getElementById('gaNyWorld'), count=doc.getElementById('gaNyWorldCount'),
      next=doc.getElementById('gaNyWorldNext'), note=doc.getElementById('gaNyWorldNote'),
      list=doc.getElementById('gaNyWorldList'), personal=doc.getElementById('gaNyPersonal'),
      personalText=doc.getElementById('gaNyPersonalText'), demo=doc.getElementById('gaNyDemo');
  if(!panel || !account || !account.client || !fx)return;
  var sb=account.client, anchor=null, anchorAt=0, groups=[], countries=[], unknown=[],
      me=null, syncing=false, generation=0, lastSignature='', handled=new Set(), greeted=new Set();
  var NY=Date.parse('2027-01-01T00:00:00-05:00'), END=Date.parse('2027-01-02T12:00:00Z');
  var zones={
    AR:'America/Argentina/Buenos_Aires',CO:'America/Bogota',CR:'America/Costa_Rica',
    DO:'America/Santo_Domingo',EC:'America/Guayaquil',ES:'Europe/Madrid',
    GT:'America/Guatemala',KR:'Asia/Seoul',MX:'America/Mexico_City',
    PA:'America/Panama',PE:'America/Lima',SV:'America/El_Salvador',
    UY:'America/Montevideo',VE:'America/Caracas',US:'America/New_York',
    CA:'America/Toronto',CL:'America/Santiago',BO:'America/La_Paz',
    PY:'America/Asuncion',BR:'America/Sao_Paulo',HN:'America/Tegucigalpa',
    NI:'America/Managua',CU:'America/Havana',PR:'America/Puerto_Rico',
    AU:'Australia/Canberra',JP:'Asia/Tokyo',FR:'Europe/Paris',
    GB:'Europe/London',DE:'Europe/Berlin',IT:'Europe/Rome',PT:'Europe/Lisbon'
  };
  var names={AR:'Argentina',CO:'Colombia',CR:'Costa Rica',DO:'República Dominicana',
    EC:'Ecuador',ES:'España',GT:'Guatemala',KR:'Corea del Sur',MX:'México',
    PA:'Panamá',PE:'Perú',SV:'El Salvador',UY:'Uruguay',VE:'Venezuela',UM:'Islas menores de EE. UU.'};
  var displayNames=null;
  try{displayNames=new Intl.DisplayNames(['es'],{type:'region'});}catch(e){}
  function name(code){try{return names[code]||(displayNames&&displayNames.of(code))||code;}catch(e){return code;}}
  function flag(code){var img=doc.createElement('img');img.alt=name(code);img.width=24;img.height=18;
    img.src='https://flagcdn.com/48x36/'+code.toLowerCase()+'.png';
    img.addEventListener('error',function(){img.remove();});return img;}
  function midnight(zone){
    // Convierte medianoche local a UTC con las reglas IANA para esa fecha,
    // sin fijar manualmente offsets ni usar la zona del visitante.
    var wanted=Date.UTC(2027,0,1), candidate=wanted;
    var fmt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    for(var i=0;i<3;i++){
      var p={};fmt.formatToParts(new Date(candidate)).forEach(function(x){if(x.type!=='literal')p[x.type]=+x.value;});
      var wall=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
      candidate+=wanted-wall;
    }
    return candidate;
  }
  function now(){return anchor===null?null:anchor+performance.now()-anchorAt;}
  function fmt(ms){var s=Math.max(0,Math.ceil(ms/1000));var d=Math.floor(s/86400);s%=86400;var h=Math.floor(s/3600),m=Math.floor(s/60)%60;
    return (d?d+'d ':'')+[h,m,s%60].map(function(x){return String(x).padStart(2,'0');}).join(':');}
  function key(k){return 'geoarmy:ny2027:'+k;}
  function seen(k,mem){if(mem.has(k))return true;try{return localStorage.getItem(key(k))==='1';}catch(e){return false;}}
  function remember(k,mem){mem.add(k);try{localStorage.setItem(key(k),'1');}catch(e){}}
  function rebuild(codes){
    var map=new Map();countries=[];unknown=[];
    codes.forEach(function(code){
      if(!zones[code]){unknown.push(code);return;}
      try{
        var at=midnight(zones[code]), row={code:code,at:at};
        countries.push(row);if(!map.has(at))map.set(at,[]);map.get(at).push(code);
      }catch(e){unknown.push(code);}
    });
    countries.sort(function(a,b){return a.at-b.at||name(a.code).localeCompare(name(b.code),'es');});
    groups=Array.from(map,function(entry){return {at:entry[0],codes:entry[1].sort(function(a,b){return name(a).localeCompare(name(b),'es');})};}).sort(function(a,b){return a.at-b.at;});
    lastSignature='';
  }
  function join(codes){var ns=codes.map(name);return ns.length>1?ns.slice(0,-1).join(', ')+' y '+ns[ns.length-1]:ns[0]||'';}
  function myTime(){
    if(!me)return null;
    if(me.country && zones[me.country])try{return midnight(zones[me.country]);}catch(e){}
    // Sin referencia de capital válida: celebración general ET.
    return NY;
  }
  function render(t){
    var done=countries.filter(function(c){return c.at<=t;}).length;
    var group=groups.find(function(g){return g.at>t;});
    count.textContent=done+' de '+countries.length+' países';
    next.textContent=group?'Próxima celebración: '+join(group.codes)+' · '+fmt(group.at-t):countries.length?'¡Todos los países con horario confirmado ya están en 2027!':'Sin países con horario confirmado.';
    note.textContent='Hora oficial del servidor · Referencia: hora de la capital'+(unknown.length?' · Sin horario único/confirmado: '+unknown.map(name).join(', '):'');
    var sig=countries.map(function(c){return c.code+':'+(c.at<=t?1:0);}).join(',')+'|'+unknown.join(',');
    if(sig!==lastSignature){
      lastSignature=sig;list.replaceChildren();
      countries.forEach(function(c){var item=doc.createElement('li');item.appendChild(flag(c.code));var label=doc.createElement('span');label.textContent=name(c.code);item.appendChild(label);
        var status=doc.createElement('small');status.textContent=c.at<=t?'2027':'Pendiente';if(c.at<=t)item.classList.add('is-done');item.appendChild(status);list.appendChild(item);});
    }
    var mt=myTime();personal.hidden=!(me && mt!==null && t>=mt && t<END);
    if(!personal.hidden)personalText.textContent='¡Feliz Año Nuevo, '+me.name+'! Gracias por ser parte de GEO ARMY. Que 2027 esté lleno de nuevas metas y victorias.';
  }
  function tick(){
    var t=now();if(t===null)return;
    render(t);
    if(doc.hidden || t>=END)return;
    // Si varios países tienen la misma medianoche se celebra una sola vez.
    // Ventana de recuperación de 2 minutos para quien abre la página tarde.
    var g=groups.find(function(x){return x.at<=t && t-x.at<120000 && !seen('group:'+x.at,handled);});
    var mt=myTime(),personalKey=me?'person:'+me.id:null,personalDue=me && mt!==null && t>=mt && !seen(personalKey,greeted);
    if(g){
      var own=personalDue && mt===g.at;
      var ok=fx.play({title:'¡Feliz Año Nuevo, '+join(g.codes)+'!',subtitle:own?'¡Feliz 2027, '+me.name+'! Gracias por formar parte de GEO ARMY.':'GEO ARMY · Celebración internacional 2027',countries:g.codes});
      if(ok){remember('group:'+g.at,handled);if(own)remember(personalKey,greeted);}
      return;
    }
    if(personalDue && fx.play({title:'¡Feliz Año Nuevo, '+me.name+'!',subtitle:'Gracias por acompañarnos. ¡Bienvenido a 2027!',countries:me.country&&zones[me.country]?[me.country]:[]}))remember(personalKey,greeted);
  }
  async function sync(){
    if(syncing || doc.hidden)return;
    syncing=true;var gen=generation;
    try{
      var start=performance.now(), result=await sb.rpc('christmas_travel_v1'), finish=performance.now();
      if(gen!==generation)return;
      var d=result.data, server=Date.parse(d&&d.serverNow);
      if(result.error || !d || !Number.isFinite(server)||!Array.isArray(d.destinations))throw Error('clock');
      anchor=server+(finish-start)/2;anchorAt=finish;
      var codes=Array.from(new Set(d.destinations.map(function(x){return x.code;}).concat(Array.isArray(d.unmappedCountries)?d.unmappedCountries:[]).map(function(x){return String(x).toUpperCase();}).filter(function(x){return /^[A-Z]{2}$/.test(x);})));
      rebuild(codes);
      var auth=await sb.auth.getSession();if(gen!==generation)return;
      var session=auth.data&&auth.data.session;
      if(session&&session.user){
        var uid=session.user.id;
        var p=await sb.from('profiles').select('display_name,twitch_login,country_code').eq('id',uid).maybeSingle();
        if(gen!==generation)return;
        if(!p.error&&p.data){
          me={id:uid,name:String(p.data.display_name||p.data.twitch_login||'miembro').slice(0,80),country:String(p.data.country_code||'').trim().toUpperCase()};
        }else me=null;
      }else me=null;
      tick();
    }catch(e){if(anchor===null)note.textContent='No se pudo sincronizar el horario oficial. Reintentando…';}
    finally{syncing=false;if(gen!==generation)setTimeout(sync,0);}
  }
  // La demostración usa países reales pero nunca cambia reloj, estados ni marcas de celebración.
  function preview(){
    var t=now();var g=groups.find(function(x){return t===null||x.at>t;})||groups[0];
    if(!g){fx.play({title:'¡Bienvenido a 2027!',subtitle:'Demostración visual · Sin datos oficiales'});return;}
    fx.play({title:'¡Feliz Año Nuevo, '+join(g.codes)+'!',subtitle:'SIMULACIÓN · Países registrados en GEO ARMY',countries:g.codes});
  }
  window.GeoArmyNewYearWorld={now:now,preview:preview};
  panel.hidden=false;
  sb.auth.onAuthStateChange(function(ev){if(ev==='SIGNED_IN'||ev==='SIGNED_OUT'||ev==='INITIAL_SESSION'){generation++;me=null;personal.hidden=true;setTimeout(sync,0);}});
  doc.addEventListener('visibilitychange',function(){if(!doc.hidden){tick();sync();}});
  sync();setInterval(tick,1000);setInterval(sync,60000);
})();
