/* AXIOM OSAP: auto-proposed links for the analyst workspace's link chart (Shane 2026-10-20: "Can we have the link analysis auto
   populate?"). Pure functions, no page access: assets/osap-analyst.js hands in OSAP's own data and draws what comes back.
   What it proposes, all from data the page already holds:
   - an incident for each of the machine's incident candidates (data/live/ds-incidents.json, tools/incident_lib.mjs) placed to a
     Deep South district, with the district it "occurred in";
   - links between an incident and the reference entities (data/thailand/deepsouth-entities.js: organisations, units and
     agencies, never private people) named in a sentence of its reports, typed by the words around them: "attributed to" an
     armed group when the sentence blames, suspects or links one; "arrested or detained by", "targeted" or "responded to" for a
     security unit or agency.
   Every one is a machine proposal from rules over the report text, not a judgement: it carries the sentence it came from and its
   source links, and stays a proposal until the analyst accepts it (copied to the analyst's own links) or rejects it (never
   proposed again on this device). Nothing here writes anything. Figures in labels are what the reports say, not verified. */
(function (root) {
  "use strict";
  var KINDS = { shooting: "shooting", ied: "IED", ambush: "ambush", clash: "clash", arson: "arson", raid_or_arrest: "raid or arrest", attack_on_facility: "attack on a facility" };
  var TYPE = { ied: "incident: bombing or IED", raid_or_arrest: "incident: seizure, arrest or raid" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /* the words that type a link; Thai as well, for reports kept untranslated */
  var ATTR = /\b(blam\w*|attribut\w*|suspect\w*|believed|behind|claim\w*|linked to|link\w* with|members? of|militants? (?:of|from)|insurgents? (?:of|from)|cell)\b|ผู้ก่อเหตุ|สมาชิก|เชื่อว่า|ต้องสงสัย/i;
  var ARREST = /\b(arrest\w*|detain\w*|raid\w*|cordon\w*|search\w*|seiz\w*|captur\w*|surround\w*|custody)\b|จับกุม|ควบคุมตัว|ปิดล้อม|ตรวจค้น|ตรวจยึด/i;
  var VICTIM = /\b(killed|shot|wounded|injured|ambush\w*|attacked|targeted|died|dead|hurt)\b|เสียชีวิต|บาดเจ็บ|ถูกยิง|ซุ่มยิง/i;
  var NEAR_BEFORE = 40, NEAR_AFTER = 50;
  var RESP = /\b(respond\w*|rushed|inspect\w*|investigat\w*|dispatched|deployed|reinforce\w*|sealed off|at the scene)\b|ตรวจสอบ|รุดไป|เข้าตรวจ/i;
  var MAX_INC = 60;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function whenMs(t) { var s = String(t || "").slice(0, 16); return /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s) ? Date.parse(s + ":00+07:00") : NaN; }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function sentences(t) { return String(t || "").split(/(?<=[.!?\u0e2f])\s+|\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length >= 8; }); }
  function figure(list, word) {
    list = (list || []).filter(function (f) { return f && isFinite(f.n); });
    if (!list.length) return "";
    var ns = list.map(function (f) { return +f.n; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
    /* reports that differ are shown as differing, never reconciled */
    return ns.sort(function (a, b) { return a - b; }).join(" or ") + " " + word;
  }
  function incidentLabel(c) {
    var m = String(c.first || "").match(/^\d{4}-(\d\d)-(\d\d)/), day = m ? +m[2] + " " + MON[+m[1] - 1] + " " : "";
    var figs = [figure(c.figures && c.figures.killed, "killed"), figure(c.figures && c.figures.injured, "injured")].filter(Boolean).join(", ");
    return day + KINDS[c.kind] + ", " + (c.place_name || c.place_id) + (figs ? " (" + figs + " reported)" : "");
  }
  /* where an entity's names stand in a sentence, by the workspace's matching rules (whole words; exact case for short Latin names) */
  function spans(e, s) {
    var out = [];
    (e.aliases && e.aliases.length ? e.aliases : [e.name]).forEach(function (a) {
      a = String(a || "").trim(); if (a.length < 2) return;
      if (/^[\x20-\x7e]+$/.test(a)) {
        var re = new RegExp("(^|[^A-Za-z0-9])(" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")(?![A-Za-z0-9])", a.length <= 4 ? "g" : "gi"), m;
        while ((m = re.exec(s))) { var st = m.index + m[1].length; out.push([st, st + m[2].length]); if (re.lastIndex === m.index) re.lastIndex++; }
      } else for (var i = s.indexOf(a); i >= 0; i = s.indexOf(a, i + 1)) out.push([i, i + a.length]);
    });
    return out;
  }
  /* whether the words stand next to one of the entity's names: just before it or just after it */
  function near(re, s, sp) {
    return sp.some(function (p) { return re.test(s.slice(Math.max(0, p[0] - NEAR_BEFORE), p[0])) || re.test(s.slice(p[1], p[1] + NEAR_AFTER)); });
  }
  function isArmed(e) { return /armed group/i.test(e.group || "") || e.type === "armed group"; }
  function isSecurity(e) { return /security|police|army|border/i.test(e.group || "") || /^(unit|police or security force|agency)$/.test(e.type || ""); }
  /* the link a sentence supports between one incident and one entity, or null */
  function relFor(e, kind, s) {
    var sp = spans(e, s); if (!sp.length) return null;
    if (isArmed(e)) return near(ATTR, s, sp) ? ["inc", "attributed to"] : null;
    if (!isSecurity(e)) return null;
    if (kind === "raid_or_arrest" && ARREST.test(s)) return ["inc", "arrested or detained by"];
    if (kind !== "raid_or_arrest" && near(VICTIM, s, sp)) return ["inc", "targeted"];
    if (RESP.test(s) || ARREST.test(s)) return ["ent", "responded to"];
    return null;
  }

  /* opts: cands (ds-incidents candidates), items (window.ASAP_DS items, for the report text), ents (the workspace's entities, each
     with id, name, group, type and match(text)), days (0 = all), now, own (the analyst's links), rejected (proposal ids).
     Returns { incidents: {id: node}, links: [proposal] }, newest incident first. */
  function propose(opts) {
    var now = opts.now || Date.now(), days = opts.days || 0, rej = {}, have = {}, byUrl = {};
    (opts.rejected || []).forEach(function (p) { rej[p] = 1; });
    (opts.own || []).forEach(function (l) { if (l && l.a && l.b) { have[l.a + "|" + l.rel + "|" + l.b] = 1; have[l.b + "|" + l.rel + "|" + l.a] = 1; } });
    (opts.items || []).forEach(function (i) { var u = safeUrl(i && i.link); if (u) byUrl[u] = i; });
    var ents = (opts.ents || []).filter(function (e) { return e && e.id && typeof e.match === "function" && !/^person/.test(e.type || ""); });
    var C = (opts.cands || []).filter(function (c) {
      if (!c || !KINDS[c.kind] || c.location_level !== "district" || !/^TH-\d{4}$/.test(c.place_id || "")) return false;
      var t = whenMs(c.first); return isFinite(t) && (!days || t >= now - days * 864e5);
    }).sort(function (a, b) { return whenMs(b.first) - whenMs(a.first); }).slice(0, MAX_INC);
    var incidents = {}, links = [], at = {};
    function add(a, rel, b, inc, basis, urls, mt) {
      var pid = "auto:" + a + "|" + rel + "|" + b;
      if (rej[pid] || have[a + "|" + rel + "|" + b]) return;
      var p = at[pid];
      if (!p) { p = at[pid] = { pid: pid, a: a, b: b, rel: rel, inc: inc, basis: basis, mt: !!mt, urls: [] }; links.push(p); }
      urls.forEach(function (u) { if (u && p.urls.indexOf(u) < 0 && p.urls.length < 6) p.urls.push(u); });
    }
    C.forEach(function (c) {
      var id = "ent:me:inc:" + String(c.candidate_id).replace(/[^\w-]/g, ""), reps = (c.reports || []).filter(function (r) { return safeUrl(r && r.url); });
      if (!reps.length) return;
      var urls = reps.map(function (r) { return r.url; });
      incidents[id] = { id: id, name: incidentLabel(c), type: TYPE[c.kind] || "incident: shooting or armed attack", kind: c.kind, cand: c.candidate_id,
        first: c.first, dist: c.place_id, place: c.place_name || "", urls: urls.slice(0, 6), n: reps.length };
      add(id, "occurred in", "d:" + c.place_id, id, "The reports place it in " + (c.place_name || c.place_id) + " district (machine placement).", urls, false);
      reps.forEach(function (r) {
        var it = byUrl[r.url] || {}, text = [r.title_en || it.title_en || r.title || it.title, it.summary_en || it.summary].filter(Boolean).join(". "), mt = !!(it.mt || r.title_en);
        sentences(text).forEach(function (s) {
          ents.forEach(function (e) {
            if (!e.match(s)) return;
            var k = relFor(e, c.kind, s); if (!k) return;
            var cut = s.length > 240 ? s.slice(0, 239) + "\u2026" : s;
            if (k[0] === "inc") add(id, k[1], e.id, id, cut, [r.url], mt); else add(e.id, k[1], id, id, cut, [r.url], mt);
          });
        });
      });
    });
    return { incidents: incidents, links: links };
  }

  var api = { propose: propose, incidentLabel: incidentLabel, relFor: relFor };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OSAP_AN_AUTO = api;
})(typeof window !== "undefined" ? window : this);
