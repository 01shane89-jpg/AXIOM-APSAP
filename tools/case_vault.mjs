// Team shared cases, milestone 2 (server side): the sealed vault of a case. Shane 2026-10-23 picked "Server-checked, sealed
// cases": the server decides who may fetch a case's content (tools/cases.mjs roles), but it can never read that content.
//
// How the sealing works (the page does all of it, assets/osap-cases.js):
//   - Each device makes an ECDH P-256 key pair once. The private half never leaves the device; the public half is registered
//     here against the account (up to MAX_DEVICES per account).
//   - Each case has a random AES-256 case key per epoch. A lead's device wraps it for every member device (ECDH with a fresh
//     key, HKDF, AES-GCM) and uploads the wrapped copies. A member's device fetches its own wrapped copy and unwraps it.
//   - Content is cut into buckets and sealed with the case key on the device, then stored here as opaque base64.
//   - Removing a member raises the case's epoch (tools/cases.mjs). The next lead to open the case makes a new key for the new
//     epoch and wraps it only for the members left; content written after that is sealed under the new key.
// What this file checks, on every request, from the signed-in account: the account is a member of the case (else 404, as for
// a case that does not exist); writing content needs analyst or lead; handing out keys needs lead and only for devices of
// current members; sizes and formats. It never opens, parses or logs the sealed bytes.
//
// Records in the Netlify Blobs store "osap-cases" (next to the case records):
//   k/<hash of account id>        the account's devices: [{ id, pub, at }]
//   w/<case>/<epoch>/<device>     a case key wrapped for one device: { wrap, by, at }
//   s/<case>/<bucket>             one sealed bucket: { epoch, data, rev, by, at }
import { readCase, roleIn, can, deny, CaseError } from "./cases.mjs";

export const MAX_DEVICES = 5, BUCKETS = 24, MAX_BUCKET = 200000, MAX_TOTAL = 2000000;
const DEV_ID = /^[a-f0-9]{16,32}$/;
const PUB = /^[A-Za-z0-9_-]{87}$/; // a raw uncompressed P-256 point, 65 bytes, base64url without padding
const WRAP = /^[A-Za-z0-9_-]{40,400}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const no = (m) => new CaseError(403, m);
const bad = (m) => new CaseError(400, m);

async function hash(s) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
const kKey = async (uid) => "k/" + (await hash("osap-case-k:" + uid));
const wKey = (id, epoch, dev) => "w/" + id + "/" + epoch + "/" + dev;
const sKey = (id, b) => "s/" + id + "/" + String(b).padStart(2, "0");

async function devicesOf(store, uid) {
  const r = await store.get(await kKey(uid), { type: "json" });
  return (r && Array.isArray(r.devices) ? r.devices : []).filter((d) => d && DEV_ID.test(d.id) && PUB.test(d.pub));
}
async function member(store, actor, id) {
  if (!actor) throw new CaseError(401, "Sign in first.");
  const r = await readCase(store, id);
  const role = r && roleIn(r.c, actor);
  if (!role) throw deny();
  return { c: r.c, role };
}

/** Registers this device's public key on the account (the same device id again replaces its key). */
export async function addDevice(store, actor, dev, now = Date.now()) {
  if (!actor) throw new CaseError(401, "Sign in first.");
  if (!dev || !DEV_ID.test(String(dev.id)) || !PUB.test(String(dev.pub))) throw bad("That device key is not valid.");
  const key = await kKey(actor.uid);
  for (let i = 0; i < 4; i++) {
    const r = await store.getWithMetadata(key, { type: "json" });
    const list = (r && r.data && Array.isArray(r.data.devices) ? r.data.devices : []).filter((d) => d.id !== dev.id);
    if (list.length >= MAX_DEVICES) throw bad("This account has " + MAX_DEVICES + " devices for team cases. Remove one in Settings first.");
    list.push({ id: dev.id, pub: dev.pub, at: new Date(now).toISOString() });
    const w = await store.setJSON(key, { devices: list }, r ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
    if (w.modified !== false) return { devices: list.map((d) => ({ id: d.id, at: d.at })) };
  }
  throw new CaseError(409, "Try again.");
}
/** Removes one of the account's own devices; its wrapped keys stop being served. */
export async function dropDevice(store, actor, devId) {
  if (!actor) throw new CaseError(401, "Sign in first.");
  const key = await kKey(actor.uid);
  for (let i = 0; i < 4; i++) {
    const r = await store.getWithMetadata(key, { type: "json" });
    if (!r || !r.data) return { devices: [] };
    const list = (r.data.devices || []).filter((d) => d.id !== String(devId));
    const w = await store.setJSON(key, { devices: list }, { onlyIfMatch: r.etag });
    if (w.modified !== false) return { devices: list.map((d) => ({ id: d.id, at: d.at })) };
  }
  throw new CaseError(409, "Try again.");
}

/** What a member's device needs to open a case: the epoch, its own wrapped keys (every epoch it was given), and, for a lead,
    the member devices that still lack a wrapped key for the current epoch. */
export async function keysFor(store, actor, id, devId) {
  const { c, role } = await member(store, actor, id);
  const epoch = c.epoch || 1;
  const mine = await devicesOf(store, actor.uid);
  if (!mine.some((d) => d.id === devId)) throw bad("Register this device first.");
  const wraps = [];
  for (let e = epoch; e >= 1; e--) {
    const w = await store.get(wKey(c.id, e, devId), { type: "json" });
    if (w) wraps.push({ epoch: e, wrap: w.wrap });
  }
  const out = { epoch, role, wraps };
  if (can.manage(role)) {
    out.need = [];
    for (const uid of Object.keys(c.members)) {
      for (const d of await devicesOf(store, uid)) {
        if (!(await store.get(wKey(c.id, epoch, d.id), { type: "json" }))) out.need.push({ uid, device: d.id, pub: d.pub });
      }
    }
  }
  return out;
}

/** A lead hands the case key of the current epoch to member devices. Each target must be a device of a current member. */
export async function putWraps(store, actor, id, epoch, wraps, now = Date.now()) {
  const { c, role } = await member(store, actor, id);
  if (!can.manage(role)) throw no("Only a lead can hand out the case key.");
  if (Number(epoch) !== (c.epoch || 1)) throw new CaseError(409, "The case key changed. Reload and try again.");
  if (!Array.isArray(wraps) || !wraps.length || wraps.length > 60) throw bad("Nothing to hand out.");
  const allowed = new Map();
  for (const uid of Object.keys(c.members)) for (const d of await devicesOf(store, uid)) allowed.set(d.id, uid);
  let n = 0;
  for (const w of wraps) {
    if (!w || !allowed.has(String(w.device)) || !WRAP.test(String(w.wrap))) throw bad("A key can only go to a member's registered device.");
  }
  for (const w of wraps) {
    // written once per device and epoch: a key handed out is never swapped for another one
    const r = await store.setJSON(wKey(c.id, c.epoch || 1, w.device), { wrap: w.wrap, by: actor.uid, at: new Date(now).toISOString() }, { onlyIfNew: true });
    if (r.modified !== false) n++;
  }
  return { stored: n };
}

/** Every sealed bucket of a case (members). */
export async function readData(store, actor, id) {
  const { c } = await member(store, actor, id);
  const out = [];
  for (let b = 0; b < BUCKETS; b++) {
    const r = await store.get(sKey(c.id, b), { type: "json" });
    if (r) out.push({ bucket: b, epoch: r.epoch, data: r.data, rev: r.rev, at: r.at });
  }
  return { epoch: c.epoch || 1, buckets: out };
}

/** Writes sealed buckets (analyst or lead). rev must match the stored one (0 for a new bucket), so two devices writing at
    once cannot overwrite each other: the second gets 409, reads again, merges and writes again. */
export async function writeData(store, actor, id, buckets, now = Date.now()) {
  const { c, role } = await member(store, actor, id);
  if (!can.addWork(role)) throw no("Viewers can read the case but not change it.");
  const epoch = c.epoch || 1;
  if (!Array.isArray(buckets) || !buckets.length || buckets.length > BUCKETS) throw bad("Nothing to save.");
  const seen = new Set();
  for (const x of buckets) {
    const b = Number(x && x.bucket);
    if (!Number.isInteger(b) || b < 0 || b >= BUCKETS || seen.has(b)) throw bad("Bad bucket.");
    seen.add(b);
    if (Number(x.epoch) !== epoch) throw new CaseError(409, "The case key changed. Reload and try again.");
    if (typeof x.data !== "string" || x.data.length > MAX_BUCKET || !B64.test(x.data)) throw bad("A sealed bucket is too large or not sealed.");
  }
  // the whole case stays under MAX_TOTAL
  let total = 0;
  const cur = {};
  for (let b = 0; b < BUCKETS; b++) {
    const r = await store.getWithMetadata(sKey(c.id, b), { type: "json" });
    cur[b] = r;
    total += seen.has(b) ? 0 : (r && r.data ? r.data.data.length : 0);
  }
  for (const x of buckets) total += x.data.length;
  if (total > MAX_TOTAL) throw new CaseError(413, "This case is full (about 2 MB sealed). Remove some items first.");
  const done = [];
  for (const x of buckets) {
    const b = Number(x.bucket), r = cur[b], rev = r && r.data ? r.data.rev : 0;
    if (Number(x.rev || 0) !== rev) throw new CaseError(409, "Someone else saved this case a moment ago. Reloading and merging.");
    const w = await store.setJSON(sKey(c.id, b), { epoch, data: x.data, rev: rev + 1, by: actor.uid, at: new Date(now).toISOString() },
      r ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
    if (w.modified === false) throw new CaseError(409, "Someone else saved this case a moment ago. Reloading and merging.");
    done.push({ bucket: b, rev: rev + 1 });
  }
  return { saved: done };
}
