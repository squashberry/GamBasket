/* =========================================================
   GAMBASKET — PRODUCT DETAIL LOGIC & SHARING SYSTEM
========================================================= */

(function () {
    "use strict";

    const defaultCatalog = [
        { id: "1", name: "iPhone 13 128GB", price: 45000, category: "Phones", location: "Serrekunda", condition: "Like New", image: "https://images.unsplash.com/photo-1603899122634-f086ca5f5ddd?auto=format&fit=crop&w=800&q=80", seller: "Alhaji Electronics Ltd", description: "Clean, genuine factory unlocked iPhone 13 in excellent condition with complete accessories. Tested and verified for all Gambian SIM networks (Africell, QCell, Gamcel, Comium)." },
        { id: "2", name: "Classic White Sneakers", price: 2500, category: "Fashion", location: "Brikama", condition: "Brand New", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80", seller: "Brikama Fashion Store", description: "Comfortable and durable white sneakers for daily wear. Available in Gambian sizes 39 to 45." },
        { id: "3", name: "MacBook Air M2", price: 58000, category: "Electronics", location: "Kololi", condition: "Brand New", image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80", seller: "Kololi Tech Hub", description: "Brand new Apple MacBook Air M2 chip, 8GB unified memory, 256GB SSD storage. 100% pristine battery health." },
        { id: "4", name: "Modern Living Room Chair", price: 8500, category: "Home", location: "Bakau", condition: "Brand New", image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80", seller: "Bakau Furniture & Living", description: "High quality ergonomic accent armchair with premium hardwood legs and stain-resistant fabric." },
        { id: "5", name: "Samsung Galaxy S24", price: 52000, category: "Phones", location: "Kotu", condition: "Brand New", image: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=800&q=80", seller: "Kotu Mobile Solutions", description: "Latest flagship Samsung Galaxy with Galaxy AI features and dynamic AMOLED display." }
    ];

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
                const client = window.GamBasketAuth.getClient();
                if (client) {
                    let query = client.from("products").select("*");

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
                        currentProduct = {
                            id: data.id,
                            name: data.title,
                            price: Number(data.price),
                            category: data.category_id || "Phones",
                            location: data.location || "Greater Banjul",
                            condition: data.condition || "Brand New",
                            image: data.main_image || "https://images.unsplash.com/photo-1603899122634-f086ca5f5ddd?auto=format&fit=crop&w=800&q=80",
                            seller: seller ? `${seller.first_name || ""} ${seller.last_name || ""}`.trim() : "GamBasket Verified Merchant",
                            sellerId: data.seller_id,
                            description: data.description || "Genuine verified merchandise on GamBasket The Gambia.",
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
            if (window.GamBasketAuth && typeof window.GamBasketAuth.getProductById === 'function') {
                currentProduct = window.GamBasketAuth.getProductById(productId);
            }
            if (!currentProduct) {
                currentProduct = defaultCatalog.find(p => String(p.id) === String(productId)) || defaultCatalog[0];
            }
        }

        renderProduct(currentProduct);
        loadReviews(currentProduct.id);
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    }

    function renderProduct(p) {
        document.getElementById("detailName").textContent = p.name;
        document.getElementById("detailPrice").textContent = `D ${formatPrice(p.price)}`;
        document.getElementById("detailCategory").textContent = p.category;
        document.getElementById("detailCondition").textContent = p.condition || "Brand New";
        document.getElementById("locationText").textContent = p.location;
        document.getElementById("detailImage").src = p.image;
        document.getElementById("detailImage").alt = p.name;
        document.getElementById("detailDescription").textContent = p.description;
        document.getElementById("sellerName").textContent = p.seller;
        if (p.sellerId) document.getElementById("sellerName").href = `seller.html?id=${encodeURIComponent(p.sellerId)}`;

        renderBusinessMode(p);

        // Wishlist button state
        const isSaved = window.GamBasketAuth ? window.GamBasketAuth.isInWishlist(p.id) : false;
        const heartBtn = document.getElementById("detailWishlistBtn");
        if (heartBtn) {
            heartBtn.classList.toggle("saved", isSaved);
        }

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
