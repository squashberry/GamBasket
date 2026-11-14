
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

const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function signBody(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))));
}
async function sha256(text: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const secret = env("MODEMPAY_WEBHOOK_SECRET");
    if (!secret) return json({ error: "Webhook secret is not configured" }, 503);
    const raw = await req.text();
    const signature = (req.headers.get("x-modem-signature") || "").replace(/^sha512=/i, "").trim().toLowerCase();
    const expected = await signBody(secret, raw);
    if (!signature || !constantTimeEqual(signature, expected)) return json({ error: "Invalid ModemPay signature" }, 401);
    const envelope = JSON.parse(raw);
    const eventType = String(envelope?.event || envelope?.type || "").toLowerCase();
    const payload = envelope?.payload || envelope?.data || {};
    if (!eventType || !payload || typeof payload !== "object") return json({ error: "Invalid webhook event" }, 400);
    const baseId = payload.event_id || payload.id || payload.transfer_id || payload.transaction_reference
      || payload.payment_intent_id || await sha256(raw);
    const eventId = (eventType + ":" + String(baseId)).slice(0, 240);
    let result: any;
    if (eventType.startsWith("charge.") || eventType.startsWith("payment.")) {
      result = await rpc("gambasket_process_modempay_charge",
        { p_event_id: eventId, p_event_type: eventType, p_payload: payload });
    } else if (eventType.startsWith("transfer.") || eventType.startsWith("payout.")) {
      result = await rpc("gambasket_process_modempay_transfer_event",
        { p_event_id: eventId, p_event_type: eventType, p_payload: payload });
    } else {
      return json({ received: true, ignored: true, event: eventType });
    }
    if (result?.success === false) return json({ received: true, processed: false, result }, 202);
    return json({ received: true, processed: true, result });
  } catch (error) {
    return json({ error: safeProviderMessage((error as Error)?.message || error) }, 500);
  }
});
