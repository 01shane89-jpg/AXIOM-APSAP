// Headless check of the sea transit medical assessment (Shane 2026-10-05: "We need to be able to do this", with a maritime
// medevac assessment from Manila to Colombo). Opens the screen from the Reports menu, loads the example corridor and works
// it out against the repo's own data (ports, airfields, sourced hospitals, stored OpenStreetMap hospitals, rescue contacts,
// coastline outlines); every outside request is refused. Checks the segments, distances, remote stretches, rescue leads and
// the printed assessment, that the Med plan's at-sea section links to it, and that nothing outside the repo is fetched.
// Run from the repo root: node tests/seatransit_smoke.mjs   (needs the playwright package and Chromium)
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
const errors = [], outside = [];
// the marine forecast for the corridor points (several latitudes in one call): 3 m seas, 20 kn wind, 25 kn gusts
const wxCalls = [];
function series(n, keys) {
  const t0 = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const time = Array.from({ length: 192 }, (_, i) => new Date(t0 + i * 3600000).toISOString().slice(0, 16));
  return Array.from({ length: n }, () => ({ hourly: Object.assign({ time }, ...Object.entries(keys).map(([k, v]) => ({ [k]: time.map(() => v) }))) }));
}
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { const u = r.request().url(); if (/latitude=[^&]*,/.test(u) && /marine-api\.open-meteo\.com|api\.open-meteo\.com\/v1\/forecast/.test(u)) { wxCalls.push(u); const n = new URL(u).searchParams.get("latitude").split(",").length;
    return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(/marine/.test(u) ? series(n, { wave_height: 3.0, swell_wave_height: 1.5, wave_period: 8 }) : series(n, { wind_speed_10m: 20, wind_gusts_10m: 25, visibility: 24000 })) }); } if (!/tile|basemap|openfreemap|arcgisonline|cartocdn|fonts/.test(u)) outside.push(u); return r.abort(); });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap.split", "0"); } catch (e) {} });
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_REPORTS && window.OSAP_SEATRANSIT && window.OSAP_SEA, null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });

const rep = await p.evaluate(() => window.OSAP_REPORTS.list().find((r) => r.id === "seatransit"));
ok(rep && rep.ready, "the Reports menu lists the sea transit assessment, ready to open");
await p.evaluate(() => window.OSAP_REPORTS.run("seatransit"));
ok(await p.evaluate(() => { const e = document.getElementById("seatr"); return !!e && !e.hidden && /Sea transit medical assessment/.test(e.textContent); }), "Reports opens the sea transit screen");
ok(await p.evaluate(() => document.querySelector('#seatr [data-st="run"]').disabled), "with no corridor, Work out is disabled");
await p.click('#seatr [data-st="example"]');
const n = await p.evaluate(() => window.OSAP_SEATRANSIT.state().plan.wps.length);
ok(n === 9, `the example corridor has 9 waypoints (${n})`);
ok(await p.evaluate(() => (() => { const v = [...document.querySelectorAll("#seatr [data-st-wpn]")].map((i) => i.value); return v[0] === "Manila Bay" && v[8] === "Colombo"; })()), "the waypoint table shows Manila Bay to Colombo");
// typed waypoint
await p.fill("#st-grid", "6.95, 79.70"); await p.fill("#st-name", "Typed test"); await p.click('#st-add button[type="submit"]');
ok(await p.evaluate(() => { const w = window.OSAP_SEATRANSIT.state().plan.wps; return w.length === 10 && w[9].n === "Typed test"; }), "a typed grid adds a named waypoint");
await p.click('#seatr [data-st-del="9"]');
ok(await p.evaluate(() => window.OSAP_SEATRANSIT.state().plan.wps.length === 9), "Remove takes it out again");
// departure time
await p.fill("#seatr [data-st-dep]", "2026-10-06T00:00"); await p.dispatchEvent("#seatr [data-st-dep]", "change");
await p.click('#seatr [data-st="run"]');
await p.waitForFunction(() => { const s = window.OSAP_SEATRANSIT.state(); return !s.busy && (s.res || /failed/.test(document.getElementById("st-msg").textContent)); }, null, { timeout: 90000 });
const r = await p.evaluate(() => {
  const s = window.OSAP_SEATRANSIT.state(), res = s.res; if (!res) return { msg: document.getElementById("st-msg").textContent };
  const t = document.getElementById("seatr").textContent;
  return { segs: res.segs.length, tot: res.segs.reduce((a, x) => a + x.nm, 0), remote: res.rows.filter((x) => x.remote).length, rows: res.rows.length,
    rcc: res.rcc.map((c) => c.id), counts: res.counts, errs: res.errs, ports: res.nodes.filter((x) => x.node.kind === "port").length,
    hosp: res.nodes.filter((x) => x.node.kind === "hosp").length, af: res.nodes.filter((x) => x.node.kind === "af").length,
    eta: !!res.rows[res.rows.length - 1].eta, coastRead: res.rows.filter((x) => x.coast).length,
    sections: ["2. Key judgments", "3. Segments", "4. Distance table", "5. Receiving hospitals", "6. Rescue coordination", "12."].filter((h) => t.includes(h)).length,
    covered: /\bcovered\b/i.test(t.replace(/never called covered|no point is ever called covered|never mark a segment covered/gi, "")), layer: document.querySelectorAll(".stmk").length };
});
if (r.msg) ok(false, "the assessment worked out: " + r.msg);
else {
  ok(r.segs === 8, `8 segments (${r.segs})`);
  ok(r.tot > 2500 && r.tot < 3200, `corridor length ${Math.round(r.tot)} NM is about Manila to Colombo via Malacca`);
  ok(r.rows > 50, `sampled every 50 NM (${r.rows} points)`);
  ok(r.remote > 0, `remote stretches flagged (${r.remote} points)`);
  ok(r.ports > 3 && r.hosp > 0 && r.af > 0, `support points found: ${r.ports} ports, ${r.hosp} sourced hospitals, ${r.af} airports`);
  ok(["sg-mpa-pocc", "my-mrcc-putrajaya", "lk-mrcc-colombo", "ph-pcg-comcen"].every((x) => r.rcc.includes(x)), "rescue leads include Philippines, Singapore, Malaysia and Sri Lanka: " + r.rcc.join(", "));
  ok(r.eta, "departure set: each point has an ETA");
  ok(r.coastRead > r.rows * 0.9, `coast distance read for ${r.coastRead} of ${r.rows} points`);
  ok(r.sections === 6, `the screen shows the assessment sections (${r.sections} of 6)`);
  ok(!r.covered, "no point is called covered");
  ok(r.layer > 0, `the corridor and support points are drawn on the map (${r.layer} marks)`);
  ok(!r.errs.length, "every data set was read" + (r.errs.length ? ": " + r.errs.join("; ") : ""));
  await p.waitForFunction(() => /Weather data by Open-Meteo/.test(document.getElementById("seatr").textContent), null, { timeout: 30000 });
  const wx = await p.evaluate(() => { const res = window.OSAP_SEATRANSIT.state().res; return { n: res.wx.rows.length, eta: res.wx.rows.filter((w) => w.basis === "eta").length, rough: res.wx.rows.every((w) => w.hs === 3 && w.flags.some((f) => /rough sea/.test(f))), wind: res.wx.rows[0].wind, t: document.getElementById("seatr").textContent }; });
  ok(wxCalls.length === 2, `marine weather read in two calls for every corridor point (${wxCalls.length})`);
  ok(wx.n === 17, `sea state at each waypoint and segment midpoint (${wx.n} points)`);
  ok(wx.eta > 0, `with a departure time, values are read at each point's ETA (${wx.eta} points)`);
  ok(wx.rough && wx.wind === 20, "3 m seas are flagged rough; wind read in knots");
  ok(/3a\. Sea state and wind along the corridor/.test(wx.t) && /not vessel, aircraft, hoist or boat-transfer limits/.test(wx.t), "the section says the flags are planning cues, not limits");
  // rings
  const ring = await p.evaluate(() => { const b = document.querySelector("#seatr [data-st-ring]"); if (!b) return null; b.click(); return window.OSAP_SEATRANSIT.state().plan.rings.length; });
  ok(ring === 1, "100/200 NM rings can be switched on for a support point");
  // print
  await p.click('#seatr [data-st="print"]');
  const pr = await p.evaluate(() => { const b = document.getElementById("brief"); return { open: !b.hidden, t: b.textContent, svg: !!b.querySelector("svg"), sign: /Master review/.test(b.textContent) }; });
  ok(pr.open && /Sea transit medical support assessment/.test(pr.t), "Print assessment opens the printable page");
  ok(pr.svg, "the printed page has the corridor map");
  ok(["7.", "8.", "9.", "10.", "11.", "12. Transit readiness worksheet", "13. Evidence and limitations"].every((h) => pr.t.includes(h)), "the printed page has sections 7 to 13");
  ok(pr.sign, "the printed page has the master, medical and company sign-off lines");
  await p.click("#std-close");
}
// worldwide rescue directory: an Atlantic corridor gets the European centres, each with its official page
await p.click('#seatr [data-st="clear"]');
for (const [g, n] of [["50.55, -1.30", "Solent approaches"], ["48.60, -5.60", "Off Ushant"], ["43.90, -9.60", "Off Finisterre"], ["38.60, -9.60", "Off Lisbon"]]) {
  await p.fill("#st-grid", g); await p.fill("#st-name", n); await p.click('#st-add button[type="submit"]');
}
await p.click('#seatr [data-st="run"]');
await p.waitForFunction(() => { const s = window.OSAP_SEATRANSIT.state(); return !s.busy && (s.res || /failed/.test(document.getElementById("st-msg").textContent)); }, null, { timeout: 90000 });
const eu = await p.evaluate(() => { const res = window.OSAP_SEATRANSIT.state().res; const t = document.getElementById("seatr").textContent; return res ? { cc: [...new Set(res.rcc.map((c) => c.cc))], links: (t.match(/open the official page/g) || []).length } : null; });
ok(eu && ["gb", "fr", "es", "pt"].every((c) => eu.cc.includes(c)), "Atlantic corridor: rescue leads for the UK, France, Spain and Portugal" + (eu ? " (" + eu.cc.join(", ") + ")" : ""));
ok(eu && eu.links > 0, "centres whose numbers OSAP could not read link to their official page");
await p.click('#seatr [data-st="close"]');
ok(await p.evaluate(() => document.getElementById("seatr").hidden && !document.querySelector(".stmk")), "Close hides the screen and clears the map");
// kept on this device
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_SEATRANSIT, null, { timeout: 60000 });
ok(await p.evaluate(() => window.OSAP_SEATRANSIT.state().plan.wps.length === 4), "the corridor is kept on this device after a reload");
const asked = outside.filter((u) => /osrm|routed-|overpass|interpreter|valhalla|nominatim/.test(u));
ok(!asked.length, "no road routing, Overpass or geocoder calls: the assessment uses the app's own data" + (asked.length ? ": " + asked.slice(0, 3).join(" ") : ""));
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
