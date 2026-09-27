// Road closures and major road events from official, free, no-key road-agency feeds (run by .github/workflows/refresh-flood.yml).
// Writes data/live/roads.js (window.ASAP_ROADS). Every item is the agency's own notice, shown as received.
// Coverage is only where an agency publishes an open feed; the page says so for every other country.
//   nz  NZ Transport Agency Waka Kotahi, Journeys delays feed (CC BY 4.0)
//   fr  Bison Fute / DIR national road events, DATEX II (Licence Ouverte 2.0)
//   au  Main Roads Western Australia road incidents (Western Australia only; CC BY 4.0)
//   ca  DriveBC Open511 events (British Columbia only; Open Government Licence - British Columbia)
//   fi  Fintraffic Digitraffic traffic announcements (CC BY 4.0)
// One source failing keeps its previous items and is reported in the status list.
// PROBE=1 prints one raw item per source and writes nothing.
import fs from "node:fs";

const TIMEOUT = 45000, UA = "AXIOM-OSAP/1.0 (situational awareness; github.com/01shane89-jpg/AXIOM-APSAP)";
const PROBE = !!process.env.PROBE;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const err = (e) => (e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 140));
const MAX_PER_SOURCE = 400;

async function get(url, as = "json") {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "*/*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return as === "json" ? await r.json() : (await r.text()).slice(0, 40e6);
  } finally { clearTimeout(t); }
}
const clean = (s) => String(s == null ? "" : s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
const isoMin = (d) => { if (!d) return ""; const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };
// first lon/lat pair anywhere in a GeoJSON geometry; null unless it is a plausible WGS84 position
function firstPos(g) {
  let c = g && g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (!Array.isArray(c) || c.length < 2) return null;
  const lon = +c[0], lat = +c[1];
  return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5] : null;
}
// closure = the road is shut; otherwise roadworks or incident (delays, lane closures, hazards)
function kindOf(text) {
  const t = String(text).toLowerCase();
  if (/road closed|closed to (all )?traffic|\bclosure\b|\bclosed\b|fermée|fermeture|coupée|suljettu|roadclosed|carriagewayclosures|road_closed/.test(t)) return "closure";
  if (/roadworks?|road work|construction|maintenance|travaux|tietyö|roadmaintenance/.test(t)) return "roadworks";
  return "incident";
}
function probe(name, x) { if (PROBE) console.log("--- " + name + " sample:\n" + JSON.stringify(x, null, 1).slice(0, 2500)); }

const SOURCES = {
  nz: { name: "NZ Transport Agency Waka Kotahi", licence: "CC BY 4.0", area: "New Zealand, state highways",
    async run() {
      const j = await get("https://www.journeys.nzta.govt.nz/assets/map-data-cache/delays.json");
      probe("nz", j.features && j.features[0]);
      return (j.features || []).map((f) => {
        const p = f.properties || {}, pos = firstPos(f.geometry);
        const what = clean(p.EventType || p.Impact || "");
        return { cc: "nz", id: "nz-" + (p.ID || p.Id || p.EventId || p.LocationArea + p.StartDate), title: clean([what, p.LocationArea].filter(Boolean).join(": ")),
          detail: clean(p.EventDescription || p.EventComments || p.Description || ""), kind: kindOf(what + " " + (p.Impact || "")),
          start: isoMin(p.StartDate || p.Created), end: isoMin(p.ExpectedResolution || p.EndDate), updated: isoMin(p.LastEdited),
          lat: pos && pos[0], lon: pos && pos[1], link: "https://www.journeys.nzta.govt.nz/highway-conditions" };
      });
    } },
  fr: { name: "Bison Futé (DIR national roads)", licence: "Licence Ouverte 2.0", area: "France, national road network",
    async run() {
      const x = await get("https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN/content.xml", "text");
      const recs = x.split(/<(?:\w+:)?situationRecord\b/).slice(1);
      probe("fr", recs[0] && recs[0].slice(0, 2500));
      const tag = (s, n) => { const m = s.match(new RegExp("<(?:\\w+:)?" + n + "\\b[^>]*>([^<]*)<")); return m ? m[1] : ""; };
      return recs.map((r) => {
        const type = (r.match(/xsi:type="(?:\w+:)?(\w+)"/) || [])[1] || "";
        const mgmt = tag(r, "roadOrCarriagewayOrLaneManagementType") || tag(r, "roadMaintenanceType") || tag(r, "accidentType") || tag(r, "obstructionType") || "";
        const road = tag(r, "roadNumber"), comment = clean((r.match(/<(?:\w+:)?generalPublicComment\b[\s\S]*?<(?:\w+:)?value\b[^>]*>([^<]*)</) || [])[1] || "");
        const lat = parseFloat(tag(r, "latitude")), lon = parseFloat(tag(r, "longitude"));
        const what = mgmt || type.replace(/([a-z])([A-Z])/g, "$1 $2");
        return { cc: "fr", id: "fr-" + ((r.match(/^[^>]*\bid="([^"]+)"/) || [])[1] || road + lat + lon), title: clean([what, road].filter(Boolean).join(": ")), detail: comment,
          kind: kindOf(type + " " + mgmt + " " + comment), start: isoMin(tag(r, "overallStartTime")), end: isoMin(tag(r, "overallEndTime")),
          updated: isoMin(tag(r, "situationRecordVersionTime")), lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null,
          link: "https://www.bison-fute.gouv.fr/" };
      });
    } },
  au: { name: "Main Roads Western Australia", licence: "CC BY 4.0", area: "Australia: Western Australia only",
    async run() {
      const j = await get("https://services2.arcgis.com/cHGEnmsJ165IBJRM/arcgis/rest/services/WebEoc_RoadIncidents/FeatureServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=geojson");
      probe("au", j.features && j.features[0]);
      return (j.features || []).map((f) => {
        const p = f.properties || {}, pos = firstPos(f.geometry), keys = Object.keys(p);
        const pick = (re) => { const k = keys.find((k) => re.test(k)); return k ? p[k] : ""; };
        const what = clean(pick(/type|category|status/i)), where = clean(pick(/road|location|name/i));
        return { cc: "au", id: "au-" + (p.FID || p.OBJECTID || where + what), title: clean([what, where].filter(Boolean).join(": ")) || "Road incident",
          detail: clean(pick(/desc|comment|detail/i)), kind: kindOf(what + " " + pick(/desc|comment|detail/i)),
          start: isoMin(pick(/start|created|date/i)), end: isoMin(pick(/end|expire|resol/i)), updated: isoMin(pick(/edit|update/i)),
          lat: pos && pos[0], lon: pos && pos[1], link: "https://travelmap.mainroads.wa.gov.au/" };
      });
    } },
  ca: { name: "DriveBC (Open511)", licence: "Open Government Licence – British Columbia", area: "Canada: British Columbia only",
    async run() {
      const j = await get("https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&limit=500");
      probe("ca", j.events && j.events[0]);
      return (j.events || []).map((e) => {
        const pos = firstPos(e.geography), roads = (e.roads || []).map((r) => r.name).filter(Boolean).join(", ");
        const closed = (e.roads || []).some((r) => /CLOSED/i.test(r.state || ""));
        return { cc: "ca", id: "ca-" + e.id, title: clean([e.event_type && String(e.event_type).replace(/_/g, " ").toLowerCase(), roads].filter(Boolean).join(": ")),
          detail: clean(e.description), kind: closed ? "closure" : kindOf((e.event_type || "") + " " + (e.headline || "")),
          start: isoMin(e.schedule && e.schedule.intervals && String(e.schedule.intervals[0] || "").split("/")[0] || e.created), end: "",
          updated: isoMin(e.updated), lat: pos && pos[0], lon: pos && pos[1], link: "https://www.drivebc.ca/" };
      });
    } },
  fi: { name: "Fintraffic Digitraffic", licence: "CC BY 4.0", area: "Finland",
    async run() {
      const out = [];
      for (const t of ["TRAFFIC_ANNOUNCEMENT", "ROAD_WORK", "EXEMPTED_TRANSPORT"].slice(0, 2)) {
        const j = await get("https://tie.digitraffic.fi/api/traffic-message/v1/messages?inactiveHours=0&includeAreaGeometry=false&situationType=" + t);
        probe("fi " + t, j.features && j.features[0] && { ...j.features[0], geometry: undefined });
        for (const f of j.features || []) {
          const p = f.properties || {}, a = (p.announcements || [])[0] || {}, pos = firstPos(f.geometry);
          const feats = (a.features || []).map((x) => x.name).join(", ");
          out.push({ cc: "fi", id: "fi-" + p.situationId, title: clean(a.title || t.replace(/_/g, " ").toLowerCase()), detail: clean([a.location && a.location.description, feats].filter(Boolean).join(". ")),
            kind: t === "ROAD_WORK" ? (/closed|suljettu/i.test(feats) ? "closure" : "roadworks") : kindOf((a.title || "") + " " + feats),
            start: isoMin(a.timeAndDuration && a.timeAndDuration.startTime), end: isoMin(a.timeAndDuration && a.timeAndDuration.endTime),
            updated: isoMin(p.releaseTime || p.versionTime), lat: pos && pos[0], lon: pos && pos[1], link: "https://liikennetilanne.fintraffic.fi/" });
        }
      }
      return out;
    } }
};

const FILE = "data/live/roads.js";
let prev = { items: [], status: [] };
try { prev = JSON.parse(fs.readFileSync(FILE, "utf8").replace(/^window\.ASAP_ROADS=/, "").replace(/;\s*$/, "")); } catch (e) {}
const items = [], status = [];
for (const [cc, s] of Object.entries(SOURCES)) {
  try {
    const got = (await s.run()).filter((i) => i.title).sort((a, b) => (a.kind === "closure" ? 0 : 1) - (b.kind === "closure" ? 0 : 1)).slice(0, MAX_PER_SOURCE);
    items.push(...got);
    status.push({ cc, source: s.name, licence: s.licence, area: s.area, ok: true, n: got.length, closures: got.filter((i) => i.kind === "closure").length });
    console.log(cc, s.name, got.length, "items,", got.filter((i) => i.kind === "closure").length, "closures,", got.filter((i) => i.lat != null).length, "located");
    if (PROBE) console.log(JSON.stringify(got.slice(0, 2)));
  } catch (e) {
    const old = (prev.items || []).filter((i) => i.cc === cc);
    items.push(...old);
    status.push({ cc, source: s.name, licence: s.licence, area: s.area, ok: false, n: old.length, error: err(e) });
    console.log(cc, s.name, "FAILED", err(e), "- kept", old.length);
  }
}
if (!PROBE) {
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync(FILE, "window.ASAP_ROADS=" + JSON.stringify({ asof: stamp, status, items }).replace(/<\//g, "<\\/") + ";\n");
  console.log("wrote", FILE, items.length, "items");
}
