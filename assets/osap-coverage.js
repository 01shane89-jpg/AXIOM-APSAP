/* AXIOM OSAP: Story coverage, on Today under the daily summary.
   Self-contained block loaded before assets/osap-today.js, which mounts it (window.OSAP_COVERAGEQ.mount).
   Shows the open country's file from the refresh job (data/live/stories/<cc>.js, written by tools/news_stories.mjs): each
   story of the last 72 hours that two or more outlets carried, how many carried it, who owns them (state media, public
   broadcasters, private or independent outlets) and where they are based (this country or elsewhere), and the blindspots:
   stories only state media carried, stories this country's state media did not carry, and stories only outlets elsewhere carried.
   - Every line is an outlet's own headline and link. Nothing is judged: a blindspot means no matching headline was found in the
     outlets OSAP reads (a story told in other words, or in an untranslated headline, is missed), not that it went unreported.
   - Who owns an outlet comes from OSAP's outlet list (tools/news_feeds.json, tools/outlet_owners.json), not from its reporting.
   - The file is fetched only when Today is shown for the country. Read-only: it never changes a record.
   - Most covered lists story threads once their file is in (assets/osap-threads.js, Shane 2026-11-14 "go multiple layers deep
     on a topic"): every headline of one event joined, however it was worded, with a Go deeper button that opens it in layers.
     Until then, and where a country has no threads, it lists the stories as before.
   - Under Who carried it, each outlet can show About this outlet (assets/osap-outletfacts.js): who owns it and how it is paid
     for, from its Wikidata record.
   - A card that carries a strike report from a conflict tab gets a Sensor picture button (Shane 2026-11-18: satellite and sensor
     checks of military claims are what people want). One tap opens, under the card, the conflict tab's Sensor picture box for
     those reports (heat, seismic, GPS, ships, radiation, internet; each "may relate", never a confirmation) and Check it from space
     (assets/osap-space.js: the next Sentinel passes over the report's pin with the cloud forecast). The link from a headline to a
     report comes from data/live/conflicts/sensor-links.js (tools/refresh_sensors.mjs); the readings from sensors.js, read on the
     first tap. */
(function () {
  "use strict";
  var D = document, W = window, CC = "", NAME = "", el = null, state = 0, view = "top", bsel = "", shown = 10, open = {}, spOpen = {}, sensP = null, linksP = null;
  var PAGE = 10;
  var KIND = { state: "State media", public: "Public broadcaster", other: "Private or independent" };
  var BLIND = {
    "state-only": ["Only state media", "Only state-owned or state-controlled outlets carried this. No other outlet OSAP reads had a matching headline, so it is an official line no one else matched."],
    "state-silent": ["State media silent", "Three or more other outlets carried this. The state media OSAP reads for this country were publishing in the same 72 hours but had no matching headline."],
    "outside-only": ["Not covered at home", "Three or more outlets based elsewhere carried this story about the country. Its own outlets were publishing in the same 72 hours but had no matching headline."]
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* stored headlines can carry entity codes (&#8216;) from double-escaped feeds: decode them to text before escaping */
  var TA = D.createElement("textarea");
  function txt(s) { s = String(s == null ? "" : s); for (var k = 0; k < 2 && /&(#x?[0-9a-f]+|[a-z]+);/i.test(s); k++) { TA.innerHTML = s; s = TA.value; } return s.replace(/<\/?[a-z][^>]*>/gi, " "); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function ms(d) { return Date.parse(String(d || "").slice(0, 16) + "Z"); }
  function ago(t) {
    if (!isFinite(t)) return "";
    var m = Math.round((Date.now() - t) / 6e4);
    return m < -5 ? "" : m < 2 ? "just now" : m < 60 ? m + " min ago" : m < 48 * 60 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  }
  function when(d) { var T = W.OSAP_TIME, t = ms(d); return isFinite(t) && T && T.dualT ? T.dualT(t, { date: true }) : String(d || "").replace("T", " ") + "Z"; }
  var NAMES = null;
  function cName(id) {
    if (!id) return "";
    if (!NAMES) {
      NAMES = {};
      (W.ASAP_WORLD || []).forEach(function (w) { if (w && w.id) NAMES[w.id] = w.name; });
      Array.prototype.forEach.call(D.querySelectorAll("#country-seg button[data-cc]"), function (b) {
        var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove(); NAMES[b.getAttribute("data-cc")] = c.textContent.trim(); });
    }
    return NAMES[id] || id.toUpperCase();
  }
  function data() { var s = W.OSAP_STORIES; return s && s.cc === CC ? s : null; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }

  var CSS = ".tdcover{grid-column:1/-1;text-align:left}.cvhead{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.tdcover h2{margin:0}" +
    ".cvsub{font-size:12px;color:var(--muted)}" +
    // Most covered / Blindspots: one segmented control in the theme's own colours, two equal halves that always fit the width.
    // Every state sets both background and colour (the browser's default button look, and white on the light Grey/Dark
    // accent, was what made it look washed out and mismatched on a phone).
    ".cvtabs{display:flex;gap:2px;padding:2px;margin:8px 0 4px;max-width:100%;box-sizing:border-box;background:var(--surface2);border:1px solid var(--line);border-radius:6px}" +
    ".cvtabs button{flex:1 1 0;min-width:0;min-height:34px;padding:4px 8px;font:inherit;font-size:13px;font-weight:600;line-height:1.2;border:1px solid transparent;border-radius:4px;" +
    "background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cvtabs button:hover{color:var(--ink)}" +
    ".cvtabs button[aria-pressed=true]{background:var(--accent-soft,#D6E3EE);color:var(--ink);border-color:var(--accent,#1D5A86)}" +
    // the blindspot kind filter: a wrapping row of small chips with the same selected look
    ".cvtabs.cvkinds{flex-wrap:wrap;gap:6px;padding:0;background:none;border:0;border-radius:0}" +
    ".cvtabs .cvsm{flex:0 1 auto;min-height:30px;padding:3px 10px;font-weight:500;font-size:12.5px;border-color:var(--line);background:var(--surface)}" +
    ".cvlist{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:0 18px}" +
    ".cvlist>li{padding:8px 0;border-top:1px solid var(--line-soft,var(--line));font-size:13.5px;line-height:1.4;overflow-wrap:anywhere;min-width:0}" +
    ".cvt{font-weight:600;text-decoration:none;color:var(--ink)}.cvt:hover{text-decoration:underline}" +
    ".cvbar{display:flex;height:7px;border-radius:4px;overflow:hidden;margin:5px 0 3px;background:var(--line)}.cvbar i{display:block;height:100%}" +
    ".cvk-state{background:#c2410c}.cvk-public{background:#2f6db5}.cvk-other{background:#7a8594}" +
    ".cvmeta{display:block;font-size:12px;color:var(--muted)}.cvmeta b{color:var(--ink);font-weight:600}" +
    ".cvdot{display:inline-block;width:8px;height:8px;border-radius:2px;margin:0 3px 0 6px;vertical-align:0}.cvdot:first-child{margin-left:0}" +
    ".cvb{display:inline-block;font:700 10.5px/1.6 inherit;letter-spacing:.03em;text-transform:uppercase;border-radius:3px;padding:0 6px;margin:3px 6px 0 0;cursor:help;" +
      "color:#7c2d12;background:#fde7d6;border:1px solid #f3b58b}" +
    ".cvsrc summary{cursor:pointer;font-size:12px;min-height:26px;padding-top:3px;color:var(--accent,#1f5f99)}.cvsrc ul{list-style:none;margin:2px 0 0;padding:0 0 0 10px;border-left:2px solid var(--line)}" +
    ".cvsrc li{padding:3px 0;font-size:12.5px}.cvsrc a{font-weight:600}.cvo{color:var(--muted)}" +
    ".cvdeep{display:inline-flex;align-items:center;margin-top:6px;min-height:36px;padding:3px 14px;font:inherit;font-size:13px;font-weight:700;border:1px solid var(--accent,#1D5A86);border-radius:6px;background:var(--accent-soft,#D6E3EE);color:var(--ink);cursor:pointer}" +
    ".cvdeep::after{content:' \\203A';margin-left:4px}.cvparts b{font-weight:600;color:var(--ink)}" +
    ".cvdeep.cvsp{margin-left:6px;background:var(--surface);font-weight:600}.cvdeep.cvsp[aria-expanded=true]::after{content:' \\2039'}" +
    ".cvspbox{margin:6px 0 2px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface2,var(--surface))}.cvspbox h3{margin:0 0 4px;font-size:13px}" +
    // the same look as the conflict tab's Sensor picture box (assets/osap-conflicts.js, #cf-rail .cfpic)
    ".cvspbox .cfpic{margin:6px 0;padding:4px 8px 2px;border:1px dashed #8a8f98;border-radius:6px}.cvspbox .cfpich{font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--muted)}" +
    ".cvspbox details.cfmt{margin:4px 0 0;font-size:12.5px;line-height:1.45}.cvspbox details.cfmt>summary{cursor:pointer;min-height:28px;padding-top:4px;color:var(--accent,#1f5f99)}" +
    ".cvspbox .mt{font-size:12.5px;margin:3px 0 0;padding:4px 7px;border-left:3px dashed #8a8f98}.cvspbox .cfm{font-size:11.5px;color:var(--muted);margin:3px 0}" +
    ".cvmore{margin-top:6px;min-height:32px;padding:3px 12px;font-weight:600}.cvfoot{margin-top:8px;font-size:12px;color:var(--muted)}.cvfoot p{margin:3px 0}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .cvb{color:#fed7aa;background:#4a2412;border-color:#9a3412}}:root[data-theme=dark] .cvb{color:#fed7aa;background:#4a2412;border-color:#9a3412}";

  function bar(s) {
    var n = s.n || 1, h = "";
    ["state", "public", "other"].forEach(function (k) { var v = s.k && s.k[k] || 0; if (v) h += '<i class="cvk-' + k + '" style="width:' + (100 * v / n).toFixed(1) + '%"></i>'; });
    return '<div class="cvbar" aria-hidden="true">' + h + "</div>";
  }
  function split(s) {
    var k = s.k || {}, o = s.o || {}, parts = [];
    ["state", "public", "other"].forEach(function (x) { if (k[x]) parts.push('<span class="cvdot cvk-' + x + '"></span>' + k[x] + " " + (x === "other" ? "private or independent" : x === "state" ? "state media" : "public")); });
    var where = [];
    /* World: each story is told against its own country */
    if (CC === "ww" && s.cc) { var cn = cName(s.cc); if (o.dom) where.push(o.dom + " in " + esc(cn)); if (o.out) where.push(o.out + " elsewhere"); if (o.unk) where.push(o.unk + " not placed");
      return esc(cn) + " · " + parts.join(" ") + (where.length ? " · " + where.join(", ") : ""); }
    if (o.dom) where.push(o.dom + " in " + esc(NAME));
    if (o.out) where.push(o.out + " elsewhere");
    if (o.unk) where.push(o.unk + " not placed");
    return parts.join(" ") + (where.length ? " · " + where.join(", ") : "");
  }
  /* strike reports this card carries (by headline link, data/live/conflicts/sensor-links.js), grouped by conflict */
  function spRefs(links) {
    var L = W.OSAP_CF_LINKS, by = L && L.by; if (!by) return null;
    var out = [], ix = {};
    links.forEach(function (u) {
      var r = u && by[u]; if (!r || !Array.isArray(r) || r.length < 5 || !/^[0-9a-f]{64}$/.test(r[1] || "")) return;
      var g = ix[r[0]]; if (!g) { g = ix[r[0]] = { cid: String(r[0]), fps: [], pins: [] }; out.push(g); }
      if (g.fps.indexOf(r[1]) < 0) g.fps.push(r[1]);
      // one Check it from space per place: a pin within about 25 km of one already listed is the same place
      if (isFinite(r[2]) && isFinite(r[3]) && !g.pins.some(function (p) { return Math.abs(p.la - r[2]) < 0.25 && Math.abs(p.lo - r[3]) < 0.25; })) g.pins.push({ la: +r[2], lo: +r[3], t: r[4] });
    });
    return out.length ? out : null;
  }
  function cardLinks(rows, u) { var a = (rows || []).map(function (r) { return r && r[5]; }); if (u) a.unshift(u); return a; }
  function spBtn(id, refs) {
    if (!refs) return "";
    return '<button type="button" class="cvdeep cvsp" data-cvsp="' + esc(id) + '" aria-expanded="' + !!spOpen[id] + '" title="Open satellite and sensor readings near the strike report this story carries, and when Sentinel next passes over it">Sensor picture</button>';
  }
  function spPanel(id, refs) {
    if (!refs || !spOpen[id]) return "";
    var T = W.OSAP_CONFLICT_TABS, X = W.OSAP_SPACE, h = '<div class="cvspbox" data-cvspbox="' + esc(id) + '">';
    if (!W.OSAP_CF_SENSORS && sensP) h += '<p class="tdobs">Loading the sensor readings…</p>';
    refs.slice(0, 2).forEach(function (g) {
      var name = (T && T.name && T.name(g.cid)) || g.cid, box = T && T.sensorBox && W.OSAP_CF_SENSORS ? T.sensorBox(g.cid, g.fps) : "";
      h += "<h3>" + plural(g.fps.length, "strike report") + " in the " + esc(name) + " tab</h3>";
      h += box || (W.OSAP_CF_SENSORS ? '<p class="cfm">No open sensor reading is paired with ' + (g.fps.length === 1 ? "this report" : "these reports") + " yet. Nothing listed does not mean nothing happened.</p>" : "");
      if (X) g.pins.slice(0, 2).forEach(function (p, k) { h += X.html({ la: p.la, lo: p.lo, t: p.t, what: g.pins.length > 1 ? "place " + (k + 1) : "" }, true); });
      if (T && T.open) h += '<button type="button" class="cvmore" data-cvcf="' + esc(g.cid) + '">Open the ' + esc(name) + " tab</button>";
    });
    return h + '<p class="cfm">Reports are claims, not verified. Each reading may relate; none confirms a report.</p></div>';
  }
  function loadSensors() {
    if (sensP) return sensP;
    sensP = new Promise(function (ok) {
      var s = D.createElement("script"); s.src = "data/live/conflicts/sensors.js?m=" + Math.floor(Date.now() / 6e5); s.async = true;
      s.onload = s.onerror = function () { s.remove(); ok(); }; D.head.appendChild(s);
    });
    return sensP;
  }
  function loadLinks(done) {
    if (!linksP) linksP = new Promise(function (ok) {
      var s = D.createElement("script"); s.src = "data/live/conflicts/sensor-links.js?m=" + Math.floor(Date.now() / 6e5); s.async = true;
      s.onload = s.onerror = function () { s.remove(); ok(); }; D.head.appendChild(s);
    });
    linksP.then(done);
  }
  function storyHtml(s) {
    var u = safeUrl(s.u), b = s.b && BLIND[s.b], t = txt(s.t);
    var h = "<li>" + (u ? '<a class="cvt" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>" : '<span class="cvt">' + esc(t) + "</span>");
    h += bar(s) + '<span class="cvmeta"><b>' + plural(s.n, "outlet") + "</b> · " + split(s) + "</span>";
    h += '<span class="cvmeta">' + esc(s.s || "") + (ago(ms(s.d)) ? " · latest " + esc(ago(ms(s.d))) : "") + "</span>";
    if (b) h += '<span class="cvb" tabindex="0" title="' + esc(b[1]) + '">' + esc(b[0]) + "</span>";
    var th = W.OSAP_THREADSQ && W.OSAP_THREADSQ.ofLinks(CC, (s.src || []).map(function (r) { return r[5]; }));
    if (th) h += '<button type="button" class="cvdeep" data-cvdeep="' + esc(th.id) + '">Go deeper</button>';
    var sp = spRefs(cardLinks(s.src, s.u));
    h += spBtn("s" + s.id, sp) + spPanel("s" + s.id, sp);
    h += '<details class="cvsrc" data-cvid="' + esc(s.id) + '"' + (open[s.id] ? " open" : "") + "><summary>Who carried it</summary><ul>" + (s.src || []).map(function (r) {
      /* [outlet, kind, home, outlet's country, date, link, headline, machine translated, country inferred] */
      var ru = safeUrl(r[5]), place = r[3] ? cName(r[3]) + (r[8] ? " (placed by where its stories are filed)" : "") : "country not known";
      return "<li>" + (ru ? '<a href="' + esc(ru) + '" target="_blank" rel="noopener noreferrer">' + esc(r[0]) + "</a>" : esc(r[0])) +
        ' <span class="cvo">· ' + esc(KIND[r[1]] || "") + (r[1] === "state" ? " (a claim)" : "") + " · " + esc(place) + " · " + esc(when(r[4])) + "</span>" +
        (r[6] && r[6] !== s.t ? '<div class="cvo">' + esc(txt(r[6])) + (r[7] ? " (machine translated)" : "") + "</div>" : r[7] ? '<div class="cvo">Machine translated headline</div>' : "") +
        (W.OSAP_OUTLETFACTSQ ? W.OSAP_OUTLETFACTSQ.html(r[5]) : "") + "</li>";
    }).join("") + (s.srcMore ? '<li class="cvo">and ' + s.srcMore + " more: open " + esc(cName(s.cc)) + " for the full list</li>" : "") + '</ul><div class="cvo">Record fingerprint (SHA-256 of the links): ' + esc(String(s.fp || "").slice(0, 16)) + "…</div></details></li>";
    return h;
  }
  /* a story thread: one event however it was worded, with what the layers hold and the button that opens them */
  function threadHtml(t) {
    var u = safeUrl(t.u), P = (W.OSAP_THREADSQ && W.OSAP_THREADSQ.PART) || {}, parts = [];
    (t.parts || []).forEach(function (p) { var n = 0; p[1].forEach(function (x) { n += x[0].length; }); if (P[p[0]]) parts.push([p[0], P[p[0]][0], n]); });
    var order = ["what", "why", "said", "impact", "next"];
    parts.sort(function (a, b) { return order.indexOf(a[0]) - order.indexOf(b[0]); });
    var h = '<li class="cvth">' + (u ? '<a class="cvt" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(t.t)) + "</a>" : '<span class="cvt">' + esc(txt(t.t)) + "</span>");
    h += bar(t) + '<span class="cvmeta"><b>' + plural(t.n, "outlet") + "</b>, " + plural(t.r, "report") + " · " + split(t) + "</span>";
    h += '<span class="cvmeta">' + (ago(ms(t.d)) ? "latest " + esc(ago(ms(t.d))) : "") + (ago(ms(t.d0)) ? " · first " + esc(ago(ms(t.d0))) : "") + "</span>";
    if (parts.length) h += '<span class="cvmeta cvparts">' + parts.map(function (p) { return esc(p[1]) + " <b>" + p[2] + "</b>"; }).join(" · ") + "</span>";
    if (t.names && t.names.length) h += '<span class="cvmeta">Names: ' + esc(t.names.slice(0, 5).map(function (n) { return n[0]; }).join(", ")) + "</span>";
    var sp = spRefs(cardLinks(t.rows, t.u));
    return h + '<button type="button" class="cvdeep" data-cvdeep="' + esc(t.id) + '">Go deeper</button>' + spBtn("t" + t.id, sp) + spPanel("t" + t.id, sp) + "</li>";
  }
  function threads() { var Q = W.OSAP_THREADSQ, f = Q && Q.get(CC); return f && f.threads && f.threads.length ? f.threads : null; }
  function list() {
    var S = data(), L = S ? S.stories || [] : [];
    if (view === "top") return threads() || L.filter(function (s) { return !s.b; });
    return L.filter(function (s) { return s.b && (!bsel || s.b === bsel); });
  }
  function locked() { var T = W.OSAP_TIER; return !!(T && T.on && T.on() && T.allows && !T.allows("mid")); }
  function render() {
    if (!el) return;
    var S = data(), h = '<div class="cvhead"><h2>Story coverage</h2>';
    if (!S) {
      h += "</div>";
      if (state < 2) h += '<p class="tdobs">Loading…</p>';
      else if (locked()) h += '<p class="tdobs">Story coverage is part of the Mid plan.</p>' + (W.OSAP_TIER && W.OSAP_TIER.open ? '<button type="button" class="cvmore" data-cvplans>See plans</button>' : "");
      else h += '<p class="tdobs">Story coverage for ' + esc(NAME) + " has not been built yet. It is made by the next news refresh.</p>";
      el.innerHTML = h; el.hidden = false; return;
    }
    var all = S.stories || [], nb = all.filter(function (s) { return s.b; }).length, L = list();
    h += '<span class="cvsub">Last ' + esc(S.hours) + " hours · " + plural(S.outlets || 0, "outlet") + " · " + plural(S.reports || 0, "headline") + " · built " + esc(when(String(S.asof).replace(" ", "T"))) + "</span></div>";
    h += '<div class="cvtabs" role="group" aria-label="Show"><button type="button" data-cvview="top" aria-pressed="' + (view === "top") + '">Most covered</button>' +
      (CC === "ww" ? "" : '<button type="button" data-cvview="blind" aria-pressed="' + (view === "blind") + '">Blindspots (' + nb + ")</button>") + "</div>";
    if (view === "blind") {
      h += '<div class="cvtabs cvkinds" role="group" aria-label="Blindspot kind"><button type="button" class="cvsm" data-cvb="" aria-pressed="' + (!bsel) + '">All</button>' +
        Object.keys(BLIND).map(function (k) { var n = all.filter(function (s) { return s.b === k; }).length;
          return '<button type="button" class="cvsm" data-cvb="' + k + '" aria-pressed="' + (bsel === k) + '" title="' + esc(BLIND[k][1]) + '">' + esc(BLIND[k][0]) + " (" + n + ")</button>"; }).join("") + "</div>";
    }
    if (!L.length) h += '<p class="tdobs">' + (view === "top" ? "No story was carried by two or more outlets in the last " + esc(S.hours) + " hours." :
      "No blindspot of this kind in the last " + esc(S.hours) + " hours.") + "</p>";
    else h += '<ul class="cvlist">' + L.slice(0, shown).map(view === "top" && threads() ? threadHtml : storyHtml).join("") + "</ul>" + (L.length > shown ? '<button type="button" class="cvmore" data-cvmore>Show ' + Math.min(PAGE, L.length - shown) + " more of " + L.length + "</button>" : "");
    var sd = S.sides || {}, a = sd.active || {};
    h += '<div class="cvfoot"><p><span class="cvdot cvk-state"></span>State media <span class="cvdot cvk-public"></span>Public broadcaster <span class="cvdot cvk-other"></span>Private or independent. ' +
      "Ownership is from OSAP's outlet list, not a judgment of the reporting; state media lines are that government's claims.</p>" +
      (CC === "ww" ? "" : "<p>" + (sd.stateRead && sd.stateRead.length ? "State media OSAP reads for " + esc(NAME) + ": " + esc(sd.stateRead.join(", ")) + (a.state ? "" : " (too few headlines in the window to call it silent)") + ". "
        : "OSAP reads no state media for " + esc(NAME) + ", so there is no state-media-silent check. ") +
      (sd.home ? plural(sd.home, esc(NAME) + " outlet") + " with " + plural(sd.homeReports || 0, "headline") + " in the window." : "") + "</p>") +
      "<p>" + esc(S.method || "") + "</p></div>";
    el.innerHTML = h; el.hidden = false;
    if (W.OSAP_SPACE) Array.prototype.forEach.call(el.querySelectorAll("details.ospx[open]"), W.OSAP_SPACE.fill);
  }
  function load() {
    if (state) return; state = 1;
    var s = D.createElement("script");
    s.src = "data/live/stories/" + encodeURIComponent(CC) + ".js?t=" + Math.floor(Date.now() / 6e5);
    s.async = true;
    s.onload = s.onerror = function () {
      s.remove(); state = 2; render();
      // then which cards carry a strike report, for the Sensor picture button
      if (data()) loadLinks(function () { if (W.OSAP_CF_LINKS) render(); });
      // then the threads, for Go deeper: Most covered switches to them when they are in
      if (W.OSAP_THREADSQ && data()) W.OSAP_THREADSQ.load(CC, function () { render(); });
      // then who owns and pays for each outlet (assets/osap-outletfacts.js), for "About this outlet" under Who carried it
      if (W.OSAP_OUTLETFACTSQ && data()) W.OSAP_OUTLETFACTSQ.load(function () { render(); });
    };
    D.head.appendChild(s);
  }
  function mount(box, cc, name) {
    el = box; CC = cc; NAME = name || cc; el.classList.add("tdcover");
    if (!D.getElementById("cv-css")) { var st = D.createElement("style"); st.id = "cv-css"; st.textContent = CSS; D.head.appendChild(st); }
    el.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("button"); if (!t) return;
      if (t.hasAttribute("data-cvview")) { view = t.getAttribute("data-cvview"); shown = PAGE; render(); }
      else if (t.hasAttribute("data-cvb")) { bsel = t.getAttribute("data-cvb"); shown = PAGE; render(); }
      else if (t.hasAttribute("data-cvmore")) { shown += PAGE; render(); }
      else if (t.hasAttribute("data-cvplans") && W.OSAP_TIER) W.OSAP_TIER.open();
      else if (t.hasAttribute("data-cvsp")) {
        var id = t.getAttribute("data-cvsp"); spOpen[id] = !spOpen[id];
        if (spOpen[id] && !W.OSAP_CF_SENSORS) loadSensors().then(render);
        render();
        var bx = el.querySelector('[data-cvspbox="' + id.replace(/"/g, "") + '"]'); if (bx && bx.scrollIntoView) bx.scrollIntoView({ block: "nearest" });
      }
      else if (t.hasAttribute("data-cvcf") && W.OSAP_CONFLICT_TABS) {
        var cid = t.getAttribute("data-cvcf"), ix = W.OSAP_CONFLICTS && W.OSAP_CONFLICTS.conflicts || [], c = ix.filter(function (x) { return x.id === cid; })[0];
        var cs = (c && c.countries) || [], c0 = cs.indexOf(CC) >= 0 ? CC : cs[0] || CC;
        if (W.OSAP_TODAY && W.OSAP_TODAY.hide) W.OSAP_TODAY.hide();
        W.OSAP_CONFLICT_TABS.open(cid, c0);
      }
      else if (t.hasAttribute("data-cvdeep") && W.OSAP_THREADSQ) W.OSAP_THREADSQ.open(CC, t.getAttribute("data-cvdeep"));
    });
    el.addEventListener("toggle", function (e) { var d = e.target; if (d.classList && d.classList.contains("cvsrc")) open[d.getAttribute("data-cvid")] = d.open; }, true);
    render(); load();
  }
  W.OSAP_COVERAGEQ = { mount: mount };
})();
