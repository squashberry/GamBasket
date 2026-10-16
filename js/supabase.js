/* =========================================================
   GAMBASKET — SUPABASE CLIENT ADAPTER & PRODUCTION AUTH SYSTEM
   
   CRITICAL ARCHITECTURAL RULES:
   1. Exactly ONE browser Supabase client across the entire app.
   2. Authentication state is determined ONLY by real Supabase sessions.
   3. Auto-token refresh, persistence, and OAuth detection are enabled.
   4. No localStorage fake users, fake auth flags, or hardcoded names.
========================================================= */

(function () {
    "use strict";

    // Dynamically load network.js if not already present
    if (!window.GamBasketNetwork) {
        const script = document.createElement("script");
        const path = window.location.pathname;
        let prefix = "js/";
        if (path.includes("/supplier/") || path.includes("/delivery/") ||
            path.includes("/worker/") || path.includes("/admin/")) {
            prefix = "../js/";
        }
        script.src = prefix + "network.js";
        script.async = false;
        document.head.appendChild(script);
    }

    if (!window.__gambasketOfflineHandlingReady) {
        window.gambasketGoOffline = () => {
            if (window.GamBasketNetwork) {
                window.GamBasketNetwork.handleRequestFailure(new Error("Supabase manual trigger"));
            }
        };
        window.__gambasketOfflineHandlingReady = true;
    }

    let supabaseClient = null;
    let currentSession = null;
    let currentUser = null;
    let currentProfile = null;
    let currentUserRoles = [];
    let currentWishlistSet = new Set();
    const currentProductsById = new Map();
    let isInitialized = false;
    const authListeners = [];

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    }

    // Master initialization promise
    let initPromise = null;

    /**
     * Ensures the Supabase JS CDN script is loaded and available.
     * Returns a Promise that resolves with window.supabase.
     */
    function ensureSupabaseLibrary() {
        if (window.supabase && typeof window.supabase.createClient === "function") {
            return Promise.resolve(window.supabase);
        }

        return new Promise((resolve, reject) => {
            const scriptId = "supabase-js-cdn";
            let script = document.getElementById(scriptId);

            if (!script) {
                script = document.createElement("script");
                script.id = scriptId;
                script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
                script.async = true;

                script.onload = () => {
                    if (window.supabase && typeof window.supabase.createClient === "function") {
                        resolve(window.supabase);
                    } else {
                        reject(new Error("Supabase library object not found after script load"));
                    }
                };

                script.onerror = () => {
                    console.warn("[GamBasket] Failed to load Supabase JS library from CDN.");
                    reject(new Error("Failed to load Supabase JS library from CDN"));
                };

                document.head.appendChild(script);
            } else {
                // Script already injected, poll for window.supabase
                const startTime = Date.now();
                const pollInterval = setInterval(() => {
                    if (window.supabase && typeof window.supabase.createClient === "function") {
                        clearInterval(pollInterval);
                        resolve(window.supabase);
                    } else if (Date.now() - startTime > 10000) {
                        clearInterval(pollInterval);
                        reject(new Error("Timeout waiting for Supabase JS library"));
                    }
                }, 30);
            }
        });
    }

    /**
     * Initializes the single Supabase client and sets up the central auth state lifecycle.
     */
    async function initializeAuthSystem() {
        const config = window.GAMBASKET_CONFIG;
        if (!config || !config.isConfigured()) {
            console.warn("[GamBasket] Supabase config not configured or missing.");
            isInitialized = true;
            return { session: null, user: null, profile: null, roles: [] };
        }

        const clientKey = (config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY || "").trim();
        if (!config.SUPABASE_URL || !clientKey) {
            console.warn("[GamBasket] Supabase URL or client key missing.");
            isInitialized = true;
            return { session: null, user: null, profile: null, roles: [] };
        }

        try {
            await ensureSupabaseLibrary();
        } catch (err) {
            console.warn("[GamBasket] Could not load Supabase library:", err.message);
            isInitialized = true;
            return { session: null, user: null, profile: null, roles: [] };
        }

        if (!supabaseClient && window.supabase && typeof window.supabase.createClient === "function") {
            try {
                supabaseClient = window.supabase.createClient(
                    config.SUPABASE_URL,
                    clientKey,
                    {
                        auth: {
                            persistSession: true,
                            autoRefreshToken: true,
                            detectSessionInUrl: true
                        }
                    }
                );
            } catch (err) {
                console.warn("[GamBasket] Supabase Client Initialization Error:", err.message);
            }
        }

        if (!supabaseClient) {
            isInitialized = true;
            return { session: null, user: null, profile: null, roles: [] };
        }

        // Temporary safe diagnostics logging (prefix only, never secret)
        const keyPrefix = clientKey.substring(0, Math.min(15, clientKey.length)) + "...";
        console.log("[GamBasket Supabase Active]", {
            url: config.SUPABASE_URL,
            keyPrefix: keyPrefix,
            keyLength: clientKey.length
        });

        // Set up the authoritative auth state change listener
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            console.log(`[GamBasket Auth Event] ${event}`, session?.user?.email || "(no session)");
            currentSession = session;
            currentUser = session ? session.user : null;

            if (event === "SIGNED_OUT") {
                currentProfile = null;
                currentUserRoles = [];
                // Clear any legacy localStorage auth remnants
                localStorage.removeItem("gambasket_logged_in");
                localStorage.removeItem("gambasket_user");
                localStorage.removeItem("gambasket_user_email");
                localStorage.removeItem("gambasket_pending_user");
            } else if (currentUser) {
                // Ensure profile & roles for active user
                try {
                    await GamBasketAuth.fetchUserProfile(true);
                    await GamBasketAuth.getUserRoles();
                    await GamBasketAuth.refreshWishlistCache();
                } catch (e) {
                    console.warn("[GamBasket] Profile refresh notice:", e.message);
                }
            }

            // Notify all registered listener callbacks
            authListeners.forEach(listener => {
                try {
                    listener(event, session);
                } catch (listenerErr) {
                    console.error("[GamBasket Auth Listener Error]", listenerErr);
                }
            });

            // Dispatch global event on window for DOM reactivity
            window.dispatchEvent(new CustomEvent("gambasket:auth:change", {
                detail: {
                    event: event,
                    session: currentSession,
                    user: currentUser,
                    profile: currentProfile,
                    roles: currentUserRoles
                }
            }));
        });

        // Retrieve initial session
        isInitialized = true;
        try {
            const { data, error } = await supabaseClient.auth.getSession();
            if (!error && data && data.session) {
                currentSession = data.session;
                currentUser = data.session.user;
                try {
                    await GamBasketAuth.fetchUserProfile(true);
                    await GamBasketAuth.getUserRoles();
                    await GamBasketAuth.refreshWishlistCache();
                } catch (pe) {
                    console.warn("[GamBasket] Profile init notice:", pe.message);
                }
            } else {
                currentSession = null;
                currentUser = null;
                currentProfile = null;
                currentUserRoles = [];
            }
        } catch (err) {
            console.warn("[GamBasket] Error fetching initial session:", err.message);
            currentSession = null;
            currentUser = null;
        }

        return {
            session: currentSession,
            user: currentUser,
            profile: currentProfile,
            roles: currentUserRoles
        };
    }

    // =========================================================
    // GamBasket Auth & Storage API
    // =========================================================
    const GamBasketAuth = {
        /**
         * Resolves when the Supabase client and initial auth state are fully ready.
         * Every page must await this promise before deciding guest vs authenticated states.
         * @returns {Promise<{session: Object|null, user: Object|null, profile: Object|null, roles: string[]}>}
         */
        ready: function () {
            if (isInitialized) {
                return Promise.resolve({
                    session: currentSession,
                    user: currentUser,
                    profile: currentProfile,
                    roles: currentUserRoles
                });
            }
            if (!initPromise) {
                initPromise = initializeAuthSystem();
            }
            return initPromise;
        },

        /**
         * Direct access to the singleton Supabase client.
         */
        getClient: function () {
            return supabaseClient;
        },

        /**
         * Checks whether Supabase config is valid.
         */
        isConfigured: function () {
            return window.GAMBASKET_CONFIG && window.GAMBASKET_CONFIG.isConfigured();
        },

        /**
         * Get Current Supabase Session.
         * Always waits for auth system readiness first.
         * @returns {Promise<Object|null>}
         */
        getSession: async function () {
            if (!isInitialized) await this.ready();
            if (currentSession !== undefined && currentSession !== null) return currentSession;
            if (!supabaseClient) return null;

            try {
                const { data, error } = await supabaseClient.auth.getSession();
                if (error || !data || !data.session) {
                    currentSession = null;
                    return null;
                }
                currentSession = data.session;
                currentUser = data.session.user;
                return currentSession;
            } catch (err) {
                return currentSession;
            }
        },

        /**
         * Get Current Authenticated User.
         * Always waits for auth system readiness first.
         * @returns {Promise<Object|null>}
         */
        getUser: async function () {
            if (currentUser) return currentUser;
            if (!isInitialized) await this.ready();
            if (currentUser) return currentUser;
            if (!supabaseClient) return null;

            try {
                const { data: { user }, error } = await supabaseClient.auth.getUser();
                if (error || !user) {
                    currentUser = null;
                    return null;
                }
                currentUser = user;
                return user;
            } catch (err) {
                return currentUser;
            }
        },

        /**
         * Returns true ONLY when a valid authenticated Supabase session exists.
         * @returns {Promise<boolean>}
         */
        isAuthenticated: async function () {
            const session = await this.getSession();
            return Boolean(session && session.user);
        },

        /**
         * Action-level authentication guard.
         * If authenticated, calls onAuthenticated(user). If guest, displays sign-in prompt modal.
         * @param {string} actionName - Human-readable action description
         * @param {Function} onAuthenticated - Callback if authenticated
         */
        requireAuth: async function (actionName, onAuthenticated) {
            if (window.GamBasketGuard && typeof window.GamBasketGuard.requireAuth === "function") {
                return window.GamBasketGuard.requireAuth(actionName, onAuthenticated);
            }
            const user = await this.getUser();
            if (user) {
                if (typeof onAuthenticated === "function") onAuthenticated(user);
            } else {
                const redirect = encodeURIComponent(window.location.href);
                window.location.href = `login.html?redirect=${redirect}`;
            }
        },

        /**
         * Helper: Extract name details from metadata (handles Google OAuth & standard signup).
         */
        extractUserNames: function (user) {
            const meta = (user && user.user_metadata) || {};
            let firstName = meta.first_name || meta.given_name || "";
            let lastName = meta.last_name || meta.family_name || "";

            if (!firstName && (meta.full_name || meta.name)) {
                const full = String(meta.full_name || meta.name).trim();
                const spaceIdx = full.indexOf(" ");
                if (spaceIdx > 0) {
                    firstName = full.substring(0, spaceIdx);
                    lastName = full.substring(spaceIdx + 1);
                } else {
                    firstName = full;
                    lastName = "";
                }
            }

            if (!firstName && !lastName) {
                firstName = "User";
                lastName = "";
            }

            return {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                avatarUrl: meta.avatar_url || meta.picture || ""
            };
        },

        /**
         * Ensure Profile and Roles exist after authentication (especially for Google OAuth).
         */
        ensureProfileAndRoles: async function (user) {
            if (!user || !user.id) return null;
            await this.ready();
            const client = this.getClient();
            if (!client) return null;

            try {
                // The database owns profile creation and the default buyer role.
                // This avoids client-side role writes and works with private profile RLS.
                const { error } = await client.rpc("bootstrap_my_profile");
                if (error) throw error;
                return await this.fetchUserProfile(true);
            } catch (err) {
                console.warn("[GamBasket] ensureProfileAndRoles notice:", err.message);
                return null;
            }
        },

        /**
         * Fetch User Profile with country permanently locked to The Gambia.
         */
        fetchUserProfile: async function (forceRefresh = false) {
            if (currentProfile && !forceRefresh) return currentProfile;
            const user = currentUser || (await this.getUser());
            if (!user) return null;

            const names = this.extractUserNames(user);
            const client = this.getClient();

            if (!client || !user.id) {
                // Fallback to auth metadata
                currentProfile = {
                    first_name: names.firstName,
                    last_name: names.lastName,
                    email: user.email,
                    phone: (user.user_metadata && user.user_metadata.phone) || "",
                    country: "The Gambia",
                    region: (user.user_metadata && user.user_metadata.region) || "Greater Banjul",
                    area: (user.user_metadata && user.user_metadata.area) || "",
                    avatar_url: names.avatarUrl
                };
                return currentProfile;
            }

            try {
                const { data, error } = await client
                    .from("profiles")
                    .select("*")
                    .eq("id", user.id)
                    .single();

                if (error || !data) {
                    currentProfile = {
                        first_name: names.firstName,
                        last_name: names.lastName,
                        email: user.email,
                        phone: (user.user_metadata && user.user_metadata.phone) || "",
                        country: "The Gambia",
                        region: (user.user_metadata && user.user_metadata.region) || "Greater Banjul",
                        area: (user.user_metadata && user.user_metadata.area) || "",
                        avatar_url: names.avatarUrl
                    };
                    return currentProfile;
                }

                currentProfile = data;
                return currentProfile;
            } catch (err) {
                return null;
            }
        },

        /**
         * Fetch Active Capabilities / Roles for Current User.
         */
                getUserRoles: async function () {
            const user = await this.getUser();
            if (!user) return [];

            const client = this.getClient();
            if (!client || !user.id) {
                currentUserRoles = [];
                return currentUserRoles;
            }

            try {
                const { data, error } = await client
                    .from("user_roles")
                    .select("role_id, is_active")
                    .eq("user_id", user.id)
                    .eq("is_active", true);

                if (!error && data) {
                    currentUserRoles = data.map(r => r.role_id).filter(Boolean);
                    return currentUserRoles;
                }
            } catch (err) {
                console.warn("[GamBasket Roles Fetch Notice]", err.message);
            }

            currentUserRoles = [];
            return currentUserRoles;
        },

        /**
         * Check if the user has a specific active capability.
         */
        hasRole: async function (roleName) {
            const roles = await this.getUserRoles();
            if (!roleName) return false;
            return roles.includes(roleName) || roles.includes("admin");
        },

        /**
         * Register a callback for auth state changes across the application.
         * Returns an object with an unsubscribe() method.
         */
        onAuthStateChange: function (callback) {
            if (typeof callback !== "function") return { unsubscribe: () => {} };

            authListeners.push(callback);

            // If already initialized, call callback immediately with current state
            if (isInitialized) {
                try {
                    callback(currentSession ? "INITIAL_SESSION" : "SIGNED_OUT", currentSession);
                } catch (e) {
                    console.error("[GamBasket onAuthStateChange Error]", e);
                }
            }

            return {
                unsubscribe: () => {
                    const idx = authListeners.indexOf(callback);
                    if (idx > -1) authListeners.splice(idx, 1);
                }
            };
        },

        /**
         * Sign Up with permanent The Gambia country lock.
         */
        signUp: async function ({ email, password, firstName, lastName, phone, region, area }) {
            await this.ready();
            const client = this.getClient();
            if (!client) {
                return {
                    data: null,
                    error: { message: "GamBasket is temporarily unable to connect. Please try again shortly." }
                };
            }

            try {
                const { data, error } = await client.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            first_name: firstName,
                            last_name: lastName,
                            phone: phone,
                            country: "The Gambia",
                            region: region || "Greater Banjul",
                            area: area || ""
                        }
                    }
                });

                if (error) throw error;
                return { data, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        },

        /**
         * Sign In with Email and Password.
         */
        signIn: async function ({ email, password }) {
            await this.ready();
            const client = this.getClient();
            if (!client) {
                return {
                    data: null,
                    error: { message: "GamBasket is temporarily unable to connect. Please try again shortly." }
                };
            }

            try {
                const { data, error } = await client.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;
                currentSession = data.session;
                currentUser = data.user;
                await this.fetchUserProfile(true);
                await this.getUserRoles();
                return { data, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        },

        /**
         * Sign In with OAuth (Google Provider).
         */
        signInWithOAuth: async function (provider = "google", redirectDestination = "") {
            await this.ready();
            const client = this.getClient();
            if (!client) {
                return {
                    data: null,
                    error: { message: "GamBasket is temporarily unable to connect. Please try again shortly." }
                };
            }

            try {
                let callbackUrl = window.location.origin + "/auth/callback.html";
                if (redirectDestination) {
                    const safeDest = window.GamBasketGuard && window.GamBasketGuard.getSafeRedirect
                        ? window.GamBasketGuard.getSafeRedirect(redirectDestination)
                        : redirectDestination;
                    callbackUrl += "?redirect=" + encodeURIComponent(safeDest);
                }

                const { data, error } = await client.auth.signInWithOAuth({
                    provider: provider,
                    options: {
                        redirectTo: callbackUrl
                    }
                });

                if (error) throw error;
                return { data, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        },

        /**
         * Sign Out.
         */
        signOut: async function () {
            await this.ready();
            const client = this.getClient();
            if (client) {
                try {
                    await client.auth.signOut();
                } catch (e) {
                    console.warn("[GamBasket] Sign out notice:", e);
                }
            }

            currentSession = null;
            currentUser = null;
            currentProfile = null;
            currentUserRoles = [];

            // Clear legacy localStorage keys
            localStorage.removeItem("gambasket_logged_in");
            localStorage.removeItem("gambasket_user");
            localStorage.removeItem("gambasket_user_email");
            localStorage.removeItem("gambasket_pending_user");
            localStorage.removeItem("gambasket_user_roles");

            return { error: null };
        },

        /**
         * Password Reset Request.
         */
        resetPasswordForEmail: async function (email) {
            await this.ready();
            const client = this.getClient();
            if (!client) {
                return { data: null, error: { message: "GamBasket is temporarily unable to connect." } };
            }

            try {
                const { data, error } = await client.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin + "/reset-password.html"
                });
                if (error) throw error;
                return { data, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        },

        /**
         * Update Password.
         */
        updatePassword: async function (newPassword) {
            await this.ready();
            const client = this.getClient();
            if (!client) {
                return { data: null, error: { message: "GamBasket is temporarily unable to connect." } };
            }

            try {
                const { data, error } = await client.auth.updateUser({
                    password: newPassword
                });
                if (error) throw error;
                return { data, error: null };
            } catch (err) {
                return { data: null, error: err };
            }
        },

        /**
         * Diagnostics tester for browser console.
         */
        testDiagnostics: async function () {
            await this.ready();
            const config = window.GAMBASKET_CONFIG || {};
            const clientKey = (config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY || "").trim();
            const diagnostics = {
                url: config.SUPABASE_URL,
                keyExists: Boolean(clientKey),
                keyPrefix: clientKey ? clientKey.substring(0, Math.min(15, clientKey.length)) + "..." : "none",
                keyLength: clientKey.length,
                isInitialized: isInitialized,
                hasSession: Boolean(currentSession),
                userEmail: currentUser ? currentUser.email : null
            };
            console.log("[GamBasket Auth Diagnostics]", diagnostics);
            return diagnostics;
        },

        /**
         * Real File Upload to Supabase Storage with size and type validation.
         */
        
        /* =========================================================
           MASTER CATALOG & PRODUCT RESOLUTION
        ========================================================= */
        getCatalog: function () {
            // Do not display fabricated demo items as real marketplace inventory.
            return [];
        },
        getProductById: function (id) {
            if (!id) return null;
            const productId = String(id);
            if (currentProductsById.has(productId)) return currentProductsById.get(productId);
            const strId = productId.replace(/^p-/, "");
            const catalog = this.getCatalog();
            return catalog.find(p => p.id === strId || p.id === productId || ("p-" + p.id) === productId) || null;
        },

        cacheProductRow: function (row) {
            if (!row || !isUuid(row.id)) return null;
            const product = {
                id: row.id,
                name: row.title || row.name || "Marketplace Product",
                price: Number(row.price || 0),
                currency: row.currency || "GMD",
                category: row.category_id || row.category || "General",
                location: row.location || "The Gambia",
                condition: row.condition || "New",
                image: row.main_image || row.image || "",
                images: Array.isArray(row.images) ? row.images : [],
                attributes: row.attributes && typeof row.attributes === "object" ? row.attributes : {},
                stock: Number(row.stock || 0),
                sales_count: Number(row.sales_count || 0),
                created_at: row.created_at || null,
                seller_id: row.seller_id || null,
                seller: row.seller || row.store_name || "GamBasket member",
                seller_type: row.seller_type === "business" ? "business" : "individual",
                seller_verified: Boolean(row.seller_verified),
                delivery_available: row.delivery_available === true,
                fulfillment_type: row.fulfillment_type || null,
                store_name: row.store_name || null,
                description: row.description || ""
            };
            currentProductsById.set(String(product.id), product);
            return product;
        },

        isPersistableProductId: function (productId) {
            return isUuid(productId);
        },

        getProducts: async function () {
            await this.ready();
            const client = this.getClient();
            if (!client) return [];

            try {
                const { data, error } = await client
                    .from("products")
                    .select("*")
                    .eq("status", "approved")
                    .order("created_at", { ascending: false });

                if (error || !Array.isArray(data)) return [];
                if (!data.length) return [];

                const sellerIds = [...new Set(data.map(row => row.seller_id).filter(id => isUuid(id)))];
                const publicBadges = new Map();
                if (sellerIds.length) {
                    try {
                        const { data: badgeRows, error: badgeError } = await client
                            .from("public_profiles")
                            .select("id,business_name,seller_type,is_seller_verified,has_business_store")
                            .in("id", sellerIds);
                        if (!badgeError) (badgeRows || []).forEach(row => publicBadges.set(row.id, row));
                    } catch (badgeError) {
                        console.warn("[GamBasket seller badges]", badgeError?.message);
                    }
                }

                return data.map(row => {
                    const badge = publicBadges.get(row.seller_id) || null;
                    return this.cacheProductRow({
                        ...row,
                        seller: badge?.business_name || "GamBasket member",
                        seller_type: badge?.seller_type === "business" ? "business" : "individual",
                        seller_verified: Boolean(badge?.is_seller_verified),
                        store_name: badge?.business_name || null
                    });
                }).filter(Boolean);
            } catch (err) {
                console.warn("[GamBasket] Product query warning:", err.message);
                return [];
            }
        },

        /* =========================================================
           AUTHORITATIVE WISHLIST DATA LAYER (SUPABASE BACKED)
        ========================================================= */
        getWishlist: async function () {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                return { data: [], count: 0, error: null, isGuest: true };
            }

            const userId = session.user.id;
            const client = this.getClient();

            try {
                if (client) {
                    const { data, error } = await client
                        .from("wishlist_items")
                        .select("id, product_id, created_at, product:products(*)")
                        .eq("user_id", userId)
                        .order("created_at", { ascending: false });

                    if (!error && Array.isArray(data)) {
                        currentWishlistSet = new Set(data.map(r => String(r.product_id)).filter(isUuid));
                        const localKey = "gambasket_wishlist_" + userId;
                        localStorage.setItem(localKey, JSON.stringify(Array.from(currentWishlistSet)));

                        const items = data.filter(row => isUuid(row.product_id)).map(row => {
                            const prod = row.product ? this.cacheProductRow(row.product) : this.getProductById(row.product_id);
                            return prod || {
                                id: String(row.product_id),
                                name: "Marketplace Product",
                                price: 0,
                                category: "General",
                                location: "The Gambia",
                                condition: "New",
                                image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80"
                            };
                        });
                        return { data: items, count: items.length, error: null, isGuest: false };
                    }
                }
            } catch (err) {
                console.warn("[GamBasket] Wishlist query warning:", err.message);
            }

            // Scoped fallback
            const localKey = "gambasket_wishlist_" + userId;
            const localSaved = JSON.parse(localStorage.getItem(localKey) || localStorage.getItem("gambasket-wishlist") || "[]");
            currentWishlistSet = new Set(localSaved.map(id => String(id)).filter(isUuid));
            const items = Array.from(currentWishlistSet).map(id => this.getProductById(id)).filter(Boolean);
            return { data: items, count: items.length, error: null, isGuest: false };
        },

        refreshWishlistCache: async function () {
            try {
                const session = await this.getSession();
                if (!session || !session.user) {
                    currentWishlistSet.clear();
                    return;
                }
                const userId = session.user.id;
                const client = this.getClient();
                if (client) {
                    const { data, error } = await client
                        .from("wishlist_items")
                        .select("product_id")
                        .eq("user_id", userId);
                    if (!error && Array.isArray(data)) {
                        currentWishlistSet = new Set(data.map(r => String(r.product_id)).filter(isUuid));
                        const localKey = "gambasket_wishlist_" + userId;
                        localStorage.setItem(localKey, JSON.stringify(Array.from(currentWishlistSet)));
                        return;
                    }
                }
                const localKey = "gambasket_wishlist_" + userId;
                const localSaved = JSON.parse(localStorage.getItem(localKey) || "[]");
                currentWishlistSet = new Set(localSaved.map(id => String(id)).filter(isUuid));
            } catch (e) {
                console.warn("[GamBasket] Wishlist cache refresh notice:", e.message);
            }
        },

        addToWishlist: async function (productId) {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                if (window.GamBasketGuard && typeof window.GamBasketGuard.requireAuth === "function") {
                    window.GamBasketGuard.requireAuth("save products to your wishlist");
                } else {
                    window.location.href = "login.html?redirect=" + encodeURIComponent(window.location.href);
                }
                return { success: false, error: "UNAUTHENTICATED", requiresAuth: true };
            }

            const client = this.getClient();
            const userId = session.user.id;
            const cleanId = String(productId);
            if (!isUuid(cleanId)) {
                return { success: false, error: "INVALID_PRODUCT_ID" };
            }

            // Optimistic UI state
            currentWishlistSet.add(cleanId);
            const localKey = "gambasket_wishlist_" + userId;
            localStorage.setItem(localKey, JSON.stringify(Array.from(currentWishlistSet)));

            window.dispatchEvent(new CustomEvent("gambasket:wishlist:change", {
                detail: { productId: cleanId, isSaved: true, userId }
            }));

            try {
                if (client) {
                    const { error } = await client
                        .from("wishlist_items")
                        .upsert({
                            user_id: userId,
                            product_id: cleanId
                        }, { onConflict: "user_id,product_id" });

                    if (error && error.code !== "23505") {
                        console.warn("[GamBasket] Add to wishlist DB notice:", error.message);
                    }
                }
            } catch (err) {
                console.warn("[GamBasket] Add to wishlist exception:", err.message);
            }

            return { success: true, isSaved: true };
        },

        removeFromWishlist: async function (productId) {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                return { success: false, error: "UNAUTHENTICATED", requiresAuth: true };
            }

            const client = this.getClient();
            const userId = session.user.id;
            const cleanId = String(productId);
            if (!isUuid(cleanId)) {
                return { success: false, error: "INVALID_PRODUCT_ID" };
            }

            // Optimistic UI state
            currentWishlistSet.delete(cleanId);
            const localKey = "gambasket_wishlist_" + userId;
            localStorage.setItem(localKey, JSON.stringify(Array.from(currentWishlistSet)));

            window.dispatchEvent(new CustomEvent("gambasket:wishlist:change", {
                detail: { productId: cleanId, isSaved: false, userId }
            }));

            try {
                if (client) {
                    await client
                        .from("wishlist_items")
                        .delete()
                        .eq("user_id", userId)
                        .eq("product_id", cleanId);
                }
            } catch (err) {
                console.warn("[GamBasket] Remove from wishlist DB notice:", err.message);
            }

            return { success: true, isSaved: false };
        },

        isInWishlist: function (productId) {
            if (!productId) return false;
            const cleanId = String(productId);
            return currentWishlistSet.has(cleanId);
        },

        isProductSaved: function (productId) {
            if (!productId) return false;
            const cleanId = String(productId);
            return currentWishlistSet.has(cleanId);
        },

        toggleWishlist: async function (productId) {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                if (window.GamBasketGuard && typeof window.GamBasketGuard.requireAuth === "function") {
                    window.GamBasketGuard.requireAuth("save products to your wishlist");
                } else {
                    window.location.href = "login.html?redirect=" + encodeURIComponent(window.location.href);
                }
                return { success: false, requiresAuth: true };
            }

            const cleanId = String(productId);
            const currentlySaved = currentWishlistSet.has(cleanId);

            if (currentlySaved) {
                return await this.removeFromWishlist(cleanId);
            } else {
                return await this.addToWishlist(cleanId);
            }
        },

        /* =========================================================
           REALTIME MESSAGING DATA LAYER
        ========================================================= */
        getConversations: async function () {
            await this.ready();
            const session = await this.getSession();
            const client = this.getClient();
            if (!session?.user || !client) return { items: [] };
            const { data, error } = await client
                .from("conversations")
                .select("id, product_id, order_id, created_at, updated_at, product:products(id, title, price, stock, status, main_image)")
                .order("updated_at", { ascending: false });
            if (error) throw error;
            const conversations = [];
            for (const conversation of data || []) {
                const { data: members, error: memberError } = await client
                    .from("conversation_participants")
                    .select("user_id, last_read_at")
                    .eq("conversation_id", conversation.id);
                if (memberError) throw memberError;
                const other = (members || []).find(member => member.user_id !== session.user.id);
                let otherProfile = null;
                if (other?.user_id) {
                    const { data: safeProfile, error: profileError } = await client
                        .from("public_profiles")
                        .select("id, first_name, last_name")
                        .eq("id", other.user_id)
                        .maybeSingle();
                    if (profileError) throw profileError;
                    otherProfile = safeProfile;
                }
                const { data: lastMessages, error: messageError } = await client
                    .from("messages")
                    .select("message_text, created_at, sender_id, is_read")
                    .eq("conversation_id", conversation.id)
                    .order("created_at", { ascending: false })
                    .limit(1);
                if (messageError) throw messageError;
                const lastMessage = lastMessages?.[0] || null;
                const { count, error: unreadError } = await client
                    .from("messages")
                    .select("id", { count: "exact", head: true })
                    .eq("conversation_id", conversation.id)
                    .neq("sender_id", session.user.id)
                    .eq("is_read", false);
                if (unreadError) throw unreadError;
                conversations.push({
                    id: conversation.id,
                    product_id: conversation.product_id,
                    product: conversation.product,
                    other_user_name: `${otherProfile?.first_name || "GamBasket"} ${otherProfile?.last_name || "Member"}`.trim(),
                    last_message: lastMessage?.message_text || "Start the conversation",
                    last_message_at: lastMessage?.created_at || conversation.updated_at || conversation.created_at,
                    unread_count: count || 0
                });
            }
            return { items: conversations };
        },

        startConversation: async function (productId) {
            await this.ready();
            const { data, error } = await this.getClient().rpc("start_product_conversation", { p_product_id: productId });
            if (error) throw error;
            return { conversation: data };
        },

        getConversation: async function (conversationId) {
            await this.ready();
            const client = this.getClient();
            const { data: conversation, error } = await client
                .from("conversations")
                .select("id, product_id, order_id, created_at, updated_at, product:products(id, title, price, stock, status, main_image)")
                .eq("id", conversationId)
                .single();
            if (error) throw error;
            const messages = await this.getConversationMessages(conversationId);
            const session = await this.getSession();
            const { data: members, error: memberError } = await client
                .from("conversation_participants")
                .select("user_id")
                .eq("conversation_id", conversationId);
            if (memberError) throw memberError;
            const other = (members || []).find(member => member.user_id !== session?.user?.id);
            let otherProfile = null;
            if (other?.user_id) {
                const { data: safeProfile, error: profileError } = await client
                    .from("public_profiles")
                    .select("id, first_name, last_name")
                    .eq("id", other.user_id)
                    .maybeSingle();
                if (profileError) throw profileError;
                otherProfile = safeProfile;
            }
            return { conversation: { ...conversation, other_user_name: `${otherProfile?.first_name || "GamBasket"} ${otherProfile?.last_name || "Member"}`.trim() }, messages, product: conversation.product };
        },

        getConversationMessages: async function (conversationId) {
            await this.ready();
            const { data, error } = await this.getClient()
                .from("messages")
                .select("id, conversation_id, sender_id, message_text, is_read, created_at")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: true });
            if (error) throw error;
            return { messages: (data || []).map(message => ({ ...message, content: message.message_text })) };
        },

        sendMessage: async function (conversationId, content) {
            await this.ready();
            const session = await this.getSession();
            if (!session?.user || !String(content || "").trim()) throw new Error("INVALID_MESSAGE");
            const { data, error } = await this.getClient()
                .from("messages")
                .insert({ conversation_id: conversationId, sender_id: session.user.id, message_text: String(content).trim().slice(0, 4000) })
                .select("id, conversation_id, sender_id, message_text, is_read, created_at")
                .single();
            if (error) throw error;
            return { message: { ...data, content: data.message_text } };
        },

        markConversationRead: async function (conversationId) {
            const { error } = await this.getClient().rpc("mark_conversation_read", { p_conversation_id: conversationId });
            if (error) throw error;
            return { success: true };
        },

        subscribeToConversation: function (conversationId, onMessage, onError) {
            const client = this.getClient();
            if (!client) return null;
            const channel = client.channel(`gambasket-conversation-${conversationId}`)
                .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, payload => onMessage({ ...payload.new, content: payload.new.message_text }))
                .subscribe(status => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(); });
            return channel;
        },

        /* =========================================================
           AUTHORITATIVE CART DATA LAYER (SUPABASE BACKED)
        ========================================================= */
        getCart: async function () {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                return { items: [], isGuest: true, error: null };
            }

            const client = this.getClient();
            if (!client) return { items: [], isGuest: false, error: new Error("Cart service unavailable") };

            const { data, error } = await client
                .from("cart_items")
                .select("id, product_id, quantity, product:products(id, title, price, stock, main_image, seller_id, location, status)")
                .eq("user_id", session.user.id)
                .order("created_at", { ascending: true });

            if (error) throw error;
            return { items: (data || []).filter(item => item.product), isGuest: false, error: null };
        },

        addToCart: async function (productId, quantity = 1) {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                return { success: false, requiresAuth: true, error: "UNAUTHENTICATED" };
            }
            if (!isUuid(productId) || Number(quantity) < 1) {
                return { success: false, error: "INVALID_CART_ITEM" };
            }
            const client = this.getClient();
            if (!client) return { success: false, error: "CART_SERVICE_UNAVAILABLE" };

            const { data: product, error: productError } = await client
                .from("products")
                .select("id, stock, status")
                .eq("id", productId)
                .maybeSingle();
            if (productError) throw productError;
            if (!product || product.status !== "approved") {
                return { success: false, error: "INSUFFICIENT_STOCK" };
            }

            const { data: existing, error: existingError } = await client
                .from("cart_items")
                .select("quantity")
                .eq("user_id", session.user.id)
                .eq("product_id", productId)
                .maybeSingle();
            if (existingError) throw existingError;
            const nextQuantity = Number(existing?.quantity || 0) + Number(quantity);
            if (product.stock < nextQuantity) {
                return { success: false, error: "INSUFFICIENT_STOCK" };
            }

            const { data, error } = await client
                .from("cart_items")
                .upsert({ user_id: session.user.id, product_id: productId, quantity: nextQuantity, updated_at: new Date().toISOString() }, { onConflict: "user_id,product_id" })
                .select("id, product_id, quantity")
                .single();
            if (error) throw error;
            window.dispatchEvent(new CustomEvent("gambasket:cart:change"));
            return { success: true, item: data };
        },

        resolveProductId: async function (productId, productTitle = "") {
            if (isUuid(productId)) return String(productId);
            await this.ready();
            const client = this.getClient();
            if (!client || !productTitle) return null;
            const { data, error } = await client.from("products").select("id").eq("title", productTitle).eq("status", "approved").maybeSingle();
            if (error) throw error;
            return data?.id || null;
        },

        updateCartItem: async function (productId, quantity) {
            await this.ready();
            const session = await this.getSession();
            const client = this.getClient();
            if (!session?.user || !client || !isUuid(productId)) throw new Error("Cart update unavailable");
            if (Number(quantity) <= 0) return this.removeCartItem(productId);
            const { error } = await client.from("cart_items").update({ quantity: Number(quantity), updated_at: new Date().toISOString() }).eq("user_id", session.user.id).eq("product_id", productId);
            if (error) throw error;
            window.dispatchEvent(new CustomEvent("gambasket:cart:change"));
            return { success: true };
        },

        removeCartItem: async function (productId) {
            await this.ready();
            const session = await this.getSession();
            const client = this.getClient();
            if (!session?.user || !client || !isUuid(productId)) throw new Error("Cart removal unavailable");
            const { error } = await client.from("cart_items").delete().eq("user_id", session.user.id).eq("product_id", productId);
            if (error) throw error;
            window.dispatchEvent(new CustomEvent("gambasket:cart:change"));
            return { success: true };
        },

        clearCart: async function () {
            await this.ready();
            const session = await this.getSession();
            const client = this.getClient();
            if (!session?.user || !client) throw new Error("Cart clearing unavailable");
            const { error } = await client.from("cart_items").delete().eq("user_id", session.user.id);
            if (error) throw error;
            window.dispatchEvent(new CustomEvent("gambasket:cart:change"));
            return { success: true };
        },

        validateCoupon: async function (code, subtotal = 0) {
            await this.ready();
            const client = this.getClient();
            if (!client) throw new Error("Coupon service unavailable");
            const { data, error } = await client.rpc("validate_coupon", { p_code: code, p_subtotal: Number(subtotal) });
            if (error) throw error;
            return data || null;
        },

        createOrder: async function (payload) {
            await this.ready();
            const session = await this.getSession();
            const client = this.getClient();
            if (!session?.user || !client) throw new Error("UNAUTHENTICATED");
            const cart = await this.getCart();
            const items = cart.items.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) }));
            if (!items.length) throw new Error("CART_EMPTY");
            const { data, error } = await client.rpc("create_order", {
                p_items: items,
                p_fulfillment_type: payload.fulfillment_type,
                p_delivery_address: payload.delivery_address || null,
                p_delivery_region: payload.delivery_region || null,
                p_delivery_area: payload.delivery_area || null,
                p_delivery_phone: payload.delivery_phone || null,
                p_delivery_instructions: payload.delivery_instructions || null,
                p_payment_method: payload.payment_method || "cash_on_delivery",
                p_coupon_code: payload.coupon_code || null
            });
            if (error) throw error;
            window.dispatchEvent(new CustomEvent("gambasket:orders:change", { detail: { order: data } }));
            return { order: data, error: null };
        },

        /* =========================================================
           AUTHORITATIVE ORDERS DATA LAYER (SUPABASE BACKED)
        ========================================================= */
        getOrders: async function () {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                return { data: [], count: 0, error: null, isGuest: true };
            }

            const client = this.getClient();
            const userId = session.user.id;

            try {
                if (client) {
                    const { data, error } = await client
                        .from("orders")
                        .select("id, order_number, fulfillment_type, delivery_address, delivery_area, delivery_phone, subtotal, delivery_fee, total, currency, payment_status, payment_method, order_status, created_at, order_items(id, product_id, title, price, quantity, subtotal)")
                        .eq("buyer_id", userId)
                        .order("created_at", { ascending: false });

                    if (!error && Array.isArray(data)) {
                        const formatted = data.map(order => ({
                            order_id: order.id,
                            id: order.order_number || order.id,
                            status: order.order_status || "pending",
                            created_at: order.created_at,
                            fulfillment_type: order.fulfillment_type || "delivery",
                            address: order.delivery_address || "",
                            area: order.delivery_area || "Greater Banjul",
                            payment_method: order.payment_method || "cash_on_delivery",
                            payment_status: order.payment_status || "pending",
                            total_amount: order.total || order.subtotal || 0,
                            items: (order.order_items || []).map(it => ({
                                id: it.product_id,
                                name: it.title,
                                price: it.price,
                                quantity: it.quantity
                            }))
                        }));
                        return { data: formatted, count: formatted.length, error: null, isGuest: false };
                    }
                }
            } catch (err) {
                console.warn("[GamBasket] Orders query notice:", err.message);
                return { data: [], count: 0, error: err, isGuest: false };
            }

            return { data: [], count: 0, error: new Error("Orders service unavailable"), isGuest: false };
        },

        cancelOrder: async function (orderId) {
            await this.ready();
            const session = await this.getSession();
            if (!session || !session.user) {
                return { success: false, error: "UNAUTHENTICATED" };
            }

            const client = this.getClient();
            if (!client) return { success: false, error: "ORDER_SERVICE_UNAVAILABLE" };

            try {
                const { data, error } = await client.rpc("cancel_order", {
                    p_order_number: String(orderId)
                });
                if (error) throw error;
                window.dispatchEvent(new CustomEvent("gambasket:orders:change", {
                    detail: { orderId, status: data?.order_status || "cancelled", order: data }
                }));
                return { success: true, order: data };
            } catch (err) {
                console.warn("[GamBasket] Order cancellation failed:", err.message);
                return { success: false, error: err };
            }
        },

        uploadImage: async function (file, folder = "product-images") {
            if (!file) throw new Error("No file selected.");

            const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
            const contentType = String(file.type || "").toLowerCase();
            if (!allowedTypes.includes(contentType)) {
                throw new Error("Invalid image type. Please select a JPG, PNG, WEBP, or GIF image.");
            }
            if (file.size > 5 * 1024 * 1024) {
                throw new Error("Image file is too large. Maximum allowed size is 5MB.");
            }

            await this.ready();
            const session = await this.getSession();
            const client = this.getClient();
            if (!session?.user || !client) throw new Error("Sign in before uploading product images.");

            const config = window.GAMBASKET_CONFIG || {};
            if (config.isCloudinaryConfigured?.()) {
                const cloudName = config.CLOUDINARY_CLOUD_NAME;
                const uploadPreset = config.CLOUDINARY_UPLOAD_PRESET;
                const safeFolder = String(folder || "products")
                    .replace(/[^a-zA-Z0-9/_-]/g, "")
                    .replace(/^\/+|\/+$/g, "") || "products";
                const payload = new FormData();
                payload.append("file", file);
                payload.append("upload_preset", uploadPreset);
                payload.append("folder", `gambasket/${safeFolder}`);
                const response = await fetch(
                    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
                    { method: "POST", body: payload }
                );
                let result = null;
                try { result = await response.json(); } catch {}
                if (!response.ok || !result?.secure_url) {
                    throw new Error(result?.error?.message || `Image upload failed (HTTP ${response.status}).`);
                }
                return result.secure_url;
            }

            // Default to the project's public Supabase Storage bucket. This works
            // without an external media account and restricts uploads to the user's
            // own UUID-prefixed folder through Storage RLS.
            const extensions = {
                "image/jpeg": "jpg",
                "image/png": "png",
                "image/webp": "webp",
                "image/gif": "gif"
            };
            const safeFolder = String(folder || "products")
                .split("/")
                .map(part => part.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40))
                .filter(Boolean)
                .slice(0, 3)
                .join("/") || "products";
            const filename = `${Date.now()}_${crypto.randomUUID()}.${extensions[contentType]}`;
            const objectPath = `${session.user.id}/${safeFolder}/${filename}`;
            const { data, error } = await client.storage
                .from("product-images")
                .upload(objectPath, file, {
                    cacheControl: "31536000",
                    contentType,
                    upsert: false
                });
            if (error) throw new Error(error.message || "The image could not be uploaded.");
            const { data: publicData } = client.storage.from("product-images").getPublicUrl(data.path);
            if (!publicData?.publicUrl) throw new Error("Image uploaded, but its public URL could not be created.");
            return publicData.publicUrl;
        }
    };

    /**
     * Globally updates all desktop navigation headers with the true real-time auth state.
     * Prevents login/signup buttons from showing when a user is already authenticated.
     */
    async function syncGlobalHeaders() {
        const actionContainers = document.querySelectorAll(
            ".desktop-app-actions, .desktop-auth-actions, #desktopAuthActions"
        );
        if (!actionContainers || !actionContainers.length) return;

        let isLoggedIn = false;
        let displayName = "";

        try {
            await GamBasketAuth.ready();
            const session = await GamBasketAuth.getSession();
            if (session && session.user) {
                isLoggedIn = true;
                const profile = await GamBasketAuth.fetchUserProfile();
                const user = session.user;
                displayName = (profile && profile.first_name) 
                    ? profile.first_name 
                    : (user.user_metadata?.full_name || user.email?.split("@")[0] || "My Account");
            }
        } catch (e) {
            console.warn("[GamBasket] Header auth sync notice:", e.message);
        }

        actionContainers.forEach(container => {
            if (isLoggedIn) {
                container.innerHTML = `
                    <button class="icon-button" id="desktopThemeToggle" aria-label="Toggle dark mode" type="button" title="Toggle theme">
                        <svg class="ui-icon" viewBox="0 0 24 24" fill="none"><path d="M20 15.2A8.3 8.3 0 0 1 8.8 4a8.3 8.3 0 1 0 11.2 11.2Z" stroke="currentColor" stroke-width="1.8"/></svg>
                    </button>
                    ${document.getElementById("gbCartDrawer") 
                        ? `<button class="icon-button gb-cart-trigger" id="gbCartTrigger" type="button" aria-label="Open cart" aria-expanded="false" title="Shopping Cart" style="text-decoration:none;">
                            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            <span class="gb-cart-count" id="gbCartCount">0</span>
                        </button>`
                        : `<a href="cart.html" class="icon-button" aria-label="Cart" title="Shopping Cart" style="text-decoration:none;">
                            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </a>`
                    }
                    <a href="me.html" class="btn-signup" style="font-size: 12px; padding: 7px 16px; background: #2563eb; color: #ffffff; border-radius: 10px; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
                        <svg class="ui-icon" style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-3.6 3.1-5.5 7-5.5s6.4 1.9 7 5.5"/></svg>
                        <span>${displayName}</span>
                    </a>
                `;
            } else {
                container.innerHTML = `
                    <button class="icon-button" id="desktopThemeToggle" aria-label="Toggle dark mode" type="button" title="Toggle theme">
                        <svg class="ui-icon" viewBox="0 0 24 24" fill="none"><path d="M20 15.2A8.3 8.3 0 0 1 8.8 4a8.3 8.3 0 1 0 11.2 11.2Z" stroke="currentColor" stroke-width="1.8"/></svg>
                    </button>
                    ${document.getElementById("gbCartDrawer") 
                        ? `<button class="icon-button gb-cart-trigger" id="gbCartTrigger" type="button" aria-label="Open cart" aria-expanded="false" title="Shopping Cart" style="text-decoration:none;">
                            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            <span class="gb-cart-count" id="gbCartCount">0</span>
                        </button>`
                        : `<a href="cart.html" class="icon-button" aria-label="Cart" title="Shopping Cart" style="text-decoration:none;">
                            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </a>`
                    }
                    <a href="login.html" class="btn-login" style="color:var(--text);text-decoration:none;font-size:13px;font-weight:600;padding:8px 16px;border-radius:10px;border:1px solid var(--border);">Log In</a>
                    <a href="signup.html" class="btn-signup" style="background:#2563eb;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:8px 18px;border-radius:10px;">Create Account</a>
                `;
            }
        });
    }

    // Expose sync method on GamBasketAuth
    GamBasketAuth.updateGlobalHeaders = syncGlobalHeaders;

    // Universal Dark Mode Toggle System
    function updateThemeIcons() {
        const isDark = document.documentElement.classList.contains("dark");
        document.querySelectorAll("#themeIcon").forEach(icon => {
            icon.innerHTML = `<use href="#icon-${isDark ? "sun" : "moon"}"></use>`;
        });
        document.querySelectorAll("#desktopThemeToggle svg, #themeToggle svg").forEach(svg => {
            if (!svg.id && !svg.querySelector("use")) {
                svg.innerHTML = isDark 
                    ? `<circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
                    : `<path d="M20 15.2A8.3 8.3 0 0 1 8.8 4a8.3 8.3 0 1 0 11.2 11.2Z" stroke="currentColor" stroke-width="1.8"/>`;
            }
        });
    }

    function toggleTheme() {
        const isDark = document.documentElement.classList.toggle("dark");
        localStorage.setItem("gambasket-theme", isDark ? "dark" : "light");
        updateThemeIcons();
        window.dispatchEvent(new CustomEvent("gambasket:theme:change", { detail: { isDark } }));
    }

    document.addEventListener("click", function (event) {
        const themeBtn = event.target.closest("#themeToggle, #desktopThemeToggle, [data-action='toggle-theme'], .theme-toggle");
        if (themeBtn) {
            event.preventDefault();
            event.stopPropagation();
            toggleTheme();
        }
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", updateThemeIcons);
    } else {
        updateThemeIcons();
    }
    window.addEventListener("gambasket:theme:change", updateThemeIcons);

    // Automatically sync headers on ready, auth changes, and DOMContentLoaded
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", syncGlobalHeaders);
    } else {
        syncGlobalHeaders();
        if (window.GamBasketCartDrawer) window.GamBasketCartDrawer.updateCount();
    }
    window.addEventListener("gambasket:auth:change", syncGlobalHeaders);

    // Expose GamBasketAuth globally immediately
    window.GamBasketAuth = GamBasketAuth;

    // Start auto-initialization immediately
    GamBasketAuth.ready().then(syncGlobalHeaders);
})();
