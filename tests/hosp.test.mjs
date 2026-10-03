// Rules of the hospital data layer (assets/hospital-sources/): the canonical facility record, capability statuses, source
// grading, SHA-256 fingerprints, the OpenStreetMap and researched-list providers, and that a failing provider is reported
// as a failure, never as "no hospitals".
// Run from the repo root: node tests/hosp.test.mjs
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({}), head: { appendChild: () => {} } };
globalThis.OSAP_COUNTRY_FILES = { sof: ["th"] };
await import("../assets/hospital-sources/base-provider.js");
await import("../assets/hospital-sources/sof-provider.js");
await import("../assets/hospital-sources/osm-provider.js");
const H = globalThis.OSAP_HOSP;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// ---------- canonical record ----------
const f0 = H.facility({ id: "TH-OSM-n1", name: "X", contact: { phone: "+66 2 000 0000" } });
ok(f0.schema === "osap-facility/1" && f0.contact.phone && f0.contact.website === "" && Array.isArray(f0.sources) && f0.beds === null && f0.ids.osm === "", "every field present, nested defaults kept");
ok(H.getCap(f0, "dx.ct").status === "unknown" && H.getCap(f0, "dx.ct").value === null, "a capability nobody states is unknown with no value, never false");
let threw = false; try { H.capability("yes", null); } catch { threw = true; }
ok(threw, "a status outside the list is refused");
ok(H.capability("not_available", null).value === false && H.capability("reported", null).value === true, "not_available only when asked for");

// ---------- grading ----------
const g = (t) => { const s = H.source(t, {}); return s.reliability + s.credibility; };
ok(g("government_registry") === "A2" && g("hospital_website") === "B3" && g("openstreetmap") === "C3" && g("wikipedia") === "C4" && g("nonsense") === "F6", "Admiralty grading by source type");
ok(H.source("hospital_website", { url: "javascript:alert(1)" }).url === "", "only http(s) links kept");
ok(H.source("hospital_website", { excerpt: "x".repeat(900) }).excerpt.length === 300, "excerpts clipped");

// ---------- fingerprint ----------
const s1 = H.source("hospital_website", { url: "https://a.example/", excerpt: "24-hour emergency" });
const s2 = Object.assign({}, s1);
const [h1, h2] = [await H.fingerprint(s1), await H.fingerprint(s2)];
ok(/^[0-9a-f]{64}$/.test(h1) && h1 === h2 && s1.sha256 === h1, "SHA-256 of the canonical source entry, stable");
const s3 = Object.assign({}, s1, { excerpt: "24-hour emergency department", sha256: "" });
ok((await H.fingerprint(s3)) !== h1, "a changed excerpt changes the fingerprint");

// ---------- OpenStreetMap provider ----------
const osm = H.provider("osm"), sof = H.provider("sof");
ok(osm && sof && H.providers("th").map((p) => p.id).join() === "sof,osm", "providers registered, highest authority first");
const fo = osm.toFacility({ type: "way", id: 42, lat: 13.7, lon: 100.5, tags: { amenity: "hospital", name: "โรงพยาบาลทดสอบ", "name:en": "Test Hospital", emergency: "yes", beds: "250",
  "healthcare:speciality": "general_surgery;neurosurgery;icu", website: "https://t.example/", wikidata: "Q1", "addr:province": "Bangkok" } }, "th", "2026-09-30T06:00:00Z");
ok(fo.id === "TH-OSM-w42" && fo.name === "Test Hospital" && fo.name_local === "โรงพยาบาลทดสอบ" && fo.country_code === "TH" && fo.admin1 === "Bangkok", "stable OSM id, English and local names");
ok(fo.capabilities["ed.basic"].status === "reported" && fo.capabilities["surg.neuro"].status === "reported" && fo.capabilities["cc.icu"].status === "reported", "OSM tags give reported capabilities");
ok(!Object.values(fo.capabilities).some((c) => c.status === "confirmed"), "OpenStreetMap never confirms");
ok(fo.capabilities["surg.neuro"].sources[0].reliability === "C" && /speciality=neurosurgery/.test(fo.capabilities["surg.neuro"].sources[0].excerpt), "each capability carries its graded OSM source and the tag");
ok(fo.beds.value === 250 && fo.ids.wikidata === "Q1" && fo.contact.website === "https://t.example/", "beds, Wikidata id and website kept");
ok(H.getCap(fo, "dx.ct").status === "unknown", "CT not tagged stays unknown");
const fn = osm.toFacility({ type: "node", id: 7, lat: 1, lon: 1, tags: { amenity: "hospital", name: "N", emergency: "no" } }, "th", "");
ok(fn.capabilities["ed.basic"].status === "not_available", "emergency=no is a source saying no");
ok(osm.toFacility({ type: "node", id: 8, lat: 1, lon: 1, tags: { aeroway: "helipad" } }, "th", "") === null, "landing sites are not facilities");
ok(osm.tileKeys([13.75, 100.5], 50000).join() === "12_100,14_100" && osm.tileKeys([0.5, 179.5], 100000).includes("0_-180"), "tile keys cover the reach, across the date line");

// ---------- researched list provider ----------
const fs = sof.toFacility({ id: "sof:th:hospital:siriraj-hospital", name: "Siriraj Hospital", lat: 13.759, lon: 100.4855, type: "public", src: "https://en.wikipedia.org/wiki/Siriraj_Hospital", srcname: "English Wikipedia",
  trauma_level: null, caps: { "ed.24_7": { src: "https://www.si.mahidol.ac.th/er", srcname: "Siriraj Hospital website", quote: "ห้องฉุกเฉิน 24 ชั่วโมง", quote_basis: "official page title", asof: "2026-10-03" },
    "bogus.flag": { src: "https://x.example/" } } }, "th", "2026-09-26");
ok(fs.id === "TH-SOF-siriraj-hospital" && fs.ids.sof === "sof:th:hospital:siriraj-hospital", "stable researched-list id");
ok(fs.sources[0].source_type === "wikipedia" && fs.sources[0].reliability === "C", "Wikipedia record source graded as Wikipedia");
const e = fs.capabilities["ed.24_7"];
ok(e.status === "reported" && e.sources[0].source_type === "hospital_website" && e.sources[0].reliability === "B" && e.sources[0].excerpt === "ห้องฉุกเฉิน 24 ชั่วโมง", "a hospital-website quote is reported, graded B, quote kept");
ok(fs.capabilities["ed.basic"].status === "reported" && !fs.capabilities["bogus.flag"], "24-hour ED implies an ED; unknown codes dropped");
ok(fs.official_designation === "", "no designation unless a source states one");
ok(sof.typeOf("https://www.openstreetmap.org/node/1", "") === "openstreetmap" && sof.typeOf("https://moph.go.th/x", "Ministry of Public Health") === "institutional", "page kind decides the source type");

// ---------- discovery ----------
H.register({ id: "broken", tier: 0, countries: ["zz"], discoverFacilities: () => Promise.reject(new Error("registry offline")) });
H.register({ id: "fixed", tier: 1, countries: ["zz"], discoverFacilities: () => ({ facilities: [fo], at: "2026-10-01" }) });
const r = await H.discover({ cc: "zz", lat: 13.7, lon: 100.5, radius_m: 1000 });
const ob = r.outcome.find((x) => x.provider === "broken"), of = r.outcome.find((x) => x.provider === "fixed");
ok(ob && !ob.ok && /registry offline/.test(ob.err) && of && of.ok && of.n === 1 && r.facilities.length === 1, "a failing provider is reported as failed; the others still answer");

console.log(fails ? fails + " FAILED" : "all hospital data layer checks passed");
process.exit(fails ? 1 : 0);
