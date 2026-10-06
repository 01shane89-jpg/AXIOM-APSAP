// Headless check of the interface language menu (assets/osap-i18n.js + assets/i18n/<code>.js): English by default and
// nothing loaded, Settings (the gear) shows the Language menu above Credits, picking Thai swaps the app's own words and
// loads only the Thai table, reports are left as published, the choice comes back after a reload, English puts every
// word back, and no request leaves the site.
// Run from the repo root: node tests/lang_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
const tables = []; const errors = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
ctx.on("request", (r) => { const m = /assets\/i18n\/([a-z]+)\.js/.exec(r.url()); if (m) tables.push(m[1]); });
ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(4000);
const gear = () => p.evaluate(() => document.getElementById("tidy-set").click());

ok(await p.evaluate(() => !!window.OSAP_I18N && window.OSAP_I18N.lang() === "en"), "English by default");
ok(tables.length === 0, "English loads no word table");
ok(await p.evaluate(() => window.OSAP_I18N.langs().length === 9), "nine languages offered");
await gear(); await p.waitForTimeout(300);
ok(await p.evaluate(() => { const s = document.querySelector("#tidy-pop .tpset #osap-lang-sel"); const c = document.querySelector('#tidy-pop [data-tp="#credits-btn"]');
  return !!s && !!c && !!(s.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }), "Settings shows the Language menu above Credits");
// pick Thai from the menu
await p.selectOption("#osap-lang-sel", "th");
await p.waitForFunction(() => document.documentElement.getAttribute("data-ui-lang") === "th", null, { timeout: 10000 }).catch(() => {});
ok(JSON.stringify(tables) === '["th"]', "picking Thai loads only the Thai table " + JSON.stringify(tables));
ok(await p.evaluate(() => localStorage.getItem("osap-lang") === "th"), "choice kept on this device");
ok(await p.evaluate(() => /ภาษา/.test(document.getElementById("osap-lang-h").textContent) && /Language/.test(document.getElementById("osap-lang-h").textContent)), "menu heading shows Thai and English");
ok(await p.evaluate(() => !document.querySelector(".tplnote").hidden), "AI generated note shown for an AI-drafted table");
ok(await p.evaluate(() => [...document.querySelectorAll("button,h1,h2,h3,[title]")].filter((e) => /[\u0E00-\u0E7F]/.test((e.getAttribute("title") || "") + e.textContent)).length >= 20), "app words swapped to Thai on screen");
ok(await p.evaluate(() => { const m = document.getElementById("map"); return !!m && m.getAttribute("translate") === "no"; }), "map still marked translate=no");
// reload: Thai comes back on its own
tables.length = 0;
await p.reload(); await p.waitForTimeout(4000);
await p.waitForFunction(() => document.documentElement.getAttribute("data-ui-lang") === "th", null, { timeout: 10000 }).catch(() => {});
ok(await p.evaluate(() => window.OSAP_I18N.lang() === "th" && document.documentElement.getAttribute("data-ui-lang") === "th"), "Thai comes back after a reload");
// back to English: every swapped word restored
await p.evaluate(() => window.OSAP_I18N.set("en"));
await p.waitForFunction(() => document.documentElement.getAttribute("data-ui-lang") === "en", null, { timeout: 10000 }).catch(() => {});
ok(await p.evaluate(() => !localStorage.getItem("osap-lang")), "English clears the choice");
ok(await p.evaluate(() => !/[฀-๿]/.test([...document.querySelectorAll("#tidy-set,#tidy-rep,#phone-nav,.atak-tb,.atak-tb *")].map((e) => (e.getAttribute("title") || "") + e.textContent).join(" "))), "toolbar and gear back in English");
ok(await p.evaluate(() => document.getElementById("tidy-set").getAttribute("title") === "Settings" || /^Settings/.test(document.getElementById("tidy-set").getAttribute("title") || "")), "Settings tooltip back in English");
ok(errors.length === 0, "no page errors " + errors.join(" | "));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
