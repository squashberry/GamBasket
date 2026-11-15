/* JulaDirect admin: homepage banner manager. Reads site_banners (row-level
   security shows admins every banner) and writes only through the admin RPCs
   admin_save_site_banner / admin_set_site_banner_active / admin_delete_site_banner,
   which re-check admin access on the server. This page's own role check is a
   convenience, not the security boundary. */
(function () {
  "use strict";
  const JD = window.JD;
  const $ = id => document.getElementById(id);
  const TEXT = ["name", "headline_left", "headline_right", "kicker", "tagline", "corner_label", "body", "stat_value", "stat_label", "cta_label", "cta_url", "image_url", "image_style", "theme"];
  const LIMITS = { name: 80, headline_left: 60, headline_right: 60, kicker: 40, tagline: 60, corner_label: 60, body: 280, stat_value: 16, stat_label: 40, cta_label: 30, cta_url: 300, image_url: 600 };
  let banners = [];
  let editingId = null;

  /* The site root is one level up from /admin. */
  const site = p => "../" + p;
  const pad = n => String(n).padStart(2, "0");
  const toLocal = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const fmt = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

  function statusOf(b) {
    const now = Date.now();
    if (!b.is_active) return { label: "Off", cls: "" };
    if (b.starts_at && new Date(b.starts_at).getTime() > now) return { label: "Scheduled", cls: "jd-badge--warn" };
    if (b.ends_at && new Date(b.ends_at).getTime() < now) return { label: "Expired", cls: "jd-badge--bad" };
    return { label: "Live", cls: "jd-badge--ok" };
  }

  function blocked(title, text, actions) {
    $("jd-new").hidden = true;
    $("jd-note").hidden = true;
    $("jd-list").innerHTML = JD.empty({ icon: "settings", title, text, actions: actions || "" });
  }

  function render() {
    $("jd-new").hidden = false;
    $("jd-note").hidden = false;
    if (!banners.length) {
      $("jd-list").innerHTML = JD.empty({ icon: "tag", title: "No banners yet", text: "Create your first full-screen homepage banner. It stays off until you switch it on.", actions: '<button type="button" class="jd-btn jd-btn--primary" data-new>New banner</button>' });
      return;
    }
    $("jd-list").innerHTML = '<div class="jd-list">' + banners.map(b => {
      const st = statusOf(b);
      const img = JD.safeUrl(b.image_url);
      const sched = b.starts_at || b.ends_at ? (b.starts_at ? "From " + fmt(b.starts_at) : "") + (b.starts_at && b.ends_at ? " " : "") + (b.ends_at ? "until " + fmt(b.ends_at) : "") : "Always on while live";
      return '<article class="jd-row" data-id="' + JD.esc(b.id) + '"><div class="jd-row__lead"><img class="jd-bthumb" src="' + JD.esc(img || JD.placeholder) + '" alt="">' +
        '<div class="jd-row__main"><div class="jd-row__title">' + JD.esc(b.name) + ' <span class="jd-badge ' + st.cls + '">' + st.label + "</span></div>" +
        '<div class="jd-row__sub">' + JD.esc(String(b.headline_left).replace(/\s*\n\s*/g, " ")) + (b.headline_right ? " / " + JD.esc(String(b.headline_right).replace(/\s*\n\s*/g, " ")) : "") + "</div>" +
        '<div class="jd-row__sub">' + JD.esc(sched) + " &middot; " + JD.esc(b.theme) + " theme</div></div></div>" +
        '<div class="jd-row__actions"><label class="jd-switch" style="gap:10px"><span>Live</span><input type="checkbox" data-toggle' + (b.is_active ? " checked" : "") + '><span class="jd-switch__track" aria-hidden="true"></span></label>' +
        '<a class="jd-btn jd-btn--secondary jd-btn--sm" href="' + site("index.html") + "?preview_banner=" + encodeURIComponent(b.id) + '" target="_blank" rel="noopener">Preview</a>' +
        '<button type="button" class="jd-btn jd-btn--secondary jd-btn--sm" data-edit>Edit</button>' +
        '<button type="button" class="jd-btn jd-btn--ghost jd-btn--sm" data-delete>Delete</button></div></article>';
    }).join("") + "</div>";
  }

  async function load() {
    $("jd-list").innerHTML = '<div class="jd-skel" style="height:120px" aria-hidden="true"></div>';
    try {
      const A = JD.auth();
      await A.ready();
      const user = await A.getUser();
      if (!user) { blocked("Sign in to continue", "This page is for JulaDirect administrators.", '<a class="jd-btn jd-btn--primary" href="' + JD.esc(JD.loginUrl()) + '">Log in</a>'); return; }
      const roles = (await A.getUserRoles()) || [];
      if (!roles.includes("admin")) { blocked("Administrators only", "Your account does not have access to homepage banners.", '<a class="jd-btn jd-btn--secondary" href="' + site("index.html") + '">Back to the marketplace</a>'); return; }
      const c = await JD.client();
      const { data, error } = await c.from("site_banners").select("*").order("updated_at", { ascending: false });
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205" || /site_banners/.test(error.message || "")) {
          blocked("Banner storage is not set up yet", "Apply the database migration 20261115100000_homepage_takeover_banners.sql, then reload this page.");
          return;
        }
        throw error;
      }
      banners = data || [];
      render();
    } catch (e) {
      console.warn("[JulaDirect] banners", e && e.message);
      blocked("We could not load banners", (e && e.message) || "Please try again.", '<button type="button" class="jd-btn jd-btn--secondary" data-retry>Try again</button>');
    }
  }

  /* ---------- helpers: confirm dialog + rpc ---------- */
  function ask(title, text, ok) {
    return new Promise(resolve => {
      const d = $("jd-confirm");
      $("jd-confirm-title").textContent = title;
      $("jd-confirm-text").textContent = text;
      $("jd-confirm-ok").textContent = ok || "Confirm";
      const done = () => { d.removeEventListener("close", done); resolve(d.returnValue === "ok"); };
      d.addEventListener("close", done);
      d.showModal();
    });
  }
  async function rpc(name, args) {
    const c = await JD.client();
    const { data, error } = await c.rpc(name, args);
    if (error) throw error;
    return data;
  }

  /* ---------- form ---------- */
  const field = k => $("f-" + k);
  function fillForm(b) {
    TEXT.forEach(k => { field(k).value = b && b[k] != null ? b[k] : (k === "image_style" ? "cutout" : k === "theme" ? "light" : ""); });
    field("starts_at").value = toLocal(b && b.starts_at);
    field("ends_at").value = toLocal(b && b.ends_at);
    $("f-body-count").textContent = field("body").value.length + " / 280";
    imgPreview();
    status("");
  }
  function status(msg, isError) { const el = $("jd-form-status"); el.textContent = msg || ""; el.classList.toggle("is-error", !!isError); }
  function imgPreview() {
    const v = field("image_url").value.trim();
    const img = $("f-img-prev");
    if (/^https:\/\/[^\s]+$/.test(v)) { img.src = v; img.hidden = false; } else { img.hidden = true; img.removeAttribute("src"); }
  }
  function collect() {
    const p = {};
    TEXT.forEach(k => { p[k] = field(k).value.trim(); });
    p.starts_at = field("starts_at").value ? new Date(field("starts_at").value).toISOString() : "";
    p.ends_at = field("ends_at").value ? new Date(field("ends_at").value).toISOString() : "";
    return p;
  }
  function validate(p) {
    if (!p.name) return "Give the banner an internal name.";
    if (!p.headline_left) return "The left headline is required.";
    for (const k in LIMITS) if (p[k] && p[k].length > LIMITS[k]) return "Shorten \u201c" + k.replace(/_/g, " ") + "\u201d to " + LIMITS[k] + " characters or fewer.";
    if (p.image_url && !/^https:\/\/[^\s]+$/.test(p.image_url)) return "The image link must start with https://";
    if (p.cta_url && !(/^https:\/\/[^\s]+$/.test(p.cta_url) || /^[A-Za-z0-9_.\/?=&#%-]+$/.test(p.cta_url))) return "The button link must be a page on this site or a full https:// link.";
    if (p.starts_at && p.ends_at && new Date(p.ends_at) <= new Date(p.starts_at)) return "The end time must be after the start time.";
    return "";
  }
  async function save(thenPreview) {
    const p = collect();
    const problem = validate(p);
    if (problem) { status(problem, true); return; }
    const btns = [$("jd-form-save"), $("jd-form-preview")];
    btns.forEach(b => { b.disabled = true; });
    status("Saving\u2026");
    try {
      const id = await rpc("admin_save_site_banner", { p_id: editingId, p_payload: p });
      $("jd-form-dialog").close();
      JD.toast("Banner saved", "ok");
      await load();
      if (thenPreview) window.open(site("index.html") + "?preview_banner=" + encodeURIComponent(id || editingId), "_blank", "noopener");
    } catch (e) {
      console.warn("[JulaDirect] save banner", e && e.message);
      status((e && e.message) || "We could not save this banner.", true);
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }
  function openForm(b) {
    editingId = b ? b.id : null;
    $("jd-form-title").textContent = b ? "Edit banner" : "New banner";
    fillForm(b);
    $("jd-form-dialog").showModal();
    field("name").focus();
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const row = e.target.closest("[data-id]");
    const id = row && row.getAttribute("data-id");
    const b = id && banners.find(x => x.id === id);
    if (e.target.closest("#jd-new") || e.target.closest("[data-new]")) { openForm(null); return; }
    if (e.target.closest("[data-retry]")) { load(); return; }
    if (b && e.target.closest("[data-edit]")) { openForm(b); return; }
    if (b && e.target.closest("[data-delete]")) {
      if (!(await ask("Delete this banner?", "\u201c" + b.name + "\u201d will be removed permanently.", "Delete"))) return;
      try { await rpc("admin_delete_site_banner", { p_id: b.id }); JD.toast("Banner deleted", "ok"); await load(); }
      catch (err) { JD.toast((err && err.message) || "We could not delete this banner.", "error"); }
    }
  });
  document.addEventListener("change", async e => {
    const t = e.target.closest("[data-toggle]");
    if (!t) return;
    const row = t.closest("[data-id]");
    const b = banners.find(x => x.id === row.getAttribute("data-id"));
    if (!b) return;
    const turnOn = t.checked;
    const other = turnOn ? banners.find(x => x.is_active && x.id !== b.id) : null;
    if (other && !(await ask("Replace the live banner?", "\u201c" + other.name + "\u201d is live now. Turning on \u201c" + b.name + "\u201d will switch it off.", "Switch banners"))) { t.checked = false; return; }
    t.disabled = true;
    try {
      await rpc("admin_set_site_banner_active", { p_id: b.id, p_active: turnOn });
      JD.toast(turnOn ? "Banner is live on the homepage" : "Banner switched off", "ok");
    } catch (err) {
      JD.toast((err && err.message) || "We could not change that banner.", "error");
    }
    await load();
  });
  $("jd-form").addEventListener("submit", ev => { ev.preventDefault(); save(false); });
  $("jd-form-preview").addEventListener("click", () => save(true));
  $("jd-form-cancel").addEventListener("click", () => $("jd-form-dialog").close());
  $("f-image_url").addEventListener("input", JD.debounce(imgPreview, 300));
  $("f-body").addEventListener("input", () => { $("f-body-count").textContent = $("f-body").value.length + " / 280"; });

  JD.mountShell({ active: "" });
  load();
})();
