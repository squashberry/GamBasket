import { readFile } from "node:fs/promises";

const configSource = await readFile(new URL("../js/config.js", import.meta.url), "utf8");
const urlMatch = configSource.match(/SUPABASE_URL\s*:\s*["']([^"']+)["']/);
const keyMatch = configSource.match(/SUPABASE_PUBLISHABLE_KEY\s*:\s*["']([^"']+)["']/);

if (!urlMatch || !keyMatch) {
  throw new Error("Could not find the public Supabase URL and publishable key in js/config.js.");
}

const supabaseUrl = urlMatch[1].replace(/\/$/, "");
const publishableKey = keyMatch[1];
if (!supabaseUrl.startsWith("https://") || !supabaseUrl.endsWith(".supabase.co")) {
  throw new Error("The live contract suite only permits the configured HTTPS Supabase project host.");
}
if (!publishableKey.startsWith("sb_publishable_")) {
  throw new Error("Expected a public sb_publishable_ key; refusing to test with an unexpected key type.");
}
if (/sb_secret_|service_role/i.test(publishableKey)) {
  throw new Error("A server-only Supabase key was detected. Refusing to run.");
}

let failures = 0;
let passes = 0;

function result(label, ok, detail) {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
}

async function request(path, method = "GET") {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      accept: "application/json"
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw.slice(0, 180); }
  return { response, body };
}

console.log("GamBasket read-only live Supabase contract checks");
console.log(`Project host: ${new URL(supabaseUrl).host}`);
console.log("No rows are written, no users are created, and no checkout/payment RPC is called.\n");

const publicChecks = [
  ["approved public listings", "/rest/v1/products?select=id,status&status=eq.approved&limit=1"],
  ["public seller profile projection", "/rest/v1/public_profiles?select=id&limit=1"],
  ["public category attribute definitions", "/rest/v1/category_attribute_definitions?select=*&limit=1"],
  ["product image relation is queryable", "/rest/v1/product_images?select=*&limit=1"]
];

for (const [label, path] of publicChecks) {
  try {
    const { response, body } = await request(path);
    const isArray = Array.isArray(body);
    result(label, response.status === 200 && isArray,
      `HTTP ${response.status}${isArray ? `, ${body.length} sample row(s)` : ", expected a JSON array"}`);
  } catch (error) {
    result(label, false, error?.message || "request failed");
  }
}

// These are either private user data or internal accounting/moderation records.
// A blocked table or an RLS-filtered empty array is acceptable; any row returned to
// a public-key-only client is an exposure and must fail the check.
const protectedChecks = [
  ["private profiles are not publicly readable", "/rest/v1/profiles?select=*&limit=1"],
  ["role assignments are not publicly readable", "/rest/v1/user_roles?select=*&limit=1"],
  ["saved searches are private", "/rest/v1/saved_searches?select=*&limit=1"],
  ["wishlist alerts are private", "/rest/v1/wishlist_alerts?select=*&limit=1"],
  ["price-change audit events are private", "/rest/v1/product_price_change_events?select=*&limit=1"],
  ["affiliate commissions are not publicly readable", "/rest/v1/affiliate_commissions?select=*&limit=1"],
  ["campaign accounting rows are not publicly readable", "/rest/v1/campaign_products?select=*&limit=1"],
  ["earning rules are not publicly readable", "/rest/v1/earning_rules?select=*&limit=1"],
  ["payout requests are not publicly readable", "/rest/v1/payout_requests?select=*&limit=1"]
];

for (const [label, path] of protectedChecks) {
  try {
    const { response, body } = await request(path);
    if (response.status === 200 && Array.isArray(body)) {
      result(label, body.length === 0,
        body.length === 0 ? "HTTP 200 with zero visible rows" : `EXPOSURE: HTTP 200 returned ${body.length} row(s)`);
    } else {
      const isExpectedDenial = response.status >= 400 && response.status < 500 &&
        response.status !== 408 && response.status !== 429;
      result(label, isExpectedDenial,
        `HTTP ${response.status}${isExpectedDenial ? " (blocked)" : " (unexpected response)"}`);
    }
  } catch (error) {
    result(label, false, error?.message || "request failed");
  }
}

console.log(`\nResult: ${passes} passed, ${failures} failed.`);
if (failures > 0) process.exitCode = 1;