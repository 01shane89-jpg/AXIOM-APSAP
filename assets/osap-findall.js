/* AXIOM OSAP: one search box that finds everything (Search on the map toolbar, assets/osap-search.js, and Search the news
   on Today). Besides places and news, what is typed finds:
   - countries, by name or code ("Estonia", "ee", "est"): picking one opens it, as the country list does;
   - tools: every button on the map toolbar (read from the toolbar itself, so a new tool shows up here by itself), the Area
     menu's tools (window.OSAP_AREA_TOOLS: landing zones, satellite before/after, area report) and Photo check. Picking one
     presses its own button, so a tool the plan does not include opens Plan and sign-in as the button does;
   - data sets (window.OSAP_DATASETS and the conflict tabs): picking one puts it on the map, or opens the plans when locked;
   - settings (the gear's items, each listed only when the app has it): map colours, grid format, units, my location,
     offline maps, sync, the user guide, language, plan and sign-in, credits.
   Common words find their tool or setting too ("hospital" finds Med plan, "night" finds Dark map). Nothing here is sent
   anywhere: matching runs on this device.
   Keyboard: "/" or Ctrl/Cmd+K opens the search box (on Today, it goes to the news box, which lists the same matches above
   the news).
   window.OSAP_FINDALL = { match(q, max) -> [{ grp, name, sub, score, strong, need }], pick(item), news(q) } */
(function () {
  "use strict";
  var W = window, D = document;
  if (W.OSAP_FINDALL || /[?&](watchscan|wopen)=/.test(location.search)) return;
  function q(s) { return D.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fold(s) { s = String(s == null ? "" : s); try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {} return s.toLowerCase().replace(/[–—_/-]+/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim(); }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function tier(kind, id) { var T = W.OSAP_TIER; return T && T.on && T.on() && T.needs ? T.needs(kind, id) : ""; }
  function planName(n) { return n ? n.charAt(0).toUpperCase() + n.slice(1) : ""; }

  /* common words for a tool, data set or setting, by its id (toolbar data-atk, data set id, setting key); phrases split by commas */
  var SYN = {
    medplan: "hospital,hospitals,medical,medic,casualty,casevac,medevac,clinic,trauma,ambulance,health care",
    evac: "evacuation,evacuate,neo,extraction,exit,embassy,airport,escape,leave the country",
    route: "directions,navigate,navigation,road,drive,driving,path",
    measure: "distance,bearing,ruler,range,length,how far",
    area: "draw,polygon,lasso,circle,shape,nai,tai,aoi,summarise,summarize",
    lines: "mgrs,grid lines,utm,grid squares", cross: "crosshair,centre,center,reticle",
    "3d": "terrain,tilt,elevation,three d", comms: "radio,communications,pace,signal,phone coverage,mast,tower,network",
    "rep-osir": "osir,open source intelligence report,intel report", "rep-intelbrief": "powerpoint,pptx,slides,deck,intel brief,briefing",
    "rep-sitrep": "sitrep,situation report", "rep-brief": "country brief,country profile", "rep-report": "pmesii,threat assessment,country report",
    hosp: "hospital,trauma level,trauma centre,trauma center,hospital assessment,er,emergency room", sea: "ship,boat,voyage,maritime,at sea,sea transit,vessel,medevac at sea",
    flight: "airborne,jump,drop,aircraft,flight plan,airdrop,parachute,c-130,fly", dzso: "drop zone,dz,dzso,parachute,airborne,jump",
    survey: "site survey,hlz,dz,airfield,landing strip,survey", terrain: "viewshed,line of sight,los,terrain analysis,elevation profile,dead ground,observation",
    wxbrief: "weather brief,forecast brief,weather report", compass: "bearing,heading,north,azimuth,direction", photo: "photo,picture,image,geolocate",
        lz: "landing zone,helicopter,hlz,lz,lz finder,find lz", satba: "satellite imagery,before and after,change detection,sentinel",
    areareport: "area report,print area", watch: "alert me,notify,monitor,geofence,notification",
    point: "pin,marker,waypoint,drop a point,mark", overlays: "layers,map layers,flooding,roads,aircraft",
    basemap: "background,satellite,streets,topographic,topo,imagery", weather: "rain,radar,wind,forecast,storm,cyclone",
    datasets: "topics,data,reporting", mine: "my work,saved,what's new", layout: "split,list", full: "fullscreen,full screen",
    today: "home,start,dashboard", photocheck: "photo,video,image,picture,verify,geolocate,exif,chronolocate,shadow,sun,reverse image",
    reports: "brief,report,print,pdf", analyst: "entities,links",
    /* data sets */
    health: "disease,outbreak,medical,epidemic", crime: "drugs,trafficking,smuggling", hazards: "earthquake,quake,volcano,tsunami",
    flood: "flooding,floods", alerts: "warnings", security: "attack,threat,terrorism", partners: "exercise,military",
    news: "news,headlines,media", social: "twitter,telegram,facebook", infra: "infrastructure,power",
    transport: "transport,roads,rail,ports", crisis: "disaster,relief", scam: "fraud", aml: "money laundering,finance",
    cf: "conflict,war,fighting,clashes,insurgency,battle",
    /* settings */
    dark: "night,dark mode,black,theme,colours,colors", light: "day,light mode,theme,colours,colors", grey: "gray,theme,colours,colors",
    mgrs: "coordinates,grid format,mgrs,military grid,position format", dd: "coordinates,lat long,latitude,longitude,decimal degrees,grid format",
    dms: "coordinates,degrees minutes seconds,grid format",
    km: "kilometres,kilometers,metric,units", mi: "miles,imperial,units", nm: "nautical miles,knots,units",
    loc: "gps,my location,position,where am i", off: "offline,download,no signal,save maps,cache", move: "transfer,export,import,another device,new phone",
    sync: "sync,devices,backup", ai: "ai model,on device ai", guide: "help,manual,how to,instructions,guide,docs",
    lock: "hidden areas,face id", plan: "plan,sign in,sign out,login,log in,log out,account,subscription,upgrade,pay,billing,password",
    users: "users,accounts", reviews: "reviews,review,rate,rating,feedback,stars", credits: "credits,sources,attribution", lang: "language,translate,translation"
  };
  function syn(id) { return SYN[id] ? SYN[id].split(",") : []; }

  /* ---------- the index, built from what the page has now ---------- */
  function countries() {
    var CS = W.OSAP_COUNTRIES || [], cur = (W.TSAP && W.TSAP.country) || "", out = [];
    CS.forEach(function (c) {
      var b = q('#country-seg button[data-cc="' + c.id + '"]'); if (!b) return;
      out.push({ k: "country", grp: "Countries", id: c.id, name: c.name, sub: (c.id === cur ? "Open now · " : "") + (c.region || "Country"),
        codes: [c.id, c.a3 || ""], words: [], el: b });
    });
    Array.prototype.forEach.call(D.querySelectorAll("#country-seg button[data-st]"), function (b) {
      var st = b.getAttribute("data-st"); if (!st) return;
      out.push({ k: "country", grp: "Countries", id: "us-" + st, name: b.textContent.trim(), sub: "U.S. state", codes: [], words: [], el: b });
    });
    return out;
  }
  function tools() {
    var out = [], bar = q("#atk-tools .atk-list");
    if (bar) Array.prototype.forEach.call(bar.children, function (b) {
      if (b.tagName !== "BUTTON" || b.hidden) return;
      var id = b.getAttribute("data-atk") || (b.hasAttribute("data-o3d") ? "3d" : b.getAttribute("data-ogrid")) || (b.id === "tidy-reptool" ? "reports" : b.hasAttribute("data-an-btn") ? "analyst" : "");
      if (id === "search") return;
      var name = (b.getAttribute("aria-label") || (b.querySelector(".atk-l") || b).textContent || "").trim(); if (!name) return;
      out.push({ k: "tool", grp: "Tools", id: id, name: name, sub: b.title || "", words: syn(id), el: b, need: b.getAttribute("data-tier-need") || (id ? tier("tool", id) : "") });
    });
    /* the Area menu's tools: picked through the Area button, so a shape is asked for first when one is needed */
    var ab = bar && bar.querySelector('[data-atk="area"]');
    if (ab && !ab.hidden) (W.OSAP_AREA_TOOLS || []).forEach(function (t) {
      if (!t || !t.id || !t.label || t.id === "med") return;
      out.push({ k: "area", grp: "Tools", id: t.id, name: t.id === "lz" ? "LZ finder (landing zones)" : t.label, sub: "Area menu", words: syn(t.id), el: ab, need: ab.getAttribute("data-tier-need") || tier("tool", "area") });
    });
    /* the toolbar's Plans and View drop-downs (2026-11-01): Flight plan, Hospital assessment, Sea transit, Terrain analysis,
       Compass and the rest, each found by name; a tool already listed above (Med plan, the Area menu's LZ) is not repeated */
    var have = {}; out.forEach(function (x) { if (x.id) have[x.id] = 1; });
    if (W.OSAP_ATAK && W.OSAP_ATAK.menuTools) W.OSAP_ATAK.menuTools().forEach(function (t) {
      if (have[t.id] || (t.id === "grid" && have.lines)) return; have[t.id] = 1;
      out.push({ k: "fn", grp: "Tools", id: t.id, name: t.name, sub: t.menu + " menu", words: syn(t.id), run: t.run, weak: true });
    });
    /* every report OSAP makes (the Reports menu, assets/osap-reports.js), found by name: OSIR, the intelligence brief and the rest */
    var names = {}; out.forEach(function (x) { names[String(x.name).toLowerCase()] = 1; });
    if (W.OSAP_REPORTS && W.OSAP_REPORTS.list) W.OSAP_REPORTS.list().forEach(function (r) {
      if (names[String(r.name).toLowerCase()]) return;
      out.push({ k: "fn", grp: "Tools", id: "rep-" + r.id, name: r.name, sub: "Report" + (r.ready ? "" : " · " + r.hint), words: ["report"].concat(syn("rep-" + r.id)), run: function () { W.OSAP_REPORTS.run(r.id); }, weak: true });
    });
    if (W.OSAP_PHOTOCHECK && W.OSAP_PHOTOCHECK.open) out.push({ k: "fn", grp: "Tools", id: "photocheck", name: "Photo check", sub: "Where and when a photo or video was taken, on this device", words: syn("photocheck"), run: function () { W.OSAP_PHOTOCHECK.open(); } });
    return out;
  }
  function sets() {
    var out = [], DS = W.OSAP_DATASETS, skip = { timeline: 1, route: 1, comms: 1, opendata: 1 };
    Array.prototype.forEach.call(D.querySelectorAll('#view-seg button[data-view^="cf-"]'), function (b) {
      if (b.hidden) return; var id = b.getAttribute("data-view");
      out.push({ k: "view", grp: "Data sets", id: id, name: b.textContent.replace(/\s+/g, " ").replace(/\s\d+( new)?$/, "").trim(), sub: "Conflict", words: syn("cf"), el: b, need: tier("set", id) });
    });
    if (DS && DS.list) DS.list().forEach(function (x) {
      if (skip[x.id]) return;
      out.push({ k: "set", grp: "Data sets", id: x.id, name: x.name, sub: x.on ? "On the map" : "Data set", words: syn(x.id), need: tier("set", x.id) });
    });
    return out;
  }
  function settings() {
    var out = [], A = W.OSAP_ATAK, M = W.OSAP_MEASURE, LOC = W.OSAP_LOC, T = W.OSAP_TIER;
    function add(id, name, sub, run, on) { out.push({ k: "fn", grp: "Settings", id: id, name: name, sub: sub + (on ? " · on now" : ""), words: syn(id), run: run }); }
    /* the same choices, and the same calls, as the gear's Settings panel (assets/osap-tidy.js) */
    if (q("#theme-seg")) [["light", "Light map"], ["grey", "Grey map"], ["dark", "Dark map"]].forEach(function (t) {
      add(t[0], t[1], "Map colours", function () { var b = q('#theme-seg [data-theme-set="' + t[0] + '"]'); if (b) b.click(); toast(t[1] + " on"); }, D.documentElement.getAttribute("data-map") === t[0]);
    });
    if (A && A.posFmt) [["mgrs", "MGRS"], ["dd", "Lat-long"], ["dms", "DMS"]].forEach(function (f) {
      add(f[0], "Grid format: " + f[1], "Coordinates shown as " + f[1], function () {
        A.posFmt(f[0]); if (M && M.prefs) M.prefs({ fmt: f[0] === "dd" ? "dec" : f[0] }); toast("Grids now shown as " + f[1]);
      }, A.posFmt() === f[0]);
    });
    if (M && M.prefs) [["km", "km"], ["mi", "miles"], ["nm", "nautical miles"]].forEach(function (u) {
      add(u[0], "Distance in " + u[1], "Distance units", function () { M.prefs({ unit: u[0] }); toast("Distances now in " + u[1]); }, M.prefs().unit === u[0]);
    });
    if (LOC) add("loc", LOC.on() ? "Stop using my location" : "Use my location", "Kept on this device only", function () { if (LOC.on()) { LOC.off(); toast("Location off"); } else LOC.use(); });
    if (W.OSAP_OFFLINE) add("off", "Offline maps and data", "Save maps and data for use with no signal", function () { W.OSAP_OFFLINE.open(); });
    if (W.OSAP_MOVE) add("move", "Move to another device", "A passphrase-locked file, no account", function () { W.OSAP_MOVE.open(); });
    if (W.OSAP_SYNC) add("sync", "Sync my devices", "Keep saved work the same on your devices", function () { W.OSAP_SYNC.open(); });
    if (W.OSAP_AI) add("ai", "On-device AI", "The model AI summaries use", function () { W.OSAP_AI.open(); });
    if (W.OSAP_GUIDE) add("guide", "User guide", "How to use OSAP, offline and printable", function () { W.OSAP_GUIDE.open(); });
    if (W.OSAP_LOCK) add("lock", "Hidden areas", "Settings", function () { W.OSAP_LOCK.open(); });
    if (T && T.on && T.on()) add("plan", "Plan and sign-in", "Your plan, sign in or out", function () { T.open(); });
    if (W.OSAP_REVIEWS && W.OSAP_REVIEWS.on()) add("reviews", "Reviews", "Read reviews of OSAP, or leave one", function () { W.OSAP_REVIEWS.open(); });
    if (T && T.owner && T.owner()) add("users", "Users", "Accounts that use OSAP", function () { T.users(); });
    if (W.OSAP_I18N) {
      add("lang", "Language", "Menus and buttons", function () {
        var g = q("#tidy-set"); if (g && g.getAttribute("aria-expanded") !== "true") g.click();
        setTimeout(function () { var s = q("#osap-lang-sel"); if (s) s.focus(); }, 60);
      });
      var cur = W.OSAP_I18N.lang();
      W.OSAP_I18N.langs().forEach(function (l) {
        if (l.code === cur) return;
        out.push({ k: "fn", grp: "Settings", id: "lang-" + l.code, name: "Language: " + l.english + (l.name !== l.english ? " (" + l.name + ")" : ""), sub: "Menus and buttons", words: [l.name, l.english, l.code], langOnly: true,
          run: function () { W.OSAP_I18N.set(l.code); } });
      });
    }
    if (q("#credits-btn")) add("credits", "Credits and data sources", "Where the data comes from", function () { q("#credits-btn").click(); });
    return out;
  }

  /* ---------- matching ---------- */
  function phraseScore(p, qq, base) {
    if (!p) return 0;
    if (p === qq) return base;
    if (p.indexOf(qq) === 0) return base - 10;
    if (qq.length < 3) return 0;   /* two letters match only the start of a name, or a code */
    var ws = p.split(" "), qs = qq.split(" ");
    if (qs.length === 1) { for (var i = 1; i < ws.length; i++) if (ws[i].indexOf(qq) === 0) return base - 20; return 0; }
    return qs.every(function (t) { return ws.some(function (w) { return w.indexOf(t) === 0; }); }) ? base - 25 : 0;
  }
  function score(it, qq) {
    var s = phraseScore(fold(it.name), qq, 100);
    if (it.codes && it.codes.some(function (c) { return c && c === qq; })) s = Math.max(s, 96);
    /* two letters match a common word only in full ("lz", "km", "3d") */
    (it.words || []).forEach(function (w) { w = fold(w); s = Math.max(s, qq.length < 3 ? (w === qq ? 75 : 0) : phraseScore(w, qq, it.langOnly ? 90 : 75)); });
    /* the words of a long description: a weak match, only for three letters or more */
    if (s === 0 && qq.length >= 3 && it.sub && it.k !== "country" && !it.langOnly) s = phraseScore(fold(it.sub), qq, 40) ? 22 : 0;
    /* a drop-down item or a report ranks under a toolbar button or setting that an everyday word points to ("hospital" finds
       Med plan first, "night" Dark map), unless its whole name is typed */
    if (it.weak && s < 100) s = Math.min(s, 70);
    return s;
  }
  var KIND = { Countries: 0, Tools: 1, "Data sets": 2, Settings: 3 }, CAP = { Countries: 4, Tools: 5, "Data sets": 4, Settings: 4 };
  function match(text, max) {
    var qq = fold(text); if (qq.length < 2) return [];
    var all = [].concat(countries(), tools(), sets(), settings()), got = [];
    all.forEach(function (it, i) { var s = score(it, qq); if (s > 0) { it.score = s; it.strong = s >= 55; it.n = i; got.push(it); } });
    /* ties keep the order the app lists them in (toolbar order, the gear's order) */
    got.sort(function (a, b) { return b.score - a.score || KIND[a.grp] - KIND[b.grp] || a.n - b.n; });
    /* a few of each kind, the kinds in the order of their best match */
    var n = {}, out = [], order = [];
    got.forEach(function (it) { n[it.grp] = (n[it.grp] || 0) + 1; if (n[it.grp] <= CAP[it.grp]) { out.push(it); if (order.indexOf(it.grp) < 0) order.push(it.grp); } });
    out.sort(function (a, b) { return order.indexOf(a.grp) - order.indexOf(b.grp) || b.score - a.score || a.n - b.n; });
    out = out.slice(0, max || 10);
    out.forEach(function (it) {
      it.fa = true; it.q = text;
      if (it.need) it.sub = "Needs the " + planName(it.need) + " plan" + (it.sub ? " · " + it.sub : "");
    });
    return out;
  }

  /* ---------- picking one ---------- */
  function mapFirst() { if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen()) W.OSAP_TODAY.hide(); }
  function press(b) {
    var bar = q("#atk-tools");
    if (bar && bar.classList.contains("folded")) { var f = bar.querySelector('[data-atk="fold"]'); if (f) f.click(); }
    try { b.scrollIntoView({ block: "nearest" }); } catch (e) {}
    b.click();   /* the plan's lock (osap-tier.js) listens for this click and opens Plan and sign-in instead */
  }
  function pick(it) {
    if (!it) return;
    if (it.k === "country") {
      var cur = (W.TSAP && W.TSAP.country) || "";
      if (it.id === cur && !/[?&]st=/.test(location.search)) { toast(it.name + " is open now"); return; }
      it.el.click(); return;
    }
    if (it.k === "news") { news(it.q); return; }
    if (it.k === "set" || it.k === "view") {
      if (it.need && W.OSAP_TIER) { W.OSAP_TIER.open(); return; }
      mapFirst();
      if (it.k === "view") { it.el.click(); return; }
      if (W.OSAP_DATASETS) { W.OSAP_DATASETS.set(it.id, true); toast(it.name + " is on the map"); }
      return;
    }
    if (it.k === "tool" || it.k === "area") {
      mapFirst();
      if (it.id === "today") { if (W.OSAP_TODAY) W.OSAP_TODAY.show(); return; }
      press(it.el);
      if (it.k === "area") { var pop = q("#atk-pop"), o = pop && !pop.hidden && pop.querySelector('[data-pk="' + it.id + '"]'); if (o) o.click(); }
      return;
    }
    if (it.run) { if (it.grp === "Tools") mapFirst(); it.run(); }
  }
  /* the same words in Search the news on Today */
  function news(text) {
    if (!W.OSAP_TODAY) return;
    W.OSAP_TODAY.show();
    var n = 0;
    (function put() {
      var i = q("#nq-q"), f = i && i.form;
      if (!f) { if (++n < 20) setTimeout(put, 100); return; }
      i.value = text;
      if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event("submit", { cancelable: true }));
      try { i.scrollIntoView({ block: "nearest" }); } catch (e) {}
    })();
  }
  function newsItem(text) {
    return W.OSAP_TODAY && W.OSAP_NEWSQ ? { fa: true, k: "news", grp: "News", q: text, name: 'Search the news for "' + text + '"', sub: "Headlines held in OSAP, on Today", score: 0 } : null;
  }

  /* ---------- Today: the news box lists the same matches above the news ---------- */
  var hintFor = "";
  function hints(inp) {
    var f = inp.form, box = f && f.parentNode.querySelector(".fa-hints");
    if (!f) return;
    if (!box) { box = D.createElement("div"); box.className = "fa-hints"; box.setAttribute("aria-label", "Go to"); f.insertAdjacentElement("afterend", box); }
    var text = inp.value.trim(); if (text === hintFor) return; hintFor = text;
    var m = match(text, 4).filter(function (x) { return x.strong; });
    box._m = m;
    box.innerHTML = m.length ? '<span class="fa-hl">Go to</span>' + m.map(function (it, i) {
      return '<button type="button" data-fa="' + i + '" title="' + esc(it.sub) + '"><b>' + esc(it.name) + "</b><span>" + esc(it.grp === "Countries" ? "Country" : it.grp === "Data sets" ? "Data set" : it.grp.replace(/s$/, "")) + (it.need ? " · locked" : "") + "</span></button>";
    }).join("") : "";
    box.hidden = !m.length;
  }
  D.addEventListener("input", function (e) { if (e.target && e.target.id === "nq-q") hints(e.target); });
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".fa-hints [data-fa]"); if (!b) return;
    var m = b.parentNode._m || [], it = m[+b.getAttribute("data-fa")]; if (it) pick(it);
  });

  /* ---------- keyboard: "/" or Ctrl/Cmd+K ---------- */
  function typing(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  D.addEventListener("keydown", function (e) {
    var k = e.key, cmdK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === "k" || k === "K");
    var slash = k === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target);
    if (!cmdK && !slash) return;
    var wall = q("#tierdlg"); if (wall && !wall.hidden) return;
    e.preventDefault();
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen()) { var n = q("#nq-q"); if (n) { n.focus(); n.select(); return; } }
    var S = W.OSAP_SEARCH;
    if (S && S.isOpen()) { var i = q("#srch-q"); if (i) { i.focus(); i.select(); } }
    else if (W.OSAP_ATAK && W.OSAP_ATAK.search) W.OSAP_ATAK.search();
  });

  var css = D.createElement("style");
  css.textContent =
    ".fa-hints{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 0 0}.fa-hints[hidden]{display:none}.fa-hl{font-size:12px;color:var(--muted)}" +
    ".fa-hints button{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-height:44px;max-width:100%;padding:4px 12px;font:inherit;font-size:13px;line-height:1.2;text-align:left;cursor:pointer;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}" +
    ".fa-hints button b{font-weight:600;overflow:hidden;text-overflow:ellipsis;max-width:100%}.fa-hints button span{font-size:11.5px;color:var(--muted)}";
  D.head.appendChild(css);

  W.OSAP_FINDALL = { match: match, pick: pick, news: news, newsItem: newsItem };
})();
