/* ============================================================
   GAMBASKET — SELLER STOREFRONT MODULE
============================================================ */

(() => {
    "use strict";

    const STORE_STORAGE_KEY = "gambasket_seller_store";

    window.GamBasketSellerStore = {
        async getStore(sellerId) {
            const auth = window.GamBasketAuth;
            await auth.ready();
            const client = auth.getClient();

            if (sellerId && client) {
                try {
                    const { data: store, error } = await client
                        .from("stores")
                        .select("id,seller_id,name,description,category,logo_url,banner_url,location,phone,rating,total_sales,is_verified,is_active")
                        .eq("seller_id", sellerId)
                        .maybeSingle();
                    if (error) throw error;

                    if (store) {
                        return {
                            id: store.id,
                            seller_id: store.seller_id,
                            name: store.name || "GamBasket Store",
                            description: store.description || "Verified seller offering authentic Gambian goods and services.",
                            category: store.category || "",
                            location: store.location || "Greater Banjul",
                            phone: store.phone || "",
                            logo_url: store.logo_url || "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=300&q=80",
                            cover_url: store.banner_url || "https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=1200&q=80",
                            status: store.is_verified ? "Verified" : "Unverified",
                            rating: Number(store.rating || 0),
                            reviewsCount: 0
                        };
                    }
                } catch (e) {
                    console.warn("[GamBasket Store Fetch]", e.message);
                }
            }

            // Fallback to local profile/store config
            try {
                const raw = localStorage.getItem(STORE_STORAGE_KEY);
                if (raw) return JSON.parse(raw);
            } catch {}

            return {
                id: sellerId || "seller_1",
                name: "My GamBasket Store",
                description: "Welcome to our store. We provide high-quality verified electronics, fashion, and home essentials with fast nationwide delivery.",
                location: "Kairaba Avenue, Serrekunda",
                phone: "+220 700 0000",
                logo_url: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=300&q=80",
                cover_url: "https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=1200&q=80",
                status: "Verified",
                rating: 4.9,
                reviewsCount: 24
            };
        },

        async saveStore(storeData) {
            const auth = window.GamBasketAuth;
            await auth.ready();
            const session = await auth.getSession();
            const client = auth.getClient();

            if (!session?.user || !client) throw new Error("Sign in to save your store.");
            const { data, error } = await client.rpc("save_my_store", {
                p_name: String(storeData.name || "").trim(),
                p_description: storeData.description || null,
                p_category: storeData.category || null,
                p_logo_url: storeData.logo_url || null,
                p_banner_url: storeData.cover_url || storeData.banner_url || null,
                p_location: storeData.location || null,
                p_phone: storeData.phone || null
            });
            if (error) throw error;
            const saved = {
                ...storeData,
                id: data.id,
                seller_id: data.seller_id,
                name: data.name,
                description: data.description,
                category: data.category,
                location: data.location,
                phone: data.phone,
                logo_url: data.logo_url,
                cover_url: data.banner_url,
                status: data.is_verified ? "Verified" : "Unverified",
                rating: Number(data.rating || 0)
            };
            localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify(saved));
            window.dispatchEvent(new CustomEvent("gambasket:seller:store:update", { detail: saved }));
            return { success: true, store: saved };
        }
    };
})();
