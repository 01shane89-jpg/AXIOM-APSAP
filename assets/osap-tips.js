/* AXIOM OSAP: tips, the tour and "Show me in the app" (Shane 2026-11-18: "add a user guide to osap that walks a user through
   each and every feature. And will keep reminding them of tools to use until they turn off the feature").
   - Tips: now and then a small note at the foot of the screen suggests one tool, chosen by what the user is doing: a follow-up to
     the tool just used (an area drawn: Area summary), what is on screen (Today: Story coverage), or a tool not used yet on this
     device. "Show me" points at the tool; "Next tip" shows another; "Turn off tips" (or Settings > Show tips) stops them.
     Tips keep coming, tools never used first, then the ones seen longest ago, until the user turns them off.
   - Unobtrusive by rule: never in the first 40 s of a visit, never within 6 s of a tap or key, never over an open window, plan,
     menu or tool card, never over the phone's list sheet while it is raised (the tour offer waits for it too), at least 3 minutes apart (a follow-up 90 s), 3 a visit at most, gone by itself after 25 s.
   - Tour: the first visit after this ships offers a one-minute tour of the toolbar and Settings (Settings > Take the tour runs
     it again). Each step rings one button and says what it is for; buttons not on screen (a phone's shorter toolbar) are skipped.
     Before each step the ring clears what would hide its button: the phone's list sheet drops to its bar, an open menu, info
     box or details sheet closes, Today and the guide close (Kelsea's iPhone, 19 Nov: the timeline sheet was up and the ring sat
     on a news row). A button something else still covers is treated as not on screen, so the ring never points at the wrong
     thing. Closing the tour puts the list sheet back where it was.
   - Show me in the app: the user guide's sections call walk(id), the same ring, step by step through that feature's buttons.
   Kept in localStorage "osap-tips" on this device only: off, which tips were seen and when, which tools were used, the tour.
   Nothing is sent anywhere. Nothing here reads or changes a record, a finding or a saved item: it only points at buttons and,
   when the user presses "Open it", presses the button for them.
   Automated browsers (navigator.webdriver) get no tips or tour offer by themselves, so the other headless checks open as
   before; tests set window.OSAP_TIPS_TEST first.
   window.OSAP_TIPS { on(), set(bool), show(id?), next(), tour(), walk(id), hasWalk(id), spot(steps), close(), tips(), check() } */
(function () {
  "use strict";
  var W = window, D = document;
  if (W.OSAP_TIPS) return;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-tips", AUTO = !navigator.webdriver || !!W.OSAP_TIPS_TEST;
  var FIRST = 40e3, GAP = 180e3, GAP_AFTER = 90e3, IDLE = 6e3, PER_VISIT = 3, LIFE = 25e3;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function b(t) { return "<b>" + esc(t) + "</b>"; }
  function st() { try { var v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function upd(fn) { var v = st(); fn(v); save(v); return v; }

  /* ---------- where things are ---------- */
  function vis(el) {
    if (!el || el.hidden) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  var ALT = { "Reports": "#tidy-reptool,#tidy-rep" };
  function bar() { return D.getElementById("atk-tools"); }
  function toolBtn(label) {
    var bt = bar(); if (!bt) return null;
    return bt.querySelector('.atk-list button[aria-label="' + label.replace(/"/g, '\\"') + '"]');
  }
  function todayOpen() { return !!(W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen()); }
  function todayCard(title) {
    var t = D.getElementById("today"); if (!t || t.hidden) return null;
    var hs = t.querySelectorAll("h2"), i;
    for (i = 0; i < hs.length; i++) if (hs[i].textContent.trim().indexOf(title) === 0) return hs[i].closest("section,.tdcard,[class*=card]") || hs[i];
    return null;
  }
  /* a step's target: a toolbar button (the first of several names that is on screen), the gear, a Today card or a selector */
  function find(step) {
    var el = null, i;
    if (step.tool) {
      var names = [].concat(step.tool);
      for (i = 0; i < names.length && !el; i++) {
        var x = toolBtn(names[i]); if (x) { scrollTo(x); if (shown(x)) el = x; }
        /* a tool the page shows elsewhere at this size (Reports sits in the header on a wide screen) */
        if (!el && ALT[names[i]]) el = Array.prototype.filter.call(D.querySelectorAll(ALT[names[i]]), shown)[0] || null;
      }
      /* a folded toolbar: point at its open arrow instead */
      if (!el && bar() && bar().classList.contains("folded")) { var f = bar().querySelector(".atk-fold"); if (shown(f)) { el = f; step._fold = true; } }
    } else if (step.card) { el = todayCard(step.card); if (el && !shown(el)) el = null; }
    else if (step.sel) { var y = D.querySelector(step.sel); if (shown(y)) el = y; }
    return el;
  }
  /* on screen and not under anything else: the middle of it is inside the window and the top thing there (the tips' own ring
     and callout aside) is the target itself. A button with something over it counts as not on screen. */
  var OWN = "#tipcall,#tipspot,#tipcatch,#tipcard";
  function shown(el) {
    if (!vis(el)) return false;
    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= W.innerWidth || y >= W.innerHeight) return false;
    var all = D.elementsFromPoint ? D.elementsFromPoint(x, y) : [D.elementFromPoint(x, y)], hit = null, i;
    for (i = 0; i < all.length; i++) if (all[i] && !(all[i].closest && all[i].closest(OWN))) { hit = all[i]; break; }
    return !hit || hit === el || el.contains(hit) || hit.contains(el);
  }
  /* what can hide a step's button, closed before the ring is drawn: the guide, Today (unless a step needs it), the phone's list
     sheet (down to its bar), the phone's details sheet, the gear and Reports menus, a toolbar menu and the map's info box.
     None of these holds unsaved work. Returns true when something moved, so the ring waits for the sheet to settle. */
  function clearView(keepToday) {
    var moved = false, ph = W.ASAP_PHONE;
    if (W.OSAP_GUIDE && W.OSAP_GUIDE.isOpen()) { W.OSAP_GUIDE.close(); moved = true; }
    if (!keepToday && todayOpen()) { W.OSAP_TODAY.hide(); moved = true; }
    if (ph && ph.on && ph.on()) {
      var pb = D.getElementById("pkg-back"); if (pb && !pb.hidden && ph.close) { ph.close(); moved = true; }
      if (sheetUp() && ph.setSheet) { ph.setSheet("bar"); moved = true; }
    }
    var tp = D.getElementById("tidy-pop"), tb = D.querySelector('[data-tidy][aria-expanded="true"]');
    if (tp && !tp.hidden && tb) { tb.click(); moved = true; }
    var ap = D.getElementById("atk-pop"); if (ap && !ap.hidden) { ap.hidden = true; ap._for = null; moved = true; }
    var m = W.__asapMap; if (m && m.closePopup && D.querySelector(".leaflet-popup")) { m.closePopup(); moved = true; }
    return moved;
  }
  /* the phone's list sheet raised to half or full height (it covers the map and its toolbar) */
  function sheetUp() { var de = D.documentElement; return de.classList.contains("phone") && /^(half|full)$/.test(de.getAttribute("data-sheet") || ""); }
  function scrollTo(el) {
    var l = el.closest(".atk-list"); if (!l) return;
    var r = el.getBoundingClientRect(), lr = l.getBoundingClientRect();
    if (r.top < lr.top || r.bottom > lr.bottom) l.scrollTop += (r.top - lr.top) - (lr.height - r.height) / 2;
  }

  /* ---------- the tips: what they say and where they point ---------- */
  /* ctx: "map" (map shown), "today" (Today shown) or "after" (only as a follow-up to the tool named in after); tool/card/sel
     is what "Show me" rings; guide is the guide section "More in the guide" opens. Button names exactly as the app shows them. */
  var TIPS = [
    { id: "search", ctx: "map", tool: "Search", guide: "toolbar", t: b("Search") + " finds tools and settings as well as places. Try typing " + b("hospital") + " or " + b("night") + "." },
    { id: "datasets", ctx: "map", tool: "Data sets", guide: "toolbar", t: b("Data sets") + " puts reporting topics on the map. Tick a set to show it; tap its name to open its list." },
    { id: "weather", ctx: "map", tool: "Weather", guide: "toolbar", t: b("Weather") + " has radar, wind and warnings. " + b("Open forecasts and warnings") + " gives the 5-day chart." },
    { id: "overlays", ctx: "map", tool: "Overlays", guide: "toolbar", t: b("Overlays") + " holds infrastructure, borders, aircraft and ships. " + b("Find a layer") + " narrows it to what you type." },
    { id: "basemap", ctx: "map", tool: "Base map", guide: "toolbar", t: b("Base map") + " switches to Satellite, Topographic or the Offline map." },
    { id: "view", ctx: "map", tool: "View", guide: "toolbar", t: b("View") + " turns on " + b("Grid") + " lines, the " + b("Crosshair") + ", " + b("3D") + " terrain and " + b("Full") + " screen." },
    { id: "measure", ctx: "map", tool: "Measure", guide: "measure", t: b("Measure") + " gives distance and bearing between points, and an elevation " + b("Profile") + "." },
    { id: "route", ctx: "map", tool: "Route", guide: "route", t: b("Route") + " plans a drive and lists the reports along the way." },
    { id: "area", ctx: "map", tool: "Area", guide: "area", t: b("Area") + " draws an area, NAI or TAI. " + b("Reports") + " can then summarize everything inside it." },
    { id: "draw", ctx: "map", tool: "Draw", guide: "area", t: b("Draw") + " makes planning graphics: lines, areas and range rings." },
    { id: "plans", ctx: "map", tool: "Plans", guide: "medplan", t: b("Plans") + " holds the medical plan, landing zones, drop zones, comms, terrain analysis and the weather brief." },
    { id: "medplan", ctx: "map", tool: ["Med plan", "Plans"], guide: "medplan", t: b("Med plan") + " drafts a MEDEVAC plan from any point: hospitals by capability, routes and times." },
    { id: "evac", ctx: "map", tool: ["Evac", "Plans"], guide: "evac", t: b("Evac") + " drafts an evacuation plan: assembly areas, routes and the reports along them." },
    { id: "comms", ctx: "map", tool: ["Comms", "Plans"], guide: "comms", t: b("Comms") + " plans radio and phone links: coverage, link budget, networks and a PACE board." },
    { id: "point", ctx: "map", tool: "Point", guide: "point", t: b("Point") + " saves a spot with a name, a note and photos. You can route to it later." },
    { id: "watch", ctx: "map", tool: "Watch", guide: "watch", t: b("Watch") + " tells you about new reports inside an area you choose." },
    { id: "mywork", ctx: "map", tool: "My work", guide: "mywork", t: b("My work") + " keeps your points, areas, routes and workspaces, and exports KML or a " + b("TAK package") + "." },
    { id: "reports", ctx: "map", tool: "Reports", guide: "reports", t: b("Reports") + " makes a country brief, an OSIR, a PowerPoint brief and more, ready to save as PDF." },
    { id: "rbuild", ctx: "map", tool: "Reports", guide: "reports", t: b("Reports") + ", " + b("Report builder (SITREP)") + " turns map snips and sources into a finished SITREP, with a QC check before export." },
    { id: "ring", ctx: "map", guide: "ring", t: "Long-press the map (right-click on a computer) for actions at that spot: " + b("Measure") + ", " + b("Route") + ", " + b("Watch") + ", " + b("Find LZ") + " and " + b("Terrain") + "." },
    { id: "offline", ctx: "map", sel: "#tidy-set", guide: "settings", t: "Settings, " + b("Offline maps and data") + " saves a country so OSAP keeps working with no signal." },
    { id: "guide", ctx: "map", sel: "#tidy-set", guide: "start", t: "The " + b("User guide") + " in Settings explains every tool, works offline and prints as a PDF." },
    { id: "coverage", ctx: "today", card: "Story coverage", guide: "news", t: b("Story coverage") + ": switch to " + b("Blindspots") + " to see stories only state media carried, or only outlets elsewhere." },
    { id: "spikes", ctx: "today", card: "Reporting level", guide: "news", t: b("Reporting level") + " compares today's headline count with normal. A spike is a prompt to look, not a finding." },
    { id: "keydates", ctx: "today", card: "Key dates", guide: "start", t: b("Key dates") + " lists the holidays, elections and anniversaries coming up, each with its source." },
    { id: "economy", ctx: "today", card: "Economy", guide: "start", t: b("Economy") + " flags fast moves in the currency and in food and fuel prices, each linked to its source." },
    { id: "risk", ctx: "today", card: "Risk equivalent", guide: "news", t: b("Risk equivalent") + " is OSAP's own computed rating from open indicators, kept apart from official advisories." },
    /* follow-ups: shown soon after the tool named in "after" was used */
    { id: "after-area", ctx: "after", after: "Area", tool: "Reports", guide: "area", t: "Area drawn? " + b("Reports") + ", " + b("Area summary") + " sums up everything inside it, with sources." },
    { id: "after-area-snip", ctx: "after", after: "Area", tool: "Reports", guide: "reports", t: "Or " + b("Snip to report") + ": the drawn area as a print-ready map with every item's source, into the report builder." },
    { id: "after-point", ctx: "after", after: "Point", tool: "Watch", guide: "watch", t: "Point saved. " + b("Watch") + " can tell you about new reports around it." },
    { id: "after-route", ctx: "after", after: "Route", tool: "Reports", guide: "route", t: "Route planned? " + b("Reports") + ", " + b("Route search brief") + " sums up the reports and news along it." },
    { id: "after-datasets", ctx: "after", after: "Data sets", tool: "Data sets", guide: "toolbar", t: b("Clear map") + " at the foot of " + b("Data sets") + " takes every set off the map at once." },
    { id: "after-measure", ctx: "after", after: "Measure", tool: "Measure", guide: "measure", t: b("Profile") + " in Measure draws the ground between your points, for line of sight." },
    { id: "after-medplan", ctx: "after", after: "Med plan", tool: "My work", guide: "medplan", t: "A plan can go to ATAK or WinTAK as a " + b("TAK package") + ", and prints from " + b("Reports") + "." },
    /* what is on screen now: a news search that found little */
    { id: "older", ctx: "today", sel: '#today [data-nq="older"]', guide: "news", now: true, t: "Not finding it? " + b("Search older days") + " looks further back than the last few days." }
  ];
  var BY = {}; TIPS.forEach(function (t) { BY[t.id] = t; });

  /* ---------- walkthroughs: the tour and one per guide section ---------- */
  var TOUR = [
    { tool: "Today", t: b("Today") + " is the start screen: the daily summary, weather, warnings and top stories for the country you pick." },
    { tool: "Search", t: b("Search") + " finds places, grids, tools, settings and the news." },
    { tool: "Data sets", t: b("Data sets") + " are the reporting topics. Tick one to put it on the map." },
    { tool: "Weather", t: b("Weather") + " is radar, wind, warnings and forecasts." },
    { tool: "Overlays", t: b("Overlays") + " are map layers that are not reports: infrastructure, borders, aircraft, ships." },
    { tool: ["Area", "Measure"], t: b("Measure") + ", " + b("Route") + " and " + b("Area") + " work on the map: distances, drives and areas of interest." },
    { tool: "Plans", t: b("Plans") + " holds the planning tools: medical, evacuation, landing zones, comms, terrain and weather brief." },
    { tool: ["Point", "Watch"], t: b("Point") + " saves a spot; " + b("Watch") + " tells you about new reports in an area." },
    { tool: "My work", t: b("My work") + " keeps everything you saved, and exports it." },
    { tool: "Reports", t: b("Reports") + " makes briefs and reports to print or save as PDF." },
    { sel: "#tidy-set", t: "Settings: offline maps, the " + b("User guide") + ", this tour again, and the " + b("Show tips") + " switch." },
    { t: "Long-press the map (right-click on a computer) for actions at any spot. That is the tour: tips will suggest a tool now and then until you turn them off in Settings." }
  ];
  function planStep(name) { return { tool: [name, "Plans"], t: "Open " + b("Plans") + " and pick " + b(name) + ", or use its own button where the toolbar has one." }; }
  var WALKS = {
    start: [{ tool: "Today", t: "Tap " + b("Today") + " for the start screen." }, { sel: "#country-seg,#cs", t: "Pick the country here." }, { sel: "#tidy-set", t: "The gear holds the settings and this guide." }],
    news: [{ tool: "Today", t: "Open " + b("Today") + ", then scroll to " + b("Story coverage") + ", " + b("Reporting level") + " and " + b("Top stories") + "." }],
    toolbar: TOUR.slice(0, 10),
    ring: [{ t: "Long-press anywhere on the map (right-click on a computer). A ring of actions opens at that spot." }],
    measure: [{ tool: "Measure", t: "Tap " + b("Measure") + ", then tap points on the map. " + b("Profile") + " draws the ground between them." }],
    route: [{ tool: "Route", t: "Tap " + b("Route") + ", set the start and the end, then press go." }],
    area: [{ tool: "Area", t: "Tap " + b("Area") + " and draw on the map." }, { tool: "Reports", t: "Then " + b("Reports") + " has " + b("Area summary") + " and " + b("Area report with maps") + "." }],
    point: [{ tool: "Point", t: "Tap " + b("Point") + ", then the map, to save a spot with a note and photos." }],
    watch: [{ tool: "Watch", t: "Tap " + b("Watch") + " and choose the area to watch." }],
    mywork: [{ tool: "My work", t: b("My work") + " has your saved items, workspaces and exports." }],
    team: [{ tool: "My work", t: "The team workspace is in " + b("My work") + "." }],
    cases: [{ tool: "My work", t: "Team cases are in " + b("My work") + "." }],
    medplan: [planStep("Med plan")],
    evac: [planStep("Evac")],
    comms: [planStep("Comms")],
    lz: [{ tool: "Plans", t: "Open " + b("Plans") + " and pick " + b("Landing zones (HLZ finder)") + ", or long-press the map and pick " + b("Find LZ") + "." }],
    terrain: [{ tool: "Plans", t: "Open " + b("Plans") + " and pick " + b("Terrain analysis") + ", or long-press the map and pick " + b("Terrain") + "." }],
    reports: [{ tool: "Reports", t: "Tap " + b("Reports") + " and pick a report. A grayed one says what to do first. " + b("Report builder (SITREP)") + " is there too." }],
    settings: [{ sel: "#tidy-set", t: "Tap the gear for Settings." }],
    security: [{ sel: "#tidy-set", t: "Tap the gear: " + b("Protected mode") + ", " + b("Lock my saved work") + ", " + b("Staying hidden online") + " and " + b("Erase this device") + " are there." }],
    tips: [{ sel: "#tidy-set", t: "Tap the gear: " + b("Show tips") + " turns tips on or off, and " + b("Take the tour") + " runs the tour again." }]
  };

  /* ---------- the ring and its callout ---------- */
  var SPOT = null, CALL = null, steps = [], at = 0, single = false, stepEl = null, keepToday = false, sheetBack = null, waitT = 0;
  function css() {
    if (D.getElementById("tips-css")) return;
    var s = D.createElement("style"); s.id = "tips-css";
    s.textContent =
      "#tipcard{position:fixed;z-index:9000;left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom));width:min(460px,calc(100vw - 32px));box-sizing:border-box;" +
      "background:var(--surface,#fff);color:var(--ink,#1A2129);border:1px solid var(--line,rgba(127,127,127,.35));border-left:4px solid var(--accent,#1D5A86);border-radius:8px;padding:10px 8px 8px 14px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-size:14px;line-height:1.45}" +
      "#tipcard.onmap{transform:none;bottom:auto}" +
      "#tipcard .tiphd{display:flex;align-items:flex-start;gap:6px}#tipcard .tiphd p{margin:2px 0 0;flex:1}" +
      "#tipcard .tipk{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#56626F)}" +
      "#tipcard .tipx,#tipcall .tipx{flex:none;min-width:40px;min-height:40px;margin:-6px -2px 0 0;font-size:24px;line-height:1;background:none;border:0;color:inherit;cursor:pointer;border-radius:6px}" +
      "#tipcard .tipb,#tipcall .tipb{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}" +
      "#tipcard button.refresh,#tipcall button.refresh{font-size:14px;padding:6px 12px;min-height:40px;border-radius:6px}" +
      "#tipcard .tiplinks{display:flex;flex-wrap:wrap;margin-left:auto}" +
      "#tipcard .tiplink{font:inherit;font-size:13px;background:none;border:0;color:var(--muted,#56626F);text-decoration:underline;cursor:pointer;min-height:40px;padding:0 6px;border-radius:6px}" +
      "#tipcard .tiplink:hover{color:var(--ink,#1A2129)}" +
      "#tipspot{position:fixed;z-index:100004;pointer-events:none;border-radius:10px;box-shadow:0 0 0 3px var(--accent,#1D5A86),0 0 0 9999px rgba(8,12,18,.55);transition:all .18s ease}" +
      "#tipspot.nohole{left:50%!important;top:45%!important;width:0!important;height:0!important;box-shadow:0 0 0 9999px rgba(8,12,18,.55)}" +
      "#tipcall{position:fixed;z-index:100005;width:min(340px,calc(100vw - 24px));box-sizing:border-box;background:var(--surface,#fff);color:var(--ink,#1A2129);" +
      "border-radius:10px;padding:12px 10px 10px 14px;box-shadow:0 8px 30px rgba(0,0,0,.4);font-size:15px;line-height:1.45}" +
      "#tipcall .tiphd{display:flex;align-items:flex-start;gap:6px}#tipcall .tiphd p{margin:0;flex:1}" +
      "#tipcall .tipn{font-size:12px;color:var(--muted,#56626F);margin-right:auto}" +
      "#tipcatch{position:fixed;inset:0;z-index:100003;background:transparent}" +
      "@media (pointer:coarse){#tipcard button.refresh,#tipcall button.refresh,#tipcard .tiplink{min-height:44px}#tipcard .tipx,#tipcall .tipx{min-width:44px;min-height:44px}}" +
      "@media (prefers-reduced-motion:reduce){#tipspot{transition:none}}" +
      "@media print{#tipcard,#tipspot,#tipcall,#tipcatch{display:none!important}}";
    D.head.appendChild(s);
  }
  var CATCH = null, lastFocus = null;
  function spot(list, opt) {
    close(); css(); opt = opt || {};
    steps = (list || []).slice(); single = !!opt.single; at = 0;
    if (!steps.length) return false;
    lastFocus = D.activeElement;
    /* the steps point at the map's toolbar: Today, the guide and the phone's list sheet cover it, so each step clears them
       first (draw); a walk with a Today card step keeps Today. The list sheet goes back to its height when the tour closes. */
    keepToday = steps.some(function (s) { return s.card || /#today/.test(s.sel || ""); });
    sheetBack = sheetUp() ? D.documentElement.getAttribute("data-sheet") : null;
    CATCH = D.createElement("div"); CATCH.id = "tipcatch"; CATCH.className = "leaflet-control";
    SPOT = D.createElement("div"); SPOT.id = "tipspot"; SPOT.setAttribute("aria-hidden", "true");
    CALL = D.createElement("div"); CALL.id = "tipcall"; CALL.className = "leaflet-control";
    CALL.setAttribute("role", "dialog"); CALL.setAttribute("aria-modal", "true"); CALL.setAttribute("aria-label", opt.title || "Tour");
    D.body.appendChild(CATCH); D.body.appendChild(SPOT); D.body.appendChild(CALL);
    CALL.addEventListener("click", onCall);
    D.addEventListener("keydown", onKey, true);
    W.addEventListener("resize", place);
    draw(1);
    return true;
  }
  /* clears what hides the steps, waits for the sheet to settle when something moved (its height eases over 0.2 s), then shows
     step "at" */
  function draw(dir) {
    clearTimeout(waitT);
    if (clearView(keepToday)) {
      CALL.style.visibility = "hidden"; SPOT.classList.add("nohole");
      waitT = setTimeout(function () { if (CALL) { clearView(keepToday); render(dir); } }, 260);
      return;
    }
    render(dir);
  }
  /* shows step "at"; a step with nothing on screen is skipped in the direction of travel (dir) */
  function render(dir) {
    CALL.style.visibility = "";
    while (at >= 0 && at < steps.length) {
      var s = steps[at]; s._fold = false;
      stepEl = (s.tool || s.card || s.sel) ? find(s) : null;
      if (stepEl || !(s.tool || s.card || s.sel) || single) break;
      at += dir;
    }
    if (at < 0) { at = 0; return render(1); }
    if (at >= steps.length) { close(true); return; }
    var s2 = steps[at], last = at === steps.length - 1, n = steps.length;
    var text = s2._fold ? "The toolbar is folded away. Tap the arrow here to open it, then " + s2.t.charAt(0).toLowerCase() + s2.t.slice(1) :
      (!stepEl && (s2.tool || s2.card || s2.sel)) ? s2.t + " (It is not on screen right now.)" : s2.t;
    var openable = single && stepEl && s2.tool && !s2._fold;
    CALL.innerHTML = '<div class="tiphd"><p>' + text + '</p><button type="button" class="tipx" data-tc="x" aria-label="Close">&times;</button></div>' +
      '<div class="tipb">' + (n > 1 ? '<span class="tipn">' + (at + 1) + " of " + n + "</span>" : "") +
      (at > 0 ? '<button type="button" class="refresh" data-tc="back">Back</button>' : "") +
      (openable ? '<button type="button" class="refresh' + (last ? " primary" : "") + '" data-tc="open">Open it</button>' : "") +
      (last ? (openable ? "" : '<button type="button" class="refresh primary" data-tc="x">Done</button>') : '<button type="button" class="refresh primary" data-tc="next">Next</button>') + "</div>";
    place();
    var f = CALL.querySelector(".primary") || CALL.querySelector("button"); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function place() {
    if (!CALL) return;
    var vw = W.innerWidth, vh = W.innerHeight, cw = CALL.offsetWidth, ch = CALL.offsetHeight, x, y;
    if (stepEl && vis(stepEl)) {
      var r = stepEl.getBoundingClientRect(), pad = 4;
      SPOT.classList.remove("nohole");
      SPOT.style.left = (r.left - pad) + "px"; SPOT.style.top = (r.top - pad) + "px";
      SPOT.style.width = (r.width + pad * 2) + "px"; SPOT.style.height = (r.height + pad * 2) + "px";
      /* beside the target where there is room (the toolbar is on the right: left of it), else below, else above */
      if (r.left - cw - 16 >= 8) { x = r.left - cw - 16; y = r.top + r.height / 2 - ch / 2; }
      else if (r.right + cw + 16 <= vw - 8) { x = r.right + 16; y = r.top + r.height / 2 - ch / 2; }
      else if (r.bottom + ch + 16 <= vh - 8) { x = r.left + r.width / 2 - cw / 2; y = r.bottom + 16; }
      else { x = r.left + r.width / 2 - cw / 2; y = r.top - ch - 16; }
    } else { SPOT.classList.add("nohole"); x = vw / 2 - cw / 2; y = vh / 2 - ch / 2; }
    CALL.style.left = Math.round(Math.max(8, Math.min(vw - cw - 8, x))) + "px";
    CALL.style.top = Math.round(Math.max(8, Math.min(vh - ch - 8, y))) + "px";
  }
  function onCall(e) {
    var t = e.target.closest && e.target.closest("[data-tc]"); if (!t) return;
    var k = t.getAttribute("data-tc");
    if (k === "x") close(true);
    else if (k === "next") { at++; draw(1); }
    else if (k === "back") { at--; draw(-1); }
    else if (k === "open") { var el = stepEl; close(); if (el) el.click(); }
  }
  function onKey(e) {
    if (!CALL) return;
    if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); close(true); }
    else if (e.key === "Tab") { /* keep focus on the callout while it is open */
      var bs = CALL.querySelectorAll("button"); if (!bs.length) return;
      var i = Array.prototype.indexOf.call(bs, D.activeElement);
      if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === bs.length - 1)) { e.preventDefault(); bs[e.shiftKey ? bs.length - 1 : 0].focus(); }
    }
  }
  /* back: the user ended the tour (×, Done, Esc), so the list sheet goes back up if the tour lowered it; "Open it" and a new
     tour leave it down */
  function close(back) {
    if (!CALL) return;
    clearTimeout(waitT);
    [CATCH, SPOT, CALL].forEach(function (x) { if (x) x.remove(); });
    CATCH = SPOT = CALL = stepEl = null; steps = [];
    if (back === true && sheetBack && W.ASAP_PHONE && W.ASAP_PHONE.setSheet && !sheetUp()) W.ASAP_PHONE.setSheet(sheetBack);
    sheetBack = null;
    D.removeEventListener("keydown", onKey, true); W.removeEventListener("resize", place);
    if (lastFocus && lastFocus.focus && D.contains(lastFocus)) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- the tip card ---------- */
  var CARD = null, cardTimer = 0, cardTip = null;
  function cardOff() { clearTimeout(cardTimer); if (CARD) { CARD.remove(); CARD = null; cardTip = null; } }
  function show(id, opt) {
    var tip = id ? BY[id] : pick(true); if (!tip) return false;
    cardOff(); css(); opt = opt || {};
    var now = Date.now();
    upd(function (v) { v.seen = v.seen || {}; v.seen[tip.id] = now; v.last = now; });
    shownThisVisit++; lastShown = now; cardTip = tip;
    CARD = D.createElement("div"); CARD.id = "tipcard"; CARD.className = "leaflet-control"; CARD.setAttribute("role", "status"); CARD.setAttribute("data-tip", tip.id);
    var canShow = !!(tip.tool || tip.card || tip.sel);
    CARD.innerHTML = '<div class="tiphd"><p><span class="tipk">Tip</span>' + tip.t + '</p><button type="button" class="tipx" data-tk="x" aria-label="Close this tip">&times;</button></div>' +
      '<div class="tipb">' + (canShow ? '<button type="button" class="refresh primary" data-tk="show">Show me</button>' : "") +
      '<button type="button" class="refresh' + (canShow ? "" : " primary") + '" data-tk="next">Next tip</button>' +
      '<span class="tiplinks">' + (tip.guide && W.OSAP_GUIDE ? '<button type="button" class="tiplink" data-tk="guide">More in the guide</button>' : "") +
      '<button type="button" class="tiplink" data-tk="off">Turn off tips</button></span></div>';
    CARD.addEventListener("click", onCard);
    /* the card stays while the pointer or focus is on it, and goes by itself after LIFE otherwise */
    CARD.addEventListener("pointerenter", function () { clearTimeout(cardTimer); });
    CARD.addEventListener("focusin", function () { clearTimeout(cardTimer); });
    CARD.addEventListener("pointerleave", arm);
    D.body.appendChild(CARD); placeCard();
    if (!opt.keep) arm();
    return true;
  }
  /* on the map the card sits at the foot of the map, left of the toolbar and above the grid strip, so it covers neither the
     tools nor the reports list; on Today (or with no map on screen) it sits at the foot of the screen */
  function placeCard() {
    if (!CARD) return;
    var m = W.__asapMap && W.__asapMap.getContainer && W.__asapMap.getContainer();
    if (todayOpen() || !m || !vis(m)) { CARD.classList.remove("onmap"); CARD.style.left = CARD.style.top = CARD.style.width = ""; return; }
    var r = m.getBoundingClientRect(), tb = bar(), strip = D.getElementById("atk-bar");
    var right = tb && vis(tb) ? tb.getBoundingClientRect().left - 8 : r.right - 12;
    var foot = strip && vis(strip) && strip.getBoundingClientRect().top > r.top + 100 ? strip.getBoundingClientRect().top - 10 : r.bottom - 12;
    foot = Math.min(foot, W.innerHeight - 8);
    var w = Math.min(460, right - r.left - 12);
    if (w < 240) { CARD.classList.remove("onmap"); CARD.style.left = CARD.style.top = CARD.style.width = ""; return; }
    CARD.classList.add("onmap");
    CARD.style.width = Math.round(w) + "px"; CARD.style.left = Math.round(r.left + 8) + "px";
    CARD.style.top = Math.round(Math.max(r.top + 8, foot - CARD.offsetHeight)) + "px";
  }
  W.addEventListener("resize", placeCard);
  function arm() { clearTimeout(cardTimer); cardTimer = setTimeout(cardOff, LIFE); }
  function onCard(e) {
    var t = e.target.closest && e.target.closest("[data-tk]"); if (!t) return;
    var k = t.getAttribute("data-tk"), tip = cardTip;
    if (k === "x") cardOff();
    else if (k === "off") { set(false); cardOff(); toast("Tips are off. Settings, Show tips turns them back on."); }
    else if (k === "next") { var n = pick(true, tip && tip.id); cardOff(); if (n) show(n.id, { keep: true }); }
    else if (k === "guide") { cardOff(); if (W.OSAP_GUIDE) W.OSAP_GUIDE.open(tip.guide); }
    else if (k === "show") { cardOff(); spot([{ tool: tip.tool, card: tip.card, sel: tip.sel, t: tip.t }], { single: true, title: "Tip" }); }
  }
  function toast(msg) {
    if (!todayOpen() && W.OSAP_ATAK && W.OSAP_ATAK.toast) { W.OSAP_ATAK.toast(msg); return; }
    css(); cardOff();
    CARD = D.createElement("div"); CARD.id = "tipcard"; CARD.setAttribute("role", "status"); CARD.innerHTML = '<div class="tiphd"><p>' + esc(msg) + "</p></div>";
    D.body.appendChild(CARD); clearTimeout(cardTimer); cardTimer = setTimeout(cardOff, 5000);
  }

  /* ---------- choosing a tip ---------- */
  var queued = null, queuedAt = 0;
  /* force: for "Next tip" and show(), skips nothing on the clock but still picks one that fits the screen */
  function pick(force, notId) {
    var v = st(), seen = v.seen || {}, used = v.used || {}, now = Date.now(), here = todayOpen() ? "today" : "map";
    function fits(t) {
      if (t.id === notId) return false;
      if (t.ctx === "after") return false;
      if (t.ctx !== here) return false;
      if (t.now) return !!find(t);
      if (t.card) return !!todayCard(t.card);
      return true;
    }
    /* a follow-up to a tool just used, still fresh, comes first */
    if (queued && (now - queuedAt > 180e3 || (seen[queued.id] && now - seen[queued.id] < 7 * 864e5))) queued = null;
    if (queued && here === "map" && queued.id !== notId) { var q = queued; queued = null; return q; }
    /* what is on screen right now that a tip speaks to */
    var live = TIPS.filter(function (t) { return t.now && fits(t) && !(seen[t.id] && now - seen[t.id] < 864e5); });
    if (live.length) return live[0];
    var pool = TIPS.filter(fits); if (!pool.length) return null;
    /* tools never used and tips never seen first, then the one seen longest ago */
    pool.sort(function (a, c) {
      var ua = toolUsed(a, used) ? 1 : 0, uc = toolUsed(c, used) ? 1 : 0; if (ua !== uc) return ua - uc;
      return (seen[a.id] || 0) - (seen[c.id] || 0);
    });
    return pool[0];
  }
  function toolUsed(t, used) { var n = [].concat(t.tool || [])[0]; return !!(n && used[n]); }

  /* ---------- when ---------- */
  var started = Date.now(), lastInput = Date.now(), lastShown = 0, shownThisVisit = 0;
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (k) { D.addEventListener(k, function () { lastInput = Date.now(); }, { capture: true, passive: true }); });
  /* the same list as the reviews ask, plus the first-run setup and the tips' own pieces: a tip never covers someone's work */
  var BUSY = '[id$="dlg"],.osplit,#medplan,#epe,#lz-card,#meas-card,#atk-ring,#atk-pop,#tidy-pop,#ibpv,#guidedlg,#kd-sheet,#revdlg,#rvask,#mycc-setup,#tipcall,#atk-om:not([hidden])';
  function busy() {
    if (D.visibilityState === "hidden") return true;
    /* the phone's list raised over the map: the user is reading it, and map tips would point under it */
    if (!todayOpen() && sheetUp()) return true;
    return Array.prototype.some.call(D.querySelectorAll(BUSY), function (el) { return vis(el); });
  }
  function on() { return !st().off; }
  function set(val) { upd(function (v) { v.off = !val; }); if (!val) { cardOff(); queued = null; } }
  function tick(soon) {
    if (!AUTO && !soon) return;
    if (!on() || CARD || CALL) return;
    var v = st(), now = Date.now();
    if (!soon && (now - started < FIRST || now - lastInput < IDLE)) return;
    if (busy()) return;
    /* the tour offer, once: after the first-run setup, the first time tips would show */
    if (!v.tourOffered) { offerTour(); return; }
    if (shownThisVisit >= PER_VISIT && !soon) return;
    var gap = queued ? GAP_AFTER : GAP;
    if (!soon && lastShown && now - lastShown < gap) return;
    if (!soon && v.last && now - v.last < gap && !queued) return;
    var tip = pick(false); if (tip) show(tip.id);
  }
  function offerTour() {
    upd(function (v) { v.tourOffered = Date.now(); });
    cardOff(); css(); lastShown = Date.now();
    CARD = D.createElement("div"); CARD.id = "tipcard"; CARD.className = "leaflet-control"; CARD.setAttribute("role", "status"); CARD.setAttribute("data-tip", "tour");
    CARD.innerHTML = '<div class="tiphd"><p><span class="tipk">New in OSAP</span>A one-minute tour of the toolbar, and tips that suggest a tool now and then.</p>' +
      '<button type="button" class="tipx" data-to="x" aria-label="Close">&times;</button></div>' +
      '<div class="tipb"><button type="button" class="refresh primary" data-to="go">Take the tour</button><button type="button" class="refresh" data-to="x">Not now</button>' +
      '<span class="tiplinks"><button type="button" class="tiplink" data-to="off">Turn off tips</button></span></div>';
    CARD.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-to]"); if (!t) return;
      var k = t.getAttribute("data-to"); cardOff();
      if (k === "go") tour();
      else if (k === "off") { set(false); toast("Tips are off. Settings, Show tips turns them back on."); }
    });
    CARD.addEventListener("pointerenter", function () { clearTimeout(cardTimer); });
    CARD.addEventListener("focusin", function () { clearTimeout(cardTimer); });
    D.body.appendChild(CARD); placeCard();
    clearTimeout(cardTimer); cardTimer = setTimeout(cardOff, 45e3);
  }
  function tour() { cardOff(); upd(function (v) { v.tourOffered = v.tourOffered || Date.now(); v.tour = Date.now(); }); return spot(TOUR, { title: "Tour of OSAP" }); }
  function walk(id) { var w = WALKS[id]; if (!w) return false; cardOff(); return spot(w, { title: "Show me in the app", single: w.length === 1 }); }

  /* the tools the user presses: recorded (time only, this device) so tips favor tools not used yet, and follow-ups queue */
  D.addEventListener("click", function (e) {
    var bt = e.target.closest && e.target.closest("#atk-tools .atk-list button[aria-label]"); if (!bt) return;
    var name = bt.getAttribute("aria-label");
    upd(function (v) { v.used = v.used || {}; v.used[name] = Date.now(); });
    /* the follow-up for this tool seen longest ago (Area has two: Area summary and Snip to report) */
    var seen = st().seen || {}, best = null;
    for (var i = 0; i < TIPS.length; i++) if (TIPS[i].after === name && (!best || (seen[TIPS[i].id] || 0) < (seen[best.id] || 0))) best = TIPS[i];
    if (best) { queued = best; queuedAt = Date.now(); }
  }, true);
  setInterval(tick, 5000);

  W.OSAP_TIPS = {
    on: on, set: set, tour: tour, walk: walk, close: function () { close(); cardOff(); },
    hasWalk: function (id) { return !!WALKS[id]; },
    show: function (id) { return show(id, { keep: true }); },
    next: function () { var t = pick(true, cardTip && cardTip.id); return t ? show(t.id, { keep: true }) : false; },
    spot: function (list) { return spot(list, { single: list && list.length === 1 }); },
    tips: function () { return TIPS.map(function (t) { return { id: t.id, ctx: t.ctx, after: t.after || "", tool: [].concat(t.tool || []), card: t.card || "", sel: t.sel || "", guide: t.guide || "", text: t.t.replace(/<[^>]+>/g, "") }; }); },
    walks: function () { return Object.keys(WALKS); },
    tourSteps: function () { return TOUR.length; },
    /* tests: run the check now, without the waits at the start of a visit and after the last tap */
    check: function () { tick(true); }
  };
})();
