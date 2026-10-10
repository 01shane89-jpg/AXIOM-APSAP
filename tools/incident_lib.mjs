// Incident candidates for the Deep South (Conflict Coverage plan, Phase 2): which captured reports may describe the same event.
// This is a SUGGESTION, rebuilt from the capture and claim records on every run; it is not an incident record and decides nothing.
// Only an analyst can merge reports into an incident or split one: their decisions (tools/decision_lib.mjs, data/decisions) are
// applied on top of the suggestions every run. Rules, all conservative:
//   copies      reports with the same headline words (case, punctuation and an outlet suffix ignored) within 72 hours are one
//               originator: syndication and search mirrors never count as independent confirmation;
//   candidate   reports join when they name the SAME district, their event kinds agree (or one has none), and each is within
//               36 hours of the candidate's first report. Similar wording alone never joins reports; two districts never join;
//   province    a report placed only by province joins nothing: it is listed with the candidates it could belong to;
//   nearby      candidates in the same district and time but of different kinds point at each other (not joined);
//   figures     differing death or injury figures stay side by side as a contradiction, never averaged or overwritten.
//   analyst     reports an analyst said are one incident form one candidate marked "analyst-confirmed", whatever the rules say;
//               a report an analyst said is a different incident is never joined with those reports; an analyst's assessment of a
//               claim is shown beside the claim (the claim itself is never changed).
// Times are the source's own time where it gave one, else OSAP's first sighting (time_basis says which).
import crypto from "node:crypto";
import { inForce } from "./decision_lib.mjs";

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
      claims: cs.map((c) => ({ claim_id: c.claim_id, predicate: c.predicate, value: c.predicate === "location" ? c.value.name : c.predicate === "event_type" ? c.value.kind : c.value.n })),
    };
  }).filter((r) => r.kind || r.districts.length || r.provinces.length);
}

// Pure. parentOf: district id -> province id. analyst: tools/decision_lib.mjs inForce() over the decision records (or none).
export function suggest(reps, parentOf, analyst = inForce([])) {
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
  // analyst groups first: their reports form one candidate each and take no part in the rules below
  const inGroup = new Map(), byId = new Map(rs.map((r) => [r.capture_id, r]));
  for (const g of analyst.groups) {
    const reps = g.reports.map((id) => byId.get(id)).filter(Boolean); if (reps.length < 2) continue;
    for (const r of reps) inGroup.set(r.capture_id, g);
    const ds = [...new Set(reps.flatMap((r) => r.districts))], ks = reps.map((r) => r.kind).filter(Boolean);
    const kind = ks.length ? Object.entries(ks.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0][0] : null;
    cands.push({ analyst: g, place_id: ds.length === 1 ? ds[0] : null, places: ds, province_id: ds.length === 1 ? parentOf[ds[0]] || null : null,
      kind, first: reps[0].time, last: reps[reps.length - 1].time, reports: reps });
  }
  const apartFrom = (r, c) => c.reports.some((o) => analyst.apart(r.capture_id, o.capture_id));
  for (const r of rs) {
    if (inGroup.has(r.capture_id)) continue;
    if (r.districts.length !== 1) { if (r.districts.length === 0 && r.provinces.length) loose.push(r); else if (r.districts.length > 1) loose.push({ ...r, why: "names more than one district" }); continue; }
    const d = r.districts[0];
    const c = cands.find((c) => !c.analyst && c.place_id === d && kindsAgree(c.kind, r.kind) && ms(r.time) - ms(c.first) <= WINDOW_H * 36e5 && ms(r.time) >= ms(c.first) && !apartFrom(r, c));
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
    const kept = c.reports.flatMap((r) => rs.filter((o) => o.capture_id !== r.capture_id && analyst.apart(r.capture_id, o.capture_id))
      .map((o) => ({ report: r.capture_id, from: o.capture_id, decision_id: analyst.apart(r.capture_id, o.capture_id) })));
    return {
      candidate_id: c.analyst ? "inc-" + sha(c.analyst.group_id).slice(0, 12) : "cand-" + sha(c.reports[0].capture_id).slice(0, 12),
      status: c.analyst ? "analyst-confirmed: one incident" : "machine-suggested candidate, not reviewed",
      ...(c.analyst ? { decisions: c.analyst.decisions } : {}), ...(kept.length ? { kept_apart: kept } : {}),
      kind: c.kind, place_id: c.place_id, province_id: c.province_id, location_level: c.place_id ? "district" : "none",
      ...(c.places && c.places.length > 1 ? { places: c.places } : {}),
      first: c.first, last: c.last, reports: c.reports.map((r) => ({ capture_id: r.capture_id, rev: r.rev, outlet: r.outlet, url: r.url,
        time: r.time, time_basis: r.time_basis, title: r.title, title_en: r.title_en || undefined, killed: r.killed, injured: r.injured,
        claims: (r.claims || []).map((x) => (analyst.assess.has(x.claim_id) ? { ...x, assessment: analyst.assess.get(x.claim_id) } : x)),
        ...(r.copy_of ? { copy_of: r.copy_of } : {}), ...(r.discovery ? { discovery: true } : {}) })),
      originators: originators.size,
      figures: { killed, injured }, contradictions,
    };
  });
  // same district, overlapping time, different kinds (a bomb-and-arson night is often reported both ways): pointed at each other,
  // never joined
  for (const c of out) c.nearby = !c.place_id ? [] : out.filter((o) => o !== c && o.place_id === c.place_id && o.kind !== c.kind &&
    ms(o.first) <= ms(c.last) + WINDOW_H * 36e5 && ms(c.first) <= ms(o.last) + WINDOW_H * 36e5).map((o) => o.candidate_id);
  // province-only reports: listed with the candidates they could belong to (same province, kinds agree, inside the window)
  const unplaced = loose.map((r) => ({
    capture_id: r.capture_id, outlet: r.outlet, url: r.url, time: r.time, title: r.title, title_en: r.title_en || undefined, kind: r.kind,
    provinces: r.provinces, districts: r.districts.length ? r.districts : undefined, why: r.why || "placed only by province",
    could_match: out.filter((c) => (r.provinces.includes(c.province_id) || r.districts.includes(c.place_id)) && kindsAgree(c.kind, r.kind) &&
      Math.abs(ms(r.time) - ms(c.first)) <= WINDOW_H * 36e5 && !apartFrom(r, c)).map((c) => c.candidate_id),
    claims: (r.claims || []).map((x) => (analyst.assess.has(x.claim_id) ? { ...x, assessment: analyst.assess.get(x.claim_id) } : x)),
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
export function build(capDir, claimDir, places, asof, decDir = null) {
  const recs = readStore(capDir), latest = new Map();
  for (const r of recs) if (r.type === "capture" && (!latest.has(r.capture_id) || latest.get(r.capture_id).rev < r.rev)) latest.set(r.capture_id, r);
  const parentOf = Object.fromEntries(places.filter((p) => p.parent).map((p) => [p.id, p.parent]));
  // a record can be on file twice (a run that started from an old copy of the store wrote it again): each claim and decision counts once
  const once = (a, k) => { const seen = new Set(); return a.filter((x) => !seen.has(x[k]) && seen.add(x[k])); };
  const reps = reports([...latest.values()], once(readStore(claimDir).filter((c) => c.type === "claim"), "claim_id"), recs.filter((r) => r.type === "translation"));
  const analyst = inForce(decDir ? once(readStore(decDir), "decision_id") : []);
  const s = suggest(reps, parentOf, analyst);
  const name = Object.fromEntries(places.map((p) => [p.id, p.name]));
  for (const c of s.candidates) { c.place_name = name[c.place_id] || null; c.province_name = name[c.province_id] || null; }
  return { schema: "osap-incident-candidates/1", asof,
    note: "Machine suggestions of which captured reports may describe the same event (tools/incident_lib.mjs). Not incidents, not reviewed: rebuilt from data/captures and data/claims on every run. Copies are one originator; reports join only on the same district, agreeing kinds and within 36 hours; province-only reports are listed apart with the candidates they could match; differing figures are kept as contradictions. Candidates marked analyst-confirmed, reports kept apart and claim assessments come from the owner's recorded decisions (data/decisions/deepsouth).",
    totals: { reports: reps.length, candidates: s.candidates.length, multi_report: s.candidates.filter((c) => c.reports.length > 1).length,
      with_contradictions: s.candidates.filter((c) => c.contradictions.length).length, unplaced: s.unplaced.length, copies: s.copies,
      analyst_confirmed: s.candidates.filter((c) => c.decisions).length, decisions: analyst.count, claims_assessed: analyst.assess.size },
    candidates: s.candidates.sort((a, b) => (a.last < b.last ? 1 : -1)), unplaced: s.unplaced };
}
