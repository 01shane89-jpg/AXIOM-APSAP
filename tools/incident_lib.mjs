// Incident candidates for the Deep South (Conflict Coverage plan, Phase 2): which captured reports may describe the same event.
// This is a SUGGESTION, rebuilt from the capture and claim records on every run; it is not an incident record and decides nothing.
// Only an analyst can merge reports into an incident or split one (not built yet). Rules, all conservative:
//   copies      reports with the same headline words (case, punctuation and an outlet suffix ignored) within 72 hours are one
//               originator: syndication and search mirrors never count as independent confirmation;
//   candidate   reports join when they name the SAME district, their event kinds agree (or one has none), and each is within
//               36 hours of the candidate's first report. Similar wording alone never joins reports; two districts never join;
//   province    a report placed only by province joins nothing: it is listed with the candidates it could belong to;
//   nearby      candidates in the same district and time but of different kinds point at each other (not joined);
//   figures     differing death or injury figures stay side by side as a contradiction, never averaged or overwritten.
// Times are the source's own time where it gave one, else OSAP's first sighting (time_basis says which).
import crypto from "node:crypto";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const WINDOW_H = 36, COPY_H = 72;
const ms = (t) => Date.parse(String(t).slice(0, 16) + ":00Z");

// headline words for copy detection: lower case, no punctuation, no trailing " - Outlet" / " | Outlet"
export function headKey(title) {
  return String(title || "").replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// captures: latest revision per capture_id; claims: all claims. Returns one report per capture with its claims folded in.
export function reports(captures, claims, translations = []) {
  const tr = new Map(translations.map((t) => [t.parent + "#" + t.parent_rev, t]));
  const byCap = new Map();
  for (const c of claims) {
    const e = c.evidence[0]; const k = e.capture_id + "#" + e.rev;
    if (!byCap.has(k)) byCap.set(k, []);
    byCap.get(k).push(c);
  }
  return captures.map((cap) => {
    const cs = byCap.get(cap.capture_id + "#" + cap.rev) || [];
    const one = (p) => cs.find((c) => c.predicate === p);
    const t = tr.get(cap.capture_id + "#" + cap.rev);
    return {
      capture_id: cap.capture_id, rev: cap.rev, source_id: cap.source_id, outlet: cap.outlet, url: cap.url, discovery: !!cap.discovery,
      title: cap.title, title_en: t ? t.title_en : null, lang: cap.lang,
      time: cap.published || cap.observed, time_basis: cap.published ? "published" : "first seen",
      kind: one("event_type")?.value.kind || null,
      districts: cs.filter((c) => c.predicate === "location" && c.value.level === "district").map((c) => c.value.place_id),
      provinces: cs.filter((c) => c.predicate === "location" && c.value.level === "province").map((c) => c.value.place_id),
      killed: one("killed")?.value.n ?? null, injured: one("injured")?.value.n ?? null,
      claims: cs.map((c) => c.claim_id),
    };
  }).filter((r) => r.kind || r.districts.length || r.provinces.length);
}

// Pure. parentOf: district id -> province id.
export function suggest(reps, parentOf) {
  const rs = [...reps].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.capture_id < b.capture_id ? -1 : 1));
  // copies: same headline words within COPY_H; the earliest is the originator
  const firstByKey = new Map();
  for (const r of rs) {
    const k = headKey(r.title); if (!k) continue;
    const o = firstByKey.get(k);
    if (o && ms(r.time) - ms(o.time) <= COPY_H * 36e5) r.copy_of = o.capture_id; else firstByKey.set(k, r);
  }
  const origin = (r) => r.copy_of || r.capture_id;
  const kindsAgree = (a, b) => !a || !b || a === b;
  const cands = [], loose = [];
  for (const r of rs) {
    if (r.districts.length !== 1) { if (r.districts.length === 0 && r.provinces.length) loose.push(r); else if (r.districts.length > 1) loose.push({ ...r, why: "names more than one district" }); continue; }
    const d = r.districts[0];
    const c = cands.find((c) => c.place_id === d && kindsAgree(c.kind, r.kind) && ms(r.time) - ms(c.first) <= WINDOW_H * 36e5 && ms(r.time) >= ms(c.first));
    if (c) { c.reports.push(r); c.last = r.time; c.kind = c.kind || r.kind; }
    else cands.push({ place_id: d, province_id: parentOf[d] || null, kind: r.kind, first: r.time, last: r.time, reports: [r] });
  }
  const out = cands.map((c) => {
    const fig = (p) => { const m = new Map(); for (const r of c.reports) if (r[p] != null) { if (!m.has(r[p])) m.set(r[p], []); m.get(r[p]).push(r.capture_id); } return [...m].map(([n, caps]) => ({ n, captures: caps })); };
    const killed = fig("killed"), injured = fig("injured");
    const contradictions = [];
    if (killed.length > 1) contradictions.push("killed: " + killed.map((x) => x.n).join(" vs "));
    if (injured.length > 1) contradictions.push("injured: " + injured.map((x) => x.n).join(" vs "));
    const originators = new Set(c.reports.map(origin));
    return {
      candidate_id: "cand-" + sha(c.reports[0].capture_id).slice(0, 12),
      status: "machine-suggested candidate, not reviewed",
      kind: c.kind, place_id: c.place_id, province_id: c.province_id, location_level: "district",
      first: c.first, last: c.last, reports: c.reports.map((r) => ({ capture_id: r.capture_id, rev: r.rev, outlet: r.outlet, url: r.url,
        time: r.time, time_basis: r.time_basis, title: r.title, title_en: r.title_en || undefined, killed: r.killed, injured: r.injured,
        ...(r.copy_of ? { copy_of: r.copy_of } : {}), ...(r.discovery ? { discovery: true } : {}) })),
      originators: originators.size,
      figures: { killed, injured }, contradictions,
    };
  });
  // same district, overlapping time, different kinds (a bomb-and-arson night is often reported both ways): pointed at each other,
  // never joined
  for (const c of out) c.nearby = out.filter((o) => o !== c && o.place_id === c.place_id && o.kind !== c.kind &&
    ms(o.first) <= ms(c.last) + WINDOW_H * 36e5 && ms(c.first) <= ms(o.last) + WINDOW_H * 36e5).map((o) => o.candidate_id);
  // province-only reports: listed with the candidates they could belong to (same province, kinds agree, inside the window)
  const unplaced = loose.map((r) => ({
    capture_id: r.capture_id, outlet: r.outlet, url: r.url, time: r.time, title: r.title, title_en: r.title_en || undefined, kind: r.kind,
    provinces: r.provinces, districts: r.districts.length ? r.districts : undefined, why: r.why || "placed only by province",
    could_match: out.filter((c) => (r.provinces.includes(c.province_id) || r.districts.includes(c.place_id)) && kindsAgree(c.kind, r.kind) &&
      Math.abs(ms(r.time) - ms(c.first)) <= WINDOW_H * 36e5).map((c) => c.candidate_id),
  }));
  return { candidates: out, unplaced, copies: rs.filter((r) => r.copy_of).length };
}

// Reads the append-only stores and builds the suggestion file (a projection: deleting it loses nothing).
import fs from "node:fs";
import path from "node:path";
export function readStore(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort())
    for (const f of fs.readdirSync(path.join(dir, d)).filter((f) => f.endsWith(".ndjson")).sort())
      for (const line of fs.readFileSync(path.join(dir, d, f), "utf8").split("\n")) if (line.trim()) { try { out.push(JSON.parse(line)); } catch (e) {} }
  return out;
}
export function build(capDir, claimDir, places, asof) {
  const recs = readStore(capDir), latest = new Map();
  for (const r of recs) if (r.type === "capture" && (!latest.has(r.capture_id) || latest.get(r.capture_id).rev < r.rev)) latest.set(r.capture_id, r);
  const parentOf = Object.fromEntries(places.filter((p) => p.parent).map((p) => [p.id, p.parent]));
  const reps = reports([...latest.values()], readStore(claimDir).filter((c) => c.type === "claim"), recs.filter((r) => r.type === "translation"));
  const s = suggest(reps, parentOf);
  return { schema: "osap-incident-candidates/1", asof,
    note: "Machine suggestions of which captured reports may describe the same event (tools/incident_lib.mjs). Not incidents, not reviewed: rebuilt from data/captures and data/claims on every run. Copies are one originator; reports join only on the same district, agreeing kinds and within 36 hours; province-only reports are listed apart with the candidates they could match; differing figures are kept as contradictions.",
    totals: { reports: reps.length, candidates: s.candidates.length, multi_report: s.candidates.filter((c) => c.reports.length > 1).length,
      with_contradictions: s.candidates.filter((c) => c.contradictions.length).length, unplaced: s.unplaced.length, copies: s.copies },
    candidates: s.candidates.sort((a, b) => (a.last < b.last ? 1 : -1)), unplaced: s.unplaced };
}
