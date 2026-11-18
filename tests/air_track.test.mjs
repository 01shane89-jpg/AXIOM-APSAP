// Unit test for the aircraft path relay (netlify/edge-functions/osap-air-track.js), no network: fetch and Netlify.env are stubbed.
// Usage: node tests/air_track.test.mjs
import assert from "node:assert/strict";
import handler, { hexOf, rows, config, FIELDS } from "../netlify/edge-functions/osap-air-track.js";

assert.equal(config.path, "/api/air-track");
const Q = (s) => new URLSearchParams(s);
assert.equal(hexOf(Q("hex=880844")), "880844");
assert.equal(hexOf(Q("hex=AE1234")), "ae1234", "upper case accepted, sent lower");
for (const bad of ["hex=~12345", "hex=88084", "hex=8808444", "hex=zz0844", "hex=880844%26time=1", ""]) assert.equal(hexOf(Q(bad)), null, bad);

// rows: metres to feet, junk dropped, time order
const R = rows({ path: [[1700000100, 13.9, 100.6, 1000, 145.4, false], [1700000000, 13.8, 100.5, null, null, true], ["x", 1, 2], [1700000200, 95, 100, 1, 1, false], null] });
assert.deepEqual(R, [[1700000000, 13.8, 100.5, null, null, 1], [1700000100, 13.9, 100.6, 3281, 145, 0]]);
assert.deepEqual(rows({}), []);
assert.deepEqual(FIELDS, ["t", "lat", "lon", "alt", "trk", "gnd"]);

let env = {}, calls = [], mode = "ok";
globalThis.Netlify = { env: { get: (k) => env[k] } };
globalThis.fetch = async (u, o) => {
  u = String(u); calls.push(u);
  if (u.includes("/.netlify/identity/user")) return new Response("{}", { status: o.headers.authorization === "Bearer good" ? 200 : 401 });
  assert.ok(!o.headers.cookie && !o.headers.authorization, "nothing about the user is passed on");
  assert.ok(/^https:\/\/opensky-network\.org\/api\/tracks\/all\?icao24=[0-9a-f]{6}&time=0$/.test(u), "only OpenSky's track endpoint, for one address: " + u);
  if (mode === 429) return new Response("", { status: 429 });
  if (mode === 404) return new Response("", { status: 404 });
  if (mode === 500) return new Response("", { status: 500 });
  return Response.json({ icao24: "880844", callsign: "AIQ3074 ", startTime: 1700000000, endTime: 1700000600,
    path: [[1700000000, 13.69, 100.75, 0, 10, true], [1700000300, 13.8, 100.7, 3000, 15, false], [1700000600, 13.9, 100.6, 9000, 20, false]] });
};
const req = (qs, tok = "good", method = "GET") => new Request("https://osap.test/api/air-track?" + qs, { method, headers: tok ? { cookie: "nf_jwt=" + tok } : {} });
const opensky = () => calls.filter((u) => /opensky/.test(u)).length;

let r = await handler(req("hex=880844", null));
assert.equal(r.status, 401, "signed out: denied");
assert.equal(opensky(), 0, "signed out: OpenSky not asked");
assert.equal((await handler(req("hex=880844", "bad"))).status, 401, "bad token: denied");
assert.equal((await handler(req("hex=~abc"))).status, 400, "bad address refused");
assert.equal((await handler(req("hex=880844", "good", "POST"))).status, 405);
assert.equal(opensky(), 0, "nothing asked for refused requests");

r = await handler(req("hex=880844"));
assert.equal(r.status, 200);
assert.equal(r.headers.get("cache-control"), "no-store");
let j = await r.json();
assert.equal(j.schema, "osap-air-track/1");
assert.equal(j.hex, "880844"); assert.equal(j.cs, "AIQ3074");
assert.equal(j.start, 1700000000); assert.equal(j.end, 1700000600);
assert.equal(j.path.length, 3); assert.deepEqual(j.path[1], [1700000300, 13.8, 100.7, 9843, 15, 0]);
assert.equal(j.src.name, "OpenSky Network"); assert.equal(j.src.nc, true);
assert.equal(opensky(), 1);
await handler(req("hex=880844"));
assert.equal(opensky(), 1, "second ask within a minute served from the short copy");

// no current flight: 404 passed on (the page then keeps to what it has seen)
mode = 404;
r = await handler(req("hex=aaaaaa"));
assert.equal(r.status, 404);
assert.match((await r.json()).error, /no current flight/);
// OpenSky down: 502 with the reason
mode = 500;
r = await handler(req("hex=bbbbbb"));
assert.equal(r.status, 502);
assert.match((await r.json()).error, /OpenSky HTTP 500/);
// 429: OpenSky rests a minute; nothing more is asked meanwhile
mode = 429;
r = await handler(req("hex=cccccc"));
assert.equal(r.status, 502);
const n = opensky();
r = await handler(req("hex=dddddd"));
assert.equal(r.status, 502); assert.match((await r.json()).error, /busy/);
assert.equal(opensky(), n, "resting after 429");

// sold version: OpenSky (non-commercial terms) is never asked
env.OSAP_COMMERCIAL = "true"; mode = "ok";
const m = opensky();
r = await handler(req("hex=eeeeee"));
assert.equal(r.status, 404);
assert.match((await r.json()).error, /not in this version/);
assert.equal(opensky(), m, "sold: OpenSky not asked");

console.log("air_track: all checks passed");
