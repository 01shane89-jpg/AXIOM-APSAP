/* AXIOM OSAP: news search over the one news pool, shown first on the Today screen.
   Self-contained block loaded after the main page script. The pool is every national outlet's headlines for every country
   (tools/news_feeds.json, kept 30 days) plus the searches of each data set in tools/topics.json; the refresh job writes it as
   a small manifest (data/live/news-index.js) and one file per day (data/live/news-index/<day>.js), built by tools/news_index.mjs.
   Nothing is loaded until the search box is used or a data set is picked; then the days load newest first and matches
   show as each day arrives. Read-only: it never changes a record.
   - Words: every word must appear, at the start of a word, in the headline (English or original); "quoted phrases" stay
     together and -word leaves headlines with that word out. Accents and case do not matter.
   - Where: this country (headlines filed under it: its own outlets, or a search result that names it) or every country.
   - Data sets: saved keyword filters from tools/topics.json; pick one to see its latest headlines, or combine with words.
   - More: a link to the same words in Bing News, for reporting the pool does not hold. It leaves the app.
   Every line is a source's headline with its outlet, time and link, not a verified report. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var PAGE = 30, FIRST_DAYS = 3, MORE_DAYS = 7;
  var S = { q: "", where: "here", topic: "", shown: PAGE, loaded: 0, want: FIRST_DAYS, busy: false, err: "", man: null, rows: [], el: null, cc: "", name: "" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function fold(s) { s = String(s || ""); try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {} return s.toLowerCase(); }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  var NOSPACE = /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u9FFF]/, LB = true;
  try { new RegExp("(?<!a)b", "u"); } catch (e) { LB = false; }
  function termRe(t) {
    t = fold(t).trim(); if (!t) return null;
    if (NOSPACE.test(t) || !LB) return new RegExp(reEsc(t), "u");
    return new RegExp("(?<![\\p{L}\\p{N}])" + reEsc(t), "u");
  }
  /* "a b" -> [{re, not}]; quoted phrases kept together; -word excludes */
  function parse(q) {
    var out = [], m, rx = /(-?)"([^"]+)"|(-?)(\S+)/g;
    while ((m = rx.exec(q))) {
      var not = !!(m[1] || m[3]), t = m[2] || m[4]; if (!t || t === "-") continue;
      var re = termRe(t); if (re) out.push({ re: re, not: not });
    }
    return out;
  }
  function ago(ms) {
    if (!isFinite(ms)) return "";
    var m = Math.round((Date.now() - ms) / 6e4);
    if (m < -5) return "";   /* an outlet's feed dated ahead of now: show its own time only */
    return m < 2 ? "just now" : m < 60 ? m + " min ago" : m < 48 * 60 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  }
  function when(d) {
    var T = window.OSAP_TIME, ms = Date.parse(d + (/Z$/.test(d) ? "" : "Z"));
    var abs = T && T.dualT ? T.dualT(ms, { date: true }) : String(d).replace("T", " ") + "Z";
    return { ms: ms, txt: (ago(ms) ? ago(ms) + " · " : "") + abs };
  }
  var NAMES = null;
  function cName(id) {
    if (!NAMES) {
      NAMES = {};
      (window.ASAP_WORLD || []).forEach(function (w) { if (w && w.id) NAMES[w.id] = w.name; });
      Array.prototype.forEach.call(document.querySelectorAll("#country-seg button[data-cc]"), function (b) {
        var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove(); NAMES[b.getAttribute("data-cc")] = c.textContent.trim(); });
    }
    return NAMES[id] || id.toUpperCase();
  }
  function here(ccs) { return ccs.indexOf(S.cc) >= 0; }

  /* ---------- loading: manifest, then days newest first ---------- */
  function bust() { return "?t=" + Math.floor(Date.now() / 6e5); }
  function script(src, ok, bad) {
    var s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = function () { s.remove(); ok(); }; s.onerror = function () { s.remove(); bad(); };
    document.head.appendChild(s);
  }
  function ensure() {
    if (S.busy) return;
    if (!S.man) {
      S.busy = true; S.err = ""; draw();
      script("data/live/news-index.js" + bust(), function () {
        S.busy = false; S.man = window.OSAP_NEWSIX || null;
        if (!S.man || !S.man.days) { S.err = "The news search index has not been built yet. It is made by the next refresh."; draw(); return; }
        drawChips(); ensure();
      }, function () { S.busy = false; S.err = navigator.onLine === false ? "Offline: the news search needs a connection the first time." : "The news search index could not be read just now."; draw(); });
      return;
    }
    if (S.loaded >= Math.min(S.want, S.man.days.length)) { draw(); return; }
    var day = S.man.days[S.loaded].d;
    S.busy = true; draw();
    var have = function (ok) { if (window.OSAP_NEWSIX_DAY && window.OSAP_NEWSIX_DAY[day]) ok(); else script("data/live/news-index/" + encodeURIComponent(day) + ".js" + bust(), ok, bad); };
    var bad = function () { S.loaded++; S.busy = false; S.err = "One day of the index (" + day + ") could not be read; the others are searched."; ensure(); };
    have(function () {
      var rows = ((window.OSAP_NEWSIX_DAY || {})[day]) || [];
      if (window.OSAP_NEWSIX_DAY) delete window.OSAP_NEWSIX_DAY[day];
      rows.forEach(function (r) { S.rows.push({ r: r, ccs: String(r[0] || "").split(",").filter(Boolean), f: fold(r[2] + " \n " + r[3] + " \n " + r[4]), tp: String(r[8] || "").split(",") }); });
      S.loaded++; S.busy = false; draw(); ensure();
    });
  }

  /* ---------- search ---------- */
  function results() {
    var terms = parse(S.q), pos = terms.filter(function (t) { return !t.not; });
    if (!pos.length && !S.topic) return null;
    var out = [];
    for (var i = 0; i < S.rows.length; i++) {
      var x = S.rows[i];
      if (S.where === "here" && !here(x.ccs)) continue;
      if (S.topic && x.tp.indexOf(S.topic) < 0) continue;
      var ok = true;
      for (var k = 0; k < terms.length && ok; k++) ok = terms[k].re.test(x.f) !== terms[k].not;
      if (ok) out.push(x);
    }
    out.sort(function (a, b) { return a.r[1] < b.r[1] ? 1 : a.r[1] > b.r[1] ? -1 : 0; });
    return out;
  }
  function webUrl() {
    var q = S.q.trim();
    if (!q && S.topic && S.man) { var t = S.man.topics.filter(function (x) { return x.id === S.topic; })[0]; if (t) q = (t.words || []).slice(0, 3).map(function (w) { return '"' + w + '"'; }).join(" OR "); }
    if (S.where === "here" && S.name) q = q + ' "' + S.name + '"';
    return "https://www.bing.com/news/search?q=" + encodeURIComponent(q.trim());
  }

  /* ---------- drawing ---------- */
  function drawChips() {
    var c = S.el && S.el.querySelector(".nqchips"); if (!c) return;
    var T = (S.man && S.man.topics) || [];
    c.innerHTML = T.length ? '<span class="nqlbl">Data sets</span>' + T.map(function (t) {
      return '<button type="button" data-nqt="' + esc(t.id) + '" aria-pressed="' + (S.topic === t.id) + '" title="' + esc((t.words || []).join(", ")) + '">' + esc(t.name) + "</button>"; }).join("") : "";
  }
  function draw() {
    if (!S.el) return;
    var box = S.el.querySelector(".nqres"); if (!box) return;
    var R = results(), h = "", total = S.man ? S.man.days.length : 0;
    if (R === null) {
      box.innerHTML = S.err ? '<p class="nqnote">' + esc(S.err) + "</p>" : "";
      return;
    }
    var status = S.busy && !S.man ? "Opening the news index…" :
      (S.man ? "Searched " + S.loaded + " of " + total + " days" + (S.busy ? " (reading the next day…)" : "") + " · " + S.rows.length.toLocaleString() + " headlines" : "");
    h += '<div class="nqstat"><span><b>' + R.length.toLocaleString() + "</b> " + (R.length === 1 ? "headline" : "headlines") +
      (S.where === "here" ? " filed under " + esc(S.name) : " from every country") + "</span><span class=\"nqobs\">" + esc(status) + "</span></div>";
    if (S.err) h += '<p class="nqnote">' + esc(S.err) + "</p>";
    R.slice(0, S.shown).forEach(function (x) {
      var r = x.r, url = safeUrl(r[5]), w = when(r[1]), fl = r[7] || "";
      var others = x.ccs.filter(function (c) { return c !== S.cc; }).slice(0, 3).map(cName);
      h += '<article class="nqrow"><a class="nqh" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(r[2]) + "</a>" +
        (r[3] ? '<span class="nqorig" lang="">' + esc(r[3]) + "</span>" : "") +
        '<span class="nqsub">' + esc(r[4]) + (S.where === "all" || others.length ? " · " + esc((S.where === "all" ? x.ccs.slice(0, 3).map(cName) : others).join(", ")) : "") + " · " + esc(w.txt) + "</span>" +
        '<span class="nqtags"><span class="tdtag unv">' + (fl.indexOf("s") >= 0 ? "News search result" : "Unverified report") + "</span>" +
        (fl.indexOf("g") >= 0 ? '<span class="tdtag claim">State media</span>' : "") + (fl.indexOf("m") >= 0 ? '<span class="tdtag mt">Machine translated</span>' : "") + "</span></article>";
    });
    var more = [];
    if (R.length > S.shown) more.push('<button type="button" class="tdlink" data-nq="more">Show ' + Math.min(PAGE, R.length - S.shown) + " more</button>");
    if (S.man && S.loaded < total && !S.busy) more.push('<button type="button" class="tdlink" data-nq="older">Search older days (' + (total - S.loaded) + " more)</button>");
    if (S.where === "here") more.push('<button type="button" class="tdlink" data-nq="all">Search every country</button>');
    more.push('<a class="tdlink nqweb" href="' + esc(webUrl()) + '" target="_blank" rel="noopener noreferrer">' + (R.length < 5 ? "Find more on the web ↗" : "More on the web ↗") + "</a>");
    h += '<div class="tdlinks">' + more.join("") + "</div>";
    if (!R.length && !S.busy && S.man && S.loaded >= total) h += '<p class="nqnote">Nothing in the last ' + total + " days of the pool. The web link above searches Bing News instead.</p>";
    box.innerHTML = h;
  }
  var deb = 0;
  function mount(el, cc, name) {
    if (!el) return;
    S.cc = cc; S.name = name || cc.toUpperCase();
    if (S.el === el) return;
    S.el = el;
    el.innerHTML = '<form class="nqform" role="search"><label class="tdvh" for="nq-q">Search news</label>' +
      '<input id="nq-q" type="search" autocomplete="off" enterkeyhint="search" maxlength="200" placeholder="Search the news" title="Any words; &quot;a phrase&quot; stays together; -word leaves it out" value="' + esc(S.q) + '">' +
      '<select id="nq-where" aria-label="Where"><option value="here"' + (S.where === "here" ? " selected" : "") + ">" + esc(S.name) + '</option><option value="all"' + (S.where === "all" ? " selected" : "") + ">Every country</option></select>" +
      '<button type="submit" class="tdmap">Search</button></form><div class="nqchips"></div><div class="nqres" aria-live="polite"></div>';
    drawChips();
    if (!S.man) { var c = el.querySelector(".nqchips"); c.innerHTML = '<button type="button" class="nqload" data-nq="load">Show data sets (earthquakes, storms, floods…)</button>'; }
    el.addEventListener("submit", function (e) { e.preventDefault(); clearTimeout(deb); S.q = el.querySelector("#nq-q").value; S.shown = PAGE; ensure(); draw(); });
    el.addEventListener("input", function (e) {
      if (e.target.id !== "nq-q") return;
      clearTimeout(deb); deb = setTimeout(function () { S.q = e.target.value; S.shown = PAGE; if (S.q.trim()) ensure(); draw(); }, 250);
    });
    el.addEventListener("change", function (e) { if (e.target.id === "nq-where") { S.where = e.target.value; S.shown = PAGE; draw(); } });
    el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-nqt],[data-nq]"); if (!b) return;
      var t = b.getAttribute("data-nqt"), a = b.getAttribute("data-nq");
      if (t != null) { S.topic = S.topic === t ? "" : t; S.shown = PAGE; drawChips(); ensure(); draw(); return; }
      if (a === "load") { ensure(); return; }
      if (a === "more") { S.shown += PAGE; draw(); return; }
      if (a === "older") { S.want = Math.min(S.want + MORE_DAYS, S.man.days.length); ensure(); return; }
      if (a === "all") { S.where = "all"; var w = el.querySelector("#nq-where"); if (w) w.value = "all"; S.shown = PAGE; draw(); }
    });
    draw();
  }
  var CSS = ".tdq{margin-bottom:12px}.nqform{display:flex;gap:6px;flex-wrap:wrap}" +
    "#nq-q{flex:1 1 260px;min-width:0;font:inherit;font-size:16px;min-height:44px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}" +
    "#nq-where{font:inherit;font-size:14px;min-height:44px;max-width:45vw;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}" +
    ".nqchips{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;padding:8px 0 2px;scrollbar-width:thin;align-items:center}.nqlbl{font-size:12px;color:var(--muted);white-space:nowrap}" +
    ".nqchips button{font:inherit;font-size:12.5px;white-space:nowrap;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:16px;min-height:32px;padding:3px 11px}" +
    ".nqchips button[aria-pressed=true]{background:var(--ink);color:var(--surface);border-color:var(--ink)}.nqchips .nqload{border-style:dashed;color:var(--muted)}" +
    ".nqstat{display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;font-size:13px;margin:8px 0 2px}.nqobs,.nqnote,.nqsub,.nqorig{font-size:12px;color:var(--muted)}" +
    ".nqres{columns:2 420px;column-gap:18px}.nqstat,.nqres .tdlinks,.nqnote{column-span:all}" +
    ".nqrow{break-inside:avoid;display:flex;flex-direction:column;gap:2px;padding:7px 0;border-top:1px solid var(--line-soft,var(--line))}" +
    ".nqh{font-weight:600;font-size:14.5px;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}.nqh:hover{text-decoration:underline}.nqorig{overflow-wrap:anywhere}" +
    ".nqtags{display:flex;flex-wrap:wrap;gap:4px}.nqweb{text-decoration:none;display:inline-flex;align-items:center}";
  var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  window.OSAP_NEWSQ = { mount: mount };
})();
