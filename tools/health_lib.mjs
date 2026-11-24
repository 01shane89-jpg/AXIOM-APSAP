// Data health rules, shared by tools/health.mjs (build + watch) and tests/health.test.mjs. No network, no files.
//
// data/live/health.json (written by each refresh on main):
//   { v: 1, asof: ISO time of the refresh, run: Actions run URL,
//     feeds: [{ id, name, key, maxMin, asof: ISO or null, src: { ok, fail, failing: [names] } (when the file lists sources),
//               n: items in the file's list and minItems (when tools/health.json names a "count" list for the feed) }] }
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

// a source's name for the failing list: the warnings file names its sources by agency (PAGASA, EMERCOM), with the country
// code, and the keeper's outage note showed them as "?" until 13 Nov 2026; a source with no name at all shows its address's host
function srcName(s) {
  let n = s.source || s.name || s.agency || s.id;
  if (n && s.agency === n && s.cc) n = String(s.cc).toUpperCase() + " " + n;
  if (!n && s.url) try { n = new URL(s.url).host; } catch (e) {}
  return String(n || "?").slice(0, 60);
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
    return { ok: withOk.length - bad.length, fail: bad.length, failing: bad.slice(0, 8).map(srcName) };
  }
  return null;
}

// how many items a data file's list holds: "count" names the list (an array, or an object of arrays such as news by country)
export function countOf(obj, key) {
  if (!obj || typeof obj !== "object" || !key) return null;
  const v = obj[key];
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") { let n = 0; for (const x of Object.values(v)) { if (!Array.isArray(x)) return null; n += x.length; } return n; }
  return v == null ? 0 : null;
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
    // fresh but empty: a feed that always carries something came back with nothing (16 Nov 2026: GDACS sat at 0 alerts for
    // days while its stamp stayed fresh, because a firewall page parsed as an empty feed)
    else if (f.minItems > 0 && typeof f.n === "number" && f.n < f.minItems) why = f.n + " items";
    if (why) problems.push({ id: f.id, name: f.name || f.id, why, key: !!f.key });
  }
  // a scheduled data job past its limit (lateJobs below) is a stale data set the reader can't see from a feed stamp: it turns the
  // badge amber and is named like a late minor feed, but never sends a phone alert on its own (20 Nov 2026: three jobs sat late
  // in the panel only, with the badge green; "a quiet panel entry nobody sees" is the stuck data Shane ruled out)
  for (const j of lateJobs(health.jobs && health.jobs.list, now, health.jobs && health.jobs.at)) problems.push({ id: "job:" + j.file, name: jobLabel(j.name), why: j.last ? "last updated " + ago(now - Date.parse(j.last)) : "no successful run", key: false, job: true });
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
  // operations checks (below): listed for the panel and the nightly run (quiet sources never touch the badge or the phone alerts)
  // (late jobs are both: a minor problem above, and listed here with the full reason for the nightly run)
  const ops = [];
  for (const j of lateJobs(health.jobs && health.jobs.list, now, health.jobs && health.jobs.at)) ops.push({ id: "job:" + j.file, name: j.name, why: j.why, ops: true });
  if (health.jobs && health.jobs.error) ops.push({ id: "jobs", name: "Scheduled job check", why: health.jobs.error, ops: true });
  const q = health.quiet && health.quiet.n;
  if (q) ops.push({ id: "quiet", name: "Quiet sources", why: q + " source" + (q === 1 ? "" : "s") + " with nothing new for " + QUIET_DAYS + "+ days or failing for " + DEAD_DAYS + "+ days", ops: true });
  return { state, ageMin, problems, alerts, fp, ops, ui: userView(health, problems, ageMin, now - at, amberMin, downMin) };
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

// ---------- operations checks (Shane 2026-11-20: "we can't afford to have stuck data. Ever") ----------
// Two kinds of stuck data that a feed's own fresh stamp hides. They go in data/live/health.json as "quiet" and "jobs", are listed
// in the app's data-health panel and read by the nightly run. Quiet sources never change the reader's badge or send a phone
// alert; a late job turns the badge amber (evaluate above) but sends no phone alert on its own (the key-feed alerts do that).
//
// 1. Quiet sources. A source inside a feed can answer "ok" with nothing new for months while the feed as a whole stays fresh
//    (NHK's old news feed froze on 8 Aug 2026 and kept answering ok, n: 0, until 19 Nov). data/live/source-seen.json keeps, for
//    every source of every feed that lists them, the first day it was listed, the last day it answered ok and the last day it
//    gave items (n > 0). A source with no items for QUIET_DAYS (or no ok answer for DEAD_DAYS), and listed for longer than that,
//    is quiet. Day resolution, so the file changes at most once a day per source.
export const QUIET_DAYS = 10, DEAD_DAYS = 3, FORGET_DAYS = 30;
const dayMs = 864e5;
const dayNum = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / dayMs);
export function sourceKey(feedId, s) { return feedId + "|" + String(s.url || ((s.source || s.name || s.agency || s.id || "?") + "|" + (s.cc || ""))).slice(0, 300); }
/** seen: { key: { f, name, cc, first, ok, item } } (days YYYY-MM-DD); lists: [{ feed, sources: [...] }] -> { seen, changed } */
export function updateSeen(seen, lists, today) {
  const out = { ...(seen || {}) }; let changed = false;
  for (const { feed, sources } of lists) for (const s of sources || []) {
    if (!s || typeof s !== "object" || typeof s.ok !== "boolean") continue;
    const k = sourceKey(feed, s), o = out[k] ? { ...out[k] } : { f: feed, name: srcName(s), cc: s.cc || "", first: today };
    const before = JSON.stringify(out[k] || null);
    o.last = today;   // still listed by the feed
    if (s.ok) o.ok = today;
    if (s.ok && typeof s.n === "number" && s.n > 0) o.item = today;
    // a feed that gives its newest item's own date (tools/refresh_news.mjs "newest") is judged by that at once
    if (s.ok && typeof s.newest === "string" && /^\d{4}-\d\d-\d\d/.test(s.newest)) o.newest = s.newest.slice(0, 10);
    if (JSON.stringify(o) !== before) { out[k] = o; changed = true; }
  }
  // a source the feed no longer lists is forgotten after FORGET_DAYS (it was removed or renamed on purpose)
  for (const [k, o] of Object.entries(out)) if (dayNum(today) - dayNum(o.last || o.first) > FORGET_DAYS) { delete out[k]; changed = true; }
  return { seen: out, changed };
}
/** -> [{ feed, name, cc, why, days }] most days first */
export function quietSources(seen, today) {
  const t = dayNum(today), out = [];
  for (const o of Object.values(seen || {})) {
    if (o.last !== today) continue;                  // only sources the feeds list today
    const listed = t - dayNum(o.first);
    const noOk = t - dayNum(o.ok || o.first), noItem = t - dayNum(o.item || o.first);
    if (noOk >= DEAD_DAYS && listed >= DEAD_DAYS) out.push({ feed: o.f, name: o.name, cc: o.cc, why: o.ok ? "failing since " + o.ok : "failing since it was first listed (" + o.first + ")", days: noOk });
    else if (o.newest && o.ok === today && t - dayNum(o.newest) >= QUIET_DAYS) out.push({ feed: o.f, name: o.name, cc: o.cc, why: "answers, but its newest item is from " + o.newest, days: t - dayNum(o.newest) });
    else if (!o.newest && noItem >= QUIET_DAYS && listed >= QUIET_DAYS) out.push({ feed: o.f, name: o.name, cc: o.cc, why: o.item ? "no new items since " + o.item : "no items since it was first listed (" + o.first + ")", days: noItem });
  }
  return out.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

// 2. Stalled jobs. Every scheduled workflow's last successful run on main is checked against its own schedule: a job is late when
//    its last success is older than twice the longest gap between its scheduled starts plus 3 hours (GitHub runs crons late or
//    skips them when busy). That covers the daily, weekly and monthly data jobs that have no live feed stamp to watch.
const cronField = (f, lo, hi) => {
  const set = new Set();
  for (const part of String(f).split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim()); if (!m) return null;
    let a = lo, b = hi; if (m[1] !== "*") { const r = m[1].split("-").map(Number); a = r[0]; b = r.length > 1 ? r[1] : (m[2] ? hi : r[0]); }
    for (let v = a; v <= b; v += +(m[2] || 1)) set.add(v);
  }
  return set;
};
/** "m h dom mon dow" -> the longest gap in minutes between two starts (over 35 days from a Monday), or null if unreadable */
export function cronGapMin(expr) {
  const p = String(expr).trim().split(/\s+/); if (p.length !== 5) return null;
  const [mi, ho, dm, mo, dw] = [cronField(p[0], 0, 59), cronField(p[1], 0, 23), cronField(p[2], 1, 31), cronField(p[3], 1, 12), cronField(p[4], 0, 7)];
  if (!mi || !ho || !dm || !mo || !dw) return null;
  if (dw.has(7)) dw.add(0);
  const domStar = p[2] === "*", dowStar = p[4] === "*";
  const start = Date.UTC(2026, 0, 5), fires = [];
  for (let d = 0; d < 70; d++) {
    const t = new Date(start + d * dayMs), dayOk = domStar && dowStar ? true : domStar ? dw.has(t.getUTCDay()) : dowStar ? dm.has(t.getUTCDate()) : dm.has(t.getUTCDate()) || dw.has(t.getUTCDay());
    if (!dayOk || !mo.has(t.getUTCMonth() + 1)) continue;
    for (const h of [...ho].sort((a, b) => a - b)) for (const m of [...mi].sort((a, b) => a - b)) fires.push(d * 1440 + h * 60 + m);
  }
  if (fires.length < 2) return null;
  let gap = 0; for (let i = 1; i < fires.length; i++) gap = Math.max(gap, fires[i] - fires[i - 1]);
  return gap;
}
/** the schedules in a workflow file's text -> ["17 3 * * *", ...] */
export function cronsOf(yml) { return [...String(yml).matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((m) => m[1]); }
/** the longest a workflow may go without a success, in minutes: 2 x the longest gap of its combined schedules + 180 */
export function jobLimitMin(crons) {
  const gaps = crons.map(cronGapMin).filter((g) => g != null);
  if (!gaps.length) return null;
  // several schedules together fire more often than any one alone: the combined gap is at most the smallest single gap
  return 2 * Math.min(...gaps) + 180;
}
/** a job's limit when it also writes watched feeds: never longer than the shortest of their limits, so the keeper restarts it
 *  before (or as) its data goes stale, not hours after (refresh-factchecks.yml: 3-hourly, limit 540 min, but its feed's 420;
 *  the fact checks sat stale 18:59Z to 20:34Z on 20 Nov 2026 with the job not yet "late"). Never under one gap of its own
 *  schedule + 60 min, so a job is not called late between two normal runs. yml = the workflow text; feeds = tools/health.json feeds. */
export function jobLimitFor(crons, yml, feeds, defaultMaxMin = 120) {
  const lim = jobLimitMin(crons);
  if (!lim) return null;
  const own = (feeds || []).filter((f) => f && f.file && String(yml).includes(f.file)).map((f) => f.maxMin || defaultMaxMin);
  if (!own.length) return lim;
  const gap = Math.min(...crons.map(cronGapMin).filter((g) => g != null));
  return Math.max(Math.min(lim, ...own), gap + 60);
}
/** a workflow's name as a data set: "Refresh airfield weather (METAR/TAF)" -> "Airfield weather (METAR/TAF)";
 *  "Keep the 15-minute refresh running" -> "15-minute refresh keeper" (the badge said "Keep the 15-minute refresh running late") */
export function jobLabel(name) { const s = String(name || "").replace(/^Refresh\s+/i, "").replace(/^Keep the (.+) running$/i, "$1 keeper"); return s.charAt(0).toUpperCase() + s.slice(1); }
/** jobs: [{ file, name, maxMin, last: ISO of last success or null, since: ISO the workflow was added }] -> late ones [{ file, name, why, last }]
 *  A job with no success on record is late only once it has existed longer than its limit (a monthly job added mid-month has
 *  not reached its first run: refresh-outlet-facts.yml, added 14 Nov 2026, first due 7 Dec). A job with a run going on main
 *  (running: when it started, under 6 h ago) is working, not late: refresh-keeper.yml runs 5 h 20 min a time on an hourly
 *  schedule and showed as late for ~20 min at the end of every run (20 Nov 2026). */
export const RUN_ALIVE_MIN = 360; // GitHub ends any job after 6 h: a run "in progress" for longer is stuck, not working
export const SNAPSHOT_TRUST_MIN = 120; // the job list is asked hourly (tools/health.mjs jobs); older than this, its "running" is not trusted
/** when a run seen going is judged: as of the job list's own time (at), not the reader's clock. The list is asked at most hourly, so
 *  a keeper run seen at 5 h 21 min was read 39 min later as 6 h "in progress" = stuck, and the Today badge went amber with "Keep the
 *  15-minute refresh running late" while that run had already finished and the next one was going (22 Nov 2026, 15:07Z). */
export function runRef(at, now = Date.now()) {
  const t = Date.parse(at || "");
  return t && t <= now && now - t < SNAPSHOT_TRUST_MIN * 60000 ? t : now;
}
/** should the hourly job list ask whether a run is going? Yes once the last success is within SNAPSHOT_TRUST_MIN of the limit:
 *  the list is read for up to that long after it is asked, so asking only once already late left a keeper seen at 4 h 36 min
 *  with no "running", and it read as late 45 min later while it ran fine (24 Nov 2026, 14:57Z). */
export function askRunning(last, maxMin, now = Date.now()) {
  return !last || now - Date.parse(last) > (maxMin - SNAPSHOT_TRUST_MIN) * 60000;
}
/** when a run's work really began: the earliest started_at of its jobs that have started (null when none has). A run queued
 *  behind another in its concurrency group reports run_started_at = when it was queued (refresh-keeper.yml 24 Nov 2026: queued
 *  11:01Z, job started 15:01Z), which would make a fresh keeper look 6 h "stuck" four hours early. */
export function jobStarted(jobs) {
  const t = (jobs || []).map((j) => j && j.started_at && j.status !== "queued" && j.status !== "waiting" && j.status !== "pending" ? Date.parse(j.started_at) : NaN).filter(isFinite);
  return t.length ? new Date(Math.min(...t)).toISOString().slice(0, 19) + "Z" : null;
}
export function lateJobs(jobs, now = Date.now(), at = null) {
  const ref = runRef(at, now);
  return (jobs || []).filter((j) => j && j.maxMin && !(j.running && ref - Date.parse(j.running) < RUN_ALIVE_MIN * 60000) &&
    (j.last ? now - Date.parse(j.last) > j.maxMin * 60000 : !(j.since && now - Date.parse(j.since) <= j.maxMin * 60000)))
    .map((j) => ({ file: j.file, name: j.name || j.file, why: j.last ? "last succeeded " + ago(now - Date.parse(j.last)) + " ago (runs at least every " + ago((j.gapMin || (j.maxMin - 180) / 2) * 60000) + ")" : "no successful run on record", last: j.last || null }));
}
