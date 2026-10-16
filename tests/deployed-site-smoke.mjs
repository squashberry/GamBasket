const configuredBase = process.env.GAMBASKET_SITE_URL || "https://squashberry.github.io/GamBasket/";
const base = new URL(configuredBase);
if (base.protocol !== "https:") throw new Error("The deployed-site smoke test requires HTTPS.");
if (!base.pathname.endsWith("/")) base.pathname += "/";

const pages = [
  ["home", "index.html", /<body[^>]*is-homepage/i],
  ["marketplace exploration", "explore.html", /id=["']productGrid["']/i],
  ["product detail", "product.html", /<title[^>]*>[^<]*(product|gambasket)/i],
  ["product comparison", "compare.html", /<title[^>]*>[^<]*(compare|gambasket)/i],
  ["saved searches and alerts", "saved-searches.html", /id=["']savedSearchList["']/i],
  ["cart", "cart.html", /class=["']cart-shell["']/i],
  ["checkout", "checkout.html", /id=["']checkoutForm["']/i],
  ["login", "login.html", /<title[^>]*>[^<]*(login|log in|gambasket)/i],
  ["About GamBasket", "about.html", /The Unified Digital Marketplace of The Gambia/i],
  ["Help Center payment guidance", "help.html", /Cash on Delivery is available now/i],
  ["How It Works payment guidance", "how-it-works.html", /Cash on Delivery is available now/i],
  ["seller quick sell", "quick-sell.html", /<html[^>]*lang=["']en/i],
  ["seller product form", "supplier/add-product.html", /<html[^>]*lang=["']en/i]
];
const assets = [
  ["public client configuration", "js/config.js", "javascript"],
  ["Supabase client adapter", "js/supabase.js", "javascript"],
  ["main stylesheet", "css/style.css", "css"],
  ["marketplace enhancement stylesheet", "css/marketplace-enhancements.css", "css"]
];
let passes = 0;
let failures = 0;
function report(ok, label, detail) {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
}
async function fetchText(path) {
  const url = new URL(path, base);
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  return { response, body, url };
}

console.log("GamBasket deployed Pages release smoke checks");
console.log(`Target: ${base.origin}${base.pathname}\n`);

await Promise.all(pages.map(async ([label, path, sentinel]) => {
  try {
    const { response, body, url } = await fetchText(path);
    const contentType = response.headers.get("content-type") || "";
    const hasPageShell = /<!doctype html|<html[\s>]/i.test(body) && /<\/html>/i.test(body);
    const hasExpectedContent = sentinel.test(body);
    const no404Fallback = !/404 - File not found|Page Not Found/i.test(body);
    const ok = response.status === 200 && contentType.includes("text/html") &&
      hasPageShell && hasExpectedContent && no404Fallback;
    report(ok, label, `HTTP ${response.status}, ${contentType || "no content type"}, ${url.pathname}`);
  } catch (error) {
    report(false, label, error?.message || "request failed");
  }
}));

// The live preview must never imply that unsupported online payment methods work.
try {
  const { response, body } = await fetchText("checkout.html");
  const radioTag = id => body.match(new RegExp("<input\\b(?=[^>]*\\bid=\"" + id + "\"(?:\\s|>))[^>]*>", "i"))?.[0] || "";
  const labelFor = id => body.match(new RegExp("<label\\b[^>]*\\bfor=\"" + id + "\"[^>]*>[\\s\\S]*?</label>", "i"))?.[0] || "";
  const codTag = radioTag("cod");
  const onlyCodAvailable = /\bchecked\b/i.test(codTag) && !/\bdisabled\b/i.test(codTag) &&
    ["wave", "qmoney", "afrimoney"].every(id =>
      /\bdisabled\b/i.test(radioTag(id)) && /Coming soon/i.test(labelFor(id))
    ) && /id="paymentAvailabilityNote"/i.test(body);
  report(response.status === 200 && onlyCodAvailable,
    "checkout payment availability",
    "HTTP " + response.status + "; COD enabled and future methods clearly disabled");
} catch (error) {
  report(false, "checkout payment availability", error?.message || "request failed");
}

await Promise.all(assets.map(async ([label, path, expectedType]) => {
  try {
    const { response, body, url } = await fetchText(path);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    let validType = expectedType === "css" ? contentType.includes("text/css") :
      (contentType.includes("javascript") || contentType.includes("ecmascript") || url.pathname.endsWith(".js"));
    let bodySafe = true;
    if (path === "js/config.js") {
      bodySafe = !/sb_secret_[A-Za-z0-9_-]+|SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(body) &&
        /SUPABASE_PUBLISHABLE_KEY/.test(body);
    }
    report(response.status === 200 && validType && body.length > 0 && bodySafe,
      label, `HTTP ${response.status}, ${contentType || "no content type"}`);
  } catch (error) {
    report(false, label, error?.message || "request failed");
  }
}));

console.log(`\nResult: ${passes} passed, ${failures} failed.`);
if (failures > 0) process.exitCode = 1;
