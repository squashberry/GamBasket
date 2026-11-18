/* JulaDirect account page (ledger design). Same backend calls as before:
   GamBasketAuth.getSession / fetchUserProfile / getUserRoles / getOrders /
   getWishlist / getCart / signOut. Counts come from real rows; nothing is
   invented (the old page showed a hardcoded "0" for messages, so no messages
   count is shown here). */
(function () {
  "use strict";
  var LG = window.LG, $ = LG.$, esc = LG.esc;
  var NOTE_KEY = "gambasket_notifications";
  var RECENT_KEY = "jd_recent_products";
  var busy = false;

  function greeting() { var h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
  function show(which) { ["me-loading", "me-guest", "me-auth"].forEach(function (id) { $("#" + id).hidden = id !== which; }); }
  function renumber() {
    var n = 0;
    LG.$$("[data-sec]").forEach(function (s) { if (!s.hidden) { n++; s.querySelector(".lg-sec__n").textContent = String(n).padStart(2, "0"); } });
  }
  function readNotes() { try { var a = JSON.parse(localStorage.getItem(NOTE_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return x && typeof x.title === "string"; }) : []; } catch (e) { return []; } }
  function writeNotes(a) { try { localStorage.setItem(NOTE_KEY, JSON.stringify(a)); } catch (e) { /* unavailable */ } }
  function ago(iso) {
    var d = new Date(iso); if (isNaN(d)) return "";
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function renderNotes() {
    var list = readNotes().slice(0, 6), ul = $("#me-notes");
    $("#me-note-actions").hidden = !list.length;
    ul.innerHTML = list.length ? list.map(function (n) {
      return '<li class="' + (n.read ? "" : "is-new") + '"><i></i><div><b>' + esc(n.title) + "</b><p>" + esc(n.message || "") + "</p></div><time>" + esc(ago(n.time)) + "</time></li>";
    }).join("") : '<li style="display:block"><p class="lg-muted">Nothing new. Order updates and replies from sellers will appear here.</p></li>';
  }

  function renderRecent(client) {
    var ids = []; try { ids = (JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") || []).slice(0, 8); } catch (e) { ids = []; }
    var sec = $("#sec-recent");
    if (!ids.length || !client) { sec.hidden = true; renumber(); return; }
    client.from("products").select("id,title,price,currency,main_image").in("id", ids).eq("status", "approved").then(function (r) {
      var rows = (r.data || []); var map = {}; rows.forEach(function (p) { map[p.id] = p; });
      var ordered = ids.map(function (i) { return map[i]; }).filter(Boolean);
      if (!ordered.length) { sec.hidden = true; renumber(); return; }
      sec.hidden = false;
      $("#me-recent").innerHTML = ordered.map(function (p) {
        return '<a class="lg-prod" href="product.html?id=' + encodeURIComponent(p.id) + '"><img src="' + esc(LG.safeUrl(p.main_image) || "") + '" alt="" loading="lazy"><b>' + esc(p.title) + "</b><span>" + esc(LG.money(p.price, p.currency)) + "</span></a>";
      }).join("");
      renumber();
    }, function () { sec.hidden = true; renumber(); });
  }

  async function render() {
    if (busy) return; busy = true;
    try {
      var A = LG.auth(); if (!A) throw new Error("Account services are unavailable.");
      await A.ready();
      var session = await A.getSession();
      if (!session || !session.user) { show("me-guest"); return; }
      var user = session.user;
      var profile = null, roles = [];
      try { profile = await A.fetchUserProfile(); } catch (e) { profile = null; }
      try { roles = (await A.getUserRoles()) || []; } catch (e) { roles = []; }
      var meta = user.user_metadata || {};
      var first = (profile && profile.first_name) || meta.first_name || meta.given_name || "there";
      var last = (profile && profile.last_name) || meta.last_name || meta.family_name || "";
      var full = [first === "there" ? "" : first, last].filter(Boolean).join(" ") || "Your account";
      $("#me-greet").textContent = greeting();
      $("#me-name").textContent = first;
      $("#me-date").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      $("#me-fullname").textContent = full;
      $("#me-email").textContent = user.email || (profile && profile.email) || "";
      $("#me-initial").textContent = (first === "there" ? (user.email || "U") : first).charAt(0).toUpperCase();
      var isAdmin = roles.indexOf("admin") > -1;
      $("#me-role").textContent = isAdmin ? "Administrator" : roles.indexOf("seller") > -1 ? "Seller" : roles.indexOf("delivery_worker") > -1 ? "Courier" : roles.indexOf("marketplace_worker") > -1 ? "Operations" : "Buyer";
      var ws = { "ws-seller": isAdmin || roles.indexOf("seller") > -1, "ws-delivery": isAdmin || roles.indexOf("delivery_worker") > -1, "ws-worker": isAdmin || roles.indexOf("marketplace_worker") > -1, "ws-admin": isAdmin, "ws-banners": isAdmin };
      var any = false; Object.keys(ws).forEach(function (id) { $("#" + id).hidden = !ws[id]; if (ws[id]) any = true; });
      $("#sec-work").hidden = !any;
      show("me-auth");
      renderNotes(); renumber();

      var client = await LG.client();
      var set = function (id, v) { $("#" + id).textContent = v == null ? "\u2014" : String(v); };
      Promise.all([
        A.getOrders().then(function (r) { set("st-orders", r && r.count != null ? r.count : 0); }, function () { set("st-orders", null); }),
        A.getWishlist().then(function (r) { set("st-wishlist", r && r.count != null ? r.count : 0); }, function () { set("st-wishlist", null); }),
        A.getCart().then(function (r) { set("st-bag", ((r && r.items) || []).reduce(function (t, i) { return t + Number(i.quantity || 0); }, 0)); }, function () { set("st-bag", null); }),
        client ? client.from("saved_searches").select("id", { count: "exact", head: true }).eq("user_id", user.id).then(function (r) { set("st-searches", r.error ? null : (r.count || 0)); }, function () { set("st-searches", null); }) : Promise.resolve(set("st-searches", null))
      ]);
      renderRecent(client);
    } catch (err) {
      console.warn("[JulaDirect] account", err && err.message);
      show("me-guest");
    } finally { busy = false; }
  }

  $("#me-signout-btn").addEventListener("click", function () { $("#me-signout").showModal(); });
  $("#me-signout-cancel").addEventListener("click", function () { $("#me-signout").close(); });
  $("#me-signout-ok").addEventListener("click", async function () {
    var b = this; b.disabled = true; b.textContent = "Signing out\u2026";
    try { await LG.auth().signOut(); } catch (e) { /* leave the page regardless */ }
    location.href = "index.html";
  });
  $("#me-note-read").addEventListener("click", function () { writeNotes(readNotes().map(function (n) { n.read = true; return n; })); renderNotes(); });
  $("#me-note-clear").addEventListener("click", function () { writeNotes([]); renderNotes(); LG.toast("Notifications cleared"); });
  $("#me-recent-clear").addEventListener("click", function () { try { localStorage.removeItem(RECENT_KEY); } catch (e) { /* ignore */ } $("#sec-recent").hidden = true; renumber(); LG.toast("Recently viewed cleared"); });
  window.addEventListener("gambasket:auth:change", render);

  LG.mount({ active: "account", tab: "account" });
  render();
})();
