// Test only: Bluesky accounts for tools/bsky_candidates.json. [cc, handle] checks one handle; [cc, "?query"] searches
// accounts by name (top 3). Prints handle, display name, followers, Bluesky verification and own posts in the last 7 days.
import { readFileSync } from "node:fs";
const list = JSON.parse(readFileSync("tools/bsky_candidates.json", "utf8"));
const API = "https://public.api.bsky.app/xrpc/", WEEK = Date.now() - 7 * 864e5;
const get = async (m, q) => { const r = await fetch(API + m + "?" + new URLSearchParams(q), { headers: { "user-agent": "AXIOM-ASAP/1.0 probe" } }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
const pause = () => new Promise((r) => setTimeout(r, 150));
async function one(cc, h, q) {
  try {
    const p = await get("app.bsky.actor.getProfile", { actor: h });
    const f = await get("app.bsky.feed.getAuthorFeed", { actor: h, filter: "posts_no_replies", limit: "50" });
    const own = (f.feed || []).filter((x) => !x.reason && Date.parse(x.post.record.createdAt) >= WEEK).length;
    const v = (p.verification || {}).verifiedStatus || "-";
    console.log("BS\t" + cc + "\t" + (q || "") + "\t" + p.handle + "\t" + (p.displayName || "").slice(0, 60) + "\t" + p.followersCount + "\t" + v + "\t" + own + "\t" + (p.description || "").replace(/\s+/g, " ").slice(0, 90));
  } catch (e) { console.log("BS\t" + cc + "\t" + (q || "") + "\t" + h + "\tERR " + e.message); }
  await pause();
}
for (const [cc, h] of list) {
  if (!h.startsWith("?")) { await one(cc, h); continue; }
  try {
    const s = await get("app.bsky.actor.searchActors", { q: h.slice(1), limit: "3" });
    if (!(s.actors || []).length) console.log("BS\t" + cc + "\t" + h + "\tNONE");
    for (const a of s.actors || []) await one(cc, a.handle, h);
  } catch (e) { console.log("BS\t" + cc + "\t" + h + "\tSEARCH ERR " + e.message); }
  await pause();
}
