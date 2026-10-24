/* AXIOM OSAP: TAK data package export, so plans, routes, landing zones and incidents open in ATAK and WinTAK (Shane 2026-10-24,
   "Do them all"). One tap makes one .zip in the TAK data package layout (MANIFEST/manifest.xml, MissionPackageManifest version 2):
   - every map point in the KML a tool already writes becomes its own CoT marker file (<uid>/<uid>.cot): a spot map marker
     (b-m-p-s-m) in the placemark's colour, or, for the analyst's own 2525D-symbol points, a unit marker typed from the SIDC
     (a-<identity>-<dimension>). Name goes to the callsign, the placemark description (source link, SHA-256 fingerprint,
     caveats) to the remarks. Each marker keeps <archive/> so ATAK and WinTAK keep it after a restart;
   - lines and areas stay in that tool's own KML, which goes in the package as an overlay (both clients import KML from a
     package). Points past MAX_COT stay in the KML too, so nothing is dropped;
   - marker uids are worked out from the package id, the name and the place, so sending an updated package again replaces the
     markers in ATAK instead of doubling them.
   Callers: Workspaces (My work), My work exports (incidents and reports with a location), Route tab, Evac packages, Med plan,
   Landing zones. Each passes the KML it already makes: window.OSAP_TAK.save({ id, name, kml, color, how, note }).
   Built in this browser with OSAP_WS.zip (assets/osap-ws.js); nothing is sent anywhere, no account or key. A package is the
   analyst's working copy of OSAP's records and plans, not evidence: the KML descriptions carry each item's source and caveats. */
(function () {
  "use strict";
  var W = window, D = W.document;
  var MAX_COT = 1000, MAX_REMARKS = 2000, STALE_DAYS = 365, UNK = "9999999.0";

  function xesc(s) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[<>&'"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]; }); }
  function unesc(s) {
    return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function (m, t) { return t; }).replace(/&(lt|gt|amp|apos|quot|#\d+|#x[0-9a-f]+);/gi, function (m, e) {
      var k = e.toLowerCase(); if (k[0] === "#") { var n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
      return { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' }[k];
    });
  }
  /* FNV-1a, 32-bit twice with different seeds: a stable uid from text (not a security hash) */
  function h32(s, seed) { var h = seed >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
  function hid(s) { return h32(s, 2166136261) + h32(s, 0x811c9dc5 ^ 0x5bd1e995); }
  function fname(n) { return String(n || "osap").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 48) || "osap"; }

  /* colours: KML aabbggrr, CSS #rrggbb, CoT a signed 32-bit ARGB integer */
  function argbOfKml(c) { var m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ""); return m ? (parseInt(m[1] + m[4] + m[3] + m[2], 16) | 0) : null; }
  function argbOfCss(c) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ""); return m ? (parseInt("ff" + m[1], 16) | 0) : null; }

  /* 2525D SIDC (20 digits) to a CoT type: standard identity (digit 4) and battle dimension from the symbol set (digits 5-6) */
  var AFF = { "0": "p", "1": "u", "2": "a", "3": "f", "4": "n", "5": "s", "6": "h" };
  var DIM = { "01": "A", "02": "A", "05": "P", "06": "P", "30": "S", "35": "U", "36": "U" };
  function sidcType(sidc) {
    if (!/^\d{20}$/.test(sidc || "")) return "";
    return "a-" + (AFF[sidc[3]] || "u") + "-" + (DIM[sidc.slice(4, 6)] || "G");
  }

  function tag(block, name) { var m = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i").exec(block); return m ? m[1] : null; }
  /* shared <Style id> colours, so a placemark with only a styleUrl still gets its colour */
  function styles(kml) {
    var o = {}, re = /<Style\s+id="([^"]+)"\s*>([\s\S]*?)<\/Style>/gi, m;
    while ((m = re.exec(kml))) { var ic = tag(m[2], "IconStyle"), c = ic && tag(ic, "color"); if (c) o[m[1]] = c.trim(); }
    return o;
  }
  /* one Placemark whose only geometry is a Point, or null */
  function pointOf(block, S) {
    if (/<(LineString|Polygon|MultiGeometry|LinearRing|gx:Track|Model)\b/i.test(block)) return null;
    var pt = tag(block, "Point"), co = pt && tag(pt, "coordinates"); if (!co) return null;
    var xy = co.trim().split(/[\s]+/)[0].split(","), lon = +xy[0], lat = +xy[1];
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    var st = tag(block, "Style"), ic = st && tag(st, "IconStyle"), col = ic && tag(ic, "color"), su = tag(block, "styleUrl");
    if (!col && su) col = S[su.trim().replace(/^#/, "")] || null;
    var sidc = /<Data\s+name="sidc"\s*>\s*<value>(\d{20})<\/value>/i.exec(block);
    var when = tag(block, "TimeStamp"); when = when && tag(when, "when");
    return { name: unesc(tag(block, "name") || "").trim(), remarks: unesc(tag(block, "description") || "").trim(), lat: lat, lon: lon, hae: isFinite(+xy[2]) && +xy[2] !== 0 ? +xy[2] : null,
      argb: col ? argbOfKml(col.trim()) : null, sidc: sidc ? sidc[1] : "", when: when ? unesc(when).trim() : "" };
  }

  function iso(t) { return new Date(t).toISOString().replace(/\.\d+Z$/, ".000Z"); }
  function cot(p, opt) {
    var now = opt.now || Date.now(), t = iso(now), stale = iso(now + STALE_DAYS * 864e5), ty = sidcType(p.sidc), argb = p.argb != null ? p.argb : opt.argb != null ? opt.argb : -1;
    var rem = p.remarks.length > MAX_REMARKS ? p.remarks.slice(0, MAX_REMARKS - 1) + "…" : p.remarks;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<event version="2.0" uid="' + xesc(p.uid) + '" type="' + (ty || "b-m-p-s-m") + '" time="' + t + '" start="' + t + '" stale="' + stale + '" how="' + xesc(opt.how || "h-e") + '">' +
      '<point lat="' + p.lat.toFixed(7) + '" lon="' + p.lon.toFixed(7) + '" hae="' + (p.hae != null ? p.hae.toFixed(1) : UNK) + '" ce="' + UNK + '" le="' + UNK + '"/>' +
      "<detail><status readiness=\"true\"/><archive/><contact callsign=\"" + xesc(p.name || "OSAP point") + '"/>' +
      (ty ? "" : '<color argb="' + argb + '"/><usericon iconsetpath="COT_MAPPING_SPOTMAP/b-m-p-s-m/' + argb + '"/>') +
      "<remarks>" + xesc(rem) + "</remarks>" +
      "</detail></event>\n";
  }

  /* the package as a list of zip entries: [{ name, data }] (the manifest first) and counts */
  function files(o) {
    o = o || {};
    var name = String(o.name || "OSAP package").slice(0, 80), id = String(o.id || name), pkg = "osap-dp-" + hid("pkg|" + id), kml = String(o.kml || "");
    if (/<!ENTITY/i.test(kml)) throw new Error("This KML declares entities, which OSAP does not accept.");
    var S = styles(kml), seen = {}, pts = [], kept = 0;
    var rest = kml.replace(/<Placemark(?:\s[^>]*)?>[\s\S]*?<\/Placemark>/gi, function (block) {
      var p = pointOf(block, S); if (!p) return block;
      if (pts.length >= MAX_COT) { kept++; return block; }
      var base = "osap-" + hid(id + "|" + p.name + "|" + p.lat.toFixed(5) + "," + p.lon.toFixed(5)), u = base, n = 2;
      while (seen[u]) u = base + "-" + n++;
      seen[u] = 1; p.uid = u; pts.push(p); return "";
    });
    var opt = { now: o.now, how: o.how, argb: argbOfCss(o.color), pkg: pkg, name: name };
    var out = [], content = [];
    pts.forEach(function (p) { var path = p.uid + "/" + p.uid + ".cot"; out.push({ name: path, data: cot(p, opt) }); content.push('<Content ignore="false" zipEntry="' + xesc(path) + '"><Parameter name="uid" value="' + xesc(p.uid) + '"/></Content>'); });
    /* lines, areas and any points past the cap: the tool's own KML, minus the points now sent as markers */
    var shapes = /<Placemark\b/i.test(rest);
    if (shapes) { var kp = pkg + "/" + fname(name) + ".kml"; out.push({ name: kp, data: rest.replace(/<Folder>\s*<name>[^<]*<\/name>\s*(<description>[^<]*<\/description>\s*)?<\/Folder>/gi, "") }); content.push('<Content ignore="false" zipEntry="' + xesc(kp) + '"/>'); }
    var man = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<MissionPackageManifest version="2"><Configuration>' +
      '<Parameter name="uid" value="' + xesc(pkg) + '"/><Parameter name="name" value="' + xesc(name) + '"/><Parameter name="onReceiveDelete" value="false"/>' +
      "</Configuration><Contents>" + content.join("") + "</Contents></MissionPackageManifest>\n";
    out.unshift({ name: "MANIFEST/manifest.xml", data: man });
    return { files: out, markers: pts.length, kmlPoints: kept, shapes: shapes, uid: pkg, name: name };
  }
  function blob(o) {
    var Z = W.OSAP_WS && W.OSAP_WS.zip; if (!Z) throw new Error("The TAK package needs the Workspaces module, which is not loaded.");
    var r = files(o); r.blob = Z(r.files); return r;
  }
  function download(name, b) {
    var u = URL.createObjectURL(b), a = D.createElement("a"); a.href = u; a.download = name; a.rel = "noopener"; D.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
  }
  /* make and download the package; returns a sentence for the tool's status line */
  function save(o) {
    var r = blob(o);
    if (!r.markers && !r.shapes) return "Nothing with a map location to put in a TAK package.";
    var fn = (o.file || fname(r.name)) + "-tak-" + new Date(o.now || Date.now()).toISOString().slice(0, 10) + ".zip";
    download(fn, r.blob);
    return "TAK data package saved to your downloads (" + fn + "): " + r.markers + " marker" + (r.markers === 1 ? "" : "s") + (r.shapes ? ", lines and areas as a KML overlay" : "") +
      (r.kmlPoints ? "; " + r.kmlPoints + " more points kept in the KML (marker limit " + MAX_COT + ")" : "") + ". Open it in ATAK (Import, or drop it in atak/tools/datapackage) or WinTAK (Data Package import).";
  }
  /* the button every tool shows, with the same words */
  var BTN_TIP = "A TAK data package (.zip) for ATAK and WinTAK: points as markers, lines and areas as a KML overlay. Made on this device; nothing is sent.";

  W.OSAP_TAK = { files: files, blob: blob, save: save, sidcType: sidcType, tip: BTN_TIP, MAX_COT: MAX_COT };
})();
