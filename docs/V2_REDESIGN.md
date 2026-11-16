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
