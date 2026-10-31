// Builds assets/osap-symbols.js: the map's military-style symbols (NATO APP-6 / MIL-STD-2525D),
// drawn once here with milsymbol (MIT, https://github.com/spatialillusions/milsymbol) and shipped
// as plain SVG strings, so the page loads no symbol library at all.
//
//   npm install --no-save milsymbol@3.0.4     (or MILSYMBOL=/path/to/milsymbol.js)
//   node tools/build_symbols.mjs
//
// Affiliation rule: OSAP shows reports, not judgements, so no symbol uses the hostile or friendly frame by itself.
// Actors, military sites and security incidents use the UNKNOWN frame (yellow); civilian facilities use
// the NEUTRAL frame (green); map graphics such as key terrain and checkpoints have no frame.
// The one exception is the user's own choice: Country sides (assets/osap-sides.js) lets a user mark a country
// friend, hostile and so on, on their device only. For that, the military site symbols below are also drawn in
// every other frame (keys "<key>_<side>", see SIDES), and a site takes the frame of the side marked for its country.
// Hospitals are not drawn here: they keep the red cross.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ms = require(process.env.MILSYMBOL || "milsymbol");

// SIDC (2525D number form): 10 version, 0 reality, identity, symbol set, status, HQ/TF, echelon, entity(6), modifiers(4)
const U = "1", N = "4";
// entity is 6 digits, or 10 with the two sector modifiers (e.g. "1205010600" electric power, coal)
function sidc(id, set, entity) { return "100" + id + set + "0000" + entity + (entity.length === 10 ? "" : "0000"); }
// key: [identity, symbol set, entity, plain-words label, legend group, extra milsymbol options]
const DEFS = {
  // incidents on the Thai-Cambodian border (security incident layer)
  clash:      [U, "40", "110400", "Armed clash (shooting)", "Incidents"],
  strike:     [U, "40", "110600", "Air or artillery strike (explosion)", "Incidents"],
  landmine:   [U, "40", "110603", "Landmine explosion", "Incidents"],
  standoff:   [U, "25", "160205", "Standoff or fortified position (outpost)", "Incidents"],
  occupation: [U, "10", "121100", "Territorial control (troops holding ground)", "Incidents"],
  civilian:   [U, "20", "111901", "Civilian harm or displacement", "Incidents"],
  maritime:   [U, "40", "160200", "Maritime incident", "Incidents"],
  diplomatic: [U, "40", "131000", "Diplomatic meeting", "Incidents"],
  // places
  milbase:    [U, "20", "120802", "Military base or area", "Places"],
  school:     [N, "20", "120402", "School", "Places"],
  power:      [N, "20", "120501", "Power site", "Places"],
  govt:       [N, "20", "120600", "Embassy or government site", "Places"],
  airport:    [N, "20", "121301", "Airport or air base", "Places"],
  seaport:    [N, "20", "121309", "Seaport or naval base", "Places"],
  // military sites on the conflict tabs (Wikidata, OpenStreetMap; always unknown frame: a source's record, not a judgement)
  ms_air:     [U, "20", "121301", "Military airfield or air base", "Military sites"],
  ms_naval:   [U, "20", "121309", "Naval base", "Military sites"],
  ms_depot:   [U, "20", "120801", "Depot, arsenal or ammunition store", "Military sites"],
  // map graphics
  crossing:   [U, "25", "130300", "Border crossing (checkpoint)", "Map graphics"],
  keyterrain: [U, "25", "132100", "Key terrain (hill, pass, river, reef); a number is the hill's name", "Map graphics"],
  fp_active:  [U, "25", "131300", "Flashpoint: armed incident in the last 90 days", "Map graphics", { monoColor: "#c62828" }],
  fp_elevated:[U, "25", "131300", "Flashpoint: incident in 18 months, or troops face to face", "Map graphics", { monoColor: "#ef6c00" }],
  fp_latent:  [U, "25", "131300", "Flashpoint: dispute with little recent violence", "Map graphics", { monoColor: "#b8860b" }],
  // reported foreign presence (always unknown frame: reported, not verified)
  pr_site:    [U, "20", "120800", "Reported occupied or controlled feature", "Reported presence"],
  pr_commerce:[U, "20", "120300", "Reported foreign-linked business, loan or investment", "Reported presence"],
  pr_telecom: [U, "20", "121202", "Reported foreign-linked telecoms site", "Reported presence"],
  pr_spy:     [U, "40", "130600", "Reported espionage case", "Reported presence"],
  pr_patrol:  [U, "30", "120500", "Reported patrol vessel", "Reported presence"],
  pr_fishing: [U, "30", "140200", "Reported militia or fishing fleet", "Reported presence"],
  pr_research:[U, "30", "130105", "Reported research ship", "Reported presence"],
  pr_drone:   [U, "30", "120700", "Drone recovered at sea", "Reported presence"],
  // global Chinese presence layer (tools/refresh_cnpresence.mjs): PRC-funded projects, PRC-linked listed companies, Chinese-run ports
  pr_port:    [U, "20", "121309", "Reported Chinese-run or Chinese-funded port or terminal", "Reported presence"],
  pr_power:   [U, "20", "120501", "Reported Chinese-funded power or energy project", "Reported presence"],
  pr_transport:[U, "20", "121300", "Reported Chinese-funded road, rail, bridge or airport project", "Reported presence"],
  pr_listed:  [U, "20", "120300", "Company on a U.S. restricted list with a Chinese address", "Reported presence"],
  // live aircraft (ADS-B positions the aircraft broadcast; unknown frame: a position report, not an identification)
  air_uav:    [U, "01", "110300", "Drone (unmanned aircraft), live ADS-B position", "Live aircraft"],
  air_fw:     [U, "01", "110100", "Military aircraft (fixed wing), live ADS-B position", "Live aircraft"],
  air_rw:     [U, "01", "110200", "Military helicopter, live ADS-B position", "Live aircraft"],
  // infrastructure sites (Map overlays > Infrastructure: assets/osap-infra.js, osap-dc.js, osap-power.js); civilian
  // facilities, so the neutral frame; 2525D land installation entities, with the electric power and telecoms modifiers
  i_air:      [N, "20", "121301", "Airport or airstrip", "Infrastructure"],
  i_heli:     [N, "20", "121305", "Heliport (helicopter landing site)", "Infrastructure"],
  i_port:     [N, "20", "121309", "Seaport or harbour", "Infrastructure"],
  i_ferry:    [N, "20", "121304", "Ferry terminal", "Infrastructure"],
  i_dam:      [N, "20", "121402", "Dam", "Infrastructure"],
  i_rail:     [N, "20", "121307", "Railway station", "Infrastructure"],
  i_bridge:   [N, "20", "110701", "Bridge", "Infrastructure"],
  i_tunnel:   [N, "20", "121313", "Tunnel", "Infrastructure"],
  i_watert:   [N, "20", "121411", "Water treatment works", "Infrastructure"],
  i_water:    [N, "20", "121410", "Desalination plant (water supply)", "Infrastructure"],
  i_sewage:   [N, "20", "121409", "Sewage works (wastewater treatment)", "Infrastructure"],
  i_telecom:  [N, "20", "121202", "Telecommunications site", "Infrastructure"],
  i_phone:    [N, "20", "1212021200", "Telephone exchange (civilian telephone)", "Infrastructure"],
  i_data:     [N, "20", "1212021400", "Data centre (telecoms, cyberspace)", "Infrastructure"],
  i_gov:      [N, "20", "120600", "Government site", "Infrastructure"],
  i_govlead:  [N, "20", "110900", "Government leadership", "Infrastructure"],
  i_prison:   [N, "20", "112108", "Prison", "Infrastructure"],
  i_customs:  [N, "20", "112103", "Border crossing (customs)", "Infrastructure"],
  i_police:   [N, "20", "112107", "Police station", "Infrastructure"],
  i_fire:     [N, "20", "112201", "Fire station", "Infrastructure"],
  i_petrol:   [N, "20", "120504", "Oil refinery (petroleum facility)", "Infrastructure"],
  i_natgas:   [N, "20", "120503", "LNG or gas terminal (natural gas facility)", "Infrastructure"],
  i_pol:      [N, "20", "120505", "Fuel depot or oil and gas site", "Infrastructure"],
  i_power:    [N, "20", "120501", "Electric power site (substation)", "Infrastructure"],
  i_gen:      [N, "20", "120502", "Power plant (generation station)", "Infrastructure"],
  i_coal:     [N, "20", "1205010600", "Coal power plant", "Infrastructure"],
  i_geo:      [N, "20", "1205010700", "Geothermal power plant", "Infrastructure"],
  i_hydro:    [N, "20", "1205010800", "Hydroelectric power plant", "Infrastructure"],
  i_gas:      [N, "20", "1205010900", "Gas power plant", "Infrastructure"],
  i_oil:      [N, "20", "1205011000", "Oil power plant", "Infrastructure"],
  i_nuclear:  [N, "20", "1205010305", "Nuclear power plant (atomic energy reactor)", "Infrastructure"],
  i_tower:    [N, "20", "121203", "Telecommunications tower (mast)", "Infrastructure"],
  // reports and events (records, hazards, conflict events): 2525D activities, unknown frame (a source's report, not a judgement)
  a_incident: [U, "40", "110000", "Incident (report)", "Reports and events"],
  a_crime:    [U, "40", "110100", "Crime", "Reports and events"],
  a_arrest:   [U, "40", "110101", "Arrest", "Reports and events"],
  a_arson:    [U, "40", "110102", "Arson", "Reports and events"],
  a_killing:  [U, "40", "110108", "Killing", "Reports and events"],
  a_riot:     [U, "40", "110110", "Riot", "Reports and events"],
  a_robbery:  [U, "40", "110116", "Robbery or piracy", "Reports and events"],
  a_theft:    [U, "40", "110117", "Theft", "Reports and events"],
  a_smuggling: [U, "40", "110119", "Smuggling", "Reports and events"],
  a_drug:     [U, "40", "110105", "Drug-related crime", "Reports and events"],
  a_traffick: [U, "40", "110501", "Trafficking", "Reports and events"],
  a_sabotage: [U, "40", "110122", "Sabotage", "Reports and events"],
  a_suspicious: [U, "40", "110123", "Suspicious activity", "Reports and events"],
  a_bomb:     [U, "40", "110200", "Bombing", "Reports and events"],
  a_bombthreat: [U, "40", "110201", "Bomb threat", "Reports and events"],
  a_ied:      [U, "40", "110301", "IED explosion", "Reports and events"],
  a_suicide:  [U, "40", "110304", "Suicide bombing", "Reports and events"],
  a_shooting: [U, "40", "110400", "Shooting or armed clash", "Reports and events"],
  a_sniping:  [U, "40", "110401", "Sniping", "Reports and events"],
  a_explosion: [U, "40", "110600", "Explosion or strike", "Reports and events"],
  a_grenade:  [U, "40", "110601", "Grenade attack", "Reports and events"],
  a_mine:     [U, "40", "110603", "Mine explosion", "Reports and events"],
  a_mortar:   [U, "40", "110604", "Mortar or shelling", "Reports and events"],
  a_rocket:   [U, "40", "110605", "Rocket or missile", "Reports and events"],
  a_disturb:  [U, "40", "120000", "Civil disturbance or unrest", "Reports and events"],
  a_demo:     [U, "40", "120100", "Protest or demonstration", "Reports and events"],
  a_patrol:   [U, "40", "130100", "Patrol", "Reports and events"],
  a_spy:      [U, "40", "130600", "Espionage", "Reports and events"],
  a_meeting:  [U, "40", "131000", "Meeting or talks", "Reports and events"],
  a_election: [U, "40", "131001", "Election", "Reports and events"],
  a_raid:     [U, "40", "131100", "Raid", "Reports and events"],
  a_emerg:    [U, "40", "131200", "Emergency operation", "Reports and events"],
  a_evac:     [U, "40", "131201", "Evacuation", "Reports and events"],
  a_shelter:  [U, "40", "131206", "Shelter or relief", "Reports and events"],
  a_lawenf:   [U, "40", "131500", "Law enforcement operation", "Reports and events"],
  a_operation: [U, "40", "130000", "Military operation or exercise", "Reports and events"],
  a_fire:     [U, "40", "140000", "Fire", "Reports and events"],
  a_wildfire: [U, "40", "140800", "Wildfire", "Reports and events"],
  a_hotspot:  [U, "40", "140300", "Fire hotspot (satellite)", "Reports and events"],
  a_hazmat:   [U, "40", "150100", "Hazardous materials", "Reports and events"],
  a_radio:    [U, "40", "150111", "Radioactive material", "Reports and events"],
  a_uxo:      [U, "40", "150115", "Unexploded ordnance", "Reports and events"],
  a_toxic:    [U, "40", "150113", "Toxic gas or air quality", "Reports and events"],
  a_air:      [U, "40", "160100", "Air incident", "Reports and events"],
  a_marine:   [U, "40", "160200", "Maritime incident or warning", "Reports and events"],
  a_rail:     [U, "40", "160300", "Rail incident", "Reports and events"],
  a_vehicle:  [U, "40", "160400", "Road incident", "Reports and events"],
  a_geo:      [U, "40", "170100", "Geological event", "Reports and events"],
  a_quake:    [U, "40", "170103", "Earthquake", "Reports and events"],
  a_landslide: [U, "40", "170104", "Landslide", "Reports and events"],
  a_avalanche: [U, "40", "170102", "Avalanche", "Reports and events"],
  a_volcano:  [U, "40", "170106", "Volcanic eruption", "Reports and events"],
  a_volcthreat: [U, "40", "170107", "Volcano (threat)", "Reports and events"],
  a_hydromet: [U, "40", "170200", "Storm or severe weather", "Reports and events"],
  a_drought:  [U, "40", "170201", "Drought", "Reports and events"],
  a_flood:    [U, "40", "170202", "Flood", "Reports and events"],
  a_tsunami:  [U, "40", "170203", "Tsunami", "Reports and events"],
  a_infest:   [U, "40", "170300", "Infestation", "Reports and events"],
  a_bird:     [U, "40", "170301", "Bird flu", "Reports and events"],
  a_microbe:  [U, "40", "170303", "Disease outbreak", "Reports and events"],
  // sensors (traffic and other cameras): 2525D sensor outpost, a map graphic with no frame
  g_sensor:   [U, "25", "160204", "Camera or sensor", "Map graphics"],
  g_poi:      [U, "25", "131300", "Point of interest (town or place)", "Map graphics"],
  ms_nuclear: [U, "20", "111500", "Nuclear site", "Military sites"],
  // planning and tool points (routes, evacuation and medical plans, line of sight, coverage checks): 2525D control measures
  g_start:    [U, "25", "131600", "Start point (plan or route origin)", "Map graphics"],
  g_waypoint: [U, "25", "131800", "Waypoint", "Map graphics"],
  g_release:  [U, "25", "131500", "Release point (route end)", "Map graphics"],
  g_check:    [U, "25", "130300", "Checkpoint", "Map graphics"],
  g_op:       [U, "25", "160100", "Observation post (line-of-sight observer)", "Map graphics"],
  g_medevac:  [U, "25", "321100", "MEDEVAC pick-up point (landing zone)", "Map graphics"],
  g_ccp:      [U, "25", "320500", "Casualty collection point", "Map graphics"],
  g_amb:      [U, "25", "320100", "Ambulance point (station)", "Map graphics"],
  g_axp:      [U, "25", "320101", "Ambulance exchange point", "Map graphics"],
  g_fuel:     [U, "25", "321703", "Fuel point (class III supply)", "Map graphics"],
  g_supply:   [U, "25", "321700", "Supply point", "Map graphics"],
  g_comcheck: [U, "25", "180200", "Communications checkpoint", "Map graphics"],
  // link analysis (assets/osap-analyst.js): organisations and units drawn as 2525D land units or land civilian
  // organisations. Armed and security bodies take the unknown frame like every other actor; civilian bodies the neutral frame.
  la_armed:   [U, "10", "121100", "Armed group or armed unit (infantry)", "Link analysis"],
  la_amphib:  [U, "10", "121101", "Marine or amphibious unit", "Link analysis"],
  la_c2:      [U, "10", "110000", "Command or headquarters (command and control)", "Link analysis"],
  la_security:[U, "10", "141700", "Security or defence volunteer force", "Link analysis"],
  la_police:  [U, "10", "200700", "Police", "Link analysis"],
  la_border:  [U, "10", "200200", "Border patrol or border agency", "Link analysis"],
  la_customs: [U, "10", "200300", "Customs service", "Link analysis"],
  la_group:   [U, "11", "110400", "Organisation or group, role not settled", "Link analysis"],
  la_person:  [U, "11", "110300", "Individual (sanctioned or charged only)", "Link analysis"],
  la_gov:     [N, "11", "110200", "Government body or civilian agency", "Link analysis"],
  la_org:     [N, "11", "110400", "Civilian organisation (monitor, researcher)", "Link analysis"],
  la_bomb:    [U, "40", "110606", "Incident: bombing or IED", "Link analysis"],
  la_shoot:   [U, "40", "110400", "Incident: shooting or armed attack", "Link analysis"],
  la_seize:   [U, "40", "131500", "Incident: seizure, arrest or raid (law enforcement operation)", "Link analysis"],
  la_place:   [U, "25", "131300", "District named in the same reports (point of interest)", "Link analysis", { monoColor: "#6d4c41" }]
};

// the user-chosen sides (assets/osap-sides.js): side letter -> [2525D identity, plain words]. Unknown is the base symbol.
const SIDES = { f: ["3", "friend"], a: ["2", "assumed friend"], n: ["4", "neutral"], s: ["5", "suspect"], h: ["6", "hostile"] };
for (const k of ["ms_air", "ms_naval", "ms_depot", "milbase"]) {
  const d = DEFS[k];
  for (const [c, v] of Object.entries(SIDES)) DEFS[k + "_" + c] = [v[0], d[1], d[2], d[3] + ", in a country you marked " + v[1], "Military sites (your country sides)"];
}
// the analyst's own designation on the link chart (assets/osap-analyst.js, owner-only): an entity the analyst marked takes
// that frame, e.g. red diamond for a body they marked hostile, blue rectangle for friend. Never set by OSAP.
for (const k of Object.keys(DEFS).filter((k) => /^la_/.test(k) && k !== "la_place")) {
  const d = DEFS[k];
  for (const [c, v] of Object.entries(SIDES)) DEFS[k + "_" + c] = [v[0], d[1], d[2], d[3] + ", marked " + v[1] + " by you", "Link analysis (your designation)"];
}

const out = {}, meta = {};
for (const [k, d] of Object.entries(DEFS)) {
  const code = sidc(d[0], d[1], d[2]);
  // drawn at a base of 24 px; the page scales it with the map zoom (CSS --msk), and SVG stays sharp at any size
  const s = new ms.Symbol(code, Object.assign({ size: 24, outlineWidth: 4, outlineColor: "#ffffff", strokeWidth: 4, simpleStatusModifier: true }, d[5] || {}));
  if (!s.isValid()) throw new Error("invalid symbol " + k + " " + code);
  const sz = s.getSize(), an = s.getAnchor();
  // no fixed width/height on the <svg>: it fills the box the page sizes
  const svg = s.asSVG().replace(/\s+/g, " ").replace(/ width="[\d.]+" height="[\d.]+"/, "");
  out[k] = [svg, +sz.width.toFixed(1), +sz.height.toFixed(1), +an.x.toFixed(1), +an.y.toFixed(1)];
  meta[k] = [d[3], code, d[4]];
}

const RUNTIME = `
  var S = window.OSAP_SYM;
  /* map icon: a zero-size L.divIcon on the point; the symbol box inside is sized from the base size times --msk
     (set on the map by zoom), and offset so the symbol's own anchor sits on the point. opts.text adds a label (hill number),
     opts.scale draws it smaller or larger (1 = base size). */
  function px(v) { return "calc(" + v + "px * var(--msk, 1))"; }
  S.icon = function (k, opts) {
    var o = opts || {}, sc = o.scale || 1, d = (S.d[k] || S.d.pr_site).map(function (v, j) { return j ? v * sc : v; }), lab = o.text ? '<span class="msym-t">' + String(o.text).replace(/[<>&"]/g, "") + "</span>" : "";
    return L.divIcon({ className: "msym msk-" + k + (o.cls ? " " + o.cls : ""), iconSize: [0, 0], iconAnchor: [0, 0],
      html: '<div class="msb" style="width:' + px(d[1]) + ";height:" + px(d[2]) + ";left:" + px(-d[3]) + ";top:" + px(-d[4]) + '">' + d[0] + lab + badge(o.badge) + "</div>" });
  };
  /* a labelled symbol for plan and tool points (route checkpoints, plan stops): S.tag(key, text, {cls, badge, scale}). The symbol is an
     image, so the marker's text is only its label (code and tests read it); cls keeps the module's own class for its clicks and checks. */
  var URI = {};
  S.uri = uri;
  function uri(k) { return URI[k] || (URI[k] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent((S.d[k] || S.d.pr_site)[0])); }
  S.tag = function (k, text, opts) {
    var o = opts || {}, sc = o.scale || 1, d = (S.d[k] || S.d.pr_site).map(function (v, j) { return j ? v * sc : v; }), t = text == null ? "" : String(text);
    return L.divIcon({ className: (o.cls ? o.cls + " " : "") + "msym msym-tag msk-" + k, iconSize: [0, 0], iconAnchor: [0, 0],
      html: '<div class="msb" style="width:' + px(d[1]) + ";height:" + px(d[2]) + ";left:" + px(-d[3]) + ";top:" + px(-d[4]) + '"><img alt="" src="' + uri(k) + '">' + badge(o.badge) + "</div>" +
        (t ? '<b class="msym-l" style="left:' + px(d[1] - d[3] + 2) + ";top:" + px(d[2] / 2 - d[4]) + '">' + t.replace(/[<>&"]/g, "") + "</b>" : "") });
  };
  /* a labelled facility from its words: hospitals, clinics and medical posts keep the red cross (window.OSAP_REDCROSS),
     anything else its installation symbol, or opts.def (a point of interest when none is given) */
  S.ptag = function (words, text, opts) {
    var o = opts || {}, w = [].concat(words).filter(Boolean).join(" "), t = text == null ? "" : String(text);
    if (/hospital|clinic|medical|\bmtf\b|first.aid/i.test(w) && window.OSAP_REDCROSS)
      return L.divIcon({ className: (o.cls ? o.cls + " " : "") + "msym msym-tag", iconSize: [0, 0], iconAnchor: [0, 0],
        html: '<span style="position:absolute;left:-8px;top:-8px;width:16px;height:16px;display:block">' + window.OSAP_REDCROSS(16) + "</span>" +
          (t ? '<b class="msym-l" style="left:10px;top:0">' + t.replace(/[<>&"]/g, "") + "</b>" : "") });
    return S.tag(S.siteOf(w) || o.def || "g_poi", t, o);
  };
  /* opts.badge: a small colour dot at the symbol's lower right (a power plant's fuel, a substation's voltage), in the map legend too */
  function badge(c) {
    return c && /^#[0-9a-f]{3,8}$/i.test(c) ? '<i style="position:absolute;right:-3px;bottom:-3px;width:' + px(9) + ";height:" + px(9) + ";border-radius:50%;background:" + c + ';border:1.5px solid #fff;box-shadow:0 0 1px #000"></i>' : "";
  }
  /* legend swatch: the symbol, with its badge when it has one */
  S.sw = function (k, c) { return '<span class="msw" style="position:relative">' + S.svg(k) + (c ? badge(c).replace(/calc\(9px \* var\(--msk, 1\)\)/g, "9px") : "") + "</span>"; };
  /* the same symbol on a shared Leaflet canvas, for layers with thousands of sites (one DOM icon each would freeze a phone).
     S.mark(latlng, key, opts): opts.scale is the size against the DOM icons (1 = the same) and follows the same zoom steps as --msk;
     opts.badge as above; other opts are Leaflet path options (renderer, pane, lgk...). Taps hit a circle round the symbol. */
  var IMG = {}, WAIT = {};
  function img(k) {
    var im = IMG[k]; if (im) return im;
    var d = S.d[k]; im = IMG[k] = new Image();
    im.onload = function () { im.ok = 1; var w = WAIT[k] || []; WAIT[k] = []; w.forEach(function (l) { if (l._map) l.redraw(); }); };
    im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(d[0].replace("<svg ", '<svg width="' + Math.round(d[1] * 3) + '" height="' + Math.round(d[2] * 3) + '" '));
    return im;
  }
  function zk(z) { return z <= 6 ? 0.65 : z <= 8 ? 0.8 : z <= 10 ? 1 : z <= 12 ? 1.15 : 1.3; }
  var Mark = window.L && L.CircleMarker.extend({
    _sc: function () { return (this.options.scale || 1) * zk(this._map ? this._map.getZoom() : 10); },
    _project: function () {
      var d = S.d[this.options.sym] || S.d.pr_site; this._radius = Math.max(d[1], d[2]) * this._sc() * 0.5;
      L.CircleMarker.prototype._project.call(this);
    },
    _updatePath: function () {
      var R = this._renderer; if (!R._drawing || this._empty()) return;
      var o = this.options, k = S.d[o.sym] ? o.sym : "pr_site", d = S.d[k], im = img(k), sc = this._sc(), p = this._point, c = R._ctx;
      if (!im.ok) { (WAIT[k] = WAIT[k] || []).push(this); return; }
      /* opts.opacity fades it (time playback, outside a drawn area = 0); a stroke of weight 3 or more is the selection ring;
         opts.dashArray (a claim, not confirmed) adds a thin dashed ring */
      var a = o.opacity == null ? 1 : o.opacity; if (a <= 0) return;
      c.save(); c.globalAlpha = a;
      c.drawImage(im, p.x - d[3] * sc, p.y - d[4] * sc, d[1] * sc, d[2] * sc);
      var rr = this._radius + 2;
      if ((o.weight || 0) >= 3 || o.dashArray) {
        c.beginPath(); c.arc(p.x, p.y, rr, 0, Math.PI * 2);
        c.setLineDash((o.weight || 0) >= 3 ? [] : [3, 3]); c.lineWidth = (o.weight || 0) >= 3 ? o.weight : 1.3;
        c.strokeStyle = (o.weight || 0) >= 3 ? o.color || "#111" : "#333"; c.stroke(); c.setLineDash([]);
      }
      if (o.badge) {
        var r = Math.max(3, 4.5 * sc), x = p.x + (d[1] - d[3]) * sc - r * 0.5, y = p.y + (d[2] - d[4]) * sc - r * 0.5;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = o.badge; c.fill(); c.lineWidth = 1.5; c.strokeStyle = "#fff"; c.stroke();
      }
      c.restore();
    }
  });
  /* the canvas for a pane, made once: a symbol needs a canvas renderer, whatever the map's default */
  var CANV = {};
  function canv(p) { p = p || "overlayPane"; return CANV[p] || (CANV[p] = L.canvas({ pane: p, padding: 0.3 })); }
  S.mark = function (ll, k, o) {
    o = L.extend({ sym: k, stroke: false, fill: true, weight: 0 }, o || {});
    if (!o.renderer || !o.renderer._ctx && !(o.renderer instanceof L.Canvas)) o.renderer = canv(o.pane);
    return new Mark(ll, o);
  };
  /* a record's symbol from its words (kind, category, title): the most specific 2525D activity that fits, else "incident" */
  var RX = [
    [/tsunami/i, "a_tsunami"], [/aftershock|earthquake|quake|tremor|seismic/i, "a_quake"], [/volcan|eruption|lava|ash ?fall/i, "a_volcano"],
    [/landslide|mudslide|rockfall|sinkhole/i, "a_landslide"], [/avalanche/i, "a_avalanche"], [/flood|inundat|river level|water level|dam burst|flash flood/i, "a_flood"],
    [/drought|water shortage/i, "a_drought"], [/typhoon|cyclone|hurricane|tropical (storm|depression)|storm|monsoon|heavy rain|rainfall|thunder|tornado|heatwave|heat wave|weather/i, "a_hydromet"],
    [/bird flu|avian/i, "a_bird"], [/outbreak|epidemic|pandemic|cholera|dengue|mpox|measles|ebola|marburg|anthrax|disease|virus|infect|malaria/i, "a_microbe"],
    [/locust|insect/i, "a_infest"], [/radioactiv|radiation|nuclear (leak|accident)/i, "a_radio"], [/unexploded|\\buxo\\b|ordnance found/i, "a_uxo"],
    [/air quality|\\bpm ?2\\.?5|\\bhaze|smog|toxic gas|gas leak/i, "a_toxic"], [/chemical|spill|hazardous material|hazmat/i, "a_hazmat"],
    [/hot ?spot|firms|thermal anomal/i, "a_hotspot"], [/wildfire|bushfire|forest fire|grass fire/i, "a_wildfire"],
    [/suicide (bomb|attack)/i, "a_suicide"], [/\\bied\\b|improvised explosive|roadside bomb|car bomb|vbied/i, "a_ied"], [/bomb threat|hoax/i, "a_bombthreat"],
    [/grenade/i, "a_grenade"], [/landmine|\\bmine (blast|explosion)|stepped on a mine/i, "a_mine"], [/mortar|shell(ing|ed)|artillery/i, "a_mortar"],
    [/rocket|missile/i, "a_rocket"], [/bomb|bombing/i, "a_bomb"], [/air ?strikes?|drone strikes?|missile strikes?|strikes? (on|against|hit)|explosion|blast|explod/i, "a_explosion"],
    [/sniper|sniping/i, "a_sniping"], [/shoot|shot|gunfire|gunmen|gunman|armed clash|clash|firefight|ambush|attack|insurgen|militant/i, "a_shooting"],
    [/murder|killed|killing|homicide|beheaded|massacre|dead body|body found/i, "a_killing"], [/arson|set (on )?fire|torched/i, "a_arson"],
    [/\\bfires?\\b|blaze|\\bburn/i, "a_fire"], [/riot|looting|\\bmobs?\\b/i, "a_riot"], [/protest|demonstrat|rally|rallies|strike action|general strike|labou?r strike|walkout|sit-in/i, "a_demo"],
    [/unrest|curfew|coup|martial law|tear gas|civil disturbance/i, "a_disturb"], [/election|ballot|polling|referendum|vote/i, "a_election"],
    [/sabotage/i, "a_sabotage"], [/spy|espionage/i, "a_spy"], [/\\braids?\\b|\\braided\\b/i, "a_raid"], [/arrest|detain|apprehend|custody|captured/i, "a_arrest"],
    [/traffick/i, "a_traffick"], [/drug|narcotic|\\bmeth\\b|heroin|cocaine|ya ba|kratom/i, "a_drug"], [/smuggl|contraband|illegal (fishing|logging|mining)/i, "a_smuggling"],
    [/pirac|pirate|robbery|robbed|armed robber/i, "a_robbery"], [/theft|stolen|burglar/i, "a_theft"], [/kidnap|abduct|hostage|extort|scam|fraud|crime|criminal|\\bgangs?\\b/i, "a_crime"],
    [/suspicious|sighting|drone (seen|sighted)/i, "a_suspicious"], [/plane|aircraft|airliner|helicopter|air crash|aviation/i, "a_air"],
    [/ship|vessel|boat|ferry|maritime|navigation warning|navarea|coast guard|fishing|\\bseas?\\b/i, "a_marine"], [/train|railway|rail /i, "a_rail"],
    [/road|traffic|crash|collision|accident|\\bbus(es)?\\b|truck|vehicle|highway|motorway|closure|closed/i, "a_vehicle"],
    [/evacuat/i, "a_evac"], [/shelter|relief|aid distribution|displaced|refugee/i, "a_shelter"], [/rescue|emergency/i, "a_emerg"],
    [/exercise|drill|deploy|troops|military|navy|army|patrol/i, "a_operation"], [/police|law enforcement|crackdown/i, "a_lawenf"],
    [/meeting|talks|summit|visit|diplomat|agreement|ceasefire/i, "a_meeting"]];
  /* a facility's symbol from its words (asset type, name): the 2525D installation that fits, else null (callers keep their own) */
  var SX = [[/airport|airfield|air ?base|airstrip/i, "i_air"], [/heli(port|pad)/i, "i_heli"], [/ferry/i, "i_ferry"], [/sea ?port|harbou?r|\\bport\\b|naval base|jetty|pier/i, "i_port"],
    [/\\bdams?\\b|reservoir|weir/i, "i_dam"], [/rail|station/i, "i_rail"], [/bridge/i, "i_bridge"], [/tunnel/i, "i_tunnel"], [/desal/i, "i_water"],
    [/sewage|wastewater/i, "i_sewage"], [/water/i, "i_watert"], [/data ?cent/i, "i_data"], [/exchange|telephone/i, "i_phone"], [/mast|tower|antenna/i, "i_tower"],
    [/telecom|cable|internet|radio|broadcast/i, "i_telecom"], [/refiner/i, "i_petrol"], [/\\blng\\b|gas terminal|gas plant/i, "i_natgas"], [/fuel|oil|petrol|depot|pipeline/i, "i_pol"],
    [/nuclear/i, "i_nuclear"], [/coal/i, "i_coal"], [/hydro/i, "i_hydro"], [/substation|grid|transmission/i, "i_power"], [/power|plant|generat|solar|wind/i, "i_gen"],
    [/prison|jail|detention/i, "i_prison"], [/border|checkpoint|customs/i, "i_customs"], [/police/i, "i_police"], [/fire station/i, "i_fire"],
    [/parliament|ministry|government|palace|court|city hall|provincial hall/i, "i_gov"], [/school|university|college/i, "school"], [/military|army|camp|barracks/i, "milbase"]];
  S.siteOf = function () {
    var t = Array.prototype.slice.call(arguments).filter(Boolean).join(" ");
    for (var i = 0; i < SX.length; i++) if (SX[i][0].test(t)) return SX[i][1];
    return null;
  };
  S.classify = function () {
    var t = Array.prototype.slice.call(arguments).filter(Boolean).join(" ");
    for (var i = 0; i < RX.length; i++) if (RX[i][0].test(t)) return RX[i][1];
    return "a_incident";
  };
  S.svg = function (k) { return (S.d[k] || S.d.pr_site)[0]; };
  /* legend rows for the given keys, in plain words, grouped; the frame key comes first */
  S.legend = function (keys) {
    var g = {}, order = [];
    keys.forEach(function (k) { var m = S.m[k]; if (!m) return; if (!g[m[2]]) { g[m[2]] = []; order.push(m[2]); } g[m[2]].push(k); });
    return order.map(function (n) {
      return '<div class="lgh">' + n + "</div>" + g[n].map(function (k) {
        return '<div class="lg msyml"><span class="msw">' + S.d[k][0] + "</span><div>" + S.m[k][0] + "</div></div>"; }).join("");
    }).join("");
  };
  S.frames = '<p class="msyfr">NATO-style map symbols (APP-6). <b>Yellow, four-lobed frame</b>: side not known or not verified. ' +
    '<b>Green square</b>: civilian facility. <b>Purple</b>: civilian boats. OSAP shows what sources report and never marks anyone as hostile or friendly. ' +
    'Blue, red or green frames on military sites appear only where you marked the country yourself (Country sides, in Layers), on this device.</p>';
`;

const body = "/* generated by tools/build_symbols.mjs from milsymbol " + (ms.version || "") + " (MIT); do not edit by hand */\n" +
  "window.OSAP_SYM = { d: " + JSON.stringify(out) + ",\n m: " + JSON.stringify(meta) + " };\n(function () {" + RUNTIME + "})();\n";
const dest = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "assets", "osap-symbols.js");
fs.writeFileSync(dest, body);
console.log("wrote", dest, body.length, "bytes,", Object.keys(out).length, "symbols");
