// Paid-plan files sealed in the public repository for the server's tier key (tools/seal_tier.mjs, TIER_SEALED in tools/tiers.mjs).
// Run from the repo root: node tests/seal_tier.test.mjs
// Uses a key pair made here for the test; the real private key lives only in Netlify and GitHub Actions secrets.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { b64u, envelope, fingerprint } from "../tools/seal_lib.mjs";
import { TIER_SEALED, tierOfPath } from "../tools/tiers.mjs";
import { loadTierKey, openForTier } from "../tools/tier_open.mjs";

const { subtle } = globalThis.crypto;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ROOT = process.cwd();

// 1. only paid paths are sealed: a free file sealed here would break the free plan (the gate passes free files on unopened)
const free = ["data/live/news.js", "data/basemap/x.json", "data/places/th.json", "source/countries/th.json", "data/live/warnings.js"];
ok(free.every((p) => !TIER_SEALED.some((r) => r.test(p))), "no free file is in TIER_SEALED");
const real = execFileSync("git", ["ls-files", "data", "source"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 30 }).split("\n").filter(Boolean);
const sealedReal = real.filter((p) => TIER_SEALED.some((r) => r.test(p)));
ok(sealedReal.every((p) => ["mid", "full"].includes(tierOfPath(p))), `every TIER_SEALED file in the repository (${sealedReal.length}) is Mid or Full`);
// files sealed for a key the gate does not hold show as empty data sets, so nothing is sealed until the key is set
ok(TIER_SEALED.length === 0 || !!JSON.parse(fs.readFileSync(path.join(ROOT, "tools/tier-key.json"), "utf8")).pub, "paths are sealed only once tools/tier-key.json holds the key");
const presence = real.filter((p) => /^data\/(cnpresence|rupresence|irpresence)\//.test(p));
ok(TIER_SEALED.length > 0 || presence.every((p) => !fs.readFileSync(path.join(ROOT, p), "latin1").startsWith("/*osap-sealed:v1 ")), `while TIER_SEALED is empty, no presence file is sealed (${presence.length} checked)`);

// 2. the public key in the repository is a real P-256 key, and the matching private half is nowhere in the repository
const PUB = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/tier-key.json"), "utf8")).pub;
let pubOk = !PUB; try { if (PUB) { await subtle.importKey("spki", Buffer.from(PUB, "base64url"), { name: "ECDH", namedCurve: "P-256" }, false, []); pubOk = true; } } catch (e) {}
ok(pubOk, "tools/tier-key.json holds a P-256 public key, or none yet");
// every P-256 PKCS#8 key in base64url starts with this header
const g = spawnSync("git", ["grep", "-l", "-F", "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg", "--", "tools", "netlify", "assets", ".github", "data", "source"], { cwd: ROOT, encoding: "utf8" });
const tracked = String(g.stdout || "").trim();
ok(!tracked, "no P-256 private key is committed in the repository" + (tracked ? ": " + tracked : ""));

// 3. seal, check, keep unchanged copies, open: in a scratch repository with a test key
const k = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const TPUB = b64u(await subtle.exportKey("spki", k.publicKey)), TPRIV = b64u(await subtle.exportKey("pkcs8", k.privateKey));
const D = fs.mkdtempSync(path.join(os.tmpdir(), "seal-tier-"));
fs.mkdirSync(path.join(D, "tools"));
for (const f of ["seal_tier.mjs", "seal_lib.mjs", "tiers.mjs"]) fs.copyFileSync(path.join(ROOT, "tools", f), path.join(D, "tools", f));
// the scratch copy seals the presence folders, whatever the repository's own list holds today
fs.writeFileSync(path.join(D, "tools/tiers.mjs"), fs.readFileSync(path.join(ROOT, "tools/tiers.mjs"), "utf8").replace(/export const TIER_SEALED = \[[^\]]*\];/, "export const TIER_SEALED = [/^data\\/(cnpresence|rupresence|irpresence)\\//];"));
fs.writeFileSync(path.join(D, "tools/tier-key.json"), JSON.stringify({ pub: TPUB }));
const put = (rel, t) => { fs.mkdirSync(path.dirname(path.join(D, rel)), { recursive: true }); fs.writeFileSync(path.join(D, rel), t); };
const get = (rel) => fs.readFileSync(path.join(D, rel), "utf8");
const PAID = '{"v":1,"cc":"th","items":[{"name":"SECRET-SITE-NAME"}]}\n', FREE = "window.NEWS={};\n";
put("data/cnpresence/th.json", PAID); put("data/rupresence/index.json", '{"sources":{}}\n'); put("data/live/news.js", FREE);
const run = (args, env = {}) => { const x = spawnSync("node", ["tools/seal_tier.mjs", ...args], { cwd: D, encoding: "utf8", env: { ...process.env, OSAP_TIER_KEY: "", ...env } }); return { code: x.status, out: x.stdout + x.stderr }; };
const git = (...a) => execFileSync("git", a, { cwd: D, stdio: "ignore" });
git("init", "-q"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "0");

let r = run(["--check"]);
ok(r.code !== 0 && /cnpresence\/th\.json/.test(r.out), "--check fails while a paid file is plain, naming it");
r = run([]);
ok(r.code === 0 && /2 sealed/.test(r.out), "sealing locks the two paid files");
ok(!get("data/cnpresence/th.json").includes("SECRET-SITE-NAME") && envelope(get("data/cnpresence/th.json")), "the sealed file holds none of the content");
ok(get("data/live/news.js") === FREE, "a free file is left plain");
ok(run(["--check"]).code === 0, "--check passes once sealed");
const env1 = envelope(get("data/cnpresence/th.json"));
ok(env1.r.length === 1 && env1.r[0].f === (await fingerprint(TPUB)), "sealed for the tier key only");

// the gate opens it with the private half
const key = await loadTierKey(TPRIV, TPUB);
ok(new TextDecoder().decode(await openForTier(get("data/cnpresence/th.json"), key)) === PAID, "the edge gate's opener reads it back, byte for byte");
const key2 = await loadTierKey(TPRIV);
ok(key2 && key2.pub === TPUB && new TextDecoder().decode(await openForTier(get("data/cnpresence/th.json"), key2)) === PAID, "with only OSAP_TIER_KEY set (no public half), the gate works out the public key and opens it");

// a job: open earlier output, rebuild the same content, seal again: the committed sealed copy is kept (no churn)
git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "1");
const before = get("data/cnpresence/th.json");
r = run(["--open", "data/cnpresence"]);
ok(/OSAP_TIER_KEY is not set/.test(r.out) && get("data/cnpresence/th.json") === before, "--open without the secret leaves the files sealed and says so");
r = run(["--open", "data/cnpresence", "data/rupresence"], { OSAP_TIER_KEY: TPRIV });
ok(/2 opened/.test(r.out) && get("data/cnpresence/th.json") === PAID, "--open with the secret gives the job its earlier output");
run([]);
ok(get("data/cnpresence/th.json") === before, "rebuilt unchanged: the earlier sealed copy is kept, so nothing new is committed");
put("data/cnpresence/th.json", PAID.replace("SECRET", "OTHER"));
run([]);
ok(get("data/cnpresence/th.json") !== before && !get("data/cnpresence/th.json").includes("OTHER-SITE"), "changed content is sealed afresh");
fs.rmSync(D, { recursive: true, force: true });

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
