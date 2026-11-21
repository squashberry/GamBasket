/* JulaDirect checkout. A guided, three-part flow (delivery, payment, review) with a live order
   summary, editable quantities, an order-confirmed screen and links into My orders.
   Payment, COD eligibility, coupon and order creation use the same trusted calls as before:
   gambasket_cod_checkout_eligibility (RPC), validate_coupon, create_order and the
   gambasket-modempay-checkout edge function. Totals are always re-verified server side. */
(() => {
    "use strict";

    const state = { cart: [], coupon: null, deliveryFee: 0, submitting: false, codEligibility: null, open: 1, done: { 1: false, 2: false }, eligibilityTimer: 0 };
    const $ = id => document.getElementById(id);
    const JD = window.JD;
    const money = value => `D ${Number(value || 0).toLocaleString("en-GM")}`;
    const productFor = item => item.product || item.products || item;
    const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    const ADDRESS_KEY = "jd-ck-addr";
    const PAY_LABEL = { cash_on_delivery: "Cash on delivery", wave: "Wave", qmoney: "QMoney", afrimoney: "Afrimoney" };
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const isDelivery = () => document.querySelector('input[name="fulfillment"]:checked')?.value === "delivery";
    const selectedPayment = () => document.querySelector('input[name="payment"]:checked');

    /* ---------- cart helpers ---------- */
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

    const stockOf = p => (p && p.stock !== undefined && p.stock !== null ? Number(p.stock) : null);
    const unavailable = item => { const p = productFor(item); const st = stockOf(p); return (p.status && p.status !== "approved") || (st !== null && st < 1); };
    const overStock = item => { const st = stockOf(productFor(item)); return st !== null && Number(item.quantity || 1) > st; };
    const blocked = () => state.cart.some(item => unavailable(item) || overStock(item));

    function subtotal() { return state.cart.reduce((sum, item) => { const p = productFor(item); return sum + Number(p.price || 0) * Number(item.quantity || 1); }, 0); }
    function discount() { return Number(state.coupon?.discount_amount || 0); }
    function total() { return Math.max(0, subtotal() + state.deliveryFee - discount()); }

    /* ---------- payment configuration ---------- */
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
            if (note) note.textContent = "Online payments are on. You will be taken to ModemPay to pay securely, then brought back to your order.";
        } catch (error) {
            console.warn("[JulaDirect ModemPay] configuration could not be loaded:", error);
        }
    }

    async function loadCodEligibility() {
        const codInput = $("cod");
        if (!codInput) return;
        let note = $("codAvailabilityNote");
        if (!note) {
            note = document.createElement("small");
            note.id = "codAvailabilityNote";
            note.className = "checkout-note";
            document.querySelector('label[for="cod"] .ck-pay__t')?.appendChild(note);
        }
        codInput.disabled = true;
        syncPlaceOrderAvailability();
        note.textContent = "Checking this seller's Cash on Delivery eligibility…";
        try {
            const sellerIds = [...new Set(state.cart.map(item => productFor(item).seller_id).filter(Boolean))];
            if (sellerIds.length !== 1) throw new Error("Cash on Delivery is only available for a single seller's basket.");
            const client = window.GamBasketAuth?.getClient?.() || window.supabaseClient;
            if (!client) throw new Error("Checkout service is unavailable.");
            const { data, error } = await client.rpc("gambasket_cod_checkout_eligibility", {
                p_seller_id: sellerIds[0],
                p_merchandise_amount: Math.max(0, subtotal() - discount())
            });
            if (error) throw error;
            const eligibility = Array.isArray(data) ? data[0] : data;
            state.codEligibility = eligibility || null;
            const eligible = Boolean(eligibility?.eligible);
            codInput.disabled = !eligible;
            const badge = document.querySelector('label[for="cod"] .payment-availability-badge, label[for="cod"] .payment-coming-soon-badge');
            if (badge) {
                badge.textContent = eligible ? "Available" : "Unavailable";
                badge.className = eligible ? "payment-availability-badge" : "payment-coming-soon-badge";
            }
            note.textContent = eligible
                ? "This seller can offer cash on delivery for this basket."
                : "Cash on delivery is unavailable for this basket: the seller must enable it and keep enough reserve for this order.";
            if (!eligible && codInput.checked) {
                codInput.checked = false;
                const next = [...document.querySelectorAll('input[name="payment"]')].find(input => input !== codInput && !input.disabled);
                if (next) next.checked = true;
            } else if (eligible && !document.querySelector('input[name="payment"]:checked')) {
                codInput.checked = true;
            }
        } catch (error) {
            state.codEligibility = null;
            codInput.disabled = true;
            codInput.checked = false;
            note.textContent = "Cash on delivery is unavailable because the seller reserve could not be verified.";
            console.warn("[JulaDirect COD] eligibility could not be verified:", error);
        }
        syncPlaceOrderAvailability();
        fillSummaries();
    }
    function reloadEligibilitySoon() { clearTimeout(state.eligibilityTimer); state.eligibilityTimer = setTimeout(loadCodEligibility, 350); }

    /* ---------- init ---------- */
    async function init() {
        decorate();
        $("backButton").innerHTML = JD.icon("chevronRight", 22);
        $("ck-secure").innerHTML = JD.icon("lock", 15) + "<span>Secure checkout</span>";
        $("ck-flow").innerHTML = JD.flowSteps(2);
        await window.GamBasketAuth.ready();
        const session = await window.GamBasketAuth.getSession();
        if (!session?.user) {
            window.location.replace(`login.html?redirect=${encodeURIComponent("checkout.html")}`);
            return;
        }
        try {
            await migrateGuestCart();
            const profile = await window.GamBasketAuth.fetchUserProfile();
            let saved = {};
            try { saved = JSON.parse(localStorage.getItem(ADDRESS_KEY) || "{}") || {}; } catch { saved = {}; }
            if (profile) {
                $("fullName").value = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
                $("email").value = profile.email || session.user.email || "";
                $("phone").value = profile.phone || saved.phone || "";
                $("region").value = profile.region || saved.region || "";
                $("area").value = profile.area || saved.area || "";
            }
            if (!$("email").value) $("email").value = session.user.email || "";
            if (!$("region").value && saved.region) $("region").value = saved.region;
            if (!$("area").value && saved.area) $("area").value = saved.area;
            if (saved.address) $("address").value = saved.address;
            if (saved.landmark) $("landmark").value = saved.landmark;
            if (saved.instructions) $("instructions").value = saved.instructions;
            const result = await window.GamBasketAuth.getCart();
            state.cart = result.items || [];
            await loadModemPayConfig();
            if (!state.cart.length) {
                const placed = new URLSearchParams(location.search).get("placed");
                window.location.replace(placed ? `orders.html?order=${encodeURIComponent(placed)}&placed=1` : "cart.html");
                return;
            }
            bindEvents();
            render();
            /* a returning buyer with a saved, complete address starts on payment */
            if (state.cart.length && completeDelivery()) { state.done[1] = true; fillSummaries(); openStep(2, true); }
            await loadCodEligibility();
        } catch (error) {
            console.error("[JulaDirect Checkout]", error);
            showError("We couldn't load checkout. Please try again.");
        }
    }

    function decorate() {
        document.querySelectorAll("[data-ico]").forEach(el => {
            const ic = JD.icon(el.getAttribute("data-ico"), el.matches("li") ? 18 : 22);
            if (el.matches("li")) el.insertAdjacentHTML("afterbegin", `<span class="ck-assure__i">${ic}</span>`);
            else el.innerHTML = ic;
        });
        $("ck-coupon-ico").innerHTML = JD.icon("tag", 18);
    }

    /* ---------- rendering ---------- */
    function itemRow(item) {
        const p = productFor(item);
        const q = Number(item.quantity || 1);
        const st = stockOf(p);
        const bad = unavailable(item) ? "Unavailable" : overStock(item) ? `Only ${st} left` : "";
        const img = (JD.safeUrl && JD.safeUrl(p.main_image)) || JD.placeholder || "";
        const pid = escapeHTML(String(item.product_id || p.id));
        return `<div class="summary-item${bad ? " is-bad" : ""}" data-pid="${pid}">` +
            `<a class="summary-item-img" href="product.html?id=${encodeURIComponent(item.product_id || p.id)}"><img src="${escapeHTML(img)}" alt="" loading="lazy"></a>` +
            `<div class="summary-item-info"><div class="summary-item-name">${escapeHTML(p.title || "Product")}</div>` +
            `<div class="summary-item-qty">${money(p.price)} each${bad ? ` · <b class="ck-bad">${escapeHTML(bad)}</b>` : ""}</div>` +
            `<div class="ck-qty" role="group" aria-label="Quantity"><button type="button" data-q="-1" aria-label="Decrease quantity"${q <= 1 ? " disabled" : ""}>${JD.icon("minus", 15)}</button><output>${q}</output><button type="button" data-q="1" aria-label="Increase quantity"${st !== null && q >= st ? " disabled" : ""}>${JD.icon("plus", 15)}</button>` +
            `<button type="button" class="ck-rm" data-rm aria-label="Remove ${escapeHTML(p.title || "item")}">${JD.icon("trash", 16)}</button></div></div>` +
            `<strong class="summary-item-total">${money(Number(p.price || 0) * q)}</strong></div>`;
    }

    function render() {
        $("summaryItems").innerHTML = state.cart.map(itemRow).join("");
        $("summarySubtotal").textContent = money(subtotal());
        $("summaryDelivery").textContent = state.deliveryFee ? money(state.deliveryFee) : "Free";
        const d = discount();
        $("ck-discount-row").hidden = !d;
        $("summaryDiscount").textContent = `- ${money(d)}`;
        $("summaryTotal").textContent = money(total());
        $("ck-dock-total").textContent = money(total());
        const del = isDelivery();
        $("deliveryFields").hidden = !del;
        $("pickupNote").hidden = del;
        const warn = blocked();
        const box = $("checkoutError");
        if (warn) { box.innerHTML = `Some items are unavailable or exceed the stock left. <a href="cart.html">Review your cart</a> or adjust the quantities below.`; box.hidden = false; }
        else if (box.dataset.kind === "stock") { box.hidden = true; }
        box.dataset.kind = warn ? "stock" : box.dataset.kind || "";
        labelPrimary();
        syncPlaceOrderAvailability();
    }

    function calculateDelivery() {
        state.deliveryFee = isDelivery() ? 100 : 0;
        ["region", "area", "address"].forEach(id => { if ($(id)) $(id).required = isDelivery(); });
        render();
        fillSummaries();
        reloadEligibilitySoon();
    }

    function completeDelivery() {
        const base = ["fullName", "phone", "email"].every(id => $(id).value.trim());
        const addr = !isDelivery() || ["region", "area", "address"].every(id => $(id).value.trim());
        return base && addr && $("phone").value.replace(/\D/g, "").length >= 7;
    }

    function fillSummaries() {
        const name = $("fullName").value.trim(), phone = $("phone").value.trim();
        $("ck-s1-sum").textContent = state.done[1]
            ? (isDelivery() ? `${name} · ${phone} · ${[$("address").value.trim(), $("area").value.trim()].filter(Boolean).join(", ")}` : `Store pickup · ${name} · ${phone}`)
            : "Who is receiving this order and where it goes.";
        const pay = selectedPayment();
        $("ck-s2-sum").textContent = state.done[2] && pay
            ? (pay.value === "cash_on_delivery" ? `Cash on delivery · pay ${money(total())} when it arrives` : `Pay online with ${PAY_LABEL[pay.value] || pay.value}`)
            : "Choose how you want to pay.";
        [1, 2].forEach(n => { const el = $("ck-n" + n); el.innerHTML = state.done[n] ? JD.icon("check", 16) : String(n); $("ck-s" + n).classList.toggle("is-done", state.done[n]); });
    }

    function labelPrimary() {
        let label;
        if (state.submitting) label = "Securing your order…";
        else if (state.open === 1) label = "Continue to payment";
        else if (state.open === 2) label = "Review your order";
        else if (!state.done[1]) label = "Add delivery details";
        else if (!state.done[2]) label = "Choose payment";
        else {
            const pay = selectedPayment();
            label = pay && pay.value !== "cash_on_delivery" ? `Pay ${money(total())} online` : `Place order · ${money(total())}`;
        }
        $("placeOrderBtn").textContent = label;
        $("ck-dock-btn").textContent = label;
    }

    function syncPlaceOrderAvailability() {
        const off = state.submitting || blocked();
        $("placeOrderBtn").disabled = off;
        $("ck-dock-btn").disabled = off;
        labelPrimary();
    }

    /* ---------- steps ---------- */
    function openStep(n, quiet) {
        state.open = n;
        [1, 2].forEach(i => {
            const sec = $("ck-s" + i), on = i === n;
            sec.classList.toggle("is-open", on);
            sec.querySelector(".ck-step__head").setAttribute("aria-expanded", String(on));
        });
        $("ck-summary").classList.toggle("is-review", n === 0);
        labelPrimary();
        if (quiet) return;
        const target = n ? $("ck-s" + n) : $("ck-summary");
        const phone = window.matchMedia("(max-width: 960px)").matches;
        if (n || phone) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        if (n) setTimeout(() => { const f = target.querySelector("input:not([type=radio]):not([type=checkbox]):not([disabled]), select"); if (f && n === 1 && !f.value) f.focus({ preventScroll: true }); }, 350);
    }

    function validateDelivery() {
        const ids = ["fullName", "phone", "email"].concat(isDelivery() ? ["region", "area", "address"] : []);
        for (const id of ids) {
            const el = $(id);
            if (!el.checkValidity()) { el.reportValidity(); el.focus(); return false; }
        }
        const phone = $("phone");
        if (phone.value.replace(/\D/g, "").length < 7) {
            phone.setCustomValidity("Enter a phone number the courier can call.");
            phone.reportValidity();
            phone.addEventListener("input", () => phone.setCustomValidity(""), { once: true });
            phone.focus();
            return false;
        }
        return true;
    }

    function paymentOk() {
        const pay = selectedPayment();
        if (!pay || pay.disabled) { showError("Choose an available payment method."); return false; }
        clearError();
        return true;
    }

    function primary() {
        if (state.submitting || blocked()) return;
        if (state.open === 1) {
            if (!validateDelivery()) return;
            state.done[1] = true; fillSummaries();
            openStep(state.done[2] ? 0 : 2);
        } else if (state.open === 2) {
            if (!paymentOk()) return;
            state.done[2] = true; fillSummaries();
            openStep(0);
        } else if (!state.done[1]) { openStep(1); }
        else if (!state.done[2]) { openStep(2); }
        else submitOrder();
    }

    /* ---------- coupon ---------- */
    async function applyCoupon() {
        const code = $("couponInput").value.trim();
        if (!code) return;
        $("couponMessage").textContent = "Checking coupon…";
        try {
            const coupon = await window.GamBasketAuth.validateCoupon(code, subtotal());
            state.coupon = coupon;
            $("couponMessage").textContent = coupon ? `Coupon ${coupon.code} applied.` : "This coupon is invalid or unavailable.";
            render(); fillSummaries();
            await loadCodEligibility();
        } catch (error) {
            console.error("[JulaDirect Coupon]", error);
            state.coupon = null;
            $("couponMessage").textContent = "Unable to validate this coupon.";
            render();
            await loadCodEligibility();
        }
    }

    /* ---------- cart edits ---------- */
    async function changeQty(pid, delta) {
        const item = state.cart.find(i => String(i.product_id || productFor(i).id) === pid);
        if (!item) return;
        const st = stockOf(productFor(item));
        const next = Math.max(1, Math.min(Number(item.quantity || 1) + delta, st !== null ? Math.max(st, 1) : 99));
        if (next === Number(item.quantity)) return;
        const prev = item.quantity;
        item.quantity = next; state.coupon = null; $("couponMessage").textContent = ""; render();
        try { await window.GamBasketAuth.updateCartItem(pid, next); fillSummaries(); reloadEligibilitySoon(); }
        catch (error) { item.quantity = prev; render(); showError("We couldn't update that quantity."); }
    }
    async function removeItem(pid) {
        const item = state.cart.find(i => String(i.product_id || productFor(i).id) === pid);
        if (!item) return;
        try {
            await window.GamBasketAuth.removeCartItem(pid);
            state.cart = state.cart.filter(i => i !== item); state.coupon = null;
            if (!state.cart.length) { window.location.replace("cart.html"); return; }
            render(); fillSummaries(); reloadEligibilitySoon();
        } catch (error) { showError("We couldn't remove that item."); }
    }

    /* ---------- order ---------- */
    async function submitOrder() {
        if (state.submitting) return;
        const pay = selectedPayment();
        const permittedMethods = ["cash_on_delivery", "wave", "qmoney", "afrimoney"];
        if (!validateDelivery()) { openStep(1); return; }
        if (!pay || pay.disabled || !permittedMethods.includes(pay.value)) { openStep(2); showError("Choose an available payment method."); return; }
        clearError();

        state.submitting = true;
        syncPlaceOrderAvailability();
        const snapshot = { items: state.cart.map(i => ({ title: productFor(i).title, image: productFor(i).main_image, qty: Number(i.quantity || 1) })), total: total(), delivery: isDelivery(), area: $("area").value.trim(), address: $("address").value.trim(), phone: $("phone").value.trim() };
        try {
            const fulfillment = document.querySelector('input[name="fulfillment"]:checked').value;
            const payment = pay.value;
            // Persist the buyer's actual choice. The trusted database wrapper checks
            // COD reserve eligibility or starts online orders as pending_online.
            const result = await window.GamBasketAuth.createOrder({
                fulfillment_type: fulfillment,
                payment_method: payment,
                delivery_address: fulfillment === "delivery" ? `${$("address").value.trim()}${$("landmark").value.trim() ? `, ${$("landmark").value.trim()}` : ""}` : null,
                delivery_region: fulfillment === "delivery" ? $("region").value : null,
                delivery_area: fulfillment === "delivery" ? $("area").value.trim() : null,
                delivery_phone: $("phone").value.trim(),
                delivery_instructions: fulfillment === "delivery" ? $("instructions").value.trim() : null,
                coupon_code: state.coupon?.code || null
            });
            const order = result.order || result;
            rememberAddress();

            // Create a pending commission record only when an affiliate attribution
            // exists. The database independently verifies order ownership and keeps
            // commissions pending until a paid order is approved by an affiliate admin.
            if (order?.id) {
                try {
                    await window.GamBasketAffiliate?.attachAttribution();
                    await window.GamBasketAffiliate?.recordConversion(order.id);
                } catch (affiliateError) {
                    console.warn("[JulaDirect Affiliate] Conversion attribution failed:", affiliateError);
                }
            }

            if (payment !== "cash_on_delivery") {
                const client = window.GamBasketAuth?.getClient?.() || window.supabaseClient;
                if (!client?.functions || !window.crypto?.randomUUID) {
                    throw new Error("Secure online checkout is not available in this browser.");
                }
                $("placeOrderBtn").textContent = "Opening secure payment…";
                $("ck-dock-btn").textContent = "Opening secure payment…";
                const { data: paymentIntent, error: paymentError } = await client.functions.invoke("gambasket-modempay-checkout", {
                    body: {
                        order_id: order.id,
                        payment_method: payment,
                        idempotency_key: window.crypto.randomUUID()
                    }
                });
                if (paymentError || !paymentIntent?.payment_url) {
                    /* the order exists, so send the buyer to it: Orders has a "Complete payment" button */
                    showError((paymentIntent?.error || paymentError?.message || "ModemPay could not open checkout.") + " Your order is saved in My orders, where you can retry the payment.");
                    state.submitting = false; syncPlaceOrderAvailability();
                    setTimeout(() => window.location.assign(`orders.html?order=${encodeURIComponent(order.id)}&placed=1`), 2600);
                    return;
                }
                window.GamBasketAffiliate?.clearReferral();
                window.location.assign(paymentIntent.payment_url);
                return;
            }

            window.GamBasketAffiliate?.clearReferral();
            showConfirmation(order, snapshot, payment);
        } catch (error) {
            console.error("[JulaDirect Create Order]", error);
            showError(window.getAuthErrorMessage ? window.getAuthErrorMessage(error) : "We couldn't place the order. Please try again.");
            state.submitting = false;
            syncPlaceOrderAvailability();
        }
    }

    function rememberAddress() {
        try {
            if ($("rememberAddress").checked) localStorage.setItem(ADDRESS_KEY, JSON.stringify({ phone: $("phone").value.trim(), region: $("region").value, area: $("area").value.trim(), address: $("address").value.trim(), landmark: $("landmark").value.trim(), instructions: $("instructions").value.trim() }));
            else localStorage.removeItem(ADDRESS_KEY);
        } catch { /* storage blocked */ }
    }

    function showConfirmation(order, snap, payment) {
        const key = order.id || order.order_number || "";
        $("successOrderNumber").textContent = "#" + (order.order_number || order.id || "");
        $("viewOrderBtn").href = `orders.html?order=${encodeURIComponent(key)}&placed=1`;
        $("ck-flow").innerHTML = JD.flowSteps(3);
        const cod = payment === "cash_on_delivery";
        $("ck-done-lead").textContent = cod
            ? `The seller has been notified. Keep ${money(snap.total)} in cash ready: you pay the courier when it arrives.`
            : "The seller has been notified and will confirm your order shortly.";
        $("ck-done-thumbs").innerHTML = snap.items.slice(0, 4).map(i => `<span><img src="${escapeHTML((JD.safeUrl && JD.safeUrl(i.image)) || JD.placeholder || "")}" alt=""><b>${i.qty}×</b></span>`).join("") + (snap.items.length > 4 ? `<span class="more">+${snap.items.length - 4}</span>` : "");
        const facts = [["Total", money(snap.total)], ["Payment", cod ? "Cash on delivery" : (PAY_LABEL[payment] || payment)], [snap.delivery ? "Delivery to" : "Pickup", snap.delivery ? [snap.address, snap.area].filter(Boolean).join(", ") : "Seller location confirmed after they accept"], ["Contact", snap.phone]];
        $("ck-done-facts").innerHTML = facts.map(f => `<div><dt>${escapeHTML(f[0])}</dt><dd>${escapeHTML(f[1])}</dd></div>`).join("");
        $("ck-layout").hidden = true;
        $("ck-dock").hidden = true;
        document.body.classList.add("is-done");
        $("checkoutError").hidden = true;
        $("orderSuccess").hidden = false;
        $("orderSuccess").classList.add("show");
        history.replaceState(null, "", "checkout.html?placed=" + encodeURIComponent(key));
        window.scrollTo({ top: 0, behavior: "auto" });
        $("orderSuccess").querySelector("h1").setAttribute("tabindex", "-1");
        $("orderSuccess").querySelector("h1").focus({ preventScroll: true });
        window.dispatchEvent(new CustomEvent("gambasket:cart:change"));
    }

    function showError(message) {
        const target = $("checkoutError");
        if (target) { target.textContent = message; target.dataset.kind = "error"; target.hidden = false; target.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" }); }
        else window.alert(message);
    }
    function clearError() { const t = $("checkoutError"); if (t && t.dataset.kind === "error") { t.hidden = true; t.dataset.kind = ""; } }

    /* ---------- events ---------- */
    function bindEvents() {
        $("backButton")?.addEventListener("click", () => {
            if (state.open === 2 && state.done[1] === false) { openStep(1); return; }
            if (document.referrer && history.length > 1) history.back(); else window.location.href = "cart.html";
        });
        document.querySelectorAll('input[name="fulfillment"]').forEach(input => input.addEventListener("change", () => { state.done[1] = false; calculateDelivery(); }));
        document.querySelectorAll('input[name="payment"]').forEach(input => input.addEventListener("change", () => { state.done[2] = false; clearError(); fillSummaries(); syncPlaceOrderAvailability(); }));
        $("checkoutForm").addEventListener("input", e => { if (e.target.closest("#ck-s1") && state.done[1]) { state.done[1] = false; fillSummaries(); } });
        document.querySelectorAll(".ck-step__head").forEach(h => h.addEventListener("click", () => {
            const n = Number(h.getAttribute("data-open"));
            openStep(state.open === n ? 0 : n);
        }));
        $("summaryItems").addEventListener("click", e => {
            const row = e.target.closest(".summary-item"); if (!row) return;
            const pid = row.getAttribute("data-pid");
            const q = e.target.closest("[data-q]");
            if (q) changeQty(pid, Number(q.getAttribute("data-q")));
            else if (e.target.closest("[data-rm]")) removeItem(pid);
        });
        $("applyCouponBtn")?.addEventListener("click", applyCoupon);
        $("couponInput")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyCoupon(); } });
        $("placeOrderBtn").addEventListener("click", primary);
        $("ck-dock-btn").addEventListener("click", primary);
        $("checkoutForm")?.addEventListener("submit", e => { e.preventDefault(); primary(); });
        calculateDelivery();
    }

    init();
})();
