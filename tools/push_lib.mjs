// Push watches: shared rules for tools/push_admin.mjs (adds or stops a watch from a GitHub issue) and tools/push_watches.mjs
// (checks the watches after each refresh and sends new matches through ntfy.sh).
// A push watch is the same watch the app keeps in the browser (area, categories, severity, words) plus the ntfy channel ("topic")
// the phone subscribes to. The list is data/push/watches.json in this public repository, so nothing secret may go in it.
import fs from "node:fs";

export const FILE = "data/push/watches.json";
export const MAX_WATCHES = 25, MAX_AREA_POINTS = 150, MAX_WORDS = 20, MAX_LAYERS = 30;

export function readList() {
  try { const o = JSON.parse(fs.readFileSync(FILE, "utf8")); if (o && Array.isArray(o.watches)) return o; } catch (e) {}
  return { v: 1, watches: [] };
}
export function writeList(o) {
  o.v = 1;
  o.watches.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  fs.mkdirSync("data/push", { recursive: true });
  // one watch per line, so a change reads as one line in the history
  fs.writeFileSync(FILE, '{"v":1,"watches":[' + (o.watches.length ? "\n" + o.watches.map((w) => JSON.stringify(w)).join(",\n") + "\n" : "") + "]}\n");
}
function cleanText(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
export function countryOk(cc) { return typeof cc === "string" && /^[a-z]{2,3}$/.test(cc) && fs.existsSync(`data/live/news/${cc}.js`); }

// Checks one watch as sent from the app. Returns { watch } with only the known fields, cleaned, or { error } saying what is wrong.
export function validate(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return { error: "no watch found" };
  const id = String(w.id || "");
  if (!/^w[a-z0-9-]{3,40}$/.test(id)) return { error: "the watch id is not one the app makes" };
  const topic = String(w.topic || "");
  if (!/^osap-[a-z0-9]{16,40}$/.test(topic)) return { error: "the ntfy channel name is not one the app makes" };
  if (!countryOk(w.cc)) return { error: "unknown country" };
  const name = cleanText(w.name, 60) || w.cc.toUpperCase();
  let area = null;
  if (w.area != null) {
    if (!Array.isArray(w.area) || w.area.length < 3 || w.area.length > MAX_AREA_POINTS) return { error: `the area must have 3 to ${MAX_AREA_POINTS} points` };
    area = [];
    for (const p of w.area) {
      if (!Array.isArray(p) || p.length !== 2) return { error: "an area point is not [lat, lon]" };
      const la = +p[0], lo = +p[1];
      if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 360) return { error: "an area point is out of range" };
      area.push([Math.round(la * 1e4) / 1e4, Math.round(lo * 1e4) / 1e4]);
    }
  }
  const layers = Array.isArray(w.layers) ? w.layers.filter((x) => typeof x === "string" && /^[a-z0-9_-]{1,30}$/.test(x)).slice(0, MAX_LAYERS) : [];
  const kw = Array.isArray(w.kw) ? [...new Set(w.kw.map((x) => cleanText(x, 60)).filter(Boolean))].slice(0, MAX_WORDS) : [];
  const minSev = [1, 2, 3].includes(+w.minSev) ? +w.minSev : 1;
  return { watch: { id, name, cc: w.cc, area, layers, kw, minSev, topic } };
}
