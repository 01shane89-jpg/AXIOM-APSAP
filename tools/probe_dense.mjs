// PROBE BRANCH ONLY: second attempts at piracy sources: ReCAAP ISC incident list PDF (text via pdfjs), ReCAAP terms, MDAT-GoG.
import { execSync } from "node:child_process";
import fs from "node:fs";
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const strip = (t) => t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
try {
  execSync("npm i --no-save --prefix /tmp/pdf pdfjs-dist@4.10.38 >/dev/null 2>&1");
  const pdfjs = await import("/tmp/pdf/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const r = await fetch("https://www.recaap.org/resources/ck/files/Number%20of%20Incidents/2026/List%20of%20Incidents%20for%202026.pdf", { headers: { "user-agent": UA } });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
  console.log("PDF pages " + doc.numPages);
  for (let p = 1; p <= Math.min(2, doc.numPages); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const txt = tc.items.map((i) => i.str + (i.hasEOL ? "\n" : " ")).join("");
    txt.split("\n").slice(0, 70).forEach((l) => console.log("PDT " + p + " " + l.slice(0, 300)));
  }
} catch (e) { console.log("PDF ERR " + String(e.message || e).slice(0, 300)); }
for (const u of ["https://www.recaap.org/terms-of-use", "https://www.recaap.org/terms_and_conditions", "https://www.recaap.org/disclaimer", "https://www.recaap.org/copyright"]) {
  try { const r = await fetch(u, { headers: { "user-agent": UA } }); const t = strip(await r.text()); console.log("PRT " + u + " " + r.status + " " + (t.match(/.{0,250}(copyright|reproduc|commercial|permission).{0,350}/gi) || []).slice(0, 3).join(" || ").slice(0, 1200)); } catch (e) { console.log("PRT " + u + " ERR " + e.message); }
}
try { const h = await (await fetch("https://www.recaap.org/", { headers: { "user-agent": UA } })).text(); for (const m of h.matchAll(/href="([^"]*(term|disclaim|copyright|privacy)[^"]*)"/gi)) console.log("PRL " + m[1]); } catch (e) {}
for (const u of ["https://mdat-gog.org/", "http://www.mdat-gog.org/", "https://www.mdat-gog.org/index.php"]) {
  try { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) }); const t = await r.text(); console.log("PM " + u + " " + r.status + " " + strip(t).slice(0, 600)); } catch (e) { console.log("PM " + u + " ERR " + (e.cause ? e.cause.code || e.cause.message : e.message)); }
}
