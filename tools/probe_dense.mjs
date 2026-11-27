// Probe 50 (27 Nov 2026): calibrate wiki surges over the last 30 days.
const { get } = await import("./dense_lib.mjs");
const { COUNTRIES } = await import("./geo_cc.mjs");
const { TITLE, perDay, surge } = await import("./dense_wikiedits.mjs");
const day = (ms) => new Date(ms).toISOString().slice(0, 10), from = day(Date.now() - 61 * 864e5), to = day(Date.now() - 864e5), hits = [];
for (const c of COUNTRIES) {
  const j = await get("https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=timestamp&rvlimit=500&rvend=" + from + "T00:00:00Z&titles=" + encodeURIComponent(TITLE[c.id] || c.name), "json");
  const p = j.query.pages[0], d = perDay(p.revisions.map((r) => r.timestamp), from, to, p.revisions.length >= 500);
  for (let i = 31; i <= d.length; i++) { const s = surge(d.slice(0, i)); if (s) hits.push(c.id + " " + s.day + " " + s.edits + "/" + s.median); }
  await new Promise((r) => setTimeout(r, 150));
}
console.log("P surges in last 30 days:", hits.length); for (const h of hits) console.log("P  ", h);
