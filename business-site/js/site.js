/* GAMBASKET BUSINESS SITE CLIENT */
(() => {
    "use strict";

    const params = new URLSearchParams(window.location.search);
    const siteSlug = params.get("site") || "my-store";

    const draft = localStorage.getItem("gambasket-business-website-draft");
    if (draft) {
        try {
            const data = JSON.parse(draft);
            document.title = data.businessName + " — GamBasket";
            document.getElementById("siteName").textContent = data.businessName;
            document.getElementById("heroBusinessName").textContent = data.businessName;
            if (data.description) document.getElementById("heroDescription").textContent = data.description;
            if (data.location) document.getElementById("infoLocation").textContent = "📍 " + data.location;
            if (data.openingHours) document.getElementById("infoHours").textContent = "🕒 " + data.openingHours;
            if (data.whatsapp) {
                document.getElementById("btnWhatsApp").href = "https://wa.me/" + data.whatsapp.replace(/[^0-9]/g, "");
            }
            if (data.phone) {
                document.getElementById("btnCall").href = "tel:" + data.phone;
            }
        } catch {}
    }

    async function loadProducts() {
        const grid = document.getElementById("productGrid");
        if (!grid) return;

        if (window.supabaseClient) {
            const { data: products } = await window.supabaseClient
                .from("products")
                .select("*")
                .limit(12);

            if (products && products.length > 0) {
                grid.innerHTML = products.map(p => `
                    <a href="../product.html?id=${p.id}" class="product-card">
                        <img src="${p.main_image || p.image || '../assets/placeholder.jpg'}" alt="${p.name}">
                        <h3>${p.name || p.title}</h3>
                        <div class="price">D ${Number(p.price || 0).toLocaleString()}</div>
                    </a>
                `).join("");
                return;
            }
        }

        grid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
                <p>Welcome to our store! Check back soon for updated catalog items.</p>
            </div>
        `;
    }

    document.addEventListener("DOMContentLoaded", loadProducts);
})();
