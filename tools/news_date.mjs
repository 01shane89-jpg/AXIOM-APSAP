// The date an outlet's item is shown with (tools/refresh_news.mjs). Times are "YYYY-MM-DDTHH:MM" in UTC.
//   tz:    a date with no time zone is the outlet's local time, e.g. "+08:00" (tools/news_feeds.json)
//   clock: the feed writes local wall-clock time but labels it UTC (or gives no zone); read it as local time at that offset
// A date more than 15 minutes ahead of the run is a wrong time zone or a scheduled post (16 Nov 2026: 42 items up to 5 h ahead
// from seven outlets, shown as "1730Z" at 15:00Z); such an item, like an undated one, gets the time OSAP first saw it.
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };
export const onClock = (d, tz) => { const m = /^([+-])(\d\d):(\d\d)$/.exec(tz || ""); if (!m || !d) return d; const off = (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]); return new Date(Date.parse(d + "Z") - off * 60000).toISOString().slice(0, 16); };
export const zoned = (d, tz) => (tz && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(String(d).trim()) ? String(d).trim().replace(" ", "T") + tz : d);
export const AHEAD_MIN = 15;
// returns { date, seen }: seen = the date is when OSAP first saw the item (prev = that time from the last run, if any)
export function itemDate(raw, f, prev, now = Date.now()) {
  const nowIso = new Date(now).toISOString().slice(0, 16), soonIso = new Date(now + AHEAD_MIN * 60000).toISOString().slice(0, 16);
  let date = onClock(iso(zoned(raw, f.tz)), f.clock);
  if (date && date > soonIso) date = "";
  if (date) return { date, seen: false };
  return { date: prev && prev <= soonIso ? prev : nowIso, seen: true };
}
