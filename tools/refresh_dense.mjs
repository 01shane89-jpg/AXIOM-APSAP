// Dense open-data layer: every free, no-login feed that proved reachable from GitHub Actions (probe: tools/probe_dense.mjs),
// for every country in the page. Run by .github/workflows/refresh-flood.yml (only=dense runs just this), or by hand with Node 20+.
// Output and failure handling: see tools/dense_lib.mjs. Licence of each feed is in its metadata ("lic"); feeds marked nc:true are
// non-commercial or otherwise restricted, so they can be stripped in one pass if the app is ever sold.
// Rules kept: no accounts or keys; no private individuals' names (sanctions lists name only sanctioned people and bodies);
// sequential requests to any one host; slow-changing sources fetched at most every few hours or once a day.
import { get, unhtml, isoMin, ageDays, csvRows, csvObjects, rssItems, feed, run, runAll, writeAll, sleep } from "./dense_lib.mjs";
import "./thinktanks.mjs";
import { COUNTRIES, ccsAt, ccFromName, ccFromA2, ccFromA3, ccsInText, withOki } from "./geo_cc.mjs";

const IDS = COUNTRIES.map((c) => c.id);
const pt = (g) => { // first point of a GeoJSON geometry (or the centre of its first ring)
  if (!g) return [null, null];
  if (g.type === "Point") return [g.coordinates[1], g.coordinates[0]];
  if (g.type === "GeometryCollection") { const p = (g.geometries || []).find((x) => x.type === "Point") || (g.geometries || [])[0]; return pt(p); }
  const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : g.type === "LineString" ? g.coordinates : g.type === "MultiLineString" ? g.coordinates[0] : null;
  if (!ring || !ring.length) return [null, null];
  const n = ring.length; return [ring.reduce((a, c) => a + c[1], 0) / n, ring.reduce((a, c) => a + c[0], 0) / n];
};
const pick = (o, ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return null; };
const within = (d, days) => d && ageDays(d) <= days;
const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
const round = (v, n = 1) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);
const one = (cc) => (cc ? withOki([cc]) : []);
const G = "Global";

// ---------------------------------------------------------------- hazards
feed("emsc", { name: "EMSC earthquakes (M2.5+, 2 days)", org: "European-Mediterranean Seismological Centre", cat: "Hazards", lic: "CC BY 4.0", url: "https://www.seismicportal.eu/" });
run("emsc", async (g) => {
  const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const j = await g("https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=2000&minmag=2.5&start=" + since);
  return { items: j.features.map((f) => { const p = f.properties; return { title: "M" + p.mag + " " + (p.magtype || "") + " · " + (p.flynn_region || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    detail: "Depth " + p.depth + " km. Automatic or reviewed EMSC solution.", date: p.time, lat: p.lat, lon: p.lon, url: "https://www.seismicportal.eu/eventdetails.html?unid=" + p.unid,
    sev: p.mag >= 6 ? 3 : p.mag >= 4.5 ? 2 : 1, kind: "Earthquake", value: p.mag, ccs: withOki(ccsAt(p.lat, p.lon, 1.5)) }; }) };
});

feed("nws", { name: "US National Weather Service alerts", org: "NOAA NWS", cat: "Hazards", lic: "US Government public domain", url: "https://www.weather.gov/alerts" });
run("nws", async (g) => {
  const j = await g("https://api.weather.gov/alerts/active?status=actual&message_type=alert,update", "json", { headers: { accept: "application/geo+json" } });
  const sev = { Extreme: 3, Severe: 3, Moderate: 2, Minor: 1 };
  return { items: j.features.map((f) => { const p = f.properties, [la, lo] = pt(f.geometry);
    return { title: p.event + " · " + (p.areaDesc || "").slice(0, 120), detail: (p.headline || "") + (p.instruction ? " " + p.instruction.slice(0, 300) : ""), date: p.sent || p.effective,
      lat: la, lon: lo, url: p["@id"] || "https://alerts.weather.gov/", sev: sev[p.severity] || 1, kind: "Weather alert", ccs: ["us"] }; }).sort((a, b) => b.sev - a.sev) };
});

feed("nhc", { name: "NOAA National Hurricane Center active storms", org: "NOAA NHC", cat: "Hazards", lic: "US Government public domain", url: "https://www.nhc.noaa.gov/" });
run("nhc", async (g) => {
  const j = await g("https://www.nhc.noaa.gov/CurrentStorms.json");
  const items = (j.activeStorms || []).map((s) => ({ title: s.classification + " " + s.name + " · " + s.intensity + " kt, " + s.pressure + " hPa",
    detail: "Moving " + (s.movementDir != null ? s.movementDir + "° " : "") + (s.movementSpeed != null ? "at " + s.movementSpeed + " kt" : ""), date: s.lastUpdate,
    lat: s.latitudeNumeric, lon: s.longitudeNumeric, url: (s.publicAdvisory && s.publicAdvisory.url) || "https://www.nhc.noaa.gov/", sev: /HU|MH/.test(s.classification) ? 3 : 2,
    kind: "Tropical cyclone", ccs: ccsAt(s.latitudeNumeric, s.longitudeNumeric, 8) }));
  return { items, globals: items.map((x) => ({ ...x, ccs: undefined })) };
});

feed("pdc", { name: "Pacific Disaster Center active hazards", org: "Pacific Disaster Center (University of Hawaii)", cat: "Hazards", lic: "Public feed; PDC terms, attribution", nc: true, url: "https://www.pdc.org/" });
run("pdc", async (g) => {
  const xml = await g("https://hpxml.pdc.org/public.xml", "text");
  const items = xml.split("<hazardBean>").slice(1).map((b) => {
    const t = (k) => { const m = b.match(new RegExp("<" + k + ">([^<]*)</" + k + ">")); return m ? unhtml(m[1]) : ""; };
    const la = num(t("latitude")), lo = num(t("longitude")), cd = t("last_Update") || t("create_Date"), d = /^\d{10,}$/.test(cd) ? new Date(+cd).toISOString() : cd;
    return { title: (t("hazard_Name") || t("type_ID")) + " · " + t("severity_ID"), detail: [t("category_ID"), t("type_ID"), t("status")].filter(Boolean).join(" · "), date: d,
      lat: la, lon: lo, url: "https://disasteraware.pdc.org/", sev: /WARNING/i.test(t("severity_ID")) ? 3 : /WATCH/i.test(t("severity_ID")) ? 2 : 1, kind: "Hazard (" + t("type_ID").toLowerCase().replace(/_/g, " ") + ")",
      ccs: withOki(ccsAt(la, lo, 1)) };
  }).filter((x) => !/EXPIRED|INACTIVE/i.test(x.detail));
  return { items };
});

feed("firms", { name: "NASA FIRMS fire detections (VIIRS NOAA-20, 24 h)", org: "NASA LANCE FIRMS", cat: "Hazards", lic: "NASA open data, no restrictions (attribution requested)", url: "https://firms.modaps.eosdis.nasa.gov/" });
run("firms", async (g) => {
  let txt = null, fails = [];
  for (const u of ["https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv"]) {
    try { txt = await get(u, "text", { timeout: 150000 }); break; } catch (e) { fails.push(u.split("/").pop() + ": " + (e.cause && e.cause.code || e.message)); await sleep(15000); } }
  if (!txt) throw new Error(fails.join("; "));
  const lines = txt.split("\n"), h = lines[0].split(","), ix = (k) => h.indexOf(k);
  const iLa = ix("latitude"), iLo = ix("longitude"), iF = ix("frp"), iD = ix("acq_date"), iT = ix("acq_time"), iC = ix("confidence");
  const cells = new Map();   // 0.2° cells: sum of fire radiative power and count
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(","); if (c.length < h.length) continue;
    const la = +c[iLa], lo = +c[iLo], k = Math.round(la * 5) + ":" + Math.round(lo * 5);
    const e = cells.get(k) || { la: 0, lo: 0, n: 0, frp: 0, t: "", hi: 0 };
    e.la += la; e.lo += lo; e.n++; e.frp += +c[iF] || 0; if (c[iC] === "h") e.hi++;
    const t = c[iD] + "T" + String(c[iT]).padStart(4, "0").replace(/(\d\d)(\d\d)/, "$1:$2"); if (t > e.t) e.t = t;
    cells.set(k, e);
  }
  const figures = {}, items = [];
  for (const e of cells.values()) {
    const la = e.la / e.n, lo = e.lo / e.n, ccs = withOki(ccsAt(la, lo, 0.3));
    for (const cc of ccs) { const f = (figures[cc] = figures[cc] || { detections: 0, frp_mw: 0 }); f.detections += e.n; f.frp_mw = Math.round(f.frp_mw + e.frp); }
    items.push({ title: e.n + " fire detection" + (e.n > 1 ? "s" : "") + ", " + Math.round(e.frp) + " MW radiative power", detail: e.hi + " high-confidence. Heat detections include wildfires, field burning, gas flares and industry.",
      date: e.t, lat: la, lon: lo, url: "https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@" + lo.toFixed(2) + "," + la.toFixed(2) + ",9z", sev: e.frp > 500 ? 3 : e.frp > 100 ? 2 : 1, kind: "Fire / heat", value: Math.round(e.frp), ccs });
  }
  items.sort((a, b) => b.value - a.value);
  return { items, figures, note: lines.length - 1 + " detections in " + cells.size + " cells" };
});

feed("cems", { name: "Copernicus EMS rapid mapping activations", org: "European Commission, Copernicus Emergency Management Service", cat: "Hazards", lic: "Copernicus free and open (attribution)", url: "https://rapidmapping.emergency.copernicus.eu/" });
run("cems", async (g) => {
  const j = await g("https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=100");
  return { items: (j.results || []).map((a) => {
    const names = [].concat(a.countries || a.country || []).map((c) => (typeof c === "string" ? c : c.name || c.short_name || "")).join(", ");
    const ccs = [...new Set([...[].concat(a.countries || []).map((c) => ccFromA3(c.iso3 || c.iso_code || c.code) || ccFromA2(c.iso2) || ccFromName(c.name || c)), ...ccsInText(names + " " + (a.name || ""))].filter(Boolean))];
    const [la, lo] = a.centroid ? pt(typeof a.centroid === "string" ? null : a.centroid) : [null, null];
    return { title: (a.code || "") + " " + (a.name || a.eventName || "activation"), detail: [a.category || a.hazard, names, a.closed ? "closed" : "open"].filter(Boolean).join(" · "),
      date: a.activationTime || a.eventTime || a.activation_time, lat: la, lon: lo, url: "https://rapidmapping.emergency.copernicus.eu/" + (a.code || ""), sev: a.closed ? 1 : 2, kind: "Satellite mapping activation", ccs: withOki(ccs) };
  }).filter((x) => within(x.date, 120)) };
});

feed("meteoalarm", { name: "Meteoalarm European weather warnings", org: "EUMETNET (national weather services)", cat: "Hazards", lic: "Public feed; redistribution normally needs an EUMETNET agreement", nc: true, url: "https://meteoalarm.org/" });
run("meteoalarm", async (g) => {
  const C = ["austria", "belgium", "bosnia-herzegovina", "bulgaria", "croatia", "cyprus", "czechia", "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "iceland", "ireland",
    "israel", "italy", "latvia", "lithuania", "luxembourg", "malta", "moldova", "montenegro", "netherlands", "north-macedonia", "norway", "poland", "portugal", "romania", "serbia", "slovakia",
    "slovenia", "spain", "sweden", "switzerland", "ukraine", "united-kingdom"];
  const alias = { "bosnia-herzegovina": "ba", "north-macedonia": "mk", "united-kingdom": "gb", czechia: "cz", moldova: "md" };
  const items = [], fails = [];
  for (const c of C) {
    const cc = alias[c] || ccFromName(c.replace(/-/g, " ")); if (!cc) continue;
    try {
      if (fails.length >= 4 && !items.length) break;
      const xml = await g("https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-" + c, "text", { timeout: 15000 });
      for (const e of xml.split("<entry>").slice(1)) {
        const t = (k) => { const m = e.match(new RegExp("<" + k + "[^>]*>([\\s\\S]*?)</" + k + ">")); return m ? unhtml(m[1]) : ""; };
        const sevT = t("cap:severity"); if (/minor/i.test(sevT) && !/red|orange/i.test(t("title"))) continue;
        items.push({ title: t("cap:event") + " · " + t("cap:areaDesc"), detail: [t("cap:severity"), t("cap:certainty"), "from " + t("cap:onset").replace("T", " "), "to " + t("cap:expires").replace("T", " ")].join(" · "),
          date: t("cap:sent") || t("updated"), url: (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "https://meteoalarm.org/", sev: /extreme/i.test(sevT) ? 3 : /severe/i.test(sevT) ? 3 : 2, kind: "Weather warning", ccs: [cc] });
      }
    } catch (e) { fails.push(c); }
    await sleep(300);
  }
  if (!items.length && fails.length === C.length) throw new Error("all countries failed");
  return { items, note: fails.length ? "failed: " + fails.join(", ") : "" };
});

feed("dwd", { name: "Deutscher Wetterdienst warnings", org: "Deutscher Wetterdienst", cat: "Hazards", lic: "DWD open data (GeoNutzV), attribution", url: "https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html" });
run("dwd", async (g) => {
  const t = await g("https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json", "text");
  const j = JSON.parse(t.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, ""));
  const items = []; for (const arr of Object.values(j.warnings || {})) for (const w of arr) if (w.level >= 2)
    items.push({ title: (w.event || w.headline) + " · " + w.regionName, detail: (w.description || "").slice(0, 300), date: new Date(w.start).toISOString(), url: "https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html",
      sev: w.level >= 4 ? 3 : w.level >= 3 ? 2 : 1, kind: "Weather warning (German)", ccs: ["de"] });
  return { items: items.sort((a, b) => b.sev - a.sev) };
});

feed("ea-flood", { name: "UK Environment Agency flood warnings (England)", org: "Environment Agency", cat: "Hazards", lic: "Open Government Licence v3", url: "https://check-for-flooding.service.gov.uk/" });
run("ea-flood", async (g) => {
  const j = await g("https://environment.data.gov.uk/flood-monitoring/id/floods");
  return { items: (j.items || []).filter((f) => f.severityLevel < 4).map((f) => ({ title: f.severity + " · " + f.description, detail: (f.message || "").slice(0, 400) + (f.floodArea ? " (" + [f.floodArea.county, f.floodArea.riverOrSea].filter(Boolean).join(", ") + ")" : ""),
    date: f.timeMessageChanged || f.timeRaised, url: "https://check-for-flooding.service.gov.uk/target-area/" + (f.floodAreaID || ""), sev: f.severityLevel === 1 ? 3 : f.severityLevel === 2 ? 2 : 1, kind: "Flood warning", ccs: ["gb"] })) };
});

feed("geonet", { name: "GeoNet earthquakes and volcano alert levels", org: "GNS Science / GeoNet", cat: "Hazards", lic: "CC BY 4.0", url: "https://www.geonet.org.nz/" });
run("geonet", async (g) => {
  const q = await g("https://api.geonet.org.nz/quake?MMI=3", "json", { headers: { accept: "application/vnd.geo+json;version=2" } });
  const v = await g("https://api.geonet.org.nz/volcano/val", "json", { headers: { accept: "application/vnd.geo+json;version=2" } });
  const items = (q.features || []).map((f) => { const p = f.properties, [la, lo] = pt(f.geometry);
    return { title: "M" + (+p.magnitude).toFixed(1) + " · " + p.locality, detail: "Depth " + Math.round(p.depth) + " km, MMI " + p.mmi + ", " + p.quality, date: p.time, lat: la, lon: lo,
      url: "https://www.geonet.org.nz/earthquake/" + p.publicID, sev: p.mmi >= 6 ? 3 : p.mmi >= 4 ? 2 : 1, kind: "Earthquake", value: +(+p.magnitude).toFixed(1), ccs: ccsAt(la, lo, 3).concat("nz").filter((x, i, a) => a.indexOf(x) === i) }; });
  for (const f of v.features || []) { const p = f.properties, [la, lo] = pt(f.geometry);
    if (p.level >= 1) items.push({ title: p.volcanoTitle + ": volcanic alert level " + p.level, detail: [p.activity, p.hazards].filter(Boolean).join(". "), date: new Date().toISOString(), lat: la, lon: lo,
      url: "https://www.geonet.org.nz/volcano/" + p.volcanoID, sev: p.level >= 3 ? 3 : 2, kind: "Volcano alert level", ccs: ["nz"] }); }
  return { items };
});

feed("ga-quake", { name: "Geoscience Australia earthquakes (7 days)", org: "Geoscience Australia", cat: "Hazards", lic: "CC BY 4.0", url: "https://earthquakes.ga.gov.au/" });
run("ga-quake", async (g) => {
  const j = await g("https://earthquakes.ga.gov.au/geoserver/earthquakes/wfs?service=WFS&request=getfeature&typeNames=earthquakes:earthquakes_seven_days&outputFormat=application/json");
  return { items: (j.features || []).map((f) => { const p = f.properties, [la, lo] = pt(f.geometry), m = num(pick(p, ["preferred_magnitude", "magnitude", "mag"]));
    return { title: "M" + (m != null ? m.toFixed(1) : "?") + " · " + (pick(p, ["description", "located_in", "region"]) || ""), detail: "Depth " + Math.round(num(pick(p, ["depth", "preferred_depth"])) || 0) + " km",
      date: pick(p, ["origin_time", "epicentral_time", "time"]), lat: la, lon: lo, url: "https://earthquakes.ga.gov.au/event/" + pick(p, ["event_id", "id"]), sev: m >= 5 ? 3 : m >= 3.5 ? 2 : 1, kind: "Earthquake", value: round(m),
      ccs: ccsAt(la, lo, 1) }; }) };
});

feed("au-fire", { name: "Australian state fire and emergency incidents (NSW, Victoria, Queensland, WA)", org: "NSW RFS, Emergency Management Victoria, QFD, WA DFES", cat: "Hazards", lic: "State government open data (CC BY 4.0 where stated)", url: "https://www.rfs.nsw.gov.au/fire-information/fires-near-me" });
run("au-fire", async (g) => {
  const items = [], fails = [];
  const push = (title, detail, date, [la, lo], url, sev, kind) => items.push({ title, detail, date, lat: la, lon: lo, url, sev, kind, ccs: ["au"] });
  try { const j = await g("https://www.rfs.nsw.gov.au/feeds/majorIncidents.json");
    for (const f of j.features || []) { const p = f.properties, d = unhtml(p.description || ""); if (/TYPE: (Planned|Hazard Reduction)/i.test(d)) continue; const lvl = (d.match(/ALERT LEVEL:\s*([^:]+?)\s+[A-Z]{3,}:/) || [])[1] || "";
      push(p.title + (lvl ? " · " + lvl : ""), d.slice(0, 400), p.pubDate, pt(f.geometry), p.link || "https://www.rfs.nsw.gov.au/fire-information/fires-near-me", /emergency/i.test(lvl) ? 3 : /watch/i.test(lvl) ? 2 : 1, "Fire / incident (NSW)"); } } catch (e) { fails.push("NSW"); }
  try { const j = await g("https://emergency.vic.gov.au/public/events-geojson.json");
    for (const f of j.features || []) { const p = f.properties; if (p.feedType === "burn-area") continue;
      push([pick(p, ["sourceTitle", "name", "category2", "category1"]), p.location].filter(Boolean).join(" · "), [p.category1, p.category2, p.status, p.sourceOrg].filter(Boolean).join(" · "), pick(p, ["updated", "created"]),
        pt(f.geometry), p.url || "https://emergency.vic.gov.au/respond/", /emergency|evacuate/i.test(JSON.stringify(p)) ? 3 : /watch/i.test(p.category1 || "") ? 2 : 1, "Incident (Victoria)"); } } catch (e) { fails.push("VIC"); }
  try { const j = await g("https://publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/content/Feeds/BushfireCurrentIncidents/bushfireAlert.json");
    for (const f of j.features || []) { const p = f.properties;
      push([pick(p, ["WarningTitle", "Header", "WarningLevel", "Title"]), pick(p, ["Locality", "Location", "WarningArea"])].filter(Boolean).join(" · "), unhtml(pick(p, ["WarningText", "CallToAction", "Description"]) || "").slice(0, 300),
        pick(p, ["PublishDate", "ItemDateTimeLocal_ISO", "LastUpdate"]), pt(f.geometry), "https://www.fire.qld.gov.au/", /emergency/i.test(JSON.stringify(p)) ? 3 : 2, "Bushfire warning (Queensland)"); } } catch (e) { fails.push("QLD"); }
  try { const j = await g("https://api.emergency.wa.gov.au/v1/incidents");
    for (const inc of j.incidents || []) { const f = ((inc["geo-source"] || {}).features || [])[0] || {};
      push([pick(inc, ["name", "incident-type", "type"]), pick(inc, ["location", "suburbs", "lga"])].flat().filter(Boolean).join(" · ").slice(0, 200), [inc.status, inc["incident-type"], inc.size].filter(Boolean).join(" · "),
        pick(inc, ["updated-date-time", "created-date-time", "start-date-time"]), pt(f.geometry), "https://www.emergency.wa.gov.au/", 1, "Incident (WA)"); } } catch (e) { fails.push("WA"); }
  if (fails.length === 4) throw new Error("all four states failed");
  return { items, note: fails.length ? "failed: " + fails.join(", ") : "" };
});

feed("us-fire", { name: "US wildfires (CAL FIRE and NIFC)", org: "CAL FIRE; National Interagency Fire Center", cat: "Hazards", lic: "US/State government public data", url: "https://www.nifc.gov/" });
run("us-fire", async (g) => {
  const items = [], fails = [];
  try { const j = await g("https://www.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false");
    for (const f of j) items.push({ title: f.Name.trim() + " · " + (f.AcresBurned != null ? Math.round(f.AcresBurned).toLocaleString("en") + " acres" : "") + (f.PercentContained != null ? ", " + f.PercentContained + "% contained" : ""),
      detail: [f.County, f.Location, f.AdminUnit].filter(Boolean).join(" · "), date: f.Updated, lat: f.Latitude, lon: f.Longitude, url: f.Url ? "https://www.fire.ca.gov" + f.Url : "https://www.fire.ca.gov/incidents", sev: f.AcresBurned > 10000 ? 3 : 2, kind: "Wildfire (California)", ccs: ["us"] }); } catch (e) { fails.push("CAL FIRE"); }
  try { const j = await g("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=IncidentSize%3E%3D500&outFields=IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,POOState,IncidentTypeCategory&f=geojson&resultRecordCount=400");
    for (const f of j.features || []) { const p = f.properties, [la, lo] = pt(f.geometry);
      items.push({ title: p.IncidentName + " · " + Math.round(p.IncidentSize).toLocaleString("en") + " acres" + (p.PercentContained != null ? ", " + p.PercentContained + "% contained" : ""), detail: [p.POOState, p.IncidentTypeCategory].filter(Boolean).join(" · "),
        date: new Date(p.ModifiedOnDateTime_dt || p.FireDiscoveryDateTime).toISOString(), lat: la, lon: lo, url: "https://www.nifc.gov/fire-information/nfn", sev: p.IncidentSize > 10000 ? 3 : 2, kind: "Wildfire (US)", ccs: ["us"] }); } } catch (e) { fails.push("NIFC " + e.message); }
  if (fails.length === 2) throw new Error(fails.join("; "));
  return { items, note: fails.join("; ") };
});

feed("jma-quake", { name: "Japan Meteorological Agency earthquake reports", org: "Japan Meteorological Agency", cat: "Hazards", lic: "JMA website terms (compatible with CC BY 4.0)", url: "https://www.jma.go.jp/bosai/map.html#contents=earthquake_map" });
run("jma-quake", async (g) => {
  const j = await g("https://www.jma.go.jp/bosai/quake/data/list.json"), seen = new Set(), items = [];
  for (const q of j) {
    if (seen.has(q.eid) || !q.mag || q.mag === "Ｍ不明") continue; seen.add(q.eid);
    const m = String(q.cod || "").match(/([+-][\d.]+)([+-][\d.]+)/), la = m ? +m[1] : null, lo = m ? +m[2] : null, mag = num(q.mag);
    items.push({ title: "M" + q.mag + " · " + (q.en_anm || q.anm) + (q.maxi ? " · max intensity " + q.maxi : ""), detail: q.en_ttl || q.ttl, date: q.at, lat: la, lon: lo,
      url: "https://www.jma.go.jp/bosai/map.html#contents=earthquake_map", sev: /[5-7]/.test(q.maxi || "") ? 3 : /[34]/.test(q.maxi || "") ? 2 : 1, kind: "Earthquake (JMA)", value: mag, ccs: withOki(ccsAt(la, lo, 1)).concat(["jp"]).filter((x, i, a) => a.indexOf(x) === i) });
    if (items.length >= 150) break;
  }
  return { items };
});

feed("hko", { name: "Hong Kong Observatory warnings in force", org: "Hong Kong Observatory", cat: "Hazards", lic: "HK Government open data terms (attribution)", url: "https://www.hko.gov.hk/en/wxinfo/dailywx/wxwarntoday.htm" });
run("hko", async (g) => {
  const j = await g("https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en");
  return { items: Object.values(j || {}).map((w) => ({ title: "Hong Kong: " + w.name + (w.type ? " (" + w.type + ")" : ""), detail: "Action " + w.actionCode, date: w.updateTime || w.issueTime, lat: 22.3, lon: 114.17,
    url: "https://www.hko.gov.hk/en/wxinfo/dailywx/wxwarntoday.htm", sev: /black|red|typhoon signal no\. ?[89]|10/i.test(w.name + (w.type || "")) ? 3 : 2, kind: "Weather warning", ccs: ["cn"] })) };
});

feed("bmkg-nowcast", { name: "BMKG weather nowcasts (Indonesia)", org: "BMKG", cat: "Hazards", lic: "Indonesian government open data (attribution)", url: "https://www.bmkg.go.id/" });
run("bmkg-nowcast", async (g) => {
  const xml = await g("https://www.bmkg.go.id/alerts/nowcast/en/rss.xml", "text");
  return { items: rssItems(xml).map((x) => ({ title: x.title, detail: x.summary.slice(0, 400), date: x.date, url: x.link, sev: 2, kind: "Weather nowcast", ccs: ["id"] })) };
});

feed("bipad", { name: "Nepal BIPAD disaster incidents and river levels", org: "Government of Nepal, NDRRMA (BIPAD portal)", cat: "Hazards", lic: "Government of Nepal open data", url: "https://bipadportal.gov.np/" });
run("bipad", async (g) => {
  const j = await g("https://bipadportal.gov.np/api/v1/incident/?ordering=-incident_on&limit=150&expand=loss"), items = [];
  for (const x of j.results || []) { const [la, lo] = pt(x.point), l = x.loss || {};
    const hurt = [l.peopleDeathCount ? l.peopleDeathCount + " dead" : "", l.peopleMissingCount ? l.peopleMissingCount + " missing" : "", l.peopleInjuredCount ? l.peopleInjuredCount + " injured" : ""].filter(Boolean).join(", ");
    items.push({ title: x.title + (hurt ? " · " + hurt : ""), detail: [x.streetAddress, x.verified ? "verified" : "unverified"].filter(Boolean).join(" · "), date: x.incidentOn, lat: la, lon: lo,
      url: "https://bipadportal.gov.np/incidents/", sev: l.peopleDeathCount ? 3 : 2, kind: "Disaster incident (Nepal)", ccs: ["np"] }); }
  try { const r = await g("https://bipadportal.gov.np/api/v1/river/?limit=600");
    for (const s of r.results || []) if (s.status && !/below/i.test(s.status)) { const [la, lo] = pt(s.point);
      items.push({ title: s.title + " · " + s.status, detail: "Water level " + s.waterLevel + " m (warning " + s.warningLevel + ", danger " + s.dangerLevel + ")" + (s.basin ? ", " + s.basin + " basin" : ""),
        date: s.measuredOn, lat: la, lon: lo, url: "https://bipadportal.gov.np/realtime/", sev: /danger/i.test(s.status) ? 3 : 2, kind: "River level", ccs: ["np"] }); } } catch (e) {}
  return { items: items.filter((x) => within(x.date, 30)) };
});

feed("my-flood", { name: "Malaysia river levels and weather warnings (data.gov.my)", org: "JPS / MetMalaysia via data.gov.my", cat: "Hazards", lic: "CC BY 4.0 (data.gov.my)", url: "https://data.gov.my/" });
run("my-flood", async (g) => {
  const items = [], figures = {};
  const st = await g("https://api.data.gov.my/flood-warning?limit=3000"), cnt = {};
  for (const s of st) { const lv = String(s.water_level_indicator || "").toUpperCase(); cnt[lv] = (cnt[lv] || 0) + 1;
    if (!lv || lv === "NORMAL" || !within(s.water_level_update_datetime, 3)) continue;
    items.push({ title: s.station_name + " · " + lv, detail: "Water level " + s.water_level_current + " m. " + [s.district, s.state].filter(Boolean).join(", "), date: s.water_level_update_datetime,
      lat: s.latitude, lon: s.longitude, url: "https://publicinfobanjir.water.gov.my/", sev: lv === "DANGER" ? 3 : lv === "WARNING" ? 2 : 1, kind: "River level", ccs: ["my"] }); }
  figures.my = { river_stations: st.length, ...cnt };
  try { const w = await g("https://api.data.gov.my/weather/warning?limit=50");
    for (const x of w) if (!x.valid_to || Date.parse(x.valid_to) > Date.now() - 864e5)
      items.push({ title: (x.warning_issue && x.warning_issue.title_en) || x.heading_en, detail: (x.text_en || "").slice(0, 400), date: x.warning_issue && x.warning_issue.issued, url: "https://www.met.gov.my/", sev: 2, kind: "Weather warning", ccs: ["my"] }); } catch (e) {}
  return { items, figures };
});

feed("sg-now", { name: "Singapore air quality (PSI) and rainfall now", org: "NEA via data.gov.sg", cat: "Environment", lic: "Singapore Open Data Licence", url: "https://data.gov.sg/" });
run("sg-now", async (g) => {
  const p = await g("https://api-open.data.gov.sg/v2/real-time/api/psi"), r = await g("https://api-open.data.gov.sg/v2/real-time/api/rainfall");
  const it = (p.data.items || [])[0] || {}, rd = it.readings || {};
  const rr = ((r.data.readings || [])[0] || {}).data || [], wet = rr.filter((x) => x.value > 0).length, max = Math.max(0, ...rr.map((x) => x.value));
  return { items: [], figures: { sg: { psi_24h: rd.psi_twenty_four_hourly && rd.psi_twenty_four_hourly.national, pm25_1h: rd.pm25_one_hourly && rd.pm25_one_hourly.national, rain_stations_wet: wet + " of " + rr.length, rain_max_5min_mm: max, at: it.date || it.timestamp } } };
});

feed("usgs-volc", { name: "USGS elevated volcano alert levels", org: "US Geological Survey Volcano Hazards Program", cat: "Hazards", lic: "US Government public domain", url: "https://www.usgs.gov/programs/VHP" });
run("usgs-volc", async (g) => {
  const j = await g("https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes");
  return { items: j.map((v) => ({ title: v.volcano_name + ": " + v.alert_level + " / aviation " + v.color_code, detail: v.obs_fullname, date: pick(v, ["sent_utc", "sent_unixtime"]) || new Date().toISOString(),
    lat: num(pick(v, ["latitude", "lat"])), lon: num(pick(v, ["longitude", "long", "lon"])), url: v.notice_url || "https://volcanoes.usgs.gov/", sev: /WARNING|RED/.test(v.alert_level + v.color_code) ? 3 : 2, kind: "Volcano alert level", ccs: ["us"] })) };
});

feed("safecast", { name: "Safecast radiation measurements (latest)", org: "Safecast (volunteer network)", cat: "Environment", lic: "CC0", url: "https://map.safecast.org/" });
run("safecast", async (g) => {
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const j = await g("https://api.safecast.org/measurements.json?order=created_at%20desc&per_page=1000&unit=cpm&since=" + since);
  const cells = new Map();
  for (const m of j) { if (m.unit !== "cpm" || m.latitude == null) continue; const k = Math.round(m.latitude * 10) + ":" + Math.round(m.longitude * 10);
    const e = cells.get(k) || { la: m.latitude, lo: m.longitude, max: 0, n: 0, t: "" }; e.n++; e.max = Math.max(e.max, m.value); if ((m.captured_at || "") > e.t) e.t = m.captured_at; cells.set(k, e); }
  return { items: [...cells.values()].map((e) => { const usv = e.max / 334;
    return { title: "Radiation " + usv.toFixed(2) + " µSv/h (" + Math.round(e.max) + " CPM)", detail: e.n + " reading(s) by volunteer sensors; typical background is 0.05 to 0.3 µSv/h.", date: e.t, lat: e.la, lon: e.lo,
      url: "https://map.safecast.org/?y=" + e.la + "&x=" + e.lo + "&z=12", sev: usv > 1 ? 3 : usv > 0.4 ? 2 : 1, kind: "Radiation reading", value: +usv.toFixed(3), ccs: withOki(ccsAt(e.la, e.lo, 0.2)) }; }).sort((a, b) => b.value - a.value) };
});

feed("sensor-community", { name: "Sensor.Community air sensors (PM2.5, last hour)", org: "Sensor.Community (volunteer network)", cat: "Environment", lic: "ODbL 1.0", url: "https://maps.sensor.community/" });
run("sensor-community", async (g) => {
  const j = await get("https://data.sensor.community/static/v2/data.1h.json", "json", { timeout: 120000 });
  const by = {}, hot = new Map();
  for (const s of j) { const v = (s.sensordatavalues || []).find((x) => x.value_type === "P2"); if (!v) continue; const pm = +v.value; if (!(pm >= 0 && pm < 1000)) continue;
    const la = +s.location.latitude, lo = +s.location.longitude, cc = ccFromA2(s.location.country) || ccsAt(la, lo, 0)[0]; if (!cc) continue;
    (by[cc] = by[cc] || []).push(pm);
    if (pm >= 55) { const k = cc + Math.round(la * 10) + ":" + Math.round(lo * 10), e = hot.get(k) || { cc, la, lo, max: 0, n: 0 }; e.n++; e.max = Math.max(e.max, pm); hot.set(k, e); } }
  const figures = {};
  for (const [cc, a] of Object.entries(by)) { a.sort((x, y) => x - y); figures[cc] = { sensors: a.length, pm25_median: round(a[a.length >> 1]), pm25_p90: round(a[Math.floor(a.length * 0.9)]) }; }
  return { figures, items: [...hot.values()].map((e) => ({ title: "PM2.5 " + Math.round(e.max) + " µg/m³ (hourly mean, " + e.n + " sensor" + (e.n > 1 ? "s" : "") + ")", detail: "Low-cost volunteer sensor; readings run high in humid air.",
    date: new Date().toISOString(), lat: e.la, lon: e.lo, url: "https://maps.sensor.community/#12/" + e.la + "/" + e.lo, sev: e.max >= 150 ? 3 : 2, kind: "Air pollution (sensor)", value: Math.round(e.max), ccs: withOki([e.cc]) })) };
});

feed("ndbc", { name: "NOAA NDBC buoys: high seas and strong wind", org: "NOAA National Data Buoy Center", cat: "Maritime", lic: "US Government public domain", url: "https://www.ndbc.noaa.gov/" });
run("ndbc", async (g) => {
  const t = await g("https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt", "text"), items = [];
  for (const l of t.split("\n")) { if (l.startsWith("#") || !l.trim()) continue; const c = l.trim().split(/\s+/);
    const [stn, la, lo, Y, M, D, hh, mm, , wspd, gst, wvht] = c, w = num(wvht), s = num(wspd);
    if (!((w != null && w >= 4) || (s != null && s >= 17))) continue;
    items.push({ title: "Buoy " + stn + ": " + [w != null ? "waves " + w + " m" : "", s != null ? "wind " + s + " m/s" : "", num(gst) != null ? "gusts " + gst + " m/s" : ""].filter(Boolean).join(", "),
      detail: "NOAA NDBC station observation", date: `${Y}-${M}-${D}T${hh}:${mm}Z`, lat: +la, lon: +lo, url: "https://www.ndbc.noaa.gov/station_page.php?station=" + stn, sev: (w >= 7 || s >= 25) ? 3 : 2, kind: "Sea state", value: w, ccs: withOki(ccsAt(+la, +lo, 4)) }); }
  return { items };
});

feed("coral", { name: "NOAA Coral Reef Watch heat-stress alerts", org: "NOAA Coral Reef Watch", cat: "Environment", lic: "US Government public domain", url: "https://coralreefwatch.noaa.gov/", everyHours: 12 });
run("coral", async (g) => {
  const j = await get("https://coralreefwatch.noaa.gov/product/vs/vs_polygons.json", "json", { timeout: 90000 });
  const lv = ["No stress", "Watch", "Warning", "Alert level 1", "Alert level 2", "Alert level 3", "Alert level 4", "Alert level 5"];
  return { items: (j.features || []).map((f) => { const p = f.properties || {}, a = num(pick(p, ["alert", "alert_level", "AlertLevel", "level"])), [la, lo] = pt(f.geometry);
    if (!(a >= 2)) return null; const ccs = ccsInText(p.name || ""); return { title: (p.name || "Reef region") + ": " + (lv[a] || "level " + a), detail: "7-day maximum coral bleaching heat-stress alert.",
      date: new Date().toISOString(), lat: la, lon: lo, url: "https://coralreefwatch.noaa.gov/product/vs/map.php", sev: a >= 4 ? 3 : 2, kind: "Coral bleaching alert", value: a, ccs: ccs.length ? withOki(ccs) : withOki(ccsAt(la, lo, 3)) }; }).filter(Boolean) };
});

// ---------------------------------------------------------------- space weather, aviation, space
feed("swpc", { name: "NOAA space weather scales and alerts", org: "NOAA Space Weather Prediction Center", cat: "Space", lic: "US Government public domain", url: "https://www.swpc.noaa.gov/" });
run("swpc", async (g) => {
  const s = await g("https://services.swpc.noaa.gov/products/noaa-scales.json"), a = await g("https://services.swpc.noaa.gov/products/alerts.json");
  const now = s["0"] || {}, globals = [{ title: "Space weather now: radio blackout R" + now.R.Scale + ", solar radiation S" + now.S.Scale + ", geomagnetic storm G" + now.G.Scale,
    detail: "Scales 0 (none) to 5 (extreme). G3+ can disturb HF radio, GNSS accuracy and power grids.", date: now.DateStamp + "T" + now.TimeStamp + "Z", url: "https://www.swpc.noaa.gov/noaa-scales-explanation",
    sev: Math.max(+now.R.Scale, +now.S.Scale, +now.G.Scale) >= 3 ? 3 : Math.max(+now.R.Scale, +now.S.Scale, +now.G.Scale) >= 1 ? 2 : 1, kind: "Space weather" }];
  for (const x of a.slice(0, 30)) { const m = x.message.replace(/\r/g, ""), head = (m.match(/\n(ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CANCEL[^:\n]*):?\s*([^\n]+)/) || [])[0] || x.product_id;
    globals.push({ title: head.trim().replace(/\s+/g, " "), detail: m.split("\n\n").slice(1, 3).join(" ").replace(/\s+/g, " ").slice(0, 400), date: x.issue_datetime.replace(" ", "T") + "Z", url: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
      sev: /WARNING|ALERT/.test(head) ? 2 : 1, kind: "Space weather" }); }
  return { items: [], globals };
});

feed("mil-air", { name: "Military aircraft broadcasting ADS-B (adsb.lol, adsb.fi)", org: "adsb.lol; adsb.fi (volunteer receivers)", cat: "Aviation", lic: "adsb.lol ODbL 1.0; adsb.fi open data, non-commercial", nc: true, url: "https://adsb.lol/" });
run("mil-air", async (g) => {
  const seen = new Map(), fails = [];
  for (const u of ["https://api.adsb.lol/v2/mil", "https://opendata.adsb.fi/api/v2/mil"]) {
    try { const j = await g(u); for (const a of j.ac || []) if (a.lat != null && !seen.has(a.hex)) seen.set(a.hex, a); } catch (e) { fails.push(u.split("/")[2]); }
    await sleep(1100);
  }
  if (fails.length === 2) throw new Error("both failed");
  const items = [...seen.values()].map((a) => ({ title: (a.desc || a.t || "Aircraft") + (a.flight ? " · " + a.flight.trim() : "") + (a.r ? " · " + a.r : ""),
    detail: [a.alt_baro === "ground" ? "on the ground" : a.alt_baro != null ? "altitude " + a.alt_baro + " ft" : "", a.gs != null ? Math.round(a.gs) + " kt" : "", a.track != null ? "heading " + Math.round(a.track) + "°" : "", a.squawk ? "squawk " + a.squawk : ""].filter(Boolean).join(", ") +
      ". Only aircraft that broadcast ADS-B and fly within range of volunteer receivers; most military flights do not appear.", date: new Date(Date.now() - (a.seen || 0) * 1000).toISOString(),
    lat: a.lat, lon: a.lon, url: "https://globe.adsb.lol/?icao=" + a.hex, sev: /7[567]00/.test(a.squawk || "") ? 3 : 1, kind: "Military aircraft", ccs: withOki(ccsAt(a.lat, a.lon, 1.5)) }));
  return { items, note: seen.size + " aircraft" + (fails.length ? "; failed: " + fails.join(", ") : "") };
});

feed("opensky", { name: "Air traffic over each country (OpenSky Network)", org: "OpenSky Network", cat: "Aviation", lic: "OpenSky terms: non-commercial research use, anonymous access", nc: true, url: "https://opensky-network.org/" });
run("opensky", async (g) => {
  const j = await get("https://opensky-network.org/api/states/all", "json", { timeout: 90000 }), figures = {};
  for (const s of j.states || []) { const lo = s[5], la = s[6]; if (la == null || s[8]) continue;
    const [cc] = ccsAt(la, lo, 0); if (!cc) continue; const f = (figures[cc] = figures[cc] || { airborne: 0, by_registration: {} }); f.airborne++;
    const oc = ccFromName(s[2]) || s[2]; f.by_registration[oc] = (f.by_registration[oc] || 0) + 1; }
  for (const f of Object.values(figures)) f.by_registration = Object.fromEntries(Object.entries(f.by_registration).sort((a, b) => b[1] - a[1]).slice(0, 6));
  if (figures.jp) figures.oki = figures.jp;
  return { figures, note: (j.states || []).length + " aircraft worldwide" };
});

feed("faa", { name: "US airport delays and closures (FAA)", org: "Federal Aviation Administration", cat: "Aviation", lic: "US Government public domain", url: "https://nasstatus.faa.gov/" });
run("faa", async (g) => {
  const x = await g("https://nasstatus.faa.gov/api/airport-status-information", "text"), items = [];
  for (const b of x.split(/<(?:Ground_Delay|Ground_Stop|Delay|Airport|Program)>/).slice(1)) {
    const t = (k) => (b.match(new RegExp("<" + k + ">([^<]*)</" + k + ">")) || [])[1] || "";
    const ap = t("ARPT") || t("Airport"); if (!ap) continue;
    items.push({ title: ap + ": " + (t("Reason") || "delay"), detail: [t("Avg") && "average " + t("Avg"), t("Max") && "max " + t("Max"), t("Min") && "min " + t("Min"), t("Start") && "from " + t("Start"), t("Reopen") && "reopens " + t("Reopen")].filter(Boolean).join(", "),
      date: new Date().toISOString(), url: "https://nasstatus.faa.gov/", sev: /closed|stop/i.test(b) ? 3 : 2, kind: "Airport delay", ccs: ["us"] });
  }
  return { items };
});

feed("launches", { name: "Upcoming rocket launches", org: "The Space Devs (Launch Library 2)", cat: "Space", lic: "Launch Library 2 free tier (attribution)", url: "https://thespacedevs.com/", everyHours: 3 });
run("launches", async (g) => {
  const j = await g("https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=40&mode=normal");
  const items = (j.results || []).map((l) => { const p = l.pad || {}, loc = p.location || {}, la = num(p.latitude), lo = num(p.longitude);
    const cc = ccFromA3(loc.country_code || (loc.country && loc.country.alpha_3_code)) || ccFromA2(loc.country && loc.country.alpha_2_code);
    return { title: l.name + " · " + ((l.status && (l.status.abbrev || l.status.name)) || ""), detail: [(l.launch_service_provider || {}).name, p.name, loc.name, l.mission && l.mission.description && l.mission.description.slice(0, 200)].filter(Boolean).join(" · "),
      date: l.net, lat: la, lon: lo, url: l.url ? "https://thespacedevs.com/llapi" : "https://thespacedevs.com/", sev: 1, kind: "Rocket launch", ccs: cc ? withOki([cc]) : withOki(ccsAt(la, lo, 0.5)) }; });
  return { items, globals: items.slice(0, 20).map((x) => ({ ...x, ccs: undefined })) };
});

feed("gpsjam", { name: "GNSS interference seen by aircraft (gpsjam.org, yesterday)", org: "gpsjam.org, from ADS-B Exchange data", cat: "Aviation", lic: "gpsjam.org public daily files; terms not stated", nc: true, url: "https://gpsjam.org/", everyHours: 6 });
run("gpsjam", async (g) => {
  const h3 = await import("h3-js");
  const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const t = await g("https://gpsjam.org/data/" + day + "-h3_4.csv", "text"), items = [], figures = {};
  for (const l of t.split("\n").slice(1)) { const [hex, good, bad] = l.split(","); const G1 = +good, B = +bad; if (!hex || G1 + B < 5) continue;
    const r = B / (G1 + B); if (r < 0.1) continue; const [la, lo] = h3.cellToLatLng(hex), ccs = withOki(ccsAt(la, lo, 1));
    for (const cc of ccs) figures[cc] = { cells: ((figures[cc] || {}).cells || 0) + 1, date: day };
    items.push({ title: Math.round(r * 100) + "% of aircraft reported degraded GPS", detail: B + " of " + (G1 + B) + " aircraft in this ~40 km cell on " + day + " reported low navigation accuracy (jamming or spoofing likely).",
      date: day + "T12:00", lat: la, lon: lo, url: "https://gpsjam.org/?lat=" + la.toFixed(2) + "&lon=" + lo.toFixed(2) + "&z=6&date=" + day, sev: r >= 0.5 ? 3 : 2, kind: "GNSS interference", value: Math.round(r * 100), ccs }); }
  return { items: items.sort((a, b) => b.value - a.value), figures };
});

// ---------------------------------------------------------------- maritime and infrastructure (slow-changing reference layers)
feed("ports", { name: "World Port Index", org: "US National Geospatial-Intelligence Agency", cat: "Infrastructure", lic: "US Government public domain", url: "https://msi.nga.mil/Publications/WPI", everyHours: 168, cap: 120 });
run("ports", async (g) => {
  const j = await get("https://msi.nga.mil/api/publications/world-port-index?output=json", "json", { timeout: 120000 }), size = { L: 4, M: 3, S: 2, V: 1 };
  return { items: (j.ports || []).map((p) => { const la = num(pick(p, ["ycoord", "latitude"])), lo = num(pick(p, ["xcoord", "longitude"]));
    return { title: "Port: " + p.portName + (p.harborSize ? " (" + ({ L: "large", M: "medium", S: "small", V: "very small" }[p.harborSize] || p.harborSize) + ")" : ""),
      detail: [p.harborType && "harbour type " + p.harborType, p.maxVesselLength && "max vessel " + p.maxVesselLength + " m", p.chDepth && "channel depth " + p.chDepth + " m", p.unloCode && "UN/LOCODE " + p.unloCode].filter(Boolean).join(", "),
      lat: la, lon: lo, url: "https://msi.nga.mil/Publications/WPI", sev: 1, kind: "Port", value: size[p.harborSize] || 0, ccs: withOki(ccsAt(la, lo, 0.3)) }; }).sort((a, b) => b.value - a.value) };
});

feed("cables", { name: "Submarine cable landing points", org: "TeleGeography Submarine Cable Map", cat: "Infrastructure", lic: "CC BY-NC-SA 3.0", nc: true, url: "https://www.submarinecablemap.com/", everyHours: 168 });
run("cables", async (g) => {
  const j = await g("https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json");
  return { items: j.features.map((f) => { const p = f.properties, [la, lo] = pt(f.geometry), cname = String(p.name).split(",").pop().trim();
    return { title: "Cable landing: " + p.name, detail: "Submarine telecom cable landing station", lat: la, lon: lo, url: "https://www.submarinecablemap.com/landing-point/" + p.id, sev: 1, kind: "Cable landing",
      ccs: withOki([ccFromName(cname)].filter(Boolean).length ? [ccFromName(cname)] : ccsAt(la, lo, 0.3)) }; }) };
});

feed("power", { name: "Power plants (WRI Global Power Plant Database)", org: "World Resources Institute", cat: "Infrastructure", lic: "CC BY 4.0", url: "https://datasets.wri.org/dataset/globalpowerplantdatabase", everyHours: 168, cap: 120 });
run("power", async (g) => {
  const t = await get("https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv", "text", { timeout: 120000 });
  const rows = csvObjects(t), figures = {}, items = [];
  for (const r of rows) { const cc = ccFromA3(r.country); if (!cc) continue; const mw = +r.capacity_mw || 0;
    const f = (figures[cc] = figures[cc] || { plants: 0, total_mw: 0, by_fuel_mw: {} }); f.plants++; f.total_mw += mw; f.by_fuel_mw[r.primary_fuel] = Math.round((f.by_fuel_mw[r.primary_fuel] || 0) + mw);
    items.push({ title: r.primary_fuel + " power plant: " + r.name + " · " + Math.round(mw) + " MW", detail: [r.commissioning_year && "commissioned " + Math.round(r.commissioning_year), r.owner && "owner " + r.owner].filter(Boolean).join(", ") + " (database last updated 2021)",
      lat: +r.latitude, lon: +r.longitude, url: r.url || "https://datasets.wri.org/dataset/globalpowerplantdatabase", sev: 1, kind: "Power plant", value: Math.round(mw), ccs: withOki([cc]) }); }
  for (const f of Object.values(figures)) f.total_mw = Math.round(f.total_mw);
  return { items: items.sort((a, b) => b.value - a.value), figures };
});

// ---------------------------------------------------------------- cyber and internet
feed("kev", { name: "CISA Known Exploited Vulnerabilities (latest)", org: "US Cybersecurity and Infrastructure Security Agency", cat: "Cyber", lic: "CC0 1.0", url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog" });
run("kev", async (g) => {
  const j = await get("https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json");
  const v = j.vulnerabilities.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 60);
  return { items: [], globals: v.map((x) => ({ title: x.cveID + " · " + x.vendorProject + " " + x.product + ": " + x.vulnerabilityName, detail: x.shortDescription + (x.knownRansomwareCampaignUse === "Known" ? " Used in ransomware campaigns." : ""),
    date: x.dateAdded, url: "https://nvd.nist.gov/vuln/detail/" + x.cveID, sev: x.knownRansomwareCampaignUse === "Known" ? 3 : 2, kind: "Exploited vulnerability" })), note: j.count + " in catalogue" };
});

for (const [id, name, org, url, lic, home] of [
  ["cisa-adv", "CISA cybersecurity advisories", "US Cybersecurity and Infrastructure Security Agency", "https://www.cisa.gov/cybersecurity-advisories/all.xml", "US Government public domain", "https://www.cisa.gov/news-events/cybersecurity-advisories"],
  ["ncsc", "UK NCSC news and advisories", "UK National Cyber Security Centre", "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml", "Open Government Licence v3", "https://www.ncsc.gov.uk/"]]) {
  feed(id, { name, org, cat: "Cyber", lic, url: home });
  run(id, async (g) => {
    const items = rssItems(await g(url, "text")).filter((x) => within(x.date, 60)).slice(0, 60).map((x) => ({ title: x.title, detail: x.summary.slice(0, 400), date: x.date, url: x.link, sev: /critical|actively exploited|state-sponsored/i.test(x.title + x.summary) ? 3 : 2, kind: "Cyber advisory", ccs: withOki(ccsInText(x.title + " " + x.summary)) }));
    return { items, globals: items.slice(0, 30).map((x) => ({ ...x, ccs: undefined })) };
  });
}

feed("ransomware", { name: "Ransomware leak-site claims (ransomware.live)", org: "ransomware.live (Julien Mousqueton)", cat: "Cyber", lic: "Free public API; terms: attribution, non-commercial", nc: true, url: "https://www.ransomware.live/" });
run("ransomware", async (g) => {
  const j = await g("https://api.ransomware.live/v2/recentvictims", "json", { timeout: 90000 });
  // Victims are organisations; a name that could be a person's (no company marker, no domain) is withheld.
  const ORG = /\b(inc|ltd|llc|plc|corp|co\.|company|group|gmbh|ag|s\.?a\.?|s\.?r\.?l|b\.?v|pty|bhd|tbk|limited|holdings?|bank|university|college|school|hospital|clinic|council|county|city|municipal|ministry|government|department|authority|agency|association|foundation|services|systems|solutions|technolog|industr|logistics|energy|pharma|health|hotel|airport|port)\b/i;
  return { items: j.map((v) => ({ title: v.group + " claims an attack on " + (ORG.test(v.victim || "") || v.domain ? v.victim : "an organisation") + (v.activity && v.activity !== "Not Found" ? " (" + v.activity + ")" : ""),
    detail: "Claim posted on the group's leak site; not confirmed by the victim." + (v.domain ? " Domain: " + v.domain + "." : ""), date: v.attackdate || v.discovered, url: "https://www.ransomware.live/group/" + encodeURIComponent(v.group),
    sev: /hospital|health|government|ministry|energy|water|airport/i.test((v.activity || "") + " " + v.victim) ? 3 : 2, kind: "Ransomware claim", ccs: one(ccFromA2(v.country)) })) };
});

feed("c2", { name: "Botnet command servers (abuse.ch Feodo Tracker)", org: "abuse.ch", cat: "Cyber", lic: "CC0", url: "https://feodotracker.abuse.ch/" });
run("c2", async (g) => {
  const j = await g("https://feodotracker.abuse.ch/downloads/ipblocklist.json"), figures = {};
  const items = j.map((x) => { const cc = ccFromA2(x.country); if (cc) { const f = (figures[cc] = figures[cc] || { servers: 0, online: 0 }); f.servers++; if (x.status === "online") f.online++; }
    return { title: x.malware + " command server " + x.ip_address + ":" + x.port + " (" + x.status + ")", detail: [x.as_name, "AS" + x.as_number, "first seen " + x.first_seen, "last online " + x.last_online].filter(Boolean).join(", "),
      date: x.last_online || x.first_seen, url: "https://feodotracker.abuse.ch/browse/host/" + x.ip_address + "/", sev: x.status === "online" ? 2 : 1, kind: "Botnet server", ccs: one(cc) }; });
  return { items, figures };
});

feed("ioda-all", { name: "Internet outage alerts, all countries (IODA)", org: "Georgia Tech IODA", cat: "Cyber", lic: "IODA terms: free, attribution", url: "https://ioda.inetintel.cc.gatech.edu/" });
run("ioda-all", async (g) => {
  const now = Math.floor(Date.now() / 1000), j = await g("https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=" + (now - 3 * 86400) + "&until=" + now + "&limit=2000");
  const items = []; for (const a of j.data || []) { if (a.level === "normal") continue; const e = a.entity || {};
    const cc = e.type === "country" ? ccFromA2(e.code) : ccFromA2((e.attrs || {}).country_code || (e.attrs && e.attrs.fqid && e.attrs.fqid.split(".")[1]));
    if (!cc) continue;
    items.push({ title: (e.type === "country" ? "Country-wide" : e.type === "region" ? "Region " + e.name : "Network " + e.name) + ": " + a.datasource + " signal " + a.level,
      detail: "Value " + a.value + " against a normal of " + a.historyValue + ". Automated detection; a drop can be a power cut, cable fault or shutdown.", date: new Date(a.time * 1000).toISOString(),
      url: "https://ioda.inetintel.cc.gatech.edu/" + (e.type === "country" ? "country/" + e.code : ""), sev: a.level === "critical" ? 3 : 2, kind: "Internet outage signal", ccs: withOki([cc]) }); }
  return { items };
});

feed("ooni", { name: "Internet censorship findings (OONI)", org: "Open Observatory of Network Interference", cat: "Cyber", lic: "CC BY 4.0", url: "https://explorer.ooni.org/findings" });
run("ooni", async (g) => {
  const j = await g("https://api.ooni.io/api/v1/incidents/search?only_mine=false");
  const items = []; for (const x of j.incidents || []) for (const c of x.CCs || []) { const cc = ccFromA2(c); if (!cc) continue;
    items.push({ title: x.title, detail: (x.short_description || "") + (x.end_time ? "" : " (ongoing)"), date: x.start_time || x.create_time, url: "https://explorer.ooni.org/findings/" + x.id, sev: x.end_time ? 1 : 2, kind: "Censorship finding", ccs: withOki([cc]) }); }
  return { items };
});

// ---------------------------------------------------------------- sanctions (names allowed: sanctioned people and bodies only)
feed("un-sanctions", { name: "UN Security Council consolidated sanctions list", org: "United Nations Security Council", cat: "Sanctions", lic: "UN public information", url: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", everyHours: 12 });
run("un-sanctions", async (g) => {
  const x = await g("https://scsanctions.un.org/resources/xml/en/consolidated.xml", "text"), items = [];
  for (const [tag, kind] of [["INDIVIDUAL", "person"], ["ENTITY", "entity"]]) for (const b of x.split("<" + tag + ">").slice(1)) {
    const t = (k) => (b.match(new RegExp("<" + k + ">([^<]*)</" + k + ">")) || [])[1] || "";
    const name = [t("FIRST_NAME"), t("SECOND_NAME"), t("THIRD_NAME"), t("FOURTH_NAME")].filter(Boolean).join(" ");
    const places = [...b.matchAll(/<NATIONALITY>\s*<VALUE>([^<]+)<\/VALUE>|<COUNTRY>([^<]+)<\/COUNTRY>|<COUNTRY_OF_BIRTH>([^<]+)<\/COUNTRY_OF_BIRTH>/g)].map((m) => (m[1] || m[2] || m[3]).trim()).filter(Boolean);
    const ccs = [...new Set(places.map(ccFromName).filter(Boolean))];
    const nice = kind === "person" ? name.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : name;
    items.push({ title: (kind === "person" ? "Sanctioned person: " : "Sanctioned entity: ") + nice, detail: [t("UN_LIST_TYPE") + " list", t("REFERENCE_NUMBER"), places.length ? "linked to " + [...new Set(places)].join(", ") : ""].filter(Boolean).join(" · "),
      date: t("LISTED_ON"), url: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", sev: 1, kind: "UN sanctions listing", ccs: withOki(ccs) }); }
  return { items };
});

feed("uk-sanctions", { name: "UK consolidated sanctions list (OFSI)", org: "HM Treasury, Office of Financial Sanctions Implementation", cat: "Sanctions", lic: "Open Government Licence v3", url: "https://www.gov.uk/government/publications/financial-sanctions-consolidated-list-of-targets", everyHours: 12 });
run("uk-sanctions", async (g) => {
  const t = await get("https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv", "text", { timeout: 120000 });
  const rows = csvRows(t), h = rows[1], ix = (k) => h.indexOf(k), by = new Map();
  for (const r of rows.slice(2)) { const id = r[ix("Group ID")]; if (!id) continue; const e = by.get(id) || { names: [], places: new Set() };
    const nm = [r[ix("Name 1")], r[ix("Name 2")], r[ix("Name 3")], r[ix("Name 4")], r[ix("Name 5")], r[ix("Name 6")]].filter(Boolean).join(" ");
    if (r[ix("Alias Type")] === "Primary name" || !e.names.length) e.names.unshift(nm);
    for (const k of ["Country", "Nationality", "Country of birth"]) if (r[ix(k)]) String(r[ix(k)]).split(/[,;]|\(\d\)/).forEach((p) => p.trim() && e.places.add(p.trim()));
    e.type = r[ix("Group Type")]; e.regime = r[ix("Regime")]; e.listed = r[ix("Listed On")]; by.set(id, e); }
  const items = [...by.entries()].map(([id, e]) => { const d = String(e.listed || "").split("/"); const ccs = [...new Set([...e.places].map(ccFromName).filter(Boolean))];
    return { title: "UK-sanctioned " + String(e.type || "").toLowerCase() + ": " + e.names[0], detail: e.regime + " regime · group " + id + ([...e.places].length ? " · linked to " + [...e.places].slice(0, 4).join(", ") : ""),
      date: d.length === 3 ? d[2] + "-" + d[1] + "-" + d[0] : "", url: "https://sanctionssearchapp.ofsi.hmtreasury.gov.uk/", sev: 1, kind: "UK sanctions listing", ccs: withOki(ccs) }; });
  return { items };
});

feed("ca-sanctions", { name: "Canada consolidated autonomous sanctions list", org: "Global Affairs Canada", cat: "Sanctions", lic: "Open Government Licence - Canada", url: "https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx", everyHours: 12 });
run("ca-sanctions", async (g) => {
  const x = await g("https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.xml", "text");
  return { items: x.split("<record>").slice(1).map((b) => { const t = (k) => unhtml((b.match(new RegExp("<" + k + "(?:-[A-Za-z]+)?>([^<]*)</" + k + "(?:-[A-Za-z]+)?>")) || [])[1] || "");
    const name = t("EntityOrShip") || [t("GivenName"), t("LastName")].filter(Boolean).join(" "), country = t("Country").split(" / ")[0].trim();
    return { title: "Canada-sanctioned " + (t("EntityOrShip") ? "entity/ship" : "person") + ": " + name, detail: [country, t("Schedule") && "schedule " + t("Schedule"), t("Item") && "item " + t("Item")].filter(Boolean).join(" · "),
      date: t("DateOfListing"), url: "https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx", sev: 1, kind: "Canada sanctions listing", ccs: withOki([ccFromName(country)].filter(Boolean)) }; }) };
});

feed("opensanctions", { name: "Sanctioned and watch-listed entities per country (OpenSanctions totals)", org: "OpenSanctions", cat: "Sanctions", lic: "CC BY-NC 4.0 (non-commercial)", nc: true, url: "https://www.opensanctions.org/", everyHours: 24 });
run("opensanctions", async (g) => {
  const j = await g("https://data.opensanctions.org/datasets/latest/default/statistics.json"), figures = {};
  for (const c of (j.things && j.things.countries) || []) { const cc = ccFromA2(c.code); if (cc) figures[cc] = { entities: c.count }; }
  if (figures.jp) figures.oki = figures.jp;
  return { figures, note: Object.keys(figures).length + " countries" };
});

// ---------------------------------------------------------------- travel advisories (claims by foreign governments)
feed("ca-travel", { name: "Canada travel advisories", org: "Government of Canada", cat: "Advisories", lic: "Open Government Licence - Canada", url: "https://travel.gc.ca/travelling/advisories", everyHours: 3 });
run("ca-travel", async (g) => {
  const j = await g("https://data.international.gc.ca/travel-voyage/index-updated.json"), L = ["Take normal security precautions", "Exercise a high degree of caution", "Avoid non-essential travel", "Avoid all travel"];
  return { items: Object.entries(j.data || {}).map(([a2, c]) => { const lv = +c["advisory-state"], e = c.eng || {};
    return { title: "Canada: " + (L[lv] || "level " + lv) + (c["has-regional-advisory"] ? " (regional advisories too)" : ""), detail: unhtml(e["advisory-text"] || e["recent-updates"] || "").slice(0, 400),
      date: (c["date-published"] || {}).date, url: "https://travel.gc.ca/destinations/" + (e["url-slug"] || c["url-slug"] || ""), sev: lv >= 2 ? 3 : lv === 1 ? 2 : 1, kind: "Travel advisory", value: lv, ccs: one(ccFromA2(a2)) }; }) };
});

feed("de-travel", { name: "German Foreign Office travel warnings", org: "Auswärtiges Amt", cat: "Advisories", lic: "German government open data (dl-de/by-2-0)", url: "https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise", everyHours: 3 });
run("de-travel", async (g) => {
  const j = await g("https://www.auswaertiges-amt.de/opendata/travelwarning");
  return { items: Object.values(j.response || {}).filter((c) => c && typeof c === "object" && c.countryCode).map((c) => {
    const lv = c.warning ? "Travel warning (whole country)" : c.partialWarning ? "Partial travel warning" : c.situationWarning ? "Advice against travel" : c.situationPartWarning ? "Advice against travel to parts" : "No warning";
    return { title: "Germany: " + lv, detail: c.title || "", date: new Date((c.lastModified || 0) * 1000).toISOString(), url: "https://www.auswaertiges-amt.de/de/service/laender/" + String(c.countryName || "").toLowerCase().replace(/[^a-zäöüß]+/g, "") + "-node",
      sev: c.warning || c.situationWarning ? 3 : c.partialWarning || c.situationPartWarning ? 2 : 1, kind: "Travel advisory", ccs: one(ccFromA2(c.countryCode === "UK" ? "GB" : c.countryCode) || ccFromA3(c.iso3CountryCode)) }; }) };
});

feed("au-travel", { name: "Australian Smartraveller advice levels", org: "Australian Government DFAT", cat: "Advisories", lic: "CC BY 4.0", url: "https://www.smartraveller.gov.au/", everyHours: 3 });
run("au-travel", async (g) => {
  const xml = await g("https://www.smartraveller.gov.au/countries/documents/index.rss", "text", { timeout: 120000 });
  return { items: rssItems(xml).map((x) => { const lvl = (x.summary.match(/(Exercise normal safety precautions|Exercise a high degree of caution|Reconsider your need to travel|Do not travel)/i) || [])[1] || "";
    return { title: "Australia: " + (lvl || x.title), detail: x.summary.slice(0, 400), date: x.date, url: x.link, sev: /do not travel|reconsider/i.test(lvl) ? 3 : /high degree/i.test(lvl) ? 2 : 1, kind: "Travel advisory", ccs: withOki(ccsInText(x.title)) }; }) };
});

feed("uk-travel", { name: "UK FCDO travel advice", org: "UK Foreign, Commonwealth & Development Office", cat: "Advisories", lic: "Open Government Licence v3", url: "https://www.gov.uk/foreign-travel-advice", everyHours: 24 });
run("uk-travel", async (g) => {
  const idx = await g("https://www.gov.uk/api/content/foreign-travel-advice"), kids = (idx.links && idx.links.children) || [], items = [];
  const A = { avoid_all_travel_to_whole_country: ["Advises against all travel", 3], avoid_all_travel_to_parts: ["Advises against all travel to parts", 3],
    avoid_all_but_essential_travel_to_whole_country: ["Advises against all but essential travel", 3], avoid_all_but_essential_travel_to_parts: ["Advises against all but essential travel to parts", 2] };
  for (const k of kids) {
    const nm = (k.details && k.details.country && k.details.country.name) || k.title, cc = ccFromName(nm); if (!cc) continue;
    if (items.length < 3 && kids.indexOf(k) > 10) break;
    try { const c = await get("https://www.gov.uk/api/content" + k.base_path, "json", { timeout: 15000 }), st = (c.details && c.details.alert_status) || [];
      const best = st.map((s) => A[s]).filter(Boolean).sort((a, b) => b[1] - a[1])[0] || ["No FCDO advice against travel", 1];
      items.push({ title: "UK: " + best[0], detail: (c.details && c.details.change_description) || "", date: c.public_updated_at, url: "https://www.gov.uk" + k.base_path, sev: best[1], kind: "Travel advisory", ccs: withOki([cc]) });
    } catch (e) {}
    await sleep(250);
  }
  if (items.length < 50) throw new Error("only " + items.length + " countries read");
  return { items };
});

// ---------------------------------------------------------------- health
for (const [id, name, org, url, lic, home] of [
  ["ecdc", "ECDC weekly communicable disease threats", "European Centre for Disease Prevention and Control", "https://www.ecdc.europa.eu/en/taxonomy/term/1307/feed", "ECDC copyright, reuse with attribution", "https://www.ecdc.europa.eu/"],
  ["un-news", "UN News", "United Nations", "https://news.un.org/feed/subscribe/en/news/all/rss.xml", "UN terms of use (attribution)", "https://news.un.org/"],
  ["iaea", "IAEA top news", "International Atomic Energy Agency", "https://www.iaea.org/feeds/topnews", "IAEA terms (attribution)", "https://www.iaea.org/"]]) {
  feed(id, { name, org, cat: /ecdc|cdc/.test(id) ? "Health" : "Events", lic, url: home });
  run(id, async (g) => {
    const items = rssItems(await g(url, "text")).filter((x) => within(x.date, 120)).map((x) => ({ title: x.title, detail: x.summary.slice(0, 500), date: x.date, url: x.link, sev: 1, kind: name, ccs: withOki(ccsInText(x.title + " " + x.summary.slice(0, 600))) }));
    return { items, globals: items.filter((x) => !x.ccs.length).slice(0, 20).map((x) => ({ ...x, ccs: undefined })) };
  });
}

feed("who-gho", { name: "WHO Global Health Observatory indicators", org: "World Health Organization", cat: "Health", lic: "CC BY-NC-SA 3.0 IGO (non-commercial)", nc: true, url: "https://www.who.int/data/gho", everyHours: 168 });
run("who-gho", async (g) => {
  const figures = {}, IND = [["WHOSIS_000001", "life_expectancy_years", "Dim1 eq 'SEX_BTSX'"], ["MDG_0000000007", "under5_mortality_per_1000", "Dim1 eq 'SEX_BTSX'"],
    ["MDG_0000000026", "maternal_mortality_per_100k", ""], ["UHC_INDEX_REPORTED", "uhc_service_coverage_index", ""], ["WHS4_100", "dtp3_immunisation_pct", ""]];
  for (const [code, key, flt] of IND) {
    try { const j = await g("https://ghoapi.azureedge.net/api/" + code + (flt ? "?$filter=" + encodeURIComponent(flt) : ""));
      for (const v of j.value || []) { const cc = ccFromA3(v.SpatialDim); if (!cc || v.NumericValue == null) continue; const f = (figures[cc] = figures[cc] || {});
        if (!f[key] || v.TimeDim > f[key].year) f[key] = { value: round(v.NumericValue), year: v.TimeDim }; } } catch (e) {}
    await sleep(300);
  }
  if (!Object.keys(figures).length) throw new Error("no indicator read");
  if (figures.jp) figures.oki = figures.jp;
  return { figures };
});

// ---------------------------------------------------------------- economy and development
feed("wdi", { name: "World Bank development indicators", org: "World Bank", cat: "Economy", lic: "CC BY 4.0", url: "https://data.worldbank.org/", everyHours: 168 });
run("wdi", async (g) => {
  const IND = [["SP.POP.TOTL", "population"], ["NY.GDP.MKTP.CD", "gdp_usd"], ["NY.GDP.PCAP.CD", "gdp_per_capita_usd"], ["FP.CPI.TOTL.ZG", "inflation_pct"], ["SL.UEM.TOTL.ZS", "unemployment_pct"],
    ["MS.MIL.XPND.GD.ZS", "military_spending_pct_gdp"], ["IT.NET.USER.ZS", "internet_users_pct"], ["EG.ELC.ACCS.ZS", "electricity_access_pct"], ["SI.POV.DDAY", "extreme_poverty_pct"],
    ["SP.URB.TOTL.IN.ZS", "urban_pct"], ["NE.EXP.GNFS.ZS", "exports_pct_gdp"], ["BX.TRF.PWKR.DT.GD.ZS", "remittances_pct_gdp"], ["SP.POP.0014.TO.ZS", "age_0_14_pct"], ["AG.LND.FRST.ZS", "forest_pct"]];
  const figures = {};
  for (const [code, key] of IND) {
    try { const j = await g("https://api.worldbank.org/v2/country/all/indicator/" + code + "?format=json&mrv=1&per_page=400");
      for (const r of j[1] || []) { const cc = ccFromA3(r.countryiso3code); if (!cc || r.value == null) continue; (figures[cc] = figures[cc] || {})[key] = { value: round(r.value, r.value > 1000 ? 0 : 2), year: +r.date }; } } catch (e) {}
    await sleep(300);
  }
  if (!Object.keys(figures).length) throw new Error("no indicator read");
  if (figures.jp) figures.oki = figures.jp;
  return { figures };
});

feed("imf", { name: "IMF World Economic Outlook figures (current year)", org: "International Monetary Fund (DataMapper)", cat: "Economy", lic: "IMF copyright; free reuse with attribution", url: "https://www.imf.org/external/datamapper/", everyHours: 168 });
run("imf", async (g) => {
  const yr = new Date().getUTCFullYear(), IND = [["NGDP_RPCH", "gdp_growth_pct"], ["PCPIPCH", "inflation_pct"], ["GGXWDG_NGDP", "govt_debt_pct_gdp"], ["LUR", "unemployment_pct"], ["BCA_NGDPD", "current_account_pct_gdp"]];
  const figures = {};
  for (const [code, key] of IND) {
    try { const j = await g("https://www.imf.org/external/datamapper/api/v1/" + code + "?periods=" + yr);
      for (const [a3, v] of Object.entries((j.values || {})[code] || {})) { const cc = ccFromA3(a3); if (cc && v[yr] != null) (figures[cc] = figures[cc] || {})[key] = { value: round(v[yr]), year: yr + " est." }; } } catch (e) {}
    await sleep(300);
  }
  if (!Object.keys(figures).length) throw new Error("no indicator read");
  if (figures.jp) figures.oki = figures.jp;
  return { figures };
});

feed("fx", { name: "Exchange rate against the US dollar", org: "ExchangeRate-API open access; currency codes from GeoNames", cat: "Economy", lic: "ExchangeRate-API open access terms (attribution)", url: "https://www.exchangerate-api.com/", everyHours: 12 });
run("fx", async (g) => {
  const r = await g("https://open.er-api.com/v6/latest/USD"), info = await g("https://download.geonames.org/export/dump/countryInfo.txt", "text"), figures = {};
  for (const l of info.split("\n")) { if (l.startsWith("#")) continue; const c = l.split("\t"), cc = ccFromA2(c[0]), cur = c[10]; if (!cc || !cur || !r.rates[cur]) continue;
    figures[cc] = { currency: cur, per_usd: r.rates[cur], at: r.time_last_update_utc }; }
  if (figures.jp) figures.oki = figures.jp;
  return { figures };
});

feed("wb-projects", { name: "World Bank projects (latest approvals)", org: "World Bank", cat: "Economy", lic: "CC BY 4.0", url: "https://projects.worldbank.org/", everyHours: 24 });
run("wb-projects", async (g) => {
  const j = await g("https://search.worldbank.org/api/v2/projects?format=json&rows=1500&os=0&srt=boardapprovaldate&order=desc&fl=id,project_name,countryshortname,countrycode,boardapprovaldate,totalamt,status,url");
  return { items: Object.values(j.projects || {}).map((p) => ({ title: "World Bank: " + p.project_name + (p.totalamt ? " · US$" + String(p.totalamt).replace(/,/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") : ""), detail: [p.status, p.countryshortname].filter(Boolean).join(" · "),
    date: p.boardapprovaldate, url: p.url || "https://projects.worldbank.org/en/projects-operations/project-detail/" + p.id, sev: 1, kind: "Development project", ccs: withOki([].concat(p.countrycode || []).map(ccFromA2).filter(Boolean)) })).filter((x) => within(x.date, 800)) };
});

feed("hdx", { name: "Humanitarian datasets updated (HDX)", org: "OCHA Humanitarian Data Exchange", cat: "Events", lic: "Per dataset (shown); catalogue metadata open", url: "https://data.humdata.org/", everyHours: 6 });
run("hdx", async (g) => {
  const j = await g("https://data.humdata.org/api/3/action/package_search?rows=500&sort=metadata_modified%20desc", "json", { timeout: 90000 });
  return { items: ((j.result || {}).results || []).map((d) => ({ title: "Dataset: " + d.title, detail: [d.organization && d.organization.title, d.license_title].filter(Boolean).join(" · "), date: d.metadata_modified,
    url: "https://data.humdata.org/dataset/" + d.name, sev: 1, kind: "Humanitarian dataset", ccs: withOki((d.groups || []).map((x) => ccFromA3(x.name)).filter(Boolean)) })).filter((x) => x.ccs.length && x.ccs.length <= 3) };
});

feed("usdm", { name: "US Drought Monitor (share of the country in drought)", org: "National Drought Mitigation Center, USDA, NOAA", cat: "Environment", lic: "Public domain (attribution requested)", url: "https://droughtmonitor.unl.edu/", everyHours: 24 });
run("usdm", async (g) => {
  const end = new Date(), start = new Date(Date.now() - 21 * 864e5), f = (d) => d.getUTCMonth() + 1 + "/" + d.getUTCDate() + "/" + d.getUTCFullYear();
  const rows = csvObjects(await g("https://usdmdataservices.unl.edu/api/USStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=total&startdate=" + f(start) + "&enddate=" + f(end) + "&statisticsType=1", "text"));
  const r = rows.sort((a, b) => String(b.MapDate).localeCompare(String(a.MapDate)))[0]; if (!r) throw new Error("no rows");
  return { figures: { us: { abnormally_dry_or_worse_pct: +r.D0, drought_pct: +r.D1, severe_pct: +r.D2, extreme_pct: +r.D3, exceptional_pct: +r.D4, week: r.MapDate } } };
});

feed("fema", { name: "US federal disaster declarations (OpenFEMA)", org: "Federal Emergency Management Agency", cat: "Hazards", lic: "US Government public domain", url: "https://www.fema.gov/disaster/declarations", everyHours: 3 });
run("fema", async (g) => {
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const j = await g("https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=declarationDate%20ge%20'" + since + "'&$orderby=declarationDate%20desc&$top=1000"), by = new Map();
  for (const d of j.DisasterDeclarationsSummaries || []) { const e = by.get(d.disasterNumber) || { ...d, areas: [] }; e.areas.push(d.designatedArea); by.set(d.disasterNumber, e); }
  return { items: [...by.values()].map((d) => ({ title: "FEMA " + d.declarationType + "-" + d.disasterNumber + ": " + d.declarationTitle + " (" + d.state + ")", detail: d.incidentType + " · " + d.areas.length + " designated area(s): " + d.areas.slice(0, 8).join(", "),
    date: d.declarationDate, url: "https://www.fema.gov/disaster/" + d.disasterNumber, sev: d.declarationType === "DR" ? 2 : 1, kind: "Disaster declaration", ccs: ["us"] })) };
});

// ---------------------------------------------------------------- events, politics
feed("wiki-events", { name: "Wikipedia Current events portal", org: "Wikipedia contributors", cat: "Events", lic: "CC BY-SA 4.0", url: "https://en.wikipedia.org/wiki/Portal:Current_events", everyHours: 1 });
run("wiki-events", async (g) => {
  const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], items = [];
  for (let k = 0; k < 4; k++) {
    const d = new Date(Date.now() - k * 864e5), page = "Portal:Current_events/" + d.getUTCFullYear() + "_" + M[d.getUTCMonth()] + "_" + d.getUTCDate(), date = d.toISOString().slice(0, 10) + "T12:00";
    let html; try { html = (await g("https://en.wikipedia.org/w/api.php?action=parse&page=" + encodeURIComponent(page) + "&prop=text&format=json&formatversion=2&redirects=1")).parse.text; } catch (e) { continue; }
    let cat = "";
    for (const part of html.split(/(<p><b>[^<]*<\/b><\/p>|<div role="heading"[^>]*>[\s\S]*?<\/div>)/)) {
      const hm = part.match(/^<p><b>([^<]*)<\/b>|^<div role="heading"[^>]*>([\s\S]*?)<\/div>/); if (hm) { cat = unhtml(hm[1] || hm[2]); continue; }
      // leaf list items (no nested list) are the event lines; their parents are topic headings
      for (const li of part.match(/<li>(?:(?!<li>|<ul>)[\s\S])*?<\/li>/g) || []) {
        const txt = unhtml(li).replace(/\s*\((?:[^()]*)\)\s*$/, ""); if (txt.length < 30) continue;
        const src = (li.match(/<a[^>]*class="external[^"]*"[^>]*href="([^"]+)"/) || li.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="external/) || [])[1] || "https://en.wikipedia.org/wiki/" + page;
        items.push({ title: txt.slice(0, 220), detail: cat ? "Wikipedia section: " + cat : "", date, url: src, sev: /killed|attack|war|explosion|earthquake|coup|missile/i.test(txt) ? 2 : 1, kind: "Current event (Wikipedia)", ccs: withOki(ccsInText(txt)) });
      }
    }
    await sleep(300);
  }
  if (!items.length) throw new Error("no event lines read");
  return { items, globals: items.filter((x) => !x.ccs.length).slice(0, 30).map((x) => ({ ...x, ccs: undefined })) };
});

feed("elections", { name: "Elections and referendums (Wikidata)", org: "Wikidata contributors", cat: "Politics", lic: "CC0", url: "https://www.wikidata.org/", everyHours: 24 });
run("elections", async (g) => {
  const from = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
  // class tree first, then the dated items: the reverse order times out on the public endpoint
  const q = `SELECT ?e ?l ?d ?iso WHERE { hint:Query hint:optimizer "None". ?type wdt:P279* wd:Q40231. ?e wdt:P31 ?type. ?e wdt:P585 ?d.
    FILTER(?d >= "${from}T00:00:00Z"^^xsd:dateTime && ?d <= "${to}T00:00:00Z"^^xsd:dateTime) ?e wdt:P17/wdt:P297 ?iso. ?e rdfs:label ?l. FILTER(lang(?l) = "en") } LIMIT 4000`;
  let j = null, last = null;
  for (let t = 0; t < 2 && !j; t++) { try { j = await g("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), "json", { timeout: 90000, headers: { accept: "application/sparql-results+json" } }); } catch (e) { last = e; await sleep(5000); } }
  if (!j) throw last;
  return { items: j.results.bindings.map((b) => ({ title: b.l.value, detail: Date.parse(b.d.value) > Date.now() ? "Scheduled" : "Held", date: b.d.value, url: b.e.value, sev: 1, kind: "Election", ccs: one(ccFromA2(b.iso.value)) })) };
});

feed("rainviewer", { name: "RainViewer global radar mosaic (map overlay)", org: "RainViewer", cat: "Hazards", lic: "Free public API, attribution; personal/non-commercial use", nc: true, url: "https://www.rainviewer.com/" });
run("rainviewer", async (g) => {
  const j = await g("https://api.rainviewer.com/public/weather-maps.json"), last = (j.radar.past || []).slice(-1)[0];
  return { items: [], globals: [{ title: "Radar frame " + new Date(last.time * 1000).toISOString().slice(11, 16) + "Z", date: new Date(last.time * 1000).toISOString(), url: j.host + last.path, kind: "tiles" }] };
});

await runAll(6);
writeAll(IDS);
process.exit(0);   // abandoned feeds may still hold open requests
