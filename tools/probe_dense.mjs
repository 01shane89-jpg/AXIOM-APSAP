// PROBE BRANCH ONLY: JCG NAVAREA XI, India NAVAREA VIII, AMSA raw layout + copyright.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const txt = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const g = async (u) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); const b = Buffer.from(await r.arrayBuffer()); return [r, b]; };
for (const u of ["https://www1.kaiho.mlit.go.jp/TUHO/keiho/navarea11.html", "https://www1.kaiho.mlit.go.jp/TUHO/keiho/navarea11_e.html", "https://www1.kaiho.mlit.go.jp/TUHO/keiho/index_e.html"]) {
  try { const [r, b] = await g(u); const h = b.toString("utf8"); const links = [...new Set([...h.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]))].slice(0, 40);
    console.log("JCG " + r.status + " " + b.length + " " + r.url + " | ctype " + r.headers.get("content-type") + " | LINKS " + links.join(" ")); console.log("JCGT " + txt(h).slice(0, 2500)); const i = h.search(/NAVAREA XI \d+\//); if (i > 0) console.log("JCGR " + h.slice(i - 400, i + 1500).replace(/\s+/g, " ")); } catch (e) { console.log("JCG ERR " + u + " " + e.message); }
}
for (const u of ["https://hydrobharat.gov.in/navarea-warnings"]) {
  try { const [r, b] = await g(u); const h = b.toString("utf8"); const t = txt(h); const i = t.search(/NAVAREA VIII \d+\//i); console.log("IN " + r.status + " " + b.length + " | " + t.slice(Math.max(0, i - 300), i + 2500));
    const links = [...new Set([...h.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((x) => /navarea|warn|pdf|txt|json|api/i.test(x)))].slice(0, 25); console.log("INL " + links.join(" ")); } catch (e) { console.log("IN ERR " + e.message); }
}
try { const [r, b] = await g("https://www.operations.amsa.gov.au/AMSA.Web.MSIPublication/Home"); const h = b.toString("utf8"); const i = h.indexOf("NAVAREA X 118"); console.log("AM " + h.slice(Math.max(0, i - 1500), i + 1200).replace(/\s+/g, " ")); } catch (e) { console.log("AM ERR " + e.message); }
try { const [r, b] = await g("https://www.amsa.gov.au/copyright"); const t = txt(b.toString("utf8")); const i = t.indexOf("Copyright Copyright"); const j = t.search(/Creative Commons|CC BY|licen[cs]ed under/i); console.log("AMC " + t.slice(j - 600, j + 1200)); } catch (e) { console.log("AMC ERR " + e.message); }
