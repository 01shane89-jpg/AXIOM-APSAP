// Conflict extras (run by .github/workflows/refresh-flood.yml, step "conflicts", after tools/refresh_conflicts.mjs; or by hand).
// A conflict in tools/conflicts.json may name an "extras" module (tools/conflict_extras/<id>.mjs) for data that is not a report:
// alert states, satellite heat detections, each side's running claims. Each module exports run(ctx) and returns a plain object;
// this runner writes it to data/live/conflicts/extras/<id>.js as (window.OSAP_CF_EXTRA=...)[id], loaded by the page only when
// that conflict's tab opens. A module that throws leaves its old file untouched. PROBE=1 prints the result and writes nothing.
import fs from "node:fs";
import { sha256 } from "./conflict_lib.mjs";
import { tgItems } from "./tg_preview.mjs";

const PROBE = process.env.PROBE === "1", ONLY = (process.env.CONFLICTS || "").split(",").filter(Boolean), OUT = "data/live/conflicts/extras";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP conflict extras; +https://osap-app.github.io/)";
async function get(url, accept) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: accept || "*/*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
const readJs = (f) => { try { const t = fs.readFileSync(f, "utf8"), i = t.indexOf("={"); return JSON.parse(t.slice(i + 1).trim().replace(/;\s*$/, "")); } catch (e) { return null; } };
const errMsg = (e) => (e.name === "AbortError" ? "timed out" : String(e.cause?.code || e.message || e).slice(0, 160));

const CFG = JSON.parse(fs.readFileSync("tools/conflicts.json", "utf8"));
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const c of CFG.conflicts.filter((c) => c.extras && (!ONLY.length || ONLY.includes(c.id)))) {
  const file = OUT + "/" + c.id + ".js", prev = readJs(file) || {};
  try {
    const mod = await import("./conflict_extras/" + c.id + ".mjs");
    const out = await mod.run({ conflict: c, prev, get, sha256, stamp, tgItems, readJs, errMsg, probe: PROBE });
    const data = { schema: "osap-cf-extra/1", id: c.id, asof: stamp, ...out };
    if (PROBE) { console.log(JSON.stringify(data, null, 1).slice(0, 20000)); continue; }
    fs.writeFileSync(file, "(window.OSAP_CF_EXTRA=window.OSAP_CF_EXTRA||{})[" + JSON.stringify(c.id) + "]=" + JSON.stringify(data).replace(/<\//g, "<\\/") + ";\n");
    console.log("extras ok  ", c.id, (out.sources || []).map((s) => s.id + ":" + (s.ok ? "ok" : s.error)).join(" "));
  } catch (e) { failed++; console.error("extras FAIL", c.id, errMsg(e)); }
}
if (failed) process.exitCode = 0;   // one conflict's extras failing never fails the refresh
