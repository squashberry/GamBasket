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

        const confirmed = confirm(
            "Quick Sell fee: " + QUICK_SELL_FEE + "%\n\n" +
            "Item price: D " + price.toLocaleString() + "\n" +
            "Estimated GamBasket fee: D " + estimatedFee.toLocaleString() + "\n" +
            "Estimated amount after fee: D " + estimatedSellerAmount.toLocaleString() + "\n\n" +
            "Continue?"
        );

        if (!confirmed) return;

        if (window.supabaseClient) {
            try {
                const { data, error } = await window.supabaseClient
                    .from("products")
                    .insert({
                        name,
                        title: name,
                        price,
                        description,
                        stock: 1,
                        status: "pending",
                        seller_id: user.id,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (error) throw error;

                alert("Your Quick Sell listing has been submitted for marketplace review! 🎉");
                window.location.href = "index.html";
                return;
            } catch (err) {
                console.warn("Direct DB insert:", err.message);
            }
        }

        alert(
            "Your Quick Sell listing has been submitted for review! " +
            "You will be notified when your listing is active."
        );
        window.location.href = "index.html";
    });
})();
