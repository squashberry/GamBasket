# JulaDirect v2 frontend rebuild: handover

Branch: `rebuild/juladirect-v2` (never merged to `main`). Nothing on this branch has been built, run, linted or browser-tested. Treat every item below as **unverified** until the checks in "Before merging" pass.

## Architecture

No build step (the site is static HTML on Cloudflare Pages), so the new frontend is plain HTML, CSS and vanilla JS.

| File | Role |
|---|---|
| `css/jd.css` | Design system: blue/navy/white tokens, components, desktop marketplace look (>= 821px), mobile app look (<= 820px), takeover banner, overlays. Scoped to `body.jd`, so legacy pages are untouched. |
| `js/jd-core.js` | Utilities, icon set, shell (desktop header, mobile header, takeover bar, floating nav, area sheet, menu/search overlays, account menu with role-aware workspace links), toasts, compare list, recently visited, product card. |
| `js/jd-data.js` | Read-only marketplace queries (search, product, categories, price statistics, banners). |
| `js/jd-*.js` + page HTML | One script per page. |

`js/supabase.js` (`window.GamBasketAuth`) remains the only Supabase client. No keys were added.

## Pages

Rebuilt on the v2 design: homepage, Explore, product, cart, wishlist, compare, admin banner manager, Seller Centre Overview.
Restyled by rewriting one shared stylesheet, with no markup or script changes:
- **Auth** (`css/auth.css`, plus `css/auth-recovery.css` for forgot-password): login, signup, reset-password, verify-email and forgot-password in a split-screen layout with a fixed blue brand panel. Every state class the scripts toggle is styled.
- **Seller Centre** (`css/seller.css`): all 14 `supplier/*` pages (floating sidebar, KPI cards, panels, tables, chips, floating mobile nav). `css/seller-website.css` and `css/seller-wallet.css` are untouched but inherit the new palette through re-pointed tokens; expect to review the Website and Earnings pages visually.
Restyled with logic untouched: checkout (every id, input name, value, `disabled` flag, script and load order preserved; `css/jd-checkout.css`).
**Not yet migrated (still the old design):** account (`me`), orders, messages, saved searches, store pages, Administration (other than banners), courier, operations, affiliate, static/legal pages.

### Findings worth knowing

- The previous Seller Overview never loaded data: nothing populated pending orders, product count, recent orders, inventory alerts or the sales chart, and the sales/fee tiles depended on a script the page did not load. It displayed hardcoded zeros and "Sales chart will appear here". The rebuilt Overview computes everything from the seller's own orders and products, using the same sales and 5% fee formula as `js/seller-earnings.js`.
- The previous wishlist page substituted a stock photo and a fake "Marketplace Product" for rows it could not resolve; the rebuilt page reports unavailable items honestly.
- `js/seller-earnings.js` `openGamBasketFeePayment` shows a browser `alert()` saying to connect the gateway: it is a placeholder, not a working fee payment flow. Not changed here.
- The seller commission is hardcoded at 5% in the earnings module while `js/seller.js` has per-plan rates. The Overview follows the earnings module for consistency; reconcile the two.

## Design references

- Mobile: grey canvas, white rounded cards, "Shop in" header with pill search and filter button, navy chips, 2-up cards with sold count and round add button, floating dark pill navigation with round cart button (active tab expands), circular back/share bar, inline quantity stepper, full-width Add to cart, radio-card payment options.
- Desktop: floating white header with pill search and Orders / Wishlist / Cart / account, chip row, card-based filter sidebar with price histogram, 3-up grid with outlined price pills.
- Brand colours stay blue and white; the references' orange and purple accents were not used.

## Homepage takeover banner

A full-screen, animated, typography-led banner. While one is live the homepage hides every other banner (hero, mobile banner, sell band, stats), the central search bar, the utility bar and the category rail, and shows a minimal bar: round menu button, centred wordmark, search / cart / account icons. Only the homepage changes; other pages keep the normal header.

- Storage: `public.site_banners` (migration `20261115100000_homepage_takeover_banners.sql`).
- One live banner: partial unique index; the toggle RPC switches the others off.
- Visitors read only the live banner inside its optional schedule (RLS); admins read all.
- Writes only via `admin_save_site_banner`, `admin_set_site_banner_active`, `admin_delete_site_banner` (SECURITY DEFINER, each re-checks `public.is_gambasket_admin()`); direct writes are revoked.
- Image links must be `https`; button links must be a relative path or `https` (no colon in the relative pattern, so `javascript:` and `data:` cannot match). The frontend re-validates and escapes everything.
- Manager UI: `admin/banners.html` (also linked from the admin account menu). Preview: `index.html?preview_banner=<id>` (visible to admins only).
- Missing table = no banner (frontend degrades silently), so deploying code before the migration is safe. The manager tells the admin when the migration is missing.
- Images are pasted as https links; there is no upload. A storage bucket with admin-only write policies would be a sensible follow-up.

## Deployment order

1. Apply the migration (additive and idempotent).
2. Deploy the branch.
3. As an admin, open `admin/banners.html`, create a banner, preview it, then switch it on.

## SEO and indexing

The site stays multi-page HTML so every product can be indexed. Before this work there was no sitemap, no robots.txt, no canonical or social tags, and product pages were drawn entirely by JavaScript, so a crawler saw an empty shell. Added as Cloudflare Pages Functions (assumes Cloudflare Pages; the repo also holds `.htaccess` and `server.conf`, which suggests another host may exist, in which case these files are inert and the same behaviour needs equivalent server rules):

| File | Purpose |
|---|---|
| `functions/product.js` | For `/product?id=<uuid>`: reads the approved listing from Supabase's public REST API and injects title, description, canonical, Open Graph/Twitter tags, Product JSON-LD and a readable copy of the listing into the static shell. Unknown id returns 404 with noindex. Any failure serves the plain static page. |
| `functions/sitemap.xml.js` | Key pages, every category, and up to 5,000 approved products with `lastmod`. |
| `functions/robots.txt.js` | Private areas and search/filter combinations disallowed; absolute `Sitemap:` line. |
| `_routes.json` | Limits Functions to those routes so static assets are not billed as invocations. |
| `_headers` | `X-Robots-Tag: noindex` for account, dashboard and auth pages; nosniff and referrer policy; short stale-while-revalidate caching for css/js. |

Credentials: the functions use `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` environment variables if set, otherwise they read the same public values from `js/config.js`. Nothing secret is introduced.

Not done: category and search result pages (`explore`) are still rendered client-side. Product URLs are discoverable through the sitemap, which is the main indexing path, but server-rendering `explore` would help category pages rank. After deploying, submit `/sitemap.xml` in Google Search Console and test a product URL with the URL Inspection tool to confirm the rendered HTML contains the listing.

## Persistent tabs (`js/jd-router.js`)

Home, Explore, Wishlist, Cart and Compare behave like tabs in an app. The pages are still plain HTML (direct loads, refreshes and SEO are unchanged), but once one of them is open, moving between them no longer loads a document.

- Each tab is a *pane* (`div.jd-pane[data-route]`): built the first time it is opened, then kept alive and only hidden. Scroll position, filters, results and form input are still there when you come back. Browser back/forward switch panes.
- The shell (header, floating nav, footer, cart badge, account menu) is mounted once. `JD.mountShell` is idempotent; later calls only repaint.
- The first open of a tab fetches its HTML and runs its page script once. After the first page loads, the other tabs' HTML and scripts are prefetched when the browser is idle (skipped on Save-Data/2G), so first opens are quick too.
- Page scripts are not rewritten. While a pane's script runs, the `document`/`window` listeners it registers are scoped to that pane (clicks only when the target is inside the pane, keys/popstate only while it is showing), so one tab's handlers never react to another tab's DOM. Shell-level listeners use `JD.rawAddEventListener` and stay global.
- Body classes that belong to one tab (`is-homepage`, `has-mobilebar`, `jd-pdp-page`) and the homepage takeover banner are applied only while that tab is showing. Page scripts set tab-owned classes with `JD.paneClass(route, cls, on)`.
- Events for page scripts: `jd:pane:show` (`detail.route`, `detail.first`) and `jd:pane:hide`. Cart, Wishlist, Compare and Home re-read their data on a repeat `show`; Explore closes its filter drawer on `hide` and honours `#filters` on `show`.
- Links and GET search forms that point at one of these five pages are handled in-app. Everything else (account, orders, messages, product pages, seller/admin areas), modified clicks, `target`, `download` and `data-no-router` links, and any error, use a normal page load.
- `JD.go(url)` navigates in-app when it can (used by the area picker).
- Not yet in-app: product detail pages and the account area (`me`, `orders`, `messages`, `saved-searches`). The account pages are legacy and run inline scripts, so they need migrating first. Product pages would need per-product panes with cleanup.

## App-like navigation (without a single-page app)

- Cross-document view transitions (`@view-transition`): header, floating nav, buy bar and seller sidebar stay in place while the content cross-fades (Chrome and Safari; others get a short fade-in).
- Speculative prefetching (Speculation Rules, with a link-prefetch fallback), primary tabs warmed eagerly; skipped on Save-Data and 2G.
- `JD.swr`: cached-first rendering of public marketplace data (home lists, every Explore query, product pages), re-rendering only when fresh data differs. Never used for carts, wishlists or orders.
- Back/forward cache: restored pages refresh cart, account, wishlist and compare state.
- `manifest.webmanifest` and `sw.js`: installable shell. The worker is network-first for pages and css/js (a deploy is never masked by a stale copy), cache-first for images, and never touches cross-origin or non-GET requests. To remove it, deploy a `sw.js` that unregisters itself.
- The manifest only has an SVG icon; install prompts on some browsers need 192px and 512px PNG icons.

## Unchanged by design

Payments, COD commission reserve, ModemPay verification, order transactions and every existing migration, function and policy are untouched. `checkout.html` keeps the Cash on Delivery / "Coming soon" contract the deployed smoke test asserts.

## Before merging

- Run the existing validation and Playwright suites. Expect failures: `tests/marketplace-smoke.spec.js` and related specs target the old DOM of the homepage, Explore, product and cart pages and must be updated (not weakened) to the new selectors. Keep `is-homepage` on the homepage body and `#productGrid` on Explore (the deployed smoke test checks them).
- Browser-test desktop and mobile: floating nav expand/hover, area sheet, filter drawer, price slider, add to cart, wishlist, compare, checkout, banner on/off and preview.
- Verify banner RLS as anon, buyer and admin, and that a non-admin calling the RPCs is rejected.
- Check `Best seller` (>= 10 sales) is the label rule you want.

## Known limitations

- No star-rating or brand-checkbox filters: listings have no aggregated rating or structured brand field, and none were invented.
- Category counts and the price histogram are computed in the browser from up to 5,000 listings; move to a database view past that size.
- No dark mode in the v2 design (the legacy toggle was not carried over).
- Delivery wording on the product page reads `delivery_available`; confirm what checkout does for items where it is false.
- `css/style.css` and the legacy page scripts remain for unmigrated pages, so the site is visibly two designs until they are migrated.
- Dark mode is not carried over to the auth and seller skins either (their theme toggles are hidden).
- The auth brand panel text and dashboard illustration are decorative CSS pseudo-elements, so they are not announced by screen readers and cannot be translated without CSS changes.

## Seller Studio (seller dashboard rewrite)

`supplier/index.html` is a new single-page workspace (hash routes `#/overview`, `#/orders`, `#/products`, `#/customers`, `#/reviews`, `#/earnings`, `#/more`) built on `css/sx.css`, `js/sx-data.js` (data layer) and `js/sx-app.js` (UI). It does not use `jd-core.js` or the legacy `seller*.js` scripts. Light and dark themes are supported.

New capabilities: period comparison and zero-filled sales chart, "needs your attention" list, monthly goals, order drawer with timeline and private notes, bulk stock/price editing with a save bar, customer insights (repeat buyers, lifetime spend), public replies to reviews, wallet and payout summary.

**Before deploying:** apply `supabase/migrations/20261119000000_seller_studio_v2.sql`. Without it the Studio still loads: analytics are computed in the browser from the seller's own orders, but goals, order notes and review replies show an "update needed" message. The migration was written but not run against a live database from this environment, so test it on a branch first.

Notes: a price change on a live listing sends it back to `pending_review` (existing `guard_product_write` trigger); stock changes are instant. Money uses merchandise value (subtotal minus discount, cancelled excluded) and the 5% fee estimate; the wallet remains the source of truth. Legacy seller pages (messages, store, website, pickup-delivery, settings, add/edit product) are still linked from the Studio and keep their old design.

## Courier Workspace, Operations Center and Worker Apply

`/delivery/`, `/worker/` and `/worker-apply.html` were rebuilt from scratch on a shared "Field Workforce" kit (`css/fw.css`, `js/fw-core.js`) with a per-surface script and stylesheet (`fw-courier`, `fw-ops`, `fw-apply`). The admin dashboard is untouched. The old `js/delivery.js` and `js/worker.js` are no longer loaded by these pages; `js/delivery.js` stays because `tests/modempay-integration-contract.mjs` still reads it.

- **Courier Workspace:** online/offline with location pings and a shift timer, job board (best fit, pay, nearest, oldest) with polling alerts, claim, a step-by-step run view (item checklist, navigate/call/WhatsApp, OTP proof of delivery, report a problem), earnings with payout requests, history and profile.
- **Operations Center:** a unified inbox (products, applications, reports, delivery issues) with claim locks, decision templates, internal notes, document previews through signed URLs and keyboard shortcuts, plus overview, dispatch board, earnings and activity. Approving a marketplace-worker application is admin-only.
- **Worker Apply:** a guided form with private ID and selfie upload, draft autosave, and an application tracker with a reference code, a timeline, "needs info" replies and withdraw. Sellers still use `submit_verification_request`.

### Database
One migration: `supabase/migrations/20261119100000_field_workforce_v2.sql`. All new functions are `SECURITY DEFINER`, check the caller's role themselves, and are granted to `authenticated` only; the new tables are read-only to clients.

- It was tested on a local Postgres 16 with stubbed Supabase pieces, **never applied to the live project**. Apply it to a Supabase branch first.
- Payout availability is the sum of `earning_transactions` with status `available`, minus payout requests that are pending, approved or processing. This assumes completed payouts flip earnings to `paid_out`.
- Until the migration is applied, the apply page shows a notice and the courier and ops pages show friendly errors.

## Product page, quick view and whole-card taps

- **Product page** (`product.html`, `js/jd-product.js`, `css/jd-pdp.css`) rebuilt from scratch: swipeable gallery with thumbnails, hover zoom and full-screen lightbox; buy box (price, stock, key facts, quantity, add to cart, buy now, save, compare, share, report); delivery and payment assurances; seller panel; section navigation with scroll-spy; read-more description; specifications; rating summary with a star breakdown and verified-purchase reviews; "Buy with confidence" tips; more from this seller; similar items; recently viewed; sticky mobile buy bar. Listing reports use the existing `create_trust_report` RPC. `JD.data.product()` now also returns `moreFromSeller`.
- **Whole product card is tappable.** Tapping anywhere on a card (not its save, compare or add-to-cart buttons) opens the quick-view sheet. Links keep their `href`, so open-in-new-tab, copy-link and crawlers still reach the product page.
- **Quick view** (`js/jd-quickview.js`, loaded on first use by `js/jd-core.js`): bottom sheet on phones (drag handle to dismiss), side drawer on larger screens. Photos, price, stock, rating, seller, quantity, add to cart, buy now, save, compare, share and "View full details". Focus is trapped, Esc closes, and it prefetches on hover.
- **Logo:** "Jula" is black and "Direct" is blue in the header, mobile menu and takeover bar. In the dark footer "Jula" stays white.
- The router smoke test now goes card, quick view, "View full details".

## Home and Explore (v3)

Both pages were rebuilt from scratch (`index.html`, `css/jd-home2.css`, `js/jd-home.js`; `explore.html`, `css/jd-explore2.css`, `js/jd-explore.js`). The data layer, URL contract and admin banner are unchanged.

- **Home:** dark hero with live search, popular searches, live stats and a four-tile deck of fresh listings; trust strip; category tiles with real photos; shop by budget and by place shortcuts; "Picked for you" tabs (just listed, delivery ready, under D1,000, like new and refurbished); ranked best-sellers rail; how buying works; verified sellers; recently visited; seller and courier calls to action; FAQ. The admin-managed takeover banner (`#jd-takeover`) and the `is-homepage` body class are kept.
- **Explore:** search with recent searches and category suggestions; category photo rail; quick-filter pills; collapsible filter groups (price histogram and dual slider, condition, location, availability, brand); grid or list view (remembered on the device); sort; active filter chips; seller strip; save search; recently viewed; suggestions on empty results. Filters apply live on desktop and from a bottom sheet with "Show results" on phones. URL parameters (`q, category, location, min, max, condition, stock, delivery, sort, brandModel, seller, page`) are unchanged, so saved searches keep working. `#productGrid` is kept for the router smoke test.

## Home hero v4 (auto-sliding banner)
The dark hero with the search box is replaced by a four-slide, auto-rotating campaign banner on desktop and phones (cash on delivery, just listed, under D1,000, sell with us). Product art in the slides is live data; slide 2's line uses live listing and seller counts. Native scroll-snap swipe, dots with a progress fill, prev/next on desktop, a pause button, and it pauses on hover, touch, focus, hidden tab, off-screen and with reduced motion. Phones also get a 4-up category grid, swipeable pill rows and a swipeable "how it works". Search lives in the sticky header (Search v2).
