/* =========================================================
   JulaDirect app router: persistent, multi-state tabs.

   The marketplace is still plain multi-page HTML (so every URL is indexable
   and a direct load or refresh works exactly as before). On top of that, once
   one of the primary tabs has loaded, moving between tabs no longer reloads a
   document:

   - The shell (header, floating nav, footer, cart badge, account menu) stays
     mounted.
   - Each tab is a "pane" that is built once, kept alive and only hidden when
     you leave it, so its scroll position, filters, results and open state are
     still there when you come back.
   - A tab is fetched and started the first time it is opened (and warmed in
     the background when the browser is idle). After that, switching is
     instant.
   - Anything the router cannot handle (other pages, new windows, modified
     clicks, any error) falls back to a normal navigation.

   Page scripts are not rewritten: they are run once per pane, and the
   document/window listeners they register are scoped to their own pane so
   one tab's handlers never react to another tab's DOM.
   ========================================================= */
(function () {
  "use strict";
  const JD = (window.JD = window.JD || {});
  const rawAdd = EventTarget.prototype.addEventListener;
  /* Used by shared helpers that must stay global (e.g. product card actions). */
  JD.rawAddEventListener = rawAdd;

  /* route -> which floating-nav tab is active while it is shown */
  const ROUTES = {
    index: "home", explore: "explore", wishlist: "wishlist", cart: "cart", compare: "",
    product: "", me: "account", orders: "account", messages: "account",
    settings: "account", security: "account", "saved-searches": "account",
    "supplier/index": "", "supplier/add-product": "", "supplier/analytics": "",
    "supplier/customers": "", "supplier/earnings": "", "supplier/edit-product": "",
    "supplier/messages": "", "supplier/orders": "", "supplier/pickup-delivery": "",
    "supplier/products": "", "supplier/quotes": "", "supplier/settings": "",
    "supplier/store": "", "supplier/website": ""
  };
  const WARM_ROUTES = ["index", "explore", "wishlist", "cart", "compare"];
  /* Page-specific body classes are switched with the active pane. */
  const MANAGED = new Set(["is-homepage", "has-mobilebar", "jd-pdp-page", "jd-legacy", "me-page", "messages-page", "settings-page"]);
  /* Events that only make sense for the pane that registered them. */
  const POINTER = new Set(["click", "auxclick", "dblclick", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "input", "change", "submit", "focusin", "focusout"]);
  const WHEN_ACTIVE = new Set(["keydown", "keyup", "keypress", "popstate", "hashchange", "DOMContentLoaded", "jd:pane:show", "jd:pane:hide"]);

  const panes = new Map();
  let current = null;
  let ready = false;
  let navToken = 0;
  let barTimer = 0;
  const htmlCache = new Map();

  function routeOf(u) {
    let url;
    try { url = u instanceof URL ? u : new URL(String(u), location.href); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "supplier") {
      if (parts.length > 2) return null;
      const page = (parts[1] || "index").replace(/\.html$/i, "");
      const route = "supplier/" + page;
      return Object.prototype.hasOwnProperty.call(ROUTES, route) ? route : null;
    }
    const last = (parts.pop() || "index").replace(/\.html$/i, "");
    if (parts.length) return null;
    return Object.prototype.hasOwnProperty.call(ROUTES, last) ? last : null;
  }
  const fileFor = route => route + ".html";
  const isSupplierRoute = route => typeof route === "string" && route.startsWith("supplier/");
  const sameRouteFamily = (a, b) => isSupplierRoute(a) === isSupplierRoute(b);

  /* ---------- listener scoping ---------- */
  function scopeListener(pane, type, fn) {
    if (typeof fn !== "function") return fn;
    if (POINTER.has(type)) {
      return function (e) {
        if (pane.el.hidden) return;
        const t = e && e.target;
        if (t && t.nodeType === 1 && !pane.el.contains(t)) return;
        return fn.call(this, e);
      };
    }
    if (WHEN_ACTIVE.has(type)) {
      return function (e) { if (pane.el.hidden) return; return fn.call(this, e); };
    }
    return fn;
  }
  /* While a pane's own scripts run, document/window listeners they add are scoped. */
  function beginScope(pane) {
    const patch = target => {
      target.addEventListener = function (type, fn, opts) { return rawAdd.call(target, type, scopeListener(pane, type, fn), opts); };
    };
    patch(document);
    patch(window);
    return () => { delete document.addEventListener; delete window.addEventListener; };
  }

  /* ---------- progress bar ---------- */
  function bar(on) {
    let el = document.getElementById("jd-navbar");
    clearTimeout(barTimer);
    if (!on) { if (el) { el.classList.add("is-done"); setTimeout(() => el && el.remove(), 260); } return; }
    barTimer = setTimeout(() => {
      if (el) el.remove();
      el = document.createElement("div");
      el.id = "jd-navbar";
      el.className = "jd-navbar";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }, 140);
  }

  /* ---------- fetching a tab ---------- */
  async function fetchHtml(route) {
    if (htmlCache.has(route)) return htmlCache.get(route);
    const target = new URL(fileFor(route), location.origin).href;
    const p = fetch(target, { credentials: "same-origin" }).then(res => {
      if (!res.ok || !/text\/html/i.test(res.headers.get("content-type") || "")) throw new Error("HTTP " + res.status);
      return res.text();
    });
    htmlCache.set(route, p);
    p.catch(() => htmlCache.delete(route));
    return p;
  }
  function warm(route) {
    if (panes.has(route) || htmlCache.has(route)) return;
    fetchHtml(route).then(html => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script[src]").forEach(s => {
        const href = new URL(s.getAttribute("src"), location.href).href;
        if (loadedScripts().has(href) || document.querySelector('link[rel="prefetch"][href="' + href + '"]')) return;
        const l = document.createElement("link");
        l.rel = "prefetch";
        l.as = "script";
        l.href = href;
        document.head.appendChild(l);
      });
    }).catch(() => {});
  }
  const loadedScripts = () => new Set(Array.from(document.scripts).map(s => s.src).filter(Boolean));

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("script failed: " + src));
      document.body.appendChild(s);
    });
  }
  function loadStyles(doc) {
    const have = new Set(Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href));
    const waits = [];
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
      const href = new URL(l.getAttribute("href"), location.href).href;
      if (have.has(href)) return;
      const n = document.createElement("link");
      n.rel = "stylesheet";
      n.href = href;
      waits.push(new Promise(res => { n.onload = n.onerror = () => res(); setTimeout(res, 3000); }));
      document.head.appendChild(n);
    });
    return Promise.all(waits);
  }

  /* Legacy account pages keep support markup outside <main>. Retain their hidden
     headers, icon sprites, dialogs and page footer inside the pane so the page
     scripts can still find the controls they expect. */
  function appendPageSupport(wrapper, body, main, clone) {
    const copiedSources = new Set();
    const add = node => {
      if (copiedSources.has(node)) return;
      copiedSources.add(node);
      wrapper.appendChild(clone ? document.importNode(node, true) : node);
    };
    Array.from(body.children).forEach(node => {
      if (node === main || node.tagName === "SCRIPT") return;
      if (node.classList && node.classList.contains("jd-wrap")) return;
      if (["jd-header", "jd-footer", "jd-bottomnav"].includes(node.id)) return;
      const tag = node.tagName;
      const sprite = tag === "SVG" && (node.querySelector("symbol") || node.hasAttribute("aria-hidden"));
      if (!["HEADER", "NAV", "FOOTER", "DIALOG"].includes(tag) && !sprite) return;
      add(node);
    });
    body.querySelectorAll("dialog").forEach(dialog => {
      if (main.contains(dialog) || copiedSources.has(dialog)) return;
      if (Array.from(copiedSources).some(node => node.contains && node.contains(dialog))) return;
      add(dialog);
    });
  }

  function appendHeadStyles(wrapper, doc) {
    doc.querySelectorAll("style").forEach(style => wrapper.appendChild(document.importNode(style, true)));
  }

  function runInlineScript(source, type) {
    const script = document.createElement("script");
    if (type) script.type = type;
    script.textContent = source || "";
    document.head.appendChild(script);
    script.remove();
  }

  function setPaneIds(activePane) {
    panes.forEach(pane => {
      if (pane === activePane) {
        if (pane.strippedIds) {
          pane.strippedIds.forEach(([node, id]) => {
            if (node.isConnected) node.setAttribute("id", id);
          });
          pane.strippedIds = null;
        }
        return;
      }
      if (pane.strippedIds) return;
      pane.strippedIds = [];
      pane.el.querySelectorAll("[id]").forEach(node => {
        pane.strippedIds.push([node, node.id]);
        node.removeAttribute("id");
      });
    });
  }

  /* ---------- panes ---------- */
  function shellNodes() { return { footer: document.querySelector(".jd-footer"), nav: document.getElementById("jd-fnav") }; }
  function pushUrl(url) { if (url.href !== location.href) history.pushState({ jdRoute: routeOf(url) }, "", url.href); }

  function setFlags(pane) {
    pane.flags.forEach(c => MANAGED.add(c));
    MANAGED.forEach(c => document.body.classList.toggle(c, pane.flags.has(c)));
  }
  /* Pane-owned body classes: applies to <body> only while that pane is showing. */
  JD.paneClass = function (route, cls, on) {
    MANAGED.add(cls);
    const pane = panes.get(route);
    if (!pane) { document.body.classList.toggle(cls, !!on); return; }
    if (on) pane.flags.add(cls); else pane.flags.delete(cls);
    if (current === pane) document.body.classList.toggle(cls, !!on);
  };

  function setHeadFor(pane) {
    if (pane.title) document.title = pane.title;
    const d = document.querySelector('meta[name="description"]');
    if (d && pane.desc) d.setAttribute("content", pane.desc);
  }

  function closeShellOverlays() {
    let any = false;
    document.querySelectorAll(".jd-panel, #jd-area-sheet, #jd-area-scrim").forEach(n => { n.remove(); any = true; });
    if (any) document.body.style.overflow = "";
  }

  function syncShell(route, url) {
    if (isSupplierRoute(route)) {
      const navRoute = ({
        "supplier/edit-product": "supplier/products",
        "supplier/analytics": "supplier/index",
        "supplier/pickup-delivery": "supplier/settings",
        "supplier/quotes": "supplier/orders"
      })[route] || route;
      document.querySelectorAll(".seller-nav a[href], .seller-mobile-nav a[href]").forEach(a => {
        const on = routeOf(a.href) === navRoute;
        a.classList.toggle("active", on);
        if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      });
    }
    const active = ROUTES[route];
    document.querySelectorAll(".jd-fnav__tab, .jd-fnav__fab").forEach(a => {
      const linkRoute = routeOf(a.getAttribute("href"));
      const on = active !== "" && (linkRoute === route || (active === "account" && linkRoute === "me"));
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const q = route === "explore" ? new URL(url.href).searchParams.get("q") || "" : "";
    ["jd-q", "jd-q-m"].forEach(id => { const el = document.getElementById(id); if (el) el.value = q; });
    if (JD.refreshShell) JD.refreshShell();
  }

  function activate(pane, url, opts) {
    const o = opts || {};
    if (current && current !== pane) {
      window.dispatchEvent(new CustomEvent("jd:pane:hide", { detail: { route: current.route } }));
      current.scrollY = window.scrollY;
      current.title = document.title;
      current.el.querySelectorAll("dialog[open]").forEach(d => { try { d.close(); } catch (e) { /* ignore */ } });
      current.el.hidden = true;
    }
    closeShellOverlays();
    const changed = current !== pane;
    current = pane;
    pane.el.hidden = false;
    setPaneIds(pane);
    if (pane.route === "product") pane.flags.add("jd-pdp-page");
    setFlags(pane);
    if (pane.route === "index") {
      if (JD.takeover && JD.takeover.apply) JD.takeover.apply();
    } else {
      document.body.classList.remove("jd-takeover-on");
      document.body.removeAttribute("data-to-theme");
    }
    setHeadFor(pane);
    syncShell(pane.route, url || new URL(location.href));
    if (changed) {
      window.scrollTo({ top: pane.scrollY || 0, left: 0, behavior: "instant" });
      pane.el.classList.remove("jd-pane--in");
      void pane.el.offsetWidth;
      pane.el.classList.add("jd-pane--in");
      if (pane.main) { pane.main.setAttribute("tabindex", "-1"); try { pane.main.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    window.dispatchEvent(new CustomEvent("jd:pane:show", { detail: { route: pane.route, first: !!o.first, url: (url || location).href } }));
    if (!o.first) {
      if (JD.syncWishlist) JD.syncWishlist(pane.el);
      if (JD.syncCompare) JD.syncCompare();
      if (JD.refreshCartCount) JD.refreshCartCount();
    }
  }

  function makePane(route, wrapper, main, flags) {
    const pane = { route, el: wrapper, main, flags: new Set(flags), strippedIds: null, scrollY: 0, title: document.title, desc: "", scriptKeys: new Set() };
    pane.flags.forEach(c => MANAGED.add(c));
    wrapper.hidden = false;
    panes.set(route, pane);
    return pane;
  }

  async function createPane(route, url, token, push) {
    const html = await fetchHtml(route);
    if (token !== navToken) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const main = doc.getElementById("jd-main") || doc.querySelector("main");
    if (!main || (!isSupplierRoute(route) && !doc.getElementById("jd-header"))) throw new Error("not an app page");
    if (isSupplierRoute(route) && doc.querySelector(".seller-shell") && !document.querySelector(".seller-shell")) {
      throw new Error("supplier workspace shell is not mounted");
    }
    await loadStyles(doc);
    if (token !== navToken) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "jd-pane";
    wrapper.setAttribute("data-route", route);
    wrapper.appendChild(document.importNode(main, true));
    if (!isSupplierRoute(route)) appendPageSupport(wrapper, doc.body, main, true);
    appendHeadStyles(wrapper, doc);

    const flags = Array.from(doc.body.classList).filter(c => c !== "jd");
    if (isSupplierRoute(route) && !flags.includes("seller-page")) flags.push("seller-page");
    const pane = makePane(route, wrapper, wrapper.querySelector("main"), flags);
    pane.el.hidden = true;
    const dm = doc.querySelector('meta[name="description"]');
    pane.title = (doc.title || document.title);
    pane.desc = dm ? dm.getAttribute("content") || "" : "";

    if (isSupplierRoute(route)) {
      const sellerShell = document.querySelector(".seller-shell");
      if (sellerShell) sellerShell.appendChild(wrapper);
      else (document.querySelector("footer") || document.body.lastElementChild).before(wrapper);
    } else {
      const { footer, nav } = shellNodes();
      (footer || nav || document.body.lastElementChild).before(wrapper);
    }
    if (token !== navToken) { panes.delete(route); wrapper.remove(); return null; }

    /* The destination URL and active pane are established before page code runs. */
    if (push) pushUrl(url);
    activate(pane, url, { first: true });

    const have = loadedScripts();
    const end = beginScope(pane);
    try {
      for (const original of Array.from(doc.querySelectorAll("script"))) {
        if (original.hasAttribute("src")) {
          const src = new URL(original.getAttribute("src"), url.href).href;
          const path = new URL(src).pathname;
          const paneModule = isSupplierRoute(route) && /\/js\/(?:seller(?:-[a-z-]+)?|supplier-website|business-roles|business-analytics|product-attributes)\.js$/i.test(path);
          if (paneModule) {
            if (!pane.scriptKeys.has(src)) {
              const cacheKey = src + (src.includes("?") ? "&" : "?") + "jd-pane=" + encodeURIComponent(route);
              await loadScript(cacheKey);
              pane.scriptKeys.add(src);
            }
          } else if (!have.has(src)) {
            await loadScript(src);
            have.add(src);
          }
          if (token !== navToken) return null;
          continue;
        }
        const type = (original.getAttribute("type") || "").trim().toLowerCase();
        if (!type || type === "text/javascript" || type === "application/javascript") {
          runInlineScript(original.textContent, type);
        }
      }
      /* Some legacy page initializers wait for DOMContentLoaded even though this
         document is already live. Re-fire it with listener scoping so only this
         visible pane receives those one-time initializers. */
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    } finally {
      end();
    }
    return pane;
  }

  async function navigate(target, opts) {
    const o = opts || {};
    let url;
    try { url = new URL(String(target), location.href); } catch (e) { location.href = String(target); return false; }
    const route = routeOf(url);
    if (!ready || !route || (current && !sameRouteFamily(current.route, route))) { location.href = url.href; return false; }
    const token = ++navToken;
    const existing = panes.get(route);
    if (existing) {
      bar(false);
      if (o.push !== false) {
        if (existing === current && url.search === location.search && url.hash === location.hash) { window.scrollTo({ top: 0, behavior: "smooth" }); return true; }
        pushUrl(url);
      }
      activate(existing, url);
      /* Explore keeps its filters in the URL: tell it the URL changed (it ignores a no-op). */
      if (route === "explore" && o.push !== false) window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      return true;
    }
    bar(true);
    try {
      const pane = await createPane(route, url, token, o.push !== false);
      bar(false);
      if (!pane && token === navToken) location.href = url.href;
      return true;
    } catch (e) {
      console.warn("[JulaDirect] app navigation fell back to a page load:", e && e.message);
      bar(false);
      if (token === navToken) location.href = url.href;
      return false;
    }
  }

  /* ---------- events ---------- */
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if ((a.target && a.target !== "_self") || a.hasAttribute("download") || a.hasAttribute("data-no-router")) return;
    let url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    const route = routeOf(url);
    if (!route || (current && !sameRouteFamily(current.route, route))) return;
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    navigate(url.href);
  }
  function onSubmit(e) {
    if (e.defaultPrevented) return;
    const f = e.target;
    if (!f || f.tagName !== "FORM" || String(f.getAttribute("method") || "get").toLowerCase() !== "get") return;
    const action = f.getAttribute("action");
    if (!action) return;
    const url = new URL(action, location.href);
    const route = routeOf(url);
    if (!route || (current && !sameRouteFamily(current.route, route))) return;
    const params = new URLSearchParams();
    new FormData(f).forEach((v, k) => { if (typeof v === "string" && v !== "") params.append(k, v); });
    url.search = params.toString();
    e.preventDefault();
    navigate(url.href);
  }
  function onPop() {
    const route = routeOf(location.href);
    if (!route || (current && !sameRouteFamily(current.route, route))) { location.reload(); return; }
    const pane = panes.get(route);
    if (pane && pane === current) {
      window.dispatchEvent(new CustomEvent("jd:pane:show", { detail: { route, first: false, url: location.href } }));
      return;
    }
    navigate(location.href, { push: false });
  }

  /* ---------- public API ---------- */
  JD.router = {
    canHandle: u => ready && !!routeOf(u),
    navigate: u => navigate(u),
    isActive: route => !ready || (current && current.route === route),
    routeOf
  };

  /* The page that was loaded directly becomes the first pane. This runs as soon as this
     file loads (before the page's own script), so every listener that script registers
     is scoped to its tab from the start. */
  let initial = null;
  (function prepare() {
    const route = routeOf(location.href);
    const main = document.getElementById("jd-main") || document.querySelector("main");
    if (!route || !main || !history.pushState || window.top !== window) return;
    const wrapper = document.createElement("div");
    wrapper.className = "jd-pane";
    wrapper.setAttribute("data-route", route);
    main.before(wrapper);
    wrapper.appendChild(main);
    if (!isSupplierRoute(route)) appendPageSupport(wrapper, document.body, main, false);
    const flags = Array.from(document.body.classList).filter(c => c !== "jd");
    if (isSupplierRoute(route) && !flags.includes("seller-page")) flags.push("seller-page");
    const dm = document.querySelector('meta[name="description"]');
    const pane = makePane(route, wrapper, main, flags);
    if (isSupplierRoute(route)) {
      document.querySelectorAll("script[src]").forEach(script => {
        const src = new URL(script.getAttribute("src"), location.href);
        if (/\/js\/(?:seller(?:-[a-z-]+)?|supplier-website|business-roles|business-analytics|product-attributes)\.js$/i.test(src.pathname)) pane.scriptKeys.add(src.href);
      });
    }
    pane.title = document.title;
    pane.desc = dm ? dm.getAttribute("content") || "" : "";
    current = pane;
    initial = pane;
    const end = beginScope(pane);
    /* Parser-blocking scripts are done by DOMContentLoaded: stop scoping new listeners then. */
    rawAdd.call(document, "DOMContentLoaded", end);
  })();

  /* Called at the end of the shell mount: from here on tab switching is live. */
  JD.router.init = function () {
    if (ready || !initial) return;
    ready = true;
    history.replaceState(Object.assign({}, history.state, { jdRoute: initial.route }), "");

    /* Window (not document) so a page's own handlers run first and can claim a click. */
    rawAdd.call(window, "click", onClick);
    rawAdd.call(window, "submit", onSubmit);
    rawAdd.call(window, "popstate", onPop);

    const c = navigator.connection;
    const slow = !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "")));
    if (!slow) {
      const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
      window.addEventListener("load", () => idle(() => WARM_ROUTES.forEach(r => { if (r !== initial.route) warm(r); })));
    }
  };
})();
