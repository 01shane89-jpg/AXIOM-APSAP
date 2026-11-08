// New open feeds of 8 Nov 2026 (owner: "Do it all"), registered into the dense open-data run (tools/refresh_dense.mjs).
// Every source was probed from GitHub Actions first (tools/probe_dense.mjs on claude/one-source-probe). No keys, no accounts.
//   portwatch-choke  IMF PortWatch daily transits through 28 maritime chokepoints (7-day average vs the 4 weeks before)
//   portwatch-disrupt IMF PortWatch events that hit ports (affected ports named by PortWatch)
//   rfj              U.S. State Department Rewards for Justice offers, by the country each offer names
//   vaac             Volcanic ash advisories of the Tokyo and Washington VAACs (latest per volcano, last 48 hours)
//   unsc-press       UN Security Council meetings coverage and press statements (headline and link only)
// Licences are in each feed's "lic". IMF terms and UN press copyright are not clearly open for commercial reuse, so those
// feeds are nc:true (dropped in the sold version, tools/nc_strip.mjs) until checked.
import { feed, run, unhtml, rssItems, sleep } from "./dense_lib.mjs";
import { ccsAt, ccFromName, ccFromA3, ccsInText, withOki } from "./geo_cc.mjs";

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
  for (const [who, u] of uniq(links.map((l) => l.join("|"))).map((s) => s.split("|")).slice(0, 50)) {
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
