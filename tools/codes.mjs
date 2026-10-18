// Beta tester codes (Shane 2026-10-18: "I need full unlock access codes for my beta testers"). The owner makes a code in
// Settings > Users; a signed-in account that enters it gets Full until the code's end date or until the owner turns it off.
// Each code works once. Only a hash of the code is stored (netlify/functions/osap-codes.mjs keeps the records in Netlify
// Blobs), so the store never holds a usable code, and nothing about codes is in the public repo. The grant is
// app_metadata.osap_beta on the account, which tools/owner.mjs planOf() reads; the Paddle webhook keeps it (tools/paddle.mjs).
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 letters and digits, without 0/O and 1/I, so a code reads out loud
export const MAX_CODES = 500;
const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** A new code, OSAP-XXXX-XXXX-XXXX: 12 random characters, 60 bits. */
export function newCode(rand = rnd) {
  let s = "";
  for (const x of rand(12)) s += ALPHA[x & 31];
  return "OSAP-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}
/** The code as typed, without dashes, spaces, case or the OSAP- prefix. */
export function normalise(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^OSAP(?=[A-Z0-9]{12}$)/, "");
}
/** The record's key: the code's SHA-256, never the code itself. */
export async function codeId(code) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("osap-code:" + normalise(code))));
  return Array.from(h.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** A beta grant that is still on. */
export function betaActive(meta, now = Date.now()) {
  const b = meta && meta.osap_beta;
  return !!(b && b.id && (!b.until || Date.parse(b.until) > now));
}
/** The end date the owner typed (YYYY-MM-DD, end of that day Zulu), or null for no end. Refuses the past and over 2 years. */
export function endOf(day, now = Date.now()) {
  if (day == null || day === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error("The end date is not a date.");
  const t = Date.parse(day + "T23:59:59Z");
  if (!(t > now)) throw new Error("The end date has passed.");
  if (t > now + 731 * 864e5) throw new Error("Pick an end date within two years.");
  return new Date(t).toISOString();
}

/* store: { getWithMetadata(key, {type:"json"}) -> {data, etag} | null, setJSON(key, value, {onlyIfNew|onlyIfMatch}) ->
   {modified}, list() -> {blobs: [{key}]}, get(key, {type:"json"}) } (Netlify Blobs) */

/** Makes a code. Returns the code (shown to the owner once) and its record. */
export async function makeCode(store, { note, until }, now = Date.now(), rand = rnd) {
  const { blobs } = await store.list();
  if (blobs.length >= MAX_CODES) throw new Error("There are already " + MAX_CODES + " codes. Turn off old ones first.");
  const code = newCode(rand), id = await codeId(code);
  const rec = { id, note: String(note || "").trim().slice(0, 80), last4: code.slice(-4), made: new Date(now).toISOString(), until: endOf(until, now), usedBy: null, usedAt: null, off: false };
  const r = await store.setJSON(id, rec, { onlyIfNew: true });
  if (r && r.modified === false) throw new Error("Try again.");
  return { code, rec };
}
/** Every code's record, newest first. */
export async function listCodes(store) {
  const { blobs } = await store.list();
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return recs.filter(Boolean).sort((a, b) => String(b.made).localeCompare(String(a.made)));
}
/** Uses a code for an account. The same answer for a code that never existed, was used, was turned off or has ended, so a
    guess learns nothing. Single use holds under two tries at once: the write only lands on the record as it was read. */
export async function redeemCode(store, code, user, now = Date.now()) {
  const bad = new Error("That code is not valid, or it was already used.");
  if (normalise(code).length !== 12) throw bad;
  const id = await codeId(code), got = await store.getWithMetadata(id, { type: "json" });
  const rec = got && got.data;
  if (!rec || rec.off || rec.usedBy || (rec.until && Date.parse(rec.until) <= now)) throw bad;
  const next = { ...rec, usedBy: { uid: user.id, email: user.email || "" }, usedAt: new Date(now).toISOString() };
  const r = await store.setJSON(id, next, got.etag ? { onlyIfMatch: got.etag } : {});
  if (r && r.modified === false) throw bad;
  return next;
}
/** Turns a code off. Returns the record, so the caller can take Full away from the account that used it. */
export async function revokeCode(store, id) {
  if (!/^[0-9a-f]{32}$/.test(String(id))) throw new Error("No such code.");
  const rec = await store.get(id, { type: "json" });
  if (!rec) throw new Error("No such code.");
  const next = { ...rec, off: true };
  await store.setJSON(id, next);
  return next;
}
/** A record as the owner's list shows it: the note, the code's last four characters, dates and who used it. */
export function codeRow(rec, now = Date.now()) {
  const state = rec.off ? "off" : rec.until && Date.parse(rec.until) <= now ? "ended" : rec.usedBy ? "in use" : "not used yet";
  return { id: rec.id, note: rec.note || "", last4: rec.last4 || "", made: rec.made, until: rec.until, usedBy: rec.usedBy ? rec.usedBy.email : null, usedAt: rec.usedAt, state };
}
