// Team shared cases, milestone 1: the case registry and its roles (thread "Team shared cases", proposal 2026-10-23).
// A case is a named piece of team work. Who may open it, and what each person may do in it, is decided here, on the server,
// for every request: netlify/functions/osap-cases.mjs passes in the signed-in account, never anything the page says about
// itself. Case content is not kept here (milestone 2 seals it on members' devices); this file holds names, members and roles.
//
// Roles belong to a person in one case, not to the account:
//   lead     read; invite, remove, change roles, rename; approve or reject items in the case
//   analyst  read; add their own work (it stays a proposal until a lead approves it)
//   viewer   read only
// Deny by default: anyone not a member of a case gets "No such case." (404), the same answer as for a case that does not exist,
// so a stranger cannot learn whether a case id is real. Nothing lists every case, and no request reads across cases. The OSAP
// owner gets no special access to cases either.
//
// Every change is a command that writes one decision record: who did it, in which role, to what, why, the case version before
// and after, and when. A command carries an op id from the page; sending the same op again changes nothing and gets the same
// answer (a page that retries after a dropped connection does not invite someone twice).
//
// Records in the Netlify Blobs store "osap-cases":
//   c/<case id>                 the case: name, members (by account id) with role and call sign, open invites (by email), version,
//                               and "last", the decision record that made this version, written in the same single write
//   l/<case id>/<version>       each decision record's own copy, append-only, written once after the case write
//   o/<hash of account + op>    an op already done: { case, version }
//   u/<hash of account id>      the cases an account belongs to   } lookups only, rebuilt from the case records when they drift;
//   i/<hash of email>           the cases an email is invited to  } who may do what is always read from c/<case id>
// Emails are shown only to the case's leads; everyone else sees call signs and roles. Nothing here is logged with an email.
export const SCHEMA = "osap-case/1";
export const DECISION = "osap-case-decision/1";
export const ROLES = ["viewer", "analyst", "lead"];
export const MAX_MEMBERS = 50; // members and open invites together
export const MAX_CASES = 50; // cases one account may belong to
export const NAME_MAX = 60, CALL_MAX = 24, REASON_MAX = 300, LOG_MAX = 200;
export const MAX_ITEMS = 5000; // item decisions a case keeps in its record
const ITEM_ID = /^[0-9a-f]{32}$/, ITEM_FP = /^[0-9a-f]{16,64}$/, SEALED = /^[A-Za-z0-9+/]{20,1600}={0,2}$/;

export class CaseError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const deny = () => new CaseError(404, "No such case.");
const no = (m) => new CaseError(403, m);
const bad = (m) => new CaseError(400, m);

const rank = (r) => ROLES.indexOf(r);
export const can = {
  read: (r) => rank(r) >= 0,
  addWork: (r) => rank(r) >= rank("analyst"),
  manage: (r) => r === "lead",
};

// control, zero-width and direction characters (built from code points so the file stays plain ASCII)
const JUNK = new RegExp("[" + [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]].map(([a, z]) => String.fromCharCode(a) + "-" + String.fromCharCode(z)).join("") + "]+", "g");
function clean(s, n) {
  return String(s == null ? "" : s).normalize("NFC").replace(JUNK, " ").replace(/\s+/g, " ").trim().slice(0, n);
}
export function cleanName(s) { return clean(s, NAME_MAX); }
/** a call sign: free text up to 24 characters, never an email address (the same rule as the Team workspace) */
export function cleanCall(s) { const c = clean(s, 60); return /@/.test(c) ? "" : c.slice(0, CALL_MAX).trim(); }
export function cleanEmail(s) {
  const e = String(s == null ? "" : s).trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(e) ? e : "";
}
async function hash(s) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
function newId() {
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b);
  return "case-" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
const CASE_ID = /^case-[0-9a-f]{32}$/, OP_ID = /^[A-Za-z0-9_-]{8,64}$/;
function caseKey(id) { if (!CASE_ID.test(String(id))) throw deny(); return "c/" + id; }
const logKey = (id, v) => "l/" + id + "/" + String(v).padStart(8, "0");

/** The account a request comes from, as the function read it from Netlify Identity. Only a confirmed email counts. */
export function actorOf(u) {
  if (!u || !u.id) return null;
  return { uid: String(u.id), email: (u.confirmed_at || u.confirmedAt) ? cleanEmail(u.email) : "" };
}

/* ---------- store helpers: Netlify Blobs (get, getWithMetadata, setJSON with onlyIfNew / onlyIfMatch, delete) ---------- */
export async function readCase(store, id) {
  const r = await store.getWithMetadata(caseKey(id), { type: "json" });
  return r && r.data ? { c: r.data, etag: r.etag } : null;
}
async function addTo(store, key, id) {
  for (let i = 0; i < 4; i++) {
    const r = await store.getWithMetadata(key, { type: "json" });
    const list = (r && r.data && Array.isArray(r.data.cases) ? r.data.cases : []).filter((x) => x !== id);
    list.push(id);
    const w = await store.setJSON(key, { cases: list.slice(-200) }, r ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
    if (w.modified !== false) return;
  }
}
async function dropFrom(store, key, id) {
  for (let i = 0; i < 4; i++) {
    const r = await store.getWithMetadata(key, { type: "json" });
    if (!r || !r.data || !(r.data.cases || []).includes(id)) return;
    const w = await store.setJSON(key, { cases: r.data.cases.filter((x) => x !== id) }, { onlyIfMatch: r.etag });
    if (w.modified !== false) return;
  }
}
const uKey = async (uid) => "u/" + (await hash("osap-case-u:" + uid));
const iKey = async (email) => "i/" + (await hash("osap-case-i:" + email));

/** The role an account holds in a case, or null. */
export function roleIn(c, actor) {
  const m = c && actor && c.members && Object.prototype.hasOwnProperty.call(c.members, actor.uid) ? c.members[actor.uid] : null;
  return m && can.read(m.role) ? m.role : null;
}
const leads = (c) => Object.values(c.members).filter((m) => m.role === "lead").length;

/** What a member may see of a case: leads see emails and open invites; everyone else, call signs and roles. */
export function viewOf(c, actor) {
  const role = roleIn(c, actor), lead = role === "lead";
  return {
    id: c.id, name: c.name, created: c.created, version: c.version, epoch: c.epoch || 1, role,
    members: Object.entries(c.members).map(([uid, m]) => ({ uid, role: m.role, call: m.call || "", since: m.since, me: uid === actor.uid, ...(lead ? { email: m.email || "" } : {}) })),
    invites: lead ? Object.values(c.invites || {}).map((v) => ({ email: v.email, role: v.role, at: v.at })) : undefined,
    items: c.items || {},
  };
}

/** Reads a case for a member. Non-members, bad ids and missing cases all get the same 404. */
export async function getCase(store, actor, id) {
  if (!actor) throw new CaseError(401, "Sign in first.");
  const r = await readCase(store, id);
  if (!r || !roleIn(r.c, actor)) throw deny();
  return viewOf(r.c, actor);
}

/** The cases an account is in, and the invites waiting for its confirmed email. Each entry is checked against its case record. */
export async function listMine(store, actor) {
  if (!actor) throw new CaseError(401, "Sign in first.");
  const out = { cases: [], invites: [] };
  const mine = await store.get(await uKey(actor.uid), { type: "json" });
  for (const id of (mine && mine.cases) || []) {
    const r = await readCase(store, id).catch(() => null);
    const role = r && roleIn(r.c, actor);
    if (role) out.cases.push({ id, name: r.c.name, role, members: Object.keys(r.c.members).length, version: r.c.version });
  }
  if (actor.email) {
    const inv = await store.get(await iKey(actor.email), { type: "json" });
    for (const id of (inv && inv.cases) || []) {
      const r = await readCase(store, id).catch(() => null);
      const v = r && (r.c.invites || {})[await hash("osap-case-i:" + actor.email)];
      if (v && !roleIn(r.c, actor)) out.invites.push({ id, name: r.c.name, role: v.role, at: v.at });
    }
  }
  return out;
}

/** The decision records of a case, newest first (members only). */
export async function readLog(store, actor, id, limit = 100) {
  if (!actor) throw new CaseError(401, "Sign in first.");
  const r = await readCase(store, id);
  if (!r || !roleIn(r.c, actor)) throw deny();
  const c = r.c;
  if (c.last) await flush(store, c.last);
  const n = Math.min(Math.max(1, limit | 0), LOG_MAX), out = [];
  for (let v = c.version; v >= 1 && out.length < n; v--) {
    const d = await store.get(logKey(id, v), { type: "json" });
    if (d) out.push(d);
  }
  return out;
}

/* ---------- commands ---------- */
// Each returns { view, decision }. The page sends { cmd, op, case?, ... }; plan: the actor's OSAP plan, for "create".
export async function run(store, actor, body, opts = {}) {
  if (!actor) throw new CaseError(401, "Sign in first.");
  const b = body && typeof body === "object" ? body : {};
  const op = String(b.op || "");
  if (!OP_ID.test(op)) throw bad("Each change needs an op id.");
  const now = opts.now || Date.now();
  const opKey = "o/" + (await hash("osap-case-o:" + actor.uid + ":" + op));
  const done = await store.get(opKey, { type: "json" });
  if (done) { // the same op again: nothing changes; answer with the case as it is now, if still a member
    const r = await readCase(store, done.case).catch(() => null);
    const decision = await store.get(logKey(done.case, done.version), { type: "json" });
    return { view: r && roleIn(r.c, actor) ? viewOf(r.c, actor) : null, decision, repeat: true };
  }
  const reason = clean(b.reason, REASON_MAX);

  if (b.cmd === "create") {
    if (opts.plan !== "full") throw no("Creating a team case needs the Full plan.");
    const name = cleanName(b.name);
    if (!name) throw bad("Give the case a name.");
    const mine = await store.get(await uKey(actor.uid), { type: "json" });
    if (((mine && mine.cases) || []).length >= MAX_CASES) throw bad("You are in " + MAX_CASES + " cases already. Leave one first.");
    const id = newId();
    const c = { schema: SCHEMA, id, name, created: new Date(now).toISOString(), by: actor.uid, version: 0, epoch: 1, members: {}, invites: {} };
    c.members[actor.uid] = { role: "lead", call: cleanCall(b.call), email: actor.email, since: c.created, by: actor.uid };
    return commit(store, actor, null, c, { action: "create", target: { kind: "case", id }, detail: { name }, reason, op, opKey, now, after: [async () => addTo(store, await uKey(actor.uid), id)] });
  }

  // every other command acts on one case the actor can see
  for (let tries = 0; tries < 4; tries++) {
    const r = await readCase(store, b.case);
    const role = r && roleIn(r.c, actor);
    const invited = r && actor.email ? (r.c.invites || {})[await hash("osap-case-i:" + actor.email)] : null;
    if (!r || (!role && !(b.cmd === "accept" || b.cmd === "decline") ) || (!role && !invited)) throw deny();
    const c = structuredClone(r.c), ifv = b.version == null ? null : Number(b.version);
    if (ifv != null && ifv !== c.version) throw new CaseError(409, "This case changed since you opened it. Reload and try again.");
    let step;
    switch (b.cmd) {
      case "rename": {
        if (!can.manage(role)) throw no("Only a lead can rename the case.");
        const name = cleanName(b.name);
        if (!name) throw bad("Give the case a name.");
        c.name = name;
        step = { action: "rename", target: { kind: "case", id: c.id }, detail: { name } };
        break;
      }
      case "invite": {
        if (!can.manage(role)) throw no("Only a lead can invite.");
        const email = cleanEmail(b.email), to = String(b.role || "");
        if (!email) throw bad("That is not an email address.");
        if (rank(to) < 0) throw bad("The role must be lead, analyst or viewer.");
        if (Object.values(c.members).some((m) => m.email && m.email === email)) throw bad("That account is already a member.");
        const eh = await hash("osap-case-i:" + email);
        if (Object.keys(c.members).length + Object.keys(c.invites || {}).length - (c.invites[eh] ? 1 : 0) >= MAX_MEMBERS) throw bad("A case holds up to " + MAX_MEMBERS + " people.");
        c.invites[eh] = { email, role: to, at: new Date(now).toISOString(), by: actor.uid };
        step = { action: "invite", target: { kind: "invite", id: eh }, detail: { role: to }, after: [async () => addTo(store, await iKey(email), c.id)] };
        break;
      }
      case "uninvite": {
        if (!can.manage(role)) throw no("Only a lead can cancel an invite.");
        const email = cleanEmail(b.email), eh = email && (await hash("osap-case-i:" + email));
        if (!eh || !c.invites[eh]) throw bad("No open invite for that email.");
        delete c.invites[eh];
        step = { action: "uninvite", target: { kind: "invite", id: eh }, detail: {}, after: [async () => dropFrom(store, await iKey(email), c.id)] };
        break;
      }
      case "accept":
      case "decline": {
        if (role) throw bad("You are already a member.");
        const eh = await hash("osap-case-i:" + actor.email);
        delete c.invites[eh];
        if (b.cmd === "accept") {
          const mine = await store.get(await uKey(actor.uid), { type: "json" });
          if (((mine && mine.cases) || []).length >= MAX_CASES) throw bad("You are in " + MAX_CASES + " cases already. Leave one first.");
          c.members[actor.uid] = { role: invited.role, call: cleanCall(b.call), email: actor.email, since: new Date(now).toISOString(), by: invited.by };
        }
        step = { action: b.cmd, target: { kind: "member", id: actor.uid }, detail: b.cmd === "accept" ? { role: invited.role } : {},
          after: [async () => dropFrom(store, await iKey(actor.email), c.id), ...(b.cmd === "accept" ? [async () => addTo(store, await uKey(actor.uid), c.id)] : [])] };
        break;
      }
      case "approve":
      case "reject": {
        // a lead's judgement on one item of the case (milestone 3). The item itself is sealed; the server sees only an opaque id,
        // a fingerprint of the item's content as approved (an edit after that shows as changed on members' devices) and,
        // optionally, the reason sealed with the case key. Analysts, viewers and anything acting for them cannot do this.
        if (!can.manage(role)) throw no("Only a lead can approve or reject.");
        const t = b.target || {}, id = String(t.id || ""), fp = String(t.fp || "");
        if (!ITEM_ID.test(id) || !ITEM_FP.test(fp)) throw bad("That item reference is not valid.");
        if (b.sreason != null && !SEALED.test(String(b.sreason))) throw bad("The reason must be sealed with the case key.");
        c.items = c.items || {};
        if (!c.items[id] && Object.keys(c.items).length >= MAX_ITEMS) throw bad("This case holds " + MAX_ITEMS + " decisions on items already.");
        const state = b.cmd === "approve" ? "approved" : "rejected";
        c.items[id] = { state, fp, by: actor.uid, at: new Date(now).toISOString(), version: c.version + 1, ...(b.sreason ? { sreason: String(b.sreason) } : {}) };
        step = { action: b.cmd, target: { kind: "item", id, fp }, detail: { state, ...(b.sreason ? { sreason: String(b.sreason) } : {}) } };
        break;
      }
      case "call": {
        c.members[actor.uid].call = cleanCall(b.call);
        step = { action: "call", target: { kind: "member", id: actor.uid }, detail: { call: c.members[actor.uid].call } };
        break;
      }
      case "role": {
        if (!can.manage(role)) throw no("Only a lead can change roles.");
        const uid = String(b.member || ""), to = String(b.role || "");
        if (!Object.prototype.hasOwnProperty.call(c.members, uid)) throw bad("That person is not a member.");
        if (rank(to) < 0) throw bad("The role must be lead, analyst or viewer.");
        const from = c.members[uid].role;
        if (from === to) throw bad("They already have that role.");
        if (from === "lead" && leads(c) === 1) throw bad("A case needs at least one lead. Make someone else lead first.");
        c.members[uid].role = to;
        step = { action: "role", target: { kind: "member", id: uid }, detail: { from, to } };
        break;
      }
      case "remove":
      case "leave": {
        const uid = b.cmd === "leave" ? actor.uid : String(b.member || "");
        if (b.cmd === "remove" && !can.manage(role)) throw no("Only a lead can remove someone.");
        if (!Object.prototype.hasOwnProperty.call(c.members, uid)) throw bad("That person is not a member.");
        const from = c.members[uid].role;
        if (from === "lead" && leads(c) === 1 && Object.keys(c.members).length > 1) throw bad("A case needs at least one lead. Make someone else lead first.");
        delete c.members[uid];
        c.epoch = (c.epoch || 1) + 1; // content added from now on is sealed under a key the removed person never had
        step = { action: b.cmd, target: { kind: "member", id: uid }, detail: { role: from }, after: [async () => dropFrom(store, await uKey(uid), c.id)] };
        break;
      }
      default:
        throw bad("Unknown command.");
    }
    const out = await commit(store, actor, r, c, { ...step, reason, op, opKey, now, authority: role || "invitee" });
    if (out) return out;
    // someone else changed the case at the same moment: read it again and redo the checks
  }
  throw new CaseError(409, "This case is busy. Try again.");
}

/** Writes the new case version with its decision record inside it, in one write (the case record is its own outbox), then
    copies the record to l/<case>/<version>. A copy missed by a crash is written by the next change, or when the log is read.
    Returns null when the case changed underneath (the caller reads it again and redoes the checks). */
async function commit(store, actor, prev, c, s) {
  if (prev && prev.c.last) await flush(store, prev.c.last);
  const version = (prev ? prev.c.version : 0) + 1;
  c.version = version;
  c.updated = new Date(s.now).toISOString();
  const decision = {
    schema: DECISION, id: c.id + ":" + version, case: c.id, action: s.action,
    actor: actor.uid, authority: s.authority || "lead", target: s.target, detail: s.detail || {}, reason: s.reason || "",
    prev: version - 1, version, at: c.updated, op: s.op,
  };
  c.last = decision;
  const cw = await store.setJSON(caseKey(c.id), c, prev ? { onlyIfMatch: prev.etag } : { onlyIfNew: true });
  if (cw.modified === false) return null;
  await flush(store, decision);
  await store.setJSON(s.opKey, { case: c.id, version });
  for (const f of s.after || []) await f().catch(() => {});
  return { view: roleIn(c, actor) ? viewOf(c, actor) : null, decision };
}
/** the decision record's own copy, written once */
async function flush(store, d) { await store.setJSON(logKey(d.case, d.version), d, { onlyIfNew: true }); }
