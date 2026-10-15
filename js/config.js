/* =========================================================
   GAMBASKET — PRODUCTION APPLICATION CONFIGURATION
   (Safe Public Frontend Configuration for The Gambia)
========================================================= */

(function () {
    "use strict";

    window.GAMBASKET_CONFIG = {
        // Production Supabase Project Configuration
        SUPABASE_URL: "https://iwxcepbwmnnkxocskopx.supabase.co",
        
        // Supabase Client Key (CURRENT sb_publishable key from Supabase Settings → API Keys)
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_LYlQsw2QbUqUTPcrYiTAtg_6hwDQ92Z",

        // Cloudinary unsigned uploads. Fill these from Cloudinary Dashboard after
        // creating a restricted unsigned upload preset; never put an API secret here.
        CLOUDINARY_CLOUD_NAME: "",
        CLOUDINARY_UPLOAD_PRESET: "",

        isCloudinaryConfigured: function () {
            return Boolean(
                this.CLOUDINARY_CLOUD_NAME &&
                /^[a-zA-Z0-9_-]+$/.test(this.CLOUDINARY_CLOUD_NAME) &&
                this.CLOUDINARY_UPLOAD_PRESET &&
                /^[a-zA-Z0-9_-]+$/.test(this.CLOUDINARY_UPLOAD_PRESET)
            );
        },

        // App Metadata
        APP_NAME: "GamBasket",
        TAGLINE: "The Digital Marketplace of The Gambia",
        COUNTRY: "The Gambia",
        CURRENCY_CODE: "GMD",
        CURRENCY_SYMBOL: "D",
        DEFAULT_DELIVERY_FEE: 100, // D 100 standard delivery fee in Greater Banjul
        
        // Configuration check
        isConfigured: function () {
            return Boolean(
                this.SUPABASE_URL && 
                this.SUPABASE_URL.startsWith("https://") && 
                this.SUPABASE_PUBLISHABLE_KEY && 
                this.SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")
            );
        }
    };
})();
