// Headless check of the evacuation planner (EPE phase 1, assets/osap-epe.js): the Evac toolbar button opens it, an origin is
// typed as a grid near Aranyaprathet (Thailand), "Work out the options" routes to the nearest U.S. embassy or consulate, major
// airport, airfield of any size and seaport and lists them as options with OSAP's first choice and an alternate road. Roles are
// the analyst's (none set until picked; one option per role) and stick after a reload; OSAP never proposes "Available" and
// proposes "Blocked" for a road closure reported on the line; the analyst's status is labelled as theirs. The Route tab's
// Evacuation section is a link to Evac, the one-route planner sits folded under it and a plan it kept still opens.
// "Open in Route" hands one option to the Route tab with its checkpoints.
// The routers and Overpass are mocked: OSRM answers a straight line plus a bent alternative, Valhalla a bent line.
// Run from the repo root: node tests/epe_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const START = [13.69, 102.5];
function line(a, b, bend, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, k = Math.sin(Math.PI * t) * bend; out.push([a[0] + (b[0] - a[0]) * t + k, a[1] + (b[1] - a[1]) * t + k]); }
  return out;
}
function km(c) { let m = 0; for (let i = 1; i < c.length; i++) { const dy = (c[i][0] - c[i - 1][0]) * 111000, dx = (c[i][1] - c[i - 1][1]) * 111000 * Math.cos(c[i][0] * Math.PI / 180); m += Math.hypot(dx, dy); } return m; }
function enc6(c) {
  let s = "", pl = 0, po = 0;
  const one = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } s += String.fromCharCode(v + 63); };
  for (const [la, lo] of c) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); one(a - pl); one(b - po); pl = a; po = b; }
  return s;
}
const osrmRoute = (c, kmh) => { const m = km(c); return { distance: m, duration: m / (kmh / 3.6), geometry: { coordinates: c.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: m / (kmh / 3.6), steps: [] }] }; };
const calls = { osrm: 0, valhalla: 0, overpass: 0 };
const J = (r, body) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function context(state) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, ...(state ? { storageState: state } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (/routing\.openstreetmap\.de/.test(u)) {
      calls.osrm++;
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      const a = [cs[0][1], cs[0][0]], b = [cs[1][1], cs[1][0]];
      return J(r, { code: "Ok", routes: [osrmRoute(line(a, b, 0), 80), osrmRoute(line(a, b, 0.05), 70)] });
    }
    if (/valhalla1\.openstreetmap\.de/.test(u)) {
      calls.valhalla++;
      const q = JSON.parse(decodeURIComponent(u.split("json=")[1]));
      const a = [q.locations[0].lat, q.locations[0].lon], b = [q.locations[1].lat, q.locations[1].lon], c = line(a, b, 0.35), m = km(c);
      return J(r, { trip: { summary: { length: m / 1000, time: m / (70 / 3.6) }, legs: [{ shape: enc6(c), summary: { length: m / 1000, time: m / (70 / 3.6) }, maneuvers: [] }] } });
    }
    if (/overpass|maps\.mail\.ru/.test(u)) {
      calls.overpass++;
      const q = decodeURIComponent((r.request().postData() || "").replace(/^data=/, ""));
      if (/aeroway"="runway"/.test(q)) return J(r, { elements: [] });
      return J(r, { elements: [{ type: "node", id: 77, lat: 13.80, lon: 102.62, tags: { aeroway: "airstrip", name: "Test Strip" } }] });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function page(ctx, errors) {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EVAC && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  return p;
}
const st = (p) => p.evaluate(() => window.OSAP_EPE && window.OSAP_EPE.state());

let state;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  /* a plan the older one-route planner kept, to check it still opens from the Route tab */
  await p.evaluate((s) => localStorage.setItem("osap-evac-plans", JSON.stringify([{ id: "ev-old1", name: "A to Old post", cc: "th", saved: new Date().toISOString(), at: Date.now(), days: 30, mode: "car", label: "Recommended", n: 1, nCand: 1,
    wps: [{ lat: s[0], lon: s[1], name: "Start" }, { lat: 13.75, lon: 100.55, name: "Old post" }], route: { coords: [[s[0], s[1]], [13.72, 101.5], [13.75, 100.55]], m: 210000, s: 9000, legs: [{ m: 210000, s: 9000 }], src: "test", note: "", xc: false },
    dest: { k: "posts", cc: "th", i: { id: "x", name: "Old post", lat: 13.75, lon: 100.55 } }, notes: [], exp: { score: 0, hits: [] } }])), START);

  ok(await p.evaluate(() => !!document.querySelector('#atk-tools [data-atk="evac"]')), "Evac button in the map toolbar");
  const order = await p.evaluate(() => [...document.querySelectorAll("#atk-tools [data-atk]")].map((b) => b.getAttribute("data-atk")));
  ok(order.indexOf("evac") === order.indexOf("medplan") + 1, "Evac sits straight after Med plan");
  await p.click('#atk-tools [data-atk="evac"]');
  await p.waitForFunction(() => { const e = document.getElementById("epe"); return e && !e.hidden; }, null, { timeout: 20000 });
  ok(await p.evaluate(() => /Where are the people/.test(document.getElementById("epe").textContent) && document.querySelector('#epe [data-ep="plan"]').disabled), "opens with no origin and asks for one");
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#atk-tools [data-atk="evac"]').getAttribute("aria-pressed") === "true"), "Evac button shows pressed while open");

  /* a road closure reported at the origin: every line starts there, so OSAP proposes Blocked */
  await p.evaluate((s) => { window.ASAP_ROADS = { items: [{ lat: s[0], lon: s[1], kind: "closure", title: "Highway 33 closed by flooding", link: "https://example.org/closure", updated: new Date().toISOString().slice(0, 10) }] }; }, START);
  await p.fill("#epe-q", START.join(", ")); await p.click("#epe-find button[type=submit]");
  await p.waitForTimeout(300);
  const o1 = await st(p);
  ok(o1.origin && Math.abs(o1.origin.lat - START[0]) < 1e-6 && /Typed grid/.test(o1.origin.how), "a typed grid sets the origin");
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return s.plan || (!s.busy && /No evacuation options/.test(s.msg)); }, null, { timeout: 90000 });
  let s1 = await st(p);
  ok(!!s1.plan, "options worked out from a Thailand origin" + (s1.plan ? "" : ": " + s1.msg));
  const opts = s1.plan ? s1.plan.opts : [];
  const kinds = [...new Set(opts.map((o) => o.kind))];
  ok(opts.length >= 4 && opts.length <= 6, "4 to 6 options (" + opts.length + ": " + opts.map((o) => o.kind + (o.alt ? "/alt" : "")).join(", ") + ")");
  ok(["posts", "airports", "seaports"].every((k) => kinds.includes(k)), "embassy, major airport and seaport each have an option (" + kinds.join(", ") + ")");
  ok(kinds.includes("airfields") || (s1.plan && s1.plan.notes.some((n) => /airfield/i.test(n))), "airfield of any size listed or explained");
  ok(opts[0] && opts[0].first && /first choice/.test(opts[0].label), "OSAP's first choice is listed first");
  ok(opts.some((o) => o.alt && o.dest.i.name === opts[0].dest.i.name), "an alternate road to the first choice's destination is offered");
  ok(opts.every((o) => !o.role), "no roles set until the analyst picks them");
  ok(opts.map((o) => o.sug).join("") === "PACE".slice(0, Math.min(4, opts.length)), "suggested order P, A, C, E");
  ok(opts.every((o) => o.prop.st === "Blocked" && /Highway 33 closed/.test(o.prop.why)), "a closure on the line: OSAP proposes Blocked and says why");
  ok(opts.every((o) => o.route.coords.length > 5 && o.route.m > 0 && o.route.s > 0), "every option has a line, distance and time");
  ok(await p.evaluate(() => document.querySelectorAll("#epe .epecard").length) === opts.length, "a status card per option");
  ok(await p.evaluate(() => /Z/.test(document.querySelector("#epe .epekpi").textContent) && /worked out/.test(document.querySelector("#epe h3 .obs").textContent)), "arrival and worked-out times shown in Zulu");
  const lines = (await st(p)).drawn;
  ok(lines >= opts.length * 2 + 1, "the options, their destinations and the origin are drawn on the map (" + lines + " layers)");
  ok(calls.osrm >= 4, "routed with the routers (" + calls.osrm + " OSRM, " + calls.valhalla + " Valhalla, " + calls.overpass + " Overpass calls)");

  /* plan again without the closure: no report is not a clearance */
  await p.evaluate(() => { window.ASAP_ROADS = { items: [] }; });
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.busy && s.plan; }, null, { timeout: 90000 });
  s1 = await st(p);
  ok(s1.plan.opts.every((o) => o.prop.st !== "Available"), "OSAP never proposes Available");
  ok(s1.plan.opts.some((o) => o.prop.st === "Unknown" && /not a clearance/.test(o.prop.why)), "no report shows as Unknown, not clear");

  /* roles: the suggested set, then one changed; one option per role */
  await p.click('#epe [data-ep="sug"]');
  let r = (await st(p)).plan.opts.map((o) => o.role).join("");
  ok(r === "PACE".slice(0, Math.min(4, s1.plan.opts.length)), "Use suggested roles sets P, A, C, E (" + r + ")");
  const third = s1.plan.opts[2].id;
  await p.selectOption('#epe [data-ep-role="' + third + '"]', "P");
  const s2 = await st(p);
  ok(s2.plan.opts.find((o) => o.id === third).role === "P" && s2.plan.opts.filter((o) => o.role === "P").length === 1, "a role moved to another option leaves the first without it");
  await p.selectOption('#epe [data-ep-st="' + third + '"]', "Available");
  const s3 = await st(p), o3 = s3.plan.opts.find((o) => o.id === third);
  ok(o3.st === "Available" && o3.stBy > 0, "the analyst can set Available");
  ok(await p.evaluate((id) => /Set by you/.test(document.querySelector('#epe [data-ep-opt="' + id + '"]').textContent), third), "the card says the analyst set it");
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-epe-plans") || "[]"));
  ok(kept.length === 2 && kept[0].opts.find((o) => o.id === third).role === "P", "plans kept on the device with their roles");
  if (OUT) await p.screenshot({ path: OUT + "/epe.png" });

  /* the long-press ring has Evacuate from here */
  await p.evaluate(() => { document.getElementById("epe").hidden || window.OSAP_EPE.close(); });
  const box = await p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + r.width * 0.4, y: r.top + r.height * 0.5 }; });
  await p.mouse.click(box.x, box.y, { button: "right" }); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !!document.querySelector('#atk-ring:not([hidden]) [data-rk="plans"]') && document.querySelectorAll("#atk-ring [data-rk]").length === 10), "long-press ring has Plans (9 actions and close)");
  if (await p.evaluate(() => !!document.querySelector('#atk-ring:not([hidden]) [data-rk="plans"]'))) {
    await p.click('#atk-ring [data-rk="plans"]'); await p.waitForTimeout(200);
    ok(/Evacuate from here/.test(await p.textContent("#atk-pop")), "Plans lists Evacuate from here");
    await p.click('#atk-pop [data-pk="evac"]'); await p.waitForTimeout(400);
    const s4 = await st(p);
    ok(s4.origin && /Long-press/.test(s4.origin.how) && !s4.plan, "Evacuate from here sets that point as a new origin");
  }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  /* after a reload: the plan and its roles are back; Route tab link and the older kept plan */
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  let s = await st(p);
  /* the last kept plan is the one with roles (the ring opened a new origin, not yet planned) */
  ok(await p.evaluate(() => document.querySelectorAll("#epe .epekept li").length) === 2, "both kept plans listed after a reload");
  await p.click("#epe .epekept [data-ep-open]");
  s = await st(p);
  ok(s.plan && s.plan.opts.some((o) => o.role === "P") && s.plan.opts.some((o) => o.st === "Available"), "roles and the analyst's status stick after a reload");
  /* Open in Route: the selected option with its checkpoints */
  await p.click('#epe [data-ep="route"]');
  await p.waitForFunction(() => /Option from the evacuation plan/.test((document.getElementById("rt-evres") || {}).textContent || ""), null, { timeout: 30000 }).catch(() => {});
  const rt = await p.evaluate(() => ({ txt: (document.getElementById("rt-evres") || {}).textContent || "", rows: document.querySelectorAll("#rt-evres .rtcps tbody tr").length, epe: !document.getElementById("epe").hidden }));
  ok(/Option from the evacuation plan/.test(rt.txt) && rt.rows >= 3, "Open in Route shows the option with its checkpoints (" + rt.rows + " rows)");
  ok(!rt.epe, "the Evac window steps aside for the Route tab");
  /* the Route tab: a link to Evac, the one-route planner folded, the older kept plan still opens */
  const tab = await p.evaluate(() => ({ link: !!document.querySelector('#rt-evac [data-rt="epe"]'), fold: !!document.getElementById("rt-evone") && !document.getElementById("rt-evone").open, old: !!document.querySelector('#rt-evsaved [data-evopen="ev-old1"]') }));
  ok(tab.link && tab.fold, "Route tab: Plan an evacuation (Evac) link, one-route planner folded under it");
  ok(tab.old, "a plan the one-route planner kept is still listed");
  if (tab.old) {
    await p.click('#rt-evsaved [data-evopen="ev-old1"]'); await p.waitForTimeout(800);
    ok(/Kept plan from/.test(await p.textContent("#rt-evres")), "and it still opens");
  }
  await p.click('#rt-evac [data-rt="epe"]');
  await p.waitForFunction(() => !document.getElementById("epe").hidden, null, { timeout: 10000 });
  s = await st(p);
  const wa = await p.evaluate(() => window.OSAP_ROUTETAB.state().wps[0]);
  ok(s.origin && wa && Math.abs(s.origin.lat - wa.lat) < 1e-5 && Math.abs(s.origin.lon - wa.lon) < 1e-5, "the Route tab link opens Evac from waypoint A");
  ok(!errors.length, "after reload: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
{
  /* phone: the window docks to the bottom half so the map stays usable */
  const errors = [], ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await page(ctx, errors);
  await p.evaluate((s) => window.OSAP_EPE_GO({ at: s, how: "test" }), START);
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 }); await p.waitForTimeout(300);
  const g = await p.evaluate(() => { const b = document.querySelector("#epe .epebox").getBoundingClientRect(); return { top: b.top, h: b.height, vh: innerHeight }; });
  ok(g.top > g.vh * 0.45 && g.h <= g.vh * 0.51, "phone: Evac takes the bottom half (top " + Math.round(g.top) + " of " + g.vh + ")");
  if (OUT) await p.screenshot({ path: OUT + "/epe-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
