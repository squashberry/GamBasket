/* Mounts the new JulaDirect shell (header, footer, floating navigation) on pages
   that still run on the legacy stylesheet, and keeps those pages light-themed. */
(function () {
  "use strict";
  document.documentElement.classList.remove("dark");
  var JD = window.JD;
  if (!JD || !JD.mountShell) return;
  var file = location.pathname.split("/").pop().replace(/\.html$/, "");
  var account = ["me", "orders", "messages", "settings", "security", "saved-searches"];
  JD.mountShell({ active: account.indexOf(file) > -1 ? "account" : "", noBodyClass: true });
  document.body.classList.add("jd-legacy");
})();
