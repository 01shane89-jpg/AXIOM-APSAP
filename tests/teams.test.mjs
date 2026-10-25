// Team, Organisation and paid pilot (tools/tiers.mjs quote, tools/teams.mjs, tools/paddle.mjs, netlify/functions/osap-teams.mjs,
// netlify/functions/paddle-webhook.mjs): prices and seats, roles, team isolation, decision records, the launch offer, the pilot
// credit, Paddle events (twice, late, forged from a Mid checkout), seats on Identity accounts, the tie to team cases, and the
// checkout the server builds against Paddle's sandbox. Paddle, Netlify Identity and Netlify Blobs are stand-ins.
// Run from the repo root: node tests/teams.test.mjs
import { memoryStore } from "./codes_store.mjs";
import { quote, BUSINESS, LAUNCH } from "../tools/tiers.mjs";
import { planOf, seatActive } from "../tools/owner.mjs";
import { tierOfRoles } from "../tools/tiers.mjs";
import { run, mine, readLog, actorOf, checkoutFor, seatsFor, applyBilling, seatOf, writeSeats } from "../tools/teams.mjs";
import { teamEvent, planFromEvent, paddleEnv, priceIds } from "../tools/paddle.mjs";
import { run as caseRun, getCase, listMine, actorOf as caseActor } from "../tools/cases.mjs";

let fails = 0, n = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function refused(p, status, m) {
  try { await p; ok(false, m + " (allowed)"); } catch (e) { ok(e.status === status, m + ": " + (e.status || "") + " " + e.message); }
}
const op = () => "op-team-" + String(++n).padStart(4, "0");
const acct = (id, email, confirmed = true) => actorOf({ id, email, confirmed_at: confirmed ? "2026-10-01T00:00:00Z" : null });
const NOW = Date.parse("2026-10-25T01:00:00Z"), DAY = 86400e3;
const PRICES = { team_month: "pri_tm", team_year: "pri_ty", org_base: "pri_ob", org_seat: "pri_os", pilot: "pri_pi" };

/* ---------- prices ---------- */
ok(quote("team", "year", 3).total === 117000 && quote("team", "month", 3).total === 11700, "Team: US$390 a seat a year, US$39 a month, 3 seats = US$1,170 / US$117");
ok(quote("team", "year", 2) === null && quote("team", "week", 5) === null && quote("team", "year", "x") === null, "Team: fewer than 3 seats, an unknown interval or a non-number is refused");
ok(quote("org", "year", 25).total === 1200000 && quote("org", "year", 30).total === 1200000 + 5 * 40000 && quote("org", "year", 24) === null, "Organisation: US$12,000 for 25 seats, US$400 each over 25");
ok(quote("org", "month", 25) === null, "Organisation is yearly only");
ok(quote("pilot", "once").total === 250000 && quote("pilot", "once").seats === 25, "pilot: US$2,500 once, 25 seats");
const ql = quote("team", "year", 5, { launch: true });
ok(ql.discount.cents === 58500 && ql.total === 136500 && ql.discount.percent === 30 && ql.discount.recurIntervals === 1, "launch offer: 30% off a yearly Team's first year");
const qm = quote("team", "month", 4, { launch: true });
ok(qm.discount.percent === 30 && qm.discount.recurIntervals === 12, "launch offer on a monthly Team: 30% off each of the first 12 months");
const qc = quote("org", "year", 25, { launch: true, credit: true });
ok(qc.discount.cents === 360000 + 250000 && qc.discount.percent === null && qc.total === 1200000 - 610000, "Organisation after a pilot, with the launch offer: 30% plus the US$2,500 credit, as one flat amount");
ok(quote("pilot", "once", 0, { launch: true }).discount === null, "the launch offer is not for pilots");
ok(LAUNCH.customers === 10 && LAUNCH.percent === 30 && BUSINESS.pilot.days === 60, "launch offer: first 10 customers, 30%; pilot: 60 days");

/* ---------- a seat gives Full ---------- */
ok(planOf({ email: "a@test", app_metadata: { osap_seat: { team: "team-x", until: new Date(Date.now() + DAY).toISOString() } } }, "", tierOfRoles) === "full", "an open seat gives Full");
ok(planOf({ email: "a@test", app_metadata: { osap_seat: { team: "team-x", until: new Date(Date.now() - 1000).toISOString() } } }, "", tierOfRoles) === "free", "a seat past its paid-through date gives nothing");
ok(!seatActive({ osap_seat: { until: "2099-01-01T00:00:00Z" } }) && !seatActive({}), "a seat without a team, or no seat, is not a seat");

/* ---------- create and roles ---------- */
const S = memoryStore(), C = memoryStore();
const ADM = acct("u-adm", "adm@test.org"), MEM = acct("u-mem", "mem@test.org"), OUT = acct("u-out", "out@test.org"), UNC = acct("u-unc", "unc@test.org", false);
await refused(run(S, null, { cmd: "create", op: op(), name: "X", plan: "team", seats: 3 }), 401, "signed out: cannot create a team");
await refused(run(S, UNC, { cmd: "create", op: op(), name: "X", plan: "team", seats: 3 }), 403, "an unconfirmed email cannot create a team");
await refused(run(S, ADM, { cmd: "create", op: op(), name: "X", plan: "team", seats: 2 }), 400, "a Team of 2 is refused");
await refused(run(S, ADM, { cmd: "create", op: op(), name: "X", plan: "gov", seats: 3 }), 400, "an unknown plan is refused");
await refused(run(S, ADM, { cmd: "create", name: "X", plan: "team", seats: 3 }), 400, "a change without an op id is refused");
const cop = op();
const made = await run(S, ADM, { cmd: "create", op: cop, name: "Bangkok desk", plan: "team", interval: "year", seats: 3, launch: true }, { now: NOW });
const T = made.view.id;
ok(/^team-[0-9a-f]{32}$/.test(T) && made.view.role === "admin" && made.view.status === "unpaid" && made.view.seats === 3 && made.view.used === 1, "the creator is admin and takes a seat; the team is unpaid");
ok(made.decision.action === "create" && made.decision.actor === "u-adm" && made.decision.authority === "admin" && made.decision.prev === 0 && made.decision.version === 1, "creating writes a decision record");
ok((await run(S, ADM, { cmd: "create", op: cop, name: "Bangkok desk", plan: "team", seats: 3 })).repeat, "the same op twice makes one team");
await refused(run(S, ADM, { cmd: "create", op: op(), name: "Second", plan: "team", seats: 3 }), 400, "an account holds one team");
ok(seatOf((await S.get("t/" + T)), NOW) === null, "an unpaid team gives no seat");
const T2 = (await run(S, OUT, { cmd: "create", op: op(), name: "Other", plan: "team", seats: 3 })).view.id;

/* ---------- team isolation ---------- */
await refused(readLog(S, MEM, T), 404, "a stranger cannot read the team's records");
await refused(run(S, OUT, { cmd: "invite", op: op(), team: T, email: "out@test.org" }), 404, "admin of team B cannot invite into team A");
await refused(run(S, OUT, { cmd: "accept", op: op(), team: T }), 404, "an account that was not invited cannot join");
await refused(run(S, ADM, { cmd: "rename", op: op(), team: "../t/" + T2, name: "x" }), 404, "a path in the team id is refused");
await refused(checkoutFor(S, OUT, T, PRICES), 404, "a stranger cannot pay for (or learn about) team A");
ok((await mine(S, OUT)).team.id === T2 && (await mine(S, ADM)).team.id === T, "each account sees only its own team");

/* ---------- invites and seats ---------- */
await refused(run(S, ADM, { cmd: "invite", op: op(), team: T, email: "nope" }), 400, "a bad email is refused");
await run(S, ADM, { cmd: "invite", op: op(), team: T, email: "mem@test.org" });
await run(S, ADM, { cmd: "invite", op: op(), team: T, email: "unc@test.org" });
await refused(run(S, ADM, { cmd: "invite", op: op(), team: T, email: "four@test.org" }), 400, "a fourth person in 3 seats is refused");
ok((await mine(S, MEM)).invites.some((i) => i.id === T), "the invited account sees the team invite");
ok(!(await mine(S, UNC)).invites.length, "an unconfirmed email sees no invite");
const acc = await run(S, MEM, { cmd: "accept", op: op(), team: T, call: "Mem" }, { now: NOW });
ok(acc.view.role === "member" && acc.seats.length === 1 && acc.seats[0].seat === null, "joining an unpaid team: a member, but no seat yet");
await refused(run(S, MEM, { cmd: "invite", op: op(), team: T, email: "x@test.org" }), 403, "a member cannot invite");
await refused(run(S, MEM, { cmd: "remove", op: op(), team: T, member: "u-adm" }), 403, "a member cannot remove the admin");
await refused(checkoutFor(S, MEM, T, PRICES), 403, "a member cannot pay or change the plan");
await refused(run(S, MEM, { cmd: "plan", op: op(), team: T, plan: "team", seats: 10 }), 403, "a member cannot change the plan");
ok(!(await mine(S, MEM)).team.members.some((m) => m.email), "members see call signs, not emails");
ok((await mine(S, ADM)).team.members.some((m) => m.email === "mem@test.org"), "the admin sees emails");
await refused(run(S, ADM, { cmd: "leave", op: op(), team: T }), 400, "the only admin cannot leave a team with members");

/* ---------- checkout: what the server asks Paddle for ---------- */
const spec = await checkoutFor(S, ADM, T, PRICES, NOW);
ok(spec.items.length === 1 && spec.items[0].price_id === "pri_ty" && spec.items[0].quantity === 3, "checkout: 3 yearly Team seats");
ok(spec.custom_data.osap_team === T && spec.custom_data.osap_launch === "1" && !spec.custom_data.osap_uid, "checkout carries the team and the launch offer, not a personal plan");
ok(spec.discount && spec.discount.type === "percentage" && spec.discount.amount === "30" && spec.discount.usage_limit === 1 && spec.discount.restrict_to.includes("pri_ty") && !spec.discount.recur, "launch offer: a one-use 30% discount on the first year");
await refused(checkoutFor(S, ADM, T, { team_month: "pri_tm" }, NOW), 503, "a price not set up: payments are not on yet");

/* ---------- Paddle events ---------- */
const subEv = (id, status, at, items, cd = { osap_team: T, osap_plan: "team", osap_launch: "1" }, ends = "2027-10-25T01:00:00Z") =>
  ({ event_id: "evt_" + id, event_type: "subscription." + (status === "canceled" ? "canceled" : "updated"), occurred_at: at,
    data: { id: "sub_1", status, custom_data: cd, items: items.map(([p, q]) => ({ price: { id: p }, quantity: q })), current_billing_period: { ends_at: ends } } });
ok(teamEvent(subEv("x", "active", "2026-10-25T01:00:00Z", [["pri_mid", 1]]), PRICES) === null, "a Mid checkout opened with a team id in it changes no team");
ok(planFromEvent(subEv("x", "active", "2026-10-25T01:00:00Z", [["pri_mid", 1]], { osap_uid: "u-out", osap_team: T }), { mid: ["pri_mid"], full: [] }) === null, "...and gives no personal plan either");
const e1 = teamEvent(subEv(1, "active", "2026-10-25T01:05:00Z", [["pri_ty", 3]]), PRICES);
ok(e1.kind === "subscription" && e1.seats === 3 && e1.plan === "team" && e1.interval === "year" && e1.launch, "a team subscription event is read: plan, seats, launch offer");
const a1 = await applyBilling(S, e1, NOW);
const t1 = await S.get("t/" + T);
ok(a1 && t1.status === "active" && t1.until === "2027-10-28T01:00:00.000Z" && a1.seats.length === 2 && a1.seats.every((s) => s.seat && s.seat.team === T), "paid: active until the period ends plus 3 days' grace; every member gets a seat");
ok(t1.last.actor === "paddle" && t1.last.authority === "billing" && t1.last.detail.before.status === "unpaid", "the payment is a decision record by Paddle, with the state before");
ok(((await S.get("launch")) || {}).teams.includes(T), "the team took one of the launch places");
ok((await applyBilling(S, e1, NOW)) === null, "the same event delivered twice changes nothing");
ok((await applyBilling(S, teamEvent(subEv(0, "canceled", "2026-10-25T01:00:00Z", [["pri_ty", 3]]), PRICES), NOW)) === null, "an event older than the last one applied changes nothing");
await refused(checkoutFor(S, ADM, T, PRICES, NOW), 400, "a paid team cannot pay again");
// seats change through Paddle
await refused(seatsFor(S, ADM, T, 2, PRICES), 400, "seats below 3 are refused");
await refused(seatsFor(S, MEM, T, 5, PRICES), 403, "a member cannot change seats");
const sf = await seatsFor(S, ADM, T, 5, PRICES);
ok(sf.subscription === "sub_1" && sf.items[0].quantity === 5 && (await S.get("t/" + T)).seats === 3, "a seat change goes to the team's subscription; seats stay 3 until Paddle confirms");
await applyBilling(S, teamEvent(subEv(2, "active", "2026-10-25T02:00:00Z", [["pri_ty", 5]]), PRICES), NOW);
ok((await S.get("t/" + T)).seats === 5, "Paddle's word sets the seats: 5 after the change was paid");
// the identity side: writing seats
const meta = { "u-adm": { roles: [] }, "u-mem": { roles: ["mid"], osap_beta: null } };
const ID = { getUser: async (id) => { if (!meta[id]) throw new Error("gone"); return { id, appMetadata: meta[id] }; }, updateUser: async (id, b) => { meta[id] = b.app_metadata; } };
const w = await writeSeats(ID, a1.seats);
ok(w === 2 && meta["u-mem"].osap_seat.team === T && meta["u-mem"].roles[0] === "mid", "seats are written to Identity, other metadata kept");
ok((await writeSeats(ID, a1.seats)) === 0, "writing the same seats again writes nothing");
ok(planOf({ email: "mem@test.org", app_metadata: meta["u-mem"] }, "", tierOfRoles) === "full", "the member now has Full");

/* ---------- team cases ---------- */
const cADM = caseActor({ id: "u-adm", email: "adm@test.org", confirmed_at: "x" }), cMEM = caseActor({ id: "u-mem", email: "mem@test.org", confirmed_at: "x" });
const cOUT = caseActor({ id: "u-out", email: "out@test.org", confirmed_at: "x" });
const K1 = (await caseRun(C, cADM, { cmd: "create", op: op(), name: "Case one" }, { plan: "full" })).view.id;
const KX = (await caseRun(C, cOUT, { cmd: "create", op: op(), name: "Not theirs" }, { plan: "full" })).view.id;
const leads = (who) => async (c) => (await getCase(C, who, c).catch(() => null))?.role === "lead";
await refused(run(S, ADM, { cmd: "link", op: op(), team: T, case: KX }, { leads: leads(cADM) }), 403, "an admin cannot link a case they do not lead (or know)");
await refused(run(S, MEM, { cmd: "link", op: op(), team: T, case: K1 }, { leads: leads(cMEM) }), 403, "a member cannot link cases");
await run(S, ADM, { cmd: "link", op: op(), team: T, case: K1 }, { leads: leads(cADM) });
const inv = await run(S, ADM, { cmd: "invite", op: op(), team: T, email: "new@test.org", cases: [{ case: K1, role: "analyst" }, { case: KX, role: "analyst" }, { case: K1, role: "lead" }] });
ok(inv.cases.length === 1 && inv.cases[0].case === K1 && inv.cases[0].role === "analyst", "a seat invite carries only linked cases, and never the lead role");
// the function runs those as case commands by the admin; a member removed from the team is removed from linked cases
await caseRun(C, cADM, { cmd: "invite", op: op(), case: K1, email: "mem@test.org", role: "viewer" });
await caseRun(C, cMEM, { cmd: "accept", op: op(), case: K1 });
const rm = await run(S, ADM, { cmd: "remove", op: op(), team: T, member: "u-mem" }, { now: NOW });
ok(rm.seats[0].uid === "u-mem" && rm.seats[0].seat === null && rm.cases.some((c) => c.cmd === "remove" && c.case === K1 && c.member === "u-mem"), "removing a seat takes the seat away and removes them from the team's cases");
for (const c of rm.cases) await caseRun(C, cADM, { ...c, op: op() });
await refused(getCase(C, cMEM, K1), 404, "after removal the former member cannot open the team case");
ok((await mine(S, MEM)).team === null && (await mine(S, MEM)).seat === null, "the former member has no team and should hold no seat");
await writeSeats(ID, Object.assign(rm.seats, { team: T }));
ok(meta["u-mem"].osap_seat === null && planOf({ email: "mem@test.org", app_metadata: meta["u-mem"] }, "", tierOfRoles) === "mid", "their account is back on its own plan (Mid)");
const log = await readLog(S, ADM, T);
ok(log.length >= 8 && log[0].action === "remove" && log.every((d, i) => i === 0 || d.version === log[i - 1].version - 1), "the team's decision records are complete and in order");

/* ---------- ended ---------- */
const end = await applyBilling(S, teamEvent(subEv(3, "canceled", "2026-11-25T00:00:00Z", [["pri_ty", 5]]), PRICES), NOW);
ok((await S.get("t/" + T)).status === "ended" && end.seats.every((s) => s.seat === null), "a cancelled subscription ends the team and closes every seat");

/* ---------- pilot, then Organisation with the credit ---------- */
const PIL = acct("u-pil", "pil@test.org");
const P = (await run(S, PIL, { cmd: "create", op: op(), name: "Ministry pilot", plan: "pilot" }, { now: NOW })).view.id;
const ps = await checkoutFor(S, PIL, P, PRICES, NOW);
ok(ps.items[0].price_id === "pri_pi" && ps.items[0].quantity === 1 && !ps.discount && !ps.custom_data.osap_launch, "pilot checkout: one US$2,500 charge, no launch offer");
const pe = { event_id: "evt_p1", event_type: "transaction.completed", occurred_at: "2026-10-25T01:10:00Z", data: { id: "txn_p", custom_data: ps.custom_data, items: [{ price: { id: "pri_pi" }, quantity: 1 }] } };
await applyBilling(S, teamEvent(pe, PRICES), NOW);
let tp = await S.get("t/" + P);
ok(tp.status === "active" && tp.seats === 25 && tp.pilot.ends === "2026-12-24T01:10:00.000Z" && tp.until === tp.pilot.ends, "a paid pilot: 25 seats for 60 days");
ok((await applyBilling(S, teamEvent({ ...pe, event_id: "evt_p2" }, PRICES), NOW)) === null, "the pilot's transaction again does not start a second pilot");
await refused(run(S, PIL, { cmd: "plan", op: op(), team: P, plan: "pilot" }), 400, "a team has one pilot");
await run(S, PIL, { cmd: "plan", op: op(), team: P, plan: "org", seats: 30, launch: true });
const os = await checkoutFor(S, PIL, P, PRICES, NOW + DAY);
ok(os.items.length === 2 && os.items[1].price_id === "pri_os" && os.items[1].quantity === 5 && os.custom_data.osap_credit === "1", "Organisation after the pilot: 25 seats plus 5, with the pilot credit");
ok(os.discount.type === "flat" && os.discount.currency_code === "USD" && Number(os.discount.amount) === Math.round(1400000 * 0.3) + 250000, "the credit and the launch offer come off as one flat US$ amount");
const late = await checkoutFor(S, PIL, P, PRICES, Date.parse(tp.pilot.ends) + 31 * DAY);
ok(!late.custom_data.osap_credit, "more than 30 days after the pilot ended, the credit has lapsed");
await applyBilling(S, teamEvent({ event_id: "evt_o1", event_type: "subscription.created", occurred_at: "2026-10-26T00:00:00Z",
  data: { id: "sub_o", status: "active", custom_data: os.custom_data, items: [{ price: { id: "pri_ob" }, quantity: 1 }, { price: { id: "pri_os" }, quantity: 5 }], current_billing_period: { ends_at: "2027-10-26T00:00:00Z" } } }, PRICES), NOW);
tp = await S.get("t/" + P);
ok(tp.plan === "org" && tp.seats === 30 && tp.pilot.used && tp.status === "active", "the Organisation year is on: 30 seats, the credit used");

/* ---------- launch places run out ---------- */
const L = memoryStore();
await L.setJSON("launch", { teams: Array.from({ length: 10 }, (_, i) => "team-" + String(i).padStart(32, "0")) });
const late11 = (await run(L, acct("u-11", "e11@test.org"), { cmd: "create", op: op(), name: "Eleventh", plan: "team", seats: 3, launch: true })).view.id;
const s11 = await checkoutFor(L, acct("u-11", "e11@test.org"), late11, PRICES);
ok(!s11.discount && !s11.custom_data.osap_launch && (await mine(L, acct("u-11", "e11@test.org"))).launchLeft === 0, "the 11th customer pays the full price");

/* ---------- Paddle environment: sandbox unless told otherwise ---------- */
const envOf = (o) => (k) => o[k];
ok(paddleEnv(envOf({ PADDLE_CLIENT_TOKEN: "test_abc", PADDLE_API_KEY: "pdl_sdbx_apikey_x" })).base === "https://sandbox-api.paddle.com", "no PADDLE_ENV: sandbox");
ok(!paddleEnv(envOf({ PADDLE_ENV: "live", PADDLE_CLIENT_TOKEN: "test_abc", PADDLE_API_KEY: "k" })).ok, "live with a sandbox client token is refused");
ok(!paddleEnv(envOf({ PADDLE_CLIENT_TOKEN: "live_abc", PADDLE_API_KEY: "k" })).ok, "a live client token without PADDLE_ENV=live is refused");
ok(!paddleEnv(envOf({ PADDLE_CLIENT_TOKEN: "test_abc", PADDLE_API_KEY: "pdl_live_apikey_x" })).ok, "a live API key in sandbox mode is refused");
ok(!paddleEnv(envOf({ PADDLE_CLIENT_TOKEN: "test_abc" })).ok, "no API key: team payments are off");
ok(JSON.stringify(priceIds(envOf({ PADDLE_PRICE_TEAM_YEAR: " pri_ty ", PADDLE_PRICE_PILOT: "pri_pi" }))) === JSON.stringify({ team_year: "pri_ty", pilot: "pri_pi" }), "price ids come from the environment");

/* ---------- the functions, end to end ---------- */
const env = { PADDLE_CLIENT_TOKEN: "test_tok", PADDLE_API_KEY: "pdl_sdbx_apikey_secret", PADDLE_WEBHOOK_SECRET: "whsec", OSAP_OWNERS: "",
  PADDLE_PRICE_TEAM_MONTH: "pri_tm", PADDLE_PRICE_TEAM_YEAR: "pri_ty", PADDLE_PRICE_ORG_BASE: "pri_ob", PADDLE_PRICE_ORG_SEAT: "pri_os", PADDLE_PRICE_PILOT: "pri_pi" };
globalThis.Netlify = { env: { get: (k) => env[k] } };
const users = { "tok-a": { id: "f-adm", email: "fa@test.org" }, "tok-b": { id: "f-mem", email: "fb@test.org" }, "tok-c": { id: "f-out", email: "fc@test.org" } };
const fmeta = { "f-adm": {}, "f-mem": {}, "f-out": {} };
const realFetch = globalThis.fetch, paddleCalls = [];
globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  if (url.endsWith("/.netlify/identity/user")) {
    const who = users[String((o.headers || {}).authorization || "").replace(/^Bearer /, "")];
    return who ? Response.json({ ...who, confirmed_at: "2026-10-01T00:00:00Z", app_metadata: fmeta[who.id] }) : new Response("{}", { status: 401 });
  }
  return realFetch(u, o);
};
const fn = await import("../netlify/functions/osap-teams.mjs");
const FS = memoryStore(), FC = memoryStore();
fn.useStores(() => ({ teams: FS, cases: FC }));
const FID = { getUser: async (id) => ({ id, appMetadata: fmeta[id] }), updateUser: async (id, b) => { fmeta[id] = b.app_metadata; } };
fn.useIdentity(() => FID);
fn.useFetch(async (u, o) => {
  paddleCalls.push({ url: String(u), method: o.method, auth: o.headers.authorization, body: o.body ? JSON.parse(o.body) : null });
  if (String(u).endsWith("/discounts")) return Response.json({ data: { id: "dsc_1" } }, { status: 201 });
  if (String(u).endsWith("/transactions")) return Response.json({ data: { id: "txn_1" } }, { status: 201 });
  return Response.json({ error: { code: "not_found", detail: "no" } }, { status: 404 });
});
const call = async (tok, body) => {
  const r = await fn.default(new Request("https://osap.test/api/osap-teams", body ? { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(body) } : { headers: tok ? { authorization: "Bearer " + tok } : {} }));
  return { status: r.status, j: await r.json() };
};
ok((await call(null)).status === 401, "function: signed out is refused");
const fc = await call("tok-a", { cmd: "create", op: op(), name: "Function team", plan: "team", interval: "month", seats: 4, launch: true });
const FT = fc.j.team.id;
ok(fc.status === 200 && fc.j.decision.action === "create", "function: an admin creates a team");
const co = await call("tok-a", { cmd: "checkout", team: FT, items: [{ price_id: "pri_cheap", quantity: 1 }], discount: { amount: "100" } });
ok(co.status === 200 && co.j.transaction === "txn_1" && co.j.sandbox === true && co.j.token === "test_tok", "function: checkout gives a sandbox transaction for the page to open");
ok(paddleCalls.every((c) => c.url.startsWith("https://sandbox-api.paddle.com/") && c.auth === "Bearer pdl_sdbx_apikey_secret"), "function: only Paddle's sandbox is called, with the server's key");
const tx = paddleCalls.find((c) => c.url.endsWith("/transactions")).body, dc = paddleCalls.find((c) => c.url.endsWith("/discounts")).body;
ok(tx.items.length === 1 && tx.items[0].price_id === "pri_tm" && tx.items[0].quantity === 4 && tx.discount_id === "dsc_1" && tx.custom_data.osap_team === FT, "function: prices and seats come from the server, not the page's request");
ok(dc.type === "percentage" && dc.amount === "30" && dc.recur === true && dc.maximum_recurring_intervals === 12 && dc.usage_limit === 1, "function: the launch discount is 30% for 12 months, one use");
ok(!JSON.stringify(co.j).includes("apikey"), "function: the API key never reaches the page");
ok((await call("tok-c", { cmd: "checkout", team: FT })).status === 404, "function: a stranger cannot start a checkout for the team");
env.PADDLE_ENV = "live";
const lv = await call("tok-a", { cmd: "checkout", team: FT });
ok(lv.status === 503 && paddleCalls.length === 2, "function: PADDLE_ENV=live with sandbox keys is refused before calling Paddle");
delete env.PADDLE_ENV;
// webhook: signed team event, then the member joins and holds a seat
const wh = await import("../netlify/functions/paddle-webhook.mjs");
wh.useStore(() => FS); wh.useIdentity(() => FID);
const sign = async (raw) => {
  const ts = Math.floor(Date.now() / 1000), k = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ts + ":" + raw))), (x) => x.toString(16).padStart(2, "0")).join("");
  return "ts=" + ts + ";h1=" + h;
};
const hook = async (ev, sig) => { const raw = JSON.stringify(ev); return (await wh.default(new Request("https://osap.test/api/paddle-webhook", { method: "POST", headers: { "paddle-signature": sig || (await sign(raw)) }, body: raw }))).status; };
const subOk = { event_id: "evt_f1", event_type: "subscription.activated", occurred_at: new Date().toISOString(),
  data: { id: "sub_f", status: "active", custom_data: tx.custom_data, items: [{ price: { id: "pri_tm" }, quantity: 4 }], current_billing_period: { ends_at: new Date(Date.now() + 30 * DAY).toISOString() } } };
ok((await hook(subOk, "ts=1;h1=00")) === 401 && (await FS.get("t/" + FT)).status === "unpaid", "webhook: an unsigned event changes nothing");
ok((await hook(subOk)) === 200 && (await FS.get("t/" + FT)).status === "active" && fmeta["f-adm"].osap_seat.team === FT, "webhook: a signed payment opens the team and the admin's seat");
ok((await hook(subOk)) === 200 && (await FS.get("t/" + FT)).version === 2, "webhook: the same delivery twice is one change");
await call("tok-a", { cmd: "invite", op: op(), team: FT, email: "fb@test.org" });
const jn = await call("tok-b", { cmd: "accept", op: op(), team: FT });
ok(jn.status === 200 && fmeta["f-mem"].osap_seat && fmeta["f-mem"].osap_seat.team === FT, "function: a member who joins a paid team gets a seat at once");
fmeta["f-mem"].osap_seat = null; // a seat write that failed
const heal = await call("tok-b");
ok(heal.j.seatChanged && fmeta["f-mem"].osap_seat && fmeta["f-mem"].osap_seat.team === FT, "function: opening the team page puts a missing seat right");
fmeta["f-out"].osap_seat = { team: FT, until: "2099-01-01T00:00:00Z" }; // a seat with no team behind it
await call("tok-c");
ok(fmeta["f-out"].osap_seat === null, "function: a seat for a team the account is not in is taken away");
const lg = await call("tok-b", null);
ok(!JSON.stringify(lg.j).includes("fa@test.org"), "function: a member does not see the admin's email");
globalThis.fetch = realFetch;

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
