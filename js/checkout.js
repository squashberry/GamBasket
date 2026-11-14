(() => {
    "use strict";

    const state = { cart: [], coupon: null, deliveryFee: 0, submitting: false };
    const $ = id => document.getElementById(id);
    const money = value => `D ${Number(value || 0).toLocaleString("en-GM")}`;
    const productFor = item => item.product || item.products || item;
    const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

    async function migrateGuestCart() {
        let guestItems = [];
        try { guestItems = JSON.parse(localStorage.getItem("gambasket_cart") || "[]"); } catch { return; }
        if (!guestItems.length) return;
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

    async function loadModemPayConfig() {
        const client = window.GamBasketAuth?.getClient?.() || window.supabaseClient;
        if (!client?.functions) return;
        try {
            const { data, error } = await client.functions.invoke("gambasket-modempay-config", { method: "GET" });
            if (error || !data?.checkout_enabled) return;
            ["wave", "qmoney", "afrimoney"].forEach(method => {
                const input = document.getElementById(method);
                if (input) input.disabled = false;
                const label = document.querySelector('label[for="' + method + '"]');
                const badge = label?.querySelector(".payment-coming-soon-badge");
                if (badge) {
                    badge.className = "payment-availability-badge";
                    badge.textContent = "Pay online";
                }
                const hint = document.getElementById(method + "ComingSoon");
                if (hint) hint.textContent = "Continue to secure ModemPay checkout.";
            });
            const note = document.getElementById("paymentAvailabilityNote");
            if (note) note.textContent = "Online payments are enabled. You will be redirected to ModemPay to complete payment securely.";
        } catch (error) {
            console.warn("[GamBasket ModemPay] configuration could not be loaded:", error);
        }
    }

    async function init() {
        await window.GamBasketAuth.ready();
        const session = await window.GamBasketAuth.getSession();
        if (!session?.user) {
            window.location.replace(`login.html?redirect=${encodeURIComponent("checkout.html")}`);
            return;
        }
        try {
            await migrateGuestCart();
            const profile = await window.GamBasketAuth.fetchUserProfile();
            if (profile) {
                $("fullName").value = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
                $("email").value = profile.email || session.user.email || "";
                $("phone").value = profile.phone || "";
                $("region").value = profile.region || "";
                $("area").value = profile.area || "";
            }
            const result = await window.GamBasketAuth.getCart();
            state.cart = result.items || [];
            await loadModemPayConfig();
            if (!state.cart.length) { window.location.replace("cart.html"); return; }
            bindEvents();
            render();
        } catch (error) {
            console.error("[GamBasket Checkout]", error);
            showError("We couldn't load checkout. Please try again.");
        }
    }

    function subtotal() { return state.cart.reduce((sum, item) => { const p = productFor(item); return sum + Number(p.price || 0) * Number(item.quantity || 1); }, 0); }
    function discount() { return Number(state.coupon?.discount_amount || 0); }
    function total() { return Math.max(0, subtotal() + state.deliveryFee - discount()); }

    function render() {
        $("summaryItems").innerHTML = state.cart.map(item => { const p = productFor(item); return `<div class="summary-item"><img src="${escapeHTML(p.main_image || "")}" alt=""><div class="summary-item-info"><div class="summary-item-name">${escapeHTML(p.title || "Product")}</div><div class="summary-item-qty">Qty ${Number(item.quantity || 1)}</div></div><strong>${money(Number(p.price || 0) * Number(item.quantity || 1))}</strong></div>`; }).join("");
        $("summarySubtotal").textContent = money(subtotal());
        $("summaryDelivery").textContent = money(state.deliveryFee);
        $("summaryDiscount").textContent = `- ${money(discount())}`;
        $("summaryTotal").textContent = money(total());
        $("deliveryFields").hidden = document.querySelector('input[name="fulfillment"]:checked')?.value !== "delivery";
    }

    function calculateDelivery() {
        const isDelivery = document.querySelector('input[name="fulfillment"]:checked')?.value === "delivery";
        state.deliveryFee = isDelivery ? 100 : 0;
        ["region", "area", "address"].forEach(id => { if ($(id)) $(id).required = isDelivery; });
        render();
    }

    async function applyCoupon() {
        const code = $("couponInput").value.trim();
        if (!code) return;
        $("couponMessage").textContent = "Checking coupon...";
        try {
            const coupon = await window.GamBasketAuth.validateCoupon(code, subtotal());
            state.coupon = coupon;
            $("couponMessage").textContent = coupon ? `Coupon ${coupon.code} applied.` : "This coupon is invalid or unavailable.";
            render();
        } catch (error) {
            console.error("[GamBasket Coupon]", error);
            state.coupon = null;
            $("couponMessage").textContent = "Unable to validate this coupon.";
        }
    }

    async function submitOrder(event) {
        event.preventDefault();
        if (state.submitting) return;
        if (!$("checkoutForm").reportValidity()) return;

        const selectedPayment = document.querySelector('input[name="payment"]:checked');
        const permittedMethods = ["cash_on_delivery", "wave", "qmoney", "afrimoney"];
        if (!selectedPayment || selectedPayment.disabled || !permittedMethods.includes(selectedPayment.value)) {
            showError("Choose an available payment method.");
            return;
        }

        state.submitting = true;
        const button = $("placeOrderBtn");
        button.disabled = true;
        button.textContent = "Securing your order...";
        try {
            const fulfillment = document.querySelector('input[name="fulfillment"]:checked').value;
            const payment = selectedPayment.value;
            // The existing order transaction creates the order as Cash on Delivery.
            // ModemPay attaches a pending provider intent before switching payment_method.
            const result = await window.GamBasketAuth.createOrder({
                fulfillment_type: fulfillment,
                payment_method: "cash_on_delivery",
                delivery_address: fulfillment === "delivery" ? `${$("address").value.trim()}${$("landmark").value.trim() ? `, ${$("landmark").value.trim()}` : ""}` : null,
                delivery_region: fulfillment === "delivery" ? $("region").value : null,
                delivery_area: fulfillment === "delivery" ? $("area").value.trim() : null,
                delivery_phone: $("phone").value.trim(),
                delivery_instructions: fulfillment === "delivery" ? $("instructions").value.trim() : null,
                coupon_code: state.coupon?.code || null
            });
            const order = result.order || result;

            // Create a pending commission record only when an affiliate attribution
            // exists. The database independently verifies order ownership and keeps
            // commissions pending until a paid order is approved by an affiliate admin.
            if (order?.id) {
                try {
                    await window.GamBasketAffiliate?.attachAttribution();
                    await window.GamBasketAffiliate?.recordConversion(order.id);
                } catch (affiliateError) {
                    console.warn("[GamBasket Affiliate] Conversion attribution failed:", affiliateError);
                }
            }

            if (payment !== "cash_on_delivery") {
                const client = window.GamBasketAuth?.getClient?.() || window.supabaseClient;
                if (!client?.functions || !window.crypto?.randomUUID) {
                    throw new Error("Secure online checkout is not available in this browser.");
                }
                const { data: paymentIntent, error: paymentError } = await client.functions.invoke("gambasket-modempay-checkout", {
                    body: {
                        order_id: order.id,
                        payment_method: payment,
                        idempotency_key: window.crypto.randomUUID()
                    }
                });
                if (paymentError || !paymentIntent?.payment_url) {
                    throw new Error(paymentIntent?.error || paymentError?.message || "ModemPay could not open checkout.");
                }
                window.GamBasketAffiliate?.clearReferral();
                window.location.assign(paymentIntent.payment_url);
                return;
            }

            $("successOrderNumber").textContent = order.order_number || order.id || "";
            $("viewOrderBtn").href = `orders.html?orderId=${encodeURIComponent(order.id || order.order_number)}`;
            $("orderSuccess").classList.add("show");
            window.GamBasketAffiliate?.clearReferral();
        } catch (error) {
            console.error("[GamBasket Create Order]", error);
            showError(window.getAuthErrorMessage ? window.getAuthErrorMessage(error) : "We couldn't place the order. Please try again.");
        } finally {
            state.submitting = false;
            button.disabled = false;
            button.textContent = "Place Order";
        }
    }

    function showError(message) {
        const target = $("checkoutError");
        if (target) { target.textContent = message; target.hidden = false; }
        else window.alert(message);
    }

    function bindEvents() {
        $("backButton")?.addEventListener("click", () => {
            if (window.history.length > 1) window.history.back();
            else window.location.href = "cart.html";
        });
        document.querySelectorAll('input[name="fulfillment"]').forEach(input => input.addEventListener("change", calculateDelivery));
        $("area")?.addEventListener("input", calculateDelivery);
        $("applyCouponBtn")?.addEventListener("click", applyCoupon);
        $("checkoutForm")?.addEventListener("submit", submitOrder);
        calculateDelivery();
    }

    init();
})();
