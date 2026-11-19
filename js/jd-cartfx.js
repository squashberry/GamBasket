/* =========================================================
   JulaDirect — rubber "add to cart" effect.
   The whole Add to cart button squashes like rubber, shrinks into a
   basket, flies along an arc to the cart icon (header on desktop,
   header / floating nav on mobile) and the cart icon stretches like
   rubber to catch it. The button then springs back.

   Loaded after js/jd-core.js. Purely cosmetic: it wraps JD.addToCart
   only to learn whether the add succeeded, and never changes what the
   original handlers do. If anything fails, it cleans up and gets out
   of the way. Skipped for prefers-reduced-motion.
   ========================================================= */
(function () {
  "use strict";
  var bootStarted = Date.now();

  function boot() {
    var JD = window.JD;
    if (!JD || typeof JD.addToCart !== "function") {
      if (Date.now() - bootStarted < 10000) {
        window.setTimeout(boot, 60);
      } else {
        console.warn("[JulaDirect] add-to-cart animation could not find JD.addToCart.");
      }
      return;
    }
    if (JD.cartFx) return;
    if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return;

  var rm = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  var STYLE =
    ".jd-fx{position:fixed;z-index:2000;margin:0;padding:0;display:flex;align-items:center;justify-content:center;overflow:visible;pointer-events:none;transform-origin:50% 50%;backface-visibility:hidden;will-change:transform}" +
    ".jd-fx__lab{display:flex;align-items:center;justify-content:center;white-space:nowrap;transform-origin:50% 50%}" +
    ".jd-fx__lab svg{flex:none}" +
    ".jd-fx__bk{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;opacity:0;transform-origin:50% 60%}" +
    ".jd-fx__bk svg{width:64%;height:64%;display:block;overflow:visible}" +
    ".jd-fx-hide{visibility:hidden!important}" +
    ".jd-fx-ring{position:fixed;z-index:1999;margin:0;box-sizing:border-box;border:2.5px solid var(--jd-blue-500,#3b82f6);border-radius:50%;pointer-events:none}";
  var st = document.createElement("style");
  st.id = "jd-cartfx-css";
  st.textContent = STYLE;
  document.head.appendChild(st);

  var BASKET =
    '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
    '<path d="M9 14c0-5.2 3-8.6 7-8.6s7 3.4 7 8.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<rect x="12" y="9" width="8" height="7.5" rx="1.8" fill="#ffd166"/>' +
    '<path d="M3.5 14h25l-2.7 12a2.4 2.4 0 0 1-2.35 1.9H8.55A2.4 2.4 0 0 1 6.2 26z" fill="currentColor"/>' +
    '<path d="M11 18.5v5.5M16 18.5v5.5M21 18.5v5.5" style="stroke:var(--fxbg,#2563eb)" stroke-width="1.6" stroke-linecap="round"/>' +
    "</svg>";

  var SEL = "[data-add],[data-pdp-add]";
  var cur = null;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }

  /* The cart icon to fly to: the visible one nearest the button. */
  function pickTarget(x, y) {
    var all = [].slice.call(document.querySelectorAll("a[href]")).filter(function (a) {
      if (!visible(a)) return false;
      try {
        return /(?:^|\/)cart\.html$/i.test(new URL(a.href, window.location.href).pathname);
      } catch (e) {
        return false;
      }
    });
    var withBadge = all.filter(function (a) { return a.querySelector("[data-cart-count]"); });
    var list = withBadge.length ? withBadge : all, best = null, bd = 1e12;
    list.forEach(function (a) {
      var r = a.getBoundingClientRect(), dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y, dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = a; }
    });
    return best;
  }

  function cleanup(c) {
    clearTimeout(c.to);
    try { if (c.g && c.g.parentNode) c.g.parentNode.removeChild(c.g); } catch (e) {}
    try { c.btn.classList.remove("jd-fx-hide"); } catch (e) {}
    if (cur === c) cur = null;
  }

  /* Phase 1 + 2: rubber squash, then contract into a basket. */
  function run(btn) {
    var r = btn.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return null;
    var cs = getComputedStyle(btn);
    var bg = cs.backgroundColor;
    if (!bg || /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
      bg = (getComputedStyle(document.documentElement).getPropertyValue("--jd-blue-600") || "").trim() || "#2563eb";
    }
    var W = r.width, H = r.height, R = cs.borderRadius;
    var B = Math.round(clamp(Math.min(H * 0.95, W), 40, 56));
    var cx = r.left + W / 2, cy = r.top + H / 2;

    var g = document.createElement("div");
    g.className = "jd-fx";
    g.setAttribute("aria-hidden", "true");
    var s = g.style;
    s.left = r.left + "px"; s.top = r.top + "px"; s.width = W + "px"; s.height = H + "px";
    s.background = bg; s.color = cs.color; s.borderRadius = R;
    s.fontSize = cs.fontSize; s.fontWeight = cs.fontWeight; s.fontFamily = cs.fontFamily;
    s.letterSpacing = cs.letterSpacing; s.boxShadow = cs.boxShadow;
    s.setProperty("--fxbg", bg);
    var lab = document.createElement("span");
    lab.className = "jd-fx__lab";
    lab.innerHTML = btn.innerHTML;
    lab.style.gap = cs.columnGap && cs.columnGap !== "normal" ? cs.columnGap : "8px";
    var bk = document.createElement("span");
    bk.className = "jd-fx__bk";
    bk.innerHTML = BASKET;
    g.appendChild(lab);
    g.appendChild(bk);
    document.body.appendChild(g);
    btn.classList.add("jd-fx-hide");

    function box(w, h) { return { width: w + "px", height: h + "px", left: (cx - w / 2) + "px", top: (cy - h / 2) + "px" }; }
    var E = "ease-in-out";
    var kfs = [
      Object.assign({ offset: 0, borderRadius: R, transform: "scale(1,1)", easing: "ease-out" }, box(W, H)),
      Object.assign({ offset: 0.16, borderRadius: R, transform: "scale(1.07,.84)", easing: E }, box(W, H)),
      Object.assign({ offset: 0.4, borderRadius: (B / 2 + 8) + "px", transform: "scale(.9,1.14)", easing: E }, box(B + (W - B) * 0.32, H * 1.04)),
      Object.assign({ offset: 0.64, borderRadius: (B / 2) + "px", transform: "scale(1.12,.88)", easing: E }, box(B * 0.9, B * 1.08)),
      Object.assign({ offset: 0.84, borderRadius: (B / 2) + "px", transform: "scale(.96,1.05)", easing: E }, box(B * 1.04, B * 0.98)),
      Object.assign({ offset: 1, borderRadius: (B / 2) + "px", transform: "scale(1,1)" }, box(B, B))
    ];
    var sq = g.animate(kfs, { duration: 600, fill: "forwards" });
    lab.animate([
      { opacity: 1, transform: "scale(1)", offset: 0 },
      { opacity: 0, transform: "scale(.7)", offset: 0.3 },
      { opacity: 0, transform: "scale(.7)", offset: 1 }
    ], { duration: 600, fill: "forwards" });
    bk.animate([
      { opacity: 0, transform: "scale(.3) rotate(-20deg)", offset: 0 },
      { opacity: 0, transform: "scale(.3) rotate(-20deg)", offset: 0.34 },
      { opacity: 1, transform: "scale(1.25) rotate(8deg)", offset: 0.64 },
      { opacity: 1, transform: "scale(.94) rotate(-3deg)", offset: 0.82 },
      { opacity: 1, transform: "scale(1) rotate(0deg)", offset: 1 }
    ], { duration: 600, fill: "forwards" });

    var c = { btn: btn, g: g, lab: lab, bk: bk, sq: sq, cx: cx, cy: cy, B: B, W: W, H: H, R: R,
      state: "squash", ok: null, called: false, idle: null, to: 0, t: performance.now() };
    sq.finished.then(function () {
      c.state = "wait";
      try {
        c.idle = bk.animate([{ transform: "rotate(-7deg)" }, { transform: "rotate(7deg)" }],
          { duration: 420, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
      } catch (e) {}
      if (c.ok !== null) settle(c);
    }).catch(function () {});
    return c;
  }

  function done(c, ok) {
    if (c.ok !== null) return;
    c.ok = ok;
    clearTimeout(c.to);
    if (c.state === "wait") settle(c);
  }

  function settle(c) {
    try { if (c.ok) fly(c); else fail(c); } catch (e) { cleanup(c); }
  }

  /* Freeze the contracted basket so animations can be cancelled safely. */
  function freeze(c) {
    var s = c.g.style, B = c.B;
    s.left = (c.cx - B / 2) + "px"; s.top = (c.cy - B / 2) + "px";
    s.width = B + "px"; s.height = B + "px"; s.borderRadius = (B / 2) + "px"; s.transform = "none";
    c.lab.style.opacity = "0"; c.bk.style.opacity = "1";
    if (c.idle) c.idle.cancel();
    c.sq.cancel();
  }

  /* Phase 3: the button springs back, the basket flies to the cart. */
  function fly(c) {
    var g = c.g, btn = c.btn, B = c.B, S = { x: c.cx, y: c.cy };
    freeze(c);
    g.style.boxShadow = "0 12px 26px rgba(15,23,42,.32)";
    btn.classList.remove("jd-fx-hide");
    btn.animate([
      { transform: "scale(.35)", opacity: 0, offset: 0 },
      { transform: "scale(1.1,.92)", opacity: 1, offset: 0.45 },
      { transform: "scale(.97,1.03)", opacity: 1, offset: 0.7 },
      { transform: "scale(1)", opacity: 1, offset: 1 }
    ], { duration: 560, easing: "ease-out" });

    var tg = pickTarget(S.x, S.y);
    function T() {
      if (tg && document.contains(tg)) {
        var r = tg.getBoundingClientRect();
        if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2, sz: Math.min(r.width, r.height) };
      }
      return { x: window.innerWidth - 34, y: -24, sz: 30 };
    }
    var T0 = T(), dist = Math.hypot(T0.x - S.x, T0.y - S.y);
    var dur = clamp(420 + dist * 0.5, 520, 950), t0 = performance.now();

    function step(now) {
      var u = clamp((now - t0) / dur, 0, 1), e = ease(u), tp = T();
      var kx = (S.x + tp.x) / 2, ky = Math.min(S.y, tp.y) - clamp(dist * 0.38, 70, 190);
      var px = (1 - e) * (1 - e) * S.x + 2 * (1 - e) * e * kx + e * e * tp.x;
      var py = (1 - e) * (1 - e) * S.y + 2 * (1 - e) * e * ky + e * e * tp.y;
      var vx = 2 * (1 - e) * (kx - S.x) + 2 * e * (tp.x - kx);
      var vy = 2 * (1 - e) * (ky - S.y) + 2 * e * (tp.y - ky);
      var sp = Math.sin(Math.PI * u);
      var lean = (vx / (Math.abs(vx) + Math.abs(vy) + 1)) * 18 * sp + Math.sin(u * Math.PI * 2) * 7;
      var sc = lerp(1, clamp(tp.sz * 0.8 / B, 0.42, 0.78), e);
      g.style.transform = "translate(" + (px - S.x) + "px," + (py - S.y) + "px) rotate(" + lean + "deg) scale(" + (sc * (1 - 0.16 * sp)) + "," + (sc * (1 + 0.22 * sp)) + ")";
      if (u < 1) requestAnimationFrame(step); else land(c, tg);
    }
    requestAnimationFrame(step);
  }

  /* Phase 4: the basket drops in and the cart icon catches it like rubber. */
  function land(c, tg) {
    var g = c.g, tr = g.style.transform;
    var a = g.animate([
      { transform: tr, opacity: 1 },
      { transform: tr + " scale(.25)", opacity: 0 }
    ], { duration: 150, easing: "ease-in", fill: "forwards" });
    a.onfinish = function () { cleanup(c); };
    setTimeout(function () { cleanup(c); }, 600);
    catchFx(tg);
  }

  function catchFx(tg) {
    if (!tg || !document.contains(tg)) return;
    tg.animate([
      { transform: "scale(1,1)", offset: 0 },
      { transform: "scale(1.34,.7)", offset: 0.16 },
      { transform: "scale(.8,1.28)", offset: 0.36 },
      { transform: "scale(1.14,.9)", offset: 0.56 },
      { transform: "scale(.96,1.05)", offset: 0.76 },
      { transform: "scale(1,1)", offset: 1 }
    ], { duration: 680, easing: "ease-out" });
    var r = tg.getBoundingClientRect();
    var ring = document.createElement("div");
    ring.className = "jd-fx-ring";
    ring.style.left = r.left + "px"; ring.style.top = r.top + "px";
    ring.style.width = r.width + "px"; ring.style.height = r.height + "px";
    document.body.appendChild(ring);
    var ra = ring.animate([{ transform: "scale(.6)", opacity: 0.7 }, { transform: "scale(1.9)", opacity: 0 }], { duration: 560, easing: "ease-out" });
    ra.onfinish = function () { if (ring.parentNode) ring.parentNode.removeChild(ring); };
    var bd = tg.querySelector("[data-cart-count]");
    if (bd) {
      bd.animate([
        { transform: "scale(1)", offset: 0 },
        { transform: "scale(1.7)", offset: 0.35 },
        { transform: "scale(.88)", offset: 0.65 },
        { transform: "scale(1)", offset: 1 }
      ], { duration: 560, delay: 90, easing: "ease-out" });
    }
  }

  /* Failure (or login redirect): the basket re-inflates back into the button. */
  function fail(c) {
    var g = c.g, btn = c.btn, B = c.B;
    freeze(c);
    var r = btn.getBoundingClientRect();
    if (r.width < 10) { cleanup(c); return; }
    var from = { left: g.style.left, top: g.style.top, width: B + "px", height: B + "px", borderRadius: (B / 2) + "px" };
    var to = { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", borderRadius: c.R };
    var a = g.animate([
      Object.assign({ offset: 0, transform: "scale(1,1)" }, from),
      Object.assign({ offset: 0.6, transform: "scale(1.08,.9)" }, to),
      Object.assign({ offset: 0.8, transform: "scale(.98,1.03)" }, to),
      Object.assign({ offset: 1, transform: "scale(1,1)" }, to)
    ], { duration: 420, easing: "ease-out", fill: "forwards" });
    c.lab.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1, offset: 1 }], { duration: 420, fill: "forwards" });
    c.bk.animate([{ opacity: 1, offset: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 0, offset: 1 }], { duration: 420, fill: "forwards" });
    a.onfinish = function () { cleanup(c); };
    setTimeout(function () { cleanup(c); }, 900);
  }

  /* Learn the outcome of the real add-to-cart call (the single funnel). */
  var orig = JD.addToCart;
  JD.addToCart = function () {
    var p = orig.apply(this, arguments), c = cur;
    if (c && !c.called && performance.now() - c.t < 600) {
      c.called = true;
      clearTimeout(c.to);
      c.to = setTimeout(function () { done(c, false); }, 8000);
      Promise.resolve(p).then(
        function (res) { done(c, !!(res && res.success)); },
        function () { done(c, false); }
      );
    }
    return p;
  };

  document.addEventListener("click", function (e) {
    try {
      var b = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (!b || b.disabled || b.getAttribute("aria-disabled") === "true" || b.classList.contains("jd-fx-hide")) return;
      if (rm.matches) return;
      var c = run(b);
      if (!c) return;
      cur = c;
      /* If the original handler never calls JD.addToCart, put the button back. */
      c.to = setTimeout(function () { if (!c.called) done(c, false); }, 700);
    } catch (err) { if (cur) cleanup(cur); }
  }, true);

  JD.cartFx = { version: 2 };
  }

  boot();
})();
