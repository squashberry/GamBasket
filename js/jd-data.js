/* =========================================================
   JulaDirect v2 marketplace data layer.
   Read-only queries over the existing Supabase tables, all through
   the single adapter client (GamBasketAuth). Row-level security
   remains the authority on what each visitor can see.
   Tables read: products, product_images, public_profiles,
   marketplace_reviews.
   ========================================================= */
(function () {
  "use strict";
  const JD = (window.JD = window.JD || {});
  const PAGE_SIZE = 24;
  const isNum = v => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0;
  const clean = s => String(s || "").replace(/[,()%*\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const unavailable = () => new Error("The marketplace is unavailable right now. Please try again shortly.");

  async function attachSellers(rows) {
    const ids = [...new Set(rows.map(r => r.seller_id).filter(JD.isUuid))];
    const byId = new Map();
    if (ids.length) {
      try {
        const c = await JD.client();
        const { data } = await c.from("public_profiles").select("id,business_name,first_name,last_name,seller_type,is_seller_verified").in("id", ids);
        (data || []).forEach(r => byId.set(r.id, r));
      } catch (e) { console.warn("[JulaDirect] seller badges", e && e.message); }
    }
    rows.forEach(r => {
      const s = byId.get(r.seller_id);
      r._seller = { id: r.seller_id, name: JD.sellerName(s), verified: !!(s && s.is_seller_verified), type: s && s.seller_type === "business" ? "business" : "individual" };
    });
    return rows;
  }

  function applySort(q, sort) {
    switch (sort) {
      case "price_asc": return q.order("price", { ascending: true }).order("created_at", { ascending: false });
      case "price_desc": return q.order("price", { ascending: false }).order("created_at", { ascending: false });
      case "popular":
      case "best-selling": return q.order("sales_count", { ascending: false }).order("created_at", { ascending: false });
      default: return q.order("created_at", { ascending: false });
    }
  }

  let statsPromise = null;
  const ICONS = { Phones: "phone", Fashion: "tag", Electronics: "grid", Food: "bag", Home: "home", Beauty: "heart", Solar: "settings", Auto: "truck", Hardware: "package" };

  JD.data = {
    PAGE_SIZE,
    attachSellers,
    categoryIcon: id => ICONS[id] || "bag",

    /* The live homepage banner (or null). A missing table or any error means "no banner". */
    async activeBanner() {
      try {
        const c = await JD.client();
        if (!c) return null;
        const { data, error } = await c.from("site_banners").select("*").eq("is_active", true).order("updated_at", { ascending: false }).limit(1);
        if (error || !data || !data[0]) return null;
        const b = data[0];
        const now = Date.now();
        if (b.starts_at && new Date(b.starts_at).getTime() > now) return null;
        if (b.ends_at && new Date(b.ends_at).getTime() < now) return null;
        return b;
      } catch (e) { return null; }
    },
    /* Admin preview of any banner by id (row-level security hides it from everyone else). */
    async bannerById(id) {
      if (!JD.isUuid(id)) return null;
      try {
        const c = await JD.client();
        const { data, error } = await c.from("site_banners").select("*").eq("id", id).maybeSingle();
        return error ? null : data;
      } catch (e) { return null; }
    },

    /* Price bounds, average and a 24-bucket histogram of live listings. */
    async priceStats() {
      try {
        const cached = JSON.parse(sessionStorage.getItem("jd_price") || "null");
        if (cached && Date.now() - cached.t < 300000) return cached.v;
      } catch (e) { /* ignore */ }
      const c = await JD.client();
      if (!c) return null;
      const { data, error } = await c.from("products").select("price").eq("status", "approved").range(0, 4999);
      if (error) throw error;
      const prices = (data || []).map(r => Number(r.price)).filter(n => Number.isFinite(n) && n >= 0);
      if (!prices.length) return null;
      const min = Math.floor(Math.min.apply(null, prices));
      const max = Math.ceil(Math.max.apply(null, prices));
      const span = Math.max(1, max - min);
      const bins = new Array(24).fill(0);
      prices.forEach(p => { bins[Math.min(23, Math.floor(((p - min) / span) * 24))]++; });
      const v = { min, max: Math.max(max, min + 1), avg: Math.round(prices.reduce((t, n) => t + n, 0) / prices.length), bins, count: prices.length };
      try { sessionStorage.setItem("jd_price", JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
      return v;
    },

    /* One real product photo per category (top sellers first) for category tiles. */
    async categoryImages() {
      try {
        const cached = JSON.parse(sessionStorage.getItem("jd_catimg") || "null");
        if (cached && Date.now() - cached.t < 600000) return cached.v;
      } catch (e) { /* ignore */ }
      const c = await JD.client();
      if (!c) return {};
      const { data, error } = await c.from("products").select("category_id,main_image").eq("status", "approved").not("main_image", "is", null).order("sales_count", { ascending: false }).limit(150);
      if (error) throw error;
      const v = {};
      (data || []).forEach(r => { const u = JD.safeUrl(r.main_image); if (u && r.category_id && !v[r.category_id]) v[r.category_id] = u; });
      try { sessionStorage.setItem("jd_catimg", JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
      return v;
    },

    /* Approved products for a list of ids, in the order given. */
    async byIds(ids) {
      const list = (ids || []).filter(JD.isUuid);
      if (!list.length) return [];
      const c = await JD.client();
      if (!c) throw unavailable();
      const { data, error } = await c.from("products").select("*").in("id", list).eq("status", "approved");
      if (error) throw error;
      const map = new Map((data || []).map(p => [p.id, p]));
      return attachSellers(list.map(id => map.get(id)).filter(Boolean));
    },

    /* Category and seller counts derived from live approved listings. */
    categoryStats(force) {
      if (statsPromise && !force) return statsPromise;
      statsPromise = (async () => {
        try {
          const cached = JSON.parse(sessionStorage.getItem("jd_stats") || "null");
          if (cached && Date.now() - cached.t < 300000) return cached.v;
        } catch (e) { /* ignore */ }
        const c = await JD.client();
        if (!c) throw unavailable();
        const { data, error } = await c.from("products").select("category_id,seller_id").eq("status", "approved").range(0, 4999);
        if (error) throw error;
        const counts = new Map();
        const sellers = new Set();
        (data || []).forEach(r => {
          if (r.category_id && r.category_id !== "All") counts.set(r.category_id, (counts.get(r.category_id) || 0) + 1);
          if (r.seller_id) sellers.add(r.seller_id);
        });
        const v = {
          categories: [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
          sellers: sellers.size,
          total: (data || []).length
        };
        try { sessionStorage.setItem("jd_stats", JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
        return v;
      })();
      statsPromise.catch(() => { statsPromise = null; });
      return statsPromise;
    },

    async list(sort, limit) {
      const c = await JD.client();
      if (!c) throw unavailable();
      let q = c.from("products").select("*").eq("status", "approved").gt("stock", 0);
      q = applySort(q, sort).limit(limit || 8);
      const { data, error } = await q;
      if (error) throw error;
      return attachSellers(data || []);
    },

    async verifiedSellers(limit) {
      const c = await JD.client();
      if (!c) throw unavailable();
      const { data, error } = await c.from("public_profiles").select("id,business_name,avatar_url,region,is_seller_verified")
        .eq("is_seller_verified", true).not("business_name", "is", null).limit(limit || 8);
      if (error) throw error;
      return data || [];
    },

    /* Server-side filtered, sorted, paginated search. */
    async search(f) {
      const c = await JD.client();
      if (!c) throw unavailable();
      let q = c.from("products").select("*", { count: "exact" }).eq("status", "approved");
      const text = clean(f.q);
      if (text) q = q.or("title.ilike.%" + text + "%,description.ilike.%" + text + "%");
      if (f.category && f.category !== "All") q = q.eq("category_id", f.category);
      if (f.location && f.location !== "all") q = q.ilike("location", "%" + clean(f.location) + "%");
      if (f.condition) q = q.eq("condition", f.condition);
      if (isNum(f.min)) q = q.gte("price", Number(f.min));
      if (isNum(f.max)) q = q.lte("price", Number(f.max));
      if (f.stock) q = q.gt("stock", 0);
      if (f.delivery) q = q.eq("delivery_available", true);
      if (f.seller && JD.isUuid(f.seller)) q = q.eq("seller_id", f.seller);
      const brand = clean(f.brandModel);
      if (brand) q = q.ilike("title", "%" + brand + "%");
      q = applySort(q, f.sort);
      const page = Math.max(1, parseInt(f.page, 10) || 1);
      const from = (page - 1) * PAGE_SIZE;
      const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = await attachSellers(data || []);
      const total = typeof count === "number" ? count : rows.length;
      return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
    },

    /* Everything the product page needs. product is null when not found. */
    async product(id) {
      const c = await JD.client();
      if (!c) throw unavailable();
      const { data: product, error } = await c.from("products").select("*").eq("id", id).eq("status", "approved").maybeSingle();
      if (error) throw error;
      if (!product) return { product: null };
      const [imgs, seller, reviews, related] = await Promise.all([
        c.from("product_images").select("image_url,sort_order").eq("product_id", id).order("sort_order", { ascending: true }),
        c.from("public_profiles").select("id,business_name,first_name,last_name,avatar_url,region,seller_type,is_seller_verified").eq("id", product.seller_id).maybeSingle(),
        c.from("marketplace_reviews").select("rating,title,body,created_at,seller_reply").eq("product_id", id).eq("status", "published").order("created_at", { ascending: false }).limit(50),
        c.from("products").select("*").eq("status", "approved").eq("category_id", product.category_id).neq("id", id).gt("stock", 0).order("created_at", { ascending: false }).limit(6)
      ]);
      const gallery = [product.main_image, ...((imgs.data || []).map(r => r.image_url))].map(JD.safeUrl).filter(Boolean);
      const relatedRows = await attachSellers(related.data || []);
      return {
        product,
        images: [...new Set(gallery)],
        seller: seller.data || null,
        reviews: reviews.error ? [] : (reviews.data || []),
        related: relatedRows
      };
    }
  };
})();
