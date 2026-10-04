/* AXIOM OSAP viewshed worker: runs the terrain engine (viewshed-engine.js) off the page so the map never freezes.
   Messages in:  { cmd: "grid", gid, E, n, rowM }                        keep this elevation grid (one at a time)
                 { cmd: "run", gid, rid, o, coarse }                     viewshed on the kept grid; coarse = the quick first pass factor
                 { cmd: "los", gid, rid, a, b, o }                       line of sight between two grid points
   Messages out: { rid, pass: "coarse" | "fine", res } | { rid, los } | { rid, error }
   It never fetches anything: the elevation comes from the page's terrain provider. */
importScripts("viewshed-engine.js");
var G = null;
self.onmessage = function (e) {
  var m = e.data || {};
  try {
    if (m.cmd === "grid") { G = { gid: m.gid, E: m.E, n: m.n, rowM: m.rowM }; return; }
    if (!G || G.gid !== m.gid) { self.postMessage({ rid: m.rid, error: "stale" }); return; }
    if (m.cmd === "run") {
      if (m.coarse > 1) {
        var c = self.OSAP_VS.coarsen(G, m.coarse), rc = self.OSAP_VS.viewshed(c, m.o);
        self.postMessage({ rid: m.rid, pass: "coarse", f: m.coarse, n: c.n, res: pack(rc) }, [rc.cls.buffer, rc.blockD.buffer, rc.obsMax.buffer]);
      }
      var r = self.OSAP_VS.viewshed(G, m.o);
      self.postMessage({ rid: m.rid, pass: "fine", f: 1, n: G.n, res: pack(r) }, [r.cls.buffer, r.blockD.buffer, r.obsMax.buffer]);
    } else if (m.cmd === "los") {
      self.postMessage({ rid: m.rid, los: self.OSAP_VS.los(G, m.a, m.b, m.o) });
    }
  } catch (x) { self.postMessage({ rid: m.rid, error: String(x && x.message || x) }); }
};
function pack(r) { return { cls: r.cls, blockD: r.blockD, obsMax: r.obsMax, horizon: r.horizon, rays: r.rays, Z0: r.Z0, Zg: r.Zg, stats: r.stats }; }
