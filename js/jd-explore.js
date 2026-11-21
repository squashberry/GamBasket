/* JulaDirect explore (v3). Filter state lives in the URL using the same parameter names
   the Saved searches page builds (q, category, location, min, max, condition, stock,
   delivery, sort, brandModel) plus seller and page, so existing saved-search links keep
   working. Results come from JD.data.search (server-side filter, sort and pagination). */
(function () {
  "use strict";
  const JD = window.JD;
  const $ = id => document.getElementById(id);
  const CONDITIONS = [["New", "New"], ["Like New", "Like new"], ["Refurbished", "Refurbished"], ["Used - Good", "Used, good"], ["Used - Fair", "Used, fair"]];
  const LOCATIONS = ["Banjul", "Serrekunda", "Kanifing", "Bakau", "Fajara", "Kotu", "Kololi", "Brufut", "Brikama"];
  const SORTS = ["newest", "price_asc", "price_desc", "popular"];
  const QUICK = [["delivery", "Delivery", s => s.delivery, s => ({ delivery: !s.delivery })], ["stock", "In stock", s => s.stock, s => ({ stock: !s.stock })], ["new", "New", s => s.condition === "New", s => ({ condition: s.condition === "New" ? "" : "New" })], ["like", "Like new", s => s.condition === "Like New", s => ({ condition: s.condition === "Like New" ? "" : "Like New" })], ["u1", "Under D1,000", s => s.max === "1000" && s.min === "", s => (s.max === "1000" && s.min === "" ? { max: "" } : { min: "", max: "1000" })], ["u5", "Under D5,000", s => s.max === "5000" && s.min === "", s => (s.max === "5000" && s.min === "" ? { max: "" } : { min: "", max: "5000" })]];
  const mobile = window.matchMedia("(max-width: 960px)");
  const RQ = "jd-recent-queries";
  let state, stats = null, bounds = null, reqId = 0, opener = null, images = {};

  const num = v => { if (v === "" || v === null || v === undefined) return ""; const n = Number(v); return Number.isFinite(n) && n >= 0 ? String(n) : ""; };
  function readState() {
    const p = JD.params(), sort = p.get("sort") === "best-selling" ? "popular" : p.get("sort");
    return { q: (p.get("q") || "").slice(0, 100), category: (p.get("category") || "All").slice(0, 50), location: LOCATIONS.includes(p.get("location")) ? p.get("location") : "all", min: num(p.get("min")), max: num(p.get("max")), condition: CONDITIONS.some(c => c[0] === p.get("condition")) ? p.get("condition") : "", stock: p.get("stock") === "1", delivery: p.get("delivery") === "1", sort: SORTS.includes(sort) ? sort : "newest", brandModel: (p.get("brandModel") || "").slice(0, 80), seller: JD.isUuid(p.get("seller")) ? p.get("seller") : "", page: Math.max(1, parseInt(p.get("page"), 10) || 1) };
  }
  function toQuery(st) {
    const p = new URLSearchParams();
    if (st.q) p.set("q", st.q);
    if (st.category && st.category !== "All") p.set("category", st.category);
    if (st.location !== "all") p.set("location", st.location);
    if (st.min !== "") p.set("min", st.min);
    if (st.max !== "") p.set("max", st.max);
    if (st.condition) p.set("condition", st.condition);
    if (st.stock) p.set("stock", "1");
    if (st.delivery) p.set("delivery", "1");
    if (st.sort !== "newest") p.set("sort", st.sort);
    if (st.brandModel) p.set("brandModel", st.brandModel);
    if (st.seller) p.set("seller", st.seller);
    if (st.page > 1) p.set("page", String(st.page));
    return p.toString();
  }
  state = readState();
  const isActive = () => !JD.router || JD.router.isActive("explore");
  const urlFor = st => { const q = toQuery(st); return location.pathname + (q ? "?" + q : ""); };
  const filterCount = st => ["location", "condition", "brandModel", "seller"].filter(k => st[k] && st[k] !== "all").length + (st.min !== "" || st.max !== "" ? 1 : 0) + (st.stock ? 1 : 0) + (st.delivery ? 1 : 0);

  /* ---------- recent searches ---------- */
  const recents = () => { try { const a = JSON.parse(localStorage.getItem(RQ) || "[]"); return Array.isArray(a) ? a.filter(x => typeof x === "string").slice(0, 6) : []; } catch (e) { return []; } };
  function remember(q) { if (!q) return; try { localStorage.setItem(RQ, JSON.stringify([q].concat(recents().filter(x => x.toLowerCase() !== q.toLowerCase())).slice(0, 6))); } catch (e) { /* storage blocked */ } }
  function suggest(open) {
    const box = $("ex-suggest"), input = $("ex-q");
    if (!open) { box.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
    const term = input.value.trim().toLowerCase();
    const cats = stats ? stats.categories.filter(c => !term || c.id.toLowerCase().includes(term)).slice(0, 4) : [];
    const rec = recents().filter(r => !term || r.toLowerCase().includes(term)).slice(0, 5);
    if (!cats.length && !rec.length) { box.hidden = true; return; }
    box.innerHTML = (rec.length ? '<h3>Recent searches <button type="button" data-clear-recent>Clear</button></h3>' + rec.map(r => '<button type="button" role="option" data-suggest-q="' + JD.esc(r) + '">' + JD.icon("search", 18) + JD.esc(r) + "</button>").join("") : "") +
      (cats.length ? "<h3>Categories</h3>" + cats.map(c => '<button type="button" role="option" data-suggest-cat="' + JD.esc(c.id) + '">' + JD.icon(JD.data.categoryIcon(c.id), 18) + JD.esc(c.id) + "</button>").join("") : "");
    box.hidden = false; input.setAttribute("aria-expanded", "true");
  }

  /* ---------- category rail + quick filters ---------- */
  function renderCats() {
    const cats = stats ? stats.categories : [];
    const list = [{ id: "All", label: "All", icon: "grid" }].concat(cats.map(c => ({ id: c.id, label: c.id, icon: JD.data.categoryIcon(c.id) })));
    if (state.category !== "All" && !cats.some(c => c.id === state.category)) list.push({ id: state.category, label: state.category, icon: "bag" });
    $("ex-cats").innerHTML = list.map(c => '<button type="button" class="ex-cat" data-cat="' + JD.esc(c.id) + '" aria-pressed="' + (state.category === c.id) + '"><span class="ex-cat__i">' + (images[c.id] ? '<img src="' + JD.esc(images[c.id]) + '" alt="" loading="lazy">' : JD.icon(c.icon, 26)) + '</span><span class="n">' + JD.esc(c.label) + "</span></button>").join("");
  }
  function renderQuick() {
    $("ex-quick").innerHTML = QUICK.map(q => '<button type="button" class="ex-pill" data-quick="' + q[0] + '" aria-pressed="' + !!q[2](state) + '">' + q[1] + "</button>").join("");
  }
  function renderOpts() {
    $("ex-cond").innerHTML = CONDITIONS.map(c => '<button type="button" class="ex-opt" data-cond="' + JD.esc(c[0]) + '" aria-pressed="' + (state.condition === c[0]) + '">' + c[1] + "</button>").join("");
    $("ex-loc").innerHTML = ['<button type="button" class="ex-opt" data-loc="all" aria-pressed="' + (state.location === "all") + '">All Gambia</button>'].concat(LOCATIONS.map(l => '<button type="button" class="ex-opt" data-loc="' + l + '" aria-pressed="' + (state.location === l) + '">' + l + "</button>")).join("");
  }
  function fillForm() {
    renderCats(); renderQuick(); renderOpts();
    $("ex-min").value = state.min; $("ex-max").value = state.max;
    $("ex-brand").value = state.brandModel; $("ex-stock").checked = state.stock; $("ex-delivery").checked = state.delivery;
    $("ex-q").value = state.q; $("ex-q-clear").hidden = !state.q; $("ex-sort").value = state.sort;
    syncRange(state.min, state.max);
    const n = filterCount(state), b = $("ex-fcount"); b.hidden = !n; b.textContent = String(n);
  }
  function readForm() {
    let min = num($("ex-min").value), max = num($("ex-max").value);
    if (min !== "" && max !== "" && Number(min) > Number(max)) { const t = min; min = max; max = t; }
    return Object.assign({}, state, { min, max, brandModel: $("ex-brand").value.trim().slice(0, 80), stock: $("ex-stock").checked, delivery: $("ex-delivery").checked, page: 1 });
  }

  /* ---------- results ---------- */
  function heading() {
    let t = "Explore the marketplace";
    if (state.q) t = "Results for \u201c" + state.q + "\u201d"; else if (state.category !== "All") t = state.category;
    $("jd-title").textContent = t; document.title = t + " \u2014 JulaDirect";
  }
  function chips(rows) {
    const out = [], add = (k, l) => out.push('<span class="ex-chip">' + JD.esc(l) + '<button type="button" data-remove="' + k + '" aria-label="Remove filter ' + JD.esc(l) + '">' + JD.icon("close", 14) + "</button></span>");
    if (state.q) add("q", "\u201c" + state.q + "\u201d");
    if (state.category !== "All") add("category", state.category);
    if (state.location !== "all") add("location", state.location);
    if (state.condition) add("condition", state.condition);
    if (state.min !== "" || state.max !== "") add("price", "D " + (state.min !== "" ? Number(state.min).toLocaleString("en-GB") : "0") + " \u2013 " + (state.max !== "" ? Number(state.max).toLocaleString("en-GB") : "any"));
    if (state.brandModel) add("brandModel", state.brandModel);
    if (state.stock) add("stock", "In stock");
    if (state.delivery) add("delivery", "Delivery available");
    $("jd-active").innerHTML = out.join("") + (out.length > 1 ? '<button type="button" class="ex-link" data-clear-all>Clear all</button>' : "");
    const strip = $("ex-seller");
    if (state.seller && rows && rows[0] && rows[0]._seller) {
      const s = rows[0]._seller; strip.hidden = false;
      strip.className = "ex-seller";
      strip.innerHTML = '<span class="jd-seller__av" style="width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--jd-blue-600);color:#fff;font-weight:750">' + JD.esc(s.name.charAt(0).toUpperCase()) + "</span><div><b>" + JD.esc(s.name) + (s.verified ? JD.icon("shield", 16) : "") + "</b><small>" + (s.verified ? "Verified seller" : "JulaDirect member") + '</small></div><button type="button" class="ex-link" style="margin-left:auto" data-remove="seller">Show all sellers</button>';
    } else strip.hidden = true;
  }
  function pagination(res) {
    const nav = $("jd-pagination");
    if (res.pages <= 1) { nav.innerHTML = ""; return; }
    const link = (n, label, extra) => '<a href="' + JD.esc(urlFor(Object.assign({}, state, { page: n }))) + '" data-page="' + n + '"' + (extra || "") + ">" + label + "</a>";
    const parts = [res.page > 1 ? link(res.page - 1, "Previous", ' aria-label="Previous page"') : '<span aria-disabled="true">Previous</span>'];
    const shown = new Set([1, res.pages]); for (let i = res.page - 2; i <= res.page + 2; i++) if (i > 1 && i < res.pages) shown.add(i);
    let prev = 0;
    [...shown].sort((a, b) => a - b).forEach(n => { if (n - prev > 1) parts.push('<span aria-hidden="true">&hellip;</span>'); parts.push(n === res.page ? '<span aria-current="page">' + n + "</span>" : link(n, String(n), ' aria-label="Page ' + n + '"')); prev = n; });
    parts.push(res.page < res.pages ? link(res.page + 1, "Next", ' aria-label="Next page"') : '<span aria-disabled="true">Next</span>');
    nav.innerHTML = parts.join("");
  }
  const setGrid = (html, asGrid) => { const g = $("productGrid"); g.classList.toggle("jd-grid", asGrid); g.innerHTML = html; };
  function emptyState() {
    const cats = stats ? stats.categories.slice(0, 6) : [];
    return '<div class="ex-sugg"><div class="jd-empty__icon" style="margin:0">' + JD.icon("search", 28) + "</div><h3>No products match your search</h3><p>Try removing a filter or using a broader search. You can also save this search to be notified when a match is listed.</p>" +
      (cats.length ? '<div class="ex-sugg__cats">' + cats.map(c => '<button type="button" class="ex-pill" data-cat="' + JD.esc(c.id) + '">' + JD.esc(c.id) + "</button>").join("") + "</div>" : "") +
      '<div class="ex-sugg__btns"><button type="button" class="jd-btn jd-btn--primary" data-clear-all>Clear filters</button><button type="button" class="jd-btn jd-btn--secondary" data-save-open>Save this search</button></div></div>';
  }
  async function load() {
    const my = ++reqId; heading();
    $("ex-sort").value = state.sort; $("jd-count").textContent = "Searching\u2026";
    setGrid(JD.skeletonCards(8), true); $("jd-pagination").innerHTML = "";
    const snap = Object.assign({}, state);
    const paint = (res, meta) => {
      if (my !== reqId) return;
      if (!res.rows.length && res.total > 0 && snap.page > res.pages && !(meta && meta.stale)) { state.page = res.pages; if (isActive()) history.replaceState(null, "", urlFor(state)); load(); return; }
      $("jd-count").innerHTML = res.total === 0 ? "No products found" : "<strong>" + res.total.toLocaleString("en-GB") + "</strong> " + (res.total === 1 ? "product" : "products") + (res.pages > 1 ? ' <span class="jd-muted">&middot; page ' + res.page + " of " + res.pages + "</span>" : "");
      chips(res.rows);
      if (!res.rows.length) { setGrid(emptyState(), false); $("jd-pagination").innerHTML = ""; return; }
      setGrid(res.rows.map(JD.productCard).join(""), true);
      pagination(res); JD.syncWishlist($("productGrid")); JD.syncCompare();
    };
    try { await JD.swr("explore:" + toQuery(snap), () => JD.data.search(snap), paint); }
    catch (err) {
      if (my !== reqId) return;
      if (err && err.code === "PGRST103" && state.page > 1) { state.page = 1; if (isActive()) history.replaceState(null, "", urlFor(state)); return load(); }
      console.warn("[JulaDirect] explore", err && err.message);
      $("jd-count").textContent = "Something went wrong"; chips(null);
      setGrid(JD.empty({ icon: "search", title: "We could not load products", text: (err && err.message) || "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="jd-retry">Try again</button>' }), false);
    }
  }
  function go(next, replace) {
    state = next;
    if (state.q) remember(state.q);
    history[replace ? "replaceState" : "pushState"](null, "", urlFor(state));
    fillForm(); load();
  }

  /* ---------- price range ---------- */
  function histPaint() {
    if (!bounds) return;
    const lo = Number($("ex-rmin").value), hi = Number($("ex-rmax").value), span = Math.max(1, bounds.max - bounds.min), peak = Math.max.apply(null, bounds.bins) || 1;
    $("ex-hist").innerHTML = bounds.bins.map((n, i) => { const from = bounds.min + i / 24 * span, to = bounds.min + (i + 1) / 24 * span; return '<i class="' + (to >= lo && from <= hi ? "is-in" : "") + '" style="height:' + Math.max(8, Math.round(n / peak * 100)) + '%"></i>'; }).join("");
    const f = $("ex-fill"); f.style.left = (lo - bounds.min) / span * 100 + "%"; f.style.width = (hi - lo) / span * 100 + "%";
  }
  function syncRange(a, b) {
    if (!bounds) return;
    const lo = a !== "" ? Math.max(bounds.min, Math.min(Number(a), bounds.max)) : bounds.min, hi = b !== "" ? Math.min(bounds.max, Math.max(Number(b), bounds.min)) : bounds.max;
    $("ex-rmin").value = Math.min(lo, hi); $("ex-rmax").value = Math.max(lo, hi); histPaint();
  }
  function initRange(ps) {
    if (!ps || ps.max <= ps.min) return;
    bounds = ps;
    const step = String(Math.max(1, Math.round((ps.max - ps.min) / 200)));
    ["ex-rmin", "ex-rmax"].forEach(id => { const r = $(id); r.min = ps.min; r.max = ps.max; r.step = step; });
    $("ex-avg").textContent = "The average price is D " + ps.avg.toLocaleString("en-GB");
    ["ex-avg", "ex-hist", "ex-range"].forEach(id => { $(id).hidden = false; });
    syncRange(state.min, state.max);
  }
  function slide(which) {
    if (!bounds) return;
    const a = $("ex-rmin"), b = $("ex-rmax"); let lo = Number(a.value), hi = Number(b.value);
    if (lo > hi) { if (which === "min") { lo = hi; a.value = lo; } else { hi = lo; b.value = hi; } }
    $("ex-min").value = lo <= bounds.min ? "" : String(lo); $("ex-max").value = hi >= bounds.max ? "" : String(hi); histPaint();
  }

  /* ---------- filter sheet (phones) ---------- */
  function openSheet(btn) {
    opener = btn || null; const f = $("ex-filters"); f.classList.add("is-open"); f.setAttribute("aria-modal", "true"); f.setAttribute("role", "dialog");
    const s = document.createElement("div"); s.className = "ex-scrim"; s.id = "ex-scrim"; s.addEventListener("click", closeSheet); document.body.appendChild(s);
    document.documentElement.classList.add("qv-lock"); $("ex-filters-close").focus();
  }
  function closeSheet() {
    const f = $("ex-filters"); f.classList.remove("is-open"); f.removeAttribute("aria-modal"); f.removeAttribute("role");
    const s = $("ex-scrim"); if (s) s.remove(); document.documentElement.classList.remove("qv-lock"); if (opener && opener.focus) opener.focus(); opener = null;
  }

  /* ---------- save search ---------- */
  function criteria() {
    const c = { query: state.q.slice(0, 120), category: state.category || "All", location: state.location || "all", inStock: !!state.stock, sort: state.sort };
    if (state.condition) c.condition = state.condition; if (state.min !== "") c.minPrice = Number(state.min); if (state.max !== "") c.maxPrice = Number(state.max);
    if (state.delivery) c.delivery = true; if (state.brandModel) c.brandModel = state.brandModel; return c;
  }
  const saveStatus = (m, bad) => { const el = $("jd-save-status"); el.textContent = m || ""; el.classList.toggle("is-error", !!bad); };
  async function saveSearch(ev) {
    ev.preventDefault();
    const name = $("jd-save-name").value.trim(); if (!name) { saveStatus("Give this search a name.", true); return; }
    const btn = $("jd-save-confirm"); btn.disabled = true; saveStatus("Saving\u2026");
    try {
      const A = JD.auth(); await A.ready(); const user = await A.getUser(); if (!user) { location.href = JD.loginUrl(); return; }
      const c = criteria(); if (JSON.stringify(c).length > 4000) { saveStatus("These filters are too long to save. Narrow them down.", true); return; }
      const client = await JD.client();
      const { error } = await client.from("saved_searches").insert({ user_id: user.id, name: name.slice(0, 80), criteria: c, notify_on_new: $("jd-save-notify").checked });
      if (error) throw error;
      $("jd-save-dialog").close(); JD.toast("Search saved. Find it under Saved searches.", "ok");
    } catch (e) { console.warn("[JulaDirect] save search", e && e.message); saveStatus((e && e.message) || "We could not save this search.", true); } finally { btn.disabled = false; }
  }
  function openSave() { $("jd-save-name").value = (state.q || (state.category !== "All" ? state.category : "") || "My JulaDirect search").slice(0, 80); saveStatus(""); $("jd-save-dialog").showModal(); $("jd-save-name").focus(); }

  const cleared = () => Object.assign({}, state, { category: "All", location: "all", min: "", max: "", condition: "", stock: false, delivery: false, brandModel: "", seller: "", q: state.q, page: 1 });

  /* ---------- recently viewed ---------- */
  async function loadRecent() {
    const ids = JD.recent.ids(), sec = $("ex-recent-sec"); if (!ids.length) { sec.hidden = true; return; }
    try { const rows = (await JD.data.byIds(ids)).slice(0, 4); if (!rows.length) { sec.hidden = true; return; } sec.hidden = false; $("ex-recent").innerHTML = rows.map(JD.productCard).join(""); JD.syncWishlist($("ex-recent")); JD.syncCompare(); } catch (e) { sec.hidden = true; }
  }

  /* ---------- wiring ---------- */
  function wire() {
    const auto = JD.debounce(() => { if (!mobile.matches) go(readForm()); }, 450);
    $("ex-form").addEventListener("input", e => { if (e.target.type === "number" || e.target.type === "search") { syncRange($("ex-min").value, $("ex-max").value); auto(); } });
    $("ex-form").addEventListener("change", e => { if (e.target.type === "checkbox" && !mobile.matches) go(readForm()); });
    $("ex-rmin").addEventListener("input", () => { slide("min"); auto(); });
    $("ex-rmax").addEventListener("input", () => { slide("max"); auto(); });
    $("ex-sort").addEventListener("change", e => go(Object.assign({}, state, { sort: e.target.value, page: 1 })));
    JD.$$("[data-view]").forEach(b => b.addEventListener("click", () => { setView(b.getAttribute("data-view")); }));
    $("ex-filters-open").addEventListener("click", e => openSheet(e.currentTarget));
    $("ex-filters-close").addEventListener("click", closeSheet);
    $("ex-apply").addEventListener("click", () => { go(readForm()); closeSheet(); });
    $("ex-clear").addEventListener("click", () => { go(cleared()); closeSheet(); });
    $("ex-clear-top").addEventListener("click", () => go(cleared()));
    $("ex-search").addEventListener("submit", e => { e.preventDefault(); suggest(false); go(Object.assign({}, state, { q: $("ex-q").value.trim().slice(0, 100), page: 1 })); });
    $("ex-q").addEventListener("input", () => { $("ex-q-clear").hidden = !$("ex-q").value; suggest(true); });
    $("ex-q").addEventListener("focus", () => suggest(true));
    $("ex-q-clear").addEventListener("click", () => { $("ex-q").value = ""; $("ex-q-clear").hidden = true; $("ex-q").focus(); if (state.q) go(Object.assign({}, state, { q: "", page: 1 })); });
    $("jd-save-search").addEventListener("click", openSave);
    $("jd-save-cancel").addEventListener("click", () => $("jd-save-dialog").close());
    $("jd-save-form").addEventListener("submit", saveSearch);
    document.addEventListener("keydown", e => { if (e.key === "Escape") { if ($("ex-filters").classList.contains("is-open")) closeSheet(); suggest(false); } });
    document.addEventListener("click", e => {
      const t = e.target;
      if (!t.closest("#ex-search")) suggest(false);
      let b;
      if ((b = t.closest("[data-cat]"))) { go(Object.assign({}, state, { category: b.getAttribute("data-cat"), page: 1 })); return; }
      if ((b = t.closest("[data-quick]"))) { const q = QUICK.find(x => x[0] === b.getAttribute("data-quick")); go(Object.assign({}, state, q[3](state), { page: 1 })); return; }
      if ((b = t.closest("[data-cond]"))) { const v = b.getAttribute("data-cond"); state = Object.assign({}, state, { condition: state.condition === v ? "" : v }); renderOpts(); if (!mobile.matches) go(readForm()); return; }
      if ((b = t.closest("[data-loc]"))) { state = Object.assign({}, state, { location: b.getAttribute("data-loc") }); renderOpts(); if (!mobile.matches) go(readForm()); return; }
      if ((b = t.closest("[data-suggest-q]"))) { suggest(false); go(Object.assign({}, state, { q: b.getAttribute("data-suggest-q"), page: 1 })); return; }
      if ((b = t.closest("[data-suggest-cat]"))) { suggest(false); go(Object.assign({}, state, { category: b.getAttribute("data-suggest-cat"), page: 1 })); return; }
      if (t.closest("[data-clear-recent]")) { try { localStorage.removeItem(RQ); } catch (er) { /* ignore */ } suggest(false); return; }
      if ((b = t.closest("[data-remove]"))) {
        const k = b.getAttribute("data-remove"), next = Object.assign({}, state, { page: 1 });
        if (k === "price") { next.min = ""; next.max = ""; } else if (k === "category") next.category = "All"; else if (k === "location") next.location = "all"; else if (k === "stock" || k === "delivery") next[k] = false; else next[k] = "";
        go(next); return;
      }
      if (t.closest("[data-clear-all]")) { go(cleared()); return; }
      if (t.closest("[data-save-open]")) { openSave(); return; }
      if ((b = t.closest("[data-page]"))) { e.preventDefault(); go(Object.assign({}, state, { page: Number(b.getAttribute("data-page")) })); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      if (t.closest("#jd-retry")) load();
    });
    window.addEventListener("popstate", () => { const next = readState(); if (toQuery(next) === toQuery(state)) return; state = next; fillForm(); load(); });
    window.addEventListener("jd:pane:hide", e => { if (e.detail.route === "explore" && $("ex-filters").classList.contains("is-open")) closeSheet(); });
    window.addEventListener("jd:pane:show", e => {
      if (e.detail.route !== "explore" || e.detail.first) return;
      loadRecent();
      if (location.hash === "#filters" && mobile.matches) { openSheet($("ex-filters-open")); history.replaceState(history.state, "", location.pathname + location.search); }
    });
  }

  function setView(v) {
    const list = v === "list";
    $("productGrid").classList.toggle("is-list", list);
    JD.$$("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === v)));
    try { localStorage.setItem("jd-ex-view", v); } catch (e) { /* ignore */ }
  }

  JD.mountShell({ active: "explore" });
  JD.bindProductActions(document);
  $("ex-ico-search").innerHTML = JD.icon("search", 20); JD.$$("#ex-search .sx-cam").forEach(b => { b.innerHTML = JD.icon("camera", 21); }); $("ex-ico-filter").innerHTML = JD.icon("filter", 16); $("ex-ico-save").innerHTML = JD.icon("bookmark", 16); $("ex-q-clear").innerHTML = JD.icon("close", 16); $("ex-filters-close").innerHTML = JD.icon("close", 20);
  JD.$$("[data-view]")[0].innerHTML = JD.icon("grid", 19); JD.$$("[data-view]")[1].innerHTML = JD.icon("list", 19);
  try { const v = localStorage.getItem("jd-ex-view"); if (v === "list") setView("list"); } catch (e) { /* ignore */ }
  fillForm(); wire(); load(); loadRecent();
  if (location.hash === "#filters" && mobile.matches) openSheet($("ex-filters-open"));
  JD.data.categoryStats().then(s => { stats = s; renderCats(); }).catch(() => {});
  JD.data.categoryImages().then(i => { images = i || {}; renderCats(); }).catch(() => {});
  JD.data.priceStats().then(initRange).catch(() => {});
})();
