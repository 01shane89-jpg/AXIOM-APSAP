// AI gateway for the refresh jobs. Scripts ask for a chat reply; the gateway tries the providers this run has, in order, and
// says which provider and model answered, so every AI draft records where it came from.
//   github: GitHub Models with the workflow's own GITHUB_TOKEN (permission models: read; no personal key)
//   local:  an open-weight model served on the runner itself (llama-cpp-python's OpenAI-compatible server, started by
//           .github/workflows/refresh-ai.yml). OSAP_LOCAL_LLM is its base URL, OSAP_LOCAL_MODEL the model's name and file.
//           Nothing leaves the runner, so no case material goes to an outside service.
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

export function gateway({ token = process.env.GITHUB_TOKEN || "", githubModel = "openai/gpt-4.1-mini",
  localUrl = process.env.OSAP_LOCAL_LLM || "", localModel = process.env.OSAP_LOCAL_MODEL || "local",
  order = (process.env.OSAP_AI_ORDER || "github,local").split(","), timeoutMs = {} } = {}) {
  const providers = [];
  for (const p of order) {
    if (p === "github" && token) providers.push({ id: "github", url: "https://models.github.ai/inference/chat/completions", model: githubModel,
      headers: { authorization: "Bearer " + token }, timeout: timeoutMs.github || 60000 });
    if (p === "local" && localUrl) providers.push({ id: "local", url: localUrl.replace(/\/+$/, "") + "/v1/chat/completions", model: localModel,
      headers: {}, timeout: timeoutMs.local || 600000, misses: 2 });
  }
  const dropped = {}, missed = {};
  async function chat({ messages, max_tokens = 600, temperature = 0.2, json = true }) {
    for (const p of providers) {
      if (dropped[p.id]) continue;
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
  const status = () => ({ providers: providers.map((p) => p.id), dropped: { ...dropped } });
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
