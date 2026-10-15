(() => {
    "use strict";

    const state = { items: [], authenticated: false, loading: true };
    let continuePromptShown = false;
    const $ = id => document.getElementById(id);
    const money = value => `D ${Number(value || 0).toLocaleString("en-GM")}`;
    const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

    function localCart() {
        try { return JSON.parse(localStorage.getItem("gambasket_cart") || "[]"); } catch { return []; }
    }

    function normalizeLocalItems() {
        return localCart().map(item => ({
            product_id: item.id,
            quantity: Number(item.quantity || 1),
            product: { id: item.id, title: item.name, price: Number(item.price || 0), stock: Number(item.stock || 999), main_image: item.image || "", seller_name: item.seller || "GamBasket Seller", status: "approved" }
        }));
    }

    async function migrateGuestCart() {
        const guestItems = localCart();
        if (!guestItems.length || !window.GamBasketAuth?.addToCart) return;

        const remaining = [];
        for (const item of guestItems) {
            const productId = await window.GamBasketAuth.resolveProductId(item.id, item.name);
            if (!productId) {
                remaining.push(item);
                continue;
            }
            const result = await window.GamBasketAuth.addToCart(productId, Number(item.quantity || 1));
            if (!result.success) remaining.push(item);
        }
        if (remaining.length) localStorage.setItem("gambasket_cart", JSON.stringify(remaining));
        else localStorage.removeItem("gambasket_cart");
    }

    async function loadCart() {
        $("cartLoading").hidden = false;
        $("cartError").hidden = true;
        try {
            await window.GamBasketAuth.ready();
            const session = await window.GamBasketAuth.getSession();
            state.authenticated = Boolean(session?.user);
            if (state.authenticated) await migrateGuestCart();
            const result = state.authenticated ? await window.GamBasketAuth.getCart() : { items: normalizeLocalItems() };
            state.items = result.items || [];
            render();
        } catch (error) {
            console.error("[GamBasket Cart]", error);
            $("cartError").hidden = false;
        } finally {
            state.loading = false;
            $("cartLoading").hidden = true;
        }
    }

    function productFor(item) { return item.product || item.products || item; }

    function render() {
        const items = state.items;
        $("cartEmpty").hidden = items.length !== 0;
        $("cartContent").hidden = items.length === 0;
        if (!items.length) return;

        const count = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
        const subtotal = items.reduce((sum, item) => { const product = productFor(item); return sum + Number(product.price || 0) * Number(item.quantity || 1); }, 0);
        $("cartCount").textContent = `${count} ${count === 1 ? "item" : "items"}`;
        $("cartSubtitle").textContent = `${count} ${count === 1 ? "item" : "items"} ready for checkout.`;
        $("cartSubtotal").textContent = money(subtotal);
        $("cartTotal").textContent = money(subtotal);
        $("cartItems").innerHTML = items.map((item, index) => {
            const product = productFor(item);
            const quantity = Number(item.quantity || 1);
            const stock = Number(product.stock ?? 0);
            const productId = String(item.product_id || product.id);
            return `<article class="cart-item" data-index="${index}" data-id="${escapeHTML(productId)}">
                <div class="cart-image"><img src="${escapeHTML(product.main_image || product.image || "")}" alt="${escapeHTML(product.title || product.name || "Product")}" loading="lazy"></div>
                <div class="cart-info"><h3 class="cart-name">${escapeHTML(product.title || product.name || "Product")}</h3><p class="cart-seller">${escapeHTML(product.seller_name || product.seller || "GamBasket Seller")}</p><strong class="cart-price">${money(product.price)}</strong><p class="stock-text ${stock < 1 ? "out-of-stock" : ""}">${stock > 0 ? `${stock} available` : "Out of stock"}</p><div class="cart-controls"><button class="qty-btn" data-action="decrease" type="button" aria-label="Decrease quantity" ${quantity <= 1 ? "disabled" : ""}>-</button><span class="qty-value">${quantity}</span><button class="qty-btn" data-action="increase" type="button" aria-label="Increase quantity" ${quantity >= stock || stock < 1 ? "disabled" : ""}>+</button></div><button class="remove-btn" data-action="remove" type="button">Remove</button></div>
                <strong class="cart-line-total">${money(Number(product.price || 0) * quantity)}</strong>
            </article>`;
        }).join("");

        if (!continuePromptShown && new URLSearchParams(window.location.search).get("continue") === "checkout") {
            continuePromptShown = true;
            if (window.confirm("Your item is ready. Continue to checkout?")) {
                window.location.href = state.authenticated
                    ? "checkout.html"
                    : `login.html?redirect=${encodeURIComponent("checkout.html")}`;
            }
        }
    }

    async function updateItem(item, quantity) {
        const product = productFor(item);
        if (!state.authenticated) {
            const cart = localCart();
            const index = Number(item.__index);
            if (cart[index]) { cart[index].quantity = quantity; localStorage.setItem("gambasket_cart", JSON.stringify(cart)); }
        } else {
            await window.GamBasketAuth.updateCartItem(item.product_id || product.id, quantity);
        }
        await loadCart();
    }

    async function removeItem(item) {
        const product = productFor(item);
        if (!state.authenticated) {
            const cart = localCart(); cart.splice(Number(item.__index), 1); localStorage.setItem("gambasket_cart", JSON.stringify(cart));
        } else await window.GamBasketAuth.removeCartItem(item.product_id || product.id);
        await loadCart();
    }

    $("cartItems")?.addEventListener("click", async event => {
        const button = event.target.closest("[data-action]");
        const row = button?.closest(".cart-item");
        if (!button || !row) return;
        const index = Number(row.dataset.index);
        const item = state.items[index];
        if (!item) return;
        item.__index = index;
        const quantity = Number(item.quantity || 1);
        try {
            if (button.dataset.action === "remove") await removeItem(item);
            if (button.dataset.action === "increase") await updateItem(item, quantity + 1);
            if (button.dataset.action === "decrease") await updateItem(item, quantity - 1);
        } catch (error) { console.error("[GamBasket Cart Update]", error); $("cartError").hidden = false; }
    });

    $("clearCartBtn")?.addEventListener("click", async () => {
        if (!window.confirm("Remove all items from your cart?")) return;
        try {
            if (state.authenticated) await window.GamBasketAuth.clearCart();
            else localStorage.removeItem("gambasket_cart");
            await loadCart();
        } catch (error) { console.error("[GamBasket Cart Clear]", error); }
    });

    $("checkoutBtn")?.addEventListener("click", async () => {
        const session = await window.GamBasketAuth.getSession();
        const redirect = encodeURIComponent("checkout.html");
        window.location.href = session?.user ? "checkout.html" : `login.html?redirect=${redirect}`;
    });
    $("backButton")?.addEventListener("click", () => {
        if (window.history.length > 1) window.history.back();
        else window.location.href = "index.html";
    });
    $("retryCart")?.addEventListener("click", loadCart);
    loadCart();
})();
