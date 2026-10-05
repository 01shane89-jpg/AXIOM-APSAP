// Seal the hidden areas' data (tools/hidden-areas.json; the lock is assets/osap-lock.js, the format tools/seal_lib.mjs).
//   node tools/seal_hidden.mjs           seal every plain hidden file in place and strip the hidden countries from shared files
//   node tools/seal_hidden.mjs --check   change nothing; fail if a hidden file is plain or a shared file still has hidden parts
//   --skip-live (with --check)            leave out data/live/ and data/history/: the 15-minute refresh rewrites and seals those on
//                                         main, and its commit step runs the full --check (Check index.html uses this, so an open
//                                         PR never carries live data that would conflict with main every 15 minutes)
// Every workflow that commits data runs this just before `git add`, so a plain copy never reaches the repository; Check
// index.html runs --check. It only ever locks: it holds no private key and cannot open what it sealed. A job that finds a
// sealed file where it expected its earlier output reads it as missing and starts afresh, which is why the US news and
// social feeds hold only the newest run's items.
// A file rebuilt with the same content keeps its earlier sealed copy (the envelope's "h"), so jobs commit only real changes.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { seal, isSealed, envelope, contentHash, fingerprint } from "./seal_lib.mjs";

const CHECK = process.argv.includes("--check"), SKIP_LIVE = CHECK && process.argv.includes("--skip-live");
const LIVE = /^data\/(live|history)\//;
const ROOT = process.cwd();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/hidden-areas.json"), "utf8"));
const HIDDEN = new Set(CFG.hidden);
const OWNERS = CFG.owners;
const SEALED = CFG.sealed.map((r) => new RegExp(r));
const isHiddenPath = (p) => SEALED.some((r) => r.test(p)) && !(SKIP_LIVE && LIVE.test(p));
const problems = [];
let sealedN = 0, keptN = 0, strippedN = 0;

/* ---------- shared files: the hidden countries' parts are taken out ---------- */
// A list item tagged with country codes (cc / ccs, a string or a list) is dropped when every code is hidden, and loses the
// hidden codes when it is also about other countries (the same rule the page uses while locked, assets/osap-news.js).
function ccsOf(o) { const v = o && (o.ccs !== undefined ? o.ccs : o.cc); return v == null ? null : [].concat(v); }
function onlyHidden(cs) { return !!cs && cs.length > 0 && cs.every((c) => HIDDEN.has(String(c).toLowerCase())); }
function dropFromList(list, codesOf, setCodes) {
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const cs = codesOf(list[i]);
    if (!cs || !cs.length) continue;
    if (onlyHidden(cs)) { list.splice(i, 1); n++; continue; }
    const keep = cs.filter((c) => !HIDDEN.has(String(c).toLowerCase()));
    if (keep.length !== cs.length) { setCodes(list[i], keep); n++; }
  }
  return n;
}
const itemCodes = (o) => ccsOf(o);
const setItemCodes = (o, keep) => { const k = o.ccs !== undefined ? "ccs" : "cc"; o[k] = Array.isArray(o[k]) ? keep : keep[0]; };
const STRIP = [
  // per-country news and social items: the US page has its own (sealed) files; the source lists stay (public feed names)
  { file: "data/live/news.js", fix: (v) => dropKeys(v.items) },
  { file: "data/live/social.js", fix: (v) => dropKeys(v.items) },
  { file: "data/live/topics.js", fix: (v) => dropFromList(v.items || [], itemCodes, setItemCodes) },
  { file: "data/live/ucdp.js", fix: (v) => (Array.isArray(v.items) ? dropFromList(v.items, itemCodes, setItemCodes) : 0) },
  // event summaries: keyed by id, one country each
  { file: "data/live/evsum.js", fix: (v) => { let n = 0; for (const [k, e] of Object.entries(v.items || {})) if (onlyHidden(ccsOf(e))) { delete v.items[k]; n++; } return n; } },
  // the news search pool, one file a day: each row starts with its country code(s)
  { dir: "data/live/news-index", fix: (v) => (Array.isArray(v) ? dropFromList(v, (r) => (r && r[0] != null ? [].concat(r[0]) : null), (r, keep) => { r[0] = Array.isArray(r[0]) ? keep : keep[0]; }) : 0) },
];
function dropKeys(o) { let n = 0; if (o) for (const k of Object.keys(o)) if (HIDDEN.has(k)) { delete o[k]; n++; } return n; }
// window.NAME=<json>;  or the news-index day form  window.D=window.D||{};window.D["2026-10-05"]=<json>;
const HEAD = /^(window\.[\w$]+=window\.[\w$]+\|\|\{\};window\.[\w$]+\["[^"]+"\]=|window\.[\w$]+\s*=\s*)/;
function stripFile(rel, fix) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) return;
  const t = fs.readFileSync(f, "utf8"), m = t.match(HEAD);
  if (!m) { console.warn("seal_hidden: shape not recognised, left as is:", rel); return; }
  let v;
  try { v = JSON.parse(t.slice(m[0].length).trim().replace(/;$/, "")); } catch (e) { console.warn("seal_hidden: unreadable, left as is:", rel, e.message); return; }
  const n = fix(v);
  if (!n) return;
  if (CHECK) { problems.push(rel + ": " + n + " hidden-country entries"); return; }
  fs.writeFileSync(f, m[0] + JSON.stringify(v) + ";" + (t.endsWith("\n") ? "\n" : ""));
  strippedN += n;
  console.log("seal_hidden: stripped " + n + " hidden-country entries from " + rel);
}

/* ---------- cameras: the hidden countries' agencies move from index.json to a sealed <cc>-index.json ---------- */
function splitCams() {
  const f = path.join(ROOT, "data/cams/index.json");
  if (!fs.existsSync(f)) return;
  const ix = JSON.parse(fs.readFileSync(f, "utf8"));
  const out = {};
  ix.sources = (ix.sources || []).filter((s) => { const cc = String(s.cc || "").toLowerCase(); if (!HIDDEN.has(cc)) return true; (out[cc] = out[cc] || []).push(s); return false; });
  if (!Object.keys(out).length) return;
  if (CHECK) { problems.push("data/cams/index.json: " + Object.values(out).flat().length + " hidden-country camera sources"); return; }
  for (const [cc, sources] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, "data/cams/" + cc + "-index.json"), JSON.stringify({ built: ix.built, sources }, null, 1) + "\n");
  fs.writeFileSync(f, JSON.stringify(ix, null, 1) + "\n");
  console.log("seal_hidden: moved " + Object.values(out).flat().length + " camera sources out of data/cams/index.json");
}

/* ---------- hidden files: sealed in place ---------- */
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else if (e.isFile()) acc.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return acc;
}
function committed(rel) {
  try { return execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { return null; }
}
async function sealAll() {
  const want = (await Promise.all(OWNERS.map(fingerprint))).sort().join(",");
  const files = ["data", "source"].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d), []));
  for (const rel of files.filter(isHiddenPath)) {
    const f = path.join(ROOT, rel), buf = fs.readFileSync(f);
    if (isSealed(buf.subarray(0, 32).toString("latin1"))) continue;
    if (CHECK) { problems.push(rel + ": plain"); continue; }
    // the same content as the committed sealed copy, for the same owners: keep that copy
    const h = await contentHash(rel, buf), old = committed(rel), env = old && envelope(old);
    if (env && env.h === h && env.r.map((r) => r.f).sort().join(",") === want) { fs.writeFileSync(f, old); keptN++; continue; }
    fs.writeFileSync(f, await seal(buf, OWNERS, rel));
    sealedN++;
  }
}

if (!OWNERS.length) { console.error("seal_hidden: no owner keys in tools/hidden-areas.json"); process.exit(1); }
for (const s of STRIP) {
  if (SKIP_LIVE && LIVE.test(s.file || s.dir + "/")) continue;
  if (s.file) stripFile(s.file, s.fix);
  else if (fs.existsSync(path.join(ROOT, s.dir))) for (const n of fs.readdirSync(path.join(ROOT, s.dir)).sort()) if (n.endsWith(".js")) stripFile(s.dir + "/" + n, s.fix);
}
splitCams();
await sealAll();
if (CHECK) {
  if (problems.length) { console.error("seal_hidden --check: hidden-area data is readable in the repository (run node tools/seal_hidden.mjs):\n  " + problems.slice(0, 40).join("\n  ") + (problems.length > 40 ? "\n  … " + (problems.length - 40) + " more" : "")); process.exit(1); }
  console.log("seal_hidden --check: hidden-area data is sealed");
} else console.log(`seal_hidden: ${sealedN} sealed, ${keptN} unchanged (earlier sealed copy kept), ${strippedN} shared entries stripped`);
