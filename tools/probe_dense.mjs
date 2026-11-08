// PROBE BRANCH ONLY: IT DPC criticità latest JSON via git trees.
const UA = { "user-agent": "AXIOM-OSAP probe", accept: "application/vnd.github+json" };
const g = async (u) => (await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) })).text();
const R = "https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica";
const out = {};
const top = JSON.parse(await g(R + "/git/trees/master"));
const f = top.tree.find((x) => x.path === "files");
const ft = JSON.parse(await g(R + "/git/trees/" + f.sha));
out.trunc = ft.truncated; out.count = ft.tree.length; out.dirs = ft.tree.filter((x) => x.type === "tree").map((x) => x.path);
const js = ft.tree.filter((x) => /^\d{8}_\d{4}\.json$/.test(x.path)).map((x) => x.path).sort();
out.last = js.slice(-3);
const t = await g("https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files/" + js[js.length - 1]);
out.n = t.length; out.sample = t.slice(0, 3500);
console.log("ITJ" + JSON.stringify(out));
