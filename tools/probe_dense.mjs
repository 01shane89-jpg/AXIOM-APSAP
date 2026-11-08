// PROBE BRANCH ONLY: reuse terms for every think tank: homepage -> terms/copyright/licence/reuse pages -> licence sentences.
import fs from "node:fs";
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36" };
const rows = fs.readFileSync("tools/tt_terms_list.txt", "utf8").trim().split("\n").map((l) => l.split("|"));
const get = async (u) => { const r = await fetch(u, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); };
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const KEY = /creative commons|CC[ -]BY[^ ]*|public domain|commercial|reproduc|republish|all rights reserved|may be (?:freely )?(?:used|reprinted|quoted)|without (?:prior |written )?permission|licen[cs]ed under/i;
async function one([id, name, home]) {
  const o = { id, name, home, pages: [], hits: [] };
  let h; try { h = await get(home); } catch (e) { o.err = e.message; return o; }
  const links = [...h.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)].map((m) => [m[1], text(m[2])]).filter(([u, t]) => /terms|copyright|licen[cs]|reuse|re-use|republish|permission|legal|conditions|disclaimer|imprint|privacy/i.test(u + " " + t) && !/mailto:/i.test(u));
  const urls = [...new Set(links.map(([u]) => { try { return new URL(u, home).href; } catch (e) { return null; } }).filter(Boolean))].sort((a, b) => (/privacy/i.test(a) ? 1 : 0) - (/privacy/i.test(b) ? 1 : 0)).slice(0, 4);
  const foot = text(h).match(/.{0,160}(?:©|copyright|creative commons|CC BY)[^.]{0,200}/gi) || [];
  o.hits.push(...foot.slice(0, 3).map((s) => "HOME: " + s.trim()));
  for (const u of urls) {
    try { const t = text(await get(u)); o.pages.push(u); const s = t.split(/(?<=[.!?])\s+/).filter((x) => KEY.test(x) && x.length < 500); o.hits.push(...s.slice(0, 8).map((x) => u.replace(/^https?:\/\/[^/]+/, "") + ": " + x)); } catch (e) { o.pages.push(u + " (" + e.message + ")"); }
  }
  return o;
}
const out = [];
for (let i = 0; i < rows.length; i += 8) out.push(...await Promise.all(rows.slice(i, i + 8).map(one)));
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/dense.json", JSON.stringify(out));
for (const o of out) console.log("TTJSON" + JSON.stringify(o));
