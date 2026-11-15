const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};
const SUPABASE_PROJECT_URL = "https://iwxcepbwmnnkxocskopx.supabase.co";
const PRO_AUTH_URL = "https://facbnnzcqbbevicmilew.supabase.co";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
const env = (name: string) => Deno.env.get(name) || "";
function serviceKey(): string {
  const direct = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  if (direct) return direct;
  const raw = env("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.default || Object.values(parsed)[0] || "";
    } catch { return raw; }
  }
  return "";
}
const supabaseUrl = () => (env("SUPABASE_URL") || SUPABASE_PROJECT_URL).replace(/\/$/, "");
async function readJson(response: Response): Promise<any> {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return { raw: raw.slice(0, 300) }; }
}
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const key = serviceKey();
  if (!key) throw new Error("JulaDirect database credentials are not configured.");
  const response = await fetch(supabaseUrl() + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error("JulaDirect database request failed (" + response.status + "): " +
      String(data?.message || data?.hint || "database error").slice(0, 220));
  }
  return data;
}
async function authenticatedJulaUser(token: string): Promise<{ user: any; token: string }> {
  if (!token) throw new Error("JulaDirect sign-in is required.");
  const key = serviceKey();
  const response = await fetch(supabaseUrl() + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + token }
  });
  const data = await readJson(response);
  if (!response.ok || !data?.id) throw new Error("Your JulaDirect session is invalid or has expired.");
  return { user: data, token, apikey: publicKey };
}
async function authenticatedProUser(input: any): Promise<any> {
  const token = String(input?.pro_access_token || "");
  const publicKey = String(input?.pro_apikey || "");
  if (!token || !publicKey || publicKey.length > 700) {
    throw new Error("Sign in to SquashberryPro to continue.");
  }
  const response = await fetch(PRO_AUTH_URL + "/auth/v1/user", {
    headers: { apikey: publicKey, Authorization: "Bearer " + token }
  });
  const data = await readJson(response);
  if (!response.ok || !data?.id) {
    throw new Error("Your SquashberryPro session is invalid or has expired.");
  }
  return { user: data, token, apikey: publicKey };
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function uuid(value: unknown): string {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}
function safeString(value: unknown, max = 160): string {
  return String(value ?? "").trim().slice(0, max);
}
function digits(value: unknown): string {
  return String(value ?? "").replace(/[^\d]/g, "").slice(0, 20);
}
function parseCart(value: unknown): Array<{ product_id: string; quantity: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) {
    throw new Error("Your basket must contain between 1 and 25 products.");
  }
  const seen = new Set<string>();
  return value.map((line: any) => {
    const productId = uuid(line?.product_id);
    const quantity = Number(line?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || seen.has(productId)) {
      throw new Error("One of the basket items is invalid. Update your basket and try again.");
    }
    seen.add(productId);
    return { product_id: productId, quantity };
  });
}
async function verifyProPublication(
  pro: { user: any; token: string; apikey: string },
  siteId: string,
  expectedSlug?: string,
  requirePublished = true
): Promise<any> {
  if (!uuid(siteId)) throw new Error("Invalid SquashberryPro website reference.");
  const url = PRO_AUTH_URL + "/rest/v1/pro_site_publications?select=project_id,owner_user_id,slug,site_name,status&project_id=eq." +
    encodeURIComponent(siteId) + "&owner_user_id=eq." + encodeURIComponent(pro.user.id) + "&limit=1";
  const response = await fetch(url, {
    headers: { apikey: pro.apikey, Authorization: "Bearer " + pro.token }
  });
  const rows = await readJson(response);
  if (!response.ok || !Array.isArray(rows)) {
    throw new Error("SquashberryPro could not verify this website's owner and publication status.");
  }
  if (!rows.length || rows[0].owner_user_id !== pro.user.id) {
    throw new Error("This website does not belong to the connected SquashberryPro account.");
  }
  if (requirePublished && rows[0].status !== "published") {
    throw new Error("Publish the SquashberryPro website before connecting its JulaDirect store.");
  }
  if (expectedSlug && rows[0].slug !== expectedSlug) {
    throw new Error("The submitted website address does not match the published SquashberryPro site.");
  }
  return rows[0];
}
async function sellerProfile(sellerId: string): Promise<any> {
  const rows = await rest("seller_profiles?select=user_id,business_name,whatsapp,phone,is_active,verification_status,logo_url&user_id=eq." +
    encodeURIComponent(sellerId) + "&limit=1");
  if (!rows?.length || rows[0].is_active === false) throw new Error("An active JulaDirect seller profile is required.");
  return rows[0];
}
async function connectionForPro(proUserId: string): Promise<any> {
  const rows = await rest("juladirect_store_connections?select=seller_user_id,pro_user_id,status&pro_user_id=eq." +
    encodeURIComponent(proUserId) + "&status=eq.active&limit=1");
  if (!rows?.length) throw new Error("Connect your JulaDirect seller account before using this store feature.");
  return rows[0];
}
async function siteById(siteId: string, requirePublished = true): Promise<any> {
  if (!siteId || siteId.length > 128) throw new Error("Invalid website reference.");
  const rows = await rest("juladirect_store_sites?select=site_id,pro_user_id,seller_user_id,site_slug,site_name,public_url,is_published,product_ids,jula_checkout_enabled,whatsapp_checkout_enabled,whatsapp_number&site_id=eq." +
    encodeURIComponent(siteId) + (requirePublished ? "&is_published=eq.true" : "") + "&limit=1");
  if (!rows?.length) throw new Error("This connected store website is not published or is no longer available.");
  return rows[0];
}
async function productsForSeller(sellerId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  return await rest("products?select=id,title,description,price,currency,stock,main_image,category_id,location,status,created_at&seller_id=eq." +
    encodeURIComponent(sellerId) + "&status=eq.approved&currency=eq.GMD&id=in.(" + ids.join(",") + ")&limit=200");
}
async function rpcAsUser(name: string, args: Record<string, unknown>, token: string): Promise<any> {
  const key = serviceKey();
  const response = await fetch(supabaseUrl() + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data?.message || data?.hint || "JulaDirect could not create the order.");
  return data;
}
async function getCheckoutSession(token: string): Promise<any> {
  if (!token || token.length < 40 || token.length > 100) throw new Error("This checkout link is invalid.");
  const hash = await sha256(token);
  const rows = await rest("juladirect_store_checkout_sessions?select=id,site_id,cart,buyer_id,order_id,status,expires_at&token_hash=eq." +
    hash + "&limit=1");
  if (!rows?.length) throw new Error("This checkout link has expired or has already been used.");
  const session = rows[0];
  if (new Date(session.expires_at).getTime() <= Date.now() && !session.order_id) {
    await rest("juladirect_store_checkout_sessions?id=eq." + session.id, {
      method: "PATCH", body: JSON.stringify({ status: "expired", updated_at: new Date().toISOString() })
    });
    throw new Error("This checkout link has expired. Return to the store and start checkout again.");
  }
  return session;
}
async function getProductsForSession(session: any): Promise<{ site: any; seller: any; products: any[] }> {
  const site = await siteById(session.site_id, true);
  const seller = await sellerProfile(site.seller_user_id);
  const cart = parseCart(session.cart);
  const selected = new Set((site.product_ids || []).map(String));
  if (cart.some((line) => !selected.has(line.product_id))) throw new Error("A basket product is no longer enabled by this store.");
  const products = await productsForSeller(site.seller_user_id, cart.map((line) => line.product_id));
  if (products.length !== cart.length) throw new Error("A basket product is no longer available on JulaDirect.");
  return { site, seller, products };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const input = await req.json();
    const action = safeString(input?.action, 40);
    const authHeader = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

    if (action === "start_link") {
      const auth = await authenticatedJulaUser(authHeader);
      const seller = await sellerProfile(auth.user.id);
      const current = await rest("juladirect_store_connections?select=seller_user_id,pro_user_id,status&seller_user_id=eq." +
        encodeURIComponent(auth.user.id) + "&limit=1");
      if (current?.[0]?.status === "active" && current[0].pro_user_id) {
        return json({ error: "This JulaDirect seller account is already connected to SquashberryPro." }, 409);
      }
      const code = randomToken();
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const row = {
        seller_user_id: auth.user.id,
        status: "pending",
        link_code_hash: await sha256(code),
        link_expires_at: expires,
        updated_at: new Date().toISOString()
      };
      if (current?.length) {
        await rest("juladirect_store_connections?seller_user_id=eq." + encodeURIComponent(auth.user.id), {
          method: "PATCH", body: JSON.stringify(row)
        });
      } else {
        await rest("juladirect_store_connections", {
          method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row)
        });
      }
      const url = "https://squashberrypro.pages.dev/integrations/juladirect?link_code=" + encodeURIComponent(code);
      return json({ success: true, link_code: code, expires_at: expires, connect_url: url, seller_name: seller.business_name || "Your JulaDirect store" });
    }

    if (action === "complete_link") {
      const pro = await authenticatedProUser(input);
      const code = safeString(input?.link_code, 100);
      if (code.length < 40) return json({ error: "The account-link code is invalid." }, 400);
      const hash = await sha256(code);
      const rows = await rest("juladirect_store_connections?select=seller_user_id,pro_user_id,status,link_expires_at&link_code_hash=eq." +
        hash + "&status=eq.pending&limit=1");
      if (!rows?.length || !rows[0].link_expires_at || new Date(rows[0].link_expires_at).getTime() <= Date.now()) {
        return json({ error: "This connection code has expired or was already used. Start again from JulaDirect." }, 410);
      }
      const link = rows[0];
      const existingPro = await rest("juladirect_store_connections?select=seller_user_id&pro_user_id=eq." +
        encodeURIComponent(pro.user.id) + "&status=eq.active&limit=1");
      if (existingPro?.length && existingPro[0].seller_user_id !== link.seller_user_id) {
        return json({ error: "This SquashberryPro account is already linked to another JulaDirect seller." }, 409);
      }
      const existingSeller = await rest("juladirect_store_connections?select=pro_user_id&seller_user_id=eq." +
        encodeURIComponent(link.seller_user_id) + "&status=eq.active&limit=1");
      if (existingSeller?.length && existingSeller[0].pro_user_id && existingSeller[0].pro_user_id !== pro.user.id) {
        return json({ error: "This JulaDirect seller account is already linked to another SquashberryPro account." }, 409);
      }
      const consumed = await rest("juladirect_store_connections?seller_user_id=eq." + encodeURIComponent(link.seller_user_id) +
        "&link_code_hash=eq." + hash + "&status=eq.pending&link_expires_at=gt." + encodeURIComponent(new Date().toISOString()), {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            pro_user_id: pro.user.id, status: "active", link_code_hash: null,
            link_expires_at: null, updated_at: new Date().toISOString()
          })
        });
      if (!consumed?.length) {
        return json({ error: "This connection code has expired or was already used. Start again from JulaDirect." }, 410);
      }
      const seller = await sellerProfile(link.seller_user_id);
      return json({ success: true, connected: true, seller: { business_name: seller.business_name || "JulaDirect seller", whatsapp: seller.whatsapp || seller.phone || "" } });
    }

    if (action === "seller_status") {
      const auth = await authenticatedJulaUser(authHeader);
      const rows = await rest("juladirect_store_connections?select=seller_user_id,pro_user_id,status&seller_user_id=eq." +
        encodeURIComponent(auth.user.id) + "&limit=1");
      const link = rows?.[0];
      if (!link || link.status !== "active" || !link.pro_user_id) return json({ connected: false, published_site: null });
      const seller = await sellerProfile(auth.user.id);
      const sites = await rest("juladirect_store_sites?select=site_id,site_slug,site_name,public_url,is_published,updated_at&seller_user_id=eq." +
        encodeURIComponent(auth.user.id) + "&is_published=eq.true&order=updated_at.desc&limit=1");
      return json({ connected: true, seller_name: seller.business_name || "JulaDirect seller", published_site: sites?.[0] || null });
    }

    if (action === "pro_status") {
      const pro = await authenticatedProUser(input);
      const link = await connectionForPro(pro.user.id);
      const seller = await sellerProfile(link.seller_user_id);
      const sites = await rest("juladirect_store_sites?select=site_id,site_slug,site_name,public_url,is_published,product_ids,jula_checkout_enabled,whatsapp_checkout_enabled,whatsapp_number&pro_user_id=eq." +
        encodeURIComponent(pro.user.id) + "&order=updated_at.desc&limit=20");
      return json({
        connected: true,
        seller: { user_id: link.seller_user_id, business_name: seller.business_name || "JulaDirect seller", whatsapp: seller.whatsapp || seller.phone || "" },
        sites: sites || []
      });
    }

    if (action === "list_products") {
      const pro = await authenticatedProUser(input);
      const link = await connectionForPro(pro.user.id);
      const seller = await sellerProfile(link.seller_user_id);
      const products = await rest("products?select=id,title,description,price,currency,stock,main_image,category_id,location,status,created_at&seller_id=eq." +
        encodeURIComponent(link.seller_user_id) + "&status=eq.approved&currency=eq.GMD&order=created_at.desc&limit=200");
      return json({
        connected: true,
        seller: { business_name: seller.business_name || "JulaDirect seller", whatsapp: seller.whatsapp || seller.phone || "" },
        products: products || []
      });
    }

    if (action === "register_site") {
      const pro = await authenticatedProUser(input);
      const link = await connectionForPro(pro.user.id);
      const siteId = safeString(input?.site_id, 128);
      const slug = safeString(input?.site_slug, 64).toLowerCase();
      const name = safeString(input?.site_name, 120) || "Store website";
      const publicUrl = safeString(input?.public_url, 500);
      const productIds = Array.isArray(input?.product_ids) ? [...new Set(input.product_ids.map(uuid).filter(Boolean))] : [];
      const julaEnabled = input?.jula_checkout_enabled === true;
      const whatsappEnabled = input?.whatsapp_checkout_enabled === true;
      const whatsapp = digits(input?.whatsapp_number);
      if (!siteId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^https:\/\/squashberrypro\.pages\.dev\//.test(publicUrl)) {
        return json({ error: "The published website details are incomplete or invalid." }, 400);
      }
      const verifiedSite = await verifyProPublication(pro, siteId, slug, true);
      if (verifiedSite.site_name !== name) {
        return json({ error: "The website name does not match the published SquashberryPro website." }, 409);
      }
      if (productIds.length > 200) return json({ error: "This store has too many imported products." }, 400);
      if (productIds.length && !julaEnabled && !whatsappEnabled) {
        return json({ error: "Enable JulaDirect checkout or WhatsApp checkout before publishing this product store." }, 400);
      }
      if (whatsappEnabled && whatsapp.length < 7) return json({ error: "Add a valid WhatsApp number before enabling WhatsApp checkout." }, 400);
      if ((julaEnabled || whatsappEnabled) && !productIds.length) {
        return json({ error: "Import at least one JulaDirect product before enabling store checkout." }, 400);
      }
      if (productIds.length) {
        const owned = await productsForSeller(link.seller_user_id, productIds);
        if (owned.length !== productIds.length) return json({ error: "One or more imported products no longer belong to this seller or are not approved in JulaDirect." }, 409);
      }
      const row = {
        site_id: siteId, pro_user_id: pro.user.id, seller_user_id: link.seller_user_id,
        site_slug: slug, site_name: name, public_url: publicUrl, is_published: true,
        product_ids: productIds, jula_checkout_enabled: julaEnabled,
        whatsapp_checkout_enabled: whatsappEnabled, whatsapp_number: whatsapp || null,
        updated_at: new Date().toISOString()
      };
      await rest("juladirect_store_sites?on_conflict=site_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row)
      });
      return json({ success: true, site_id: siteId, public_url: publicUrl });
    }

    if (action === "unpublish_site") {
      const pro = await authenticatedProUser(input);
      const link = await connectionForPro(pro.user.id);
      const siteId = safeString(input?.site_id, 128);
      await verifyProPublication(pro, siteId, undefined, false);
      await rest("juladirect_store_sites?site_id=eq." + encodeURIComponent(siteId) +
        "&pro_user_id=eq." + encodeURIComponent(pro.user.id) +
        "&seller_user_id=eq." + encodeURIComponent(link.seller_user_id), {
          method: "PATCH", body: JSON.stringify({ is_published: false, updated_at: new Date().toISOString() })
        });
      return json({ success: true });
    }

    if (action === "public_products") {
      const site = await siteById(safeString(input?.site_id, 128), true);
      const ids = (site.product_ids || []).map(String);
      const products = await productsForSeller(site.seller_user_id, ids);
      return json({
        site_name: site.site_name,
        currency: "GMD",
        products: products.map((p: any) => ({ ...p, available: p.status === "approved" && Number(p.stock) > 0 }))
      });
    }

    if (action === "prepare_checkout") {
      const site = await siteById(safeString(input?.site_id, 128), true);
      if (!site.jula_checkout_enabled) return json({ error: "JulaDirect checkout is not enabled for this store." }, 403);
      const cart = parseCart(input?.items);
      const selected = new Set((site.product_ids || []).map(String));
      if (cart.some((line) => !selected.has(line.product_id))) return json({ error: "Your basket contains a product that this store has not selected." }, 400);
      const products = await productsForSeller(site.seller_user_id, cart.map((line) => line.product_id));
      if (products.length !== cart.length) return json({ error: "A product is no longer available. Refresh the store and try again." }, 409);
      const byId = new Map(products.map((p: any) => [p.id, p]));
      for (const line of cart) {
        const p: any = byId.get(line.product_id);
        if (!p || Number(p.stock) < line.quantity || Number(p.price) <= 0 || p.currency !== "GMD") {
          return json({ error: "Stock or price changed for one of the products. Refresh your basket and try again." }, 409);
        }
      }
      const token = randomToken();
      const sessionRows = await rest("juladirect_store_checkout_sessions?select=id", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          site_id: site.site_id, token_hash: await sha256(token), cart, status: "pending",
          expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
        })
      });
      if (!sessionRows?.[0]?.id) throw new Error("A secure checkout session could not be created.");
      return json({
        success: true,
        checkout_url: "https://juladirect.pages.dev/store-checkout.html?session=" + encodeURIComponent(token),
        expires_in_seconds: 1200
      });
    }

    if (action === "checkout_details") {
      const session = await getCheckoutSession(safeString(input?.session_token, 100));
      const details = await getProductsForSession(session);
      const cart = parseCart(session.cart);
      const byId = new Map(details.products.map((p: any) => [p.id, p]));
      return json({
        site_name: details.site.site_name,
        seller_name: details.seller.business_name || details.site.site_name,
        store_url: details.site.public_url,
        currency: "GMD",
        items: cart.map((line) => {
          const p: any = byId.get(line.product_id);
          return { product_id: p.id, title: p.title, price: Number(p.price), quantity: line.quantity, stock: Number(p.stock), image: p.main_image };
        })
      });
    }

    if (action === "checkout_config") {
      const enabled = env("MODEMPAY_CHECKOUT_ENABLED") === "true" &&
        Boolean(env("MODEMPAY_API_KEY")) && Boolean(env("MODEMPAY_WEBHOOK_SECRET"));
      return json({ checkout_enabled: enabled, payment_methods: enabled ? ["wave", "qmoney", "afrimoney"] : [] });
    }

    if (action === "complete_checkout") {
      const auth = await authenticatedJulaUser(authHeader);
      const session = await getCheckoutSession(safeString(input?.session_token, 100));
      const method = safeString(input?.payment_method, 20).toLowerCase();
      if (!["wave", "qmoney", "afrimoney"].includes(method)) {
        return json({ error: "Choose Wave, QMoney or Afrimoney to pay." }, 400);
      }
      if (session.buyer_id && session.buyer_id !== auth.user.id) {
        return json({ error: "This checkout session belongs to another buyer." }, 403);
      }
      let orderId = session.order_id ? String(session.order_id) : "";
      if (!orderId) {
        if (session.status === "processing") {
          return json({ error: "This order is already being submitted. Refresh the page before trying again." }, 409);
        }
        if (session.status !== "pending") return json({ error: "This checkout session is no longer available." }, 409);
        const claim = await rest("juladirect_store_checkout_sessions?id=eq." + session.id +
          "&status=eq.pending&order_id=is.null", {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ status: "processing", buyer_id: auth.user.id, updated_at: new Date().toISOString() })
          });
        if (!claim?.length) return json({ error: "This checkout session is already being processed. Refresh and try again." }, 409);
        try {
          const cart = parseCart(session.cart);
          const order = await rpcAsUser("create_order", {
            p_items: cart,
            p_fulfillment_type: input?.fulfillment_type === "pickup" ? "pickup" : "delivery",
            p_delivery_address: input?.fulfillment_type === "pickup" ? null : safeString(input?.delivery_address, 500),
            p_delivery_region: input?.fulfillment_type === "pickup" ? null : safeString(input?.delivery_region, 100),
            p_delivery_area: input?.fulfillment_type === "pickup" ? null : safeString(input?.delivery_area, 100),
            p_delivery_phone: digits(input?.delivery_phone),
            p_delivery_instructions: input?.fulfillment_type === "pickup" ? null : safeString(input?.delivery_instructions, 500),
            p_payment_method: method,
            p_coupon_code: null
          }, auth.token);
          orderId = String(order?.id || "");
          if (!uuid(orderId)) throw new Error("JulaDirect did not return a valid order reference.");
          await rest("juladirect_store_checkout_sessions?id=eq." + session.id, {
            method: "PATCH",
            body: JSON.stringify({ status: "ordered", order_id: orderId, updated_at: new Date().toISOString() })
          });
        } catch (error) {
          await rest("juladirect_store_checkout_sessions?id=eq." + session.id + "&order_id=is.null", {
            method: "PATCH",
            body: JSON.stringify({ status: "pending", buyer_id: null, updated_at: new Date().toISOString() })
          }).catch(() => null);
          throw error;
        }
      }
      const paymentResponse = await fetch(supabaseUrl() + "/functions/v1/gambasket-modempay-checkout", {
        method: "POST",
        headers: {
          apikey: serviceKey(),
          Authorization: "Bearer " + auth.token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ order_id: orderId, payment_method: method, idempotency_key: crypto.randomUUID() })
      });
      const paymentData = await readJson(paymentResponse);
      if (!paymentResponse.ok || !paymentData?.payment_url) {
        return json({ error: paymentData?.error || "JulaDirect could not open ModemPay checkout. Your order remains unpaid and can be retried from this page." }, 502);
      }
      return json({ success: true, order_id: orderId, order_number: paymentData.order_number, payment_url: paymentData.payment_url });
    }

    return json({ error: "Unknown integration action." }, 400);
  } catch (error) {
    const message = String((error as Error)?.message || "The JulaDirect store integration could not complete this request.");
    const status = /sign in|session is invalid/i.test(message) ? 401 :
      /already connected|already linked|belongs to another/i.test(message) ? 409 :
      /expired|already been used/i.test(message) ? 410 :
      /not available|not published|not enabled/i.test(message) ? 409 : 400;
    return json({ error: message.slice(0, 450) }, status);
  }
});
