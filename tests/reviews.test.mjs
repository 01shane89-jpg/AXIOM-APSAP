// Reviews (tools/reviews.mjs, netlify/functions/osap-reviews.mjs) and the ask's rules (assets/osap-reviews.js).
// Run from the repo root: node tests/reviews.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import { cleanText, privacyProblem, saveReview, setStatus, removeReview, readPublic, listAll, getMine, MAX_TEXT } from "../tools/reviews.mjs";
import { memoryStore } from "./codes_store.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function throws(p, re, m) { try { await p; ok(false, m + " (no error)"); } catch (e) { ok(re.test(e.message), m + ": " + e.message); } }

/* ---------- the words ---------- */
ok(cleanText("  a\u0000b \t c\n\n\n\nd  ") === "a b c\n\nd", "control characters and runs of spaces go");
ok(privacyProblem("Call me on +66 81 234 5678") && privacyProblem("0812345678") && privacyProblem("mail x@y.com") && privacyProblem("see www.spam.io") && privacyProblem("http://a.b"),
  "phone numbers, emails and links are refused");
ok(!privacyProblem("Great maps, used it daily since 2026-10-01. 5 stars, 3 countries, 120 km route."), "dates and small numbers are fine");

/* ---------- the store ---------- */
const S = memoryStore(), A = { id: "u-a", email: "a@test" }, B = { id: "u-b", email: "b@test" }, t0 = Date.parse("2026-10-20T00:00:00Z");
await throws(saveReview(S, A, { stars: 0, text: "x" }, t0), /1 to 5/, "0 stars refused");
await throws(saveReview(S, A, { stars: 6 }, t0), /1 to 5/, "6 stars refused");
await throws(saveReview(S, A, { stars: 3.5 }, t0), /1 to 5/, "half stars refused");
await throws(saveReview(S, A, { stars: 4, text: "x".repeat(MAX_TEXT + 1) }, t0), /under 500/, "over 500 characters refused");
await throws(saveReview(S, A, { stars: 4, text: "ring 0812345678" }, t0), /phone/, "a phone number refused");
const a1 = await saveReview(S, A, { stars: 4, text: "Useful <b>maps</b>" }, t0);
ok(a1.status === "waiting" && a1.stars === 4, "a new review waits for the owner");
let pub = await readPublic(S);
ok(pub.count === 0 && !pub.reviews.length, "a waiting review is not public");
await throws(saveReview(S, A, { stars: 5 }, t0 + 5e3), /Wait a moment/, "a second save straight away is refused");
await saveReview(S, B, { stars: 2, text: "" }, t0);
ok((await listAll(S)).length === 2, "one review per account");
await setStatus(S, a1.id, "shown", t0 + 60e3);
pub = await readPublic(S);
ok(pub.count === 1 && pub.average === 4 && pub.reviews[0].text === "Useful <b>maps</b>" && !JSON.stringify(pub).includes("a@test") && !JSON.stringify(pub).includes("u-a"),
  "shown: in the public copy with stars, words and date, never the email or account " + JSON.stringify(pub.reviews));
const bId = (await getMine(S, B)).id;
await setStatus(S, bId, "shown", t0 + 61e3);
pub = await readPublic(S);
ok(pub.count === 2 && pub.average === 3 && pub.reviews.length === 1 && pub.stars.join() === "0,1,0,1,0", "stars-only reviews count in the average but have no line " + JSON.stringify(pub));
const a2 = await saveReview(S, A, { stars: 1, text: "changed" }, t0 + 120e3);
pub = await readPublic(S);
ok(a2.status === "waiting" && pub.count === 1 && !pub.reviews.length, "editing a shown review takes it out of the public copy until shown again");
await throws(setStatus(S, a1.id, "approved"), /status/, "an unknown status refused");
await throws(setStatus(S, "../x", "shown"), /No such/, "a bad id refused");
await removeReview(S, bId, t0 + 200e3);
pub = await readPublic(S);
ok(pub.count === 0 && (await listAll(S)).length === 1, "deleting a shown review takes it out of the public copy");

/* ---------- the function: who may do what ---------- */
const fn = await import("../netlify/functions/osap-reviews.mjs"), S2 = memoryStore(); fn.useStore(() => S2);
const toks = { "tok-a": { id: "u-a", email: "a@test", confirmed_at: "x", app_metadata: {} }, "tok-own": { id: "u-o", email: "boss@test", confirmed_at: "x", app_metadata: {} } };
globalThis.Netlify = { env: { get: (k) => (k === "OSAP_OWNERS" ? "boss@test" : undefined) } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { const t = ((o && o.headers && o.headers.authorization) || "").replace("Bearer ", ""); return toks[t] ? Response.json(toks[t]) : new Response("{}", { status: 401 }); };
const call = async (tok, body) => { const r = await fn.default(new Request("https://x.test/api/osap-reviews", { method: body ? "POST" : "GET", headers: tok ? { authorization: "Bearer " + tok } : {}, body: body ? JSON.stringify(body) : undefined })); return { s: r.status, j: await r.json() }; };
ok((await call(null, { review: { stars: 5 } })).s === 401, "signed out: cannot write a review");
let r = await call(null);
ok(r.s === 200 && r.j.count === 0 && !("mine" in r.j) && !("all" in r.j), "signed out: reads the public copy only");
r = await call("tok-a", { review: { stars: 5, text: "Clear and fast" } });
ok(r.s === 200 && r.j.mine.status === "waiting", "signed in: a review is saved, waiting");
r = await call("tok-a");
ok(r.j.mine && r.j.mine.stars === 5 && !("all" in r.j), "signed in: sees its own review, not everyone's");
ok((await call("tok-a", { status: { id: "0".repeat(32), to: "shown" } })).s === 403, "not the owner: cannot show a review");
ok((await call("tok-a", { remove: "0".repeat(32) })).s === 403, "not the owner: cannot delete another review");
ok((await call("tok-a", "x".repeat(5000))).s === 413, "a body over 4 KB is refused");
r = await call("tok-own");
ok(r.j.all.length === 1 && r.j.all[0].email === "a@test" && r.j.all[0].status === "waiting", "owner: sees every review with its email");
await call("tok-own", { status: { id: r.j.all[0].id, to: "shown" } });
r = await call(null);
ok(r.j.count === 1 && r.j.reviews[0].text === "Clear and fast", "owner shows it: everyone can read it");
ok((await call("tok-a", { remove: "mine" })).j.mine === null && (await call(null)).j.count === 0, "an account deletes its own review");
globalThis.fetch = realFetch;

/* ---------- the ask (assets/osap-reviews.js) ---------- */
const ctx = { document: { readyState: "complete", addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} };
ctx.window = ctx;
vm.runInNewContext(fs.readFileSync("assets/osap-reviews.js", "utf8"), ctx);
const R = ctx.OSAP_REVIEWS.rules, day = (n) => Date.parse("2026-10-01T10:00:00") + n * 864e5;
let st = null;
for (const n of [0, 1, 2, 3, 4]) st = R.note(st, day(n));
st = R.note(st, day(4)); // the same day twice counts once
ok(st.n === 5 && !R.due(st, day(30)), "5 days of use: not asked yet");
st = R.note(st, day(10));
ok(st.n === 6 && !R.due(st, day(20)), "6 days but only 20 days since the first: not asked");
ok(R.due(st, day(21)), "6 days of use, the first 21 days ago: asked");
R.later(st, day(21));
ok(!R.due(st, day(30)), "Later: not asked again within 14 days");
st = R.note(st, day(36)); st = R.note(st, day(37));
ok(!R.due(st, day(37)), "Later: 14 days on but only 2 more days of use: not asked");
st = R.note(st, day(38));
ok(R.due(st, day(38)), "Later: 14 days and 3 more days of use: asked again");
R.later(st, day(38)); for (const n of [53, 54, 55]) st = R.note(st, day(n));
ok(R.due(st, day(55)), "a second Later: asked once more");
R.later(st, day(55));
ok(st.never && !R.due(st, day(200)), "a third Later: never asked again");
ok(!R.due({ ...R.note(null, day(0)), n: 9, never: true }, day(90)) && !R.due({ ...R.note(null, day(0)), n: 9, done: true }, day(90)), "No thanks, or a review sent: never asked");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
