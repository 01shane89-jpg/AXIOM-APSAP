// Probe 6 (26 Nov 2026): EPA Region 7 Iowa Army Ammunition Plant air monitoring services: ownership, licence, fields, sample rows.
const B = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/";
const j = async (u) => { const r = await fetch(u); return r.json(); };
for (const s of ["IAAAP_Xact_Data_Public_Viewer", "Air_Sampling_and_Monitoring_Location"]) {
  try {
    const info = await j(B + s + "/FeatureServer/info/itemInfo?f=json");
    console.log("P", s, "owner=" + info.owner, "| title=" + info.title, "| licenseInfo=" + String(info.licenseInfo || "").replace(/<[^>]+>/g, " ").slice(0, 300), "| access=" + String(info.accessInformation || "").slice(0, 200), "| modified=" + info.modified);
    const sv = await j(B + s + "/FeatureServer?f=json");
    console.log("P", s, "layers", JSON.stringify((sv.layers || []).map((l) => [l.id, l.name])), "copyright=" + (sv.copyrightText || ""));
    for (const l of sv.layers || []) {
      const lm = await j(B + s + "/FeatureServer/" + l.id + "?f=json");
      console.log("P  layer", l.id, "fields", (lm.fields || []).map((f) => f.name + ":" + f.type.replace("esriFieldType", "")).join(","), "maxRecordCount=" + lm.maxRecordCount);
      const q = await j(B + s + "/FeatureServer/" + l.id + "/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=3&f=json");
      console.log("P  sample", JSON.stringify((q.features || []).slice(0, 3)).slice(0, 900));
      const c = await j(B + s + "/FeatureServer/" + l.id + "/query?where=1%3D1&returnCountOnly=true&f=json");
      console.log("P  count", c.count);
    }
  } catch (e) { console.log("P", s, "ERR", e.message); }
}
const org = await j("https://www.arcgis.com/sharing/rest/portals/cJ9YHowT8TU7DUyn?f=json").catch(() => ({}));
console.log("P org", org.name, org.urlKey);
