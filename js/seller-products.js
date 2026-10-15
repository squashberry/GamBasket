/* ============================================================
   GAMBASKET — SELLER PRODUCTS MODULE
   Phase 5 — Stock Controls, Badges & Quick Stock Editor
============================================================ */

(() => {
    "use strict";

    function getStockState(stock) {
        const quantity = Number(stock || 0);

        if (quantity <= 0) {
            return {
                key: "out",
                label: "Out of Stock",
                className: "stock-out"
            };
        }

        if (quantity <= 3) {
            return {
                key: "low",
                label: "Only " + quantity + " left",
                className: "stock-low"
            };
        }

        return {
            key: "available",
            label: quantity + " available",
            className: "stock-available"
        };
    }

    function renderStockBadge(stock) {
        const state = getStockState(stock);
        return '<span class="stock-badge ' + state.className + '">' + state.label + '</span>';
    }

    function canOrderQuantity(stock, requestedQuantity) {
        return Number(requestedQuantity) <= Number(stock);
    }

    function getStockError(stock, requestedQuantity) {
        if (Number(stock) <= 0) {
            return "This product is currently out of stock.";
        }

        if (Number(requestedQuantity) > Number(stock)) {
            return "Only " + stock + " unit" + (Number(stock) === 1 ? "" : "s") + " currently available.";
        }

        return null;
    }

    window.GamBasketStockControl = {
        getStockState,
        renderStockBadge,
        canOrderQuantity,
        getStockError
    };

    window.GamBasketSellerProducts = {
        getStockState,
        renderStockBadge,
        canOrderQuantity,
        getStockError,

        async list(options = {}) {
            let user = null;
            const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
            if (client) {
                const res = await client.auth.getUser();
                user = res?.data?.user;
            } else if (window.GamBasketAuth) {
                user = await window.GamBasketAuth.getUser();
            }

            if (!user) return { items: [], total: 0 };

            if (client) {
                try {
                    let query = client
                        .from("products")
                        .select("*")
                        .eq("seller_id", user.id)
                        .order("created_at", { ascending: false });

                    if (options.status && options.status !== "all") {
                        query = query.eq("status", options.status);
                    }

                    const { data, error } = await query;
                    if (!error && data) {
                        return { items: data, total: data.length };
                    }
                } catch (e) {
                    console.warn("Seller products query:", e);
                }
            }

            return { items: [], total: 0 };
        },

        async getStats() {
            const { items } = await this.list();
            return {
                total: items.length,
                active: items.filter(p => ["approved", "active", "published"].includes((p.status || "").toLowerCase())).length,
                pending: items.filter(p => ["pending_review", "pending", "submitted"].includes((p.status || "").toLowerCase())).length,
                lowStock: items.filter(p => Number(p.stock || 0) > 0 && Number(p.stock || 0) <= 3).length,
                outOfStock: items.filter(p => Number(p.stock || 0) <= 0).length
            };
        },

        async save(productData) {
            let user = null;
            const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
            if (client) {
                const res = await client.auth.getUser();
                user = res?.data?.user;
            } else if (window.GamBasketAuth) {
                user = await window.GamBasketAuth.getUser();
            }

            if (!user) throw new Error("Authentication required");

            const payload = {
                ...productData,
                seller_id: user.id,
                updated_at: new Date().toISOString()
            };

            // The current products schema uses category_id and puts every new
            // seller submission through moderation before it is public.
            if (payload.category && !payload.category_id) {
                payload.category_id = payload.category;
            }
            delete payload.category;

            if (payload.id) {
                const { data, error } = await client
                    .from("products")
                    .update(payload)
                    .eq("id", payload.id)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                payload.created_at = new Date().toISOString();
                payload.status = payload.status || "pending_review";
                const { data, error } = await client
                    .from("products")
                    .insert(payload)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },

        async get(productId) {
            if (!productId) return { data: null, error: null };
            const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
            if (!client) return { data: null, error: new Error("Authentication client unavailable") };
            const { data, error } = await client
                .from("products")
                .select("*")
                .eq("id", productId)
                .maybeSingle();
            return { data, error };
        },

        async delete(productId) {
            const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
            if (!client) throw new Error("Authentication client unavailable");
            const { error } = await client
                .from("products")
                .delete()
                .eq("id", productId);
            if (error) throw error;
            return true;
        }
    };

    // Quick stock editor click handler
    document.addEventListener("click", async event => {
        const button = event.target.closest("[data-stock-action]");
        if (!button) return;

        const editor = button.closest(".quick-stock-editor");
        if (!editor) return;

        const input = editor.querySelector(".stock-value");
        const current = Number(input.value || 0);
        let next = current;

        if (button.dataset.stockAction === "minus") {
            next = Math.max(0, current - 1);
        }
        if (button.dataset.stockAction === "plus") {
            next = current + 1;
        }

        input.value = next;
        const productId = editor.dataset.productId;

        const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
        if (!productId || !client) return;

        const { error } = await client
            .from("products")
            .update({ stock: next })
            .eq("id", productId);

        if (error) {
            console.error("Stock update error:", error);
            input.value = current;
            alert("Unable to update stock.");
            return;
        }

        const card = editor.closest("[data-product-card]");
        const badge = card?.querySelector(".stock-badge");
        if (badge) {
            badge.outerHTML = renderStockBadge(next);
        }
    });
})();
