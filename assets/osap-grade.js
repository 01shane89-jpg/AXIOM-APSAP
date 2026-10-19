/* AXIOM OSAP: source grading for My work (window.OSAP_GRADE; also require()-able for tests/grade.test.mjs).
   The standard Admiralty / NATO system (STANAG 2511, AJP-2.1): a grade is the source's reliability, A to F, with the
   information's credibility, 1 to 6, written together, for example "B2" (a usually reliable source, probably true).
   - The analyst grades a report from its report window (next to Save) or from My work (assets/osap-work.js). The grade is
     kept with the item in the "osap-work" store as item.grade = {r, c, at}, so workspaces and Sync carry it (osap-work is in
     KEYS in assets/osap-ws.js). Either half may be left blank ("B-" or "-2").
   - A default reliability per source (the outlet's web domain, or its name when there is no link) is kept in the same store
     as osap-work.srcRel = {key: {r, label, at}}. It only pre-fills the picker on an ungraded item; nothing is stored until
     the analyst confirms it or sets the credibility.
   - The grade is the analyst's own judgement. Nothing in OSAP sets it automatically and no AI writes it.
   - Exports keep schema osap-work/1: the grade is an optional field older readers ignore.
   This file holds the scale, the checks and the picker and badge markup; osap-work.js stores and shows them. */
(function (root) {
  "use strict";
  var REL = [
    ["A", "Completely reliable", "No doubt of authenticity, trustworthiness or competency; a history of complete reliability."],
    ["B", "Usually reliable", "Minor doubt about authenticity, trustworthiness or competency; a history of valid information most of the time."],
    ["C", "Fairly reliable", "Doubt of authenticity, trustworthiness or competency, but has provided valid information in the past."],
    ["D", "Not usually reliable", "Significant doubt about authenticity, trustworthiness or competency, but has provided valid information in the past."],
    ["E", "Unreliable", "Lacking in authenticity, trustworthiness and competency; a history of invalid information."],
    ["F", "Reliability cannot be judged", "No basis exists for evaluating the reliability of the source."]];
  var CRED = [
    ["1", "Confirmed by other sources", "Confirmed by other independent sources; logical in itself; consistent with other information on the subject."],
    ["2", "Probably true", "Not confirmed; logical in itself; consistent with other information on the subject."],
    ["3", "Possibly true", "Not confirmed; reasonably logical in itself; agrees with some other information on the subject."],
    ["4", "Doubtful", "Not confirmed; possible but not logical; no other information on the subject."],
    ["5", "Improbable", "Not confirmed; not logical in itself; contradicted by other information on the subject."],
    ["6", "Truth cannot be judged", "No basis exists for evaluating the validity of the information."]];
  var NOTE = "Admiralty / NATO grading: source reliability A (completely reliable) to E (unreliable), F cannot be judged; information credibility 1 (confirmed by other sources) to 5 (improbable), 6 cannot be judged. The analyst's own judgement, not set by OSAP or AI.";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function find(L, v) { for (var i = 0; i < L.length; i++) if (L[i][0] === v) return L[i]; return null; }
  function okR(v) { v = typeof v === "string" ? v.toUpperCase() : ""; return /^[A-F]$/.test(v) ? v : ""; }
  function okC(v) { return typeof v === "string" && /^[1-6]$/.test(v) ? v : ""; }

  /* a stored or imported grade, cleaned; null when it holds nothing */
  function norm(g) {
    if (typeof g === "string") { var m = /^\s*([A-Fa-f-])?\s*([1-6-])?\s*$/.exec(g); if (!m) return null; g = { r: (m[1] || "").toUpperCase(), c: m[2] || "" }; }
    if (!g || typeof g !== "object" || Array.isArray(g)) return null;
    var r = okR(g.r), c = okC(g.c == null ? "" : String(g.c));
    if (!r && !c) return null;
    var o = { r: r, c: c };
    if (typeof g.at === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(g.at)) o.at = g.at;
    return o;
  }
  /* "B2", or "B-" / "-2" for half a grade; "" for none */
  function code(g) { g = norm(g); return g ? (g.r || "-") + (g.c || "-") : ""; }
  function relName(r) { var x = find(REL, r); return x ? x[1] : ""; }
  function credName(c) { var x = find(CRED, String(c)); return x ? x[1] : ""; }
  /* "Usually reliable; probably true" */
  function meaning(g) {
    g = norm(g); if (!g) return "";
    return [g.r ? g.r + ": " + relName(g.r) : "Reliability not graded", g.c ? g.c + ": " + credName(g.c) : "Credibility not graded"].join("; ");
  }

  /* the source a default reliability belongs to: the outlet's web domain, or its name when there is no link */
  function sourceKey(url, name) {
    var m = /^https?:\/\/(?:[^@\/?#]*@)?([^\/?#:]+)/i.exec(String(url || ""));
    if (m) { var h = m[1].toLowerCase().replace(/^www\.|^m\.|^mobile\./, "").replace(/\.$/, ""); if (/^[a-z0-9.-]{1,120}$/.test(h) && h.indexOf(".") > 0) return "d:" + h; }
    var n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
    return n ? "n:" + n : "";
  }
  function sourceLabel(key) { return String(key || "").slice(2); }
  function okKey(k) { return typeof k === "string" && k.length <= 122 && (/^d:[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(k) || /^n:\S/.test(k)); }
  /* the defaults map, cleaned: {key: {r, label, at}} */
  function normDefaults(o) {
    var out = {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    Object.keys(o).forEach(function (k) {
      var x = o[k], r = x && okR(x.r);
      if (!okKey(k) || !r) return;
      out[k] = { r: r, label: typeof x.label === "string" ? x.label.slice(0, 200) : sourceLabel(k), at: typeof x.at === "string" ? x.at.slice(0, 40) : "" };
    });
    return out;
  }

  /* ---------- markup ---------- */
  function badge(g) {
    var c = code(g); if (!c) return "";
    return '<span class="wkgb" title="' + esc("Your grade " + c + ". " + meaning(g) + ". Your own judgement, not the source's.") + '">' + esc(c) + "</span>";
  }
  function legendHtml() {
    var row = function (x) { return "<tr><th>" + esc(x[0]) + "</th><td><b>" + esc(x[1]) + "</b> " + esc(x[2]) + "</td></tr>"; };
    return '<div class="wkglg"><p>Admiralty / NATO system. Grade the <b>source</b> and the <b>information</b> separately: a reliable source can pass on doubtful information. Use F or 6 when there is no basis to judge.</p>' +
      '<table><tr><th colspan="2">Source reliability</th></tr>' + REL.map(row).join("") + '<tr><th colspan="2">Information credibility</th></tr>' + CRED.map(row).join("") + "</table>" +
      "<p>The grade is your own judgement. OSAP never sets it, and a default for a source only pre-fills the picker until you confirm it.</p></div>";
  }
  /* the picker: two selects and a legend. k is the item key; g the stored grade; def the source's default {r, label} or null */
  function picker(k, g, def, srcLabel) {
    g = norm(g) || { r: "", c: "" };
    var sug = !g.r && def && okR(def.r) ? def.r : "";
    var rv = g.r || sug;
    var opt = function (L, v, blank) { return '<option value=""' + (v ? "" : " selected") + ">" + blank + "</option>" + L.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === v ? " selected" : "") + ' title="' + esc(x[2]) + '">' + x[0] + " · " + esc(x[1]) + "</option>"; }).join(""); };
    var h = '<div class="wkg" data-wkg="' + esc(k) + '"><span class="wkglab">Grade</span>' + (g.r || g.c ? badge(g) : "") +
      '<select data-wkg-r aria-label="Source reliability, A to F"' + (sug ? ' class="wkgsug"' : "") + ' title="Source reliability: A completely reliable to E unreliable, F cannot be judged">' + opt(REL, rv, "Source –") + "</select>" +
      '<select data-wkg-c aria-label="Information credibility, 1 to 6" title="Information credibility: 1 confirmed by other sources to 5 improbable, 6 cannot be judged">' + opt(CRED, g.c, "Info –") + "</select>";
    if (sug) h += '<button type="button" class="refresh" data-wkg-ok title="' + esc("Your default for " + (srcLabel || "this source") + " is " + sug + ". It is not stored until you confirm it or set the credibility.") + '">Confirm ' + esc(sug) + "</button>";
    else if (g.r && srcLabel && (!def || def.r !== g.r)) h += '<button type="button" class="refresh wkgdef" data-wkg-def title="' + esc("Pre-fill " + g.r + " on items from " + srcLabel + " you have not graded yet. You still confirm each one.") + '">Default ' + esc(g.r) + " for " + esc(srcLabel.length > 28 ? srcLabel.slice(0, 27) + "…" : srcLabel) + "</button>";
    h += '<details class="wkghelp"><summary aria-label="What the grades mean" title="What the grades mean">?</summary>' + legendHtml() + "</details>";
    if (sug) h += '<div class="wkghint">Pre-filled from your default for ' + esc(srcLabel || "this source") + ". Not stored until you confirm it or set the credibility.</div>";
    return h + "</div>";
  }

  var CSS = ".wkg{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.wkglab{font-size:11px;font-weight:600;color:var(--muted)}" +
    ".wkg select{min-height:36px;max-width:12.5em;font:inherit;font-size:13px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px 4px}" +
    ".wkg select.wkgsug{border-style:dashed;color:var(--muted)}.wkg .refresh{min-height:34px}" +
    ".wkgb{display:inline-block;font:700 11px/16px ui-monospace,Menlo,Consolas,monospace;padding:0 5px;border-radius:3px;border:1px solid var(--accent);color:var(--accent);background:var(--surface);vertical-align:1px;letter-spacing:.03em}" +
    ".wkghelp{position:relative}.wkghelp>summary{list-style:none;cursor:pointer;width:28px;height:28px;line-height:26px;text-align:center;border:1px solid var(--line);border-radius:50%;font-weight:700;color:var(--muted)}.wkghelp>summary::-webkit-details-marker{display:none}details.wkghelp>summary::before,details.wkghelp[open]>summary::before{content:none}" +
    ".wkghelp[open]{flex-basis:100%}.wkglg{font-size:12px;border:1px solid var(--line);border-radius:4px;padding:6px 8px;margin-top:4px;background:var(--surface)}.wkglg p{margin:2px 0 6px}" +
    ".wkglg table{border-collapse:collapse;width:100%}.wkglg th,.wkglg td{text-align:left;vertical-align:top;padding:2px 4px;border-top:1px solid var(--line)}.wkglg th[colspan]{padding-top:6px;color:var(--accent)}" +
    ".wkghint{flex-basis:100%;font-size:11px;color:var(--muted)}" +
    "@media (pointer:coarse){.wkg select{font-size:16px;min-height:40px}.wkg .refresh{min-height:40px}.wkghelp>summary{width:40px;height:40px;line-height:38px}}";

  var api = { REL: REL, CRED: CRED, NOTE: NOTE, norm: norm, code: code, meaning: meaning, relName: relName, credName: credName,
    sourceKey: sourceKey, sourceLabel: sourceLabel, normDefaults: normDefaults, badge: badge, picker: picker, legendHtml: legendHtml, esc: esc, CSS: CSS };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.OSAP_GRADE = api;
  try { var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); } catch (e) {}
})(this);
