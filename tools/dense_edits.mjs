// Headline changes: stories whose outlet changed the headline after OSAP first read it (tools/headline_edits.mjs records them in
// data/history/<cc>.js as each news run stores the items). Added 27 Nov 2026 from the OSINT Framework comparison ("silent-edit
// tracker"). Each item shows the old and the new headline, the times OSAP read each one, which numbers and key words changed, and
// the Internet Archive's nearest saved copy from before the change when it has one (the Wayback Machine's keyless availability
// API). Only headlines and links: no article text. A changed headline is often a normal update as a story develops; it is a
// record of the change, not a finding that anything was hidden or wrong.
// Licence: the headlines are the outlets' (shown as headlines with links, as everywhere in OSAP); Internet Archive links only.
import fs from "node:fs";
import { feed, run, sleep } from "./dense_lib.mjs";
import { whatChanged } from "./headline_edits.mjs";

export const DAYS = 7, LOOKUPS = 30;
const iso = (s) => String(s || "").replace(" ", "T").replace(/Z$/, "");
const q = (s) => "“" + String(s).replace(/\s+/g, " ").trim() + "”";
const list = (a) => a.join(", ");

// one item per changed story: its newest change, with the number of changes
export function editItems(byCc, now = Date.now()) {
  const out = [], seen = new Set();
  for (const [cc, news] of Object.entries(byCc)) {
    for (const i of news || []) {
      if (!i || !Array.isArray(i.edits) || !i.edits.length || !/^https?:\/\//.test(i.link || "")) continue;
      const e = i.edits[i.edits.length - 1], at = Date.parse(iso(e.by) + "Z");
      if (!(now - at <= DAYS * 864e5)) continue;
      const key = cc + " " + i.link; if (seen.has(key)) continue; seen.add(key);
      const c = whatChanged(e.was, i.title), en = i.title_en && i.title_en !== i.title;
      const bits = [];
      if (c.numbers) bits.push("numbers " + [c.numbers.gone.length ? list(c.numbers.gone) + " gone" : "", c.numbers.added.length ? list(c.numbers.added) + " new" : ""].filter(Boolean).join(", "));
      if (c.words) bits.push("words " + [c.words.gone.length ? q(list(c.words.gone)) + " gone" : "", c.words.added.length ? q(list(c.words.added)) + " new" : ""].filter(Boolean).join(", "));
      out.push({
        title: "Headline changed: " + (i.outlet || "outlet") + ": " + (en ? i.title_en : i.title),
        detail: "Was: " + q(e.was) + (e.was_en ? " (" + q(e.was_en) + ")" : "") + ". Now: " + q(i.title) + (en ? " (" + q(i.title_en) + ")" : "") + ". "
          + (e.from ? "OSAP first saw the old headline at " + e.from + "; " : "") + "the new one was in the outlet's feed by " + e.by + " (times OSAP read the feed, not when the outlet edited it). "
          + (bits.length ? "Changed: " + bits.join("; ") + ". " : "")
          + (i.edits.length > 1 ? i.edits.length + " changes recorded. " : "")
          + "A changed headline is often a normal update as a story develops; this records the change, it is not a finding.",
        date: iso(e.by), url: i.link, sev: c.numbers || c.words ? 2 : 1, kind: "Headline change", ccs: [cc],
        _from: e.from, _by: e.by,
      });
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// the Wayback Machine's saved copy nearest the time the old headline was seen, kept only when it is from before the change
export function waybackBefore(j, by) {
  const s = j && j.archived_snapshots && j.archived_snapshots.closest;
  if (!s || !s.available || !/^https?:\/\/web\.archive\.org\/web\/\d{14}\//.test(s.url || "") || !/^\d{14}$/.test(s.timestamp || "")) return null;
  const t = s.timestamp, when = t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8) + " " + t.slice(8, 10) + ":" + t.slice(10, 12) + "Z";
  const lim = String(by || "").replace(/[^0-9]/g, "").slice(0, 12);
  if (lim.length === 12 && t.slice(0, 12) > lim) return null;
  return { url: s.url.replace(/^http:/, "https:"), when };
}

export function readHistory(dir = "data/history") {
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^([a-z]{2,3})\.js$/); if (!m) continue;
    try { const s = fs.readFileSync(dir + "/" + f, "utf8"); if (!s.includes('"edits"')) continue; const W = {}; new Function("window", s)(W); out[m[1]] = ((W.ASAP_HIST || {})[m[1]] || {}).news || []; } catch (e) {}
  }
  return out;
}

feed("headline-edits", { name: "Headline changes (outlets that changed a story's headline after OSAP read it)", org: "OSAP news history; Internet Archive Wayback Machine",
  cat: "News", lic: "Outlets' headlines with links; Internet Archive links", url: "https://web.archive.org/", everyHours: 3 });
run("headline-edits", async (g) => {
  const items = editItems(readHistory());
  let found = 0, asked = 0;
  for (const it of items.slice(0, LOOKUPS)) {
    try {
      asked++;
      const ts = String(it._from || it._by).replace(/[^0-9]/g, "").slice(0, 12);
      const w = waybackBefore(await g("https://archive.org/wayback/available?url=" + encodeURIComponent(it.url) + (ts ? "&timestamp=" + ts : ""), "json", { timeout: 20000 }), it._by);
      if (w) { found++; it.detail += " Internet Archive copy from " + w.when + ", before the change: " + w.url; }
    } catch (e) {}
    await sleep(300);
  }
  for (const it of items) { delete it._from; delete it._by; }
  return { items, note: items.length + " changed headlines in the last " + DAYS + " days; " + found + " of " + asked + " checked have an Internet Archive copy from before the change" };
});
