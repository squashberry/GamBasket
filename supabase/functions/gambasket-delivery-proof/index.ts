
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
async function otpHash(orderId: string, otp: string) {
  const pepper = env("GAMBASKET_OTP_PEPPER");
  if (!pepper) throw new Error("Delivery code security is not configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "\\x" + hex(new Uint8Array(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(orderId + ":" + otp))));
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = await authenticatedUser(req);
    const body = await req.json();
    const action = String(body.action || "");
    const orderId = String(body.order_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Invalid order" }, 400);
    if (action === "issue") {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      const code = String(bytes[0] % 1000000).padStart(6, "0");
      const hash = await otpHash(orderId, code);
      const result = await rpcAsUser("gambasket_issue_delivery_otp",
        { p_order_id: orderId, p_otp_hash: hash }, auth.token);
      return json({ success: true, code, expires_at: result?.expires_at,
        message: "Give this code to the assigned courier only when they arrive with your order." });
    }
    if (action === "confirm") {
      const code = String(body.otp || "").replace(/\s/g, "");
      if (!/^\d{6}$/.test(code)) return json({ error: "Enter the six-digit buyer delivery code." }, 400);
      const hash = await otpHash(orderId, code);
      const result = await rpcAsUser("gambasket_confirm_delivery_with_otp",
        { p_order_id: orderId, p_otp_hash: hash }, auth.token);
      if (!result?.success) return json({ error: result?.error || "Delivery confirmation failed.",
        attempts_remaining: result?.attempts_remaining }, 400);
      return json(result);
    }
    return json({ error: "Unsupported delivery proof action" }, 400);
  } catch (error) { return json({ error: safeProviderMessage((error as Error)?.message || error) }, 400); }
});
