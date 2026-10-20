// Reviews of OSAP (Shane 2026-10-20: "Build a spot for reviews. And after a user has used it for a few weeks ask for a
// review"). A signed-in account leaves one review: 1 to 5 stars and a few words. It waits until the owner shows it; only
// shown reviews reach anyone else, with no name or email: the stars, the words and the date. Editing a review sends it back
// to wait. netlify/functions/osap-reviews.mjs keeps the records in the Netlify Blobs store "osap-reviews".
//   r/<hash of the account id>  one account's review: { id, uid, email, stars, text, made, edited, status }
//   public                      what everyone may read: the shown reviews, their count and average, rebuilt on each change
export const MAX_TEXT = 500;
export const MAX_REVIEWS = 5000;
export const MAX_PUBLIC = 60;
export const STATUSES = ["waiting", "shown", "hidden"];
const PFX = "r/";

/** The words as typed, with control characters gone and runs of spaces made one. */
export function cleanText(s) {
  return String(s == null ? "" : s).normalize("NFC").replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** Why the words cannot be shown to others, or "": no email addresses, phone numbers or links (no private details, no spam). */
export function privacyProblem(t) {
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(t)) return "Leave out email addresses.";
  // seven or more digits in a run (spaces, dashes, brackets or a dot between digits), once dates (2026-10-20) are taken out
  const runs = String(t).replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").match(/\+?\(?\d(?:[\d\s()-]|\.(?=\d)){5,}\d/g) || [];
  if (runs.some((r) => r.replace(/\D/g, "").length >= 7)) return "Leave out phone numbers.";
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|app|xyz|info|ru|cn|ly|gg|me|tv)\b/i.test(t)) return "Leave out links and web addresses.";
  return "";
}
/** The record's key: a hash of the account id, so one account has one review. */
export async function reviewId(uid) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("osap-review:" + String(uid))));
  return Array.from(h.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
function checkId(id) { if (!/^[0-9a-f]{32}$/.test(String(id))) throw new Error("No such review."); return String(id); }

/* store: Netlify Blobs (list() -> {blobs:[{key}]}, get(key, {type:"json"}), setJSON(key, value), delete(key)) */
async function records(store) {
  const { blobs } = await store.list();
  const keys = blobs.map((b) => b.key).filter((k) => k.indexOf(PFX) === 0);
  return (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);
}
/** What everyone may read: shown reviews newest first (at most MAX_PUBLIC with words), their count and average stars. */
export function publicOf(recs, now = Date.now()) {
  const shown = recs.filter((r) => r.status === "shown").sort((a, b) => String(b.edited).localeCompare(String(a.edited)));
  const sum = shown.reduce((s, r) => s + r.stars, 0);
  return {
    count: shown.length, average: shown.length ? Math.round((sum / shown.length) * 10) / 10 : null,
    stars: [1, 2, 3, 4, 5].map((n) => shown.filter((r) => r.stars === n).length),
    reviews: shown.filter((r) => r.text).slice(0, MAX_PUBLIC).map((r) => ({ stars: r.stars, text: r.text, date: String(r.edited).slice(0, 10) })),
    built: new Date(now).toISOString(),
  };
}
async function rebuild(store, now) { const pub = publicOf(await records(store), now); await store.setJSON("public", pub); return pub; }
export async function readPublic(store) {
  return (await store.get("public", { type: "json" })) || { count: 0, average: null, stars: [0, 0, 0, 0, 0], reviews: [], built: null };
}
/** The account's own review, as the account sees it. */
export function mineOf(r) { return r ? { stars: r.stars, text: r.text, status: r.status, edited: r.edited } : null; }
/** The owner's row: the email is there so the owner can tell reviews apart; it is never in the public copy. */
export function ownerRow(r) { return { id: r.id, email: r.email || "", stars: r.stars, text: r.text, status: r.status, made: r.made, edited: r.edited }; }

export async function getMine(store, user) { return store.get(PFX + (await reviewId(user.id)), { type: "json" }); }
/** Saves the account's review (new, or a change to its own), waiting for the owner. */
export async function saveReview(store, user, input, now = Date.now()) {
  const stars = Number(input && input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error("Pick 1 to 5 stars.");
  const raw = String((input && input.text) == null ? "" : input.text);
  if (raw.length > MAX_TEXT * 2) throw new Error("Keep it under " + MAX_TEXT + " characters.");
  const text = cleanText(raw);
  if (text.length > MAX_TEXT) throw new Error("Keep it under " + MAX_TEXT + " characters.");
  const why = privacyProblem(text); if (why) throw new Error(why);
  const id = await reviewId(user.id), key = PFX + id, old = await store.get(key, { type: "json" });
  if (!old) {
    const { blobs } = await store.list();
    if (blobs.length > MAX_REVIEWS) throw new Error("Reviews are full for now. Try again later.");
  } else if (now - (Date.parse(old.edited) || 0) < 30e3) throw new Error("You just saved your review. Wait a moment before changing it.");
  const at = new Date(now).toISOString();
  const rec = { id, uid: user.id, email: user.email || "", stars, text, made: old ? old.made : at, edited: at, status: "waiting" };
  await store.setJSON(key, rec);
  if (old && old.status === "shown") await rebuild(store, now); // a shown review changed: it leaves the public copy until shown again
  return rec;
}
/** Every review, waiting first, then newest first (owner only). */
export async function listAll(store) {
  const recs = await records(store), rank = { waiting: 0, shown: 1, hidden: 2 };
  return recs.sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.edited).localeCompare(String(a.edited)));
}
/** The owner shows or hides a review. */
export async function setStatus(store, id, status, now = Date.now()) {
  if (!STATUSES.includes(status)) throw new Error("Not a review status.");
  const key = PFX + checkId(id), rec = await store.get(key, { type: "json" });
  if (!rec) throw new Error("No such review.");
  const next = { ...rec, status };
  await store.setJSON(key, next);
  await rebuild(store, now);
  return next;
}
/** Deletes a review: the owner's any, an account its own. */
export async function removeReview(store, id, now = Date.now()) {
  const key = PFX + checkId(id), rec = await store.get(key, { type: "json" });
  if (!rec) throw new Error("No such review.");
  await store.delete(key);
  if (rec.status === "shown") await rebuild(store, now);
  return true;
}
