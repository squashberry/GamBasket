/* JulaDirect search: one engine for every search bar.
   - ghost autocomplete (grey completion inside the box, Tab / right arrow accepts)
   - text suggestions + a swipeable tray of matching products with their photos
   - recent and popular searches when the box is empty (phones)
   - desktop: the header search stays quiet until the first letter, then glides to the middle
     of the header and opens the panel. phones: the box widens as soon as it is tapped and
     pushes the filter button out.
   The image-search button only announces itself with a `jd:image-search` event. */
(function () {
  "use strict";
  const JD = window.JD;
  if (!JD || JD.search) return;

  const on = (t, type, fn, o) => (JD.rawAddEventListener || EventTarget.prototype.addEventListener).call(t, type, fn, o);
  const RQ = "jd-recent-queries";
  const POPULAR = ["iPhone", "Samsung", "Solar", "Toyota", "Sneakers"];
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = window.matchMedia("(max-width: 820px)");
  const esc = s => JD.esc(s);

  const recents = () => { try { const a = JSON.parse(localStorage.getItem(RQ) || "[]"); return Array.isArray(a) ? a.filter(x => typeof x === "string").slice(0, 6) : []; } catch (e) { return []; } };
  const remember = q => { if (!q) return; try { localStorage.setItem(RQ, JSON.stringify([q].concat(recents().filter(x => x.toLowerCase() !== q.toLowerCase())).slice(0, 6))); } catch (e) { /* storage blocked */ } };
  const forget = () => { try { localStorage.removeItem(RQ); } catch (e) { /* ignore */ } };

  /* ---------- data ---------- */
  const cache = new Map();
  let cats = [];
  if (JD.data && JD.data.categoryStats) JD.data.categoryStats().then(s => { cats = (s && s.categories) || []; }).catch(() => {});

  async function lookup(q) {
    const key = q.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    if (!JD.data || !JD.data.search) return { rows: [], total: 0 };
    const r = await JD.data.search({ q, sort: "popular", page: 1 });
    const v = { rows: (r.rows || []).slice(0, 12), total: r.total || 0 };
    cache.set(key, v);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return v;
  }

  /* Phrases that continue what was typed, taken from real product titles. */
  function phrases(q, rows) {
    const lq = q.toLowerCase();
    const words = lq.split(/\s+/).filter(Boolean);
    const last = words[words.length - 1] || "";
    const score = new Map();
    rows.forEach(p => {
      const t = String(p.title || "").replace(/\s+/g, " ").trim();
      const parts = t.split(" ");
      for (let i = 0; i < parts.length; i++) {
        const tail = parts.slice(i).join(" ").toLowerCase();
        const head = words.length > 1 ? lq : last;
        if (words.length > 1 ? tail.startsWith(lq) : parts[i].toLowerCase().startsWith(last)) {
          const take = parts.slice(i, i + Math.max(words.length, 1) + 2).join(" ").replace(/[,.;:()\-–]+$/, "");
          const k = take.toLowerCase();
          if (k.length > head.length - 1 && k !== lq) score.set(k, { text: take, n: (score.get(k) ? score.get(k).n : 0) + 1 });
          break;
        }
      }
    });
    return [...score.values()].sort((a, b) => b.n - a.n || a.text.length - b.text.length).slice(0, 5).map(x => x.text);
  }

  /* An instant guess before the network answers: recents, popular terms and categories. */
  function quickGuess(q) {
    const lq = q.toLowerCase();
    const pool = recents().concat(POPULAR, cats.map(c => c.id));
    return pool.find(x => x.toLowerCase().startsWith(lq) && x.toLowerCase() !== lq) || "";
  }

  function boldTail(text, q) {
    const n = q.length;
    return text.toLowerCase().startsWith(q.toLowerCase())
      ? esc(text.slice(0, n)) + "<b>" + esc(text.slice(n)) + "</b>"
      : esc(text);
  }

  /* ---------- one search box ---------- */
  function Box(form) {
    const input = form.querySelector("input[name=q]");
    const panel = form.querySelector(".sx-panel");
    const ghost = form.querySelector(".sx-ghost");
    if (!input || !panel) return;
    const mode = form.getAttribute("data-sx"); // "m" phone bar, "d" header bar, "h" inline (hero)
    let open = false, seq = 0, active = -1, best = "", ph = null, state = { q: "", phrases: [], rows: [], total: 0, loading: false };

    const val = () => input.value.replace(/\s+/g, " ").trim();
    const items = () => JD.$$(".sx-item, .sx-all", panel);

    /* ghost text */
    function paintGhost() {
      if (!ghost) return;
      const v = input.value;
      const g = open || mode === "h" ? best : "";
      const fits = input.scrollWidth <= input.clientWidth + 1;
      if (v && g && fits && g.toLowerCase().startsWith(v.trim().toLowerCase()) && g.length > v.trim().length && document.activeElement === input) {
        ghost.innerHTML = "<i>" + esc(v) + "</i>" + esc(g.slice(v.trim().length));
        ghost.hidden = false;
      } else { ghost.innerHTML = ""; ghost.hidden = true; }
    }

    /* panel */
    function tray(rows, loading) {
      if (loading) return '<div class="sx-tray sx-tray--load" aria-hidden="true">' + "<span></span>".repeat(5) + "</div>";
      return '<div class="sx-trayw"><div class="sx-tray" tabindex="-1">' + rows.map(p => {
        const img = JD.safeUrl(p.main_image) || JD.placeholder;
        return '<a class="sx-pcard" href="product.html?id=' + encodeURIComponent(p.id) + '"><span class="sx-pcard__img"><img src="' + esc(img) + '" alt="" loading="lazy" decoding="async"></span>' +
          '<b>' + esc(JD.money(p.price, p.currency)) + '</b><span class="sx-pcard__t">' + esc(p.title) + "</span></a>";
      }).join("") + '</div><button type="button" class="sx-arrow sx-arrow--l" aria-label="Previous products" tabindex="-1">' + JD.icon("chevronRight", 18) + '</button><button type="button" class="sx-arrow sx-arrow--r" aria-label="More products" tabindex="-1">' + JD.icon("chevronRight", 18) + "</button></div>";
    }
    const fillBtn = t => '<button type="button" class="sx-fill" data-fill="' + esc(t) + '" aria-label="Use ' + esc(t) + '" tabindex="-1">' + JD.icon("arrowUpRight", 16) + "</button>";

    function render() {
      const q = val();
      let h = "";
      if (!q) {
        const r = recents();
        if (r.length) h += '<div class="sx-sec"><h4>Recent searches<button type="button" data-sx-clear>Clear</button></h4>' + r.map(t => '<div class="sx-row"><button type="button" class="sx-item" data-go="' + esc(t) + '">' + JD.icon("clock", 18) + "<span>" + esc(t) + "</span></button>" + fillBtn(t) + "</div>").join("") + "</div>";
        h += '<div class="sx-sec"><h4>Popular right now</h4><div class="sx-chips">' + POPULAR.map(t => '<button type="button" class="sx-item sx-chip" data-go="' + esc(t) + '">' + JD.icon("trend", 15) + esc(t) + "</button>").join("") + "</div></div>";
        if (cats.length) h += '<div class="sx-sec"><h4>Browse categories</h4><div class="sx-chips">' + cats.slice(0, 8).map(c => '<a class="sx-item sx-chip sx-chip--cat" href="explore.html?category=' + encodeURIComponent(c.id) + '">' + esc(c.id) + "</a>").join("") + "</div></div>";
      } else {
        const lq = q.toLowerCase();
        const list = state.phrases.length ? state.phrases : (best && best.toLowerCase() !== lq ? [best] : []);
        const cmatch = cats.filter(c => c.id.toLowerCase().includes(lq) && c.id.toLowerCase() !== lq).slice(0, 2);
        h += '<div class="sx-sec"><h4>Suggestions</h4>' +
          '<div class="sx-row"><button type="button" class="sx-item" data-go="' + esc(q) + '">' + JD.icon("search", 18) + "<span>" + esc(q) + "</span></button></div>" +
          list.map(t => '<div class="sx-row"><button type="button" class="sx-item" data-go="' + esc(t) + '">' + JD.icon("search", 18) + "<span>" + boldTail(t, q) + "</span></button>" + fillBtn(t) + "</div>").join("") +
          cmatch.map(c => '<div class="sx-row"><a class="sx-item" href="explore.html?category=' + encodeURIComponent(c.id) + '&amp;q=' + encodeURIComponent(q) + '">' + JD.icon("grid", 18) + "<span>" + esc(q) + " in <b>" + esc(c.id) + "</b></span></a></div>").join("") + "</div>";
        if (state.loading && !state.rows.length) h += '<div class="sx-sec sx-prod"><h4>Products</h4>' + tray([], true) + "</div>";
        else if (state.rows.length) h += '<div class="sx-sec sx-prod"><h4>Products <small>' + state.total.toLocaleString("en-GB") + " found</small></h4>" + tray(state.rows) + "</div>" +
          '<button type="submit" class="sx-all">See all ' + state.total.toLocaleString("en-GB") + " results for &ldquo;" + esc(q) + "&rdquo;" + JD.icon("arrowRight", 18) + "</button>";
        else if (!state.loading && state.q === q) h += '<p class="sx-none">No listings match &ldquo;' + esc(q) + '&rdquo; yet. Try fewer words or browse a category.</p>';
      }
      panel.innerHTML = h;
      active = -1;
      wireTray();
    }

    function wireTray() {
      const tr = panel.querySelector(".sx-tray");
      if (!tr || tr.classList.contains("sx-tray--load")) return;
      const w = tr.parentElement, l = w.querySelector(".sx-arrow--l"), r = w.querySelector(".sx-arrow--r");
      const upd = () => { l.hidden = tr.scrollLeft < 8; r.hidden = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 8; };
      l.addEventListener("click", () => tr.scrollBy({ left: -tr.clientWidth * .85, behavior: reduce ? "auto" : "smooth" }));
      r.addEventListener("click", () => tr.scrollBy({ left: tr.clientWidth * .85, behavior: reduce ? "auto" : "smooth" }));
      tr.addEventListener("scroll", upd, { passive: true });
      requestAnimationFrame(upd);
    }

    async function refresh() {
      const q = val();
      const my = ++seq;
      best = q ? quickGuess(q) : "";
      state.q = q;
      if (!q) { state.phrases = []; state.rows = []; state.loading = false; render(); paintGhost(); return; }
      state.loading = !cache.has(q.toLowerCase());
      if (!cache.has(q.toLowerCase())) { state.phrases = []; state.rows = []; }
      render(); paintGhost();
      if (q.length < 2) { state.loading = false; return; }
      try {
        const r = await lookup(q);
        if (my !== seq) return;
        state.rows = r.rows; state.total = r.total; state.loading = false;
        state.phrases = phrases(q, r.rows);
        best = state.phrases.find(t => t.toLowerCase().startsWith(q.toLowerCase())) || best;
      } catch (e) {
        if (my !== seq) return;
        state.loading = false; state.rows = []; state.phrases = [];
      }
      render(); paintGhost();
    }
    const refreshSoon = JD.debounce(refresh, 160);

    /* open / close. The desktop bar glides to the middle of the header (FLIP-style). */
    function openIt() {
      if (open) return;
      open = true;
      form.classList.add("is-open");
      document.body.classList.add("sx-open");
      panel.hidden = false;
      if (mode === "d") glide(true);
      backdrop(true);
    }
    function closeIt(blur) {
      if (!open) return;
      open = false;
      form.classList.remove("is-open");
      document.body.classList.remove("sx-open");
      panel.hidden = true;
      seq++;
      if (mode === "d") glide(false);
      backdrop(false);
      best = ""; paintGhost();
      if (blur && document.activeElement === input) input.blur();
    }
    function glide(to) {
      const row = form.parentElement;
      if (to) {
        const r = form.getBoundingClientRect(), rr = row.getBoundingClientRect();
        ph = document.createElement("span");
        ph.className = "sx-ph";
        ph.style.cssText = "flex:0 0 " + r.width + "px;height:" + r.height + "px;margin-right:auto";
        form.before(ph);
        form.style.cssText = "position:absolute;left:" + (r.left - rr.left) + "px;top:" + (r.top - rr.top) + "px;width:" + r.width + "px;height:" + r.height + "px;margin:0";
        void form.offsetWidth;
        center(row);
      } else if (ph) {
        const rr = row.getBoundingClientRect(), p = ph.getBoundingClientRect();
        form.style.left = (p.left - rr.left) + "px";
        form.style.width = p.width + "px";
        const done = () => { form.removeEventListener("transitionend", done); clearTimeout(t); if (!open) { form.style.cssText = ""; if (ph) { ph.remove(); ph = null; } } };
        const t = setTimeout(done, reduce ? 0 : 520);
        form.addEventListener("transitionend", done);
      }
    }
    function center(row) {
      const rr = (row || form.parentElement).getBoundingClientRect();
      const w = Math.min(780, rr.width - 40);
      form.style.left = ((rr.width - w) / 2) + "px";
      form.style.width = w + "px";
    }
    on(window, "resize", () => { if (open && mode === "d") center(); });

    let bd = null;
    function backdrop(show) {
      if (mode === "h") return;
      if (show) {
        if (!bd) { bd = document.createElement("div"); bd.className = "sx-backdrop"; bd.addEventListener("mousedown", e => { e.preventDefault(); closeIt(true); }); bd.addEventListener("touchstart", () => closeIt(true), { passive: true }); }
        document.body.appendChild(bd);
        requestAnimationFrame(() => bd && bd.classList.add("is-on"));
      } else if (bd) { bd.classList.remove("is-on"); const b = bd; setTimeout(() => { if (!open) b.remove(); }, 240); }
    }

    /* events */
    input.addEventListener("focus", () => {
      if (mode === "m") { openIt(); refresh(); }
    });
    input.addEventListener("input", () => {
      const has = !!val();
      if (mode === "d" || mode === "h") { if (has) { openIt(); } else closeIt(false); }
      if (mode === "m" && !open) openIt();
      best = quickGuess(val());
      paintGhost();
      refreshSoon();
    });
    input.addEventListener("keydown", e => {
      const it = items();
      if (e.key === "Escape") { if (open) { e.preventDefault(); closeIt(true); } return; }
      if ((e.key === "Tab" && !e.shiftKey || e.key === "ArrowRight") && best && input.selectionStart === input.value.length && best.toLowerCase().startsWith(val().toLowerCase()) && best.length > val().length) {
        e.preventDefault(); input.value = best; best = ""; paintGhost(); refresh(); return;
      }
      if (!open || !it.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = e.key === "ArrowDown" ? (active + 1) % it.length : (active - 1 + it.length) % it.length;
        it.forEach((x, i) => x.classList.toggle("is-active", i === active));
        const cur = it[active]; if (cur) cur.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && active >= 0) {
        const cur = it[active];
        if (cur && cur.getAttribute("href")) { e.preventDefault(); cur.click(); }
        else if (cur && cur.getAttribute("data-go")) { e.preventDefault(); go(cur.getAttribute("data-go")); }
      }
    });
    function go(text) { input.value = text; closeIt(false); if (form.requestSubmit) form.requestSubmit(); else form.submit(); }

    panel.addEventListener("mousedown", e => { if (!e.target.closest(".sx-tray")) e.preventDefault(); });
    panel.addEventListener("click", e => {
      const g = e.target.closest("[data-go]");
      if (g) { e.preventDefault(); go(g.getAttribute("data-go")); return; }
      const f = e.target.closest("[data-fill]");
      if (f) { e.preventDefault(); input.value = f.getAttribute("data-fill") + " "; input.focus(); input.dispatchEvent(new Event("input", { bubbles: true })); return; }
      if (e.target.closest("[data-sx-clear]")) { e.preventDefault(); forget(); render(); return; }
      if (e.target.closest("a")) closeIt(false);
    });
    form.addEventListener("focusout", e => { if (open && !form.contains(e.relatedTarget) && e.relatedTarget !== null) closeIt(false); else if (open && e.relatedTarget === null) setTimeout(() => { if (open && !form.contains(document.activeElement)) closeIt(false); }, 120); });
    form.addEventListener("submit", () => { const q = val(); remember(q); closeIt(false); });
    const clear = form.querySelector(".sx-clear");
    if (clear) clear.addEventListener("click", e => { e.preventDefault(); input.value = ""; input.focus(); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const cam = form.querySelector(".sx-cam");
    if (cam) cam.addEventListener("click", e => { e.preventDefault(); form.dispatchEvent(new CustomEvent("jd:image-search", { bubbles: true })); });
    /* the router rewrites the box when a tab opens with ?q= */
    window.addEventListener("jd:pane:show", () => { if (open) closeIt(false); });
  }

  /* ---------- phone bar: stick to the top, widen, drop the filter button ---------- */
  function stickyPhoneBar() {
    const wrap = document.querySelector(".jd-msearch-wrap");
    const form = wrap && wrap.querySelector(".jd-msearch");
    const sentinel = wrap && wrap.querySelector(".jd-msearch-sentinel");
    if (!wrap || !form || !sentinel || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(es => {
      const e = es[es.length - 1];
      const stuck = !e.isIntersecting && e.boundingClientRect.top < 0 && phone.matches;
      form.classList.toggle("is-stuck", stuck);
      document.body.classList.toggle("sx-stuck", stuck);
    }, { threshold: [0, 1] }).observe(sentinel);
  }

  function mount() {
    JD.$$("form[data-sx]").forEach(f => { if (!f.__sx) { f.__sx = 1; Box(f); } });
    stickyPhoneBar();
  }
  JD.search = { mount, recents, remember };
  mount();
})();
