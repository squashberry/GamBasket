/* Administrative affiliate workspace. All sensitive actions use protected RPCs. */
(() => {
    "use strict";

    const $ = id => document.getElementById(id);
    const state = { tab: "overview", search: "", status: "", loaded: new Set() };
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    const money = value => `D ${Number(value || 0).toLocaleString("en-GM", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    const date = value => value ? new Date(value).toLocaleString() : "—";
    const status = value => `<span class="affiliate-status ${escape(value)}">${escape(value)}</span>`;
    const empty = message => `<div class="affiliate-empty">${escape(message)}</div>`;

    async function client() {
        await window.GamBasketAuth?.ready?.();
        const instance = window.GamBasketAuth?.getClient?.() || window.supabaseClient || window.gambasketSupabase;
        if (!instance) throw new Error("Supabase client unavailable.");
        return instance;
    }

    async function rpc(name, args = {}) {
        const { data, error } = await (await client()).rpc(name, args);
        if (error) throw error;
        return data;
    }

    function table(headers, rows) {
        return rows.length ? `<table class="affiliate-data-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>` : empty("Nothing to show yet.");
    }

    async function loadOverview() {
        const overview = await rpc("admin_affiliate_overview");
        $("affiliateStatAffiliates").textContent = Number(overview.affiliate_count || 0).toLocaleString();
        $("affiliateStatClicks").textContent = Number(overview.total_clicks || 0).toLocaleString();
        $("affiliateStatConversions").textContent = Number(overview.total_orders || 0).toLocaleString();
        $("affiliateStatSales").textContent = money(overview.total_sales);
        $("affiliateStatPending").textContent = money(overview.pending_commission);
        $("affiliateStatApproved").textContent = money(overview.approved_commission);
    }

    async function loadAffiliates() {
        const rows = await rpc("admin_list_affiliates", { p_search: state.search || null, p_status: state.status || "all", p_limit: 100, p_offset: 0 });
        $("affiliateList").innerHTML = table(
            ["Affiliate", "Code", "Status", "Clicks", "Orders", "Sales", "Actions"],
            rows.map(row => `<tr><td><strong>${escape(row.display_name || "GamBasket Affiliate")}</strong><br><small>${escape(row.email || "")}</small></td><td>${escape(row.affiliate_code)}</td><td>${status(row.status)}</td><td>${Number(row.total_clicks || 0).toLocaleString()}</td><td>${Number(row.total_orders || 0).toLocaleString()}</td><td>${money(row.total_sales)}</td><td><button data-affiliate-view="${row.id}">View</button><button data-affiliate-status="${row.id}" data-status="${row.status === "active" ? "suspended" : "active"}">${row.status === "active" ? "Suspend" : "Activate"}</button></td></tr>`)
        );
        document.querySelectorAll("[data-affiliate-view]").forEach(button => button.addEventListener("click", () => openAffiliateDetail(button.dataset.affiliateView)));
        document.querySelectorAll("[data-affiliate-status]").forEach(button => button.addEventListener("click", async () => {
            if (!confirm(`${button.dataset.status === "active" ? "Activate" : "Suspend"} this affiliate?`)) return;
            await action(() => rpc("admin_set_affiliate_status", { p_affiliate_id: button.dataset.affiliateStatus, p_status: button.dataset.status }));
        }));
    }

    async function openAffiliateDetail(affiliateId) {
        const target = $("affiliateDetail");
        target.hidden = false;
        target.innerHTML = empty("Loading affiliate details…");
        const detail = await rpc("admin_get_affiliate_detail", { p_affiliate_id: affiliateId });
        const affiliate = detail.profile;
        if (!affiliate) { target.innerHTML = empty("Affiliate not found."); return; }
        target.innerHTML = `<button id="closeAffiliateDetail" class="admin-small-button" type="button">Close</button><h2>${escape(`${affiliate.first_name || ""} ${affiliate.last_name || ""}`.trim() || affiliate.display_name || "Affiliate")}</h2><p>${escape(affiliate.email || "")} · ${escape(affiliate.affiliate_code)} · ${status(affiliate.status)}</p><div class="affiliate-detail-grid"><div><span>Clicks</span><strong>${Number(affiliate.total_clicks || 0).toLocaleString()}</strong></div><div><span>Orders</span><strong>${Number(affiliate.total_orders || 0).toLocaleString()}</strong></div><div><span>Sales</span><strong>${money(affiliate.total_sales)}</strong></div><div><span>Commission</span><strong>${money(affiliate.total_commission)}</strong></div></div><h3>Promoted products</h3>${table(["Product", "Clicks", "Created"], (detail.links || []).map(link => `<tr><td>${escape(link.title || "Removed product")}</td><td>${Number(link.clicks || 0).toLocaleString()}</td><td>${date(link.created_at)}</td></tr>`))}<h3>Commission history</h3>${table(["Order", "Sale", "Commission", "Status"], (detail.conversions || []).map(conversion => `<tr><td>${escape(conversion.order_number || conversion.order_id)}</td><td>${money(conversion.sale_amount)}</td><td>${money(conversion.commission_amount)}</td><td>${status(conversion.status)}</td></tr>`))}`;
        $("closeAffiliateDetail").addEventListener("click", () => { target.hidden = true; });
    }

    async function loadTraffic() {
        const rows = await rpc("admin_list_affiliate_clicks", { p_affiliate_id: null, p_limit: 100 });
        $("affiliateTrafficList").innerHTML = table(["When", "Affiliate code", "Product", "Visitor", "Landing page"], rows.map(row => `<tr><td>${date(row.created_at)}</td><td><strong>${escape(row.affiliate_code || "Affiliate")}</strong></td><td>${escape(row.product_title || "Marketplace")}</td><td>${escape(row.visitor_id || "Signed-in visitor")}</td><td>${escape(row.landing_page || "—")}</td></tr>`));
    }

    async function loadConversions() {
        const rows = await rpc("admin_list_affiliate_conversions", { p_status: $("affiliateConversionStatus").value || "all", p_limit: 200 });
        $("affiliateConversionsList").innerHTML = table(["Affiliate", "Order", "Sale", "Commission", "Status", "Actions"], rows.map(row => `<tr><td>${escape(row.affiliate_name)}<br><small>${escape(row.affiliate_code)}</small></td><td>${escape(row.order_number || row.order_id)}</td><td>${money(row.sale_amount)}</td><td>${money(row.commission_amount)} <small>(${Number(row.commission_rate)}%)</small></td><td>${status(row.status)}</td><td>${row.status === "pending" ? `<button data-commission-approve="${row.id}">Approve</button><button class="danger" data-commission-reject="${row.id}">Reject</button>` : "—"}</td></tr>`));
        document.querySelectorAll("[data-commission-approve]").forEach(button => button.addEventListener("click", () => action(() => rpc("admin_approve_commission", { p_conversion_id: button.dataset.commissionApprove }))));
        document.querySelectorAll("[data-commission-reject]").forEach(button => button.addEventListener("click", () => {
            const reason = prompt("Why are you rejecting this commission?");
            if (reason !== null) action(() => rpc("admin_reject_commission", { p_conversion_id: button.dataset.commissionReject, p_reason: reason }));
        }));
    }

    async function loadPayouts() {
        const rows = await rpc("admin_list_affiliate_payouts", { p_status: $("affiliatePayoutStatus").value || "all", p_limit: 200 });
        $("affiliatePayoutsList").innerHTML = table(["Affiliate", "Amount", "Payment", "Status", "Requested", "Actions"], rows.map(row => `<tr><td>${escape(row.affiliate_name)}<br><small>${escape(row.affiliate_code)}</small></td><td>${money(row.amount)}</td><td>${escape(row.payment_method)}<br><small>${escape(row.payment_account)}</small></td><td>${status(row.status)}</td><td>${date(row.created_at)}</td><td>${row.status === "pending" ? `<button data-payout-approve="${row.id}">Approve</button><button class="danger" data-payout-reject="${row.id}">Reject</button>` : row.status === "approved" ? `<button data-payout-pay="${row.id}">Mark paid</button><button class="danger" data-payout-reject="${row.id}">Reject</button>` : "—"}</td></tr>`));
        document.querySelectorAll("[data-payout-approve]").forEach(button => button.addEventListener("click", () => action(() => rpc("admin_approve_affiliate_payout", { p_payout_id: button.dataset.payoutApprove, p_notes: "Approved by GamBasket administration." }))));
        document.querySelectorAll("[data-payout-reject]").forEach(button => button.addEventListener("click", () => { const reason = prompt("Reason for rejecting payout:"); if (reason !== null) action(() => rpc("admin_reject_affiliate_payout", { p_payout_id: button.dataset.payoutReject, p_reason: reason })); }));
        document.querySelectorAll("[data-payout-pay]").forEach(button => button.addEventListener("click", () => { if (confirm("Confirm that this payout has actually been sent?")) action(() => rpc("admin_mark_affiliate_payout_paid", { p_payout_id: button.dataset.payoutPay })); }));
    }

    async function loadSettings() {
        const row = await rpc("admin_get_affiliate_settings");
        $("affiliateEnabled").checked = Boolean(row.enabled);
        $("affiliateDefaultRate").value = row.default_commission_rate;
        $("affiliateMinimumPayout").value = row.minimum_payout;
        $("affiliateAttributionDays").value = row.attribution_days;
    }

    async function saveSettings() {
        await action(() => rpc("admin_update_affiliate_settings", {
            p_enabled: $("affiliateEnabled").checked,
            p_commission_rate: Number($("affiliateDefaultRate").value),
            p_minimum_payout: Number($("affiliateMinimumPayout").value),
            p_attribution_days: Number($("affiliateAttributionDays").value)
        }));
    }

    async function action(callback) {
        try { await callback(); await loadEverything(); }
        catch (error) { alert(window.getAuthErrorMessage?.(error) || error.message || "Administrative operation failed."); }
    }

    async function switchTab(tab) {
        state.tab = tab;
        document.querySelectorAll(".affiliate-admin-tab").forEach(button => button.classList.toggle("active", button.dataset.affTab === tab));
        document.querySelectorAll(".affiliate-admin-panel").forEach(panel => panel.classList.toggle("active", panel.id === `affiliate${tab[0].toUpperCase()}${tab.slice(1)}Panel`));
        await loadCurrentTab();
    }

    async function loadCurrentTab() {
        if (state.tab === "overview") return loadOverview();
        if (state.tab === "affiliates") return loadAffiliates();
        if (state.tab === "traffic") return loadTraffic();
        if (state.tab === "conversions") return loadConversions();
        if (state.tab === "payouts") return loadPayouts();
        if (state.tab === "settings") return loadSettings();
    }

    async function loadEverything() { await Promise.all([loadOverview(), loadCurrentTab()]); }

    function init() {
        if (!$("affiliateOverviewPanel")) return;
        document.querySelectorAll(".affiliate-admin-tab").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.affTab).catch(console.error)));
        document.querySelector('[data-page="affiliate"]')?.addEventListener("click", () => loadEverything().catch(console.error));
        $("affiliateRefresh").addEventListener("click", () => loadEverything().catch(console.error));
        let timer;
        $("affiliateSearch").addEventListener("input", event => { state.search = event.target.value.trim(); clearTimeout(timer); timer = setTimeout(() => loadAffiliates().catch(console.error), 300); });
        $("affiliateStatusFilter").addEventListener("change", event => { state.status = event.target.value; loadAffiliates().catch(console.error); });
        $("affiliateConversionStatus").addEventListener("change", () => loadConversions().catch(console.error));
        $("affiliatePayoutStatus").addEventListener("change", () => loadPayouts().catch(console.error));
        $("saveAffiliateSettings").addEventListener("click", saveSettings);
    }

    window.GamBasketAdminAffiliate = { loadEverything, switchTab, loadAffiliates, loadConversions, loadPayouts, loadTraffic, openAffiliateDetail };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
