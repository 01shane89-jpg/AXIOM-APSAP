/* AXIOM OSAP: the user guide (Shane 2026-10-04: "We need a user guide").
   - Opened from Settings (the gear) > "User guide". One full-screen page: contents, a find box, then short sections written
     for a phone, top to bottom in the order an analyst meets the app. Each section names the buttons exactly as the app
     labels them, so the guide must change with the app: a renamed button means a line here changes too.
   - Works offline: the text is in this file (cached with the app) and the pictures are assets/guide/<name>.jpg, which the
     service worker keeps after install. A picture that is not there yet is left out, never shown broken.
   - "Print or save PDF" prints the same content with every section open and the app hidden, so the paper copy and the
     screen copy never drift apart.
   - The pictures are taken by tools/guide_shots.mjs on a phone-sized screen, run where the live map services can be reached.
   Nothing here reads or changes a record, a setting or a saved item.
   window.OSAP_GUIDE { open(sectionId?), close(), isOpen(), sections() } */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var IMG = "assets/guide/";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* b("Med plan") marks a button name the way the app shows it */
  function b(t) { return '<b class="gb">' + esc(t) + "</b>"; }
  function ul(items) { return "<ul>" + items.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>"; }
  function fig(name, cap) { return '<figure class="gfig"><img src="' + IMG + name + '.jpg" alt="' + esc(cap) + '" loading="lazy" decoding="async"><figcaption>' + esc(cap) + "</figcaption></figure>"; }
  function tip(t) { return '<p class="gtip">' + t + "</p>"; }

  /* ---------- the guide ---------- */
  var S = [
    { id: "start", t: "Getting started", h:
      "<p>OSAP shows public reporting, weather and reference data for one country at a time, on a map and in lists. It works on a phone, a tablet or a computer, and keeps working with no signal once you have saved what you need.</p>" +
      fig("today", "Today: the start screen") +
      "<h3>Pick a country</h3>" +
      ul(["Use the country list at the top. Countries are grouped by region.",
        "A red or orange dot beside a country means high or raised recent activity. It is an automatic count from worldwide feeds, not a threat rating.",
        "To see two countries on one map, pick " + b("+ Add a country to this map…") + " at the end of the list."]) +
      "<h3>Set the period</h3>" +
      ul(["The period decides which reports you see: " + b("24 h") + ", " + b("7 d") + ", " + b("30 d") + ", " + b("90 d") + ", " + b("All") + " or " + b("Custom") + ".",
        "On a phone it is the small chip beside the gear. It always names the period in force.",
        "When reports are hidden by the period, the list says how many and offers " + b("Show all") + "."]) +
      "<h3>Today</h3>" +
      ul(["Today opens each time you start the app. It shows the weather, warnings and alerts, top stories, a daily summary and what is new since your last visit.",
        "Search the news from the box at the top. Use quotes to keep a phrase together and a minus sign to leave a word out.",
        "Tap " + b("Open map") + " to go to the map. To start on the map every time, pick " + b("Map") + " at the foot of Today.",
        "The OSAP logo at the top left brings you back to Today."]) +
      "<h3>Install it like an app</h3>" +
      ul(["iPhone or iPad: in Safari tap Share, then " + b("Add to Home Screen") + ".",
        "Android or a computer: use the browser's Install or Add to Home screen option.",
        "Installed, OSAP opens full screen, can send watch alerts, and the browser is less likely to clear your saved maps."]) },

    { id: "map", t: "The map screen", h:
      fig("map", "The map with the toolbar down the right") +
      ul(["The " + b("toolbar") + " runs down the right of the map. The arrow at its top folds it away; tap again to bring it back. On a phone, scroll the toolbar when a down arrow shows more tools below.",
        "The strip along the bottom shows the grid of the map centre. Tap the grid to switch between MGRS, decimal degrees and DMS, or tap the copy icon to copy it.",
        "When " + b("Use my location") + " is on, the strip also shows your own position. The target button locks the map on you until you move the map.",
        "The reports list sits under the map on a phone. Tap or drag it up to read it. On a computer, " + b("Layout") + " chooses Map only, Map and list, or List.",
        "On a computer you can size and move the side panels (Details, Reports and windows such as the medical plan). Drag the small grip on a panel's edge to make it wider or narrower; double-click it for the normal width. Click the grip to " + b("Dock on the left") + ", " + b("Dock on the right") + ", " + b("Float over the map") + " or " + b("Reset size and place") + ". A floating panel moves by the bar on its top and gets taller or shorter by its bottom edge. Your choice is kept on this device.",
        "The title at the top names what you are looking at. Tap it to open " + b("Data sets") + " and change it.",
        "The " + b("Data") + " badge says how fresh the data is: green is fresh, amber means a feed is late, red means data has stopped. Tap it for details and " + b("Refresh now") + "."]) },

    { id: "toolbar", t: "The toolbar", h:
      "<p>Top to bottom, the toolbar holds:</p>" +
      ul([b("Today") + ": back to the start screen.",
        b("Search") + ": find a place, or type an MGRS, UTM or lat/long grid. Grids work with no signal. Tap a result for " + b("Save as point") + ", " + b("Route to here") + " or " + b("Copy grid") + ".",
        b("Data sets") + ": the reporting topics, such as conflict, crime, natural disasters, public safety and news. Tick a set to show it on the map; tap its name to open its list. " + b("Clear map") + " takes everything off.",
        b("Weather") + ": radar, satellite rain, cloud, wind, temperature, air quality, cyclones and warnings. " + b("Model time") + " looks ahead up to 72 hours. " + b("Open forecasts and warnings") + " opens the full weather view, with the one-page brief, the detailed report and the " + b("5-day chart") + " (a military-style chart: night and day halves, winds, crosswind on a runway you pick, density and pressure altitude, sun, moon, illumination and mission impacts hour by hour).",
        b("Overlays") + ": map layers that are not reports: infrastructure (communications, power plants of every fuel, the grid, data centres, airfields, ports, dams, submarine cables, railways, bridges and tunnels, water and sewage works, telephone exchanges, government sites, prisons, border crossings, police and fire stations, refineries and pipelines, roads), embassies and evacuation points, elevation and terrain analysis, key terrain, aircraft and ships, borders, and your own marks.",
        b("Base map") + ": Grey, Streets, Topographic, Satellite, Hybrid, Sentinel-2 cloudless, Daily satellite and Offline map. Streets are labelled in English.",
        b("Grid") + " and " + b("Crosshair") + ": MGRS grid lines that get finer as you zoom in, and a cross on the map centre with its grid.",
        b("3D") + ": tilt and turn the map over real ground. Tap the compass for north-up and flat, " + b("2D") + " to go back.",
        b("Measure") + ", " + b("Route") + ", " + b("Area") + ", " + b("Med plan") + ", " + b("Evac") + ", " + b("Comms") + ", " + b("Point") + " and " + b("Watch") + ": each has its own section below.",
        b("My work") + ": what is new since your last visit, and your saved work.",
        b("Reports") + " (phone) or the " + b("Reports") + " button in the header: every printable report OSAP makes.",
        b("Full") + ": full-screen map. Press Esc on a keyboard to leave."]) +
      fig("datasets", "Data sets: tick to show on the map") +
      fig("weather", "Weather layers") +
      fig("overlays", "Map overlays") +
      fig("grid", "Grid and crosshair") },

    { id: "ring", t: "Long-press the map", h:
      fig("ring", "The ring of actions at a point") +
      ul(["Press and hold anywhere on the map (right-click with a mouse) for a ring of actions at that point.",
        b("Measure") + " and " + b("Route") + " start from the point. " + b("Point") + " drops a mark there.",
        b("NAI/TAI") + " and " + b("Watch") + " draw a circle of the chosen " + b("Radius") + " and open the save form or the watch form. They replace any area already drawn.",
        b("Plans") + " offers " + b("Med plan from here") + " and " + b("Evacuate from here") + ".",
        b("Find LZ") + " searches for landing zones round the point. " + b("Terrain") + " opens viewshed, line of sight, elevation and radio coverage.",
        b("Copy") + " copies the grid. Tap the grid chip to copy it too."]) +
      tip("The ring does not open while the Measure card is open or while you are drawing an area.") },

    { id: "measure", t: "Measure", h:
      fig("measure", "Measuring a line on a phone") +
      ul(["Tap " + b("Measure") + ", then tap the map to add numbered points. Drag a point to move it.",
        "Each leg shows its distance and true bearing. Tap point 1 again (with 3 or more points) to close the shape and get its area.",
        "On a phone the card is a bar at the bottom: tap the unit to change it, " + b("↶") + " to undo, " + b("▴") + " for the full card, " + b("×") + " to close.",
        "The full card lists every leg (true, magnetic and back bearing), every point's grid, and units km, mi, nm or mils.",
        b("Plan route") + " sends the points to Route. " + b("Profile") + " shows the ground between the points (see Terrain analysis)."]) },

    { id: "route", t: "Route and Drive", h:
      ul(["Tap " + b("Route") + ". Add waypoints by typing a place or grid and pressing " + b("Add") + ", by tapping the map, or with " + b("My location") + ". Up to 25 waypoints.",
        b("Travel by") + ": Drive, Truck, Walk, Cycle or Straight line. Straight line asks for a speed: on foot, vehicle off-road, boat, helicopter, aircraft or your own.",
        "Set " + b("Depart (Zulu)") + " and a stop time at each waypoint to get arrival times.",
        "The result gives distance, time, arrival and up to 3 alternatives, then elevation, light, weather along the route, hazards near the route and turn-by-turn directions.",
        b("Search this route") + " finds reports within 1 to 25 km of the route. " + b("Comms along route") + " checks phone coverage along it.",
        b("Preview route") + " steps through pictures along the route: street pictures where they exist, otherwise satellite, terrain and map. Filter to critical points, hazards, bridges or support.",
        b("▶ Drive the route from here") + " plays the preview like a drive, at 1× to 8× speed.",
        "Save as GPX, KML or GeoJSON, print it, copy a link or name it and press " + b("Save") + ". Routes stay on this device."]) +
      tip("Route is a planning aid, not navigation. If road routing does not answer, OSAP shows straight lines and says so.") +
      fig("route", "Route") },

    { id: "area", t: "Area, NAI and TAI", h:
      fig("area", "The Area menu") +
      ul(["Tap " + b("Area") + " and pick a shape: " + b("Lasso") + " (hold and draw round the area), " + b("Polygon") + " (tap each corner, then " + b("Finish") + "), " + b("Circle") + " or " + b("Square") + " (press and drag).",
        "A drawn area filters the map and the list to what is inside it.",
        b("Edit shape") + " lets you drag corners, turn and move it, and change its colours.",
        b("Summarise area") + " writes a summary of the reports inside, with numbered sources. It can also write an AI summary on this device.",
        b("Landing zones") + " searches inside the area (see LZ finder).",
        b("Save (NAI/TAI)") + " keeps the area with a type, a name and notes. Saved areas appear under Overlays, where you can use one as the map filter, watch it, zoom to it, edit or delete it."]) },

    { id: "point", t: "Points and photos", h:
      fig("point", "A new point") +
      ul(["Tap " + b("Point") + " and choose " + b("At the map centre") + ", " + b("Tap the map to place it") + " or " + b("At my position") + ".",
        "Give it a name, a note and an icon (military symbol, shape or pin). Edits save as you type.",
        b("Take photo") + " or " + b("Add from library") + " adds pictures. Each original is kept unchanged with its SHA-256 fingerprint, on this device only.",
        "Tap a point on the map for " + b("Measure from") + ", " + b("Route from") + ", " + b("Medical plan here") + ", " + b("Copy") + " and " + b("Remove") + "."]) +
      tip("Points and photos are never uploaded. Clearing this site's data in the browser removes them, so use Move to another device to keep a copy.") },

    { id: "watch", t: "Watches and alerts", h:
      fig("watch", "Watch an area") +
      ul(["Tap " + b("Watch") + ". Choose the area (the drawn area, a saved NAI/TAI or the whole country), categories, words to look for and severity, give it a name and press " + b("Save watch") + ".",
        "What is already there when you save is not announced. Only new reports count as hits.",
        "OSAP checks when it opens and every 15 minutes while it is open. Press " + b("Turn on") + " for system notifications.",
        "On iPhone and iPad, notifications only work from the Home Screen app."]) +
      "<h3>Alerts when OSAP is closed</h3>" +
      ul(["On a saved watch, tap " + b("Push to phone") + ".",
        "Get the free ntfy app, subscribe to the channel name OSAP gives you, and press " + b("Send a test alert") + " to check.",
        "Press " + b("Send to OSAP") + ". It opens a pre-filled GitHub issue; submit it, and the watch switches on after the next check, usually a minute or two.",
        "The watch's words and the channel name are public. An alert is a notice about a report, not a finding."]) },

    { id: "mywork", t: "My work, workspaces and KML", h:
      fig("mywork", "My work") +
      ul([b("My work") + " has " + b("What's new") + " (reports added since your last visit) and " + b("Saved work") + ".",
        "On any report use " + b("☆ Save") + ", " + b("Mark reviewed") + " and " + b("✎ Add note") + ". Reviewed means you looked at it; it does not verify the report.",
        b("Trends") + " counts reports by day or week. It shows how much was reported, not how much happened.",
        b("Export") + " makes a situation report to print, or a KML, GeoJSON or CSV file. Every item keeps its source link and fingerprint, and your notes go in separate columns."]) +
      "<h3>Workspaces</h3>" +
      ul(["A workspace holds your points, areas, NAI/TAI, routes, imported shapes, viewsheds, watches and notes. Keep one per job.",
        "Open " + b("Workspaces") + " at the top of My work to rename, switch, delete or make a " + b("New workspace") + ". Switching reloads the page.",
        b("Import KML, KMZ or workspace") + " brings shapes into the active workspace: placemarks become points, lines and polygons become shapes. A workspace .zip comes in as a new workspace.",
        b("Export workspace (.zip)") + " and " + b("Export KML") + " take it out."]) },

    { id: "medplan", t: "Medical plan", h:
      fig("medplan", "The medical plan for the map centre") +
      ul(["Tap " + b("Med plan") + ". It plans for the drawn area, or the map centre when nothing is drawn. Or long-press, " + b("Plans") + ", " + b("Med plan from here") + ".",
        "Set the point of injury: type a grid and press " + b("Set") + ", or press " + b("Pick on map") + ".",
        "The plan lists receiving hospitals, most capable first, with drive times against the golden hour, routes, emergency contacts, landing sites, ways out of the country, health threats, weather and ground.",
        "The table of Primary, Secondary and Tertiary hospitals covers major trauma, severe head injury, major burn and complex limb trauma. It says when to bypass a hospital and go straight to the next.",
        "Only capabilities from a credible source count: an official register or your own check. OpenStreetMap and Wikipedia are shown but never qualify.",
        "Record your own check on a hospital under " + b("Assessment") + ". It replaces older checks and expires after the hours you set.",
        "The status at the top is GREEN (complete), AMBER (needs medical checks) or RED (a blocking error). The checklist under it says what is missing.",
        b("Print view (map and details)") + " shows every page with maps, then " + b("Print or save PDF") + "."]) +
      tip("The plan is an automatic draft from open data, not AI and not approved. Acceptance is never assumed: call the receiving hospital. Drive times assume no traffic.") },

    { id: "evac", t: "Evacuation plan", h:
      fig("evac", "The evacuation plan") +
      ul(["Tap " + b("Evac") + ", or long-press, " + b("Plans") + ", " + b("Evacuate from here") + ".",
        "Set where the people are: " + b("Pick on map") + ", " + b("My location") + ", one of your points, or type a grid or place and press " + b("Find") + ".",
        "Choose " + b("Travel by") + " and how many days of incidents to weigh, then press " + b("Work out the options") + ".",
        "OSAP finds routes to the nearest U.S. embassy or consulate, major airport, airfield and seaport, plus an alternate road. Its first choice has the fewest incidents near the route, unless it is much slower.",
        "Give each option a role: P Primary, A Alternate, C Contingency, E Emergency, or press " + b("Use suggested roles") + ". Set its status: Available, Degraded, Blocked or Unknown.",
        b("Open in Route (checkpoints, print)") + " takes an option to Route to print it. " + b("Where this route can be seen from") + " shows the ground that overlooks it.",
        "Plans are kept on this device, up to 20."]) +
      tip("OSAP never proposes Available: only you do. An embassy is shown as a place to go, not a confirmed evacuation point. Call the post first.") },

    { id: "lz", t: "Landing zone finder", h:
      fig("lz", "Landing zone candidates") +
      ul(["Long-press and tap " + b("Find LZ") + ", or draw an area and pick " + b("Landing zones") + " from the Area menu.",
        "Set the search " + b("Radius") + ", the " + b("LZ size") + " (25 m for light helicopters up to 250 m for many aircraft) and the " + b("Max slope") + ", then press " + b("Find landing zones") + ".",
        "Up to 8 numbered candidates show. Green is a candidate; orange means a slope over 7°. Each says how much ground is clear, the slope, the nearest obstacle and which aircraft fit.",
        "Each candidate needs ground clear of buildings, trees, wires, water and roads, a slope under the limit, and at least one clear approach.",
        "When the size is over 50 m, purple spots show places that fit a 50 m LZ only.",
        b("Check on satellite") + " switches to the satellite map so you can look."]) +
      tip("Candidates come from open data. Soil, crops and unmapped wires are not checked: verify on the ground.") },

    { id: "terrain", t: "Terrain analysis", h:
      fig("terrain", "A viewshed: what can be seen from a point") +
      ul(["Long-press, tap " + b("Terrain") + ", then " + b("Viewshed from here") + ", " + b("Reverse viewshed to here") + ", " + b("Line of sight from here") + ", " + b("Elevation here") + " or " + b("Radio coverage from here") + ".",
        "Or open Overlays, " + b("Elevation and terrain analysis") + ", " + b("Terrain analysis") + ". Or press " + b("Profile") + " in Measure.",
        b("Viewshed") + " shows the ground that can be seen from a point. " + b("Reverse viewshed") + " shows where a point can be seen from.",
        "Set the heights (standing person, vehicle, building or antenna), the range and the detail, then press " + b("CALCULATE") + ".",
        b("Line of sight") + " between two points says VISIBLE or BLOCKED, with a profile of the ground. With more points it is an elevation profile with climb and steepest grade.",
        b("Slope") + " colours the steepness of the ground round a point.",
        "Name and save a viewshed to show it again later from Overlays."]) +
      tip("Terrain only: buildings and trees are not modelled. Grey means no elevation data, never “not visible”. Everything is worked out on this device.") },

    { id: "comms", t: "Comms planning", h:
      fig("comms", "Comms planning on the Coverage tab") +
      ul(["Tap " + b("Comms") + " on the toolbar; tap it again to go back. Or open Overlays, Infrastructure, " + b("Communications infrastructure") + ". From Route, " + b("Comms along route") + " opens it on the route.",
        b("Plan") + ": build a PACE plan by phase, with method, device, net, expected coverage, failure trigger and what to do next. Print it or copy it as text.",
        b("Coverage") + ": " + b("Will I have phone signal?") + " at a place, along a line or along your planned route. Answers are Likely, Possible, No sign of coverage or Unknown.",
        b("Link") + ": a radio link budget with free-space loss, margin, radio horizon and Fresnel zone, the terrain between two points, and " + b("Radio coverage from a point") + ": where a radio there could be heard over the ground (green likely, orange marginal). Long-press the map, " + b("Terrain") + ", " + b("Radio coverage from here") + " does the same for that spot.",
        b("Networks") + ": reported internet outages, the masts on the map and a switch for each phone network. Each network has its own colour, for its masts and for the places phones picked up its cells (OpenCelliD); tick or untick a network to show or hide it. Tap a mast to see the networks heard round it.",
        b("Equipment") + ": power and batteries, loadout, cable, antenna lengths, connectors, channel plan and COMSEC records (status only, never key material).",
        b("Status") + ": a board for each PACE level, the check log, message traffic, interference reports and a troubleshooting walk-through."]) +
      tip("Coverage is modelled from measured tests and mast line of sight. Unknown is never shown as no. OSAP does not test any network.") },

    { id: "reports", t: "Reports to print or share", h:
      fig("reports", "The Reports menu") +
      ul(["Tap " + b("Reports") + " for every report OSAP makes: country brief, country report, daily summary, weather brief, 5-day weather chart and detailed weather, night illumination, timeline report, area summary, medical plan, route plan and situation report.",
        "A greyed entry says what to do first, for example " + b("Draw an area first") + " or " + b("Plan a route first") + ".",
        "Each report opens as a page you can print or save as PDF."]) },

    { id: "settings", t: "Settings", h:
      fig("settings", "Settings, under the gear") +
      ul(["The gear holds settings for this device: " + b("Map colours") + " (Light, Grey, Dark), " + b("Grid format") + " (MGRS, Lat/long, DMS) and " + b("Distance units") + " (km, miles, nautical mi).",
        b("Use my location") + ": off until you turn it on. OSAP then starts on your country and shows where you are. Only the country is stored, never your position.",
        b("Language") + ": English, Thai, Vietnamese, Filipino, Indonesian, Malay, Chinese, Japanese or Korean for the app's menus and buttons. Reports stay in their original language. The translations are AI drafts, marked AI generated.",
        b("User guide") + ": this guide."]) +
      "<h3>Offline maps and data</h3>" +
      ul(["Save a country so OSAP opens and works with no signal: the Offline map, the country's layers, brief, news, history and the medical plan's hospitals.",
        "Pick " + b("Whole country") + " or " + b("What the map shows now") + ", choose the detail, and press " + b("Download for offline") + ". Pressing again later fetches only what is missing.",
        "The Offline map is satellite imagery without street names. " + b("Download terrain") + " saves elevation for viewshed and line of sight.",
        "Live weather, road routing, satellite fire and flood layers, Refresh now and AI summaries still need signal."]) +
      "<h3>Move to another device</h3>" +
      ul(["No account is needed. Your saved data goes into one file locked with a passphrase you choose.",
        "On the old device: type a passphrase twice, press " + b("Make backup file") + ", then " + b("Save file") + " or " + b("Share or AirDrop") + ".",
        "On the new device: " + b("Open backup") + ", type the passphrase, then " + b("Replace and reload") + ". This replaces what the new device had; " + b("Put back what was here before") + " undoes it.",
        "If the passphrase is lost the file cannot be opened. Four or more random words make a strong one.",
        "Offline map downloads, Use my location and On-device AI settings stay behind."]) +
      "<h3>On-device AI</h3>" +
      ul(["AI summaries (area, route and tab summaries) run on your device, never on a server.",
        "OSAP uses the browser's own model if it has one, or your own AI server on your network, or OSAP's own small model.",
        "OSAP's model is under 1 GB and downloads once (Wi-Fi is best), then works offline. It needs a recent Chrome or Edge, or Safari on iOS 26 or later.",
        "Press " + b("Check it works") + " to test it."]) },

    { id: "reading", t: "Reading what you see", h:
      "<h3>Reports are claims</h3>" +
      ul(["Every report is what a source said. It is not verified unless it says so. A trusted source can still be wrong.",
        "Labels: " + b("Observed") + " is an instrument reading, " + b("Reported") + " is a statement or news report that has not been confirmed.",
        "Government figures are claims too. Outlets tagged " + b("State media") + " carry a government's own statements.",
        "Figures such as casualties are shown as reported by the source."]) +
      "<h3>Source links</h3>" +
      ul(["Each report links to the original. Open it to read the source in full.",
        b("Machine translated") + " means OSAP translated the headline; check the original for the exact words."]) +
      "<h3>Fingerprints</h3>" +
      ul(["A " + b("Record fingerprint") + " is a SHA-256 code made from the record as OSAP holds it. If any field changes, the code changes.",
        "Use it to show that a report you cite is the same one you saw. It does not cover the source page itself.",
        "Photos and drawn shapes have fingerprints too."]) +
      "<h3>AI generated, Automatic and Automatic draft</h3>" +
      ul([b("AI generated") + ": written by an AI model. It is a draft and has not been approved by an analyst. Tap the tag for details.",
        b("Automatic") + ": written by fixed rules, not AI, and not approved by an analyst.",
        b("Automatic draft") + ": a plan (medical, evacuation) built by fixed rules from open data. You check it and make the decisions."]) +
      "<h3>Times</h3>" +
      ul(["Every time shows Zulu first, then local time, on a 24-hour clock, for example " + b("4 Oct 2026 0340Z / 10:40 ICT") + "."]) },

    { id: "help", t: "Quick answers", h:
      ul(["<b>The map is blank or stuck.</b> Check the Data badge, then close and reopen OSAP. If it stays blank, open <a href=\"reset.html\">the reset page</a>. It resets the layout and keeps your saved work.",
        "<b>A layer shows nothing.</b> Check the period: 24 h may hide older reports. Some layers draw only when you zoom in.",
        "<b>“Point not saved: storage is full”.</b> Delete some saved items or workspaces you no longer need, then try again.",
        "<b>No alerts arrive.</b> On iPhone, open OSAP from the Home Screen. For alerts while OSAP is closed, use Push to phone.",
        "<b>New phone.</b> Use Settings, " + b("Move to another device") + " before you reset the old one.",
        "<b>Where did the data come from?</b> Settings, " + b("Credits and data sources") + "."]) }
  ];

  /* ---------- the page ---------- */
  var box = null, lastFocus = null;
  function build() {
    box = D.createElement("div"); box.id = "guidedlg"; box.hidden = true;
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "guide-h");
    box.innerHTML =
      '<div class="ghead"><h2 id="guide-h">User guide</h2>' +
      '<button type="button" class="gbtn" data-g="print">Print or save PDF</button>' +
      '<button type="button" class="gx" data-g="close" aria-label="Close the guide">&times;</button></div>' +
      '<div class="gbody"><p class="gsub">AXIOM OSAP, Open Source Awareness Platform. Short help for each part of the app. It works with no signal.</p>' +
      '<input type="search" class="gfind" placeholder="Find in the guide" aria-label="Find in the guide">' +
      '<nav class="gtoc" aria-label="Contents">' + S.map(function (s) { return '<a href="#" data-gto="' + s.id + '">' + esc(s.t) + "</a>"; }).join("") + "</nav>" +
      '<p class="gnone" hidden>Nothing in the guide matches that.</p>' +
      S.map(function (s) { return '<section class="gsec" data-gsec="' + s.id + '"><h2>' + esc(s.t) + "</h2>" + s.h + '<a href="#" class="gtop" data-gto="top">Back to contents</a></section>'; }).join("") +
      "</div>";
    D.body.appendChild(box);
    /* a picture that has not been saved yet is left out rather than shown broken */
    Array.prototype.forEach.call(box.querySelectorAll(".gfig img"), function (im) { im.addEventListener("error", function () { var f = im.closest("figure"); if (f) f.hidden = true; }); });
    box.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-g],[data-gto]"); if (!t) return;
      e.preventDefault();
      var g = t.getAttribute("data-g"), to = t.getAttribute("data-gto");
      if (g === "close") close();
      else if (g === "print") print();
      else if (to) go(to);
    });
    /* Esc closes the guide first, before the map's own Esc handlers see it */
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && box && !box.hidden) { e.stopImmediatePropagation(); e.preventDefault(); close(); } }, true);
    var find = box.querySelector(".gfind");
    find.addEventListener("input", function () { filter(find.value); });
    style();
  }
  function go(id) {
    var body = box.querySelector(".gbody");
    if (id === "top") { body.scrollTop = 0; return; }
    var el = box.querySelector('[data-gsec="' + id + '"]');
    if (el) { el.hidden = false; body.scrollTop = el.offsetTop - body.offsetTop - 4; }
  }
  /* find: keep the sections with every typed word, hide the rest */
  function filter(q) {
    var words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean), any = false;
    Array.prototype.forEach.call(box.querySelectorAll(".gsec"), function (s) {
      var text = s.textContent.toLowerCase(), hit = words.every(function (w) { return text.indexOf(w) >= 0; });
      s.hidden = !hit; if (hit) any = true;
    });
    box.querySelector(".gtoc").hidden = words.length > 0;
    box.querySelector(".gnone").hidden = any;
  }
  function open(id) {
    if (!box) build();
    lastFocus = D.activeElement;
    box.hidden = false; D.documentElement.classList.add("guide-open");
    var x = box.querySelector(".gx"); if (x) x.focus({ preventScroll: true });
    if (id) go(id); else box.querySelector(".gbody").scrollTop = 0;
  }
  function close() {
    if (!box || box.hidden) return;
    box.hidden = true; D.documentElement.classList.remove("guide-open");
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  /* print the whole guide: every section shown (a find in progress is cleared), the app itself hidden by the print CSS */
  function print() {
    var f = box.querySelector(".gfind"); if (f.value) { f.value = ""; filter(""); }
    Array.prototype.forEach.call(box.querySelectorAll("img[loading=lazy]"), function (im) { im.loading = "eager"; });
    setTimeout(function () { W.print(); }, 300);
  }
  function style() {
    var css = D.createElement("style"); css.id = "guide-css";
    css.textContent =
      "#guidedlg{position:fixed;inset:0;z-index:100003;background:var(--surface,#F1F4F7);color:var(--ink,#1A2129);display:flex;flex-direction:column}" +
      "#guidedlg[hidden]{display:none}" +
      "#guidedlg .ghead{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;border-bottom:1px solid var(--line,#C9D1DA);background:var(--surface,#F1F4F7)}" +
      "#guidedlg .ghead h2{flex:1;margin:0;font-size:18px}" +
      "#guidedlg .gbtn{min-height:40px;padding:0 12px;border:1px solid var(--line,#C9D1DA);border-radius:8px;background:var(--surface2,#E7EBF0);color:inherit;font:inherit;font-size:14px;cursor:pointer}" +
      "#guidedlg .gx{min-width:44px;min-height:44px;font-size:28px;line-height:1;background:none;border:none;color:inherit;cursor:pointer}" +
      "#guidedlg .gbody{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 16px 40px;font-size:15px;line-height:1.5}" +
      "#guidedlg .gbody>*{max-width:720px;margin-left:auto;margin-right:auto}" +
      "#guidedlg .gsub{color:var(--muted,#56626F);margin:0 auto 10px}" +
      "#guidedlg .gfind{display:block;width:100%;box-sizing:border-box;min-height:44px;padding:6px 12px;font:inherit;font-size:16px;border:1px solid var(--line,#C9D1DA);border-radius:8px;background:var(--surface,#fff);color:inherit}" +
      "#guidedlg .gtoc{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;margin-bottom:8px}" +
      "#guidedlg .gtoc a{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:999px;background:var(--accent-soft,#D6E3EE);color:var(--ink,#1A2129);text-decoration:none;font-size:14px}" +
      "#guidedlg .gsec{border-top:1px solid var(--line,#C9D1DA);padding-top:6px;margin-top:18px}" +
      "#guidedlg .gsec>h2{font-size:20px;margin:8px 0}#guidedlg h3{font-size:16px;margin:14px 0 4px}" +
      "#guidedlg ul{padding-left:20px;margin:6px 0}#guidedlg li{margin:5px 0}" +
      "#guidedlg .gb{font-weight:600;white-space:nowrap}" +
      "#guidedlg .gtip{background:var(--surface2,#E7EBF0);border-left:3px solid var(--accent,#1D5A86);padding:6px 10px;margin:10px 0;font-size:14px}" +
      "#guidedlg .gfig{margin:10px 0;text-align:center}#guidedlg .gfig[hidden]{display:none}" +
      "#guidedlg .gfig img{max-width:min(100%,300px);height:auto;border:1px solid var(--line,#C9D1DA);border-radius:10px}" +
      "#guidedlg .gfig figcaption{font-size:13px;color:var(--muted,#56626F);margin-top:2px}" +
      "#guidedlg .gtop{display:inline-block;margin-top:6px;font-size:13px;color:var(--accent,#1D5A86)}" +
      "#guidedlg .gnone{color:var(--muted,#56626F)}" +
      /* print: only the guide, all of it, in ink on paper */
      "@media print{html.guide-open body>*:not(#guidedlg){display:none!important}" +
      "html.guide-open #guidedlg{position:static;display:block;background:#fff;color:#000}" +
      "html.guide-open #guidedlg .gbody{overflow:visible;padding:0;font-size:11pt}" +
      "html.guide-open #guidedlg .gbtn,html.guide-open #guidedlg .gx,html.guide-open #guidedlg .gfind,html.guide-open #guidedlg .gtop{display:none}" +
      "html.guide-open #guidedlg .gtoc a{background:none;padding:0 6px;min-height:0}" +
      "html.guide-open #guidedlg .gsec{break-inside:auto}html.guide-open #guidedlg .gsec>h2{break-after:avoid}" +
      "html.guide-open #guidedlg .gfig{break-inside:avoid}html.guide-open #guidedlg .gfig img{max-width:220px}}";
    D.head.appendChild(css);
  }

  W.OSAP_GUIDE = { open: open, close: close, isOpen: function () { return !!box && !box.hidden; }, sections: function () { return S.map(function (s) { return { id: s.id, title: s.t }; }); } };
})();
