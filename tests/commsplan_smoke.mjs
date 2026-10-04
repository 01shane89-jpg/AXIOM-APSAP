// Headless check of Comms planning (assets/osap-commsplan.js with assets/comms/radio-lib.js): the Comms view opens as six tabs,
// a PACE plan is made, filled, kept and found by area, the status board records a RED net and points to the plan's next
// method, the link calculator labels its answer as modelled, the power planner reacts to devices and cold, the Networks tab
// shows the IODA outage feed as reported, user text is escaped, the last tab is remembered, and the phone layout fits.
// Run from the repo root: node tests/commsplan_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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

async function open(opts, ctx0) {
  const ctx = ctx0 || await browser.newContext({ serviceWorkers: "block", ...opts });
  if (!ctx0) {
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/\/data\/comms\/masts\//, (r) => r.fulfill({ status: 404, body: "" }));
    await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  }
  const errors = [];
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#view-seg [data-view="comms"]').click());
  await p.waitForFunction(() => window.OSAP_COMMSPLAN && document.querySelector(".cptabs") && document.querySelector("#com-tg input"), null, { timeout: 20000 });
  return { ctx, p, errors };
}
const tab = (p, t) => p.click('.cptabs [data-cptab="' + t + '"]');
const pane = (p) => p.textContent("#cp-pane");

// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  const tabs = await p.evaluate(() => [...document.querySelectorAll(".cptabs [data-cptab]")].map((b) => b.textContent));
  ok(tabs.join(",") === "Plan,Coverage,Link,Networks,Equipment,Status", "six tabs: " + tabs.join(", "));
  ok(await p.evaluate(() => document.querySelector('.cptabs [data-cptab="coverage"]').getAttribute("aria-selected") === "true" && document.querySelector(".combtns").getClientRects().length > 0), "opens on Coverage with the phone signal check");
  ok(await p.evaluate(() => /Comms planning/.test(document.querySelector('#view-seg [data-view="comms"]').textContent + document.querySelector('#view-seg [data-view="comms"]').title)), "the view is called Comms planning");

  // PACE plan
  await tab(p, "plan");
  ok(/Build a Primary, Alternate, Contingency and Emergency/.test(await pane(p)), "Plan tab explains PACE before the first plan");
  await p.click('[data-cpa="new"]');
  ok(await p.evaluate(() => document.querySelectorAll("fieldset.cpp").length === 12 && document.querySelectorAll("details.cpph").length === 3), "new plan: three phases, four PACE rows each");
  await p.fill('[data-cpf="name"]', 'Op <img src=x onerror="window.__xss=1"> plan');
  await p.fill('[data-cpf="mission"]', "Recce north valley");
  const ph = await p.evaluate(() => document.querySelector("details.cpph [data-cpph]").getAttribute("data-cpph"));
  await p.selectOption(`[data-cpp="${ph}"][data-cpr="P"][data-cpk="method"]`, "VHF radio");
  await p.fill(`[data-cpp="${ph}"][data-cpr="P"][data-cpk="device"]`, "Team radio 1");
  await p.selectOption(`[data-cpp="${ph}"][data-cpr="P"][data-cpk="cov"]`, "likely");
  await p.selectOption(`[data-cpp="${ph}"][data-cpr="P"][data-cpk="cov_src"]`, "modelled");
  await p.fill(`[data-cpp="${ph}"][data-cpr="P"][data-cpk="trigger"]`, "two missed checks");
  await p.fill(`[data-cpp="${ph}"][data-cpr="P"][data-cpk="action"]`, "go to SATCOM next window");
  await p.selectOption(`[data-cpp="${ph}"][data-cpr="A"][data-cpk="method"]`, "SATCOM (data)");
  await p.click('[data-cpa="here"]');
  let st = await p.evaluate(() => window.OSAP_COMMSPLAN.state().pace);
  const pl = st.plans[0], r = pl.phases[0].rows;
  ok(st.plans.length === 1 && pl.mission === "Recce north valley" && r.P.method === "VHF radio" && r.P.device === "Team radio 1" && r.P.cov === "likely" && r.P.cov_src === "modelled" && r.A.method === "SATCOM (data)", "plan fields saved to the device");
  ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem("osap-cp-pace")).plans[0].area), "Use map centre sets the plan area");
  ok(await p.evaluate(() => !window.__xss && !document.querySelector("#cp-pane img")), "plan name is escaped, never run");
  const c = await p.evaluate(() => window.__asapMap.getCenter());
  ok(await p.evaluate((c) => window.OSAP_COMMSPLAN.paceFor({ lat: c.lat, lon: c.lng }).length === 1 && window.OSAP_COMMSPLAN.paceFor({ lat: c.lat + 5, lon: c.lng }).length === 0, c), "paceFor finds the plan at its area and not 500 km away");
  await p.evaluate(() => { const r = window.OSAP_COMMSPLAN.paceFor({ lat: window.__asapMap.getCenter().lat, lon: window.__asapMap.getCenter().lng })[0]; r.name = "changed"; });
  ok((await p.evaluate(() => window.OSAP_COMMSPLAN.state().pace.plans[0].name)) !== "changed", "paceFor hands out copies, not the stored plan");
  await p.click('[data-cpa="copy"]');
  ok((await p.evaluate(() => window.OSAP_COMMSPLAN.state().pace.plans.length)) === 2, "Copy makes a second plan");
  await p.click('[data-cpa="del"]');
  ok((await p.evaluate(() => window.OSAP_COMMSPLAN.state().pace.plans.length)) === 1, "Delete removes it after confirming");
  await p.click('[data-cpa="addph"]');
  ok(await p.evaluate(() => document.querySelectorAll("details.cpph").length === 4), "Add a phase");
  if (OUT) await p.screenshot({ path: OUT + "/commsplan-plan.png" });

  // status board
  await tab(p, "status");
  ok(/VHF radio/.test(await pane(p)) && /UNKNOWN/.test(await pane(p)), "status board lists the plan's nets, unknown until recorded");
  await p.click('[data-cpst="red"][data-cpr="P"]');
  const sp = await pane(p);
  ok(/Primary is RED/.test(sp) && /two missed checks/.test(sp) && /go to SATCOM next window/.test(sp) && /Next in the plan: Alternate \(SATCOM \(data\)\)/.test(sp), "RED primary: shows the plan's trigger, action and the Alternate");
  ok(await p.evaluate(() => { const r = window.OSAP_COMMSPLAN.state().pace.plans[0].phases[0].rows.P; return r.status === "red" && r.checked > 0; }), "status and check time are kept");
  ok(/does not test any network/.test(sp), "says OSAP does not test the network");
  if (OUT) await p.screenshot({ path: OUT + "/commsplan-status.png" });

  // link
  await tab(p, "link");
  let lt = await pane(p);
  ok(/MODELLED: free space/.test(lt) && /MARGIN MET/.test(lt) && /1st Fresnel zone/.test(lt), "link: modelled answer with margin and Fresnel zone");
  await p.fill('[data-cpl="d_km"]', "100");
  lt = await pane(p);
  ok(/beyond it/.test(lt), "link: 100 km with 2 m antennas is past the radio horizon");
  await p.selectOption('[data-cpl="band"]', "hf");
  ok(/Sky-wave .* not modelled/.test(await pane(p)) && (await p.inputValue('[data-cpl="f_mhz"]')) === "8", "HF band: frequency set and sky-wave limit stated");

  // power
  await tab(p, "equipment");
  const n0 = await p.evaluate(() => document.querySelectorAll(".cpdv").length);
  const b0 = await p.evaluate(() => window.OSAP_RADIO.powerPlan(window.OSAP_COMMSPLAN.state().power).batteries_mission);
  await p.selectOption('[data-cpa="adddev"]', "laptop");
  ok((await p.evaluate(() => document.querySelectorAll(".cpdv").length)) === n0 + 1, "add a device");
  await p.fill('[data-cpw="temp_c"]', "-20");
  const b1 = await p.evaluate(() => window.OSAP_RADIO.powerPlan(window.OSAP_COMMSPLAN.state().power).batteries_mission);
  ok(b1 > b0 && new RegExp("Batteries for the mission\\s*" + b1 + "\\b").test(await pane(p)) && /cold: about 55% of rated/.test(await pane(p)), "laptop and cold raise the batteries needed (" + b0 + " to " + b1 + ")");
  ok(/Planning estimate/.test(await pane(p)), "power plan is labelled a planning estimate");
  if (OUT) await p.screenshot({ path: OUT + "/commsplan-power.png" });

  // networks
  await tab(p, "networks");
  const nt = await pane(p);
  ok(/Internet outages/.test(nt) && /REPORTED/.test(nt) && /IODA/.test(nt), "Networks: internet outages shown as a reported source");
  ok(await p.evaluate(() => document.querySelector("#com-ops").getClientRects().length > 0 && document.querySelector("#com-tg").getClientRects().length > 0), "Networks: mast and provider switches are here");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));

  // last tab remembered
  const again = await open(null, ctx);
  ok(await again.p.evaluate(() => document.querySelector('.cptabs [data-cptab="networks"]').getAttribute("aria-selected") === "true"), "the last tab is remembered");
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => document.documentElement.setAttribute("data-sheet", "full")); await p.waitForTimeout(400);
  for (const t of ["plan", "equipment", "link", "status"]) {
    await p.evaluate((t) => window.OSAP_COMMSPLAN.tab(t), t);
    if (t === "plan") await p.evaluate(() => { const b = document.querySelector('[data-cpa="new"]'); if (b) b.click(); });
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "phone " + t + ": no sideways scroll");
  }
  const h = await p.evaluate(() => Math.min(...[...document.querySelectorAll(".cptabs button")].map((b) => b.getBoundingClientRect().height)));
  ok(h >= 40, "phone: tabs are tappable (" + h + " px)");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('[data-cpw="temp_c"]') || document.querySelector(".cp input")).fontSize === "16px"), "phone: inputs are 16 px so iOS does not zoom");
  if (OUT) await p.screenshot({ path: OUT + "/commsplan-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
