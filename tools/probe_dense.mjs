// PROBE BRANCH ONLY: IT DPC criticità latest JSON shape.
const UA = { "user-agent": "AXIOM-OSAP probe", accept: "application/vnd.github+json" };
const g = async (u) => (await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })).text();
const out = {};
const c = JSON.parse(await g("https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/commits?per_page=10"));
out.msgs = c.map((x) => x.commit.message + " " + x.commit.committer.date);
const pub = c.find((x) => /Published by DPC/.test(x.commit.message));
const d = JSON.parse(await g("https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/commits/" + pub.sha));
out.files = (d.files || []).map((f) => f.filename);
const j = (d.files || []).find((f) => /\.json$/.test(f.filename));
if (j) { const t = await g("https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/" + j.filename); out.n = t.length; out.sample = t.slice(0, 4000); }
console.log("ITJ" + JSON.stringify(out));
