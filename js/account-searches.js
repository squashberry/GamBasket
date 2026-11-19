/* Saved searches & price alerts (v2 design). Reads and writes the same tables
   as before: saved_searches (id, name, criteria, notify_on_new, updated_at) and
   wishlist_alerts (price_drop rows). The criteria keys and the explore URL
   mapping match what Explore writes, so every saved search still opens. Row-level
   security keeps each user to their own rows. */
(function () {
  "use strict";
  var JD = window.JD;
  var $ = function (id) { return document.getElementById(id); };
  var esc = JD.esc;
  var userId = null, client = null, searches = [], alerts = [], pendingDelete = null;

  function readable(c) {
    var p = [];
    if (c.query) p.push("\u201c" + c.query + "\u201d");
    if (c.category && c.category !== "All") p.push(c.category);
    if (c.location && c.location !== "all") p.push(c.location);
    if (c.minPrice !== undefined) p.push("from D " + Number(c.minPrice).toLocaleString("en-GB"));
    if (c.maxPrice !== undefined) p.push("up to D " + Number(c.maxPrice).toLocaleString("en-GB"));
    if (c.condition) p.push(c.condition);
    if (c.inStock) p.push("in stock");
    if (c.delivery) p.push("delivery available");
    if (c.brandModel) p.push(c.brandModel);
    return p.join(" \u00b7 ") || "All products";
  }
  function url(c) {
    var q = new URLSearchParams();
    if (c.query) q.set("q", c.query);
    if (c.category && c.category !== "All") q.set("category", c.category);
    if (c.location && c.location !== "all") q.set("location", c.location);
    if (c.minPrice !== undefined) q.set("min", String(c.minPrice));
    if (c.maxPrice !== undefined) q.set("max", String(c.maxPrice));
    if (c.condition) q.set("condition", c.condition);
    if (c.inStock) q.set("stock", "1");
    if (c.delivery) q.set("delivery", "1");
    if (c.sort && c.sort !== "newest") q.set("sort", c.sort);
    if (c.brandModel) q.set("brandModel", c.brandModel);
    var s = q.toString();
    return "explore.html" + (s ? "?" + s : "");
  }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }

  function renderSearches() {
    $("ss-count").textContent = searches.length ? "(" + searches.length + ")" : "";
    $("ss-list").innerHTML = searches.length ? searches.map(function (s) {
      var on = !!s.notify_on_new;
      return '<div class="ac-item" data-id="' + esc(s.id) + '"><div class="ac-item__t"><b>' + esc(s.name) + '</b><small>' + esc(readable(s.criteria || {})) + '</small><small><span class="jd-badge ' + (on ? "jd-badge--ok" : "") + '">' + JD.icon(on ? "bell" : "close", 12) + (on ? "New-listing alerts on" : "Alerts paused") + "</span> &nbsp;Saved " + esc(when(s.created_at)) + "</small></div>" +
        '<div class="ac-item__act"><a class="jd-btn jd-btn--primary jd-btn--sm" href="' + esc(url(s.criteria || {})) + '">Open search</a>' +
        '<button type="button" class="jd-btn jd-btn--secondary jd-btn--sm" data-toggle>' + (on ? "Pause alerts" : "Enable alerts") + "</button>" +
        '<button type="button" class="jd-btn jd-btn--ghost jd-btn--sm" data-delete>Delete</button></div></div>';
    }).join("") : '<div style="padding:14px 18px 20px">' + JD.empty({ icon: "bookmark", title: "No saved searches yet", text: "Save your filters from Explore and we will tell you when a newly approved listing matches.", actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Explore products</a>' }) + "</div>";
  }

  function renderAlerts(products) {
    var map = {}; products.forEach(function (p) { map[p.id] = p; });
    var rows = alerts.filter(function (a) { var p = map[a.product_id]; return p && p.status === "approved"; });
    $("ss-read").hidden = !rows.some(function (a) { return !a.is_read; });
    $("ss-alerts").innerHTML = rows.length ? rows.map(function (a) {
      var p = map[a.product_id], oldV = Number(a.old_value), newV = Number(a.new_value);
      var pct = oldV > 0 && isFinite(newV) ? Math.round(((oldV - newV) / oldV) * 100) : 0;
      return '<a class="ac-alert' + (a.is_read ? "" : " is-new") + '" href="product.html?id=' + encodeURIComponent(p.id) + '"><img src="' + esc(JD.safeUrl(p.main_image) || JD.placeholder) + '" alt="" loading="lazy"><span class="ac-alert__t"><b>' + esc(p.title) + "</b><small>" +
        esc(JD.money(oldV, p.currency)) + " &rarr; <span class=\"ac-drop\">" + esc(JD.money(newV, p.currency)) + "</span>" + (pct > 0 ? " &middot; <span class=\"ac-drop\">" + pct + "% lower</span>" : "") + " &middot; " + esc(when(a.created_at)) + '</small></span><span class="ac-chev">' + JD.icon("chevronRight", 18) + "</span></a>";
    }).join("") : '<div style="padding:14px 18px 20px">' + JD.empty({ icon: "heart", title: "No price drops yet", text: "Save a product to your wishlist and we will show eligible price reductions here.", actions: '<a class="jd-btn jd-btn--secondary" href="wishlist.html">Open wishlist</a>' }) + "</div>";
  }

  async function load() {
    $("ss-state").innerHTML = '<div class="jd-skel" style="height:140px;border-radius:24px"></div>';
    $("ss-body").hidden = true;
    try {
      var A = JD.auth(); if (!A) throw new Error("Saved searches are unavailable right now.");
      await A.ready();
      var user = await A.getUser();
      if (!user) {
        $("ss-state").innerHTML = JD.empty({ icon: "bookmark", title: "Sign in to see your saved searches", text: "Your searches and price alerts follow you across devices once you are signed in.", actions: '<a class="jd-btn jd-btn--primary" href="' + esc(JD.loginUrl()) + '">Log in</a><a class="jd-btn jd-btn--secondary" href="signup.html">Create account</a>' });
        return;
      }
      userId = user.id; client = await JD.client();
      var res = await Promise.all([
        client.from("saved_searches").select("id,name,criteria,notify_on_new,created_at,updated_at").eq("user_id", userId).order("created_at", { ascending: false }),
        client.from("wishlist_alerts").select("id,product_id,alert_type,old_value,new_value,created_at,is_read").eq("user_id", userId).eq("alert_type", "price_drop").order("created_at", { ascending: false }).limit(30)
      ]);
      if (res[0].error) throw res[0].error;
      if (res[1].error) throw res[1].error;
      searches = res[0].data || []; alerts = res[1].data || [];
      var ids = Array.from(new Set(alerts.map(function (a) { return a.product_id; }).filter(JD.isUuid)));
      var products = [];
      if (ids.length) { var pr = await client.from("products").select("id,title,main_image,status,currency").in("id", ids); if (!pr.error) products = pr.data || []; }
      $("ss-state").innerHTML = "";
      $("ss-body").hidden = false;
      renderSearches(); renderAlerts(products);
      window.__ssProducts = products;
    } catch (e) {
      console.warn("[JulaDirect] saved searches", e && e.message);
      $("ss-state").innerHTML = JD.empty({ icon: "bookmark", title: "We could not load your saved searches", text: (e && e.message) || "Please check your connection and try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="ss-retry">Try again</button>' });
    }
  }

  async function toggle(id) {
    var s = searches.find(function (x) { return x.id === id; }); if (!s) return;
    var next = !s.notify_on_new;
    var r = await client.from("saved_searches").update({ notify_on_new: next, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
    if (r.error) { JD.toast("We could not update that search.", "error"); return; }
    s.notify_on_new = next; renderSearches();
    JD.toast(next ? "Alerts enabled" : "Alerts paused", "ok");
  }
  async function remove(id) {
    var r = await client.from("saved_searches").delete().eq("id", id).eq("user_id", userId);
    if (r.error) { JD.toast("We could not delete that search.", "error"); return; }
    searches = searches.filter(function (x) { return x.id !== id; }); renderSearches();
    JD.toast("Saved search deleted", "ok");
  }

  document.addEventListener("click", function (e) {
    var row = e.target.closest("[data-id]"), id = row && row.getAttribute("data-id");
    if (e.target.closest("#ss-retry")) { load(); return; }
    if (row && e.target.closest("[data-toggle]")) { toggle(id); return; }
    if (row && e.target.closest("[data-delete]")) {
      var s = searches.find(function (x) { return x.id === id; });
      pendingDelete = id; $("ss-confirm-text").textContent = "\u201c" + (s ? s.name : "This search") + "\u201d and its alerts will be removed.";
      $("ss-confirm").showModal(); return;
    }
    if (e.target.closest("#ss-read")) {
      client.from("wishlist_alerts").update({ is_read: true }).eq("user_id", userId).eq("alert_type", "price_drop").eq("is_read", false).then(function (r) {
        if (r.error) { JD.toast("We could not update your alerts.", "error"); return; }
        alerts.forEach(function (a) { a.is_read = true; }); renderAlerts(window.__ssProducts || []); JD.toast("Alerts marked as read", "ok");
      });
    }
  });
  $("ss-confirm-cancel").addEventListener("click", function () { pendingDelete = null; $("ss-confirm").close(); });
  $("ss-confirm-ok").addEventListener("click", function () { var id = pendingDelete; pendingDelete = null; $("ss-confirm").close(); if (id) remove(id); });
  window.addEventListener("gambasket:auth:change", load);

  JD.mountShell({ active: "account" });
  JD.accountNav("searches");
  load();
})();
