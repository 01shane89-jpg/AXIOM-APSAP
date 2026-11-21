// Headless check that Export PDF never seems dead (assets/osap-pdf.js; Shane 2026-11-21: "Export to pdf in the weather brief is
// not responding"):
//   - print() is called inside the tap itself, not from a timer afterwards (Safari on iPhone and iPad ignores a later one), for
//     a bare page and for the weather brief's own Export PDF button (brief, easy read, detailed report, 5-day chart);
//   - when the device opens no print dialog (print() does nothing: an app on the iPhone Home Screen, a browser inside another
//     app) a message says so with the steps for that device, and its Try again button prints again from the tap;
//   - when a dialog does open (beforeprint/afterprint), no message shows and the export tidies up after afterprint.
// External hosts are blocked; weather is answered with a flat made-up forecast. Run from the repo root:
//   node tests/pdf_print_open_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".webp": "image/webp", ".jpg": "image/jpeg" };
const root = process.cwd();
const BARE = '<!doctype html><meta charset="utf-8"><title>Bare</title><body><div id="rep"><h2>Test report</h2><p>See https://example.com/source for more.</p></div>' +
  '<button id="go">Export PDF</button><script src="assets/osap-pdf.js"></script>' +
  '<script>document.getElementById("go").onclick=function(){window.__done=null;OSAP_PDF.print({title:"Test report",root:"#rep"}).then(function(i){window.__done=i||{};});};</script>';
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/bare.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(BARE); }
  const path = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

/* window.print stand-in: mode "none" does nothing (no dialog), "dialog" fires beforeprint then afterprint like a dialog that
   opened and closed; it records whether it ran inside the tap (a capture listener marks the tap until the next task) */
function stub(mode) {
  window.__prints = []; window.__inTap = false;
  document.addEventListener("click", () => { window.__inTap = true; setTimeout(() => { window.__inTap = false; }, 0); }, true);
  window.print = function () {
    window.__prints.push({ inTap: window.__inTap, title: document.title, pdfx: document.documentElement.classList.contains("pdfx") });
    if (window.__printMode === "dialog") { dispatchEvent(new Event("beforeprint")); setTimeout(() => dispatchEvent(new Event("afterprint")), 50); }
  };
  window.__printMode = mode;
  window.__pdfCheckDialog = true;   /* treat this stand-in as the browser's own print() */
}
async function ctxFor(opt) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: opt.viewport || { width: 1280, height: 860 }, userAgent: opt.ua, hasTouch: !!opt.touch });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const h = new URL(r.request().url()).host;
    if (/(^|\.)open-meteo\.com$/.test(h)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
    return r.abort();
  });
  await ctx.addInitScript(stub, opt.mode || "none");
  if (opt.standalone) await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p, errors };
}
const note = (p) => p.evaluate(() => { const b = document.getElementById("pdfx-noprint"); return b && !b.hidden ? b.innerText : ""; });

/* 1. no dialog opens: the tap prints at once, then a message says so; Try again prints again from its own tap */
{
  const { ctx, p, errors } = await ctxFor({ mode: "none" });
  await p.goto(base + "bare.html"); await p.click("#go");
  const first = await p.evaluate(() => window.__prints.slice());
  ok(first.length === 1 && first[0].inTap, "print() runs inside the tap (" + JSON.stringify(first) + ")");
  ok(first[0] && first[0].pdfx && /^OSAP Test report/.test(first[0].title), "print rules and the file name are on when print() runs (" + (first[0] && first[0].title) + ")");
  ok(!(await note(p)), "no message while the dialog may still be opening");
  await p.waitForTimeout(1800);
  const t = await note(p);
  ok(/No print dialog opened/.test(t) && /Save as PDF/.test(t), "no dialog: a message says so with the steps (" + t.slice(0, 90).replace(/\n/g, " ") + ")");
  ok(await p.evaluate(() => !!window.__done && !document.documentElement.classList.contains("pdfx") && document.title === "Bare"), "no dialog: the export tidies up and the page title comes back");
  await p.click('#pdfx-noprint [data-pdfx="again"]');
  const again = await p.evaluate(() => window.__prints.slice());
  ok(again.length === 2 && again[1].inTap, "Try again prints again from its own tap");
  ok(!(await note(p)), "Try again hides the message");
  await p.waitForTimeout(1800);
  ok(/No print dialog opened/.test(await note(p)), "Try again with still no dialog shows the message again");
  await p.click('#pdfx-noprint [data-pdfx="close"]');
  ok(!(await note(p)), "Close hides the message");
  ok(!errors.length, "no page errors (" + errors.join("; ") + ")");
  await ctx.close();
}
/* 2. a dialog opens and closes: no message, and the export finishes on afterprint */
{
  const { ctx, p, errors } = await ctxFor({ mode: "dialog" });
  await p.goto(base + "bare.html"); await p.click("#go");
  await p.waitForTimeout(1800);
  ok(!(await note(p)), "a dialog that opened: no message");
  ok(await p.evaluate(() => !!window.__done && window.__prints.length === 1 && !document.documentElement.classList.contains("pdfx")), "a dialog that opened: the export finishes on afterprint");
  ok(!errors.length, "no page errors (" + errors.join("; ") + ")");
  await ctx.close();
}
/* 3. iPhone Home Screen app and iPhone Safari get their own steps */
{
  const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  for (const [standalone, re, name] of [[true, /Home Screen.*Safari/s, "iPhone Home Screen app"], [false, /share button.*Print/s, "iPhone Safari"]]) {
    const { ctx, p } = await ctxFor({ mode: "none", ua: IOS, standalone, viewport: { width: 390, height: 844 }, touch: true });
    await p.goto(base + "bare.html"); await p.tap("#go"); await p.waitForTimeout(1800);
    const t = await note(p);
    ok(re.test(t), name + ": the message gives that device's steps (" + t.slice(0, 120).replace(/\n/g, " ") + ")");
    const box = await p.evaluate(() => { const r = document.getElementById("pdfx-noprint").getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
    ok(box.l >= 8 && box.r <= box.w - 8 && box.b <= box.h, name + ": the message fits the phone screen (" + JSON.stringify(box) + ")");
    await ctx.close();
  }
}
/* 4. the weather brief's own Export PDF buttons print inside the tap, on a laptop and on a phone */
for (const vp of [{ width: 1400, height: 900 }, { width: 390, height: 844 }]) {
  const { ctx, p, errors } = await ctxFor({ mode: "dialog", viewport: vp, touch: vp.width < 500 });
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_WX && window.OSAP_PDF && window.__asapMap, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  for (const [fn, id] of [["brief", "wxb-page"], ["easy", "wxe-page"], ["report", "wxr-page"], ["chart", "wxc-page"]]) {
    await p.evaluate(() => { window.__prints = []; });
    await p.evaluate((fn) => window.OSAP_WX[fn](), fn);
    const shown = await p.waitForSelector('#brief #' + id + ' ~ *, #brief [data-wxb="print"]', { timeout: 60000 }).then(() => true, () => false);
    if (shown) await p.click('#brief [data-wxb="print"]');
    const pr = await p.evaluate(() => window.__prints.slice());
    ok(shown && pr.length === 1 && pr[0].inTap && /^OSAP /.test(pr[0].title), vp.width + " px, weather " + fn + ": Export PDF prints inside the tap (" + JSON.stringify(pr) + ")");
    await p.waitForTimeout(200);
    await p.evaluate(() => { const b = document.querySelector('#brief [data-wxb="close"]'); if (b) b.click(); });
  }
  ok(!(await note(p)), vp.width + " px: no 'no dialog' message when the dialog opens");
  ok(!errors.length, vp.width + " px: no page errors (" + errors.join("; ").slice(0, 300) + ")");
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
