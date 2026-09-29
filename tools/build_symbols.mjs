// Builds assets/osap-symbols.js: the map's military-style symbols (NATO APP-6 / MIL-STD-2525D),
// drawn once here with milsymbol (MIT, https://github.com/spatialillusions/milsymbol) and shipped
// as plain SVG strings, so the page loads no symbol library at all.
//
//   npm install --no-save milsymbol@3.0.4     (or MILSYMBOL=/path/to/milsymbol.js)
//   node tools/build_symbols.mjs
//
// Affiliation rule: OSAP shows reports, not judgements, so no symbol uses the hostile or friendly frame.
// Actors, military sites and security incidents use the UNKNOWN frame (yellow); civilian facilities use
// the NEUTRAL frame (green); map graphics such as key terrain and checkpoints have no frame.
// Hospitals are not drawn here: they keep the red cross.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ms = require(process.env.MILSYMBOL || "milsymbol");

// SIDC (2525D number form): 10 version, 0 reality, identity, symbol set, status, HQ/TF, echelon, entity(6), modifiers(4)
const U = "1", N = "4";
function sidc(id, set, entity) { return "100" + id + set + "0000" + entity + "0000"; }
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
  air_rw:     [U, "01", "110200", "Military helicopter, live ADS-B position", "Live aircraft"]
};

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
     (set on the map by zoom), and offset so the symbol's own anchor sits on the point. opts.text adds a label (hill number). */
  function px(v) { return "calc(" + v + "px * var(--msk, 1))"; }
  S.icon = function (k, opts) {
    var d = S.d[k] || S.d.pr_site, o = opts || {}, lab = o.text ? '<span class="msym-t">' + String(o.text).replace(/[<>&"]/g, "") + "</span>" : "";
    return L.divIcon({ className: "msym msk-" + k + (o.cls ? " " + o.cls : ""), iconSize: [0, 0], iconAnchor: [0, 0],
      html: '<div class="msb" style="width:' + px(d[1]) + ";height:" + px(d[2]) + ";left:" + px(-d[3]) + ";top:" + px(-d[4]) + '">' + d[0] + lab + "</div>" });
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
    '<b>Green square</b>: civilian facility. <b>Purple</b>: civilian boats. OSAP shows what sources report and never marks anyone as hostile or friendly.</p>';
`;

const body = "/* generated by tools/build_symbols.mjs from milsymbol " + (ms.version || "") + " (MIT); do not edit by hand */\n" +
  "window.OSAP_SYM = { d: " + JSON.stringify(out) + ",\n m: " + JSON.stringify(meta) + " };\n(function () {" + RUNTIME + "})();\n";
const dest = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "assets", "osap-symbols.js");
fs.writeFileSync(dest, body);
console.log("wrote", dest, body.length, "bytes,", Object.keys(out).length, "symbols");
