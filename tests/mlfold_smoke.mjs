// Headless check of the shorter Map overlays panel (assets/osap-mlfold.js) and the headed Settings list (assets/osap-tidy.js):
// the Overlays panel gets a find box and a chip per section; Fold all makes the panel far shorter and a chip opens its section
// again; a heading folds and opens its section and the choice survives a reload; typing "ships" leaves only the Ships section;
// a switch turned on shows in its chip and heading; a phone has no sideways scroll; the Settings gear shows its four headings.
// Run from the repo root: node tests/mlfold_smoke.mjs   (needs the playwright package and Chromium)
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
async function open(opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); } });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base + "#th/map");
  await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK && window.OSAP_MLFOLD, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  return { ctx, p, errs };
}
const overlays = async (p) => { await p.click('#atk-tools [data-atk="overlays"]'); await p.waitForSelector("#atk-om .mlnav .mlchips button", { timeout: 15000 }); await p.waitForTimeout(300); };
const height = (p) => p.evaluate(() => document.querySelector("#atk-om .atk-omb").scrollHeight);

// ---------- desktop ----------
{
  const { ctx, p, errs } = await open({ viewport: { width: 1440, height: 900 } });
  await overlays(p);
  const S = await p.evaluate(() => window.OSAP_MLFOLD.sections());
  ok(S.length >= 10, "Overlays has its sections", S.length);
  ok(S.some((s) => /Infrastructure/.test(s.name)) && S.some((s) => /Ships/.test(s.name)), "Infrastructure and Ships are sections", S.map((s) => s.name));
  ok(!S.some((s) => /^(Base map|Grid)$/.test(s.name)), "rows the toolbar does not show (Base map, classic Grid) get no chip");
  ok(await p.locator("#atk-om .mlnav .mlchips button").count() === S.length, "one chip per section");
  ok(await p.locator("#atk-om .mlnav .mlfind").isVisible(), "the find box shows");
  ok(S.every((s) => !s.shut), "sections start open");
  const moves = await p.evaluate(() => new Promise((res) => { let n = 0; const mo = new MutationObserver((r) => { n += r.length; }); mo.observe(document.getElementById("ml-panel"), { childList: true }); setTimeout(() => { mo.disconnect(); res(n); }, 1500); }));
  ok(moves < 5, "the panel settles (the bar and the section order do not keep moving)", moves);
  const tall = await height(p);
  await p.click('#atk-om [data-mlall="shut"]'); await p.waitForTimeout(250);
  const short = await height(p);
  ok(short < tall / 3, "Fold all makes the panel much shorter", { tall, short });
  ok((await p.evaluate(() => window.OSAP_MLFOLD.sections())).every((s) => s.shut), "every section folded");
  // a chip opens its section and goes to it
  const shipsI = S.findIndex((s) => /^Ships/.test(s.name));
  await p.click(`#atk-om .mlchips [data-mlgo="${shipsI}"]`); await p.waitForTimeout(300);
  ok(await p.locator("#ml-sea .mlrow").first().isVisible(), "the Ships chip opens Ships");
  // a heading folds and opens its section; the choice survives a reload
  await p.click("#ml-sea > .mlh"); await p.waitForTimeout(200);
  ok(!(await p.locator("#ml-sea .mlrow").first().isVisible()), "the Ships heading folds Ships");
  await p.click("#ml-sea > .mlh"); await p.waitForTimeout(200);
  ok(await p.locator("#ml-sea .mlrow").first().isVisible(), "and opens it again");
  ok(await p.getAttribute("#ml-sea > .mlh", "aria-expanded") === "true", "the heading says it is open");
  await p.focus("#ml-air > .mlh"); await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  ok(await p.getAttribute("#ml-air > .mlh", "aria-expanded") === "true", "Enter on a heading opens it");
  await p.reload(); await p.waitForFunction(() => window.__asapMap && window.OSAP_MLFOLD, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await overlays(p);
  const R = await p.evaluate(() => window.OSAP_MLFOLD.sections());
  ok(R.find((s) => /^Ships/.test(s.name)).shut === false && R.find((s) => /^Infrastructure/.test(s.name)).shut === true, "folds are remembered after a reload");
  await p.click('#atk-om [data-mlall="open"]'); await p.waitForTimeout(250);
  ok((await p.evaluate(() => window.OSAP_MLFOLD.sections())).every((s) => !s.shut), "Open all opens every section");
  // the find box
  await p.fill("#atk-om .mlfind", "ships"); await p.waitForTimeout(250);
  const vis = await p.evaluate(() => [...document.querySelectorAll("#atk-om .mlsec")].filter((s) => s.getClientRects().length).map((s) => s.id));
  ok(vis.includes("ml-sea") && !vis.includes("ml-elev"), "ships leaves the Ships section", vis);
  await p.fill("#atk-om .mlfind", "power plants"); await p.waitForTimeout(250);
  ok(await p.locator("#ml-infra .mlrow", { hasText: "Power plants" }).first().isVisible() && !(await p.locator("#ml-infra .mlrow", { hasText: "Dams" }).first().isVisible()), "power plants shows that row and hides Dams");
  await p.fill("#atk-om .mlfind", "zzqx"); await p.waitForTimeout(250);
  ok(await p.evaluate(() => document.querySelector("#atk-om .mlnav").classList.contains("mlfx-empty")), "no match says so");
  await p.focus("#atk-om .mlfind"); await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  ok(await p.inputValue("#atk-om .mlfind") === "" && await p.locator("#ml-elev").isVisible(), "Esc clears the find box and everything is back");
  // a switch turned on shows in its chip and heading
  const box = p.locator("#ml-infra input[type=checkbox]").first();
  await box.check(); await p.waitForTimeout(400);
  ok(/^\d+ on$/.test(await p.getAttribute("#ml-infra > .mlh", "data-on") || ""), "the Infrastructure heading counts what is on");
  ok(await p.evaluate(() => /\d/.test(document.querySelector('#atk-om .mlchips [data-mlgo="' + document.getElementById("ml-infra").getAttribute("data-mlsec") + '"]').textContent)), "and so does its chip");
  await box.uncheck(); await p.waitForTimeout(300);
  // Settings headings
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.getElementById("tidy-set").click()); await p.waitForTimeout(300);
  const H = await p.evaluate(() => [...document.querySelectorAll("#tidy-pop .tphd")].map((h) => h.textContent));
  ok(H.join("|") === "Display|Location and privacy|Data and devices|Setup, help and safety", "Settings shows its four headings", H);
  ok(errs.length === 0, "desktop: no page errors", errs);
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errs } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await overlays(p);
  ok(await p.evaluate(() => { const b = document.querySelector("#atk-om .atk-omb"); return b.scrollWidth <= b.clientWidth + 1; }), "phone: no sideways scroll in Overlays");
  await p.fill("#atk-om .mlfind", "aircraft"); await p.waitForTimeout(250);
  ok(await p.locator("#ml-air").isVisible(), "phone: aircraft finds Live aircraft");
  ok(errs.length === 0, "phone: no page errors", errs);
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
