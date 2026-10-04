// Headless check that selected / active buttons and tabs stay readable in every theme (Light, Grey, Dark) on an iPhone-sized
// screen. Shane's report 2026-10-04: in Dark, Terrain's "Full window", the selected tool tab and "High detail" turned near-white
// with the light text still on them, so the label vanished.
// For each theme it opens the planning panels (Terrain analysis and its long-press Terrain menu and line of sight card, LZ
// finder, Medical plan, Evacuation planner, Route, Comms planning) and, for every visible button or tab, measures the contrast
// of its text against the background actually painted behind it; each button that can be pressed or selected is also measured
// in its pressed / selected state. Anything under 3:1 fails (the text is effectively invisible).
// Run from the repo root: node tests/selected_contrast_smoke.mjs   (needs the playwright package and Chromium)
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
const AT = [13.75, 100.5];

/* runs in the page: every visible button / tab under the given roots, as is and pressed / selected */
function audit(sel) {
  function rgba(s) { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  function over(top, bot) { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; }
  function bg(el) {
    const stack = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
    let c = [255, 255, 255, 1]; const pg = rgba(getComputedStyle(document.body).backgroundColor); if (pg[3] > 0) c = over(pg, c);
    for (let i = stack.length - 1; i >= 0; i--) c = over(stack[i], c);
    return c;
  }
  function lum(c) { return c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function ratio(el) { const b = bg(el), t = over(rgba(getComputedStyle(el).color), b), l1 = lum(t), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  function name(el) {
    const id = el.closest("[id]"); const t = (el.textContent || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return (id ? "#" + id.id + " " : "") + el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "") + ' "' + t + '"';
  }
  const bad = [], seen = new Set();
  let n = 0;
  const roots = sel.map((s) => document.querySelector(s)).filter(Boolean);
  roots.forEach((r) => r.querySelectorAll("button,[role=tab],a.btn").forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    const cs = getComputedStyle(el);
    if (!el.getClientRects().length || cs.visibility === "hidden" || +cs.opacity < 0.5 || el.disabled) return;
    if (!(el.textContent || "").trim()) return;            /* icon-only buttons: the icon carries its own colour */
    const states = [["", null]];
    if (el.hasAttribute("aria-pressed")) states.push(["aria-pressed", "true"]);
    if (el.getAttribute("role") === "tab" || el.hasAttribute("aria-selected")) states.push(["aria-selected", "true"]);
    if (el.hasAttribute("aria-current")) states.push(["aria-current", "true"]);
    states.forEach(([a, v]) => {
      const old = a ? el.getAttribute(a) : null;
      if (a) el.setAttribute(a, v);
      const r = ratio(el); n++;
      if (r < 3) bad.push(name(el) + (a ? " [" + a + "]" : "") + " " + r.toFixed(2) + ":1");
      if (a) { if (old == null) el.removeAttribute(a); else el.setAttribute(a, old); }
    });
  }));
  return { n, bad: [...new Set(bad)] };
}

async function page(theme) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: theme === "light" ? "light" : "dark" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((t) => { try { localStorage.setItem("tfw-theme", t); } catch (e) {} }, theme);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.__asapMap && window.OSAP_TERRAIN_ANALYSIS && window.OSAP_MEDPLAN, null, { timeout: 60000 });
  /* Find LZ and the evacuation planner load on first use */
  await p.evaluate(() => ["assets/osap-lz.js", "assets/osap-epe.js"].forEach((u) => { const s = document.createElement("script"); s.src = u; document.head.appendChild(s); }));
  await p.waitForFunction(() => window.OSAP_LZ && window.OSAP_EPE, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  ok(await p.evaluate((t) => document.documentElement.getAttribute("data-map") === t, theme), theme + ": theme applied");
  return { ctx, p, errors };
}

async function check(p, theme, label, roots) {
  const r = await p.evaluate(audit, roots);
  ok(r.n > 0 && r.bad.length === 0, `${theme}: ${label}: ${r.n} button states readable` + (r.bad.length ? "\n   " + r.bad.join("\n   ") : ""));
}

for (const theme of ["light", "grey", "dark"]) {
  const { ctx, p, errors } = await page(theme);
  /* the main screen: toolbar, view and theme switches, menus as they stand */
  await check(p, theme, "main screen", ["body"]);
  /* Terrain analysis panel, its long-press menu and a line of sight card in the panel and in a popup */
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.open()); await p.waitForTimeout(400);
  await check(p, theme, "Terrain analysis", ["#terrain"]);
  await p.evaluate((a) => window.OSAP_TERRAIN_ANALYSIS.menu(L.latLng(a[0], a[1])), AT); await p.waitForTimeout(300);
  await check(p, theme, "Terrain long-press menu", [".vsmenu"]);
  await p.evaluate(() => {
    const d = document.createElement("div"); d.id = "t-los"; d.className = "losc vslos";
    d.innerHTML = '<div class="h">LINE OF SIGHT</div><p>A to B</p><button type="button">Clear the line</button>';
    document.querySelector("#terrain").appendChild(d);
    const pop = document.querySelector(".vsmenu"); if (pop) { const q = d.cloneNode(true); q.id = "t-los-pop"; q.className = "vslos"; pop.appendChild(q); }
  });
  await check(p, theme, "line of sight card (panel and popup)", ["#t-los", "#t-los-pop"]);
  await p.evaluate(() => { window.__asapMap.closePopup(); window.OSAP_TERRAIN_ANALYSIS.close(); });
  /* LZ finder */
  await p.evaluate((a) => window.OSAP_LZ.at(a), AT); await p.waitForTimeout(800);
  await check(p, theme, "LZ finder", ["#lz-card"]);
  await p.evaluate(() => window.OSAP_LZ.close());
  /* Medical plan */
  await p.evaluate((a) => window.OSAP_MEDPLAN.open({ at: a }), AT); await p.waitForTimeout(800);
  await check(p, theme, "Medical plan", ["#medplan"]);
  await p.evaluate(() => window.OSAP_MEDPLAN.close());
  /* Evacuation planner */
  await p.evaluate((a) => window.OSAP_EPE.open({ at: a }), AT); await p.waitForTimeout(600);
  await check(p, theme, "Evacuation planner", ["#epe"]);
  await p.evaluate(() => window.OSAP_EPE.close());
  /* Route */
  await p.evaluate((a) => window.OSAP_ROUTE_SEED([a]), AT);
  await p.waitForFunction(() => window.OSAP_ROUTETAB && document.getElementById("rt-evac"), null, { timeout: 30000 }); await p.waitForTimeout(500);
  await check(p, theme, "Route", ["#rail-sof"]);
  /* Comms planning */
  await p.evaluate(() => document.querySelector('#view-seg [data-view="comms"]').click()); await p.waitForTimeout(800);
  await check(p, theme, "Comms planning", ["#rail-sof"]);
  ok(errors.length === 0, `${theme}: no page errors` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
