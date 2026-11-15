(() => {
  "use strict";
  const API = "https://iwxcepbwmnnkxocskopx.supabase.co/functions/v1/juladirect-store-bridge";
  const PUBLIC_KEY = "sb_publishable_LYlQsw2QbUqUTPcrYiTAtg_6hwDQ92Z";
  const $ = (id) => document.getElementById(id);
  const showError = (message) => {
    const el = $("sellerPageError");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
  };
  async function invoke(action, token, extra = {}) {
    const response = await fetch(API, {
      method: "POST",
      headers: {
        apikey: PUBLIC_KEY,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, ...extra })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "JulaDirect could not complete this request.");
    return data;
  }
  async function init() {
    const auth = window.GamBasketAuth;
    if (!auth) throw new Error("Your JulaDirect session could not be loaded. Refresh this page.");
    await auth.ready();
    const session = await auth.getSession();
    if (!session?.user) {
      const returnTo = "supplier/website.html" + window.location.search;
      window.location.replace("../login.html?redirect=" + encodeURIComponent(returnTo));
      return;
    }
    const roles = await auth.getUserRoles();
    if (!roles.includes("seller") && !roles.includes("admin")) {
      throw new Error("This page is available to active JulaDirect sellers.");
    }
    $("sellerLoading").hidden = true;
    $("sellerProtectedContent").hidden = false;

    const returnTo = new URLSearchParams(window.location.search).get("return_to") || "/builder";
    const status = await invoke("seller_status", session.access_token);
    const dot = $("sellerConnectionDot");
    const label = $("sellerConnectionStatus");
    const business = $("sellerBusinessName");
    const create = $("createWebsiteButton");
    const sitesList = $("publishedSitesList");
    const noSite = $("noWebsiteText");
    const connect = $("connectJulaButton");

    if (status.connected) {
      dot.classList.add("ok");
      label.textContent = "JulaDirect account connected";
      business.textContent = "— " + (status.seller_name || "Seller account");
      create.setAttribute("aria-disabled", "false");
      create.style.opacity = "1";
      create.style.pointerEvents = "auto";
      connect.textContent = "Account connected";
      connect.disabled = true;
      const sites = Array.isArray(status.published_sites)
        ? status.published_sites
        : (status.published_site ? [status.published_site] : []);
      sitesList.replaceChildren();
      if (sites.length) {
        noSite.hidden = true;
        sitesList.hidden = false;
        for (const site of sites) {
          if (!site?.site_id) continue;
          const row = document.createElement("article");
          row.className = "jd-site-card";
          const info = document.createElement("div");
          info.className = "jd-site-info";
          const name = document.createElement("strong");
          name.textContent = site.site_name || "Store website";
          const slug = document.createElement("small");
          slug.textContent = site.site_slug ? "squashberrypro.pages.dev/" + site.site_slug : "Published on SquashberryPro";
          info.append(name, slug);
          const actions = document.createElement("div");
          actions.className = "jd-site-actions";
          const manageLink = document.createElement("a");
          manageLink.href = "https://squashberrypro.pages.dev/builder/site/" + encodeURIComponent(site.site_id);
          manageLink.target = "_blank";
          manageLink.rel = "noopener noreferrer";
          manageLink.textContent = "Manage";
          actions.appendChild(manageLink);
          try {
            const liveUrl = new URL(site.public_url);
            if (liveUrl.origin === "https://squashberrypro.pages.dev") {
              const liveLink = document.createElement("a");
              liveLink.className = "live";
              liveLink.href = liveUrl.href;
              liveLink.target = "_blank";
              liveLink.rel = "noopener noreferrer";
              liveLink.textContent = "View live site ↗";
              actions.appendChild(liveLink);
            }
          } catch { /* Skip malformed public URLs. */ }
          row.append(info, actions);
          sitesList.appendChild(row);
        }
      } else {
        sitesList.hidden = true;
        noSite.hidden = false;
      }
    } else {
      dot.classList.remove("ok");
      label.textContent = "Connect your account to continue";
      business.textContent = "";
      create.setAttribute("aria-disabled", "true");
      create.style.opacity = ".45";
      create.style.pointerEvents = "none";
    }

    connect.addEventListener("click", async () => {
      connect.disabled = true;
      connect.textContent = "Preparing secure connection…";
      $("sellerPageError").style.display = "none";
      try {
        const result = await invoke("start_link", session.access_token, { return_to: returnTo });
        window.location.assign(result.connect_url);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Could not start account linking.");
        connect.disabled = false;
        connect.textContent = status.connected ? "Account connected" : "Connect account";
      }
    });

    const theme = $("desktopThemeToggle");
    theme?.addEventListener("click", () => {
      const dark = document.documentElement.classList.toggle("dark");
      localStorage.setItem("gambasket-theme", dark ? "dark" : "light");
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      $("sellerLoading").textContent = error instanceof Error ? error.message : "Unable to load Seller Center.";
      showError(error instanceof Error ? error.message : "Unable to load Seller Center.");
    });
  });
})();