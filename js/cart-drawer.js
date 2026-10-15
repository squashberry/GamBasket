/* ============================================================
   GAMBASKET — HOMEPAGE CART DRAWER
   iOS-STYLE EXPAND / COLLAPSE ANIMATION & UNIFIED DATA SYNC
============================================================ */

(() => {

    "use strict";

    let activeTrigger = null;
    let currentCartItems = [];
    let isFetching = false;

    const overlay = document.getElementById("gbCartOverlay");
    const drawer = document.getElementById("gbCartDrawer");
    const closeBtn = document.getElementById("gbCartClose");
    const content = document.getElementById("gbCartContent");
    const subtotalEl = document.getElementById("gbCartSubtotal");
    const continueBtn = document.getElementById("gbCartContinue");
    const checkoutBtn = document.getElementById("gbCartCheckout");

    if (!drawer) {
        return;
    }

    /* ========================================================
       HELPERS & NORMALIZATION
    ======================================================== */

    function productFor(item) {
        return item.product || item.products || item || {};
    }

    function getItemId(item) {
        const prod = productFor(item);
        return String(item.product_id || prod.id || item.id || "");
    }

    function getQuantity(item) {
        return Math.max(1, Number(item.quantity || 1));
    }

    function getImage(item) {
        const prod = productFor(item);
        return (
            prod.main_image ||
            prod.image ||
            item.main_image ||
            item.image ||
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80"
        );
    }

    function getName(item) {
        const prod = productFor(item);
        return (
            prod.title ||
            prod.name ||
            item.title ||
            item.name ||
            "Product"
        );
    }

    function getPrice(item) {
        const prod = productFor(item);
        return Number(prod.price ?? item.price ?? 0);
    }

    function money(value) {
        const number = Number(value || 0);
        return "D " + number.toLocaleString("en-GM");
    }

    function escapeHTML(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /* ========================================================
       STORAGE & DATA SYNC (SUPABASE + LOCALSTORAGE)
    ======================================================== */

    function getLocalCart() {
        try {
            const raw = localStorage.getItem("gambasket_cart");
            if (!raw) return [];
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    async function refreshCart() {
        if (isFetching) return currentCartItems;
        isFetching = true;

        try {
            if (window.GamBasketAuth && typeof window.GamBasketAuth.ready === "function") {
                await window.GamBasketAuth.ready();
                const session = await window.GamBasketAuth.getSession();
                if (session && session.user && typeof window.GamBasketAuth.getCart === "function") {
                    const res = await window.GamBasketAuth.getCart();
                    if (res && Array.isArray(res.items)) {
                        currentCartItems = res.items;
                        updateCount();
                        isFetching = false;
                        return currentCartItems;
                    }
                }
            }
        } catch (e) {
            console.warn("[GamBasket Cart Drawer Sync]", e.message);
        }

        // Fallback to local guest cart
        currentCartItems = getLocalCart();
        updateCount();
        isFetching = false;
        return currentCartItems;
    }

    /* ========================================================
       COUNT
    ======================================================== */

    function updateCount(animate = false) {
        const total = currentCartItems.reduce(
            (sum, item) => sum + getQuantity(item),
            0
        );

        document.querySelectorAll(".gb-cart-count, #gbCartCount, #floatingCartCount").forEach(el => {
            el.textContent = total > 99 ? "99+" : String(total);
            el.classList.toggle("show", total > 0);

            if (animate) {
                el.classList.remove("bump");
                void el.offsetWidth;
                el.classList.add("bump");
            }
        });

        const floatingCart = document.getElementById("floatingCart");
        if (floatingCart) {
            floatingCart.classList.toggle("is-empty", total === 0);
        }

        return total;
    }

    /* ========================================================
       RENDER
    ======================================================== */

    function render() {
        if (!content) return;

        if (!currentCartItems.length) {
            content.innerHTML = `
                <div class="gb-cart-empty">
                    <div class="gb-cart-empty-icon">
                        <svg viewBox="0 0 24 24" fill="none">
                            <circle cx="9" cy="20" r="1.5" fill="currentColor"/>
                            <circle cx="18" cy="20" r="1.5" fill="currentColor"/>
                            <path d="M2.5 3.5h3l2.4 11.3a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6l1.4-7.3H7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <h3>Your cart is empty</h3>
                    <p>Add something you love and it will appear here.</p>
                </div>
            `;

            if (subtotalEl) {
                subtotalEl.textContent = "D 0";
            }

            updateCount();
            return;
        }

        let subtotal = 0;

        content.innerHTML = currentCartItems.map((item, index) => {
            const quantity = getQuantity(item);
            const price = getPrice(item);
            subtotal += price * quantity;
            const id = getItemId(item);

            return `
                <article class="gb-cart-item" data-cart-id="${escapeHTML(id)}">
                    <div class="gb-cart-item-image">
                        <img src="${escapeHTML(getImage(item))}" alt="${escapeHTML(getName(item))}" loading="lazy" onerror="this.style.opacity='.35'">
                    </div>
                    <div class="gb-cart-item-info">
                        <h3 class="gb-cart-item-name">${escapeHTML(getName(item))}</h3>
                        <div class="gb-cart-item-price">${money(price)}</div>
                        <div class="gb-cart-item-controls">
                            <button class="gb-cart-qty-btn" data-action="decrease" data-index="${index}" type="button" aria-label="Decrease quantity">−</button>
                            <span class="gb-cart-qty">${quantity}</span>
                            <button class="gb-cart-qty-btn" data-action="increase" data-index="${index}" type="button" aria-label="Increase quantity">+</button>
                        </div>
                    </div>
                    <button class="gb-cart-remove" data-action="remove" data-index="${index}" type="button" aria-label="Remove ${escapeHTML(getName(item))}">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M3 6h18M9 6V4h6v2M7 6l1 14h8l1-14M10 10v6M14 10v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </article>
            `;
        }).join("");

        if (subtotalEl) {
            subtotalEl.textContent = money(subtotal);
        }

        updateCount();
    }

    /* ========================================================
       ORIGIN CALCULATION
    ======================================================== */

    function setOrigin(targetTrigger) {
        const elem =
            targetTrigger ||
            activeTrigger ||
            document.querySelector(".gb-cart-trigger") ||
            document.getElementById("gbCartTrigger");

        if (!elem) {
            drawer.style.setProperty("--gb-cart-origin-x", "-50%");
            drawer.style.setProperty("--gb-cart-origin-y", "90%");
            drawer.style.setProperty("--gb-cart-origin-scale", "0.12");
            return;
        }

        const rect = elem.getBoundingClientRect();
        const triggerX = rect.left + rect.width / 2;
        const triggerY = rect.top + rect.height / 2;

        const drawerWidth = Math.min(620, window.innerWidth - 28);
        const centerX = window.innerWidth / 2;

        const x = triggerX - centerX;
        const y = triggerY - window.innerHeight;
        const scale = Math.min(0.15, rect.width / drawerWidth);

        drawer.style.setProperty("--gb-cart-origin-x", `${x}px`);
        drawer.style.setProperty("--gb-cart-origin-y", `${y}px`);
        drawer.style.setProperty("--gb-cart-origin-scale", scale);
    }

    /* ========================================================
       OPEN
    ======================================================== */

    async function open(fromTrigger) {
        if (fromTrigger) {
            activeTrigger = fromTrigger;
        }

        setOrigin(activeTrigger);

        // Fetch fresh cart data before opening animation
        await refreshCart();
        render();

        overlay?.classList.add("active");
        drawer.classList.remove("closing");
        drawer.classList.add("opening");
        drawer.setAttribute("aria-hidden", "false");

        if (activeTrigger) {
            activeTrigger.setAttribute("aria-expanded", "true");
        }

        document.body.style.overflow = "hidden";

        setTimeout(() => {
            closeBtn?.focus();
        }, 180);
    }

    /* ========================================================
       CLOSE
    ======================================================== */

    function close() {
        setOrigin(activeTrigger);

        drawer.classList.remove("opening");
        drawer.classList.add("closing");
        overlay?.classList.remove("active");
        drawer.setAttribute("aria-hidden", "true");

        if (activeTrigger) {
            activeTrigger.setAttribute("aria-expanded", "false");
        }

        setTimeout(() => {
            drawer.classList.remove("closing");
            document.body.style.overflow = "";
            activeTrigger?.focus();
        }, 480);
    }

    /* ========================================================
       ITEM ACTIONS (INCREASE, DECREASE, REMOVE)
    ======================================================== */

    async function modifyItem(index, action) {
        const item = currentCartItems[index];
        if (!item) return;

        const productId = getItemId(item);
        const currQty = getQuantity(item);

        let session = null;
        try {
            if (window.GamBasketAuth) {
                session = await window.GamBasketAuth.getSession();
            }
        } catch {}

        if (session && session.user && window.GamBasketAuth) {
            try {
                if (action === "increase") {
                    await window.GamBasketAuth.updateCartItem(productId, currQty + 1);
                } else if (action === "decrease") {
                    if (currQty <= 1) {
                        await window.GamBasketAuth.removeCartItem(productId);
                    } else {
                        await window.GamBasketAuth.updateCartItem(productId, currQty - 1);
                    }
                } else if (action === "remove") {
                    await window.GamBasketAuth.removeCartItem(productId);
                }
                await refreshCart();
                render();
                updateCount(true);
                return;
            } catch (e) {
                console.warn("[GamBasket DB Cart update fallback]", e.message);
            }
        }

        // Guest user local cart
        let cart = getLocalCart();
        if (action === "increase") {
            if (cart[index]) cart[index].quantity = currQty + 1;
        } else if (action === "decrease") {
            if (currQty <= 1) {
                cart.splice(index, 1);
            } else {
                if (cart[index]) cart[index].quantity = currQty - 1;
            }
        } else if (action === "remove") {
            cart.splice(index, 1);
        }

        localStorage.setItem("gambasket_cart", JSON.stringify(cart));
        currentCartItems = cart;
        render();
        updateCount(true);
        window.dispatchEvent(new CustomEvent("gambasket:cart:change", { detail: cart }));
    }

    content?.addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;

        const index = Number(button.dataset.index);
        const action = button.dataset.action;
        modifyItem(index, action);
    });

    /* ========================================================
       EVENTS & DELEGATED TRIGGERS
    ======================================================== */

    document.addEventListener("click", event => {
        const trig = event.target.closest(".gb-cart-trigger, #gbCartTrigger, #floatingCart");
        if (trig) {
            event.preventDefault();
            event.stopPropagation();
            open(trig);
        }
    });

    closeBtn?.addEventListener("click", close);
    overlay?.addEventListener("click", close);
    continueBtn?.addEventListener("click", close);

    checkoutBtn?.addEventListener("click", () => {
        if (!currentCartItems.length) return;
        close();
        setTimeout(() => {
            window.location.href = "checkout.html";
        }, 230);
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && drawer.classList.contains("opening")) {
            close();
        }
    });

    window.addEventListener("gambasket:cart:change", async () => {
        await refreshCart();
        render();
        updateCount(true);
    });

    window.addEventListener("gambasket:auth:change", async () => {
        await refreshCart();
        render();
        updateCount();
    });

    window.addEventListener("storage", async event => {
        if (event.key === "gambasket_cart") {
            await refreshCart();
            render();
            updateCount();
        }
    });

    /* ========================================================
       PUBLIC API
    ======================================================== */

    window.GamBasketCartDrawer = {
        open,
        close,
        render,
        updateCount,
        refreshCart
    };

    /* ========================================================
       INITIALIZE
    ======================================================== */

    refreshCart().then(() => {
        render();
        updateCount();
    });

})();
