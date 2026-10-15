/* GamBasket courier workspace — live delivery_requests UI */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { client: null, user: null, profile: null, deliveryProfile: null, available: [], active: null, completed: [], location: null, map: null, mapLayers: [] };
  const titles = { overview: "Overview", jobs: "Delivery requests", active: "Active delivery", map: "Live route", earnings: "Earnings", history: "Delivery history" };
  const baseLocation = [13.4549, -16.5790];

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
  const money = (value) => `D ${new Intl.NumberFormat("en-GM", { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
  const date = (value, withTime = false) => value ? new Intl.DateTimeFormat("en-GM", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}) }).format(new Date(value)) : "—";
  const statusName = (status) => ({ assigned: "Assigned", picked_up: "Picked up", out_for_delivery: "Out for delivery", delivered: "Delivered" }[status] || "No active run");
  const isToday = (value) => value && new Date(value).toDateString() === new Date().toDateString();

  function toast(message) { const node = $("#deliveryToast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 3600); }
  function notify(title, message) { if (window.GamBasketNotifications?.add) window.GamBasketNotifications.add({ type: "delivery", title, message }); }
  function clientError(error, fallback) { console.error("[Courier workspace]", error); toast(error?.message || fallback); }
  function orderNumber(job) { return job.order?.order_number || `Delivery ${String(job.id || "").slice(0, 8)}`; }
  function jobReward(job) { return job.estimated_fee || 0; }
  function customerPhone(job) { return job.order?.delivery_phone || ""; }
  function deliveryAddress(job) { return job.delivery_destination || job.order?.delivery_address || job.delivery_area || "Delivery address"; }
  function pickupAddress(job) { return job.pickup_location || job.order?.pickup_location || "Pickup location"; }
  function initials(name) { return (name || "Courier").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase(); }

  async function getClient() {
    await window.GamBasketAuth?.ready?.();
    return window.GamBasketAuth?.getClient?.() || null;
  }

  function setAvailabilityUI(isAvailable) {
    $("#availabilityToggle").setAttribute("aria-pressed", String(isAvailable));
    $("#availabilityTitle").textContent = isAvailable ? "Online" : "Offline";
    $("#availabilityText").textContent = isAvailable ? "Ready to receive requests" : "You won't receive requests";
    $("#deliveryOnlineDot").classList.toggle("online", isAvailable);
    $("#heroAvailability").textContent = isAvailable ? "Go offline" : "Go online";
    $("#jobsSubtitle").textContent = isAvailable ? "Available requests are ready for you to claim." : "Go online to claim available requests.";
  }

  async function updateAvailability() {
    if (!state.deliveryProfile) return toast("Your courier profile is not available yet.");
    const isAvailable = state.deliveryProfile.status !== "available";
    const { error } = await state.client.from("delivery_profiles").update({ status: isAvailable ? "available" : "offline", updated_at: new Date().toISOString() }).eq("user_id", state.user.id);
    if (error) return clientError(error, "Could not update availability.");
    state.deliveryProfile.status = isAvailable ? "available" : "offline";
    setAvailabilityUI(isAvailable);
    toast(isAvailable ? "You are online and ready for delivery requests." : "You are offline. New requests are paused.");
  }

  async function loadData() {
    const select = "id,order_id,pickup_location,delivery_destination,delivery_area,estimated_fee,status,assigned_worker_id,assigned_at,picked_up_at,out_for_delivery_at,delivered_at,created_at,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,order:orders(order_number,delivery_address,delivery_area,delivery_region,delivery_phone)";
    const [profileResult, pendingResult, activeResult, completedResult] = await Promise.all([
      state.client.from("delivery_profiles").select("user_id,status,is_verified,total_completed_deliveries").eq("user_id", state.user.id).maybeSingle(),
      state.client.from("delivery_requests").select(select).eq("status", "pending").order("created_at", { ascending: false }),
      state.client.from("delivery_requests").select(select).eq("assigned_worker_id", state.user.id).in("status", ["assigned", "picked_up", "out_for_delivery"]).order("assigned_at", { ascending: false }).limit(1),
      state.client.from("delivery_requests").select(select).eq("assigned_worker_id", state.user.id).eq("status", "delivered").order("delivered_at", { ascending: false }).limit(50)
    ]);
    if (profileResult.error) console.warn("Courier profile load:", profileResult.error.message);
    if (pendingResult.error || activeResult.error || completedResult.error) throw pendingResult.error || activeResult.error || completedResult.error;
    state.deliveryProfile = profileResult.data;
    state.available = pendingResult.data || [];
    state.active = activeResult.data?.[0] || null;
    state.completed = completedResult.data || [];
    setAvailabilityUI(state.deliveryProfile?.status === "available");
    render();
  }

  async function claimJob(id) {
    if (state.deliveryProfile?.status !== "available") return toast("Go online before claiming a delivery request.");
    const button = document.querySelector(`[data-claim-id="${CSS.escape(id)}"]`);
    if (button) { button.disabled = true; button.textContent = "Claiming…"; }
    const { data, error } = await state.client.rpc("claim_delivery_job", { p_request_id: id, p_worker_id: state.user.id });
    if (error || !data?.success) { if (button) { button.disabled = false; button.textContent = "Claim run"; } return clientError(error || new Error(data?.error), "This request could not be claimed."); }
    notify("Delivery job claimed", `You claimed ${orderNumber(state.available.find(job => job.id === id))}.`);
    toast("Delivery claimed. Head to the pickup location.");
    await loadData();
    setTab("active");
  }

  async function updateStatus(nextStatus) {
    if (!state.active) return;
    const button = $("#advanceDeliveryBtn"); if (button) { button.disabled = true; button.textContent = "Updating…"; }
    const { data, error } = await state.client.rpc("update_delivery_job_status", { p_request_id: state.active.id, p_status: nextStatus });
    if (error || !data?.success) { if (button) { button.disabled = false; button.textContent = nextStatus === "delivered" ? "Confirm delivery" : nextStatus === "picked_up" ? "Confirm pickup" : "Start delivery"; } return clientError(error || new Error(data?.error), "Delivery status could not be updated."); }
    notify("Delivery updated", `${orderNumber(state.active)} is now ${statusName(nextStatus).toLowerCase()}.`);
    toast(nextStatus === "delivered" ? `Delivery complete. ${money(jobReward(state.active))} has been added to your ledger.` : "Delivery status updated.");
    await loadData();
    if (nextStatus === "delivered") setTab("earnings");
  }

  function jobRoute(job) { return `<div class="request-route"><i></i><div><span>Pickup</span><strong>${escapeHtml(pickupAddress(job))}</strong></div></div><div class="request-route"><i></i><div><span>Drop-off</span><strong>${escapeHtml(deliveryAddress(job))}</strong></div></div>`; }
  function requestCard(job) { return `<article class="request-card"><div class="request-card-head"><div><span class="pill">${escapeHtml(job.delivery_area || job.order?.delivery_area || "Delivery")}</span><h3>${escapeHtml(orderNumber(job))}</h3></div><strong>${money(jobReward(job))}</strong></div>${jobRoute(job)}<div class="request-card-foot"><span>${date(job.created_at, true)}</span><button class="primary-button" data-claim-id="${escapeHtml(job.id)}">Claim run</button></div></article>`; }
  function compactJob(job) { return `<div class="compact-job"><div><strong>${escapeHtml(orderNumber(job))}</strong><span>${escapeHtml(job.delivery_area || job.order?.delivery_area || "Delivery area")} · ${money(jobReward(job))}</span></div><button class="text-button" data-tab-jump="jobs">View</button></div>`; }

  function activeHTML(job) {
    if (!job) return `<div class="empty-state"><strong>No active delivery</strong><span>Claim a request when you are ready to start a run.</span><button class="primary-button" data-tab-jump="jobs">View requests</button></div>`;
    const stage = ["assigned", "picked_up", "out_for_delivery", "delivered"].indexOf(job.status);
    const next = ({ assigned: "picked_up", picked_up: "out_for_delivery", out_for_delivery: "delivered" })[job.status];
    const nextLabel = ({ picked_up: "Confirm pickup", out_for_delivery: "Start delivery", delivered: "Confirm delivery" })[next];
    const phone = customerPhone(job);
    return `<div class="active-layout"><section class="job-card"><span class="status-chip">${escapeHtml(statusName(job.status))}</span><h3>${escapeHtml(orderNumber(job))}</h3>${jobRoute(job)}<div class="timeline"><div class="timeline-row done"><i></i><div><strong>Delivery claimed</strong><span>${date(job.assigned_at, true)}</span></div></div><div class="timeline-row ${stage >= 1 ? "done" : ""}"><i></i><div><strong>Pickup confirmed</strong><span>${stage >= 1 ? date(job.picked_up_at, true) : "Confirm once items are collected"}</span></div></div><div class="timeline-row ${stage >= 2 ? "done" : ""}"><i></i><div><strong>Out for delivery</strong><span>${stage >= 2 ? date(job.out_for_delivery_at, true) : "Start when you leave the pickup"}</span></div></div><div class="timeline-row ${stage >= 3 ? "done" : ""}"><i></i><div><strong>Delivered</strong><span>${stage >= 3 ? date(job.delivered_at, true) : "Confirm after handoff"}</span></div></div></div><div class="job-actions"><button class="primary-button" id="advanceDeliveryBtn" ${next ? "" : "disabled"}>${nextLabel || "Delivery complete"}</button><button class="outline-button" data-tab-jump="map">Open route</button></div></section><aside class="contact-card"><small>CUSTOMER DETAILS</small><h3>${escapeHtml(job.order?.delivery_area || job.delivery_area || "Delivery customer")}</h3><p>${escapeHtml(deliveryAddress(job))}</p>${phone ? `<a href="tel:${escapeHtml(phone)}">Call ${escapeHtml(phone)}</a>` : "<p>Phone number not shared with this request.</p>"}<a href="../messages.html">Open customer messages</a></aside></div>`;
  }

  function renderMetrics() {
    const today = state.completed.filter(job => isToday(job.delivered_at));
    $("#metricTodayJobs").textContent = today.length;
    $("#metricTodayEarnings").textContent = money(today.reduce((sum, job) => sum + Number(jobReward(job)), 0));
    $("#metricAvailableJobs").textContent = state.available.length;
    $("#metricActiveStatus").textContent = state.active ? statusName(state.active.status) : "—";
    $("#metricActiveLabel").textContent = state.active ? orderNumber(state.active) : "No delivery in progress";
    const count = $("#jobsNavCount"); count.textContent = state.available.length; count.hidden = !state.available.length;
  }
  function render() {
    renderMetrics();
    $("#overviewActiveJob").outerHTML = `<div id="overviewActiveJob">${state.active ? `<div class="compact-job"><div><strong>${escapeHtml(orderNumber(state.active))}</strong><span>${escapeHtml(statusName(state.active.status))} · ${money(jobReward(state.active))}</span></div><button class="text-button" data-tab-jump="active">Continue</button></div>${jobRoute(state.active)}` : `<div class="empty-state"><strong>No active delivery</strong><span>When you claim a job, its route and milestones appear here.</span></div>`}</div>`;
    $("#overviewJobs").innerHTML = state.available.length ? state.available.slice(0, 3).map(compactJob).join("") : `<div class="empty-state"><strong>No requests right now</strong><span>Stay online and we’ll surface new available deliveries here.</span></div>`;
    $("#jobsFeed").innerHTML = state.available.length ? state.available.map(requestCard).join("") : `<div class="empty-state"><strong>No available delivery requests</strong><span>${state.deliveryProfile?.status === "available" ? "Check back shortly for new runs." : "Go online and check again when you are ready."}</span></div>`;
    $("#activeDeliveryContent").innerHTML = activeHTML(state.active);
    const total = state.completed.reduce((sum, job) => sum + Number(jobReward(job)), 0);
    $("#earningsBalance").textContent = money(total); $("#earningsDeliveries").textContent = state.completed.length; $("#earningsAverage").textContent = money(state.completed.length ? total / state.completed.length : 0);
    const ledger = state.completed.length ? state.completed.map(job => `<div class="ledger-item"><div><strong>${escapeHtml(orderNumber(job))}</strong><span>Delivered ${date(job.delivered_at, true)}</span></div><strong class="amount">+ ${money(jobReward(job))}</strong></div>`).join("") : `<div class="empty-state"><strong>No completed deliveries yet</strong><span>Complete a delivery to create your first ledger entry.</span></div>`;
    $("#earningsLedger").innerHTML = ledger; $("#historyFeed").innerHTML = state.completed.length ? state.completed.map(job => `<div class="history-item"><div><strong>${escapeHtml(orderNumber(job))}</strong><span>${escapeHtml(deliveryAddress(job))} · ${date(job.delivered_at)}</span></div><strong class="amount">${money(jobReward(job))}</strong></div>`).join("") : `<div class="empty-state"><strong>No delivery history</strong><span>Completed runs will be listed here.</span></div>`;
    bindDynamicActions(); renderMap();
  }

  function bindDynamicActions() {
    $$('[data-claim-id]').forEach(button => button.addEventListener("click", () => claimJob(button.dataset.claimId)));
    $("#advanceDeliveryBtn")?.addEventListener("click", () => updateStatus(({ assigned: "picked_up", picked_up: "out_for_delivery", out_for_delivery: "delivered" })[state.active?.status]));
    $$('[data-tab-jump]').forEach(button => button.addEventListener("click", () => setTab(button.dataset.tabJump)));
  }

  function mapPoint(job, prefix, fallback) { const lat = Number(job?.[`${prefix}_lat`]); const lng = Number(job?.[`${prefix}_lng`]); return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : fallback; }
  function renderMap() {
    const host = $("#deliveryMap"); if (!host || !window.L) return;
    if (!state.map) { host.innerHTML = ""; state.map = L.map(host, { zoomControl: true }).setView(baseLocation, 12); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(state.map); }
    state.mapLayers.forEach(layer => state.map.removeLayer(layer)); state.mapLayers = [];
    if (!state.active) { $("#routeDetails").innerHTML = "<small>ROUTE STATUS</small><strong>No active route</strong><p>Accept a delivery request to plan the pickup and drop-off.</p>"; state.map.setView(baseLocation, 12); return; }
    const pickup = mapPoint(state.active, "pickup", baseLocation); const dropoff = mapPoint(state.active, "dropoff", null); const layers = [];
    layers.push(L.marker(pickup).bindPopup("Pickup: " + escapeHtml(pickupAddress(state.active))).addTo(state.map));
    if (state.location) layers.push(L.circleMarker([state.location.latitude, state.location.longitude], { radius: 8, color: "#2563eb", fillColor: "#60a5fa", fillOpacity: 1 }).bindPopup("Your location").addTo(state.map));
    if (dropoff) { layers.push(L.marker(dropoff).bindPopup("Customer destination").addTo(state.map)); layers.push(L.polyline([pickup, dropoff], { color: "#0284c7", weight: 4, dashArray: "8 7" }).addTo(state.map)); state.map.fitBounds(L.latLngBounds([pickup, dropoff]), { padding: [38, 38] }); } else { layers.push(L.circle(pickup, { radius: 900, color: "#0284c7", fillColor: "#38bdf8", fillOpacity: .12 }).bindPopup("Approximate customer area").addTo(state.map)); state.map.setView(pickup, 13); }
    state.mapLayers = layers; const destination = dropoff || pickup; const query = encodeURIComponent(`${destination[0]},${destination[1]}`); $("#routeDetails").innerHTML = `<small>ROUTE STATUS</small><strong>${escapeHtml(statusName(state.active.status))}</strong><p>${dropoff ? "Exact destination shared by the customer." : "Customer location is approximate; call to confirm the final handoff point."}</p><a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${query}">Open in Google Maps</a>`; setTimeout(() => state.map.invalidateSize(), 0);
  }

  function requestLocation() {
    if (!navigator.geolocation) return toast("This browser does not support location services.");
    $("#locationStatus").textContent = "Finding location…";
    navigator.geolocation.getCurrentPosition(position => { state.location = position.coords; $("#locationStatus").textContent = "Location ready"; $("#locationStatusDot").classList.add("ready"); $("#requestLocationBtn").textContent = "Location ready"; renderMap(); }, error => { $("#locationStatus").textContent = "Location unavailable"; toast(error.code === 1 ? "Location permission was denied." : "Unable to retrieve your location."); }, { enableHighAccuracy: true, maximumAge: 300000, timeout: 12000 });
  }
  function setTab(tab) { $$("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== tab; panel.classList.toggle("active", panel.dataset.panel === tab); }); $$("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tab)); $("#deliveryPageTitle").textContent = titles[tab] || "Courier workspace"; $("#deliverySidebar").classList.remove("open"); $("#deliveryScrim").classList.remove("open"); if (tab === "map") setTimeout(renderMap, 50); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function bindStaticActions() {
    $$("[data-tab]").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));
    $("#availabilityToggle").addEventListener("click", updateAvailability); $("#heroAvailability").addEventListener("click", updateAvailability); $("#requestLocationBtn").addEventListener("click", requestLocation); $("#refreshJobsBtn").addEventListener("click", () => loadData().then(() => toast("Delivery requests refreshed.")).catch(error => clientError(error, "Could not refresh requests.")));
    $("#deliveryMobileMenu").addEventListener("click", () => { $("#deliverySidebar").classList.add("open"); $("#deliveryScrim").classList.add("open"); }); $("#deliveryScrim").addEventListener("click", () => { $("#deliverySidebar").classList.remove("open"); $("#deliveryScrim").classList.remove("open"); });
    $("#deliveryThemeToggle").addEventListener("click", () => { document.documentElement.classList.toggle("dark"); localStorage.setItem("gambasket-theme", document.documentElement.classList.contains("dark") ? "dark" : "light"); });
    $("#mobileNotifications").addEventListener("click", () => window.location.href = "../messages.html"); $("#requestPayoutBtn").addEventListener("click", () => toast("Payout requests are reviewed by the GamBasket admin team. Please contact support to request a transfer."));
  }
  async function init() {
    const allowed = await window.GamBasketGuard?.gatePage?.("delivery_worker"); if (!allowed) return;
    state.client = await getClient(); const context = window.GamBasketAuthContext || {}; state.user = context.user || await window.GamBasketAuth?.getUser?.(); state.profile = context.profile || {};
    if (!state.client || !state.user) { $("#deliveryAuthText").textContent = "Unable to connect to your account."; return; }
    const name = `${state.profile.first_name || ""} ${state.profile.last_name || ""}`.trim() || state.user.email?.split("@")[0] || "Courier"; $("#deliveryUserName").textContent = name; $("#deliveryUserEmail").textContent = state.user.email || "Courier account"; $("#deliveryAvatar").textContent = initials(name); const hour = new Date().getHours(); $("#overviewGreeting").textContent = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    $("#authGate").hidden = true; $("#deliveryApp").hidden = false; bindStaticActions();
    try { await loadData(); } catch (error) { clientError(error, "Unable to load delivery workspace."); $("#jobsFeed").innerHTML = `<div class="empty-state"><strong>Could not load delivery requests</strong><span>Please refresh and try again.</span></div>`; }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
