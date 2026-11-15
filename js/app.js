/* =========================================================
   GAMBasket
   Animated Homepage JavaScript
========================================================= */


/* =========================================================
   OFFLINE RECOVERY
========================================================= */

(function setupOfflineHandling() {
    if (window.__gambasketOfflineHandlingReady) return;
    window.__gambasketOfflineHandlingReady = true;

    // Dynamically load network.js if not already present
    if (!window.GamBasketNetwork) {
        const script = document.createElement("script");
        const path = window.location.pathname;
        let prefix = "js/";
        if (path.includes("/supplier/") || path.includes("/delivery/") ||
            path.includes("/worker/") || path.includes("/admin/")) {
            prefix = "../js/";
        }
        script.src = prefix + "network.js";
        script.async = false;
        document.head.appendChild(script);
    }

    window.gambasketGoOffline = () => {
        if (window.GamBasketNetwork) {
            window.GamBasketNetwork.handleRequestFailure(new Error("App manual trigger"));
        }
    };
})();


/* =========================================================
   SAMPLE PRODUCTS
========================================================= */

const products = [
    // Phones & Tablets
    {
        id: 1,
        name: "iPhone 13 128GB",
        price: 45000,
        category: "Phones",
        location: "Serrekunda",
        image: "https://images.unsplash.com/photo-1603899122634-f086ca5f5ddd?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 2,
        name: "Samsung Galaxy S24 Ultra",
        price: 52000,
        category: "Phones",
        location: "Kotu",
        image: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 3,
        name: "Google Pixel 9 Pro",
        price: 48000,
        category: "Phones",
        location: "Fajara",
        image: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 4,
        name: "iPhone 15 Pro Max",
        price: 72000,
        category: "Phones",
        location: "Kololi",
        image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=800&q=80"
    },

    // Fashion & Apparel
    {
        id: 5,
        name: "Classic White Sneakers",
        price: 2500,
        category: "Fashion",
        location: "Brikama",
        image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 6,
        name: "Premium Automatic Wrist Watch",
        price: 3200,
        category: "Fashion",
        location: "Serrekunda",
        image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 7,
        name: "Nike Air Max Runners",
        price: 5500,
        category: "Fashion",
        location: "Kololi",
        image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 8,
        name: "Handcrafted Leather Handbag",
        price: 4200,
        category: "Fashion",
        location: "Kotu",
        image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80"
    },

    // Groceries & Foodstuffs
    {
        id: 9,
        name: "50kg Premium American Long Grain Rice",
        price: 2250,
        category: "Food",
        location: "Serrekunda",
        image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 10,
        name: "Pure Groundnut Cooking Oil (20L Jerrycan)",
        price: 1850,
        category: "Food",
        location: "Brikama",
        image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 11,
        name: "Gambian Attaya Green Tea Box & Teapot Set",
        price: 450,
        category: "Food",
        location: "Banjul",
        image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80"
    },

    // Electronics & Laptops
    {
        id: 12,
        name: "MacBook Air M2 256GB",
        price: 58000,
        category: "Electronics",
        location: "Kololi",
        image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 13,
        name: "Wireless ANC Headphones",
        price: 3800,
        category: "Electronics",
        location: "Kanifing",
        image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 14,
        name: "55-inch 4K Smart Android TV",
        price: 24000,
        category: "Electronics",
        location: "Serrekunda",
        image: "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 15,
        name: "High Bass Portable Bluetooth Speaker",
        price: 2800,
        category: "Electronics",
        location: "Bakau",
        image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&q=80"
    },

    // Solar & Energy
    {
        id: 16,
        name: "3.5kVA Pure Sine Wave Solar Inverter",
        price: 28500,
        category: "Solar",
        location: "Kanifing",
        image: "https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 17,
        name: "450W Monocrystalline Solar Panel",
        price: 5800,
        category: "Solar",
        location: "Serrekunda",
        image: "https://images.unsplash.com/photo-1508873696983-2df5293cb32f?auto=format&fit=crop&w=800&q=80"
    },

    // Beauty & Cosmetics
    {
        id: 18,
        name: "Organic African Shea Butter & Coconut Oil",
        price: 400,
        category: "Beauty",
        location: "Serrekunda",
        image: "https://images.unsplash.com/photo-1608248597359-2e697b0a7ea6?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 19,
        name: "Luxury Arabic Arabian Oud Perfume 100ml",
        price: 1800,
        category: "Beauty",
        location: "Kololi",
        image: "https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=800&q=80"
    },

    // Home & Living
    {
        id: 20,
        name: "Modern Ergonomic Living Room Accent Chair",
        price: 8500,
        category: "Home",
        location: "Bakau",
        image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 21,
        name: "Minimalist Scandinavian Table Lamp",
        price: 1800,
        category: "Home",
        location: "Bakau",
        image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 22,
        name: "Executive 3-Piece Luxury Living Sofa Set",
        price: 32000,
        category: "Home",
        location: "Brufut",
        image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
    },
    {
        id: 23,
        name: "Solid Wood Bedside Nightstand Table",
        price: 4500,
        category: "Home",
        location: "Brikama",
        image: "https://images.unsplash.com/photo-1532372320572-cda25653a26d?auto=format&fit=crop&w=800&q=80"
    },

    // Auto Parts & Accessories
    {
        id: 24,
        name: "Heavy-Duty 12V 75Ah Maintenance-Free Car Battery",
        price: 4600,
        category: "Auto",
        location: "Kanifing",
        image: "https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=800&q=80"
    },

    // Building & Hardware
    {
        id: 25,
        name: "Professional Cordless Brushless Power Drill Set",
        price: 3800,
        category: "Hardware",
        location: "Kanifing",
        image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=800&q=80"
    },

    // Baby & Kids
    {
        id: 26,
        name: "Compact Lightweight Foldable Baby Stroller",
        price: 4200,
        category: "Baby",
        location: "Kololi",
        image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80"
    },

    // Sports & Fitness
    {
        id: 27,
        name: "Official Gambia Scorpions National Team Jersey",
        price: 1200,
        category: "Sports",
        location: "Banjul",
        image: "https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=800&q=80"
    }
];


/* =========================================================
   STATE
========================================================= */

let currentProducts = [...products];

let displayedProducts = [...products];

let currentProductIndex = 0;

const PRODUCTS_PER_LOAD = 8;

let loadingMore = false;

let searchTimer = null;

let savedProducts = JSON.parse(
    localStorage.getItem("gambasket-wishlist") || "[]"
);

let selectedHomepageCategory = "All";


/* =========================================================
   DOM
========================================================= */

const productGrid =
    document.getElementById("productGrid");

const loadingIndicator =
    document.getElementById("loadingIndicator");

const mobileSearch =
    document.getElementById("mobileSearch");

const clearMobileSearch =
    document.getElementById("clearMobileSearch");

const mobileSearchLoader =
    document.getElementById("mobileSearchLoader");

const desktopSearch =
    document.getElementById("desktopSearch");

const desktopSearchButton =
    document.getElementById("desktopSearchButton");

const desktopExploreButton =
    document.getElementById("desktopExploreButton");

const themeToggle =
    document.getElementById("themeToggle");

const themeIcon =
    document.getElementById("themeIcon");

const productModal =
    document.getElementById("productModal");

const modalBackdrop =
    document.getElementById("modalBackdrop");

const modalClose =
    document.getElementById("modalClose");

const modalProductImage =
    document.getElementById("modalProductImage");

const modalCategory =
    document.getElementById("modalCategory");

const modalProductName =
    document.getElementById("modalProductName");

const modalProductPrice =
    document.getElementById("modalProductPrice");

const modalProductLocation =
    document.getElementById("modalProductLocation");

const pageTransition =
    document.getElementById("pageTransition");


/* =========================================================
   SVG HELPER
========================================================= */

function icon(name, className = "ui-icon") {

    return `
        <svg class="${className}" aria-hidden="true">
            <use href="#icon-${name}"></use>
        </svg>
    `;

}


/* =========================================================
   PRICE FORMAT
========================================================= */

function formatPrice(price) {

    return new Intl.NumberFormat("en-GM", {
        maximumFractionDigits: 0
    }).format(price);

}


/* =========================================================
   SKELETON LOADING
========================================================= */

function showSkeletons(count = 6) {

    productGrid.innerHTML = "";

    const fragment =
        document.createDocumentFragment();

    for (let i = 0; i < count; i++) {

        const skeleton =
            document.createElement("article");

        skeleton.className =
            "skeleton-card";

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


/* =========================================================
   IMAGE LOADING
========================================================= */

function handleImageLoading(image) {

    if (image.complete) {

        requestAnimationFrame(() => {
            image.classList.add("loaded");
        });

        return;
    }

    image.addEventListener(
        "load",
        () => {
            image.classList.add("loaded");
        },
        {
            once: true
        }
    );

    image.addEventListener(
        "error",
        () => {
            image.classList.add("loaded");
        },
        {
            once: true
        }
    );

}


/* =========================================================
   PRODUCT CARD
========================================================= */

function createProductCard(product, index) {

    const card =
        document.createElement("article");

    card.className =
        "product-card";

    card.dataset.category = product.category || "";

    card.style.animationDelay =
        `${Math.min(index * 35, 210)}ms`;

    const isSaved = window.GamBasketAuth ? window.GamBasketAuth.isInWishlist(product.id) : savedProducts.includes(product.id);

    card.innerHTML = `
        <div class="product-image">

            <img
                src="${product.image}"
                alt="${product.name}"
                loading="lazy"
            >

            <button
                class="product-heart ${isSaved ? "saved" : ""}"
                data-product-id="${product.id}"
                type="button"
                aria-label="Save ${product.name}"
            >
                ${icon("heart")}
            </button>

        </div>

        <div class="product-info">

            <h3 class="product-name">
                ${product.name}
            </h3>

            <p class="product-price">
                D${formatPrice(product.price)}
            </p>

            <p class="product-location">
                ${product.location}
            </p>

        </div>
    `;

    const image =
        card.querySelector("img");

    handleImageLoading(image);

    card.addEventListener(
        "click",
        event => {

            if (
                event.target.closest(
                    ".product-heart"
                )
            ) {
                return;
            }

            openProductModal(product);

        }
    );

    const heart =
        card.querySelector(".product-heart");

    heart.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            toggleWishlist(
                product.id,
                heart
            );

        }
    );

    return card;
}


/* =========================================================
   RENDER PRODUCTS
========================================================= */

function renderNextProducts() {

    const nextProducts =
        displayedProducts.slice(
            currentProductIndex,
            currentProductIndex +
                PRODUCTS_PER_LOAD
        );

    if (!nextProducts.length) {

        loadingIndicator.style.display =
            "none";

        return;

    }

    const fragment =
        document.createDocumentFragment();

    nextProducts.forEach(
        (product, index) => {

            fragment.appendChild(
                createProductCard(
                    product,
                    index
                )
            );

        }
    );

    productGrid.appendChild(fragment);

    currentProductIndex +=
        nextProducts.length;

    loadingIndicator.style.display =
        currentProductIndex <
        displayedProducts.length
            ? "flex"
            : "none";
}


/* =========================================================
   RESET PRODUCT FEED
========================================================= */

function resetProducts(
    productList,
    showLoading = true
) {

    displayedProducts =
        productList;

    currentProductIndex = 0;

    if (showLoading) {

        showSkeletons(6);

        loadingIndicator.style.display =
            "none";

        setTimeout(() => {

            productGrid.innerHTML = "";

            renderNextProducts();

        }, 420);

    } else {

        productGrid.innerHTML = "";

        renderNextProducts();

    }

}

function renderHomeDiscoveryRows(source = currentProducts) {
    const rowDefinitions = [
        ["trendingProductGrid", source.slice(0, 4)],
        ["bestSellerProductGrid", [...source].sort((a, b) => Number(b.sales_count || 0) - Number(a.sales_count || 0) || Number(b.price || 0) - Number(a.price || 0)).slice(0, 4)],
        ["newArrivalProductGrid", [...source].reverse().slice(0, 4)]
    ];

    rowDefinitions.forEach(([id, items]) => {
        const row = document.getElementById(id);
        if (!row) return;
        row.innerHTML = "";
        items.forEach((product, index) => row.appendChild(createProductCard(product, index)));
    });
}


/* =========================================================
   CATEGORY FILTER
========================================================= */

function filterByCategory(category) {

    selectedHomepageCategory = category;

    document
        .querySelectorAll(".category-card")
        .forEach(button => {

            button.classList.toggle(
                "active-category",
                button.dataset.category ===
                    category
            );

        });

    let filtered;

    if (category === "All") {

        filtered = [...currentProducts];

    } else {

        filtered =
            currentProducts.filter(
                product =>
                    product.category ===
                    category
            );

    }

    resetProducts(filtered, false);
    renderHomeDiscoveryRows(filtered);

}


/* =========================================================
   CATEGORY EVENTS
========================================================= */

document
    .querySelectorAll(".category-card")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                filterByCategory(
                    button.dataset.category
                );

            }
        );

    });


/* =========================================================
   SEARCH
========================================================= */

function performSearch(query) {

    const cleanQuery =
        query.trim().toLowerCase();

    mobileSearchLoader.classList.add(
        "active"
    );

    clearTimeout(searchTimer);

    searchTimer = setTimeout(
        () => {

            let results;

            if (!cleanQuery) {

                results =
                    [...products];

            } else {

                results =
                    products.filter(
                        product => {

                            return (
                                product.name
                                    .toLowerCase()
                                    .includes(
                                        cleanQuery
                                    ) ||

                                product.category
                                    .toLowerCase()
                                    .includes(
                                        cleanQuery
                                    ) ||

                                product.location
                                    .toLowerCase()
                                    .includes(
                                        cleanQuery
                                    )
                            );

                        }
                    );

            }

            resetProducts(
                results,
                false
            );

            mobileSearchLoader.classList.remove(
                "active"
            );

        },
        380
    );

}


/* =========================================================
   MOBILE SEARCH
========================================================= */

mobileSearch.addEventListener(
    "input",
    () => {

        const value =
            mobileSearch.value;

        clearMobileSearch.style.display =
            value ? "flex" : "none";

        performSearch(value);

    }
);


clearMobileSearch.addEventListener(
    "click",
    () => {

        mobileSearch.value = "";

        clearMobileSearch.style.display =
            "none";

        performSearch("");

        mobileSearch.focus();

    }
);


/* =========================================================
   DESKTOP SEARCH
========================================================= */

function desktopSearchAction(queryStr) {
    const input = document.getElementById("desktopHeaderSearchInput") ||
                  document.getElementById("desktopHeroSearchInput") ||
                  document.getElementById("desktopSearch");
    const query = (queryStr || (input ? input.value : "")).trim();

    if (!query) {
        if (input) input.focus();
        return;
    }

    localStorage.setItem("gambasket-last-search", query);

    runPageTransition(() => {
        window.location.href = `explore.html?q=${encodeURIComponent(query)}`;
    });
}

const headerSearchInput = document.getElementById("desktopHeaderSearchInput");
if (headerSearchInput) {
    headerSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            desktopSearchAction(headerSearchInput.value);
        }
    });
}

const heroSearchForm = document.getElementById("desktopHeroSearchForm");
if (heroSearchForm) {
    heroSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const heroInput = document.getElementById("desktopHeroSearchInput");
        if (heroInput) desktopSearchAction(heroInput.value);
    });
}

if (desktopSearchButton) {
    desktopSearchButton.addEventListener("click", () => desktopSearchAction());
}

if (desktopSearch) {
    desktopSearch.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            desktopSearchAction();
        }
    });
}


/* =========================================================
   DESKTOP EXPLORE
========================================================= */

if (desktopExploreButton) {
    desktopExploreButton.addEventListener("click", () => {
        runPageTransition(() => {
            window.location.href = "explore.html";
        });
    });
}


/* =========================================================
   DESKTOP SUGGESTIONS
========================================================= */

document.querySelectorAll(".suggestion").forEach(button => {
    button.addEventListener("click", () => {
        const query = button.textContent.trim();
        desktopSearchAction(query);
    });
});


/* =========================================================
   WISHLIST
========================================================= */

async function toggleWishlist(
    productId,
    heartButton
) {
    const doToggle = async () => {
        if (window.GamBasketAuth && !window.GamBasketAuth.isPersistableProductId(productId)) {
            if (window.GamBasketNotifications) {
                window.GamBasketNotifications.add({
                    type: "system",
                    title: "Product not available yet",
                    message: "This example product is not connected to the marketplace database yet.",
                    showToast: true
                });
            }
            heartButton?.classList.remove("saved");
            return;
        }

        if (window.GamBasketAuth) {
            const result = await window.GamBasketAuth.toggleWishlist(productId);
            if (heartButton) {
                heartButton.classList.toggle("saved", window.GamBasketAuth.isInWishlist(productId));
                heartButton.innerHTML = icon("heart");
            }
            return result;
        }

        const index = savedProducts.indexOf(productId);

        if (index === -1) {
            savedProducts.push(productId);
            heartButton.classList.add("saved");
            heartButton.innerHTML = icon("heart");

            if (window.GamBasketNotifications) {
                window.GamBasketNotifications.add({
                    type: "wishlist",
                    title: "Added to Wishlist",
                    message: "Product saved to your wishlist.",
                    showToast: true
                });
            }
        } else {
            savedProducts.splice(index, 1);
            heartButton.classList.remove("saved");
            heartButton.innerHTML = icon("heart");

        }

        localStorage.setItem(
            "gambasket-wishlist",
            JSON.stringify(savedProducts)
        );
    };

    if (window.GamBasketGuard) {
        window.GamBasketGuard.requireAuth("save products to your wishlist", doToggle);
    } else {
        doToggle();
    }
}


/* =========================================================
   PRODUCT MODAL
========================================================= */

function openProductModal(product) {

    modalProductImage.innerHTML = `
        <img
            src="${product.image}"
            alt="${product.name}"
        >
    `;

    modalCategory.textContent =
        product.category;

    modalProductName.textContent =
        product.name;

    modalProductPrice.textContent =
        `D${formatPrice(product.price)}`;

    modalProductLocation.textContent =
        product.location;

    const modalPrimaryBtn = document.getElementById("modalViewProduct") || document.querySelector(".modal-primary-button");
    if (modalPrimaryBtn) {
        modalPrimaryBtn.onclick = () => {
            window.location.href = `product.html?id=${product.id}`;
        };
    }

    const modalCartBtn = document.getElementById("modalAddToCart");
    if (modalCartBtn) {
        modalCartBtn.onclick = () => {
            const cart = JSON.parse(localStorage.getItem("gambasket_cart") || "[]");
            const existing = cart.find(item => String(item.id) === String(product.id));
            if (existing) existing.quantity = Number(existing.quantity || 1) + 1;
            else cart.push({ id: product.id, name: product.name, price: product.price, image: product.image, quantity: 1 });
            localStorage.setItem("gambasket_cart", JSON.stringify(cart));
            window.dispatchEvent(new Event("gambasket:cart:change"));
            modalCartBtn.classList.add("added");
            setTimeout(() => modalCartBtn.classList.remove("added"), 700);
        };
    }

    productModal.classList.add(
        "open"
    );

    productModal.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.style.overflow =
        "hidden";

}


function closeProductModal() {

    productModal.classList.remove(
        "open"
    );

    productModal.setAttribute(
        "aria-hidden",
        "true"
    );

    document.body.style.overflow =
        "";

}


modalClose.addEventListener(
    "click",
    closeProductModal
);


modalBackdrop.addEventListener(
    "click",
    closeProductModal
);


document.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Escape" &&
            productModal.classList.contains(
                "open"
            )
        ) {

            closeProductModal();

        }

    }
);


/* =========================================================
   DARK MODE
========================================================= */

function updateThemeIcon() {

    const isDark =
        document.documentElement
            .classList
            .contains("dark");

    themeIcon.innerHTML =
        isDark
            ? `<use href="#icon-sun"></use>`
            : `<use href="#icon-moon"></use>`;

}


function toggleTheme() {

    const isDark =
        document.documentElement
            .classList
            .toggle("dark");

    localStorage.setItem(
        "gambasket-theme",
        isDark
            ? "dark"
            : "light"
    );

    updateThemeIcon();

}


// theme listener handled by supabase.js

const desktopThemeToggle = document.getElementById("desktopThemeToggle");
if (desktopThemeToggle) {
    // desktop theme listener handled by supabase.js
}

updateThemeIcon();

/* =========================================================
   DESKTOP AUTH STATE
========================================================= */

async function updateDesktopAuthState() {
    if (window.GamBasketAuth && typeof window.GamBasketAuth.updateGlobalHeaders === "function") {
        await window.GamBasketAuth.updateGlobalHeaders();
    }
}

document.addEventListener("DOMContentLoaded", updateDesktopAuthState);
window.addEventListener("gambasket:auth:change", updateDesktopAuthState);


/* =========================================================
   NAVIGATION
========================================================= */

const navItems =
    document.querySelectorAll(
        ".nav-item"
    );


function createNavRipple(
    element
) {

    const ripple =
        document.createElement(
            "span"
        );

    ripple.className =
        "nav-ripple";

    const rect =
        element.getBoundingClientRect();

    ripple.style.left =
        `${rect.width / 2}px`;

    ripple.style.top =
        `${rect.height / 2}px`;

    element.appendChild(
        ripple
    );

    setTimeout(
        () => ripple.remove(),
        550
    );

}


function switchTab(
    selectedItem
) {

    const currentItem =
        document.querySelector(
            ".nav-item.active"
        );

    if (
        currentItem === selectedItem
    ) {
        return;
    }

    createNavRipple(
        selectedItem
    );

    const page =
        selectedItem.dataset.page;

    if (page === "home") {
        navItems.forEach(item => item.classList.remove("active"));
        selectedItem.classList.add("active");
        animateCurrentPage();
    } else if (page === "explore") {
        window.location.href = "explore.html";
    } else if (page === "orders") {
        window.location.href = "orders.html";
    } else if (page === "wishlist") {
        window.location.href = "wishlist.html";
    } else if (page === "me") {
        window.location.href = "me.html";
    }

}


navItems.forEach(
    item => {

        item.addEventListener(
            "click",
            () => {

                switchTab(item);

            }
        );

    }
);


/* =========================================================
   PAGE SWITCH ANIMATION
========================================================= */

function animateCurrentPage() {

    const content =
        document.querySelector(
            ".mobile-app"
        );

    content.animate(
        [
            {
                opacity: 0.55,
                transform:
                    "translateY(6px)"
            },
            {
                opacity: 1,
                transform:
                    "translateY(0)"
            }
        ],
        {
            duration: 280,
            easing:
                "cubic-bezier(.2,.8,.2,1)"
        }
    );

}


/* =========================================================
   PAGE TRANSITION
========================================================= */

function runPageTransition(
    callback
) {

    pageTransition.classList.add(
        "active"
    );

    setTimeout(
        () => {

            if (callback) {
                callback();
            }

            setTimeout(
                () => {

                    pageTransition.classList.remove(
                        "active"
                    );

                },
                350
            );

        },
        300
    );

}


/* =========================================================
   INFINITE SCROLL
========================================================= */

window.addEventListener(
    "scroll",
    () => {

        if (loadingMore) {
            return;
        }

        const nearBottom =
            window.innerHeight +
            window.scrollY >=
            document.documentElement
                .scrollHeight - 700;

        if (!nearBottom) {
            return;
        }

        loadingMore = true;

        loadingIndicator.style.display =
            "flex";

        /*
           In the real application this
           will be replaced with Supabase
           pagination.

           For now we repeat the prototype
           products so the page behaves
           like an endless feed.
        */

        setTimeout(
            () => {

                if (
                    currentProductIndex >=
                    displayedProducts.length
                ) {

                    displayedProducts = [
                        ...displayedProducts,

                        ...displayedProducts.map(
                            (
                                product
                            ) => ({

                                ...product

                            })
                        )
                    ];

                }

                renderNextProducts();

                loadingMore = false;

            },
            500
        );

    }
);


/* =========================================================
   FILTER BUTTON
========================================================= */

const filterButton =
    document.getElementById(
        "filterButton"
    );

filterButton?.addEventListener(
    "click",
    () => {

        filterButton.animate(
            [
                {
                    transform:
                        "rotate(0deg) scale(1)"
                },

                {
                    transform:
                        "rotate(-12deg) scale(.9)"
                },

                {
                    transform:
                        "rotate(12deg) scale(1.08)"
                },

                {
                    transform:
                        "rotate(0deg) scale(1)"
                }
            ],
            {
                duration: 350,
                easing:
                    "cubic-bezier(.2,.8,.2,1)"
            }
        );

        let panel = document.getElementById("homeFilterPanel");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "homeFilterPanel";
            panel.className = "home-filter-panel";
            panel.innerHTML = `<label>Category<select id="homeFilterCategory"><option value="All">All categories</option>${[...new Set(currentProducts.map(product => product.category).filter(Boolean))].map(category => `<option value="${category}">${category}</option>`).join("")}</select></label><label>Sort<select id="homeFilterSort"><option value="recommended">Recommended</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="newest">Newest</option></select></label><label>Maximum price<input id="homeFilterPrice" type="number" min="0" placeholder="No limit"></label><button type="button" id="applyHomeFilter">Apply filters</button>`;
            filterButton.parentElement.appendChild(panel);
            panel.querySelector("#applyHomeFilter").addEventListener("click", () => {
                const category = panel.querySelector("#homeFilterCategory").value;
                const sort = panel.querySelector("#homeFilterSort").value;
                const maxPrice = Number(panel.querySelector("#homeFilterPrice").value || 0);
                let filtered = currentProducts.filter(product => (category === "All" || product.category === category) && (!maxPrice || Number(product.price) <= maxPrice));
                if (sort === "price-low") filtered.sort((a, b) => a.price - b.price);
                if (sort === "price-high") filtered.sort((a, b) => b.price - a.price);
                if (sort === "newest") filtered.reverse();
                resetProducts(filtered, false);
                panel.classList.remove("show");
            });
        }
        panel.classList.toggle("show");

    }
);


/* =========================================================
   INITIAL LOAD
========================================================= */

showSkeletons(6);

setTimeout(async () => {
    if (window.GamBasketAuth && typeof window.GamBasketAuth.getProducts === "function") {
        const databaseProducts = await window.GamBasketAuth.getProducts();
        if (databaseProducts.length) {
            currentProducts = databaseProducts;
        }
    }
    filterByCategory(selectedHomepageCategory);
}, 700);