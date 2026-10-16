# GamBasket test preview

GamBasket is a browser-based marketplace prototype for The Gambia. This repository is published as a **test preview** at https://squashberry.github.io/GamBasket/; it is not a production launch declaration.

## Key preview routes

- [Explore marketplace](https://squashberry.github.io/GamBasket/explore.html)
- [Compare products](https://squashberry.github.io/GamBasket/compare.html)
- [Saved searches and price alerts](https://squashberry.github.io/GamBasket/saved-searches.html)

## Development checks

- `npm install --no-audit --no-fund`
- `npm run test:e2e` — Playwright browser tests with mocked backend responses
- `node tests/live-supabase-contract.mjs` — read-only checks against the configured Supabase Data API
- `GAMBASKET_SITE_URL=https://squashberry.github.io/GamBasket/ node tests/deployed-site-smoke.mjs` — verifies deployed pages and assets

See [docs/TESTING_AND_RELEASE.md](docs/TESTING_AND_RELEASE.md) for the Stage C/D workflows, limits, and pre-launch checklist.