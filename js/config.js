/* =========================================================
   JULADIRECT — PRODUCTION APPLICATION CONFIGURATION
   (Safe Public Frontend Configuration for The Gambia)
========================================================= */

(function () {
    "use strict";

    window.GAMBASKET_CONFIG = {
        // Production Supabase Project Configuration
        SUPABASE_URL: "https://iwxcepbwmnnkxocskopx.supabase.co",
        
        // Supabase Client Key (CURRENT sb_publishable key from Supabase Settings → API Keys)
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_LYlQsw2QbUqUTPcrYiTAtg_6hwDQ92Z",

        // Cloudinary signed product uploads. The API key and API secret stay in
        // Supabase Edge Function secrets; only the public cloud name and preset are here.
        CLOUDINARY_CLOUD_NAME: "jx9bpjdb",
        CLOUDINARY_UPLOAD_PRESET: "juladirect_product_images",

        isCloudinaryConfigured: function () {
            return Boolean(
                this.CLOUDINARY_CLOUD_NAME &&
                /^[a-zA-Z0-9_-]+$/.test(this.CLOUDINARY_CLOUD_NAME) &&
                this.CLOUDINARY_UPLOAD_PRESET &&
                /^[a-zA-Z0-9_-]+$/.test(this.CLOUDINARY_UPLOAD_PRESET)
            );
        },

        // App Metadata
        APP_NAME: "JulaDirect",
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
