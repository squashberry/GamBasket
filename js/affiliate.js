/* GamBasket's single affiliate browser engine. Money is calculated only in SQL. */
(() => {
    "use strict";

    const client = window.supabaseClient || window.gambasketSupabase || window.supabase || window.sb;
    const storage = {
        token: "gambasket_affiliate_visitor_token",
        code: "gambasket_affiliate_code",
        product: "gambasket_affiliate_product",
        link: "gambasket_affiliate_link",
        started: "gambasket_affiliate_started_at"
    };

    if (!client) {
        console.error("[GamBasket Affiliate] Supabase client unavailable.");
        return;
    }

    function getVisitorToken() {
        let token = localStorage.getItem(storage.token);
        if (!token) {
            token = crypto.randomUUID();
            localStorage.setItem(storage.token, token);
        }
        return token;
    }

    function getReferral() {
        return {
            code: localStorage.getItem(storage.code),
            productId: localStorage.getItem(storage.product),
            linkId: localStorage.getItem(storage.link),
            visitorToken: getVisitorToken()
        };
    }

    async function call(name, args = {}) {
        const { data, error } = await client.rpc(name, args);
        if (error) throw error;
        return data;
    }

    async function getAffiliateProfile() {
        return call("get_or_create_affiliate_profile");
    }

    async function createAffiliateProfile() {
        return getAffiliateProfile();
    }

    function buildProductLink(productId, affiliateCode, linkId = null) {
        const params = new URLSearchParams({ id: productId, ref: affiliateCode });
        if (linkId) params.set("link", linkId);
        return `${window.location.origin}/product.html?${params.toString()}`;
    }

    async function createProductLink(productId) {
        const [profile, link] = await Promise.all([
            getAffiliateProfile(),
            call("create_affiliate_link", { p_product_id: productId })
        ]);
        return { ...link, url: buildProductLink(productId, profile.affiliate_code, link.id) };
    }

    async function shareLink(url, title = "Check this out on GamBasket") {
        if (navigator.share) {
            await navigator.share({ title, text: "Check out this product on GamBasket.", url });
            return true;
        }
        await navigator.clipboard.writeText(url);
        return false;
    }

    async function trackReferral() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("ref");
        if (!code) return false;

        const productId = params.get("id") || null;
        const linkId = params.get("link") || null;
        const key = `gambasket_affiliate_tracked:${code}:${productId || ""}:${linkId || ""}`;
        if (sessionStorage.getItem(key)) return true;

        try {
            await call("record_affiliate_click", {
                p_affiliate_code: code,
                p_product_id: productId,
                p_visitor_token: getVisitorToken(),
                p_link_id: linkId,
                p_landing_page: window.location.pathname + window.location.search
            });
            localStorage.setItem(storage.code, code);
            localStorage.setItem(storage.product, productId || "");
            localStorage.setItem(storage.link, linkId || "");
            localStorage.setItem(storage.started, String(Date.now()));
            sessionStorage.setItem(key, "1");
            return true;
        } catch (error) {
            console.warn("[GamBasket Affiliate] Referral tracking failed:", error);
            return false;
        }
    }

    async function attachAttribution() {
        try {
            return await call("attach_affiliate_attribution", { p_visitor_token: getVisitorToken() });
        } catch (error) {
            // Visitors commonly reach this before authentication; this is not a checkout error.
            return false;
        }
    }

    async function getCurrentAttribution() {
        try {
            return await call("get_current_affiliate_attribution", { p_visitor_token: getVisitorToken() });
        } catch (error) {
            console.warn("[GamBasket Affiliate] Unable to load attribution:", error);
            return null;
        }
    }

    async function recordConversion(orderId) {
        if (!orderId) return null;
        try {
            return await call("record_affiliate_conversion", { p_order_id: orderId, p_visitor_token: getVisitorToken() });
        } catch (error) {
            console.warn("[GamBasket Affiliate] Conversion was not created:", error);
            return null;
        }
    }

    async function getDashboard() {
        return call("get_affiliate_dashboard");
    }

    function clearReferral() {
        [storage.code, storage.product, storage.link, storage.started].forEach(key => localStorage.removeItem(key));
    }

    async function getMyLinks() {
        const rows = await call("get_my_affiliate_links");
        // Preserve the shape used by the existing Affiliate Center while the
        // canonical RPC keeps its response lightweight and RLS-safe.
        return (rows || []).map(row => ({
            ...row,
            products: {
                id: row.product_id,
                title: row.product_title,
                price: row.price,
                currency: row.currency,
                main_image: row.main_image
            }
        }));
    }

    async function getCommissions() {
        const profile = await getAffiliateProfile();
        const { data, error } = await client.from("affiliate_conversions")
            .select("id, order_id, sale_amount, commission_rate, commission_amount, status, created_at, approved_at, paid_at, rejection_reason, orders(id, order_number, subtotal, total, currency, order_status, payment_status, created_at)")
            .eq("affiliate_id", profile.id).order("created_at", { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async function requestPayout(amount, paymentMethod, paymentAccount) {
        return call("request_affiliate_payout", {
            p_amount: Number(amount),
            p_payment_method: paymentMethod,
            p_payment_account: paymentAccount
        });
    }

    window.GamBasketAffiliate = {
        getVisitorToken,
        getVisitorId: getVisitorToken,
        getReferral,
        getStoredReferral: getReferral,
        getAffiliateProfile,
        createAffiliateProfile,
        createProductLink,
        buildProductLink,
        shareLink,
        trackReferral,
        attachAttribution,
        getCurrentAttribution,
        getAttribution: getCurrentAttribution,
        recordConversion,
        recordOrderConversion: recordConversion,
        getDashboard,
        clearReferral,
        getMyLinks,
        getCommissions,
        requestPayout
    };
})();
