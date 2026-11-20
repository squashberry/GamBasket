/* =========================================================
   Field Workforce core: shared helpers for the Courier Workspace, Operations Center and Worker Apply.
   Exposes window.FW. No page-specific logic lives here.
   ========================================================= */
(function () {
  "use strict";
  const FW = (window.FW = window.FW || {});

  /* ---------- tiny helpers ---------- */
  FW.$ = (s, r) => (r || document).querySelector(s);
  FW.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  FW.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  FW.num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  FW.money = n => "D " + FW.num(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  FW.label = s => String(s || "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  FW.safeUrl = u => { try { const x = new URL(String(u || ""), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };
  FW.day = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  FW.dayTime = d => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  FW.time = d => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  FW.ago = d => {
    const s = (Date.now() - +new Date(d)) / 1000;
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 7) return Math.round(s / 86400) + " d ago";
    return FW.day(d);
  };
  FW.mins = m => { m = Math.max(0, Math.round(FW.num(m))); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60 ? (m % 60) + " min" : ""); };
  FW.initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "?";
  FW.km = (a, b) => {
    if (!a || !b || [a.lat, a.lng, b.lat, b.lng].some(v => !Number.isFinite(Number(v)) || v === null)) return null;
    const R = 6371, rad = x => Number(x) * Math.PI / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  /* A Postgres exception arrives as error.message; strip noise and give a human sentence. */
  FW.errText = e => {
    const m = String((e && (e.message || e.error_description)) || e || "").replace(/^.*?(ERROR:\s*)/i, "").trim();
    if (/jwt|not authenticated|authentication required/i.test(m)) return "Your session expired. Please sign in again.";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "You seem to be offline. Check your connection and try again.";
    if (/could not find the function|PGRST202|schema cache/i.test(m)) return "This feature needs the latest database update to be applied.";
    return m || "Something went wrong. Please try again.";
  };

  /* ---------- icons ---------- */
  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
    bag: '<path d="M6 3h12l2 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"/><path d="M4 8h16M9 12a3 3 0 0 0 6 0"/>',
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
    wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v3"/><rect x="3" y="8" width="18" height="12" rx="2.5"/><circle cx="16.5" cy="14" r="1.2"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.7 3.2-5.5 7-5.5s6.3 1.8 7 5.5"/>',
    inbox: '<path d="M4 13l2.5-7h11L20 13"/><path d="M4 13v6h16v-6h-5l-1.5 2h-3L9 13z"/>',
    truck: '<rect x="1.5" y="6" width="12" height="10" rx="1.5"/><path d="M13.5 9H18l3.5 3.5V16h-8"/><circle cx="6" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M18 9.5a6 6 0 0 0-12 0c0 5-2 6.5-2 8h16c0-1.5-2-3-2-8z"/><path d="M10 20h4"/>',
    moon: '<path d="M20 14.6A8.3 8.3 0 0 1 9.4 4 8.3 8.3 0 1 0 20 14.6Z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    shield: '<path d="M12 3 19 6v5c0 4.7-3 8-7 10-4-2-7-5.3-7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
    nav: '<path d="m3 11 18-8-8 18-2-8z"/>',
    flag: '<path d="M5 21V4M5 5h12l-2.5 3.5L17 12H5"/>',
    star: '<path d="m12 3.5 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z"/>'
  };
  FW.icon = n => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || "") + "</svg>";
  FW.hydrateIcons = root => FW.$$("[data-icon]", root).forEach(el => { el.innerHTML = FW.icon(el.getAttribute("data-icon")) + el.innerHTML; el.removeAttribute("data-icon"); });

  /* ---------- theme ---------- */
  FW.theme = {
    init() { try { const t = localStorage.getItem("gambasket-theme"); if (t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark"); } catch (e) { /* storage blocked */ } },
    toggle() { const d = document.documentElement.classList.toggle("dark"); try { localStorage.setItem("gambasket-theme", d ? "dark" : "light"); } catch (e) { /* ignore */ } }
  };
  FW.theme.init();

  /* ---------- toast ---------- */
  FW.toast = function (msg, tone) {
    let host = FW.$("#fwToasts");
    if (!host) { host = document.createElement("div"); host.id = "fwToasts"; host.className = "fw-toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
    const el = document.createElement("div");
    el.className = "fw-toast" + (tone ? " fw-toast--" + tone : "");
    el.textContent = msg; host.appendChild(el);
    setTimeout(() => el.remove(), tone === "bad" ? 6500 : 3600);
  };

  /* ---------- sheet (drawer / bottom sheet) ---------- */
  let sheet = null, sheetFrom = null, sheetOnClose = null;
  function ensureSheet() {
    if (sheet) return sheet;
    const scrim = document.createElement("div"); scrim.className = "fw-scrim"; scrim.id = "fwScrim";
    const el = document.createElement("aside"); el.className = "fw-sheet"; el.id = "fwSheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-hidden", "true"); el.setAttribute("aria-labelledby", "fwSheetTitle");
    el.innerHTML = '<div class="fw-sheet__head"><h2 id="fwSheetTitle"></h2><button class="fw-icon-btn" type="button" id="fwSheetClose" aria-label="Close">' + FW.icon("close") + '</button></div><div class="fw-sheet__body" id="fwSheetBody"></div><div class="fw-sheet__foot" id="fwSheetFoot"></div>';
    document.body.append(scrim, el);
    scrim.addEventListener("click", () => FW.sheet.close());
    FW.$("#fwSheetClose").addEventListener("click", () => FW.sheet.close());
    document.addEventListener("keydown", e => { if (e.key === "Escape" && el.classList.contains("is-on")) FW.sheet.close(); });
    sheet = el; return el;
  }
  FW.sheet = {
    open(o) {
      const el = ensureSheet(); sheetFrom = document.activeElement; sheetOnClose = o.onClose || null;
      FW.$("#fwSheetTitle").textContent = o.title || "";
      FW.$("#fwSheetBody").innerHTML = o.body || "";
      const foot = FW.$("#fwSheetFoot"); foot.innerHTML = o.foot || ""; foot.style.display = o.foot ? "" : "none";
      el.classList.add("is-on"); FW.$("#fwScrim").classList.add("is-on"); el.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden"; FW.$("#fwSheetClose").focus();
      return el;
    },
    body: () => FW.$("#fwSheetBody"), foot: () => FW.$("#fwSheetFoot"),
    isOpen: () => !!sheet && sheet.classList.contains("is-on"),
    close() {
      if (!sheet || !sheet.classList.contains("is-on")) return;
      sheet.classList.remove("is-on"); FW.$("#fwScrim").classList.remove("is-on"); sheet.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      const cb = sheetOnClose; sheetOnClose = null; if (cb) cb();
      if (sheetFrom && sheetFrom.focus) { try { sheetFrom.focus(); } catch (e) { /* removed */ } }
    }
  };

  /* ---------- dialog: ask({title, body, fields:[{name,label,type,value,required,options,hint,max}], confirm, cancel, danger}) ---------- */
  FW.ask = function (o) {
    return new Promise(resolve => {
      const dlg = document.createElement("dialog"); dlg.className = "fw-dialog";
      const field = f => {
        const common = 'name="' + FW.esc(f.name) + '" ' + (f.required ? "required " : "") + (f.max ? 'maxlength="' + f.max + '" ' : "");
        let input;
        if (f.type === "textarea") input = '<textarea class="fw-textarea" ' + common + 'placeholder="' + FW.esc(f.placeholder || "") + '">' + FW.esc(f.value || "") + "</textarea>";
        else if (f.type === "select") input = '<select class="fw-select" ' + common + ">" + (f.options || []).map(x => '<option value="' + FW.esc(x[0]) + '"' + (x[0] === f.value ? " selected" : "") + ">" + FW.esc(x[1]) + "</option>").join("") + "</select>";
        else input = '<input class="fw-input" type="' + (f.type || "text") + '" ' + common + 'value="' + FW.esc(f.value == null ? "" : f.value) + '" ' + (f.min != null ? 'min="' + f.min + '" ' : "") + (f.max != null && f.type === "number" ? 'max="' + f.max + '" ' : "") + (f.step ? 'step="' + f.step + '" ' : "") + (f.inputmode ? 'inputmode="' + f.inputmode + '" ' : "") + (f.pattern ? 'pattern="' + f.pattern + '" ' : "") + (f.autocomplete ? 'autocomplete="' + f.autocomplete + '" ' : "") + 'placeholder="' + FW.esc(f.placeholder || "") + '">';
        return '<label class="fw-field">' + FW.esc(f.label) + input + (f.hint ? "<small>" + FW.esc(f.hint) + "</small>" : "") + "</label>";
      };
      dlg.innerHTML = '<form method="dialog"><h2>' + FW.esc(o.title) + "</h2>" + (o.body ? '<p class="fw-muted">' + FW.esc(o.body) + "</p>" : "") + (o.html || "") + (o.fields || []).map(field).join("") +
        '<menu><button class="fw-btn" value="cancel" formnovalidate>' + FW.esc(o.cancel || "Cancel") + '</button><button class="fw-btn ' + (o.danger ? "fw-btn--danger" : "fw-btn--primary") + '" value="ok">' + FW.esc(o.confirm || "Confirm") + "</button></menu></form>";
      document.body.appendChild(dlg);
      dlg.addEventListener("close", () => {
        const ok = dlg.returnValue === "ok", vals = {};
        FW.$$("[name]", dlg).forEach(i => { vals[i.name] = i.value; });
        dlg.remove(); resolve(ok ? ((o.fields && o.fields.length) ? vals : true) : null);
      });
      dlg.showModal(); const first = FW.$("[name]", dlg); if (first) first.focus();
    });
  };

  /* ---------- Supabase access ---------- */
  FW.state = { client: null, user: null, roles: [], profile: null };
  FW.client = () => FW.state.client;
  FW.rpc = async function (name, args) {
    const { data, error } = await FW.state.client.rpc(name, args || {});
    if (error) { const e = new Error(FW.errText(error)); e.cause = error; throw e; }
    return data;
  };
  FW.signedUrl = async function (path, seconds) {
    if (!path || path.startsWith("/") || path.includes("..") || !path.includes("/")) throw new Error("Invalid private document reference.");
    const { data, error } = await FW.state.client.storage.from("verification-documents").createSignedUrl(path, seconds || 300);
    if (error) throw new Error(FW.errText(error));
    return data.signedUrl;
  };

  /* Gate a role-protected page. Resolves to true once the app may be shown. */
  FW.boot = async function (role) {
    try {
      const ok = window.GamBasketGuard && window.GamBasketGuard.gatePage ? await window.GamBasketGuard.gatePage(role) : false;
      if (!ok) return false;
      await window.GamBasketAuth.ready();
      const ctx = window.GamBasketAuthContext || {};
      FW.state.client = window.GamBasketAuth.getClient();
      FW.state.user = ctx.user || await window.GamBasketAuth.getUser();
      FW.state.roles = ctx.roles || [];
      FW.state.profile = ctx.profile || {};
      if (!FW.state.client || !FW.state.user) throw new Error("We couldn't connect to your account.");
      return true;
    } catch (e) {
      console.error("[FW] boot failed:", e);
      const g = FW.$("#fwGate"); if (g) g.innerHTML = '<div><h2 style="color:var(--fw-ink)">We couldn\'t open this workspace</h2><p>' + FW.esc(FW.errText(e)) + '</p><p><a href="../login.html?redirect=' + encodeURIComponent(location.pathname) + '">Sign in again</a></p></div>';
      return false;
    }
  };
  FW.displayName = () => {
    const p = FW.state.profile || {}, n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    return n || (FW.state.user && FW.state.user.email ? FW.state.user.email.split("@")[0] : "You");
  };

  /* ---------- hash router: routes = {name: fn(host)}; views are <section id="v-name"> ---------- */
  FW.router = function (routes, o) {
    o = o || {}; let token = 0, current = "";
    async function go(force) {
      const raw = location.hash.replace(/^#\/?/, "").split("?")[0], name = routes[raw] ? raw : (o.fallback || Object.keys(routes)[0]);
      current = name; const my = ++token;
      FW.$$(".fw-view").forEach(v => { v.hidden = v.id !== "v-" + name; });
      FW.$$("[data-route]").forEach(a => { if (a.getAttribute("data-route") === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
      const title = FW.$("#fwTitle"); if (title && o.titles) title.textContent = o.titles[name] || "";
      if (o.titles) document.title = (o.titles[name] || "") + " · " + (o.brand || "JulaDirect");
      const host = FW.$("#v-" + name);
      try { await routes[name](host, !!force); } catch (e) { if (my === token) { console.error("[FW]", e); host.innerHTML = '<div class="fw-empty"><h3>Couldn\'t load this page</h3><p>' + FW.esc(FW.errText(e)) + '</p><p><button class="fw-btn" data-fw-retry type="button">Try again</button></p></div>'; } }
      if (!force) window.scrollTo({ top: 0 });
      if (o.after) o.after(name);
    }
    window.addEventListener("hashchange", () => go(false));
    document.addEventListener("click", e => { if (e.target.closest("[data-fw-retry]")) go(true); });
    return { go, current: () => current, reload: () => go(true) };
  };

  /* ---------- polling that pauses when the tab is hidden ---------- */
  FW.poll = function (fn, ms) {
    let t = null;
    const tick = async () => { if (!document.hidden) { try { await fn(); } catch (e) { console.warn("[FW] poll", e); } } };
    return { start() { if (!t) t = setInterval(tick, ms); }, stop() { clearInterval(t); t = null; }, now: tick };
  };

  /* ---------- small chart: bars from [{label, value}] ---------- */
  FW.bars = (series, fmt) => {
    const max = Math.max(1, ...series.map(s => s.value));
    return '<div class="fw-bars" role="img" aria-label="' + FW.esc(series.map(s => s.label + " " + (fmt ? fmt(s.value) : s.value)).join(", ")) + '">' +
      series.map(s => '<div title="' + FW.esc(s.label + ": " + (fmt ? fmt(s.value) : s.value)) + '"><b style="height:' + Math.max(3, Math.round(s.value / max * 84)) + 'px"></b><span>' + FW.esc(s.label) + "</span></div>").join("") + "</div>";
  };

  /* ---------- wallet panel shared by couriers and operations workers ---------- */
  const PAYOUT_TONE = { pending: "warn", approved: "info", processing: "info", completed: "good", rejected: "bad" };
  FW.wallet = async function (host, role, o) {
    o = o || {};
    host.innerHTML = '<div class="fw-skel" style="height:110px"></div>';
    const [w, payouts] = await Promise.all([FW.rpc("worker_wallet", { p_role: role }), FW.rpc("worker_payouts", { p_role: role })]);
    const kpi = (l, v, m) => '<section class="fw-card fw-kpi"><div class="fw-kpi__l">' + l + '</div><div class="fw-kpi__v fw-num">' + FW.esc(v) + '</div><div class="fw-kpi__m">' + m + "</div></section>";
    const canWithdraw = FW.num(w.available) >= FW.num(w.min_payout);
    host.innerHTML = '<div class="fw-grid fw-grid--kpi">' +
      kpi("Available", FW.money(w.available), canWithdraw ? '<button class="fw-btn fw-btn--primary fw-btn--sm" data-fw-payout type="button">Request payout</button>' : "Minimum payout is " + FW.money(w.min_payout)) +
      kpi("Payout pending", FW.money(w.pending_payout), "waiting for the admin team") + kpi("Paid out", FW.money(w.paid_out), "all time") + kpi("Lifetime earned", FW.money(w.lifetime), "since you joined") + "</div>" +
      '<div class="fw-grid fw-grid--2" style="margin-top:14px"><section class="fw-card"><div class="fw-card__head"><h2>Earnings</h2></div><div class="fw-card__body"><div class="fw-list">' +
      (w.recent.length ? w.recent.map(r => '<div class="fw-li"><div><b>' + FW.esc(r.description || FW.label(r.action_type)) + "</b><small>" + FW.esc(FW.dayTime(r.created_at)) + " · " + FW.esc(FW.label(r.status)) + '</small></div><b class="fw-num" style="color:var(--fw-good)">+ ' + FW.esc(FW.money(r.amount)) + "</b></div>").join("") : '<div class="fw-empty"><h3>No earnings yet</h3><p>Completed work shows up here.</p></div>') +
      '</div></div></section><section class="fw-card"><div class="fw-card__head"><h2>Payout requests</h2></div><div class="fw-card__body"><div class="fw-list">' +
      (payouts.length ? payouts.map(p => '<div class="fw-li"><div><b class="fw-num">' + FW.esc(FW.money(p.amount)) + "</b><small>" + FW.esc(FW.label(p.payment_method)) + " · " + FW.esc(FW.dayTime(p.created_at)) + (p.admin_notes ? " · " + FW.esc(p.admin_notes) : "") + '</small></div><span class="fw-pill fw-pill--' + (PAYOUT_TONE[p.status] || "") + '">' + FW.esc(FW.label(p.status)) + "</span></div>").join("") : '<div class="fw-empty"><h3>No payout requests</h3><p>Request a payout once you reach the minimum.</p></div>') + "</div></div></section></div>";
    const btn = FW.$("[data-fw-payout]", host);
    if (btn) btn.addEventListener("click", async () => {
      const v = await FW.ask({ title: "Request a payout", body: "Available now: " + FW.money(w.available) + ". The admin team sends the money and updates the status here.", confirm: "Send request",
        fields: [{ name: "amount", label: "Amount (D)", type: "number", value: FW.num(w.available), min: FW.num(w.min_payout), max: FW.num(w.available), step: "0.01", required: true, inputmode: "decimal" },
          { name: "method", label: "Pay me with", type: "select", value: "wave", options: [["wave", "Wave"], ["qmoney", "QMoney"], ["afrimoney", "Afrimoney"], ["bank_transfer", "Bank transfer"], ["cash", "Cash pickup"]] },
          { name: "account", label: "Mobile number or account", required: true, max: 100, placeholder: "+220 …", autocomplete: "tel", hint: "Double-check it: payouts go exactly here." }] });
      if (!v) return;
      btn.disabled = true;
      try { await FW.rpc("worker_request_payout", { p_role: role, p_amount: FW.num(v.amount), p_method: v.method, p_account: v.account }); FW.toast("Payout requested", "good"); if (o.onChange) o.onChange(); await FW.wallet(host, role, o); }
      catch (e) { FW.toast(FW.errText(e), "bad"); btn.disabled = false; }
    });
  };

  /* ---------- notifications (own rows only, via RLS) ---------- */
  FW.notifications = async function (limit) {
    const { data, error } = await FW.state.client.from("notifications").select("id,type,title,message,is_read,created_at").eq("user_id", FW.state.user.id).order("created_at", { ascending: false }).limit(limit || 20);
    if (error) return [];
    return data || [];
  };
})();
