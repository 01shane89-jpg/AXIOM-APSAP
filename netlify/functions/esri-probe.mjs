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
  out.staticTiles = { status: sm.status, list: sm.j && sm.j.styles ? sm.j.styles.map((x) => x.path) : null };
  const dims = async (u) => {
    try {
      const r = await fetch(u + (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(k), { headers: { referer: REF } });
      const b = new Uint8Array(await r.arrayBuffer());
      let w = null, h = null;
      if (b[0] === 0x89 && b[1] === 0x50) { w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]; h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]; }
      else if (b[0] === 0xff && b[1] === 0xd8) { for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) break; const m = b[i + 1], L = (b[i + 2] << 8) | b[i + 3]; if (m >= 0xc0 && m <= 0xc3) { h = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8]; break; } i += 2 + L; } }
      return r.status + " " + r.headers.get("content-type") + " " + b.length + "B " + w + "x" + h;
    } catch (e) { return "err " + (e.message || e); }
  };
  out.tileChecks2 = {
    staticNav: await dims("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/navigation/static/tile/3/3/6"),
    staticOpenStreets: await dims("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/open/streets/static/tile/3/3/6"),
    staticNova: await dims("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/nova/static/tile/3/3/6"),
    soldImagery: await dims("https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/3/3/6"),
    soldHillshade: await dims("https://ibasemaps-api.arcgis.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/3/3/6"),
    soldTransport: await dims("https://basemaps-api.arcgis.com/arcgis/rest/services/Reference/World_Transportation/MapServer/tile/3/3/6"),
    soldPlaces: await dims("https://basemaps-api.arcgis.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/3/3/6"),
    iTransport: await dims("https://ibasemaps-api.arcgis.com/arcgis/rest/services/Reference/World_Transportation/MapServer/tile/3/3/6"),
    iPlaces: await dims("https://ibasemaps-api.arcgis.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/3/3/6"),
    staticImgLabels: await dims("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/imagery/labels/static/tile/3/3/6"),
    staticHillshade: await dims("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/hillshade/light/static/tile/3/3/6"),
    staticEn: await dims("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/navigation/static/tile/3/3/6?language=en"),
    staticZ19: await dims("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/navigation/static/tile/18/123234/208960"),
    vectorTile: await dims("https://basemaps-api.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/tile/3/3/6.pbf")
  };
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
export const config = { path: "/api/esri-probe" };
