// Hacker groups named in the news, matched to MITRE ATT&CK (keyless: MITRE's STIX data on GitHub). Added 27 Nov 2026 from the
// OSINT Framework comparison: a "Chinese hackers did it" headline shows which tracked group the outlet named, how MITRE
// describes that group, and whether any of the latest official advisories OSAP reads (CISA, UK NCSC) name it too.
// A group named in a headline is the outlet's attribution; MITRE's description is MITRE's; neither is OSAP's finding.
// Licence: ATT&CK terms of use (royalty-free, commercial use allowed, with MITRE's copyright notice).
import fs from "node:fs";
import { feed, run, rssItems } from "./dense_lib.mjs";

export const NOTICE = "© The MITRE Corporation. This work is reproduced and distributed with the permission of The MITRE Corporation.";
const CYBER = /\b(hack\w*|cyber\w*|APT|malware|ransomware|espionage|spy\w*|phishing|breach\w*|threat actor|intrusion|backdoor|exploit\w*|zero-day|wiper|botnet|DDoS|infiltrat\w*|state-sponsored|state-backed)\b/i;
// a name that is a code (APT28, UNC3886, Storm-0558, TA505, FIN7) or uses an industry naming word (Volt Typhoon, Fancy Bear,
// Scattered Spider, Midnight Blizzard) is specific enough on its own; any other name (Sidewinder, Sea Turtle, Lazarus) counts
// only in a headline about hacking
const NAMING = /\b(Typhoon|Bear|Panda|Kitten|Chollima|Spider|Blizzard|Sleet|Tempest|Sandstorm|Hail|Jackal|Leopard|Tiger|Buffalo)$/;
const specific = (a) => /\d/.test(a) || NAMING.test(a.trim());

// the intrusion sets (groups) in MITRE's STIX bundle, without revoked or deprecated ones
export function groupsFrom(bundle) {
  const out = [];
  for (const o of (bundle && bundle.objects) || []) {
    if (!o || o.type !== "intrusion-set" || o.revoked || o.x_mitre_deprecated) continue;
    const ref = (o.external_references || []).find((r) => r.source_name === "mitre-attack" && /^G\d{4}$/.test(r.external_id || ""));
    if (!ref) continue;
    const names = [...new Set([o.name, ...(o.aliases || [])].map((s) => String(s || "").trim()).filter((s) => s.length >= 4 && s.length <= 40))];
    const desc = String(o.description || "").replace(/\(Citation:[^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
    const first = (desc.match(/^.{20,400}?[.!?](?=\s|$)/) || [desc.slice(0, 300)])[0];
    out.push({ id: ref.external_id, name: o.name, names, url: "https://attack.mitre.org/groups/" + ref.external_id + "/", desc: first });
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function matcher(groups) {
  const M = groups.map((g) => ({ g, res: g.names.map((n) => ({ n, sp: specific(n), re: new RegExp("(?<![\\w-])" + esc(n) + "(?![\\w-])", specific(n) ? "i" : "") })) }));
  // cyber: the text is about hacking already (a cyber agency's advisory), so any of the group's names counts
  return (text, cyber = false) => {
    const hits = [];
    for (const { g, res } of M) { const r = res.find((x) => x.re.test(text) && (x.sp || cyber || CYBER.test(text))); if (r) hits.push({ g, as: r.n }); }
    return hits;
  };
}

// one item per group named in the news or in an official advisory: the headlines, MITRE's description, the advisories that name it
export function groupItems(groups, news, advisories) {
  const match = matcher(groups), byId = new Map();
  const entry = (g) => byId.get(g.id) || byId.set(g.id, { g, as: new Set(), heads: [], adv: [], ccs: new Set(), date: "" }).get(g.id);
  for (const n of news) for (const { g, as } of match(n.text)) {
    const e = entry(g); e.as.add(as); e.ccs.add(n.cc);
    if (!e.heads.some((h) => h.link === n.link)) e.heads.push(n);
    if (String(n.date) > e.date) e.date = String(n.date);
  }
  for (const a of advisories) for (const { g, as } of match(a.title + ". " + a.summary, true)) {
    const e = entry(g); e.as.add(as);
    if (!e.adv.some((x) => x.link === a.link && x.title === a.title)) e.adv.push(a);
    if (String(a.date) > e.date) e.date = String(a.date);
  }
  const oldest = advisories.map((a) => String(a.date || "")).filter(Boolean).sort()[0] || "";
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  return [...byId.values()].sort((a, b) => b.heads.length - a.heads.length || b.adv.length - a.adv.length || b.date.localeCompare(a.date)).map((e) => {
    const heads = e.heads.sort((a, b) => String(b.date).localeCompare(String(a.date))), adv = e.adv.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const alias = [...e.as].filter((a) => a !== e.g.name);
    return {
      title: (heads.length ? "Hacker group named in the news: " : "Hacker group named in an official advisory: ") + e.g.name + (alias.length ? " (as " + alias.join(", ") + ")" : "")
        + ", " + [heads.length ? plural(heads.length, "headline") : "", adv.length ? plural(adv.length, "advisory").replace("advisorys", "advisories") : ""].filter(Boolean).join(", "),
      detail: "MITRE ATT&CK " + e.g.id + " describes it: \u201c" + e.g.desc + "\u201d "
        + (adv.length ? "Named in " + plural(adv.length, "advisory").replace("advisorys", "advisories") + " OSAP reads: " + adv.slice(0, 3).map((a) => a.src + ", " + String(a.date).slice(0, 10) + ": " + a.title).join("; ") + ". "
          : "None of the latest " + advisories.length + " CISA and UK NCSC advisories OSAP reads" + (oldest ? " (back to " + oldest.slice(0, 10) + ")" : "") + " names it. ")
        + (heads.length ? "Headlines: " + heads.slice(0, 4).map((h) => h.outlet + ": " + h.title).join("; ") + (heads.length > 4 ? "; and " + (heads.length - 4) + " more" : "") + ". " : "")
        + "A group named in a headline is the outlet's attribution, in an advisory the government's, and MITRE's description is MITRE's; none is OSAP's finding. " + NOTICE,
      date: e.date, url: e.g.url, sev: heads.length && !adv.length ? 2 : 1, kind: "Hacker group (MITRE ATT&CK)", value: heads.length + adv.length,
      // news: the countries whose outlets named it; an advisory alone: the country that issued it
      ccs: e.ccs.size ? [...e.ccs].slice(0, 12) : [...new Set(adv.map((a) => (a.src === "UK NCSC" ? "gb" : "us")))],
    };
  });
}

// headlines from the news history (data/history/<cc>.js, which every news run adds to) from the last `days` days
export function newsNow(dir = "data/history", days = 14, now = Date.now()) {
  const out = [], cut = new Date(now - days * 864e5).toISOString().slice(0, 16);
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^([a-z]{2,3})\.js$/); if (!m) continue;
    try {
      const W = {}; new Function("window", fs.readFileSync(dir + "/" + f, "utf8"))(W);
      for (const i of ((W.ASAP_HIST || {})[m[1]] || {}).news || []) {
        if (!i || !i.link || !(String(i.date || "") >= cut)) continue;
        const title = i.title_en || i.title; if (!title) continue;
        out.push({ cc: m[1], title, text: title + (i.title_en && i.title !== i.title_en ? " " + i.title : ""), link: i.link, outlet: i.outlet || "", date: i.date });
      }
    } catch (e) {}
  }
  return out;
}

feed("attack-groups", { name: "Hacker groups named in the news (MITRE ATT&CK)", org: "The MITRE Corporation (ATT&CK); CISA and UK NCSC advisories", cat: "Cyber",
  lic: "ATT&CK terms of use (free, commercial use allowed, with MITRE's copyright notice); advisories US Government work and Open Government Licence v3",
  url: "https://attack.mitre.org/groups/", everyHours: 6 });
run("attack-groups", async (g) => {
  const bundle = await g("https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json", "json", { timeout: 180000 });
  const groups = groupsFrom(bundle);
  if (groups.length < 50) throw new Error("only " + groups.length + " groups in the ATT&CK data");
  const advisories = [];
  for (const [src, url] of [["CISA", "https://www.cisa.gov/cybersecurity-advisories/all.xml"], ["UK NCSC", "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml"]]) {
    try { for (const x of rssItems(await g(url, "text"))) advisories.push({ src, title: x.title || "", summary: x.summary || "", date: x.date || "", link: x.link }); } catch (e) {}
  }
  const news = newsNow();
  const items = groupItems(groups, news, advisories);
  return { items, note: groups.length + " ATT&CK groups; " + items.length + " named across " + news.length + " headlines from the last 14 days and the advisories; " + advisories.length + " advisories checked" };
});
