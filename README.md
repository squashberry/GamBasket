# GamBasket test preview

GamBasket is a browser-based marketplace prototype for The Gambia. This repository is published as a **test preview** at https://squashberry.github.io/GamBasket/; it is not a production launch declaration.

## Key preview routes

- [Explore marketplace](https://squashberry.github.io/GamBasket/explore.html)
- [Compare products](https://squashberry.github.io/GamBasket/compare.html)
- [Saved searches and price alerts](https://squashberry.github.io/GamBasket/saved-searches.html)
- [Seller earnings](https://squashberry.github.io/GamBasket/supplier/earnings.html)

## Marketplace payment and seller wallet policy

The agreed marketplace rules are:

- **Seller commission: 5%** of the discounted merchandise amount. The delivery charge is accounted for separately and is not part of the commission calculation.
- **Payment collection:** ModemPay is the intended online payment provider. GamBasket must verify the signed server callback, payment reference, amount and currency before marking an order as paid. A browser redirect is never proof of payment.
- **Seller funds:** seller proceeds remain pending while the order is fulfilled. After both courier delivery confirmation and buyer OTP confirmation, a 24-hour dispute window begins. A refund case or active dispute blocks release.
- **Seller withdrawals:** both manual withdrawal requests and automatic payouts are supported by policy. Automatic payout is opt-in and requires an approved payout method and a seller-selected threshold. Sellers can also leave available funds in their wallet to accumulate.
- **Payout destinations:** the first planned mobile-money rails are Wave and Afrimoney, subject to confirmation that they are enabled for the GamBasket merchant account.
- **Refunds:** full and partial refunds require an audited case and provider confirmation. ModemPay's published refund instructions currently specify a 48-hour request window after transaction completion, so refunds outside that window need a separately approved provider process before launch.
- **Accounting:** all money movement must use an immutable, balanced, idempotent journal. The browser must never write balances, commissions, payment status, refund status or payout outcomes directly.

The design intentionally keeps collection in the GamBasket merchant flow and releases seller proceeds later. Do not describe this as regulated escrow or use immediate split settlement unless ModemPay has approved that arrangement in writing.

## Financial implementation status

The repository now contains the first financial foundation migrations:

- 20261114090000_gambasket_finance_ledger.sql — 5% default commission setting, ModemPay payment/event records, balanced journal batches and append-only ledger entries.
- 20261114091000_gambasket_seller_wallet_payouts.sql — seller payout destinations, wallet preferences, withdrawal requests, idempotent fund reservation and wallet summary RPC.
- 20261114092000_gambasket_refunds_delivery_proof.sql — refund case/event records and private delivery OTP proof storage.

These migrations are **repository code only** at this stage. They have not been applied to the live Supabase project. ModemPay checkout, signed webhook processing, automatic payout workers, refund execution, OTP issue/verification and the 24-hour release job are not yet live. Online checkout remains deliberately locked to Cash on Delivery until those flows have been completed and tested.

## Development checks

- npm install --no-audit --no-fund
- npm run test:e2e — Playwright browser tests with mocked backend responses
- node tests/live-supabase-contract.mjs — read-only contracts against the configured Supabase Data API
- GAMBASKET_SITE_URL=https://squashberry.github.io/GamBasket/ node tests/deployed-site-smoke.mjs — verifies deployed pages and assets

See [docs/TESTING_AND_RELEASE.md](docs/TESTING_AND_RELEASE.md) for the Stage C/D workflows, limitations, and pre-launch checklist.
