/* JulaDirect v2 cart. Signed-in carts are the server-side cart_items table
   through the existing adapter. A guest cart left in localStorage by older
   pages is shown read-only-ish (quantity/remove) and is migrated into the
   server cart on sign-in using the same calls the previous cart used, so
   checkout keeps working unchanged. */
(function () {
  "use strict";
  const JD = window.JD;
  const root = document.getElementById("jd-cart");
  const sub = document.getElementById("jd-cart-sub");
  const LOCAL_KEY = "gambasket_cart";
  const state = { items: [], auth: false };

  /* ---------- guest cart (legacy storage contract) ---------- */
  const localCart = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch (e) { return []; } };
  const saveLocal = arr => { try { arr.length ? localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)) : localStorage.removeItem(LOCAL_KEY); } catch (e) { /* storage unavailable */ } };
  function localItems() {
    return localCart().map((it, i) => {
      const stockKnown = it.stock !== null && it.stock !== undefined && it.stock !== "" && Number.isFinite(Number(it.stock));
      return {
        __index: i,
        product_id: it.id,
        quantity: Math.max(1, Math.min(99, Number(it.quantity || 1))),
        product: { id: it.id, title: it.name, price: Number(it.price || 0), currency: "GMD", stock: stockKnown ? Number(it.stock) : null, main_image: it.image || "", seller_name: it.seller || null, status: "unverified_snapshot" }
      };
    });
  }
  async function migrateGuestCart() {
    const A = JD.auth();
    const guest = localCart();
    if (!guest.length || !A || !A.addToCart) return;
    const remaining = [];
    for (const it of guest) {
      try {
        const pid = A.resolveProductId ? await A.resolveProductId(it.id, it.name) : null;
        if (!pid) { remaining.push(it); continue; }
        const r = await A.addToCart(pid, Number(it.quantity || 1));
        if (!r || !r.success) remaining.push(it);
      } catch (e) { remaining.push(it); }
    }
    saveLocal(remaining);
  }

  /* ---------- helpers ---------- */
  const stockOf = p => (p.stock === null || p.stock === undefined || p.stock === "" || !Number.isFinite(Number(p.stock))) ? null : Number(p.stock);
  const lineTotal = i => Number(i.product.price || 0) * Number(i.quantity || 1);
  const sellerOf = i => (i.product._seller && i.product._seller.name) || i.product.seller_name || (state.auth ? "JulaDirect member" : "Seller confirmed after sign-in");
  const unavailable = i => { const st = stockOf(i.product); return st !== null && st < 1; };
  const overStock = i => { const st = stockOf(i.product); return st !== null && st >= 1 && Number(i.quantity) > st; };

  function setSub(text) { sub.textContent = text || ""; }

  /* ---------- render ---------- */
  function itemHtml(i) {
    const p = i.product;
    const q = Number(i.quantity || 1);
    const st = stockOf(p);
    const img = JD.safeUrl(p.main_image) || JD.placeholder;
    const pid = JD.esc(String(i.product_id || p.id));
    const idx = i.__index !== undefined ? ' data-idx="' + i.__index + '"' : "";
    let stockLine;
    if (st === null) stockLine = '<span class="jd-badge">' + (state.auth ? "Availability not confirmed" : "Sign in to verify availability") + "</span>";
    else if (st < 1) stockLine = '<span class="jd-badge jd-badge--bad">Out of stock</span>';
    else if (q > st) stockLine = '<span class="jd-badge jd-badge--warn">Only ' + st + " available</span>";
    else stockLine = '<span class="jd-badge jd-badge--ok">' + JD.icon("check", 14) + st + " available</span>";
    const canInc = st === null ? q < 99 : q < st;
    return '<article class="jd-citem" data-id="' + pid + '" data-quantity="' + q + '"' + idx + ">" +
      '<a class="jd-citem__img" href="product.html?id=' + encodeURIComponent(i.product_id || p.id) + '"><img src="' + JD.esc(img) + '" alt="" loading="lazy"></a>' +
      "<div><a class=\"jd-citem__title\" href=\"product.html?id=" + encodeURIComponent(i.product_id || p.id) + '">' + JD.esc(p.title || "Product") + "</a>" +
      '<div style="margin-top:4px;font-weight:700">' + JD.esc(JD.money(p.price, p.currency)) + '</div><div style="margin-top:8px">' + stockLine + "</div>" +
      '<div class="jd-citem__meta"><div class="jd-qty" role="group" aria-label="Quantity for ' + JD.esc(p.title || "product") + '"><button type="button" data-step="-1" aria-label="Decrease quantity"' + (q <= 1 ? " disabled" : "") + ">" + JD.icon("minus", 16) + "</button><output>" + q + '</output><button type="button" data-step="1" aria-label="Increase quantity"' + (canInc ? "" : " disabled") + ">" + JD.icon("plus", 16) + '</button></div><button type="button" class="jd-linkbtn" data-remove>Remove</button></div></div>' +
      '<div class="jd-citem__total">' + JD.esc(JD.money(lineTotal(i), p.currency)) + "</div></article>";
  }

  function render() {
    const items = state.items;
    if (!items.length) {
      JD.paneClass("cart", "has-mobilebar", false);
      setSub("");
      root.innerHTML = JD.empty({
        icon: "cart", title: "Your cart is empty",
        text: "Find something you like and add it to your cart. Saved items from your wishlist are one tap away.",
        actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Browse the marketplace</a><a class="jd-btn jd-btn--secondary" href="wishlist.html">View wishlist</a>'
      });
      return;
    }
    const count = items.reduce((t, i) => t + Number(i.quantity || 1), 0);
    const subtotal = items.reduce((t, i) => t + lineTotal(i), 0);
    const blocked = items.some(unavailable) || items.some(overStock);
    setSub(state.auth ? count + (count === 1 ? " item" : " items") + " ready for checkout." : count + (count === 1 ? " item" : " items") + " saved on this device. Sign in to verify current prices and availability.");

    const groups = new Map();
    items.forEach(i => { const k = sellerOf(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    const groupsHtml = [...groups.entries()].map(([name, list]) =>
      '<section class="jd-cartgroup" aria-label="Items sold by ' + JD.esc(name) + '"><div class="jd-cartgroup__head">' + JD.icon("store", 18) + "Sold by " + JD.esc(name) + "</div>" + list.map(itemHtml).join("") + "</section>"
    ).join("");

    const wantsCheckout = JD.params().get("continue") === "checkout";
    const callout = wantsCheckout && !blocked
      ? '<div class="jd-callout"><strong>Your item is ready.</strong><button type="button" class="jd-btn jd-btn--primary jd-btn--sm" data-checkout>Continue to checkout</button></div>' : "";
    const warn = blocked ? '<div class="jd-callout jd-callout--warn" role="alert">' + JD.icon("help", 18) + "<span>Some items are out of stock or exceed what is available. Update or remove them to continue.</span></div>" : "";
    const ctaLabel = state.auth ? "Proceed to checkout" : "Sign in to check out";

    root.innerHTML = callout + warn + '<div class="jd-cart"><div>' + groupsHtml +
      '<button type="button" class="jd-linkbtn" data-clear style="margin-top:4px">Clear cart</button></div>' +
      '<aside class="jd-summary" aria-label="Order summary"><h2 style="font-size:1.15rem">Order summary</h2>' +
      '<div class="jd-summary__row"><span>Items (' + count + ")</span><span>" + JD.esc(JD.money(subtotal)) + "</span></div>" +
      '<p class="jd-muted" style="font-size:13.5px">Delivery or pickup, any coupon and your payment choice are confirmed at checkout.</p>' +
      '<div class="jd-summary__row jd-summary__row--total"><span>Subtotal</span><span>' + JD.esc(JD.money(subtotal)) + "</span></div>" +
      '<button type="button" class="jd-btn jd-btn--primary jd-btn--lg jd-btn--block" data-checkout' + (blocked ? " disabled" : "") + ">" + ctaLabel + "</button>" +
      '<a class="jd-link" href="explore.html" style="justify-content:center">Continue shopping</a></aside></div>' +
      '<div class="jd-mobilebar"><div><small class="jd-muted">Subtotal</small><br><strong>' + JD.esc(JD.money(subtotal)) + '</strong></div><button type="button" class="jd-btn jd-btn--primary" data-checkout' + (blocked ? " disabled" : "") + ">" + (state.auth ? "Checkout" : "Sign in") + "</button></div>";
    JD.paneClass("cart", "has-mobilebar", true);
    JD.syncCompare();
  }

  /* ---------- data ---------- */
  async function load() {
    try {
      const A = JD.auth();
      if (!A) throw new Error("The cart is unavailable right now.");
      await A.ready();
      const user = await A.getUser();
      state.auth = !!user;
      if (user) await migrateGuestCart();
      const r = user ? await A.getCart() : { items: localItems() };
      state.items = r.items || [];
      if (user) await JD.data.attachSellers(state.items.map(i => i.product).filter(Boolean));
      render();
    } catch (e) {
      console.warn("[JulaDirect] cart", e && e.message);
      setSub("");
      root.innerHTML = JD.empty({
        icon: "cart", title: "We could not load your cart",
        text: (e && e.message) || "Please check your connection and try again.",
        actions: '<button type="button" class="jd-btn jd-btn--secondary" id="jd-retry">Try again</button>'
      });
    }
  }

  async function updateQty(item, next) {
    const A = JD.auth();
    const st = stockOf(item.product);
    if (st !== null && next > st) { JD.toast("Only " + st + " available.", "error"); return; }
    next = Math.max(1, Math.min(next, 99));
    try {
      if (state.auth) {
        await A.updateCartItem(item.product_id || item.product.id, next);
      } else {
        const arr = localCart();
        if (arr[item.__index]) { arr[item.__index].quantity = next; saveLocal(arr); }
      }
      item.quantity = next;
      render();
      JD.refreshCartCount();
    } catch (e) {
      console.warn("[JulaDirect] cart qty", e && e.message);
      JD.toast("We could not update that quantity.", "error");
    }
  }
  let clearing = false;
  async function animateExit(rows, target) {
    try {
      const fx = JD.cartFx || window.JD && window.JD.cartFx;
      if (fx && typeof fx.exitItems === "function") {
        await fx.exitItems(rows, { target: target || null });
      }
    } catch (e) {
      console.warn("[JulaDirect] cart exit animation", e && e.message);
    }
  }
  async function removeItem(item, row, trigger) {
    if (!item || clearing || (row && row.dataset.removing === "true")) return;
    if (row) { row.dataset.removing = "true"; row.style.pointerEvents = "none"; }
    if (trigger) trigger.disabled = true;
    const A = JD.auth();
    try {
      if (state.auth) await A.removeCartItem(item.product_id || item.product.id);
      else { const arr = localCart(); arr.splice(item.__index, 1); saveLocal(arr); }
      await animateExit(row ? [row] : [], trigger);
      state.items = state.auth ? state.items.filter(i => i !== item) : localItems();
      render();
      JD.refreshCartCount();
      JD.toast("Removed from your cart", "ok");
    } catch (e) {
      if (row) { delete row.dataset.removing; row.style.pointerEvents = ""; }
      if (trigger && trigger.isConnected) trigger.disabled = false;
      console.warn("[JulaDirect] cart remove", e && e.message);
      JD.toast("We could not remove that item.", "error");
    }
  }
  async function clearAll() {
    if (clearing) return;
    clearing = true;
    const A = JD.auth();
    const rows = Array.from(root.querySelectorAll(".jd-citem"));
    const trigger = root.querySelector("[data-clear]");
    if (trigger) trigger.disabled = true;
    rows.forEach(row => { row.dataset.removing = "true"; row.style.pointerEvents = "none"; });
    try {
      if (state.auth) await A.clearCart(); else saveLocal([]);
      await animateExit(rows, trigger);
      state.items = [];
      render();
      JD.refreshCartCount();
      JD.toast("Cart cleared", "ok");
    } catch (e) {
      rows.forEach(row => { delete row.dataset.removing; row.style.pointerEvents = ""; });
      if (trigger && trigger.isConnected) trigger.disabled = false;
      console.warn("[JulaDirect] cart clear", e && e.message);
      JD.toast("We could not clear your cart.", "error");
    } finally {
      clearing = false;
    }
  }
  const findItem = el => {
    const row = el.closest(".jd-citem");
    if (!row) return null;
    const idx = row.getAttribute("data-idx");
    return idx !== null ? state.items.find(i => String(i.__index) === idx) : state.items.find(i => String(i.product_id || i.product.id) === row.getAttribute("data-id"));
  };

  document.addEventListener("click", e => {
    const step = e.target.closest("[data-step]");
    const rm = e.target.closest("[data-remove]");
    const clr = e.target.closest("[data-clear]");
    const co = e.target.closest("[data-checkout]");
    if (step) { const it = findItem(step); if (it) updateQty(it, Number(it.quantity || 1) + Number(step.getAttribute("data-step"))); }
    else if (rm) { const it = findItem(rm); if (it) removeItem(it, rm.closest(".jd-citem"), rm); }
    else if (clr) { const dlg = document.getElementById("jd-clear-dialog"); dlg.returnValue = ""; dlg.showModal(); }
    else if (co) { location.href = state.auth ? "checkout.html" : "login.html?redirect=" + encodeURIComponent("checkout.html"); }
    else if (e.target.closest("#jd-retry")) { load(); }
  });
  document.getElementById("jd-clear-dialog").addEventListener("close", e => { if (e.target.returnValue === "clear") clearAll(); });

  /* Opening the Cart tab again: refresh quietly, the page stays on screen. */
  window.addEventListener("jd:pane:show", e => { if (e.detail.route === "cart" && !e.detail.first) load(); });

  JD.mountShell({ active: "cart" });
  load();
})();
