/* robots.txt built from the request host so the Sitemap line is always absolute.
   Public marketplace pages stay crawlable; private areas, account pages and
   internal-search / filter combinations (which would be a crawl trap) do not. */
export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const lines = [
    "User-agent: *", "Allow: /",
    "Disallow: /admin/", "Disallow: /supplier/", "Disallow: /delivery/", "Disallow: /worker/", "Disallow: /affiliate/",
    "Disallow: /cart", "Disallow: /checkout", "Disallow: /me", "Disallow: /orders", "Disallow: /wishlist", "Disallow: /compare", "Disallow: /saved-searches",
    "Disallow: /login", "Disallow: /signup", "Disallow: /forgot-password", "Disallow: /reset-password", "Disallow: /verify-email",
    "Disallow: /*?*q=", "Disallow: /*?*min=", "Disallow: /*?*max=", "Disallow: /*?*sort=", "Disallow: /*?*condition=", "Disallow: /*?*location=",
    "Disallow: /*?*stock=", "Disallow: /*?*delivery=", "Disallow: /*?*brandModel=", "Disallow: /*?*page=", "Disallow: /*?*preview_banner=",
    "", "Sitemap: " + origin + "/sitemap.xml", ""
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
