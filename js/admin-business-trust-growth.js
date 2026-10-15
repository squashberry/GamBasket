/* Additive Admin Console panels for the business/trust/growth migration. */
(() => {
    "use strict";
    const client = () => window.GamBasketAuth?.getClient?.() || window.supabaseClient;
    const $ = selector => document.querySelector(selector);
    const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

    function activate(section) {
        document.querySelectorAll(".admin-section").forEach(node => node.classList.toggle("active", node.dataset.section === section));
        document.querySelectorAll(".admin-nav-item").forEach(node => node.classList.toggle("active", node.dataset.page === section));
        const title = $("#pageTitle");
        if (title) title.textContent = section === "business-trust" ? "Trust & Safety" : "Growth";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function rpc(name, args) {
        const { data, error } = await client().rpc(name, args);
        if (error) throw error;
        return data;
    }
    function notice(message, error = false) {
        const node = document.querySelector(".admin-section.active .business-admin-notice");
        if (node) { node.textContent = message; node.style.color = error ? "#b91c1c" : "#047857"; }
    }
    function date(value) { return value ? new Date(value).toLocaleString() : "—"; }

    async function loadTrust() {
        const root = $("#businessTrustContent");
        if (!root) return;
        root.innerHTML = "Loading trust & safety queues…";
        try {
            const [verification, reports, disputes, actions] = await Promise.all([
                client().from("verification_requests").select("*").order("submitted_at", { ascending: false }).limit(50),
                client().from("reports").select("*").order("created_at", { ascending: false }).limit(50),
                client().from("marketplace_disputes").select("*").order("created_at", { ascending: false }).limit(50),
                client().from("account_actions").select("*").order("created_at", { ascending: false }).limit(25)
            ]);
            for (const response of [verification, reports, disputes, actions]) if (response.error) throw response.error;
            const rows = (items, render, empty) => items.length ? `<div class="admin-table-wrap"><table class="admin-table"><tbody>${items.map(render).join("")}</tbody></table></div>` : `<div class="admin-empty">${empty}</div>`;
            root.innerHTML = `
                <div class="admin-card"><header class="admin-card-header"><div><span>VERIFICATION</span><h2>Business verification</h2></div><button class="admin-button" data-trust-refresh>Refresh</button></header>${rows(verification.data || [], item => `<tr><td><strong>${esc(item.business_name || item.role_type)}</strong><br><small>${esc(item.role_type)} · ${esc(item.status)}</small></td><td>${date(item.submitted_at)}</td><td>${item.status === "pending" || item.status === "needs_information" ? `<button class="admin-button" data-verify="${item.id}" data-status="approved">Approve</button> <button class="admin-button admin-button-danger" data-verify="${item.id}" data-status="rejected">Reject</button>` : "—"}</td></tr>`, "No verification requests.")}</div>
                <div class="admin-card"><header class="admin-card-header"><div><span>REPORTS</span><h2>Marketplace reports</h2></div></header>${rows(reports.data || [], item => `<tr><td><strong>${esc(item.target_type || "Marketplace")} report</strong><br><small>${esc(item.reason)}</small></td><td>${esc(item.status)}</td><td>${!['resolved','dismissed'].includes(item.status) ? `<button class="admin-button" data-report="${item.id}">Resolve</button>` : "—"}</td></tr>`, "No open reports.")}</div>
                <div class="admin-card"><header class="admin-card-header"><div><span>DISPUTES</span><h2>Order disputes</h2></div></header>${rows(disputes.data || [], item => `<tr><td><strong>${esc(item.reason)}</strong><br><small>Order ${esc(item.order_id)}</small></td><td>${esc(item.status)}</td><td>${!['resolved','dismissed'].includes(item.status) ? `<button class="admin-button" data-dispute="${item.id}">Resolve</button>` : "—"}</td></tr>`, "No disputes.")}</div>
                <div class="admin-card"><header class="admin-card-header"><div><span>ACCOUNT ACTIONS</span><h2>Warn, suspend, or ban</h2></div></header><form id="accountActionForm" class="admin-toolbar"><input name="userId" placeholder="User UUID" required><select name="action"><option value="warning">Warning</option><option value="suspend">Suspend</option><option value="ban">Ban</option><option value="unsuspend">Unsuspend</option><option value="unban">Unban</option></select><input name="reason" placeholder="Reason" required><button class="admin-button" type="submit">Apply action</button></form>${rows(actions.data || [], item => `<tr><td>${esc(item.action_type)}</td><td>${esc(item.reason)}</td><td>${date(item.created_at)}</td></tr>`, "No account actions recorded.")}</div>`;
            root.querySelector("[data-trust-refresh]")?.addEventListener("click", loadTrust);
            root.querySelectorAll("[data-verify]").forEach(button => button.addEventListener("click", async () => {
                const status = button.dataset.status;
                if (!confirm(`${status === "approved" ? "Approve" : "Reject"} this verification request?`)) return;
                try { await rpc("admin_set_verification", { p_request_id: button.dataset.verify, p_status: status, p_notes: null }); notice("Verification updated."); loadTrust(); } catch (error) { notice(error.message, true); }
            }));
            root.querySelectorAll("[data-report]").forEach(button => button.addEventListener("click", async () => {
                const resolution = prompt("Required resolution note:");
                if (resolution === null) return;
                if (!resolution.trim()) { notice("A resolution note is required.", true); return; }
                if (!confirm("Resolve this report?")) return;
                try { await rpc("resolve_marketplace_report", { p_report_id: button.dataset.report, p_status: "resolved", p_resolution: resolution.trim() }); notice("Report resolved."); loadTrust(); } catch (error) { notice(error.message, true); }
            }));
            root.querySelectorAll("[data-dispute]").forEach(button => button.addEventListener("click", async () => {
                const resolution = prompt("Required resolution note:");
                if (resolution === null) return;
                if (!resolution.trim()) { notice("A resolution note is required.", true); return; }
                if (!confirm("Resolve this dispute?")) return;
                try { await rpc("admin_resolve_marketplace_dispute", { p_dispute_id: button.dataset.dispute, p_status: "resolved", p_resolution: resolution.trim() }); notice("Dispute resolved."); loadTrust(); } catch (error) { notice(error.message, true); }
            }));
            root.querySelector("#accountActionForm")?.addEventListener("submit", async event => {
                event.preventDefault(); const form = new FormData(event.currentTarget); const action = form.get("action");
                if (!confirm(`Apply ${action} to this account?`)) return;
                try { await rpc("admin_account_action", { p_user_id: form.get("userId"), p_action: action, p_reason: form.get("reason"), p_expires_at: null }); notice("Account action recorded."); loadTrust(); } catch (error) { notice(error.message, true); }
            });
        } catch (error) { root.textContent = `Unable to load trust queues: ${error.message}`; }
    }

    async function loadGrowth() {
        const root = $("#businessGrowthContent"); if (!root) return;
        root.innerHTML = "Loading growth tools…";
        try {
            const [campaigns, featured, promotions] = await Promise.all([
                client().from("marketplace_campaigns").select("*").order("starts_at", { ascending: false }).limit(30),
                client().from("featured_products").select("*,products(title)").order("created_at", { ascending: false }).limit(30),
                client().from("seller_promotions").select("*").order("created_at", { ascending: false }).limit(30)
            ]);
            for (const response of [campaigns, featured, promotions]) if (response.error) throw response.error;
            root.innerHTML = `<div class="admin-card"><header class="admin-card-header"><div><span>FEATURED</span><h2>Feature a product</h2></div></header><form id="featureProductForm" class="admin-toolbar"><input name="productId" placeholder="Product UUID" required><input name="placement" value="home" placeholder="Placement"><input name="priority" type="number" value="0" placeholder="Priority"><input name="endsAt" type="datetime-local"><button class="admin-button" type="submit">Feature product</button></form><div class="admin-empty">${(featured.data || []).map(row => `${esc(row.products?.title || row.product_id)} · ${esc(row.placement)} · ${esc(row.status)}`).join("<br>") || "No featured products."}</div></div><div class="admin-card"><header class="admin-card-header"><div><span>CAMPAIGNS</span><h2>Create marketplace campaign</h2></div></header><form id="campaignForm" class="admin-form-grid"><input name="name" placeholder="Campaign name" required><input name="slug" placeholder="campaign-slug"><input name="startsAt" type="datetime-local" required><input name="endsAt" type="datetime-local" required><input name="boost" type="number" min="0" step="0.01" value="0" placeholder="Affiliate boost %"><input name="banner" placeholder="Banner URL"><textarea name="description" placeholder="Description"></textarea><button class="admin-button" type="submit">Launch campaign</button></form><div class="admin-empty">${(campaigns.data || []).map(row => `${esc(row.name)} · ${esc(row.is_active ? "active" : "inactive")}`).join("<br>") || "No campaigns."}</div></div><div class="admin-card"><header class="admin-card-header"><div><span>SELLER PROMOTIONS</span><h2>Current promotions</h2></div></header><div class="admin-empty">${(promotions.data || []).map(row => `${esc(row.title)} · ${esc(row.promotion_type)} · ${esc(row.is_active ? "active" : "inactive")}`).join("<br>") || "No seller promotions."}</div></div><div class="admin-card"><header class="admin-card-header"><div><span>NOTIFICATIONS</span><h2>Send a targeted notification</h2></div></header><form id="growthNotificationForm" class="admin-form-grid"><input name="userId" placeholder="Recipient user UUID" required><input name="title" placeholder="Title" required><input name="actionUrl" placeholder="Action URL"><textarea name="message" placeholder="Message" required></textarea><button class="admin-button" type="submit">Send notification</button></form></div>`;
            root.querySelector("#featureProductForm")?.addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.currentTarget); if (!confirm("Feature this product?")) return; try { await rpc("admin_feature_product", { p_product_id: form.get("productId"), p_placement: form.get("placement"), p_priority: Number(form.get("priority")), p_ends_at: form.get("endsAt") || null }); notice("Product featured."); loadGrowth(); } catch (error) { notice(error.message, true); } });
            root.querySelector("#campaignForm")?.addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.currentTarget); if (!confirm("Launch this campaign?")) return; try { await rpc("admin_create_campaign", { p_name: form.get("name"), p_slug: form.get("slug"), p_description: form.get("description"), p_banner_url: form.get("banner"), p_starts_at: form.get("startsAt"), p_ends_at: form.get("endsAt"), p_affiliate_commission_boost: Number(form.get("boost")) }); notice("Campaign launched."); loadGrowth(); } catch (error) { notice(error.message, true); } });
            root.querySelector("#growthNotificationForm")?.addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.currentTarget); if (!confirm("Send this notification?")) return; try { await rpc("admin_send_growth_notification", { p_user_id: form.get("userId"), p_title: form.get("title"), p_message: form.get("message"), p_type: "campaign", p_action_url: form.get("actionUrl") || null }); notice("Notification sent."); event.currentTarget.reset(); } catch (error) { notice(error.message, true); } });
        } catch (error) { root.textContent = `Unable to load growth tools: ${error.message}`; }
    }

    function setup() {
        const nav = $("#adminNav"), main = $(".admin-main");
        if (!nav || !main || $("#businessTrustContent")) return;
        nav.insertAdjacentHTML("beforeend", '<div class="admin-nav-label">TRUST &amp; GROWTH</div><button class="admin-nav-item" data-page="business-trust" type="button"><span class="admin-nav-icon"><svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg></span><span>Trust &amp; Safety</span></button><button class="admin-nav-item" data-page="business-growth" type="button"><span class="admin-nav-icon"><svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-8M22 19V3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><span>Growth tools</span></button>');
        main.insertAdjacentHTML("beforeend", '<section class="admin-section" data-section="business-trust"><div class="admin-page-heading"><div><div class="admin-heading-label">TRUST &amp; SAFETY</div><h1>Trust &amp; Safety</h1><p>Verification, reports, disputes, and account actions are server-authorized and audited.</p></div></div><p class="business-admin-notice" role="status"></p><div id="businessTrustContent" class="admin-grid"></div></section><section class="admin-section" data-section="business-growth"><div class="admin-page-heading"><div><div class="admin-heading-label">GROWTH</div><h1>Growth tools</h1><p>Featured products, campaigns, seller promotions, and targeted notifications.</p></div></div><p class="business-admin-notice" role="status"></p><div id="businessGrowthContent" class="admin-grid"></div></section>');
        nav.querySelectorAll('[data-page="business-trust"],[data-page="business-growth"]').forEach(button => button.addEventListener("click", () => { activate(button.dataset.page); button.dataset.page === "business-trust" ? loadTrust() : loadGrowth(); }));
    }
    document.addEventListener("DOMContentLoaded", setup);
})();
