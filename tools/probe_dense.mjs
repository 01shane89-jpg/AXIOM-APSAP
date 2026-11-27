// Probe 44 (27 Nov 2026): EUvsDisinfo RSS, cases html, copyright.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA } }); return [r.status, await r.text()]; };
for (const u of ["https://euvsdisinfo.eu/feed/", "https://euvsdisinfo.eu/disinformation-cases/", "https://euvsdisinfo.eu/about/", "https://euvsdisinfo.eu/legal-notice/", "https://euvsdisinfo.eu/disinformation-cases/feed/"]) {
  const [s, t] = await get(u); console.log("P ==", s, u, t.length);
  if (/cases\/$/.test(u)) { const i = t.indexOf("disinfo-db"); console.log("P   HTML", t.slice(Math.max(0, t.indexOf("<table") - 200), t.indexOf("<table") + 3500).replace(/\s+/g, " ")); console.log("P   LINKS", [...new Set([...t.matchAll(/href="(https:\/\/euvsdisinfo\.eu\/report\/[^"]+)"/g)].map((m) => m[1]))].slice(0, 5).join(" ")); }
  else if (/feed/.test(u)) console.log("P   ", t.slice(0, 1800).replace(/\s+/g, " "));
  else for (const k of ["reproduc", "copyright", "licen", "Creative Commons", "authoris"]) { const i = t.search(new RegExp(k, "i")); if (i > 0) console.log("P   ", k, "|", t.slice(i - 200, i + 300).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); }
  await new Promise((r) => setTimeout(r, 1500));
}
const [s, t] = await get("https://euvsdisinfo.eu/report/");
console.log("P == report index", s, t.length);
