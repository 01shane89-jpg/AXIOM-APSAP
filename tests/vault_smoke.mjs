// Headless check of Lock my saved work (assets/osap-vault.js), with a passphrase (the passkey path uses the same data key).
// 1. Settings lists it; set up with a passphrase.
// 2. Lock now: after the reload the lock screen is up and no saved work is left in plain storage: no localStorage value, no
//    photo or sync database, no saved data-file cache; the encrypted copies are there.
// 3. A wrong passphrase changes nothing; the right one brings back every key and the photo byte for byte, and the app
//    opens with them.
// 4. A lock cut short (keys set aside, page closed) is finished at the next open; nothing is lost.
// 5. Locks by itself at the next open after the chosen time away.
// 6. Turn off keeps the saved work, plain.
// Run from the repo root: node tests/vault_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".woff2": "font/woff2" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/blank.html") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>blank</title>"); return; }
  const path = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x).slice(0, 300) : "")); if (!c) fails++; }
const PASS = "correct horse battery";
/* waits through the reload a lock ends with, for the lock screen asking for the passphrase */
async function waitLocked(pg) {
  for (let i = 0; i < 80; i++) {
    try { if (await pg.evaluate(() => window.OSAP_VAULT && window.OSAP_VAULT.state() === "locked" && !!document.getElementById("vault-pass"))) return true; } catch (e) { /* navigating */ }
    await pg.waitForTimeout(500);
  }
  return false;
}
async function waitOpen(pg) {
  for (let i = 0; i < 120; i++) {
    try { if (await pg.evaluate(() => !!(window.TSAP && window.OSAP_VAULT && window.OSAP_VAULT.state() === "open" && !document.getElementById("vaultscr")))) return true; } catch (e) { /* navigating */ }
    await pg.waitForTimeout(500);
  }
  return false;
}

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 860 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (x) => errors.push(x.message));
/* what this origin keeps, read from a page with no OSAP script */
async function kept() {
  const q = await ctx.newPage(); await q.goto(base + "blank.html");
  const r = await q.evaluate(async () => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    let photo = null;
    if (dbs.includes("osap-points")) photo = await new Promise((ok) => { const r = indexedDB.open("osap-points"); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains("photos")) { d.close(); return ok(null); } const g = d.transaction("photos").objectStore("photos").get("ph1"); g.onsuccess = () => { d.close(); ok(g.result ? Array.from(new Uint8Array(g.result.buf)) : null); }; }; r.onerror = () => ok(null); });
    const seenData = await caches.match("/data/live/news/th.js").then((r) => (r ? r.text() : ""));
    return { ls, dbs, photo, caches: await caches.keys(), seenData };
  });
  await q.close(); return r;
}
/* the app tidies some stores when it opens (watches gain fields), so those are compared by what they hold */
const same = (k, x) => Object.keys(SEED).every((key) => (key === "asap-watches" ? /ZQXWATCH/.test(k.ls[key] || "") : k.ls[key] === SEED[key]));
const SEED = { "osap-atak-pts": JSON.stringify([{ id: "pzq1", cc: "th", lat: 13.75, lon: 100.5, n: "ZQXPOINT", note: "ZQXNOTE" }]), "osap-routes": JSON.stringify([{ id: "r1", name: "ZQXROUTE", wps: [] }]),
  "asap-watches": JSON.stringify([{ id: "wz1", name: "ZQXWATCH", cc: "th", layers: [], kw: [], minSev: 1, on: true }]), "osap-sync": JSON.stringify({ code: "ZQXSYNCCODE" }), "osap-home": "\"map\"" };

// ---------- 1. set up ----------
await p.goto(base + "blank.html");
await p.evaluate(async (seed) => {
  for (const k of Object.keys(seed)) localStorage.setItem(k, seed[k]);
  await new Promise((ok, no) => { const r = indexedDB.open("osap-points", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid");
    r.onsuccess = () => { const t = r.result.transaction("photos", "readwrite"); t.objectStore("photos").put({ id: "ph1", pid: "pzq1", buf: new Uint8Array([90, 81, 88, 1, 2, 3, 250]).buffer, type: "image/jpeg", name: "ZQXPHOTO.jpg", added: 1 }); t.oncomplete = () => { r.result.close(); ok(); }; }; r.onerror = no; });
  await new Promise((ok, no) => { const r = indexedDB.open("osap-sync", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { const t = r.result.transaction("kv", "readwrite"); t.objectStore("kv").put({ M: { note: "ZQXSYNCED" } }, "state"); t.oncomplete = () => { r.result.close(); ok(); }; }; r.onerror = no; });
  await (await caches.open("asap-data")).put("/data/live/news/th.js", new Response("ZQXVIEWED"));
  await (await caches.open("osap-offline")).put("/zqx-offline-tile.png", new Response("tile"));
}, SEED);
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_VAULT && window.TSAP && document.getElementById("tidy-set"), null, { timeout: 60000 }); await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById("tidy-set").click()); await p.waitForTimeout(300);
ok(await p.evaluate(() => !!document.querySelector('[data-tp="@vault"]')), "Settings lists Lock my saved work");
await p.evaluate(() => document.querySelector('[data-tp="@vault"]').click()); await p.waitForTimeout(400);
await p.fill("#vault-p1", PASS); await p.fill("#vault-p2", PASS); await p.selectOption("#vault-auto", "0");
await p.evaluate(() => document.querySelector('#vaultdlg [data-v="pass"]').click());
await p.waitForFunction(() => window.OSAP_VAULT.state() === "open", null, { timeout: 20000 }).catch(() => {});
ok(await p.evaluate(() => window.OSAP_VAULT.state() === "open"), "set up with a passphrase");
ok(await p.evaluate(() => !/ZQX|correct horse/.test(localStorage.getItem("osap-vault"))), "the lock's settings hold neither saved work nor the passphrase");

// ---------- 2. lock ----------
await Promise.all([p.waitForEvent("load", { timeout: 30000 }).catch(() => {}), p.evaluate(() => document.querySelector('#vaultdlg [data-v="lock"]').click())]);
await p.waitForFunction(() => document.getElementById("vaultscr") && /locked/.test(document.getElementById("vaultscr").textContent), null, { timeout: 30000 }).catch(() => {});
ok(await p.evaluate(() => !!document.getElementById("vaultscr") && !!document.getElementById("vault-pass")), "after Lock now the lock screen is up, asking for the passphrase");
await p.waitForTimeout(1500);
let k = await kept();
const plainHits = Object.entries(k.ls).filter(([, v]) => /ZQX/.test(v || "")).map(([x]) => x);
ok(!plainHits.length, "no localStorage value holds saved work", plainHits);
ok(!Object.keys(k.ls).some((x) => x.startsWith("~v~")), "nothing is left set aside");
ok(k.photo == null, "the photo is not in plain storage", k.dbs);
ok(!k.dbs.includes("osap-sync") || true, "the sync copy database is sealed (checked below)");
ok(!/ZQXVIEWED/.test(k.seenData), "the saved copies of viewed data are cleared", k.seenData);
ok(k.caches.includes("osap-offline"), "maps saved for offline use are kept", k.caches);
ok(k.ls["osap-home"] === "\"map\"", "device settings stay as they were");
const vault = await p.evaluate(async () => new Promise((ok) => { const r = indexedDB.open("osap-vault"); r.onsuccess = () => { const g = r.result.transaction("box").objectStore("box").getAllKeys(); g.onsuccess = () => ok(g.result); }; }));
ok(vault.includes("ls") && vault.includes("db:osap-points") && vault.includes("db:osap-sync"), "the encrypted copies are there", vault);
const syncPlain = await p.evaluate(async () => new Promise((ok) => { indexedDB.databases().then((a) => { if (!a.some((d) => d.name === "osap-sync")) return ok(null);
  const r = indexedDB.open("osap-sync"); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains("kv")) return ok(null); const g = d.transaction("kv").objectStore("kv").get("state"); g.onsuccess = () => ok(JSON.stringify(g.result || null)); }; }); }));
ok(!/ZQX/.test(syncPlain || ""), "the sync copy is not in plain storage");
const boxText = await p.evaluate(async () => new Promise((ok) => { const r = indexedDB.open("osap-vault"); r.onsuccess = () => { const g = r.result.transaction("box").objectStore("box").get("ls"); g.onsuccess = () => ok(new TextDecoder().decode(g.result.ct)); }; }));
// whole markers only: the ciphertext is random bytes, so a 3-letter "ZQX" turns up in it now and then by chance
ok(!/ZQX(POINT|NOTE|ROUTE|WATCH|SYNCCODE)/.test(boxText), "the encrypted copy does not read as plain text");

// ---------- 3. unlock ----------
await p.fill("#vault-pass", "wrong passphrase!!"); await p.evaluate(() => document.querySelector("#vaultscr button").click());
await p.waitForFunction(() => /not the one/.test(document.getElementById("vaultscr").textContent), null, { timeout: 30000 }).catch(() => {});
ok(/not the one/.test(await p.evaluate(() => document.getElementById("vaultscr").textContent)), "a wrong passphrase is refused plainly");
k = await kept();
ok(!Object.values(k.ls).some((v) => /ZQX/.test(v || "")) && k.photo == null, "and changes nothing");
await p.fill("#vault-pass", PASS);
await Promise.all([p.waitForEvent("load", { timeout: 40000 }).catch(() => {}), p.evaluate(() => document.querySelector("#vaultscr button").click())]);
ok(await waitOpen(p), "the right passphrase unlocks and the app opens"); await p.waitForTimeout(1000);
k = await kept();
ok(same(k), "every saved key is back exactly", Object.keys(SEED).filter((x) => k.ls[x] !== SEED[x]));
ok(JSON.stringify(k.photo) === JSON.stringify([90, 81, 88, 1, 2, 3, 250]), "the photo is back byte for byte", k.photo);
ok(await p.evaluate(() => (window.OSAP_ATAK && window.OSAP_ATAK.points ? window.OSAP_ATAK.points().length : JSON.parse(localStorage.getItem("osap-atak-pts")).length) === 1), "the map point is there for the app");
const idx = await p.evaluate(async () => new Promise((ok) => { const r = indexedDB.open("osap-points"); r.onsuccess = () => { const s = r.result.transaction("photos").objectStore("photos"); ok({ kp: s.keyPath, ix: [...s.indexNames] }); }; }));
ok(idx.kp === "id" && idx.ix.includes("pid"), "the photo database keeps its key and index", idx);
const syncBack = await p.evaluate(async () => new Promise((ok) => { const r = indexedDB.open("osap-sync"); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("state"); g.onsuccess = () => ok(JSON.stringify(g.result)); }; }));
ok(/ZQXSYNCED/.test(syncBack || ""), "the sync copy is back");

// ---------- 4. a lock cut short ----------
await p.evaluate(() => { const v = localStorage.getItem("osap-atak-pts"); localStorage.setItem("~v~osap-atak-pts", v); localStorage.removeItem("osap-atak-pts");
  const c = JSON.parse(localStorage.getItem("osap-vault")); c.state = "locking"; localStorage.setItem("osap-vault", JSON.stringify(c)); });
await p.goto(base, { waitUntil: "domcontentloaded" });
const cut = await waitLocked(p);
k = await kept();
ok(cut, "a lock cut short is finished at the next open");
ok(!Object.values(k.ls).some((v) => /ZQX/.test(v || "")) && !Object.keys(k.ls).some((x) => x.startsWith("~v~")), "with nothing left in plain storage");
await p.waitForSelector("#vault-pass", { timeout: 20000 });
await p.fill("#vault-pass", PASS);
await Promise.all([p.waitForEvent("load", { timeout: 40000 }).catch(() => {}), p.evaluate(() => document.querySelector("#vaultscr button").click())]);
await waitOpen(p);
k = await kept();
ok(same(k) && k.photo && k.photo.length === 7, "and unlocking brings everything back", Object.keys(SEED).filter((x) => k.ls[x] !== SEED[x]));

// ---------- 5. locks by itself after the time away ----------
/* the last time OSAP was seen is set from another page, after this one has gone (leaving a page marks it seen) */
await p.evaluate(() => window.OSAP_VAULT.setAuto(15));
await p.goto(base + "blank.html");
await p.evaluate(() => localStorage.setItem("osap-vault-away", String(Date.now() - 20 * 60000)));
await p.goto(base, { waitUntil: "domcontentloaded" });
ok(await waitLocked(p), "opening OSAP after 20 minutes away (lock after 15) finds it locked");
k = await kept();
ok(!Object.values(k.ls).some((v) => /ZQX/.test(v || "")), "and saved work is not in plain storage");
await p.waitForSelector("#vault-pass", { timeout: 20000 });
await p.fill("#vault-pass", PASS);
await Promise.all([p.waitForEvent("load", { timeout: 40000 }).catch(() => {}), p.evaluate(() => document.querySelector("#vaultscr button").click())]);
ok(await waitOpen(p), "and unlocks again");

// ---------- 6. turn off ----------
await p.evaluate(() => window.OSAP_VAULT.off());
k = await kept();
ok(!k.ls["osap-vault"] && same(k), "Turn off keeps the saved work, plain, and removes the lock");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
