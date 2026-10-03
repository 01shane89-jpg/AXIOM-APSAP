// Diagnostic (workflow only=probe-conflicts): which Wikipedia "detailed map" templates and modules exist for each conflict, how many
// town markers tools/refresh_conflicts.mjs can read from each, and the legend lines (marker image -> side) each template shows.
// Reads raw wikitext only (robots.txt allows /wiki/<page>?action=raw). Prints to the log; writes probe-out/wikimaps.json.
import fs from "node:fs";
const UA = "Mozilla/5.0 (AXIOM-OSAP conflict probe; +https://osap-app.github.io/)";
const T = (process.env.WIKIMAPS || "").split("\n").map((s) => s.trim()).filter(Boolean);
const titles = T.length ? T : JSON.parse(fs.readFileSync("tools/wikimap_candidates.json", "utf8"));
async function raw(title) {
  const u = "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/g, ":").replace(/%2F/g, "/") + "?action=raw";
  const r = await fetch(u, { headers: { "user-agent": UA } }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text();
}
const out = [];
for (const t of titles) {
  try {
    const txt = await raw(t);
    const redirect = (txt.match(/^#REDIRECT\s*\[\[([^\]]+)\]\]/i) || [])[1];
    const inv = [...txt.matchAll(/#invoke:\s*([^|}\n]+)/gi)].map((m) => m[1].trim());
    const marks = {}; for (const m of txt.matchAll(/\bmark\s*=\s*(?:"([^"]+)"|'([^']+)'|([^,|}\n]+))/g)) { const k = (m[1] || m[2] || m[3]).trim(); marks[k] = (marks[k] || 0) + 1; }
    const legend = [...txt.matchAll(/\[\[(?:File|Image):([^|\]]+)[^\]]*\]\]\s*(?:&nbsp;)?\s*([^\n\[{<]{2,90})/g)].map((m) => m[1].trim() + " => " + m[2].trim()).slice(0, 30);
    const leg2 = [...txt.matchAll(/\{\{\s*[Ll]egend[^|}]*\|([^|}]+)\|([^}]{2,120})\}\}/g)].map((m) => m[1].trim() + " => " + m[2].trim()).slice(0, 30);
    const alias = [...txt.matchAll(/^\s*(?:local\s+)?(?:mk|marks?)\s*[.=[]?.{0,80}$/gm)].map((m) => m[0].trim()).slice(0, 15);
    const aliasDefs = [...txt.matchAll(/\b(ukr|rus|con|[a-z]{2,4})\s*=\s*"([^"]+\.(?:svg|png|gif))"/g)].map((m) => m[1] + "=" + m[2]).slice(0, 20);
    const rec = { t, ok: true, len: txt.length, redirect, invokes: [...new Set(inv)].slice(0, 5), marks: Object.entries(marks).sort((a, b) => b[1] - a[1]).slice(0, 14), legend, leg2, aliasDefs, alias, head: txt.slice(0, 300) };
    out.push(rec);
    console.log("OK  ", t, txt.length, "bytes", redirect ? "REDIRECT " + redirect : "", "invokes", rec.invokes.join(", "));
    console.log("      marks", JSON.stringify(rec.marks).slice(0, 500));
    if (legend.length) console.log("      legend", JSON.stringify(legend).slice(0, 1500));
    if (leg2.length) console.log("      legend2", JSON.stringify(leg2).slice(0, 1200));
    if (aliasDefs.length) console.log("      aliases", JSON.stringify(aliasDefs).slice(0, 600));
  } catch (e) { out.push({ t, ok: false, error: e.message }); console.log("FAIL", t, e.message); }
  await new Promise((r) => setTimeout(r, 400));
}
fs.mkdirSync("probe-out", { recursive: true }); fs.writeFileSync("probe-out/wikimaps.json", JSON.stringify(out, null, 1));
