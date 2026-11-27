// Probe 57 (27 Nov 2026): official US legislation sources, keyless, from the runners.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
async function t(name, url, show = 600) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
    const b = await r.text();
    console.log("P", name, r.status, r.headers.get("content-type"), b.length);
    console.log("P   ", b.slice(0, show).replace(/\s+/g, " "));
    return b;
  } catch (e) { console.log("P", name, "ERR", e.message); return ""; }
}
const sm = await t("senate-menu", "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_2.xml", 1500);
const nums = [...sm.matchAll(/<vote_number>(\d+)<\/vote_number>/g)].map((m) => m[1]);
console.log("P senate votes listed", nums.length, nums.slice(0, 3).join(","));
if (nums[0]) await t("senate-vote", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_" + nums[0].padStart(5, "0") + ".xml", 2500);
// find the BAAJA vote on 19 Nov
const i = sm.indexOf("19-Nov"); console.log("P 19-Nov block", i >= 0 ? sm.slice(Math.max(0, i - 900), i + 300).replace(/\s+/g, " ") : "none");
await t("house-evs-index", "https://clerk.house.gov/evs/2026/index.asp", 1200);
const hx = await t("house-roll", "https://clerk.house.gov/evs/2026/roll300.xml", 1500);
await t("clerk-api", "https://clerk.house.gov/Votes/MemberVotes?page=1", 300);
await t("govinfo-rss-bills", "https://www.govinfo.gov/rss/bills.xml", 1500);
await t("govinfo-rss-plaw", "https://www.govinfo.gov/rss/plaw.xml", 800);
await t("govinfo-bulk-billstatus", "https://www.govinfo.gov/bulkdata/json/BILLSTATUS/119/hr", 1200);
await t("govinfo-billstatus-2347", "https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr2347.xml", 3000);
await t("congress-demo", "https://api.congress.gov/v3/bill/119/hr/2347/actions?api_key=DEMO_KEY&format=json&limit=5", 1500);
await t("congress-rss", "https://www.congress.gov/rss/most-viewed-bills.xml", 600);
await t("senate-floor", "https://www.senate.gov/legislative/LIS/floor_activity/floor_activity.xml", 1200);
await t("house-floor", "https://clerk.house.gov/floorsummary/floor-download.aspx?date=20261119", 600);
