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
  i_nuclear:  [N, "20", "1205010305", "Nuclear power plant (atomic energy reactor)", "Infrastructure"]
};

// the user-chosen sides (assets/osap-sides.js): side letter -> [2525D identity, plain words]. Unknown is the base symbol.
const SIDES = { f: ["3", "friend"], a: ["2", "assumed friend"], n: ["4", "neutral"], s: ["5", "suspect"], h: ["6", "hostile"] };
for (const k of ["ms_air", "ms_naval", "ms_depot", "milbase"]) {
  const d = DEFS[k];
  for (const [c, v] of Object.entries(SIDES)) DEFS[k + "_" + c] = [v[0], d[1], d[2], d[3] + ", in a country you marked " + v[1], "Military sites (your country sides)"];
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
      c.drawImage(im, p.x - d[3] * sc, p.y - d[4] * sc, d[1] * sc, d[2] * sc);
      if (!o.badge) return;
      var r = Math.max(3, 4.5 * sc), x = p.x + (d[1] - d[3]) * sc - r * 0.5, y = p.y + (d[2] - d[4]) * sc - r * 0.5;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = o.badge; c.fill(); c.lineWidth = 1.5; c.strokeStyle = "#fff"; c.stroke();
    }
  });
  S.mark = function (ll, k, o) { return new Mark(ll, L.extend({ sym: k, stroke: false, fill: true }, o || {})); };
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
