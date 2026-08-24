// ===== PREMIUM POLISH — mejoras visuales aditivas =====
// Este archivo NO toca main.js ni su lógica (Twitch, boss, etc.).
// Cada función está aislada con safe() para que un fallo no rompa las demás.
(function () {
  'use strict';

  function safe(fn, name) {
    try { fn(); } catch (e) { console.warn('[premium:' + name + ']', e); }
  }

  // Barra de progreso de scroll, arriba de todo
  safe(function initScrollProgress() {
    var bar = document.querySelector('[data-scroll-progress]');
    if (!bar) return;
    var raf = null;
    function update() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var pct = max > 0 ? window.scrollY / max : 0;
      bar.style.transform = 'scaleX(' + pct + ')';
      raf = null;
    }
    window.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }, 'scrollProgress');

  // Nav gana sombra/profundidad cuando el usuario baja
  safe(function initNavScroll() {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    function on() {
      if (window.scrollY > 40) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
    }
    on();
    window.addEventListener('scroll', on, { passive: true });
  }, 'navScroll');

  // Reveal on scroll — solo para elementos marcados con data-reveal.
  // Si este script no corre por algún motivo, el contenido queda visible igual
  // (ver regla CSS: [data-reveal] es visible por defecto).
  safe(function initReveals() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    document.documentElement.classList.add('reveal-ready');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-revealed');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px -2% 0px' });
    els.forEach(function (el) { io.observe(el); });
    // Red de seguridad: a los 6s revela lo que siga oculto sobre la línea de flotación
    setTimeout(function () {
      els.forEach(function (el) {
        if (!el.classList.contains('is-revealed') && el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add('is-revealed');
        }
      });
    }, 6000);
  }, 'reveals');

  // Navegación por paneles: el nav muestra una sección a la vez en vez de
  // hacer scroll por toda la página. Si algo falla, no se activa nada y el
  // sitio funciona como una sola página larga (comportamiento original).
  safe(function initPanelNav() {
    var panels = document.querySelectorAll('.panel');
    if (!panels.length) return;
    var allNavLinks = document.querySelectorAll('.nav-links a');
    var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
    var tabsWrap = document.getElementById('panelTabs');
    var allLinkGroups = [navLinks];
    document.documentElement.classList.add('panels-ready');

    // Clonamos TODOS los links del nav (paneles internos + externos como
    // "Tienda") en una tira de tabs para móvil, donde .nav-links está oculto
    // (ver CSS @media max-width:768px). Los links externos conservan su href
    // normal (tienda.html) y navegan tal cual; solo los de #ancla entran al
    // sistema de paneles.
    if (tabsWrap) {
      allNavLinks.forEach(function (a) {
        var clone = a.cloneNode(true);
        tabsWrap.appendChild(clone);
      });
      allLinkGroups.push(tabsWrap.querySelectorAll('a[href^="#"]'));
    }

    function setActiveLinks(id) {
      allLinkGroups.forEach(function (group) {
        group.forEach(function (a) {
          a.classList.toggle('is-active-link', a.getAttribute('href') === '#' + id);
        });
      });
    }

    function activate(id, scrollToPanel) {
      var target = document.getElementById(id);
      if (!target || !target.classList.contains('panel')) return;
      panels.forEach(function (p) { p.classList.toggle('is-active', p === target); });
      setActiveLinks(id);
      // El contenido con animación de aparición se muestra de inmediato al
      // cambiar de panel, sin esperar el scroll.
      target.querySelectorAll('[data-reveal]').forEach(function (el) {
        el.classList.add('is-revealed');
      });
      if (scrollToPanel) {
        var nav = document.querySelector('.nav');
        var navH = nav ? nav.offsetHeight : 0;
        var y = target.getBoundingClientRect().top + window.scrollY - navH - 10;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }

    allLinkGroups.forEach(function (group) {
      group.forEach(function (a) {
        var id = a.getAttribute('href').slice(1);
        if (!document.getElementById(id) || !document.getElementById(id).classList.contains('panel')) return;
        a.addEventListener('click', function (e) {
          e.preventDefault();
          activate(id, true);
          history.replaceState(null, '', '#' + id);
        });
      });
    });

    var logo = document.querySelector('.nav-logo');
    if (logo && logo.getAttribute('href') === '#inicio') {
      logo.addEventListener('click', function (e) {
        e.preventDefault();
        activate('inicio', true);
        history.replaceState(null, '', '#inicio');
      });
    }

    var initial = window.location.hash ? window.location.hash.slice(1) : '';
    if (initial && document.getElementById(initial) && document.getElementById(initial).classList.contains('panel')) {
      activate(initial, false);
    } else {
      activate('inicio', false);
    }
  }, 'panelNav');

  // Punto de luz que sigue al cursor — solo desktop, puramente cosmético.
  // Crea su propio elemento (no depende de nada del HTML existente).
  safe(function initCursorGlow() {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    var glow = document.createElement('div');
    glow.className = 'cursor-glow';
    document.body.appendChild(glow);
    var raf = null, mx = 0, my = 0;
    function update() {
      glow.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0) translate3d(-50%,-50%,0)';
      raf = null;
    }
    window.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      glow.classList.add('is-active');
      if (!raf) raf = requestAnimationFrame(update);
    }, { passive: true });
    document.addEventListener('mouseleave', function () { glow.classList.remove('is-active'); });
  }, 'cursorGlow');

  // Tilt 3D sutil en tarjetas al pasar el mouse — solo desktop, puramente cosmético.
  // Si no corre, las tarjetas quedan exactamente como antes (sin este JS no tienen transform inline).
  safe(function initCardTilt() {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    var sel = '.hero-card, .ruleta-card, .ti-card, .schedule-card, .timezone-card, .sub-cta-card, .link-card, .benefit-item, .gn-chip, .gn-rank-card';
    var cards = document.querySelectorAll(sel);
    cards.forEach(function (card) {
      card.classList.add('tilt-card');
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = 'perspective(800px) translateY(-6px) rotateX(' + (-py * 6).toFixed(2) + 'deg) rotateY(' + (px * 6).toFixed(2) + 'deg)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }, 'cardTilt');

})();
