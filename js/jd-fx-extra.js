/* =========================================================
   JulaDirect — rubber effects beyond the cart.
   - Wishlist heart: a bag flies in, the heart hops into it, the bag
     squashes like rubber to receive it, then flies out to the Wishlist
     link (or off-screen) and the heart pops back, saved.
   - Compare: the button squashes into a token that flies to the compare
     tray, which bounces to catch it.
   - Order now / checkout / quantity / remove: a rubber press.

   Loaded by js/jd-cartfx.js and built on its helpers. Cosmetic only:
   it listens to the events the shop already fires (jd:wishlist,
   gambasket:compare:change) and never changes what handlers do.
   Skipped for prefers-reduced-motion.
   ========================================================= */
(function () {
  "use strict";
  var JD = window.JD, F = JD && JD.cartFx;
  if (!F || !(F.version >= 2) || F.extra) return;
  F.extra = true;
  var rm = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var clamp = F.clamp, lerp = F.lerp, ease = F.ease;

  var STYLE =
    ".jd-fxb{position:fixed;z-index:2001;margin:0;pointer-events:none;will-change:transform;filter:drop-shadow(0 8px 14px rgba(15,23,42,.28))}" +
    ".jd-fxb svg{display:block;width:100%;height:100%;overflow:visible}" +
    ".jd-fxh{position:fixed;z-index:2000;margin:0;padding:0;display:flex;align-items:center;justify-content:center;overflow:visible;pointer-events:none;will-change:transform}";
  var st = document.createElement("style");
  st.id = "jd-fxextra-css";
  st.textContent = STYLE;
  document.head.appendChild(st);

  var BAG =
    '<svg viewBox="0 0 48 58" fill="none" aria-hidden="true">' +
    '<path d="M16 21v-6a8 8 0 0 1 16 0v6" stroke="#1e3a8a" stroke-width="3.2" stroke-linecap="round"/>' +
    '<path d="M5 20h38l3.2 33a4.2 4.2 0 0 1-4.2 4.6H6a4.2 4.2 0 0 1-4.2-4.6z" fill="#2563eb"/>' +
    '<ellipse cx="24" cy="20" rx="19" ry="4.2" fill="#172554"/>' +
    '<path d="M24 46c-5-3.6-8-6.1-8-9.4 0-2.2 1.7-3.9 3.8-3.9 1.5 0 3.2.9 4.2 2.5 1-1.6 2.7-2.5 4.2-2.5 2.1 0 3.8 1.7 3.8 3.9 0 3.3-3 5.8-8 9.4z" fill="#fff"/>' +
    "</svg>";

  function eo(u) { return 1 - Math.pow(1 - u, 3); }
  function ei(u) { return u * u; }
  function ctr(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  function nearest(sel, x, y) {
    var list = [].slice.call(document.querySelectorAll(sel)).filter(F.visible), best = null, bd = 1e12;
    list.forEach(function (a) {
      var q = ctr(a), dx = q.x - x, dy = q.y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = a; }
    });
    return best;
  }
  function place(g, x, y, w, h) {
    g.style.left = (x - w / 2) + "px";
    g.style.top = (y - h / 2) + "px";
    g.style.transform = "none";
  }

  /* Move an element's centre along an arc to a (live) target. */
  function path(g, S, getT, dur, o, end) {
    var t0 = performance.now();
    function step(now) {
      var u = clamp((now - t0) / dur, 0, 1), e = (o.ease || ease)(u), tp = getT();
      var kx = (S.x + tp.x) / 2, ky = Math.min(S.y, tp.y) - (o.lift || 80);
      var px = (1 - e) * (1 - e) * S.x + 2 * (1 - e) * e * kx + e * e * tp.x;
      var py = (1 - e) * (1 - e) * S.y + 2 * (1 - e) * e * ky + e * e * tp.y;
      var vx = 2 * (1 - e) * (kx - S.x) + 2 * e * (tp.x - kx);
      var vy = 2 * (1 - e) * (ky - S.y) + 2 * e * (tp.y - ky);
      var sp = Math.sin(Math.PI * u);
      var lean = (vx / (Math.abs(vx) + Math.abs(vy) + 1)) * (o.lean == null ? 16 : o.lean) * sp;
      var sc = lerp(o.s0 == null ? 1 : o.s0, o.s1 == null ? 1 : o.s1, e);
      g.style.transform = "translate(" + (px - S.x) + "px," + (py - S.y) + "px) rotate(" + lean + "deg) scale(" + (sc * (1 - 0.14 * sp)) + "," + (sc * (1 + 0.2 * sp)) + ")";
      if (u < 1) requestAnimationFrame(step); else end(tp);
    }
    requestAnimationFrame(step);
  }

  /* A visual copy of a button, positioned exactly over it. */
  function ghostOf(btn) {
    var r = btn.getBoundingClientRect(), cs = getComputedStyle(btn), g = document.createElement("div");
    g.className = "jd-fxh";
    g.setAttribute("aria-hidden", "true");
    var s = g.style;
    s.left = r.left + "px"; s.top = r.top + "px"; s.width = r.width + "px"; s.height = r.height + "px";
    var bg = cs.backgroundColor;
    if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) s.background = bg;
    s.color = cs.color; s.borderRadius = cs.borderRadius; s.boxShadow = cs.boxShadow;
    s.fontSize = cs.fontSize; s.fontWeight = cs.fontWeight; s.fontFamily = cs.fontFamily;
    s.gap = cs.columnGap && cs.columnGap !== "normal" ? cs.columnGap : "8px";
    g.innerHTML = btn.innerHTML;
    document.body.appendChild(g);
    return { g: g, r: r };
  }

  /* ---------------- Wishlist: the bag collects the heart ---------------- */
  var wishCtx = [];

  function wishKill(c) {
    clearTimeout(c.to);
    try { if (c.bag && c.bag.parentNode) c.bag.parentNode.removeChild(c.bag); } catch (e) {}
    try { if (c.hg && c.hg.parentNode) c.hg.parentNode.removeChild(c.hg); } catch (e) {}
    try { c.btn.classList.remove("jd-fx-hide"); } catch (e) {}
    var i = wishCtx.indexOf(c);
    if (i > -1) wishCtx.splice(i, 1);
  }

  function wishDone(c, ok) {
    if (c.ok !== null) return;
    c.ok = ok;
    clearTimeout(c.to);
    if (c.state === "wait") wishAfter(c);
  }

  function wishAfter(c) {
    c.state = "busy";
    try {
      if (c.idle) c.idle.cancel();
      if (c.ok) collect(c); else leave(c, false);
    } catch (e) { wishKill(c); }
  }

  function wishStart(btn) {
    var id = btn.getAttribute("data-wish"), r = btn.getBoundingClientRect();
    if (!id || r.width < 10 || r.height < 10) return;
    var k = clamp(Math.max(r.width, r.height) * 1.3 / 52, 0.9, 1.2);
    var BW = Math.round(52 * k), BH = Math.round(61 * k);
    var bag = document.createElement("div");
    bag.className = "jd-fxb";
    bag.setAttribute("aria-hidden", "true");
    bag.style.width = BW + "px"; bag.style.height = BH + "px";
    bag.innerHTML = BAG;
    document.body.appendChild(bag);
    var W = window.innerWidth, Hh = window.innerHeight, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var side = cx < W / 2 ? -1 : 1;
    var S = { x: side < 0 ? -BW : W + BW, y: Math.max(BH / 2 + 4, cy - clamp(Hh * 0.2, 70, 150)) };
    var last = { x: cx, y: Math.min(cy + BH * 0.5, Hh - BH / 2 - 8) };
    function L() {
      if (document.contains(btn)) {
        var q = ctr(btn);
        if (q.w > 0) last = { x: q.x, y: Math.min(q.y + BH * 0.5, window.innerHeight - BH / 2 - 8) };
      }
      return last;
    }
    var c = { btn: btn, id: id, bag: bag, BW: BW, BH: BH, side: side, state: "in", ok: null, to: 0, idle: null, pos: null, hg: null };
    wishCtx.push(c);
    place(bag, S.x, S.y, BW, BH);
    c.to = setTimeout(function () { wishDone(c, false); }, 2800);
    setTimeout(function () { wishKill(c); }, 11000);
    path(bag, S, L, 560, { ease: eo, lift: 90, lean: 18, s0: 0.9, s1: 1 }, function (tp) {
      c.pos = { x: tp.x, y: tp.y };
      place(bag, tp.x, tp.y, BW, BH);
      bag.animate([
        { transform: "scale(1.22,.78)", offset: 0 },
        { transform: "scale(.92,1.14)", offset: 0.4 },
        { transform: "scale(1.05,.96)", offset: 0.7 },
        { transform: "scale(1)", offset: 1 }
      ], { duration: 420, easing: "ease-out" });
      c.idle = bag.animate([{ transform: "translateY(-2px)" }, { transform: "translateY(3px)" }],
        { duration: 520, direction: "alternate", iterations: Infinity, easing: "ease-in-out", delay: 420 });
      c.state = "wait";
      if (c.ok !== null) wishAfter(c);
    });
  }

  /* The heart button squashes, hops into the bag; the bag squashes to receive it. */
  function collect(c) {
    var o = ghostOf(c.btn), hg = o.g, r = o.r;
    c.hg = hg;
    c.btn.classList.add("jd-fx-hide");
    var hx = r.left + r.width / 2, hy = r.top + r.height / 2;
    var dx = c.pos.x - hx, dy = c.pos.y - c.BH * 0.3 - hy;
    var a = hg.animate([
      { transform: "translate(0,0) scale(1,1) rotate(0deg)", offset: 0 },
      { transform: "translate(0,0) scale(1.15,.8) rotate(0deg)", offset: 0.2 },
      { transform: "translate(" + (dx * 0.5) + "px," + (Math.min(0, dy) - 34) + "px) scale(.9,1.12) rotate(-14deg)", offset: 0.55 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(.3) rotate(-30deg)", opacity: 0.9, offset: 1 }
    ], { duration: 460, easing: "ease-in-out", fill: "forwards" });
    a.onfinish = function () {
      if (c.hg && c.hg.parentNode) c.hg.parentNode.removeChild(c.hg);
      c.hg = null;
      c.bag.animate([
        { transform: "scale(1.18,.8)", offset: 0 },
        { transform: "scale(.9,1.14)", offset: 0.4 },
        { transform: "scale(1.04,.97)", offset: 0.72 },
        { transform: "scale(1)", offset: 1 }
      ], { duration: 380, easing: "ease-out" });
      c.btn.classList.remove("jd-fx-hide");
      c.btn.animate([
        { transform: "scale(.3)", offset: 0 },
        { transform: "scale(1.3)", offset: 0.45 },
        { transform: "scale(.92)", offset: 0.7 },
        { transform: "scale(1)", offset: 1 }
      ], { duration: 520, easing: "ease-out", composite: "add" });
      setTimeout(function () { leave(c, true); }, 420);
    };
  }

  /* The bag flies out: to the Wishlist link when saved, off-screen otherwise. */
  function leave(c, full) {
    var bag = c.bag, pos = c.pos || { x: window.innerWidth / 2, y: window.innerHeight / 2 }, BW = c.BW, BH = c.BH;
    var tgt = full ? nearest('a[href="wishlist.html"]', pos.x, pos.y) : null;
    var W = window.innerWidth, Hh = window.innerHeight;
    function fade() {
      var f = bag.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" });
      f.onfinish = function () { wishKill(c); };
      setTimeout(function () { wishKill(c); }, 500);
    }
    if (!full) {
      bag.animate([
        { transform: "rotate(0deg)", offset: 0 },
        { transform: "rotate(-10deg)", offset: 0.25 },
        { transform: "rotate(9deg)", offset: 0.5 },
        { transform: "rotate(-5deg)", offset: 0.75 },
        { transform: "rotate(0deg)", offset: 1 }
      ], { duration: 320, easing: "ease-in-out" });
    }
    var ant = bag.animate([
      { transform: "scale(1)", offset: 0 },
      { transform: "scale(1.14,.84)", offset: 0.6 },
      { transform: "scale(.94,1.1)", offset: 1 }
    ], { duration: 200, delay: full ? 0 : 320, easing: "ease-out", fill: "both" });
    ant.onfinish = function () {
      ant.cancel();
      place(bag, pos.x, pos.y, BW, BH);
      if (tgt) {
        var T0 = ctr(tgt), dist = Math.hypot(T0.x - pos.x, T0.y - pos.y);
        path(bag, pos, function () {
          if (document.contains(tgt)) { var q = ctr(tgt); if (q.w > 0) return q; }
          return T0;
        }, clamp(420 + dist * 0.5, 520, 900),
        { lift: clamp(dist * 0.35, 60, 170), lean: 16, s0: 1, s1: clamp(Math.min(T0.w, T0.h) * 0.8 / BH, 0.38, 0.7) },
        function () { F.catchFx(tgt); fade(); });
      } else {
        var E = { x: c.side < 0 ? -BW * 2 : W + BW * 2, y: pos.y - clamp(Hh * 0.25, 90, 200) };
        path(bag, pos, function () { return E; }, 620, { ease: ei, lift: 60, lean: 22, s0: 1, s1: 0.9 }, function () { wishKill(c); });
      }
    };
  }

  window.addEventListener("jd:wishlist", function (e) {
    var d = e.detail || {};
    wishCtx.slice().forEach(function (c) { if (String(c.id) === String(d.id)) wishDone(c, !!d.on); });
  });

  /* ---------------- Compare: a token flies to the compare tray ---------------- */
  var cmpCtx = [];
  function dropCmp(rec) { var i = cmpCtx.indexOf(rec); if (i > -1) cmpCtx.splice(i, 1); }

  function bounceBar(el) {
    if (!el || !document.contains(el)) return;
    el.animate([
      { transform: "scale(1,1)", offset: 0 },
      { transform: "scale(1.03,.82)", offset: 0.2 },
      { transform: "scale(.99,1.1)", offset: 0.45 },
      { transform: "scale(1.01,.97)", offset: 0.7 },
      { transform: "scale(1,1)", offset: 1 }
    ], { duration: 560, easing: "ease-out", composite: "add" });
  }

  function compareStart(btn) {
    var id = btn.getAttribute("data-compare"), svg = btn.querySelector("svg");
    var c = F.run(btn, {
      icon: svg ? svg.outerHTML : null,
      target: function (x, y) { return document.getElementById("jd-compare-tray") || nearest('a[href="compare.html"]', x, y); },
      catchFx: bounceBar
    });
    if (!c) return;
    var rec = { c: c, id: id };
    cmpCtx.push(rec);
    /* No selection event shortly after the click (limit reached, error): put the button back. */
    c.to = setTimeout(function () { dropCmp(rec); F.done(c, false); }, 800);
  }

  window.addEventListener("gambasket:compare:change", function (e) {
    var ids = (e.detail && e.detail.ids) || [];
    cmpCtx.slice().forEach(function (rec) {
      if (ids.indexOf(rec.id) > -1) { clearTimeout(rec.c.to); dropCmp(rec); F.done(rec.c, true); }
    });
  });

  /* ---------------- Rubber press for buttons that navigate or step ---------------- */
  function press(b) {
    b.animate([
      { transform: "scale(1,1)", offset: 0 },
      { transform: "scale(1.08,.86)", offset: 0.28 },
      { transform: "scale(.95,1.07)", offset: 0.55 },
      { transform: "scale(1.02,.98)", offset: 0.8 },
      { transform: "scale(1,1)", offset: 1 }
    ], { duration: 380, easing: "ease-out", composite: "add" });
  }

  document.addEventListener("click", function (e) {
    try {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t || rm.matches) return;
      var w = t.closest("[data-wish]");
      if (w) {
        if (w.disabled || w.classList.contains("jd-fx-hide") || w.getAttribute("aria-pressed") !== "false") return;
        if (wishCtx.some(function (c) { return c.btn === w; })) return;
        wishStart(w);
        return;
      }
      var m = t.closest("[data-compare]");
      if (m) {
        if (m.disabled || m.classList.contains("jd-fx-hide") || m.getAttribute("aria-pressed") !== "false") return;
        compareStart(m);
        return;
      }
      var p = t.closest("[data-pdp-buy],[data-checkout],[data-qty],[data-step],[data-remove]");
      if (p && !p.disabled) press(p);
    } catch (err) { /* cosmetic only */ }
  }, true);
})();
