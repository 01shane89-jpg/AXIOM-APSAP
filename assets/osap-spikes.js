/* AXIOM OSAP: Reporting level, on Today under the daily summary.
   Self-contained block loaded before assets/osap-today.js, which mounts it (window.OSAP_SPIKESQ.mount).
   Reads data/live/spikes.js (window.OSAP_SPIKES, written by tools/news_spikes.mjs from the news search index) and shows:
   - the open country's headline count for the last 24 hours against its normal level and typical range, with the last 15 days;
   - its own data sets (Korea DMZ, Taiwan Strait, ...) that are above normal;
   - every country and data set that is spiking now, with the newest headlines behind each one (each outlet's own link).
   The method is plain and stated on the card (tools/spikes_lib.mjs). A spike is a count of headlines, not of events, and is a
   prompt to look, not a finding. Read-only: it never changes a record. The file is fetched only when Today is shown. */
(function () {
  "use strict";
  var D = document, W = window, CC = "", NAME = "", el = null, state = 0, openRows = {};
  var LV = {
    spike: ["Spike", "At least twice its normal level and well outside its usual day-to-day range."],
    above: ["Above normal", "At least 1.5 times its normal level and well outside its usual day-to-day range."],
    below: ["Below normal", "Half its normal level or less. This is often a feed outage at OSAP's end rather than a quiet day."],
    normal: ["Normal", "Within or near its usual day-to-day range."],
    "new": ["Not enough history", "Headlines on fewer than 3 of the last 14 days, so there is no normal level to compare with yet."]
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var TA = D.createElement("textarea");
  function txt(s) { s = String(s == null ? "" : s); for (var k = 0; k < 2 && /&(#x?[0-9a-f]+|[a-z]+);/i.test(s); k++) { TA.innerHTML = s; s = TA.value; } return s.replace(/<\/?[a-z][^>]*>/gi, " "); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function ms(d) { return Date.parse(String(d || "").replace(" ", "T").slice(0, 16) + "Z"); }
  function when(d) { var T = W.OSAP_TIME, t = ms(d); return isFinite(t) && T && T.dualT ? T.dualT(t, { date: true }) : String(d || "").replace("T", " "); }
  function num(n) { return n == null ? "–" : Number(n) >= 100 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10); }
  function plural(n, one, many) { return num(n) + " " + (n === 1 ? one : many || one + "s"); }
  var NAMES = null;
  function cName(id) {
    if (!NAMES) {
      NAMES = {};
      (W.ASAP_WORLD || []).forEach(function (w) { if (w && w.id) NAMES[w.id] = w.name; });
      Array.prototype.forEach.call(D.querySelectorAll("#country-seg button[data-cc]"), function (b) {
        var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove(); NAMES[b.getAttribute("data-cc")] = c.textContent.trim(); });
    }
    return NAMES[id] || String(id).toUpperCase();
  }
  function canOpen(id) { if (!NAMES) cName(id); return !!NAMES[id]; }
  function data() { var s = W.OSAP_SPIKES; return s && s.countries ? s : null; }
  function setName(S, id) { var s = S.sets && S.sets[id]; return s ? s[0] : id; }

  var CSS = ".tdspike{grid-column:1/-1;text-align:left}.sphead{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.tdspike h2{margin:0}" +
    ".spsub{font-size:12px;color:var(--muted)}" +
    ".spnow{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:8px 0 2px}" +
    ".spbig{font-size:26px;font-weight:700;line-height:1;color:var(--ink)}.spbig small{display:block;font-size:12px;font-weight:500;color:var(--muted);margin-top:3px}" +
    ".spcmp{font-size:13.5px;line-height:1.45;min-width:0;flex:1 1 220px}.spcmp b{color:var(--ink)}" +
    ".spchart{flex:0 1 260px;min-width:160px;max-width:100%}.spchart svg{display:block;width:100%;height:56px}.spchart .spax{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}" +
    ".spbar{fill:var(--muted);opacity:.45}.spbar.now{opacity:1}.spbar.now.spike{fill:#b42318}.spbar.now.above{fill:#b54708}.spbar.now.below{fill:#3b6ea5}" +
    ".spnorm{fill:none;stroke:var(--ink);stroke-width:1.2;stroke-dasharray:3 2;opacity:.7}" +
    ".splv{display:inline-block;font:700 10.5px/1.6 inherit;letter-spacing:.03em;text-transform:uppercase;border-radius:3px;padding:0 6px;cursor:help;white-space:nowrap;border:1px solid}" +
    ".splv-spike{color:#7a1b12;background:#fde3e0;border-color:#f2a59b}.splv-above{color:#7a3b05;background:#fdecd2;border-color:#f0b878}" +
    ".splv-below{color:#1d3f66;background:#dde9f6;border-color:#9dbbe0}.splv-normal,.splv-new{color:var(--muted);background:transparent;border-color:var(--line)}" +
    ".sph3{font-size:13px;font-weight:700;margin:12px 0 2px}" +
    ".splist{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:0 18px}" +
    ".splist>li{padding:7px 0;border-top:1px solid var(--line-soft,var(--line));font-size:13.5px;line-height:1.4;overflow-wrap:anywhere;min-width:0}" +
    ".spname{font-weight:600;color:var(--ink)}.spmeta{display:block;font-size:12px;color:var(--muted)}" +
    ".spgo{margin-left:6px;min-height:26px;padding:1px 8px;font-size:12px}" +
    ".spwhy summary{cursor:pointer;font-size:12px;min-height:26px;padding-top:3px;color:var(--accent,#1f5f99)}.spwhy ul{list-style:none;margin:2px 0 0;padding:0 0 0 10px;border-left:2px solid var(--line)}" +
    ".spwhy li{padding:3px 0;font-size:12.5px}.spwhy a{font-weight:600}.spo{color:var(--muted)}" +
    ".spfoot{margin-top:8px;font-size:12px;color:var(--muted)}.spfoot p{margin:3px 0}.spmore{margin-top:6px;min-height:32px;padding:3px 12px;font-weight:600}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .splv-spike{color:#fecaca;background:#4c1512;border-color:#a3271b}" +
      ":root:not([data-theme=light]) .splv-above{color:#fed7aa;background:#4a2412;border-color:#9a3412}:root:not([data-theme=light]) .splv-below{color:#cfe0f5;background:#1b2d45;border-color:#3b6ea5}}" +
    ":root[data-theme=dark] .splv-spike{color:#fecaca;background:#4c1512;border-color:#a3271b}:root[data-theme=dark] .splv-above{color:#fed7aa;background:#4a2412;border-color:#9a3412}" +
    ":root[data-theme=dark] .splv-below{color:#cfe0f5;background:#1b2d45;border-color:#3b6ea5}";

  function badge(lvl) { var l = LV[lvl] || LV.normal; return '<span class="splv splv-' + esc(lvl) + '" tabindex="0" title="' + esc(l[1]) + '">' + esc(l[0]) + "</span>"; }
  /* the 15 daily counts as bars, with the normal level for each day as a dashed line (today's normal scaled by that day's total) */
  function chart(S, p) {
    var d = p.d || [], T = S.totals || [], n = d.length; if (!n) return "";
    var last = T[T.length - 1] || 0, norm = p.exp != null && last ? d.map(function (_, i) { return p.exp * (T[i] || 0) / last; }) : null;
    var max = Math.max.apply(null, d.concat(norm || [0], [1])), w = 100 / n, h = 56, pts = [];
    var bars = d.map(function (v, i) {
      var bh = Math.max(v ? 1 : 0, v / max * (h - 4)), now = i === n - 1;
      if (norm) pts.push(((i + 0.5) * w).toFixed(2) + "," + (h - norm[i] / max * (h - 4)).toFixed(2));
      return '<rect class="spbar' + (now ? " now " + esc(p.lvl) : "") + '" x="' + (i * w + w * 0.12).toFixed(2) + '" y="' + (h - bh).toFixed(2) + '" width="' + (w * 0.76).toFixed(2) + '" height="' + bh.toFixed(2) + '"><title>' +
        (now ? "Last 24 hours" : (n - 1 - i) + (n - 1 - i === 1 ? " day" : " days") + " before") + ": " + plural(v, "headline") + (norm ? ", normal " + num(norm[i]) : "") + "</title></rect>";
    }).join("");
    return '<div class="spchart" role="img" aria-label="Headlines per day for the last ' + n + ' days, with the normal level as a dashed line"><svg viewBox="0 0 100 ' + h + '" preserveAspectRatio="none">' + bars +
      (norm ? '<polyline class="spnorm" vector-effect="non-scaling-stroke" points="' + pts.join(" ") + '"/>' : "") + '</svg><div class="spax"><span>' + (n - 1) + " days ago</span><span>Last 24 h</span></div></div>";
  }
  function cmpText(p) {
    if (p.lvl === "new" || p.exp == null) return "Not enough history yet to say what is normal: headlines on " + plural(p.nb || 0, "day") + " of the last 14.";
    return "Normal: <b>" + num(p.exp) + "</b> a day (typical range " + num(p.lo) + "–" + num(p.hi) + ")" + " · <b>" + (p.x != null ? p.x.toFixed(1) : "–") + "×</b> normal";
  }
  function why(S, key, p) {
    if (!p.top || !p.top.length) return "";
    return '<details class="spwhy" data-spid="' + esc(key) + '"' + (openRows[key] ? " open" : "") + "><summary>Newest headlines</summary><ul>" + p.top.map(function (r) {
      /* [headline, outlet, link, date, flags] */
      var u = safeUrl(r[2]), f = String(r[4] || "");
      return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(r[0])) + "</a>" : esc(txt(r[0]))) +
        ' <span class="spo">· ' + esc(r[1] || "") + (f.indexOf("g") >= 0 ? " (state media, a claim)" : "") + " · " + esc(when(r[3])) + (f.indexOf("m") >= 0 ? " · machine translated" : "") + "</span></li>";
    }).join("") + "</ul></details>";
  }
  function row(S, kind, id, p) {
    var key = kind + ":" + id, name = kind === "c" ? cName(id) : setName(S, id);
    var go = kind === "c" && id !== CC && canOpen(id) ? '<button type="button" class="spgo" data-spgo="' + esc(id) + '" title="Open Today for ' + esc(name) + '">Open</button>' : "";
    return "<li>" + badge(p.lvl) + ' <span class="spname">' + esc(name) + "</span>" + (kind === "s" ? ' <span class="spo">(data set)</span>' : "") + go +
      '<span class="spmeta">' + plural(p.n, "headline") + " in the last 24 h · normal " + num(p.exp) + " (range " + num(p.lo) + "–" + num(p.hi) + ") · " + (p.x != null ? p.x.toFixed(1) : "–") + "× normal</span>" + why(S, key, p) + "</li>";
  }
  function locked() { var T = W.OSAP_TIER; return !!(T && T.on && T.on() && T.allows && !T.allows("mid")); }
  var shown = 8;
  function render() {
    if (!el) return;
    var S = data(), h = '<div class="sphead"><h2>Reporting level</h2>';
    if (!S) {
      h += "</div>";
      if (state < 2) h += '<p class="tdobs">Loading…</p>';
      else if (locked()) h += '<p class="tdobs">Reporting level is part of the Mid plan.</p>' + (W.OSAP_TIER && W.OSAP_TIER.open ? '<button type="button" class="spmore" data-spplans>See plans</button>' : "");
      else h += '<p class="tdobs">Reporting levels have not been built yet. They are made by the next news refresh.</p>';
      el.innerHTML = h; el.hidden = false; return;
    }
    var p = S.countries[CC];
    h += '<span class="spsub">Headlines in the last ' + esc(S.hours) + " hours against the last " + esc(S.base) + " days · built " + esc(when(S.asof)) + "</span></div>";
    if (p) {
      h += '<div class="spnow"><div class="spbig">' + num(p.n) + "<small>headlines, last 24 h</small></div>" +
        '<div class="spcmp">' + badge(p.lvl) + " " + esc(NAME) + "<br>" + cmpText(p) + "</div>" + chart(S, p) + "</div>";
      if (p.lvl === "below") h += '<p class="tdobs">Fewer headlines than normal. This is more often a feed outage at OSAP\'s end than a quiet day: check Data health.</p>';
      if (p.top && p.top.length) h += why(S, "c:" + CC, p);
    } else h += '<p class="tdobs">No headlines for ' + esc(NAME) + " in OSAP's news pool in the last " + esc(S.base + 1) + " days.</p>";
    /* this country's own data sets that are up */
    var mine = Object.keys(S.datasets || {}).filter(function (id) { var s = S.sets[id], q = S.datasets[id]; return s && s[1] && s[1].indexOf(CC) >= 0 && (q.lvl === "spike" || q.lvl === "above"); });
    if (mine.length) h += '<div class="sph3">' + esc(NAME) + " data sets above normal</div>" + '<ul class="splist">' + mine.map(function (id) { return row(S, "s", id, S.datasets[id]); }).join("") + "</ul>";
    var F = (S.flagged || []).filter(function (f) { return !(f[0] === "c" && f[1] === CC) && !(f[0] === "s" && mine.indexOf(f[1]) >= 0); });
    h += '<div class="sph3">Above normal now, worldwide (' + F.length + ")</div>";
    if (!F.length) h += '<p class="tdobs">No country or data set is above its normal level in the last ' + esc(S.hours) + " hours.</p>";
    else h += '<ul class="splist">' + F.slice(0, shown).map(function (f) { return row(S, f[0], f[1], (f[0] === "c" ? S.countries : S.datasets)[f[1]]); }).join("") + "</ul>" +
      (F.length > shown ? '<button type="button" class="spmore" data-spmore>Show ' + Math.min(8, F.length - shown) + " more of " + F.length + "</button>" : "");
    h += '<div class="spfoot"><p>A spike is a prompt to look, not a finding: open the headlines and judge them yourself.</p>' +
      '<details class="spwhy spmethod"' + (openRows.method ? " open" : "") + ' data-spid="method"><summary>How this is worked out</summary><p>' + esc(S.method || "") + "</p></details></div>";
    el.innerHTML = h; el.hidden = false;
  }
  function load() {
    if (state) return; state = 1;
    var s = D.createElement("script");
    s.src = "data/live/spikes.js?t=" + Math.floor(Date.now() / 6e5);
    s.async = true;
    s.onload = s.onerror = function () { s.remove(); state = 2; render(); };
    D.head.appendChild(s);
  }
  function openCountry(id) {
    if (W.OSAP_MYCC && W.OSAP_MYCC.go) { W.OSAP_MYCC.go(id); return; }
    try { sessionStorage.setItem("osap-today", "1"); } catch (e) {}
    location.hash = (id === "th" ? "" : id + "/") + "timeline"; location.reload();
  }
  function mount(box, cc, name) {
    el = box; CC = cc; NAME = name || cc; el.classList.add("tdspike");
    if (!D.getElementById("sp-css")) { var st = D.createElement("style"); st.id = "sp-css"; st.textContent = CSS; D.head.appendChild(st); }
    el.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("button"); if (!t) return;
      if (t.hasAttribute("data-spgo")) openCountry(t.getAttribute("data-spgo"));
      else if (t.hasAttribute("data-spmore")) { shown += 8; render(); }
      else if (t.hasAttribute("data-spplans") && W.OSAP_TIER) W.OSAP_TIER.open();
    });
    el.addEventListener("toggle", function (e) { var d = e.target; if (d.classList && d.classList.contains("spwhy")) openRows[d.getAttribute("data-spid")] = d.open; }, true);
    render(); load();
  }
  W.OSAP_SPIKESQ = { mount: mount };
})();
