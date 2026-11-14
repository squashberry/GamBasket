const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const env = (name: string) => Deno.env.get(name) || "";
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supplied = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRole || !constantTimeEqual(supplied, serviceRole)) return json({ error: "Unauthorized" }, 401);

  const apiKey = env("MODEMPAY_API_KEY");
  if (!apiKey) return json({ ok: false, error: "ModemPay API key is not configured" }, 503);
  const mode = apiKey.startsWith("sk_live_") ? "live" : apiKey.startsWith("sk_test_") ? "test" : "unrecognized";
  const base = (env("MODEMPAY_BASE_URL") || "https://api.modempay.com").replace(/\/$/, "");
  try {
    const response = await fetch(base + "/v1/balances", {
      method: "GET",
      headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    let payload: any = null;
    try { payload = await response.json(); } catch { payload = null; }
    const data = payload?.data || payload;
    const hasBalanceShape = !!data && typeof data === "object" &&
      ("available_balance" in data || "payout_balance" in data);
    return json({
      ok: response.ok && hasBalanceShape,
      authenticated: response.ok,
      key_mode: mode,
      provider_http_status: response.status,
      balance_endpoint_shape_valid: hasBalanceShape,
      provider: "ModemPay"
    }, response.ok ? 200 : 502);
  } catch {
    return json({ ok: false, authenticated: false, key_mode: mode, error: "ModemPay balance verification request failed" }, 502);
  }
});
