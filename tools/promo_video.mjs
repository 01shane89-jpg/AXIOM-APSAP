// Scratch (claude/promo-video, never merged): records the clips for one captioned OSAP walkthrough video for social posts.
// Same approach as tools/walkthrough.mjs (a local copy of the app, Playwright's own recorder), but nothing is drawn on the page
// except a cursor dot: each clip's caption timings go to OUT/<nn>-<name>.json and the captions are burned in afterwards, in the
// frame of each format (16:9, square, 9:16). PDF exports are caught (window.print) and saved with page.pdf as OUT/<nn>-<name>-<i>.pdf.
// VIEW=desk (1280x720 at 1.5x, video 1920x1080) or VIEW=phone (400x600 at 2.7x, video 1080x1620). ONLY=name,name records some clips.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";

const OUT = process.env.OUT || "promo";
const PHONE = process.env.VIEW === "phone";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp", ".css": "text/css", ".woff2": "font/woff2" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(OUT, { recursive: true });
const W = PHONE ? 400 : 1280, H = PHONE ? 600 : 720, DSF = PHONE ? 2.7 : 1.5;
const VW = Math.round(W * DSF), VH = Math.round(H * DSF);
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const BKK = [13.745, 100.53];

function kit(p) {
  const k = { t0: Date.now(), caps: [], skips: [], pdfs: [], start: 0 };
  const now = () => (Date.now() - k.t0) / 1000;
  k.wait = (ms) => p.waitForTimeout(ms);
  k.caption = (text, sub) => { k.caps.push({ t: now(), text, sub: sub || "" }); };
  k.go = () => { k.start = now(); };
  k.cursor = () => p.evaluate(() => {
    if (document.getElementById("wt-cur")) return;
    const c = document.createElement("div"); c.id = "wt-cur";
    c.style.cssText = "position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,200,40,.55);border:2px solid #fff;z-index:2147483647;pointer-events:none;left:-50px;top:-50px;transition:transform .15s";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { c.style.transform = "scale(.7)"; }, true);
    addEventListener("mouseup", () => { c.style.transform = ""; }, true);
  });
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
  k.tool = async (key) => {
    const h = await p.evaluateHandle((key) => document.querySelector(`#atk-tools [data-atk="${key}"]`) || document.querySelector(`#atk-tools [data-tidy="${key}"]`) || document.querySelector(`#atk-tools button[aria-label="${key}"]`), key);
    const ok = await k.glide(h.asElement()); if (!ok) console.log("  missing tool", key); return ok;
  };
  k.mapAt = async (fx, fy) => { const b = await p.locator("#map").boundingBox(); return [b.x + b.width * fx, b.y + b.height * fy]; };
  k.view = (at, z, fly) => p.evaluate(([a, z, f]) => { const m = window.__asapMap; if (f) m.flyTo(a, z, { duration: 2.5 }); else m.setView(a, z, { animate: false }); }, [at, z, !!fly]);
  k.basemap = (b) => p.evaluate((b) => window.OSAP_BASEMAP && window.OSAP_BASEMAP.set(b), b);
  k.scrollIn = async (sel, dy, times, gap) => {
    for (let i = 0; i < (times || 1); i++) {
      await p.evaluate(([s, d]) => { const e = document.querySelector(s); if (e) e.scrollBy({ top: d, behavior: "smooth" }); }, [sel, dy]);
      await p.waitForTimeout(gap || 1200);
    }
  };
  k.wheel = async (dy, times, gap, fx, fy) => { await p.mouse.move(W * (fx ?? 0.5), H * (fy ?? 0.5), { steps: 10 }); for (let i = 0; i < (times || 1); i++) { await p.mouse.wheel(0, dy); await p.waitForTimeout(gap || 1100); } };
  k.type = async (sel, text) => { const h = await k.el(sel); if (!h) { console.log("  missing field", sel); return false; } await k.glide(h); await p.keyboard.type(text, { delay: 60 }); return true; };
  // bring an element into view smoothly (scrolls its scrolling parent)
  k.into = async (sel) => { const ok = await p.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden) return false; e.scrollIntoView({ behavior: "smooth", block: "start" }); return true; }, sel); await p.waitForTimeout(1600); return ok; };
  // the export that the last tap started: wait for its window.print, save the page as a PDF, cut the wait from the video
  k.pdf = async (file) => {
    const from = now();
    try { await p.waitForFunction((n) => (window.__prq || 0) > n, k.pdfs.length, { timeout: 25000 }); }
    catch { console.log("  no print for", file); return false; }
    await p.waitForTimeout(600);
    await p.pdf({ path: join(OUT, file), printBackground: true, preferCSSPageSize: true, format: "Letter" }).catch((e) => console.log("  pdf failed", e.message));
    k.pdfs.push({ file, t: now() });
    await p.evaluate(() => dispatchEvent(new Event("afterprint")));
    k.skips.push([from + 0.8, now()]);
    return true;
  };
  return k;
}

async function start(name, o) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: PHONE, hasTouch: PHONE,
    serviceWorkers: "block", locale: "en-US", timezoneId: "Asia/Bangkok", permissions: ["notifications"] });
  await ctx.addInitScript((today) => { try {
    window.print = function () { window.__prq = (window.__prq || 0) + 1; };
    if (sessionStorage.getItem("wt-seeded")) return; sessionStorage.setItem("wt-seeded", "1");
    localStorage.setItem("osap-home", today ? "today" : "map"); sessionStorage.setItem("osap-today", today ? "1" : "0");
    localStorage.setItem("asap-period", JSON.stringify({ p: "all" }));
  } catch (e) {} }, !!o.today);
  const p = await ctx.newPage();
  // Playwright's own recorder keeps CSS pixels only; the DevTools screencast gives device pixels (crisp at 1.5x / 2.7x)
  const dir = join(OUT, "_raw", name); await mkdir(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(p), frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const f = join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    frames.push({ f, ts: metadata.timestamp, w: writeFile(f, Buffer.from(data, "base64")).catch(() => {}) });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 });
  p.on("pageerror", (e) => console.log("  page error:", e.message.split("\n")[0]));
  const k = kit(p);
  await p.goto(base + (o.hash || (o.today ? "#th" : "#th/map")));
  await p.waitForFunction(() => window.TSAP && (window.OSAP_TODAY || window.__asapMap), null, { timeout: 60000 });
  if (!o.today) {
    await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK, null, { timeout: 60000 });
    await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen && window.OSAP_TODAY.isOpen()) { const b = document.querySelector(".tdmap"); if (b) b.click(); } });
    if (o.at !== false) { await k.basemap(o.bm || "streets"); await k.view(o.at || BKK, o.z || 12); }
    if (!o.list) await p.evaluate(() => {
      const b = document.querySelector('button[data-rv-mode="map"]'); if (b) b.click();
      const d = [...document.querySelectorAll("button")].find((x) => x.offsetParent && x.textContent.replace(/\s+/g, "") === "›Details"); if (d) d.click();
    });
  }
  if (o.prep) await o.prep(p, k);
  await k.wait(o.settle || 8000);
  await k.cursor();
  k.go();
  return { ctx, p, k, cdp, frames, dir };
}
async function finish(name, nn, s) {
  s.k.end = (Date.now() - s.k.t0) / 1000;
  await s.cdp.send("Page.stopScreencast").catch(() => {});
  await s.p.waitForTimeout(500);
  await s.ctx.close();
  await Promise.all(s.frames.map((x) => x.w));
  // frames arrive only when the page changes: each one is held until the next, on the clock the captions use (t0 = 0)
  const t0 = s.k.t0 / 1000, fr = s.frames;
  let list = "";
  for (let i = 0; i < fr.length; i++) {
    const a = i === 0 ? t0 : fr[i].ts, b = i + 1 < fr.length ? fr[i + 1].ts : t0 + s.k.end;
    list += `file '${fr[i].f.split("/").pop()}'\nduration ${Math.max(0.001, b - a).toFixed(4)}\n`;
  }
  if (fr.length) list += `file '${fr[fr.length - 1].f.split("/").pop()}'\n`;
  await writeFile(join(s.dir, "list.txt"), list);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-vf", `fps=30,scale=${VW}:${VH}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-movflags", "+faststart", resolve(OUT, `${nn}-${name}.mp4`)], { cwd: s.dir, stdio: "inherit" });
  if (r.status) throw new Error("ffmpeg failed for " + name);
  const { start, end, caps, skips, pdfs } = s.k;
  await writeFile(join(OUT, `${nn}-${name}.json`), JSON.stringify({ name, view: PHONE ? "phone" : "desk", w: VW, h: VH, frames: fr.length, start, end, caps, skips, pdfs }, null, 1));
}

/* ---------- the clips, in the video's order ---------- */
const SCENES = [
  ["today", { today: true, settle: 10000 }, async ({ k, p }) => {
    k.caption("Today: your country's picture, first thing", "Weather, warnings, top stories and a daily summary.");
    await k.wait(3500);
    await k.wheel(PHONE ? 300 : 380, 3, 1300, 0.5, 0.55);
    k.caption("Every item links to its source", "Times in Zulu and local. Government figures are marked as claims.");
    await k.wait(2500);
    if (await k.into("#td-spike")) {
      k.caption("Reporting level against normal", "Spikes in reporting are flagged by place, automatically.");
      await k.wait(4200);
    }
    k.caption("One tap: the daily brief as a PDF", "Sources stay clickable. AI-generated parts are labeled.");
    await k.into("#td-daily");
    await k.wait(1200);
    if (await k.click("#td-daily [data-dlprint]")) await k.pdf("daily-brief.pdf");
    await k.wait(2500);
  }],
  ["map", { z: 6, at: [13.2, 101.0], list: !PHONE, settle: 10000 }, async ({ k, p }) => {
    k.caption("Every report, on the map", "Standard map symbols, filtered by period and topic.");
    await k.wait(4000);
    k.caption("Tap a report for the details", "Source link, original language and a SHA-256 fingerprint.");
    if (!(await k.click("#rv-list > button, #rv-list button"))) {
      await p.evaluate(() => { const m = document.querySelector(".leaflet-marker-icon.leaflet-interactive"); if (m) m.click(); });
    }
    await k.wait(5500);
  }],
  ["area", { z: 11, at: BKK, settle: 9000 }, async ({ k, p }) => {
    k.caption("Draw an area to focus", "The map and the list show only what is inside it.");
    await k.tool("area"); await k.wait(1500);
    await k.press("Circle"); await k.wait(700);
    const [x, y] = await k.mapAt(0.45, 0.5);
    await p.mouse.move(x, y, { steps: 15 }); await p.mouse.down(); await p.mouse.move(x + (PHONE ? 120 : 220), y + (PHONE ? 40 : 70), { steps: 30 }); await p.mouse.up();
    await k.wait(2500);
    k.caption("Area brief: the last 24 hours, as a PDF", "Maps, reports and sources for the area in one document.");
    await k.tool("area"); await k.wait(1500);
    if (!(await k.press("Area brief…"))) await p.evaluate(() => window.OSAP_AREAREPORT.brief());
    await k.wait(2500);
    await k.pdf("area-brief.pdf");
    await k.wait(2500);
  }],
  ["watch", { z: 10, at: BKK }, async ({ k, p }) => {
    k.caption("Watch an area", "Get an alert on your phone when new reports land inside it.");
    await k.tool("watch"); await k.wait(2500);
    k.caption("Pick a city and a radius", "Or use the area you drew, or your own location.");
    const fld = 'input[placeholder^="City, town"]';
    await p.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ behavior: "smooth", block: "center" }); }, fld); await k.wait(1500);
    if (await k.type(fld, "Chiang Mai")) { await k.wait(500); await k.press("Find"); }
    await k.wait(4000);
  }],
  ["cameras", { z: 14, at: [13.7466, 100.5393], settle: 9000, prep: (p) => p.evaluate(() => window.OSAP_CAMS.set(true)) }, async ({ k, p }) => {
    k.caption("57,000+ official public cameras", "Traffic and weather cameras published by government sources.");
    await k.wait(3500);
    k.caption("Tap a camera for its latest picture");
    const h = await p.evaluateHandle(() => {
      const r = document.getElementById("map").getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let best = null, bd = 1e9;
      document.querySelectorAll(".leaflet-campt-pane .leaflet-marker-icon").forEach((m) => { const b = m.getBoundingClientRect(), d = Math.hypot(b.left - cx, b.top - cy) + (/0b7285/i.test(m.outerHTML) ? 0 : 5000); if (b.top > r.top + 40 && d < bd) { bd = d; best = m; } });
      return best;
    });
    if (!(await k.glide(h.asElement()))) console.log("  no camera marker");
    await k.wait(6000);
  }],
  ["satellite", { z: 13, at: BKK, settle: 8000 }, async ({ k, p }) => {
    k.caption("Satellite before and after", "Any two Sentinel-2 passes from the last 90 days, with their cloud cover.");
    await p.evaluate(() => window.OSAP_SAT.open()); await k.wait(7500);
    k.caption("Swipe to see what changed");
    await k.press("Swipe on map"); await k.wait(5500);
  }],
  ["offline", { z: 8, at: [13.2, 101.0] }, async ({ k, p }) => {
    k.caption("Save a country for offline use", "Maps and data keep working with no signal.");
    await k.wait(800); await p.evaluate(() => window.OSAP_OFFLINE.open()); await k.wait(3500);
    await k.scrollIn(".cbox:has(#off-h)", 260, 2, 1500);
    await k.wait(5000);
  }],
  ["alerts", { hash: "#th/timeline", z: 11, at: [13.75, 100.53], settle: 9000, prep: async (p) => {
    await p.evaluate(() => { try { localStorage.setItem("osap-w-pushnext", "false"); } catch (e) {} });
    // the reports load after the map: wait until the watch check can see Bangkok's (a 25 km circle, as the place search makes)
    await p.waitForFunction(() => { const c = [13.7563, 100.5018], pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI; pts.push([c[0] + 25 / 111 * Math.cos(a), c[1] + 25 / (111 * Math.cos(c[0] * Math.PI / 180)) * Math.sin(a)]); }
      return window.OSAP_WATCH && window.OSAP_WATCH.matches({ area: pts }).length > 5; }, null, { timeout: 30000, polling: 1000 }).catch(() => console.log("  reports not loaded"));
  } }, async ({ k, p }) => {
    k.caption("Know when something happens in your city", "Watch any place, in any country.");
    await k.tool("watch"); await k.wait(2500);
    const fld = "#w-pq";
    await p.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ behavior: "smooth", block: "center" }); }, fld); await k.wait(1300);
    k.caption("Type a city and pick a distance", "OSAP draws the circle for you.");
    if (await k.type(fld, process.env.PLACE || "Bangkok")) { await k.wait(400); await k.press("Find"); }
    try { await p.waitForSelector("#w-plist .wpick", { timeout: 12000 }); } catch { console.log("  no places found"); }
    await k.wait(800);
    await k.click("#w-plist .wpick");
    await k.wait(1200);
    const km = await k.el("#w-pkm"); if (km) { await k.glide(km); await p.keyboard.press("Escape"); await p.selectOption("#w-pkm", "25"); }
    await k.wait(2200);
    await p.evaluate(() => { const b = [...document.querySelectorAll("#wform button[type=submit]")][0]; if (b) b.scrollIntoView({ behavior: "smooth", block: "center" }); }); await k.wait(1300);
    k.caption("Save it, and OSAP keeps checking", "Within minutes of new data, day and night.");
    await k.press("Save watch");
    await k.wait(2200);
    // demo: the watch is treated as saved 24 hours ago, so the reports that really arrived inside the circle since then are its hits;
    // the page is then opened again (cut from the video), which checks every watch on opening
    const from = (Date.now() - k.t0) / 1000;
    // 1) open the page again as a first check of the watch: it notes everything already inside the circle, announcing nothing
    const id = await p.evaluate(() => {
      const ws = JSON.parse(localStorage.getItem("asap-watches") || "[]"), w = ws[ws.length - 1]; if (!w) return "";
      delete w.base; localStorage.setItem("asap-watches", JSON.stringify(ws));
      const seen = JSON.parse(localStorage.getItem("asap-watch-seen") || "{}"); delete seen[w.id]; localStorage.setItem("asap-watch-seen", JSON.stringify(seen));
      localStorage.setItem("asap-watch-hits", "[]"); return w.id;
    });
    await p.reload();
    await p.waitForFunction((id) => { const w = (JSON.parse(localStorage.getItem("asap-watches") || "[]")).filter((x) => x.id === id)[0]; return w && w.base; }, id, { timeout: 90000, polling: 500 }).catch(() => console.log("  first check not done"));
    await p.waitForFunction((id) => { const w = (JSON.parse(localStorage.getItem("asap-watches") || "[]")).filter((x) => x.id === id)[0]; return w && window.OSAP_WATCH && window.OSAP_WATCH.matches(w).length > 3; }, id, { timeout: 60000, polling: 1000 }).catch(() => console.log("  matches still empty"));
    // 2) then the three newest reports inside it are taken off the noted list, so the next check finds them as new
    const n = await p.evaluate((id) => {
      const ws = JSON.parse(localStorage.getItem("asap-watches") || "[]"), w = ws.filter((x) => x.id === id)[0]; if (!w || !window.OSAP_WATCH) return -1;
      const seen = JSON.parse(localStorage.getItem("asap-watch-seen") || "{}"), sw = seen[id] || {};
      const ms = window.OSAP_WATCH.matches(w).map((m) => Object.assign({ _t: m.t0 || Date.parse(m.ts) || 0 }, m)).sort((a, b) => b._t - a._t);
      const keep = {}; let n = 0; ms.forEach((m) => { if (n < 3 && !keep[m.gk]) { keep[m.gk] = 1; n++; } });
      ms.forEach((m) => { if (keep[m.gk]) { delete sw[m.k]; if (m.sk) delete sw["s:" + m.sk]; } });
      seen[id] = sw; localStorage.setItem("asap-watch-seen", JSON.stringify(seen)); localStorage.setItem("asap-watch-hits", "[]");
      return { n, all: ms.length, seen: Object.keys(sw).length };
    }, id);
    console.log("  recent matches", JSON.stringify(n));
    await p.goto(base + "?wshow=" + encodeURIComponent(id) + "#th/timeline");
    await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK, null, { timeout: 60000 });
    await p.evaluate(() => { const b = document.querySelector('button[data-rv-mode="map"]'); if (b) b.click(); });
    try { await p.waitForFunction(() => { const t = document.getElementById("wtoast"); return t && !t.hidden; }, null, { timeout: 30000 }); } catch { console.log("  no alert toast"); }
    await k.wait(3500); await k.cursor();
    k.skips.push([from + 0.3, (Date.now() - k.t0) / 1000 - 0.5]);
    k.caption("Something new inside it? You get an alert", "On screen, or as a push alert on your phone.");
    await k.wait(4500);
    k.caption("Every alert opens the report and its source");
    if (!(await k.click("#wtoast [data-w-openhit]"))) console.log("  no open button");
    await k.wait(5500);
  }],
  ["brief", { today: true, settle: 11000 }, async ({ k, p }) => {
    k.caption("Your country's daily brief, every morning", "Top lines, key events and what to watch.");
    await k.into("#td-daily"); await k.wait(3000);
    k.caption("Every line cites its sources", "Numbered links back to the original reports.");
    await k.wheel(PHONE ? 260 : 320, 3, 1300, 0.5, 0.6); await k.wait(800);
    await k.into("#td-daily"); await k.wait(600);
    k.caption("One tap: Export PDF", "Built from the latest reporting for the country.");
    await k.wait(1500);
    if (await k.click("#td-daily [data-dlprint]")) await k.pdf("daily-brief.pdf");
    await k.wait(1200);
  }],
  ["imagery", { hash: "#th/timeline", z: 13, at: [25.117, 55.135], settle: 9000 }, async ({ k, p }) => {
    k.caption("The newest satellite pictures of any place", "Every free source at once, newest first.");
    await k.wait(1800);
    await k.tool("overlays"); await k.wait(1500);
    if (!(await k.press("Find newest imagery"))) await p.evaluate(() => window.OSAP_NEWIMG.open());
    await k.wait(1500);
    if (!(await p.evaluate(() => window.OSAP_NEWIMG.isOpen()))) await p.evaluate(() => window.OSAP_NEWIMG.open());
    try { await p.waitForSelector("[data-nimg-show]", { timeout: 30000 }); } catch { console.log("  no imagery rows"); }
    await k.wait(2500);
    k.caption("Each one shows its date, sensor and cloud", "So an old picture is never mistaken for today's.");
    await k.wait(3000);
    const pick = await p.evaluate(() => {
      const L = (window.OSAP_NEWIMG.list && window.OSAP_NEWIMG.list()) || [];
      const ok = (r) => r && r.cloud != null && r.cloud <= 15 && /sentinel/i.test(JSON.stringify(r));
      const r = L.filter(ok)[0] || L.filter((x) => x && x.cloud != null && x.cloud <= 30)[0] || L[0];
      return { id: r ? r.id : "", n: L.length, keys: r ? Object.keys(r).join(",") : "" };
    });
    console.log("  imagery pick", JSON.stringify(pick));
    k.caption("Tap one and it goes on the map", "With a date badge on it.");
    const sel = pick.id ? `[data-nimg-show="${pick.id.replace(/"/g, '\\"')}"]` : "[data-nimg-show]";
    await p.evaluate((sel) => { const e = document.querySelector(sel); if (e) e.scrollIntoView({ behavior: "smooth", block: "center" }); }, sel); await k.wait(1200);
    await k.click(sel);
    await k.wait(2500);
    // the windows close; the picture stays on the map with its date badge
    await p.evaluate(() => { window.OSAP_NEWIMG.close(); document.querySelectorAll("#atk-om .x, #atk-om [data-om=x], .chead .x").forEach((x) => { if (x.offsetParent) x.click(); }); });
    await p.keyboard.press("Escape"); await k.wait(800);
    await p.evaluate(() => { const s = document.querySelector('[data-split="map"], button[aria-label="Map only"]'); if (s && s.offsetParent) s.click(); });
    await k.wait(1500);
    await k.view([25.117, 55.135], 14, true); await k.wait(4500);
    k.caption("Dated, sourced and free to use", "Sentinel-2, Landsat and NASA daily pictures, for any place in the world.");
    await k.wait(4500);
  }],
  ["flood", { hash: "#th/map", z: 8, at: [14.0, 100.3], settle: 10000, prep: (p) => p.evaluate(() => {
    // the packed satellite composite and the areas built from it are a past event; show only today's readings
    ["lyr-flood", "lyr-expo", "lyr-infra"].forEach((id) => { const e = document.getElementById(id); if (e && e.checked) { e.checked = false; e.dispatchEvent(new Event("change")); } });
  }) }, async ({ k, p }) => {
    const top = await p.evaluate(() => {
      const L = window.LIVE, o = L.over.map((i) => L.stations[i]).sort((a, b) => (b.d || 0) - (a.d || 0));
      const r = L.rain.slice().sort((a, b) => b.mm - a.mm)[0];
      const prov = {}; o.forEach((s) => { if (s.p) prov[s.p] = 1; });
      return { n: o.length, np: Object.keys(prov).length, g: o[0] && { d: o[0].d, a: o[0].a, p: o[0].p, lat: o[0].lat, lon: o[0].lon, t: o[0].t },
        r: r && { mm: r.mm, a: r.a, p: r.p, lat: r.lat, lon: r.lon }, asof: L.asof };
    });
    console.log("  flood", JSON.stringify(top));
    const dist = (a) => String(a || "").replace(/ District$/, "");
    k.caption("Thailand's floods, as they're reported", "Live river gauges from official telemetry, on one map.");
    await k.wait(1500);
    if (!(await k.click("[data-dsshow]"))) await p.evaluate(() => { const b = document.querySelector("[data-dsshow]"); if (b) b.click(); });
    await k.wait(2800);
    k.caption(`${top.n} gauges over their bank right now`, `In ${top.np} provinces. Red means the river is over its bank.`);
    await k.view([top.g.lat, top.g.lon], 11, true); await k.wait(3800);
    // tap the gauge itself
    const pt = await p.evaluate(([a, b]) => { const m = window.__asapMap, c = m.latLngToContainerPoint([a, b]), r = document.getElementById("map").getBoundingClientRect(); return [r.left + c.x, r.top + c.y]; }, [top.g.lat, top.g.lon]);
    await p.mouse.move(pt[0], pt[1], { steps: 22 }); await k.wait(300); await p.mouse.click(pt[0], pt[1]);
    await k.wait(500);
    // canvas markers do not always take a synthetic tap: open that gauge's own popup
    const how = await p.evaluate(([a, b]) => { if (document.querySelector(".leaflet-popup")) return "tap";
      const m = window.__asapMap; let hit = null;
      Object.values(m._layers).forEach((l) => { if (!hit && l.getLatLng && l.getPopup && l.getPopup()) { const q = l.getLatLng(); if (Math.abs(q.lat - a) < 1e-5 && Math.abs(q.lng - b) < 1e-5) hit = l; } });
      if (hit) { hit.openPopup(); return "open"; } return "none " + document.querySelector("[data-dsshow]"); }, [top.g.lat, top.g.lon]);
    console.log("  gauge popup", how);
    await k.wait(900);
    if (!(await p.evaluate(() => !!document.querySelector(".leaflet-popup")))) console.log("  no gauge popup");
    k.caption(`${top.g.d.toFixed(2)} m over the bank at ${dist(top.g.a)}`, `${top.g.p}. Hydro-Informatics Institute reading, ${top.g.t.slice(11)} local time.`);
    await k.wait(5500);
    const xb = await p.evaluateHandle(() => [...document.querySelectorAll(".pkghead .x")].find((x) => x.offsetParent) || null);
    if (xb.asElement()) { await k.glide(xb.asElement()); await k.wait(500); }
    await p.evaluate(() => { window.__asapMap.closePopup(); });
    await p.evaluate(() => window.OSAP_DISASTERX && window.OSAP_DISASTERX.set("now", true));
    k.caption("Flood water seen from orbit", "NASA's satellite flood map from the last three days.");
    await k.view([13.6, 100.4], 7, true); await k.wait(5500);
    if (top.r) {
      k.caption(`${Math.round(top.r.mm)} mm of rain in 24 hours`, `At ${dist(top.r.a)}, ${top.r.p}, the heaviest of any station.`);
      await k.view([top.r.lat, top.r.lon], 9, true); await k.wait(5000);
    }
    k.caption("Every reading dated and sourced", "So you can see what's happening, and where it came from.");
    await k.wait(4000);
  }],
  ["medplan", { hash: "#th/timeline", z: 13, at: [18.7883, 98.9853], settle: 9000 }, async ({ k, p }) => {
    const AT = [18.7883, 98.9853];
    const into = (sel, txt) => p.evaluate(([s, t]) => { const e = [...document.querySelectorAll(s)].find((x) => !t || x.textContent.trim().startsWith(t)); if (e) e.scrollIntoView({ behavior: "smooth", block: "start" }); return !!e; }, [sel, txt || ""]);
    // a long wait (routing, the forecast) is cut from the video
    const waitCut = async (fn, ms) => { const t0 = (Date.now() - k.t0) / 1000; try { await p.waitForFunction(fn, null, { timeout: ms }); } catch { console.log("  wait timed out"); } const t1 = (Date.now() - k.t0) / 1000; if (t1 - t0 > 1.5) k.skips.push([t0 + 0.6, t1]); };
    k.caption("A medical plan for anywhere, in seconds", "Pick the spot where you'll be. OSAP plans the rest.");
    await k.wait(1500);
    const c = await k.mapAt(0.45, 0.45);
    await p.mouse.move(c[0], c[1], { steps: 22 }); await k.wait(400);
    await p.evaluate((a) => window.OSAP_MEDPLAN.open({ at: a }), AT);
    await k.wait(1500);
    await k.press("Full", "#medplan");
    const stable = () => { const e = document.getElementById("mp-conop"), h = document.querySelector("#medplan .osheet-h"); if (!e) return false; const t = e.innerText;
      return !/Still reading|Reading|Building/i.test(h ? h.innerText : "") && /STATUS\s*(AMBER|GREEN)/.test(t) && /GROUND EVAC\s*AVAILABLE/.test(t) && /min \/ [\d.]+ km road/.test(t); };
    await waitCut(stable, 60000);
    const plan = await p.evaluate(() => { const t = (document.getElementById("mp-conop") || {}).innerText || ""; const m = t.match(/DEFINITIVE CARE[^\n]*\n([^\n]+)\n(\d+) min/); return { name: m ? m[1] : "", min: m ? m[2] : "", head: t.slice(0, 600) }; });
    console.log("  medplan", JSON.stringify(plan));
    await into("#mp-conop"); await k.wait(800);
    k.caption("The right hospital for the injury", plan.name ? `Ranked by what each can treat. Here: ${plan.name}, ${plan.min} min by road.` : "Ranked by what each one can treat, with the drive time.");
    await k.wait(5500);
    k.caption("Choose the injury and the plan follows", "Trauma, head injury, burns or limb injuries.");
    const head = async (t) => { const h = await p.evaluateHandle((t) => [...document.querySelectorAll("#medplan .osheet-h button")].find((b) => b.textContent.trim() === t && b.offsetParent) || null, t);
      if (!(await k.glide(h.asElement()))) console.log("  missing head", t); };
    const cat = async (id, ms) => { await tap(`#medplan [data-mp-cat="${id}"]`, 300); await waitCut(stable, 30000);
      console.log("  cat", id, await p.evaluate(() => ((document.getElementById("mp-conop") || {}).innerText || "").match(/STATUS\s*([^\n]+)/)?.[1])); await k.wait(ms); };
    const tap = async (sel, ms) => {
      await p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent); if (e) e.scrollIntoView({ behavior: "smooth", block: "center" }); }, sel);
      await k.wait(900);
      // only tap it when the button itself is what is under the finger (never a toolbar button above it)
      const ok = await p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent); if (!e) return false; const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit === e || e.contains(hit); }, sel);
      if (ok) await k.click(sel); else { console.log("  covered", sel); await p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent); if (e) e.click(); }, sel); }
      await k.wait(ms);
    };
    await cat("cat.severe_tbi", 2700); await cat("cat.major_burn", 2700); await cat("cat.major_trauma", 1000);
    k.caption("Emergency numbers and air ambulance", "Published numbers, nearby ambulance stations and air rescue services.");
    await into("#medplan h3", "4. Emergency contacts"); await k.wait(4200);
    k.caption("Road routes to each hospital, on the map", "First, second and third choice, with the drive time to each.");
    await head("Map"); await k.wait(5500);
    await head("Full"); await k.wait(1200);
    k.caption("A printable page for each hospital", "Emergency care, surgery, imaging and contacts, with \"Not known\" on every gap.");
    await tap("#medplan [data-mp-assess]", 2500);
    await k.wheel(260, 4, 1300, 0.5, 0.6);
    k.caption("Built from open data, every source linked", "A draft to confirm with the hospital, never a guarantee.");
    await k.wait(4000);
  }],
  ["todaybrief", { today: true, settle: 10000 }, async ({ k, p }) => {
    const cut = async (fn, ms, arg) => { const t0 = (Date.now() - k.t0) / 1000; try { await p.waitForFunction(fn, arg, { timeout: ms }); } catch { console.log("  wait timed out"); } const t1 = (Date.now() - k.t0) / 1000; if (t1 - t0 > 1.5) k.skips.push([t0 + 0.4, t1]); };
    const newsIn = () => { const n = document.querySelector(".tdnews"); return !!n && !/No reporting is held|Gathering top stories/.test(n.innerText) && n.querySelectorAll(".tdst").length > 2; };
    const top = () => p.evaluate(() => { window.scrollTo({ top: 0, behavior: "smooth" }); const b = document.getElementById("td-body"); if (b) b.scrollTo({ top: 0, behavior: "smooth" }); });
    const country = async (cc) => {
      await top(); await k.wait(700);
      const sel = await k.el("#td-cc"); if (!sel) { console.log("  no country select"); return false; }
      await k.glide(sel); await k.wait(300);
      const ok = await p.evaluate((cc) => { const s = document.getElementById("td-cc"); if (![...s.options].some((o) => o.value === cc)) return false; s.value = cc; s.dispatchEvent(new Event("change", { bubbles: true })); return true; }, cc);
      if (!ok) { console.log("  no option", cc); return false; }
      await k.wait(500); await p.waitForLoadState("load").catch(() => {}); await k.cursor();
      await cut(newsIn, 25000); await k.wait(600); return true;
    };
    k.caption("Every country's picture, in one place", "1,857 news feeds, 122 official warning feeds and 1,087 social accounts.");
    await k.wait(4000);
    k.caption("A daily summary, every line cited", "The top lines and what to watch, each linked to its report.");
    await k.into("#td-daily"); await k.wait(4500);
    k.caption("Translated to English, grouped into stories", "When several outlets report one event, it becomes one story.");
    await country("jp");
    await p.evaluate(() => { const n = document.querySelector(".tdnews"); if (n) n.scrollIntoView({ behavior: "smooth", block: "start" }); }); await k.wait(1500);
    const st = await p.evaluate(() => { const A = [...document.querySelectorAll(".tdnews .tdst")]; const a = A.find((x) => /\d+ sources/.test(x.innerText)) || A[0]; if (a) a.scrollIntoView({ behavior: "smooth", block: "center" }); return { n: A.length, multi: A.filter((x) => /\d+ sources/.test(x.innerText)).length, mt: A.filter((x) => /Machine translated/.test(x.innerText)).length, t: a ? a.innerText.slice(0, 160) : "" }; });
    console.log("  jp stories", JSON.stringify(st));
    await k.wait(3500);
    k.caption("Each story names its outlets", "With the time, a status tag and a link to the original.");
    await k.wheel(PHONE ? 260 : 320, 2, 1300, 0.5, 0.6); await k.wait(2000);
    k.caption("Every country, the same way", "News, warnings, hazards and weather for 198 countries.");
    for (const cc of ["ke", "br"]) {
      if (!(await country(cc))) continue;
      await k.wheel(PHONE ? 320 : 380, 2, 1100, 0.5, 0.6); await k.wait(1800);
    }
    k.caption("Your country, every morning", "Every item dated and linked to its source.");
    await k.wait(4000);
  }],
];

let fails = 0, n = 0;
for (const [name, opts, run] of SCENES) {
  n++;
  if (ONLY.length && !ONLY.includes(name)) continue;
  const nn = String(n).padStart(2, "0");
  let s;
  try {
    s = await start(name, opts);
    await run(s);
    await s.k.wait(600);
    await finish(name, nn, s);
    console.log("PASS", nn, name, JSON.stringify({ caps: s.k.caps.length, pdfs: s.k.pdfs.map((x) => x.file) }));
  } catch (e) {
    fails++; console.log("FAIL", nn, name, e.message.split("\n")[0]);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::promo ${name} failed: ${e.message.split("\n")[0]}`);
    if (s) await s.ctx.close().catch(() => {});
  }
}
await rm(join(OUT, "_raw"), { recursive: true, force: true });
await browser.close(); server.close();
console.log(fails ? `${fails} clip(s) failed` : "all clips recorded");
