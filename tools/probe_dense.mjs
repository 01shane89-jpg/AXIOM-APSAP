// PROBE BRANCH ONLY: where each NAVAREA coordinator publishes warnings in force (IHO WWNWS16 self-assessments) + candidate pages.
import zlib from "node:zlib";
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const A = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI"];
function pdfText(buf) { const s = buf.toString("latin1"); let out = ""; for (const m of s.matchAll(/stream\r?\n/g)) { const st = m.index + m[0].length, en = s.indexOf("endstream", st); if (en < 0) continue; try { const z = zlib.inflateSync(buf.subarray(st, en)).toString("latin1"); out += [...z.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => x[1]).join("") + " "; } catch {} } return out + " " + s; }
for (const a of A) {
  for (const u of ["https://iho.int/uploads/user/Inter-Regional%20Coordination/WWNWS/WWNWS16/WWNWS16_2024_3.2-" + a + "_EN_Self%20Assessment%20NAVAREA%20" + a + ".pdf", "https://iho.int/uploads/user/Inter-Regional%20Coordination/WWNWS/WWNWS13/WWNWS13_2021_3.2_EN_" + a + "_Self_Assessment_v1.0.pdf"]) {
    try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) { console.log("SA " + a + " " + r.status); continue; } const t = pdfText(Buffer.from(await r.arrayBuffer()));
      const urls = [...new Set((t.match(/(?:https?:\/\/|www\.)[A-Za-z0-9./_\-?=&%#~:]+/g) || []).filter((x) => !/iho\.int|adobe|w3\.org|purl|ns\.|xmp|iptc/i.test(x)))].slice(0, 15);
      console.log("SA " + a + " ok " + u.slice(-50) + " | " + urls.join(" ")); break; } catch (e) { console.log("SA " + a + " ERR " + e.message); }
  }
}
for (const u of ["https://msi.admiralty.co.uk/RadioNavigationalWarnings", "https://msi.admiralty.co.uk/NavareaWarnings", "https://www.amsa.gov.au/node/531", "https://www.amsa.gov.au/safety-navigation/navigation-systems/maritime-safety-information", "https://www1.kaiho.mlit.go.jp/TUHO/navarea/navarea_xi_e.html", "https://www1.kaiho.mlit.go.jp/TUHO/tuho/nav_e.html", "https://www1.kaiho.mlit.go.jp/TUHO/"]) {
  try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); const h = await r.text(); const links = [...new Set([...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((x) => /nav|warn|xml|rss|txt|csv|json|NAVAREA|area/i.test(x)))].slice(0, 25);
    console.log("PG " + r.status + " " + h.length + " " + r.url + " | " + links.join(" ")); } catch (e) { console.log("PG ERR " + u + " " + e.message); }
}
