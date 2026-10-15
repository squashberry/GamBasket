/* GamBasket Explore workspace controls. */
(function () {
    "use strict";

    const state = {
        category: "All", location: "all", minPrice: "", maxPrice: "", conditions: [],
        inStock: false, delivery: false, seller: "all", rating: "all", sort: "newest", discovery: "all", view: "grid"
    };
    const active = document.getElementById("exploreActiveFilters");
    const count = document.getElementById("activeFilterCount");
    const summary = document.getElementById("workspaceResultCount");
    const search = document.getElementById("exploreSearch");
    const desktopSearch = document.getElementById("exploreDesktopSearch");

    function writeUrl() {
        const params = new URLSearchParams();
        if (search?.value.trim()) params.set("q", search.value.trim());
        if (state.category !== "All") params.set("category", state.category);
        if (state.location !== "all") params.set("location", state.location);
        if (state.minPrice) params.set("min", state.minPrice);
        if (state.maxPrice) params.set("max", state.maxPrice);
        if (state.sort !== "newest") params.set("sort", state.sort);
        history.replaceState(null, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`);
    }

    function dispatch() {
        writeUrl();
        window.dispatchEvent(new CustomEvent("gambasket:explore:filters", { detail: { ...state } }));
    }

    function renderSummary() {
        if (!active) return;
        const filters = [];
        if (state.category !== "All") filters.push(["category", state.category]);
        if (state.location !== "all") filters.push(["location", state.location]);
        if (state.minPrice) filters.push(["minPrice", `D ${state.minPrice}+`]);
        if (state.maxPrice) filters.push(["maxPrice", `Up to D ${state.maxPrice}`]);
        state.conditions.forEach(value => filters.push(["condition", value]));
        if (state.inStock) filters.push(["stock", "In stock"]);
        if (state.delivery) filters.push(["delivery", "Delivery"]);
        if (state.seller !== "all") filters.push(["seller", state.seller]);
        if (state.discovery !== "all") filters.push(["discovery", state.discovery]);
        active.innerHTML = filters.map(([key, label]) => `<span class="explore-active-filter">${label}<button type="button" data-remove-filter="${key}" aria-label="Remove ${label}"><svg><use href="#icon-close"></use></svg></button></span>`).join("");
        if (count) { count.textContent = filters.length; count.style.display = filters.length ? "inline-flex" : "none"; }
        dispatch();
    }

    function sync() {
        const category = document.querySelector(`[name="workspaceCategory"][value="${CSS.escape(state.category)}"]`);
        if (category) category.checked = true;
        const location = document.getElementById("workspaceLocationFilter");
        if (location) location.value = state.location;
        const mobileLocation = document.getElementById("mobileWorkspaceLocation");
        if (mobileLocation) mobileLocation.value = state.location;
        ["minPriceFilter", "mobileMinPrice"].forEach(id => { const el = document.getElementById(id); if (el) el.value = state.minPrice; });
        ["maxPriceFilter", "mobileMaxPrice"].forEach(id => { const el = document.getElementById(id); if (el) el.value = state.maxPrice; });
        document.querySelectorAll("[data-workspace-condition]").forEach(el => { el.checked = state.conditions.includes(el.value); });
        ["workspaceInStock", "mobileWorkspaceInStock"].forEach(id => { const el = document.getElementById(id); if (el) el.checked = state.inStock; });
        ["workspaceDelivery", "mobileWorkspaceDelivery"].forEach(id => { const el = document.getElementById(id); if (el) el.checked = state.delivery; });
        if (desktopSearch && search) desktopSearch.value = search.value;
    }

    function clear() {
        Object.assign(state, { category: "All", location: "all", minPrice: "", maxPrice: "", conditions: [], inStock: false, delivery: false, seller: "all", rating: "all", discovery: "all", sort: "newest" });
        if (search) search.value = "";
        sync();
        renderSummary();
    }

    function setCategory(value) { state.category = value; sync(); renderSummary(); }
    document.querySelectorAll("[name=workspaceCategory]").forEach(el => el.addEventListener("change", () => setCategory(el.value)));
    document.querySelectorAll("[data-mobile-category]").forEach(el => el.addEventListener("click", () => { document.querySelectorAll("[data-mobile-category]").forEach(item => item.classList.remove("active")); el.classList.add("active"); setCategory(el.dataset.mobileCategory); }));
    ["workspaceLocationFilter", "mobileWorkspaceLocation"].forEach(id => document.getElementById(id)?.addEventListener("change", event => { state.location = event.target.value; sync(); renderSummary(); }));
    ["minPriceFilter", "maxPriceFilter", "mobileMinPrice", "mobileMaxPrice"].forEach(id => document.getElementById(id)?.addEventListener("input", event => { state[id.toLowerCase().includes("min") ? "minPrice" : "maxPrice"] = event.target.value; sync(); renderSummary(); }));
    document.querySelectorAll("[data-workspace-condition]").forEach(el => el.addEventListener("change", () => { state.conditions = [...document.querySelectorAll("[data-workspace-condition]:checked")].map(item => item.value); renderSummary(); }));
    ["workspaceInStock", "mobileWorkspaceInStock"].forEach(id => document.getElementById(id)?.addEventListener("change", event => { state.inStock = event.target.checked; sync(); renderSummary(); }));
    ["workspaceDelivery", "mobileWorkspaceDelivery"].forEach(id => document.getElementById(id)?.addEventListener("change", event => { state.delivery = event.target.checked; sync(); renderSummary(); }));
    document.querySelectorAll("[name=workspaceSeller]").forEach(el => el.addEventListener("change", () => { state.seller = el.value; renderSummary(); }));
    document.getElementById("workspaceSort")?.addEventListener("change", event => { state.sort = event.target.value; renderSummary(); });
    document.querySelectorAll(".explore-discovery-tab").forEach(el => el.addEventListener("click", () => { document.querySelectorAll(".explore-discovery-tab").forEach(item => item.classList.remove("active")); el.classList.add("active"); state.discovery = el.dataset.discovery; renderSummary(); }));
    document.querySelectorAll(".quick-filter").forEach(el => el.addEventListener("click", () => { document.querySelectorAll(".quick-filter").forEach(item => item.classList.remove("active")); el.classList.add("active"); const type = el.dataset.quickFilter; state.inStock = type === "in_stock"; state.delivery = type === "delivery"; state.discovery = type === "new" ? "new" : type === "deals" ? "deals" : type === "all" ? "all" : state.discovery; sync(); renderSummary(); }));
    document.querySelectorAll(".view-switch").forEach(el => el.addEventListener("click", () => { document.querySelectorAll(".view-switch").forEach(item => item.classList.remove("active")); el.classList.add("active"); state.view = el.dataset.view; document.querySelector(".explore-results")?.classList.toggle("list-view", state.view === "list"); }));
    active?.addEventListener("click", event => { const key = event.target.closest("[data-remove-filter]")?.dataset.removeFilter; if (!key) return; if (key === "category") state.category = "All"; if (key === "location") state.location = "all"; if (key === "minPrice") state.minPrice = ""; if (key === "maxPrice") state.maxPrice = ""; if (key === "condition") state.conditions = []; if (key === "stock") state.inStock = false; if (key === "delivery") state.delivery = false; if (key === "seller") state.seller = "all"; if (key === "discovery") state.discovery = "all"; sync(); renderSummary(); });
    ["clearAllFilters", "desktopClearFilters", "emptyClearFilters", "mobileClearFilters"].forEach(id => document.getElementById(id)?.addEventListener("click", clear));
    document.getElementById("applyWorkspaceFilters")?.addEventListener("click", renderSummary);
    document.getElementById("mobileApplyFilters")?.addEventListener("click", () => { renderSummary(); document.getElementById("mobileFilterDrawer")?.classList.remove("active"); document.getElementById("mobileFilterOverlay")?.classList.remove("active"); document.body.style.overflow = ""; });
    document.getElementById("mobileFilterButton")?.addEventListener("click", () => { document.getElementById("mobileFilterDrawer")?.classList.add("active"); document.getElementById("mobileFilterOverlay")?.classList.add("active"); document.body.style.overflow = "hidden"; });
    ["closeMobileFilters", "mobileFilterOverlay"].forEach(id => document.getElementById(id)?.addEventListener("click", () => { document.getElementById("mobileFilterDrawer")?.classList.remove("active"); document.getElementById("mobileFilterOverlay")?.classList.remove("active"); document.body.style.overflow = ""; }));
    desktopSearch?.addEventListener("input", () => { if (search) { search.value = desktopSearch.value; search.dispatchEvent(new Event("input", { bubbles: true })); } });
    document.getElementById("exploreSearchClear")?.addEventListener("click", () => { if (desktopSearch) desktopSearch.value = ""; if (search) { search.value = ""; search.dispatchEvent(new Event("input", { bubbles: true })); } });

    const params = new URLSearchParams(location.search);
    if (params.get("q")) {
        if (search) search.value = params.get("q");
        if (desktopSearch) desktopSearch.value = params.get("q");
    }
    if (params.get("category")) state.category = params.get("category");
    if (params.get("location")) state.location = params.get("location");
    if (params.get("min")) state.minPrice = params.get("min");
    if (params.get("max")) state.maxPrice = params.get("max");
    if (params.get("sort")) state.sort = params.get("sort");
    sync();
    renderSummary();
})();
