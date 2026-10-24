// Test only: for each Bluesky handle in tools/bsky_candidates.json, prints whether it resolves, its display name,
// followers and how many own posts it made in the last 7 days (public read API, no login). Writes nothing.
import { readFileSync } from "node:fs";
const list = JSON.parse(readFileSync("tools/bsky_candidates.json", "utf8"));
const API = "https://public.api.bsky.app/xrpc/", WEEK = Date.now() - 7 * 864e5;
const get = async (m, q) => { const r = await fetch(API + m + "?" + new URLSearchParams(q), { headers: { "user-agent": "AXIOM-ASAP/1.0 probe" } }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
for (const [cc, h] of list) {
  try {
    const p = await get("app.bsky.actor.getProfile", { actor: h });
    const f = await get("app.bsky.feed.getAuthorFeed", { actor: h, filter: "posts_no_replies", limit: "50" });
    const own = (f.feed || []).filter((x) => !x.reason && Date.parse(x.post.record.createdAt) >= WEEK).length;
    console.log("BS\t" + cc + "\t" + h + "\t" + (p.displayName || "").slice(0, 60) + "\t" + p.followersCount + "\t" + own);
  } catch (e) { console.log("BS\t" + cc + "\t" + h + "\tERR " + e.message); }
  await new Promise((r) => setTimeout(r, 150));
}
