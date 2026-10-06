// Headless check of the interface language picker (assets/osap-lang.js): English loads nothing from Google, Settings >
// Language opens the picker, picking a language loads the translator and switches it, the choice comes back after a
// reload, English again clears it, an unreachable translator leaves the page in English with a message, and the map
// stays marked translate="no". Google's script is replaced by a local stand-in, so the test needs no network.
// Run from the repo root: node tests/lang_smoke.mjs   (needs the playwright package and Chromium)
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

/* stands in for Google's element.js: builds the hidden language box and records what it was asked for */
const STUB = `(function(){window.google={translate:{TranslateElement:function(o,el){window.__gtOpts=o;var s=document.createElement("select");
s.className="goog-te-combo";["","fr","th","de"].forEach(function(v){var x=document.createElement("option");x.value=v;s.appendChild(x);});
s.addEventListener("change",function(){window.__gtLang=s.value;document.documentElement.classList.add("translated-ltr");});el.appendChild(s);}}};
var m=/[?&]cb=([^&]+)/.exec(document.currentScript.src);if(m)window[m[1]]();})();`;

async function ctxWith(google = "stub") {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  const gt = []; const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/translate\.google\.com\/translate_a\/element\.js/.test(u)) { gt.push(u); return google === "stub" ? r.fulfill({ contentType: "text/javascript", body: STUB }) : r.abort(); }
    r.abort();
  });
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  return { ctx, gt, errors };
}
const settle = (p, ms = 4000) => p.waitForTimeout(ms);

{
  const { ctx, gt, errors } = await ctxWith();
  const p = await ctx.newPage(); await p.goto(base); await settle(p);
  ok(await p.evaluate(() => !!window.OSAP_LANG && window.OSAP_LANG.cur() === "en"), "English by default");
  ok(gt.length === 0, "English loads nothing from Google");
  ok(await p.evaluate(() => document.documentElement.getAttribute("translate") !== "no"), "page itself is translatable");
  ok(await p.evaluate(() => document.getElementById("map").getAttribute("translate") === "no"), "map is marked translate=no");
  // Settings (gear) has a Language row that opens the picker
  await p.evaluate(() => document.getElementById("tidy-set").click());
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const b = document.querySelector('#tidy-pop [data-tp="@lang"]'); return !!b && /Language/.test(b.textContent) && /English/.test(b.textContent); }), "Settings shows Language: English");
  await p.evaluate(() => document.querySelector('#tidy-pop [data-tp="@lang"]').click());
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const b = document.querySelector(".olang"); return !!b && !b.hidden && b.querySelectorAll("[data-lang]").length >= 30; }), "picker opens with the language list");
  ok(await p.evaluate(() => document.querySelector('.olang [data-lang="en"]').getAttribute("aria-pressed") === "true"), "English is the pressed choice");
  // pick French
  await p.click('.olang [data-lang="fr"]');
  await p.waitForFunction(() => window.__gtLang === "fr", null, { timeout: 10000 }).catch(() => {});
  ok(gt.length === 1, "picking French loads the translator once");
  ok(await p.evaluate(() => window.__gtLang === "fr"), "translator switched to French");
  ok(await p.evaluate(() => window.__gtOpts && window.__gtOpts.pageLanguage === "en"), "translator told the page is English");
  ok(await p.evaluate(() => localStorage.getItem("osap-lang") === "fr" && /googtrans=\/en\/fr/.test(document.cookie)), "choice kept on this device");
  ok(await p.evaluate(() => document.querySelector(".olang").hidden), "picker closes after a pick");
  ok(await p.evaluate(() => { const g = document.getElementById("google_translate_element"); return !!g && getComputedStyle(g).display === "none"; }), "Google's own control stays hidden");
  // reload: French comes back on its own
  await p.reload(); await settle(p);
  await p.waitForFunction(() => window.__gtLang === "fr", null, { timeout: 10000 }).catch(() => {});
  ok(await p.evaluate(() => window.__gtLang === "fr"), "French comes back after a reload");
  // back to English: storage and cookie cleared, page reloads in English with nothing from Google
  const before = gt.length;
  await Promise.all([p.waitForEvent("load", { timeout: 15000 }).catch(() => {}), p.evaluate(() => window.OSAP_LANG.set("en"))]);
  await settle(p, 3000);
  ok(await p.evaluate(() => !localStorage.getItem("osap-lang") && !/googtrans=\/en\//.test(document.cookie)), "English clears the choice");
  ok(gt.length === before, "English after a reload loads nothing from Google");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  // translator unreachable: message shown, page still in English and usable
  const { ctx, errors } = await ctxWith("blocked");
  const p = await ctx.newPage(); await p.goto(base); await settle(p);
  await p.evaluate(() => window.OSAP_LANG.open());
  await p.click('.olang [data-lang="th"]');
  await p.waitForFunction(() => /could not be reached/.test((document.querySelector(".olang .olmsg") || {}).textContent || ""), null, { timeout: 10000 }).catch(() => {});
  ok(await p.evaluate(() => /could not be reached/.test(document.querySelector(".olang .olmsg").textContent)), "unreachable translator says so");
  ok(await p.evaluate(() => !document.documentElement.classList.contains("translated-ltr")), "page stays as written");
  await p.click(".olang [data-lang-close]");
  ok(await p.evaluate(() => document.querySelector(".olang").hidden), "picker closes");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
