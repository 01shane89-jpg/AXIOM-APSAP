// AI gateway provider fallback (tools/ai_gateway.mjs) against a stand-in for the runner's model server. Run: node tests/ai_gateway.test.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { gateway, parseJsonReply } from "../tools/ai_gateway.mjs";

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
srv.close(); srv.closeAllConnections?.();
console.log(`${ok} passed`);
