// Headless check of the one search box that finds everything (assets/osap-findall.js on top of Search, assets/osap-search.js):
// "/" and Ctrl/Cmd+K open it; countries by name and by code switch the country; tools open as their toolbar button does
// ("hospital" finds Med plan); a data set goes on the map; settings toggle ("night" finds Dark map, miles, grid format);
// arrow keys and Enter pick, Esc closes; the last row searches the news on Today, whose box lists the same matches;
// on a stand-in for the Netlify site's plan API (a Free account) a locked tool or data set opens Plan and sign-in instead;
// at phone width the list fits the screen with tap targets of at least 44 px.
// Run from the repo root: node tests/search_all_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { rulesForPage } from "../tools/tiers.mjs";
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
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
const rows = (p) => p.evaluate(() => [...document.querySelectorAll("#srch-list [data-i]")].map((li) => ({ g: li.getAttribute("data-g") || "place", t: li.querySelector("b").textContent, s: (li.querySelector("span") || {}).textContent || "", sel: li.getAttribute("aria-selected") === "true" })));
const heads = (p) => p.evaluate(() => [...document.querySelectorAll("#srch-list .srch-h")].map((h) => h.textContent));
const PHOTON = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [100.5018, 13.7563] }, properties: { name: "Bangkok", osm_value: "city", type: "city", country: "Thailand" } }] };
const ACCOUNT = { gate: true, signedIn: true, uid: "u1", email: "free@test", tier: "free", owner: false, beta: null, rules: rulesForPage(), paddle: null };

async function open(opts, { gated = false, home = "map" } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], hits = { photon: 0, search: 0 };
  await ctx.route(/^https:\/\/photon\.komoot\.io\//, (r) => { hits.photon++; r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(/Bangkok/i.test(r.request().url()) ? PHOTON : { features: [] }) }); });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|photon\.komoot\.io)/, (r) => r.abort());
  // the plan API the Netlify site answers (netlify/functions/osap-account.mjs), here a signed-in Free account
  if (gated) await ctx.route(/\/api\/osap-account/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ACCOUNT) }));
  await ctx.addInitScript((h) => { try { if (!sessionStorage.getItem("t-init")) { sessionStorage.setItem("t-init", "1"); localStorage.setItem("osap-home", h); } } catch (e) {} }, home);
  const p = await ctx.newPage(); p.on("pageerror", (e) => { errors.push(e.message); if (process.env.DEBUG) console.log(e.stack); }); p.on("dialog", (d) => d.accept());
  p.on("request", (r) => { if (/osap-search\.js/.test(r.url())) hits.search++; });
  await p.goto(base, { waitUntil: "domcontentloaded" }); await ready(p);
  if (home === "map") { await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); }); await p.waitForTimeout(300); }
  return { ctx, p, errors, hits };
}
async function ready(p) { await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_FINDALL, null, { timeout: 60000 }); await p.waitForTimeout(3500); }
async function openBox(p) { await p.evaluate(() => { if (!(window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen())) window.OSAP_ATAK.search(); }); await p.waitForFunction(() => window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen(), null, { timeout: 10000 }); await p.waitForTimeout(150); }
async function type(p, text) { await openBox(p); await p.fill("#srch-q", ""); await p.type("#srch-q", text, { delay: 15 }); await p.waitForTimeout(150); }

// ---------- desktop ----------
{
  const { ctx, p, errors, hits } = await open({ viewport: { width: 1400, height: 900 } });
  ok(hits.search === 0, "desktop: Search itself still loads only when first used");
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press("/");
  await p.waitForFunction(() => window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen(), null, { timeout: 10000 }).catch(() => {});
  ok(await shown(p, "#srch") && await p.evaluate(() => document.activeElement && document.activeElement.id === "srch-q"), "desktop: / opens the search box with the cursor in it");
  await p.keyboard.press("Escape"); ok(!(await shown(p, "#srch")), "desktop: Esc closes it");
  await p.keyboard.press("Control+k"); await p.waitForFunction(() => document.activeElement && document.activeElement.id === "srch-q", null, { timeout: 3000 }).catch(() => {});
  ok(await shown(p, "#srch") && await p.evaluate(() => document.activeElement && document.activeElement.id === "srch-q"), "desktop: Ctrl+K opens it too");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Meta+k"); ok(await shown(p, "#srch"), "desktop: Cmd+K opens it too"); await p.keyboard.press("Escape");
  // "/" typed into a text box is a character, not the shortcut
  await p.evaluate(() => { const i = document.createElement("input"); i.id = "t-in"; i.style.cssText = "position:fixed;top:0;left:0;z-index:99999"; document.body.appendChild(i); });
  await p.focus("#t-in"); await p.keyboard.press("/");
  ok(!(await shown(p, "#srch")) && (await p.inputValue("#t-in")) === "/", "desktop: / typed in a text box stays a character");
  await p.evaluate(() => document.getElementById("t-in").remove());

  // tools, from the toolbar itself
  await type(p, "hospital");
  let R = await rows(p);
  ok(R[0] && R[0].g === "tool" && R[0].t === "Med plan" && R[0].sel, "desktop: hospital finds Med plan first " + JSON.stringify(R.slice(0, 3)));
  ok((await heads(p))[0] === "Tools", "desktop: results are grouped under headings " + JSON.stringify(await heads(p)));
  ok(R.length && R[R.length - 1].g === "news" && /Search the news for "hospital"/.test(R[R.length - 1].t), "desktop: the last row searches the news");
  if (OUT) await p.screenshot({ path: OUT + "/desktop-findall.png" });
  await p.keyboard.press("Enter"); await p.waitForTimeout(800);
  ok(!(await shown(p, "#srch")) && await shown(p, "#medplan"), "desktop: Enter opens the medical plan, as its toolbar button does");
  await p.evaluate(() => window.OSAP_MEDPLAN && window.OSAP_MEDPLAN.close()); await p.waitForTimeout(300);
  const toolNames = await p.evaluate(() => [...document.querySelectorAll("#atk-tools .atk-list > button:not([hidden])")].map((b) => b.getAttribute("aria-label")).filter((n) => n && n !== "Search"));
  const found = await p.evaluate((ns) => ns.filter((n) => window.OSAP_FINDALL.match(n).some((x) => x.name === n && x.grp === "Tools")), toolNames);
  ok(toolNames.length >= 15 && found.length === toolNames.length, "desktop: every toolbar tool can be found by its name (" + found.length + "/" + toolNames.length + ")");
  const syn = await p.evaluate(() => { const f = (q) => (window.OSAP_FINDALL.match(q)[0] || {}).name; return { evacuation: f("evacuation"), lz: f("lz finder"), sat: f("satellite before"), coord: f("coordinates"), night: f("night"), photo: f("photo check") }; });
  ok(syn.evacuation === "Evac" && /LZ finder/.test(syn.lz) && /Satellite before/.test(syn.sat) && syn.coord === "Grid format: MGRS" && syn.night === "Dark map" && syn.photo === "Photo check", "desktop: common words find their tool or setting " + JSON.stringify(syn));
  // arrow keys
  await type(p, "evac");
  await p.keyboard.press("ArrowDown"); R = await rows(p);
  ok(R[1] && R[1].sel && !R[0].sel, "desktop: the arrow keys move through the results");
  await p.keyboard.press("ArrowUp"); R = await rows(p); ok(R[0].sel, "desktop: and back");
  await p.keyboard.press("Escape");
  // an area tool goes through the Area menu, which asks for a shape first
  await type(p, "lz finder"); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  ok(await shown(p, "#atk-pop") && /Lasso/.test(await p.textContent("#atk-pop")), "desktop: LZ finder asks for the area to search, as Area > Landing zones does");
  await p.evaluate(() => document.body.click()); await p.keyboard.press("Escape");

  // settings
  await type(p, "night"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-map")) === "dark", "desktop: night > Dark map turns the dark map on");
  await type(p, "miles"); R = await rows(p);
  ok(R[0] && R[0].t === "Distance in miles", "desktop: miles finds the distance unit " + JSON.stringify(R.slice(0, 2)));
  await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.OSAP_MEASURE.prefs().unit) === "mi", "desktop: and sets miles");
  await type(p, "coordinates");
  const ll = await p.evaluate(() => [...document.querySelectorAll("#srch-list [data-i]")].findIndex((li) => /Lat-long/.test(li.textContent)));
  ok(ll >= 0, "desktop: coordinates lists the grid formats");
  await p.click(`#srch-list [data-i="${ll}"]`); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.OSAP_ATAK.posFmt()) === "dd", "desktop: tapping Grid format: Lat-long switches the grid readout");
  await p.evaluate(() => { window.OSAP_ATAK.posFmt("mgrs"); window.OSAP_MEASURE.prefs({ unit: "km", fmt: "mgrs" }); });
  await type(p, "user guide"); await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  ok(await p.evaluate(() => { const g = document.querySelector("#osap-guide,#guide,[id*=guide][role=dialog]"); return !!g && !g.hidden && g.getClientRects().length > 0; }), "desktop: User guide opens the guide");
  await p.keyboard.press("Escape"); await p.evaluate(() => window.OSAP_GUIDE && window.OSAP_GUIDE.close && window.OSAP_GUIDE.close()); await p.waitForTimeout(200);

  // data sets
  ok(!(await p.evaluate(() => window.OSAP_DATASETS.list().find((x) => x.id === "health").on)), "desktop: Public health starts off the map");
  await type(p, "public health"); R = await rows(p);
  ok(R[0] && R[0].g === "set" && R[0].t === "Public health", "desktop: public health finds the data set " + JSON.stringify(R.slice(0, 2)));
  await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.OSAP_DATASETS.list().find((x) => x.id === "health").on), "desktop: picking it puts it on the map");
  ok((await p.evaluate(() => window.OSAP_FINDALL.match("conflict").filter((x) => x.grp === "Data sets").length)) >= 1, "desktop: conflict finds the conflict tabs");

  // negatives: a place name lists only places (and the news row); nonsense lists nothing extra
  await type(p, "Bangkok"); await p.waitForTimeout(800); R = await rows(p);
  ok(R.length === 2 && R[0].g === "place" && R[0].t === "Bangkok" && R[1].g === "news", "desktop: a place lists the place and the news row only " + JSON.stringify(R.map((r) => r.g)));
  ok(!(await heads(p)).includes("Tools"), "desktop: no tools heading for a place");
  ok((await p.evaluate(() => window.OSAP_FINDALL.match("zzqx").length)) === 0 && (await p.evaluate(() => window.OSAP_FINDALL.match("qj").length)) === 0, "desktop: nonsense matches nothing");
  await p.keyboard.press("Escape");

  // the news row: Today, with the words searched
  await type(p, "flood");
  const nr = await p.evaluate(() => document.querySelector('#srch-list [data-g="news"]').getAttribute("data-i"));
  await p.click(`#srch-list [data-i="${nr}"]`); await p.waitForTimeout(800);
  ok(await p.evaluate(() => window.OSAP_TODAY.isOpen()) && (await p.inputValue("#nq-q")) === "flood", "desktop: the news row opens Today and searches the news for the words");
  // on Today, the shortcut goes to the news box, which lists the same matches
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press("/");
  ok(await p.evaluate(() => document.activeElement && document.activeElement.id === "nq-q"), "desktop: on Today, / goes to the news box");
  await p.fill("#nq-q", ""); await p.type("#nq-q", "estonia", { delay: 10 }); await p.waitForTimeout(200);
  ok(await shown(p, "#td-news .fa-hints") && /Estonia/.test(await p.textContent("#td-news .fa-hints")), "desktop: the news box lists Estonia to go to");
  await p.fill("#nq-q", "earthquake"); await p.waitForTimeout(100);
  await p.click("#td-news .fa-hints [data-fa]"); await p.waitForTimeout(500);
  ok(!(await p.evaluate(() => window.OSAP_TODAY.isOpen())) && await p.evaluate(() => window.OSAP_DATASETS.list().find((x) => x.id === "hazards").on), "desktop: a data set picked there leaves Today and goes on the map");

  // countries: by name, then by code
  await type(p, "Estonia"); R = await rows(p);
  ok(R[0] && R[0].g === "country" && R[0].t === "Estonia", "desktop: Estonia finds the country " + JSON.stringify(R.slice(0, 2)));
  await Promise.all([p.waitForEvent("load", { timeout: 30000 }).catch(() => {}), p.keyboard.press("Enter")]);
  await ready(p);
  ok(await p.evaluate(() => window.TSAP.country) === "ee", "desktop: Enter switches the country to Estonia (" + await p.evaluate(() => window.TSAP.country) + ")");
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
  await type(p, "fi"); R = await rows(p);
  ok(R[0] && R[0].t === "Finland" && !R.some((r) => r.g === "tool" || r.g === "area"), "desktop: the code fi finds Finland first, and no tool whose inner word starts fi " + JSON.stringify(R.slice(0, 3)));
  await Promise.all([p.waitForEvent("load", { timeout: 30000 }).catch(() => {}), p.keyboard.press("Enter")]);
  await ready(p);
  ok(await p.evaluate(() => window.TSAP.country) === "fi", "desktop: and switches to it");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.tap('#atk-tools [data-atk="search"]'); await p.waitForFunction(() => window.OSAP_SEARCH && window.OSAP_SEARCH.isOpen(), null, { timeout: 10000 });
  await p.waitForTimeout(150); await p.type("#srch-q", "evac", { delay: 15 }); await p.waitForTimeout(300);
  const lay = await p.evaluate(() => {
    const s = document.getElementById("srch"), r = s.getBoundingClientRect(), t = document.getElementById("atk-tools").getBoundingClientRect();
    const lis = [...document.querySelectorAll("#srch-list [data-i]")];
    return { n: lis.length, minH: Math.min(...lis.map((li) => li.getBoundingClientRect().height)), over: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth, left: r.left, right: r.right, tl: t.left,
      cut: lis.some((li) => li.querySelector("b").scrollWidth > li.querySelector("b").clientWidth + 1) };
  });
  ok(lay.n >= 2 && lay.minH >= 44, "phone: results are tap-sized (" + lay.n + " rows, smallest " + lay.minH + " px)");
  ok(lay.over <= 0 && lay.page <= 390 && lay.left >= 0 && lay.right <= lay.tl, "phone: the list fits the screen beside the toolbar " + JSON.stringify(lay));
  ok(!lay.cut, "phone: result names are not cut off");
  if (OUT) await p.screenshot({ path: OUT + "/phone-findall.png" });
  await p.tap('#srch-list [data-i="0"]'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => { const e = document.getElementById("epe"); return !!e && !e.hidden; }), "phone: tapping Evac opens the evacuation planner");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- a Free plan on the Netlify site (stand-in plan API): locks ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, { gated: true });
  ok(await p.evaluate(() => window.OSAP_TIER.on() && window.OSAP_TIER.tier() === "free"), "plan: the stand-in plan API gives a Free account");
  await type(p, "hospital"); let R = await rows(p);
  ok(R[0] && R[0].t === "Med plan" && /Needs the Mid plan/.test(R[0].s), "plan: a locked tool says which plan it needs " + JSON.stringify(R[0]));
  await p.keyboard.press("Enter"); await p.waitForTimeout(600);
  ok(await shown(p, "#tierdlg") && !(await shown(p, "#medplan")), "plan: picking a locked tool opens Plan and sign-in, not the tool");
  await p.evaluate(() => { const b = document.querySelector('#tierdlg [data-tr="close"],#tierdlg .trx,#tierdlg button[aria-label="Close"]'); if (b) b.click(); else document.getElementById("tierdlg").hidden = true; }); await p.waitForTimeout(200);
  await type(p, "public health"); R = await rows(p);
  ok(R[0] && R[0].t === "Public health" && /Needs the Mid plan/.test(R[0].s), "plan: a locked data set says so");
  await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  ok(await shown(p, "#tierdlg") && !(await p.evaluate(() => window.OSAP_DATASETS.list().find((x) => x.id === "health").on)), "plan: picking a locked data set opens the plans and leaves it off");
  await p.evaluate(() => { document.getElementById("tierdlg").hidden = true; });
  await type(p, "measure"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.getElementById("meas-btn").getAttribute("aria-pressed") === "true") && !(await shown(p, "#tierdlg")), "plan: a Free tool (Measure) still opens");
  await p.evaluate(() => document.getElementById("meas-btn").click());
  await type(p, "sign in"); R = await rows(p);
  ok(R.some((r) => r.t === "Plan and sign-in"), "plan: Plan and sign-in is a setting to find");
  ok(errors.length === 0, "plan: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
