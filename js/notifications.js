/* =========================================================
   GAMBASKET — NOTIFICATION SYSTEM
   (Dropdown on desktop, Bottom-sheet on mobile, Toast alerts,
   Per-browser persistence for client-generated UI notices)
========================================================= */

(function () {
    "use strict";

    /* -----------------------------------------------------
       ELEMENTS
    ----------------------------------------------------- */

    let notificationBtn = document.getElementById("notificationBtn");
    let notificationPanel = document.getElementById("notificationPanel");
    let notificationOverlay = document.getElementById("notificationOverlay");
    let notificationCloseBtn = document.getElementById("notificationCloseBtn");
    let notificationsList = document.getElementById("notificationsList");
    let notificationBadge = document.getElementById("notificationBadge");
    let notificationCountText = document.getElementById("notificationCountText");
    let markAllReadBtn = document.getElementById("markAllReadBtn");
    let notificationToast = document.getElementById("notificationToast");
    let toastTitle = document.getElementById("toastTitle");
    let toastMessage = document.getElementById("toastMessage");
    let toastClose = document.getElementById("toastClose");

    /* -----------------------------------------------------
       STORAGE KEY
    ----------------------------------------------------- */
    const STORAGE_KEY = "gambasket_notifications";

    /* -----------------------------------------------------
       LOAD REAL UI NOTICES — never seed fabricated activity
    ----------------------------------------------------- */
    const LEGACY_SAMPLE_IDS = new Set(["welcome-1", "wishlist-1", "explore-1"]);

    function loadNotifications() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) {
                localStorage.setItem(STORAGE_KEY, "[]");
                return [];
            }

            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) {
                localStorage.setItem(STORAGE_KEY, "[]");
                return [];
            }

            // Clear sample notifications created by older builds while keeping
            // genuine notices created by the user during the current browser session.
            const actualNotices = parsed.filter(notification =>
                notification &&
                typeof notification === "object" &&
                !LEGACY_SAMPLE_IDS.has(String(notification.id || "")) &&
                typeof notification.title === "string" &&
                typeof notification.message === "string"
            );

            if (actualNotices.length !== parsed.length) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(actualNotices));
            }
            return actualNotices;
        } catch (error) {
            console.warn("GamBasket notification storage is unavailable:", error?.message || error);
            return [];
        }
    }

    let notifications = loadNotifications();

    /* -----------------------------------------------------
       SAVE
    ----------------------------------------------------- */
    function saveNotifications() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    }

    /* -----------------------------------------------------
       SVG ICONS (No emojis)
    ----------------------------------------------------- */
    function getNotificationIcon(type) {
        const icons = {
            welcome: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 3L14.5 8.2L20 9L16 13L17 18.5L12 16L7 18.5L8 13L4 9L9.5 8.2L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `,
            wishlist: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M20.8 8.8C20.8 13.8 12 20 12 20C12 20 3.2 13.8 3.2 8.8C3.2 5.9 5.3 4 7.8 4C9.5 4 11 4.9 12 6.2C13 4.9 14.5 4 16.2 4C18.7 4 20.8 5.9 20.8 8.8Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `,
            explore: `
                <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/>
                    <path d="M14.8 9.2L13.3 13.3L9.2 14.8L10.7 10.7L14.8 9.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                </svg>
            `,
            order: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 7H19L18 20H6L5 7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M9 10V5C9 3.9 9.9 3 11 3H13C14.1 3 15 3.9 15 5V10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
            `,
            delivery: `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="1" y="3" width="15" height="13"></rect>
                    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                    <circle cx="5.5" cy="18.5" r="2.5"></circle>
                    <circle cx="18.5" cy="18.5" r="2.5"></circle>
                </svg>
            `,
            message: `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            `,
            seller: `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                    <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
            `,
            worker: `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
            `,
            system: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 4V12L16.5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/>
                </svg>
            `
        };

        return icons[type] || icons.system;
    }

    /* -----------------------------------------------------
       TIME FORMATTER
    ----------------------------------------------------- */
    function formatNotificationTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const difference = Math.floor((now - date) / 1000);

        if (difference < 10) return "Just now";
        if (difference < 60) return `${difference}s ago`;

        const minutes = Math.floor(difference / 60);
        if (minutes < 60) return `${minutes}m ago`;

        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;

        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;

        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric"
        });
    }

    /* -----------------------------------------------------
       ESCAPE HTML
    ----------------------------------------------------- */
    function escapeHTML(value) {
        const div = document.createElement("div");
        div.textContent = value;
        return div.innerHTML;
    }

    /* -----------------------------------------------------
       BADGE
    ----------------------------------------------------- */
    function updateBadge(count) {
        if (!notificationBadge) return;

        if (count <= 0) {
            notificationBadge.classList.remove("show");
            notificationBadge.textContent = "";
            return;
        }

        notificationBadge.textContent = count > 99 ? "99+" : count;
        notificationBadge.classList.add("show");
    }

    /* -----------------------------------------------------
       RENDER NOTIFICATIONS
    ----------------------------------------------------- */
    function renderNotifications() {
        if (!notificationsList) return;

        notificationsList.innerHTML = "";

        const unreadCount = notifications.filter(n => !n.read).length;
        updateBadge(unreadCount);

        if (notificationCountText) {
            if (unreadCount === 0) {
                notificationCountText.textContent = "You're all caught up";
            } else {
                notificationCountText.textContent =
                    unreadCount === 1
                        ? "1 unread notification"
                        : `${unreadCount} unread notifications`;
            }
        }

        if (markAllReadBtn) {
            markAllReadBtn.disabled = unreadCount === 0;
        }

        if (notifications.length === 0) {
            notificationsList.innerHTML = `
                <div class="notifications-empty">
                    <div class="notifications-empty-icon">
                        ${getNotificationIcon("system")}
                    </div>
                    <h3>No notifications yet</h3>
                    <p>When something important happens, you'll see it here.</p>
                </div>
            `;
            return;
        }

        notifications.forEach((notification, index) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = `notification-item ${notification.read ? "" : "unread"}`;
            item.style.animationDelay = `${index * 35}ms`;

            item.innerHTML = `
                <div class="notification-item-icon">
                    ${getNotificationIcon(notification.type)}
                </div>
                <div class="notification-item-content">
                    <span class="notification-item-title">
                        ${escapeHTML(notification.title)}
                    </span>
                    <span class="notification-item-message">
                        ${escapeHTML(notification.message)}
                    </span>
                    <span class="notification-item-time">
                        ${formatNotificationTime(notification.time)}
                    </span>
                </div>
                ${
                    notification.read
                        ? ""
                        : `<span class="notification-unread-dot"></span>`
                }
            `;

            item.addEventListener("click", () => {
                markAsRead(notification.id);
            });

            notificationsList.appendChild(item);
        });
    }

    /* -----------------------------------------------------
       OPEN / CLOSE / TOGGLE
    ----------------------------------------------------- */
    function openNotifications() {
        if (!notificationPanel || !notificationOverlay) return;

        notificationPanel.classList.add("active");
        notificationOverlay.classList.add("active");
        notificationPanel.setAttribute("aria-hidden", "false");
        notificationOverlay.setAttribute("aria-hidden", "false");
        if (notificationBtn) notificationBtn.setAttribute("aria-expanded", "true");
        document.body.classList.add("notifications-open");
    }

    function closeNotifications() {
        if (!notificationPanel || !notificationOverlay) return;

        notificationPanel.classList.remove("active");
        notificationOverlay.classList.remove("active");
        notificationPanel.setAttribute("aria-hidden", "true");
        notificationOverlay.setAttribute("aria-hidden", "true");
        if (notificationBtn) notificationBtn.setAttribute("aria-expanded", "false");
        document.body.classList.remove("notifications-open");
    }

    function toggleNotifications() {
        if (!notificationPanel) return;

        if (notificationPanel.classList.contains("active")) {
            closeNotifications();
        } else {
            openNotifications();
        }
    }

    /* -----------------------------------------------------
       MARK AS READ
    ----------------------------------------------------- */
    function markAsRead(id) {
        notifications = notifications.map(n => {
            if (n.id === id) {
                return { ...n, read: true };
            }
            return n;
        });

        saveNotifications();
        renderNotifications();
    }

    function markAllAsRead() {
        notifications = notifications.map(n => ({
            ...n,
            read: true
        }));

        saveNotifications();
        renderNotifications();
    }

    /* -----------------------------------------------------
       TOAST
    ----------------------------------------------------- */
    let toastTimer = null;

    function showNotificationToast(title, message) {
        if (!notificationToast || !toastTitle || !toastMessage) return;

        toastTitle.textContent = title;
        toastMessage.textContent = message;
        notificationToast.classList.add("show");

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            hideNotificationToast();
        }, 5000);
    }

    function hideNotificationToast() {
        if (notificationToast) {
            notificationToast.classList.remove("show");
        }
    }

    /* -----------------------------------------------------
       GLOBAL NOTIFICATION API
    ----------------------------------------------------- */
    window.GamBasketNotifications = {
        add: function ({
            id,
            type = "system",
            title,
            message,
            showToast = true
        }) {
            const notification = {
                id: id || `notification-${Date.now()}`,
                type,
                title,
                message,
                time: new Date().toISOString(),
                read: false
            };

            notifications.unshift(notification);
            saveNotifications();
            renderNotifications();

            if (showToast) {
                showNotificationToast(title, message);
            }
        },

        getAll: function () {
            return [...notifications];
        },

        markAllRead: function () {
            markAllAsRead();
        },

        clear: function () {
            notifications = [];
            saveNotifications();
            renderNotifications();
        }
    };

    /* -----------------------------------------------------
       INIT DOM & EVENTS
    ----------------------------------------------------- */
    function initDOM() {
        notificationBtn = document.getElementById("notificationBtn");
        notificationPanel = document.getElementById("notificationPanel");
        notificationOverlay = document.getElementById("notificationOverlay");
        notificationCloseBtn = document.getElementById("notificationCloseBtn");
        notificationsList = document.getElementById("notificationsList");
        notificationBadge = document.getElementById("notificationBadge");
        notificationCountText = document.getElementById("notificationCountText");
        markAllReadBtn = document.getElementById("markAllReadBtn");
        notificationToast = document.getElementById("notificationToast");
        toastTitle = document.getElementById("toastTitle");
        toastMessage = document.getElementById("toastMessage");
        toastClose = document.getElementById("toastClose");

        if (notificationBtn) {
            notificationBtn.addEventListener("click", function (event) {
                event.stopPropagation();
                toggleNotifications();
            });
        }

        if (notificationCloseBtn) {
            notificationCloseBtn.addEventListener("click", closeNotifications);
        }

        if (notificationOverlay) {
            notificationOverlay.addEventListener("click", closeNotifications);
        }

        if (markAllReadBtn) {
            markAllReadBtn.addEventListener("click", markAllAsRead);
        }

        if (toastClose) {
            toastClose.addEventListener("click", hideNotificationToast);
        }

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closeNotifications();
                hideNotificationToast();
            }
        });

        renderNotifications();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initDOM);
    } else {
        initDOM();
    }
})();
