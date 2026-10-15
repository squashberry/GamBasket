/* =========================================================
   GAMBasket SELLER CORE
   Phase 5 — Business Seller Architecture
   ========================================================= */

(() => {
    "use strict";

    const SellerSystem = {
        plans: {
            starter: {
                id: "starter",
                name: "Starter",
                monthlyFee: 300,
                commissionRate: 5,
                maxActiveProducts: 50,
                description: "For small businesses getting started."
            },

            business: {
                id: "business",
                name: "Business",
                monthlyFee: 750,
                commissionRate: 3.5,
                maxActiveProducts: 250,
                description: "For growing businesses."
            },

            professional: {
                id: "professional",
                name: "Professional",
                monthlyFee: 1500,
                commissionRate: 2.5,
                maxActiveProducts: 1000,
                description: "For established businesses."
            }
        },

        paymentMode: "direct",

        currentSeller: null,

        promotion: null,

        async init() {
            try {
                const user = await this.getCurrentUser();

                if (!user) {
                    this.currentSeller = null;
                    return null;
                }

                this.currentSeller = await this.getSellerProfile(user.id);

                return this.currentSeller;
            } catch (error) {
                console.error("SellerSystem.init:", error);
                return null;
            }
        },

        async getCurrentUser() {
            if (!window.supabaseClient) {
                if (window.GamBasketAuth && typeof window.GamBasketAuth.getUser === "function") {
                    return await window.GamBasketAuth.getUser();
                }
                return null;
            }

            const {
                data: { user },
                error
            } = await window.supabaseClient.auth.getUser();

            if (error) {
                console.error(error);
                return null;
            }

            return user;
        },

        async getSellerProfile(userId) {
            if (!userId) return null;

            const client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
            if (client) {
                try {
                    const { data: authResult } = await client.auth.getUser();
                    const currentUser = authResult?.user || null;
                    const table = currentUser?.id === userId ? "profiles" : "public_profiles";
                    const columns = table === "profiles"
                        ? "*"
                        : "id,first_name,last_name,avatar_url,country,region,area";
                    const { data, error } = await client
                        .from(table)
                        .select(columns)
                        .eq("id", userId)
                        .maybeSingle();
                    if (error) throw error;
                    if (data) return data;
                } catch (error) {
                    console.warn("Seller profile lookup:", error.message);
                }
            }

            // Fallback to active auth session profile if available
            if (window.GamBasketAuthContext?.profile) {
                return window.GamBasketAuthContext.profile;
            }

            return {
                id: userId,
                seller_plan: "starter",
                seller_plan_status: "active",
                seller_status: "approved"
            };
        },

        getPlan(planId) {
            return this.plans[planId] || null;
        },

        getAllPlans() {
            return Object.values(this.plans);
        },

        hasActivePlan(seller = this.currentSeller) {
            if (!seller) return true; // In development mode, allow active access

            return Boolean(
                (seller.seller_plan && seller.seller_plan_status === "active") ||
                seller.seller_status === "approved" ||
                seller.role === "seller" ||
                seller.role === "admin"
            );
        },

        getCurrentPlan(seller = this.currentSeller) {
            const planId = seller?.seller_plan || "starter";
            return this.getPlan(planId) || this.plans.starter;
        },

        canUseBusinessProducts(seller = this.currentSeller) {
            return this.hasActivePlan(seller);
        },

        canUseQuickSell() {
            return true;
        },

        getCommissionRate(seller = this.currentSeller) {
            const plan = this.getCurrentPlan(seller);

            if (!plan) return null;

            return Number(plan.commissionRate);
        },

        calculateCommission(amount, seller = this.currentSeller) {
            const rate = this.getCommissionRate(seller);

            if (rate === null) return 0;

            return Number(amount || 0) * (rate / 100);
        },

        calculateQuickSellCommission(amount, rate = 7) {
            return Number(amount || 0) * (Number(rate) / 100);
        },

        formatMoney(amount) {
            return "D " + Number(amount || 0).toLocaleString();
        },

        async getActivePromotion() {
            /*
             * Promotion is intentionally fetched dynamically.
             * Do not hardcode the six-month launch promotion.
             */
            if (window.supabaseClient) {
                try {
                    const now = new Date().toISOString();

                    const { data, error } = await window.supabaseClient
                        .from("seller_promotions")
                        .select("*")
                        .eq("active", true)
                        .lte("starts_at", now)
                        .gte("ends_at", now)
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!error && data) {
                        this.promotion = data;
                        return this.promotion;
                    }
                } catch {}
            }

            try {
                const local = localStorage.getItem("gambasket_seller:promotion");
                if (local) {
                    const parsed = JSON.parse(local);
                    if (parsed.active || parsed.enabled) {
                        this.promotion = parsed;
                        return this.promotion;
                    }
                }
            } catch {}

            return null;
        },

        promotionCoversSubscription(promotion = this.promotion) {
            return Boolean(
                promotion &&
                (promotion.active || promotion.enabled) &&
                (promotion.type === "seller_subscription_waiver" || promotion.waiveSubscription)
            );
        },

        getPromotionLabel(promotion = this.promotion) {
            if (!promotion) return null;

            return promotion.name || promotion.title || "Current GamBasket Promotion";
        },

        getPromotionEndDate(promotion = this.promotion) {
            const end = promotion?.ends_at || promotion?.endsAt;
            if (!end) return null;

            return new Date(end).toLocaleDateString(
                undefined,
                {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                }
            );
        },

        requiresPlan(seller = this.currentSeller) {
            return !this.hasActivePlan(seller);
        },

        sellerCanAddProducts(seller = this.currentSeller) {
            return this.hasActivePlan(seller);
        },

        getPlanStatusText(seller = this.currentSeller) {
            if (!seller) return "No seller account";

            if (!this.hasActivePlan(seller)) {
                return "No active seller plan";
            }

            const plan = this.getCurrentPlan(seller);

            return plan.name + " plan active";
        },

        openSellerUpgrade() {
            window.location.href = "settings.html#plans";
        },

        openQuickSell() {
            window.location.href = "../quick-sell.html";
        },

        guardProductCreation() {
            if (this.hasActivePlan()) {
                return true;
            }

            this.showPlanRequiredModal();
            return false;
        },

        showPlanRequiredModal() {
            const existing = document.getElementById("sellerPlanRequiredModal");

            if (existing) {
                existing.classList.add("is-open");
                return;
            }

            const modal = document.createElement("div");

            modal.id = "sellerPlanRequiredModal";
            modal.className = "seller-plan-modal";
            modal.innerHTML = `
                <div class="seller-plan-modal-backdrop"></div>

                <div class="seller-plan-modal-card">

                    <button
                        class="seller-plan-modal-close"
                        type="button"
                        aria-label="Close"
                    >×</button>

                    <div class="seller-plan-modal-icon">🏪</div>

                    <h2>Choose how you want to sell</h2>

                    <p>
                        Business sellers need an active seller plan
                        before adding normal marketplace products.
                    </p>

                    <div class="seller-plan-modal-actions">

                        <button
                            type="button"
                            class="seller-plan-option"
                            data-action="quick-sell"
                        >
                            <strong>Quick Sell</strong>
                            <span>
                                Sell one personal item without a
                                monthly seller subscription.
                            </span>
                        </button>

                        <button
                            type="button"
                            class="seller-plan-option primary"
                            data-action="plans"
                        >
                            <strong>Choose a Seller Plan</strong>
                            <span>
                                Start your business storefront and
                                list products normally.
                            </span>
                        </button>

                    </div>

                </div>
            `;

            document.body.appendChild(modal);

            requestAnimationFrame(() => {
                modal.classList.add("is-open");
            });

            modal.querySelector(".seller-plan-modal-close")
                .addEventListener("click", () => modal.remove());

            modal.querySelector(".seller-plan-modal-backdrop")
                .addEventListener("click", () => modal.remove());

            modal.querySelector('[data-action="quick-sell"]')
                .addEventListener("click", () => {
                    this.openQuickSell();
                });

            modal.querySelector('[data-action="plans"]')
                .addEventListener("click", () => {
                    this.openSellerUpgrade();
                });
        }
    };

    window.GamBasketSeller = SellerSystem;

    const SellerWorkspace = {
        activePath() {
            const file = window.location.pathname.split("/").pop() || "index.html";
            return file === "add-product.html" ? "products.html" : file;
        },

        addSidebarStatus(seller) {
            const sidebar = document.querySelector(".seller-sidebar");
            const brand = sidebar?.querySelector(".seller-brand");
            if (!sidebar || !brand || sidebar.querySelector(".seller-sidebar-status")) return;

            const plan = SellerSystem.getCurrentPlan(seller);
            const status = document.createElement("div");
            status.className = "seller-sidebar-status";
            status.innerHTML = `
                <i aria-hidden="true"></i>
                <div>
                    <strong>${plan.name} seller workspace</strong>
                    <span>Store controls are active</span>
                </div>
            `;
            brand.insertAdjacentElement("afterend", status);
        },

        addPageKicker() {
            const title = document.querySelector(".seller-page-title");
            if (!title || title.previousElementSibling?.classList.contains("seller-page-kicker")) return;
            const kicker = document.createElement("div");
            kicker.className = "seller-page-kicker";
            kicker.textContent = "SELLER COMMAND CENTER";
            title.before(kicker);
        },

        addMobileNavigation() {
            if (document.querySelector(".seller-bottom-nav")) return;
            const current = this.activePath();
            const links = [
                ["index.html", "Overview"],
                ["products.html", "Products"],
                ["orders.html", "Orders"],
                ["messages.html", "Messages"],
                ["earnings.html", "Earnings"]
            ];
            const nav = document.createElement("nav");
            nav.className = "seller-bottom-nav";
            nav.setAttribute("aria-label", "Seller navigation");
            nav.innerHTML = links.map(([href, label]) => `<a href="${href}" class="${href === current ? "active" : ""}">${label}</a>`).join("");
            document.body.appendChild(nav);
        },

        enhance(seller) {
            if (!document.body.classList.contains("seller-page")) return;
            document.querySelectorAll(".seller-nav-link").forEach(link => {
                if (link.getAttribute("href") === this.activePath()) link.setAttribute("aria-current", "page");
            });
            this.addSidebarStatus(seller);
            this.addPageKicker();
            this.addMobileNavigation();
            requestAnimationFrame(() => document.body.classList.add("seller-ready"));
        }
    };

    window.GamBasketSellerWorkspace = SellerWorkspace;

    document.addEventListener("DOMContentLoaded", () => {
        SellerSystem.init().then(seller => SellerWorkspace.enhance(seller));
    });

})();
