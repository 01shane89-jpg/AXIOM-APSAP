// Headless check of the hand-off from the old address (assets/osap-carry.js), with the two real addresses served from this
// repository (Playwright routes): a stand-in page carries index.html's own first lines (the hand-off and the old move).
// - Old address with saved work: lands on the new address with the points, routes, folders, both workspaces and the photo
//   merged into what the new address already had (its own edit kept, no duplicates), a note saying what came across, and
//   the old address's copy untouched.
// - Opening the old address again: straight to the new address, nothing brought twice.
// - A set too big for one address (about 2 MB) goes in parts and arrives whole.
// - A link to the new address with a set in it, not coming from the old address: asks first, brings nothing on "No".
// - A damaged set: refused, nothing changed. Nothing saved on the old address: the plain move, with ?from=pages.
// - The chain after the move to the company address (2026-11-05): github.io hands on to the stand-in copy on
//   axiom-osap.netlify.app (its page names the new address), which takes it in and hands all it holds on to
//   osap.axiom-inteligence-systems.com: everything from both old addresses arrives, each confirmed, and a second visit is the
//   plain move. A tagged set opened from elsewhere asks first.
// - The real index.html: the hand-off is the first script, the old move steps aside only when the hand-off runs, and on the
//   old address the hand-off carries saved work before anything else in the page runs.
// Run from the repo root: node tests/carry_smoke.mjs   (needs the playwright package and Chromium; BROWSER=webkit runs it in
// WebKit, Safari's engine, as the iPhone uses)
import { readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { randomBytes } from "node:crypto";
const OLD = "https://01shane89-jpg.github.io/AXIOM-APSAP/", NEW = "https://axiom-osap.netlify.app/", HOME = "https://osap.axiom-inteligence-systems.com/";
const html = await readFile("index.html", "utf8"), carry = await readFile("assets/osap-carry.js", "utf8");
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 300))); if (!c) fails++; }

// index.html: the hand-off runs first, and the old move (kept for browsers that cannot run it) checks it
const head = html.slice(0, html.indexOf('<script src="assets/osap-protect.js"></script>'));
ok(/<script src="assets\/osap-carry\.js"><\/script><script>[^<]*if\(\/\\\.github\\\.io\$\/\.test\(location\.hostname\)&&!\(window\.OSAP_CARRY&&window\.OSAP_CARRY\.handled\)\)location\.replace\(/.test(head), "index.html: hand-off first, the old move only when it did not take over");
ok(head.split("<script").length === 3, "nothing else runs before the hand-off in index.html's head");
const inline = head.slice(head.indexOf("<script>"));
const standIn = `<!doctype html><html><head><meta charset="utf-8"><meta name="osap-carry-to" content="${HOME}"><script src="assets/osap-carry.js"></script>${inline}<script>window.APP_RAN = true;</script></head><body><p id="app">app</p></body></html>`;
const page = `<!doctype html><html><head><meta charset="utf-8"><script src="assets/osap-carry.js"></script>${inline}<script>window.APP_RAN = true;</script></head><body><p id="app">app</p></body></html>`;

const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function ctxNew(realOld, chain) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
  const hits = [];
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    const site = u.origin + "/" === NEW ? "new" : chain && u.origin + "/" === HOME ? "home" : u.origin === "https://01shane89-jpg.github.io" && u.pathname.startsWith("/AXIOM-APSAP/") ? "old" : null;
    if (!site) return route.abort();
    const p = site === "old" ? u.pathname.slice("/AXIOM-APSAP".length) : u.pathname;
    if (route.request().isNavigationRequest()) hits.push(site + " " + u.search);
    if (p === "/" || p === "/index.html") return route.fulfill({ status: 200, contentType: "text/html", body: realOld && site === "old" ? html : chain && site === "new" ? standIn : page });
    if (realOld && site === "old" && /^\/assets\/[\w./-]+$/.test(p) && !p.includes("..")) return readFile(p.slice(1)).then((b) => route.fulfill({ status: 200, contentType: p.endsWith(".css") ? "text/css" : "text/javascript", body: b }), () => route.fulfill({ status: 404, body: "" }));
    if (p === "/assets/osap-carry.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: carry });
    return route.fulfill({ status: 404, body: "" });
  });
  return { ctx, hits };
}
async function settle(p, site, ms) {
  const want = site === "new" ? NEW : site === "home" ? HOME : OLD;
  await p.waitForFunction((w) => location.href.startsWith(w) && window.APP_RAN === true && document.readyState === "complete", want, { timeout: ms || 30000 });
  await p.waitForTimeout(300);
}
const ls = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
async function seed(p, url, stores, photo) {
  await p.goto(url + "?osap-stay=1");
  await p.evaluate(async ({ stores, photo }) => {
    for (const k in stores) localStorage.setItem(k, stores[k]);
    if (photo) await new Promise((res, rej) => {
      const r = indexedDB.open("osap-points", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid");
      r.onsuccess = async () => {
        const buf = new Uint8Array(photo.bytes).buffer, h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((x) => x.toString(16).padStart(2, "0")).join("");
        const t = r.result.transaction("photos", "readwrite"); t.objectStore("photos").put({ id: photo.id, pid: photo.pid, buf, type: "image/jpeg", size: buf.byteLength, name: "a.jpg", sha256: h, added: 1 });
        t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error);
      };
      r.onerror = () => rej(r.error);
    });
  }, { stores, photo });
}
const J = JSON.stringify, P = (s) => JSON.parse(s);
const OLD_STORES = {
  "osap-ws": J({ v: 1, list: [{ id: "ws-aaaa1", name: "Default", created: 1 }, { id: "ws-bbbb2", name: "Trip", created: 2 }], active: "ws-aaaa1" }),
  "osap-ws-data-ws-bbbb2": J({ v: 1, keys: { "osap-atak-pts": J([{ id: "t1", lat: 1, lon: 2, name: "Trip point" }]) } }),
  "osap-atak-pts": J([{ id: "p1", lat: 13.7, lon: 100.5, name: "Embassy" }, { id: "p2", lat: 13.8, lon: 100.6, name: "Hotel" }]),
  "osap-routes": J([{ id: "rt1", name: "Airport run", wps: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }]),
  "osap-places": J({ folders: [{ id: "f1", name: "Bangkok" }], of: { "pt:p2": "f1" } }),
  "osap-auth": J({ access_token: "old-token" }),
};

// 1. the hand-off, into a new address that already has its own Default with one edited and one new point
{
  const { ctx, hits } = await ctxNew(); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await seed(p, NEW, { "osap-ws": J({ v: 1, list: [{ id: "ws-zzzz9", name: "Default", created: 5 }], active: "ws-zzzz9" }), "osap-atak-pts": J([{ id: "p1", lat: 13.7, lon: 100.5, name: "Embassy (moved here)" }, { id: "n1", lat: 1, lon: 1, name: "New here" }]), "osap-auth": J({ access_token: "new-token" }) });
  await seed(p, OLD, OLD_STORES, { id: "ph1", pid: "p2", bytes: [255, 216, 255, 224, 1, 2, 3, 4] });
  const oldBefore = await ls(p);
  hits.length = 0;
  await p.goto(OLD);
  await settle(p, "new");
  const S = await ls(p), pts = P(S["osap-atak-pts"]);
  ok(pts.length === 3 && pts.find((x) => x.id === "p1").name === "Embassy (moved here)" && pts.some((x) => x.id === "p2") && pts.some((x) => x.id === "n1"), "points merged: the old Hotel added, this address's edit kept, no duplicate", pts.map((x) => x.name));
  ok(P(S["osap-routes"]).length === 1 && P(S["osap-places"]).folders[0].name === "Bangkok", "route and My places folder came across");
  const reg = P(S["osap-ws"]);
  ok(reg.list.map((w) => w.name).join() === "Default,Trip" && reg.active === "ws-zzzz9", "Trip workspace added, the open workspace unchanged", reg.list);
  ok(P(S["osap-auth"]).access_token === "new-token", "this address's sign-in untouched");
  const photo = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("osap-points", 1); r.onsuccess = () => { const g = r.result.transaction("photos").objectStore("photos").get("ph1"); g.onsuccess = () => res(g.result ? Array.from(new Uint8Array(g.result.buf)) : null); }; }));
  ok(J(photo) === J([255, 216, 255, 224, 1, 2, 3, 4]), "photo came across byte for byte");
  const note = await p.evaluate(() => (document.getElementById("carry-note") || {}).textContent || "");
  ok(/2 map points, 1 photo, 1 route, 1 folder, 2 workspaces/.test(note), "note says what came across", note);
  ok(!/osap-carry/.test(await p.evaluate(() => location.href)), "the set is gone from the address bar", await p.evaluate(() => location.href));
  const kept = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("osap-carry", 1); r.onsuccess = () => { const t = r.result.transaction("kv").objectStore("kv"); const a = t.get("before"), b = t.get("kept"); t.transaction.oncomplete = () => res([!!a.result, !!b.result, a.result && a.result.stores["osap-atak-pts"]]); }; }));
  ok(kept[0] && kept[1] && /moved here/.test(kept[2]) && !/Hotel/.test(kept[2]), "a copy of what was here before, and of the set, is kept", kept);
  ok(hits.join("|") === "old |new |old |new ?from=pages", "one trip there and back to confirm", hits);
  // the old address: its copy untouched, the confirmed set remembered
  await p.goto(OLD + "?osap-stay=1"); const O = await ls(p);
  const same = Object.keys(oldBefore).every((k) => O[k] === oldBefore[k]);
  ok(same && /^[0-9a-f]{64}$/.test(O["osap-carry-done"] || ""), "old address: every store as it was, plus the confirmation mark");
  // 2. again: straight across, nothing brought twice
  hits.length = 0;
  await p.goto(OLD); await settle(p, "new");
  const S2 = await ls(p);
  ok(S2["osap-atak-pts"] === S["osap-atak-pts"] && S2["osap-carry-last"] === S["osap-carry-last"], "second visit: nothing brought again");
  ok(hits.join("|") === "old |new ?from=pages", "second visit: the plain move", hits);
  // undo puts this address back as it was before the hand-off
  await p.evaluate(() => window.OSAP_CARRY.undo());
  const U = await ls(p);
  ok(P(U["osap-atak-pts"]).length === 2 && !U["osap-ws-data-ws-bbbb2"] && P(U["osap-ws"]).list.length === 1, "undo: this address back to its own two points and one workspace");
  ok(!errs.length, "no page errors", errs);
  await ctx.close();
}

// 3. a set too big for one address goes in parts
{
  const { ctx, hits } = await ctxNew(); const p = await ctx.newPage();
  const big = randomBytes(1200000).toString("base64"); // does not compress: about 2 MB once in the address
  await seed(p, OLD, { "osap-cp-contacts": J({ note: big }), "osap-atak-pts": J([{ id: "q1", lat: 1, lon: 1 }]) });
  hits.length = 0;
  await p.goto(OLD); await settle(p, "new", 60000);
  const S = await ls(p);
  ok(S["osap-cp-contacts"] && P(S["osap-cp-contacts"]).note === big && P(S["osap-atak-pts"])[0].id === "q1", "2 MB set arrived whole");
  const parts = hits.filter((h) => h === "new ").length;
  ok(parts >= 2, "it went in " + parts + " parts", hits);
  await ctx.close();
}

// 4. a link with a set in it that did not come from the old address: asks first; 5. a damaged set
{
  const { ctx } = await ctxNew(); const p = await ctx.newPage();
  // make a real one-part set on the old address, catch the link it sends, then open that link directly
  await seed(p, OLD, { "osap-atak-pts": J([{ id: "z1", lat: 1, lon: 1, name: "<img src=x onerror=alert(1)>" }]) });
  let link = "";
  await p.route(NEW + "**", (r) => { if (!link && /#osap-carry=/.test(r.request().url())) link = r.request().url(); return r.fulfill({ status: 200, contentType: "text/html", body: "<p>caught</p>" }); });
  await p.goto(OLD); await p.waitForFunction(() => document.body && /caught/.test(document.body.textContent), null, { timeout: 30000 });
  await p.unroute(NEW + "**");
  // Playwright's route does not carry the fragment; rebuild it from the old address's own set
  link = await p.evaluate(() => location.href);
  ok(/#osap-carry=[0-9a-f]{64}\.0\.1\./.test(link), "the old address sends one part", link.slice(0, 120));
  await p.close(); const p2 = await ctx.newPage(); await p2.bringToFront();
  await p2.goto("about:blank"); await p2.goto(link, { waitUntil: "commit" });
  await p2.waitForFunction(() => document.getElementById("carry-msg"), null, { timeout: 15000 });
  const msg = await p2.textContent("#carry-msg");
  ok(/Only do this if you just came from the old OSAP address/.test(msg), "opened from elsewhere: asks first", msg);
  await p2.click("text=No"); await settle(p2, "new");
  ok(!(await ls(p2))["osap-atak-pts"], "No: nothing brought in");
  // damaged: same id, other data
  const bad = link.replace(/\.0\.1\.([A-Za-z0-9_-]{8})/, ".0.1.AAAAAAAA");
  await p2.goto("about:blank"); await p2.goto(bad, { waitUntil: "commit" });
  await p2.waitForFunction(() => document.getElementById("carry-msg"), null, { timeout: 15000 });
  await p2.click("text=Bring them in");
  await p2.waitForFunction(() => /could not bring/.test((document.getElementById("carry-msg") || {}).textContent || ""), null, { timeout: 15000 });
  ok(!(await p2.evaluate(() => localStorage.getItem("osap-atak-pts"))), "damaged set: refused, nothing changed");
  await ctx.close();
}

// 6. nothing saved on the old address: the plain move, with the view kept
{
  const { ctx, hits } = await ctxNew(); const p = await ctx.newPage();
  await p.goto(OLD + "?c=th#th/map"); await settle(p, "new");
  const u = await p.evaluate(() => location.href);
  ok(u === NEW + "?c=th&from=pages#th/map" && hits.length === 2, "nothing saved: plain move to the new address, view kept", [u, hits]);
  await ctx.close();
}

// 7. the real index.html on the old address: the hand-off runs before the app, and nothing after it runs there
{
  const { ctx, hits } = await ctxNew(true); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(OLD + "assets/osap-carry.js"); // the old address's origin, without running the app
  await p.evaluate((S) => { for (const k in S) localStorage.setItem(k, S[k]); }, { "osap-atak-pts": J([{ id: "r1", lat: 1, lon: 1, name: "Real page point" }]) });
  hits.length = 0;
  await p.goto(OLD, { waitUntil: "commit" }); await settle(p, "new");
  const S = await ls(p);
  ok(P(S["osap-atak-pts"] || "[]")[0]?.name === "Real page point" && hits.join("|") === "old |new |old |new ?from=pages", "real index.html: saved point carried, one trip there and back", hits);
  ok(!errs.length, "real index.html: no page errors", errs);
  await ctx.close();
}

// 8. the chain after the move: github.io -> the stand-in on netlify.app -> the company address
{
  const { ctx, hits } = await ctxNew(false, true); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await seed(p, HOME, { "osap-atak-pts": J([{ id: "h1", lat: 1, lon: 1, name: "Made on the new address" }]) });
  await seed(p, NEW, { "osap-atak-pts": J([{ id: "n1", lat: 2, lon: 2, name: "Made on netlify.app" }]), "osap-auth": J({ access_token: "netlify-token" }) });
  await seed(p, OLD, { "osap-atak-pts": J([{ id: "g1", lat: 3, lon: 3, name: "Made on github.io" }]), "osap-routes": J([{ id: "rt9", name: "Old route", wps: [] }]) });
  hits.length = 0;
  await p.goto(OLD + "?c=th"); await settle(p, "home", 60000);
  const S = await ls(p), pts = P(S["osap-atak-pts"] || "[]").map((x) => x.id).sort().join();
  ok(pts === "g1,h1,n1" && P(S["osap-routes"] || "[]").length === 1, "chain: points from github.io and netlify.app both arrive, the new address's own kept", pts);
  ok(!S["osap-auth"], "chain: no sign-in travels");
  ok(hits.join("|") === "old ?c=th|new |old |new ?from=pages|home |new |home ?from=pages", "chain: github.io -> stand-in -> github.io confirms -> stand-in -> new address -> stand-in confirms -> new address", hits);
  const note = await p.evaluate(() => (document.getElementById("carry-note") || {}).textContent || "");
  ok(/2 map points, 1 route/.test(note), "chain: note on the new address says what came across", note);
  await p.goto(NEW + "?osap-stay=1"); const N = await ls(p);
  ok(/^[0-9a-f]{64}$/.test(N["osap-carry-done"] || "") && P(N["osap-auth"]).access_token === "netlify-token", "stand-in: confirmation mark kept, its own stores untouched");
  hits.length = 0;
  await p.goto(OLD); await settle(p, "home");
  ok(hits.join("|") === "old |new ?from=pages|home ?from=pages", "chain, second visit: the plain move through both old addresses", hits);
  ok((await ls(p))["osap-atak-pts"] === S["osap-atak-pts"], "chain, second visit: nothing brought again");
  // a bookmark of the old netlify.app address with nothing new: straight to the new address, the view kept
  hits.length = 0;
  await p.goto(NEW + "?c=mm#mm/map"); await settle(p, "home");
  ok(await p.evaluate(() => location.href) === HOME + "?c=mm&from=pages#mm/map", "old netlify.app bookmark: on to the new address with the view kept", await p.evaluate(() => location.href));
  ok(!errs.length, "chain: no page errors", errs);
  await ctx.close();
}

// 9. a set tagged as from netlify.app, opened on the new address from somewhere else: asks first
{
  const { ctx } = await ctxNew(false, true); const p = await ctx.newPage();
  await seed(p, NEW, { "osap-atak-pts": J([{ id: "x1", lat: 1, lon: 1 }]) });
  let link = "";
  await p.route(HOME + "**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>caught</p>" }));
  await p.goto(NEW); await p.waitForFunction(() => document.body && /caught/.test(document.body.textContent), null, { timeout: 30000 });
  link = await p.evaluate(() => location.href);
  await p.unroute(HOME + "**");
  ok(/#osap-carry=[0-9a-f]{64}\.0\.1\.[A-Za-z0-9_-]+~n$/.test(link), "the stand-in tags its set ~n", link.slice(-20));
  await p.close(); const p2 = await ctx.newPage();
  await p2.goto("about:blank"); await p2.goto(link, { waitUntil: "commit" });
  await p2.waitForFunction(() => document.getElementById("carry-msg"), null, { timeout: 15000 });
  ok(/Only do this if you just came from the old OSAP address/.test(await p2.textContent("#carry-msg")), "tagged set from elsewhere: asks first");
  await p2.click("text=No"); await settle(p2, "home");
  ok(!(await ls(p2))["osap-atak-pts"], "No: nothing brought in");
  await ctx.close();
}

await browser.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
