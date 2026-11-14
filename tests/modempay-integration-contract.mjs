import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const [migration, checkoutFn, webhookFn, payoutFn, deliveryFn, refundFn, configFn, checkoutUi, deliveryUi, ordersUi, walletUi] =
  await Promise.all([
    read("supabase/migrations/20261114160000_gambasket_modempay_finance_lifecycle.sql"),
    read("supabase/functions/gambasket-modempay-checkout/index.ts"),
    read("supabase/functions/gambasket-modempay-webhook/index.ts"),
    read("supabase/functions/gambasket-modempay-payouts/index.ts"),
    read("supabase/functions/gambasket-delivery-proof/index.ts"),
    read("supabase/functions/gambasket-modempay-refunds/index.ts"),
    read("supabase/functions/gambasket-modempay-config/index.ts"),
    read("js/checkout.js"), read("js/delivery.js"), read("orders.html"), read("js/seller-wallet.js")
  ]);

assert.match(migration, /commission_rate/);
assert.match(migration, /interval '24 hours'/);
assert.match(migration, /interval '48 hours'/);
assert.match(migration, /gambasket_guard_order_payment_method/);
assert.match(migration, /gambasket_process_modempay_charge/);
assert.match(migration, /gambasket_process_modempay_transfer_event/);
assert.match(migration, /gambasket_issue_delivery_otp/);
assert.match(migration, /gambasket_confirm_delivery_with_otp/);
assert.match(migration, /gambasket_queue_automatic_payouts/);
assert.match(migration, /gambasket_release_due_seller_funds/);
assert.match(migration, /gambasket_finalize_modempay_refund/);

assert.match(checkoutFn, /MODEMPAY_API_KEY/);
assert.ok(checkoutFn.includes("/v1/payments"));
assert.match(checkoutFn, /payment_methods/);
assert.doesNotMatch(checkoutFn, /callback_url/);
assert.match(checkoutFn, /payment_link/);
assert.match(webhookFn, /x-modem-signature/);
assert.match(webhookFn, /SHA-512/);
assert.match(webhookFn, /gambasket_process_modempay_charge/);
assert.match(webhookFn, /gambasket_process_modempay_transfer_event/);
assert.ok(payoutFn.includes("/v1/transfers"));
assert.match(payoutFn, /Idempotency-Key/);
assert.match(payoutFn, /gambasket_release_due_seller_funds/);
assert.match(deliveryFn, /GAMBASKET_OTP_PEPPER/);
assert.match(deliveryFn, /gambasket_confirm_delivery_with_otp/);
assert.ok(refundFn.includes("/v1/transactions/refund"));
assert.match(refundFn, /gambasket_mark_refund_provider_pending/);
assert.match(refundFn, /gambasket_finalize_modempay_refund/);
assert.match(configFn, /MODEMPAY_CHECKOUT_ENABLED/);
assert.match(configFn, /MODEMPAY_PAYOUTS_ENABLED/);
for (const source of [checkoutFn, webhookFn, payoutFn, deliveryFn, refundFn, configFn]) {
  assert.match(source, /x-client-info/);
}

assert.match(checkoutUi, /payment_method: "cash_on_delivery"/);
assert.match(checkoutUi, /gambasket-modempay-checkout/);
assert.match(deliveryUi, /gambasket-delivery-proof/);
assert.match(ordersUi, /data-delivery-code/);
assert.match(ordersUi, /gambasket-modempay-refunds/);
assert.match(walletUi, /gambasket-modempay-payouts/);
for (const source of [checkoutFn, webhookFn, payoutFn, deliveryFn, refundFn, configFn]) {
  assert.doesNotMatch(source, /sk_live_[A-Za-z0-9_-]{8,}|sk_test_[A-Za-z0-9_-]{8,}/);
}
console.log("ModemPay integration contracts passed.");
