
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
    const body = await req.json();
    if (body.action === "request") {
      const result = await rpcAsUser("gambasket_request_order_refund", {
        p_order_id: body.order_id, p_amount: Number(body.amount), p_reason: String(body.reason || ""),
        p_description: body.description ? String(body.description).slice(0, 2000) : null
      }, auth.token);
      return json({ success: true, refund_case_id: result });
    }
    if (body.action !== "review") return json({ error: "Unsupported refund action" }, 400);
    if (env("MODEMPAY_API_KEY") === "" || env("MODEMPAY_CHECKOUT_ENABLED") !== "true") {
      return json({ error: "ModemPay refund processing is not enabled." }, 503);
    }
    const reviewed = await rpcAsUser("admin_review_gambasket_refund_case", {
      p_case_id: body.refund_case_id, p_status: String(body.status || "")
    }, auth.token);
    if (String(body.status) !== "approved") return json({ success: true, review: reviewed });
    const check = await rpc("gambasket_mark_refund_provider_pending", { p_case_id: body.refund_case_id });
    const base = (env("MODEMPAY_BASE_URL") || "https://api.modempay.com").replace(/\/$/, "");
    const response = await fetch(base + "/v1/transactions/refund", {
      method: "POST",
      headers: { Authorization: "Bearer " + env("MODEMPAY_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ reference: check.provider_reference, amount: Number(check.amount) })
    });
    const providerBody = await readJson(response);
    const data = providerBody?.data?.data || providerBody?.data || providerBody;
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        await rpc("gambasket_mark_refund_failed", { p_case_id: body.refund_case_id,
          p_error: safeProviderMessage(providerBody?.message || providerBody?.error) });
        return json({ error: "ModemPay rejected the refund. The case was returned for admin review." }, 502);
      }
      return json({ success: true, pending_reconciliation: true,
        message: "Provider response is uncertain. Do not retry this refund until reconciled." }, 202);
    }
    const status = String(data?.status || "").toLowerCase();
    const succeeded = providerBody?.success === true || data?.success === true
      || ["completed", "succeeded", "refunded"].includes(status);
    if (!succeeded) return json({ success: true, pending_reconciliation: true,
      message: "ModemPay has not confirmed the final refund status." }, 202);
    const result = await rpc("gambasket_finalize_modempay_refund",
      { p_case_id: body.refund_case_id, p_provider_payload: data });
    return json({ success: true, refund: result });
  } catch (error) { return json({ error: safeProviderMessage((error as Error)?.message || error) }, 400); }
});
