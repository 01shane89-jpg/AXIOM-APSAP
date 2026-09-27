// Diagnostic (only=probe-placement): re-places every country's current news with tools/gazetteer.mjs and compares it with
// the pins the live files carry (data/live/news/<cc>.js, placed by the previous rules). Prints counts per country and
// every changed pin; writes nothing to the repository.
import fs from "node:fs";
import { loadGazetteer, placeIn, namesIn } from "./gazetteer.mjs";
import { ccsAt } from "./geo_cc.mjs";

const gz = await loadGazetteer();
const files = fs.readdirSync("data/live/news").filter((f) => /^[a-z]{2,3}\.js$/.test(f));
const tot = { items: 0, before: 0, after: 0, changed: 0, dropped: 0, moved: 0, added: 0, outBefore: 0, outAfter: 0 }, why = {}, per = [], lines = [], outs = [];
function inside(cc, g) { if (!g) return true; const c = ccsAt(g.la, g.lo, 0.3); return c.includes(cc) || (cc === "oki" && c.includes("jp")); }
for (const f of files) {
  const cc = f.slice(0, -3), t = fs.readFileSync("data/live/news/" + f, "utf8");
  let items = [];
  try { items = (JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")).items || {})[cc] || []; } catch (e) { continue; }
  const pc = { cc, items: items.length, before: 0, after: 0, changed: 0 };
  for (const i of items) {
    const texts = [[i.title_en, i.summary_en].filter(Boolean).join(" \n "), i.title];
    let g = null;
    for (const x of texts) { const r = placeIn(gz, x, [cc]); if (r && (!g || (r.prec === "approx" && g.prec !== "approx"))) g = r; if (g && g.prec === "approx") break; }
    const a = g ? { n: g.name, la: g.lat, lo: g.lon, p: g.prec } : null, b = i.geo || null;
    tot.items++; if (b) { pc.before++; tot.before++; } if (a) { pc.after++; tot.after++; }
    if (!inside(cc, b)) tot.outBefore++;
    if (!inside(cc, a)) { tot.outAfter++; outs.push(`${cc}\t${a.n} (${a.la}, ${a.lo}) in ${ccsAt(a.la, a.lo, 1).join("/") || "sea"}\t${String(i.title_en || i.title).slice(0, 90)}`); }
    const same = (!a && !b) || (a && b && a.n === b.n && Math.abs(a.la - b.la) < 0.01 && Math.abs(a.lo - b.lo) < 0.01);
    if (same) continue;
    pc.changed++; tot.changed++;
    const kind = b && !a ? "dropped" : !b ? "added" : "moved"; tot[kind]++;
    // why the old pin went: its name is now a common word, an ambiguous town, or outside a region the text names
    let r = "other";
    if (b) {
      const nm = namesIn(gz, texts[0] || texts[1], [cc]), tw = nm.towns.find((x) => x.name === b.n), named = new Set(nm.regs.map((x) => x.a1));
      r = !tw && !nm.regs.some((x) => x.name === b.n) ? "common word" : tw && named.size && !named.has(tw.a1) ? "outside the named region" : tw && tw.amb ? "ambiguous town" : nm.regs.length > 1 ? "several regions" : "other";
    }
    why[r] = (why[r] || 0) + 1;
    lines.push(`${cc}\t${kind}\t${r}\t${b ? b.n : "-"} -> ${a ? a.n + " (" + a.p + ")" : "unplaced"}\t${String(i.title_en || i.title).slice(0, 110)}`);
  }
  per.push(pc);
}
console.log("TOTAL", JSON.stringify(tot));
console.log("WHY old pins changed", JSON.stringify(why));
console.log("PER COUNTRY (changed > 0):", per.filter((p) => p.changed).map((p) => `${p.cc} ${p.changed}/${p.items}`).join(", "));
console.log("CHANGES (cc, kind, reason, before -> after, headline):");
lines.forEach((l) => console.log(l));
console.log("PINS OUTSIDE THEIR COUNTRY'S OUTLINE AFTER (cc, place, where, headline):");
outs.forEach((l) => console.log(l));
