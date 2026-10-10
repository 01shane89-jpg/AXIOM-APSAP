// Relevance over social posts (Conflict Coverage plan, Phase 1 step 3, switched on 2026-10-10).
// The news relevance policy (tools/relevance.json, tools/topics_lib.mjs) was written for headlines; social posts are mostly TV and
// radio desks' video titles, and reached the page unfiltered (a Thai PBS cookery segment sat in Thailand's social list on 2026-10-03,
// football and celebrity clips beside it). This step checks every post against the news policy plus the social rules
// (tools/relevance-social.json) and, while that file's "mode" is "on", marks each post the rules leave out with left_out: the word
// or reason that decided it. Nothing is deleted: the page shows left-out posts behind "Show left-out posts", and the marks are
// redone on every run (live snapshot and stored history alike), so a change to the word lists reaches every stored post.
// "mode": "shadow" clears the marks and only reports. The report, data/live/social-relevance.json, lists what was left out and why,
// with the policy version (each file's schema plus the first 12 hex of its SHA-256).
// Accuracy is measured on hand-labelled samples: node tools/relevance_sample.mjs eval [tools/eval/<sample>.json]
// Run after tools/refresh_social.mjs, or by hand: node tools/social_relevance.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compileRelevance, relevance, kept, fold, wordRe } from "./topics_lib.mjs";

// The social rules (tools/relevance-social.json) on top of the news policy. Pure.
export function compileSocial(cfg) {
  const flat = (o) => Object.values(o || {}).flat();
  const native = {};
  for (const [l, words] of Object.entries(cfg.native || {})) native[l] = wordRe(words);
  return { strong: wordRe(flat(cfg.strong)), drop: wordRe(flat(cfg.drop)), keep: wordRe(flat(cfg.keep)), bulletin: wordRe(cfg.bulletin), native };
}
const baseLang = (l) => String(l || "").toLowerCase().split(/[-_]/)[0];
// The words a social post is checked on: its English (the translation, or the post itself when it is in English), plus the
// original only for the languages with their own word lists (relevance.json native_langs). Unlike news, the original of a
// translated post is not checked against the English lists: Spanish "mayor", Italian "un", Dutch "VS" and French "naval" are
// not the English words. null = no English to check.
export function postText(R, i) {
  const l = baseLang(i.lang), isEn = !l || l === "en", native = R.native && R.native.has(l);
  const en = i.title_en && (i.mt !== "untranslated" || isEn) ? i.title_en : isEn ? i.title : "";
  const sum = i.summary_en || (isEn ? i.summary : "");
  const parts = [en, String(sum || "").slice(0, 400)];
  if (native) parts.push(i.title || "", String(i.summary || "").slice(0, 400));
  return en || native ? parts.join(" \n ") : null;
}
// One social post: "strong" | "keep" | "bulletin" | "unchecked" (shown) or "drop" | "none" (left out), in the order
// tools/relevance-social.json describes. R: the compiled news policy; S: compileSocial(). Pure.
export function socialRelevance(R, S, i) {
  if (i.exempt) return "strong";
  const text = postText(R, i);
  if (text == null) return "unchecked";
  const title = String(i.title_en || i.title || ""), ft = fold(title), f = fold(text);
  // the news lists in their usual order, except that a drop word counts only in the title
  const base = relevance(R, text), baseTitle = base === "drop" ? relevance(R, title) : base;
  if (base === "strong") return "strong";
  // a security word that is also a sport term does not count beside a sport context word (relevance.json sport_senses)
  const fx = R.sportWords && R.sportContext && R.sportContext.test(f) ? f.replace(R.sportWords, " ") : f;
  if (S.strong && S.strong.test(fx)) return "strong";
  if (baseTitle === "drop" || (S.drop && S.drop.test(ft))) return "drop";
  const nat = S.native && S.native[baseLang(i.lang)];
  if (base === "keep" || (base === "drop" && R.keep && R.keep.test(f)) || (S.keep && S.keep.test(f)) ||
    (nat && nat.test(fold((i.title || "") + " \n " + String(i.summary || "").slice(0, 400))))) return "keep";
  if (S.bulletin && S.bulletin.test(ft)) return "bulletin";
  // English-looking text that is really another script the translation left alone
  const latin = (f.match(/[a-z]/g) || []).length, other = (f.match(/\p{L}/gu) || []).length - latin;
  return !(R.native && R.native.has(baseLang(i.lang))) && other > latin ? "unchecked" : "none";
}
export const socialKept = (rel) => kept(rel) || rel === "bulletin";
// the word that decided a social verdict, for the report and the page's "left out because" line
export function socialWhy(R, S, i, rel) {
  if (rel === "unchecked") return i.mt === "untranslated" ? "not translated" : "not in English";
  if (rel === "none") return "no listed word";
  if (i.exempt) return "exempt outlet";
  const title = fold(String(i.title_en || i.title || "")), body = fold(postText(R, i) || "");
  const nat = S.native && S.native[baseLang(i.lang)], orig = fold((i.title || "") + " \n " + String(i.summary || "").slice(0, 400));
  const tries = rel === "bulletin" ? [[S.bulletin, title]] : rel === "drop" ? [[R.drop, title], [S.drop, title]]
    : rel === "keep" ? [[R.keep, body], [S.keep, body], [nat, orig]] : [[R.strong, body], [S.strong, body]];
  for (const [re, f] of tries) {
    const m = re && new RegExp(re.source, re.flags.replace("g", "")).exec(f);
    if (m) return m[0].trim();
  }
  return rel;
}

// social: the ASAP_SOCIAL object ({ asof, items: { cc: [post] } }). on: mark left-out posts (left_out) in place; otherwise clear
// any marks. skip: country codes left out of the report (the hidden areas, tools/hidden-areas.json: the report is a shared file and
// is not sealed); their posts are still marked, since their own files are sealed. Returns the report.
export function judge(R, S, social, { policy = "", on = true, sampleMax = 300, skip = [] } = {}) {
  const counts = {}, out = [], totals = { posts: 0, left_out: 0, strong: 0, keep: 0, bulletin: 0, unchecked: 0, drop: 0, none: 0 }, off = new Set(skip);
  for (const [cc, list] of Object.entries(social.items || {})) {
    const c = off.has(cc) ? null : (counts[cc] = { posts: 0, left_out: 0 });
    for (const i of list || []) {
      if (!i) continue;
      const rel = socialRelevance(R, S, i), shown = socialKept(rel), why = shown ? "" : socialWhy(R, S, i, rel);
      if (on && !shown) i.left_out = why; else delete i.left_out;
      if (!c) continue;
      c.posts++; totals.posts++; totals[rel]++;
      if (!shown) {
        c.left_out++; totals.left_out++;
        out.push({ cc, platform: i.platform, account: i.account, date: i.date, title: String(i.title || "").slice(0, 200),
          title_en: i.title_en && i.title_en !== i.title ? String(i.title_en).slice(0, 200) : undefined, lang: i.lang || undefined, rel, why, link: i.link });
      }
    }
  }
  out.sort((a, b) => ((b.date || "") > (a.date || "") ? 1 : -1));
  return { schema: "osap-social-relevance/2", mode: on ? "on (left-out posts are marked and shown only on request)" : "shadow (nothing is hidden)",
    asof: social.asof || "", policy, totals, counts,
    sample_note: "the newest " + sampleMax + " posts left out, with the deciding word or reason, for review",
    left_out_sample: out.slice(0, sampleMax) };
}

export function policyVersion(text) {
  let schema = "unknown"; try { schema = JSON.parse(text).schema || schema; } catch (e) {}
  return schema + "@" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

const parseJs = (t) => JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
const HIST = /^window\.ASAP_HIST=window\.ASAP_HIST\|\|\{\};window\.ASAP_HIST\[("[a-z]{2,3}")\]=/;

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { splitByCountry, newsCodes } = await import("./split_country.mjs");
  const relText = fs.readFileSync("tools/relevance.json", "utf8"), socText = fs.readFileSync("tools/relevance-social.json", "utf8");
  const R = compileRelevance(JSON.parse(relText), JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics);
  const cfg = JSON.parse(socText), S = compileSocial(cfg), on = cfg.mode === "on";
  const policy = policyVersion(relText) + "+" + policyVersion(socText);
  const social = parseJs(fs.readFileSync("data/live/social.js", "utf8"));
  const skip = JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8")).hidden || [];
  const rep = judge(R, S, social, { policy, on, skip });
  fs.writeFileSync("data/live/social.js", "window.ASAP_SOCIAL=" + JSON.stringify(social).replace(/<\//g, "<\\/") + ";\n");
  splitByCountry("data/live/social.js", "ASAP_SOCIAL", newsCodes());
  // the stored history (tools/history.mjs) gets the same marks, so older posts follow the current word lists; a file that does not
  // parse (a sealed hidden area) is left alone
  let files = 0, marked = 0;
  for (const f of fs.existsSync("data/history") ? fs.readdirSync("data/history") : []) {
    if (!/^[a-z]{2,3}\.js$/.test(f)) continue;
    const file = "data/history/" + f, t = fs.readFileSync(file, "utf8"), m = HIST.exec(t);
    let h; try { h = m && JSON.parse(t.slice(m[0].length).trim().replace(/;$/, "")); } catch (e) { h = null; }
    if (!h || !Array.isArray(h.social)) continue;
    const before = JSON.stringify(h.social);
    judge(R, S, { items: { [f.slice(0, -3)]: h.social } }, { on });
    marked += h.social.filter((i) => i && i.left_out).length;
    if (JSON.stringify(h.social) === before) continue;
    fs.writeFileSync(file, m[0] + JSON.stringify(h).replace(/<\//g, "<\\/") + ";\n");
    files++;
  }
  fs.writeFileSync("data/live/social-relevance.json", JSON.stringify(rep));
  const T = rep.totals;
  console.log(`social relevance (${on ? "on" : "shadow"}, policy ${policy}): ${T.posts} posts; left out ${T.left_out} ` +
    `(drop word ${T.drop}, no listed word ${T.none}); shown: strong ${T.strong}, keep ${T.keep}, bulletin ${T.bulletin}, unchecked ${T.unchecked}; ` +
    `history: ${marked} stored posts marked, ${files} files rewritten`);
}
