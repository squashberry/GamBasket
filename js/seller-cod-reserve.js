/* JulaDirect seller COD commission reserve controls. All money movement is server-side. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const money = value => "D " + Number(value || 0).toLocaleString("en-GM", {minimumFractionDigits:2, maximumFractionDigits:2});
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  let client = null;
  let loading = false;

  function show(text, error = false) {
    const node = $("codReserveMessage");
    if (!node) return;
    node.textContent = text;
    node.dataset.state = error ? "error" : "success";
    node.hidden = !text;
  }

  function render(summary) {
    $("codReserveAvailable").textContent = money(summary.reserve_available);
    $("codReserveCommitted").textContent = money(summary.reserve_committed);
    $("codReserveRate").textContent = Number(summary.commission_rate || 5).toLocaleString("en-GM") + "%";
    $("codCheckoutEnabled").checked = Boolean(summary.cod_enabled);
    const badge = $("codReserveStatus");
    badge.textContent = summary.cod_enabled ? "COD enabled" : "COD disabled";
    badge.className = "seller-status " + (summary.cod_enabled ? "success" : "warning");
  }

  async function loadDeposits() {
    const body = $("codReserveDepositHistory");
    const { data, error } = await client.from("seller_cod_reserve_deposit_requests")
      .select("id,amount,network,provider_reference,status,created_at,review_note")
      .order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    if (!data?.length) {
      body.innerHTML = '<tr><td colspan="5" class="seller-wallet-empty">No external reserve deposits yet.</td></tr>';
      return;
    }
    body.innerHTML = data.map(row =>
      '<tr><td>' + new Date(row.created_at).toLocaleDateString() + '</td>' +
      '<td>' + esc(row.network.toUpperCase()) + '</td><td>' + money(row.amount) + '</td>' +
      '<td>' + esc(row.provider_reference) + '</td>' +
      '<td><span class="seller-status ' + (row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "warning") + '">' +
      esc(row.status.replaceAll("_"," ")) + '</span>' + (row.review_note ? '<small>' + esc(row.review_note) + '</small>' : '') + '</td></tr>'
    ).join("");
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      const { data, error } = await client.rpc("seller_get_cod_reserve_summary");
      if (error) throw error;
      render(Array.isArray(data) ? data[0] : data);
      await loadDeposits();
    } finally {
      loading = false;
    }
  }

  async function toggleCod() {
    const enabled = $("codCheckoutEnabled").checked;
    $("codCheckoutEnabled").disabled = true;
    try {
      const { data, error } = await client.rpc("seller_set_cod_checkout_enabled", { p_enabled: enabled });
      if (error) throw error;
      show(enabled ? "Cash on Delivery is enabled. Customers can choose it when your reserve covers their 5% fee." : "Cash on Delivery has been turned off. Existing order holds remain in place.");
      await load();
    } catch (error) {
      $("codCheckoutEnabled").checked = !enabled;
      show(error.message || "Could not update Cash on Delivery settings.", true);
    } finally {
      $("codCheckoutEnabled").disabled = false;
    }
  }

  async function fundReserve(event) {
    event.preventDefault();
    const form = $("codReserveFundForm");
    const amount = Number($("codReserveFundAmount").value);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (!Number.isFinite(amount) || amount <= 0 || !window.crypto?.randomUUID) throw new Error("Enter a valid amount.");
      const { data, error } = await client.rpc("seller_fund_cod_commission_reserve", {
        p_amount: amount,
        p_idempotency_key: window.crypto.randomUUID()
      });
      if (error) throw error;
      form.reset();
      show(data?.idempotent_replay ? "This reserve funding transfer was already recorded." : money(amount) + " moved from your available wallet into your COD reserve.");
      await load();
    } catch (error) {
      show(error.message || "Could not fund the COD reserve.", true);
    } finally {
      submit.disabled = false;
    }
  }

  async function submitDeposit(event) {
    event.preventDefault();
    const form = $("codReserveDepositForm");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const { data, error } = await client.rpc("seller_request_cod_reserve_deposit", {
        p_network: $("codReserveNetwork").value,
        p_amount: Number($("codReserveDepositAmount").value),
        p_payer_phone: $("codReservePayerPhone").value.trim(),
        p_provider_reference: $("codReserveReference").value.trim()
      });
      if (error) throw error;
      form.reset();
      show(data?.message || "Deposit submitted for administrator verification. It will not count toward COD eligibility until approved.");
      await load();
    } catch (error) {
      show(error.message || "Could not submit the deposit details.", true);
    } finally {
      submit.disabled = false;
    }
  }

  async function init() {
    const root = $("codReserveStatus");
    if (!root) return;
    try {
      await window.GamBasketAuth?.ready?.();
      client = window.supabaseClient || window.GamBasketAuth?.getClient?.();
      if (!client) throw new Error("Wallet service is unavailable.");
      $("codCheckoutEnabled").addEventListener("change", toggleCod);
      $("codReserveFundForm").addEventListener("submit", fundReserve);
      $("codReserveDepositForm").addEventListener("submit", submitDeposit);
      await load();
    } catch (error) {
      show(error.message || "COD reserve details could not be loaded.", true);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once:true});
  else init();
})();
