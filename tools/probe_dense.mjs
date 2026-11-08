// PROBE BRANCH ONLY: JCG NAVAREA XI cgi.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const C = "https://www1.kaiho.mlit.go.jp/TUHO/keiho/cgi/";
const all = [];
for (const y of [2026, 2025, 2024]) for (const lang of ["EN", "E", "JP"]) {
  try { const r = await fetch(C + "warnings.cgi", { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body: "YEAR=" + y + "&TYPE=NAVAREA11&LANG=" + lang }); const t = await r.text();
    const m = [...t.matchAll(/<Member>([\s\S]*?)<\/Member>/g)].map((x) => x[1]); console.log("WL " + y + " " + lang + " " + r.status + " n=" + m.length + " | " + t.replace(/\s+/g, " ").slice(0, 700));
    if (lang !== "JP") for (const x of m) all.push({ y, lang, tana: (x.match(/<tana>([^<]*)/) || [])[1] }); } catch (e) { console.log("WL ERR " + e.message); }
}
const lang = (all[0] || {}).lang || "EN";
const tanas = [...new Set(all.map((x) => x.tana))].slice(0, 4);
for (const t of tanas) { try { const u = C + "disp_warnings.cgi?TYPE=NAVAREA11&TANA=" + encodeURIComponent(t) + "&LANG=" + lang; const r = await fetch(u, { headers: UA }); const h = await r.text(); console.log("DW " + r.status + " " + u + " | " + h.replace(/\s+/g, " ").slice(0, 1800)); } catch (e) { console.log("DW ERR " + e.message); } }
try { const r = await fetch(C + "disp_warnings.cgi", { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body: "TYPE=NAVAREA11&TANA=" + encodeURIComponent(tanas.join(":") + ":") + "&LANG=" + lang }); const h = await r.text(); console.log("DM " + r.status + " " + h.length + " | " + h.replace(/\s+/g, " ").slice(0, 2500)); } catch (e) { console.log("DM ERR " + e.message); }
for (const u of ["https://www1.kaiho.mlit.go.jp/copyright.html"]) { try { const h = await (await fetch(u, { headers: UA })).text(); const t = h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); console.log("CP " + (t.match(/.{0,300}(政府標準利用規約|CC BY|クリエイティブ|商用|Creative).{0,400}/g) || []).slice(0, 3).join(" || ")); } catch (e) { console.log("CP ERR " + e.message); } }
