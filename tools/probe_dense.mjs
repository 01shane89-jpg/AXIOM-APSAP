// PROBE BRANCH ONLY: structure of UKHO / AMSA / NZ / Fiji warning pages.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
for (const [u, key] of [["https://msi.admiralty.co.uk/RadioNavigationalWarnings", "NAVAREA I"], ["https://www.amsa.gov.au/safety-navigation/navigation-systems/maritime-safety-information-database", "NAVAREA X"], ["https://www.maritimenz.govt.nz/navarea", "NAVAREA"], ["https://www.maritimenz.govt.nz/commercial/safety/safety-updates/navarea-xiv-warnings/", "NAVAREA"], ["https://www.msaf.com.fj/category/alerts-notices/coastal-warnings/", "WARNING"]]) {
  try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); const h = await r.text(); const i = h.indexOf(key, 3000);
    console.log("ST " + r.status + " " + h.length + " " + r.url + " first@" + i + " count " + h.split(key).length);
    const k = h.search(/<table|<tbody/i); console.log("TB " + u.slice(8, 40) + " table@" + k + " | " + h.slice(Math.max(0, k), k + 2500).replace(/\s+/g, " "));
    if (i > 0) console.log("KW " + u.slice(8, 40) + " | " + h.slice(i - 600, i + 1800).replace(/\s+/g, " "));
    const rss = [...h.matchAll(/href="([^"]*(?:rss|feed|xml|json|csv|download|export)[^"]*)"/gi)].map((m) => m[1]).slice(0, 10); console.log("LN " + rss.join(" "));
  } catch (e) { console.log("ST ERR " + u + " " + e.message); }
}
