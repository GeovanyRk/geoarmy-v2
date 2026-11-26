/* Geo Army V5 · etiquetas DOM, NO dibujadas en la imagen. Datos fijos de diseño. */
(function () {
  'use strict';
  var people = [
  {name:'Geovannyrk',x:50,y:94,group:'geo'},
  {name:'Fredi',x:17,y:35,group:'h'},
  {name:'Sky',x:25,y:33,group:'h'},
  {name:'Darksky',x:32,y:36,group:'h'},
  {name:'Keito',x:39,y:35,group:'h'},
  {name:'Forsa',x:46,y:41,group:'h'},
  {name:'Jose angel',x:51,y:43,group:'h'},
  {name:'Diegui',x:58,y:39,group:'h'},
  {name:'Kid',x:65,y:35,group:'h'},
  {name:'Kiro',x:71,y:35,group:'h'},
  {name:'Michael',x:78,y:36,group:'h'},
  {name:'Maton',x:85,y:42,group:'h'},
  {name:'Ricky',x:13,y:45,group:'h'},
  {name:'Shadow',x:23,y:45,group:'h'},
  {name:'Warner',x:28,y:47,group:'h'},
  {name:'Xander',x:34,y:49,group:'h'},
  {name:'Jona',x:40,y:59,group:'h'},
  {name:'Edgar',x:45,y:53,group:'h'},
  {name:'Gael',x:56,y:50,group:'h'},
  {name:'Panesito',x:62,y:47,group:'h'},
  {name:'Eddy',x:70,y:47,group:'h'},
  {name:'Toji',x:84,y:58,group:'h'},
  {name:'Alberto',x:93,y:54,group:'h'},
  {name:'Josem',x:35,y:64,group:'h'},
  {name:'Bonilla',x:41,y:68,group:'h'},
  {name:'Cristian',x:61,y:63,group:'h'},
  {name:'Mufasa',x:71,y:61,group:'h'},
  {name:'Carlos',x:29,y:80,group:'h'},
  {name:'Jirgu',x:39,y:84,group:'h'},
  {name:'Maiky',x:64,y:81,group:'h'},
  {name:'Kirby',x:19,y:65,group:'m'},
  {name:'Kitty',x:76,y:57,group:'m'},
  {name:'Vania',x:18,y:53,group:'m'}
  ];
  var photo = document.getElementById('v5-photo');
  var roster = document.getElementById('v5-roster');
  var rosterGrid = document.getElementById('v5-roster-grid');
  var pinWrap = document.getElementById('v5-pins');
  var allButton = document.getElementById('v5-names-toggle');
  var listButton = document.getElementById('v5-list-toggle');
  if (!photo || !roster || !rosterGrid || !pinWrap || !allButton || !listButton) return;
  var pins = [], entries = [];
  var selected = -1;
  var namesOn = false;
  function choose(index) {
    selected = index === selected && index !== 0 ? -1 : index;
    pins.forEach(function (el,i) {
      var is = i === selected;
      el.classList.toggle('v5-member--selected',is);
      el.setAttribute('aria-pressed',String(is));
    });
    entries.forEach(function (el,i) {
      var is = i === selected;
      el.dataset.selected = String(is);
      el.setAttribute('aria-pressed',String(is));
    });
    if (selected >= 0) {
      var el = pins[selected];
      if (el) el.focus({preventScroll:true});
    }
  }
  people.forEach(function (p,i) {
    var pin = document.createElement('button');
    pin.type='button';
    pin.className='v5-member' + (p.group === 'geo' ? ' v5-member--geo' : '');
    pin.textContent=p.name;
    pin.style.left=p.x+'%'; pin.style.top=p.y+'%';
    pin.setAttribute('aria-label','Ver integrante '+p.name);
    pin.setAttribute('aria-pressed','false');
    pin.tabIndex=p.group==='geo' ? 0 : -1;
    pin.addEventListener('click',function() {choose(i);});
    pinWrap.appendChild(pin); pins.push(pin);
    var button = document.createElement('button');
    button.type='button'; button.className='v5-person-button' + (p.group === 'geo' ? ' v5-person-button--geo' : '');
    button.textContent=p.name;
    button.setAttribute('aria-pressed','false');
    button.addEventListener('click',function() {
      choose(i);
      photo.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    });
    rosterGrid.appendChild(button);entries.push(button);
  });
  function syncPinAccess() {
    var desktop=window.matchMedia('(min-width: 761px)').matches;
    pins.forEach(function (el,i) {
      el.tabIndex = i===0 || i===selected || (namesOn && desktop) ? 0 : -1;
    });
  }
  allButton.addEventListener('click',function () {
    if (window.innerWidth <= 760) {
      // En móvil no cabe poner 33 nombres sobre las caras: abrir la lista accesible.
      roster.hidden = !roster.hidden;
      var open = !roster.hidden;
      listButton.setAttribute('aria-expanded',String(open));
      listButton.textContent=open?'Ocultar integrantes':'Ver los 33 integrantes';
      allButton.setAttribute('aria-pressed',String(open));
      allButton.textContent=open?'Ocultar nombres':'Ver nombres · 32';
      if (open) roster.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
      return;
    }
    // Al desplegar todos, quitar la selección anterior para que no se vean apagados.
    if (!namesOn && selected >= 0) choose(selected);
    namesOn=!namesOn; photo.classList.toggle('v5-names-on',namesOn);
    allButton.setAttribute('aria-pressed',String(namesOn));
    allButton.textContent=namesOn?'Ocultar nombres':'Ver nombres · 32';
    syncPinAccess();
  });
  listButton.addEventListener('click',function () {
    roster.hidden=!roster.hidden;
    listButton.setAttribute('aria-expanded',String(!roster.hidden));
    listButton.textContent=roster.hidden?'Ver los 33 integrantes':'Ocultar integrantes';
    if (!roster.hidden) roster.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
  });
  window.addEventListener('resize',syncPinAccess,{passive:true});
  syncPinAccess();
})();
