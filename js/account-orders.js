/* Orders (v2 design). Same data and actions as the previous page:
   - GamBasketAuth.getOrders() / cancelOrder(orderNumber)
   - edge functions gambasket-delivery-proof {action:"issue"}, gambasket-modempay-refunds
     {action:"request"} and gambasket-modempay-checkout, called with the same payloads
   - GamBasketTrust.submitReview (js/trust-engine.js) for verified reviews
   Browser prompt()/alert()/confirm() boxes are replaced by dialogs. Payment state,
   refund eligibility and cancellation rules stay server-side. */
(function () {
  "use strict";
  var JD = window.JD, $ = function (id) { return document.getElementById(id); }, esc = JD.esc;
  var LABEL = { pending: "Pending confirmation", confirmed: "Confirmed", processing: "Processing", ready_for_delivery: "Ready for delivery", delivery_assigned: "Courier assigned", picked_up: "Picked up", out_for_delivery: "Out for delivery", ready_for_pickup: "Ready for pickup", delivered: "Delivered", completed: "Completed", cancelled: "Cancelled" };
  var TONE = { pending: "jd-badge--warn", delivered: "jd-badge--ok", completed: "jd-badge--ok", cancelled: "jd-badge--bad" };
  var DONE = ["delivered", "completed"];
  var orders = [], thumbs = {}, filter = JD.params().get("filter") || "all";
  var refunded = {}, reviewed = {}, ctx = {}, rating = 0;

  function steps(o) {
    var pickup = o.fulfillment_type === "pickup";
    var names = pickup ? ["Placed", "Confirmed", "Preparing", "Ready", "Collected"] : ["Placed", "Confirmed", "Preparing", "On the way", "Delivered"];
    var idx = { pending: 0, confirmed: 1, processing: 2, ready_for_delivery: 2, delivery_assigned: 3, picked_up: 3, out_for_delivery: 3, ready_for_pickup: 3, delivered: 4, completed: 4 }[o.status];
    return { names: names, at: idx == null ? 0 : idx };
  }
  function isActive(o) { return DONE.indexOf(o.status) < 0 && o.status !== "cancelled"; }
  function matches(o) { return filter === "all" || (filter === "active" && isActive(o)) || (filter === "delivered" && DONE.indexOf(o.status) > -1) || (filter === "cancelled" && o.status === "cancelled"); }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  function payment(o) {
    var m = o.payment_method === "cod" || o.payment_method === "cash_on_delivery" ? "Cash on delivery" : "ModemPay \u00b7 " + String(o.payment_method || "online").toUpperCase();
    return m + " \u00b7 " + String(o.payment_status || "pending").replace(/_/g, " ");
  }

  function renderFilters() {
    var n = function (f) { var s = filter; filter = f; var c = orders.filter(matches).length; filter = s; return c; };
    var defs = [["all", "All"], ["active", "Active"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]];
    var box = $("od-filters"); box.hidden = !orders.length;
    box.innerHTML = defs.map(function (d) { return '<button type="button" role="tab" aria-selected="' + (filter === d[0]) + '" class="jd-chip' + (filter === d[0] ? " is-active" : "") + '" data-filter="' + d[0] + '">' + d[1] + " (" + n(d[0]) + ")</button>"; }).join("");
  }

  function card(o) {
    var st = steps(o), cancelled = o.status === "cancelled";
    var track = cancelled ? '<div class="od__cancelled">This order was cancelled.</div>' :
      '<div class="od__track" aria-label="Order progress">' + st.names.map(function (nm, i) { return '<div class="od__step' + (i <= st.at ? " is-done" : "") + (i === st.at ? " is-now" : "") + '"><i></i>' + esc(nm) + "</div>"; }).join("") + "</div>";
    var items = (o.items || []).map(function (it) {
      var img = thumbs[it.id] || JD.placeholder;
      var rate = DONE.indexOf(o.status) > -1 && it.id && !reviewed[o.order_id + ":" + it.id] ? '<button type="button" class="jd-btn jd-btn--soft jd-btn--sm" data-act="review" data-order="' + esc(o.order_id) + '" data-product="' + esc(it.id) + '" data-name="' + esc(it.name) + '">Rate</button>' : "";
      return '<div class="od__item"><a href="product.html?id=' + encodeURIComponent(it.id || "") + '"><img src="' + esc(img) + '" alt="" loading="lazy"></a><div class="od__item__t"><b>' + esc(it.name) + "</b><small>Qty " + esc(it.quantity) + " &middot; " + esc(JD.money(it.price)) + " each</small></div><span class=\"od__item__p\">" + esc(JD.money(Number(it.price) * Number(it.quantity))) + "</span>" + rate + "</div>";
    }).join("");
    var acts = [];
    if (o.status === "out_for_delivery") acts.push('<button type="button" class="jd-btn jd-btn--primary jd-btn--sm" data-act="code" data-order="' + esc(o.order_id) + '">Get handoff code</button>');
    if (["pending", "failed"].indexOf(o.payment_status) > -1 && ["wave", "qmoney", "afrimoney"].indexOf(o.payment_method) > -1 && !cancelled) acts.push('<button type="button" class="jd-btn jd-btn--primary jd-btn--sm" data-act="pay" data-order="' + esc(o.order_id) + '" data-method="' + esc(o.payment_method) + '">Continue secure payment</button>');
    if (o.payment_status === "paid" && !cancelled && !refunded[o.order_id]) acts.push('<button type="button" class="jd-btn jd-btn--secondary jd-btn--sm" data-act="refund" data-order="' + esc(o.order_id) + '" data-total="' + esc(Number(o.total_amount || 0)) + '">Request a refund</button>');
    if (o.status === "pending") acts.push('<button type="button" class="jd-btn jd-btn--ghost jd-btn--sm" data-act="cancel" data-number="' + esc(o.id) + '">Cancel order</button>');
    return '<article class="ac-card od" data-order="' + esc(o.order_id) + '"><div class="od__head"><div><span class="od__no">Order #' + esc(o.id) + '</span><span class="od__date">' + esc(when(o.created_at)) + '</span></div><span class="jd-badge ' + (TONE[o.status] || "") + '">' + esc(LABEL[o.status] || "Pending confirmation") + "</span></div>" + track +
      '<div class="od__items">' + (items || '<p class="ac-empty" style="padding-left:0">No items recorded.</p>') + "</div>" +
      '<div class="od__meta"><div>' + JD.icon("pin", 16) + "<span><b>" + (o.fulfillment_type === "pickup" ? "Pickup at" : "Delivery to") + ":</b> " + esc(o.area || "Greater Banjul") + (o.address ? " (" + esc(o.address) + ")" : "") + "</span></div><div>" + JD.icon("wallet", 16) + "<span><b>Payment:</b> " + esc(payment(o)) + "</span></div></div>" +
      '<div class="od__foot"><div class="od__total"><small>Total</small><b>' + esc(JD.money(o.total_amount || 0)) + '</b></div><div class="od__act">' + acts.join("") + "</div></div></article>";
  }

  function render() {
    renderFilters();
    var list = orders.filter(matches);
    $("od-list").innerHTML = list.length ? list.map(card).join("") : (orders.length ? JD.empty({ icon: "package", title: "No orders here", text: "No orders match this filter.", actions: '<button type="button" class="jd-btn jd-btn--secondary" data-filter="all">Show all orders</button>' }) : "");
  }

  async function load() {
    $("od-state").innerHTML = '<div class="jd-skel" style="height:220px;border-radius:24px"></div>';
    $("od-list").innerHTML = "";
    try {
      var A = JD.auth(); if (!A) throw new Error("Orders are unavailable right now.");
      await A.ready();
      var session = await A.getSession();
      if (!session || !session.user) {
        $("od-filters").hidden = true;
        $("od-state").innerHTML = JD.empty({ icon: "package", title: "Sign in to view your orders", text: "Log in to track active deliveries and see your JulaDirect order history.", actions: '<a class="jd-btn jd-btn--primary" href="login.html?redirect=orders.html">Log in</a><a class="jd-btn jd-btn--secondary" href="signup.html?redirect=orders.html">Create account</a>' });
        return;
      }
      var res = await A.getOrders();
      if (res.error) throw res.error;
      orders = res.data || [];
      if (!orders.length) {
        $("od-filters").hidden = true;
        $("od-state").innerHTML = JD.empty({ icon: "package", title: "No orders yet", text: "Your orders and live delivery tracking will appear here once you place an order.", actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Start shopping</a>' });
        return;
      }
      $("od-state").innerHTML = "";
      var ids = Array.from(new Set([].concat.apply([], orders.map(function (o) { return (o.items || []).map(function (i) { return i.id; }); })).filter(JD.isUuid)));
      if (ids.length) { try { var c = await JD.client(); var pr = await c.from("products").select("id,main_image").in("id", ids); (pr.data || []).forEach(function (p) { var u = JD.safeUrl(p.main_image); if (u) thumbs[p.id] = u; }); } catch (e) { /* thumbnails are optional */ } }
      render();
    } catch (e) {
      console.warn("[JulaDirect] orders", e && e.message);
      $("od-filters").hidden = true;
      $("od-state").innerHTML = JD.empty({ icon: "package", title: "We could not load your orders", text: "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="od-retry">Try again</button>' });
    }
  }

  function fn(name, body) {
    return JD.client().then(function (c) { return c.functions.invoke(name, { body: body }); });
  }
  function msg(res, fallback) { return (res && res.data && res.data.error) || (res && res.error && res.error.message) || fallback; }

  async function openCode(orderId, btn) {
    btn.disabled = true;
    $("od-code-v").innerHTML = "&middot;&middot;&middot;&middot;&middot;&middot;"; $("od-code-x").textContent = "Creating your code\u2026";
    $("od-code").showModal();
    try {
      var r = await fn("gambasket-delivery-proof", { action: "issue", order_id: orderId });
      if (r.error || !r.data || !r.data.code) throw new Error(msg(r, "Could not create the delivery code."));
      $("od-code-v").textContent = r.data.code;
      var t = new Date(r.data.expires_at);
      $("od-code-x").textContent = isNaN(t) ? "" : "Expires at " + t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + ".";
    } catch (e) { $("od-code").close(); JD.toast(e.message || "Unable to generate a delivery code.", "error"); }
    btn.disabled = false;
  }
  async function pay(btn) {
    btn.disabled = true; var old = btn.textContent; btn.textContent = "Opening ModemPay\u2026";
    try {
      var key = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random();
      var r = await fn("gambasket-modempay-checkout", { order_id: btn.getAttribute("data-order"), payment_method: btn.getAttribute("data-method"), idempotency_key: key });
      if (r.error || !r.data || !r.data.payment_url) throw new Error(msg(r, "Unable to reopen secure checkout."));
      window.location.assign(r.data.payment_url);
    } catch (e) { btn.disabled = false; btn.textContent = old; JD.toast(e.message || "Unable to open ModemPay checkout.", "error"); }
  }

  document.addEventListener("click", function (e) {
    var f = e.target.closest("[data-filter]");
    if (f) { filter = f.getAttribute("data-filter"); history.replaceState(null, "", filter === "all" ? "orders.html" : "orders.html?filter=" + filter); render(); return; }
    if (e.target.closest("#od-retry")) { load(); return; }
    var b = e.target.closest("[data-act]"); if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "cancel") { ctx.number = b.getAttribute("data-number"); $("od-cancel-x").textContent = "Order #" + ctx.number + " will be cancelled. This cannot be undone."; $("od-cancel").showModal(); }
    else if (act === "code") openCode(b.getAttribute("data-order"), b);
    else if (act === "pay") pay(b);
    else if (act === "refund") {
      ctx.order = b.getAttribute("data-order"); var total = Number(b.getAttribute("data-total") || 0); ctx.total = total;
      $("od-refund-x").textContent = "You can request up to " + JD.money(total) + ". A JulaDirect reviewer checks every request.";
      $("od-refund-amt").max = String(total); $("od-refund-amt").value = String(total); $("od-refund-why").value = ""; $("od-refund-n").textContent = "0 / 80"; $("od-refund-s").textContent = ""; $("od-refund").showModal();
    } else if (act === "review") {
      ctx.rOrder = b.getAttribute("data-order"); ctx.rProduct = b.getAttribute("data-product"); rating = 0; paintStars();
      $("od-review-x").textContent = b.getAttribute("data-name"); $("od-review-title").value = ""; $("od-review-body").value = ""; $("od-review-s").textContent = ""; $("od-review").showModal();
    }
  });

  $("od-cancel-no").addEventListener("click", function () { $("od-cancel").close(); });
  $("od-cancel-yes").addEventListener("click", async function () {
    var btn = this; btn.disabled = true;
    var r = await JD.auth().cancelOrder(ctx.number);
    btn.disabled = false; $("od-cancel").close();
    if (r && r.success) { JD.toast("Order cancelled", "ok"); load(); } else JD.toast("We could not cancel that order. It may already be confirmed.", "error");
  });
  $("od-code-close").addEventListener("click", function () { $("od-code").close(); });

  $("od-refund-why").addEventListener("input", function () { $("od-refund-n").textContent = this.value.length + " / 80"; });
  $("od-refund-cancel").addEventListener("click", function () { $("od-refund").close(); });
  $("od-refund-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var amount = Number($("od-refund-amt").value), reason = $("od-refund-why").value.trim(), s = $("od-refund-s");
    if (!isFinite(amount) || amount <= 0 || amount > ctx.total) { s.textContent = "Enter an amount between 1 and " + ctx.total.toLocaleString("en-GB") + "."; s.classList.add("is-error"); return; }
    if (reason.length < 3 || reason.length > 80) { s.textContent = "Please give a reason of 3 to 80 characters."; s.classList.add("is-error"); return; }
    s.classList.remove("is-error"); s.textContent = "Submitting\u2026"; $("od-refund-go").disabled = true;
    try {
      var r = await fn("gambasket-modempay-refunds", { action: "request", order_id: ctx.order, amount: amount, reason: reason });
      if (r.error || !r.data || !r.data.refund_case_id) throw new Error(msg(r, "Refund request failed."));
      refunded[ctx.order] = true; $("od-refund").close(); JD.toast("Refund request submitted for review", "ok"); render();
    } catch (e) { s.classList.add("is-error"); s.textContent = e.message || "Unable to submit refund request."; }
    $("od-refund-go").disabled = false;
  });

  function paintStars() {
    $("od-stars").innerHTML = [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" role="radio" aria-checked="' + (rating === n) + '" aria-label="' + n + ' star' + (n > 1 ? "s" : "") + '" data-star="' + n + '" class="' + (n <= rating ? "is-on" : "") + '">' + JD.icon("star", 32) + "</button>"; }).join("");
  }
  $("od-stars").addEventListener("click", function (e) { var b = e.target.closest("[data-star]"); if (b) { rating = Number(b.getAttribute("data-star")); paintStars(); } });
  $("od-review-cancel").addEventListener("click", function () { $("od-review").close(); });
  $("od-review-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var s = $("od-review-s");
    if (rating < 1) { s.classList.add("is-error"); s.textContent = "Choose a star rating."; return; }
    if (!window.GamBasketTrust || !window.GamBasketTrust.submitReview) { s.classList.add("is-error"); s.textContent = "Reviews are unavailable right now."; return; }
    s.classList.remove("is-error"); s.textContent = "Submitting\u2026"; $("od-review-go").disabled = true;
    try {
      await window.GamBasketTrust.submitReview({ orderId: ctx.rOrder, productId: ctx.rProduct, rating: rating, title: $("od-review-title").value.trim() || null, body: $("od-review-body").value.trim() || null });
      reviewed[ctx.rOrder + ":" + ctx.rProduct] = true; $("od-review").close(); JD.toast("Thanks for sharing verified feedback", "ok"); render();
    } catch (e) { s.classList.add("is-error"); s.textContent = (e && e.message) || "Unable to submit review."; }
    $("od-review-go").disabled = false;
  });

  window.addEventListener("gambasket:orders:change", load);
  window.addEventListener("gambasket:auth:change", load);
  JD.mountShell({ active: "account" });
  JD.accountNav("orders");
  load();
})();
