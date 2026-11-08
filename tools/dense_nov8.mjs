// New open feeds of 8 Nov 2026 (owner: "Do it all"), registered into the dense open-data run (tools/refresh_dense.mjs).
// Every source was probed from GitHub Actions first (tools/probe_dense.mjs on claude/one-source-probe). No keys, no accounts.
//   portwatch-choke  IMF PortWatch daily transits through 28 maritime chokepoints (7-day average vs the 4 weeks before)
//   portwatch-disrupt IMF PortWatch events that hit ports (affected ports named by PortWatch)
//   rfj              U.S. State Department Rewards for Justice offers, by the country each offer names
//   vaac             Volcanic ash advisories of the Tokyo and Washington VAACs (latest per volcano, last 48 hours)
//   unsc-press       UN Security Council meetings coverage and press statements (headline and link only)
//   usgs-blast       Explosion-type seismic events (explosions, nuclear/chemical/mining blasts, sonic booms) in the USGS catalog
//   bfs-odl          Official gamma dose rate network of Germany (BfS ODL, about 1,700 stations, hourly)
//   ripe-routing     Routed address space per country (RIPE RIS): drops against three days earlier
//   un-pko           UN peacekeeping missions with deployed strength and fatalities of the last 12 months (UN DPO via HDX, CC BY-IGO)
//   eu-regimes       EU sanctions regimes by target country, with last amendment (EU Sanctions Map; the EU's own list file errors)
//   sat-pass         Reconnaissance, radar and Earth-imaging satellites passing over each country in the next 12 hours
//                    (CelesTrak public orbital elements, propagated here: approximate)
// Licences are in each feed's "lic". IMF terms and UN press copyright are not clearly open for commercial reuse, so those
// feeds are nc:true (dropped in the sold version, tools/nc_strip.mjs) until checked.
import { feed, run, unhtml, rssItems, sleep, csvObjects } from "./dense_lib.mjs";
import { COUNTRIES, ccsAt, ccFromName, ccFromA2, ccFromA3, ccsInText, withOki } from "./geo_cc.mjs";

const uniq = (a) => [...new Set(a.filter(Boolean))];
const day = (t) => new Date(t).toISOString().slice(0, 10);

// ---------------------------------------------------------------- IMF PortWatch
const PW = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/";
const PW_LIC = "IMF PortWatch (IMF copyright and usage terms, imf.org/external/terms.htm); attribution, not yet cleared for commercial reuse";
feed("portwatch-choke", { name: "Ship transits through maritime chokepoints (IMF PortWatch)", org: "International Monetary Fund, PortWatch", cat: "Maritime", lic: PW_LIC, nc: true,
  url: "https://portwatch.imf.org/pages/port-monitor", everyHours: 6 });
/** Daily rows [{portid, date, n_total, n_tanker, n_container, n_dry_bulk}] into one summary per chokepoint. */
export function chokeSummary(rows, meta) {
  const by = {};
  for (const r of rows) (by[r.portid] = by[r.portid] || []).push(r);
  const out = [];
  for (const [id, list] of Object.entries(by)) {
    const m = meta[id]; if (!m) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = list[list.length - 1], lastT = Date.parse(last.date);
    const win = (from, to) => list.filter((r) => { const t = Date.parse(r.date); return t > lastT - from * 864e5 && t <= lastT - to * 864e5; });
    const avg = (a, k = "n_total") => (a.length ? a.reduce((s, r) => s + (+r[k] || 0), 0) / a.length : NaN);
    const w7 = win(7, 0), w28 = win(35, 7);
    const a7 = avg(w7), a28 = avg(w28), chg = isFinite(a7) && a28 > 0 ? Math.round(((a7 - a28) / a28) * 100) : null;
    out.push({ id, name: m.name, lat: m.lat, lon: m.lon, date: last.date, avg7: Math.round(a7 * 10) / 10, avg28: Math.round(a28 * 10) / 10, chg,
      tanker7: Math.round(avg(w7, "n_tanker") * 10) / 10, container7: Math.round(avg(w7, "n_container") * 10) / 10, bulk7: Math.round(avg(w7, "n_dry_bulk") * 10) / 10 });
  }
  return out;
}
run("portwatch-choke", async (g) => {
  const cj = await g(PW + "PortWatch_chokepoints_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,lat,lon&returnGeometry=false&f=json");
  const meta = {};
  for (const f of cj.features || []) { const a = f.attributes; if (a.portid && isFinite(a.lat) && isFinite(a.lon)) meta[a.portid] = { name: a.portname, lat: a.lat, lon: a.lon }; }
  if (Object.keys(meta).length < 10) throw new Error("chokepoint list looks short (" + Object.keys(meta).length + ")");
  const from = day(Date.now() - 50 * 864e5), rows = [];
  for (let off = 0; off < 20000; off += 2000) {
    const j = await g(PW + "Daily_Chokepoints_Data/FeatureServer/0/query?where=" + encodeURIComponent("date >= DATE '" + from + "'") +
      "&outFields=portid,date,n_total,n_tanker,n_container,n_dry_bulk&orderByFields=ObjectId&resultOffset=" + off + "&resultRecordCount=2000&f=json");
    if (j.error) throw new Error("PortWatch query: " + (j.error.message || "error"));
    for (const f of j.features || []) rows.push(f.attributes);
    if (!j.exceededTransferLimit && (j.features || []).length < 2000) break;
  }
  if (!rows.length) throw new Error("no daily rows since " + from);
  const items = [];
  for (const s of chokeSummary(rows, meta)) {
    const drop = s.chg != null && s.chg <= -30 ? 3 : s.chg != null && s.chg <= -15 ? 2 : 1;
    items.push({ title: s.name + ": " + s.avg7 + " ships a day (7-day average)" + (s.chg != null ? ", " + (s.chg > 0 ? "+" : "") + s.chg + "% on the 4 weeks before" : ""),
      detail: "Tankers " + s.tanker7 + ", container ships " + s.container7 + ", dry bulk " + s.bulk7 + " a day. 4-week average before that: " + s.avg28 +
        ". Counted by the IMF from ship AIS signals; the latest day is " + s.date + " (PortWatch publishes with a few days' delay).",
      date: s.date, lat: s.lat, lon: s.lon, url: "https://portwatch.imf.org/pages/port-monitor", sev: drop, kind: "Chokepoint traffic", value: s.avg7, ccs: withOki(ccsAt(s.lat, s.lon, 2)) });
  }
  return { items, globals: items.slice().sort((a, b) => b.sev - a.sev || b.value - a.value).map((x) => ({ ...x, ccs: undefined })), note: items.length + " chokepoints" };
});

feed("portwatch-disrupt", { name: "Port disruptions (IMF PortWatch)", org: "International Monetary Fund, PortWatch", cat: "Maritime", lic: PW_LIC, nc: true,
  url: "https://portwatch.imf.org/pages/disruption-monitor", everyHours: 6 });
run("portwatch-disrupt", async (g) => {
  const since = Date.now() - 45 * 864e5;
  const j = await g(PW + "portwatch_disruptions_database/FeatureServer/0/query?where=" + encodeURIComponent("n_affectedports > 0") +
    "&outFields=eventid,eventtype,eventname,htmldescription,alertlevel,country,fromdate,todate,severitytext,lat,long,n_affectedports&returnGeometry=false&orderByFields=fromdate%20DESC&resultRecordCount=200&f=json");
  if (j.error) throw new Error("PortWatch query: " + (j.error.message || "error"));
  const items = [];
  for (const f of j.features || []) {
    const a = f.attributes; if (!(a.todate >= since || a.fromdate >= since)) continue;
    const ccs = uniq([ccFromName(a.country || ""), ...ccsAt(a.lat, a.long, 1)]);
    items.push({ title: (a.eventname || "Disruption") + ": " + a.n_affectedports + " port" + (a.n_affectedports === 1 ? "" : "s") + " affected",
      detail: unhtml(a.htmldescription || "") + (a.severitytext ? " " + a.severitytext + "." : ""), date: new Date(a.fromdate).toISOString(), lat: a.lat, lon: a.long,
      url: "https://portwatch.imf.org/pages/disruption-monitor", sev: a.alertlevel === "RED" ? 3 : a.alertlevel === "ORANGE" ? 2 : 1, kind: "Port disruption", value: a.n_affectedports, ccs: withOki(ccs) });
  }
  return { items, note: items.length + " events with affected ports in 45 days" };
});

// ---------------------------------------------------------------- Rewards for Justice
feed("rfj", { name: "Rewards for Justice offers (U.S. State Department)", org: "U.S. Department of State, Rewards for Justice", cat: "Sanctions",
  lic: "U.S. Government work, public domain", url: "https://rewardsforjustice.net/", everyHours: 12 });
/** The country and category tags of one offer from its WordPress class list. */
export function rfjTags(classList) {
  const c = Array.isArray(classList) ? classList : [];
  const countries = c.filter((x) => x.startsWith("location-country-")).map((x) => x.slice(17).replace(/-/g, " "));
  const cats = c.filter((x) => /^crime-category-|^cyber-|^hostages-kidnapping|^election-interference|^dprk/.test(x)).map((x) => x.replace(/^crime-category-/, "").replace(/-/g, " "));
  const orgs = c.filter((x) => x.startsWith("organization-")).map((x) => x.slice(13).replace(/-/g, " "));
  return { countries, cats, orgs };
}
run("rfj", async (g) => {
  const items = [];
  let n = 0;
  for (let p = 1; p <= 10; p++) {
    let list;
    try { list = await g("https://rewardsforjustice.net/wp-json/wp/v2/rewards?per_page=100&page=" + p + "&_fields=id,date,modified,link,title,class_list"); }
    catch (e) { if (p > 1 && /400/.test(e.message)) break; throw e; }
    if (!Array.isArray(list) || !list.length) break;
    for (const r of list) {
      n++;
      const t = rfjTags(r.class_list), ccs = uniq(t.countries.map((x) => ccFromName(x)));
      if (!ccs.length) continue;
      items.push({ title: "Reward offer: " + unhtml(r.title && r.title.rendered || "").trim(), detail: [t.cats.length ? "Category: " + t.cats.join(", ") : "", t.orgs.length ? "Organization: " + t.orgs.join(", ") : "",
        "A U.S. government reward offer for information; the people and groups named are wanted or designated by the U.S. government."].filter(Boolean).join(". "),
        date: r.modified || r.date, url: r.link, sev: 2, kind: "Reward offer (U.S.)", ccs: withOki(ccs) });
    }
    if (list.length < 100) break;
    await sleep(300);
  }
  return { items, note: items.length + " of " + n + " offers name a country" };
});

// ---------------------------------------------------------------- volcanic ash advisories (VAAC)
feed("vaac", { name: "Volcanic ash advisories (Tokyo and Washington VAACs)", org: "Japan Meteorological Agency (Tokyo VAAC); NOAA (Washington VAAC)", cat: "Aviation",
  lic: "JMA site terms (reuse with credit, compatible with CC BY 4.0); NOAA: U.S. Government work, public domain", url: "https://www.data.jma.go.jp/svd/vaac/data/vaac_list.html", everyHours: 1 });
const ll = (s) => { const m = /([NS])(\d{2})(\d{2})\s+([EW])(\d{3})(\d{2})/.exec(s || ""); if (!m) return null;
  const la = (+m[2] + +m[3] / 60) * (m[1] === "S" ? -1 : 1), lo = (+m[5] + +m[6] / 60) * (m[4] === "W" ? -1 : 1); return [la, lo]; };
/** One advisory's text into its fields. */
export function vaaParse(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  const f = (k, stop) => { const m = new RegExp(k + ":\\s*(.*?)\\s*(?=" + stop + "|$)").exec(t); return m ? m[1].trim() : ""; };
  const KEYS = "(?:VAAC|VOLCANO|PSN|AREA|SUMMIT ELEV|SOURCE ELEV|ADVISORY NR|INFO SOURCE|AVIATION COLOUR CODE|ERUPTION DETAILS|OBS VA DTG|OBS VA CLD|EST VA DTG|EST VA CLD|FCST VA CLD[^:]{0,14}|RMK|NXT ADVISORY)\\s*:";
  const dtg = /DTG:\s*(\d{4})(\d{2})(\d{2})\/(\d{2})(\d{2})Z/.exec(t);
  return { issued: dtg ? `${dtg[1]}-${dtg[2]}-${dtg[3]}T${dtg[4]}:${dtg[5]}Z` : "", vaac: f("VAAC", KEYS), volcano: f("VOLCANO", KEYS).replace(/\s+\d{6}$/, ""), pos: ll(f("PSN", KEYS)),
    area: f("AREA", KEYS), eruption: f("ERUPTION DETAILS", KEYS), obs: f("OBS VA CLD", KEYS) || f("EST VA CLD", KEYS), next: f("NXT ADVISORY", KEYS) };
}
run("vaac", async (g) => {
  const links = [];
  try {
    const h = await g("https://www.data.jma.go.jp/svd/vaac/data/vaac_list.html", "text");
    for (const m of h.matchAll(/href="(TextData\/\d{4}\/\d{8}_[^"]+_Text\.html)"/g)) links.push(["Tokyo", "https://www.data.jma.go.jp/svd/vaac/data/" + m[1]]);
  } catch (e) { console.error("vaac: Tokyo list " + e.message); }
  try {
    const h = await g("https://www.ospo.noaa.gov/products/atmosphere/vaac/messages.html", "text");
    for (const m of h.matchAll(/href="(\/VAAC\/ARCH\d\d\/[^"]+\.html)"/g)) links.push(["Washington", "https://www.ospo.noaa.gov" + m[1]]);
  } catch (e) { console.error("vaac: Washington list " + e.message); }
  if (!links.length) throw new Error("no advisory links on either VAAC list");
  const latest = {};
  let read = 0;
  // Each list is newest first: read the newest 30 of each VAAC so one busy centre cannot crowd out the other.
  const pick = ["Tokyo", "Washington"].flatMap((w) => uniq(links.filter((l) => l[0] === w).map((l) => l.join("|"))).slice(0, 30).map((s) => s.split("|")));
  for (const [who, u] of pick) {
    try {
      const a = vaaParse(unhtml(await g(u, "text"))); read++;
      if (!a.volcano || !a.pos || !a.issued || Date.now() - Date.parse(a.issued) > 48 * 36e5) continue;
      const k = a.volcano.toUpperCase();
      if (!latest[k] || latest[k].issued < a.issued) latest[k] = { ...a, who, u };
    } catch (e) { /* one advisory page failing does not stop the rest */ }
    await sleep(150);
  }
  const items = Object.values(latest).map((a) => {
    const none = /NOT IDENTIFIABLE|NO VA EXP|VA DISSIPATED/i.test(a.obs + " " + a.eruption), fl = Math.max(0, ...[...a.obs.matchAll(/FL(\d{3})/g)].map((m) => +m[1]));
    const name = a.volcano.charAt(0) + a.volcano.slice(1).toLowerCase();
    return { title: "Volcanic ash advisory: " + name + (a.area ? " (" + a.area.charAt(0) + a.area.slice(1).toLowerCase() + ")" : "") + (none ? ", no ash seen" : fl ? ", ash up to FL" + fl : ", ash reported"),
      detail: [a.eruption, a.obs ? "Observed ash cloud: " + a.obs.slice(0, 300) : "", a.next ? "Next advisory: " + a.next : "", a.who + " VAAC."].filter(Boolean).join(" "),
      date: a.issued, lat: a.pos[0], lon: a.pos[1], url: a.u, sev: none ? 1 : fl >= 200 ? 3 : 2, kind: "Volcanic ash advisory", value: fl || null,
      ccs: withOki(uniq([...ccsAt(a.pos[0], a.pos[1], 0.5), ccFromName(a.area.toLowerCase())])) };
  });
  return { items, note: items.length + " volcanoes with an advisory in 48 h (" + read + " advisories read)" };
});

// ---------------------------------------------------------------- UN Security Council (press.un.org)
feed("unsc-press", { name: "UN Security Council meetings coverage and press statements", org: "United Nations, Meetings Coverage and Press Releases", cat: "Politics",
  lic: "UN copyright; headline and link only", nc: true, url: "https://press.un.org/en/content/security-council", everyHours: 2 });
run("unsc-press", async (g) => {
  const seen = new Set(), items = [];
  const add = (title, link, date) => {
    const t = unhtml(title).replace(/\s+/g, " ").trim(); if (!t || seen.has(link)) return; seen.add(link);
    const ccs = ccsInText(t); if (!ccs.length) return;
    items.push({ title: t, date: date || "", url: link, sev: /resolution|adopt|condemn|attack|ceasefire|sanction/i.test(t) ? 2 : 1, kind: "UN Security Council", ccs: withOki(ccs) });
  };
  const h = await g("https://press.un.org/en/content/security-council", "text");
  for (const m of h.matchAll(/<a[^>]+href="(\/en\/\d{4}\/sc\d+\.doc\.htm)"[^>]*>([\s\S]*?)<\/a>/g)) add(m[2], "https://press.un.org" + m[1], "");
  try { for (const it of rssItems(await g("https://press.un.org/en/rss.xml", "text"))) if (/\/sc\d+\.doc\.htm/.test(it.link || "")) add(it.title, it.link, it.date); } catch (e) {}
  // the listing has no dates: the press release number orders them, and the date is read from the newest few pages' <time> tags
  for (const it of items.slice(0, 12)) if (!it.date) { try { const p = await g(it.url, "text"); const m = /<time[^>]+datetime="([^"]+)"/.exec(p) || /(\d{1,2} [A-Z][a-z]+ \d{4})/.exec(p); if (m) it.date = new Date(m[1]).toISOString(); } catch (e) {} await sleep(150); }
  return { items: items.filter((x) => x.date), note: items.length + " statements naming a country" };
});

// ---------------------------------------------------------------- USGS explosion-type seismic events
// The USGS catalog labels events its analysts judge man-made: explosions, nuclear, chemical, mining and industrial blasts,
// sonic booms, mine collapses. Ordinary US quarry blasts are many and small, so quarry blasts below M2 are left out.
const BLAST_TYPES = ["explosion", "nuclear explosion", "chemical explosion", "industrial explosion", "mining explosion", "experimental explosion", "quarry blast", "sonic boom", "mine collapse", "rock burst", "collapse", "acoustic noise", "other event"];
feed("usgs-blast", { name: "Explosion-type seismic events (USGS catalog)", org: "U.S. Geological Survey, Earthquake Hazards Program", cat: "Security",
  lic: "U.S. Government work, public domain", url: "https://earthquake.usgs.gov/earthquakes/search/", everyHours: 2 });
/** One USGS GeoJSON feature into an item, or null when it is a small quarry blast or has no position. */
export function blastItem(f) {
  const p = f && f.properties || {}, c = f && f.geometry && f.geometry.coordinates || [];
  const type = String(p.type || "").toLowerCase(), mag = typeof p.mag === "number" ? p.mag : null;
  if (!BLAST_TYPES.includes(type) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
  if (type === "quarry blast" && !(mag >= 2)) return null;
  const sev = /nuclear/.test(type) ? 3 : /explosion|sonic boom|collapse|rock burst/.test(type) && mag >= 2.5 ? 2 : 1;
  return { title: type.charAt(0).toUpperCase() + type.slice(1) + (mag != null ? " M" + mag.toFixed(1) : "") + (p.place ? ", " + p.place : ""),
    detail: "USGS reviewed event type: " + type + (p.status ? " (" + p.status + ")" : "") + ". Depth " + (typeof c[2] === "number" ? c[2].toFixed(1) + " km" : "unknown") + ".",
    date: new Date(p.time).toISOString(), lat: c[1], lon: c[0], url: p.url || "", sev, kind: "Explosion-type seismic event", value: mag, ccs: withOki(ccsAt(c[1], c[0], 0.5)) };
}
run("usgs-blast", async (g) => {
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const j = await g("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=2000&starttime=" + from + "&eventtype=" + BLAST_TYPES.map(encodeURIComponent).join(","));
  const items = (j.features || []).map(blastItem).filter((x) => x && x.ccs.length);
  return { items, note: items.length + " events in 30 days (" + (j.features || []).length + " in the catalog before the quarry-blast filter)" };
});

// ---------------------------------------------------------------- Germany's official gamma dose rate network (BfS ODL)
feed("bfs-odl", { name: "Gamma dose rate, Germany's official monitoring network (BfS ODL)", org: "Bundesamt für Strahlenschutz (BfS)", cat: "Environment",
  lic: "Datenlizenz Deutschland, Namensnennung 2.0 (commercial reuse allowed with credit)", url: "https://odlinfo.bfs.de/", everyHours: 1 });
/** Station features into a summary (figures) and items for the stations above the alert level. */
export function odlSummary(features, high = 0.3) {
  const ok = features.map((f) => ({ ...f.properties, lon: f.geometry && f.geometry.coordinates[0], lat: f.geometry && f.geometry.coordinates[1] }))
    .filter((p) => typeof p.value === "number" && p.site_status === 1);
  const vals = ok.map((p) => p.value).sort((a, b) => a - b), med = vals.length ? vals[Math.floor(vals.length / 2)] : null;
  const top = ok.slice().sort((a, b) => b.value - a.value)[0];
  return { n: ok.length, median: med, max: top ? top.value : null, maxAt: top ? top.name : "", asof: top ? top.end_measure : "", high: ok.filter((p) => p.value >= high) };
}
run("bfs-odl", async (g) => {
  const j = await g("https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_odl_1h_latest&outputFormat=application/json");
  const s = odlSummary(j.features || []);
  if (!s.n) throw new Error("no station in operation in the reply");
  const items = [{ title: "Germany gamma dose rate: median " + s.median.toFixed(3) + " µSv/h across " + s.n + " stations, highest " + s.max.toFixed(3) + " at " + s.maxAt,
    detail: "Hourly ambient gamma dose rate of the federal monitoring network. Normal background in Germany is about 0.05 to 0.18 µSv/h; rain briefly raises it.",
    date: s.asof, url: "https://odlinfo.bfs.de/", sev: s.max >= 0.5 ? 3 : s.max >= 0.3 ? 2 : 1, kind: "Radiation network", value: s.median, ccs: ["de"] },
    ...s.high.map((p) => ({ title: "High gamma dose rate: " + p.value.toFixed(3) + " µSv/h at " + p.name, detail: "BfS station " + p.kenn + ", hour ending " + p.end_measure + ".",
      date: p.end_measure, lat: p.lat, lon: p.lon, url: "https://odlinfo.bfs.de/", sev: p.value >= 0.5 ? 3 : 2, kind: "Radiation reading", value: p.value, ccs: ["de"] }))];
  return { items, figures: { de: { stations: s.n, medianUSvH: s.median, maxUSvH: s.max } }, note: s.n + " stations, " + s.high.length + " at or above 0.3 µSv/h" };
});

// ---------------------------------------------------------------- RIPE RIS routing per country
// RIPEstat country-resource-stats: how many IPv4/IPv6 prefixes and networks (ASNs) from each country the RIPE route
// collectors see. A sharp fall against three days earlier is a sign of a shutdown or a large outage (IODA reports outages
// too; RIPE's terms allow commercial use, so this one stays in the sold version).
feed("ripe-routing", { name: "Routed internet address space per country (RIPE RIS)", org: "RIPE NCC, RIPEstat", cat: "Cyber",
  lic: "RIPEstat terms of use (free, commercial use allowed with attribution)", url: "https://stat.ripe.net/", everyHours: 6 });
/** Timeline rows into {now, before, chg}: the newest row against the oldest, by visible IPv4 prefixes. */
export function routeChange(stats) {
  const rows = (stats || []).filter((r) => typeof r.v4_prefixes_ris === "number" && r.v4_prefixes_ris >= 0);
  if (rows.length < 2) return null;
  const a = rows[0], b = rows[rows.length - 1];
  return { before: a.v4_prefixes_ris, now: b.v4_prefixes_ris, asnsBefore: a.asns_ris, asnsNow: b.asns_ris, when: (b.timeline && b.timeline[0] && b.timeline[0].starttime) || "",
    chg: a.v4_prefixes_ris ? Math.round(((b.v4_prefixes_ris - a.v4_prefixes_ris) / a.v4_prefixes_ris) * 1000) / 10 : 0 };
}
run("ripe-routing", async (g) => {
  const from = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 13) + ":00";
  const items = [], figures = {}; let read = 0, fails = 0;
  const ccs = COUNTRIES.filter((c) => c.id !== "oki" && /^[A-Z]{2}$/.test(c.a2));
  for (const c of ccs) {
    try {
      const j = await g("https://stat.ripe.net/data/country-resource-stats/data.json?sourceapp=axiom-osap&resource=" + c.a2 + "&starttime=" + from + "&resolution=1d");
      const r = routeChange(j.data && j.data.stats); read++;
      if (!r) continue;
      figures[c.id] = { v4Prefixes: r.now, asns: r.asnsNow, chg3d: r.chg };
      if (r.chg <= -5 && r.before >= 20) items.push({ title: "Routed address space in " + c.name + " down " + Math.abs(r.chg) + "% in 3 days", detail: "IPv4 prefixes seen by RIPE route collectors: " + r.before + " then " + r.now + "; networks (ASNs) " + r.asnsBefore + " then " + r.asnsNow + ". Can mean a shutdown, an outage or routine re-routing.",
        date: r.when ? new Date(r.when + "Z").toISOString() : new Date().toISOString(), url: "https://stat.ripe.net/app/" + c.a2, sev: r.chg <= -25 ? 3 : r.chg <= -10 ? 2 : 1, kind: "Internet routing", value: r.chg, ccs: withOki([c.id]) });
    } catch (e) { if (++fails > 25) throw new Error("RIPEstat stopped answering after " + read + " countries"); }
    await sleep(120);
  }
  return { items, figures, note: read + " countries read, " + items.length + " with a fall of 5% or more" };
});

// ---------------------------------------------------------------- UN peacekeeping missions
const HDX = "https://data.humdata.org/dataset/";
feed("un-pko", { name: "UN peacekeeping missions and deployed personnel", org: "UN Department of Peace Operations (via HDX)", cat: "Security",
  lic: "CC BY-IGO (commercial reuse allowed with credit)", url: "https://peacekeeping.un.org/en/where-we-operate", everyHours: 24 });
const commaNum = (v) => { const n = parseFloat(String(v || "").replace(",", ".")); return isNaN(n) ? null : n; };
/** Active missions with their latest reported strength. */
export function pkoMissions(missions, posts) {
  const strength = {};
  for (const r of posts) {
    const k = r.mission_acronym, s = strength[k] || (strength[k] = { end: "", cats: {} });
    if (r.end_date > s.end) { s.end = r.end_date; s.cats = {}; }
    if (r.end_date === s.end) s.cats[r.category] = (s.cats[r.category] || 0) + (+r.actual_average || 0);
  }
  return missions.filter((m) => m.mission_isactive === "Yes").map((m) => {
    const lat = commaNum(m.mission_latitude), lon = commaNum(m.mission_longitude), s = strength[m.mission_acronym];
    const total = s ? Object.values(s.cats).reduce((a, b) => a + b, 0) : null;
    return { acr: m.mission_acronym, name: m.mission_name, place: m.mission_location, lat, lon, total, cats: s ? s.cats : {}, period: s ? s.end : "" };
  });
}
/** Fatality rows into {mission: {n, malicious, causes, last}} for the 12 months before now (ms). No names are in the file. */
export function pkoFatalities(rows, now) {
  const from = new Date(now - 365 * 864e5).toISOString().slice(0, 10), out = {};
  for (const r of rows) {
    if (!(r.incident_date >= from) || r.type_of_casualty !== "Fatality") continue;
    const o = out[r.mission_acronym] || (out[r.mission_acronym] = { n: 0, malicious: 0, causes: {}, last: "" });
    o.n++; if (/malicious/i.test(r.type_of_incident)) o.malicious++;
    o.causes[r.type_of_incident || "Unknown"] = (o.causes[r.type_of_incident || "Unknown"] || 0) + 1;
    if (r.incident_date > o.last) o.last = r.incident_date;
  }
  return out;
}
run("un-pko", async (g) => {
  const [mt, pt] = await Promise.all([g(HDX + "819dce10-ac8a-4960-8756-856a9f72d820/resource/7f738eb4-6f77-4b5c-905a-ed6d45cc5515/download/dppadposs-pko.csv", "text"),
    g(HDX + "f6b91534-494c-45b1-97a4-cd01bafb4e72/resource/b1efbe57-2bbe-4f3b-9b05-6c2c2e891822/download/dpo-postsactual.csv", "text")]);
  const ms = pkoMissions(csvObjects(mt), csvObjects(pt));
  let deaths = {};
  try { deaths = pkoFatalities(csvObjects(await g(HDX + "4ce16b45-5526-471d-8918-2ed76082f1c8/resource/4cfc43b6-cc9c-403b-966f-fc37b8dd7d4b/download/dppadposs-fatalities.csv", "text")), Date.now()); }
  catch (e) { console.error("un-pko: fatalities " + e.message); }
  const items = ms.flatMap((m) => {
    const ccs = withOki(uniq([...(m.lat != null ? ccsAt(m.lat, m.lon, 0.5) : []), ...ccsInText(m.name + " " + m.place)]));
    const cats = Object.entries(m.cats).filter(([, n]) => n > 0).map(([k, n]) => Math.round(n) + " " + k.toLowerCase()).join(", ");
    const base = { title: "UN peacekeeping: " + m.acr + " (" + m.name + ")" + (m.total ? ", about " + Math.round(m.total).toLocaleString("en-US") + " personnel" : ""),
      detail: "Headquarters: " + (m.place || "not given") + "." + (cats ? " Average strength for the budget period to " + m.period + ": " + cats + "." : ""),
      date: m.period ? m.period + "T00:00:00Z" : "", lat: m.lat, lon: m.lon, url: "https://peacekeeping.un.org/en/where-we-operate", sev: 1, kind: "UN peacekeeping mission", value: m.total ? Math.round(m.total) : null, ccs };
    const d = deaths[m.acr], out = [base];
    if (d && d.n) out.push({ title: "UN peacekeeping fatalities, " + m.acr + ": " + d.n + " in the last 12 months" + (d.malicious ? " (" + d.malicious + " by malicious act)" : ""),
      detail: "By cause: " + Object.entries(d.causes).map(([k, n]) => n + " " + k.toLowerCase()).join(", ") + ". Latest on " + d.last + ". UN DPO fatality records (no names).",
      date: d.last + "T00:00:00Z", lat: m.lat, lon: m.lon, url: "https://peacekeeping.un.org/en/peacekeeping-fatalities", sev: d.malicious ? 2 : 1, kind: "UN peacekeeping fatalities", value: d.n, ccs });
    return out;
  }).filter((x) => x.ccs.length);
  return { items, globals: items.filter((x) => x.kind === "UN peacekeeping mission"), note: ms.length + " active missions, " + Object.values(deaths).reduce((a, d) => a + d.n, 0) + " fatalities in 12 months" };
});

// ---------------------------------------------------------------- satellite overflights (CelesTrak)
// Public orbital elements (GP, CelesTrak) for military, radar-calibration and Earth-resources satellites, propagated here with
// a two-body orbit plus the J2 drift of node and perigee and the published decay rate. Checked against SGP4 (satellite.js): about 1 minute along
// the track a day after the element epoch: enough to say which satellites pass over a country and when, not where exactly. Sub-satellite point only;
// imaging swaths are wider than that.
feed("sat-pass", { name: "Reconnaissance and imaging satellites passing over (next 12 hours, approximate)", org: "CelesTrak orbital elements; OSAP propagation", cat: "Security",
  lic: "CelesTrak data: free use with credit (orbital data from U.S. Space Force via space-track.org)", url: "https://celestrak.org/NORAD/elements/", everyHours: 3 });
const MU = 398600.4418, RE = 6378.137, J2 = 1.08262668e-3, D2R = Math.PI / 180;
/** Sub-satellite latitude/longitude (degrees) of one GP record at time t (ms). */
export function subPoint(gp, t) {
  const ep = Date.parse(gp.EPOCH + (/[zZ]$/.test(gp.EPOCH) ? "" : "Z")), dt = (t - ep) / 1000;
  const n0 = (gp.MEAN_MOTION * 2 * Math.PI) / 86400, a = Math.cbrt(MU / (n0 * n0)), e = gp.ECCENTRICITY, i = gp.INCLINATION * D2R;
  const p = a * (1 - e * e), k = 1.5 * J2 * (RE / p) ** 2 * n0;
  const raan = gp.RA_OF_ASC_NODE * D2R - k * Math.cos(i) * dt, argp = gp.ARG_OF_PERICENTER * D2R + k * (2 - 2.5 * Math.sin(i) ** 2) * dt;
  const M = gp.MEAN_ANOMALY * D2R + (n0 + k * Math.sqrt(1 - e * e) * (1 - 1.5 * Math.sin(i) ** 2)) * dt;
  const Md = M + 2 * Math.PI * (gp.MEAN_MOTION_DOT || 0) * (dt / 86400) ** 2;   // drag: MEAN_MOTION_DOT is half the rate of change, rev/day²
  let E = Md; for (let j = 0; j < 8; j++) E = E - (E - e * Math.sin(E) - Md) / (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), u = argp + nu;
  const x = Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(i), y = Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(i), z = Math.sin(u) * Math.sin(i);
  const jd = t / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const gmst = ((280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T) % 360) * D2R;
  let lon = (Math.atan2(y, x) - gmst) / D2R; lon = ((lon + 540) % 360) - 180;
  return [Math.asin(z) / D2R, lon];
}
const SAT_GROUPS = [["military", "Military"], ["radar", "Radar calibration"], ["resource", "Earth resources / imaging"]];
run("sat-pass", async (g) => {
  const sats = [];
  for (const [grp, label] of SAT_GROUPS) {
    try { for (const s of await g("https://celestrak.org/NORAD/elements/gp.php?GROUP=" + grp + "&FORMAT=json")) if (s.MEAN_MOTION > 11 && s.MEAN_MOTION < 17 && Date.now() - Date.parse(s.EPOCH + "Z") < 3 * 864e5) sats.push({ ...s, label }); }
    catch (e) { console.error("sat-pass: " + grp + " " + e.message); }
    await sleep(300);
  }
  if (!sats.length) throw new Error("no orbital elements from CelesTrak");
  const t0 = Date.now(), STEP = 60e3, N = 12 * 60, passes = {};   // country -> name -> first time over it
  for (const s of sats) {
    let last = null;
    for (let k = 0; k < N; k++) {
      const t = t0 + k * STEP, [la, lo] = subPoint(s, t), cc = ccsAt(la, lo, 0)[0] || null;
      if (cc && cc !== last) { const pc = passes[cc] || (passes[cc] = {}); (pc[s.OBJECT_NAME] = pc[s.OBJECT_NAME] || { t, la, lo, label: s.label, n: 0 }).n++; }
      last = cc;
    }
  }
  const hhmm = (t) => new Date(t).toISOString().slice(11, 16) + "Z";
  const items = Object.entries(passes).map(([cc, by]) => {
    const list = Object.entries(by).sort((a, b) => a[1].t - b[1].t), mil = list.filter(([, v]) => v.label === "Military");
    const first = list[0][1];
    return { title: list.length + " reconnaissance or imaging satellites over the country in the next 12 hours" + (mil.length ? " (" + mil.length + " military)" : ""),
      detail: "First passes (sub-satellite point, approximate): " + list.slice(0, 12).map(([n, v]) => n + " " + hhmm(v.t)).join("; ") + (list.length > 12 ? "; and " + (list.length - 12) + " more" : "") + ". From public CelesTrak orbital elements; timings within a few minutes.",
      date: new Date(t0).toISOString(), lat: first.la, lon: first.lo, url: "https://celestrak.org/NORAD/elements/", sev: mil.length >= 5 ? 2 : 1, kind: "Satellite overflights", value: list.length, ccs: withOki([cc]) };
  });
  return { items, note: sats.length + " satellites propagated over 12 hours; " + items.length + " countries overflown" };
});

// ---------------------------------------------------------------- EU sanctions regimes (EU Sanctions Map)
// The EU's consolidated list file (webgate.ec.europa.eu/fsd/fsf) answered HTTP 500 to every token on 8 Nov 2026, from the
// runners. The EU Sanctions Map's public API lists every regime with its target country (ISO alpha-3 "programme"), last
// amendment and expiry: one item per regime and country. Thematic regimes (terrorism, cyber, human rights) name no country
// and are left out. Retry the list file later for the named persons and entities.
feed("eu-regimes", { name: "EU sanctions regimes by country (EU Sanctions Map)", org: "Council of the European Union / European Commission, EU Sanctions Map", cat: "Sanctions",
  lic: "EU institutions' reuse policy (reuse allowed with credit)", url: "https://www.sanctionsmap.eu/", everyHours: 24 });
/** One regime record into items (one per target country). */
export function euRegimeItems(r, now) {
  const progs = Array.isArray(r.programme) ? r.programme : [], amend = +r.amendment ? new Date(+r.amendment * 1000) : null, exp = +r.expiration ? new Date(+r.expiration * 1000) : null;
  const measures = (((r.measures || {}).data) || []).map((m) => (m && (m.type && m.type.data && m.type.data.title)) || (m && (m.title || m.name)) || "").filter(Boolean);
  const ccs = withOki(uniq(progs.map((a) => ccFromA3(a))));
  if (!ccs.length) return [];
  const recent = amend && now - amend.getTime() < 30 * 864e5;
  return [{ title: "EU sanctions: " + String(r.specification || "").trim() + (recent ? " (amended " + day(amend) + ")" : ""),
    detail: [amend ? "Last amended " + day(amend) + "." : "", exp ? "In force until " + day(exp) + "." : "", measures.length ? "Measures: " + uniq(measures).join(", ") + "." : "",
      (((r.legal_acts || {}).data) || []).length + " legal acts."].filter(Boolean).join(" "),
    date: amend ? amend.toISOString() : "", url: "https://www.sanctionsmap.eu/#/main/details/" + r.id + "/", sev: recent ? 2 : 1, kind: "EU sanctions regime", ccs }];
}
run("eu-regimes", async (g) => {
  const j = await g("https://www.sanctionsmap.eu/api/v1/regime");
  const list = j.data || [];
  if (!list.length) throw new Error("no regimes in the reply");
  const items = list.flatMap((r) => euRegimeItems(r, Date.now()));
  return { items, note: list.length + " regimes, " + items.length + " naming a country" };
});
