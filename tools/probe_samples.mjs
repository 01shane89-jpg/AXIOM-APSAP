// PROBE BRANCH ONLY: saves raw bodies of a few feeds and pages to probe-out/samples for parser work.
import fs from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP feed check)";
const L = JSON.parse(fs.readFileSync("tools/samples.json", "utf8"));
fs.mkdirSync("probe-out/samples", { recursive: true });
for (const [name, url, max] of L) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "*/*" } });
    const b = await r.text(); clearTimeout(t);
    fs.writeFileSync("probe-out/samples/" + name, b.slice(0, max || 400000));
    console.log("ok", name, r.status, b.length);
  } catch (e) { console.log("FAIL", name, e.message); }
}
