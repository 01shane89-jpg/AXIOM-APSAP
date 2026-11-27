// Headline changes (Shane 27 Nov 2026, from the OSINT Framework comparison): when an outlet changes the headline of a story
// OSAP already holds, the old headline, the time OSAP last saw it and the time it first saw the new one are kept with the item
// in its history (tools/history.mjs), and tools/dense_edits.mjs lists the recent changes. Only the headlines and the link are
// kept, never the article text. A changed headline is often a normal update as a story develops (a live page, a toll that
// rose); it is recorded as a change, not as a finding that anything was hidden.
// Pure functions; no network.

// headlines that differ only in case, spacing, quotes, dashes or punctuation, or where one is the other cut short ("..."),
// are the same headline
export function norm(s) {
  return String(s || "").normalize("NFKC").toLowerCase().replace(/[‘’‚‛′'`"“”„«»]/g, "")
    .replace(/[‐-―\-]/g, " ").replace(/[.,;:!?()\[\]|/\\]/g, " ").replace(/\s+/g, " ").trim();
}
const cut = (s) => norm(String(s || "").replace(/\s*(\.\.\.|…)\s*$/, ""));
export function sameHeadline(a, b) {
  const x = norm(a), y = norm(b);
  if (x === y) return true;
  const tx = /(\.\.\.|…)\s*$/.test(String(a || "")), ty = /(\.\.\.|…)\s*$/.test(String(b || ""));
  if (tx && y.startsWith(cut(a))) return true;
  if (ty && x.startsWith(cut(b))) return true;
  return false;
}

// a change worth recording: the same outlet's own feed (not a search result), the same link, a different headline
export function isEdit(prev, cur) {
  if (!prev || !cur || !prev.title || !cur.title || prev.link !== cur.link) return false;
  if ((prev.outlet || "") !== (cur.outlet || "") || (prev.via || "") !== (cur.via || "")) return false;
  if (cur.via !== "RSS" && cur.via !== "web page") return false;
  return !sameHeadline(prev.title, cur.title);
}

// numbers and words that change what a headline says happened, when one headline has them and the other does not
const WORDS = ["killed", "dead", "dies", "died", "death", "deaths", "injured", "wounded", "missing", "hurt", "arrested", "charged", "indicted",
  "convicted", "acquitted", "guilty", "sentenced", "confirms", "confirmed", "denies", "denied", "says", "said", "claims", "alleged", "reportedly",
  "sources", "report", "reports", "suspected", "may", "could", "will", "won't", "not", "no", "attack", "strike", "explosion", "blast"];
const NUM = /\d[\d,.]*/g;
export function whatChanged(was, now) {
  const nums = (s) => [...new Set((String(s).match(NUM) || []).map((n) => n.replace(/[.,]$/, "")))];
  const a = nums(was), b = nums(now);
  const gone = a.filter((n) => !b.includes(n)), added = b.filter((n) => !a.includes(n));
  const w = (s) => new Set(norm(s).split(" "));
  const wa = w(was), wb = w(now);
  const wordsGone = WORDS.filter((x) => wa.has(x) && !wb.has(x)), wordsAdded = WORDS.filter((x) => wb.has(x) && !wa.has(x));
  const o = {};
  if (gone.length || added.length) o.numbers = { gone, added };
  if (wordsGone.length || wordsAdded.length) o.words = { gone: wordsGone, added: wordsAdded };
  return o;
}

export const MAX_EDITS = 6;
// the history item after this run: carries earlier changes and the time the current headline was first seen, and adds this
// run's change. prev and cur are the stored and the new item; stamp is this run's time.
export function carryEdits(prev, cur, stamp) {
  const out = {};
  const edits = Array.isArray(prev && prev.edits) ? prev.edits.slice(-MAX_EDITS) : [];
  if (isEdit(prev, cur)) {
    const e = { was: String(prev.title).slice(0, 400), from: prev.title_since || prev.first_seen || "", by: stamp };
    if (prev.title_en && prev.title_en !== prev.title) e.was_en = String(prev.title_en).slice(0, 400);
    edits.push(e);
    out.edits = edits.slice(-MAX_EDITS);
    out.title_since = stamp;
  } else {
    if (edits.length) out.edits = edits;
    if (prev && prev.title_since) out.title_since = prev.title_since;
  }
  return out;
}
