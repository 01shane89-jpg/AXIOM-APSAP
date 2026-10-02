/* AXIOM OSAP: the Reports menu lists every report OSAP makes (Shane 2026-10-01: "Under the reports tab I want all types of
   reports that OSAP makes").
   The Reports button in the header (a map tool on a phone, assets/osap-tidy.js) opens this list. Each report still lives where it
   did before; this file only finds it and opens it the same way its own button does. A report that needs something first (a
   drawn area, an open event, a conflict tab, a route) is listed greyed with what to do; where one tap gets there (Draw area,
   Route), the entry does that.
   Nothing here builds a report, changes a record or decides what a report says. */
(function () {
  "use strict";
  var W = window, D = document;
  function q(s) { return D.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* the first matching element that is on screen */
  function shown(sel) {
    var l = D.querySelectorAll(sel);
    for (var i = 0; i < l.length; i++) if (l[i].getClientRects().length && !l[i].closest("[hidden]")) return l[i];
    return null;
  }
  function press(el) { if (typeof el === "string") el = q(el); if (el) { el.click(); return true; } return false; }
  function areaOn() { var A = W.TSAP && W.TSAP.areaApi; return !!(A && A.area && A.area() && A.area().length >= 3); }
  function view() { return D.documentElement.getAttribute("data-view") || ""; }
  function drawArea() { if (!press('#atk-tools [data-atk="area"]')) press('[data-area="open"]'); }
  function openRoute() { if (view() !== "route" && !press('#atk-tools [data-atk="route"]')) press('#view-seg button[data-view="route"]'); }

  /* each report: [id, group, name, what it is, ready() -> true or what to do first, open(), optional step that gets there] */
  var LIST = [
    ["brief", "Country", "Country brief", "One page to print or save as PDF",
      function () { return !!q("#brief-btn") || "Not available for this view"; }, function () { press("#brief-btn"); }],
    ["report", "Country", "Country report", "PMESII summary and threat assessment (AI draft)",
      function () { return !!q("#report-btn") || "Not available for this view"; }, function () { press("#report-btn"); }],
    ["daily", "Country", "Daily summary", "Key events of the last 24 hours with every source, in Today",
      function () { return !!(W.OSAP_TODAY && W.OSAP_DAILYQ) || "Not available for this view"; },
      function () { W.OSAP_TODAY.show(); setTimeout(function () { var d = D.getElementById("td-daily"); if (d && d.scrollIntoView) d.scrollIntoView({ block: "start" }); }, 120); }],
    ["wxbrief", "Country", "Weather brief", "One page: impacts, forecast and light for the country or the drawn area",
      function () { return !!(W.OSAP_WX && W.OSAP_WX.brief) || "Weather is still loading"; }, function () { W.OSAP_WX.brief(); }],
    ["wxreport", "Country", "Detailed weather report", "Hour by hour, 16 days, model agreement, sea, air and light",
      function () { return !!(W.OSAP_WX && W.OSAP_WX.report) || "Weather is still loading"; }, function () { W.OSAP_WX.report(); }],

    ["timeline", "On screen now", "Timeline report", "Chronology, key events, map and sources for the period and topic shown",
      function () { return !!(W.OSAP_TLREPORT && W.OSAP_TLREPORT.eligible()) || "Needs at least 3 dated reports in the period; widen the period"; },
      function () { W.OSAP_TLREPORT.open(); }],
    ["topic", "On screen now", "Summary of this tab", "Short summary of the open tab's reports, with sources",
      function () { return !!shown('[data-vr="sum"],[data-vrcf]') || "Open a data set or conflict tab first"; },
      function () { press(shown('[data-vr="sum"],[data-vrcf]')); }],
    ["cflist", "On screen now", "Report list (print)", "Every report on the open conflict tab, such as the Deep South IED list",
      function () { return !!shown("[data-cfprint]") || "Open a conflict tab such as Deep South"; }, function () { press(shown("[data-cfprint]")); }],
    ["event", "On screen now", "Event report", "One event's reports in order, with map and sources",
      function () { return !!shown("[data-ev-tlr]") || "Open an event on the map first"; }, function () { press(shown("[data-ev-tlr]")); }],
    ["share", "On screen now", "Report to share (PDF)", "The open story or event with its map and links, for Signal and the like",
      function () { return !!shown(".pkghead .osh") || "Open a report or an event first"; }, function () { press(shown(".pkghead .osh")); }],

    ["areasum", "Drawn area", "Area summary", "Everything inside the drawn area, summarised with sources",
      function () { return (areaOn() && !!q('[data-area="sum"]')) || "Draw an area first"; }, function () { press('[data-area="sum"]'); }, drawArea],
    /* no drawn area needed: the plan opens on the drawn area when there is one, else on the map centre (Pick on map moves it) */
    ["medplan", "Point on the map", "Medical plan", "Draft MEDEVAC plan from a point of injury: hospitals by capability, routes, contacts, golden hour, evacuation",
      function () { return !!W.OSAP_MEDPLAN || "Not available"; }, function () { W.OSAP_MEDPLAN.open(areaOn() ? undefined : { centre: true }); }],

    ["route", "Route", "Route plan (print)", "Legs, timings, light, weather and hazards along a planned route",
      function () { return !!shown('[data-rt="print"]') || "Plan a route first"; }, function () { press(shown('[data-rt="print"]')); }, openRoute],
    ["routesearch", "Route", "Route search brief", "Reports and news along the route, summarised with sources",
      function () { return !!shown('[data-rt="search"]') || "Plan a route first"; }, function () { press(shown('[data-rt="search"]')); }, openRoute],

    ["sitrep", "My work", "Situation report", "The open tab or all reports in the period, to print or save as PDF",
      function () { return !!(W.OSAP_WORK && W.OSAP_WORK.open) || "Not available for this view"; }, function () { W.OSAP_WORK.open("export"); }]
  ];
  function find(id) { return LIST.filter(function (r) { return r[0] === id; })[0]; }
  function ready(r) { try { return r[4](); } catch (e) { return "Not available right now"; } }

  /* the menu body: entries in groups; data-tp="@rep:<id>" is run by run() (the menu's own click handler hands it over) */
  function menuHtml() {
    var groups = [], by = {};
    LIST.forEach(function (r) { if (!by[r[1]]) { by[r[1]] = []; groups.push(r[1]); } by[r[1]].push(r); });
    return groups.map(function (g) {
      return '<div class="tprg"><div class="tplbl">' + esc(g) + "</div>" + by[g].map(function (r) {
        var ok = ready(r);
        if (ok === true) return '<button type="button" role="menuitem" data-tp="@rep:' + r[0] + '" title="' + esc(r[3]) + '"><b>' + esc(r[2]) + "</b><span>" + esc(r[3]) + "</span></button>";
        if (r[6]) return '<button type="button" role="menuitem" class="tpoff" data-tp="@rep:' + r[0] + '" title="' + esc(r[3]) + '"><b>' + esc(r[2]) + "</b><span>" + esc(ok) + "</span></button>";
        return '<div class="tpoff" role="menuitem" aria-disabled="true" title="' + esc(r[3]) + '"><b>' + esc(r[2]) + "</b><span>" + esc(ok) + "</span></div>";
      }).join("") + "</div>";
    }).join("");
  }
  function run(id) {
    var r = find(id); if (!r) return false;
    if (ready(r) === true) { r[5](); return true; }
    if (r[6]) r[6]();
    return false;
  }
  W.OSAP_REPORTS = { menuHtml: menuHtml, run: run, list: function () { return LIST.map(function (r) { var ok = ready(r); return { id: r[0], group: r[1], name: r[2], ready: ok === true, hint: ok === true ? "" : ok }; }); } };
})();
