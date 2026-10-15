/* ============================================================
   GAMBASKET — AFFILIATE CENTER PAGE CONTROLLER
============================================================ */

(async function () {

    "use strict";

    const $ = (selector) =>
        document.querySelector(selector);

    const $$ = (selector) =>
        [...document.querySelectorAll(selector)];

    const client =
        window.supabaseClient ||
        window.gambasketSupabase ||
        window.supabase ||
        window.sb;

    let affiliateProfile = null;
    let products = [];
    let links = [];
    let commissions = [];

    const loader =
        $("#affiliateLoader");

    const app =
        $("#affiliateApp");

    const loaderText =
        $("#affiliateLoaderText");

    const loaderProgress =
        $("#affiliateLoaderProgress");


    /* ========================================================
       LOADING EXPERIENCE
    ======================================================== */

    function loaderStage(text, progress) {

        if (loaderText) {
            loaderText.textContent = text;
        }

        if (loaderProgress) {
            loaderProgress.style.width =
                `${progress}%`;
        }
    }


    /* ========================================================
       TOAST
    ======================================================== */

    let toastTimer = null;

    function toast(title, message) {

        const el = $("#affiliateToast");

        if (!el) return;

        $("#affiliateToastTitle").textContent =
            title;

        $("#affiliateToastMessage").textContent =
            message;

        el.hidden = false;

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            el.hidden = true;
        }, 2800);
    }


    /* ========================================================
       AUTH
    ======================================================== */

    async function authenticate() {

        loaderStage(
            "Verifying your GamBasket session",
            25
        );

        await window.GamBasketAuth.ready();

        const session =
            await window.GamBasketAuth.getSession();

        if (!session?.user) {

            window.location.href =
                "../login.html?redirect=affiliate/index.html";

            return false;
        }

        loaderStage(
            "Loading affiliate profile",
            45
        );

        affiliateProfile =
            await window.GamBasketAffiliate
                .getAffiliateProfile();

        if (!affiliateProfile) {

            affiliateProfile =
                await window.GamBasketAffiliate
                    .createAffiliateProfile();

        }

        return true;
    }


    /* ========================================================
       PROFILE
    ======================================================== */

    async function loadIdentity() {

        const user =
            (await window.GamBasketAuth.getSession())
                ?.user;

        const profile =
            await window.GamBasketAuth
                .fetchUserProfile();

        const first =
            profile?.first_name ||
            user?.user_metadata?.first_name ||
            "Affiliate";

        const last =
            profile?.last_name ||
            user?.user_metadata?.last_name ||
            "";

        const fullName =
            `${first} ${last}`.trim();

        const initials =
            `${first[0] || "A"}${last[0] || ""}`
                .toUpperCase();

        $("#affiliateMiniAvatar").textContent =
            initials;

        $("#affiliateSettingsAvatar").textContent =
            initials;

        $("#affiliateMiniName").textContent =
            fullName;

        $("#affiliateSettingsName").textContent =
            fullName;

        $("#affiliateSettingsEmail").textContent =
            user?.email || "";

        $("#affiliateDisplayName").value =
            affiliateProfile.display_name ||
            fullName;

        $("#affiliateCodeReadonly").value =
            affiliateProfile.affiliate_code;

        $("#overviewAffiliateCode").textContent =
            affiliateProfile.affiliate_code;
    }


    /* ========================================================
       PRODUCTS
    ======================================================== */

    async function loadProducts() {

        loaderStage(
            "Finding products available for promotion",
            62
        );

        const { data, error } =
            await client
                .from("products")
                .select(`
                    id,
                    title,
                    price,
                    currency,
                    main_image,
                    status,
                    category_id
                `)
                .eq("status", "approved")
                .order("created_at", {
                    ascending: false
                })
                .limit(60);

        if (error) {
            console.error(
                "[Affiliate Products]",
                error
            );

            products = [];
            return;
        }

        products = data || [];

        renderProducts();
        buildCategoryFilter();
    }


    function buildCategoryFilter() {

        const select =
            $("#affiliateCategoryFilter");

        if (!select) return;

        const categories =
            [...new Set(
                products
                    .map(item => item.category_id)
                    .filter(Boolean)
            )];

        select.innerHTML =
            `<option value="all">All categories</option>` +
            categories.map(
                category =>
                    `<option value="${escapeHtml(category)}">
                        ${escapeHtml(category)}
                    </option>`
            ).join("");
    }


    function renderProducts() {

        const container =
            $("#affiliateProductsGrid");

        if (!container) return;

        const search =
            $("#affiliateProductSearch")
                ?.value
                ?.trim()
                ?.toLowerCase() || "";

        const category =
            $("#affiliateCategoryFilter")
                ?.value || "all";

        const visible =
            products.filter(product => {

                const matchesSearch =
                    !search ||
                    product.title
                        ?.toLowerCase()
                        .includes(search);

                const matchesCategory =
                    category === "all" ||
                    product.category_id === category;

                return matchesSearch &&
                    matchesCategory;
            });


        if (!visible.length) {

            container.innerHTML = `
                <div class="affiliate-empty-state">
                    <strong>No products found</strong>
                    <span>
                        Try another search or category.
                    </span>
                </div>
            `;

            return;
        }


        container.innerHTML =
            visible.map(product => {

                const image =
                    product.main_image ||
                    "../assets/product-placeholder.png";

                const price =
                    Number(product.price || 0)
                        .toLocaleString("en-GM");

                return `
                    <article
                        class="affiliate-product-card"
                    >

                        <div class="affiliate-product-image">
                            <img
                                src="${escapeAttribute(image)}"
                                alt=""
                                loading="lazy"
                            >
                        </div>

                        <div class="affiliate-product-info">

                            <h3>
                                ${escapeHtml(product.title)}
                            </h3>

                            <div class="affiliate-product-price">
                                ${escapeHtml(
                                    product.currency || "GMD"
                                )}
                                ${price}
                            </div>

                            <div class="affiliate-product-meta">

                                <span>
                                    GamBasket marketplace
                                </span>

                                <span>
                                    Affiliate eligible
                                </span>

                            </div>

                            <span
                                class="affiliate-product-commission"
                            >
                                Generate your referral link
                            </span>

                            <div
                                class="affiliate-product-actions"
                            >

                                <button
                                    type="button"
                                    data-product-link="${product.id}"
                                >
                                    Promote
                                </button>

                                <a
                                    href="../product.html?id=${encodeURIComponent(product.id)}"
                                    target="_blank"
                                    rel="noopener"
                                >
                                    View
                                </a>

                            </div>

                        </div>

                    </article>
                `;

            }).join("");


        $$("[data-product-link]")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () =>
                        openPromotion(
                            button.dataset.productLink
                        )
                );

            });
    }


    /* ========================================================
       PROMOTION
    ======================================================== */

    async function openPromotion(productId) {

        const product =
            products.find(
                item => String(item.id) === String(productId)
            );

        if (!product) return;

        const modal =
            $("#affiliateShareModal");

        const title =
            $("#shareProductTitle");

        const input =
            $("#generatedAffiliateLink");

        const view =
            $("#viewAffiliateProduct");

        if (!modal) return;

        title.textContent =
            product.title;

        input.value =
            "Creating your referral link...";

        view.href =
            `../product.html?id=${encodeURIComponent(product.id)}`;

        modal.hidden = false;

        try {

            const link =
                await window.GamBasketAffiliate
                    .createProductLink(product.id);

            input.value =
                link.url;

            modal.dataset.link =
                link.url;

            modal.dataset.product =
                product.id;

        } catch (error) {

            console.error(
                "[Affiliate Link]",
                error
            );

            input.value =
                "Unable to generate link.";

            toast(
                "Couldn't create link",
                "Please try again."
            );
        }
    }


    /* ========================================================
       LINKS
    ======================================================== */

    async function loadLinks() {

        links =
            await window.GamBasketAffiliate
                .getMyLinks()
                .catch(() => []);

        renderLinks();
    }


    function renderLinks() {

        const container =
            $("#affiliateLinksGrid");

        if (!container) return;

        if (!links.length) {

            container.innerHTML = `
                <div class="affiliate-empty-state">
                    <strong>
                        No affiliate links yet
                    </strong>
                    <span>
                        Visit Promote Products and create
                        your first referral link.
                    </span>
                </div>
            `;

            return;
        }

        container.innerHTML =
            links.map(link => {

                const product =
                    link.products || {};

                const productImage =
                    product.main_image ||
                    "../assets/product-placeholder.png";

                const url =
                    `${window.location.origin}/product.html?id=${encodeURIComponent(link.product_id)}` +
                    `&ref=${encodeURIComponent(
                        affiliateProfile.affiliate_code
                    )}` +
                    `&link=${encodeURIComponent(link.id)}`;

                return `
                    <article class="affiliate-link-card">

                        <div class="affiliate-link-card-top">

                            <div class="affiliate-link-thumb">
                                <img
                                    src="${escapeAttribute(productImage)}"
                                    alt=""
                                >
                            </div>

                            <div>
                                <strong>
                                    ${escapeHtml(
                                        product.title ||
                                        "Product"
                                    )}
                                </strong>

                                <span>
                                    ${link.clicks || 0} clicks
                                </span>
                            </div>

                        </div>

                        <div class="affiliate-link-url">

                            <input
                                value="${escapeAttribute(url)}"
                                readonly
                            >

                            <button
                                type="button"
                                data-copy-link="${escapeAttribute(url)}"
                            >
                                <svg>
                                    <use href="#aff-copy"></use>
                                </svg>
                            </button>

                        </div>

                    </article>
                `;

            }).join("");


        $$("[data-copy-link]")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    async () => {

                        await copyText(
                            button.dataset.copyLink
                        );

                        toast(
                            "Link copied",
                            "Your affiliate link is ready to share."
                        );

                    }
                );

            });
    }


    /* ========================================================
       COMMISSIONS
    ======================================================== */

    async function loadCommissions() {

        commissions =
            await window.GamBasketAffiliate
                .getCommissions()
                .catch(() => []);

        renderCommissionStats();
        renderCommissions();
        renderRecentCommissions();
    }


    function renderCommissionStats() {

        const total =
            commissions.reduce(
                (sum, item) =>
                    sum +
                    Number(item.commission_amount || 0),
                0
            );

        const pending =
            commissions
                .filter(item => item.status === "pending")
                .reduce(
                    (sum, item) =>
                        sum +
                        Number(item.commission_amount || 0),
                    0
                );

        const approved =
            commissions
                .filter(item => item.status === "approved")
                .reduce(
                    (sum, item) =>
                        sum +
                        Number(item.commission_amount || 0),
                    0
                );

        const paid =
            commissions
                .filter(item => item.status === "paid")
                .reduce(
                    (sum, item) =>
                        sum +
                        Number(item.commission_amount || 0),
                    0
                );


        setText(
            "commissionTotal",
            money(total)
        );

        setText(
            "commissionPending",
            money(pending)
        );

        setText(
            "commissionApproved",
            money(approved)
        );

        setText(
            "commissionPaid",
            money(paid)
        );

        setText(
            "overviewCommission",
            money(total)
        );

        setText(
            "overviewPending",
            money(pending)
        );

        setText(
            "overviewPaid",
            money(paid)
        );

        setText(
            "payoutAvailable",
            money(paid)
        );
    }


    function renderCommissions() {

        const table =
            $("#affiliateCommissionTable");

        const conversionsTable =
            $("#affiliateConversionsTable");

        if (table) {

            table.innerHTML =
                commissions.map(item => {

                    const orderNumber =
                        item.orders?.order_number ||
                        "Order";

                    return `
                        <tr>
                            <td>${escapeHtml(orderNumber)}</td>

                            <td>
                                ${money(
                                    item.order_amount
                                )}
                            </td>

                            <td>
                                ${Number(
                                    item.commission_rate || 0
                                )}%
                            </td>

                            <td>
                                ${money(
                                    item.commission_amount
                                )}
                            </td>

                            <td>
                                <span
                                    class="affiliate-table-status ${escapeAttribute(
                                        item.status || "pending"
                                    )}"
                                >
                                    ${escapeHtml(
                                        item.status || "pending"
                                    )}
                                </span>
                            </td>

                            <td>
                                ${formatDate(
                                    item.created_at
                                )}
                            </td>
                        </tr>
                    `;

                }).join("");
        }


        if (conversionsTable) {

            conversionsTable.innerHTML =
                commissions.map(item => {

                    const order =
                        item.orders || {};

                    return `
                        <tr>
                            <td>
                                ${escapeHtml(
                                    order.order_number ||
                                    "Order"
                                )}
                            </td>

                            <td>
                                Product sale
                            </td>

                            <td>
                                ${money(
                                    item.order_amount
                                )}
                            </td>

                            <td>
                                ${money(
                                    item.commission_amount
                                )}
                            </td>

                            <td>
                                <span
                                    class="affiliate-table-status ${escapeAttribute(
                                        item.status || "pending"
                                    )}"
                                >
                                    ${escapeHtml(
                                        item.status || "pending"
                                    )}
                                </span>
                            </td>

                            <td>
                                ${formatDate(
                                    item.created_at
                                )}
                            </td>
                        </tr>
                    `;

                }).join("");
        }
    }


    function renderRecentCommissions() {

        const container =
            $("#overviewRecentCommissions");

        if (!container) return;

        const recent =
            commissions.slice(0,5);

        if (!recent.length) {

            container.innerHTML = `
                <div class="affiliate-empty-state">
                    <strong>
                        No commissions yet
                    </strong>

                    <span>
                        Your first qualifying referral will
                        appear here.
                    </span>
                </div>
            `;

            return;
        }

        container.innerHTML =
            recent.map(item => {

                return `
                    <div class="affiliate-record">

                        <div class="affiliate-record-icon">
                            <svg>
                                <use href="#aff-wallet"></use>
                            </svg>
                        </div>

                        <div class="affiliate-record-main">
                            <strong>
                                ${
                                    item.orders?.order_number ||
                                    "Order"
                                }
                            </strong>

                            <span>
                                ${formatDate(
                                    item.created_at
                                )}
                            </span>
                        </div>

                        <strong class="affiliate-record-value">
                            ${money(
                                item.commission_amount
                            )}
                        </strong>

                    </div>
                `;

            }).join("");
    }


    /* ========================================================
       OVERVIEW
    ======================================================== */

    function renderOverview() {

        setText(
            "overviewClicks",
            affiliateProfile.total_clicks || 0
        );

        setText(
            "overviewConversions",
            affiliateProfile.total_orders || 0
        );

        setText(
            "overviewSales",
            money(
                affiliateProfile.total_sales || 0
            )
        );

        setText(
            "overviewCommission",
            money(
                affiliateProfile.total_commission || 0
            )
        );

        setText(
            "affiliateClicks",
            affiliateProfile.total_clicks || 0
        );

        setText(
            "affiliateOrders",
            affiliateProfile.total_orders || 0
        );


        const rate =
            Number(affiliateProfile.total_clicks || 0) > 0
                ? (
                    Number(
                        affiliateProfile.total_orders || 0
                    ) /
                    Number(
                        affiliateProfile.total_clicks || 0
                    )
                ) * 100
                : 0;

        setText(
            "heroConversionRate",
            `${rate.toFixed(1)}%`
        );

        setText(
            "analyticsConversionRate",
            `${rate.toFixed(2)}%`
        );
    }


    /* ========================================================
       NAVIGATION
    ======================================================== */

    const titles = {
        overview: "Overview",
        analytics: "Analytics",
        clicks: "Traffic",
        conversions: "Conversions",
        products: "Promote Products",
        links: "My Links",
        commissions: "Commissions",
        payouts: "Payouts",
        settings: "Affiliate Settings"
    };


    function openTab(name) {

        $$(".affiliate-section")
            .forEach(section => {

                const active =
                    section.dataset.section === name;

                section.classList.toggle(
                    "active",
                    active
                );
            });


        $$(".affiliate-nav-item")
            .forEach(button => {

                button.classList.toggle(
                    "active",
                    button.dataset.tab === name
                );
            });


        $$(".affiliate-bottom-nav button")
            .forEach(button => {

                button.classList.toggle(
                    "active",
                    button.dataset.tab === name
                );
            });


        setText(
            "affiliatePageTitle",
            titles[name] || "Affiliate"
        );


        history.replaceState(
            null,
            "",
            `#${name}`
        );


        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

        if (window.innerWidth <= 760) {
            closeMobileMenu();
        }
    }


    function bindNavigation() {

        $$("[data-tab]")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {
                        openTab(
                            button.dataset.tab
                        );
                    }
                );

            });


        $$("[data-open-tab]")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {
                        openTab(
                            button.dataset.openTab
                        );
                    }
                );

            });


        const hash =
            window.location.hash
                .replace("#","");

        openTab(
            titles[hash]
                ? hash
                : "overview"
        );
    }


    /* ========================================================
       MOBILE
    ======================================================== */

    function closeMobileMenu() {

        $("#affiliateSidebar")
            ?.classList
            .remove("open");

        const backdrop =
            $("#affiliateMobileBackdrop");

        if (backdrop) {
            backdrop.hidden = true;
        }
    }


    $("#affiliateMenuToggle")
        ?.addEventListener(
            "click",
            () => {

                const sidebar =
                    document.querySelector(
                        ".affiliate-sidebar"
                    );

                const backdrop =
                    $("#affiliateMobileBackdrop");

                sidebar.classList.toggle(
                    "open"
                );

                backdrop.hidden =
                    !sidebar.classList.contains(
                        "open"
                    );
            }
        );


    $("#affiliateMobileBackdrop")
        ?.addEventListener(
            "click",
            closeMobileMenu
        );


    /* ========================================================
       COPY
    ======================================================== */

    async function copyText(value) {

        try {

            await navigator.clipboard
                .writeText(value);

            return true;

        } catch {

            return false;

        }

    }


    $("#copyMainCode")
        ?.addEventListener(
            "click",
            async () => {

                await copyText(
                    affiliateProfile.affiliate_code
                );

                toast(
                    "Copied",
                    "Your affiliate code has been copied."
                );
            }
        );


    $("#copyGeneratedLink")
        ?.addEventListener(
            "click",
            async () => {

                const value =
                    $("#generatedAffiliateLink")
                        .value;

                if (!value) return;

                await copyText(value);

                toast(
                    "Link copied",
                    "Your referral link is ready to share."
                );
            }
        );


    $("#nativeShareAffiliate")
        ?.addEventListener(
            "click",
            async () => {

                const modal =
                    $("#affiliateShareModal");

                const url =
                    modal?.dataset?.link;

                if (!url) return;

                if (navigator.share) {

                    try {

                        await navigator.share({
                            title:
                                "GamBasket product",
                            text:
                                "Check this out on GamBasket.",
                            url
                        });

                    } catch {}

                } else {

                    await copyText(url);

                    toast(
                        "Link copied",
                        "Your browser doesn't support native sharing."
                    );
                }
            }
        );


    $("#closeAffiliateShare")
        ?.addEventListener(
            "click",
            () => {
                $("#affiliateShareModal").hidden =
                    true;
            }
        );


    $("#affiliateShareModal")
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target.id ===
                    "affiliateShareModal"
                ) {
                    event.currentTarget.hidden =
                        true;
                }

            }
        );


    /* ========================================================
       SEARCH
    ======================================================== */

    $("#affiliateProductSearch")
        ?.addEventListener(
            "input",
            renderProducts
        );

    $("#affiliateCategoryFilter")
        ?.addEventListener(
            "change",
            renderProducts
        );


    $("#affiliateSearchButton")
        ?.addEventListener(
            "click",
            () => {

                $("#affiliateSearchModal")
                    .hidden = false;

                $("#affiliateGlobalSearchInput")
                    ?.focus();

            }
        );


    $("#closeAffiliateSearch")
        ?.addEventListener(
            "click",
            () => {
                $("#affiliateSearchModal")
                    .hidden = true;
            }
        );


    $("#affiliateSearchModal")
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target.id ===
                    "affiliateSearchModal"
                ) {
                    event.currentTarget.hidden =
                        true;
                }

            }
        );


    $("#affiliateGlobalSearchInput")
        ?.addEventListener(
            "input",
            event => {

                const query =
                    event.target.value
                        .toLowerCase()
                        .trim();

                const results =
                    products.filter(
                        product =>
                            !query ||
                            product.title
                                ?.toLowerCase()
                                .includes(query)
                    ).slice(0,10);

                const container =
                    $("#affiliateSearchResults");

                if (!container) return;

                container.innerHTML =
                    results.map(product => `

                        <button
                            type="button"
                            class="affiliate-record"
                            data-search-product="${product.id}"
                            style="
                                width:100%;
                                border:0;
                                background:transparent;
                                text-align:left;
                                cursor:pointer;
                            "
                        >

                            <div class="affiliate-record-icon">
                                <svg>
                                    <use href="#aff-product"></use>
                                </svg>
                            </div>

                            <div class="affiliate-record-main">
                                <strong>
                                    ${escapeHtml(product.title)}
                                </strong>

                                <span>
                                    ${money(product.price)}
                                </span>
                            </div>

                        </button>

                    `).join("");


                $$("[data-search-product]")
                    .forEach(button => {

                        button.addEventListener(
                            "click",
                            () => {

                                $("#affiliateSearchModal")
                                    .hidden = true;

                                openTab("products");

                                setTimeout(() => {

                                    const input =
                                        $("#affiliateProductSearch");

                                    if (input) {

                                        input.value =
                                            products.find(
                                                p =>
                                                    String(p.id) ===
                                                    String(
                                                        button.dataset
                                                            .searchProduct
                                                    )
                                            )?.title || "";

                                        renderProducts();

                                    }

                                },100);

                            }
                        );

                    });

            }
        );


    /* ========================================================
       SAVE SETTINGS
    ======================================================== */

    $("#saveAffiliateSettings")
        ?.addEventListener(
            "click",
            async () => {

                const name =
                    $("#affiliateDisplayName")
                        .value
                        .trim();

                const { error } =
                    await client
                        .from("affiliate_profiles")
                        .update({
                            display_name: name,
                            updated_at:
                                new Date().toISOString()
                        })
                        .eq(
                            "id",
                            affiliateProfile.id
                        );

                if (error) {

                    console.error(
                        "[Affiliate Settings]",
                        error
                    );

                    toast(
                        "Save failed",
                        "Your affiliate profile could not be updated."
                    );

                    return;
                }

                affiliateProfile.display_name =
                    name;

                toast(
                    "Saved",
                    "Your affiliate profile has been updated."
                );
            }
        );


    /* ========================================================
       THEME
    ======================================================== */

    function toggleTheme() {

        const root =
            document.documentElement;

        const dark =
            root.classList.toggle("dark");

        localStorage.setItem(
            "gambasket-theme",
            dark ? "dark" : "light"
        );
    }


    $("#affiliateThemeButton")
        ?.addEventListener(
            "click",
            toggleTheme
        );

    $("#affiliateMobileTheme")
        ?.addEventListener(
            "click",
            toggleTheme
        );


    /* ========================================================
       PAYOUT PLACEHOLDER
    ======================================================== */

    $("#requestPayoutButton")
        ?.addEventListener(
            "click",
            () => {

                toast(
                    "Payout system",
                    "Your approved affiliate balance is ready for payout once the payout workflow is connected."
                );

            }
        );


    /* ========================================================
       ESCAPE HELPERS
    ======================================================== */

    function escapeHtml(value) {

        return String(value ?? "")
            .replace(/&/g,"&amp;")
            .replace(/</g,"&lt;")
            .replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;")
            .replace(/'/g,"&#039;");
    }

    function escapeAttribute(value) {

        return escapeHtml(value)
            .replace(/`/g,"&#096;");
    }

    function money(value) {

        return `D ${Number(value || 0)
            .toLocaleString("en-GM", {
                maximumFractionDigits: 2
            })}`;
    }

    function formatDate(value) {

        if (!value) return "—";

        return new Date(value)
            .toLocaleDateString(
                "en-GM",
                {
                    day: "numeric",
                    month: "short",
                    year: "numeric"
                }
            );
    }

    function setText(id,value) {

        const element =
            document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }


    /* ========================================================
       BOOT
    ======================================================== */

    async function boot() {

        try {

            const authenticated =
                await authenticate();

            if (!authenticated) return;

            await loadIdentity();

            await loadProducts();

            await loadLinks();

            await loadCommissions();

            renderOverview();

            bindNavigation();

            loaderStage(
                "Affiliate Center ready",
                100
            );

            setTimeout(() => {

                loader.style.opacity =
                    "0";

                loader.style.pointerEvents =
                    "none";

                setTimeout(() => {

                    loader.hidden =
                        true;

                    app.hidden =
                        false;

                }, 350);

            }, 300);

        } catch (error) {

            console.error(
                "[GamBasket Affiliate Boot]",
                error
            );

            loaderStage(
                "Unable to load Affiliate Center",
                100
            );

            if (loaderText) {
                loaderText.textContent =
                    "Please refresh and try again.";
            }
        }
    }


    boot();

})();