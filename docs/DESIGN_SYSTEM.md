# JulaDirect design system

Part 1 of the product transformation (branch `juladirect-transformation`).

- `css/jd-system.css` loads last on every page. It remaps the legacy tokens (`--blue`, `--surface`, `--text`, `--border` ...) to the new identity, so existing pages re-theme without markup changes, and adds `.jd-*` building blocks (`jd-card`, `jd-btn`, `jd-badge`, `jd-stat`, `jd-table`, `jd-empty`, `jd-toast`).
- `js/jd-ui.js` adds the skip link, header scroll state, reveal-on-scroll and `window.JD.toast(message, { type })`.
- Hard-coded brand blues in CSS, HTML and JS were converted to `var(--blue)` / `var(--blue-dark)` / `var(--blue-light)`, so light and dark themes both stay consistent.
- No database, backend, payment, auth, refund or ledger code was changed.

Palette: river teal `#0a6b62`, sun `#f2a20c`, laterite `#b73e17` on warm paper `#faf7f1`. Display headings use a system serif stack (no web-font download) to stay fast on slow connections.
