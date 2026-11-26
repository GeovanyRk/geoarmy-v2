/* =========================================================================
   COMUNIDAD V4 — js/comunidad-v4.js (Fase 2 + Fase 3 + Fase 4 + Fase 4A + Fase 5B)
   Cargado solo desde comunidad.html, al final del <body>.

   Alcance autorizado (y nada más):
     1. Enlaces de ancla internos (a[data-cg-scroll])         [Fase 2]
     2. Ruta de Reclutamiento: etapas como pestañas            [Fase 3; ARIA corregida en 5B]
     3. Controles de navegación de la franja de rangos         [Fase 3]
     4. Barra móvil contextual de Twitch                       [Fase 3]
     5. Centro de transmisiones: horario internacional         [Fase 4]

   - Mejora progresiva: sin este archivo las tres etapas de la ruta siguen
     visibles, la franja de rangos se desplaza de forma nativa y los enlaces
     de ancla funcionan como anclas normales.
   - No duplica ni redefine nada de main.js (copyCode, showToast,
     fetchTwitchStatus...). Todo va dentro de una función autoejecutable.
   - No usa Supabase, cuentas, cookies ni red. No toca recompensas. Único almacenamiento
     (Fase 4A): localStorage['geoarmy.comunidad.tz'] con la zona IANA que el visitante elige
     A MANO en el selector; «Automática» la borra; si el almacenamiento falla, todo sigue igual.
   - El Centro de transmisiones solo lee el reloj del navegador y usa Intl
     (sin librerías, sin offsets UTC fijos). NO consulta Twitch y NO escribe en
     ningún elemento de estado del stream: la cuenta regresiva mide el horario
     programado, nunca anuncia «en vivo».
   - Respeta prefers-reduced-motion (desplazamientos 'instant').
   ========================================================================= */
(function () {
  'use strict';

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function prefersReduced() { return !!(mq && mq.matches); }
  function scrollBehavior() { return prefersReduced() ? 'instant' : 'smooth'; }
  // Cada módulo se aísla: si uno falla, los demás siguen funcionando.
  function safe(name, fn) {
    try { fn(); } catch (e) { if (window.console) console.warn('[comunidad-v4:' + name + ']', e); }
  }

  /* ---------- 1. Anclas internas ---------- */
  safe('anclas', function () {
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[data-cg-scroll]') : null;
      if (!a || ev.defaultPrevented) return;
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

      var id = (a.getAttribute('href') || '').replace(/^#/, '');
      var target = id ? document.getElementById(id) : null;
      if (!target) return; // sin destino: se deja el comportamiento nativo

      ev.preventDefault();
      // 'instant' (no 'auto'): style.css fija scroll-behavior:smooth en <html> y
      // 'auto' lo heredaría también con movimiento reducido.
      target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });

      // Foco en el destino para teclado y lectores de pantalla.
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }

      // Mantener la URL con el ancla (compartible y compatible con «atrás»).
      if (window.history && history.pushState) history.pushState(null, '', '#' + id);
      else window.location.hash = id;
    });
  });

  /* ---------- 2. Ruta de Reclutamiento: etapas como pestañas ---------- */
  safe('ruta', function () {
    var route = document.querySelector('[data-cg-route]');
    if (!route) return;
    var list = route.querySelector('.cg-stages');
    var stages = route.querySelectorAll('[data-cg-stage]');
    if (!list || stages.length < 2) return;

    var tabs = [];
    var panels = [];
    var stageClass = [];

    Array.prototype.forEach.call(stages, function (li, i) {
      var head = li.querySelector('.cg-stage__head');
      var body = li.querySelector('.cg-stage__body');
      if (!head || !body) return;

      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'cg-tab';
      tab.id = 'cg-tab-' + (i + 1);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'cg-panel-' + (i + 1));
      // El contenido original del encabezado (nodo + nombre) pasa al botón.
      while (head.firstChild) tab.appendChild(head.firstChild);
      head.appendChild(tab);
      head.setAttribute('role', 'presentation');
      li.setAttribute('role', 'presentation');

      body.id = 'cg-panel-' + (i + 1);
      body.setAttribute('role', 'tabpanel');
      body.setAttribute('aria-labelledby', tab.id);

      tabs.push(tab);
      panels.push(body);
      stageClass.push((li.className.match(/cg-stage--\d+/) || [''])[0]);
    });
    if (tabs.length < 2) return;

    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Etapas de la ruta de reclutamiento');

    /* Fase 5B — ARIA: un tablist solo puede contener pestañas. Los paneles salen de la lista
       y pasan a un contenedor hermano; cada uno conserva el color de su etapa (clase cg-stage--N)
       y la relación con su pestaña (aria-controls / aria-labelledby). */
    var panelWrap = document.createElement('div');
    panelWrap.className = 'cg-panels';
    panels.forEach(function (panel, i) {
      if (stageClass[i]) panel.classList.add(stageClass[i]);
      panelWrap.appendChild(panel);
    });
    list.parentNode.insertBefore(panelWrap, list.nextSibling);

    function select(index, focus) {
      tabs.forEach(function (t, i) {
        var on = i === index;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
      });
      if (focus) tabs[index].focus();
    }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i, false); });
      t.addEventListener('keydown', function (ev) {
        var n = tabs.length, next = -1;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % n;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (i - 1 + n) % n;
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = n - 1;
        if (next < 0) return;
        ev.preventDefault();
        select(next, true);
      });
    });

    route.classList.add('is-tabs');
    select(0, false);
  });

  /* ---------- 3. Franja de rangos: controles anterior / siguiente ---------- */
  safe('rangos', function () {
    var scroller = document.querySelector('[data-cg-ranks]');
    var ctl = document.querySelector('[data-cg-ranks-ctl]');
    if (!scroller || !ctl) return;

    function mk(label, glyph, dir) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cg-ctl';
      b.setAttribute('aria-label', label);
      b.textContent = glyph;
      b.addEventListener('click', function () {
        if (b.getAttribute('aria-disabled') === 'true') return;
        scroller.scrollBy({ left: dir * Math.max(120, scroller.clientWidth * 0.8), behavior: scrollBehavior() });
      });
      return b;
    }
    var prev = mk('Ver rangos anteriores', '‹', -1);
    var next = mk('Ver rangos siguientes', '›', 1);
    ctl.appendChild(prev);
    ctl.appendChild(next);

    var queued = false;
    function update() {
      queued = false;
      var max = scroller.scrollWidth - scroller.clientWidth;
      ctl.hidden = max <= 2;
      prev.setAttribute('aria-disabled', scroller.scrollLeft <= 1 ? 'true' : 'false');
      next.setAttribute('aria-disabled', scroller.scrollLeft >= max - 1 ? 'true' : 'false');
    }
    function queue() { if (!queued) { queued = true; window.requestAnimationFrame(update); } }

    scroller.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    if (window.ResizeObserver) new ResizeObserver(queue).observe(scroller);
    update();
  });

  /* ---------- 5. Centro de transmisiones: horario internacional ----------
     Horario confirmado por el propietario: lunes a viernes 7:00 PM en
     America/New_York; sábado y domingo variable. Todo se calcula con Intl a partir
     de la zona IANA, de modo que el horario de verano (EE. UU., Europa...) se
     resuelve solo. Nada se guarda ni se envía. */
  safe('transmisiones', function () {
    var root = document.querySelector('[data-cg-hub]');
    if (!root || !window.Intl || typeof Intl.DateTimeFormat !== 'function') return; // queda el horario base estático

    var BASE_TZ = 'America/New_York';
    var BASE_H = 19, BASE_M = 0;
    var DAY_MS = 86400000;

    function $(id) { return document.getElementById(id); }
    var el = {
      clock: $('cg-clock'), box: $('cg-tz-box'), sel: $('cg-tz'), note: $('cg-tz-note'),
      d: $('cg-cd-d'), h: $('cg-cd-h'), m: $('cg-cd-m'), s: $('cg-cd-s'), sr: $('cg-cd-sr'),
      date: $('cg-next-date'), time: $('cg-next-time'), zone: $('cg-next-zone'), shift: $('cg-next-shift'),
      notice: $('cg-hub-notice'), nowLocal: $('cg-now-local'), nowNy: $('cg-now-ny'),
      indTz: $('cg-ind-tz'), indOff: $('cg-ind-off'), indNy: $('cg-ind-ny'), nojs: $('cg-hub-nojs')
    };
    if (!el.sel || !el.d || !el.s) return;

    /* --- Utilidades Intl --- */
    function validZone(tz) {
      if (!tz || typeof tz !== 'string') return false;
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
    }
    function mk(tz, opts) { opts.timeZone = tz; return new Intl.DateTimeFormat('en-US', opts); }
    function mkEs(tz, opts) { opts.timeZone = tz; return new Intl.DateTimeFormat('es', opts); }
    var fmtCache = {};
    function fmts(tz) {
      if (fmtCache[tz]) return fmtCache[tz];
      var f = {
        parts: mk(tz, { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }),
        time: mk(tz, { hour: 'numeric', minute: '2-digit', hour12: true }),
        date: mkEs(tz, { weekday: 'long', day: 'numeric', month: 'long' }),
        clock: mk(tz, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
        name: null,
        abbr: mk(tz, { timeZoneName: 'short' })
      };
      try { f.name = mk(tz, { timeZoneName: 'shortOffset' }); } catch (e) { f.name = mk(tz, { timeZoneName: 'short' }); }
      fmtCache[tz] = f;
      return f;
    }
    function getParts(tz, t) {
      var o = {}, ps = fmts(tz).parts.formatToParts(new Date(t));
      for (var i = 0; i < ps.length; i++) if (ps[i].type !== 'literal') o[ps[i].type] = parseInt(ps[i].value, 10);
      if (o.hour === 24) o.hour = 0; // algunos motores devuelven 24 a medianoche
      return o;
    }
    // Desfase (ms) de la zona en el instante t: hora «de pared» interpretada como UTC menos t.
    function offsetAt(tz, t) {
      var p = getParts(tz, t);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
    }
    // Instante UTC en el que la pared de `tz` marca y-m-d h:mi (resuelve el horario de verano).
    function zonedToUtc(y, mo, d, h, mi, tz) {
      var guess = Date.UTC(y, mo - 1, d, h, mi, 0);
      var t = guess - offsetAt(tz, guess);
      var off2 = offsetAt(tz, t);
      if (off2 !== offsetAt(tz, guess)) t = guess - off2;
      return t;
    }
    function cap(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : str; }
    function dayLabel(tz, t) { return cap(fmts(tz).date.format(new Date(t)).replace(/^([^,]+),\s*/, '$1 ')); }
    function city(tz) { var n = listedName(tz); return n || tz.split('/').pop().replace(/_/g, ' '); }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function fmtTime(tz, t) {
      var ps = fmts(tz).time.formatToParts(new Date(t)), hh = '', mm = '', dp = '';
      ps.forEach(function (p) { if (p.type === 'hour') hh = p.value; else if (p.type === 'minute') mm = p.value; else if (p.type === 'dayPeriod') dp = p.value; });
      return hh + ':' + mm + ' ' + dp.replace(/\./g, '').toUpperCase();
    }
    function zoneName(tz, t, short) {
      try {
        var ps = (short ? fmts(tz).abbr : fmts(tz).name).formatToParts(new Date(t));
        for (var i = 0; i < ps.length; i++) if (ps[i].type === 'timeZoneName') return ps[i].value;
      } catch (e) { /* sin nombre */ }
      return '';
    }

    /* --- Próxima transmisión REGULAR (lunes a viernes, 7:00 PM en Nueva York) --- */
    function nextRegular(now) {
      var n = getParts(BASE_TZ, now);
      for (var k = 0; k < 10; k++) {
        var day = new Date(Date.UTC(n.year, n.month - 1, n.day + k));
        var wd = day.getUTCDay(); // día de la semana del calendario (no depende de la zona)
        if (wd < 1 || wd > 5) continue;
        var t = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), BASE_H, BASE_M, BASE_TZ);
        if (t > now) return t;
      }
      return null; // no debería ocurrir
    }
    function nyWeekday(now) {
      var n = getParts(BASE_TZ, now);
      return new Date(Date.UTC(n.year, n.month - 1, n.day)).getUTCDay();
    }

    /* --- Zona: detectada / elegida / de respaldo --- */
    var detected = null;
    try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { detected = null; }
    var detectedOk = validZone(detected);
    var autoOpt = el.sel.querySelector('option[value="auto"]');
    var state = { mode: 'auto', tz: detectedOk ? detected : BASE_TZ, target: 0, lastSec: -1, lastMin: -1 };

    function listedName(tz) {
      var opts = el.sel.options;
      for (var i = 0; i < opts.length; i++) if (opts[i].value === tz) return opts[i].text;
      return null;
    }
    // Las opciones de la lista que el navegador no reconozca se retiran (no se rompe nada).
    Array.prototype.slice.call(el.sel.options).forEach(function (o) {
      if (o.value !== 'auto' && !validZone(o.value)) o.parentNode.removeChild(o);
    });
    Array.prototype.slice.call(el.sel.querySelectorAll('optgroup')).forEach(function (g) {
      if (!g.children.length) g.parentNode.removeChild(g);
    });
    if (autoOpt) {
      autoOpt.textContent = detectedOk
        ? 'Automática: ' + city(detected)
        : 'Automática (no se detectó): Nueva York';
    }

    /* --- Preferencia de zona (localStorage): solo la zona IANA elegida a mano. «Automática» la borra.
           Si el almacenamiento no está disponible o falla, el selector sigue funcionando igual. --- */
    var PREF_KEY = 'geoarmy.comunidad.tz';
    var prefSaved = false;
    function prefRead() { try { return window.localStorage.getItem(PREF_KEY); } catch (e) { return null; } }
    function prefWrite(v) { // devuelve true si quedó guardada
      try {
        if (v === 'auto') {
          try { window.localStorage.removeItem(PREF_KEY); }
          catch (e1) { window.localStorage.setItem(PREF_KEY, 'auto'); } // si borrar falla, «auto» equivale a no tener preferencia
          return false;
        }
        window.localStorage.setItem(PREF_KEY, v);
        return window.localStorage.getItem(PREF_KEY) === v;
      } catch (e) { return false; }
    }
    function prefRestore() {
      var v = prefRead();
      if (v === null) return; // nada guardado (o almacenamiento no disponible)
      if (v !== 'auto' && validZone(v) && listedName(v) !== null) { el.sel.value = v; prefSaved = true; }
      else prefWrite('auto'); // valor ajeno, vacío o de una zona que ya no está en la lista: se limpia
    }

    function describe() {
      if (state.mode === 'auto') {
        return detectedOk
          ? 'Zona detectada en tu navegador: ' + state.tz.replace(/_/g, ' ') + '.'
          : 'No pudimos detectar tu zona horaria; mostramos la hora de Nueva York. Elige la tuya en la lista.';
      }
      return 'Zona elegida manualmente: ' + state.tz.replace(/_/g, ' ') + '.' +
        (prefSaved ? ' Se recordará en este navegador; elige «Automática» para olvidarla.' : '');
    }

    /* --- Pintado --- */
    function setText(node, v) { if (node && node.textContent !== v) node.textContent = v; }
    function paintStatic(now) {
      var tz = state.tz, tzn = zoneName(tz, now), nyn = zoneName(BASE_TZ, now, true);
      setText(el.indTz, tz.replace(/_/g, ' '));
      setText(el.indOff, tzn || '—');
      setText(el.indNy, nyn || '—');
    }
    function paintTarget(now) {
      var tz = state.tz, t = state.target, f = fmts(tz);
      setText(el.date, dayLabel(tz, t));
      setText(el.time, fmtTime(tz, t));
      var line1 = tz === BASE_TZ
        ? 'Hora de Nueva York (' + zoneName(tz, t, true) + ')'
        : city(tz) + ' (' + zoneName(tz, t) + ')';
      var line2 = tz === BASE_TZ ? '' : '\nEn Nueva York: ' + dayLabel(BASE_TZ, t) + ' · ' + fmtTime(BASE_TZ, t) + ' ' + zoneName(BASE_TZ, t, true);
      setText(el.zone, line1 + line2);
      // Cambio de día respecto a Nueva York (fecha local distinta)
      var a = getParts(tz, t), b = getParts(BASE_TZ, t);
      var diff = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / DAY_MS);
      if (diff !== 0) {
        el.shift.hidden = false;
        setText(el.shift, diff > 0 ? 'La fecha local es ' + diff + ' día' + (diff > 1 ? 's' : '') + ' después de la de Nueva York' : 'La fecha local es ' + (-diff) + ' día' + (diff < -1 ? 's' : '') + ' antes de la de Nueva York');
      } else {
        el.shift.hidden = true;
      }
    }
    function paintNotice(now) {
      var wd = nyWeekday(now), n = getParts(BASE_TZ, now);
      var afterBase = n.hour > BASE_H || (n.hour === BASE_H && n.minute >= BASE_M);
      var passed = wd >= 1 && wd <= 5 && afterBase;                 // la hora regular de este día en Nueva York ya llegó
      var weekendSpan = wd === 6 || wd === 0 || (wd === 5 && afterBase); // lo siguiente es fin de semana
      var msg = [];
      if (passed) msg.push('La hora regular de este día en Nueva York (7:00 PM) ya llegó; la cuenta regresiva apunta a la siguiente. Para saber si hay transmisión ahora, mira el estado real de Twitch.');
      if (weekendSpan) msg.push('Sábados y domingos el horario es variable: puede haber transmisiones sin programación fija. La cuenta regresiva apunta a la próxima hora regular (lunes a las 7:00 PM, Nueva York).');
      if (msg.length) { el.notice.hidden = false; setText(el.notice, msg.join(' ')); } else { el.notice.hidden = true; }
    }
    function tick() {
      var now = Date.now();
      if (!state.target || now >= state.target) {
        state.target = nextRegular(now);
        if (!state.target) return;
        paintTarget(now);
        state.lastMin = -1;
      }
      var left = Math.max(1, Math.ceil((state.target - now) / 1000)); // «1» hasta el último instante; nunca muestra 00:00:00:00
      var d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
      setText(el.d, pad(d)); setText(el.h, pad(h)); setText(el.m, pad(m)); setText(el.s, pad(s));
      var minKey = Math.floor(left / 60);
      if (minKey !== state.lastMin) { // lectores de pantalla: una frase por minuto, sin región «live»
        state.lastMin = minKey;
        setText(el.sr, 'Faltan ' + d + (d === 1 ? ' día, ' : ' días, ') + h + (h === 1 ? ' hora y ' : ' horas y ') + m + (m === 1 ? ' minuto' : ' minutos') + ' para la próxima transmisión regular.');
        paintStatic(now);
        paintNotice(now);
      }
      setText(el.nowLocal, fmts(state.tz).clock.format(new Date(now)));
      setText(el.nowNy, fmts(BASE_TZ).clock.format(new Date(now)) + ' ' + zoneName(BASE_TZ, now, true));
    }

    /* --- Temporizador: se detiene con la pestaña oculta --- */
    var timer = null;
    function schedule() {
      clearTimeout(timer);
      if (document.hidden) { timer = null; return; }
      timer = setTimeout(function () { tick(); schedule(); }, 1000 - (Date.now() % 1000) + 5);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearTimeout(timer); timer = null; } else { tick(); schedule(); }
    });

    function apply() {
      var v = el.sel.value;
      if (v === 'auto') { state.mode = 'auto'; state.tz = detectedOk ? detected : BASE_TZ; }
      else if (validZone(v)) { state.mode = 'manual'; state.tz = v; }
      else { state.mode = 'auto'; state.tz = BASE_TZ; }
      state.target = 0; // fuerza recálculo y repintado
      setText(el.note, describe());
      tick();
    }
    el.sel.addEventListener('change', function () {
      prefSaved = prefWrite(el.sel.value); // antes de apply(): la nota ya refleja si se guardó
      apply();
    });

    // Revela lo dinámico y oculta el aviso de «sin JavaScript».
    el.clock.hidden = false; el.box.hidden = false; el.nowNy.hidden = false;
    if (el.nojs) el.nojs.hidden = true;
    root.classList.add('is-ready');
    prefRestore();
    apply();
    schedule();
  });

  /* ---------- 4. Barra móvil contextual de Twitch ---------- */
  safe('barra', function () {
    var bar = document.getElementById('cg-bar');
    var main = document.getElementById('cg-watch');          // CTA principal del hero
    var monitor = document.querySelector('.cg-monitor__cta'); // otro CTA de Twitch en pantalla
    var hubCta = document.getElementById('cg-hub-watch');     // CTA de Twitch del Centro de transmisiones
    var end = document.getElementById('cg-closing');          // cierre (CTA final)
    if (!bar || !main || !window.IntersectionObserver) return;

    var narrow = window.matchMedia ? window.matchMedia('(max-width: 860px)') : null;
    var mainGone = false;   // el CTA principal quedó ARRIBA (ya se pasó), no solo fuera de pantalla
    var monitorIn = false;
    var hubIn = false;
    var endReached = false;

    // La barra mide 61 px. Los CTA de Twitch del resto de la página se vigilan con un margen inferior de 72 px,
    // de modo que la barra ya se está retirando cuando el CTA asoma por el borde de la pantalla (nunca queda encima).
    var NEAR = { rootMargin: '0px 0px 72px 0px' };
    // Acciones del cierre (Twitch + Discord): se vigilan ellas, no la sección completa, para no apagar la barra sin necesidad.
    var endActions = document.querySelector('#cg-closing .cg-closing__actions') || end;

    function apply() {
      var on = !!(narrow && narrow.matches) && mainGone && !monitorIn && !hubIn && !endReached;
      bar.classList.toggle('is-on', on);
      document.body.classList.toggle('cg-bar-on', on);
    }

    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      mainGone = !e.isIntersecting && e.boundingClientRect.bottom <= 0;
      apply();
    }).observe(main);

    if (monitor) {
      new IntersectionObserver(function (entries) {
        monitorIn = entries[entries.length - 1].isIntersecting;
        apply();
      }, NEAR).observe(monitor);
    }
    if (hubCta) {
      new IntersectionObserver(function (entries) {
        hubIn = entries[entries.length - 1].isIntersecting;
        apply();
      }, NEAR).observe(hubCta);
    }
    if (endActions) {
      new IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        // A la vista (o a punto de estarlo), o ya superado (pie de página): la barra no vuelve a aparecer.
        endReached = e.isIntersecting || e.boundingClientRect.bottom <= 0;
        apply();
      }, NEAR).observe(endActions);
    }
    if (narrow) {
      if (narrow.addEventListener) narrow.addEventListener('change', apply);
      else if (narrow.addListener) narrow.addListener(apply);
    }
    // Sin hidden, la barra existe pero permanece invisible (CSS) hasta que apply() la active.
    bar.hidden = false;
  });
})();
