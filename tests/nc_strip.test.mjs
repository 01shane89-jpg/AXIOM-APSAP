// The sold-version switch (tools/nc_strip.mjs): every non-commercial record goes, everything else stays, and files keep their shape.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stripText, parseData, sweep } from "../tools/nc_strip.mjs";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok " + name); };

ok("news items tagged nc go, the rest stay (window.X= file)", () => {
  const t = 'window.ASAP_NEWS={"asof":"x","items":[{"title":"a","nc":true},{"title":"b"},{"title":"c","nc":false}]};';
  const r = stripText(t);
  assert.equal(r.removed, 1);
  const v = parseData(r.text).value;
  assert.deepEqual(v.items.map((i) => i.title), ["b", "c"]);
  assert.ok(r.text.startsWith("window.ASAP_NEWS={"));
});

ok("keyed and bracketed per-country files keep their wrapper", () => {
  const a = 'window.OSAP_XC=window.OSAP_XC||{};window.OSAP_XC["th"]={"items":[{"f":"tt-rand","t":"x"},{"f":"gdacs","t":"y"}]};';
  const r = stripText(a, new Set(["tt-rand"]));
  assert.equal(r.removed, 1);
  assert.ok(r.text.startsWith('window.OSAP_XC=window.OSAP_XC||{};window.OSAP_XC["th"]='));
  const b = '(window.OSAP_CF=window.OSAP_CF||{})["car"]={"sources":[{"id":"bing-en-0","nc":true}],"items":[{"feed":"bing-en-0"},{"feed":"acled"}]};';
  const s = stripText(b);
  assert.equal(s.removed, 2, "the nc source and the item that names it");
  assert.ok(s.text.startsWith('(window.OSAP_CF=window.OSAP_CF||{})["car"]='));
  assert.deepEqual(parseData(s.text).value.items, [{ feed: "acled" }]);
});

ok("a source note keyed in a map takes the items that name it (cable points name their source in s)", () => {
  const r = stripText('{"sources":{"tg":{"lic":"CC BY-NC-SA 3.0","nc":true},"osm":{"nc":false}},"items":[{"s":"tg"},{"s":"osm"}]}');
  const v = JSON.parse(r.text);
  assert.deepEqual(Object.keys(v.sources), ["osm"]);
  assert.deepEqual(v.items, [{ s: "osm" }]);
});

ok("a file from an nc source, or itself nc, is dropped whole", () => {
  assert.equal(stripText('{"cc":"ad","source":{"name":"SIPRI","nc":true},"imp":{"deals":[1]}}').drop, true);
  assert.equal(stripText('{"v":1,"source":"Ookla","nc":true,"bands":[]}').drop, true);
  assert.equal(stripText('{"cc":"ad","source":{"name":"Wikidata","nc":false}}').drop, false);
});

ok("non-data text is left alone", () => {
  assert.equal(stripText("console.log(1)"), null);
  const t = 'window.A={"x":1};';
  assert.equal(stripText(t).text, t, "nothing to strip: byte for byte the same");
});

ok("a sweep takes feeds from the registry into other files, drops nc folders, and --check passes after", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ncs-"));
  const w = (p, t) => { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), t); };
  w("live/x/feeds.js", 'window.OSAP_XF={"feeds":{"pdc":{"id":"pdc","nc":true},"usgs":{"id":"usgs","nc":false}}};');
  w("live/x/th.js", 'window.OSAP_XC=window.OSAP_XC||{};window.OSAP_XC["th"]={"items":[{"f":"pdc"},{"f":"usgs"}]};');
  w("live/milref/sipri/ad.json", '{"source":{"nc":true},"imp":{}}');
  w("live/milref/ad.json", '{"sources":{"wd":{"nc":false}},"fig":{}}');
  w("comms/cov/index.json", '{"v":1,"nc":true}');
  w("comms/cov/0001.json", "[[1,2]]");
  w("comms/networks.json", '{"n":1}');
  const tool = path.resolve("tools/nc_strip.mjs");
  assert.throws(() => execFileSync("node", [tool, "--check", d], { stdio: "pipe" }), "check fails while nc records are there");
  const r = sweep([d]);
  assert.equal(r.left.length, 0);
  assert.deepEqual(parseData(fs.readFileSync(path.join(d, "live/x/th.js"), "utf8")).value.items, [{ f: "usgs" }]);
  assert.equal(fs.existsSync(path.join(d, "live/milref/sipri/ad.json")), false);
  assert.equal(fs.existsSync(path.join(d, "live/milref/ad.json")), true);
  assert.equal(fs.existsSync(path.join(d, "comms/cov")), false, "the Ookla folder goes with its index");
  assert.equal(fs.existsSync(path.join(d, "comms/networks.json")), true);
  execFileSync("node", [tool, "--check", d], { stdio: "pipe" });
  fs.rmSync(d, { recursive: true, force: true });
});

ok("switch off by default: the jobs ask every source", () => {
  const out = execFileSync("node", ["-e", 'import("./tools/gnss.mjs").then(m=>console.log(m.SOURCES.length))'], { env: { ...process.env, OSAP_COMMERCIAL: "" } }).toString().trim();
  assert.equal(out, "2");
  const sold = execFileSync("node", ["-e", 'import("./tools/gnss.mjs").then(m=>console.log(m.SOURCES.map(s=>s.name).join()))'], { env: { ...process.env, OSAP_COMMERCIAL: "true" } }).toString().trim();
  assert.equal(sold, "adsb.lol");
});

console.log(n + " nc_strip tests passed");
