// Unit test for the live air traffic relay (netlify/edge-functions/osap-air.js), no network: fetch and Netlify.env are stubbed.
// Usage: node tests/air_live.test.mjs
import assert from "node:assert/strict";
import handler, { circle, config } from "../netlify/edge-functions/osap-air.js";

assert.equal(config.path, "/api/air");
const Q = (s) => new URLSearchParams(s);
assert.deepEqual(circle(Q("lat=13.71&lon=100.62&nm=79")), { la: 13.75, lo: 100.5, nm: 80 });
assert.deepEqual(circle(Q("lat=0&lon=179.9&nm=900")), { la: 0, lo: -180, nm: 250 }, "radius capped at 250 nm, 180 wraps");
assert.deepEqual(circle(Q("lat=0&lon=0&nm=1")), { la: 0, lo: 0, nm: 10 });
for (const bad of ["lat=91&lon=0&nm=50", "lat=0&lon=200&nm=50", "lat=x&lon=0&nm=50", "lat=0&lon=0&nm=0", "lat=0&lon=0", ""]) assert.equal(circle(Q(bad)), null, bad);

let env = {}, calls = [], mode = {};
globalThis.Netlify = { env: { get: (k) => env[k] } };
const NOW = Date.now();
globalThis.fetch = async (u, o) => {
  u = String(u); calls.push(u);
  if (u.includes("/.netlify/identity/user")) return new Response("{}", { status: o.headers.authorization === "Bearer good" ? 200 : 401 });
  assert.ok(!o.headers.cookie && !o.headers.authorization, "nothing about the user is passed on");
  const id = u.includes("adsb.fi") ? "fi" : "lol";
  if (mode[id] === 429) return new Response("", { status: 429 });
  if (mode[id] === 500) return new Response("", { status: 500 });
  return Response.json({ now: NOW, ac: [
    { hex: "880844", flight: "AIQ3074 ", r: "HS-BBD", t: "A320", lat: 13.9, lon: 100.6, alt_baro: 38000, gs: 450, track: 145, seen_pos: 2, squawk: "7247", category: "A3" },
    { hex: "880old", lat: 13.8, lon: 100.4, alt_baro: 9000, seen_pos: 600 },
    { hex: "nopos", alt_baro: 9000, seen: 1 }] });
};
const req = (qs, tok = "good", method = "GET") => new Request("https://osap.test/api/air?" + qs, { method, headers: tok ? { cookie: "nf_jwt=" + tok } : {} });

let r = await handler(req("lat=13.7&lon=100.6&nm=79", null));
assert.equal(r.status, 401, "signed out: denied");
assert.ok(!calls.some((u) => /adsb/.test(u)), "signed out: no provider asked");
assert.equal((await handler(req("lat=13.7&lon=100.6&nm=79", "bad"))).status, 401, "bad token: denied");
assert.equal((await handler(req("lat=999&lon=0&nm=50"))).status, 400);
assert.equal((await handler(req("lat=1&lon=1&nm=50", "good", "POST"))).status, 405);

calls = [];
r = await handler(req("lat=13.7&lon=100.6&nm=79"));
assert.equal(r.status, 200);
assert.equal(r.headers.get("cache-control"), "no-store");
let j = await r.json();
assert.equal(j.schema, "osap-air-live/1");
assert.equal(j.src.id, "fi"); assert.equal(j.src.url, undefined, "provider URL builder not sent");
assert.equal(calls.filter((u) => /adsb/.test(u))[0], "https://opendata.adsb.fi/api/v3/lat/13.75/lon/100.5/dist/80");
assert.equal(j.ac.length, 1, "old and position-less aircraft left out");
assert.equal(j.ac[0][0], "880844"); assert.equal(j.ac[0][1], "AIQ3074"); assert.equal(j.ac[0][10], Math.round((NOW - 2000) / 1000));
assert.deepEqual(j.f.slice(0, 3), ["hex", "cs", "reg"]);

// a second page on the same area within seconds gets the same answer without asking the provider again
calls = [];
r = await handler(req("lat=13.72&lon=100.58&nm=75"));
assert.equal(r.status, 200); assert.ok(!calls.some((u) => /adsb/.test(u)), "cached answer reused");

// adsb.fi busy: adsb.lol answers, and adsb.fi rests
mode = { fi: 429 }; calls = [];
j = await (await handler(req("lat=20&lon=100&nm=100"))).json();
assert.equal(j.src.id, "lol"); assert.equal(calls.filter((u) => /adsb/.test(u)).at(-1), "https://api.adsb.lol/v2/point/20/100/100");
calls = [];
await handler(req("lat=30&lon=100&nm=100"));
assert.ok(!calls.some((u) => /adsb\.fi/.test(u)), "busy provider rests");

// both down: 502 with the reasons, never a crash
mode = { fi: 500, lol: 500 };
r = await handler(req("lat=40&lon=100&nm=100"));
assert.equal(r.status, 502); assert.match((await r.json()).error, /adsb\.lol HTTP 500/);

// sold version: the non-commercial source is never asked
env = { OSAP_COMMERCIAL: "true" }; mode = {}; calls = [];
j = await (await handler(req("lat=50&lon=10&nm=100"))).json();
assert.equal(j.src.id, "lol"); assert.ok(!calls.some((u) => /adsb\.fi/.test(u)), "sold: adsb.fi not asked");
console.log("air live relay tests passed");
