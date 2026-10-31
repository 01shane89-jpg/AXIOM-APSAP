// Builds assets/osap-icons-cat.js: the marker palettes for the analyst's own map points (assets/osap-milsym.js).
// Pictures come from two public-domain (CC0-1.0) map icon sets, used as drawn and only placed inside an OSAP frame:
//   Maki 8.2.0 (Mapbox, https://github.com/mapbox/maki)  and  Temaki 5.13.0 (https://github.com/rapideditor/temaki)
// The lettered badges (ICP, CCP, HLZ ...) are OSAP's own, drawn as text at run time. No icon is copied from any TAK
// product or other app.
//
//   npm pack @mapbox/maki@8.2.0 @rapideditor/temaki@5.13.0   (then untar each, or npm install --no-save them)
//   MAKI=<dir with icons/*.svg> TEMAKI=<dir with icons/*.svg> node tools/build_icon_palettes.mjs
//
// Output: window.OSAP_ICONS = { v, pals: [[id, name, blurb]], g: {glyph: [viewBox, [path d ...]]}, i: [[id, pal, name, frame, colour, art, group, tags]] }
//   frame: c circle, s square, d diamond (hazard), b badge (wide, filled), o round tile (place icons)
//   art:   "mk:<name>" Maki glyph, "tk:<name>" Temaki glyph, "t:<TEXT>" lettered badge
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
function dirOf(env, pkg) {
  if (process.env[env]) return process.env[env];
  return path.dirname(require.resolve(pkg + "/package.json"));
}
const MAKI = dirOf("MAKI", "@mapbox/maki"), TEMAKI = dirOf("TEMAKI", "@rapideditor/temaki");

function readGlyph(dir, name) {
  const f = path.join(dir, "icons", name + ".svg");
  const s = fs.readFileSync(f, "utf8");
  const vb = (/viewBox="([^"]+)"/.exec(s) || [])[1] || "0 0 15 15";
  const ds = [...s.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1].replace(/&#x[0-9a-f]+;/gi, " ").replace(/\s+/g, " ").trim());
  if (!ds.length) throw new Error("no path in " + f);
  return [vb.split(/[\s,]+/).map((x) => +(+x).toFixed(2)).join(" "), ds];
}
const list = (dir) => fs.readdirSync(path.join(dir, "icons")).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)).sort();
const makiAll = list(MAKI), temakiAll = list(TEMAKI);

const G = {}; // glyph id -> [viewBox, paths]
function art(ref) {
  const m = /^(mk|tk):(.+)$/.exec(ref);
  if (!m) return ref;
  const id = ref;
  if (!G[id]) G[id] = readGlyph(m[1] === "mk" ? MAKI : TEMAKI, m[2]);
  return ref;
}

// colours (the frame colour; the analyst can recolour any icon in the picker)
const C = { blue: "1971c2", red: "e03131", orange: "f76707", amber: "f59f00", green: "2b8a3e", teal: "0b7285", purple: "7048e8", black: "212529", brown: "8b5a2b", grey: "495057", navy: "1b3a6b", yellow: "f2c200" };

const I = [];
const seen = new Set();
function add(pal, group, list) {
  for (const [key, name, frame, colour, a, tags] of list) {
    const id = pal + "-" + key;
    if (!/^[a-z0-9_-]{1,40}$/.test(id)) throw new Error("bad id " + id);
    if (seen.has(id)) throw new Error("duplicate " + id);
    seen.add(id);
    I.push([id, pal, name, frame, C[colour] || colour, art(a), group, tags || ""]);
  }
}
const T = (s) => "t:" + s;

/* ---------- Incident command: facilities and operating areas (ICS / NIMS terms), OSAP's own lettered badges ---------- */
add("inc", "Command and coordination", [
  ["icp", "Incident Command Post", "b", "blue", T("ICP"), "ics nims command"],
  ["cp", "Command Post", "b", "blue", T("CP"), "command"],
  ["acp", "Access Control Point", "b", "blue", T("ACP"), "entry checkpoint"],
  ["ecp", "Entry Control Point", "b", "blue", T("ECP"), "entry checkpoint gate"],
  ["tcp", "Traffic Control Point", "b", "blue", T("TCP"), "traffic checkpoint police"],
  ["eoc", "Emergency Operations Centre", "b", "blue", T("EOC"), "emergency operations center"],
  ["joc", "Joint Operations Centre", "b", "blue", T("JOC"), "operations center"],
  ["macc", "Multi-Agency Coordination Centre", "b", "blue", T("MACC"), "coordination center"],
  ["jic", "Joint Information Centre", "b", "blue", T("JIC"), "information media public"],
  ["pio", "Public Information Officer", "b", "blue", T("PIO"), "media press"],
  ["media", "Media Area", "b", "blue", T("MEDIA"), "press"],
  ["liaison", "Liaison Point", "b", "blue", T("LNO"), "liaison"],
  ["info", "Information Point", "c", "blue", "mk:information", "information"],
]);
add("inc", "Facilities and areas", [
  ["staging", "Staging Area", "b", "green", T("S"), "staging"],
  ["base", "Incident Base", "b", "green", T("B"), "base"],
  ["camp", "Camp", "b", "green", T("C"), "camp"],
  ["helibase", "Helibase", "b", "green", T("HB"), "helicopter helibase"],
  ["helispot", "Helispot", "b", "green", T("H"), "helicopter helispot"],
  ["rally", "Rally Point", "b", "green", T("RP"), "rally assembly"],
  ["assembly", "Assembly Area", "b", "green", T("AA"), "assembly muster"],
  ["safe", "Safety Zone", "b", "green", T("SAFE"), "safety refuge"],
  ["refuge", "Temporary Refuge Area", "b", "green", T("TRA"), "refuge"],
  ["evac", "Evacuation Point", "b", "green", T("EVAC"), "evacuation"],
  ["shelter", "Shelter", "b", "green", "mk:shelter", "shelter mass care"],
  ["rehab", "Rehabilitation Area", "b", "green", T("REHAB"), "rest rehab"],
  ["supply", "Supply Point", "b", "brown", T("SUP"), "supply logistics"],
  ["water", "Water Point", "b", "brown", T("H2O"), "water supply"],
  ["fuel", "Fuel Point", "b", "brown", "mk:fuel", "fuel petrol diesel"],
  ["pod", "Point of Distribution", "b", "brown", T("POD"), "distribution aid"],
]);
add("inc", "Divisions and sectors", [
  ["div-a", "Division A", "s", "grey", T("A"), "division"], ["div-b", "Division B", "s", "grey", T("B"), "division"], ["div-c", "Division C", "s", "grey", T("C"), "division"],
  ["div-d", "Division D", "s", "grey", T("D"), "division"], ["div-z", "Division Z", "s", "grey", T("Z"), "division"],
  ["sector", "Sector", "s", "grey", T("SEC"), "sector"], ["branch", "Branch", "s", "grey", T("BR"), "branch"], ["group", "Group", "s", "grey", T("GRP"), "group"],
]);

/* ---------- Hazards: hazard diamonds ---------- */
add("haz", "Explosive and CBRN", [
  ["bomb", "Bomb", "d", "red", T("BOMB"), "explosive"],
  ["ied", "Improvised Explosive Device", "d", "red", T("IED"), "explosive bomb"],
  ["uxo", "Unexploded Ordnance", "d", "red", T("UXO"), "explosive ordnance"],
  ["mine", "Landmine", "d", "red", T("MINE"), "explosive mine"],
  ["cbrn", "CBRN Hazard", "d", "orange", T("CBRN"), "chemical biological radiological nuclear"],
  ["chem", "Chemical Hazard", "d", "orange", T("CHEM"), "chemical hazmat"],
  ["bio", "Biological Hazard", "d", "orange", T("BIO"), "biological"],
  ["rad", "Radiation Hazard", "d", "orange", "tk:radiation", "radiological nuclear"],
  ["rad-plant", "Nuclear Facility", "d", "orange", "tk:cooling_tower_radiation", "nuclear power"],
  ["hazmat", "Hazardous Materials", "d", "orange", T("HAZ"), "hazmat spill"],
  ["gas", "Gas Leak", "d", "orange", T("GAS"), "gas leak"],
  ["smoke", "Smoke", "d", "grey", T("SMK"), "smoke"],
]);
add("haz", "Fire, weather and ground", [
  ["fire", "Fire", "d", "red", "mk:fire-station", "fire flame"],
  ["wildfire", "Wildfire", "d", "red", T("WF"), "fire bush forest"],
  ["flood", "Flooding", "d", "blue", T("FLOOD"), "water flood"],
  ["landslide", "Landslide or Rockfall", "d", "brown", "tk:cliff_falling_rocks", "landslide rockfall"],
  ["collapse", "Structural Collapse", "d", "brown", T("COLL"), "collapse building"],
  ["volcano", "Volcano", "d", "red", "mk:volcano", "volcano eruption"],
  ["power", "Downed Power Line", "d", "amber", "tk:power", "electric wire"],
  ["snow", "Snow or Ice", "d", "blue", "tk:snow", "snow ice"],
  ["danger", "Danger", "d", "red", "mk:danger", "danger"],
  ["caution", "Caution", "d", "amber", "mk:caution", "caution warning"],
  ["blocked", "Road Blocked", "d", "red", "mk:roadblock", "road blocked closure"],
  ["accident", "Road Accident", "d", "red", "mk:road-accident", "crash collision"],
  ["noentry", "No Entry", "d", "red", "tk:x_oblique", "closed no entry"],
]);
add("haz", "Spill control actions", [
  ["absorb", "Absorb", "d", "teal", T("ABSRB"), "spill"],
  ["dike", "Dike", "d", "teal", T("DIKE"), "spill containment"],
  ["dam", "Dam", "d", "teal", T("DAM"), "spill containment"],
  ["divert", "Divert", "d", "teal", T("DIVRT"), "spill"],
  ["foam", "Foam", "d", "teal", T("FOAM"), "fire spill"],
  ["decon", "Decontamination", "d", "teal", T("DECON"), "decontamination wash"],
]);

/* ---------- Responders and medical ---------- */
add("resp", "Medical", [
  ["hospital", "Hospital", "c", "red", "mk:hospital", "medical"],
  ["doctor", "Doctor or Clinic", "c", "red", "mk:doctor", "medical clinic"],
  ["pharmacy", "Pharmacy", "c", "red", "mk:pharmacy", "medical drugs"],
  ["aed", "Defibrillator (AED)", "c", "red", "mk:defibrillator", "aed medical"],
  ["blood", "Blood Bank", "c", "red", "mk:blood-bank", "blood medical"],
  ["ccp", "Casualty Collection Point", "c", "red", T("CCP"), "casualty medical"],
  ["triage", "Triage Area", "c", "red", T("TRI"), "triage medical"],
  ["treat", "Treatment Area", "c", "red", T("TX"), "treatment medical"],
  ["transport", "Transport Area", "c", "red", T("TR"), "transport medical ambulance"],
  ["als", "Advanced Life Support", "c", "red", T("ALS"), "ambulance paramedic"],
  ["bls", "Basic Life Support", "c", "red", T("BLS"), "ambulance emt"],
  ["amb", "Ambulance", "c", "red", T("AMB"), "ambulance ems"],
  ["firstaid", "First Aid", "c", "red", T("FA"), "first aid"],
  ["morgue", "Temporary Morgue", "c", "black", T("MORG"), "morgue fatality"],
]);
add("resp", "Fire, police and rescue", [
  ["fire-stn", "Fire Station", "c", "red", "mk:fire-station", "fire"],
  ["hydrant", "Fire Hydrant", "c", "red", "tk:fire_hydrant", "fire water"],
  ["engine", "Fire Engine", "c", "red", T("ENG"), "fire engine"],
  ["police", "Police", "c", "blue", "mk:police", "police law"],
  ["officer", "Police Officer", "c", "blue", "tk:police_officer", "police law"],
  ["police-cp", "Police Checkpoint", "c", "blue", "tk:police_checkpoint", "checkpoint police"],
  ["checkpoint", "Checkpoint", "c", "blue", "tk:checkpoint", "checkpoint"],
  ["mil-cp", "Military Checkpoint", "c", "grey", "tk:military_checkpoint", "checkpoint military"],
  ["border", "Border or Passport Control", "c", "grey", "tk:passport_checkpoint", "border customs"],
  ["prison", "Prison", "c", "grey", "mk:prison", "prison jail"],
  ["sar", "Search and Rescue", "c", "orange", T("SAR"), "search rescue"],
  ["usar", "Urban Search and Rescue", "c", "orange", T("USAR"), "search rescue collapse"],
  ["k9", "K9 Unit", "c", "orange", T("K9"), "dog"],
  ["hazmat-t", "HazMat Team", "c", "orange", T("HM"), "hazmat"],
  ["eod", "Bomb Disposal (EOD)", "c", "orange", T("EOD"), "bomb explosive"],
  ["ranger", "Ranger Station", "c", "green", "mk:ranger-station", "ranger park"],
  ["sos", "Emergency Phone", "c", "orange", "mk:emergency-phone", "phone sos"],
  ["camera", "Security Camera", "c", "grey", "tk:security_camera", "cctv"],
]);
add("resp", "People", [
  ["civ", "Civilians", "c", "purple", T("CIV"), "civilian public"],
  ["missing", "Missing Person (last seen)", "c", "purple", T("LKP"), "missing person last known"],
  ["victim", "Casualty or Victim", "c", "purple", T("VIC"), "casualty"],
  ["access", "Accessible Facility", "c", "purple", "mk:wheelchair", "wheelchair disabled"],
  ["social", "Social Facility", "c", "purple", "tk:social_facility", "welfare"],
  ["embassy", "Embassy or Consulate", "c", "navy", "mk:embassy", "embassy consulate"],
]);

/* ---------- Air operations ---------- */
add("air", "Landing and drop sites", [
  ["hlz", "Helicopter Landing Zone", "b", "teal", T("HLZ"), "helicopter landing zone"],
  ["lz", "Landing Zone", "b", "teal", T("LZ"), "landing zone"],
  ["pz", "Pickup Zone", "b", "teal", T("PZ"), "pickup zone"],
  ["dz", "Drop Zone", "b", "teal", T("DZ"), "drop zone parachute"],
  ["farp", "Forward Arming and Refuelling Point", "b", "teal", T("FARP"), "fuel refuel"],
  ["dip", "Water Dip Site", "b", "blue", T("DIP"), "water helicopter bucket"],
  ["heliport", "Heliport", "c", "teal", "mk:heliport", "helicopter"],
  ["airport", "Airport", "c", "teal", "mk:airport", "aeroplane"],
  ["airfield", "Airfield", "c", "teal", "mk:airfield", "airstrip"],
  ["hangar", "Hangar", "c", "teal", "tk:hangar", "aircraft"],
  ["windsock", "Windsock", "c", "teal", "tk:windsock", "wind"],
]);
add("air", "Aircraft and airspace", [
  ["plane", "Aircraft", "c", "navy", "tk:planes", "aeroplane"],
  ["jet", "Fast Jet", "c", "navy", "tk:fighter_jet", "fighter jet"],
  ["jet-front", "Jet (front view)", "c", "navy", "tk:jetplane_front", "jet"],
  ["taxi", "Aircraft Taxiing", "c", "navy", "tk:plane_taxiing", "taxi"],
  ["uas", "Drone (UAS)", "c", "navy", T("UAS"), "drone uav"],
  ["balloon", "Balloon", "c", "navy", "tk:balloon", "balloon"],
  ["glider", "Hang Glider", "c", "navy", "tk:hang_gliding", "glider"],
  ["rocket", "Rocket or Launch Site", "c", "navy", "mk:rocket", "rocket launch"],
  ["tfr", "Temporary Flight Restriction", "b", "red", T("TFR"), "airspace restriction"],
  ["nfz", "No-Fly Zone", "b", "red", T("NFZ"), "airspace restriction"],
  ["atc", "Air Traffic Control", "b", "navy", T("ATC"), "control tower"],
  ["crash", "Aircraft Crash Site", "b", "red", T("CRASH"), "crash accident"],
  ["elt", "Emergency Locator Beacon", "b", "red", T("ELT"), "beacon distress"],
]);

/* ---------- Field and navigation ---------- */
add("nav", "Field points", [
  ["wp", "Waypoint", "c", "black", T("WP"), "waypoint"],
  ["rv", "Rendezvous", "c", "black", T("RV"), "rendezvous meet"],
  ["op", "Observation Post", "c", "black", T("OP"), "observation"],
  ["orp", "Objective Rally Point", "c", "black", T("ORP"), "rally"],
  ["lup", "Lay-up Point", "c", "black", T("LUP"), "hide"],
  ["cache", "Cache", "c", "black", T("CACHE"), "cache"],
  ["obj", "Objective", "c", "black", T("OBJ"), "objective"],
  ["start", "Start Point", "c", "green", T("SP"), "start"],
  ["release", "Release Point", "c", "red", T("RLP"), "release"],
  ["ckp", "Check Point", "c", "black", T("CKP"), "checkpoint"],
  ["poi", "Point of Interest", "c", "black", T("POI"), "interest"],
  ["unknown", "Unknown", "c", "grey", T("?"), "unknown question"],
]);
add("nav", "Ground and terrain", [
  ["viewpoint", "Viewpoint", "c", "brown", "mk:viewpoint", "view"],
  ["binos", "Observation", "c", "brown", "tk:binoculars", "binoculars observe"],
  ["scope", "Spotting Scope", "c", "brown", "tk:spotting_scope", "scope"],
  ["compass", "Compass", "c", "brown", "tk:compass", "navigation"],
  ["cairn", "Cairn or Marker", "c", "brown", "tk:cairn", "marker"],
  ["benchmark", "Survey Benchmark", "c", "brown", "tk:benchmark_disk", "survey"],
  ["summit", "Summit", "c", "brown", "mk:mountain", "mountain peak"],
  ["ridge", "Mountain Range", "c", "brown", "tk:mountain_range", "ridge"],
  ["valley", "Valley", "c", "brown", "tk:valley", "valley"],
  ["cliff", "Cliff", "c", "brown", "tk:cliff_falling_rocks", "cliff"],
  ["cave", "Cave or Adit", "c", "brown", "tk:adit_profile", "cave mine"],
  ["swamp", "Swamp", "c", "green", "tk:swamp", "marsh wetland"],
  ["waterfall", "Waterfall", "c", "blue", "mk:waterfall", "water"],
  ["water", "Water Source", "c", "blue", "mk:drinking-water", "water drinking"],
  ["well", "Well", "c", "blue", "tk:well_pump_manual", "water well"],
  ["bridge", "Bridge", "c", "grey", "mk:bridge", "crossing"],
  ["tunnel", "Tunnel", "c", "grey", "mk:tunnel", "tunnel"],
  ["gate", "Gate", "c", "grey", "mk:gate", "gate"],
  ["fence", "Fence", "c", "grey", "mk:fence", "fence barrier"],
  ["trench", "Trench", "c", "grey", "tk:trench", "trench"],
  ["bunker", "Bunker", "c", "grey", "tk:bunker", "bunker"],
  ["tents", "Tents", "c", "green", "tk:tents", "camp"],
  ["campfire", "Campfire", "c", "orange", "tk:campfire", "fire"],
  ["vehicle", "Vehicle", "c", "grey", "mk:car", "car"],
  ["truck", "Truck", "c", "grey", "tk:truck", "lorry"],
  ["boat", "Boat", "c", "blue", "tk:boat", "boat"],
  ["anchor", "Anchorage", "c", "blue", "mk:harbor", "harbour anchor"],
  ["slipway", "Boat Ramp", "c", "blue", "mk:slipway", "ramp"],
]);

/* ---------- Places (OpenStreetMap-style): every Maki and Temaki icon not already above, grouped by theme ---------- */
// left out: icons with no use for an analyst's field mark (cosmetics, games, fashion and similar)
const SKIP = /^(lipstick|perfume|polished_nail|tattoo|bikini|tanning|vending_venus|vending_love|psychic|karaoke|nightclub|beauty_salon|hair_care|hairdresser|jewelry|fashion|gown|dress|handbag|cushion|curtains|table_soccer|shuffleboard|pickleball|dice|casino|gaming|bowling|maze|roller_coaster|amusement|playhouse|play_structure|trampoline|seesaw|spring_rider|slide|swing|sandbox|splash_pad|balance_beam|horizontal_bar|climbing_frame|lounger|lounging|tiling|vase|chocolate|donut|bubble_tea|ice-cream|vending_ice_cream|confectionery|crossing_markings|kerb-|speedway|racetrack_oval|golf_green|golf_cart|disc_golf|american-football|baseball|basketball|volleyball|table-tennis|tennis|cricket|soccer|field_hockey|archery|bow_and_arrow|temaki|bank-JP|castle-JP|cemetery-JP|college-JP|ferry-JP|fire-station-JP|hospital-JP|landmark-JP|lighthouse-JP|monument-JP|police-JP|post-JP|school-JP|circle|circle-stroked|square|square-stroked|triangle|triangle-stroked|star|star-stroked|diamond|marker|marker-stroked|pin|arrow|vertex)/;
const THEMES = [
  ["Emergency, health and safety", /hospital|doctor|dentist|pharm|defib|blood|veterin|fire|police|ranger|emergency|shield|security|lifeguard|first|medic|physio|hearing|wheelchair|accessible|social|shelter|prison|courthouse|danger|caution|radiation|checkpoint/],
  ["Government and military", /military|army|bunker|town-hall|town_hall|capitol|embassy|post|letter|stamp|passport|courthouse|lawyer|flag|obelisk|monument|landmark|historic|castle|ruins|plaque|statue/],
  ["Transport", /air|plane|heli|jet|rail|train|tram|subway|metro|bus|taxi|car|ferry|boat|harbor|slipway|quay|pier|bicycle|cycl|motorcycle|scooter|fuel|charging|parking|road|bridge|tunnel|toll|traffic|crossing|junction|gate|bollard|barrier|lift|gondola|aerialway|chairlift|transit|board_|truck|freight|wheel|tire|monorail|trolley|speed|chicane|height|yield|stop|cattle|guard|rumble|spike|lane|striped|entrance|elevator|conveyor|camper|junk_car|golf/],
  ["Power, water and comms", /power|cable|gas|water|well|pump|pipe|oil|propane|storage|tank|silo|tower|mast|antenna|radio|telephone|phone|communication|windmill|wind|watermill|dam|manhole|meter|shutoff|device|utility|street_lamp|bulb|waste|recycl|cooling|industry|warehouse|construction|crane|scaffold|bulldozer|logging|slaughter|chimney|mine|adit|vacuum|toilet|latrine|shower|laundry|sink/],
  ["Religion", /religious|place-of-worship|cemetery|hinduism|shinto|sikhism|taoism|quakerism|paifang|marae/],
  ["Food, shops and services", /restaurant|cafe|bar\b|beer|alcohol|fast-food|bakery|bread|grocery|shop|store|convenience|market|commercial|bank|atm|money|lodging|hotel|hostel|catering|food|drink|coffee|tea|meat|egg|milk|vending|hotpot|sandwich|noodle|pizza|sushi|seafood|bbq|clothing|shoe|footwear|furniture|hardware|florist|gift|optician|watch|paint|laundry|car-rental|car-repair|repair|rental|real_estate|accounting|briefcase|suitcase|ticket|library|book|school|college|museum|theatre|cinema|art|music|post_box|poster|billboard/],
  ["Nature and terrain", /mountain|volcano|natural|park|garden|tree|shrub|grass|lawn|hedge|plant|wetland|swamp|beach|islet|island|cape|valley|cliff|cave|waterfall|hot-spring|geyser|coral|boulder|cairn|farm|barn|horse|dog|zoo|animal|aquarium|fish|whale|snow|landuse|viewpoint|picnic|campsite|campfire|tent|cabin|hut|shelter/],
  ["Buildings and places", /building|home|residential|row_houses|manufactured|houseboat|room|window|city|town|village|globe|stadium|pitch|sport|gym|fitness|swimming|skiing|skating|climbing|abseiling|diving|kayak|canoe|rafting|surf|sail|jet_skiing|waterski|wind_surfing|fishing|hunting|horse|golf|racetrack|skate|bleachers|playground|attraction|information|info|bench|fountain|toilet|clock/],
];
const THEME_COL = { "Emergency, health and safety": "red", "Government and military": "navy", Transport: "blue", "Power, water and comms": "teal", Religion: "purple",
  "Food, shops and services": "orange", "Nature and terrain": "green", "Buildings and places": "brown" };
const used = new Set(I.map((x) => x[5]));
const placeEntries = [];
function nice(n) { return n.replace(/[-_]+/g, " ").replace(/\b(alt\d|\d)$/, "").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()); }
for (const [pre, all] of [["mk", makiAll], ["tk", temakiAll]]) {
  for (const n of all) {
    const ref = pre + ":" + n;
    if (SKIP.test(n) || used.has(ref)) continue;
    const th = (THEMES.find((t) => t[1].test(n)) || ["Other"])[0];
    const key = (pre === "mk" ? "m-" : "t-") + n.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    placeEntries.push([th, [key, nice(n), "o", THEME_COL[th] || "grey", ref, n.replace(/[-_]+/g, " ")]]);
  }
}
const ORDER = THEMES.map((t) => t[0]).concat(["Other"]);
for (const th of ORDER) {
  const rows = placeEntries.filter((e) => e[0] === th).map((e) => e[1]).sort((a, b) => a[1].localeCompare(b[1]));
  // dedupe same display name (Maki and Temaki both draw "Bus"): keep the first
  const names = new Set(), keep = [];
  for (const r of rows) { const k = r[1].toLowerCase(); if (names.has(k)) { r[1] = r[1] + " (alt)"; } names.add(r[1].toLowerCase()); keep.push(r); }
  if (keep.length) add("osm", th, keep);
}

const PALS = [
  ["inc", "Incident command", "Command posts, staging, bases and work areas (ICS terms)"],
  ["haz", "Hazards", "Explosive, CBRN, fire, weather and ground hazards, spill actions"],
  ["resp", "Responders and medical", "Medical, fire, police, rescue and people"],
  ["air", "Air operations", "Landing and drop zones, aircraft and airspace"],
  ["nav", "Field and navigation", "Waypoints, rendezvous, observation and terrain"],
  ["osm", "Places (OpenStreetMap style)", "Map icons for places and features, by theme"],
];
const out = { v: "1", src: "Maki 8.2.0 (Mapbox) and Temaki 5.13.0, both CC0-1.0 public domain; lettered badges are OSAP's own", pals: PALS, g: G, i: I };
const js = "/* AXIOM OSAP marker palettes for the analyst's own map points. Built by tools/build_icon_palettes.mjs; do not edit by hand.\n" +
  "   Pictures: Maki 8.2.0 (Mapbox) and Temaki 5.13.0 (rapideditor), both CC0-1.0 public domain. Lettered badges: OSAP's own. */\n" +
  "window.OSAP_ICONS=" + JSON.stringify(out) + ";\n";
fs.writeFileSync(new URL("../assets/osap-icons-cat.js", import.meta.url), js);
const by = {}; I.forEach((x) => { by[x[1]] = (by[x[1]] || 0) + 1; });
console.log("icons", I.length, by, "glyphs", Object.keys(G).length, "bytes", js.length);
