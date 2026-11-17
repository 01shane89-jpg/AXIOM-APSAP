// Terms a machine translation must keep (tools/mt_glossary.mjs, used by tools/mt_guard.mjs mtSuspect and tools/translate.mjs
// prepareForModel). The rejected lines are real MADLAD-400 output from the news pool, 2026-11-17 (Russian aircraft entering the
// Korean and Japanese air defense identification zones). Run: node tests/mt_glossary.test.mjs
import assert from "node:assert/strict";
import { protectTerms, termMissing } from "../tools/mt_glossary.mjs";
import { mtSuspect } from "../tools/mt_guard.mjs";
import { prepareForModel } from "../tools/translate.mjs";

const now = Date.parse("2026-11-17T09:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

t("KADIZ read as the Spanish city is rejected", () => {
  assert.match(mtSuspect("새벽 러 군용기 카디즈 진입…공군 출격 대응", "Russian military aircraft enter Cádiz at dawn...", now, "ko"), /air defense identification zone/);
  assert.match(mtSuspect("러 군용기, 17일 카디즈 진입 후 이탈…軍 \"전투기 투입해 대비\"", "Russian military aircraft leaves Italy after entering Cadiz on 17th...", now, "ko"), /air defense/);
  assert.equal(mtSuspect("새벽 러 군용기 카디즈 진입…공군 출격 대응", "Russian military aircraft enter KADIZ at dawn, Air Force scrambles in response", now, "ko"), "");
  assert.equal(termMissing("러 군용기 카디즈 진입", "Russian aircraft enter the Korea Air Defense Identification Zone"), "");
  assert.equal(termMissing("러 군용기 카디즈 진입", "Russian military aircraft entered the Korean air defence and identification zone (KADIZ)"), "");
  assert.match(termMissing("러 군용기, 17일 카디즈 진입 후 이탈", "Russian military aircraft leaves Italy after entering Kadiz on 17th..."), /air defense/);
});

t("an air defense zone called airspace is rejected", () => {
  assert.match(mtSuspect("កូរ៉េខាងត្បូង បញ្ជូនយន្តហោះចម្បាំងស្ទាក់ចាប់ ក្រោយយន្តហោះរុស្ស៊ីហោះចូលតំបន់ ការពារដែនអាកាសរបស់ខ្លួន",
    "South Korea sends fighter jets to deter Russian aircraft flying into its airspace", now, "km"), /air defense/);
  // the Japanese report says airspace in the original: nothing to keep, nothing rejected
  assert.equal(termMissing("ភាពតានតឹងដែនអាកាស ជប៉ុនប្រើប្រាស់យន្តហោះចម្បាំង ឆ្លើយតបនិងយន្តហោះរុស្ស៊ី បានហោះរំលោភចូល ដែនអាកាសរបស់ខ្លួន",
    "Airspace tension Japan uses fighter jets in response to Russian aircraft flying into its airspace"), "");
  assert.equal(termMissing("不只共機擾台？2俄羅斯軍機逼進台灣 闖我防空識別區國軍緊盯", "Two Russian military aircraft enter Taiwan, breaking into our air defense zone."), "");
  assert.match(termMissing("中国军机进入日本防空识别区", "Chinese military aircraft enter Japanese airspace"), /air defense/);
});

t("a scramble turned into an attack is rejected, a real attack is not", () => {
  assert.match(mtSuspect("러 군용기 여러 대 KADIZ 진입…공군 전투기 출격 대응", "Russian military aircraft entered KADIZ... Air Force fighters respond to attack", now, "ko"), /출격/);
  assert.equal(termMissing("러 군용기 여러 대 KADIZ 진입…공군 전투기 출격 대응", "Russian military aircraft entered KADIZ; Air Force fighters scramble in response"), "");
  assert.equal(termMissing("북 미사일 공격에 전투기 출격", "Fighters scramble after North Korean missile attack"), "");
  assert.equal(termMissing("심정지로 숨져", "died of a heart attack"), "", "no 출격: the check does not apply");
});

t("the model is given the terms spelled out (Korean with the acronym, other scripts in English); the rest is left alone", () => {
  assert.equal(protectTerms("새벽 러 군용기 카디즈 진입…공군 출격 대응"), "새벽 러 군용기 한국 방공식별구역(KADIZ) 진입…공군 출격 대응");
  assert.equal(protectTerms("러 군용기, 동해 카디즈진입"), "러 군용기, 동해 한국 방공식별구역(KADIZ) 진입");
  assert.equal(protectTerms("러 군용기 여러 대 KADIZ 진입"), "러 군용기 여러 대 한국 방공식별구역(KADIZ) 진입");
  assert.equal(protectTerms("중국 군용기 한국 방공식별구역(KADIZ) 진입"), "중국 군용기 한국 방공식별구역(KADIZ) 진입", "already written out: unchanged");
  assert.equal(protectTerms("Chinese aircraft enter the KADIZ"), "Chinese aircraft enter the KADIZ", "English text is not touched");
  assert.equal(protectTerms("闖我防空識別區國軍緊盯"), "闖我 air defense identification zone 國軍緊盯");
  assert.equal(protectTerms("중국 방공식별구역 선포"), "중국 air defense identification zone 선포");
  assert.equal(protectTerms("ខ្លួនហោះចូលតំបន់ការពារដែនអាកាស"), "ខ្លួនហោះចូល air defense zone");
  assert.equal(protectTerms("Ohne Begriff"), "Ohne Begriff");
  assert.equal(prepareForModel("새벽 러 군용기 카디즈 진입", "ko"), "새벽 러 군용기 한국 방공식별구역(KADIZ) 진입");
});

console.log(ok + " passed");
