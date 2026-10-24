// Netlify build batching (tools/netlify_ignore.mjs): which commits get a production build, and that it fails towards building.
// Run from the repo root: node tests/netlify_ignore.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { decide, gitOps, liveBuild, blockStart, nextBlock, SERVED } from "../tools/netlify_ignore.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const T = (s) => Date.parse(s);
const A = "a".repeat(40), B = "b".repeat(40);
const fake = (o = {}) => ({ servedChanged: () => o.served ?? true, messages: () => o.msgs ?? ["Merge pull request #1"], committedAt: () => o.at ?? T("2026-10-23T23:00:00Z") });
const prod = { CONTEXT: "production", CACHED_COMMIT_REF: A, COMMIT_REF: B };

// 1. blocks
ok(blockStart(T("2026-10-24T07:59:59Z")) === T("2026-10-24T00:00:00Z"), "07:59Z is in the 00Z block");
ok(blockStart(T("2026-10-24T08:00:00Z")) === T("2026-10-24T08:00:00Z"), "08:00Z starts the 08Z block");
ok(nextBlock(T("2026-10-24T17:00:00Z")) === T("2026-10-25T00:00:00Z"), "after 16Z the next batch is 00Z the next day");

// 2. production decisions
const now = T("2026-10-24T09:30:00Z");
ok(!decide(prod, fake({ served: false }), null, now).build, "data/tools-only change: skip");
ok(decide(prod, fake({ at: T("2026-10-24T07:50:00Z") }), null, now).build, "site change, last build in an earlier block: build");
ok(!decide(prod, fake({ at: T("2026-10-24T08:10:00Z") }), null, now).build, "site change, already built in this block: skip");
ok(/16:00Z/.test(decide(prod, fake({ at: T("2026-10-24T08:10:00Z") }), null, now).why), "a skip names the next batch time");
ok(decide(prod, fake({ at: T("2026-10-24T08:10:00Z"), msgs: ["Fix login [deploy now]"] }), null, now).build, "[deploy now] in a message: build at once");
ok(decide({ ...prod, INCOMING_HOOK_TITLE: "batch" }, fake({ served: false }), null, now).build, "build hook: build");
ok(decide({ ...prod, CACHED_COMMIT_REF: "" }, fake({ served: false }), null, now).build, "first build: build");
ok(decide({ ...prod, CACHED_COMMIT_REF: B }, fake({ served: false }), null, now).build, "same commit started by hand: build");
// the live site's build.json wins over Netlify's cache, both for the base commit and the time of the last deploy
let seen = null;
const spy = { ...fake({ at: T("2026-10-24T07:00:00Z") }), servedChanged: (base) => { seen = base; return true; } };
ok(!decide(prod, spy, { commit: "c".repeat(40), at: T("2026-10-24T08:05:00Z") }, now).build && seen === "c".repeat(40), "live build.json: compares with the live commit and its deploy time");
ok(decide(prod, spy, { commit: "c".repeat(40), at: T("2026-10-24T03:00:00Z") }, now).build, "live deploy from an earlier block: build");
ok(decide(prod, fake({ served: false }), { commit: B, at: now }, now).build, "live commit is this commit (redeploy by hand): build");

// 3. previews and branch deploys cost no credits: only the site-change rule
ok(decide({ ...prod, CONTEXT: "deploy-preview" }, fake({ at: T("2026-10-24T09:00:00Z") }), null, now).build, "deploy preview with site change: build even if prod built this block");
ok(!decide({ ...prod, CONTEXT: "deploy-preview" }, fake({ served: false }), null, now).build, "deploy preview, tests-only change: skip");

// 4. real git: what counts as a site change
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nfi-"));
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const commit = (file, msg) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), msg + Math.random()); git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg); return git("rev-parse", "HEAD").trim(); };
git("init", "-q");
const c0 = commit("index.html", "start");
const c1 = commit("data/live/x.js", "Refresh live snapshots");
const c2 = commit("tools/refresh_x.mjs", "tool change");
const c3 = commit(".github/workflows/x.yml", "workflow");
const c4 = commit("desktop/package.json", "Bump desktop deps");
const c5 = commit("assets/osap-x.js", "Feature [deploy now]");
const c6 = commit("netlify/functions/f.mjs", "function");
const cwd = process.cwd();
process.chdir(dir);
ok(!gitOps(c4).servedChanged(c0), "data, tools, workflows and desktop changes are not site changes");
ok(gitOps(c5).servedChanged(c4), "assets/ change is a site change");
ok(gitOps(c6).servedChanged(c5), "netlify/ change is a site change");
ok(gitOps(c5).messages(c0).some((m) => /\[deploy now\]/.test(m)), "messages() reads every commit in the range");
ok(gitOps(c1).servedChanged("f".repeat(40)), "base commit missing from the clone: counts as changed (build)");
ok(Math.abs(gitOps(c1).committedAt(c1) - Date.now()) < 120e3, "committedAt() is the commit time in ms");
process.chdir(cwd);
fs.rmSync(dir, { recursive: true, force: true });

// 5. every file tools/netlify_build.mjs serves is watched
const keep = JSON.parse(fs.readFileSync("tools/netlify_build.mjs", "utf8").match(/const KEEP = (\[[^\]]*\])/)[1]);
ok(keep.every((k) => SERVED.includes(k)), "SERVED covers netlify_build.mjs KEEP: " + keep.filter((k) => !SERVED.includes(k)).join(", "));
const toml = fs.readFileSync("netlify.toml", "utf8");
ok(/^\s*ignore = "node tools\/netlify_ignore\.mjs"/m.test(toml), "netlify.toml runs the ignore script");
for (const f of fs.readdirSync("netlify/edge-functions")) {
  const m = fs.readFileSync(path.join("netlify/edge-functions", f), "utf8").match(/path:\s*(\[[^\]]*\]|"[^"]*")/);
  ok(!m || !/"\/(\*|build\.json)"/.test(m[1]), "edge function " + f + " does not gate /build.json");
}

// 6. reading the live build.json
const res = (status, body) => async () => ({ ok: status === 200, json: async () => body });
ok((await liveBuild("https://x.app/", res(200, { commit: A, built_at: "2026-10-24T08:01:00Z" }))).commit === A, "liveBuild reads commit and time");
ok(await liveBuild("https://x.app", res(404, {})) === null, "no build.json yet: null (falls back to Netlify's cache)");
ok(await liveBuild("https://x.app", res(200, { commit: "nope", built_at: "x" })) === null, "malformed build.json: null");
ok(await liveBuild("https://x.app", async () => { throw new Error("offline"); }) === null, "site unreachable: null");
ok(await liveBuild("", res(200, {})) === null, "no URL: null");

// 7. the CLI fails towards building
const cli = (env) => { try { execFileSync("node", ["tools/netlify_ignore.mjs"], { env: { PATH: process.env.PATH, ...env }, stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
ok(cli({ CONTEXT: "production" }) === 1, "CLI with no refs: exit 1 (build)");
ok(cli({ CONTEXT: "deploy-preview", CACHED_COMMIT_REF: "f".repeat(40), COMMIT_REF: "e".repeat(40) }) === 1, "CLI with unknown commits: exit 1 (build)");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
