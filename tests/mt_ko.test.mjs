// Korean, Chinese and Japanese amounts on the wrong scale, and Korean names romanized as another person's (tools/mt_ko.mjs, used by
// tools/mt_guard.mjs mtSuspect). The rejected lines are real MADLAD-400 output from the news index, 2026-11-21 to 23.
// Run: node tests/mt_ko.test.mjs
import assert from "node:assert/strict";
import { cjkAmounts, cjkAmountWrong, koNameWrong } from "../tools/mt_ko.mjs";
import { mtSuspect } from "../tools/mt_guard.mjs";

const now = Date.parse("2026-11-23T09:00:00Z");
let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };

t("amounts written in 만 and 억 (萬, 億) are read at their scale", () => {
  assert.deepEqual(cjkAmounts("3억1000만원, 1千万, 55만원, 1억 원, 1.5억, 2조4098억"), [310000000, 10000000, 550000, 100000000, 150000000, 2409800000000]);
});

t("an English amount on another scale is rejected", () => {
  const o = "대통령 \"AI 부정행위 신고하면 건당 1억 원 포상\"";
  assert.equal(cjkAmountWrong(o, "President: 1 million won per case of cheating reported"), "1 million");
  assert.match(mtSuspect(o, "President: 1 million won per case of cheating reported", now, "ko"), /amount 1 million not in the original/);
  assert.equal(cjkAmountWrong(o, "President: 100 million won reward per AI cheating case"), "");
  assert.equal(cjkAmountWrong("3억 투입해 ‘55만원’ 지급한 제주 기후보험", "30 million invested in Jeju Climate Insurance"), "30 million");
  assert.equal(cjkAmountWrong("벌금 700만원", "Fined 700 million won"), "700 million");
  assert.equal(cjkAmountWrong("벌금 700만원", "Fined 7 million won"), "");
  assert.equal(cjkAmountWrong("거제시, 2027년도 당초예산안 1조 4152억 편성", "Geoje City, 2027 budget of 1 trillion 415.2 billion"), "", "a split amount is one amount");
  assert.equal(cjkAmountWrong("방한 중국인 547만명", "5.47 million Chinese visitors"), "");
  assert.equal(cjkAmountWrong("失智症基本法 條文3.5萬字", "35,000 characters of text"), "");
  assert.equal(cjkAmountWrong("1월 15일 2,000명", "2,000 people on 15 January"), "", "no 만/억 in the original: left to the number check");
});

t("a Korean name must be the original's", () => {
  const en = "Minister of Education Ju Ji-jin: \"exams will go ahead\"";
  assert.equal(koNameWrong("최교진 \"수능 연기하면 더 혼란\"", en), "Ju Ji-jin");
  assert.match(mtSuspect("최교진 \"수능 연기하면 더 혼란\"", en, now, "ko"), /name Ju Ji-jin not in the original/);
  assert.equal(koNameWrong("최교진 교육장관", "Minister of Education Su Chu-jin"), "Su Chu-jin", "a hyphenated name is judged even with an unlisted surname");
  assert.equal(koNameWrong("이 대통령 오늘 출국", "President Kim Jong Un to leave today"), "Kim Jong Un");
  assert.equal(koNameWrong("최교진 교육장관", "Education Minister Choi Kyo-jin"), "");
  assert.equal(koNameWrong("이재명 대통령", "President Lee Jae-myung"), "");
  assert.equal(koNameWrong("윤석열 전 대통령", "Former President Yoon Suk Yeol"), "");
  assert.equal(koNameWrong("김정은 위원장", "Kim Jong Un inspects"), "");
  assert.equal(koNameWrong("트럼프 대통령", "President Donald Trump"), "", "a foreign name is not judged");
  assert.equal(koNameWrong("대구 동구, 등산로", "Daegu Dong-gu, 8 trails"), "");
  assert.equal(koNameWrong("경찰, 출국 금지", "Police Ban From Exit"), "", "English words are not a name");
  assert.equal(koNameWrong("도쿄돔 10개 크기", "Tokyo Dome-size island"), "");
});

console.log(ok + " passed");
