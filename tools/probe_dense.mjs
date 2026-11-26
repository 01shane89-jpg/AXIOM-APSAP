// Probe 18 (26 Nov 2026): CelesTrak SATCAT owners (retry with gaps), McDowell Starlink stats table.
import { UA } from "./dense_lib.mjs";
const H = { "User-Agent": UA, Accept: "*/*" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function p(label, url) {
  for (let a = 0; a < 4; a++) { try { const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(90000) }); const t = await r.text(); console.log("P", label, a, r.status, t.length); if (r.ok) return t; } catch (e) { console.log("P", label, a, "ERR", String(e.cause?.code || e.message)); } await sleep(20000 * (a + 1)); }
  return "";
}
const sc = await p("satcat", "https://celestrak.org/pub/satcat.csv");
if (sc) {
  const L = sc.trim().split("\n"), h = L[0].trim().split(","); console.log("P satcat rows", L.length - 1, JSON.stringify(h));
  const ix = (k) => h.indexOf(k), iO = ix("OWNER"), iS = ix("OPS_STATUS_CODE"), iD = ix("DECAY_DATE"), iT = ix("OBJECT_TYPE"), iL = ix("LAUNCH_DATE"), iN = ix("OBJECT_NAME");
  const own = {}, st = {}; let act = 0; const recent = [];
  for (const l of L.slice(1)) { const f = l.trim().split(","); st[f[iS] || "-"] = (st[f[iS] || "-"] || 0) + 1; if (/^[+PBSX]$/.test(f[iS]) && !f[iD] && f[iT] === "PAY") { act++; own[f[iO]] = (own[f[iO]] || 0) + 1; if (Date.now() - Date.parse(f[iL]) < 14 * 864e5) recent.push(f[iN] + "/" + f[iO] + "/" + f[iL]); } }
  console.log("P satcat status", JSON.stringify(st)); console.log("P satcat active payloads", act, JSON.stringify(Object.entries(own).sort((a, b) => b[1] - a[1])));
  console.log("P satcat recent14d", recent.length, JSON.stringify(recent.slice(-30)));
}
await sleep(10000);
const so = await p("sources", "https://celestrak.org/satcat/sources.php");
console.log("P sources rows", JSON.stringify([...so.matchAll(/<td[^>]*>([A-Z0-9]{2,6})<\/td>\s*<td[^>]*>([^<]{3,60})<\/td>/g)].slice(0, 120).map((m) => m[1] + "=" + m[2])));
const md = await p("mcdowell", "https://planet4589.org/space/con/star/stats.html");
const txt = md.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const i = txt.search(/Total|in orbit|working/i); console.log("P mcd text", JSON.stringify(txt.slice(Math.max(0, i - 200), i + 2500)));
const g = await p("gcat", "https://planet4589.org/space/gcat/");
console.log("P gcat lic", JSON.stringify((g.replace(/<[^>]+>/g, " ").match(/[^.]{0,200}(licen[cs]e|Creative Commons|CC-BY|CC BY)[^.]{0,200}/gi) || []).slice(0, 4)));
