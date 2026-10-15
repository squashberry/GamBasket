/* =========================================================
    GAMBASKET — AUTHENTICATION & AUTHORIZATION GUARD
    Workspace access is based on active public.user_roles rows.
    ========================================================= */

(() => {
    "use strict";

    const Guard = {

        async getSession() {
            if (!window.supabaseClient) {
                if (window.GamBasketAuth && typeof window.GamBasketAuth.getSession === "function") {
                    return await window.GamBasketAuth.getSession();
                }
                return null;
            }

            try {
                const {
                    data: { session },
                    error
                } = await window.supabaseClient.auth.getSession();

                if (error) {
                    console.error("Session error:", error);
                    return null;
                }

                return session;
            } catch (err) {
                console.error("Guard getSession:", err);
                return null;
            }
        },

        async getUserProfile(userId) {
            if (!userId) return null;
            const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
            if (!client) return { id: userId };

            try {
                const { data: authResult, error: authError } = await client.auth.getUser();
                if (authError) throw authError;
                const currentUser = authResult?.user;
                if (!currentUser || currentUser.id !== userId) {
                    return { id: userId };
                }
                const { data, error } = await client
                    .from("profiles")
                    .select("*")
                    .eq("id", currentUser.id)
                    .maybeSingle();
                if (error) throw error;
                return data || { id: currentUser.id };
            } catch (err) {
                console.error("Profile lookup error:", err.message);
                return { id: userId };
            }
        },

        normalizeRole(profile) {
            if (!profile) return null;

            return (
                profile.role ||
                profile.user_role ||
                profile.account_role ||
                null
            )?.toLowerCase() || null;
        },

        async getAuthContext() {
            const session = await this.getSession();

            if (!session?.user) {
                return null;
            }

            const profile = await this.getUserProfile(session.user.id);
            const roles = window.GamBasketAuth && typeof window.GamBasketAuth.getUserRoles === "function"
                ? await window.GamBasketAuth.getUserRoles()
                : [];
            const role = roles[0] || null;

            return {
                session,
                user: session.user,
                profile,
                roles,
                role,
                isAdmin: roles.includes("admin")
            };
        },

        roleAllowsWorkspace(role, requiredRole) {
            if (!requiredRole) {
                return true;
            }

            const req = requiredRole.toLowerCase();
            const cur = (role || "").toLowerCase();

            return cur === req;
        },

        async gatePage(requiredRole) {
            const context = await this.getAuthContext();

            if (!context) {
                this.redirectToLogin();
                return false;
            }

            if (context.roles.includes(requiredRole) || context.roles.includes("admin")) {
                window.GamBasketAuthContext = context;
                const gate = document.getElementById("authGate");
                const content = document.getElementById("protectedContent") || document.getElementById("sellerProtectedContent");
                if (gate) {
                    gate.hidden = true;
                    gate.style.display = "none";
                }
                if (content) {
                    content.hidden = false;
                    content.style.display = "";
                }
                return true;
            }

            this.showUnauthorized();
            return false;
        },

        redirectToLogin() {
            const current = window.location.pathname + window.location.search;

            const login =
                window.location.pathname.includes("/supplier/") ||
                window.location.pathname.includes("/admin/") ||
                window.location.pathname.includes("/delivery/") ||
                window.location.pathname.includes("/worker/")
                    ? "../login.html"
                    : "login.html";

            window.location.href = login + "?redirect=" + encodeURIComponent(current);
        },

        showUnauthorized() {
            document.body.innerHTML = `
                <main
                    style="
                        min-height:100vh;
                        display:grid;
                        place-items:center;
                        padding:30px;
                        text-align:center;
                        background:var(--bg, #f8fafc);
                        color:var(--text, #0f172a);
                        font-family:system-ui, -apple-system, sans-serif;
                    "
                >
                    <div>
                        <div style="font-size:64px;margin-bottom:20px;">🔒</div>
                        <h1 style="font-size:24px;font-weight:800;margin-bottom:10px;">Access restricted</h1>
                        <p style="color:#64748b;margin-bottom:24px;max-width:400px;line-height:1.5;">
                            Your account does not have permission to access this workspace.
                        </p>
                        <a href="../index.html" class="primary-btn" style="
                            display:inline-block;
                            padding:12px 24px;
                            background:#2563eb;
                            color:#fff;
                            border-radius:12px;
                            text-decoration:none;
                            font-weight:700;
                        ">
                            Return to GamBasket
                        </a>
                    </div>
                </main>
            `;
        },

        requireAuth(actionName, onAuthenticated) {
            this.getAuthContext().then(ctx => {
                if (ctx?.user) {
                    if (typeof onAuthenticated === "function") onAuthenticated(ctx.user);
                } else {
                    this.redirectToLogin();
                }
            });
        },

        navigateProtected(href) {
            this.getAuthContext().then(ctx => {
                if (ctx?.user) {
                    window.location.href = href;
                } else {
                    const login = window.location.pathname.includes("/supplier/") ? "../login.html" : "login.html";
                    window.location.href = login + "?redirect=" + encodeURIComponent(href);
                }
            });
        }
    };

    window.GamBasketGuard = Guard;
    window.navigateProtectedPage = function (destination) {
        if (window.GamBasketGuard) {
            return window.GamBasketGuard.navigateProtected(destination);
        }
        window.location.href = destination;
    };
})();
