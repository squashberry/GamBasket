(() => {
    "use strict";
    const state = { user: null, conversations: [], active: null, messages: [], channel: null, search: "" };
    const $ = id => document.getElementById(id);
    const qs = key => new URLSearchParams(location.search).get(key);
    const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    const money = value => `D ${Number(value || 0).toLocaleString("en-GM")}`;
    const time = value => value ? new Date(value).toLocaleTimeString("en-GM", { hour: "numeric", minute: "2-digit" }) : "";
    const dateKey = value => new Date(value).toDateString();

    async function init() {
        if (!$('messagesShell')) return;
        await window.GamBasketAuth.ready();
        const session = await window.GamBasketAuth.getSession();
        if (!session?.user) { location.href = `login.html?redirect=${encodeURIComponent(location.href)}`; return; }
        state.user = session.user;
        bindUI();
        await loadConversations();
        const conversationId = qs("conversation");
        const productId = qs("product");
        if (conversationId) await openConversation(conversationId);
        else if (productId && window.GamBasketAuth.startConversation) await startConversation(productId);
    }

    async function loadConversations() {
        try {
            const result = await window.GamBasketAuth.getConversations();
            state.conversations = result.items || [];
            renderConversations();
        } catch (error) { console.error("[GamBasket Conversations]", error); $("conversationList").innerHTML = `<div class="conversation-empty"><div><h3>Messages couldn't load</h3><p>Check your connection and try again.</p><button id="retryConversations" class="context-btn primary" type="button">Try Again</button></div></div>`; $("retryConversations")?.addEventListener("click", loadConversations); }
    }

    function renderConversations() {
        const query = state.search.toLowerCase().trim();
        const items = state.conversations.filter(item => !query || `${item.other_user_name} ${item.product?.title || ""} ${item.last_message}`.toLowerCase().includes(query));
        $("unreadTotalBadge").textContent = state.conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0);
        $("conversationList").innerHTML = items.length ? items.map(item => `<button class="conversation-row ${state.active?.id === item.id ? "active" : ""} ${item.unread_count ? "unread" : ""}" data-conversation-id="${escapeHTML(item.id)}" type="button"><span class="person-avatar">${escapeHTML((item.other_user_name || "G").charAt(0).toUpperCase())}</span><span class="conversation-main"><strong class="conversation-name">${escapeHTML(item.other_user_name)}</strong>${item.product?.title ? `<span class="conversation-product">${escapeHTML(item.product.title)}</span>` : ""}<span class="conversation-preview">${escapeHTML(item.last_message)}</span></span><span class="conversation-meta"><time>${time(item.last_message_at)}</time>${item.unread_count ? `<b class="unread-count">${item.unread_count > 99 ? "99+" : item.unread_count}</b>` : ""}</span></button>`).join("") : `<div class="conversation-empty"><div><div class="empty-icon"><svg class="ui-icon"><use href="#icon-chat"></use></svg></div><h3>${query ? "No conversations found" : "No conversations yet"}</h3><p>${query ? "Try another search." : "Your messages will appear here."}</p></div></div>`;
    }

    async function startConversation(productId) {
        try { const result = await window.GamBasketAuth.startConversation(productId); const id = result?.conversation?.id || result?.id; if (id) { history.replaceState({}, "", `messages.html?conversation=${encodeURIComponent(id)}&product=${encodeURIComponent(productId)}`); await loadConversations(); await openConversation(id); } } catch (error) { console.error("[GamBasket Start Conversation]", error); showToast("Unable to start conversation", "Please try again."); }
    }

    async function openConversation(id) {
        cleanupChannel();
        try {
            const result = await window.GamBasketAuth.getConversation(id);
            state.active = result.conversation || result;
            state.messages = result.messages || [];
            renderActive();
            await window.GamBasketAuth.markConversationRead(id);
            const listed = state.conversations.find(item => item.id === id); if (listed) listed.unread_count = 0;
            renderConversations();
            $("messagesShell").classList.add("chat-open"); $("chatEmpty").hidden = true; $("chatActive").hidden = false; $("mobileChatBackBtn").hidden = false;
            subscribe(id); scrollBottom();
        } catch (error) { console.error("[GamBasket Open Conversation]", error); showToast("Couldn't open conversation", "Please try again."); }
    }

    function renderActive() {
        const item = state.active || {};
        $("chatName").textContent = item.other_user_name || "GamBasket Member";
        $("chatAvatar").textContent = (item.other_user_name || "G").charAt(0).toUpperCase();
        const product = item.product;
        const context = $("chatProductContext");
        if (product) {
            const available = product.status === "approved" && Number(product.stock || 0) > 0;
            context.hidden = false;
            context.innerHTML = `<div class="product-context-card"><img class="product-context-image" src="${escapeHTML(product.main_image || "")}" alt=""><div class="product-context-info"><strong>${escapeHTML(product.title)}</strong><span>${money(product.price)}</span><small class="${available ? "available" : "unavailable"}">${available ? `${product.stock} available` : "Currently unavailable"}</small></div><div class="product-context-actions"><a class="context-btn" href="product.html?id=${encodeURIComponent(product.id)}">View Product</a><button id="chatOrderNow" class="context-btn primary" type="button" ${available ? "" : "disabled"}>Order Now</button></div></div>`;
            $("chatOrderNow")?.addEventListener("click", async () => {
                if (!available) return;
                try {
                    const result = await window.GamBasketAuth.addToCart(product.id, 1);
                    if (result.success) location.href = "cart.html?continue=checkout";
                    else showToast("Unable to order", "This product is no longer available.");
                } catch (error) { console.error("[GamBasket Chat Order]", error); showToast("Unable to order", "Please try again."); }
            });
        } else { context.hidden = true; context.innerHTML = ""; }
        renderMessages();
    }

    function renderMessages() {
        const area = $("messagesArea");
        if (!state.messages.length) { area.innerHTML = `<div class="chat-start"><svg class="ui-icon"><use href="#icon-chat"></use></svg><strong>Start the conversation</strong><p>Ask about availability, delivery, pickup, or the product.</p></div>`; return; }
        let last = "";
        area.innerHTML = state.messages.map(message => { const key = dateKey(message.created_at); const separator = key !== last ? `<div class="date-separator"><span>${formatDate(message.created_at)}</span></div>` : ""; last = key; const outgoing = String(message.sender_id) === String(state.user.id); return `${separator}<div class="message-row ${outgoing ? "outgoing" : "incoming"}"><div class="message-bubble"><div>${escapeHTML(message.content || message.message_text).replace(/\n/g, "<br>")}</div><time class="message-time">${time(message.created_at)}${outgoing ? `<span>${message.is_read ? "✓✓" : "✓"}</span>` : ""}</time></div></div>`; }).join("");
    }

    async function sendMessage() {
        const input = $("messageInput"); const content = input.value.trim(); if (!content || !state.active) return;
        const button = $("sendMessageBtn"); button.disabled = true;
        try { await window.GamBasketAuth.sendMessage(state.active.id, content); input.value = ""; input.style.height = "auto"; await reloadMessages(); scrollBottom(); }
        catch (error) { console.error("[GamBasket Send Message]", error); showToast("Message not sent", "Please try again."); }
        finally { button.disabled = false; input.focus(); }
    }

    async function reloadMessages() { const result = await window.GamBasketAuth.getConversationMessages(state.active.id); state.messages = result.messages || []; renderMessages(); }
    function subscribe(id) { state.channel = window.GamBasketAuth.subscribeToConversation?.(id, async message => { if (String(message.sender_id) === String(state.user.id)) return; state.messages.push(message); renderMessages(); await window.GamBasketAuth.markConversationRead(id); scrollBottom(); }, () => $("realtimeError").classList.add("show")); $("realtimeError").classList.remove("show"); }
    function cleanupChannel() { if (state.channel?.unsubscribe) state.channel.unsubscribe(); state.channel = null; }
    function scrollBottom() { requestAnimationFrame(() => { const area = $("messagesArea"); if (area) area.scrollTop = area.scrollHeight; }); }
    function formatDate(value) { const date = new Date(value); const today = new Date(); if (date.toDateString() === today.toDateString()) return "Today"; today.setDate(today.getDate() - 1); if (date.toDateString() === today.toDateString()) return "Yesterday"; return date.toLocaleDateString("en-GM", { day: "numeric", month: "short", year: "numeric" }); }
    function showToast(title, message) { window.GamBasketNotifications?.add({ type: "message", title, message, showToast: true }); }

    function bindUI() {
        $("conversationSearch")?.addEventListener("input", event => { state.search = event.target.value; renderConversations(); });
        $("conversationList")?.addEventListener("click", event => { const row = event.target.closest("[data-conversation-id]"); if (row) openConversation(row.dataset.conversationId); });
        $("messageComposer")?.addEventListener("submit", event => { event.preventDefault(); sendMessage(); });
        $("messageInput")?.addEventListener("input", event => { event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`; });
        $("messageInput")?.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
        ["mobileChatBack", "mobileChatBackBtn"].forEach(id => $(id)?.addEventListener("click", () => { cleanupChannel(); $("messagesShell").classList.remove("chat-open"); $("chatEmpty").hidden = false; $("chatActive").hidden = true; $("mobileChatBackBtn").hidden = true; history.replaceState({}, "", "messages.html"); }));
        $("reconnectBtn")?.addEventListener("click", () => state.active && subscribe(state.active.id));
        document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => { const page = item.dataset.page; if (page) location.href = `${page}.html`; }));
    }
    window.addEventListener("beforeunload", cleanupChannel);
    init();
})();
