// Team shared cases, milestone 1 (tools/cases.mjs, netlify/functions/osap-cases.mjs): roles, case isolation, decision records.
// Most checks here are refusals: a stranger, a viewer, an analyst or a removed member trying what their role does not allow.
// Run from the repo root: node tests/cases.test.mjs
import { memoryStore } from "./codes_store.mjs";
import { run, getCase, listMine, readLog, actorOf, cleanCall, cleanEmail, MAX_MEMBERS } from "../tools/cases.mjs";

let fails = 0, n = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function refused(p, status, m) {
  try { await p; ok(false, m + " (allowed)"); } catch (e) { ok(e.status === status, m + ": " + (e.status || "") + " " + e.message); }
}
const op = () => "op-test-" + String(++n).padStart(4, "0");
const acct = (id, email, confirmed = true) => actorOf({ id, email, confirmed_at: confirmed ? "2026-10-01T00:00:00Z" : null });

const S = memoryStore();
const LEAD = acct("u-lead", "lead@test.org"), ANA = acct("u-ana", "Ana@Test.org"), VIEW = acct("u-view", "view@test.org"), OUT = acct("u-out", "out@test.org");
const UNCONF = acct("u-unc", "unc@test.org", false);

/* ---------- small rules ---------- */
ok(cleanCall("Fox 1") === "Fox 1" && cleanCall("me@x.com") === "" && cleanCall("x".repeat(40)).length === 24, "call signs: free text, 24 characters, never an email");
ok(cleanEmail(" Ana@Test.org ") === "ana@test.org" && !cleanEmail("not an email") && !cleanEmail("a@b"), "emails are checked and lower-cased");
ok(actorOf({ id: "x", email: "x@test.org" }).email === "", "an unconfirmed email does not count for invites");
ok(actorOf(null) === null && actorOf({}) === null, "no account, no actor");

/* ---------- create ---------- */
await refused(run(S, null, { cmd: "create", op: op(), name: "X" }, { plan: "full" }), 401, "signed out: cannot create");
await refused(run(S, LEAD, { cmd: "create", op: op(), name: "X" }, { plan: "mid" }), 403, "Mid plan: cannot create a case");
await refused(run(S, LEAD, { cmd: "create", name: "X" }, { plan: "full" }), 400, "a change without an op id is refused");
await refused(run(S, LEAD, { cmd: "create", op: op(), name: "  \u0000 " }, { plan: "full" }), 400, "a case needs a name");
const createOp = op();
const made = await run(S, LEAD, { cmd: "create", op: createOp, name: "Deep South <b>cells</b>", call: "Lead 6" }, { plan: "full" });
const A = made.view.id;
ok(/^case-[0-9a-f]{32}$/.test(A) && made.view.role === "lead" && made.view.version === 1, "the creator is the case's first lead, version 1");
ok(made.decision.action === "create" && made.decision.actor === "u-lead" && made.decision.authority === "lead" && made.decision.prev === 0 && made.decision.version === 1 && made.decision.at,
  "creating writes a decision record with actor, authority, versions and time");
const again = await run(S, LEAD, { cmd: "create", op: createOp, name: "Deep South <b>cells</b>" }, { plan: "full" });
ok(again.repeat && again.view.id === A && (await listMine(S, LEAD)).cases.length === 1, "the same op twice makes one case, not two");
const B = (await run(S, OUT, { cmd: "create", op: op(), name: "Other team" }, { plan: "full" })).view.id;

/* ---------- case isolation ---------- */
await refused(getCase(S, LEAD, B), 404, "lead of case A asks for case B: no such case");
await refused(getCase(S, OUT, A), 404, "a stranger asks for case A: no such case");
await refused(getCase(S, OUT, "case-" + "0".repeat(32)), 404, "a guessed case id: the same answer as a real one");
await refused(getCase(S, OUT, "../c/" + A), 404, "a path in the case id is refused");
await refused(readLog(S, OUT, A), 404, "a stranger cannot read case A's decision records");
await refused(run(S, OUT, { cmd: "invite", op: op(), case: A, email: "out@test.org", role: "lead" }), 404, "a stranger cannot invite themselves into case A");
ok(!(await listMine(S, LEAD)).cases.some((c) => c.id === B) && !(await listMine(S, OUT)).cases.some((c) => c.id === A), "each account lists only its own cases");

/* ---------- invites ---------- */
await refused(run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "nope", role: "analyst" }), 400, "a bad email is refused");
await refused(run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "ana@test.org", role: "owner" }), 400, "an unknown role is refused");
await run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "ana@test.org", role: "analyst", reason: "Thai-language reader" });
await run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "view@test.org", role: "viewer" });
await run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "unc@test.org", role: "viewer" });
ok((await listMine(S, ANA)).invites.some((i) => i.id === A && i.role === "analyst"), "the invited account sees the invite (email matched without case)");
ok(!(await listMine(S, UNCONF)).invites.length, "an account whose email is not confirmed sees no invite");
await refused(run(S, UNCONF, { cmd: "accept", op: op(), case: A }), 404, "an unconfirmed email cannot accept");
await refused(run(S, OUT, { cmd: "accept", op: op(), case: A }), 404, "an account that was not invited cannot accept");
await refused(getCase(S, ANA, A), 404, "invited is not yet a member: cannot read the case");
const acc = await run(S, ANA, { cmd: "accept", op: op(), case: A, call: "Ana" });
ok(acc.view.role === "analyst" && acc.decision.authority === "invitee" && acc.decision.action === "accept", "accepting makes the analyst a member, recorded");
await run(S, VIEW, { cmd: "accept", op: op(), case: A });
ok((await listMine(S, VIEW)).cases.some((c) => c.id === A && c.role === "viewer"), "the viewer now lists case A");

/* ---------- what each role sees ---------- */
const seenByView = await getCase(S, VIEW, A), seenByLead = await getCase(S, LEAD, A);
ok(!JSON.stringify(seenByView).includes("@") && seenByView.invites === undefined, "a viewer sees call signs and roles, never emails or invites");
ok(seenByLead.members.some((m) => m.email === "ana@test.org") && seenByLead.invites.some((i) => i.email === "unc@test.org"), "a lead sees members' emails and open invites");

/* ---------- roles: what each may do ---------- */
await refused(run(S, VIEW, { cmd: "invite", op: op(), case: A, email: "x@test.org", role: "viewer" }), 403, "a viewer cannot invite");
await refused(run(S, ANA, { cmd: "invite", op: op(), case: A, email: "x@test.org", role: "viewer" }), 403, "an analyst cannot invite");
await refused(run(S, ANA, { cmd: "role", op: op(), case: A, member: "u-ana", role: "lead" }), 403, "an analyst cannot make themselves lead");
await refused(run(S, VIEW, { cmd: "role", op: op(), case: A, member: "u-view", role: "analyst" }), 403, "a viewer cannot raise their own role");
await refused(run(S, ANA, { cmd: "remove", op: op(), case: A, member: "u-view" }), 403, "an analyst cannot remove someone");
await refused(run(S, VIEW, { cmd: "rename", op: op(), case: A, name: "Mine now" }), 403, "a viewer cannot rename the case");
await refused(run(S, LEAD, { cmd: "role", op: op(), case: A, member: "u-lead", role: "analyst" }), 400, "the last lead cannot step down");
await refused(run(S, LEAD, { cmd: "leave", op: op(), case: A }), 400, "the last lead cannot leave while others remain");
const v0 = (await getCase(S, LEAD, A)).version;
await refused(run(S, LEAD, { cmd: "rename", op: op(), case: A, name: "Stale", version: v0 - 1 }), 409, "a change made on an old copy of the case is refused");
await run(S, VIEW, { cmd: "call", op: op(), case: A, call: "Watcher" });
ok((await getCase(S, LEAD, A)).members.find((m) => m.uid === "u-view").call === "Watcher", "any member sets their own call sign");

/* ---------- lead approval of items (milestone 3) ---------- */
const item = { id: "a".repeat(32), fp: "b".repeat(16) }, sealedWhy = "U2VhbGVkIHJlYXNvbiBieXRlcw==";
await refused(run(S, ANA, { cmd: "approve", op: op(), case: A, target: item }), 403, "an analyst cannot approve, not even their own work");
await refused(run(S, VIEW, { cmd: "approve", op: op(), case: A, target: item }), 403, "a viewer cannot approve");
await refused(run(S, OUT, { cmd: "approve", op: op(), case: A, target: item }), 404, "a stranger cannot approve");
await refused(run(S, LEAD, { cmd: "approve", op: op(), case: A, target: { id: "x", fp: "y" } }), 400, "a bad item reference is refused");
await refused(run(S, LEAD, { cmd: "approve", op: op(), case: A, target: item, sreason: "plain words here" }), 400, "a reason that is not sealed is refused");
const ap = await run(S, LEAD, { cmd: "approve", op: op(), case: A, target: item, sreason: sealedWhy });
ok(ap.decision.action === "approve" && ap.decision.target.kind === "item" && ap.decision.target.fp === item.fp && ap.decision.detail.sreason === sealedWhy && ap.decision.authority === "lead",
  "a lead's approval is a decision record: item, fingerprint, sealed reason, authority");
ok((await getCase(S, VIEW, A)).items[item.id].state === "approved", "every member sees the item as approved");
const rj = await run(S, LEAD, { cmd: "reject", op: op(), case: A, target: { id: item.id, fp: "c".repeat(16) } });
ok(rj.decision.prev === ap.decision.version && (await getCase(S, ANA, A)).items[item.id].state === "rejected", "a later decision replaces the earlier one, both kept in the record");

/* ---------- removal takes effect at once ---------- */
const rm = await run(S, LEAD, { cmd: "remove", op: op(), case: A, member: "u-view", reason: "left the team" });
ok(rm.decision.action === "remove" && rm.decision.target.id === "u-view" && rm.decision.reason === "left the team", "removal is recorded with its reason");
await refused(getCase(S, VIEW, A), 404, "a removed member cannot read the case");
await refused(readLog(S, VIEW, A), 404, "a removed member cannot read its decision records");
await refused(run(S, VIEW, { cmd: "call", op: op(), case: A, call: "back" }), 404, "a removed member cannot change anything");
ok(!(await listMine(S, VIEW)).cases.length, "a removed member no longer lists the case");

/* ---------- the decision log ---------- */
const log = await readLog(S, ANA, A);
ok(log.length === (await getCase(S, ANA, A)).version && log.every((d, i) => d.version === log.length - i && d.prev === d.version - 1),
  "one decision record per version, newest first, unbroken: " + log.map((d) => d.version + d.action).join(" "));
ok(!JSON.stringify(log).includes("@"), "decision records carry no emails (invites are named by a hash)");
// a crash between the case write and the record's own copy: the next read writes the copy from the case record
const cur = await getCase(S, LEAD, A);
S.m.delete("l/" + A + "/" + String(cur.version).padStart(8, "0"));
ok((await readLog(S, LEAD, A))[0].version === cur.version, "a record whose copy was lost is restored from the case record");

/* ---------- two leads at the same moment ---------- */
await run(S, LEAD, { cmd: "role", op: op(), case: A, member: "u-ana", role: "lead" });
const vBefore = (await getCase(S, LEAD, A)).version;
const race = await Promise.allSettled([
  run(S, LEAD, { cmd: "invite", op: op(), case: A, email: "r1@test.org", role: "viewer" }),
  run(S, ANA, { cmd: "invite", op: op(), case: A, email: "r2@test.org", role: "viewer" }),
]);
const afterRace = await getCase(S, LEAD, A), raceLog = await readLog(S, LEAD, A);
ok(race.every((r) => r.status === "fulfilled") && afterRace.version === vBefore + 2 && afterRace.invites.filter((i) => /^r[12]@/.test(i.email)).length === 2,
  "two changes at once: both kept, one version each, neither lost");
ok(raceLog.every((d, i) => d.version === raceLog.length - i), "the decision log stays unbroken after a race");

/* ---------- limits ---------- */
const C = (await run(S, LEAD, { cmd: "create", op: op(), name: "Big" }, { plan: "full" })).view.id;
for (let i = 1; i < MAX_MEMBERS; i++) await run(S, LEAD, { cmd: "invite", op: op(), case: C, email: "p" + i + "@test.org", role: "viewer" });
await refused(run(S, LEAD, { cmd: "invite", op: op(), case: C, email: "one-more@test.org", role: "viewer" }), 400, "a case holds up to " + MAX_MEMBERS + " people");

/* ---------- the function: identity comes from the server, never the page ---------- */
const fn = await import("../netlify/functions/osap-cases.mjs"), S2 = memoryStore(); fn.useStore(() => S2);
const toks = {
  "tok-full": { id: "u-f", email: "f@test.org", confirmed_at: "x", app_metadata: { roles: ["full"] } },
  "tok-free": { id: "u-g", email: "g@test.org", confirmed_at: "x", app_metadata: {} },
};
globalThis.Netlify = { env: { get: () => undefined } };
const logs = [], realLog = console.log;
globalThis.fetch = async (u, o) => { const t = ((o && o.headers && o.headers.authorization) || "").replace("Bearer ", ""); return toks[t] ? Response.json(toks[t]) : new Response("{}", { status: 401 }); };
const call = async (tok, body, q = "") => {
  console.log = (...a) => logs.push(a.join(" "));
  try {
    const r = await fn.default(new Request("https://x.test/api/osap-cases" + q, { method: body ? "POST" : "GET", headers: tok ? { authorization: "Bearer " + tok } : {}, body: body ? JSON.stringify(body) : undefined }));
    return { s: r.status, j: await r.json() };
  } finally { console.log = realLog; }
};
ok((await call(null)).s === 401 && (await call("tok-bad")).s === 401, "no token or a bad token: 401");
ok((await call("tok-free", { cmd: "create", op: op(), name: "X" })).s === 403, "a free account cannot create (plan read from Identity, not the page)");
ok((await call("tok-free", { cmd: "create", op: op(), name: "X", plan: "full", role: "lead" })).s === 403, "claims in the request body change nothing");
const fr = await call("tok-full", { cmd: "create", op: op(), name: "Sulu sea watch", reason: "secret-words-here" });
ok(fr.s === 200 && fr.j.case.role === "lead", "a Full account creates a case through the function");
ok((await call("tok-free", null, "?case=" + fr.j.case.id)).s === 404, "another account asking for it gets 404");
ok((await call("tok-full", null, "?case=" + fr.j.case.id + "&log=1")).j.log.length === 1, "the lead reads its decision records");
ok((await call("tok-full", { cmd: "x".repeat(5000) })).s === 413, "an oversized request is refused");
ok(!logs.some((l) => /@|secret-words|Sulu|tok-/.test(l)) && logs.length > 0, "function logs carry no emails, names, reasons or tokens: " + JSON.stringify(logs.slice(0, 3)));

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
