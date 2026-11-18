/* Server-rendered product pages for search engines (Cloudflare Pages Function).
   Route: /product?id=<uuid>
   The static product.html is the app shell and the fallback. This function
   reads the approved listing from Supabase over the public REST API (the same
   publishable key the browser uses; row-level security still applies) and
   injects into that shell: title, description, canonical, Open Graph/Twitter
   tags, Product JSON-LD and a readable copy of the listing in #jd-pdp. The
   client script then takes over and re-renders the interactive page.
   Any failure serves the plain static page, never an error. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, cur) => (!cur || cur === "GMD" ? "D" : cur) + " " + Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const httpsUrl = u => (/^https:\/\/[^\s"'<>]+$/.test(String(u || "")) ? String(u) : "");

async function credentials(env, request) {
  if (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) return { url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY };
  try {
    const res = await env.ASSETS.fetch(new URL("/js/config.js", request.url));
    const text = await res.text();
    const u = text.match(/SUPABASE_URL\s*:\s*["']([^"']+)["']/);
    const k = text.match(/SUPABASE_PUBLISHABLE_KEY\s*:\s*["']([^"']+)["']/);
    if (u && k) return { url: u[1], key: k[1] };
  } catch (e) { /* fall through */ }
  return null;
}
async function rest(c, path) {
  const res = await fetch(c.url + "/rest/v1/" + path, { headers: { apikey: c.key, Authorization: "Bearer " + c.key, Accept: "application/json" }, signal: AbortSignal.timeout(3500) });
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
}

export async function onRequestGet({ request, env, next }) {
  const base = await next();
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "";
    if (!base.ok || !UUID.test(id)) return base;
    const c = await credentials(env, request);
    if (!c) return base;

    const cols = "id,title,description,price,currency,condition,location,main_image,stock,seller_id,category_id,attributes,delivery_available,created_at,updated_at";
    const [rows, images] = await Promise.all([
      rest(c, "products?id=eq." + id + "&status=eq.approved&select=" + cols + "&limit=1"),
      rest(c, "product_images?product_id=eq." + id + "&select=image_url,sort_order&order=sort_order.asc&limit=8").catch(() => [])
    ]);

    if (!rows.length) {
      const missing = new HTMLRewriter()
        .on("title", { element(el) { el.setInnerContent("Product not found \u2014 JulaDirect"); } })
        .on("head", { element(el) { el.append('<meta name="robots" content="noindex">', { html: true }); } })
        .transform(base);
      return new Response(missing.body, { status: 404, headers: base.headers });
    }

    const p = rows[0];
    let seller = null;
    try {
      const s = await rest(c, "public_profiles?id=eq." + p.seller_id + "&select=business_name,is_seller_verified,region&limit=1");
      seller = s[0] || null;
    } catch (e) { seller = null; }

    const price = money(p.price, p.currency);
    const title = p.title + " \u2014 JulaDirect";
    const clean = String(p.description || "").replace(/\s+/g, " ").trim();
    const desc = (clean.slice(0, 155) || (p.title + " for " + price + (p.location ? " in " + p.location : "") + ". Pay on delivery on JulaDirect.")).trim();
    const canonical = url.origin + "/product?id=" + id;
    const gallery = [p.main_image].concat((images || []).map(i => i.image_url)).map(httpsUrl).filter(Boolean);
    const image = gallery[0] || "";
    const sellerName = seller && seller.business_name ? seller.business_name : "";

    const ld = {
      "@context": "https://schema.org", "@type": "Product", name: p.title, description: clean.slice(0, 500) || undefined,
      image: gallery.length ? gallery.slice(0, 5) : undefined, category: p.category_id || undefined, itemCondition: undefined,
      offers: { "@type": "Offer", url: canonical, priceCurrency: p.currency || "GMD", price: Number(p.price || 0), availability: Number(p.stock || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", seller: sellerName ? { "@type": "Organization", name: sellerName } : undefined }
    };
    const head =
      '<meta name="robots" content="index, follow, max-image-preview:large">' +
      '<link rel="canonical" href="' + esc(canonical) + '">' +
      '<meta property="og:type" content="product"><meta property="og:site_name" content="JulaDirect">' +
      '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="' + esc(canonical) + '">' +
      (image ? '<meta property="og:image" content="' + esc(image) + '">' : "") +
      '<meta property="product:price:amount" content="' + esc(Number(p.price || 0)) + '"><meta property="product:price:currency" content="' + esc(p.currency || "GMD") + '">' +
      '<meta name="twitter:card" content="' + (image ? "summary_large_image" : "summary") + '"><meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:description" content="' + esc(desc) + '">' +
      '<script type="application/ld+json" id="jd-ld">' + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>";

    const attrs = p.attributes && typeof p.attributes === "object" ? Object.entries(p.attributes).filter(([, v]) => v !== null && typeof v !== "object" && String(v).trim() !== "").slice(0, 12) : [];
    const rows2 = [["Condition", p.condition], ["Category", p.category_id], ["Location", p.location], ["Availability", Number(p.stock || 0) > 0 ? "In stock" : "Out of stock"], ["Delivery", p.delivery_available === true ? "Available" : "Not offered"]]
      .concat(attrs.map(([k, v]) => [String(k).replace(/[_-]+/g, " ").replace(/^./, ch => ch.toUpperCase()), v])).filter(r => r[1]);
    const ssr = '<article class="jd-ssr">' +
      '<nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/explore">Explore</a>' + (p.category_id ? ' / <a href="/explore?category=' + encodeURIComponent(p.category_id) + '">' + esc(p.category_id) + "</a>" : "") + "</nav>" +
      "<h1>" + esc(p.title) + "</h1>" + (image ? '<img src="' + esc(image) + '" alt="' + esc(p.title) + '" width="480" height="480">' : "") +
      "<p><strong>" + esc(price) + "</strong></p>" + (clean ? "<p>" + esc(clean.slice(0, 1200)) + "</p>" : "") +
      "<ul>" + rows2.map(r => "<li><strong>" + esc(r[0]) + ":</strong> " + esc(r[1]) + "</li>").join("") + "</ul>" +
      (sellerName ? "<p>Sold by " + esc(sellerName) + (seller.is_seller_verified ? " (verified seller)" : "") + "</p>" : "") +
      "<p>Pay on delivery is available at checkout.</p></article>";

    const out = new HTMLRewriter()
      .on("title", { element(el) { el.setInnerContent(title); } })
      .on('meta[name="description"]', { element(el) { el.setAttribute("content", desc); } })
      .on("head", { element(el) { el.append(head, { html: true }); } })
      .on("#jd-pdp", { element(el) { el.setInnerContent(ssr, { html: true }); } })
      .transform(base);
    const headers = new Headers(base.headers);
    headers.delete("content-length");
    headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return new Response(out.body, { status: 200, headers });
  } catch (e) {
    return base;
  }
}
