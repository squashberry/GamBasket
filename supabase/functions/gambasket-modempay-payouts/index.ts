
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

async function transferEvent(eventId: string, eventType: string, payload: Record<string, unknown>) {
  return await rpc("gambasket_process_modempay_transfer_event",
    { p_event_id: eventId, p_event_type: eventType, p_payload: payload });
}
async function processPayout(payoutId: string) {
  const rows = await rest("seller_payout_requests?select=id,seller_id,payout_method_id,amount,status,idempotency_key,provider_reference,method:seller_payout_methods(network,account_number,beneficiary_name,verification_status)"
    + "&id=eq." + encodeURIComponent(payoutId) + "&limit=1");
  const payout = rows && rows[0];
  if (!payout) throw new Error("Payout request not found");
  if (payout.status === "succeeded") return { payout_id: payout.id, status: "succeeded", already_processed: true };
  if (!["requested", "processing"].includes(payout.status)) return { payout_id: payout.id, status: payout.status };
  const method = payout.method;
  if (!method || method.verification_status !== "active" || !["wave", "afrimoney"].includes(method.network)) {
    throw new Error("Payout destination is not approved");
  }
  await rest("seller_payout_requests?id=eq." + payout.id + "&status=in.(requested,processing)", {
    method: "PATCH", body: JSON.stringify({ status: "processing", updated_at: new Date().toISOString() })
  });
  const base = (env("MODEMPAY_BASE_URL") || "https://api.modempay.com").replace(/\/$/, "");
  const response = await fetch(base + "/v1/transfers", {
    method: "POST",
    headers: { Authorization: "Bearer " + env("MODEMPAY_API_KEY"), "Content-Type": "application/json",
      "Idempotency-Key": "gambasket-payout-" + payout.id },
    body: JSON.stringify({ amount: Number(payout.amount), currency: "GMD", network: method.network,
      account_number: method.account_number, beneficiary_name: method.beneficiary_name,
      narration: "GamBasket seller withdrawal",
      metadata: { gambasket_payout_id: payout.id, gambasket_seller_id: payout.seller_id } })
  });
  const providerBody = await readJson(response);
  const data = providerBody?.data?.data || providerBody?.data || providerBody;
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      const failed = { ...data, id: data?.id || payout.provider_reference, status: "failed",
        message: safeProviderMessage(providerBody?.message || providerBody?.error),
        metadata: { gambasket_payout_id: payout.id } };
      await transferEvent("submit-failed:" + payout.id, "transfer.failed", failed);
      return { payout_id: payout.id, status: "failed" };
    }
    return { payout_id: payout.id, status: "processing", provider_uncertain: true };
  }
  const transferId = data?.id || data?.transfer_id || data?.transfer_reference || null;
  const status = String(data?.status || "").toLowerCase();
  const payload = { ...data, id: data?.id || transferId, status: status === "completed" ? "succeeded" : status,
    metadata: { ...(data?.metadata || {}), gambasket_payout_id: payout.id } };
  if (["completed", "succeeded"].includes(status)) {
    await transferEvent("submit-succeeded:" + payout.id, "transfer.succeeded", payload);
    return { payout_id: payout.id, status: "succeeded", provider_reference: transferId };
  }
  if (["failed", "reversed"].includes(status)) {
    await transferEvent("submit-" + status + ":" + payout.id, "transfer." + status, payload);
    return { payout_id: payout.id, status };
  }
  if (transferId) await rest("seller_payout_requests?id=eq." + payout.id, {
    method: "PATCH", body: JSON.stringify({ provider_reference: String(transferId), status: "processing", updated_at: new Date().toISOString() })
  });
  return { payout_id: payout.id, status: "processing", provider_reference: transferId };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const action = String(body.action || "process");
    if (action === "run") {
      const supplied = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
        || req.headers.get("x-gambasket-cron-secret") || "";
      if (!env("GAMBASKET_CRON_SECRET") || supplied !== env("GAMBASKET_CRON_SECRET")) {
        return json({ error: "Unauthorized worker" }, 401);
      }
      const released = await rpc("gambasket_release_due_seller_funds", {});
      let queued = 0;
      const enabled = env("MODEMPAY_PAYOUTS_ENABLED") === "true" && env("MODEMPAY_API_KEY") && env("MODEMPAY_WEBHOOK_SECRET");
      if (enabled) {
        queued = await rpc("gambasket_queue_automatic_payouts", {});
        const pending = await rest("seller_payout_requests?select=id&status=eq.requested&order=requested_at.asc&limit=20");
        for (const row of pending || []) {
          try { await processPayout(row.id); }
          catch (error) { console.error("Scheduled payout failed", row.id, safeProviderMessage((error as Error)?.message)); }
        }
      }
      return json({ success: true, seller_releases: released, automatic_payouts_queued: queued });
    }
    const auth = await authenticatedUser(req);
    if (env("MODEMPAY_PAYOUTS_ENABLED") !== "true" || !env("MODEMPAY_API_KEY") || !env("MODEMPAY_WEBHOOK_SECRET")) {
      return json({ success: true, queued: true, status: "requested",
        message: "Withdrawal is reserved and queued until ModemPay payouts are enabled." }, 202);
    }
    const payoutId = String(body.payout_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(payoutId)) return json({ error: "Invalid payout request" }, 400);
    const rows = await rest("seller_payout_requests?select=id,seller_id&id=eq." + encodeURIComponent(payoutId) + "&limit=1");
    if (!rows?.[0] || rows[0].seller_id !== auth.user.id) return json({ error: "Payout request not found for this seller" }, 404);
    return json({ success: true, ...(await processPayout(payoutId)) });
  } catch (error) { return json({ error: safeProviderMessage((error as Error)?.message || error) }, 400); }
});
