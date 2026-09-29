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
const VERSION = "e24463629bcf";
const SHELL = "asap-shell-" + VERSION, TILES = "asap-tiles", MAX_TILES = 1500;
// A phone on a slow connection opens from its saved copies rather than waiting: feed files wait at most DATA_WAIT ms and the
// page itself PAGE_WAIT ms for the network; the network copy keeps downloading and is used on the next open.
const DATA_WAIT = 1200, PAGE_WAIT = 2500;
const PRECACHE = [
"./",
"index.html",
"manifest.webmanifest",
"data/thailand/power.js",
"data/thailand/flood-live-snapshot.js",
"data/thailand/flood-exposure.js",
"data/thailand/province-alerts.js",
"data/thailand/border-geometry.js",
"data/thailand/border-conflict.js",
"data/layers/th/insurgency.js",
"data/layers/th/crime.js",
"data/layers/th/scam.js",
"data/layers/th/aml.js",
"data/layers/th/weather.js",
"data/layers/th/safety.js",
"data/layers/th/transport.js",
"data/layers/th/infra.js",
"data/layers/th/health.js",
"data/layers/au/weather.js",
"data/layers/au/flood.js",
"data/layers/au/safety.js",
"data/layers/au/health.js",
"data/layers/au/crime.js",
"data/layers/au/insurgency.js",
"data/layers/au/aml.js",
"data/layers/au/border.js",
"data/layers/au/transport.js",
"data/layers/au/scam.js",
"data/layers/au/infra.js",
"data/layers/bd/health.js",
"data/layers/bd/insurgency.js",
"data/layers/bd/transport.js",
"data/layers/bd/border.js",
"data/layers/bd/safety.js",
"data/layers/bd/crime.js",
"data/layers/bd/infra.js",
"data/layers/bd/weather.js",
"data/layers/bd/aml.js",
"data/layers/bd/flood.js",
"data/layers/bd/scam.js",
"data/layers/bn/flood.js",
"data/layers/bn/transport.js",
"data/layers/bn/infra.js",
"data/layers/bn/aml.js",
"data/layers/bn/scam.js",
"data/layers/bn/safety.js",
"data/layers/bn/health.js",
"data/layers/bn/weather.js",
"data/layers/bn/crime.js",
"data/layers/bn/border.js",
"data/layers/bt/safety.js",
"data/layers/bt/infra.js",
"data/layers/bt/transport.js",
"data/layers/bt/flood.js",
"data/layers/bt/weather.js",
"data/layers/bt/crime.js",
"data/layers/bt/scam.js",
"data/layers/bt/health.js",
"data/layers/bt/border.js",
"data/layers/cn/scam.js",
"data/layers/cn/border.js",
"data/layers/cn/aml.js",
"data/layers/cn/crime.js",
"data/layers/cn/safety.js",
"data/layers/cn/weather.js",
"data/layers/cn/flood.js",
"data/layers/cn/infra.js",
"data/layers/cn/health.js",
"data/layers/cn/transport.js",
"data/layers/id/flood.js",
"data/layers/id/aml.js",
"data/layers/id/crime.js",
"data/layers/id/safety.js",
"data/layers/id/insurgency.js",
"data/layers/id/weather.js",
"data/layers/id/scam.js",
"data/layers/id/infra.js",
"data/layers/id/health.js",
"data/layers/id/border.js",
"data/layers/id/transport.js",
"data/layers/in/health.js",
"data/layers/in/scam.js",
"data/layers/in/transport.js",
"data/layers/in/border.js",
"data/layers/in/insurgency.js",
"data/layers/in/aml.js",
"data/layers/in/crime.js",
"data/layers/in/safety.js",
"data/layers/in/weather.js",
"data/layers/in/infra.js",
"data/layers/in/flood.js",
"data/layers/jp/health.js",
"data/layers/jp/border.js",
"data/layers/jp/aml.js",
"data/layers/jp/scam.js",
"data/layers/jp/infra.js",
"data/layers/jp/weather.js",
"data/layers/jp/safety.js",
"data/layers/jp/transport.js",
"data/layers/jp/crime.js",
"data/layers/jp/flood.js",
"data/layers/kh/border.js",
"data/layers/kh/aml.js",
"data/layers/kh/health.js",
"data/layers/kh/safety.js",
"data/layers/kh/transport.js",
"data/layers/kh/flood.js",
"data/layers/kh/scam.js",
"data/layers/kh/infra.js",
"data/layers/kh/weather.js",
"data/layers/kh/crime.js",
"data/layers/kp/border.js",
"data/layers/kp/weather.js",
"data/layers/kp/health.js",
"data/layers/kp/scam.js",
"data/layers/kp/flood.js",
"data/layers/kp/crime.js",
"data/layers/kp/aml.js",
"data/layers/kp/safety.js",
"data/layers/kp/transport.js",
"data/layers/kp/infra.js",
"data/layers/kr/transport.js",
"data/layers/kr/border.js",
"data/layers/kr/safety.js",
"data/layers/kr/aml.js",
"data/layers/kr/scam.js",
"data/layers/kr/crime.js",
"data/layers/kr/health.js",
"data/layers/kr/weather.js",
"data/layers/kr/infra.js",
"data/layers/kr/flood.js",
"data/layers/la/safety.js",
"data/layers/la/transport.js",
"data/layers/la/scam.js",
"data/layers/la/aml.js",
"data/layers/la/health.js",
"data/layers/la/infra.js",
"data/layers/la/crime.js",
"data/layers/la/weather.js",
"data/layers/la/flood.js",
"data/layers/la/border.js",
"data/layers/lk/aml.js",
"data/layers/lk/border.js",
"data/layers/lk/crime.js",
"data/layers/lk/health.js",
"data/layers/lk/scam.js",
"data/layers/lk/infra.js",
"data/layers/lk/weather.js",
"data/layers/lk/transport.js",
"data/layers/lk/safety.js",
"data/layers/lk/flood.js",
"data/layers/lk/insurgency.js",
"data/layers/mm/crime.js",
"data/layers/mm/insurgency.js",
"data/layers/mm/aml.js",
"data/layers/mm/infra.js",
"data/layers/mm/weather.js",
"data/layers/mm/health.js",
"data/layers/mm/safety.js",
"data/layers/mm/transport.js",
"data/layers/mm/flood.js",
"data/layers/mm/scam.js",
"data/layers/mm/border.js",
"data/layers/mn/aml.js",
"data/layers/mn/safety.js",
"data/layers/mn/weather.js",
"data/layers/mn/crime.js",
"data/layers/mn/border.js",
"data/layers/mn/health.js",
"data/layers/mn/transport.js",
"data/layers/mn/infra.js",
"data/layers/mn/scam.js",
"data/layers/mn/flood.js",
"data/layers/mv/health.js",
"data/layers/mv/transport.js",
"data/layers/mv/safety.js",
"data/layers/mv/weather.js",
"data/layers/mv/aml.js",
"data/layers/mv/flood.js",
"data/layers/mv/border.js",
"data/layers/mv/infra.js",
"data/layers/mv/crime.js",
"data/layers/mv/scam.js",
"data/layers/mv/insurgency.js",
"data/layers/my/safety.js",
"data/layers/my/infra.js",
"data/layers/my/flood.js",
"data/layers/my/weather.js",
"data/layers/my/transport.js",
"data/layers/my/aml.js",
"data/layers/my/health.js",
"data/layers/my/scam.js",
"data/layers/my/crime.js",
"data/layers/my/border.js",
"data/layers/my/insurgency.js",
"data/layers/np/scam.js",
"data/layers/np/transport.js",
"data/layers/np/border.js",
"data/layers/np/crime.js",
"data/layers/np/health.js",
"data/layers/np/aml.js",
"data/layers/np/weather.js",
"data/layers/np/flood.js",
"data/layers/np/safety.js",
"data/layers/np/infra.js",
"data/layers/np/insurgency.js",
"data/layers/nz/crime.js",
"data/layers/nz/safety.js",
"data/layers/nz/flood.js",
"data/layers/nz/weather.js",
"data/layers/nz/scam.js",
"data/layers/nz/infra.js",
"data/layers/nz/transport.js",
"data/layers/nz/health.js",
"data/layers/nz/border.js",
"data/layers/nz/aml.js",
"data/layers/nz/insurgency.js",
"data/layers/oki/border.js",
"data/layers/oki/crime.js",
"data/layers/oki/infra.js",
"data/layers/oki/scam.js",
"data/layers/oki/aml.js",
"data/layers/oki/transport.js",
"data/layers/oki/safety.js",
"data/layers/oki/health.js",
"data/layers/oki/weather.js",
"data/layers/oki/flood.js",
"data/layers/pg/aml.js",
"data/layers/pg/insurgency.js",
"data/layers/pg/border.js",
"data/layers/pg/weather.js",
"data/layers/pg/flood.js",
"data/layers/pg/safety.js",
"data/layers/pg/health.js",
"data/layers/pg/infra.js",
"data/layers/pg/transport.js",
"data/layers/pg/crime.js",
"data/layers/pg/scam.js",
"data/layers/ph/border.js",
"data/layers/ph/transport.js",
"data/layers/ph/insurgency.js",
"data/layers/ph/flood.js",
"data/layers/ph/scam.js",
"data/layers/ph/aml.js",
"data/layers/ph/safety.js",
"data/layers/ph/crime.js",
"data/layers/ph/health.js",
"data/layers/ph/infra.js",
"data/layers/ph/weather.js",
"data/layers/pk/transport.js",
"data/layers/pk/insurgency.js",
"data/layers/pk/safety.js",
"data/layers/pk/border.js",
"data/layers/pk/crime.js",
"data/layers/pk/infra.js",
"data/layers/pk/aml.js",
"data/layers/pk/health.js",
"data/layers/pk/weather.js",
"data/layers/pk/flood.js",
"data/layers/pk/scam.js",
"data/layers/sg/weather.js",
"data/layers/sg/safety.js",
"data/layers/sg/insurgency.js",
"data/layers/sg/scam.js",
"data/layers/sg/infra.js",
"data/layers/sg/flood.js",
"data/layers/sg/crime.js",
"data/layers/sg/aml.js",
"data/layers/sg/border.js",
"data/layers/sg/transport.js",
"data/layers/sg/health.js",
"data/layers/tl/health.js",
"data/layers/tl/infra.js",
"data/layers/tl/crime.js",
"data/layers/tl/flood.js",
"data/layers/tl/transport.js",
"data/layers/tl/scam.js",
"data/layers/tl/border.js",
"data/layers/tl/weather.js",
"data/layers/tl/aml.js",
"data/layers/tl/safety.js",
"data/layers/tl/insurgency.js",
"data/layers/tw/border.js",
"data/layers/tw/safety.js",
"data/layers/tw/health.js",
"data/layers/tw/aml.js",
"data/layers/tw/flood.js",
"data/layers/tw/infra.js",
"data/layers/tw/transport.js",
"data/layers/tw/scam.js",
"data/layers/tw/weather.js",
"data/layers/tw/crime.js",
"data/layers/vn/health.js",
"data/layers/vn/scam.js",
"data/layers/vn/crime.js",
"data/layers/vn/border.js",
"data/layers/vn/aml.js",
"data/layers/vn/weather.js",
"data/layers/vn/infra.js",
"data/layers/vn/transport.js",
"data/layers/vn/safety.js",
"data/layers/vn/flood.js",
"data/sof/au.js",
"data/sof/bd.js",
"data/sof/bn.js",
"data/sof/bt.js",
"data/sof/cn.js",
"data/sof/id.js",
"data/sof/in.js",
"data/sof/jp.js",
"data/sof/kh.js",
"data/sof/kp.js",
"data/sof/kr.js",
"data/sof/la.js",
"data/sof/lk.js",
"data/sof/mm.js",
"data/sof/mn.js",
"data/sof/mv.js",
"data/sof/my.js",
"data/sof/np.js",
"data/sof/nz.js",
"data/sof/oki.js",
"data/sof/pg.js",
"data/sof/ph.js",
"data/sof/pk.js",
"data/sof/sg.js",
"data/sof/th.js",
"data/sof/tl.js",
"data/sof/tw.js",
"data/sof/vn.js",
"data/brief/au.js",
"data/brief/bd.js",
"data/brief/bn.js",
"data/brief/bt.js",
"data/brief/cn.js",
"data/brief/id.js",
"data/brief/in.js",
"data/brief/jp.js",
"data/brief/kh.js",
"data/brief/kp.js",
"data/brief/kr.js",
"data/brief/la.js",
"data/brief/lk.js",
"data/brief/mm.js",
"data/brief/mn.js",
"data/brief/mv.js",
"data/brief/my.js",
"data/brief/np.js",
"data/brief/nz.js",
"data/brief/oki.js",
"data/brief/pg.js",
"data/brief/ph.js",
"data/brief/pk.js",
"data/brief/sg.js",
"data/brief/th.js",
"data/brief/tl.js",
"data/brief/tw.js",
"data/brief/vn.js",
"data/sof/exercises-outside.js",
"data/live/quakes.js",
"data/live/air-quality.js",
"data/live/gdacs.js",
"data/live/reliefweb.js",
"data/live/warnings.js",
"data/live/advisories.js",
"data/live/tsunami.js",
"data/live/volcano.js",
"data/live/outages.js",
"data/live/outbreaks.js",
"data/live/maritime.js",
"data/live/sanctions.js",
"data/live/displacement.js",
"data/live/national-quakes.js",
"data/live/eonet.js",
"data/live/ifrc.js",
"data/live/cdc.js",
"data/live/navwarnings.js",
"data/live/ucdp.js",
"data/live/deepsouth.js",
"data/live/storms.js",
"data/live/wx-forecast.js",
"data/live/roads.js",
"data/basemap/country-outlines.js",
"data/basemap/world-countries.js",
"data/basemap/world-outlines.js",
"assets/icons/apple-touch-icon.png",
"assets/icons/icon-192.png",
"assets/icons/icon-512.png",
"assets/icons/maskable-512.png",
"assets/logo-mark.png",
"assets/logo.png",
"assets/osap-cf-iran.js",
"assets/osap-conflicts.js",
"assets/osap-cf-russia-ukraine.js",
"assets/osap-cf-thailand.js",
"assets/osap-cf-history.js",
"assets/osap-evsum.js",
"assets/osap-share.js",
"assets/osap-push.js",
"assets/osap-health.js",
"assets/osap-start.js",
"assets/osap-symbols.js",
"assets/osap-tlreport.js",
"assets/osap-areasum.js",
"assets/osap-aoi.js",
"assets/osap-viewrep.js",
"assets/osap-et.js",
"assets/osap-geo.js",
"assets/osap-measure.js",
"assets/osap-route.js",
"assets/osap-today.js",
"assets/osap-weather.js",
"assets/osap-work.js",
"assets/world-watermark.svg",
"assets/tiles-base-dark.js",
"assets/tiles-base.js",
"assets/tiles-flood.js",
"assets/tiles-flood25.js",
"assets/vendor/leaflet-1.9.4.js"
];
// Network-first: the page and every data file. Only data/live and the flood snapshot change between deploys (the refresh
// jobs), but briefs, layers and reference data change in ordinary merges that do not touch assets/, so all of data/ is asked for.
const FRESH = [/\/index\.html$/, /\/$/, /\/data\//];
const NEVER = [/thaiwater\.net/, /gistda\.or\.th/, /open-meteo\.com/, /gibs\.earthdata\.nasa\.gov/, /rainviewer\.com/, /nowcoast\.noaa\.gov/, /api\.weather\.gov/];
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
  e.waitUntil(self.clients.claim());
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
    const net = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
      if (res.ok) return save(req.url, res.clone()).then(() => res);
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
