/* =========================================================
   JulaDirect quick view: a mini product sheet opened from any product card.
   Bottom sheet on phones, side drawer on larger screens. Shows the photos,
   price, stock, seller and the same actions as the product page, plus a
   link to the full details. Cart, wishlist and compare use the shared
   delegated handlers (data-wish / data-compare); add to cart and buy now use
   JD.addToCart. Loaded on demand by js/jd-core.js.
   ========================================================= */
(function () {
  "use strict";
  const JD = window.JD;
  if (!JD || JD.quickView) return;
  const rawOn = (t, type, fn, o) => (JD.rawAddEventListener || EventTarget.prototype.addEventListener).call(t, type, fn, o);
  const mq = window.matchMedia("(max-width: 720px)");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let el = null, scrim = null, opener = null, token = 0, qty = 1, data = null, closing = false;
  const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

  const fetcher = id => JD.data.product(id);
  function warm(id) { return JD.swr("product:" + id, () => fetcher(id), () => {}).catch(() => {}); }

  function skeleton() {
    return '<div class="qv__scroll" aria-busy="true"><div class="jd-skel qv-skel-img"></div><div class="qv__info"><div class="jd-skel" style="height:30px;width:42%"></div><div class="jd-skel" style="height:22px;width:86%"></div><div class="jd-skel" style="height:70px"></div></div></div>';
  }
  function message(title, text) {
    return '<div class="qv__scroll"><div class="qv__msg"><h2 id="qv-title">' + JD.esc(title) + "</h2><p>" + JD.esc(text) + '</p><a class="jd-btn jd-btn--primary" href="' + JD.root + 'explore.html">Browse the marketplace</a></div></div>';
  }

  function paint(d) {
    data = d;
    const p = d.product;
    if (!p) { el.innerHTML = closeBtn() + message("This product is no longer available", "It may have been sold or removed."); return; }
    const stock = Number(p.stock || 0), imgs = d.images.length ? d.images : [JD.placeholder];
    const reviews = d.reviews || [], avg = reviews.length ? reviews.reduce((t, r) => t + Number(r.rating || 0), 0) / reviews.length : 0;
    const s = d.seller, verified = !!(s && s.is_seller_verified), name = JD.sellerName(s), sold = Number(p.sales_count || 0);
    const url = JD.root + "product.html?id=" + encodeURIComponent(p.id);
    qty = 1;
    const stockBadge = stock <= 0 ? '<span class="jd-badge jd-badge--bad">Out of stock</span>' : stock <= 3 ? '<span class="jd-badge jd-badge--warn">Only ' + stock + " left</span>" : '<span class="jd-badge jd-badge--ok">' + JD.icon("check", 14) + "In stock</span>";
    el.innerHTML = closeBtn() +
      '<div class="qv__scroll"><div class="qv-gal"><div class="qv-track" tabindex="0" role="group" aria-label="Product photos, ' + imgs.length + ' total">' +
      imgs.map((u, i) => '<img src="' + JD.esc(u) + '" alt="' + JD.esc(p.title) + (imgs.length > 1 ? " — photo " + (i + 1) : "") + '" ' + (i ? 'loading="lazy"' : "") + ' decoding="async" draggable="false">').join("") + "</div>" +
      (imgs.length > 1 ? '<span class="qv-count" aria-hidden="true"><b>1</b> / ' + imgs.length + '</span><button type="button" class="qv-nav qv-nav--prev" data-qv-nav="-1" aria-label="Previous photo">' + JD.icon("chevronRight", 20) + '</button><button type="button" class="qv-nav qv-nav--next" data-qv-nav="1" aria-label="Next photo">' + JD.icon("chevronRight", 20) + '</button><div class="qv-dots" aria-hidden="true">' + imgs.map((u, i) => "<i" + (i ? "" : ' class="is-on"') + "></i>").join("") + "</div>" : "") + "</div>" +
      '<div class="qv__info"><div class="qv-pricerow"><div class="qv-price">' + JD.esc(JD.money(p.price, p.currency)) + "</div>" + stockBadge + "</div>" +
      '<h2 id="qv-title" class="qv-title">' + JD.esc(p.title) + "</h2>" +
      '<div class="qv-meta">' + (reviews.length ? JD.stars(avg) + "<span><b>" + avg.toFixed(1) + "</b> (" + reviews.length + ")</span>" : "<span>No reviews yet</span>") + (sold > 0 ? "<span>" + sold.toLocaleString("en-GB") + " sold</span>" : "") + "</div>" +
      '<div class="qv-chips">' + (p.condition ? '<span class="jd-badge">' + JD.esc(p.condition) + "</span>" : "") + '<span class="jd-badge">' + JD.icon("pin", 14) + JD.esc(p.location || "The Gambia") + "</span>" + (p.delivery_available === true ? '<span class="jd-badge jd-badge--ok">' + JD.icon("truck", 14) + "Delivery</span>" : "") + "</div>" +
      (p.description ? '<p class="qv-desc">' + JD.esc(p.description) + "</p>" : "") +
      '<div class="qv-seller"><span class="qv-seller__av">' + (JD.safeUrl(s && s.avatar_url) ? '<img src="' + JD.esc(JD.safeUrl(s.avatar_url)) + '" alt="" loading="lazy">' : JD.esc(name.charAt(0).toUpperCase())) + '</span><span class="qv-seller__t"><b>' + JD.esc(name) + (verified ? JD.icon("shield", 15) : "") + "</b><small>" + (verified ? "Verified seller" : "JulaDirect member") + (s && s.region ? " · " + JD.esc(s.region) : "") + "</small></span></div>" +
      '<div class="qv-tools"><button type="button" class="qv-tool" data-wish="' + JD.esc(p.id) + '" aria-pressed="false">' + JD.icon("heart", 18) + "<span>Save</span></button>" +
      '<button type="button" class="qv-tool" data-compare="' + JD.esc(p.id) + '" aria-pressed="false">' + JD.icon("scale", 18) + "<span>Compare</span></button>" +
      '<button type="button" class="qv-tool" data-qv-share>' + JD.icon("arrowUpRight", 18) + "<span>Share</span></button></div></div></div>" +
      '<div class="qv__foot"><div class="qv-buy"><div class="jd-qty" role="group" aria-label="Quantity"><button type="button" data-qv-qty="-1" aria-label="Decrease quantity" disabled>' + JD.icon("minus", 18) + '</button><output aria-live="polite">1</output><button type="button" data-qv-qty="1" aria-label="Increase quantity"' + (stock <= 1 ? " disabled" : "") + ">" + JD.icon("plus", 18) + '</button></div><button type="button" class="jd-btn jd-btn--primary jd-btn--lg" data-qv-add' + (stock <= 0 ? " disabled" : "") + ">" + JD.icon("cart", 19) + (stock <= 0 ? "Out of stock" : "Add to cart") + "</button></div>" +
      '<div class="qv-links"><button type="button" class="jd-btn jd-btn--soft" data-qv-buy' + (stock <= 0 ? " disabled" : "") + '>Buy now</button><a class="jd-btn jd-btn--secondary" href="' + JD.esc(url) + '" data-qv-details>View full details' + JD.icon("arrowRight", 18) + "</a></div></div>";
    bindGallery();
    JD.syncWishlist(el);
    JD.syncCompare();
  }
  const closeBtn = () => '<div class="qv__grab" data-qv-grab><i></i></div><button type="button" class="qv__x" data-qv-close aria-label="Close quick view">' + JD.icon("close", 22) + "</button>";

  function bindGallery() {
    const track = el.querySelector(".qv-track");
    if (!track) return;
    const dots = el.querySelectorAll(".qv-dots i"), count = el.querySelector(".qv-count b");
    if (!dots.length) return;
    let raf = 0;
    track.addEventListener("scroll", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        dots.forEach((d, k) => d.classList.toggle("is-on", k === i));
        if (count) count.textContent = String(i + 1);
      });
    }, { passive: true });
    track.addEventListener("keydown", e => { if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else return; e.preventDefault(); });
  }
  function go(dir) {
    const track = el && el.querySelector(".qv-track");
    if (!track) return;
    const n = track.children.length, i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    track.scrollTo({ left: Math.min(n - 1, Math.max(0, i + dir)) * track.clientWidth, behavior: reduce.matches ? "auto" : "smooth" });
  }

  function setQty(next) {
    const stock = Number(data.product.stock || 0);
    qty = Math.min(Math.max(1, next), Math.max(1, stock));
    el.querySelector(".jd-qty output").textContent = String(qty);
    el.querySelector('[data-qv-qty="-1"]').disabled = qty <= 1;
    el.querySelector('[data-qv-qty="1"]').disabled = qty >= stock;
  }

  async function onClick(e) {
    if (e.target.closest("[data-qv-close]")) return close();
    if (e.target.closest("[data-qv-details]")) { close(true); return; }
    const nav = e.target.closest("[data-qv-nav]");
    if (nav) return go(Number(nav.getAttribute("data-qv-nav")));
    if (!data || !data.product) return;
    const q = e.target.closest("[data-qv-qty]");
    if (q) return setQty(qty + Number(q.getAttribute("data-qv-qty")));
    const add = e.target.closest("[data-qv-add]"), buy = e.target.closest("[data-qv-buy]");
    if (add) { add.disabled = true; await JD.addToCart(data.product.id, qty); add.disabled = false; return; }
    if (buy) { buy.disabled = true; const r = await JD.addToCart(data.product.id, qty); if (r && r.success) { close(true); JD.go(JD.root + "checkout.html"); } else buy.disabled = false; return; }
    if (e.target.closest("[data-qv-share]")) {
      const url = new URL(JD.root + "product.html?id=" + encodeURIComponent(data.product.id), location.href).href;
      try { if (navigator.share) await navigator.share({ title: data.product.title, url }); else { await navigator.clipboard.writeText(url); JD.toast("Link copied", "ok"); } } catch (err) { /* cancelled */ }
    }
  }

  function onKey(e) {
    if (!el) return;
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const items = Array.from(el.querySelectorAll(FOCUSABLE)).filter(n => n.offsetParent !== null);
    if (!items.length) { e.preventDefault(); el.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* Drag the handle (phones) to dismiss. */
  function bindDrag() {
    let y0 = 0, dy = 0, t0 = 0, on = false;
    el.addEventListener("pointerdown", e => {
      if (!mq.matches || !e.target.closest("[data-qv-grab]")) return;
      on = true; y0 = e.clientY; dy = 0; t0 = Date.now(); el.style.transition = "none"; el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", e => { if (!on) return; dy = Math.max(0, e.clientY - y0); el.style.transform = "translateY(" + dy + "px)"; });
    const end = () => {
      if (!on) return; on = false; el.style.transition = "";
      const v = dy / Math.max(1, Date.now() - t0);
      if (dy > 120 || (dy > 40 && v > .6)) close(); else el.style.transform = "";
    };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }

  function open(id, from) {
    if (el) close(true);
    closing = false; opener = from || document.activeElement; data = null; qty = 1;
    const my = ++token;
    scrim = document.createElement("div"); scrim.className = "qv-scrim"; scrim.addEventListener("click", () => close());
    el = document.createElement("section");
    el.className = "qv"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "qv-title"); el.tabIndex = -1;
    el.innerHTML = closeBtn() + skeleton();
    el.addEventListener("click", onClick);
    bindDrag();
    document.body.append(scrim, el);
    document.documentElement.classList.add("qv-lock");
    rawOn(document, "keydown", onKey, true);
    requestAnimationFrame(() => { scrim.classList.add("is-on"); el.classList.add("is-on"); el.focus({ preventScroll: true }); });
    JD.swr("product:" + id, () => fetcher(id), d => { if (my === token && el) { paint(d); } }).catch(err => {
      if (my !== token || !el) return;
      console.warn("[JulaDirect] quick view", err && err.message);
      el.innerHTML = closeBtn() + message("We could not load this product", "Check your connection and try again.");
    });
  }

  function close(instant) {
    if (!el || closing) return;
    closing = true; token++;
    const e = el, s = scrim, back = opener;
    el = scrim = null; opener = null; data = null;
    document.removeEventListener("keydown", onKey, true);
    const done = () => { e.remove(); s.remove(); document.documentElement.classList.remove("qv-lock"); closing = false; };
    if (instant === true || reduce.matches) done(); else { e.classList.remove("is-on"); s.classList.remove("is-on"); e.style.transform = ""; setTimeout(done, 240); }
    if (instant !== true && back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
  }

  window.addEventListener("jd:pane:hide", () => close(true));
  window.addEventListener("pagehide", () => close(true));
  JD.quickView = { open, close, warm };
})();
