/* AXIOM OSAP: About this outlet (Shane 2026-11-14: "identifies why a media platform is reporting the way it is. Ie monetary
   purposes, political leaning etc", then "Facts on who owns and pays"). Self-contained block loaded before assets/osap-coverage.js.
   Reads data/outlet-facts.js (window.OSAP_OUTLETFACTS, tools/refresh_outlet_facts.mjs): for each outlet's web address, who owns it,
   its parent company, how it is paid for, where it is based and, only where its record states one, its political ideology.
   All from Wikidata (CC0), each fact linked to the record it came from; OSAP's own list wins for state media and public broadcasters.
   It is what the outlet IS, never a rating of its reporting. Fetched once, the first time a list of outlets is shown.
   window.OSAP_OUTLETFACTSQ: load(done), of(link) -> facts or null, html(link) -> an "About this outlet" <details>, or "". */
(function () {
  "use strict";
  var D = document, W = window, st = 0, wait = [];
  var FUND = {
    state: ["Government or party", "Owned or run by a government or ruling party: its reporting is that government's line."],
    public: ["Public money", "Paid for by a licence fee or public grant, under a public-service charter."],
    nonprofit: ["Non-profit", "Paid for by donations, grants or memberships."],
    business: ["Business", "Earns from advertising, subscriptions or sales, for its owners."],
    unknown: ["Not recorded", "Its record does not say how it is paid for."]
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function host(u) { try { return new URL(String(u)).hostname.toLowerCase().replace(/^(www\d?|m|amp|mobile)\./, ""); } catch (e) { return ""; } }
  function data() { var v = W.OSAP_OUTLETFACTS; return v && v.hosts ? v : null; }
  function load(done) {
    if (done) wait.push(done);
    if (st === 2) { flush(); return; }
    if (st === 1) return;
    st = 1;
    var s = D.createElement("script");
    s.src = "data/outlet-facts.js?t=" + Math.floor(Date.now() / 864e5);
    s.async = true;
    s.onload = s.onerror = function () { s.remove(); st = 2; flush(); };
    D.head.appendChild(s);
  }
  function flush() { var l = wait.splice(0); l.forEach(function (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }); } }); }
  /** facts for a report link: its host, then the host without its first label (edition.cnn.com -> cnn.com) */
  function of(link) {
    var d = data(), h = host(link); if (!d || !h) return null;
    var H = d.hosts;
    while (h && h.indexOf(".") > 0) { if (H[h]) return H[h]; h = h.slice(h.indexOf(".") + 1); if (h.indexOf(".") < 0) break; }
    return null;
  }
  var CSS = ".ofx{display:block;margin:3px 0 2px;font-size:12px}.ofx>summary{cursor:pointer;display:inline-flex;gap:6px;align-items:center;min-height:26px;color:var(--accent,#1f5f99)}" +
    ".ofx .ofk{display:inline-block;font:700 10.5px/1.6 inherit;text-transform:uppercase;letter-spacing:.03em;border-radius:3px;padding:0 6px;border:1px solid var(--line,#ccc);color:var(--ink,#111);background:var(--surface2,#eee)}" +
    ".ofx .ofk-state{color:#7c2d12;background:#fde7d6;border-color:#f3b58b}.ofx .ofk-public{color:#1e3a8a;background:#dbeafe;border-color:#93c5fd}" +
    ".ofx dl{margin:4px 0 2px 10px;padding-left:8px;border-left:2px solid var(--line,#ccc);display:grid;grid-template-columns:max-content 1fr;gap:2px 10px}" +
    ".ofx dt{color:var(--muted,#555)}.ofx dd{margin:0;overflow-wrap:anywhere}.ofx .ofn{color:var(--muted,#555);margin:3px 0 0 10px}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .ofx .ofk-state{color:#fed7aa;background:#4a2412;border-color:#9a3412}:root:not([data-theme=light]) .ofx .ofk-public{color:#bfdbfe;background:#1e3a5f;border-color:#3b82f6}}" +
    ":root[data-theme=dark] .ofx .ofk-state{color:#fed7aa;background:#4a2412;border-color:#9a3412}:root[data-theme=dark] .ofx .ofk-public{color:#bfdbfe;background:#1e3a5f;border-color:#3b82f6}";
  function css() { if (!D.getElementById("ofx-css")) { var s = D.createElement("style"); s.id = "ofx-css"; s.textContent = CSS; D.head.appendChild(s); } }
  function q(x) { return '<a href="https://www.wikidata.org/wiki/' + encodeURIComponent(x[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(x[0]) + "</a>"; }
  function cName(id) {
    var n = ""; (W.ASAP_WORLD || []).some(function (w) { if (w && w.id === id) { n = w.name; return true; } return false; });
    return n || String(id || "").toUpperCase();
  }
  /** the About this outlet block for a report link, or "" when the outlet has no record */
  function html(link) {
    var f = of(link); if (!f) return "";
    css();
    var k = FUND[f.fund && f.fund.kind] || FUND.unknown, kind = (f.fund && f.fund.kind) || "unknown";
    var rows = [];
    rows.push(["Paid for by", esc(k[1]) + (f.fund && f.fund.why ? ' <span class="ofn" style="margin:0">(' + esc(f.fund.why) + ")</span>" : "")]);
    if (f.own && f.own.length) rows.push(["Owned by", f.own.map(q).join(", ")]);
    if (f.par && f.par.length) rows.push(["Part of", f.par.map(q).join(", ")]);
    if (f.cc) rows.push(["Based in", esc(cName(f.cc))]);
    if (f.isa && f.isa.length) rows.push(["Recorded as", f.isa.map(q).join(", ")]);
    if (f.lean && f.lean.length) rows.push(["Described as", f.lean.map(q).join(", ") + ' <span class="ofn" style="margin:0">(its record\'s stated ideology, not OSAP\'s rating)</span>']);
    if (f.yr) rows.push(["Founded", esc(f.yr)]);
    return '<details class="ofx"><summary>About this outlet <span class="ofk ofk-' + esc(kind) + '">' + esc(k[0]) + "</span></summary><dl>" +
      rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>" +
      '<p class="ofn">From <a href="https://www.wikidata.org/wiki/' + encodeURIComponent(f.q) + '" target="_blank" rel="noopener noreferrer">its Wikidata record</a> (' + esc(f.n) + "), which anyone can check and correct. Who owns and pays for an outlet can shape what it covers; it does not make a report true or false.</p></details>";
  }
  W.OSAP_OUTLETFACTSQ = { load: load, of: of, html: html, FUND: FUND };
})();
