/* GamBasket product comparison: a local, four-item shortlist backed by live approved listings. */
(() => {
  "use strict";
  const STORAGE_KEY = "gambasket_compare_products";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const $ = (id, root = document) => root.querySelector("#" + id);

  function readIds() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return [...new Set(Array.isArray(raw) ? raw.filter(id => typeof id === "string" && UUID.test(id)) : [])].slice(0, 4);
    } catch { return []; }
  }
  function writeIds(ids) {
    const clean = [...new Set(ids.filter(id => typeof id === "string" && UUID.test(id)))].slice(0, 4);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent("gambasket:compare:change", { detail: { ids: clean } }));
    renderDock();
    updateCardButtons();
    return clean;
  }
  function notify(message) {
    const notifications = window.GamBasketNotifications;
    if (notifications?.add) notifications.add({type:"system",title:"Compare products",message,showToast:true});
    else window.alert(message);
  }
  function toggle(productId) {
    if (!UUID.test(String(productId || ""))) {
      return {ok:false, message:"Only current marketplace listings can be compared."};
    }
    const ids = readIds();
    const exists = ids.includes(productId);
    if (exists) {
      writeIds(ids.filter(id => id !== productId));
      return {ok:true, selected:false, ids:readIds()};
    }
    if (ids.length >= 4) {
      return {ok:false, message:"You can compare up to 4 products at a time. Remove one first."};
    }
    writeIds([...ids, productId]);
    notify("Product added to your comparison list.");
    return {ok:true, selected:true, ids:readIds()};
  }
  function clear() { writeIds([]); }

  function ensureDock() {
    if (document.getElementById("gambasketCompareDock") || /compare\.html$/i.test(location.pathname)) return;
    const dock = document.createElement("aside");
    dock.id = "gambasketCompareDock";
    dock.className = "gambasket-compare-dock";
    dock.hidden = true;
    dock.innerHTML = '<div><strong id="gambasketCompareCount">Compare products</strong><small id="gambasketCompareHelp">Choose up to four products</small></div><div class="gambasket-compare-dock-actions"><button type="button" data-compare-clear>Clear</button><a href="compare.html">Compare now</a></div>';
    document.body.append(dock);
    dock.querySelector("[data-compare-clear]")?.addEventListener("click", clear);
  }
  function renderDock() {
    const dock = document.getElementById("gambasketCompareDock");
    if (!dock) return;
    const count = readIds().length;
    dock.hidden = count === 0;
    const label = document.getElementById("gambasketCompareCount");
    const help = document.getElementById("gambasketCompareHelp");
    if (label) label.textContent = `${count} product${count === 1 ? "" : "s"} selected`;
    if (help) help.textContent = count < 2 ? "Add at least one more to compare" : "Compare price, condition and specifications";
    const link = dock.querySelector("a");
    if (link) { link.style.opacity = count < 2 ? ".55" : "1"; link.setAttribute("aria-disabled", String(count < 2)); }
  }
  function updateCardButtons() {
    const selected = new Set(readIds());
    document.querySelectorAll("[data-compare-product-id]").forEach(button => {
      const id = button.dataset.compareProductId;
      const active = selected.has(id);
      button.setAttribute("aria-pressed", String(active));
      button.textContent = active ? "Added to compare" : "Compare";
    });
    const detail = document.getElementById("detailCompareBtn");
    if (detail) {
      const id = new URLSearchParams(location.search).get("id");
      const active = selected.has(id);
      detail.setAttribute("aria-pressed", String(active));
      detail.textContent = active ? "Added to compare" : "Compare";
    }
  }
  async function loadComparePage() {
    const tableMount = document.getElementById("compareContent");
    const empty = document.getElementById("compareEmpty");
    const status = document.getElementById("compareStatus");
    if (!tableMount) return;
    const ids = readIds();
    if (ids.length < 2) {
      if (empty) empty.hidden = false;
      tableMount.replaceChildren();
      if (status) status.textContent = ids.length ? "Select at least two products to compare." : "Your comparison list is empty.";
      return;
    }
    if (status) status.textContent = "Loading approved product details…";
    try {
      await window.GamBasketAuth?.ready?.();
      const client = window.GamBasketAuth?.getClient?.() || window.supabaseClient;
      if (!client) throw new Error("The marketplace service is unavailable. Reload and try again.");
      const { data, error } = await client.from("products")
        .select("id,title,price,currency,condition,category_id,location,main_image,attributes,stock,delivery_available,listing_type,wholesale_price,min_order_quantity,sales_count")
        .eq("status","approved").in("id",ids);
      if (error) throw error;
      const byId = new Map((data || []).map(row => [row.id,row]));
      const products = ids.map(id => byId.get(id)).filter(Boolean);
      if (products.length < 2) {
        if (empty) empty.hidden = false;
        if (status) status.textContent = "At least two of the selected products must still be publicly available.";
        tableMount.replaceChildren();
        return;
      }
      if (empty) empty.hidden = true;
      if (status) status.textContent = `Comparing ${products.length} approved listings.`;
      const wrap = document.createElement("div");
      wrap.className = "gambasket-compare-table-wrap";
      const table = document.createElement("table");
      table.className = "gambasket-compare-table";
      const thead = document.createElement("thead");
      const head = document.createElement("tr");
      const first = document.createElement("th");
      first.scope = "col"; first.textContent = "Compare"; head.append(first);
      for (const p of products) {
        const th = document.createElement("th"); th.scope = "col";
        const box = document.createElement("div"); box.className = "gambasket-compare-product";
        const img = document.createElement("img"); img.src = p.main_image || ""; img.alt = p.title || "Product"; img.loading = "lazy";
        const name = document.createElement("strong"); name.textContent = p.title || "Product";
        const a = document.createElement("a"); a.href = `product.html?id=${encodeURIComponent(p.id)}`; a.textContent = "View listing";
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove";
        remove.addEventListener("click", () => { writeIds(readIds().filter(id => id !== p.id)); loadComparePage(); });
        box.append(img,name,a,remove); th.append(box); head.append(th);
      }
      thead.append(head); table.append(thead);
      const attrKeys = [...new Set(products.flatMap(p => Object.keys(p.attributes || {})))].filter(key => /^[a-z][a-z0-9_]{0,39}$/.test(key)).slice(0,16);
      const rows = [
        ["Price", p => `D ${Number(p.price || 0).toLocaleString("en-GM",{maximumFractionDigits:2})}`],
        ["Condition", p => p.condition || "Not specified"],
        ["Category", p => p.category_id || "Not specified"],
        ["Location", p => p.location || "Not specified"],
        ["In stock", p => Number(p.stock || 0) > 0 ? `Yes · ${Number(p.stock)} available` : "Currently unavailable"],
        ["Delivery available", p => p.delivery_available === true ? "Yes (fee confirmed at checkout)" : "Not listed as available"],
        ["Listing type", p => p.listing_type || "Retail"],
        ["Wholesale price", p => p.wholesale_price == null ? "Not offered" : `D ${Number(p.wholesale_price).toLocaleString("en-GM",{maximumFractionDigits:2})}`],
        ...attrKeys.map(key => [key.replaceAll("_"," ").replace(/\b\w/g,ch=>ch.toUpperCase()), p => {
          const value=(p.attributes || {})[key];
          return value === undefined || value === null || value === "" ? "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
        }])
      ];
      const tbody = document.createElement("tbody");
      for (const [label, valueFor] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th"); th.scope="row"; th.textContent=label; tr.append(th);
        products.forEach(p => { const td=document.createElement("td"); td.textContent=String(valueFor(p)).slice(0,240); tr.append(td); });
        tbody.append(tr);
      }
      table.append(tbody); wrap.append(table);
      tableMount.replaceChildren(wrap);
    } catch (error) {
      console.error("[GamBasket compare]",error);
      if (status) status.textContent = error?.message || "Could not load product comparisons.";
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-compare-product-id]");
    if (button) {
      event.preventDefault(); event.stopPropagation();
      const result = toggle(button.dataset.compareProductId);
      if (result.ok) updateCardButtons();
      else if (result.message && result.message !== "Only current marketplace listings can be compared.") notify(result.message);
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    ensureDock(); renderDock(); updateCardButtons();
    if (document.getElementById("compareContent")) loadComparePage();
  });
  window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) { renderDock(); updateCardButtons(); if (document.getElementById("compareContent")) loadComparePage(); } });
  window.addEventListener("gambasket:compare:change", () => {
    renderDock();
    updateCardButtons();
    if (document.getElementById("compareContent")) loadComparePage();
  });
  window.GamBasketCompare = {toggle, clear, getSelected:readIds, loadComparePage};
})();
