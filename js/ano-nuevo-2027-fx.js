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
  var frame=0, timer=0, running=false;
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
    timer=setTimeout(stop,6500);
    // El mensaje se conserva aunque el usuario desactive el movimiento.
    if(reduce.matches)return true;
    var ctx=canvas.getContext('2d');if(!ctx)return true;
    var w=window.innerWidth,h=window.innerHeight,small=w<700;
    var dpr=Math.min(window.devicePixelRatio||1,small?1.2:1.5);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    canvas.hidden=false;
    var scale=Math.min(w,h),start=performance.now(),particles=[];
    var palette=['#fff0cf','#f4ce85','#d5a653','#fff9e8'];
    var bursts=[
      {x:.17,y:.30,at:480,r:.13,c:0},
      {x:.83,y:.32,at:900,r:.14,c:1},
      {x:.29,y:.18,at:1780,r:.105,c:1},
      {x:.72,y:.19,at:2300,r:.105,c:0},
      {x:.12,y:.48,at:3120,r:.12,c:2},
      {x:.88,y:.44,at:3500,r:.12,c:1}
    ];
    if(small){bursts=bursts.slice(0,4);bursts.forEach(function(b){b.r*=.8;});}
    bursts.forEach(function(b,bi){
      b.x*=w;b.y*=h;b.originX=b.x+(bi%2===0?-1:1)*scale*.065;b.originY=Math.min(h*.75,b.y+scale*.37);
      b.launch=b.at-440;
      var count=small?30:57;
      for(var i=0;i<count;i++){
        var a=(i/count)*Math.PI*2+(Math.random()-.5)*.11;
        var speed=b.r*scale*(.72+Math.random()*.66);
        if(i%5===0)speed*=.65;
        particles.push({b:b,angle:a,speed:speed,life:1.55+Math.random()*.95,color:palette[(b.c+i%3)%palette.length],size:.65+Math.random()*.8,twinkle:Math.random()*6.28});
      }
    });
    function point(p,t){
      var distance=p.speed*(1-Math.exp(-1.45*Math.max(0,t)));
      return [p.b.x+Math.cos(p.angle)*distance,p.b.y+Math.sin(p.angle)*distance+scale*.021*t*t];
    }
    function draw(now){
      if(!running || doc.hidden || reduce.matches){canvas.hidden=true;frame=0;return;}
      var elapsed=now-start;if(elapsed>6000){canvas.hidden=true;frame=0;return;}
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
          var radius=Math.max(1,scale*.045*(.55+age));
          var glow=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,radius);
          glow.addColorStop(0,'rgba(255,225,156,.8)');glow.addColorStop(.25,'rgba(237,168,75,.19)');glow.addColorStop(1,'rgba(237,168,75,0)');
          ctx.globalAlpha=Math.pow(1-age/.5,2)*.7;ctx.fillStyle=glow;ctx.fillRect(b.x-radius,b.y-radius,radius*2,radius*2);
        }
      });
      particles.forEach(function(p){
        var age=(elapsed-p.b.at)/1000;
        if(age<0 || age>p.life)return;
        var alpha=Math.pow(1-age/p.life,1.3)*(.76+.24*Math.sin(age*18+p.twinkle));
        var end=point(p,age),tail=point(p,Math.max(0,age-.21)),mid=point(p,Math.max(0,age-.09));
        ctx.globalAlpha=Math.max(0,alpha)*.55;ctx.strokeStyle=p.color;ctx.lineWidth=p.size*.85;ctx.beginPath();ctx.moveTo(tail[0],tail[1]);ctx.lineTo(mid[0],mid[1]);ctx.stroke();
        ctx.globalAlpha=Math.max(0,alpha);ctx.lineWidth=p.size;ctx.beginPath();ctx.moveTo(mid[0],mid[1]);ctx.lineTo(end[0],end[1]);ctx.stroke();
        ctx.fillStyle='#fff1cd';ctx.beginPath();ctx.arc(end[0],end[1],p.size*.66,0,Math.PI*2);ctx.fill();
      });
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
      frame=requestAnimationFrame(draw);
    }
    frame=requestAnimationFrame(draw);
    return true;
  }
  button.addEventListener('click',function(){play({title:'¡Feliz Año Nuevo, Perú!',subtitle:'Simulación de celebración internacional · 2027'});});
  doc.addEventListener('visibilitychange',function(){
    doc.documentElement.classList.toggle('ga-ny-paused',doc.hidden);
    if(doc.hidden)stop();
  });
  window.addEventListener('resize',function(){if(running)stop();});
  window.addEventListener('pagehide',stop);
  if(reduce.addEventListener)reduce.addEventListener('change',function(){if(reduce.matches && running){if(frame)cancelAnimationFrame(frame);frame=0;canvas.hidden=true;}});
  window.GeoArmyNewYearFX={play:play,stop:stop};
})();
