// Builds the traffic camera lists for Map overlays > Infrastructure > Traffic cameras (assets/osap-cams.js).
// Only cameras that a government or transport agency publishes itself as open data, with no key, account or login:
// never private, unsecured or scraped cameras. Each source becomes data/cams/<id>.json, a list of
// [camera id, lat, lon, name, image URL or [URLs]]; data/cams/index.json lists the sources with their agency, licence,
// country, box and count. The page loads a source's list only when the camera switch is on and the map shows its box, and
// the browser then fetches each still image straight from the agency when a camera is hovered or tapped.
// A source that fails or comes back implausibly small keeps its previous file, and the run says so.
// Run: node tools/build_cams.mjs [outdir]        (default data/cams; CHECK_IMAGES=1 also fetches two images per source)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] || "data/cams";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; OSAP camera list builder; +https://01shane89-jpg.github.io/AXIOM-APSAP/)" };
const r5 = (v) => Math.round(+v * 1e5) / 1e5;
const tidy = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 140);
async function get(u, as = "json") {
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${u}`);
  return as === "json" ? r.json() : r.text();
}
// a small, forgiving reader for the flat XML lists below: the text of each <tag> inside each <item>
function xmlItems(xml, item) {
  const out = [], re = new RegExp(`<${item}>([\\s\\S]*?)</${item}>`, "g"); let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function xmlTag(s, t) { const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(s); return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") : ""; }
const https = (u) => /^https:\/\//.test(String(u || "")) ? String(u) : null;

export const SOURCES = [
  { id: "sg-lta", tz: "Asia/Singapore", cc: "sg", country: "Singapore", agency: "Land Transport Authority (LTA), via data.gov.sg", every: 1,
    licence: "Singapore Open Data Licence", page: "https://data.gov.sg/datasets/d_6cdb6b405b25aaaacbaf7689bcc6fae0/view",
    // the image addresses change every minute, so the page asks the same keyless API for the current one (live: true)
    live: "https://api.data.gov.sg/v1/transport/traffic-images",
    async list() {
      // one answer can hold only the cameras that sent an image that minute, so several moments in the last week are merged
      const seen = new Map(), at = [0, 1, 6, 24, 72, 168].map((h) => h ? "?date_time=" + new Date(Date.now() - h * 36e5).toISOString().slice(0, 19) : "");
      for (const q of at) {
        try {
          const j = await get("https://api.data.gov.sg/v1/transport/traffic-images" + q);
          (((j.items || [])[0] || {}).cameras || []).forEach((c) => { if (!seen.has(String(c.camera_id))) seen.set(String(c.camera_id), c); });
          console.log(`  sg-lta${q || " now"}: ${(((j.items || [])[0] || {}).cameras || []).length}`);
        } catch (e) { console.log(`  sg-lta${q}: ${e.message}`); }
      }
      return [...seen.values()].map((c) => [String(c.camera_id), r5(c.location.latitude), r5(c.location.longitude), "LTA camera " + c.camera_id, null]);
    } },
  { id: "hk-td", tz: "Asia/Hong_Kong", cc: "hk", country: "Hong Kong", agency: "Transport Department, Hong Kong SAR Government (DATA.GOV.HK)", every: 2,
    licence: "DATA.GOV.HK terms and conditions", page: "https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images",
    async list() {
      const x = await get("https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml", "text");
      return xmlItems(x, "image").map((s) => [xmlTag(s, "key"), r5(xmlTag(s, "latitude")), r5(xmlTag(s, "longitude")),
        tidy(xmlTag(s, "description") + (xmlTag(s, "district") ? ", " + xmlTag(s, "district") : "")), https(xmlTag(s, "url"))]);
    } },
  { id: "nz-nzta", tz: "Pacific/Auckland", cc: "nz", country: "New Zealand", agency: "NZ Transport Agency Waka Kotahi (traffic.nzta.govt.nz)", every: 2,
    licence: "Creative Commons Attribution 4.0", page: "https://www.nzta.govt.nz/traffic-and-travel-information/infoconnect-section-page/",
    async list() {
      const x = await get("https://trafficnz.info/service/traffic/rest/4/cameras/all", "text");
      return xmlItems(x, "camera").filter((s) => xmlTag(s, "offline") !== "true" && xmlTag(s, "underMaintenance") !== "true").map((s) => {
        const body = s.replace(/<journey>[\s\S]*?<\/journey>|<journeyLeg>[\s\S]*?<\/journeyLeg>|<region>[\s\S]*?<\/region>|<way>[\s\S]*?<\/way>/g, "");
        const img = xmlTag(body, "imageUrl");
        return [xmlTag(body, "id"), r5(xmlTag(body, "latitude")), r5(xmlTag(body, "longitude")),
          tidy(xmlTag(body, "name") + (xmlTag(body, "description") ? ": " + xmlTag(body, "description") : "")), img ? https("https://trafficnz.info" + img) : null];
      });
    } },
  { id: "gb-tfl", tz: "Europe/London", cc: "gb", country: "United Kingdom (London)", agency: "Transport for London JamCams (TfL Open Data)", every: 5,
    licence: "Powered by TfL Open Data (Open Government Licence)", page: "https://tfl.gov.uk/info-for/open-data-users/",
    async list() {
      const j = await get("https://api.tfl.gov.uk/Place/Type/JamCam");
      return j.map((p) => {
        const a = {}; (p.additionalProperties || []).forEach((q) => { a[q.key] = q.value; });
        if (a.available === "false") return null;
        return [String(p.id).replace(/^JamCams_/, ""), r5(p.lat), r5(p.lon), tidy(p.commonName + (a.view ? ", looking " + a.view : "")), https(a.imageUrl)];
      }).filter(Boolean);
    } },
  { id: "fi-digitraffic", tz: "Europe/Helsinki", cc: "fi", country: "Finland", agency: "Fintraffic Digitraffic road weather cameras", every: 10,
    licence: "Creative Commons Attribution 4.0", page: "https://www.digitraffic.fi/en/road-traffic/",
    async list() {
      const j = await get("https://tie.digitraffic.fi/api/weathercam/v1/stations");
      return j.features.filter((f) => f.properties.collectionStatus === "GATHERING").map((f) => {
        const pr = (f.properties.presets || []).filter((p) => p.inCollection).map((p) => "https://weathercam.digitraffic.fi/" + p.id + ".jpg");
        return pr.length ? [f.properties.id, r5(f.geometry.coordinates[1]), r5(f.geometry.coordinates[0]), tidy(String(f.properties.name).replace(/_/g, " ")), pr.length === 1 ? pr[0] : pr] : null;
      }).filter(Boolean);
    } },
  { id: "ca-drivebc", tz: "America/Vancouver", cc: "ca", country: "Canada (British Columbia)", agency: "BC Ministry of Transportation and Transit (DriveBC)", every: 15,
    licence: "Open Government Licence - British Columbia", page: "https://catalogue.data.gov.bc.ca/dataset/drivebc-highwaycams",
    async list() {
      const j = await get("https://www.drivebc.ca/api/webcams/");
      return j.filter((c) => c.is_on !== false && c.should_appear !== false && c.location && c.links && c.links.imageDisplay).map((c) =>
        [String(c.id), r5(c.location.coordinates[1]), r5(c.location.coordinates[0]), tidy(c.name + (c.caption ? ": " + c.caption : "")),
          https("https://www.drivebc.ca" + String(c.links.imageDisplay).replace(/\?.*$/, ""))]);
    } },
  { id: "au-nsw", tz: "Australia/Sydney", cc: "au", country: "Australia (New South Wales)", agency: "Transport for NSW Live Traffic", every: 1,
    licence: "Creative Commons Attribution 4.0", page: "https://opendata.transport.nsw.gov.au/dataset/live-traffic-cameras",
    async list() {
      const j = await get("https://data.livetraffic.com/cameras/traffic-cam.json");
      return j.features.map((f) => [String(f.id), r5(f.geometry.coordinates[1]), r5(f.geometry.coordinates[0]),
        tidy(f.properties.title + (f.properties.view ? ": " + f.properties.view : "")), https(f.properties.href)]);
    } },
  { id: "us-caltrans", tz: "America/Los_Angeles", cc: "us", country: "United States (California)", agency: "California Department of Transportation (Caltrans)", every: 5,
    licence: "Caltrans public data", page: "https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm",
    async list() {
      const out = [];
      for (let d = 1; d <= 12; d++) {
        const dd = String(d).padStart(2, "0");
        const j = await get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`);
        (j.data || []).forEach((e) => {
          const c = e.cctv || {}, l = c.location || {}, img = (((c.imageData || {}).static) || {}).currentImageURL;
          if (c.inService !== "true" || !https(img)) return;
          out.push(["d" + d + "-" + c.index, r5(l.latitude), r5(l.longitude), tidy(l.locationName + (l.nearbyPlace ? ", " + l.nearbyPlace : "") + (l.direction ? " (" + l.direction + ")" : "")), img]);
        });
      }
      return out;
    } },
  { id: "us-nycdot", tz: "America/New_York", cc: "us", country: "United States (New York City)", agency: "NYC Department of Transportation", every: 1,
    licence: "NYC DOT public traffic cameras", page: "https://webcams.nyctmc.org/",
    async list() {
      const j = await get("https://webcams.nyctmc.org/api/cameras");
      return j.filter((c) => c.isOnline !== "false" && c.isOnline !== false).map((c) => [String(c.id), r5(c.latitude), r5(c.longitude), tidy(c.name + (c.area ? ", " + c.area : "")), https(c.imageUrl)]);
    } },
];

async function checkImages(cams) {
  const pick = cams.filter((c) => c[4]).slice(0, 2), res = [];
  for (const c of pick) {
    const u = Array.isArray(c[4]) ? c[4][0] : c[4];
    try {
      const r = await fetch(u, { headers: { ...UA, Referer: "https://01shane89-jpg.github.io/" }, signal: AbortSignal.timeout(30000) });
      const b = await r.arrayBuffer();
      res.push(`${r.status} ${r.headers.get("content-type")} ${b.byteLength}B`);
    } catch (e) { res.push("ERR " + e.message); }
  }
  return res.join("; ");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  const ixPath = join(OUT, "index.json");
  const old = existsSync(ixPath) ? JSON.parse(readFileSync(ixPath, "utf8")) : { sources: [] };
  const sources = [];
  let bad = 0;
  for (const s of SOURCES) {
    const prev = old.sources.find((o) => o.id === s.id);
    const meta = { id: s.id, cc: s.cc, tz: s.tz, country: s.country, agency: s.agency, licence: s.licence, page: s.page, every: s.every };
    if (s.live) meta.live = s.live;
    try {
      const t = Date.now();
      const cams = (await s.list()).filter((c) => c && c[0] && isFinite(c[1]) && isFinite(c[2]) && Math.abs(c[1]) <= 90 && Math.abs(c[2]) <= 180 && (c[1] || c[2]) && (c[4] || s.live));
      if (!cams.length || (prev && cams.length < prev.n * 0.5)) throw new Error(`only ${cams.length} cameras (had ${prev ? prev.n : 0})`);
      const lat = cams.map((c) => c[1]), lon = cams.map((c) => c[2]);
      meta.n = cams.length; meta.box = [Math.min(...lat), Math.min(...lon), Math.max(...lat), Math.max(...lon)].map(r5);
      meta.checked = new Date().toISOString().slice(0, 16) + "Z";
      writeFileSync(join(OUT, s.id + ".json"), JSON.stringify({ id: s.id, cams }).replace(/\],\[/g, "],\n["));
      const img = process.env.CHECK_IMAGES ? " images: " + (s.live ? "live (fetched by the page)" : await checkImages(cams)) : "";
      console.log(`${s.id}: ${cams.length} cameras in ${Date.now() - t} ms${img}`);
      sources.push(meta);
    } catch (e) {
      bad++;
      console.log(`::warning::${s.id}: ${e.message}${prev ? " (kept the previous list)" : " (left out)"}`);
      if (prev) sources.push({ ...meta, n: prev.n, box: prev.box, checked: prev.checked, stale: true });
    }
  }
  writeFileSync(ixPath, JSON.stringify({ built: new Date().toISOString().slice(0, 16) + "Z", sources }, null, 1) + "\n");
  console.log(`${sources.length} sources, ${sources.reduce((a, s) => a + s.n, 0)} cameras, ${bad} failed`);
}
