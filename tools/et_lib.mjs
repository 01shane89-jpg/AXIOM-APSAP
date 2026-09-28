// Helpers for the ET tab's job (tools/refresh_et.mjs), kept apart so tests/et.test.mjs can check them without the network.
import { COUNTRIES, ccsInText } from "./geo_cc.mjs";

// numeric and common named HTML entities that some feeds leave in their titles (&#243; -> ó)
export const unent = (s) => String(s || "").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&rsquo;|&lsquo;/g, "'").replace(/&quot;/g, '"').replace(/&ldquo;|&rdquo;/g, '"').replace(/&hellip;/g, "…");

// AARO's case releases name the area in the title ("DOW-UAP-PR144, Unresolved UAP Report, Yellow Sea, 2023"): a sea or
// region from this table (rough centre), else a country (centre of its box) or a U.S. state or town from the gazetteer.
export const AREAS = { "yellow sea": [35.5, 123.5, "cn"], "east china sea": [29.5, 125.5, ""], "south china sea": [13.5, 114, ""], "sea of japan": [40, 135, ""],
  "philippine sea": [20, 130, ""], "persian gulf": [27, 51, ""], "arabian gulf": [27, 51, ""], "gulf of oman": [24.5, 58.5, ""], "arabian sea": [16, 64, ""],
  "red sea": [20, 38.5, ""], "gulf of aden": [12.5, 48, ""], "strait of hormuz": [26.5, 56.3, ""], "mediterranean sea": [35, 18, ""], "eastern mediterranean": [34, 31, ""],
  "black sea": [43.4, 34, ""], "baltic sea": [57, 19, ""], "north sea": [56, 3, ""], "gulf of mexico": [25, -90, ""], "caribbean sea": [15, -75, ""],
  "atlantic ocean": [30, -45, ""], "pacific ocean": [15, -160, ""], "indian ocean": [-10, 75, ""], "middle east": [29, 45, ""], "horn of africa": [8, 45, ""] };
const BOX = Object.fromEntries(COUNTRIES.map((c) => [c.id, c.bounds]));
export function areaOf(title, gz, placeIn) {
  const m = String(title).match(/UAP Report,\s*(.+?),\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{4}/i);
  if (!m) return null;
  const place = m[1].trim(), a = AREAS[place.toLowerCase()];
  if (a) return { name: place, lat: a[0], lon: a[1], prec: "area", basis: "rough centre of the area named in the release title", cc: a[2] ? [a[2]] : [] };
  const ccs = ccsInText(place);
  if (ccs.length === 1 && BOX[ccs[0]]) { const b = BOX[ccs[0]]; return { name: place, lat: +((b[0][0] + b[1][0]) / 2).toFixed(2), lon: +((b[0][1] + b[1][1]) / 2).toFixed(2), prec: "country", basis: "centre of the country named in the release title", cc: ccs }; }
  const p = gz && placeIn ? placeIn(gz, place, ["us"]) : null;
  return p ? { name: place, lat: p.lat, lon: p.lon, prec: p.prec, basis: p.basis + " (release title)", cc: ["us"] } : null;
}
