/* Live sitemap: key pages, every category and every approved product.
   Route: /sitemap.xml (Cloudflare Pages Function). Reads Supabase's public
   REST API with the publishable key; if Supabase is unreachable it still
   returns the static pages so the sitemap never errors. */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

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

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const entries = [["/", null, "daily", "1.0"], ["/explore", null, "hourly", "0.9"]];
  ["/how-it-works", "/about", "/help", "/customer-care", "/security", "/privacy"].forEach(p => entries.push([p, null, "monthly", "0.4"]));

  try {
    const c = await credentials(env, request);
    if (c) {
      const res = await fetch(c.url + "/rest/v1/products?status=eq.approved&select=id,category_id,created_at,updated_at&order=updated_at.desc&limit=5000", {
        headers: { apikey: c.key, Authorization: "Bearer " + c.key, Accept: "application/json" }, signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const rows = await res.json();
        const cats = new Set();
        rows.forEach(r => { if (r.category_id && r.category_id !== "All") cats.add(r.category_id); });
        [...cats].sort().forEach(cat => entries.push(["/explore?category=" + encodeURIComponent(cat), null, "daily", "0.7"]));
        rows.forEach(r => entries.push(["/product?id=" + r.id, r.updated_at || r.created_at || null, "weekly", "0.8"]));
      }
    }
  } catch (e) { /* static entries only */ }

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.slice(0, 50000).map(([path, mod, freq, pri]) => "  <url><loc>" + esc(origin + path) + "</loc>" + (mod ? "<lastmod>" + esc(new Date(mod).toISOString()) + "</lastmod>" : "") + "<changefreq>" + freq + "</changefreq><priority>" + pri + "</priority></url>").join("\n") + "\n</urlset>\n";
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" } });
}
