/* Security (v2 design). The previous security.html was a copy of the settings page and
   offered no security controls. This page uses Supabase Auth through the existing client:
   - shows the account's sign-in details (email, verification, provider, dates)
   - auth.updateUser({ password }) to change the password
   - auth.signOut({ scope: "global" }) to end every session, and the adapter's signOut for this device
   No password or token is stored or displayed; password rules enforced by the server still apply. */
(function () {
  "use strict";
  var JD = window.JD, $ = function (id) { return document.getElementById(id); };
  var client = null, user = null;

  function fmt(iso) { var d = new Date(iso); return isNaN(d) ? "\u2014" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
  function fmtTime(iso) { var d = new Date(iso); return isNaN(d) ? "\u2014" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function strength(p) {
    var s = 0;
    if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
    return p.length ? Math.max(1, s) : 0;
  }
  function note(msg, bad) { var el = $("sc-pw-status"); el.textContent = msg || ""; el.classList.toggle("is-error", !!bad); }

  async function load() {
    $("st-state").innerHTML = '<div class="jd-skel" style="height:220px;border-radius:24px"></div>';
    try {
      var A = JD.auth(); if (!A) throw new Error("Security settings are unavailable right now.");
      await A.ready();
      var session = await A.getSession();
      if (!session || !session.user) {
        $("st-state").innerHTML = JD.empty({ icon: "shield", title: "Sign in to manage your security", text: "Password and device controls are tied to your JulaDirect account.", actions: '<a class="jd-btn jd-btn--primary" href="login.html?redirect=security.html">Log in</a>' });
        return;
      }
      user = session.user; client = await JD.client();
      var providers = (user.app_metadata && (user.app_metadata.providers || [user.app_metadata.provider])) || [];
      providers = providers.filter(Boolean);
      var names = providers.map(function (p) { return p === "email" ? "Email and password" : p === "google" ? "Google" : p.charAt(0).toUpperCase() + p.slice(1); });
      $("sc-email").textContent = user.email || "\u2014";
      $("sc-verified").innerHTML = user.email_confirmed_at ? '<span class="jd-badge jd-badge--ok">Verified</span>' : '<span class="jd-badge jd-badge--warn">Not verified</span>';
      $("sc-provider").textContent = names.join(", ") || "\u2014";
      $("sc-created").textContent = fmt(user.created_at);
      $("sc-last").textContent = fmtTime(user.last_sign_in_at);
      if (providers.length && providers.indexOf("email") < 0) $("sc-pw-note").textContent = "You signed in with " + names.join(", ") + ". Setting a password also lets you sign in with your email address.";
      $("st-state").innerHTML = ""; $("st-body").hidden = false;
    } catch (e) {
      console.warn("[JulaDirect] security", e && e.message);
      $("st-state").innerHTML = JD.empty({ icon: "shield", title: "We could not load your security details", text: "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="st-retry">Try again</button>' });
    }
  }

  $("sc-new").addEventListener("input", function () { $("sc-meter").setAttribute("data-s", String(strength(this.value))); });
  $("sc-pw-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var a = $("sc-new").value, b = $("sc-confirm").value;
    if (a.length < 8) { note("Use at least 8 characters.", true); $("sc-new").focus(); return; }
    if (!/[A-Za-z]/.test(a) || !/\d/.test(a)) { note("Include both letters and numbers.", true); $("sc-new").focus(); return; }
    if (a !== b) { note("The two passwords do not match.", true); $("sc-confirm").focus(); return; }
    note("Updating\u2026"); $("sc-pw-go").disabled = true;
    try {
      var r = await client.auth.updateUser({ password: a });
      if (r.error) throw r.error;
      $("sc-new").value = ""; $("sc-confirm").value = ""; $("sc-meter").setAttribute("data-s", "0");
      note("Password updated", false); JD.toast("Password updated", "ok");
    } catch (e) {
      console.warn("[JulaDirect] password", e && e.message);
      note((e && e.message) || "We could not update your password. If you signed in a while ago, sign in again and retry.", true);
    }
    $("sc-pw-go").disabled = false;
  });

  $("sc-out-here").addEventListener("click", async function () {
    this.disabled = true;
    try { await JD.auth().signOut(); } catch (e) { /* leave regardless */ }
    location.href = "index.html";
  });
  $("sc-out-all").addEventListener("click", function () { $("sc-confirm").showModal(); });
  $("sc-confirm-no").addEventListener("click", function () { $("sc-confirm").close(); });
  $("sc-confirm-yes").addEventListener("click", async function () {
    this.disabled = true; this.textContent = "Signing out\u2026";
    try { await client.auth.signOut({ scope: "global" }); } catch (e) { try { await JD.auth().signOut(); } catch (e2) { /* leave regardless */ } }
    location.href = "login.html";
  });
  document.addEventListener("click", function (e) { if (e.target.closest("#st-retry")) load(); });
  var links = JD.$$(".ac-subnav a[href^='#']");
  links.forEach(function (a) { a.addEventListener("click", function () { links.forEach(function (x) { x.classList.toggle("is-on", x === a); }); }); });

  JD.mountShell({ active: "account" });
  JD.accountNav("account");
  load();
})();
