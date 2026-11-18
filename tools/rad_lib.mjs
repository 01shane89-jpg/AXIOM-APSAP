// Radiation near nuclear sites, rules "rad-v1", fixed and versioned so every reading and flag can be explained.
// Run by tools/refresh_rad.mjs (.github/workflows/refresh-rad.yml).
//
// Source: Safecast's live sensor list (tt.safecast.org/devices, no key), CC0. Fixed Safecast sensors (bGeigie Zen,
// Pointcast, Radnote) report counts per minute (CPM) from a Geiger tube; OSAP converts them with the tube's published factor
// (LND 7317/7318: 334 CPM per uSv/h; LND 7128: 108). Volunteer and partner sensors, not an official network, not calibrated by
// OSAP. EURDEP (the EU network) is left out: its data may not be reused without each provider's written agreement.
//
// What a flag is: a sensor reading well above its own usual level (the median of its own hourly readings over the last 7
// days): at least RATIO times its usual AND at least ABOVE uSv/h above it, after HIST_MIN hours of history. A sensor near a
// reactor site can sit far above world background all the time (inside the Chornobyl zone, for example); its own usual is what
// counts. What it is not: a release, a confirmation, or a health measure. Rain washes natural radon daughters down and raises
// readings for hours; a moved or failing sensor jumps; one sensor alone proves nothing. No sensor within RADIUS km means no
// data, not no radiation.
export const RULES = "rad-v1", SCHEMA = "osap-rad/1";
export const RADIUS = 100, MAX_PER_SITE = 6, FRESH_H = 3, HIST_DAYS = 7, HIST_MIN = 24, RATIO = 1.5, ABOVE = 0.1;
export const SOURCE = { id: "safecast", name: "Safecast", url: "https://safecast.org/data/", api: "https://tt.safecast.org/devices", lic: "CC0 (public domain)", nc: false };
// tube field -> CPM per uSv/h (Safecast's published conversion factors)
export const TUBES = { lnd_7318c: 334, lnd_7318u: 334, lnd_7317: 334, lnd_7128ec: 108, lnd_712u: 108 };

// [id, name, country, lat, lon, what] public, well-known sites; positions to about 1 km
export const SITES = [
  ["zaporizhzhia", "Zaporizhzhia nuclear power plant", "ua", 47.511, 34.585, "power plant, 6 reactors"],
  ["chornobyl", "Chornobyl nuclear power plant (shut down)", "ua", 51.389, 30.099, "shut-down plant and exclusion zone"],
  ["south-ukraine", "South Ukraine nuclear power plant", "ua", 47.817, 31.220, "power plant, 3 reactors"],
  ["khmelnytskyi", "Khmelnytskyi nuclear power plant", "ua", 50.302, 26.650, "power plant, 2 reactors"],
  ["rivne", "Rivne nuclear power plant", "ua", 51.328, 25.893, "power plant, 4 reactors"],
  ["kursk", "Kursk nuclear power plant", "ru", 51.675, 35.606, "power plant"],
  ["novovoronezh", "Novovoronezh nuclear power plant", "ru", 51.275, 39.217, "power plant"],
  ["leningrad", "Leningrad nuclear power plant", "ru", 59.845, 29.045, "power plant"],
  ["kola", "Kola nuclear power plant", "ru", 67.467, 32.467, "power plant"],
  ["belarus", "Belarusian nuclear power plant (Astravets)", "by", 54.763, 26.092, "power plant"],
  ["akkuyu", "Akkuyu nuclear power plant", "tr", 36.144, 33.541, "power plant"],
  ["bushehr", "Bushehr nuclear power plant", "ir", 28.829, 50.886, "power plant"],
  ["natanz", "Natanz enrichment site", "ir", 33.724, 51.727, "uranium enrichment"],
  ["fordow", "Fordow enrichment site", "ir", 34.884, 50.996, "uranium enrichment"],
  ["isfahan", "Isfahan nuclear technology centre", "ir", 32.597, 51.827, "uranium conversion"],
  ["barakah", "Barakah nuclear power plant", "ae", 23.959, 52.257, "power plant"],
  ["dimona", "Shimon Peres Negev Nuclear Research Center (Dimona)", "il", 31.001, 35.145, "research reactor"],
  ["yongbyon", "Yongbyon nuclear scientific research center", "kp", 39.796, 125.755, "reactors and reprocessing"],
  ["kanupp", "Karachi nuclear power plant", "pk", 24.847, 66.789, "power plant"],
  ["kudankulam", "Kudankulam nuclear power plant", "in", 8.168, 77.713, "power plant"],
  ["fukushima", "Fukushima Daiichi (being decommissioned)", "jp", 37.421, 141.033, "plant being decommissioned"],
  ["taiwan-maanshan", "Maanshan nuclear power plant", "tw", 21.958, 120.751, "power plant (shut down 2025)"],
  ["kori", "Kori nuclear power plant", "kr", 35.320, 129.290, "power plant"],
];

export function km(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
  return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
}
export function median(a) { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; }

/** one Safecast device to { id, name, la, lo, t (ISO), cpm, tube, usv } or null (no tube, no position, too old, implausible) */
export function reading(d, now = Date.now()) {
  if (!d || typeof d !== "object") return null;
  const la = +d.loc_lat, lo = +d.loc_lon, t = Date.parse(d.when_captured);
  if (!isFinite(la) || !isFinite(lo) || (la === 0 && lo === 0) || !isFinite(t)) return null;
  if (now - t > FRESH_H * 36e5 || t - now > 10 * 60e3) return null;
  for (const [k, f] of Object.entries(TUBES)) {
    const cpm = +d[k];
    if (!isFinite(cpm) || cpm <= 0) continue;
    const usv = cpm / f;
    if (usv > 1000) return null; // a broken tube, not a reading
    const id = String(d.device_urn || d.device || "").replace(/[^\w:.-]/g, "").slice(0, 60);
    if (!id) return null;
    return { id, name: String(d.loc_name || "").slice(0, 60), cc: String(d.loc_country || "").slice(0, 2).toLowerCase(), la: +la.toFixed(4), lo: +lo.toFixed(4),
      t: new Date(t).toISOString().slice(0, 16) + "Z", cpm: Math.round(cpm * 10) / 10, tube: k, usv: Math.round(usv * 1000) / 1000 };
  }
  return null;
}

/** adds a reading to the device's hourly history (one value per UTC hour, the latest wins), trims to HIST_DAYS */
export function addHistory(hist, r, now = Date.now()) {
  const a = (hist[r.id] = hist[r.id] || []), h = r.t.slice(0, 13);
  const i = a.findIndex((x) => x[0] === h);
  if (i >= 0) a[i] = [h, r.usv]; else a.push([h, r.usv]);
  const from = new Date(now - HIST_DAYS * 864e5).toISOString().slice(0, 13);
  hist[r.id] = a.filter((x) => x[0] >= from).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  return hist;
}
export function forget(hist, now = Date.now()) {
  const from = new Date(now - HIST_DAYS * 864e5).toISOString().slice(0, 13);
  for (const k of Object.keys(hist)) { hist[k] = hist[k].filter((x) => x[0] >= from); if (!hist[k].length) delete hist[k]; }
  return hist;
}
/** the device's usual level: median of its hourly readings, leaving out the last 3 hours; null under HIST_MIN hours */
export function usual(hist, id, now = Date.now()) {
  const cut = new Date(now - 3 * 36e5).toISOString().slice(0, 13), a = (hist[id] || []).filter((x) => x[0] < cut).map((x) => x[1]);
  return a.length >= HIST_MIN ? Math.round(median(a) * 1000) / 1000 : null;
}
/** "above" (well above its own usual), "usual", or "new" (not enough history yet) */
export function status(usv, base) {
  if (base == null) return "new";
  return usv >= base * RATIO && usv - base >= ABOVE ? "above" : "usual";
}

/** per site: the nearest MAX_PER_SITE readings within RADIUS km, with their usual level and status */
export function sitePicture(readings, hist, now = Date.now()) {
  return SITES.map(([id, name, cc, la, lo, what]) => {
    const near = readings.map((r) => ({ r, k: km(la, lo, r.la, r.lo) })).filter((x) => x.k <= RADIUS).sort((a, b) => a.k - b.k).slice(0, MAX_PER_SITE)
      .map(({ r, k }) => { const base = usual(hist, r.id, now); return { ...r, km: Math.round(k), base, st: status(r.usv, base) }; });
    const above = near.filter((x) => x.st === "above").length;
    return { id, name, cc, la, lo, what, n: near.length, above, st: !near.length ? "none" : above ? "above" : near.every((x) => x.st === "new") ? "new" : "usual", near };
  });
}
