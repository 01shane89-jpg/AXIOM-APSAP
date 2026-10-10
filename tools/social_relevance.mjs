// Relevance over social posts, in shadow mode (Conflict Coverage plan, Phase 1, step 3).
// The news relevance policy (tools/relevance.json, tools/topics_lib.mjs) has only ever filtered news; social posts reach the page
// unfiltered (a Thai PBS cookery segment sat in Thailand's social list on 2026-10-03). This step checks every post in the live
// social snapshot against the same policy and writes what it WOULD hide, with the reason, to data/live/social-relevance.json.
// Nothing is hidden: the page and data/live/social.js are not changed. The report is for measuring false negatives (relevant
// posts the policy would drop) before any filter is switched on.
// Each verdict carries the policy version (relevance.json's schema plus the first 12 hex of its SHA-256), so a later change to the
// word lists is visible in the report. Run after tools/refresh_social.mjs, or by hand: node tools/social_relevance.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compileRelevance, itemRelevance, kept, fold } from "./topics_lib.mjs";

// the word that decided a verdict, for the report (the policy itself decides; this only explains it)
function why(R, i, rel) {
  if (rel === "unchecked") return i.mt === "untranslated" ? "not translated" : "not in English";
  if (rel === "none") return "no listed word";
  if (i.exempt) return "exempt outlet";
  const re = R[rel === "strong" ? "strong" : rel === "drop" ? "drop" : "keep"];
  const text = [i.title_en || i.title, i.title, String(i.summary_en || i.summary || "").slice(0, 400)].join(" \n ");
  const m = re && new RegExp(re.source, re.flags.replace("g", "")).exec(fold(text));
  return m ? m[0].trim() : rel;
}

// social: the ASAP_SOCIAL object ({ asof, items: { cc: [post] } }). skip: country codes left out of the report entirely (the hidden
// areas, tools/hidden-areas.json: this report is a shared file and is not sealed). Pure: returns the report.
export function shadow(R, social, policy, sampleMax = 300, skip = []) {
  const counts = {}, hidden = [], totals = { posts: 0, would_hide: 0, strong: 0, keep: 0, unchecked: 0, drop: 0, none: 0 }, off = new Set(skip);
  for (const [cc, list] of Object.entries(social.items || {})) {
    if (off.has(cc)) continue;
    const c = (counts[cc] = { posts: 0, would_hide: 0 });
    for (const i of list || []) {
      const rel = itemRelevance(R, i);
      c.posts++; totals.posts++; totals[rel]++;
      if (!kept(rel)) {
        c.would_hide++; totals.would_hide++;
        hidden.push({ cc, platform: i.platform, account: i.account, date: i.date, title: String(i.title || "").slice(0, 200),
          title_en: i.title_en && i.title_en !== i.title ? String(i.title_en).slice(0, 200) : undefined, lang: i.lang || undefined, rel, why: why(R, i, rel), link: i.link });
      }
    }
  }
  hidden.sort((a, b) => ((b.date || "") > (a.date || "") ? 1 : -1));
  return { schema: "osap-social-relevance/1", mode: "shadow (nothing is hidden)", asof: social.asof || "", policy, totals, counts,
    sample_note: "the newest " + sampleMax + " posts the policy would hide, with the deciding word or reason, for review",
    would_hide_sample: hidden.slice(0, sampleMax) };
}

export function policyVersion(text) {
  let schema = "unknown"; try { schema = JSON.parse(text).schema || schema; } catch (e) {}
  return schema + "@" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const relText = fs.readFileSync("tools/relevance.json", "utf8");
  const R = compileRelevance(JSON.parse(relText), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
  const t = fs.readFileSync("data/live/social.js", "utf8");
  const social = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  const skip = JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8")).hidden || [];
  const rep = shadow(R, social, policyVersion(relText), 300, skip);
  fs.writeFileSync("data/live/social-relevance.json", JSON.stringify(rep));
  const T = rep.totals;
  console.log(`social relevance (shadow, policy ${rep.policy}): ${T.posts} posts; would hide ${T.would_hide} ` +
    `(drop word ${T.drop}, no listed word ${T.none}); kept: strong ${T.strong}, keep ${T.keep}, unchecked ${T.unchecked}`);
}
