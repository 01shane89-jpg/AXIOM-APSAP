/* AXIOM OSAP: daily country summary.
   Self-contained block loaded before assets/osap-today.js, which mounts it at the top of Today (window.OSAP_DAILYQ.mount).
   Shows the summary the refresh job builds once a day for the open country (data/live/daily/<cc>.js, written by
   tools/refresh_daily.mjs): top lines (a BLUF when an AI draft exists), key events of the last 24 hours with every source link,
   and what to watch. Aimed at analysts and special operations teams: news filtered to security, conflict, crime, unrest,
   disasters, infrastructure, health threats and politics.
   - Nothing here is an assessment. Events are the outlets' own headlines; government and state-media lines are marked as claims.
   - "Automatic" summaries are built by rules with no AI. An AI draft carries the small "AI generated" tag (full wording in its
     tooltip) and every sentence cites numbered sources; each number links to the original.
   - Print gives a one-page summary with every source link and the summary's SHA-256 fingerprint.
   - The file is fetched only when Today is shown for the country; the last 7 days are kept and can be picked. */
(function () {
  "use strict";
  var D = document, W = window, CC = "", NAME = "", el = null, sel = 0, state = 0;
  var FROM = { conflict: "Conflict tab", flashpoint: "Flashpoint", warning: "Official warning", advisory: "Government advisory", brief: "Country brief", ai: "AI generated" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function when(s, date) {
    var T = W.OSAP_TIME; if (!T) return String(s || "");
    var ms = T.parseT(String(s || "").replace(/Z$/, ""));
    return isFinite(ms) ? T.dualT(ms, { date: date !== false }) : String(s || "");
  }
  function day() { var d = W.OSAP_DAILY && W.OSAP_DAILY[CC]; return d && d.days && d.days[sel] || null; }

  var CSS = ".tdday{grid-column:1/-1;text-align:left}.tdday .dlhead{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.tdday h2{margin:0}" +
    ".dlsub{font-size:12px;color:var(--muted)}.dlbluf{margin:8px 0 4px;padding:8px 10px;border-left:3px solid var(--accent,#1f5f99);background:var(--surface2,rgba(127,127,127,.07));border-radius:4px}" +
    ".dlbluf p{margin:0 0 4px;font-size:14.5px;line-height:1.45}.dlbluf p:last-child{margin:0}.dllbl{font:700 11px/1.4 inherit;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:0 0 3px}.dlkev summary{cursor:pointer;min-height:28px}.dlkev[open] summary{margin-bottom:4px}" +
    ".dlcols{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:14px;margin-top:8px}@media (max-width:760px){.dlcols{grid-template-columns:1fr}}" +
      /* Key events folded: its column shrinks to the heading, so What to watch fills the width instead of leaving half blank */
      "@media (min-width:761px){.dlcols:has(>div>details.dlkev:not([open])){grid-template-columns:max-content minmax(0,1fr)}}" +
    ".dlev,.dlw{list-style:none;margin:0;padding:0}.dlev li,.dlw li{padding:6px 0;border-top:1px solid var(--line-soft,var(--line));font-size:13.5px;line-height:1.4;overflow-wrap:anywhere}" +
    ".dlev li:first-child,.dlw li:first-child{border-top:0}.dlev b{font-weight:600}.dlmeta{display:block;font-size:12px;color:var(--muted)}" +
    ".dlref{font-size:11px;font-weight:600;text-decoration:none;margin-left:2px;vertical-align:1px}.dlref:hover{text-decoration:underline}" +
    ".dlwbtn{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;border-radius:4px;padding:2px 22px 2px 2px;margin:-2px;position:relative}.dlwbtn:hover{background:var(--surface2,rgba(127,127,127,.09))}" +
    ".dlwbtn:focus-visible{outline:2px solid var(--accent,#1f5f99);outline-offset:1px}.dlwarr{position:absolute;right:4px;top:2px;color:var(--accent,#1f5f99);font-weight:700}" +
    ".dlwrep{list-style:none;margin:6px 0 2px;padding:0 0 0 10px;border-left:2px solid var(--line)}.dlwrep li{padding:4px 0;font-size:13px}.dlwrep a{font-weight:600}" +
    ".dlfrom{font:600 10.5px/1.5 inherit;color:var(--muted);border:1px solid currentColor;border-radius:9px;padding:0 6px;margin-right:5px;white-space:nowrap}" +
    ".dlfoot{margin-top:8px;font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}.dlfoot select{font:inherit;font-size:12px}" +
    ".dlfoot button{min-height:30px;padding:2px 12px;font-weight:600}.dlauto{display:inline-block;font:500 10.5px/1.5 inherit;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:0 7px;cursor:help}" +
    "#dl-print{display:none}@media print{html.dlprinting body>*:not(#dl-print){display:none!important}html.dlprinting #dl-print{display:block!important;font:10.5pt/1.4 system-ui,sans-serif;color:#000;background:#fff}" +
    "html.dlprinting #dl-print h1{font-size:16pt;margin:0 0 2px}html.dlprinting #dl-print h2{font-size:12pt;margin:12px 0 4px}html.dlprinting #dl-print li{margin:0 0 5px;break-inside:avoid}" +
    "html.dlprinting #dl-print .pm{font-size:8.5pt;color:#333;word-break:break-all}html.dlprinting #dl-print .bl{border-left:3px solid #000;padding-left:8px}}";

  function refs(rs, d) {
    return (rs || []).map(function (n) {
      var r = d.refs[n - 1], u = r && safeUrl(r.url); if (!r) return "";
      return u ? '<a class="dlref" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="' + esc(r.outlet + ": " + r.title) + '">[' + n + "]</a>" : '<span class="dlref">[' + n + "]</span>";
    }).join("");
  }
  function tag(d) {
    if (d.method === "ai") return '<span class="aitag" tabindex="0" title="' + esc(d.label || "Draft, AI-generated, not analyst-approved") + '">AI generated</span>';
    return '<span class="dlauto" tabindex="0" title="Built by rules from the sources listed, with no AI: the most reported, security-first headlines of the day, as the outlets wrote them. Not an assessment.">Automatic</span>';
  }
  /* every What to watch line opens what it rests on (Shane 2026-10-03: "click on any of these and it will take me to those
     reports"): a conflict line opens its conflict tab, the travel advisory opens the State Department page, a country brief
     line opens the country brief, and a flashpoint, warning or AI line unfolds the reports behind it, each linking to the original.
     A flashpoint built before its line carried its reports finds them in the watch list file (data/live/aiwatch.js) by name. */
  var openW = {}, AIW_FILE = "data/live/aiwatch.js", aiwState = 0;
  function watchAll(d) { return (d.ai_watch || []).map(function (w) { return { from: "ai", text: w.text, refs: w.refs }; }).concat(d.watch || []); }
  function aiwItem(w) {
    var A = W.OSAP_AIWATCH, a = A && A.areas && A.areas[CC], t = w.fp || "";
    var it = a && (a.items || []).filter(function (x) { return x && x.title && (t ? x.title === t : String(w.text).indexOf(x.title) === 0); })[0];
    return it ? { a: a, it: it } : null;
  }
  function aiwLoad() {
    if (W.OSAP_AIWATCH || aiwState) return; aiwState = 1;
    var s = D.createElement("script"); s.src = AIW_FILE + "?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () { aiwState = 2; render(); };
    D.head.appendChild(s);
  }
  /* what a line does when tapped: "tab", "url", "brief", "list" or "" (nothing behind it) */
  function watchGo(w) {
    if (w.from === "conflict" && w.tab) return "tab";
    if (w.from === "advisory" && (w.refs || []).length) return "url";
    if (w.from === "brief") return D.getElementById("brief-btn") ? "brief" : "";
    if ((w.refs || []).length || w.from === "flashpoint") return "list";
    return "";
  }
  var GO_HINT = { tab: "Open the conflict tab and its reports", url: "Open the source", brief: "Open the country brief", list: "Show the reports" };
  function repRow(r) {
    var u = safeUrl(r.url), meta = esc(r.outlet || r.source || "") + (r.date || r.ts ? " · " + esc(when(r.date || r.ts, true)) : "");
    return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + "</a>" : esc(r.title)) + '<span class="dlmeta">' + meta +
      (/g/.test(r.flags || "") ? " · official or state media, a claim" : "") + (/m/.test(r.flags || "") ? " · machine translated" : "") + "</span></li>";
  }
  function watchReports(w, d) {
    var L = (w.refs || []).map(function (n) { return d.refs[n - 1]; }).filter(Boolean), note = "";
    if (!L.length && w.from === "flashpoint") {
      var m = aiwItem(w);
      if (m) { L = (m.it.reports || []).map(function (n) { return m.a.refs[n - 1]; }).filter(Boolean).sort(function (x, y) { return String(y.ts || "").localeCompare(String(x.ts || "")); });
        note = m.a.note || ""; }
      else if (!W.OSAP_AIWATCH && aiwState < 2) { aiwLoad(); return '<p class="dlsub">Loading the reports…</p>'; }
    }
    if (!L.length) return '<p class="dlsub">No report OSAP holds is linked to this line.</p>';
    return '<ul class="dlwrep">' + L.map(repRow).join("") + "</ul>" + (note ? '<p class="dlsub">' + esc(note) + "</p>" : "");
  }
  function watchList(d) {
    return watchAll(d).map(function (w, i) {
      var f = FROM[w.from] || "", extra = w.from === "brief" && w.asof ? " (" + w.asof + ", AI draft)" : "", go = watchGo(w), open = go === "list" && openW[i];
      var lab = w.from === "ai" ? '<span class="aitag" tabindex="0" title="' + esc(d.label || "Draft, AI-generated, not analyst-approved") + '">AI generated</span> '
        : f ? '<span class="dlfrom">' + esc(f + extra) + "</span>" : "";
      if (!go) return "<li>" + lab + esc(w.text) + refs(w.refs, d) + "</li>";
      return '<li class="dlwgo' + (open ? " open" : "") + '"><button type="button" class="dlwbtn" data-dlw="' + i + '" title="' + GO_HINT[go] + '"' + (go === "list" ? ' aria-expanded="' + !!open + '"' : "") + ">" +
        lab.replace(' tabindex="0"', "") + esc(w.text) + '<span class="dlwarr" aria-hidden="true">' + (go === "list" ? (open ? "▾" : "▸") : go === "url" ? "↗" : "›") + "</span></button>" +
        (go === "list" ? "" : refs(w.refs, d)) + (open ? watchReports(w, d) : "") + "</li>";
    }).join("");
  }
  function watchTap(i) {
    var d = day(), w = d && watchAll(d)[i]; if (!w) return;
    var go = watchGo(w);
    /* Today covers the page: it steps aside first so the tab or the brief shows (as Today's own Brief button does) */
    var leave = function () { var TD = W.OSAP_TODAY; if (TD && TD.isOpen && TD.isOpen()) TD.hide(); };
    if (go === "tab") {
      leave();
      var CT = W.OSAP_CONFLICT_TABS, b = D.querySelector('#view-seg [data-view="cf-' + w.tab + '"]');
      if (b) b.click(); else if (CT && CT.open) CT.open(w.tab, CC);
    } else if (go === "url") {
      var r = d.refs[w.refs[0] - 1], u = r && safeUrl(r.url); if (u) W.open(u, "_blank", "noopener,noreferrer");
    } else if (go === "brief") {
      leave(); var bb = D.getElementById("brief-btn"); if (bb) bb.click();
    } else if (go === "list") {
      openW[i] = !openW[i]; render();
      var nb = el && el.querySelector('[data-dlw="' + i + '"]'); if (nb) nb.focus();
    }
  }
  function render() {
    if (!el) return;
    var all = W.OSAP_DAILY && W.OSAP_DAILY[CC], d = day();
    if (!d) { el.hidden = state !== 2 ? true : false; if (state === 2) el.innerHTML = '<div class="dlhead"><h2>Daily summary</h2></div><p class="dlsub">No daily summary has been built for ' + esc(NAME) + " yet. The refresh job builds one each day after 0000Z.</p>"; return; }
    el.hidden = false;
    var b = d.basis || {}, ai = d.method === "ai";
    var h = '<div class="dlhead"><h2>Daily summary</h2>' + tag(d) + '<span class="dlsub">' + esc(d.window.hours) + " hours to " + esc(when(d.window.to)) + "</span></div>";
    if ((d.bluf || []).length) h += '<div class="dlbluf"><p class="dllbl">' + (ai ? "BLUF" : "Top lines") + "</p>" + d.bluf.map(function (s) { return "<p>" + esc(s.text) + refs(s.refs, d) + "</p>"; }).join("") + "</div>";
    /* key events fold away by default: Top stories just below already lists the same headlines; Print keeps them in full */
    var nev = (d.events || []).length;
    h += '<div class="dlcols"><div>' + (nev ? '<details class="dlkev"><summary class="dllbl">Key events (' + nev + ")</summary>" : '<p class="dllbl">Key events</p>') + (nev ? '<ul class="dlev">' + d.events.map(function (e) {
      return "<li><b>" + esc(e.text) + "</b>" + refs(e.refs, d) + '<span class="dlmeta">' + (e.n > 1 ? e.n + " outlets: " : "") + esc(e.outlets.join(", ")) + " · " + esc(when(e.when, false)) +
        (e.claim ? " · state media or official, a claim" : e.some_state ? " · includes state media" : "") + (e.mt ? " · machine translated" : "") + (e.conflict ? " · " + esc(e.conflict) : "") + "</span></li>";
    }).join("") + "</ul></details>" : '<p class="dlsub">No analyst-relevant reports in the window.</p>') + "</div>";
    h += '<div><p class="dllbl">What to watch</p><ul class="dlw">' + (watchList(d) || '<li class="dlsub">Nothing flagged.</li>') + "</ul></div></div>";
    h += '<div class="dlfoot"><span>From ' + (b.reports || 0) + " report" + (b.reports === 1 ? "" : "s") + " by " + (b.outlets || 0) + " outlet" + (b.outlets === 1 ? "" : "s") +
      "; sport, celebrity and lifestyle left out. Reports are the sources' claims, not verified." + ((d.gaps || []).length ? " " + esc(d.gaps.join(" ")) : "") + "</span>" +
      (all.days.length > 1 ? '<label>Day <select data-dlday aria-label="Summary day">' + all.days.map(function (x, i) { return '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">" + esc(x.date) + (i === 0 ? " (latest)" : "") + "</option>"; }).join("") + "</select></label>" : "") +
      '<button type="button" class="refresh" data-dlprint>Print</button></div>';
    el.innerHTML = h;
  }
  function printIt() {
    var d = day(); if (!d) return;
    var p = D.getElementById("dl-print"); if (!p) { p = D.createElement("div"); p.id = "dl-print"; D.body.appendChild(p); }
    var ai = d.method === "ai", b = d.basis || {};
    var cite = function (rs) { return (rs || []).length ? " [" + rs.join("][") + "]" : ""; };
    p.innerHTML = "<h1>" + esc(d.name) + ": daily summary</h1>" +
      '<p class="pm">AXIOM OSAP · ' + esc(d.window.hours) + " hours to " + esc(when(d.window.to)) + " · built " + esc(when(d.made)) + " · printed " + esc(W.OSAP_TIME ? W.OSAP_TIME.dualT(Date.now(), { date: true }) : new Date().toISOString()) +
      " · " + (ai ? esc(d.label || "Draft, AI-generated, not analyst-approved") + " (" + esc(d.model || "") + ")" : "Automatic: built by rules, no AI") + "</p>" +
      ((d.bluf || []).length ? "<h2>" + (ai ? "BLUF" : "Top lines") + '</h2><div class="bl">' + d.bluf.map(function (s) { return "<p>" + esc(s.text) + cite(s.refs) + "</p>"; }).join("") + "</div>" : "") +
      "<h2>Key events</h2><ol>" + (d.events || []).map(function (e) { return "<li><b>" + esc(e.text) + "</b>" + cite(e.refs) + '<div class="pm">' + esc(e.outlets.join(", ")) + " · " + esc(when(e.when)) + (e.claim ? " · state media or official, a claim" : e.some_state ? " · includes state media" : "") + (e.mt ? " · machine translated" : "") + "</div></li>"; }).join("") + "</ol>" +
      "<h2>What to watch</h2><ul>" + (d.ai_watch || []).map(function (w) { return "<li>(AI generated) " + esc(w.text) + cite(w.refs) + "</li>"; }).join("") +
      (d.watch || []).map(function (w) { return "<li>" + esc((FROM[w.from] ? FROM[w.from] + (w.from === "brief" && w.asof ? " of " + w.asof + ", AI draft" : "") + ": " : "") + w.text) + cite(w.refs) + "</li>"; }).join("") + "</ul>" +
      "<h2>Sources</h2><ol>" + d.refs.map(function (r) { return '<li class="pm">' + esc(r.outlet) + ", " + esc(when(r.date)) + ": " + esc(r.title) + (/g/.test(r.flags || "") ? " (official or state media: a claim)" : "") + (/m/.test(r.flags || "") ? " (machine translated)" : "") + " · " + esc(r.url) + "</li>"; }).join("") + "</ol>" +
      '<p class="pm">From ' + (b.reports || 0) + " reports by " + (b.outlets || 0) + " outlets. Situational awareness only: reports are the sources' claims and are not verified; statements by any government, including figures, are its claims. " +
      ((d.gaps || []).length ? "Gaps: " + esc(d.gaps.join(" ")) + " " : "") + "SHA-256 " + esc(d.fp || "") + "</p>";
    D.documentElement.classList.add("dlprinting");
    var done = function () { D.documentElement.classList.remove("dlprinting"); W.removeEventListener("afterprint", done); };
    W.addEventListener("afterprint", done);
    setTimeout(function () { W.print(); setTimeout(done, 1000); }, 50);
  }
  function load() {
    if (state) return; state = 1;
    var s = D.createElement("script");
    s.src = "data/live/daily/" + encodeURIComponent(CC) + ".js?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () { state = 2; render(); };
    D.head.appendChild(s);
  }
  function mount(box, cc, name) {
    el = box; CC = cc; NAME = name || cc; el.classList.add("tdday"); el.hidden = true;
    if (!D.getElementById("dl-css")) { var st = D.createElement("style"); st.id = "dl-css"; st.textContent = CSS; D.head.appendChild(st); }
    el.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-dlprint]"); if (t) { e.preventDefault(); printIt(); return; }
      var g = e.target.closest && e.target.closest("[data-dlw]"); if (g && !(e.target.closest("a, .aitag") && e.target !== g)) { e.preventDefault(); watchTap(+g.getAttribute("data-dlw")); }
    });
    el.addEventListener("change", function (e) { if (e.target.hasAttribute("data-dlday")) { sel = +e.target.value || 0; openW = {}; render(); } });
    load();
  }
  W.OSAP_DAILYQ = { mount: mount, print: printIt };
})();
