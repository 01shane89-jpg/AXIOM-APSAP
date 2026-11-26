// Orbit census: working satellites by owner country and constellation, registered into the dense open-data run
// (tools/refresh_dense.mjs). Added 26 Nov 2026: IG Post 82 mapped every working satellite from CelesTrak and quoted Jonathan
// McDowell's Starlink statistics, which OSAP did not carry (sat-pass reads only the military, radar and imaging groups).
//   CelesTrak SATCAT (celestrak.org/pub/satcat.csv, ~7 MB, keyless): every catalogued object, with owner, status and launch
//   date. "Working" here is CelesTrak's operational status (+, P, B, S, X) for a payload that has not decayed.
//   CelesTrak can answer 503 when busy, so a failed read is retried after a pause; the feed runs every 6 hours, well inside
//   CelesTrak's request to fetch the same data at most every 2 hours.
//   McDowell's Starlink table (planet4589.org/space/con/star/stats.html, CC-BY 4.0): launched, in orbit and working.
// Counts are what the catalogs list; an owner code is the registering country or organization, not who operates the payload.
import { feed, run, sleep } from "./dense_lib.mjs";

// CelesTrak owner codes -> OSAP country ids (international organizations and companies with no country are left out)
export const OWNER_CC = { US: ["us"], PRC: ["cn"], UK: ["gb"], CIS: ["ru"], JPN: ["jp"], IT: ["it"], IND: ["in"], GER: ["de"], FR: ["fr"], SKOR: ["kr"], SPN: ["es"],
  CA: ["ca"], TURK: ["tr"], AUS: ["au"], ARGN: ["ar"], ROC: ["tw"], FIN: ["fi"], GREC: ["gr"], UAE: ["ae"], ISRA: ["il"], NOR: ["no"], SING: ["sg"], SAUD: ["sa"],
  POL: ["pl"], BRAZ: ["br"], POR: ["pt"], IRAN: ["ir"], LUXE: ["lu"], INDO: ["id"], EGYP: ["eg"], BEL: ["be"], NETH: ["nl"], SWTZ: ["ch"], PAKI: ["pk"], MALA: ["my"],
  RWA: ["rw"], THAI: ["th"], ALG: ["dz"], KAZ: ["kz"], DEN: ["dk"], BUL: ["bg"], MEX: ["mx"], VTNM: ["vn"], AZER: ["az"], BELA: ["by"], HUN: ["hu"], NIG: ["ng"],
  CHLE: ["cl"], ASRA: ["at"], SVN: ["si"], SWED: ["se"], CZCH: ["cz"], VENZ: ["ve"], ECU: ["ec"], SAFR: ["za"], UKR: ["ua"], RP: ["ph"], LTU: ["lt"], KWT: ["kw"],
  SVK: ["sk"], BOL: ["bo"], IRAQ: ["iq"], LAOS: ["la"], PERU: ["pe"], BGD: ["bd"], JOR: ["jo"], ETH: ["et"], ANG: ["ao"], NKOR: ["kp"], HRV: ["hr"], DJI: ["dj"],
  BWA: ["bw"], BHR: ["bh"], SLB: ["sb"], NZ: ["nz"], MNE: ["me"], ROM: ["ro"], EST: ["ee"], LKA: ["lk"], SEN: ["sn"], GUAT: ["gt"], BHUT: ["bt"], MA: ["ma"],
  FRIT: ["fr", "it"], CHBZ: ["cn", "br"], GRSA: ["gr", "sa"], FGER: ["fr", "de"], SGJP: ["sg", "jp"], STCT: ["sg", "tw"], USBZ: ["us", "br"], CHTU: ["cn", "tr"], TMMC: ["tm", "mc"] };
const WORKING = /^[+PBSX]$/;
/** constellation name from an object name: STARLINK-1234 -> STARLINK, ONEWEB-0012 -> ONEWEB */
export const constellation = (name) => (String(name || "").match(/^([A-Z][A-Z0-9]+?)(?:[- ]?\d|\s*\()/) || [, String(name || "").split(/[- ]/)[0]])[1];
/** SATCAT csv -> { total, owners: { code: { n, recent: [names], groups: { name: n } } }, groups } (working payloads only) */
export function census(csv, now = Date.now()) {
  const L = String(csv).trim().split(/\r?\n/), h = L[0].split(",").map((x) => x.trim()), ix = (k) => h.indexOf(k);
  const [iN, iT, iS, iO, iL, iD] = ["OBJECT_NAME", "OBJECT_TYPE", "OPS_STATUS_CODE", "OWNER", "LAUNCH_DATE", "DECAY_DATE"].map(ix);
  if ([iN, iT, iS, iO, iL, iD].some((i) => i < 0)) throw new Error("SATCAT columns changed: " + h.join(","));
  const owners = {}, groups = {}; let total = 0;
  for (const l of L.slice(1)) {
    const f = l.split(","); if (f[iT] !== "PAY" || !WORKING.test(f[iS]) || f[iD]) continue;
    total++; const o = owners[f[iO]] || (owners[f[iO]] = { n: 0, recent: [], groups: {} }), c = constellation(f[iN]);
    o.n++; o.groups[c] = (o.groups[c] || 0) + 1; groups[c] = (groups[c] || 0) + 1;
    if (now - Date.parse(f[iL]) < 30 * 864e5) o.recent.push(f[iN]);
  }
  return { total, owners, groups };
}
/** McDowell's Starlink table -> { launched, inOrbit, working } summed over the generation subtotals */
export function starlinkStats(html) {
  const t = String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), out = { launched: 0, inOrbit: 0, working: 0, asof: (t.match(/Data last updated: ([0-9]{4} [A-Z][a-z]{2} \d+)/) || [])[1] || "" };
  for (const m of t.matchAll(/Subtotal (Starlink [\w ]+?) \1 (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+)/g)) { out.launched += +m[2]; out.inOrbit += +m[8]; out.working += +m[12]; }
  return out.launched ? out : null;
}
// "OBJECT A" is a newly launched payload not yet named, so it is no group
const top = (o, n) => Object.entries(o).filter(([k]) => k !== "OBJECT").sort((a, b) => b[1] - a[1]).slice(0, n);
const named = (list) => { const n = list.filter((x) => !/^OBJECT\b/.test(x)), u = list.length - n.length; return { n, u }; };
export function censusItems(c) {
  const by = {};
  for (const [code, o] of Object.entries(c.owners)) for (const cc of OWNER_CC[code] || []) {
    const b = by[cc] || (by[cc] = { n: 0, recent: [], groups: {}, codes: [] });
    b.n += o.n; b.recent.push(...o.recent); b.codes.push(code); for (const [g, k] of Object.entries(o.groups)) b.groups[g] = (b.groups[g] || 0) + k;
  }
  return Object.entries(by).map(([cc, b]) => { const r = named(b.recent); return { title: b.n.toLocaleString("en-US") + " working satellites registered to the country" + (b.recent.length ? ", " + b.recent.length + " launched in the last 30 days" : ""),
    detail: "Largest groups: " + top(b.groups, 5).map(([g, k]) => g + " " + k).join(", ") + "." + (r.n.length ? " New: " + r.n.slice(0, 8).join(", ") + (r.n.length > 8 ? " and " + (r.n.length - 8) + " more" : "") + "." : "") + (r.u ? " " + r.u + " new " + (r.u === 1 ? "payload is" : "payloads are") + " not yet named." : "")
      + " CelesTrak SATCAT, owner code" + (b.codes.length > 1 ? "s " : " ") + b.codes.join(", ") + " (registering country, shared registrations counted for each), of " + c.total.toLocaleString("en-US") + " working satellites worldwide.",
    date: new Date().toISOString(), url: "https://celestrak.org/satcat/search.php", sev: 1, kind: "Satellites in orbit (census)", value: b.n, ccs: [cc] }; });
}
feed("orbit-census", { name: "Working satellites by owner country (CelesTrak SATCAT; Starlink from McDowell)", org: "CelesTrak; Jonathan McDowell (planet4589.org)", cat: "Space",
  lic: "CelesTrak data: free use with credit; McDowell's Starlink statistics: CC-BY 4.0, Jonathan McDowell", url: "https://celestrak.org/satcat/", everyHours: 6 });
run("orbit-census", async (g) => {
  let csv = "", last;
  for (let a = 0; a < 3 && !csv; a++) { try { csv = await g("https://celestrak.org/pub/satcat.csv", "text", { timeout: 90000 }); } catch (e) { last = e; await sleep(20000 * (a + 1)); } }
  if (!csv) throw last || new Error("no SATCAT");
  const c = census(csv), items = censusItems(c);
  let sl = null; try { sl = starlinkStats(await g("https://planet4589.org/space/con/star/stats.html", "text", { timeout: 60000 })); } catch (e) { /* the census stands without it */ }
  const globals = [{ title: c.total.toLocaleString("en-US") + " working satellites in orbit (CelesTrak SATCAT)" + (sl ? "; Starlink " + sl.working.toLocaleString("en-US") + " working of " + sl.launched.toLocaleString("en-US") + " launched (McDowell)" : ""),
    detail: "Largest groups: " + top(c.groups, 8).map(([k, n]) => k + " " + n.toLocaleString("en-US")).join(", ") + ". By owner: " + top(Object.fromEntries(Object.entries(c.owners).map(([k, o]) => [k, o.n])), 8).map(([k, n]) => k + " " + n.toLocaleString("en-US")).join(", ") + "."
      + (sl ? " Starlink (McDowell, " + sl.asof + "): " + sl.launched + " launched, " + sl.inOrbit + " in orbit, " + sl.working + " working; CC-BY 4.0." : ""),
    date: new Date().toISOString(), url: "https://celestrak.org/satcat/", sev: 1, kind: "Satellites in orbit (census)", value: c.total, ccs: ["us"] }];
  return { items, globals, note: c.total + " working payloads, " + items.length + " countries" + (sl ? ", Starlink " + sl.working + " working" : ", McDowell table not read") };
});
