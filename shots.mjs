// OSAP walkthrough videos: one short captioned screen recording per feature in the user guide (assets/osap-guide.js).
// Keyless: a local copy of the app, Playwright's own video recorder, captions and a cursor dot drawn on the page, no accounts.
// Map tiles, routing and elevation come from the live services, so run it where the browser can reach them (a GitHub Actions
// runner: .github/workflows/walkthrough.yml); in a sandbox the map background stays grey (OFFLINE=1 blocks outside hosts).
// Run from the repo root: node tools/walkthrough.mjs   (OUT=dir, default walkthrough; ONLY=name,name records some videos only)
// Each video is OUT/<nn>-<name>.webm, 1280x720. One failing scene leaves the rest.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const OUT = process.env.OUT || "shots"; const LOG = [];
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp", ".css": "text/css" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(OUT, { recursive: true });
const W = 1280, H = 720;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
// Chiang Mai: hills for the terrain tools, hospitals for the medical plan, roads for routes
const AT = [18.79, 98.98];

/* ---------- helpers, bound to one page ---------- */
function kit(p) {
  const k = {};
  k.wait = (ms) => p.waitForTimeout(ms);
  k.n = 0; k.cur = null;
  k.shot = async () => {
    if (!k.cur) return;
    await p.evaluate(() => { for (const id of ["wt-cap", "wt-cur"]) { const e = document.getElementById(id); if (e) e.style.visibility = "hidden"; } });
    await p.waitForTimeout(400);
    const f = `${k.tag}-${String(++k.n).padStart(2, "0")}.jpg`;
    await p.screenshot({ path: join(OUT, f), type: "jpeg", quality: 92 });
    LOG.push(`${f}\t${k.cur}`); console.log("  shot", f, k.cur);
    await p.evaluate(() => { for (const id of ["wt-cap", "wt-cur"]) { const e = document.getElementById(id); if (e) e.style.visibility = ""; } });
  };
  k.caption = async (text, sub) => { await k.shot(); k.cur = text; return k.cap0(text, sub); };
  k.cap0 = (text, sub) => p.evaluate(([t, s]) => {
    let c = document.getElementById("wt-cap");
    if (!c) {
      c = document.createElement("div"); c.id = "wt-cap";
      c.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:80%;padding:12px 22px;border-radius:12px;background:rgba(10,18,32,.9);color:#fff;font:600 22px/1.3 system-ui,Segoe UI,Arial,sans-serif;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none";
      document.body.appendChild(c);
    }
    c.innerHTML = ""; const a = document.createElement("div"); a.textContent = t; c.appendChild(a);
    if (s) { const b = document.createElement("div"); b.textContent = s; b.style.cssText = "font-weight:400;font-size:16px;opacity:.85;margin-top:4px"; c.appendChild(b); }
    c.style.display = "";
  }, [text, sub || ""]);
  k.nocap = () => p.evaluate(() => { const c = document.getElementById("wt-cap"); if (c) c.style.display = "none"; });
  k.t0 = Date.now(); k.marks = []; k.skip = null;
  // a stretch of waiting to cut from the video: from skipFrom() to skipTo(), seconds from the page's start
  k.skipFrom = () => { k.skip = [(Date.now() - k.t0) / 1000]; };
  k.skipTo = () => { if (k.skip) k.skip[1] = (Date.now() - k.t0) / 1000; };
  k.title = async () => {}; k.title0 = async (text, sub, ms) => {
    await p.evaluate(([t, s]) => {
      const old = document.getElementById("wt-title"); if (old) old.remove();
      const d = document.createElement("div"); d.id = "wt-title";
      d.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a1220;color:#fff;font:700 50px system-ui,Segoe UI,Arial,sans-serif;transition:opacity .6s;text-align:center;padding:0 60px";
      const o = document.createElement("div"); o.textContent = "AXIOM OSAP"; o.style.cssText = "font-size:20px;letter-spacing:.2em;opacity:.7;margin-bottom:18px"; d.appendChild(o);
      const a = document.createElement("div"); a.textContent = t; d.appendChild(a);
      const b = document.createElement("div"); b.textContent = s; b.style.cssText = "font-weight:400;font-size:24px;opacity:.8;margin-top:14px"; d.appendChild(b);
      document.body.appendChild(d);
    }, [text, sub || ""]);
    k.marks.push((Date.now() - k.t0) / 1000);
    await p.waitForTimeout(ms || 2800);
    await p.evaluate(() => { const d = document.getElementById("wt-title"); d.style.opacity = "0"; setTimeout(() => d.remove(), 700); });
    await p.waitForTimeout(700);
  };
  k.cursor = () => p.evaluate(() => {
    if (document.getElementById("wt-cur")) return;
    const c = document.createElement("div"); c.id = "wt-cur";
    c.style.cssText = "position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,200,40,.55);border:2px solid #fff;z-index:2147483647;pointer-events:none;left:-50px;top:-50px";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  });
  // glide the real mouse to an element handle and click it, so the viewer can follow
  k.glide = async (h) => {
    const box = h && await h.boundingBox();
    if (!box) return false;
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
    await p.waitForTimeout(250);
    await h.click({ force: true }).catch(() => h.evaluate((e) => e.click()));
    return true;
  };
  k.el = async (sel) => { const all = await p.$$(sel); for (const h of all) if (await h.evaluate((e) => !!e.offsetParent || getComputedStyle(e).position === "fixed")) return h; return all[0] || null; };
  k.click = async (sel) => { const ok = await k.glide(await k.el(sel)); if (!ok) console.log("  missing", sel); return ok; };
  // the visible button (or link, or menu item) whose text is t, or starts with t when t ends with "…"
  k.byText = async (t, within) => {
    const h = await p.evaluateHandle(([t, w]) => {
      const pre = t.endsWith("…"), s = pre ? t.slice(0, -1) : t;
      const scope = w ? document.querySelector(w) : document; if (!scope) return null;
      return [...scope.querySelectorAll("button, [role=button], [role=menuitem], a, summary, label")].find((b) => {
        if (!b.offsetParent) return false; const x = b.textContent.replace(/\s+/g, " ").trim(); return pre ? x.startsWith(s) : x === s;
      }) || null;
    }, [t, within || ""]);
    return h.asElement();
  };
  k.press = async (t, within) => { const ok = await k.glide(await k.byText(t, within)); if (!ok) console.log("  missing button", JSON.stringify(t)); return ok; };
  // a toolbar button by its key, or by its label (Grid, Crosshair and 3D are added by their own scripts)
  k.tool = async (key) => {
    const h = await p.evaluateHandle((key) => document.querySelector(`#atk-tools [data-atk="${key}"]`) || document.querySelector(`#atk-tools [data-tidy="${key}"]`) || document.querySelector(`#atk-tools button[aria-label="${key}"]`), key);
    const ok = await k.glide(h.asElement()); if (!ok) console.log("  missing tool", key); return ok;
  };
  k.mapAt = async (fx, fy) => { const b = await p.locator("#map").boundingBox(); return [b.x + b.width * fx, b.y + b.height * fy]; };
  k.tapMap = async (fx, fy, opts) => { const [x, y] = await k.mapAt(fx, fy); await p.mouse.move(x, y, { steps: 18 }); await p.waitForTimeout(200); await p.mouse.click(x, y, opts); };
  k.ring = async (fx, fy) => { await k.tapMap(fx ?? 0.42, fy ?? 0.45, { button: "right" }); await p.waitForTimeout(900); };
  k.ringPress = async (rk) => { const ok = await k.glide(await k.el(`#atk-ring [data-rk="${rk}"]`)); if (!ok) console.log("  missing ring", rk); return ok; };
  k.view = (at, z, fly) => p.evaluate(([a, z, f]) => { const m = window.__asapMap; if (f) m.flyTo(a, z, { duration: 2.5 }); else m.setView(a, z, { animate: false }); }, [at, z, !!fly]);
  k.basemap = (b) => p.evaluate((b) => window.OSAP_BASEMAP && window.OSAP_BASEMAP.set(b), b);
  k.scrollIn = async (sel, dy, times, gap) => {
    for (let i = 0; i < (times || 1); i++) {
      await p.evaluate(([s, d]) => { const e = document.querySelector(s); if (e) e.scrollBy({ top: d, behavior: "smooth" }); }, [sel, dy]);
      await p.waitForTimeout(gap || 1200);
    }
  };
  k.wheel = async (dy, times, gap, fx, fy) => { await p.mouse.move(W * (fx ?? 0.5), H * (fy ?? 0.5), { steps: 10 }); for (let i = 0; i < (times || 1); i++) { await p.mouse.wheel(0, dy); await p.waitForTimeout(gap || 1100); } };
  k.type = async (sel, text) => { const h = await k.el(sel); if (!h) { console.log("  missing field", sel); return false; } await k.glide(h); await p.keyboard.type(text, { delay: 55 }); return true; };
  return k;
}

/* ---------- a fresh page for one video ---------- */
async function start(name, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: "block", locale: "en-GB", timezoneId: "Asia/Bangkok", permissions: ["notifications"] });
  if (process.env.OFFLINE) await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  // the title card covers the page from its first paint, so the video opens on it rather than on the app loading
  if (0) await ctx.addInitScript(([t, s]) => {
    const put = () => {
      if (document.getElementById("wt-title") || !document.body) return;
      const d = document.createElement("div"); d.id = "wt-title";
      d.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a1220;color:#fff;font:700 50px system-ui,Segoe UI,Arial,sans-serif;text-align:center;padding:0 60px";
      d.innerHTML = '<div style="font-size:20px;letter-spacing:.2em;opacity:.7;margin-bottom:18px">AXIOM OSAP</div><div></div><div style="font-weight:400;font-size:24px;opacity:.8;margin-top:14px"></div>';
      d.children[1].textContent = t; d.children[2].textContent = s;
      document.body.appendChild(d);
    };
    if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
  }, [o.ttl || "", o.sub || ""]);
  await ctx.addInitScript((today) => { try {
    if (sessionStorage.getItem("wt-seeded")) return; sessionStorage.setItem("wt-seeded", "1");
    localStorage.setItem("osap-home", today ? "today" : "map"); sessionStorage.setItem("osap-today", today ? "1" : "0");
    localStorage.setItem("asap-period", JSON.stringify({ p: "all" }));
  } catch (e) {} }, !!o.today);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("  page error:", e.message.split("\n")[0]));
  const k = kit(p);  // its clock starts with the page, as the video does
  await p.goto(base + (o.hash || (o.today ? "#th" : "#th/map")));
  await p.waitForFunction(() => window.TSAP && (window.OSAP_TODAY || window.__asapMap), null, { timeout: 60000 });
  if (!o.today) {
    await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK, null, { timeout: 60000 });
    await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen && window.OSAP_TODAY.isOpen()) { const b = document.querySelector(".tdmap"); if (b) b.click(); } });
    if (o.at !== false) { await k.basemap(o.bm || "streets"); await k.view(o.at || AT, o.z || 12); }
    // tools get the whole map (Layout: Map only) unless the video is about the reports list
    if (!o.list) await p.evaluate(() => {
      const b = document.querySelector('button[data-rv-mode="map"]'); if (b) b.click();
      const d = [...document.querySelectorAll("button")].find((x) => x.offsetParent && x.textContent.replace(/\s+/g, "") === "›Details"); if (d) d.click();
    });
  }
  await k.wait(o.settle || 7000);
  await k.cursor();
  return { ctx, p, k };
}
// <nn>-<name>.cut holds the second the opening title card was put up: the loading behind it comes before and is cut
async function finish(name, n, s) {
  await s.k.shot(); await s.ctx.close(); return;
  const v = s.p.video();
  await rename(await v.path(), join(OUT, `${n}-${name}.webm`));
  const cut = Math.max(0, (s.k.marks[0] || 0) - 0.2);
  await writeFile(join(OUT, `${n}-${name}.cut`), cut.toFixed(2));
  // <nn>-<name>.skip: a waiting stretch to cut, in seconds of the trimmed video ("from to")
  if (s.k.skip && s.k.skip[1] > s.k.skip[0] + 1) await writeFile(join(OUT, `${n}-${name}.skip`), `${(s.k.skip[0] - cut).toFixed(2)} ${(s.k.skip[1] - cut).toFixed(2)}`);
}

// hero tiles for the company website: the conflict tab's map as it opens, plus the whole window
async function hero({ k, p }, name) {
  await p.evaluate(() => { const c = document.getElementById("wt-cur"); if (c) c.remove(); });
  await p.mouse.move(1, 700);
  await k.wait(4000);
  await p.locator("#map").screenshot({ path: join(OUT, `${name}-map.jpg`), type: "jpeg", quality: 92 });
  await p.screenshot({ path: join(OUT, `${name}-full.jpg`), type: "jpeg", quality: 92 });
  console.log("  hero", name);
}
/* ---------- the videos, in the user guide's order ---------- */
const SCENES = [
  ["hero-ua", "Russia-Ukraine", "", { hash: "#cf-russia-ukraine", at: false, settle: 15000 }, async (s) => hero(s, "hero-ua")],
  ["hero-mm", "Myanmar", "", { hash: "#cf-myanmar", at: false, settle: 15000 }, async (s) => hero(s, "hero-mm")],
  ["hero-sd", "Sudan", "", { hash: "#cf-sudan", at: false, settle: 15000 }, async (s) => hero(s, "hero-sd")],
  ["hero-mx", "Mexico", "", { hash: "#cf-mexico-cartels", at: false, settle: 15000 }, async (s) => hero(s, "hero-mx")],
  ["today", "Today", "The start screen for your country", { today: true, settle: 9000 }, async ({ k, p }) => {
    await k.caption("Today opens each time you start OSAP", "Weather, warnings, top stories, a daily summary and what is new since your last visit.");
    await k.wait(5000);
    await k.caption("Pick any country from the list at the top", "A red or orange dot means raised recent activity: an automatic count, not a threat rating.");
    await k.glide(await k.el("#td-cc")); await k.wait(1500); await p.keyboard.press("Escape"); await k.wait(800);
    await k.caption("The daily summary and top stories", "Each item links back to its source, with Zulu and local time.");
    await k.wheel(450, 3, 1500, 0.5, 0.45);
    await k.caption("Economy, key dates and travel advisories", "Every figure names its source. Government figures are marked as claims.");
    await k.wheel(500, 4, 1500, 0.5, 0.45);
    await k.caption("Search the news from the box at the top", "Quotes keep a phrase together; a minus sign leaves a word out.");
    await k.wheel(-3000, 1, 1500);
    await k.type("#nq-q", "flood -sport"); await k.wait(1200); await p.keyboard.press("Enter"); await k.wait(3500);
    await k.caption("Open map takes you to the map");
    await k.press("Open map"); await k.wait(4000);
  }],
  ["map-screen", "The map screen", "Reports, details and the toolbar", { z: 6, at: [13.2, 101.0], list: true }, async ({ k, p }) => {
    await k.caption("The map: the open country's reporting, in NATO symbols", "The toolbar runs down the right; the grid of the map centre runs along the bottom.");
    await k.wait(4500);
    await k.caption("Set the period: 24 h to All, or Custom", "Only reports in the period show on the map and in the lists.");
    await k.press("7 d"); await k.wait(2500); await k.press("All"); await k.wait(2500);
    await k.caption("The title names what you are looking at", "Tap it to change the data set.");
    await k.click("#ph-ttl, .tidy-ttl, h1"); await k.wait(3000); await p.keyboard.press("Escape"); await k.wait(800);
    await k.caption("The Data badge says how fresh the data is", "Green is fresh, amber names any late feed, red means data has stopped.");
    await k.press("Data…"); await k.wait(3500); await p.keyboard.press("Escape"); await k.wait(800);
    await k.caption("Tap a report for its details, source link and fingerprint");
    await k.click("#rv-list > button, #rv-list button"); await k.wait(4500);
    await k.caption("Tap the grid strip to switch MGRS, decimal degrees or DMS");
    await k.click("#atk-bar .atk-pos"); await k.wait(2000); await k.click("#atk-bar .atk-pos"); await k.wait(2000);
  }],
  ["search", "Search", "Places, grids, countries, tools and settings", {}, async ({ k, p }) => {
    await k.caption("Search finds places and grids", "MGRS, UTM and lat/long grids work with no signal.");
    await k.tool("search"); await k.wait(1500);
    await p.keyboard.type("47QNA 98000 78000", { delay: 60 }); await k.wait(3500);
    await k.caption("It also finds tools, data sets and settings", "Everyday words work: \"hospital\" finds the medical plan.");
    await p.keyboard.press("Control+A"); await p.keyboard.type("hospital", { delay: 70 }); await k.wait(3500);
    await p.keyboard.press("Control+A"); await p.keyboard.type("dark map", { delay: 70 }); await k.wait(3500);
    await k.caption("And countries by name or code", "On a computer, press / or Ctrl+K to start typing.");
    await p.keyboard.press("Control+A"); await p.keyboard.type("Estonia", { delay: 70 }); await k.wait(3500);
    await p.keyboard.press("Escape"); await k.wait(800);
  }],
  ["data-sets", "Data sets", "The reporting topics", { z: 6, at: [13.2, 101.0], list: true }, async ({ k }) => {
    await k.caption("Data sets are the reporting topics", "Conflict, crime, natural disasters, public safety, news and more.");
    await k.tool("datasets"); await k.wait(4000);
    await k.caption("Tick a set to show it on the map; tap its name for its list");
    await k.scrollIn("#ds-panel, .ds-panel, #datasets", 300, 3, 1500);
    await k.wait(2000);
    await k.caption("Clear map takes everything off");
    await k.wait(2500);
  }],
  ["weather", "Weather", "Radar, models, warnings and the 5-day chart", { z: 6, at: [13.2, 101.0] }, async ({ k, p }) => {
    await k.caption("Weather: radar, satellite rain, cloud, wind, temperature and air quality", "Plus cyclones and official warnings.");
    await k.tool("weather"); await k.wait(4500);
    await k.press("Rain radar…"); await k.wait(4000);
    await k.caption("Model time looks ahead up to 72 hours");
    await k.wait(3500);
    await k.caption("Open forecasts and warnings for the full weather view", "One-page brief, detailed report and the military-style 5-day chart.");
    await k.press("Open forecasts and warnings"); await k.wait(6000);
    await k.wheel(500, 4, 1500, 0.5, 0.5);
  }],
  ["overlays", "Map overlays and base maps", "Infrastructure, aircraft, ships, borders and more", { z: 11 }, async ({ k, p }) => {
    await k.caption("Overlays: map layers that are not reports", "Infrastructure, embassies, terrain, aircraft and ships, borders and your own marks.");
    await k.tool("overlays"); await k.wait(4000);
    await k.caption("Infrastructure: communications, power, airfields, ports, bridges and more");
    await k.press("Airfields and heliports…"); await k.wait(2500); await k.press("Power plants…"); await k.wait(3500);
    await p.keyboard.press("Escape"); await k.click("#ml-close, .ml-close, [aria-label='Close']"); await k.wait(1000);
    await k.caption("Base map: Grey, Streets, Topographic, Satellite, Hybrid and Offline");
    await k.tool("basemap"); await k.wait(2000);
    await k.wait(4000); await p.keyboard.press("Escape");
    await k.caption("Grid and Crosshair: MGRS lines that get finer as you zoom in");
    await k.tool("Grid"); await k.wait(1500); await k.tool("Crosshair"); await k.wait(3500);
    await k.caption("3D: tilt and turn the map over real ground");
    await k.tool("3D"); await k.wait(30000);
  }],
  ["long-press", "Long-press the map", "A ring of actions at any point", {}, async ({ k }) => {
    await k.caption("Press and hold anywhere on the map (right-click with a mouse)", "A ring of actions opens at that point.");
    await k.ring(); await k.wait(4500);
    await k.caption("Measure, Route, Point, NAI/TAI, Watch, Plans, Find LZ and Terrain", "Copy copies the grid of the point.");
    await k.wait(5000);
    await k.caption("Plans: a medical plan or an evacuation plan from here");
    await k.ringPress("plans"); await k.wait(4000);
  }],
  ["measure", "Measure", "Distances, bearings and areas", { z: 13 }, async ({ k }) => {
    await k.caption("Tap Measure, then tap the map to add numbered points");
    await k.tool("measure"); await k.wait(1000);
    for (const [fx, fy] of [[0.2, 0.3], [0.5, 0.55], [0.32, 0.75]]) { await k.tapMap(fx, fy); await k.wait(900); }
    await k.caption("Each leg shows its distance and true bearing", "Tap point 1 again to close the shape and get its area.");
    await k.tapMap(0.2, 0.3); await k.wait(4000);
    await k.caption("The card lists every leg: true, magnetic and back bearing", "Units in km, miles, nautical miles or mils. Profile shows the ground between points.");
    await k.wait(5000);
  }],
  ["route", "Route and Drive", "Plan, check and navigate a route", { z: 12 }, async ({ k, p }) => {
    await k.caption("Route: add waypoints by place, grid, map tap or your location", "Drive, Truck, Walk, Cycle or Straight line.");
    await k.tool("route"); await k.wait(2500);
    await k.tapMap(0.3, 0.35); await k.wait(1200); await k.tapMap(0.62, 0.62); await k.wait(6000);
    await k.caption("Distance, time, arrival and up to 3 alternatives", "Then elevation, light, weather and hazards along the route, and turn-by-turn directions.");
    await k.scrollIn("#route-panel, .route-panel, #rt", 400, 4, 1600);
    await k.caption("Navigate starts turn-by-turn; Preview route steps through pictures", "Save as GPX, KML or GeoJSON, or print it.");
    await k.wait(4500);
  }],
  ["area", "Area, NAI and TAI", "Draw, filter, summarise and save an area", { z: 12 }, async ({ k, p }) => {
    await k.caption("Area: Lasso, Polygon, Circle or Square");
    await k.tool("area"); await k.wait(2500);
    await k.press("Circle"); await k.wait(800);
    const [x, y] = await k.mapAt(0.45, 0.5); await p.mouse.move(x, y, { steps: 15 }); await p.mouse.down(); await p.mouse.move(x + 180, y + 60, { steps: 30 }); await p.mouse.up(); await k.wait(2500);
    await k.caption("A drawn area filters the map and the list to what is inside");
    await k.wait(3500);
    await k.caption("Summarise area, Landing zones, Satellite before/after", "Save (NAI/TAI) keeps it with a type, a name and notes.");
    await k.tool("area"); await k.wait(4500);
  }],
  ["satellite", "Satellite before/after", "Two Sentinel-2 pictures of an area", { z: 13 }, async ({ k, p }) => {
    await k.caption("Satellite before/after compares two Sentinel-2 passes", "From the Area menu, or Overlays > Satellite imagery.");
    await p.evaluate(() => window.OSAP_SAT.open()); await k.wait(9000);
    await k.caption("It lists the passes for the last 90 days with the cloud %", "The newest clear pass is After; one about 30 days earlier is Before.");
    await k.wait(5000);
    await k.caption("Side by side, or Swipe on map");
    await k.press("Swipe on map"); await k.wait(6000);
  }],
  ["points", "Points and photos", "Mark a place and keep photos with fingerprints", { z: 14 }, async ({ k }) => {
    await k.caption("Point: at the map centre, a tap on the map, or your position");
    await k.tool("point"); await k.wait(1500);
    await k.press("At the map centre"); await k.wait(2500);
    await k.caption("Give it a name, a note and an icon", "Military symbol, shape or pin. Edits save as you type.");
    await k.type("#pt-n", "Rally point North"); await k.wait(3000);
    await k.caption("Photos keep their original and a SHA-256 fingerprint", "Everything stays on this device unless you turn on sync.");
    await k.wait(4500);
  }],
  ["watch", "Watches and alerts", "Get told about new reports in an area", { z: 9 }, async ({ k }) => {
    await k.caption("Watch: an area, categories, words and severity", "Only new reports count as hits.");
    await k.tool("watch"); await k.wait(4500);
    await k.scrollIn("#watch-panel, .watch-panel, #wt", 300, 3, 1500);
    await k.caption("OSAP checks every 15 minutes while open", "Push to phone sends alerts through the free ntfy app when OSAP is closed.");
    await k.wait(4500);
  }],
  ["my-work", "My work and workspaces", "Saved reports, grades, trends and exports", {}, async ({ k }) => {
    await k.caption("My work: What's new and Saved work");
    await k.tool("mine"); await k.wait(3500);
    await k.press("Saved work"); await k.wait(3000);
    await k.caption("Save, mark reviewed, add notes and grade reports (A1 to F6)", "A grade is always your own choice: OSAP never sets one.");
    await k.wait(4500);
    await k.caption("Workspaces: one per job, with import and export of KML and .zip");
    await k.press("Workspaces"); await k.wait(5000);
  }],
  ["teams", "Team workspace and team cases", "Share a workspace with your team", {}, async ({ k }) => {
    await k.caption("Share a workspace with a team by link, or as a team case", "Team cases use named accounts with Lead, Analyst and Viewer roles.");
    await k.tool("mine"); await k.wait(1500); await k.press("Saved work"); await k.wait(2000); await k.press("Workspaces"); await k.wait(3000);
    await k.press("Share with a team"); await k.wait(4500);
    await k.caption("Each item shows the call sign of who added it, and when", "Viewer links can see but not change: enforced by the team's keys.");
    await k.wait(4500);
    await k.caption("In a case, analysts propose entities and links; a lead approves", "Nothing is approved by OSAP or by AI.");
    await k.wait(4500);
  }],
  ["photo-check", "Photo and video check", "Where and when was a picture taken?", {}, async ({ k, p }) => {
    await k.caption("Photo check reads a picture's metadata on this device", "Nothing is uploaded. Missing or faked metadata is normal: treat it as a lead.");
    await p.evaluate(() => window.OSAP_PHOTOCHECK.open({})); await k.wait(4500);
    await k.caption("Sun and shadow: the sun's direction and height for a place and time", "Draw a measured shadow to list the times it fits.");
    await k.scrollIn("#photocheck, .pc-panel, #pcdlg", 350, 4, 1500);
    await k.caption("Reverse image search links: Google Lens, Bing, Yandex and TinEye");
    await k.wait(4000);
  }],
  ["medical-plan", "Medical plan", "Receiving hospitals, routes and the golden hour", { bm: "hybrid" }, async ({ k, p }) => {
    await k.caption("Med plan plans for the map centre or a drawn area", "Or long-press, Plans, Med plan from here.");
    await k.tool("medplan");
    await p.waitForFunction(() => { const m = document.getElementById("medplan"); return m && !/Still reading/.test(m.textContent); }, null, { timeout: 150000 }).catch(() => {});
    await k.wait(2500);
    await k.press("Half"); await k.wait(3000);
    await k.caption("Hospitals, most capable first, with drive times against the golden hour", "Only capabilities from an official register or your own check count.");
    await k.press("Full"); await k.wait(2000);
    await k.scrollIn("#medplan .mp-body, #medplan", 400, 5, 1600);
    await k.caption("Status GREEN, AMBER or RED, with a checklist of what is missing", "An automatic draft from open data: always call the receiving hospital.");
    await k.wait(4500);
  }],
  ["evacuation", "Evacuation plan", "Routes out to embassies, airports and ports", { bm: "hybrid", z: 11 }, async ({ k, p }) => {
    await k.caption("Evac: set where the people are, then Work out the options");
    await k.tool("evac"); await k.wait(1500);
    await p.evaluate((a) => window.OSAP_EPE && window.OSAP_EPE.open({ at: a }), AT); await k.wait(2000);
    await k.click('[data-ep="plan"]'); await k.wait(4000);
    // routing every option takes minutes: the wait is cut from the video
    await k.caption("OSAP routes each option and weighs the incidents near it", "This takes a few minutes; the wait is cut from the video.");
    await k.wait(1500); k.skipFrom();
    await p.waitForFunction(() => /Work out again/.test((document.getElementById("epe") || {}).textContent || ""), null, { timeout: 420000 }).catch(() => console.log("  evacuation options not ready"));
    k.skipTo(); await k.wait(3000);
    await k.caption("Routes to the U.S. embassy or consulate, airports, airfields and seaports", "The first choice has the fewest incidents near the route.");
    await k.wait(4000);
    await k.scrollIn("#epe", 400, 4, 1600);
    await k.caption("Roles P, A, C, E; legs, corridors, LZs and border crossings", "OSAP never marks a route Available: only you do.");
    await k.wait(4500);
  }],
  ["landing-zones", "Landing zone finder", "Candidate LZs from open data", { bm: "hybrid", z: 13 }, async ({ k, p }) => {
    await k.caption("Long-press, then Find LZ", "Set the radius, LZ size and maximum slope.");
    await k.ring(); await k.ringPress("lz"); await k.wait(60000);
    await k.caption("Up to 8 numbered candidates: clear ground, slope, obstacles and aircraft", "Orange means a slope over 7°. Soil, crops and unmapped wires are not checked.");
    await k.wait(6000);
  }],
  ["terrain", "Terrain analysis", "Viewshed, line of sight, elevation and radio coverage", { bm: "hybrid", z: 13 }, async ({ k, p }) => {
    await p.waitForFunction(() => window.OSAP_TERRAIN_ANALYSIS, null, { timeout: 30000 }).catch(() => {});
    await k.caption("Long-press, Terrain: viewshed, reverse viewshed, line of sight and more");
    await k.ring(); await k.ringPress("terrain"); await k.wait(1500);
    await k.press("Viewshed from here"); await k.wait(2000);
    await k.caption("Set the heights and range, then CALCULATE");
    await k.press("CALCULATE"); await k.wait(25000);
    await k.caption("The ground that can be seen from the point", "Terrain only: buildings and trees are not modelled. Grey means no data, not 'not visible'.");
    await k.wait(6000);
  }],
  ["comms", "Comms planning", "PACE plans, coverage, links and networks", { z: 11, list: true }, async ({ k }) => {
    await k.caption("Comms: Plan, Coverage, Link, Networks, Equipment and Status");
    await k.tool("comms"); await k.wait(5000);
    await k.press("Coverage"); await k.wait(4000);
    await k.caption("Will I have phone signal? Likely, Possible, No sign or Unknown", "Unknown is never shown as no.");
    await k.wait(3500);
    await k.press("Link"); await k.wait(3500);
    await k.caption("Radio link budgets and radio coverage over the ground");
    await k.wait(3000);
    await k.press("Networks"); await k.wait(4000);
    await k.caption("Masts and each phone network in its own colour");
    await k.wait(3500);
  }],
  ["osir", "Reports: the OSIR", "An Open Source Intelligence Report", { hash: "#cf-thailand-deep-south", at: false }, async ({ k, p }) => {
    await k.caption("Reports holds every printable report OSAP makes", "Country brief, daily summary, weather, timeline, area, medical, route and more.");
    await k.click("#tidy-rep"); await k.wait(4000); await p.keyboard.press("Escape"); await k.wait(800);
    await k.caption("OSIR: an Open Source Intelligence Report");
    await p.evaluate(() => { const b = document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]'); if (b) b.click(); });
    await k.wait(2000);
    await p.evaluate(() => window.OSAP_REPORTS.run("osir"));
    await p.waitForFunction(() => window.OSAP_OSIR._state().data && !document.getElementById("os-go").disabled, null, { timeout: 30000 }).catch(() => {});
    await k.wait(2000);
    await k.caption("Choose country, region, topic and dates", "Then who prepared it and an optional analyst summary.");
    await k.type("#os-by", "Demo analyst cell"); await k.wait(2000);
    await k.caption("Make OSIR");
    await k.click("#os-go");
    await p.waitForSelector("#brief .osir", { timeout: 30000 }).catch(() => {});
    await k.wait(2500);
    await k.caption("Summary, key events, map and chronology", "OSAP adds no judgments. Analyst parts are tagged as the analyst's.");
    await k.wheel(450, 6, 1300);
    await k.caption("Every record keeps its source link and SHA-256 fingerprint", "Print or save as PDF to keep a copy.");
    await k.wheel(900, 4, 900);
    await k.wait(2000);
  }],
  ["conflict-tabs", "Conflict tabs", "Every active conflict, its history and its sides", { hash: "#cf-thailand-deep-south", at: false }, async ({ k, p }) => {
    await k.caption("Conflict tabs: one per active conflict worldwide", "Reported incidents, deaths by period, sides and history.");
    await k.wait(5000);
    await k.caption("Violence history: small red dots and a heat map");
    await k.wheel(-300, 2, 1500, 0.3, 0.5); await k.wait(3000);
    await k.caption("The Timeline report turns the records into a printable product");
    await p.evaluate(() => window.OSAP_REPORTS.run("timeline")); await k.wait(6000);
    await k.wheel(500, 4, 1300);
  }],
  ["settings", "Settings", "Map colours, units, language, offline maps and sync", {}, async ({ k }) => {
    await k.caption("The gear: map colours, grid format and distance units");
    await k.click("#tidy-set"); await k.wait(4000);
    await k.caption("Language, My countries, and the user guide");
    await k.scrollIn("#setdlg, .set-panel, #settings", 350, 3, 1500);
    await k.caption("Offline maps: save a country so OSAP works with no signal");
    await k.scrollIn("#setdlg, .set-panel, #settings", 350, 3, 1500);
    await k.caption("Move to another device, or Sync my devices: no account", "Your data is locked on your device with your own passphrase or sync code.");
    await k.scrollIn("#setdlg, .set-panel, #settings", 350, 3, 1500);
  }],
  ["reading", "Reading what you see", "Claims, sources, fingerprints and times", { z: 6, at: [13.2, 101.0], list: true }, async ({ k }) => {
    await k.caption("Every report is what a source said", "Observed is an instrument reading; Reported is unconfirmed. A trusted source can still be wrong.");
    await k.click("#rv-list > button, #rv-list button"); await k.wait(5000);
    await k.caption("Each report links to the original", "Machine translated means OSAP translated the headline: check the original.");
    await k.wait(4500);
    await k.caption("A record fingerprint (SHA-256) shows the report is the one you saw");
    await k.wait(4500);
    await k.caption("AI generated, Automatic and Automatic draft tags", "Drafts are never analyst-approved. Times show Zulu first, then local.");
    await k.wait(5000);
  }]
];

let fails = 0, n = 0;
for (const [name, ttl, sub, opts, run] of SCENES) {
  n++;
  if (ONLY.length && !ONLY.includes(name)) continue;
  const nn = String(n).padStart(2, "0");
  let s;
  try {
    s = await start(name, Object.assign({ ttl, sub }, opts)); s.k.tag = `${nn}-${name}`;
    await s.k.title(ttl, sub);
    await run(s);

    await finish(name, nn, s);
    console.log("PASS", nn, name);
  } catch (e) {
    fails++; console.log("FAIL", nn, name, e.message.split("\n")[0]);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::walkthrough ${name} failed: ${e.message.split("\n")[0]}`);
    if (s) await s.ctx.close().catch(() => {});
  }
}
await writeFile(join(OUT, "captions.tsv"), LOG.join("\n") + "\n");
await browser.close(); server.close();
console.log(fails ? `${fails} video(s) failed` : "all videos recorded");
