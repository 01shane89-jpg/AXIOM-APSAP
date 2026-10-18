// The paywall (tools/tiers.mjs, tools/tier_open.mjs, tools/paddle.mjs, netlify/edge-functions/osap-data.js).
// Run from the repo root: node tests/tier.test.mjs
// The edge gate runs here in Node against a stand-in for GitHub Pages and for Netlify Identity, so what it lets through and
// what it refuses is checked without a Netlify account. Keys and the webhook secret are made here for the test.
import http from "node:http";
import fs from "node:fs";
import { tierOfPath, tierOfRoles, allows, TOOLS, SETS, SETS_DEFAULT, PRICES } from "../tools/tiers.mjs";
import { seal, b64u } from "../tools/seal_lib.mjs";
import { loadTierKey, openForTier } from "../tools/tier_open.mjs";
import { verifySignature, planFromEvent, applyPlan } from "../tools/paddle.mjs";
import { isOwner, userRow } from "../tools/owner.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const { subtle } = globalThis.crypto;
const dec = (u8) => new TextDecoder().decode(u8);

/* ---------- which plan each file and tool needs ---------- */
ok(tierOfPath("data/live/news.js") === "free", "headline news is free");
ok(tierOfPath("/data/live/wx-forecast.js") === "free", "weather is free");
ok(tierOfPath("data/basemap/x.json") === "free", "the base map is free");
ok(tierOfPath("data/live/news/th.js") === "free", "per-country news is free");
ok(tierOfPath("data/infra/th/power.js") === "mid", "infrastructure needs Mid");
ok(tierOfPath("data/live/ucdp.js") === "mid", "conflict events need Mid");
ok(tierOfPath("data/something-new/x.js") === "mid", "a data path no rule names needs Mid (closed by default)");
ok(tierOfPath("data/claims/th.json") === "full", "claims need Full");
ok(tierOfPath("data/live/evsum.js") === "full", "AI event summaries need Full");
ok(tierOfPath("data/live/daily/th.js") === "full", "AI daily briefs need Full");
ok(tierOfPath("assets/osap-news.js") === null, "app files are not data");
ok(tierOfRoles(["owner"]) === "full", "the owner's account has everything");
ok(tierOfRoles(["mid"]) === "mid" && tierOfRoles(["mid", "full"]) === "full" && tierOfRoles([]) === "free" && tierOfRoles(undefined) === "free", "roles map to the highest plan");
ok(allows("full", "mid") && allows("mid", "free") && !allows("free", "mid") && !allows("mid", "full"), "plans rank free < mid < full");
ok(SETS.flood === "free" && SETS.news === "free" && !SETS.border && SETS_DEFAULT === "mid", "data sets: News, Alerts, Flood and Hazards free, the rest Mid");
ok(/US\$50 a year/.test(PRICES.mid) && /US\$100 a year/.test(PRICES.full), "the plans sheet shows Full at US$100 a year and Mid at US$50");
ok(TOOLS.overlays === "mid" && TOOLS.mine === "full" && !TOOLS.today && !TOOLS.weather, "toolbar: Today and Weather free, Overlays Mid, My work Full");

/* ---------- sealed for the server's tier key, opened only with it ---------- */
const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const PUB = b64u(await subtle.exportKey("spki", kp.publicKey)), PRIV = b64u(await subtle.exportKey("pkcs8", kp.privateKey));
const other = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const OTHER = b64u(await subtle.exportKey("spki", other.publicKey));
const key = await loadTierKey(PRIV, PUB);
const plain = "window.OSAP_TEST=" + JSON.stringify({ a: "ข้อมูล", n: [1, 2, 3] }) + ";\n";
const sealed = await seal(plain, [PUB], "data/infra/th/test.js");
ok(dec(await openForTier(sealed, key)) === plain, "a file sealed for the tier key opens on the server, byte for byte");
ok((await openForTier(await seal(plain, [OTHER], "x"), key)) === null, "a file sealed only for another key (the owner's hidden areas) is not opened");
ok((await openForTier(plain, key)) === null, "a plain file is left as it is");
ok((await loadTierKey("", PUB)) === null, "no key set: nothing is opened");

/* ---------- Paddle webhooks ---------- */
const SECRET = "pdl_ntfset_test_" + Math.random().toString(36).slice(2);
const sign = async (raw, ts) => {
  const k = await subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = Buffer.from(await subtle.sign("HMAC", k, new TextEncoder().encode(ts + ":" + raw))).toString("hex");
  return "ts=" + ts + ";h1=" + h;
};
const now = Math.floor(Date.now() / 1000);
const ev = (type, status, price, at) => JSON.stringify({ event_id: "evt_1", event_type: type, occurred_at: at, data: { id: "sub_1", status, items: [{ price: { id: price } }], custom_data: { osap_uid: "user-1" } } });
const raw = ev("subscription.created", "active", "pri_mid", "2026-10-17T03:00:00Z");
ok(await verifySignature(raw, await sign(raw, now), SECRET), "a signed delivery is accepted");
ok(!(await verifySignature(raw + " ", await sign(raw, now), SECRET)), "a changed body is refused");
ok(!(await verifySignature(raw, await sign(raw, now - 3600), SECRET)), "an old (replayed) delivery is refused");
ok(!(await verifySignature(raw, await sign(raw, now), "wrong")), "the wrong secret is refused");
ok(!(await verifySignature(raw, null, SECRET)), "an unsigned delivery is refused");
const prices = { mid: ["pri_mid"], full: ["pri_full"] };
const p1 = planFromEvent(JSON.parse(raw), prices);
ok(p1 && p1.uid === "user-1" && p1.tier === "mid", "an active Mid subscription gives Mid");
ok(planFromEvent(JSON.parse(ev("subscription.updated", "active", "pri_full", "2026-10-17T04:00:00Z")), prices).tier === "full", "an upgrade gives Full");
ok(planFromEvent(JSON.parse(ev("subscription.canceled", "canceled", "pri_full", "2026-10-17T05:00:00Z")), prices).tier === "free", "a cancelled subscription drops to Free");
ok(planFromEvent(JSON.parse(ev("subscription.updated", "active", "pri_unknown", "x")), prices).tier === "free", "an unknown price gives no paid plan");
ok(planFromEvent({ event_type: "transaction.completed", data: {} }, prices) === null, "other events change nothing");
const m1 = applyPlan({ roles: ["editor"], provider: "email" }, p1);
ok(m1.roles.join() === "editor,mid" && m1.provider === "email", "the plan role is added and other roles and metadata are kept");
const m2 = applyPlan(m1, { ...p1, tier: "full", at: "2026-10-17T04:00:00Z" });
ok(m2.roles.join() === "editor,full", "an upgrade replaces the plan role (no Mid and Full together)");
ok(applyPlan(m2, { ...p1, tier: "free", at: "2026-10-17T02:00:00Z" }) === null, "an event older than the last one applied is ignored (out-of-order delivery)");
const m3 = applyPlan(m2, { ...p1, tier: "full", at: "2026-10-17T04:00:00Z" });
ok(m3 && m3.roles.join() === "editor,full", "the same event delivered twice gives the same result");

/* ---------- the edge gate, end to end ---------- */
const files = {
  "/AXIOM-APSAP/data/live/news.js": "window.NEWS=1;",
  "/AXIOM-APSAP/data/infra/th/power.js": await seal("window.POWER=1;", [PUB], "data/infra/th/power.js"),
  "/AXIOM-APSAP/data/claims/th.json": '{"claims":[]}',
  "/AXIOM-APSAP/data/layers/us/x.js": await seal("window.US=1;", [OTHER], "data/layers/us/x.js"),
};
const users = { "tok-free": [], "tok-mid": ["mid"], "tok-full": ["full"] };
const srv = http.createServer((q, s) => {
  if (q.url === "/.netlify/identity/user") {
    const t = (q.headers.authorization || "").replace(/^Bearer /, "");
    if (!(t in users)) { s.writeHead(401); s.end("{}"); return; }
    s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ id: t, email: t + "@x", app_metadata: { roles: users[t] } })); return;
  }
  const f = files[q.url.split("?")[0]];
  if (f == null) { s.writeHead(404); s.end("nf"); return; }
  s.writeHead(200, { "content-type": "text/javascript" }); s.end(f);
});
await new Promise((r) => srv.listen(0, r));
const BASE = "http://127.0.0.1:" + srv.address().port;
const env = { OSAP_DATA_ORIGIN: BASE + "/AXIOM-APSAP", OSAP_TIER_KEY: PRIV, OSAP_TIER_PUB: PUB };
globalThis.Netlify = { env: { get: (k) => env[k] } };
const gate = (await import("../netlify/edge-functions/osap-data.js")).default;
const ask = (p, tok) => gate(new Request(BASE + p, { headers: tok ? { cookie: "a=b; nf_jwt=" + tok } : {} }));
let r = await ask("/data/live/news.js");
ok(r && r.status === 401, "signed out: even free data is refused with 401 (an account is needed)");
ok(/^\/\* osap-locked/.test(await r.text()), "the refusal runs nothing when loaded as a script");
ok((await ask("/data/live/news.js", "tok-free")) === undefined, "signed in on Free: free data goes on to the plain proxy");
r = await ask("/data/infra/th/power.js");
ok(r.status === 401, "signed out: Mid data is refused with 401");
r = await ask("/data/infra/th/power.js", "tok-free");
ok(r.status === 402, "Free plan: Mid data is refused");
r = await ask("/data/infra/th/power.js", "forged.jwt.token");
ok(r.status === 401, "a token Identity does not accept is treated as signed out");
r = await ask("/data/infra/th/power.js", "tok-mid");
ok(r.status === 200 && (await r.text()) === "window.POWER=1;", "Mid plan: Mid data arrives, opened from its sealed copy");
r = await ask("/data/claims/th.json", "tok-mid");
ok(r.status === 402 && r.headers.get("x-osap-tier-needed") === "full", "Mid plan: Full data is refused");
r = await ask("/data/claims/th.json", "tok-full");
ok(r.status === 200 && (await r.text()) === '{"claims":[]}', "Full plan: Full data arrives (plain file passed through)");
r = await ask("/data/layers/us/x.js", "tok-full");
ok(r.status === 200 && /^\/\*osap-sealed:v1 /.test(await r.text()), "the owner's hidden-area files stay sealed, even for Full");
r = await ask("/data/infra/th/missing.js", "tok-mid");
ok(r.status === 404, "a missing file is a 404, not an error page");
r = await ask("/data/..%2findex.html", "tok-full");
ok(r && r.status === 400, "a path that climbs out of data/ is refused");

/* ---------- the owner's Users list ---------- */
ok(isOwner({ email: "a@x", app_metadata: { roles: ["owner"] } }, ""), "the owner role makes an account the owner");
ok(isOwner({ email: "Shane@X", confirmed_at: "2026-10-18T00:00:00Z", app_metadata: {} }, "x@y, shane@x"), "a confirmed email in OSAP_OWNERS is the owner");
ok(!isOwner({ email: "shane@x", app_metadata: {} }, "shane@x"), "an unconfirmed email in OSAP_OWNERS is not (anyone can sign up with any email)");
ok(!isOwner({ email: "b@x", confirmed_at: "x", app_metadata: { roles: ["full"] } }, "shane@x") && !isOwner(null, "shane@x"), "everyone else is not the owner");
const row = userRow({ id: "u1", email: "b@x", createdAt: "2026-10-01T00:00:00Z", confirmedAt: "2026-10-01T00:05:00Z", lastSignInAt: "2026-10-18T01:00:00Z",
  appMetadata: { roles: ["mid"], osap_seen: "2026-10-18T02:00:00Z", osap_plan: { sub: "sub_1" } }, userMetadata: { full_name: "B" } }, tierOfRoles);
ok(JSON.stringify(Object.keys(row).sort()) === '["confirmed","email","joined","lastSeen","lastSignIn","owner","tier"]' && row.tier === "mid" && row.lastSeen === "2026-10-18T02:00:00Z",
  "a Users row holds only email, times, plan and the owner mark (no ids, names or payment details)");
const list = (await import("../netlify/functions/osap-users.mjs")).default;
const askList = (tok) => list(new Request(BASE + "/api/osap-users", { headers: tok ? { authorization: "Bearer " + tok } : {} }));
ok((await askList()).status === 401 && (await askList("forged")).status === 401, "Users list: signed out or a forged token gets 401");
ok((await askList("tok-full")).status === 403 && (await askList("tok-mid")).status === 403, "Users list: any account but the owner's gets 403, Full included");
srv.close();

/* ---------- the page wiring ---------- */
const html = fs.readFileSync("index.html", "utf8"), sw = fs.readFileSync("sw.js", "utf8");
ok(html.includes('<script src="assets/osap-tier.js"></script>'), "index.html loads assets/osap-tier.js");
ok(sw.includes('"assets/osap-tier.js"'), "sw.js keeps assets/osap-tier.js for offline use");
ok(/\(api\|\\\.netlify\)/.test(sw), "sw.js never caches the sign-in and plan answers");
const tierJs = fs.readFileSync("assets/osap-tier.js", "utf8");
ok(tierJs.includes('var MOVE_TO = "https://axiom-osap.netlify.app/";') && html.includes('location.replace("https://axiom-osap.netlify.app/"+(location.search?location.search+"&":"?")+"from=pages"+location.hash)'),
  "the GitHub Pages copy sends people to the Netlify site to sign in (index.html and osap-tier.js)");
ok(html.includes("if(/\\.github\\.io$/.test(location.hostname))"), "only the github.io address is moved, never the Netlify site itself");
ok(tierJs.includes('+ "from=pages" +'), "osap-tier.js marks the move too, so the Netlify site can say to add the home-screen icon again");
ok(/const FRESH = \[[^\]]*osap-tier\\\.js/.test(sw), "sw.js asks the network first for the sign-in code, so an email link never runs an old copy");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
