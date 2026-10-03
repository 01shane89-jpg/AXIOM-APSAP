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

/* ---------- round 2: field details for building the chosen sources ---------- */
async function round2() {
  const full = (k, r, n = 2500) => { line(k, r); console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  console.log("\n##### R2. NSW images (browser said error)");
  for (const u of ["https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/erskine_st_sydney.jpeg", "https://data.livetraffic.com/cameras/traffic-cam.json"]) { const r = await get(u); line(u, r); if (/json/.test(r.ct)) console.log("   " + r.b.toString().slice(0, 900)); else console.log("   " + r.b.toString().slice(0, 200)); }
  console.log("\n##### R2. ATIS full rows and big pages");
  const big = (n, st = 0) => encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: "" }, { name: "sortOrder", s: true }], order: [{ column: 1, dir: "asc" }], start: st, length: n, search: { value: "" } }));
  for (const h of ["511ga.org", "fl511.com", "udottraffic.utah.gov", "511on.ca"]) {
    const r = await get(`https://${h}/List/GetData/Cameras?query=${big(1)}&lang=en`, 30000, { "X-Requested-With": "XMLHttpRequest" }); full(h + " row", r, 3000);
    const b = await get(`https://${h}/List/GetData/Cameras?query=${big(5000)}&lang=en`, 60000, { "X-Requested-With": "XMLHttpRequest" });
    try { const j = JSON.parse(b.b); line(h + " length 5000", b); console.log(`   rows ${j.data.length} of ${j.recordsTotal}`); } catch { line(h + " length 5000 (not json)", b); }
  }
  console.log("\n##### R2. ATIS placeholder check (same 15136 B png?)");
  for (const u of ["https://fl511.com/map/Cctv/4358", "https://fl511.com/map/Cctv/4400", "https://fl511.com/map/Cctv/5000", "https://511ga.org/map/Cctv/24897", "https://511.novascotia.ca/map/Cctv/56", "https://hotline.gov.sk.ca/map/Cctv/2", "https://nvroads.com/map/Cctv/7572"]) {
    const r = await get(u, 30000); line(u, r);
    const crypto = await import("node:crypto"); console.log("   sha1 " + crypto.createHash("sha1").update(r.b).digest("hex").slice(0, 12)); await new Promise((ok) => setTimeout(ok, 1500));
  }
  console.log("\n##### R2. CARS views");
  for (const p of ["cotg", "mntg", "iatg", "intg", "netg", "kstg"]) {
    const r = await get(`https://${p}.carsprogram.org/cameras_v1/api/cameras`, 30000);
    try { const j = JSON.parse(r.b); const kinds = {}; j.forEach((c) => (c.views || []).forEach((v) => { const k = Object.keys(v).sort().join(",") + " | " + (v.category || v.type || ""); kinds[k] = (kinds[k] || 0) + 1; }));
      console.log(p + " " + j.length + " cams; view shapes: " + JSON.stringify(kinds).slice(0, 900)); console.log("   one: " + JSON.stringify(j[5]).slice(0, 1500)); } catch (e) { line(p, r); }
  }
  console.log("\n##### R2. others, full first record");
  for (const [k, u] of [
    ["QLD", "https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b"],
    ["Illinois", "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2&outSR=4326"],
    ["Illinois count", "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"],
    ["Iowa count", "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"],
    ["Kentucky count", "https://services2.arcgis.com/CcI36Pduqd0OR4W9/ArcGIS/rest/services/trafficCamerasCur_Prd/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"],
    ["Missouri", "https://services2.arcgis.com/jWXb6JPWtBjOCalT/arcgis/rest/services/MODOT_Traffic_Cameras/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&outSR=4326"],
    ["Hawaii", "https://services.arcgis.com/6I1ysurtNWNxkuwd/arcgis/rest/services/HawaiiTrafficCameras/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&outSR=4326"],
    ["Maryland arcgis", "https://chartimap1.sha.maryland.gov/arcgis/rest/services/CHART/Cameras/MapServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&outSR=4326"],
    ["WSDOT KML", "https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/kml.aspx"],
    ["Iceland", "https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1"],
    ["HCMC list a", "https://giaothong.hochiminhcity.gov.vn/render/ImageHandler.ashx?id=56de42f611f398ec0c48127d&t=1"],
    ["HCMC map page", "https://giaothong.hochiminhcity.gov.vn/Map.aspx"],
    ["HCMC home", "https://giaothong.hochiminhcity.gov.vn/"],
    ["notis list", "https://api.notis.vn/v4/cameras/bylocation?lat=10.79&lng=106.68"],
  ]) { const r = await get(u, 60000); full(k, r, k === "WSDOT KML" ? 1800 : 1500); }
  for (const u of ["https://www.tripcheck.com/RoadCams/cams/AstoriaUS101MeglerBrNB_pid392.jpg", "https://eismoinfo.lt/eismoinfo-backend/image-provider/camera/last?id=72", "https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg",
    "https://atmsqf.iowadot.gov/snapshots/Public/RWIS/RWIS_84-01.jpg", "http://pws.trafficwise.org/pullover/172_65_56_11.jpg", "https://pws.trafficwise.org/pullover/172_65_56_11.jpg", "https://api.qldtraffic.qld.gov.au/v1/webcams/1"]) await img(u);
}
/* ---------- round 3: Thailand and the Philippines ---------- */
async function round3() {
  const show = (k, r, n = 1200) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  console.log("\n##### R3. Thailand");
  const lg = await get("https://camera.longdo.com/feed/?command=json", 60000); show("Longdo iTIC list", lg, 1500);
  try {
    const j = JSON.parse(lg.b); const orgs = {}, kinds = { hls: 0, img: 0 };
    j.forEach((c) => { orgs[c.organization] = (orgs[c.organization] || 0) + 1; if (/^https:\/\/camerai1/.test(c.hls_url || "") && !/tempsus/.test(c.hls_url)) kinds.hls++; if (c.imgurl) kinds.img++; });
    console.log("   " + j.length + " cams; orgs " + JSON.stringify(orgs) + "; " + JSON.stringify(kinds));
    const h = j.find((c) => /^https:\/\/camerai1/.test(c.hls_url || "") && !/tempsus/.test(c.hls_url)); if (h) { const r = await get(h.hls_url, 30000); show("  hls " + h.hls_url, r, 400); }
    const im = j.filter((c) => c.imgurl).slice(0, 3); for (const c of im) await img(c.imgurl);
  } catch (e) { console.log("   parse " + e); }
  for (const [k, u] of [["DOH page", "https://www.highwaytraffic.go.th/DOHWeb/home.aspx"], ["BMA traffic", "https://cpudapp.bangkok.go.th/bmatraffic/"], ["BMA legacy", "http://www.bmatraffic.com/"],
    ["BMA data", "https://data.bangkok.go.th/api/3/action/package_show?id=bma-cctv"], ["EXAT", "https://www.exat.co.th/"], ["EXAT cctv", "https://cctv.exat.co.th/"], ["Police tourist CCTV", "https://data.go.th/api/3/action/package_show?id=police_catalog"],
    ["Chiang Mai cctv", "https://cctv.chiangmaicity.go.th/"], ["Phuket cctv", "https://www.phuketcity.go.th/cctv"]]) { const r = await get(u, 40000); show(k, r, 600); }
  const d = await fetch("https://telemetry.dwr.go.th/api/public/reportCctv/listPaginate", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: O }, body: JSON.stringify({ paginate: { page: 1, pageSize: 3, orders: [] }, search: {} }), signal: AbortSignal.timeout(40000) }).then(async (r) => ({ s: r.status, ct: r.headers.get("content-type") || "", cors: r.headers.get("access-control-allow-origin") || "", b: Buffer.from(await r.arrayBuffer()), ms: 0 })).catch((e) => ({ s: 0, err: String(e), b: Buffer.alloc(0), ct: "" }));
  d.n = d.b.length; show("DWR cctv list", d, 1500);
  try { const j = JSON.parse(d.b); const c = (j.value || j.data || {}).data || (j.value || {}).items || []; const id = c[0] && (c[0].id || c[0].cctvId); if (id) { const r = await get("https://telemetry.dwr.go.th/api/public/reportCctv/snapshot/" + id, 30000); show("DWR snapshot " + id, r, 800); } } catch (e) { console.log("   " + e); }
  console.log("\n##### R3. Philippines");
  for (const [k, u] of [["MMDA site", "https://mmda.gov.ph/"], ["MMDA traffic (Interaksyon)", "http://mmdatraffic.interaksyon.com/line-view-edsa.php"], ["MMDA cctv guess", "https://mmda.gov.ph/cctv"],
    ["DPWH", "https://www.dpwh.gov.ph/"], ["NLEX", "https://www.nlex.com.ph/traffic-advisory/"], ["Cebu City", "https://www.cebucity.gov.ph/"], ["data.gov.ph cctv", "https://data.gov.ph/index/public/dataset?q=cctv"], ["Sakay", "https://sakay.ph/"]]) { const r = await get(u, 40000); show(k, r, 500);
    const t = r.b.toString("utf8"); const m = t.match(/[^"'\s]*(cctv|camera|cam\d|live)[^"'\s]*/gi); if (m) console.log("   links: " + [...new Set(m)].slice(0, 15).join(" | ")); }
}
/* ---------- round 4: which sources also stream live video a browser on the live site may play ---------- */
async function round4() {
  const vid = async (k, u) => {
    const r = await get(u, 25000); line(`${k} ${u.slice(0, 110)}`, r);
    if (r.s !== 200) return;
    const t = r.b.toString("utf8"); if (!/#EXTM3U/.test(t)) { console.log("   not a playlist: " + r.ct); return; }
    const next = t.split(/\r?\n/).find((l) => l && !l.startsWith("#")); if (!next) return;
    const nu = new URL(next, r.url || u).href; const r2 = await get(nu, 25000); line("   next " + nu.slice(0, 100), r2);
    const t2 = r2.b.toString("utf8"); const seg = /#EXTM3U/.test(t2) && t2.split(/\r?\n/).find((l) => l && !l.startsWith("#"));
    if (seg) { const r3 = await get(new URL(seg, r2.url || nu).href, 25000); line("   seg " + seg.slice(0, 60), r3); }
  };
  const q = encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: "" }, { name: "sortOrder", s: true }], order: [{ column: 1, dir: "asc" }], start: 0, length: 100, search: { value: "" } }));
  console.log("\n##### R4. 511 sites: video without sign-in");
  for (const h of ["fl511.com", "511pa.com", "newengland511.org", "ctroads.org", "511wi.gov", "511la.org", "az511.gov", "udottraffic.utah.gov", "511.idaho.gov", "nvroads.com", "511.alaska.gov", "511on.ca", "511.gnb.ca", "511.novascotia.ca", "511nl.ca"]) {
    const r = await get(`https://${h}/List/GetData/Cameras?query=${q}&lang=en`, 40000, { "X-Requested-With": "XMLHttpRequest" });
    let all = 0, open = 0, sample = [];
    try { for (const c of JSON.parse(r.b).data || []) for (const i of c.images || []) { if (!i.videoUrl) continue; all++; if (!i.isVideoAuthRequired && !i.videoDisabled) { open++; if (sample.length < 2) sample.push(i.videoUrl); } } } catch {}
    console.log(`${h}: of 100 sites, ${all} with video, ${open} without sign-in`);
    for (const u of sample) await vid("  ", u);
  }
  console.log("\n##### R4. CARS states");
  for (const p of ["cotg", "mntg", "iatg", "intg", "kstg"]) {
    const r = await get(`https://${p}.carsprogram.org/cameras_v1/api/cameras`, 40000); let n = 0, sample = [];
    try { for (const c of JSON.parse(r.b)) for (const v of c.views || []) if (v.type === "WMP" && /\.m3u8/.test(v.url || "")) { n++; if (sample.length < 2 && n % 50 === 1) sample.push(v.url); } } catch {}
    console.log(`${p}: ${n} video views`); for (const u of sample) await vid("  ", u);
  }
  console.log("\n##### R4. others");
  const ct = await get("https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json", 60000); let cv = [];
  try { cv = (JSON.parse(ct.b).data || []).map((e) => ((((e.cctv || {}).imageData) || {}).streamingVideoURL)).filter((u) => u && u !== "Not Reported"); } catch {}
  console.log("Caltrans d4 streaming urls: " + cv.length); for (const u of cv.slice(0, 2)) await vid("  ", u);
  const de = await get("https://tmc.deldot.gov/json/videocamera.json", 40000); let dv = [];
  try { const j = JSON.parse(de.b); dv = (j.videoCameras || j).map((c) => c.urls && c.urls.m3u8s).filter(Boolean); } catch {}
  console.log("Delaware m3u8s: " + dv.length); for (const u of dv.slice(0, 2)) await vid("  ", u);
  const md = await get("https://chartimap1.sha.maryland.gov/arcgis/rest/services/CHART/Cameras/MapServer/0/query?where=1%3D1&outFields=hlsurl&f=json&resultRecordCount=3", 40000);
  try { for (const f of JSON.parse(md.b).features || []) await vid("  MD", f.attributes.hlsurl); } catch {}
  const tfl = await get("https://api.tfl.gov.uk/Place/Type/JamCam", 40000);
  try { const p0 = JSON.parse(tfl.b)[0]; const v = (p0.additionalProperties || []).find((x) => x.key === "videoUrl"); console.log("TfL videoUrl " + (v && v.value)); if (v) { const r = await get(v.value, 25000); line("  TfL mp4", r); } } catch (e) { console.log(e); }
  const ny = await get("https://webcams.nyctmc.org/api/cameras", 40000); try { console.log("NYC keys " + Object.keys(JSON.parse(ny.b)[0]).join(",")); } catch {}
  const bc = await get("https://www.drivebc.ca/api/webcams/", 40000); try { console.log("DriveBC links " + JSON.stringify(JSON.parse(bc.b)[0].links)); } catch {}
}
/* ---------- round 5: official non-traffic cameras (volcano, river, coastal, weather) ---------- */
async function round5() {
  const show = (k, r, n = 900) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  const L = [
    ["USGS AshCam", "https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams"],
    ["GeoNet volcano", "https://images.geonet.org.nz/volcano/cameras/all.json"],
    ["NDBC buoycams", "https://www.ndbc.noaa.gov/buoycams.php"],
    ["MLIT towns", "https://www.river.go.jp/kawabou/file/files/map/twn/twnarea.json"],
    ["Taiwan Civil IoT CCTV", "https://sta.ci.taiwan.gov.tw/STA_CCTV/v1.0/Things?$top=2&$expand=Locations,Datastreams($expand=Observations($top=1))"],
    ["ThaiWater cctv", "https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/cctv"],
    ["USGS NIMS", "https://api.waterdata.usgs.gov/nims/v0/cameras?enabled=true"],
    ["TfNSW maritime", "https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/TfNSW_Maritime_Camera_Public/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=3"],
    ["MeteoSwiss app overview", "https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/webcam_overview.json"],
    ["HPWREN sites", "https://www.hpwren.ucsd.edu/cameras/sites.js"],
    ["JMA volcam icons", "https://www.data.jma.go.jp/svd/vois/data/tokyo/volcam/param/geojson/camicon.geojson"],
    ["Tainan drainage", "https://soa.tainan.gov.tw/Api/Service/Get/427a8287-0bc1-4b45-92ac-53eb858b5b9c"],
    ["Puertos del Estado", "https://portus.puertos.es/portussvr/api/stations"],
  ];
  const got = {};
  for (const [k, u] of L) { const r = await get(u, 60000); got[k] = r; show(k, r); if (/json/.test(r.ct)) sample(r, 900); }
  try { const j = JSON.parse(got["USGS AshCam"].b).webcams || []; const ok = j.filter((c) => c.faaInd !== "Y" && c.hasImages !== "N");
    console.log("   AshCam " + j.length + " total, " + ok.length + " not FAA"); for (const c of ok.slice(0, 3)) await img(c.currentImageUrl); } catch (e) { console.log("   " + e); }
  try { const j = JSON.parse(got["GeoNet volcano"].b); const f = [].concat(...(Array.isArray(j) ? j : [j]).map((x) => x.features || []));
    console.log("   GeoNet " + f.length + " features; first " + JSON.stringify(f[0]).slice(0, 500)); const p = f[0] && f[0].properties; if (p) await img(new URL(p["latest-image-large"], "https://images.geonet.org.nz/volcano/cameras/").href); } catch (e) { console.log("   " + e); }
  try { const j = JSON.parse(got["NDBC buoycams"].b); console.log("   NDBC " + j.length); for (const c of j.slice(0, 2)) await img("https://www.ndbc.noaa.gov/images/buoycam/" + c.img); } catch (e) { console.log("   " + e); }
  try { const j = JSON.parse(got["MLIT towns"].b); const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) || []; const t = arr.filter((x) => x.scamExistFlg == 1);
    console.log("   MLIT towns " + arr.length + ", with cameras " + t.length + "; first " + JSON.stringify(t[0]).slice(0, 300));
    if (t[0]) { const r = await get(`https://www.river.go.jp/kawabou/file/gjson/scam/${t[0].twnCd}.json`, 40000); show("  MLIT town cams", r, 800); try { const g = JSON.parse(r.b); const f0 = (g.features || [])[0]; if (f0) { const id = f0.properties.obsFcd || f0.properties.id || f0.properties.obsCd; console.log("   props " + JSON.stringify(f0.properties).slice(0, 400)); } } catch {} } } catch (e) { console.log("   " + e); }
  try { const j = JSON.parse(got["USGS NIMS"].b); const a = Array.isArray(j) ? j : j.cameras || []; console.log("   NIMS " + a.length); if (a[0]) await img(`https://usgs-nims-images.s3.amazonaws.com/720/${a[0].camId}/${a[0].camId}_newest.jpg`); } catch (e) { console.log("   " + e); }
  for (const c of ["cp1", "hko", "kfb", "swh", "tm2"]) await img(`https://www.hko.gov.hk/wxinfo/aws/hko_mica/${c}/latest_${c.toUpperCase()}.jpg`, "  HKO");
  for (const c of ["grsm", "yose", "olym", "bibe"]) await img(`https://www.nps.gov/featurecontent/ard/webcams/images/${c}.jpg`, "  NPS");
  for (const u of ["https://www.cenapred.unam.mx/popo/UltimaImagen.jpg", "https://www.fs.usda.gov/Internet/FSE_MEDIA/sthelens.jpg", "https://trollcam.npolar.no/TrollWebCam3HD.jpg"]) await img(u, "  single");
}
/* ---------- round 6: image addresses for the lists round 5 found ---------- */
async function round6() {
  const show = (k, r, n = 700) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  for (const id of [100257123, 100257127]) { const r = await get(`https://www.river.go.jp/kawabou/file/files/master/obs/scam/${id}.json`, 30000); show("MLIT cam " + id, r, 900);
    try { const t = r.b.toString("utf8"); for (const u of [...new Set(t.match(/https?:[^"]+\.(jpg|jpeg|png)/gi) || [])].slice(0, 3)) await img(u.replace(/\\\//g, "/")); } catch {} }
  for (const u of ["https://cam.river.go.jp/cam/now/100257123.jpg", "https://www.river.go.jp/kawabou/file/files/scam/now/100257123.jpg"]) await img(u, "  MLIT guess");
  for (const vc of ["10401", "50601"]) { const r = await get(`https://www.data.jma.go.jp/svd/vois/data/tokyo/volcam/volcam.php?VC=${vc}`, 30000); line("JMA page " + vc, r);
    const t = r.b.toString("utf8"); const m = [...new Set(t.match(/[^"'\s]+\.(jpg|jpeg|png)/gi) || [])].filter((x) => !/icon|logo|banner/i.test(x)); console.log("   imgs " + m.slice(0, 8).join(" | "));
    for (const x of m.slice(0, 2)) await img(new URL(x, r.url || "https://www.data.jma.go.jp/svd/vois/data/tokyo/volcam/").href, "  JMA"); }
  const hp = await get("https://www.hpwren.ucsd.edu/cameras/sites.js", 30000); let ids = [];
  try { const t = hp.b.toString("utf8"); ids = [...t.matchAll(/"([a-z0-9]+-[a-z]+-mobo-c)"/g)].map((m) => m[1]); console.log("HPWREN colour cams " + ids.length); } catch {}
  for (const id of ids.slice(0, 2)) for (const u of [`https://www.hpwren.ucsd.edu/cameras/L/${id}.jpg`, `https://www.hpwren.ucsd.edu/cameras/LTA/${id}/large/latest.jpg`, `https://hpwren.ucsd.edu/cameras/L/${id}.jpg`]) await img(u, "  HPWREN");
  const tw = await get("https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/cctv", 60000);
  try { const d = JSON.parse(tw.b).data || []; const k = {}; d.forEach((c) => { const u = c.cctv_url || ""; const key = c.media_type + " " + (u.match(/^\w+:\/\/[^/]+/) || [""])[0].replace(/\d+/g, "#"); k[key] = (k[key] || 0) + 1; });
    console.log("ThaiWater " + d.length + " by type/host: " + JSON.stringify(k).slice(0, 1500)); const ag = {}; d.forEach((c) => { const a = ((c.agency || {}).agency_name || {}).en; ag[a] = (ag[a] || 0) + 1; }); console.log("   agencies " + JSON.stringify(ag));
    for (const c of d.filter((c) => /^https:/.test(c.cctv_url || "")).slice(0, 4)) await img(c.cctv_url, "  ThaiWater " + c.media_type); } catch (e) { console.log("   " + e); }
  const ms = await get("https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/webcam_overview.json", 30000);
  try { const j = JSON.parse(ms.b); console.log("MeteoSwiss keys " + Object.keys(j).join(",") + " station keys " + Object.keys(j.stations[0]).join(",")); } catch {}
  for (const u of ["https://www.meteoswiss.admin.ch/product/output/webcams/BIV/latest.jpg", "https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/webcams/BIV.jpg", "https://data.geo.admin.ch/ch.meteoschweiz.ogd-webcam/"]) { const r = await get(u, 20000); show("MeteoSwiss guess " + u, r, 300); }
  const hk = await get("https://www.hko.gov.hk/en/wxinfo/ts/index_webcam.htm", 30000); line("HKO index", hk);
  try { const t = hk.b.toString("utf8"); console.log("   codes " + [...new Set([...t.matchAll(/hko_mica\/([a-z0-9]+)\//gi)].map((m) => m[1]))].join(",")); const js = [...new Set(t.match(/[^"'\s]+\.js/g) || [])]; console.log("   js " + js.slice(0, 10).join(" | ")); } catch {}
  const nps = await get("https://www.nps.gov/subjects/air/webcams.htm", 30000); line("NPS air webcams page", nps);
  try { const t = nps.b.toString("utf8"); console.log("   codes " + [...new Set([...t.matchAll(/webcams\/images\/([a-z0-9_]+)\.jpg/gi)].map((m) => m[1]))].join(",")); } catch {}
}
/* ---------- round 7: Spain (DGT), US ocean buoys (NDBC), Hong Kong Observatory weather photos ---------- */
async function round7() {
  const show = (k, r, n = 700) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  for (const ds of ["camaras-dgt-datex2-v3-7", "camaras-dgt-datex2-v3-6-nuevo", "camaras-dgt"]) {
    const r = await get("https://nap.dgt.es/api/3/action/package_show?id=" + ds, 40000); line("DGT package " + ds, r);
    try { const j = JSON.parse(r.b); for (const x of j.result.resources || []) console.log("   res " + x.format + " " + x.url + " | " + (x.name || "")); } catch { show("  page", await get("https://nap.dgt.es/en/dataset/" + ds, 40000), 300); }
  }
  for (const u of ["https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml", "https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v36.xml", "https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml"]) {
    const r = await get(u, 60000); show("DGT try " + u, r, 1200);
    const t = r.b.toString("utf8"); const im = [...new Set(t.match(/https?:[^<"\s]+\.(jpg|jpeg|png)/gi) || [])]; console.log("   images " + im.length + " e.g. " + im.slice(0, 3).join(" "));
    for (const x of im.slice(0, 2)) await img(x.replace(/&amp;/g, "&"), "  DGT");
  }
  for (const st of ["41002", "46026"]) { const r = await get("https://www.ndbc.noaa.gov/buoycam.php?station=" + st, 30000); line("NDBC buoycam.php " + st, r); console.log("   final url " + r.url); }
  const hk = await get("https://www.hko.gov.hk/en/wxinfo/ts/index_webcam.htm", 30000); const t = hk.b.toString("utf8");
  const js = [...new Set(t.match(/[^"'\s]+\.js[^"'\s]*/g) || [])].filter((x) => !/jquery|bootstrap|respond|html5shiv|flexslider|cookie|easing|menu\.js/i.test(x));
  console.log("HKO scripts: " + js.join(" | "));
  for (const x of js.slice(0, 8)) { const r = await get(new URL(x, "https://www.hko.gov.hk/en/wxinfo/ts/").href, 30000); const b = r.b.toString("utf8"); if (/lat|lon|webcam|mica/i.test(b)) show("  HKO js " + x, r, 1500); }
  const m = t.match(/[^\n]{0,200}(lat|longitude|22\.\d{3,})[^\n]{0,200}/i); console.log("   page coords sample: " + (m ? m[0].slice(0, 400) : "none"));
  for (const u of ["https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en", "https://data.gov.hk/en-data/dataset/hk-hko-rss-weather-photo", "https://www.hko.gov.hk/en/wxinfo/ts/webcam/json/webcam.json", "https://www.hko.gov.hk/wxinfo/ts/webcam/webcam_list.json"]) show("HKO try " + u, await get(u, 30000), 500);
}
if (only === "r7") await round7();
if (only === "r5") await round5();
if (only === "r6") await round6();
if (only === "r2") await round2();
if (only === "r4") await round4();
if (only === "r3") await round3();
if (!only || only === "browser") await browserCheck().catch((e) => console.log("browser check failed: " + e));
if (!only || only === "lists") await candidates();
