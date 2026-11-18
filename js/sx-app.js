/* =========================================================
   Seller Studio: application.
   One page, hash routes (#/overview, #/orders, ...). Views render once per visit from the
   data layer (js/sx-data.js); nothing here is invented: with no data a view says so.
   All user-supplied text is escaped; image URLs must be http(s).
   ========================================================= */
(function () {
  "use strict";
  const SX = window.SX;
  const D = SX.data;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => Number(v || 0);
  const fmt = n => num(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  const money = n => "D " + fmt(n);
  const label = s => String(s || "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  const safeUrl = u => { try { const x = new URL(String(u || ""), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };
  const day = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const dayTime = d => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function ago(d) {
    const s = (Date.now() - +new Date(d)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 7) return Math.floor(s / 86400) + "d ago";
    return day(d);
  }
  const stars = n => '<span class="sx-stars" aria-label="' + n + ' out of 5">' + "★".repeat(Math.round(n)) + "<i>" + "★".repeat(5 - Math.round(n)) + "</i></span>";

  const ROUTES = { overview: "Overview", orders: "Orders", products: "Products", customers: "Customers", reviews: "Reviews", earnings: "Earnings", more: "More" };
  const state = { days: 30, route: "", store: null, summary: null, orderFilter: "all", orderQ: "", prodFilter: "all", prodQ: "", edits: new Map(), selected: new Set(), revFilter: "all", custQ: "" };

  /* ---------- small UI helpers ---------- */
  function toast(msg, tone) {
    const el = document.createElement("div");
    el.className = "sx-toast" + (tone ? " sx-toast--" + tone : "");
    el.textContent = msg;
    $("#sxToasts").appendChild(el);
    setTimeout(() => el.remove(), tone === "bad" ? 6000 : 3200);
  }
  const errMsg = e => (e && (e.message || e.error_description)) || "Something went wrong";

  function thumb(url, text) {
    const u = safeUrl(url);
    return '<div class="sx-thumb" ' + (u ? 'data-bg="' + esc(u) + '"' : "") + ">" + (u ? "" : esc((text || "?").trim().charAt(0).toUpperCase())) + "</div>";
  }
  function hydrate(root) {
    $$("[data-bg]", root).forEach(el => { el.style.backgroundImage = 'url("' + el.getAttribute("data-bg").replace(/"/g, "%22") + '")'; el.removeAttribute("data-bg"); });
  }
  const skel = n => '<div class="sx-grid">' + Array.from({ length: n }, () => '<div class="sx-skel" style="height:96px"></div>').join("") + "</div>";
  const empty = (t, p, a) => '<div class="sx-empty"><h3>' + esc(t) + "</h3><p>" + esc(p) + "</p>" + (a || "") + "</div>";

  function ask(o) {
    return new Promise(resolve => {
      const dlg = document.createElement("dialog");
      dlg.className = "sx-dialog";
      dlg.innerHTML = '<form method="dialog"><h2>' + esc(o.title) + "</h2>" + (o.body ? '<p style="color:var(--sx-ink-2)">' + esc(o.body) + "</p>" : "") +
        (o.fields || []).map(f => '<label class="sx-field">' + esc(f.label) + (f.type === "textarea"
          ? '<textarea class="sx-textarea" name="' + f.name + '" maxlength="' + (f.max || 800) + '" ' + (f.required ? "required" : "") + ">" + esc(f.value || "") + "</textarea>"
          : '<input class="sx-input" name="' + f.name + '" type="' + (f.type || "text") + '" value="' + esc(f.value == null ? "" : f.value) + '" ' + (f.min != null ? 'min="' + f.min + '"' : "") + ' step="' + (f.step || "any") + '" ' + (f.required ? "required" : "") + ">") + "</label>").join("") +
        '<menu><button class="sx-btn" value="cancel" formnovalidate>' + esc(o.cancel || "Cancel") + '</button><button class="sx-btn ' + (o.danger ? "sx-btn--danger" : "sx-btn--primary") + '" value="ok">' + esc(o.confirm || "Confirm") + "</button></menu></form>";
      document.body.appendChild(dlg);
      dlg.addEventListener("close", () => {
        const ok = dlg.returnValue === "ok";
        const vals = {};
        $$("[name]", dlg).forEach(i => { vals[i.name] = i.value; });
        dlg.remove();
        resolve(ok ? (o.fields && o.fields.length ? vals : true) : null);
      });
      dlg.showModal();
      const first = $("[name]", dlg); if (first) first.focus();
    });
  }

  /* ---------- drawer ---------- */
  let drawerOpener = null;
  function openDrawer(title, bodyHtml, footHtml) {
    drawerOpener = document.activeElement;
    $("#sxDrawerTitle").textContent = title;
    $("#sxDrawerBody").innerHTML = bodyHtml;
    $("#sxDrawerFoot").innerHTML = footHtml || "";
    $("#sxDrawerFoot").style.display = footHtml ? "" : "none";
    $("#sxDrawer").classList.add("is-on"); $("#sxScrim").classList.add("is-on");
    $("#sxDrawer").setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    hydrate($("#sxDrawer"));
    $("#sxDrawerClose").focus();
  }
  function closeDrawer() {
    $("#sxDrawer").classList.remove("is-on"); $("#sxScrim").classList.remove("is-on");
    $("#sxDrawer").setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (drawerOpener && drawerOpener.focus) { try { drawerOpener.focus(); } catch (e) { /* gone */ } }
  }

  /* ---------- order status vocabulary ---------- */
  const TONE = { pending: "warn", confirmed: "info", processing: "info", ready_for_delivery: "info", delivery_assigned: "info", picked_up: "info", out_for_delivery: "info", ready_for_pickup: "info", delivered: "good", completed: "good", cancelled: "bad" };
  const pill = s => '<span class="sx-pill sx-pill--' + (TONE[s] || "") + '">' + esc(label(s)) + "</span>";
  const GROUPS = {
    all: () => true,
    new: o => o.order_status === "pending",
    active: o => ["confirmed", "processing", "ready_for_delivery", "ready_for_pickup", "delivery_assigned", "picked_up", "out_for_delivery"].includes(o.order_status),
    done: o => ["delivered", "completed"].includes(o.order_status),
    cancelled: o => o.order_status === "cancelled"
  };
  const GROUP_LABEL = { all: "All", new: "New", active: "In progress", done: "Completed", cancelled: "Cancelled" };
  /* Mirrors public.seller_update_order_status; the database still enforces it. */
  function actionsFor(o) {
    const s = o.order_status, delivery = o.fulfillment_type === "delivery";
    const cancel = { to: "cancelled", text: "Cancel order", danger: true };
    if (s === "pending") return [{ to: "confirmed", text: "Confirm order", primary: true }, cancel];
    if (s === "confirmed") return [{ to: "processing", text: "Start preparing", primary: true }, cancel];
    if (s === "processing") return [{ to: delivery ? "ready_for_delivery" : "ready_for_pickup", text: delivery ? "Ready for courier" : "Ready for pickup", primary: true }, cancel];
    if (s === "ready_for_delivery") return [cancel];
    if (s === "ready_for_pickup") return [{ to: "completed", text: "Handed to customer", primary: true }, cancel];
    return [];
  }

  /* ---------- badges ---------- */
  function paintBadges() {
    const s = state.summary; if (!s) return;
    const set = (id, n) => { const el = $(id); if (!el) return; el.hidden = !n; el.textContent = n > 99 ? "99+" : n; };
    set("#sxBadgeOrders", num(s.pending_orders)); set("#sxTabBadge", num(s.pending_orders));
    set("#sxBadgeProducts", num(s.low_stock) + num(s.out_of_stock));
    set("#sxBadgeReviews", num(s.unanswered_reviews));
  }
  async function loadSummary() {
    try { state.summary = await D.summary(state.days); paintBadges(); } catch (e) { console.warn("[Seller Studio] summary:", e); state.summary = null; }
    return state.summary;
  }

  /* =======================================================
     OVERVIEW
     ======================================================= */
  const delta = (cur, prev) => {
    cur = num(cur); prev = num(prev);
    if (!prev && !cur) return '<span class="sx-delta sx-delta--flat">no change</span>';
    if (!prev) return '<span class="sx-delta sx-delta--up">new</span>';
    const p = Math.round((cur - prev) / prev * 100);
    return '<span class="sx-delta sx-delta--' + (p > 0 ? "up" : p < 0 ? "down" : "flat") + '">' + (p > 0 ? "+" : "") + p + "%</span>";
  };

  async function viewOverview(el) {
    el.innerHTML = skel(4);
    const [s, series, top, orders] = await Promise.all([loadSummary(), D.series(state.days), D.topProducts(state.days, 5), D.orders()]);
    if (!s) { el.innerHTML = empty("Couldn't load your numbers", "Check your connection and try again.", '<p><button class="sx-btn" data-act="reload">Retry</button></p>'); return; }
    const goalPct = num(s.goal_revenue) > 0 ? Math.min(100, Math.round(num(s.month_revenue) / num(s.goal_revenue) * 100)) : null;
    const hello = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
    const headline = num(s.pending_orders) ? num(s.pending_orders) + (num(s.pending_orders) === 1 ? " order is" : " orders are") + " waiting for you to confirm."
      : num(s.in_progress_orders) ? num(s.in_progress_orders) + " " + (num(s.in_progress_orders) === 1 ? "order is" : "orders are") + " on their way to customers."
      : "You're all caught up. New orders will appear here.";
    const todo = [];
    if (num(s.overdue_orders)) todo.push(["bad", num(s.overdue_orders) + " pending " + (num(s.overdue_orders) === 1 ? "order has" : "orders have") + " waited over 24 hours", "#/orders", "Confirm now"]);
    else if (num(s.pending_orders)) todo.push(["warn", num(s.pending_orders) + " new " + (num(s.pending_orders) === 1 ? "order" : "orders") + " to confirm", "#/orders", "Open orders"]);
    if (num(s.out_of_stock)) todo.push(["bad", num(s.out_of_stock) + " live " + (num(s.out_of_stock) === 1 ? "product is" : "products are") + " out of stock", "#/products", "Restock"]);
    if (num(s.low_stock)) todo.push(["warn", num(s.low_stock) + " running low (3 or fewer left)", "#/products", "Review"]);
    if (num(s.unanswered_reviews)) todo.push(["", num(s.unanswered_reviews) + " customer " + (num(s.unanswered_reviews) === 1 ? "review has" : "reviews have") + " no reply", "#/reviews", "Reply"]);
    if (num(s.in_review)) todo.push(["", num(s.in_review) + " " + (num(s.in_review) === 1 ? "listing is" : "listings are") + " waiting for review", "#/products", "View"]);
    if (num(s.rejected)) todo.push(["bad", num(s.rejected) + " " + (num(s.rejected) === 1 ? "listing was" : "listings were") + " rejected", "#/products", "Fix"]);

    el.innerHTML =
      '<section class="sx-hero"><div><h2>' + hello + (state.store ? ", " + esc(state.store.name) : "") + '</h2><p>' + esc(headline) + '</p><div class="sx-chips" style="margin-top:16px"><a class="sx-btn sx-btn--sm" href="#/orders">Review orders</a><button class="sx-btn sx-btn--sm" data-act="goal" type="button">' + (goalPct == null ? "Set a monthly goal" : "Edit goal") + "</button></div></div>" +
      (goalPct == null ? "" : '<div class="sx-ring" style="--p:' + goalPct + '" role="img" aria-label="' + goalPct + '% of monthly goal"><span class="sx-num">' + goalPct + "%<small>of " + esc(money(s.goal_revenue)) + "</small></span></div>") + "</section>" +
      '<div class="sx-grid sx-grid--kpi" style="margin-bottom:18px">' +
      kpi("Revenue", money(s.revenue), delta(s.revenue, s.prev_revenue) + " vs previous " + state.days + " days") +
      kpi("Orders", String(num(s.orders)), delta(s.orders, s.prev_orders) + (num(s.cancelled) ? " " + num(s.cancelled) + " cancelled" : "")) +
      kpi("Average order", money(s.avg_order), num(s.buyers) + (num(s.buyers) === 1 ? " customer" : " customers")) +
      kpi("Est. marketplace fee", money(s.est_fees), esc(num(s.fee_rate)) + "% of merchandise value") + "</div>" +
      '<div class="sx-grid sx-grid--split" style="margin-bottom:18px"><section class="sx-card"><div class="sx-card__head"><h2>Sales</h2><span class="sx-num" style="color:var(--sx-ink-3);font-size:13px">Last ' + state.days + ' days</span></div><div class="sx-card__body"><div class="sx-chart" id="sxChart"></div></div></section>' +
      '<section class="sx-card"><div class="sx-card__head"><h2>Needs your attention</h2></div><div class="sx-card__body">' +
      (todo.length ? '<div class="sx-todo">' + todo.map(t => '<a href="' + t[2] + '"><i class="dot ' + t[0] + '"></i><span>' + esc(t[1]) + "</span><b>" + esc(t[3]) + " →</b></a>").join("") + "</div>" : '<div class="sx-empty" style="padding:24px 0"><h3>Nothing urgent</h3><p>Orders, stock and reviews are all in good shape.</p></div>') + "</div></section></div>" +
      '<div class="sx-grid sx-grid--even"><section class="sx-card"><div class="sx-card__head"><h2>Best sellers</h2><a href="#/products">All products</a></div><div class="sx-card__body">' +
      (top.length ? '<div class="sx-rows">' + top.map(t => '<div class="sx-row">' + thumb(t.image, t.title) + '<div style="min-width:0"><div class="sx-row__t">' + esc(t.title) + '</div><div class="sx-row__s">' + num(t.units) + " sold" + (t.stock != null ? " · " + num(t.stock) + " in stock" : "") + '</div></div><div class="sx-row__r sx-num">' + esc(money(t.revenue)) + "</div></div>").join("") + "</div>" : empty("No sales yet", "Your best sellers will show up here once orders come in.")) + "</div></section>" +
      '<section class="sx-card"><div class="sx-card__head"><h2>Recent orders</h2><a href="#/orders">All orders</a></div><div class="sx-card__body">' +
      (orders.length ? '<div class="sx-rows">' + orders.slice(0, 6).map(o => '<div class="sx-row" style="grid-template-columns:minmax(0,1fr) auto;cursor:pointer" data-open-order="' + esc(o.id) + '"><div style="min-width:0"><div class="sx-row__t">#' + esc(o.order_number) + " · " + esc(D.buyer(o.buyer_id).name) + '</div><div class="sx-row__s">' + esc(ago(o.created_at)) + " · " + (o.order_items || []).reduce((t, i) => t + num(i.quantity), 0) + ' item(s)</div></div><div style="text-align:right">' + pill(o.order_status) + '<div class="sx-row__s sx-num" style="margin-top:3px">' + esc(money(o.total)) + "</div></div></div>").join("") + "</div>" : empty("No orders yet", "When a customer orders from you, it appears here.")) + "</div></section></div>";
    drawChart($("#sxChart"), series);
    hydrate(el);
  }
  const kpi = (l, v, m) => '<section class="sx-card sx-kpi"><div class="sx-kpi__label">' + esc(l) + '</div><div class="sx-kpi__value sx-num">' + esc(v) + '</div><div class="sx-kpi__meta">' + m + "</div></section>";

  function drawChart(host, series) {
    if (!host) return;
    const W = Math.max(280, host.clientWidth || 640), H = 240, pl = 8, pr = 8, pt = 14, pb = 26;
    const max = Math.max(1, ...series.map(p => p.revenue));
    const n = series.length, step = (W - pl - pr) / n, bw = Math.max(2, Math.min(28, step * .68));
    const y = v => pt + (H - pt - pb) * (1 - v / max);
    const total = series.reduce((t, p) => t + p.revenue, 0);
    if (!total) { host.innerHTML = empty("No sales in this period", "Sales will chart here as orders are confirmed."); return; }
    const useLine = n > 35;
    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Daily sales for the last ' + n + ' days"><defs><linearGradient id="sxArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sx-brand)" stop-opacity=".28"/><stop offset="1" stop-color="var(--sx-brand)" stop-opacity="0"/></linearGradient></defs>';
    [0, .5, 1].forEach(f => { const yy = pt + (H - pt - pb) * (1 - f); svg += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '"/>' + (f ? '<text x="' + pl + '" y="' + (yy - 4) + '">' + esc(fmt(Math.round(max * f))) + "</text>" : ""); });
    if (useLine) {
      const pts = series.map((p, i) => [pl + step * i + step / 2, y(p.revenue)]);
      svg += '<path class="area" d="M' + pts.map(p => p.join(",")).join("L") + "L" + pts[n - 1][0] + "," + (H - pb) + "L" + pts[0][0] + "," + (H - pb) + 'Z"/><path class="line" d="M' + pts.map(p => p.join(",")).join("L") + '"/>';
    } else {
      series.forEach((p, i) => { const x = pl + step * i + (step - bw) / 2, h = Math.max(p.revenue ? 3 : 0, (H - pt - pb) * p.revenue / max); svg += '<rect class="bar" data-i="' + i + '" x="' + x + '" y="' + (H - pb - h) + '" width="' + bw + '" height="' + h + '" rx="4"/>'; });
    }
    const every = Math.ceil(n / Math.max(2, Math.floor(W / 80)));
    series.forEach((p, i) => { if (i % every === 0 || i === n - 1) svg += '<text x="' + (pl + step * i + step / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(day(p.day)) + "</text>"; });
    svg += series.map((p, i) => '<rect data-hit="' + i + '" x="' + (pl + step * i) + '" y="0" width="' + step + '" height="' + (H - pb) + '" fill="transparent"/>').join("") + '</svg><div class="sx-tip" id="sxTip"></div>';
    host.innerHTML = svg;
    const tip = $("#sxTip", host);
    $$("[data-hit]", host).forEach(r => {
      const i = +r.getAttribute("data-hit"), p = series[i];
      const on = () => { $$(".bar", host).forEach(b => b.classList.toggle("is-hot", +b.getAttribute("data-i") === i)); tip.innerHTML = esc(money(p.revenue)) + "<small>" + esc(day(p.day)) + " · " + p.orders + (p.orders === 1 ? " order" : " orders") + "</small>"; tip.style.left = (pl + step * i + step / 2) + "px"; tip.style.top = Math.max(26, y(p.revenue)) + "px"; tip.classList.add("is-on"); };
      r.addEventListener("pointerenter", on); r.addEventListener("pointerdown", on);
      r.addEventListener("pointerleave", () => { tip.classList.remove("is-on"); $$(".bar", host).forEach(b => b.classList.remove("is-hot")); });
    });
  }

  /* =======================================================
     ORDERS
     ======================================================= */
  async function viewOrders(el) {
    el.innerHTML = skel(3);
    const orders = await D.orders(true);
    const counts = {}; Object.keys(GROUPS).forEach(k => { counts[k] = orders.filter(GROUPS[k]).length; });
    const q = state.orderQ.trim().toLowerCase();
    const rows = orders.filter(GROUPS[state.orderFilter]).filter(o => !q || String(o.order_number).toLowerCase().includes(q) || D.buyer(o.buyer_id).name.toLowerCase().includes(q) || (o.order_items || []).some(i => String(i.title).toLowerCase().includes(q)));
    el.innerHTML = '<div class="sx-toolbar"><div class="sx-chips">' + Object.keys(GROUPS).map(k => '<button class="sx-chip" type="button" data-ofilter="' + k + '" aria-pressed="' + (state.orderFilter === k) + '">' + GROUP_LABEL[k] + " <b>" + counts[k] + "</b></button>").join("") + '</div><div class="sx-toolbar__space"></div><input class="sx-input" id="sxOrderQ" type="search" placeholder="Search order, customer or item" value="' + esc(state.orderQ) + '" aria-label="Search orders"></div>' +
      '<section class="sx-card"><div class="sx-table-wrap">' + (rows.length ? '<table class="sx-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Fulfilment</th><th class="r">Total</th><th>Status</th><th>Placed</th></tr></thead><tbody>' +
        rows.map(o => { const items = o.order_items || []; return '<tr class="is-click" tabindex="0" data-open-order="' + esc(o.id) + '"><td><b class="sx-num">#' + esc(o.order_number) + "</b></td><td>" + esc(D.buyer(o.buyer_id).name) + "</td><td>" + esc(items.length ? items[0].title + (items.length > 1 ? " +" + (items.length - 1) : "") : "—") + "</td><td>" + esc(label(o.fulfillment_type)) + '</td><td class="r sx-num"><b>' + esc(money(o.total)) + "</b></td><td>" + pill(o.order_status) + '</td><td class="sx-num" style="color:var(--sx-ink-3)">' + esc(ago(o.created_at)) + "</td></tr>"; }).join("") + "</tbody></table>"
        : empty(orders.length ? "No orders match" : "No orders yet", orders.length ? "Try another filter or search." : "Share your store link to get your first order.")) + "</div></section>";
    const search = $("#sxOrderQ");
    search.addEventListener("input", () => { state.orderQ = search.value; clearTimeout(search._t); search._t = setTimeout(() => { const c = search.selectionStart; viewOrders(el).then(() => { const s2 = $("#sxOrderQ"); s2.focus(); s2.setSelectionRange(c, c); }); }, 220); });
  }

  async function openOrder(id) {
    const o = (await D.orders()).find(x => x.id === id);
    if (!o) return;
    const buyer = D.buyer(o.buyer_id);
    openDrawer("Order #" + o.order_number, '<div class="sx-skel" style="height:140px"></div>', "");
    const extra = await D.orderDetail(id).catch(() => ({ history: [], note: "" }));
    const items = o.order_items || [];
    const acts = actionsFor(o);
    const body =
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + pill(o.order_status) + '<span class="sx-pill">' + esc(label(o.payment_method || "cash_on_delivery")) + '</span><span class="sx-pill sx-pill--' + (o.payment_status === "paid" ? "good" : "warn") + '">' + esc(label(o.payment_status)) + "</span></div>" +
      '<div class="sx-sec"><h3>Customer</h3><dl class="sx-kv"><dt>Name</dt><dd>' + esc(buyer.name) + "</dd><dt>Phone</dt><dd>" + (o.delivery_phone ? '<a href="tel:' + esc(o.delivery_phone) + '" style="color:var(--sx-brand)">' + esc(o.delivery_phone) + "</a>" : "—") + "</dd><dt>" + (o.fulfillment_type === "delivery" ? "Deliver to" : "Pickup") + "</dt><dd>" + esc((o.fulfillment_type === "delivery" ? [o.delivery_address, o.delivery_area, o.delivery_region].filter(Boolean).join(", ") : o.pickup_location) || "—") + "</dd>" + (o.delivery_instructions ? "<dt>Instructions</dt><dd>" + esc(o.delivery_instructions) + "</dd>" : "") + "</dl></div>" +
      '<div class="sx-sec"><h3>Items</h3><div class="sx-rows">' + items.map(i => '<div class="sx-row" style="grid-template-columns:minmax(0,1fr) auto"><div style="min-width:0"><div class="sx-row__t">' + esc(i.title) + '</div><div class="sx-row__s sx-num">' + num(i.quantity) + " × " + esc(money(i.price)) + '</div></div><div class="sx-row__r sx-num">' + esc(money(i.subtotal)) + "</div></div>").join("") + "</div>" +
      '<dl class="sx-kv" style="margin-top:12px"><dt>Subtotal</dt><dd class="sx-num">' + esc(money(o.subtotal)) + "</dd>" + (num(o.discount_amount) ? "<dt>Discount</dt><dd class=\"sx-num\">− " + esc(money(o.discount_amount)) + "</dd>" : "") + "<dt>Delivery</dt><dd class=\"sx-num\">" + esc(money(o.delivery_fee)) + "</dd><dt>Total</dt><dd class=\"sx-num\"><b>" + esc(money(o.total)) + "</b></dd></dl></div>" +
      '<div class="sx-sec"><h3>Timeline</h3><ol class="sx-tl"><li><b>Order placed</b><small>' + esc(dayTime(o.created_at)) + "</small></li>" + extra.history.map(h => "<li><b>" + esc(label(h.to_status)) + "</b>" + (h.notes ? " — " + esc(h.notes) : "") + "<small>" + esc(dayTime(h.created_at)) + "</small></li>").join("") + "</ol>" + (o.cancellation_reason ? '<p class="sx-note" style="margin-top:12px">Reason: ' + esc(o.cancellation_reason) + "</p>" : "") + "</div>" +
      '<div class="sx-sec"><h3>Private note (only you can see this)</h3><textarea class="sx-textarea" id="sxNote" maxlength="1000" placeholder="e.g. Customer asked for a call before delivery">' + esc(extra.note) + '</textarea><div style="margin-top:8px"><button class="sx-btn sx-btn--sm" id="sxSaveNote" type="button">Save note</button></div></div>' +
      (acts.length === 0 && !["delivered", "completed", "cancelled"].includes(o.order_status) ? '<p class="sx-note sx-note--info">A courier is handling this order. Its status updates automatically as the delivery progresses.</p>' : "");
    const foot = acts.map(a => '<button class="sx-btn ' + (a.primary ? "sx-btn--primary" : a.danger ? "sx-btn--danger" : "") + '" data-to="' + a.to + '" type="button">' + esc(a.text) + "</button>").join("") + '<a class="sx-btn" href="messages.html">Message customer</a>';
    openDrawer("Order #" + o.order_number, body, foot);
    $("#sxSaveNote").addEventListener("click", async e => { e.currentTarget.disabled = true; try { await D.saveNote(id, $("#sxNote").value); toast("Note saved", "good"); } catch (er) { toast(errMsg(er), "bad"); } e.currentTarget.disabled = false; });
    $$("[data-to]", $("#sxDrawerFoot")).forEach(b => b.addEventListener("click", async () => {
      const to = b.getAttribute("data-to"); let reason = null;
      if (to === "cancelled") { const r = await ask({ title: "Cancel order #" + o.order_number + "?", body: "The customer is notified and your stock is returned.", confirm: "Cancel order", cancel: "Keep order", danger: true, fields: [{ name: "reason", label: "Reason (shared with the customer)", type: "textarea", required: true, max: 300 }] }); if (!r) return; reason = r.reason; }
      b.disabled = true;
      try { await D.setStatus(id, to, reason); toast("Order updated", "good"); closeDrawer(); await loadSummary(); route(true); } catch (er) { toast(errMsg(er), "bad"); b.disabled = false; }
    }));
  }

  /* =======================================================
     PRODUCTS
     ======================================================= */
  const PSTAT = { approved: ["good", "Live"], pending_review: ["warn", "In review"], rejected: ["bad", "Rejected"], suspended: ["bad", "Suspended"], draft: ["", "Draft"] };
  const PGROUP = {
    all: () => true, live: p => p.status === "approved", low: p => p.status === "approved" && p.stock >= 1 && p.stock <= 3,
    out: p => p.status === "approved" && p.stock === 0, review: p => p.status === "pending_review", rejected: p => p.status === "rejected"
  };
  const PLABEL = { all: "All", live: "Live", low: "Low stock", out: "Out of stock", review: "In review", rejected: "Rejected" };

  async function viewProducts(el) {
    el.innerHTML = skel(3);
    const products = await D.products(true);
    state.edits.clear(); state.selected.clear();
    paintProducts(el, products);
  }
  function paintProducts(el, products) {
    const counts = {}; Object.keys(PGROUP).forEach(k => { counts[k] = products.filter(PGROUP[k]).length; });
    const q = state.prodQ.trim().toLowerCase();
    const rows = products.filter(PGROUP[state.prodFilter]).filter(p => !q || String(p.title).toLowerCase().includes(q));
    el.innerHTML = '<div class="sx-toolbar"><div class="sx-chips">' + Object.keys(PGROUP).map(k => '<button class="sx-chip" type="button" data-pfilter="' + k + '" aria-pressed="' + (state.prodFilter === k) + '">' + PLABEL[k] + " <b>" + counts[k] + "</b></button>").join("") + '</div><div class="sx-toolbar__space"></div><input class="sx-input" id="sxProdQ" type="search" placeholder="Search products" value="' + esc(state.prodQ) + '" aria-label="Search products"></div>' +
      '<div class="sx-toolbar" id="sxBulk" style="display:none"><span style="font-weight:700" id="sxBulkCount"></span><button class="sx-btn sx-btn--sm" data-bulk="stock" type="button">Set stock…</button><button class="sx-btn sx-btn--sm" data-bulk="addstock" type="button">Add stock…</button><button class="sx-btn sx-btn--sm" data-bulk="price" type="button">Change price %…</button></div>' +
      '<section class="sx-card"><div class="sx-table-wrap">' + (rows.length ? '<table class="sx-table"><thead><tr><th style="width:36px"><input type="checkbox" id="sxSelAll" aria-label="Select all"></th><th>Product</th><th>Status</th><th class="r">Price (D)</th><th>Stock</th><th class="r">Sold</th><th class="r">Views</th><th></th></tr></thead><tbody>' +
        rows.map(p => { const e = state.edits.get(p.id) || {}, st = PSTAT[p.status] || ["", label(p.status)]; return '<tr data-pid="' + esc(p.id) + '"><td><input type="checkbox" data-sel="' + esc(p.id) + '" ' + (state.selected.has(p.id) ? "checked" : "") + ' aria-label="Select ' + esc(p.title) + '"></td><td><div class="sx-cell">' + thumb(p.main_image, p.title) + "<div><b>" + esc(p.title) + "</b><small>" + esc(p.category_id || "") + "</small></div></div>" +
          (p.status === "rejected" && p.rejection_reason ? '<small style="color:var(--sx-bad);display:block;margin-top:4px">Rejected: ' + esc(p.rejection_reason) + "</small>" : "") + '</td><td><span class="sx-pill sx-pill--' + st[0] + '">' + esc(st[1]) + '</span></td><td class="r"><input class="sx-price sx-num ' + (e.price != null ? "sx-dirty" : "") + '" type="number" min="0" step="any" inputmode="decimal" data-price="' + esc(p.id) + '" value="' + esc(e.price != null ? e.price : p.price) + '" aria-label="Price"></td><td><div class="sx-step"><button type="button" data-dec="' + esc(p.id) + '" aria-label="Decrease stock">−</button><input class="sx-num ' + (e.stock != null ? "sx-dirty" : "") + '" type="number" min="0" step="1" inputmode="numeric" data-stock="' + esc(p.id) + '" value="' + esc(e.stock != null ? e.stock : p.stock) + '" aria-label="Stock"><button type="button" data-inc="' + esc(p.id) + '" aria-label="Increase stock">+</button></div></td><td class="r sx-num">' + num(p.sales_count) + '</td><td class="r sx-num">' + num(p.views_count) + '</td><td class="r"><a class="sx-btn sx-btn--sm" href="edit-product.html?id=' + esc(p.id) + '">Edit</a></td></tr>'; }).join("") + "</tbody></table>"
        : empty(products.length ? "No products match" : "No products yet", products.length ? "Try another filter." : "Add your first product to start selling.", products.length ? "" : '<p><a class="sx-btn sx-btn--primary" href="add-product.html">Add product</a></p>')) + "</div></section>" +
      '<div class="sx-savebar" id="sxSaveBar"><span id="sxSaveText"></span><button class="sx-btn sx-btn--sm" id="sxDiscard" type="button">Discard</button><button class="sx-btn sx-btn--primary sx-btn--sm" id="sxSave" type="button">Save changes</button></div>';
    hydrate(el); refreshSaveBar(); refreshBulk();
    const s = $("#sxProdQ"); s.addEventListener("input", () => { state.prodQ = s.value; clearTimeout(s._t); s._t = setTimeout(() => { const c = s.selectionStart; paintProducts(el, products); const s2 = $("#sxProdQ"); s2.focus(); s2.setSelectionRange(c, c); }, 220); });
  }
  function setEdit(id, key, value, products) {
    const p = products.find(x => x.id === id); if (!p) return;
    const e = state.edits.get(id) || {};
    if (String(value) === String(p[key])) delete e[key]; else e[key] = value;
    if (Object.keys(e).length) state.edits.set(id, e); else state.edits.delete(id);
  }
  function refreshSaveBar() {
    const bar = $("#sxSaveBar"); if (!bar) return;
    const n = state.edits.size, priceN = [...state.edits.values()].filter(e => e.price != null).length;
    bar.classList.toggle("is-on", n > 0);
    $("#sxSaveText").textContent = n + (n === 1 ? " product changed" : " products changed") + (priceN ? " · " + priceN + " price " + (priceN === 1 ? "change sends" : "changes send") + " the listing back to review" : "");
  }
  function refreshBulk() {
    const b = $("#sxBulk"); if (!b) return;
    b.style.display = state.selected.size ? "flex" : "none";
    $("#sxBulkCount").textContent = state.selected.size + " selected";
  }
  async function saveProducts() {
    const products = await D.products();
    const updates = [...state.edits.entries()].map(([id, e]) => Object.assign({ id }, e.stock != null ? { stock: Math.max(0, Math.floor(num(e.stock))) } : {}, e.price != null ? { price: Math.max(0, num(e.price)) } : {}));
    if (updates.some(u => !Number.isFinite(u.price ?? 0) || !Number.isFinite(u.stock ?? 0))) { toast("Check the numbers you entered", "bad"); return; }
    const live = updates.filter(u => u.price != null && (products.find(p => p.id === u.id) || {}).status === "approved").length;
    if (live) { const ok = await ask({ title: "Change price on " + live + (live === 1 ? " live listing?" : " live listings?"), body: "A price change sends the listing back for review before it is visible again. Stock changes are instant.", confirm: "Save changes" }); if (!ok) return; }
    const btn = $("#sxSave"); btn.disabled = true;
    try {
      const res = await D.bulkUpdate(updates);
      toast(num(res.updated) + (num(res.updated) === 1 ? " product" : " products") + " updated" + (num(res.sent_to_review) ? " · " + num(res.sent_to_review) + " sent to review" : ""), "good");
      state.edits.clear(); await loadSummary(); route(true);
    } catch (e) { toast(errMsg(e), "bad"); btn.disabled = false; }
  }
  async function bulkAction(kind) {
    const products = await D.products(), ids = [...state.selected];
    const cfg = { stock: { title: "Set stock for " + ids.length + " products", label: "New stock level", min: 0, step: 1 }, addstock: { title: "Add stock to " + ids.length + " products", label: "Units to add (use a negative number to remove)", step: 1 }, price: { title: "Change price of " + ids.length + " products", label: "Percent change (e.g. 10 raises prices 10%, -5 lowers 5%)", step: "any" } }[kind];
    const r = await ask({ title: cfg.title, body: kind === "price" ? "Nothing is saved until you press Save changes. Price changes send listings back to review." : "Nothing is saved until you press Save changes.", confirm: "Apply", fields: [{ name: "v", label: cfg.label, type: "number", min: cfg.min, step: cfg.step, required: true }] });
    if (!r) return;
    const v = num(r.v);
    ids.forEach(id => { const p = products.find(x => x.id === id); if (!p) return;
      if (kind === "stock") setEdit(id, "stock", Math.max(0, Math.floor(v)), products);
      if (kind === "addstock") setEdit(id, "stock", Math.max(0, Math.floor(num(p.stock) + v)), products);
      if (kind === "price") setEdit(id, "price", Math.max(0, Math.round(num(p.price) * (1 + v / 100) * 100) / 100), products); });
    paintProducts($("#v-products"), products);
  }

  /* =======================================================
     CUSTOMERS
     ======================================================= */
  async function viewCustomers(el) {
    el.innerHTML = skel(3);
    const all = await D.customers();
    const q = state.custQ.trim().toLowerCase(), rows = all.filter(c => !q || String(c.display_name).toLowerCase().includes(q));
    const repeat = all.filter(c => c.is_repeat).length, spent = all.reduce((t, c) => t + c.spent, 0);
    el.innerHTML = '<div class="sx-grid sx-grid--kpi" style="margin-bottom:18px;grid-template-columns:repeat(3,minmax(0,1fr))">' + kpi("Customers", String(all.length), "who have bought from you") + kpi("Repeat buyers", all.length ? Math.round(repeat / all.length * 100) + "%" : "0%", repeat + " ordered more than once") + kpi("Avg. spend", money(all.length ? spent / all.length : 0), "per customer, lifetime") + "</div>" +
      '<div class="sx-toolbar"><input class="sx-input" id="sxCustQ" type="search" placeholder="Search customers" value="' + esc(state.custQ) + '" aria-label="Search customers"></div><section class="sx-card"><div class="sx-table-wrap">' +
      (rows.length ? '<table class="sx-table"><thead><tr><th>Customer</th><th class="r">Orders</th><th class="r">Total spent</th><th>First order</th><th>Last order</th><th></th></tr></thead><tbody>' + rows.map(c => '<tr><td><div class="sx-cell">' + thumb(c.avatar_url, c.display_name) + "<b>" + esc(c.display_name) + '</b></div></td><td class="r sx-num">' + c.orders + '</td><td class="r sx-num"><b>' + esc(money(c.spent)) + "</b></td><td>" + esc(day(c.first_order_at)) + "</td><td>" + esc(ago(c.last_order_at)) + '</td><td>' + (c.is_repeat ? '<span class="sx-pill sx-pill--good">Repeat</span>' : '<span class="sx-pill">New</span>') + "</td></tr>").join("") + "</tbody></table>" : empty(all.length ? "No customers match" : "No customers yet", all.length ? "Try a different name." : "Customers appear after their first order.")) + "</div></section>";
    hydrate(el);
    const s = $("#sxCustQ"); s.addEventListener("input", () => { state.custQ = s.value; clearTimeout(s._t); s._t = setTimeout(() => { const c = s.selectionStart; viewCustomers(el).then(() => { const s2 = $("#sxCustQ"); s2.focus(); s2.setSelectionRange(c, c); }); }, 220); });
  }

  /* =======================================================
     REVIEWS
     ======================================================= */
  async function viewReviews(el) {
    el.innerHTML = skel(3);
    const all = await D.reviews();
    const rows = all.filter(r => state.revFilter === "all" || !r.seller_reply);
    const avg = all.length ? all.reduce((t, r) => t + num(r.rating), 0) / all.length : 0, need = all.filter(r => !r.seller_reply).length;
    const dist = [5, 4, 3, 2, 1].map(n => [n, all.filter(r => num(r.rating) === n).length]);
    el.innerHTML = '<section class="sx-card" style="margin-bottom:18px"><div class="sx-card__body"><div class="sx-rating"><div><div class="sx-rating__big sx-num">' + (all.length ? avg.toFixed(1) : "–") + "</div>" + stars(avg) + '<div style="color:var(--sx-ink-3);font-size:13px;margin-top:4px">' + all.length + (all.length === 1 ? " review" : " reviews") + '</div></div><div class="sx-bars">' + dist.map(([n, c]) => "<div><span>" + n + '</span><em><i style="width:' + (all.length ? c / all.length * 100 : 0) + '%"></i></em><span class="sx-num">' + c + "</span></div>").join("") + "</div></div></div></section>" +
      '<div class="sx-toolbar"><div class="sx-chips"><button class="sx-chip" data-rfilter="all" aria-pressed="' + (state.revFilter === "all") + '" type="button">All <b>' + all.length + '</b></button><button class="sx-chip" data-rfilter="need" aria-pressed="' + (state.revFilter === "need") + '" type="button">Needs reply <b>' + need + "</b></button></div></div>" +
      '<section class="sx-card">' + (rows.length ? rows.map(r => '<article class="sx-review" data-rid="' + esc(r.id) + '"><div style="display:flex;gap:12px;align-items:center">' + thumb(r.product && r.product.main_image, r.product && r.product.title) + '<div style="min-width:0;flex:1"><div class="sx-row__t">' + esc(r.product ? r.product.title : "Product") + '</div><div class="sx-row__s">' + stars(num(r.rating)) + " · " + esc(ago(r.created_at)) + "</div></div></div>" + (r.title ? '<p style="margin-top:10px"><b>' + esc(r.title) + "</b></p>" : "") + (r.body ? "<blockquote>" + esc(r.body) + "</blockquote>" : "") +
        (r.seller_reply ? '<div class="sx-reply"><b>Your reply</b>' + esc(r.seller_reply) + '</div><p style="margin-top:8px"><button class="sx-link" data-reply="' + esc(r.id) + '" type="button">Edit reply</button></p>' : '<p style="margin-top:12px"><button class="sx-btn sx-btn--sm" data-reply="' + esc(r.id) + '" type="button">Reply publicly</button></p>') + "</article>").join("") : empty(all.length ? "Everything is answered" : "No reviews yet", all.length ? "You've replied to every review." : "Reviews from verified buyers will appear here.")) + "</section>";
    hydrate(el);
  }
  async function replyTo(id) {
    const all = await D.reviews(), r = all.find(x => x.id === id); if (!r) return;
    const v = await ask({ title: r.seller_reply ? "Edit your reply" : "Reply to this review", body: "Your reply is public on the product page. Stay polite and helpful.", confirm: "Post reply", fields: [{ name: "t", label: "Reply", type: "textarea", value: r.seller_reply || "", required: true, max: 800 }] });
    if (!v) return;
    try { await D.reply(id, v.t); toast("Reply posted", "good"); await loadSummary(); route(true); } catch (e) { toast(errMsg(e), "bad"); }
  }

  /* =======================================================
     EARNINGS
     ======================================================= */
  async function viewEarnings(el) {
    el.innerHTML = skel(3);
    const [s, wallet, payouts] = await Promise.all([loadSummary(), D.wallet().catch(() => null), D.payouts().catch(() => [])]);
    const PT = { requested: "warn", processing: "info", succeeded: "good", failed: "bad", cancelled: "", reversed: "bad" };
    el.innerHTML = (wallet ? "" : '<p class="sx-note">Wallet balances are unavailable right now. Your sales figures below are still accurate.</p>') +
      '<div class="sx-grid sx-grid--kpi" style="margin-bottom:18px">' + kpi("Available to withdraw", money(wallet && wallet.available_balance), "ready now") + kpi("Pending", money(wallet && wallet.pending_balance), "released after delivery") + kpi("In transit", money(wallet && wallet.payout_in_transit), "payouts being processed") + kpi("Withdrawn", money(wallet && wallet.withdrawn_total), "all time") + "</div>" +
      '<div class="sx-grid sx-grid--split"><section class="sx-card"><div class="sx-card__head"><h2>Recent payouts</h2><a href="earnings.html">Withdraw &amp; payout methods</a></div><div class="sx-card__body">' +
      (payouts.length ? '<div class="sx-rows">' + payouts.map(p => '<div class="sx-row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="sx-row__t sx-num">' + esc(money(p.amount)) + '</div><div class="sx-row__s">' + esc(dayTime(p.requested_at)) + (p.failure_reason ? " · " + esc(p.failure_reason) : "") + '</div></div><span class="sx-pill sx-pill--' + (PT[p.status] || "") + '">' + esc(label(p.status)) + "</span></div>").join("") + "</div>" : empty("No payouts yet", "Withdrawals you request will be listed here.")) + "</div></section>" +
      '<section class="sx-card"><div class="sx-card__head"><h2>This period</h2></div><div class="sx-card__body"><dl class="sx-kv" style="grid-template-columns:1fr auto"><dt>Revenue (' + state.days + ' days)</dt><dd class="sx-num">' + esc(money(s && s.revenue)) + "</dd><dt>Est. fee (" + esc(num(s && s.fee_rate)) + '%)</dt><dd class="sx-num">− ' + esc(money(s && s.est_fees)) + '</dd><dt><b>Est. after fees</b></dt><dd class="sx-num"><b>' + esc(money(num(s && s.revenue) - num(s && s.est_fees))) + '</b></dd></dl><p style="color:var(--sx-ink-3);font-size:12.5px;margin-top:12px">Estimate only. Your wallet is the source of truth: fees are settled when each order completes.</p><p style="margin-top:12px"><a class="sx-btn sx-btn--sm" href="earnings.html">COD commission reserve</a></p></div></section></div>';
  }

  function viewMore(el) {
    const L = [["Customers", "#/customers"], ["Earnings & payouts", "#/earnings"], ["Messages", "messages.html"], ["Add a product", "add-product.html"], ["Store profile", "store.html"], ["Business website", "website.html"], ["Pickup & delivery", "pickup-delivery.html"], ["Quotes", "quotes.html"], ["Settings", "settings.html"], ["Back to marketplace", "../index.html"]];
    el.innerHTML = '<section class="sx-card"><div class="sx-card__body"><div class="sx-todo">' + L.map(l => '<a href="' + l[1] + '"><span>' + esc(l[0]) + "</span><b>→</b></a>").join("") + "</div></div></section>";
  }

  /* =======================================================
     ROUTER
     ======================================================= */
  const VIEWS = { overview: viewOverview, orders: viewOrders, products: viewProducts, customers: viewCustomers, reviews: viewReviews, earnings: viewEarnings, more: viewMore };
  let token = 0;
  async function route(force) {
    const name = (location.hash.replace(/^#\/?/, "").split("?")[0] || "overview");
    const r = VIEWS[name] ? name : "overview";
    if (state.edits.size && !force && r !== "products" && state.route === "products") {
      if (!confirm("You have unsaved product changes. Leave without saving?")) { location.hash = "#/products"; return; }
      state.edits.clear();
    }
    state.route = r;
    $$(".sx-view").forEach(v => { v.hidden = v.id !== "v-" + r; });
    $$("[data-route]").forEach(a => { if (a.getAttribute("data-route") === r || (r === "customers" || r === "earnings") && a.getAttribute("data-route") === "more" && a.closest("#sxTabbar")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("#sxTitle").textContent = ROUTES[r];
    $("#sxPeriod").style.display = r === "overview" || r === "earnings" ? "" : "none";
    document.title = ROUTES[r] + " — Seller Studio";
    const my = ++token, host = $("#v-" + r);
    try { await VIEWS[r](host); } catch (e) { if (my === token) { console.error("[Seller Studio]", e); host.innerHTML = empty("Couldn't load this page", errMsg(e), '<p><button class="sx-btn" data-act="reload" type="button">Try again</button></p>'); } }
    if (!force) window.scrollTo({ top: 0 });
  }

  /* =======================================================
     EVENTS
     ======================================================= */
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-open-order],[data-ofilter],[data-pfilter],[data-rfilter],[data-reply],[data-act],[data-bulk],[data-inc],[data-dec],[data-days],#sxSave,#sxDiscard,#sxDrawerClose,#sxTheme");
    if (!t) { if (e.target.id === "sxScrim") closeDrawer(); return; }
    if (t.hasAttribute("data-open-order")) return void openOrder(t.getAttribute("data-open-order"));
    if (t.hasAttribute("data-ofilter")) { state.orderFilter = t.getAttribute("data-ofilter"); return void route(true); }
    if (t.hasAttribute("data-pfilter")) { state.prodFilter = t.getAttribute("data-pfilter"); state.selected.clear(); return void paintProducts($("#v-products"), await D.products()); }
    if (t.hasAttribute("data-rfilter")) { state.revFilter = t.getAttribute("data-rfilter"); return void route(true); }
    if (t.hasAttribute("data-reply")) return void replyTo(t.getAttribute("data-reply"));
    if (t.hasAttribute("data-bulk")) return void bulkAction(t.getAttribute("data-bulk"));
    if (t.hasAttribute("data-days")) { state.days = +t.getAttribute("data-days"); $$("#sxPeriod button").forEach(b => b.setAttribute("aria-pressed", String(b === t))); return void route(true); }
    if (t.hasAttribute("data-inc") || t.hasAttribute("data-dec")) {
      const id = t.getAttribute("data-inc") || t.getAttribute("data-dec"), input = $('[data-stock="' + id + '"]');
      input.value = Math.max(0, Math.floor(num(input.value)) + (t.hasAttribute("data-inc") ? 1 : -1));
      input.dispatchEvent(new Event("input", { bubbles: true })); return;
    }
    if (t.id === "sxSave") return void saveProducts();
    if (t.id === "sxDiscard") { state.edits.clear(); return void paintProducts($("#v-products"), await D.products()); }
    if (t.id === "sxDrawerClose") return void closeDrawer();
    if (t.id === "sxTheme") { const dark = document.documentElement.classList.toggle("dark"); try { localStorage.setItem("gambasket-theme", dark ? "dark" : "light"); } catch (er) { /* ignore */ } return; }
    if (t.getAttribute("data-act") === "reload") return void route(true);
    if (t.getAttribute("data-act") === "goal") {
      const s = state.summary || {};
      const v = await ask({ title: "Monthly goals", body: "Track this month's progress on your Overview. Leave a goal at 0 to turn it off.", confirm: "Save goals", fields: [{ name: "rev", label: "Revenue goal (D)", type: "number", min: 0, value: num(s.goal_revenue) }, { name: "ord", label: "Orders goal", type: "number", min: 0, step: 1, value: num(s.goal_orders) }] });
      if (!v) return;
      try { await D.setGoals(Math.max(0, num(v.rev)), Math.max(0, Math.floor(num(v.ord)))); toast("Goals saved", "good"); route(true); } catch (er) { toast(errMsg(er), "bad"); }
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("#sxDrawer").classList.contains("is-on")) closeDrawer();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("tr[data-open-order]")) { e.preventDefault(); openOrder(e.target.getAttribute("data-open-order")); }
  });
  document.addEventListener("input", async e => {
    const t = e.target;
    if (t.matches && t.matches("[data-stock],[data-price]")) {
      const id = t.getAttribute("data-stock") || t.getAttribute("data-price"), key = t.hasAttribute("data-stock") ? "stock" : "price";
      const products = await D.products(), p = products.find(x => x.id === id);
      const v = key === "stock" ? Math.max(0, Math.floor(num(t.value))) : Math.max(0, num(t.value));
      if (t.value === "" || !Number.isFinite(v)) return;
      setEdit(id, key, v, products); t.classList.toggle("sx-dirty", p && String(v) !== String(p[key])); refreshSaveBar();
    }
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "sxSelAll") { $$("[data-sel]").forEach(c => { c.checked = t.checked; t.checked ? state.selected.add(c.getAttribute("data-sel")) : state.selected.delete(c.getAttribute("data-sel")); }); refreshBulk(); }
    else if (t.matches && t.matches("[data-sel]")) { t.checked ? state.selected.add(t.getAttribute("data-sel")) : state.selected.delete(t.getAttribute("data-sel")); refreshBulk(); }
  });
  window.addEventListener("hashchange", () => route(false));
  window.addEventListener("beforeunload", e => { if (state.edits.size) { e.preventDefault(); e.returnValue = ""; } });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state.route === "overview" && $("#sxChart")) route(true); }, 250); });

  /* =======================================================
     BOOT
     ======================================================= */
  (async function boot() {
    const gate = $("#sxGate");
    try {
      const ok = window.GamBasketGuard && window.GamBasketGuard.gatePage ? await window.GamBasketGuard.gatePage("seller") : false;
      if (!ok) return;
      await D.init();
      D.client().from("stores").select("name,logo_url,location,is_verified").eq("seller_id", D.user().id).maybeSingle().then(({ data }) => {
        state.store = data || null;
        if (data) {
          $("#sxStoreName").textContent = data.name || "Your store";
          $("#sxStoreMeta").textContent = (data.is_verified ? "Verified · " : "") + (data.location || "Seller account");
          const u = safeUrl(data.logo_url), logo = $("#sxStoreLogo");
          if (u) { logo.style.backgroundImage = 'url("' + u.replace(/"/g, "%22") + '")'; logo.textContent = ""; } else logo.textContent = String(data.name || "J").charAt(0).toUpperCase();
          const h = $("#v-overview .sx-hero h2"); if (h && !h.textContent.includes(",")) h.textContent += ", " + data.name;
        }
      });
      gate.remove(); $("#sxApp").hidden = false; $("#sxTabbar").hidden = false;
      await loadSummary();
      route(false);
    } catch (e) {
      console.error("[Seller Studio] boot failed:", e);
      gate.innerHTML = '<div style="text-align:center;max-width:380px;padding:24px"><h2 style="color:#14181f">We couldn\'t open your studio</h2><p>' + esc(errMsg(e)) + '</p><p><a href="../login.html?redirect=' + encodeURIComponent(location.pathname) + '">Sign in</a></p></div>';
    }
  })();
})();
