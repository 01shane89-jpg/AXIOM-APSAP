// Google Fact Check feed (tools/dense_factcheck.mjs): off without a key, outlet's rating only, claimant never named
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
delete process.env.GOOGLE_FACTCHECK_KEY;
const { factItems } = await import("../tools/dense_factcheck.mjs");
const { FEEDS } = await import("../tools/dense_lib.mjs");
ok(!FEEDS["google-factcheck"], "the feed is not registered when no key is set");
const now = Date.parse("2026-11-27T05:00:00Z");
const I = factItems([
  { text: "Video shows troops surrendering near Pokrovsk in Ukraine", claimant: "Jane Q. Private", claimDate: "2026-11-24T00:00:00Z",
    claimReview: [{ publisher: { name: "AFP Fact Check", site: "factcheck.afp.com" }, url: "https://factcheck.afp.com/doc.afp.com.ABC", title: "Old video recirculates", reviewDate: "2026-11-25T00:00:00Z", textualRating: "False" },
      { publisher: { name: "AFP Fact Check" }, url: "https://factcheck.afp.com/doc.afp.com.ABC", reviewDate: "2026-11-25T00:00:00Z", textualRating: "False" }] },
  { text: "Old claim", claimReview: [{ publisher: { name: "Snopes" }, url: "https://www.snopes.com/x", reviewDate: "2026-09-01T00:00:00Z", textualRating: "Mixture" }] },
  { text: "Bad link", claimReview: [{ publisher: { name: "X" }, url: "javascript:alert(1)", reviewDate: "2026-11-25T00:00:00Z", textualRating: "False" }] },
], now);
ok(I.length === 1, "one per article, nothing older than 14 days, https links only (" + I.length + ")");
ok(I[0].title === 'AFP Fact Check rates a claim "False": Video shows troops surrendering near Pokrovsk in Ukraine', "the outlet's rating, in its words (" + I[0].title + ")");
ok(/OSAP does not rule claims true or false/.test(I[0].detail), "says OSAP does not rule");
ok(!/Jane|Private/.test(JSON.stringify(I)), "the claimant is never named");
ok(I[0].ccs.includes("ua"), "placed on the country the claim is about");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
