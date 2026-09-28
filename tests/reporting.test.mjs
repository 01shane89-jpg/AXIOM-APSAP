// Unit test for the Deep South and conflict reporting guards (no network): old stories re-dated by a search, and translations
// that lose a Deep South place name. Usage: node tests/reporting.test.mjs
import assert from "node:assert/strict";
import { staleSearchResult, statedDates } from "../tools/conflict_lib.mjs";
import { placeSubst, placeMismatch } from "../tools/deepsouth_lib.mjs";

// a July 2025 photo caption under a result dated September 2026 (the Daily Star F-16 story)
assert.equal(staleSearchResult("Cambodian soldiers reload the BM-21 multiple rocket launcher in Preah Vihear province on July 24, 2025. Thailand launched air strikes", "2026-09-21T17:00"), true);
assert.equal(staleSearchResult("On 24 July 2025 the army said", "2026-09-21"), true);
// Thai Buddhist Era dates: 27 Sep 2569 is 27 Sep 2026
assert.deepEqual(statedDates("เมื่อวันที่ 27 ก.ย. 2569"), [Date.UTC(2026, 8, 27)]);
assert.equal(staleSearchResult("เมื่อวันที่ 27 ก.ย. 2569 ผู้สื่อข่าวรายงาน", "2026-09-28"), false);
// no stated date, or a recent one: kept
assert.equal(staleSearchResult("Ranger shot dead in Ra-ngae", "2026-09-28"), false);
assert.equal(staleSearchResult("Talks resumed on September 20, 2026 after the incident on July 24, 2025", "2026-09-21"), false);
// stories that look back on purpose are kept
assert.equal(staleSearchResult("Court sentences four over the bombing of April 25, 2016", "2026-09-22"), false);
assert.equal(staleSearchResult("ศาลพิพากษาคดีระเบิด เมื่อ 25 เม.ย. 2559", "2026-09-22"), false);

// place names go to the model in English
assert.equal(placeSubst("ทหารพรานถูกยิง อ.ระแงะ จ.นราธิวาส"), "ทหารพรานถูกยิง อ. Ra-ngae จ. Narathiwat");
assert.equal(placeSubst("ระเบิดที่สุไหงโก-ลก"), "ระเบิดที่ Su-ngai Kolok");
// a translation that turned Ra-ngae, Narathiwat into "Ranah, Narayanganj" is caught; a faithful one is not
assert.equal(placeMismatch("อส.ทพ. ถูกยิงดับกลางหน้าที่ ที่ระแงะ นราธิวาส", "Volunteer scout shot dead while on duty in Ranah, Narayanganj."), true);
assert.equal(placeMismatch("อส.ทพ. ถูกยิงดับกลางหน้าที่ ที่ระแงะ นราธิวาส", "Ranger shot dead on duty in Rangae, Narathiwat"), false);
assert.equal(placeMismatch("ระเบิดที่เมืองปัตตานี", "Bomb in Pattani town"), false);
assert.equal(placeMismatch("ไม่มีชื่อสถานที่", "No place named"), false);
console.log("reporting.test.mjs: all passed");
