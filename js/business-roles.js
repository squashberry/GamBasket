/* Shared role and listing helpers for GamBasket business workspaces. */
(() => {
    "use strict";

    const getClient = () => window.supabaseClient || window.gambasketSupabase || window.supabase || window.sb || window.GamBasketAuth?.getClient?.();

    async function getCurrentRoles() {
        const client = getClient();
        if (!client) return [];
        const { data: { user } } = await client.auth.getUser();
        if (!user) return [];
        const { data, error } = await client.from("user_roles").select("role_id,is_active").eq("user_id", user.id).eq("is_active", true);
        if (error) throw error;
        return (data || []).map(row => row.role_id);
    }

    async function hasRole(role) {
        return (await getCurrentRoles()).includes(role);
    }

    async function getBusinessProfile(preferredType = null) {
        const client = getClient();
        if (!client) return { type: "buyer", roles: [], profile: null };
        const { data: { user } } = await client.auth.getUser();
        if (!user) return { type: "guest", roles: [], profile: null };
        const roles = await getCurrentRoles();
        const type = preferredType === "supplier" && roles.includes("supplier")
            ? "supplier"
            : preferredType === "seller" && roles.includes("seller")
                ? "seller"
                : roles.includes("supplier") ? "supplier" : roles.includes("seller") ? "seller" : "buyer";
        if (type === "buyer") return { type, roles, profile: null };
        const { data, error } = await client.from(`${type}_profiles`).select("*").eq("user_id", user.id).maybeSingle();
        if (error) throw error;
        return { type, roles, profile: data };
    }

    function getProductBusinessMode(product = {}) {
        const listingType = product.listing_type || (product.wholesale_enabled ? "wholesale" : "retail");
        const wholesale = listingType === "wholesale" || listingType === "both";
        const retail = listingType === "retail" || listingType === "both";
        const minimumOrderQuantity = Number(product.min_order_quantity || product.minimum_order_quantity || 1);
        return { retail, wholesale, showWholesale: wholesale && minimumOrderQuantity > 1, minimumOrderQuantity };
    }

    window.GamBasketBusiness = { getClient, getCurrentRoles, hasRole, getBusinessProfile, getProductBusinessMode };
})();
