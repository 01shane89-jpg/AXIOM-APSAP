/* AXIOM OSAP: "What's new" and "My work".
   Self-contained block loaded after the main page script. It only reads what the page publishes on window.TSAP
   (records, select, setView, fingerprint) and never changes a record.
   - What's new: reports that were not there on your last visit to this country, with a count on the map button.
     A visit ends after 30 minutes away; "Mark all as seen" starts a fresh baseline.
   - Trends: report counts per category by day (30 days) or by week (26 weeks), from the records the page holds,
     which include the feed history kept by the refresh job (data/history/<cc>.js).
   - My work: save items, write notes, mark items reviewed. Kept in this browser only (localStorage "osap-work"),
     never sent anywhere. Notes are the analyst's own words and are always shown and exported apart from source content.
     "Reviewed" means the analyst looked at it; it is not verification and does not change the item's claim status.
   - Exports: situation report (print or save as PDF), KML, GeoJSON and CSV of the open tab or the whole country,
     filtered by the period and the drawn area; each item keeps its source link, SHA-256 record fingerprint and
     claim status. Notes export and import as a JSON file (schema osap-work/1) so they survive a phone change. */
(function () {
  "use strict";
  var WORK_KEY = "osap-work", SEEN_PREFIX = "osap-seen-", VISIT_GAP = 30 * 60e3, SEEN_CAP = 8000, IMPORT_MAX = 5e6;
  var STATE = { observation: ["Observed", "instrument reading, not reviewed"], claim: ["Reported", "official statement, not confirmed"],
    event: ["Reported", "sourced report, not confirmed"] };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function T() { return window.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function nowTxt() { return T().dualT(Date.now(), { date: true }); }
  /* record times shown the page's way: Zulu and local, 24-hour; a date alone stays a date */
  function tsTxt(ts) { var t = T(); return t.asofT ? t.asofT(String(ts || "")) : String(ts || "").replace("T", " "); }
  function claimStatus(r) { var s = STATE[r.type]; return s ? s[0] + " (" + s[1] + ")" : String(r.type || "Not stated"); }

  /* a stable key per item across page loads (record ids are renumbered on every load). Feed items keep their link;
     curated records use link, title and date together. Two FNV-1a passes give 16 hex characters. */
  function fnv(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function keyOf(r) {
    if (r.__wk) return r.__wk;
    var base = CC + "|" + r.layer + "|" + (r.url || "") + ((r.live || r.news || r.social) && r.url ? "" : "|" + (r.title || "") + "|" + String(r.ts || "").slice(0, 10));
    try { Object.defineProperty(r, "__wk", { value: fnv(base, 2166136261) + fnv(base, 33554467), enumerable: false }); } catch (e) { return fnv(base, 2166136261) + fnv(base, 33554467); }
    return r.__wk;
  }

  var CC = "", map = null;
  function recs() { return (window.TSAP && window.TSAP.records) || []; }
  function recByKey(k) { var R = recs(); for (var i = 0; i < R.length; i++) if (keyOf(R[i]) === k) return R[i]; return null; }
  function recById(id) { var R = recs(); for (var i = 0; i < R.length; i++) if (R[i].id === id) return R[i]; return null; }
  function countryName() {
    var b = document.querySelector('#country-seg button[aria-current="true"]');
    if (!b) return CC.toUpperCase();
    var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove();
    return c.textContent.trim() || CC.toUpperCase();
  }
  function layerNames() {
    var o = {};
    Array.prototype.forEach.call(document.querySelectorAll("#view-seg button[data-view]"), function (b) { o[b.getAttribute("data-view")] = b.textContent.replace(/\s*\d+$/, "").trim(); });
    return o;
  }
  function layerName(id) { var n = layerNames()[id]; return n || String(id || "").replace(/^./, function (c) { return c.toUpperCase(); }); }
  function currentView() { var b = document.querySelector('#view-seg button[aria-selected="true"]'); return b ? b.getAttribute("data-view") : ""; }

  /* ---------- my work store ---------- */
  var WORK = lsGet(WORK_KEY);
  if (!WORK || typeof WORK !== "object" || !WORK.items || typeof WORK.items !== "object") WORK = { schema: "osap-work/1", items: {} };
  /* item keys are record fingerprints (16 hex); anything else (a hand-made or tampered workspace file) is dropped */
  Object.keys(WORK.items).forEach(function (k) { if (!/^[0-9a-f]{16}$/.test(k)) delete WORK.items[k]; });
  function saveWork() { if (!lsSet(WORK_KEY, WORK)) toast("This browser would not store your work (storage full or blocked)."); }
  function snap(r) {
    return { title: String(r.title || ""), layer: r.layer || "", type: r.type || "", status: claimStatus(r), source: r.src ? r.src.name : "",
      url: safeUrl(r.url), ts: String(r.ts || ""), place: [r.place, r.prov].filter(Boolean).join(", "),
      lat: r.lat != null && isFinite(r.lat) ? +r.lat : null, lon: r.lon != null && isFinite(r.lon) ? +r.lon : null,
      fp: (window.TSAP && window.TSAP.fingerprints && window.TSAP.fingerprints[r.id]) || "" };
  }
  function itemFor(r, make) {
    var k = keyOf(r), it = WORK.items[k];
    if (!it && make) it = WORK.items[k] = { cc: CC, saved: false, reviewed: false, note: "", at: "", snap: snap(r) };
    if (it && r) { var s = snap(r); if (!s.fp && it.snap && it.snap.fp) s.fp = it.snap.fp; it.snap = s; }
    return it || null;
  }
  function touch(it) { it.at = new Date().toISOString(); }
  function prune(k) { var it = WORK.items[k]; if (it && !it.saved && !it.reviewed && !it.note) delete WORK.items[k]; }
  function setFlag(r, flag, on) {
    var it = itemFor(r, true), k = keyOf(r);
    it[flag] = on; it[flag + "At"] = on ? new Date().toISOString() : ""; touch(it);
    if (on && window.TSAP && window.TSAP.fingerprint) window.TSAP.fingerprint(r).then(function (h) { if (WORK.items[k]) { WORK.items[k].snap.fp = h; saveWork(); } });
    prune(k); saveWork(); decorate(); badge();
  }
  function setNote(r, text) {
    var it = itemFor(r, true), k = keyOf(r);
    it.note = String(text || "").slice(0, 4000); it.noteAt = it.note ? new Date().toISOString() : ""; touch(it);
    prune(k); saveWork(); decorate();
  }
  function myItems() { return Object.keys(WORK.items).map(function (k) { var it = WORK.items[k]; it.k = k; return it; }).filter(function (it) { return it.cc === CC; }); }

  /* ---------- what's new since the last visit ---------- */
  var SEEN = null, seenSet = {}, baseSet = null, lastLen = -1, lastRef = null, NEWK = [];
  function loadSeen() {
    var s = lsGet(SEEN_PREFIX + CC), now = Date.now();
    if (!s || !Array.isArray(s.seen)) s = { seen: [], base: null, baseAt: 0, lastAt: 0 };
    /* a new visit when the last one ended more than 30 minutes ago: what was seen then becomes the baseline */
    if (s.lastAt && now - s.lastAt > VISIT_GAP) { s.base = s.seen.slice(); s.baseAt = s.lastAt; }
    SEEN = s;
    seenSet = {}; s.seen.forEach(function (k) { seenSet[k] = 1; });
    baseSet = s.base ? {} : null; if (s.base) s.base.forEach(function (k) { baseSet[k] = 1; });
  }
  function trackSeen(force) {
    var R = recs();
    if (!force && R === lastRef && R.length === lastLen) { SEEN.lastAt = Date.now(); lsSet(SEEN_PREFIX + CC, SEEN); return; }
    lastRef = R; lastLen = R.length;
    var added = 0, nk = [];
    R.forEach(function (r) {
      var k = keyOf(r);
      if (!seenSet[k]) { seenSet[k] = 1; SEEN.seen.push(k); added++; }
      if (baseSet && !baseSet[k]) nk.push(k);
    });
    if (SEEN.seen.length > SEEN_CAP) SEEN.seen = SEEN.seen.slice(SEEN.seen.length - SEEN_CAP);
    NEWK = nk; SEEN.lastAt = Date.now();
    lsSet(SEEN_PREFIX + CC, SEEN);
    if (added || force) { badge(); decorate(); if (WK.open && WK.tab === "new") renderTab(); }
  }
  function newRecords() {
    var want = {}; NEWK.forEach(function (k) { want[k] = 1; });
    var seen = {};
    return recs().filter(function (r) { var k = keyOf(r); if (!want[k] || seen[k]) return false; seen[k] = 1; return true; })
      .sort(function (a, b) { return a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0; });
  }
  function isNew(k) { return !!baseSet && !baseSet[k]; }
  function markAllSeen() {
    SEEN.base = SEEN.seen.slice(); SEEN.baseAt = Date.now(); baseSet = {}; SEEN.base.forEach(function (k) { baseSet[k] = 1; });
    NEWK = []; lsSet(SEEN_PREFIX + CC, SEEN); badge(); decorate(); renderTab();
  }

  /* ---------- the reporting period and drawn area, read the same way the page does (its own settings on this device) ---------- */
  function periodRange() {
    var P = lsGet("asap-period") || { p: "all" }, today = Math.floor(Date.now() / 864e5), since = Date.now() - 864e5;
    if (!/^(24h|7|30|90|all|custom)$/.test(P.p)) P = { p: "all" };
    var PR = P.p === "all" ? { from: "", to: "" } : P.p === "custom" ? { from: P.from || "", to: P.to || "" }
      : P.p === "24h" ? { from: new Date(since).toISOString().slice(0, 10), to: "", since: since }
      : { from: new Date((today - (+P.p) + 1) * 864e5).toISOString().slice(0, 10), to: "" };
    PR.label = P.p === "all" ? "all dates" : P.p === "24h" ? "last 24 hours" : P.p === "custom" ? ((PR.from || "start") + " to " + (PR.to || "today")) : "last " + P.p + " days";
    return PR;
  }
  function recMs(r) {
    var t = String(r.issued || r.ts || "");
    if (!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(t)) return null;
    t = t.replace(" ", "T"); if (!/[+-]\d\d:?\d\d$|Z$/.test(t)) t += "Z";
    var ms = Date.parse(t); return isNaN(ms) ? null : ms;
  }
  function inPeriod(r, PR) {
    if (r.ongoing) return true;
    if (PR.since) { var ms = recMs(r); if (ms != null) return ms >= PR.since; }
    var d = String(r.ts || "").slice(0, 10);
    return !d || ((!PR.from || d >= PR.from) && (!PR.to || d <= PR.to));
  }
  function area() { var a = lsGet("asap-area-" + CC); return Array.isArray(a) && a.length >= 3 ? a : null; }
  function inPoly(lat, lon, P) {
    var inside = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      var yi = P[i][0], xi = P[i][1], yj = P[j][0], xj = P[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function located(r) { return r.lat != null && isFinite(r.lat) && r.lon != null && isFinite(r.lon); }
  /* the items an export covers: the open tab (or every report here), in the period, inside the drawn area when there is one */
  function exportSet(scope, useArea) {
    var PR = periodRange(), A = useArea ? area() : null, v = currentView(), R = recs(), tabNote = "";
    var list = R.filter(function (r) { return inPeriod(r, PR); });
    if (scope === "tab") {
      if (v === "news" || v === "social") list = list.filter(function (r) { return r[v]; });
      else if (list.some(function (r) { return r.layer === v; })) list = list.filter(function (r) { return r.layer === v; });
      else if (v !== "timeline") tabNote = "The open tab (" + layerName(v) + ") shows map items rather than reports, so every report in the period is included.";
    }
    if (A) list = list.filter(function (r) { return located(r) && inPoly(r.lat, r.lon, A); });
    var seen = {};
    list = list.filter(function (r) { var k = keyOf(r); if (seen[k]) return false; seen[k] = 1; return true; });
    list.sort(function (a, b) { return a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0; });
    return { list: list, period: PR.label, area: !!A, tab: scope === "tab" ? layerName(v) : "All reports", note: tabNote };
  }
  function withFingerprints(list) {
    var F = window.TSAP && window.TSAP.fingerprint;
    if (!F) return Promise.resolve(list.map(function () { return ""; }));
    return Promise.all(list.map(function (r) { return F(r).catch(function () { return ""; }); }));
  }
  function rowOf(r, fp) {
    var it = WORK.items[keyOf(r)];
    return { key: keyOf(r), title: String(r.title || ""), detail: String(r.detail || ""), category: layerName(r.layer), kind: r.cat || "", claim_status: claimStatus(r),
      date: String(r.ts || ""), published: String(r.issued || ""), place: [r.place, r.prov].filter(Boolean).join(", "), precision: r.prec || "",
      lat: located(r) ? +(+r.lat).toFixed(5) : null, lon: located(r) ? +(+r.lon).toFixed(5) : null,
      source: r.src ? r.src.name : "", source_kind: r.src ? r.src.kind : "", source_link: safeUrl(r.url), fingerprint_sha256: fp || "",
      analyst_saved: !!(it && it.saved), analyst_reviewed: !!(it && it.reviewed), analyst_note: it ? it.note || "" : "" };
  }
  function stamp() { return new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-") + "Z"; }
  function download(name, type, text) {
    var blob = new Blob([text], { type: type }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  var HEADER = "Compiled by AXIOM OSAP from public sources. Every item is the named source's report or claim, not confirmed. analyst_* fields are the user's own marks and notes, kept apart from source content. \"Reviewed\" means looked at, not verified.";
  function exportAs(fmt, scope, useArea) {
    var S = exportSet(scope, useArea);
    if (!S.list.length) { toast("Nothing to export with these settings."); return; }
    toast("Preparing " + S.list.length + " items…");
    withFingerprints(S.list).then(function (fps) {
      var rows = S.list.map(function (r, i) { return rowOf(r, fps[i]); }), base = "osap-" + CC + "-" + stamp();
      var meta = { generated_utc: new Date().toISOString(), country: countryName(), country_id: CC, scope: S.tab, period: S.period, drawn_area: S.area, note: HEADER };
      if (fmt === "csv") {
        var cols = Object.keys(rows[0]);
        var csvCell = function (v) { v = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        /* plain CSV (no comment lines) so GIS and spreadsheet tools read it; claim_status and the analyst_ columns carry the caveats */
        var lines = [cols.join(",")]
          .concat(rows.map(function (o) { return cols.map(function (c) { return csvCell(o[c]); }).join(","); }));
        download(base + ".csv", "text/csv;charset=utf-8", "\ufeff" + lines.join("\r\n"));
      } else if (fmt === "geojson") {
        var fc = { type: "FeatureCollection", metadata: meta, features: rows.map(function (o) {
          var p = Object.assign({}, o); delete p.lat; delete p.lon;
          return { type: "Feature", geometry: o.lat != null ? { type: "Point", coordinates: [o.lon, o.lat] } : null, properties: p };
        }) };
        download(base + ".geojson", "application/geo+json", JSON.stringify(fc, null, 1));
      } else if (fmt === "kml") {
        var x = function (s) { return String(s == null ? "" : s).replace(/[<>&'"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); };
        var pts = rows.filter(function (o) { return o.lat != null; });
        var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + x("OSAP " + meta.country + " " + meta.generated_utc) + "</name>" +
          "<description>" + x(HEADER + " Scope: " + S.tab + ", " + S.period + (S.area ? ", inside the drawn area" : "") + ". " + (rows.length - pts.length) + " items without a map location are left out; use CSV or GeoJSON for them.") + "</description>" +
          pts.map(function (o) {
            return "<Placemark><name>" + x(o.title.slice(0, 120)) + "</name><description>" + x([o.detail, "Status: " + o.claim_status, "Source: " + o.source, o.source_link, "SHA-256: " + o.fingerprint_sha256,
              o.analyst_note ? "Analyst note (user's own, not source content): " + o.analyst_note : ""].filter(Boolean).join("\n")) + "</description>" +
              (o.date ? "<TimeStamp><when>" + x(o.date.slice(0, 10)) + "</when></TimeStamp>" : "") +
              "<ExtendedData>" + Object.keys(o).filter(function (k) { return k !== "lat" && k !== "lon"; }).map(function (k) { return '<Data name="' + k + '"><value>' + x(o[k]) + "</value></Data>"; }).join("") + "</ExtendedData>" +
              "<Point><coordinates>" + o.lon + "," + o.lat + "</coordinates></Point></Placemark>";
          }).join("") + "</Document></kml>";
        download(base + ".kml", "application/vnd.google-earth.kml+xml", kml);
      }
      toast("Exported " + rows.length + " items.");
    });
  }

  /* ---------- situation report (print, or save as PDF from the print dialog) ---------- */
  function sitrep(scope, useArea) {
    var S = exportSet(scope, useArea), mine = myItems().filter(function (it) { return it.saved || it.note || it.reviewed; }), cap = 300;
    withFingerprints(S.list.slice(0, cap)).then(function (fps) {
      var byL = {}; S.list.forEach(function (r) { byL[r.layer] = (byL[r.layer] || 0) + 1; });
      var nNew = newRecords().length;
      var el = document.getElementById("wk-print") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "wk-print" }));
      el.innerHTML = '<div class="wkp">' +
        "<h1>Situation report: " + esc(countryName()) + "</h1>" +
        '<p class="wkpm">Generated ' + esc(nowTxt()) + " · " + esc(S.tab) + " · " + esc(S.period) + (S.area ? " · inside the drawn area" : "") + "</p>" +
        '<p class="wkpm">Compiled by AXIOM OSAP from public sources. Every item is the named source\'s report or claim and has not been confirmed. Analyst notes (section 2) are the user\'s own and are not part of any source.</p>' +
        "<h2>1. Summary</h2><table><tr><th>Category</th><th>Items</th></tr>" +
        Object.keys(byL).sort(function (a, b) { return byL[b] - byL[a]; }).map(function (l) { return "<tr><td>" + esc(layerName(l)) + "</td><td>" + byL[l] + "</td></tr>"; }).join("") +
        "<tr><td><b>Total</b></td><td><b>" + S.list.length + "</b></td></tr></table>" +
        '<p class="wkpm">' + (baseSet ? nNew + " report" + (nNew === 1 ? "" : "s") + " new since the last visit on this device." : "First visit on this device, so nothing is marked new yet.") + (S.note ? " " + esc(S.note) : "") + "</p>" +
        "<h2>2. Analyst notes and saved items</h2>" +
        (mine.length ? '<table class="wkpn"><tr><th>Item (source content)</th><th>Analyst marks and note (user\'s own)</th></tr>' + mine.map(function (it) {
          var s = it.snap || {};
          return "<tr><td>" + esc(s.title) + '<div class="wkps">' + esc(s.source) + (s.ts ? " · " + esc(tsTxt(s.ts)) : "") + " · " + esc(s.status) + (s.url ? "<br>" + esc(s.url) : "") + (s.fp ? "<br>SHA-256 " + esc(s.fp) : "") + "</div></td>" +
            "<td>" + [it.saved ? "Saved" : "", it.reviewed ? "Reviewed (not verified)" : ""].filter(Boolean).join(", ") + (it.note ? '<div class="wkpnote">' + esc(it.note) + "</div>" : "") + "</td></tr>";
        }).join("") + "</table>" : '<p class="wkpm">No saved items or notes for this country on this device.</p>') +
        "<h2>3. Reports</h2>" + (S.list.length > cap ? '<p class="wkpm">The newest ' + cap + " of " + S.list.length + ". Use CSV or GeoJSON for the full set.</p>" : "") +
        '<table class="wkpr"><colgroup><col style="width:15%"><col style="width:43%"><col style="width:15%"><col style="width:27%"></colgroup><tr><th>Date</th><th>Report</th><th>Status</th><th>Source and fingerprint</th></tr>' + S.list.slice(0, cap).map(function (r, i) {
          var u = safeUrl(r.url);
          return "<tr><td>" + esc(tsTxt(r.ts)) + "</td><td><b>" + esc(r.title) + '</b><div class="wkps">' + esc(layerName(r.layer)) + ([r.place, r.prov].filter(Boolean).length ? " · " + esc([r.place, r.prov].filter(Boolean).join(", ")) : "") + "</div></td>" +
            "<td>" + esc(claimStatus(r)) + "</td><td>" + esc(r.src ? r.src.name : "") + (u ? '<div class="wkps">' + esc(u) + "</div>" : "") + '<div class="wkps wkfp">' + esc(fps[i] || "") + "</div></td></tr>";
        }).join("") + "</table></div>";
      document.documentElement.classList.add("wk-printing");
      var done = function () { document.documentElement.classList.remove("wk-printing"); window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done);
      setTimeout(function () { window.print(); setTimeout(done, 1500); }, 60);
    });
  }

  /* ---------- notes file: export and import (merges; the newer copy of each item wins) ---------- */
  function exportNotes() {
    var all = Object.keys(WORK.items).map(function (k) { var it = Object.assign({}, WORK.items[k]); it.key = k; delete it.k; return it; });
    if (!all.length) { toast("No saved items or notes yet."); return; }
    download("osap-my-work-" + stamp() + ".json", "application/json", JSON.stringify({ schema: "osap-work/1", exported_utc: new Date().toISOString(),
      note: "Analyst's own saved items, notes and review marks from AXIOM OSAP. Not source content.", items: all }, null, 1));
  }
  function clean(s, n) { return typeof s === "string" ? s.slice(0, n) : ""; }
  function importNotes(file) {
    if (!file) return;
    if (file.size > IMPORT_MAX) { toast("That file is too large to be an OSAP notes file."); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var j; try { j = JSON.parse(fr.result); } catch (e) { toast("That file is not an OSAP notes file (not JSON)."); return; }
      if (!j || j.schema !== "osap-work/1" || !Array.isArray(j.items)) { toast("That file is not an OSAP notes file (schema osap-work/1)."); return; }
      var added = 0, updated = 0;
      j.items.forEach(function (x) {
        if (!x || !/^[0-9a-f]{16}$/.test(x.key) || !/^[a-z]{2,3}$/.test(x.cc)) return;
        var s = x.snap || {}, it = { cc: x.cc, saved: x.saved === true, reviewed: x.reviewed === true, note: clean(x.note, 4000), at: clean(x.at, 40),
          savedAt: clean(x.savedAt, 40), reviewedAt: clean(x.reviewedAt, 40), noteAt: clean(x.noteAt, 40),
          snap: { title: clean(s.title, 500), layer: clean(s.layer, 40), type: clean(s.type, 40), status: clean(s.status, 120), source: clean(s.source, 200),
            url: safeUrl(clean(s.url, 2000)), ts: clean(s.ts, 40), place: clean(s.place, 200), lat: isFinite(s.lat) && s.lat !== null ? +s.lat : null,
            lon: isFinite(s.lon) && s.lon !== null ? +s.lon : null, fp: /^[0-9a-f]{64}$/.test(s.fp || "") ? s.fp : "" } };
        var cur = WORK.items[x.key];
        if (!cur) { WORK.items[x.key] = it; added++; } else if ((it.at || "") > (cur.at || "")) { WORK.items[x.key] = it; updated++; }
      });
      saveWork(); decorate(); badge(); renderTab();
      toast("Imported: " + added + " new, " + updated + " updated, the rest already here.");
    };
    fr.readAsText(file);
  }

  /* ---------- trends: report counts per category by day or week ---------- */
  function dayIdx(r) { var d = String(r.ts || "").slice(0, 10); if (!/^\d{4}-\d\d-\d\d$/.test(d)) return null; var t = Date.parse(d + "T00:00:00Z"); return isNaN(t) ? null : Math.floor(t / 864e5); }
  function trends(unit, useArea) {
    var A = useArea ? area() : null, today = Math.floor(Date.now() / 864e5), n = unit === "week" ? 26 : 30, w = unit === "week" ? 7 : 1;
    /* weeks run Monday to Sunday (UTC); day 0 of the epoch was a Thursday */
    var endB = unit === "week" ? today - ((today + 3) % 7) : today, start = endB - (n - 1) * w;
    var rows = {}, total = new Array(n).fill(0), seen = {};
    recs().forEach(function (r) {
      var k = keyOf(r); if (seen[k]) return; seen[k] = 1;
      if (A && !(located(r) && inPoly(r.lat, r.lon, A))) return;
      var d = dayIdx(r); if (d == null || d < start || d > today) return;
      var b = Math.floor((d - start) / w); if (b < 0 || b >= n) return;
      var l = r.news ? "news" : r.social ? "social" : r.layer;
      (rows[l] = rows[l] || new Array(n).fill(0))[b]++; total[b]++;
    });
    var labels = []; for (var i = 0; i < n; i++) labels.push(new Date((start + i * w) * 864e5).toISOString().slice(0, 10));
    return { rows: rows, total: total, labels: labels, unit: unit };
  }
  function spark(vals, labels, unit, max, name) {
    var W = 300, H = 34, n = vals.length, bw = W / n, fmt = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
    return '<svg class="wkspark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(name + ", " + vals.reduce(function (a, b) { return a + b; }, 0) + " items") + '">' +
      '<line x1="0" y1="' + (H - 0.5) + '" x2="' + W + '" y2="' + (H - 0.5) + '" class="wkbase"/>' +
      vals.map(function (v, i) {
        var h = v ? Math.max(2, (v / max) * (H - 3)) : 0, tip = (unit === "week" ? "Week of " : "") + fmt(labels[i]) + ": " + v + " " + name.toLowerCase();
        return '<g><title>' + esc(tip) + '</title><rect class="wkhit" x="' + (i * bw) + '" y="0" width="' + bw + '" height="' + H + '"/>' +
          (h ? '<rect class="wkbar" x="' + (i * bw + 1) + '" y="' + (H - 1 - h) + '" width="' + Math.max(1, bw - 2) + '" height="' + h + '" rx="1.5"/>' : "") + "</g>";
      }).join("") + "</svg>";
  }

  /* ---------- the dialog ---------- */
  var WK = { open: false, tab: "new", unit: "day", savedF: "all" };
  var box = document.createElement("div");
  box.id = "wk"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "wk-h");
  var TABS = [["new", "What's new"], ["trends", "Trends"], ["mine", "My work"], ["export", "Export"]];
  function openWk(tab) {
    WK.open = true; WK.tab = tab || WK.tab; box.hidden = false; renderTab();
    var x = box.querySelector(".x"); if (x) x.focus();
  }
  function closeWk() { WK.open = false; box.hidden = true; box.innerHTML = ""; }
  function renderTab() {
    if (!WK.open) return;
    var nNew = NEWK.length, body = "";
    if (WK.tab === "new") body = tabNew();
    else if (WK.tab === "trends") body = tabTrends();
    else if (WK.tab === "mine") body = tabMine();
    else body = tabExport();
    var scroll = box.scrollTop;
    box.innerHTML = '<div class="cbox wkbox"><div class="chead"><h2 id="wk-h">' + esc(countryName()) + '</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      '<div class="wktabs" role="tablist">' + TABS.map(function (t) {
        return '<button type="button" role="tab" data-wk-tab="' + t[0] + '" aria-selected="' + (WK.tab === t[0]) + '">' + t[1] +
          (t[0] === "new" && nNew ? ' <span class="wkn">' + nNew + "</span>" : "") + (t[0] === "mine" && myItems().length ? ' <span class="wkn wkn2">' + myItems().length + "</span>" : "") + "</button>";
      }).join("") + "</div>" + body + "</div>";
    box.scrollTop = scroll;
  }
  function rowHtml(r, extra) {
    var k = keyOf(r), it = WORK.items[k];
    return '<div class="wkrow"><button type="button" class="wkopen" data-wk-open="' + k + '"><span class="wkt">' + esc(tsTxt(r.ts)) + "</span>" +
      '<span class="wkh">' + esc(r.title) + "</span>" +
      '<span class="wks">' + esc(layerName(r.news ? "news" : r.social ? "social" : r.layer)) + " · " + esc(r.src ? r.src.name : "") + " · " + esc(STATE[r.type] ? STATE[r.type][0] : r.type) +
      (it && it.saved ? " · ★ saved" : "") + (it && it.reviewed ? " · ✓ reviewed" : "") + (it && it.note ? " · ✎ note" : "") + "</span></button>" + (extra || "") + "</div>";
  }
  function tabNew() {
    if (!baseSet) return '<p class="obs">This is your first visit to ' + esc(countryName()) + " on this device, so there is nothing to compare with yet. Come back later and the reports that arrived in between show here, with a count on the map button.</p>";
    var L = newRecords(), since = SEEN.baseAt ? T().dualT(SEEN.baseAt, { date: true }) : "";
    var byL = {}; L.forEach(function (r) { var l = r.news ? "news" : r.social ? "social" : r.layer; byL[l] = (byL[l] || 0) + 1; });
    return '<p class="obs">Reports that were not here on your last visit' + (since ? " (" + esc(since) + ")" : "") + ". Kept on this device only. A visit ends after 30 minutes away.</p>" +
      (L.length ? '<p class="wkchips">' + Object.keys(byL).sort(function (a, b) { return byL[b] - byL[a]; }).map(function (l) { return '<span class="wkchip">' + esc(layerName(l)) + " " + byL[l] + "</span>"; }).join("") + "</p>" : "") +
      '<p><button type="button" class="refresh" data-wk-act="seen"' + (L.length ? "" : " disabled") + ">Mark all as seen</button></p>" +
      (L.length ? '<div class="wklist">' + L.slice(0, 300).map(function (r) { return rowHtml(r); }).join("") + "</div>" + (L.length > 300 ? '<p class="obs">The newest 300 of ' + L.length + ".</p>" : "")
        : '<p class="obs">Nothing new since your last visit.</p>');
  }
  function tabTrends() {
    var A = area(), useA = WK.trendArea !== false && !!A, t = trends(WK.unit, useA), names = Object.keys(t.rows);
    names.sort(function (a, b) { return t.rows[b].reduce(function (x, y) { return x + y; }, 0) - t.rows[a].reduce(function (x, y) { return x + y; }, 0); });
    var peak = function (v) { return Math.max.apply(null, v.concat([1])); }, scl = function (v) { return Math.max(peak(v), 5); }, per = WK.unit === "week" ? "week" : "day";
    var f = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
    return '<div class="wkctl"><span class="seg" role="group" aria-label="Time step"><button type="button" data-wk-unit="day" aria-pressed="' + (WK.unit === "day") + '">Days (30)</button>' +
      '<button type="button" data-wk-unit="week" aria-pressed="' + (WK.unit === "week") + '">Weeks (26)</button></span>' +
      (A ? '<label class="wkchk"><input type="checkbox" data-wk-tarea' + (useA ? " checked" : "") + "> Only the drawn area</label>" : "") + "</div>" +
      '<p class="obs">Reports per category by the date each one is about or was published, ' + esc(f(t.labels[0])) + " to today (UTC). Each row has its own scale (full height is its peak, or 5 when the peak is lower), so read the shape within a row and the numbers across rows. Hover or tap a bar for its count. " +
      "News and post history has been kept since 20 Sept 2026, so older bars hold only researched records.</p>" +
      (names.length ? '<table class="wktr"><tbody>' +
        '<tr class="wktot"><th scope="row">All categories<span class="sub">' + t.total.reduce(function (a, b) { return a + b; }, 0) + " items · peak " + peak(t.total) + " a " + per + "</span></th><td>" + spark(t.total, t.labels, t.unit, scl(t.total), "Items") + "</td></tr>" +
        names.map(function (l) {
          var v = t.rows[l], s = v.reduce(function (a, b) { return a + b; }, 0);
          return '<tr><th scope="row">' + esc(layerName(l)) + '<span class="sub">' + s + " items · peak " + peak(v) + " a " + per + "</span></th><td>" + spark(v, t.labels, t.unit, scl(v), layerName(l)) + "</td></tr>";
        }).join("") + "</tbody></table>" +
        '<p class="obs">Counts show how much was reported, not how much happened.</p>' +
        '<details><summary>Table view</summary><div class="wkscroll"><table class="wktab"><tr><th>Category</th>' + t.labels.map(function (d) { return "<th>" + esc(f(d)) + "</th>"; }).join("") + "</tr>" +
        names.map(function (l) { return "<tr><td>" + esc(layerName(l)) + "</td>" + t.rows[l].map(function (v) { return "<td>" + v + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div></details>"
        : '<p class="obs">No dated reports in this range' + (useA ? " inside the drawn area" : "") + ".</p>");
  }
  function tabMine() {
    var all = myItems(), f = WK.savedF;
    var L = all.filter(function (it) { return f === "all" ? true : f === "saved" ? it.saved : f === "notes" ? !!it.note : it.reviewed; })
      .sort(function (a, b) { return (b.at || "") < (a.at || "") ? -1 : 1; });
    var cnt = function (p) { return all.filter(p).length; };
    return '<p class="obs">Your saved items, notes and review marks for ' + esc(countryName()) + '. They stay in this browser only and are never sent anywhere. Notes are your words, kept apart from the source. "Reviewed" means you looked at it; it does not verify the report.</p>' +
      '<div class="wkctl"><span class="seg" role="group" aria-label="Show">' + [["all", "All", all.length], ["saved", "Saved", cnt(function (i) { return i.saved; })], ["notes", "With notes", cnt(function (i) { return !!i.note; })], ["reviewed", "Reviewed", cnt(function (i) { return i.reviewed; })]].map(function (b) {
        return '<button type="button" data-wk-f="' + b[0] + '" aria-pressed="' + (f === b[0]) + '">' + b[1] + " " + b[2] + "</button>"; }).join("") + "</span></div>" +
      (L.length ? '<div class="wklist">' + L.map(function (it) {
        var s = it.snap || {}, live = recByKey(it.k), u = safeUrl(s.url);
        return '<div class="wkrow wkmine"><div class="wkh">' + esc(s.title || "(untitled)") + "</div>" +
          '<div class="wks">' + esc(layerName(s.layer)) + " · " + esc(s.source) + (s.ts ? " · " + esc(tsTxt(s.ts)) : "") + " · " + esc(s.status) + "</div>" +
          (u ? '<div class="wks"><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)) + "</a></div>" : "") +
          (s.fp ? '<div class="wks wkfp">SHA-256 ' + esc(s.fp) + "</div>" : "") +
          '<div class="wkanl"><span class="wktag">Your note</span>' +
          '<textarea data-wk-note="' + esc(it.k) + '" rows="2" maxlength="4000" placeholder="Your own note (not part of the source)">' + esc(it.note || "") + "</textarea></div>" +
          '<div class="wkbtns">' + (live ? '<button type="button" class="refresh" data-wk-open="' + esc(it.k) + '">Open</button>' : '<span class="obs">Not in the current data; kept from when you saved it.</span>') +
          '<button type="button" class="refresh" data-wk-tog="saved" data-k="' + esc(it.k) + '" aria-pressed="' + !!it.saved + '">' + (it.saved ? "★ Saved" : "☆ Save") + "</button>" +
          '<button type="button" class="refresh" data-wk-tog="reviewed" data-k="' + esc(it.k) + '" aria-pressed="' + !!it.reviewed + '">' + (it.reviewed ? "✓ Reviewed" : "Mark reviewed") + "</button>" +
          '<button type="button" class="refresh" data-wk-del="' + esc(it.k) + '">Remove</button></div></div>';
      }).join("") + "</div>" : '<p class="obs">Nothing here yet. Open any report and use ☆ Save, Mark reviewed or Add note.</p>') +
      '<h3>Keep your work when you change phone</h3><p class="obs">Export writes every country\'s saved items and notes to a file. Import merges a file back in; the newer copy of each item wins.</p>' +
      '<p class="wkbtns"><button type="button" class="refresh" data-wk-act="notes-out">Export my notes (.json)</button>' +
      '<label class="refresh wkfile">Import notes file<input type="file" accept="application/json,.json" data-wk-import hidden></label></p>';
  }
  function tabExport() {
    var A = area(), PR = periodRange(), v = currentView();
    var sc = WK.scope || "tab", ua = WK.useArea !== false && !!A, S = exportSet(sc, ua);
    return '<p class="obs">Exports carry each item\'s source link, SHA-256 record fingerprint and claim status. Your notes and marks go in separate analyst_ columns. Files are made in this browser; nothing is uploaded.</p>' +
      '<div class="wkctl"><span class="seg" role="group" aria-label="What to export"><button type="button" data-wk-scope="tab" aria-pressed="' + (sc === "tab") + '">Open tab: ' + esc(layerName(v)) + "</button>" +
      '<button type="button" data-wk-scope="all" aria-pressed="' + (sc === "all") + '">All reports</button></span>' +
      (A ? '<label class="wkchk"><input type="checkbox" data-wk-uarea' + (ua ? " checked" : "") + "> Only the drawn area</label>" : "") + "</div>" +
      '<p class="obs"><b>' + S.list.length + "</b> items · period: " + esc(PR.label) + (ua ? " · inside the drawn area" : A ? "" : " · no drawn area") + (S.note ? "<br>" + esc(S.note) : "") + "</p>" +
      '<p class="wkbtns"><button type="button" class="refresh primary" data-wk-exp="sitrep">Situation report (print or PDF)</button>' +
      '<button type="button" class="refresh" data-wk-exp="kml">KML</button><button type="button" class="refresh" data-wk-exp="geojson">GeoJSON</button><button type="button" class="refresh" data-wk-exp="csv">CSV</button></p>' +
      '<p class="obs">KML holds only items with a map location. The situation report lists the newest 300; CSV and GeoJSON hold every item. To save a PDF, choose "Save as PDF" in the print dialog.</p>';
  }
  function openRecordKey(k) {
    var r = recByKey(k); if (!r || !window.TSAP) return;
    closeWk();
    var rv = document.getElementById("rv");
    if (rv && rv.hidden) { var b = document.querySelector('button[data-rv-mode="split"]'); if (b) b.click(); }
    setTimeout(function () { try { window.TSAP.select(r.id, true, "rv-pkg"); } catch (e) {} }, 80);
  }
  box.addEventListener("click", function (e) {
    var t = e.target;
    if (t === box) { closeWk(); return; }
    var b = t.closest && t.closest("button,[data-wk-open]");
    if (!b) return;
    if (b.classList.contains("x")) { closeWk(); return; }
    var a;
    if ((a = b.getAttribute("data-wk-tab"))) { WK.tab = a; renderTab(); }
    else if ((a = b.getAttribute("data-wk-open"))) openRecordKey(a);
    else if ((a = b.getAttribute("data-wk-unit"))) { WK.unit = a; renderTab(); }
    else if ((a = b.getAttribute("data-wk-f"))) { WK.savedF = a; renderTab(); }
    else if ((a = b.getAttribute("data-wk-scope"))) { WK.scope = a; renderTab(); }
    else if ((a = b.getAttribute("data-wk-exp"))) { if (a === "sitrep") { var sc = WK.scope || "tab", ua = WK.useArea !== false && !!area(); closeWk(); sitrep(sc, ua); } else exportAs(a, WK.scope || "tab", WK.useArea !== false && !!area()); }
    else if ((a = b.getAttribute("data-wk-act"))) { if (a === "seen") markAllSeen(); else if (a === "notes-out") exportNotes(); }
    else if ((a = b.getAttribute("data-wk-tog"))) {
      var k = b.getAttribute("data-k"), it = WORK.items[k]; if (!it) return;
      var r = recByKey(k);
      if (r) setFlag(r, a, !it[a]); else { it[a] = !it[a]; touch(it); prune(k); saveWork(); decorate(); badge(); }
      renderTab();
    } else if ((a = b.getAttribute("data-wk-del"))) { delete WORK.items[a]; saveWork(); decorate(); badge(); renderTab(); }
  });
  box.addEventListener("change", function (e) {
    var t = e.target;
    if (t.hasAttribute("data-wk-tarea")) { WK.trendArea = t.checked; renderTab(); }
    else if (t.hasAttribute("data-wk-uarea")) { WK.useArea = t.checked; renderTab(); }
    else if (t.hasAttribute("data-wk-import")) { importNotes(t.files && t.files[0]); t.value = ""; }
    else if (t.hasAttribute("data-wk-note")) {
      var k = t.getAttribute("data-wk-note"), it = WORK.items[k]; if (!it) return;
      var r = recByKey(k);
      if (r) setNote(r, t.value); else { it.note = t.value.slice(0, 4000); touch(it); saveWork(); }
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && WK.open) closeWk(); });

  /* ---------- the report package: Save / Mark reviewed / Note, shown as the analyst's own section ---------- */
  function pkgBar(pkg) {
    var fpEl = pkg.querySelector("code[data-fp]"); if (!fpEl) return;
    var r = recById(fpEl.getAttribute("data-fp")); if (!r) return;
    var k = keyOf(r), old = pkg.querySelector(".wkpkg");
    if (old && old.getAttribute("data-k") === k) return;
    if (old) old.remove();
    var it = WORK.items[k] || {}, d = document.createElement("div");
    d.className = "wkpkg"; d.setAttribute("data-k", k);
    d.innerHTML = '<div class="wkbtns"><button type="button" class="refresh" data-p="saved" aria-pressed="' + !!it.saved + '">' + (it.saved ? "★ Saved" : "☆ Save") + "</button>" +
      '<button type="button" class="refresh" data-p="reviewed" aria-pressed="' + !!it.reviewed + '" title="You looked at it. This does not verify the report.">' + (it.reviewed ? "✓ Reviewed" : "Mark reviewed") + "</button>" +
      '<button type="button" class="refresh" data-p="note">' + (it.note ? "✎ Edit note" : "✎ Add note") + "</button>" + (isNew(k) ? '<span class="wknew">New since last visit</span>' : "") + "</div>" +
      '<div class="wkanl"' + (it.note ? "" : " hidden") + '><span class="wktag">Your note · this device only · not part of the source</span><textarea rows="3" maxlength="4000" placeholder="Your own note">' + esc(it.note || "") + "</textarea></div>";
    var chips = pkg.querySelector(".pkgchips");
    if (chips && chips.parentNode === pkg) chips.insertAdjacentElement("afterend", d); else pkg.appendChild(d);
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-p]"); if (!b) return;
      var rr = recByKey(k); if (!rr) return;
      var p = b.getAttribute("data-p"), cur = WORK.items[k] || {};
      if (p === "note") { var an = d.querySelector(".wkanl"); an.hidden = false; an.querySelector("textarea").focus(); return; }
      setFlag(rr, p, !cur[p]);
      d.remove(); pkgBar(pkg);
    });
    d.querySelector("textarea").addEventListener("change", function (e) { var rr = recByKey(k); if (rr) setNote(rr, e.target.value); });
  }
  function decorate() {
    Array.prototype.forEach.call(document.querySelectorAll(".pkghead"), function (h) { var p = h.parentNode; if (p && !p.hidden) pkgBar(p); });
    var list = document.getElementById("rv-list"); if (!list) return;
    Array.prototype.forEach.call(list.querySelectorAll(".rvcard[data-rv]"), function (c) {
      var r = recById(c.getAttribute("data-rv")), mark = "";
      if (r) { var k = keyOf(r), it = WORK.items[k]; mark = (isNew(k) ? "new " : "") + (it && it.saved ? "saved " : "") + (it && it.reviewed ? "rev " : "") + (it && it.note ? "note" : ""); }
      if (c.getAttribute("data-wk") === mark) return;
      c.setAttribute("data-wk", mark);
      var m = c.querySelector(".wkmark"); if (m) m.remove();
      if (!mark) return;
      m = document.createElement("span"); m.className = "wkmark";
      m.textContent = [/new/.test(mark) ? "NEW" : "", /saved/.test(mark) ? "★" : "", /rev/.test(mark) ? "✓" : "", /note/.test(mark) ? "✎" : ""].filter(Boolean).join(" ");
      m.title = [/new/.test(mark) ? "New since your last visit" : "", /saved/.test(mark) ? "Saved" : "", /rev/.test(mark) ? "You marked it reviewed" : "", /note/.test(mark) ? "You wrote a note" : ""].filter(Boolean).join(", ");
      c.insertBefore(m, c.firstChild);
    });
  }

  /* ---------- map button with the new count ---------- */
  var ctl = null;
  function badge() {
    if (!ctl) return;
    var n = NEWK.length, b = ctl.querySelector("[data-wk-btn=new]");
    b.innerHTML = "What's new" + (n ? ' <span class="wkn">' + (n > 999 ? "999+" : n) + "</span>" : "");
    b.title = baseSet ? n + " report" + (n === 1 ? "" : "s") + " new since your last visit" : "Reports new since your last visit show here";
  }
  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "wktoast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 4000);
  }

  var CSS = "#wk{position:fixed;inset:0;z-index:100000;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#wk .cbox{max-width:820px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#wk .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#wk .chead h2{margin:0;font-size:18px;flex:1}" +
    "#wk .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}" +
    "#wk h3{font-size:13px;margin:16px 0 4px}#wk .obs{color:var(--muted)}#wk .sub{display:block;font-size:11px;color:var(--muted);font-weight:400}" +
    ".wktabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin:4px 0 10px}" +
    ".wktabs button{background:none;border:0;border-bottom:3px solid transparent;padding:8px 10px;min-height:40px;color:var(--ink);font:inherit;cursor:pointer}" +
    ".wktabs button[aria-selected=true]{border-bottom-color:var(--accent);font-weight:600}" +
    ".wkn{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:var(--on-accent,#fff);font-size:11px;line-height:18px;text-align:center;font-weight:600}.wkn2{background:var(--muted)}" +
    ".wkctl{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:4px 0 8px}.wkchk{display:flex;gap:6px;align-items:center}" +
    "#wk .seg button{min-height:34px}" +
    ".wklist{display:flex;flex-direction:column;gap:6px}.wkrow{border:1px solid var(--line);border-radius:4px;background:var(--surface2)}" +
    ".wkopen{display:grid;gap:2px;width:100%;text-align:left;background:none;border:0;padding:8px 10px;color:var(--ink);font:inherit;cursor:pointer}.wkopen:hover{background:rgba(127,127,127,.1)}" +
    ".wkt{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.wkh{font-weight:600}.wks{font-size:11px;color:var(--muted);overflow-wrap:anywhere}" +
    ".wkmine{padding:8px 10px}.wkfp{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;overflow-wrap:anywhere}" +
    ".wkbtns{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}.wkbtns .refresh{min-height:34px}.wkfile{cursor:pointer;display:inline-flex;align-items:center}" +
    ".wkchips{display:flex;flex-wrap:wrap;gap:4px}.wkchip{border:1px solid var(--line);border-radius:10px;padding:1px 8px;font-size:11px}" +
    ".wkanl{border-left:3px dashed var(--accent);padding:4px 0 4px 8px;margin:6px 0}.wkanl textarea{width:100%;box-sizing:border-box;font:inherit;font-size:13px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:6px}" +
    ".wktag{display:block;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:2px}" +
    ".wkpkg{margin:8px 0 4px}.wknew{font-size:11px;font-weight:600;color:var(--accent)}" +
    ".wktr{width:100%;border-collapse:collapse}.wktr th{text-align:left;font-weight:600;padding:4px 8px 4px 0;width:34%;vertical-align:middle}.wktr td{padding:3px 0}.wktr tr+tr{border-top:1px solid var(--line)}.wktot th{font-weight:700}" +
    ".wkspark{display:block;width:100%;height:34px}.wkspark .wkbar{fill:var(--accent)}.wktot .wkspark .wkbar{fill:var(--ink)}.wkspark .wkhit{fill:transparent}.wkspark g:hover .wkbar{opacity:.7}.wkspark .wkbase{stroke:var(--line);stroke-width:1}" +
    ".wkscroll{overflow:auto;max-width:100%}.wktab{border-collapse:collapse;font-size:11px}.wktab td,.wktab th{border:1px solid var(--line);padding:2px 4px;text-align:right;white-space:nowrap}.wktab td:first-child,.wktab th:first-child{text-align:left}" +
    ".wkctlmap{display:flex;flex-direction:column;gap:4px}.wkctlmap button{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:5px 9px;min-height:32px;font-family:inherit;font-size:13px;font-weight:600;line-height:1.2;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);text-align:left}" +
    ".rvcard .wkmark{float:right;font-size:10px;font-weight:700;color:var(--accent);margin-left:6px}" +
    ".wktoast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;background:var(--ink);color:var(--surface);padding:8px 14px;border-radius:6px;font-size:13px;max-width:90vw}" +
    "#wk-print{display:none}" +
    "@media print{html.wk-printing body>*:not(#wk-print){display:none!important}html.wk-printing #wk-print{display:block;color:#000;background:#fff;font:10px/1.35 'IBM Plex Sans',Arial,sans-serif}" +
    "#wk-print h1{font-size:18px;margin:0 0 4px}#wk-print h2{font-size:13px;margin:12px 0 4px;break-after:avoid}#wk-print table{width:100%!important;border-collapse:collapse;table-layout:fixed}#wk-print th,#wk-print td{border:1px solid #999;padding:3px 4px;text-align:left;vertical-align:top;white-space:normal!important;background:none!important;color:#000;text-transform:none!important;letter-spacing:0!important;font-size:10px;font-family:inherit;overflow-wrap:anywhere}#wk-print th{font-weight:700}" +
    "#wk-print tr{break-inside:avoid;background:none!important}#wk-print .wkpm{color:#333;margin:2px 0}#wk-print .wkps{color:#444;font-size:9px;overflow-wrap:anywhere}#wk-print .wkfp{font-family:monospace;font-size:8px}" +
    "#wk-print .wkpnote{border-left:2px dashed #000;padding-left:4px;margin-top:2px;white-space:pre-wrap}}";

  function start() {
    CC = (window.TSAP && window.TSAP.country) || "th";
    map = window.__asapMap;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.body.appendChild(box);
    loadSeen();
    if (map && window.L) {
      var Ctl = L.Control.extend({ options: { position: "topright" }, onAdd: function () {
        var d = L.DomUtil.create("div", "leaflet-control wkctlmap");
        d.innerHTML = '<button type="button" data-wk-btn="new">What\'s new</button><button type="button" data-wk-btn="mine">My work</button>';
        L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
        d.addEventListener("click", function (e) { var b = e.target.closest("[data-wk-btn]"); if (b) openWk(b.getAttribute("data-wk-btn") === "new" ? "new" : "mine"); });
        return d; } });
      ctl = new Ctl().addTo(map).getContainer();
    }
    trackSeen(true);
    /* records keep arriving after load (feed history, hazards, live refresh), so the count follows them */
    setInterval(function () { trackSeen(false); }, 5000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { SEEN.lastAt = Date.now(); lsSet(SEEN_PREFIX + CC, SEEN); } });
    var pend = false;
    new MutationObserver(function () { if (pend) return; pend = true; setTimeout(function () { pend = false; decorate(); }, 50); })
      .observe(document.body, { childList: true, subtree: true });
    decorate();
    window.OSAP_WORK = { open: openWk, keyOf: keyOf, items: function () { return WORK.items; } };
  }
  (function wait(n) { if (window.TSAP && window.TSAP.records) start(); else if (n < 200) setTimeout(function () { wait(n + 1); }, 100); })(0);
})();
