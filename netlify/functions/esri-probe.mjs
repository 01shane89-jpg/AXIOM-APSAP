// TEMPORARY probe (removed before merge): asks Esri which basemap styles and tile services the site's ArcGIS Location
// Platform key (OSAP_ESRI_KEY) can use. Returns names and HTTP statuses only; the key is never returned or logged.
const REF = "https://axiom-osap.netlify.app/";
export default async () => {
  const k = String(Netlify.env.get("OSAP_ESRI_KEY") || "").trim();
  if (!k) return Response.json({ key: false });
  const red = (s) => String(s).split(k).join("<key>").split(encodeURIComponent(k)).join("<key>");
  const get = async (u) => {
    try {
      const r = await fetch(u + (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(k), { headers: { referer: REF } });
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch (e) {}
      return { status: r.status, type: r.headers.get("content-type"), j, t };
    } catch (e) { return { status: 0, err: String(e.message || e) }; }
  };
  const out = { key: true };
  const st = await get("https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/self");
  out.styles = { status: st.status, err: st.j && st.j.error, list: st.j && st.j.styles ? st.j.styles.map((s) => ({ name: s.name, path: s.path, provider: s.provider, deprecated: s.deprecated })) : null,
    languages: st.j && st.j.languages ? st.j.languages.length : null, worldviews: st.j && st.j.worldviews ? st.j.worldviews.map((w) => w.code) : null, places: st.j && st.j.places };
  if (!out.styles.list && st.t) out.styles.body = red(st.t.slice(0, 600));
  const sj = await get("https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/navigation?language=en");
  out.navStyle = { status: sj.status, tokenInUrls: !!(sj.t && sj.t.includes(k)), sources: sj.j && sj.j.sources ? Object.keys(sj.j.sources).map((s) => red(JSON.stringify(sj.j.sources[s])).slice(0, 300)) : null,
    sprite: sj.j && red(JSON.stringify(sj.j.sprite)).slice(0, 300), glyphs: sj.j && red(String(sj.j.glyphs)).slice(0, 300) };
  const sm = await get("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/self");
  out.staticTiles = { status: sm.status, body: sm.t ? red(sm.t.slice(0, 3000)) : null };
  out.raster = {};
  for (const host of ["https://ibasemaps-api.arcgis.com", "https://basemaps-api.arcgis.com"]) {
    const root = await get(host + "/arcgis/rest/services?f=json");
    const svcs = [];
    const add = (j) => (j && j.services || []).forEach((s) => svcs.push(s.name + "/" + s.type));
    add(root.j);
    for (const f of (root.j && root.j.folders) || []) add((await get(host + "/arcgis/rest/services/" + f + "?f=json")).j);
    const tiles = {};
    for (const s of svcs) {
      const [name, type] = [s.slice(0, s.lastIndexOf("/")), s.slice(s.lastIndexOf("/") + 1)];
      const u = host + "/arcgis/rest/services/" + name + "/" + type + (type === "MapServer" ? "/tile/3/3/6" : "/tile/3/3/6.pbf");
      const r = await get(u);
      tiles[s] = r.status + " " + (r.type || "");
    }
    out.raster[host] = { status: root.status, err: root.j && root.j.error, folders: root.j && root.j.folders, tiles };
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
export const config = { path: "/api/esri-probe" };
