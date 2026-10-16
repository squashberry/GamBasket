import { test, expect } from "@playwright/test";

const PROJECT = "https://iwxcepbwmnnkxocskopx.supabase.co";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const IPHONE_ID = "11111111-1111-4111-8111-111111111111";
const SAMSUNG_ID = "33333333-3333-4333-8333-333333333333";
const SAMSUNG_SELLER_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_KEY = "sb-iwxcepbwmnnkxocskopx-auth-token";

const iphone = {
  id: IPHONE_ID,
  title: "iPhone 13 128GB",
  price: 14500,
  currency: "GMD",
  category_id: "Phones",
  location: "Serrekunda",
  condition: "Like New",
  delivery_available: true,
  main_image: "https://images.example.test/iphone-front.jpg",
  description: "Factory unlocked test listing.",
  attributes: { brand: "Apple", model: "iPhone 13", storage: "128GB", battery_health: 92 },
  stock: 3,
  status: "approved",
  searchable: true,
  sales_count: 7,
  listing_type: "retail",
  seller_id: USER_ID,
  created_at: "2026-10-15T10:00:00.000Z"
};
const samsung = {
  id: SAMSUNG_ID,
  title: "Samsung Galaxy S24",
  price: 22000,
  currency: "GMD",
  category_id: "Phones",
  location: "Brikama",
  condition: "New",
  main_image: "https://images.example.test/samsung-front.jpg",
  description: "Test Samsung phone listing.",
  attributes: { brand: "Samsung", model: "Galaxy S24", storage: "256GB" },
  stock: 5,
  status: "approved",
  searchable: true,
  sales_count: 4,
  listing_type: "retail",
  seller_id: SAMSUNG_SELLER_ID,
  delivery_available: false,
  created_at: "2026-10-14T10:00:00.000Z"
};

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "fake-gambasket-e2e-access-token",
    refresh_token: "fake-gambasket-e2e-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "gambasket-e2e@example.test",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { first_name: "Test", last_name: "Buyer" },
      created_at: "2026-10-01T00:00:00.000Z"
    }
  };
}

async function mockBackend(page, options = {}) {
  const products = options.products || [];
  const gallery = options.gallery || [];
  const cartRows = options.cartRows || [];
  const writes = options.writes || [];
  const authenticated = Boolean(options.authenticated);
  if (authenticated) {
    await page.addInitScript(({ key, session }) => {
      try { localStorage.setItem(key, JSON.stringify(session)); } catch {}
    }, { key: SESSION_KEY, session: fakeSession() });
  }

  await page.route("https://iwxcepbwmnnkxocskopx.supabase.co/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400"
    };
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors, body: "" });
      return;
    }
    const json = async (body, status = 200, extraHeaders = {}) => route.fulfill({
      status,
      contentType: "application/json",
      headers: { ...cors, ...extraHeaders },
      body: JSON.stringify(body)
    });

    if (path === "/auth/v1/settings") {
      await json({
        disable_signup: false,
        mailer_autoconfirm: false,
        phone_autoconfirm: false,
        sms_autoconfirm: false,
        external: { apple: false, azure: false, bitbucket: false, discord: false, facebook: false, github: false, gitlab: false, google: false, keycloak: false, linkedin: false, slack: false, spotify: false, twitch: false, twitter: false, workos: false, zoom: false }
      });
      return;
    }
    if (path === "/auth/v1/user") {
      if (authenticated) { await json(fakeSession().user); return; }
      await json({ code: "invalid_token", message: "No test session" }, 401);
      return;
    }
    if (path.startsWith("/auth/v1/token")) {
      await json({ error: "invalid_grant", error_description: "No exchange in mocked smoke tests" }, 400);
      return;
    }
    if (path.startsWith("/storage/v1/object/product-images/") && method === "POST") {
      const objectPath = path.split("/storage/v1/object/product-images/")[1] || "";
      await json({ Key: "product-images/" + objectPath, Id: "test-object-id", path: objectPath }, 200);
      return;
    }
    if (path === "/rest/v1/products") {
      let matching = [...products];
      const idParam = url.searchParams.get("id") || "";
      if (idParam.startsWith("eq.")) matching = matching.filter(item => item.id === idParam.slice(3));
      const statusParam = url.searchParams.get("status") || "";
      if (statusParam.startsWith("eq.")) matching = matching.filter(item => item.status === statusParam.slice(3));
      const accept = request.headers()["accept"] || "";
      if (accept.includes("vnd.pgrst.object+json")) {
        if (matching.length === 1) { await json(matching[0]); return; }
        await json({
          code: "PGRST116",
          details: `The result contains ${matching.length} rows`,
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned"
        }, 406);
        return;
      }
      await json(matching);
      return;
    }
    if (path === "/rest/v1/product_images") { await json(gallery); return; }
    if (path === "/rest/v1/cart_items") { await json(cartRows); return; }
    if (path === "/rest/v1/marketplace_reviews") { await json([]); return; }
    if (path === "/rest/v1/category_attribute_definitions") { await json([]); return; }
    if (path === "/rest/v1/public_profiles" || path === "/rest/v1/profiles") {
      const publicRows = [
        { id: USER_ID, first_name: "Awa", last_name: "Store", avatar_url: null, area: "Serrekunda", region: "Kanifing", business_name: "Awa Mobile Store", seller_type: "business", is_seller_verified: true, has_business_store: true },
        { id: SAMSUNG_SELLER_ID, first_name: "Individual", last_name: "Seller", avatar_url: null, area: "Brikama", region: "West Coast", business_name: null, seller_type: "individual", is_seller_verified: false, has_business_store: false }
      ];
      const privateRows = [{ id: USER_ID, first_name: "Test", last_name: "Buyer", email: "gambasket-e2e@example.test", phone: "+2207000000", region: "West Coast Region", area: "Brikama", avatar_url: null }];
      let rows = path.endsWith("/public_profiles") ? publicRows : privateRows;
      const idParam = url.searchParams.get("id") || "";
      if (idParam.startsWith("eq.")) rows = rows.filter(item => item.id === idParam.slice(3));
      if (idParam.startsWith("in.(")) {
        const ids = idParam.slice(4,-1).split(",");
        rows = rows.filter(item => ids.includes(item.id));
      }
      const accept = request.headers()["accept"] || "";
      if (accept.includes("vnd.pgrst.object+json")) {
        if (rows.length === 1) await json(rows[0]);
        else await json({ code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "No rows found" }, 406);
      } else await json(rows);
      return;
    }
    if (path === "/rest/v1/rpc/create_order" && method === "POST") {
      let body = null;
      try { body = request.postDataJSON(); } catch {}
      writes.push({ table: "rpc/create_order", body });
      await json({ id: "55555555-5555-4555-8555-555555555555", order_number: "GB-TEST-0001", order_status: "pending", payment_status: "pending", total: 14600, subtotal: 14500, delivery_fee: 100, currency: "GMD" });
      return;
    }
    if (path === "/rest/v1/saved_searches" && method === "POST") {
      let body = null;
      try { body = request.postDataJSON(); } catch {}
      writes.push({ table: "saved_searches", body });
      await json([], 201, { "preference-applied": "return=minimal" });
      return;
    }
    if (path === "/rest/v1/saved_searches" && method === "GET") { await json([]); return; }
    if (path === "/rest/v1/wishlist_alerts") { await json([]); return; }
    if (path === "/rest/v1/growth_notifications") { await json([]); return; }
    if (path.startsWith("/rest/v1/")) {
      if (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE") {
        writes.push({ table: path.slice("/rest/v1/".length), method, url: url.href });
        await json([], 201, { "preference-applied": "return=minimal" });
      } else await json([]);
      return;
    }
    if (path.startsWith("/storage/v1/")) {
      await json({ Key: path.split("/").slice(-1)[0] || "object" });
      return;
    }
    await json({});
  });
}

test.beforeEach(async ({ page }) => {
  page.on("dialog", dialog => dialog.dismiss());
  page.on("pageerror", error => console.error("[browser page error]", error.message));
  page.on("console", message => {
    if (message.type() === "error" || message.text().includes("[GamBasket product")) {
      console.log("[browser console]", message.type(), message.text());
    }
  });
});

test("Explore shows only live approved database listings, not fabricated demo inventory", async ({ page }) => {
  await mockBackend(page, { products: [] });
  await page.goto("/explore.html");
  await expect(page.locator("#exploreEmptyState")).toBeVisible();
  await expect(page.locator("#productGrid .product-card")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("iPhone 13 128GB");
});

test("Brand/model filtering uses actual category attributes", async ({ page }) => {
  await mockBackend(page, { products: [iphone, samsung] });
  await page.goto("/explore.html");
  await expect(page.locator("#productGrid .product-card")).toHaveCount(2);
  await page.locator("#brandModelFilter").fill("Apple");
  await expect(page.locator("#productGrid .product-card")).toHaveCount(1);
  await expect(page.locator("#productGrid .product-name")).toHaveText("iPhone 13 128GB");

  const criteria = await page.evaluate(() => window.GamBasketSavedSearches?.cleanCriteria());
  expect(criteria.brandModel).toBe("Apple");
});

test("Product detail renders category specifications and switches photo thumbnails", async ({ page }) => {
  await mockBackend(page, {
    products: [iphone],
    gallery: [{ image_url: "https://images.example.test/iphone-back.jpg", sort_order: 1 }],
    authenticated: true
  });
  await page.goto("/product.html?id=" + IPHONE_ID);
  await expect(page.locator("#detailName")).toHaveText("iPhone 13 128GB");
  await expect(page.locator("#detailAttributes")).toContainText("Apple");
  await expect(page.locator("#detailAttributes")).toContainText("128GB");
  const main = page.locator("#detailImage");
  await expect(main).toHaveAttribute("src", iphone.main_image);
  const thumbnails = page.locator("#detailImageThumbs button");
  await expect(thumbnails).toHaveCount(2);
  await thumbnails.nth(1).click();
  await expect(main).toHaveAttribute("src", "https://images.example.test/iphone-back.jpg");
});

test("Removed or unapproved product URLs show an unavailable state instead of sample products", async ({ page }) => {
  await mockBackend(page, { products: [] });
  await page.goto("/product.html?id=" + IPHONE_ID);
  await expect(page.locator("#detailName")).toHaveText("This listing is not available");
  await expect(page.locator("#orderNowBtn")).toBeDisabled();
  await expect(page.locator("#sellerName")).not.toHaveAttribute("href", /seller\.html/);
});

test("Comparison page compares approved listings and supports removing one", async ({ page }) => {
  await mockBackend(page, { products: [iphone, samsung], authenticated: true });
  await page.addInitScript(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids)), {
    key: "gambasket_compare_products", ids: [IPHONE_ID, SAMSUNG_ID]
  });
  await page.goto("/compare.html");
  await expect(page.locator("#compareContent .gambasket-compare-table")).toBeVisible();
  await expect(page.locator("#compareContent")).toContainText("iPhone 13 128GB");
  await expect(page.locator("#compareContent")).toContainText("Samsung Galaxy S24");
  await expect(page.locator("#compareContent")).toContainText("Battery Health");
  await page.locator("#compareContent button").filter({ hasText: "Remove" }).first().click();
  await expect(page.locator("#compareContent .gambasket-compare-table")).toHaveCount(0);
  await expect(page.locator("#compareStatus")).toContainText("at least two");
});

test("Explore compare dock can be opened with a real listing ID", async ({ page }) => {
  await mockBackend(page, { products: [iphone, samsung] });
  await page.goto("/explore.html");
  await expect(page.locator("#productGrid .product-card")).toHaveCount(2);
  await page.locator("[data-compare-product-id]").first().click();
  await expect(page.locator("#gambasketCompareDock")).toBeVisible();
  await expect(page.locator("#gambasketCompareCount")).toContainText("1 product selected");
});

test("Authenticated saved-search form writes only the filter criteria contract", async ({ page }) => {
  const writes = [];
  await mockBackend(page, { products: [iphone, samsung], authenticated: true, writes });
  await page.goto("/explore.html?category=Phones&location=Serrekunda&min=10000");
  await page.locator("#brandModelFilter").fill("Apple");
  await page.locator("#saveCurrentSearchBtn").click();
  await expect(page.locator("#saveSearchModal")).toBeVisible();
  await page.locator("#saveSearchName").fill("Apple phones in Serrekunda");
  await page.locator("[data-save-confirm]").click();
  await expect.poll(() => writes.some(row => row.table === "saved_searches")).toBe(true);
  const insert = writes.find(row => row.table === "saved_searches");
  expect(insert.body.name).toBe("Apple phones in Serrekunda");
  expect(insert.body.criteria.category).toBe("Phones");
  expect(insert.body.criteria.location).toBe("Serrekunda");
  expect(insert.body.criteria.minPrice).toBe(10000);
  expect(insert.body.criteria.brandModel).toBe("Apple");
});

test("Checkout submits cart items through the server-authoritative create_order RPC", async ({ page }) => {
  const writes = [];
  const cartRows = [{
    id: "66666666-6666-4666-8666-666666666666",
    user_id: USER_ID,
    product_id: IPHONE_ID,
    quantity: 1,
    product: iphone
  }];
  await mockBackend(page, { products: [iphone], cartRows, authenticated: true, writes });
  await page.goto("/checkout.html");
  await expect(page.locator("#summaryItems")).toContainText("iPhone 13 128GB");
  await page.locator("#fullName").fill("Test Buyer");
  await page.locator("#email").fill("gambasket-e2e@example.test");
  await page.locator("#phone").fill("+2207000000");
  await page.locator("#region").selectOption({ label: "West Coast Region" });
  await page.locator("#area").fill("Brikama");
  await page.locator("#address").fill("Test Street");
  await page.locator("#placeOrderBtn").click();
  await expect(page.locator("#orderSuccess")).toHaveClass(/show/);
  await expect(page.locator("#successOrderNumber")).toHaveText("GB-TEST-0001");
  const orderCall = writes.find(row => row.table === "rpc/create_order");
  expect(orderCall).toBeTruthy();
  expect(orderCall.body.p_items).toEqual([{ product_id: IPHONE_ID, quantity: 1 }]);
  expect(orderCall.body.p_delivery_area).toBe("Brikama");
  expect(orderCall.body.p_fulfillment_type).toBe("delivery");
});

test("Image upload falls back to Supabase Storage when Cloudinary is unset", async ({ page }) => {
  await mockBackend(page, { authenticated: true });
  await page.goto("/explore.html");
  const result = await page.evaluate(async () => {
    const file = new File([new Uint8Array([1,2,3])], "test-photo.jpg", { type: "image/jpeg" });
    return await window.GamBasketAuth.uploadImage(file, "products");
  });
  const expected = "/storage/v1/object/public/product-images/" + USER_ID + "/products/.*\\.jpg";
  expect(result).toMatch(new RegExp(expected));
  expect(result).toContain("https://iwxcepbwmnnkxocskopx.supabase.co");
});

test("Quick Sell category selection renders relevant category fields", async ({ page }) => {
  await mockBackend(page, { authenticated: true });
  await page.goto("/quick-sell.html");
  await expect(page.locator("#quickSellAttributes")).toContainText("Brand");
  await expect(page.locator("#quickSellAttributes")).toContainText("Model");
  await page.locator("#quickSellCategory").selectOption("Auto");
  await expect(page.locator("#quickSellAttributes")).toContainText("Mileage (km)");
  await expect(page.locator("#quickSellAttributes")).toContainText("Transmission");
});

test("Verified-seller and delivery filters only show listings that qualify", async ({ page }) => {
  await mockBackend(page, { products: [iphone, samsung] });
  await page.goto("/explore.html");
  await expect(page.locator("#productGrid .product-card")).toHaveCount(2);
  await page.locator('input[name="workspaceSeller"][value="verified"]').check();
  await expect(page.locator("#productGrid .product-card")).toHaveCount(1);
  await expect(page.locator("#productGrid .product-name")).toHaveText("iPhone 13 128GB");
  await expect(page.locator("#productGrid")).toContainText("Verified seller");

  await page.locator('input[name="workspaceSeller"][value="all"]').check();
  await page.locator("#workspaceDelivery").check();
  await expect(page.locator("#productGrid .product-card")).toHaveCount(1);
  await expect(page.locator("#productGrid .product-name")).toHaveText("iPhone 13 128GB");
  await expect(page.locator("#productGrid")).toContainText("Delivery available");
});

test("Mobile Explore does not hide the key search/filters controls", async ({ page }) => {
  await mockBackend(page, { products: [iphone, samsung] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore.html");
  await expect(page.locator("#mobileFilterButton")).toBeVisible();
  await page.locator("#mobileFilterButton").click();
  await expect(page.locator("#mobileFilterDrawer")).toHaveClass(/active/);
  await expect(page.locator("#mobileBrandModelFilter")).toBeVisible();
});
