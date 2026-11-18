/* JulaDirect Seller Centre: Overview.
   Every figure is computed from this seller's own rows:
   - orders via GamBasketSellerOrders.list() (orders where seller_id = me),
   - products via GamBasketSellerProducts.list(),
   - customer first names from the public_profiles view.
   Sales and fee maths match js/seller-earnings.js (merchandise value of every
   non-cancelled order, 5% estimated fee per order) so the Overview and the
   Earnings page agree. Nothing here is invented: with no data the page says
   so. Row-level security decides what the seller can read. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => "D " + Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  const label = s => String(s || "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  const TONE = { pending: "warning", confirmed: "info", processing: "info", ready_for_delivery: "info", delivery_assigned: "info", picked_up: "info", out_for_delivery: "info", ready_for_pickup: "info", delivered: "success", completed: "success", cancelled: "danger" };
  const IN_PROGRESS = ["confirmed", "processing", "ready_for_delivery", "delivery_assigned", "picked_up", "out_for_delivery", "ready_for_pickup"];
  const LIVE_PRODUCT = ["approved", "active", "published"];
  const REVIEW_PRODUCT = ["pending_review", "pending", "submitted"];
  let orders = [];
  let products = [];
  const names = new Map();

  const status = o => String(o.order_status || o.status || "").toLowerCase();
  const total = o => Number(o.total_amount ?? o.total ?? 0);
  function merchandise(o) {
    const fee = Number(o.delivery_fee || 0);
    const sub = Number(o.subtotal ?? Math.max(0, total(o) - fee));
    const discount = Number(o.discount_amount ?? o.discount ?? 0);
    return Math.max(0, sub - discount);
  }
  const marketplaceFee = amount => Math.round(Number(amount || 0) * 0.05 * 100) / 100;
  const shortDay = d => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const safeUrl = u => { try { const x = new URL(String(u || ""), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };

  function renderKpis() {
    const live = orders.filter(o => status(o) !== "cancelled");
    const gross = live.reduce((t, o) => t + merchandise(o), 0);
    const fees = live.reduce((t, o) => t + marketplaceFee(merchandise(o)), 0);
    const pending = orders.filter(o => status(o) === "pending").length;
    const progress = orders.filter(o => IN_PROGRESS.includes(status(o))).length;
    const activeProducts = products.filter(p => LIVE_PRODUCT.includes(String(p.status || "").toLowerCase())).length;
    const low = products.filter(p => Number(p.stock || 0) > 0 && Number(p.stock || 0) <= 3).length;
    const out = products.filter(p => Number(p.stock || 0) <= 0).length;
    $("sellerGrossSales").textContent = money(gross);
    $("sellerSalesMeta").textContent = live.length + (live.length === 1 ? " order" : " orders") + ", excluding cancelled";
    $("sellerFees").textContent = money(fees);
    $("pendingOrders").textContent = String(pending);
    $("pendingMeta").textContent = progress + " in progress";
    $("productCount").textContent = String(activeProducts);
    $("productMeta").textContent = low + " low stock \u00b7 " + out + " out of stock";
    return { pending, low, out, review: products.filter(p => REVIEW_PRODUCT.includes(String(p.status || "").toLowerCase())).length };
  }

  function renderAttention(k) {
    const items = [];
    if (k.pending) items.push('<a href="orders.html"><span>' + k.pending + (k.pending === 1 ? " new order is" : " new orders are") + " waiting for you to confirm</span><b>Review &rarr;</b></a>");
    if (k.out) items.push('<a href="products.html"><span>' + k.out + (k.out === 1 ? " product is" : " products are") + " out of stock</span><b>Restock &rarr;</b></a>");
    if (k.low) items.push('<a href="products.html"><span>' + k.low + (k.low === 1 ? " product is" : " products are") + " running low (3 or fewer)</span><b>Check &rarr;</b></a>");
    if (k.review) items.push('<a href="products.html"><span>' + k.review + (k.review === 1 ? " product is" : " products are") + " awaiting review</span><b>View &rarr;</b></a>");
    const box = $("sellerAttention");
    box.hidden = !items.length;
    box.innerHTML = items.join("");
  }

  function renderChart() {
    const range = Number($("sellerRange").value) || 30;
    const el = $("sellerSalesChart");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (range - 1));
    const weekly = range > 31;
    const size = weekly ? 7 : 1;
    const buckets = [];
    for (let i = 0; i < range; i += size) {
      const from = new Date(start); from.setDate(from.getDate() + i);
      const to = new Date(from); to.setDate(to.getDate() + Math.min(size, range - i) - 1);
      buckets.push({ from, to, amount: 0, count: 0 });
    }
    let sum = 0;
    let count = 0;
    orders.filter(o => status(o) !== "cancelled").forEach(o => {
      const d = new Date(o.created_at);
      if (isNaN(d)) return;
      d.setHours(0, 0, 0, 0);
      if (d < start || d > today) return;
      const idx = Math.min(buckets.length - 1, Math.floor(Math.round((d - start) / 86400000) / size));
      const amt = merchandise(o);
      buckets[idx].amount += amt; buckets[idx].count++;
      sum += amt; count++;
    });
    if (!count) {
      el.innerHTML = '<div class="seller-empty"><div><h3>No sales in this period</h3><p>Sales appear here as buyers place orders for your products.</p></div></div>';
      return;
    }
    const W = 640, H = 220, L = 8, R = 8, T = 18, B = 30;
    const max = Math.max.apply(null, buckets.map(b => b.amount)) || 1;
    const gap = buckets.length > 20 ? 3 : 8;
    const bw = (W - L - R - gap * (buckets.length - 1)) / buckets.length;
    const peak = buckets.findIndex(b => b.amount === max);
    const bars = buckets.map((b, i) => {
      const h = Math.max(b.amount > 0 ? 3 : 0, (b.amount / max) * (H - T - B));
      const x = L + i * (bw + gap);
      const tip = (weekly ? shortDay(b.from) + " \u2013 " + shortDay(b.to) : shortDay(b.from)) + ": " + money(b.amount) + " from " + b.count + (b.count === 1 ? " order" : " orders");
      return '<rect class="bar' + (i === peak ? " is-peak" : "") + '" x="' + x.toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(5, bw / 2).toFixed(1) + '"><title>' + esc(tip) + "</title></rect>";
    }).join("");
    const mid = buckets[Math.floor(buckets.length / 2)];
    el.innerHTML = '<div class="seller-chart-summary"><strong>' + esc(money(sum)) + "</strong><span>from " + count + (count === 1 ? " order" : " orders") + " in the last " + range + " days</span></div>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Sales per ' + (weekly ? "week" : "day") + " over the last " + range + " days. Total " + esc(money(sum)) + ". Best " + (weekly ? "week" : "day") + " " + esc(money(max)) + '.">' +
      '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>' + bars +
      '<text x="' + L + '" y="12">' + esc(money(max)) + "</text>" +
      '<text x="' + L + '" y="' + (H - 8) + '">' + esc(shortDay(buckets[0].from)) + "</text>" +
      '<text x="' + (W / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(shortDay(mid.from)) + "</text>" +
      '<text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(shortDay(buckets[buckets.length - 1].to)) + "</text></svg>";
  }

  function renderStock() {
    const box = $("lowStockList");
    const list = products.filter(p => Number(p.stock || 0) <= 3).sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0)).slice(0, 5);
    if (!list.length) {
      box.innerHTML = '<div class="seller-empty" style="min-height:180px;padding:12px"><div><h3>All stocked up</h3><p>Products with 3 or fewer units left will show here.</p></div></div>';
      return;
    }
    box.innerHTML = list.map(p => {
      const n = Number(p.stock || 0);
      const img = safeUrl(p.main_image);
      return '<a class="seller-low-stock-item" href="products.html">' + (img ? '<img class="seller-low-stock-image" src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="seller-low-stock-image"></span>') +
        '<span class="seller-low-stock-copy"><strong>' + esc(p.title || "Product") + "</strong><span>" + (n <= 0 ? "Out of stock" : "Only " + n + " left") + '</span></span><span class="stock-badge ' + (n <= 0 ? "stock-out" : "stock-low") + '">' + (n <= 0 ? "Out" : "Low") + "</span></a>";
    }).join("");
  }

  function renderOrders() {
    const body = $("recentOrdersBody");
    const rows = orders.slice(0, 6);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5"><div class="seller-empty"><div><h3>No orders yet</h3><p>Orders will appear here once buyers purchase your products.</p></div></div></td></tr>';
      return;
    }
    body.innerHTML = rows.map(o => {
      const st = status(o);
      const d = new Date(o.created_at);
      return '<tr><td><a href="orders.html">#' + esc(o.order_number || String(o.id || "").slice(0, 8).toUpperCase()) + "</a></td><td>" + esc(names.get(o.buyer_id) || "Customer") + "</td><td>" + esc(money(total(o))) +
        '</td><td><span class="seller-status ' + (TONE[st] || "info") + '">' + esc(label(st) || "Unknown") + "</span></td><td>" + (isNaN(d) ? "" : esc(d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))) + "</td></tr>";
    }).join("");
  }

  async function loadNames() {
    const ids = [...new Set(orders.slice(0, 6).map(o => o.buyer_id).filter(Boolean))];
    if (!ids.length) return;
    try {
      const c = window.supabaseClient || (window.GamBasketAuth && window.GamBasketAuth.getClient());
      const { data } = await c.from("public_profiles").select("id,first_name,last_name").in("id", ids);
      (data || []).forEach(p => names.set(p.id, [p.first_name, p.last_name ? p.last_name.charAt(0) + "." : ""].filter(Boolean).join(" ") || "Customer"));
    } catch (e) { /* names are a nicety; rows fall back to "Customer" */ }
  }

  function failed(msg) {
    ["sellerGrossSales", "pendingOrders", "productCount", "sellerFees"].forEach(id => { $(id).textContent = "\u2014"; });
    $("sellerSalesChart").innerHTML = '<div class="seller-empty"><div><h3>We could not load your sales</h3><p>' + esc(msg || "Please refresh the page to try again.") + "</p></div></div>";
    $("lowStockList").innerHTML = "";
    $("recentOrdersBody").innerHTML = '<tr><td colspan="5"><div class="seller-empty"><div><p>' + esc(msg || "Could not load orders.") + "</p></div></div></td></tr>";
  }

  async function boot() {
    try {
      if (window.GamBasketAuth && window.GamBasketAuth.ready) await window.GamBasketAuth.ready();
      if (!window.GamBasketSellerOrders || !window.GamBasketSellerProducts) throw new Error("Seller data modules did not load.");
      const [o, p] = await Promise.all([window.GamBasketSellerOrders.list(), window.GamBasketSellerProducts.list()]);
      orders = (o && o.items) || [];
      products = Array.isArray(p) ? p : (p && p.items) || [];
      await loadNames();
      renderAttention(renderKpis());
      renderChart();
      renderStock();
      renderOrders();
    } catch (e) {
      console.warn("[JulaDirect] seller overview", e && e.message);
      failed(e && e.message);
    }
  }

  $("sellerRange").addEventListener("change", renderChart);
  boot();
})();
