"use strict";
(() => {
    const $ = selector => document.querySelector(selector);
    const config = () => { const value = window.GamBasketConfig || window.gambasketConfig || window.AppConfig || {}; return { url: value.SUPABASE_URL || window.SUPABASE_URL || "", key: value.SUPABASE_ANON_KEY || value.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY || "" }; };
    function slugFromHost() { const query = new URLSearchParams(location.search).get("site"); if (query) return query; const parts = location.hostname.split("."); return parts.length >= 3 && parts.at(-2) === "gambasket" ? parts[0] : null; }
    async function fetchRows(path) { const details = config(); if (!details.url || !details.key) throw new Error("GamBasket connection unavailable."); const response = await fetch(`${details.url}/rest/v1/${path}`, { headers: { apikey: details.key, Authorization: `Bearer ${details.key}` } }); if (!response.ok) throw new Error("Website could not be loaded."); return response.json(); }
    const text = (selector, value) => { const element = $(selector); if (element) element.textContent = value || ""; };
    const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
    function render(site) {
        document.body.dataset.template = site.template || "aurora";
        const name = site.business_name || "Business";
        document.title = `${name} - GamBasket`;
        $("#siteMetaDescription")?.setAttribute("content", site.description || `${name} official website.`);
        text("#loadingBusinessName", name); text("#businessNameHeader", name); text("#heroTitle", name); text("#heroDescription", site.description || "Discover our products and services."); text("#aboutDescription", site.description || "Learn more about this business."); text("#businessLocation", site.location || "The Gambia"); text("#heroLocation", `Based in ${site.location || "The Gambia"}`); text("#footerBusinessName", name);
        const logo = $("#businessLogo"); if (site.logo_url) logo.innerHTML = `<img src="${escape(site.logo_url)}" alt="${escape(name)}">`; const cover = $(".hero-background"); if (site.cover_url) cover.style.backgroundImage = `linear-gradient(110deg,rgba(2,6,23,.8),rgba(15,23,42,.35)),url("${escape(site.cover_url)}")`;
        if (site.whatsapp) $("#contactWhatsapp").href = `https://wa.me/${site.whatsapp.replace(/\D/g, "")}`; if (site.phone) $("#contactPhone").href = `tel:${site.phone}`;
        $("#siteLoading").style.display = "none"; $("#siteContent").hidden = false;
    }
    function renderProducts(products) { const grid = $("#productGrid"); if (!grid) return; if (!products.length) { grid.innerHTML = `<p class="product-empty">Products will appear here soon.</p>`; return; } grid.innerHTML = products.map(product => `<a class="business-product-card" href="product.html?id=${encodeURIComponent(product.id)}"><div class="business-product-image" style="${product.main_image ? `background-image:url('${escape(product.main_image)}')` : ""}"></div><div class="business-product-info"><span class="business-product-name">${escape(product.title || product.name || "Product")}</span><span class="business-product-price">${escape(product.currency || "GMD")} ${Number(product.price || 0).toLocaleString()}</span></div></a>`).join(""); }
    async function init() { const slug = slugFromHost(); if (!slug) { $("#siteLoading").style.display = "none"; $("#siteError").hidden = false; return; } try { const website = (await fetchRows(`business_websites?select=*&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`))[0]; if (!website) throw new Error("Website not found."); render(website); const products = await fetchRows(`products?select=id,title,name,price,currency,main_image&seller_id=eq.${encodeURIComponent(website.user_id)}&status=eq.approved&order=created_at.desc&limit=8`); renderProducts(products); } catch (error) { console.error("[GamBasket Business Website]", error); $("#siteLoading").style.display = "none"; $("#siteError").hidden = false; } }
    init();
})();
