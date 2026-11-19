/* =========================================================
   Operations Center. Hash routes: #/overview, #/inbox, #/dispatch, #/earnings, #/activity.
   Backed by ops_* RPCs from 20261119100000_field_workforce_v2.sql plus the existing
   moderate_product_listing and resolve_marketplace_report RPCs.
   ========================================================= */
(function () {
  "use strict";
  const FW = window.FW, $ = FW.$, $$ = FW.$$, esc = FW.esc, num = FW.num;

  const S = { dash: null, queue: [], filter: "all", q: "", sel: null, detail: null, templates: [], router: null, mobile: false, busy: false };
  const KINDS = { product: ["Listing", "bag"], application: ["Application", "user"], report: ["Report", "flag"], issue: ["Delivery issue", "truck"] };
  const FILTERS = [["all", "All"], ["product", "Listings"], ["application", "Applications"], ["report", "Reports"], ["issue", "Delivery"]];
  const PRIORITY = { high: ["bad", "Urgent"], medium: ["warn", "Soon"], standard: ["", ""] };
  const ACTIVITY = { product_approved: "Approved a listing", product_rejected: "Rejected a listing", worker_application_approved: "Approved an application", worker_application_rejected: "Rejected an application", worker_application_needs_info: "Asked an applicant for more", report_investigating: "Started investigating a report", report_resolved: "Resolved a report", report_dismissed: "Dismissed a report", delivery_issue_resolved: "Resolved a delivery issue", payout_requested: "Requested a payout" };
  const isAdmin = () => FW.state.roles.includes("admin");
  const checkOk = d => { if (d && (d.success === false || d.error)) throw new Error(d.error || "That didn't work. Please try again."); return d; };
  const skel = n => '<div class="fw-stack">' + Array.from({ length: n }, () => '<div class="fw-skel" style="height:90px"></div>').join("") + "</div>";
  const kpi = (l, v, m, cls) => '<section class="fw-card fw-kpi"><div class="fw-kpi__l">' + l + '</div><div class="fw-kpi__v fw-num ' + (cls || "") + '">' + esc(v) + '</div><div class="fw-kpi__m">' + m + "</div></section>";
  const ageText = h => h < 1 ? Math.max(1, Math.round(h * 60)) + " min" : h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " d";
  const totalOpen = () => S.dash ? Object.values(S.dash.queues).reduce((a, b) => a + num(b), 0) : 0;

  async function loadDash() { S.dash = await FW.rpc("ops_dashboard"); const n = totalOpen(); ["opsBadge", "opsTabBadge"].forEach(id => { const b = $("#" + id); b.hidden = !n; b.textContent = n > 99 ? "99+" : n; }); return S.dash; }
  async function loadQueue() { S.queue = await FW.rpc("ops_queue"); return S.queue; }
  async function loadTemplates() {
    if (S.templates.length) return;
    const { data } = await FW.client().from("ops_decision_templates").select("kind,label,body").eq("is_active", true).order("sort");
    S.templates = data || [];
  }
  const tpl = kind => S.templates.filter(t => t.kind === kind);
  const chipsFor = kinds => '<div class="fw-chips" data-tpl-chips>' + kinds.flatMap(tpl).map(t => '<button class="fw-chip" type="button" data-act="tpl" data-body="' + esc(t.body) + '">' + esc(t.label) + "</button>").join("") + "</div>";

  /* =========================== OVERVIEW =========================== */
  async function viewOverview(el) {
    el.innerHTML = skel(3);
    const d = await loadDash(), q = d.queues, o = d.overdue;
    const rows = [["products", "Listings to review", "product"], ["applications", "Applications", "application"], ["reports", "Reports", "report"], ["issues", "Delivery issues", "issue"]];
    const series = d.series.map(s => ({ label: FW.day(s.day).split(" ")[0], value: num(s.decisions) }));
    el.innerHTML = '<div class="fw-stack"><section class="fw-card" style="padding:20px"><div class="fw-row fw-row--between" style="flex-wrap:wrap"><div><h2 style="font-size:22px">' + (totalOpen() ? totalOpen() + " item" + (totalOpen() === 1 ? "" : "s") + " waiting for the team" : "The queue is clear") + '</h2><p class="fw-muted">' +
      (totalOpen() ? "Oldest has waited " + esc(ageText(d.oldest_hours)) + ". " : "") + num(d.waiting_on_applicants) + " application" + (num(d.waiting_on_applicants) === 1 ? "" : "s") + " waiting on the applicant.</p></div>" + (totalOpen() ? '<a class="fw-btn fw-btn--primary fw-btn--lg" href="#/inbox" data-act="start">Start reviewing ' + FW.icon("arrow") + "</a>" : "") + "</div></section>" +
      '<div class="fw-grid fw-grid--kpi">' + rows.map(r => kpi(r[1], num(q[r[0]]), num(o[r[0]]) ? '<span class="fw-pill fw-pill--bad">' + num(o[r[0]]) + " overdue</span>" : "none overdue")).join("") + "</div>" +
      '<div class="fw-grid fw-grid--kpi">' + kpi("You, today", num(d.me.today), num(d.me.week) + " this week") + kpi("Team today", num(d.team_today), "decisions made") + kpi("Listing turnaround", d.avg_product_turnaround_hours == null ? "–" : ageText(num(d.avg_product_turnaround_hours)), "submitted to decision, 14 days") + kpi("Dispatch", num(d.dispatch.active) + " active", num(d.dispatch.unassigned) + " unassigned · " + num(d.dispatch.couriers_online) + " couriers online") + "</div>" +
      '<section class="fw-card"><div class="fw-card__head"><h2>Team decisions, last 7 days</h2></div><div class="fw-card__body">' + FW.bars(series, v => v + " decisions") + "</div></section></div>";
  }

  /* =========================== INBOX =========================== */
  const visible = () => { const q = S.q.trim().toLowerCase(); return S.queue.filter(i => (S.filter === "all" || i.kind === S.filter) && (!q || (i.title + " " + i.subtitle).toLowerCase().includes(q))); };
  function itemRow(i) {
    const img = i.kind === "product" && FW.safeUrl(i.meta.image), pr = PRIORITY[i.priority];
    return '<button class="ops-item" type="button" data-act="open" data-kind="' + i.kind + '" data-id="' + esc(i.id) + '" aria-current="' + !!(S.sel && S.sel.id === i.id) + '"><span class="ops-item__ic"' + (img ? ' style="background-image:url(\'' + esc(img) + '\')"' : "") + ">" + (img ? "" : FW.icon(KINDS[i.kind][1])) + "</span><span style=\"min-width:0\"><b>" + esc(i.title) + "</b><small>" + esc(i.subtitle) + '</small><span class="ops-item__tags"><span class="fw-pill">' + KINDS[i.kind][0] + "</span>" + (pr[1] ? '<span class="fw-pill fw-pill--' + pr[0] + '">' + pr[1] + "</span>" : "") + '<span class="fw-pill">' + esc(ageText(i.age_hours)) + "</span>" + (i.claimed_by && !i.claimed_by_me ? '<span class="fw-pill fw-pill--info">' + esc(i.claimed_by) + " is on it</span>" : "") + "</span></span></button>";
  }
  function paintList() {
    const list = $("#opsListBody"); if (!list) return; const items = visible();
    list.innerHTML = items.length ? items.map(itemRow).join("") : '<div class="fw-empty"><h3>' + (S.queue.length ? "Nothing matches" : "Inbox zero") + "</h3><p>" + (S.queue.length ? "Try another filter." : "New items appear here as they come in.") + "</p></div>";
    FILTERS.forEach(f => { const c = $('[data-filter="' + f[0] + '"] b'); if (c) c.textContent = f[0] === "all" ? S.queue.length : S.queue.filter(i => i.kind === f[0]).length; });
  }
  async function viewInbox(el) {
    el.innerHTML = skel(3); S.mobile = matchMedia("(max-width: 900px)").matches;
    await Promise.all([loadQueue(), loadDash(), loadTemplates()]);
    el.innerHTML = '<div class="ops-inbox"><section class="fw-card ops-list"><div class="ops-list__head"><div class="fw-chips">' + FILTERS.map(f => '<button class="fw-chip" type="button" data-act="filter" data-filter="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + " <b>0</b></button>").join("") + '</div><input class="fw-input" id="opsSearch" type="search" placeholder="Search the queue" aria-label="Search the queue" value="' + esc(S.q) + '"></div><div class="ops-list__scroll" id="opsListBody"></div></section>' +
      '<section class="fw-card ops-detail-wrap ops-detail" id="opsDetail"><div class="fw-empty"><h3>Select an item</h3><p>Pick something from the queue. Shortcuts: <span class="fw-kbd">J</span> <span class="fw-kbd">K</span> to move, <span class="fw-kbd">?</span> for help.</p></div></section></div>';
    paintList();
    if (S.pendingStart) { S.pendingStart = false; const first = S.queue.find(i => !i.claimed_by || i.claimed_by_me); if (first) openItem(first.kind, first.id); }
    else if (S.sel && S.queue.some(i => i.id === S.sel.id) && !S.mobile) openItem(S.sel.kind, S.sel.id, true);
  }

  const detailHost = () => S.mobile ? FW.sheet.body() : $("#opsDetail");
  async function openItem(kind, id, quiet) {
    if (S.busy) return;
    if (S.sel && (S.sel.id !== id) && !quiet) releaseSel();
    S.sel = { kind, id, mine: false, heldBy: null }; paintList();
    if (S.mobile) FW.sheet.open({ title: KINDS[kind][0], body: skel(2), onClose: () => { releaseSel(); S.sel = null; paintList(); } }); else $("#opsDetail").innerHTML = '<div class="ops-detail__body">' + skel(2) + "</div>";
    try {
      const [claim, d] = await Promise.all([FW.rpc("ops_claim_item", { p_kind: kind, p_id: id }), FW.rpc("ops_get_item", { p_kind: kind, p_id: id })]);
      if (!S.sel || S.sel.id !== id) return;
      S.sel.mine = !!claim.success; S.sel.heldBy = claim.success ? null : claim.held_by; S.detail = d; renderDetail();
    } catch (e) { detailHost().innerHTML = '<div class="fw-empty"><h3>Couldn\'t open this item</h3><p>' + esc(FW.errText(e)) + "</p></div>"; }
  }
  function releaseSel() { if (S.sel && S.sel.mine) FW.rpc("ops_release_item", { p_kind: S.sel.kind, p_id: S.sel.id }).catch(() => {}); }

  const kv = rows => '<dl class="fw-kv">' + rows.filter(r => r[1] != null && r[1] !== "").map(r => "<dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd>").join("") + "</dl>";
  const sec = (title, html) => '<div class="ops-sec"><h3>' + esc(title) + "</h3>" + html + "</div>";

  function bodyProduct(d) {
    const it = d.item, s = d.seller || {}, imgs = [it.main_image].concat(d.images || []).filter((x, i, a) => FW.safeUrl(x) && a.indexOf(x) === i);
    return sec("Photos", imgs.length ? '<div class="ops-gallery"><div class="ops-gallery__main" id="opsMainImg" style="background-image:url(\'' + esc(FW.safeUrl(imgs[0])) + '\')"></div><div class="ops-gallery__thumbs">' + imgs.map((u, i) => '<button type="button" data-act="img" data-url="' + esc(FW.safeUrl(u)) + '" aria-pressed="' + (i === 0) + '" style="background-image:url(\'' + esc(FW.safeUrl(u)) + '\')" aria-label="Photo ' + (i + 1) + '"></button>').join("") + "</div></div>" : '<div class="fw-note fw-note--warn">This listing has no usable photos.</div>') +
      sec("Listing", "<h2>" + esc(it.title) + "</h2>" + kv([["Price", esc(FW.money(it.price))], ["Condition", esc(it.condition)], ["Category", esc(it.category)], ["Stock", esc(it.stock)], ["Location", esc(it.location)], ["Submitted", esc(FW.dayTime(it.created_at))]]) + '<p style="white-space:pre-wrap">' + esc(it.description) + "</p>" + (it.rejection_reason ? '<div class="fw-note fw-note--bad">Previously rejected: ' + esc(it.rejection_reason) + "</div>" : "")) +
      sec("Seller", kv([["Name", esc(s.name || "Unknown")], ["Joined", s.joined ? esc(FW.day(s.joined)) : ""], ["Store", s.store_verified ? '<span class="fw-pill fw-pill--good">Verified</span>' : "Not verified"], ["Track record", esc(num(s.approved)) + " approved · " + esc(num(s.rejected)) + " rejected"], ["Open reports", num(s.open_reports) ? '<span class="ops-flag">' + num(s.open_reports) + " open</span>" : "None"]]));
  }
  const DOCS = ["identity_document_path", "selfie_path"];
  function bodyApplication(d) {
    const a = d.item, ap = d.applicant || {};
    return sec("Applicant", kv([["Reference", esc(a.reference_code)], ["Applied for", esc(FW.label(a.worker_type))], ["Name", esc(a.full_name)], ["Account", esc(ap.email || "")], ["Phone", a.phone ? '<a href="tel:' + esc(String(a.phone).replace(/[^\d+]/g, "")) + '">' + esc(a.phone) + "</a>" : ""], ["Area", esc(a.location)], ["Earlier applications", num(ap.earlier_applications) || "None"]])) +
      (a.worker_type === "delivery_worker" ? sec("Courier details", kv([["Vehicle", esc(a.vehicle_type)], ["Plate", esc(a.plate_number)], ["Delivery areas", (a.areas || []).map(x => '<span class="fw-pill">' + esc(x) + "</span>").join(" ")]])) : sec("Operations details", kv([["Hours per week", esc(a.weekly_hours)], ["Languages", (a.languages || []).map(x => '<span class="fw-pill">' + esc(x) + "</span>").join(" ")]]))) +
      sec("Emergency contact", kv([["Name", esc(a.emergency_contact_name)], ["Phone", esc(a.emergency_contact_phone)]])) +
      (a.experience ? sec("Experience", '<p style="white-space:pre-wrap">' + esc(a.experience) + "</p>") : "") +
      (a.applicant_response ? sec("Applicant's reply", '<div class="fw-note">' + esc(a.applicant_response) + "</div>") : "") +
      sec("Documents (private, opens for 5 minutes)", '<div class="ops-docs"><figure class="ops-doc" id="opsDoc0"><figcaption>ID document: loading…</figcaption></figure><figure class="ops-doc" id="opsDoc1"><figcaption>Selfie: loading…</figcaption></figure></div>') +
      sec("History", '<ol class="fw-tl">' + (d.events.length ? d.events.map(e => "<li><b>" + esc(FW.label(e.event)) + "</b>" + (e.note ? " — " + esc(e.note) : "") + "<small>" + esc(FW.dayTime(e.created_at)) + "</small></li>").join("") : "<li><b>Submitted</b></li>") + "</ol>");
  }
  async function loadDocs(d) {
    const a = d.item;
    for (let i = 0; i < DOCS.length; i++) {
      const fig = $("#opsDoc" + i); if (!fig) continue; const path = a[DOCS[i]], name = i ? "Selfie" : "ID document";
      if (!path) { fig.innerHTML = "<figcaption>" + name + ": not provided</figcaption>"; continue; }
      try { const url = await FW.signedUrl(path, 300); fig.innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img alt="' + name + '" src="' + esc(url) + '"></a><figcaption>' + name + " · click to open full size</figcaption>"; }
      catch (e) { fig.innerHTML = "<figcaption>" + name + ": couldn't load (" + esc(FW.errText(e)) + ")</figcaption>"; }
    }
  }
  function bodyReport(d) {
    const r = d.item, t = d.target;
    return sec("Report", "<h2>" + esc(r.reason) + "</h2>" + kv([["Filed", esc(FW.dayTime(r.created_at))], ["By", esc(d.reporter || "Unknown")], ["About", esc(FW.label(r.target_type))], ["Status", '<span class="fw-pill">' + esc(FW.label(r.status)) + "</span>"]]) + (r.description ? '<p style="white-space:pre-wrap">' + esc(r.description) + "</p>" : "")) +
      sec("Reported item", t ? kv([["Name", esc(t.title || t.name)], ["Seller", esc(t.seller)], ["Listing status", t.status ? esc(FW.label(t.status)) : ""]]) + (FW.safeUrl(t.image) ? '<div class="ops-gallery__main" style="background-image:url(\'' + esc(FW.safeUrl(t.image)) + '\')"></div>' : "") : '<p class="fw-muted">The reported item is no longer available.</p>') +
      (num(d.other_open_reports) ? '<div class="fw-note fw-note--warn"><b>' + num(d.other_open_reports) + " other open report" + (num(d.other_open_reports) === 1 ? "" : "s") + "</b> about the same target.</div>" : "");
  }
  function bodyIssue(d) {
    const i = d.item, c = d.courier || {}, dl = d.delivery || {};
    return sec("Problem", "<h2>" + esc(FW.label(i.kind)) + "</h2>" + (i.note ? '<p style="white-space:pre-wrap">' + esc(i.note) + "</p>" : '<p class="fw-muted">No details given.</p>') + kv([["Reported", esc(FW.dayTime(i.created_at))], ["Status", '<span class="fw-pill fw-pill--' + (i.status === "open" ? "warn" : "good") + '">' + esc(FW.label(i.status)) + "</span>"], ["Resolution", esc(i.resolution)]])) +
      sec("Courier", kv([["Name", esc(c.name)], ["Phone", c.phone ? '<a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, "")) + '">' + esc(c.phone) + "</a>" : ""], ["Vehicle", esc(c.vehicle)], ["Availability", esc(FW.label(c.status))]])) +
      sec("Delivery", kv([["Order", esc(dl.order_number)], ["Delivery status", esc(FW.label(dl.status))], ["Pickup", esc(dl.pickup)], ["Drop-off", esc(dl.destination)], ["Customer phone", dl.customer_phone ? '<a href="tel:' + esc(String(dl.customer_phone).replace(/[^\d+]/g, "")) + '">' + esc(dl.customer_phone) + "</a>" : ""], ["Claimed", dl.assigned_at ? esc(FW.ago(dl.assigned_at)) : ""]]));
  }

  function decisionPanel(d) {
    const k = d.kind, locked = !S.sel.mine, it = d.item;
    if (locked) return '<div class="fw-note fw-note--warn"><b>' + esc(S.sel.heldBy || "A teammate") + " is reviewing this.</b> You can read it, but decisions are locked until they finish or the hold expires.</div>";
    const area = (ph, id) => '<textarea class="fw-textarea" id="' + (id || "opsReason") + '" maxlength="1000" placeholder="' + esc(ph) + '"></textarea>';
    if (k === "product") return '<div class="ops-decide"><label class="fw-field">Reason (required to reject)' + area("What does the seller need to fix?") + "</label>" + chipsFor(["product_reject"]) + '<div class="fw-err" id="opsErr" role="alert"></div><div class="ops-decide__row"><button class="fw-btn fw-btn--primary" type="button" data-act="approve-product">Approve <span class="fw-kbd">A</span></button><button class="fw-btn fw-btn--danger" type="button" data-act="reject-product">Reject <span class="fw-kbd">R</span></button><button class="fw-btn" type="button" data-act="skip">Skip <span class="fw-kbd">S</span></button></div></div>';
    if (k === "application") {
      if (it.status !== "pending") return '<div class="fw-note">This application is <b>' + esc(FW.label(it.status)) + "</b>" + (it.status === "needs_info" ? ". Waiting on the applicant." : ".") + "</div>";
      const blocked = it.worker_type === "marketplace_worker" && !isAdmin();
      return '<div class="ops-decide"><label class="fw-field">Message to the applicant (required for reject or request info)' + area("Explain clearly what happens next.") + "</label>" + chipsFor(["application_info", "application_reject"]) + '<div class="fw-err" id="opsErr" role="alert"></div><div class="ops-decide__row"><button class="fw-btn fw-btn--primary" type="button" data-act="app" data-d="approved"' + (blocked ? " disabled" : "") + ">Approve</button><button class=\"fw-btn\" type=\"button\" data-act=\"app\" data-d=\"needs_info\">Request info</button><button class=\"fw-btn fw-btn--danger\" type=\"button\" data-act=\"app\" data-d=\"rejected\">Reject</button><button class=\"fw-btn\" type=\"button\" data-act=\"skip\">Skip</button></div>" + (blocked ? '<p class="fw-sub">Only an administrator can approve operations workers. You can request info or reject, or leave a note for an admin.</p>' : "") + "</div>";
    }
    if (k === "report") return '<div class="ops-decide"><label class="fw-field">Resolution (shown in the audit trail)' + area("What did you find and do?") + "</label>" + chipsFor(["report_resolve", "report_dismiss"]) + '<div class="fw-err" id="opsErr" role="alert"></div><div class="ops-decide__row"><button class="fw-btn" type="button" data-act="rep" data-d="investigating">Investigating</button><button class="fw-btn fw-btn--primary" type="button" data-act="rep" data-d="resolved">Resolve</button><button class="fw-btn" type="button" data-act="rep" data-d="dismissed">Dismiss</button><button class="fw-btn" type="button" data-act="skip">Skip</button></div></div>';
    if (it.status !== "open") return '<div class="fw-note fw-note--good">This issue is resolved.</div>';
    return '<div class="ops-decide"><label class="fw-field">Reply to the courier (they see this in their app)' + area("Tell them exactly what to do next.") + "</label>" + chipsFor(["issue_resolve"]) + '<div class="fw-err" id="opsErr" role="alert"></div><div class="ops-decide__row"><button class="fw-btn fw-btn--primary" type="button" data-act="issue">Send &amp; resolve</button><button class="fw-btn" type="button" data-act="skip">Skip</button></div></div>';
  }
  function notesBlock(d) {
    return sec("Internal notes (never shown to the person)", (d.notes.length ? d.notes.map(n => '<div class="ops-note"><small>' + esc(n.author) + " · " + esc(FW.ago(n.created_at)) + "</small>" + esc(n.note) + "</div>").join("") : '<p class="fw-muted">No notes yet.</p>') + '<div class="fw-row" style="align-items:flex-start"><textarea class="fw-textarea" id="opsNote" style="min-height:64px" maxlength="2000" placeholder="Add context for the next reviewer"></textarea><button class="fw-btn" type="button" data-act="note">Add</button></div>');
  }
  function renderDetail() {
    const d = S.detail, it = d.item, host = detailHost(), title = d.kind === "product" ? it.title : d.kind === "application" ? it.full_name : d.kind === "report" ? it.reason : FW.label(it.kind);
    const body = d.kind === "product" ? bodyProduct(d) : d.kind === "application" ? bodyApplication(d) : d.kind === "report" ? bodyReport(d) : bodyIssue(d);
    host.innerHTML = (S.mobile ? "" : '<div class="ops-detail__bar"><span class="fw-pill fw-pill--accent">' + KINDS[d.kind][0] + '</span><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(title) + "</b>" + (S.sel.mine ? '<span class="fw-pill fw-pill--good">You hold this</span>' : "") + "</div>") + '<div class="ops-detail__body">' + body + decisionPanel(d) + notesBlock(d) + "</div>";
    if (d.kind === "application") loadDocs(d);
  }

  async function afterDecision(msg) {
    FW.toast(msg, "good"); const prev = S.sel; S.sel = null;
    if (S.mobile) FW.sheet.close();
    await Promise.all([loadQueue(), loadDash()]); paintList();
    const idx = prev ? visibleIndexAfter(prev.id) : -1; const next = idx >= 0 ? visible()[idx] : null;
    if (!S.mobile && next) openItem(next.kind, next.id, true);
    else if (!S.mobile && $("#opsDetail")) $("#opsDetail").innerHTML = '<div class="fw-empty"><h3>' + (S.queue.length ? "Nice. Pick the next one." : "Inbox zero. 🎉") + "</h3><p>" + (S.queue.length ? "" : "You've cleared the queue.") + "</p></div>";
  }
  const lastOrder = [];
  function visibleIndexAfter(id) { const ids = lastOrder; const i = ids.indexOf(id); const vis = visible().map(x => x.id); if (!vis.length) return -1; const after = ids.slice(i + 1).find(x => vis.includes(x)); return after ? vis.indexOf(after) : 0; }

  async function decide(fn, ok) {
    if (S.busy) return; S.busy = true; $("#opsErr") && ($("#opsErr").textContent = "");
    try { await fn(); S.busy = false; await afterDecision(ok); }
    catch (e) { S.busy = false; const er = $("#opsErr"); if (er) er.textContent = FW.errText(e); else FW.toast(FW.errText(e), "bad"); }
  }
  const reasonVal = () => ($("#opsReason") ? $("#opsReason").value.trim() : "");
  const need = (v, msg) => { if (v.length < 3) { throw new Error(msg); } return v; };

  /* =========================== DISPATCH =========================== */
  async function viewDispatch(el) {
    if (!el.innerHTML.trim()) el.innerHTML = skel(3);
    const b = await FW.rpc("ops_dispatch_board");
    const stuck = b.active.filter(a => a.stuck).length;
    el.innerHTML = '<div class="fw-stack"><div class="fw-grid fw-grid--kpi">' + kpi("Unassigned", b.unassigned.length, "ready for a courier", b.unassigned.some(u => u.waiting_minutes > 30) ? "ops-late" : "") + kpi("On the road", b.active.length, stuck ? '<span class="fw-pill fw-pill--bad">' + stuck + " stuck</span>" : "all moving") + kpi("Couriers online", b.couriers.length, b.couriers.filter(c => c.status === "available").length + " free") + "</div>" +
      '<section class="fw-card"><div class="fw-card__head"><h2>Waiting for a courier</h2></div><div class="fw-card__body ops-table-wrap">' + (b.unassigned.length ? '<table class="ops-table"><thead><tr><th>Order</th><th>Area</th><th>Fee</th><th>Waiting</th></tr></thead><tbody>' + b.unassigned.map(u => "<tr><td><b>" + esc(u.order_number) + "</b></td><td>" + esc(u.area || "—") + '</td><td class="fw-num">' + esc(FW.money(u.fee)) + '</td><td class="' + (u.waiting_minutes > 30 ? "ops-late" : u.waiting_minutes > 15 ? "ops-warm" : "") + '">' + esc(FW.mins(u.waiting_minutes)) + "</td></tr>").join("") + "</tbody></table>" : '<div class="fw-empty"><h3>Nothing waiting</h3><p>Every ready order has a courier.</p></div>') + "</div></section>" +
      '<section class="fw-card"><div class="fw-card__head"><h2>Active deliveries</h2></div><div class="fw-card__body ops-table-wrap">' + (b.active.length ? '<table class="ops-table"><thead><tr><th>Order</th><th>Courier</th><th>Status</th><th>Time in status</th><th></th></tr></thead><tbody>' + b.active.map(a => "<tr><td><b>" + esc(a.order_number) + "</b><small class=\"fw-sub\">" + esc(a.area || "") + "</small></td><td>" + esc(a.courier || "—") + (a.courier_phone ? '<small class="fw-sub"><a href="tel:' + esc(String(a.courier_phone).replace(/[^\d+]/g, "")) + '">' + esc(a.courier_phone) + "</a></small>" : "") + '</td><td><span class="fw-pill">' + esc(FW.label(a.status)) + '</span></td><td class="' + (a.stuck ? "ops-late" : "") + '">' + esc(FW.mins(a.minutes_in_status)) + '</td><td>' + (a.stuck ? '<span class="fw-pill fw-pill--bad">Stuck</span> ' : "") + (num(a.open_issues) ? '<a class="fw-pill fw-pill--warn" href="#/inbox" data-act="filter-issues">' + a.open_issues + " issue</a>" : "") + "</td></tr>").join("") + "</tbody></table>" : '<div class="fw-empty"><h3>No active runs</h3></div>') + "</div></section>" +
      '<section class="fw-card"><div class="fw-card__head"><h2>Couriers online</h2></div><div class="fw-card__body"><div class="fw-list">' + (b.couriers.length ? b.couriers.map(c => '<div class="fw-li"><div><b>' + esc(c.name) + "</b><small>" + esc(c.vehicle || "") + " · " + esc((c.areas || []).join(", ")) + (c.last_seen_at ? " · seen " + esc(FW.ago(c.last_seen_at)) : "") + '</small></div><span class="fw-pill fw-pill--' + (c.status === "available" ? "good" : "info") + '">' + (c.status === "available" ? "Free" : "On a run") + "</span></div>").join("") : '<div class="fw-empty"><h3>No couriers online</h3><p>Orders will wait until one goes online.</p></div>') + "</div></div></section></div>";
  }

  /* =========================== EARNINGS / ACTIVITY =========================== */
  async function viewEarnings(el) { el.innerHTML = '<div id="opsWallet"></div>'; await FW.wallet($("#opsWallet"), "marketplace_worker"); }
  async function viewActivity(el) {
    el.innerHTML = skel(2); const rows = await FW.rpc("ops_my_activity", { p_limit: 100 });
    el.innerHTML = '<section class="fw-card"><div class="fw-card__body">' + (rows.length ? '<ol class="fw-tl">' + rows.map(r => "<li><b>" + esc(ACTIVITY[r.action] || FW.label(r.action)) + "</b>" + ((r.metadata && r.metadata.notes) ? " — " + esc(String(r.metadata.notes).slice(0, 140)) : "") + "<small>" + esc(FW.dayTime(r.created_at)) + "</small></li>").join("") + "</ol>" : '<div class="fw-empty"><h3>No activity yet</h3><p>Your decisions are listed here.</p></div>') + "</div></section>";
  }

  /* =========================== EVENTS =========================== */
  function helpDialog() { FW.ask({ title: "Keyboard shortcuts", html: '<dl class="fw-kv"><dt><span class="fw-kbd">J</span> / <span class="fw-kbd">K</span></dt><dd>Next / previous item</dd><dt><span class="fw-kbd">A</span></dt><dd>Approve the open listing</dd><dt><span class="fw-kbd">R</span></dt><dd>Jump to the reason box to reject</dd><dt><span class="fw-kbd">S</span></dt><dd>Skip (release the item)</dd><dt><span class="fw-kbd">?</span></dt><dd>This help</dd></dl>', confirm: "Got it", cancel: "Close" }); }
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-act],#opsHelp,#opsTheme,#opsThemeTop"); if (!t) return;
    if (t.id === "opsHelp") return helpDialog();
    if (t.id === "opsTheme" || t.id === "opsThemeTop") return FW.theme.toggle();
    const act = t.getAttribute("data-act");
    if (act === "start") { S.pendingStart = true; S.filter = "all"; return; }
    if (act === "filter-issues") { S.filter = "issue"; return; }
    if (act === "filter") { S.filter = t.getAttribute("data-filter"); $$("[data-act=filter]").forEach(b => b.setAttribute("aria-pressed", String(b === t))); return paintList(); }
    if (act === "open") { lastOrder.length = 0; visible().forEach(i => lastOrder.push(i.id)); return openItem(t.getAttribute("data-kind"), t.getAttribute("data-id")); }
    if (act === "img") { $("#opsMainImg").style.backgroundImage = "url('" + t.getAttribute("data-url") + "')"; $$("[data-act=img]").forEach(b => b.setAttribute("aria-pressed", String(b === t))); return; }
    if (act === "tpl") { const ta = $("#opsReason"); if (ta) { ta.value = t.getAttribute("data-body"); ta.focus(); } return; }
    if (act === "skip") { releaseSel(); S.sel = null; if (S.mobile) FW.sheet.close(); else $("#opsDetail").innerHTML = '<div class="fw-empty"><h3>Skipped</h3><p>Pick another item.</p></div>'; await loadQueue(); return paintList(); }
    if (act === "note") { const v = ($("#opsNote").value || "").trim(); if (!v) return; t.disabled = true; try { await FW.rpc("ops_add_note", { p_kind: S.sel.kind, p_id: S.sel.id, p_note: v }); S.detail = await FW.rpc("ops_get_item", { p_kind: S.sel.kind, p_id: S.sel.id }); renderDetail(); } catch (er) { FW.toast(FW.errText(er), "bad"); t.disabled = false; } return; }
    if (!S.sel || !S.sel.mine) return;
    const id = S.sel.id;
    if (act === "approve-product") return decide(async () => checkOk(await FW.rpc("moderate_product_listing", { p_product_id: id, p_status: "approved", p_reason: null })), "Listing approved");
    if (act === "reject-product") return decide(async () => checkOk(await FW.rpc("moderate_product_listing", { p_product_id: id, p_status: "rejected", p_reason: need(reasonVal(), "Explain what the seller must fix.") })), "Listing rejected");
    if (act === "app") { const dcn = t.getAttribute("data-d"); return decide(async () => checkOk(await FW.rpc("ops_review_application", { p_application_id: id, p_decision: dcn, p_notes: dcn === "approved" ? (reasonVal() || null) : need(reasonVal(), "Write a message for the applicant.") })), dcn === "approved" ? "Application approved" : dcn === "rejected" ? "Application rejected" : "Info requested"); }
    if (act === "rep") { const st = t.getAttribute("data-d"); return decide(async () => checkOk(await FW.rpc("resolve_marketplace_report", { p_report_id: id, p_status: st, p_resolution: st === "investigating" ? (reasonVal() || null) : need(reasonVal(), "Record what you found or did.") })), st === "investigating" ? "Marked as investigating" : "Report " + st); }
    if (act === "issue") return decide(async () => checkOk(await FW.rpc("ops_resolve_delivery_issue", { p_issue_id: id, p_resolution: need(reasonVal(), "Tell the courier what to do next.") })), "Courier notified");
  });
  document.addEventListener("input", e => { if (e.target.id === "opsSearch") { S.q = e.target.value; paintList(); } });
  document.addEventListener("keydown", e => {
    if (S.router && S.router.current() !== "inbox") return; if (e.target.closest("input,textarea,select,dialog") || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase(), items = visible();
    if (k === "?") return helpDialog();
    if (k === "j" || k === "k") { const i = S.sel ? items.findIndex(x => x.id === S.sel.id) : -1, n = items[k === "j" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)]; if (n) { lastOrder.length = 0; items.forEach(x => lastOrder.push(x.id)); openItem(n.kind, n.id); } }
    else if (k === "a" && S.sel && S.sel.kind === "product") { const b = $('[data-act="approve-product"]'); if (b) b.click(); }
    else if (k === "r" && S.sel && S.sel.kind === "product") { e.preventDefault(); const r = $("#opsReason"); if (r) r.focus(); }
    else if (k === "s" && S.sel) { const b = $('[data-act="skip"]'); if (b) b.click(); }
  });
  window.addEventListener("beforeunload", () => { releaseSel(); });

  /* ---------- background refresh ---------- */
  const poll = FW.poll(async () => {
    const r = S.router && S.router.current();
    if (r === "dispatch") return viewDispatch($("#v-dispatch"));
    await loadDash();
    if (r === "inbox" && !S.busy && !S.mobile) { await loadQueue(); paintList(); }
  }, 30000);

  /* ---------- boot ---------- */
  (async function () {
    if (!(await FW.boot("marketplace_worker"))) return;
    $("#fwGate").remove(); $("#protectedContent").hidden = false; FW.hydrateIcons(document);
    $("#opsName").textContent = FW.displayName(); $("#opsAvatar").textContent = FW.initials(FW.displayName());
    S.router = FW.router({ overview: viewOverview, inbox: viewInbox, dispatch: viewDispatch, earnings: viewEarnings, activity: viewActivity },
      { fallback: "overview", brand: "Operations", titles: { overview: "Overview", inbox: "Inbox", dispatch: "Dispatch", earnings: "Earnings", activity: "Activity" } });
    S.router.go(false); poll.start();
  })();
})();
