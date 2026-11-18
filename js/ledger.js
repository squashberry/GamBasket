/* JulaDirect "Ledger" shell and helpers (window.LG). Pages using css/ledger.css
   mount it with LG.mount({active}). Reads the existing GamBasketAuth adapter;
   adds no client of its own and no keys. */
(function () {
  "use strict";
  var LG = (window.LG = window.LG || {});
  var $ = function (s, r) { return (r || document).querySelector(s); };
  LG.$ = $;
  LG.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  LG.esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  LG.money = function (n, cur) { var v = Number(n); if (!isFinite(v)) return ""; return (!cur || cur === "GMD" ? "D" : cur) + " " + v.toLocaleString("en-GB", { maximumFractionDigits: 2 }); };
  LG.safeUrl = function (u) { try { var x = new URL(String(u || ""), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };
  LG.auth = function () { return window.GamBasketAuth || null; };
  LG.client = function () { var A = LG.auth(); if (!A) return Promise.resolve(null); return A.ready().then(function () { return A.getClient(); }); };
  LG.loginUrl = function () { return "login.html?redirect=" + encodeURIComponent(location.pathname.split("/").pop() + location.search); };

  LG.toast = function (msg, bad) {
    var box = $("#lg-toasts");
    if (!box) { box = document.createElement("div"); box.id = "lg-toasts"; box.className = "lg-toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    var t = document.createElement("div");
    t.className = "lg-toast" + (bad ? " lg-toast--bad" : "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 3800);
  };

  var NAV = [["shop", "explore.html", "Shop"], ["wishlist", "wishlist.html", "Wishlist"], ["orders", "orders.html", "Orders"], ["messages", "messages.html", "Messages"], ["sell", "supplier/index.html", "Sell"]];
  var TABS = [["home", "index.html", "Home"], ["shop", "explore.html", "Shop"], ["bag", "cart.html", "Bag"], ["orders", "orders.html", "Orders"], ["account", "me.html", "Account"]];

  function cur(active, key) { return active === key ? ' aria-current="page"' : ""; }
  function headerHtml(active) {
    return '<a class="lg-sr" href="#main">Skip to content</a><header class="lg-head"><div class="lg-wrap lg-head__in">' +
      '<a class="lg-mark" href="index.html" aria-label="JulaDirect home">Jula<i>Direct</i></a>' +
      '<nav class="lg-nav" aria-label="Primary">' + NAV.map(function (n) { return '<a href="' + n[1] + '"' + cur(active, n[0]) + ">" + n[2] + "</a>"; }).join("") + "</nav>" +
      '<div class="lg-tools"><button type="button" id="lg-search-btn" aria-expanded="false" aria-controls="lg-search">Search</button>' +
      '<a href="cart.html" class="lg-hide-m">Bag<span class="lg-count" data-lg-count hidden>0</span></a>' +
      '<a href="me.html" id="lg-account">Account</a></div></div>' +
      '<div class="lg-search" id="lg-search" hidden><form class="lg-wrap" role="search" action="explore.html" method="get"><label class="lg-sr" for="lg-q">Search JulaDirect</label>' +
      '<input id="lg-q" name="q" type="search" placeholder="What are you looking for?" autocomplete="off" maxlength="100"><button class="lg-btn lg-btn--accent" type="submit">Search</button></form></div></header>';
  }
  function footerHtml() {
    var col = function (t, links) { return "<div><h3>" + t + "</h3><ul>" + links.map(function (l) { return '<li><a href="' + l[0] + '">' + l[1] + "</a></li>"; }).join("") + "</ul></div>"; };
    return '<footer class="lg-foot"><div class="lg-wrap"><div class="lg-foot__big">Jula<i>Direct</i></div><div class="lg-foot__cols">' +
      col("Shop", [["explore.html", "All products"], ["compare.html", "Compare"], ["wishlist.html", "Wishlist"], ["how-it-works.html", "How it works"]]) +
      col("Account", [["me.html", "My account"], ["orders.html", "Orders"], ["messages.html", "Messages"], ["settings.html", "Settings"]]) +
      col("Sell", [["supplier/index.html", "Seller Centre"], ["quick-sell.html", "Quick sell"], ["dropshipping.html", "Dropshipping"], ["worker-apply.html", "Work with us"]]) +
      col("Help", [["help.html", "Help centre"], ["customer-care.html", "Customer care"], ["privacy.html", "Privacy"], ["about.html", "About"]]) +
      '</div><div class="lg-foot__base"><span>&copy; ' + new Date().getFullYear() + ' JulaDirect. Made in The Gambia.</span><span>Trade. Shop. Connect.</span></div></div></footer>';
  }
  function tabsHtml(active) {
    return '<nav class="lg-tabs" aria-label="Primary">' + TABS.map(function (t) {
      return '<a href="' + t[1] + '"' + cur(active, t[0]) + ">" + t[2] + (t[0] === "bag" ? '<span class="lg-count" data-lg-count hidden>0</span>' : "") + "</a>";
    }).join("") + "</nav>";
  }

  function refreshCount() {
    var A = LG.auth(), n = 0;
    var done = function () { LG.$$("[data-lg-count]").forEach(function (el) { el.textContent = n > 99 ? "99+" : String(n); el.hidden = n <= 0; }); };
    if (!A) { done(); return; }
    A.ready().then(function () { return A.getCart(); }).then(function (r) { n = ((r && r.items) || []).reduce(function (t, i) { return t + Number(i.quantity || 0); }, 0); }).catch(function () { n = 0; }).then(done);
  }
  LG.refreshCount = refreshCount;
  function refreshAccount() {
    var A = LG.auth(), el = $("#lg-account");
    if (!el || !A) return;
    A.ready().then(function () { return A.getUser(); }).then(function (u) {
      if (u) { el.textContent = "Account"; el.setAttribute("href", "me.html"); }
      else { el.textContent = "Sign in"; el.setAttribute("href", LG.loginUrl()); }
    }).catch(function () { /* keep default */ });
  }

  LG.mount = function (opts) {
    var o = opts || {};
    document.body.classList.add("lg");
    var s = $("#lg-strip"), h = $("#lg-header"), f = $("#lg-footer"), t = $("#lg-tabs");
    if (s) s.outerHTML = '<div class="lg-strip">Pay on delivery &middot; Delivery across Greater Banjul</div>';
    if (h) h.outerHTML = headerHtml(o.active || "");
    if (f) f.outerHTML = footerHtml();
    if (t) t.outerHTML = tabsHtml(o.tab || o.active || "");
    var btn = $("#lg-search-btn"), panel = $("#lg-search");
    if (btn && panel) {
      btn.addEventListener("click", function () {
        var open = panel.hidden; panel.hidden = !open; btn.setAttribute("aria-expanded", String(open));
        if (open) $("#lg-q").focus();
      });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); } });
    }
    refreshCount(); refreshAccount();
    window.addEventListener("gambasket:cart:change", refreshCount);
    window.addEventListener("gambasket:auth:change", function () { refreshCount(); refreshAccount(); });
    window.addEventListener("pageshow", function (e) { if (e.persisted) { refreshCount(); refreshAccount(); } });
    /* app feel: prefetch same-origin pages on intent, installable shell */
    try {
      if (window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules")) {
        var sr = document.createElement("script"); sr.type = "speculationrules";
        sr.textContent = JSON.stringify({ prefetch: [{ where: { selector_matches: ".lg-tabs a, .lg-nav a" }, eagerness: "eager" }, { where: { href_matches: "/*" }, eagerness: "moderate" }] });
        document.head.appendChild(sr);
      }
      if (!document.querySelector('link[rel="manifest"]')) { var l = document.createElement("link"); l.rel = "manifest"; l.href = "/manifest.webmanifest"; document.head.appendChild(l); }
      if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
    } catch (e) { /* non-essential */ }
  };
})();
