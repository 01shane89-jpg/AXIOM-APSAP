// Headless check of Settings > Install OSAP as an app (assets/osap-install.js):
// - Chromium itself says the page is installable (manifest, icons, service worker): Page.getInstallabilityErrors is empty.
// - A computer browser that offers the install question: the Settings item is there, Install OSAP asks the browser's own
//   question, and on "accepted" the box says it is installed; on "dismissed" it says so and nothing breaks.
// - iPhone Safari: no install button, the Share > Add to Home Screen steps. iPhone Chrome: the steps plus "use Safari".
// - Already installed (iPhone home-screen app, or the OSAP desktop program): no Settings item, nothing in search.
// - Search "install" finds it.
// Run from the repo root: node tests/install_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, devices } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
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
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 300))); if (!c) fails++; }

async function open(opts, init) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-setup", "skipped"); } catch (e) {} });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th"); await p.waitForTimeout(4000);
  return { ctx, p, errors };
}
const menuHas = (p) => p.evaluate(() => { const b = document.querySelector('[data-tidy="set"]'); if (b) b.click(); const has = !!document.querySelector('[data-tp="@install"]'); if (b) b.click(); return { gear: !!b, has }; });
const dlg = (p) => p.evaluate(() => { const d = document.getElementById("instdlg"); return d && !d.hidden ? { text: d.innerText, go: !!d.querySelector('[data-inst="go"]') } : null; });

// 0. Chromium's own installability check, in a normal (not incognito) profile with the service worker running
{
  const { mkdtemp, rm } = await import("node:fs/promises"), { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "osap-install-"));
  const ctx = await chromium.launchPersistentContext(dir, { ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), viewport: { width: 1400, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto(base + "#th");
  await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => {});
  const cdp = await ctx.newCDPSession(p);
  const inst = await cdp.send("Page.getInstallabilityErrors").catch((e) => ({ err: e.message }));
  ok(inst.installabilityErrors && inst.installabilityErrors.length === 0, "Chromium finds OSAP installable (manifest, icons, service worker)", inst);
  const man = await cdp.send("Page.getAppManifest").catch(() => ({}));
  ok(man.errors && man.errors.length === 0 && /AXIOM OSAP/.test(man.data || ""), "the manifest reads with no errors", man.errors);
  await ctx.close(); await rm(dir, { recursive: true, force: true });
}
// 1. a computer browser: installable, and the browser's own question
{
  const { ctx, p, errors } = await open({});
  ok(await p.evaluate(() => window.OSAP_INSTALL && window.OSAP_INSTALL.state()) === "other", "before the browser offers, the general steps", await p.evaluate(() => window.OSAP_INSTALL && window.OSAP_INSTALL.state()));
  // the browser's install event, as Chrome and Edge fire it
  await p.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    window.__asked = 0; e.prompt = () => { window.__asked++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(e); window.__prevented = e.defaultPrevented;
  });
  ok(await p.evaluate(() => window.__prevented), "the install event is kept for the Install button");
  const m = await menuHas(p);
  ok(m.gear && m.has, "Settings lists Install OSAP as an app", m);
  await p.evaluate(() => { document.querySelector('[data-tidy="set"]').click(); document.querySelector('[data-tp="@install"]').click(); });
  await p.waitForTimeout(300);
  let d = await dlg(p);
  ok(d && d.go && /Install OSAP as an app/.test(d.text) && /works?|working/.test(d.text), "the box opens with one Install button and why", d && d.text.slice(0, 200));
  await p.click('#instdlg [data-inst="go"]'); await p.waitForTimeout(300);
  d = await dlg(p);
  ok(await p.evaluate(() => window.__asked) === 1, "Install OSAP asks the browser's own question once");
  ok(d && /Installed/.test(d.text) && !d.go, "after Install: says it is installed", d && d.text.slice(0, 160));
  await p.keyboard.press("Escape");
  ok(await dlg(p) === null, "Escape closes it");
  ok((await menuHas(p)).has === false, "once installed, the Settings item goes");
  ok(errors.length === 0, "no page errors", errors);
  await ctx.close();
}
// 2. the question dismissed
{
  const { ctx, p, errors } = await open({}, () => {
    window.addEventListener("load", () => setTimeout(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: "dismissed" }); window.dispatchEvent(e);
    }, 50));
  });
  await p.evaluate(() => window.OSAP_INSTALL.open()); await p.waitForTimeout(200);
  await p.click('#instdlg [data-inst="go"]'); await p.waitForTimeout(300);
  const d = await dlg(p);
  ok(d && /Not installed/.test(d.text), "dismissed: says it was not installed and how to later", d && d.text.slice(-260));
  ok(errors.length === 0, "no page errors", errors);
  await ctx.close();
}
// 3. iPhone Safari and iPhone Chrome
{
  const { ctx, p, errors } = await open({ ...devices["iPhone 13"] });
  ok(await p.evaluate(() => window.OSAP_INSTALL.state()) === "ios", "iPhone Safari: the iPhone steps");
  ok((await menuHas(p)).has, "iPhone Safari: Settings lists it");
  await p.evaluate(() => window.OSAP_INSTALL.open()); await p.waitForTimeout(200);
  const d = await dlg(p);
  ok(d && !d.go && /Share/.test(d.text) && /Add to Home Screen/.test(d.text), "iPhone: Share, then Add to Home Screen, no Install button", d && d.text.slice(0, 300));
  // fits the phone screen
  const fit = await p.evaluate(() => { const r = document.querySelector("#instdlg .ip").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; });
  ok(fit, "the box fits the iPhone screen");
  ok(errors.length === 0, "no page errors", errors);
  await ctx.close();
}
{
  const ua = devices["iPhone 13"].userAgent.replace("Version/", "CriOS/120.0.0.0 Version/");
  const { ctx, p } = await open({ ...devices["iPhone 13"], userAgent: ua });
  await p.evaluate(() => window.OSAP_INSTALL.open()); await p.waitForTimeout(200);
  const d = await dlg(p);
  ok(d && /Safari/.test(d.text), "iPhone Chrome: also says to use Safari if the option is missing", d && d.text.slice(0, 300));
  await ctx.close();
}
// 4. already installed: the iPhone home-screen app, and the OSAP desktop program
{
  const { ctx, p } = await open({ ...devices["iPhone 13"] }, () => { Object.defineProperty(navigator, "standalone", { get: () => true }); });
  ok(await p.evaluate(() => window.OSAP_INSTALL.state()) === "installed", "iPhone home-screen app: counted as installed");
  ok((await menuHas(p)).has === false, "home-screen app: no Settings item");
  await ctx.close();
}
{
  const { ctx, p } = await open({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) axiom-osap/0.1.1 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36" });
  ok(await p.evaluate(() => window.OSAP_INSTALL.state()) === "installed", "OSAP desktop program: counted as installed");
  ok((await menuHas(p)).has === false, "desktop program: no Settings item");
  await ctx.close();
}
// 5. search finds it
{
  const { ctx, p } = await open({});
  const found = await p.evaluate(() => (window.OSAP_FINDALL.match("install", 20) || []).map((r) => r.name));
  ok(found.includes("Install OSAP as an app"), "search: install finds Install OSAP as an app", found);
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
