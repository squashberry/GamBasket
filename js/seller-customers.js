/* ============================================================
   GAMBASKET — SELLER CUSTOMERS MODULE
============================================================ */

(() => {
    "use strict";

    window.GamBasketSellerCustomers = {
        async list() {
            const { items: orders } = await window.GamBasketSellerOrders.list();
            const customersMap = new Map();

            orders.forEach(order => {
                const custName = order.delivery_name || order.shipping_name || order.customer_name || "Customer";
                const custKey = custName.toLowerCase().trim();
                const total = Number(order.total_amount || order.total || 0);
                const date = order.created_at || new Date().toISOString();

                if (!customersMap.has(custKey)) {
                    customersMap.set(custKey, {
                        name: custName,
                        orderCount: 0,
                        totalSpent: 0,
                        lastOrderDate: date,
                        recentOrders: [],
                        location: order.delivery_area || order.delivery_region || "The Gambia",
                        phone: order.delivery_phone ? order.delivery_phone.substring(0, 4) + "****" : ""
                    });
                }

                const cust = customersMap.get(custKey);
                cust.orderCount += 1;
                cust.totalSpent += total;
                if (new Date(date) > new Date(cust.lastOrderDate)) {
                    cust.lastOrderDate = date;
                }
                cust.recentOrders.push(order);
            });

            return Array.from(customersMap.values());
        }
    };
})();
