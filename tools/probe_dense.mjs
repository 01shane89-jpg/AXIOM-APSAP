// Probe 17 (26 Nov 2026): CelesTrak SATCAT + active GP counts, McDowell Starlink stats.
import { UA } from "./dense_lib.mjs";
const H = { "User-Agent": UA, Accept: "*/*" };
async function p(label, url, show = 600) {
  for (let a = 0; a < 3; a++) try {
    const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(60000) });
    const t = await r.text();
    console.log("P", label, r.status, r.headers.get("content-type"), t.length, r.url);
    if (show) console.log("P", label, "body", JSON.stringify(t.slice(0, show)));
    return t;
  } catch (e) { console.log("P", label, "ERR", String(e.cause?.code || e.message)); await new Promise((r) => setTimeout(r, 5000)); }
  return "";
}
const sc = await p("satcat", "https://celestrak.org/pub/satcat.csv", 400);
if (sc) {
  const L = sc.trim().split("\n"), h = L[0].split(","); console.log("P satcat rows", L.length - 1, JSON.stringify(h));
  const iO = h.indexOf("OWNER"), iS = h.indexOf("OPS_STATUS_CODE"), iD = h.indexOf("DECAY_DATE"), iT = h.indexOf("OBJECT_TYPE"), iL = h.indexOf("LAUNCH_DATE");
  const own = {}; let act = 0, recent = 0;
  for (const l of L.slice(1)) { const f = l.split(","); if (/^[+PBSX]$/.test(f[iS]) && !f[iD] && f[iT] === "PAY") { act++; own[f[iO]] = (own[f[iO]] || 0) + 1; if (Date.now() - Date.parse(f[iL]) < 30 * 864e5) recent++; } }
  console.log("P satcat active payloads", act, "launched 30d", recent, JSON.stringify(Object.entries(own).sort((a, b) => b[1] - a[1]).slice(0, 25)));
  console.log("P satcat sample", JSON.stringify(L.slice(-3)));
}
await p("owners", "https://celestrak.org/satcat/sources.php", 300);
const a = await p("gp-active", "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv", 200);
console.log("P gp-active rows", a ? a.trim().split("\n").length - 1 : 0);
await p("mcdowell", "https://planet4589.org/space/con/star/stats.html", 1500);
await p("mcdowell-lic", "https://planet4589.org/space/gcat/", 0);
