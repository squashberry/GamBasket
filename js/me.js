/* JulaDirect account page (v2 design, same shell as the homepage).
   Same backend calls as before: GamBasketAuth.getSession / fetchUserProfile /
   getUserRoles / getOrders / getWishlist / getCart / signOut. Counts come from
   real rows; the old hardcoded "0" messages count is gone. */
(function () {
  "use strict";
  var JD = window.JD;
  var $ = function (id) { return document.getElementById(id); };
  var esc = JD.esc;
  var NOTE_KEY = "gambasket_notifications";
  var busy = false;

  function greeting() { var h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
  function show(which) { ["me-loading", "me-guest", "me-auth"].forEach(function (id) { $(id).hidden = id !== which; }); }
  function icons() { JD.$$("[data-ico]").forEach(function (el) { el.innerHTML = JD.icon(el.getAttribute("data-ico"), Number(el.getAttribute("data-size")) || 20); }); }
  function readNotes() { try { var a = JSON.parse(localStorage.getItem(NOTE_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return x && typeof x.title === "string"; }) : []; } catch (e) { return []; } }
  function writeNotes(a) { try { localStorage.setItem(NOTE_KEY, JSON.stringify(a)); } catch (e) { /* storage unavailable */ } }
  function ago(iso) {
    var d = new Date(iso); if (isNaN(d)) return "";
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function renderNotes() {
    var list = readNotes().slice(0, 6);
    $("me-note-actions").hidden = !list.length;
    $("me-notes").innerHTML = list.length ? list.map(function (n) {
      return '<div class="ac-note' + (n.read ? "" : " is-new") + '"><i></i><div><b>' + esc(n.title) + "</b><p>" + esc(n.message || "") + "</p></div><time>" + esc(ago(n.time)) + "</time></div>";
    }).join("") : '<p class="ac-empty" style="padding-left:0">Nothing new. Order updates and replies from sellers will appear here.</p>';
  }
  function renderRecent() {
    var ids = JD.recent.ids(), sec = $("sec-recent");
    if (!ids.length) { sec.hidden = true; return; }
    JD.data.byIds(ids.slice(0, 4)).then(function (rows) {
      if (!rows.length) { sec.hidden = true; return; }
      sec.hidden = false;
      $("me-recent").innerHTML = rows.map(JD.productCard).join("");
      JD.syncWishlist($("me-recent")); JD.syncCompare();
    }, function () { sec.hidden = true; });
  }

  async function render() {
    if (busy) return; busy = true;
    try {
      var A = JD.auth(); if (!A) throw new Error("Account services are unavailable.");
      await A.ready();
      var session = await A.getSession();
      if (!session || !session.user) { show("me-guest"); return; }
      var user = session.user, profile = null, roles = [];
      try { profile = await A.fetchUserProfile(); } catch (e) { profile = null; }
      try { roles = (await A.getUserRoles()) || []; } catch (e) { roles = []; }
      var meta = user.user_metadata || {};
      var first = (profile && profile.first_name) || meta.first_name || meta.given_name || "";
      var last = (profile && profile.last_name) || meta.last_name || meta.family_name || "";
      var full = [first, last].filter(Boolean).join(" ") || "Your account";
      $("me-greet").textContent = greeting();
      $("me-name").textContent = full;
      $("me-email").textContent = user.email || (profile && profile.email) || "";
      $("me-initial").textContent = (first || user.email || "U").charAt(0).toUpperCase();
      var isAdmin = roles.indexOf("admin") > -1;
      $("me-role").textContent = isAdmin ? "Administrator" : roles.indexOf("seller") > -1 ? "Seller" : roles.indexOf("delivery_worker") > -1 ? "Courier" : roles.indexOf("marketplace_worker") > -1 ? "Operations" : "Buyer";
      var ws = { "ws-seller": isAdmin || roles.indexOf("seller") > -1, "ws-delivery": isAdmin || roles.indexOf("delivery_worker") > -1, "ws-worker": isAdmin || roles.indexOf("marketplace_worker") > -1, "ws-admin": isAdmin, "ws-banners": isAdmin };
      var any = false; Object.keys(ws).forEach(function (id) { $(id).hidden = !ws[id]; if (ws[id]) any = true; });
      $("sec-work").hidden = !any;
      show("me-auth"); renderNotes();

      var client = await JD.client();
      var set = function (id, v) { $(id).textContent = v == null ? "\u2014" : String(v); };
      A.getOrders().then(function (r) { set("st-orders", r && r.count != null ? r.count : 0); }, function () { set("st-orders", null); });
      A.getWishlist().then(function (r) { set("st-wishlist", r && r.count != null ? r.count : 0); }, function () { set("st-wishlist", null); });
      A.getCart().then(function (r) { set("st-bag", ((r && r.items) || []).reduce(function (t, i) { return t + Number(i.quantity || 0); }, 0)); }, function () { set("st-bag", null); });
      if (client) client.from("saved_searches").select("id", { count: "exact", head: true }).eq("user_id", user.id).then(function (r) { set("st-searches", r.error ? null : (r.count || 0)); }, function () { set("st-searches", null); });
      else set("st-searches", null);
      renderRecent();
    } catch (err) {
      console.warn("[JulaDirect] account", err && err.message);
      show("me-guest");
    } finally { busy = false; }
  }

  $("me-signout-btn").addEventListener("click", function () { $("me-signout").showModal(); });
  $("me-signout-cancel").addEventListener("click", function () { $("me-signout").close(); });
  $("me-signout-ok").addEventListener("click", async function () {
    var b = this; b.disabled = true; b.textContent = "Signing out\u2026";
    try { await JD.auth().signOut(); } catch (e) { /* leave the page regardless */ }
    location.href = "index.html";
  });
  $("me-note-read").addEventListener("click", function () { writeNotes(readNotes().map(function (n) { n.read = true; return n; })); renderNotes(); });
  $("me-note-clear").addEventListener("click", function () { writeNotes([]); renderNotes(); JD.toast("Notifications cleared", "ok"); });
  $("me-recent-clear").addEventListener("click", function () { JD.recent.clear(); $("sec-recent").hidden = true; JD.toast("Recently viewed cleared", "ok"); });
  window.addEventListener("gambasket:auth:change", render);

  JD.mountShell({ active: "account" });
  JD.accountNav("account");
  JD.bindProductActions(document);
  icons();
  render();
})();
