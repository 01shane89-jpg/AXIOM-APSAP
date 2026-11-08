// PROBE BRANCH ONLY: think-tank reuse terms, round 2: retry failed homepages with a plain UA, then fetch named terms pages.
import fs from "node:fs";
const L = JSON.parse(fs.readFileSync("tools/tt_terms_list2.json", "utf8"));
const UAS = [{ "user-agent": "curl/8.5.0", accept: "*/*" }, { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "text/html,*/*", "accept-language": "en" }];
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ");
const KEY = /creative commons|CC[ -]BY[^ ]*|public domain|commercial|reproduc|republish|all rights reserved|may be (?:freely )?(?:used|reprinted|quoted|shared)|without (?:prior |the |express )?(?:written )?(?:consent|permission)|licen[cs]ed under|copyright/i;
async function get(u) { let last; for (const h of UAS) { try { const r = await fetch(u, { headers: h, redirect: "follow", signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.text(); last = "HTTP " + r.status; } catch (e) { last = e.message; } } throw new Error(last); }
const out = [];
for (const [id, u] of [...L.errs, ...L.extra.map((u) => ["page", u])]) {
  try { const t = text(await get(u)); out.push({ id, u, hits: t.split(/(?<=[.!?©])\s+/).filter((x) => KEY.test(x) && x.length < 600).slice(0, 10) }); } catch (e) { out.push({ id, u, err: e.message }); }
}
for (const o of out) console.log("TTJSON" + JSON.stringify(o));
