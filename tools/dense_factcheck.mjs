// Published fact checks from the Google Fact Check Tools API (ClaimReview records that fact-checking outlets publish), registered
// into the dense open-data run. Added 27 Nov 2026 from the OSINT Framework comparison. SWITCHED OFF until a key exists: the feed
// is only registered when the GOOGLE_FACTCHECK_KEY secret is set (Shane sets it; see the PR). The key goes in the
// x-goog-api-key header, never in a URL, so it cannot reach logs or probe samples.
// OSAP never rules a claim true or false: each item says which outlet rated it and how, in that outlet's words. The person or
// account who made the claim is never named (claimants are often private social-media users); only the claim text, the outlet,
// its rating and the link to its article are shown.
import { feed, run, sleep } from "./dense_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";

// fact-checking outlets queried by site (IFCN signatories with English output); the API needs a query or a publisher filter
export const SITES = ["afp.com", "reuters.com", "apnews.com", "politifact.com", "factcheck.org", "fullfact.org", "snopes.com", "leadstories.com", "checkyourfact.com",
  "usatoday.com", "boomlive.in", "factly.in", "africacheck.org", "rappler.com", "vera.ph", "aap.com.au", "logically.ai", "misbar.com", "stopfake.org", "euvsdisinfo.eu"];
const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function factItems(claims, now = Date.now()) {
  const out = [], seen = new Set();
  for (const c of claims || []) {
    for (const r of (c && c.claimReview) || []) {
      const url = String(r.url || "");
      if (!/^https:\/\/[^\s"'<>]+$/.test(url) || seen.has(url)) continue;
      const t = Date.parse(r.reviewDate || c.claimDate || "");
      if (!(t > now - 14 * 864e5)) continue;
      const claim = clean(c.text, 240), outlet = clean((r.publisher || {}).name || (r.publisher || {}).site, 60), rating = clean(r.textualRating, 80);
      if (!claim || !outlet || !rating) continue;
      seen.add(url);
      out.push({
        title: outlet + " rates a claim \"" + rating + "\": " + claim,
        detail: (r.title ? clean(r.title, 200) + ". " : "") + "The rating is " + outlet + "'s, in its own words; OSAP does not rule claims true or false. Read the fact check for its evidence."
          + " Via the Google Fact Check Tools API (ClaimReview).",
        date: new Date(t).toISOString().slice(0, 10), url, sev: 1, kind: "Published fact check (" + outlet + ")", ccs: ccsInText(claim + " " + (r.title || "")),
      });
    }
  }
  return out;
}

if (process.env.GOOGLE_FACTCHECK_KEY) {
  feed("google-factcheck", { name: "Published fact checks (fact-checking outlets via Google Fact Check Tools)", org: "Fact-checking outlets; Google Fact Check Tools API", cat: "Events",
    lic: "Headlines, ratings and links only (each outlet's own terms)", url: "https://toolbox.google.com/factcheck/explorer", everyHours: 6 });
  run("google-factcheck", async (g) => {
    const H = { headers: { "x-goog-api-key": process.env.GOOGLE_FACTCHECK_KEY }, timeout: 30000 }, claims = [];
    let failed = 0;
    for (const site of SITES) {
      try { claims.push(...((await g("https://factchecktools.googleapis.com/v1alpha1/claims:search?reviewPublisherSiteFilter=" + site + "&languageCode=en&maxAgeDays=7&pageSize=50", "json", H)).claims || [])); }
      catch (e) { failed++; }
      await sleep(300);
    }
    if (failed === SITES.length) throw new Error("every request failed (check the GOOGLE_FACTCHECK_KEY secret)");
    const items = factItems(claims);
    return { items, note: claims.length + " claims from " + (SITES.length - failed) + " outlets; " + items.length + " fact checks in the last 14 days" };
  });
}
