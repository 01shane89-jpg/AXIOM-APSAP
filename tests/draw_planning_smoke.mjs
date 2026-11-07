// Headless check of Draw, the planning graphics tool (Shane 2026-11-07: "I need to be able to draw on the map ie add shapes and
// items for planning purposes"), assets/osap-draw.js:
//  - a Draw button on the map toolbar (and Plans > Map drawing) opens a palette: lines and arrows, areas, ranges, labels and
//    2525D control measure points;
//  - each item is placed by clicking or tapping the map, saved as one record in "osap-draw", and opens its details sheet: name
//    after its fixed prefix (PL, OBJ...), color, line style, ring distances, sector range, Edit points, Delete with Undo;
//  - a tap on an item opens it again; My places lists it with an on/off box; the workspace KML carries it;
//  - a hostile name or a broken store breaks nothing; a phone can place items with a finger and the card fits the screen.
// Run from the repo root: node tests/draw_planning_smoke.mjs   (needs playwright and Chromium; OUT=dir saves screenshots)
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
async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("t-init")) { sessionStorage.setItem("t-init", "1"); localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-draw", "[]"); } } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.OSAP_DRAW && window.OSAP_PLACES && window.OSAP_ATAK && document.querySelector('#atk-tools [data-atk="draw"]'), null, { timeout: 60000 });
  await p.waitForTimeout(9000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  await p.evaluate(() => { window.TSAP.areaApi.setArea(null); window.__asapMap.setView([14.7938, 100.6694], 15, { animate: false }); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
/* a spot on the map as fractions of its width and height (kept clear of the toolbar on the right) */
const box = (p) => p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
const recs = (p) => p.evaluate(() => window.OSAP_DRAW.all());
const labels = (p) => p.evaluate(() => [...document.querySelectorAll(".dwl")].map((x) => x.textContent));
async function clickAt(p, pts) { for (const [x, y] of pts) { await p.mouse.click(x, y); await p.waitForTimeout(120); } }

// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1366, height: 860 } });
  const B = await box(p), at = (fx, fy) => [Math.round(B.l + B.w * fx), Math.round(B.t + B.h * fy)];
  ok(await p.evaluate(() => { const b = document.querySelector('#atk-tools [data-atk="draw"]'), r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /Draw/.test(b.textContent); }), "toolbar: a Draw button shows on the map toolbar");
  await p.click('#atk-tools [data-atk="draw"]'); await p.waitForTimeout(200);
  const pal = await p.evaluate(() => { const c = document.getElementById("dw-card"); return { shown: !c.hidden, t: c.textContent, pressed: document.querySelector('#atk-tools [data-atk="draw"]').getAttribute("aria-pressed") }; });
  ok(pal.shown && pal.pressed === "true", "toolbar: Draw opens the palette and lights the button");
  ok(["Line", "Arrow", "Phase line", "Boundary", "Limit of advance", "Axis of advance", "Direction of attack", "Objective", "Assembly area", "Engagement area", "Battle position", "Area to avoid", "Circle", "Range rings", "Sector of fire", "Text label", "Checkpoint", "Rally point", "Target reference point", "Observation post"].every((s) => pal.t.includes(s)), "palette: lines, arrows, tactical areas, ranges, labels and control measure points are all listed");
  if (OUT) await p.screenshot({ path: OUT + "/desktop-palette.png" });

  // phase line: three clicks, Finish, then rename
  await p.click('#dw-card [data-dw-t="pl"]');
  await clickAt(p, [at(0.15, 0.55), at(0.4, 0.5), at(0.65, 0.55)]);
  ok(await p.evaluate(() => /3 points/.test(document.getElementById("dw-card").textContent) && !document.querySelector('#dw-card [data-dw-k="finish"]').disabled), "phase line: each click adds a point and Finish is ready");
  await p.click('#dw-card [data-dw-k="finish"]'); await p.waitForTimeout(250);
  let list = await recs(p);
  ok(list.length === 1 && list[0].t === "pl" && list[0].pts.length === 3 && list[0].name === "1" && list[0].cc, "phase line: saved as one record with its points, numbered 1, on this country's map");
  ok(await p.evaluate(() => !document.getElementById("dwdlg").hidden && /Phase line/.test(document.getElementById("dwdlg").textContent)), "phase line: its details open after Finish");
  await p.fill("#dw-name", "RED"); await p.press("#dw-name", "Enter"); await p.waitForTimeout(200);
  ok((await labels(p)).filter((t) => t === "PL RED").length === 2, "phase line: named \"PL RED\" at both ends");
  await p.click('#dwdlg [data-dsw="#e03131"]'); await p.waitForTimeout(150); await p.click('#dwdlg [data-dls="dash"]'); await p.waitForTimeout(150);
  list = await recs(p);
  ok(list[0].col === "#e03131" && list[0].dash === "dash" && list[0].name === "RED", "phase line: color and dashed line kept, the name too");
  ok(await p.evaluate(() => [...document.querySelectorAll(".leaflet-dwpane-pane path")].some((x) => x.getAttribute("stroke") === "#e03131" && x.getAttribute("stroke-dasharray"))), "phase line: drawn red and dashed on the map");
  await p.click('#dwdlg [data-dx="close"]'); await p.waitForTimeout(150);

  // axis of advance: two clicks and Enter
  await p.evaluate(() => window.OSAP_DRAW.start("axis"));
  await clickAt(p, [at(0.15, 0.75), at(0.6, 0.68)]); await p.keyboard.press("Enter"); await p.waitForTimeout(250);
  list = await recs(p);
  ok(list.some((r) => r.t === "axis" && r.pts.length === 2 && r.name === "1"), "axis of advance: two points and Enter keep it");
  await p.evaluate(() => window.OSAP_DRAW.close());

  // objective: four corners, then a click on the last corner again finishes it
  await p.evaluate(() => window.OSAP_DRAW.start("obj"));
  await clickAt(p, [at(0.45, 0.38), at(0.7, 0.38), at(0.7, 0.48), at(0.45, 0.48), at(0.45, 0.48)]); await p.waitForTimeout(250);
  list = await recs(p);
  const obj = list.find((r) => r.t === "obj");
  ok(obj && obj.pts.length === 4, "objective: a second click on the last corner finishes it with four corners");
  ok(await p.evaluate(() => /Area/.test(document.querySelector("#dwdlg .dwfacts").textContent) && (document.querySelector("#dwdlg .dwfacts").textContent.match(/\d+\s*(m²|km²|ha)/) || []).length > 0), "objective: its details give the area");
  ok((await labels(p)).includes("OBJ 1"), "objective: labelled OBJ 1 inside");
  await p.evaluate(() => window.OSAP_DRAW.close());

  // range rings: one click, then the distances typed in
  await p.evaluate(() => window.OSAP_DRAW.start("rings"));
  await clickAt(p, [at(0.2, 0.42)]); await p.waitForTimeout(250);
  list = await recs(p);
  ok(list.some((r) => r.t === "rings" && r.r.length === 3), "range rings: one click places three rings sized to the view");
  await p.fill('#dwdlg [data-df="r"]', "100, 250"); await p.press('#dwdlg [data-df="r"]', "Enter"); await p.waitForTimeout(250);
  list = await recs(p);
  ok(list.find((r) => r.t === "rings").r.join() === "100,250" && (await labels(p)).includes("250 m"), "range rings: typed distances redraw the rings with their labels");
  await p.evaluate(() => window.OSAP_DRAW.close());

  // sector of fire: position, left limit, right limit
  await p.evaluate(() => window.OSAP_DRAW.start("fan"));
  await clickAt(p, [at(0.4, 0.88), at(0.3, 0.8), at(0.5, 0.8)]); await p.waitForTimeout(250);
  list = await recs(p);
  const fan = list.find((r) => r.t === "fan");
  ok(fan && fan.pts.length === 3 && fan.rng > 0, "sector of fire: three clicks keep the position, limits and range");
  const ft = await p.evaluate(() => document.querySelector("#dwdlg .dwfacts").textContent);
  ok(/Left limit/.test(ft) && /Right limit/.test(ft) && /mils/.test(ft) && /° M/.test(ft), "sector of fire: left and right limits in true, magnetic and mils");
  ok((await labels(p)).some((t) => /^L \d{3}° T$/.test(t)) && (await labels(p)).some((t) => /^R \d{3}° T$/.test(t)), "sector of fire: the limits are labelled on the map");
  await p.evaluate(() => window.OSAP_DRAW.close());

  // text label: one click and the text typed in
  p.once("dialog", (d) => d.accept("HOLD HERE"));
  await p.evaluate(() => window.OSAP_DRAW.start("text"));
  await clickAt(p, [at(0.55, 0.62)]); await p.waitForTimeout(300);
  ok((await recs(p)).some((r) => r.t === "text" && r.name === "HOLD HERE") && (await labels(p)).includes("HOLD HERE"), "text label: placed with its text on the map");
  await p.evaluate(() => window.OSAP_DRAW.close());

  // a control measure point: an ordinary saved point with its 2525D symbol
  await p.evaluate(() => window.OSAP_DRAW.palette(true)); await p.click('#dw-card [data-dw-p="cp"]');
  await clickAt(p, [at(0.25, 0.92)]); await p.waitForTimeout(400);
  const cp = await p.evaluate(() => { const x = window.OSAP_ATAK.pts.all().find((q) => /^Checkpoint \d+$/.test(q.n)); return x ? { sym: x.sym, valid: !!(window.OSAP_MSYM && window.OSAP_MSYM.valid(x.sym)) } : null; });
  ok(cp && cp.sym === "ms:10032500001303000000" && cp.valid, "control measure point: a checkpoint is a saved point with its 2525D symbol (" + (cp && cp.sym) + ")");
  await p.evaluate(() => { if (window.OSAP_POINTS) window.OSAP_POINTS.close(); });
  ok(await p.evaluate(() => document.getElementById("dw-card").hidden), "control measure point: the Draw card closes once it is placed");

  // a click on a label opens the item; Edit points; Delete and Undo
  await p.evaluate(() => window.__asapMap.setView([14.7938, 100.6694], 15, { animate: false })); await p.waitForTimeout(300);
  await p.click('.dwl:text("PL RED")'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById("dwdlg").hidden && document.getElementById("dw-name").value === "RED"), "a click on an item's label opens its details again");
  await p.click('#dwdlg [data-dx="edit"]'); await p.waitForTimeout(300);
  const before = (await recs(p)).find((r) => r.t === "pl").pts[0];
  const h = await p.evaluate(() => { const r = document.querySelector(".dwh:not(.dwmv)").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(h[0], h[1]); await p.mouse.down(); await p.mouse.move(h[0] + 30, h[1] + 40, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  const after = (await recs(p)).find((r) => r.t === "pl").pts[0];
  ok(after[0] !== before[0] && after[1] !== before[1], "edit points: dragging the first handle moves that point");
  const mv = await p.evaluate(() => { const r = document.querySelector(".dwh.dwmv").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const b2 = (await recs(p)).find((r) => r.t === "pl").pts;
  await p.mouse.move(mv[0], mv[1]); await p.mouse.down(); await p.mouse.move(mv[0] - 50, mv[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  const a2 = (await recs(p)).find((r) => r.t === "pl").pts;
  ok(a2.every((q, i) => Math.abs(q[0] - b2[i][0]) < 1e-5 && q[1] < b2[i][1]), "edit points: the move handle shifts the whole line west");
  if (OUT) await p.screenshot({ path: OUT + "/desktop-edit.png" });
  await p.click('#dw-card [data-dw-k="done"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".dwh") && !document.getElementById("dwdlg").hidden), "edit points: Done removes the handles and shows the details");
  const n0 = (await recs(p)).length;
  await p.click('#dwdlg [data-dx="remove"]'); await p.waitForTimeout(200);
  ok((await recs(p)).length === n0 - 1 && !(await labels(p)).includes("PL RED") && /PL RED deleted/.test(await p.evaluate(() => document.querySelector(".dwundo").textContent)), "delete: the phase line goes, with Undo offered");
  await p.click(".dwundo button"); await p.waitForTimeout(200);
  ok((await recs(p)).length === n0 && (await labels(p)).includes("PL RED"), "delete: Undo brings it back");

  // My places, Plans, export
  const pl = await p.evaluate(() => { window.OSAP_PLACES.open(); const t = document.body.textContent; return /PL RED/.test(t) && /Phase line/.test(t) && /Sector of fire/.test(t); });
  ok(pl, "My places: drawings are listed with their type");
  const id = (await recs(p)).find((r) => r.t === "pl").id;
  await p.evaluate((id) => { const box = document.querySelector('[data-pli="dw:' + id + '"]'); box.click(); }, id); await p.waitForTimeout(300);
  ok(!(await labels(p)).includes("PL RED"), "My places: its on/off box hides the drawing");
  await p.evaluate((id) => { document.querySelector('[data-pli="dw:' + id + '"]').click(); window.OSAP_PLACES.close(); }, id); await p.waitForTimeout(300);
  ok((await labels(p)).includes("PL RED"), "My places: ticked again, it shows");
  await p.click('#atk-tools [data-atk="plans"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => /Map drawing/.test(document.getElementById("atk-pop").textContent) && !!document.querySelector('#atk-pop [data-pk="draw"]')), "Plans: lists Draw under Map drawing");
  await p.click('#atk-pop [data-pk="draw"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.getElementById("dw-card").hidden), "Plans > Draw opens the palette");
  await p.evaluate(() => window.OSAP_DRAW.palette(false));
  const kml = await p.evaluate(() => window.OSAP_WS.kml());
  ok(/Planning graphics \(Draw\)/.test(kml) && /PL RED/.test(kml) && /Sector of fire/.test(kml) && /<Polygon>/.test(kml), "export: the workspace KML carries the drawings in their own folder");
  ok(await p.evaluate(() => fetch("assets/osap-ws.js").then((r) => r.text()).then((t) => /"osap-draw"/.test(t))), "workspace: drawings are kept per workspace");

  // safety: a hostile name and broken records
  await p.evaluate(() => { const r = window.OSAP_DRAW.all()[0]; r.name = '<img src=x onerror="window.__xss=1">'; localStorage.setItem("osap-draw", JSON.stringify([r, { id: "bad" }, null, 7, { id: "dw-zzzz1", t: "pl", pts: [[999, 0], [1, 1]] }, { id: "dw-zzzz2", t: "__proto__", pts: [[1, 1], [2, 2]] }, { id: "dw-zzzz3", t: "rings", pts: [[1, 1]], r: ["x", -5, 1e9] }])); window.OSAP_DRAW.redraw(); window.OSAP_DRAW.open(r.id); });
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !window.__xss && !document.querySelector("#dwdlg img, .dwl img") && window.OSAP_DRAW.all().length === 2), "safety: a hostile name is shown as text and bad records are dropped");
  ok(await p.evaluate(() => window.OSAP_DRAW.all().find((r) => r.id === "dw-zzzz3").r.join() === "100,200,300"), "safety: rings with no usable distances fall back to 100, 200, 300 m");
  await p.evaluate(() => window.OSAP_DRAW.close());
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- phone: the palette docked at the bottom, a circle placed with a finger ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { const b = document.querySelector('#atk-tools [data-atk="draw"]'); b.scrollIntoView({ block: "nearest" }); });
  await p.tap('#atk-tools [data-atk="draw"]'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => { const c = document.getElementById("dw-card"), r = c.getBoundingClientRect(); return !c.hidden && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.height < innerHeight * 0.6; }), "phone: the palette is docked on screen and leaves the map free");
  ok(await p.evaluate(() => { const c = document.getElementById("dw-card").getBoundingClientRect(), t = document.getElementById("atk-tools").getBoundingClientRect(); return c.right <= t.left; }), "phone: the palette stops short of the map toolbar");
  ok(await p.evaluate(() => [...document.querySelectorAll("#dw-card .dwgrid button")].slice(0, 8).every((b) => { const r = b.getBoundingClientRect(); return r.width >= 40 && r.height >= 44; })), "phone: palette buttons are big enough to tap");
  if (OUT) await p.screenshot({ path: OUT + "/phone-palette.png" });
  await p.tap('#dw-card [data-dw-t="circle"]'); await p.waitForTimeout(200);
  const [x, y] = await p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height * 0.3)]; });
  await p.touchscreen.tap(x, y); await p.waitForTimeout(200); await p.touchscreen.tap(x + 80, y); await p.waitForTimeout(400);
  const c = (await recs(p)).find((r) => r.t === "circle");
  ok(c && c.pts.length === 2, "phone: two taps place a circle");
  ok(await p.evaluate(() => { const b = document.querySelector("#dwdlg .cbox"), r = b && b.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth && /Radius/.test(b.textContent); }), "phone: its details fit the screen");
  ok(await p.evaluate(() => { const r = document.querySelector('#dwdlg [data-dx="remove"]').getBoundingClientRect(); return r.width >= 60 && r.height >= 40; }), "phone: Edit points, Zoom to, Copy and Delete are full-size buttons");
  if (OUT) await p.screenshot({ path: OUT + "/phone-circle.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
