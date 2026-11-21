/* JulaDirect v2 wishlist. Reads wishlist_items joined to live products.
   Saved items that no longer exist or are not approved are reported
   honestly and can be removed; no placeholder products are invented. */
(function () {
  "use strict";
  const JD = window.JD;
  const root = document.getElementById("jd-wl");
  const sub = document.getElementById("jd-sub");
  let rows = [];
  let userId = null;
  const live = r => r.product && r.product.status === "approved";

  function render() {
    const items = rows.filter(live);
    const gone = rows.filter(r => !live(r));
    if (!rows.length) {
      sub.textContent = "Products you have saved to come back to.";
      root.innerHTML = JD.empty({ icon: "heart", title: "Nothing saved yet", text: "Tap the heart on any product to save it here. We will tell you about price drops and restocks.", actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Browse the marketplace</a>' });
      return;
    }
    const inStock = items.filter(r => Number(r.product.stock || 0) > 0);
    sub.textContent = items.length + (items.length === 1 ? " saved product" : " saved products");
    root.innerHTML =
      '<div class="jd-toolbar"><div class="jd-toolbar__count">' + items.length + (items.length === 1 ? " product" : " products") + "</div>" +
      '<div class="jd-toolbar__right">' + (inStock.length ? '<button type="button" class="jd-btn jd-btn--primary jd-btn--sm" id="jd-add-all">' + JD.icon("cart", 16) + "Add all to cart (" + inStock.length + ")</button>" : "") + "</div></div>" +
      (gone.length ? '<div class="jd-callout jd-callout--warn" role="status"><span>' + JD.icon("help", 18) + " " + gone.length + (gone.length === 1 ? " saved item is" : " saved items are") + ' no longer available.</span><button type="button" class="jd-btn jd-btn--secondary jd-btn--sm" id="jd-clean">Remove unavailable</button></div>' : "") +
      (items.length ? '<div class="jd-grid" id="jd-wl-grid">' + items.map(r => JD.productCard(r.product)).join("") + "</div>" : JD.empty({ icon: "heart", title: "No available items", text: "The products you saved are no longer listed.", actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Browse the marketplace</a>' }));
    const grid = document.getElementById("jd-wl-grid");
    if (grid) { JD.syncWishlist(grid); JD.syncCompare(); }
  }

  async function load() {
    try {
      const A = JD.auth();
      await A.ready();
      const user = await A.getUser();
      if (!user) {
        sub.textContent = "";
        root.innerHTML = JD.empty({ icon: "heart", title: "Sign in to see your wishlist", text: "Your saved products follow you across devices once you are signed in.", actions: '<a class="jd-btn jd-btn--primary" href="' + JD.esc(JD.loginUrl()) + '">Log in</a><a class="jd-btn jd-btn--secondary" href="signup.html">Create account</a>' });
        return;
      }
      userId = user.id;
      const c = await JD.client();
      const { data, error } = await c.from("wishlist_items").select("id,product_id,created_at,product:products(*)").eq("user_id", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      rows = data || [];
      await JD.data.attachSellers(rows.filter(live).map(r => r.product));
      render();
    } catch (e) {
      console.warn("[JulaDirect] wishlist", e && e.message);
      sub.textContent = "";
      root.innerHTML = JD.empty({ icon: "heart", title: "We could not load your wishlist", text: (e && e.message) || "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="jd-retry">Try again</button>' });
    }
  }

  window.addEventListener("jd:wishlist", e => {
    if (e.detail && !e.detail.on) { rows = rows.filter(r => String(r.product_id) !== String(e.detail.id)); render(); }
  });

  document.addEventListener("click", async e => {
    if (e.target.closest("#jd-retry")) { load(); return; }
    const all = e.target.closest("#jd-add-all");
    if (all) {
      all.disabled = true;
      let ok = 0;
      for (const r of rows.filter(live).filter(r => Number(r.product.stock || 0) > 0)) {
        const res = await JD.auth().addToCart(r.product.id, 1).catch(() => null);
        if (res && res.success) ok++;
      }
      window.dispatchEvent(new CustomEvent("gambasket:cart:change"));
      JD.toast(ok ? ok + (ok === 1 ? " item" : " items") + " added to your cart" : "Nothing could be added to your cart.", ok ? "ok" : "error");
      all.disabled = false;
    }
    if (e.target.closest("#jd-clean")) {
      const ids = rows.filter(r => !live(r)).map(r => r.id);
      try {
        const c = await JD.client();
        const { error } = await c.from("wishlist_items").delete().in("id", ids).eq("user_id", userId);
        if (error) throw error;
        rows = rows.filter(live);
        render();
        JD.toast("Unavailable items removed", "ok");
      } catch (err) { JD.toast("We could not remove those items.", "error"); }
    }
  });

  window.addEventListener("jd:pane:show", e => { if (e.detail.route === "wishlist" && !e.detail.first) load(); });

  JD.mountShell({ active: "wishlist" });
  JD.accountNav("wishlist");
  JD.bindProductActions(document);
  load();
})();
