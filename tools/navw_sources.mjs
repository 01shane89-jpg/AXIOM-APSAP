// Broadcast navigational warnings in force from NAVAREA coordinators other than NGA, read from their own public pages.
// Used by tools/refresh_more.mjs (job navw, data/live/navwarnings.js) and tools/refresh_warngeo.mjs (map overlay shapes),
// so one source that is down (msi.nga.mil has answered HTTP 503 to the runners since 3 Nov 2026) leaves the others.
//   AMSA NAVAREA X and Auscoast: CC BY 4.0 (amsa.gov.au/copyright).
//   Japan Coast Guard NAVAREA XI: JCG site terms (www1.kaiho.mlit.go.jp/copyright.html) allow free reuse, commercial use
//     included, with credit; the e-Gov open data portal lists the page as CC BY.
//   UKHO NAVAREA I and UK coastal: Crown copyright, no open licence found, so nc: true (the sold version does not ask it).
// Each reader returns [{ id, issued, dtg, text, subregion? }]; dtg is the DDHHMMZ MON YY form tools/warngeo_lib.mjs dtg() reads.
// Every reader is given the caller's get(url, as, opt) so timeouts and the user agent stay the caller's.
const MONS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p2 = (n) => String(n).padStart(2, "0");
export const dtgOf = (d) => (isNaN(d) ? "" : p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + "Z " + MONS[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(-2));
// the "warnings in force" roll-call messages list numbers only
export const isRollCall = (t) => /WARNINGS IN FORCE|有効一覧/i.test(t);
const unent = (s) => String(s || "").replace(/&#xA;|&#10;/gi, "\n").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
// AMSA (RCC Australia) MSI page: SECURITE ... NNNN blocks, "FM JRCC AUSTRALIA 060110Z NOV 26", then "NAVAREA X 118/26" or "AUSCOAST WARNING 327/26"
export function amsaWarnings(html) {
  const out = [], body = unent(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "\n"));
  for (const blk of body.split(/\bSECURITE\b/).slice(1)) {
    const t = blk.split(/\bNNNN\b/)[0].trim(), lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
    const fm = (lines[0] || "").match(/^FM .*?(\d{6}Z \w{3} \d{2})/), idl = (lines[1] || "").match(/^(NAVAREA X|AUSCOAST WARNING)\s+(\d+\/\d{2})/);
    if (!idl) continue;
    const text = lines.slice(2).join("\n");
    if (isRollCall(text)) continue;
    out.push({ id: (idl[1] === "NAVAREA X" ? "NAVAREA X " : "AUSCOAST ") + idl[2], issued: fm ? fm[1] : "", dtg: fm ? fm[1].toUpperCase() : "", text });
  }
  return out;
}
// UKHO Radio Navigational Warnings page: one table row per warning, the full text in <pre id="Details_Description_N">
export function ukhoWarnings(html) {
  const h = String(html), out = [];
  for (const m of h.matchAll(/id="Details_Reference_(\d+)"[^>]*>\s*([^<]+?)\s*<\/h2>[\s\S]*?id="Details_DateTimeGroupRnwFormat_\1"[^>]*>\s*([^<]+?)\s*<\/h3>[\s\S]*?<pre id="Details_Description_\1"[^>]*>([\s\S]*?)<\/pre>/g)) {
    const type = (h.match(new RegExp('id="Details_WarningType_' + m[1] + '"[^>]*>\\s*([^<]+?)\\s*<')) || [])[1] || "";
    const text = unent(m[4]).trim();
    if (isRollCall(text)) continue;
    const iss = unent(m[3]).trim(), d = iss.match(/^(\d{6})\s*(?:UTC|Z)\s+([A-Za-z]{3})\s+(\d{2,4})$/);
    out.push({ id: unent(m[2]).trim(), issued: iss, dtg: d ? d[1] + "Z " + d[2].toUpperCase() + " " + d[3].slice(-2) : "", subregion: type.trim(), text });
  }
  return out;
}
// Japan Coast Guard NAVAREA XI: warnings.cgi lists each year's warnings still in force (XML <Member>), disp_warnings.cgi gives the
// broadcast English text ("NO.26-0498 発表日時：2026年11月06日 21時" then the message).
const JCG = "https://www1.kaiho.mlit.go.jp/TUHO/keiho/cgi/";
export function jcgText(html) {
  const b = String(html).slice(String(html).search(/<body/i));
  const head = (b.match(/<STRONG>\s*NO\.([\d-]+)\s*発表日時：(\d{4})年(\d\d)月(\d\d)日\s*(\d\d)時/i) || []);
  const text = unent(b.replace(/<STRONG>[\s\S]*?<\/STRONG>/i, "").replace(/<H1>[\s\S]*?<\/H1>/i, "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();
  // issue time is Japan time (UTC+9)
  const t = head[2] ? new Date(Date.UTC(+head[2], +head[3] - 1, +head[4], +head[5] - 9)) : null;
  return { no: head[1] || "", issued: t ? t.toISOString().slice(0, 16).replace("T", " ") + "Z" : "", dtg: t ? dtgOf(t) : "", text };
}
export async function jcgWarnings(get) {
  const y = new Date().getUTCFullYear(), out = [];
  for (const yr of [y, y - 1, y - 2]) {
    const xml = await get(JCG + "warnings.cgi", "text", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "YEAR=" + yr + "&TYPE=NAVAREA11&LANG=JP" });
    for (const m of xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)) {
      const tana = (m[1].match(/<tana>\s*(\d+)\s*</) || [])[1], title = (m[1].match(/<title>([^<]*)</) || [])[1] || "";
      if (!tana || isRollCall(title)) continue;
      out.push(tana);
    }
  }
  const items = [];
  for (const tana of out.slice(0, 60)) {
    try { const w = jcgText(await get(JCG + "disp_warnings.cgi?TYPE=NAVAREA11&TANA=" + tana + "&LANG=JP", "text")); if (w.text && !isRollCall(w.text)) items.push({ id: "NAVAREA XI " + (w.no || tana).replace(/^(\d\d)-0*(\d+)$/, "$2/$1"), issued: w.issued, dtg: w.dtg, text: w.text }); }
    catch (e) {}
    await sleep(200);
  }
  if (out.length && !items.length) throw new Error("no warning text read (" + out.length + " listed)");
  return items;
}
export const NAVW_SRC = [
  { id: "amsa", area: "NAVAREA X (AMSA)", url: "https://www.operations.amsa.gov.au/AMSA.Web.MSIPublication/Home", link: "https://www.amsa.gov.au/safety-navigation/navigation-systems/maritime-safety-information-database",
    authority: "JRCC Australia (AMSA)", lic: "CC BY 4.0, Australian Maritime Safety Authority", read: async (s, get) => amsaWarnings(await get(s.url, "text")) },
  { id: "jcg", area: "NAVAREA XI (JCG)", url: "https://www1.kaiho.mlit.go.jp/TUHO/keiho/navarea11.html", link: "https://www1.kaiho.mlit.go.jp/TUHO/keiho/navarea11.html",
    authority: "Japan Coast Guard", lic: "Japan Coast Guard site terms (free reuse, commercial use allowed, credit the source)", read: (s, get) => jcgWarnings(get) },
  { id: "ukho", area: "NAVAREA I and UK coastal (UKHO)", url: "https://msi.admiralty.co.uk/RadioNavigationalWarnings", link: "https://msi.admiralty.co.uk/RadioNavigationalWarnings",
    authority: "UK Hydrographic Office", lic: "Crown copyright, UK Hydrographic Office (no open licence found)", nc: true, read: async (s, get) => ukhoWarnings(await get(s.url, "text")) },
];
