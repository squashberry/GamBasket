/* =====================================================================
   JulaDirect: rubber splash.
   A little blue ball bounces in, bursts into rubber letters, the word
   squashes and morphs into the cart, a second cart rolls in and smashes
   the first one out of the screen, the winner does a victory bounce and
   the complete logo is revealed.

   One canvas, no libraries. Every frame is a pure function of time
   (render(t)), so it is deterministic and easy to inspect.
   Brand colour: change BLUE (and its tints) below to recolour everything.
   ===================================================================== */
(function () {
  "use strict";
  var D = document, R = D.documentElement;
  if (!R.classList.contains("jd-splash-on") || window.__jdSplash) return;

  /* ---------- palette (all one blue family) ---------- */
  var BLUE = "#1451e6", BL = "#2f6bff", BD = "#0e3dbd", BX = "#7ea6ff", NAVY = "10,26,63";
  var BR = 20, BG = 81, BB = 230; /* BLUE as rgb, used by the goo pass */
  var STACK = '"Nunito","Varela Round","SF Pro Rounded","Arial Rounded MT Bold",ui-rounded,"Plus Jakarta Sans",system-ui,"Segoe UI",Roboto,Arial,sans-serif';
  var WORD = "JulaDirect";
  var TOT = 9.0;
  var RM = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var nv = navigator;
  var LITE = !!((nv.deviceMemory && nv.deviceMemory <= 2) || (nv.hardwareConcurrency && nv.hardwareConcurrency <= 2)) || /[?&]lite=1/.test(location.search);

  /* ---------- tiny helpers ---------- */
  var PI = Math.PI;
  function cl(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sg(t, a, b) { return cl((t - a) / (b - a), 0, 1); }
  function lp(a, b, x) { return a + (b - a) * x; }
  function io(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function eo(x) { return 1 - Math.pow(1 - x, 3); }
  function elo(u, p) { if (u <= 0) return 0; if (u >= 1) return 1; p = p || 0.34; return Math.pow(2, -10 * u) * Math.sin((u - p / 4) * 2 * PI / p) + 1; }
  function dmp(t, A, k, w) { return t < 0 ? 0 : A * Math.exp(-k * t) * Math.cos(w * t); }
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- timeline (seconds) ---------- */
  var IMP = [0.6, 1.05, 1.4, 1.65, 1.82];      /* ball impacts */
  var APEX = [0.3, 0.19, 0.1, 0.045];          /* bounce heights (x H) */
  var T_BURST = 2.0;                            /* ball bursts into letters */
  var T_ANT = 3.05, T_SQ0 = 3.2, T_SQ1 = 3.62, T_FLOW = 3.66, T_CART = 4.4;
  var T_C2_IN = 4.75, T_C2_WIND = 5.15, T_C2_GO = 5.45, T_HIT = 5.95;
  var T_VIC = 6.45, T_UP = 7.0, T_SHINE = 7.7;

  /* ---------- state ---------- */
  var CB, cv, g, W, H, DPR, S, fs, fsF, cx, cy0, cyF, floorT, floorC, rBall, GRAV, kU;
  var skipBtn, ended = false, raf = 0, T = 0, last = 0, frames = 0, w0 = 0;
  var sprite = null, spriteW = 0, adv = [], slotX = [], wordW = 0, finalAdv = [], finalX = [], finalW = 0;
  var gf, gfx, gSpr, gR = {}, A0 = [], B0 = [], NP = 0, goo = null;
  var lc, lcx;
  var P = [], pT = 0, evl = [], evi = 0, prng;
  var CARTS = [], letterR = [];

  /* ---------- vector cart (hand traced from the supplied logo) ---------- */
  var CART_STROKES = [
    /* [path, width] in a 100 x 92 box */
    ["M5 36H26", 5.6], ["M11 47H30", 5.6], ["M18 58H32", 5.6],                 /* speed lines */
    ["M23 14H30Q34.5 14 36 19L46.5 52", 5.6],                                  /* handle */
    ["M38.5 25H90L83.5 52H46.5", 5.6],                                         /* basket */
    ["M55.5 25L59 52M72.5 25L71 52", 4.2], ["M42 38.5H87", 4.2],              /* grid */
    ["M46 61H88", 5.6]                                                         /* rail */
  ];
  function paintCart(c, k, depth) {
    c.lineCap = "round"; c.lineJoin = "round";
    CART_STROKES.forEach(function (s) { c.lineWidth = s[1] * k; c.stroke(new Path2D(s[0])); });
    c.beginPath(); c.lineWidth = 3.8 * k;
    c.arc(54, 74, 5.2, 0, 2 * PI); c.stroke();
    c.beginPath(); c.arc(80, 74, 5.2, 0, 2 * PI); c.stroke();
  }
  function buildSprite() {
    var k = S / 100, pad = 1.3, sz = Math.ceil(S * pad * DPR);
    sprite = D.createElement("canvas"); sprite.width = sprite.height = sz;
    var c = sprite.getContext("2d");
    c.scale(DPR, DPR);
    c.translate(S * pad / 2, S * pad / 2);
    c.scale(k, k);
    c.translate(-47, -47);
    /* depth, body, highlight (all blue-family tints) */
    c.save(); c.translate(0, 2.6); c.strokeStyle = BD; paintCart(c, 1); c.restore();
    var gr = c.createLinearGradient(0, 10, 0, 82); gr.addColorStop(0, BL); gr.addColorStop(1, BLUE);
    c.strokeStyle = gr; paintCart(c, 1);
    c.save(); c.translate(-0.7, -1.1); c.strokeStyle = "rgba(190,214,255,.55)";
    CART_STROKES.forEach(function (s) { c.lineWidth = 1.5; c.stroke(new Path2D(s[0])); });
    c.restore();
    spriteW = S * pad;
  }
  function drawCart(x, y, sx, sy, rot, alpha, pivotY) {
    /* (x,y) = sprite centre; pivotY = offset of squash pivot from centre (px) */
    g.save();
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.translate(x, y + (pivotY || 0)); g.rotate(rot || 0); g.scale(sx, sy); g.translate(0, -(pivotY || 0));
    g.drawImage(sprite, -spriteW / 2, -spriteW / 2, spriteW, spriteW);
    g.restore();
  }

  /* ---------- layout ---------- */
  function measure() {
    var m = D.createElement("canvas").getContext("2d");
    m.font = "800 100px " + STACK;
    var ws = WORD.split("").map(function (ch) { return m.measureText(ch).width; }), tot = ws.reduce(function (a, b) { return a + b; }, 0);
    return { ws: ws, tot: tot };
  }
  function layout() {
    W = window.innerWidth || R.clientWidth; H = window.innerHeight || R.clientHeight;
    DPR = Math.min(window.devicePixelRatio || 1, LITE ? 1.5 : 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    S = cl(Math.min(W * 0.8, H * 0.62) * 0.62, 130, 340);
    kU = S / 100;
    var m = measure(), fit = (W * 0.86) / (m.tot / 100);
    fs = Math.min(S * 0.42, fit);
    fsF = Math.min(S * 0.3, (W * 0.8) / (m.tot / 100));
    CB = S * 0.33; cx = W / 2; cy0 = H * 0.5; cyF = H * 0.5 - S * 0.17;
    floorT = cy0 + fs * 0.34; floorC = cy0 + CB;
    rBall = Math.max(9, S * 0.065); GRAV = H * 2.4;
    /* word layout (big, centred) */
    adv = m.ws.map(function (w) { return w * fs / 100; }); wordW = adv.reduce(function (a, b) { return a + b; }, 0);
    slotX = []; var x = cx - wordW / 2; adv.forEach(function (a) { slotX.push(x + a / 2); x += a; });
    /* final lockup layout (smaller, under the cart) */
    finalAdv = m.ws.map(function (w) { return w * fsF / 100; }); finalW = finalAdv.reduce(function (a, b) { return a + b; }, 0);
    finalX = []; x = cx - finalW / 2; finalAdv.forEach(function (a) { finalX.push(x + a / 2); x += a; });
    buildSprite();
    letterR = []; var r = rng(7); for (var i = 0; i < WORD.length; i++) letterR.push(r());
    if (!RM) buildGoo();
    c2Setup();
    buildEvents();
    pReset();
  }

  /* ---------- goo (point-cloud morph, metaball threshold) ---------- */
  function sample(drawFn, x0, y0, w, h, step) {
    var c = D.createElement("canvas"); c.width = Math.ceil(w); c.height = Math.ceil(h);
    var q = c.getContext("2d"); q.translate(-x0, -y0); drawFn(q);
    var d = q.getImageData(0, 0, c.width, c.height).data, pts = [];
    for (var y = 0; y < c.height; y += step) for (var x = 0; x < c.width; x += step) if (d[(Math.floor(y) * c.width + Math.floor(x)) * 4 + 3] > 128) pts.push([x0 + x, y0 + y]);
    return pts;
  }
  function buildGoo() {
    var step = Math.max(2.6, S / 84), mg = fs * 0.5;
    var wx0 = cx - wordW / 2 - mg, wy0 = cy0 - fs * 1.1, ww = wordW + 2 * mg, wh = fs * 1.8;
    A0 = sample(function (q) {
      q.font = "800 " + fs + "px " + STACK; q.textAlign = "center"; q.textBaseline = "alphabetic";
      q.fillStyle = q.strokeStyle = "#000"; q.lineJoin = "round"; q.lineWidth = fs * 0.06;
      for (var i = 0; i < WORD.length; i++) { q.strokeText(WORD[i], slotX[i], floorT); q.fillText(WORD[i], slotX[i], floorT); }
    }, wx0, wy0, ww, wh, step);
    var bx0 = cx - S * 0.7, by0 = cy0 - S * 0.7;
    B0 = sample(function (q) { q.drawImage(sprite, cx - spriteW / 2, cy0 - spriteW / 2, spriteW, spriteW); }, bx0, by0, S * 1.4, S * 1.4, step);
    A0.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    B0.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    NP = Math.min(LITE ? 2000 : 3000, Math.max(A0.length, B0.length));
    var a2 = [], b2 = [], rr = rng(11);
    for (var i = 0; i < NP; i++) {
      var pa = A0[Math.floor(i * A0.length / NP)], pb = B0[Math.floor(i * B0.length / NP)];
      a2.push([pa[0] + (rr() - 0.5) * step * 0.6, pa[1] + (rr() - 0.5) * step * 0.6]);
      b2.push([pb[0] + (rr() - 0.5) * step * 0.6, pb[1] + (rr() - 0.5) * step * 0.6]);
    }
    A0 = a2; B0 = b2;
    var rw = Math.max(ww, S * 1.5), ry0 = Math.min(wy0, cy0 - S * 0.75), ry1 = Math.max(wy0 + wh, cy0 + S * 0.75);
    gR = { x: cx - rw / 2, y: ry0, w: rw, h: ry1 - ry0, q: LITE ? 0.38 : 0.5, step: step };
    var q = gR.q;
    gf = D.createElement("canvas"); gf.width = Math.ceil(gR.w * q); gf.height = Math.ceil(gR.h * q); gfx = gf.getContext("2d", { willReadFrequently: true });
    var rs = Math.max(3, Math.round(step * 1.15 * q * 2)); gSpr = D.createElement("canvas"); gSpr.width = gSpr.height = rs * 2;
    var s = gSpr.getContext("2d"), gr = s.createRadialGradient(rs, rs, 0, rs, rs, rs);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.5, "rgba(0,0,0,.7)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    s.fillStyle = gr; s.fillRect(0, 0, rs * 2, rs * 2);
    gR.rs = rs;
    goo = { a: new Array(NP), ctr: [cx, cy0 - fs * 0.35] };
  }
  /* group squash / twist applied to the word before it flows into the cart */
  function wordXf(t) {
    var s = io(sg(t, T_SQ0, T_SQ1)), w = t - T_SQ1;
    var sx = lp(1, 0.4, s) + dmp(w, 0.07, 8, 30) * s, sy = lp(1, 1.6, s) - dmp(w, 0.12, 8, 30) * s;
    var rot = (lp(0, -0.2, io(sg(t, T_SQ0, T_SQ0 + 0.2))) + lp(0, 0.34, io(sg(t, T_SQ0 + 0.2, T_SQ1)))) * (1 - sg(t, T_SQ1, T_FLOW + 0.3)) + dmp(w, 0.08, 7, 26);
    return { sx: sx, sy: sy, rot: rot };
  }
  function pointAt(i, t) {
    var a = A0[i], b = B0[i], X = wordXf(Math.min(t, T_FLOW)), c = goo.ctr;
    var dx = (a[0] - c[0]) * X.sx, dy = (a[1] - c[1]) * X.sy, cs = Math.cos(X.rot), sn = Math.sin(X.rot);
    var ax = c[0] + dx * cs - dy * sn, ay = c[1] + dx * sn + dy * cs;
    var u = i / NP, e = elo(sg(t, T_FLOW + 0.18 * u, T_FLOW + 0.18 * u + 0.52), 0.42);
    var sw = Math.sin(PI * cl(e, 0, 1)) * S * 0.12 * (letterR[i % 10] - 0.5);
    return [lp(ax, b[0], e) + sw, lp(ay, b[1], e) - Math.sin(PI * cl(e, 0, 1)) * S * 0.06, e];
  }
  function drawGoo(t, alpha) {
    var q = gR.q, rs = gR.rs;
    gfx.setTransform(1, 0, 0, 1, 0, 0); gfx.clearRect(0, 0, gf.width, gf.height);
    gfx.globalCompositeOperation = "lighter";
    for (var i = 0; i < NP; i++) {
      var p = pointAt(i, t), px = (p[0] - gR.x) * q, py = (p[1] - gR.y) * q, sc = (1 + 0.45 * Math.sin(PI * cl(p[2], 0, 1))) * lp(1, 0.7, sg(p[2], 0.7, 1));
      var s = rs * sc; gfx.drawImage(gSpr, px - s, py - s, s * 2, s * 2);
    }
    var im = gfx.getImageData(0, 0, gf.width, gf.height), d = im.data;
    for (var k = 0; k < d.length; k += 4) {
      var a = d[k + 3] / 255, s2 = a <= 0.5 ? 0 : a >= 0.68 ? 1 : (a - 0.5) / 0.18; s2 = s2 * s2 * (3 - 2 * s2);
      d[k] = BR; d[k + 1] = BG; d[k + 2] = BB; d[k + 3] = s2 * 255;
    }
    gfx.putImageData(im, 0, 0);
    g.save(); g.globalAlpha = alpha; g.imageSmoothingEnabled = true; g.drawImage(gf, gR.x, gR.y, gR.w, gR.h); g.restore();
  }

  /* ---------- ball ---------- */
  function ballXY(t) {
    var xs = W * 0.2, x = lp(xs, cx, cl((t - 0.2) / (IMP[4] - 0.2), 0, 1)), y, vy = 0, i;
    if (t < IMP[0]) { var u = cl((t - 0.2) / (IMP[0] - 0.2), 0, 1); y = lp(-3 * rBall, floorT - rBall, u * u); vy = 2 * u * (floorT + 2 * rBall) / (IMP[0] - 0.2); }
    else { y = floorT - rBall; for (i = 0; i < 4; i++) if (t >= IMP[i] && t < IMP[i + 1]) { var d = IMP[i + 1] - IMP[i], uu = (t - IMP[i]) / d; y = floorT - rBall - APEX[i] * H * 4 * uu * (1 - uu); vy = -APEX[i] * H * 4 * (1 - 2 * uu) / d; } }
    return { x: x, y: y, vy: vy };
  }
  function drawBall(t) {
    if (t < 0.2 || t >= T_BURST) return;
    var b = ballXY(t), d = 0, i, amps = [0.55, 0.45, 0.36, 0.28, 0.24];
    for (i = 0; i < 5; i++) if (t >= IMP[i]) d += dmp(t - IMP[i], amps[i], 15, 38);
    var st = cl(Math.abs(b.vy) / (H * 2.4), 0, 0.35), sw = io(sg(t, 1.86, T_BURST));
    var sy = (1 + st) * (1 - d) * (1 - 0.25 * sw), sx = (1 / Math.sqrt(1 + st)) * (1 + d * 0.9) * (1 + 0.5 * sw);
    var hN = cl((floorT - rBall - b.y) / (H * 0.3), 0, 1), sa = 0.24 * (1 - hN * 0.7), srx = rBall * (1.15 - hN * 0.55) * (1 + 0.4 * sw);
    g.save(); g.fillStyle = "rgba(" + NAVY + "," + sa + ")"; g.beginPath(); g.ellipse(b.x, floorT + 1, srx * 1.2, srx * 0.3, 0, 0, 2 * PI); g.fill(); g.restore();
    g.save(); g.translate(b.x, b.y + rBall); g.scale(sx, sy); g.translate(0, -rBall);
    var gr = g.createRadialGradient(-rBall * 0.35, -rBall * 0.4, rBall * 0.1, 0, 0, rBall * 1.1);
    gr.addColorStop(0, BX); gr.addColorStop(0.35, BL); gr.addColorStop(1, BD);
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rBall, 0, 2 * PI); g.fill();
    g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.ellipse(-rBall * 0.35, -rBall * 0.45, rBall * 0.3, rBall * 0.18, -0.6, 0, 2 * PI); g.fill();
    g.restore();
  }

  /* ---------- letters ---------- */
  function letterPos(i, t) {
    var tl = T_BURST + i * 0.04, u = cl((t - tl) / 0.42, 0, 1), b = ballXY(IMP[4] + 0.1);
    var x0 = cx, y0 = floorT - rBall * 1.3, peak = H * (0.15 + 0.1 * letterR[i]);
    var e = Math.pow(u, 0.85);
    return { x: lp(x0, slotX[i], e), y: lp(y0, floorT, u) - 4 * peak * u * (1 - u), u: u, land: tl + 0.42 };
  }
  function glyph(ch, size, depth, hi) {
    g.font = "800 " + size + "px " + STACK; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.lineJoin = "round";
    g.fillStyle = g.strokeStyle = BD; g.lineWidth = size * 0.07;
    g.strokeText(ch, 0, depth); g.fillText(ch, 0, depth);
    var gr = g.createLinearGradient(0, -size * 0.78, 0, 0); gr.addColorStop(0, BL); gr.addColorStop(1, BLUE);
    g.strokeStyle = BLUE; g.lineWidth = size * 0.05; g.strokeText(ch, 0, 0);
    g.fillStyle = gr; g.fillText(ch, 0, 0);
    if (hi) { g.strokeStyle = "rgba(200,220,255,.45)"; g.lineWidth = size * 0.014; g.save(); g.translate(-size * 0.012, -size * 0.02); g.strokeText(ch, 0, 0); g.restore(); }
  }
  function drawLetters(t) {
    var i, p, v, ang, sp, k, sx, sy, rot, dd, fl;
    for (i = 0; i < WORD.length; i++) {
      var tl = T_BURST + i * 0.04; if (t < tl) continue;
      p = letterPos(i, t);
      var p2 = letterPos(i, t + 0.012); v = { x: (p2.x - p.x) / 0.012, y: (p2.y - p.y) / 0.012 };
      sp = Math.hypot(v.x, v.y); k = p.u < 1 ? cl(sp / (H * 3.4), 0, 0.6) : 0; ang = Math.atan2(v.y, v.x);
      var s0 = p.u < 1 ? lp(0.3, 1, Math.sqrt(p.u)) : 1, w = t - p.land;
      dd = dmp(w, 0.55, 7.5, 24); fl = p.u >= 1 ? 1 : 0;
      sx = s0 * (1 + dd * 0.8 * fl); sy = s0 * (1 - dd * fl) * (1 + 0.025 * Math.sin(9 * t - i * 0.7) * fl);
      rot = (i % 2 ? 1 : -1) * ((1 - p.u) * (1.2 + 0.4 * letterR[i])) + (i % 2 ? 1 : -1) * dmp(w, 0.1, 6, 20) * fl;
      /* contact shadow */
      if (p.u >= 1 || p.u > 0.85) { g.save(); g.fillStyle = "rgba(" + NAVY + ",.16)"; g.beginPath(); g.ellipse(slotX[i], floorT + 2, adv[i] * 0.42, fs * 0.04, 0, 0, 2 * PI); g.fill(); g.restore(); }
      g.save(); g.translate(p.x, p.y); g.rotate(rot);
      if (k > 0) { g.rotate(ang); g.scale(1 + k, 1 / (1 + k * 0.7)); g.rotate(-ang); }
      g.scale(sx, sy); glyph(WORD[i], fs, fs * 0.05, true); g.restore();
    }
  }

  /* ---------- carts ---------- */
  function cart1(t) {
    /* the stationary cart: pop, idle, then launched by the hit */
    var s = { x: cx, y: cy0, sx: 1, sy: 1, rot: 0, k: 0, on: t >= T_CART && t < T_HIT + 0.9, trail: false };
    if (t < T_CART) return s;
    var w = t - T_CART, d = dmp(w, 0.5, 6, 22);
    s.sx = 1 + d * 0.8; s.sy = 1 - d * 0.9; s.pv = CB;
    var idle = 1 - sg(t, T_C2_GO, T_HIT);
    s.sy += 0.018 * Math.sin(4.2 * t) * idle; s.rot = 0.012 * Math.sin(3.1 * t) * idle;
    if (t >= T_HIT) {
      var h = t - T_HIT, hold = 0.075;
      if (h < hold) { s.sx = 1 - 0.38 * (h / hold); s.sy = 1 + 0.25 * (h / hold); s.rot = 0; }
      else {
        var a = h - hold, vx = -(cx + S) / 0.62, vy = -H * 1.25, gg = H * 2.6;
        s.x = cx + vx * a; s.y = cy0 + vy * a + 0.5 * gg * a * a; s.rot = -a * 21;
        var sp = Math.hypot(vx, vy + gg * a); s.k = cl(sp / (H * 3.6), 0, 0.5); s.ang = Math.atan2(vy + gg * a, vx);
        s.sx = 1 + 0.16 * Math.sin(42 * a); s.sy = 1 - 0.16 * Math.sin(42 * a); s.pv = 0; s.trail = true;
      }
    }
    return s;
  }
  var C2R, XHIT, XW, XPEEK, XSTART;
  function c2Setup() { C2R = S * 0.45; XSTART = W + S * 0.85; XPEEK = W - S * 0.3; XW = XPEEK + S * 0.2; XHIT = cx + S * 0.86; }
  function c2x(t) {
    if (t < T_C2_IN) return XSTART;
    if (t < T_C2_WIND) return lp(XSTART, XPEEK, eo(sg(t, T_C2_IN, T_C2_WIND)));
    if (t < T_C2_GO) return lp(XPEEK, XW, io(sg(t, T_C2_WIND, T_C2_GO)));
    if (t < T_HIT) return lp(XW, XHIT, Math.pow(sg(t, T_C2_GO, T_HIT), 2.3));
    return lp(XHIT, cx, elo(sg(t, T_HIT + 0.04, T_HIT + 0.6), 0.5));
  }
  function cart2(t) {
    var s = { x: c2x(t), y: cy0, sx: 1, sy: 1, rot: 0, k: 0, on: t >= T_C2_IN - 0.2, pv: 0, dir: 0 };
    var th0 = (c2x(Math.min(t, T_HIT)) - XSTART) / C2R;
    if (t < T_HIT) {
      s.rot = th0; var sp = (c2x(t + 0.016) - c2x(t - 0.016)) / 0.032, sk = cl(Math.abs(sp) / (W * 1.6), 0, 0.3);
      s.sx = 1 + sk * 0.7; s.sy = 1 - sk * 0.5;
      var wi = sg(t, T_C2_WIND, T_C2_GO); if (t >= T_C2_WIND && t < T_C2_GO) { var cr = Math.sin(PI * wi); s.sx = 1 - cr * 0.2; s.sy = 1 + cr * 0.12; }
      s.y = cy0 - Math.abs(Math.sin(th0 * 2)) * S * 0.035 * cl(Math.abs(sp) / (W * 0.4), 0, 1);
      s.dir = sp;
    } else {
      var thEnd = Math.round(th0 / (2 * PI)) * 2 * PI, w = t - T_HIT;
      s.rot = lp(th0, thEnd, io(sg(t, T_HIT, T_HIT + 0.5))) + dmp(w - 0.1, 0.1, 6, 22);
      var d = dmp(w, 0.5, 9, 30); s.sx = 1 - d * 0.95 * 0.9; s.sy = 1 + d * 0.7; s.pv = CB;
      /* victory bounce */
      var v = t - T_VIC;
      if (v > -0.12) {
        var cr1 = Math.sin(PI * sg(t, T_VIC - 0.12, T_VIC));
        s.sx *= 1 + cr1 * 0.12; s.sy *= 1 - cr1 * 0.2;
        var u1 = sg(t, T_VIC, T_VIC + 0.4), up1 = 4 * u1 * (1 - u1) * S * 0.3;
        var u2 = sg(t, T_VIC + 0.62, T_VIC + 0.9), up2 = 4 * u2 * (1 - u2) * S * 0.1;
        s.y = cy0 - up1 - up2;
        var air = (u1 > 0 && u1 < 1) ? 1 : (u2 > 0 && u2 < 1) ? 0.6 : 0;
        s.sx *= 1 - air * 0.1; s.sy *= 1 + air * 0.18; s.pv = air ? 0 : s.pv;
        var l1 = dmp(t - (T_VIC + 0.4), 0.28, 11, 30) * (u1 >= 1 ? 1 : 0), l2 = dmp(t - (T_VIC + 0.9), 0.16, 10, 30) * (u2 >= 1 ? 1 : 0);
        s.sx *= 1 + l1 * 0.9 + l2 * 0.9; s.sy *= 1 - l1 * 0.9 - l2 * 0.9;
        s.rot += 0.14 * Math.sin((t - T_VIC) * 15) * Math.exp(-(t - T_VIC) * 2.2) * (t > T_VIC ? 1 : 0);
      }
    }
    /* settle upward into the final lockup position */
    var up = elo(sg(t, T_UP, T_UP + 0.55), 0.5);
    s.y += (cyF - cy0) * up;
    return s;
  }
  function floorShadow(x, y, rx, a) { g.save(); g.fillStyle = "rgba(" + NAVY + "," + a + ")"; g.beginPath(); g.ellipse(x, y, rx, rx * 0.16, 0, 0, 2 * PI); g.fill(); g.restore(); }
  function drawC(s) {
    if (!s.on) return;
    g.save();
    if (s.k > 0 && s.ang != null) { g.translate(s.x, s.y); g.rotate(s.ang); g.scale(1 + s.k, 1 / (1 + s.k * 0.6)); g.rotate(-s.ang); g.translate(-s.x, -s.y); }
    drawCart(s.x, s.y, s.sx, s.sy, s.rot, 1, s.pv || 0);
    g.restore();
  }

  /* ---------- final wordmark ---------- */
  function drawFinalWord(t) {
    for (var i = 0; i < WORD.length; i++) {
      var t0 = T_UP + 0.1 + i * 0.045, u = (t - t0) / 0.5; if (u <= 0) continue;
      var e = elo(cl(u, 0, 1), 0.4), st = Math.sin(PI * cl(u, 0, 1)) * 0.25 * (1 - cl(u, 0, 1)), wob = dmp(t - (t0 + 0.5), 0.07, 6, 22);
      var x = finalX[i], y = cyF + CB + fsF * 1.3;
      g.save(); g.translate(x, y); g.scale((1 + wob * 0.6) * lp(0.7, 1, e), (1 - wob) * Math.max(0, e) * (1 + st));
      g.globalAlpha = cl(u * 3, 0, 1); glyph(WORD[i], fsF, fsF * 0.05, true); g.restore();
    }
  }

  /* ---------- particles ---------- */
  function pReset() { P = []; pT = 0; evi = 0; prng = rng(99); }
  function spawn(k, x, y, vx, vy, r, life, fl) { P.push({ k: k, x: x, y: y, vx: vx, vy: vy, r: r, l: life, a: 0, fl: fl, sq: 0 }); }
  function buildEvents() {
    evl = []; var r = rng(5), i, j;
    function drops(t, x, y, n, sp, fl, rad) { evl.push({ t: t, f: function () { for (var j = 0; j < n; j++) { var an = -PI / 2 + (r() - 0.5) * 2.4; spawn("d", x, y, Math.cos(an) * sp * (0.4 + r()), Math.sin(an) * sp * (0.5 + r()), rad * (0.6 + r() * 0.7), 1.3 + r() * 0.5, fl); } } }); }
    for (i = 0; i < 5; i++) { var bx = lp(W * 0.2, cx, cl((IMP[i] - 0.2) / (IMP[4] - 0.2), 0, 1)); drops(IMP[i], bx, floorT - 2, i < 4 ? 4 : 6, H * (0.25 - i * 0.02), floorT, rBall * 0.22); }
    for (i = 0; i < WORD.length; i++) drops(T_BURST + i * 0.04 + 0.42, slotX[i], floorT - 3, 2, H * 0.22, floorT, rBall * 0.2);
    drops(T_BURST, cx, floorT - rBall, 14, H * 0.5, floorT, rBall * 0.28);
    drops(T_CART, cx - S * 0.3, floorC - 6, 7, H * 0.45, floorC, rBall * 0.28); drops(T_CART, cx + S * 0.3, floorC - 6, 7, H * 0.45, floorC, rBall * 0.28);
    /* dust trail of the rolling cart */
    for (var t = T_C2_GO - 0.1; t < T_HIT; t += 0.022) (function (t) {
      evl.push({ t: t, f: function () {
        var x = c2x(t) + S * 0.42, sp = Math.abs((c2x(t + 0.016) - c2x(t - 0.016)) / 0.032), a = cl(sp / (W * 0.8), 0.15, 1);
        spawn("u", x, floorC - S * 0.04, sp * 0.1 + 20, -H * 0.05 * r(), S * 0.045 * (0.6 + r() * 0.6) * a, 0.8, floorC);
        if (r() < 0.6) spawn("d", x, floorC - S * 0.05, sp * 0.18 * r() + 30, -H * (0.2 + r() * 0.4), rBall * (0.16 + r() * 0.16), 1.0, floorC);
      } });
    })(t);
    /* the smash */
    evl.push({ t: T_HIT, f: function () {
      var x = cx + S * 0.46, y = cy0 + S * 0.05, j, an, sp;
      for (j = 0; j < 56; j++) { an = r() * 2 * PI; sp = H * (0.35 + r() * 1.1); spawn("d", x, y, Math.cos(an) * sp, Math.sin(an) * sp - H * 0.25, rBall * (0.16 + r() * 0.26), 1.0 + r() * 0.5, floorC); }
      for (j = 0; j < 22; j++) { an = r() * 2 * PI; sp = H * (0.2 + r() * 0.5); spawn("u", x, y, Math.cos(an) * sp, Math.sin(an) * sp, S * 0.06 * (0.6 + r() * 0.6), 0.9, floorC); }
    } });
    for (t = T_HIT + 0.08; t < T_HIT + 0.6; t += 0.04) (function (t) { evl.push({ t: t, f: function () { var s = cart1(t); spawn("d", s.x, s.y, (r() - 0.5) * H * 0.4, (r() - 0.5) * H * 0.4, rBall * 0.2, 1.1, floorC); } }); })(t);
    evl.push({ t: T_VIC + 0.4, f: function () { for (var j = 0; j < 8; j++) spawn("d", cx + (r() - 0.5) * S * 0.7, floorC - 4, (r() - 0.5) * H * 0.5, -H * (0.2 + r() * 0.3), rBall * 0.2, 1.2, floorC); } });
    evl.push({ t: T_VIC + 0.9, f: function () { for (var j = 0; j < 5; j++) spawn("d", cx + (r() - 0.5) * S * 0.7, floorC - 4, (r() - 0.5) * H * 0.4, -H * (0.15 + r() * 0.2), rBall * 0.18, 1.1, floorC); } });
    evl.sort(function (a, b) { return a.t - b.t; });
  }
  function pStep(dt) {
    for (var i = 0; i < P.length; i++) {
      var p = P[i]; p.a += dt;
      if (p.k === "d") {
        p.vy += GRAV * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > p.fl - p.r * 0.6 && p.vy > 0) { p.y = p.fl - p.r * 0.6; p.vy *= -0.55; p.vx *= 0.55; p.sq = 1; }
        if (p.sq > 0) p.sq = Math.max(0, p.sq - dt * 9);
      } else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.95; p.r *= 1 + dt * 0.55; }
    }
  }
  function pTo(t) {
    if (t < pT - 1e-6) pReset();
    while (pT < t - 1e-6) {
      var dt = Math.min(1 / 60, t - pT);
      while (evi < evl.length && evl[evi].t <= pT + dt) { evl[evi].f(); evi++; }
      pStep(dt); pT += dt;
    }
    for (var i = P.length - 1; i >= 0; i--) if (P[i].a > P[i].l) P.splice(i, 1);
  }
  function drawParticles() {
    for (var i = 0; i < P.length; i++) {
      var p = P[i], f = 1 - sg(p.a, p.l * 0.7, p.l);
      if (p.k === "u") { g.fillStyle = "rgba(126,166,255," + (0.26 * f) + ")"; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 2 * PI); g.fill(); continue; }
      var sp = Math.hypot(p.vx, p.vy), k = cl(sp / (H * 2), 0, 0.7), r = p.r * (0.35 + 0.65 * f), sq = p.sq;
      g.save(); g.translate(p.x, p.y + r); g.rotate(Math.atan2(p.vy, p.vx)); g.scale(1 + k + sq * 0.3, 1 / (1 + k) * (1 - sq * 0.35)); g.rotate(-Math.atan2(p.vy, p.vx));
      g.fillStyle = BLUE; g.beginPath(); g.arc(0, -r, r, 0, 2 * PI); g.fill();
      g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.arc(-r * 0.3, -r * 1.3, r * 0.28, 0, 2 * PI); g.fill(); g.restore();
    }
  }
  /* ripples and shockwaves */
  function drawRings(t) {
    var i, u, a;
    for (i = 0; i < 5; i++) { u = sg(t, IMP[i], IMP[i] + 0.7); if (u > 0 && u < 1) { var bx = lp(W * 0.2, cx, cl((IMP[i] - 0.2) / (IMP[4] - 0.2), 0, 1)), rr = elo(u, 0.6) * rBall * (4 + i * 0.6); ring(bx, floorT, rr, rr * 0.28, 0.22 * (1 - u), 2); } }
    u = sg(t, T_CART, T_CART + 0.8); if (u > 0 && u < 1) ring(cx, floorC, elo(u, 0.6) * S * 0.9, elo(u, 0.6) * S * 0.25, 0.25 * (1 - u), 3);
    u = sg(t, T_HIT, T_HIT + 0.85); if (u > 0 && u < 1) { var x = cx + S * 0.42, y = cy0; ring(x, y, elo(u, 0.55) * S * 1.9, elo(u, 0.55) * S * 1.9, 0.42 * (1 - u), S * 0.022 * (1 - u) + 1.5); }
    u = sg(t, T_HIT + 0.1, T_HIT + 0.95); if (u > 0 && u < 1) ring(cx + S * 0.42, cy0, elo(u, 0.55) * S * 1.3, elo(u, 0.55) * S * 1.3, 0.3 * (1 - u), S * 0.014 * (1 - u) + 1.2);
    u = sg(t, T_HIT, T_HIT + 1.1); if (u > 0 && u < 1) ring(cx, floorC, elo(u, 0.6) * S * 2.2, elo(u, 0.6) * S * 0.55, 0.3 * (1 - u), 3);
    u = sg(t, T_VIC + 0.4, T_VIC + 1.0); if (u > 0 && u < 1) ring(cx, floorC, elo(u, 0.6) * S * 1.0, elo(u, 0.6) * S * 0.26, 0.22 * (1 - u), 2.5);
  }
  function ring(x, y, rx, ry, a, w) { g.save(); g.strokeStyle = "rgba(20,81,230," + a + ")"; g.lineWidth = Math.max(1, w); g.beginPath(); g.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, 2 * PI); g.stroke(); g.restore(); }

  /* ---------- shine over the finished logo ---------- */
  function shine(t) {
    var u = sg(t, T_SHINE, T_SHINE + 0.75); if (u <= 0 || u >= 1) return;
    var bw = Math.round(W), bh = Math.round(H);
    if (!lc || lc.width !== Math.round(W * 0.5) ) { lc = D.createElement("canvas"); lc.width = Math.round(W * 0.5); lc.height = Math.round(H * 0.5); lcx = lc.getContext("2d"); }
    lcx.setTransform(0.5, 0, 0, 0.5, 0, 0); lcx.clearRect(0, 0, W, H); lcx.globalCompositeOperation = "source-over";
    var c = cart2(t), gg = g; g = lcx; drawC(c); drawFinalWord(t); g = gg;
    lcx.setTransform(1, 0, 0, 1, 0, 0); lcx.globalCompositeOperation = "source-in";
    var x = lp(-0.3, 1.3, io(u)) * lc.width, gr = lcx.createLinearGradient(x - lc.width * 0.18, 0, x + lc.width * 0.18, lc.height * 0.3);
    gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,.85)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    lcx.fillStyle = gr; lcx.fillRect(0, 0, lc.width, lc.height);
    g.save(); g.imageSmoothingEnabled = true; g.drawImage(lc, 0, 0, W, H); g.restore();
  }

  /* ---------- frame ---------- */
  function render(t) {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    /* screen shake on impact */
    var sh = t >= T_HIT ? Math.exp(-(t - T_HIT) * 9) * Math.sin((t - T_HIT) * 72) : 0, shy = t >= T_HIT ? Math.exp(-(t - T_HIT) * 10) * Math.cos((t - T_HIT) * 61) : 0;
    g.save(); g.translate(sh * S * 0.06, shy * S * 0.045);
    drawRings(t);
    pTo(t);
    /* carts' contact shadows */
    var c1 = cart1(t), c2 = cart2(t);
    if (t >= T_CART && t < T_HIT + 0.08) floorShadow(c1.x, floorC + 2, S * 0.38, 0.2);
    if (c2.on) { var lift = cl((floorC - CB - c2.y) / (S * 0.4), 0, 1) + sg(t, T_UP, T_UP + 0.55) * 0.0; var fy = floorC + 2 + (t >= T_UP ? (cyF - cy0) * elo(sg(t, T_UP, T_UP + 0.55), 0.5) : 0); floorShadow(c2.x, fy, S * 0.36 * (1 - lift * 0.35), 0.2 * (1 - lift * 0.5)); }
    drawBall(t);
    if (t < T_SQ0 + 0.1) drawLetters(t);
    if (!RM && t >= T_SQ0 && t < T_CART + 0.08) {
      var ga = Math.min(sg(t, T_SQ0, T_SQ0 + 0.1), 1 - sg(t, T_CART - 0.04, T_CART + 0.08));
      drawGoo(t, ga);
    }
    /* trails then carts */
    var j, q;
    if (c1.on) {
      if (c1.trail) for (j = 3; j >= 1; j--) { q = cart1(t - j * 0.03); drawCart(q.x, q.y, q.sx, q.sy, q.rot, 0.14 / j, 0); }
      drawC(c1);
    }
    if (c2.on) {
      if (t < T_HIT && t > T_C2_GO) for (j = 3; j >= 1; j--) { q = cart2(t - j * 0.03); drawCart(q.x, q.y, q.sx, q.sy, q.rot, 0.15 / j, 0); }
      drawC(c2);
    }
    drawParticles();
    if (t >= T_UP) drawFinalWord(t);
    /* final little wobble of the logo */
    shine(t);
    g.restore();
    if (t > TOT - 0.5 && !ended && cv.style.opacity !== "0") { /* exit handled by loop */ }
  }

  /* ---------- lifecycle ---------- */
  function finish(fast) {
    if (ended) return; ended = true; cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize); D.removeEventListener("keydown", onKey);
    R.classList.remove("jd-splash-on");
    cv.style.transition = "opacity " + (fast ? 0.3 : 0.5) + "s ease"; cv.style.opacity = "0";
    if (skipBtn) skipBtn.style.opacity = "0";
    setTimeout(function () { try { cv.remove(); if (skipBtn) skipBtn.remove(); } catch (e) {} window.dispatchEvent(new Event("jd:splash-end")); }, fast ? 380 : 580);
  }
  function tick(ts) {
    if (ended) return; if (!w0) w0 = ts;
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts; frames++; T += dt;
    if ((ts - w0 > 2000 && frames < 12) || ts - w0 > (TOT + 8) * 1000) { finish(true); return; }
    try { render(Math.min(T, TOT)); } catch (e) { if (window.console) console.warn("Splash stopped", e); finish(true); return; }
    if (T >= TOT) { finish(false); return; }
    raf = requestAnimationFrame(tick);
  }
  var rt = 0;
  function onResize() { clearTimeout(rt); rt = setTimeout(function () { try { layout(); render(Math.min(T, TOT)); } catch (e) { finish(true); } }, 150); }
  function onKey(e) { if (e.key === "Escape") finish(true); }

  try {
    cv = D.createElement("canvas"); cv.id = "jd-splash";
    cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "JulaDirect");
    cv.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483000;background:#fff;touch-action:none";
    g = cv.getContext("2d"); R.appendChild(cv);
    layout();
    window.addEventListener("resize", onResize); D.addEventListener("keydown", onKey);
    skipBtn = D.createElement("button"); skipBtn.type = "button"; skipBtn.textContent = "Skip"; skipBtn.setAttribute("aria-label", "Skip the intro");
    skipBtn.style.cssText = "position:fixed;z-index:2147483001;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));padding:9px 18px;border-radius:999px;border:1.5px solid rgba(20,81,230,.35);background:rgba(255,255,255,.85);color:" + BLUE + ";font:700 13px/1 system-ui,sans-serif;cursor:pointer;opacity:0;transition:opacity .4s";
    skipBtn.addEventListener("click", function () { finish(true); }); R.appendChild(skipBtn);
    setTimeout(function () { if (skipBtn) skipBtn.style.opacity = "1"; }, 900);
    window.__jdSplash = { seek: function (t) { cancelAnimationFrame(raf); T = t; render(t); }, skip: function () { finish(true); }, TOT: TOT };
    if (RM) {
      /* reduced motion: a calm still of the finished logo, then straight into the app */
      T_UP = -10; T_SHINE = 99; render(TOT - 0.9);
      setTimeout(function () { finish(false); }, 900);
    } else { render(0); raf = requestAnimationFrame(tick); }
  } catch (e) {
    if (window.console) console.warn("Splash unavailable", e);
    R.classList.remove("jd-splash-on"); try { cv && cv.remove(); skipBtn && skipBtn.remove(); } catch (_) {}
  }
})();
