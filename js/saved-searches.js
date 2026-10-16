/* GamBasket saved searches and price-drop alerts. */
(() => {
  "use strict";
  const STORAGE_CRITERIA_KEYS = ["query","category","location","condition","minPrice","maxPrice","inStock","delivery","brandModel","sort"];
  const $ = id => document.getElementById(id);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
  let latestFilters = {
    category:"All",location:"all",conditions:[],minPrice:"",maxPrice:"",
    inStock:false,brandModel:"",sort:"newest"
  };
  let pendingName = "";

  function client() { return window.GamBasketAuth?.getClient?.() || window.supabaseClient || null; }
  async function getUser() {
    const auth = window.GamBasketAuth;
    if (auth) {
      await auth.ready?.();
      if (auth.getUser) return await auth.getUser();
    }
    const sb = client();
    if (!sb) return null;
    const {data,error} = await sb.auth.getUser();
    if (error) throw error;
    return data?.user || null;
  }
  function status(message, isError = false) {
    const node = $("savedSearchStatus") || $("saveSearchStatus");
    if (node) { node.textContent = message; node.classList.toggle("error",isError); }
    else if (message) window.alert(message);
  }
  function cleanCriteria() {
    const query = String($("exploreDesktopSearch")?.value || $("exploreSearch")?.value || "").trim().slice(0,120);
    const state = latestFilters || {};
    const categories = ["All","Phones","Fashion","Food","Electronics","Solar","Beauty","Home","Auto","Hardware","Baby","Sports"];
    const locations = ["all","Banjul","Serrekunda","Kanifing","Bakau","Fajara","Kotu","Kololi","Brufut","Brikama"];
    const conditions = ["New","Like New","Refurbished","Used - Good","Used - Fair"];
    const criteria = {query,category:categories.includes(state.category)?state.category:"All"};
    criteria.location = locations.includes(state.location)?state.location:"all";
    const condition = Array.isArray(state.conditions) ? state.conditions[0] : state.condition;
    if (conditions.includes(condition)) criteria.condition = condition;
    for (const key of ["minPrice","maxPrice"]) {
      const raw = state[key];
      if (raw !== "" && raw !== null && raw !== undefined && Number.isFinite(Number(raw)) && Number(raw)>=0) criteria[key] = Number(raw);
    }
    criteria.inStock = Boolean(state.inStock);
    if (state.delivery) criteria.delivery = true;
    const brandModel = String(state.brandModel || "").trim().slice(0,80);
    if (brandModel) criteria.brandModel = brandModel;
    const sorts = ["newest","price_asc","price_desc","popular"];
    criteria.sort = sorts.includes(state.sort) ? state.sort : "newest";
    return Object.fromEntries(Object.entries(criteria).filter(([key]) => STORAGE_CRITERIA_KEYS.includes(key)));
  }
  function buildSearchUrl(criteria) {
    const params = new URLSearchParams();
    if (criteria.query) params.set("q",criteria.query);
    if (criteria.category && criteria.category !== "All") params.set("category",criteria.category);
    if (criteria.location && criteria.location !== "all") params.set("location",criteria.location);
    if (criteria.minPrice !== undefined) params.set("min",String(criteria.minPrice));
    if (criteria.maxPrice !== undefined) params.set("max",String(criteria.maxPrice));
    if (criteria.condition) params.set("condition",criteria.condition);
    if (criteria.inStock) params.set("stock","1");
    if (criteria.delivery) params.set("delivery","1");
    if (criteria.sort && criteria.sort !== "newest") params.set("sort",criteria.sort);
    if (criteria.brandModel) params.set("brandModel",criteria.brandModel);
    return "explore.html" + (params.size ? "?" + params.toString() : "");
  }
  function readableCriteria(criteria) {
    const parts = [];
    if (criteria.query) parts.push(`“${criteria.query}”`);
    if (criteria.category && criteria.category !== "All") parts.push(criteria.category);
    if (criteria.location && criteria.location !== "all") parts.push(criteria.location);
    if (criteria.minPrice !== undefined) parts.push(`from D ${Number(criteria.minPrice).toLocaleString("en-GM")}`);
    if (criteria.maxPrice !== undefined) parts.push(`up to D ${Number(criteria.maxPrice).toLocaleString("en-GM")}`);
    if (criteria.condition) parts.push(criteria.condition);
    if (criteria.inStock) parts.push("in stock");
    if (criteria.delivery) parts.push("delivery available");
    if (criteria.brandModel) parts.push(criteria.brandModel);
    return parts.join(" · ") || "All products";
  }

  function ensureSaveModal() {
    if ($("saveSearchModal")) return;
    const modal = document.createElement("div");
    modal.id = "saveSearchModal";
    modal.className = "gambasket-save-search-modal";
    modal.hidden = true;
    modal.innerHTML = '<section class="gambasket-save-search-card" role="dialog" aria-modal="true" aria-labelledby="saveSearchTitle"><h2 id="saveSearchTitle">Save this search</h2><p>Get a GamBasket notification when a newly approved listing matches these filters.</p><label>Search name<input id="saveSearchName" type="text" maxlength="80" required placeholder="e.g. iPhone 13 under D 15,000"></label><label style="display:flex;align-items:center;gap:9px;grid-template-columns:auto 1fr;font-weight:600"><input id="saveSearchNotify" type="checkbox" checked> Notify me about new matching listings</label><p id="saveSearchStatus" role="status" aria-live="polite"></p><div class="gambasket-save-search-actions"><button type="button" data-save-cancel>Cancel</button><button type="button" data-save-confirm>Save search</button></div></section>';
    document.body.append(modal);
    modal.addEventListener("click",event=>{ if(event.target===modal || event.target.closest("[data-save-cancel]")) closeSaveModal(); });
    modal.querySelector("[data-save-confirm]")?.addEventListener("click",saveCurrentSearch);
    document.addEventListener("keydown",event=>{if(event.key==="Escape" && !modal.hidden) closeSaveModal();});
  }
  function openSaveModal() {
    ensureSaveModal();
    const modal=$("saveSearchModal");
    const name=$("saveSearchName");
    const criteria=cleanCriteria();
    if(name && !name.value.trim()) name.value=criteria.query || (criteria.category!=="All"?criteria.category:"") || "My GamBasket search";
    if($("saveSearchStatus")) $("saveSearchStatus").textContent="";
    modal.hidden=false;
    name?.focus();
  }
  function closeSaveModal(){if($("saveSearchModal")) $("saveSearchModal").hidden=true;}

  async function saveCurrentSearch() {
    const button=$("saveSearchModal")?.querySelector("[data-save-confirm]");
    const name=$("saveSearchName")?.value.trim();
    const criteria=cleanCriteria();
    if(!name){$("saveSearchName")?.focus();status("Give this search a name.",true);return;}
    if(name.length>80 || JSON.stringify(criteria).length>4000){status("Search details are too long. Narrow the filters.",true);return;}
    if(button)button.disabled=true;
    status("Saving search…");
    try {
      const user=await getUser();
      if(!user){
        const url=location.pathname+location.search;
        window.location.href="login.html?redirect="+encodeURIComponent(url);
        return;
      }
      const sb=client();
      if(!sb)throw new Error("Saved searches are unavailable right now.");
      const {error}=await sb.from("saved_searches").insert({
        user_id:user.id,name:name.slice(0,80),criteria,notify_on_new:Boolean($("saveSearchNotify")?.checked)
      });
      if(error)throw error;
      closeSaveModal();
      status("Search saved. You can manage it from Saved searches.");
      window.GamBasketNotifications?.add({type:"system",title:"Search saved",message:"GamBasket will alert you about matching listings when notifications are enabled.",showToast:true});
    } catch(error) {
      console.error("[GamBasket saved search]",error);
      status(error?.message||"Could not save this search.",true);
    } finally { if(button)button.disabled=false; }
  }

  function mountExploreControls() {
    if (!document.getElementById("productGrid") || $("saveSearchControls")) return;
    ensureSaveModal();
    const row=document.createElement("div");
    row.id="saveSearchControls";
    row.className="gambasket-save-search-controls";
    row.style.cssText="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px";
    row.innerHTML='<button class="gambasket-save-search" type="button" id="saveCurrentSearchBtn">♡ Save this search</button><a class="gambasket-save-search" href="saved-searches.html" style="text-decoration:none">Saved searches & price alerts</a>';
    const results=document.querySelector(".explore-results-toolbar");
    if(results?.parentNode)results.parentNode.insertBefore(row,results.nextSibling);
    $("saveCurrentSearchBtn")?.addEventListener("click",async()=>{
      try { const user=await getUser(); if(!user){window.location.href="login.html?redirect="+encodeURIComponent(location.pathname+location.search);return;}openSaveModal(); }
      catch(e){status(e?.message||"Unable to check your account.",true);}
    });
  }

  function listItem(search) {
    const article=document.createElement("article"); article.className="gambasket-saved-search-item";
    const copy=document.createElement("div");
    const title=document.createElement("strong");title.textContent=search.name;
    const details=document.createElement("small");details.textContent=readableCriteria(search.criteria||{});
    const notify=document.createElement("small");notify.textContent=search.notify_on_new?"New-listing alerts on":"New-listing alerts off";
    copy.append(title,details,notify);
    const actions=document.createElement("div");actions.className="gambasket-actions";
    const open=document.createElement("a");open.href=buildSearchUrl(search.criteria||{});open.textContent="Open search";
    const toggle=document.createElement("button");toggle.type="button";toggle.textContent=search.notify_on_new?"Pause alerts":"Enable alerts";
    toggle.addEventListener("click",()=>updateSearch(search.id,{notify_on_new:!search.notify_on_new}));
    const remove=document.createElement("button");remove.type="button";remove.textContent="Delete";
    remove.addEventListener("click",()=>deleteSearch(search.id,search.name));
    actions.append(open,toggle,remove);article.append(copy,actions);return article;
  }

  async function loadSavedSearches() {
    const list=$("savedSearchList");
    if(!list)return;
    list.replaceChildren();status("Loading your saved searches…");
    try{
      const user=await getUser();
      if(!user){window.location.href="login.html?redirect="+encodeURIComponent("saved-searches.html");return;}
      const sb=client();if(!sb)throw new Error("Saved searches are unavailable right now.");
      const [{data:searches,error:searchError},{data:alerts,error:alertError}]=await Promise.all([
        sb.from("saved_searches").select("id,name,criteria,notify_on_new,created_at,updated_at").eq("user_id",user.id).order("created_at",{ascending:false}),
        sb.from("wishlist_alerts").select("id,product_id,alert_type,old_value,new_value,created_at,is_read").eq("user_id",user.id).eq("alert_type","price_drop").order("created_at",{ascending:false}).limit(30)
      ]);
      if(searchError)throw searchError;if(alertError)throw alertError;
      if(!(searches||[]).length){const p=document.createElement("p");p.textContent="No saved searches yet. Save filters from Explore to get notified about new matching listings.";list.append(p);}
      else (searches||[]).forEach(row=>list.append(listItem(row)));
      status(`${(searches||[]).length} saved search(es).`);
      renderPriceAlerts(alerts||[]);
    }catch(error){console.error("[GamBasket saved searches]",error);status(error?.message||"Could not load saved searches.",true);}
  }
  async function renderPriceAlerts(alerts) {
    const mount=$("priceDropAlerts");if(!mount)return;mount.replaceChildren();
    if(!alerts.length){mount.textContent="No price-drop alerts yet. Save a product to your wishlist and we’ll show eligible price reductions here.";return;}
    const clientRef=client();
    const ids=[...new Set(alerts.map(row=>row.product_id).filter(id=>UUID.test(String(id||""))))];
    let products=[];
    if(ids.length&&clientRef){
      const {data,error}=await clientRef.from("products").select("id,title,main_image,status").in("id",ids);
      if(!error)products=data||[];
    }
    const map=new Map(products.map(p=>[p.id,p]));
    alerts.forEach(alert=>{
      const product=map.get(alert.product_id);if(!product||product.status!=="approved")return;
      const row=document.createElement("article");row.className="gambasket-price-alert";
      const img=document.createElement("img");img.src=product.main_image||"";img.alt=product.title||"Product";
      const body=document.createElement("div");
      const title=document.createElement("strong");title.textContent=product.title||"Saved product";
      const detail=document.createElement("p");detail.textContent=`Price reduced from D ${Number(alert.old_value||0).toLocaleString("en-GM")} to D ${Number(alert.new_value||0).toLocaleString("en-GM")}`;
      const time=document.createElement("p");time.textContent=new Date(alert.created_at).toLocaleString("en-GM");
      const open=document.createElement("a");open.href=`product.html?id=${encodeURIComponent(product.id)}`;open.textContent="View product";
      body.append(title,detail,time,open);row.append(img,body);mount.append(row);
    });
    if(!mount.childElementCount)mount.textContent="No current price-drop alerts.";
    try{const unread=alerts.filter(row=>!row.is_read).map(row=>row.id);if(unread.length)await clientRef.from("wishlist_alerts").update({is_read:true}).in("id",unread);}
    catch(error){console.warn("[GamBasket alerts] Read-state update failed:",error?.message);}
  }

  async function updateSearch(id,patch){
    const sb=client();if(!sb)return;
    try{
      const {error}=await sb.from("saved_searches").update({...patch,updated_at:new Date().toISOString()}).eq("id",id);
      if(error)throw error;
      await loadSavedSearches();
    }catch(error){status(error?.message||"Could not update search.",true);}
  }
  async function deleteSearch(id,name){
    if(!confirm(`Delete saved search “${name}”?`))return;
    try{
      const {error}=await client().from("saved_searches").delete().eq("id",id);
      if(error)throw error;
      await loadSavedSearches();
    }catch(error){status(error?.message||"Could not delete search.",true);}
  }

  window.addEventListener("gambasket:explore:filters",event=>{latestFilters=event.detail||latestFilters;});
  document.addEventListener("DOMContentLoaded",()=>{
    if(document.getElementById("productGrid"))mountExploreControls();
    if($("savedSearchList"))loadSavedSearches();
  });
  window.GamBasketSavedSearches={cleanCriteria,loadSavedSearches,buildSearchUrl};
})();
