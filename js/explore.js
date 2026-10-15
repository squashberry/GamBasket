/* =========================================================
   GAMBASKET — EXPLORE MARKETPLACE LOGIC
========================================================= */

(function () {
    "use strict";

    /* =========================================================
       PRODUCTS CATALOG
    ========================================================= */
    const defaultProducts = [
        // Phones & Tablets
        {
            id: "p-1",
            name: "iPhone 13 128GB",
            price: 45000,
            category: "Phones",
            location: "Serrekunda",
            condition: "Like New",
            image: "https://images.unsplash.com/photo-1603899122634-f086ca5f5ddd?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-2",
            name: "Samsung Galaxy S24 Ultra",
            price: 52000,
            category: "Phones",
            location: "Kotu",
            condition: "New",
            image: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-3",
            name: "Google Pixel 9 Pro",
            price: 48000,
            category: "Phones",
            location: "Fajara",
            condition: "New",
            image: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-4",
            name: "iPhone 15 Pro Max 256GB",
            price: 78000,
            category: "Phones",
            location: "Kololi",
            condition: "New",
            image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=800&q=80"
        },

        // Fashion & Apparel
        {
            id: "p-5",
            name: "Classic White Sneakers",
            price: 2500,
            category: "Fashion",
            location: "Brikama",
            condition: "New",
            image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-6",
            name: "Premium Automatic Wrist Watch",
            price: 3200,
            category: "Fashion",
            location: "Serrekunda",
            condition: "New",
            image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-7",
            name: "Nike Air Max Runners",
            price: 5500,
            category: "Fashion",
            location: "Kololi",
            condition: "New",
            image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-8",
            name: "Handcrafted Leather Handbag",
            price: 4200,
            category: "Fashion",
            location: "Kotu",
            condition: "New",
            image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80"
        },

        // Groceries & Food
        {
            id: "p-9",
            name: "50kg Premium American Long Grain Rice",
            price: 2250,
            category: "Food",
            location: "Serrekunda",
            condition: "New",
            image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-10",
            name: "Pure Groundnut Cooking Oil (20L Jerrycan)",
            price: 1850,
            category: "Food",
            location: "Brikama",
            condition: "New",
            image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-11",
            name: "Gambian Attaya Green Tea Box & Teapot Set",
            price: 450,
            category: "Food",
            location: "Banjul",
            condition: "New",
            image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80"
        },

        // Electronics & Laptops
        {
            id: "p-12",
            name: "MacBook Air M2 256GB",
            price: 58000,
            category: "Electronics",
            location: "Kololi",
            condition: "New",
            image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-13",
            name: "Wireless ANC Headphones",
            price: 3800,
            category: "Electronics",
            location: "Kanifing",
            condition: "New",
            image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-14",
            name: "55-inch 4K Smart Android TV",
            price: 24000,
            category: "Electronics",
            location: "Serrekunda",
            condition: "New",
            image: "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-15",
            name: "High Bass Portable Bluetooth Speaker",
            price: 2800,
            category: "Electronics",
            location: "Bakau",
            condition: "New",
            image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&q=80"
        },

        // Solar & Energy
        {
            id: "p-16",
            name: "3.5kVA Pure Sine Wave Solar Inverter",
            price: 28500,
            category: "Solar",
            location: "Kanifing",
            condition: "New",
            image: "https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-17",
            name: "450W Monocrystalline Solar Panel",
            price: 5800,
            category: "Solar",
            location: "Serrekunda",
            condition: "New",
            image: "https://images.unsplash.com/photo-1508873696983-2df5293cb32f?auto=format&fit=crop&w=800&q=80"
        },

        // Beauty & Cosmetics
        {
            id: "p-18",
            name: "Organic African Shea Butter & Coconut Oil",
            price: 400,
            category: "Beauty",
            location: "Serrekunda",
            condition: "New",
            image: "https://images.unsplash.com/photo-1608248597359-2e697b0a7ea6?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-19",
            name: "Luxury Arabic Arabian Oud Perfume 100ml",
            price: 1800,
            category: "Beauty",
            location: "Kololi",
            condition: "New",
            image: "https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=800&q=80"
        },

        // Home & Living
        {
            id: "p-20",
            name: "Modern Ergonomic Accent Chair",
            price: 8500,
            category: "Home",
            location: "Bakau",
            condition: "New",
            image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-21",
            name: "Minimalist Scandinavian Table Lamp",
            price: 1800,
            category: "Home",
            location: "Bakau",
            condition: "New",
            image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-22",
            name: "Executive 3-Piece Luxury Living Sofa Set",
            price: 32000,
            category: "Home",
            location: "Brufut",
            condition: "New",
            image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
        },
        {
            id: "p-23",
            name: "Solid Wood Bedside Nightstand Table",
            price: 4500,
            category: "Home",
            location: "Brikama",
            condition: "New",
            image: "https://images.unsplash.com/photo-1532372320572-cda25653a26d?auto=format&fit=crop&w=800&q=80"
        },

        // Auto Parts
        {
            id: "p-24",
            name: "Heavy-Duty 12V 75Ah Car Battery",
            price: 4600,
            category: "Auto",
            location: "Kanifing",
            condition: "New",
            image: "https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=800&q=80"
        },

        // Hardware & Building
        {
            id: "p-25",
            name: "Professional Cordless Brushless Power Drill Set",
            price: 3800,
            category: "Hardware",
            location: "Kanifing",
            condition: "New",
            image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=800&q=80"
        },

        // Baby & Kids
        {
            id: "p-26",
            name: "Compact Lightweight Foldable Baby Stroller",
            price: 4200,
            category: "Baby",
            location: "Kololi",
            condition: "New",
            image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80"
        },

        // Sports & Fitness
        {
            id: "p-27",
            name: "Official Gambia Scorpions National Team Jersey",
            price: 1200,
            category: "Sports",
            location: "Banjul",
            condition: "New",
            image: "https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=800&q=80"
        }
    ];

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

        card.innerHTML = `
            <div class="product-image">
                <img src="${product.image}" alt="${product.name}" loading="lazy">
                <button class="product-heart ${isSaved ? "saved" : ""}" data-product-id="${product.id}" type="button" aria-label="Save ${product.name}">
                    ${icon("heart")}
                </button>
            </div>
            <div class="product-info">
                <h3 class="product-name">${product.name}</h3>
                <p class="product-price">D ${formatPrice(product.price)}</p>
                <p class="product-location">${product.location}</p>
            </div>
        `;

        const img = card.querySelector("img");
        handleImageLoading(img);

        card.addEventListener("click", (e) => {
            if (e.target.closest(".product-heart")) return;
            openProductModal(product);
        });

        const heartBtn = card.querySelector(".product-heart");
        heartBtn.addEventListener("click", (e) => {
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

            // Search query
            if (query) {
                const matchName = p.name.toLowerCase().includes(query);
                const matchCategory = p.category.toLowerCase().includes(query);
                const matchLocation = p.location.toLowerCase().includes(query);
                if (!matchName && !matchCategory && !matchLocation) return false;
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
