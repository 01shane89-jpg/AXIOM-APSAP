// Every bill in the current U.S. Congress, step by step, from the Library of Congress bill status files on govinfo
// (BILLSTATUS bulk data, keyless, U.S. Government work). tools/refresh_congress.mjs fetches them; this file reads one bill status
// XML into a small record, works out the stage it has reached, and lays the records out for the app:
//   data/live/congress/<congress>/index.js   window.OSAP_BILLS_IX: one row per bill for search (number, name, popular name, stage, last step)
//   data/live/congress/<congress>/<type>-<hundreds>.json   the full records of up to 100 bills (titles, steps, sponsor, committees)
//   data/live/congress/<congress>/recent.json   the major steps of the last 30 days (news search reads them, tools/news_index.mjs)
// A record says what the official record says: titles, dates and actions. It never says what a bill would do or who it helps.
// Sponsor and cosponsor count are part of the public record of a bill; no other member names are kept.

export const TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"];
export const LABEL = { hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res." };
const PATH = { hr: "house-bill", s: "senate-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution", hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution", hres: "house-resolution", sres: "senate-resolution" };
export const billUrl = (congress, type, n) => "https://www.congress.gov/bill/" + congress + "th-congress/" + PATH[type] + "/" + n;
export const chunkOf = (type, n) => type + "-" + Math.floor(n / 100);

// the stages, in order; a simple resolution (H.Res., S.Res.) only needs its own chamber, a concurrent resolution both but no President
export const STAGES = {
  intro: "Introduced", committee: "In committee", reported: "Reported by committee", "passed-h": "Passed the House", "passed-s": "Passed the Senate",
  "passed-both": "Passed both chambers", agreed: "Agreed to", president: "Sent to the President", law: "Became law", vetoed: "Vetoed", failed: "Failed on the floor",
};

const dec = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const tag = (x, t) => { const m = new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">").exec(x); return m ? dec(m[1]) : ""; };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
// the bill's own top-level blocks: nested ones (related bills, amendments, summaries, text versions, cost estimates, subjects,
// committee reports) carry titles, actions and latest actions of their own, so they are cut out before anything is read
const NESTED = ["relatedBills", "amendments", "summaries", "textVersions", "cboCostEstimates", "subjects", "committeeReports", "constitutionalAuthorityStatementText", "notes"];
export function topLevel(xml) {
  let x = String(xml); const i = x.indexOf("<bill>"); if (i >= 0) x = x.slice(i + 6);
  for (const t of NESTED) x = x.replace(new RegExp("<" + t + ">[\\s\\S]*?</" + t + ">", "g"), "").replace(new RegExp("<" + t + "/>", "g"), "");
  return x;
}
const items = (block) => { const out = []; let depth = 0, start = -1; const re = /<(\/?)item>/g; let m;
  while ((m = re.exec(block))) { if (!m[1]) { if (depth++ === 0) start = m.index + 6; } else if (--depth === 0) out.push(block.slice(start, m.index)); } return out; };

// one bill status XML -> a record
export function parseBill(xml, congress) {
  const x = topLevel(xml), type = tag(x, "type").toLowerCase(), n = +tag(x, "number");
  if (!LABEL[type] || !n) return null;
  const titlesBlock = (/<titles>([\s\S]*?)<\/titles>/.exec(x) || [, ""])[1];
  const titles = items(titlesBlock).map((i) => ({ type: tag(i, "titleType"), title: tag(i, "title") }));
  const pick = (re) => (titles.find((t) => re.test(t.type)) || {}).title || "";
  const display = pick(/^Display Title/) || tag(x.replace(/<titles>[\s\S]*?<\/titles>/, ""), "title");
  const popular = pick(/^Popular Titles?/);
  const shorts = [...new Set(titles.filter((t) => /^Short Title/.test(t.type)).map((t) => t.title))].filter((t) => t && t !== display).slice(0, 4);
  const sp = items((/<sponsors>([\s\S]*?)<\/sponsors>/.exec(x) || [, ""])[1]).map((i) => tag(i, "fullName"))[0] || "";
  const csBlock = (/<cosponsors>([\s\S]*?)<\/cosponsors>/.exec(x) || [, ""])[1];
  const cs = +(tag(csBlock.replace(/<item>[\s\S]*<\/item>/, ""), "count") || items(csBlock).length || 0);
  const committees = [...new Set(items((/<committees>([\s\S]*?)<\/committees>/.exec(x) || [, ""])[1]).map((i) => {
    const c = tag(i.replace(/<activities>[\s\S]*?<\/activities>|<subcommittees>[\s\S]*?<\/subcommittees>/g, ""), "chamber"), nm = tag(i.replace(/<activities>[\s\S]*?<\/activities>|<subcommittees>[\s\S]*?<\/subcommittees>/g, ""), "name");
    return nm ? (c ? c + " " : "") + nm : ""; }).filter(Boolean))].slice(0, 6);
  const laws = items((/<laws>([\s\S]*?)<\/laws>/.exec(x) || [, ""])[1]).map((i) => (tag(i, "type") === "Private Law" ? "Private Law " : "P.L. ") + tag(i, "number"));
  const actions = items((/<actions>([\s\S]*?)<\/actions>/.exec(x) || [, ""])[1]).map((i) => ({
    date: tag(i, "actionDate"), type: tag(i, "type"), code: tag(i, "actionCode"), src: tag(i.replace(/<recordedVotes>[\s\S]*?<\/recordedVotes>/, ""), "name"), text: tag(i.replace(/<recordedVotes>[\s\S]*?<\/recordedVotes>|<sourceSystem>[\s\S]*?<\/sourceSystem>|<committees>[\s\S]*?<\/committees>/g, ""), "text") }));
  const la = (/<latestAction>([\s\S]*?)<\/latestAction>/.exec(x) || [, ""])[1];
  const steps = stepsOf(actions), stage = stageOf(type, actions, laws);
  return { id: type + n, n: LABEL[type] + " " + n, type, num: n, t: clip(display, 400), p: popular, st: shorts, i: tag(x, "introducedDate"), sp, cs,
    pa: tag((/<policyArea>([\s\S]*?)<\/policyArea>/.exec(x) || [, ""])[1], "name"), cm: committees, law: laws.join(", "), stage,
    steps, la: [tag(la, "actionDate"), clip(tag(la, "text"), 300)], u: billUrl(congress, type, n) };
}

// the steps worth showing: the Library of Congress's own milestone entries (introduced, reported, passed, resolving differences,
// presented, signed, vetoed, became law), plus the first committee referral; one per date and wording, oldest first
export function stepsOf(actions) {
  const out = [], seen = new Set();
  const add = (d, t) => { t = clip(String(t).replace(/^Passed\/agreed to in (House|Senate): (?!Passed|Agreed|Failed)/, "Passed the $1: ").replace(/^Passed\/agreed to in (House|Senate): /, "").replace(/\s*\((text|consideration): CR [^)]*\)\.?$/, "").trim(), 240); const k = d + "|" + t; if (d && t && !seen.has(k)) { seen.add(k); out.push([d, t]); } };
  for (const a of actions) if (a.src === "Library of Congress" && a.type !== "NotUsed") add(a.date, a.text);
  const ref = actions.filter((a) => a.type === "IntroReferral" && /^Referred to/i.test(a.text)).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (ref) add(ref.date, ref.text);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// the furthest stage the record shows (Library of Congress action codes, with the wording as a fallback)
export function stageOf(type, actions, laws) {
  const has = (re, codes) => actions.some((a) => (codes && codes.includes(a.code)) || re.test(a.text));
  if ((laws && laws.length) || has(/^Became (Public|Private) Law/i, ["36000", "E40000"])) return "law";
  if (has(/^Vetoed by President|Pocket Vetoed/i, ["31000", "E50000"]) && !has(/passed over veto|override.*(agreed|passed)/i)) return "vetoed";
  if (has(/^Presented to President/i, ["28000", "E20000"])) return "president";
  const h = has(/^Passed\/agreed to in House/i, ["8000"]), s = has(/^Passed\/agreed to in Senate/i, ["17000"]);
  if (type === "hres" || type === "sres") return h || s ? "agreed" : stageBelow(actions, has);
  if (h && s) return type.endsWith("conres") ? "agreed" : "passed-both";
  if (h) return "passed-h";
  if (s) return "passed-s";
  if (has(/^Failed of passage|Failed to pass|resolution (was )?not agreed to/i, ["9000", "18000"])) return "failed";
  return stageBelow(actions, has);
}
function stageBelow(actions, has) {
  if (has(/^Reported (\(Amended\) |with an amendment |without amendment |favorably )?by|^Committee on .* (ordered to be )?reported|Placed on (the )?(Union|House) Calendar|Placed on Senate Legislative Calendar/i, ["5000", "14000"])) return "reported";
  if (actions.some((a) => /^Referred to/i.test(a.text))) return "committee";
  return "intro";
}

// one search row: [id, number, name, popular name, stage, date of the last step, latest action]
export const ixRow = (b) => [b.id, b.n, clip(b.t, 200), b.p || "", b.stage, (b.steps.length ? b.steps[b.steps.length - 1][0] : b.i) || "", clip(b.la[1] || "", 160)];

// the major steps of recent days, for news search: reported, passed a chamber, sent to the President, law, veto, failed.
// A passage on a recorded vote is left to the floor-votes feed (tools/dense_congress.mjs), which has the tally.
const MAJOR = /^(Reported|Passed\/agreed to|Passed|Agreed to|Presented to President|Became (Public|Private) Law|Signed by President|Vetoed|Pocket Vetoed|Failed|Resolving differences)/i;
export function recentSteps(b, since) {
  const name = b.t + (b.p && b.t.toLowerCase().indexOf(b.p.toLowerCase()) < 0 ? " (" + b.p + ")" : "");
  return b.steps.filter(([d, t]) => d >= since && MAJOR.test(t) && !/Record Vote Number|Roll no\.|Yea-Nay Vote|recorded vote|Yeas and Nays/i.test(t) && !/^Signed by President/i.test(t))
    .map(([d, t]) => ({ title: "Congress: " + b.n + ", " + name + ": " + t.replace(/[.\s]+$/, ""), link: b.u + "#step-" + d, date: d + "T12:00", outlet: "Library of Congress (bill status)", state: true,
      summary: "Stage: " + STAGES[b.stage] + ". " + (b.law ? b.law + ". " : "") + "Latest action (" + b.la[0] + "): " + b.la[1] }));
}
