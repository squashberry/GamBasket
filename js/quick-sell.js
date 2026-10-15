/* =========================================================
   GAMBASKET — QUICK SELL
   List a personal item without a business subscription
   ========================================================= */

(() => {
    "use strict";

    const QUICK_SELL_FEE = 7;

    const form = document.getElementById("quickSellForm");

    if (!form) return;

    form.addEventListener("submit", async event => {
        event.preventDefault();

        let user = null;
        if (window.supabaseClient) {
            const authUser = await window.supabaseClient.auth.getUser();
            user = authUser?.data?.user;
        } else if (window.GamBasketAuth) {
            user = await window.GamBasketAuth.getUser();
        }

        if (!user) {
            window.location.href = "login.html?redirect=quick-sell.html";
            return;
        }

        const name = document.getElementById("quickSellName").value.trim();
        const price = Number(document.getElementById("quickSellPrice").value);
        const description = document.getElementById("quickSellDescription").value.trim();

        if (!name || !price || !description) {
            return;
        }

        const estimatedFee = price * (QUICK_SELL_FEE / 100);
        const estimatedSellerAmount = price - estimatedFee;
        const condition = document.getElementById("quickSellCondition")?.value || "Used - Good";
        const suppliedImage = document.getElementById("quickSellImage")?.value.trim() || "";
        const location = document.getElementById("quickSellLocation")?.value.trim() || "Greater Banjul";

        const confirmed = confirm(
            "Quick Sell fee: " + QUICK_SELL_FEE + "%\n\n" +
            "Item price: D " + price.toLocaleString() + "\n" +
            "Estimated GamBasket fee: D " + estimatedFee.toLocaleString() + "\n" +
            "Estimated amount after fee: D " + estimatedSellerAmount.toLocaleString() + "\n\n" +
            "Continue?"
        );

        if (!confirmed) return;

        const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
        if (!client) {
            alert("GamBasket could not connect to the listing service. Your item was not submitted.");
            return;
        }

        try {
            const profile = await window.GamBasketAuth?.fetchUserProfile?.();
            const listingLocation = location || [profile?.area, profile?.region].filter(Boolean).join(", ") || "Greater Banjul";
            const { error } = await client
                .from("products")
                .insert({
                    title: name,
                    price,
                    currency: "GMD",
                    description,
                    condition,
                    stock: 1,
                    status: "pending_review",
                    seller_id: user.id,
                    location: listingLocation,
                    main_image: suppliedImage || "https://images.unsplash.com/photo-1603899122634-f086ca5f5ddd?auto=format&fit=crop&w=800&q=80",
                    created_at: new Date().toISOString()
                });
            if (error) throw error;

            alert("Your Quick Sell listing has been submitted for marketplace review! It will stay private until approved.");
            window.location.href = "index.html";
        } catch (err) {
            console.error("Quick Sell submission failed:", err);
            const message = /seller or supplier role required|seller.*role|row-level security/i.test(err.message || "")
                ? "Your account is not enabled to sell yet. Complete seller verification or contact GamBasket support before submitting a listing."
                : (err.message || "The item could not be submitted. Please check the details and try again.");
            alert(message);
        }
    });
})();
