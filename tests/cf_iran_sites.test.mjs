// The Iran war panel's site popups (assets/osap-cf-iran.js): reports about a named site are listed on it with their source links
// and claim labels, reports that only name the country are listed as related but never moved onto the site, and the period chosen
// in the page header applies. Built from the real data set file (node tools/conflict_extras/build.mjs iran-war).
// Usage: node tests/cf_iran_sites.test.mjs
import fs from "node:fs";
import vm from "node:vm";

let bad = 0;
const ok = (c, msg) => { if (!c) bad++; console.log((c ? "ok   " : "FAIL ") + msg); };
let period = null;   // [from, to] in ms, or null for All
const W = { OSAP_CONFLICT_TABS: { inPeriod: (t) => { if (!period) return true; const m = Date.parse(String(t).length <= 10 ? t + "T00:00:00Z" : t); return m >= period[0] && m <= period[1]; } } };
const ctx = { window: W, document: {}, setInterval: () => 0, clearInterval: () => 0, console };
W.window = W; vm.createContext(ctx);
vm.runInContext(fs.readFileSync("data/conflicts/extra/iran-war.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync("assets/osap-cf-iran.js", "utf8"), ctx);
const X = W.OSAP_CF_EXTRA["iran-war"], T = W.OSAP_CF_PANELS["iran-war"]._t;
ok(!!T, "panel exposes its pure helpers");

const dome = X.places.find((p) => /Jebel Dukhan/.test(p.name));
ok(!!dome && Math.abs(dome.lat - 26.03788) < 1e-5 && Math.abs(dome.lon - 50.54224) < 1e-5 && dome.prec === "site", "the radar dome is a place at the dome itself (26.03788N 50.54224E)");
ok(dome.why_status === "Draft, AI-generated, not analyst-approved", "its description stays a draft, not an analyst judgment");

// live reports as the refresh job writes them: one pinned on the site by its name, one pinned only to Bahrain, one elsewhere
const live = { items: [
  { title: "Iran claims new strike on radar atop Jebel Dukhan", date: "2026-11-16T09:00", link: "https://example.org/a", outlet: "Outlet A", state: true, fp: "a".repeat(64),
    geo: { n: dome.name, la: dome.lat, lo: dome.lon, p: "site" } },
  { title: "Iran says it targeted US radar site in Bahrain", date: "2026-11-15T09:00", link: "https://example.org/b", outlet: "Outlet B", fp: "b".repeat(64),
    geo: { n: "Bahrain", la: 26.228, lo: 50.586, p: "country" } },
  { title: "Bahrain condemns attack", date: "2026-11-15T10:00", link: "https://example.org/c", outlet: "Outlet C", fp: "c".repeat(64),
    geo: { n: "Bahrain", la: 26.228, lo: 50.586, p: "country" } },
] };
const recs = T.allRecords(live, X);
const at = T.atPlace(recs, dome).map((r) => r.url);
ok(at.includes("https://www.southmatters.com/world-news/iran-bahrain-radar-strike-claim/"), "the June claim report is listed on the dome");
ok(at.includes("https://www.yahoo.com/news/us/articles/iran-strikes-damaged-destroyed-us-141307706.html"), "AP's analysis (Airbus picture of the radome) is listed on the dome");
ok(at.includes("https://example.org/a"), "a live report pinned on the site by its name is listed on the dome");
ok(!at.includes("https://example.org/b") && !at.includes("https://example.org/c"), "reports that only name Bahrain are not listed as reporting on the site");
const rel = T.related(recs, dome).map((r) => r.url);
ok(rel.includes("https://example.org/b") && !rel.includes("https://example.org/c"), "a Bahrain-only report that mentions a radar is listed as related; one that does not is not");
ok(rel.some((u) => /tasnimnews/.test(u)), "the July Tasnim radar claims (Bahrain only) are related, not placed on the dome");
const h = T.placeHtml(dome, recs);
ok(/Reporting on this site/.test(h) && /Reported, not verified/.test(h) && /claim/.test(h), "the popup labels the reporting as reported, not verified, with claim tags");
ok(/about 11 Jun 2026/.test(h), "a report about the 11 Jun strike says so");
ok(/without naming this site/.test(h) && /may or may not be about this site/.test(h), "related reports say plainly they are not placed on the site");
ok(!/<script/i.test(h) && /href="https:\/\/www\.southmatters\.com/.test(h), "source links are plain https links");
ok(/Position of the radar dome itself/.test(h), "the popup says the position is the dome itself and how it was found");

// the period chosen in the header applies: 24 h leaves only the live report, and says how many are outside the period
period = [Date.parse("2026-11-15T12:00:00Z"), Date.parse("2026-11-16T12:00:00Z")];
const at24 = T.atPlace(recs, dome).map((r) => r.url);
ok(at24.length === 1 && at24[0] === "https://example.org/a", "a 24-hour period lists only the reports in it");
ok(/1 of \d+ in the chosen period/.test(T.placeHtml(dome, recs)), "and says how many are in the period");
period = [Date.parse("2026-01-01T00:00:00Z"), Date.parse("2026-01-02T00:00:00Z")];
ok(/None in the chosen period\. Choose All/.test(T.placeHtml(dome, recs)), "an empty period says how to see them");
period = null;

// a place without aliases or reporting shows no reporting section
const hormuz = X.places.find((p) => p.name === "Strait of Hormuz");
ok(!/Reporting on this site/.test(T.placeHtml(hormuz, recs)), "a place with no reporting has no reporting section");
// every backfill record that names a site resolves to a place, and its fingerprint covers the site
ok(X.records.filter((r) => r.site).every((r) => X.places.some((p) => p.id === r.site && p.lat === r.lat && p.lon === r.lon)), "site records sit on their place");
ok(X.records.every((r) => r.claim_status === "Reported, not verified"), "every earlier report stays a claim");
process.exit(bad ? 1 : 0);
