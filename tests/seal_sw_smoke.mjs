// Headless check of sealed hidden-area files in the browser (sw.js unseal(), assets/osap-lock.js keepKey()): on an owner device
// that is unlocked, the service worker opens a sealed US file on its way to the page, as a fetch and as a script; the cache keeps
// only the sealed copy; Lock now, an unlock that has run out, or a key that is not an owner's leaves the file sealed (a script
// that runs nothing).
// The owner keys here are made by the test: the server swaps them into assets/osap-lock.js, so the real owners' keys are not used.
// Run from the repo root: node tests/seal_sw_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { seal, b64u } from "../tools/seal_lib.mjs";
const { subtle } = globalThis.crypto;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const pair = async () => { const k = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { pkcs8: b64u(await subtle.exportKey("pkcs8", k.privateKey)), pub: b64u(await subtle.exportKey("spki", k.publicKey)) }; };
const A = await pair(), C = await pair();
const PLAIN = 'window.SEAL_TEST={"area":"hidden","n":42};\n';
const SEALED = await seal(PLAIN, [A.pub], "data/live/sealtest/us.js");
const lockSrc = (await readFile(join(root, "assets/osap-lock.js"), "utf8")).replace(/var OWNER = \[[\s\S]*?\];/, "var OWNER = [" + JSON.stringify("osap-pub:v1:" + A.pub) + "];");
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/sealtest/us.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(SEALED); return; }
  if (path === "assets/osap-lock.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(lockSrc); return; }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
// an owner device (key A) unlocked for an hour: the lock record holds the key the page moves into IndexedDB at start
await ctx.addInitScript(([pub, pkcs8]) => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");
  localStorage.setItem("osap-lock-dev", JSON.stringify({ v: 1, cred: "t", iv: "", wrapped: "t", pub: pub }));
  localStorage.setItem("osap-lock-open", JSON.stringify({ until: Date.now() + 3600e3, key: pkcs8 })); } } catch (e) {} }, [A.pub, A.pkcs8]);
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th/timeline");
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload(); await p.evaluate(() => navigator.serviceWorker.ready);
await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
ok(await p.evaluate(() => window.OSAP_LOCK.isOpen()), "the test owner device is unlocked");
const get = () => p.evaluate(() => fetch("data/live/sealtest/us.js").then((r) => r.text().then((t) => ({ t, h: r.headers.get("X-OSAP-Unsealed") }))));
const script = () => p.evaluate(() => new Promise((res) => { delete window.SEAL_TEST; const s = document.createElement("script"); s.src = "data/live/sealtest/us.js?t=" + Math.random();
  s.onload = () => res(window.SEAL_TEST ? JSON.stringify(window.SEAL_TEST) : "nothing"); s.onerror = () => res("error"); document.head.appendChild(s); }));
const idb = (rec) => p.evaluate(([rec]) => new Promise((done) => { const o = indexedDB.open("osap-lock", 1); o.onupgradeneeded = () => o.result.createObjectStore("k");
  o.onsuccess = async () => { const db = o.result; let r = null;
    if (rec) { const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(rec.k.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      r = { key, f: rec.f, until: Date.now() + rec.ms }; }
    const tx = db.transaction("k", "readwrite"); if (r) tx.objectStore("k").put(r, "open"); else tx.objectStore("k").delete("open");
    tx.oncomplete = () => { db.close(); done(true); }; }; }), [rec]);
const stored = () => p.evaluate(() => new Promise((done) => { const o = indexedDB.open("osap-lock", 1); o.onupgradeneeded = () => o.result.createObjectStore("k");
  o.onsuccess = () => { const g = o.result.transaction("k").objectStore("k").get("open"); g.onsuccess = () => { const r = g.result; o.result.close();
    done(r ? { f: r.f, type: r.key && r.key.type, extractable: r.key && r.key.extractable, usages: r.key && r.key.usages, left: r.until - Date.now() } : null); }; }; }));

// 1. unlocked owner device: the page put a non-exportable key in IndexedDB at start; the worker opens the file
const k = await stored();
ok(k && k.type === "private" && k.extractable === false && JSON.stringify(k.usages) === '["deriveBits"]' && k.left > 3000e3, "unlock keeps a private key that cannot be exported, with its end time " + JSON.stringify(k));
const a = await get();
ok(a.t === PLAIN && a.h === "1", "unlocked: the sealed file reaches the page opened, and marked so the page does not save it");
ok(await script() === '{"area":"hidden","n":42}', "unlocked: loaded as a script, it runs");
await p.waitForTimeout(500);
const cached = await p.evaluate(() => caches.open("asap-data").then((c) => c.match(new URL("data/live/sealtest/us.js", location.href).href)).then((r) => (r ? r.text() : "")));
ok(cached.startsWith("/*osap-sealed:v1 ") && !cached.includes("SEAL_TEST"), "the cache keeps only the sealed copy");
// 2. a key that is not an owner's (labelled as one) opens nothing; the sealed text passes through unharmed
const fA = k.f;
await idb({ k: C.pkcs8, f: fA, ms: 3600e3 });
const c = await get();
ok(c.t === SEALED && !c.h, "another key, even labelled as the owner's: the file stays sealed");
ok(await script() === "nothing", "...and as a script it runs nothing");
// 3. an unlock that has run out
await idb({ k: A.pkcs8, f: fA, ms: -1000 });
ok((await get()).t === SEALED, "an unlock that has run out: sealed");
// 4. Lock now removes the key; the page reloads locked and the file stays sealed
await idb({ k: A.pkcs8, f: fA, ms: 3600e3 });
ok((await get()).t === PLAIN, "unlocked again (check)");
await p.evaluate(() => window.OSAP_LOCK.open()); await p.waitForTimeout(300);
await Promise.all([p.waitForNavigation({ timeout: 15000 }).catch(() => {}), p.click('#lockdlg [data-lk="lock"]')]);
await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
ok(!(await p.evaluate(() => window.OSAP_LOCK.isOpen())) && (await stored()) === null, "Lock now: locked, and the key is gone from IndexedDB");
ok((await get()).t === SEALED && (await script()) === "nothing", "locked: the file stays sealed and runs nothing");
ok(errors.length === 0, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
