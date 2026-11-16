/* JulaDirect service worker: conservative app shell.
   - HTML pages and css/js: network first, so a new deploy is never masked by a
     stale copy; the cache is only the offline fallback.
   - Images and fonts: cache first, refreshed in the background.
   - Never touches cross-origin requests (Supabase, payments, image CDNs),
     non-GET requests, or anything under /api. Bump VERSION to invalidate.
   To remove it, deploy a sw.js that calls self.registration.unregister(). */
const VERSION = "jd-v2-1";
const PAGES = VERSION + "-pages";
const STATIC = VERSION + "-static";
const OFFLINE = "/offline.html";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(PAGES).then(c => c.add(OFFLINE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.indexOf(VERSION) !== 0) await caches.delete(k);
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout")), ms); promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });
}
async function networkFirst(event, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(event.request), ms);
    if (res && res.ok && res.type === "basic") event.waitUntil(cache.put(event.request, res.clone()));
    return res;
  } catch (err) {
    const hit = await cache.match(event.request);
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(event) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request).then(res => { if (res && res.ok) cache.put(event.request, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(refresh); return hit; }
  return (await refresh) || Response.error();
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(event, PAGES, 4000).catch(async () => {
      const c = await caches.open(PAGES);
      return (await c.match(OFFLINE)) || new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }));
    return;
  }
  if (/^\/(css|js)\//.test(url.pathname)) { event.respondWith(networkFirst(event, STATIC, 2500).catch(() => Response.error())); return; }
  if (/\.(?:svg|png|jpe?g|webp|gif|ico|woff2?)$/i.test(url.pathname) || url.pathname === "/manifest.webmanifest") { event.respondWith(cacheFirst(event)); }
});
