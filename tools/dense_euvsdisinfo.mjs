// EUvsDisinfo, the EU's East StratCom Task Force (European External Action Service), registered into the dense open-data run.
// Added 27 Nov 2026 from the OSINT Framework comparison. Headlines, its own one-paragraph summary and links only: the site
// publishes no reuse licence, and its case database loads through an API that answers 403 to runners, so only the public RSS feed
// is read. Every item is framed as the EU's claim (Shane, 27 Nov): EUvsDisinfo is a government body arguing a case about other
// governments' messaging, so what it calls disinformation is its assessment, not OSAP's ruling.
import { feed, run, rssItems } from "./dense_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";

export function euItems(xml, now = Date.now()) {
  const out = [], seen = new Set();
  for (const it of rssItems(xml || "")) {
    const url = String(it.link || "").trim();
    if (!/^https:\/\/euvsdisinfo\.eu\/[\w\-\/%]+$/.test(url) || seen.has(url) || !it.title) continue;
    const t = Date.parse(it.date);
    if (!(t > now - 60 * 864e5)) continue;
    seen.add(url);
    const summary = String(it.summary || "").replace(/The post .* appeared first on .*$/s, "").replace(/\s+/g, " ").trim().slice(0, 400);
    const text = it.title + " " + summary + " " + (it.cats || []).join(" ");
    // "the Kremlin" names Russia without the country's name; most EUvsDisinfo pieces are about Kremlin messaging
    const ccs = [...new Set([...ccsInText(text), ...(/\bKremlin|\bRussi/i.test(text) ? ["ru"] : [])])];
    out.push({
      title: "EU (EUvsDisinfo) says: " + it.title,
      detail: (summary ? summary + " " : "") + "This is the European Union's assessment (EEAS East StratCom Task Force), a government's claim about other governments' messaging, not OSAP's ruling."
        + ((it.cats || []).length ? " Tags: " + it.cats.slice(0, 5).join(", ") + "." : ""),
      date: new Date(t).toISOString().slice(0, 16), url, sev: 1, kind: "EU counter-disinformation analysis (the EU's claim)", ccs,
    });
  }
  return out;
}

feed("euvsdisinfo", { name: "EUvsDisinfo analysis of pro-Kremlin messaging (the EU's claim)", org: "European External Action Service, East StratCom Task Force", cat: "Politics",
  lic: "Headlines, summaries and links only (no reuse licence published)", url: "https://euvsdisinfo.eu/", everyHours: 6 });
run("euvsdisinfo", async (g) => {
  const items = euItems(await g("https://euvsdisinfo.eu/feed/", "text", { timeout: 45000 }));
  return { items, note: items.length + " articles in the last 60 days" };
});
