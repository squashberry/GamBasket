(() => {
    "use strict";
    const getClient = () => window.GamBasketBusiness?.getClient?.() || window.supabaseClient || window.GamBasketAuth?.getClient?.();
    const sum = (rows, column) => rows.reduce((total, row) => total + Number(row[column] || 0), 0);

    async function loadSellerAnalytics(userId) {
        const client = getClient();
        const [productsRes, ordersRes] = await Promise.all([
            client.from("products").select("id,title,views_count,sales_count,price,status", { count: "exact" }).eq("seller_id", userId),
            client.from("orders").select("id,subtotal,total,order_status,created_at", { count: "exact" }).eq("seller_id", userId)
        ]);
        if (productsRes.error) throw productsRes.error;
        if (ordersRes.error) throw ordersRes.error;
        const products = productsRes.data || [], orders = ordersRes.data || [];
        const views = sum(products, "views_count"), sales = sum(products, "sales_count");
        return { products, orders, revenue: sum(orders, "subtotal"), views, sales, conversionRate: views ? sales / views * 100 : 0 };
    }

    async function loadSupplierAnalytics(userId) {
        const client = getClient();
        const { data: products, error } = await client.from("products").select("id,title,views_count,sales_count,wholesale_price,min_order_quantity,listing_type,status").eq("seller_id", userId).in("listing_type", ["wholesale", "both"]);
        if (error) throw error;
        const listings = products || [];
        return { products: listings, wholesaleProducts: listings.length, views: sum(listings, "views_count"), sales: sum(listings, "sales_count"), averageWholesalePrice: listings.length ? sum(listings, "wholesale_price") / listings.length : 0, averageMinimumOrder: listings.length ? sum(listings, "min_order_quantity") / listings.length : 0 };
    }
    window.GamBasketBusinessAnalytics = { loadSellerAnalytics, loadSupplierAnalytics };
})();
