/* =========================================================
   JulaDirect v2 core — utilities, icons, shell, toasts, compare list,
   product card. Depends on js/config.js and js/supabase.js
   (window.GamBasketAuth is the single Supabase adapter; this file
   never creates its own client and never touches keys).
   ========================================================= */
(function () {
  "use strict";
  const JD = (window.JD = window.JD || {});
  const CFG = window.GAMBASKET_CONFIG || {};
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /* ---------- utilities ---------- */
  /* Shell-level listeners must never be scoped to a single tab (see jd-router.js). */
  const rawOn = (t, type, fn, o) => (JD.rawAddEventListener || EventTarget.prototype.addEventListener).call(t, type, fn, o);
  JD.isUuid = v => UUID.test(String(v || ""));
  /* "../" repeated once per folder the page sits in, so shell links work from /admin/ and similar. */
  JD.root = "../".repeat(Math.max(0, location.pathname.split("/").filter(Boolean).length - 1));
  JD.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  JD.safeUrl = u => {
    try {
      const x = new URL(String(u || ""), location.href);
      return /^https?:$/.test(x.protocol) ? x.href : "";
    } catch (e) { return ""; }
  };
  JD.money = (n, cur) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "";
    const label = !cur || cur === "GMD" ? (CFG.CURRENCY_SYMBOL || "D") : cur;
    return label + " " + v.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };
  JD.$ = (sel, root) => (root || document).querySelector(sel);
  JD.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  JD.params = () => new URLSearchParams(location.search);
  JD.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  /* In-app navigation when the router can handle the URL, otherwise a normal page load. */
  JD.go = url => { if (JD.router && JD.router.canHandle(url)) JD.router.navigate(url); else location.href = url; };
  JD.loginUrl = () => JD.root + "login.html?redirect=" + encodeURIComponent(location.href);
  JD.auth = () => window.GamBasketAuth || null;
  JD.client = async () => {
    const A = JD.auth();
    if (!A) return null;
    await A.ready();
    return A.getClient();
  };
  JD.shortDate = d => {
    const t = new Date(d);
    return isNaN(t) ? "" : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  /* ---------- icons (24px grid, 1.8 stroke) ---------- */
  const PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    cart: '<path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4.2 4.2 0 0 1 7-3 4.2 4.2 0 0 1 7 3c0 5.6-7 10-7 10Z"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.7-3.6 3.3-5.4 7-5.4s6.3 1.8 7 5.4"/>',
    home: '<path d="m4 11 8-6.5L20 11v8a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1v-8Z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5V20h13v-7.5"/><path d="M10 20v-4.5h4V20"/>',
    truck: '<path d="M3 6.5h11v9H3z"/><path d="M14 9.5h3.8l2.7 3v3H14"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    shield: '<path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6l-7-2.5Z"/><path d="m9 12 2.2 2.2L15.3 10"/>',
    check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
    chevronRight: '<path d="m9 5 7 7-7 7"/>',
    chevronDown: '<path d="m5 9 7 7 7-7"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    message: '<path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.3-4.2A7.5 7.5 0 1 1 20 12Z"/>',
    scale: '<path d="M12 4v16M6 20h12M5 7h14"/><path d="m5 7-2.5 6a3 3 0 0 0 5 0L5 7ZM19 7l-2.5 6a3 3 0 0 0 5 0L19 7Z"/>',
    pin: '<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
    star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8Z"/>',
    bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    tag: '<path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7-9.3-9.3Z"/><circle cx="8" cy="9" r="1.3"/>',
    phone: '<rect x="7" y="2.8" width="10" height="18.4" rx="2.4"/><path d="M11 18h2"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 1.9-2.2 3.3M12 17h.01"/>',
    package: '<path d="M4 8 12 4l8 4v8l-8 4-8-4V8Z"/><path d="m4 8 8 4 8-4M12 12v8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
    logout: '<path d="M10 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h4"/><path d="M15 8l4 4-4 4M19 12H9.5"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M16 13.5h.01"/>',
    bookmark: '<path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V5.5a1 1 0 0 1 1-1Z"/>'
  };
  PATHS.menu = '<path d="M4 7h16M4 12h16M4 17h10"/>';
  PATHS.arrowUpRight = '<path d="M7 17 17 7M8 7h9v9"/>';
  JD.icon = (name, size) => {
    const s = size || 20;
    return '<svg class="jd-i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (PATHS[name] || "") + "</svg>";
  };
  JD.logoMark = (size) => '<svg width="' + (size || 36) + '" height="' + (size || 36) + '" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="9" fill="#1451e6"/><path d="M19.5 8v10.2c0 3-1.9 4.8-4.7 4.8-1.9 0-3.3-.7-4.3-2" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none"/><circle cx="19.5" cy="8" r="2" fill="#fff"/></svg>';
  JD.placeholder = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#eef4ff"/><g fill="none" stroke="#9db8f5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M38 48h44l-3 34H41l-3-34Z"/><path d="M50 48v-4a10 10 0 0 1 20 0v4"/></g></svg>');
  rawOn(document, "error", e => {
    const t = e.target;
    if (t && t.tagName === "IMG" && t.dataset.fallback !== "1") { t.dataset.fallback = "1"; t.src = JD.placeholder; }
  }, true);

  /* ---------- toasts ---------- */
  JD.toast = (message, type) => {
    let box = document.getElementById("jd-toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "jd-toasts";
      box.className = "jd-toasts";
      box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = "jd-toast" + (type ? " jd-toast--" + type : "");
    t.innerHTML = (type === "ok" ? JD.icon("check", 18) : "") + "<span>" + JD.esc(message) + "</span>";
    box.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  };

  /* ---------- reusable fragments ---------- */
  JD.empty = o => '<div class="jd-empty"><div class="jd-empty__icon">' + JD.icon(o.icon || "bag", 28) + "</div><h3>" + JD.esc(o.title) + "</h3>" +
    (o.text ? "<p>" + JD.esc(o.text) + "</p>" : "") + (o.actions ? '<div class="jd-empty__actions">' + o.actions + "</div>" : "") + "</div>";
  JD.skeletonCards = n => Array.from({ length: n }, () => '<div class="jd-skel jd-pcard--skel" aria-hidden="true"></div>').join("");
  JD.stars = r => {
    const n = Math.round(Number(r) || 0);
    let out = '<span class="jd-stars" role="img" aria-label="' + n + ' out of 5 stars">';
    for (let i = 1; i <= 5; i++) out += '<span class="' + (i <= n ? "" : "is-off") + '">' + JD.icon("star", 16) + "</span>";
    return out + "</span>";
  };
  JD.sellerName = s => (s && (s.business_name || [s.first_name, s.last_name && s.last_name.charAt(0) + "."].filter(Boolean).join(" "))) || "JulaDirect member";

  /* Account area tabs shared by buyer pages. */
  JD.accountNav = active => {
    const tabs = [["account", "me.html", "My account"], ["orders", "orders.html", "Orders"], ["wishlist", "wishlist.html", "Wishlist"], ["messages", "messages.html", "Messages"], ["searches", "saved-searches.html", "Saved searches"], ["compare", "compare.html", "Compare"]];
    const el = document.getElementById("jd-acctnav");
    if (!el) return;
    el.className = "jd-acctnav";
    el.setAttribute("role", "navigation");
    el.setAttribute("aria-label", "Account");
    el.innerHTML = tabs.map(t => '<a class="jd-chip' + (t[0] === active ? " is-active" : "") + '" href="' + t[1] + '"' + (t[0] === active ? ' aria-current="page"' : "") + ">" + t[2] + "</a>").join("");
  };

  /* ---------- compare list (same storage contract as compare.html) ---------- */
  const CMP_KEY = "gambasket_compare_products";
  JD.compare = {
    ids() {
      try {
        const raw = JSON.parse(localStorage.getItem(CMP_KEY) || "[]");
        return [...new Set((Array.isArray(raw) ? raw : []).filter(JD.isUuid))].slice(0, 4);
      } catch (e) { return []; }
    },
    write(ids) {
      try { localStorage.setItem(CMP_KEY, JSON.stringify(ids)); } catch (e) { /* storage unavailable */ }
      window.dispatchEvent(new CustomEvent("gambasket:compare:change", { detail: { ids } }));
    },
    toggle(id) {
      if (!JD.isUuid(id)) return { ok: false, message: "Only live marketplace listings can be compared." };
      let ids = this.ids();
      if (ids.includes(id)) { this.write(ids.filter(x => x !== id)); return { ok: true, selected: false }; }
      if (ids.length >= 4) return { ok: false, message: "You can compare up to 4 products. Remove one first." };
      ids.push(id);
      this.write(ids);
      return { ok: true, selected: true };
    },
    clear() { this.write([]); }
  };
  function syncCompare() {
    const ids = JD.compare.ids();
    const onComparePage = /compare(\.html)?$/i.test(location.pathname);
    JD.$$("[data-compare]").forEach(b => b.setAttribute("aria-pressed", String(ids.includes(b.getAttribute("data-compare")))));
    let tray = document.getElementById("jd-compare-tray");
    if (!ids.length || onComparePage) { if (tray) tray.remove(); return; }
    if (!tray) {
      tray = document.createElement("div");
      tray.id = "jd-compare-tray";
      tray.className = "jd-compare-tray";
      document.body.appendChild(tray);
    }
    tray.innerHTML = "<span>" + ids.length + " selected to compare</span>" +
      (ids.length >= 2 ? '<a class="jd-btn jd-btn--primary jd-btn--sm" href="compare.html">Compare now</a>' : '<span class="jd-muted" style="color:#b9c6e8">Pick one more</span>') +
      '<button type="button" data-compare-clear>Clear</button>';
  }
  JD.syncCompare = syncCompare;

  /* ---------- wishlist / cart state ---------- */
  JD.syncWishlist = async root => {
    const A = JD.auth();
    if (!A) return;
    try {
      await A.ready();
      const user = await A.getUser();
      if (!user) return;
      await A.refreshWishlistCache();
      JD.$$("[data-wish]", root).forEach(b => b.setAttribute("aria-pressed", String(A.isInWishlist(b.getAttribute("data-wish")))));
    } catch (e) { console.warn("[JulaDirect] wishlist sync", e && e.message); }
  };
  async function refreshCartCount() {
    let n = 0;
    try {
      const A = JD.auth();
      if (A) {
        await A.ready();
        const r = await A.getCart();
        n = (r.items || []).reduce((t, i) => t + Number(i.quantity || 0), 0);
      }
    } catch (e) { n = 0; }
    JD.$$("[data-cart-count]").forEach(el => { el.textContent = n > 99 ? "99+" : String(n); el.hidden = n <= 0; });
  }
  JD.refreshCartCount = refreshCartCount;

  JD.addToCart = async (id, qty) => {
    const A = JD.auth();
    if (!A) { JD.toast("Shopping is unavailable right now.", "error"); return { success: false }; }
    try {
      const res = await A.addToCart(id, qty || 1);
      if (res && res.requiresAuth) { location.href = JD.loginUrl(); return res; }
      if (res && res.success) { JD.toast("Added to your cart", "ok"); refreshCartCount(); return res; }
      JD.toast(res && res.error === "INSUFFICIENT_STOCK" ? "Not enough stock available for that quantity." : "We could not add this to your cart.", "error");
      return res || { success: false };
    } catch (e) {
      console.warn("[JulaDirect] add to cart", e && e.message);
      JD.toast("We could not add this to your cart. Please try again.", "error");
      return { success: false };
    }
  };

  /* ---------- product card ---------- */
  JD.productCard = p => {
    const id = JD.esc(p.id);
    const href = "product.html?id=" + encodeURIComponent(p.id);
    const img = JD.safeUrl(p.main_image) || JD.placeholder;
    const s = p._seller || {};
    const stock = Number(p.stock || 0);
    const sold = Number(p.sales_count || 0);
    const price = JD.money(p.price, p.currency);
    const flags = [];
    if (stock <= 0) flags.push('<span class="jd-badge jd-badge--bad">Sold out</span>');
    else if (stock <= 3) flags.push('<span class="jd-badge jd-badge--warn">Only ' + stock + " left</span>");
    if (sold >= 10) flags.push('<span class="jd-badge jd-badge--top">Best seller</span>');
    if (s.verified) flags.push('<span class="jd-badge jd-badge--verified">' + JD.icon("shield", 13) + "Verified</span>");
    if (p.delivery_available === true) flags.push('<span class="jd-badge jd-badge--delivery">' + JD.icon("truck", 14) + "Delivery</span>");
    return '<article class="jd-pcard">' +
      '<a class="jd-pcard__media" href="' + href + '" tabindex="-1" aria-hidden="true"><img src="' + JD.esc(img) + '" alt="" loading="lazy" decoding="async">' +
      (flags.length ? '<span class="jd-pcard__flags">' + flags.join("") + "</span>" : "") + "</a>" +
      '<button class="jd-pcard__fav" type="button" data-wish="' + id + '" aria-pressed="false" aria-label="Save to wishlist">' + JD.icon("heart", 19) + "</button>" +
      '<button type="button" class="jd-pcard__cmp jd-pcard__cmp--float" data-compare="' + id + '" aria-pressed="false" aria-label="Add to comparison" title="Compare">' + JD.icon("scale", 17) + "</button>" +
      '<div class="jd-pcard__body">' +
      '<div class="jd-pcard__price">' + JD.esc(price) + "</div>" +
      '<a class="jd-pcard__title" href="' + href + '">' + JD.esc(p.title) + "</a>" +
      '<div class="jd-pcard__meta"><span>' + JD.icon("pin", 13) + JD.esc(p.location || "The Gambia") + "</span>" + (p.condition ? "<span>" + JD.esc(p.condition) + "</span>" : "") + "</div>" +
      '<button type="button" class="jd-pcard__buy" data-add="' + id + '" aria-label="' + (stock <= 0 ? "Sold out" : "Add " + JD.esc(p.title) + " to cart, " + JD.esc(price)) + '"' + (stock <= 0 ? " disabled" : "") + ">" + JD.icon("bag", 17) + "<span>" + (stock <= 0 ? "Sold out" : JD.esc(price)) + "</span></button>" +
      '<div class="jd-pcard__foot"><span class="jd-pcard__sold">' + (sold > 0 ? sold.toLocaleString("en-GB") + " sold" : JD.esc(p.condition || "New listing")) + "</span>" +
      '<button type="button" class="jd-pcard__add" data-add="' + id + '" aria-label="Add ' + JD.esc(p.title) + ' to cart"' + (stock <= 0 ? " disabled" : "") + ">" + JD.icon("plus", 18) + "</button></div>" +
      '<div class="jd-pcard__seller">' + (s.verified ? JD.icon("shield", 14) : "") + "<span>" + JD.esc(s.name || "JulaDirect member") + "</span></div>" +
      "</div></article>";
  };

  JD.bindProductActions = root => {
    const el = root || document;
    if (el.__jdBound) return;
    el.__jdBound = true;
    /* Registered with the native method so it is never scoped to one tab. */
    (JD.rawAddEventListener || el.addEventListener).call(el, "click", async e => {
      const wish = e.target.closest("[data-wish]");
      const add = e.target.closest("[data-add]");
      const cmp = e.target.closest("[data-compare]");
      if (wish) {
        e.preventDefault();
        const A = JD.auth();
        if (!A) return;
        try {
          const r = await A.toggleWishlist(wish.getAttribute("data-wish"));
          if (r && r.requiresAuth) return;
          const on = A.isInWishlist(wish.getAttribute("data-wish"));
          wish.setAttribute("aria-pressed", String(on));
          window.dispatchEvent(new CustomEvent("jd:wishlist", { detail: { id: wish.getAttribute("data-wish"), on } }));
          JD.toast(on ? "Saved to your wishlist" : "Removed from your wishlist", "ok");
        } catch (err) { JD.toast("We could not update your wishlist.", "error"); }
      } else if (add) {
        e.preventDefault();
        add.disabled = true;
        await JD.addToCart(add.getAttribute("data-add"), 1);
        add.disabled = false;
      } else if (cmp) {
        e.preventDefault();
        const r = JD.compare.toggle(cmp.getAttribute("data-compare"));
        if (!r.ok) JD.toast(r.message, "error");
        else JD.toast(r.selected ? "Added to comparison" : "Removed from comparison", "ok");
      }
    });
  };

  /* ---------- shell ---------- */
  function headerHtml() {
    return '<a class="jd-skip" href="#jd-main">Skip to content</a>' +
      '<div class="jd-top"><div class="jd-container jd-top__in"><span>' + JD.icon("truck", 15) + 'Delivery across Greater Banjul &middot; Pay on delivery</span>' +
      '<nav class="jd-top__links" aria-label="Quick links"><a href="supplier/index.html">Sell on JulaDirect</a><a href="help.html">Help</a><a href="customer-care.html">Customer care</a></nav></div></div>' +
      '<header class="jd-header">' +
      /* takeover bar: shown only while a full-screen homepage banner is live */
      '<div class="jd-tbar jd-container"><button type="button" class="jd-tbtn" id="jd-menu-btn" aria-label="Open menu" aria-haspopup="dialog">' + JD.icon("menu", 22) + "</button>" +
      '<a class="jd-tbar__logo" href="index.html" aria-label="JulaDirect home"><span class="jd-logo__word"><b>Jula</b>Direct</span></a>' +
      '<div class="jd-tbar__actions"><button type="button" class="jd-tbtn" id="jd-search-btn" aria-label="Search" aria-haspopup="dialog">' + JD.icon("search", 21) + "</button>" +
      '<a class="jd-tbtn" href="cart.html" aria-label="Cart">' + JD.icon("cart", 21) + '<em class="jd-badge-count" data-cart-count hidden>0</em></a>' +
      '<a class="jd-tbtn" href="me.html" aria-label="Account">' + JD.icon("user", 21) + "</a></div></div>" +
      /* mobile app header */
      '<div class="jd-mhead jd-container"><div class="jd-mhead__row">' +
      '<button class="jd-area" type="button" id="jd-area-btn" aria-haspopup="dialog"><span class="jd-roundbtn">' + JD.icon("pin", 22) + '</span><span class="jd-area__txt"><small>Shop in</small><strong id="jd-area-label">All Gambia</strong></span>' + JD.icon("chevronDown", 18) + "</button>" +
      '<div class="jd-mhead__actions"><a class="jd-roundbtn" href="cart.html" aria-label="Cart">' + JD.icon("cart", 22) + '<em class="jd-badge-count" data-cart-count hidden>0</em></a>' +
      '<a class="jd-roundbtn" href="me.html" aria-label="Account">' + JD.icon("user", 22) + "</a></div></div>" +
      '<form class="jd-msearch" role="search" action="explore.html" method="get"><span class="jd-msearch__box">' + JD.icon("search", 20) + '<label class="jd-sr" for="jd-q-m">Search JulaDirect</label><input id="jd-q-m" name="q" type="search" placeholder="Search products, brands and sellers" autocomplete="off" maxlength="100"></span>' +
      '<a class="jd-msearch__filter" href="explore.html#filters" aria-label="Open filters">' + JD.icon("filter", 22) + "</a></form></div>" +
      /* desktop header */
      '<div class="jd-container jd-header__row">' +
      '<a class="jd-logo" href="index.html" aria-label="JulaDirect home"><span class="jd-logo__word"><b>Jula</b>Direct</span></a>' +
      '<form class="jd-search" role="search" action="explore.html" method="get"><label class="jd-sr" for="jd-q">Search JulaDirect</label>' +
      '<input id="jd-q" name="q" type="search" placeholder="Search" autocomplete="off" maxlength="100">' +
      '<button class="jd-search__btn" type="submit" aria-label="Search">' + JD.icon("search", 20) + "</button></form>" +
      '<nav class="jd-actions" aria-label="Orders, wishlist, cart and account">' +
      '<a class="jd-act jd-act--orders" href="orders.html">' + JD.icon("package", 20) + "<span>Orders</span></a>" +
      '<a class="jd-act jd-act--wish" href="wishlist.html">' + JD.icon("heart", 20) + "<span>Wishlist</span></a>" +
      '<a class="jd-act" href="cart.html" aria-label="Cart">' + JD.icon("cart", 20) + '<span>Cart</span><em class="jd-badge-count" data-cart-count hidden>0</em></a>' +
      '<div class="jd-account" id="jd-account"></div></nav></div>' +
      '<div class="jd-catrail"><div class="jd-container jd-catrail__in" id="jd-catrail" role="navigation" aria-label="Categories"></div></div></header>';
  }

  function footerHtml() {
    return '<footer class="jd-footer"><div class="jd-container"><div class="jd-footer__grid">' +
      '<div class="jd-footer__brand"><a class="jd-logo" href="index.html" aria-label="JulaDirect home">' + JD.logoMark(36) + '<span class="jd-logo__word"><b>Jula</b>Direct</span></a>' +
      "<p>Trade. Shop. Connect. The digital marketplace of The Gambia, built for buyers and the businesses that serve them.</p></div>" +
      '<div><h3>Marketplace</h3><ul><li><a href="explore.html">Explore products</a></li><li><a href="compare.html">Compare products</a></li><li><a href="saved-searches.html">Saved searches</a></li><li><a href="wishlist.html">Wishlist</a></li><li><a href="how-it-works.html">How it works</a></li></ul></div>' +
      '<div><h3>Sell &amp; partner</h3><ul><li><a href="supplier/index.html">Seller Centre</a></li><li><a href="quick-sell.html">Quick sell</a></li><li><a href="dropshipping.html">Dropshipping</a></li><li><a href="worker-apply.html">Join as courier or worker</a></li><li><a href="affiliate/index.html">Affiliate programme</a></li></ul></div>' +
      '<div><h3>Support</h3><ul><li><a href="help.html">Help centre</a></li><li><a href="customer-care.html">Customer care</a></li><li><a href="security.html">Security</a></li><li><a href="privacy.html">Privacy</a></li><li><a href="about.html">About JulaDirect</a></li></ul></div>' +
      '</div><div class="jd-footer__base"><span>&copy; ' + new Date().getFullYear() + " JulaDirect. Made in The Gambia.</span><span>Trade. Shop. Connect.</span></div></div></footer>";
  }
  /* Floating, expanding tab navigation: a dark pill of icon tabs where the
     active (or hovered/focused) tab expands to show its label, plus a round
     cart button. */
  const FNAV_TABS = [
    ["home", "index.html", "home", "Home"],
    ["explore", "explore.html", "grid", "Explore"],
    ["wishlist", "wishlist.html", "heart", "Wishlist"],
    ["account", "me.html", "user", "Account"]
  ];
  function floatingNavHtml(active) {
    const tabs = FNAV_TABS.map(t =>
      '<a class="jd-fnav__tab" href="' + t[1] + '" aria-label="' + t[3] + '"' + (active === t[0] ? ' aria-current="page"' : "") + ">" + JD.icon(t[2], 22) + "<span>" + t[3] + "</span></a>"
    ).join("");
    return '<nav class="jd-fnav" id="jd-fnav" aria-label="Primary"><div class="jd-fnav__pill">' + tabs + "</div>" +
      '<a class="jd-fnav__fab" href="cart.html" aria-label="Cart"' + (active === "cart" ? ' aria-current="page"' : "") + ">" + JD.icon("cart", 24) + '<em class="jd-badge-count" data-cart-count hidden>0</em></a></nav>';
  }

  /* ---------- area picker (bottom sheet) ---------- */
  const AREAS = ["Banjul", "Serrekunda", "Kanifing", "Bakau", "Fajara", "Kotu", "Kololi", "Brufut", "Brikama"];
  JD.area = {
    list: AREAS,
    get() {
      if (/explore(\.html)?$/i.test(location.pathname)) { const q = JD.params().get("location"); return AREAS.includes(q) ? q : "all"; }
      try { const v = localStorage.getItem("jd_area"); return AREAS.includes(v) ? v : "all"; } catch (e) { return "all"; }
    },
    set(v) { try { v === "all" ? localStorage.removeItem("jd_area") : localStorage.setItem("jd_area", v); } catch (e) { /* ignore */ } }
  };
  function paintArea() {
    const el = document.getElementById("jd-area-label");
    if (el) { const a = JD.area.get(); el.textContent = a === "all" ? "All Gambia" : a; }
  }
  function openAreaSheet() {
    if (document.getElementById("jd-area-sheet")) return;
    const cur = JD.area.get();
    const scrim = document.createElement("div");
    scrim.className = "jd-scrim";
    scrim.id = "jd-area-scrim";
    const sheet = document.createElement("div");
    sheet.className = "jd-sheet";
    sheet.id = "jd-area-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "jd-area-title");
    const opt = (v, label) => '<button type="button" class="jd-radio" data-area="' + JD.esc(v) + '"><span>' + JD.esc(label) + "</span>" + (cur === v ? JD.icon("check", 18) : "") + "</button>";
    sheet.innerHTML = '<div class="jd-sheet__grab"></div><h2 id="jd-area-title">Where do you want to shop?</h2><p class="jd-muted" style="margin-bottom:6px">Show listings in your area first.</p>' + opt("all", "All Gambia") + AREAS.map(a => opt(a, a)).join("");
    const close = () => { scrim.remove(); sheet.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", esc); const b = document.getElementById("jd-area-btn"); if (b) b.focus(); };
    const esc = e => { if (e.key === "Escape") close(); };
    scrim.addEventListener("click", close);
    sheet.addEventListener("click", e => {
      const b = e.target.closest("[data-area]");
      if (!b) return;
      const v = b.getAttribute("data-area");
      JD.area.set(v);
      JD.go(JD.root + (v === "all" ? "explore.html" : "explore.html?location=" + encodeURIComponent(v)));
    });
    rawOn(document, "keydown", esc);
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    document.body.style.overflow = "hidden";
    const first = sheet.querySelector(".jd-radio");
    if (first) first.focus();
  }

  /* ---------- recently visited (stored on this device only) ---------- */
  const REC_KEY = "jd_recent_products";
  JD.recent = {
    ids() { try { const a = JSON.parse(localStorage.getItem(REC_KEY) || "[]"); return (Array.isArray(a) ? a : []).filter(JD.isUuid).slice(0, 12); } catch (e) { return []; } },
    add(id) { if (!JD.isUuid(id)) return; const ids = [id].concat(this.ids().filter(x => x !== id)).slice(0, 12); try { localStorage.setItem(REC_KEY, JSON.stringify(ids)); } catch (e) { /* ignore */ } },
    clear() { try { localStorage.removeItem(REC_KEY); } catch (e) { /* ignore */ } }
  };

  async function renderAccount() {
    const box = document.getElementById("jd-account");
    if (!box) return;
    const A = JD.auth();
    let user = null;
    try { if (A) { await A.ready(); user = await A.getUser(); } } catch (e) { user = null; }
    if (!user) {
      box.innerHTML = '<a class="jd-btn jd-btn--ghost jd-btn--sm" href="' + JD.esc(JD.loginUrl()) + '">Log in</a><a class="jd-btn jd-btn--primary jd-btn--sm" href="signup.html">Sign up</a>';
      return;
    }
    let name = "";
    try { const prof = await A.fetchUserProfile(); name = (prof && prof.first_name) || ""; } catch (e) { name = ""; }
    if (!name) name = (user.user_metadata && (user.user_metadata.first_name || user.user_metadata.full_name)) || (user.email || "").split("@")[0] || "Account";
    let roles = [];
    try { roles = (await A.getUserRoles()) || []; } catch (e) { roles = []; }
    const isAdmin = roles.includes("admin");
    const link = (href, icon, label) => '<a href="' + href + '">' + JD.icon(icon, 18) + label + "</a>";
    let work = "";
    if (roles.includes("seller") || isAdmin) work += link("supplier/index.html", "store", "Seller Centre");
    if (roles.includes("delivery_worker") || isAdmin) work += link("delivery/index.html", "truck", "Courier workspace");
    if (roles.includes("marketplace_worker") || isAdmin) work += link("worker/index.html", "shield", "Operations centre");
    if (isAdmin) work += link("admin/index.html", "settings", "Administration") + link("admin/banners.html", "tag", "Homepage banners");
    box.innerHTML = '<button class="jd-act" type="button" id="jd-account-btn" aria-haspopup="true" aria-expanded="false" aria-controls="jd-menu"><span class="jd-avatar" aria-hidden="true">' + JD.esc(name.charAt(0).toUpperCase()) + "</span><span>" + JD.esc(name) + "</span></button>" +
      '<div class="jd-menu" id="jd-menu" hidden><div class="jd-menu__label">My JulaDirect</div>' +
      link("me.html", "user", "My account") + link("orders.html", "package", "Orders &amp; tracking") + link("wishlist.html", "heart", "Wishlist") +
      link("messages.html", "message", "Messages") + link("saved-searches.html", "bookmark", "Saved searches") +
      (work ? '<hr><div class="jd-menu__label">Workspaces</div>' + work : "") +
      '<hr><button type="button" id="jd-signout">' + JD.icon("logout", 18) + "Sign out</button></div>";
    const btn = document.getElementById("jd-account-btn");
    const menu = document.getElementById("jd-menu");
    const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", ev => { ev.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); });
    rawOn(document, "click", ev => { if (!menu.hidden && !box.contains(ev.target)) close(); });
    rawOn(document, "keydown", ev => { if (ev.key === "Escape" && !menu.hidden) { close(); btn.focus(); } });
    document.getElementById("jd-signout").addEventListener("click", async () => {
      try { await A.signOut(); } catch (e) { /* proceed to leave the page */ }
      location.href = JD.root + "index.html";
    });
  }

  let catStats = null;
  function renderCatRail(stats) {
    const rail = document.getElementById("jd-catrail");
    if (!rail || !stats) return;
    catStats = stats;
    const current = JD.params().get("category") || "";
    const onExplore = /explore(\.html)?$/i.test(location.pathname);
    let html = '<a class="jd-chip' + (onExplore && !current ? " is-active" : "") + '" href="explore.html">' + JD.icon("grid", 15) + "All categories</a>";
    (stats.categories || []).slice(0, 14).forEach(c => {
      html += '<a class="jd-chip' + (onExplore && current === c.id ? " is-active" : "") + '" href="explore.html?category=' + encodeURIComponent(c.id) + '">' + JD.esc(c.id) + "</a>";
    });
    rail.innerHTML = html;
  }

  /* ---------- homepage takeover mode ---------- */
  JD.takeover = {
    theme: undefined,
    set(theme) {
      this.theme = theme || null;
      try { sessionStorage.setItem("jd_to_hint", theme ? theme : "0"); } catch (e) { /* ignore */ }
      /* Only the homepage tab shows the takeover; other tabs keep the normal header. */
      if (!JD.router || JD.router.isActive("index")) this.apply();
    },
    apply() {
      let t = this.theme;
      if (t === undefined) {
        try { const h = sessionStorage.getItem("jd_to_hint"); t = h === "light" || h === "dark" || h === "blue" ? h : null; } catch (e) { t = null; }
      }
      document.body.classList.toggle("jd-takeover-on", !!t);
      if (t) document.body.setAttribute("data-to-theme", t); else document.body.removeAttribute("data-to-theme");
    }
  };
  function applyTakeoverHint() {
    if (!document.body.classList.contains("is-homepage")) return;
    try {
      const h = sessionStorage.getItem("jd_to_hint");
      if (h === "light" || h === "dark" || h === "blue") { document.body.classList.add("jd-takeover-on"); document.body.setAttribute("data-to-theme", h); }
    } catch (e) { /* ignore */ }
  }
  function closePanels() { JD.$$(".jd-panel").forEach(p => p.remove()); document.body.style.overflow = ""; }
  function openMenu() {
    if (document.getElementById("jd-menu-panel")) return;
    const p = document.createElement("div");
    p.id = "jd-menu-panel";
    p.className = "jd-panel";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-modal", "true");
    p.setAttribute("aria-label", "Menu");
    const a = (h, l) => '<a href="' + h + '">' + l + "</a>";
    p.innerHTML = '<div class="jd-panel__top jd-container"><span class="jd-logo__word"><b>Jula</b>Direct</span><button type="button" class="jd-tbtn" data-panel-close aria-label="Close menu">' + JD.icon("close", 22) + "</button></div>" +
      '<nav class="jd-panel__nav jd-container" aria-label="Menu">' + a("explore.html", "Shop all") + '<div class="jd-panel__cats" id="jd-panel-cats"></div>' +
      a("wishlist.html", "Wishlist") + a("orders.html", "Orders") + a("messages.html", "Messages") + a("supplier/index.html", "Sell on JulaDirect") + a("help.html", "Help") + "</nav>";
    document.body.appendChild(p);
    document.body.style.overflow = "hidden";
    p.addEventListener("click", e => { if (e.target.closest("[data-panel-close]") || e.target.closest("a")) closePanels(); });
    const first = p.querySelector("[data-panel-close]");
    if (first) first.focus();
    if (JD.data && JD.data.categoryStats) JD.data.categoryStats().then(st => {
      const el = document.getElementById("jd-panel-cats");
      if (el) el.innerHTML = (st.categories || []).slice(0, 8).map(c => '<a href="explore.html?category=' + encodeURIComponent(c.id) + '">' + JD.esc(c.id) + "</a>").join("");
    }).catch(() => {});
  }
  function openSearchPanel() {
    if (document.getElementById("jd-search-panel")) return;
    const p = document.createElement("div");
    p.id = "jd-search-panel";
    p.className = "jd-panel jd-panel--search";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-modal", "true");
    p.setAttribute("aria-label", "Search");
    p.innerHTML = '<form class="jd-panel__search jd-container" role="search" action="explore.html" method="get">' + JD.icon("search", 28) +
      '<label class="jd-sr" for="jd-q-p">Search JulaDirect</label><input id="jd-q-p" name="q" type="search" placeholder="Search products, brands and sellers" autocomplete="off" maxlength="100">' +
      '<button type="button" class="jd-tbtn" data-panel-close aria-label="Close search">' + JD.icon("close", 22) + "</button></form>";
    document.body.appendChild(p);
    document.body.style.overflow = "hidden";
    p.addEventListener("click", e => { if (e.target.closest("[data-panel-close]") || e.target === p) closePanels(); });
    const input = document.getElementById("jd-q-p");
    if (input) input.focus();
  }
  function bindTakeoverBar() {
    const m = document.getElementById("jd-menu-btn");
    const q = document.getElementById("jd-search-btn");
    if (m) m.addEventListener("click", openMenu);
    if (q) q.addEventListener("click", openSearchPanel);
    rawOn(document, "keydown", e => { if (e.key === "Escape" && document.querySelector(".jd-panel")) closePanels(); });
  }

  /* ---------- instant navigation, cache-first rendering, installable shell ---------- */
  const prefetched = new Set();
  const nativeSpeculation = !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules"));
  function prefetchLink(a) {
    if (nativeSpeculation) return;
    try {
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.href === location.href || a.target === "_blank" || a.hasAttribute("download")) return;
      if (u.hash && u.pathname === location.pathname) return;
      if (prefetched.has(u.href) || prefetched.size >= 24) return;
      prefetched.add(u.href);
      const l = document.createElement("link");
      l.rel = "prefetch";
      l.href = u.href;
      l.as = "document";
      document.head.appendChild(l);
    } catch (e) { /* ignore */ }
  }
  function bindInstantNav() {
    const c = navigator.connection;
    const slow = !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "")));
    if (!slow) {
      if (nativeSpeculation) {
        const s = document.createElement("script");
        s.type = "speculationrules";
        s.textContent = JSON.stringify({ prefetch: [
          { where: { selector_matches: ".jd-fnav a" }, eagerness: "eager" },
          { where: { and: [{ href_matches: "/*" }, { not: { selector_matches: "[data-no-prefetch]" } }] }, eagerness: "moderate" }
        ] });
        document.head.appendChild(s);
      } else {
        let t;
        const find = e => (e.target && e.target.closest ? e.target.closest("a[href]") : null);
        rawOn(document, "pointerover", e => { const a = find(e); if (!a || e.pointerType === "touch") return; clearTimeout(t); t = setTimeout(() => prefetchLink(a), 70); }, { passive: true });
        ["pointerdown", "touchstart"].forEach(ev => rawOn(document, ev, e => { const a = find(e); if (a) prefetchLink(a); }, { passive: true }));
        (window.requestIdleCallback || setTimeout)(() => JD.$$(".jd-fnav a").forEach(prefetchLink), 1500);
      }
    }
    /* Restored from the back/forward cache: refresh anything that may have changed. */
    window.addEventListener("pageshow", e => {
      if (e.persisted) { refreshCartCount(); renderAccount(); JD.syncWishlist(document); syncCompare(); }
    });
  }
  function registerApp() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const l = document.createElement("link");
      l.rel = "manifest";
      l.href = "/manifest.webmanifest";
      document.head.appendChild(l);
    }
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
    }
  }

  /* Stale-while-revalidate for public marketplace data. onData runs with cached
     data immediately (if any), then again with fresh data only when it differs.
     Never used for carts, wishlists, orders or anything personal. */
  const SWR = "jd_swr:";
  function swrPrune(max) {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(SWR) === 0) { try { keys.push([k, JSON.parse(sessionStorage.getItem(k)).t]); } catch (e) { sessionStorage.removeItem(k); } }
    }
    keys.sort((a, b) => a[1] - b[1]);
    while (keys.length > max) sessionStorage.removeItem(keys.shift()[0]);
  }
  function swrWrite(key, value) {
    const payload = JSON.stringify({ t: Date.now(), v: value });
    try { sessionStorage.setItem(SWR + key, payload); swrPrune(24); }
    catch (e) { try { swrPrune(4); sessionStorage.setItem(SWR + key, payload); } catch (e2) { /* storage full or unavailable */ } }
  }
  JD.swr = async function (key, fetcher, onData, opts) {
    const maxAge = (opts && opts.maxAge) || 3600000;
    let cachedStr = null;
    try {
      const raw = sessionStorage.getItem(SWR + key);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && Date.now() - c.t < maxAge) { cachedStr = JSON.stringify(c.v); onData(c.v, { stale: true }); }
      }
    } catch (e) { cachedStr = null; }
    try {
      const fresh = await fetcher();
      swrWrite(key, fresh);
      if (cachedStr !== null && JSON.stringify(fresh) === cachedStr) return fresh;
      onData(fresh, { stale: false });
      return fresh;
    } catch (e) {
      if (cachedStr === null) throw e;
      return null;
    }
  };

  /* Repaints the parts of the shell that depend on the current tab/URL. */
  JD.refreshShell = function () {
    paintArea();
    if (catStats) renderCatRail(catStats);
    syncCompare();
  };

  JD.mountShell = function (opts) {
    const o = opts || {};
    /* A tab opened inside the running app calls this again: the shell is already there. */
    if (JD._shellMounted) { if (JD.refreshShell) JD.refreshShell(); return; }
    JD._shellMounted = true;
    if (!o.noBodyClass) document.body.classList.add("jd");
    if (JD.root) {
      const fix = el => { const h = el.getAttribute("href"); if (h && !/^(#|\/|[a-z][a-z0-9+.-]*:)/i.test(h) && !el.dataset.jdFixed) { el.setAttribute("href", JD.root + h); el.dataset.jdFixed = "1"; } };
      const scan = n => { if (n.nodeType !== 1) return; if (n.matches("a[href]")) fix(n); n.querySelectorAll("a[href]").forEach(fix); };
      new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(document.documentElement, { childList: true, subtree: true });
    }
    const h = document.getElementById("jd-header");
    const f = document.getElementById("jd-footer");
    const b = document.getElementById("jd-bottomnav");
    if (h) h.innerHTML = headerHtml();
    if (f) f.outerHTML = footerHtml();
    if (b) b.outerHTML = floatingNavHtml(o.active || "");
    const q = document.getElementById("jd-q");
    if (q) q.value = JD.params().get("q") || "";
    const qm = document.getElementById("jd-q-m");
    if (qm) qm.value = JD.params().get("q") || "";
    paintArea();
    applyTakeoverHint();
    bindTakeoverBar();
    bindInstantNav();
    registerApp();
    const areaBtn = document.getElementById("jd-area-btn");
    if (areaBtn) areaBtn.addEventListener("click", openAreaSheet);
    renderAccount();
    refreshCartCount();
    syncCompare();
    if (JD.data && JD.data.categoryStats) JD.data.categoryStats().then(renderCatRail).catch(() => {});
    window.addEventListener("gambasket:cart:change", refreshCartCount);
    window.addEventListener("gambasket:auth:change", () => { renderAccount(); refreshCartCount(); JD.syncWishlist(document); });
    window.addEventListener("gambasket:compare:change", syncCompare);
    rawOn(document, "click", e => { if (e.target.closest("[data-compare-clear]")) JD.compare.clear(); });
    if (JD.router && JD.router.init) JD.router.init();
  };
})();
