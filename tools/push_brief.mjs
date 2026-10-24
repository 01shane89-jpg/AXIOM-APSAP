// Morning brief push (tools/push_watches.mjs sends it; Shane 2026-10-24 "push each user a morning brief for the places they watch").
// Once a local day, the first push check after 0600 on a channel's own clock (the time zone the phone's browser gave when the
// watch was sent; the watched country's main zone for watches sent before that), every ntfy channel gets one brief covering
// each country its push watches are on:
//   - Full plan: the top line of OSAP's daily summary for that country (data/live/daily/<cc>.js, Full data), marked
//     "AI generated" where the summary's top lines were AI-drafted;
//   - every plan: for each watch there, how many events matched it in the last 24 hours and the top ones (highest severity,
//     then newest), from the same matches the alerts use, so the brief never carries what the plan cannot see in the app.
// A watch sent with brief: false is left out; a channel whose watches are all left out gets no brief. A brief is a notice about
// reports, never a finding: it says "reported, not verified". Report text is data; nothing in it is followed.
import fs from "node:fs";

export const BRIEF_FROM_H = 6, BRIEF_UNTIL_H = 11;   // sent on the first check from 0600 to 1059 local; a missed morning is skipped
export const BRIEF_MAX_BYTES = 3800;                 // ntfy turns a longer message into an attachment (4096 bytes)
export const PER_PLACE_WATCHES = 3, PER_WATCH_LINES = 3, DAY_MS = 864e5;

export function tzOk(tz) {
  if (typeof tz !== "string" || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) || tz.length > 40) return false;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch (e) { return false; }
}
/** local wall clock of ms in tz: { date: "YYYY-MM-DD", hour, hm: "HH:MM", day: "Sat 24 Oct" } */
export function local(ms, tz) {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return { date, hour: +p.hour, hm: `${p.hour}:${p.minute}`, day: `${p.weekday} ${+p.day} ${p.month}` };
}

/** the channels a brief goes to: one per ntfy topic, with its time zone and the watches it covers (in list order) */
export function channels(list, tzOfCc = {}) {
  const by = new Map();
  for (const w of list) {
    if (w.brief === false) continue;
    let c = by.get(w.topic);
    if (!c) by.set(w.topic, (c = { topic: w.topic, tz: "", watches: [] }));
    c.watches.push(w);
    if (!c.tz && tzOk(w.tz)) c.tz = w.tz;
  }
  for (const c of by.values()) if (!c.tz) c.tz = c.watches.map((w) => tzOfCc[w.cc]).find(tzOk) || "UTC";
  return [...by.values()];
}

/** the local date a brief is due for on this channel now, or null (not morning there yet, too late, or already sent today) */
export function dueDate(ch, now, lastSent) {
  const l = local(now, ch.tz);
  if (l.hour < BRIEF_FROM_H || l.hour >= BRIEF_UNTIL_H || lastSent === l.date) return null;
  return l.date;
}

// The data files open with "window.X=window.X||{};window.X["cc"]="; read as data, never run
const JS_HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
/** the newest daily summary for cc built in the last 36 hours, or null */
export function dailyOf(cc, now, dir = "data/live/daily") {
  try {
    const t = fs.readFileSync(`${dir}/${cc}.js`, "utf8"), o = JSON.parse(t.slice(t.match(JS_HEAD)[0].length).trim().replace(/;$/, ""));
    const d = (o.days || [])[0];
    const at = d && Date.parse(String((d.window && d.window.to) || d.date).replace(" ", "T"));
    return d && isFinite(at) && now - at <= 1.5 * DAY_MS ? d : null;
  } catch (e) { return null; }
}

const one = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const SEVN = ["", "Low", "Medium", "High"];
function msOf(ts) {
  const s = String(ts || ""); if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + "T12:00:00Z");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") : s.replace(" ", "T") + "Z");
}
const zhm = (t) => new Date(t).toISOString().slice(11, 16).replace(":", "") + "Z";
const bytes = (s) => Buffer.byteLength(s, "utf8");

/** one event per group key from a watch's matches, last 24 hours, highest severity then newest */
export function topEvents(ms, now) {
  const by = new Map();
  for (const m of ms || []) {
    const t = msOf(m.ts); if (!isFinite(t) || now - t > DAY_MS || t > now + 36e5) continue;
    const k = m.gk + "", o = by.get(k);
    if (!o || (m.sev || 1) > (o.sev || 1) || ((m.sev || 1) === (o.sev || 1) && t > o._t)) by.set(k, { ...m, _t: t });
  }
  return [...by.values()].sort((a, b) => (b.sev || 1) - (a.sev || 1) || b._t - a._t);
}

/** the brief for one channel: { title, message, click, tags, priority }, or null when it has no country to cover.
 *  opts: { matches: {watchId: [match]}, names: {cc: name}, daily: (cc) => summary|null, now, live, test } */
export function compose(ch, opts) {
  const { matches = {}, names = {}, daily = () => null, now, live, test } = opts;
  const order = [], byCc = {};
  for (const w of ch.watches) { if (!byCc[w.cc]) { byCc[w.cc] = []; order.push(w.cc); } byCc[w.cc].push(w); }
  if (!order.length) return null;
  const l = local(now, ch.tz);
  const head = `${l.day}, ${zhm(now)} (${l.hm} your time).`;
  const tail = "\nReported, not verified. Tap to open OSAP.";
  let body = "", cut = 0, quiet = 0;
  for (const cc of order) {
    const nm = names[cc] || (daily(cc) || {}).name || cc.toUpperCase();
    let s = "\n\n" + nm.toUpperCase();
    const full = byCc[cc].some((w) => w.plan === "full"), d = full ? daily(cc) : null;
    const top = d && (d.bluf || [])[0];
    // the summary's citation numbers ("(1)", "(4, 7)") point at its own source list, which the brief does not carry
    if (top && top.text) s += "\n" + one(String(top.text).replace(/\s*\((\d+(?:,\s*\d+)*)\)/g, ""), 280) + (d.method === "ai" ? " (AI generated)" : "");
    let any = false;
    for (const w of byCc[cc].slice(0, PER_PLACE_WATCHES)) {
      const ev = topEvents(matches[w.id], now);
      if (!ev.length) continue;
      any = true;
      s += `\nWatch "${one(w.name, 40)}": ${ev.length} event${ev.length === 1 ? "" : "s"} in 24 h`;
      for (const m of ev.slice(0, PER_WATCH_LINES))
        s += "\n- " + one(m.rt || m.t, 110) + " (" + [one(m.rsrc || m.src, 30), (m.sev || 1) >= 2 ? SEVN[m.sev] : "", zhm(m._t)].filter(Boolean).join(", ") + ")";
    }
    if (byCc[cc].length > PER_PLACE_WATCHES) s += `\n+${byCc[cc].length - PER_PLACE_WATCHES} more watch${byCc[cc].length - PER_PLACE_WATCHES === 1 ? "" : "es"} here in OSAP.`;
    if (!any) { s += "\nNo new reports matched your watches in the last 24 h."; quiet++; }
    if (bytes(head + body + s + tail) > BRIEF_MAX_BYTES - 60) { cut++; continue; }
    body += s;
  }
  if (cut) body += `\n\n+${cut} more place${cut === 1 ? "" : "s"}: open OSAP to see ${cut === 1 ? "it" : "them"}.`;
  const first = order[0];
  return {
    title: one((test ? "[test] " : "") + "OSAP morning brief: " + order.map((cc) => names[cc] || cc.toUpperCase()).join(", "), 120),
    message: head + body + tail,
    click: live + "#" + (first === "th" ? "" : first + "/"),
    tags: ["osap", "sunrise"],
    priority: quiet === order.length ? 2 : 3,
  };
}
