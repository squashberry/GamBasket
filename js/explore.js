/* =========================================================
   GAMBASKET — EXPLORE MARKETPLACE LOGIC
========================================================= */

(function () {
    "use strict";

    /* =========================================================
       PRODUCTS CATALOG
    ========================================================= */
    const defaultProducts = []; // Public marketplace inventory must come from approved database listings.

    let allProducts = [...defaultProducts];
    let filteredProducts = [...defaultProducts];
    let currentIndex = 0;
    const PAGE_SIZE = 8;
    let isLoading = false;
    let searchDebounceTimer = null;
    let externalFilters = null;

    let savedWishlist = JSON.parse(
        localStorage.getItem("gambasket-wishlist") || "[]"
    );

    /* =========================================================
       DOM ELEMENTS
    ========================================================= */
    const productGrid = document.getElementById("productGrid");
    const loadingIndicator = document.getElementById("loadingIndicator");
    const exploreSearch = document.getElementById("exploreSearch");
    const clearExploreSearch = document.getElementById("clearExploreSearch");
    const exploreSearchLoader = document.getElementById("exploreSearchLoader");
    const exploreHeading = document.getElementById("exploreHeading");
    const exploreResultCount = document.getElementById("exploreResultCount");
    const sortFilter = document.getElementById("sortFilter");
    const locationFilter = document.getElementById("locationFilter");
    const conditionFilter = document.getElementById("conditionFilter");
    const themeToggle = document.getElementById("themeToggle");
    const themeIcon = document.getElementById("themeIcon");

    const productModal = document.getElementById("productModal");
    const modalBackdrop = document.getElementById("modalBackdrop");
    const modalClose = document.getElementById("modalClose");
    const modalProductImage = document.getElementById("modalProductImage");
    const modalCategory = document.getElementById("modalCategory");
    const modalProductName = document.getElementById("modalProductName");
    const modalProductPrice = document.getElementById("modalProductPrice");
    const modalProductLocation = document.getElementById("modalProductLocation");
    const modalViewProductBtn = document.getElementById("modalViewProductBtn");

    let currentSelectedCategory = "All";

    /* =========================================================
       HELPERS
    ======================================================== */
    function formatPrice(price) {
        return new Intl.NumberFormat("en-GM", {
            maximumFractionDigits: 0
        }).format(price);
    }

    function icon(name) {
        return `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
    }

    function showSkeletons(count = 6) {
        if (!productGrid) return;
        productGrid.innerHTML = "";
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const skeleton = document.createElement("article");
            skeleton.className = "skeleton-card";
            skeleton.innerHTML = `
                <div class="skeleton skeleton-image"></div>
                <div class="skeleton-info">
                    <div class="skeleton skeleton-line long"></div>
                    <div class="skeleton skeleton-line medium"></div>
                    <div class="skeleton skeleton-line price"></div>
                    <div class="skeleton skeleton-line location"></div>
                </div>
            `;
            fragment.appendChild(skeleton);
        }
        productGrid.appendChild(fragment);
    }

    function handleImageLoading(image) {
        if (image.complete) {
            requestAnimationFrame(() => image.classList.add("loaded"));
            return;
        }
        image.addEventListener("load", () => image.classList.add("loaded"), { once: true });
        image.addEventListener("error", () => image.classList.add("loaded"), { once: true });
    }

    function createProductCard(product, index) {
        const card = document.createElement("article");
        card.className = "product-card";
        card.dataset.category = product.category || "";
        card.style.animationDelay = `${Math.min(index * 35, 210)}ms`;

        const isSaved = window.GamBasketAuth ? window.GamBasketAuth.isInWishlist(product.id) : savedWishlist.includes(product.id);
        const imageWrap = document.createElement("div");
        imageWrap.className = "product-image";
        const img = document.createElement("img");
        img.src = typeof product.image === "string" ? product.image : "";
        img.alt = product.name || "Marketplace product";
        img.loading = "lazy";
        imageWrap.append(img);

        const heartBtn = document.createElement("button");
        heartBtn.type = "button";
        heartBtn.className = `product-heart ${isSaved ? "saved" : ""}`;
        heartBtn.dataset.productId = String(product.id || "");
        heartBtn.setAttribute("aria-label", `Save ${product.name || "product"}`);
        heartBtn.innerHTML = icon("heart");
        imageWrap.append(heartBtn);

        const info = document.createElement("div");
        info.className = "product-info";
        const name = document.createElement("h3");
        name.className = "product-name";
        name.textContent = product.name || "Marketplace product";
        const price = document.createElement("p");
        price.className = "product-price";
        price.textContent = `D ${formatPrice(Number(product.price || 0))}`;
        const location = document.createElement("p");
        location.className = "product-location";
        location.textContent = product.location || "The Gambia";
        info.append(name, price, location);

        const compare = document.createElement("button");
        compare.type = "button";
        compare.className = "product-compare-button";
        compare.dataset.compareProductId = String(product.id || "");
        compare.textContent = "Compare";
        compare.disabled = !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(product.id || ""));
        card.append(imageWrap, info, compare);
        handleImageLoading(img);

        card.addEventListener("click", e => {
            if (e.target.closest(".product-heart, [data-compare-product-id]")) return;
            openProductModal(product);
        });
        heartBtn.addEventListener("click", e => {
            e.stopPropagation();
            toggleWishlist(product.id, heartBtn);
        });
        return card;
    }

    function renderNextProducts() {
        if (!productGrid) return;

        const nextBatch = filteredProducts.slice(currentIndex, currentIndex + PAGE_SIZE);
        if (!nextBatch.length) {
            if (loadingIndicator) loadingIndicator.style.display = "none";
            return;
        }

        const fragment = document.createDocumentFragment();
        nextBatch.forEach((p, idx) => {
            fragment.appendChild(createProductCard(p, idx));
        });

        productGrid.appendChild(fragment);
        currentIndex += nextBatch.length;

        if (loadingIndicator) {
            loadingIndicator.style.display = currentIndex < filteredProducts.length ? "flex" : "none";
        }
    }

    function resetGrid(showSkeleton = true) {
        currentIndex = 0;
        if (showSkeleton) {
            showSkeletons(6);
            if (loadingIndicator) loadingIndicator.style.display = "none";
            setTimeout(() => {
                if (productGrid) productGrid.innerHTML = "";
                renderNextProducts();
            }, 300);
        } else {
            if (productGrid) productGrid.innerHTML = "";
            renderNextProducts();
        }

        if (exploreResultCount) {
            exploreResultCount.textContent = `${filteredProducts.length} PRODUCTS FOUND`;
        }
        const workspaceCount = document.getElementById("workspaceResultCount");
        if (workspaceCount) {
            const hasSearch = Boolean(exploreSearch && exploreSearch.value.trim());
            workspaceCount.textContent = hasSearch ? `${filteredProducts.length} PRODUCTS FOUND` : "";
            workspaceCount.hidden = !hasSearch;
        }
        const emptyState = document.getElementById("exploreEmptyState");
        if (emptyState) {
            emptyState.hidden = filteredProducts.length !== 0;
        }
    }

    /* =========================================================
       FILTERING & SEARCH PIPELINE
    ========================================================= */
    function applyFilters() {
        const query = exploreSearch ? exploreSearch.value.trim().toLowerCase() : "";
        const location = externalFilters?.location || (locationFilter ? locationFilter.value : "all");
        const condition = conditionFilter ? conditionFilter.value : "all";
        const conditions = externalFilters?.conditions || [];
        const sort = externalFilters?.sort || (sortFilter ? sortFilter.value : "newest");

        let results = allProducts.filter(p => {
            // Category filter
            const category = externalFilters?.category || currentSelectedCategory;
            if (category !== "All" && p.category !== category) {
                return false;
            }

            // Location filter
            if (location !== "all" && p.location !== location) {
                return false;
            }

            // Condition filter
            if (condition !== "all" && p.condition !== condition) {
                return false;
            }

            if (conditions.length && !conditions.includes(p.condition)) {
                return false;
            }

            if (externalFilters?.minPrice && Number(p.price) < Number(externalFilters.minPrice)) {
                return false;
            }

            if (externalFilters?.maxPrice && Number(p.price) > Number(externalFilters.maxPrice)) {
                return false;
            }

            if (externalFilters?.inStock && p.stock !== undefined && Number(p.stock) <= 0) {
                return false;
            }

            if (externalFilters?.delivery && p.delivery_available === false) {
                return false;
            }

            if (externalFilters?.seller !== "all" && p.seller_type && p.seller_type !== externalFilters.seller) {
                return false;
            }

            if (externalFilters?.discovery === "new" && p.created_at) {
                const age = Date.now() - new Date(p.created_at).getTime();
                if (age > 30 * 24 * 60 * 60 * 1000) return false;
            }

            if (externalFilters?.discovery === "popular" && Number(p.sales_count || 0) <= 0) {
                return false;
            }

            if (externalFilters?.discovery === "deals" && !p.discount_price && !p.sale_price) {
                return false;
            }

            if (externalFilters?.brandModel) {
                const needle = String(externalFilters.brandModel).trim().toLowerCase();
                if (needle && ![p.name, JSON.stringify(p.attributes || {})].filter(Boolean).join(" ").toLowerCase().includes(needle)) return false;
            }

            // Search query
            if (query) {
                const text = [p.name,p.category,p.location,JSON.stringify(p.attributes || {})].filter(Boolean).join(" ").toLowerCase();
                if (!text.includes(query)) return false;
            }

            return true;
        });

        // Sorting
        if (sort === "price_asc") {
            results.sort((a, b) => a.price - b.price);
        } else if (sort === "price_desc") {
            results.sort((a, b) => b.price - a.price);
        } else if (sort === "popular") {
            results.sort((a, b) => Number(b.sales_count || 0) - Number(a.sales_count || 0));
        }

        filteredProducts = results;
        resetGrid(false);
    }

    window.addEventListener("gambasket:explore:filters", event => {
        externalFilters = event.detail || null;
        if (externalFilters?.category) currentSelectedCategory = externalFilters.category;
        if (exploreSearch && externalFilters?.query !== undefined) exploreSearch.value = externalFilters.query;
        applyFilters();
    });

    /* =========================================================
       WISHLIST ACTION
    ========================================================= */
    async function toggleWishlist(productId, heartButton) {
        if (window.GamBasketAuth) {
            if (!window.GamBasketAuth.isPersistableProductId(productId)) {
                if (window.GamBasketNotifications) {
                    window.GamBasketNotifications.add({
                        type: "system",
                        title: "Product not available yet",
                        message: "This example product is not connected to the marketplace database yet.",
                        showToast: true
                    });
                }
                return;
            }
            await window.GamBasketAuth.toggleWishlist(productId);
            if (heartButton) {
                heartButton.classList.toggle("saved", window.GamBasketAuth.isInWishlist(productId));
            }
        } else {
            const index = savedWishlist.indexOf(productId);
            if (index === -1) {
                savedWishlist.push(productId);
                if (heartButton) heartButton.classList.add("saved");
            } else {
                savedWishlist.splice(index, 1);
                if (heartButton) heartButton.classList.remove("saved");
            }
            localStorage.setItem("gambasket-wishlist", JSON.stringify(savedWishlist));
        }
    }

    // Keep all heart buttons on page synced
    window.addEventListener("gambasket:wishlist:change", () => {
        document.querySelectorAll(".product-heart[data-product-id]").forEach(btn => {
            const pid = btn.getAttribute("data-product-id");
            if (pid && window.GamBasketAuth) {
                btn.classList.toggle("saved", window.GamBasketAuth.isInWishlist(pid));
            }
        });
    });

    /* =========================================================
       PRODUCT QUICK VIEW MODAL
    ========================================================= */
    function openProductModal(product) {
        if (!productModal) return;

        modalProductImage.innerHTML = `<img src="${product.image}" alt="${product.name}">`;
        modalCategory.textContent = product.category;
        modalProductName.textContent = product.name;
        modalProductPrice.textContent = `D ${formatPrice(product.price)}`;
        modalProductLocation.textContent = `${product.location} • ${product.condition || "New"}`;

        if (modalViewProductBtn) {
            modalViewProductBtn.onclick = () => {
                window.location.href = `product.html?id=${product.id}`;
            };
        }

        productModal.classList.add("open");
        productModal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
    }

    function closeProductModal() {
        if (!productModal) return;
        productModal.classList.remove("open");
        productModal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    }

    /* =========================================================
       LOAD FROM SUPABASE
    ========================================================= */
    async function fetchProductsFromDatabase() {
        if (window.GamBasketAuth && typeof window.GamBasketAuth.getProducts === "function") {
            const databaseProducts = await window.GamBasketAuth.getProducts();
            if (databaseProducts.length > 0) {
                allProducts = databaseProducts;
                filteredProducts = [...allProducts];
            }
        }
        applyFilters();
    }

    /* =========================================================
       EVENT LISTENERS
    ========================================================= */
    function setupEventListeners() {
        // Search Input (Debounced)
        if (exploreSearch) {
            exploreSearch.addEventListener("input", () => {
                const val = exploreSearch.value;
                if (clearExploreSearch) clearExploreSearch.style.display = val ? "flex" : "none";
                if (exploreSearchLoader) exploreSearchLoader.classList.add("active");

                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    applyFilters();
                    if (exploreSearchLoader) exploreSearchLoader.classList.remove("active");
                }, 350);
            });
        }

        if (clearExploreSearch) {
            clearExploreSearch.addEventListener("click", () => {
                exploreSearch.value = "";
                clearExploreSearch.style.display = "none";
                applyFilters();
                exploreSearch.focus();
            });
        }

        // Category filter buttons
        document.querySelectorAll(".category-card").forEach(button => {
            button.addEventListener("click", () => {
                document.querySelectorAll(".category-card").forEach(b => b.classList.remove("active-category"));
                button.classList.add("active-category");
                currentSelectedCategory = button.dataset.category || "All";
                if (exploreHeading) exploreHeading.textContent = currentSelectedCategory === "All" ? "All Products" : currentSelectedCategory;
                applyFilters();
            });
        });

        // Filter Dropdowns
        if (sortFilter) sortFilter.addEventListener("change", applyFilters);
        if (locationFilter) locationFilter.addEventListener("change", applyFilters);
        if (conditionFilter) conditionFilter.addEventListener("change", applyFilters);

        // Modal close
        if (modalClose) modalClose.addEventListener("click", closeProductModal);
        if (modalBackdrop) modalBackdrop.addEventListener("click", closeProductModal);
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && productModal && productModal.classList.contains("open")) {
                closeProductModal();
            }
        });

        // Infinite Scroll
        window.addEventListener("scroll", () => {
            if (isLoading) return;
            const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700;
            if (!nearBottom) return;

            if (currentIndex < filteredProducts.length) {
                isLoading = true;
                if (loadingIndicator) loadingIndicator.style.display = "flex";
                setTimeout(() => {
                    renderNextProducts();
                    isLoading = false;
                }, 400);
            }
        });

        // Bottom Navigation
        document.querySelectorAll(".nav-item").forEach(item => {
            item.addEventListener("click", () => {
                const page = item.dataset.page;
                if (page === "home") {
                    window.location.href = "index.html";
                } else if (page === "explore") {
                    window.location.href = "explore.html";
                } else if (page === "orders") {
                    window.location.href = "orders.html";
                } else if (page === "wishlist") {
                    window.location.href = "wishlist.html";
                } else if (page === "me") {
                    window.location.href = "me.html";
                }
            });
        });

        // Dark mode toggle
        if (themeToggle) {
            themeToggle.addEventListener("click", () => {
                const isDark = document.documentElement.classList.toggle("dark");
                localStorage.setItem("gambasket-theme", isDark ? "dark" : "light");
                if (themeIcon) {
                    themeIcon.innerHTML = isDark ? `<use href="#icon-sun"></use>` : `<use href="#icon-moon"></use>`;
                }
            });
        }

        // Read URL query param ?q= or ?category=
        const urlParams = new URLSearchParams(window.location.search);
        const qParam = urlParams.get("q");
        const catParam = urlParams.get("category");

        if (qParam && exploreSearch) {
            exploreSearch.value = qParam;
            if (clearExploreSearch) clearExploreSearch.style.display = "flex";
        }
        if (catParam) {
            currentSelectedCategory = catParam;
            document.querySelectorAll(".category-card").forEach(b => {
                b.classList.toggle("active-category", b.dataset.category === catParam);
            });
            if (exploreHeading) exploreHeading.textContent = catParam;
        }
    }

    // Initialize
    document.addEventListener("DOMContentLoaded", () => {
        setupEventListeners();
        showSkeletons(6);
        fetchProductsFromDatabase();
    });
})();
