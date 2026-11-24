// "Ask about this country" (tools/ask_lib.mjs has the rules; assets/osap-ask.js is the box on Today).
//   GET                    { on, model, label, perUser }: whether answers are switched on (ANTHROPIC_API_KEY set in Netlify)
//   POST {cc, q}           signed in, with the plan tools/tiers.mjs FEATURES.ask names: an answer from that country's daily
//                          summary sources only, every sentence cited, labelled a draft. Not saved anywhere.
// Off until the owner adds ANTHROPIC_API_KEY to the Netlify environment (Shane 2026-11-18): until then POST answers 503 and the
// rest of OSAP is unchanged. OSAP_ASK_DAILY_CAP sets the site's questions a day (default tools/ask_lib.mjs ASK_DAILY_CAP).
// Shane added the key on 23 Nov 2026 (Production context only, so deploy previews stay off). Netlify reads a new environment
// variable only at the next deploy, which is why the change that added this line went out with "[deploy now]".
// Logs carry the country, counts and timings only: never the question, the sources or the answer, never the key.
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { planOf, earlyAccess } from "../../tools/owner.mjs";
import { tierOfRoles, allows, FEATURES } from "../../tools/tiers.mjs";
import { loadTierKey, openForTier, isSealed } from "../../tools/tier_open.mjs";
import { ASK_MODEL, PROMPT_V, LABEL, ASK_PER_USER, ASK_DAILY_CAP, SYSTEM, SCHEMA, cleanQuestion, validCc, sourcesOf, userMessage, checkAnswer, takeQuota } from "../../tools/ask_lib.mjs";

const env = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]);
const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
const ORIGIN = () => (env("OSAP_DATA_ORIGIN") || "https://01shane89-jpg.github.io/AXIOM-APSAP").replace(/\/+$/, "");

// stand-ins for tests: the Blobs store, the model client, the data fetch and the sign-in check
let deps = {
  store: () => getStore({ name: "osap-ask", consistency: "strong" }),
  client: (key) => new Anthropic({ apiKey: key, maxRetries: 1, timeout: 25000 }),
  fetchData: (url) => fetch(url, { signal: AbortSignal.timeout(10000) }),
  who: async (req) => {
    const auth = req.headers.get("authorization");
    if (!auth || !/^Bearer\s+\S+$/.test(auth)) return null;
    const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
    return r && r.ok ? await r.json().catch(() => null) : null;
  },
};
/** tests only */
export function useDeps(d) { deps = { ...deps, ...d }; }

let keyP = null;
const tierKey = () => (keyP = keyP || loadTierKey(env("OSAP_TIER_KEY"), env("OSAP_TIER_PUB")).catch(() => null));
// a daily file: "window.OSAP_DAILY=window.OSAP_DAILY||{};window.OSAP_DAILY["cc"]={...};" (sealed when paid data is locked)
async function dailyOf(cc) {
  const r = await deps.fetchData(ORIGIN() + "/data/live/daily/" + cc + ".js");
  if (!r.ok) return null;
  let t = await r.text();
  if (isSealed(t)) t = (await openForTier(t, await tierKey()).catch(() => null)) || "";
  const i = t.indexOf('"]=');
  try { return i < 0 ? null : JSON.parse(t.slice(i + 3).trim().replace(/;\s*$/, "")); } catch (e) { return null; }
}

export default async (req) => {
  const key = env("ANTHROPIC_API_KEY");
  if (req.method === "GET") return json({ on: !!key, model: ASK_MODEL, label: LABEL, perUser: ASK_PER_USER });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const me = await deps.who(req);
  if (!me) return json({ error: "Sign in first." }, 401);
  const plan = planOf(me, env("OSAP_OWNERS"), tierOfRoles, earlyAccess(env));
  if (!allows(plan, FEATURES.ask)) return json({ error: "Ask needs the " + FEATURES.ask + " plan.", need: FEATURES.ask }, 402);
  if (!key) return json({ error: "Ask isn't switched on yet.", off: true }, 503);
  const raw = await req.text();
  if (raw.length > 2048) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(raw) || {}; } catch (e) { return json({ error: "bad json" }, 400); }
  const q = cleanQuestion(b.q), cc = String(b.cc || "").toLowerCase();
  if (!q) return json({ error: "Ask a question of 3 to 300 characters." }, 400);
  if (!validCc(cc)) return json({ error: "bad country" }, 400);

  const src = sourcesOf(await dailyOf(cc).catch(() => null));
  if (!src.refs.length) return json({ answered: false, sentences: [], sources: [], note: "OSAP has no sources for this country in today's summary, so there is nothing to answer from." });
  const store = deps.store();
  const quota = await takeQuota(store, me.id || me.sub || me.email, Date.now(), Math.max(1, +(env("OSAP_ASK_DAILY_CAP") || ASK_DAILY_CAP)));
  if (!quota.ok) return json({ error: quota.why }, 429);

  const t0 = Date.now();
  let res;
  try {
    res = await deps.client(key).messages.create({
      model: ASK_MODEL, max_tokens: 2000, system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: userMessage(q, src) }],
    });
  } catch (e) {
    const status = e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.AuthenticationError ? 503 : e instanceof Anthropic.APIError ? 502 : 504;
    console.log("osap ask", cc, "model error", e instanceof Anthropic.APIError ? e.status : "network", Date.now() - t0 + " ms");
    return json({ error: status === 429 ? "The AI service is busy. Try again in a minute." : "The AI service didn't answer. Try again later." }, status);
  }
  if (res.stop_reason === "refusal") return json({ answered: false, sentences: [], sources: [], note: "The model declined to answer this question." });
  const text = (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  let o = null; try { o = JSON.parse(text); } catch (e) {}
  const a = checkAnswer(o, src.refs.length, src);
  const used = [...new Set(a.sentences.flatMap((s) => s.refs))].sort((x, y) => x - y);
  console.log("osap ask", cc, "sources", src.refs.length, "sentences", a.sentences.length, "dropped", a.dropped, "flagged", (a.ground && a.ground.flagged) || 0, Date.now() - t0 + " ms",
    res.usage ? "tokens " + res.usage.input_tokens + "/" + res.usage.output_tokens : "");
  return json({
    answered: a.answered, sentences: a.sentences, ground: a.ground || null,
    sources: src.refs.filter((r) => used.includes(r.n)).map((r) => ({ n: r.n, headline: r.headline, outlet: r.outlet, time: r.time, kind: r.kind, url: r.url })),
    day: src.date, label: LABEL, model: res.model || ASK_MODEL, prompt: PROMPT_V, left: quota.left,
    note: a.answered ? "" : "The sources in today's summary don't answer this question.",
  });
};

export const config = { path: "/api/osap-ask" };
