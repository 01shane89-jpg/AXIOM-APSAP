// Unit test for the related-story match rules (assets/osap-relmatch.js), no browser, no network.
// Case: Shane 2026-11-08 shared "Rangers seize 'Happy Water'" (Bangkok Post; a drug seizure on the Mekong at Tha Uthen, Nakhon
// Phanom). Its "Connected stories" were a Malaysian beef seizure, a Cambodian rain forecast, a flash flood, a water shortage and
// polluted river water, all on the one word "water" or "seize". The Matichon Ubon drug haul was the one good match.
// The words each pair shares are found the way index.html rTok() does (words of 4+ letters, not numbers, minus its stop words).
// Usage: node tests/relmatch.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("../assets/osap-relmatch.js", import.meta.url), "utf8"), ctx);
const RM = ctx.window.OSAP_RELMATCH;
assert.ok(RM && RM.strength && RM.enough && RM.enoughSocial && RM.dupKey, "osap-relmatch.js sets window.OSAP_RELMATCH");

/* index.html's tokenizer and stop words, read from the page so the test follows it */
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stopSrc = html.match(/var RSTOP = \{\}; \("([^"]*)" \+\s*"([^"]*)"\)/);
assert.ok(stopSrc, "index.html still has the RSTOP stop words in the expected form");
const STOP = new Set((stopSrc[1] + stopSrc[2]).split(" "));
const tok = (s) => new Set(String(s || "").toLowerCase().split(/[^0-9a-zÀ-ɏ฀-๿぀-ヿ一-鿿가-힯]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
const shared = (a, b) => { const A = tok(a); return [...tok(b)].filter((w) => A.has(w)); };

const happy = "Rangers seize 'Happy Water' Nakhon Phanom";
const verdict = (other, social) => {
  const w = RM.strength(shared(happy, other), happy, other);
  return social ? RM.enoughSocial(w, false, 1) : RM.enough(w, false, 1);
};
let n = 0;
function check(other, social, want, label) {
  const got = verdict(other, social);
  assert.equal(got, want, `${label}: expected ${want ? "a match" : "no match"} (${JSON.stringify(RM.strength(shared(happy, other), happy, other))})`);
  console.log("PASS " + label + (want ? " (kept)" : " (dropped)")); n++;
}
/* the eight items Shane was sent */
check("Foreign man arrested over Thai ID fraud after 12-year investigation", false, false, "Thaiger ID fraud");
check("Ubal arrests two big drugs shipments, 4 suspects, seize 10.4 million pills in the water of Bhut-Bunditrik", false, true, "Matichon Ubon drug haul");
check("Klang port seize cow meat, halal certificate questionable", true, false, "Astro AWANI beef seizure");
check("Ministry of Water Resources: From November 7 to 15, Cambodia may have rainfall with thunderstorms.", true, false, "Fresh News rain forecast");
check("7 Nov 2026 - BW- FLOOD KILAT: PEOPLE HAVE TO UPGRADE THE WATER SYSTEM", true, false, "Berita RTM flash flood");
check("Midday News Brief 11/07: Water shortage in the middle of rainy season, many hydropower plants in...", true, false, "VTV24 water shortage");
check("Urgent Investigation into \"Black Water\" Flowing into the Prachin Buri River | Evening News | Nov ...", true, false, "ThaiPBS black water");
/* what should still match */
check("Rangers find more Happy Water sachets on the Mekong", true, true, "a post naming Happy Water");
check("Nakhon Phanom police seize 2 million meth pills from Mekong boat", false, true, "another Nakhon Phanom drug seizure");
check("Army seizes yaba and crystal meth at Mekong landing, Nakhon Phanom", true, true, "a post on a Nakhon Phanom meth haul");

/* nearby in place and time is still enough on its own, as the Report's "nearby" rule has it */
assert.equal(RM.enough(RM.strength([], happy, "Boat capsizes on the Mekong"), true, 1), true); console.log("PASS same place, same day: still listed"); n++;
/* different kinds with little in common are not listed even nearby, unless close in time */
assert.equal(RM.enough(RM.strength(["water"], happy, "Water shortage hits farms"), true, 10), false); console.log("PASS same place, 10 days, drugs vs drought on one word: dropped"); n++;
/* kinds */
assert.equal(JSON.stringify(RM.kinds("Rangers seize 'Happy Water'")), "[\"drugs\"]");
assert.equal(RM.kinds("Border checkpoint reopens").length, 0);
assert.ok(RM.kinds("Oil spill off Rayong").indexOf("drugs") < 0, "an oil spill is not a drug story ('spill' is not 'pill')");
console.log("PASS event kinds"); n++;
/* the same video uploaded twice under one title */
assert.equal(RM.dupKey("Klang port seize cow meat, halal certificate questionable", "Astro AWANI"), RM.dupKey("Klang port seize cow meat halal certificate questionable ", "Astro  AWANI"));
assert.notEqual(RM.dupKey("Klang port seize cow meat", "Astro AWANI"), RM.dupKey("Klang port seize cow meat", "The Star"));
console.log("PASS duplicate headlines from one source are one entry"); n++;
console.log(`all ${n} passed`);
