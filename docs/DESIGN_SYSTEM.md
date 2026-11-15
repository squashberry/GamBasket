# JulaDirect design system

Part 1 of the product transformation (branch `juladirect-transformation`).

- `css/jd-system.css` loads last on every page. It remaps the legacy tokens (`--blue`, `--surface`, `--text`, `--border` ...) to the new identity, so existing pages re-theme without markup changes, and adds `.jd-*` building blocks (`jd-card`, `jd-btn`, `jd-badge`, `jd-stat`, `jd-table`, `jd-empty`, `jd-toast`).
- `js/jd-ui.js` adds the skip link, header scroll state, reveal-on-scroll and `window.JD.toast(message, { type })`.
- Hard-coded brand blues in CSS, HTML and JS were converted to `var(--blue)` / `var(--blue-dark)` / `var(--blue-light)`, so light and dark themes both stay consistent.
- No database, backend, payment, auth, refund or ledger code was changed.

Palette: the JulaDirect brand blue `#2563eb` (hover `#1d4ed8`, tint `#eaf3ff`) with cool neutrals, plus a sun `#f2a20c` accent for primary calls to action and laterite `#b73e17` for eyebrows. Display headings use a system serif stack (no web-font download) to stay fast on slow connections.
