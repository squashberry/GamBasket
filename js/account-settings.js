/* Profile & preferences (v2 design). Same storage as the previous page:
   - profiles (first_name, last_name, phone, region, area, updated_at) for the account
   - localStorage "gambasket_delivery_address" for the delivery address (device only)
   - localStorage "gambasket_preferences" for the switches (device only), firing
     "gambasket:preferences:change" so existing listeners keep working
   Left out on purpose: the photo picker (it only previewed an image and saved nothing),
   and the dark-mode and language selectors (the v2 design has no dark theme and there
   are no translations). Unknown keys already stored in the preferences are preserved. */
(function () {
  "use strict";
  var JD = window.JD, $ = function (id) { return document.getElementById(id); };
  var PREF_KEY = "gambasket_preferences", ADDR_KEY = "gambasket_delivery_address";
  var DEFAULTS = { personalizedRecommendations: true, rememberDelivery: true, nearbyProducts: true, notifyOrders: true, notifyDelivery: true, notifyMessages: true, notifyPromotions: true, notifyAccount: true };
  var MESSAGES = { personalizedRecommendations: "Personalised recommendations", rememberDelivery: "Saved delivery details", nearbyProducts: "Nearby products", notifyOrders: "Order notifications", notifyDelivery: "Delivery notifications", notifyMessages: "Message notifications", notifyPromotions: "Promotion notifications", notifyAccount: "Account notifications" };
  var user = null, client = null;

  function raw() { try { var o = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function setPref(key, value) {
    var o = raw(); o[key] = value;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(o)); localStorage.setItem("gambasket_preferences_updated_at", String(Date.now())); }
    catch (e) { JD.toast("This browser could not save the preference.", "error"); return; }
    window.dispatchEvent(new CustomEvent("gambasket:preferences:change", { detail: o }));
    JD.toast(MESSAGES[key] + (value ? " on" : " off"), "ok");
  }
  function status(msg, bad) { var el = $("profileSaveStatus"); el.textContent = msg || ""; el.classList.toggle("is-error", !!bad); }

  async function load() {
    $("st-state").innerHTML = '<div class="jd-skel" style="height:220px;border-radius:24px"></div>';
    try {
      var A = JD.auth(); if (!A) throw new Error("Settings are unavailable right now.");
      await A.ready();
      var session = await A.getSession();
      if (!session || !session.user) {
        $("st-state").innerHTML = JD.empty({ icon: "user", title: "Sign in to manage your profile", text: "Your details and preferences are tied to your JulaDirect account.", actions: '<a class="jd-btn jd-btn--primary" href="login.html?redirect=settings.html">Log in</a><a class="jd-btn jd-btn--secondary" href="signup.html?redirect=settings.html">Create account</a>' });
        return;
      }
      user = session.user; client = await JD.client();
      var profile = null; try { profile = await A.fetchUserProfile(); } catch (e) { profile = null; }
      var meta = user.user_metadata || {};
      $("firstName").value = (profile && profile.first_name) || meta.first_name || meta.given_name || "";
      $("lastName").value = (profile && profile.last_name) || meta.last_name || meta.family_name || "";
      $("emailAddress").value = user.email || "";
      $("phoneNumber").value = (profile && profile.phone) || "";
      var region = (profile && profile.region) || "", sel = $("region");
      if (region && !Array.prototype.some.call(sel.options, function (o) { return o.value === region || o.text === region; })) { var op = document.createElement("option"); op.textContent = region; sel.appendChild(op); }
      sel.value = region;
      $("area").value = (profile && profile.area) || "";
      try { $("deliveryAddress").value = localStorage.getItem(ADDR_KEY) || ""; } catch (e) { /* unavailable */ }
      var merged = Object.assign({}, DEFAULTS, raw());
      Object.keys(DEFAULTS).forEach(function (k) { var el = $(k); if (el) el.checked = !!merged[k]; });
      $("st-state").innerHTML = ""; $("st-body").hidden = false;
    } catch (e) {
      console.warn("[JulaDirect] settings", e && e.message);
      $("st-state").innerHTML = JD.empty({ icon: "user", title: "We could not load your settings", text: "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="st-retry">Try again</button>' });
    }
  }

  $("st-profile").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var first = $("firstName").value.trim(), last = $("lastName").value.trim(), phone = $("phoneNumber").value.trim(), region = $("region").value, area = $("area").value.trim(), addr = $("deliveryAddress").value.trim();
    if (!first) { status("Please enter your first name.", true); $("firstName").focus(); return; }
    if (phone && !/^[+]?[0-9 ()\-]{7,24}$/.test(phone)) { status("Enter a valid phone number, for example +220 000 0000.", true); $("phoneNumber").focus(); return; }
    status("Saving\u2026"); $("st-save").disabled = true;
    try {
      var r = await client.from("profiles").update({ first_name: first, last_name: last, phone: phone, region: region, area: area, updated_at: new Date().toISOString() }).eq("id", user.id);
      if (r.error) throw r.error;
      try { localStorage.setItem(ADDR_KEY, addr); } catch (e) { /* device storage unavailable */ }
      status("Saved", false);
      JD.toast("Profile updated", "ok");
      window.dispatchEvent(new CustomEvent("gambasket:profile:change", { detail: { first_name: first, last_name: last, phone: phone, region: region, area: area } }));
    } catch (e) {
      console.warn("[JulaDirect] settings save", e && e.message);
      status((window.getAuthErrorMessage ? window.getAuthErrorMessage(e) : null) || (e && e.message) || "Could not save your profile.", true);
    }
    $("st-save").disabled = false;
  });

  Object.keys(DEFAULTS).forEach(function (k) { var el = $(k); if (el) el.addEventListener("change", function () { setPref(k, el.checked); }); });
  document.addEventListener("click", function (e) { if (e.target.closest("#st-retry")) load(); });
  var links = JD.$$(".ac-subnav a[href^='#']");
  links.forEach(function (a) { a.addEventListener("click", function () { links.forEach(function (x) { x.classList.toggle("is-on", x === a); }); }); });
  window.addEventListener("gambasket:auth:change", load);

  JD.mountShell({ active: "account" });
  JD.accountNav("account");
  load();
})();
