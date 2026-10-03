// Headless check of Move to another device (assets/osap-move.js), with two browser profiles standing in for two devices:
// the gear lists it; device A's points, photo, areas, workspaces, watches, med plan and settings go into one locked file
// (not readable as text, caches and device-only stores left out); a wrong passphrase and a damaged file are refused with
// nothing changed; device B brings it in through the panel, its own data is replaced and the photo matches byte for byte;
// "Put back what was here before" restores B's own data and removes the imported photo; a file that names stores outside
// OSAP's or carries a non-image "photo" has those parts dropped; the panel fits a phone.
// Run from the repo root: node tests/move_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
async function ready(p) { await p.waitForFunction(() => window.OSAP_MOVE && window.OSAP_WS && window.__asapMap, null, { timeout: 30000 }); await p.waitForTimeout(600); }
async function device(seed, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1200, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript((S) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); for (const k in S) localStorage.setItem(k, S[k]); } }, seed);
  await p.goto(base + "#th/map"); await ready(p);
  return { ctx, p, errs };
}
const PTS_A = JSON.stringify([{ id: "pt-a1", n: "Alpha CP", lat: 6.54, lon: 101.25, cc: "th", note: "gate", ph: 1 }, { id: "pt-a2", n: "Bravo", lat: 6.6, lon: 101.3, cc: "th" }]);
const SEED_A = {
  "osap-atak-pts": PTS_A, "asap-area-th": JSON.stringify([[6, 101], [6, 101.5], [6.5, 101.5], [6.5, 101]]),
  "asap-watches": JSON.stringify([{ id: "w1", name: "IED route watch", kw: ["ied"], cc: "th" }]), "osap-medplan-th": JSON.stringify({ v: 1, name: "Plan A" }),
  "osap-meas-unit": "nm", "tfw-theme": "dark",
  "asap-xrecs-th": "CACHE", "osap-today-wx-1.00,2.00": "CACHE", "osap-offline": JSON.stringify({ v: 1, packs: { th: {} } }), "osap-loc": JSON.stringify({ on: true, cc: "th" }),
  "unrelated-key": "keep-out"
};
const SEED_B = { "osap-atak-pts": JSON.stringify([{ id: "pt-b1", n: "B own point", lat: 1.3, lon: 103.8, cc: "sg" }]), "osap-meas-unit": "mi", "osap-offline": JSON.stringify({ v: 1, packs: { sg: { name: "Singapore" } } }) };
const PASS = "correct horse battery staple";

/* ---------- device A: make the backup ---------- */
const A = await device(SEED_A);
// a photo on point pt-a1, put in the photo store the way assets/osap-points.js keeps it
const photoBytes = await A.p.evaluate(async () => {
  const u = new Uint8Array(3000); for (let i = 0; i < u.length; i++) u[i] = (i * 7) & 255; u[0] = 0xFF; u[1] = 0xD8;
  const d = await new Promise((res, rej) => { const r = indexedDB.open("osap-points", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", u))).map((x) => x.toString(16).padStart(2, "0")).join("");
  await new Promise((res, rej) => { const t = d.transaction("photos", "readwrite"); t.objectStore("photos").put({ id: "ph-1", pid: "pt-a1", buf: u.buffer, type: "image/jpeg", size: u.length, name: "a.jpg", sha256: h, added: 1 }); t.oncomplete = res; t.onerror = rej; });
  d.close(); return Array.from(u);
});
// a second workspace so every workspace is shown to move
await A.p.evaluate(() => { const r = JSON.parse(localStorage.getItem("osap-ws")); r.list.push({ id: "ws-second1", name: "Second", created: 1, updated: 1 }); localStorage.setItem("osap-ws", JSON.stringify(r)); localStorage.setItem("osap-ws-data-ws-second1", JSON.stringify({ v: 1, keys: { "osap-atak-pts": "[]" } })); });
await A.p.evaluate(() => document.getElementById("tidy-set").click());
const item = A.p.locator('#tidy-pop [data-tp="@move"]');
ok(await item.count() === 1, "Settings gear has Move to another device");
await item.click();
await A.p.waitForSelector("#movedlg:not([hidden]) [data-mv-make]");
ok(/2 map points/.test(await A.p.textContent("#movedlg")), "panel says what is on this device");
await A.p.fill("[data-mv-p1]", PASS); await A.p.fill("[data-mv-p2]", "different passphrase");
await A.p.click("[data-mv-make]");
ok(/not the same/.test(await A.p.textContent("#movedlg .mvmsg")), "mismatched passphrases are refused");
await A.p.fill("[data-mv-p1]", PASS); await A.p.fill("[data-mv-p2]", PASS);
await A.p.click("[data-mv-make]");
await A.p.waitForSelector("#movedlg a[download]", { timeout: 30000 });
if (OUT) await A.p.screenshot({ path: OUT + "/move-made.png" });
const [dl] = await Promise.all([A.p.waitForEvent("download"), A.p.click("#movedlg a[download]")]);
const fileName = dl.suggestedFilename(), filePath = await dl.path();
const file = await readFile(filePath);
ok(/^osap-backup-\d{4}-\d{2}-\d{2}\.osap$/.test(fileName), "file is named osap-backup-<date>.osap", fileName);
ok(file.subarray(0, 8).toString() === "OSAPMOVE", "file starts with the OSAP move marker");
const txt = file.toString("latin1");
ok(!/Alpha CP|IED route watch|Plan A|correct horse/.test(txt), "nothing saved (names, watch words, passphrase) is readable in the file");
// what was packed, read back inside A with the right passphrase
const inA = await A.p.evaluate(async ({ b, pass }) => { const g = await OSAP_MOVE.read(new Blob([new Uint8Array(b)]), pass); return { keys: Object.keys(g.stores).sort(), photos: g.photos.length }; }, { b: Array.from(file), pass: PASS });
ok(inA.keys.includes("osap-atak-pts") && inA.keys.includes("osap-medplan-th") && inA.keys.includes("osap-ws") && inA.keys.includes("osap-ws-data-ws-second1") && inA.keys.includes("tfw-theme"), "points, med plan, every workspace and settings are packed", inA.keys);
ok(!inA.keys.some((k) => /^(asap-xrecs-|osap-today-wx-)|^osap-offline$|^osap-loc$|^unrelated/.test(k)), "caches, offline-download list, Use my location and non-OSAP stores stay behind");
ok(inA.photos === 1, "the photo is packed");
ok(A.errs.length === 0, "device A: no page errors", A.errs);

/* ---------- device B: wrong passphrase, damaged file, then bring it in ---------- */
const B = await device(SEED_B);
const before = await B.p.evaluate(() => localStorage.getItem("osap-atak-pts"));
await B.p.evaluate(() => OSAP_MOVE.open());
await B.p.setInputFiles("[data-mv-file]", { name: fileName, mimeType: "application/octet-stream", buffer: file });
await B.p.fill("[data-mv-p3]", "wrong passphrase!!");
await B.p.click("[data-mv-read]");
await B.p.waitForFunction(() => /Wrong passphrase/.test(document.querySelector("#movedlg .mvmsg").textContent), null, { timeout: 20000 });
ok(true, "wrong passphrase is refused");
const bad = Buffer.from(file); bad[bad.length - 40] ^= 1;
const damaged = await B.p.evaluate(async ({ b, pass }) => { try { await OSAP_MOVE.read(new Blob([new Uint8Array(b)]), pass); return "read"; } catch (e) { return e.message; } }, { b: Array.from(bad), pass: PASS });
ok(/Wrong passphrase, or the file was damaged/.test(damaged), "a damaged file is refused", damaged);
const hb = Buffer.from(file); hb[20] = hb[20] === 0x31 ? 0x32 : 0x31;   // a changed digit inside the header
const edited = await B.p.evaluate(async ({ b, pass }) => { try { await OSAP_MOVE.read(new Blob([new Uint8Array(b)]), pass); return "read"; } catch (e) { return e.message; } }, { b: Array.from(hb), pass: PASS });
ok(edited !== "read", "an edited header is refused", edited);
ok(await B.p.evaluate(() => localStorage.getItem("osap-atak-pts")) === before, "refused files change nothing");
await B.p.fill("[data-mv-p3]", PASS);
await B.p.click("[data-mv-read]");
await B.p.waitForSelector("[data-mv-apply]", { timeout: 20000 });
const sumTxt = await B.p.textContent("#movedlg");
ok(/2 map points, 1 photo, 1 drawn area, 1 keyword watch, 1 medical plan/.test(sumTxt) && /2 workspaces/.test(sumTxt), "panel shows what the backup holds");
ok(/replaces everything saved on this device \(1 map point\)/.test(sumTxt), "panel warns what will be replaced");
if (OUT) await B.p.screenshot({ path: OUT + "/move-confirm.png" });
await Promise.all([B.p.waitForEvent("load"), B.p.click("[data-mv-apply]")]);
await ready(B.p);
const after = await B.p.evaluate(async () => {
  const d = await new Promise((res) => { const r = indexedDB.open("osap-points", 1); r.onsuccess = () => res(r.result); });
  const ph = await new Promise((res) => { const q = d.transaction("photos").objectStore("photos").get("ph-1"); q.onsuccess = () => res(q.result); });
  d.close();
  return { pts: localStorage.getItem("osap-atak-pts"), unit: localStorage.getItem("osap-meas-unit"), off: localStorage.getItem("osap-offline"), ws: JSON.parse(localStorage.getItem("osap-ws")).list.length,
    plan: localStorage.getItem("osap-medplan-th"), photo: ph ? Array.from(new Uint8Array(ph.buf)) : null, pid: ph && ph.pid };
});
ok(JSON.parse(after.pts).map((x) => x.id).join() === "pt-a1,pt-a2", "device B now has device A's points");
ok(after.unit === "nm" && after.plan && after.ws === 2, "settings, med plan and both workspaces arrived", { unit: after.unit, ws: after.ws });
ok(after.off && JSON.parse(after.off).packs.sg && !JSON.parse(after.off).packs.th, "device B keeps its own offline map list (device-only stores are not replaced)");
ok(after.photo && after.photo.length === photoBytes.length && after.photo.every((x, i) => x === photoBytes[i]) && after.pid === "pt-a1", "the photo arrived byte for byte on its point");
// the photo shows on the point in the map's point viewer data
const viaPoints = await B.p.evaluate(async () => (await OSAP_POINTS.photos("pt-a1")).length);
ok(viaPoints === 1, "the points module finds the photo");

/* ---------- undo ---------- */
await B.p.evaluate(() => OSAP_MOVE.open());
await B.p.waitForSelector("[data-mv-undo]");
B.p.once("dialog", (d) => d.accept());
await Promise.all([B.p.waitForEvent("load"), B.p.click("[data-mv-undo]")]);
await ready(B.p);
const undone = await B.p.evaluate(async () => {
  const d = await new Promise((res) => { const r = indexedDB.open("osap-points", 1); r.onsuccess = () => res(r.result); });
  const ph = await new Promise((res) => { const q = d.transaction("photos").objectStore("photos").get("ph-1"); q.onsuccess = () => res(q.result); });
  d.close(); return { pts: localStorage.getItem("osap-atak-pts"), unit: localStorage.getItem("osap-meas-unit"), plan: localStorage.getItem("osap-medplan-th"), photo: !!ph, again: await OSAP_MOVE.hasUndo() };
});
ok(JSON.parse(undone.pts).map((x) => x.id).join() === "pt-b1" && undone.unit === "mi" && !undone.plan, "Put back restores device B's own data", undone);
ok(!undone.photo, "Put back removes the imported photo");
ok(!undone.again, "nothing left to put back");
ok(B.errs.length === 0, "device B: no page errors", B.errs);

/* ---------- a crafted file: stores outside OSAP and a non-image photo are dropped ---------- */
const crafted = await B.p.evaluate(async (pass) => {
  const te = new TextEncoder();
  const man = te.encode(JSON.stringify({ schema: "osap-move/1", made_utc: new Date().toISOString(), stores: { "osap-atak-pts": "[]", "evil-key": "x", "__proto__": "y", "osap-x": 5 },
    photos: [{ id: "p1", pid: "pt", type: "text/html", off: 0, len: 4, sha256: "" }, { id: "p2", pid: "pt", type: "image/png", off: 0, len: 999999 }] }));
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, man.length);
  const body = new Uint8Array([...len, ...man, 1, 2, 3, 4]);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), b64 = (u) => btoa(String.fromCharCode(...u));
  const head = te.encode(JSON.stringify({ kdf: "PBKDF2-SHA256", iter: 100000, salt: b64(salt), cipher: "AES-256-GCM", iv: b64(iv), z: "" }));
  const pre = new Uint8Array([...te.encode("OSAPMOVE"), 1, head.length >> 8, head.length & 255, ...head]);
  const k0 = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  const k = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, k0, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: pre }, k, body));
  const g = await OSAP_MOVE.read(new Blob([pre, ct]), pass);
  return { keys: Object.keys(g.stores), photos: g.photos.length };
}, PASS);
ok(crafted.keys.join() === "osap-atak-pts" && crafted.photos === 0, "crafted file: only OSAP stores kept, bad photos dropped", crafted);
const notOsap = await B.p.evaluate(async () => { try { await OSAP_MOVE.read(new Blob(["PK\u0003\u0004 not a backup"]), "x"); return "read"; } catch (e) { return e.message; } });
ok(/not an OSAP backup/.test(notOsap), "another kind of file is refused with a plain message");
await A.ctx.close(); await B.ctx.close();

/* ---------- phone ---------- */
{
  const P = await device({}, { width: 390, height: 844 });
  await P.p.evaluate(() => OSAP_MOVE.open()); await P.p.waitForTimeout(300);
  const fit = await P.p.evaluate(() => { const b = document.querySelector("#movedlg .cbox").getBoundingClientRect(), d = document.querySelector("#movedlg"); return { l: b.left, r: b.right, sw: d.scrollWidth, cw: d.clientWidth }; });
  ok(fit.l >= 0 && fit.r <= 390 && fit.sw <= fit.cw, "phone: the panel fits the screen", fit);
  if (OUT) await P.p.screenshot({ path: OUT + "/move-phone.png" });
  ok(P.errs.length === 0, "phone: no page errors", P.errs);
  await P.ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
