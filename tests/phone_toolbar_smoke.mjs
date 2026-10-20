// Headless check of the one-handed phone toolbar and the grouped locked tools (assets/osap-toolbar.js).
// Phone (390x844): the map's tools are a bar along the bottom with 4 tools and More; More opens a sheet with every other tool,
// and each one opens from there; tools used more often move onto the bar, one place at a time, and stay after a reload;
// the bar does not cover the list sheet's handle, the grid readout, the legend or the scale; nothing scrolls sideways.
// Desktop: the rail down the right is unchanged. On a stand-in for the Netlify site (the real account and gate functions,
// a stand-in for Netlify Identity, as tests/tier_smoke.mjs): a Free account sees one grouped locked entry (rail) or one row
// per plan (phone sheet) instead of a padlock on each tool, and it opens the plans, never the tool; Full sees no locked entry.
// Run from the repo root: node tests/phone_toolbar_smoke.mjs   (needs playwright, Chromium and npm ci --prefix netlify)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd(), OUT = process.env.OUT || "";
const users = { "tok-free": { id: "00000000-0000-4000-8000-000000000001", email: "free@test", roles: [] }, "tok-full": { id: "00000000-0000-4000-8000-000000000003", email: "full@test", roles: ["full"] } };
const meta = {}; for (const t in users) meta[users[t].id] = { roles: users[t].roles };
const asAdmin = (who) => ({ id: who.id, email: who.email, created_at: "2026-10-01T00:00:00Z", confirmed_at: "2026-10-01T00:05:00Z", app_metadata: meta[who.id] });
let gate = false, base = "";
async function file(res, p) {
  try { const body = await readFile(join(root, p)); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}
async function send(res, r) { const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); }
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (p.startsWith("AXIOM-APSAP/")) return file(res, p.slice("AXIOM-APSAP/".length));
  if (!gate) return file(res, p);
  const R = new Request(base + req.url.slice(1), { method: req.method, headers: req.headers, body: /GET|HEAD/.test(req.method) ? undefined : await body(req) });
  if (p.startsWith(".netlify/identity/")) {
    const what = p.slice(".netlify/identity/".length);
    if (what === "user") {
      const who = users[(req.headers.authorization || "").replace(/^Bearer /, "")];
      if (!who) { res.writeHead(401); res.end("{}"); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(asAdmin(who))); return;
    }
    if (what.startsWith("admin/users")) {
      if (req.headers.authorization !== "Bearer op-token") { res.writeHead(401); res.end("{}"); return; }
      const id = what.split("/")[2], who = Object.values(users).find((x) => x.id === id);
      res.writeHead(200, { "content-type": "application/json" });
      if (!id) { res.end(JSON.stringify({ users: Object.values(users).map(asAdmin) })); return; }
      if (req.method === "PUT") { const b = JSON.parse(await R.text()); if (b.app_metadata) meta[id] = b.app_metadata; }
      res.end(JSON.stringify(asAdmin(who))); return;
    }
    res.writeHead(404); res.end("{}"); return;
  }
  if (p === "api/osap-account") return send(res, await ACCOUNT(R));
  if (/^(data|source)\//.test(p)) { const r = await GATE(R); if (r) return send(res, r); return file(res, p); }
  return file(res, p);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
base = `http://127.0.0.1:${server.address().port}/`;
const env = { OSAP_DATA_ORIGIN: base + "AXIOM-APSAP", OSAP_OWNERS: "" };
globalThis.Netlify = { env: { get: (k) => env[k] } };
globalThis.netlifyIdentityContext = { url: base + ".netlify/identity", token: "op-token" };
const GATE = (await import("../netlify/edge-functions/osap-data.js")).default;
const ACCOUNT = (await import("../netlify/functions/osap-account.mjs")).default;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1400, height: 900 } };
async function open(opts, token) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  if (token) await ctx.addInitScript({ content: "try{localStorage.setItem('osap-auth',JSON.stringify({access_token:'" + token + "',refresh_token:'" + token + "',until:Date.now()+3600e3}));document.cookie='nf_jwt=" + token + "; path=/'}catch(e){}" });
  const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await load(p);
  return { ctx, p, errors };
}
async function load(p) {
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_TOOLBAR, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(500);
}
/* the buttons a person can see in the toolbar, with where they are */
const visible = (p) => p.evaluate(() => [...document.querySelectorAll("#atk-tools button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== "hidden"; })
  .map((b) => { const r = b.getBoundingClientRect(); return { k: b.getAttribute("data-atk") || (b.hasAttribute("data-o3d") ? "3d" : b.getAttribute("data-ogrid") ? "grid-" + b.getAttribute("data-ogrid") : b.getAttribute("data-tb") || b.id || (b.hasAttribute("data-an-btn") ? "analyst" : "?")), l: (b.getAttribute("aria-label") || "").trim(), x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right, lock: b.getAttribute("data-tier-need") }; }));
const rect = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width || r.height ? { t: r.top, b: r.bottom, l: r.left, r: r.right } : null; }, s);
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
const more = (p) => p.click('#atk-tools [data-tb="more"]');
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
/* the tools in the sheet, by key (every tool that is not on the bar) */
async function sheetTools(p) { const v = await visible(p); return v.filter((b) => b.y < (v.find((x) => x.k === "more") || { y: 1e9 }).y - 2); }
async function tapFromMore(p, sel) { await more(p); await p.waitForTimeout(150); await p.click("#atk-tools " + sel); await p.waitForTimeout(350); }
async function tidy(p) {
  await p.keyboard.press("Escape"); await p.waitForTimeout(100);
  await p.evaluate(() => {
    const om = document.getElementById("atk-om"); if (om && !om.hidden) om.querySelector("[data-om=x]").click();
    const pop = document.getElementById("atk-pop"); if (pop) pop.hidden = true;
    if (window.OSAP_MEASURE) window.OSAP_MEASURE.on(false);
    if (window.OSAP_MEDPLAN) try { window.OSAP_MEDPLAN.close(); } catch (e) {}
    if (window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen()) window.OSAP_SEARCH.close();
    window.OSAP_TOOLBAR.close();
    if (window.ASAP_PHONE && window.ASAP_PHONE.setSheet) window.ASAP_PHONE.setSheet("bar");
  });
  await p.waitForTimeout(150);
}

// ---------- phone, no gate ----------
let deskKeys = null;
{
  const { ctx, p, errors } = await open(PHONE);
  ok(await p.evaluate(() => document.documentElement.classList.contains("atk-ph") && window.OSAP_TOOLBAR.phone()), "phone: bottom bar mode on at 390 px");
  let v = await visible(p);
  ok(v.map((b) => b.k).join() === "today,search,datasets,weather,more", "phone: the bar shows Today, Search, Data sets, Weather and More: " + v.map((b) => b.k).join());
  ok(v.every((b) => b.w >= 44 && b.h >= 44), "phone: every bar button is at least 44 px: " + v.map((b) => Math.round(b.w) + "x" + Math.round(b.h)).join(" "));
  ok(v.every((b) => Math.abs(b.y - v[0].y) < 1) && v.every((b, i) => !i || b.x > v[i - 1].x), "phone: one row, left to right");
  const g = { bar: await rect(p, "#atk-tools"), hd: await rect(p, "#rail-handle"), rd: await rect(p, "#atk-bar"), lg: await rect(p, ".leaflet-bottom.leaflet-left"), sc: await rect(p, ".o3s"), map: await rect(p, "#map") };
  ok(g.bar.b <= g.hd.t + 0.5, "phone: the bar sits above the list sheet's handle " + JSON.stringify([g.bar.b, g.hd.t]));
  ok(g.bar.t >= g.rd.b - 0.5, "phone: the bar sits below the grid readout, not over it " + JSON.stringify([g.bar.t, g.rd.b]));
  ok(g.lg.b <= g.rd.t + 0.5 && (!g.sc || g.sc.b <= g.rd.t + 0.5) && g.lg.b <= g.bar.t, "phone: legend and scale clear of the readout and the bar " + JSON.stringify([g.lg, g.sc]));
  ok(g.map.b <= g.bar.t + 0.5, "phone: the map ends where the bar starts");
  ok(await sideways(p) <= 0, "phone: nothing scrolls sideways");
  ok(await p.evaluate(() => { const t = document.getElementById("atk-tools"), cs = getComputedStyle(t); return cs.position === "fixed" && /env|px/.test(cs.bottom); }), "phone: the bar is fixed to the screen");
  if (OUT) await p.screenshot({ path: OUT + "/phone-bar.png" });

  // More: every other tool, in a grid, over the map and not over the list sheet's handle
  await more(p); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.OSAP_TOOLBAR.isOpen() && document.querySelector('#atk-tools [data-tb="more"]').getAttribute("aria-expanded") === "true"), "phone: More opens the sheet");
  const rail = await p.evaluate(() => [...document.querySelectorAll("#atk-tools .atk-list > button")].filter((b) => !b.hidden && b.getAttribute("data-atk") !== "layout" && b.getAttribute("data-atk") !== "fold" && !b.classList.contains("atk-tbgrp") && !b.classList.contains("atk-pin")).map((b) => b.getAttribute("aria-label")));
  const sh = await sheetTools(p);
  const inSheet = sh.map((b) => b.l);
  ok(rail.length >= 14 && rail.every((l) => inSheet.includes(l)), "phone: the sheet lists every other tool (" + rail.length + "): " + inSheet.join(", "));
  ok(inSheet.includes("Settings"), "phone: Settings is in the sheet");
  ok(sh.every((b) => b.w >= 44 && b.h >= 44 && b.x >= 0 && b.r <= 390), "phone: sheet tools are at least 44 px and on the screen");
  ok(new Set(sh.map((b) => Math.round(b.y))).size >= 3 && new Set(sh.map((b) => Math.round(b.x))).size >= 4, "phone: the sheet is a grid");
  ok(sh.every((b) => !/Today|Search|Data sets|Weather/.test(b.l)), "phone: the bar's own tools are not repeated in the sheet");
  const hd2 = await rect(p, "#rail-handle"), st = await rect(p, "#atk-tools");
  ok(st.b <= hd2.t + 0.5 && st.t >= 0, "phone: the sheet stays above the list sheet's handle " + JSON.stringify([st, hd2.t]));
  ok(await sideways(p) <= 0, "phone: the open sheet does not scroll sideways");
  if (OUT) await p.screenshot({ path: OUT + "/phone-more.png" });
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  ok(!(await p.evaluate(() => window.OSAP_TOOLBAR.isOpen())), "phone: Escape closes the sheet");
  await more(p); await p.waitForTimeout(150); await p.mouse.click(195, 200); await p.waitForTimeout(150);
  ok(!(await p.evaluate(() => window.OSAP_TOOLBAR.isOpen())), "phone: a tap outside closes the sheet");

  // each tool opens from the sheet
  const before = await p.evaluate(() => window.OSAP_TOOLBAR.counts());
  await tapFromMore(p, '[data-atk="overlays"]');
  ok(await p.evaluate(() => { const o = document.getElementById("atk-om"); return !o.hidden && o.getAttribute("data-mode") === "overlays"; }) && !(await p.evaluate(() => window.OSAP_TOOLBAR.isOpen())), "phone: Overlays opens from More, and the sheet closes");
  const om = await rect(p, "#atk-om"), bar2 = await rect(p, "#atk-tools");
  ok(om.b <= bar2.t + 0.5, "phone: the Overlays sheet sits above the bar, so the bar stays usable");
  await p.click('#atk-tools [data-atk="weather"]'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => document.getElementById("atk-om").getAttribute("data-mode") === "weather"), "phone: Weather on the bar switches the open sheet");
  await tidy(p);
  await tapFromMore(p, '[data-atk="basemap"]');
  const pop = await rect(p, "#atk-pop");
  ok(pop && pop.l >= 0 && pop.r <= 390 && pop.b <= (await rect(p, "#atk-bar")).t + 1 && await p.evaluate(() => document.getElementById("atk-pop")._for === "basemap"), "phone: Base map opens its menu at the foot of the map, on the screen " + JSON.stringify(pop));
  await tidy(p);
  await tapFromMore(p, '[data-ogrid="lines"]');
  ok(await p.getAttribute('#atk-tools [data-ogrid="lines"]', "aria-pressed") === "true", "phone: Grid switches on from More");
  await tapFromMore(p, '[data-ogrid="lines"]');
  await tidy(p);
  await tapFromMore(p, '[data-atk="area"]');
  ok(await p.evaluate(() => { const m = document.getElementById("atk-pop"); return !m.hidden && m._for === "area" && !!m.querySelector('[data-pk="lasso"]'); }), "phone: Area opens its shapes menu");
  await tidy(p);
  await tapFromMore(p, '[data-atk="point"]');
  ok(await p.evaluate(() => { const m = document.getElementById("atk-pop"); return !m.hidden && m._for === "point"; }), "phone: Point opens its menu");
  await tidy(p);
  await tapFromMore(p, '[data-atk="medplan"]'); await p.waitForTimeout(400);
  ok(await shown(p, "#medplan"), "phone: Med plan opens");
  await tidy(p);
  await tapFromMore(p, "#tidy-reptool");
  ok(await shown(p, "#tidy-pop") && await p.evaluate(() => document.getElementById("tidy-pop").classList.contains("tprep")), "phone: Reports opens the reports menu");
  await tidy(p);
  await tapFromMore(p, '[data-tb="set"]');
  ok(await shown(p, "#tidy-pop") && await p.evaluate(() => !!document.querySelector('#tidy-pop [data-tp="@guide"]')), "phone: Settings opens from the sheet");
  await tidy(p);
  for (const k of ["route", "comms", "evac", "watch", "mine", "3d", "grid-cross"]) {
    const sel = k === "3d" ? "[data-o3d]" : k === "grid-cross" ? '[data-ogrid="cross"]' : '[data-atk="' + k + '"]';
    if (!(await p.evaluate((s) => { const b = document.querySelector("#atk-tools " + s); return !!b && !b.hidden; }, sel))) continue;
    await tapFromMore(p, sel);
    const c = await p.evaluate((k) => window.OSAP_TOOLBAR.counts()[k] || 0, k);
    ok(c >= 1, "phone: " + k + " reached its tool from the sheet");
    if (k === "3d") { await p.evaluate(() => { const x = document.querySelector("#o3d [data-o3=close], #o3d .o3-close"); if (x) x.click(); }); await p.keyboard.press("Escape"); }
    if (k === "grid-cross") await tapFromMore(p, sel);
    await tidy(p);
  }
  ok((before.overlays || 0) === 0, "phone: nothing was counted before use");

  // learning: a tool used 3 more times than the least-used one on the bar takes that place; the others stay put
  await p.evaluate(() => { localStorage.removeItem("osap-tb-use"); localStorage.removeItem("osap-tb-pins"); window.OSAP_TOOLBAR.paint(); });
  const x0 = (await visible(p)).filter((b) => b.k !== "more").map((b) => Math.round(b.x));
  await p.click('#atk-tools [data-atk="search"]'); await p.waitForTimeout(300); await tidy(p);
  for (let i = 0; i < 2; i++) { await tapFromMore(p, '[data-atk="measure"]'); await tidy(p); }
  ok((await visible(p)).map((b) => b.k).join() === "today,search,datasets,weather,more", "phone: two uses do not move the bar yet");
  await tapFromMore(p, '[data-atk="measure"]'); await tidy(p); await p.waitForTimeout(200);
  v = await visible(p);
  ok(v.map((b) => b.k).join() === "today,search,datasets,measure,more", "phone: after 3 uses Measure takes the least-used place: " + v.map((b) => b.k).join());
  ok(v.filter((b) => b.k !== "more").map((b) => Math.round(b.x)).every((x, i) => x === x0[i]), "phone: the other tools keep their places");
  await tapFromMore(p, '[data-atk="weather"]'); await tidy(p);
  ok((await visible(p)).map((b) => b.k).join() === "today,search,datasets,measure,more", "phone: one use of Weather does not swap it straight back");
  await load(p);
  ok((await visible(p)).map((b) => b.k).join() === "today,search,datasets,measure,more", "phone: the learned bar stays after a reload");
  await p.click('#atk-tools [data-atk="measure"]'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => document.querySelector('#atk-tools [data-atk="measure"]').getAttribute("aria-pressed") === "true" && !document.getElementById("meas-card").hidden), "phone: Measure works from its new place on the bar");
  await tidy(p);

  // the list sheet pulled up half way carries the bar with it; the full list covers the map and the bar
  await p.evaluate(() => window.ASAP_PHONE.setSheet("half")); await p.waitForTimeout(500);
  const hb = { bar: await rect(p, "#atk-tools"), rail: await rect(p, ".rail") };
  ok(hb.bar && Math.abs(hb.bar.b - hb.rail.t) < 2, "phone: with the list half way up, the bar sits on top of it " + JSON.stringify(hb));
  await p.click('#atk-tools [data-atk="search"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen()), "phone: and its tools still work there");
  await tidy(p);
  await p.evaluate(() => window.ASAP_PHONE.setSheet("full")); await p.waitForTimeout(400);
  ok(!(await shown(p, "#atk-tools")), "phone: the full list hides the bar");
  await p.evaluate(() => window.ASAP_PHONE.setSheet("bar")); await p.waitForTimeout(400);
  // full screen: the bar moves to the foot of the screen, inside the safe area, with the readout above it
  await tapFromMore(p, '[data-atk="full"]'); await p.waitForTimeout(500);
  const f = { bar: await rect(p, "#atk-tools"), rd: await rect(p, "#atk-bar") };
  ok(await p.evaluate(() => document.documentElement.classList.contains("mapfull")) && Math.abs(f.bar.b - 844) < 1 && f.rd.b <= f.bar.t + 0.5, "phone: full screen keeps the bar at the foot, under the readout " + JSON.stringify(f));
  await p.click('#atk-tools [data-tb="more"]'); await p.click('#atk-tools [data-atk="full"]'); await p.waitForTimeout(400);
  ok(!(await p.evaluate(() => document.documentElement.classList.contains("mapfull"))), "phone: Full again leaves full screen");
  ok(await sideways(p) <= 0, "phone: still nothing sideways");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- desktop, no gate: the rail as before ----------
{
  const { ctx, p, errors } = await open(DESK);
  ok(!(await p.evaluate(() => document.documentElement.classList.contains("atk-ph"))), "desktop: no bottom bar mode");
  const v = await visible(p), t = await rect(p, "#atk-tools"), m = await rect(p, "#map");
  deskKeys = v.map((b) => b.k);
  ok(deskKeys[0] === "fold" && deskKeys.slice(1, 5).join() === "today,search,datasets,weather" && deskKeys.includes("full") && !deskKeys.includes("more") && !deskKeys.includes("group"), "desktop: the rail keeps every tool, no More, no locked entry: " + deskKeys.join());
  ok(m.r - t.r < 12 && t.r - t.l <= 60 && v.every((b, i) => !i || b.y > v[i - 1].y), "desktop: the rail is a slim column down the right");
  ok(await p.evaluate(() => getComputedStyle(document.getElementById("atk-tools")).position) === "absolute", "desktop: the rail sits in the map as before");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- the Netlify site (gate on) ----------
gate = true;
{
  const { ctx, p, errors } = await open(DESK, "tok-free");
  ok(await p.evaluate(() => window.OSAP_TIER && window.OSAP_TIER.on() && window.OSAP_TIER.tier() === "free"), "Free (desktop): the plan is Free");
  const v = await visible(p), locked = v.filter((b) => b.lock);
  ok(locked.length === 1 && locked[0].k === "group" && /More with Mid/.test(locked[0].l), "Free (desktop): one grouped locked entry, not a padlock on each tool: " + JSON.stringify(locked.map((b) => b.l)));
  ok(v[v.length - 1].k === "group", "Free (desktop): the locked entry is at the end of the rail");
  ok(["overlays", "route", "area", "mine", "3d"].every((k) => !v.some((b) => b.k === k)) && ["today", "search", "datasets", "weather", "measure"].every((k) => v.some((b) => b.k === k)), "Free (desktop): locked tools leave the rail, free ones stay");
  ok(await p.evaluate(() => document.querySelectorAll('#atk-tools [data-atk="overlays"][data-tier-need]').length === 1), "Free (desktop): the locked tools still carry their lock");
  await p.click('#atk-tools [data-tb="group"]'); await p.waitForTimeout(400);
  const d = await p.evaluate(() => { const d = document.getElementById("tierdlg"); return d && !d.hidden ? d.textContent : ""; });
  ok(/Plan and sign-in/.test(d) && /Mid adds Overlays/.test(d) && /Full adds My work/.test(d), "Free (desktop): the locked entry opens the plans, saying what each plan adds: " + d.slice(0, 160));
  ok(!(await shown(p, "#atk-om")), "Free (desktop): no tool opened");
  await p.click("#tierdlg .x");
  await p.evaluate(() => document.querySelector('#atk-tools [data-atk="overlays"]').click()); await p.waitForTimeout(300);
  ok(await shown(p, "#tierdlg") && !(await shown(p, "#atk-om")), "Free (desktop): a locked tool pressed by a script still opens the plans, not the tool");
  ok(errors.length === 0, "Free (desktop): no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open(PHONE, "tok-free");
  let v = await visible(p);
  ok(v.map((b) => b.k).join() === "today,search,datasets,weather,more" && !v.some((b) => b.lock), "Free (phone): the bar has 4 free tools and More, no padlocks: " + v.map((b) => b.k).join());
  await more(p); await p.waitForTimeout(200);
  v = await visible(p);
  const locked = v.filter((b) => b.lock);
  ok(locked.length === 2 && /^Mid tools/.test(locked[0].l) && /^Full tools/.test(locked[1].l), "Free (phone): one Mid tools row and one Full tools row in the sheet: " + JSON.stringify(locked.map((b) => b.l)));
  ok(locked.every((b) => b.h >= 44 && b.w > 300), "Free (phone): the plan rows are wide and at least 44 px tall");
  ok(!v.some((b) => ["overlays", "route", "area", "3d", "mine"].includes(b.k)), "Free (phone): locked tools are not listed one by one");
  ok(v.some((b) => b.k === "measure") && v.some((b) => b.k === "basemap"), "Free (phone): free tools are in the sheet");
  ok(await sideways(p) <= 0, "Free (phone): nothing scrolls sideways");
  if (OUT) await p.screenshot({ path: OUT + "/phone-free-more.png" });
  await p.click('#atk-tools .atk-tblock[data-tier-need="mid"]'); await p.waitForTimeout(400);
  const d = await p.evaluate(() => { const d = document.getElementById("tierdlg"); return d && !d.hidden ? d.textContent : ""; });
  ok(/Plan and sign-in/.test(d) && /Mid adds/.test(d), "Free (phone): Mid tools opens the plans: " + d.slice(0, 120));
  ok(!(await shown(p, "#atk-om")) && !(await shown(p, "#medplan")), "Free (phone): no tool opened");
  ok(errors.length === 0, "Free (phone): no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open(DESK, "tok-full");
  const v = await visible(p);
  ok(!v.some((b) => b.lock) && !v.some((b) => b.k === "group") && v.map((b) => b.k).join() === deskKeys.join(), "Full (desktop): no locked entry, the same rail as with no gate");
  ok(errors.length === 0, "Full (desktop): no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open(PHONE, "tok-full");
  await more(p); await p.waitForTimeout(200);
  const v = await visible(p);
  ok(!v.some((b) => b.lock) && !(await shown(p, "#atk-tools .atk-tblocks")) && ["overlays", "route", "area", "mine"].every((k) => v.some((b) => b.k === k)), "Full (phone): no plan rows in More, every tool listed: " + v.map((b) => b.k).join());
  ok(errors.length === 0, "Full (phone): no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
