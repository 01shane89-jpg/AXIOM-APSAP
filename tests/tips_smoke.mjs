// Headless check of tips, the tour and "Show me in the app" (assets/osap-tips.js): Settings lists Show tips and Take the tour;
// the first check offers the tour, which rings each toolbar button in turn and closes with Esc; a tip shows one tool, Show me
// rings it and Open it presses it; Next tip shows another; a tool just used queues its follow-up; tips never show over an open
// window; Turn off tips stops them and Settings turns them back on; every tip names a real toolbar button and a real guide
// section; the guide's Show me in the app opens the ring; the card and the ring fit a phone. Desktop and phone.
// Run from the repo root: node tests/tips_smoke.mjs   (needs the playwright package and Chromium)
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
const seed = () => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); } };

async function page(vp, phone) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: !!phone, hasTouch: !!phone, serviceWorkers: "block" });
  await ctx.addInitScript(seed);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base + "#th/map");
  await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK && window.OSAP_TIPS && window.OSAP_GUIDE, null, { timeout: 60000 });
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
  await p.waitForTimeout(800);
  return { p, ctx, errs };
}
const card = (p) => p.evaluate(() => { const c = document.getElementById("tipcard"); return c ? c.getAttribute("data-tip") : null; });
const inside = (a, b, pad = 6) => a && b && a.left <= b.left + pad && a.top <= b.top + pad && a.right >= b.right - pad && a.bottom >= b.bottom - pad;

/* ---------- desktop ---------- */
{
  const { p, ctx, errs } = await page({ width: 1440, height: 900 });
  // automated browsers get nothing by themselves: no card after the 5 s check runs
  await p.waitForTimeout(5600);
  ok(await card(p) === null, "no tip or tour offer by itself in an automated browser");

  // every tip names a real toolbar button and a real guide section; every walk is a guide section
  const ref = await p.evaluate(() => {
    const tools = [...document.querySelectorAll("#atk-tools .atk-list button")].map((b) => b.getAttribute("aria-label"));
    const secs = window.OSAP_GUIDE.sections().map((s) => s.id);
    const T = window.OSAP_TIPS.tips();
    return {
      n: T.length,
      badTool: T.flatMap((t) => t.tool.filter((x) => !tools.includes(x)).map((x) => t.id + ":" + x)),
      badAfter: T.filter((t) => t.after && !tools.includes(t.after)).map((t) => t.id),
      badGuide: T.filter((t) => t.guide && !secs.includes(t.guide)).map((t) => t.id + ":" + t.guide),
      badWalk: window.OSAP_TIPS.walks().filter((w) => !secs.includes(w)),
      ctx: [...new Set(T.map((t) => t.ctx))]
    };
  });
  ok(ref.n >= 25, "tips are there", ref.n);
  ok(ref.badTool.length === 0, "every tip's tool is a toolbar button", ref.badTool);
  ok(ref.badAfter.length === 0, "every follow-up follows a toolbar button", ref.badAfter);
  ok(ref.badGuide.length === 0, "every tip's guide link is a guide section", ref.badGuide);
  ok(ref.badWalk.length === 0, "every walkthrough is a guide section", ref.badWalk);
  ok(["map", "today", "after"].every((c) => ref.ctx.includes(c)), "tips for the map, Today and follow-ups", ref.ctx);

  // Settings lists the switch (on) and the tour
  await p.evaluate(() => document.getElementById("tidy-set").click());
  ok(await p.locator('#tidy-pop input[data-tset="tips"]').isChecked(), "Settings: Show tips is on by default");
  ok(await p.locator('#tidy-pop [data-tp="@tour"]').count() === 1, "Settings: Take the tour is listed");
  await p.keyboard.press("Escape"); await p.evaluate(() => document.body.click());
  await p.waitForTimeout(200);

  // the first check offers the tour
  await p.evaluate(() => window.OSAP_TIPS.check());
  ok(await card(p) === "tour", "the first check offers the tour");
  await p.click('#tipcard [data-to="go"]');
  await p.waitForSelector("#tipcall");
  const steps = [];
  for (let i = 0; i < 20; i++) {
    const s = await p.evaluate(() => {
      const c = document.getElementById("tipcall"); if (!c) return null;
      const sp = document.getElementById("tipspot").getBoundingClientRect(), cr = c.getBoundingClientRect();
      const n = (c.querySelector(".tipn") || {}).textContent || "";
      return { n, text: c.querySelector("p").textContent, hole: !document.getElementById("tipspot").classList.contains("nohole"),
        spot: { left: sp.left, top: sp.top, right: sp.right, bottom: sp.bottom }, call: { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom },
        vw: innerWidth, vh: innerHeight, focus: c.contains(document.activeElement) };
    });
    if (!s) break;
    steps.push(s);
    if (await p.locator('#tipcall [data-tc="next"]').count()) await p.click('#tipcall [data-tc="next"]');
    else break;
  }
  ok(steps.length >= 10, "the tour walks through the toolbar and Settings", steps.map((s) => s.n));
  ok(/^1 of \d+$/.test(steps[0].n) && /Today/.test(steps[0].text), "the tour starts on Today", steps[0]);
  const todayBtn = await p.evaluate(() => { const r = document.querySelector('#atk-tools .atk-list button[aria-label="Today"]').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
  ok(inside(steps[0].spot, todayBtn), "the ring is round the Today button", { spot: steps[0].spot, todayBtn });
  ok(steps.every((s) => s.call.left >= 0 && s.call.top >= 0 && s.call.right <= s.vw && s.call.bottom <= s.vh), "every callout is on screen");
  ok(steps.every((s) => s.focus), "focus stays on the callout");
  ok(steps.slice(0, -1).every((s) => s.hole), "each toolbar step rings something");
  ok(await p.locator('#tipcall [data-tc="x"]').filter({ hasText: "Done" }).count() === 1, "the last step says Done");
  await p.keyboard.press("Escape");
  ok(await p.evaluate(() => !document.getElementById("tipcall") && !document.getElementById("tipspot") && !document.getElementById("tipcatch")), "Esc ends the tour and leaves nothing behind");

  // a tip: one tool, Show me rings it, Open it presses it
  await p.evaluate(() => window.OSAP_TIPS.check());
  const t1 = await card(p);
  ok(t1 && t1 !== "tour", "the next check shows a tip", t1);
  const tip = await p.evaluate((id) => window.OSAP_TIPS.tips().find((t) => t.id === id), t1);
  ok(await p.locator("#tipcard .tipk").textContent() === "Tip", "the card is labeled Tip");
  await p.click('#tipcard [data-tk="next"]');
  const t2 = await card(p);
  ok(t2 && t2 !== t1, "Next tip shows another", [t1, t2]);
  // pick a tip with a tool for Show me
  await p.evaluate(() => window.OSAP_TIPS.show("watch"));
  await p.click('#tipcard [data-tk="show"]');
  await p.waitForSelector("#tipcall");
  const ring = await p.evaluate(() => {
    const sp = document.getElementById("tipspot").getBoundingClientRect(), r = document.querySelector('#atk-tools .atk-list button[aria-label="Watch"]').getBoundingClientRect();
    return { sp: { left: sp.left, top: sp.top, right: sp.right, bottom: sp.bottom }, r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, open: !!document.querySelector('#tipcall [data-tc="open"]') };
  });
  ok(inside(ring.sp, ring.r) && ring.open, "Show me rings the Watch button and offers Open it", ring);
  const pressed = await p.evaluate(() => new Promise((res) => {
    const b = document.querySelector('#atk-tools .atk-list button[aria-label="Watch"]');
    b.addEventListener("click", () => res(true), { once: true }); document.querySelector('#tipcall [data-tc="open"]').click(); setTimeout(() => res(false), 500);
  }));
  ok(pressed, "Open it presses the tool");
  ok(await p.evaluate(() => !document.getElementById("tipcall")), "and the ring closes");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.evaluate(() => { const c = document.querySelector('#tipcard'); if (c) c.remove(); });
  ok(await p.evaluate(() => !!(JSON.parse(localStorage.getItem("osap-tips")).used || {}).Watch), "the tool used is noted on this device");

  // a tool just used queues its follow-up
  await p.evaluate(() => { window.OSAP_TIPS.close(); document.querySelector('#atk-tools .atk-list button[aria-label="Area"]').click(); });
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.evaluate(() => window.OSAP_TIPS.check());
  const fu = await card(p);
  ok(fu === "after-area" || fu === null, "drawing an area queues Area summary (or waits while the tool is open)", fu);
  if (fu === null) ok(await p.evaluate(() => [...document.querySelectorAll("#meas-card,#atk-pop,.osplit,[id$=dlg]")].some((e) => !e.hidden && e.offsetWidth > 0)), "the tip waits because a tool is open");
  await p.evaluate(() => window.OSAP_TIPS.close());

  // never over an open window
  await p.evaluate(() => window.OSAP_GUIDE.open());
  await p.evaluate(() => window.OSAP_TIPS.check());
  ok(await card(p) === null, "no tip while the guide is open");

  // the guide's Show me in the app
  const gs = await p.evaluate(() => [...document.querySelectorAll("#guidedlg .gshow")].map((b) => b.getAttribute("data-gwalk")));
  ok(gs.includes("medplan") && gs.includes("reports") && gs.includes("tips"), "guide sections have Show me in the app", gs);
  await p.click('#guidedlg [data-gwalk="reports"]');
  await p.waitForSelector("#tipcall");
  ok(await p.evaluate(() => !window.OSAP_GUIDE.isOpen() && /Reports/.test(document.querySelector("#tipcall p").textContent)), "Show me in the app closes the guide and rings Reports");
  await p.keyboard.press("Escape");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector("#guidedlg .gshow")).display) !== "none", "the button shows on screen");
  // new guide sections
  const S = await p.evaluate(() => window.OSAP_GUIDE.sections().map((s) => s.id));
  for (const id of ["news", "tabs", "security", "tips"]) ok(S.includes(id), "guide section " + id);

  // Turn off tips stops them; Settings turns them back on
  await p.evaluate(() => window.OSAP_TIPS.show("search"));
  await p.click('#tipcard [data-tk="off"]');
  ok(await p.evaluate(() => !window.OSAP_TIPS.on() && JSON.parse(localStorage.getItem("osap-tips")).off === true), "Turn off tips turns them off and remembers it");
  await p.waitForTimeout(300);
  await p.evaluate(() => { const c = document.getElementById("tipcard"); if (c) c.remove(); window.OSAP_TIPS.check(); });
  ok(await card(p) === null, "no tips once off");
  await p.evaluate(() => document.getElementById("tidy-set").click());
  const box = p.locator('#tidy-pop input[data-tset="tips"]');
  ok(!(await box.isChecked()), "Settings shows Show tips off");
  await box.check();
  ok(await p.evaluate(() => window.OSAP_TIPS.on()), "ticking Show tips turns them back on");
  await p.keyboard.press("Escape");
  // Take the tour from Settings
  await p.evaluate(() => document.getElementById("tidy-set").click());
  await p.click('#tidy-pop [data-tp="@tour"]');
  ok(await p.evaluate(() => !!document.getElementById("tipcall")), "Settings, Take the tour starts the tour");
  await p.keyboard.press("Escape");
  ok(errs.length === 0, "no page errors (desktop)", errs);
  await ctx.close();
}

/* ---------- phone ---------- */
{
  const { p, ctx, errs } = await page({ width: 390, height: 844 }, true);
  await p.evaluate(() => window.OSAP_TIPS.check());
  const fit = await p.evaluate(() => { const r = document.getElementById("tipcard").getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, btn: [...document.querySelectorAll("#tipcard button.refresh")].map((b) => b.getBoundingClientRect().height) }; });
  ok(fit.l >= 8 && fit.r <= fit.vw - 8 && fit.b <= fit.vh, "the card fits a phone", fit);
  ok(fit.btn.every((h) => h >= 44), "its buttons are big enough to tap", fit.btn);
  await p.click('#tipcard [data-to="go"]');
  let n = 0, off = [];
  for (; n < 20; n++) {
    const s = await p.evaluate(() => { const c = document.getElementById("tipcall"); if (!c) return null; const r = c.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    if (!s) break;
    if (s.l < 0 || s.r > s.vw || s.t < 0 || s.b > s.vh) off.push(n);
    if (await p.locator('#tipcall [data-tc="next"]').count()) await p.tap('#tipcall [data-tc="next"]'); else break;
  }
  ok(n >= 6, "the tour runs on a phone", n);
  ok(off.length === 0, "every callout fits the phone screen", off);
  await p.keyboard.press("Escape");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll");
  ok(errs.length === 0, "no page errors (phone)", errs);
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all tips checks passed");
process.exit(fails ? 1 : 0);
