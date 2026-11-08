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
/* ---------- round 8: element shape of the DGT camera list and the NDBC buoy list ---------- */
async function round8() {
  const r = await get("https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml", 90000); line("DGT v37", r);
  const t = r.b.toString("utf8"); const i = t.indexOf("etraffic.dgt.es/camarasEtraffic");
  console.log("   head " + t.slice(0, 1500).replace(/\s+/g, " "));
  if (i > 0) { console.log("   around first image: " + t.slice(Math.max(0, i - 3500), i + 800).replace(/\s+/g, " ")); const j = t.indexOf("etraffic.dgt.es/camarasEtraffic", i + 50); console.log("   second: " + t.slice(Math.max(0, j - 3500), j + 300).replace(/\s+/g, " ")); }
  const tags = {}; for (const m of t.matchAll(/<([a-zA-Z0-9]+:[a-zA-Z]+)[\s>]/g)) tags[m[1]] = (tags[m[1]] || 0) + 1; console.log("   tag counts " + JSON.stringify(tags).slice(0, 3000));
  const n = await get("https://www.ndbc.noaa.gov/buoycams.php", 30000); line("NDBC buoycams.php", n); console.log("   " + n.b.toString("utf8").slice(0, 900));
  for (const st of ["41002", "46026"]) { const x = await get("https://www.ndbc.noaa.gov/buoycam.php?station=" + st, 30000); line("NDBC cam " + st, x); }
}
/* ---------- round 9: more 511 sites (same camera list as the ones in use) and more CARS states ---------- */
async function round9() {
  const q = encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: "" }, { name: "sortOrder", s: true }], order: [{ column: 1, dir: "asc" }], start: 0, length: 3, search: { value: "" } }));
  for (const h of ["511ny.org", "511sc.org", "mdottraffic.com", "manitoba511.ca", "511yukon.ca", "511nj.org", "mass511.com", "511.wv.gov", "511virginia.org", "travelinfo.mt.gov", "sd511.org", "511.nd.gov", "wyoroad.info", "idrivearkansas.com", "algotraffic.com", "oktraffic.org", "nmroads.com", "511.alberta.ca", "511.gov.pe.ca", "quebec511.info", "drivenc.gov", "511.ky.gov", "smartway.tn.gov", "511ga.org", "mo511.org", "traveler.modot.org", "511.org", "hawaii511.org", "goakamai.org", "511tx.org", "drivetexas.org", "511mi.gov", "ohgo.com", "511.mt.gov", "511wv.org", "511.ri.gov", "511.vermont.gov", "511.dot.ri.gov", "ncdot.gov"]) {
    const r = await get(`https://${h}/List/GetData/Cameras?query=${q}&lang=en`, 30000, { "X-Requested-With": "XMLHttpRequest" });
    let note = ""; try { const j = JSON.parse(r.b); const c = (j.data || [])[0] || {}; note = "total " + j.recordsTotal + " img " + JSON.stringify((c.images || []).map((i) => i.imageUrl)).slice(0, 160); } catch {}
    line("511 " + h, r); if (note) console.log("   " + note);
    if (note) { try { const c = JSON.parse(r.b).data[0]; const u = ((c.images || [])[0] || {}).imageUrl; if (u) await img(new URL(u, `https://${h}/`).href, "  " + h); } catch {} }
  }
  for (const st of ["nh", "vt", "me", "ma", "sd", "nd", "mt", "wy", "ok", "mo", "ar", "ms", "al", "nm", "ky", "oh", "tn", "tx", "va", "nc", "sc", "ga", "wv", "ri", "nj", "ny", "il", "mi", "ut", "id", "wa", "or", "ca", "md", "de", "pa", "hi", "ak", "la", "wi", "fl"]) {
    const r = await get(`https://${st}tg.carsprogram.org/cameras_v1/api/cameras`, 30000);
    let note = ""; try { const j = JSON.parse(r.b); note = j.length + " cams, first " + JSON.stringify(j[0] && j[0].views).slice(0, 200); } catch {}
    if (r.s === 200) { line("CARS " + st, r); console.log("   " + note); } else console.log("CARS " + st + " " + (r.s || r.err));
  }
}
/* ---------- round 10: Quebec (Données Québec) and Norway (Statens vegvesen) camera lists ---------- */
async function round10() {
  const show = (k, r, n = 900) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  for (const [k, u] of [["QC", "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=camera-de-circulation"], ["NO", "https://dataut.vegvesen.no/api/3/action/package_show?id=webkamera"], ["NO statuser", "https://dataut.vegvesen.no/api/3/action/package_show?id=webkamera-statuser-api"]]) {
    const r = await get(u, 40000); line(k, r);
    try { const j = JSON.parse(r.b).result; console.log("   licence " + j.license_title + " | " + (j.notes || "").slice(0, 300).replace(/\s+/g, " ")); for (const x of j.resources || []) { console.log("   res " + x.format + " " + x.url + " | " + x.name);
      if (/json|csv|xml|geojson/i.test(x.format + x.url)) { const d = await get(x.url, 60000); show("     get", d, 1500); const t = d.b.toString("utf8"); for (const m of [...new Set(t.match(/https?:[^"'<>\s,]+\.(jpg|jpeg|png)/gi) || [])].slice(0, 2)) await img(m, "     img"); } } } catch (e) { console.log("   " + e); }
  }
  for (const u of ["https://www.quebec511.info/fr/Diffusion/Etat/Camera.aspx", "https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outputformat=geojson", "https://webkamera.atlas.vegvesen.no/public/kamera?id=0329001_1", "https://kamera.atlas.vegvesen.no/api/images/0329001_1"]) show("try " + u, await get(u, 30000), 600);
}
/* ---------- round 11: Quebec camera image address, Norway WFS ---------- */
async function round11() {
  const show = (k, r, n = 900) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  for (const id of ["c0d13822-e774-4ea0-b95f-3c61a693c316"]) { const r = await get("https://dataut.vegvesen.no/api/3/action/resource_show?id=" + id, 30000); show("NO res", r, 1500); }
  const pk = await get("https://dataut.vegvesen.no/api/3/action/package_show?id=webkamera", 30000); try { for (const x of JSON.parse(pk.b).result.resources) console.log("   res " + JSON.stringify(x).slice(0, 700)); } catch {}
  for (const u of ["https://ogckart-sn1.atlas.vegvesen.no/webkamera_1_0/ows?service=WFS&request=GetCapabilities", "https://ogckart-sn1.atlas.vegvesen.no/webkamera/ows?service=WFS&request=GetCapabilities", "https://ogckart-sn1.atlas.vegvesen.no/webkamera_1_0/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webkamera_1_0:Webkamera&count=2&outputFormat=application/json"]) show("NO try", await get(u, 30000), 1500);
  // Quebec: the camera window page in a real browser (Cloudflare refuses plain fetches), and the image it shows
  const { chromium } = await import("playwright"); const br = await chromium.launch(); const pg = await br.newPage(); const seen = [];
  pg.on("response", (r) => { const ct = r.headers()["content-type"] || ""; if (/image|json|javascript/.test(ct) && !/google|gstatic/.test(r.url())) seen.push(r.status() + " " + ct.split(";")[0] + " " + r.url()); });
  try { await pg.goto("https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=4057", { waitUntil: "networkidle", timeout: 45000 }); } catch (e) { console.log("QC page " + e.message); }
  console.log("QC title " + (await pg.title().catch(() => "")) + " | html " + (await pg.content().catch(() => "")).slice(0, 1500).replace(/\s+/g, " "));
  console.log("QC responses:\n   " + seen.slice(0, 30).join("\n   "));
  await br.close();
  for (const u of ["https://www.quebec511.info/Carte/Fenetres/camera.ashx?id=4057", "https://www.quebec511.info/Carte/Fenetres/camera.ashx?id=4057&format=mobile", "https://www.quebec511.info/diffusion/images/cameras/4057.jpg"]) await img(u, "  QC guess");
}
/* ---------- round 12: open each agency's own camera map in a browser and list the camera data it asks for ---------- */
async function round12() {
  const nsw = await get("https://data.nsw.gov.au/data/api/3/action/package_show?id=1-4fed724a31bc450b8af248a9b552aba9", 30000); line("NSW webcams pkg", nsw);
  try { const j = JSON.parse(nsw.b).result; console.log("   " + j.title + " | " + j.license_title); for (const x of j.resources || []) console.log("   res " + x.format + " " + x.url); } catch {}
  const { chromium } = await import("playwright"); const br = await chromium.launch();
  const sites = [["NO", "https://www.vegvesen.no/trafikk/kart/?layers=webkamera"], ["EE", "https://tarktee.ee/"], ["SI", "https://www.promet.si/sl/kamere"], ["IE", "https://www.tii.ie/en/roads-tolling/operations-and-maintenance/traffic-cameras/"], ["IE2", "https://traffic.tii.ie/"],
    ["CZ", "https://www.dopravniinfo.cz/"], ["HR", "https://www.hak.hr/info/kamere/"], ["DK", "https://trafikkort.vejdirektoratet.dk/"], ["PL", "https://www.traxelektronik.pl/pogoda/kamery/"], ["WA", "https://travelmap.mainroads.wa.gov.au/"], ["SA", "https://traffic.sa.gov.au/"],
    ["VIC", "https://traffic.vicroads.vic.gov.au/"], ["TAS", "https://www.transport.tas.gov.au/roadside-cameras"], ["NT", "https://roadreport.nt.gov.au/"], ["LV", "https://lvceli.lv/kameras/"], ["HU", "https://kozut.hu/"], ["PT", "https://www.infraestruturasdeportugal.pt/pt-pt/camaras"], ["MO", "https://www.dsat.gov.mo/dsat/realtime.aspx"], ["MY", "https://www.llm.gov.my/"], ["SE", "https://www.trafikverket.se/trafikinformation/vag/?map_x=650778&map_y=6732275&map_z=2&map_l=100000000000000000000001"]];
  for (const [k, u] of sites) {
    const ctx = await br.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" }); const pg = await ctx.newPage(); const seen = [];
    pg.on("response", async (r) => { const ct = r.headers()["content-type"] || "", url = r.url();
      if (/json|xml|geo/.test(ct) && /cam|kamer|kaam|cctv|webcam|video|camara/i.test(url + " " + ct)) { let n = 0; try { n = (await r.body()).length; } catch {} seen.push(r.status() + " " + ct.split(";")[0] + " " + n + "B " + url.slice(0, 220)); }
      else if (/image\/jpe?g/.test(ct) && /cam|kamer|kaam|cctv|webcam/i.test(url) && seen.filter((x) => / image\//.test(x)).length < 3) seen.push(r.status() + " " + ct + " " + url.slice(0, 220)); });
    try { await pg.goto(u, { waitUntil: "networkidle", timeout: 40000 }); } catch (e) { seen.push("goto " + e.message.slice(0, 80)); }
    await pg.waitForTimeout(3000);
    console.log(k + " " + u + " title=" + (await pg.title().catch(() => "")).slice(0, 60) + "\n   " + (seen.slice(0, 14).join("\n   ") || "(no camera data seen)"));
    await ctx.close();
  }
  await br.close();
}
/* ---------- round 13: Croatia (HAK) camera manifests ---------- */
async function round13() {
  const show = (k, r, n = 1500) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  show("HAK A1", await get("https://www.hak.hr/info/kamere/manifest/A1.json", 30000), 2500);
  const pg = await get("https://www.hak.hr/info/kamere/", 30000); const t = pg.b.toString("utf8");
  console.log("   manifests " + [...new Set(t.match(/manifest\/[^"'\s]+\.json/g) || [])].join(" "));
  console.log("   scripts " + [...new Set(t.match(/[^"'\s]+\.js(\?[^"'\s]*)?/g) || [])].slice(0, 12).join(" "));
  for (const m of ["manifest/index.json", "manifest/all.json", "manifest.json", "manifest/list.json"]) show("HAK try " + m, await get("https://www.hak.hr/info/kamere/" + m, 20000), 600);
  console.log("   page text " + t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1200));
  console.log("   terms " + ((t.match(/[^.]{0,200}(uvjeti|copyright|©|zabranjeno|prenošenje)[^.]{0,200}/i) || [""])[0]));
}
/* ---------- round 18 (2026-11-08): retry every earlier dead end, then new official keyless lists and open-data catalogues ---------- */
async function twice(u, ms = 40000, headers = {}) {
  // Shane's rule: more than one attempt per source; a second try after a pause, a third after a longer one
  let r;
  for (const wait of [0, 8000, 20000]) { if (wait) await new Promise((ok) => setTimeout(ok, wait)); r = await get(u, ms, headers); if (r.s === 200) return r; }
  return r;
}
async function round18() {
  const show = (k, r, n = 700) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  const firstImg = async (r, k) => { const t = r.b.toString("utf8"); const m = [...new Set(t.match(/https?:\\?\/\\?\/[^"'<>\s,]+?\.(?:jpg|jpeg|png)(?:\?[^"'<>\s,]*)?/gi) || [])].map((x) => x.replace(/\\\//g, "/")).slice(0, 2); for (const u of m) await img(u, "   " + k + " img"); if (!m.length) console.log("   (no image url in body)"); };
  const L = [
    // retries of earlier dead ends
    ["TW freeway CCTV xml", "https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml"],
    ["TW freeway CCTV gz", "https://tisvcloud.freeway.gov.tw/cctv_info.xml.gz"],
    ["TW civil IoT", "https://sta.ci.taiwan.gov.tw/STA_CCTV/v1.0/Things?$top=2&$expand=Locations"],
    ["KY goky", "https://services2.arcgis.com/CcI36Pduqd0OR4W9/ArcGIS/rest/services/trafficCamerasCur_Prd/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=3"],
    ["IL idot", "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2&outSR=4326"],
    ["IL idot count", "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"],
    ["MO arcgis", "https://services2.arcgis.com/jWXb6JPWtBjOCalT/arcgis/rest/services/MODOT_Traffic_Cameras/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2&outSR=4326"],
    ["MO traveler", "https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json"],
    ["MI midrive", "https://mdotjboss.state.mi.us/MiDrive/camera/AllForMap/"],
    ["MI midrive 2", "https://mdotjboss.state.mi.us/MiDrive/camera/list"],
    ["TN opendata", "https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras"],
    ["QC wfs", "https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outputformat=geojson&count=3"],
    ["NSW maritime", "https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/TfNSW_Maritime_Camera_Public/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=3"],
    ["MeteoSwiss", "https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/webcam_overview.json"],
    ["Puertos", "https://portus.puertos.es/portussvr/api/stations"],
    ["QLD", "https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b"],
    ["NDBC west", "https://www.ndbc.noaa.gov/buoycams.php"],
    // new: city and state open data
    ["Toronto gis", "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/3/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2&outSR=4326"],
    ["Toronto gis count", "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/3/query?where=1%3D1&returnCountOnly=true&f=json"],
    ["Toronto info", "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/3/iteminfo?f=pjson"],
    ["Ottawa list", "https://traffic.ottawa.ca/service/camera"],
    ["Ottawa list 2", "https://traffic.ottawa.ca/map/service/camera"],
    ["Ottawa opendata", "https://traffic.ottawa.ca/en/opendata"],
    ["Ontario pkg", "https://data.ontario.ca/api/3/action/package_show?id=traffic-cameras"],
    ["Montreal search", "https://donnees.montreal.ca/api/3/action/package_search?q=cam%C3%A9ra%20circulation&rows=5"],
    ["Quebec pkg", "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=camera-de-circulation"],
    ["Calgary catalog", "https://data.calgary.ca/api/catalog/v1?q=traffic%20camera&limit=5"],
    ["Edmonton catalog", "https://data.edmonton.ca/api/catalog/v1?q=traffic%20camera&limit=5"],
    ["Austin arcgis", "https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/TRANSPORTATION_traffic_cameras/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2&outSR=4326"],
    ["Austin socrata", "https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=2"],
    ["Seattle sdot", "https://web.seattle.gov/Travelers/api/Map/Data?zoomId=13&type=2"],
    ["Alabama algo", "https://api.algotraffic.com/v3.0/Cameras"],
    ["Alabama algo v4", "https://api.algotraffic.com/v4.0/Cameras"],
    ["Oklahoma", "https://oktraffic.org/api/CameraPoles"],
    ["Virginia", "https://511.vdot.virginia.gov/services/map/layers/map/cams"],
    ["West Virginia", "https://wv511.org/wsvc/gmap.asmx/buildCamerasJSONjs"],
    ["New Mexico", "https://servicev5.nmroads.com/RealMapWAR/GetCameraInfo"],
    ["Montana", "https://app.mdt.mt.gov/atms/public/cameras"],
    ["Hawaii", "https://hawaii511.org/api/cameras"],
    ["NI trafficwatch", "https://www.trafficwatchni.com/twni/cameras/static"],
    ["Traffic England", "https://www.trafficengland.com/api/cctv/getToBounds?bbox=-6,49.8,2,55.9&zoom=7"],
    ["Traffic Scotland", "https://trafficscotland.org/data/cameras.json"],
    ["Traffic Wales", "https://traffic.wales/api/cameras"],
    ["Slovenia", "https://www.promet.si/dc/b2b.kamere.geojson.sl_SI"],
    ["Estonia", "https://tarktee.ee/api/cameras"],
    ["Ireland", "https://traffic.tii.ie/api/cameras"],
    ["HKO station csv", "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperature.csv"],
    // discovery: national open-data catalogues
    ["data.gov", "https://catalog.data.gov/api/3/action/package_search?q=%22traffic%20cameras%22&rows=40"],
    ["open.canada", "https://open.canada.ca/data/api/3/action/package_search?q=traffic%20camera&rows=25"],
    ["data.europa", "https://data.europa.eu/api/hub/search/search?q=webcam%20traffic&filter=dataset&limit=40"],
    ["data.gov.au", "https://data.gov.au/data/api/3/action/package_search?q=traffic%20camera&rows=25"],
    ["data.gov.uk", "https://data.gov.uk/api/action/package_search?q=traffic%20cameras&rows=25"],
  ];
  for (const [k, u] of L) {
    const r = await twice(u, 40000);
    show(k, r, /catalog|search|pkg|data\.|open\./.test(k) ? 200 : 700);
    if (r.s !== 200) continue;
    try {
      const j = JSON.parse(r.b);
      if (j.result && (j.result.results || j.result.resources)) {
        for (const x of (j.result.results || [j.result])) { console.log(`   * ${x.title || x.name} | ${(x.organization || {}).title || ""} | ${x.license_title || x.license_id || ""}`); for (const z of (x.resources || []).slice(0, 6)) console.log(`       ${z.format} ${String(z.url).slice(0, 160)}`); }
      } else if (j.results && k.includes("catalog")) { for (const x of j.results) console.log(`   * ${x.resource.name} | ${x.resource.id} | ${x.metadata.domain} | ${(x.resource.columns_name || []).join(",").slice(0, 200)}`); }
      else if (j.result && j.result.results === undefined && k === "data.europa") {}
      else if (k === "data.europa") { for (const x of (j.result || {}).results || []) console.log(`   * ${JSON.stringify(x.title).slice(0, 120)} | ${(x.catalog || {}).id} | ${(x.distributions || []).map((d) => d.access_url).slice(0, 2).join(" ")}`); }
      else if (j.count !== undefined && !j.features) console.log("   count " + j.count);
      else sample(r, 900);
    } catch { /* xml or text */ }
    if (!/count|info|catalog|search|pkg|data\.|open\./.test(k)) await firstImg(r, k);
  }
  console.log("\n##### r18b. ArcGIS Online: public feature services named like traffic/road cameras");
  for (const q of ['title:"traffic cameras" type:"Feature Service"', 'title:"traffic camera" type:"Feature Service"', 'title:cctv type:"Feature Service"', 'title:webcam type:"Feature Service"', 'title:"road cameras" type:"Feature Service"', 'title:"camera locations" type:"Feature Service"']) {
    const r = await twice(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}&num=100&f=json&sortField=numViews&sortOrder=desc`);
    line("search " + q, r);
    try { for (const x of JSON.parse(r.b).results || []) console.log(`   ${x.title} | ${x.owner} | ${x.access} | ${x.licenseInfo ? String(x.licenseInfo).replace(/<[^>]+>/g, "").slice(0, 60) : ""} | ${x.url}`); } catch {}
  }
  console.log("\n##### r18c. Agency camera maps in a browser: the camera data each one asks for");
  const { chromium } = await import("playwright"); const br = await chromium.launch();
  const sites = [["TX", "https://drivetexas.org/"], ["TN", "https://smartway.tn.gov/traffic"], ["SC", "https://www.511sc.org/"], ["AR", "https://www.idrivearkansas.com/"], ["OK", "https://oktraffic.org/"], ["AL", "https://algotraffic.com/"],
    ["WY", "https://map.wyoroad.info/"], ["MS", "https://www.mdottraffic.com/"], ["NM", "https://nmroads.com/"], ["VA", "https://511.vdot.virginia.gov/"], ["MI", "https://mdotjboss.state.mi.us/MiDrive/map"], ["OH", "https://www.ohgo.com/"], ["KY", "https://goky.ky.gov/"], ["HI", "https://hidot.hawaii.gov/highways/"], ["SEA", "https://web.seattle.gov/travelers/"],
    ["OTT", "https://traffic.ottawa.ca/en/traffic-map"], ["NI", "https://www.trafficwatchni.com/twni/cameras"], ["SCO", "https://trafficscotland.org/currentincidents/"], ["WAL", "https://traffic.wales/cameras"], ["ENG", "https://www.trafficengland.com/traffic-report"],
    ["NO", "https://www.vegvesen.no/trafikk/kart/?layers=webkamera"], ["SI", "https://www.promet.si/sl/kamere"], ["EE", "https://tarktee.ee/"], ["LV", "https://lvceli.lv/kameras/"], ["IE", "https://traffic.tii.ie/"], ["DK", "https://trafikkort.vejdirektoratet.dk/"],
    ["SA", "https://traffic.sa.gov.au/"], ["WA", "https://travelmap.mainroads.wa.gov.au/"], ["TAS", "https://www.transport.tas.gov.au/roadside-cameras"], ["HKO", "https://www.hko.gov.hk/en/wxinfo/ts/webcam.htm"], ["TW", "https://1968.freeway.gov.tw/"], ["MY", "https://www.llm.gov.my/"], ["MO", "https://www.dsat.gov.mo/dsat/realtime.aspx"]];
  for (const [k, u] of sites) {
    const ctx = await br.newContext(); const pg = await ctx.newPage(); const seen = [];
    pg.on("response", async (r) => { const ct = r.headers()["content-type"] || "", url = r.url();
      if (/json|xml|geo|javascript/.test(ct) && /cam|kamer|kaam|cctv|webcam|video|camara/i.test(url)) { let n = 0; try { n = (await r.body()).length; } catch {} seen.push(r.status() + " " + ct.split(";")[0] + " " + n + "B " + url.slice(0, 220)); }
      else if (/image\/(jpe?g|png)/.test(ct) && /cam|kamer|kaam|cctv|webcam|snapshot/i.test(url) && seen.filter((x) => / image\//.test(x)).length < 3) seen.push(r.status() + " " + ct + " " + url.slice(0, 220)); });
    try { await pg.goto(u, { waitUntil: "networkidle", timeout: 40000 }); } catch (e) { seen.push("goto " + e.message.slice(0, 80)); }
    await pg.waitForTimeout(4000);
    console.log(k + " " + u + " title=" + (await pg.title().catch(() => "")).slice(0, 60) + "\n   " + (seen.slice(0, 14).join("\n   ") || "(no camera data seen)"));
    await ctx.close();
  }
  await br.close();
}
if (only === "r18") await round18();
/* ---------- round 19 (2026-11-08): field details for the lists round 18 found, image checks, and each source's terms ---------- */
async function round19() {
  const show = (k, r, n = 1500) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  const arc = (base, n = 2) => `${base}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=${n}&outSR=4326`;
  const cnt = (base) => `${base}/query?where=1%3D1&returnCountOnly=true&f=json`;
  const imgsIn = async (r, k, max = 3) => { const t = r.b.toString("utf8"); const m = [...new Set(t.match(/https?:\\?\/\\?\/[^"'<>\s,\\]+?\.(?:jpg|jpeg|png)(?:\?[^"'<>\s,\\]*)?/gi) || [])].slice(0, max); for (const u of m) { await img(u, "   " + k); if (u.startsWith("http:")) await img(u.replace("http:", "https:"), "   " + k + " as https"); } };
  const L = [
    ["IL", arc("https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0")],
    ["IL info", "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer?f=json"],
    ["MI", "https://mdotjboss.state.mi.us/MiDrive/camera/list"],
    ["MO", "https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json"],
    ["QC", "https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&srsname=EPSG:4326&outputformat=geojson&count=2"],
    ["TOR", arc("https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/3", 1)],
    ["OTT city", "https://traffic.ottawa.ca/service/camera?type=city&format=geojson"],
    ["OTT mto", "https://traffic.ottawa.ca/service/camera?type=mto&format=geojson"],
    ["AUS count", cnt("https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/TRANSPORTATION_traffic_cameras/FeatureServer/0")],
    ["AUS", arc("https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/TRANSPORTATION_traffic_cameras/FeatureServer/0", 1)],
    ["SEA", "https://web.seattle.gov/Travelers/api/Map/Data?zoomId=13&type=2"],
    ["AL", "https://api.algotraffic.com/v4.0/Cameras"],
    ["NM", "https://servicev5.nmroads.com/RealMapWAR/GetCameraInfo"],
    ["SC", "https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson"],
    ["VA array", "https://511.vdot.virginia.gov/services/511/map/array/cameras"],
    ["VA layers", "https://511.vdot.virginia.gov/services/511/map/layers/cameras"],
    ["KY louisville", "https://services1.arcgis.com/Mg7DLdfYcSWIaDnu/ArcGIS/rest/services/Traffic_Camera_Locations_Public_view/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json&resultRecordCount=2"],
    ["KY state", arc("https://services2.arcgis.com/CcI36Pduqd0OR4W9/ArcGIS/rest/services/trafficCamerasCur_Prd/FeatureServer/0", 40)],
    ["OK", "https://oktraffic.org/api/CameraPoles"],
    ["OK 2", "https://oktraffic.org/api/Cameras"],
    ["CAL", "https://data.calgary.ca/resource/k7p9-kppz.json?$limit=2"],
    ["BR", "https://data.brla.gov/resource/6z6u-ts44.json?$limit=2"],
    ["MeteoSwiss", "https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/webcam_overview.json"],
    ["NI js", "https://www.trafficwatchni.com/twni/javascript/twni/cctv-e532ba40852e14ec510664ef8bb3a0c6.js"],
    ["NI page", "https://www.trafficwatchni.com/twni/cameras"],
    ["MT", "https://app.mdt.mt.gov/atms/public/cameras"],
    ["Yosemite", arc("https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_Webcams/FeatureServer/0")],
    ["NPS air", "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/Air_Quality_Monitoring_Map_WFL1/FeatureServer?f=json"],
    ["Hydro Tas", arc("https://services.arcgis.com/bzFxSiUBPalI1RGS/arcgis/rest/services/PublicSites_Featurelayer_webcams/FeatureServer/0")],
    ["Horizons NZ", arc("https://services1.arcgis.com/VuN78wcRdq1Oj69W/arcgis/rest/services/Webcams_Feed/FeatureServer/0")],
    ["Idaho state", arc("https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Webcams/FeatureServer/0")],
    ["Rotterdam port", arc("https://services-eu1.arcgis.com/ihRA6Ia7xOeMbqC0/arcgis/rest/services/Webcams_v2/FeatureServer/0")],
    ["La Palma", arc("https://services.arcgis.com/hkQNLKNeDVYBjvFE/arcgis/rest/services/webcam/FeatureServer/0")],
    ["Donegal", arc("https://services2.arcgis.com/WRtfelnPg3R7bCEW/arcgis/rest/services/TrafficCameras/FeatureServer/0")],
    ["Bellevue", arc("https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/TrafficCameras_Public_View/FeatureServer/0")],
    ["Kamloops", arc("https://services1.arcgis.com/9adZBnEF9zjV0l5X/arcgis/rest/services/WebCameras/FeatureServer/0")],
    ["Moncton", arc("https://services1.arcgis.com/E26PuSoie2Y7bbyI/arcgis/rest/services/Webcams/FeatureServer/0")],
    ["Coastal GA", arc("https://services1.arcgis.com/2iUE8l8JKrP2tygQ/arcgis/rest/services/Coastal_GA_WebCams/FeatureServer/0")],
    ["GDOT gema", arc("https://services1.arcgis.com/2iUE8l8JKrP2tygQ/arcgis/rest/services/GDOT_Live_Traffic_Cameras/FeatureServer/0")],
    ["CalOES webcams", arc("https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CalOES_California_Webcams/FeatureServer/0")],
    ["CalOES count", cnt("https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CalOES_California_Webcams/FeatureServer/0")],
    ["Lawrence KS", arc("https://services.arcgis.com/8O9UlSTnqjKptoda/arcgis/rest/services/Traffic_Cameras/FeatureServer/0")],
    ["Raleigh", arc("https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Traffic_Signals_Cameras_1/FeatureServer/0")],
    ["Portland PBOT", arc("https://services.arcgis.com/quVN97tn06YNGj9s/arcgis/rest/services/pbot_traffic_cameras/FeatureServer/0")],
    ["Montgomery TX", arc("https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/MCTX_Live_Cameras/FeatureServer/0")],
    ["King County", arc("https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/TRAFFICCAMERA_POINT_2029/FeatureServer/0")],
    ["Weather_WebCam_Public", arc("https://services.arcgis.com/EeYBJFxLdUojipYa/arcgis/rest/services/Weather_WebCam_Public/FeatureServer/0")],
    ["DC", arc("https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_Sensors_WebMercator/MapServer/93")],
    ["Sioux Falls", arc("https://gis.siouxfalls.gov/arcgis/rest/services/Data/Traffic/MapServer/8")],
    ["QLD", "https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b"],
  ];
  for (const [k, u] of L) {
    const r = await twice(u, 60000);
    show(k, r, 1600);
    if (r.s === 200) {
      try { const j = JSON.parse(r.b); const a = Array.isArray(j) ? j : j.features || j.cameras || j.Features || j.stations || j.data || j.cameraInfo || Object.values(j).find(Array.isArray); if (Array.isArray(a)) console.log("   items " + a.length); } catch {}
      if (!/count|info/.test(k)) await imgsIn(r, k);
    }
  }
  // MoDOT streams: will a browser on the site be allowed to play them (CORS on the playlist)?
  for (const u of ["https://sfs02-traveler.modot.mo.gov/rtplive/MODOT_CAM_209/playlist.m3u8"]) { const r = await get(u, 20000); show("MO hls", r, 300); }
  console.log("\n##### r19b. Terms of use: sentences about commercial use, reuse, copyright");
  const T = [
    ["IL gettingaroundillinois", "https://www.gettingaroundillinois.com/Disclaimer.html"], ["IL travelmidwest", "https://www.travelmidwest.com/lmiga/disclaimer.jsp"],
    ["MI disclaimer", "https://www.michigan.gov/mdot/about/mi-drive-disclaimer"], ["MO traveler", "https://traveler.modot.org/map/"], ["MO disclaimer", "https://www.modot.org/disclaimer"],
    ["Toronto OGL", "https://open.toronto.ca/open-data-licence/"], ["Ottawa", "https://traffic.ottawa.ca/en/opendata"], ["Ottawa licence", "https://open.ottawa.ca/pages/open-data-licence-version-2-0"],
    ["Austin", "https://data.austintexas.gov/Transportation-and-Mobility/Traffic-Cameras/b4k4-adkb/about_data"], ["Seattle", "https://www.seattle.gov/tech/reports-and-data/open-data/open-data-policy"], ["Seattle cams", "https://web.seattle.gov/travelers/"],
    ["ALGO terms", "https://algotraffic.com/terms"], ["ALGO about", "https://algotraffic.com/about"], ["NM", "https://nmroads.com/"], ["SC", "https://www.511sc.org/#help"], ["VA", "https://511.vdot.virginia.gov/terms"], ["VA 2", "https://www.virginiadot.org/travel/511.asp"],
    ["Calgary", "https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa"], ["OK", "https://oktraffic.org/"], ["KY", "https://goky.ky.gov/"], ["MeteoSwiss", "https://opendatadocs.meteoswiss.ch/general/terms-of-use"],
    ["HPWREN", "https://www.hpwren.ucsd.edu/news/20210318/"], ["HPWREN 2", "https://www.hpwren.ucsd.edu/info/"], ["TripCheck", "https://tripcheck.com/Pages/Terms"], ["TripCheck 2", "https://www.tripcheck.com/Pages/About-TripCheck"],
    ["CHART", "https://chart.maryland.gov/AboutUs/GetAboutUs"], ["DelDOT", "https://deldot.gov/About/disclaimer.shtml"], ["NYC DOT", "https://webcams.nyctmc.org/"], ["FL511", "https://fl511.com/help/terms"], ["511 ATIS terms", "https://511pa.com/help/terms"],
    ["iTIC", "https://www.iticfoundation.org/"], ["Longdo", "https://camera.longdo.com/"], ["ThaiWater", "https://www.thaiwater.net/"], ["DWR", "https://telemetry.dwr.go.th/"], ["river.go.jp", "https://www.river.go.jp/kawabou/reference/index05.html"],
    ["Arkansas", "https://site.idrivearkansas.com/index.php/policies/camera-terms-of-use/"], ["National Highways", "https://nationalhighways.co.uk/roads-and-travel/live-travel-updates/traffic-cameracctv-services/standard-terms-and-conditions/"],
    ["Quebec 511", "https://www.quebec511.info/fr/a-propos/conditions.aspx"], ["eismoinfo", "https://eismoinfo.lt/"], ["Vegagerdin", "https://www.vegagerdin.is/upplysingar-og-utgafa/opin-gogn"],
  ];
  for (const [k, u] of T) {
    const r = await twice(u, 40000); line("terms " + k + " " + u, r);
    const t = r.b.toString("utf8").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    const hits = [...new Set(t.match(/[^.]{0,220}(commercial|redistribut|copyright|licen[cs]e|reproduc|permission|営利|商用|เชิงพาณิชย์|ลิขสิทธิ์)[^.]{0,220}/gi) || [])].slice(0, 6);
    for (const h of hits) console.log("   > " + h.trim());
  }
}
if (only === "r19") await round19();
/* ---------- round 20 (2026-11-08): the last field and image questions before building the new sources ---------- */
async function round20() {
  const show = (k, r, n = 1200) => { line(k, r); if (r.n) console.log("   " + r.b.toString("utf8").slice(0, n).replace(/\s+/g, " ")); };
  const attrs = async (k, base, n = 2) => { const r = await twice(`${base}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=${n}&outSR=4326`, 40000); line(k, r); try { const j = JSON.parse(r.b); for (const f of (j.features || []).slice(0, n)) console.log("   attrs " + JSON.stringify(f.attributes).slice(0, 1400) + " geom " + JSON.stringify(f.geometry)); } catch {} const c = await twice(`${base}/query?where=1%3D1&returnCountOnly=true&f=json`); console.log("   count " + c.b.toString().slice(0, 40)); };
  const item = async (k, id) => { const r = await twice(`https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`); try { const j = JSON.parse(r.b); console.log(`item ${k}: ${j.title} | owner ${j.owner} | access ${j.access} | licence: ${String(j.licenseInfo || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600)} | credits ${j.accessInformation}`); } catch { line("item " + k, r); } };
  await attrs("CalOES", "https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CalOES_California_Webcams/FeatureServer/0", 4);
  const ci = await twice("https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CalOES_California_Webcams/FeatureServer?f=json"); try { const j = JSON.parse(ci.b); console.log("   CalOES service item " + j.serviceItemId + " | " + String(j.serviceDescription || "").slice(0, 300)); if (j.serviceItemId) await item("CalOES", j.serviceItemId); } catch {}
  const grp = await twice("https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CalOES_California_Webcams/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json&resultRecordCount=2000");
  try { const j = JSON.parse(grp.b); const by = {}; for (const f of j.features || []) { const a = f.attributes; const k = Object.entries(a).filter(([, v]) => typeof v === "string" && /^https?:/.test(v)).map(([n, v]) => n + "=" + new URL(v).host).join(" ") || "no-url"; by[k] = (by[k] || 0) + 1; } console.log("   CalOES url hosts in first 2000: " + JSON.stringify(by).slice(0, 1500)); } catch (e) { console.log("   " + e); }
  await attrs("IL", "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0");
  await item("IL", "8a885da23dfb46caaa1827ad920fb5b1");
  await attrs("AUS", "https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/TRANSPORTATION_traffic_cameras/FeatureServer/0", 1);
  await attrs("TOR", "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/3", 1);
  await attrs("Lexington", "https://services1.arcgis.com/Mg7DLdfYcSWIaDnu/ArcGIS/rest/services/Traffic_Camera_Locations_Public_view/FeatureServer/0");
  await attrs("King County", "https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/TRAFFICCAMERA_POINT_2029/FeatureServer/0");
  const lx = "https://6855e4345af72.streamlock.net:1935/thumbnail?application=lexington-live&streamname=lex-cam-014.stream&size=600x400"; await img(lx, "  Lexington thumb");
  for (const u of ["https://traffic.ottawa.ca/beta/camera?id=49", "https://traffic.ottawa.ca/map/camera?id=49", "https://traffic.ottawa.ca/opendata/camera?c=49", "https://traffic.ottawa.ca/camera?id=49", "https://traffic.ottawa.ca/service/camera/49/image"]) await img(u, "  Ottawa try");
  for (const u of ["https://www.seattle.gov/trafficcams/images/Fauntleroy_SW_Cloverdale_NS.jpg", "https://web.seattle.gov/trafficcams/images/Fauntleroy_SW_Cloverdale_NS.jpg", "https://web6.seattle.gov/travelers/images/Fauntleroy_SW_Cloverdale_NS.jpg"]) await img(u, "  Seattle try");
  show("Seattle camera js", await twice("https://web.seattle.gov/Travelers/js/camera.video.js"), 3000);
  for (const u of ["https://ss.nmroads.com/snapshots/i25_lowerlabajada.jpg", "https://nmroads.com/snapshots/i25_lowerlabajada.jpg"]) await img(u, "  NM https");
  const ms = await twice("https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/webcam_overview.json"); try { const j = JSON.parse(ms.b); const st = j.stations || []; console.log("   MeteoSwiss keys " + JSON.stringify(Object.fromEntries(Object.entries(st[0]).map(([k, v]) => [k, typeof v === "string" && v.length > 200 ? "(" + v.length + " chars)" : v]))).slice(0, 1500)); console.log("   other top keys " + Object.keys(j).join(",")); } catch (e) { console.log("   " + e); }
  for (const u of ["https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/webcams/ZER.jpg", "https://www.meteoswiss.admin.ch/product/output/webcams/"]) show("MeteoSwiss try " + u, await get(u, 20000), 200);
  const mt = await twice("https://app.mdt.mt.gov/atms/public/cameras"); const t = mt.b.toString("utf8"); console.log("   MT lat mentions " + (t.match(/lat(itude)?["':=\s]+[-\d.]{4,}/gi) || []).slice(0, 3).join(" | ") + " | data- attrs " + [...new Set(t.match(/data-[a-z-]+=/g) || [])].slice(0, 20).join(" ") + " | sample " + t.slice(t.indexOf("RWIS") - 600, t.indexOf("RWIS") + 400).replace(/\s+/g, " "));
  // Quebec: the camera window page in a browser; which image does it show?
  const { chromium } = await import("playwright"); const br = await chromium.launch();
  for (const [k, u] of [["QC", "https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=3998"], ["OTT", "https://traffic.ottawa.ca/en/traffic-map"], ["SEA", "https://web.seattle.gov/travelers/"]]) {
    const pg = await (await br.newContext()).newPage(); const seen = [];
    pg.on("response", (r) => { const ct = r.headers()["content-type"] || ""; if (/image\/(jpe?g|png)|mpegurl|json/.test(ct) && !/google|gstatic|tile|icon|logo/i.test(r.url())) seen.push(r.status() + " " + ct.split(";")[0] + " " + r.url().slice(0, 200)); });
    try { await pg.goto(u, { waitUntil: "networkidle", timeout: 45000 }); } catch (e) { seen.push("goto " + e.message.slice(0, 60)); }
    if (k !== "QC") { try { await pg.click("text=/camera/i", { timeout: 5000 }); } catch {} }
    await pg.waitForTimeout(5000); console.log(k + " title " + (await pg.title().catch(() => "")) + "\n   " + seen.slice(0, 25).join("\n   "));
  }
  await br.close();
}
if (only === "r20") await round20();
if (only === "r13") await round13();
if (only === "r12") await round12();
if (only === "r11") await round11();
if (only === "r10") await round10();
if (only === "r9") await round9();
if (only === "r8") await round8();
if (only === "r7") await round7();
if (only === "r5") await round5();
if (only === "r6") await round6();
if (only === "r2") await round2();
if (only === "r4") await round4();
if (only === "r3") await round3();
if (!only || only === "browser") await browserCheck().catch((e) => console.log("browser check failed: " + e));
if (!only || only === "lists") await candidates();
