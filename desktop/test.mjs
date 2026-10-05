// Desktop program checks, run headless against a local copy of the site (node test.mjs from desktop/, needs a display:
// xvfb-run on Linux). OSAP_TEST_ELECTRON may name a built program to test instead of node_modules/electron.
//  1. first start online: OSAP loads, the service worker takes control
//  2. second start with the site unreachable: OSAP still opens from the saved copy (not the "No internet" page)
//  3. first start with no internet and nothing saved: the "No internet" page
//  4. other sites never load in the window: links and window.open go to the normal browser instead
//  5. permissions: location allowed for OSAP, camera refused
import { _electron as electron } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
let up = true;
const server = http.createServer((req, res) => {
  if (!up) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "osap-desktop-"));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails++; };

async function start(url, dir) {
  const exe = process.env.OSAP_TEST_ELECTRON;
  const app = await electron.launch({
    ...(exe ? { executablePath: exe, args: ["--no-sandbox", `--user-data-dir=${dir}`] } : { args: ["--no-sandbox", `--user-data-dir=${dir}`, import.meta.dirname] }),
    env: { ...process.env, OSAP_URL: url },
  });
  if (process.env.OSAP_TEST_DEBUG) app.process().stderr.on("data", (d) => process.stderr.write(d));
  // Record what would open in the normal browser instead of opening it.
  await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(u); }; });
  const page = await app.firstWindow();
  return { app, page };
}

try {
  // 1
  let { app, page } = await start(URL_, profile);
  await page.waitForLoadState("load");
  ok((await page.title()) === "AXIOM OSAP", `online start loads OSAP (${page.url()})`);
  const ctl = await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller || (location.reload(), false)), null, { timeout: 120000, polling: 1000 }).then(() => true, () => false);
  ok(ctl, "service worker controls the page");
  // let the service worker finish saving the app shell before going offline
  await page.waitForTimeout(8000);

  // 4
  const before = page.url();
  await page.evaluate(() => window.open("https://example.com/story", "_blank", "noopener"));
  await page.evaluate(() => { const a = document.createElement("a"); a.href = "https://example.org/x"; document.body.appendChild(a); a.click(); });
  await page.waitForTimeout(1500);
  const opened = await app.evaluate(() => globalThis.__opened);
  ok(app.windows().length === 1, `window.open to another site made no new window (${app.windows().length})`);
  ok(page.url() === before, `link to another site left the window on OSAP (${page.url()})`);
  ok(opened.includes("https://example.com/story") && opened.includes("https://example.org/x"), `both went to the normal browser (${JSON.stringify(opened)})`);

  // 5
  const perms = await page.evaluate(async () => ({
    geo: (await navigator.permissions.query({ name: "geolocation" })).state,
    cam: (await navigator.permissions.query({ name: "camera" })).state,
  }));
  ok(perms.geo === "granted" && perms.cam === "denied", `location allowed, camera refused (${JSON.stringify(perms)})`);
  await app.close();

  // 2
  up = false;
  ({ app, page } = await start(URL_, profile));
  await page.waitForLoadState("load");
  ok((await page.title()) === "AXIOM OSAP" && page.url().startsWith(URL_), `offline restart opens the saved OSAP (${page.url()})`);
  await app.close();

  // 3
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "osap-desktop-"));
  ({ app, page } = await start(URL_, fresh));
  await page.waitForURL(/offline\.html/, { timeout: 30000 }).catch(() => {});
  ok(/offline\.html/.test(page.url()) && /No internet/.test(await page.textContent("h1")), `first start with no internet shows the No internet page (${page.url()})`);
  up = true;
  await page.click("#retry");
  await page.waitForURL((u) => u.href.startsWith(URL_), { timeout: 30000 }).catch(() => {});
  ok(page.url().startsWith(URL_), "Try again opens OSAP once the connection is back");
  await app.close();
} catch (e) {
  console.log("FAIL", e.message); fails++;
} finally {
  server.close();
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
