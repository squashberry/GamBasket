/* =========================================================
   Courier Workspace. One page, hash routes (#/home, #/jobs, #/run, #/earnings, #/history, #/profile).
   Data comes from the courier_* RPCs in 20261119100000_field_workforce_v2.sql plus the existing
   claim_delivery_job / update_delivery_job_status RPCs and the gambasket-delivery-proof edge function.
   ========================================================= */
(function () {
  "use strict";
  const FW = window.FW, $ = FW.$, $$ = FW.$$, esc = FW.esc, money = FW.money, num = FW.num;

  const S = { dash: null, board: { online: false, jobs: [] }, active: null, me: null, sort: "area", watch: null, lastPing: 0, boardKey: "", timer: null, hist: [], histDone: false, router: null, checks: {} };
  const STAGES = [["assigned", "Claimed"], ["picked_up", "Picked up"], ["out_for_delivery", "On the way"], ["delivered", "Delivered"]];
  const NEXT = { assigned: ["picked_up", "Confirm pickup"], picked_up: ["out_for_delivery", "Start delivery"], out_for_delivery: ["delivered", "Confirm delivery"] };
  const KINDS = [["customer_unreachable", "Customer isn't answering"], ["wrong_address", "Address is wrong or can't be found"], ["seller_not_ready", "Seller isn't ready"], ["item_problem", "Problem with the item"], ["vehicle_problem", "My vehicle broke down"], ["safety", "I don't feel safe"], ["other", "Something else"]];
  const ISSUE_TONE = { open: "warn", resolved: "good" };
  const isOnline = () => !!(S.dash && ["available", "delivering"].includes(S.dash.profile.status));
  const digits = p => String(p || "").replace(/[^\d]/g, "");
  const checkOk = d => { if (d && (d.success === false || d.error)) throw new Error(d.error || "That didn't work. Please try again."); return d; };

  /* ---------- data ---------- */
  async function loadDash() { S.dash = await FW.rpc("courier_dashboard"); chrome(); return S.dash; }
  async function loadBoard() { S.board = await FW.rpc("courier_job_board"); return S.board; }
  async function loadActive() { S.active = await FW.rpc("courier_active_job"); chrome(); return S.active; }

  function chrome() {
    const d = S.dash; if (!d) return;
    const on = isOnline(), run = !!d.active_request_id || !!S.active;
    $("#cwState").textContent = d.profile.status === "delivering" ? "On a run" : on ? "Online" : "Offline";
    $("#cwTopState").className = "fw-pill " + (on ? "fw-pill--good" : "");
    $("#cwTopState").innerHTML = '<i class="fw-dot' + (on ? " fw-dot--on" : "") + '"></i> ' + (d.profile.status === "delivering" ? "On a run" : on ? "Online" : "Offline");
    ["cwRunDot", "cwRunDotM"].forEach(id => { $("#" + id).hidden = !run; });
    const n = S.board.jobs.length;
    ["cwJobsBadge", "cwJobsBadgeM"].forEach(id => { const b = $("#" + id); b.hidden = !(on && n && !run); b.textContent = n; });
  }

  /* ---------- location ---------- */
  function startWatch() {
    if (S.watch != null || !navigator.geolocation) return;
    S.watch = navigator.geolocation.watchPosition(p => {
      S.me = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (Date.now() - S.lastPing > 30000) { S.lastPing = Date.now(); FW.rpc("courier_ping", { p_lat: S.me.lat, p_lng: S.me.lng }).catch(() => {}); }
    }, () => {}, { enableHighAccuracy: false, maximumAge: 20000, timeout: 15000 });
  }
  function stopWatch() { if (S.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(S.watch); S.watch = null; }
  function oneShot() {
    return new Promise(res => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition(p => { S.me = { lat: p.coords.latitude, lng: p.coords.longitude }; res(S.me); }, () => res(null), { timeout: 6000, maximumAge: 60000 }); });
  }

  async function setOnline(on) {
    try {
      const pos = on ? await oneShot() : null;
      await FW.rpc("courier_set_availability", { p_online: on, p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null });
      if (on) { startWatch(); FW.toast(pos ? "You're online. Jobs near you will show up." : "You're online. Turn on location to see distances.", "good"); } else { stopWatch(); FW.toast("You're offline. Nice work today."); }
      await Promise.all([loadDash(), on ? loadBoard() : Promise.resolve(S.board = { online: false, jobs: [] })]);
      chrome(); S.router.reload();
    } catch (e) { FW.toast(FW.errText(e), "bad"); S.router.reload(); }
  }

  /* ---------- helpers: rendering ---------- */
  const skel = n => '<div class="fw-stack">' + Array.from({ length: n }, () => '<div class="fw-skel" style="height:96px"></div>').join("") + "</div>";
  const stat = (l, v, m) => '<section class="fw-card fw-kpi"><div class="fw-kpi__l">' + l + '</div><div class="fw-kpi__v fw-num">' + esc(v) + '</div><div class="fw-kpi__m">' + m + "</div></section>";
  function navUrl(lat, lng, text) {
    const dest = Number.isFinite(Number(lat)) && lat !== null && Number.isFinite(Number(lng)) && lng !== null ? lat + "," + lng : text || "";
    return dest ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest) : "";
  }
  const linkBtn = (href, icon, text, cls) => href ? '<a class="fw-btn ' + (cls || "") + '" href="' + esc(href) + '" target="_blank" rel="noopener">' + FW.icon(icon) + esc(text) + "</a>" : "";
  const telBtn = (phone, text) => digits(phone) ? '<a class="fw-btn" href="tel:' + esc(digits(phone).replace(/^/, phone && String(phone).trim().startsWith("+") ? "+" : "")) + '">' + FW.icon("phone") + esc(text) + "</a>" : "";
  const waBtn = (phone, text) => digits(phone).length >= 7 ? '<a class="fw-btn" href="https://wa.me/' + digits(phone) + '" target="_blank" rel="noopener">' + esc(text) + "</a>" : "";

  /* ---------- HOME ---------- */
  async function viewHome(el) {
    el.innerHTML = skel(3);
    const [d, series] = await Promise.all([loadDash(), FW.rpc("courier_earnings_series", { p_days: 14 })]);
    await Promise.all([isOnline() ? loadBoard() : Promise.resolve(), loadActive()]);
    chrome();
    const on = isOnline(), a = S.active;
    const since = d.profile.online_since;
    const best = on && !a ? S.board.jobs.slice().sort((x, y) => num(y.fee) - num(x.fee))[0] : null;
    const notes = await FW.notifications(5);
    el.innerHTML = '<div class="fw-stack">' +
      (!d.profile.verified ? '<div class="fw-note fw-note--warn"><b>Your courier account is waiting for verification.</b> You can go online as soon as the operations team confirms your documents.</div>' : "") +
      '<section class="fw-card cw-online ' + (on ? "cw-online--on" : "") + '"><div><h2>' + (on ? (d.profile.status === "delivering" ? "You're on a run" : "You're online") : "You're offline") + '</h2><p class="fw-muted">' +
      (on ? "On shift for <b class=\"cw-timer\" id=\"cwTimer\">" + esc(since ? FW.mins((Date.now() - +new Date(since)) / 60000) : "0 min") + "</b>" : "Go online to see delivery requests near you.") + '</p></div>' +
      '<button class="fw-switch" id="cwSwitch" type="button" role="switch" aria-checked="' + on + '" aria-label="Online status"' + (!d.profile.verified || d.profile.status === "delivering" ? " disabled" : "") + "></button></section>" +
      (a ? '<a class="fw-card" href="#/run" style="display:block;padding:16px 18px;text-decoration:none;border-color:var(--fw-accent)"><div class="fw-row fw-row--between"><div><span class="fw-pill fw-pill--accent">Current run</span><h3 style="margin-top:6px;color:var(--fw-ink)">' + esc(a.order_number) + " · " + esc(FW.label(a.status)) + '</h3><p class="fw-muted">' + esc(a.delivery_destination || a.delivery_area || "") + '</p></div><b style="color:var(--fw-accent)">Open ' + FW.icon("arrow") + "</b></div></a>" : "") +
      (best ? '<section class="fw-card" style="padding:16px 18px"><div class="fw-row fw-row--between"><div><span class="fw-pill fw-pill--good">Best paying right now</span><h3 style="margin-top:6px">' + esc(best.delivery_area || best.delivery_destination || "Delivery") + '</h3><p class="fw-muted">' + esc(best.order_number) + " · " + best.items + ' item(s)</p></div><div class="cw-fee fw-num">' + esc(money(best.fee)) + '</div></div><p style="margin-top:12px"><a class="fw-btn fw-btn--primary fw-btn--block" href="#/jobs">See all ' + S.board.jobs.length + " jobs</a></p></section>" : "") +
      '<div class="fw-grid fw-grid--kpi">' + stat("Today", money(d.today.earned), d.today.deliveries + (d.today.deliveries === 1 ? " delivery" : " deliveries")) + stat("This week", money(d.week.earned), d.week.deliveries + " deliveries") + stat("This month", money(d.month.earned), d.month.deliveries + " deliveries") + stat("Avg. time", d.avg_minutes ? FW.mins(d.avg_minutes) : "–", "claim to delivered, last 30 days") + "</div>" +
      '<section class="fw-card"><div class="fw-card__head"><h2>Last 14 days</h2><a href="#/earnings">Earnings →</a></div><div class="fw-card__body">' + FW.bars(series.map(s => ({ label: FW.day(s.day).split(" ")[0], value: num(s.earned) })), money) + "</div></section>" +
      (d.open_issues ? '<div class="fw-note fw-note--warn">You have ' + d.open_issues + " open problem report" + (d.open_issues === 1 ? "" : "s") + ". Operations will reply here.</div>" : "") +
      (notes.length ? '<section class="fw-card"><div class="fw-card__head"><h2>Updates</h2></div><div class="fw-card__body"><div class="fw-list">' + notes.map(n => '<div class="fw-li"><div><b>' + esc(n.title) + "</b><small>" + esc(n.message) + "</small></div><small>" + esc(FW.ago(n.created_at)) + "</small></div>").join("") + "</div></div></section>" : "") + "</div>";
    clearInterval(S.timer);
    if (on && since && $("#cwTimer")) S.timer = setInterval(() => { const t = $("#cwTimer"); if (t) t.textContent = FW.mins((Date.now() - +new Date(since)) / 60000); }, 30000);
  }

  /* ---------- JOBS ---------- */
  function jobCard(j) {
    const km = FW.km(S.me, { lat: j.pickup_lat, lng: j.pickup_lng });
    return '<article class="fw-card cw-job"><div class="cw-job__top"><div><div class="cw-meta">' + (j.in_my_area ? '<span class="fw-pill fw-pill--good">In your area</span>' : '<span class="fw-pill">' + esc(j.delivery_area || "Other area") + "</span>") + (km != null ? '<span class="fw-pill fw-pill--info">' + km.toFixed(1) + " km to pickup</span>" : "") + '</div><h3 style="margin-top:8px">' + esc(j.order_number) + '</h3></div><div class="cw-fee fw-num">' + esc(money(j.fee)) + "</div></div>" +
      '<div class="cw-route"><div><small>Pickup</small>' + esc(j.pickup_location || "Seller location") + '</div><div><small>Drop-off</small>' + esc(j.delivery_destination || j.delivery_area || "Customer address") + "</div></div>" +
      '<div class="cw-meta"><span class="fw-pill">' + j.items + " item" + (j.items === 1 ? "" : "s") + '</span><span class="fw-pill">' + esc(FW.label(j.payment_method)) + '</span><span class="fw-pill">Waiting ' + esc(FW.mins(j.waiting_minutes)) + '</span></div><button class="fw-btn fw-btn--primary fw-btn--lg fw-btn--block" type="button" data-act="claim" data-id="' + esc(j.id) + '">Claim this run</button></article>';
  }
  function sorted(jobs) {
    const arr = jobs.slice();
    const dist = j => { const k = FW.km(S.me, { lat: j.pickup_lat, lng: j.pickup_lng }); return k == null ? 1e9 : k; };
    if (S.sort === "pay") arr.sort((a, b) => num(b.fee) - num(a.fee));
    else if (S.sort === "near") arr.sort((a, b) => dist(a) - dist(b));
    else if (S.sort === "old") arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    else arr.sort((a, b) => (b.in_my_area - a.in_my_area) || (num(b.fee) - num(a.fee)));
    return arr;
  }
  async function viewJobs(el) {
    el.innerHTML = skel(2);
    await loadDash(); await loadActive();
    if (!isOnline()) { el.innerHTML = '<div class="fw-card"><div class="fw-empty"><h3>You\'re offline</h3><p>Go online to see delivery requests.</p><p style="margin-top:12px"><button class="fw-btn fw-btn--primary" data-act="online" type="button">Go online</button></p></div></div>'; return; }
    if (S.active) { el.innerHTML = '<div class="fw-card"><div class="fw-empty"><h3>Finish your current run first</h3><p>You can claim another job once ' + esc(S.active.order_number) + ' is delivered.</p><p style="margin-top:12px"><a class="fw-btn fw-btn--primary" href="#/run">Open current run</a></p></div></div>'; return; }
    await loadBoard(); S.boardKey = S.board.jobs.map(j => j.id).join(); chrome();
    const jobs = sorted(S.board.jobs);
    el.innerHTML = '<div class="cw-toolbar"><div><b>' + jobs.length + "</b> open " + (jobs.length === 1 ? "request" : "requests") + '</div><div class="fw-seg" role="group" aria-label="Sort jobs">' + [["area", "Best fit"], ["pay", "Pay"], ["near", "Nearest"], ["old", "Oldest"]].map(s => '<button type="button" data-act="sort" data-v="' + s[0] + '" aria-pressed="' + (S.sort === s[0]) + '">' + s[1] + "</button>").join("") + "</div></div>" +
      (S.me ? "" : '<p class="fw-note" style="margin-bottom:14px">Allow location to see how far each pickup is. <button class="fw-btn fw-btn--sm" data-act="locate" type="button">Share location</button></p>') +
      (jobs.length ? '<div class="fw-stack">' + jobs.map(jobCard).join("") + "</div>" : '<div class="fw-card"><div class="fw-empty"><h3>No requests right now</h3><p>New jobs appear here the moment a seller marks an order ready. Keep this screen open.</p></div></div>');
  }
  async function claim(id) {
    const j = S.board.jobs.find(x => x.id === id); if (!j) return;
    const ok = await FW.ask({ title: "Claim " + j.order_number + "?", body: "Collect from " + (j.pickup_location || "the seller") + " and deliver to " + (j.delivery_destination || j.delivery_area || "the customer") + " for " + money(j.fee) + ".", confirm: "Claim run" });
    if (!ok) return;
    const btn = $('[data-act="claim"][data-id="' + CSS.escape(id) + '"]'); if (btn) { btn.disabled = true; btn.textContent = "Claiming…"; }
    try { checkOk(await FW.rpc("claim_delivery_job", { p_request_id: id })); FW.toast("It's yours. Head to the pickup.", "good"); await Promise.all([loadDash(), loadActive()]); location.hash = "#/run"; }
    catch (e) { FW.toast(FW.errText(e), "bad"); if (btn) { btn.disabled = false; btn.textContent = "Claim this run"; } S.router.reload(); }
  }

  /* ---------- RUN ---------- */
  async function viewRun(el) {
    el.innerHTML = skel(2);
    await loadDash(); const a = await loadActive();
    if (!a) { el.innerHTML = '<div class="fw-card"><div class="fw-empty"><h3>No active run</h3><p>Claim a request to start earning.</p><p style="margin-top:12px"><a class="fw-btn fw-btn--primary" href="#/jobs">Find jobs</a></p></div></div>'; return; }
    const idx = STAGES.findIndex(s => s[0] === a.status), next = NEXT[a.status], atPickup = a.status === "assigned";
    const key = a.id, checks = S.checks[key] || (S.checks[key] = {});
    const dest = atPickup ? navUrl(a.pickup_lat, a.pickup_lng, a.pickup_location) : navUrl(a.dropoff_lat, a.dropoff_lng, a.delivery_destination || a.delivery_area);
    const cod = String(a.payment_method || "").includes("cash") && a.payment_status !== "paid";
    el.innerHTML = '<div class="fw-grid fw-grid--split"><div class="fw-stack">' +
      '<section class="fw-card" style="padding:18px"><div class="fw-row fw-row--between"><div><span class="fw-pill fw-pill--accent">' + esc(FW.label(a.status)) + '</span><h2 style="margin-top:6px">' + esc(a.order_number) + '</h2></div><div class="cw-fee fw-num">' + esc(money(a.fee)) + '</div></div><div class="fw-steps" style="margin:16px 0 6px" aria-label="Progress">' + STAGES.map((s, i) => '<i class="' + (i <= idx ? "is-done" : "") + '"></i>').join("") + '</div><div class="fw-row fw-row--between fw-faint" style="font-size:12px">' + STAGES.map(s => "<span>" + s[1] + "</span>").join("") + "</div>" +
      '<div class="cw-route" style="margin-top:18px"><div><small>Pickup · ' + esc(a.seller.store || "Seller") + "</small>" + esc(a.pickup_location || "—") + '</div><div><small>Drop-off</small>' + esc(a.delivery_destination || a.delivery_area || "—") + "</div></div>" +
      '<div class="cw-actions" style="margin-top:16px">' + linkBtn(dest, "nav", atPickup ? "Navigate to pickup" : "Navigate to customer", "fw-btn--primary") + (atPickup ? telBtn(a.seller.phone, "Call seller") : telBtn(a.customer.phone, "Call customer") + waBtn(a.customer.phone, "WhatsApp")) + "</div></section>" +
      (a.customer.instructions ? '<div class="fw-note"><b>Customer note:</b> ' + esc(a.customer.instructions) + "</div>" : "") +
      (cod ? '<div class="fw-note fw-note--warn"><b>Cash on delivery.</b> Order total ' + esc(money(a.order_total)) + ". Follow the cash rules from the seller agreement.</div>" : "") +
      (atPickup ? '<section class="fw-card"><div class="fw-card__head"><h2>Check the items</h2></div><div class="fw-card__body">' + a.items.map((it, i) => '<label class="cw-check"><input type="checkbox" data-check="' + i + '"' + (checks[i] ? " checked" : "") + "><span>" + esc(it.quantity) + " × " + esc(it.title) + "</span></label>").join("") + "</div></section>" : '<section class="fw-card"><div class="fw-card__head"><h2>Items</h2></div><div class="fw-card__body"><div class="fw-list">' + a.items.map(it => '<div class="fw-li"><span>' + esc(it.title) + "</span><b>× " + esc(it.quantity) + "</b></div>").join("") + "</div></div></section>") +
      (a.status === "out_for_delivery" ? '<section class="fw-card"><div class="fw-card__head"><h2>Hand over</h2></div><div class="fw-card__body fw-stack"><p class="fw-muted">Ask the customer for their six-digit handoff code. Never hand the item over without it.</p><input class="fw-input cw-otp" id="cwOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="Six-digit handoff code"><div class="fw-err" id="cwOtpErr" role="alert"></div></div></section>' : "") +
      (next ? '<button class="fw-btn fw-btn--primary fw-btn--lg fw-btn--block" type="button" id="cwAdvance" data-act="advance" data-to="' + next[0] + '">' + next[1] + "</button>" : "") +
      '</div><div class="fw-stack"><section class="fw-card"><div class="fw-card__head"><h2>Timeline</h2></div><div class="fw-card__body"><ol class="fw-tl">' + (a.timeline.length ? a.timeline.map(t => "<li><b>" + esc(FW.label(t.status)) + "</b><small>" + esc(FW.dayTime(t.created_at)) + "</small></li>").join("") : "<li><b>Claimed</b><small>" + esc(FW.dayTime(a.assigned_at)) + "</small></li>") + "</ol></div></section>" +
      '<section class="fw-card"><div class="fw-card__head"><h2>Problems</h2><button class="fw-btn fw-btn--sm" type="button" data-act="report">' + FW.icon("flag") + 'Report a problem</button></div><div class="fw-card__body">' +
      (a.issues.length ? '<div class="fw-list">' + a.issues.map(i => '<div class="fw-li" style="align-items:flex-start"><div><b>' + esc((KINDS.find(k => k[0] === i.kind) || [0, FW.label(i.kind)])[1]) + "</b><small>" + esc(FW.ago(i.created_at)) + (i.resolution ? " · Operations: " + esc(i.resolution) : "") + '</small></div><span class="fw-pill fw-pill--' + (ISSUE_TONE[i.status] || "") + '">' + esc(FW.label(i.status)) + "</span></div>").join("") + "</div>" : '<p class="fw-muted">Nothing reported. If anything stops you, tell operations and they will help.</p>') + "</div></section></div></div>";
  }
  async function advance(to) {
    const a = S.active; if (!a) return; const btn = $("#cwAdvance"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Updating…";
    try {
      if (to === "delivered") {
        const otp = ($("#cwOtp").value || "").trim();
        if (!/^\d{6}$/.test(otp)) { $("#cwOtpErr").textContent = "Enter the six-digit code the customer gives you."; btn.disabled = false; btn.textContent = label; return; }
        const { data, error } = await FW.client().functions.invoke("gambasket-delivery-proof", { body: { action: "confirm", order_id: a.order_id, otp } });
        if (error || !data || !data.success) throw new Error((data && data.error) || (error && error.message) || "That code wasn't accepted.");
        FW.toast("Delivered. Your earnings are on the way.", "good"); S.active = null; await loadDash(); location.hash = "#/earnings"; return;
      }
      checkOk(await FW.rpc("update_delivery_job_status", { p_request_id: a.id, p_status: to }));
      FW.toast("Status updated", "good"); S.router.reload();
    } catch (e) { FW.toast(FW.errText(e), "bad"); btn.disabled = false; btn.textContent = label; if ($("#cwOtpErr")) $("#cwOtpErr").textContent = FW.errText(e); }
  }
  function reportSheet() {
    const a = S.active; if (!a) return;
    FW.sheet.open({ title: "Report a problem", body: '<p class="fw-muted">Operations is notified straight away and will reply here.</p><div class="cw-kinds">' + KINDS.map((k, i) => '<label><input type="radio" name="cwKind" value="' + k[0] + '"' + (i === 0 ? " checked" : "") + ">" + esc(k[1]) + "</label>").join("") + '</div><label class="fw-field">Details (optional)<textarea class="fw-textarea" id="cwIssueNote" maxlength="1000" placeholder="What happened?"></textarea></label><div class="fw-err" id="cwIssueErr" role="alert"></div>',
      foot: '<button class="fw-btn" type="button" id="cwIssueCancel">Cancel</button><button class="fw-btn fw-btn--primary" type="button" id="cwIssueSend">Send report</button>' });
    $("#cwIssueCancel").addEventListener("click", () => FW.sheet.close());
    $("#cwIssueSend").addEventListener("click", async e => {
      const kind = ($('input[name="cwKind"]:checked') || {}).value, note = $("#cwIssueNote").value.trim();
      if (kind === "other" && note.length < 3) { $("#cwIssueErr").textContent = "Describe the problem so we can help."; return; }
      e.currentTarget.disabled = true;
      try { await FW.rpc("courier_report_issue", { p_request_id: a.id, p_kind: kind, p_note: note || null }); FW.sheet.close(); FW.toast("Operations has been told", "good"); S.router.reload(); }
      catch (er) { $("#cwIssueErr").textContent = FW.errText(er); e.currentTarget.disabled = false; }
    });
  }

  /* ---------- EARNINGS / HISTORY / PROFILE ---------- */
  async function viewEarnings(el) {
    el.innerHTML = '<div class="fw-stack"><section class="fw-card"><div class="fw-card__head"><h2>Last 14 days</h2></div><div class="fw-card__body" id="cwSeries">' + skel(1) + '</div></section><div id="cwWallet"></div></div>';
    const [series] = await Promise.all([FW.rpc("courier_earnings_series", { p_days: 14 }), FW.wallet($("#cwWallet"), "delivery_worker")]);
    $("#cwSeries").innerHTML = FW.bars(series.map(s => ({ label: FW.day(s.day).split(" ")[0], value: num(s.earned) })), money);
  }
  async function viewHistory(el) {
    el.innerHTML = skel(3); S.hist = []; S.histDone = false;
    await moreHistory(el);
  }
  async function moreHistory(el) {
    const rows = await FW.rpc("courier_history", { p_limit: 30, p_offset: S.hist.length });
    S.hist = S.hist.concat(rows); if (rows.length < 30) S.histDone = true;
    el.innerHTML = S.hist.length ? '<section class="fw-card"><div class="fw-card__body"><div class="fw-list">' + S.hist.map(h => '<div class="fw-li"><div><b>' + esc(h.order_number) + "</b><small>" + esc(h.delivery_destination || h.delivery_area || "") + " · " + esc(FW.dayTime(h.delivered_at)) + (h.minutes != null ? " · " + esc(FW.mins(h.minutes)) : "") + '</small></div><b class="fw-num">' + esc(money(h.fee)) + "</b></div>").join("") + "</div>" + (S.histDone ? "" : '<p style="margin-top:12px"><button class="fw-btn fw-btn--block" data-act="more-history" type="button">Load more</button></p>') + "</div></section>" : '<div class="fw-card"><div class="fw-empty"><h3>No deliveries yet</h3><p>Finished runs are listed here.</p></div></div>';
  }
  async function viewProfile(el) {
    const d = await loadDash(), p = d.profile, notes = await FW.notifications(20);
    el.innerHTML = '<div class="fw-grid fw-grid--2"><section class="fw-card"><div class="fw-card__head"><h2>Your courier profile</h2></div><div class="fw-card__body fw-stack"><dl class="fw-kv"><dt>Name</dt><dd>' + esc(FW.displayName()) + "</dd><dt>Status</dt><dd>" + (p.verified ? '<span class="fw-pill fw-pill--good">Verified</span>' : '<span class="fw-pill fw-pill--warn">Awaiting verification</span>') + "</dd><dt>Vehicle</dt><dd>" + esc(p.vehicle || "—") + (p.plate ? " · " + esc(p.plate) : "") + "</dd><dt>Phone</dt><dd>" + esc(p.phone || "—") + "</dd><dt>Areas</dt><dd>" + (p.areas.length ? p.areas.map(a => '<span class="fw-pill">' + esc(a) + "</span>").join(" ") : "—") + "</dd><dt>Rating</dt><dd>" + (p.rating ? esc(Number(p.rating).toFixed(1)) + " ★" : "No ratings yet") + "</dd><dt>Completed</dt><dd>" + esc(p.completed) + " deliveries</dd></dl><p class=\"fw-muted\">To change your vehicle, plate or areas, contact support so we can re-verify them.</p><div class=\"cw-actions\"><a class=\"fw-btn\" href=\"../help.html\">Help &amp; support</a><a class=\"fw-btn\" href=\"../me.html\">My account</a></div></div></section>" +
      '<section class="fw-card"><div class="fw-card__head"><h2>Notifications</h2></div><div class="fw-card__body"><div class="fw-list">' + (notes.length ? notes.map(n => '<div class="fw-li" style="align-items:flex-start"><div><b>' + esc(n.title) + "</b><small>" + esc(n.message) + "</small></div><small>" + esc(FW.ago(n.created_at)) + "</small></div>").join("") : '<div class="fw-empty"><h3>All quiet</h3></div>') + "</div></div></section></div>";
  }

  /* ---------- background refresh ---------- */
  const poll = FW.poll(async () => {
    if (!S.dash) return;
    await loadDash();
    if (!isOnline()) return;
    const before = S.boardKey; await Promise.all([loadBoard(), loadActive()]);
    const key = S.board.jobs.map(j => j.id).join(), fresh = S.board.jobs.filter(j => !before.split(",").includes(j.id));
    chrome();
    if (before !== key) {
      S.boardKey = key;
      if (fresh.length && !S.active) { FW.toast(fresh.length + " new delivery request" + (fresh.length > 1 ? "s" : "")); try { navigator.vibrate && navigator.vibrate(120); } catch (e) { /* unsupported */ } }
      if (S.router.current() === "jobs") S.router.reload();
    }
  }, 20000);

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-act],#cwSwitch,#cwTheme"); if (!t) return;
    if (t.id === "cwTheme") return FW.theme.toggle();
    if (t.id === "cwSwitch") return void setOnline(t.getAttribute("aria-checked") !== "true");
    const act = t.getAttribute("data-act");
    if (act === "online") setOnline(true);
    else if (act === "sort") { S.sort = t.getAttribute("data-v"); S.router.reload(); }
    else if (act === "locate") oneShot().then(p => { if (p) startWatch(); S.router.reload(); });
    else if (act === "claim") claim(t.getAttribute("data-id"));
    else if (act === "advance") advance(t.getAttribute("data-to"));
    else if (act === "report") reportSheet();
    else if (act === "more-history") { t.disabled = true; moreHistory($("#v-history")).catch(er => FW.toast(FW.errText(er), "bad")); }
  });
  document.addEventListener("change", e => { const c = e.target.closest("[data-check]"); if (c && S.active) (S.checks[S.active.id] = S.checks[S.active.id] || {})[c.getAttribute("data-check")] = c.checked; });
  document.addEventListener("input", e => { if (e.target.id === "cwOtp") { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); $("#cwOtpErr").textContent = ""; } });

  /* ---------- boot ---------- */
  (async function () {
    if (!(await FW.boot("delivery_worker"))) return;
    $("#fwGate").remove(); $("#protectedContent").hidden = false; FW.hydrateIcons(document);
    $("#cwName").textContent = FW.displayName(); $("#cwAvatar").textContent = FW.initials(FW.displayName());
    S.router = FW.router({ home: viewHome, jobs: viewJobs, run: viewRun, earnings: viewEarnings, history: viewHistory, profile: viewProfile },
      { fallback: "home", brand: "Courier", titles: { home: "Home", jobs: "Delivery requests", run: "Current run", earnings: "Earnings", history: "History", profile: "Profile" }, after: n => { if (n !== "home") clearInterval(S.timer); } });
    try { await loadDash(); if (isOnline()) { try { const q = navigator.permissions && await navigator.permissions.query({ name: "geolocation" }); if (q && q.state === "granted") startWatch(); } catch (e) { /* unsupported */ } } } catch (e) { /* the view will show the error */ }
    S.router.go(false); poll.start();
  })();
})();
