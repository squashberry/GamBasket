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
                    const { data: profile } = await client
                        .from("profiles")
                        .select("*")
                        .eq("id", sellerId)
                        .maybeSingle();

                    if (profile) {
                        return {
                            id: sellerId,
                            name: profile.store_name || `${profile.first_name || "GamBasket"} ${profile.last_name || "Seller"}`.trim(),
                            description: profile.store_description || "Verified seller offering authentic Gambian goods and services.",
                            location: profile.area ? `${profile.area}, ${profile.region || "Greater Banjul"}` : (profile.region || "Greater Banjul"),
                            phone: profile.phone || "",
                            logo_url: profile.avatar_url || "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=300&q=80",
                            cover_url: profile.cover_url || "https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=1200&q=80",
                            status: "Verified",
                            rating: 4.9,
                            reviewsCount: 18
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

            if (session?.user && client) {
                try {
                    await client
                        .from("profiles")
                        .update({
                            store_name: storeData.name,
                            store_description: storeData.description,
                            updated_at: new Date().toISOString()
                        })
                        .eq("id", session.user.id);
                } catch (e) {
                    console.warn("[GamBasket Save Store DB]", e.message);
                }
            }

            localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify(storeData));
            window.dispatchEvent(new CustomEvent("gambasket:seller:store:update", { detail: storeData }));
            return { success: true };
        }
    };
})();
