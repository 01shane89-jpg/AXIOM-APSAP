// Speed scorecard (goal, Shane 2026-11-23: beat Dataminr on alerts that are not natural hazards). Reads the flash loop's own
// logs (.github/workflows/refresh-flash.yml on main) for the last SPEED_HOURS hours and reports, against the targets:
//   - news: seconds from an outlet's own time to the loop laying the item (tools/flash_news.mjs, "new fast item ... s after");
//     before the fast news feeds (23 Nov 2026) a news item reached main a median 47 minutes after its outlet's time;
//   - alerts: seconds from an event's first report to the moment ntfy took the push (tools/push_watches.mjs "alert lag"),
//     split into news alerts, other alerts and flash alerts;
//   - quakes: seconds from USGS publishing a quake to the loop seeing it (the hazard lane, for comparison).
// Read only: it fetches logs through the GitHub API and writes the scorecard to stdout (and to $GITHUB_STEP_SUMMARY when set).
// The loop's log lines name countries, outlets and seconds only, never report text, so neither does this.
// Env: GH_REPO (default 01shane89-jpg/AXIOM-APSAP), SPEED_HOURS (24), SPEED_JSON=1 (JSON instead of Markdown). Needs gh, signed in
// (GH_TOKEN in Actions). Exit 0 always: a scorecard is a report, not a gate.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

export const TARGET = { newsMed: 120, newsP90: 300, flashMed: 180 };
export const BEFORE = { newsMed: 47 * 60 };

const q = (a, p) => { const s = a.filter((x) => isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
export const stats = (a) => ({ n: a.length, p10: q(a, 0.1), med: q(a, 0.5), p90: q(a, 0.9) });

/* the lines that matter in one loop log; ts is each line's Actions timestamp (ms), to keep only the window */
export function parseLog(text, since = 0) {
  const out = { news: [], onTime: [], late: [], newsBy: {}, alerts: { news: [], other: [], flash: [] }, quakes: [], requests: 0, failed: 0 };
  for (const line of String(text).split("\n")) {
    const t = Date.parse((line.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)/) || [])[1] || "");
    if (since && isFinite(t) && t < since) continue;
    let m;
    if ((m = line.match(/new fast item ([a-z]{2,3}) (.+?): (\d+) s after its outlet's time/)) && !/\(burst\)/.test(m[2])) {
      out.news.push(+m[3]); (/, late post/.test(line) ? out.late : out.onTime).push(+m[3]); (out.newsBy[m[1] + " " + m[2]] = out.newsBy[m[1] + " " + m[2]] || []).push(+m[3]);
    } else if ((m = line.match(/push: alert lag (\d+) s (flash|alert) (\S+)/))) {
      const s = +m[1];
      if (m[2] === "flash") out.alerts.flash.push(s);
      (m[3] === "news" ? out.alerts.news : out.alerts.other).push(s);
    } else if ((m = line.match(/new quake \S+ M[\d.]+: \d+ s after it happened, (\d+) s after USGS published/))) out.quakes.push(+m[1]);
    else if ((m = line.match(/fast news: (\d+) request\(s\), \d+ not modified, (\d+) failed/))) { out.requests += +m[1]; out.failed += +m[2]; }
  }
  return out;
}
export function merge(parts) {
  const o = { news: [], onTime: [], late: [], newsBy: {}, alerts: { news: [], other: [], flash: [] }, quakes: [], requests: 0, failed: 0 };
  for (const p of parts) {
    o.news.push(...p.news); o.onTime.push(...(p.onTime || [])); o.late.push(...(p.late || [])); o.quakes.push(...p.quakes); o.requests += p.requests; o.failed += p.failed;
    for (const k of Object.keys(o.alerts)) o.alerts[k].push(...p.alerts[k]);
    for (const [k, a] of Object.entries(p.newsBy)) (o.newsBy[k] = o.newsBy[k] || []).push(...a);
  }
  return o;
}
const fmt = (s) => (s == null ? "-" : s < 120 ? s + " s" : (s / 60).toFixed(1) + " min");
export function markdown(o, hours, runs) {
  const n = stats(o.news), f = stats(o.alerts.flash);
  const ok = (v, t) => (v == null ? "no data" : v <= t ? "MET" : "MISSED");
  const L = [`## OSAP alert speed, last ${hours} h (${runs} flash loop run(s))`, "",
    `Goal: beat Dataminr on alerts that are not natural hazards. Before the fast news feeds: news on main a median ${fmt(BEFORE.newsMed)} after the outlet's time.`, "",
    "| Measure | Items | Median | 10% within | 90% within | Target | |", "|---|---|---|---|---|---|---|",
    `| News: outlet's time to in OSAP | ${n.n} | ${fmt(n.med)} | ${fmt(n.p10)} | ${fmt(n.p90)} | median ${fmt(TARGET.newsMed)}, 90% ${fmt(TARGET.newsP90)} | ${ok(n.med, TARGET.newsMed)} / ${ok(n.p90, TARGET.newsP90)} |`,
    (() => { const s = stats(o.onTime); return `| ... posted on time by the outlet (OSAP's own delay) | ${s.n} | ${fmt(s.med)} | ${fmt(s.p10)} | ${fmt(s.p90)} | median ${fmt(TARGET.newsMed)}, 90% ${fmt(TARGET.newsP90)} | ${ok(s.med, TARGET.newsMed)} / ${ok(s.p90, TARGET.newsP90)} |`; })(),
    (() => { const s = stats(o.late); return `| ... posted to the feed after its stated time (outlet's delay) | ${s.n} | ${fmt(s.med)} | ${fmt(s.p10)} | ${fmt(s.p90)} | | |`; })(),
    `| Flash alerts: first report to push | ${f.n} | ${fmt(f.med)} | ${fmt(f.p10)} | ${fmt(f.p90)} | median ${fmt(TARGET.flashMed)} | ${ok(f.med, TARGET.flashMed)} |`];
  for (const [k, label] of [["news", "News alerts: first report to push"], ["other", "Other alerts (hazards, warnings): first report to push"]]) {
    const s = stats(o.alerts[k]); L.push(`| ${label} | ${s.n} | ${fmt(s.med)} | ${fmt(s.p10)} | ${fmt(s.p90)} | | |`);
  }
  const qk = stats(o.quakes); L.push(`| Quakes: USGS published to seen | ${qk.n} | ${fmt(qk.med)} | ${fmt(qk.p10)} | ${fmt(qk.p90)} | | |`, "");
  if (o.unread) L.push(`WARNING: ${o.unread} of ${o.logs || o.unread} loop log(s) could not be read, so these numbers are incomplete (a scorecard of 0 items is a read failure, not a quiet day).`, "");
  L.push(`Fast news requests ${o.requests}, failed ${o.failed}${o.requests ? " (" + ((100 * o.failed) / o.requests).toFixed(1) + "%)" : ""}.`);
  const slow = Object.entries(o.newsBy).map(([k, a]) => [k, stats(a)]).filter(([, s]) => s.n >= 2).sort((a, b) => b[1].med - a[1].med).slice(0, 5);
  if (slow.length) L.push("", "Slowest feeds (median, 2+ items): " + slow.map(([k, s]) => `${k} ${fmt(s.med)} (${s.n})`).join("; ") + ".");
  return L.join("\n") + "\n";
}

if (process.argv[1] && /speed_scorecard\.mjs$/.test(process.argv[1])) {
  const repo = process.env.GH_REPO || "01shane89-jpg/AXIOM-APSAP", hours = Math.max(1, +(process.env.SPEED_HOURS || 24));
  const since = Date.now() - hours * 36e5, gh = (p) => execFileSync("gh", ["api", p], { encoding: "utf8", maxBuffer: 256e6 });
  // a job log has colour codes, and newer gh (the Actions runner's) refuses to print escape sequences without
  // --allow-escape-sequences ("the response contains terminal escape sequences"): every log failed and the daily scorecard read
  // 0 items (24 Nov 2026). Older gh (2.89) has no such flag, so it is asked without it when the flag is unknown.
  let escFlag = true;
  const ghLog = (p) => {
    if (escFlag) {
      try { return execFileSync("gh", ["api", "--allow-escape-sequences", p], { encoding: "utf8", maxBuffer: 256e6, stdio: ["ignore", "pipe", "pipe"] }); }
      catch (e) { if (!/unknown flag/i.test(String(e.stderr || e.message))) throw e; escFlag = false; }
    }
    return gh(p);
  };
  // a loop runs about 5 h 20 min, so runs started up to 6 h before the window can still hold lines inside it
  const runs = JSON.parse(gh(`repos/${repo}/actions/workflows/refresh-flash.yml/runs?branch=main&per_page=40`)).workflow_runs
    .filter((r) => Date.parse(r.created_at) > since - 6 * 36e5);
  const parts = []; let logs = 0, unread = 0;
  for (const r of runs) {
    try {
      for (const j of JSON.parse(gh(`repos/${repo}/actions/runs/${r.id}/jobs`)).jobs) {
        if (j.status !== "completed") continue;   // a running job's log is not served until it ends
        logs++;
        try { parts.push(parseLog(ghLog(`repos/${repo}/actions/jobs/${j.id}/logs`), since)); }
        catch (e) { unread++; console.error(`run ${r.id}: log not read (${String(e.stderr || e.message || e).split("\n")[0].slice(0, 120)})`); }
      }
    } catch (e) { unread++; console.error(`run ${r.id}: jobs not read (${String(e.message || e).split("\n")[0].slice(0, 80)})`); }
  }
  const o = merge(parts); o.logs = logs; o.unread = unread;
  const out = process.env.SPEED_JSON ? JSON.stringify({ hours, runs: runs.length, target: TARGET, before: BEFORE, news: stats(o.news), newsOnTime: stats(o.onTime), newsLate: stats(o.late),
    logs, unread, flash: stats(o.alerts.flash), newsAlerts: stats(o.alerts.news), otherAlerts: stats(o.alerts.other), quakes: stats(o.quakes), requests: o.requests, failed: o.failed }) + "\n"
    : markdown(o, hours, runs.length);
  process.stdout.write(out);
  if (process.env.GITHUB_STEP_SUMMARY && !process.env.SPEED_JSON) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
}
