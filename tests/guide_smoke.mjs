// Headless check of the user guide (assets/osap-guide.js): the Settings gear lists "User guide" and opens it on a phone;
// every section is there with its contents link; every toolbar button and every long-press ring action is named in the
// guide (so a renamed button shows up here); the find box narrows the sections and says when nothing matches; the page fits
// a phone with no sideways scroll; Esc closes it; printing shows the whole guide and hides the app.
// Run from the repo root: node tests/guide_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); } });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(base + "#th/map");
await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK && window.OSAP_GUIDE, null, { timeout: 60000 });
await p.waitForTimeout(800);

await p.evaluate(() => document.getElementById("tidy-set").click());
const item = p.locator('#tidy-pop [data-tp="@guide"]');
ok(await item.count() === 1, "Settings gear lists User guide");
ok((await item.textContent()).trim() === "User guide", "it reads User guide");
await item.click();
await p.waitForSelector("#guidedlg:not([hidden])");
ok(await p.evaluate(() => window.OSAP_GUIDE.isOpen()), "the guide opens from the gear");
ok(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("gx")), "focus moves to Close");

const S = await p.evaluate(() => window.OSAP_GUIDE.sections());
ok(S.length >= 15, "guide has its sections", S.length);
const miss = await p.evaluate((S) => S.filter((s) => !document.querySelector(`#guidedlg [data-gsec="${s.id}"]`) || !document.querySelector(`#guidedlg .gtoc [data-gto="${s.id}"]`)).map((s) => s.id), S);
ok(miss.length === 0, "every section has a body and a contents link", miss);
for (const id of ["start", "toolbar", "terrain", "comms", "medplan", "lz", "mywork", "settings", "reading"]) ok(S.some((s) => s.id === id), "section " + id);

// every toolbar button and ring action the app shows is named in the guide
const named = await p.evaluate(() => {
  const g = document.querySelector("#guidedlg .gbody").textContent;
  const tools = [...document.querySelectorAll("#atk-tools .atk-list button")].map((b) => b.getAttribute("aria-label")).filter(Boolean);
  return { tools, missing: tools.filter((t) => g.indexOf(t) < 0) };
});
ok(named.tools.length >= 15, "toolbar read", named.tools.length);
ok(named.missing.length === 0, "every toolbar button is named in the guide", named.missing);
const ringMiss = await p.evaluate(() => {
  const g = document.querySelector('#guidedlg [data-gsec="ring"]').textContent;
  return ["Measure", "Route", "Point", "NAI/TAI", "Watch", "Plans", "Find LZ", "Terrain", "Copy"].filter((t) => g.indexOf(t) < 0);
});
ok(ringMiss.length === 0, "every ring action is named", ringMiss);
// the settings the gear shows are named too
const setMiss = await p.evaluate(() => {
  const g = document.querySelector('#guidedlg [data-gsec="settings"]').textContent;
  return ["Map colours", "Grid format", "Distance units", "Use my location", "Offline maps and data", "Move to another device", "On-device AI", "User guide"].filter((t) => g.indexOf(t) < 0);
});
ok(setMiss.length === 0, "every Settings item is named", setMiss);

// contents link scrolls to its section
await p.click('#guidedlg .gtoc [data-gto="lz"]');
await p.waitForTimeout(200);
const lzTop = await p.evaluate(() => { const b = document.querySelector("#guidedlg .gbody"), s = document.querySelector('#guidedlg [data-gsec="lz"]'); return s.getBoundingClientRect().top - b.getBoundingClientRect().top; });
ok(lzTop >= -2 && lzTop < 40, "a contents link scrolls to its section", lzTop);

// find narrows the sections
await p.fill("#guidedlg .gfind", "viewshed");
const shown = await p.evaluate(() => [...document.querySelectorAll("#guidedlg .gsec")].filter((s) => !s.hidden).map((s) => s.getAttribute("data-gsec")));
ok(shown.includes("terrain") && shown.length < S.length, "find keeps the matching sections only", shown);
await p.fill("#guidedlg .gfind", "zzzqqq");
ok(await p.evaluate(() => !document.querySelector("#guidedlg .gnone").hidden && [...document.querySelectorAll("#guidedlg .gsec")].every((s) => s.hidden)), "find says when nothing matches");
await p.fill("#guidedlg .gfind", "");
ok(await p.evaluate(() => [...document.querySelectorAll("#guidedlg .gsec")].every((s) => !s.hidden)), "clearing find shows everything again");

// fits a phone: no sideways scroll, buttons big enough to tap
const fit = await p.evaluate(() => { const b = document.querySelector("#guidedlg .gbody"), x = document.querySelector("#guidedlg .gx"); const r = x.getBoundingClientRect(); return { sw: b.scrollWidth, cw: b.clientWidth, x: [r.width, r.height] }; });
ok(fit.sw <= fit.cw + 1, "no sideways scroll on a phone", fit);
ok(fit.x[0] >= 40 && fit.x[1] >= 40, "Close is big enough to tap", fit.x);

// print: the guide only, all of it
await p.emulateMedia({ media: "print" });
const pr = await p.evaluate(() => ({
  app: [...document.body.children].filter((el) => el.id !== "guidedlg" && getComputedStyle(el).display !== "none").map((el) => el.id || el.className || el.tagName),
  guide: getComputedStyle(document.getElementById("guidedlg")).display,
  find: getComputedStyle(document.querySelector("#guidedlg .gfind")).display,
  secs: [...document.querySelectorAll("#guidedlg .gsec")].filter((s) => getComputedStyle(s).display !== "none").length
}));
ok(pr.app.length === 0, "printing hides the app", pr.app);
ok(pr.guide !== "none" && pr.find === "none", "printing shows the guide without its controls", pr);
ok(pr.secs === S.length, "printing carries every section", pr.secs);
await p.emulateMedia({ media: "screen" });

await p.keyboard.press("Escape");
ok(await p.evaluate(() => !window.OSAP_GUIDE.isOpen() && !document.documentElement.classList.contains("guide-open")), "Esc closes the guide");
// open at a section from code
await p.evaluate(() => window.OSAP_GUIDE.open("reading"));
ok(await p.evaluate(() => window.OSAP_GUIDE.isOpen()), "open(section) opens the guide");
await p.click("#guidedlg .gx");
ok(await p.evaluate(() => !window.OSAP_GUIDE.isOpen()), "Close closes it");
ok(errs.length === 0, "no page errors", errs);

await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all guide checks passed");
process.exit(fails ? 1 : 0);
