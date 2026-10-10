// Relevance check sample for social posts (Conflict Coverage plan, Phase 2): a fixed set of posts, labelled by hand, against which
// every version of the relevance policy (tools/relevance.json) is measured before any social filter is switched on.
// Shane chose 400 posts (2026-10-10). The sample is stratified so both kinds of error can be measured:
//   would-hide posts  -> how many relevant posts the policy would lose (false hides, the error the plan cares most about);
//   kept posts        -> how many irrelevant posts it would let through (false keeps).
// A quarter of the sample comes from the pilot's countries (Thailand, Malaysia) so Thai and Malay posts are in it.
// Selection is deterministic (posts ordered by SHA-256 of seed + link), so the same snapshot and seed give the same sample.
// Posts from hidden areas (tools/hidden-areas.json) are never sampled: this file is shared and not sealed.
//
//   node tools/relevance_sample.mjs new [seed]   writes tools/eval/social-relevance-sample.json from data/live/social.js
//   node tools/relevance_sample.mjs eval         scores the current policy against the labelled sample
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compileRelevance, itemRelevance, kept } from "./topics_lib.mjs";
import { policyVersion } from "./social_relevance.mjs";

export const SAMPLE = "tools/eval/social-relevance-sample.json";
export const PILOT = ["th", "my"];
export const ALLOC = { pilot_hide: 50, pilot_keep: 50, other_hide: 150, other_keep: 150 };
export const LABELS = ["relevant", "not_relevant", "unclear"];

const h = (s) => crypto.createHash("sha256").update(s).digest("hex");
const verdictOf = (R, i) => { const rel = itemRelevance(R, i); return { rel, verdict: kept(rel) ? "keep" : "hide" }; };

// Pure: picks the sample. A short group is topped up from the same verdict elsewhere, so the total stays at the target when it can.
export function pick(R, social, { seed = "1", alloc = ALLOC, skip = [] } = {}) {
  const off = new Set(skip), groups = { pilot_hide: [], pilot_keep: [], other_hide: [], other_keep: [] }, seen = new Set();
  for (const [cc, list] of Object.entries(social.items || {})) {
    if (off.has(cc)) continue;
    for (const i of list || []) {
      if (!i || !i.link || seen.has(i.link)) continue;
      seen.add(i.link);
      const { rel, verdict } = verdictOf(R, i);
      groups[(PILOT.includes(cc) ? "pilot_" : "other_") + verdict].push({ cc, i, rel, verdict, k: h(seed + "\n" + i.link) });
    }
  }
  for (const g of Object.values(groups)) g.sort((a, b) => (a.k < b.k ? -1 : 1));
  const out = [], taken = {};
  for (const [g, n] of Object.entries(alloc)) { const x = groups[g].splice(0, n); taken[g] = x.length; out.push(...x.map((e) => ({ ...e, group: g }))); }
  for (const v of ["hide", "keep"]) {   // top up a short pilot or other group from its partner with the same verdict
    const want = alloc["pilot_" + v] + alloc["other_" + v], have = taken["pilot_" + v] + taken["other_" + v];
    const spare = [...groups["other_" + v], ...groups["pilot_" + v]].sort((a, b) => (a.k < b.k ? -1 : 1)).slice(0, Math.max(0, want - have));
    out.push(...spare.map((e) => ({ ...e, group: (PILOT.includes(e.cc) ? "pilot_" : "other_") + v, topup: true })));
  }
  const population = Object.fromEntries(Object.entries(groups).map(([g, x]) => [g, x.length + (taken[g] || 0)]));
  return { population, items: out.map((e, n) => ({ n: n + 1, group: e.group, cc: e.cc, platform: e.i.platform, account: e.i.account,
    lang: e.i.lang || null, date: e.i.date, title: String(e.i.title || "").slice(0, 300),
    title_en: e.i.title_en && e.i.title_en !== e.i.title ? String(e.i.title_en).slice(0, 300) : undefined,
    summary: e.i.summary ? String(e.i.summary).slice(0, 300) : undefined,
    summary_en: e.i.summary_en ? String(e.i.summary_en).slice(0, 300) : undefined,
    mt: e.i.mt, link: e.i.link, verdict_at_sampling: e.verdict, label: null })) };
}

// Wilson 95% interval for k of n
export function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

// Pure: scores a policy against the labelled sample. Each post is re-checked with the CURRENT policy (its stored text), so a policy
// change is measured on the same posts. "unclear" and unlabelled posts are counted but left out of the rates.
// Rates are per stratum (verdict now): false_hide = relevant among posts the policy would hide; false_keep = not relevant among kept.
export function score(R, sample) {
  const cell = () => ({ relevant: 0, not_relevant: 0, unclear: 0, unlabelled: 0 });
  const by = { hide: cell(), keep: cell() };
  for (const s of sample.items) {
    const i = { title: s.title, title_en: s.title_en || s.title, summary: s.summary, summary_en: s.summary_en, mt: s.mt, lang: s.lang };
    const v = verdictOf(R, i).verdict;
    by[v][LABELS.includes(s.label) ? s.label : "unlabelled"]++;
  }
  const rate = (k, n) => ({ k, n, rate: n ? +(k / n).toFixed(3) : null, ci95: wilson(k, n).map((x) => +x.toFixed(3)) });
  const out = {
    false_hide: rate(by.hide.relevant, by.hide.relevant + by.hide.not_relevant),
    false_keep: rate(by.keep.not_relevant, by.keep.relevant + by.keep.not_relevant),
    counts: by,
  };
  // Whole-snapshot estimates, weighting each verdict's rate by how many posts had that verdict when the sample was drawn
  // (only meaningful while the policy is the one the sample was drawn with; a later policy moves posts between verdicts).
  const P = sample.population || {}, ph = (P.pilot_hide || 0) + (P.other_hide || 0), pk = (P.pilot_keep || 0) + (P.other_keep || 0);
  if (ph + pk && out.false_hide.n && out.false_keep.n) {
    const relHide = ph * out.false_hide.rate, relKeep = pk * (1 - out.false_keep.rate);
    out.estimate = { posts: ph + pk, recall: +(relKeep / (relKeep + relHide)).toFixed(3), precision: +(1 - out.false_keep.rate).toFixed(3),
      note: "recall = share of relevant posts the policy keeps; precision = share of kept posts that are relevant; unclear posts left out" };
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const relText = fs.readFileSync("tools/relevance.json", "utf8");
  const R = compileRelevance(JSON.parse(relText), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
  const cmd = process.argv[2];
  if (cmd === "new") {
    if (fs.existsSync(SAMPLE) && !process.env.REPLACE) { console.error(SAMPLE + " exists (labels would be lost); set REPLACE=1 to replace it"); process.exit(1); }
    const t = fs.readFileSync("data/live/social.js", "utf8"), social = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
    const skip = JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8")).hidden || [];
    const seed = process.argv[3] || "1", { population, items } = pick(R, social, { seed, skip });
    fs.mkdirSync(path.dirname(SAMPLE), { recursive: true });
    const body = items.map((x) => "  " + JSON.stringify(x)).join(",\n");
    const head = { schema: "osap-relevance-sample/1", snapshot: "data/live/social.js " + (social.asof || ""), policy_at_sampling: policyVersion(relText), seed,
      allocation: ALLOC, population,
      label_rule: "relevant = a post an intelligence analyst or a US SOF team in that country would want: security, conflict, crime, politics and government, disasters and weather, health emergencies, transport and service disruption, economy affecting stability, foreign affairs. not_relevant = sport, celebrity, entertainment, lifestyle, promotions, routine ceremonies with no security or policy content. unclear = cannot tell from the text.",
      labelled_by: null };
    fs.writeFileSync(SAMPLE, JSON.stringify(head, null, 1).replace(/\n\}$/, ",\n \"items\": [\n") + body + "\n ]\n}\n");
    console.log("sample:", items.length, "posts", JSON.stringify(population));
  } else if (cmd === "eval") {
    const s = JSON.parse(fs.readFileSync(SAMPLE, "utf8")), r = score(R, s);
    console.log(JSON.stringify({ policy: policyVersion(relText), labelled_by: s.labelled_by, ...r }, null, 1));
  } else { console.error("usage: node tools/relevance_sample.mjs new [seed] | eval"); process.exit(2); }
}
