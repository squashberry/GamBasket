# JulaDirect — Trade. Shop. Connect.

JulaDirect is a digital marketplace for The Gambia where people can trade, shop, and connect with local sellers and buyers.

**Live marketplace:** https://juladirect.pages.dev/  
**Source repository:** https://github.com/squashberry/JulaDirect

## Key marketplace routes

- [Explore marketplace](https://juladirect.pages.dev/explore.html)
- [Compare products](https://juladirect.pages.dev/compare.html)
- [Saved searches and price alerts](https://juladirect.pages.dev/saved-searches.html)
- [Seller earnings](https://juladirect.pages.dev/supplier/earnings.html)

## Marketplace payment and seller wallet policy

The agreed marketplace rules are:

- **Seller commission: 5%** of the discounted merchandise amount. The delivery charge is accounted for separately and is not part of the commission calculation.
- **Payment collection:** ModemPay is the intended online payment provider. JulaDirect verifies the signed server callback, payment reference, amount and currency before marking an order as paid. A browser redirect is never proof of payment.
- **Seller funds:** seller proceeds remain pending while the order is fulfilled. After both courier delivery confirmation and buyer OTP confirmation, a 24-hour dispute window begins. A refund case or active dispute blocks release.
- **Seller withdrawals:** both manual withdrawal requests and automatic payouts are supported by policy. Automatic payout is opt-in and requires an approved payout method and a seller-selected threshold. Sellers can also leave available funds in their wallet to accumulate.
- **Payout destinations:** the first planned mobile-money rails are Wave and Afrimoney, subject to confirmation that they are enabled for the JulaDirect merchant account.
- **Refunds:** full and partial refunds require an audited case and provider confirmation. ModemPay's published refund instructions currently specify a 48-hour request window after transaction completion, so refunds outside that window need a separately approved provider process before launch.
- **Accounting:** all money movement must use an immutable, balanced, idempotent journal. The browser must never write balances, commissions, payment status, refund status or payout outcomes directly.

The design intentionally keeps collection in the JulaDirect merchant flow and releases seller proceeds later. Do not describe this as regulated escrow or use immediate split settlement unless ModemPay has approved that arrangement in writing.

## Financial implementation status

The repository now contains the first financial foundation migrations:

- 20261114090000_gambasket_finance_ledger.sql — 5% default commission setting, ModemPay payment/event records, balanced journal batches and append-only ledger entries.
- 20261114091000_gambasket_seller_wallet_payouts.sql — seller payout destinations, wallet preferences, withdrawal requests, idempotent fund reservation and wallet summary RPC.
- 20261114092000_gambasket_refunds_delivery_proof.sql — refund case/event records and private delivery OTP proof storage.
- 20261114093000_admin_payout_method_review.sql — admin-only approval/rejection of seller payout destinations.
- 20261114094000_persist_order_discounts.sql — persist checkout discounts for accurate post-discount merchandise commission calculations.

The original financial foundation migrations were **successfully applied** to the active JulaDirect Supabase project `iwxcepbwmnnkxocskopx`. Supabase migration history confirms all five entries. Post-migration verification confirmed the 5.00% commission setting, all 12 financial tables, 11 financial RLS policies, and the expected 8 database functions. Row-level security is enabled on every new financial table; the delivery OTP table intentionally has no client-facing policy.

The financial workflows and COD reserve foundation are deployed, but live ModemPay collection and payouts remain disabled until the correctly named provider secrets are configured and a real merchant test has passed. The seller interface can read wallet balances, save withdrawal preferences and record manual payout requests, but no actual transfer is sent. Online checkout remains disabled until provider configuration and live payment verification are complete.

## Development checks

- npm install --no-audit --no-fund
- npm run test:e2e — Playwright browser tests with mocked backend responses
- node tests/live-supabase-contract.mjs — read-only contracts against the configured Supabase Data API
- JULADIRECT_SITE_URL=https://juladirect.pages.dev/ node tests/deployed-site-smoke.mjs — verifies deployed pages and assets

See [docs/TESTING_AND_RELEASE.md](docs/TESTING_AND_RELEASE.md) for the Stage C/D workflows, limitations, and pre-launch checklist.


## ModemPay integration

The ModemPay integration is implemented with Supabase Edge Functions. Configure `MODEMPAY_API_KEY` and `MODEMPAY_WEBHOOK_SECRET` in Supabase Edge Function secrets; the browser never receives either secret.et.

- Hosted collection is created by `gambasket-modempay-checkout`; the order is initially created through the existing trusted order RPC, then the backend adds a pending provider intent and attaches the selected payment rail.
- `gambasket-modempay-webhook` validates the raw-body `x-modem-signature` HMAC-SHA512 header before processing charge and transfer events. A browser return URL never marks an order paid.
- Collection methods are Wave, QMoney and Afrimoney. Seller payouts are Wave and Afrimoney only, using ModemPay's required idempotency header.
- Buyer delivery codes are generated and hashed server-side. An assigned courier must submit the six-digit code to mark delivery complete. Paid seller proceeds remain pending for 24 hours after the handoff; open refund cases block release. COD delivery uses the same handoff proof but does not create an online-payment wallet liability.
- Buyers can request full or partial refunds; an administrator reviews the case in `/admin/refunds.html`. Provider refunds are restricted to the ModemPay 48-hour refund window. A provider timeout is left pending for reconciliation rather than being blindly retried.
- The payout worker releases eligible seller funds and processes approved automatic payout requests on a five-minute schedule. Wave/Afrimoney destinations must be approved before payout.

### Required Supabase Edge Function secrets

Set these under **Supabase Dashboard → Edge Functions → Secrets** for project `iwxcepbwmnnkxocskopx`:

- `MODEMPAY_API_KEY` — ModemPay test key first, then the live key after KYC.
- `MODEMPAY_WEBHOOK_SECRET` — the global signing secret from ModemPay Dashboard → Developers → Webhooks.
- `MODEMPAY_CHECKOUT_ENABLED` — keep `false` until the global webhook is configured and test events pass; then set `true`.
- `MODEMPAY_PAYOUTS_ENABLED` — keep `false` until payout permissions and Wave/Afrimoney merchant eligibility are confirmed.
- `MODEMPAY_BASE_URL` — optional; defaults to `https://api.modempay.com`.
- `GAMBASKET_OTP_PEPPER` and `GAMBASKET_CRON_SECRET` are generated and stored by the backend deployment process; do not share them.

Configure the global ModemPay webhook endpoint as:

`https://iwxcepbwmnnkxocskopx.supabase.co/functions/v1/gambasket-modempay-webhook`

Subscribe to `charge.succeeded`, `charge.failed`, `charge.cancelled`, `transfer.succeeded`, `transfer.failed`, `transfer.reversed` and `transfer.flagged`. Do not set a per-payment callback URL: the integration relies on the global signed webhook. Keep checkout and payouts disabled until test-mode verification has passed.
