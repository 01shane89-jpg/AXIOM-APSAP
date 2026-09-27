// Russia–Ukraine war extras for the conflict tab (run by tools/conflict_extras.mjs). None of this is a report or evidence:
//  - alerts: Ukraine's air-raid alert state per region, from the public ubilling.net.ua alert API (no key; it relays the official
//    alert system), with a 7-day log of the changes this job saw. Times in the source are Kyiv time; stored in UTC.
//  - heat: NASA FIRMS VIIRS active-fire detections of the past 24 hours in Ukraine and Russia's border regions (public CSV, no key).
//    A detection is heat seen from orbit; its cause is unknown (strikes, shelling, farm or forest fires, industry).
//  - losses: the Russian losses claimed each day by Ukraine's General Staff (via russianwarship.rip), kept as a 120-day series.
//  - moc: the Russian Ministry of Defence's own daily claims (its English Telegram channel): the latest summary post and the
//    settlements it says Russian forces have "liberated"; and the settlements DeepState (Ukrainian volunteer mappers) posts as
//    newly occupied or advanced on. Both are each side's claims, shown as posted, never merged into the front line.
import { ccsAt } from "../geo_cc.mjs";

// Regions: a stem of the name ubilling uses -> English name and a point near the region's centre (approximate, for the map dot only)
const REG = [
  [/вінниц/i, "Vinnytsia", 49.23, 28.47], [/волин/i, "Volyn", 50.75, 25.34], [/дніпро/i, "Dnipropetrovsk", 48.46, 35.04], [/донецьк/i, "Donetsk", 48.3, 37.6],
  [/житомир/i, "Zhytomyr", 50.25, 28.66], [/закарпат/i, "Zakarpattia", 48.62, 22.29], [/запоріз/i, "Zaporizhzhia", 47.5, 35.6], [/івано/i, "Ivano-Frankivsk", 48.92, 24.71],
  [/київська/i, "Kyiv Oblast", 50.35, 30.25], [/^м\.?\s*київ|^київ$/i, "Kyiv city", 50.45, 30.52], [/кіровоград|кропивниц/i, "Kirovohrad", 48.51, 32.26], [/луганськ/i, "Luhansk", 48.8, 39.0],
  [/львів/i, "Lviv", 49.84, 24.03], [/миколаїв/i, "Mykolaiv", 46.97, 32.0], [/одес/i, "Odesa", 46.48, 30.72], [/полтав/i, "Poltava", 49.59, 34.55],
  [/рівн/i, "Rivne", 50.62, 26.25], [/сум/i, "Sumy", 50.91, 34.8], [/тернопіл/i, "Ternopil", 49.55, 25.59], [/харків/i, "Kharkiv", 49.99, 36.23],
  [/херсон/i, "Kherson", 46.64, 32.62], [/хмельниц/i, "Khmelnytskyi", 49.42, 26.99], [/черкас/i, "Cherkasy", 49.44, 32.06], [/чернівец/i, "Chernivtsi", 48.29, 25.94],
  [/чернігів/i, "Chernihiv", 51.5, 31.29], [/крим/i, "Crimea", 45.3, 34.1], [/севастопол/i, "Sevastopol", 44.6, 33.52],
];
const region = (k) => { const r = REG.find(([re]) => re.test(String(k).trim())); return r ? { en: r[1], la: r[2], lo: r[3] } : null; };
// Kyiv wall-clock time ("2026-09-27 13:29:57") to UTC ISO minutes, with the zone's offset at that moment
function kyivToUtc(s) {
  const m = String(s || "").match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/); if (!m) return "";
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess;
  return new Date(guess - off).toISOString().slice(0, 16);
}
function csvObjs(t) {
  const lines = t.trim().split(/\r?\n/), head = lines.shift().split(",");
  return lines.map((l) => { const v = l.split(","); return Object.fromEntries(head.map((h, i) => [h, v[i]])); });
}
function inPoly(x, y, fc) {
  const inRing = (r) => { let a = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) a = !a; } return a; };
  for (const f of (fc && fc.features) || []) for (const p of f.geometry.coordinates) if (inRing(p[0]) && !p.slice(1).some(inRing)) return true;
  return false;
}

export async function run({ conflict, prev, get, sha256, stamp, tgItems, readJs, errMsg }) {
  const sources = [], now = Date.now(), iso = (t) => new Date(t).toISOString().slice(0, 16);
  const [south, west] = conflict.bounds[0], [north, east] = conflict.bounds[1];
  const front = readJs("data/live/conflicts/front/" + conflict.id + ".js");
  const occ = front && front.current && front.current.kind === "areas" ? front.current.areas : null;

  /* ---- air-raid alerts ---- */
  let alerts = prev.alerts || null;
  try {
    const j = JSON.parse(await get("https://ubilling.net.ua/aerialalerts/", "application/json"));
    const log = ((prev.alerts && prev.alerts.log) || []).filter((e) => e.at >= iso(now - 7 * 864e5));
    const old = Object.fromEntries(((prev.alerts && prev.alerts.regions) || []).map((r) => [r.key, r]));
    const regions = Object.entries(j.states || {}).map(([k, v]) => {
      // the source gives 1970 when it has no change time: kept as "time not given", never read as a standing alert
      const g = region(k), t0 = kyivToUtc(v.changed), since = t0 && t0 >= "2022" ? t0 : "", on = !!v.alertnow;
      const o = old[k];
      if (!o || o.on !== on || o.since !== since) if (since && since >= iso(now - 7 * 864e5)) log.push({ key: k, en: g ? g.en : k, on, at: since });
      // an alert that has stood for more than 30 days (occupied Crimea and Luhansk) is a standing state, not an event
      return { key: k, en: g ? g.en : k, la: g ? g.la : null, lo: g ? g.lo : null, on, since, standing: on && since && since < iso(now - 30 * 864e5) };
    });
    const seen = new Set(); const uniq = log.filter((e) => { const x = e.key + e.at + e.on; if (seen.has(x)) return false; seen.add(x); return true; }).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 1500);
    alerts = { source: "Ukraine's official air-raid alert system, via the ubilling.net.ua public alert API", home: "https://wiki.ubilling.net.ua/doku.php?id=aerialalertsapi",
      claim: "Official alert state; an alert means a threat was declared, not that a strike happened.", read: stamp, cached_at_source: kyivToUtc(j.cachedat),
      regions: regions.sort((a, b) => a.en.localeCompare(b.en)), log: uniq, sha256: sha256(regions.map((r) => [r.key, r.on, r.since])) };
    sources.push({ id: "alerts", name: "Air-raid alerts (ubilling.net.ua)", ok: true, n: regions.filter((r) => r.on).length });
  } catch (e) { sources.push({ id: "alerts", name: "Air-raid alerts (ubilling.net.ua)", ok: false, error: errMsg(e) }); }

  /* ---- satellite heat (NASA FIRMS, past 24 h) ---- */
  let heat = prev.heat || null;
  {
    const pts = [], got = [];
    for (const [sat, url] of [["Suomi NPP", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv"],
      ["NOAA-20", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv"],
      ["NOAA-21", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_24h.csv"]]) {
      try {
        for (const r of csvObjs(await get(url, "text/csv"))) {
          const la = +r.latitude, lo = +r.longitude;
          if (!(la >= south && la <= north && lo >= west && lo <= east) || /^l/i.test(r.confidence || "")) continue;
          const cc = ccsAt(la, lo, 0)[0]; if (cc !== "ua" && cc !== "ru") continue;
          const t = (r.acq_date || "") + " " + String(r.acq_time || "").padStart(4, "0").replace(/(\d\d)(\d\d)/, "$1:$2") + "Z";
          pts.push([+la.toFixed(4), +lo.toFixed(4), +(+r.frp || 0).toFixed(1), t, sat, r.daynight === "D" ? "D" : "N", cc, occ && cc === "ua" && inPoly(lo, la, occ) ? 1 : 0]);
        }
        got.push(sat);
      } catch (e) { sources.push({ id: "firms-" + sat, name: "NASA FIRMS " + sat, ok: false, error: errMsg(e) }); }
    }
    if (got.length) {
      const day = new Date().toISOString().slice(0, 10), series = ((prev.heat && prev.heat.series) || []).filter((d) => d.d !== day && d.d >= iso(now - 90 * 864e5).slice(0, 10));
      const n = { ua: pts.filter((p) => p[6] === "ua" && !p[7]).length, occ: pts.filter((p) => p[7]).length, ru: pts.filter((p) => p[6] === "ru").length };
      series.push({ d: day, ...n });
      heat = { source: "NASA FIRMS (VIIRS active fire, " + got.join(", ") + "), past 24 hours", home: "https://firms.modaps.eosdis.nasa.gov/", licence: "NASA open data; cite NASA FIRMS",
        claim: "Heat detected from orbit. Cause unknown: strikes, shelling, farm, forest or industrial fires all show the same way.", read: stamp, counts: n,
        points: pts.sort((a, b) => b[2] - a[2]).slice(0, 4000), series: series.sort((a, b) => (a.d < b.d ? -1 : 1)) };
      sources.push({ id: "firms", name: "NASA FIRMS VIIRS 24 h", ok: true, n: pts.length });
    }
  }

  /* ---- Ukraine's General Staff loss claims ---- */
  let losses = prev.losses || null;
  try {
    const j = JSON.parse(await get("https://russianwarship.rip/api/v2/statistics/latest", "application/json")), d = j.data;
    if (!d || !d.stats) throw new Error("no stats in the reply");
    const series = ((prev.losses && prev.losses.series) || []).filter((x) => x.date !== d.date && x.date >= iso(now - 120 * 864e5).slice(0, 10));
    series.push({ date: d.date, stats: d.stats, increase: d.increase });
    losses = { claimant: "General Staff of the Armed Forces of Ukraine", via: "russianwarship.rip (republishes the General Staff's daily figures)", home: "https://russianwarship.rip/",
      claim: "Ukraine's claim about its enemy's losses. Not verified; Russia does not publish comparable figures.", date: d.date, day: d.day, link: /^https?:\/\//.test(d.resource || "") ? d.resource : "https://russianwarship.rip/",
      stats: d.stats, increase: d.increase, series: series.sort((a, b) => (a.date < b.date ? -1 : 1)), sha256: sha256({ date: d.date, stats: d.stats }) };
    sources.push({ id: "losses-ua", name: "Ukraine General Staff loss claims (russianwarship.rip)", ok: true, n: 1 });
  } catch (e) { sources.push({ id: "losses-ua", name: "Ukraine General Staff loss claims (russianwarship.rip)", ok: false, error: errMsg(e) }); }

  /* ---- each side's territorial claims and the Russian MoD daily summary ---- */
  const claims = new Map(((prev.claims && prev.claims.items) || []).filter((c) => c.date >= iso(now - 60 * 864e5) && c.v === 2).map((c) => [c.key, c]));
  let summary = prev.moc_summary || null;
  const addClaim = (side, claimant, place, verb, post) => {
    const p = String(place || "").replace(/[\s,.;:]+$/, "").trim(); if (!p || p.length > 60) return;
    const key = side + "|" + p.toLowerCase() + "|" + post.date.slice(0, 10);
    if (!claims.has(key)) claims.set(key, { v: 2, key, side, claimant, place: p, verb, date: iso(post.date), link: post.link, fp: sha256({ side, place: p, date: post.date, link: post.link }) });
  };
  // place lists as the posts write them: "A, B and C" / "А, Б та В"
  const split = (t) => String(t).split(/,\s*|\s+(?:and|та|і|й)\s+/).map((x) => x.trim()).filter(Boolean);
  try {
    const posts = tgItems(await get("https://t.me/s/mod_russia_en", "text/html"), "mod_russia_en");
    for (const po of posts) {
      const text = po.title + " " + po.summary;
      if (/progress of (?:the )?special military operation/i.test(text) && (!summary || iso(po.date) > summary.date))
        summary = { claimant: "Russian Ministry of Defence", date: iso(po.date), link: po.link, text: text.slice(0, 3000), claim: "Russia's claim, as posted. Not verified.", fp: sha256({ link: po.link, text }) };
      // "control has been established over the settlement of Khripuny (Kharkov region)", "liberated the settlements of A and B"
      for (const m of text.matchAll(/(?:control (?:has been|was) established over|liberated) (?:the )?(?:settlements?|villages?|towns?|cit(?:y|ies)) of ([^.;!]+)/gi))
        for (const pl of split(m[1].replace(/\s*\(([^)]*)\)/g, (x, r) => " (" + r + ")"))) addClaim("ru", "Russian Ministry of Defence", pl, "says Russian forces took", po);
    }
    sources.push({ id: "moc", name: "Russian Ministry of Defence (Telegram, English)", ok: true, n: posts.length });
  } catch (e) { sources.push({ id: "moc", name: "Russian Ministry of Defence (Telegram, English)", ok: false, error: errMsg(e) }); }
  try {
    // only DeepState's "map updated" posts, whose wording is fixed: "Ворог окупував A та просунувся поблизу B та C."
    const posts = tgItems(await get("https://t.me/s/DeepStateUA", "text/html"), "DeepStateUA").filter((po) => /Мапу оновлено/.test(po.title + " " + po.summary));
    for (const po of posts) {
      const text = (po.title + " " + po.summary).replace(/💬[\s\S]*$/, "");
      const occ = text.match(/(?:Ворог|противник|росіяни)\s+окупува(?:в|ли)\s+([^.]+?)(?:,?\s+(?:а також|та|і)\s+просуну|\.|$)/i);
      if (occ) for (const pl of split(occ[1])) addClaim("ua-osint", "DeepState", pl, "says Russia occupied", po);
      const adv = text.match(/просуну(?:вся|лися|лись)\s+(?:поблизу|біля|в районі|у районі|в|у)\s+([^.]+)/i);
      if (adv) for (const pl of split(adv[1])) addClaim("ua-osint", "DeepState", pl, "says Russia advanced near", po);
      const lib = text.match(/(?:ЗСУ|Сили оборони|українські військові)\s+(?:звільнили|деокупували|відновили контроль над)\s+([^.]+)/i);
      if (lib) for (const pl of split(lib[1])) addClaim("ua-osint", "DeepState", pl, "says Ukraine retook", po);
    }
    sources.push({ id: "deepstate-tg", name: "DeepState map updates (Telegram)", ok: true, n: posts.length });
  } catch (e) { sources.push({ id: "deepstate-tg", name: "DeepState map updates (Telegram)", ok: false, error: errMsg(e) }); }

  return { sources, alerts, heat, losses, moc_summary: summary,
    claims: { note: "Each side's own statements about places taken or lost, as posted; place names as the source writes them (DeepState in Ukrainian, grammatical case included). Not verified, and never used to draw or move the front line.",
      items: [...claims.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 300) } };
}
