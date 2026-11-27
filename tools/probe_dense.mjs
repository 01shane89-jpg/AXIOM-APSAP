// Probe 21 (27 Nov 2026): access and terms for Global Fishing Watch, OpenAIP, MITRE ATT&CK, EMM NewsBrief.
const { UA } = await import("./dense_lib.mjs");
const U = [
  "https://gateway.api.globalfishingwatch.org/v3/vessels/search?query=test&datasets[0]=public-global-vessel-identity:latest",
  "https://globalfishingwatch.org/our-apis/documentation",
  "https://globalfishingwatch.org/terms-of-use/",
  "https://api.core.openaip.net/api/airspaces?country=PL&limit=1",
  "https://www.openaip.net/terms",
  "https://www.openaip.net/data/exports",
  "https://docs.openaip.net/",
  "https://emm.newsbrief.eu/rss/rss?type=rtn&language=en&duplicates=false",
  "https://emm.newsbrief.eu/NewsBrief/clusteredition/en/latest.html",
  "https://emm.newsbrief.eu/legal_notice.html",
  "https://emm.newsbrief.eu/NewsBrief/disclaimer.html",
];
for (const u of U) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    console.log("P ==", u, r.status, r.headers.get("content-type"), t.length);
    const txt = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const k of ["licen", "commercial", "token", "API key", "register", "reuse", "re-use", "copyright", "export", "storage.googleapis", "attribution"]) {
      let i = -1, n = 0; while ((i = txt.toLowerCase().indexOf(k.toLowerCase(), i + 1)) >= 0 && n < 2) { console.log("P   ", k, "|", txt.slice(Math.max(0, i - 160), i + 200)); n++; i += 400; }
    }
    if (/rss|xml|json/.test(r.headers.get("content-type") || "")) console.log("P   HEAD", t.slice(0, 600).replace(/\s+/g, " "));
    const links = [...t.matchAll(/href="([^"]*(export|storage|download|\.json|\.geojson|rss)[^"]*)"/gi)].map((m) => m[1]).slice(0, 12);
    if (links.length) console.log("P   LINKS", links.join(" "));
  } catch (e) { console.log("P ==", u, "ERR", e.message); }
}
