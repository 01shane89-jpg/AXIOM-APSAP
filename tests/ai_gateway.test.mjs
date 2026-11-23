// AI gateway provider fallback (tools/ai_gateway.mjs) against a stand-in for the runner's model server. Run: node tests/ai_gateway.test.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { gateway, parseJsonReply, anthropicCost } from "../tools/ai_gateway.mjs";

let plan = [];   // per request: "slow" (no answer in time) or "ok"
const srv = http.createServer((q, s) => { q.resume(); q.on("end", () => {
  const step = plan.shift() || "ok";
  const reply = () => { if (s.destroyed) return; s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] })); };
  step === "slow" ? setTimeout(reply, 400) : reply();
}); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + srv.address().port;
const msg = { messages: [{ role: "user", content: "hi" }] };
let ok = 0; const t = async (name, f) => { await f(); ok++; console.log("ok -", name); };

await t("one timeout skips that request but keeps the local model", async () => {
  plan = ["slow", "ok"];
  const ai = gateway({ token: "", localUrl: url, localModel: "test", timeoutMs: { local: 150 } });
  await assert.rejects(ai.chat(msg), /local no answer \(timed out/);
  assert.equal(ai.available(), true);
  const r = await ai.chat(msg); assert.equal(r.provider, "local"); assert.deepEqual(parseJsonReply(r.content), { ok: true });
});
await t("two timeouts in a row drop it for the run", async () => {
  plan = ["slow", "slow"];
  const ai = gateway({ token: "", localUrl: url, localModel: "test", timeoutMs: { local: 150 } });
  await assert.rejects(ai.chat(msg));
  assert.equal(await ai.chat(msg), null);
  assert.equal(ai.available(), false); assert.match(ai.status().dropped.local, /timed out after/);
});
await t("an answer in between resets the count", async () => {
  plan = ["slow", "ok", "slow", "ok"];
  const ai = gateway({ token: "", localUrl: url, localModel: "test", timeoutMs: { local: 150 } });
  await assert.rejects(ai.chat(msg)); await ai.chat(msg); await assert.rejects(ai.chat(msg));
  assert.equal((await ai.chat(msg)).provider, "local");
});
await t("no provider configured: nothing available", async () => {
  const ai = gateway({ token: "", localUrl: "" }); assert.equal(ai.available(), false); assert.equal(await ai.chat(msg), null);
});
// Claude (Anthropic API) with a stand-in for the SDK client: the spend cap, the fall back to the free providers, refusals
const claudeStub = (replies) => { const calls = []; return { calls, messages: { create: async (b) => { calls.push(b); const r = replies.shift();
  if (r instanceof Error) throw r; return r; } } }; };
const reply = (text, usage = { input_tokens: 3000, output_tokens: 400 }, stop_reason = "end_turn") => ({ model: "claude-haiku-5-5", stop_reason, usage, content: [{ type: "text", text }] });
const sys = { messages: [{ role: "system", content: "rules" }, { role: "user", content: "hi" }], max_tokens: 900 };
await t("Claude answers first, with its cost counted; the system prompt goes in system, no temperature, low effort", async () => {
  const c = claudeStub([reply('{"ok":1}')]);
  const ai = gateway({ token: "", localUrl: url, order: ["anthropic", "local"], anthropicKey: "k", anthropicCapUsd: 1, anthropicClient: c });
  const r = await ai.chat(sys);
  assert.equal(r.provider, "anthropic"); assert.equal(r.model, "claude-haiku-5-5"); assert.deepEqual(parseJsonReply(r.content), { ok: 1 });
  assert.equal(r.usage.cost_usd, 0.0005); assert.equal(c.calls[0].system, "rules"); assert.equal(c.calls[0].messages.length, 1);
  assert.equal(c.calls[0].temperature, undefined); assert.equal(c.calls[0].output_config.effort, "low"); assert.equal(c.calls[0].max_tokens, 4900);
  assert.equal(ai.status().spend.calls, 1);
});
await t("the spend cap is hard: a call is made only if it fits, counted at the last call's cost (a cent before the first)", async () => {
  const c = claudeStub([reply('{"a":1}')]);
  const ai = gateway({ token: "", localUrl: url, order: ["anthropic", "local"], anthropicKey: "k", anthropicCapUsd: 0.005, anthropicClient: c });
  plan = ["ok"]; assert.equal((await ai.chat(sys)).provider, "local");      // a cent would pass $0.005: not even the first call
  assert.equal(c.calls.length, 0); assert.match(ai.status().dropped.anthropic, /spend cap reached/);
  const c2 = claudeStub(Array.from({ length: 30 }, () => reply('{"a":1}')));   // $0.0005 a call
  const ai2 = gateway({ token: "", localUrl: url, order: ["anthropic", "local"], anthropicKey: "k", anthropicCapUsd: 0.0126, anthropicClient: c2 });
  const got = []; for (let i = 0; i < 8; i++) { plan = ["ok"]; got.push((await ai2.chat(sys)).provider); }
  // 1st: 0 + 0.01 fits; then 0.0005 + 0.0005 ... the 8th would still fit, so all 8 are Claude, and the total stays under the cap
  assert.deepEqual(got, Array(8).fill("anthropic")); assert.ok(ai2.status().spend.usd <= 0.0126);
  for (let i = 0; i < 30; i++) { plan = ["ok"]; await ai2.chat(sys); }
  assert.ok(ai2.status().spend.usd <= 0.0126, "spent " + ai2.status().spend.usd); assert.equal(c2.calls.length, 25);
});
await t("no cap or no key: Claude is never set up", async () => {
  assert.deepEqual(gateway({ token: "", order: ["anthropic"], anthropicKey: "k", anthropicCapUsd: 0 }).status().providers, []);
  assert.deepEqual(gateway({ token: "", order: ["anthropic"], anthropicKey: "", anthropicCapUsd: 5 }).status().providers, []);
  assert.deepEqual(gateway({ token: "", order: ["github", "local"], anthropicKey: "k", anthropicCapUsd: 5 }).status().providers, []);
});
await t("a bad key (401) or a rate limit drops Claude for the run; the free provider answers", async () => {
  for (const st of [401, 429, 529]) {
    const c = claudeStub([Object.assign(new Error("x"), { status: st })]);
    const ai = gateway({ token: "", localUrl: url, order: ["anthropic", "local"], anthropicKey: "k", anthropicCapUsd: 1, anthropicClient: c });
    plan = ["ok"]; const r = await ai.chat(sys);
    assert.equal(r.provider, "local"); assert.equal(ai.status().dropped.anthropic, "HTTP " + st);
  }
});
await t("a refusal or a cut-off reply costs that request only (soft), and Claude stays on", async () => {
  const c = claudeStub([reply("", undefined, "refusal"), reply("{", undefined, "max_tokens"), reply('{"b":1}')]);
  const ai = gateway({ token: "", order: ["anthropic"], anthropicKey: "k", anthropicCapUsd: 1, anthropicClient: c });
  await assert.rejects(ai.chat(sys), (e) => e.soft && /refusal/.test(e.message));
  await assert.rejects(ai.chat(sys), (e) => e.soft && /max_tokens/.test(e.message));
  assert.equal((await ai.chat(sys)).provider, "anthropic"); assert.equal(ai.status().spend.calls, 3);
});
await t("Haiku 5.5 cost: $0.10 in and $0.50 out per million tokens", async () => {
  assert.equal(anthropicCost("claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 0.6);
  assert.equal(anthropicCost("claude-haiku-5-5", { prompt_tokens: 2000, completion_tokens: 0 }), 0.0002);
});
srv.close(); srv.closeAllConnections?.();
console.log(`${ok} passed`);
