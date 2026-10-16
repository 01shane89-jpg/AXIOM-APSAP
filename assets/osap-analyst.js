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
     the analyst's own judgements, kept apart from the machine ones, each with the analyst's confidence (confirmed solid, probable
     long dashes, suspected short dashes). Organisations and units are labelled boxes with their NATO APP-6 symbol.
   - Structure: a network hierarchy chart from the analyst's own links only: the chain of command from a chosen top entity,
     then lanes for support nodes, finance, supply chain, bed-down sites, routes and areas of operation.
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
  var TABS = [["ents", "Entities"], ["links", "Links"], ["struct", "Structure"], ["time", "Timeline"], ["saved", "Saved"], ["bed", "Bed-down"]];
  var PERIODS = [[30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "All kept"]];
  var TYPES = ["organisation", "armed group", "unit", "agency", "person (sanctioned or charged only)", "place", "site (bed-down, cache, safe house)", "route", "vehicle", "other"];
  var RELS = ["member of", "commands", "support node for", "supplies", "funds", "beds down at", "uses route", "operates in", "works with", "opposes", "talks with", "other"];
  /* how sure the analyst is of a link they record; drawn the link-analysis way: solid, long dashes, short dashes */
  var CONFS = [["suspected", "Suspected"], ["probable", "Probable"], ["confirmed", "Confirmed"]];
  function dashOf(c) { return c === "suspected" ? "4 4" : c === "probable" ? "10 5" : ""; }
  /* bed-down indicator: the words of a search, a cordon or a find; drug seizures are left out (they are not about where cells stay) */
  var FIND = /\b(raid(?:ed|s)? (?:on )?(?:a |the )?(?:house|home|hideout|hut|camp|safe ?house|weapons? store)|security forces raid(?:ed)?|cordon(?:ed)?|hide-?outs?|safe ?houses?|hiding (?:place|spot)s?|(?:insurgent|militant|training|jungle|hidden) camps?|caches?|bomb[- ]making|weapons? (?:store|depot|found|seized)|seiz(?:e|ed|ing) (?:weapons?|guns?|rifles?|bombs?|explosives?|ammunition)|found (?:weapons?|guns?|rifles?|bombs?|explosives?|ammunition)|search(?:ed)? (?:a |the )?(?:house|houses|village|hut|woodshed|plantation|forest|mountain)|surround(?:ed)? (?:a |the )?(?:house|hut|village))\b|ปิดล้อม|ตรวจค้น|ที่หลบซ่อน|แหล่งกบดาน|กบดาน|คลังอาวุธ|แหล่งประกอบระเบิด|ตรวจยึดอาวุธ|พบอาวุธ/i;
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
  /* Thailand's terrain and flashpoints (the same per-country file Map overlays loads), for the Bed-down tab's context column */
  function needTerrain() { return W.OSAP_TERRAIN && W.OSAP_TERRAIN.th ? Promise.resolve() : script("data/terrain/th.js").catch(function () {}); }
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
      "#anws .angraph text{font-size:13px;fill:var(--ink,#1d2329);pointer-events:none;paint-order:stroke;stroke:var(--surface2,#f5f7f9);stroke-width:3px;stroke-linejoin:round}#anws .angraph text.anbx{font-size:12px;font-weight:600;stroke:none;fill:#1d2329}#anws .angraph text.ancnt{font-size:10px;font-weight:700;fill:#fff;stroke:none}#anws .angraph text.anrel{font-size:11.5px;fill:#2b8a3e;font-weight:600}#anws .angraph g[data-an-node]{cursor:pointer}#anws .answ{display:inline-block;width:26px;height:14px;border:1.6px solid;border-radius:3px;background:#fff;flex:none}#anws .anln{display:inline-block;width:26px;height:0;flex:none}#anws .anscroll{overflow-x:auto;border:1px solid var(--line,#d5dbe1);border-radius:6px}#anws .anscroll .angraph{border:0;width:100%;max-width:none;height:auto}#anws .angraph text.anlane{font-size:12px;font-weight:700;fill:var(--muted,#56626f);stroke:none;text-transform:uppercase;letter-spacing:.04em}#anws .angraph circle,#anws .angraph rect{cursor:pointer}#anws .ankey{display:flex;flex-wrap:wrap;gap:0 14px;margin:4px 0 8px}#anws .ankey .lgh{flex-basis:100%}#anws .ankey .lg{display:flex;align-items:center;gap:6px;font-size:11.5px}#anws .ankey .msyfr{flex-basis:100%}" +
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
    Promise.all([needEnts(), needAreas(), needTerrain()]).then(function () { if (!el.hidden) render(); });
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
    h += S.tab === "links" ? tabLinks(X) : S.tab === "struct" ? tabStruct(X) : S.tab === "time" ? tabTime(X) : S.tab === "saved" ? tabSaved() : S.tab === "bed" ? tabBed() : tabEnts(X);
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
  /* link chart symbols: NATO APP-6 / MIL-STD-2525D land units and civilian organisations from assets/osap-symbols.js (keys la_*).
     Armed and security bodies use the unknown frame, civilian bodies the neutral frame: OSAP never marks a side. */
  var SYM_ID = { "ent:ds:brn": "la_armed", "ent:ds:rkk": "la_armed", "ent:ds:pulo": "la_armed", "ent:ds:gmip": "la_armed", "ent:ds:mara-patani": "la_group",
    "ent:ds:isoc4": "la_c2", "ent:ds:army4": "la_c2", "ent:ds:sbpac": "la_gov", "ent:ds:rangers": "la_armed", "ent:ds:or-sor": "la_security",
    "ent:ds:chor-ror-bor": "la_security", "ent:ds:bpp": "la_border", "ent:ds:police9": "la_police", "ent:ds:marines-nara": "la_amphib",
    "ent:ds:thai-panel": "la_gov", "ent:ds:my-facilitator": "la_gov", "ent:ds:akps": "la_border", "ent:ds:gof": "la_police", "ent:ds:my-customs": "la_customs", "ent:ds:dsw": "la_org" };
  var SYM_TYPE = { "armed group": "la_armed", unit: "la_armed", agency: "la_gov", organisation: "la_group", "person (sanctioned or charged only)": "la_person", place: "la_place", "site (bed-down, cache, safe house)": "la_place" };
  function symOf(e) { if (e && (e.type === "route" || e.type === "vehicle")) return ""; var k = e && (SYM_ID[e.id] || SYM_TYPE[e.type] || "la_group"); return W.OSAP_SYM && W.OSAP_SYM.d[k] ? k : ""; }
  function graph(X) {
    var nodes = {}, edges = {};
    function node(id, label, kind, w) { if (!nodes[id]) nodes[id] = { id: id, label: label, kind: kind, w: 0 }; nodes[id].w += w || 0; return nodes[id]; }
    function edge(a, b, kind) { if (a === b) return; var k = a < b ? a + "|" + b : b + "|" + a, e = edges[k] || (edges[k] = { a: a < b ? a : b, b: a < b ? b : a, n: 0, kind: kind, rep: [] }); return e; }
    var name = {}, sym = {}, kind = {}; X.E.forEach(function (e) { name[e.id] = e.name; sym[e.id] = symOf(e); kind[e.id] = [e.group, e.type]; });
    X.rows.forEach(function (r) {
      if (!r.ents.length) return;
      r.ents.forEach(function (id) { node(id, name[id], "ent", 1); });
      for (var i = 0; i < r.ents.length; i++) for (var j = i + 1; j < r.ents.length; j++) { var e = edge(r.ents[i], r.ents[j], "co"); e.n++; e.rep.push(r.i); }
      if (r.d) r.ents.forEach(function (id) { node("d:" + r.d, distName(r.d), "dist", 1); var e = edge(id, "d:" + r.d, "co"); e.n++; e.rep.push(r.i); });
    });
    ownLinks().items.forEach(function (l) {
      if (!l.a || !l.b) return;
      [l.a, l.b].forEach(function (id) { if (/^d:/.test(id)) node(id, distName(id.slice(2)), "dist", 0); else node(id, name[id] || id, "ent", 0); });
      var k = "own:" + l.id; edges[k] = { a: l.a, b: l.b, kind: "own", rel: l.rel, conf: l.conf, note: l.note, id: l.id, n: 0 };
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
    N.forEach(function (n) { n.sym = n.kind === "ent" ? sym[n.id] || "" : W.OSAP_SYM && W.OSAP_SYM.d.la_place ? "la_place" : ""; if (kind[n.id]) { n.group = kind[n.id][0]; n.person = /^person/.test(kind[n.id][1] || ""); } });
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
  /* the chart follows the usual link-analysis conventions: organisations and units are labelled boxes (with their NATO APP-6
     symbol), people are circles, places are point-of-interest markers; a dashed line is an unconfirmed association (here: named
     in the same report), a solid line one the analyst recorded. The box's edge colour is the list group, not a judgement. */
  var GROUP_C = { "Armed groups named in reporting": "#6a3d9a", "Thai security forces and agencies": "#1c5d99", "Peace process": "#2b8a3e",
    "Malaysian border agencies": "#c56a00", "Monitors and researchers": "#5f6b77", "Your entities": "#343a40" };
  function boxOf(n) {
    if (n.kind === "dist") return { w: 16, h: 24, lab: true };
    if (n.person) return { w: 30, h: 30, lab: true };
    return { w: 212, h: 40 };
  }
  /* push overlapping boxes apart after the force layout, so names never sit on each other */
  function unclash(N, w, h) {
    for (var it = 0; it < 80; it++) {
      var moved = false;
      for (var i = 0; i < N.length; i++) for (var j = i + 1; j < N.length; j++) {
        var a = N[i], b = N[j], A = boxOf(a), B = boxOf(b), aw = A.w + (A.lab ? 90 : 0), bw = B.w + (B.lab ? 90 : 0), ah = A.h + (A.lab ? 16 : 0), bh = B.h + (B.lab ? 16 : 0);
        var ox = (aw + bw) / 2 + 10 - Math.abs(a.x - b.x), oy = (ah + bh) / 2 + 10 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox / aw < oy / ah) { var sx = (a.x < b.x ? -1 : 1) * ox / 2; a.x += sx; b.x -= sx; } else { var sy = (a.y < b.y ? -1 : 1) * oy / 2; a.y += sy; b.y -= sy; }
      }
      N.forEach(function (n) { var B = boxOf(n); n.x = Math.max(B.w / 2 + 50, Math.min(w - B.w / 2 - 50, n.x)); n.y = Math.max(B.h / 2 + 8, Math.min(h - B.h / 2 - 20, n.y)); });
      if (!moved) break;
    }
  }
  function wrap2(t, max) {
    t = String(t || ""); if (t.length <= max) return [t];
    var cut = t.lastIndexOf(" ", max); if (cut < max * 0.5) cut = max;
    var a = t.slice(0, cut).trim(), b = t.slice(cut).trim(); if (b.length > max) b = b.slice(0, max - 1).trim() + "\u2026";
    return [a, b];
  }
  function tabLinks(X) {
    var G = graph(X), w = 1000, hh = G.N.length > 12 ? 700 : 520, at = layout(G.N, G.E, w, hh);
    unclash(G.N, w, hh);
    var h = '<p class="anal">Link chart. Boxes: organisations and units, with their NATO map symbol (APP-6) and how many reports name them. Circles: people. Brown markers: districts. Dashed line: named in the same report (unconfirmed, not a relationship; the number on hover). Solid green line: a link you recorded. Tap one to see its connections.</p>';
    if (!G.N.length) return h + '<p class="obs">No entity is named in the reports of this period yet' + (W.OSAP_DS_ENT ? "" : " (the entity list is still loading)") + ".</p>" + linkForm(X);
    h += '<svg class="angraph" viewBox="0 0 ' + w + " " + hh + '" role="img" aria-label="Link chart">' +
      G.E.map(function (e) { var a = at[e.a], b = at[e.b]; if (!a || !b) return ""; var own = e.kind === "own", on = S.sel && (e.a === S.sel || e.b === S.sel);
        var ln = '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="' + (own ? "#2b8a3e" : on ? "#1c5d99" : "#8a96a3") + '" stroke-width="' + (own ? 2.5 : Math.min(6, 0.8 + Math.log(1 + e.n) * 1.2)).toFixed(1) + '"' + (own ? (dashOf(e.conf) ? ' stroke-dasharray="' + dashOf(e.conf) + '"' : "") : ' stroke-dasharray="6 5"') + ' opacity="' + (S.sel && !on ? 0.25 : 0.85) + '"><title>' + esc(own ? (G.nodes[e.a] || {}).label + " \u2014 " + e.rel + " \u2014 " + (G.nodes[e.b] || {}).label + " (your link)" : (G.nodes[e.a] || {}).label + " and " + (G.nodes[e.b] || {}).label + ": named together in " + e.n + " report" + (e.n === 1 ? "" : "s")) + "</title></line>";
        /* a recorded link carries its label at the middle, as on a link chart */
        if (own && e.rel) ln += '<text class="anrel" x="' + ((a.x + b.x) / 2).toFixed(1) + '" y="' + ((a.y + b.y) / 2 - 4).toFixed(1) + '" text-anchor="middle">' + esc(e.rel) + "</text>";
        return ln; }).join("") +
      G.N.map(function (n) { var on = S.sel === n.id, x = n.x, y = n.y, B = boxOf(n), d = n.sym && W.OSAP_SYM && W.OSAP_SYM.d[n.sym], out = "", lab = String(n.label || "");
        var tip = "<title>" + esc(lab + (d ? " \u00b7 " + W.OSAP_SYM.m[n.sym][0] : "") + " \u00b7 named in " + n.w + " report" + (n.w === 1 ? "" : "s")) + "</title>";
        if (n.kind === "dist") {
          if (d) { var sc = 26 / Math.max(d[1], d[2]); out = '<rect x="' + (x - 10).toFixed(1) + '" y="' + (y - 24).toFixed(1) + '" width="20" height="26" fill="transparent">' + tip + "</rect>" + d[0].replace("<svg ", '<svg x="' + (x - d[3] * sc).toFixed(1) + '" y="' + (y - d[4] * sc).toFixed(1) + '" width="' + (d[1] * sc).toFixed(1) + '" height="' + (d[2] * sc).toFixed(1) + '" pointer-events="none" '); }
          else out = '<rect x="' + (x - 8) + '" y="' + (y - 8) + '" width="16" height="16" fill="#8d6e63">' + tip + "</rect>";
          if (on) out = '<circle cx="' + x.toFixed(1) + '" cy="' + (y - 10).toFixed(1) + '" r="17" fill="none" stroke="#e67700" stroke-width="3"/>' + out;
          return '<g data-an-node="' + esc(n.id) + '">' + out + '<text x="' + x.toFixed(1) + '" y="' + (y + 15).toFixed(1) + '" text-anchor="middle">' + esc(lab) + "</text></g>";
        }
        if (n.person) {
          return '<g data-an-node="' + esc(n.id) + '"><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="15" fill="#fff" stroke="' + (on ? "#e67700" : "#343a40") + '" stroke-width="' + (on ? 3 : 2) + '">' + tip + "</circle>" +
            '<text x="' + x.toFixed(1) + '" y="' + (y + 29).toFixed(1) + '" text-anchor="middle">' + esc(lab.length > 30 ? lab.slice(0, 29) + "\u2026" : lab) + "</text></g>";
        }
        var col = GROUP_C[n.group] || "#495057", bx = x - B.w / 2, by = y - B.h / 2, lines = wrap2(lab, 23), tx = bx + (d ? 40 : 8);
        out = '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + B.w + '" height="' + B.h + '" rx="3" fill="#fff" stroke="' + (on ? "#e67700" : col) + '" stroke-width="' + (on ? 3 : 1.6) + '">' + tip + "</rect>" +
          '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="5" height="' + B.h + '" fill="' + col + '" pointer-events="none"/>';
        if (d) { var s2 = 26 / Math.max(d[1], d[2]), sw = d[1] * s2, sh = d[2] * s2; out += d[0].replace("<svg ", '<svg x="' + (bx + 8 + (28 - sw) / 2).toFixed(1) + '" y="' + (y - sh / 2).toFixed(1) + '" width="' + sw.toFixed(1) + '" height="' + sh.toFixed(1) + '" pointer-events="none" '); }
        out += lines.map(function (l, k) { return '<text class="anbx" x="' + tx.toFixed(1) + '" y="' + (y + (lines.length === 1 ? 4 : k ? 12 : -2)).toFixed(1) + '">' + esc(l) + "</text>"; }).join("");
        /* how many reports name it, as a tab on the box's top edge */
        var cnt = String(n.w), cw = 8 + cnt.length * 6.5;
        out += '<rect x="' + (bx + B.w - cw - 4).toFixed(1) + '" y="' + (by - 8).toFixed(1) + '" width="' + cw.toFixed(1) + '" height="14" rx="7" fill="' + col + '" pointer-events="none"/><text class="ancnt" x="' + (bx + B.w - 4 - cw / 2).toFixed(1) + '" y="' + (by + 2.5).toFixed(1) + '" text-anchor="middle">' + cnt + "</text>";
        return '<g data-an-node="' + esc(n.id) + '">' + out + "</g>"; }).join("") + "</svg>";
    /* the key: the symbols and box colours in this chart, in plain words */
    var ks = G.N.map(function (n) { return n.sym; }).filter(function (k, i, a) { return k && a.indexOf(k) === i; }),
      gs = G.N.map(function (n) { return n.kind === "ent" && !n.person ? n.group : ""; }).filter(function (g, i, a) { return g && a.indexOf(g) === i; });
    h += '<div class="ankey">' + (gs.length ? '<div class="lgh">Box edge: list group (not a judgement)</div>' + gs.map(function (g) { return '<div class="lg"><span class="answ" style="border-color:' + (GROUP_C[g] || "#495057") + ";box-shadow:inset 4px 0 0 " + (GROUP_C[g] || "#495057") + '"></span><div>' + esc(g) + "</div></div>"; }).join("") : "") +
      '<div class="lgh">Lines</div><div class="lg"><span class="anln" style="border-top:2.5px dashed #8a96a3"></span><div>Named in the same report (unconfirmed)</div></div><div class="lg"><span class="anln" style="border-top:2.5px solid #2b8a3e"></span><div>Your link, confirmed</div></div><div class="lg"><span class="anln" style="border-top:2.5px dashed #2b8a3e"></span><div>Your link, probable or suspected</div></div>' +
      (ks.length && W.OSAP_SYM && W.OSAP_SYM.legend ? W.OSAP_SYM.legend(ks) + '<p class="msyfr">NATO-style symbols (APP-6 / MIL-STD-2525D). <b>Yellow, four-lobed frame</b>: armed or security body, side not marked. <b>Purple</b>: civilian body (government, monitor). The symbol shows what kind of body it is, not what it did.</p>' : "") + "</div>";
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
      '<label>To <select name="b">' + opts + '</select></label><label>Confidence <select name="conf">' + CONFS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + "</option>"; }).join("") + '</select></label><label>Why (your basis) <input name="note" maxlength="600"></label><button type="submit" class="go">Add link</button></form>' +
      '<p class="anal">Your link is your judgement, shown in green and kept apart from the machine co-mentions: solid when confirmed, long dashes when probable, short dashes when suspected. The Structure tab arranges these links as a network chart. In this browser only.</p></details>';
  }
  function repLine(i) {
    var u = safeUrl(i.link);
    return '<div class="anit"><a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(titleOf(i)) + '</a> <span class="anal">' + esc(i.outlet || "") + " \u00b7 " + esc(String(i.date || "").replace("T", " ")) +
      (i.geo && i.geo.n ? " \u00b7 " + esc(i.geo.n) : "") + (i.mt ? " \u00b7 machine-translated" : "") + "</span></div>";
  }

  /* ---------- Structure ----------
     A network chart of the analyst's own links only (no machine co-mentions, nothing drawn by AI): the chosen top entity, its
     chain of command ("commands", "member of") as tiers, then lanes for support nodes, finance, supply chain, bed-down
     sites, routes, areas of operation and other associates, each joined by the link that put it there. It is the analyst's
     judgement and says so; nothing here changes the reference entity list. */
  var LANES = [["sup", "Support nodes", ["support node for"]], ["fin", "Finance", ["funds"]], ["log", "Supply chain", ["supplies"]],
    ["bed", "Bed-down sites", ["beds down at"]], ["rte", "Routes", ["uses route"]], ["aoo", "Areas of operation", ["operates in"]], ["oth", "Other associates", []]];
  function laneOf(rel) { for (var i = 0; i < LANES.length; i++) if (LANES[i][2].indexOf(rel) >= 0) return LANES[i][0]; return "oth"; }
  function tabStruct(X) {
    var L = ownLinks().items.filter(function (l) { return l.a && l.b; }), name = {}, sym = {}, grp = {};
    X.E.forEach(function (e) { name[e.id] = e.name; sym[e.id] = symOf(e); grp[e.id] = e.group; });
    function nm(id) { return /^d:/.test(id) ? "District: " + distName(id.slice(2)) : name[id] || id; }
    var cnt = {}; L.forEach(function (l) { cnt[l.a] = (cnt[l.a] || 0) + 1; cnt[l.b] = (cnt[l.b] || 0) + 1; });
    var roots = Object.keys(cnt).filter(function (id) { return !/^d:/.test(id); }).sort(function (a, b) { return cnt[b] - cnt[a]; });
    var h = '<p class="anal">Network structure from <b>your own links only</b>: a chain of command from the top entity, then support nodes, finance, supply chain, bed-down sites, routes and areas of operation. It is your judgement, not a finding; machine co-mentions are not used. Add links in the Links tab (relationships such as member of, commands, support node for, supplies, funds, beds down at, uses route).</p>';
    if (!roots.length) return h + '<p class="obs">No links of your own yet. Record links in the Links tab (with a confidence and your basis) and the structure appears here.</p>' + linkForm(X);
    var root = roots.indexOf(S.root) >= 0 ? S.root : roots.indexOf("ent:ds:brn") >= 0 ? "ent:ds:brn" : roots[0];
    h += '<div class="anrow"><label>Top of the chart <select id="an-root">' + roots.map(function (id) { return '<option value="' + esc(id) + '"' + (id === root ? " selected" : "") + ">" + esc(nm(id)) + " (" + cnt[id] + ")</option>"; }).join("") + "</select></label></div>";
    /* command tiers: "A commands B" puts B under A; "A member of B" puts A under B */
    var tier = {}, lane = {}, via = {}, q = [root], seen = {}; tier[root] = 0; seen[root] = 1;
    while (q.length) {
      var c = q.shift();
      L.forEach(function (l) {
        var ch = l.rel === "commands" && l.a === c ? l.b : l.rel === "member of" && l.b === c ? l.a : null;
        if (ch && !seen[ch] && tier[c] < 5) { seen[ch] = 1; tier[ch] = tier[c] + 1; via[ch] = l; q.push(ch); }
      });
    }
    /* everything else linked to a node of the command chain goes in the lane its link names (two steps out at most) */
    var inChart = Object.keys(tier), front = inChart.slice();
    for (var step = 0; step < 2; step++) {
      var next = [];
      L.forEach(function (l) {
        [[l.a, l.b], [l.b, l.a]].forEach(function (p) {
          if (!seen[p[0]] || seen[p[1]] || front.indexOf(p[0]) < 0) return;
          seen[p[1]] = 1; lane[p[1]] = laneOf(l.rel); via[p[1]] = l; next.push(p[1]);
        });
      });
      front = next;
    }
    var nodes = Object.keys(seen).slice(0, 80);
    /* top: the chain of command as tiers, each child under its parent; below: one column per lane in use, joined like an
       organisation chart (a bus under the command tiers, a rail down the left of each column, a stub into each box) */
    var BW = 196, BH = 40, GAP = 22, LBL = 110, RH = 86, IH = 54, maxT = 0, at = {}, rows = [];
    Object.keys(tier).forEach(function (id) { if (nodes.indexOf(id) >= 0) maxT = Math.max(maxT, tier[id]); });
    for (var t = 0; t <= maxT; t++) rows.push(nodes.filter(function (id) { return tier[id] === t; }));
    var cols = LANES.map(function (ln) { return { id: ln[0], lab: ln[1], ids: nodes.filter(function (id) { return lane[id] === ln[0]; }) }; }).filter(function (c) { return c.ids.length; });
    var CW = BW + 46, maxRow = Math.max.apply(null, rows.map(function (r) { return r.length; })),
      w = Math.max(900, LBL + 20 + maxRow * (BW + GAP), LBL + 20 + cols.length * CW),
      bandY = 20 + rows.length * RH + 34, maxItems = Math.max.apply(null, [0].concat(cols.map(function (c) { return c.ids.length; }))),
      hh = (cols.length ? bandY + 26 + maxItems * IH + 10 : rows.length * RH + 20);
    function parentOf(id) { var l = via[id]; return l ? (l.a === id ? l.b : l.a) : null; }
    rows.forEach(function (r, ri) {
      r.sort(function (a, b) { var pa = at[parentOf(a)], pb = at[parentOf(b)]; return (pa ? pa.x : 0) - (pb ? pb.x : 0); });
      var span = r.length * (BW + GAP) - GAP, x0 = LBL + 20 + Math.max(0, (w - LBL - 20 - span) / 2);
      r.forEach(function (id, k) { at[id] = { x: x0 + k * (BW + GAP) + BW / 2, y: 20 + ri * RH + BH / 2 }; });
    });
    var cx0 = LBL + 20 + Math.max(0, (w - LBL - 20 - cols.length * CW) / 2);
    cols.forEach(function (c, ci) {
      c.x = cx0 + ci * CW; c.rail = c.x + 14;
      c.ids.sort(function (a, b) { var pa = at[parentOf(a)], pb = at[parentOf(b)]; return (pa ? pa.x : 0) - (pb ? pb.x : 0); });
      c.ids.forEach(function (id, k) { at[id] = { x: c.x + 30 + BW / 2, y: bandY + 26 + k * IH + BH / 2, col: c }; });
    });
    var svg = '<svg class="angraph anstruct" viewBox="0 0 ' + w + " " + hh + '" style="min-width:' + Math.round(w * 0.6) + 'px" role="img" aria-label="Network structure chart">';
    rows.forEach(function (r, ri) {
      var y = 10 + ri * RH;
      svg += '<rect x="0" y="' + y + '" width="' + w + '" height="' + (RH - 8) + '" fill="' + (ri % 2 ? "rgba(0,0,0,.025)" : "rgba(0,0,0,.05)") + '"/>' +
        '<text class="anlane" x="10" y="' + (y + RH / 2 - 2) + '">' + (ri ? "Tier " + ri : "Command") + "</text>";
    });
    cols.forEach(function (c) { svg += '<text class="anlane" x="' + (c.x + 22) + '" y="' + (bandY + 12) + '">' + esc(c.lab) + "</text>"; });
    function dash(l) { return dashOf(l.conf) ? ' stroke-dasharray="' + dashOf(l.conf) + '"' : ""; }
    function tipOf(l) { return "<title>" + esc(nm(l.a) + " — " + l.rel + " — " + nm(l.b) + " (" + (l.conf || "not stated") + (l.note ? "; " + l.note : "") + ")") + "</title>"; }
    L.forEach(function (l) {
      var a = at[l.a], b = at[l.b]; if (!a || !b) return;
      var d, lab = "";
      if (a.col || b.col) {
        if (a.col && b.col) { var top = a.y <= b.y ? a : b, bot = a.y <= b.y ? b : a; d = "M" + (top.x - BW / 2) + " " + top.y + " H" + (top.col.rail + 6) + " V" + bot.y + " H" + (bot.x - BW / 2); }
        else { var p = a.col ? b : a, q = a.col ? a : b; d = "M" + p.x + " " + (p.y + BH / 2) + " V" + (bandY - 6) + " H" + q.col.rail + " V" + q.y + " H" + (q.x - BW / 2); }
      } else if (Math.abs(a.y - b.y) < 1) { d = "M" + (Math.min(a.x, b.x) + BW / 2) + " " + a.y + " H" + (Math.max(a.x, b.x) - BW / 2); lab = '<text class="anrel" x="' + ((a.x + b.x) / 2) + '" y="' + (a.y - 6) + '" text-anchor="middle">' + esc(l.rel) + "</text>"; }
      else {
        var tp = a.y <= b.y ? a : b, bt = a.y <= b.y ? b : a, ym = tp.y + BH / 2 + (RH - BH) / 2;
        d = "M" + tp.x + " " + (tp.y + BH / 2) + " V" + ym + " H" + bt.x + " V" + (bt.y - BH / 2);
        lab = '<text class="anrel" x="' + (bt.x + 6) + '" y="' + (bt.y - BH / 2 - 5) + '">' + esc(l.rel) + "</text>";
      }
      svg += '<path d="' + d + '" fill="none" stroke="#2b8a3e" stroke-width="2"' + dash(l) + ">" + tipOf(l) + "</path>" + lab;
    });
    nodes.forEach(function (id) {
      var p = at[id]; if (!p) return;
      var dist = /^d:/.test(id), k = dist ? "la_place" : sym[id], d = k && W.OSAP_SYM && W.OSAP_SYM.d[k], col = GROUP_C[grp[id]] || "#495057", bx = p.x - BW / 2, by = p.y - BH / 2, lines = wrap2(nm(id), 22);
      var g = '<rect x="' + bx + '" y="' + by + '" width="' + BW + '" height="' + BH + '" rx="3" fill="#fff" stroke="' + (id === root ? "#e67700" : col) + '" stroke-width="' + (id === root ? 2.5 : 1.6) + '"><title>' + esc(nm(id)) + "</title></rect>" +
        '<rect x="' + bx + '" y="' + by + '" width="5" height="' + BH + '" fill="' + col + '"/>';
      if (d) { var sc = 26 / Math.max(d[1], d[2]); g += d[0].replace("<svg ", '<svg x="' + (bx + 8 + (28 - d[1] * sc) / 2).toFixed(1) + '" y="' + (p.y - d[2] * sc / 2).toFixed(1) + '" width="' + (d[1] * sc).toFixed(1) + '" height="' + (d[2] * sc).toFixed(1) + '" pointer-events="none" '); }
      g += lines.map(function (t, j) { return '<text class="anbx" x="' + (bx + (d ? 40 : 10)) + '" y="' + (p.y + (lines.length === 1 ? 4 : j ? 12 : -2)) + '">' + esc(t) + "</text>"; }).join("");
      svg += '<g data-an-node="' + esc(id) + '">' + g + "</g>";
    });
    svg += "</svg>";
    h += '<div class="anscroll">' + svg + "</div>" +
      '<div class="ankey"><div class="lgh">Your links</div><div class="lg"><span class="anln" style="border-top:2.5px solid #2b8a3e"></span><div>Confirmed</div></div><div class="lg"><span class="anln" style="border-top:2.5px dashed #2b8a3e"></span><div>Probable (long dashes) or suspected (short dashes)</div></div><div class="lg"><span class="answ" style="border-color:#e67700"></span><div>Top of the chart</div></div></div>' +
      '<p class="anal">' + nodes.length + " items, " + L.filter(function (l) { return at[l.a] && at[l.b]; }).length + " of your links. Items more than two links from the chain of command are left out.</p>";
    return h + linkForm(X);
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
    else if (t.id === "an-root") { S.root = t.value; render(); }
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
      L.items.push({ id: rid("lnk:"), a: a, b: b, rel: RELS.indexOf(f.rel.value) >= 0 ? f.rel.value : "other", conf: CONFS.some(function (c) { return c[0] === (f.conf && f.conf.value); }) ? f.conf.value : "suspected", note: clean(f.note.value, 600), created: now });
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
