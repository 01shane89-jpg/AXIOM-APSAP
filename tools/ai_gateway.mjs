// AI gateway for the refresh jobs. Scripts ask for a chat reply; the gateway tries the providers this run has, in order, and
// says which provider and model answered, so every AI draft records where it came from.
//   github: GitHub Models with the workflow's own GITHUB_TOKEN (permission models: read; no personal key)
//   local:  an open-weight model served on the runner itself (llama-cpp-python's OpenAI-compatible server, started by
//           .github/workflows/refresh-ai.yml). OSAP_LOCAL_LLM is its base URL, OSAP_LOCAL_MODEL the model's name and file.
//           Nothing leaves the runner, so no case material goes to an outside service.
//   anthropic: Claude through Anthropic's API with the owner's key (ANTHROPIC_API_KEY, a repository secret; Shane 2026-11-23
//           chose Claude Haiku 5.5 for the daily country summaries). Only scripts whose step puts "anthropic" in OSAP_AI_ORDER,
//           gives the key and sets a spend cap use it. Each call's cost is counted; once anthropicCapUsd is spent the provider is
//           dropped for the run and the next provider (the free ones) carries on. Called through the official SDK
//           (@anthropic-ai/sdk, installed by the workflow step), loaded only when the provider is first used.
// A provider that answers without a model reply is dropped for the rest of the run: from Actions runners GitHub Models has
// answered every request with 200 text/plain "OK" since September 2026 (tools/refresh_evsum.mjs only=probe-models).
// Replies are text; the caller parses and validates them (the sources in a prompt are data, never instructions).

import http from "node:http";

// Node's fetch gives up when a reply's headers take more than 300 s (undici headersTimeout: "fetch failed"), and the runner's
// model sends nothing until the whole reply is written, so the local provider is called through node:http, bounded only by its
// own timeout (the signal).
function postLocal(url, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const q = http.request(new URL(url), { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, signal }, (s) => {
      let t = ""; s.setEncoding("utf8");
      s.on("data", (d) => (t += d)); s.on("error", reject);
      s.on("end", () => resolve({ status: s.statusCode, ok: s.statusCode >= 200 && s.statusCode < 300, headers: { get: (k) => s.headers[k.toLowerCase()] || null }, text: async () => t }));
    });
    q.on("error", reject); q.end(body);
  });
}

// Claude Haiku 5.5 list prices, US dollars per million tokens (prompts up to 100K tokens; a daily summary prompt is about 3K)
export const ANTHROPIC_PRICE = { "claude-haiku-5-5": { in: 0.10, out: 0.50 } };
export const anthropicCost = (model, usage) => {
  const p = ANTHROPIC_PRICE[model] || ANTHROPIC_PRICE["claude-haiku-5-5"], u = usage || {};
  return ((u.input_tokens || u.prompt_tokens || 0) * p.in + (u.output_tokens || u.completion_tokens || 0) * p.out) / 1e6;
};

export function gateway({ token = process.env.GITHUB_TOKEN || "", githubModel = "openai/gpt-4.1-mini",
  localUrl = process.env.OSAP_LOCAL_LLM || "", localModel = process.env.OSAP_LOCAL_MODEL || "local",
  order = (process.env.OSAP_AI_ORDER || "github,local").split(","), timeoutMs = {},
  anthropicKey = process.env.ANTHROPIC_API_KEY || "", anthropicModel = process.env.OSAP_ANTHROPIC_MODEL || "claude-haiku-5-5",
  anthropicCapUsd = 0, anthropicSpentUsd = 0, anthropicClient = null } = {}) {
  const providers = [];
  for (const p of order) {
    // no cap means no spending: a script must say how much it may spend before Claude is ever called
    if (p === "anthropic" && anthropicKey && anthropicCapUsd > 0) providers.push({ id: "anthropic", model: anthropicModel, timeout: timeoutMs.anthropic || 120000 });
    if (p === "github" && token) providers.push({ id: "github", url: "https://models.github.ai/inference/chat/completions", model: githubModel,
      headers: { authorization: "Bearer " + token }, timeout: timeoutMs.github || 60000 });
    if (p === "local" && localUrl) providers.push({ id: "local", url: localUrl.replace(/\/+$/, "") + "/v1/chat/completions", model: localModel,
      headers: {}, timeout: timeoutMs.local || 600000, misses: 2 });
  }
  const dropped = {}, missed = {}, spend = { usd: anthropicSpentUsd, calls: 0, in: 0, out: 0 };
  let client = anthropicClient;
  async function claude(p, messages, max_tokens) {
    if (!client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic({ apiKey: anthropicKey, timeout: p.timeout, maxRetries: 2 });
    }
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    // Haiku 5.5 thinks by default and the thinking counts toward max_tokens, so the caller's reply size gets room on top;
    // low effort, as the reply is a short cited summary. No temperature: Haiku 5.5 accepts only the default.
    const res = await client.messages.create({ model: p.model, max_tokens: max_tokens + 4000, system,
      messages: messages.filter((m) => m.role !== "system"), output_config: { effort: "low" } });
    const cost = anthropicCost(p.model, res.usage);
    spend.usd += cost; spend.last = cost; spend.calls++; spend.in += (res.usage && res.usage.input_tokens) || 0; spend.out += (res.usage && res.usage.output_tokens) || 0;
    if (res.stop_reason === "refusal") throw Object.assign(new Error("anthropic declined (refusal)"), { soft: true });
    if (res.stop_reason === "max_tokens") throw Object.assign(new Error("anthropic reply cut off at max_tokens"), { soft: true });
    const content = (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    return { content, provider: "anthropic", model: res.model || p.model,
      usage: { prompt_tokens: (res.usage && res.usage.input_tokens) || 0, completion_tokens: (res.usage && res.usage.output_tokens) || 0, cost_usd: +cost.toFixed(6) } };
  }
  async function chat({ messages, max_tokens = 600, temperature = 0.2, json = true }) {
    for (const p of providers) {
      if (dropped[p.id]) continue;
      if (p.id === "anthropic") {
        // a hard cap: the next call is counted at what the last one cost (or a cent, before the first), so it never goes over
        if (spend.usd + (spend.last || 0.01) > anthropicCapUsd) { dropped[p.id] = `spend cap reached ($${spend.usd.toFixed(4)} of $${anthropicCapUsd.toFixed(4)} for this run)`; continue; }
        const t0 = Date.now();
        try { return { ...(await claude(p, messages, max_tokens)), ms: Date.now() - t0 }; }
        catch (e) {
          if (e.soft) throw e;
          // the SDK's errors carry the HTTP status: a bad key, no access, a rate limit or a server fault drops Claude for the
          // run and the free providers carry on; so does a missing SDK or a network failure (after the SDK's own retries)
          const st = e && e.status;
          if (!st || [401, 403, 404, 429].includes(st) || st >= 500) { dropped[p.id] = st ? "HTTP " + st : "no answer (" + String(e && e.message).slice(0, 80) + ")"; continue; }
          throw new Error("anthropic HTTP " + st + ": " + String(e.message).slice(0, 160));
        }
      }
      const body = { model: p.model, temperature, max_tokens, messages };
      if (json) body.response_format = { type: "json_object" };
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), p.timeout), t0 = Date.now();
      let r, raw;
      try {
        const hdr = { ...p.headers, "content-type": "application/json", accept: "application/json" };
        r = p.id === "local" ? await postLocal(p.url, hdr, JSON.stringify(body), ctl.signal)
          : await fetch(p.url, { method: "POST", signal: ctl.signal, headers: hdr, body: JSON.stringify(body) });
        raw = await r.text();
      } catch (e) {
        // the runner's own model is slow on a long prompt: one miss skips this request, two in a row drop it for the run
        const why = "no answer (" + (e.name === "AbortError" ? "timed out after " + Math.round(p.timeout / 1000) + " s" : e.message) + ")";
        missed[p.id] = (missed[p.id] || 0) + 1;
        if (missed[p.id] >= (p.misses || 1)) { dropped[p.id] = why; continue; }
        throw new Error(p.id + " " + why);
      }
      finally { clearTimeout(to); }
      missed[p.id] = 0;
      if (r.status === 429) { dropped[p.id] = "rate limit (HTTP 429)"; continue; }
      if (!r.ok) { if ([401, 403, 404].includes(r.status) || r.status >= 500) dropped[p.id] = "HTTP " + r.status; throw new Error(p.id + " HTTP " + r.status + ": " + raw.slice(0, 160)); }
      if (!/^\s*\{/.test(raw)) { dropped[p.id] = "answered without a model reply (" + (r.headers.get("content-type") || "no type") + ": " + raw.slice(0, 40).trim() + ")"; continue; }
      const j = JSON.parse(raw), content = String(j.choices?.[0]?.message?.content || "");
      return { content, provider: p.id, model: p.id === "local" ? p.model : j.model || p.model, usage: j.usage, ms: Date.now() - t0 };
    }
    return null;
  }
  const status = () => ({ providers: providers.map((p) => p.id), dropped: { ...dropped }, spend: { ...spend, usd: +spend.usd.toFixed(6) } });
  const available = () => providers.some((p) => !dropped[p.id]);
  return { chat, status, available };
}

// a JSON object out of a model reply: whole reply, a fenced block, or the outermost braces (small models add words around it)
export function parseJsonReply(s) {
  const t = String(s || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}
