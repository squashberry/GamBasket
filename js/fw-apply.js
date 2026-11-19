/* =========================================================
   Worker application: role choice, guided form, private document upload, and a tracker for the
   applicant's own applications. Backed by submit_worker_application, my_worker_applications,
   respond_to_application_info and withdraw_worker_application (20261119100000_field_workforce_v2.sql).
   Sellers still go through the existing submit_verification_request flow.
   ========================================================= */
(function () {
  "use strict";
  const FW = window.FW, $ = FW.$, $$ = FW.$$, esc = FW.esc;
  const DRAFT_KEY = "jd-apply-draft-v2";
  const AREAS = ["Serrekunda", "Banjul", "Kololi", "Brikama", "Bakau", "Kotu", "Kanifing", "Brufut", "Fajara", "Other"];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], SHIFTS = [["flexible", "Flexible"], ["morning", "Mornings"], ["afternoon", "Afternoons"], ["evening", "Evenings"], ["night", "Nights"]];
  const LANGS = ["English", "Mandinka", "Wolof", "Fula", "Jola", "Other"];
  const VEHICLES = [["motorcycle", "Motorcycle"], ["bicycle", "Bicycle"], ["car", "Car"], ["van", "Van"], ["other", "Other"]];
  const ROLES = {
    delivery_worker: { name: "Courier", icon: "truck", blurb: "Deliver orders around your area and get paid per delivery.", steps: ["role", "you", "courier", "docs", "review"], workspace: "delivery/index.html" },
    marketplace_worker: { name: "Operations worker", icon: "inbox", blurb: "Review listings, applications and reports. Get paid per decision.", steps: ["role", "you", "ops", "docs", "review"], workspace: "worker/index.html" },
    seller: { name: "Seller", icon: "bag", blurb: "Sell products on JulaDirect with your own store.", steps: ["role", "you", "seller", "docs", "review"], workspace: "supplier/index.html" }
  };
  const STEP_TITLE = { role: "What would you like to do?", you: "About you", courier: "Your vehicle and areas", ops: "Your availability", seller: "About your selling", docs: "Verify your identity", review: "Check and submit" };
  const STATUS = { pending: ["info", "In review"], needs_info: ["warn", "We need more from you"], approved: ["good", "Approved"], rejected: ["bad", "Not accepted"], withdrawn: ["", "Withdrawn"], suspended: ["bad", "Suspended"] };

  const A = { client: null, user: null, roles: [], apps: [], appsOk: true, step: 0, errors: {}, files: {}, previews: {}, busy: false, done: null };
  let F = { role: "", name: "", phone: "", location: "", ecName: "", ecPhone: "", vehicle: "", plate: "", areas: [], days: [], shift: "flexible", experience: "", hours: "", languages: [], sellerCategory: "Individual seller", bio: "", phoneOk: false, agree: false };

  const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.assign({}, F, { agree: false }))); } catch (e) { /* storage blocked */ } };
  const loadDraft = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); if (d && typeof d === "object") F = Object.assign(F, d); } catch (e) { /* ignore */ } };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } };
  const steps = () => (F.role && ROLES[F.role] ? ROLES[F.role].steps : ["role"]);
  const stepName = () => steps()[Math.min(A.step, steps().length - 1)];
  const phoneRe = /^\+?[0-9][0-9 ()-]{6,19}$/;
  const clean = n => String(n).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "document";

  /* ---------- validation ---------- */
  function validate(name) {
    const e = {};
    if (name === "role" && !F.role) e.role = "Choose one to continue.";
    if (name === "you") {
      if (F.name.trim().length < 3) e.name = "Enter your full name.";
      if (!phoneRe.test(F.phone.trim())) e.phone = "Enter a valid phone number.";
      if (!F.location) e.location = "Choose your area.";
      if (F.role !== "seller") { if (F.ecName.trim().length < 2) e.ecName = "Who should we call in an emergency?"; if (!phoneRe.test(F.ecPhone.trim())) e.ecPhone = "Enter their phone number."; }
    }
    if (name === "courier") {
      if (!F.vehicle) e.vehicle = "Choose your vehicle.";
      if (!F.areas.length) e.areas = "Choose at least one area you can deliver in.";
      if (!F.phoneOk) e.phoneOk = "Couriers need a smartphone with data.";
    }
    if (name === "ops") {
      const h = Number(F.hours); if (!Number.isFinite(h) || h < 1 || h > 60) e.hours = "Enter between 1 and 60 hours.";
      if (!F.languages.length) e.languages = "Choose at least one language.";
    }
    if (name === "docs") {
      if (!A.files.id) e.id = "Upload your ID document.";
      if (F.role === "delivery_worker" && !A.files.selfie) e.selfie = "A selfie is required for couriers.";
    }
    if (name === "review" && !F.agree) e.agree = "Please confirm before submitting.";
    return e;
  }

  /* ---------- rendering ---------- */
  const field = (id, label, inner, hint) => '<div class="fw-field"><label for="ap-' + id + '">' + esc(label) + "</label>" + inner + (hint ? "<small>" + esc(hint) + "</small>" : "") + '<div class="fw-err" data-err="' + id + '" role="alert">' + esc(A.errors[id] || "") + "</div></div>";
  const input = (id, label, o) => { o = o || {}; return field(id, label, '<input class="fw-input" id="ap-' + id + '" data-f="' + id + '" type="' + (o.type || "text") + '" value="' + esc(F[id]) + '" ' + (o.inputmode ? 'inputmode="' + o.inputmode + '" ' : "") + (o.autocomplete ? 'autocomplete="' + o.autocomplete + '" ' : "") + (o.max ? 'maxlength="' + o.max + '" ' : "") + (o.min != null ? 'min="' + o.min + '" ' : "") + 'placeholder="' + esc(o.placeholder || "") + '"' + (A.errors[id] ? ' aria-invalid="true"' : "") + ">", o.hint); };
  const select = (id, label, opts, hint) => field(id, label, '<select class="fw-select" id="ap-' + id + '" data-f="' + id + '"' + (A.errors[id] ? ' aria-invalid="true"' : "") + '><option value="">Choose…</option>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (F[id] === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>", hint);
  const chips = (id, label, opts, hint) => field(id, label, '<div class="fw-chips" role="group" aria-label="' + esc(label) + '">' + opts.map(o => '<button class="fw-chip" type="button" data-multi="' + id + '" data-v="' + esc(o[0]) + '" aria-pressed="' + F[id].includes(o[0]) + '">' + esc(o[1]) + "</button>").join("") + "</div>", hint);
  const drop = (id, label, hint, accept) => {
    const f = A.files[id], p = A.previews[id];
    return '<div class="fw-field"><span>' + esc(label) + '</span><label class="ap-drop ' + (f ? "ap-drop--ok" : "") + '">' + (p ? '<img alt="Preview of ' + esc(label) + '" src="' + esc(p) + '">' : f ? "<b>" + esc(f.name) + "</b>" : FW.icon("upload")) + "<span>" + (f ? "Tap to replace" : "Tap to choose a file") + '</span><input type="file" data-file="' + id + '" accept="' + accept + '"></label><small>' + esc(hint) + '</small><div class="fw-err" data-err="' + id + '" role="alert">' + esc(A.errors[id] || "") + "</div></div>";
  };

  function stepBody(name) {
    if (name === "role") return '<div class="ap-roles" role="group" aria-label="Choose a role">' + Object.keys(ROLES).map(k => { const r = ROLES[k], has = A.roles.includes(k); return '<button class="ap-role" type="button" data-role="' + k + '" aria-pressed="' + (F.role === k) + '"' + (has ? " disabled" : "") + ">" + FW.icon(r.icon) + "<b>" + r.name + "</b><span>" + (has ? "You already have this role." : r.blurb) + "</span></button>"; }).join("") + '</div><div class="fw-err" data-err="role" role="alert">' + esc(A.errors.role || "") + "</div>";
    if (name === "you") return '<div class="ap-cols">' + input("name", "Full name", { autocomplete: "name", max: 150, hint: "As it appears on your ID." }) + input("phone", "Phone number", { type: "tel", autocomplete: "tel", inputmode: "tel", max: 20, placeholder: "+220 …" }) + "</div>" + select("location", "Area where you live", AREAS.map(a => [a, a])) +
      (F.role !== "seller" ? '<div class="ap-cols">' + input("ecName", "Emergency contact name", { max: 150 }) + input("ecPhone", "Emergency contact phone", { type: "tel", inputmode: "tel", max: 20 }) + "</div>" : "");
    if (name === "courier") return '<div class="ap-cols">' + select("vehicle", "Vehicle", VEHICLES) + input("plate", "Plate number", { max: 30, hint: "Leave empty for a bicycle." }) + "</div>" + chips("areas", "Areas you can deliver in", AREAS.filter(a => a !== "Other").map(a => [a, a])) + chips("days", "Days you usually work", DAYS.map(d => [d, d])) + select("shift", "Best time of day", SHIFTS) + field("experience", "Delivery experience (optional)", '<textarea class="fw-textarea" id="ap-experience" data-f="experience" maxlength="1000" placeholder="Tell us about any delivery or driving experience.">' + esc(F.experience) + "</textarea>") +
      field("phoneOk", "Smartphone", '<label class="ap-check"><input type="checkbox" data-f="phoneOk"' + (F.phoneOk ? " checked" : "") + '><span>I have a smartphone with mobile data to use the Courier Workspace.</span></label>');
    if (name === "ops") return '<div class="ap-cols">' + input("hours", "Hours you can work per week", { type: "number", inputmode: "numeric", min: 1, max: 2, placeholder: "e.g. 20" }) + select("shift", "Best time of day", SHIFTS) + "</div>" + chips("languages", "Languages you speak", LANGS.map(l => [l, l])) + chips("days", "Days you can work", DAYS.map(d => [d, d])) + field("experience", "Relevant experience (optional)", '<textarea class="fw-textarea" id="ap-experience" data-f="experience" maxlength="1000" placeholder="Customer support, moderation, admin work, anything relevant.">' + esc(F.experience) + "</textarea>");
    if (name === "seller") return select("sellerCategory", "What kind of seller are you?", [["Individual seller", "Individual seller"], ["Small business", "Small business"], ["Shop / retailer", "Shop or retailer"], ["Manufacturer / producer", "Manufacturer or producer"]]) + field("bio", "What will you sell? (optional)", '<textarea class="fw-textarea" id="ap-bio" data-f="bio" maxlength="1000" placeholder="A short description of your products.">' + esc(F.bio) + "</textarea>");
    if (name === "docs") return '<div class="fw-note">Your documents are stored privately. Only the operations team reviewing your application can open them, for a few minutes at a time.</div>' + drop("id", "Identity document", "National ID, passport or driving licence. Clear photo or PDF, up to 5 MB.", "image/jpeg,image/png,image/webp,application/pdf") + (F.role !== "seller" ? drop("selfie", "Selfie" + (F.role === "delivery_worker" ? "" : " (optional)"), "A recent photo of your face in good light, up to 5 MB.", "image/jpeg,image/png,image/webp") : "");
    const r = ROLES[F.role];
    return '<div class="ap-summary"><dl class="fw-kv"><dt>Applying as</dt><dd><b>' + esc(r.name) + "</b></dd><dt>Name</dt><dd>" + esc(F.name) + "</dd><dt>Phone</dt><dd>" + esc(F.phone) + "</dd><dt>Area</dt><dd>" + esc(F.location) + "</dd>" +
      (F.role === "delivery_worker" ? "<dt>Vehicle</dt><dd>" + esc(F.vehicle) + (F.plate ? " · " + esc(F.plate) : "") + "</dd><dt>Delivers in</dt><dd>" + esc(F.areas.join(", ")) + "</dd>" : "") + (F.role === "marketplace_worker" ? "<dt>Hours / week</dt><dd>" + esc(F.hours) + "</dd><dt>Languages</dt><dd>" + esc(F.languages.join(", ")) + "</dd>" : "") +
      "<dt>Documents</dt><dd>" + esc([A.files.id && A.files.id.name, A.files.selfie && A.files.selfie.name].filter(Boolean).join(", ")) + "</dd></dl>" +
      field("agree", "Confirmation", '<label class="ap-check"><input type="checkbox" data-f="agree"' + (F.agree ? " checked" : "") + '><span>I confirm that everything above is true and I agree to JulaDirect checking my documents. I understand that false information means my application will be rejected.</span></label>') + "</div>";
  }

  function wizard() {
    const list = steps(), n = list.length, name = stepName(), last = A.step >= n - 1;
    return '<section class="fw-card ap-wizard" id="apWizard"><div class="ap-wizard__head"><div class="fw-steps" aria-hidden="true">' + list.map((s, i) => '<i class="' + (i <= A.step ? "is-done" : "") + '"></i>').join("") + '</div><div><span class="fw-faint" style="font-size:13px">Step ' + (A.step + 1) + " of " + n + "</span><h2>" + STEP_TITLE[name] + '</h2></div></div><div class="ap-wizard__body">' + stepBody(name) + '</div><div class="ap-wizard__foot">' + (A.step > 0 ? '<button class="fw-btn" type="button" data-act="back">Back</button>' : "<span></span>") + '<button class="fw-btn fw-btn--primary" type="button" data-act="' + (last ? "submit" : "next") + '"' + (A.busy ? " disabled" : "") + ">" + (last ? (A.busy ? "Submitting…" : "Submit application") : "Continue") + "</button></div></section>";
  }

  function appCard(a) {
    const st = STATUS[a.status] || ["", FW.label(a.status)], r = ROLES[a.worker_type] || { name: FW.label(a.worker_type), workspace: "" }, open = ["pending", "needs_info"].includes(a.status);
    return '<article class="fw-card ap-app" data-app="' + esc(a.id) + '"><div class="fw-row fw-row--between" style="flex-wrap:wrap"><div><b style="font-size:17px">' + esc(r.name) + '</b><div class="fw-sub">Reference <span class="fw-num">' + esc(a.reference_code) + "</span> · " + esc(FW.ago(a.created_at)) + '</div></div><span class="fw-pill fw-pill--' + st[0] + '">' + st[1] + "</span></div>" +
      (a.status === "needs_info" ? '<div class="fw-note fw-note--warn"><b>The team asks:</b> ' + esc(a.info_request || "Please send more information.") + '</div><label class="fw-field">Your reply<textarea class="fw-textarea" data-reply maxlength="1500" placeholder="Write your answer here"></textarea></label><label class="ap-drop" style="padding:12px">' + FW.icon("upload") + '<span data-newid-label>Attach a new ID photo (optional)</span><input type="file" data-newid accept="image/jpeg,image/png,image/webp,application/pdf"></label><div class="fw-err" data-reply-err role="alert"></div><button class="fw-btn fw-btn--primary" type="button" data-act="reply" data-id="' + esc(a.id) + '">Send reply</button>' : "") +
      (a.status === "approved" ? '<div class="fw-note fw-note--good">You\'re in. ' + (r.workspace ? '<a href="' + esc(r.workspace) + '"><b>Open your workspace →</b></a>' : "") + "</div>" : "") +
      (a.status === "rejected" ? '<div class="fw-note fw-note--bad">' + esc(a.review_notes || "Your application wasn't accepted this time.") + "</div>" : "") +
      '<ol class="fw-tl">' + (a.events || []).map(e => "<li><b>" + esc(FW.label(e.event)) + "</b>" + (e.note ? " — " + esc(e.note) : "") + "<small>" + esc(FW.dayTime(e.created_at)) + "</small></li>").join("") + "</ol>" +
      (open ? '<div><button class="fw-btn fw-btn--sm" type="button" data-act="withdraw" data-id="' + esc(a.id) + '">Withdraw application</button></div>' : "") + "</article>";
  }

  function render() {
    const main = $("#apMain");
    if (!A.user) { main.innerHTML = hero() + '<section class="fw-card ap-app"><h2>Sign in to apply</h2><p class="fw-muted">You need a JulaDirect account so we can keep your application and documents safe.</p><div class="fw-row" style="flex-wrap:wrap"><a class="fw-btn fw-btn--primary" href="login.html?redirect=' + encodeURIComponent("worker-apply.html") + '">Sign in</a><a class="fw-btn" href="signup.html?redirect=' + encodeURIComponent("worker-apply.html") + '">Create an account</a></div></section>'; return; }
    if (A.done) { main.innerHTML = '<section class="fw-card ap-done"><div class="fw-avatar" style="width:56px;height:56px">' + FW.icon("check").replace("<svg", '<svg style="width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:2.4"') + '</div><h2>Application sent</h2><p class="fw-muted">Keep this reference. We\'ll update your status below, usually within two working days.</p><div class="ap-ref">' + esc(A.done.reference_code) + '</div><button class="fw-btn fw-btn--primary" type="button" data-act="again">View my applications</button></section>'; return; }
    const hasOpenAll = A.apps.some(a => ["pending", "needs_info"].includes(a.status));
    main.innerHTML = hero() + (A.apps.length ? '<div class="fw-stack"><h2 style="font-size:18px">Your applications</h2>' + A.apps.map(appCard).join("") + "</div>" : "") + (A.appsOk ? "" : '<div class="fw-note fw-note--warn">Application tracking needs a database update to be applied. You can still apply.</div>') +
      '<div class="fw-stack"><h2 style="font-size:18px">' + (A.apps.length ? "Start a new application" : "Apply") + "</h2>" + wizard() + "</div>" + (hasOpenAll ? "" : "");
  }
  const hero = () => '<div class="ap-hero"><h1>Work with JulaDirect</h1><p>Deliver orders or help run the marketplace. Apply in a few minutes, upload your documents privately and track your application here.</p></div><div class="ap-perks"><div class="ap-perk"><b>Paid per task</b><span>Earnings are tracked in your workspace. Request a payout any time you reach the minimum.</span></div><div class="ap-perk"><b>Work when you want</b><span>Go online or offline whenever it suits you.</span></div><div class="ap-perk"><b>Private and safe</b><span>Your ID is only seen by the review team.</span></div></div>';

  /* ---------- actions ---------- */
  async function loadApps() {
    try { A.apps = await FW.rpc("my_worker_applications"); A.appsOk = true; } catch (e) { A.apps = []; A.appsOk = !/database update/i.test(FW.errText(e)); if (A.appsOk) console.warn("[apply] tracker:", e); }
  }
  async function upload(file) {
    const path = A.user.id + "/" + Date.now() + "_" + clean(file.name);
    const { error } = await A.client.storage.from("verification-documents").upload(path, file, { upsert: false, contentType: file.type, cacheControl: "3600" });
    if (error) throw error; return path;
  }
  async function submit() {
    const e = validate("review"); A.errors = e; if (Object.keys(e).length) return render();
    A.busy = true; render(); const uploaded = [];
    try {
      const idPath = await upload(A.files.id); uploaded.push(idPath);
      const selfiePath = A.files.selfie ? await upload(A.files.selfie) : null; if (selfiePath) uploaded.push(selfiePath);
      let ref;
      if (F.role === "seller") {
        const { data, error } = await A.client.rpc("submit_verification_request", { p_role_type: "seller", p_business_name: F.name.trim(), p_business_category: F.sellerCategory, p_identity_document_url: idPath, p_business_document_url: null, p_additional_document_url: null, p_notes: F.bio.trim() || ("Contact: " + F.phone + "; area: " + F.location) });
        if (error) throw error; ref = { reference_code: data && data.id ? "SELLER-" + String(data.id).slice(0, 6).toUpperCase() : "SELLER" };
      } else {
        ref = await FW.rpc("submit_worker_application", { p_worker_type: F.role, p_full_name: F.name.trim(), p_phone: F.phone.trim(), p_location: F.location, p_areas: F.role === "delivery_worker" ? F.areas : null, p_vehicle_type: F.role === "delivery_worker" ? F.vehicle : null, p_plate: F.plate || null, p_experience: F.experience.trim() || null, p_identity_path: idPath, p_selfie_path: selfiePath, p_emergency_name: F.ecName.trim(), p_emergency_phone: F.ecPhone.trim(), p_availability: { days: F.days, shift: F.shift }, p_languages: F.role === "marketplace_worker" ? F.languages : null, p_weekly_hours: F.role === "marketplace_worker" ? Number(F.hours) : null });
      }
      clearDraft(); A.done = ref; A.files = {}; A.previews = {}; A.step = 0; F.agree = false; A.busy = false; render(); window.scrollTo({ top: 0 });
    } catch (er) {
      A.busy = false; if (uploaded.length) A.client.storage.from("verification-documents").remove(uploaded).catch(() => {});
      FW.toast(FW.errText(er), "bad"); render();
    }
  }
  function pickFile(input) {
    const id = input.getAttribute("data-file"), f = input.files && input.files[0]; if (!f) return;
    const okType = id === "selfie" ? /^image\/(jpeg|png|webp)$/.test(f.type) : /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type);
    if (!okType) { A.errors[id] = "Use a JPG, PNG or WebP photo" + (id === "id" ? " or a PDF." : "."); return render(); }
    if (f.size > 5 * 1024 * 1024) { A.errors[id] = "That file is over 5 MB."; return render(); }
    if (A.previews[id]) URL.revokeObjectURL(A.previews[id]);
    A.files[id] = f; A.previews[id] = f.type.startsWith("image/") ? URL.createObjectURL(f) : ""; delete A.errors[id]; render();
  }

  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-act],[data-role],[data-multi],#apTheme"); if (!t) return;
    if (t.id === "apTheme") return FW.theme.toggle();
    if (t.hasAttribute("data-role")) { F.role = t.getAttribute("data-role"); delete A.errors.role; saveDraft(); return render(); }
    if (t.hasAttribute("data-multi")) { const k = t.getAttribute("data-multi"), v = t.getAttribute("data-v"), i = F[k].indexOf(v); if (i < 0) F[k].push(v); else F[k].splice(i, 1); t.setAttribute("aria-pressed", String(i < 0)); delete A.errors[k]; const er = $('[data-err="' + k + '"]'); if (er) er.textContent = ""; return saveDraft(); }
    const act = t.getAttribute("data-act");
    if (act === "next") { const er = validate(stepName()); A.errors = er; if (!Object.keys(er).length) { A.step++; } render(); return window.scrollTo({ top: $("#apWizard") ? $("#apWizard").offsetTop - 80 : 0 }); }
    if (act === "back") { A.step = Math.max(0, A.step - 1); A.errors = {}; return render(); }
    if (act === "submit") { const er = validate("docs"); if (Object.keys(er).length) { A.errors = er; A.step = steps().indexOf("docs"); return render(); } return submit(); }
    if (act === "again") { A.done = null; await loadApps(); return render(); }
    if (act === "withdraw") { const ok = await FW.ask({ title: "Withdraw this application?", body: "You can apply again later.", confirm: "Withdraw", danger: true }); if (!ok) return; try { await FW.rpc("withdraw_worker_application", { p_application_id: t.getAttribute("data-id") }); FW.toast("Application withdrawn"); await loadApps(); render(); } catch (er) { FW.toast(FW.errText(er), "bad"); } return; }
    if (act === "reply") {
      const card = t.closest("[data-app]"), text = $("[data-reply]", card).value.trim(), err = $("[data-reply-err]", card), f = $("[data-newid]", card).files[0];
      if (text.length < 2) { err.textContent = "Write a short reply first."; return; }
      if (f && (f.size > 5 * 1024 * 1024 || !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type))) { err.textContent = "Use a JPG, PNG, WebP or PDF under 5 MB."; return; }
      t.disabled = true; let path = null;
      try { if (f) path = await upload(f); await FW.rpc("respond_to_application_info", { p_application_id: t.getAttribute("data-id"), p_response: text, p_new_identity_path: path }); FW.toast("Reply sent", "good"); await loadApps(); render(); }
      catch (er) { err.textContent = FW.errText(er); t.disabled = false; }
    }
  });
  document.addEventListener("input", e => {
    const k = e.target.getAttribute && e.target.getAttribute("data-f"); if (!k) return;
    F[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value; delete A.errors[k]; e.target.removeAttribute("aria-invalid");
    const er = $('[data-err="' + k + '"]'); if (er) er.textContent = ""; if (k !== "agree") saveDraft();
  });
  document.addEventListener("change", e => { if (e.target.matches && e.target.matches("[data-file]")) pickFile(e.target); else if (e.target.matches && e.target.matches("[data-newid]")) { const l = $("[data-newid-label]", e.target.closest("label")); if (l && e.target.files[0]) l.textContent = e.target.files[0].name; } });

  /* ---------- boot ---------- */
  (async function () {
    FW.hydrateIcons(document); loadDraft();
    try {
      await window.GamBasketAuth.ready(); A.client = window.GamBasketAuth.getClient(); A.user = await window.GamBasketAuth.getUser();
      FW.state.client = A.client; FW.state.user = A.user;
      if (A.user) {
        const [prof, roles] = await Promise.all([A.client.from("profiles").select("first_name,last_name,phone").eq("id", A.user.id).maybeSingle(), A.client.from("user_roles").select("role_id").eq("user_id", A.user.id).eq("is_active", true)]);
        A.roles = (roles.data || []).map(r => r.role_id);
        const p = prof.data || {}; if (!F.name) F.name = [p.first_name, p.last_name].filter(Boolean).join(" "); if (!F.phone && p.phone) F.phone = p.phone;
        if (F.role && A.roles.includes(F.role)) F.role = "";
        await loadApps();
      }
    } catch (e) { console.error("[apply] boot:", e); FW.toast(FW.errText(e), "bad"); }
    render();
  })();
})();
