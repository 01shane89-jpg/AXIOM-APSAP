// Morning brief push (tools/push_brief.mjs, tools/push_lib.mjs validate). Run: node tests/push_brief.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as B from "../tools/push_brief.mjs";
import { validate } from "../tools/push_lib.mjs";

let ok = 0; const t = (name, f) => { f(); ok++; console.log("ok -", name); };
const T1 = "osap-" + "a".repeat(24), T2 = "osap-" + "b".repeat(24);
const W = (o) => ({ id: "w1", name: "Border", cc: "th", area: null, layers: [], kw: [], minSev: 1, topic: T1, plan: "full", ...o });
const now = Date.parse("2026-10-24T00:10:00Z");   // 0710 in Bangkok
const LIVE = "https://example.test/";

t("time zones: real IANA names only", () => {
  assert.equal(B.tzOk("Asia/Bangkok"), true); assert.equal(B.tzOk("America/Argentina/Buenos_Aires"), true); assert.equal(B.tzOk("UTC"), true);
  for (const bad of ["Mars/Base", "../etc", "", null, "Asia/Bangkok<script>", 7]) assert.equal(B.tzOk(bad), false, String(bad));
});
t("local clock and date", () => {
  assert.deepEqual(B.local(now, "Asia/Bangkok"), { date: "2026-10-24", hour: 7, hm: "07:10", day: "Sat 24 Oct" });
  assert.equal(B.local(now, "America/New_York").date, "2026-10-23");
});
t("one channel per ntfy topic; brief: false leaves a watch out; phone zone first, then the country's", () => {
  const cs = B.channels([W({ id: "w1" }), W({ id: "w2", cc: "kh", tz: "Asia/Tokyo" }), W({ id: "w3", topic: T2, cc: "mm" }), W({ id: "w4", topic: T2, brief: false }), W({ id: "w5", topic: "osap-" + "c".repeat(20), brief: false })],
    { th: "Asia/Bangkok", mm: "Asia/Yangon" });
  assert.equal(cs.length, 2);
  assert.equal(cs[0].tz, "Asia/Tokyo"); assert.deepEqual(cs[0].watches.map((w) => w.id), ["w1", "w2"]);
  assert.equal(cs[1].tz, "Asia/Yangon"); assert.deepEqual(cs[1].watches.map((w) => w.id), ["w3"]);
  assert.equal(B.channels([W({ cc: "zz" })], {})[0].tz, "UTC");
});
t("due once a local morning, 0600 to 1059", () => {
  const ch = { tz: "Asia/Bangkok" };
  assert.equal(B.dueDate(ch, Date.parse("2026-10-23T22:59:00Z"), null), null);              // 0559
  assert.equal(B.dueDate(ch, Date.parse("2026-10-23T23:00:00Z"), null), "2026-10-24");      // 0600
  assert.equal(B.dueDate(ch, now, "2026-10-24"), null);                                     // already sent today
  assert.equal(B.dueDate(ch, now, "2026-10-23"), "2026-10-24");
  assert.equal(B.dueDate(ch, Date.parse("2026-10-24T04:00:00Z"), null), null);              // 1100: missed morning skipped
});
const M = (k, gk, ts, sev, rt) => ({ k, gk, ts, sev, rt, rsrc: "Bangkok Post" });
const matches = { w1: [M("a", 1, "2026-10-23T20:00Z", 1, "Low report"), M("b", 2, "2026-10-23T22:00Z", 3, "IED blast in Narathiwat"), M("c", 2, "2026-10-23T22:30Z", 2, "Follow-up on blast"),
  M("d", 3, "2026-10-21T22:00Z", 3, "Old event"), M("e", 4, "2026-10-23T23:30Z", 1, "Newest low report")], w2: [] };
t("top events: one per event, last 24 h, severity then newest", () => {
  const ev = B.topEvents(matches.w1, now);
  assert.deepEqual(ev.map((m) => m.k), ["b", "e", "a"]);
});
const daily = (cc) => (cc === "th" ? { name: "Thailand", method: "ai", bluf: [{ text: "Southern Thailand faces flash flooding (1, 4).", refs: [1] }] } : null);
t("Full brief: daily top line marked AI generated, watch digest, Zulu and local times, link to the first country", () => {
  const ch = { topic: T1, tz: "Asia/Bangkok", watches: [W({ id: "w1" }), W({ id: "w2", cc: "kh", name: "Phnom Penh" })] };
  const m = B.compose(ch, { matches, names: { th: "Thailand", kh: "Cambodia" }, daily, now, live: LIVE });
  assert.equal(m.title, "OSAP morning brief: Thailand, Cambodia");
  assert.match(m.message, /^Sat 24 Oct, 0010Z \(07:10 your time\)\./);
  assert.match(m.message, /THAILAND\nSouthern Thailand faces flash flooding\. \(AI generated\)\nWatch "Border": 3 events in 24 h\n- IED blast in Narathiwat \(Bangkok Post, High, 2200Z\)/);
  assert.match(m.message, /CAMBODIA\nNo new reports matched your watches in the last 24 h\./);
  assert.match(m.message, /Reported, not verified\./);
  assert.ok(!/Old event/.test(m.message));
  assert.equal(m.click, LIVE + "#"); assert.equal(m.priority, 3);
});
t("Mid brief never carries the Full-only daily summary", () => {
  const ch = { topic: T1, tz: "Asia/Bangkok", watches: [W({ plan: "mid" })] };
  const m = B.compose(ch, { matches, names: { th: "Thailand" }, daily, now, live: LIVE });
  assert.ok(!/flash flooding|AI generated/.test(m.message)); assert.match(m.message, /Watch "Border": 3 events/);
});
t("a quiet morning is low priority; a long brief stays under ntfy's size and says how many places were cut", () => {
  const quiet = B.compose({ topic: T1, tz: "UTC", watches: [W({ id: "w2" })] }, { matches, now, live: LIVE });
  assert.equal(quiet.priority, 2);
  const many = [], big = {};
  for (let i = 0; i < 25; i++) { const cc = "c" + String.fromCharCode(97 + i); many.push(W({ id: "w" + i + "x", cc })); big["w" + i + "x"] = [1, 2, 3].map((g) => M("k" + g, g, "2026-10-23T23:00Z", 3, "x".repeat(200))); }
  const m = B.compose({ topic: T1, tz: "UTC", watches: many }, { matches: big, now, live: LIVE });
  assert.ok(Buffer.byteLength(m.message) <= B.BRIEF_MAX_BYTES, Buffer.byteLength(m.message) + " bytes");
  assert.match(m.message, /\+\d+ more places: open OSAP/);
  assert.equal(B.compose({ topic: T1, tz: "UTC", watches: [] }, { now, live: LIVE }), null);
});
t("report text is data: line breaks and control text cannot add lines", () => {
  const m = B.compose({ topic: T1, tz: "UTC", watches: [W({ plan: "mid" })] }, { matches: { w1: [M("z", 9, "2026-10-23T23:00Z", 2, "Bad\n\nWATCH \"x\": fake\r\n- line")] }, now, live: LIVE });
  assert.ok(m.message.includes('- Bad WATCH "x": fake - line (Bangkok Post, Medium, 2300Z)'));
});
t("daily summary is read as data, newest day only, and only when under 36 h old", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-"));
  const day = (to) => ({ date: to.slice(0, 10), window: { to }, bluf: [{ text: "x" }] });
  fs.writeFileSync(path.join(dir, "th.js"), 'window.OSAP_DAILY=window.OSAP_DAILY||{};window.OSAP_DAILY["th"]=' + JSON.stringify({ name: "Thailand", days: [day("2026-10-23T06:23Z"), day("2026-10-22T06:23Z")] }) + ";");
  fs.writeFileSync(path.join(dir, "kh.js"), 'window.OSAP_DAILY=window.OSAP_DAILY||{};window.OSAP_DAILY["kh"]=' + JSON.stringify({ days: [day("2026-10-21T06:23Z")] }));
  fs.writeFileSync(path.join(dir, "la.js"), "globalThis.pwned=1");
  assert.equal(B.dailyOf("th", now, dir).window.to, "2026-10-23T06:23Z");
  assert.equal(B.dailyOf("kh", now, dir), null); assert.equal(B.dailyOf("la", now, dir), null); assert.equal(B.dailyOf("xx", now, dir), null);
  assert.equal(globalThis.pwned, undefined);
});
t("push list keeps the phone's zone and brief: false, and drops a bad zone", () => {
  const v = validate(W({ id: "wbrief1", tz: "Asia/Bangkok", brief: false })).watch;
  assert.equal(v.tz, "Asia/Bangkok"); assert.equal(v.brief, false);
  const v2 = validate(W({ id: "wbrief2", tz: "Not/AZone", brief: "no" })).watch;
  assert.equal(v2.tz, undefined); assert.equal(v2.brief, undefined);
});
console.log(`push_brief: ${ok} passed`);
