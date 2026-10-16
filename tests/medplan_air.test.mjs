// Air MEDEVAC assets and missions (assets/osap-medplan-air.js, Medical Planner Build Plan v2 phase 4): only a confirmed,
// unexpired aircraft inside its own limits competes with ground; a mission is worked out leg by leg.
// Run from the repo root: node tests/medplan_air.test.mjs
globalThis.window = globalThis;
await import("../assets/osap-medplan-air.js");
const A = globalThis.OSAP_MEDAIR;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const NOW = "2026-10-04T08:00:00.000Z";
const base = { provider: "Test Air Ambulance", aircraft_type: "H145", base_name: "Test Base", base_lat: 14.0, base_lon: 100.6, status: "CONFIRMED", last_confirmed: "2026-10-04T06:00:00.000Z", cruise_kn: 120, night_capable: "no", min_vis_km: 1.5, max_gust_kn: 35 };
const a = A.makeAsset(base, NOW);
ok(!a.errors && a.status === "CONFIRMED" && a.expires_at === "2026-10-04T18:00:00.000Z" && a.launch_min === 15 && a.approval_min === 10 && a.night_capable === "no", "an aircraft: confirmed for 12 hours by default, default call, approval and launch times");
const bad = A.makeAsset({ provider: "", status: "MAYBE", base_lat: "x", cruise_kn: 5 }, NOW);
ok(bad.errors && ["provider", "status", "base grid", "cruise kn"].every((e) => bad.errors.includes(e)), "what is wrong is named: " + (bad.errors || []).join(", "));
const x = A.makeAsset(Object.assign({}, base, { provider: "<img src=x onerror=alert(1)>\u0007 Air" }), NOW);
ok(x.provider === "<img src=x onerror=alert(1)> Air", "typed text is kept as text (control characters dropped); the page escapes it");

const pickup = { name: "HLZ", ll: [14.8, 100.6], hlz: true }, dest = { id: "H1", name: "Test Hospital", ll: [14.1, 100.6] };
const m = A.mission(a, pickup, dest, { now: NOW, wx: { night: false, vis_km: 10, gust_kn: 10 } });
const fly = (km) => Math.round(km * 1000 / (120 * 1852 / 3600));
ok(m.competes && m.parts.map((p) => p.code).join() === "call,approval,launch,inbound,ground,outbound,handoff", "a mission is call, approval, launch, inbound, ground, outbound, handoff");
ok(Math.abs(m.parts[3].s - fly(88.96)) < 5 && m.total_s === m.parts.reduce((t, p) => t + p.s, 0) && m.total_s > fly(88.96 + 77.84) + 40 * 60, "legs add up and include more than the flight: " + Math.round(m.total_s / 60) + " min");

const later = A.mission(a, pickup, dest, { now: "2026-10-04T19:00:00.000Z" });
ok(!later.competes && later.status === "UNKNOWN" && /confirmation expired 2026-10-04 18:00Z/.test(later.not_competing[0]), "a confirmation past its time no longer competes and says when it expired");
const pl = A.mission(A.makeAsset(Object.assign({}, base, { status: "PLANNED" }), NOW), pickup, dest, { now: NOW });
const po = A.mission(A.makeAsset(Object.assign({}, base, { status: "POTENTIAL" }), NOW), pickup, dest, { now: NOW });
ok(!pl.competes && !po.competes && /planned, not confirmed/.test(pl.not_competing[0]), "planned and potential aircraft never compete");
const night = A.mission(a, pickup, dest, { now: NOW, wx: { night: true } });
const wx = A.mission(a, pickup, dest, { now: NOW, wx: { night: false, vis_km: 0.8, gust_kn: 40 } });
ok(!night.competes && night.not_competing.includes("not night capable") && !wx.competes && wx.not_competing.length === 2, "its own limits stop it: night, visibility, gusts " + JSON.stringify(wx.not_competing));
const unk = A.mission(A.makeAsset(Object.assign({}, base, { night_capable: "" }), NOW), pickup, dest, { now: NOW, wx: { night: true } });
ok(!unk.competes && /night capability not known/.test(unk.not_competing[0]), "unknown night capability is not taken as yes");

const fast = A.makeAsset(Object.assign({}, base, { provider: "Fast Air", cruise_kn: 150 }), NOW);
const b = A.best([A.makeAsset(Object.assign({}, base, { status: "PLANNED", cruise_kn: 300, provider: "Planned Jet" }), NOW), a, fast], pickup, dest, { now: NOW });
ok(b && b.provider === "Fast Air", "best: the quickest aircraft that competes, never a faster one that is only planned");
ok(A.best([A.makeAsset(Object.assign({}, base, { status: "UNAVAILABLE" }), NOW)], pickup, dest, { now: NOW }) === null, "best: none when no aircraft competes");
let L = A.upsert([], a); L = A.upsert(L, Object.assign({}, a, { status: "UNAVAILABLE" }));
ok(L.length === 1 && L[0].status === "UNAVAILABLE", "the same aircraft is replaced, not added twice");

/* the documented air medical services (Shane 2026-10-06): each entry sourced, quoted, an institutional number only, and its
   SHA-256 record fingerprint matching its content */
const { createHash } = await import("node:crypto");
const canon = (o) => Array.isArray(o) ? "[" + o.map(canon).join(",") + "]" : o && typeof o === "object" ? "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}" : JSON.stringify(o);
const th = A.providers("TH");
ok(th.length >= 1 && th[0].provider.includes("Sky Doctor") && th[0].phone === "1669" && /1669/.test(th[0].quote) && /HEMS/.test(th[0].quote2), "Thailand: Thai Sky Doctor, requested through 1669, in the source's words");
ok(A.providers("zz").length === 0 && A.providers("").length === 0, "a country without an entry has none documented (the plan says so; it is not 'no air medevac')");
Object.keys(A.DIRECTORY).forEach((cc) => A.DIRECTORY[cc].forEach((d) => {
  const e = Object.assign({}, d); delete e.fp;
  ok(/^https:\/\//.test(d.src) && d.srcname && d.quote && /^\d{4}-\d{2}-\d{2}$/.test(d.read) && d.request && d.provider, cc + " " + d.id + ": sourced, quoted, dated, says how to request it");
  ok(!/\b0?[689]\d[- ]?\d{3}[- ]?\d{4}\b/.test(d.phone || "") && (d.phone || "").replace(/\D/g, "").length <= 12, cc + " " + d.id + ": an institutional number, never a mobile: " + d.phone);
  ok(createHash("sha256").update(canon(e)).digest("hex") === d.fp, cc + " " + d.id + ": record fingerprint matches its content");
}));
th[0].phone = "x";
ok(A.providers("th")[0].phone === "1669", "the directory cannot be changed through what providers() returns");

if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("all passed");
