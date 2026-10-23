// Headless check of the panic wipe (assets/osap-wipe.js, netlify/functions/osap-wipe.mjs).
// 1. Opening OSAP with #panic shows the confirm screen and erases nothing; Cancel closes it, keeps everything and tidies the
//    address. Settings has "Erase this device", which opens the same screen.
// 2. "Erase now" removes every localStorage and sessionStorage key, every IndexedDB database, every cache, the service worker
//    and the cookies, and leaves a blank page.
// 3. The server half answers only a POST with its header, and then with Clear-Site-Data.
// Run from the repo root: node tests/wipe_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import wipeFn from "../netlify/functions/osap-wipe.mjs";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".woff2": "font/woff2" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  /* a page with no OSAP script on it, to look at what this origin still keeps after the wipe */
  if (path === "blank.html") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>blank</title>"); return; }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const p = await ctx.newPage();
const errors = []; p.on("pageerror", (x) => errors.push(x.message));
/* what this origin keeps, read from the blank page */
async function kept(pg) {
  return pg.evaluate(async () => {
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
    const regs = navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0;
    return { ls: Object.keys(localStorage), ss: Object.keys(sessionStorage), dbs, caches: await caches.keys(), regs, cookie: document.cookie };
  });
}
/* the app's own stores, as a user would have them */
await p.goto(base + "blank.html");
await p.evaluate(async () => {
  localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "pzq1", cc: "th", lat: 13.75, lon: 100.5, n: "ZQXPOINT" }]));
  localStorage.setItem("osap-sync", "ZQXSYNCCODE"); localStorage.setItem("osap-auth", JSON.stringify({ access_token: "x" }));
  sessionStorage.setItem("osap-rt-link", "ZQX");
  document.cookie = "nf_jwt=ZQXTOKEN; path=/";
  await new Promise((ok, no) => { const r = indexedDB.open("osap-points", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" });
    r.onsuccess = () => { const t = r.result.transaction("photos", "readwrite"); t.objectStore("photos").put({ id: "ph1", buf: new ArrayBuffer(8) }); t.oncomplete = () => { r.result.close(); ok(); }; }; r.onerror = no; });
  await (await caches.open("osap-offline")).put("/zqx-tile.png", new Response("tile"));
});

// ---------- 1. #panic asks first; Cancel keeps everything ----------
await p.goto(base + "#panic", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_WIPE && document.getElementById("wipedlg") && !document.getElementById("wipedlg").hidden, null, { timeout: 30000 });
ok(true, "#panic opens the confirm screen");
ok(await p.evaluate(() => !!localStorage.getItem("osap-atak-pts")), "opening #panic alone erases nothing");
await p.waitForFunction(() => window.TSAP, null, { timeout: 60000 }); await p.waitForTimeout(2000);
ok(await p.evaluate(() => !document.getElementById("wipedlg").hidden), "the confirm screen stays up while the app loads behind it");
await p.click('[data-wipe="no"]');
ok(await p.evaluate(() => document.getElementById("wipedlg").hidden), "Cancel closes it");
ok(await p.evaluate(() => !/panic/.test(location.hash)), "Cancel takes #panic off the address");
ok(await p.evaluate(() => !!localStorage.getItem("osap-atak-pts") && !!localStorage.getItem("osap-sync")), "Cancel keeps the saved data");
await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then((r) => r.length > 0), null, { timeout: 30000 }).catch(() => {});
const before = await kept(p);
ok(before.regs > 0, "the service worker is installed before the wipe (" + before.regs + ")");
/* Settings has the entry */
const inSettings = await p.evaluate(() => {
  const b = document.getElementById("tidy-set");
  if (b) b.click();
  return new Promise((r) => setTimeout(() => { const w = document.querySelector('[data-tp="@wipe"]'); if (w) w.click(); r(!!w); }, 500));
});
ok(inSettings, "Settings lists Erase this device");
if (inSettings) ok(await p.evaluate(() => !document.getElementById("wipedlg").hidden), "Erase this device opens the confirm screen");

// ---------- 2. Erase now ----------
await p.evaluate(() => window.OSAP_WIPE.open());
await Promise.all([p.waitForURL("about:blank", { timeout: 20000 }).catch(() => {}), p.click('[data-wipe="go"]')]);
ok(p.url() === "about:blank", "the page is left blank (" + p.url() + ")");
const q = await ctx.newPage();
await q.goto(base + "blank.html");
const after = await kept(q);
ok(!after.ls.length, "no localStorage key is left (" + after.ls.join(",") + ")");
ok(!after.ss.length, "no sessionStorage key is left");
ok(!after.dbs.length, "no IndexedDB database is left (" + after.dbs.join(",") + ")");
ok(!after.caches.length, "no cache is left (" + after.caches.join(",") + ")");
ok(after.regs === 0, "the service worker is gone");
ok(!/nf_jwt|ZQX/.test(after.cookie), "the sign-in cookie is gone");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await ctx.close();

// ---------- 3. the server half ----------
const r1 = await wipeFn(new Request("https://x/api/osap-wipe", { method: "GET" }));
ok(r1.status === 404 && !r1.headers.get("clear-site-data"), "GET is not answered with a clear");
const r2 = await wipeFn(new Request("https://x/api/osap-wipe", { method: "POST" }));
ok(r2.status === 404 && !r2.headers.get("clear-site-data"), "a POST without the header (another site's form) is not answered with a clear");
const r3 = await wipeFn(new Request("https://x/api/osap-wipe", { method: "POST", headers: { "x-osap-wipe": "1" } }));
ok(r3.status === 204 && /"storage"/.test(r3.headers.get("clear-site-data") || "") && /"cache"/.test(r3.headers.get("clear-site-data")) && /"cookies"/.test(r3.headers.get("clear-site-data")), "the page's POST gets Clear-Site-Data for storage, cache and cookies");

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
