/* JulaDirect home (v3). Every figure and listing comes from live Supabase data or this
   device's own history; sections hide, or show an honest empty state, when there is nothing
   to display. The admin-managed takeover banner is kept as it was. */
(function () {
  "use strict";
  const JD = window.JD;
  const $ = id => document.getElementById(id);
  const NF = n => Number(n).toLocaleString("en-GB");
  const href = p => "product.html?id=" + encodeURIComponent(p.id);
  const img = p => JD.safeUrl(p.main_image) || JD.placeholder;

  const errorState = (msg, key) => JD.empty({ icon: "bag", title: "We could not load this section", text: msg || "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" data-retry="' + key + '">Try again</button>' });
  const setGrid = (el, html, asGrid) => { el.classList.toggle("jd-grid", asGrid); el.innerHTML = html; };

  /* ---------- hero: live product art for the banner + the auto-slider ---------- */
  let newestP = null;
  const newest = () => (newestP = newestP || JD.data.list("newest", 8));
  const vc = (p, price) => '<a class="hm-vc" href="' + href(p) + '" tabindex="-1"><img src="' + JD.esc(img(p)) + '" alt="" loading="lazy" decoding="async">' + (price === false ? "" : "<b>" + JD.esc(JD.money(p.price, p.currency)) + "</b>") + "</a>";
  function paintVis(vis, rows, n) {
    const have = rows.filter(r => JD.safeUrl(r.main_image));
    const pick = have.length ? have : rows;
    if (!pick.length) { vis.querySelectorAll(".hm-vc").forEach(e => e.remove()); return; }
    vis.querySelectorAll(".hm-vc").forEach(e => e.remove());
    const parts = []; for (let k = 0; k < n; k++) parts.push(vc(pick[k % pick.length]));
    vis.insertAdjacentHTML("afterbegin", parts.join(""));
  }
  async function loadHeroArt() {
    const fan = document.querySelector('[data-vis="fan"]'), mos = document.querySelector('[data-vis="mosaic"]'), stk = document.querySelector('[data-vis="stack"]');
    try {
      const rows = await JD.swr("home:deck", newest, r => { paintVis(fan, r, 3); paintVis(mos, r.slice(3).concat(r), 4); });
      paintVis(fan, rows, 3); paintVis(mos, rows.slice(3).concat(rows), 4);
      let cheap = rows;
      try { cheap = (await JD.data.search({ max: "1000", stock: true, sort: "price_asc", page: 1 })).rows; } catch (e) { /* fall back to newest */ }
      if (!cheap.length) cheap = rows;
      paintVis(stk, cheap.slice(0, 6), 3);
    } catch (e) { console.warn("[JulaDirect] home hero art", e && e.message); }
  }
  function heroIcons() {
    const set = (id, name, size, text) => { const el = $(id); if (el) el.innerHTML = (name ? "<i>" + JD.icon(name, size) + "</i>" : "") + (text || ""); };
    const chip = $("hm-ico-cod"); if (chip) chip.innerHTML = JD.icon("wallet", 16) + "Cash on delivery";
    set("hm-fl-a", "shield", 16, "Verified sellers"); set("hm-fl-b", "message", 16, "Message sellers first");
    set("hm-sf-a", "tag", 16, "Free to list"); set("hm-sf-b", "shield", 16, "Verified badge"); set("hm-sf-c", "truck", 16, "Delivery handled");
    const shop = $("hm-ico-shop"); if (shop) shop.innerHTML = JD.icon("store", 34);
    const pp = $("hm-pp"); if (pp) pp.innerHTML = JD.icon("pause", 16);
    $("hm-sl-prev").innerHTML = JD.icon("chevronRight", 20); $("hm-sl-next").innerHTML = JD.icon("chevronRight", 20);
  }
  function slider() {
    const sl = $("hm-sl"), tr = $("hm-track"), dotsBox = $("hm-dots"), pp = $("hm-pp");
    if (!sl || !tr) return;
    const slides = JD.$$(".hm-slide", tr), len = slides.length, DUR = 5600;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0, timer = 0, userPaused = reduce, hold = false, visible = true, onScreen = true;
    sl.style.setProperty("--dur", DUR + "ms");
    dotsBox.innerHTML = slides.map((s, k) => '<button type="button" role="tab" aria-label="Banner ' + (k + 1) + ' of ' + len + '"><i></i></button>').join("");
    const dots = JD.$$("button", dotsBox);
    const w = () => tr.clientWidth || 1;
    function mark() {
      dots.forEach((d, k) => { d.classList.remove("is-on"); d.setAttribute("aria-selected", String(k === i)); });
      void dotsBox.offsetWidth; dots[i].classList.add("is-on");
      slides.forEach((s, k) => s.setAttribute("aria-hidden", String(k !== i)));
      sl.setAttribute("data-ink", slides[i].getAttribute("data-t") === "sky" || slides[i].getAttribute("data-t") === "amber" ? "dark" : "light");
    }
    function schedule() {
      clearTimeout(timer);
      if (userPaused || hold || !visible || !onScreen) return;
      timer = setTimeout(() => go(i + 1, true), DUR);
    }
    function go(n, smooth) {
      i = (n + len) % len;
      tr.scrollTo({ left: i * w(), behavior: smooth && !reduce ? "smooth" : "auto" });
      mark(); schedule();
    }
    function setPaused(v) {
      userPaused = v; sl.classList.toggle("is-paused", v);
      pp.innerHTML = JD.icon(v ? "play" : "pause", 16); pp.setAttribute("aria-label", v ? "Resume banner rotation" : "Pause banner rotation");
      if (v) clearTimeout(timer); else { mark(); schedule(); }
    }
    let st = 0;
    tr.addEventListener("scroll", () => { clearTimeout(st); st = setTimeout(() => { const k = Math.round(tr.scrollLeft / w()); if (k !== i && k >= 0 && k < len) { i = k; mark(); schedule(); } }, 90); }, { passive: true });
    dotsBox.addEventListener("click", e => { const d = e.target.closest("button"); if (d) go(dots.indexOf(d), true); });
    $("hm-sl-prev").addEventListener("click", () => go(i - 1, true));
    $("hm-sl-next").addEventListener("click", () => go(i + 1, true));
    pp.addEventListener("click", () => setPaused(!userPaused));
    const holdOn = () => { hold = true; sl.classList.add("is-hold"); clearTimeout(timer); };
    const holdOff = () => { hold = false; sl.classList.remove("is-hold"); schedule(); };
    sl.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") holdOn(); });
    sl.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") holdOff(); });
    sl.addEventListener("focusin", holdOn); sl.addEventListener("focusout", holdOff);
    sl.addEventListener("touchstart", holdOn, { passive: true });
    sl.addEventListener("touchend", () => setTimeout(holdOff, 1200), { passive: true });
    tr.addEventListener("keydown", e => { if (e.key === "ArrowRight") { go(i + 1, true); e.preventDefault(); } else if (e.key === "ArrowLeft") { go(i - 1, true); e.preventDefault(); } });
    document.addEventListener("visibilitychange", () => { visible = !document.hidden; visible ? schedule() : clearTimeout(timer); });
    if ("IntersectionObserver" in window) new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; onScreen ? schedule() : clearTimeout(timer); }, { threshold: .25 }).observe(sl);
    window.addEventListener("jd:pane:hide", () => { visible = false; clearTimeout(timer); });
    window.addEventListener("jd:pane:show", () => { visible = !document.hidden; schedule(); });
    window.addEventListener("resize", () => { tr.scrollTo({ left: i * w(), behavior: "auto" }); });
    if (reduce) setPaused(true); else { pp.innerHTML = JD.icon("pause", 16); }
    mark(); schedule();
  }

  /* ---------- stats + categories ---------- */
  async function loadStats() {
    const cats = $("hm-cats");
    cats.innerHTML = Array.from({ length: 8 }, () => '<div class="jd-skel" style="aspect-ratio:4/5;border-radius:22px" aria-hidden="true"></div>').join("");
    try {
      const s = await JD.data.categoryStats();
      if (s.total > 0) {
        const l2 = $("hm-s2-lead");
        if (l2) l2.textContent = NF(s.total) + (s.total === 1 ? " live listing" : " live listings") + (s.sellers ? " from " + NF(s.sellers) + (s.sellers === 1 ? " active seller" : " active sellers") : "") + ", with new products landing every day.";
      }
      if (!s.categories.length) { $("hm-cats-sec").hidden = true; return; }
      let images = {}; try { images = await JD.data.categoryImages(); } catch (e) { images = {}; }
      cats.innerHTML = s.categories.slice(0, 11).map(c => '<a class="hm-cat" href="explore.html?category=' + encodeURIComponent(c.id) + '">' + (images[c.id] ? '<img src="' + JD.esc(images[c.id]) + '" alt="" loading="lazy">' : "") + '<span class="hm-cat__ico">' + JD.icon(JD.data.categoryIcon(c.id), 22) + "</span><strong>" + JD.esc(c.id) + "</strong><small>" + NF(c.count) + (c.count === 1 ? " listing" : " listings") + "</small></a>").join("") +
        '<a class="hm-cat hm-cat--all" href="explore.html"><span class="hm-cat__ico">' + JD.icon("grid", 22) + "</span><strong>All products</strong><small>" + NF(s.total) + " listings</small></a>";
    } catch (e) {
      console.warn("[JulaDirect] home stats", e && e.message);
      cats.innerHTML = '<div style="grid-column:1/-1">' + errorState(e && e.message, "stats") + "</div>";
    }
  }

  /* ---------- picks with tabs ---------- */
  const TABS = {
    new: { all: "explore.html?sort=newest", load: () => newest() },
    delivery: { all: "explore.html?delivery=1&stock=1", load: async () => (await JD.data.search({ delivery: true, stock: true, sort: "newest", page: 1 })).rows.slice(0, 8) },
    value: { all: "explore.html?max=1000&stock=1&sort=price_asc", load: async () => (await JD.data.search({ max: "1000", stock: true, sort: "popular", page: 1 })).rows.slice(0, 8) },
    like: { all: "explore.html?condition=Like%20New", load: async () => { const [a, b] = await Promise.all([JD.data.search({ condition: "Like New", stock: true, sort: "newest", page: 1 }), JD.data.search({ condition: "Refurbished", stock: true, sort: "newest", page: 1 })]); return a.rows.concat(b.rows).slice(0, 8); } }
  };
  let tab = "new", tabReq = 0;
  async function loadPicks() {
    const my = ++tabReq, grid = $("hm-picks"), t = TABS[tab];
    $("hm-picks-all").setAttribute("href", t.all);
    grid.setAttribute("aria-labelledby", "tab-" + (tab === "like" ? "new2" : tab));
    setGrid(grid, JD.skeletonCards(4), true);
    const paint = rows => {
      if (my !== tabReq) return;
      if (!rows.length) { setGrid(grid, JD.empty({ icon: "bag", title: "Nothing here yet", text: "Check another tab or browse everything.", actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Browse the marketplace</a>' }), false); return; }
      setGrid(grid, rows.map(JD.productCard).join(""), true);
      JD.syncWishlist(grid); JD.syncCompare();
    };
    try { await JD.swr("home:picks:" + tab, t.load, paint); }
    catch (e) { if (my !== tabReq) return; console.warn("[JulaDirect] home picks", e && e.message); setGrid(grid, errorState(e && e.message, "picks"), false); }
  }
  function selectTab(btn) {
    tab = btn.getAttribute("data-tab");
    JD.$$("#hm-picks-sec [role=tab], .hm-tabs [role=tab]").forEach(b => { const on = b === btn; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    loadPicks();
  }

  /* ---------- best sellers rail ---------- */
  function rank(p, i) {
    const sold = Number(p.sales_count || 0), left = Math.max(0, Number(p.stock || 0)), pct = sold + left > 0 ? Math.round(sold / (sold + left) * 100) : 0;
    return '<a class="hm-rank" href="' + href(p) + '"><span class="hm-rank__n">#' + (i + 1) + '</span><img src="' + JD.esc(img(p)) + '" alt="" loading="lazy" decoding="async"><span class="hm-rank__b"><strong>' + JD.esc(JD.money(p.price, p.currency)) + '</strong><span class="t">' + JD.esc(p.title) + '</span><span class="hm-bar" role="img" aria-label="' + pct + ' percent sold"><i style="width:' + pct + '%"></i></span><span class="hm-rank__m"><span>' + NF(sold) + " sold</span><span>" + NF(left) + " left</span></span></span></a>";
  }
  async function loadBest() {
    const sec = $("hm-best-sec"), rail = $("hm-best");
    const paint = rows => { if (!rows.length) { sec.hidden = true; return; } sec.hidden = false; rail.innerHTML = rows.map(rank).join(""); };
    try { await JD.swr("home:best", async () => (await JD.data.list("popular", 10)).filter(r => Number(r.sales_count || 0) > 0), paint); }
    catch (e) { console.warn("[JulaDirect] home best", e && e.message); sec.hidden = true; }
  }
  const scrollRail = dir => { const r = $("hm-best"); r.scrollBy({ left: dir * Math.max(260, r.clientWidth * .8), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };

  /* ---------- recent + sellers ---------- */
  function recentRow(p) {
    const sold = Number(p.sales_count || 0);
    return '<article class="jd-rrow"><a class="jd-rrow__img" href="' + href(p) + '" tabindex="-1" aria-hidden="true"><img src="' + JD.esc(img(p)) + '" alt="" loading="lazy"></a><div class="jd-rrow__body"><a class="jd-rrow__title" href="' + href(p) + '">' + JD.esc(p.title) + '</a><span class="jd-rrow__price">' + JD.esc(JD.money(p.price, p.currency)) + '</span><span class="jd-rrow__sold">' + (sold > 0 ? NF(sold) + " sold" : JD.esc(p.condition || "")) + '</span></div><button class="jd-pcard__fav" type="button" data-wish="' + JD.esc(p.id) + '" aria-pressed="false" aria-label="Save to wishlist">' + JD.icon("heart", 18) + "</button></article>";
  }
  async function loadRecent() {
    const ids = JD.recent.ids(), sec = $("hm-recent-sec");
    if (!ids.length) { sec.hidden = true; return; }
    try {
      const rows = (await JD.data.byIds(ids)).slice(0, 6);
      if (!rows.length) { sec.hidden = true; return; }
      sec.hidden = false; $("hm-recent").innerHTML = rows.map(recentRow).join(""); JD.syncWishlist($("hm-recent"));
    } catch (e) { console.warn("[JulaDirect] home recent", e && e.message); sec.hidden = true; }
  }
  async function loadSellers() {
    try {
      const rows = await JD.data.verifiedSellers(8);
      if (!rows.length) return;
      $("hm-sellers-sec").hidden = false;
      $("hm-sellers").innerHTML = rows.map(s => { const n = s.business_name || "JulaDirect seller", av = JD.safeUrl(s.avatar_url); return '<a class="hm-seller" href="explore.html?seller=' + encodeURIComponent(s.id) + '"><span class="hm-seller__av">' + (av ? '<img src="' + JD.esc(av) + '" alt="" loading="lazy">' : JD.esc(n.charAt(0).toUpperCase())) + '</span><div><strong><span>' + JD.esc(n) + "</span>" + JD.icon("shield", 16) + "</strong><small>" + JD.esc(s.region || "The Gambia") + "</small></div></a>"; }).join("");
    } catch (e) { console.warn("[JulaDirect] home sellers", e && e.message); }
  }

  const loaders = { stats: loadStats, picks: loadPicks };
  document.addEventListener("click", e => {
    const r = e.target.closest("[data-retry]"); if (r && loaders[r.getAttribute("data-retry")]) return loaders[r.getAttribute("data-retry")]();
    const t = e.target.closest(".hm-tabs [role=tab]"); if (t) return selectTab(t);
    if (e.target.closest("#hm-prev")) return scrollRail(-1);
    if (e.target.closest("#hm-next")) return scrollRail(1);
    if (e.target.closest("#hm-recent-clear")) { JD.recent.clear(); $("hm-recent-sec").hidden = true; JD.toast("Recently visited cleared", "ok"); }
  });
  document.addEventListener("keydown", e => {
    const t = e.target.closest && e.target.closest(".hm-tabs [role=tab]"); if (!t || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const tabs = JD.$$(".hm-tabs [role=tab]"), i = tabs.indexOf(t), n = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    n.focus(); selectTab(n); e.preventDefault();
  });

  /* ---------- takeover banner (admin-managed, one live at a time) ---------- */
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const safeHref = u => {
    const v = String(u || "").trim();
    return /^https:\/\/[^\s]+$/.test(v) || /^[A-Za-z0-9_.\/?=&#%-]+$/.test(v) ? v : "";
  };
  function lines(text, start) {
    return String(text || "").split(/\r?\n/).map(t => t.trim()).filter(Boolean).slice(0, 3)
      .map((t, i) => '<span class="jd-to__line"><span style="--d:' + (start + i * 0.12).toFixed(2) + 's">' + JD.esc(t) + "</span></span>").join("");
  }
  function countUp(el, raw) {
    const m = String(raw).match(/^([\d.,]+)(.*)$/);
    if (!m || reduceMotion) { el.textContent = raw; return; }
    const target = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(target)) { el.textContent = raw; return; }
    const decimals = (m[1].split(".")[1] || "").length;
    const t0 = performance.now() + 1100;
    const fmt = v => v.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    el.textContent = fmt(0) + m[2];
    (function tick(now) {
      const p = Math.min(1, Math.max(0, (now - t0) / 1600));
      el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))) + m[2];
      if (p < 1) requestAnimationFrame(tick); else el.textContent = m[1] + m[2];
    })(performance.now());
  }
  function parallax(section) {
    if (reduceMotion || !window.matchMedia("(pointer: fine)").matches) return;
    const par = section.querySelector(".jd-to__par");
    if (!par) return;
    let raf = 0;
    section.addEventListener("pointermove", e => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = section.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        par.style.setProperty("--px", (dx * 22).toFixed(1) + "px");
        par.style.setProperty("--py", (dy * 14).toFixed(1) + "px");
      });
    });
    section.addEventListener("pointerleave", () => { par.style.setProperty("--px", "0px"); par.style.setProperty("--py", "0px"); });
  }
  function hexLuminance(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!match) return null;
    const channels = [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2));
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  }
  function renderTakeover(b, preview) {
    const sec = $("jd-takeover");
    const img = JD.safeUrl(b.image_url);
    const href = safeHref(b.cta_url);
    const customColor = /^#[0-9a-f]{6}$/i.test(b.background_color || "") ? b.background_color : "";
    const luminance = customColor ? hexLuminance(customColor) : null;
    const darkBackground = customColor ? luminance < .38 : false;
    const effectiveTheme = customColor ? (darkBackground ? "dark" : "light") : (b.theme || "light");
    JD.takeover.set(effectiveTheme);
    if (customColor) {
      sec.style.setProperty("--to-bg", customColor);
      sec.style.setProperty("--to-ink", darkBackground ? "#ffffff" : "#172033");
      sec.style.setProperty("--to-muted", darkBackground ? "rgba(255,255,255,.78)" : "#536071");
      sec.style.setProperty("--to-line", darkBackground ? "rgba(255,255,255,.12)" : "rgba(23,32,51,.08)");
      sec.style.setProperty("--to-accent", darkBackground ? "#b7ec78" : "#1451e6");
      sec.style.setProperty("--to-cta-ink", darkBackground ? "#172033" : "#ffffff");
    } else {
      ["--to-bg","--to-ink","--to-muted","--to-line","--to-accent","--to-cta-ink"].forEach(name => sec.style.removeProperty(name));
    }
    const ctaLabel = (b.cta_label || "Shop now");
    const external = /^https:/.test(href);
    sec.setAttribute("data-theme", effectiveTheme);
    sec.innerHTML = '<div class="jd-to__inner">' +
      '<h1 class="jd-to__head"><span class="jd-to__l">' + lines(b.headline_left, 0.15) + "</span>" + (b.headline_right ? '<span class="jd-to__r">' + lines(b.headline_right, 0.4) + "</span>" : "") + "</h1>" +
      (img ? '<div class="jd-to__figure" data-style="' + JD.esc(b.image_style || "cutout") + '"><div class="jd-to__par"><img class="jd-to__img" src="' + JD.esc(img) + '" alt="" decoding="async"></div></div>' : "") +
      (b.tagline ? '<p class="jd-to__tag jd-to__fade" style="--d:.9s">' + JD.esc(b.tagline) + "</p>" : "") +
      (b.kicker ? '<p class="jd-to__kicker jd-to__fade" style="--d:1s">' + JD.esc(b.kicker) + "</p>" : "") +
      (b.body ? '<p class="jd-to__body jd-to__fade" style="--d:1.1s">' + JD.esc(b.body) + "</p>" : "") +
      (b.corner_label ? '<p class="jd-to__corner jd-to__fade" style="--d:1.2s">' + JD.esc(b.corner_label) + "</p>" : "") +
      (b.stat_value ? '<div class="jd-to__stat jd-to__fade" style="--d:1.3s"><strong id="jd-to-stat">' + JD.esc(b.stat_value) + "</strong>" + (b.stat_label ? "<span>" + JD.esc(b.stat_label) + "</span>" : "") + "</div>" : "") +
      (href ? '<a class="jd-to__cta jd-to__fade" style="--d:1.4s" href="' + JD.esc(href) + '"' + (external ? ' rel="noopener"' : "") + "><i>" + JD.icon("arrowUpRight", 24) + "</i><span>" + JD.esc(ctaLabel) + "</span></a>" : "") +
      '<svg class="jd-to__orn" viewBox="0 0 32 32" aria-hidden="true"><g fill="currentColor"><circle cx="16" cy="8" r="6"/><circle cx="24" cy="16" r="6"/><circle cx="16" cy="24" r="6"/><circle cx="8" cy="16" r="6"/></g></svg>' +
      "</div>";
    if (preview) {
      const pill = document.createElement("div");
      pill.className = "jd-preview";
      pill.innerHTML = '<span>Previewing <strong>' + JD.esc(b.name) + '</strong> (' + (b.is_active ? "live" : "not live") + ')</span><a href="admin/banners.html">Back to banners</a>';
      document.body.appendChild(pill);
    }
    const stat = document.getElementById("jd-to-stat");
    if (stat) countUp(stat, b.stat_value);
    parallax(sec);
  }
  async function bootBanner() {
    const pv = JD.params().get("preview_banner");
    let banner = pv ? await JD.data.bannerById(pv) : null;
    const preview = !!banner;
    if (!banner) banner = await JD.data.activeBanner();
    if (!banner) { JD.takeover.set(null); $("jd-takeover").innerHTML = ""; return; }
    if (preview) { try { sessionStorage.setItem("jd_to_hint", "0"); } catch (e) { /* ignore */ } }
    renderTakeover(banner, preview);
  }


  /* Back on the Home tab: only the device-local "recently visited" row can have changed. */
  window.addEventListener("jd:pane:show", e => { if (e.detail.route === "index" && !e.detail.first) loadRecent(); });

  JD.mountShell({ active: "home" });
  JD.bindProductActions(document);
  heroIcons(); slider();
  [["hm-t1", "wallet"], ["hm-t2", "shield"], ["hm-t3", "truck"], ["hm-t4", "message"], ["hm-ico-work", "truck"]].forEach(p => { const el = $(p[0]); if (el) el.innerHTML = JD.icon(p[1], 24); });
  $("hm-prev").innerHTML = JD.icon("arrowRight", 20); $("hm-next").innerHTML = JD.icon("arrowRight", 20);
  JD.$$(".hm-arrow").forEach(el => { el.innerHTML = JD.icon("arrowRight", 16); });
  if (JD.isPhone()) { JD.takeover.set(null); } else bootBanner();
  loadHeroArt(); loadStats(); loadPicks(); loadBest(); loadRecent(); loadSellers();
})();
