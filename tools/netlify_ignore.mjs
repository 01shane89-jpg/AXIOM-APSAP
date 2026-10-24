// Netlify "ignore" step (netlify.toml): decides whether a commit gets a new build. Exit 0 = skip, exit 1 = build.
// Every production deploy costs 15 Netlify credits (3,000 a month on Pro), and main gets 50+ merges and 400+ data commits a
// day, so production builds come in batches:
//   1. Only a change to what the site serves counts (the files tools/netlify_build.mjs copies, netlify/, netlify.toml).
//      Data, source lists, tools, tests, workflows and the desktop app change nothing on the Netlify site.
//   2. At most one production build per 8-hour block (00:00, 08:00, 16:00 UTC). A merge goes live straight away when
//      nothing has deployed yet in the block, otherwise with the first commit after the next block starts (data refreshes
//      land every few minutes, so that is within minutes of 00/08/16Z).
//   3. Always build: the first build, a build of the same commit started by hand, a build hook, or "[deploy now]" in a
//      commit message (put it in a PR title for an urgent fix).
// Production compares with what is live: tools/netlify_build.mjs writes /build.json (commit + time) into every deploy, and
// this reads it back from the live site. Without it (first time, site down) it falls back to Netlify's CACHED_COMMIT_REF.
// Deploy previews and branch deploys cost no credits: they follow rule 1 only. Any git error builds (fails safe).
// Run with --explain to print the decision without exiting non-zero.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const SERVED = ["index.html", "reset.html", "sw.js", "manifest.webmanifest", "assets", "LICENSE", "NOTICE.md", "terms.html",
  "privacy.html", "refunds.html", "netlify", "netlify.toml", "tools/netlify_build.mjs", "tools/netlify_ignore.mjs"];
export const BLOCK_HOURS = 8;
export const FORCE = /\[deploy now\]/i;

// start of the UTC block that holds `now` (ms)
export function blockStart(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(d.getUTCHours() / BLOCK_HOURS) * BLOCK_HOURS);
}
export function nextBlock(now) { return blockStart(now) + BLOCK_HOURS * 3600e3; }

// env: Netlify build env; live: { commit, at } from the live /build.json or null; git: { servedChanged(base), messages(base),
// committedAt(ref) } between base and COMMIT_REF
export function decide(env, git, live = null, now = Date.now()) {
  const prod = env.CONTEXT === "production", head = env.COMMIT_REF;
  const base = (prod && live && live.commit) || env.CACHED_COMMIT_REF;
  if (env.INCOMING_HOOK_TITLE || env.INCOMING_HOOK_URL) return { build: true, why: "build hook" };
  if (!base || !head) return { build: true, why: "first build (nothing to compare with)" };
  if (base === head) return { build: true, why: "same commit as the last build: started by hand" };
  if (!git.servedChanged(base)) return { build: false, why: "nothing the site serves changed since " + base.slice(0, 7) + " (data, tools, tests or workflows only)" };
  if (!prod) return { build: true, why: "site files changed (" + (env.CONTEXT || "no context") + ": no credits)" };
  if (git.messages(base).some((m) => FORCE.test(m))) return { build: true, why: "[deploy now] in a commit message" };
  const start = blockStart(now), built = live && live.at ? live.at : git.committedAt(base);
  if (built >= start) return { build: false, why: "already deployed in this block; next batch at " + new Date(nextBlock(now)).toISOString().slice(11, 16) + "Z" };
  return { build: true, why: "first deploy of the block starting " + new Date(start).toISOString().slice(11, 16) + "Z" };
}

export function gitOps(head, run = (a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 })) {
  return {
    servedChanged: (base) => {
      try { run(["diff", "--quiet", base, head, "--", ...SERVED]); return false; }
      catch (e) { return true; } // exit 1 = changed; anything else (commit not in the clone) also builds
    },
    messages: (base) => run(["log", "--format=%B%x00", base + ".." + head]).split("\0"),
    committedAt: (ref) => Number(run(["show", "-s", "--format=%ct", ref]).trim()) * 1000,
  };
}

// what the live production site says it was built from (tools/netlify_build.mjs), or null
export async function liveBuild(siteUrl, fetchImpl = fetch) {
  if (!siteUrl) return null;
  try {
    const r = await fetchImpl(siteUrl.replace(/\/$/, "") + "/build.json", { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json(), at = Date.parse(j.built_at);
    return /^[0-9a-f]{40}$/.test(j.commit || "") && at ? { commit: j.commit, at } : null;
  } catch (e) { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  let r;
  try {
    const live = process.env.CONTEXT === "production" ? await liveBuild(process.env.URL) : null;
    if (live) console.log("netlify_ignore: live site is " + live.commit.slice(0, 7) + ", built " + new Date(live.at).toISOString());
    r = decide(process.env, gitOps(process.env.COMMIT_REF), live);
  }
  catch (e) { r = { build: true, why: "could not decide (" + e.message + "): building" }; }
  console.log("netlify_ignore: " + (r.build ? "BUILD" : "SKIP") + " - " + r.why);
  process.exit(process.argv.includes("--explain") ? 0 : r.build ? 1 : 0);
}
