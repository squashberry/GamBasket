/* JulaDirect v2 product page. Reads the approved listing, its images, the
   public seller profile and published reviews. Cart, wishlist, comparison
   and messaging go through the existing adapter and database functions. */
(function () {
  "use strict";
  const JD = window.JD;
  const root = document.getElementById("jd-pdp");
  let id = JD.params().get("id");
  let qty = 1;
  let current = null;
  document.body.classList.add("jd-pdp-page");
  if (JD.paneClass) JD.paneClass("product", "jd-pdp-page", true);

  const ICON_SHARE = '<svg class="jd-i" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/></svg>';
  const humanize = k => { const t = String(k).replace(/[_-]+/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const specValue = v => {
    if (v === null || v === undefined || v === "") return "";
    if (Array.isArray(v)) return v.filter(x => typeof x !== "object").join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "object") return "";
    return String(v);
  };
  /* Whole amount large, pence small, like the reference price styling. */
  function priceHtml(p) {
    const v = Number(p.price);
    if (!Number.isFinite(v)) return "";
    if (Number.isInteger(v)) return JD.esc(JD.money(v, p.currency));
    const whole = Math.trunc(v);
    const cents = (v - whole).toFixed(2).slice(1);
    return JD.esc(JD.money(whole, p.currency)) + '<span class="jd-cents">' + cents + "</span>";
  }
  const topbar = '<div class="jd-pdpbar"><button type="button" class="jd-roundbtn" id="jd-back" aria-label="Go back"><span style="display:inline-flex;transform:scaleX(-1)">' + JD.icon("arrowRight", 22) + '</span></button><strong>Product details</strong><button type="button" class="jd-roundbtn" id="jd-share" aria-label="Share this product">' + ICON_SHARE + "</button></div>";

  function notFound(title, text) {
    document.title = "Product not found \u2014 JulaDirect";
    root.innerHTML = topbar + '<div style="padding:48px 0">' + JD.empty({ icon: "search", title: title, text: text, actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Browse the marketplace</a><a class="jd-btn jd-btn--secondary" href="index.html">Go home</a>' }) + "</div>";
  }
  function failed(msg) {
    root.innerHTML = topbar + '<div style="padding:48px 0">' + JD.empty({ icon: "bag", title: "We could not load this product", text: msg || "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="jd-retry">Try again</button>' }) + "</div>";
  }

  function jsonLd(p, images, avg, count) {
    const ld = {
      "@context": "https://schema.org", "@type": "Product", name: p.title,
      image: images.slice(0, 5), description: String(p.description || "").slice(0, 300),
      offers: { "@type": "Offer", priceCurrency: p.currency || "GMD", price: Number(p.price || 0), availability: Number(p.stock || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: location.href }
    };
    if (count > 0) ld.aggregateRating = { "@type": "AggregateRating", ratingValue: avg.toFixed(1), reviewCount: count };
    let tag = document.getElementById("jd-ld");
    if (!tag) { tag = document.createElement("script"); tag.type = "application/ld+json"; tag.id = "jd-ld"; document.head.appendChild(tag); }
    tag.textContent = JSON.stringify(ld).replace(/</g, "\\u003c");
  }

  function stepper(cls, stock) {
    return '<div class="jd-qty ' + cls + '" role="group" aria-label="Quantity"><button type="button" data-qty="-1" aria-label="Decrease quantity" disabled>' + JD.icon("minus", 18) + '</button><output class="jd-qty-out" aria-live="polite">1</output><button type="button" data-qty="1" aria-label="Increase quantity"' + (stock <= 1 ? " disabled" : "") + ">" + JD.icon("plus", 18) + "</button></div>";
  }

  function render(d) {
    const p = d.product;
    const s = d.seller;
    const imgs = d.images.length ? d.images : [JD.placeholder];
    const stock = Number(p.stock || 0);
    const reviews = d.reviews;
    const avg = reviews.length ? reviews.reduce((t, r) => t + Number(r.rating || 0), 0) / reviews.length : 0;
    const sellerName = JD.sellerName(s);
    const verified = !!(s && s.is_seller_verified);
    const cid = JD.esc(p.id);
    qty = 1;

    document.title = p.title + " \u2014 JulaDirect";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", (String(p.description || "").replace(/\s+/g, " ").slice(0, 150)) || p.title + " on JulaDirect");
    jsonLd(p, imgs, avg, reviews.length);
    JD.recent.add(p.id);

    const stockBadge = stock <= 0 ? '<span class="jd-badge jd-badge--bad">Out of stock</span>'
      : stock <= 3 ? '<span class="jd-badge jd-badge--warn">Only ' + stock + " left</span>"
      : '<span class="jd-badge jd-badge--ok">' + JD.icon("check", 14) + "In stock</span>";
    const facts = stockBadge +
      (p.condition ? '<span class="jd-badge">' + JD.esc(p.condition) + "</span>" : "") +
      '<span class="jd-badge">' + JD.icon("pin", 14) + JD.esc(p.location || "The Gambia") + "</span>" +
      (p.delivery_available === true ? '<span class="jd-badge">' + JD.icon("truck", 14) + "Delivery available</span>" : '<span class="jd-badge jd-badge--warn">Delivery not offered</span>');

    const specRows = [["Condition", p.condition], ["Category", p.category_id], ["Location", p.location], ["Listed", JD.shortDate(p.created_at)]];
    (p.attributes && typeof p.attributes === "object" ? Object.entries(p.attributes) : []).forEach(([k, v]) => specRows.push([humanize(k), specValue(v)]));
    const specs = specRows.filter(r => r[1]).map(r => '<tr><th scope="row">' + JD.esc(r[0]) + "</th><td>" + JD.esc(r[1]) + "</td></tr>").join("");

    const reviewHtml = reviews.length
      ? '<div style="display:flex;align-items:center;gap:12px;margin:12px 0 4px">' + JD.stars(avg) + "<strong>" + avg.toFixed(1) + ' / 5</strong><span class="jd-muted">' + reviews.length + (reviews.length === 1 ? " review" : " reviews") + "</span></div>" +
        reviews.map(r => '<article class="jd-review"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">' + JD.stars(r.rating) + '<span class="jd-muted" style="font-size:13px">' + JD.esc(JD.shortDate(r.created_at)) + "</span></div>" +
          (r.title ? "<strong>" + JD.esc(r.title) + "</strong>" : "") + (r.body ? '<p class="jd-prose">' + JD.esc(r.body) + "</p>" : "") +
          (r.seller_reply ? '<div class="jd-reply"><strong>Seller reply</strong><p style="margin-top:4px">' + JD.esc(r.seller_reply) + "</p></div>" : "") + "</article>").join("")
      : '<div class="jd-empty" style="margin-top:14px;padding:32px 20px"><div class="jd-empty__icon">' + JD.icon("star", 26) + "</div><h3>No verified reviews yet</h3><p>Only customers with a completed JulaDirect order can leave a review.</p></div>";

    const avatar = JD.safeUrl(s && s.avatar_url);
    const infoTitle = p.delivery_available === true ? "Delivery available" : "Delivery not offered";
    const infoText = p.delivery_available === true ? "Pay when your order arrives. Cash on delivery is available at checkout." : "This seller does not offer delivery for this item. Pay on delivery is still chosen at checkout.";

    root.innerHTML = topbar +
      '<nav class="jd-breadcrumb" aria-label="Breadcrumb"><a href="index.html">Home</a><span aria-hidden="true">/</span><a href="explore.html">Explore</a>' +
      (p.category_id ? '<span aria-hidden="true">/</span><a href="explore.html?category=' + encodeURIComponent(p.category_id) + '">' + JD.esc(p.category_id) + "</a>" : "") +
      '<span aria-hidden="true">/</span><span aria-current="page">' + JD.esc(p.title) + "</span></nav>" +
      '<div class="jd-pdp"><div class="jd-gallery"><div class="jd-gallery__main"><img id="jd-main-img" src="' + JD.esc(imgs[0]) + '" alt="' + JD.esc(p.title) + '" decoding="async">' + (p.condition === "New" ? '<span class="jd-tag">New</span>' : "") + "</div>" +
      (imgs.length > 1 ? '<div class="jd-thumbs" role="group" aria-label="Product images">' + imgs.map((u, i) => '<button type="button" class="jd-thumb" data-thumb="' + i + '"' + (i === 0 ? ' aria-current="true"' : "") + ' aria-label="Show image ' + (i + 1) + " of " + imgs.length + '"><img src="' + JD.esc(u) + '" alt="" loading="lazy"></button>').join("") + "</div>" : "") + "</div>" +
      '<div class="jd-buy"><div>' + (p.category_id ? '<p class="jd-eyebrow">' + JD.esc(p.category_id) + "</p>" : "") + '<h1 style="margin-top:6px">' + JD.esc(p.title) + "</h1></div>" +
      (p.description ? '<p class="jd-pdp-lead">' + JD.esc(p.description) + "</p>" : "") +
      (reviews.length ? '<div style="display:flex;align-items:center;gap:8px">' + JD.stars(avg) + '<a class="jd-link" href="#jd-reviews">' + reviews.length + (reviews.length === 1 ? " review" : " reviews") + "</a></div>" : "") +
      '<div class="jd-pricerow"><div class="jd-buy__price">' + priceHtml(p) + "</div>" + stepper("jd-qty--m", stock) + '</div><div class="jd-facts">' + facts + "</div>" +
      '<div class="jd-buy__row jd-buy__row--qty">' + stepper("jd-qty--d", stock) +
      '<button type="button" class="jd-btn jd-btn--primary jd-btn--lg" data-pdp-add' + (stock <= 0 ? " disabled" : "") + ">" + JD.icon("cart", 20) + (stock <= 0 ? "Out of stock" : "Add to cart") + "</button></div>" +
      '<div class="jd-infocard"><div><strong>' + infoTitle + "</strong><p>" + infoText + '</p></div><span class="jd-infocard__icon">' + JD.icon("truck", 26) + "</span></div>" +
      '<div class="jd-buy__row"><button type="button" class="jd-btn jd-btn--soft" data-pdp-buy' + (stock <= 0 ? " disabled" : "") + ">Buy now</button>" +
      '<button type="button" class="jd-btn jd-btn--secondary" data-wish="' + cid + '" aria-pressed="false">' + JD.icon("heart", 18) + "Save</button>" +
      '<button type="button" class="jd-btn jd-btn--secondary" data-compare="' + cid + '" aria-pressed="false">' + JD.icon("scale", 18) + "Compare</button></div>" +
      '<div class="jd-assure"><div>' + JD.icon("wallet", 18) + "<span>Pay when your order arrives. Cash on delivery is available at checkout.</span></div>" +
      (p.delivery_available === true ? "<div>" + JD.icon("truck", 18) + "<span>Delivery is confirmed with a code you share with the courier on arrival.</span></div>" : "") +
      "<div>" + JD.icon("shield", 18) + "<span>Refund and dispute cases are reviewed by JulaDirect.</span></div></div>" +
      '<div class="jd-sellercard"><span class="jd-seller__av">' + (avatar ? '<img src="' + JD.esc(avatar) + '" alt="" loading="lazy">' : JD.esc(sellerName.charAt(0).toUpperCase())) + "</span>" +
      '<div class="jd-sellercard__text"><strong>' + JD.esc(sellerName) + (verified ? JD.icon("shield", 16) : "") + '</strong><small class="jd-muted">' + (verified ? "Verified seller" : "JulaDirect member") + (s && s.region ? " &middot; " + JD.esc(s.region) : "") + "</small></div>" +
      '<div style="display:grid;gap:8px"><button type="button" class="jd-btn jd-btn--soft jd-btn--sm" id="jd-msg">' + JD.icon("message", 16) + 'Message</button><a class="jd-btn jd-btn--secondary jd-btn--sm" href="explore.html?seller=' + encodeURIComponent(p.seller_id) + '">Listings</a></div></div></div></div>' +
      '<div class="jd-tabs"><section aria-labelledby="jd-about"><h2 id="jd-about">About this item</h2>' +
      (p.description ? '<p class="jd-prose" style="margin-top:12px">' + JD.esc(p.description) + "</p>" : '<p class="jd-muted" style="margin-top:12px">The seller has not added a description yet.</p>') +
      (specs ? '<h2 style="margin-top:32px">Details</h2><table class="jd-specs" style="margin-top:8px"><tbody>' + specs + "</tbody></table>" : "") + "</section>" +
      '<section id="jd-reviews" aria-labelledby="jd-rev-h"><h2 id="jd-rev-h">Customer reviews</h2>' + reviewHtml + "</section></div>" +
      (d.related.length ? '<section class="jd-section" aria-labelledby="jd-rel"><div class="jd-section__head"><h2 id="jd-rel">More in ' + JD.esc(p.category_id || "this category") + '</h2><a class="jd-link" href="explore.html?category=' + encodeURIComponent(p.category_id || "") + '">See all</a></div><div class="jd-grid" id="jd-related">' + d.related.map(JD.productCard).join("") + "</div></section>" : "") +
      '<div class="jd-mobilebar"><button type="button" class="jd-btn jd-btn--primary jd-btn--block" data-pdp-add' + (stock <= 0 ? " disabled" : "") + ">" + (stock <= 0 ? "Out of stock" : "Add to cart") + "</button></div>";

    document.body.classList.add("has-mobilebar");
    JD.syncWishlist(root);
    JD.syncCompare();
    hideOwnMessage(p);
  }

  /* Sellers cannot message themselves; show a pointer to the Seller Centre instead. */
  async function hideOwnMessage(p) {
    try {
      const A = JD.auth();
      await A.ready();
      const user = await A.getUser();
      const btn = document.getElementById("jd-msg");
      if (user && btn && user.id === p.seller_id) btn.outerHTML = '<a class="jd-btn jd-btn--soft jd-btn--sm" href="supplier/products.html">Manage</a>';
    } catch (e) { /* guests and errors keep the default button */ }
  }

  function setQty(next) {
    const stock = Number(current.product.stock || 0);
    qty = Math.min(Math.max(1, next), Math.max(1, stock));
    JD.$$(".jd-qty-out").forEach(o => { o.textContent = String(qty); });
    JD.$$('[data-qty="-1"]').forEach(b => { b.disabled = qty <= 1; });
    JD.$$('[data-qty="1"]').forEach(b => { b.disabled = qty >= stock; });
  }

  async function load() {
    if (!JD.isUuid(id)) { notFound("This product link is not valid", "Check the link or browse the marketplace to find what you need."); return; }
    const paint = d => {
      if (!d.product) { current = null; notFound("This product is no longer available", "It may have been sold, removed or is awaiting review."); return; }
      current = d;
      render(d);
    };
    try {
      await JD.swr("product:" + id, () => JD.data.product(id), paint);
    } catch (e) {
      console.warn("[JulaDirect] product", e && e.message);
      failed(e && e.message);
    }
  }

  function syncProductRoute(rawUrl) {
    let nextId = null;
    try { nextId = new URL(rawUrl || location.href, location.href).searchParams.get("id"); } catch (e) { nextId = null; }
    if (nextId === id) return;
    id = nextId;
    current = null;
    qty = 1;
    document.title = "Product — JulaDirect";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "View product details, seller information and reviews on JulaDirect.");
    root.innerHTML = topbar + '<div class="jd-pdp" style="padding-top:28px" aria-hidden="true"><div class="jd-skel" style="aspect-ratio:1/1;border-radius:16px"></div><div style="display:grid;gap:14px"><div class="jd-skel" style="height:34px;width:80%"></div><div class="jd-skel" style="height:44px;width:40%"></div><div class="jd-skel" style="height:120px"></div><div class="jd-skel" style="height:52px"></div></div></div>';
    load();
  }

  window.addEventListener("jd:pane:show", event => {
    if (event.detail && event.detail.route === "product") syncProductRoute(event.detail.url);
  });

  async function share() {
    const title = current ? current.product.title : document.title;
    try {
      if (navigator.share) { await navigator.share({ title: title, url: location.href }); return; }
      await navigator.clipboard.writeText(location.href);
      JD.toast("Link copied", "ok");
    } catch (e) { /* user cancelled or clipboard blocked */ }
  }

  document.addEventListener("click", async e => {
    if (e.target.closest("#jd-back")) {
      if (history.length > 1 && document.referrer.indexOf(location.origin) === 0) history.back(); else location.href = "explore.html";
      return;
    }
    if (e.target.closest("#jd-share")) { share(); return; }
    if (!current) { if (e.target.closest("#jd-retry")) load(); return; }
    const thumb = e.target.closest("[data-thumb]");
    const q = e.target.closest("[data-qty]");
    const add = e.target.closest("[data-pdp-add]");
    const buy = e.target.closest("[data-pdp-buy]");
    const msg = e.target.closest("#jd-msg");
    if (thumb) {
      const i = Number(thumb.getAttribute("data-thumb"));
      document.getElementById("jd-main-img").src = current.images[i] || JD.placeholder;
      JD.$$("[data-thumb]").forEach(t => t.setAttribute("aria-current", String(t === thumb)));
    } else if (q) {
      setQty(qty + Number(q.getAttribute("data-qty")));
    } else if (add) {
      add.disabled = true;
      await JD.addToCart(current.product.id, qty);
      add.disabled = false;
    } else if (buy) {
      buy.disabled = true;
      const r = await JD.addToCart(current.product.id, qty);
      if (r && r.success) location.href = "checkout.html"; else buy.disabled = false;
    } else if (msg) {
      try {
        const A = JD.auth();
        await A.ready();
        const user = await A.getUser();
        if (!user) { location.href = JD.loginUrl(); return; }
        location.href = "messages.html?product=" + encodeURIComponent(current.product.id);
      } catch (err) { JD.toast("We could not open messages. Please try again.", "error"); }
    }
  });

  JD.mountShell({ active: "" });
  JD.bindProductActions(document);
  load();
})();
