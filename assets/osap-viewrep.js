/* AXIOM OSAP: a Reports section and a Summarise button on every tab.
   Self-contained block loaded after the main page script and the area summary (assets/osap-areasum.js).
   - Reports: each map tab (Flood, Border, Insurgency, Crime, Health, Live hazards and the rest, in every country) lists the
     headlines from the one news pool that belong to it: tools/news_index.mjs tags every pooled headline with the tabs whose words
     it holds (tools/view_reports.json), and this block shows the ones filed under the open country, in the page's period,
     newest first. A new tab gets its reports from one entry in that file. Local news, Social media, Open data, Timeline and
     Alerts are lists of reports already and get no section; war tabs keep their own "Latest reports".
   - Summarise: writes a short summary of the tab on request, from the tab's own records and its reports (or, on a war tab, its
     latest reports), with the area summary's two writers: Automatic (fixed rules, always) and AI (only a browser's own on-device
     model; labelled "AI generated", every sentence cited). Nothing leaves the device.
   Read-only: it never changes a record. Every line is a source's headline, not a verified report. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, PAGE = 8, MAX_DAYS_AUTO = 14, MORE_DAYS = 7, MAX_POOL_SUM = 60;
  var SKIP = { timeline: 1, alerts: 1, news: 1, social: 1, opendata: 1 };
  /* the preview page carries every day inline; keep them before the news search reads and frees them */
  var PRE = {}; try { Object.keys(window.OSAP_NEWSIX_DAY || {}).forEach(function (d) { PRE[d] = window.OSAP_NEWSIX_DAY[d]; }); } catch (e) {}
  var S = { man: null, rows: [], loaded: 0, want: 1, busy: false, err: "", shown: PAGE, q: "", view: "", el: null };

  function A() { return window.TSAP && window.TSAP.areaApi; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  /* some outlets' feeds carry HTML entities in their titles ("&#8217;"): shown as the characters they stand for */
  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  function unent(s) { return String(s == null ? "" : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
    if (e[0] === "#") { var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1); try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; } catch (x) { return m; } }
    return ENT[e.toLowerCase()] || m; }); }
  function fold(s) { s = String(s || ""); try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {} return s.toLowerCase(); }
  function T() { return window.OSAP_TIME; }
  function ms(d) { d = String(d || ""); return Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(d) ? d + "Z" : d); }
  function whenTxt(d) { var t = ms(d), X = T(); return isFinite(t) && X && X.dualT ? X.dualT(t, { date: true }) : String(d).replace("T", " ") + "Z"; }
  function num(n) { return (n || 0).toLocaleString("en-GB"); }

  /* ---------- the pool: manifest, then days newest first ---------- */
  function bust() { return "?t=" + Math.floor(Date.now() / 6e5); }
  function script(src, ok, bad) {
    var s = D.createElement("script"); s.src = src; s.async = true;
    s.onload = function () { s.remove(); ok(); }; s.onerror = function () { s.remove(); bad(); };
    D.head.appendChild(s);
  }
  function viewOk(v) { return !!(S.man && S.man.views && S.man.views.some(function (x) { return x.id === v; })); }
  function ensure() {
    if (S.busy) return;
    if (!S.man) {
      S.busy = true; draw();
      var got = function () {
        S.busy = false; S.man = window.OSAP_NEWSIX || null;
        if (!S.man || !S.man.days) { S.err = "The reports index has not been built yet. It is made by the next refresh."; S.man = null; draw(); return; }
        ensure();
      };
      if (window.OSAP_NEWSIX && window.OSAP_NEWSIX.days) { got(); return; }
      script("data/live/news-index.js" + bust(), got, function () { S.busy = false; S.err = navigator.onLine === false ? "Offline: reports need a connection the first time." : "The reports index could not be read just now."; draw(); });
      return;
    }
    /* load until this tab has a page of reports or MAX_DAYS_AUTO days are read; older days on request */
    var days = S.man.days, vi = S.man.fields.indexOf("views");
    if (vi < 0) { S.err = "The reports index is from before tab reports existed; the next refresh adds them."; draw(); return; }
    if (S.loaded >= days.length || (S.loaded >= S.want && (results().length >= PAGE || S.loaded >= MAX_DAYS_AUTO))) { draw(); return; }
    var day = days[S.loaded].d;
    S.busy = true; draw();
    var take = function () {
      var rows = PRE[day] || ((window.OSAP_NEWSIX_DAY || {})[day]) || [];
      rows.forEach(function (r) {
        r = r.slice(); r[2] = unent(r[2]); r[3] = unent(r[3]); r[4] = unent(r[4]);
        S.rows.push({ r: r, ccs: String(r[0] || "").split(","), vw: String(r[vi] || "").split(","), f: fold(r[2] + " \n " + r[3] + " \n " + r[4]) });
      });
      S.loaded++; S.busy = false; if (S.loaded > S.want) S.want = S.loaded; ensure();
    };
    if (PRE[day] || (window.OSAP_NEWSIX_DAY && window.OSAP_NEWSIX_DAY[day])) take();
    else script("data/live/news-index/" + encodeURIComponent(day) + ".js" + bust(), take, function () { S.loaded++; S.busy = false; S.err = "One day (" + day + ") could not be read; the others are listed."; ensure(); });
  }
  /* the open tab's reports: tagged with the tab, filed under the open country, inside the page's period, matching the filter words */
  function results() {
    var a = A(); if (!a) return [];
    var cc = a.cc, v = S.view, words = fold(S.q).split(/\s+/).filter(Boolean), out = [];
    for (var i = 0; i < S.rows.length; i++) {
      var x = S.rows[i];
      if (x.vw.indexOf(v) < 0 || x.ccs.indexOf(cc) < 0 || !a.inPeriodDate(x.r[1])) continue;
      var ok = true; for (var k = 0; k < words.length && ok; k++) ok = x.f.indexOf(words[k]) >= 0;
      if (ok) out.push(x);
    }
    return out.sort(function (p, q) { return p.r[1] < q.r[1] ? 1 : p.r[1] > q.r[1] ? -1 : 0; });
  }

  /* ---------- the section ---------- */
  function box() {
    var el = D.getElementById("vr");
    if (!el) {
      el = D.createElement("div"); el.id = "vr"; el.className = "sec vr"; el.hidden = true;
      var rail = D.querySelector("aside.rail"), first = D.getElementById("rail-flood");
      if (!rail) return null;
      if (first && first.parentNode === rail) rail.insertBefore(el, first); else rail.appendChild(el);
      el.addEventListener("click", onClick); el.addEventListener("input", onInput);
    }
    return el;
  }
  function draw() {
    var el = S.el; if (!el || el.hidden) return;
    if (S.man && !viewOk(S.view)) { el.hidden = true; return; }
    var a = A(), list = el.querySelector(".vrres"); if (!a || !list) return;
    if (!S.man) { list.innerHTML = '<p class="obs">' + esc(S.err || (S.busy ? "Reading reports…" : "")) + "</p>"; return; }
    var R = results(), total = S.man.days.length, h = [];
    h.push('<p class="vrstat"><b>' + num(R.length) + "</b> " + (R.length === 1 ? "report" : "reports") + " · searched " + S.loaded + " of " + total + " days" + (S.busy ? " (reading…)" : "") + "</p>");
    if (S.err) h.push('<p class="obs">' + esc(S.err) + "</p>");
    h.push('<ol class="vrl">' + R.slice(0, S.shown).map(function (x) {
      var r = x.r, u = safeUrl(r[5]), fl = r[7] || "";
      return '<li><a class="vrh" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r[2]) + "</a>" +
        (r[3] ? '<span class="vro">' + esc(r[3]) + "</span>" : "") +
        '<span class="vrm">' + esc(r[4]) + " · " + esc(whenTxt(r[1])) + (fl.indexOf("s") >= 0 ? " · news search result" : "") +
        (fl.indexOf("g") >= 0 ? ' · <span class="tdtag claim">State media</span>' : "") + (fl.indexOf("m") >= 0 ? " · machine translated" : "") + "</span></li>";
    }).join("") + "</ol>");
    if (!R.length && !S.busy) h.push('<p class="obs">No reports on this tab\'s topic filed under ' + esc(a.ccName()) + " in " + (S.loaded < total ? "the days read so far" : "the last " + total + " days") + (S.q ? " with these words" : "") + ".</p>");
    var more = [];
    if (R.length > S.shown) more.push('<button type="button" class="refresh" data-vr="more">Show ' + Math.min(20, R.length - S.shown) + " more</button>");
    if (S.loaded < total && !S.busy) more.push('<button type="button" class="refresh" data-vr="older">Search older days (' + (total - S.loaded) + " more)</button>");
    var q = (S.q ? S.q + " " : "") + a.viewName(S.view) + ' "' + a.ccName() + '"';
    more.push('<a class="refresh vrweb" href="https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '" target="_blank" rel="noopener noreferrer">More on the web ↗</a>');
    h.push('<div class="vrmore">' + more.join("") + "</div>");
    list.innerHTML = h.join("");
  }
  function show() {
    var a = A(), el = box(); if (!a || !el) return;
    var v = a.view(); S.el = el;
    var on = !!v && !SKIP[v] && !/^cf-/.test(v) && (!S.man || viewOk(v));
    el.hidden = !on;
    if (!on) return;
    if (v !== S.view) {
      S.view = v; S.shown = PAGE; S.q = "";
      el.innerHTML = '<div class="vrhead"><h2>Reports: ' + esc(a.viewName(v)) + '</h2><button type="button" class="refresh" data-vr="sum" title="A short summary of this tab\'s records and reports, written on this device on request">Summarise</button></div>' +
        '<p class="obs">News headlines on this tab\'s topic filed under ' + esc(a.ccName()) + ", newest first, in the period shown. What each outlet reports, not verified; each links to its source.</p>" +
        '<input type="search" class="vrq" placeholder="Filter these reports" aria-label="Filter these reports" maxlength="100">' +
        '<div class="vrres" aria-live="polite"></div><div class="sec rvpkg vrsum" id="vr-sum" hidden></div>';
    }
    ensure(); draw();
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-vr]"); if (!b) return;
    var k = b.getAttribute("data-vr");
    if (k === "more") { S.shown += 20; draw(); }
    else if (k === "older") { S.want = Math.min(S.loaded + MORE_DAYS, S.man.days.length); ensure(); }
    else if (k === "sum") summarise("vr-sum");
  }
  var qT = 0;
  function onInput(e) { if (!e.target.classList.contains("vrq")) return; clearTimeout(qT); qT = setTimeout(function () { S.q = e.target.value; S.shown = PAGE; draw(); }, 200); }

  /* ---------- Summarise ---------- */
  function poolItems(list) {
    return list.slice(0, MAX_POOL_SUM).map(function (x) {
      var r = x.r;
      return { id: "p:" + r[5], title: r[2], detail: r[3] || "", when: whenTxt(r[1]), t: ms(r[1]), src: r[4] + (String(r[7] || "").indexOf("g") >= 0 ? " (state media)" : ""), url: r[5], kind: "news", layer: "News reports", place: "", sev: 0 };
    });
  }
  function recItem(a, r) {
    return { rec: r, id: r.id, title: r.title, detail: r.detail || "", when: a.fmtTs(r), t: ms(r.issued || r.ts), src: r.src ? r.src.name : "", url: r.url || "",
      kind: r.social ? "social" : r.news ? "news" : "record", layer: a.layerName(r.layer), place: [r.place, r.prov].filter(Boolean).join(", "),
      sev: r.sev || 0, killed: r.killed, injured: r.injured, status: a.status(r) };
  }
  function summarise(boxId) {
    var a = A(), S2 = window.OSAP_AREASUM; if (!a || !S2) return;
    var v = S.view, name = a.viewName(v), cn = a.ccName();
    var go = function () {
      var recs = (a.viewRecords() || []).filter(function (r) { return r && !r.sof && r.title && a.inPeriod(r); }).map(function (r) { return recItem(a, r); });
      var seen = {}; recs.forEach(function (i) { if (i.url) seen[i.url] = 1; });
      var pool = poolItems(results().filter(function (x) { return !seen[x.r[5]]; }));
      S2.open(boxId, { items: recs.concat(pool), title: "Summary: " + name, sub: cn + " · " + name, where: "on the " + name + " tab for " + cn, about: name + " in " + cn, period: a.periodLabel() });
      var bx = D.getElementById(boxId); if (bx && bx.scrollIntoView) bx.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    /* the summary reads the reports already loaded; read up to MAX_DAYS_AUTO days first if the tab has none yet */
    if (S.man && !S.busy && S.loaded < Math.min(MAX_DAYS_AUTO, S.man.days.length) && results().length < PAGE) { S.want = MAX_DAYS_AUTO; ensure(); var t = setInterval(function () { if (!S.busy) { clearInterval(t); go(); } }, 150); return; }
    go();
  }
  /* a war tab: summarise its latest reports (the list its own block shows, with the filters set there) */
  function cfSummarise() {
    var a = A(), S2 = window.OSAP_AREASUM, lb = D.getElementById("cf-list"); if (!a || !S2 || !lb) return;
    var h = D.querySelector("#cf-rail h2"), name = h ? h.textContent : "this conflict", G = lb._groups || [];
    var items = [], events = [];
    G.forEach(function (g) {
      var mem = g.all.map(function (i, k) {
        return { id: "c:" + (i.fp || i.link || k), fp: i.fp || "", title: i.title_en || i.title, detail: i.summary_en || i.summary || "", when: whenTxt(i.date), t: ms(i.date),
          src: (i.outlet || "") + (i.state ? " (a party's own statement)" : ""), url: i.link || "", kind: i.tab ? "record" : "news", layer: i.tab || "Reports",
          place: i.geo ? i.geo.n : "", sev: 0, killed: i.killed, injured: i.injured };
      });
      items.push.apply(items, mem);
      if (mem.length >= 2) events.push({ title: mem[0].title, n: mem.length, srcs: g.outlets.length, members: mem, head: mem[0], t: mem.reduce(function (x, it) { return Math.max(x, it.t || 0); }, 0) });
    });
    var per = D.querySelector('#cf-rail select[data-cff="days"]'), pl = per && per.selectedOptions && per.selectedOptions[0] ? per.selectedOptions[0].textContent : "the period shown";
    S2.open("vr-cfsum", { items: items, events: events, title: "Summary: " + name, sub: name + " · latest reports with the filters set above", where: "in this tab's latest reports", about: name, period: pl });
  }
  function cfHook() {
    var r = D.getElementById("cf-rail"); if (!r || r.hidden) return;
    var lb = D.getElementById("cf-list"); if (!lb || D.getElementById("vr-cfbar")) return;
    var bar = D.createElement("div"); bar.className = "sec"; bar.id = "vr-cfbar";
    bar.innerHTML = '<button type="button" class="refresh" data-vrcf="1" title="A short summary of the latest reports below, written on this device on request">Summarise these reports</button>' +
      '<div class="rvpkg vrsum" id="vr-cfsum" hidden></div>';
    lb.parentNode.insertBefore(bar, lb);
    bar.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-vrcf]")) cfSummarise(); });
  }

  var CSS = "#vr .vrhead{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}#vr h2{margin:0}" +
    "#vr .vrq{width:100%;box-sizing:border-box;font:inherit;font-size:16px;min-height:40px;padding:4px 10px;margin:4px 0;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}" +
    "#vr .vrstat{font-size:12.5px;margin:4px 0}#vr ol.vrl{list-style:none;margin:0;padding:0}#vr ol.vrl li{display:flex;flex-direction:column;gap:1px;padding:6px 0;border-top:1px solid var(--line-soft,var(--line))}" +
    "#vr .vrh{font-weight:600;font-size:13.5px;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}#vr .vrh:hover{text-decoration:underline}" +
    "#vr .vro,#vr .vrm{font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}#vr .vrmore{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}#vr .vrweb{text-decoration:none}" +
    ".vrsum:not([hidden]){margin-top:10px;border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:var(--surface)}#vr-cfbar{padding:8px 14px}";
  var st = D.createElement("style"); st.textContent = CSS; D.head.appendChild(st);

  var soon = 0;
  function later() { clearTimeout(soon); soon = setTimeout(function () { show(); cfHook(); }, 30); }
  D.addEventListener("osap:view", later);
  D.addEventListener("osap:period", function () { S.shown = PAGE; later(); });
  new MutationObserver(later).observe(D.documentElement, { attributes: true, attributeFilter: ["data-view", "data-cf"] });
  function watchCf() { var r = D.getElementById("cf-rail"); if (r && !r.__vr) { r.__vr = 1; new MutationObserver(function () { cfHook(); }).observe(r, { childList: true }); } }
  new MutationObserver(watchCf).observe(D.querySelector("aside.rail") || D.body, { childList: true });
  watchCf();
  /* the manifest tells which tabs have reports; show once it is read */
  var t0 = setInterval(function () { if (A()) { clearInterval(t0); later(); } }, 100);
  window.OSAP_VIEWREP = { show: show, summarise: summarise, _results: results, _state: S };
})();
