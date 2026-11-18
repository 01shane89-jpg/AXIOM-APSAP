/* AXIOM OSAP · Asia security shortcuts on Today (Shane 2026-11-18: "use this data to drive our posting topics and product
   development"; the Instagram data's other top family after satellite checks was Asia security: Thailand–Cambodia, jets
   scrambled). On an Asian country's Today screen, one card with three shortcuts, the country's own concern first:
   - Jets scrambled and ADIZ: the news pool's "air-intercepts" data set (tools/topics.json), opened in Today's news search
     across every country;
   - Thailand–Cambodia border: the conflict tab (reports, sensor check, Check it from space);
   - South China Sea: the "south-china-sea" data set, opened the same way.
   Each shortcut shows how much reporting there is now, from files Today already reads: the data sets' last-24-hour headline
   counts and level from data/live/spikes.js (tools/news_spikes.mjs) and the conflict's report counts from
   data/live/conflicts/index.js. A count is how many headlines matched, not how many events happened. Read-only.
   API: window.OSAP_ASIASECQ { mount(el, cc, name), countries: list of page ids it shows on, order(cc) } */
(function () {
  "use strict";
  var W = window, D = document, el = null, CC = "", NAME = "", state = 0;
  // East, Southeast and South Asia pages, and Okinawa
  var ASIA = ["jp", "oki", "kr", "kp", "cn", "tw", "mn", "ph", "vn", "la", "kh", "th", "mm", "my", "sg", "bn", "id", "tl", "in", "bd", "lk", "np", "bt", "mv", "pk"];
  var CF = "thailand-cambodia";
  var ITEMS = {
    air: { kind: "set", id: "air-intercepts", name: "Jets scrambled and ADIZ", sub: "Fighters scrambled, air defense identification zone entries and intercepts", where: "every country" },
    border: { kind: "cf", id: CF, name: "Thailand–Cambodia border", sub: "Clashes, landmines, ceasefire and border talks, with the sensor check on each strike report" },
    scs: { kind: "set", id: "south-china-sea", name: "South China Sea", sub: "Coast guard encounters, shoals, reefs and patrols", where: "every country" }
  };
  // the country's own concern first
  function order(cc) {
    if (cc === "th" || cc === "kh") return ["border", "scs", "air"];
    if (["ph", "vn", "my", "bn", "id", "sg"].indexOf(cc) >= 0) return ["scs", "air", "border"];
    return ["air", "scs", "border"];
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function plural(n, one, many) { return Number(n).toLocaleString("en-US") + " " + (n === 1 ? one : many || one + "s"); }
  var LV = { spike: ["Spike", "At least twice its normal level and well outside its usual day-to-day range."], above: ["Above normal", "At least 1.5 times its normal level and well outside its usual day-to-day range."] };

  function countHtml(key) {
    var it = ITEMS[key];
    if (it.kind === "set") {
      var S = W.OSAP_SPIKES, p = S && S.datasets && S.datasets[it.id];
      if (!p) return state < 2 ? "" : '<span class="asn">Count not built yet</span>';
      var lv = LV[p.lvl];
      return '<span class="asn"><b>' + plural(p.n, "headline") + "</b> in 24 h, worldwide</span>" + (lv ? ' <span class="aslv" title="' + esc(lv[1]) + '">' + esc(lv[0]) + "</span>" : "");
    }
    var c = ((W.OSAP_CONFLICTS && W.OSAP_CONFLICTS.conflicts) || []).filter(function (x) { return x.id === it.id; })[0];
    if (!c) { waitIndex(); return ""; }
    return '<span class="asn"><b>' + plural(c.reports1 || 0, "report") + "</b> in 24 h, " + plural(c.reports7 || 0, "report") + " in 7 days</span>";
  }
  /* the conflicts index (data/live/conflicts/index.js) is read by assets/osap-conflicts.js at start and can land after Today
     first draws: draw again once it is in (a few tries, then the tile stays without counts) */
  var waits = 0, waitT = 0;
  function waitIndex() {
    if (waitT || waits > 20) return;
    waitT = setTimeout(function () { waitT = 0; waits++; render(); }, 500);
  }
  function render() {
    if (!el) return;
    var h = '<div class="ashead"><h2>Asia security</h2><span class="assub">One tap to the reporting</span></div><div class="asgrid">';
    order(CC).forEach(function (k) {
      var it = ITEMS[k];
      h += '<button type="button" class="astile" data-as="' + k + '"><span class="ast">' + esc(it.name) + '</span><span class="ass">' + esc(it.sub) + "</span>" + countHtml(k) +
        '<span class="asgo">' + (it.kind === "cf" ? "Open the conflict tab" : "Show the headlines") + "</span></button>";
    });
    h += '</div><p class="asfoot">Counts are headlines or reports matched in OSAP\'s news pool, not events, and every line in them is a source\'s claim, not a verified report.</p>';
    el.innerHTML = h; el.hidden = false;
  }
  function go(k) {
    var it = ITEMS[k]; if (!it) return;
    if (it.kind === "cf") {
      var T = W.OSAP_CONFLICT_TABS; if (!T) return;
      if (W.OSAP_TODAY && W.OSAP_TODAY.hide) W.OSAP_TODAY.hide();
      T.open(it.id, CC === "kh" ? "kh" : "th");
      return;
    }
    var N = W.OSAP_NEWSQ; if (!N || !N.pick) return;
    N.pick(it.id, "all");
    var box = D.getElementById("td-news"); if (box && box.scrollIntoView) box.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function load() {
    if (state) return; state = 1;
    if (W.OSAP_SPIKES) { state = 2; render(); return; }
    var s = D.createElement("script");
    s.src = "data/live/spikes.js?t=" + Math.floor(Date.now() / 6e5); s.async = true;
    s.onload = s.onerror = function () { s.remove(); state = 2; render(); };
    D.head.appendChild(s);
  }
  var CSS = ".tdasia .ashead{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.tdasia h2{margin:0}.tdasia .assub{font-size:12px;color:var(--muted)}" +
    ".asgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:8px;margin-top:8px}" +
    ".astile{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;font:inherit;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-left:4px solid var(--accent,#1D5A86);" +
    "border-radius:8px;background:var(--surface);color:var(--ink);cursor:pointer;min-width:0}.astile:hover{border-color:var(--accent,#1D5A86)}" +
    ".ast{font-weight:700;font-size:14.5px}.ass{font-size:12px;color:var(--muted);line-height:1.35}.asn{font-size:12.5px}" +
    ".aslv{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;border-radius:3px;padding:0 5px;color:#7c2d12;background:#fde7d6;border:1px solid #f3b58b}" +
    ".asgo{font-size:12.5px;font-weight:600;color:var(--accent,#1f5f99);margin-top:2px}.asgo::after{content:' \\203A'}" +
    ".asfoot{font-size:12px;color:var(--muted);margin:8px 0 0}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .aslv{color:#fed7aa;background:#4a2412;border-color:#9a3412}}:root[data-theme=dark] .aslv{color:#fed7aa;background:#4a2412;border-color:#9a3412}";
  function mount(box, cc, name) {
    if (!box) return;
    if (ASIA.indexOf(cc) < 0) { box.hidden = true; return; }
    el = box; CC = cc; NAME = name || cc; el.classList.add("tdasia");
    if (!D.getElementById("as-css")) { var st = D.createElement("style"); st.id = "as-css"; st.textContent = CSS; D.head.appendChild(st); }
    el.addEventListener("click", function (e) { var t = e.target.closest && e.target.closest("[data-as]"); if (t) go(t.getAttribute("data-as")); });
    render(); load();
  }
  W.OSAP_ASIASECQ = { mount: mount, countries: ASIA.slice(), order: order };
})();
