/* GamBasket seller wallet UI. Money is read from trusted RPCs; the browser never edits balances. */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const money = value => "D " + Number(value || 0).toLocaleString("en-GM", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
  const masked = value => {
    const digits = String(value || "");
    return "•••• " + digits.slice(-3);
  };
  const state = { methods: [], requests: [], summary: null, preferences: null };

  function message(text, isError = false) {
    const node = $("walletMessage");
    if (!node) return;
    node.textContent = text;
    node.dataset.state = isError ? "error" : "success";
    node.hidden = !text;
  }

  function setValue(id, value) {
    const node = $(id);
    if (node) node.textContent = money(value);
  }

  function renderMethods() {
    const active = state.methods.filter(method => method.verification_status === "active");
    const methodMarkup = state.methods.length
      ? state.methods.map(method => `
        <div class="seller-wallet-method">
          <div><strong>${escapeHtml(method.network.toUpperCase())}</strong><span>${escapeHtml(method.beneficiary_name)} · ${escapeHtml(masked(method.account_number))}</span></div>
          <span class="seller-status ${method.verification_status === "active" ? "success" : "warning"}">${escapeHtml(method.verification_status.replaceAll("_", " "))}</span>
        </div>`).join("")
      : '<p class="seller-wallet-empty">No payout destination has been added yet.</p>';
    if ($("payoutMethods")) $("payoutMethods").innerHTML = methodMarkup;

    const options = active.map(method => `
      <option value="${escapeHtml(method.id)}">${escapeHtml(method.network.toUpperCase())} · ${escapeHtml(masked(method.account_number))}</option>
    `).join("");
    ["withdrawMethod", "autoPayoutMethod"].forEach(id => {
      const select = $(id);
      if (!select) return;
      const previous = select.value;
      select.innerHTML = '<option value="">Choose an approved destination</option>' + options;
      if (active.some(method => method.id === previous)) select.value = previous;
    });
    const enabled = active.length > 0;
    if ($("withdrawSubmit")) $("withdrawSubmit").disabled = !enabled;
    if ($("saveAutoPayout")) $("saveAutoPayout").disabled = false;
    if ($("withdrawHint")) $("withdrawHint").textContent = enabled
      ? "Withdrawals are reserved from your available balance while the provider processes them."
      : "Payout destinations must be verified by GamBasket before withdrawals can be requested.";
  }

  function renderRequests() {
    const node = $("payoutHistory");
    if (!node) return;
    if (!state.requests.length) {
      node.innerHTML = '<tr><td colspan="4" class="seller-wallet-empty">No withdrawal requests yet.</td></tr>';
      return;
    }
    node.innerHTML = state.requests.map(item => `
      <tr>
        <td>${new Date(item.requested_at).toLocaleDateString()}</td>
        <td>${money(item.amount)}</td>
        <td>${escapeHtml(String(item.request_source || "manual").replaceAll("_", " "))}</td>
        <td><span class="seller-status ${item.status === "succeeded" ? "success" : "warning"}">${escapeHtml(item.status.replaceAll("_", " "))}</span></td>
      </tr>`).join("");
  }

  async function load() {
    const client = window.supabaseClient;
    if (!client) throw new Error("Wallet service is unavailable.");
    const [summaryResult, methodsResult, requestsResult, preferencesResult] = await Promise.all([
      client.rpc("seller_get_wallet_summary"),
      client.from("seller_payout_methods")
        .select("id,network,account_number,beneficiary_name,verification_status,is_primary,created_at")
        .order("created_at", { ascending: false }),
      client.from("seller_payout_requests")
        .select("id,amount,status,request_source,requested_at")
        .order("requested_at", { ascending: false }).limit(20),
      client.from("seller_wallet_preferences")
        .select("auto_payout_enabled,auto_payout_threshold,payout_method_id")
        .maybeSingle()
    ]);
    for (const result of [summaryResult, methodsResult, requestsResult, preferencesResult]) {
      if (result.error) throw result.error;
    }

    const summary = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
    state.summary = summary || {};
    state.methods = methodsResult.data || [];
    state.requests = requestsResult.data || [];
    state.preferences = preferencesResult.data || {};

    setValue("walletPending", state.summary.pending_balance);
    setValue("walletAvailable", state.summary.available_balance);
    setValue("walletInTransit", state.summary.payout_in_transit);
    setValue("walletWithdrawn", state.summary.withdrawn_total);
    renderMethods();
    renderRequests();

    if ($("autoPayoutEnabled")) $("autoPayoutEnabled").checked = Boolean(state.preferences.auto_payout_enabled);
    if ($("autoPayoutThreshold") && state.preferences.auto_payout_threshold) {
      $("autoPayoutThreshold").value = state.preferences.auto_payout_threshold;
    }
    if ($("autoPayoutMethod") && state.preferences.payout_method_id) {
      $("autoPayoutMethod").value = state.preferences.payout_method_id;
    }
  }

  async function addMethod(event) {
    event.preventDefault();
    const form = $("payoutMethodForm");
    const submit = form?.querySelector("button[type=submit]");
    if (!form || !window.supabaseClient) return;
    submit.disabled = true;
    try {
      const values = new FormData(form);
      const { data, error } = await window.supabaseClient.rpc("seller_add_payout_method", {
        p_network: values.get("network"),
        p_account_number: values.get("account_number"),
        p_beneficiary_name: values.get("beneficiary_name")
      });
      if (error) throw error;
      form.reset();
      message("Payout destination added. It will become usable after GamBasket verifies it.");
      await load();
    } catch (error) {
      console.error("[GamBasket wallet] add payout method failed", error);
      message(error.message || "Could not add the payout destination.", true);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function requestPayout(event) {
    event.preventDefault();
    const form = $("withdrawForm");
    const submit = $("withdrawSubmit");
    if (!form || !window.supabaseClient) return;
    submit.disabled = true;
    try {
      const amount = Number($("withdrawAmount").value);
      const methodId = $("withdrawMethod").value;
      if (!Number.isFinite(amount) || amount <= 0 || !methodId) {
        throw new Error("Enter an amount and choose an approved payout destination.");
      }
      if (!window.crypto?.randomUUID) throw new Error("Secure payout request generation is unavailable in this browser.");
      const { data, error } = await window.supabaseClient.rpc("seller_request_payout", {
        p_amount: amount,
        p_payout_method_id: methodId,
        p_idempotency_key: window.crypto.randomUUID()
      });
      if (error) throw error;
      form.reset();
      message(data?.idempotent_replay
        ? "This withdrawal request was already recorded."
        : "Withdrawal request recorded and funds reserved. The transfer is not complete until ModemPay confirms it.");
      await load();
    } catch (error) {
      console.error("[GamBasket wallet] payout request failed", error);
      message(error.message || "Could not submit the withdrawal request.", true);
    } finally {
      if (submit) submit.disabled = state.methods.every(method => method.verification_status !== "active");
    }
  }

  async function savePreferences(event) {
    event.preventDefault();
    const enabled = Boolean($("autoPayoutEnabled")?.checked);
    const threshold = Number($("autoPayoutThreshold")?.value || 0);
    const methodId = $("autoPayoutMethod")?.value || null;
    const submit = $("saveAutoPayout");
    if (submit) submit.disabled = true;
    try {
      const { error } = await window.supabaseClient.rpc("seller_update_wallet_preferences", {
        p_auto_payout_enabled: enabled,
        p_auto_payout_threshold: threshold,
        p_payout_method_id: methodId
      });
      if (error) throw error;
      message("Automatic payout preferences saved. Scheduled transfers will activate after the payout worker is deployed.");
      await load();
    } catch (error) {
      console.error("[GamBasket wallet] preference update failed", error);
      message(error.message || "Could not save automatic payout preferences.", true);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function init() {
    $("payoutMethodForm")?.addEventListener("submit", addMethod);
    $("withdrawForm")?.addEventListener("submit", requestPayout);
    $("autoPayoutForm")?.addEventListener("submit", savePreferences);
    try {
      await load();
    } catch (error) {
      console.error("[GamBasket wallet] wallet could not load", error);
      message("Wallet setup is not available in this preview yet. Apply the financial foundation migrations before using wallet actions.", true);
    }
  }

  window.GamBasketSellerWallet = { init, load };
})();
