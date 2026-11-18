/* AXIOM OSAP: the report builder (Shane 2026-11-18: "The user/analyst can save reports, data, screen shots from axiom and add
   them to a sandbox inside OSAP. This feature will template the product"; "The formatting and quality/completeness needs to be
   unmatched. Including product rules like north seeking arrow, map scale, legend, source referencing per item"; "For maps we
   would need a build in snip tool that can automatically add the snip to the sandbox").
   - Map snip: draw a box (or circle or lasso) and tap "Snip to report" in the Area menu, or "Snip this view" here. The snip is
     data, not a screenshot: the area, the base map and every item inside it, each with its title, link, publisher, publish and
     capture times, claim status and SHA-256 fingerprint (the same fingerprints as the Area report). Its picture is drawn from
     that data by the Area report's own map code (assets/osap-areareport.js) with a north arrow, scale bar, a key that lists
     only the symbols on the map, a latitude and longitude grid, the as-of time and the base map credit. "Re-render" snips the
     same area again with today's data as a new version that names the one it replaces; the old one is kept.
   - Sandbox: the snips and sources of the open workspace (localStorage "osap-rb", carried with workspaces, teams and cases by
     assets/osap-ws.js and assets/osap-sync.js). Saved items from My work can be added as sources.
   - Product: a SITREP with header, BLUF, situation, key judgments (ICD 203 likelihood word and confidence, cited), figures,
     gaps, outlook and numbered sources. Citations are [S1] for a source, [F1] for a figure and [F1.I3] for one item on it.
   - QC check (assets/osap-rb-core.js): fixed rules, shown live. Export PDF only after it passes, or with a stated override
     reason, and with warnings acknowledged. Each export is a numbered version with its SHA-256, printed in the QC annex.
   Nothing here changes a record, a claim status, a grade or the drawn area (except "Snip this view" and "Re-render", which
   draw the area being snipped, as the analyst asked), and nothing is sent anywhere except base map tile requests. No AI. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&](watchscan|wopen)=/.test(W.location.search)) return;
  var KEY = "osap-rb", UIK = "osap-rb-ui", MAX_BYTES = 1.8e6;
  var C = W.OSAP_RB_CORE; if (!C) return;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function A() { return W.TSAP && W.TSAP.areaApi; }
  function AR() { return W.OSAP_AREAREPORT && W.OSAP_AREAREPORT._snipMap ? W.OSAP_AREAREPORT : null; }
  function SYM() { return W.OSAP_SYM && W.OSAP_SYM.d ? W.OSAP_SYM : null; }
  function dual(ms) { if (!ms) return ""; try { return W.OSAP_TIME.dualT(ms, { date: true }); } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }
  function grid(lat, lon) { try { var g = W.OSAP_GEO && W.OSAP_GEO.mgrs(lat, lon, 5); if (g) return g; } catch (e) {} return (+lat).toFixed(5) + ", " + (+lon).toFixed(5); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function sha(text) {
    if (!(W.crypto && crypto.subtle && W.TextEncoder)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(hex, function () { return ""; });
  }
  function host(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(u || ""); return m ? m[1].replace(/^www\./, "") : ""; }
  function uid(p) { var b = new Uint8Array(4); try { crypto.getRandomValues(b); } catch (e) {} return p + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return (x % 36).toString(36); }).join(""); }

  /* ---------- store ---------- */
  function load() { var s = null; try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {} return C.normStore(s); }
  var ST = load();
  function save() {
    var txt = JSON.stringify(ST);
    if (txt.length > MAX_BYTES) { toast("The report sandbox is full (" + Math.round(txt.length / 1e3) + " kB). Delete old snips first."); return false; }
    try { localStorage.setItem(KEY, txt); return true; } catch (e) { toast("This browser would not store the report sandbox (storage full or blocked)."); return false; }
  }
  /* another tab, a workspace switch or a team sync changed the store */
  W.addEventListener("storage", function (e) { if (e.key === KEY) { ST = load(); if (isOpen() && !busyTyping()) render(); } });
  function clipsById() { var m = {}; ST.clips.forEach(function (c) { m[c.id] = c; }); return m; }
  function prod(id) { return ST.products.filter(function (p) { return p.id === id; })[0] || null; }
  function ui() { try { return JSON.parse(localStorage.getItem(UIK) || "{}") || {}; } catch (e) { return {}; } }
  function setUi(o) { try { localStorage.setItem(UIK, JSON.stringify(Object.assign(ui(), o))); } catch (e) {} }

  var tEl = null, tT = 0;
  function toast(msg) {
    if (!tEl) { tEl = D.createElement("div"); tEl.className = "rbtoast"; tEl.setAttribute("role", "status"); tEl.setAttribute("aria-live", "polite"); D.body.appendChild(tEl); }
    tEl.textContent = msg; tEl.hidden = false; clearTimeout(tT); tT = setTimeout(function () { tEl.hidden = true; }, 5200);
  }

  /* ---------- snipping ---------- */
  function itemFp(it) {
    var a = A();
    if (it.rec) { var h = a.fingerprints && a.fingerprints()[it.rec.id]; return h ? Promise.resolve(h) : Promise.resolve(a.fingerprint ? a.fingerprint(it.rec) : "").then(null, function () { return ""; }); }
    if (it.obj) return sha(JSON.stringify({ name: it.title, kind: it.kindName || it.group, lat: +it.lat.toFixed(5), lon: +it.lon.toFixed(5), url: it.url }));
    return sha(JSON.stringify({ title: it.title, source: it.src, time: it.when, url: it.url }));
  }
  function countryLabel() { var a = A(), cc = W.TSAP && W.TSAP.country; try { return cc ? a.countryName(cc).replace(/^\S+\s/, "") : ""; } catch (e) { return cc || ""; } }
  /* snip the drawn area: returns a promise of the new clip, or null with the reason toasted */
  function snipArea(opts) {
    opts = opts || {};
    var a = A(), ar = AR();
    if (!a || !ar) { toast("The map is still loading."); return Promise.resolve(null); }
    var P = a.area();
    if (!P || P.length < 3) { toast("Draw a box on the map first (Area menu > Draw), then tap Snip to report."); return Promise.resolve(null); }
    var c = ar._collect(); if (!c) { toast("Nothing to snip yet: the area summary is still loading."); return Promise.resolve(null); }
    /* incidents first, then other reports, then map objects; only items the snip keeps are drawn, so every mark has its source */
    var s = SYM(), all = c.inc.concat(c.rep, c.obj), items = all.slice(0, C.LIMITS.snipItems), cut = all.length - items.length;
    var marks = items.filter(function (it) { return it.lat != null && isFinite(it.lat); }).map(function (it) {
      var m = ar._mark(it); if (m.sym && !(s && s.d[m.sym])) m.sym = ""; return m;
    });
    var b = opts.base || ui().base || ar._base(), r = ar._snipMap(P, marks, "Map snip", b);
    return Promise.all(items.map(function (it) { return itemFp(it).then(null, function () { return ""; }); })).then(function (fps) {
      var now = Date.now();
      items.forEach(function (it, i) { it.fp = fps[i]; it.claim = !!(it.rec && it.rec.type === "claim"); });
      var snip = C.makeSnip({ id: uid("c"), P: P, base: r.base, baseAttr: r.attr, cc: (W.TSAP && W.TSAP.country) || "", country: countryLabel(), period: c.g.period,
        caption: opts.caption || "", legend: r.keys, dots: r.dots, dropped: r.dropped + cut, marks: marks, items: items, supersedes: opts.supersedes || null }, now);
      return sha(C.snipDigestInput(snip)).then(function (h) {
        snip.digest = h; ST.clips.unshift(snip);
        if (!save()) { ST.clips.shift(); return null; }
        return snip;
      });
    });
  }
  /* the current map view as a box, drawn as the area (the analyst asked for it), then snipped */
  function snipView() {
    var map = W.__asapMap, a = A();
    if (!map || !a) { toast("The map is still loading."); return Promise.resolve(null); }
    var bb = map.getBounds(), n = bb.getNorth(), s = bb.getSouth(), e = bb.getEast(), w = bb.getWest();
    var P = [[s, w], [s, e], [n, e], [n, w]];
    a.setArea(P);
    return new Promise(function (ok) { setTimeout(function () { snipArea().then(ok); }, 500); });
  }
  function rerender(id) {
    var old = clipsById()[id], a = A(); if (!old || !a) return Promise.resolve(null);
    a.setArea(old.P);
    return new Promise(function (ok) { setTimeout(function () { snipArea({ base: old.base, caption: old.caption, supersedes: old.id }).then(ok); }, 500); }).then(function (nw) {
      if (!nw) return null;
      /* figures that showed the old snip now show the new one; the old snip stays in the sandbox as the earlier version */
      ST.products.forEach(function (p) { p.figs.forEach(function (f) { if (f.clip === old.id) { f.clip = nw.id; p.updated = Date.now(); } }); });
      save(); return nw;
    });
  }

  /* ---------- drawing a snip: the Area report's map, plus the grid and the as-of stamp ---------- */
  function niceStep(span) { var n = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30], b = n[0]; n.forEach(function (x) { if (span / x >= 2.5) b = x; }); return b; }
  function fmtDeg(v, pos, neg) { var a = Math.abs(v), d = a >= 1 || a === 0 ? (a % 1 === 0 ? a.toFixed(0) : a.toFixed(a * 100 % 1 === 0 ? 2 : 3)) : a.toFixed(3); return d.replace(/\.?0+$/, "") + "°" + (v >= 0 ? pos : neg); }
  function gridSvg(F, asOf) {
    var Z = 256 * Math.pow(2, F.z);
    function lonAt(x) { return (F.x0 + x) / Z * 360 - 180; }
    function latAt(y) { var n = Math.PI - 2 * Math.PI * (F.y0 + y) / Z; return Math.atan(Math.sinh(n)) * 180 / Math.PI; }
    var w0 = lonAt(0), w1 = lonAt(F.w), n0 = latAt(0), s0 = latAt(F.h), st = niceStep(Math.min(w1 - w0, n0 - s0)), out = "", lab = "";
    for (var lo = Math.ceil(w0 / st) * st; lo < w1; lo += st) {
      var x = F.px(n0, lo)[0]; out += "M" + x.toFixed(1) + " 0V" + F.h;
      if (x > 190 && x < F.w - 48) lab += '<text x="' + x.toFixed(1) + '" y="11" text-anchor="middle">' + esc(fmtDeg(+lo.toFixed(6), "E", "W")) + "</text>";
    }
    for (var la = Math.ceil(s0 / st) * st; la < n0; la += st) {
      var y = F.px(la, w0)[1]; out += "M0 " + y.toFixed(1) + "H" + F.w;
      if (y > 30 && y < F.h - 36) lab += '<text x="3" y="' + (y - 2).toFixed(1) + '">' + esc(fmtDeg(+la.toFixed(6), "N", "S")) + "</text>";
    }
    var stamp = '<g transform="translate(4,4)"><rect width="178" height="17" rx="2" fill="#fff" fill-opacity=".88" stroke="#12324a" stroke-width=".6"/>' +
      '<text x="5" y="12" font-size="9.5" font-weight="700" fill="#12324a">AS OF ' + esc(C.dtg(asOf)) + " · WGS 84</text></g>";
    return '<svg class="rbgrid" viewBox="0 0 ' + F.w + " " + F.h + '" aria-hidden="true" font-family="system-ui,sans-serif"><path d="' + out + '" stroke="#1b232b" stroke-opacity=".32" stroke-width=".7" fill="none"/>' +
      '<g font-size="8.5" fill="#1b232b" stroke="#fff" stroke-width="2.4" paint-order="stroke">' + lab + "</g>" + stamp + "</svg>";
  }
  function drawSnip(c, cap) {
    var ar = AR(); if (!ar) return { html: '<p class="obs">The map renderer is still loading.</p>', legend: "" };
    var r = ar._snipMap(c.P, c.marks, cap || c.caption || "Map snip", c.base);
    /* the grid goes under the area outline and marks: insert it before the overlay */
    var html = r.html.replace('<svg class="arpover"', gridSvg(r.F, c.dataAsOf || c.captured) + '<svg class="arpover"');
    return { html: html, legend: r.legend, keys: r.keys, attr: r.attr };
  }
  function corners(c) {
    var la = c.P.map(function (p) { return p[0]; }), lo = c.P.map(function (p) { return p[1]; });
    var n = Math.max.apply(null, la), s = Math.min.apply(null, la), e = Math.max.apply(null, lo), w = Math.min.apply(null, lo);
    return { ctr: grid((n + s) / 2, (e + w) / 2), nw: grid(n, w), se: grid(s, e) };
  }

  /* ---------- the overlay ---------- */
  var el = null, CUR = null, VIEW = "edit", LAST_QC = [];
  function isOpen() { return !!(el && !el.hidden && el.querySelector(".rb")); }
  function busyTyping() { var f = D.activeElement; return !!(f && el && el.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)); }
  function open(opts) {
    opts = opts || {};
    el = D.getElementById("brief"); if (!el) return false;
    if (!el.__rb) { el.__rb = 1; el.addEventListener("click", onClick); el.addEventListener("input", onInput); el.addEventListener("change", onChange);
      /* a base map tile that does not load (offline, blocked) is hidden, so the outlines underneath show instead of a broken image */
      el.addEventListener("error", function (e) { var t = e.target; if (t && t.classList && t.classList.contains("arpt")) t.style.visibility = "hidden"; }, true); }
    ST = load();
    CUR = opts.product || CUR || ui().cur || (ST.products[0] && ST.products[0].id) || null;
    if (CUR && !prod(CUR)) CUR = ST.products[0] ? ST.products[0].id : null;
    VIEW = "edit";
    el.hidden = false; D.documentElement.classList.add("briefing");
    render();
    var h = el.querySelector(".rb h2"); if (h && h.focus) h.focus();
    return true;
  }
  function close() { if (!el) return; el.hidden = true; el.innerHTML = ""; D.documentElement.classList.remove("briefing"); }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen() && !busyTyping()) close(); });

  function sel(name, list, v, ph) {
    return '<select data-rb="' + name + '"><option value="">' + esc(ph) + "</option>" + list.map(function (x) {
      return '<option value="' + x[0] + '"' + (x[0] === v ? " selected" : "") + ">" + esc(x[1] + (x[2] && x[2].length < 12 ? " (" + x[2] + ")" : "")) + "</option>"; }).join("") + "</select>";
  }
  function clipRow(c, p) {
    var inP = p && p.figs.some(function (f) { return f.clip === c.id; }), newer = ST.clips.some(function (x) { return x.supersedes === c.id; });
    return '<li class="rbclip" data-clip="' + esc(c.id) + '"><div class="rbct"><b>Map snip</b> · ' + esc(c.country || "Map") + " · " + c.marks.length + " marks · " + c.items.length + " items</div>" +
      '<div class="rbcm">Snipped ' + esc(dual(c.captured)) + (c.period ? " · " + esc(c.period) : "") + (newer ? ' · <span class="rbold">earlier version</span>' : "") + (c.supersedes ? " · re-render" : "") + "</div>" +
      '<div class="rbca">' + (p ? '<button type="button" class="mini" data-rba="addfig"' + (inP ? " disabled" : "") + ">" + (inP ? "In product" : "Add to product") + "</button> " : "") +
      '<button type="button" class="mini" data-rba="rerender">Re-render</button> <button type="button" class="mini" data-rba="delclip">Delete</button></div></li>';
  }
  function sandboxHtml(p) {
    var snips = ST.clips.filter(function (c) { return c.kind === "snip"; });
    return '<section class="rbsb noprint" aria-label="Report sandbox"><h3>Sandbox</h3>' +
      '<p class="rbhint">Snips stay here until you delete them. Each one keeps every item\'s source link, times and SHA-256.</p>' +
      '<div class="rbbtns"><button type="button" class="refresh" data-rba="sniparea">Snip drawn area</button> <button type="button" class="refresh" data-rba="snipview">Snip this view</button></div>' +
      (snips.length ? '<ul class="rbclips">' + snips.map(function (c) { return clipRow(c, p); }).join("") + "</ul>" : '<p class="obs">No snips yet. Draw a box on the map and tap Snip to report, or Snip this view.</p>') +
      '<h3>Products</h3><ul class="rbprods">' + ST.products.map(function (x) {
        return '<li><button type="button" class="rbpl' + (p && x.id === p.id ? " on" : "") + '" data-rba="pick" data-p="' + esc(x.id) + '"><b>' + esc(x.title || "Untitled " + C.TEMPLATES[x.tpl].name) + "</b><span>" + esc(x.no) + (x.releases.length ? " · v" + x.releases.length : " · draft") + "</span></button></li>";
      }).join("") + '</ul><button type="button" class="refresh" data-rba="new">New SITREP</button></section>';
  }
  function txtArea(name, val, rows, ph) { return '<textarea data-rb="' + name + '" rows="' + rows + '" placeholder="' + esc(ph) + '">' + esc(val) + "</textarea>"; }
  function srcLine(s, i) {
    return '<li data-src="' + i + '"><div class="rbsr"><b>[S' + (i + 1) + ']</b> <input data-rb="src.title" value="' + esc(s.title) + '" placeholder="Title" aria-label="Source title">' +
      '<input data-rb="src.url" value="' + esc(s.url) + '" placeholder="https://" aria-label="Link">' +
      '<input data-rb="src.src" value="' + esc(s.src) + '" placeholder="Publisher" aria-label="Publisher">' +
      sel("src.stype", C.SRC_TYPES.map(function (t) { return [t[0], t[1]]; }), s.stype, "Source type") +
      '<input data-rb="src.pub" type="datetime-local" value="' + esc(s.pub ? new Date(s.pub).toISOString().slice(0, 16) : "") + '" aria-label="Published (UTC)" title="Published (UTC)">' +
      '<button type="button" class="mini" data-rba="delsrc">Remove</button></div>' +
      '<div class="rbcm">Captured ' + esc(dual(s.cap)) + " · SHA-256 " + esc(s.fp || "computing…") + (s.status ? " · " + esc(s.status) : "") + "</div></li>";
  }
  function figEdit(f, i, byId) {
    var c = byId[f.clip]; if (!c) return '<li class="rbfig" data-fig="' + i + '"><p class="obs">Figure ' + (i + 1) + ': its snip was deleted.</p><button type="button" class="mini" data-rba="delfig">Remove</button></li>';
    var d = drawSnip(c, f.caption);
    return '<li class="rbfig" data-fig="' + i + '"><div class="rbfh"><b>[F' + (i + 1) + ']</b> <input data-rb="fig.caption" value="' + esc(f.caption || "") + '" placeholder="Caption: what the map shows and why it matters" aria-label="Figure ' + (i + 1) + ' caption">' +
      '<button type="button" class="mini" data-rba="figup"' + (i ? "" : " disabled") + ' aria-label="Move up">↑</button><button type="button" class="mini" data-rba="delfig">Remove</button></div>' +
      '<div class="arpfig">' + d.html + "<aside><h4>Key</h4>" + d.legend + "</aside></div>" +
      '<p class="rbcm">' + c.items.length + " items, each cited as [F" + (i + 1) + ".I1], [F" + (i + 1) + ".R1], [F" + (i + 1) + ".M1]… · snipped " + esc(dual(c.captured)) + "</p></li>";
  }
  function editorHtml(p) {
    if (!p) return '<section class="rbed"><h3>No product yet</h3><p class="bm">Start a SITREP, then add snips from the sandbox and write the bottom line. The QC check tells you what is missing before anything exports.</p>' +
      '<button type="button" class="refresh primary" data-rba="new">New SITREP</button></section>';
    var byId = clipsById(), b = p.blocks;
    return '<section class="rbed" aria-label="Product editor">' +
      '<div class="rbhd"><label>Title<input data-rb="title" value="' + esc(p.title) + '" maxlength="140" placeholder="e.g. Strait of Hormuz: tanker strikes, 17-18 Nov"></label>' +
      '<label>Area of interest<input data-rb="aoi" value="' + esc(p.aoi) + '" placeholder="Country or area"></label>' +
      '<label>Author or call sign<input data-rb="author" value="' + esc(p.author) + '" maxlength="60"></label>' +
      '<label>As of (UTC)<span class="rbrow"><input data-rb="asOf" type="datetime-local" value="' + esc(new Date(p.asOf).toISOString().slice(0, 16)) + '"><button type="button" class="mini" data-rba="now">Now</button></span><small>' + esc(C.dtg(p.asOf)) + " · " + esc(dual(p.asOf)) + "</small></label>" +
      '<label class="rbwide">Handling line<input data-rb="handling" value="' + esc(p.handling) + '"></label><p class="rbcm">' + esc(p.no) + (p.releases.length ? " · last export v" + p.releases.length + " " + esc(C.dtg(p.releases[p.releases.length - 1].at)) : " · not exported yet") + "</p></div>" +
      '<h3>1. Bottom line up front</h3>' + txtArea("b.bluf", b.bluf.text, 3, "What happened, why it matters, what comes next. Cite as [S1] or [F1.I2].") +
      '<h3>2. Situation</h3>' + txtArea("b.situation", b.situation.text, 6, "What the sources report, attributed. Government figures are claims: say whose figure it is.") +
      '<h3>3. Key judgments</h3><ol class="rbkjs">' + p.kjs.map(function (k, i) {
        return '<li data-kj="' + i + '">' + txtArea("kj.text", k.text, 2, "The judgment, with its sources [S1]") + '<div class="rbrow">' +
          sel("kj.lik", C.LIKELIHOOD, k.lik, "Likelihood (ICD 203)") + sel("kj.conf", C.CONFIDENCE.map(function (c) { return [c[0], c[1]]; }), k.conf, "Confidence") +
          '<button type="button" class="mini" data-rba="delkj">Remove</button></div></li>';
      }).join("") + '</ol><button type="button" class="mini" data-rba="addkj">+ Key judgment</button>' +
      '<h3>4. Maps and figures</h3>' + (p.figs.length ? '<ol class="rbfigs">' + p.figs.map(function (f, i) { return figEdit(f, i, byId); }).join("") + "</ol>" : '<p class="obs">No figures. Add a snip from the sandbox.</p>') +
      '<h3>5. Intelligence gaps</h3>' + txtArea("b.gaps", b.gaps.text, 3, "What is not known, and what would change the judgments") +
      '<h3>6. Outlook and indicators to watch</h3>' + txtArea("b.outlook", b.outlook.text, 3, "Indicators and the time frame") +
      '<h3>Sources</h3><ol class="rbsrcs">' + p.srcs.map(srcLine).join("") + "</ol>" +
      '<div class="rbrow"><button type="button" class="mini" data-rba="addsrc">+ Source link</button> <button type="button" class="mini" data-rba="addwork">+ Saved items from My work</button></div>' +
      '<h3>Data statistics</h3>' + statsHtml(C.stats(p, byId)) +
      "</section>";
  }
  function qcHtml(list) {
    var s = C.qcSummary(list);
    return '<section class="rbqc noprint" aria-label="QC check" aria-live="polite"><h3>QC check</h3>' +
      '<p class="rbqs ' + (s.pass ? (s.warns ? "w" : "ok") : "b") + '">' + (s.pass ? (s.warns ? "Passes, with " + s.warns + " warning" + (s.warns === 1 ? "" : "s") + " to acknowledge" : "Passes: ready to export") : s.blocks + " to fix before export" + (s.warns ? ", " + s.warns + " warning" + (s.warns === 1 ? "" : "s") : "")) + "</p>" +
      '<ul class="rbql">' + list.map(function (x) { return '<li class="' + x.sev + '"><span class="rbqi">' + (x.sev === "block" ? "Fix" : "Warn") + "</span> <b>" + esc(x.where) + ":</b> " + esc(x.msg) + ' <span class="rbqid">' + esc(x.id) + "</span></li>"; }).join("") + "</ul>" +
      (s.warns ? '<label class="rbck"><input type="checkbox" data-rb="ack"> I have read the warnings</label>' : "") +
      (s.pass ? "" : '<label class="rbov">Export anyway: why (recorded in the product)<textarea data-rb="override" rows="2" placeholder="At least 10 characters"></textarea></label>') +
      '<button type="button" class="refresh primary" data-rba="export">Export PDF</button> <span class="rbcm" data-rb-msg></span>' +
      '<details><summary>Rules this check applies</summary><p class="rbcm">Header: title, product number, as-of DTG, handling line, area, author. Analysis: BLUF (4 sentences, cited); every key judgment has an ICD 203 likelihood word, a confidence level and citations, and no hedging words; gaps and outlook. Sourcing: every citation resolves; every source has a link, publisher type, publish time and SHA-256; figures in the situation are cited. Maps: caption, area, base map credit, capture time, a key that lists exactly the symbols shown, readable density, snips no older than 24 h before the as-of time. AI: no AI-drafted text leaves without analyst approval.</p></details></section>';
  }
  function render() {
    if (!el) return;
    var p = CUR ? prod(CUR) : null, list = p ? C.qc(p, clipsById(), Date.now()) : [];
    LAST_QC = list;
    el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh" data-rba="close">Close</button> <span class="obs">Report builder: snips and sources in the sandbox, one product at a time. Kept in this workspace on this device.</span></div>' +
      '<div class="rb arp"><h2 tabindex="-1">Report builder</h2><div class="rbgridl">' + sandboxHtml(p) + editorHtml(p) + (p ? qcHtml(list) : "") + "</div></div>";
  }
  /* refresh the QC panel only, so typing keeps its place */
  function refreshQc() {
    var p = CUR && prod(CUR), box = el && el.querySelector(".rbqc"); if (!p || !box) return;
    var ack = box.querySelector('[data-rb="ack"]'), ov = box.querySelector('[data-rb="override"]'), a = ack && ack.checked, o = ov ? ov.value : "";
    var list = C.qc(p, clipsById(), Date.now()); LAST_QC = list;
    var tmp = D.createElement("div"); tmp.innerHTML = qcHtml(list); box.replaceWith(tmp.firstChild);
    box = el.querySelector(".rbqc"); ack = box.querySelector('[data-rb="ack"]'); ov = box.querySelector('[data-rb="override"]');
    if (ack) ack.checked = a; if (ov) ov.value = o;
  }

  /* ---------- editing ---------- */
  var saveT = 0;
  function touch(p, now) { p.updated = now || Date.now(); clearTimeout(saveT); saveT = setTimeout(save, 400); }
  function srcFp(s) { return sha(C.canon({ title: s.title, url: s.url, source: s.src, published: s.pub || null })); }
  function onInput(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute("data-rb"); if (!k || !isOpen()) return;
    var p = CUR && prod(CUR); if (!p) return;
    if (k === "ack" || k === "override") return;
    var li;
    if (k === "title" || k === "aoi" || k === "author" || k === "handling") p[k] = t.value.slice(0, k === "handling" ? 300 : 140);
    else if (k === "asOf") { var ms = Date.parse(t.value + "Z"); if (isFinite(ms)) p.asOf = ms; }
    else if (k.indexOf("b.") === 0) { var bk = k.slice(2); p.blocks[bk].text = t.value.slice(0, 6000); if (p.blocks[bk].origin === "ai") p.blocks[bk].approved = false; }
    else if (k.indexOf("kj.") === 0 && (li = t.closest("[data-kj]"))) { var kj = p.kjs[+li.getAttribute("data-kj")]; if (kj) kj[k.slice(3)] = t.value.slice(0, 1200); }
    else if (k === "fig.caption" && (li = t.closest("[data-fig]"))) { var f = p.figs[+li.getAttribute("data-fig")]; if (f) f.caption = t.value.slice(0, 400); }
    else if (k.indexOf("src.") === 0 && (li = t.closest("[data-src]"))) {
      var s = p.srcs[+li.getAttribute("data-src")]; if (!s) return;
      var f2 = k.slice(4);
      if (f2 === "pub") { var pm = Date.parse(t.value + "Z"); s.pub = isFinite(pm) ? pm : null; } else s[f2] = t.value.slice(0, 400);
      if (f2 === "url") s.url = C.safeUrl(t.value.trim()) || t.value.trim().slice(0, 400);
      if (f2 !== "stype") { s.fp = ""; srcFp(s).then(function (h) { s.fp = h; save(); var m = li.querySelector(".rbcm"); if (m) m.textContent = "Captured " + dual(s.cap) + " · SHA-256 " + (h || "not available in this browser"); refreshQc(); }); }
    }
    touch(p); refreshQc();
  }
  function onChange(e) { var k = e.target && e.target.getAttribute && e.target.getAttribute("data-rb"); if (k && /^(kj\.|src\.stype|asOf)/.test(k)) { if (k === "asOf") render(); } }
  function addSource(p, s) {
    s.cap = s.cap || Date.now(); p.srcs.push(s);
    return (s.fp ? Promise.resolve(s.fp) : srcFp(s)).then(function (h) { s.fp = h; });
  }
  function workItems() {
    var W0 = W.OSAP_WORK, o = W0 && W0.items ? W0.items() : {}, out = [];
    Object.keys(o).forEach(function (k) { var it = o[k]; if (it && it.saved && it.snap && it.snap.title) out.push(it); });
    return out;
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-rba]"); if (!b || !isOpen()) return;
    var act = b.getAttribute("data-rba"), p = CUR && prod(CUR), now = Date.now(), li;
    if (act === "close") return close();
    if (act === "new") {
      var np = C.newProduct(ST, "sitrep", { id: uid("p"), aoi: countryLabel(), author: ui().author || "" }, now);
      np.kjs.push(C.newKj(now)); ST.products.unshift(np); CUR = np.id; setUi({ cur: CUR }); save(); return render();
    }
    if (act === "pick") { CUR = b.getAttribute("data-p"); setUi({ cur: CUR }); return render(); }
    if (act === "sniparea" || act === "snipview") {
      b.disabled = true; b.textContent = "Snipping…";
      return (act === "sniparea" ? snipArea() : snipView()).then(function (c) {
        if (c) { toast("Snipped " + c.items.length + " items to the report sandbox."); if (p && !p.figs.length) { p.figs.push({ clip: c.id, caption: "" }); touch(p); } }
        open({ product: CUR });
      });
    }
    li = b.closest("[data-clip]");
    if (act === "rerender" && li) { b.disabled = true; b.textContent = "Re-rendering…"; return rerender(li.getAttribute("data-clip")).then(function (c) { if (c) toast("Re-rendered with today's data. The earlier version is kept."); open({ product: CUR }); }); }
    if (act === "delclip" && li) {
      var id = li.getAttribute("data-clip"), used = ST.products.filter(function (x) { return x.figs.some(function (f) { return f.clip === id; }); });
      if (used.length && b.getAttribute("data-sure") !== "1") { b.setAttribute("data-sure", "1"); b.textContent = "Used in " + used.length + " product" + (used.length === 1 ? "" : "s") + ": tap again"; return; }
      ST.clips = ST.clips.filter(function (c) { return c.id !== id; }); save(); return render();
    }
    if (act === "addfig" && li && p) { p.figs.push({ clip: li.getAttribute("data-clip"), caption: "" }); touch(p); save(); return render(); }
    if (!p) return;
    if (act === "now") { p.asOf = now; touch(p); return render(); }
    if (act === "addkj") { p.kjs.push(C.newKj(now)); touch(p); return render(); }
    if (act === "delkj" && (li = b.closest("[data-kj]"))) { p.kjs.splice(+li.getAttribute("data-kj"), 1); touch(p); return render(); }
    if (act === "delfig" && (li = b.closest("[data-fig]"))) { p.figs.splice(+li.getAttribute("data-fig"), 1); touch(p); return render(); }
    if (act === "figup" && (li = b.closest("[data-fig]"))) { var i = +li.getAttribute("data-fig"); if (i > 0) { var f = p.figs.splice(i, 1)[0]; p.figs.splice(i - 1, 0, f); touch(p); } return render(); }
    if (act === "delsrc" && (li = b.closest("[data-src]"))) { p.srcs.splice(+li.getAttribute("data-src"), 1); touch(p); return render(); }
    if (act === "addsrc") { addSource(p, { title: "", url: "", src: "", stype: "", pub: null }).then(function () { touch(p); save(); render(); }); return; }
    if (act === "addwork") {
      var have = {}; p.srcs.forEach(function (s) { if (s.url) have[s.url] = 1; if (s.fp) have[s.fp] = 1; });
      var add = workItems().filter(function (it) { return !(it.snap.url && have[it.snap.url]) && !(it.snap.fp && have[it.snap.fp]); });
      if (!add.length) { toast("No new saved items in My work. Save a story there first (Save on any report)."); return; }
      Promise.all(add.map(function (it) {
        var s = it.snap, ts = Date.parse(s.ts) || (W.OSAP_TIME && W.OSAP_TIME.parseT(s.ts)) || null;
        return addSource(p, { title: s.title, url: C.safeUrl(s.url), src: s.source, stype: /claim|state media/i.test(s.status) ? "official" : /observ/i.test(s.status) ? "sensor" : "media",
          pub: isFinite(ts) ? ts : null, status: s.status, fp: /^[0-9a-f]{16,64}$/.test(s.fp || "") ? s.fp : "", grade: it.grade && W.OSAP_GRADE ? W.OSAP_GRADE.code(it.grade) : "" });
      })).then(function () { touch(p); save(); toast("Added " + add.length + " saved item" + (add.length === 1 ? "" : "s") + " from My work as sources."); render(); });
      return;
    }
    if (act === "export") return exportPdf(p, b);
  }

  /* ---------- the finished product ---------- */
  var LBL = { official: "Official: a claim", "state-media": "State media", social: "Social media, unverified", sensor: "Instrument reading", "open-data": "Open data", wire: "Wire", media: "News media", independent: "Independent", other: "Other" };
  function citeHtml(text) {
    return esc(text).replace(/\[((?:S\d{1,3}|F\d{1,2}(?:\.[IRM]\d{1,4})?)(?:\s*[,;]\s*(?:S\d{1,3}|F\d{1,2}(?:\.[IRM]\d{1,4})?))*)\]/g, function (m, g) {
      return "[" + g.split(/\s*[,;]\s*/).map(function (r) { return '<a class="arpc" href="#rbr-' + r.replace(".", "-") + '">' + r + "</a>"; }).join(", ") + "]";
    });
  }
  function paras(text) { return String(text || "").split(/\n\s*\n|\n/).filter(function (x) { return x.trim(); }).map(function (x) { return '<p class="bm">' + citeHtml(x.trim()) + "</p>"; }).join(""); }
  function originTag(bk) { return bk && bk.origin === "ai" ? ' <span class="aitag">AI generated, approved by the analyst</span>' : ""; }
  function productHtml(p, rel) {
    var byId = clipsById(), b = p.blocks, T = C.TEMPLATES[p.tpl];
    var head = '<div class="rbhand">' + esc(p.handling) + "</div>" +
      '<header class="rbph"><div><div class="rbpk">' + esc(T.long.toUpperCase()) + " · " + esc(p.no) + " · v" + rel.v + "</div><h1>" + esc(p.title) + "</h1>" +
      '<div class="rbpm"><b>As of</b> ' + esc(C.dtg(p.asOf)) + " (" + esc(dual(p.asOf)) + ") · <b>Area</b> " + esc(p.aoi || "Not stated") + " · <b>By</b> " + esc(p.author || "Not stated") + "</div></div></header>" +
      '<p class="rbkey"><span class="rbt cl">Source claim</span> what a source says, attributed and linked · <span class="rbt ob">Observed</span> an instrument reading · <span class="rbt aj">Analyst judgment</span> the author\'s assessment, with likelihood and confidence</p>';
    var kj = '<ol class="rbkjp">' + p.kjs.map(function (k) {
      var l = C.lik(k.lik), c = C.conf(k.conf);
      return '<li><span class="rbt aj">Analyst judgment</span>' + (k.origin === "ai" ? ' <span class="aitag">AI generated, approved by the analyst</span>' : "") + " " + citeHtml(k.text) +
        '<div class="rbkm">' + (l ? "<b>" + esc(l[1]) + "</b> (" + esc(l[2]) + ")" : "Likelihood not stated") + " · " + (c ? "<b>" + esc(c[1]) + "</b>" : "Confidence not stated") + "</div></li>";
    }).join("") + "</ol>";
    var figs = p.figs.map(function (f, i) {
      var c = byId[f.clip]; if (!c) return "";
      var d = drawSnip(c, f.caption), cn = corners(c), n = i + 1;
      var rows = c.items.map(function (it) {
        var u = C.safeUrl(it.url);
        return '<tr id="rbr-F' + n + "-" + esc(it.no) + '"><td class="kn"><span class="arpno">F' + n + "." + esc(it.no) + '</span></td><td><div class="kt">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + "</a>" : esc(it.title)) + "</div>" +
          '<div class="km"><span class="rbt ' + (it.stype === "sensor" ? "ob" : "cl") + '">' + esc(it.status) + "</span> " + esc([it.src || host(u), LBL[it.stype] || "", it.layer].filter(Boolean).join(" · ")) + "</div>" +
          '<div class="kw"><b>Published</b> ' + esc(it.pub ? dual(it.pub) : it.when || "not stated") + " · <b>Captured</b> " + esc(C.dtg(c.captured)) + " · <b>Where</b> " + esc(it.lat != null ? grid(it.lat, it.lon) : "not mapped") + (u ? "" : " · <b>No link:</b> listed on the OSAP map") + "</div>" +
          '<div class="fpx">SHA-256 ' + esc(it.fp || "not available") + "</div></td></tr>";
      }).join("");
      return '<figure class="rbpf" id="rbr-F' + n + '"><div class="arpfig">' + d.html + "<aside><h4>Key</h4>" + d.legend + "</aside></div>" +
        "<figcaption><b>Figure " + n + ".</b> " + esc(f.caption || c.caption) + '<br><span class="rbcm">Data as of ' + esc(C.dtg(c.dataAsOf || c.captured)) + " · snipped " + esc(C.dtg(c.captured)) + (c.period ? " · period " + esc(c.period) : "") +
        " · centre " + esc(cn.ctr) + " · NW corner " + esc(cn.nw) + " · SE corner " + esc(cn.se) + " · " + c.marks.length + " marks, " + c.items.length + " items · base map " + esc(d.attr || c.baseAttr) +
        "; borders Natural Earth; symbols NATO-style (APP-6), never hostile or friendly · snip SHA-256 " + esc(c.digest || "not available") + "</span></figcaption></figure>" +
        (rows ? '<table class="tlrkt arpkt rbit"><caption><b>Figure ' + n + " items.</b> Every mark and listing inside the snipped area, with its source.</caption><colgroup><col class=\"ckn\"><col></colgroup><thead><tr><th>Ref.</th><th>Item</th></tr></thead><tbody>" + rows + "</tbody></table>" : "");
    }).join("");
    var srcs = p.srcs.length ? '<ol class="rbsp">' + p.srcs.map(function (s, i) {
      var u = C.safeUrl(s.url);
      return '<li id="rbr-S' + (i + 1) + '"><b>[S' + (i + 1) + "]</b> " + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + "</a>" : esc(s.title)) + " · " + esc(s.src || host(u) || "Publisher not stated") +
        " · " + esc(LBL[s.stype] || "Type not stated") + (s.grade ? " · grade " + esc(s.grade) : "") + "<br><span class=\"rbcm\">Published " + esc(s.pub ? dual(s.pub) : "not stated") + " · captured " + esc(dual(s.cap)) + (u ? "" : " · " + esc(s.nolink || "no link")) + " · SHA-256 " + esc(s.fp || "not available") + "</span></li>";
    }).join("") + "</ol>" : '<p class="bm">No standalone sources; every source is listed with its figure.</p>';
    var annex = '<section class="rbannex"><h3>Annex A. Analytic standards</h3><table class="tlrkt rbscale"><thead><tr><th>Likelihood (ICD 203)</th><th>Range</th></tr></thead><tbody>' +
      C.LIKELIHOOD.map(function (l) { return "<tr><td>" + esc(l[1]) + "</td><td>" + esc(l[2]) + "</td></tr>"; }).join("") + "</tbody></table>" +
      '<ul class="rbconf">' + C.CONFIDENCE.map(function (c) { return "<li><b>" + esc(c[1]) + ":</b> " + esc(c[2]) + "</li>"; }).join("") + "</ul>" +
      '<p class="bm">Likelihood says how probable an outcome is; confidence says how good the evidence and reasoning are. A credible source can still be wrong: source claims are attributed, never stated as fact.</p>' +
      "<h3>Annex B. Product QC record</h3><p class=\"bm\">Version " + rel.v + ", exported " + esc(dual(rel.at)) + (rel.by ? " by " + esc(rel.by) : "") + ". QC check: " +
      (rel.blocks ? rel.blocks + " rule" + (rel.blocks === 1 ? "" : "s") + " not met, exported on the analyst's override: “" + esc(rel.override) + "”" : "all rules met") + (rel.warns ? "; " + rel.warns + " warning" + (rel.warns === 1 ? "" : "s") + " acknowledged" : "") + ".</p>" +
      (rel.findings.length ? '<ul class="rbqlp">' + rel.findings.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="bm">Product SHA-256 (canonical content and the snips it shows): <span class="mg">' + esc(rel.digest || "not available in this browser") + "</span></p></section>";
    return '<article class="arp rbp bpage">' + head +
      '<h3 class="tls">1. Bottom line up front' + originTag(b.bluf) + "</h3>" + paras(b.bluf.text) +
      '<h3 class="tls">2. Situation' + originTag(b.situation) + "</h3>" + (b.situation.text.trim() ? paras(b.situation.text) : '<p class="bm">Not stated.</p>') +
      '<h3 class="tls">3. Key judgments</h3>' + kj +
      (figs ? '<h3 class="tls">4. Maps and figures</h3>' + figs : "") +
      '<h3 class="tls">' + (figs ? 5 : 4) + '. Data statistics</h3>' + statsHtml(C.stats(p, byId)) +
      '<h3 class="tls">' + (figs ? 6 : 5) + '. Intelligence gaps' + originTag(b.gaps) + "</h3>" + (b.gaps.text.trim() ? paras(b.gaps.text) : '<p class="bm">Not stated.</p>') +
      '<h3 class="tls">' + (figs ? 7 : 6) + '. Outlook and indicators to watch' + originTag(b.outlook) + "</h3>" + (b.outlook.text.trim() ? paras(b.outlook.text) : '<p class="bm">Not stated.</p>') +
      '<h3 class="tls">Sources</h3>' + srcs + annex +
      '<footer class="tlrf">' + esc(p.no) + " v" + rel.v + " · built in OSAP from open sources; sources are linked, not stored. Nothing in this product changes what a source said." + '<div class="rbhand">' + esc(p.handling) + "</div></footer></article>";
  }
  /* data statistics: fixed counts, never added-up casualty figures */
  function statsHtml(st) {
    if (!st.n) return '<p class="bm">No items yet: add a snip or a source.</p>';
    var pct = function (n) { var v = 100 * n / st.n; return (v > 0 && v < 1 ? "<1" : Math.round(v)) + "%"; };
    var max = st.days.reduce(function (x, d) { return Math.max(x, d[1]); }, 1), bw = 26, H = 70;
    var bars = st.days.map(function (d, i) {
      var h = d[1] ? Math.max(2, Math.round(H * d[1] / max)) : 0, x = i * bw;
      return '<rect x="' + (x + 3) + '" y="' + (H - h + 14) + '" width="' + (bw - 6) + '" height="' + h + '" fill="#2b6a99"/>' +
        (d[1] ? '<text x="' + (x + bw / 2) + '" y="' + (H - h + 11) + '" text-anchor="middle">' + d[1] + "</text>" : "") +
        '<text x="' + (x + bw / 2) + '" y="' + (H + 26) + '" text-anchor="middle">' + d[0].slice(8) + "</text>";
    }).join("");
    var chart = st.days.length ? '<figure class="rbstc"><svg viewBox="0 0 ' + st.days.length * bw + " " + (H + 30) + '" role="img" aria-label="Items per day, last 14 days" font-family="system-ui,sans-serif" font-size="9" fill="#26323c">' +
      '<path d="M0 ' + (H + 14) + "H" + st.days.length * bw + '" stroke="#9fb0bf"/>' + bars + "</svg><figcaption>Items per day (UTC), the 14 days to " + esc(st.days[st.days.length - 1][0]) + ", by publish date.</figcaption></figure>" : "";
    return '<div class="rbst"><table class="tlrkt rbstt"><tbody>' +
      "<tr><th>Items cited from</th><td>" + st.n + " (each counted once)</td></tr>" +
      "<tr><th>Distinct sources</th><td>" + st.sources + "</td></tr>" +
      "<tr><th>Publish dates</th><td>" + (st.from ? esc(C.dtg(st.from)) + " to " + esc(C.dtg(st.to)) + " · " + st.dated + " dated" : "none stated") + "</td></tr>" +
      "<tr><th>On the map</th><td>" + st.mapped + " (" + pct(st.mapped) + ")</td></tr>" +
      "<tr><th>With a link</th><td>" + st.linked + " (" + pct(st.linked) + ")</td></tr>" +
      "<tr><th>By source type</th><td>" + st.types.map(function (t) { return esc(LBL[t[0]] || t[1]) + " " + t[2] + " (" + pct(t[2]) + ")"; }).join(" · ") + "</td></tr>" +
      "<tr><th>Top sources</th><td>" + st.top.map(function (s) { return esc(s[0]) + " " + s[1]; }).join(" · ") + "</td></tr>" +
      "</tbody></table>" + chart + "</div>" +
      '<p class="rbcm">Counts of what this product cites, by fixed rules. They describe the reporting, not events on the ground: one event can be reported many times, and figures inside reports are never added up.</p>';
  }
  function exportPdf(p, btn) {
    var box = el.querySelector(".rbqc"), msg = box && box.querySelector("[data-rb-msg]");
    var ack = box && box.querySelector('[data-rb="ack"]'), ov = box && box.querySelector('[data-rb="override"]');
    var byId = clipsById(), now = Date.now();
    var r = C.release(p, byId, { override: ov ? ov.value : "", ackWarnings: !!(ack && ack.checked), actor: p.author }, now);
    if (r.error) {
      if (msg) msg.textContent = r.error === "ai-unapproved" ? "AI-drafted text must be approved or deleted first; it cannot be overridden." : r.error === "blocked" ? "Fix the items marked Fix, or say why you are exporting anyway." : "Tick “I have read the warnings” first.";
      return;
    }
    if (!W.OSAP_PDF) { if (msg) msg.textContent = "The PDF maker is still loading."; return; }
    btn.disabled = true; btn.textContent = "Preparing…";
    sha(C.releaseInput(p, byId)).then(function (h) {
      r.rec.digest = h; p.releases.push(r.rec); p.updated = now;
      if (p.author) setUi({ author: p.author });
      save();
      el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh" data-rba="back">Back to the builder</button> <span class="obs">' + esc(p.no) + " v" + r.rec.v + "</span></div>" + productHtml(p, r.rec);
      VIEW = "print";
      var back = el.querySelector('[data-rba="back"]'); if (back) back.addEventListener("click", function () { VIEW = "edit"; open({ product: p.id }); });
      var imgs = [].slice.call(el.querySelectorAll("img.arpt"));
      var tiles = Promise.all(imgs.map(function (im) { return im.complete ? 0 : new Promise(function (ok) { im.addEventListener("load", ok); im.addEventListener("error", function () { im.style.visibility = "hidden"; ok(); }); }); }));
      return Promise.race([tiles, new Promise(function (ok) { setTimeout(ok, 6000); })]).then(function () {
        return W.OSAP_PDF.print({ title: p.no + " " + (p.title || "SITREP"), root: el.querySelector(".rbp") });
      });
    });
  }

  /* ---------- styles ---------- */
  var css = D.createElement("style");
  css.textContent =
    ".rb{max-width:1500px;margin:0 auto;padding:6px 14px 30px;color:var(--ink,#13202e)}.rb h2{margin:6px 0 8px;font-size:19px}.rb h3{font-size:14px;margin:14px 0 5px;color:#12324a}" +
    ".rbgridl{display:grid;grid-template-columns:260px minmax(0,1fr) 320px;gap:16px;align-items:start}" +
    "@media (max-width:1100px){.rbgridl{grid-template-columns:minmax(0,1fr)}.rbqc{position:static!important}}" +
    ".rbsb,.rbqc{background:var(--surface,#fff);border:1px solid var(--line,#c9d3dd);border-radius:6px;padding:8px 10px}.rbqc{position:sticky;top:8px;max-height:calc(100vh - 80px);overflow:auto}" +
    ".rbhint,.rbcm{font-size:12px;color:var(--muted,#5b6f84);margin:3px 0;overflow-wrap:anywhere}.rbbtns{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}" +
    ".rbclips,.rbprods,.rbql,.rbsrcs,.rbfigs{list-style:none;margin:0;padding:0}.rbclip{border-top:1px solid var(--line,#c9d3dd);padding:6px 0;font-size:13px}.rbca{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}" +
    ".rbold{color:#a35a00;font-weight:600}.rbpl{display:block;width:100%;text-align:left;min-height:40px;padding:5px 8px;margin:3px 0;border:1px solid var(--line,#c9d3dd);border-radius:5px;background:var(--surface,#fff);color:inherit;font:inherit;cursor:pointer}" +
    ".rbpl.on{border-color:var(--accent,#1d5a86);background:var(--accent-soft,#d6e3ee)}.rbpl b{display:block;font-size:13px}.rbpl span{font-size:11.5px;color:var(--muted,#5b6f84)}" +
    ".rbed textarea,.rbed input:not([type=checkbox]),.rbed select,.rbqc textarea{width:100%;box-sizing:border-box;font:inherit;font-size:13.5px;padding:6px 8px;border:1px solid var(--line,#c9d3dd);border-radius:4px;background:var(--surface,#fff);color:inherit;min-height:36px}" +
    ".rbhd{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}.rbhd label{font-size:12px;font-weight:600;display:flex;flex-direction:column;gap:3px}.rbhd .rbwide{grid-column:1/-1}.rbhd small{font-weight:400;color:var(--muted,#5b6f84)}" +
    ".rbrow{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}.rbrow select{flex:1 1 180px;width:auto}.rbrow input{flex:1 1 160px}" +
    ".rbkjs{padding-left:22px}.rbkjs>li{margin:6px 0 10px}.rbfig{margin:8px 0 14px}.rbfh{display:flex;gap:6px;align-items:center;margin-bottom:5px}.rbfh input{flex:1}" +
    ".rbsr{display:grid;grid-template-columns:auto 2fr 2fr 1fr 1.3fr 1.2fr auto;gap:5px;align-items:center}@media (max-width:900px){.rbsr{grid-template-columns:1fr}}.rbsrcs>li{border-top:1px solid var(--line,#c9d3dd);padding:6px 0}" +
    ".rbqs{font-weight:700;padding:5px 8px;border-radius:4px;margin:4px 0}.rbqs.ok{background:#e3f1e5;color:#1f5f2a}.rbqs.w{background:#fdf0d8;color:#7a4a00}.rbqs.b{background:#fbe2e0;color:#8d1d14}" +
    ".rbql li{font-size:12.5px;padding:4px 0;border-top:1px solid var(--line,#e1e6eb);line-height:1.35}.rbqi{display:inline-block;min-width:32px;font-weight:700;font-size:10.5px;text-transform:uppercase;border-radius:3px;padding:0 4px;text-align:center}" +
    ".rbql li.block .rbqi{background:#b3261e;color:#fff}.rbql li.warn .rbqi{background:#c77700;color:#fff}.rbqid{color:var(--muted,#8896a3);font-size:10.5px}.rbck,.rbov{display:block;margin:8px 0;font-size:12.5px;font-weight:600}" +
    ".rbtoast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;background:#12324a;color:#fff;padding:9px 14px;border-radius:6px;font-size:13.5px;max-width:min(560px,92vw);box-shadow:0 4px 18px rgba(0,0,0,.3)}" +
    ".arp .rbgrid{position:absolute;inset:0;width:100%;height:100%}" +
    /* the product */
    ".rbp .rbhand{text-align:center;font-weight:700;font-size:11px;letter-spacing:.06em;color:#12324a;border:1px solid #12324a;padding:2px 6px;margin:0 0 8px}.rbp footer .rbhand{margin-top:8px}" +
    ".rbp .rbph h1{font-size:21px;margin:2px 0 4px;color:#0b2340}.rbp .rbpk{font-size:11px;letter-spacing:.1em;font-weight:700;color:#4a6a8a}.rbp .rbpm{font-size:12.5px;color:#26323c}" +
    ".rbp .rbkey{font-size:11.5px;color:#4a5866;border-bottom:1px solid #c9d3dd;padding-bottom:6px}.rbt{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:3px;padding:0 5px;margin-right:4px;vertical-align:1px}" +
    ".rbt.cl{background:#eef2f6;color:#26323c;border:1px solid #c9d3dd}.rbt.ob{background:#e3f1e5;color:#1f5f2a;border:1px solid #b9dbbf}.rbt.aj{background:#e5edf7;color:#0b2340;border:1px solid #9fb6d3}" +
    ".rbp .rbkjp{padding-left:20px}.rbp .rbkjp li{margin:5px 0 8px;line-height:1.4}.rbp .rbkm{font-size:12px;color:#26323c;margin-top:2px}.rbp figure{margin:6px 0 8px;break-inside:avoid;page-break-inside:avoid}.rbp figcaption{font-size:12.5px;margin-top:4px;line-height:1.35}" +
    ".rbp table.rbit{table-layout:fixed;width:100%;border-collapse:collapse}.rbp table.rbit col.ckn{width:64px}.rbp table.rbit td{vertical-align:top;padding:3px 4px;border-top:1px solid #dde3e8;overflow-wrap:anywhere}.rbp table.rbit th{text-align:left}" +
    ".rbst{display:block}.rbst table.rbstt{width:100%;table-layout:fixed;border-collapse:collapse}.rbstt th{width:130px;text-align:left;font-weight:600;padding:3px 8px 3px 0;vertical-align:top}.rbstt td{padding:3px 0;overflow-wrap:anywhere;white-space:normal}" +
    ".rbstt tr{border-top:1px solid #dde3e8}.rbstc{margin:8px 0 0;max-width:440px;break-inside:avoid;page-break-inside:avoid}.rbstc svg{display:block;width:100%;height:auto}.rbstc figcaption{font-size:11.5px;color:#4a5866}" +
    ".rbp .rbsp li{margin:4px 0;font-size:12.5px;overflow-wrap:anywhere}.rbp .rbscale{max-width:360px}.rbp .rbconf,.rbp .rbqlp{font-size:12px}.rbp .mg{font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere}" +
    "@media print{.rbp .rbit{font-size:9px}.rbp h3.tls{break-after:avoid}.rbp .rbannex{break-before:page;page-break-before:always}.rbt{-webkit-print-color-adjust:exact;print-color-adjust:exact}}";
  D.head.appendChild(css);

  /* ---------- entry points ---------- */
  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "rbsnip", label: "Snip to report (map with sources)", run: function () {
    snipArea().then(function (c) { if (c) { toast("Snipped " + c.items.length + " items to the report sandbox."); open(); } });
  } });
  W.OSAP_RB = { open: open, close: close, snipArea: snipArea, snipView: snipView, rerender: rerender, isOpen: isOpen,
    store: function () { return ST; }, current: function () { return CUR ? prod(CUR) : null; }, qc: function () { return LAST_QC.slice(); }, _productHtml: productHtml };
})();
