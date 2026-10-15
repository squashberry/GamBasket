/* ============================================================
   GAMBASKET — SELLER SETTINGS MODULE
============================================================ */

(() => {
    "use strict";

    const SETTINGS_KEY = "gambasket_seller_settings";

    window.GamBasketSellerSettings = {
        getSettings() {
            try {
                const raw = localStorage.getItem(SETTINGS_KEY);
                return raw ? JSON.parse(raw) : this.defaultSettings();
            } catch {
                return this.defaultSettings();
            }
        },

        defaultSettings() {
            return {
                notifications: {
                    newOrder: true,
                    buyerMessage: true,
                    productApproved: true,
                    productRejected: true,
                    lowStock: true,
                    payoutUpdate: true
                },
                orderPreferences: {
                    autoConfirm: false,
                    deliveryEnabled: true,
                    pickupEnabled: true
                },
                store: {
                    displayName: "GamBasket Merchant",
                    supportPhone: "+220 700 0000",
                    location: "Greater Banjul"
                }
            };
        },

        saveSettings(newSettings) {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
            return { success: true };
        }
    };
})();
