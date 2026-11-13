// Runs one shard of the map-smoke tests (tests/map-smoke.txt) so CI can run them on several machines at once.
// Tests are spread over the shards by their last measured run time (tests/map-smoke-times.json), longest first onto the
// least-loaded shard, so each shard takes about the same time. Tests that share a group= stay on one shard.
// Every test in the shard runs even when one fails (each in its own process, capped at TEST_MIN minutes); the run then
// fails and names every failed test, so one CI run shows all failures, not only the first.
//   node tools/smoke_shard.mjs --shard 2/6          run shard 2 of 6
//   node tools/smoke_shard.mjs --shard 2/6 --list   print what shard 2 would run, run nothing
//   node tools/smoke_shard.mjs --shard 2/6 --needs poppler   exit 0 when shard 2 needs poppler, 1 when not
//   node tools/smoke_shard.mjs --check              every listed file exists, no test listed twice, every shard plan sane
// Run from the repo root.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const LIST = "tests/map-smoke.txt", TIMES = "tests/map-smoke-times.json", DEFAULT_S = 30;
const TEST_MIN = +(process.env.TEST_MIN || 20);

export function parseList(text) {
  const tests = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [file, ...tags] = line.split(/\s+/);
    const t = { file, group: null, needs: [] };
    for (const tag of tags) {
      const [k, v] = tag.split("=");
      if (k === "group" && v) t.group = v;
      else if (k === "needs" && v) t.needs.push(...v.split(","));
      else throw new Error(`${LIST}: unknown tag "${tag}" on ${file}`);
    }
    tests.push(t);
  }
  return tests;
}

/* longest-processing-time-first: units (a test, or every test of one group) sorted longest first, each onto the shard
   with the least time so far; ties go to the lower shard number so the plan is the same on every machine */
export function plan(tests, times, n) {
  const units = new Map();
  tests.forEach((t, i) => {
    const key = t.group ? "g:" + t.group : "t:" + t.file;
    if (!units.has(key)) units.set(key, { key, first: i, secs: 0, tests: [] });
    const u = units.get(key);
    u.tests.push(t);
    u.secs += times[t.file] ?? DEFAULT_S;
  });
  const shards = Array.from({ length: n }, () => ({ secs: 0, tests: [] }));
  [...units.values()].sort((a, b) => b.secs - a.secs || a.first - b.first).forEach((u) => {
    let best = 0;
    for (let i = 1; i < n; i++) if (shards[i].secs < shards[best].secs) best = i;
    shards[best].secs += u.secs;
    shards[best].tests.push(...u.tests);
  });
  /* keep the file's own order inside a shard */
  const order = new Map(tests.map((t, i) => [t.file, i]));
  for (const s of shards) s.tests.sort((a, b) => order.get(a.file) - order.get(b.file));
  return shards;
}

function runOne(file) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [file], { stdio: "inherit", env: process.env });
    const timer = setTimeout(() => { console.log(`::error::${file} still running after ${TEST_MIN} min, stopped`); child.kill("SIGKILL"); }, TEST_MIN * 60000);
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ file, ok: code === 0, code: code ?? signal, secs: Math.round((Date.now() - start) / 1000) }); });
    child.on("error", (e) => { clearTimeout(timer); console.log(e.message); resolve({ file, ok: false, code: "spawn", secs: 0 }); });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const tests = parseList(readFileSync(LIST, "utf8"));
  const times = existsSync(TIMES) ? JSON.parse(readFileSync(TIMES, "utf8")) : {};
  if (args.includes("--check")) {
    const bad = [], seen = new Set();
    for (const t of tests) {
      if (!existsSync(t.file)) bad.push(`${t.file} does not exist`);
      if (seen.has(t.file)) bad.push(`${t.file} listed twice`);
      seen.add(t.file);
    }
    for (const n of [1, 4, 6, 8]) {
      const got = plan(tests, times, n).flatMap((s) => s.tests.map((t) => t.file)).sort();
      if (got.join() !== tests.map((t) => t.file).sort().join()) bad.push(`plan for ${n} shards does not run every test exactly once`);
    }
    bad.forEach((b) => console.log("FAIL " + b));
    console.log(bad.length ? bad.length + " problems" : `${tests.length} tests listed, all present`);
    process.exit(bad.length ? 1 : 0);
  }
  const m = /^(\d+)\/(\d+)$/.exec(args[args.indexOf("--shard") + 1] || "");
  if (!m || +m[1] < 1 || +m[1] > +m[2]) { console.log("usage: node tools/smoke_shard.mjs --shard I/N [--list | --needs WHAT]"); process.exit(2); }
  const shard = plan(tests, times, +m[2])[+m[1] - 1];
  const ni = args.indexOf("--needs");
  if (ni >= 0) process.exit(shard.tests.some((t) => t.needs.includes(args[ni + 1])) ? 0 : 1);
  console.log(`shard ${m[1]}/${m[2]}: ${shard.tests.length} tests, about ${Math.round(shard.secs / 60)} min by last measured times`);
  if (args.includes("--list")) { shard.tests.forEach((t) => console.log("  " + t.file)); return; }
  const results = [];
  for (const t of shard.tests) {
    console.log(`::group::${t.file}`);
    const r = await runOne(t.file);
    console.log(`::endgroup::`);
    console.log(`${r.ok ? "PASS" : "FAIL"} ${t.file} (${r.secs} s${r.ok ? "" : ", exit " + r.code})`);
    if (!r.ok) console.log(`::error title=map-smoke::${t.file} failed (exit ${r.code})`);
    results.push(r);
  }
  const failed = results.filter((r) => !r.ok);
  const lines = [`### map-smoke shard ${m[1]}/${m[2]}`, "", `${results.length - failed.length} of ${results.length} passed`, "",
    "| test | result | seconds |", "|---|---|---|", ...results.map((r) => `| ${r.file} | ${r.ok ? "pass" : "**FAIL**"} | ${r.secs} |`)];
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  console.log(failed.length ? `${failed.length} failed: ${failed.map((r) => r.file).join(", ")}` : "all passed");
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
