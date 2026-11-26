(()=>{'use strict';
const sb=window.GeoArmyAccount?.client,box=document.getElementById('guideReward'),status=document.getElementById('rewardStatus'),btn=document.getElementById('rewardClaim');
if(!box||!status||!btn)return;
let generation=0,busy=false,timer;
const messages={ineligible:'Exclusivo para nuevos miembros. Puedes seguir consultando toda la guía.',claimed:'Ya recibiste tus 1,000 G-Coins.',granted:'¡Premio acreditado! Recibiste 1,000 G-Coins.',disabled:'La recompensa todavía no está disponible.',identity_required:'No pudimos verificar tu identidad de Twitch.',ready:'¡Completaste todos los requisitos! Reclama tu premio.'};
async function run(action='status'){
if(busy)return;busy=true;const seq=++generation;btn.disabled=true;
try{
if(!sb)throw Error('client');
const a=await sb.auth.getSession();if(seq!==generation)return;
if(a.error)throw a.error;
if(!a.data.session){status.textContent='Inicia sesión para consultar tu elegibilidad.';box.dataset.state='guest';return;}
const r=await sb.functions.invoke('onboarding-reward',{body:{action}});
if(seq!==generation)return;
if(r.error||!r.data?.status)throw Error('unconfirmed');
const d=r.data;box.dataset.state=d.status;
status.textContent=d.status==='pending'?'Objetivos: '+d.steps+'/6 · Días registrados: '+d.days+'/7. Disponible al cumplir también siete días de antigüedad.':messages[d.status]||'No pudimos confirmar el estado. Vuelve a intentar.';
btn.disabled=d.status!=='ready';
if(d.status==='granted')Promise.resolve(window.GeoArmyAccount?.refreshWidget()).catch(()=>{});
}catch(e){if(seq===generation){status.textContent='No pudimos confirmar el estado. Puedes actualizar sin riesgo de duplicar el premio.';box.dataset.state='error';}}
finally{busy=false;}
}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>run(),500)}
btn.addEventListener('click',()=>run('claim'));
document.getElementById('rewardRefresh').addEventListener('click',()=>run());
if(sb)sb.auth.onAuthStateChange(()=>{generation++;busy=false;btn.disabled=true;schedule()});
new MutationObserver(schedule).observe(document.getElementById('count'),{childList:true,characterData:true,subtree:true});
window.addEventListener('pageshow',schedule);window.addEventListener('focus',schedule);run();
})();