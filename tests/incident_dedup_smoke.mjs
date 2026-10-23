// Headless check that "Group reports of the same incident" counts one incident once (index.html evBuild / evPair / evMerge)
// and that the Timeline report and OSIR key events show one row and one summary per incident (assets/osap-tlreport.js).
// Built from the headlines of the 16-18 Oct 2026 Si Sakhon clash, which came out as seven events and two OSIR rows sharing
// one summary, with an Albania protests bulletin grouped into it on "dead" and "injured", and the 22 Oct 2026 Kelantan border
// fence cuts, which were split and left out of the key events. The headlines are added as test records dated 2030, so they
// group only with each other, never with the page's own records.
// Checked: the Si Sakhon reports make one event; the Albania bulletin (shared words only "dead" and "injured") joins nothing;
// the Rueso shooting the next day, a separate incident 18 km away, stays separate; the fence-cut reports, worded differently
// but all at Rantau Panjang, make one event; the headline is the most typical report, not the bulletin; a summary drafted
// for the incident is shown on one key-event row only; the incident count counts each incident once.
// Run from the repo root: node tests/incident_dedup_smoke.mjs   (needs the playwright package and Chromium)
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

const SS = [6.23, 101.5, "approx", "Si Sakhon district, Narathiwat"], RU = [6.392, 101.522, "approx", "Rueso district, Narathiwat"],
  NP = [6.43, 101.82, "province", "Narathiwat province"], RP = [6.02, 101.98, "approx", "Rantau Panjang (Kelantan, Malaysia)"], NONE = [null, null, "", ""];
/* [time, place, source, headline, type] in the order the feeds gave them */
const T = [
  ["2030-10-16T11:59", NONE, "@ThaiPBS", "Protests in Albania: 10 dead, 25 injured | Midday News | Oct 18, 2030"],
  ["2030-10-16T17:00", SS, "ISOC Region 4 Forward Command", "The report of the clashes in Si Sakhon, Narathiwat province indicates that one police officer or volunteer was killed and two were injured.", "claim"],
  ["2030-10-16T17:20", SS, "Daily News", "Si Sakhon, police attack on gang of Narathiwat 1 dead and 2 injured"],
  ["2030-10-16T17:40", SS, "Matichon", "Emergency, police intercepted gang in Si Sakhon Narathiwat district. One officer killed, two injured, one gunman dead"],
  ["2030-10-16T18:05", NP, "Amarin TV", "Police fight off gang of assailants in Narathiwat, one killed and two injured"],
  ["2030-10-16T18:30", SS, "Khaosod", "Police fight gang of robbers, policeman killed, one injured, two robbers killed, one in Narathiwas."],
  ["2030-10-16T19:10", SS, "Naewna", "1 dead, 2 injured in Sri Sagar Narathiwas shooting"],
  ["2030-10-16T20:58", SS, "Thai Rath", "Three bodies found in Si Sakhon clashes, warranted for bomb-shooting."],
  ["2030-10-16T23:57", SS, "PPTV", "One policeman killed, two rangers wounded in clashes at Si Sakhon town."],
  ["2030-10-17T01:00", SS, "Isranews", "Narathiwat, violent clashes in Si Sakhon. One policeman killed, two soldiers wounded."],
  ["2030-10-17T04:53", SS, "Amarin TV", "Three Southern bandits arrested in Si Sakhon found to be linked to several high profile cases."],
  ["2030-10-17T13:55", RU, "Daily News", "Southern bandits shot 1 policeman dead in Rueso before fleeing with 1 gun."],
  ["2030-10-17T14:30", RU, "Thai Rath", "Policeman shot dead at Rueso."],
  ["2030-10-17T15:10", RU, "The Bangkok Insight", "Two gunmen sniper police officers at Rueso, Narathiwat."],
  ["2030-10-21T20:58", RP, "Berita Harian", "Teenage girl arrested for cracking barbed wire across border illegally"],
  ["2030-10-21T20:59", RP, "Harian Metro", "Teenage girl arrested, opens barbed wire to cross border illegally"],
  ["2030-10-22T07:39", RP, "New Straits Times", "Kelantan-Thailand border concertina wire found cut 11 times between March, October"],
  ["2030-10-22T10:13", RP, "Malay Mail", "Snip, snip, slip through? Wire fences cut at illegal crossings near Rantau Panjang-Thai border"],
  ["2030-10-22T12:20", RP, "The Sun (Malaysia)", "Fence wires cut at 13 illegal border crossing points along Rantau Panjang: Police"],
  ["2030-10-22T14:57", RP, "Harian Metro", "PGA records 11 cases of border barbed wire cut in Kelantan"]
];

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 860 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_EVENTS && window.OSAP_TLREPORT, null, { timeout: 60000 });
await p.waitForTimeout(8000);

const res = await p.evaluate((T) => {
  const R = window.TSAP.records, src = {};
  T.forEach((t, i) => {
    const s = src[t[2]] || (src[t[2]] = { name: t[2], kind: "test" });
    R.push({ id: "tdd" + i, title: t[3], ts: t[0], lat: t[1][0], lon: t[1][1], prec: t[1][2], place: t[1][3], prov: t[1][3] ? "Narathiwat" : "",
      src: s, layer: "insurgency", type: t[4] || "event", sev: 2, url: "https://example.org/tdd" + i, cat: "Live report" });
  });
  const ev = window.OSAP_EVENTS.list(), of = {};
  ev.forEach((e) => e.reports.forEach((p) => { if (/^https:\/\/example\.org\/tdd/.test(p.url)) of[+p.url.slice(23)] = e; }));
  const ids = T.map((t, i) => (of[i] ? of[i].id : null));
  const head = (i) => (of[i] ? of[i].title : "");
  return { ids, head1: head(1), n1: of[1] ? of[1].reports.length : 0 };
}, T);
const SSi = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], RUi = [11, 12, 13], RPi = [14, 15, 16, 17, 18, 19];
ok(res.ids[0] === null, "the Albania bulletin, sharing only \"dead\" and \"injured\", joins no event");
ok(SSi.every((i) => res.ids[i] && res.ids[i] === res.ids[1]), "the Si Sakhon clash reports are one event (" + res.n1 + " reports; ids " + new Set(SSi.map((i) => res.ids[i])).size + " distinct)");
ok(res.ids[11] && res.ids[11] === res.ids[12] && RUi.every((i) => res.ids[i] !== res.ids[1]), "the Rueso shooting is its own event, not merged into Si Sakhon");
ok(RPi.every((i) => res.ids[i] && res.ids[i] === res.ids[14]), "the border fence-cut reports, worded differently at one place, are one event");
ok(/Si Sakhon/.test(res.head1) && !/Albania/.test(res.head1), "headline is a Si Sakhon report: " + res.head1.slice(0, 80));

/* the report: one row per incident, one summary per incident, incidents counted once */
await p.evaluate(() => new Promise((done) => window.OSAP_TLREPORT.data({ scope: "", from: "2030-10-16", to: "2030-10-23" }, done)));  // the summaries file has loaded
const rep = await p.evaluate(() => new Promise((done) => {
  const ev = window.OSAP_EVENTS.list().filter((e) => e.reports.some((r) => /tdd/.test(r.url))), keys = [];
  ev.forEach((e) => e.reports.forEach((r) => keys.push(r.key)));
  /* a drafted summary covering most of the Si Sakhon reports */
  const ss = ev.filter((e) => /Si Sakhon/.test(e.title))[0];
  window.OSAP_EVSUM = { model: "test", items: { t1: { keys: ss.reports.slice(0, 8).map((r) => r.key), made: "2030-10-18 00:00", method: "extract", summary: "SUMMARY-ONE", refs: [] } } };
  window.OSAP_TLREPORT.data({ scope: "", from: "2030-10-16", to: "2030-10-23" }, (d) => {
    const rows = d.keyEv.filter((e) => e.g), html = rows.map(d.rowHtml).join("");
    done({ rows: rows.map((e) => e.title), sums: (html.match(/SUMMARY-ONE/g) || []).length, inc: d.incidents, recs: d.recs.length });
  });
}));
ok(rep.rows.filter((t) => /Si Sakhon|Narathiwas/.test(t)).length === 1, "key events: the Si Sakhon clash is one row (" + rep.rows.length + " grouped rows)");
ok(rep.rows.some((t) => /wire|fence/i.test(t)), "key events include the border fence cutting");
ok(rep.sums === 1, "the drafted summary is shown on one row only (" + rep.sums + ")");
ok(rep.inc && rep.inc.n === rep.recs - rep.inc.grouped + rep.inc.groups && rep.inc.groups >= 3 && rep.inc.n < rep.recs,
  "incidents counted once: " + rep.recs + " records come to " + (rep.inc && rep.inc.n) + " incidents or items (" + (rep.inc && rep.inc.groups) + " groups)");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
