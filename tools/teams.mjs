// Team, Organisation and paid-pilot accounts (thread "Build the Team plan and pilot checkout", Shane 2026-10-25: the approved
// 90-day launch plan). A team is who pays for seats; each seat holder gets Full (tools/owner.mjs seatActive). What a team may
// do is decided here, on the server, for every request: netlify/functions/osap-teams.mjs passes in the signed-in account and
// never anything the page says about itself. Prices and seat rules are tools/tiers.mjs (BUSINESS, LAUNCH, quote).
//
// Roles belong to a person in one team:
//   admin   sees members' emails and open invites; invites, removes, makes admins; picks the plan; pays; links team cases
//   member  sees the team's name, plan, seats and paid-through date, and the members' call signs; can leave
// Deny by default: anyone not in a team gets "No such team." (404), the same as for a team that does not exist. Nothing
// lists every team. The OSAP owner gets no special access to teams. An account holds at most one team seat.
//
// Teams and team cases (tools/cases.mjs): an admin links cases they lead to the team. Inviting someone to a seat can also
// invite them into those cases, and removing a seat removes the person from them, each as a case command by that admin, with
// its own case decision record. A team admin never gets into a case they do not lead: the case rules decide, not this file.
//
// Every change is a command that writes one decision record: who, in which role, to what, why, the team version before and
// after, and when. Paddle's webhook is the only thing that changes what was paid (status, seats, paid-through date); it acts
// as actor "paddle", and an event Paddle sends twice, or later than a newer one, changes nothing.
//
// Records in the Netlify Blobs store "osap-teams":
//   t/<team id>               the team, with "last", the decision record that made this version, in the same write
//   l/<team id>/<version>     each decision record's own copy, append-only
//   o/<hash of account + op>  an op already done: { team, version }
//   u/<hash of account id>    { team } the team an account is in      } lookups only; who may do what is always read from
//   i/<hash of email>         { teams } the teams an email is invited to } t/<team id>
//   p/<Paddle id>             { team } a Paddle subscription or transaction, so a webhook finds its team
//   launch                    { teams } the teams that took the launch offer (LAUNCH.customers at most)
// Logs carry the command, a short team id and the status only: never emails, names or reasons.
import { BUSINESS, LAUNCH, SEAT_GRACE_DAYS, quote } from "./tiers.mjs";
import { cleanName, cleanEmail, cleanCall } from "./cases.mjs";

export const SCHEMA = "osap-team/1";
export const DECISION = "osap-team-decision/1";
export const REASON_MAX = 300, LOG_MAX = 200, MAX_LINKED = 50;
const DAY = 86400e3;

export class TeamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const deny = () => new TeamError(404, "No such team.");
const no = (m) => new TeamError(403, m);
const bad = (m) => new TeamError(400, m);

const JUNK = new RegExp("[" + [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]].map(([a, z]) => String.fromCharCode(a) + "-" + String.fromCharCode(z)).join("") + "]+", "g");
const clean = (s, n) => String(s == null ? "" : s).normalize("NFC").replace(JUNK, " ").replace(/\s+/g, " ").trim().slice(0, n);
async function hash(s) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
function newId() {
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b);
  return "team-" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
const TEAM_ID = /^team-[0-9a-f]{32}$/, OP_ID = /^[A-Za-z0-9_-]{8,64}$/, CASE_ID = /^case-[0-9a-f]{32}$/;
function teamKey(id) { if (!TEAM_ID.test(String(id))) throw deny(); return "t/" + id; }
const logKey = (id, v) => "l/" + id + "/" + String(v).padStart(8, "0");
const uKey = async (uid) => "u/" + (await hash("osap-team-u:" + uid));
const iKey = async (email) => "i/" + (await hash("osap-team-i:" + email));
const eHash = (email) => hash("osap-team-i:" + email);
const iso = (t) => new Date(t).toISOString();

export async function readTeam(store, id) {
  const r = await store.getWithMetadata(teamKey(id), { type: "json" });
  return r && r.data ? { t: r.data, etag: r.etag } : null;
}
async function editList(store, key, f) {
  for (let i = 0; i < 4; i++) {
    const r = await store.getWithMetadata(key, { type: "json" });
    const next = f(r && r.data ? r.data : null);
    if (next === undefined) return;
    const w = await store.setJSON(key, next, r ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
    if (w.modified !== false) return;
  }
}
const addInvite = async (store, email, id) => editList(store, await iKey(email), (d) => ({ teams: [...((d && d.teams) || []).filter((x) => x !== id), id].slice(-50) }));
const dropInvite = async (store, email, id) => editList(store, await iKey(email), (d) => (d && (d.teams || []).includes(id) ? { teams: d.teams.filter((x) => x !== id) } : undefined));
const setMine = async (store, uid, id) => store.setJSON(await uKey(uid), { team: id });
const dropMine = async (store, uid, id) => editList(store, await uKey(uid), (d) => (d && d.team === id ? { team: null } : undefined));

/* ---------- who may do what ---------- */
export function roleIn(t, actor) {
  const m = t && actor && t.members && Object.prototype.hasOwnProperty.call(t.members, actor.uid) ? t.members[actor.uid] : null;
  return m ? (m.admin ? "admin" : "member") : null;
}
const admins = (t) => Object.values(t.members).filter((m) => m.admin).length;
const used = (t) => Object.keys(t.members).length + Object.keys(t.invites || {}).length;
/** The seat an account holds in this team right now: { team, until } while the team has paid, else null. */
export function seatOf(t, now = Date.now()) {
  return t && (t.status === "active" || t.status === "past_due") && t.until && Date.parse(t.until) > now ? { team: t.id, until: t.until } : null;
}
/** Whether the team may still take the launch offer: it asked for it (and agreed to a testimonial), it is a Team or
    Organisation, and it holds one of the LAUNCH.customers places or one is free. */
export function launchOpen(t, taken) {
  if (!t.launch || !LAUNCH.plans.includes(t.plan)) return false;
  const list = (taken && taken.teams) || [];
  return list.includes(t.id) || list.length < LAUNCH.customers;
}
/** The pilot's US$2,500 still counts against an Organisation year: not used, and no more than creditDays after the pilot ended. */
export function creditOpen(t, now = Date.now()) {
  const p = t.pilot;
  return !!(p && !p.used && t.plan === "org" && Date.parse(p.ends) + BUSINESS.pilot.creditDays * DAY > now);
}

/** What a member may see: admins see emails, open invites and linked cases; everyone else call signs. */
export function viewOf(t, actor, taken, now = Date.now()) {
  const role = roleIn(t, actor), admin = role === "admin";
  return {
    id: t.id, name: t.name, plan: t.plan, interval: t.interval, seats: t.seats, used: used(t), status: t.status, until: t.until, version: t.version, role,
    seat: !!seatOf(t, now),
    members: Object.entries(t.members).map(([uid, m]) => ({ uid, admin: !!m.admin, call: m.call || "", since: m.since, me: uid === actor.uid, ...(admin ? { email: m.email || "" } : {}) })),
    invites: admin ? Object.values(t.invites || {}).map((v) => ({ email: v.email, at: v.at })) : undefined,
    cases: admin ? t.cases || [] : undefined,
    pilot: t.pilot ? { ends: t.pilot.ends, credit: creditOpen(t, now) || (t.plan === "pilot" && !t.pilot.used) } : null,
    launch: admin ? { asked: !!t.launch, open: launchOpen(t, taken), taken: !!(taken && (taken.teams || []).includes(t.id)) } : undefined,
    quote: admin ? quote(t.plan, t.interval, t.seats, { launch: launchOpen(t, taken), credit: creditOpen(t, now) }) : undefined,
  };
}

export function actorOf(u) {
  if (!u || !u.id) return null;
  return { uid: String(u.id), email: (u.confirmed_at || u.confirmedAt) ? cleanEmail(u.email) : "" };
}

/** The account's team and the team invites waiting for its confirmed email. */
export async function mine(store, actor, now = Date.now()) {
  if (!actor) throw new TeamError(401, "Sign in first.");
  // seat: the seat this account should hold now, so the function can put right a seat a failed write left behind
  const out = { team: null, invites: [], launchLeft: 0, seat: null };
  const taken = await store.get("launch", { type: "json" });
  out.launchLeft = Math.max(0, LAUNCH.customers - ((taken && taken.teams) || []).length);
  const u = await store.get(await uKey(actor.uid), { type: "json" });
  if (u && u.team) {
    const r = await readTeam(store, u.team).catch(() => null);
    if (r && roleIn(r.t, actor)) { out.team = viewOf(r.t, actor, taken, now); out.seat = seatOf(r.t, now); }
  }
  if (actor.email) {
    const inv = await store.get(await iKey(actor.email), { type: "json" }), eh = await eHash(actor.email);
    for (const id of (inv && inv.teams) || []) {
      const r = await readTeam(store, id).catch(() => null);
      const v = r && (r.t.invites || {})[eh];
      if (v && !roleIn(r.t, actor)) out.invites.push({ id, name: r.t.name, plan: r.t.plan, at: v.at });
    }
  }
  return out;
}

export async function readLog(store, actor, id, limit = 100) {
  if (!actor) throw new TeamError(401, "Sign in first.");
  const r = await readTeam(store, id);
  if (!r || roleIn(r.t, actor) !== "admin") throw deny();
  if (r.t.last) await flush(store, r.t.last);
  const n = Math.min(Math.max(1, limit | 0), LOG_MAX), out = [];
  for (let v = r.t.version; v >= 1 && out.length < n; v--) {
    const d = await store.get(logKey(id, v), { type: "json" });
    if (d) out.push(d);
  }
  return out;
}

function checkPlan(plan, interval, seats) {
  const q = quote(plan, interval, seats);
  if (!q) {
    const P = BUSINESS[plan];
    if (!P) throw bad("The plan must be team, org or pilot.");
    if (!P.intervals.includes(interval)) throw bad(P.name + " is paid " + P.intervals.join(" or ") + ".");
    throw bad(P.name + " has " + P.minSeats + " to " + P.maxSeats + " seats.");
  }
  return q;
}

/* ---------- commands ---------- */
// Each returns { view, decision, seats, cases }: seats = [{ uid, seat }] the function writes to those accounts' Identity
// app_metadata.osap_seat; cases = [{ cmd, case, email?, member?, role? }] the case commands the function runs as this admin.
// opts.leads(caseId) -> true when the actor leads that case (checked by the function against tools/cases.mjs).
export async function run(store, actor, body, opts = {}) {
  if (!actor) throw new TeamError(401, "Sign in first.");
  const b = body && typeof body === "object" ? body : {};
  const op = String(b.op || "");
  if (!OP_ID.test(op)) throw bad("Each change needs an op id.");
  const now = opts.now || Date.now();
  const opKey = "o/" + (await hash("osap-team-o:" + actor.uid + ":" + op));
  const done = await store.get(opKey, { type: "json" });
  if (done) {
    const r = await readTeam(store, done.team).catch(() => null);
    const decision = await store.get(logKey(done.team, done.version), { type: "json" });
    return { view: r && roleIn(r.t, actor) ? viewOf(r.t, actor, null, now) : null, decision, repeat: true, seats: [], cases: [] };
  }
  const reason = clean(b.reason, REASON_MAX);

  if (b.cmd === "create") {
    if (!actor.email) throw no("Confirm your email first: the team's receipts and invites go to it.");
    const u = await store.get(await uKey(actor.uid), { type: "json" });
    if (u && u.team && (await readTeam(store, u.team).catch(() => null))) throw bad("You are in a team already. Leave it first.");
    const name = cleanName(b.name);
    if (!name) throw bad("Give the team a name.");
    const plan = String(b.plan || ""), interval = String(b.interval || (plan === "pilot" ? "once" : "year"));
    const q = checkPlan(plan, interval, plan === "pilot" ? BUSINESS.pilot.seats : b.seats);
    const id = newId(), at = iso(now);
    const t = { schema: SCHEMA, id, name, plan, interval, seats: q.seats, status: "unpaid", until: null, created: at, by: actor.uid, version: 0,
      members: { [actor.uid]: { admin: true, email: actor.email, call: cleanCall(b.call), since: at, by: actor.uid } }, invites: {}, cases: [],
      billing: null, pilot: null, launch: b.launch && LAUNCH.plans.includes(plan) ? { agreed: at, by: actor.uid } : null };
    return commit(store, actor, null, t, { action: "create", target: { kind: "team", id }, detail: { name, plan, interval, seats: q.seats, launch: !!t.launch }, reason, op, opKey, now,
      after: [() => setMine(store, actor.uid, id)] });
  }

  for (let tries = 0; tries < 4; tries++) {
    const r = await readTeam(store, b.team);
    const role = r && roleIn(r.t, actor);
    const eh = actor.email ? await eHash(actor.email) : null;
    const invited = r && eh ? (r.t.invites || {})[eh] : null;
    if (!r || (!role && !((b.cmd === "accept" || b.cmd === "decline") && invited))) throw deny();
    const t = structuredClone(r.t), ifv = b.version == null ? null : Number(b.version);
    if (ifv != null && ifv !== t.version) throw new TeamError(409, "This team changed since you opened it. Reload and try again.");
    const admin = role === "admin";
    let step, seats = [], cases = [];
    switch (b.cmd) {
      case "rename": {
        if (!admin) throw no("Only an admin can rename the team.");
        const name = cleanName(b.name);
        if (!name) throw bad("Give the team a name.");
        t.name = name;
        step = { action: "rename", target: { kind: "team", id: t.id }, detail: { name } };
        break;
      }
      case "plan": {
        // before paying, any plan; after a pilot, Organisation (the pilot's credit then comes off the first year). Seats on a
        // paid Team or Organisation change through Paddle ("seats" in the function), never here.
        if (!admin) throw no("Only an admin can choose the plan.");
        const plan = String(b.plan || ""), interval = String(b.interval || (plan === "pilot" ? "once" : "year"));
        const fromPilot = t.plan === "pilot" && t.pilot && plan === "org";
        if (t.status !== "unpaid" && !fromPilot) throw bad("This team has paid already. Change seats from the team page; change the plan by writing to us.");
        if (plan === "pilot" && t.pilot) throw bad("A team has one pilot.");
        const q = checkPlan(plan, interval, plan === "pilot" ? BUSINESS.pilot.seats : b.seats);
        if (q.seats < used(t)) throw bad("The team has " + used(t) + " people and invites. Remove some first, or choose more seats.");
        const from = { plan: t.plan, interval: t.interval, seats: t.seats };
        Object.assign(t, { plan, interval, seats: q.seats });
        if (b.launch != null) t.launch = b.launch && LAUNCH.plans.includes(plan) ? t.launch || { agreed: iso(now), by: actor.uid } : null;
        step = { action: "plan", target: { kind: "team", id: t.id }, detail: { from, to: { plan, interval, seats: q.seats }, launch: !!t.launch } };
        break;
      }
      case "invite": {
        if (!admin) throw no("Only an admin can invite.");
        const email = cleanEmail(b.email);
        if (!email) throw bad("That is not an email address.");
        if (Object.values(t.members).some((m) => m.email === email)) throw bad("That account is in the team already.");
        const h = await eHash(email);
        if (!t.invites[h] && used(t) >= t.seats) throw bad("All " + t.seats + " seats are taken. Add seats, or remove someone first.");
        t.invites[h] = { email, at: iso(now), by: actor.uid };
        // the team cases to invite them into as well: only cases linked to this team, each checked again by the case rules
        for (const x of [].concat(b.cases || []).slice(0, MAX_LINKED)) {
          const role = String((x && x.role) || "analyst");
          if (x && t.cases.includes(x.case) && (role === "analyst" || role === "viewer")) cases.push({ cmd: "invite", case: x.case, email, role });
        }
        step = { action: "invite", target: { kind: "invite", id: h }, detail: { cases: cases.length }, after: [() => addInvite(store, email, t.id)] };
        break;
      }
      case "uninvite": {
        if (!admin) throw no("Only an admin can cancel an invite.");
        const email = cleanEmail(b.email), h = email && (await eHash(email));
        if (!h || !t.invites[h]) throw bad("No open invite for that email.");
        delete t.invites[h];
        for (const c of t.cases) cases.push({ cmd: "uninvite", case: c, email });
        step = { action: "uninvite", target: { kind: "invite", id: h }, detail: {}, after: [() => dropInvite(store, email, t.id)] };
        break;
      }
      case "accept":
      case "decline": {
        if (role) throw bad("You are in this team already.");
        delete t.invites[eh];
        if (b.cmd === "accept") {
          const u = await store.get(await uKey(actor.uid), { type: "json" });
          if (u && u.team && u.team !== t.id && (await readTeam(store, u.team).catch(() => null))) throw bad("You are in another team. Leave it first.");
          t.members[actor.uid] = { admin: false, email: actor.email, call: cleanCall(b.call), since: iso(now), by: invited.by };
          seats.push({ uid: actor.uid, seat: seatOf(t, now) });
        }
        step = { action: b.cmd, target: { kind: "member", id: actor.uid }, detail: {},
          after: [() => dropInvite(store, actor.email, t.id), ...(b.cmd === "accept" ? [() => setMine(store, actor.uid, t.id)] : [])] };
        break;
      }
      case "remove":
      case "leave": {
        const uid = b.cmd === "leave" ? actor.uid : String(b.member || "");
        if (b.cmd === "remove" && !admin) throw no("Only an admin can remove someone.");
        if (!Object.prototype.hasOwnProperty.call(t.members, uid)) throw bad("That person is not in the team.");
        const m = t.members[uid];
        if (m.admin && admins(t) === 1 && Object.keys(t.members).length > 1) throw bad("A team needs an admin. Make someone else admin first.");
        delete t.members[uid];
        seats.push({ uid, seat: null });
        // out of the team's cases too, by the admin who removed them (a person leaving takes themselves out)
        for (const c of t.cases) cases.push(b.cmd === "leave" ? { cmd: "leave", case: c } : { cmd: "remove", case: c, member: uid });
        step = { action: b.cmd, target: { kind: "member", id: uid }, detail: { admin: !!m.admin }, after: [() => dropMine(store, uid, t.id)] };
        break;
      }
      case "admin": {
        if (!admin) throw no("Only an admin can change who is admin.");
        const uid = String(b.member || ""), on = !!b.on;
        if (!Object.prototype.hasOwnProperty.call(t.members, uid)) throw bad("That person is not in the team.");
        if (!!t.members[uid].admin === on) throw bad(on ? "They are admin already." : "They are not admin.");
        if (!on && admins(t) === 1) throw bad("A team needs an admin. Make someone else admin first.");
        t.members[uid].admin = on;
        step = { action: on ? "admin" : "unadmin", target: { kind: "member", id: uid }, detail: {} };
        break;
      }
      case "call": {
        t.members[actor.uid].call = cleanCall(b.call);
        step = { action: "call", target: { kind: "member", id: actor.uid }, detail: { call: t.members[actor.uid].call } };
        break;
      }
      case "link":
      case "unlink": {
        if (!admin) throw no("Only an admin can link cases.");
        const c = String(b.case || "");
        if (!CASE_ID.test(c)) throw bad("That is not a case.");
        if (b.cmd === "link") {
          if (t.cases.includes(c)) throw bad("That case is linked already.");
          if (t.cases.length >= MAX_LINKED) throw bad("A team links up to " + MAX_LINKED + " cases.");
          if (!opts.leads || !(await opts.leads(c))) throw no("Link only a case you lead.");
          t.cases.push(c);
        } else {
          if (!t.cases.includes(c)) throw bad("That case is not linked.");
          t.cases = t.cases.filter((x) => x !== c);
        }
        step = { action: b.cmd, target: { kind: "case", id: c }, detail: {} };
        break;
      }
      default:
        throw bad("Unknown command.");
    }
    const out = await commit(store, actor, r, t, { ...step, reason, op, opKey, now, authority: role || "invitee" });
    seats.team = t.id;
    if (out) return { ...out, seats, cases };
  }
  throw new TeamError(409, "This team is busy. Try again.");
}

async function commit(store, actor, prev, t, s) {
  if (prev && prev.t.last) await flush(store, prev.t.last);
  const version = (prev ? prev.t.version : 0) + 1;
  t.version = version;
  t.updated = iso(s.now);
  const decision = {
    schema: DECISION, id: t.id + ":" + version, team: t.id, action: s.action, actor: actor.uid, authority: s.authority || "admin",
    target: s.target, detail: s.detail || {}, reason: s.reason || "", prev: version - 1, version, at: t.updated, op: s.op || null,
  };
  t.last = decision;
  const w = await store.setJSON(teamKey(t.id), t, prev ? { onlyIfMatch: prev.etag } : { onlyIfNew: true });
  if (w.modified === false) return null;
  await flush(store, decision);
  if (s.opKey) await store.setJSON(s.opKey, { team: t.id, version });
  for (const f of s.after || []) await f().catch(() => {});
  return { view: roleIn(t, actor) ? viewOf(t, actor, null, s.now) : null, decision, seats: [], cases: [] };
}
async function flush(store, d) { await store.setJSON(logKey(d.team, d.version), d, { onlyIfNew: true }); }

/* ---------- paying ---------- */
/**
 * What the function asks Paddle for when an admin pays: { quote, items: [{ price_id, quantity }], discount, custom_data,
 * currency_code }. discount is null or the one-use Paddle discount to create first. prices: tools/paddle.mjs priceIds().
 * Throws when the team has paid already or a price is not set up.
 */
export async function checkoutFor(store, actor, id, prices, now = Date.now()) {
  if (!actor) throw new TeamError(401, "Sign in first.");
  const r = await readTeam(store, id);
  if (!r || !roleIn(r.t, actor)) throw deny();
  const t = r.t;
  if (roleIn(t, actor) !== "admin") throw no("Only an admin can pay for the team.");
  const fromPilot = t.plan === "org" && t.pilot && t.billing && !t.billing.subscription;
  if (t.status !== "unpaid" && !fromPilot && !(t.status === "ended")) throw bad("This team has paid already.");
  if (t.plan === "pilot" && t.pilot) throw bad("A team has one pilot.");
  const taken = await store.get("launch", { type: "json" });
  const launch = launchOpen(t, taken), credit = creditOpen(t, now);
  const q = quote(t.plan, t.interval, t.seats, { launch, credit });
  if (!q) throw bad("The team's plan is not valid. Choose it again.");
  const items = q.lines.map((l) => {
    const p = prices[l.key];
    if (!p) throw new TeamError(503, "Payments for teams are not switched on yet.");
    return { price_id: p, quantity: l.qty };
  });
  let discount = null;
  if (q.discount) {
    const percent = q.discount.percent;
    discount = {
      description: "OSAP " + q.discount.parts.map((p) => (p.kind === "launch" ? "launch offer " + LAUNCH.percent + "% off year one" : "pilot credit")).join(" + ") + " (" + t.id.slice(5, 13) + ")",
      type: percent ? "percentage" : "flat", amount: String(percent || q.discount.cents), currency_code: percent ? undefined : "USD",
      recur: q.discount.recurIntervals > 1, maximum_recurring_intervals: q.discount.recurIntervals > 1 ? q.discount.recurIntervals : null,
      usage_limit: 1, enabled_for_checkout: false, restrict_to: items.map((i) => i.price_id),
    };
  }
  const custom_data = { osap_team: t.id, osap_plan: t.plan, ...(launch ? { osap_launch: "1" } : {}), ...(credit ? { osap_credit: "1" } : {}) };
  return { quote: q, items, discount, custom_data, currency_code: "USD" };
}

/**
 * A seat change on a paid Team or Organisation: the subscription items Paddle should hold. The webhook then sets the team's
 * seats from what Paddle says was agreed, so nothing changes here until it has been paid for.
 */
export async function seatsFor(store, actor, id, seats, prices) {
  if (!actor) throw new TeamError(401, "Sign in first.");
  const r = await readTeam(store, id);
  if (!r || !roleIn(r.t, actor)) throw deny();
  const t = r.t;
  if (roleIn(t, actor) !== "admin") throw no("Only an admin can change seats.");
  if (!(t.status === "active" || t.status === "past_due") || !t.billing || !t.billing.subscription) throw bad("Seats change once the team has paid.");
  if (t.plan === "pilot") throw bad("A pilot has " + BUSINESS.pilot.seats + " seats.");
  const q = checkPlan(t.plan, t.interval, seats);
  if (q.seats < used(t)) throw bad("The team has " + used(t) + " people and invites. Remove some first.");
  const items = q.lines.map((l) => { const p = prices[l.key]; if (!p) throw new TeamError(503, "Payments for teams are not switched on yet."); return { price_id: p, quantity: l.qty }; });
  return { subscription: t.billing.subscription, items, quote: q };
}

/**
 * A Paddle event for a team (tools/paddle.mjs teamEvent). Updates status, seats and the paid-through date, records the
 * decision as actor "paddle", and returns { team, seats: [{ uid, seat }] } for every member, or null when nothing changes
 * (another team's event, an older event, or the same event again).
 */
export async function applyBilling(store, e, now = Date.now()) {
  if (!e) return null;
  let id = e.team;
  if (!id || !TEAM_ID.test(id)) {
    const p = e.subscription ? await store.get("p/" + e.subscription, { type: "json" }) : null;
    id = p && p.team;
  }
  if (!id) return null;
  if (e.kind === "link") { // the subscription's own events may come without the team: remember whose it is
    if (e.subscription && (await readTeam(store, id).catch(() => null))) await store.setJSON("p/" + e.subscription, { team: id });
    return null;
  }
  for (let tries = 0; tries < 4; tries++) {
    const r = await readTeam(store, id).catch(() => null);
    if (!r) return null;
    const t = structuredClone(r.t), b = t.billing || {};
    if (e.event && b.event === e.event) return null; // delivered twice
    if (b.at && e.at && e.at < b.at) return null; // older than what is applied
    const before = { status: t.status, seats: t.seats, until: t.until };
    let detail;
    if (e.kind === "pilot") {
      if (t.pilot) return null;
      const ends = iso(Date.parse(e.at || iso(now)) + BUSINESS.pilot.days * DAY);
      t.pilot = { transaction: e.transaction, starts: e.at, ends, used: false };
      Object.assign(t, { status: "active", until: ends, seats: BUSINESS.pilot.seats });
      detail = { pilot: true, ends };
    } else if (e.kind === "subscription") {
      if (e.status === "active" || e.status === "trialing" || e.status === "past_due") {
        const end = e.periodEnds ? Date.parse(e.periodEnds) + SEAT_GRACE_DAYS * DAY : null;
        // a pilot that moved to Organisation keeps its seats open until the pilot ends, whichever is later
        const kept = before.status !== "ended" && before.until ? Date.parse(before.until) : 0;
        t.status = e.status === "past_due" ? "past_due" : "active";
        t.until = iso(Math.max(end || now, kept));
        if (e.plan && e.plan !== t.plan && BUSINESS[e.plan]) t.plan = e.plan;
        if (e.interval) t.interval = e.interval;
        if (e.seats) t.seats = e.seats;
        if (e.credit && t.pilot) t.pilot.used = true;
      } else {
        t.status = "ended";
        t.until = iso(Math.min(t.until ? Date.parse(t.until) : now, Date.parse(e.at || iso(now)) || now));
      }
      detail = { status: e.status, seats: t.seats };
    } else return null;
    t.billing = { ...b, event: e.event || null, at: e.at || b.at || null, status: e.status || b.status || null,
      subscription: e.subscription || b.subscription || null, transaction: e.transaction || b.transaction || null };
    const out = await commit(store, { uid: "paddle" }, r, t, { action: "billing", authority: "billing", target: { kind: "team", id: t.id }, detail: { ...detail, before }, now,
      after: [
        async () => { if (e.subscription) await store.setJSON("p/" + e.subscription, { team: t.id }); },
        async () => { if (e.transaction) await store.setJSON("p/" + e.transaction, { team: t.id }); },
        async () => { if (e.launch && t.launch && t.status !== "ended") await editList(store, "launch", (d) => { const l = (d && d.teams) || []; return l.includes(t.id) ? undefined : { teams: [...l, t.id] }; }); },
      ] });
    if (out) {
      const seat = seatOf(t, now), seats = Object.keys(t.members).map((uid) => ({ uid, seat }));
      seats.team = t.id;
      return { team: t.id, seats };
    }
  }
  return null;
}

/** Writes each account's seat into its Identity app_metadata.osap_seat (read afresh first, so a plan or code written a moment
    ago is kept). admin: @netlify/identity's admin API. Returns how many were written; a missing account is skipped. */
export async function writeSeats(admin, list) {
  let n = 0;
  for (const { uid, seat } of list || []) {
    try {
      const u = await admin.getUser(uid), m = (u && (u.appMetadata || u.app_metadata)) || {};
      const cur = m.osap_seat || null;
      if (JSON.stringify(cur) === JSON.stringify(seat)) continue;
      // a seat from another team is not taken away by this one's change
      if (!seat && cur && list.team && cur.team !== list.team) continue;
      await admin.updateUser(uid, { app_metadata: { ...m, osap_seat: seat } });
      n++;
    } catch (e) { /* the account is gone */ }
  }
  return n;
}
