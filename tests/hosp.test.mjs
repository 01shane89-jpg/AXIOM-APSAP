// Rules of the hospital data layer (assets/hospital-sources/): the canonical facility record, capability statuses, source
// grading, SHA-256 fingerprints, the OpenStreetMap and researched-list providers, and that a failing provider is reported
// as a failure, never as "no hospitals". Also the identity resolver, evidence assessment (contradictions kept), the
// hospital-website evidence (tools/build_hospital_web.mjs and its provider) and how it folds into OSAP's list.
// Run from the repo root: node tests/hosp.test.mjs
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({}), head: { appendChild: () => {} } };
globalThis.OSAP_COUNTRY_FILES = { sof: ["th"] };
await import("../assets/hospital-sources/base-provider.js");
await import("../assets/hospital-sources/resolver.js");
await import("../assets/hospital-sources/sof-provider.js");
await import("../assets/hospital-sources/web-provider.js");
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
ok(osm && sof && H.providers("th").map((p) => p.id).join() === "sof,web,osm", "providers registered, highest authority first");
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

// ---------- evidence assessment ----------
const rep = (t) => ({ status: "reported", sources: [H.source(t, { url: "https://" + t + ".example/" })] }), no = (t) => ({ status: "not_available", sources: [H.source(t, { url: "https://no.example/" })] });
ok(H.assess([]).status === "unknown" && H.assess([]).value === null, "no evidence: unknown, no value");
ok(H.assess([rep("hospital_website")]).status === "reported" && H.assess([rep("hospital_website"), rep("openstreetmap")]).status === "reported", "a hospital's own claim, even with OSM agreeing, stays reported");
ok(H.assess([rep("government_registry")]).status === "confirmed", "an A-graded registry confirms");
const ct = H.assess([rep("hospital_website"), no("openstreetmap")]);
ok(ct.status === "contradicted" && ct.value === null && ct.sources.length === 2, "yes against no: contradicted, both sources kept, no value chosen");
ok(H.assess([no("openstreetmap")]).status === "not_available", "only a source saying no: not available");

// ---------- identity resolver ----------
const R = H.resolver;
ok(R.nameWords("โรงพยาบาลศิริราช").join() === "ศิริราช" && R.nameWords("Bangkok Hospital Pattaya").join() === "bangkok,pattaya", "generic words (hospital, โรงพยาบาล) are left out of names");
ok(R.domain("https://www.bumrungrad.com/en/x") === "bumrungrad.com" && R.domain("https://www.facebook.com/x") === "" && R.domain("https://moph.go.th/x") === "" && R.domain("https://cbh.moph.go.th/") === "cbh.moph.go.th", "website domains, shared hosts ignored");
const A = H.facility({ id: "TH-OSM-n1", name: "Siriraj Hospital", lat: 13.759, lon: 100.4855, ids: { osm: "n1" }, contact: { website: "https://www.si.mahidol.ac.th/" } });
ok(R.match(A, H.facility({ name: "X", lat: 14, lon: 101, ids: { osm: "n1" } })).level === "same", "the same OSM id is the same hospital wherever it is placed");
ok(R.match(A, H.facility({ name: "Other", lat: 13.77, lon: 100.49, contact: { website: "https://si.mahidol.ac.th/th/er" } })).level === "same", "the same website within 20 km is the same hospital");
ok(R.match(A, H.facility({ name: "โรงพยาบาลศิริราช", aliases: ["Siriraj"], lat: 13.765, lon: 100.49 })).level === "likely", "the same name (English with English) within 2.5 km is likely the same");
ok(R.match(H.facility({ name: "Khon Kaen Hospital", lat: 16.429, lon: 102.838 }), H.facility({ name: "Khon Kaen Ram Hospital", name_local: "โรงพยาบาลขอนแก่นราม", lat: 16.4336, lon: 102.8211 })).level === "none", "a name with a word more is a different hospital (Khon Kaen and Khon Kaen Ram)");
ok(R.match(H.facility({ name: "Bangkok Hospital", lat: 13.745, lon: 100.585 }), H.facility({ name: "Bangkok Christian Hospital", lat: 13.75, lon: 100.59 })).level !== "likely", "one shared city word is not a name match");
ok(R.match(H.facility({ name: "Bangkok Hospital", lat: 13.745, lon: 100.585, contact: { website: "https://www.bangkokhospital.com/en/bangkok" } }), H.facility({ name: "Phyathai 2", lat: 13.77, lon: 100.54, contact: { website: "https://www.bangkokhospital.com/x" } })).level === "none", "a group website shared by branches 5 km apart with different names is not a match");
ok(R.match(A, H.facility({ name: "Thonburi Clinic", lat: 13.7592, lon: 100.4856 })).level === "possible", "nearby with a different name is only possible");
ok(R.match(A, H.facility({ name: "Siriraj Piyamaharajkarun", lat: 13.9, lon: 100.6 })).level === "none", "same name word far away is not a match");
const L2 = R.resolve([fs, H.facility({ id: "TH-OSM-n5", name: "Siriraj Hospital", lat: 13.7595, lon: 100.486, ids: { osm: "n5" },
  capabilities: { "ed.24_7": { status: "not_available", value: false, sources: [H.source("openstreetmap", { excerpt: "emergency=no" })] } } }), H.facility({ id: "TH-OSM-n6", name: "Thonburi Clinic", lat: 13.7591, lon: 100.4856 })]);
ok(L2.length === 2 && L2[0].id === "TH-SOF-siriraj-hospital" && L2[0].ids.osm === "n5" && L2[0].merged.join() === "TH-SOF-siriraj-hospital,TH-OSM-n5", "resolve merges the same hospital, keeps the higher-authority id, leaves a merely nearby one apart");
ok(L2[0].capabilities["ed.24_7"].status === "contradicted" && L2[0].conflicts.some((c) => c.field === "capabilities.ed.24_7"), "a merged disagreement is a recorded conflict, not settled");
ok(fs.capabilities["ed.24_7"].status === "reported", "merging never changes the records it came from");

// ---------- hospital websites ----------
const { build } = await import("../tools/build_hospital_web.mjs");
const B = build({ cc: "th", at: "2026-10-03T07:48:05Z", sites: [
  { id: "osm:w42", name: "Test Hospital", lat: 13.7, lon: 100.5, web: "https://t.example/", hits: {
    "dx.ct": [{ url: "https://t.example/services/ct", title: "CT", quote: "CT scan 24 hours\u0007" }, { url: "https://t.example/news/new-ct", title: "News", quote: "We bought a CT scanner" }],
    "cc.icu": [{ url: "https://t.example/procurement", title: "x", quote: "ICU" }, { url: "https://t.example/icu", title: "ICU", quote: "Patients are referred to another ICU" }],
    "info.beds": [{ url: "https://t.example/about", title: "About", quote: "300 beds" }] } },
  { id: "osm:n7", name: "Empty", lat: 1, lon: 1, hits: { "dx.ct": [{ url: "https://e.example/news", quote: "x" }] } }] });
const bt = B.doc.facilities;
ok(bt.length === 1 && bt[0].osm === "w42" && Object.keys(bt[0].caps).join() === "dx.ct" && bt[0].caps["dx.ct"].length === 1, "news, procurement and referral quotes are dropped; a hospital with nothing left is left out");
ok(bt[0].caps["dx.ct"][0].excerpt === "CT scan 24 hours" && /^[0-9a-f]{64}$/.test(bt[0].caps["dx.ct"][0].sha256) && bt[0].beds_note.excerpt === "300 beds", "quotes are plain text with a SHA-256 each; beds kept as a note");
ok(B.doc.schema === "osap-hospital-web/1" && B.doc.source_type === "hospital_website", "website evidence file schema");
const web = H.provider("web"), wdoc = { schema: "osap-hospital-web/1", facilities: [
  { key: "sof:th:hospital:siriraj-hospital", sof: "sof:th:hospital:siriraj-hospital", name: "Siriraj Hospital", lat: 13.759, lon: 100.4855, website: "https://si.example/",
    caps: { "ed.24_7": [{ url: "https://si.example/er24", excerpt: "Emergency 24 hours", observed: "2026-10-03", sha256: "c".repeat(64) }], "dx.ct": [{ url: "https://si.example/ct", excerpt: "CT", observed: "2026-10-03", sha256: "d".repeat(64) }] } },
  { key: "osm:n9", osm: "n9", name: "Ramathibodi Hospital", name_local: "โรงพยาบาลรามาธิบดี", lat: 13.7665, lon: 100.5265, website: "https://rama.example/",
    caps: { "cc.icu": [{ url: "https://rama.example/icu", excerpt: "ICU", observed: "2026-10-03", sha256: "e".repeat(64) }] } },
  { key: "osm:n10", osm: "n10", name: "New Website Hospital", lat: 14.0, lon: 100.6, website: "https://new.example/",
    caps: { "spec.burn": [{ url: "https://new.example/burn", excerpt: "Burn unit", observed: "2026-10-03", sha256: "f".repeat(64) }] } }] };
const list = [{ id: "sof:th:hospital:siriraj-hospital", name: "Siriraj Hospital", lat: 13.759, lon: 100.4855, src: "https://en.wikipedia.org/wiki/Siriraj_Hospital", srcname: "English Wikipedia",
    caps: { "ed.24_7": { src: "https://si.example/title", srcname: "Siriraj Hospital website", quote: "ER", quote_basis: "official page title", asof: "2026-10-03" },
      "dx.ct": { src: "https://si.example/ct-old", srcname: "Siriraj Hospital website", quote: "CT", quote_basis: "page text", asof: "2026-10-01" } } },
  { id: "sof:th:hospital:ramathibodi", name: "Ramathibodi Hospital", lat: 13.766, lon: 100.526, src: "https://en.wikipedia.org/wiki/Ramathibodi_Hospital", srcname: "English Wikipedia" }];
const F2 = web.fold(list, wdoc, "th");
ok(F2.length === 3 && F2[2].id === "web:th:osm:n10" && F2[2].web_only && F2[2].caps["spec.burn"].quote_basis === "hospital website text (automatic match)" && F2[2].caps["spec.burn"].sha256 === "f".repeat(64), "a hospital the list lacks is added from its website, quote and SHA-256 kept");
ok(F2[0].caps["ed.24_7"].src === "https://si.example/er24" && F2[0].caps["dx.ct"].src === "https://si.example/ct-old", "a page-text quote replaces a page title, never another documented quote");
ok(F2[1].caps && F2[1].caps["cc.icu"].srcname === "Ramathibodi Hospital website" && /same name/.test(F2[1].web_match), "website evidence joins the list record the resolver finds to be the same hospital");
ok(list[0].caps["ed.24_7"].quote_basis === "official page title" && !list[1].caps, "the list itself is never changed");
ok(web.fold(list, null, "th").length === 2, "no website file: the list as it was");
const wf = web.toFacility(wdoc.facilities[1], "th");
ok(wf.capabilities["cc.icu"].status === "reported" && wf.capabilities["cc.icu"].sources[0].reliability === "B" && wf.capabilities["cc.icu"].sources[0].sha256 === "e".repeat(64) && wf.ids.osm === "n9", "website evidence as a canonical record: reported, B-graded, fingerprint kept");

// ---------- discovery ----------
H.register({ id: "broken", tier: 0, countries: ["zz"], discoverFacilities: () => Promise.reject(new Error("registry offline")) });
H.register({ id: "fixed", tier: 1, countries: ["zz"], discoverFacilities: () => ({ facilities: [fo], at: "2026-10-01" }) });
const r = await H.discover({ cc: "zz", lat: 13.7, lon: 100.5, radius_m: 1000 });
const ob = r.outcome.find((x) => x.provider === "broken"), of = r.outcome.find((x) => x.provider === "fixed");
ok(ob && !ob.ok && /registry offline/.test(ob.err) && of && of.ok && of.n === 1 && r.facilities.length === 1, "a failing provider is reported as failed; the others still answer");

console.log(fails ? fails + " FAILED" : "all hospital data layer checks passed");
process.exit(fails ? 1 : 0);
