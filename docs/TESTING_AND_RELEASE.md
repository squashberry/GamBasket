# GamBasket testing and release checks

GamBasket is currently a test preview, not a production marketplace. The live preview uses GitHub Pages and the configured Supabase project. Use test data only and do not assume payment providers are integrated.

## Stage C — live Supabase contract checks

Run the GitHub Actions workflow named **GamBasket live backend contract checks** manually or review its weekly run. It uses only the public publishable key from `js/config.js` and makes read-only requests.

The check verifies that expected public listing/profile/category/image relations can be queried and that private profile, role, saved-search, wishlist-alert, price-audit, and accounting records do not leak through the public Data API. It does not create users or rows and does not call checkout or payment RPCs.

This is an HTTP contract check, not a substitute for authenticated buyer, seller, and courier transaction tests. A blocked relation or an empty RLS-filtered result is accepted for protected data; any returned protected row fails the check.

## Stage D — deployed-site release checks

The **GamBasket deployed site smoke checks** workflow runs after successful Pages deployments, daily, and on demand. It fetches the actual HTTPS deployment and checks key page routes, content markers, static assets, and public configuration for accidental server-only key patterns.

To test another deployment, manually run the workflow and enter its HTTPS base URL. Include a trailing slash when the site is hosted under a path, such as `https://example.github.io/GamBasket/`.

## Before any public launch

- Confirm that the Supabase project contains only test data or review a separate production project.
- Reconcile repository migration filenames with the recorded migration history before using the Supabase CLI to push schema changes.
- Review outstanding Supabase Security Advisor notices; automated checks do not mean every SECURITY DEFINER warning is harmless.
- Complete authenticated end-to-end tests for sign-in, checkout, stock reservation, order cancellation, seller updates, courier claims, verification, saved searches, and notification ownership.
- Integrate and verify real provider credentials and signed callbacks before describing Wave, QMoney, Afrimoney, or another option as a completed online payment integration. A pending payment state is not evidence that a transfer was initiated or confirmed.
- Confirm backup and restore, account recovery, rate limits, abuse reporting, privacy notices, refund/dispute handling, and operational monitoring.
- Keep service-role/secret keys out of browser code, Git history, workflow logs, and published artifacts. The publishable key is public by design and must be protected by database grants and RLS.

## Existing pull-request checks

- **GamBasket validation** checks JavaScript syntax, inline scripts, migration naming, and backend/security contracts.
- **GamBasket browser smoke tests** exercise UI behavior with mocked Supabase responses. They are regression tests, not proof of real authenticated database transactions.
- **GamBasket live backend contract checks** verify public-key access against the actual Supabase Data API.
- **GamBasket deployed site smoke checks** verify the published Pages deployment, not just a local static server.
