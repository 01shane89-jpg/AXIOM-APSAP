// PROBE BRANCH ONLY: UKMTO incidents API (site is under the Open Government Licence).
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
for (const [u, opt] of [["https://www.ukmto.org/api/ukmto/all", {}], ["https://www.ukmto.org/api/ukmto/incident/filters", {}], ["https://www.ukmto.org/api/ukmto/ticker", {}],
  ["https://www.ukmto.org/api/ukmto/all", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }]]) {
  try { const r = await fetch(u, { ...opt, headers: { "user-agent": UA, accept: "application/json", ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000) }); const t = await r.text();
    console.log("PU " + (opt.method || "GET") + " " + u + " | " + r.status + " | " + r.headers.get("content-type") + " | " + t.length + " | " + t.slice(0, 3000).replace(/\s+/g, " "));
  } catch (e) { console.log("PU " + u + " ERR " + e.message); }
}
const js = await (await fetch("https://www.ukmto.org/_next/static/chunks/679-ac974cdd5121ce91.js", { headers: { "user-agent": UA } })).text();
for (const k of ["/api/ukmto/all", "/api/ukmto/incident/filters"]) { const i = js.indexOf(k); console.log("PJC " + k + " | " + js.slice(Math.max(0, i - 700), i + 500)); }
const i = js.indexOf("xv:"); console.log("PXV " + js.slice(Math.max(0, i - 100), i + 300));
