// Shared by tools/build_transit_feeds.mjs and tools/refresh_transit.mjs (live public transport layer).
export const UA = "AXIOM-OSAP/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/; live public transport layer)";
// Entur (Norway) asks every caller to name itself; harmless elsewhere
export const HEADERS = { "User-Agent": UA, Accept: "application/x-protobuf, application/octet-stream, */*", "ET-Client-Name": "axiom-osap-transit" };

// GTFS route_type (basic and extended) -> the layer's kinds: b bus, t tram/light rail/cable, m metro, r rail, f ferry, o other
export const KINDS = { b: "Bus", t: "Tram and light rail", m: "Metro", r: "Train", f: "Ferry", o: "Other" };
export function kindOf(t) {
  if (!isFinite(t)) return "o";
  if (t === 3 || t === 11 || (t >= 200 && t < 300) || (t >= 700 && t < 900)) return "b";
  if (t === 0 || t === 5 || t === 6 || t === 7 || (t >= 900 && t < 1000) || (t >= 1300 && t < 1500)) return "t";
  if (t === 1 || t === 12 || (t >= 400 && t < 500)) return "m";
  if (t === 2 || (t >= 100 && t < 200)) return "r";
  if (t === 4 || t === 1000 || t === 1200) return "f";
  return "o";
}

// the catalog gives a licence page, not a name; name the common ones so the pop-up can say it plainly
const LIC = [[/creativecommons\.org\/publicdomain\/zero|cc0/i, "CC0 1.0"], [/creativecommons\.org\/licenses\/by\/4/i, "CC BY 4.0"],
  [/creativecommons\.org\/licenses\/by\/3/i, "CC BY 3.0"], [/creativecommons\.org\/licenses\/by-sa/i, "CC BY-SA"], [/creativecommons\.org\/licenses\/by-nc/i, "CC BY-NC (non-commercial)"],
  [/opendatacommons\.org\/licenses\/odbl|odbl/i, "ODbL 1.0"], [/etalab|licence-ouverte|open-licence/i, "Licence Ouverte (Etalab)"],
  [/nationalarchives\.gov\.uk\/doc\/open-government-licence|ogl/i, "Open Government Licence"], [/open\.canada\.ca|open-government-licence-canada/i, "Open Government Licence (Canada)"],
  [/data\.norge\.no\/nlod|nlod/i, "NLOD 2.0"], [/dl-de|govdata\.de/i, "Datenlizenz Deutschland"]];
export function licenceOf(u) {
  u = String(u || "");
  for (const [re, n] of LIC) if (re.test(u)) return n;
  return u ? "agency open data terms" : "agency open data terms (licence not stated in the catalog)";
}
export const isNc = (lic) => /non-commercial|-nc/i.test(lic);
