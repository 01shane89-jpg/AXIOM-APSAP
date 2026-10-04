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

  // comms check log updates the board
  await p.click('[data-cpsub="checks"]');
  await p.fill("#cpcl-st", 'Base <b>x</b>'); await p.fill("#cpcl-net", "Team net"); await p.selectOption("#cpcl-r", "weak"); await p.fill("#cpcl-q", "3x2");
  await p.fill("#cpcl-pb", "broken audio"); await p.selectOption("#cpcl-row", "P"); await p.click('[data-cl="add"]');
  let lg = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-cp-checks")));
  ok(lg.length === 1 && lg[0].result === "weak" && lg[0].q === "3x2", "check logged on the device");
  ok(await p.evaluate(() => window.OSAP_COMMSPLAN.state().pace.plans[0].phases[0].rows.P.status === "amber"), "a weak check turns the primary AMBER on the board");
  ok(await p.evaluate(() => !document.querySelector("#cp-pane b b") && /Base <b>x<\/b>/.test(document.querySelector("#cp-pane .cplog").textContent)), "station name shown as text, never as markup");
  await p.fill("#cpcl-st", "Base"); await p.fill("#cpcl-t", "0630"); await p.click('[data-cl="add"]');
  lg = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-cp-checks")));
  ok(lg.length === 2 && new Date(lg.find((x) => x.station === "Base").t).toISOString().slice(11, 16) === "06:30", "a typed Zulu time is used");
  // traffic log with acknowledgements
  await p.click('[data-cpsub="traffic"]');
  await p.fill("#cptl-f", "Team"); await p.fill("#cptl-to", "Base"); await p.selectOption("#cptl-p", "Priority"); await p.fill("#cptl-s", "SITREP 3"); await p.click('[data-tl="add"]');
  ok(/1 awaiting acknowledgement/.test(await pane(p)) && await p.evaluate(() => /1/.test(document.querySelector('[data-cpsub="traffic"]').textContent)), "message awaiting acknowledgement is counted");
  await p.click('[data-tl="ack"]');
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-cp-traffic"))[0].ack === "done") && /0 awaiting/.test(await pane(p)), "Acknowledged clears it");
  // interference reports: grouped, drawn, never attributed
  await p.click('[data-cpsub="intf"]');
  await p.fill("#cpif-n", "steady carrier"); await p.click('[data-if="add"]'); await p.click('[data-if="add"]');
  const it = await pane(p);
  ok(/1 other within 10 km and 24 h, same band/.test(it), "two reports near each other are grouped");
  ok(/does not listen, locate or attribute/.test(it), "says it does not locate or attribute a source");
  ok(await p.evaluate(() => Object.values(window.__asapMap._layers).filter((l) => l.options && l.options.fillColor === "#d9480f").length === 2), "reports drawn on the map");
  await tab(p, "plan");
  ok(await p.evaluate(() => Object.values(window.__asapMap._layers).filter((l) => l.options && l.options.fillColor === "#d9480f").length === 0), "leaving Status takes the reports off the map");
  await tab(p, "status");
  // troubleshooting walk-through
  await p.click('[data-cpsub="fix"]');
  await p.click('[data-fx="ok"]'); await p.click('[data-fx="bad"]');
  for (let i = 0; i < 6; i++) await p.click('[data-fx="skip"]');
  ok(/Look first at:\s*Antenna/.test(await pane(p)) && /do not prove the cause/.test(await pane(p)), "troubleshooting points to the antenna without claiming a cause");
  await p.fill("#cpfx-n", "replaced whip antenna"); await p.click('[data-fx="log"]');
  lg = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-cp-checks")));
  ok(lg.some((x) => x.station === "Troubleshooting" && /Antenna/.test(x.problem) && x.action === "replaced whip antenna"), "the outcome goes into the check log");
  await p.click('[data-cpsub="board"]');

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

  // equipment sub-views
  const esub = (s) => p.click('[data-cpesub="' + s + '"]');
  await esub("loadout");
  await p.click('[data-loa="add"]'); await p.click('[data-loa="add"]');
  await p.fill('[data-lo="0"][data-cpk="name"]', "<b>PRC set</b>"); await p.fill('[data-lo="0"][data-cpk="qty"]', "2"); await p.fill('[data-lo="0"][data-cpk="kg"]', "4.5"); await p.fill('[data-lo="0"][data-cpk="who"]', "RTO");
  await p.selectOption('[data-lo="1"][data-cpk="cat"]', "Antenna"); await p.fill('[data-lo="1"][data-cpk="kg"]', "1");
  let lt2 = await p.textContent("#cp-loout");
  ok(/Total\s*10(\.0)? kg/.test(lt2) && /RTO\s*9(\.0)? kg/.test(lt2) && /Not assigned\s*1(\.0)? kg/.test(lt2), "loadout: totals by type and by carrier");
  await p.click('[data-loa="bats"]');
  const bm = await p.evaluate(() => window.OSAP_RADIO.powerPlan(window.OSAP_COMMSPLAN.state().power).batteries_mission);
  ok(await p.evaluate((bm) => { const v = JSON.parse(localStorage.getItem("osap-cp-loadout")); const x = v.items[v.items.length - 1]; return x.cat === "Battery" && x.qty === bm; }, bm), "loadout: batteries added from the power plan (" + bm + ")");
  ok(await p.evaluate(() => !document.querySelector("#cp-pane b") || ![...document.querySelectorAll("#cp-pane b")].some((b) => b.textContent === "PRC set")), "loadout: item names are escaped");

  await esub("cable");
  await p.selectOption('[data-cb="cable"]', "lmr400"); await p.fill('[data-cb="f_mhz"]', "450"); await p.fill('[data-cb="len_m"]', "20"); await p.fill('[data-cb="connectors"]', "2"); await p.fill('[data-cb="conn_db"]', "0.15");
  const ct = await p.textContent("#cp-cbout");
  ok(/8\.9 dB per 100 m/.test(ct) && /Total loss\s*2\.08 dB/.test(ct), "cable: LMR-400 20 m at 450 MHz with 2 connectors = 2.08 dB");
  await p.click('[data-cb="use"]');
  ok(await p.evaluate(() => document.querySelector('.cptabs [data-cptab="link"]').getAttribute("aria-selected") === "true") && (await p.inputValue('[data-cpl="ltx_db"]')) === "2.08" && (await p.inputValue('[data-cpl="f_mhz"]')) === "450", "cable: 'Use these in the Link tab' fills the link loss and frequency");
  await tab(p, "equipment");

  await esub("antennas");
  await p.fill("#cpant-f", "150");
  ok(/Quarter-wave whip\s*0\.47 m/.test(await p.textContent("#cp-antout")) && (await p.evaluate(() => document.querySelectorAll(".cpant").length)) >= 8, "antennas: quarter wave at 150 MHz is 0.47 m and reference cards show");

  await esub("connectors");
  await p.selectOption("#cpcn-a", "bnc"); await p.selectOption("#cpcn-b", "n");
  ok(/Needs:/.test(await p.textContent("#cp-cnout")), "connectors: BNC to N needs an adapter");
  await p.selectOption("#cpcn-b", "bnc"); await p.selectOption("#cpcn-bg", "m");
  ok(/Direct fit/.test(await p.textContent("#cp-cnout")), "connectors: female BNC to male BNC fits directly");

  await esub("spectrum");
  ok(/ITU Region 3/.test(await pane(p)), "spectrum: Thailand is ITU Region 3");
  await p.fill("#cpsp-f", "121.5");
  ok(await p.evaluate(() => !!document.querySelector("#cp-spout .cpbad")), "spectrum: 121.5 MHz is flagged as distress");
  await p.fill("#cpch-n", "Guard"); await p.fill("#cpch-f", "121.5"); await p.click('[data-ch="add"]');
  await p.fill("#cpch-n", "Net 1"); await p.fill("#cpch-f", "45.3"); await p.click('[data-ch="add"]');
  const chs = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-cp-chan")).map((c) => c.f));
  ok(chs.join(",") === "45.3,121.5" && /Distress, emergency or navigation frequency/.test(await pane(p)), "spectrum: channel plan sorted and a distress entry is warned");

  await esub("comsec");
  await p.fill("#cpcs-st", "a3f9c1d2e4b5a6978c0d1e2f"); await p.click('[data-cs="add"]');
  ok(/Refused/.test(await p.textContent("#cp-msg")) && !(await p.evaluate(() => localStorage.getItem("osap-cp-comsec"))), "COMSEC: key-like entry is refused and not stored");
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  for (const [st, ex] of [["KL-OLD", day(-3)], ["KL-SOON", day(3)], ["KL-NEW", day(40)]]) { await p.fill("#cpcs-st", st); await p.fill("#cpcs-ex", ex); await p.click('[data-cs="add"]'); }
  const cs = await pane(p);
  ok(/EXPIRED/.test(cs) && /EXPIRES SOON/.test(cs) && /CURRENT/.test(cs), "COMSEC: expiry badges");
  await p.selectOption('[data-csst]', "Destroyed");
  ok(/CLOSED/.test(await pane(p)), "COMSEC: a destroyed item shows closed");
  const wsSrc = await p.evaluate(() => fetch("assets/osap-ws.js").then((r) => r.text()));
  ok(["osap-cp-loadout", "osap-cp-chan", "osap-cp-comsec"].every((k) => wsSrc.includes('"' + k + '"')), "equipment records are kept per workspace");
  if (OUT) await p.screenshot({ path: OUT + "/commsplan-comsec.png" });
  await esub("power");

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
    if (t === "equipment") for (const s of ["loadout", "cable", "antennas", "connectors", "spectrum", "comsec"]) { await p.click('[data-cpesub="' + s + '"]'); await p.waitForTimeout(100); ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "phone equipment " + s + ": no sideways scroll"); }
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
