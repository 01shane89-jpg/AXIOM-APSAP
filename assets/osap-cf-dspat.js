/* AXIOM OSAP · Deep South patterns, peace talks and corridors, an addition to the Deep South conflict tab (thailand-deep-south).
   - Weekly brief: the past 7 days against the 4 weeks before, counted by the page from this tab's reports (attacks only: bombings,
     shootings, ambushes, clashes, arson). Several reports of one incident count once (the tab's own grouping). No AI: every figure is
     a count of what outlets reported, and the brief says so. Copy puts it on the clipboard as plain text.
   - Patterns: attack incidents per week for 26 weeks, then by kind and by district for the period chosen in the page header. Report
     times are when outlets published, not when attacks happened, so there is no hour-of-day chart.
   - Peace talks: the hand-kept tracker (data/thailand/deepsouth-peace.js, window.OSAP_DSPEACE, from source/thailand/deepsouth-peace.json
     by tools/build_deepsouth_peace.mjs), every line a sourced claim with its SHA-256 fingerprint, then this tab's latest peace-talk reports.
   - Corridors: a map switch for the railway and main roads (data/thailand/deepsouth-corridors.js, window.OSAP_DSC, Natural Earth,
     approximate), and the attack reports in the period that name the railway, a train, a station, a highway or a bridge, plus UCDP
     events coded to an exact or near-exact place within 2 km of the line.
   Nothing here changes a report. Hooks into assets/osap-conflicts.js through window.OSAP_CF_HOOKS (render, clear). */
(function () {
  "use strict";
  var W = window, D = document, ID = "thailand-deep-south", CORR = "data/thailand/deepsouth-corridors.js", PEACE = "data/thailand/deepsouth-peace.js", AREAS = "data/places/deepsouth-areas.json";
  var DAY = 864e5, VIOLENT = { ied: 1, gun: 1, arson: 1 };
  var RAIL = /railway|\btrains?\b|\brail\b|รถไฟ/i, ROAD = /highway|bridge|roadside|ทางหลวง|สะพาน|ริมถนน|ด่านตรวจ|checkpoint/i;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function url(s) { return /^https?:\/\//i.test(s || "") ? esc(s) : "#"; }
  function num(n) { return Number(n || 0).toLocaleString("en-GB"); }
  function day(s) { var t = Date.parse(String(s || "").length <= 10 ? s + "T00:00:00Z" : s); return isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : esc(s || ""); }
  function parseT(s) { if (!s) return NaN; var t = String(s).replace(" ", "T"); if (!/Z$|[+-]\d\d:?\d\d$/.test(t)) t += (t.length <= 10 ? "T00:00:00Z" : "Z"); return Date.parse(t); }
  function load(src) { return new Promise(function (ok, bad) { var s = D.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = function () { bad(new Error("could not load " + src)); }; D.head.appendChild(s); }); }
  function T() { return W.OSAP_CONFLICT_TABS || {}; }
  function inP(t) { var f = T().inPeriod; return f ? f(t) : true; }
  function fpLine(fp) { return fp ? '<div class="fp" title="SHA-256 fingerprint of this record: ' + esc(fp) + '">SHA-256 ' + esc(fp.slice(0, 16)) + "…</div>" : ""; }
  function srcs(ev) { return (ev || []).map(function (e) { return '<a href="' + url(e.src) + '" target="_blank" rel="noopener noreferrer">' + esc(e.srcname) + "</a>"; }).join(" · "); }

  var st = { corr: false };
  try { var s0 = JSON.parse(localStorage.getItem("osap-cf-dsp") || "null"); if (s0) st = Object.assign(st, s0); } catch (e) {}
  function save() { try { localStorage.setItem("osap-cf-dsp", JSON.stringify(st)); } catch (e) {} }

  var on = false, data = null, map = null, lyr = null, pend = null, err = "", areas = null, aname = {}, placed = typeof WeakMap === "function" ? new WeakMap() : null;

  /* ---------- counting ---------- */
  function items() { var t = T(); return (t.items ? t.items(data) : (data && data.items) || []).filter(function (i) { return !t.family || t.family(i) !== "ucdp"; }); }
  function fam(i) { var t = T(); return t.family ? t.family(i) : String(i.kind || ""); }
  function groups(a) { var t = T(); return t.grouped ? t.grouped(a) : a.map(function (i) { return { lead: i, all: [i], date: i.date }; }); }
  function kname(k) { var t = T(); return t.kindName ? t.kindName(k) : k; }
  function attacks() { return items().filter(function (i) { return VIOLENT[fam(i)]; }); }
  function text(i) { return [i.title, i.title_en, i.summary, i.summary_en].join(" "); }
  // a report's district: the one it names (geo.id TH-xxxx) or, failing that, the one its point falls in (the taken-over tab's
  // records carry only a point); province-level reports name no district
  function inPoly(lon, lat, polys) {
    function ring(r) { var c = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c; } return c; }
    return polys.some(function (p) { return ring(p[0]) && !p.slice(1).some(ring); });
  }
  function dist(i) {
    var g = i.geo; if (!g || g.p === "province") return null;
    if (/^TH-\d{4}$/.test(g.id || "")) return g.id;
    if (!areas || g.la == null) return null;
    if (placed && placed.has(i)) return placed.get(i);
    var id = null;
    for (var k = 0; k < areas.length; k++) { var a = areas[k], b = a.bbox; if (g.la >= b[0] && g.la <= b[2] && g.lo >= b[1] && g.lo <= b[3] && inPoly(g.lo, g.la, a.polygons)) { id = a.id; break; } }
    if (placed) placed.set(i, id);
    return id;
  }
  function dname(i) { var id = dist(i), g = i.geo || {}; return aname[id] || String(g.n || id || "").replace(/ district,/, ","); }
  // the largest killed / injured figure any report of the incident gives (reports repeat figures; adding them would double-count)
  function hurt(g, k) { return g.all.reduce(function (m, i) { var v = +i[k]; return isFinite(v) && v > m ? v : m; }, 0); }
  function now() { var t = parseT(data && data.asof); return isFinite(t) ? t : Date.now(); }

  function brief() {
    var t0 = now(), a = attacks().filter(function (i) { var t = parseT(i.date); return t <= t0 + 36e5 && t0 - t <= 35 * DAY; });
    var wk = groups(a.filter(function (i) { return t0 - parseT(i.date) <= 7 * DAY; }));
    var pr = groups(a.filter(function (i) { return t0 - parseT(i.date) > 7 * DAY; }));
    var avg = pr.length / 4, kinds = {}, dW = {}, dP = {}, names = {}, k = 0, h = 0, rail = 0, road = 0;
    wk.forEach(function (g) {
      var f = fam(g.lead); kinds[f] = (kinds[f] || 0) + 1; k += hurt(g, "killed"); h += hurt(g, "injured");
      var id = dist(g.lead); if (id) { dW[id] = (dW[id] || 0) + 1; names[id] = dname(g.lead); }
      var tx = g.all.map(text).join(" "); if (RAIL.test(tx)) rail++; else if (ROAD.test(tx)) road++;
    });
    pr.forEach(function (g) { var id = dist(g.lead); if (id) dP[id] = 1; });
    var top = Object.keys(dW).sort(function (x, y) { return dW[y] - dW[x]; });
    return { to: t0, n: wk.length, reports: wk.reduce(function (s, g) { return s + g.all.length; }, 0), avg: avg, kinds: kinds, killed: k, injured: h,
      dists: top.map(function (id) { return { id: id, n: dW[id], name: names[id], fresh: !dP[id] }; }), rail: rail, road: road };
  }
  var FAMN = { ied: "bombings", gun: "shootings, ambushes and clashes", arson: "arson" }, FAM1 = { ied: "bombing", gun: "shooting, ambush or clash", arson: "arson" };
  function famn(f, n) { return (n === 1 ? FAM1 : FAMN)[f] || f; }
  function trend(b) {
    if (!b.avg && !b.n) return "none in the 4 weeks before either";
    var r = b.avg ? b.n / b.avg : Infinity;
    return (r >= 1.5 ? "up on" : r <= 0.67 ? "down on" : "about level with") + " the 4 weeks before (" + (Math.round(b.avg * 10) / 10) + " a week)";
  }
  function briefText(b) {
    var L = ["Deep South weekly brief, 7 days to " + day(new Date(b.to).toISOString()) + " (machine count of reports, not AI, not analyst-approved)",
      "Attack incidents reported: " + b.n + " (from " + b.reports + " reports), " + trend(b) + ".",
      "By kind: " + (Object.keys(b.kinds).map(function (f) { return b.kinds[f] + " " + famn(f, b.kinds[f]); }).join(", ") || "none") + ".",
      "Killed / injured named in reports (unverified, largest figure per incident): " + b.killed + " / " + b.injured + ".",
      "Districts: " + (b.dists.map(function (x) { return x.name + " " + x.n + (x.fresh ? " (new: none in the 4 weeks before)" : ""); }).join("; ") || "no attack placed in a district") + ".",
      "Naming the railway or a train: " + b.rail + "; a highway, bridge or checkpoint: " + b.road + "."];
    var p = W.OSAP_DSPEACE; if (p && p.status) L.push("Peace talks: " + (p.status.short || p.status.summary) + " (as of " + day(p.status.asof) + ").");
    L.push("Source: AXIOM OSAP Deep South tab. Reports are unverified; several outlets often report one attack and are counted once here.");
    return L.join("\n");
  }
  function briefHtml() {
    var b = brief(), p = W.OSAP_DSPEACE;
    return '<h3>Weekly brief</h3><div class="dsp-b" title="Counted by the page from this tab\'s reports. Not AI; not analyst-approved.">' +
      '<div class="cfm">7 days to ' + day(new Date(b.to).toISOString()) + ' · <span class="tag" title="Counted by the page from the reports below; no AI, not analyst-approved">Machine count</span></div>' +
      "<p><b>" + num(b.n) + "</b> attack incidents reported (" + num(b.reports) + " reports), " + esc(trend(b)) + ".</p>" +
      (b.n ? "<p>" + Object.keys(b.kinds).map(function (f) { return num(b.kinds[f]) + " " + esc(famn(f, b.kinds[f])); }).join(", ") + ". Killed / injured named in reports: " + num(b.killed) + " / " + num(b.injured) + ' <span class="cfm" style="display:inline">(unverified, largest figure per incident)</span>.</p>' : "") +
      (b.dists.length ? "<p>Districts: " + b.dists.map(function (x) { return esc(x.name) + " " + num(x.n) + (x.fresh ? ' <span class="dsp-new" title="No attack reported here in the 4 weeks before">new</span>' : ""); }).join("; ") + ".</p>" : "") +
      (b.rail || b.road ? "<p>Naming the railway or a train: " + num(b.rail) + "; a highway, bridge or checkpoint: " + num(b.road) + ".</p>" : "") +
      (p && p.status ? "<p>Peace talks: " + esc(p.status.short || p.status.summary) + ' <span class="tag claim" title="What officials and parties say">Claim</span></p>' : "") +
      '<button type="button" class="refresh" data-dspcopy="1">Copy brief</button></div>';
  }

  function patHtml() {
    var t0 = now(), a = attacks(), wk = {}, gs = groups(a.filter(function (i) { return t0 - parseT(i.date) <= 26 * 7 * DAY && parseT(i.date) <= t0 + 36e5; }));
    gs.forEach(function (g) { var w = Math.floor((t0 - parseT(g.date)) / (7 * DAY)); if (w >= 0 && w < 26) wk[w] = (wk[w] || 0) + 1; });
    var max = 1; for (var w = 0; w < 26; w++) max = Math.max(max, wk[w] || 0);
    var bars = ""; for (w = 25; w >= 0; w--) { var v = wk[w] || 0, hgt = Math.round(v / max * 44), x = (25 - w) * (100 / 26);
      bars += '<rect class="r" x="' + (x + 0.2).toFixed(2) + '%" y="' + (46 - hgt) + '" width="' + (100 / 26 - 0.4).toFixed(2) + '%" height="' + Math.max(hgt, v ? 1 : 0) + '"><title>Week to ' + day(new Date(t0 - w * 7 * DAY).toISOString()) + ": " + v + " attack incidents</title></rect>"; }
    var h = '<h3>Attack incidents per week</h3><div class="cfchart" role="img" aria-label="Attack incidents per week, past 26 weeks"><svg viewBox="0 0 100 56" preserveAspectRatio="none">' + bars +
      '</svg><div class="cfnote" style="display:flex;justify-content:space-between;margin:0"><span>26 weeks ago</span><span>max ' + num(max) + " a week</span><span>this week</span></div></div>";
    var inper = groups(a.filter(function (i) { return inP(i.date); })), byK = {}, byD = {}, nm = {};
    inper.forEach(function (g) { var k = g.lead.kind || "other"; byK[k] = (byK[k] || 0) + 1; var id = dist(g.lead); if (id) { byD[id] = (byD[id] || 0) + 1; nm[id] = dname(g.lead); } });
    var ks = Object.keys(byK).sort(function (x, y) { return byK[y] - byK[x]; }), ds = Object.keys(byD).sort(function (x, y) { return byD[y] - byD[x]; });
    h += "<details><summary>By kind, this period (" + num(inper.length) + " incidents)</summary><table>" + ks.map(function (k) { return "<tr><td>" + esc(kname(k)) + "</td><td>" + num(byK[k]) + "</td></tr>"; }).join("") + "</table></details>";
    h += "<details><summary>By district, this period (" + num(ds.length) + ")</summary><table>" + ds.slice(0, 20).map(function (id) { return "<tr><td>" + esc(nm[id]) + "</td><td>" + num(byD[id]) + "</td></tr>"; }).join("") + "</table></details>";
    return h + '<p class="cfnote">Counts of reported attacks, several reports of one incident counted once. Report times are when outlets published, not when an attack happened, so there is no hour-of-day chart.</p>';
  }

  function peaceHtml() {
    var p = W.OSAP_DSPEACE, h = "<h3>Peace talks</h3>";
    if (p) {
      if (p.status) h += "<p>" + esc(p.status.summary) + ' <span class="tag claim" title="What officials and parties say">Claim</span></p><div class="cfm">As of ' + day(p.status.asof) + " · " + srcs(p.status.evidence) + "</div>" + fpLine(p.status.fp);
      if ((p.parties || []).length) h += "<details><summary>Who is at the table (" + p.parties.length + ")</summary>" + p.parties.map(function (x) {
        return '<div style="margin:4px 0"><b>' + esc(x.name) + "</b> · " + esc(x.role) + '<div class="cfm">' + esc(x.note || "") + " " + srcs(x.evidence) + "</div>" + fpLine(x.fp) + "</div>"; }).join("") + "</details>";
      if ((p.rounds || []).length) h += "<details open><summary>Timeline (" + p.rounds.length + ")</summary><ol class=\"dsp-tl\">" + p.rounds.map(function (x) {
        return "<li><b>" + esc(x.when_label || day(x.date)) + "</b>" + (x.place ? " · " + esc(x.place) : "") + "<div>" + esc(x.what) + ' <span class="tag claim">Claim</span></div><div class="cfm">' + srcs(x.evidence) + "</div>" + fpLine(x.fp) + "</li>"; }).join("") + "</ol></details>";
    } else if (err) h += '<p class="cfbad">' + esc(err) + "</p>";
    else h += '<p class="cfm">Loading the tracker…</p>';
    var live = groups(items().filter(function (i) { return fam(i) === "talks" || i.kind === "peace_talks"; })).slice(0, 6);
    if (live.length) h += "<details><summary>Latest peace-talk reports on this tab (" + live.length + ")</summary><ol class=\"cfl\">" + live.map(function (g) { var i = g.lead;
      return '<li><a href="' + url(i.link) + '" target="_blank" rel="noopener noreferrer">' + esc(i.title_en || i.title) + '</a><div class="cfm">' + esc(i.outlet || "") + " · " + day(i.date) + "</div></li>"; }).join("") + "</ol></details>";
    return h;
  }

  /* ---------- corridors ---------- */
  var R = 6371.0088, rad = Math.PI / 180;
  function kmTo(lat, lon, line) {
    var c = Math.cos(lat * rad), best = Infinity;
    for (var i = 0; i < line.length - 1; i++) {
      var a = line[i], b = line[i + 1], ax = a[0] * c, bx = b[0] * c, px = lon * c, dx = bx - ax, dy = b[1] - a[1];
      var t = ((px - ax) * dx + (lat - a[1]) * dy) / (dx * dx + dy * dy || 1e-12); t = Math.max(0, Math.min(1, t));
      var qx = ax + t * dx, qy = a[1] + t * dy, d = Math.sqrt((px - qx) * (px - qx) + (lat - qy) * (lat - qy)) * rad * R;
      if (d < best) best = d;
    }
    return best;
  }
  function corrHtml() {
    var c = W.OSAP_DSC, h = '<h3>Railway and roads</h3><label style="display:block"><input type="checkbox" data-dspcorr="1"' + (st.corr ? " checked" : "") + (c ? "" : " disabled") +
      '> <b>Show the railway and main roads on the map</b></label>';
    var gs = groups(attacks().filter(function (i) { return inP(i.date); })), rl = [], rd = [];
    gs.forEach(function (g) { var tx = g.all.map(text).join(" "); if (RAIL.test(tx)) rl.push(g); else if (ROAD.test(tx)) rd.push(g); });
    function li(g) { var i = g.lead; return '<li><a href="' + url(i.link) + '" target="_blank" rel="noopener noreferrer">' + esc(i.title_en || i.title) + '</a><div class="cfm">' + esc(dname(i)) + " · " + day(i.date) + (g.all.length > 1 ? " · " + g.all.length + " reports" : "") + "</div></li>"; }
    h += "<details><summary>Attacks naming the railway or a train, this period (" + rl.length + ")</summary><ol class=\"cfl\">" + rl.slice(0, 20).map(li).join("") + "</ol></details>";
    h += "<details><summary>Attacks naming a highway, bridge or checkpoint, this period (" + rd.length + ")</summary><ol class=\"cfl\">" + rd.slice(0, 20).map(li).join("") + "</ol></details>";
    if (c) {
      var ev = ((data && data.ucdp) || []).filter(function (e) { return inP(e.date) && e.prec && e.prec <= 2 && e.lat != null && c.rail.some(function (r) { return kmTo(e.lat, e.lon, r.line) <= 2; }); });
      h += "<details><summary>UCDP events within 2 km of the railway, this period (" + ev.length + ")</summary><table>" + ev.slice(0, 30).map(function (e) {
        return "<tr><td>" + day(e.date) + "</td><td>" + esc(e.where || "") + '<div class="cfm">' + esc(String(e.headline || "").split(";")[0]) + "</div></td><td>" + num(e.best) + " dead</td></tr>"; }).join("") + "</table></details>";
    }
    return h + '<p class="cfnote">Lines: Natural Earth 1:10m (public domain), drawn for small-scale maps and often a kilometre or more off the real track or road; they carry no names. ' +
      "Report lists match words in the report text, so a report can name a road without the attack being on it. UCDP events are only counted when coded to an exact or near-exact place.</p>";
  }
  function ensure() { map = W.__asapMap; if (!map || !W.L) return false; if (!map.getPane("dscpane")) { map.createPane("dscpane"); map.getPane("dscpane").style.zIndex = 630; } return true; }
  function clear() { if (lyr && map) map.removeLayer(lyr); lyr = null; if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("cf-dsc", ""); }
  function draw() {
    clear(); var c = W.OSAP_DSC; if (!on || !st.corr || !c || !ensure()) return;
    var g = [], ll = function (l) { return l.map(function (p) { return [p[1], p[0]]; }); };
    c.roads.forEach(function (r) { g.push(L.polyline(ll(r.line), { pane: "dscpane", color: r.expressway ? "#e65100" : "#8d6e63", weight: r.expressway ? 3 : 2, opacity: 0.85, interactive: false })); });
    c.rail.forEach(function (r) {
      g.push(L.polyline(ll(r.line), { pane: "dscpane", color: "#212121", weight: 4, opacity: 0.9, interactive: false }));
      g.push(L.polyline(ll(r.line), { pane: "dscpane", color: "#fff", weight: 2, dashArray: "6 6", opacity: 1, interactive: false }));
    });
    lyr = L.layerGroup(g).addTo(map);
    if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("cf-dsc", '<div class="lg"><span class="sw" style="background:repeating-linear-gradient(90deg,#212121 0 6px,#fff 6px 12px);height:4px"></span><div>Railway (approximate)</div></div>' +
      '<div class="lg"><span class="sw" style="background:#e65100;height:3px"></span><div>Highway</div></div><div class="lg"><span class="sw" style="background:#8d6e63;height:3px"></span><div>Main road</div></div>');
  }

  /* ---------- panel ---------- */
  function panel() {
    var box = D.getElementById("dsp"); if (!box || !data) return;
    box.innerHTML = '<h3 style="margin-top:0">Patterns and peace talks</h3>' + briefHtml() + patHtml() + peaceHtml() + corrHtml();
  }
  function need() {
    if (pend) return pend;
    pend = Promise.all([W.OSAP_DSC ? 0 : load(CORR), W.OSAP_DSPEACE ? 0 : load(PEACE),
      areas ? 0 : fetch(AREAS).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) { areas = j.areas || []; areas.forEach(function (a) { aname[a.id] = a.name; }); })])
      .then(function () { err = ""; }, function (e) { err = "Could not load the peace talks or corridor data (" + (e && e.message) + ")."; pend = null; });
    return pend;
  }
  function open(d, r) {
    data = d; on = true;
    var sec = D.getElementById("dsp");
    if (!sec) { sec = D.createElement("div"); sec.className = "sec"; sec.id = "dsp"; var more = r.querySelector("#cf-more"); if (more) more.parentNode.insertBefore(sec, more); else r.appendChild(sec); }
    D.documentElement.classList.add("cf-dsp");
    panel(); draw();
    need().then(function () { if (!on) return; panel(); draw(); });
  }
  function close() { on = false; clear(); D.documentElement.classList.remove("cf-dsp"); }

  D.addEventListener("change", function (e) {
    var t = e.target; if (!t || !t.hasAttribute || !t.hasAttribute("data-dspcorr")) return;
    st.corr = t.checked; save(); draw();
  });
  D.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("[data-dspcopy]"); if (!b || !data) return;
    var tx = briefText(brief()), done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy brief"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tx).then(done, function () { W.prompt("Copy the brief:", tx); });
    else W.prompt("Copy the brief:", tx);
  });

  var css = D.createElement("style");
  css.textContent = "html.cf-dsp #map .leaflet-map-pane>.leaflet-dscpane-pane{visibility:visible!important}" +
    "#dsp h3{font-size:13px;margin:10px 0 4px}#dsp table{width:100%;font-size:12px}#dsp td{padding:2px 4px 2px 0;vertical-align:top}#dsp td:last-child{text-align:right;white-space:nowrap}" +
    ".dsp-b{border:1px solid var(--line,#ccc);border-radius:6px;padding:6px 8px}.dsp-b p{margin:4px 0;font-size:13px}" +
    ".dsp-new{font-size:10px;font-weight:600;color:#fff;background:#c62828;border-radius:3px;padding:0 4px}" +
    ".dsp-tl{margin:4px 0;padding-left:18px;font-size:12px}.dsp-tl li{margin:4px 0}";
  D.head.appendChild(css);

  W.OSAP_DSPAT = { _brief: function () { return data ? brief() : null; }, _briefText: function () { return data ? briefText(brief()) : ""; }, _kmTo: kmTo };
  (W.OSAP_CF_HOOKS = W.OSAP_CF_HOOKS || []).push({
    render: function (c, d, r) { if (!c || c.id !== ID || !r) { if (on) close(); return; } open(d, r); },
    clear: function () { close(); data = null; }
  });
})();
