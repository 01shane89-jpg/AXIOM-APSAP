// Scratch (claude/promo-video, never merged): records scenario reels for social posts, frame by frame.
// The page runs on Playwright's fake clock: each video frame advances the page's time by exactly 1/30 s and is then captured,
// so pans, zooms, scrolls and the cursor move at an even 30 frames a second however slow the machine is. Waits for the network
// (k.until, k.real) run on the real clock and capture nothing, so they are cut from the video by construction.
// VIEW=phone (400x560 at 2.7x, frames 1080x1512) or VIEW=desk (1280x720 at 1.5x, frames 1920x1080). ONLY=name,name.
// Output per scene: OUT/<nn>-<name>.mp4 (30 fps) + OUT/<nn>-<name>.json (captions on the video clock) + any PDFs.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";

const OUT = process.env.OUT || "story";
const PHONE = process.env.VIEW !== "desk";
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
const W = PHONE ? 400 : 1280, H = PHONE ? 560 : 720, DSF = PHONE ? 2.7 : 1.5;
const VW = Math.round(W * DSF), VH = Math.round(H * DSF);
const FPS = 30, STEP = 1000 / FPS;
const browser = await chromium.launch({ args: ["--disable-smooth-scrolling", "--hide-scrollbars"], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function kit(p, ctx, cdp, dir) {
  const k = { n: 0, caps: [], pdfs: [], paused: false, mx: W / 2, my: H * 0.6 };
  // CSS animations run on the real clock: their speed is matched to how long a frame really takes, so they play at about normal speed
  let rate = 1, tl = 0, tn = 0;
  const setRate = (r) => cdp.send("Animation.setPlaybackRate", { playbackRate: r }).catch(() => {});
  k.vt = () => k.n / FPS; // the video clock, in seconds
  k.pause = async () => {
    if (k.paused) return;
    await ctx.clock.pauseAt((await p.evaluate(() => Date.now())) + 250);
    await setRate(rate); k.paused = true; tl = Date.now(); tn = k.n;
  };
  k.resume = async () => {
    if (!k.paused) return;
    await setRate(1); await ctx.clock.resume(); k.paused = false;
  };
  // one frame: the page's time moves on by 1/30 s, then the screen is captured
  k.frame = async () => {
    if (!k.paused) await k.pause();
    await ctx.clock.runFor(STEP);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 94, optimizeForSpeed: true });
    await writeFile(join(dir, `f${String(k.n++).padStart(6, "0")}.jpg`), Buffer.from(data, "base64"));
    if (k.n - tn >= 15) { const ms = (Date.now() - tl) / (k.n - tn); rate = Math.max(0.05, Math.min(1, STEP / ms)); await setRate(rate); tl = Date.now(); tn = k.n; }
  };
  k.wait = async (ms) => { for (let i = Math.max(1, Math.round(ms / STEP)); i > 0; i--) await k.frame(); };
  // real time, nothing recorded (network, routing, building a PDF): the video cuts straight from before to after
  k.real = async (fn) => { await k.resume(); try { return await fn(); } finally { await k.pause(); } };
  k.until = (fn, arg, ms) => k.real(() => p.waitForFunction(fn, arg, { timeout: ms || 30000, polling: 250 }).then(() => true, () => { console.log("  wait timed out"); return false; }));
  k.caption = (text, sub) => { k.caps.push({ t: k.vt(), text, sub: sub || "" }); };
  k.cursor = () => p.evaluate(([x, y]) => {
    if (document.getElementById("wt-cur")) return;
    const c = document.createElement("div"); c.id = "wt-cur";
    c.style.cssText = `position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,196,40,.6);border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;left:${x}px;top:${y}px`;
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { c.style.transform = "scale(.72)"; }, true);
    addEventListener("mouseup", () => { c.style.transform = ""; }, true);
  }, [k.mx, k.my]);
  // the cursor travels on an eased path, one position per frame
  k.move = async (x, y, ms) => {
    const n = Math.max(6, Math.round((ms || Math.min(900, 380 + Math.hypot(x - k.mx, y - k.my) * 1.1)) / STEP)), x0 = k.mx, y0 = k.my;
    for (let i = 1; i <= n; i++) { const e = ease(i / n); await p.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e); await k.frame(); }
    k.mx = x; k.my = y;
  };
  k.tapAt = async (x, y) => { await k.move(x, y); await k.wait(120); await p.mouse.down(); await k.wait(90); await p.mouse.up(); await k.wait(150); };
  k.glide = async (h) => {
    if (!h) return false;
    const box = await h.boundingBox(); if (!box) return false;
    await k.move(box.x + box.width / 2, box.y + box.height / 2);
    await k.wait(120); await p.mouse.down(); await k.wait(90); await p.mouse.up(); await k.wait(150);
    return true;
  };
  k.el = async (sel) => { const all = await p.$$(sel); for (const h of all) if (await h.evaluate((e) => !!e.offsetParent || getComputedStyle(e).position === "fixed")) return h; return null; };
  k.click = async (sel) => { const ok = await k.glide(await k.el(sel)); if (!ok) console.log("  missing", sel); return ok; };
  k.byText = async (t, within) => (await p.evaluateHandle(([t, w]) => {
    const pre = t.endsWith("…"), s = pre ? t.slice(0, -1) : t, scope = w ? document.querySelector(w) : document; if (!scope) return null;
    return [...scope.querySelectorAll("button, [role=button], [role=menuitem], a, summary, label")].find((b) => {
      if (!b.offsetParent) return false; const x = b.textContent.replace(/\s+/g, " ").trim(); return pre ? x.startsWith(s) : x === s; }) || null;
  }, [t, within || ""])).asElement();
  k.press = async (t, within) => { const ok = await k.glide(await k.byText(t, within)); if (!ok) console.log("  missing button", JSON.stringify(t)); return ok; };
  k.tool = async (key) => {
    const h = (await p.evaluateHandle((key) => document.querySelector(`#atk-tools [data-atk="${key}"]`) || document.querySelector(`#atk-tools [data-tidy="${key}"]`) || document.querySelector(`#atk-tools button[aria-label="${key}"]`), key)).asElement();
    if (h) { await h.evaluate((e) => e.scrollIntoView({ block: "nearest" })); await k.wait(300); }
    const ok = await k.glide(h); if (!ok) console.log("  missing tool", key); return ok;
  };
  k.type = async (sel, text) => { const h = await k.el(sel); if (!h) { console.log("  missing field", sel); return false; } await k.glide(h); for (const ch of text) { await p.keyboard.type(ch); await k.wait(70); } return true; };
  k.view = (at, z, fly, secs) => p.evaluate(([a, z, f, s]) => { const m = window.__asapMap; m.invalidateSize(false); try { if (f) m.flyTo(a, z, { duration: s }); else m.setView(a, z, { animate: false }); } catch (e) { m.setView(a, z, { animate: false }); return String(e.message); } return "ok"; }, [at, z, !!fly, secs || 2.4]).then((r) => { if (r !== "ok") console.log("  view fallback", r); });
  k.fly = async (at, z, secs) => { await k.view(at, z, true, secs || 2.4); await k.wait((secs || 2.4) * 1000 + 300); };
  k.basemap = (b) => p.evaluate((b) => window.OSAP_BASEMAP && window.OSAP_BASEMAP.set(b), b);
  k.mapPt = (ll) => p.evaluate((ll) => { const m = window.__asapMap, c = m.latLngToContainerPoint(ll), r = document.getElementById("map").getBoundingClientRect(); return [r.left + c.x, r.top + c.y]; }, ll);
  // eased scrolling on the page's own (fake) clock: an element into view, or a scroll box by dy
  k.scrollTo = async (sel, block, ms) => {
    const ok = await p.evaluate(([s, b, d]) => {
      const e = typeof s === "string" ? document.querySelector(s) : s; if (!e) return false;
      let sc = e.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const box = sc || document.scrollingElement, er = e.getBoundingClientRect(), br = sc ? sc.getBoundingClientRect() : { top: 0, height: innerHeight };
      const off = b === "center" ? (br.height - er.height) / 2 : 12, to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + er.top - br.top - off));
      const from = box.scrollTop, t0 = performance.now(), f = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const step = () => { const x = Math.min(1, (performance.now() - t0) / d); box.scrollTop = from + (to - from) * f(x); if (x < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step); return true;
    }, [sel, block || "start", ms || 900]);
    await k.wait((ms || 900) + 150); return ok;
  };
  k.scrollBy = async (dy, ms, fx, fy) => {
    await k.move(W * (fx ?? 0.5), H * (fy ?? 0.62));
    await p.evaluate(([x, y, dy, d]) => {
      let sc = document.elementFromPoint(x, y); while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const box = sc || document.scrollingElement, from = box.scrollTop, t0 = performance.now(), f = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const step = () => { const q = Math.min(1, (performance.now() - t0) / d); box.scrollTop = from + dy * f(q); if (q < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, [W * (fx ?? 0.5), H * (fy ?? 0.62), dy, ms || 1100]);
    await k.wait((ms || 1100) + 150);
  };
  // the export the last tap started: wait (real time) for its window.print, save the page as a PDF
  k.pdf = async (file) => {
    const ok = await k.until((n) => (window.__prq || 0) > n, k.pdfs.length, 30000);
    if (!ok) { console.log("  no print for", file); return false; }
    await k.real(async () => {
      await p.waitForTimeout(600);
      await p.pdf({ path: join(OUT, file), printBackground: true, preferCSSPageSize: true, format: "Letter" }).catch((e) => console.log("  pdf failed", e.message));
      await p.evaluate(() => dispatchEvent(new Event("afterprint")));
    });
    k.pdfs.push({ file, t: k.vt() });
    return true;
  };
  return k;
}

async function start(name, o) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: PHONE, hasTouch: PHONE,
    serviceWorkers: "block", locale: "en-US", timezoneId: o.tz || "Asia/Bangkok", permissions: ["notifications"] });
  await ctx.clock.install({ time: Date.now() });
  await ctx.addInitScript((today) => { try {
    window.print = function () { window.__prq = (window.__prq || 0) + 1; };
    if (sessionStorage.getItem("wt-seeded")) return; sessionStorage.setItem("wt-seeded", "1");
    localStorage.setItem("osap-home", today ? "today" : "map"); sessionStorage.setItem("osap-today", today ? "1" : "0");
    localStorage.setItem("asap-period", JSON.stringify({ p: "all" }));
  } catch (e) {} }, !!o.today);
  const p = await ctx.newPage();
  const dir = join(OUT, "_raw", name); await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Animation.enable").catch(() => {});
  p.on("pageerror", (e) => console.log("  page error:", e.message.split("\n")[0]));
  const k = kit(p, ctx, cdp, dir);
  await p.goto(base + (o.hash || (o.today ? "#th" : "#th/map")));
  await p.waitForFunction(() => window.TSAP && (window.OSAP_TODAY || window.__asapMap), null, { timeout: 60000 });
  if (!o.today) {
    await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK, null, { timeout: 60000 });
    await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen && window.OSAP_TODAY.isOpen()) { const b = document.querySelector(".tdmap"); if (b) b.click(); } });
    if (o.at !== false) { await k.basemap(o.bm || "streets"); await k.view(o.at, o.z || 12); }
    await p.evaluate(() => { const b = document.querySelector('button[data-rv-mode="map"]'); if (b) b.click(); });
  }
  if (o.prep) await o.prep(p, k);
  await p.waitForTimeout(o.settle || 8000);
  await k.cursor();
  return { ctx, p, k, dir };
}
async function finish(name, nn, s) {
  await s.k.wait(500);
  await s.ctx.close();
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", "f%06d.jpg", "-vf", `scale=${VW}:${VH}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-movflags", "+faststart", resolve(OUT, `${nn}-${name}.mp4`)], { cwd: s.dir, stdio: "inherit" });
  if (r.status) throw new Error("ffmpeg failed for " + name);
  const { caps, pdfs } = s.k, end = s.k.vt();
  await writeFile(join(OUT, `${nn}-${name}.json`), JSON.stringify({ name, view: PHONE ? "phone" : "desk", w: VW, h: VH, frames: s.k.n, start: 0, end, caps, skips: [], pdfs }, null, 1));
}

// a circle of r km around c, as the watch's place search makes it
const ring = (c, km) => { const pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI; pts.push([c[0] + km / 111 * Math.cos(a), c[1] + km / (111 * Math.cos(c[0] * Math.PI / 180)) * Math.sin(a)]); } return pts; };
const BKK = [13.7563, 100.5018];

/* ---------- the scenes ---------- */
const SCENES = [
  // Business trip: see what is going on, take the area brief on the flight, then let a watch tell you when something happens nearby
  ["trip", { hash: "#th/timeline", z: 11, at: [13.745, 100.53], settle: 9000, prep: async (p) => {
    await p.evaluate(() => { try { localStorage.setItem("osap-w-pushnext", "false"); } catch (e) {} });
    await p.waitForFunction((pts) => window.OSAP_WATCH && window.OSAP_WATCH.matches({ area: pts }).length > 5, ring(BKK, 25), { timeout: 30000, polling: 1000 }).catch(() => console.log("  reports not loaded"));
  } }, async ({ k, p }) => {
    k.caption("First: what's going on there right now?", "Recent reports in and around Bangkok, on the map.");
    await k.wait(2600);
    // the report nearest the middle of the map
    const mk = (await p.evaluateHandle(() => {
      const r = document.getElementById("map").getBoundingClientRect(), cx = r.left + r.width * 0.45, cy = r.top + r.height * 0.45;
      let best = null, bd = 1e9;
      document.querySelectorAll("#map .leaflet-marker-icon.leaflet-interactive").forEach((m) => { const b = m.getBoundingClientRect(); if (b.top < r.top + 60 || b.bottom > r.bottom - 60 || b.left < r.left + 20 || b.right > r.right - 70) return; const d = Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy); if (d < bd) { bd = d; best = m; } });
      return best;
    })).asElement();
    k.caption("Tap a report: what happened, and who said so", "The outlet, the time in Zulu and local, and a link to the original.");
    if (!(await k.glide(mk))) console.log("  no marker");
    await k.wait(4800);
    await p.keyboard.press("Escape"); await p.evaluate(() => { window.__asapMap.closePopup(); document.querySelectorAll(".pkghead .x").forEach((x) => { if (x.offsetParent) x.click(); }); });
    await k.wait(600);
    k.caption("Circle the area around your hotel", "Now the map and the list show only what's inside it.");
    // the shape is picked through the page's own area control, so the area menu (with its other tools) is never on screen
    await p.evaluate(() => { const a = document.getElementById("area-ctl"); if (!a) return; let b = a.querySelector('[data-area="circle"]'); if (!b) { const o = a.querySelector('[data-area="open"]'); if (o) o.click(); b = a.querySelector('[data-area="circle"]'); } if (b) b.click(); });
    await k.wait(400);
    const c = await k.mapPt([13.744, 100.535]);
    await k.move(c[0], c[1]); await k.wait(200); await p.mouse.down();
    await k.move(c[0] + 115, c[1] + 40, 1200); await p.mouse.up(); k.mx = c[0] + 115; k.my = c[1] + 40;
    await k.wait(1800);
    if (!(await k.click('#area-ctl [data-area="done"]'))) await p.evaluate(() => { const d = document.querySelector('#area-ctl [data-area="done"]'); if (d) d.click(); });
    await k.wait(1200);
    k.caption("Take a brief of the area on the flight", "Maps, reports and sources in one PDF, ready to read offline.");
    await p.evaluate(() => window.OSAP_AREAREPORT.brief());
    await k.wait(600);
    await k.pdf("area-brief.pdf");
    await k.wait(2500);
    await k.scrollBy(700, 1600, 0.5, 0.6);
    await k.wait(1200);
    await k.scrollBy(-700, 1000, 0.5, 0.6);
    await k.press("Close");
    await k.wait(300);
    await p.evaluate(() => window.OSAP_AREAREPORT.close());
    await k.wait(600);
    await p.evaluate(() => window.__asapMap.invalidateSize());
    await k.wait(200);
    await k.fly([13.745, 100.53], 11, 1.6);
    k.caption("Then let OSAP keep watch while you're there", "Type the city and pick a distance.");
    await p.evaluate(() => { document.querySelectorAll(".chead .x, #atk-om [data-om=x]").forEach((x) => { if (x.offsetParent) x.click(); }); });
    if (!(await k.tool("watch"))) await p.evaluate(() => { const b = document.getElementById("watch-btn"); if (b) b.click(); });
    await k.wait(1500);
    await k.scrollTo("#w-pq", "center", 700);
    if (await k.type("#w-pq", "Bangkok")) { await k.wait(300); await k.press("Find"); }
    await k.until(() => !!document.querySelector("#w-plist .wpick"), null, 15000);
    await k.wait(500);
    await k.click("#w-plist .wpick"); await k.wait(700);
    const km = await k.el("#w-pkm"); if (km) { await k.glide(km); await p.keyboard.press("Escape"); await p.selectOption("#w-pkm", "25"); }
    await k.wait(1200);
    await k.scrollTo("#wform button[type=submit]", "center", 700);
    k.caption("Save it, and OSAP checks day and night", "Within minutes of new reports, with no account needed.");
    await k.press("Save watch");
    await k.wait(2200);
    // DEMO (disclosed with the reel): the three newest real reports inside the circle are treated as new, so the alert the app
    // shows is the one it would have shown when they arrived. The reload and checks run in real time and are cut from the video.
    const id = await k.real(async () => {
      const id = await p.evaluate(() => {
        const ws = JSON.parse(localStorage.getItem("asap-watches") || "[]"), w = ws[ws.length - 1]; if (!w) return "";
        delete w.base; localStorage.setItem("asap-watches", JSON.stringify(ws));
        const seen = JSON.parse(localStorage.getItem("asap-watch-seen") || "{}"); delete seen[w.id]; localStorage.setItem("asap-watch-seen", JSON.stringify(seen));
        localStorage.setItem("asap-watch-hits", "[]"); return w.id;
      });
      await p.reload();
      await p.waitForFunction((id) => { const w = (JSON.parse(localStorage.getItem("asap-watches") || "[]")).filter((x) => x.id === id)[0]; return w && w.base; }, id, { timeout: 90000, polling: 500 }).catch(() => console.log("  first check not done"));
      await p.waitForFunction((id) => { const w = (JSON.parse(localStorage.getItem("asap-watches") || "[]")).filter((x) => x.id === id)[0]; return w && window.OSAP_WATCH && window.OSAP_WATCH.matches(w).length > 3; }, id, { timeout: 60000, polling: 1000 }).catch(() => console.log("  matches still empty"));
      const n = await p.evaluate((id) => {
        const ws = JSON.parse(localStorage.getItem("asap-watches") || "[]"), w = ws.filter((x) => x.id === id)[0]; if (!w || !window.OSAP_WATCH) return -1;
        const seen = JSON.parse(localStorage.getItem("asap-watch-seen") || "{}"), sw = seen[id] || {};
        const ms = window.OSAP_WATCH.matches(w).map((m) => Object.assign({ _t: m.t0 || Date.parse(m.ts) || 0 }, m)).sort((a, b) => b._t - a._t);
        const keep = {}; let n = 0; ms.forEach((m) => { if (n < 3 && !keep[m.gk]) { keep[m.gk] = 1; n++; } });
        ms.forEach((m) => { if (keep[m.gk]) { delete sw[m.k]; if (m.sk) delete sw["s:" + m.sk]; } });
        seen[id] = sw; localStorage.setItem("asap-watch-seen", JSON.stringify(seen)); localStorage.setItem("asap-watch-hits", "[]");
        return { n, all: ms.length };
      }, id);
      console.log("  recent matches", JSON.stringify(n));
      await p.goto(base + "?wshow=" + encodeURIComponent(id) + "#th/timeline");
      await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK, null, { timeout: 60000 });
      await p.evaluate(() => { const b = document.querySelector('button[data-rv-mode="map"]'); if (b) b.click(); });
      await p.waitForFunction(() => { const t = document.getElementById("wtoast"); return t && !t.hidden; }, null, { timeout: 30000 }).catch(() => console.log("  no alert toast"));
      await p.waitForTimeout(3000);
      await k.cursor();
      return id;
    });
    k.caption("Something happens near you? You get an alert", "On screen, or as a push alert on your phone.");
    await k.wait(4200);
    k.caption("One tap: the report, the place and the source", "So you can decide what it means for your plans.");
    if (!(await k.click("#wtoast [data-w-openhit]"))) console.log("  no open button");
    await k.wait(5200);
  }],
];

let fails = 0, n = 20;
for (const [name, opts, run] of SCENES) {
  n++;
  if (ONLY.length && !ONLY.includes(name)) continue;
  const nn = String(n).padStart(2, "0");
  let s;
  try {
    s = await start(name, opts);
    await run(s);
    await finish(name, nn, s);
    console.log("PASS", nn, name, JSON.stringify({ secs: s.k.vt().toFixed(1), caps: s.k.caps.length, pdfs: s.k.pdfs.map((x) => x.file) }));
  } catch (e) {
    fails++; console.log("FAIL", nn, name, e.message.split("\n")[0]);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::story ${name} failed: ${e.message.split("\n")[0]}`);
    if (s) await s.ctx.close().catch(() => {});
  }
}
if (!process.env.KEEP_RAW) await rm(join(OUT, "_raw"), { recursive: true, force: true });
await browser.close(); server.close();
console.log(fails ? `${fails} scene(s) failed` : "all scenes recorded");
