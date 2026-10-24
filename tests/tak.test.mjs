// Unit test for assets/osap-tak.js (TAK data package for ATAK and WinTAK), no network, no browser.
// Checks: the manifest lists every entry; map points become CoT markers (spot map in the placemark's colour, or a unit
// marker typed from a 2525D SIDC) with name, remarks and <archive/>; lines and areas stay in the KML overlay and the points
// leave it; uids are stable across exports; XML in names and descriptions stays escaped; points past the cap stay in the KML;
// entity-declaring KML is refused.
// Usage: node tests/tak.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("../assets/osap-tak.js", import.meta.url), "utf8"), ctx);
const T = ctx.window.OSAP_TAK;

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Test</name>
<Style id="r"><IconStyle><color>ff0000ff</color></IconStyle><LineStyle><color>ffd67e1c</color></LineStyle></Style>
<Folder><name>Points</name>
<Placemark><name>Bridge &amp; ford &lt;east&gt;</name><description>Source: https://example.org/a?b=1&amp;c=2
SHA-256: abc123</description><Style><IconStyle><color>ff2a2ac9</color></IconStyle></Style><Point><coordinates>100.5,13.75,0</coordinates></Point></Placemark>
<Placemark><name>Shared style</name><styleUrl>#r</styleUrl><Point><coordinates>101,14</coordinates></Point></Placemark>
<Placemark><name>Hostile unit</name><ExtendedData><Data name="sidc"><value>10061000001211000000</value></Data></ExtendedData><Point><coordinates>102,15,0</coordinates></Point></Placemark>
</Folder>
<Folder><name>Lines</name><Placemark><name>Route</name><LineString><coordinates>100,13 101,14</coordinates></LineString></Placemark></Folder>
</Document></kml>`;

const r = T.files({ id: "t1", name: "Test <pkg>", kml: KML, now: Date.UTC(2026, 9, 24, 9) });
const by = Object.fromEntries(r.files.map((f) => [f.name, f.data]));
assert.equal(r.files[0].name, "MANIFEST/manifest.xml", "manifest first");
assert.equal(r.markers, 3); assert.equal(r.kmlPoints, 0); assert.ok(r.shapes);
const man = by["MANIFEST/manifest.xml"];
assert.match(man, /<MissionPackageManifest version="2">/);
assert.match(man, /<Parameter name="name" value="Test &lt;pkg&gt;"\/>/, "package name escaped");
for (const f of r.files.slice(1)) assert.ok(man.includes(`zipEntry="${f.name}"`), "manifest lists " + f.name);
assert.equal((man.match(/<Content /g) || []).length, r.files.length - 1);

const cots = r.files.filter((f) => f.name.endsWith(".cot"));
assert.equal(cots.length, 3);
for (const c of cots) {
  const uid = /uid="([^"]+)"/.exec(c.data)[1];
  assert.equal(c.name, `${uid}/${uid}.cot`, "cot path is uid/uid.cot");
  assert.match(c.data, /<archive\/>/); assert.match(c.data, /<event version="2.0" /);
  assert.match(c.data, /stale="2027-10-24T09:00:00.000Z"/, "stale a year on");
}
const bridge = cots.find((c) => c.data.includes("Bridge"));
assert.match(bridge.data, /type="b-m-p-s-m"/);
assert.match(bridge.data, /callsign="Bridge &amp; ford &lt;east&gt;"/, "name escaped once, not twice");
assert.match(bridge.data, /<remarks>Source: https:\/\/example.org\/a\?b=1&amp;c=2\nSHA-256: abc123<\/remarks>/);
assert.match(bridge.data, /lat="13.7500000" lon="100.5000000" hae="9999999.0"/);
// KML ff2a2ac9 (aabbggrr) = ARGB ffc92a2a
assert.match(bridge.data, new RegExp(`<color argb="${0xffc92a2a | 0}"/>`));
assert.match(cots.find((c) => c.data.includes("Shared style")).data, new RegExp(`argb="${0xffff0000 | 0}"`), "colour from a shared style");
const unit = cots.find((c) => c.data.includes("Hostile unit")).data;
assert.match(unit, /type="a-h-G"/); assert.doesNotMatch(unit, /usericon/);

const kml = r.files.find((f) => f.name.endsWith(".kml")).data;
assert.match(kml, /<LineString>/); assert.doesNotMatch(kml, /<Point>/, "points leave the KML");
assert.doesNotMatch(kml, /<name>Points<\/name>/, "the emptied folder goes");

// stable uids: the same package again gives the same marker and package uids
const r2 = T.files({ id: "t1", name: "Test <pkg>", kml: KML });
assert.deepEqual(r2.files.filter((f) => f.name.endsWith(".cot")).map((f) => f.name).sort(), cots.map((f) => f.name).sort());
assert.equal(r2.uid, r.uid);
assert.notEqual(T.files({ id: "t2", name: "x", kml: KML }).uid, r.uid);

// SIDC to CoT type
assert.equal(T.sidcType("10031000001211000000"), "a-f-G");
assert.equal(T.sidcType("10040100001101000000"), "a-n-A");
assert.equal(T.sidcType("10013000001201000000"), "a-u-S");
assert.equal(T.sidcType("bad"), "");

// over the cap: the rest stay in the KML as points
const many = "<kml><Document>" + Array.from({ length: T.MAX_COT + 5 }, (_, i) => `<Placemark><name>p${i}</name><Point><coordinates>${(i % 300) / 10},${(i % 80) / 10}</coordinates></Point></Placemark>`).join("") + "</Document></kml>";
const rm = T.files({ id: "m", name: "many", kml: many });
assert.equal(rm.markers, T.MAX_COT); assert.equal(rm.kmlPoints, 5); assert.ok(rm.shapes);
assert.equal(new Set(rm.files.map((f) => f.name)).size, rm.files.length, "unique entry names");

// nothing with a location: no KML entry, no markers
const empty = T.files({ name: "e", kml: "<kml><Document><name>e</name></Document></kml>" });
assert.equal(empty.files.length, 1); assert.equal(empty.markers, 0); assert.equal(empty.shapes, false);

assert.throws(() => T.files({ name: "x", kml: '<!DOCTYPE kml [<!ENTITY a "b">]><kml/>' }), /entities/);
console.log("tak.test.mjs: all checks passed");
