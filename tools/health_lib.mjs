// Data health rules, shared by tools/health.mjs (build + watch) and tests/health.test.mjs. No network, no files.
//
// data/live/health.json (written by each refresh on main):
//   { v: 1, asof: ISO time of the refresh, run: Actions run URL,
//     feeds: [{ id, name, key, maxMin, asof: ISO or null, src: { ok, fail, failing: [names] } (when the file lists sources) }] }
// evaluate() turns that into what the app badge shows and what the keeper alerts on.

// "2026-09-28 13:12Z", "2026-09-28T13:12:00Z" -> ms; anything else -> null
export function parseStamp(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d(?:\.\d+)?)?)(Z|[+-]\d\d:?\d\d)?$/.exec(s.trim());
  if (!m) return null;
  const t = Date.parse(m[1] + "T" + m[2] + (m[3] || "Z"));
  return Number.isFinite(t) ? t : null;
}

// the first stamp field in a data file's text ("asof" unless the feed names another), read from the start only
export function stampOf(text, field = "asof") {
  const m = new RegExp('"' + field + '":"([^"]+)"').exec(text.slice(0, 4000));
  const t = m && parseStamp(m[1]);
  return t ? new Date(t).toISOString() : null;
}

// sources the file says it read: a "sources" or "feeds" list (array or object) whose entries carry ok: true/false
export function sourcesOf(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of ["sources", "feeds"]) {
    let v = obj[k];
    if (v && !Array.isArray(v) && typeof v === "object") v = Object.values(v);
    if (!Array.isArray(v)) continue;
    const withOk = v.filter((s) => s && typeof s === "object" && typeof s.ok === "boolean");
    if (!withOk.length) continue;
    const bad = withOk.filter((s) => !s.ok);
    return { ok: withOk.length - bad.length, fail: bad.length, failing: bad.slice(0, 8).map((s) => String(s.source || s.name || s.id || "?").slice(0, 60)) };
  }
  return null;
}

const mins = (ms) => Math.round(ms / 60000);

// -> { state: "ok" | "amber" | "down", ageMin, problems: [{ id, name, why, key }], alerts: [lines], fp }
// A key feed that is stale, empty or mostly failing, or no refresh at all for downMin, makes it "down" (and alerts the keeper).
// Anything else wrong is "amber". What app readers see is ev.ui (userView below), which is milder.
export function evaluate(health, cfg, now = Date.now()) {
  const amberMin = cfg.amberMin || 40, downMin = cfg.downMin || 60;
  const at = health && parseStamp(health.asof);
  if (!at) return { state: "down", ageMin: null, problems: [{ id: "health", name: "Data health file", why: "missing or unreadable", key: true }], alerts: ["The data health file is missing or unreadable."], fp: "nohealth",
    ui: { state: "down", line: "The data health file is missing or unreadable.", short: "" } };
  const ageMin = mins(now - at);
  const problems = [];
  // when nothing is refreshing, feeds are judged as of the last refresh (what was already wrong then), not all listed as stale
  const ref = ageMin > downMin ? at : now;
  for (const f of health.feeds || []) {
    const t = parseStamp(f.asof), max = f.maxMin || cfg.defaultMaxMin || 120;
    let why = null;
    if (!t) why = "no data";
    else if (ref - t > max * 60000) why = "last updated " + ago(now - t);
    else if (f.src && f.src.ok + f.src.fail >= 4 && f.src.fail > f.src.ok) why = f.src.fail + " of " + (f.src.ok + f.src.fail) + " sources failing";
    if (why) problems.push({ id: f.id, name: f.name || f.id, why, key: !!f.key });
  }
  let alerts;
  if (ageMin > downMin) {
    // nothing is refreshing: one line says so, not one per feed
    alerts = ["No new data for " + ago(now - at) + " (last refresh " + new Date(at).toISOString().slice(0, 16).replace("T", " ") + "Z)."];
    problems.unshift({ id: "refresh", name: "Refresh", why: "no new data for " + ago(now - at), key: true });
  } else {
    alerts = problems.filter((p) => p.key).map((p) => p.name + ": " + p.why + ".");
  }
  const state = alerts.length ? "down" : problems.length || ageMin > amberMin ? "amber" : "ok";
  // what the alert is about, so the same problem is not sent twice: stalled, or which key feeds are wrong
  const fp = ageMin > downMin ? "stall" : problems.filter((p) => p.key).map((p) => p.id).sort().join(",");
  return { state, ageMin, problems, alerts, fp, ui: userView(health, problems, ageMin, now - at, amberMin, downMin) };
}

// What a reader of the app sees (the header DATA badge; assets/osap-health.js keeps a copy). Milder than the alert state above:
// red only when data has stopped overall (no refresh for downMin) or most key feeds are down. One or a few late feeds are amber
// and named in plain words, so one slow feed does not read as an outage while everything else is minutes old.
// -> { state: "ok" | "amber" | "down", line: one sentence, short: a few words for the badge ("" when there is nothing to add) }
export function userView(health, problems, ageMin, ageMs, amberMin, downMin) {
  const feeds = (health && health.feeds) || [];
  const real = problems.filter((p) => p.id !== "refresh");
  const keyN = feeds.filter((f) => f.key).length, keyBad = real.filter((p) => p.key);
  if (ageMin > downMin) return { state: "down", line: "No new data for " + ago(ageMs) + ". Everything shown is at least that old.", short: "stopped" };
  if (keyN && keyBad.length * 2 > keyN) {
    return { state: "down", line: "Most key feeds are down: " + listNames(keyBad.map((p) => p.name), 4) + ".", short: keyBad.length + " key feeds down" };
  }
  const tail = ageMin > amberMin ? "the last refresh was " + ago(ageMs) + " ago" : "everything else is fresh";
  if (!real.length) {
    if (ageMin > amberMin) return { state: "amber", line: "The last refresh was " + ago(ageMs) + " ago; refreshes usually run every 15 to 25 minutes.", short: "late" };
    return { state: "ok", line: "All " + feeds.length + " feeds are fresh.", short: "" };
  }
  // key feeds are named first; minor ones are counted when a key feed is already named
  const lead = keyBad.length ? keyBad : real, named = lead.slice(0, 2), rest = real.length - named.length;
  let line = named.map((p) => p.name + " " + phrase(p.why)).join(", ");
  if (rest > 0) line += "; " + rest + (keyBad.length && rest === real.length - keyBad.length ? " minor" : " more") + " feed" + (rest === 1 ? " is" : "s are") + " also late";
  line = line + "; " + tail + ".";
  const short = lead.length === 1 ? lead[0].name + " late" : lead.length + (keyBad.length ? " key" : "") + " feeds late";
  return { state: "amber", line: line.charAt(0).toUpperCase() + line.slice(1), short };
}

// a problem in plain words after the feed's name: "last updated 6 h ago", "has no data", "has 7 of 10 sources failing"
export function phrase(why) {
  why = String(why || "");
  if (/^last updated /.test(why)) return /ago$/.test(why) ? why : why + " ago";
  return "has " + why;
}
function listNames(a, max) {
  const s = a.slice(0, max);
  if (a.length > max) return s.join(", ") + " and " + (a.length - max) + " more";
  return s.length > 1 ? s.slice(0, -1).join(", ") + " and " + s[s.length - 1] : s.join("");
}

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60), r = m % 60;
  return h < 48 ? h + " h" + (r ? " " + r + " min" : "") : Math.round(h / 24) + " days";
}

// short tag for the ntfy message (ntfy tags are plain words): which problem set was last announced
export function fpTag(fp) {
  let h = 0;
  for (const c of String(fp)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return "k" + h.toString(36);
}

// last health message in the channel (ntfy keeps 12 h), from its NDJSON poll text -> { state: "down"|"ok", tag } or null
export function lastAnnounced(ndjson) {
  let last = null;
  for (const line of String(ndjson || "").split("\n")) {
    let m; try { m = JSON.parse(line); } catch (e) { continue; }
    if (!m || m.event !== "message" || !Array.isArray(m.tags)) continue;
    const st = m.tags.includes("osap-down") ? "down" : m.tags.includes("osap-ok") ? "ok" : null;
    if (!st) continue;
    if (!last || (m.time || 0) >= (last.time || 0)) last = { state: st, tag: m.tags.find((t) => /^k[0-9a-z]+$/.test(t)) || "", time: m.time || 0 };
  }
  return last;
}

// what to send now: "down" (new or changed problem), "ok" (recovered), or null (nothing new).
// A problem that lasts is announced again only after ntfy's 12-hour cache has dropped the earlier alert.
export function decide(ev, last) {
  if (ev.state === "down") return !last || last.state !== "down" || last.tag !== fpTag(ev.fp) ? "down" : null;
  return last && last.state === "down" ? "ok" : null;
}
