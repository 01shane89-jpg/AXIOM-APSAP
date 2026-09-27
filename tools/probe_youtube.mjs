// Test only: finds YouTube channels for broadcasters and official agencies by name, and checks each one posts.
// For every query in tools/youtube_candidates.json it reads YouTube's public channel search (no account, key or Data API),
// takes the best channel results, then reads that channel's Videos page for the latest upload time. Prints one line per
// channel and writes probe-out/youtube.json. Writes nothing under data/.
import fs from "node:fs";

const TIMEOUT = 20000;
const cand = JSON.parse(fs.readFileSync(process.argv[2] || "tools/youtube_candidates.json", "utf8"));
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function text(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, "accept-language": "en", cookie: "CONSENT=YES+1" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
function initialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/) || html.match(/ytInitialData"?\]? = (\{[\s\S]*?\});/);
  return m ? JSON.parse(m[1]) : null;
}
function* walk(o, key) {
  if (!o || typeof o !== "object") return;
  if (o[key]) yield o[key];
  for (const v of Object.values(o)) yield* walk(v, key);
}
const txt = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join("") : "");

async function search(q) {
  // sp=EgIQAg%3D%3D limits results to channels
  const d = initialData(await text("https://www.youtube.com/results?sp=EgIQAg%253D%253D&search_query=" + encodeURIComponent(q)));
  const out = [];
  for (const c of walk(d, "channelRenderer")) {
    const badges = JSON.stringify(c.ownerBadges || []);
    out.push({ id: c.channelId, title: txt(c.title),
      handle: (txt(c.subscriberCountText).match(/^@\S+/) || [""])[0] || (c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || "").replace(/^\//, ""),
      subs: txt(c.videoCountText) || txt(c.subscriberCountText), verified: /VERIFIED/.test(badges) });
    if (out.length >= 2) break;
  }
  return out;
}
async function latest(id) {
  const d = initialData(await text("https://www.youtube.com/channel/" + id + "/videos"));
  for (const v of walk(d, "videoRenderer")) return { ago: txt(v.publishedTimeText), video: txt(v.title).slice(0, 80) };
  for (const v of walk(d, "lockupViewModel")) {
    const s = JSON.stringify(v), ago = (s.match(/"content":"([^"]*\bago)"/) || [])[1];
    if (ago) return { ago, video: ((s.match(/"title":\{"content":"([^"]+)"/) || [])[1] || "").slice(0, 80) };
  }
  return { ago: "", video: "" };
}

const results = [];
for (const c of cand) {
  if (only && !only.has(c.cc)) continue;
  let hits = [];
  try { hits = await search(c.q); } catch (e) { console.log(`ERR  ${c.cc}\t${c.q}\tsearch ${e.message}`); }
  if (!hits.length) console.log(`NONE ${c.cc}\t${c.q}`);
  for (const h of hits) {
    try { Object.assign(h, await latest(h.id)); } catch (e) { h.ago = "videos page " + e.message; }
    results.push({ ...c, ...h });
    console.log(`HIT  ${c.cc}\t${c.q}\t${h.id}\t${h.handle}\t${h.title}\t${h.subs}\t${h.verified ? "verified" : "-"}\tlast: ${h.ago}\t${h.video || ""}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 500));
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/youtube.json", JSON.stringify(results, null, 1));
console.log("channels found:", results.length);
