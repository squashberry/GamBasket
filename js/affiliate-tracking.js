/* Captures inbound referrals and binds their visitor token after sign-in. */
(() => {
    "use strict";

    async function bindAuthenticatedVisitor() {
        if (!window.GamBasketAffiliate || !window.GamBasketAuth) return;
        await window.GamBasketAuth.ready();
        const session = await window.GamBasketAuth.getSession();
        if (session?.user) await window.GamBasketAffiliate.attachAttribution();
    }

    async function boot() {
        if (!window.GamBasketAffiliate) return;
        if (new URLSearchParams(window.location.search).has("ref")) {
            await window.GamBasketAffiliate.trackReferral();
        }
        await bindAuthenticatedVisitor();

        const client = window.GamBasketAuth?.getClient?.() || window.supabaseClient || window.gambasketSupabase;
        client?.auth?.onAuthStateChange((event, session) => {
            if (event === "SIGNED_IN" && session?.user) {
                window.GamBasketAffiliate.attachAttribution();
            }
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot().catch(console.warn));
    else boot().catch(console.warn);
})();
