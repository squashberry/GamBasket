/* Read-only growth data helpers. Affiliate tooling remains in its existing modules. */
(() => {
    "use strict";
    const client = () => window.GamBasketBusiness?.getClient?.() || window.supabaseClient || window.GamBasketAuth?.getClient?.();
    const isLive = row => {
        const now = Date.now();
        return (!row.starts_at || new Date(row.starts_at).getTime() <= now) && (!row.ends_at || new Date(row.ends_at).getTime() >= now);
    };

    async function loadFeaturedProducts({ placement = "home", limit = 12 } = {}) {
        const { data, error } = await client().from("featured_products").select("id,placement,priority,starts_at,ends_at,products(id,title,price,currency,main_image,status,listing_type,wholesale_price,min_order_quantity)").eq("status", "active").eq("placement", placement).order("priority", { ascending: false }).limit(limit);
        if (error) throw error;
        return (data || []).filter(row => row.products && isLive(row));
    }
    async function loadActiveCampaigns() {
        const { data, error } = await client().from("marketplace_campaigns").select("*").eq("is_active", true).order("starts_at");
        if (error) throw error;
        return (data || []).filter(isLive);
    }
    async function loadProductPromotions(productId) {
        const { data, error } = await client().from("product_promotions").select("seller_promotions(*)").eq("product_id", productId);
        if (error) throw error;
        return (data || []).map(row => row.seller_promotions).filter(Boolean).filter(promotion => promotion.is_active && isLive(promotion));
    }
    async function loadNotifications(limit = 30) {
        const activeClient = client();
        const { data: { user } } = await activeClient.auth.getUser();
        if (!user) return [];
        const { data, error } = await activeClient.from("growth_notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(limit);
        if (error) throw error;
        return data || [];
    }
    async function markNotificationRead(id) {
        const { error } = await client().from("growth_notifications").update({ is_read: true }).eq("id", id);
        if (error) throw error;
    }
    window.GamBasketGrowth = { loadFeaturedProducts, loadActiveCampaigns, loadProductPromotions, loadNotifications, markNotificationRead };
})();
