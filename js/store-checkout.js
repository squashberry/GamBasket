(() => {
  "use strict";
  const API = "https://iwxcepbwmnnkxocskopx.supabase.co/functions/v1/juladirect-store-bridge";
  const PUBLIC_KEY = "sb_publishable_LYlQsw2QbUqUTPcrYiTAtg_6hwDQ92Z";
  const params = new URLSearchParams(location.search);
  const sessionToken = params.get("session") || "";
  const $ = (id) => document.getElementById(id);
  let buyerSession = null;
  let checkoutReady = false;
  const money = (value) => "D " + Number(value || 0).toLocaleString("en-GM", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  function alertError(message) {
    const box = $("checkoutAlert");
    box.textContent = message;
    box.style.display = "block";
  }
  async function call(action, payload = {}, token = "") {
    const headers = { apikey: PUBLIC_KEY, "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch(API, { method: "POST", headers, body: JSON.stringify({ action, ...payload }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "JulaDirect could not complete your checkout.");
    return data;
  }
  function loginUrl() {
    return "login.html?redirect=" + encodeURIComponent("store-checkout.html?session=" + sessionToken);
  }
  function renderItems(details) {
    let total = 0;
    $("checkoutItems").innerHTML = details.items.map((item) => {
      const line = Number(item.price) * Number(item.quantity);
      total += line;
      return '<div class="jdco-item"><span><b>' + escapeHtml(item.title) + '</b><small>Quantity: ' + Number(item.quantity) + ' × ' + money(item.price) + '</small></span><strong>' + money(line) + '</strong></div>';
    }).join("");
    $("checkoutTotal").textContent = money(total);
    $("storeName").textContent = details.seller_name || details.site_name || "Your order";
    $("checkoutSubtitle").textContent = "Order from " + (details.site_name || details.seller_name || "this store") + " using secure JulaDirect checkout.";
    $("returnToStore").href = details.store_url || "index.html";
  }
  function renderMethods(methods) {
    const labels = { wave: "Wave", qmoney: "QMoney", afrimoney: "Afrimoney" };
    const valid = (methods || []).filter((m) => Object.prototype.hasOwnProperty.call(labels, m));
    $("paymentMethods").innerHTML = valid.map((method, index) =>
      '<label><input type="radio" name="paymentMethod" value="' + method + '" ' + (index === 0 ? "checked" : "") + ' required> ' + labels[method] + '</label>'
    ).join("");
    return valid.length > 0;
  }
  function updateFulfillment() {
    const pickup = $("fulfillmentType").value === "pickup";
    $("deliveryFields").hidden = pickup;
    ["deliveryAddress", "deliveryRegion", "deliveryArea"].forEach((id) => {
      $(id).required = !pickup;
    });
  }
  async function submitOrder(event) {
    event.preventDefault();
    if (!checkoutReady) return;
    const button = $("placeOrderButton");
    button.disabled = true;
    button.textContent = "Creating your order…";
    try {
      await window.GamBasketAuth.ready();
      const current = await window.GamBasketAuth.getSession();
      if (!current?.access_token) {
        window.location.assign(loginUrl());
        return;
      }
      const fulfillment = $("fulfillmentType").value;
      const selected = document.querySelector('input[name="paymentMethod"]:checked');
      if (!selected) throw new Error("Choose Wave, QMoney or Afrimoney.");
      const result = await call("complete_checkout", {
        session_token: sessionToken,
        payment_method: selected.value,
        fulfillment_type: fulfillment,
        delivery_address: fulfillment === "pickup" ? "" : $("deliveryAddress").value.trim(),
        delivery_region: fulfillment === "pickup" ? "" : $("deliveryRegion").value.trim(),
        delivery_area: fulfillment === "pickup" ? "" : $("deliveryArea").value.trim(),
        delivery_phone: $("deliveryPhone").value.trim(),
        delivery_instructions: fulfillment === "pickup" ? "" : $("deliveryInstructions").value.trim()
      }, current.access_token);
      window.location.assign(result.payment_url);
    } catch (error) {
      alertError(error instanceof Error ? error.message : "Unable to continue to payment.");
      button.disabled = false;
      button.textContent = "Retry secure payment";
    }
  }
  async function init() {
    if (!sessionToken || sessionToken.length < 40) throw new Error("This checkout link is missing or invalid. Return to the store and try again.");
    const [details, config] = await Promise.all([
      call("checkout_details", { session_token: sessionToken }),
      call("checkout_config")
    ]);
    renderItems(details);
    if (!config.checkout_enabled || !renderMethods(config.payment_methods)) {
      throw new Error("Online checkout is temporarily unavailable. Please contact the seller.");
    }
    $("checkoutLoading").hidden = true;
    $("checkoutContent").hidden = false;
    await window.GamBasketAuth.ready();
    buyerSession = await window.GamBasketAuth.getSession();
    if (!buyerSession?.user) {
      $("buyerAuthNotice").hidden = false;
      $("buyerSignIn").href = loginUrl();
      return;
    }
    $("storeCheckoutForm").hidden = false;
    $("fulfillmentType").addEventListener("change", updateFulfillment);
    updateFulfillment();
    $("storeCheckoutForm").addEventListener("submit", submitOrder);
    checkoutReady = true;
  }
  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      $("checkoutLoading").textContent = "";
      alertError(error instanceof Error ? error.message : "This checkout could not be loaded.");
    });
  });
})();