/* =========================================================
   JULADIRECT — SELLER EARNINGS & MARKETPLACE FEES
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

        feeBox.innerHTML = `
            <div class="fee-success" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;padding:14px 18px;border-radius:14px;font-size:13px;margin-top:16px;">
                The 5% marketplace commission is deducted from eligible merchandise sales before seller earnings are released. Delivery charges are accounted for separately.
            </div>
        `;
    }

    function openGamBasketFeePayment(amount) {
        window.dispatchEvent(
            new CustomEvent("gambasket:pay-marketplace-fee", {
                detail: { amount }
            })
        );
        alert("Marketplace fee settlement of " + formatD(amount) + " initialized. Connect this to your JulaDirect payment gateway.");
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

            const commissionRate = 5;
            let grossSales = 0;
            let marketplaceFees = 0;
            const transactions = [];

            orders.forEach(order => {
                const total = Number(order.total_amount ?? order.total ?? 0);
                const deliveryFee = Number(order.delivery_fee || 0);
                const merchandiseSubtotal = Number(
                    order.subtotal ?? Math.max(0, total - deliveryFee)
                );
                const discount = Number(order.discount_amount ?? order.discount ?? 0);
                const merchandiseSales = Math.max(0, merchandiseSubtotal - discount);
                const status = String(order.order_status || order.status || "").toLowerCase();
                const cancelled = status === "cancelled";
                const fee = cancelled ? 0 : calculateMarketplaceFee(merchandiseSales, commissionRate);

                if (!cancelled) {
                    grossSales += merchandiseSales;
                    marketplaceFees += fee;
                }

                transactions.push({
                    id: order.id,
                    reference: "ORD-" + ((order.order_number || order.id || "").substring(0, 8).toUpperCase() || "ORDER"),
                    date: order.created_at || new Date().toISOString(),
                    type: "Marketplace sale",
                    orderNumber: order.order_number || ("#" + (order.id || "").substring(0, 6)),
                    gross: cancelled ? 0 : merchandiseSales,
                    fee,
                    status: cancelled ? "Cancelled" :
                        ["completed", "delivered"].includes(status) ? "Awaiting release" : "Pending delivery"
                });
            });

            return {
                grossSales,
                marketplaceFees,
                unpaidFee: 0,
                transactions
            };
        }
    };
})();
