// Test only: renders Bangkok and Tokyo from candidate keyless base maps so label language can be compared by eye.
// Used by .github/workflows/probe-label-lang.yml; writes screenshots to probe-out/ only.
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
await mkdir("probe-out", { recursive: true });
const RASTER = {
  osm: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  esri_street: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  esri_topo: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
  carto_voyager: "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
  opentopo: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  wikimedia_en: "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png?lang=en",
  esri_ref_places: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
};
const PLACES = { bkk: [13.75, 100.5], tokyo: [35.68, 139.76], moscow: [55.75, 37.62] };
const ZS = [7, 13];
function tile(lat, lon, z) { const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n)]; }
const OUT = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 768, height: 512 } });
for (const [k, u] of Object.entries(RASTER)) for (const [p, [la, lo]] of Object.entries(PLACES)) for (const z of ZS) {
  const [x, y] = tile(la, lo, z); let h = "<body style='margin:0;display:grid;grid-template-columns:repeat(3,256px)'>";
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) h += `<img src="${u.replace("{z}", z).replace("{x}", x + dx).replace("{y}", y + dy)}" width=256 height=256>`;
  await page.setContent(h, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  const ok = await page.evaluate(() => [...document.images].filter((i) => i.naturalWidth).length);
  OUT[k] = (OUT[k] || "") + ` ${p}z${z}:${ok}/9`;
  await page.screenshot({ path: `probe-out/${k}-${p}-z${z}.png` });
}
// vector: OpenFreeMap and VersaTiles with every label forced to English, falling back to the local name
const lib = await readFile("assets/vendor/maplibre-gl-5.24.0.js", "utf8"), css = await readFile("assets/vendor/maplibre-gl-5.24.0.css", "utf8");
const STYLES = { ofm_liberty: "https://tiles.openfreemap.org/styles/liberty", ofm_bright: "https://tiles.openfreemap.org/styles/bright", versatiles: "https://tiles.versatiles.org/assets/styles/colorful/style.json" };
for (const [k, su] of Object.entries(STYLES)) for (const [p, [la, lo]] of Object.entries(PLACES)) for (const z of ZS) {
  const vp = await browser.newPage({ viewport: { width: 768, height: 512 } });
  vp.on("pageerror", (e) => console.log(k, "pageerror", e.message));
  await vp.setContent(`<style>${css}</style><body style="margin:0"><div id=m style="width:768px;height:512px"></div>`);
  await vp.addScriptTag({ content: lib });
  const res = await vp.evaluate(async ([su, la, lo, z]) => {
    const st = await (await fetch(su)).json(); const fields = new Set();
    st.layers.forEach((l) => { if (l.layout && l.layout["text-field"]) { fields.add(JSON.stringify(l.layout["text-field"]).slice(0, 120));
      l.layout["text-field"] = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]]; } });
    const m = new maplibregl.Map({ container: "m", style: st, center: [lo, la], zoom: z - 1, attributionControl: false });
    await new Promise((r) => { m.on("idle", r); setTimeout(r, 25000); });
    // which name keys exist in the place layer
    const sym = m.queryRenderedFeatures().filter((x) => x.layer.type === "symbol" && x.properties && x.properties.name);
    const keys = [...new Set(sym.flatMap((x) => Object.keys(x.properties).filter((q) => /name/.test(q))))].join(",");
    const shown = [...new Set(sym.map((x) => x.properties["name:en"] || x.properties.name_en || x.properties.name))].slice(0, 12).join(" | ");
    const en = sym.filter((x) => x.properties["name:en"] || x.properties.name_en).length;
    return { en: en + "/" + sym.length, shown };
  }, [su, la, lo, z]).catch((e) => ({ err: String(e) }));
  OUT[k] = (OUT[k] || "") + ` ## ${p}z${z} ` + JSON.stringify(res).replace(/\\n/g, " ");
  await vp.screenshot({ path: `probe-out/${k}-${p}-z${z}.png` }); await vp.close();
}
await browser.close();
for (const [k, v] of Object.entries(OUT)) console.log(`::notice title=${k}::` + v.slice(0, 3000));
