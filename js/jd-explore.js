/* JulaDirect v2 Explore. State lives in the URL using the same parameter
   names the Saved searches page builds (q, category, location, min, max,
   condition, stock, delivery, sort, brandModel) plus seller and page, so
   existing saved-search links keep working. */
(function () {
  "use strict";
  const JD = window.JD;
  const $ = id => document.getElementById(id);
  const CONDITIONS = ["New", "Like New", "Refurbished", "Used - Good", "Used - Fair"];
  const LOCATIONS = ["Banjul", "Serrekunda", "Kanifing", "Bakau", "Fajara", "Kotu", "Kololi", "Brufut", "Brikama"];
  const SORTS = ["newest", "price_asc", "price_desc", "popular"];
  const mobile = window.matchMedia("(max-width: 960px)");
  let state = readState();
  let stats = null;
  let reqId = 0;
  let opener = null;

  const num = v => {
    if (v === "" || v === null || v === undefined) return "";
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? String(n) : "";
  };
  function readState() {
    const p = JD.params();
    const sort = p.get("sort") === "best-selling" ? "popular" : p.get("sort");
    return {
      q: (p.get("q") || "").slice(0, 100),
      category: (p.get("category") || "All").slice(0, 50),
      location: LOCATIONS.includes(p.get("location")) ? p.get("location") : "all",
      min: num(p.get("min")),
      max: num(p.get("max")),
      condition: CONDITIONS.includes(p.get("condition")) ? p.get("condition") : "",
      stock: p.get("stock") === "1",
      delivery: p.get("delivery") === "1",
      sort: SORTS.includes(sort) ? sort : "newest",
      brandModel: (p.get("brandModel") || "").slice(0, 80),
      seller: JD.isUuid(p.get("seller")) ? p.get("seller") : "",
      page: Math.max(1, parseInt(p.get("page"), 10) || 1)
    };
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
  const urlFor = st => { const q = toQuery(st); return location.pathname + (q ? "?" + q : ""); };

  /* ---------- filter form <-> state ---------- */
  function renderCats() {
    const cats = stats ? stats.categories : [];
    const list = [{ id: "All", label: "All categories", count: stats ? stats.total : null }].concat(cats.map(c => ({ id: c.id, label: c.id, count: c.count })));
    if (state.category !== "All" && !cats.some(c => c.id === state.category)) list.push({ id: state.category, label: state.category, count: null });
    $("jd-f-cats").innerHTML = list.map(c =>
      '<label class="jd-radio"><span><input type="radio" name="category" value="' + JD.esc(c.id) + '"' + (state.category === c.id ? " checked" : "") + ">" + JD.esc(c.label) + "</span>" +
      (c.count !== null ? "<small>" + c.count.toLocaleString("en-GB") + "</small>" : "") + "</label>"
    ).join("");
  }
  function fillForm() {
    renderCats();
    $("jd-min").value = state.min;
    $("jd-max").value = state.max;
    $("jd-location").value = state.location;
    $("jd-brand").value = state.brandModel;
    $("jd-stock").checked = state.stock;
    $("jd-delivery").checked = state.delivery;
    $("jd-sort").value = state.sort;
    JD.$$('input[name="condition"]').forEach(r => { r.checked = r.value === state.condition; });
  }
  function readForm() {
    const cat = document.querySelector('input[name="category"]:checked');
    const cond = document.querySelector('input[name="condition"]:checked');
    let min = num($("jd-min").value);
    let max = num($("jd-max").value);
    if (min !== "" && max !== "" && Number(min) > Number(max)) { const t = min; min = max; max = t; }
    return Object.assign({}, state, {
      category: cat ? cat.value : "All",
      condition: cond ? cond.value : "",
      min, max,
      location: $("jd-location").value,
      brandModel: $("jd-brand").value.trim().slice(0, 80),
      stock: $("jd-stock").checked,
      delivery: $("jd-delivery").checked,
      page: 1
    });
  }

  /* ---------- results ---------- */
  function heading() {
    let title = "Explore the marketplace";
    if (state.q) title = "Results for \u201c" + state.q + "\u201d";
    else if (state.category !== "All") title = state.category;
    $("jd-title").textContent = title;
    document.title = title + " \u2014 JulaDirect";
  }
  function activeChips(rows) {
    const chips = [];
    const add = (key, label) => chips.push('<span class="jd-chip">' + JD.esc(label) + '<button type="button" data-remove="' + key + '" aria-label="Remove filter ' + JD.esc(label) + '">' + JD.icon("close", 14) + "</button></span>");
    if (state.q) add("q", "\u201c" + state.q + "\u201d");
    if (state.category !== "All") add("category", state.category);
    if (state.location !== "all") add("location", state.location);
    if (state.condition) add("condition", state.condition);
    if (state.min !== "" || state.max !== "") add("price", "Price " + (state.min !== "" ? "D " + Number(state.min).toLocaleString("en-GB") : "any") + " \u2013 " + (state.max !== "" ? "D " + Number(state.max).toLocaleString("en-GB") : "any"));
    if (state.brandModel) add("brandModel", state.brandModel);
    if (state.stock) add("stock", "In stock");
    if (state.delivery) add("delivery", "Delivery available");
    if (state.seller) add("seller", rows && rows[0] && rows[0]._seller ? "Seller: " + rows[0]._seller.name : "Specific seller");
    $("jd-active").innerHTML = chips.join("") + (chips.length > 1 ? '<button type="button" class="jd-btn jd-btn--ghost jd-btn--sm" data-clear-all>Clear all</button>' : "");
  }
  function pagination(res) {
    const nav = $("jd-pagination");
    if (res.pages <= 1) { nav.innerHTML = ""; return; }
    const link = (n, label, extra) => '<a href="' + JD.esc(urlFor(Object.assign({}, state, { page: n }))) + '" data-page="' + n + '"' + (extra || "") + ">" + label + "</a>";
    const parts = [];
    parts.push(res.page > 1 ? link(res.page - 1, "Previous", ' aria-label="Previous page"') : '<span aria-disabled="true">Previous</span>');
    const shown = new Set([1, res.pages]);
    for (let i = res.page - 2; i <= res.page + 2; i++) if (i > 1 && i < res.pages) shown.add(i);
    let prev = 0;
    [...shown].sort((a, b) => a - b).forEach(n => {
      if (n - prev > 1) parts.push('<span aria-hidden="true">&hellip;</span>');
      parts.push(n === res.page ? '<span aria-current="page">' + n + "</span>" : link(n, String(n), ' aria-label="Page ' + n + '"'));
      prev = n;
    });
    parts.push(res.page < res.pages ? link(res.page + 1, "Next", ' aria-label="Next page"') : '<span aria-disabled="true">Next</span>');
    nav.innerHTML = parts.join("");
  }
  function setGrid(html, asGrid) {
    const g = $("productGrid");
    g.classList.toggle("jd-grid", asGrid);
    g.innerHTML = html;
  }

  async function load() {
    const my = ++reqId;
    heading();
    $("jd-sort").value = state.sort;
    $("jd-count").textContent = "Searching\u2026";
    setGrid(JD.skeletonCards(8), true);
    $("jd-pagination").innerHTML = "";
    try {
      const res = await JD.data.search(state);
      if (my !== reqId) return;
      if (!res.rows.length && res.total > 0 && state.page > res.pages) {
        state.page = res.pages;
        history.replaceState(null, "", urlFor(state));
        return load();
      }
      $("jd-count").textContent = res.total === 0 ? "No products found" : res.total.toLocaleString("en-GB") + (res.total === 1 ? " product" : " products") + (res.pages > 1 ? " \u00b7 page " + res.page + " of " + res.pages : "");
      activeChips(res.rows);
      if (!res.rows.length) {
        setGrid(JD.empty({
          icon: "search",
          title: "No products match your search",
          text: "Try removing a filter or using a broader search term. You can also save this search to be notified when a match is listed.",
          actions: '<button type="button" class="jd-btn jd-btn--primary" data-clear-all>Clear filters</button><a class="jd-btn jd-btn--secondary" href="explore.html">Browse everything</a>'
        }), false);
        return;
      }
      setGrid(res.rows.map(JD.productCard).join(""), true);
      pagination(res);
      JD.syncWishlist($("productGrid"));
      JD.syncCompare();
    } catch (e) {
      if (my !== reqId) return;
      if (e && e.code === "PGRST103" && state.page > 1) {
        state.page = 1;
        history.replaceState(null, "", urlFor(state));
        return load();
      }
      console.warn("[JulaDirect] explore", e && e.message);
      $("jd-count").textContent = "Something went wrong";
      activeChips(null);
      setGrid(JD.empty({
        icon: "search",
        title: "We could not load products",
        text: (e && e.message) || "Please check your connection and try again.",
        actions: '<button type="button" class="jd-btn jd-btn--secondary" id="jd-retry">Try again</button>'
      }), false);
    }
  }

  function go(next, replace) {
    state = next;
    history[replace ? "replaceState" : "pushState"](null, "", urlFor(state));
    load();
  }

  /* ---------- mobile filter drawer ---------- */
  function openDrawer(btn) {
    opener = btn || null;
    $("jd-filters").classList.add("is-open");
    const scrim = document.createElement("div");
    scrim.className = "jd-scrim";
    scrim.id = "jd-scrim";
    scrim.addEventListener("click", closeDrawer);
    document.body.appendChild(scrim);
    document.body.style.overflow = "hidden";
    $("jd-filters-close").focus();
  }
  function closeDrawer() {
    $("jd-filters").classList.remove("is-open");
    const s = $("jd-scrim");
    if (s) s.remove();
    document.body.style.overflow = "";
    if (opener) opener.focus();
  }

  /* ---------- save search ---------- */
  function criteria() {
    const c = { query: state.q.slice(0, 120), category: state.category || "All", location: state.location || "all", inStock: !!state.stock, sort: state.sort };
    if (state.condition) c.condition = state.condition;
    if (state.min !== "") c.minPrice = Number(state.min);
    if (state.max !== "") c.maxPrice = Number(state.max);
    if (state.delivery) c.delivery = true;
    if (state.brandModel) c.brandModel = state.brandModel;
    return c;
  }
  function saveStatus(msg, isError) {
    const el = $("jd-save-status");
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!isError);
  }
  async function saveSearch(ev) {
    ev.preventDefault();
    const name = $("jd-save-name").value.trim();
    if (!name) { saveStatus("Give this search a name.", true); return; }
    const btn = $("jd-save-confirm");
    btn.disabled = true;
    saveStatus("Saving\u2026");
    try {
      const A = JD.auth();
      await A.ready();
      const user = await A.getUser();
      if (!user) { location.href = JD.loginUrl(); return; }
      const c = criteria();
      if (JSON.stringify(c).length > 4000) { saveStatus("These filters are too long to save. Narrow them down.", true); return; }
      const client = await JD.client();
      const { error } = await client.from("saved_searches").insert({ user_id: user.id, name: name.slice(0, 80), criteria: c, notify_on_new: $("jd-save-notify").checked });
      if (error) throw error;
      $("jd-save-dialog").close();
      JD.toast("Search saved. Find it under Saved searches.", "ok");
    } catch (e) {
      console.warn("[JulaDirect] save search", e && e.message);
      saveStatus((e && e.message) || "We could not save this search.", true);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- wiring ---------- */
  function fillFormFrom(st) { const keep = state; state = st; fillForm(); state = keep; }
  function clearFilters() {
    const next = Object.assign({}, state, { category: "All", location: "all", min: "", max: "", condition: "", stock: false, delivery: false, brandModel: "", seller: "", page: 1 });
    fillFormFrom(next);
    go(next);
  }
  function wire() {
    const form = $("jd-filter-form");
    const auto = JD.debounce(() => { if (!mobile.matches) go(readForm()); }, 450);
    form.addEventListener("change", e => { if (e.target.type === "number" || e.target.type === "search") return; if (!mobile.matches) go(readForm()); });
    form.addEventListener("input", e => { if (e.target.type === "number" || e.target.type === "search") auto(); });
    $("jd-sort").addEventListener("change", e => go(Object.assign({}, state, { sort: e.target.value, page: 1 })));
    $("jd-filters-open").addEventListener("click", e => openDrawer(e.currentTarget));
    $("jd-filters-close").addEventListener("click", closeDrawer);
    $("jd-filters-apply").addEventListener("click", () => { go(readForm()); closeDrawer(); });
    $("jd-filters-clear").addEventListener("click", () => { clearFilters(); closeDrawer(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && $("jd-filters").classList.contains("is-open")) closeDrawer(); });

    document.addEventListener("click", e => {
      const rm = e.target.closest("[data-remove]");
      const all = e.target.closest("[data-clear-all]");
      const pg = e.target.closest("[data-page]");
      if (rm) {
        const k = rm.getAttribute("data-remove");
        const next = Object.assign({}, state, { page: 1 });
        if (k === "price") { next.min = ""; next.max = ""; }
        else if (k === "category") next.category = "All";
        else if (k === "location") next.location = "all";
        else if (k === "stock" || k === "delivery") next[k] = false;
        else next[k] = "";
        fillFormFrom(next);
        go(next);
      } else if (all) {
        clearFilters();
      } else if (pg) {
        e.preventDefault();
        go(Object.assign({}, state, { page: Number(pg.getAttribute("data-page")) }));
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (e.target.closest("#jd-retry")) {
        load();
      }
    });

    $("jd-save-search").addEventListener("click", () => {
      const base = state.q || (state.category !== "All" ? state.category : "") || "My JulaDirect search";
      $("jd-save-name").value = base.slice(0, 80);
      saveStatus("");
      $("jd-save-dialog").showModal();
      $("jd-save-name").focus();
    });
    $("jd-save-cancel").addEventListener("click", () => $("jd-save-dialog").close());
    $("jd-save-form").addEventListener("submit", saveSearch);

    window.addEventListener("popstate", () => { state = readState(); fillForm(); load(); });
  }

  JD.mountShell({ active: "explore" });
  JD.bindProductActions(document);
  $("jd-ico-filter").innerHTML = JD.icon("filter", 16);
  $("jd-ico-save").innerHTML = JD.icon("bookmark", 16);
  fillForm();
  wire();
  load();
  JD.data.categoryStats().then(s => { stats = s; renderCats(); }).catch(() => {});
})();
