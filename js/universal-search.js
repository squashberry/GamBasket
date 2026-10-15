/* =========================================================
   GAMBASKET UNIVERSAL MARKETPLACE SEARCH
========================================================= */
(function () {
    "use strict";

    const SEARCH_LIMIT = 3;
    const SEARCH_INPUT_IDS = [
        "mobileSearch",
        "desktopHeroSearchInput",
        "desktopHeaderSearchInput",
        "desktopSearchInput",
        "exploreSearch"
    ];

    const normalise = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

    function saveRecentSearch(value) {
        const term = String(value || "").trim();
        if (!term) return;

        let recent = [];
        try {
            recent = JSON.parse(localStorage.getItem("gambasket_recent_searches") || "[]");
        } catch (_) {}

        recent = [term, ...recent.filter(item => normalise(item) !== normalise(term))].slice(0, 2);
        localStorage.setItem("gambasket_recent_searches", JSON.stringify(recent));
    }

    function collectRenderedProducts() {
        return [...document.querySelectorAll(".product-card")]
            .map(card => ({
                type: "product",
                label: card.querySelector(".product-name")?.textContent?.trim() || "",
                category: card.dataset.category || "",
                location: card.querySelector(".product-location")?.textContent?.trim() || ""
            }))
            .filter(item => item.label);
    }

    function collectCategories(products) {
        const available = new Set(products.map(product => normalise(product.category)).filter(Boolean));
        return [...document.querySelectorAll(".category-card, .category-chip")]
            .map(button => ({
                type: "category",
                label: button.querySelector("span:last-child")?.textContent?.trim() || button.textContent.trim(),
                category: button.dataset.category || ""
            }))
            .filter(item => item.label && available.has(normalise(item.category)));
    }

    function collectLiveData() {
        const products = collectRenderedProducts();
        return { products, categories: collectCategories(products) };
    }

    function scoreMatch(item, query) {
        const label = normalise(item.label);
        const search = normalise(query);
        let score = 0;

        if (label === search) score += 100;
        if (label.startsWith(search)) score += 80;
        if (label.includes(search)) score += 50;
        if (normalise(item.category).includes(search)) score += 20;
        if (normalise(item.location).includes(search)) score += 10;

        return { ...item, score };
    }

    function getMatches(query) {
        const search = normalise(query);
        if (!search) return [];

        const { products, categories } = collectLiveData();
        return [...products, ...categories]
            .map(item => scoreMatch(item, search))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
            .filter((item, index, items) => items.findIndex(other => normalise(other.label) === normalise(item.label)) === index)
            .slice(0, SEARCH_LIMIT);
    }

    function navigateForMatch(match) {
        saveRecentSearch(match.label);
        const parameter = match.type === "category" ? "category" : "q";
        const value = match.type === "category" ? match.category || match.label : match.label;
        window.location.href = `explore.html?${parameter}=${encodeURIComponent(value)}`;
    }

    function setupInput(input) {
        if (!input || input.dataset.universalSearchReady === "true") return;
        input.dataset.universalSearchReady = "true";

        const wrapper = input.closest(".mobile-search, .desktop-hero-search, .desktop-search-fake-input") || input.parentElement;
        if (!wrapper) return;
        wrapper.classList.add("search-autocomplete-host");

        let panel = wrapper.querySelector(".home-search-suggestions");
        if (!panel) {
            panel = document.createElement("div");
            panel.className = "home-search-suggestions";
            wrapper.appendChild(panel);
        }

        function render() {
            const matches = getMatches(input.value);
            panel.innerHTML = "";

            if (!normalise(input.value) || !matches.length) {
                panel.classList.remove("show");
                return;
            }

            matches.forEach(match => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "search-suggestion";
                button.innerHTML = `<svg class="ui-icon"><use href="#icon-${match.type === "category" ? "grid" : "search"}"></use></svg><span>${match.label}</span>`;
                button.addEventListener("click", () => navigateForMatch(match));
                panel.appendChild(button);
            });

            panel.classList.add("show");
        }

        input.addEventListener("input", render);
        input.addEventListener("focus", render);
        input.addEventListener("keydown", event => {
            if (event.key === "Escape") panel.classList.remove("show");
            if (event.key === "Enter" && normalise(input.value)) saveRecentSearch(input.value);
        });

        const form = input.closest("form");
        if (form) form.addEventListener("submit", () => saveRecentSearch(input.value));
        document.addEventListener("click", event => {
            if (!wrapper.contains(event.target)) panel.classList.remove("show");
        });
    }

    function setupUniversalSearch() {
        SEARCH_INPUT_IDS
            .map(id => document.getElementById(id))
            .filter(Boolean)
            .forEach(setupInput);
    }

    setupUniversalSearch();

    const observer = new MutationObserver(mutations => {
        setupUniversalSearch();
        const productsChanged = mutations.some(mutation => [...mutation.addedNodes].some(node => node.nodeType === 1 && (node.matches?.(".product-card") || node.querySelector?.(".product-card"))));
        if (!productsChanged) return;
        SEARCH_INPUT_IDS
            .map(id => document.getElementById(id))
            .filter(input => input && input.value && document.activeElement === input)
            .forEach(input => input.dispatchEvent(new Event("input")));
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
