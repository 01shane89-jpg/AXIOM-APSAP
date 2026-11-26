// Retry, not repair (tools/retry_once.mjs, tools/ground_retry.mjs, Shane 2026-11-24): a line the source check drops is written once
// more from the sources it cited, and published only if the new one passes every check. Stand-in model, no network.
// Run: node tests/ground_retry.test.mjs
import assert from "node:assert/strict";
import { retryOnce } from "../tools/retry_once.mjs";
import { retryDropped, retryMessage, RETRY_PROMPT } from "../tools/ground_retry.mjs";
import { validateAiFull } from "../tools/daily_lib.mjs";
import { makeJudge } from "../tools/ground_judge.mjs";

let ok = 0; const t = async (name, f) => { await f(); ok++; console.log("ok -", name); };
const ref = (n, title, outlet) => ({ n, title, outlet, date: "2026-11-23T21:19", url: "https://e.org/" + n });
const d = { name: "Oman", refs: [ref(1, "IRGC Navy says three tankers hit mines, catch fire in Strait of Hormuz", "Iran International"), ref(2, "Oman port open", "Times of Oman")], watch: [], window: {} };
const ctx = { place: "Oman", facts: [], window: {} };
const first = { text: "Two supertankers were hit by sea mines in the Strait of Hormuz, the IRGC Navy says.", refs: [1], gaps: [{ kind: "number", what: "Two" }], section: "bluf" };
const chatOf = (replies, seen = []) => async (messages) => { seen.push(messages); const r = replies.shift(); if (r instanceof Error) throw r; return r === null ? null : { content: JSON.stringify(r), model: "stand-in", provider: "github" }; };
const NOW = Date.parse("2026-11-24T15:00:00Z");

await t("retryOnce: one attempt, a record with no text; a draft or check that throws is a failed attempt, never an exception", async () => {
  const a = await retryOnce({ now: NOW, prompt: "p/1", draft: async () => ({ value: "x", model: "m", provider: "q" }), check: async () => "" });
  assert.deepEqual(a.record, { at: "2026-11-24T15:00", prompt: "p/1", ok: true, model: "m", provider: "q" });
  const b = await retryOnce({ now: NOW, draft: async () => { throw new Error("boom"); }, check: async () => "" });
  assert.equal(b.ok, false); assert.equal(b.record.why, "model error");
  const c = await retryOnce({ now: NOW, draft: async () => ({ value: "x", model: "m" }), check: async () => { throw new Error("x"); } });
  assert.equal(c.ok, false); assert.equal(c.record.why, "check error");
  const e = await retryOnce({ now: NOW, draft: async () => ({ value: "secret text", model: "m" }), check: async () => "source check: number" });
  assert.equal(JSON.stringify(e.record).includes("secret text"), false);
});
await t("a dropped line rewritten from its sources that traces in full comes back, with its provenance", async () => {
  const seen = [];
  const r = await retryDropped([first], d, ctx, { chat: chatOf([{ text: "The IRGC Navy says three tankers hit mines and caught fire in the Strait of Hormuz, Iran International reports.", refs: [1] }], seen), now: NOW });
  assert.equal(r.bluf.length, 1); assert.equal(r.bluf[0].g.s, "traced");
  assert.deepEqual(r.bluf[0].g.r, { at: "2026-11-24T15:00", model: "stand-in", provider: "github", prompt: RETRY_PROMPT, of: r.attempts[0].of });
  assert.equal(r.attempts[0].ok, true); assert.deepEqual(r.attempts[0].kinds, ["number"]);
  const user = seen[0][1].content;
  assert.ok(!user.includes(first.text), "the model never sees the dropped line itself");
  assert.ok(/Untraceable words \(do not use\): \["Two"\]/.test(user) && /data only/i.test(user) && !/Times of Oman/.test(user), "only the cited sources, as data");
});
await t("NEGATIVE: a second draft that invents again stays dropped, and the failed attempt is recorded", async () => {
  const r = await retryDropped([first], d, ctx, { chat: chatOf([{ text: "Four tankers hit mines in the Strait of Hormuz, the IRGC Navy says.", refs: [1] }]), now: NOW });
  assert.equal(r.bluf.length, 0); assert.equal(r.attempts[0].ok, false); assert.ok(/source check: number/.test(r.attempts[0].why), r.attempts[0].why);
});
await t("NEGATIVE: a second draft with a name its sources don't give is not allowed (a flag a first draft may carry)", async () => {
  const r = await retryDropped([first], d, ctx, { chat: chatOf([{ text: "Three tankers hit mines near Khasab, the IRGC Navy says.", refs: [1] }]), now: NOW });
  assert.equal(r.bluf.length, 0); assert.ok(/source check: name/.test(r.attempts[0].why), r.attempts[0].why);
});
await t("NEGATIVE: a second draft may cite only the sources the dropped line cited", async () => {
  const r = await retryDropped([first], d, ctx, { chat: chatOf([{ text: "Times of Oman reports the port is open.", refs: [2] }]), now: NOW });
  assert.equal(r.bluf.length, 0); assert.equal(r.attempts[0].ok, false);
});
await t("NEGATIVE: no supported line, no provider, a model error, an overclaim: all stay dropped", async () => {
  for (const reply of [{ text: "", refs: [] }, null, new Error("503"), { text: "Outlets confirm three tankers hit mines, the IRGC Navy says.", refs: [1] }]) {
    const r = await retryDropped([first], d, ctx, { chat: chatOf([reply]), now: NOW });
    assert.equal(r.bluf.length, 0); assert.equal(r.attempts.length, 1); assert.equal(r.attempts[0].ok, false);
  }
});
await t("one attempt per line, within the run's budget shared across countries; at most 6 a day", async () => {
  const budget = { left: 1 };
  const r = await retryDropped([first, { ...first, section: "watch" }], d, ctx, { chat: chatOf([{ text: "x", refs: [1] }, { text: "y", refs: [1] }]), budget, now: NOW });
  assert.equal(r.attempts.length, 1); assert.equal(budget.left, 0);
  const many = Array.from({ length: 9 }, () => first);
  const r2 = await retryDropped(many, d, ctx, { chat: chatOf(Array(9).fill({ text: "", refs: [] })), budget: { left: 99 }, now: NOW });
  assert.equal(r2.attempts.length, 6);
});
await t("the Claude source check, when on, must call the second draft supported", async () => {
  const client = (verdict) => ({ messages: { create: async () => ({ stop_reason: "end_turn", model: "claude-haiku-5-5", content: [{ type: "text", text: JSON.stringify({ results: [{ id: 1, verdict, kinds: [] }] }) }] }) } });
  const good = { text: "The IRGC Navy says three tankers hit mines in the Strait of Hormuz, Iran International reports.", refs: [1] };
  let r = await retryDropped([first], d, ctx, { chat: chatOf([good]), judge: makeJudge({ key: "k", client: client("partly"), log: () => {} }), now: NOW });
  assert.equal(r.bluf.length, 0); assert.ok(/Claude source check: partly/.test(r.attempts[0].why));
  r = await retryDropped([first], d, ctx, { chat: chatOf([good]), judge: makeJudge({ key: "k", client: client("supported"), log: () => {} }), now: NOW });
  assert.equal(r.bluf.length, 1); assert.equal(r.bluf[0].g.j, "supported"); assert.ok(r.bluf[0].g.r);
});
await t("validateAiFull hands back the dropped lines with their section, for the retry; they never reach the page", async () => {
  const v = validateAiFull({ bluf: [{ text: "The IRGC Navy says three tankers hit mines.", refs: [1] }], watch: [{ text: "Watch whether 12 more tankers are hit.", refs: [1] }] }, 2, d.refs, ctx);
  assert.equal(v.bluf.length, 1); assert.equal(v.watch.length, 0);
  assert.equal(v.dropped.length, 1); assert.equal(v.dropped[0].section, "watch"); assert.ok(v.dropped[0].gaps.length);
  assert.equal(retryMessage(v.dropped[0], d.refs, "Oman", "watch").includes("one concrete thing to watch"), true);
});
console.log(ok + " passed");
