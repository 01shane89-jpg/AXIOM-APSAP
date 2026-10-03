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
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const tidy = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 140);
// three tries with a pause: some agency servers answer a busy moment with a 500/429 or drop the connection
async function get(u, as = "json", headers = {}) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${u.slice(0, 80)}`);
      return as === "json" ? await r.json() : await r.text();
    } catch (e) { last = e; await pause(3000 * (i + 1)); }
  }
  throw new Error(String(last.message || last) + (last.cause ? " (" + (last.cause.code || last.cause.message) + ")" : ""));
}
// a small, forgiving reader for the flat XML lists below: the text of each <tag> inside each <item>
function xmlItems(xml, item) {
  const out = [], re = new RegExp(`<${item}>([\\s\\S]*?)</${item}>`, "g"); let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function xmlTag(s, t) { const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(s); return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") : ""; }
const https = (u) => /^https:\/\//.test(String(u || "")) ? String(u) : null;
const one = (a) => (a.length === 1 ? a[0] : a.length ? a : null);
// 511 traveller sites built on the same platform (Iteris/IBI): the camera list behind each site's own public Cameras page,
// read 100 at a time (the most it gives), and each camera's still image at /map/Cctv/<image id> on the same site
async function atis(host) {
  const out = [];
  for (let start = 0, total = 1; start < total && start < 20000; start += 100) {
    const q = encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: "" }, { name: "sortOrder", s: true }], order: [{ column: 1, dir: "asc" }], start, length: 100, search: { value: "" } }));
    const j = await get(`https://${host}/List/GetData/Cameras?query=${q}&lang=en`, "json", { "X-Requested-With": "XMLHttpRequest" }).catch((e) => { throw new Error(e.message + " at camera " + start); });
    total = j.recordsTotal || 0;
    (j.data || []).forEach((c) => {
      const m = /POINT \(([-\d.]+) ([-\d.]+)\)/.exec((((c.latLng || {}).geography) || {}).wellKnownText || "");
      const imgs = (c.images || []).filter((i) => !i.disabled && !i.blocked && i.imageUrl).map((i) => https(new URL(i.imageUrl, `https://${host}/`).href)).filter(Boolean);
      if (m && imgs.length) out.push([String(c.id), r5(m[2]), r5(m[1]), tidy(c.location || c.roadway || "Camera " + c.id), one(imgs)]);
    });
    await pause(250);
  }
  return out;
}
// CARS program states: the cameras_v1 list their 511 sites use, with a still image or a video's preview still per view
async function cars(p) {
  const j = await get(`https://${p}.carsprogram.org/cameras_v1/api/cameras`);
  return j.filter((c) => c.public !== false && c.active !== false && c.location).map((c) => {
    const v = (c.views || []).map((v) => https(v.type === "STILL_IMAGE" ? v.url : v.videoPreviewUrl)).filter(Boolean);
    return v.length ? [String(c.id), r5(c.location.latitude), r5(c.location.longitude), tidy(c.name), one(v)] : null;
  }).filter(Boolean);
}
const ATIS_LIC = "Public camera images on the agency's 511 traveller website (no open-data licence stated)";
const atisSrc = (id, host, tz, cc, country, agency) => ({ id, tz, cc, country, agency, every: 2, licence: ATIS_LIC, page: `https://${host}/cctv`, list: () => atis(host) });
const carsSrc = (id, p, host, tz, country, agency) => ({ id, tz, cc: "us", country, agency, every: 5, licence: "Public camera images on the agency's 511 traveller website (no open-data licence stated)", page: `https://${host}/`, list: () => cars(p) });

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
  /* ---- more US states and Canadian provinces (511 traveller sites) ---- */
  atisSrc("us-ga", "511ga.org", "America/New_York", "us", "United States (Georgia)", "Georgia DOT (511 Georgia)"),
  atisSrc("us-fl", "fl511.com", "America/New_York", "us", "United States (Florida)", "Florida DOT (FL511)"),
  atisSrc("us-pa", "511pa.com", "America/New_York", "us", "United States (Pennsylvania)", "PennDOT (511PA)"),
  atisSrc("us-ne511", "newengland511.org", "America/New_York", "us", "United States (Vermont, New Hampshire, Maine)", "New England 511 (VTrans, NHDOT, MaineDOT)"),
  atisSrc("us-ct", "ctroads.org", "America/New_York", "us", "United States (Connecticut)", "Connecticut DOT (CTroads)"),
  atisSrc("us-wi", "511wi.gov", "America/Chicago", "us", "United States (Wisconsin)", "Wisconsin DOT (511 Wisconsin)"),
  atisSrc("us-la", "511la.org", "America/Chicago", "us", "United States (Louisiana)", "Louisiana DOTD (511LA)"),
  atisSrc("us-az", "az511.gov", "America/Phoenix", "us", "United States (Arizona)", "Arizona DOT (AZ511)"),
  atisSrc("us-ut", "udottraffic.utah.gov", "America/Denver", "us", "United States (Utah)", "Utah DOT (UDOT Traffic)"),
  atisSrc("us-id", "511.idaho.gov", "America/Boise", "us", "United States (Idaho)", "Idaho Transportation Department (511 Idaho)"),
  atisSrc("us-nv", "nvroads.com", "America/Los_Angeles", "us", "United States (Nevada)", "Nevada DOT (NVroads)"),
  atisSrc("us-ak", "511.alaska.gov", "America/Anchorage", "us", "United States (Alaska)", "Alaska DOT&PF (Alaska 511)"),
  carsSrc("us-co", "cotg", "cotrip.org", "America/Denver", "United States (Colorado)", "Colorado DOT (COtrip)"),
  carsSrc("us-mn", "mntg", "511mn.org", "America/Chicago", "United States (Minnesota)", "Minnesota DOT (511MN)"),
  carsSrc("us-ia", "iatg", "511ia.org", "America/Chicago", "United States (Iowa)", "Iowa DOT (511IA)"),
  carsSrc("us-in", "intg", "511in.org", "America/Indiana/Indianapolis", "United States (Indiana)", "Indiana DOT (511IN)"),
  carsSrc("us-ne", "netg", "511.nebraska.gov", "America/Chicago", "United States (Nebraska)", "Nebraska DOT (Nebraska 511)"),
  carsSrc("us-ks", "kstg", "kandrive.gov", "America/Chicago", "United States (Kansas)", "Kansas DOT (KanDrive)"),
  { id: "us-wa", tz: "America/Los_Angeles", cc: "us", country: "United States (Washington)", agency: "Washington State DOT (WSDOT)", every: 2,
    licence: "WSDOT traveler information (public)", page: "https://wsdot.com/travel/real-time/cameras",
    async list() {
      const x = await get("https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/kml.aspx", "text");
      const out = [], re = /<Placemark id="ID (\d+)"><name><!\[CDATA\[([^\]]*)\]\]><\/name><description><!\[CDATA\[[\s\S]*?src="([^"]+)"[\s\S]*?<coordinates>([-\d.]+),([-\d.]+)/g; let m;
      // only WSDOT's own cameras (the list also links some private and partner webcams)
      while ((m = re.exec(x))) if (/^https:\/\/images\.wsdot\.wa\.gov\//.test(m[3])) out.push([m[1], r5(m[5]), r5(m[4]), tidy(m[2]), m[3]]);
      return out;
    } },
  { id: "us-or", tz: "America/Los_Angeles", cc: "us", country: "United States (Oregon)", agency: "Oregon DOT (TripCheck)", every: 5,
    licence: "TripCheck public camera images", page: "https://tripcheck.com/",
    async list() {
      const j = JSON.parse((await get("https://tripcheck.com/Scripts/map/data/cctvinventory.js", "text")).replace(/^[^{[]*/, "").replace(/;?\s*$/, ""));
      return (j.features || j).map((f) => { const a = f.attributes || {}; return a.filename ? [String(a.cameraId) + "-" + a.publishedImageId, r5(a.latitude), r5(a.longitude), tidy(a.title), https("https://www.tripcheck.com/RoadCams/cams/" + encodeURIComponent(a.filename))] : null; }).filter(Boolean);
    } },
  atisSrc("ca-on", "511on.ca", "America/Toronto", "ca", "Canada (Ontario)", "Ontario Ministry of Transportation (Ontario 511)"),
  atisSrc("ca-ab", "511.alberta.ca", "America/Edmonton", "ca", "Canada (Alberta)", "Alberta Transportation (511 Alberta)"),
  atisSrc("ca-nb", "511.gnb.ca", "America/Moncton", "ca", "Canada (New Brunswick)", "New Brunswick Transportation (511 NB)"),
  atisSrc("ca-ns", "511.novascotia.ca", "America/Halifax", "ca", "Canada (Nova Scotia)", "Nova Scotia Public Works (511 Nova Scotia)"),
  atisSrc("ca-nl", "511nl.ca", "America/St_Johns", "ca", "Canada (Newfoundland and Labrador)", "Newfoundland and Labrador Transportation (511 NL)"),
  /* ---- Asia-Pacific and Europe ---- */
  { id: "au-qld", tz: "Australia/Brisbane", cc: "au", country: "Australia (Queensland)", agency: "Queensland Department of Transport and Main Roads (QLDTraffic)", every: 2,
    licence: "Creative Commons Attribution 4.0", page: "https://www.data.qld.gov.au/dataset/131940-traffic-and-travel-information-geojson-api",
    async list() {
      // the shared public key printed in QLDTraffic's own API specification for anyone to use (no account)
      const j = await get("https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b");
      return j.features.map((f) => [String(f.properties.id), r5(f.geometry.coordinates[1]), r5(f.geometry.coordinates[0]), tidy(f.properties.description), https(f.properties.image_url)]);
    } },
  { id: "is-vegagerdin", tz: "Atlantic/Reykjavik", cc: "is", country: "Iceland", agency: "Icelandic Road and Coastal Administration (Vegagerðin)", every: 10,
    licence: "Vegagerðin open data", page: "https://www.vegagerdin.is/vegakerfid/umferd/vefmyndavelar/",
    async list() {
      const j = await get("https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1"), by = new Map();
      j.forEach((c) => { const k = String(c.Maelist_nr); if (!by.has(k)) by.set(k, { c, u: [] }); if (https(c.Slod)) by.get(k).u.push(c.Slod); });
      return [...by.entries()].map(([k, { c, u }]) => u.length ? [k, r5(c.Breidd), r5(c.Lengd), tidy(c.Myndavel + (c.Vegheiti ? ", " + c.Vegheiti : "")), one(u)] : null).filter(Boolean);
    } },
  { id: "lt-eismoinfo", tz: "Europe/Vilnius", cc: "lt", country: "Lithuania", agency: "Lithuanian Road Administration (eismoinfo.lt)", every: 5,
    licence: "Lithuanian Road Administration open data", page: "https://eismoinfo.lt/",
    async list() {
      const j = await get("https://eismoinfo.lt/eismoinfo-backend/camera-info-table");
      // positions come in the Lithuanian grid (LKS-94, EPSG:3346), converted here to latitude and longitude
      return j.map((c) => { const [lat, lon] = lks94(c.x, c.y); return [String(c.id), r5(lat), r5(lon), tidy(c.name + (c.roadName ? ", " + c.roadName : "")), https(c.image)]; });
    } },
];
// LKS-94 (Transverse Mercator on GRS80, central meridian 24°E, scale 0.9998, false easting 500 km) to latitude and longitude
function lks94(x, y) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9998, lon0 = 24 * Math.PI / 180, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = (x - 500000) / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}

// fetches up to six images spread over the list and reports how many came back as real, different pictures (a source whose
// images are all one identical file is serving a placeholder, not cameras)
async function checkImages(cams) {
  const { createHash } = await import("node:crypto");
  const all = cams.filter((c) => c[4]), pick = [0, 1, 2, 3, 4, 5].map((i) => all[Math.floor((i + 0.5) * all.length / 6)]).filter(Boolean), res = [], hashes = new Set();
  let good = 0;
  for (const c of pick) {
    const u = Array.isArray(c[4]) ? c[4][0] : c[4];
    try {
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) });
      const b = Buffer.from(await r.arrayBuffer()), ct = r.headers.get("content-type") || "";
      if (r.ok && /image/.test(ct) && b.length > 1000) { good++; hashes.add(createHash("sha1").update(b).digest("hex")); }
      res.push(`${r.status} ${ct.split(";")[0]} ${b.length}B`);
    } catch (e) { res.push("ERR " + e.message); }
  }
  return `${good}/${pick.length} images, ${hashes.size} different (${res.join("; ")}) hosts ${[...new Set(all.map((c) => new URL(Array.isArray(c[4]) ? c[4][0] : c[4]).host))].slice(0, 6).join(" ")}`;
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
