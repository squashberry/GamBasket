/* =========================================================
   GAMBASKET — PRODUCT DETAIL LOGIC & SHARING SYSTEM
========================================================= */

(function () {
    "use strict";

    const defaultCatalog = [];

    let currentProduct = null;

    function formatPrice(price) {
        return new Intl.NumberFormat("en-GM", { maximumFractionDigits: 0 }).format(price);
    }

    async function loadProduct() {
        const urlParams = new URLSearchParams(window.location.search);
        const productId = urlParams.get("id") || "1";
        const fallbackProduct = defaultCatalog.find(p => String(p.id) === String(productId));

        // Query database if available
        if (window.GamBasketAuth && window.GamBasketAuth.isConfigured()) {
            try {
                await window.GamBasketAuth.ready?.();
                const client = window.GamBasketAuth.getClient();
                if (client) {
                    // Only publicly approved listings can resolve from a shareable URL.
                    let query = client.from("products").select("*").eq("status", "approved");

                    query = isUuid(productId)
                        ? query.eq("id", productId).single()
                        : query.eq("title", fallbackProduct?.name || "").single();

                    const { data, error } = await query;

                    if (!error && data) {
                        let seller = null;
                        if (data.seller_id) {
                            const sellerResult = await client
                                .from("public_profiles")
                                .select("id, first_name, last_name, avatar_url, area, region")
                                .eq("id", data.seller_id)
                                .maybeSingle();
                            if (sellerResult.error) throw sellerResult.error;
                            seller = sellerResult.data;
                        }
                        let imageRows = [];
                        try {
                            const gallery = await client.from("product_images")
                                .select("image_url,sort_order").eq("product_id", data.id).order("sort_order", { ascending: true });
                            if (!gallery.error) imageRows = gallery.data || [];
                        } catch (galleryError) {
                            console.warn("[GamBasket product gallery]", galleryError?.message);
                        }
                        const galleryUrls = [...new Set([data.main_image, ...imageRows.map(row => row.image_url)]
                            .filter(url => typeof url === "string" && /^https?:\/\//i.test(url)))].slice(0, 8);
                        currentProduct = {
                            id: data.id,
                            name: data.title,
                            price: Number(data.price),
                            category: data.category_id || "Phones",
                            location: data.location || "Greater Banjul",
                            condition: data.condition || "Brand New",
                            image: galleryUrls[0] || data.main_image || "",
                            images: galleryUrls,
                            attributes: data.attributes && typeof data.attributes === "object" ? data.attributes : {},
                            stock: Number(data.stock || 0),
                            seller: `${seller?.first_name || ""} ${seller?.last_name || ""}`.trim() || "GamBasket member",
                            sellerId: data.seller_id,
                            seller_verified: false,
                            seller_type: "individual",
                            store_name: null,
                            delivery_available: data.delivery_available === true,
                            description: data.description || "",
                            listing_type: data.listing_type || "retail",
                            wholesale_price: data.wholesale_price,
                            min_order_quantity: data.min_order_quantity || data.minimum_order_quantity || 1,
                            wholesale_currency: data.wholesale_currency || data.currency || "GMD"
                        };
                    }
                }
            } catch (err) {
                console.warn("Could not load product from database:", err);
            }
        }

        if (!currentProduct) {
            showProductUnavailable();
            return;
        }

        renderProduct(currentProduct);
        loadReviews(currentProduct.id);
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    }

    function showProductUnavailable() {
        document.title = "Listing unavailable — GamBasket";
        const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
        set("detailName", "This listing is not available");
        set("detailCategory", "UNAVAILABLE");
        set("detailCondition", "LISTING UNAVAILABLE");
        set("detailPrice", "—");
        set("mobileStickyPrice", "—");
        set("locationText", "The Gambia");
        set("detailDescription", "This item may have been removed, is still under review, or is no longer available. Browse current approved listings to find alternatives.");
        set("sellerName", "GamBasket");
        const image = document.getElementById("detailImage");
        if (image) { image.removeAttribute("src"); image.alt = "Listing unavailable"; }
        document.getElementById("detailImageThumbs")?.replaceChildren();
        document.getElementById("detailStock")?.replaceChildren(document.createTextNode("Unavailable"));
        ["addToCartBtn","orderNowBtn","mobileStickyCart","mobileStickyOrder","detailWishlistBtn","messageSellerBtn","detailCompareBtn"].forEach(id => {
            const element = document.getElementById(id);
            if (element) { element.disabled = true; element.setAttribute("aria-disabled","true"); }
        });
        document.querySelector(".purchase-panel")?.setAttribute("hidden","");
        document.querySelector(".seller-card")?.setAttribute("hidden","");
        const reviews = document.getElementById("productReviews");
        if (reviews) reviews.textContent = "Reviews are unavailable because this listing is not public.";
    }

    function renderGallery(product) {
        const main = document.getElementById("detailImage");
        const thumbs = document.getElementById("detailImageThumbs");
        if (!main || !thumbs) return;
        const urls = [...new Set([product.image, ...(Array.isArray(product.images) ? product.images : [])])]
            .filter(url => typeof url === "string" && /^https?:\/\//i.test(url)).slice(0, 8);
        thumbs.replaceChildren();
        if (!urls.length) {
            main.removeAttribute("src");
            return;
        }
        main.src = urls[0];
        main.alt = product.name || "Product photo";
        urls.forEach((url, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "product-gallery-thumb" + (index === 0 ? " active" : "");
            button.setAttribute("aria-label", `Show product photo ${index + 1}`);
            button.setAttribute("aria-pressed", String(index === 0));
            const image = document.createElement("img");
            image.src = url;
            image.alt = `${product.name || "Product"} photo ${index + 1}`;
            image.loading = "lazy";
            button.append(image);
            button.addEventListener("click", () => {
                main.src = url;
                main.alt = image.alt;
                thumbs.querySelectorAll("button").forEach(item => {
                    const active = item === button;
                    item.classList.toggle("active", active);
                    item.setAttribute("aria-pressed", String(active));
                });
            });
            thumbs.append(button);
        });
    }

    function renderProduct(p) {
        document.getElementById("detailName").textContent = p.name;
        document.getElementById("detailPrice").textContent = `D ${formatPrice(p.price)}`;
        document.getElementById("detailCategory").textContent = p.category;
        document.getElementById("detailCondition").textContent = p.condition || "New";
        document.getElementById("locationText").textContent = p.location;
        const stock = Number(p.stock || 0);
        const stockNode = document.getElementById("detailStock");
        if (stockNode) {
            stockNode.replaceChildren();
            const dot = document.createElement("span");
            dot.className = "stock-dot";
            stockNode.append(dot, document.createTextNode(stock > 0 ? `${stock} in stock` : "Out of stock"));
            stockNode.classList.toggle("out-of-stock", stock <= 0);
        }
        const outOfStock = stock <= 0;
        ["addToCartBtn", "orderNowBtn", "mobileStickyCart", "mobileStickyOrder"].forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                button.disabled = outOfStock;
                button.setAttribute("aria-disabled", String(outOfStock));
                button.title = outOfStock ? "This listing is currently out of stock." : "";
            }
        });
        const verifiedBadge = document.getElementById("sellerVerifiedBadge");
        if (verifiedBadge) {
            verifiedBadge.hidden = !p.seller_verified;
            verifiedBadge.style.display = p.seller_verified ? "" : "none";
        }
        const sellerSubtitle = document.getElementById("sellerSubtitle");
        if (sellerSubtitle) sellerSubtitle.textContent = p.seller_verified
            ? "Verified seller on GamBasket"
            : (p.seller_type === "business" ? "Business store on GamBasket" : "Individual seller on GamBasket");
        const listingBadge = document.getElementById("productListingBadge");
        if (listingBadge) {
            listingBadge.hidden = !p.seller_verified;
            listingBadge.style.display = p.seller_verified ? "" : "none";
            listingBadge.textContent = p.seller_verified ? "Verified seller" : "";
        }
        const delivery = document.getElementById("deliveryFulfillment");
        if (delivery) {
            delivery.hidden = !p.delivery_available;
            delivery.style.display = p.delivery_available ? "" : "none";
            const note = delivery.querySelector("[data-delivery-note]");
            if (note) note.textContent = "The seller offers delivery. Charges and service area are confirmed at checkout.";
        }
        const compareButton = document.getElementById("detailCompareBtn");
        if (compareButton) {
            compareButton.disabled = !isUuid(p.id);
            compareButton.setAttribute("aria-disabled", String(!isUuid(p.id)));
        }
        renderGallery(p);
        document.getElementById("detailDescription").textContent = p.description;
        const attributeCard = document.getElementById("detailAttributesCard");
        window.GamBasketProductAttributes?.renderDisplay(document.getElementById("detailAttributes"), p.attributes || {});
        if (attributeCard) attributeCard.hidden = !Object.keys(p.attributes || {}).length;
        document.getElementById("sellerName").textContent = p.seller;
        if (p.sellerId) document.getElementById("sellerName").href = `seller.html?id=${encodeURIComponent(p.sellerId)}`;

        renderBusinessMode(p);

        // Wishlist button state
        const isSaved = window.GamBasketAuth ? window.GamBasketAuth.isInWishlist(p.id) : false;
        const heartBtn = document.getElementById("detailWishlistBtn");
        if (heartBtn) {
            heartBtn.classList.toggle("saved", isSaved);
        }

        document.getElementById("detailCompareBtn")?.addEventListener("click", () => {
            const result = window.GamBasketCompare?.toggle(p.id);
            if (result?.ok === false) window.alert(result.message || "This product cannot be compared yet.");
        });
        // Set document title
        document.title = `${p.name} — GamBasket The Gambia`;
    }

    function renderBusinessMode(product) {
        const mode = window.GamBasketBusiness?.getProductBusinessMode?.(product) || { retail: true, wholesale: false, showWholesale: false, minimumOrderQuantity: 1 };
        document.querySelector(".business-wholesale-summary")?.remove();
        document.querySelector(".trust-report-button")?.remove();
        const detailCard = document.querySelector(".product-detail-card");
        if (mode.wholesale && detailCard) {
            const summary = document.createElement("div");
            summary.className = "business-wholesale-summary";
            summary.innerHTML = `<strong>Wholesale</strong><span>D ${formatPrice(Number(product.wholesale_price || 0))}</span><span>Minimum order: ${mode.minimumOrderQuantity} unit${mode.minimumOrderQuantity === 1 ? "" : "s"}</span>`;
            detailCard.insertAdjacentElement("afterend", summary);
        }
        if (detailCard) {
            const report = document.createElement("button");
            report.type = "button";
            report.className = "trust-report-button";
            report.textContent = "Report product";
            report.addEventListener("click", submitProductReport);
            detailCard.insertAdjacentElement("afterend", report);
        }
        const purchasePanel = document.querySelector(".purchase-panel");
        const mobileBar = document.querySelector(".mobile-purchase-bar");
        if (!mode.retail && purchasePanel) {
            purchasePanel.innerHTML = "<div class=\"purchase-header\"><div><span class=\"purchase-label\">Wholesale listing</span><strong>Contact this supplier for a business order</strong></div></div><div class=\"purchase-actions\"><button class=\"order-now-btn\" id=\"wholesaleEnquiryBtn\" type=\"button\">Message supplier</button></div>";
            mobileBar?.setAttribute("hidden", "");
            document.getElementById("wholesaleEnquiryBtn")?.addEventListener("click", () => document.getElementById("messageSellerBtn")?.click());
        }
    }

    async function submitProductReport() {
        if (!currentProduct || !window.GamBasketTrust) return;
        const session = await window.GamBasketAuth?.getSession?.();
        if (!session?.user) {
            window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            return;
        }
        const reason = window.prompt("Why are you reporting this product?");
        if (!reason?.trim()) return;
        try {
            await window.GamBasketTrust.submitReport({ targetProductId: currentProduct.id, reportType: "product", reason });
            window.GamBasketNotifications?.add({ type: "system", title: "Report submitted", message: "Thank you. GamBasket will review this product.", showToast: true });
        } catch (error) {
            window.GamBasketNotifications?.add({ type: "system", title: "Unable to submit report", message: error.message || "Please try again.", showToast: true });
        }
    }

    async function loadReviews(productId) {
        const list = document.getElementById("productReviews");
        const count = document.getElementById("reviewCount");
        const summary = document.getElementById("reviewSummary");
        const client = window.GamBasketBusiness?.getClient?.() || window.GamBasketAuth?.getClient?.();
        if (!list || !client || !isUuid(productId)) return;
        try {
            const { data, error } = await client.from("marketplace_reviews").select("rating,title,body,created_at,seller_reply").eq("product_id", productId).eq("status", "published").order("created_at", { ascending: false });
            if (error) throw error;
            const reviews = data || [];
            count.textContent = `${reviews.length} review${reviews.length === 1 ? "" : "s"}`;
            const average = reviews.length ? reviews.reduce((total, review) => total + Number(review.rating), 0) / reviews.length : 0;
            summary.replaceChildren();
            const copy = document.createElement("div");
            copy.className = "review-summary-copy";
            copy.innerHTML = reviews.length ? `<strong>${average.toFixed(1)} / 5 from verified buyers</strong><p>Only customers with a completed GamBasket order can leave a review.</p>` : "<strong>No verified reviews yet</strong><p>Be the first customer to share feedback after your completed purchase.</p>";
            summary.append(copy);
            list.replaceChildren();
            if (!reviews.length) {
                const empty = document.createElement("p");
                empty.className = "business-review-empty";
                empty.textContent = "There are no verified buyer reviews for this product yet.";
                list.append(empty);
                return;
            }
            reviews.forEach(review => {
                const article = document.createElement("article");
                article.className = "review-card";
                const heading = document.createElement("div");
                heading.className = "review-card-top";
                heading.innerHTML = `<div><strong>Verified Buyer</strong><span>${new Date(review.created_at).toLocaleDateString("en-GM")}</span></div><span class="review-rating">${Number(review.rating).toFixed(1)}</span>`;
                article.append(heading);
                if (review.title) { const title = document.createElement("strong"); title.textContent = review.title; article.append(title); }
                if (review.body) { const body = document.createElement("p"); body.textContent = review.body; article.append(body); }
                if (review.seller_reply) { const reply = document.createElement("p"); reply.textContent = `Seller reply: ${review.seller_reply}`; article.append(reply); }
                list.append(article);
            });
        } catch (error) {
            console.warn("Could not load marketplace reviews:", error);
            count.textContent = "Reviews unavailable";
            list.textContent = "Verified reviews will appear here when available.";
        }
    }

    function shareProduct() {
        if (!currentProduct) return;

        const shareData = {
            title: `${currentProduct.name} — GamBasket`,
            text: `Check out ${currentProduct.name} for D ${formatPrice(currentProduct.price)} on GamBasket The Gambia:`,
            url: window.location.href
        };

        if (navigator.share) {
            navigator.share(shareData).catch(() => {});
        } else {
            navigator.clipboard.writeText(window.location.href);
            if (window.GamBasketNotifications) {
                window.GamBasketNotifications.add({
                    type: "system",
                    title: "Product Link Copied!",
                    message: "Shareable product link has been copied to your clipboard."
                });
            } else {
                alert("Product link copied to clipboard!");
            }
        }
    }

    function setupEventListeners() {
        // Back Button
        const backBtn = document.getElementById("backButton");
        if (backBtn) {
            backBtn.addEventListener("click", () => {
                if (window.history.length > 1) window.history.back();
                else window.location.href = "explore.html";
            });
        }

        // Share Buttons (Mobile & Desktop)
        const shareBtnMobile = document.getElementById("shareBtnMobile");
        const shareBtnDesktop = document.getElementById("shareBtnDesktop");
        if (shareBtnMobile) shareBtnMobile.addEventListener("click", shareProduct);
        if (shareBtnDesktop) shareBtnDesktop.addEventListener("click", shareProduct);

        // Wishlist Toggle
        const wishlistBtn = document.getElementById("detailWishlistBtn");
        if (wishlistBtn) {
            wishlistBtn.addEventListener("click", async () => {
                if (!currentProduct) return;
                if (window.GamBasketAuth) {
                    if (!window.GamBasketAuth.isPersistableProductId(currentProduct.id)) {
                        if (window.GamBasketNotifications) {
                            window.GamBasketNotifications.add({
                                type: "system",
                                title: "Product not available yet",
                                message: "This example product is not connected to the marketplace database yet.",
                                showToast: true
                            });
                        }
                        return;
                    }
                    await window.GamBasketAuth.toggleWishlist(currentProduct.id);
                } else if (window.GamBasketGuard) {
                    window.GamBasketGuard.requireAuth("save items to your wishlist");
                }
            });
        }

        // Add to Cart
        const addToCartBtn = document.getElementById("addToCartBtn");
        if (addToCartBtn) {
            addToCartBtn.addEventListener("click", async () => {
                if (!currentProduct) return;

                const session = window.GamBasketAuth
                    ? await window.GamBasketAuth.getSession()
                    : null;

                if (session?.user && window.GamBasketAuth.addToCart) {
                    try {
                        const result = await window.GamBasketAuth.addToCart(currentProduct.id, 1);
                        if (result.success) {
                            window.dispatchEvent(new CustomEvent("gambasket:cart:change"));
                            window.GamBasketNotifications?.add({
                                type: "order",
                                title: "Added to Cart",
                                message: `${currentProduct.name} is in your shopping cart.`,
                                showToast: true
                            });
                        } else if (window.GamBasketNotifications) {
                            window.GamBasketNotifications.add({
                                type: "system",
                                title: "Unable to add item",
                                message: result.error === "INSUFFICIENT_STOCK"
                                    ? "This item is no longer available in that quantity."
                                    : "We couldn't update your cart. Please try again.",
                                showToast: true
                            });
                        }
                    } catch (error) {
                        console.error("[GamBasket Cart Add]", error);
                        window.GamBasketNotifications?.add({
                            type: "system",
                            title: "Cart unavailable",
                            message: "We couldn't update your cart. Please try again.",
                            showToast: true
                        });
                    }
                    return;
                }

                let cart = JSON.parse(localStorage.getItem("gambasket_cart") || "[]");
                const existing = cart.find(item => item.id == currentProduct.id);
                if (existing) {
                    existing.quantity += 1;
                } else {
                    cart.push({
                        id: currentProduct.id,
                        name: currentProduct.name,
                        price: currentProduct.price,
                        image: currentProduct.image,
                        seller: currentProduct.seller,
                        quantity: 1
                    });
                }
                localStorage.setItem("gambasket_cart", JSON.stringify(cart));

                if (window.GamBasketNotifications) {
                    window.GamBasketNotifications.add({
                        type: "order",
                        title: "Added to Cart",
                        message: `${currentProduct.name} is in your shopping cart.`,
                        showToast: true
                    });
                }
            });
        }

        // Order Now
        const orderNowBtn = document.getElementById("orderNowBtn");
        if (orderNowBtn) {
            orderNowBtn.addEventListener("click", async () => {
                if (!currentProduct) return;
                const session = window.GamBasketAuth
                    ? await window.GamBasketAuth.getSession()
                    : null;
                let added = false;

                if (session?.user && window.GamBasketAuth.addToCart) {
                    try {
                        const result = await window.GamBasketAuth.addToCart(currentProduct.id, 1);
                        added = Boolean(result.success);
                    } catch (error) {
                        console.error("[GamBasket Order Now Add]", error);
                        window.GamBasketNotifications?.add({
                            type: "system",
                            title: "Cart unavailable",
                            message: "We couldn't add this item to your cart.",
                            showToast: true
                        });
                    }
                } else {
                    let cart = JSON.parse(localStorage.getItem("gambasket_cart") || "[]");
                    const existing = cart.find(item => item.id == currentProduct.id);
                    if (existing) existing.quantity += 1;
                    else cart.push({ id: currentProduct.id, name: currentProduct.name, price: currentProduct.price, image: currentProduct.image, seller: currentProduct.seller, quantity: 1 });
                    localStorage.setItem("gambasket_cart", JSON.stringify(cart));
                    added = true;
                }

                if (added) {
                    window.location.href = "cart.html?continue=checkout";
                } else {
                    window.GamBasketNotifications?.add({
                        type: "system",
                        title: "Unable to add item",
                        message: "This item is unavailable or out of stock.",
                        showToast: true
                    });
                }
            });
        }

        // Message Seller
        const messageSellerBtn = document.getElementById("messageSellerBtn");
        if (messageSellerBtn) {
            messageSellerBtn.addEventListener("click", async () => {
                if (!currentProduct) return;
                const session = await window.GamBasketAuth?.getSession();
                if (!session?.user) {
                    window.location.href = `login.html?redirect=${encodeURIComponent(`messages.html?product=${currentProduct.id}`)}`;
                    return;
                }
                if (window.GamBasketAuth?.startConversation && isUuid(currentProduct.id)) {
                    try {
                        const result = await window.GamBasketAuth.startConversation(currentProduct.id);
                        const conversationId = result?.conversation?.id || result?.id;
                        if (conversationId) {
                            window.location.href = `messages.html?conversation=${encodeURIComponent(conversationId)}&product=${encodeURIComponent(currentProduct.id)}`;
                            return;
                        }
                    } catch (error) {
                        console.error("[GamBasket Start Conversation]", error);
                    }
                }
                window.location.href = `messages.html?product=${encodeURIComponent(currentProduct.id)}`;
            });
        }

        // Theme Toggle
        const themeToggle = document.getElementById("themeToggle");
        const desktopThemeToggle = document.getElementById("desktopThemeToggle");
        const themeIcon = document.getElementById("themeIcon");

        function doThemeToggle() {
            const isDark = document.documentElement.classList.toggle("dark");
            localStorage.setItem("gambasket-theme", isDark ? "dark" : "light");
            if (themeIcon) {
                themeIcon.innerHTML = isDark ? `<use href="#icon-sun"></use>` : `<use href="#icon-moon"></use>`;
            }
        }

        // theme listener handled by supabase.js
        // desktop theme listener handled by supabase.js
    }

    document.addEventListener("DOMContentLoaded", () => {
        setupEventListeners();
        loadProduct();
    });
})();


window.addEventListener("gambasket:wishlist:change", () => {
    const heartBtn = document.getElementById("detailWishlistBtn");
    if (heartBtn && window.GamBasketAuth) {
        const urlParams = new URLSearchParams(window.location.search);
        const productId = urlParams.get("id") || "1";
        heartBtn.classList.toggle("saved", window.GamBasketAuth.isInWishlist(productId));
    }
});
