// PROBE BRANCH ONLY: HR CAP files + IT DPC latest bulletin shape.
const UA = { "user-agent": "AXIOM-OSAP probe", accept: "*/*" };
const g = async (u) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); return { s: r.status, cors: r.headers.get("access-control-allow-origin"), t: await r.text() }; };
const out = {};
for (const u of ["https://meteo.hr/upozorenja/cap_hr_today.xml", "https://meteo.hr/upozorenja/cap_hr_tomorrow.xml"]) { try { const r = await g(u); out[u] = { s: r.s, cors: r.cors, n: r.t.length, head: r.t.slice(0, 2500) }; } catch (e) { out[u] = { err: e.message }; } }
try {
  const c = JSON.parse((await g("https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/commits?per_page=2")).t);
  out.it_commits = c.map((x) => [x.sha, x.commit.message, x.commit.committer.date]);
  const d = JSON.parse((await g("https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/commits/" + c[0].sha)).t);
  out.it_files = (d.files || []).map((f) => f.filename).slice(0, 20);
  const j = (d.files || []).find((f) => /\.json$/.test(f.filename));
  if (j) { const r = await g("https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/" + j.filename); out.it_sample = r.t.slice(0, 3000); out.it_n = r.t.length; }
  const tree = JSON.parse((await g("https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/git/trees/master")).t);
  out.it_tree = (tree.tree || []).map((x) => x.path + ":" + x.type);
} catch (e) { out.it_err = e.message; }
console.log("HRIT" + JSON.stringify(out));
