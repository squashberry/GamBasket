"use strict";

(() => {
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];
    const form = $("#websiteBuilderForm");
    if (!form) return;

    const fields = {
        name: $("#businessName"), description: $("#businessDescription"), location: $("#businessLocation"),
        phone: $("#businessPhone"), whatsapp: $("#businessWhatsapp"), palette: $("#businessPalette"),
        template: $("#businessTemplate"), hours: $("#businessHours"), logo: $("#businessLogo"), cover: $("#businessCover")
    };
    let editingId = null;
    let logoFile = null;
    let coverFile = null;

    function config() {
        const value = window.GamBasketConfig || window.gambasketConfig || window.AppConfig || {};
        return { url: value.SUPABASE_URL || window.SUPABASE_URL || "", key: value.SUPABASE_ANON_KEY || value.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY || "" };
    }

    async function session() {
        if (!window.GamBasketAuth?.getSession) return null;
        await window.GamBasketAuth.ready();
        return window.GamBasketAuth.getSession();
    }

    function slugify(value) {
        return String(value || "").toLowerCase().trim().replace(/["']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "business";
    }

    function publicUrl(slug) {
        return `https://${slug}.gambasket.com`;
    }

    async function api(method, table, query, body, prefer = "return=representation") {
        const current = await session();
        const details = config();
        if (!details.url || !details.key || !current?.access_token) throw new Error("GamBasket account connection is unavailable.");
        const url = new URL(`${details.url}/rest/v1/${table}`);
        Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
        const response = await fetch(url, { method, headers: { apikey: details.key, Authorization: `Bearer ${current.access_token}`, "Content-Type": "application/json", Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
        const text = await response.text();
        const result = text ? JSON.parse(text) : null;
        if (!response.ok) throw new Error(result?.message || "Unable to complete the website request.");
        return result;
    }

    function imagePreview(file, preview, box) {
        if (!file) return;
        if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) throw new Error("Images must be 5MB or smaller.");
        const reader = new FileReader();
        reader.onload = event => { preview.src = event.target.result; box.classList.add("has-image"); };
        reader.readAsDataURL(file);
    }

    [fields.logo, fields.cover].forEach(input => input?.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            imagePreview(file, $(input === fields.logo ? "#logoPreview" : "#coverPreview"), input.closest(".upload-box"));
            if (input === fields.logo) logoFile = file; else coverFile = file;
        } catch (error) { input.value = ""; alert(error.message); }
    }));

    $$(".template-card").forEach(card => card.addEventListener("click", () => {
        $$(".template-card").forEach(item => item.classList.remove("selected"));
        card.classList.add("selected");
        fields.template.value = card.dataset.template;
        $("#websitePreview").dataset.template = card.dataset.template;
        updatePreview();
    }));

    function initials(name) { return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join("") || "GB"; }
    function updatePreview() {
        const name = fields.name.value.trim() || "Your Business";
        $("#previewBusinessName").textContent = name;
        $("#previewHeading").textContent = name;
        $("#previewDescription").textContent = fields.description.value.trim() || "Your business description will appear here.";
        $("#previewLocation").textContent = fields.location.value.trim() || "The Gambia";
        if (!logoFile) $("#previewLogo").textContent = initials(name);
        $("#previewCover").style.background = ({ blue: "linear-gradient(135deg,#2563eb,#06b6d4)", green: "linear-gradient(135deg,#059669,#10b981)", purple: "linear-gradient(135deg,#7c3aed,#ec4899)", orange: "linear-gradient(135deg,#b45309,#f59e0b)", black: "linear-gradient(135deg,#111827,#4b5563)" })[fields.palette.value] || "#2563eb";
    }
    Object.values(fields).forEach(field => field?.addEventListener("input", updatePreview));
    Object.values(fields).forEach(field => field?.addEventListener("change", updatePreview));

    async function upload(file, userId) {
        if (!file) return null;
        const details = config();
        const name = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9.]+/gi, "-")}`;
        const current = await session();
        const response = await fetch(`${details.url}/storage/v1/object/business-sites/${name}`, { method: "POST", headers: { apikey: details.key, Authorization: `Bearer ${current.access_token}`, "Content-Type": file.type, "x-upsert": "true" }, body: file });
        if (!response.ok) throw new Error("We couldn't upload one of your images.");
        return `${details.url}/storage/v1/object/public/business-sites/${name}`;
    }

    async function save() {
        const current = await session();
        if (!current?.user) throw new Error("Please sign in before creating a business website.");
        const name = fields.name.value.trim();
        if (!name) { fields.name.focus(); throw new Error("Enter your business name."); }
        const existing = editingId ? (await api("GET", "business_websites", { id: `eq.${editingId}`, user_id: `eq.${current.user.id}` }))[0] : null;
        const row = { user_id: current.user.id, business_name: name, description: fields.description.value.trim(), location: fields.location.value.trim(), phone: fields.phone.value.trim(), whatsapp: fields.whatsapp.value.trim(), palette: fields.palette.value, template: fields.template.value, opening_hours: fields.hours.value.trim(), status: "published", published_at: new Date().toISOString() };
        if (!existing) row.slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;
        const logo = await upload(logoFile, current.user.id);
        const cover = await upload(coverFile, current.user.id);
        if (logo) row.logo_url = logo;
        if (cover) row.cover_url = cover;
        const rows = editingId ? await api("PATCH", "business_websites", { id: `eq.${editingId}`, user_id: `eq.${current.user.id}` }, row) : await api("POST", "business_websites", {}, row);
        return rows?.[0] || existing || row;
    }

    function escape(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]); }
    async function load() {
        const list = $("#websiteList");
        if (!list) return;
        try {
            const current = await session();
            if (!current?.user) throw new Error("Please sign in to manage your business websites.");
            const sites = await api("GET", "business_websites", { user_id: `eq.${current.user.id}`, order: "created_at.desc" });
            list.innerHTML = sites.length ? sites.map(site => `<article class="website-item"><div class="website-item-cover" style="${site.cover_url ? `background-image:url('${escape(site.cover_url)}')` : ""}"></div><div class="website-item-info"><strong>${escape(site.business_name)}</strong><span>${escape(publicUrl(site.slug))}</span><em>${escape(site.status)}</em></div><div class="website-item-actions"><a href="../business.html?site=${encodeURIComponent(site.slug)}" target="_blank" rel="noopener">Preview</a><button type="button" data-edit="${escape(site.id)}">Edit</button><button type="button" data-share="${escape(publicUrl(site.slug))}">Share</button><button type="button" class="delete" data-delete="${escape(site.id)}">Delete</button></div></article>`).join("") : `<div class="website-list-empty"><strong>You haven't created a website yet.</strong><span>Choose a template above and launch your first business website.</span></div>`;
            list.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => edit(button.dataset.edit)));
            list.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => remove(button.dataset.delete)));
            list.querySelectorAll("[data-share]").forEach(button => button.addEventListener("click", () => share(button.dataset.share)));
        } catch (error) { list.innerHTML = `<div class="website-list-empty"><strong>Couldn't load your websites</strong><span>${escape(error.message)}</span></div>`; }
    }

    async function edit(id) {
        const current = await session();
        const site = (await api("GET", "business_websites", { id: `eq.${id}`, user_id: `eq.${current.user.id}` }))[0];
        if (!site) return;
        editingId = site.id;
        fields.name.value = site.business_name || ""; fields.description.value = site.description || ""; fields.location.value = site.location || ""; fields.phone.value = site.phone || ""; fields.whatsapp.value = site.whatsapp || ""; fields.palette.value = site.palette || "blue"; fields.template.value = site.template || "aurora"; fields.hours.value = site.opening_hours || "";
        $$(".template-card").forEach(card => card.classList.toggle("selected", card.dataset.template === fields.template.value));
        $("#websitePreview").dataset.template = fields.template.value; $("#createWebsiteButton span").textContent = "Save Website Changes"; updatePreview(); window.scrollTo({ top: 0, behavior: "smooth" });
    }
    async function remove(id) { if (!confirm("Delete this business website? This cannot be undone.")) return; try { await api("DELETE", "business_websites", { id: `eq.${id}` }, null, "return=minimal"); await load(); } catch (error) { alert(error.message); } }
    async function share(url) { try { if (navigator.share) await navigator.share({ title: "GamBasket Business Website", url }); else { await navigator.clipboard.writeText(url); alert("Website link copied."); } } catch (_) {} }

    const stages = ["Assembling your information...", "Designing your brand system...", "Combining your content...", "Compiling your website...", "Optimising animations...", "Publishing your website..."];
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    async function build(website) {
        const overlay = $("#buildingOverlay"); overlay.hidden = false;
        for (let index = 0; index < stages.length; index += 1) { $("#buildingTitle").textContent = stages[index]; $("#buildingProgressBar").style.width = `${Math.round(((index + 1) / stages.length) * 96)}%`; $$(".building-stages > div").forEach((item, itemIndex) => item.className = itemIndex < index ? "complete" : itemIndex === index ? "active" : ""); await wait(450); }
        $("#buildingProgressBar").style.width = "100%"; $("#buildingTitle").textContent = "Your website is live."; $("#buildingDescription").textContent = "Everything is ready. Your business now has its own website."; $("#buildingDone").hidden = false; $("#buildingWebsiteLink").href = publicUrl(website.slug);
    }

    form.addEventListener("submit", async event => { event.preventDefault(); const button = $("#createWebsiteButton"); const original = button.querySelector("span").textContent; button.disabled = true; button.querySelector("span").textContent = "Preparing..."; try { const website = await save(); await build(website); editingId = null; logoFile = null; coverFile = null; await load(); } catch (error) { $("#buildingOverlay").hidden = true; alert(error.message); } finally { button.disabled = false; button.querySelector("span").textContent = original; } });
    updatePreview();
    window.GamBasketAuth?.ready?.().then(load).catch(() => load());
})();
