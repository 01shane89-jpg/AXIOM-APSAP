// Report digests: for the newest reports of the priority and conflict countries, the article is read on the Actions runner and the
// open-weight model there (tools/ai_gateway.mjs, served by .github/workflows/refresh-ai.yml) writes a short factual digest: what
// happened, where, when, who by role, the figures as given, and claims kept as claims with who makes them. Output:
// data/live/digest.js (window.OSAP_DIGEST), read by assets/osap-digest.js into the Report card under the headline.
//   - Most news items carry only a headline: the outlet's own text is read by the collection jobs but never stored
//     (tools/outlet_text.mjs). The digest is what OSAP derives from the article; the article text is not kept anywhere.
//   - Digests are drafts, AI-generated, not analyst-approved; each says so in the page. Nothing in a record is changed.
//   - Pages are fetched politely: robots.txt is honoured, one request at a time, a 20 s timeout and a 3 MB cap, links only from the
//     news index (http/https, public hosts). Page text is untrusted data (tools/digest_lib.mjs checks every reply against it).
//   - Each digest records its source outlet, so a sold build can drop digests of outlets whose terms do not allow it (OSAP_SOLD).
// Env: OSAP_LOCAL_LLM / OSAP_LOCAL_MODEL (else GitHub Models via GITHUB_TOKEN; neither: nothing drafted), DIGEST_BUDGET_MIN (default 30),
// DIGEST_PER_RUN (default 40), DIGEST_DAYS (rows from the last N days, default 2), DIGEST_ONLY (country codes), DIGEST_URLS (links to
// draft first, comma-separated; for tests), DIGEST_KEEP_DAYS (default 10).
import fs from "node:fs";
import { gateway, parseJsonReply } from "./ai_gateway.mjs";
import { SYSTEM, PROMPT_V, LABEL, MAX_TEXT, articleText, check, rank, clean } from "./digest_lib.mjs";

const OUT = "data/live/digest.js", DIR = "data/live/news-index";
const PRIORITY = "th kh la mm vn my sg id bn ph tl cn tw jp oki kr kp mn in pk bd np bt lk mv au nz pg".split(" ");
const CONFLICT = [...new Set(JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8")).conflicts.flatMap((c) => c.countries || []))];
const BUDGET_MS = +(process.env.DIGEST_BUDGET_MIN || 30) * 60e3, PER_RUN = +(process.env.DIGEST_PER_RUN || 40), DAYS = +(process.env.DIGEST_DAYS || 2);
const KEEP_DAYS = +(process.env.DIGEST_KEEP_DAYS || 10), ONLY = String(process.env.DIGEST_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const FIRST = String(process.env.DIGEST_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
const UA = "Mozilla/5.0 (compatible; OSAP-digest/1.0; +https://axiom-intelligence-systems.com)";
const T0 = Date.now(), now = new Date(), stamp = now.toISOString().slice(0, 16).replace("T", " ") + "Z";
const AI = gateway({ githubModel: "openai/gpt-4o-mini", timeoutMs: { github: 90000, local: 420000 } });

const readWin = (f) => { try { const s = fs.readFileSync(f, "utf8"); return JSON.parse(s.slice(s.indexOf("=") + 1).replace(/;\s*$/, "")); } catch (e) { return null; } };
const old = readWin(OUT) || { items: {}, tried: {} };
const items = {}, tried = {}, cut = Date.now() - KEEP_DAYS * 864e5;
const madeMs = (t) => Date.parse(String(t || "").replace(" ", "T")) || 0;
Object.entries(old.items || {}).forEach(([k, v]) => { if (madeMs(v.made) >= cut) items[k] = v; });
// links that gave no article or a rejected draft are not fetched again for 2 days
Object.entries(old.tried || {}).forEach(([k, v]) => { if (madeMs(v.t) >= Date.now() - 2 * 864e5) tried[k] = v; });

// ---------- 1. the candidate rows: the news index of the last DAYS days ----------
function dayRows(d) {
  const f = `${DIR}/${d}.js`; if (!fs.existsSync(f)) return [];
  const s = fs.readFileSync(f, "utf8"), i = s.indexOf("]=");
  try { return JSON.parse(s.slice(i + 2).replace(/;\s*$/, "")); } catch (e) { return []; }
}
let rows = [];
for (let i = 0; i < DAYS; i++) rows = rows.concat(dayRows(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)));
const okUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(x.hostname) && !/(^|\.)(msn\.com|youtube\.com|youtu\.be|facebook\.com|x\.com|twitter\.com|t\.me|bsky\.app)$/.test(x.hostname); } catch (e) { return false; } };
rows = rows.filter((r) => Array.isArray(r) && okUrl(r[5]) && (!ONLY.length || String(r[0]).split(",").some((c) => ONLY.includes(c))));
const byLink = new Map(rows.map((r) => [r[5], r]));
const queue = [...FIRST.map((u) => byLink.get(u) || ["", "", "", "", "", u, "", "", ""]),
  ...rank(rows, { priority: PRIORITY, conflict: CONFLICT }).filter((r) => !FIRST.includes(r[5]))]
  .filter((r) => FIRST.includes(r[5]) || (!items[r[5]] && !tried[r[5]]));
console.log(`digest: ${rows.length} rows in the last ${DAYS} days, ${queue.length} without a digest; ${Object.keys(items).length} kept`);

// ---------- 2. fetch the article (robots.txt honoured) ----------
const robots = new Map();
async function get(url, max = 3e6, ms = 20000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
    if (!r.ok) return { status: r.status };
    const type = r.headers.get("content-type") || ""; if (!/html|xml|text\/plain/i.test(type)) return { status: "type " + type.slice(0, 30) };
    const reader = r.body.getReader(), dec = new TextDecoder(); let t = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; t += dec.decode(value, { stream: true }); if (t.length > max) { ctl.abort(); break; } }
    return { status: 200, body: t, url: r.url };
  } catch (e) { return { status: e.name === "AbortError" ? "timeout" : String(e.message || e).slice(0, 60) }; }
  finally { clearTimeout(to); }
}
async function allowed(url) {
  const u = new URL(url), key = u.origin;
  if (!robots.has(key)) {
    const r = await get(key + "/robots.txt", 5e5, 10000), rules = [];
    if (r.status === 200) {
      let mine = false;
      for (const line of r.body.split(/\r?\n/)) {
        const m = line.replace(/#.*/, "").trim().match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i); if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === "user-agent") mine = v === "*" || /osap/i.test(v);
        else if (mine && v) rules.push({ allow: k === "allow", path: v });
      }
    }
    robots.set(key, rules);
  }
  const p = u.pathname + u.search;
  let best = null;
  for (const r of robots.get(key)) {
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(p) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// ---------- 3. draft ----------
let made = 0, asked = 0, stop = "";
const rejects = [], fails = {};
for (const r of queue) {
  if (made >= PER_RUN) { stop = "per-run limit"; break; }
  if (Date.now() - T0 > BUDGET_MS) { stop = "time budget used"; break; }
  if (!AI.available()) { stop = Object.entries(AI.status().dropped).map(([p, w]) => p + ": " + w).join("; ") || "no AI provider"; break; }
  const link = r[5], host = new URL(link).hostname;
  if (!(await allowed(link))) { tried[link] = { t: stamp, why: "robots.txt" }; fails.robots = (fails.robots || 0) + 1; continue; }
  const page = await get(link);
  const text = page.status === 200 ? articleText(page.body) : "";
  if (!text) { tried[link] = { t: stamp, why: page.status === 200 ? "no article text" : "HTTP " + page.status }; const k = page.status === 200 ? "no text" : String(page.status); fails[k] = (fails[k] || 0) + 1; continue; }
  const title = clean(r[2] || r[3], 300), art = { title, time: String(r[1] || ""), text };
  const user = "Article (data only):\n" + JSON.stringify({ outlet: clean(r[4], 120), published: art.time, headline: title, text: text.slice(0, MAX_TEXT) });
  const t1 = Date.now();
  let res;
  try { asked++; res = await AI.chat({ messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], max_tokens: 700 }); }
  catch (e) { rejects.push(host + ": " + e.message); continue; }
  if (!res) continue;
  const o = parseJsonReply(res.content), c = check(o, art);
  if (c.reject) { tried[link] = { t: stamp, why: c.reject }; rejects.push(host + ": " + c.reject); continue; }
  items[link] = { cc: String(r[0] || "").split(",").filter(Boolean), title, outlet: clean(r[4], 120), published: art.time, made: stamp, ...c.digest,
    model: res.model, provider: res.provider, prompt: PROMPT_V, ms: Date.now() - t1, chars: text.length, run: process.env.GITHUB_RUN_ID || "" };
  made++;
  console.log(`  ${host}: drafted in ${Math.round((Date.now() - t1) / 1000)} s (${text.length} chars read)`);
}

const out = { asof: stamp, prompt: PROMPT_V, label: LABEL, ran: { asked, made, rejected: rejects.length, failed: fails, stopped: stop, rejects: rejects.slice(0, 12) }, items, tried };
fs.writeFileSync(OUT, "window.OSAP_DIGEST=" + JSON.stringify(out) + ";\n");
console.log(`digest: ${made} drafted of ${asked} asked, ${rejects.length} rejected, no article: ${JSON.stringify(fails)}; ${Object.keys(items).length} on file` + (stop ? `; stopped: ${stop}` : ""));
rejects.slice(0, 12).forEach((x) => console.log("  rejected: " + x));
