/* =========================================================
   Seller Studio: data layer.

   Every call goes through Supabase with the signed-in seller's own session, so row-level
   security decides what is readable. Analytics use the server functions from
   supabase/migrations/20261119000000_seller_studio_v2.sql. If a function is not deployed yet
   (or fails), the same numbers are computed here from the seller's own orders, so the page
   still works; `SX.data.mode` says which path was used.
   ========================================================= */
(function () {
  "use strict";
  const SX = (window.SX = window.SX || {});
  const MS_DAY = 86400000;

  let client = null;
  let user = null;
  let ordersCache = null;
  let productsCache = null;
  const names = new Map();

  const status = o => String(o.order_status || "").toLowerCase();
  /* Merchandise value: what the seller is paid for, before delivery fees. */
  const merch = o => Math.max(0, Number(o.subtotal || 0) - Number(o.discount_amount || 0));
  const num = v => Number(v || 0);
  const isMissingFn = e => !!e && (/PGRST202|42883|42P01/.test(String(e.code || "")) || /could not find the function|does not exist|schema cache/i.test(String(e.message || "")));

  const data = (SX.data = { mode: "server", ready: false });

  data.init = async function () {
    await window.GamBasketAuth.ready();
    client = window.GamBasketAuth.getClient();
    user = await window.GamBasketAuth.getUser();
    if (!client || !user) throw new Error("Not signed in");
    data.ready = true;
    return user;
  };
  data.user = () => user;
  data.client = () => client;

  async function rpc(name, args, fallback) {
    const { data: res, error } = await client.rpc(name, args || {});
    if (!error) return res;
    if (fallback && (isMissingFn(error) || /Seller access required/i.test(error.message) === false)) {
      data.mode = "fallback";
      console.warn("[Seller Studio] " + name + " unavailable, computing locally:", error.message);
      return fallback();
    }
    throw error;
  }

  /* ---------- raw rows ---------- */
  data.orders = async function (force) {
    if (ordersCache && !force) return ordersCache;
    const { data: rows, error } = await client.from("orders")
      .select("*, order_items(id,product_id,title,price,quantity,subtotal)")
      .eq("seller_id", user.id).order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    ordersCache = rows || [];
    const ids = [...new Set(ordersCache.map(o => o.buyer_id).filter(Boolean))].filter(id => !names.has(id));
    if (ids.length) {
      const { data: profs } = await client.from("public_profiles").select("id,first_name,last_name,avatar_url").in("id", ids.slice(0, 300));
      (profs || []).forEach(p => names.set(p.id, p));
    }
    return ordersCache;
  };
  data.buyer = id => {
    const p = names.get(id);
    const n = p ? [p.first_name, p.last_name ? p.last_name[0] + "." : ""].filter(Boolean).join(" ").trim() : "";
    return { name: n || "Customer", avatar: p && p.avatar_url || "" };
  };
  data.invalidate = () => { ordersCache = null; productsCache = null; };

  data.products = async function (force) {
    if (productsCache && !force) return productsCache;
    const { data: rows, error } = await client.from("products").select("*").eq("seller_id", user.id).order("updated_at", { ascending: false }).limit(1000);
    if (error) throw error;
    productsCache = rows || [];
    return productsCache;
  };

  /* ---------- analytics: server first, local fallback ---------- */
  data.summary = async function (days) {
    return rpc("seller_dashboard_summary", { p_days: days }, async () => {
      const [orders, products, reviews, goals] = await Promise.all([data.orders(), data.products(), data.reviews().catch(() => []), data.goals().catch(() => null)]);
      const now = Date.now(), cur = now - days * MS_DAY, prev = now - days * 2 * MS_DAY;
      const live = o => status(o) !== "cancelled";
      const inCur = orders.filter(o => +new Date(o.created_at) >= cur);
      const inPrev = orders.filter(o => { const t = +new Date(o.created_at); return t >= prev && t < cur; });
      const rev = inCur.filter(live).reduce((t, o) => t + merch(o), 0);
      const n = inCur.filter(live).length;
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const month = orders.filter(o => live(o) && +new Date(o.created_at) >= +monthStart);
      const approved = products.filter(p => p.status === "approved");
      const ratings = reviews.map(r => num(r.rating));
      return {
        days, fee_rate: 5, revenue: rev, orders: n, cancelled: inCur.filter(o => !live(o)).length,
        buyers: new Set(inCur.filter(live).map(o => o.buyer_id)).size,
        avg_order: n ? Math.round(rev / n * 100) / 100 : 0, est_fees: Math.round(rev * 5) / 100,
        prev_revenue: inPrev.filter(live).reduce((t, o) => t + merch(o), 0), prev_orders: inPrev.filter(live).length,
        pending_orders: orders.filter(o => status(o) === "pending").length,
        overdue_orders: orders.filter(o => status(o) === "pending" && now - +new Date(o.created_at) > MS_DAY).length,
        in_progress_orders: orders.filter(o => ["confirmed", "processing", "ready_for_delivery", "delivery_assigned", "picked_up", "out_for_delivery", "ready_for_pickup"].includes(status(o))).length,
        live_products: approved.length,
        low_stock: approved.filter(p => p.stock >= 1 && p.stock <= 3).length,
        out_of_stock: approved.filter(p => p.stock === 0).length,
        in_review: products.filter(p => p.status === "pending_review").length,
        rejected: products.filter(p => p.status === "rejected").length,
        avg_rating: ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 100) / 100 : 0,
        review_count: ratings.length, unanswered_reviews: reviews.filter(r => !r.seller_reply).length,
        goal_revenue: goals ? num(goals.monthly_revenue_target) : 0, goal_orders: goals ? num(goals.monthly_orders_target) : 0,
        month_revenue: month.reduce((t, o) => t + merch(o), 0), month_orders: month.length
      };
    });
  };

  data.series = async function (days) {
    const rows = await rpc("seller_sales_series", { p_days: days }, async () => {
      const orders = await data.orders();
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const key = d.toLocaleDateString("en-CA");
        const day = orders.filter(o => status(o) !== "cancelled" && new Date(o.created_at).toLocaleDateString("en-CA") === key);
        out.push({ day: key, orders: day.length, revenue: day.reduce((t, o) => t + merch(o), 0) });
      }
      return out;
    });
    return (rows || []).map(r => ({ day: String(r.day).slice(0, 10), orders: num(r.orders), revenue: num(r.revenue) }));
  };

  data.topProducts = async function (days, limit) {
    return rpc("seller_top_products", { p_days: days, p_limit: limit || 5 }, async () => {
      const [orders, products] = await Promise.all([data.orders(), data.products()]);
      const since = Date.now() - days * MS_DAY, map = new Map();
      orders.filter(o => status(o) !== "cancelled" && +new Date(o.created_at) >= since).forEach(o => (o.order_items || []).forEach(i => {
        const k = i.product_id || i.title, r = map.get(k) || { product_id: i.product_id, title: i.title, units: 0, revenue: 0 };
        r.units += num(i.quantity); r.revenue += num(i.subtotal); map.set(k, r);
      }));
      const byId = new Map(products.map(p => [p.id, p]));
      return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit || 5).map(r => {
        const p = byId.get(r.product_id);
        return Object.assign(r, { title: p ? p.title : r.title, image: p ? p.main_image : "", stock: p ? p.stock : null });
      });
    });
  };

  data.customers = async function () {
    const rows = await rpc("seller_customer_insights", { p_limit: 300 }, async () => {
      const orders = (await data.orders()).filter(o => status(o) !== "cancelled"), map = new Map();
      orders.forEach(o => {
        const r = map.get(o.buyer_id) || { buyer_id: o.buyer_id, orders: 0, spent: 0, first_order_at: o.created_at, last_order_at: o.created_at };
        r.orders++; r.spent += merch(o);
        if (o.created_at < r.first_order_at) r.first_order_at = o.created_at;
        if (o.created_at > r.last_order_at) r.last_order_at = o.created_at;
        map.set(o.buyer_id, r);
      });
      return [...map.values()].map(r => { const b = data.buyer(r.buyer_id); return Object.assign(r, { display_name: b.name, avatar_url: b.avatar, is_repeat: r.orders > 1 }); })
        .sort((a, b) => (a.last_order_at < b.last_order_at ? 1 : -1));
    });
    return (rows || []).map(r => Object.assign({}, r, { orders: num(r.orders), spent: num(r.spent) }));
  };

  /* ---------- reviews, goals, wallet ---------- */
  data.reviews = async function () {
    const { data: rows, error } = await client.from("marketplace_reviews")
      .select("id,product_id,order_id,rating,title,body,seller_reply,created_at,product:products(title,main_image)")
      .eq("seller_id", user.id).eq("status", "published").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return rows || [];
  };
  data.goals = async function () {
    const { data: row, error } = await client.from("seller_goals").select("*").eq("seller_id", user.id).maybeSingle();
    if (error) throw error;
    return row;
  };
  data.wallet = async function () {
    const { data: rows, error } = await client.rpc("seller_get_wallet_summary");
    if (error) throw error;
    return Array.isArray(rows) ? rows[0] : rows;
  };
  data.payouts = async function () {
    const { data: rows, error } = await client.from("seller_payout_requests").select("id,amount,status,requested_at,processed_at,failure_reason").eq("seller_id", user.id).order("requested_at", { ascending: false }).limit(20);
    if (error) throw error;
    return rows || [];
  };

  /* ---------- order detail & actions ---------- */
  data.orderDetail = async function (id) {
    const [hist, note] = await Promise.all([
      client.from("order_status_history").select("from_status,to_status,notes,created_at").eq("order_id", id).order("created_at", { ascending: true }),
      client.from("seller_order_notes").select("note").eq("order_id", id).eq("seller_id", user.id).maybeSingle()
    ]);
    return { history: hist.error ? [] : hist.data || [], note: note.error || !note.data ? "" : note.data.note };
  };
  data.setStatus = async function (id, next, reason) {
    const { error } = await client.rpc("seller_update_order_status", { p_order_id: id, p_next_status: next, p_reason: reason || null });
    if (error) throw error;
    data.invalidate();
  };
  data.saveNote = async function (id, note) {
    const { error } = await client.rpc("seller_save_order_note", { p_order_id: id, p_note: note });
    if (error) throw new Error(isMissingFn(error) ? "Order notes need the Seller Studio database update to be applied." : error.message);
  };
  data.setGoals = async function (revenue, orders) {
    const { error } = await client.rpc("seller_set_goals", { p_monthly_revenue: revenue, p_monthly_orders: orders });
    if (error) throw new Error(isMissingFn(error) ? "Goals need the Seller Studio database update to be applied." : error.message);
  };
  data.reply = async function (reviewId, text) {
    const { error } = await client.rpc("seller_reply_to_review", { p_review_id: reviewId, p_reply: text });
    if (error) throw new Error(isMissingFn(error) ? "Replies need the Seller Studio database update to be applied." : error.message);
  };
  /* updates: [{id, stock?, price?}] */
  data.bulkUpdate = async function (updates) {
    const { data: res, error } = await client.rpc("seller_bulk_update_products", { p_updates: updates });
    if (!error) { productsCache = null; return res; }
    if (!isMissingFn(error)) throw error;
    let updated = 0, review = 0;
    for (const u of updates) {
      const patch = {};
      if (u.stock != null) patch.stock = u.stock;
      if (u.price != null) patch.price = u.price;
      const { data: row, error: e2 } = await client.from("products").update(patch).eq("id", u.id).eq("seller_id", user.id).select("status").single();
      if (e2) throw e2;
      updated++; if (u.price != null && row.status === "pending_review") review++;
    }
    productsCache = null;
    return { updated, sent_to_review: review };
  };
})();
