/* AXIOM OSAP: the user guide (Shane 2026-10-04: "We need a user guide").
   - Opened from Settings (the gear) > "User guide". One full-screen page: contents, a find box, then short sections written
     for a phone, top to bottom in the order an analyst meets the app. Each section names the buttons exactly as the app
     labels them, so the guide must change with the app: a renamed button means a line here changes too.
   - Works offline: the text is in this file (cached with the app) and the pictures are assets/guide/<name>.jpg, which the
     service worker keeps after install. A picture that is not there yet is left out, never shown broken.
   - "Export PDF" prints the same content with every section open and the app hidden, so the paper copy and the
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
      ul(["The period decides which reports you see: " + b("24 h") + ", " + b("7 d") + ", " + b("14 d") + ", " + b("30 d") + ", " + b("90 d") + ", " + b("All") + " or " + b("Custom") + ".",
        "On a phone it is the small chip beside the gear. It always names the period in force.",
        "When reports are hidden by the period, the list says how many and offers " + b("Show all") + "."]) +
      "<h3>Today</h3>" +
      ul(["Today opens each time you start the app. It shows the weather, warnings and alerts, top stories, a daily summary and what is new since your last visit.",
        b("Economy") + " shows the currency against the U.S. dollar (30 days and a year), staple food and fuel prices where WFP reports markets, and inflation, each with a small trend line and a link to its source. Inflation is the government's own figure, marked " + b("Official claim") + ". A " + b("Watch") + " flag means a figure moved fast (currency down more than 10% in 30 days or 30% in a year, a staple food or fuel price up more than 20% in a month); such moves often come before unrest, but a flag is a computed signal, not an assessment. " + b("Full detail in the country brief") + " opens the brief with a page of all the figures.",
        "Search the news from the box at the top. Use quotes to keep a phrase together and a minus sign to leave a word out.",
        "Tap " + b("Open map") + " to go to the map. To start on the map every time, pick " + b("Map") + " at the foot of Today.",
        b("Key dates") + " lists the next three dates that matter in the country: public holidays, elections and referendums, religious periods (Ramadan, Eid, Christmas, Easter, Diwali, Lunar New Year, Songkran and others) and anniversaries of its deadliest days of violence in UCDP's record. Each says why it matters, links its source and is marked " + b("Official") + " (a government holiday list), " + b("Claimed") + " (a reported election schedule) or " + b("Computed") + " (worked out from a calendar or a record). Dates are the local day, with the time that day starts in Zulu. " + b("Show all") + " opens the full list for the past 7 and next 60 days in the country brief.",
        "When a country has no news in the last 24 hours, " + b("Top stories") + " says so and gives the time of the newest item. Tap " + b("Newest older items") + " to see them, or " + b("News from nearby countries") + " for the latest from its neighbours and the same region. A card showing old data gives its age in grey, for example (17 days old).",
        "The OSAP logo at the top left brings you back to Today."]) +
      "<h3>My countries</h3>" +
      ul(["The first time you open OSAP on a device it asks for up to 5 countries and how you use it: " + b("Analyst") + ", " + b("Team in country") + " (also offers " + b("Use my location") + ") or " + b("Traveller") + " (Today shows the U.S. travel advisory at the top). " + b("Skip") + " if you would rather not; it is not asked again.",
        "Today then opens on your first country. Your countries show as chips on Today and beside the country picker on the map: one tap switches.",
        "Tap " + b("☆ Pin") + " beside the country picker to add the open country (up to 5), " + b("★ Pinned") + " to take it off. The " + b("My countries") + " card on Today shows the newest headline in each and how many are new.",
        "Today says how many headlines and warnings are new since you last looked at that country, and marks them " + b("New") + ". The count starts again once you have looked.",
        "Change your countries or role any time: Settings, " + b("My countries and setup") + ". All of this stays on this device."]) +
      "<h3>Install it like an app</h3>" +
      ul(["iPhone or iPad: in Safari tap Share, then " + b("Add to Home Screen") + ".",
        "Android or a computer: use the browser's Install or Add to Home screen option.",
        "Installed, OSAP opens full screen, can send watch alerts, and the browser is less likely to clear your saved maps.",
        "To open quickly on a phone, OSAP downloads only what your plan includes and what the open country needs: Thailand's flood and border maps load only for Thailand, and the border map only when you open it."]) },

    { id: "map", t: "The map screen", h:
      fig("map", "The map with the toolbar down the right") +
      ul(["The " + b("toolbar") + " runs down the right of the map. The arrow at its top folds it away; tap again to bring it back. On a phone, scroll the toolbar when a down arrow shows more tools below.",
        "The strip along the bottom shows the grid of the map centre. Tap the grid to switch between MGRS, decimal degrees and DMS, or tap the copy icon to copy it.",
        "When " + b("Use my location") + " is on, the strip also shows your own position. The target button locks the map on you until you move the map.",
        "The reports list sits under the map on a phone. Tap or drag it up to read it. On a computer, " + b("View") + ", " + b("Layout") + " chooses Map only, Map and list, or List.",
        "On a computer you can size and move the side panels (Details, Reports and windows such as the medical plan). Drag the small grip on a panel's edge to make it wider or narrower; double-click it for the normal width. Click the grip to " + b("Dock on the left") + ", " + b("Dock on the right") + ", " + b("Float over the map") + " or " + b("Reset size and place") + ". A floating panel moves by the bar on its top and gets taller or shorter by its bottom edge. Your choice is kept on this device.",
        "The title at the top names what you are looking at. Tap it to open " + b("Data sets") + " and change it.",
        "The " + b("Data") + " badge says how fresh the data is: green is fresh, amber means one or a few feeds are late (it names them, for example “Conflict tabs late”; everything else is fresh), red means data has stopped or most key feeds are down. Tap it for details and " + b("Refresh now") + "."]) },

    { id: "toolbar", t: "The toolbar", h:
      "<p>Top to bottom, the toolbar holds:</p>" +
      ul([b("Today") + ": back to the start screen.",
        b("Search") + ": find a place, or type an MGRS, UTM or lat/long grid. Grids work with no signal. Tap a result for " + b("Save as point") + ", " + b("Route to here") + " or " + b("Copy grid") + ".",
        b("Search") + " finds more than places: a country by name or code (" + b("Estonia") + " or " + b("ee") + " opens it), a tool (" + b("Med plan") + ", " + b("Evac") + ", " + b("LZ finder") + ", " + b("Flight plan") + ", " + b("Terrain analysis") + "), a report (" + b("OSIR") + ", " + b("PowerPoint") + "), a data set (it goes on the map) or a setting (" + b("Dark map") + ", " + b("miles") + ", " + b("Offline maps") + "). Everyday words work too: " + b("hospital") + " finds Med plan, " + b("night") + " finds Dark map. The last row searches the news. On a computer press " + b("/") + " or " + b("Ctrl+K") + " (" + b("Cmd+K") + " on a Mac) to start typing, the arrow keys and Enter to pick, Esc to close.",
        b("Data sets") + ": the reporting topics, such as conflict, crime, natural disasters, public safety and news. Tick a set to show it on the map; tap its name to open its list. " + b("Clear map") + " takes everything off.",
        b("Weather") + ": radar, satellite rain, cloud, wind, temperature, air quality, cyclones and warnings. " + b("Model time") + " looks ahead up to 72 hours. " + b("Open forecasts and warnings") + " opens the full weather view, with the one-page brief, the detailed report and the " + b("5-day chart") + " (a military-style chart: night and day halves, winds, crosswind on a runway you pick, density and pressure altitude, sun, moon, illumination and mission impacts hour by hour).",
        b("Overlays") + ": map layers that are not reports: infrastructure (communications, power plants of every fuel, the grid, data centres, airfields, ports, dams, submarine cables, railways, bridges and tunnels, water and sewage works, telephone exchanges, government sites, prisons, border crossings, police and fire stations, refineries and pipelines, roads), embassies and evacuation points, elevation and terrain analysis, key terrain, aircraft and ships, borders, and your own marks. Under " + b("Live aircraft") + ", " + b("GPS interference (last 24 h)") + " shades 1° cells where many aircraft reported poor GPS accuracy (yellow low, orange medium, red high; faint green normal); tap a cell for its counts and period. It is inferred from aircraft reports: an empty cell means too few aircraft to judge, not no jamming, and it does not detect spoofing.",
        b("Airspace and sea warnings") + " (in Overlays, after Ships): " + b("Sea warnings") + " draws the navigational warnings in force worldwide (NGA broadcast warnings) as hatched areas, circles, tracks and points, coloured by what they warn of; " + b("Airspace") + " draws US temporary flight restrictions (FAA) and EASA conflict zone bulletins (as country outlines). Tap a shape for the warning's id, issuer, times (UTC and local), the original text and a link to the source. Airspace coverage is partial (no other country's NOTAMs), shapes are read from text and may be wrong, and none of it is for navigation.",
        b("Base map") + ": Grey, Streets, Topographic, Satellite, Hybrid, Sentinel-2 cloudless, Daily satellite and Offline map. Streets are labelled in English.",
        b("View") + ": a drop-down for how the map looks: " + b("Grid") + " lines, " + b("Crosshair") + ", " + b("3D") + " terrain, the " + b("Compass") + ", " + b("Layout") + " (on a computer: Map only, Map and list, or List) and " + b("Full") + " screen.",
        b("Grid") + " and " + b("Crosshair") + " (in View): MGRS grid lines that get finer as you zoom in, and a cross on the map centre with its grid.",
        b("3D") + " (in View): tilt and turn the map over real ground. Tap the compass for north-up and flat, " + b("2D") + " to go back.",
        b("Compass") + " (in View, or tap the north arrow (top left of the map). On a phone it shows the way you face, true and magnetic, and a cone on your location dot; " + b("Heading up") + " turns the map to the way you face and " + b("North up") + " turns it back. On any device it gives the bearing and distance from you (or the map centre) to the map centre or the mouse pointer, in degrees or mils.",
        b("Plans") + ": every planning tool in one drop-down. Medical: " + b("Medical plan") + " (" + b("Med plan") + "), " + b("Hospital assessment") + ", " + b("Sea transit medevac") + ". Movement: " + b("Evacuation plan (Evac)") + ", " + b("Flight plan (airborne)") + ", " + b("Landing zones (HLZ finder)") + ". Airborne: " + b("Drop zone (DZSO)") + ", " + b("Site survey") + ". Comms and ground: " + b("Comms planning") + " (" + b("Comms") + "), " + b("Terrain analysis") + ". And the " + b("Weather brief") + ". The button lights while the medical plan, Evac or Comms planning is open.",
        b("Measure") + ", " + b("Route") + ", " + b("Area") + ", " + b("Point") + " and " + b("Watch") + ": each has its own section below. " + b("Point") + " also offers " + b("Check a photo or video") + ".",
        b("My work") + ": opens on the left of the map with My places (your saved map items in folders) and your saved reports and notes; What's new, Trends and Export are on its top row.",
        b("Reports") + " (phone) or the " + b("Reports") + " button in the header: every printable report OSAP makes.",
        b("Full") + " (in View): full-screen map. Press Esc on a keyboard to leave."]) +
      fig("datasets", "Data sets: tick to show on the map") +
      fig("weather", "Weather layers") +
      fig("overlays", "Map overlays") +
      fig("grid", "Grid and crosshair") },

    { id: "ring", t: "Long-press the map", h:
      fig("ring", "The ring of actions at a point") +
      ul(["Press and hold anywhere on the map (right-click with a mouse) for a ring of actions at that point.",
        b("Measure") + " and " + b("Route") + " start from the point. " + b("Point") + " drops a mark there.",
        b("NAI/TAI") + " and " + b("Watch") + " draw a circle of the chosen " + b("Radius") + " and open the save form or the watch form. They replace any area already drawn.",
        b("Plans") + " offers " + b("Med plan from here") + ", " + b("Hospital assessment here") + " and " + b("Evacuate from here") + ".",
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
        b("Navigate") + " (or " + b("Go") + " on the phone's route bar) starts turn-by-turn navigation: the map follows you, turned to your direction of travel, with the next turn, its distance and lanes, spoken turns, time left and arrival in Zulu and local time. Leave the route and it finds a new one from where you are. Hazards OSAP holds near the route are called out ahead. " + b("Simulate drive") + " rehearses it without GPS.",
        b("Search this route") + " finds reports within 1 to 25 km of the route. " + b("Comms along route") + " checks phone coverage along it.",
        b("Preview route") + " steps through pictures along the route: street pictures where they exist, otherwise satellite, terrain and map. Filter to critical points, hazards, bridges or support.",
        b("▶ Drive the route from here") + " plays the preview like a drive, at 1× to 8× speed.",
        "Save as GPX, KML or GeoJSON, print it, copy a link or name it and press " + b("Save") + ". Routes stay on this device."]) +
      tip("Route and Navigate are planning and awareness aids: the road, its signs and local law come first. If road routing does not answer, OSAP shows straight lines and says so; navigation then gives the bearing to the next waypoint.") +
      fig("route", "Route") },

    { id: "area", t: "Area, NAI and TAI", h:
      fig("area", "The Area menu") +
      ul(["Tap " + b("Area") + " and pick a shape: " + b("Lasso") + " (hold and draw round the area), " + b("Polygon") + " (tap each corner, then " + b("Finish") + "), " + b("Circle") + " or " + b("Square") + " (press and drag).",
        "A drawn area filters the map and the list to what is inside it.",
        b("Edit shape") + " lets you drag corners, turn and move it, and change its colours.",
        b("Summarise area") + " writes a summary of the reports inside, with numbered sources. It can also write an AI summary on this device.",
        b("Landing zones") + " searches inside the area (see LZ finder).",
        b("Satellite before/after") + " shows two Sentinel-2 pictures of the area (see Satellite before/after).",
        b("Save (NAI/TAI)") + " keeps the area with a type, a name and notes. Saved areas appear under Overlays, where you can use one as the map filter, watch it, zoom to it, edit or delete it."]) },

    { id: "satba", t: "Satellite before/after", h:
      ul(["Draw an area, then " + b("Area") + ", " + b("Satellite before/after") + ". Or open Overlays, " + b("Satellite imagery") + ", " + b("Open Satellite before/after") + " (the drawn area, or the map view when none is drawn).",
        "OSAP lists the Sentinel-2 passes over the area for the last 90 days with the time in Zulu and local time and the cloud %. It picks the newest clear pass as " + b("After") + " and one about 30 days earlier as " + b("Before") + ". Press " + b("Before") + " or " + b("After") + " on any pass to change them, filter by cloud, or " + b("Look 90 days further back") + ".",
        b("Side by side") + " shows the two pictures in the window. " + b("Swipe on map") + " lays them on the map: drag the round handle, before on the left, after on the right.",
        "Each picture shows its scene id with a link to its catalogue entry, the time and the cloud %. Pictures are about 10 m, true colour, read straight from the open Copernicus archive on this device.",
        b("NASA daily true colour") + " (here or in Overlays, Satellite imagery) lays one day's whole-world VIIRS or MODIS picture, about 250 m, on the map. " + b("Day of the after pass") + " sets its day to the after picture's."]) +
      tip("The cloud % is for the whole 110 km tile, so a pass can still be cloudy over a small area, or clear over it. Areas up to about 250 km across. Contains modified Copernicus Sentinel data.") },

    { id: "point", t: "Points and photos", h:
      fig("point", "A new point") +
      ul(["Tap " + b("Point") + " and choose " + b("At the map centre") + ", " + b("Tap the map to place it") + " or " + b("At my position") + ".",
        "Give it a name, a note and an icon (military symbol, shape or pin). Edits save as you type.",
        b("Take photo") + " or " + b("Add from library") + " adds pictures. Each original is kept unchanged with its SHA-256 fingerprint, on this device only.",
        "Tap a point on the map for " + b("Measure from") + ", " + b("Route from") + ", " + b("Route to") + " (adds it to the end of the route you are planning), " + b("Medical plan here") + ", " + b("Check a photo here") + ", " + b("Copy") + " and " + b("Remove") + "."]) +
      tip("Points and photos stay on this device unless you turn on Sync my devices, which sends points (not photos) locked with your sync code. Clearing this site's data in the browser removes them, so use Move to another device to keep a copy.") },

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
      ul([b("My work") + " drops down on the left of the map, so the map stays in view. It has two sections you open and close: " + b("My places") + " (folders for your saved points, routes, shapes, rulers, drop zones and more, each with a box to show or hide it on the map) and " + b("Saved reports and notes") + ". Its top row opens " + b("What's new") + " (reports added since your last visit), " + b("Trends") + " and " + b("Export") + ".",
        "On any report use " + b("☆ Save") + ", " + b("Mark reviewed") + " and " + b("✎ Add note") + ". Reviewed means you looked at it; it does not verify the report.",
        b("Grade") + " a report the Admiralty / NATO way: source reliability A (completely reliable) to E (unreliable), F cannot be judged, and information credibility 1 (confirmed by other sources) to 5 (improbable), 6 cannot be judged, for example B2. Press " + b("?") + " beside it for what each one means. The grade shows as a badge wherever My work lists the report and goes into every export.",
        "A grade is always your own choice; OSAP never sets one. " + b("Default … for …") + " remembers a reliability for that source (its web domain), which pre-fills ungraded reports from it until you press " + b("Confirm") + " or set the credibility. Change or remove defaults under " + b("Grading and source defaults") + " in My work.",
        b("Trends") + " counts reports by day or week. It shows how much was reported, not how much happened.",
        b("Export") + " makes a situation report to print, or a KML, GeoJSON or CSV file. Every item keeps its source link and fingerprint, and your notes go in separate columns."]) +
      "<h3>Workspaces</h3>" +
      ul(["A workspace holds your points, areas, NAI/TAI, routes, imported shapes, viewsheds, watches and notes. Keep one per job.",
        "Open " + b("Workspaces") + " at the top of My work to rename, switch, delete or make a " + b("New workspace") + ". Switching reloads the page.",
        b("Import KML, KMZ or workspace") + " brings shapes into the active workspace: placemarks become points, lines and polygons become shapes. A workspace .zip comes in as a new workspace.",
        b("Export workspace (.zip)") + " and " + b("Export KML") + " take it out."]) },
    { id: "team", t: "Team workspace", h:
      "<p>Share a workspace with your team, so everyone sees the same points, areas, NAI/TAI, routes, shapes, viewsheds, watches, saved reports and notes, plans and analyst entities. It needs the Full plan.</p>" +
      "<h3>Start a team</h3>" +
      ul(["Open " + b("My work") + ", then " + b("Workspaces") + ". Under the active workspace press " + b("Share with a team") + ".",
        "Give the team a name and your call sign (up to 24 characters, never an email address), then press " + b("Create team") + ".",
        "Copy the " + b("Copy editor link") + " for members who add and change items, or the " + b("Copy viewer link") + " for members who only look. Send each one in a private message: anyone with a link is in the team."]) +
      "<h3>Join a team</h3>" +
      ul(["Open the link you were sent. OSAP asks first: type your call sign and press " + b("Join team") + ", or " + b("Not now") + ". Nothing joins until you press it.",
        "Or open Settings, " + b("Sync my devices") + ", and press " + b("Join a team with a link or code") + " to paste it.",
        "The team's items go into a new workspace named after the team. Press " + b("Open the team workspace") + " to switch to it."]) +
      "<h3>Working in a team</h3>" +
      ul(["Each item shows the call sign of the member who added it and when, in Zulu and local time.",
        "Each item is merged on its own and the newest change wins. Changes from the team show when OSAP opens, or press " + b("Show them") + ".",
        "With a viewer link you can see the team's items but cannot change them; that is enforced by the team's keys, not only by the buttons. Your own changes stay on your device.",
        "Photos and the hidden areas are never shared. A team holds about 2 MB; when it is full OSAP says so, and new changes wait until you delete items the team no longer needs."]) +
      "<h3>Remove someone</h3>" +
      ul(["A link cannot be taken back. The owner (who made the team) presses " + b("Make new team links") + ": OSAP makes a new team key, copies the team's items to it and closes the old key with a note that the team has moved.",
        "Send the new links to the members who stay. Whoever does not get one keeps what they had, but sees nothing new and cannot add to the team.",
        "The team key stays on members' devices. The team's data passes through free public relays locked with it; OSAP's server never holds the key."]) },
    { id: "cases", t: "Team cases", h:
      "<p>A team case is a workspace shared with named OSAP accounts, each with a role. OSAP's server checks every request against the case's members and roles, and the case's items stay sealed so only members' devices can read them. Creating a case needs the Full plan and a signed-in account.</p>" +
      "<h3>Roles</h3>" +
      ul([b("Lead") + ": invites, removes and changes roles, and adds and changes items. A case always keeps at least one lead.",
        b("Analyst") + ": adds and changes items.", b("Viewer") + ": reads the case. Changes a viewer makes stay on their own device."]) +
      "<h3>Start a case</h3>" +
      ul(["Open " + b("My work") + ", then " + b("Workspaces") + ". Under a workspace press " + b("Share as a case") + ", give it a name and your call sign, and press " + b("Create case") + ".",
        "Invite each member by the email of their OSAP account, with a role. They see the invite when they sign in (the email must be confirmed).",
        "A team shared by link can move to a case: its owner opens the team and presses " + b("Move to a team case") + ". The case is made from the same workspace, with every item and who added it. Members on the old links keep what they have and are told to ask the owner for an invite."]) +
      "<h3>Join a case</h3>" +
      ul(["Press " + b("Team cases") + " in My work > Workspaces. Open the invite, type your call sign and press " + b("Join case") + ". The case's items go into a new workspace.",
        "The first time, the case waits until a lead's device hands your device the case key; this happens on the lead's next sync."]) +
      "<h3>Remove someone</h3>" +
      ul(["A lead presses " + b("Remove") + " beside the member. The server refuses them at once, and the lead's device makes a new case key for the members left, so new items are sealed under a key the removed person never had. What they already saw stays on their devices.",
        "Every change to members and roles is kept in the case record, with who made it, the reason given and when: press " + b("Show who did what") + "."]) +
      "<h3>Analyst workspace and approval</h3>" +
      ul(["With a case's workspace open, members get the " + b("Analyst") + " workspace for the case's entities and links.",
        "An entity or link a member adds is a proposal. A lead presses " + b("Approve") + " or " + b("Reject") + ", with an optional reason that is sealed in the case record. If the item is edited later, it shows as a proposal again.",
        "Auto-proposed links stay drafts until someone accepts them, and nothing is approved by OSAP or by AI."]) },
    { id: "photocheck", t: "Photo and video check", h:
      "<p>Checks where and when a picture or video was taken. Everything runs on your device: nothing is uploaded.</p>" +
      ul(["Open it from " + b("Point") + " > " + b("Check a photo or video") + ", from " + b("My work") + " > " + b("Check a photo") + ", from a point on the map with " + b("Check a photo here") + ", or from a point's photo with " + b("Check this photo") + ". It sits beside the map.",
        b("Pick a photo or video") + ". The metadata shows the camera time (with its UTC offset when the file has one), the GPS position (a red pin on the map), the camera, the software that saved it and the size. JPEG, PNG, WebP, HEIC, MP4 and MOV are read.",
        "No metadata is normal: social media, chat apps and screenshots strip it. Any field can be faked, and camera clocks are often wrong, so treat it as a lead.",
        "<b>Sun and shadow</b>: set the place (" + b("Map centre") + ", " + b("Tap the map") + " or " + b("Photo GPS") + ") and the date, time and UTC offset. You get the sun's direction and height, and the map shows the expected shadow (black) and the way to the sun (orange, dashed).",
        "Type a shadow bearing you measured, or " + b("Draw the shadow on the map") + " (tap the foot of an object, then the tip of its shadow). The times that day when shadows point that way are listed; " + b("Use this time") + " puts one in the time box.",
        "<b>Video</b>: step with " + b("◀ Frame") + " and " + b("Frame ▶") + ", then " + b("Take this frame as a picture") + " to use it in the other checks.",
        "<b>Reverse image search</b>: " + b("Save the picture") + ", then open Google Lens, Bing Visual Search, Yandex Images or TinEye and upload it there yourself. Lens is best for places and landmarks, Yandex often for faces and Eastern Europe, TinEye for the oldest copy.",
        b("Save to My work") + " keeps the results and your note as a My work note for this country."]) +
      tip("The sun position uses the NOAA solar equations (about 0.01°). A shadow in a photo is foreshortened by the camera angle, so take its bearing from features you can place on the map.") },

    { id: "medplan", t: "Medical plan", h:
      fig("medplan", "The medical plan for the map centre") +
      ul(["Tap " + b("Plans") + ", " + b("Medical plan") + ". It plans for the drawn area, or the map centre when nothing is drawn. Or long-press, " + b("Plans") + ", " + b("Med plan from here") + ".",
        "Set the point of injury: type a grid and press " + b("Set") + ", or press " + b("Pick on map") + ".",
        "The plan opens folded to a bar showing its status, so the whole map stays in view. Press " + b("Half") + " or " + b("Full") + " on the bar to pull it up, and " + b("Map") + " to fold it again. On a phone you can also drag the bar. Watch, NAI/TAI, Terrain and the evacuation plan have the same bar.",
        "The plan lists receiving hospitals, most capable first, with drive times against the golden hour, routes, emergency contacts, landing sites, ways out of the country, health threats, weather and ground.",
        "The table of Primary, Secondary and Tertiary hospitals covers major trauma, severe head injury, major burn and complex limb trauma. It says when to bypass a hospital and go straight to the next.",
        "Only capabilities from a credible source count: an official register or your own check. OpenStreetMap and Wikipedia are shown but never qualify.",
        "Record your own check on a hospital under " + b("Assessment") + ". It replaces older checks and expires after the hours you set.",
        "One hospital on its own, with no plan: press " + b("Hospital assessment") + " in a hospital's map popup, or long-press, " + b("Plans") + ", " + b("Hospital assessment here") + ", or " + b("Reports") + ", " + b("Hospital assessment") + ". It prints with " + b("Export PDF") + ".",
        "The status at the top is GREEN (complete), AMBER (needs medical checks) or RED (a blocking error). The checklist under it says what is missing.",
        b("Print view (map and details)") + " shows every page with maps, then " + b("Export PDF") + "."]) +
      tip("The plan is an automatic draft from open data, not AI and not approved. Acceptance is never assumed: call the receiving hospital. Drive times assume no traffic.") },

    { id: "evac", t: "Evacuation plan", h:
      fig("evac", "The evacuation plan") +
      ul(["Tap " + b("Plans") + ", " + b("Evacuation plan (Evac)") + ", or long-press, " + b("Plans") + ", " + b("Evacuate from here") + ".",
        "Set where the people are: " + b("Pick on map") + ", " + b("My location") + ", one of your points, or type a grid or place and press " + b("Find") + ".",
        "Choose " + b("Travel by") + " and how many days of incidents to weigh, then press " + b("Work out the options") + ".",
        "OSAP finds routes to the nearest U.S. embassy or consulate, major airport, airfield and seaport, plus an alternate road. Its first choice has the fewest incidents near the route, unless it is much slower.",
        "Give each option a role: P Primary, A Alternate, C Contingency, E Emergency, or press " + b("Use suggested roles") + ". Set its status: Available, Degraded, Blocked or Unknown.",
        "Legs: pick a kind of node (assembly area, pickup point, transfer, vehicle change, air or sea departure, border crossing, safe haven), press " + b("Place on map") + " and tap where it is. The option splits into numbered legs; name and reorder the nodes as you need.",
        b("Mark unusable") + " on a leg works out a different line for that leg only, from the node before it. The other legs stay as they are. If there is no other line the leg stays unusable and the option is proposed Blocked.",
        "Corridor: pick a width (0.5 to 25 km or your own) and wider circles at chosen nodes. " + b("Find air and sea nodes in the corridor") + " lists airports, heliports, airfields, helipads, seaports and ferry terminals in it, in route order.",
        "Landing zones: " + b("Find candidate LZs near it") + " searches round a node. A candidate stays a candidate until you press " + b("Verify LZ") + ".",
        b("Fly out from here") + " or " + b("Sail from here") + " makes a ground-to-air or ground-to-sea option ending where you tap. Flown and sailed legs are straight lines timed at the speeds you set (helicopter 220 kt, fixed wing 400 kt, vessel 12 kt by default).",
        b("Find bridges and crossings") + " lists what the road legs depend on, in route order, with the detour if a bridge, tunnel or ferry is lost. Each border crossing gets a card: country entered, hours, the U.S. advisory and the nearest other crossing. Nothing is ever shown as open without a source.",
        b("Add a cross-border option") + " routes to the nearest official border crossings.",
        b("Check along the route") + " groups hazards in the corridor by km and shows phone coverage by stretch, fuel (the longest stretch without it), U.S. posts and hospitals near the line. The card then shows data freshness and how complete OSAP's checks are. Tick the map layers you want; Sustainment and Medical start off.",
        b("Open in Route (checkpoints, print)") + " takes an option to Route to print it. " + b("Where this route can be seen from") + " shows the ground that overlooks it.",
        b("Make a route package of this plan") + " freezes it with everything found. Each finding keeps its source, when it was fetched, its basis and a SHA-256 fingerprint. Packages open with no connection; " + b("Export PDF") + ", " + b("KML") + " and " + b("KMZ") + " for ATAK-style viewers.",
        b("Active mode") + " shows only the P route and one large card: next node, route status, next hazard, the A route, next fuel, next air option and the distance left. Tick each node as you pass it, or tick " + b("Count from My location") + ".",
        "Plans are kept on this device, up to 20; route packages, up to 5."]) +
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
      ul(["Tap " + b("Plans") + ", " + b("Comms planning") + " on the toolbar; pick it again to go back. Or open Overlays, Infrastructure, " + b("Communications infrastructure") + ". From Route, " + b("Comms along route") + " opens it on the route.",
        b("Plan") + ": build a PACE plan by phase, with method, device, net, expected coverage, failure trigger and what to do next. Export it as a PDF or copy it as text.",
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
        "Each report opens as a page with one " + b("Export PDF") + " button. It opens the print dialog: choose " + b("Save as PDF") + " and A4 or Letter. Every page carries the report's title, when it was exported (Zulu and local time), " + b("Page X of Y") + " and, where any part is AI generated, a note saying so; source links stay clickable in the PDF.",
        "The country brief ends with the country's " + b("Key dates") + ": every holiday, election, religious date and anniversary of the past 7 and next 60 days, with its source."]) },

    { id: "settings", t: "Settings", h:
      fig("settings", "Settings, under the gear") +
      ul(["The gear holds settings for this device: " + b("Map colours") + " (Light, Grey, Dark), " + b("Grid format") + " (MGRS, Lat/long, DMS) and " + b("Distance units") + " (km, miles, nautical mi).",
        b("Use my location") + ": off until you turn it on. OSAP then starts on your country and shows where you are. Only the country is stored, never your position.",
        b("Language") + ": English, Thai, Vietnamese, Filipino, Indonesian, Malay, Chinese, Japanese or Korean for the app's menus and buttons. Reports stay in their original language. The translations are AI drafts, marked AI generated.",
        b("My countries and setup") + ": your pinned countries and how you use OSAP, the questions asked the first time.",
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
      "<h3>Sync my devices</h3>" +
      ul(["Keeps your saved points, areas, routes, shapes, watches, plans and workspaces the same on your phone and computer. No account.",
        "On the first device press " + b("Start on this device") + ", note the sync code and press " + b("Turn on sync on this device") + ".",
        "On the other device press " + b("I have a code") + " and type it. What each device has is joined; nothing is replaced.",
        "Each item is merged on its own and the newest change wins. Deleted items stay deleted. Changes from the other device show when OSAP opens, or press " + b("Show them") + ".",
        "Photos, settings, offline maps and the hidden areas stay on each device. Keep the code private: anyone with it can read your synced data.",
        "Data is locked on your device before it is passed through free public relays, which cannot read it. Keep a backup with Move to another device too."]) +
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
      '<button type="button" class="gbtn" data-g="print">Export PDF</button>' +
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
    setTimeout(function () { W.OSAP_PDF.print({ title: "AXIOM OSAP user guide", root: box }); }, 300);
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
      "html.guide-open #guidedlg .gfig{break-inside:avoid;float:right;width:56mm;margin:0 0 3mm 5mm}html.guide-open #guidedlg .gfig img{max-width:100%;max-height:105mm;width:auto}" +
      "html.guide-open #guidedlg .gfig figcaption{font-size:8.5pt}html.guide-open #guidedlg .gsec{clear:both;display:flow-root}}";
    D.head.appendChild(css);
  }

  W.OSAP_GUIDE = { open: open, close: close, isOpen: function () { return !!box && !box.hidden; }, sections: function () { return S.map(function (s) { return { id: s.id, title: s.t }; }); } };
})();
