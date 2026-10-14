/* AXIOM OSAP: the analyst workspace (Shane 2026-10-14, thread "Thai southern border": "an analyst workspace that is available
   only to me", with an entity database, possible insurgent bed-down locations, "link analysis, timeline, saved reports, saved
   images, saved locations").
   Only a device unlocked with the owner's Face ID (assets/osap-lock.js, Settings > Hidden areas) gets it: there the toolbar gains
   an "Analyst" button after My work. On every other device this file stops at the first line and adds nothing.
   Tabs, all built from what this page already holds (window.ASAP_DS, the Deep South reporting) and the analyst's own work:
   - Entities: the reference list in data/thailand/deepsouth-entities.js (window.OSAP_DS_ENT: organisations, units and agencies,
     no private people; each role line a draft, AI-generated) plus the analyst's own entities and notes, with how many reports in
     the period name each one. A mention is a machine match of a name in the report text, not a claim about what anyone did.
   - Links: a network drawn from co-mentions (two entities, or an entity and a district, named in the same report) and from the
     analyst's own links. Co-mention lines are dashed and say so: being named together is not a relationship. Solid lines are
     the analyst's own judgements, kept apart from the machine ones.
   - Timeline: the reports that name an entity or a district, newest first, with the analyst's saved reports and points, in
     Zulu and local (Thailand, UTC+7) time.
   - Saved: My work's saved reports (assets/osap-work.js), the dropped points (saved locations, "osap-atak-pts") and their photos
     (saved images, IndexedDB via assets/osap-points.js). Nothing is copied: this tab shows the same stores.
   - Bed-down: a possible bed-down INDICATOR per district: how many reports in the period describe security-force searches,
     cordons, hideouts, camps or weapons and bomb-making finds there, with the terrain items that fall inside the district. Where
     the security forces searched is not proof of where insurgents stay; the tab says so and never calls a district a bed-down.
   The analyst's entities and links are kept in this browser only (localStorage "osap-an-ent", "osap-an-links", both carried by
   workspaces in assets/osap-ws.js). Nothing is sent anywhere. */
(function () {
  "use strict";
  var W = window, D = document;
  if (!W.OSAP_LOCK || !W.OSAP_LOCK.isOpen()) return;
  var K_ENT = "osap-an-ent", K_LINK = "osap-an-links", K_UI = "osap-an-ui";
  var ENT_SRC = "data/thailand/deepsouth-entities.js", AREAS_SRC = "data/places/deepsouth-areas.json";
  var LOCAL_H = 7, LOCAL_N = "Thailand";
  var TABS = [["ents", "Entities"], ["links", "Links"], ["time", "Timeline"], ["saved", "Saved"], ["bed", "Bed-down"]];
  var PERIODS = [[30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "All kept"]];
  var TYPES = ["organisation", "armed group", "unit", "agency", "person (sanctioned or charged only)", "place", "vehicle", "other"];
  var RELS = ["member of", "commands", "works with", "supplies", "operates in", "opposes", "talks with", "other"];
  /* bed-down indicator: the words of a search, a cordon or a find; drug seizures are left out (they are not about where cells stay) */
  var FIND = /\b(raid(?:ed|s)?|cordon(?:ed)?|hide-?outs?|safe ?houses?|hiding (?:place|spot)s?|camps?|caches?|bomb[- ]making|weapons? (?:store|depot|found|seized)|seiz(?:e|ed|ing) (?:weapons?|guns?|rifles?|bombs?|explosives?|ammunition)|found (?:weapons?|guns?|rifles?|bombs?|explosives?|ammunition)|search(?:ed)? (?:a |the )?(?:house|houses|village|hut|woodshed|plantation|forest|mountain)|surround(?:ed)? (?:a |the )?(?:house|hut|village))\b|ปิดล้อม|ตรวจค้น|ที่หลบซ่อน|แหล่งกบดาน|กบดาน|ฐานปฏิบัติการ|คลังอาวุธ|แหล่งประกอบระเบิด|ตรวจยึดอาวุธ|พบอาวุธ/i;
  var NOTFIND = /\b(ice|crystal meth|methamphetamine|ya ?ba|kratom|drugs?|narcotics?|heroin|smuggl\w* (?:fuel|cigarettes|rice))\b|ยาบ้า|ยาไอซ์|ไอซ์|กระท่อม|ยาเสพติด|training|exercise|ฝึก/i;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast("This browser would not store that (storage full or blocked)."); return false; } }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function rid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n); }
  function num(n) { return Number(n || 0).toLocaleString("en-US"); }
  var AI = '<span class="aitag" tabindex="0" title="Draft, AI-generated, not analyst-approved.">AI generated</span>';
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  /* a time both ways: Zulu and Thailand local, 24-hour */
  function zl(ms) {
    if (!isFinite(ms)) return "";
    var z = new Date(ms), l = new Date(ms + LOCAL_H * 36e5);
    return z.getUTCFullYear() + "-" + pad(z.getUTCMonth() + 1) + "-" + pad(z.getUTCDate()) + " " + pad(z.getUTCHours()) + pad(z.getUTCMinutes()) + "Z (" +
      pad(l.getUTCHours()) + pad(l.getUTCMinutes()) + " " + LOCAL_N + ")";
  }
  function seenMs(i) { var s = String(i.first_seen || ""), m = s.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)Z$/); return m ? Date.parse(m[1] + "T" + m[2] + ":00Z") : NaN; }
  /* the outlet's own date is used for the period and the order (it has no zone; read as Thailand time) */
  function dateMs(i) { var t = Date.parse(String(i.date || "").slice(0, 16) + ":00+07:00"); return isFinite(t) ? t : seenMs(i); }

  /* ---------- state ---------- */
  var UI = lsGet(K_UI, {}); if (typeof UI !== "object" || !UI) UI = {};
  var S = { tab: TABS.some(function (t) { return t[0] === UI.tab; }) ? UI.tab : "ents", days: [30, 90, 365, 0].indexOf(UI.days) >= 0 ? UI.days : 90,
    sel: null, q: "", tf: "", bedMap: false, el: null, layer: null, areas: null, areasErr: "", entsErr: "" };
  function saveUi() { lsSet(K_UI, { tab: S.tab, days: S.days }); }
  function ownEnts() { var v = lsGet(K_ENT, null); if (!v || typeof v !== "object" || !Array.isArray(v.items)) v = { schema: "osap-an-ent/1", items: [], notes: {} }; if (!v.notes || typeof v.notes !== "object") v.notes = {}; return v; }
  function ownLinks() { var v = lsGet(K_LINK, null); if (!v || typeof v !== "object" || !Array.isArray(v.items)) v = { schema: "osap-an-links/1", items: [] }; return v; }

  /* ---------- data ---------- */
  function script(src) {
    return new Promise(function (ok, no) { var s = D.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { s.remove(); no(new Error("could not load " + src)); }; D.head.appendChild(s); });
  }
  function needEnts() {
    if (W.OSAP_DS_ENT) return Promise.resolve();
    return script(ENT_SRC).then(function () { S.entsErr = ""; }, function () { S.entsErr = "The entity list could not load. Check the connection."; });
  }
  function needAreas() {
    if (S.areas) return Promise.resolve(S.areas);
    return fetch(AREAS_SRC).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { S.areas = (j && j.areas) || []; S.areasErr = ""; return S.areas; }, function () { S.areasErr = "The district outlines could not load."; S.areas = null; return null; });
  }
  function reports() { return ((W.ASAP_DS || {}).items || []).filter(function (i) { return i && safeUrl(i.link); }); }
  function inPeriod(i) { return !S.days || dateMs(i) >= Date.now() - S.days * 864e5; }
  function textOf(i) { return [i.title, i.title_en, i.summary, i.summary_en].filter(Boolean).join(" \n "); }
  function titleOf(i) { return String(i.title_en || i.title || "Untitled report"); }
  function distOf(i) { var g = i.geo || {}; return /^TH-\d{4}$/.test(g.id || "") ? g.id : ""; }
  function distName(id) {
    var a = (S.areas || []).filter(function (x) { return x.id === id; })[0]; if (a) return a.name;
    var r = reports().filter(function (i) { return distOf(i) === id; })[0]; return r ? String(r.geo.n || id).replace(/ district,.*$/, "") : id;
  }
  /* every entity, reference and own, with a matcher built from its names */
  function entities() {
    var ref = ((W.OSAP_DS_ENT || {}).entities || []).map(function (e) { return { id: e.id, name: e.name, type: e.entity_type, group: e.group, aliases: e.aliases || [], role: e.role, src: e.src, srcname: e.srcname, fp: e.fp, ref: true }; });
    var own = ownEnts().items.map(function (e) { return { id: e.id, name: e.name, type: e.type, group: "Your entities", aliases: [e.name].concat(e.aliases || []), note: e.note, created: e.created, own: true }; });
    return ref.concat(own).map(function (e) {
      var pats = (e.aliases.length ? e.aliases : [e.name]).filter(function (a) { return String(a).trim().length >= 2; }).map(function (a) {
        a = String(a).trim(); var q = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        /* Latin names match whole words, in any case for long names and exact case for short ones (BRN, not "brn" inside a word) */
        return /^[\x20-\x7e]+$/.test(a) ? new RegExp("(^|[^A-Za-z0-9])" + q + "(?![A-Za-z0-9])", a.length <= 4 ? "" : "i") : { test: function (t) { return t.indexOf(a) >= 0; } };
      });
      e.match = function (t) { return pats.some(function (p) { return p.test(t); }); };
      return e;
    });
  }
  /* which entities each report in the period names */
  function index() {
    var E = entities(), R = reports().filter(inPeriod), by = {}, rows = [];
    E.forEach(function (e) { by[e.id] = []; });
    R.forEach(function (i) {
      var t = textOf(i), hit = E.filter(function (e) { return e.match(t); }).map(function (e) { return e.id; });
      hit.forEach(function (id) { by[id].push(i); });
      rows.push({ i: i, ents: hit, d: distOf(i) });
    });
    return { E: E, by: by, rows: rows };
  }

  /* ---------- the panel ---------- */
  function style() {
    if (D.getElementById("anws-css")) return;
    var s = D.createElement("style"); s.id = "anws-css";
    s.textContent =
      "#anws:not([hidden]){position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
      "#anws .anbox{background:var(--surface,#fff);color:var(--ink,#1d2329);width:min(980px,100%);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:0 14px 14px;font-size:13px;line-height:1.4}" +
      "#anws .chead{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--surface,#fff);padding:10px 0 8px;border-bottom:1px solid var(--line,#d5dbe1)}" +
      "#anws .chead h2{flex:1;min-width:max-content;font-size:15px;margin:0}#anws h3{font-size:13.5px;margin:12px 0 6px}#anws .obs{color:var(--muted,#56626f)}" +
      "#anws button,#anws select,#anws input,#anws textarea{font:inherit;font-size:12.5px}" +
      "#anws button{border:1px solid var(--line,#d5dbe1);background:var(--surface2,var(--surface,#fff));color:var(--ink,#1d2329);border-radius:4px;padding:4px 9px;min-height:32px;cursor:pointer;font-weight:600}" +
      "#anws button[aria-pressed=true],#anws button.go{background:var(--accent,#1c5d99);color:var(--on-accent,#fff);border-color:var(--accent,#1c5d99)}" +
      "#anws .x{font-size:24px;min-width:40px;border:none;background:none}" +
      "#anws select,#anws input,#anws textarea{border:1px solid var(--line,#d5dbe1);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1d2329);padding:4px 6px;min-height:32px;max-width:100%}" +
      "#anws .antabs{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}#anws .anrow{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;margin:6px 0}" +
      "#anws .anrow label{display:flex;flex-direction:column;gap:2px;font-size:12px}#anws table{border-collapse:collapse;width:100%;margin:4px 0}" +
      "#anws th,#anws td{border-bottom:1px solid var(--line,#d5dbe1);padding:3px 6px;text-align:left;vertical-align:top}#anws th{font-size:11.5px;color:var(--muted,#56626f)}" +
      "#anws td.n{text-align:right;white-space:nowrap}#anws .ancard{border:1px solid var(--line,#d5dbe1);border-radius:6px;padding:6px 9px;margin:6px 0}" +
      "#anws .ancard.sel{border-color:var(--accent,#1c5d99);box-shadow:0 0 0 1px var(--accent,#1c5d99)}#anws .anal{font-size:11.5px;color:var(--muted,#56626f)}" +
      "#anws details{margin:6px 0}#anws summary{cursor:pointer;font-weight:600}#anws .angraph{width:100%;height:auto;border:1px solid var(--line,#d5dbe1);border-radius:6px;background:var(--surface2,#f5f7f9)}" +
      "#anws .angraph text{font-size:10.5px;fill:var(--ink,#1d2329);pointer-events:none}#anws .angraph circle,#anws .angraph rect{cursor:pointer}" +
      "#anws .anday{font-weight:700;margin:10px 0 2px}#anws .anit{margin:3px 0 3px 8px;padding-left:8px;border-left:3px solid var(--line,#d5dbe1)}#anws .anit.mine{border-left-color:#2b8a3e}" +
      "#anws .anbar{display:inline-block;height:8px;background:#e67700;border-radius:2px;vertical-align:middle;margin-right:4px}#anws .anwarn{background:rgba(230,119,0,.1);border-left:3px solid #e67700;padding:6px 10px;margin:6px 0}" +
      "#anws .atk-pph{display:flex;flex-wrap:wrap;gap:4px}#anws .atk-pph img{width:84px;height:84px;object-fit:cover;border-radius:4px}#anws .atk-pph button{padding:0;border:none;min-height:0}" +
      "#atk-tools [data-an-btn] svg{width:20px;height:20px}" +
      ".leaflet-pane.leaflet-anpane-pane{visibility:visible!important}";
    D.head.appendChild(s);
  }
  function box() {
    if (S.el) return S.el;
    var el = S.el = D.createElement("div"); el.id = "anws"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Analyst workspace");
    D.body.appendChild(el);
    el.addEventListener("click", onClick); el.addEventListener("change", onChange);
    el.addEventListener("input", function (e) { if (e.target.id === "an-q") { S.q = e.target.value; var c = e.target.selectionStart; render(); var q = D.getElementById("an-q"); if (q) { q.focus(); try { q.setSelectionRange(c, c); } catch (x) {} } } });
    el.addEventListener("submit", onSubmit);
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    return el;
  }
  function open(tab) {
    style(); var el = box();
    if (tab) S.tab = tab;
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen()) W.OSAP_TODAY.hide();
    el.hidden = false; render();
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply();
    Promise.all([needEnts(), needAreas()]).then(function () { if (!el.hidden) render(); });
    paintBtn();
  }
  function close() { if (S.el) S.el.hidden = true; if (S.layer && W.__asapMap) { W.__asapMap.removeLayer(S.layer); S.layer = null; } if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply(); paintBtn(); }
  function isOpen() { return !!(S.el && !S.el.hidden); }

  function render() {
    var el = S.el; if (!el) return;
    var X = index(), h = '<div class="anbox"><div class="chead"><h2>Analyst workspace</h2>' +
      '<label class="anal">Period <select id="an-days">' + PERIODS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === S.days ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select></label>" +
      '<button type="button" class="x" data-an="close" aria-label="Close">\u00d7</button></div>' +
      '<p class="anal">Only on this device, while it is unlocked with your Face ID. Thailand Deep South reporting: ' + num(X.rows.length) + " reports in the period" +
      ((W.ASAP_DS || {}).asof ? ", read " + esc(W.ASAP_DS.asof) : "") + ". Your entities, links and notes stay in this browser.</p>" +
      '<div class="antabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-an-tab="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>";
    if (S.entsErr) h += '<p class="anwarn">' + esc(S.entsErr) + "</p>";
    h += S.tab === "links" ? tabLinks(X) : S.tab === "time" ? tabTime(X) : S.tab === "saved" ? tabSaved() : S.tab === "bed" ? tabBed() : tabEnts(X);
    el.innerHTML = h + "</div>";
    if (S.tab === "saved") fillPhotos();
    drawBed();
  }

  /* ---------- Entities ---------- */
  function tabEnts(X) {
    var q = S.q.trim().toLowerCase(), notes = ownEnts().notes;
    var E = X.E.filter(function (e) { return !q || [e.name, e.type, e.group, e.role, e.note].concat(e.aliases).join(" ").toLowerCase().indexOf(q) >= 0; });
    var groups = []; E.forEach(function (e) { if (groups.indexOf(e.group) < 0) groups.push(e.group); });
    var h = '<div class="anrow"><label>Find <input id="an-q" type="search" value="' + esc(S.q) + '" placeholder="Name, alias, type"></label></div>' +
      '<p class="anal">Mentions = reports in the period whose text names the entity (a machine match on its names, in English, Thai and Malay). Being named is not a finding about what it did.</p>';
    groups.forEach(function (g) {
      var L = E.filter(function (e) { return e.group === g; }).sort(function (a, b) { return X.by[b.id].length - X.by[a.id].length; });
      h += "<h3>" + esc(g) + "</h3>" + L.map(function (e) {
        var n = X.by[e.id].length, note = e.own ? e.note : notes[e.id];
        return '<div class="ancard' + (S.sel === e.id ? " sel" : "") + '"><b>' + esc(e.name) + '</b> <span class="anal">' + esc(e.type || "") + " \u00b7 " + num(n) + " mention" + (n === 1 ? "" : "s") + "</span>" +
          (e.aliases.length > 1 || e.ref ? '<div class="anal">Also: ' + esc(e.aliases.filter(function (a) { return a !== e.name; }).join(", ")) + "</div>" : "") +
          (e.role ? "<div>" + esc(e.role) + " " + AI + "</div>" : "") +
          (e.ref && safeUrl(e.src) ? '<div class="anal">Source: <a href="' + esc(e.src) + '" target="_blank" rel="noopener">' + esc(e.srcname || "link") + "</a>" + (e.fp ? " \u00b7 SHA-256 " + esc(String(e.fp).slice(0, 12)) + "\u2026" : "") + "</div>" : "") +
          (note ? '<div><b>Your note:</b> ' + esc(note) + "</div>" : "") +
          '<div class="anrow"><button type="button" data-an-go="time" data-an-e="' + esc(e.id) + '">Timeline</button><button type="button" data-an-go="links" data-an-e="' + esc(e.id) + '">Links</button>' +
          '<button type="button" data-an-note="' + esc(e.id) + '">' + (note ? "Edit note" : "Add note") + "</button>" +
          (e.own ? '<button type="button" data-an-del="' + esc(e.id) + '">Delete</button>' : "") + "</div></div>";
      }).join("");
    });
    if (!E.length) h += '<p class="obs">' + (W.OSAP_DS_ENT ? "No entity matches." : "Loading the entity list\u2026") + "</p>";
    h += '<details><summary>Add your own entity</summary><form id="an-addent" class="anrow">' +
      '<label>Name <input name="name" required maxlength="120"></label><label>Type <select name="type">' + TYPES.map(function (t) { return "<option>" + esc(t) + "</option>"; }).join("") + "</select></label>" +
      '<label>Other names (comma between) <input name="aliases" maxlength="400"></label><label>Note <input name="note" maxlength="1000"></label><button type="submit" class="go">Add</button></form>' +
      '<p class="anal">Organisations, units and places. A private person only when sanctioned or charged. Kept in this browser only.</p></details>';
    return h;
  }

  /* ---------- Links ---------- */
  function graph(X) {
    var nodes = {}, edges = {};
    function node(id, label, kind, w) { if (!nodes[id]) nodes[id] = { id: id, label: label, kind: kind, w: 0 }; nodes[id].w += w || 0; return nodes[id]; }
    function edge(a, b, kind) { if (a === b) return; var k = a < b ? a + "|" + b : b + "|" + a, e = edges[k] || (edges[k] = { a: a < b ? a : b, b: a < b ? b : a, n: 0, kind: kind, rep: [] }); return e; }
    var name = {}; X.E.forEach(function (e) { name[e.id] = e.name; });
    X.rows.forEach(function (r) {
      if (!r.ents.length) return;
      r.ents.forEach(function (id) { node(id, name[id], "ent", 1); });
      for (var i = 0; i < r.ents.length; i++) for (var j = i + 1; j < r.ents.length; j++) { var e = edge(r.ents[i], r.ents[j], "co"); e.n++; e.rep.push(r.i); }
      if (r.d) r.ents.forEach(function (id) { node("d:" + r.d, distName(r.d), "dist", 1); var e = edge(id, "d:" + r.d, "co"); e.n++; e.rep.push(r.i); });
    });
    ownLinks().items.forEach(function (l) {
      if (!l.a || !l.b) return;
      [l.a, l.b].forEach(function (id) { if (/^d:/.test(id)) node(id, distName(id.slice(2)), "dist", 0); else node(id, name[id] || id, "ent", 0); });
      var k = "own:" + l.id; edges[k] = { a: l.a, b: l.b, kind: "own", rel: l.rel, note: l.note, id: l.id, n: 0 };
    });
    /* keep it readable: the 14 most-named entities, the 10 districts most tied to them, the selection and everything the analyst linked */
    var N = Object.keys(nodes).map(function (k) { return nodes[k]; }), keep = {};
    N.filter(function (n) { return n.kind === "ent"; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 14).forEach(function (n) { keep[n.id] = 1; });
    N.filter(function (n) { return n.kind === "dist"; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 10).forEach(function (n) { keep[n.id] = 1; });
    var E = Object.keys(edges).map(function (k) { return edges[k]; });
    E.forEach(function (e) { if (e.kind === "own") keep[e.a] = keep[e.b] = 1; });
    if (S.sel && nodes[S.sel]) { keep[S.sel] = 1; E.forEach(function (e) { if (e.a === S.sel || e.b === S.sel) keep[e.a] = keep[e.b] = 1; }); }
    N = N.filter(function (n) { return keep[n.id]; });
    E = E.filter(function (e) { return keep[e.a] && keep[e.b]; });
    return { N: N, E: E, nodes: nodes };
  }
  /* a small force layout, started from a circle so the same data always draws the same picture */
  function layout(N, E, w, h) {
    var at = {}; N.forEach(function (n, i) { var a = 2 * Math.PI * i / Math.max(1, N.length); n.x = w / 2 + Math.cos(a) * w * 0.36; n.y = h / 2 + Math.sin(a) * h * 0.36; at[n.id] = n; });
    for (var it = 0; it < 220; it++) {
      var t = 1 - it / 220;
      N.forEach(function (a) { a.fx = 0; a.fy = 0; });
      for (var i = 0; i < N.length; i++) for (var j = i + 1; j < N.length; j++) {
        var a = N[i], b = N[j], dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 25), f = 5200 / d2;
        a.fx += dx * f / Math.sqrt(d2); a.fy += dy * f / Math.sqrt(d2); b.fx -= dx * f / Math.sqrt(d2); b.fy -= dy * f / Math.sqrt(d2);
      }
      E.forEach(function (e) { var a = at[e.a], b = at[e.b]; if (!a || !b) return; var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 110) * 0.02; a.fx += dx / d * f * d * 0.05; a.fy += dy / d * f * d * 0.05; b.fx -= dx / d * f * d * 0.05; b.fy -= dy / d * f * d * 0.05; });
      N.forEach(function (a) { a.fx += (w / 2 - a.x) * 0.01; a.fy += (h / 2 - a.y) * 0.01; a.x = Math.max(40, Math.min(w - 40, a.x + Math.max(-12, Math.min(12, a.fx)) * t)); a.y = Math.max(20, Math.min(h - 20, a.y + Math.max(-12, Math.min(12, a.fy)) * t)); });
    }
    /* then stretch the drawing to fill the frame, so a small network is not a knot in the middle */
    if (N.length > 1) {
      var x0 = Math.min.apply(null, N.map(function (n) { return n.x; })), x1 = Math.max.apply(null, N.map(function (n) { return n.x; })),
        y0 = Math.min.apply(null, N.map(function (n) { return n.y; })), y1 = Math.max.apply(null, N.map(function (n) { return n.y; }));
      N.forEach(function (n) { n.x = 70 + (x1 > x0 ? (n.x - x0) / (x1 - x0) : 0.5) * (w - 140); n.y = 30 + (y1 > y0 ? (n.y - y0) / (y1 - y0) : 0.5) * (h - 60); });
    }
    return at;
  }
  function tabLinks(X) {
    var G = graph(X), w = 640, hh = G.N.length > 12 ? 440 : 340, at = layout(G.N, G.E, w, hh);
    var h = '<p class="anal">Dashed grey: named in the same report (the number on hover), which is not a relationship. Solid green: your own links. Blue circles are entities, brown squares districts. Tap one to see its connections.</p>';
    if (!G.N.length) return h + '<p class="obs">No entity is named in the reports of this period yet' + (W.OSAP_DS_ENT ? "" : " (the entity list is still loading)") + ".</p>" + linkForm(X);
    h += '<svg class="angraph" viewBox="0 0 ' + w + " " + hh + '" role="img" aria-label="Link chart">' +
      G.E.map(function (e) { var a = at[e.a], b = at[e.b]; if (!a || !b) return ""; var own = e.kind === "own", on = S.sel && (e.a === S.sel || e.b === S.sel);
        return '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="' + (own ? "#2b8a3e" : on ? "#1c5d99" : "#8a96a3") + '" stroke-width="' + (own ? 2.5 : Math.min(6, 0.8 + Math.log(1 + e.n) * 1.2)).toFixed(1) + '"' + (own ? "" : ' stroke-dasharray="5 4"') + ' opacity="' + (S.sel && !on ? 0.25 : 0.85) + '"><title>' + esc(own ? (G.nodes[e.a] || {}).label + " \u2014 " + e.rel + " \u2014 " + (G.nodes[e.b] || {}).label + " (your link)" : (G.nodes[e.a] || {}).label + " and " + (G.nodes[e.b] || {}).label + ": named together in " + e.n + " report" + (e.n === 1 ? "" : "s")) + "</title></line>"; }).join("") +
      G.N.map(function (n) { var r = Math.min(18, 6 + Math.sqrt(n.w) * 2), on = S.sel === n.id, x = n.x.toFixed(1), y = n.y.toFixed(1);
        return '<g data-an-node="' + esc(n.id) + '">' + (n.kind === "dist" ? '<rect x="' + (n.x - r * 0.8).toFixed(1) + '" y="' + (n.y - r * 0.8).toFixed(1) + '" width="' + (r * 1.6).toFixed(1) + '" height="' + (r * 1.6).toFixed(1) + '" fill="#8d6e63"' : '<circle cx="' + x + '" cy="' + y + '" r="' + r.toFixed(1) + '" fill="#1c5d99"') +
          ' stroke="' + (on ? "#e67700" : "#fff") + '" stroke-width="' + (on ? 3 : 1.5) + '"><title>' + esc(n.label) + "</title></" + (n.kind === "dist" ? "rect" : "circle") + ">" +
          '<text x="' + x + '" y="' + (n.y + r + 11).toFixed(1) + '" text-anchor="middle">' + esc(String(n.label).length > 26 ? String(n.label).slice(0, 25) + "\u2026" : n.label) + "</text></g>"; }).join("") + "</svg>";
    if (S.sel && G.nodes[S.sel]) {
      var mine = G.E.filter(function (e) { return e.a === S.sel || e.b === S.sel; }).sort(function (a, b) { return (b.kind === "own") - (a.kind === "own") || b.n - a.n; });
      h += "<h3>" + esc(G.nodes[S.sel].label) + "</h3><table><tr><th>Connected to</th><th>How</th><th></th></tr>" + mine.map(function (e) {
        var o = G.nodes[e.a === S.sel ? e.b : e.a] || {};
        return "<tr><td>" + esc(o.label) + "</td><td>" + (e.kind === "own" ? "<b>Your link:</b> " + esc(e.rel) + (e.note ? " \u00b7 " + esc(e.note) : "") : "Named together in " + num(e.n) + " report" + (e.n === 1 ? "" : "s") + " (machine match)") + "</td><td>" +
          (e.kind === "own" ? '<button type="button" data-an-unlink="' + esc(e.id) + '">Remove</button>' : "<details><summary>Reports</summary>" + e.rep.slice(0, 12).map(repLine).join("") + "</details>") + "</td></tr>";
      }).join("") + "</table>";
    }
    return h + linkForm(X);
  }
  function linkForm(X) {
    var opts = X.E.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + "</option>"; }).join("") +
      (S.areas || []).map(function (a) { return '<option value="d:' + esc(a.id) + '">District: ' + esc(a.name) + "</option>"; }).join("");
    return '<details><summary>Add your own link</summary><form id="an-addlink" class="anrow"><label>From <select name="a">' + opts + "</select></label>" +
      '<label>Relationship <select name="rel">' + RELS.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
      '<label>To <select name="b">' + opts + '</select></label><label>Why (your basis) <input name="note" maxlength="600"></label><button type="submit" class="go">Add link</button></form>' +
      '<p class="anal">Your link is your judgement, shown solid and kept apart from the machine co-mentions. In this browser only.</p></details>';
  }
  function repLine(i) {
    var u = safeUrl(i.link);
    return '<div class="anit"><a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(titleOf(i)) + '</a> <span class="anal">' + esc(i.outlet || "") + " \u00b7 " + esc(String(i.date || "").replace("T", " ")) +
      (i.geo && i.geo.n ? " \u00b7 " + esc(i.geo.n) : "") + (i.mt ? " \u00b7 machine-translated" : "") + "</span></div>";
  }

  /* ---------- Timeline ---------- */
  function tabTime(X) {
    var f = S.tf;
    var dists = {}; X.rows.forEach(function (r) { if (r.d) dists[r.d] = 1; });
    var h = '<div class="anrow"><label>Show <select id="an-tf"><option value="">Every report that names an entity</option><option value="*"' + (f === "*" ? " selected" : "") + ">Every report</option>" +
      X.E.filter(function (e) { return X.by[e.id].length; }).map(function (e) { return '<option value="' + esc(e.id) + '"' + (f === e.id ? " selected" : "") + ">" + esc(e.name) + " (" + X.by[e.id].length + ")</option>"; }).join("") +
      Object.keys(dists).sort().map(function (d) { return '<option value="d:' + esc(d) + '"' + (f === "d:" + d ? " selected" : "") + ">District: " + esc(distName(d)) + "</option>"; }).join("") + "</select></label></div>";
    var R = X.rows.filter(function (r) { return f === "*" ? true : !f ? r.ents.length : /^d:/.test(f) ? r.d === f.slice(2) : r.ents.indexOf(f) >= 0; })
      .map(function (r) { return { t: dateMs(r.i), r: r }; });
    /* the analyst's own items in the period: saved reports and points */
    var since = S.days ? Date.now() - S.days * 864e5 : 0, mine = [];
    savedReports().forEach(function (it) { var t = Date.parse(it.at || (it.snap || {}).ts || ""); if (isFinite(t) && t >= since) mine.push({ t: t, mine: "report", it: it }); });
    points().forEach(function (p) { var t = +p.t || Date.parse(p.t || ""); if (isFinite(t) && t >= since) mine.push({ t: t, mine: "point", it: p }); });
    var all = R.concat(mine).sort(function (a, b) { return b.t - a.t; }).slice(0, 400), day = "";
    h += '<p class="anal">Report times: the outlet\'s date (Thailand time) and when OSAP first saw it, in Zulu and ' + LOCAL_N + " time. Green: your own saved items.</p>";
    if (!all.length) return h + '<p class="obs">Nothing in this period.</p>';
    all.forEach(function (x) {
      var d = new Date(x.t + LOCAL_H * 36e5).toISOString().slice(0, 10);
      if (d !== day) { day = d; h += '<div class="anday">' + esc(d) + "</div>"; }
      if (x.r) {
        var i = x.r.i, s = seenMs(i);
        h += '<div class="anit"><a href="' + esc(safeUrl(i.link)) + '" target="_blank" rel="noopener">' + esc(titleOf(i)) + '</a><div class="anal">' + esc(i.outlet || "") + (i.state ? " (government statement, a claim)" : "") +
          " \u00b7 " + esc(i.kind || "") + (i.geo && i.geo.n ? " \u00b7 " + esc(i.geo.n) : "") + (isFinite(s) ? " \u00b7 seen " + esc(zl(s)) : "") +
          (x.r.ents.length ? " \u00b7 names: " + esc(x.r.ents.map(function (id) { var e = X.E.filter(function (y) { return y.id === id; })[0]; return e ? e.name : id; }).join(", ")) : "") + "</div></div>";
      } else if (x.mine === "report") {
        var sn = x.it.snap || {};
        h += '<div class="anit mine"><b>You saved:</b> ' + (safeUrl(sn.url) ? '<a href="' + esc(sn.url) + '" target="_blank" rel="noopener">' + esc(sn.title || "report") + "</a>" : esc(sn.title || "report")) +
          '<div class="anal">' + esc(zl(x.t)) + (x.it.note ? " \u00b7 note: " + esc(x.it.note) : "") + "</div></div>";
      } else {
        h += '<div class="anit mine"><b>Your point:</b> ' + esc(x.it.n || "Point") + '<div class="anal">' + esc(zl(x.t)) + " \u00b7 " + (+x.it.lat).toFixed(5) + ", " + (+x.it.lon).toFixed(5) + "</div></div>";
      }
    });
    return h;
  }

  /* ---------- Saved ---------- */
  function savedReports() { var A = W.OSAP_WORK && W.OSAP_WORK.items ? W.OSAP_WORK.items() : (lsGet("osap-work", {}).items || {}); return Object.keys(A).map(function (k) { return A[k]; }).filter(function (it) { return it && (it.saved || it.note); }); }
  function points() { var p = lsGet("osap-atak-pts", []); return Array.isArray(p) ? p.filter(function (x) { return x && isFinite(x.lat) && isFinite(x.lon); }) : []; }
  function tabSaved() {
    var R = savedReports().sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); }), P = points(), Ph = P.filter(function (p) { return p.ph > 0; });
    var h = "<h3>Saved reports (" + R.length + ")</h3>" + (R.length ? "<table><tr><th>Report</th><th>Source</th><th>Your note</th><th></th></tr>" + R.map(function (it) {
      var s = it.snap || {}, has = s.lat != null && s.lon != null;
      return "<tr><td>" + (safeUrl(s.url) ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>" : esc(s.title)) + '<div class="anal">' + esc([s.place, s.ts, (it.cc || "").toUpperCase()].filter(Boolean).join(" \u00b7 ")) +
        (s.fp ? " \u00b7 SHA-256 " + esc(String(s.fp).slice(0, 12)) + "\u2026" : "") + "</div></td><td>" + esc(s.source || "") + (s.status ? '<div class="anal">' + esc(s.status) + "</div>" : "") + "</td><td>" + esc(it.note || "") + "</td><td>" +
        (has ? '<button type="button" data-an-fly="' + (+s.lat) + "," + (+s.lon) + '">Map</button>' : "") + "</td></tr>";
    }).join("") + "</table>" : '<p class="obs">None yet. Save a report from its card (My work).</p>');
    h += "<h3>Saved locations (" + P.length + ")</h3>" + (P.length ? "<table><tr><th>Point</th><th>Where</th><th>Photos</th><th></th></tr>" + P.map(function (p) {
      return "<tr><td>" + esc(p.n || "Point") + (p.note ? '<div class="anal">' + esc(p.note) + "</div>" : "") + "</td><td>" + (+p.lat).toFixed(5) + ", " + (+p.lon).toFixed(5) + (p.cc ? " \u00b7 " + esc(String(p.cc).toUpperCase()) : "") + '</td><td class="n">' + num(p.ph || 0) + "</td><td>" +
        '<button type="button" data-an-fly="' + (+p.lat) + "," + (+p.lon) + '">Map</button>' + (W.OSAP_POINTS ? '<button type="button" data-an-edit="' + esc(p.id) + '">Edit</button>' : "") + "</td></tr>";
    }).join("") + "</table>" : '<p class="obs">None yet. Use Point on the toolbar, or long-press the map.</p>');
    h += "<h3>Saved images</h3>" + (Ph.length ? Ph.map(function (p) { return '<div class="ancard"><b>' + esc(p.n || "Point") + '</b><div class="atk-pph" data-an-ph="' + esc(p.id) + '"></div></div>'; }).join("") :
      '<p class="obs">None yet. Add photos to a point (Edit, photos). They stay on this device, unchanged, with their SHA-256.</p>');
    return h;
  }
  function fillPhotos() {
    if (!W.OSAP_POINTS || !S.el) return;
    Array.prototype.forEach.call(S.el.querySelectorAll("[data-an-ph]"), function (el) { W.OSAP_POINTS.thumbs(el, el.getAttribute("data-an-ph")); });
  }

  /* ---------- Bed-down indicator ---------- */
  function finds() {
    return reports().filter(inPeriod).filter(function (i) { var t = textOf(i); return FIND.test(t) && !NOTFIND.test(t); });
  }
  function inRing(x, y, ring) { var c = false; for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) { var a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function inArea(a, lat, lon) { return (a.polygons || []).some(function (p) { return p[0] && inRing(lon, lat, p[0]) && !p.slice(1).some(function (h) { return inRing(lon, lat, h); }); }); }
  function bed() {
    var F = finds(), by = {}, prov = 0;
    F.forEach(function (i) { var d = distOf(i); if (d) (by[d] = by[d] || []).push(i); else prov++; });
    var T = W.OSAP_TERRAIN && W.OSAP_TERRAIN.th ? [].concat(W.OSAP_TERRAIN.th.terrain || [], W.OSAP_TERRAIN.th.flashpoints || []).filter(function (x) { return /Deep South/.test(x.zone || "") && isFinite(x.lat) && isFinite(x.lon); }) : [];
    var rows = Object.keys(by).map(function (d) {
      var a = (S.areas || []).filter(function (x) { return x.id === d; })[0];
      return { d: d, name: distName(d), n: by[d].length, rep: by[d], a: a, ter: a ? T.filter(function (x) { return inArea(a, x.lat, x.lon); }) : [] };
    }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
    return { F: F, rows: rows, prov: prov };
  }
  function tabBed() {
    var B = bed(), max = B.rows.length ? B.rows[0].n : 1;
    var h = '<div class="anwarn"><b>An indicator, not a finding.</b> Districts where reports in the period describe security-force searches, cordons, hideouts, camps, or weapons and bomb-making finds. ' +
      "Where the security forces searched is not proof of where insurgents stay, and a quiet district may simply be unsearched. Sorted by machine from the report text; drug seizures and training are left out. Yours to assess.</div>" +
      '<div class="anrow"><label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="an-bedmap"' + (S.bedMap ? " checked" : "") + (S.areas ? "" : " disabled") + "> Show on the map</label>" +
      '<span class="anal">' + num(B.F.length) + " matching reports" + (B.prov ? ", " + num(B.prov) + " placed only to a province (not counted below)" : "") + (S.areasErr ? " \u00b7 " + esc(S.areasErr) : "") + "</span></div>";
    if (!B.rows.length) return h + '<p class="obs">No search or find reports placed to a district in this period. Try a longer period.</p>';
    h += "<table><tr><th>District</th><th>Reports</th><th>Terrain and flashpoints inside</th></tr>" + B.rows.map(function (r) {
      return "<tr><td><b>" + esc(r.name) + '</b><details><summary class="anal">The reports</summary>' + r.rep.slice(0, 15).map(repLine).join("") + "</details></td>" +
        '<td class="n"><span class="anbar" style="width:' + Math.round(4 + 60 * r.n / max) + 'px"></span>' + num(r.n) + "</td><td>" +
        (r.ter.length ? r.ter.map(function (x) { return esc(x.name) + ' <span class="anal">(' + esc(x.type === "flashpoint" ? "flashpoint" : x.kind || "terrain") + ")</span>"; }).join("<br>") : '<span class="anal">none listed</span>') +
        (r.a ? '<div><button type="button" data-an-zoom="' + esc(r.d) + '">Map</button></div>' : "") + "</td></tr>";
    }).join("") + "</table>";
    return h;
  }
  function drawBed() {
    var map = W.__asapMap, L = W.L;
    if (S.layer && map) { map.removeLayer(S.layer); S.layer = null; }
    if (!S.bedMap || !map || !L || !S.areas || !isOpen()) return;
    if (!map.getPane("anpane")) { var p = map.createPane("anpane"); p.style.zIndex = 645; p.classList.add("leaflet-anpane-pane"); }
    var B = bed(), max = B.rows.length ? B.rows[0].n : 1;
    S.layer = L.layerGroup(B.rows.filter(function (r) { return r.a; }).map(function (r) {
      var ll = r.a.polygons.map(function (p) { return p.map(function (ring) { return ring.map(function (c) { return [c[1], c[0]]; }); }); });
      return L.polygon(ll, { pane: "anpane", color: "#e67700", weight: 1.4, fillColor: "#e67700", fillOpacity: 0.12 + 0.45 * r.n / max })
        .bindTooltip(esc(r.name) + " \u00b7 " + num(r.n) + " search or find report" + (r.n === 1 ? "" : "s") + " (indicator, not a finding)", { sticky: true });
    })).addTo(map);
  }

  /* ---------- actions ---------- */
  function onClick(e) {
    var t = e.target, b;
    if (t === S.el) { close(); return; }
    if (t.closest('[data-an="close"]')) { close(); return; }
    if ((b = t.closest("[data-an-tab]"))) { S.tab = b.getAttribute("data-an-tab"); saveUi(); render(); return; }
    if ((b = t.closest("[data-an-go]"))) { S.sel = b.getAttribute("data-an-e"); S.tab = b.getAttribute("data-an-go"); S.tf = S.tab === "time" ? S.sel : S.tf; saveUi(); render(); return; }
    if ((b = t.closest("[data-an-node]"))) { var id = b.getAttribute("data-an-node"); S.sel = S.sel === id ? null : id; render(); return; }
    if ((b = t.closest("[data-an-note]"))) {
      var eid = b.getAttribute("data-an-note"), O = ownEnts(), own = O.items.filter(function (x) { return x.id === eid; })[0];
      var v = prompt("Your note (this browser only)", own ? own.note || "" : O.notes[eid] || ""); if (v == null) return;
      v = clean(v, 1000); if (own) { own.note = v; own.updated = new Date().toISOString(); } else if (v) O.notes[eid] = v; else delete O.notes[eid];
      lsSet(K_ENT, O); render(); return;
    }
    if ((b = t.closest("[data-an-del]"))) {
      var did = b.getAttribute("data-an-del"); if (!confirm("Delete this entity and your links to it?")) return;
      var O2 = ownEnts(); O2.items = O2.items.filter(function (x) { return x.id !== did; }); lsSet(K_ENT, O2);
      var L2 = ownLinks(); L2.items = L2.items.filter(function (l) { return l.a !== did && l.b !== did; }); lsSet(K_LINK, L2);
      if (S.sel === did) S.sel = null; render(); return;
    }
    if ((b = t.closest("[data-an-unlink]"))) { var lid = b.getAttribute("data-an-unlink"), L3 = ownLinks(); L3.items = L3.items.filter(function (l) { return l.id !== lid; }); lsSet(K_LINK, L3); render(); return; }
    if ((b = t.closest("[data-an-fly]"))) { var c = b.getAttribute("data-an-fly").split(",").map(Number), m = W.__asapMap; if (m && isFinite(c[0])) { if (W.OSAP_SPLIT && !W.OSAP_SPLIT.on()) close(); m.setView([c[0], c[1]], Math.max(m.getZoom(), 13)); } return; }
    if ((b = t.closest("[data-an-edit]"))) { if (W.OSAP_POINTS) W.OSAP_POINTS.edit(b.getAttribute("data-an-edit")); return; }
    if ((b = t.closest("[data-an-zoom]"))) {
      var a = (S.areas || []).filter(function (x) { return x.id === b.getAttribute("data-an-zoom"); })[0], mp = W.__asapMap;
      if (a && mp && W.L) { if (!S.bedMap) { S.bedMap = true; render(); } mp.fitBounds(W.L.polygon(a.polygons.map(function (p) { return p.map(function (r) { return r.map(function (q) { return [q[1], q[0]]; }); }); })).getBounds(), { maxZoom: 11 }); if (W.OSAP_SPLIT && !W.OSAP_SPLIT.on()) close(); }
      return;
    }
  }
  function onChange(e) {
    var t = e.target;
    if (t.id === "an-days") { S.days = +t.value; saveUi(); render(); }
    else if (t.id === "an-tf") { S.tf = t.value; render(); }
    else if (t.id === "an-bedmap") { S.bedMap = t.checked; drawBed(); }
  }
  function onSubmit(e) {
    e.preventDefault();
    var f = e.target, now = new Date().toISOString();
    if (f.id === "an-addent") {
      var name = clean(f.name.value, 120); if (!name) return;
      var O = ownEnts(); if (O.items.length >= 500) { toast("500 entities is the limit in this browser."); return; }
      O.items.push({ id: rid("ent:me:"), name: name, type: TYPES.indexOf(f.type.value) >= 0 ? f.type.value : "other",
        aliases: clean(f.aliases.value, 400).split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20), note: clean(f.note.value, 1000), created: now, updated: now });
      if (lsSet(K_ENT, O)) toast("Entity added (this browser only)."); render();
    } else if (f.id === "an-addlink") {
      var a = f.a.value, b = f.b.value; if (!a || !b || a === b) { toast("Pick two different items."); return; }
      var L = ownLinks(); if (L.items.length >= 2000) { toast("2,000 links is the limit in this browser."); return; }
      L.items.push({ id: rid("lnk:"), a: a, b: b, rel: RELS.indexOf(f.rel.value) >= 0 ? f.rel.value : "other", note: clean(f.note.value, 600), created: now });
      if (lsSet(K_LINK, L)) toast("Link added (your judgement, this browser only)."); S.sel = a; render();
    }
  }

  /* ---------- the toolbar button, owner only ---------- */
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 7l7.3.6M7.2 8.2l3.7 7.6M16.9 9.2l-3.7 6.7"/></svg>';
  function paintBtn() { var b = D.querySelector("#atk-tools [data-an-btn]"); if (b) b.setAttribute("aria-pressed", String(isOpen())); }
  (function addBtn(n) {
    var list = D.querySelector("#atk-tools .atk-list");
    if (!list) { if (n < 100) setTimeout(function () { addBtn(n + 1); }, 150); return; }
    if (list.querySelector("[data-an-btn]")) return;
    style();
    var b = D.createElement("button"); b.type = "button"; b.setAttribute("data-an-btn", ""); b.title = "Analyst workspace (only on this unlocked device): entities, links, timeline, saved items, bed-down indicator";
    b.setAttribute("aria-label", "Analyst"); b.innerHTML = ICON + '<span class="atk-l">Analyst</span>';
    b.addEventListener("click", function (e) { e.stopPropagation(); if (isOpen()) close(); else open(); });
    var mine = list.querySelector('[data-atk="mine"]');
    if (mine && mine.nextSibling) list.insertBefore(b, mine.nextSibling); else list.appendChild(b);
  })(0);

  W.OSAP_ANALYST = { open: open, close: close, isOpen: isOpen, render: render, _bed: function () { return bed(); }, _index: function () { return index(); } };
})();
