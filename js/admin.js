"use strict";

(() => {

    let users = [];
    let products = [];
    let orders = [];
    let workers = [];
    let reports = [];
    let sellerApplications = [];
    let stores = [];
    let websites = [];
    let messages = [];
    let reviews = [];
    let categories = [];
    let featured = [];
    let logs = [];
    let deliveryRequests = [];
    let inspectedDeliveryId = null;
    const tableErrors = new Map();

    let selectedUser = null;


    const $ = selector =>
        document.querySelector(selector);


    const $$ = selector =>
        [...document.querySelectorAll(selector)];


    function escapeHtml(value) {

        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }


    function money(value) {

        return `D ${Number(value || 0).toLocaleString()}`;
    }


    function date(value) {

        if (!value) {
            return "—";
        }

        return new Date(value)
            .toLocaleDateString(
                undefined,
                {
                    day:"2-digit",
                    month:"short",
                    year:"numeric"
                }
            );
    }


    async function session() {

        if (!window.GamBasketAuth) {
            throw new Error("Authentication unavailable.");
        }

        await window.GamBasketAuth.ready();

        const value =
            await window.GamBasketAuth.getSession();

        if (!value?.access_token) {
            throw new Error("Administrative session unavailable.");
        }

        return value;
    }


    // Admin data must use the singleton created in js/supabase.js.  In
    // particular, do not derive a REST URL from the current page or config.
    async function getAdminClient() {

        await session();

        const client =
            window.GamBasketAuth
                ?.getClient();

        if (!client) {
            throw new Error("Supabase client unavailable.");
        }

        return client;
    }


    function applyFilters(
        builder,
        query
    ) {

        const reserved = new Set([
            "select",
            "order",
            "limit",
            "offset",
            "on_conflict"
        ]);


        return Object.entries(query)
            .reduce(
                (
                    current,
                    [column, condition]
                ) => {

                    if (
                        reserved.has(column) ||
                        condition === undefined ||
                        condition === null
                    ) {
                        return current;
                    }


                    const value =
                        String(condition);

                    const dot =
                        value.indexOf(".");


                    if (dot < 1) {
                        return current.eq(
                            column,
                            condition
                        );
                    }


                    return current.filter(
                        column,
                        value.slice(0, dot),
                        value.slice(dot + 1)
                    );
                },
                builder
            );
    }


    function applyReadOptions(
        builder,
        query
    ) {

        let current =
            applyFilters(
                builder,
                query
            );


        if (query.order) {

            String(query.order)
                .split(",")
                .forEach(
                    item => {

                        const [column, direction] =
                            item.trim()
                                .split(".");


                        if (column) {
                            current =
                                current.order(
                                    column,
                                    {
                                        ascending:
                                            direction !== "desc"
                                    }
                                );
                        }
                    }
                );
        }


        if (
            query.limit !== undefined &&
            query.limit !== null
        ) {
            current =
                current.limit(
                    Number(query.limit)
                );
        }


        if (
            query.offset !== undefined &&
            query.offset !== null
        ) {
            const offset =
                Number(query.offset);

            const limit =
                Number(query.limit || 1000);

            current =
                current.range(
                    offset,
                    offset + limit - 1
                );
        }


        return current;
    }


    async function request(
        table,
        {
            method = "GET",
            query = {},
            body,
            prefer = "return=representation"
        } = {}
    ) {

        const client =
            await getAdminClient();

        const normalizedMethod =
            String(method)
                .toUpperCase();

        const returnRepresentation =
            !String(prefer)
                .includes("return=minimal");

        let operation;


        if (normalizedMethod === "GET") {

            operation =
                applyReadOptions(
                    client
                        .from(table)
                        .select(
                            query.select || "*"
                        ),
                    query
                );

        } else if (normalizedMethod === "POST") {

            operation =
                query.on_conflict
                    ? client
                        .from(table)
                        .upsert(
                            body,
                            {
                                onConflict:
                                    query.on_conflict
                            }
                        )
                    : client
                        .from(table)
                        .insert(body);

            if (returnRepresentation) {
                operation =
                    operation.select();
            }

        } else if (normalizedMethod === "PATCH") {

            operation =
                applyFilters(
                    client
                        .from(table)
                        .update(body),
                    query
                );

            if (returnRepresentation) {
                operation =
                    operation.select();
            }

        } else if (normalizedMethod === "DELETE") {

            operation =
                applyFilters(
                    client
                        .from(table)
                        .delete(),
                    query
                );

            if (returnRepresentation) {
                operation =
                    operation.select();
            }

        } else {
            throw new Error(
                `Unsupported database method: ${normalizedMethod}`
            );
        }


        const {
            data,
            error
        } = await operation;


        if (error) {

            tableErrors.set(
                table,
                error
            );

            console.error(
                "[GamBasket Admin]",
                table,
                error
            );

            throw new Error(
                error.message ||
                error.hint ||
                "Database request failed."
            );
        }


        tableErrors.delete(table);


        return data;
    }


    async function rpc(
        functionName,
        parameters = {}
    ) {

        const client =
            await getAdminClient();

        const {
            data,
            error
        } = await client.rpc(
            functionName,
            parameters
        );


        if (error) {

            console.error(
                "[GamBasket Admin RPC]",
                functionName,
                error
            );

            throw new Error(
                error.message ||
                error.hint ||
                "Administrative operation failed."
            );
        }


        return data;
    }


    function empty(
        text
    ) {

        return `
            <div class="admin-empty">
                ${escapeHtml(text)}
            </div>
        `;
    }


    function clearSectionError(section) {

        document
            .querySelector(
                `[data-admin-section-error="${section}"]`
            )
            ?.remove();
    }


    function showSectionError(
        section,
        error
    ) {

        console.error(
            `[GamBasket Admin] ${section} section failed`,
            error
        );

        clearSectionError(section);

        const root =
            document.querySelector(
                `.admin-section[data-section="${section}"]`
            );

        if (!root) {
            return;
        }

        const notice =
            document.createElement("div");

        notice.className =
            "admin-empty admin-section-error";

        notice.dataset.adminSectionError =
            section;

        notice.textContent =
            `Unable to load this section: ${error?.message || "Database request failed."}`;

        root.prepend(notice);
    }


    async function loadAdminSection(
        section,
        loader,
        tables = []
    ) {

        try {

            await loader();

            const tableError =
                tables
                    .map(table => tableErrors.get(table))
                    .find(Boolean);

            if (tableError) {
                showSectionError(section, tableError);
            } else {
                clearSectionError(section);
            }

        } catch (error) {

            showSectionError(section, error);
        }
    }


    function renderAdminSection(
        section,
        renderer
    ) {

        try {
            renderer();
        } catch (error) {
            showSectionError(section, error);
        }
    }


    /* ========================================================
       BOOT
    ======================================================== */

    async function boot() {

        const text =
            $("#adminLoaderText");

        const bar =
            $("#adminLoaderBar");


        try {

            const stages = [
                ["Verifying administrator authorization",20],
                ["Loading accounts and capabilities",38],
                ["Loading marketplace operations",56],
                ["Loading seller websites and economy",75],
                ["Preparing administration workspace",100]
            ];


            const allowed =
                await window.GamBasketGuard
                    .gatePage("admin");


            if (!allowed) {
                return;
            }


            for (
                const [
                    label,
                    progress
                ] of stages
            ) {

                text.textContent =
                    label;

                bar.style.width =
                    `${progress}%`;

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            220
                        )
                );

            }


            await loadEverything();


            $("#adminLoader").hidden =
                true;

            $("#adminApplication").hidden =
                false;


            openPage("overview");

        } catch (error) {

            console.error(
                "[GamBasket Admin Boot]",
                error
            );

            text.textContent =
                "Unable to initialize the administration center.";

            bar.style.width =
                "100%";
        }
    }


    /* ========================================================
       NAVIGATION
    ======================================================== */

    const pageTitles = {

        overview:"Overview",
        users:"Users",
        sellers:"Sellers",
        products:"Products",
        orders:"Orders",
        deliveries:"Deliveries",
        workers:"Worker Applications",
        moderation:"Moderation",
        messages:"Messages",
        reviews:"Reviews",
        earnings:"Earnings",
        promotions:"Promotions",
        websites:"Business Websites",
        plans:"Seller Plans",
        categories:"Categories",
        featured:"Featured Products",
        analytics:"Analytics",
        logs:"Audit Logs",
        settings:"Settings",
        affiliate:"Affiliate Center"
    };


    function openPage(
        page
    ) {

        $$(".admin-section")
            .forEach(
                section =>
                    section.classList.toggle(
                        "active",
                        section.dataset.section === page
                    )
            );


        $$(".admin-nav-item")
            .forEach(
                button =>
                    button.classList.toggle(
                        "active",
                        button.dataset.page === page
                    )
            );


        $("#pageTitle")
            .textContent =
            pageTitles[page] ||
            "Overview";


        if (
            window.innerWidth <= 1100
        ) {

            $("#adminSidebar")
                .classList.remove(
                    "open"
                );

            $("#adminMobileBackdrop")
                .hidden = true;
        }


        window.scrollTo({
            top:0,
            behavior:"smooth"
        });


        switch (page) {

            case "users":
                renderUsers();
                break;

            case "sellers":
                renderSellers();
                break;

            case "products":
                renderProducts();
                break;

            case "orders":
                renderOrders();
                break;

            case "deliveries":
                renderDeliveries();
                break;

            case "workers":
                renderWorkers();
                break;

            case "moderation":
                renderReports();
                break;

            case "messages":
                renderMessages();
                break;

            case "reviews":
                renderReviews();
                break;

            case "websites":
                renderWebsites();
                break;

            case "plans":
                renderPlans();
                break;

            case "categories":
                renderCategories();
                break;

            case "featured":
                renderFeatured();
                break;

            case "analytics":
                renderAnalytics();
                break;

            case "logs":
                renderLogs();
                break;

            case "settings":
                loadSettings();
                break;
        }
    }


    $$(".admin-nav-item")
        .forEach(
            button =>
                button.addEventListener(
                    "click",
                    () =>
                        openPage(
                            button.dataset.page
                        )
                )
        );


    $$("[data-open-section]")
        .forEach(
            button =>
                button.addEventListener(
                    "click",
                    () =>
                        openPage(
                            button.dataset.openSection
                        )
                )
        );


    $("#mobileMenuBtn")
        ?.addEventListener(
            "click",
            () => {

                $("#adminSidebar")
                    .classList.toggle("open");

                $("#adminMobileBackdrop")
                    .hidden =
                    !$("#adminSidebar")
                        .classList.contains("open");
            }
        );


    $("#adminMobileBackdrop")
        ?.addEventListener(
            "click",
            () => {

                $("#adminSidebar")
                    .classList.remove(
                        "open"
                    );

                $("#adminMobileBackdrop")
                    .hidden = true;

            }
        );


    /* ========================================================
       THEME
    ======================================================== */

    function syncTheme() {

        const dark =
            document.documentElement
                .classList
                .contains("dark");

        $("#themeLabel")
            .textContent =
            dark
                ? "Light mode"
                : "Dark mode";
    }


    function toggleTheme() {

        const dark =
            document.documentElement
                .classList
                .toggle("dark");


        try {

            localStorage.setItem(
                "gambasket-theme",
                dark
                    ? "dark"
                    : "light"
            );

        } catch (_) {}


        syncTheme();
    }


    $("#adminThemeBtn")
        ?.addEventListener(
            "click",
            toggleTheme
        );

    $("#mobileThemeBtn")
        ?.addEventListener(
            "click",
            toggleTheme
        );

    syncTheme();


    /* ========================================================
       USERS
    ======================================================== */

    async function loadUsers() {

        users =
            await rpc(
                "admin_list_users"
            ) || [];


        $("#countUsers")
            .textContent =
            users.length;

        $("#statUsers")
            .textContent =
            users.length;
    }


    function filteredUsers() {

        const query =
            (
                $("#userSearch")
                    ?.value ||
                ""
            )
                .trim()
                .toLowerCase();


        const role =
            $("#userRoleFilter")
                ?.value ||
            "all";


        return users.filter(
            user => {

                const name =
                    `${user.first_name || ""} ${user.last_name || ""}`
                        .toLowerCase();

                const email =
                    String(
                        user.email ||
                        ""
                    ).toLowerCase();

                const phone =
                    String(
                        user.phone ||
                        ""
                    ).toLowerCase();


                const matchesText =
                    !query ||
                    name.includes(query) ||
                    email.includes(query) ||
                    phone.includes(query);


                if (!matchesText) {
                    return false;
                }


                if (
                    role ===
                    "banned"
                ) {

                    return Boolean(
                        user.is_banned
                    );
                }


                if (
                    role ===
                    "all"
                ) {

                    return true;
                }


                return (
                    user.roles ||
                    []
                )
                .includes(
                    role
                );
            }
        );
    }


    function renderUsers() {

        const list =
            filteredUsers();


        const container =
            $("#usersTable");


        if (!list.length) {

            container.innerHTML =
                empty(
                    "No users match your current filters."
                );

            return;
        }


        container.innerHTML = `
            <table class="admin-table">

                <thead>

                    <tr>
                        <th>User</th>
                        <th>Roles</th>
                        <th>Products</th>
                        <th>Orders</th>
                        <th>Status</th>
                        <th>Joined</th>
                        <th></th>
                    </tr>

                </thead>

                <tbody>

                    ${list
                        .map(
                            user => {

                                const name =
                                    `${user.first_name || ""} ${user.last_name || ""}`
                                        .trim() ||
                                    "User";


                                const initial =
                                    name[0]
                                        ?.toUpperCase() ||
                                    "U";


                                return `
                                    <tr>

                                        <td>

                                            <div class="admin-user-cell">

                                                <div class="admin-avatar">
                                                    ${escapeHtml(initial)}
                                                </div>

                                                <div>

                                                    <strong>
                                                        ${escapeHtml(name)}
                                                    </strong>

                                                    <div
                                                        style="
                                                            color:var(--text-secondary);
                                                            font-size:7px;
                                                            margin-top:3px;
                                                        "
                                                    >
                                                        ${escapeHtml(
                                                            user.email ||
                                                            "No email"
                                                        )}
                                                    </div>

                                                </div>

                                            </div>

                                        </td>


                                        <td>

                                            <div class="admin-role-pills">

                                                ${
                                                    (
                                                        user.roles ||
                                                        []
                                                    )
                                                    .map(
                                                        role =>
                                                            `
                                                                <span class="admin-role-pill">
                                                                    ${escapeHtml(role)}
                                                                </span>
                                                            `
                                                    )
                                                    .join("")
                                                }

                                            </div>

                                        </td>


                                        <td>
                                            ${user.product_count || 0}
                                        </td>


                                        <td>
                                            ${user.order_count || 0}
                                        </td>


                                        <td>

                                            ${
                                                user.is_banned
                                                    ? `
                                                        <span class="admin-ban-pill">
                                                            BANNED
                                                        </span>
                                                    `
                                                    : `
                                                        <span
                                                            style="
                                                                color:#16a34a;
                                                                font-size:7px;
                                                                font-weight:850;
                                                            "
                                                        >
                                                            ACTIVE
                                                        </span>
                                                    `
                                            }

                                        </td>


                                        <td>
                                            ${date(
                                                user.created_at
                                            )}
                                        </td>


                                        <td>

                                            <button
                                                class="admin-small-button"
                                                data-user-id="${escapeHtml(
                                                    user.id
                                                )}"
                                                type="button"
                                            >
                                                Inspect
                                            </button>

                                        </td>

                                    </tr>
                                `;
                            }
                        )
                        .join("")
                    }

                </tbody>

            </table>
        `;


        $$("[data-user-id]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            openUser(
                                button.dataset.userId
                            )
                    )
            );
    }


    $("#userSearch")
        ?.addEventListener(
            "input",
            renderUsers
        );


    $("#userRoleFilter")
        ?.addEventListener(
            "change",
            renderUsers
        );


    /* ========================================================
       USER DRAWER
    ======================================================== */

    async function openUser(
        userId
    ) {

        $("#userDrawer")
            .classList.add("open");

        $("#userDrawer")
            .setAttribute(
                "aria-hidden",
                "false"
            );


        $("#userDrawerContent")
            .innerHTML =
            empty(
                "Loading complete user profile..."
            );


        const bundle =
            await rpc(
                "admin_get_user_bundle",
                {
                    p_user_id:
                        userId
                }
            );


        selectedUser = {
            id:userId,
            ...bundle
        };


        renderUserDrawer();
    }


    function closeUser() {

        $("#userDrawer")
            .classList.remove(
                "open"
            );

        $("#userDrawer")
            .setAttribute(
                "aria-hidden",
                "true"
            );

        selectedUser = null;
    }


    $("#closeUserDrawer")
        ?.addEventListener(
            "click",
            closeUser
        );


    $("#userDrawerBackdrop")
        ?.addEventListener(
            "click",
            closeUser
        );


    function renderUserDrawer() {

        const profile =
            selectedUser?.profile;


        if (!profile) {
            return;
        }


        const name =
            `${profile.first_name || ""} ${profile.last_name || ""}`
                .trim() ||
            "User";


        const roleObjects =
            selectedUser.roles ||
            [];


        const roles =
            roleObjects.map(
                role =>
                    role.role_id
            );


        $("#drawerUserName")
            .textContent =
            name;


        $("#userDrawerContent")
            .innerHTML = `

                <div class="admin-drawer-hero">

                    <div class="admin-avatar">
                        ${escapeHtml(
                            name[0]
                                ?.toUpperCase() ||
                            "U"
                        )}
                    </div>

                    <div>

                        <strong
                            style="
                                display:block;
                                color:var(--text);
                                font-size:13px;
                            "
                        >
                            ${escapeHtml(name)}
                        </strong>

                        <span
                            style="
                                display:block;
                                margin-top:3px;
                                color:var(--text-secondary);
                                font-size:8px;
                            "
                        >
                            ${escapeHtml(
                                profile.email ||
                                ""
                            )}
                        </span>

                        <span
                            style="
                                display:block;
                                margin-top:3px;
                                color:var(--text-secondary);
                                font-size:7px;
                            "
                        >
                            ${escapeHtml(
                                profile.phone ||
                                "No phone number"
                            )}
                        </span>

                    </div>

                </div>


                <div class="admin-drawer-section">

                    <h3>
                        Account overview
                    </h3>

                    <div class="admin-drawer-grid">

                        <div class="admin-drawer-stat">
                            <span>Products</span>
                            <strong>
                                ${(selectedUser.products || []).length}
                            </strong>
                        </div>

                        <div class="admin-drawer-stat">
                            <span>Orders</span>
                            <strong>
                                ${(selectedUser.orders || []).length}
                            </strong>
                        </div>

                        <div class="admin-drawer-stat">
                            <span>Stores</span>
                            <strong>
                                ${(selectedUser.stores || []).length}
                            </strong>
                        </div>

                        <div class="admin-drawer-stat">
                            <span>Websites</span>
                            <strong>
                                ${(selectedUser.websites || []).length}
                            </strong>
                        </div>

                        <div class="admin-drawer-stat">
                            <span>Applications</span>
                            <strong>
                                ${
                                    (
                                        selectedUser.worker_applications ||
                                        []
                                    ).length +
                                    (
                                        selectedUser.seller_applications ||
                                        []
                                    ).length
                                }
                            </strong>
                        </div>

                        <div class="admin-drawer-stat">
                            <span>Worker earnings</span>
                            <strong>
                                ${money(
                                    (
                                        selectedUser.earnings ||
                                        []
                                    )
                                    .reduce(
                                        (
                                            total,
                                            record
                                        ) =>
                                            total +
                                            Number(
                                                record.amount ||
                                                0
                                            ),
                                        0
                                    )
                                )}
                            </strong>
                        </div>

                    </div>

                </div>


                <div class="admin-drawer-section">

                    <h3>
                        Role capabilities
                    </h3>

                    <div class="admin-role-controls">

                        ${
                            [
                                "buyer",
                                "seller",
                                "delivery_worker",
                                "marketplace_worker",
                                "admin"
                            ]
                            .map(
                                role => {

                                    const active =
                                        roles.includes(
                                            role
                                        );


                                    return `
                                        <div
                                            class="admin-role-control"
                                        >

                                            <span>
                                                ${escapeHtml(
                                                    role
                                                )}
                                            </span>

                                            <button
                                                class="${
                                                    active
                                                        ? "active"
                                                        : ""
                                                }"
                                                data-toggle-role="${escapeHtml(
                                                    role
                                                )}"
                                                type="button"
                                            >
                                                ${
                                                    active
                                                        ? "Enabled"
                                                        : "Enable"
                                                }
                                            </button>

                                        </div>
                                    `;
                                }
                            )
                            .join("")
                        }

                    </div>

                </div>


                <div class="admin-drawer-section">

                    <h3>
                        Seller stores
                    </h3>

                    ${
                        selectedUser.stores?.length
                            ? selectedUser.stores
                                .map(
                                    store => `
                                        <div
                                            class="admin-drawer-stat"
                                            style="margin-bottom:7px;"
                                        >

                                            <span>
                                                Store
                                            </span>

                                            <strong
                                                style="
                                                    font-size:11px;
                                                "
                                            >
                                                ${escapeHtml(
                                                    store.name ||
                                                    "Unnamed store"
                                                )}
                                            </strong>

                                            <span
                                                style="
                                                    margin-top:4px;
                                                "
                                            >
                                                Plan:
                                                ${escapeHtml(
                                                    store.plan_key ||
                                                    "quick_sell"
                                                )}
                                            </span>

                                        </div>
                                    `
                                )
                                .join("")
                            : empty(
                                "This account has no seller store."
                            )
                    }

                </div>


                <div class="admin-drawer-section">

                    <h3>
                        Business websites
                    </h3>

                    ${
                        selectedUser.websites?.length
                            ? selectedUser.websites
                                .map(
                                    website => `

                                        <div
                                            class="admin-drawer-stat"
                                            style="margin-bottom:7px;"
                                        >

                                            <span>
                                                ${escapeHtml(
                                                    website.template_key ||
                                                    "Website"
                                                )}
                                            </span>

                                            <strong
                                                style="
                                                    font-size:11px;
                                                "
                                            >
                                                ${escapeHtml(
                                                    website.business_name
                                                )}
                                            </strong>

                                            <a
                                                href="#"
                                                data-view-site="${escapeHtml(
                                                    website.id
                                                )}"
                                                style="
                                                    display:inline-block;
                                                    margin-top:5px;
                                                    color:#2563eb;
                                                    font-size:7px;
                                                "
                                            >
                                                ${
                                                    escapeHtml(
                                                        website.subdomain ||
                                                        ""
                                                    )
                                                }
                                            </a>

                                        </div>

                                    `
                                )
                                .join("")
                            : empty(
                                "No business websites."
                            )
                    }

                </div>


                <div class="admin-drawer-section">

                    <h3>
                        Products
                    </h3>

                    ${
                        selectedUser.products?.length
                            ? selectedUser.products
                                .slice(0,12)
                                .map(
                                    product => `

                                        <div
                                            style="
                                                display:flex;
                                                align-items:center;
                                                justify-content:space-between;
                                                gap:10px;
                                                padding:9px 0;
                                                border-bottom:1px solid var(--border);
                                            "
                                        >

                                            <span
                                                style="
                                                    color:var(--text);
                                                    font-size:8px;
                                                "
                                            >
                                                ${escapeHtml(
                                                    product.title
                                                )}
                                            </span>

                                            <strong
                                                style="
                                                    color:#2563eb;
                                                    font-size:8px;
                                                "
                                            >
                                                ${money(
                                                    product.price
                                                )}
                                            </strong>

                                        </div>

                                    `
                                )
                                .join("")
                            : empty(
                                "No products."
                            )
                    }

                </div>


                <div class="admin-drawer-section">

                    <h3>
                        Applications
                    </h3>

                    ${
                        [
                            ...(selectedUser.seller_applications || []),
                            ...(selectedUser.worker_applications || [])
                        ].length
                            ? [
                                ...(selectedUser.seller_applications || []),
                                ...(selectedUser.worker_applications || [])
                            ]
                                .map(
                                    application => `

                                        <div
                                            class="admin-drawer-stat"
                                            style="margin-bottom:7px;"
                                        >

                                            <span>
                                                Application
                                            </span>

                                            <strong
                                                style="
                                                    font-size:10px;
                                                "
                                            >
                                                ${
                                                    escapeHtml(
                                                        application.worker_type ||
                                                        application.application_type ||
                                                        "Application"
                                                    )
                                                }
                                            </strong>

                                            <span>
                                                Status:
                                                ${
                                                    escapeHtml(
                                                        application.status ||
                                                        "pending"
                                                    )
                                                }
                                            </span>

                                        </div>

                                    `
                                )
                                .join("")
                            : empty(
                                "No worker or seller applications."
                            )
                    }

                </div>


                <div class="admin-drawer-section">

                    <h3>
                        Account controls
                    </h3>

                    <div class="admin-user-action-grid">

                        <button
                            id="drawerBanUser"
                            class="admin-small-button red"
                            type="button"
                        >
                            ${
                                profile.is_banned
                                    ? "Unban account"
                                    : "Ban account"
                            }
                        </button>

                        <button
                            id="drawerRefreshUser"
                            class="admin-small-button"
                            type="button"
                        >
                            Refresh profile
                        </button>

                    </div>

                </div>

            `;


        $$("[data-toggle-role]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        async () => {

                            const role =
                                button.dataset.toggleRole;

                            const enabled =
                                roles.includes(
                                    role
                                );


                            await rpc(
                                "admin_set_user_role",
                                {
                                    p_user_id:
                                        profile.id,

                                    p_role_id:
                                        role,

                                    p_enabled:
                                        !enabled
                                }
                            );


                            await refreshUserDrawer(
                                profile.id
                            );

                        }
                    )
            );


        $("#drawerBanUser")
            ?.addEventListener(
                "click",
                async () => {

                    const ban =
                        !profile.is_banned;


                    let reason = null;


                    if (ban) {

                        reason =
                            prompt(
                                "Reason for banning this account:"
                            );


                        if (
                            reason === null
                        ) {
                            return;
                        }
                    }


                    await rpc(
                        "admin_set_user_ban",
                        {
                            p_user_id:
                                profile.id,

                            p_banned:
                                ban,

                            p_reason:
                                reason
                        }
                    );


                    await refreshUserDrawer(
                        profile.id
                    );

                    await loadUsers();

                    renderUsers();
                }
            );


        $("#drawerRefreshUser")
            ?.addEventListener(
                "click",
                () =>
                    refreshUserDrawer(
                        profile.id
                    )
            );
    }


    async function refreshUserDrawer(
        userId
    ) {

        const bundle =
            await rpc(
                "admin_get_user_bundle",
                {
                    p_user_id:
                        userId
                }
            );


        selectedUser = {
            id:userId,
            ...bundle
        };


        renderUserDrawer();
    }


    /* ========================================================
       PRODUCTS
    ======================================================== */

    async function loadProducts() {

        try {

            products =
                await request(
                    "products",
                    {
                        query:{
                            select:
                                "id,seller_id,title,price,currency,main_image,status,created_at",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (error) {

            console.error(error);

            products = [];
        }


        $("#countProducts")
            .textContent =
            products.length;

        $("#statProducts")
            .textContent =
            products.length;

        $("#productTotal")
            .textContent =
            products.length;

        $("#productPending")
            .textContent =
            products.filter(
                product =>
                    product.status === "pending"
            ).length;

        $("#productApproved")
            .textContent =
            products.filter(
                product =>
                    [
                        "approved",
                        "active"
                    ]
                    .includes(
                        product.status
                    )
            ).length;

        $("#productRejected")
            .textContent =
            products.filter(
                product =>
                    product.status ===
                    "rejected"
            ).length;
    }


    function renderProducts() {

        const pending =
            products.filter(
                product =>
                    product.status ===
                    "pending"
            );


        if (!pending.length) {

            $("#productsList")
                .innerHTML =
                empty(
                    "No products are currently waiting for moderation."
                );

            return;
        }


        $("#productsList")
            .innerHTML =
            pending
                .map(
                    product => `

                        <article class="admin-product-card">

                            <div
                                class="admin-product-image"
                                style="${
                                    product.main_image
                                        ? `background-image:url("${escapeHtml(
                                            product.main_image
                                        )}")`
                                        : ""
                                }"
                            ></div>

                            <div class="admin-product-copy">

                                <strong>
                                    ${escapeHtml(
                                        product.title
                                    )}
                                </strong>

                                <span>
                                    ${money(
                                        product.price
                                    )}
                                </span>

                                <div class="admin-product-actions">

                                    <button
                                        class="admin-small-button green"
                                        data-approve-product="${escapeHtml(
                                            product.id
                                        )}"
                                        type="button"
                                    >
                                        Approve
                                    </button>

                                    <button
                                        class="admin-small-button red"
                                        data-reject-product="${escapeHtml(
                                            product.id
                                        )}"
                                        type="button"
                                    >
                                        Reject
                                    </button>

                                </div>

                            </div>

                        </article>
                    `
                )
                .join("");


        $$("[data-approve-product]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            moderateProduct(
                                button.dataset.approveProduct,
                                "approved"
                            )
                    )
            );


        $$("[data-reject-product]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            moderateProduct(
                                button.dataset.rejectProduct,
                                "rejected"
                            )
                    )
            );
    }


    async function moderateProduct(
        productId,
        status
    ) {

        let reason = null;


        if (
            status === "rejected"
        ) {

            reason =
                prompt(
                    "Reason for rejection:"
                );


            if (
                reason === null
            ) {
                return;
            }
        }


        await request(
            "products",
            {
                method:"PATCH",

                query:{
                    id:
                        `eq.${productId}`
                },

                body:{
                    status,
                    rejection_reason:
                        reason
                }
            }
        );


        await loadProducts();

        renderProducts();
    }


    /* ========================================================
       ORDERS
    ======================================================== */

    async function loadOrders() {

        try {

            orders =
                await request(
                    "orders",
                    {
                        query:{
                            select:
                                "id,order_number,total,currency,order_status,buyer_id,seller_id,created_at",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (error) {

            console.error(error);

            orders = [];
        }


        $("#countOrders")
            .textContent =
            orders.length;

        $("#statOrders")
            .textContent =
            orders.length;

        $("#ordersTotal")
            .textContent =
            orders.length;

        $("#ordersPending")
            .textContent =
            orders.filter(
                order =>
                    order.order_status ===
                    "pending"
            ).length;

        $("#ordersProcessing")
            .textContent =
            orders.filter(
                order =>
                    order.order_status ===
                    "processing"
            ).length;

        $("#ordersCompleted")
            .textContent =
            orders.filter(
                order =>
                    [
                        "delivered",
                        "completed"
                    ]
                    .includes(
                        order.order_status
                    )
            ).length;


        $("#statGMV")
            .textContent =
            money(
                orders.reduce(
                    (
                        total,
                        order
                    ) =>
                        total +
                        Number(
                            order.total ||
                            0
                        ),
                    0
                )
            );
    }


    function renderOrders() {

        if (!orders.length) {

            $("#ordersList")
                .innerHTML =
                empty(
                    "No orders have been recorded yet."
                );

            return;
        }


        $("#ordersList")
            .innerHTML = `
                <table class="admin-table">

                    <thead>
                        <tr>
                            <th>Order</th>
                            <th>Value</th>
                            <th>Status</th>
                            <th>Buyer</th>
                            <th>Seller</th>
                            <th>Date</th>
                        </tr>
                    </thead>

                    <tbody>

                        ${orders
                            .map(
                                order => `

                                    <tr>

                                        <td>
                                            #${escapeHtml(
                                                String(
                                                    order.id
                                                )
                                                .slice(
                                                    0,
                                                    8
                                                )
                                            )}
                                        </td>

                                        <td>
                                            ${money(
                                                order.total
                                            )}
                                        </td>

                                        <td>

                                            <span class="admin-role-pill">
                                                ${escapeHtml(
                                                    order.order_status ||
                                                    "pending"
                                                )}
                                            </span>

                                        </td>

                                        <td>
                                            ${escapeHtml(
                                                String(
                                                    order.buyer_id ||
                                                    ""
                                                )
                                                .slice(
                                                    0,
                                                    8
                                                )
                                            )}
                                        </td>

                                        <td>
                                            ${escapeHtml(
                                                String(
                                                    order.seller_id ||
                                                    ""
                                                )
                                                .slice(
                                                    0,
                                                    8
                                                )
                                            )}
                                        </td>

                                        <td>
                                            ${date(
                                                order.created_at
                                            )}
                                        </td>

                                    </tr>
                                `
                            )
                            .join("")
                        }

                    </tbody>

                </table>
            `;
    }


    /* ========================================================
       SELLERS
    ======================================================== */

    async function loadSellers() {

        try {

            sellerApplications =
                await request(
                    "seller_applications",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {

            sellerApplications = [];
        }


        try {

            stores =
                await request(
                    "stores",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {

            stores = [];
        }


        $("#sellerApplicationsCount")
            .textContent =
            sellerApplications.filter(
                application =>
                    application.status ===
                    "pending" ||
                    !application.status
            ).length;


        $("#approvedSellerCount")
            .textContent =
            users.filter(
                user =>
                    user.roles?.includes(
                        "seller"
                    )
            ).length;


        $("#storesCount")
            .textContent =
            stores.length;
    }


    function renderSellers() {

        if (
            !sellerApplications.length
        ) {

            $("#sellerApplicationsList")
                .innerHTML =
                empty(
                    "There are no seller applications to review."
                );

            return;
        }


        $("#sellerApplicationsList")
            .innerHTML =
            sellerApplications
                .map(
                    application => `

                        <div class="admin-list-item">

                            <div class="admin-list-icon">
                                S
                            </div>

                            <div class="admin-list-copy">

                                <strong>
                                    Seller application
                                </strong>

                                <span>
                                    ${escapeHtml(
                                        application.status ||
                                        "pending"
                                    )}
                                    ·
                                    ${date(
                                        application.created_at
                                    )}
                                </span>

                            </div>

                            <div class="admin-list-actions">

                                <button
                                    class="admin-small-button green"
                                    data-approve-seller="${escapeHtml(
                                        application.id
                                    )}"
                                    type="button"
                                >
                                    Approve
                                </button>

                                <button
                                    class="admin-small-button red"
                                    data-reject-seller="${escapeHtml(
                                        application.id
                                    )}"
                                    type="button"
                                >
                                    Reject
                                </button>

                            </div>

                        </div>
                    `
                )
                .join("");


        $$("[data-approve-seller]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            updateSellerApplication(
                                button.dataset.approveSeller,
                                true
                            )
                    )
            );


        $$("[data-reject-seller]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            updateSellerApplication(
                                button.dataset.rejectSeller,
                                false
                            )
                    )
            );
    }


    async function updateSellerApplication(
        id,
        approved
    ) {

        const application =
            sellerApplications.find(
                item =>
                    String(item.id) ===
                    String(id)
            );


        if (!application) {
            return;
        }


        let reason = null;


        if (!approved) {

            reason =
                prompt(
                    "Reason for rejecting this seller application:"
                );


            if (
                reason === null
            ) {
                return;
            }
        }


        await request(
            "seller_applications",
            {
                method:"PATCH",

                query:{
                    id:
                        `eq.${id}`
                },

                body:{
                    status:
                        approved
                            ? "approved"
                            : "rejected",

                    rejection_reason:
                        reason
                }
            }
        );


        if (approved) {

            await rpc(
                "admin_set_user_role",
                {
                    p_user_id:
                        application.user_id,

                    p_role_id:
                        "seller",

                    p_enabled:true
                }
            );

        }


        await loadUsers();

        await loadSellers();

        renderSellers();

        renderUsers();
    }


    /* ========================================================
       WORKERS
    ======================================================== */

    async function loadWorkers() {

        try {

            workers =
                await request(
                    "worker_applications",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {

            workers = [];
        }


        $("#countWorkers")
            .textContent =
            workers.filter(
                item =>
                    item.status ===
                    "pending" ||
                    !item.status
            ).length;
    }


    function renderWorkers() {

        if (!workers.length) {

            $("#workersList")
                .innerHTML =
                empty(
                    "No worker applications have been submitted."
                );

            return;
        }


        $("#workersList")
            .innerHTML =
            workers
                .map(
                    item => `

                        <div class="admin-list-item">

                            <div class="admin-list-icon">
                                W
                            </div>

                            <div class="admin-list-copy">

                                <strong>
                                    ${escapeHtml(
                                        item.worker_type ||
                                        "Worker application"
                                    )}
                                </strong>

                                <span>
                                    Status:
                                    ${escapeHtml(
                                        item.status ||
                                        "pending"
                                    )}
                                </span>

                            </div>

                            <div class="admin-list-actions">

                                <button
                                    class="admin-small-button"
                                    type="button"
                                    data-review-worker="${escapeHtml(
                                        item.id
                                    )}"
                                >
                                    Review
                                </button>

                            </div>

                        </div>
                    `
                )
                .join("");


        $$("[data-review-worker]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            alert(
                                "Open the applicant's user profile to review their full application."
                            )
                    )
            );
    }


    /* ========================================================
       DELIVERY
    ======================================================== */

    async function loadDeliveries() {

        let requests = [];


        try {

            requests =
                await request(
                    "delivery_requests",
                    {
                        query:{
                            select:"id,order_id,pickup_location,delivery_destination,delivery_area,estimated_fee,status,assigned_worker_id,assigned_at,picked_up_at,delivered_at,created_at,updated_at,assigned_worker:profiles(id,first_name,last_name,email,phone),order:orders(id,order_number,buyer_id,seller_id,total,currency,order_status)",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (error) {

            console.error(
                "[Deliveries]",
                error
            );
        }


        deliveryRequests = requests;


        const courierCount =
            users.filter(
                user =>
                    user.roles?.includes(
                        "delivery_worker"
                    )
            ).length;


        const open =
            requests.filter(
                request =>
                    [
                        "open",
                        "pending"
                    ].includes(
                        request.status
                    )
            );


        const active =
            requests.filter(
                request =>
                    [
                        "accepted",
                        "picked_up",
                        "out_for_delivery"
                    ].includes(
                        request.status
                    )
            );


        const completed =
            requests.filter(
                request =>
                    [
                        "delivered",
                        "completed"
                    ].includes(
                        request.status
                    )
            );


        $("#deliveryWorkersCount")
            .textContent =
            courierCount;

        $("#deliveryOpenCount")
            .textContent =
            open.length;

        $("#deliveryActiveCount")
            .textContent =
            active.length;

        $("#deliveryCompletedCount")
            .textContent =
            completed.length;


        $("#statDeliveries")
            .textContent =
            open.length;


        if (!requests.length) {

            $("#deliveryList")
                .innerHTML =
                empty(
                    "There are no delivery requests yet."
                );

            return;
        }


        $("#deliveryList")
            .innerHTML =
            requests
                .map(
                    request => `

                        <div class="admin-list-item">

                            <div class="admin-list-icon">
                                D
                            </div>

                            <div class="admin-list-copy">

                                <strong>
                                    Delivery #${escapeHtml(
                                        String(
                                            request.id
                                        )
                                        .slice(
                                            0,
                                            8
                                        )
                                    )}
                                </strong>

                                <span>
                                    ${escapeHtml(
                                        request.status ||
                                        "pending"
                                    )}
                                </span>

                            </div>

                            <strong
                                style="
                                    color:#2563eb;
                                    font-size:8px;
                                "
                            >
                                ${money(
                                    request.delivery_fee ||
                                    request.worker_fee ||
                                    0
                                )}
                            </strong>

                        </div>
                    `
                )
                .join("");
    }


    function renderDeliveries() {

        const list =
            $("#deliveryList");

        if (!list) {
            return;
        }


        const pending =
            deliveryRequests.filter(
                delivery =>
                    delivery.status === "pending" &&
                    !delivery.assigned_worker_id
            );

        const assigned =
            deliveryRequests.filter(
                delivery =>
                    delivery.status === "assigned" ||
                    (
                        Boolean(delivery.assigned_worker_id) &&
                        delivery.status === "pending"
                    )
            );

        const active =
            deliveryRequests.filter(
                delivery =>
                    [
                        "picked_up",
                        "out_for_delivery"
                    ].includes(delivery.status)
            );

        const completed =
            deliveryRequests.filter(
                delivery =>
                    [
                        "delivered",
                        "completed"
                    ].includes(delivery.status)
            );

        const setCount =
            (selector, value) => {
                const node = $(selector);
                if (node) {
                    node.textContent = value;
                }
            };


        setCount("#deliveryWorkersCount", users.filter(user => user.roles?.includes("delivery_worker")).length);
        setCount("#deliveryOpenCount", pending.length);
        setCount("#deliveryActiveCount", assigned.length + active.length);
        setCount("#deliveryCompletedCount", completed.length);
        setCount("#statDeliveries", pending.length);


        if (!deliveryRequests.length) {
            list.innerHTML =
                empty(
                    "There are no delivery requests yet."
                );
            return;
        }


        const selected =
            deliveryRequests.find(
                delivery =>
                    delivery.id === inspectedDeliveryId
            );

        const workerName =
            delivery => {
                const worker = delivery.assigned_worker;
                if (worker) {
                    return `${worker.first_name || ""} ${worker.last_name || ""}`.trim() || worker.email || "Assigned courier";
                }
                return delivery.assigned_worker_id || "Unassigned";
            };

        const timestamp =
            value =>
                value
                    ? new Date(value).toLocaleString()
                    : "—";

        const inspection =
            selected
                ? `
                    <section class="admin-drawer-section" style="margin-bottom:14px;">
                        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
                            <h3 style="margin:0;">Delivery inspection</h3>
                            <button class="admin-small-button" data-close-delivery-inspection type="button">Close</button>
                        </div>
                        <div class="admin-drawer-grid" style="margin-top:12px;">
                            <div class="admin-drawer-stat"><span>Order</span><strong>${escapeHtml(selected.order?.order_number || selected.order_id || "—")}</strong></div>
                            <div class="admin-drawer-stat"><span>Status</span><strong>${escapeHtml(selected.status || "pending")}</strong></div>
                            <div class="admin-drawer-stat"><span>Courier</span><strong>${escapeHtml(workerName(selected))}</strong></div>
                            <div class="admin-drawer-stat"><span>Assigned / claimed</span><strong>${escapeHtml(timestamp(selected.assigned_at))}</strong></div>
                            <div class="admin-drawer-stat"><span>Picked up</span><strong>${escapeHtml(timestamp(selected.picked_up_at))}</strong></div>
                            <div class="admin-drawer-stat"><span>Delivered</span><strong>${escapeHtml(timestamp(selected.delivered_at))}</strong></div>
                        </div>
                        <div class="admin-drawer-stat" style="margin-top:10px;"><span>Pickup</span><strong>${escapeHtml(selected.pickup_location || "—")}</strong></div>
                        <div class="admin-drawer-stat" style="margin-top:10px;"><span>Destination</span><strong>${escapeHtml(selected.delivery_destination || "—")}</strong></div>
                    </section>
                `
                : "";


        list.innerHTML = `
            ${inspection}
            <div class="admin-list-item" style="margin-bottom:10px;">
                <div class="admin-list-copy">
                    <strong>${pending.length} pending · ${assigned.length} assigned · ${active.length} active · ${completed.length} completed</strong>
                    <span>Delivery requests are ordered by newest first.</span>
                </div>
            </div>
            ${deliveryRequests.map(delivery => `
                <div class="admin-list-item">
                    <div class="admin-list-icon">D</div>
                    <div class="admin-list-copy">
                        <strong>Order ${escapeHtml(delivery.order?.order_number || String(delivery.order_id || delivery.id).slice(0, 8))}</strong>
                        <span>${escapeHtml(delivery.status || "pending")} · Courier: ${escapeHtml(workerName(delivery))}</span>
                        <span>Pickup: ${escapeHtml(delivery.pickup_location || "—")} → ${escapeHtml(delivery.delivery_destination || "—")}</span>
                        <span>Created: ${escapeHtml(timestamp(delivery.created_at))}</span>
                    </div>
                    <div style="display:grid;justify-items:end;gap:7px;">
                        <strong style="color:#2563eb;font-size:8px;">${money(delivery.estimated_fee || 0)}</strong>
                        <button class="admin-small-button" data-inspect-delivery="${escapeHtml(delivery.id)}" type="button">Inspect</button>
                    </div>
                </div>
            `).join("")}
        `;


        $$('[data-inspect-delivery]')
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () => {
                            inspectedDeliveryId = button.dataset.inspectDelivery;
                            renderDeliveries();
                        }
                    )
            );

        $("[data-close-delivery-inspection]")
            ?.addEventListener(
                "click",
                () => {
                    inspectedDeliveryId = null;
                    renderDeliveries();
                }
            );
    }


    /* ========================================================
       MODERATION
    ======================================================== */

    async function loadReports() {

        try {

            reports =
                await request(
                    "reports",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {

            reports = [];
        }


        $("#countReports")
            .textContent =
            reports.filter(
                report =>
                    ![
                        "resolved",
                        "closed"
                    ]
                    .includes(
                        report.status
                    )
            ).length;
    }


    function renderReports() {

        if (!reports.length) {

            $("#reportsList")
                .innerHTML =
                empty(
                    "No reports are currently recorded."
                );

            return;
        }


        $("#reportsList")
            .innerHTML =
            reports
                .map(
                    report => `

                        <div class="admin-list-item">

                            <div class="admin-list-icon">
                                !
                            </div>

                            <div class="admin-list-copy">

                                <strong>
                                    ${escapeHtml(
                                        report.reason ||
                                        "Marketplace report"
                                    )}
                                </strong>

                                <span>
                                    Status:
                                    ${escapeHtml(
                                        report.status ||
                                        "open"
                                    )}
                                </span>

                            </div>

                            <button
                                class="admin-small-button"
                                type="button"
                            >
                                Review
                            </button>

                        </div>
                    `
                )
                .join("");
    }


    /* ========================================================
       MESSAGES
    ======================================================== */

    async function loadMessages() {

        try {

            messages =
                await request(
                    "messages",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc",
                            limit:"50"
                        }
                    }
                ) || [];

        } catch (_) {

            messages = [];
        }
    }


    function renderMessages() {

        if (!messages.length) {

            $("#messagesList")
                .innerHTML =
                empty(
                    "No message records available."
                );

            return;
        }


        $("#messagesList")
            .innerHTML =
            messages.map(
                message => `

                    <div class="admin-list-item">

                        <div class="admin-list-icon">
                            M
                        </div>

                        <div class="admin-list-copy">

                            <strong>
                                Conversation message
                            </strong>

                            <span>
                                ${escapeHtml(
                                    String(
                                        message.body ||
                                        message.content ||
                                        ""
                                    )
                                    .slice(
                                        0,
                                        110
                                    )
                                )}
                            </span>

                        </div>

                        <span
                            style="
                                color:var(--text-secondary);
                                font-size:7px;
                            "
                        >
                            ${date(
                                message.created_at
                            )}
                        </span>

                    </div>
                `
            )
            .join("");
    }


    /* ========================================================
       REVIEWS
    ======================================================== */

    async function loadReviews() {

        try {

            reviews =
                await request(
                    "reviews",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc",
                            limit:"100"
                        }
                    }
                ) || [];

        } catch (_) {

            reviews = [];
        }
    }


    function renderReviews() {

        if (!reviews.length) {

            $("#reviewsList")
                .innerHTML =
                empty(
                    "No reviews have been recorded yet."
                );

            return;
        }


        $("#reviewsList")
            .innerHTML =
            reviews
                .map(
                    review => `

                        <div class="admin-list-item">

                            <div class="admin-list-icon">
                                R
                            </div>

                            <div class="admin-list-copy">

                                <strong>
                                    Rating:
                                    ${escapeHtml(
                                        review.rating ||
                                        "—"
                                    )}
                                </strong>

                                <span>
                                    ${escapeHtml(
                                        review.comment ||
                                        review.body ||
                                        "No comment"
                                    )}
                                </span>

                            </div>

                            <span
                                style="
                                    color:var(--text-secondary);
                                    font-size:7px;
                                "
                            >
                                ${date(
                                    review.created_at
                                )}
                            </span>

                        </div>
                    `
                )
                .join("");
    }


    /* ========================================================
       WEBSITES
    ======================================================== */

    async function loadWebsites() {

        try {

            websites =
                await request(
                    "business_websites",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {

            websites = [];
        }


        $("#countWebsites")
            .textContent =
            websites.length;

        $("#websiteTotal")
            .textContent =
            websites.length;

        $("#websiteActive")
            .textContent =
            websites.filter(
                site =>
                    site.status ===
                    "active"
            ).length;

        $("#websiteDraft")
            .textContent =
            websites.filter(
                site =>
                    site.status ===
                    "draft"
            ).length;

        $("#websiteSuspended")
            .textContent =
            websites.filter(
                site =>
                    site.status ===
                    "suspended"
            ).length;


        $("#sellerWebsitesCount")
            .textContent =
            websites.length;
    }


    function renderWebsites() {

        if (!websites.length) {

            $("#websitesList")
                .innerHTML =
                empty(
                    "No business websites have been created yet."
                );

            return;
        }


        $("#websitesList")
            .innerHTML =
            websites
                .map(
                    site => `

                        <article class="admin-website-card">

                            <strong>
                                ${escapeHtml(
                                    site.business_name
                                )}
                            </strong>

                            <span class="admin-website-domain">
                                ${escapeHtml(
                                    site.subdomain ||
                                    "No subdomain"
                                )}
                            </span>

                            <div class="admin-website-meta">

                                <span>
                                    ${escapeHtml(
                                        site.template_key ||
                                        "modern"
                                    )}
                                </span>

                                <span>
                                    ${escapeHtml(
                                        site.palette_key ||
                                        "ocean"
                                    )}
                                </span>

                                <span>
                                    ${escapeHtml(
                                        site.status ||
                                        "active"
                                    )}
                                </span>

                            </div>

                            <div
                                style="
                                    display:flex;
                                    gap:6px;
                                    margin-top:11px;
                                "
                            >

                                <button
                                    class="admin-small-button"
                                    data-website-view="${escapeHtml(
                                        site.id
                                    )}"
                                    type="button"
                                >
                                    Inspect
                                </button>

                                <button
                                    class="admin-small-button red"
                                    data-website-delete="${escapeHtml(
                                        site.id
                                    )}"
                                    type="button"
                                >
                                    Delete
                                </button>

                            </div>

                        </article>
                    `
                )
                .join("");


        $$("[data-website-delete]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        async () => {

                            if (
                                !confirm(
                                    "Delete this business website?"
                                )
                            ) {
                                return;
                            }


                            await request(
                                "business_websites",
                                {
                                    method:"DELETE",

                                    query:{
                                        id:
                                            `eq.${button.dataset.websiteDelete}`
                                    },

                                    prefer:
                                        "return=minimal"
                                }
                            );


                            await loadWebsites();

                            renderWebsites();

                        }
                    )
            );
    }


    /* ========================================================
       PLANS
    ======================================================== */

    let plans = [];


    async function loadPlans() {

        try {

            plans =
                await request(
                    "seller_plans",
                    {
                        query:{
                            select:"*",
                            order:
                                "monthly_fee.asc"
                        }
                    }
                ) || [];

        } catch (_) {

            plans = [];
        }
    }


    function renderPlans() {

        if (!plans.length) {

            $("#plansGrid")
                .innerHTML =
                empty(
                    "No seller plans are configured."
                );

            return;
        }


        $("#plansGrid")
            .innerHTML =
            plans
                .map(
                    plan => `

                        <article
                            class="
                                admin-plan-card
                                ${
                                    plan.plan_key ===
                                    "business"
                                        ? "featured"
                                        : ""
                                }
                            "
                        >

                            <span>
                                ${escapeHtml(
                                    plan.name
                                ).toUpperCase()}
                            </span>

                            <h2>
                                ${money(
                                    plan.monthly_fee
                                )}
                            </h2>

                            <small>
                                monthly subscription
                            </small>


                            <div class="admin-plan-field">

                                <span>
                                    Commission rate
                                </span>

                                <input
                                    type="number"
                                    step="0.1"
                                    value="${Number(
                                        plan.commission_rate
                                    )}"
                                    data-plan-commission="${escapeHtml(
                                        plan.plan_key
                                    )}"
                                >

                            </div>


                            <div class="admin-plan-field">

                                <span>
                                    Active listing limit
                                </span>

                                <input
                                    type="number"
                                    value="${Number(
                                        plan.active_listing_limit
                                    )}"
                                    data-plan-limit="${escapeHtml(
                                        plan.plan_key
                                    )}"
                                >

                            </div>


                            <button
                                class="admin-primary-button"
                                style="
                                    width:100%;
                                    margin-top:14px;
                                "
                                data-save-plan="${escapeHtml(
                                    plan.plan_key
                                )}"
                                type="button"
                            >
                                Save plan
                            </button>

                        </article>
                    `
                )
                .join("");


        $$("[data-save-plan]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        async () => {

                            const key =
                                button.dataset.savePlan;


                            const commission =
                                document.querySelector(
                                    `[data-plan-commission="${CSS.escape(key)}"]`
                                );


                            const limit =
                                document.querySelector(
                                    `[data-plan-limit="${CSS.escape(key)}"]`
                                );


                            await request(
                                "seller_plans",
                                {
                                    method:"PATCH",

                                    query:{
                                        plan_key:
                                            `eq.${key}`
                                    },

                                    body:{
                                        commission_rate:
                                            Number(
                                                commission.value
                                            ),

                                        active_listing_limit:
                                            Number(
                                                limit.value
                                            ),

                                        updated_at:
                                            new Date()
                                                .toISOString()
                                    }
                                }
                            );


                            alert(
                                "Seller plan updated."
                            );

                        }
                    )
            );
    }


    /* ========================================================
       CATEGORIES
    ======================================================== */

    async function loadCategories() {

        try {

            categories =
                await request(
                    "categories",
                    {
                        query:{
                            select:"*",
                            order:
                                "name.asc"
                        }
                    }
                ) || [];

        } catch (_) {

            categories = [];
        }
    }


    function renderCategories() {

        if (!categories.length) {

            $("#categoriesList")
                .innerHTML =
                empty(
                    "No categories exist yet."
                );

            return;
        }


        $("#categoriesList")
            .innerHTML =
            categories
                .map(
                    category => `

                        <div class="admin-category-item">

                            <div class="admin-category-icon">

                                <svg
                                    viewBox="0 0 24 24"
                                >
                                    <rect
                                        x="4"
                                        y="4"
                                        width="6"
                                        height="6"
                                        rx="1"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.6"
                                    />

                                    <rect
                                        x="14"
                                        y="4"
                                        width="6"
                                        height="6"
                                        rx="1"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.6"
                                    />

                                    <rect
                                        x="4"
                                        y="14"
                                        width="6"
                                        height="6"
                                        rx="1"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.6"
                                    />

                                    <rect
                                        x="14"
                                        y="14"
                                        width="6"
                                        height="6"
                                        rx="1"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.6"
                                    />
                                </svg>

                            </div>


                            <div class="admin-category-copy">

                                <strong>
                                    ${escapeHtml(
                                        category.name
                                    )}
                                </strong>

                                <span>
                                    ${escapeHtml(
                                        category.description ||
                                        "No description"
                                    )}
                                </span>

                            </div>


                            <button
                                class="admin-small-button"
                                type="button"
                                data-delete-category="${escapeHtml(
                                    category.id
                                )}"
                            >
                                Delete
                            </button>

                        </div>
                    `
                )
                .join("");


        $$("[data-delete-category]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        async () => {

                            if (
                                !confirm(
                                    "Delete this category?"
                                )
                            ) {
                                return;
                            }


                            await request(
                                "categories",
                                {
                                    method:"DELETE",

                                    query:{
                                        id:
                                            `eq.${button.dataset.deleteCategory}`
                                    },

                                    prefer:
                                        "return=minimal"
                                }
                            );


                            await loadCategories();

                            renderCategories();

                        }
                    )
            );
    }


    $("#addCategoryBtn")
        ?.addEventListener(
            "click",
            async () => {

                const name =
                    prompt(
                        "Category name:"
                    );


                if (!name?.trim()) {
                    return;
                }


                const description =
                    prompt(
                        "Category description:"
                    ) ||
                    "";


                await request(
                    "categories",
                    {
                        method:"POST",

                        body:{
                            name:
                                name.trim(),

                            description:
                                description.trim()
                        }
                    }
                );


                await loadCategories();

                renderCategories();

            }
        );


    /* ========================================================
       FEATURED
    ======================================================== */

    async function loadFeatured() {

        try {

            featured =
                products.filter(
                    product =>
                        product.is_featured ===
                        true
                );

        } catch (_) {

            featured = [];
        }
    }


    function renderFeatured() {

        if (!featured.length) {

            $("#featuredList")
                .innerHTML =
                empty(
                    "No featured products are currently configured."
                );

            return;
        }


        $("#featuredList")
            .innerHTML =
            featured
                .map(
                    product => `

                        <article class="admin-product-card">

                            <div
                                class="admin-product-image"
                                style="${
                                    product.main_image
                                        ? `background-image:url("${escapeHtml(
                                            product.main_image
                                        )}")`
                                        : ""
                                }"
                            ></div>

                            <div class="admin-product-copy">

                                <strong>
                                    ${escapeHtml(
                                        product.title
                                    )}
                                </strong>

                                <span>
                                    ${money(
                                        product.price
                                    )}
                                </span>

                                <div class="admin-product-actions">

                                    <button
                                        class="admin-small-button red"
                                        data-remove-featured="${escapeHtml(
                                            product.id
                                        )}"
                                        type="button"
                                    >
                                        Remove
                                    </button>

                                </div>

                            </div>

                        </article>
                    `
                )
                .join("");


        $$("[data-remove-featured]")
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        async () => {

                            await request(
                                "products",
                                {
                                    method:"PATCH",

                                    query:{
                                        id:
                                            `eq.${button.dataset.removeFeatured}`
                                    },

                                    body:{
                                        is_featured:
                                            false
                                    }
                                }
                            );


                            await loadProducts();

                            await loadFeatured();

                            renderFeatured();

                        }
                    )
            );
    }


    /* ========================================================
       EARNINGS
    ======================================================== */

    async function loadEarnings() {

        let earningRows = [];

        let payoutRows = [];


        try {

            earningRows =
                await request(
                    "earning_transactions",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {}


        try {

            payoutRows =
                await request(
                    "payout_requests",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {}


        const total =
            earningRows.reduce(
                (
                    sum,
                    row
                ) =>
                    sum +
                    Number(
                        row.amount ||
                        0
                    ),
                0
            );


        $("#wagesTotal")
            .textContent =
            money(total);


        $("#deliveryWages")
            .textContent =
            money(
                earningRows
                    .filter(
                        row =>
                            String(
                                row.type ||
                                row.category ||
                                ""
                            )
                            .toLowerCase()
                            .includes(
                                "deliver"
                            )
                    )
                    .reduce(
                        (
                            sum,
                            row
                        ) =>
                            sum +
                            Number(
                                row.amount ||
                                0
                            ),
                        0
                    )
            );


        $("#moderationWages")
            .textContent =
            money(
                earningRows
                    .filter(
                        row =>
                            String(
                                row.type ||
                                row.category ||
                                ""
                            )
                            .toLowerCase()
                            .includes(
                                "moder"
                            )
                    )
                    .reduce(
                        (
                            sum,
                            row
                        ) =>
                            sum +
                            Number(
                                row.amount ||
                                0
                            ),
                        0
                    )
            );


        $("#payoutRequests")
            .textContent =
            payoutRows.length;
    }


    /* ========================================================
       PROMOTIONS
    ======================================================== */

    let promotions = [];


    async function loadPromotions() {

        try {

            promotions =
                await request(
                    "promotions",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc"
                        }
                    }
                ) || [];

        } catch (_) {

            promotions = [];
        }
    }


    function renderPromotions() {

        if (!promotions.length) {

            $("#promotionsList")
                .innerHTML =
                empty(
                    "No promotional campaigns have been created."
                );

            return;
        }


        $("#promotionsList")
            .innerHTML =
            promotions
                .map(
                    promo => `

                        <div class="admin-list-item">

                            <div class="admin-list-icon">
                                P
                            </div>

                            <div class="admin-list-copy">

                                <strong>
                                    ${escapeHtml(
                                        promo.title ||
                                        "Promotion"
                                    )}
                                </strong>

                                <span>
                                    ${escapeHtml(
                                        promo.description ||
                                        promo.message ||
                                        ""
                                    )}
                                </span>

                            </div>

                            <span class="admin-role-pill">
                                ${
                                    promo.enabled
                                        ? "ACTIVE"
                                        : "OFF"
                                }
                            </span>

                        </div>
                    `
                )
                .join("");
    }


    $("#createPromotion")
        ?.addEventListener(
            "click",
            async () => {

                const title =
                    $("#popupTitle")
                        .value
                        .trim();


                const message =
                    $("#popupMessage")
                        .value
                        .trim();


                if (
                    !title ||
                    !message
                ) {

                    alert(
                        "Enter a campaign title and message."
                    );

                    return;
                }


                await request(
                    "promotions",
                    {
                        method:"POST",

                        body:{
                            title,

                            description:
                                message,

                            enabled:
                                true,

                            target_audience:
                                $("#popupAudience")
                                    .value,

                            frequency:
                                $("#popupFrequency")
                                    .value,

                            primary_button_text:
                                $("#popupButtonText")
                                    .value
                                    .trim(),

                            primary_action:
                                $("#popupAction")
                                    .value
                                    .trim()
                        }
                    }
                );


                $("#popupTitle").value =
                    "";

                $("#popupMessage").value =
                    "";

                $("#popupButtonText").value =
                    "";

                $("#popupAction").value =
                    "";


                await loadPromotions();

                renderPromotions();

            }
        );


    /* ========================================================
       LOGS
    ======================================================== */

    async function loadLogs() {

        try {

            logs =
                await request(
                    "activity_logs",
                    {
                        query:{
                            select:"*",
                            order:
                                "created_at.desc",
                            limit:"100"
                        }
                    }
                ) || [];

        } catch (_) {

            logs = [];
        }
    }


    function renderLogs() {

        if (!logs.length) {

            $("#logsList")
                .innerHTML =
                empty(
                    "No audit activity has been recorded."
                );

            return;
        }


        $("#logsList")
            .innerHTML =
            logs
                .map(
                    log => `

                        <div class="admin-log-item">

                            <span>
                                ${date(
                                    log.created_at
                                )}
                            </span>

                            <strong>
                                ${escapeHtml(
                                    log.action ||
                                    log.event ||
                                    "Administrative event"
                                )}
                            </strong>

                            <span>
                                ${escapeHtml(
                                    log.user_id ||
                                    "System"
                                )}
                            </span>

                        </div>
                    `
                )
                .join("");


        $("#activityFeed")
            .innerHTML =
            logs
                .slice(
                    0,
                    7
                )
                .map(
                    log => `

                        <div class="admin-activity-item">

                            <div class="admin-activity-avatar">
                                A
                            </div>

                            <div class="admin-activity-copy">

                                <strong>
                                    ${escapeHtml(
                                        log.action ||
                                        log.event ||
                                        "Administrative activity"
                                    )}
                                </strong>

                                <span>
                                    ${date(
                                        log.created_at
                                    )}
                                </span>

                            </div>

                        </div>
                    `
                )
                .join("");
    }


    /* ========================================================
       SETTINGS
    ======================================================== */

    async function loadSettings() {

        let records = [];


        try {

            records =
                await request(
                    "admin_settings",
                    {
                        query:{
                            select:"key,value"
                        }
                    }
                ) || [];

        } catch (_) {

            records = [];
        }


        const map =
            Object.fromEntries(
                records.map(
                    record => [
                        record.key,
                        record.value
                    ]
                )
            );


        const platform =
            map.platform ||
            {};

        const delivery =
            map.delivery ||
            {};


        $("#settingSignups")
            .checked =
            platform.allow_new_signups !== false;


        $("#settingSellers")
            .checked =
            platform.allow_seller_applications !== false;


        $("#settingWorkers")
            .checked =
            platform.allow_worker_applications !== false;


        $("#settingMaintenance")
            .checked =
            platform.maintenance_mode === true;


        $("#settingAutoMatching")
            .checked =
            delivery.auto_matching !== false;
    }


    $("#savePlatformSettings")
        ?.addEventListener(
            "click",
            async () => {

                const platform = {

                    maintenance_mode:
                        $("#settingMaintenance")
                            .checked,

                    allow_new_signups:
                        $("#settingSignups")
                            .checked,

                    allow_seller_applications:
                        $("#settingSellers")
                            .checked,

                    allow_worker_applications:
                        $("#settingWorkers")
                            .checked
                };


                const delivery = {

                    auto_matching:
                        $("#settingAutoMatching")
                            .checked
                };


                await request(
                    "admin_settings",
                    {
                        method:"POST",

                        query:{
                            on_conflict:
                                "key"
                        },

                        body:[
                            {
                                key:"platform",
                                value:platform,
                                updated_at:
                                    new Date()
                                        .toISOString()
                            },

                            {
                                key:"delivery",
                                value:delivery,
                                updated_at:
                                    new Date()
                                        .toISOString()
                            }
                        ],

                        prefer:
                            "resolution=merge-duplicates,return=representation"
                    }
                );


                alert(
                    "Platform settings saved."
                );
            }
        );


    /* ========================================================
       ANALYTICS
    ======================================================== */

    function renderAnalytics() {

        const userBars = [
            17,28,35,31,47,58,66,72,68,82
        ];

        const orderBars = [
            12,25,22,38,45,52,61,57,74,86
        ];


        $("#userChart")
            .innerHTML =
            userBars
                .map(
                    value => `
                        <span
                            style="
                                height:${value}%;
                            "
                        ></span>
                    `
                )
                .join("");


        $("#orderChart")
            .innerHTML =
            orderBars
                .map(
                    value => `
                        <span
                            style="
                                height:${value}%;
                            "
                        ></span>
                    `
                )
                .join("");
    }


    function renderOverviewChart() {

        const values = [
            18,
            25,
            20,
            31,
            43,
            39,
            48,
            61,
            57,
            70,
            67,
            81
        ];


        const max =
            Math.max(
                ...values
            );


        $("#mainChart")
            .innerHTML =
            values
                .map(
                    value =>
                        `
                            <span
                                class="admin-chart-bar"
                                style="
                                    height:${
                                        Math.max(
                                            8,
                                            (
                                                value /
                                                max
                                            ) * 100
                                        )
                                    }%;
                                "
                            ></span>
                        `
                )
                .join("");
    }


    /* ========================================================
       GLOBAL SEARCH
    ======================================================== */

    function openGlobalSearch() {

        $("#searchBackdrop")
            .hidden = false;

        $("#globalSearch")
            .hidden = false;

        $("#globalSearchInput")
            .focus();


        renderSearchResults("");
    }


    function closeGlobalSearch() {

        $("#searchBackdrop")
            .hidden = true;

        $("#globalSearch")
            .hidden = true;

        $("#globalSearchInput")
            .value =
            "";
    }


    $("#globalSearchBtn")
        ?.addEventListener(
            "click",
            openGlobalSearch
        );


    $("#closeSearch")
        ?.addEventListener(
            "click",
            closeGlobalSearch
        );


    $("#searchBackdrop")
        ?.addEventListener(
            "click",
            closeGlobalSearch
        );


    $("#globalSearchInput")
        ?.addEventListener(
            "input",
            event =>
                renderSearchResults(
                    event.target.value
                )
        );


    function renderSearchResults(
        rawQuery
    ) {

        const query =
            String(
                rawQuery ||
                ""
            )
            .toLowerCase()
            .trim();


        const result = [];


        users
            .filter(
                user => {

                    const value =
                        `
                            ${user.first_name || ""}
                            ${user.last_name || ""}
                            ${user.email || ""}
                            ${user.phone || ""}
                        `
                        .toLowerCase();

                    return (
                        !query ||
                        value.includes(
                            query
                        )
                    );
                }
            )
            .slice(
                0,
                8
            )
            .forEach(
                user => {

                    const name =
                        `${user.first_name || ""} ${user.last_name || ""}`
                            .trim() ||
                        "User";


                    result.push({
                        type:"User",
                        label:name,
                        detail:
                            user.email ||
                            "",
                        action:
                            () =>
                                openUser(
                                    user.id
                                )
                    });
                }
            );


        products
            .filter(
                product =>
                    !query ||
                    String(
                        product.title ||
                        ""
                    )
                    .toLowerCase()
                    .includes(
                        query
                    )
            )
            .slice(
                0,
                8
            )
            .forEach(
                product => {

                    result.push({
                        type:"Product",
                        label:
                            product.title,
                        detail:
                            money(
                                product.price
                            ),
                        action:
                            () =>
                                openPage(
                                    "products"
                                )
                    });
                }
            );


        websites
            .filter(
                site =>
                    !query ||
                    String(
                        site.business_name ||
                        ""
                    )
                    .toLowerCase()
                    .includes(
                        query
                    )
            )
            .slice(
                0,
                8
            )
            .forEach(
                site => {

                    result.push({
                        type:"Website",
                        label:
                            site.business_name,
                        detail:
                            site.subdomain ||
                            "",
                        action:
                            () =>
                                openPage(
                                    "websites"
                                )
                    });
                }
            );


        if (!result.length) {

            $("#globalSearchResults")
                .innerHTML =
                empty(
                    "Nothing matched your search."
                );

            return;
        }


        $("#globalSearchResults")
            .innerHTML =
            result
                .map(
                    (item,index) => `

                        <div
                            class="admin-search-result"
                            data-search-index="${index}"
                        >

                            <div>

                                <strong>
                                    ${escapeHtml(
                                        item.label
                                    )}
                                </strong>

                                <span>
                                    ${escapeHtml(
                                        item.detail
                                    )}
                                </span>

                            </div>

                            <span
                                style="
                                    margin-left:auto;
                                    color:#2563eb;
                                    font-size:7px;
                                    font-weight:800;
                                "
                            >
                                ${escapeHtml(
                                    item.type
                                )}
                            </span>

                        </div>
                    `
                )
                .join("");


        $$("[data-search-index]")
            .forEach(
                node =>
                    node.addEventListener(
                        "click",
                        () => {

                            const item =
                                result[
                                    Number(
                                        node.dataset.searchIndex
                                    )
                                ];


                            closeGlobalSearch();

                            item.action();
                        }
                    )
            );
    }


    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "/" &&
                ![
                    "INPUT",
                    "TEXTAREA",
                    "SELECT"
                ]
                .includes(
                    document.activeElement?.tagName
                )
            ) {

                event.preventDefault();

                openGlobalSearch();
            }


            if (
                event.key === "Escape"
            ) {

                closeGlobalSearch();

                closeUser();

                $("#adminSidebar")
                    ?.classList.remove(
                        "open"
                    );

                $("#adminMobileBackdrop")
                    && (
                        $("#adminMobileBackdrop")
                            .hidden = true
                    );

            }

        }
    );


    /* ========================================================
       REFRESH
    ======================================================== */

    $("#refreshAll")
        ?.addEventListener(
            "click",
            async () => {

                const button =
                    $("#refreshAll");


                button.disabled =
                    true;

                button.textContent =
                    "Refreshing...";


                try {

                    await loadEverything();

                    openPage(
                        "overview"
                    );

                } finally {

                    button.disabled =
                        false;

                    button.textContent =
                        "Refresh data";
                }
            }
        );


    $("#refreshProducts")
        ?.addEventListener(
            "click",
            async () => {

                await loadProducts();

                renderProducts();

            }
        );


    /* ========================================================
       MASTER LOAD
    ======================================================== */

    async function loadEverything() {

        await Promise.all([
            loadAdminSection("users", loadUsers),
            loadAdminSection("products", loadProducts, ["products"]),
            loadAdminSection("orders", loadOrders, ["orders"]),
            loadAdminSection("sellers", loadSellers, ["seller_applications", "stores"]),
            loadAdminSection("workers", loadWorkers, ["worker_applications"]),
            loadAdminSection("moderation", loadReports, ["reports"]),
            loadAdminSection("deliveries", loadDeliveries, ["delivery_requests"]),
            loadAdminSection("messages", loadMessages, ["messages"]),
            loadAdminSection("reviews", loadReviews, ["reviews"]),
            loadAdminSection("earnings", loadEarnings, ["earning_transactions", "payout_requests"]),
            loadAdminSection("promotions", loadPromotions, ["promotions"]),
            loadAdminSection("websites", loadWebsites, ["business_websites"]),
            loadAdminSection("plans", loadPlans, ["seller_plans"]),
            loadAdminSection("categories", loadCategories, ["categories"]),
            loadAdminSection("logs", loadLogs, ["activity_logs"])
        ]);


        await loadAdminSection(
            "featured",
            loadFeatured
        );


        $("#statAttention")
            .textContent =
            (
                products.filter(
                    product =>
                        product.status ===
                        "pending"
                ).length
                +
                workers.filter(
                    worker =>
                        worker.status ===
                        "pending" ||
                        !worker.status
                ).length
                +
                reports.filter(
                    report =>
                        ![
                            "resolved",
                            "closed"
                        ].includes(
                            report.status
                        )
                ).length
            );


        renderAdminSection("overview", renderOverviewChart);
        renderAdminSection("analytics", renderAnalytics);

        renderAdminSection("users", renderUsers);
        renderAdminSection("sellers", renderSellers);
        renderAdminSection("products", renderProducts);
        renderAdminSection("orders", renderOrders);
        renderAdminSection("deliveries", renderDeliveries);
        renderAdminSection("workers", renderWorkers);
        renderAdminSection("moderation", renderReports);
        renderAdminSection("messages", renderMessages);
        renderAdminSection("reviews", renderReviews);
        renderAdminSection("promotions", renderPromotions);
        renderAdminSection("websites", renderWebsites);
        renderAdminSection("plans", renderPlans);
        renderAdminSection("categories", renderCategories);
        renderAdminSection("featured", renderFeatured);
        renderAdminSection("logs", renderLogs);

    }


    /* ========================================================
       START
    ======================================================== */

    boot();

})();
