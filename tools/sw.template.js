/* ASAP service worker: makes the app installable and usable offline.
   - Install is small on purpose: only the core shell (the page, manifest, icons, Leaflet and the app scripts, about 2 MB)
     must download before a new version takes over. Everything else in PRECACHE (all of data/, the packaged map tiles, the
     big logo) is saved afterwards one file at a time ("warm"), and a file that fails is simply tried again next time. An
     all-or-nothing 18 MB install used to fail on phones, which then kept an old version for good.
   - App shell (index.html, manifest, assets/): the page network-first, the rest served cache-first from this version's
     cache, replaced when VERSION changes. VERSION is a hash of index.html, the manifest and every file under assets/, set by
     `node tools/sw_version.mjs` (Check index.html fails a PR whose VERSION is out of date), so a phone never keeps an old script.
   - Everything under data/: network-first, kept in its own cache (DATA) that survives version changes, so a connected device
     always sees the newest published data and an offline one falls back to the last copy it saw. Data files wait at most
     DATA_WAIT and the page PAGE_WAIT for the network; the network copy is still saved when the wait runs out.
   - Live feeds (ThaiWater, GISTDA) are never cached here; the page handles their failure itself.
   - Map tiles from other hosts: cached as they are viewed, capped at MAX_TILES entries. */
const VERSION = "__VERSION__";
const SHELL = "asap-shell-" + VERSION, TILES = "asap-tiles", MAX_TILES = 1500;
// A phone on a slow connection opens from its saved copies rather than waiting: feed files wait at most DATA_WAIT ms and the
// page itself PAGE_WAIT ms for the network; the network copy keeps downloading and is used on the next open.
const DATA_WAIT = 1200, PAGE_WAIT = 2500;
const PRECACHE = __PRECACHE__;
// Network-first: the page and every data file. Only data/live and the flood snapshot change between deploys (the refresh
// jobs), but briefs, layers and reference data change in ordinary merges that do not touch assets/, so all of data/ is asked for.
const FRESH = [/\/index\.html$/, /\/$/, /\/data\//];
const NEVER = [/thaiwater\.net/, /gistda\.or\.th/, /open-meteo\.com/, /gibs\.earthdata\.nasa\.gov/, /rainviewer\.com/, /nowcoast\.noaa\.gov/, /api\.weather\.gov/, /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/live-drones\//];
// Saved after install rather than during it (see the top of this file).
const LATER = [/^data\//, /^assets\/tiles-/, /^assets\/logo\.png$/, /^assets\/world-watermark\.svg$/];
const CORE = PRECACHE.filter((u) => !LATER.some((r) => r.test(u)));
const DATA = "asap-data";
const home = (u) => new URL(u, self.registration.scope).href;
const isData = (u) => /\/data\//.test(new URL(u, self.registration.scope).pathname);
const store = (u) => (isData(u) ? DATA : SHELL);
const save = (req, res) => caches.open(store(typeof req === "string" ? req : req.url)).then((c) => c.put(req, res)).catch(() => {});

self.addEventListener("install", (e) => {
  // cache: "reload" skips the browser's HTTP cache (GitHub Pages lets it keep files for 10 minutes),
  // so a new version never stores the previous deploy's files.
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
// Old version caches are dropped once this version has warmed; until then they are used only when offline.
let warming = null;
function warm() {
  if (warming) return warming;
  warming = (async () => {
    const todo = [];
    for (const u of PRECACHE) if (u !== "./" && !(await caches.open(store(u)).then((c) => c.match(home(u), { ignoreSearch: true })))) todo.push(u);
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map((u) => fetch(home(u), { cache: "no-cache", credentials: "same-origin" })
        .then((res) => { if (!res.ok) throw 0; return save(home(u), res); }).catch(() => {})));
    }
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith("asap-shell-") && k !== SHELL).map((k) => caches.delete(k)));
  })().finally(() => { warming = null; });
  return warming;
}
self.addEventListener("activate", (e) => {
  // drop data copies saved under an address with a query (?t=...) by earlier versions; the plain-address copy stays
  e.waitUntil(Promise.all([self.clients.claim(),
    caches.open(DATA).then((c) => c.keys().then((ks) => Promise.all(ks.filter((k) => new URL(k.url).search).map((k) => c.delete(k))))).catch(() => {})]));
});
// The page asks for the warm-up once it has loaded, so it never competes with the first paint.
self.addEventListener("message", (e) => { if (e.data === "warm") e.waitUntil(warm()); });
async function trim(name, max) {
  const c = await caches.open(name), ks = await c.keys();
  for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]);
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (NEVER.some((r) => r.test(url.href))) return;
  if (url.origin === location.origin && FRESH.some((r) => r.test(url.pathname))) {
    if (/\/data\//.test(url.pathname) && url.searchParams.has("fresh")) {
      // Refresh now: wait for the network copy however long it takes, and save it as the copy for the plain address
      e.respondWith(fetch(req.url, { cache: "no-store", credentials: "same-origin" }).then((res) => {
        if (res.ok) e.waitUntil(save(url.origin + url.pathname, res.clone()));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })));
      return;
    }
    // "no-cache" asks the server every time (a cheap check when nothing changed), so a new deploy shows on the next load.
    // The save is part of the event (waitUntil), so the new copy is kept even when the saved one was shown and the phone
    // would otherwise stop the worker before the download finished.
    // A data file is kept once, under its plain address: the page adds ?t=<10 minutes> to some of them, and one saved copy
    // per value used to pile up, so a slow load (served with ignoreSearch) got the OLDEST copy, days out of date.
    const key = /\/data\//.test(url.pathname) ? url.origin + url.pathname : req.url;
    const net = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
      if (res.ok) return save(key, res.clone()).then(() => res);
      return res;
    });
    e.waitUntil(net.catch(() => {}));
    const fallback = () => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html"));
    // Feed files wait at most DATA_WAIT ms and the page PAGE_WAIT ms, then use the last saved copy so the page still opens;
    // the network copy keeps downloading and is saved for the next open (or Refresh now, above).
    const wait = /\/data\//.test(url.pathname) ? DATA_WAIT : PAGE_WAIT;
    e.respondWith(Promise.race([net.catch(() => null), new Promise((r) => setTimeout(() => r(null), wait))])
      .then((res) => res || caches.match(req, { ignoreSearch: true }).then((r) => r || net)).catch(fallback));
    return;
  }
  if (url.origin === location.origin) {
    // App files: this version's copy first, then the network; an older version's copy only when the network fails.
    e.respondWith(caches.open(isData(req.url) ? DATA : SHELL).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) e.waitUntil(save(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Promise.reject(new TypeError("offline"))))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") {
      const copy = res.clone();
      e.waitUntil(caches.open(TILES).then((c) => c.put(req, copy)).then(() => trim(TILES, MAX_TILES)).catch(() => {}));
    }
    return res;
  })));
});
// Watch notifications (shown by the page): a tap focuses an open OSAP window on the hit, or opens one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope) && !/[?&]watchscan=1/.test(x.url));
    if (c) return c.focus().then((w) => (w && w.navigate ? w.navigate(url) : null)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
