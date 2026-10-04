// Headless check of the side panels you can size and move on a computer (assets/osap-panels.js):
// the default layout is unchanged; dragging the Details edge makes it wider and the map narrower; the grip's menu docks Details
// on the left; Reports floats over the map and leaves its column; a map window (Evac plan) widens, docks left, floats, moves
// and shrinks by its corner; every choice survives a reload; Reset puts each back; a phone and a narrow window get none of it.
// Run from the repo root: node tests/panels_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

async function ready(p) {
  await p.waitForFunction(() => window.TSAP && window.__asapMap && window.OSAP_PANELS && window.OSAP_EPE_GO, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
}
async function open(w, h, hash) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-rv-mode", "split"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + (hash || "#kp/timeline"), { waitUntil: "domcontentloaded" });
  await ready(p);
  return { ctx, p, errors };
}
const R = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }, s);
const mid = (p, s) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, s);
async function dragBy(p, s, dx, dy) { const [x, y] = await mid(p, s); await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await p.mouse.move(x + dx, y + dy, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(350); }
const shot = (p, n) => OUT ? p.screenshot({ path: OUT + "/" + n + ".png" }) : null;
async function openEvac(p) {
  await p.evaluate(() => window.OSAP_EPE_GO({ at: [39.03, 125.75] }));
  await p.waitForFunction(() => { const e = document.getElementById("epe"); return e && !e.hidden; }, null, { timeout: 20000 }); await p.waitForTimeout(500);
}

// ---------- a computer ----------
{
  const { ctx, p, errors } = await open(1440, 900);
  const m0 = await R(p, "#map"), rv0 = await R(p, "#rv"), rl0 = await R(p, ".rail");
  ok(m0.w === 688 && rv0.w === 380 && rl0.w === 372 && rl0.x === 1068, `default layout unchanged: map ${m0.w}, Reports ${rv0.w}, Details ${rl0.w} at ${rl0.x}`);
  ok(await p.evaluate(() => document.documentElement.classList.contains("pnl") && !localStorage.getItem("osap-panels")), "panels on, nothing stored until something is moved");
  ok(!!(await R(p, '.pngrip.e.on[data-pn="rail"]')) && !!(await R(p, '.pngrip.e.on[data-pn="rv"]')), "Details and Reports each show an edge grip");

  await dragBy(p, '.pngrip.e[data-pn="rail"]', -120, 0);
  const rl1 = await R(p, ".rail"), m1 = await R(p, "#map");
  ok(rl1.w === 492 && m1.w === 568, `dragging the Details edge 120 px makes it wider (${rl1.w}) and the map narrower (${m1.w})`);
  ok(await p.evaluate(() => !document.querySelector(".pnmenu")), "a drag does not open the position menu");

  await p.click('.pngrip.e[data-pn="rail"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelectorAll(".pnmenu [data-pnset]").length === 4), "a click on the grip opens Dock left, Dock right, Float, Reset");
  await p.click('.pnmenu [data-pnset="left"]'); await p.waitForTimeout(400);
  const rl2 = await R(p, ".rail"), m2 = await R(p, "#map"), rv2 = await R(p, "#rv");
  ok(rl2.x === 0 && rl2.w === 492 && m2.x === 492 && rv2.x + rv2.w === 1440, `Details docks on the left at its new width (Details ${rl2.x}+${rl2.w}, map at ${m2.x}, Reports ends at ${rv2.x + rv2.w})`);
  await shot(p, "panels-details-left");

  await p.evaluate(() => window.OSAP_PANELS.set("rv", "float")); await p.waitForTimeout(400);
  const rv3 = await R(p, "#rv"), m3 = await R(p, "#map"), bar = await R(p, '.pnbar.on[data-pn="rv"]');
  ok(await p.evaluate(() => getComputedStyle(document.getElementById("rv")).position === "fixed") && m3.w === 948, `Reports floats over the map and gives back its column (map ${m3.w})`);
  ok(bar && bar.y + bar.h === rv3.y && bar.x === rv3.x, "the floating panel has a move bar on its top edge");
  await dragBy(p, '.pnbar[data-pn="rv"] .pnt', -150, 60);
  const rv4 = await R(p, "#rv");
  ok(Math.abs(rv4.x - (rv3.x - 150)) <= 1 && Math.abs(rv4.y - (rv3.y + 60)) <= 1, `dragging the bar moves it (${rv3.x},${rv3.y} -> ${rv4.x},${rv4.y})`);
  await dragBy(p, '.pngrip.s[data-pn="rv"]', 0, -100);
  const rv5 = await R(p, "#rv");
  ok(rv5.h === rv4.h - 100 && rv5.w === rv4.w, `dragging the bottom edge makes it shorter (${rv4.h} -> ${rv5.h})`);
  await shot(p, "panels-reports-float");

  await openEvac(p);
  const e0 = await R(p, "#epe>*");
  ok(e0.x + e0.w === 1440 && e0.w === 480, `the Evac plan side panel opens docked on the right as before (${e0.x}+${e0.w})`);
  await dragBy(p, '.pngrip.e[data-pn="win"]', -100, 0);
  const e1 = await R(p, "#epe>*"); ok(e1.w === 580 && e1.x + e1.w === 1440, `its edge makes it wider (${e1.w})`);
  await p.evaluate(() => window.OSAP_PANELS.set("win", "float")); await p.waitForTimeout(400);
  await dragBy(p, '.pngrip.se[data-pn="win"]', -80, -120);
  const e2 = await R(p, "#epe>*"); ok(e2.w < e1.w && e2.h < 700, `floating, its corner makes it narrower and shorter (${e2.w}x${e2.h})`);
  ok(await p.evaluate(() => !document.documentElement.classList.contains("osplit-cover")), "a floating window does not push the toolbar aside");
  await shot(p, "panels-window-float");
  const kept = await p.evaluate(() => localStorage.getItem("osap-panels"));

  await p.reload({ waitUntil: "domcontentloaded" }); await ready(p);
  ok(await p.evaluate(() => localStorage.getItem("osap-panels")) === kept, "kept on this device as osap-panels");
  const rl6 = await R(p, ".rail"), rv6 = await R(p, "#rv");
  ok(rl6.x === 0 && rl6.w === 492 && rv6.x === rv5.x && rv6.y === rv5.y && rv6.h === rv5.h, "after a reload Details is still on the left and Reports floats where it was left");
  await openEvac(p);
  const e3 = await R(p, "#epe>*"); ok(e3.x === e2.x && e3.w === e2.w && e3.h === e2.h, "the map window opens floating where it was left");

  for (const id of ["rail", "rv", "win"]) await p.evaluate((id) => window.OSAP_PANELS.reset(id), id);
  await p.waitForTimeout(400);
  const e4 = await R(p, "#epe>*"); ok(e4.x + e4.w === 1440 && e4.w === 480, "Reset puts the map window back on the right at its normal width");
  await p.evaluate(() => window.OSAP_EPE.close()); await p.waitForTimeout(300);
  const m7 = await R(p, "#map"), rv7 = await R(p, "#rv"), rl7 = await R(p, ".rail");
  ok(m7.w === 688 && rv7.w === 380 && rl7.x === 1068 && rl7.w === 372, "Reset puts Details and Reports back as they were");
  ok(await p.evaluate(() => localStorage.getItem("osap-panels") === null), "and clears the stored choice");
  // double-click the edge: back to the normal width
  await dragBy(p, '.pngrip.e[data-pn="rv"]', -60, 0);
  ok((await R(p, "#rv")).w === 440, "Reports edge makes it wider");
  await p.dblclick('.pngrip.e[data-pn="rv"]'); await p.waitForTimeout(300);
  ok((await R(p, "#rv")).w === 380, "a double-click on the edge gives the normal width again");
  // keyboard
  await p.focus('.pngrip.e[data-pn="rail"]'); await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(250);
  ok((await R(p, ".rail")).w === 392, "arrow keys on the grip resize by 20 px");
  await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.activeElement && document.activeElement.closest(".pnmenu")), "Enter opens the menu with focus in it");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".pnmenu")), "Escape closes it");
  // the full-screen map hides the grips
  await p.click('#atk-tools [data-atk="full"]'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !document.querySelector(".pngrip.on")), "no grips on the full-screen map");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- a phone and a narrow window: untouched, even with choices stored ----------
for (const [w, h, name] of [[390, 844, "phone"], [860, 900, "narrow window"]]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-panels", JSON.stringify({ rail: { dock: "left", w: 500 }, rv: { dock: "float", f: { x: 10, y: 100, w: 300, h: 300 } }, win: { dock: "float", w: 600 } })); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#kp/timeline", { waitUntil: "domcontentloaded" }); await ready(p);
  ok(await p.evaluate(() => { const c = document.documentElement.classList; return !c.contains("pnl") && ![...c].some((k) => /^pn-/.test(k)); }), name + ": no panel classes");
  ok(await p.evaluate(() => !document.querySelector(".pngrip.on, .pnbar.on") && getComputedStyle(document.querySelector(".rail")).order === "0"), name + ": no grips, Details where it always is");
  await openEvac(p);
  const e = await R(p, "#epe>*");
  ok(w < 700 ? e.x === 0 && e.w === w : e.x + e.w === w, `${name}: the map window sits where it always did (${e.x}+${e.w})`);
  ok(errors.length === 0, name + ": no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await shot(p, "panels-" + name.replace(/ /g, "-"));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
