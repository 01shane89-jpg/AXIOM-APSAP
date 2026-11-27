// U.S. Congress floor votes on legislation, from the official records, keyless:
//   - Senate roll call votes: www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_<congress>_<session>.xml (the session's list);
//   - House roll call votes: clerk.house.gov/evs/<year>/roll<N>.xml, newest first (the newest number from clerk.house.gov/Votes/MemberVotes);
//   - each bill's titles and latest action: the Library of Congress bill status XML on govinfo
//     (www.govinfo.gov/bulkdata/BILLSTATUS/<congress>/<type>/BILLSTATUS-<congress><type><n>.xml).
// Only final votes on a measure are kept (passage, agreeing to a resolution, concurring with the other chamber, conference
// reports, veto overrides); procedural votes, amendments, nominations and House rules for debate are left out.
// Why the bill status matters: a bill is often passed under an old number whose text was replaced. The Senate passed the
// Bipartisan American Affordability and Jobs Act (BAAJA, permitting reform) on 19 Nov 2026 as H.R. 2347, and the Senate's own
// vote record still names H.R. 2347's original subject (a tax rule on damages). The bill status gives the name it now carries.
// Every item says what the record says: a vote result and the latest official action, never what a bill will do.
// Records of the U.S. Government (public domain, 17 U.S.C. 105). Member names and individual votes are not shown.
import { feed, run, sleep, unhtml } from "./dense_lib.mjs";

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
export const DAYS = 30;
export function congressOf(year) { return { congress: Math.floor((year - 1789) / 2) + 1, session: year % 2 ? 1 : 2 }; }
const tag = (x, t) => { const m = new RegExp("<" + t + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + t + ">").exec(x); return m ? unhtml(m[1]).replace(/\s+/g, " ").trim() : ""; };
const pad = (n) => String(n).padStart(2, "0");
// "19-Nov" (Senate list, year given) or "19-Nov-2026" (House) -> "2026-11-19"
export function dayOf(s, year) {
  const m = /^(\d{1,2})-([A-Z][a-z]{2})(?:-(\d{4}))?/.exec(String(s || "").trim());
  return m && MON[m[2]] ? (m[3] || year) + "-" + pad(MON[m[2]]) + "-" + pad(m[1]) : "";
}

// "H.R. 2347", "H R 2347", "S.J.Res. 197", "H J RES 210", "H.Con.Res. 93" -> { type: "hr", n: 2347, label: "H.R. 2347" }
const TYPES = [["hjres", /^H\.?\s*J\.?\s*RES\.?/i, "H.J.Res."], ["sjres", /^S\.?\s*J\.?\s*RES\.?/i, "S.J.Res."], ["hconres", /^H\.?\s*CON\.?\s*RES\.?/i, "H.Con.Res."],
  ["sconres", /^S\.?\s*CON\.?\s*RES\.?/i, "S.Con.Res."], ["hres", /^H\.?\s*RES\.?/i, "H.Res."], ["sres", /^S\.?\s*RES\.?/i, "S.Res."], ["hr", /^H\.?\s*R\.?/i, "H.R."], ["s", /^S\.?/i, "S."]];
export function billOf(s) {
  const t = String(s || "").trim();
  for (const [type, re, lab] of TYPES) { const m = re.exec(t); if (m) { const n = /^\s*(\d+)\s*$/.exec(t.slice(m[0].length)); if (n) return { type, n: +n[1], label: lab + " " + n[1] }; } }
  return null;
}
const CONGRESS_PATH = { hr: "house-bill", s: "senate-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution", hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution", hres: "house-resolution", sres: "senate-resolution" };
export const billUrl = (congress, b) => "https://www.congress.gov/bill/" + congress + "th-congress/" + CONGRESS_PATH[b.type] + "/" + b.n;

// a final vote on the measure itself; amendments, cloture, motions to proceed or table, and House rules are not
export function isFinal(question, bill) {
  if (!bill) return false;
  const q = String(question || "");
  if (/Amendment|Cloture|Motion to Proceed|Motion to Table|Motion to Discharge|Motion to Recommit|Point of Order|Waive|Previous Question|Journal|Adjourn/i.test(q)
      && !/Concur(?!rent)|Agree to the Senate Amendment|Suspend the Rules and (Pass|Agree|Concur)/i.test(q)) return false;
  if (bill.type === "hres" && !/Suspend the Rules/i.test(q)) return false;   // a House resolution passed on the floor is almost always the rule for a debate
  return /Passage|Pass\b|Concur|Agree to the Senate Amendment|Agreeing to the (Joint |Concurrent )?Resolution|On the (Joint |Concurrent )?Resolution|Conference Report|Veto|Suspend the Rules/i.test(q);
}

// the Senate's list of the session's votes
export function senateVotes(xml, year) {
  return [...String(xml).matchAll(/<vote>([\s\S]*?)<\/vote>/g)].map((m) => {
    const v = m[1];
    return { chamber: "Senate", num: +tag(v, "vote_number"), date: dayOf(tag(v, "vote_date"), year), issue: tag(v, "issue"), question: tag(v, "question").replace(/\s*S\.Amdt\.\s*\d+$/, ""),
      result: tag(v, "result"), yeas: +tag(v, "yeas"), nays: +tag(v, "nays"), title: tag(v, "title") };
  });
}
export const senateVoteUrl = (congress, session, num) => "https://www.senate.gov/legislative/LIS/roll_call_votes/vote" + congress + session + "/vote_" + congress + "_" + session + "_" + String(num).padStart(5, "0") + ".htm";
// one House roll call XML
export function houseVote(xml) {
  const x = String(xml), tot = /<totals-by-vote>([\s\S]*?)<\/totals-by-vote>/.exec(x), t = tot ? tot[1] : "";
  return { chamber: "House", num: +tag(x, "rollcall-num"), date: dayOf(tag(x, "action-date")), issue: tag(x, "legis-num"), question: tag(x, "vote-question"),
    result: tag(x, "vote-result"), yeas: +(tag(t, "yea-total") || 0), nays: +(tag(t, "nay-total") || 0), title: tag(x, "vote-desc") };
}
export const houseVoteUrl = (year, num) => "https://clerk.house.gov/Votes/" + year + num;
export function houseLatest(html) { const m = /of\s+(\d+)\s+Results/.exec(String(html)); return m ? +m[1] : 0; }

// the bill status: the name it carries now (popular and display titles), its first short title, and the latest action
export function billStatus(xml) {
  const x = String(xml), titles = (/<titles>([\s\S]*?)<\/titles>/.exec(x) || [, ""])[1];
  const items = [...titles.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({ type: tag(m[1], "titleType"), title: tag(m[1], "title") }));
  const pick = (re) => (items.find((i) => re.test(i.type)) || {}).title || "";
  // the bill's own latest action (related bills and amendments carry theirs too, so those blocks are dropped first)
  const las = [...x.replace(/<relatedBills>[\s\S]*?<\/relatedBills>|<amendments>[\s\S]*?<\/amendments>|<cboCostEstimates>[\s\S]*?<\/cboCostEstimates>/g, "").matchAll(/<latestAction>([\s\S]*?)<\/latestAction>/g)];
  const la = las.length ? las[las.length - 1][1] : "";
  return { display: pick(/^Display Title/), popular: pick(/^Popular Titles?/), latest: { date: tag(la, "actionDate"), text: tag(la, "text") } };
}

const nice = (d) => { const t = new Date(d + "T12:00:00Z"); return isNaN(t) ? d : t.getUTCDate() + " " + Object.keys(MON)[t.getUTCMonth()] + " " + t.getUTCFullYear(); };
const RESULT_VERB = [[/^(Bill |Joint Resolution |Concurrent Resolution |Resolution )?Passed$/i, "passed"], [/^Agreed to$/i, "agreed to"], [/^(Rejected|Failed|Not Agreed to|Bill Defeated)$/i, "rejected"]];
function verb(question, result) {
  if (/Concur(?!rent)|Agree to the Senate Amendment/i.test(question)) return /reject|fail|not/i.test(result) ? "did not agree to the other chamber's version of" : "agreed to the other chamber's version of";
  if (/Veto/i.test(question)) return /reject|fail|not|sustain/i.test(result) ? "did not override the veto of" : "overrode the veto of";
  if (/Conference Report/i.test(question)) return /reject|fail|not/i.test(result) ? "rejected the conference report on" : "agreed to the conference report on";
  for (const [re, v] of RESULT_VERB) if (re.test(result)) return v;
  return "voted (" + result.toLowerCase() + ") on";
}
// one item per final vote
export function voteItem(v, bill, bs, congress, link) {
  const name = ((bs && bs.display) || "").replace(/[.\s]+$/, ""), pop = bs && bs.popular && name && name.toLowerCase().indexOf(bs.popular.toLowerCase()) < 0 ? bs.popular : "";
  const named = name ? ", " + name + (pop ? " (" + pop + ")" : "") : "";
  const tally = v.yeas || v.nays ? ", " + v.yeas + "-" + v.nays : "";
  const title = v.chamber + " " + verb(v.question, v.result) + " " + bill.label + named + tally;
  // the vote record names an earlier subject when the bill's text was replaced (H.R. 2347: a tax rule on damages, now BAAJA)
  const rec = v.title.replace(/^[^;]*;\s*/, "");
  const norm = (t) => t.toLowerCase().replace(/\bof (19|20)\d\d\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const a = norm(name), r = norm(rec);
  const stale = a && r && a.indexOf(r) < 0 && r.indexOf(a) < 0 && !/^(H\.|S\.)/.test(rec) ? ' The vote record still describes the number\'s earlier subject ("' + rec.slice(0, 160).replace(/[.\s]+$/, "") + '"): its text was replaced before this vote.' : "";
  const latest = bs && bs.latest && bs.latest.text ? " Latest action (" + nice(bs.latest.date) + "): " + bs.latest.text.replace(/[.\s]+$/, "") + "." : "";
  return { title, date: v.date + "T12:00", url: billUrl(congress, bill),
    detail: v.question + ": " + v.result + tally.replace(/^, /, " ") + ", " + nice(v.date) + "." + stale + latest +
      " Official record: " + v.chamber + " roll call " + v.num + " (" + link + "); name and status from the Library of Congress bill status. A vote, not a law until both chambers pass the same text and it is signed.",
    sev: 1, kind: v.chamber + " floor vote", ccs: ["us"] };
}

feed("us-congress", { name: "U.S. Congress floor votes on bills and resolutions", org: "U.S. Senate, Clerk of the U.S. House, Library of Congress (govinfo)", cat: "Politics",
  lic: "U.S. Government records (public domain)", url: "https://www.congress.gov/roll-call-votes", everyHours: 3, cap: 60 });
run("us-congress", async (g) => {
  const now = new Date(), year = now.getUTCFullYear(), { congress, session } = congressOf(year), since = new Date(now - DAYS * 864e5).toISOString().slice(0, 10), votes = [], notes = [];
  try {
    const sx = await g("https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_" + congress + "_" + session + ".xml", "text");
    const all = senateVotes(sx, year).filter((v) => v.date >= since);
    all.filter((v) => isFinal(v.question, billOf(v.issue))).forEach((v) => votes.push({ ...v, link: senateVoteUrl(congress, session, v.num) }));
    notes.push("Senate " + all.length + " votes read");
  } catch (e) { notes.push("Senate list failed (" + e.message + ")"); }
  try {
    const top = houseLatest(await g("https://clerk.house.gov/Votes/MemberVotes?page=1", "text"));
    let n = 0;
    for (let r = top; r > 0 && r > top - 120; r--) {
      let v; try { v = houseVote(await g("https://clerk.house.gov/evs/" + year + "/roll" + String(r).padStart(3, "0") + ".xml", "text")); } catch { continue; }
      n++;
      if (v.date && v.date < since) break;
      if (isFinal(v.question, billOf(v.issue))) votes.push({ ...v, link: houseVoteUrl(year, r) });
      await sleep(300);
    }
    notes.push("House " + n + " votes read");
  } catch (e) { notes.push("House list failed (" + e.message + ")"); }
  if (!votes.length) throw new Error("no final votes found (" + notes.join("; ") + ")");
  const status = {}, items = [];
  for (const v of votes) {
    const b = billOf(v.issue), k = b.type + b.n;
    if (!(k in status)) {
      try { status[k] = billStatus(await g("https://www.govinfo.gov/bulkdata/BILLSTATUS/" + congress + "/" + b.type + "/BILLSTATUS-" + congress + k + ".xml", "text", { timeout: 60000 })); }
      catch { status[k] = null; }
      await sleep(250);
    }
    items.push(voteItem(v, b, status[k], congress, v.link));
  }
  const named = Object.values(status).filter(Boolean).length;
  return { items, note: items.length + " final votes since " + since + "; " + notes.join("; ") + "; bill status for " + named + " of " + Object.keys(status).length + " measures" };
});
