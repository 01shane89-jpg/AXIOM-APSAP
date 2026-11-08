// PROBE BRANCH ONLY: ReCAAP ISC incident list PDF, text items with positions (to build the column reader).
import { execSync } from "node:child_process";
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
execSync("npm i --no-save --prefix /tmp/pdf pdfjs-dist@4.10.38 >/dev/null 2>&1");
const pdfjs = await import("/tmp/pdf/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const r = await fetch("https://www.recaap.org/resources/ck/files/Number%20of%20Incidents/2026/List%20of%20Incidents%20for%202026.pdf", { headers: { "user-agent": UA } });
const doc = await pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
for (const p of [1, doc.numPages]) {
  const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 }); console.log("PG " + p + " w " + vp.width + " h " + vp.height);
  const tc = await pg.getTextContent();
  for (const i of tc.items) if (i.str.trim()) console.log("PI " + p + " " + Math.round(i.transform[4]) + " " + Math.round(i.transform[5]) + " " + i.str.slice(0, 80));
}
