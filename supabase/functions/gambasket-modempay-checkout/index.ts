
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://squashberry.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-modem-signature, x-gambasket-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
const supabaseUrl = () => env("SUPABASE_URL").replace(/\/$/, "");
async function readJson(response: Response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : {}; } catch { return { raw: raw.slice(0, 500) }; }
}
async function rest(path: string, init: RequestInit = {}) {
  const key = serviceKey();
  if (!key) throw new Error("Supabase service credentials are not configured");
  const response = await fetch(supabaseUrl() + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error("Database request failed (" + response.status + "): " + JSON.stringify(data).slice(0, 400));
  return data;
}
async function rpc(name: string, args: Record<string, unknown>) {
  return await rest("rpc/" + name, { method: "POST", body: JSON.stringify(args) });
}
async function rpcAsUser(name: string, args: Record<string, unknown>, token: string) {
  const key = serviceKey();
  const response = await fetch(supabaseUrl() + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data?.message || data?.hint || ("Request failed (" + response.status + ")"));
  return data;
}
async function authenticatedUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Authentication required");
  const key = serviceKey();
  const response = await fetch(supabaseUrl() + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + token }
  });
  const data = await readJson(response);
  if (!response.ok || !data?.id) throw new Error("Invalid or expired session");
  return { user: data, token };
}
function safeProviderMessage(value: unknown) {
  return String(value || "Provider request failed")
    .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = await authenticatedUser(req);
    const user = auth.user;
    if (env("MODEMPAY_CHECKOUT_ENABLED") !== "true" || !env("MODEMPAY_API_KEY") || !env("MODEMPAY_WEBHOOK_SECRET")) {
      return json({ error: "Online checkout is not enabled for this GamBasket account yet." }, 503);
    }
    const input = await req.json();
    const orderId = String(input.order_id || "");
    const method = String(input.payment_method || "").toLowerCase();
    const idempotency = String(input.idempotency_key || "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !["wave", "qmoney", "afrimoney"].includes(method)
        || idempotency.length < 12 || idempotency.length > 128) {
      return json({ error: "Invalid order, payment method or idempotency key." }, 400);
    }
    const orderRows = await rest("orders?select=id,order_number,buyer_id,seller_id,total,currency,payment_status,payment_method,order_status"
      + "&id=eq." + encodeURIComponent(orderId) + "&buyer_id=eq." + encodeURIComponent(user.id) + "&limit=1");
    const order = orderRows && orderRows[0];
    if (!order) return json({ error: "Order not found for this customer." }, 404);
    if (order.currency !== "GMD" || Number(order.total) <= 0
        || !["pending", "failed"].includes(order.payment_status) || order.order_status === "cancelled") {
      return json({ error: "This order is not eligible for online payment." }, 409);
    }
    const prior = await rest("gambasket_payments?select=id,status,metadata,provider_payload,provider_intent_id"
      + "&order_id=eq." + orderId + "&status=in.(created,pending)&limit=1");
    let paymentId: string | null = null;
    if (prior && prior.length) {
      const p = prior[0];
      if (p.metadata?.payment_method !== method) return json({ error: "A different online payment is already open for this order." }, 409);
      const existingLink = p.provider_payload?.payment_link;
      if (existingLink && p.status === "pending") return json({ success: true, payment_url: existingLink, payment_id: p.id, reused: true });
      if (p.status !== "created") return json({ error: "ModemPay has not confirmed the result of the previous attempt. Contact support before retrying." }, 409);
      // Reuse the same local ID so the provider Idempotency-Key is stable if the
      // first request timed out after ModemPay may already have created the intent.
      paymentId = p.id;
    } else {
      const inserted = await rest("gambasket_payments?select=id", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          order_id: order.id, buyer_id: user.id, provider: "modempay", idempotency_key: idempotency,
          amount: Number(order.total), currency: "GMD", status: "created",
          metadata: { payment_method: method, source: "gambasket_checkout" }
        })
      });
      paymentId = inserted && inserted[0]?.id;
    }
    if (!paymentId) throw new Error("Payment record could not be created.");
    const returnUrl = "https://squashberry.github.io/GamBasket/orders.html?payment_return=1&order="
      + encodeURIComponent(order.order_number);
    const base = (env("MODEMPAY_BASE_URL") || "https://api.modempay.com").replace(/\/$/, "");
    const providerResponse = await fetch(base + "/v1/payments", {
      method: "POST",
      headers: { Authorization: "Bearer " + env("MODEMPAY_API_KEY"), "Content-Type": "application/json",
        "Idempotency-Key": "gambasket-payment-" + paymentId },
      body: JSON.stringify({ data: {
        amount: Number(order.total), currency: "GMD", title: "GamBasket order " + order.order_number,
        description: "Secure payment for your GamBasket order", payment_methods: [method],
        metadata: { gambasket_payment_id: paymentId, gambasket_order_id: order.id },
        return_url: returnUrl, cancel_url: returnUrl, from_sdk: false
      } })
    });
    const providerBody = await readJson(providerResponse);
    const data = providerBody?.data?.data || providerBody?.data || providerBody;
    if (!providerResponse.ok) {
      await rest("gambasket_payments?id=eq." + paymentId, {
        method: "PATCH", body: JSON.stringify({ status: "failed",
          provider_payload: { error: safeProviderMessage(providerBody?.message || providerBody?.error) },
          updated_at: new Date().toISOString() })
      });
      return json({ error: "ModemPay could not create the payment request. Your order remains unpaid." }, 502);
    }
    const paymentUrl = String(data?.payment_link || data?.checkout_url || "");
    if (!/^https:\/\//i.test(paymentUrl) || !/modempay\.com\//i.test(paymentUrl)) {
      await rest("gambasket_payments?id=eq." + paymentId, {
        method: "PATCH", body: JSON.stringify({ status: "pending",
          provider_intent_id: data?.id || data?.payment_intent_id || null,
          provider_payload: { provider_status: data?.status || "pending", response_received: true },
          updated_at: new Date().toISOString() })
      });
      return json({ error: "ModemPay did not return a valid hosted checkout URL. Contact support with your order number." }, 502);
    }
    const intentId = data?.id || data?.payment_intent_id || data?.intent_id || null;
    await rest("gambasket_payments?id=eq." + paymentId + "&status=eq.created", {
      method: "PATCH", body: JSON.stringify({ status: "pending", provider_intent_id: intentId,
        provider_payload: { payment_link: paymentUrl, provider_status: data?.status || "pending", expires_at: data?.expires_at || null },
        updated_at: new Date().toISOString() })
    });
    await rest("orders?id=eq." + orderId + "&buyer_id=eq." + encodeURIComponent(user.id), {
      method: "PATCH", body: JSON.stringify({ payment_method: method, payment_status: "pending", updated_at: new Date().toISOString() })
    });
    return json({ success: true, payment_url: paymentUrl, payment_id: paymentId, order_number: order.order_number });
  } catch (error) {
    return json({ error: safeProviderMessage((error as Error)?.message || error) }, 400);
  }
});
