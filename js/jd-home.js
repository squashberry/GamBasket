/* JulaDirect v2 homepage. Every figure and listing shown here comes from
   live Supabase data or this device's own history; sections hide or show an
   honest empty state when there is nothing to display. */
(function () {
  "use strict";
  const JD = window.JD;
  const $ = id => document.getElementById(id);

  function errorState(msg, retryKey) {
    return JD.empty({
      icon: "bag",
      title: "We could not load this section",
      text: msg || "Please check your connection and try again.",
      actions: '<button type="button" class="jd-btn jd-btn--secondary" data-retry="' + retryKey + '">Try again</button>'
    });
  }
  /* Show cards in the grid layout, or a state block full-width, without replacing the element. */
  function setGrid(el, html, asGrid) { el.classList.toggle("jd-grid", asGrid); el.innerHTML = html; }

  function renderTrust() {
    $("jd-trust").innerHTML =
      "<span>" + JD.icon("shield", 20) + "Verified seller badges</span>" +
      "<span>" + JD.icon("wallet", 20) + "Cash on delivery</span>" +
      "<span>" + JD.icon("truck", 20) + "Delivery across Greater Banjul</span>";
    JD.$$(".jd-ico-arrow").forEach(el => { el.innerHTML = JD.icon("arrowRight", 16); });
  }

  /* The newest listings feed the hero mosaic, the mobile banner and the New arrivals grid. */
  let newestPromise = null;
  const newest = () => (newestPromise = newestPromise || JD.data.list("newest", 8));

  function renderMosaic(rows) {
    const box = $("jd-mosaic");
    const withImg = rows.filter(r => JD.safeUrl(r.main_image)).slice(0, 4);
    if (!withImg.length) {
      box.innerHTML = '<div class="jd-mosaic--empty"><div class="jd-empty" style="border:0;background:transparent"><div class="jd-empty__icon">' + JD.icon("bag", 32) + "</div><h3>Fresh listings appear here</h3><p>As sellers publish products, the newest arrivals show up on this page.</p></div></div>";
      return;
    }
    box.innerHTML = '<div class="jd-mosaic">' + withImg.map(p =>
      '<a href="product.html?id=' + encodeURIComponent(p.id) + '" aria-label="' + JD.esc(p.title) + '"><img src="' + JD.esc(JD.safeUrl(p.main_image)) + '" alt="" loading="eager" decoding="async"><span class="jd-mosaic__price">' + JD.esc(JD.money(p.price, p.currency)) + "</span></a>"
    ).join("") + "</div>";
  }
  function renderBanner(rows) {
    const img = (rows.find(r => JD.safeUrl(r.main_image)) || {}).main_image;
    $("jd-mbanner-img").outerHTML = img
      ? '<img class="jd-mbanner__img" id="jd-mbanner-img" src="' + JD.esc(JD.safeUrl(img)) + '" alt="" decoding="async">'
      : '<div class="jd-mbanner__ph" id="jd-mbanner-img">' + JD.icon("bag", 48) + "</div>";
  }

  async function loadNew() {
    const grid = $("jd-new");
    setGrid(grid, JD.skeletonCards(4), true);
    try {
      const rows = await newest();
      renderMosaic(rows);
      renderBanner(rows);
      if (!rows.length) {
        setGrid(grid, JD.empty({ icon: "bag", title: "No listings yet", text: "Be the first to list a product on JulaDirect.", actions: '<a class="jd-btn jd-btn--primary" href="supplier/index.html">Start selling</a>' }), false);
        return;
      }
      setGrid(grid, rows.map(JD.productCard).join(""), true);
      JD.syncWishlist(grid);
      JD.syncCompare();
    } catch (e) {
      console.warn("[JulaDirect] home new", e && e.message);
      renderMosaic([]);
      renderBanner([]);
      setGrid(grid, errorState(e && e.message, "new"), false);
    }
  }

  /* Best sellers: a swipeable row on mobile (with a real sold-vs-remaining bar) and a grid on desktop. */
  function flashCard(p) {
    const sold = Number(p.sales_count || 0);
    const left = Math.max(0, Number(p.stock || 0));
    const pct = sold + left > 0 ? Math.round((sold / (sold + left)) * 100) : 0;
    return '<a class="jd-fcard" href="product.html?id=' + encodeURIComponent(p.id) + '"><span class="jd-fcard__img"><img src="' + JD.esc(JD.safeUrl(p.main_image) || JD.placeholder) + '" alt="" loading="lazy"></span>' +
      '<span class="jd-fcard__body"><span class="jd-fcard__title">' + JD.esc(p.title) + '</span><span class="jd-fcard__price">' + JD.esc(JD.money(p.price, p.currency)) + "</span>" +
      '<span class="jd-bar" role="img" aria-label="' + pct + ' percent sold"><i style="width:' + pct + '%"></i></span>' +
      '<span class="jd-fcard__meta"><span>' + sold.toLocaleString("en-GB") + " sold</span><span>" + left.toLocaleString("en-GB") + " left</span></span></span></a>";
  }
  async function loadPopular() {
    const state = $("jd-pop-state");
    const flash = $("jd-flash");
    const grid = $("jd-pop");
    state.innerHTML = "";
    flash.innerHTML = '<div class="jd-skel" style="flex:none;width:268px;height:108px;border-radius:18px"></div><div class="jd-skel" style="flex:none;width:268px;height:108px;border-radius:18px"></div>';
    setGrid(grid, JD.skeletonCards(4), true);
    try {
      const rows = (await JD.data.list("popular", 8)).filter(r => Number(r.sales_count || 0) > 0);
      if (!rows.length) { $("jd-pop-sec").hidden = true; return; }
      $("jd-pop-sec").hidden = false;
      flash.innerHTML = rows.map(flashCard).join("");
      setGrid(grid, rows.map(JD.productCard).join(""), true);
      JD.syncWishlist(grid);
      JD.syncCompare();
    } catch (e) {
      console.warn("[JulaDirect] home popular", e && e.message);
      flash.innerHTML = "";
      grid.innerHTML = "";
      state.innerHTML = errorState(e && e.message, "pop");
    }
  }

  async function loadStats() {
    const stats = $("jd-stats");
    const cats = $("jd-cats");
    cats.innerHTML = Array.from({ length: 8 }, () => '<div class="jd-skel" style="aspect-ratio:1/1;border-radius:16px" aria-hidden="true"></div>').join("");
    try {
      const s = await JD.data.categoryStats();
      if (s.total > 0) {
        stats.hidden = false;
        stats.innerHTML =
          "<div><strong>" + s.total.toLocaleString("en-GB") + "</strong><span>Live listings</span></div>" +
          "<div><strong>" + s.sellers.toLocaleString("en-GB") + "</strong><span>Sellers with live listings</span></div>" +
          "<div><strong>" + s.categories.length.toLocaleString("en-GB") + "</strong><span>Categories with products</span></div>";
      }
      if (!s.categories.length) { $("jd-cats-sec").hidden = true; return; }
      let images = {};
      try { images = await JD.data.categoryImages(); } catch (e) { images = {}; }
      cats.innerHTML = s.categories.slice(0, 12).map(c => {
        const img = images[c.id];
        return '<a class="jd-cat" href="explore.html?category=' + encodeURIComponent(c.id) + '"><span class="jd-cat__icon">' + JD.icon(JD.data.categoryIcon(c.id), 22) + "</span>" +
          '<span class="jd-cat__img">' + (img ? '<img src="' + JD.esc(img) + '" alt="" loading="lazy">' : JD.icon(JD.data.categoryIcon(c.id), 28)) + "</span>" +
          "<span><strong>" + JD.esc(c.id) + "</strong><small>" + c.count.toLocaleString("en-GB") + (c.count === 1 ? " listing" : " listings") + "</small></span></a>";
      }).join("");
    } catch (e) {
      console.warn("[JulaDirect] home stats", e && e.message);
      cats.innerHTML = '<div style="grid-column:1/-1">' + errorState(e && e.message, "stats") + "</div>";
    }
  }

  /* Recently visited: ids live on this device only; products are re-read live. */
  function recentRow(p) {
    const sold = Number(p.sales_count || 0);
    return '<article class="jd-rrow"><a class="jd-rrow__img" href="product.html?id=' + encodeURIComponent(p.id) + '" tabindex="-1" aria-hidden="true"><img src="' + JD.esc(JD.safeUrl(p.main_image) || JD.placeholder) + '" alt="" loading="lazy"></a>' +
      '<div class="jd-rrow__body"><a class="jd-rrow__title" href="product.html?id=' + encodeURIComponent(p.id) + '">' + JD.esc(p.title) + '</a><span class="jd-rrow__price">' + JD.esc(JD.money(p.price, p.currency)) + "</span>" +
      '<span class="jd-rrow__sold">' + (sold > 0 ? sold.toLocaleString("en-GB") + " sold" : JD.esc(p.condition || "")) + "</span></div>" +
      '<button class="jd-pcard__fav" type="button" data-wish="' + JD.esc(p.id) + '" aria-pressed="false" aria-label="Save to wishlist">' + JD.icon("heart", 18) + "</button></article>";
  }
  async function loadRecent() {
    const ids = JD.recent.ids();
    const sec = $("jd-recent-sec");
    if (!ids.length) { sec.hidden = true; return; }
    try {
      const rows = (await JD.data.byIds(ids)).slice(0, 6);
      if (!rows.length) { sec.hidden = true; return; }
      sec.hidden = false;
      $("jd-recent").innerHTML = rows.map(recentRow).join("");
      JD.syncWishlist($("jd-recent"));
    } catch (e) {
      console.warn("[JulaDirect] home recent", e && e.message);
      sec.hidden = true;
    }
  }

  async function loadSellers() {
    try {
      const rows = await JD.data.verifiedSellers(8);
      if (!rows.length) return;
      $("jd-sellers-sec").hidden = false;
      $("jd-sellers").innerHTML = rows.map(s => {
        const name = s.business_name || "JulaDirect seller";
        const av = JD.safeUrl(s.avatar_url);
        return '<a class="jd-seller" href="explore.html?seller=' + encodeURIComponent(s.id) + '"><span class="jd-seller__av">' +
          (av ? '<img src="' + JD.esc(av) + '" alt="" loading="lazy">' : JD.esc(name.charAt(0).toUpperCase())) + "</span><span><strong>" + JD.esc(name) + JD.icon("shield", 16) + "</strong><small>" + JD.esc(s.region || "The Gambia") + "</small></span></a>";
      }).join("");
    } catch (e) {
      console.warn("[JulaDirect] home sellers", e && e.message);
    }
  }

  const loaders = { new: () => { newestPromise = null; return loadNew(); }, pop: loadPopular, stats: loadStats };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-retry]");
    if (b && loaders[b.getAttribute("data-retry")]) loaders[b.getAttribute("data-retry")]();
    if (e.target.closest("#jd-recent-clear")) { JD.recent.clear(); $("jd-recent-sec").hidden = true; JD.toast("Recently visited cleared", "ok"); }
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
  function renderTakeover(b, preview) {
    const sec = $("jd-takeover");
    const img = JD.safeUrl(b.image_url);
    const href = safeHref(b.cta_url);
    const ctaLabel = (b.cta_label || "Shop now");
    const external = /^https:/.test(href);
    sec.setAttribute("data-theme", b.theme || "light");
    sec.innerHTML = '<div class="jd-to__inner">' +
      '<h1 class="jd-to__head"><span class="jd-to__l">' + lines(b.headline_left, 0.15) + "</span>" + (b.headline_right ? '<span class="jd-to__r">' + lines(b.headline_right, 0.4) + "</span>" : "") + "</h1>" +
      (img ? '<div class="jd-to__figure" data-style="' + JD.esc(b.image_style || "cutout") + '"><div class="jd-to__par"><img class="jd-to__img" src="' + JD.esc(img) + '" alt="" decoding="async"></div></div>' : "") +
      (b.tagline ? '<p class="jd-to__tag jd-to__fade" style="--d:.9s">' + JD.esc(b.tagline) + "</p>" : "") +
      (b.kicker ? '<p class="jd-to__kicker jd-to__fade" style="--d:1s">' + JD.esc(b.kicker) + "</p>" : "") +
      (b.body ? '<p class="jd-to__body jd-to__fade" style="--d:1.1s">' + JD.esc(b.body) + "</p>" : "") +
      (b.corner_label ? '<p class="jd-to__corner jd-to__fade" style="--d:1.2s">' + JD.esc(b.corner_label) + "</p>" : "") +
      (b.stat_value ? '<div class="jd-to__stat jd-to__fade" style="--d:1.3s"><strong id="jd-to-stat">' + JD.esc(b.stat_value) + "</strong>" + (b.stat_label ? "<span>" + JD.esc(b.stat_label) + "</span>" : "") + "</div>" : "") +
      (href ? '<a class="jd-to__cta jd-to__fade" style="--d:1.4s" href="' + JD.esc(href) + '"' + (external ? ' rel="noopener"' : "") + "><i>" + JD.icon("arrowUpRight", 24) + "</i><span>" + JD.esc(ctaLabel) + "</span></a>" : "") +
      '<svg class="jd-to__orn" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 2c2.6 0 4.4 2.2 4.4 5 0 1.8-.8 3.2-2 4.4 1.2-.4 2.6-.4 4-.1 2.5.6 4.3 2.9 3.5 5.4-.6 2.5-2.9 4.1-5.4 3.6-1.5-.3-2.8-1.1-3.7-2.2.5 1.4.7 2.8.3 4.2-.8 2.5-3.2 4-5.7 3.2-2.5-.8-3.9-3.2-3.3-5.7.4-1.5 1.3-2.7 2.5-3.5-1.5.1-2.9-.3-4-1.2C3.7 14.600 3.600 11.800 5.400 10c1.800-1.800 4.600-1.900 6.600-.4 1 .8 1.700 1.800 2 3-.3-1.500-.2-3 .6-4.300C15.500 6 15.700 4 16 2Z"/></svg>' +
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
    JD.takeover.set(banner.theme || "light");
    if (preview) { try { sessionStorage.setItem("jd_to_hint", "0"); } catch (e) { /* ignore */ } }
    renderTakeover(banner, preview);
  }

  JD.mountShell({ active: "home" });
  JD.bindProductActions(document);
  bootBanner();
  renderTrust();
  loadStats();
  loadNew();
  loadPopular();
  loadRecent();
  loadSellers();
})();
