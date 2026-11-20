// Chinese headlines: a combined count of aircraft and ships, and an aircraft carrier the original does not name
// (tools/mt_guard.mjs mtSuspect). Taiwan's papers count PLA activity with one combined counter: 中共17機艦船 is 17 aircraft,
// warships and other ships together (CNA, 20 Nov: 8 aircraft, 7 warships, 2 official ships), 15共機艦 is 15 aircraft and
// warships. MADLAD-400 keeps one noun: "17 ships" (CNA), "15 aircraft" (FTNN), "15 Chinese ships are in the air" (Liberty
// Times), and most often "14 aircraft carriers", which puts carriers in the strait that no report has.
//   zhCombinedCountLost(orig, en): "" when the English names both the aircraft and the ships of a 機艦 count, else what it lost.
//   zhCarrierAdded(orig, en): "aircraft carrier" when the English has one and the original has no carrier word (Chinese,
//     Japanese 空母 or Korean 항공모함/항모, since a Korean headline with 美 or 中 also has Han characters).
const HAN = /\p{Script=Han}/u;
const COMBINED = /\d+\s*(?:架次|架)?\s*(?:中?共|共軍|共军|解放軍|解放军)?\s*(?:軍)?(?:機艦|机舰)(?:船)?/;
const AIR_EN = /\b(?:aircraft|air ?craft|planes?|airplanes?|jets?|fighters?|warplanes?|bombers?|drones?|sorties)\b/i;
const SEA_EN = /\b(?:ships?|vessels?|warships?|boats?|naval|navy|frigates?|destroyers?|ships and planes)\b/i;
const CARRIER_EN = /\baircraft[- ]carriers?\b|\bcarrier (?:group|strike|battle)/i;
const CARRIER_ZH = /항공모함|항모|空母|航艦|航母|航舰|航空母艦|航空母舰|遼寧|辽宁|山東艦|山东舰|山東號|福建艦|福建舰|福建號|母艦|母舰/;

export function zhCarrierAdded(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!HAN.test(orig) || !CARRIER_EN.test(en) || CARRIER_ZH.test(orig) || CARRIER_EN.test(orig)) return "";
  return "aircraft carrier";
}

export function zhCombinedCountLost(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!HAN.test(orig) || !COMBINED.test(orig)) return "";
  // an aircraft carrier is not aircraft: "14 aircraft carriers" names neither
  const e = en.replace(CARRIER_EN, " ");
  const air = AIR_EN.test(e), sea = SEA_EN.test(e);
  if (air && sea) return "";
  return air ? "the ships" : sea ? "the aircraft" : "the aircraft and ships";
}
