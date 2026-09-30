/* AXIOM OSAP · Country sides: the user marks countries friend, assumed friend, neutral, unknown, suspect or hostile, and the map
   tints them in the DeepState style (one flat fill and a crisp edge per country), with a key in the map legend.
   - This is the user's own judgement, never OSAP's: nothing is marked until the user marks it, the choice is kept in this browser
     only (localStorage "osap-sides"), is never sent anywhere, and is not part of any data set, record, report or share link.
   - Colours are the MIL-STD-2525 / APP-6 identity colours: blue friend, green neutral, yellow unknown, red hostile. Assumed friend
     and suspect use the friend and hostile colours with a dashed edge and a lighter fill, as 2525 dashes their frames.
   - Military sites on the conflict tabs (assets/osap-cf-sites.js) take the frame of the side marked for the country they are in,
     through OSAP_SIDES.symKey; the framed symbols are built by tools/build_symbols.mjs.
   - The controls sit in Layers (Overlays with the tactical toolbar), section "Country sides", first after the base maps. Outlines come from the page's
     Natural Earth files; the United States, Russia, Fiji and Kiribati, which those files clip to the Asia-Pacific, are drawn
     whole from data/basemap/sides-full.js (tools/build_sides_outlines.mjs), loaded only when one of them is marked.
   API: window.OSAP_SIDES { list, get(cc), set(cc, side|null), shown(), symKey(key, cc), name(side) }; event "osap:sides" on document. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-sides";
  // id, name, edge colour, fill colour, dashed edge, fill opacity, 2525 fill colour (for the buttons)
  var SIDES = [
    ["f", "Friend", "#1558B0", "#2F7FE0", false, 0.30, "#80e0ff"],
    ["a", "Assumed friend", "#1558B0", "#2F7FE0", true, 0.14, "#80e0ff"],
    ["n", "Neutral", "#1E7B34", "#3DA35A", false, 0.26, "#aaffaa"],
    ["u", "Unknown", "#A07800", "#F2C200", false, 0.26, "#ffff80"],
    ["s", "Suspect", "#A31515", "#D7372E", true, 0.14, "#ff8080"],
    ["h", "Hostile", "#A31515", "#D7372E", false, 0.36, "#ff8080"]
  ];
  var BY = {}; SIDES.forEach(function (s) { BY[s[0]] = s; });
  var FULL = { "United States of America": 1, "Russia": 1, "Fiji": 1, "Kiribati": 1 };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- the store ---------- */
  var st = { m: {}, show: true };
  try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && v.m) { Object.keys(v.m).forEach(function (k) { if (BY[v.m[k]] && /^[a-z]{2,3}$/.test(k)) st.m[k] = v.m[k]; }); st.show = v.show !== false; } } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, m: st.m, show: st.show })); } catch (e) {} }

  /* countries that can be marked: one per outline (Okinawa shares Japan's), sorted by name */
  var OUT = {};
  [W.COUNTRY_BASE, W.WORLD_BASE].forEach(function (fc) { ((fc || {}).features || []).forEach(function (f) { if (!OUT[f.properties.n]) OUT[f.properties.n] = f; }); });
  var LIST = [], NE = {}, CBY = {};
  (W.OSAP_COUNTRIES || []).forEach(function (c) {
    if (!c.ne || !OUT[c.ne] || NE[c.ne]) return;
    NE[c.ne] = c.id; CBY[c.id] = c; LIST.push(c);
  });
  LIST.sort(function (a, b) { return a.name.localeCompare(b.name); });
  function here() { var h = (location.hash || "").replace("#", "").split("/"); var cc = h.length > 1 ? h[0] : "th"; return CBY[cc] ? cc : (cc === "oki" ? "jp" : "th"); }

  function changed() {
    save(); draw(); legend(); paint();
    try { D.dispatchEvent(new CustomEvent("osap:sides")); } catch (e) {}
  }
  W.OSAP_SIDES = {
    list: SIDES.map(function (s) { return { id: s[0], name: s[1], color: s[3] }; }),
    get: function (cc) { return st.m[cc] || null; },
    set: function (cc, s) { if (!CBY[cc]) return; if (BY[s]) st.m[cc] = s; else delete st.m[cc]; changed(); },
    shown: function () { return st.show; },
    name: function (s) { return BY[s] ? BY[s][1] : ""; },
    /* a symbol key in the frame of the side marked for country cc; the unknown frame (the base key) when nothing is marked */
    symKey: function (k, cc) {
      var s = st.show && cc && st.m[String(cc).toLowerCase()];
      return s && s !== "u" && W.OSAP_SYM && W.OSAP_SYM.d[k + "_" + s] ? k + "_" + s : k;
    }
  };

  /* ---------- the map ---------- */
  var map = W.__asapMap, lyr = null, fullWait = false;
  if (map && W.L) { map.createPane("sidespane"); map.getPane("sidespane").style.zIndex = 255; map.getPane("sidespane").style.pointerEvents = "none"; }
  function loadFull() {
    if (W.OSAP_SIDES_FULL || fullWait) return; fullWait = true;
    var s = D.createElement("script"); s.src = "data/basemap/sides-full.js"; s.async = true;
    s.onload = function () { draw(); }; s.onerror = function () { fullWait = false; };
    D.head.appendChild(s);
  }
  function feature(c) {
    if (FULL[c.ne]) {
      var fu = W.OSAP_SIDES_FULL && W.OSAP_SIDES_FULL.features.filter(function (f) { return f.properties.n === c.ne; })[0];
      if (fu) return fu; loadFull();
    }
    return OUT[c.ne];
  }
  function draw() {
    if (!map || !W.L) return;
    if (lyr) { map.removeLayer(lyr); lyr = null; }
    if (!st.show) return;
    var fs = [];
    Object.keys(st.m).forEach(function (cc) {
      var c = CBY[cc], f = c && feature(c); if (!f) return;
      fs.push({ type: "Feature", properties: { s: st.m[cc] }, geometry: f.geometry });
    });
    if (!fs.length) return;
    lyr = W.L.geoJSON({ type: "FeatureCollection", features: fs }, { pane: "sidespane", interactive: false, style: function (f) {
      var s = BY[f.properties.s];
      return { color: s[2], weight: 1.6, opacity: 0.95, dashArray: s[4] ? "6 4" : null, lineJoin: "round", fillColor: s[3], fillOpacity: s[5] };
    } }).addTo(map);
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    var by = {};
    Object.keys(st.m).forEach(function (cc) { if (CBY[cc]) (by[st.m[cc]] = by[st.m[cc]] || []).push(CBY[cc].name); });
    var rows = SIDES.filter(function (s) { return by[s[0]]; });
    if (!st.show || !rows.length) { W.OSAP_LEGEND.set("sides", ""); return; }
    W.OSAP_LEGEND.set("sides", "<h3>Country sides</h3>" + rows.map(function (s) {
      var n = by[s[0]].sort(), txt = n.slice(0, 4).join(", ") + (n.length > 4 ? " and " + (n.length - 4) + " more" : "");
      return '<div class="lg"><span class="sw" style="background:' + s[3] + ";opacity:1;box-shadow:inset 0 0 0 20px rgba(255,255,255," + (1 - s[5] - 0.15).toFixed(2) + ");border:2px " +
        (s[4] ? "dashed " : "solid ") + s[2] + '"></span><div>' + esc(s[1]) + '<span class="d">' + esc(txt) + "</span></div></div>";
    }).join("") + '<div class="lg"><div><span class="d">Marked by you on this device. Your judgement, not a finding.</span></div></div>');
  }

  /* ---------- the controls, in Layers ---------- */
  var box = null;
  function segHtml(cur) {
    return SIDES.map(function (s) {
      return '<button type="button" data-side="' + s[0] + '" aria-pressed="' + (cur === s[0]) + '" title="' + esc(s[1]) + '"><span class="sdot" style="background:' + s[6] +
        ";border-color:" + s[2] + (s[4] ? ";border-style:dashed" : "") + '"></span>' + esc(s[1]) + "</button>";
    }).join("") + '<button type="button" data-side="" aria-pressed="' + !cur + '" title="Not marked">None</button>';
  }
  function paint() {
    if (!box) return;
    var sel = box.querySelector("#sd-cc"), cc = sel.value, cur = st.m[cc] || "";
    box.querySelector("#sd-show").setAttribute("aria-pressed", String(st.show));
    box.querySelector("#sd-show").textContent = st.show ? "On" : "Off";
    Array.prototype.forEach.call(box.querySelectorAll("#sd-seg [data-side]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-side") === cur)); });
    var ks = Object.keys(st.m).filter(function (k) { return CBY[k]; }).sort(function (a, b) { return CBY[a].name.localeCompare(CBY[b].name); });
    box.querySelector("#sd-list").innerHTML = ks.length ? ks.map(function (k) {
      var s = BY[st.m[k]];
      return '<li><button type="button" class="sd-pick" data-cc="' + k + '" title="Change this country"><span class="sdot" style="background:' + s[6] + ";border-color:" + s[2] +
        (s[4] ? ";border-style:dashed" : "") + '"></span>' + esc(CBY[k].name) + ' <i>' + esc(s[1].toLowerCase()) + '</i></button><button type="button" class="sd-x" data-cc="' + k +
        '" aria-label="Unmark ' + esc(CBY[k].name) + '">&times;</button></li>';
    }).join("") : '<li class="sd-none">No country marked yet.</li>';
    box.querySelector("#sd-clear").hidden = !ks.length;
  }
  function build() {
    var ex = D.getElementById("ml-extra"); if (!ex) return false;
    if (D.getElementById("ml-sides")) return true;
    box = D.createElement("div"); box.id = "ml-sides";
    var cc0 = here();
    box.innerHTML = '<div class="mlh">Country sides <button type="button" id="sd-show" class="sd-on" aria-pressed="true" title="Show the sides you marked on the map">On</button></div>' +
      '<p class="mlkey">Mark countries friend, neutral, hostile or another side; the map tints them like DeepState. Your own judgement, kept on this device only.</p>' +
      '<label class="sd-l" for="sd-cc">Country</label><select id="sd-cc">' + LIST.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === cc0 ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select>" +
      '<div id="sd-seg" role="group" aria-label="Side for this country">' + segHtml(st.m[cc0] || "") + "</div>" +
      '<ul id="sd-list"></ul><button type="button" id="sd-clear" class="sd-clear">Unmark all</button>';
    /* first of the overlays, right under the base map list (which the tactical toolbar hides, having its own button) */
    var bm = ex.parentNode.querySelector(".mlbase");
    ex.parentNode.insertBefore(box, bm ? bm.nextSibling : ex);
    box.addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      var sel = box.querySelector("#sd-cc");
      if (t.id === "sd-show") { st.show = !st.show; changed(); }
      else if (t.hasAttribute("data-side")) W.OSAP_SIDES.set(sel.value, t.getAttribute("data-side") || null);
      else if (t.classList.contains("sd-pick")) { sel.value = t.getAttribute("data-cc"); paint(); sel.focus(); }
      else if (t.classList.contains("sd-x")) W.OSAP_SIDES.set(t.getAttribute("data-cc"), null);
      else if (t.id === "sd-clear") { if (confirm("Unmark every country?")) { st.m = {}; changed(); } }
    });
    box.querySelector("#sd-cc").addEventListener("change", paint);
    paint();
    return true;
  }
  if (!build()) { var tries = 0, t = setInterval(function () { if (build() || ++tries > 40) clearInterval(t); }, 250); }
  W.addEventListener("hashchange", function () { var s = box && box.querySelector("#sd-cc"); if (s) { s.value = here(); paint(); } });
  var css = D.createElement("style");
  css.textContent = "#ml-sides{border-bottom:1px solid var(--line);padding-bottom:8px}" +
    "#ml-sides .sd-on{float:right;font:inherit;font-size:11px;letter-spacing:0;text-transform:none;min-height:24px;padding:0 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--muted);cursor:pointer}" +
    "#ml-sides .sd-on[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}" +
    "#ml-sides .sd-l{display:block;font-size:11.5px;color:var(--muted);margin:6px 0 2px}" +
    "#ml-sides select{width:100%;font:inherit;min-height:34px;padding:2px 6px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}" +
    "#sd-seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:6px 0}" +
    "#sd-seg button{display:flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;min-height:32px;padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);cursor:pointer;text-align:left}" +
    "#sd-seg button[aria-pressed=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink);font-weight:700}" +
    "#ml-sides .sdot{flex:none;display:inline-block;width:12px;height:12px;border:2px solid;border-radius:2px;box-sizing:border-box}" +
    "#sd-list{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px}" +
    "#sd-list li{display:flex;align-items:center;border:1px solid var(--line);border-radius:14px;overflow:hidden}" +
    "#sd-list button{font:inherit;font-size:12px;border:0;background:none;color:var(--ink);cursor:pointer;min-height:28px;padding:0 4px 0 8px;display:flex;align-items:center;gap:5px}" +
    "#sd-list i{font-style:normal;color:var(--muted)}#sd-list .sd-x{padding:0 8px;font-size:15px;color:var(--muted)}#sd-list .sd-none{border:0;color:var(--muted);font-size:11.5px}" +
    "#ml-sides .sd-clear{margin-top:6px;font:inherit;font-size:11.5px;background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer}";
  D.head.appendChild(css);
  draw(); legend();
})();
