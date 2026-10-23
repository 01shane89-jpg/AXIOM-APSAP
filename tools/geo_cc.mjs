// Country lookup shared by the dense-source fetchers: every country the page offers (the 28 researched areas in index.html
// plus data/basemap/world-countries.js), point-in-country from the page's own outlines, and country names or ISO codes to ids.
import fs from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
for (const f of ["country-outlines.js", "world-outlines.js", "world-countries.js"]) vm.runInNewContext(fs.readFileSync("data/basemap/" + f, "utf8"), ctx);
const W = ctx.window;
const page = fs.readFileSync("index.html", "utf8");
const A3 = { th: "THA", vn: "VNM", kh: "KHM", la: "LAO", mm: "MMR", ph: "PHL", my: "MYS", sg: "SGP", id: "IDN", bn: "BRN", tl: "TLS", cn: "CHN", tw: "TWN", kp: "PRK",
  kr: "KOR", jp: "JPN", oki: "JPN", mn: "MNG", au: "AUS", nz: "NZL", pg: "PNG", in: "IND", pk: "PAK", np: "NPL", bt: "BTN", bd: "BGD", lk: "LKA", mv: "MDV" };
export const COUNTRIES = [
  ...[...page.matchAll(/\{ id: "([a-z]+)", name: "([^"]+)", region: "[^"]+", ne: "([^"]+)", bounds: (\[\[[^\]]+\], \[[^\]]+\]\]) \}/g)]
    .map((m) => ({ id: m[1], name: m[2], ne: m[3], bounds: JSON.parse(m[4]), a2: m[1] === "oki" ? "JP" : m[1].toUpperCase(), a3: A3[m[1]] })),
  ...(W.ASAP_WORLD || []).map((c) => ({ id: c.id, name: c.name, ne: c.ne, bounds: c.bounds, a2: c.id.toUpperCase(), a3: c.a3 })),
];
if (COUNTRIES.length < 150) throw new Error("country list incomplete: " + COUNTRIES.length);
const BY_NE = {};
for (const f of [...W.COUNTRY_BASE.features, ...W.WORLD_BASE.features]) (BY_NE[f.properties.n] = BY_NE[f.properties.n] || []).push(f.geometry);
const polys = COUNTRIES.filter((c) => c.id !== "oki").map((c) => ({ c, geoms: BY_NE[c.ne] || [] }));

function inRing(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function inGeom(x, y, g) {
  const ps = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return ps.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
}
const inBox = (lat, lon, b, pad) => lat >= b[0][0] - pad && lat <= b[1][0] + pad && lon >= b[0][1] - pad && lon <= b[1][1] + pad;
const OKI = COUNTRIES.find((c) => c.id === "oki");

// Country ids for a point: the country whose outline holds it; at sea, every country whose bounds lie within `pad` degrees.
export function ccsAt(lat, lon, pad = 0.5) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return [];
  const out = [];
  for (const { c, geoms } of polys) if (inBox(lat, lon, c.bounds, 0.05) && geoms.some((g) => inGeom(lon, lat, g))) { out.push(c.id); break; }
  if (!out.length && pad > 0) {
    // offshore or on an island too small for the outlines: the countries whose outline comes within `pad` degrees, nearest first
    const near = [];
    for (const { c, geoms } of polys) {
      if (!inBox(lat, lon, c.bounds, pad)) continue;
      let d = Infinity;
      for (const g of geoms) for (const p of g.type === "Polygon" ? [g.coordinates] : g.coordinates) for (const [x, y] of p[0]) {
        const dd = Math.hypot((x - lon) * Math.cos((lat * Math.PI) / 180), y - lat); if (dd < d) d = dd;
      }
      if (d <= pad) near.push([d, c.id]);
    }
    near.sort((a, b) => a[0] - b[0]).forEach(([, id]) => out.push(id));
  }
  if (OKI && inBox(lat, lon, OKI.bounds, 0.3) && !out.includes("oki")) { if (!out.includes("jp")) out.unshift("jp"); out.push("oki"); }
  return out.slice(0, 4);
}

// Names that sources use for a country, beyond the page's own name and Natural Earth name.
const ALIASES = { mm: ["Burma"], vn: ["Viet Nam"], la: ["Lao PDR", "Lao People's Democratic Republic"], kp: ["Korea, North", "Democratic People's Republic of Korea", "DPRK",
  "Korea, Democratic People's Republic of", "Korea (Democratic People's Republic of)"], kr: ["Korea, South", "Republic of Korea", "Korea, Republic of", "Korea (Republic of)"],
  cn: ["People's Republic of China", "Hong Kong", "Macau", "Macao"], tl: ["East Timor"], bn: ["Brunei Darussalam"], us: ["United States of America", "USA", "U.S."],
  gb: ["United Kingdom", "UK", "Britain", "Great Britain"], ru: ["Russian Federation"], ir: ["Iran, Islamic Republic of", "Islamic Republic of Iran"], sy: ["Syrian Arab Republic"],
  cd: ["Democratic Republic of the Congo", "DR Congo", "DRC", "Congo, Democratic Republic of the", "Congo (Kinshasa)"], cg: ["Republic of the Congo", "Congo (Brazzaville)", "Congo, Republic of the"],
  ci: ["Cote d'Ivoire", "Côte d'Ivoire", "Ivory Coast"], cz: ["Czechia", "Czech Republic"], tr: ["Türkiye", "Turkiye", "Turkey"], ps: ["Palestine", "West Bank", "Gaza", "State of Palestine", "occupied Palestinian territory"],
  mk: ["North Macedonia", "Macedonia"], md: ["Moldova, Republic of", "Republic of Moldova"], tz: ["Tanzania, United Republic of", "United Republic of Tanzania"], bo: ["Bolivia (Plurinational State of)"],
  ve: ["Venezuela (Bolivarian Republic of)"], sz: ["Eswatini", "Swaziland"], cv: ["Cabo Verde", "Cape Verde"], fm: ["Micronesia, Federated States of", "Micronesia (Federated States of)"],
  va: ["Holy See", "Vatican"], eh: ["Western Sahara"], xk: ["Kosovo"], la2: [] };
const NAME_IDS = {};
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
for (const c of COUNTRIES) if (c.id !== "oki") for (const n of [c.name, c.ne, ...(ALIASES[c.id] || [])]) NAME_IDS[norm(n)] = c.id;
const BY_A2 = Object.fromEntries(COUNTRIES.filter((c) => c.id !== "oki").map((c) => [c.a2, c.id]));
const BY_A3 = Object.fromEntries(COUNTRIES.filter((c) => c.id !== "oki" && c.a3).map((c) => [c.a3, c.id]));
BY_A2.UK = "gb"; BY_A2.XK = BY_A2.XK || "xk";
export const ccFromName = (n) => NAME_IDS[norm(n)] || null;
export const ccFromA2 = (a) => (a ? BY_A2[String(a).toUpperCase()] || null : null);
export const ccFromA3 = (a) => (a ? BY_A3[String(a).toUpperCase()] || null : null);
export const withOki = (ccs) => (ccs.includes("jp") && !ccs.includes("oki") ? [...ccs, "oki"] : ccs);

// French and Spanish names, read only when a caller asks (regional outlets writing in those languages); kept apart so the
// English-language readers match exactly as before. Names that are also common words or people's names (Maurice, Granada) are left out.
const OTHER_LANG = { dz: ["Algérie"], cm: ["Cameroun"], td: ["Tchad"], gn: ["Guinée", "Guinée-Conakry"], gq: ["Guinée équatoriale", "Guinea Ecuatorial"],
  gw: ["Guinée-Bissau"], mr: ["Mauritanie"], ma: ["Maroc", "Marruecos"], ly: ["Libye"], eg: ["Égypte", "Egipto"], sd: ["Soudan"], ss: ["Soudan du Sud"],
  et: ["Éthiopie"], so: ["Somalie"], ug: ["Ouganda"], tz: ["Tanzanie"], ke: ["Kenya"], zm: ["Zambie"], na: ["Namibie"], za: ["Afrique du Sud", "Sudáfrica"],
  cf: ["Centrafrique", "République centrafricaine"], km: ["Comores"], gm: ["Gambie"], cv: ["Cap-Vert"], lb: ["Liban", "Líbano"], sy: ["Syrie", "Siria"],
  iq: ["Irak"], ye: ["Yémen"], jo: ["Jordanie"], sa: ["Arabie saoudite", "Arabia Saudita"], tn: ["Tunisie", "Túnez"], sn: ["Sénégal"], ne: ["Niger"],
  bj: ["Bénin"], bf: ["Burkina"], tg: ["Togo"], ga: ["Gabon"], mg: ["Madagascar"], mz: ["Mozambique"], zw: ["Zimbabwe"], rw: ["Rwanda"], bi: ["Burundi"],
  dj: ["Djibouti"], er: ["Érythrée"], ml: ["Mali"], ci: ["Côte d'Ivoire"], gh: ["Ghana"], ng: ["Nigeria"], ao: ["Angola"], sc: ["Seychelles"],
  cd: ["RDC", "RD Congo", "République démocratique du Congo", "Congo-Kinshasa", "Kinshasa"], cg: ["Congo-Brazzaville", "Brazzaville"],
  il: ["Israël"], ps: ["Palestina", "Cisjordanie", "Cisjordania"], ir: ["Irán"], af: ["Afghanistan", "Afganistán"], ru: ["Russie", "Rusia"], ua: ["Ukraine", "Ucrania"],
  br: ["Brasil", "Brésil"], bz: ["Belice"], do: ["República Dominicana", "République dominicaine"], ht: ["Haïti", "Haití"], mx: ["México", "Mexique"],
  pe: ["Perú", "Pérou"], co: ["Colombie"], ve: ["Venezuela"], ar: ["Argentine"], cl: ["Chili"], bo: ["Bolivie"], ec: ["Équateur"], uy: ["Uruguay"], py: ["Paraguay"],
  pa: ["Panamá"], cr: ["Costa Rica"], ni: ["Nicaragua"], hn: ["Honduras"], sv: ["El Salvador"], gt: ["Guatemala"], cu: ["Cuba"], sr: ["Surinam"],
  tt: ["Trinidad y Tobago"], eh: ["Sahara occidental", "Sáhara Occidental"], us: ["Estados Unidos", "États-Unis"], cn: ["Chine"], fr: ["Francia"], es: ["Espagne", "España"] };
const OTHER_IDS = { ...NAME_IDS };
for (const [id, names] of Object.entries(OTHER_LANG)) for (const n of names) OTHER_IDS[norm(n)] = id;

// Country ids named in free text (whole names only; longest names first so "South Sudan" wins over "Sudan").
// otherLangs: also read the French and Spanish names above.
const byLength = (ids) => Object.keys(ids).filter((n) => n.length > 3 || /^(uk|usa|drc|rdc)$/.test(n)).sort((a, b) => b.length - a.length);
const NAME_LIST = byLength(NAME_IDS), OTHER_LIST = byLength(OTHER_IDS);
export function ccsInText(text, otherLangs = false) {
  const [list, ids] = otherLangs ? [OTHER_LIST, OTHER_IDS] : [NAME_LIST, NAME_IDS];
  let t = " " + norm(text) + " ";
  const out = [];
  for (const n of list) if (t.includes(" " + n + " ")) { const id = ids[n]; if (!out.includes(id)) out.push(id); t = t.split(" " + n + " ").join("  "); }
  return out;
}

// The outline geometries of one country (the page's own outlines), e.g. to draw an airspace bulletin that names a whole country.
export function outlineOf(cc) { const p = polys.find((x) => x.c.id === cc); return p ? p.geoms : []; }
