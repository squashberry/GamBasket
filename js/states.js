/* ============================================================
   GAMBASKET — GLOBAL UI STATE SYSTEM
   Shared loading / error / offline / auth / permission states
============================================================ */

(() => {
    "use strict";

    const GamBasketState = {

        icons: {
            search: `
                <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="6.5"
                        stroke="currentColor" stroke-width="1.8"/>
                    <path d="M16 16l5 5"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"/>
                </svg>
            `,

            refresh: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M20 11a8 8 0 1 0 2 5"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"/>
                    <path d="M20 4v7h-7"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"/>
                </svg>
            `,

            lock: `
                <svg viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="10" width="16" height="11" rx="2"
                        stroke="currentColor" stroke-width="1.8"/>
                    <path d="M8 10V7a4 4 0 0 1 8 0v3"
                        stroke="currentColor" stroke-width="1.8"
                        stroke-linecap="round"/>
                </svg>
            `,

            shield: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linejoin="round"/>
                </svg>
            `,

            cloudOff: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M17.5 19H9a7 7 0 1 1 6.7-9"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"/>
                    <path d="M3 3l18 18"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"/>
                </svg>
            `,

            server: `
                <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="4" width="18" height="6" rx="2"
                        stroke="currentColor" stroke-width="1.8"/>
                    <rect x="3" y="14" width="18" height="6" rx="2"
                        stroke="currentColor" stroke-width="1.8"/>
                    <path d="M7 7h.01M7 17h.01"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"/>
                </svg>
            `,

            clock: `
                <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9"
                        stroke="currentColor" stroke-width="1.8"/>
                    <path d="M12 7v5l3 2"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"/>
                </svg>
            `,

            upload: `
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 16V4"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"/>
                    <path d="m7 9 5-5 5 5"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"/>
                    <path d="M5 20h14"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"/>
                </svg>
            `
        },

        /**
         * Render a full-page state
         */
        render(options = {}) {

            const {
                type = "serverError",
                title = "Something went wrong",
                message = "We couldn't complete that request.",
                actionText = "Try Again",
                action = null,
                secondaryText = "",
                secondaryAction = null,
                target = document.body
            } = options;

            const existing =
                target.querySelector(".gb-state-screen");

            if (existing) {
                existing.remove();
            }

            const state = document.createElement("section");

            state.className = `gb-state-screen gb-state-${type}`;

            state.innerHTML = `
                <div class="gb-state-glow"></div>

                <div class="gb-state-card">

                    <div class="gb-state-icon">
                        ${
                            this.icons[this.getIcon(type)] ||
                            this.icons.server
                        }
                    </div>

                    <div class="gb-state-copy">

                        <span class="gb-state-label">
                            ${this.getLabel(type)}
                        </span>

                        <h1>
                            ${this.escape(title)}
                        </h1>

                        <p>
                            ${this.escape(message)}
                        </p>

                    </div>

                    <div class="gb-state-actions">

                        ${
                            actionText
                            ? `
                                <button
                                    class="gb-state-primary"
                                    data-state-action="primary"
                                    type="button">
                                    ${this.escape(actionText)}
                                </button>
                            `
                            : ""
                        }

                        ${
                            secondaryText
                            ? `
                                <button
                                    class="gb-state-secondary"
                                    data-state-action="secondary"
                                    type="button">
                                    ${this.escape(secondaryText)}
                                </button>
                            `
                            : ""
                        }

                    </div>

                </div>
            `;

            target.appendChild(state);

            const primary =
                state.querySelector(
                    '[data-state-action="primary"]'
                );

            const secondary =
                state.querySelector(
                    '[data-state-action="secondary"]'
                );

            if (primary && action) {
                primary.addEventListener("click", action);
            }

            if (secondary && secondaryAction) {
                secondary.addEventListener(
                    "click",
                    secondaryAction
                );
            }

            return state;
        },

        getIcon(type) {

            const map = {
                loading: "clock",
                offline: "cloudOff",
                notFound: "search",
                auth: "lock",
                sessionExpired: "lock",
                forbidden: "shield",
                serverError: "server",
                rateLimited: "clock",
                maintenance: "server",
                uploadError: "upload",
                realtimeError: "cloudOff"
            };

            return map[type] || "server";
        },

        getLabel(type) {

            const map = {
                loading: "Loading",
                offline: "Offline",
                notFound: "Page Not Found",
                auth: "Authentication Required",
                sessionExpired: "Session Expired",
                forbidden: "Access Restricted",
                serverError: "Server Error",
                rateLimited: "Please Slow Down",
                maintenance: "Maintenance",
                uploadError: "Upload Failed",
                realtimeError: "Connection Issue"
            };

            return map[type] || "GamBasket";
        },

        clear(target = document.body) {

            target
                .querySelector(
                    ".gb-state-screen"
                )
                ?.remove();
        },

        escape(value) {

            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
    };

    /*
     * Automatically detect network changes.
     */
    window.addEventListener("offline", () => {
        window.dispatchEvent(
            new CustomEvent(
                "gambasket:offline"
            )
        );
    });

    window.addEventListener("online", () => {
        window.dispatchEvent(
            new CustomEvent(
                "gambasket:online"
            )
        );
    });

    // Automatic global handler for offline / online state delegated to GamBasketNetwork
    window.addEventListener("gambasket:offline", () => {
        if (window.GamBasketNetwork) {
            window.GamBasketNetwork.handleRequestFailure(new Error("State event trigger"));
        }
    });

    window.addEventListener("gambasket:online", () => {
        if (window.GamBasketNetwork) {
            window.GamBasketNetwork.handleOnline();
        }
    });

    window.GamBasketState = GamBasketState;

})();
