// Probe for the Russia-Ukraine conflict sources (run by .github/workflows/probe-conflict-ua.yml, from GitHub's runners).
// Reads each candidate once, checks robots.txt for every agent, and prints status, item count, newest date and sample titles.
// Writes probe-out/ukraine.json. Never writes data/.
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP conflict probe)";
async function get(url, accept) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: accept || "*/*" } });
    const body = await r.text();
    return { status: r.status, ok: r.ok, body, type: r.headers.get("content-type") || "" };
  } finally { clearTimeout(t); }
}
const robots = {};
async function allowed(url) {
  const u = new URL(url);
  if (!(u.origin in robots)) robots[u.origin] = get(u.origin + "/robots.txt").then((r) => (r.ok ? r.body : "")).catch(() => "");
  const txt = await robots[u.origin]; let on = false, best = { len: -1, allow: true }; const path = u.pathname + u.search;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, "").trim().match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { on = v === "*"; continue; }
    if (!on || (k !== "allow" && k !== "disallow") || !v) continue;
    const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && v.length > best.len) best = { len: v.length, allow: k === "allow" };
  }
  return best.allow;
}
const C = JSON.parse(fs.readFileSync("tools/probe_ukraine.json", "utf8"));
const out = [];
for (const c of C) {
  const row = { id: c.id, url: c.url, kind: c.kind };
  try {
    row.robots = await allowed(c.url);
    const r = await get(c.url);
    row.status = r.status; row.type = r.type; row.bytes = r.body.length;
    if (c.kind === "rss") { const it = parseFeed(r.body); row.items = it.length; row.newest = it.map((i) => i.date).filter(Boolean).map((d) => new Date(d).toISOString()).sort().pop(); row.sample = it.slice(0, 4).map((i) => i.title); }
    else if (c.kind === "tg") { const n = (r.body.match(/tgme_widget_message_text/g) || []).length; const d = [...r.body.matchAll(/datetime="([^"]+)"/g)].map((m) => m[1]).sort().pop(); row.items = n; row.newest = d; row.sample = [...r.body.matchAll(/tgme_widget_message_text[^>]*>([\s\S]{0,160})/g)].slice(-3).map((m) => m[1].replace(/<[^>]+>/g, " ").trim()); }
    else row.sample = [r.body.slice(0, 400)];
  } catch (e) { row.error = e.name === "AbortError" ? "timed out" : e.message; }
  out.push(row);
  console.log((row.status === 200 ? "ok  " : "FAIL"), row.id, row.status || row.error, "robots:" + row.robots, row.items != null ? row.items + " items newest " + row.newest : row.bytes + " bytes");
  (row.sample || []).forEach((s) => console.log("      ", String(s).replace(/\s+/g, " ").slice(0, 200)));
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/ukraine.json", JSON.stringify(out, null, 1));
