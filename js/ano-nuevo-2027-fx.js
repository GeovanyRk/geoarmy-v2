/* GEO ARMY — celebración visual, sin acceso a cuentas ni economía.
   El controlador recibe un mensaje de demostración o una celebración real
   desde el calendario; no decide por sí solo qué país ha llegado a 2027. */
(function(){
  'use strict';
  if(!window.GeoArmySeason || window.GeoArmySeason.id!=='ano-nuevo-2027')return;
  var doc=document, canvas=doc.getElementById('gaNyFireworks'), button=doc.getElementById('gaNyDemo');
  if(!canvas || !button)return;
  var banner=doc.getElementById('gaNyCelebration'), title=doc.getElementById('gaNyCelebrationTitle'), subtitle=doc.getElementById('gaNyCelebrationSubtitle');
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  var frame=0, timer=0, running=false, DURATION=25000;
  var close=doc.getElementById('gaNyCelebrationClose');
  // Sacar el canvas de los ancestros con aislamiento, recorte o transform.
  doc.body.appendChild(canvas);
  function stop(){
    if(frame)cancelAnimationFrame(frame);
    if(timer)clearTimeout(timer);
    frame=0;timer=0;running=false;canvas.hidden=true;button.disabled=false;
    if(banner){banner.hidden=true;banner.classList.remove('ga-ny-celebration-on');}
    doc.documentElement.classList.remove('ga-ny-showtime');
  }
  function play(options){
    options=options||{};
    if(doc.hidden || running)return false;
    running=true;button.disabled=true;
    if(banner && title && subtitle){
      title.textContent=options.title||'¡Bienvenido a 2027!';
      subtitle.textContent=options.subtitle||'GEO ARMY · Una nueva era';
      banner.hidden=false;
      banner.classList.add('ga-ny-celebration-on');
    }
    doc.documentElement.classList.add('ga-ny-showtime');
    timer=setTimeout(stop,DURATION);
    // El mensaje se conserva aunque el usuario desactive el movimiento.
    if(reduce.matches)return true;
    var ctx=canvas.getContext('2d');if(!ctx)return true;
    var w=window.innerWidth,h=window.innerHeight,small=w<700;
    var dpr=Math.min(window.devicePixelRatio||1,small?1.2:1.5);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    canvas.hidden=false;
    var scale=Math.min(w,h),start=performance.now();
    var palette=['#fff2d3','#ffd68b','#eab454','#fff9ec','#f5e1bd'];
    // Apertura, coronas, cascadas de oro y gran final. Las coordenadas
    // dejan respirar el centro en escritorio, con una adaptación móvil.
    var bursts=[
      [.16,.26,650,.26,0,'peony'],[.84,.28,1250,.27,1,'peony'],
      [.28,.16,2500,.22,3,'ring'],[.72,.18,3300,.24,1,'ring'],
      [.12,.46,4550,.25,2,'willow'],[.88,.43,5100,.26,0,'willow'],
      [.22,.30,6500,.29,1,'peony'],[.78,.32,7100,.29,0,'peony'],
      [.13,.17,8400,.21,3,'ring'],[.86,.18,9100,.23,1,'ring'],
      [.31,.27,10100,.26,2,'willow'],[.69,.26,11000,.27,1,'willow'],
      [.10,.50,12000,.28,1,'peony'],[.90,.50,12550,.27,0,'peony'],
      [.24,.18,13700,.26,3,'ring'],[.76,.18,14400,.27,0,'ring'],
      [.18,.35,15500,.31,2,'willow'],[.82,.36,16100,.31,1,'willow'],
      [.08,.20,17400,.22,0,'peony'],[.92,.20,17750,.24,3,'ring'],
      [.30,.14,18400,.27,1,'peony'],[.70,.14,18750,.27,0,'peony'],
      [.14,.39,19300,.32,2,'willow'],[.86,.39,19650,.32,1,'willow'],
      [.24,.23,20500,.32,0,'peony'],[.76,.23,20700,.32,1,'peony'],
      [.50,.16,21300,.29,3,'ring'],[.10,.44,21500,.27,1,'willow'],[.90,.44,21600,.27,0,'willow']
    ].map(function(v,i){
      return {x:v[0]*w,y:v[1]*h,at:v[2],r:v[3],c:v[4],kind:v[5],index:i,particles:[]};
    });
    if(small){
      bursts=bursts.filter(function(b){return b.index%3!==1 || b.at>=19300;});
      bursts.forEach(function(b){b.x=Math.max(w*.18,Math.min(w*.82,b.x));b.r*=.86;});
    }
    bursts.forEach(function(b,bi){
      b.originX=b.x+(bi%2===0?-1:1)*scale*.10;
      b.originY=Math.min(h*.86,b.y+scale*.48);
      b.launch=b.at-600;
      var count=small?42:88;
      if(b.kind==='willow')count=small?52:106;
      var spin=Math.random()*Math.PI*2;
      for(var i=0;i<count;i++){
        var a=spin+(i/count)*Math.PI*2+(Math.random()-.5)*(b.kind==='ring'?.035:.13);
        var speed=b.r*scale*(b.kind==='ring'?.94+Math.random()*.12:.56+Math.random()*.60);
        var inner=b.kind==='peony' && i%5===0;
        if(inner)speed*=.54;
        var color=palette[(b.c+(i%5===0?2:0))%palette.length];
        b.particles.push({b:b,angle:a,speed:speed,life:b.kind==='willow'?2.65+Math.random()*.55:2.05+Math.random()*.8,color:color,size:.85+Math.random()*.9,twinkle:Math.random()*6.28});
      }
    });
    function point(p,t){
      var age=Math.max(0,t),willow=p.b.kind==='willow';
      var distance=p.speed*(1-Math.exp(-(willow?1.05:1.65)*age));
      return [p.b.x+Math.cos(p.angle)*distance,p.b.y+Math.sin(p.angle)*distance+scale*(willow?.035:.016)*age*age];
    }
    function draw(now){
      if(!running || doc.hidden || reduce.matches){canvas.hidden=true;frame=0;return;}
      var elapsed=now-start;if(elapsed>24500){canvas.hidden=true;frame=0;return;}
      ctx.clearRect(0,0,w,h);
      ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
      bursts.forEach(function(b){
        var t=(elapsed-b.launch)/(b.at-b.launch);
        if(t>=0 && t<1){
          var ease=1-Math.pow(1-t,1.5);
          var x=b.originX+(b.x-b.originX)*ease,y=b.originY+(b.y-b.originY)*ease;
          var grad=ctx.createLinearGradient(b.originX,b.originY,x,y);grad.addColorStop(0,'rgba(226,167,75,0)');grad.addColorStop(.78,'rgba(240,196,115,.5)');grad.addColorStop(1,'#fff2ce');
          ctx.globalAlpha=.75;ctx.strokeStyle=grad;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(b.originX,b.originY);ctx.lineTo(x,y);ctx.stroke();
        }
        var age=(elapsed-b.at)/1000;
        if(age>=0 && age<.5){
          var radius=Math.max(1,scale*.075*(.55+age));
          var glow=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,radius);
          glow.addColorStop(0,'rgba(255,225,156,.8)');glow.addColorStop(.25,'rgba(237,168,75,.19)');glow.addColorStop(1,'rgba(237,168,75,0)');
          ctx.globalAlpha=Math.pow(1-age/.5,2)*.78;ctx.fillStyle=glow;ctx.fillRect(b.x-radius,b.y-radius,radius*2,radius*2);
        }
      });
      bursts.forEach(function(b){
        var age=(elapsed-b.at)/1000;
        if(age<0 || age>3.25)return;
        b.particles.forEach(function(p){
          if(age>p.life)return;
          var alpha=Math.pow(1-age/p.life,1.15)*(.78+.22*Math.sin(age*14+p.twinkle));
          var tailTime=b.kind==='willow'?.55:.33;
          var end=point(p,age),tail=point(p,age-tailTime),mid=point(p,age-tailTime*.38);
          ctx.strokeStyle=p.color;ctx.lineWidth=p.size*.75;
          ctx.globalAlpha=Math.max(0,alpha)*.27;ctx.beginPath();ctx.moveTo(tail[0],tail[1]);ctx.lineTo(mid[0],mid[1]);ctx.stroke();
          ctx.globalAlpha=Math.max(0,alpha)*.82;ctx.lineWidth=p.size;ctx.beginPath();ctx.moveTo(mid[0],mid[1]);ctx.lineTo(end[0],end[1]);ctx.stroke();
          ctx.globalAlpha=Math.max(0,alpha)*.8;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(end[0],end[1],p.size*.68,0,Math.PI*2);ctx.fill();
          // Pequeñas brasas separadas, especialmente visibles en las cascadas.
          if(b.kind==='willow' && age>.55 && Math.sin(age*24+p.twinkle)>.60){
            var ember=point(p,age-.34);
            ctx.globalAlpha=alpha*.40;ctx.fillStyle='#ffe2a2';ctx.fillRect(ember[0],ember[1]+2,1.3,1.3);
          }
        });
      });
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
      frame=requestAnimationFrame(draw);
    }
    frame=requestAnimationFrame(draw);
    return true;
  }
  button.addEventListener('click',function(){play({title:'¡Feliz Año Nuevo, Perú!',subtitle:'Simulación de celebración internacional · 2027'});});
  if(close)close.addEventListener('click',stop);
  doc.addEventListener('visibilitychange',function(){
    doc.documentElement.classList.toggle('ga-ny-paused',doc.hidden);
    if(doc.hidden)stop();
  });
  window.addEventListener('resize',function(){if(running)stop();});
  window.addEventListener('pagehide',stop);
  if(reduce.addEventListener)reduce.addEventListener('change',function(){if(reduce.matches && running){if(frame)cancelAnimationFrame(frame);frame=0;canvas.hidden=true;}});
  window.GeoArmyNewYearFX={play:play,stop:stop};
})();
