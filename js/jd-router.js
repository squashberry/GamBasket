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
  const ROUTES = { index: "home", explore: "explore", wishlist: "wishlist", cart: "cart", compare: "" };
  /* Body classes that belong to one pane and must not leak into another. */
  const MANAGED = ["is-homepage", "has-mobilebar", "jd-pdp-page"];
  /* Events that only make sense for the pane that registered them. */
  const POINTER = new Set(["click", "auxclick", "dblclick", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "input", "change", "submit", "focusin", "focusout"]);
  const WHEN_ACTIVE = new Set(["keydown", "keyup", "keypress", "popstate", "hashchange"]);

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
    const last = (parts.pop() || "index").replace(/\.html$/i, "");
    if (parts.length) return null;
    return Object.prototype.hasOwnProperty.call(ROUTES, last) ? last : null;
  }
  const fileFor = route => route + ".html";

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
    const p = fetch(fileFor(route), { credentials: "same-origin" }).then(res => {
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

  /* ---------- panes ---------- */
  function shellNodes() { return { footer: document.querySelector(".jd-footer"), nav: document.getElementById("jd-fnav") }; }
  function pushUrl(url) { if (url.href !== location.href) history.pushState({ jdRoute: routeOf(url) }, "", url.href); }

  function setFlags(pane) {
    MANAGED.forEach(c => document.body.classList.toggle(c, pane.flags.has(c)));
  }
  /* Pane-owned body classes: applies to <body> only while that pane is showing. */
  JD.paneClass = function (route, cls, on) {
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
    const active = ROUTES[route];
    document.querySelectorAll(".jd-fnav__tab, .jd-fnav__fab").forEach(a => {
      const on = routeOf(a.getAttribute("href")) === route && active !== "";
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
    panes.forEach(p => { if (p.main) { if (p === pane) p.main.id = "jd-main"; else p.main.removeAttribute("id"); } });
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
    const pane = { route, el: wrapper, main, flags: new Set(flags), scrollY: 0, title: document.title, desc: "" };
    wrapper.hidden = false;
    panes.set(route, pane);
    return pane;
  }

  async function createPane(route, url, token, push) {
    const html = await fetchHtml(route);
    if (token !== navToken) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const main = doc.getElementById("jd-main");
    if (!main || !doc.getElementById("jd-header")) throw new Error("not an app page");
    if (Array.from(doc.body.querySelectorAll("script")).some(s => !s.getAttribute("src"))) throw new Error("inline script");
    await loadStyles(doc);
    if (token !== navToken) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "jd-pane";
    wrapper.setAttribute("data-route", route);
    wrapper.appendChild(document.importNode(main, true));
    Array.from(doc.body.children).forEach(n => { if (n.tagName === "DIALOG") wrapper.appendChild(document.importNode(n, true)); });

    const flags = Array.from(doc.body.classList).filter(c => MANAGED.indexOf(c) !== -1);
    const pane = makePane(route, wrapper, wrapper.querySelector("main"), flags);
    pane.el.hidden = true;
    const dm = doc.querySelector('meta[name="description"]');
    pane.title = (doc.title || document.title);
    pane.desc = dm ? dm.getAttribute("content") || "" : "";

    const { footer, nav } = shellNodes();
    (footer || nav || document.body.lastElementChild).before(wrapper);
    if (token !== navToken) { panes.delete(route); wrapper.remove(); return null; }

    /* URL and body state must be in place before the page script runs: it reads both. */
    if (push) pushUrl(url);
    activate(pane, url, { first: true });
    /* Give the new pane the unique ids; restore the others afterwards. */
    const strip = [];
    const mine = new Set(Array.from(wrapper.querySelectorAll("[id]")).map(n => n.id));
    panes.forEach(p => {
      if (p === pane) return;
      p.el.querySelectorAll("[id]").forEach(n => { if (mine.has(n.id) && n.id !== "jd-main") { strip.push([n, n.id]); n.removeAttribute("id"); } });
    });

    const have = loadedScripts();
    const end = beginScope(pane);
    try {
      const srcs = Array.from(doc.body.querySelectorAll("script[src]")).map(s => new URL(s.getAttribute("src"), location.href).href);
      for (const src of srcs) { if (!have.has(src)) await loadScript(src); }
    } finally {
      end();
      strip.forEach(([n, id]) => n.setAttribute("id", id));
    }
    return pane;
  }

  async function navigate(target, opts) {
    const o = opts || {};
    let url;
    try { url = new URL(String(target), location.href); } catch (e) { location.href = String(target); return false; }
    const route = routeOf(url);
    if (!ready || !route) { location.href = url.href; return false; }
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
    if (!routeOf(url)) return;
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
    if (!routeOf(url)) return;
    const params = new URLSearchParams();
    new FormData(f).forEach((v, k) => { if (typeof v === "string" && v !== "") params.append(k, v); });
    url.search = params.toString();
    e.preventDefault();
    navigate(url.href);
  }
  function onPop() {
    const route = routeOf(location.href);
    if (!route) { location.reload(); return; }
    const pane = panes.get(route);
    if (pane && pane === current) return;      /* a tab's own history (e.g. Explore filters) */
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
    const main = document.getElementById("jd-main");
    if (!route || !main || !history.pushState || window.top !== window) return;
    const wrapper = document.createElement("div");
    wrapper.className = "jd-pane";
    wrapper.setAttribute("data-route", route);
    main.before(wrapper);
    wrapper.appendChild(main);
    Array.from(document.body.children).forEach(n => { if (n.tagName === "DIALOG") wrapper.appendChild(n); });
    const flags = MANAGED.filter(c => document.body.classList.contains(c));
    const dm = document.querySelector('meta[name="description"]');
    const pane = makePane(route, wrapper, main, flags);
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
      window.addEventListener("load", () => idle(() => Object.keys(ROUTES).forEach(r => { if (r !== initial.route) warm(r); })));
    }
  };
})();
