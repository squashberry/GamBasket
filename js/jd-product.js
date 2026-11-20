/* JulaDirect product page (v3). Reads the approved listing, its photos, the public
   seller profile and published reviews. Cart, wishlist, compare and messaging go
   through the shared adapter and database functions. Layout: photo gallery with
   lightbox, buy box, section navigation, description and specifications, safety
   tips, review summary, seller panel and related listings. */
(function () {
  "use strict";
  const JD = window.JD;
  const root = document.getElementById("jd-pdp");
  let id = JD.params().get("id");
  let qty = 1;
  let current = null;
  let spy = null;
  let lb = null;
  document.body.classList.add("jd-pdp-page");
  if (JD.paneClass) JD.paneClass("product", "jd-pdp-page", true);

  const humanize = k => { const t = String(k).replace(/[_-]+/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const specValue = v => {
    if (v === null || v === undefined || v === "") return "";
    if (Array.isArray(v)) return v.filter(x => typeof x !== "object").join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "object") return "";
    return String(v);
  };
  const ago = d => {
    const t = new Date(d).getTime(); if (!t) return "";
    const days = Math.floor((Date.now() - t) / 864e5);
    return days < 1 ? "today" : days === 1 ? "yesterday" : days < 30 ? days + " days ago" : JD.shortDate(d);
  };
  const REASONS = [["scam", "Scam or fraud"], ["prohibited", "Prohibited or illegal item"], ["counterfeit", "Fake or counterfeit"], ["misleading", "Wrong price, photos or description"], ["other", "Something else"]];

  const SKELETON = '<div class="pd pd-skel" aria-hidden="true"><div class="jd-skel pd-skel__img"></div><div style="display:grid;gap:14px;align-content:start"><div class="jd-skel" style="height:18px;width:30%"></div><div class="jd-skel" style="height:36px;width:85%"></div><div class="jd-skel" style="height:46px;width:45%"></div><div class="jd-skel" style="height:110px"></div><div class="jd-skel" style="height:54px"></div></div></div>';
  const topbar = t => '<div class="pd-bar"><button type="button" class="pd-bar__btn" id="jd-back" aria-label="Go back"><span style="display:inline-flex;transform:scaleX(-1)">' + JD.icon("arrowRight", 22) + "</span></button><strong>" + JD.esc(t || "Product details") + '</strong><span class="pd-bar__r"><button type="button" class="pd-bar__btn" id="jd-share" aria-label="Share this product">' + JD.icon("arrowUpRight", 22) + '</button><a class="pd-bar__btn" href="cart.html" aria-label="Open cart">' + JD.icon("cart", 22) + '<em class="jd-badge-count" data-cart-count hidden>0</em></a></span></div>';

  function notFound(title, text) {
    document.title = "Product not found — JulaDirect";
    root.innerHTML = topbar() + '<div class="pd-state">' + JD.empty({ icon: "search", title: title, text: text, actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Browse the marketplace</a><a class="jd-btn jd-btn--secondary" href="index.html">Go home</a>' }) + "</div>";
  }
  function failed(msg) {
    root.innerHTML = topbar() + '<div class="pd-state">' + JD.empty({ icon: "bag", title: "We could not load this product", text: msg || "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="jd-retry">Try again</button>' }) + "</div>";
  }

  function jsonLd(p, images, avg, count, seller) {
    const ld = {
      "@context": "https://schema.org", "@type": "Product", name: p.title,
      image: images.slice(0, 5), description: String(p.description || "").slice(0, 300),
      offers: { "@type": "Offer", priceCurrency: p.currency || "GMD", price: Number(p.price || 0), availability: Number(p.stock || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: location.href }
    };
    if (seller) ld.offers.seller = { "@type": "Organization", name: JD.sellerName(seller) };
    if (count > 0) ld.aggregateRating = { "@type": "AggregateRating", ratingValue: avg.toFixed(1), reviewCount: count };
    let tag = document.getElementById("jd-ld");
    if (!tag) { tag = document.createElement("script"); tag.type = "application/ld+json"; tag.id = "jd-ld"; document.head.appendChild(tag); }
    tag.textContent = JSON.stringify(ld).replace(/</g, "\\u003c");
  }

  const stepper = (cls, stock) => '<div class="jd-qty ' + cls + '" role="group" aria-label="Quantity"><button type="button" data-qty="-1" aria-label="Decrease quantity" disabled>' + JD.icon("minus", 18) + '</button><output class="jd-qty-out" aria-live="polite">1</output><button type="button" data-qty="1" aria-label="Increase quantity"' + (stock <= 1 ? " disabled" : "") + ">" + JD.icon("plus", 18) + "</button></div>";
  const grid = rows => '<div class="jd-grid pd-grid">' + rows.map(JD.productCard).join("") + "</div>";
  const section = (idv, title, inner, link) => '<section class="pd-sec" id="' + idv + '" aria-labelledby="' + idv + '-h"><div class="pd-sec__head"><h2 id="' + idv + '-h">' + title + "</h2>" + (link || "") + "</div>" + inner + "</section>";

  function reviewsBlock(reviews, avg) {
    if (!reviews.length) return '<div class="pd-reviews-empty">' + JD.icon("star", 26) + "<div><strong>No reviews yet</strong><p>Only customers with a completed JulaDirect order can review, so every review here comes from a real purchase.</p></div></div>";
    const dist = [5, 4, 3, 2, 1].map(n => [n, reviews.filter(r => Math.round(Number(r.rating)) === n).length]);
    const item = r => '<article class="pd-review"><div class="pd-review__top">' + JD.stars(r.rating) + '<span class="pd-chip pd-chip--ok">' + JD.icon("check", 13) + "Verified purchase</span><time>" + JD.esc(JD.shortDate(r.created_at)) + "</time></div>" +
      (r.title ? "<h3>" + JD.esc(r.title) + "</h3>" : "") + (r.body ? "<p>" + JD.esc(r.body) + "</p>" : "") +
      (r.seller_reply ? '<div class="pd-reply"><strong>Reply from the seller</strong><p>' + JD.esc(r.seller_reply) + "</p></div>" : "") + "</article>";
    return '<div class="pd-rsum"><div class="pd-rsum__score"><b>' + avg.toFixed(1) + "</b>" + JD.stars(avg) + "<span>" + reviews.length + (reviews.length === 1 ? " review" : " reviews") + '</span></div><ul class="pd-rsum__bars" aria-label="Rating breakdown">' +
      dist.map(d => '<li><span>' + d[0] + " star</span><i><b style=\"width:" + Math.round((d[1] / reviews.length) * 100) + '%"></b></i><span>' + d[1] + "</span></li>").join("") + "</ul></div>" +
      '<div class="pd-rlist" id="pd-rlist">' + reviews.slice(0, 4).map(item).join("") + "</div>" +
      (reviews.length > 4 ? '<button type="button" class="jd-btn jd-btn--secondary" id="pd-morerev">Show all ' + reviews.length + " reviews</button>" : "");
  }

  function render(d) {
    const p = d.product, s = d.seller;
    const imgs = d.images.length ? d.images : [JD.placeholder];
    const stock = Number(p.stock || 0), reviews = d.reviews || [];
    const avg = reviews.length ? reviews.reduce((t, r) => t + Number(r.rating || 0), 0) / reviews.length : 0;
    const sold = Number(p.sales_count || 0), sellerName = JD.sellerName(s), verified = !!(s && s.is_seller_verified), cid = JD.esc(p.id);
    const avatar = JD.safeUrl(s && s.avatar_url), delivery = p.delivery_available === true;
    qty = 1;
    document.title = p.title + " — JulaDirect";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", (String(p.description || "").replace(/\s+/g, " ").slice(0, 150)) || p.title + " on JulaDirect");
    jsonLd(p, imgs, avg, reviews.length, s);
    JD.recent.add(p.id);

    const stockLine = stock <= 0 ? '<span class="pd-stock pd-stock--out"><i></i>Out of stock</span>' : stock <= 3 ? '<span class="pd-stock pd-stock--low"><i></i>Only ' + stock + " left, order soon</span>" : '<span class="pd-stock pd-stock--in"><i></i>In stock' + (stock <= 20 ? " &middot; " + stock + " available" : "") + "</span>";
    const ratingLine = (reviews.length ? '<a class="pd-rating" href="#pd-reviews">' + JD.stars(avg) + "<b>" + avg.toFixed(1) + "</b><span>(" + reviews.length + ")</span></a>" : '<span class="pd-rating pd-rating--none">No reviews yet</span>') +
      (sold > 0 ? '<span class="pd-dot">' + sold.toLocaleString("en-GB") + " sold</span>" : "") + '<span class="pd-dot">Listed ' + JD.esc(ago(p.created_at)) + "</span>";

    const facts = [["Condition", p.condition], ["Location", p.location || "The Gambia"], ["Delivery", delivery ? "Available" : "Pick-up / arrange with seller"], ["Category", p.category_id]].filter(f => f[1]);
    const specRows = [["Condition", p.condition], ["Category", p.category_id], ["Location", p.location], ["Delivery", delivery ? "Available" : "Not offered"], ["Listed", JD.shortDate(p.created_at)]];
    (p.attributes && typeof p.attributes === "object" ? Object.entries(p.attributes) : []).forEach(([k, v]) => specRows.push([humanize(k), specValue(v)]));
    const specs = specRows.filter(r => r[1]).map(r => '<tr><th scope="row">' + JD.esc(r[0]) + "</th><td>" + JD.esc(r[1]) + "</td></tr>").join("");
    const long = String(p.description || "").length > 380;

    const nav = [["pd-about", "Overview"], ["pd-details", "Details"], ["pd-reviews", "Reviews" + (reviews.length ? " (" + reviews.length + ")" : "")], ["pd-seller", "Seller"]];
    if (d.related.length) nav.push(["pd-similar", "Similar"]);

    root.innerHTML = topbar(p.title) +
      '<nav class="jd-breadcrumb pd-crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a><span aria-hidden="true">/</span><a href="explore.html">Explore</a>' +
      (p.category_id ? '<span aria-hidden="true">/</span><a href="explore.html?category=' + encodeURIComponent(p.category_id) + '">' + JD.esc(p.category_id) + "</a>" : "") +
      '<span aria-hidden="true">/</span><span aria-current="page">' + JD.esc(p.title) + "</span></nav>" +

      '<div class="pd"><div class="pd-gallery"><div class="pd-stage"><div class="pd-track" id="pd-track" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Product photos">' +
      imgs.map((u, i) => '<div class="pd-slide"><img src="' + JD.esc(u) + '" alt="' + JD.esc(p.title) + (imgs.length > 1 ? " — photo " + (i + 1) + " of " + imgs.length : "") + '" ' + (i ? 'loading="lazy"' : 'fetchpriority="high"') + ' decoding="async" draggable="false" data-zoom="' + i + '"></div>').join("") + "</div>" +
      '<div class="pd-stage__tags">' + (p.condition === "New" ? '<span class="pd-tag">New</span>' : "") + (sold >= 10 ? '<span class="pd-tag pd-tag--hot">Best seller</span>' : "") + "</div>" +
      '<button type="button" class="pd-fab pd-fab--wish" data-wish="' + cid + '" aria-pressed="false" aria-label="Save to wishlist">' + JD.icon("heart", 22) + "</button>" +
      '<button type="button" class="pd-fab pd-fab--zoom" data-lightbox="0" aria-label="View photos full screen">' + JD.icon("expand", 20) + "</button>" +
      (imgs.length > 1 ? '<button type="button" class="pd-arrow pd-arrow--prev" data-slide="-1" aria-label="Previous photo">' + JD.icon("chevronRight", 22) + '</button><button type="button" class="pd-arrow pd-arrow--next" data-slide="1" aria-label="Next photo">' + JD.icon("chevronRight", 22) + '</button><span class="pd-counter" aria-hidden="true"><b id="pd-cur">1</b> / ' + imgs.length + '</span><div class="pd-dots" aria-hidden="true">' + imgs.map((u, i) => "<i" + (i ? "" : ' class="is-on"') + "></i>").join("") + "</div>" : "") + "</div>" +
      (imgs.length > 1 ? '<div class="pd-thumbs" role="group" aria-label="Choose a photo">' + imgs.map((u, i) => '<button type="button" class="pd-thumb" data-thumb="' + i + '"' + (i === 0 ? ' aria-current="true"' : "") + ' aria-label="Show photo ' + (i + 1) + " of " + imgs.length + '"><img src="' + JD.esc(u) + '" alt="" loading="lazy"></button>').join("") + "</div>" : "") + "</div>" +

      '<div class="pd-buy">' +
      (p.category_id ? '<a class="pd-cat" href="explore.html?category=' + encodeURIComponent(p.category_id) + '">' + JD.esc(p.category_id) + "</a>" : "") +
      '<h1 class="pd-title">' + JD.esc(p.title) + '</h1><div class="pd-rate">' + ratingLine + "</div>" +
      '<div class="pd-priceblock"><div class="pd-price">' + JD.esc(JD.money(p.price, p.currency)) + '</div><div class="pd-pricenote">' + stockLine + (delivery ? '<span class="pd-chip">' + JD.icon("truck", 14) + "Delivery</span>" : "") + '<span class="pd-chip">' + JD.icon("wallet", 14) + "Pay on delivery</span></div></div>" +
      '<dl class="pd-facts">' + facts.map(f => "<div><dt>" + f[0] + "</dt><dd>" + JD.esc(f[1]) + "</dd></div>").join("") + "</dl>" +
      '<div class="pd-qtyrow"><span class="pd-qtylabel" id="pd-qtylabel">Quantity</span>' + stepper("pd-qty", stock) + "</div>" +
      '<div class="pd-cta"><button type="button" class="jd-btn jd-btn--primary jd-btn--lg" data-pdp-add' + (stock <= 0 ? " disabled" : "") + ">" + JD.icon("cart", 20) + (stock <= 0 ? "Out of stock" : "Add to cart") + '</button><button type="button" class="jd-btn jd-btn--dark jd-btn--lg" data-pdp-buy' + (stock <= 0 ? " disabled" : "") + ">Buy now</button></div>" +
      '<div class="pd-tools"><button type="button" class="pd-tool" data-wish="' + cid + '" aria-pressed="false">' + JD.icon("heart", 18) + "<span>Save</span></button><button type=\"button\" class=\"pd-tool\" data-compare=\"" + cid + '" aria-pressed="false">' + JD.icon("scale", 18) + "<span>Compare</span></button><button type=\"button\" class=\"pd-tool\" id=\"jd-share-2\">" + JD.icon("arrowUpRight", 18) + "<span>Share</span></button><button type=\"button\" class=\"pd-tool\" id=\"pd-report\">" + JD.icon("flag", 18) + "<span>Report</span></button></div>" +
      '<ul class="pd-assure"><li>' + JD.icon("wallet", 20) + "<div><b>Pay when it arrives</b><span>Cash on delivery is available at checkout.</span></div></li>" +
      "<li>" + JD.icon("truck", 20) + "<div><b>" + (delivery ? "Delivery with a code" : "Arrange with the seller") + "</b><span>" + (delivery ? "You share a code with the courier on arrival to confirm the handover." : "This seller does not offer delivery. Message them to agree on pick-up.") + "</span></div></li>" +
      "<li>" + JD.icon("shield", 20) + "<div><b>Protected by JulaDirect</b><span>Refund and dispute cases are reviewed by our team.</span></div></li></ul>" +
      '<div class="pd-seller" id="pd-sellermini"><span class="pd-seller__av">' + (avatar ? '<img src="' + JD.esc(avatar) + '" alt="" loading="lazy">' : JD.esc(sellerName.charAt(0).toUpperCase())) + '</span><div class="pd-seller__t"><b>' + JD.esc(sellerName) + (verified ? '<span class="pd-chip pd-chip--blue">' + JD.icon("shield", 13) + "Verified</span>" : "") + "</b><small>" + (s && s.region ? JD.esc(s.region) + " &middot; " : "") + (verified ? "Identity checked by JulaDirect" : "JulaDirect member") + '</small></div><button type="button" class="jd-btn jd-btn--soft jd-btn--sm" id="jd-msg">' + JD.icon("message", 16) + "Message</button></div></div></div>" +

      '<nav class="pd-nav" id="pd-nav" aria-label="Page sections"><div class="pd-nav__in">' + nav.map((n, i) => '<a href="#' + n[0] + '"' + (i === 0 ? ' aria-current="true"' : "") + ">" + n[1] + "</a>").join("") + "</div></nav>" +

      '<div class="pd-body"><div class="pd-main">' +
      section("pd-about", "About this item", p.description ? '<div class="pd-desc' + (long ? " is-clamped" : "") + '" id="pd-desc"><p>' + JD.esc(p.description) + "</p></div>" + (long ? '<button type="button" class="pd-more" id="pd-desc-toggle" aria-expanded="false" aria-controls="pd-desc">Read more</button>' : "") : '<p class="jd-muted">The seller has not added a description yet. Message them if you want to know more.</p>') +
      section("pd-details", "Specifications", '<table class="pd-specs"><tbody>' + specs + "</tbody></table>") +
      section("pd-reviews", "Customer reviews", reviewsBlock(reviews, avg)) +
      "</div>" +
      '<aside class="pd-aside"><section class="pd-card pd-sellercard" id="pd-seller" aria-labelledby="pd-seller-h"><h2 id="pd-seller-h">About the seller</h2><div class="pd-seller pd-seller--lg"><span class="pd-seller__av">' + (avatar ? '<img src="' + JD.esc(avatar) + '" alt="" loading="lazy">' : JD.esc(sellerName.charAt(0).toUpperCase())) + '</span><div class="pd-seller__t"><b>' + JD.esc(sellerName) + "</b><small>" + (verified ? "Verified seller" : "JulaDirect member") + (s && s.region ? " &middot; " + JD.esc(s.region) : "") + "</small></div></div>" +
      '<ul class="pd-sellerfacts">' + (verified ? "<li>" + JD.icon("shield", 16) + "Identity and business checked</li>" : "<li>" + JD.icon("user", 16) + "Registered JulaDirect member</li>") + "<li>" + JD.icon("bag", 16) + (d.moreFromSeller.length + 1) + (d.moreFromSeller.length >= 6 ? "+" : "") + " active listing" + (d.moreFromSeller.length ? "s" : "") + "</li>" + (s && s.seller_type ? "<li>" + JD.icon("store", 16) + JD.esc(humanize(s.seller_type)) + "</li>" : "") + "</ul>" +
      '<div class="pd-sellercard__btns"><button type="button" class="jd-btn jd-btn--primary" id="jd-msg-2">' + JD.icon("message", 17) + 'Message seller</button><a class="jd-btn jd-btn--secondary" href="explore.html?seller=' + encodeURIComponent(p.seller_id) + '">All listings</a></div></section>' +
      '<section class="pd-card pd-safe" aria-labelledby="pd-safe-h"><h2 id="pd-safe-h">' + JD.icon("lock", 18) + "Buy with confidence</h2><ul><li>Keep payment and chat on JulaDirect so you stay protected.</li><li>Check the item when it arrives, before you pay the courier.</li><li>Meet in a public place if you collect in person.</li><li>Never share your delivery code before you have your item.</li></ul></section></aside></div>" +

      (d.moreFromSeller.length ? section("pd-more-seller", "More from " + JD.esc(sellerName), grid(d.moreFromSeller), '<a class="jd-link" href="explore.html?seller=' + encodeURIComponent(p.seller_id) + '">See all</a>') : "") +
      (d.related.length ? section("pd-similar", "Similar items", grid(d.related), '<a class="jd-link" href="explore.html?category=' + encodeURIComponent(p.category_id || "") + '">See all</a>') : "") +
      '<div id="pd-recent"></div>' +

      '<div class="pd-buybar" role="region" aria-label="Purchase"><div class="pd-buybar__price"><small>Price</small><strong>' + JD.esc(JD.money(p.price, p.currency)) + '</strong></div><button type="button" class="jd-btn jd-btn--secondary" data-pdp-add' + (stock <= 0 ? " disabled" : "") + ' aria-label="Add to cart">' + JD.icon("cart", 20) + '</button><button type="button" class="jd-btn jd-btn--primary" data-pdp-buy' + (stock <= 0 ? " disabled" : "") + ">" + (stock <= 0 ? "Out of stock" : "Buy now") + "</button></div>";

    if (JD.paneClass) JD.paneClass("product", "has-mobilebar", true); else document.body.classList.add("has-mobilebar");
    JD.syncWishlist(root); JD.syncCompare(); if (JD.refreshCartCount) JD.refreshCartCount();
    bindGallery(imgs.length); bindSpy(); hideOwnMessage(p); loadRecent(p.id);
  }

  /* ----- gallery ----- */
  function trackIndex() { const t = document.getElementById("pd-track"); return t ? Math.round(t.scrollLeft / Math.max(1, t.clientWidth)) : 0; }
  function showSlide(i, smooth) {
    const t = document.getElementById("pd-track"); if (!t) return;
    const n = t.children.length, k = Math.min(n - 1, Math.max(0, i));
    t.scrollTo({ left: k * t.clientWidth, behavior: smooth === false || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function bindGallery(n) {
    const t = document.getElementById("pd-track"); if (!t) return;
    let raf = 0;
    t.addEventListener("scroll", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = trackIndex();
        const cur = document.getElementById("pd-cur"); if (cur) cur.textContent = String(i + 1);
        JD.$$(".pd-dots i", root).forEach((x, k) => x.classList.toggle("is-on", k === i));
        JD.$$("[data-thumb]", root).forEach((b, k) => b.setAttribute("aria-current", String(k === i)));
        const zb = root.querySelector("[data-lightbox]"); if (zb) zb.setAttribute("data-lightbox", String(i));
      });
    }, { passive: true });
    t.addEventListener("keydown", e => { if (e.key === "ArrowRight") { showSlide(trackIndex() + 1); e.preventDefault(); } else if (e.key === "ArrowLeft") { showSlide(trackIndex() - 1); e.preventDefault(); } });
    /* desktop hover zoom */
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      t.addEventListener("pointermove", e => {
        const img = e.target.closest && e.target.closest("img"); if (!img) return;
        const r = img.getBoundingClientRect();
        img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + "% " + ((e.clientY - r.top) / r.height * 100) + "%";
      });
    }
  }

  /* ----- lightbox ----- */
  function openLightbox(start) {
    if (!current || lb) return;
    const imgs = current.images.length ? current.images : [JD.placeholder];
    let i = Math.min(Math.max(0, start), imgs.length - 1);
    const opener = document.activeElement;
    lb = document.createElement("div");
    lb.className = "pd-lb"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Product photos"); lb.tabIndex = -1;
    const paint = () => {
      lb.innerHTML = '<button type="button" class="pd-lb__x" data-lb-close aria-label="Close">' + JD.icon("close", 24) + "</button>" +
        '<div class="pd-lb__stage"><img src="' + JD.esc(imgs[i]) + '" alt="' + JD.esc(current.product.title) + " — photo " + (i + 1) + " of " + imgs.length + '"></div>' +
        (imgs.length > 1 ? '<button type="button" class="pd-lb__nav pd-lb__nav--prev" data-lb="-1" aria-label="Previous photo">' + JD.icon("chevronRight", 26) + '</button><button type="button" class="pd-lb__nav pd-lb__nav--next" data-lb="1" aria-label="Next photo">' + JD.icon("chevronRight", 26) + '</button><div class="pd-lb__count">' + (i + 1) + " / " + imgs.length + "</div>" : "");
    };
    const close = () => { if (!lb) return; document.removeEventListener("keydown", key, true); lb.remove(); lb = null; document.documentElement.classList.remove("qv-lock"); if (opener && opener.focus) opener.focus({ preventScroll: true }); };
    const step = d => { i = (i + d + imgs.length) % imgs.length; paint(); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } else if (e.key === "ArrowRight" && imgs.length > 1) step(1); else if (e.key === "ArrowLeft" && imgs.length > 1) step(-1); else if (e.key === "Tab") { e.preventDefault(); const f = lb.querySelectorAll("button"); if (f.length) { const idx = Array.prototype.indexOf.call(f, document.activeElement); f[(idx + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } } };
    lb.addEventListener("click", e => {
      if (e.target.closest("[data-lb-close]") || e.target === lb || e.target.classList.contains("pd-lb__stage")) return close();
      const b = e.target.closest("[data-lb]"); if (b) return step(Number(b.getAttribute("data-lb")));
      const img = e.target.closest("img"); if (img) img.classList.toggle("is-zoomed");
    });
    let x0 = null;
    lb.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", e => { if (x0 === null || imgs.length < 2) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); x0 = null; }, { passive: true });
    paint();
    document.body.appendChild(lb);
    document.documentElement.classList.add("qv-lock");
    document.addEventListener("keydown", key, true);
    lb.focus();
  }

  /* ----- section navigation (scroll spy) ----- */
  function bindSpy() {
    if (spy) spy.disconnect();
    const links = JD.$$("#pd-nav a", root);
    if (!links.length || !("IntersectionObserver" in window)) return;
    const secs = links.map(a => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
    spy = new IntersectionObserver(es => {
      es.forEach(en => { if (en.isIntersecting) links.forEach(a => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + en.target.id))); });
    }, { rootMargin: "-30% 0px -60% 0px" });
    secs.forEach(s => spy.observe(s));
  }

  async function loadRecent(skip) {
    const ids = JD.recent.ids().filter(x => x !== skip).slice(0, 6);
    const box = document.getElementById("pd-recent"); if (!box || !ids.length) return;
    try {
      const rows = await JD.data.byIds(ids);
      if (rows.length && document.getElementById("pd-recent") === box && current && current.product.id === skip) {
        box.innerHTML = section("pd-recent-sec", "Recently viewed", grid(rows));
        JD.syncWishlist(box); JD.syncCompare();
      }
    } catch (e) { /* optional section */ }
  }

  async function hideOwnMessage(p) {
    try {
      const A = JD.auth(); await A.ready();
      const user = await A.getUser();
      if (user && user.id === p.seller_id) {
        const own = '<a class="jd-btn jd-btn--soft jd-btn--sm" href="supplier/products.html">Manage</a>';
        const a = document.getElementById("jd-msg"); if (a) a.outerHTML = own;
        const b = document.getElementById("jd-msg-2"); if (b) b.outerHTML = '<a class="jd-btn jd-btn--primary" href="supplier/products.html">Manage this listing</a>';
      }
    } catch (e) { /* guests keep the default button */ }
  }

  function setQty(next) {
    const stock = Number(current.product.stock || 0);
    qty = Math.min(Math.max(1, next), Math.max(1, stock));
    JD.$$(".jd-qty-out", root).forEach(o => { o.textContent = String(qty); });
    JD.$$('[data-qty="-1"]', root).forEach(b => { b.disabled = qty <= 1; });
    JD.$$('[data-qty="1"]', root).forEach(b => { b.disabled = qty >= stock; });
  }

  async function load() {
    if (!JD.isUuid(id)) { notFound("This product link is not valid", "Check the link or browse the marketplace to find what you need."); return; }
    const paint = d => {
      if (!d.product) { current = null; notFound("This product is no longer available", "It may have been sold, removed or is awaiting review."); return; }
      current = d; render(d);
    };
    try { await JD.swr("product:" + id, () => JD.data.product(id), paint); }
    catch (e) { console.warn("[JulaDirect] product", e && e.message); failed(e && e.message); }
  }

  function syncProductRoute(rawUrl) {
    let nextId = null;
    try { nextId = new URL(rawUrl || location.href, location.href).searchParams.get("id"); } catch (e) { nextId = null; }
    if (nextId === id) return;
    id = nextId; current = null; qty = 1;
    if (spy) spy.disconnect();
    document.title = "Product — JulaDirect";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "View product details, seller information and reviews on JulaDirect.");
    root.innerHTML = topbar() + SKELETON;
    window.scrollTo({ top: 0 });
    load();
  }
  window.addEventListener("jd:pane:show", event => { if (event.detail && event.detail.route === "product") syncProductRoute(event.detail.url); });

  async function share() {
    const title = current ? current.product.title : document.title;
    try {
      if (navigator.share) { await navigator.share({ title: title, url: location.href }); return; }
      await navigator.clipboard.writeText(location.href);
      JD.toast("Link copied", "ok");
    } catch (e) { /* cancelled or clipboard blocked */ }
  }

  async function requireUser() {
    try { const A = JD.auth(); await A.ready(); const u = await A.getUser(); if (u) return u; } catch (e) { /* fall through */ }
    location.href = JD.loginUrl(); return null;
  }

  async function messageSeller() {
    const user = await requireUser(); if (!user) return;
    location.href = "messages.html?product=" + encodeURIComponent(current.product.id);
  }

  function openReport() {
    if (!current) return;
    let dlg = document.getElementById("pd-report-dlg");
    if (dlg) dlg.remove();
    dlg = document.createElement("dialog"); dlg.id = "pd-report-dlg"; dlg.className = "jd-dialog";
    dlg.innerHTML = '<form method="dialog" id="pd-report-form"><h2>Report this listing</h2><p class="jd-muted" style="margin:0">Tell us what is wrong. Our team reviews every report.</p>' +
      '<label class="jd-field"><span>Reason</span><select class="jd-select" name="type" required>' + REASONS.map(r => '<option value="' + r[0] + '">' + r[1] + "</option>").join("") + "</select></label>" +
      '<label class="jd-field"><span>Details</span><textarea class="jd-input" name="reason" rows="4" maxlength="1000" required placeholder="What should we look at?"></textarea></label>' +
      '<p class="jd-form-note" id="pd-report-note" role="alert"></p><div class="jd-dialog__actions"><button type="button" class="jd-btn jd-btn--secondary" data-close>Cancel</button><button type="submit" class="jd-btn jd-btn--primary">Send report</button></div></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener("click", e => { if (e.target.closest("[data-close]") || e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    dlg.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      const f = e.target, note = document.getElementById("pd-report-note"), btn = f.querySelector('[type="submit"]');
      const reason = f.reason.value.trim(); if (reason.length < 5) { note.textContent = "Please add a little more detail."; note.classList.add("is-error"); return; }
      btn.disabled = true; note.textContent = "Sending…"; note.classList.remove("is-error");
      try {
        const user = await requireUser(); if (!user) return;
        const c = await JD.client();
        const { error } = await c.rpc("create_trust_report", { p_target_user_id: null, p_target_product_id: current.product.id, p_target_store_id: null, p_report_type: f.type.value, p_reason: reason, p_evidence: null });
        if (error) throw error;
        dlg.close(); JD.toast("Thanks. Our team will review this listing.", "ok");
      } catch (err) { btn.disabled = false; note.textContent = "We could not send your report. Please try again."; note.classList.add("is-error"); console.warn("[JulaDirect] report", err && err.message); }
    });
    dlg.showModal();
  }

  document.addEventListener("click", async e => {
    if (e.target.closest("#jd-back")) { if (history.length > 1 && document.referrer.indexOf(location.origin) === 0) history.back(); else location.href = "explore.html"; return; }
    if (e.target.closest("#jd-share")) { share(); return; }
    if (!current) { if (e.target.closest("#jd-retry")) load(); return; }
    const t = sel => e.target.closest(sel);
    let b;
    if ((b = t("[data-thumb]"))) showSlide(Number(b.getAttribute("data-thumb")));
    else if ((b = t("[data-slide]"))) showSlide(trackIndex() + Number(b.getAttribute("data-slide")));
    else if ((b = t("[data-lightbox]"))) openLightbox(Number(b.getAttribute("data-lightbox")));
    else if ((b = t("img[data-zoom]"))) openLightbox(Number(b.getAttribute("data-zoom")));
    else if ((b = t("[data-qty]"))) setQty(qty + Number(b.getAttribute("data-qty")));
    else if ((b = t("[data-pdp-add]"))) { b.disabled = true; await JD.addToCart(current.product.id, qty); b.disabled = false; }
    else if ((b = t("[data-pdp-buy]"))) { b.disabled = true; const r = await JD.addToCart(current.product.id, qty); if (r && r.success) location.href = "checkout.html"; else b.disabled = false; }
    else if (t("#jd-msg") || t("#jd-msg-2")) messageSeller();
    else if (t("#jd-share-2")) share();
    else if (t("#pd-report")) openReport();
    else if ((b = t("#pd-desc-toggle"))) { const d = document.getElementById("pd-desc"), open = d.classList.toggle("is-clamped") === false; b.textContent = open ? "Show less" : "Read more"; b.setAttribute("aria-expanded", String(open)); }
    else if (t("#pd-morerev")) {
      const list = document.getElementById("pd-rlist"), all = current.reviews;
      list.insertAdjacentHTML("beforeend", all.slice(4).map(r => '<article class="pd-review"><div class="pd-review__top">' + JD.stars(r.rating) + '<span class="pd-chip pd-chip--ok">' + JD.icon("check", 13) + "Verified purchase</span><time>" + JD.esc(JD.shortDate(r.created_at)) + "</time></div>" + (r.title ? "<h3>" + JD.esc(r.title) + "</h3>" : "") + (r.body ? "<p>" + JD.esc(r.body) + "</p>" : "") + (r.seller_reply ? '<div class="pd-reply"><strong>Reply from the seller</strong><p>' + JD.esc(r.seller_reply) + "</p></div>" : "") + "</article>").join(""));
      t("#pd-morerev").remove();
    }
    else if ((b = t('#pd-nav a[href^="#"]'))) {
      const target = document.getElementById(b.getAttribute("href").slice(1));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }
    }
  });

  JD.mountShell({ active: "" });
  JD.bindProductActions(document);
  load();
})();
