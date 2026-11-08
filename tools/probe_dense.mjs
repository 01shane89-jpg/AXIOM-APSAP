// PROBE BRANCH ONLY: piracy sources round 3 (UKMTO incidents API from its Next.js bundle; ICC map ids, years and terms).
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const get = async (u, opt = {}) => { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(40000), ...opt }); return [r.status, await r.text(), r.headers.get("content-type")]; };
const strip = (t) => t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const [, page] = await get("https://www.ukmto.org/recent-incidents");
const nd = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(page); console.log("PND " + (nd ? nd[1].slice(0, 1500) : "none"));
for (const s of [...page.matchAll(/<script[^>]+src="([^"]+_next[^"]+)"/g)].map((m) => m[1])) {
  try { const [, js] = await get(s); for (const m of js.matchAll(/["'`]([^"'`\s]{0,80}(incident|Incident|api\/|\.json|graphql)[^"'`\s]{0,80})["'`]/g)) console.log("PJ " + s.split("/").pop() + " | " + m[1]); } catch (e) {}
}
for (const u of ["https://www.ukmto.org/api/incidents", "https://www.ukmto.org/api/recent-incidents", "https://www.ukmto.org/recent-incidents.json"]) { try { const [st, t, ct] = await get(u); console.log("PU " + u + " | " + st + " | " + ct + " | " + t.slice(0, 600).replace(/\s+/g, " ")); } catch (e) { console.log("PU " + u + " ERR " + e.message); } }
const [, map] = await get("https://icc-ccs.org/map/");
for (const m of map.matchAll(/href="([^"]*(terms|privacy|copyright)[^"]*)"/gi)) console.log("PIL " + m[1]);
const [, mk] = await get("https://icc-ccs.org/wp-json/wpgmza/v1/markers");
const all = JSON.parse(mk); const by = {};
for (const x of all) { const d = (x.custom_field_data || []).find((f) => /Date/.test(f.name)); const k = x.map_id + ":" + (d ? d.value.slice(0, 4) : "?"); by[k] = (by[k] || 0) + 1; }
console.log("PIC " + all.length + " " + JSON.stringify(by));
const latest = all.filter((x) => /2026/.test(JSON.stringify(x.custom_field_data || []))).slice(-3);
for (const x of latest) console.log("PIX " + JSON.stringify({ map: x.map_id, title: x.title, lat: x.lat, lng: x.lng, cats: x.categories, f: x.custom_field_data }).slice(0, 900));
const [, maps] = await get("https://icc-ccs.org/wp-json/wpgmza/v1/maps"); console.log("PIM " + JSON.parse(maps).map((m) => m.id + "=" + m.map_title).join(", "));
for (const u of ["https://icc-ccs.org/terms-conditions/", "https://icc-ccs.org/terms/", "https://icc-ccs.org/privacy-policy/"]) { try { const [st, t] = await get(u); console.log("PIT " + u + " " + st + " " + (strip(t).match(/.{0,250}(copyright|reproduc|commercial|permission).{0,350}/gi) || []).slice(0, 3).join(" || ")); } catch (e) {} }
