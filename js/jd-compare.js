/* JulaDirect v2 compare. The shortlist is stored locally (same key as before)
   and every product is re-read live, so prices and stock are never stale. */
(function () {
  "use strict";
  const JD = window.JD;
  const root = document.getElementById("jd-cmp");
  const sub = document.getElementById("jd-sub");
  let products = [];
  const humanize = k => { const t = String(k).replace(/[_-]+/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const val = v => {
    if (v === null || v === undefined || v === "") return "";
    if (Array.isArray(v)) return v.filter(x => typeof x !== "object").join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return typeof v === "object" ? "" : String(v);
  };

  function render() {
    if (!products.length) {
      sub.textContent = "Compare up to four products side by side.";
      root.innerHTML = JD.empty({ icon: "scale", title: "Nothing to compare yet", text: "Tap the compare button on product cards to add up to four products, then come back here.", actions: '<a class="jd-btn jd-btn--primary" href="explore.html">Browse the marketplace</a>' });
      return;
    }
    sub.textContent = products.length + (products.length === 1 ? " product selected. Add one more to compare." : " products selected.");
    const low = Math.min.apply(null, products.map(p => Number(p.price || 0)));
    const best = p => products.length > 1 && Number(p.price || 0) === low;
    const keys = [];
    products.forEach(p => Object.keys(p.attributes && typeof p.attributes === "object" ? p.attributes : {}).forEach(k => { if (!keys.includes(k) && products.some(x => val((x.attributes || {})[k]))) keys.push(k); }));
    const row = (label, fn) => '<tr><th scope="row">' + JD.esc(label) + "</th>" + products.map(p => { const out = fn(p); return "<td>" + (out === "" || out === null ? '<span class="jd-dash">&mdash;</span>' : out) + "</td>"; }).join("") + "</tr>";
    const rows = [
      '<tr><th scope="row">Product</th>' + products.map(p => '<td class="jd-cmp__prod"><img src="' + JD.esc(JD.safeUrl(p.main_image) || JD.placeholder) + '" alt="" loading="lazy"><a href="product.html?id=' + encodeURIComponent(p.id) + '">' + JD.esc(p.title) + '</a><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="jd-btn jd-btn--primary jd-btn--sm" data-add="' + JD.esc(p.id) + '"' + (Number(p.stock || 0) <= 0 ? " disabled" : "") + ">" + JD.icon("cart", 15) + 'Add</button><button type="button" class="jd-btn jd-btn--ghost jd-btn--sm" data-drop="' + JD.esc(p.id) + '">Remove</button></div></td>').join("") + "</tr>",
      row("Price", p => '<strong class="' + (best(p) ? "jd-best" : "") + '">' + JD.esc(JD.money(p.price, p.currency)) + "</strong>" + (best(p) ? '<br><span class="jd-best" style="font-size:12.5px">Lowest price</span>' : "")),
      row("Condition", p => JD.esc(p.condition || "")),
      row("Availability", p => Number(p.stock || 0) <= 0 ? '<span class="jd-badge jd-badge--bad">Out of stock</span>' : '<span class="jd-badge jd-badge--ok">' + Number(p.stock) + " available</span>"),
      row("Delivery", p => p.delivery_available === true ? "Available" : "Not offered"),
      row("Location", p => JD.esc(p.location || "")),
      row("Seller", p => (p._seller && p._seller.verified ? JD.icon("shield", 15) + " " : "") + JD.esc(p._seller ? p._seller.name : "")),
      row("Category", p => JD.esc(p.category_id || ""))
    ].concat(keys.map(k => row(humanize(k), p => JD.esc(val((p.attributes || {})[k])))));
    root.innerHTML = '<div class="jd-cmp"><table><tbody>' + rows.join("") + "</tbody></table></div>" +
      '<div style="margin-top:16px"><button type="button" class="jd-btn jd-btn--secondary jd-btn--sm" id="jd-cmp-clear">Clear comparison</button></div>';
  }

  async function load() {
    const ids = JD.compare.ids();
    if (!ids.length) { products = []; render(); return; }
    try {
      const c = await JD.client();
      const { data, error } = await c.from("products").select("*").in("id", ids).eq("status", "approved");
      if (error) throw error;
      const byId = new Map((data || []).map(p => [p.id, p]));
      products = ids.map(id => byId.get(id)).filter(Boolean);
      await JD.data.attachSellers(products);
      if (products.length !== ids.length) JD.compare.write(products.map(p => p.id));
      render();
    } catch (e) {
      console.warn("[JulaDirect] compare", e && e.message);
      root.innerHTML = JD.empty({ icon: "scale", title: "We could not load your comparison", text: (e && e.message) || "Please try again.", actions: '<button type="button" class="jd-btn jd-btn--secondary" id="jd-retry">Try again</button>' });
    }
  }

  document.addEventListener("click", e => {
    const drop = e.target.closest("[data-drop]");
    if (drop) JD.compare.toggle(drop.getAttribute("data-drop"));
    else if (e.target.closest("#jd-cmp-clear")) JD.compare.clear();
    else if (e.target.closest("#jd-retry")) load();
  });
  window.addEventListener("gambasket:compare:change", load);

  window.addEventListener("jd:pane:show", e => { if (e.detail.route === "compare" && !e.detail.first) load(); });

  JD.mountShell({ active: "" });
  JD.accountNav("compare");
  JD.bindProductActions(document);
  load();
})();
