// Sealed hidden-area files (tools/seal_lib.mjs, tools/seal_hidden.mjs; ADR in the "Hide US Data" thread).
// Run from the repo root: node tests/seal.test.mjs
// Uses a key pair made here for the test; the owners' real private keys live only on their devices and are never needed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { seal, open, isSealed, envelope, b64u, fingerprint } from "../tools/seal_lib.mjs";

const { subtle } = globalThis.crypto;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ROOT = process.cwd();
const keyPair = async () => {
  const k = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { priv: k.privateKey, pub: b64u(await subtle.exportKey("spki", k.publicKey)) };
};
const A = await keyPair(), B = await keyPair(), C = await keyPair();
const dec = (u8) => new TextDecoder().decode(u8);

// 1. round trip, for every owner and nobody else
{
  const text = 'window.TEST_DATA={"a":1,"note":"ünïcode ✓"};\n';
  const s = await seal(text, ["osap-pub:v1:" + A.pub, B.pub], "data/test/us.js");
  ok(isSealed(s) && !s.includes("TEST_DATA") && !s.includes("note"), "sealed text holds none of the content");
  ok(dec(await open(s, A.priv, A.pub)) === text && dec(await open(s, B.priv, B.pub)) === text, "each owner key opens it, byte for byte");
  let refused = false; try { await open(s, C.priv, C.pub); } catch (e) { refused = /not sealed for this key/.test(e.message); }
  ok(refused, "a key that is not an owner's cannot open it");
  let forged = false; try { const env = envelope(s); env.r[0].f = await fingerprint(C.pub); await open(s.slice(0, 17) + JSON.stringify(env) + "*/\n", C.priv, C.pub); } catch (e) { forged = true; }
  ok(forged, "relabelling an owner's entry for another key does not open it");
  const w = {}; let threw = false; try { new Function("window", s)(w); } catch (e) { threw = true; }
  ok(!threw && Object.keys(w).length === 0, "loaded as a script, a sealed file runs nothing");
  ok(!/\*\//.test(s.slice(2, -3)), "the envelope never closes the comment early");
  const t = await seal(text, [A.pub], "data/test/us.js"), u = await seal(text, [A.pub], "data/test/other.js");
  ok(envelope(t).h === envelope(s).h && envelope(u).h !== envelope(t).h && envelope(t).c !== envelope(s).c, "content hash follows path and content; the ciphertext is fresh each time");
}

// 2. one list of owners and one list of sealed paths, in step across the tools, the page and the service worker
{
  const cfg = JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8"));
  const lock = fs.readFileSync("assets/osap-lock.js", "utf8");
  const owner = [...(lock.match(/var OWNER = \[([\s\S]*?)\];/) || ["", ""])[1].matchAll(/"(osap-pub:v1:[A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  ok(owner.length > 0 && JSON.stringify(owner) === JSON.stringify(cfg.owners), "tools/hidden-areas.json owners equal OWNER in assets/osap-lock.js (" + owner.length + ")");
  const hid = (lock.match(/var HIDDEN = (\[[^\]]*\])/) || [])[1];
  ok(hid && JSON.stringify(JSON.parse(hid)) === JSON.stringify(cfg.hidden), "hidden countries agree: " + hid);
  const sw = fs.readFileSync("sw.js", "utf8"), m = sw.match(/const SEALED = (\[[\s\S]*?\])\.map/);
  ok(m && JSON.stringify(JSON.parse(m[1])) === JSON.stringify(cfg.sealed), "sw.js SEALED equals tools/hidden-areas.json sealed");
}

// 3. seal_hidden on a small copy of the data: --check fails, sealing fixes it, owners can open, unchanged files stay unchanged
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-test-"));
  const w = (rel, t) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), t); };
  fs.mkdirSync(path.join(dir, "tools"));
  for (const f of ["seal_lib.mjs", "seal_hidden.mjs"]) fs.copyFileSync(path.join(ROOT, "tools", f), path.join(dir, "tools", f));
  const cfg = JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8"));
  w("tools/hidden-areas.json", JSON.stringify({ ...cfg, owners: ["osap-pub:v1:" + A.pub] }));
  const brief = 'window.ASAP_BRIEF=window.ASAP_BRIEF||{};window.ASAP_BRIEF.us={"t":"test brief"};\n';
  w("data/brief/us.js", brief);
  w("data/brief/th.js", 'window.ASAP_BRIEF.th={"t":"stays plain"};\n');
  w("data/infra/us/port.json", '{"n":1}\n');
  w("data/live/news/us.js", 'window.ASAP_NEWS={"items":{"us":[{"title":"x"}]}};\n');
  w("data/basemap/us-states/tx.js", "window.STATE_TX=1;\n");
  w("data/live/news.js", 'window.ASAP_NEWS={"sources":[{"cc":"us","source":"Feed"}],"items":{"us":[{"title":"US only"}],"th":[{"title":"Thai"}]}};\n');
  w("data/live/topics.js", 'window.OSAP_TOPICS={"items":[{"title":"a","cc":"us"},{"title":"b","cc":["us","ca"]},{"title":"c","cc":"th"}]};\n');
  w("data/live/evsum.js", 'window.OSAP_EVSUM={"items":{"k1":{"cc":"us","title":"x"},"k2":{"cc":"kr","title":"y"}}};\n');
  w("data/live/news-index/2026-10-05.js", 'window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY["2026-10-05"]=[["us","t1"],["vn","t2"],[["us","mx"],"t3"]];\n');
  w("data/cams/index.json", JSON.stringify({ built: "b", sources: [{ id: "sg-lta", cc: "sg" }, { id: "us-x", cc: "us" }] }, null, 1) + "\n");
  w("data/cams/us-x.json", '{"id":"us-x","cams":[]}\n');
  const run = (...a) => { try { return { code: 0, out: execFileSync("node", ["tools/seal_hidden.mjs", ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "empty");
  const c1 = run("--check");
  ok(c1.code === 1 && /data\/brief\/us\.js: plain/.test(c1.out) && /data\/cams\/index\.json/.test(c1.out) && /topics\.js/.test(c1.out), "--check fails on plain hidden files and shared files with hidden parts");
  ok(run("--check", "--skip-live").code === 1, "--check --skip-live still fails on a plain brief");
  const r = run();
  ok(r.code === 0, "sealing runs: " + r.out.trim().split("\n").pop());
  ok(run("--check").code === 0, "--check passes once sealed");
  const rd = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
  ok(dec(await open(rd("data/brief/us.js"), A.priv, A.pub)) === brief, "the owner opens the sealed brief, unchanged");
  ok(isSealed(rd("data/infra/us/port.json")) && isSealed(rd("data/live/news/us.js")) && isSealed(rd("data/cams/us-x.json")) && isSealed(rd("data/cams/us-index.json")), "infra, live feed and camera files sealed, with the new hidden camera index");
  ok(!isSealed(rd("data/brief/th.js")) && !isSealed(rd("data/basemap/us-states/tx.js")), "other countries and the public state outlines stay plain");
  const L = (rel) => { const o = {}; new Function("window", rd(rel))(o); return o; };
  const news = L("data/live/news.js").ASAP_NEWS, topics = L("data/live/topics.js").OSAP_TOPICS, ev = L("data/live/evsum.js").OSAP_EVSUM, day = L("data/live/news-index/2026-10-05.js").OSAP_NEWSIX_DAY["2026-10-05"];
  ok(!news.items.us && news.items.th && news.sources.length === 1, "news.js: US items gone, Thai items and the source list kept");
  ok(JSON.stringify(topics.items.map((i) => [i.title, i.cc])) === JSON.stringify([["b", ["ca"]], ["c", "th"]]), "topics: US-only item gone, US dropped from a shared one");
  ok(!ev.items.k1 && ev.items.k2, "event summaries: the US one is gone");
  ok(JSON.stringify(day) === JSON.stringify([["vn", "t2"], [["mx"], "t3"]]), "news index: US-only rows gone, US dropped from shared rows");
  const cams = JSON.parse(rd("data/cams/index.json"));
  ok(cams.sources.length === 1 && cams.sources[0].id === "sg-lta", "camera index: the US agency moved out");
  // a job that rebuilds a file with the same content keeps the committed sealed copy
  git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "sealed");
  const before = rd("data/brief/us.js");
  w("data/brief/us.js", brief); w("data/infra/us/port.json", '{"n":2}\n');
  run();
  ok(rd("data/brief/us.js") === before, "rebuilt unchanged: the sealed copy is kept byte for byte (no new commit)");
  ok(dec(await open(rd("data/infra/us/port.json"), A.priv, A.pub)) === '{"n":2}\n', "rebuilt changed: sealed again with the new content");
  ok(run().out.includes("0 sealed"), "a second run finds nothing left to seal");
  fs.rmSync(dir, { recursive: true, force: true });
}

// 4. every workflow step that commits data seals first (otherwise a refresh would put plain US data back)
{
  const ROOTS = ["source/sof", "source/countries", "data/live", "data/history", "data/cams", "data/infra", "data/dc", "data/sof", "data/layers", "data/brief"];
  const capable = (t) => ROOTS.some((r) => t === r || t.startsWith(r + "/") || r.startsWith(t.replace(/\/$/, "") + "/") || t === "." || t === "-A");
  const bad = [];
  for (const f of fs.readdirSync(".github/workflows").filter((f) => f.endsWith(".yml"))) {
    const src = fs.readFileSync(".github/workflows/" + f, "utf8");
    for (const m of src.matchAll(/run: \|\n((?:[ ]{10,}.*\n|\s*\n)+)/g)) {
      const block = m[1], lines = block.split("\n");
      const first = lines.findIndex((l) => /git add\b/.test(l) && l.replace(/.*git add/, "").split(/[\s;&|]+/).concat((l.match(/for p in ([^;]+);/) || ["", ""])[1].split(/\s+/)).some((t) => t && !t.startsWith("-") && capable(t)));
      if (first < 0) continue;
      const seal = lines.findIndex((l) => /node tools\/seal_hidden\.mjs(?!\s+--check)/.test(l));
      if (seal < 0 || seal > first) bad.push(f + ": " + lines[first].trim().slice(0, 80));
    }
  }
  ok(!bad.length, "every committing workflow step seals before git add" + (bad.length ? ": " + bad.join(" | ") : ""));
}

if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
