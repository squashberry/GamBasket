/* JulaDirect UI runtime: skip link, scroll state, reveal-on-scroll, toasts. */
(function () {
    "use strict";

    var root = document.documentElement;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("jd-js");

    var REVEAL = ".home-section-heading, .home-promo-card, .home-discovery-strip, .home-feature-banner, .home-coupon-card, .jd-card";

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    function addSkipLink() {
        var main = document.querySelector("main");
        if (!main || document.querySelector(".jd-skip")) return;
        if (!main.id) main.id = "jd-main";
        main.setAttribute("tabindex", "-1");
        var link = document.createElement("a");
        link.className = "jd-skip";
        link.href = "#" + main.id;
        link.textContent = "Skip to content";
        document.body.insertBefore(link, document.body.firstChild);
    }

    function trackScroll() {
        var ticking = false;
        function update() {
            root.classList.toggle("jd-scrolled", window.scrollY > 8);
            ticking = false;
        }
        window.addEventListener("scroll", function () {
            if (!ticking) {
                ticking = true;
                window.requestAnimationFrame(update);
            }
        }, { passive: true });
        update();
    }

    function setupReveal() {
        if (reduceMotion || !("IntersectionObserver" in window)) return;
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-in");
                    observer.unobserve(entry.target);
                }
            });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
        document.querySelectorAll(REVEAL).forEach(function (el) {
            el.classList.add("jd-reveal");
            observer.observe(el);
        });
    }

    var toastRegion = null;

    function toast(message, options) {
        options = options || {};
        if (!toastRegion) {
            toastRegion = document.createElement("div");
            toastRegion.className = "jd-toasts";
            toastRegion.setAttribute("role", "status");
            toastRegion.setAttribute("aria-live", "polite");
            document.body.appendChild(toastRegion);
        }
        var item = document.createElement("div");
        item.className = "jd-toast" + (options.type ? " jd-toast--" + options.type : "");
        var text = document.createElement("span");
        text.textContent = String(message);
        var close = document.createElement("button");
        close.type = "button";
        close.setAttribute("aria-label", "Dismiss");
        close.textContent = "\u00d7";
        function remove() {
            if (item.parentNode) item.parentNode.removeChild(item);
        }
        close.addEventListener("click", remove);
        item.appendChild(text);
        item.appendChild(close);
        toastRegion.appendChild(item);
        window.setTimeout(remove, options.duration || 4500);
    }

    window.JD = window.JD || {};
    window.JD.toast = toast;

    ready(function () {
        addSkipLink();
        trackScroll();
        setupReveal();
    });
})();
