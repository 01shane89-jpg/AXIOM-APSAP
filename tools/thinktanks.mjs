// Think tank and research-institute analysis (category "Analysis"), registered into the dense open-data run (tools/refresh_dense.mjs).
// Every item is that institute's published assessment, a sourced opinion and not fact, so its kind reads "<institute> assessment".
// Only the headline, a short summary (at most 280 characters) and the link are kept, never the article text, which belongs to the publisher.
// Items are tagged to the countries named in the headline or summary; a map pin is added only when a city in one of those countries is named.
// Each institute is its own feed. Candidate addresses are tried in order, then the feed link advertised on the home page.
// Licence: publisher copyright; headline and link only. Marked nc so these can be stripped in one pass before any paid use.
import { spawnSync } from "node:child_process";
import { rssItems, feed, run, ageDays } from "./dense_lib.mjs";
import { ccsInText, ccFromA2, withOki } from "./geo_cc.mjs";

const TT = [
  // id, institute, home page, candidate feed addresses
  ["rand", "RAND", "https://www.rand.org/", ["https://www.rand.org/pubs/commentary.xml", "https://www.rand.org/pubs.xml", "https://www.rand.org/news/press.xml"]],
  ["csis", "CSIS", "https://www.csis.org/", ["https://www.csis.org/analysis/feed", "https://www.csis.org/rss.xml", "https://www.csis.org/analysis/rss.xml"]],
  ["crisisgroup", "International Crisis Group", "https://www.crisisgroup.org/", ["https://www.crisisgroup.org/rss", "https://www.crisisgroup.org/rss.xml", "https://www.crisisgroup.org/rss/0"]],
  ["lowy", "Lowy Institute", "https://www.lowyinstitute.org/the-interpreter", ["https://www.lowyinstitute.org/the-interpreter/rss.xml", "https://www.lowyinstitute.org/rss.xml"]],
  ["aspi", "ASPI", "https://www.aspistrategist.org.au/", ["https://www.aspistrategist.org.au/feed/", "https://www.aspi.org.au/rss.xml"]],
  ["carnegie", "Carnegie Endowment", "https://carnegieendowment.org/", ["https://carnegieendowment.org/rss/solr/?fa=pubs", "https://carnegieendowment.org/rss", "https://carnegieendowment.org/rss.xml"]],
  ["iiss", "IISS", "https://www.iiss.org/", ["https://www.iiss.org/rss/", "https://www.iiss.org/en/rss/online-analysis/", "https://www.iiss.org/rss.xml"]],
  ["isw", "Institute for the Study of War", "https://understandingwar.org/", ["https://understandingwar.org/feed/", "https://www.understandingwar.org/rss.xml", "https://www.understandingwar.org/backgrounder/rss.xml"]],
  ["criticalthreats", "Critical Threats (AEI)", "https://www.criticalthreats.org/", ["https://www.criticalthreats.org/rss", "https://www.criticalthreats.org/feed", "https://www.criticalthreats.org/rss.xml"]],
  ["brookings", "Brookings", "https://www.brookings.edu/", ["https://www.brookings.edu/feed/"]],
  ["stimson", "Stimson Center", "https://www.stimson.org/", ["https://www.stimson.org/feed/"]],
  ["38north", "38 North (Stimson)", "https://www.38north.org/", ["https://www.38north.org/feed/"]],
  ["chatham", "Chatham House", "https://www.chathamhouse.org/", ["https://www.chathamhouse.org/rss.xml", "https://www.chathamhouse.org/path/rss.xml", "https://www.chathamhouse.org/feed"]],
  ["cfr", "Council on Foreign Relations", "https://www.cfr.org/", ["https://www.cfr.org/rss.xml", "https://www.cfr.org/rss-feeds/all", "https://www.cfr.org/feed"]],
  ["atlantic", "Atlantic Council", "https://www.atlanticcouncil.org/", ["https://www.atlanticcouncil.org/feed/"]],
  ["wotr", "War on the Rocks", "https://warontherocks.com/", ["https://warontherocks.com/feed/"]],
  ["ecfr", "ECFR", "https://ecfr.eu/", ["https://ecfr.eu/feed/"]],
  ["sipri", "SIPRI", "https://www.sipri.org/", ["https://www.sipri.org/rss.xml", "https://www.sipri.org/rss/news", "https://www.sipri.org/commentary/rss.xml"]],
  ["wilson", "Wilson Center", "https://www.wilsoncenter.org/", ["https://www.wilsoncenter.org/rss.xml", "https://www.wilsoncenter.org/feed"]],
  ["usip", "US Institute of Peace", "https://www.usip.org/", ["https://www.usip.org/rss.xml", "https://www.usip.org/publications/rss.xml"]],
  ["rusi", "RUSI", "https://www.rusi.org/", ["https://www.rusi.org/rss.xml", "https://www.rusi.org/explore-our-research/rss.xml"]],
  ["hudson", "Hudson Institute", "https://www.hudson.org/", ["https://www.hudson.org/rss.xml", "https://www.hudson.org/feed"]],
  ["jamestown", "Jamestown Foundation", "https://jamestown.org/", ["https://jamestown.org/feed/"]],
  ["orf", "Observer Research Foundation", "https://www.orfonline.org/", ["https://www.orfonline.org/feed", "https://www.orfonline.org/rss"]],
  ["africacenter", "Africa Center for Strategic Studies", "https://africacenter.org/", ["https://africacenter.org/feed/"]],
  ["issafrica", "ISS Africa", "https://issafrica.org/", ["https://issafrica.org/rss", "https://issafrica.org/iss-today/rss", "https://issafrica.org/rss.xml"]],
  ["mei", "Middle East Institute", "https://www.mei.edu/", ["https://www.mei.edu/rss.xml", "https://www.mei.edu/feed"]],
  ["washinstitute", "Washington Institute", "https://www.washingtoninstitute.org/", ["https://www.washingtoninstitute.org/rss.xml", "https://www.washingtoninstitute.org/feed"]],
  ["pacforum", "Pacific Forum", "https://pacforum.org/", ["https://pacforum.org/feed"]],
  ["amti", "AMTI (CSIS)", "https://amti.csis.org/", ["https://amti.csis.org/feed/"]],
  ["chinapower", "ChinaPower (CSIS)", "https://chinapower.csis.org/", ["https://chinapower.csis.org/feed/"]],
  ["belfer", "Belfer Center", "https://www.belfercenter.org/", ["https://www.belfercenter.org/rss.xml", "https://www.belfercenter.org/feed"]],
  ["gitoc", "Global Initiative against Transnational Organized Crime", "https://globalinitiative.net/", ["https://globalinitiative.net/feed/"]],
  ["fulcrum", "ISEAS Fulcrum", "https://fulcrum.sg/", ["https://fulcrum.sg/feed/"]],
  ["eaf", "East Asia Forum", "https://eastasiaforum.org/", ["https://eastasiaforum.org/feed/", "https://www.eastasiaforum.org/feed/"]],
  ["swp", "SWP Berlin", "https://www.swp-berlin.org/en/", ["https://www.swp-berlin.org/en/rss", "https://www.swp-berlin.org/en/rss.xml"]],
  ["ifri", "Ifri", "https://www.ifri.org/en", ["https://www.ifri.org/en/rss.xml", "https://www.ifri.org/rss.xml"]],
  ["clingendael", "Clingendael", "https://www.clingendael.org/", ["https://www.clingendael.org/rss.xml", "https://www.clingendael.org/feed"]],
  ["gmf", "German Marshall Fund", "https://www.gmfus.org/", ["https://www.gmfus.org/rss.xml", "https://www.gmfus.org/feed"]],
  ["fpri", "Foreign Policy Research Institute", "https://www.fpri.org/", ["https://www.fpri.org/feed/"]],
  ["quincy", "Quincy Institute", "https://quincyinst.org/", ["https://quincyinst.org/feed/"]],
  ["merics", "MERICS", "https://merics.org/en", ["https://merics.org/en/rss.xml", "https://merics.org/en/feed"]],
  ["nbr", "National Bureau of Asian Research", "https://www.nbr.org/", ["https://www.nbr.org/feed/"]],
  ["cnas", "CNAS", "https://www.cnas.org/", ["https://www.cnas.org/feed", "https://www.cnas.org/rss"]],
  ["fdd", "FDD", "https://www.fdd.org/", ["https://www.fdd.org/feed/"]],
  ["euiss", "EU Institute for Security Studies", "https://www.iss.europa.eu/", ["https://www.iss.europa.eu/rss.xml", "https://www.iss.europa.eu/rss"]],
  ["acled", "ACLED analysis", "https://acleddata.com/", ["https://acleddata.com/feed/"]],
  ["swj", "Small Wars Journal", "https://smallwarsjournal.com/", ["https://smallwarsjournal.com/rss.xml", "https://smallwarsjournal.com/feed/"]],
  ["armscontrol", "Arms Control Association", "https://www.armscontrol.org/", ["https://www.armscontrol.org/rss.xml", "https://www.armscontrol.org/feed"]],
  ["idsa", "MP-IDSA", "https://www.idsa.in/", ["https://www.idsa.in/rss.xml", "https://www.idsa.in/feed"]],
  ["bellingcat", "Bellingcat", "https://www.bellingcat.com/", ["https://www.bellingcat.com/feed/"]],
];

// Pages that list an institute's feeds, searched when none of the candidate addresses answers.
const PAGES = { carnegie: ["https://carnegieendowment.org/rss/"], chatham: ["https://www.chathamhouse.org/rss-feeds"], sipri: ["https://www.sipri.org/rss"] };

// Adjectives that headlines use in place of country names ("Russian drones", "Iranian proxies").
const DEMONYMS = { russian: "Russia", ukrainian: "Ukraine", chinese: "China", iranian: "Iran", israeli: "Israel", palestinian: "Palestine", syrian: "Syria", iraqi: "Iraq",
  afghan: "Afghanistan", pakistani: "Pakistan", indian: "India", japanese: "Japan", "south korean": "South Korea", "north korean": "North Korea", taiwanese: "Taiwan",
  philippine: "Philippines", filipino: "Philippines", vietnamese: "Vietnam", indonesian: "Indonesia", malaysian: "Malaysia", thai: "Thailand", burmese: "Myanmar",
  cambodian: "Cambodia", australian: "Australia", turkish: "Turkey", saudi: "Saudi Arabia", emirati: "United Arab Emirates", egyptian: "Egypt", libyan: "Libya",
  sudanese: "Sudan", ethiopian: "Ethiopia", somali: "Somalia", kenyan: "Kenya", nigerian: "Nigeria", malian: "Mali", yemeni: "Yemen", lebanese: "Lebanon",
  jordanian: "Jordan", german: "Germany", french: "France", british: "United Kingdom", polish: "Poland", belarusian: "Belarus", georgian: "Georgia",
  armenian: "Armenia", azerbaijani: "Azerbaijan", serbian: "Serbia", venezuelan: "Venezuela", mexican: "Mexico", brazilian: "Brazil", colombian: "Colombia",
  cuban: "Cuba", haitian: "Haiti", bangladeshi: "Bangladesh", "sri lankan": "Sri Lanka", nepali: "Nepal", mongolian: "Mongolia", kazakh: "Kazakhstan",
  uzbek: "Uzbekistan", congolese: "DR Congo", rwandan: "Rwanda", "south african": "South Africa", algerian: "Algeria", moroccan: "Morocco", tunisian: "Tunisia",
  qatari: "Qatar", kuwaiti: "Kuwait", bahraini: "Bahrain", omani: "Oman", hungarian: "Hungary", romanian: "Romania", moldovan: "Moldova", finnish: "Finland",
  swedish: "Sweden", norwegian: "Norway", danish: "Denmark", estonian: "Estonia", latvian: "Latvia", lithuanian: "Lithuania", canadian: "Canada",
  "papua new guinean": "Papua New Guinea", fijian: "Fiji", "solomon islands": "Solomon Islands", beijing: "China", moscow: "Russia",
  kyiv: "Ukraine", tehran: "Iran", pyongyang: "North Korea", seoul: "South Korea", tokyo: "Japan", taipei: "Taiwan", "new delhi": "India", islamabad: "Pakistan",
  kabul: "Afghanistan", washington: "United States", kremlin: "Russia", pentagon: "United States", houthi: "Yemen", houthis: "Yemen", hamas: "Palestine", hezbollah: "Lebanon" };
const DEM_RE = new RegExp("\\b(" + Object.keys(DEMONYMS).sort((a, b) => b.length - a.length).join("|") + ")\\b", "gi");
function countriesIn(text) {
  const out = ccsInText(text);
  for (const m of text.matchAll(DEM_RE)) for (const c of ccsInText(DEMONYMS[m[1].toLowerCase()])) if (!out.includes(c)) out.push(c);
  return out;
}

// City gazetteer (GeoNames cities15000, CC BY 4.0): capitals, plus cities over 250,000 people. Loaded once per run.
let GAZ = null;
async function gazetteer(g) {
  if (GAZ) return GAZ;
  GAZ = (async () => {
    const zip = await g("https://download.geonames.org/export/dump/cities15000.zip", "buf", { timeout: 60e3 });
    const r = spawnSync("unzip", ["-p", "-", "cities15000.txt"], { input: zip, maxBuffer: 64e6 });
    const txt = r.stdout && r.stdout.length ? r.stdout.toString("utf8") : "";
    if (!txt) throw new Error("gazetteer unzip failed");
    const byName = new Map();
    for (const line of txt.split("\n")) {
      const f = line.split("\t"); if (f.length < 15) continue;
      const pop = +f[14], cap = f[7] === "PPLC";
      if (!cap && pop < 250000) continue;
      const cc = ccFromA2(f[8]); if (!cc) continue;
      for (const n of new Set([f[1], f[2]])) {
        if (!n || n.length < 4) continue;
        const k = n.toLowerCase(), prev = byName.get(k);
        const rec = { cc, lat: +f[4], lon: +f[5], pop: cap ? pop + 1e9 : pop, name: f[1] };
        if (!prev || rec.pop > prev.pop) byName.set(k, rec);
      }
    }
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return { byName, re: new RegExp("\\b(" + names.join("|") + ")\\b", "gi") };
  })();
  return GAZ;
}
function placeIn(gz, text, ccs) {
  for (const m of text.matchAll(gz.re)) { const c = gz.byName.get(m[1].toLowerCase()); if (c && ccs.includes(c.cc)) return c; }
  return null;
}

// Institutes that switched their feeds off still publish a sitemap. Headlines then come from the page address, and the date is
// when the page last changed (not necessarily when it was first published); both are said so on each item.
const NOT_ARTICLE = /\/(events?|experts?|people|person|staff|author|authors|about|careers?|jobs|tags?|topics?|regions?|programs?|projects?|category|categories|search|donate|contact|press-releases?|podcasts?|video|videos|media|newsletters?)(\/|$)/i;
async function fromSitemap(g, home) {
  const origin = new URL(home).origin;
  let maps = [];
  try { const r = await g(origin + "/robots.txt", "text", { timeout: 15e3 }); maps = [...r.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]); } catch (e) {}
  if (!maps.length) maps = [origin + "/sitemap_index.xml", origin + "/sitemap.xml"];
  const locs = (x, tag) => [...x.matchAll(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "g"))].map((m) => ({ loc: ((m[1].match(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/) || [])[1] || "").trim(), mod: ((m[1].match(/<lastmod>([^<]+)/) || [])[1] || "").trim() }));
  for (const sm of maps.slice(0, 2)) {
    let x; try { x = await g(sm, "text", { timeout: 20e3 }); } catch (e) { continue; }
    let urls = locs(x, "url");
    if (!urls.length) { // a sitemap index: read the one or two article sitemaps changed most recently
      const kids = locs(x, "sitemap").filter((k) => k.loc && !/(page|event|person|people|expert|author|staff|tag|categor|image|video|attachment|topic|region|program|project|taxonom)/i.test(k.loc))
        .sort((a, b) => (b.mod || "").localeCompare(a.mod || "")).slice(0, 2);
      for (const k of kids) { try { urls = urls.concat(locs(await g(k.loc, "text", { timeout: 20e3 }), "url")); } catch (e) {} }
    }
    const out = urls.filter((u) => u.loc && u.mod && ageDays(u.mod) <= 30 && !NOT_ARTICLE.test(new URL(u.loc).pathname) && new URL(u.loc).pathname.split("/").filter(Boolean).length >= 1)
      .sort((a, b) => b.mod.localeCompare(a.mod)).slice(0, 60).map((u) => {
        const slug = decodeURIComponent(new URL(u.loc).pathname.split("/").filter(Boolean).pop()).replace(/\.(html?|aspx?|php)$/i, "");
        const title = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
        return { title: title.charAt(0).toUpperCase() + title.slice(1), link: u.loc, date: u.mod, summary: "Headline taken from the page address; the date is when the page last changed." };
      }).filter((e) => e.title.split(" ").length >= 3);
    if (out.length) return out;
  }
  throw new Error("no recent pages in sitemap");
}

const UA_FEED = { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" };
for (const [id, org, home, urls] of TT) {
  const fid = "tt-" + id;
  feed(fid, { name: org + " analysis", org, cat: "Analysis", lic: "Publisher copyright; headline, short summary and link only", nc: true, url: home, everyHours: 1 });
  run(fid, async (g) => {
    let entries = null, used = "", why = [];
    // A feed counts only if it holds something from the last 60 days (several institutes left a dead feed behind).
    const tryUrl = async (u) => {
      try {
        const t = await g(u, "text", { headers: UA_FEED, timeout: 20e3 });
        if (!/<(item|entry)[\s>]/.test(t)) { why.push(u + ": not a feed"); return false; }
        const es = rssItems(t).filter((x) => x.title && x.link && (!x.date || ageDays(x.date) <= 60));
        if (!es.length) { why.push(u + ": nothing recent"); return false; }
        entries = es; used = u; return true;
      } catch (e) { why.push(u + ": " + e.message); } return false;
    };
    for (const u of urls) if (await tryUrl(u)) break;
    if (!entries) { // fall back to feeds the home page (or the institute's feed list page) links to
      for (const pg of [home, ...(PAGES[id] || [])]) {
        try {
          const page = await g(pg, "text", { timeout: 20e3 });
          const alt = [...page.matchAll(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/gi)].map((m) => (m[0].match(/href="([^"]+)"/) || [])[1]);
          const anchors = [...page.matchAll(/href="([^"]*(?:rss|feed|atom)[^"]*)"/gi)].map((m) => m[1]).filter((h) => !/feedback|feedburner\.google|comments\/feed|\.(css|js|png|svg)(\?|$)/i.test(h));
          const links = [...new Set([...alt, ...anchors].filter(Boolean).map((l) => { try { return new URL(l.replace(/&amp;/g, "&"), pg).href; } catch { return null; } }).filter(Boolean))].filter((l) => !urls.includes(l) && l !== pg);
          let hit = false;
          for (const l of links.slice(0, 4)) if ((hit = await tryUrl(l))) break;
          if (hit) break;
        } catch (e) { why.push(pg + ": " + e.message); }
      }
    }
    if (!entries) { try { entries = await fromSitemap(g, home); used = "sitemap (headline from page address)"; } catch (e) { why.push("sitemap: " + e.message); } }
    if (!entries || !entries.length) throw new Error("no feed: " + why.join("; ").slice(0, 300));
    let gz = null; try { gz = await gazetteer(g); } catch (e) {}
    const kind = org + " assessment";
    const items = [], globals = [];
    for (const x of entries.slice(0, 60)) {
      const summary = x.summary.replace(/The post .* appeared first on .*$/i, "").trim();
      const short = summary.length > 280 ? summary.slice(0, 277).replace(/\s+\S*$/, "") + "..." : summary;
      const text = x.title + " " + summary.slice(0, 800);
      const ccs = withOki(countriesIn(text));
      const it = { title: x.title, detail: short, date: x.date, url: x.link, sev: 1, kind };
      if (!ccs.length) { globals.push(it); continue; }
      const p = gz && placeIn(gz, text, ccs);
      if (p) { it.lat = p.lat; it.lon = p.lon; }
      items.push({ ...it, ccs });
      if (items.length >= 40) break;
    }
    return { items, globals: globals.slice(0, 10), note: "via " + used };
  });
}
