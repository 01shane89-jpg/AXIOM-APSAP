// Lock the paid plans' data files in the public repository (Shane 2026-11-08, "Lock the paid files").
// The repository and GitHub Pages are public, so a Mid or Full file kept plain there could be read by anyone, around the
// paywall. Every path in TIER_SEALED (tools/tiers.mjs) is sealed (tools/seal_lib.mjs format) for the server's tier key, whose
// public half is tools/tier-key.json. The private half lives only in the Netlify environment variable OSAP_TIER_KEY (the edge
// gate netlify/edge-functions/osap-data.js opens a file for a signed-in user whose plan allows it) and in the GitHub Actions
// secret of the same name (the refresh jobs open their earlier output before they rebuild it).
//   node tools/seal_tier.mjs                   seal every plain file under TIER_SEALED in place (run just before `git add`)
//   node tools/seal_tier.mjs --check           change nothing; fail if a TIER_SEALED file is plain
//   node tools/seal_tier.mjs --open <dir>...   open the files sealed for the tier key under these folders, in place, so a job
//                                              can read its earlier output; needs OSAP_TIER_KEY. Without it the files stay
//                                              sealed and the job reads them as missing (it starts afresh, nothing breaks).
// A file rebuilt with the same content keeps its earlier sealed copy (the envelope's "h"), so jobs commit only real changes.
// Sealing needs no secret, so a job can always lock; only the gate and the jobs given the secret can open.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { seal, open, isSealed, envelope, contentHash, fingerprint, unb64u } from "./seal_lib.mjs";
import { TIER_SEALED } from "./tiers.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const CHECK = args.includes("--check"), OPEN = args.includes("--open");
const PUB = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/tier-key.json"), "utf8")).pub;
const isTierPath = (rel) => TIER_SEALED.some((r) => r.test(rel));

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else if (e.isFile()) acc.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return acc;
}
const filesUnder = (dirs) => dirs.filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => (fs.statSync(path.join(ROOT, d)).isDirectory() ? walk(path.join(ROOT, d), []) : [d]));
function committed(rel) {
  try { return execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { return null; }
}

async function openAll(dirs) {
  const pk = process.env.OSAP_TIER_KEY;
  if (!pk) { console.warn("seal_tier --open: OSAP_TIER_KEY is not set; sealed files stay sealed and read as missing"); return; }
  const { subtle } = globalThis.crypto;
  const priv = await subtle.importKey("pkcs8", unb64u(pk), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  let n = 0, bad = 0;
  for (const rel of filesUnder(dirs)) {
    const f = path.join(ROOT, rel), head = fs.readFileSync(f).subarray(0, 32).toString("latin1");
    if (!isSealed(head)) continue;
    try { fs.writeFileSync(f, await open(fs.readFileSync(f, "utf8"), priv, PUB)); n++; } catch (e) { bad++; }
  }
  console.log(`seal_tier --open: ${n} opened` + (bad ? `, ${bad} not sealed for the tier key (left as they are)` : ""));
}

async function sealAll() {
  const want = await fingerprint(PUB), problems = [];
  let sealedN = 0, keptN = 0;
  for (const rel of filesUnder(["data", "source"]).filter(isTierPath)) {
    const f = path.join(ROOT, rel), buf = fs.readFileSync(f);
    if (isSealed(buf.subarray(0, 32).toString("latin1"))) continue;
    if (CHECK) { problems.push(rel); continue; }
    const h = await contentHash(rel, buf), old = committed(rel), env = old && envelope(old);
    if (env && env.h === h && env.r.length === 1 && env.r[0].f === want) { fs.writeFileSync(f, old); keptN++; continue; }
    fs.writeFileSync(f, await seal(buf, [PUB], rel));
    sealedN++;
  }
  if (CHECK) {
    if (problems.length) {
      console.error("seal_tier --check: paid-plan data is readable in the public repository (run node tools/seal_tier.mjs):\n  " + problems.slice(0, 40).join("\n  ") + (problems.length > 40 ? "\n  … " + (problems.length - 40) + " more" : ""));
      process.exit(1);
    }
    console.log("seal_tier --check: paid-plan data is sealed");
  } else console.log(`seal_tier: ${sealedN} sealed, ${keptN} unchanged (earlier sealed copy kept)`);
}

if (OPEN) await openAll(args.filter((a) => !a.startsWith("--")));
else await sealAll();
