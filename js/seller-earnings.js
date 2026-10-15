/* =========================================================
   GAMBASKET — SELLER EARNINGS & MARKETPLACE FEES
   ========================================================= */

(() => {
    "use strict";

    function calculateMarketplaceFee(saleAmount, commissionRate = 5) {
        const amount = Number(saleAmount || 0);
        const rate = Number(commissionRate || 0);
        return Math.round(amount * (rate / 100) * 100) / 100;
    }

    function formatD(value) {
        return "D " + Number(value || 0).toLocaleString();
    }

    function renderSellerEarnings(summary = {}) {
        const gross = Number(summary.grossSales || 0);
        const estimatedFee = Number(summary.marketplaceFees || summary.marketplaceFee || 0);
        const unpaidFee = Number(summary.unpaidFee || 0);

        const grossEl = document.getElementById("grossSales") || document.getElementById("sellerGrossSales");
        const feeEl = document.getElementById("marketplaceFees") || document.getElementById("sellerFees");

        if (grossEl) grossEl.textContent = formatD(gross);
        if (feeEl) feeEl.textContent = formatD(estimatedFee);

        const feeBox = document.getElementById("unpaidFeeBox");
        if (!feeBox) return;

        if (unpaidFee > 0) {
            feeBox.innerHTML = `
                <div class="fee-warning" style="display:flex;justify-content:space-between;align-items:center;background:#fef2f2;border:1px solid #fecaca;padding:16px 20px;border-radius:16px;margin-top:16px;">
                    <div>
                        <strong style="color:#991b1b;display:block;font-size:14px;margin-bottom:2px;">
                            GamBasket marketplace fee pending
                        </strong>
                        <span style="color:#b91c1c;font-size:13px;">
                            You have ${formatD(unpaidFee)} in marketplace fees to settle.
                        </span>
                    </div>

                    <button
                        type="button"
                        class="primary-btn"
                        id="payMarketplaceFeeBtn"
                        style="background:#dc2626;color:#fff;border:0;padding:10px 18px;border-radius:10px;font-weight:700;cursor:pointer;"
                    >
                        Pay Now
                    </button>
                </div>
            `;

            document.getElementById("payMarketplaceFeeBtn")?.addEventListener("click", () => {
                openGamBasketFeePayment(unpaidFee);
            });
        } else {
            feeBox.innerHTML = `
                <div class="fee-success" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:14px 18px;border-radius:14px;font-size:13px;font-weight:600;margin-top:16px;">
                    ✓ No outstanding GamBasket marketplace fees
                </div>
            `;
        }
    }

    function openGamBasketFeePayment(amount) {
        window.dispatchEvent(
            new CustomEvent("gambasket:pay-marketplace-fee", {
                detail: { amount }
            })
        );
        alert("Marketplace fee settlement of " + formatD(amount) + " initialized. Connect this to your GamBasket payment gateway.");
    }

    window.GamBasketSellerEarnings = {
        calculateMarketplaceFee,
        formatD,
        renderSellerEarnings,
        openGamBasketFeePayment,

        async getFinancialSummary() {
            let orders = [];
            if (window.GamBasketSellerOrders && typeof window.GamBasketSellerOrders.list === "function") {
                const res = await window.GamBasketSellerOrders.list();
                orders = res?.items || [];
            }

            const seller = window.GamBasketSeller?.currentSeller;
            const plan = window.GamBasketSeller?.getCurrentPlan(seller) || { commissionRate: 5 };
            const promo = await window.GamBasketSeller?.getActivePromotion();
            const promoCovers = promo && window.GamBasketSeller?.promotionCoversSubscription(promo);

            let grossSales = 0;
            const transactions = [];

            orders.forEach(order => {
                const total = Number(order.total_amount || order.total || 0);
                const status = (order.status || "").toLowerCase();

                if (status !== "cancelled") {
                    grossSales += total;
                }

                const fee = promoCovers ? 0 : calculateMarketplaceFee(total, plan.commissionRate);

                transactions.push({
                    id: order.id,
                    reference: "TXN-" + ((order.id || "").substring(0, 8).toUpperCase() || "ORD"),
                    date: order.created_at || new Date().toISOString(),
                    type: promoCovers ? "Promotion Sale" : "Standard Sale",
                    orderNumber: order.order_number || ("#" + (order.id || "").substring(0, 6)),
                    gross: total,
                    fee: fee,
                    status: status === "completed" || status === "delivered" ? "Cleared" : "Pending"
                });
            });

            const marketplaceFees = promoCovers ? 0 : calculateMarketplaceFee(grossSales, plan.commissionRate);

            return {
                grossSales,
                marketplaceFees,
                unpaidFee: 0,
                transactions
            };
        }
    };
})();
