// Test only: from a GitHub runner, (1) loads real images from every camera source already in data/cams in a real browser
// (Chromium), the way the page does, and (2) checks candidate official, keyless camera lists for more countries and US states:
// status, type, size, a sample and one image from each. Prints to the log; writes nothing. Run: node tools/probe_cams.mjs
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
const UA = "AXIOM-OSAP/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const O = "https://01shane89-jpg.github.io";
const only = process.env.ONLY || "";

async function get(u, ms = 40000, headers = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, Origin: O, ...headers }, signal: AbortSignal.timeout(ms), redirect: "follow" });
    const b = Buffer.from(await r.arrayBuffer());
    return { s: r.status, ct: r.headers.get("content-type") || "", cors: r.headers.get("access-control-allow-origin") || "", n: b.length, b, ms: Date.now() - t0, url: r.url };
  } catch (e) { return { s: 0, err: String(e.cause?.code || e.name || e).slice(0, 80), ms: Date.now() - t0, b: Buffer.alloc(0), n: 0, ct: "" }; }
}
const line = (k, r) => console.log(`${k}  ${r.s || r.err}  ${r.ct.split(";")[0]}  ${r.n}B  ${r.ms}ms${r.cors ? "  cors=" + r.cors : ""}`);
function sample(r, max = 700) {
  const t = r.b.toString("utf8");
  try {
    const j = JSON.parse(t);
    const arr = Array.isArray(j) ? j : j.features || j.data || j.items || j.cameras || j.item2 || j.results || j.layers || Object.values(j).find(Array.isArray);
    if (Array.isArray(arr)) console.log(`   array ${arr.length}; first: ${JSON.stringify(arr[0]).slice(0, max)}`);
    else console.log("   json keys: " + Object.keys(j).slice(0, 15).join(",") + "  " + t.slice(0, 300));
    return j;
  } catch { console.log("   text: " + t.slice(0, 300).replace(/\s+/g, " ")); return null; }
}
async function img(u, label = "  img") { const r = await get(u, 30000); line(label + " " + u.slice(0, 140), r); return r.s === 200 && /image/.test(r.ct) && r.n > 500; }

/* ---------- 1. real images from today's sources, in Chromium ---------- */
async function browserCheck() {
  const ix = JSON.parse(await readFile("data/cams/index.json", "utf8"));
  const { chromium } = await import("playwright");
  const srv = createServer((q, s) => { s.writeHead(200, { "content-type": "text/html" }); s.end("<!doctype html><title>t</title>"); }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const br = await chromium.launch();
  const page = await (await br.newContext()).newPage();
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  console.log("\n##### 1. Real images in a browser (4 per source, no-referrer as the page does)");
  for (const s of ix.sources) {
    const list = JSON.parse(await readFile(`data/cams/${s.id}.json`, "utf8")).cams;
    let urls = [];
    if (s.live) {
      const r = await get(s.live); const j = r.s === 200 ? JSON.parse(r.b) : {};
      urls = (((j.items || [])[0] || {}).cameras || []).slice(0, 4).map((c) => c.image);
    } else for (let i = 0; i < 4; i++) { const c = list[Math.floor((i + 0.5) * list.length / 4)]; const u = Array.isArray(c[4]) ? c[4][0] : c[4]; if (u) urls.push(u + (u.includes("?") ? "&" : "?") + "t=" + Math.floor(Date.now() / 6e4)); }
    const res = await page.evaluate(async (urls) => Promise.all(urls.map((u) => new Promise((ok) => {
      const im = new Image(), t0 = performance.now(); im.referrerPolicy = "no-referrer";
      const tm = setTimeout(() => ok({ u, r: "timeout 20s" }), 20000);
      im.onload = () => { clearTimeout(tm); ok({ u, r: `ok ${im.naturalWidth}x${im.naturalHeight} ${Math.round(performance.now() - t0)}ms` }); };
      im.onerror = () => { clearTimeout(tm); ok({ u, r: `error ${Math.round(performance.now() - t0)}ms` }); };
      im.src = u;
    }))), urls);
    console.log(`${s.id} (${s.n})`); res.forEach((x) => console.log(`   ${x.r}  ${x.u.slice(0, 120)}`));
    if (s.id === "us-nycdot") { const r = await get(urls[0]); line("   NYC plain fetch", r); console.log("   final url " + (r.url || "")); }
  }
  await br.close(); srv.close();
}

/* ---------- 2. candidate lists ---------- */
const DT = encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: "" }, { name: "sortOrder", s: true }, { name: "roadway", s: true }], order: [{ column: 1, dir: "asc" }, { column: 2, dir: "asc" }], start: 0, length: 5, search: { value: "" } }));
const ATIS = ["511ga.org", "fl511.com", "511ny.org", "az511.gov", "511wi.gov", "511la.org", "511.idaho.gov", "nvroads.com", "ctroads.org", "511.alaska.gov",
  "udottraffic.utah.gov", "511pa.com", "511.alberta.ca", "511on.ca", "hotline.gov.sk.ca", "511.gnb.ca", "511.novascotia.ca", "511nl.ca", "www.511virginia.org", "511.vermont.gov", "newengland511.org", "511mt.net", "www.drivetexas.org"];
const CARS = ["cotg", "mntg", "iatg", "netg", "kstg", "matg", "nhtg", "ndtg", "sdtg", "mttg", "intg", "vttg", "aktg", "latg", "wytg", "patg", "ohtg"];
async function candidates() {
  console.log("\n##### 2a. ATIS / IBI 511 sites: the public camera list behind each site's own Cameras page, then one image");
  for (const h of ATIS) {
    const a = await get(`https://${h}/map/mapIcons/Cameras`, 30000); line(`${h} mapIcons`, a); if (a.s === 200) sample(a, 300);
    const b = await get(`https://${h}/List/GetData/Cameras?query=${DT}&lang=en`, 30000, { "X-Requested-With": "XMLHttpRequest" }); line(`${h} GetData`, b);
    const j = b.s === 200 ? sample(b, 900) : null;
    const d = j && (j.data || [])[0];
    if (d) {
      const id = (d.images && d.images[0] && (d.images[0].id || d.images[0].imageId)) || d.id || d.DT_RowId;
      console.log(`   recordsTotal ${j.recordsTotal}`);
      const iu = d.images && d.images[0] && d.images[0].url ? new URL(d.images[0].url, `https://${h}/`).href : `https://${h}/map/Cctv/${id}`;
      await img(iu);
    }
  }
  console.log("\n##### 2b. CARS program states (cameras_v1)");
  for (const p of CARS) {
    const r = await get(`https://${p}.carsprogram.org/cameras_v1/api/cameras`, 30000); line(p, r);
    if (r.s === 200) { const j = sample(r, 900); const c = Array.isArray(j) && j[0]; const v = c && (c.views || [])[0]; const u = v && (v.url || v.videoPreviewUrl); if (u) await img(u); }
  }
  console.log("\n##### 2c. Others");
  const one = [
    ["WSDOT arcgis", "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer?f=pjson"],
    ["WSDOT arcgis l0", "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2"],
    ["WSDOT arcgis l1", "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/1/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2"],
    ["WSDOT KML", "https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/kml.aspx"],
    ["NCDOT", "https://eapps.ncdot.gov/services/traffic-prod/v1/cameras"],
    ["NCDOT 2", "https://eapps.ncdot.gov/services/traffic-prod/v1/cameras/"],
    ["Oregon tripcheck", "https://tripcheck.com/Scripts/map/data/cctvinventory.js"],
    ["Delaware", "https://tmc.deldot.gov/json/videocamera.json"],
    ["Maryland CHART", "https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do"],
    ["Michigan", "https://mdotjboss.state.mi.us/MiDrive/camera/AllForMap/"],
    ["Tennessee", "https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras"],
    ["Kentucky goky", "https://services2.arcgis.com/CcI36Pduqd0OR4W9/ArcGIS/rest/services/trafficCamerasCur_Prd/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2"],
    ["Iowa arcgis", "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2"],
    ["Queensland", "https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b"],
    ["Taiwan freeway CCTV", "https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml"],
    ["Taiwan freeway CCTV 2", "https://tisvcloud.freeway.gov.tw/cctv_info.xml.gz"],
    ["Iceland vegagerdin", "https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1"],
    ["Lithuania", "https://eismoinfo.lt/eismoinfo-backend/camera-info-table"],
    ["Slovenia", "https://www.promet.si/dc/b2b.kamere.geojson"],
    ["Vietnam HCMC image", "https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx?id=56de42f611f398ec0c48127d"],
  ];
  for (const [k, u] of one) { const r = await get(u, 60000); line(k, r); if (r.s === 200) sample(r, 900); }
  console.log("\n##### 2d. ArcGIS Online: public feature services titled traffic cameras (agency-owned ones are candidates)");
  for (const q of ['title:"traffic cameras" type:"Feature Service"', 'title:cctv type:"Feature Service" tags:traffic', 'title:"camera" owner:*dot* type:"Feature Service"']) {
    const r = await get(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}&num=100&f=json&sortField=numViews&sortOrder=desc`);
    line("search " + q, r);
    try { for (const x of JSON.parse(r.b).results || []) console.log(`   ${x.title} | ${x.owner} | ${x.access} | ${x.url}`); } catch {}
  }
}

if (!only || only === "browser") await browserCheck().catch((e) => console.log("browser check failed: " + e));
if (!only || only === "lists") await candidates();
