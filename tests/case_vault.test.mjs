// Team shared cases, milestone 2: the sealed vault (tools/case_vault.mjs) and the sealing on the device (assets/osap-case-crypto.js).
// Walks a whole case: devices register, the lead wraps the case key for each, an analyst seals and saves, a viewer opens it,
// a removed member is shut out and the key moves on to a new epoch. The server's copy is checked to hold no readable text.
// Run from the repo root: node tests/case_vault.test.mjs
import { createRequire } from "node:module";
import { memoryStore } from "./codes_store.mjs";
import { run, actorOf } from "../tools/cases.mjs";
import { addDevice, dropDevice, keysFor, putWraps, readData, writeData, MAX_DEVICES, MAX_TOTAL } from "../tools/case_vault.mjs";
const CC = createRequire(import.meta.url)("../assets/osap-case-crypto.js");

let fails = 0, n = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function refused(p, status, m) {
  try { await p; ok(false, m + " (allowed)"); } catch (e) { ok(e.status === status, m + ": " + (e.status || "") + " " + e.message); }
}
async function fails_(p, m) { try { await p; ok(false, m + " (opened)"); } catch (e) { ok(true, m); } }
const op = () => "op-vault-" + String(++n).padStart(4, "0");
const acct = (id, email) => actorOf({ id, email, confirmed_at: "2026-10-01T00:00:00Z" });
const devId = (s) => (s + "0".repeat(32)).slice(0, 32).replace(/[^a-f0-9]/g, "a");

const S = memoryStore();
const LEAD = acct("u-lead", "lead@test.org"), ANA = acct("u-ana", "ana@test.org"), VIEW = acct("u-view", "view@test.org"), OUT = acct("u-out", "out@test.org");

/* ---------- devices ---------- */
const dev = {};
for (const [who, a] of [["lead", LEAD], ["ana", ANA], ["view", VIEW], ["out", OUT]]) {
  const pair = await CC.newDevice();
  dev[who] = { id: devId("d" + who.replace(/[^a-f]/g, "") + who.length), pair, pub: await CC.pubOf(pair), a };
  await addDevice(S, a, { id: dev[who].id, pub: dev[who].pub });
}
ok(dev.lead.pub.length === 87, "a device public key is 87 characters of base64url");
await refused(addDevice(S, LEAD, { id: "zz", pub: dev.lead.pub }), 400, "a bad device id is refused");
await refused(addDevice(S, LEAD, { id: devId("e1"), pub: "x".repeat(87) + "=" }), 400, "a bad public key is refused");
await refused(addDevice(S, null, { id: devId("e1"), pub: dev.lead.pub }), 401, "signed out: cannot register a device");
for (let i = 1; i < MAX_DEVICES; i++) await addDevice(S, OUT, { id: devId("f" + i), pub: dev.out.pub });
await refused(addDevice(S, OUT, { id: devId("fe"), pub: dev.out.pub }), 400, "up to " + MAX_DEVICES + " devices per account");
for (let i = 1; i < MAX_DEVICES; i++) await dropDevice(S, OUT, devId("f" + i));

/* ---------- a case with three members ---------- */
const A = (await run(S, LEAD, { cmd: "create", op: op(), name: "Vault test" }, { plan: "full" })).view.id;
await run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "ana@test.org", role: "analyst" });
await run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "view@test.org", role: "viewer" });
await run(S, ANA, { cmd: "accept", op: op(), case: A });
await run(S, VIEW, { cmd: "accept", op: op(), case: A });

/* ---------- the lead hands out the case key ---------- */
let k = await keysFor(S, LEAD, A, dev.lead.id);
ok(k.epoch === 1 && k.role === "lead" && k.need.length === 3 && !k.need.some((x) => x.uid === "u-out"), "the lead sees the three member devices waiting for the key, not a stranger's");
const key1 = CC.newCaseKey();
const wraps = await Promise.all(k.need.map(async (x) => ({ device: x.device, wrap: await CC.wrap(key1, x.pub, A, 1, x.device) })));
await refused(putWraps(S, ANA, A, 1, wraps), 403, "an analyst cannot hand out the case key");
await refused(putWraps(S, VIEW, A, 1, wraps), 403, "a viewer cannot hand out the case key");
await refused(putWraps(S, OUT, A, 1, wraps), 404, "a stranger cannot hand out the case key");
await refused(putWraps(S, LEAD, A, 1, [{ device: dev.out.id, wrap: await CC.wrap(key1, dev.out.pub, A, 1, dev.out.id) }]), 400, "the key cannot go to a non-member's device");
await refused(putWraps(S, LEAD, A, 2, wraps), 409, "a key for the wrong epoch is refused");
ok((await putWraps(S, LEAD, A, 1, wraps)).stored === 3, "the lead hands the key to the three member devices");
ok((await putWraps(S, LEAD, A, 1, wraps)).stored === 0, "a key already handed out is never replaced");
ok((await keysFor(S, LEAD, A, dev.lead.id)).need.length === 0, "nothing left waiting");

/* ---------- each member opens its own copy ---------- */
async function caseKeyOf(d, epoch) {
  const kk = await keysFor(S, d.a, A, d.id), w = kk.wraps.find((x) => x.epoch === epoch);
  return CC.unwrap(w.wrap, d.pair.privateKey, A, epoch, d.id);
}
const anaKey = await caseKeyOf(dev.ana, 1);
ok(Buffer.from(anaKey).equals(Buffer.from(key1)), "the analyst's device unwraps the same case key");
await refused(keysFor(S, OUT, A, dev.out.id), 404, "a stranger gets no keys (no such case)");
await refused(keysFor(S, ANA, A, dev.view.id), 400, "a member cannot fetch another member's device keys");
const viewWrap = (await keysFor(S, VIEW, A, dev.view.id)).wraps[0].wrap;
await fails_(CC.unwrap(viewWrap, dev.ana.pair.privateKey, A, 1, dev.view.id), "one device's wrapped key does not open with another device's private key");
await fails_(CC.unwrap(viewWrap, dev.view.pair.privateKey, "case-" + "1".repeat(32), 1, dev.view.id), "a wrapped key moved to another case does not open");

/* ---------- sealed content ---------- */
const secret = { "osap-an-ent": [{ id: "e1", name: "BRN-C cell Narathiwat", note: "seen near the market" }] };
const sealed = await CC.seal(anaKey, A, 1, 0, secret);
await refused(writeData(S, VIEW, A, [{ bucket: 0, epoch: 1, rev: 0, data: sealed }]), 403, "a viewer cannot save to the case");
await refused(writeData(S, OUT, A, [{ bucket: 0, epoch: 1, rev: 0, data: sealed }]), 404, "a stranger cannot save to the case");
await refused(writeData(S, ANA, A, [{ bucket: 99, epoch: 1, rev: 0, data: sealed }]), 400, "a bucket out of range is refused");
await refused(writeData(S, ANA, A, [{ bucket: 0, epoch: 1, rev: 0, data: "<not sealed>" }]), 400, "text that is not sealed base64 is refused");
ok((await writeData(S, ANA, A, [{ bucket: 0, epoch: 1, rev: 0, data: sealed }])).saved[0].rev === 1, "an analyst saves a sealed bucket");
await refused(writeData(S, LEAD, A, [{ bucket: 0, epoch: 1, rev: 0, data: sealed }]), 409, "a save made on an old copy is refused, not written over");
const stored = JSON.stringify([...S.m.values()].map((v) => v.body));
ok(!/BRN-C|Narathiwat|market/.test(stored), "the server's copy holds no readable case content");
const got = await readData(S, VIEW, A);
const opened = await CC.open(await caseKeyOf(dev.view, 1), A, 1, 0, got.buckets[0].data);
ok(opened["osap-an-ent"][0].name === "BRN-C cell Narathiwat", "a viewer reads and opens the analyst's bucket");
await fails_(CC.open(key1, A, 1, 1, got.buckets[0].data), "a bucket moved to another slot does not open");
await refused(readData(S, OUT, A), 404, "a stranger cannot read the sealed buckets");
await refused(writeData(S, ANA, A, [{ bucket: 1, epoch: 1, rev: 0, data: "A".repeat(200001) }]), 400, "an oversized bucket is refused");
const big = "A".repeat(190000);
const many = Array.from({ length: 11 }, (_, i) => ({ bucket: i + 1, epoch: 1, rev: 0, data: big }));
await refused(writeData(S, ANA, A, many), 413, "a case holds about " + MAX_TOTAL / 1e6 + " MB sealed");

const bomb = await CC.seal(key1, A, 1, 5, { x: "0".repeat(9000000) });
ok(bomb.length < 60000, "content is gzipped before sealing (" + bomb.length + " characters for 9 MB of zeros)");
await fails_(CC.open(key1, A, 1, 5, bomb), "a bucket that unpacks past 8 MB is refused while unpacking");

/* ---------- removal: shut out at once, new epoch ---------- */
await run(S, LEAD, { cmd: "remove", op: op(), case: A, member: "u-view", reason: "rotated out" });
await refused(readData(S, VIEW, A), 404, "a removed member cannot read the sealed buckets");
await refused(keysFor(S, VIEW, A, dev.view.id), 404, "a removed member gets no keys");
k = await keysFor(S, LEAD, A, dev.lead.id);
ok(k.epoch === 2 && k.need.length === 2 && !k.need.some((x) => x.uid === "u-view"), "removal moves the case to epoch 2; only the two members left wait for the new key");
await refused(writeData(S, ANA, A, [{ bucket: 0, epoch: 1, rev: 1, data: sealed }]), 409, "content sealed under the old key is refused after removal");
const key2 = CC.newCaseKey();
await putWraps(S, LEAD, A, 2, await Promise.all(k.need.map(async (x) => ({ device: x.device, wrap: await CC.wrap(key2, x.pub, A, 2, x.device) }))));
const ana2 = await keysFor(S, ANA, A, dev.ana.id);
ok(ana2.wraps.map((w) => w.epoch).join() === "2,1", "a member keeps the old key (to read older buckets) and gets the new one");
const sealed2 = await CC.seal(await CC.unwrap(ana2.wraps[0].wrap, dev.ana.pair.privateKey, A, 2, dev.ana.id), A, 2, 0, secret);
ok((await writeData(S, ANA, A, [{ bucket: 0, epoch: 2, rev: 1, data: sealed2 }])).saved[0].rev === 2, "new content is sealed under the epoch 2 key");
await fails_(CC.open(key1, A, 2, 0, sealed2), "the old key (all a removed member could have kept) does not open new content");

/* ---------- the function routes ---------- */
const fn = await import("../netlify/functions/osap-cases.mjs"); fn.useStore(() => S);
globalThis.Netlify = { env: { get: () => undefined } };
const toks = { "tok-ana": { id: "u-ana", email: "ana@test.org", confirmed_at: "x", app_metadata: {} }, "tok-out": { id: "u-out", email: "out@test.org", confirmed_at: "x", app_metadata: {} } };
globalThis.fetch = async (u, o) => { const t = ((o && o.headers && o.headers.authorization) || "").replace("Bearer ", ""); return toks[t] ? Response.json(toks[t]) : new Response("{}", { status: 401 }); };
const realLog = console.log;
const call = async (tok, body, q = "") => {
  console.log = () => {};
  try {
    const r = await fn.default(new Request("https://x.test/api/osap-cases" + q, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + tok }, body: body ? JSON.stringify(body) : undefined }));
    return { s: r.status, j: await r.json() };
  } finally { console.log = realLog; }
};
ok((await call("tok-ana", null, "?case=" + A + "&data=1")).j.buckets.length === 1, "GET data: a member gets the sealed buckets");
ok((await call("tok-out", null, "?case=" + A + "&data=1")).s === 404, "GET data: a stranger gets 404");
ok((await call("tok-out", { cmd: "constructor" })).s === 400, "a command named like a built-in is just unknown");
ok((await call("tok-ana", { cmd: "put", case: A, buckets: [{ bucket: 3, epoch: 2, rev: 0, data: "QUFB".repeat(2000) }] })).s === 200, "POST put: large sealed saves pass the size gate");
ok((await call("tok-ana", { cmd: "device", device: { id: devId("ab"), pub: dev.ana.pub }, pad: "x".repeat(5000) })).s === 413, "other commands stay under 4 KB");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
