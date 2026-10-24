// Risk rating "equivalents" for every country and its major cities: the pure scoring rules, shared by the refresh job
// (tools/refresh_risk.mjs) and its tests (tests/risk.test.mjs).
// A derived rating, computed by OSAP from its own feeds and open indicators with the fixed formula below. It is NOT an
// official travel advisory and NOT an analyst assessment: official advisories (U.S. State Department) are shown apart and are
// never an input, so the two can be compared. Modelled on the five-level country and city ratings commercial services such as
// Crisis24 publish (Minimal, Low, Moderate, High, Extreme), per category and overall.
// Every category is a score from 0 (no risk seen) to 100, made of indicators that each keep their raw value, year or window,
// the points they gave and their source link, so anyone can redo the sum.
export const RULE = "osap.risk/0.1";
export const LEVELS = ["", "Minimal", "Low", "Moderate", "High", "Extreme"];
// score -> level: 0-19 Minimal, 20-39 Low, 40-59 Moderate, 60-79 High, 80-100 Extreme
export function levelOf(score) { return score == null || !isFinite(score) ? 0 : score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1; }
export const clamp = (v) => Math.max(0, Math.min(100, v));
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- indicator scales (each gives 0-100) ----------
// World Bank Worldwide Governance Indicators estimates run about -2.5 (worst) to +2.5 (best): +1.5 or better scores 0, -2.5 scores 100
export const wgiPts = (est) => clamp((1.5 - est) / 4 * 100);
// conflict deaths in the past 365 days (UCDP best estimate), on a log scale: 0 -> 0, 10 -> 26, 100 -> 50, 1,000 -> 75, 10,000+ -> 100
export const deathsPts = (n) => clamp(Math.log10(1 + Math.max(0, n)) / 4 * 100);
// intentional homicides per 100,000 people (UNODC via the World Bank), log scale: 1 -> 18, 5 -> 46, 10 -> 61, 25 -> 83, 50+ -> 100
export const homicidePts = (h) => clamp(Math.log10(1 + Math.max(0, h)) / Math.log10(51) * 100);
// a 0-100 coverage figure where higher is better (UHC service coverage index, % with electricity, % using the internet)
export const lackPts = (pct) => clamp(100 - pct);

// the weights of the categories in the overall score (renormalised over the categories that have data)
export const CATS = [
  { k: "security", name: "Security and conflict", w: 0.35 },
  { k: "crime", name: "Crime", w: 0.2 },
  { k: "health", name: "Health and medical", w: 0.15 },
  { k: "hazards", name: "Natural hazards now", w: 0.15 },
  { k: "infra", name: "Infrastructure and services", w: 0.15 }
];

// a weighted mix of indicators; those without a value are left out and the weights renormalised.
// parts: [{k, name, v (raw), pts (0-100) | null, w, src, year?, note?}]
export function mix(parts) {
  const have = parts.filter((p) => p.pts != null && isFinite(p.pts));
  if (!have.length) return { score: null, parts, missing: parts.map((p) => p.name) };
  const tw = have.reduce((s, p) => s + p.w, 0);
  const score = have.reduce((s, p) => s + p.pts * p.w, 0) / tw;
  return { score: r1(score), parts: parts.map((p) => Object.assign({}, p, { pts: p.pts == null ? null : r1(p.pts) })), missing: parts.filter((p) => p.pts == null).map((p) => p.name) };
}
// a base mix plus event points (outbreak notices, hazard events, outages), capped at 100
export function withEvents(base, events, baseShare) {
  const add = Math.min(100, events.reduce((s, e) => s + e.pts, 0));
  if (base.score == null && !events.length) return Object.assign({}, base, { events, score: null });
  const score = clamp((base.score == null ? 0 : base.score * baseShare) + add);
  return Object.assign({}, base, { events, score: r1(score), base_share: baseShare });
}

// ---------- the categories ----------
// Security and conflict: World Bank "Political Stability and Absence of Violence/Terrorism" 40%, conflict deaths 60%
export function security(I) {
  return mix([
    { k: "pv", name: "Political stability and absence of violence/terrorism (WGI)", v: I.pv && I.pv.v, year: I.pv && I.pv.y, pts: I.pv ? wgiPts(I.pv.v) : null, w: 0.4, src: I.pv && I.pv.src },
    { k: "deaths", name: "Conflict deaths, past 365 days (UCDP)", v: I.deaths ? I.deaths.n : null, year: I.deaths && I.deaths.window, events: I.deaths && I.deaths.events,
      pts: I.deaths ? deathsPts(I.deaths.n) : null, w: 0.6, src: I.deaths && I.deaths.src, note: I.deaths && I.deaths.note }
  ]);
}
// Crime: intentional homicide rate 60%, World Bank "Rule of Law" 40%
export function crime(I) {
  return mix([
    { k: "homicide", name: "Intentional homicides per 100,000 (UNODC)", v: I.homicide && I.homicide.v, year: I.homicide && I.homicide.y, pts: I.homicide ? homicidePts(I.homicide.v) : null, w: 0.6, src: I.homicide && I.homicide.src },
    { k: "rl", name: "Rule of law (WGI)", v: I.rl && I.rl.v, year: I.rl && I.rl.y, pts: I.rl ? wgiPts(I.rl.v) : null, w: 0.4, src: I.rl && I.rl.src }
  ]);
}
// Health and medical: 70% of the lack of health service coverage (WHO/World Bank UHC index), plus outbreak notices
// (WHO Disease Outbreak News in the past 90 days 15 each; CDC travel health notice level 3: 30, level 2: 15, level 1: 5), notices capped at 45
export function outbreakEvents(who, cdc) {
  const ev = [];
  for (const x of who || []) ev.push({ k: "who", text: x.title, date: x.date, link: x.link, pts: 15 });
  for (const x of cdc || []) ev.push({ k: "cdc", text: x.title, date: x.date, link: x.link, pts: x.level >= 3 ? 30 : x.level === 2 ? 15 : 5 });
  return capEvents(ev, 45);
}
export function health(I, events) {
  const base = mix([{ k: "uhc", name: "Health service coverage index (UHC, 0-100)", v: I.uhc && I.uhc.v, year: I.uhc && I.uhc.y, pts: I.uhc ? lackPts(I.uhc.v) : null, w: 1, src: I.uhc && I.uhc.src }]);
  return withEvents(base, events, 0.7);
}
// Natural hazards now: events in force only (there is no free, keyless structural hazard index in OSAP yet).
// GDACS alert in force: red 60, orange 35, green 5 (green alerts capped at 15); earthquake in the past 7 days M7+: 50, M6+: 25; official warning in force:
// extreme/red 30, severe/orange 15 (warnings capped at 45); tropical cyclone within 300 km in the next 72 h: hurricane force 40,
// storm force 15; volcano with an ash advisory: 15. Capped at 100.
export function hazardEvents(o) {
  const ev = [];
  const green = [];
  for (const g of o.gdacs || []) {
    const a = String(g.alert || "").toLowerCase(), e = { k: "gdacs", text: g.name, date: g.from, link: g.url, pts: a === "red" ? 60 : a === "orange" ? 35 : 5 };
    (a === "red" || a === "orange" ? ev : green).push(e);
  }
  ev.push(...capEvents(green, 15));
  for (const q of o.quakes || []) if (q.mag >= 6) ev.push({ k: "quake", text: "M" + q.mag + " " + q.place, date: new Date(q.time).toISOString().slice(0, 16) + "Z", link: q.url, pts: q.mag >= 7 ? 50 : 25 });
  const w = [];
  for (const x of o.warnings || []) { const s = String(x.severity || "").toLowerCase(); const p = /extreme|red/.test(s) ? 30 : /severe|orange/.test(s) ? 15 : 0; if (p) w.push({ k: "warning", text: x.title_en || x.title, date: x.date, link: x.link, pts: p }); }
  ev.push(...capEvents(w, 45));
  for (const s of o.storms || []) ev.push({ k: "storm", text: s.name + " (" + (s.wind_kt >= 64 ? "hurricane/typhoon force" : "storm force") + ", " + s.km + " km)", date: s.t, link: s.link, pts: s.wind_kt >= 64 ? 40 : 15 });
  for (const v of o.volcano || []) ev.push({ k: "volcano", text: v.title, date: v.date, link: v.link, pts: 15 });
  return ev;
}
// no event in force scores 0; null when none of the hazard feeds could be read (feedsOk false)
export function hazards(events, feedsOk = true) {
  if (!feedsOk) return { score: null, parts: [], missing: ["Hazard feeds"], events: [] };
  return { score: r1(Math.min(100, events.reduce((s, e) => s + e.pts, 0))), parts: [], missing: [], events };
}
// Infrastructure and services: 80% of the lack of electricity access (50%) and internet use (50%), plus a large internet
// outage seen by IODA in the past week (40, or 20 for a moderate one)
export function infra(I, outage) {
  const base = mix([
    { k: "elec", name: "People without electricity, %", v: I.elec != null && I.elec.v != null ? r1(100 - I.elec.v) : null, year: I.elec && I.elec.y, pts: I.elec ? lackPts(I.elec.v) : null, w: 0.5, src: I.elec && I.elec.src },
    { k: "net", name: "People not using the internet, %", v: I.net != null && I.net.v != null ? r1(100 - I.net.v) : null, year: I.net && I.net.y, pts: I.net ? lackPts(I.net.v) : null, w: 0.5, src: I.net && I.net.src }
  ]);
  const ev = [];
  if (outage && outage.score > 0) { const l = Math.log10(outage.score); if (l >= 6) ev.push({ k: "outage", text: "Internet outage signal, " + outage.events + " event" + (outage.events === 1 ? "" : "s") + " in the past week (IODA)", link: outage.link, pts: l >= 7 ? 40 : 20 }); }
  return withEvents(base, ev, 0.8);
}
function capEvents(ev, cap) {
  ev.sort((a, b) => b.pts - a.pts);
  let left = cap;
  return ev.map((e) => { const p = Math.max(0, Math.min(e.pts, left)); left -= p; return Object.assign({}, e, { pts: p }); });
}

// ---------- the overall rating ----------
// the weighted mean of the category scores that have data; the overall level is never more than one below the worst category
// (a war zone with good hospitals is not "Low")
export function overall(cats) {
  const have = CATS.filter((c) => cats[c.k] && cats[c.k].score != null);
  if (!have.length) return { score: null, level: 0, label: "", missing: CATS.map((c) => c.name) };
  const tw = have.reduce((s, c) => s + c.w, 0), score = r1(have.reduce((s, c) => s + cats[c.k].score * c.w, 0) / tw);
  const worst = Math.max(...have.map((c) => levelOf(cats[c.k].score)));
  const level = Math.max(levelOf(score), worst - 1);
  return { score, level, label: LEVELS[level], floor: level > levelOf(score) ? worst - 1 : undefined, missing: CATS.filter((c) => !have.includes(c)).map((c) => c.name) };
}
// all categories for one place
export function rate(I, ev) {
  const cats = { security: security(I), crime: crime(I), health: health(I, ev.health || []), hazards: hazards(ev.hazards || [], ev.hazardsOk !== false), infra: infra(I, ev.outage) };
  for (const k in cats) { cats[k].level = levelOf(cats[k].score); cats[k].label = LEVELS[cats[k].level]; }
  return { overall: overall(cats), cats };
}

// ---------- helpers for the job ----------
export function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, h = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
// the latest World Bank value of a series [[year, value], ...] no older than maxAge years
export function latest(series, nowYear, maxAge = 8) {
  const s = (series || []).filter((x) => x && x[1] != null && isFinite(x[1]));
  if (!s.length) return null;
  const [y, v] = s[s.length - 1];
  return nowYear - +y > maxAge ? null : { y: String(y), v: +v };
}
// conflict deaths from UCDP event rows {date, lat, lon, best}: total, events, and optionally only those within r km of a point
export function deathsFrom(rows, sinceIso, at, rKm) {
  let n = 0, events = 0;
  for (const e of rows || []) {
    if (!e || String(e.date) < sinceIso) continue;
    if (at && !(isFinite(e.lat) && isFinite(e.lon) && km(at.lat, at.lon, e.lat, e.lon) <= rKm)) continue;
    n += +e.best || 0; events++;
  }
  return { n, events };
}
