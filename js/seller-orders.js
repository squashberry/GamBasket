/* ============================================================
   GAMBASKET — SELLER ORDERS MODULE
   Phase 5 — Fulfillment & Structured Cancellation
============================================================ */

(() => {
    "use strict";

    async function sellerCancelOrder(orderId, reason) {
        const allowedReasons = [
            "customer_request",
            "product_issue",
            "delivery_issue",
            "seller_unavailable",
            "other"
        ];

        if (!allowedReasons.includes(reason)) {
            throw new Error("Invalid cancellation reason.");
        }

        if (!window.supabaseClient) {
            return { id: orderId, status: "cancelled", seller_cancel_reason: reason };
        }

        const { data, error } = await window.supabaseClient
            .from("orders")
            .update({
                status: "cancelled",
                seller_cancel_reason: reason,
                seller_cancelled_at: new Date().toISOString()
            })
            .eq("id", orderId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    window.GamBasketSellerOrders = {
        sellerCancelOrder,

        async list(options = {}) {
            let user = null;
            if (window.supabaseClient) {
                const res = await window.supabaseClient.auth.getUser();
                user = res?.data?.user;
            } else if (window.GamBasketAuth) {
                user = await window.GamBasketAuth.getUser();
            }

            if (!user) return { items: [], total: 0 };

            if (window.supabaseClient) {
                try {
                    let query = window.supabaseClient
                        .from("orders")
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
                    console.warn("Orders query:", e);
                }
            }

            return { items: [], total: 0 };
        },

        async updateStatus(orderId, newStatus) {
            if (!window.supabaseClient) return { id: orderId, status: newStatus };

            const { data, error } = await window.supabaseClient
                .from("orders")
                .update({
                    status: newStatus,
                    updated_at: new Date().toISOString()
                })
                .eq("id", orderId)
                .select()
                .single();

            if (error) throw error;
            return data;
        }
    };
})();
