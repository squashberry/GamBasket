/* =========================================================
   GAMBASKET — CENTRALIZED NETWORK & OFFLINE MANAGER
   ========================================================= */

(() => {
    "use strict";

    // Development mode console logging helper
    const log = (msg, data = "") => {
        const isDev = window.location.hostname === "localhost" || 
                      window.location.hostname === "127.0.0.1" || 
                      window.location.protocol === "file:";
        if (isDev) {
            console.log(`[GamBasket Network] ${msg}`, data);
        }
    };

    const isNetworkError = (error) => {
        if (!error) return false;
        const message = String(error.message || error || "").toLowerCase();
        
        // Ignore Edge tracking prevention / storage blocker errors
        if (message.includes("tracking prevention") || 
            message.includes("blocked access to storage") || 
            message.includes("securityerror") ||
            message.includes("database") ||
            message.includes("rpc")) {
            return false;
        }
        
        // Exclude specific HTTP status errors if they are passed as error objects
        if (error.status && [400, 401, 403, 404, 409, 422, 500].includes(error.status)) {
            return false;
        }
        
        if (!navigator.onLine) return true;
        
        return /failed to fetch|networkerror|network error|fetch failed|econnrefused|enotfound|timeout|abort/.test(message);
    };

    class NetworkManager {
        constructor() {
            this.initialized = false;
            this.isOfflineState = false;
            this.softNoticeTimer = null;
            this.fullScreenTimer = null;
            this.pingInterval = null;
            this.pendingRequests = [];
            this.softNoticeEl = null;
            this.fullScreenEl = null;
            this.offlineTimeoutDuration = 12000; // 12 seconds
            this.softNoticeDelay = 2000; // 2 seconds
            
            this.onOnlineBound = this.handleOnline.bind(this);
            this.onOfflineBound = this.handleOffline.bind(this);
            this.onUnhandledRejectionBound = this.handleUnhandledRejection.bind(this);
        }

        init() {
            if (this.initialized) return;
            this.initialized = true;

            // Add global event listeners
            window.addEventListener("online", this.onOnlineBound);
            window.addEventListener("offline", this.onOfflineBound);
            window.addEventListener("unhandledrejection", this.onUnhandledRejectionBound);

            // Inject CSS styles dynamically
            this.injectStyles();

            // Override window.fetch to capture network errors
            this.setupFetchInterceptor();

            // Check initial state
            if (!navigator.onLine) {
                this.handleOffline();
            }
        }

        injectStyles() {
            if (document.getElementById("gambasket-network-styles")) return;

            const style = document.createElement("style");
            style.id = "gambasket-network-styles";
            style.textContent = `
                /* Soft Offline Toast Style */
                .gb-network-toast {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 100005;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 18px;
                    background: rgba(30, 41, 59, 0.85);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                    color: #f1f5f9;
                    font-family: system-ui, -apple-system, sans-serif;
                    font-size: 14px;
                    transform: translateY(100px);
                    opacity: 0;
                    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
                    pointer-events: auto;
                }
                
                @media (prefers-reduced-motion: reduce) {
                    .gb-network-toast {
                        transition: opacity 0.2s ease;
                        transform: none !important;
                    }
                }

                .gb-network-toast.show {
                    transform: translateY(0);
                    opacity: 1;
                }

                @media (max-width: 640px) {
                    .gb-network-toast {
                        bottom: 16px;
                        left: 16px;
                        right: 16px;
                        justify-content: space-between;
                    }
                }

                .gb-network-spinner {
                    width: 18px;
                    height: 18px;
                    border: 2px solid rgba(241, 245, 249, 0.2);
                    border-top-color: #3b82f6;
                    border-radius: 50%;
                    animation: gb-spin 0.8s linear infinite;
                    flex-shrink: 0;
                }

                .gb-network-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #94a3b8;
                    display: inline-block;
                    animation: gb-pulse 1.5s ease-in-out infinite;
                }

                .gb-network-toast-content {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .gb-network-toast-title {
                    font-weight: 600;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .gb-network-toast-desc {
                    font-size: 12px;
                    color: #94a3b8;
                }

                .gb-network-toast-actions {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-left: 12px;
                }

                .gb-network-btn-link {
                    background: none;
                    border: none;
                    color: #3b82f6;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    padding: 4px 8px;
                    border-radius: 6px;
                    transition: background 0.2s;
                }

                .gb-network-btn-link:hover {
                    background: rgba(59, 130, 246, 0.1);
                    color: #60a5fa;
                }

                .gb-network-btn-close {
                    background: none;
                    border: none;
                    color: #94a3b8;
                    font-size: 16px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    transition: background 0.2s, color 0.2s;
                }

                .gb-network-btn-close:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }

                /* Fullscreen Offline Overlay */
                .gb-network-fullscreen {
                    position: fixed;
                    inset: 0;
                    z-index: 100006;
                    background: var(--background, #f8fafc);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    font-family: system-ui, -apple-system, sans-serif;
                    color: var(--text, #0f172a);
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: none;
                }

                .gb-network-fullscreen.show {
                    opacity: 1;
                    pointer-events: auto;
                }

                /* Dark mode compatibility */
                .dark .gb-network-fullscreen {
                    background: #0f172a;
                    color: #f1f5f9;
                }

                .gb-network-fullscreen-card {
                    max-width: 480px;
                    width: 100%;
                    text-align: center;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }

                .gb-network-fullscreen-icon {
                    font-size: 64px;
                    margin-bottom: 24px;
                    animation: gb-float 3s ease-in-out infinite;
                }

                @media (prefers-reduced-motion: reduce) {
                    .gb-network-fullscreen-icon {
                        animation: none !important;
                    }
                }

                .gb-network-fullscreen-title {
                    font-size: 24px;
                    font-weight: 800;
                    margin: 0 0 12px 0;
                }

                .gb-network-fullscreen-desc {
                    font-size: 15px;
                    color: #64748b;
                    line-height: 1.6;
                    margin: 0 0 28px 0;
                }

                .dark .gb-network-fullscreen-desc {
                    color: #94a3b8;
                }

                .gb-network-btn-primary {
                    background: #2563eb;
                    color: #fff;
                    border: none;
                    padding: 12px 28px;
                    border-radius: 12px;
                    font-weight: 700;
                    font-size: 15px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
                    transition: transform 0.2s, background 0.2s, box-shadow 0.2s;
                }

                .gb-network-btn-primary:hover {
                    background: #1d4ed8;
                    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3);
                }

                .gb-network-btn-primary:active {
                    transform: scale(0.98);
                }

                .gb-network-status-bar {
                    margin-top: 32px;
                    font-size: 12px;
                    color: #94a3b8;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .gb-network-status-bar-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #ef4444;
                }

                @keyframes gb-spin {
                    to { transform: rotate(360deg); }
                }

                @keyframes gb-pulse {
                    0%, 100% { opacity: 0.5; }
                    50% { opacity: 1; }
                }

                @keyframes gb-float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
            `;
            document.head.appendChild(style);
        }

        setupFetchInterceptor() {
            if (typeof window.fetch !== "function") return;

            const nativeFetch = window.fetch.bind(window);
            window.fetch = async (...args) => {
                // Avoid intercepting the connectivity check favicon ping
                if (args[0] && typeof args[0] === 'string' && args[0].includes("/favicon.svg?ping=")) {
                    return nativeFetch(...args);
                }
                try {
                    return await nativeFetch(...args);
                } catch (error) {
                    if (isNetworkError(error)) {
                        log("request failed", error);
                        
                        return new Promise((resolve, reject) => {
                            this.pendingRequests.push({
                                args,
                                resolve,
                                reject,
                                nativeFetch
                            });

                            this.handleRequestFailure(error);
                        });
                    }
                    throw error;
                }
            };
        }

        handleUnhandledRejection(event) {
            if (isNetworkError(event.reason)) {
                log("request failed (unhandled promise rejection)", event.reason);
                this.handleRequestFailure(event.reason);
            }
        }

        handleRequestFailure(error) {
            if (this.isOfflineState) return;
            
            this.isOfflineState = true;
            this.clearTimers();

            // Set timer for Soft Notice (~2s)
            this.softNoticeTimer = setTimeout(() => {
                this.showSoftOfflineNotice();
            }, this.softNoticeDelay);

            // Set timer for Full Offline Screen (12 seconds)
            this.fullScreenTimer = setTimeout(() => {
                log("offline timeout reached");
                this.showOfflineScreen();
            }, this.offlineTimeoutDuration);

            this.startPingMonitoring();
        }

        handleOnline() {
            log("connection restored");
            this.recover();
        }

        handleOffline() {
            log("device went offline according to event");
            this.handleRequestFailure(new Error("Device is offline"));
        }

        async recover() {
            this.isOfflineState = false;
            this.clearTimers();
            this.hideSoftOfflineNotice();
            this.hideOfflineScreen();
            this.stopPingMonitoring();

            const queue = [...this.pendingRequests];
            this.pendingRequests = [];

            log(`retrying ${queue.length} pending request(s)`);

            for (const req of queue) {
                try {
                    const response = await req.nativeFetch(...req.args);
                    req.resolve(response);
                } catch (err) {
                    if (isNetworkError(err)) {
                        this.pendingRequests.push(req);
                        this.handleRequestFailure(err);
                    } else {
                        req.reject(err);
                    }
                }
            }
        }

        async checkConnectivity() {
            if (!navigator.onLine) return false;
            
            try {
                const response = await window.fetch("/favicon.svg?ping=" + Date.now(), {
                    method: "HEAD",
                    cache: "no-store",
                    mode: "no-cors"
                });
                return true;
            } catch {
                return false;
            }
        }

        startPingMonitoring() {
            if (this.pingInterval) return;

            this.pingInterval = setInterval(async () => {
                log("retrying connection check...");
                const online = await this.checkConnectivity();
                if (online) {
                    this.handleOnline();
                }
            }, 3000);
        }

        stopPingMonitoring() {
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }
        }

        clearTimers() {
            if (this.softNoticeTimer) {
                clearTimeout(this.softNoticeTimer);
                this.softNoticeTimer = null;
            }
            if (this.fullScreenTimer) {
                clearTimeout(this.fullScreenTimer);
                this.fullScreenTimer = null;
            }
        }

        showSoftOfflineNotice() {
            if (this.softNoticeEl) return;
            if (document.getElementById("gb-network-toast")) return;

            const toast = document.createElement("div");
            toast.id = "gb-network-toast";
            toast.className = "gb-network-toast";
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            toast.innerHTML = `
                <div class="gb-network-spinner"></div>
                <div class="gb-network-toast-content">
                    <div class="gb-network-toast-title">
                        <span>You appear to be offline</span>
                    </div>
                    <div class="gb-network-toast-desc">Trying to reconnect…</div>
                </div>
                <div class="gb-network-toast-actions">
                    <button type="button" class="gb-network-btn-link" id="gb-toast-retry">Retry</button>
                    <button type="button" class="gb-network-btn-close" id="gb-toast-close" aria-label="Dismiss">&times;</button>
                </div>
            `;

            document.body.appendChild(toast);
            this.softNoticeEl = toast;

            requestAnimationFrame(() => {
                toast.classList.add("show");
            });

            document.getElementById("gb-toast-retry")?.addEventListener("click", () => this.retry());
            document.getElementById("gb-toast-close")?.addEventListener("click", () => this.hideSoftOfflineNotice());
        }

        hideSoftOfflineNotice() {
            const toast = this.softNoticeEl || document.getElementById("gb-network-toast");
            if (!toast) return;

            toast.classList.remove("show");
            setTimeout(() => {
                toast.remove();
                if (this.softNoticeEl === toast) {
                    this.softNoticeEl = null;
                }
            }, 400);
        }

        showOfflineScreen() {
            if (this.fullScreenEl) return;
            if (document.getElementById("gb-network-fullscreen")) return;

            this.hideSoftOfflineNotice();

            const overlay = document.createElement("div");
            overlay.id = "gb-network-fullscreen";
            overlay.className = "gb-network-fullscreen";
            overlay.innerHTML = `
                <div class="gb-network-fullscreen-card">
                    <div class="gb-network-fullscreen-icon" style="animation: gb-float 3s ease-in-out infinite;">🔌</div>
                    <h1 class="gb-network-fullscreen-title">You're offline</h1>
                    <p class="gb-network-fullscreen-desc">
                        GamBasket couldn't connect to the internet. Check your connection and try again.
                    </p>
                    <button type="button" class="gb-network-btn-primary" id="gb-fullscreen-retry">
                        Try Again
                    </button>
                    <div class="gb-network-status-bar">
                        <span class="gb-network-status-bar-dot"></span>
                        No internet connection detected
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            this.fullScreenEl = overlay;

            requestAnimationFrame(() => {
                overlay.classList.add("show");
            });

            document.getElementById("gb-fullscreen-retry")?.addEventListener("click", () => this.retry());
        }

        hideOfflineScreen() {
            const overlay = this.fullScreenEl || document.getElementById("gb-network-fullscreen");
            if (!overlay) return;

            overlay.classList.remove("show");
            setTimeout(() => {
                overlay.remove();
                if (this.fullScreenEl === overlay) {
                    this.fullScreenEl = null;
                }
            }, 300);
        }

        async retry() {
            log("manually retry clicked");
            this.clearTimers();

            const button = document.getElementById("gb-fullscreen-retry") || document.getElementById("gb-toast-retry");
            const spinner = document.createElement("span");
            spinner.className = "gb-network-spinner";
            
            let originalContent = "";
            if (button) {
                originalContent = button.innerHTML;
                button.disabled = true;
                button.innerHTML = "";
                button.appendChild(spinner);
            }

            const connected = await this.checkConnectivity();
            
            if (connected) {
                this.handleOnline();
            } else {
                if (button) {
                    button.disabled = false;
                    button.innerHTML = originalContent;
                }
                
                this.softNoticeTimer = setTimeout(() => {
                    this.showSoftOfflineNotice();
                }, this.softNoticeDelay);

                this.fullScreenTimer = setTimeout(() => {
                    log("offline timeout reached after failed manual retry");
                    this.showOfflineScreen();
                }, this.offlineTimeoutDuration);
            }
        }

        isOffline() {
            return this.isOfflineState;
        }

        startMonitoring() {
            this.init();
        }

        stopMonitoring() {
            window.removeEventListener("online", this.onOnlineBound);
            window.removeEventListener("offline", this.onOfflineBound);
            window.removeEventListener("unhandledrejection", this.onUnhandledRejectionBound);
            this.stopPingMonitoring();
            this.clearTimers();
            this.hideSoftOfflineNotice();
            this.hideOfflineScreen();
        }
    }

    // Export to global scope
    const manager = new NetworkManager();
    window.GamBasketNetwork = manager;

    // Start monitoring automatically on load
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => manager.startMonitoring());
    } else {
        manager.startMonitoring();
    }
})();
