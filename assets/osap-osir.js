/* AXIOM OSAP: OSIR, Open Source Intelligence Report (Shane 2026-10-21: "New report. OSIR format: Subject, Date generated,
   Country/s, OSINT disclaimer, Summary, (Main content), End of report, Attachments, Contributors, Sources").
   Reports > OSIR opens a small window: country, region (the whole country, one province the records name, or the drawn area),
   topic, dates, the subject line, who prepared it and an optional analyst summary. "Make OSIR" shows the report in the print
   overlay (#brief, html.briefing, as the Timeline report does); Print or Save as PDF keeps a copy.
   - The content comes from the Timeline report (window.OSAP_TLREPORT.data): the same records, key events (fixed rules, no AI),
     map, chart, key-event rows and chronology entries. The sections follow Shane's order exactly.
   - OSAP writes no judgments. The automatic summary is counts by fixed rules and says so; the analyst summary is what the person
     typed, marked as theirs. Event summaries written by AI keep their small "AI generated" tag.
   - Every record keeps its source link and SHA-256 fingerprint; the report fingerprint covers all of them in order.
   - Refinements (Shane 2026-10-22, "do all the refinements"): a records-per-day chart for periods of 45 days or less; a change
     from the previous period of the same length (counts by kind and province, plus the Deep South peace tracker's lines for
     the period), by fixed rules; the report number and "page X of Y" on every printed page (browsers that print page-margin
     boxes); "Save draft" / "Open draft" (a JSON file on the analyst's own device, nothing stored online); a version number and
     a "supersedes" line when a report is remade for the same country and subject on this device; the catalogue's proposed
     reliability letter shown beside a claim whose source is one of the report's own (a proposal, never set for the analyst).
   - AI draft (Shane 2026-10-22, "do it"; 2026-10-21 14:24Z: "leave the summary portion for the human to fill out"): when the daily
     job (tools/refresh_osirdraft.mjs, data/live/osirdraft.js) has drafted this country and topic, "Fill from AI draft" puts its
     graded claims, assessment, alternatives, confidence, indicators and gaps into the EMPTY analyst fields only (never over
     what the analyst typed, never the Summary). Grades are left for the analyst; the proposals are written in the claim's note.
     In the report a part still as drafted is tagged "AI generated" (draft, not analyst-approved, in the tooltip); a part the
     analyst changed is tagged "Analyst, edited from AI draft". Citations name the OSAP records the draft rests on.
   - Analyst sections (Shane 2026-10-21, after the Malaysia facilitator product: "yes please do"): optional graded claims
     (Admiralty source reliability A-F, information credibility 1-6), assessment, alternative explanations, confidence,
     relevance, indicators to watch, intelligence gaps, and outside sources the analyst cites. Each is what the person typed,
     tagged Analyst; OSAP adds no judgment and does not check outside sources. Kept in memory only, never stored.
   - Built in the browser; nothing is sent anywhere and no record is changed. */
(function () {
  "use strict";
  var W = window, D = document, PEND = "osap-osir-pending", WHO = "osap-osir-by", VERS = "osap-osir-versions", DRAFT = "osap-osir-draft/1", DRAFT_MAX = 1048576;
  var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var PRESETS = [["7", "7 days"], ["14", "14 days"], ["30", "30 days"], ["90", "90 days"], ["182", "6 months"], ["365", "1 year"], ["all", "All dates"]];
  var DISCLAIMER = "This report was compiled only from publicly available information (open sources). It holds no classified or proprietary material. " +
    "Statements are what the named sources reported, not confirmed facts: government, police and military statements are reported claims, and a credible source can still be wrong. " +
    "Groupings, counts and key events are picked by fixed rules; items tagged AI generated or Automatic are drafts, not analyst-approved. " +
    "The information is as held by OSAP at the time generated. Check the linked sources before acting on it.";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function host(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(u || ""); return m ? m[1].replace(/^www\./, "") : ""; }
  function pl(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function today() { return iso(Date.now()); }
  function T() { return W.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function fmtShort(d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
  /* date-time group in Zulu: 211043Z OCT 26 */
  function dtg(ms) { var d = new Date(ms), p = function (x) { return ("0" + x).slice(-2); }; return p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + "Z " + MON[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function topN(o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a] || a.localeCompare(b); }).slice(0, n).map(function (k) { return [k, o[k]]; }); }
  function list3(t) { return t.map(function (x, i) { return (i && i === t.length - 1 ? "and " : "") + x[0] + " (" + x[1] + ")"; }).join(t.length > 2 ? ", " : " "); }
  function areaOn() { var A = W.TSAP && W.TSAP.areaApi; return !!(A && A.area && A.area() && A.area().length >= 3); }
  function getLS(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function setLS(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function appPeriod() {
    var P = { p: "30" };
    try { var v = JSON.parse(localStorage.getItem("asap-period")); if (v && v.p) P = v; } catch (e) {}
    if (P.p === "custom" && (P.from || P.to)) return { from: P.from || "", to: P.to || "" };
    if (P.p === "all") return { from: "", to: "" };
    var n = P.p === "24h" ? 1 : +P.p || 30;
    return { from: iso(Date.now() - (n - 1) * 864e5), to: today() };
  }

  /* ---------- the window: what the report covers ---------- */
  var BOX = null, S = { cc: "", region: "", scope: "", kw: "", kwName: "", from: "", to: "", subject: "", subjectSet: false, by: "", summary: "", data: null, seq: 0 };
  /* analyst sections: free text the preparer types, plus graded claims and outside sources; in memory only */
  var REL = ["A", "B", "C", "D", "E", "F"], CRED = ["1", "2", "3", "4", "5", "6"], CONF = ["HIGH", "MODERATE", "LOW"], MAXROWS = 30;
  var RELN = { A: "Completely reliable", B: "Usually reliable", C: "Fairly reliable", D: "Not usually reliable", E: "Unreliable", F: "Reliability cannot be judged" };
  var CREDN = { "1": "Confirmed by other sources", "2": "Probably true", "3": "Possibly true", "4": "Doubtful", "5": "Improbable", "6": "Truth cannot be judged" };
  var TEXTS = [["assess", "Assessment"], ["alt", "Alternative explanations"], ["rel", ""], ["ind", "Indicators to watch"], ["gaps", "Intelligence gaps"]];
  function anReset() { S.an = { assess: "", alt: "", conf: "", confNote: "", relLabel: "Relevance", rel: "", ind: "", gaps: "" }; S.claims = []; S.outs = []; S.anOpen = false; S.aiFill = {}; S.aiFrom = null; S.aiNote = ""; }
  anReset();
  function anUsed() { var a = S.an; return !!(S.claims.some(claimUsed) || S.outs.some(outUsed) || a.conf || ["assess", "alt", "rel", "ind", "gaps", "confNote"].some(function (k) { return a[k].trim(); })); }
  function claimUsed(c) { return !!(c.claim.trim() || c.src.trim() || c.note.trim()); }
  function outUsed(x) { return !!(x.title.trim() || x.url.trim()); }
  function grade(r, c) { return (r || "") + (c || "") || "—"; }
  /* the catalogue's proposed reliability letter for one of this report's own sources, by name (case and spacing ignored) */
  function srcKey(n) { return String(n || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function proposedFor(name) {
    var k = srcKey(name), d = S.data; if (!k || !d) return "";
    for (var i = 0; i < d.recs.length; i++) { var s = d.recs[i].src || {}; if (s.proposed && srcKey(s.name) === k) return String(s.proposed).slice(0, 1); }
    return "";
  }
  function srcNames() {
    var d = S.data, seen = {}, out = []; if (!d) return out;
    d.recs.forEach(function (r) { var s = r.src || {}, k = srcKey(s.name); if (k && !seen[k]) { seen[k] = 1; out.push(s.name); } });
    return out.slice(0, 300);
  }
  /* draft file: what the analyst typed in this window, saved to and opened from their own device; nothing is stored online */
  function draftData() {
    return { schema: DRAFT, saved: new Date().toISOString(), cc: S.cc, region: S.region === "@area" ? "" : S.region, scope: S.scope, kw: S.kw || "", kwName: S.kwName || "",
      from: S.from, to: S.to, subject: S.subjectSet ? S.subject : "", by: S.by, summary: S.summary, an: S.an, claims: S.claims, outs: S.outs, aiFill: S.aiFill, aiFrom: S.aiFrom };
  }
  function saveDraft() {
    var name = "OSIR-draft-" + String(S.cc || "xx").toUpperCase() + "-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".json";
    var a = D.createElement("a"), u = URL.createObjectURL(new Blob([JSON.stringify(draftData(), null, 1)], { type: "application/json" }));
    a.href = u; a.download = name; D.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    setNote("Draft saved to your device as " + name + ". Open it here later with Open draft.");
  }
  /* a draft file is the analyst's own, but read as untrusted data: known fields only, strings cut to the window's own limits */
  function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
  function pickOf(v, list) { return list.indexOf(v) >= 0 ? v : ""; }
  function readDraft(o) {
    if (!o || o.schema !== DRAFT) throw new Error("not an OSIR draft file");
    var a = o.an || {}, day = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : ""; };
    return {
      cc: str(o.cc, 8), region: str(o.region, 120), scope: str(o.scope, 120), kw: str(o.kw, 600), kwName: str(o.kwName, 80), from: day(o.from), to: day(o.to),
      subject: str(o.subject, 200), by: str(o.by, 120), summary: str(o.summary, 4000),
      an: { assess: str(a.assess, 4000), alt: str(a.alt, 4000), conf: pickOf(a.conf, CONF), confNote: str(a.confNote, 400), relLabel: str(a.relLabel, 60) || "Relevance", rel: str(a.rel, 4000), ind: str(a.ind, 4000), gaps: str(a.gaps, 4000) },
      claims: (Array.isArray(o.claims) ? o.claims : []).slice(0, MAXROWS).map(function (c) { c = c || {}; var x = { claim: str(c.claim, 1000), src: str(c.src, 200), r: pickOf(c.r, REL), c: pickOf(c.c, CRED), note: str(c.note, 400) }; if (str(c.ai, 2000)) x.ai = str(c.ai, 2000); return x; }),
      aiFill: (function (f) { var out = {}; f = f && typeof f === "object" ? f : {}; ["assess", "alt", "confNote", "ind", "gaps"].forEach(function (k) { if (typeof f[k] === "string") out[k] = f[k].slice(0, 4000); }); if (CONF.indexOf(f.conf) >= 0) out.conf = f.conf; return out; })(o.aiFill),
      aiFrom: o.aiFrom && typeof o.aiFrom === "object" ? { model: str(o.aiFrom.model, 80), made: str(o.aiFrom.made, 40), name: str(o.aiFrom.name, 120), from: str(o.aiFrom.from, 10), to: str(o.aiFrom.to, 10) } : null,
      outs: (Array.isArray(o.outs) ? o.outs : []).slice(0, MAXROWS).map(function (x) { x = x || {}; return { title: str(x.title, 300), url: str(x.url, 600), r: pickOf(x.r, REL), note: str(x.note, 300) }; })
    };
  }
  function openDraft(file) {
    if (!file) return;
    if (file.size > DRAFT_MAX) { setNote("That file is too large to be an OSIR draft.", true); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var g; try { g = readDraft(JSON.parse(String(fr.result))); } catch (e) { setNote("Could not open that file: " + e.message + ".", true); return; }
      var other = g.cc && g.cc !== S.cc;
      ["region", "scope", "kw", "kwName", "from", "to", "by", "summary"].forEach(function (k) { S[k] = g[k]; });
      if (other) S.region = "";
      S.subject = g.subject; S.subjectSet = !!g.subject.trim(); S.an = g.an; S.claims = g.claims; S.outs = g.outs; S.aiFill = g.aiFill; S.aiFrom = g.aiFrom; S.anOpen = anUsed();
      S.draftNote = "Draft opened (" + pl(g.claims.length, "claim") + ")." + (other ? " It was made for another country (" + g.cc.toUpperCase() + "); its region was left out." : "");
      refresh();
    };
    fr.onerror = function () { setNote("Could not read that file.", true); };
    fr.readAsText(file);
  }
  function setNote(t, bad) { var n = BOX && BOX.querySelector("#os-note"); if (n) { n.textContent = t; n.className = "osn" + (bad ? " bad" : ""); } }
  /* versions: reports made on this device for the same country and subject; each new one supersedes the one before */
  function versKey(cc, subj) { return String(cc || "") + "|" + srcKey(subj); }
  function versGet() { try { var v = JSON.parse(getLS(VERS) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function versOf(cc, subj) { var l = versGet()[versKey(cc, subj)]; return Array.isArray(l) ? l : []; }
  function versAdd(cc, subj, no, t) {
    var v = versGet(), k = versKey(cc, subj), l = Array.isArray(v[k]) ? v[k] : [];
    l.push({ no: no, t: t }); v[k] = l.slice(-20);
    var keys = Object.keys(v); if (keys.length > 60) keys.sort(function (a, b) { return (v[a][v[a].length - 1] || {}).t - (v[b][v[b].length - 1] || {}).t; }).slice(0, keys.length - 60).forEach(function (x) { delete v[x]; });
    setLS(VERS, JSON.stringify(v));
  }
  /* ---------- AI draft (data/live/osirdraft.js) ---------- */
  var DRAFT_SRC = "data/live/osirdraft.js", draftState = 0;
  function loadAiDraft(cb) {
    if (W.OSAP_OSIRDRAFT || draftState === 2) return cb();
    if (draftState === 1) { setTimeout(function () { loadAiDraft(cb); }, 300); return; }
    draftState = 1;
    var sc = D.createElement("script"), done = false, fin = function () { if (!done) { done = true; draftState = 2; cb(); } };
    sc.src = DRAFT_SRC + "?d=" + new Date().toISOString().slice(0, 13); sc.onload = sc.onerror = fin; D.head.appendChild(sc); setTimeout(fin, 6000);
  }
  /* the newest draft for this country and topic, if any */
  function aiDraftFor() {
    var T0 = (W.OSAP_OSIRDRAFT || {}).topics || {}, best = null;
    Object.keys(T0).forEach(function (k) { var t = T0[k]; if (t && t.cc === S.cc && (t.scope || "") === (S.scope || "") && (!best || String(t.made) > String(best.made))) best = t; });
    return best;
  }
  function refName(t, n) {
    var r = (t.refs || []).filter(function (x) { return x.n === n; })[0]; if (!r) return "";
    return r.source + (r.ts ? ", " + fmtShort(String(r.ts).slice(0, 10)) : "");
  }
  /* [3] in drafted text becomes the record's source and date, so no bare number is left behind */
  function cited(t, text) { return String(text || "").replace(/\[(\d+)\]/g, function (m, d) { var nm = refName(t, +d); return nm ? " (" + nm + ")" : ""; }).replace(/ {2,}/g, " ").replace(/\s+([.,;])/g, "$1").trim(); }
  function fillFromAi() {
    var t = aiDraftFor(); if (!t) return;
    var a = S.an, f = S.aiFill, filled = 0;
    var put = function (k, v) { if (v && !String(a[k] || "").trim()) { a[k] = v; f[k] = v; filled++; } };
    put("assess", t.assess && cited(t, t.assess.text));
    put("alt", t.alt && cited(t, t.alt.text));
    if (t.conf && !a.conf) { a.conf = t.conf; f.conf = t.conf; filled++; }
    put("confNote", t.confNote && cited(t, t.confNote));
    put("ind", (t.ind || []).map(function (x) { return cited(t, x.text); }).filter(Boolean).join("\n"));
    put("gaps", (t.gaps || []).map(function (x) { return cited(t, x.text); }).filter(Boolean).join("\n"));
    var have = {}; S.claims.forEach(function (c) { have[srcKey(c.claim)] = 1; });
    (t.claims || []).forEach(function (c) {
      if (S.claims.length >= MAXROWS) return;
      var claim = cited(t, c.claim); if (!claim || have[srcKey(claim)]) return;
      var refs = (c.refs || []).map(function (n) { return refName(t, n); }).filter(Boolean);
      var note = "AI draft cites " + (refs.join("; ") || "no record") + "." + (c.cred ? " AI proposes credibility " + c.cred + "." : "") + (c.rel ? " Catalogue proposes reliability " + c.rel + "." : "");
      var row = { claim: claim, src: c.source || "", r: "", c: "", note: note.slice(0, 400) };
      row.ai = JSON.stringify([row.claim, row.src, row.note]); S.claims.push(row); filled++;
    });
    S.aiFrom = { model: t.model || "", made: t.made || "", name: t.name || t.label || "", from: t.from, to: t.to };
    S.anOpen = true; S.aiNote = filled ? "Filled " + pl(filled, "part") + " from the AI draft into empty fields. Each stays tagged AI generated in the report until you edit it; grades are yours to set." : "Nothing filled: the fields the AI draft covers already hold your text.";
    draw();
  }
  /* how a part reached the report: "" typed by the analyst, "ai" as drafted, "edited" drafted then changed */
  function dispo(k, v) { var f = S.aiFill[k]; return f == null || !String(v || "").trim() ? "" : String(v) === String(f) ? "ai" : "edited"; }
  function claimDispo(c) { return !c.ai ? "" : c.ai === JSON.stringify([c.claim, c.src, c.note]) ? "ai" : "edited"; }
  function aiBox() {
    var t = aiDraftFor(); if (!t) return "";
    var other = t.from && S.from && (t.from !== S.from || t.to !== S.to);
    return '<div class="osw osai"><b>AI draft available</b> <span class="aitag" tabindex="0" title="' + esc(LABELAI) + '">AI generated</span><br><small>' +
      esc((t.name || t.label || "This topic") + ", " + fmtShort(t.from) + " to " + fmtShort(t.to) + "; drafted " + t.made + " by " + (t.model || "an AI model") + " from " + pl(t.records || 0, "record") + " OSAP held. ") +
      (other ? "<b>Its dates differ from this report's.</b> " : "") +
      "It fills only empty fields and never the Summary, which is yours. Every filled part stays tagged AI generated until you edit it.</small>" +
      '<div><button type="button" class="refresh" id="os-ai-fill">Fill from AI draft</button></div>' + (S.aiNote ? '<small role="status">' + esc(S.aiNote) + "</small>" : "") + "</div>";
  }
  var LABELAI = "Drafted by AI from the OSAP records it cites: a draft, not analyst-approved.";
  function css() {
    if (D.getElementById("osir-css")) return;
    var st = D.createElement("style"); st.id = "osir-css";
    st.textContent =
      "#osirdlg{position:fixed;inset:0;z-index:100001;overflow:auto;background:rgba(0,0,0,.45);padding:16px}#osirdlg[hidden]{display:none}" +
      "#osirdlg .cbox{max-width:620px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
      "#osirdlg .chead{display:flex;align-items:center;gap:8px}#osirdlg .chead h2{margin:0;font-size:18px;flex:1}" +
      "#osirdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}" +
      "#osirdlg .obs{color:var(--muted)}#osirdlg .osg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0}" +
      "#osirdlg label{display:flex;flex-direction:column;gap:3px;font-weight:600;min-width:0}" +
      "#osirdlg select,#osirdlg input,#osirdlg textarea{min-height:38px;font:inherit;color:var(--ink);background:var(--surface2);border:1px solid var(--line);border-radius:6px;padding:4px 8px;min-width:0;max-width:100%}" +
      "#osirdlg textarea{min-height:64px;resize:vertical;font-weight:400}#osirdlg label small{font-weight:400;color:var(--muted)}" +
      "#osirdlg .osw{grid-column:1/-1}#osirdlg .osp{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 4px}" +
      "#osirdlg .osp button{min-height:32px;padding:2px 10px;border-radius:16px;border:1px solid var(--line);background:var(--surface2);color:var(--ink);font:inherit;cursor:pointer}" +
      "#osirdlg .osp button.on{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}" +
      "#osirdlg .osn{background:var(--surface2);border-left:3px solid var(--accent);padding:7px 10px;margin:8px 0;min-height:20px}#osirdlg .osn.bad{border-left-color:var(--bad)}" +
      "#osirdlg .osb{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}#osirdlg .osb button{min-height:42px}" +
"#osirdlg details.osx{grid-column:1/-1;border:1px solid var(--line);border-radius:6px;padding:6px 10px}#osirdlg details.osx>summary{cursor:pointer;font-weight:600;min-height:32px;line-height:32px}" +
      "#osirdlg .osx .osg{margin:6px 0}#osirdlg .osrow{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) 70px 70px 44px;gap:6px;align-items:end;border-top:1px dashed var(--line);padding-top:6px}" +
      "#osirdlg .osrow .osw2{grid-column:1/-1}#osirdlg .osrow button{min-height:38px;min-width:44px}#osirdlg .osadd{justify-self:start}" +
      "#osirdlg .oskw{display:flex;flex-direction:column;gap:6px}#osirdlg .oskwr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
      "#osirdlg .oskw small{font-size:12px;line-height:1.4}#osirdlg .oskwe{color:var(--bad);font-weight:600}" +
      "@media (max-width:520px){#osirdlg{padding:8px}#osirdlg .osg,#osirdlg .oskwr{grid-template-columns:minmax(0,1fr)}#osirdlg .osrow{grid-template-columns:minmax(0,1fr) 64px 64px 44px}}" +
      /* the report: the Timeline report's styles (.tlr) plus the OSIR's own banner, field table and closing line */
      ".tlr.osir .osban{background:#007a33;color:#fff;text-align:center;font:700 10.5px/1.9 system-ui,sans-serif;letter-spacing:.16em;margin:0 0 12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".tlr.osir .osban.end{margin:16px 0 0}.tlr.osir table.osf{width:100%;border-collapse:collapse;margin:0 0 6px}" +
      ".tlr.osir table.osf th{width:132px;text-align:left;vertical-align:top;padding:4px 10px 4px 0;color:#12324a;font-family:Georgia,'Times New Roman',serif;font-size:1.05em;border-bottom:1px solid #d5dde4}" +
      ".tlr.osir table.osf td{padding:4px 0;border-bottom:1px solid #d5dde4}.tlr.osir table.osf td b{font-size:1.08em}" +
      ".tlr.osir .osdisc{border:1px solid #9fb0bf;background:#f4f7f9;padding:7px 10px;margin:0 0 4px}" +
      ".tlr.osir .osan{white-space:pre-wrap;border-left:3px solid #12324a;padding:3px 0 3px 10px;margin:4px 0 8px}" +
      ".tlr.osir h4.oss{font-family:Georgia,'Times New Roman',serif;color:#12324a;font-size:1.12em;margin:12px 0 4px}" +
      ".tlr.osir .osend{text-align:center;font:700 12px/1.6 Georgia,'Times New Roman',serif;letter-spacing:.2em;color:#12324a;border-top:3px double #12324a;border-bottom:3px double #12324a;margin:18px 0 14px;padding:4px 0}" +
      ".tlr.osir table.oscl{width:100%;border-collapse:collapse;table-layout:auto;margin:4px 0 8px;font-size:.95em}.tlr.osir table.oscl td{white-space:normal!important;overflow-wrap:anywhere}.tlr.osir table.oscl td:nth-child(2){width:42%}.tlr.osir table.oscl td:nth-child(3){width:22%}.tlr.osir table.oscl th,.tlr.osir table.oscl td{border-bottom:1px solid #d5dde4;padding:3px 6px;text-align:left;vertical-align:top}" +
      ".tlr.osir table.oscl th{color:#12324a;font-weight:600}.tlr.osir table.oscl td.g{font-family:ui-monospace,Menlo,Consolas,monospace;white-space:nowrap}.tlr.osir .osanb{white-space:pre-wrap;margin:2px 0 8px}" +
      ".tlr.osir ul.osli{margin:2px 0 8px;padding-left:18px}.tlr.osir .osconf b{letter-spacing:.06em}" +
      ".tlr.osir table.osch{border-collapse:collapse;margin:4px 0 8px;font-size:.95em}.tlr.osir table.osch th,.tlr.osir table.osch td{padding:2px 10px 2px 0;text-align:right;border-bottom:1px solid #d5dde4}" +
      ".tlr.osir table.osch th:first-child,.tlr.osir table.osch td:first-child{text-align:left}.tlr.osir table.osch caption{text-align:left;caption-side:top;padding-bottom:2px}" +
      ".tlr.osir .osdual{display:flex;flex-wrap:wrap;gap:18px}.tlr.osir .osdual>div{flex:1 1 230px;min-width:0}.tlr.osir ul.ospeace{margin:2px 0 8px;padding-left:18px}" +
      "#osirdlg .osprop{font-weight:400;color:var(--muted);font-size:12px}#osirdlg .osai{border:1px dashed var(--line);border-radius:6px;padding:6px 10px}#osirdlg .osai button{margin-top:6px;min-height:38px}" +
      ".tlr.osir ul.oscon{margin:4px 0 0;padding-left:18px}.tlr.osir .mg{font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all}" +
      "@media print{.tlr.osir h4.oss .aitag::after,.tlr.osir p.bm>.aitag::after{content:none}html.briefing .tlr.osir .osatt{break-before:page;page-break-before:always}html.briefing .tlr.osir table.osf th{width:96px}}";
    D.head.appendChild(st);
  }
  function opts() {
    var o = { scope: S.scope, from: S.from, to: S.to };
    if (S.region === "@area") { var A = W.TSAP.areaApi, P = A && A.area && A.area(); if (P && P.length >= 3) o.area = P; }
    else if (S.region) o.prov = S.region;
    return CT().opts(S, o);
  }
  function regionText(d) { return S.region === "@area" ? "the drawn area in " + d.country : S.region ? S.region + ", " + d.country : d.country; }
  function autoSubject(d) { return d.scope && d.scope.label && S.scope ? d.scope.label + ", " + regionText(d) : "Open source reporting on " + regionText(d); }
  function presetOf() {
    if (!S.from && !S.to) return "all";
    if (S.to !== today()) return "";
    for (var i = 0; i < PRESETS.length - 1; i++) if (S.from === iso(Date.now() - (+PRESETS[i][0] - 1) * 864e5)) return PRESETS[i][0];
    return "";
  }
  function CT() { return W.OSAP_TLREPORT.custom; }
  function draw() { CT().keepFocus(BOX, draw0); }
  function draw0() {
    var d = S.data, cs = (W.OSAP_COUNTRIES || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var sel = function (v, cur) { return v === cur ? " selected" : ""; };
    if (d && !S.subjectSet) S.subject = autoSubject(d);
    var regs = '<option value="">All of ' + esc(d ? d.country : "the country") + "</option>" + (areaOn() ? '<option value="@area"' + sel("@area", S.region) + ">Drawn area on the map</option>" : "") +
      (d ? d.provinces.map(function (p) { return '<option value="' + esc(p[0]) + '"' + sel(p[0], S.region) + ">" + esc(p[0]) + " (" + p[1] + ")</option>"; }).join("") : "");
    var note, bad = false, pr = presetOf();
    if (!d) note = "Reading the records…";
    else if (d.scope.kwEmpty) { note = "Type the words for your topic; the count updates as you type."; bad = true; }
    else if (d.scope.kw && !d.scope.kwOk) { note = "The words cannot be read, so nothing matches yet."; bad = true; }
    else if (!d.recs.length) { note = "No dated records match. Widen the dates, or pick another topic or region" + (d.scope.kw ? ", or change the words" : "") + "."; bad = true; }
    else note = "<b>" + pl(d.total, "record") + "</b> match" + (d.total === 1 ? "es" : "") + (d.total > d.recs.length ? "; the report covers the latest " + d.recs.length + ", dated " : ", dated ") + esc(d.period) + "; " + pl(d.keyEv.length, "key event") + ".";
    BOX.innerHTML = '<div class="cbox"><div class="chead"><h2 id="os-h">OSIR (Open Source Intelligence Report)</h2><button type="button" class="x" id="os-x" aria-label="Close">×</button></div>' +
      '<p class="obs" style="margin:2px 0 0">Subject, date generated, countries, OSINT disclaimer, summary, main content, end of report, attachments, contributors and sources, from what OSAP holds. Choose what it covers.</p>' +
      '<div class="osg"><label>Country<select id="os-cc">' + cs.map(function (c) { return '<option value="' + esc(c.id) + '"' + sel(c.id, S.cc) + ">" + esc(c.name) + "</option>"; }).join("") + "</select></label>" +
      '<label>Region<select id="os-reg">' + regs + "</select></label>" +
      '<label class="osw">Topic<select id="os-top">' + (d ? d.scopes.map(function (x) { return '<option value="' + esc(x.v) + '"' + sel(x.v, S.scope) + ">" + esc(x.label) + "</option>"; }).join("") : "") +
        '<option value="' + CT().opt + '"' + sel(CT().opt, S.scope) + ">" + esc(CT().label) + "</option></select></label>" + CT().html("os", S, d) +
      '<div class="osw"><div class="osp" role="group" aria-label="Dates">' + PRESETS.map(function (p) { return '<button type="button" data-osp="' + p[0] + '"' + (pr === p[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + p[1] + "</button>"; }).join("") + "</div></div>" +
      '<label>From<input type="date" id="os-from" value="' + esc(S.from) + '"></label><label>To<input type="date" id="os-to" value="' + esc(S.to) + '"></label>' +
      '<label class="osw">Subject<input type="text" id="os-subj" maxlength="200" value="' + esc(S.subject) + '"></label>' +
      '<label class="osw">Prepared by <small>(optional: your name, role or team, as it should appear under Contributors)</small><input type="text" id="os-by" maxlength="120" value="' + esc(S.by) + '"></label>' +
      '<label class="osw">Analyst summary <small>(optional: your own words, shown first and marked as yours; OSAP\'s automatic summary follows)</small><textarea id="os-sum" maxlength="4000">' + esc(S.summary) + "</textarea></label>" + anHtml() + "</div>" +
      '<div class="osn' + (bad ? " bad" : "") + '" id="os-note" aria-live="polite">' + note + "</div>" +
      '<div class="osb"><button type="button" class="refresh primary" id="os-go"' + (!d || !d.recs.length || S.making ? " disabled" : "") + ">" + (S.making ? "Making…" : "Make OSIR") + "</button>" +
      '<button type="button" class="refresh" id="os-save" title="Save what you typed to a file on this device">Save draft</button>' +
      '<button type="button" class="refresh" id="os-open" title="Open a draft file saved from this window">Open draft</button><input type="file" id="os-file" accept=".json,application/json" hidden>' +
      '<button type="button" class="refresh" id="os-close">Close</button></div>' +
      '<p class="obs" style="margin:8px 0 0;font-size:12px">Drafts are files on your device; OSAP stores nothing online. A report remade for the same country and subject on this device gets the next version number and a "supersedes" line.</p></div>';
    BOX.querySelector("#os-x").onclick = close; BOX.querySelector("#os-close").onclick = close;
    BOX.querySelector("#os-cc").onchange = function () { switchCountry(this.value); };
    BOX.querySelector("#os-reg").onchange = function () { S.region = this.value; refresh(); };
    BOX.querySelector("#os-top").onchange = function () { S.scope = this.value; refresh(); };
    CT().bind(BOX, "os", S, refresh);
    BOX.querySelector("#os-from").onchange = function () { S.from = this.value; refresh(); };
    BOX.querySelector("#os-to").onchange = function () { S.to = this.value; refresh(); };
    BOX.querySelector("#os-subj").oninput = function () { S.subject = this.value; S.subjectSet = !!this.value.trim(); };
    BOX.querySelector("#os-by").oninput = function () { S.by = this.value; };
    BOX.querySelector("#os-sum").oninput = function () { S.summary = this.value; };
    Array.prototype.forEach.call(BOX.querySelectorAll("[data-osp]"), function (b) {
      b.onclick = function () { var v = b.getAttribute("data-osp"); if (v === "all") { S.from = ""; S.to = ""; } else { S.from = iso(Date.now() - (+v - 1) * 864e5); S.to = today(); } refresh(); };
    });
    BOX.querySelector("#os-go").onclick = make;
    BOX.querySelector("#os-save").onclick = saveDraft;
    var fi = BOX.querySelector("#os-file"); BOX.querySelector("#os-open").onclick = function () { fi.value = ""; fi.click(); }; fi.onchange = function () { openDraft(fi.files && fi.files[0]); };
    if (S.draftNote && d) { setNote(S.draftNote + " " + BOX.querySelector("#os-note").textContent); S.draftNote = ""; }
    bindAn();
  }
  /* the analyst sections in the window: graded claims, free-text parts, outside sources */
  function propLabel(src) { var p = proposedFor(src); return p ? "— (proposed " + p + "?)" : "—"; }
  function anHtml() {
    var a = S.an, sel = function (list, cur, blank) { return '<option value="">' + blank + "</option>" + list.map(function (v) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + v + "</option>"; }).join(""); };
    var ta = function (k, lab, hint) { return '<label class="osw">' + lab + (hint ? " <small>(" + hint + ")</small>" : "") + '<textarea id="os-an-' + k + '" data-an="' + k + '" maxlength="4000">' + esc(a[k]) + "</textarea></label>"; };
    return '<details class="osx" id="os-anx"' + (S.anOpen || anUsed() ? " open" : "") + '><summary>Analyst sections <small>(optional: graded claims, assessment, confidence, indicators, gaps, outside sources; each is shown as yours)</small></summary><div class="osg">' +
      aiBox() + '<div class="osw"><b>Graded claims</b> <small>Source reliability A–F, information credibility 1–6 (Admiralty). A credible source can still be wrong. Pick one of the report\'s own sources and the catalogue\'s proposed letter shows in the list (for example "— (proposed B?)"); it is only a proposal until you choose a letter.</small></div>' +
      S.claims.map(function (c, i) {
        return '<div class="osrow" data-cl="' + i + '"><label class="osw2">Claim ' + (i + 1) + '<textarea id="os-cl-' + i + '-claim" data-clk="claim" maxlength="1000">' + esc(c.claim) + "</textarea></label>" +
          '<label>Source / originator<input type="text" id="os-cl-' + i + '-src" data-clk="src" maxlength="200" list="os-srcs" value="' + esc(c.src) + '"></label>' +
          '<label>Reliability<select id="os-cl-' + i + '-r" data-clk="r" aria-label="Source reliability, claim ' + (i + 1) + '">' + sel(REL, c.r, propLabel(c.src)) + "</select></label>" +
          '<label>Credibility<select id="os-cl-' + i + '-c" data-clk="c" aria-label="Information credibility, claim ' + (i + 1) + '">' + sel(CRED, c.c, "—") + "</select></label>" +
          '<button type="button" class="refresh" data-cldel="' + i + '" aria-label="Remove claim ' + (i + 1) + '">×</button>' +
          '<label class="osw2">Corroboration <small>(optional)</small><input type="text" id="os-cl-' + i + '-note" data-clk="note" maxlength="400" value="' + esc(c.note) + '"></label></div>';
      }).join("") +
      '<datalist id="os-srcs">' + srcNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
      (S.claims.length < MAXROWS ? '<button type="button" class="refresh osadd" id="os-cl-add">Add claim</button>' : "") +
      ta("assess", "Assessment") + ta("alt", "Alternative explanations") +
      '<label>Analytic confidence<select id="os-an-conf">' + sel(CONF, a.conf, "Not stated") + "</select></label>" +
      '<label>Confidence note <small>(optional)</small><input type="text" id="os-an-confNote" data-an="confNote" maxlength="400" value="' + esc(a.confNote) + '"></label>' +
      '<label class="osw">Relevance heading <small>(for example "USSOF relevance")</small><input type="text" id="os-an-relLabel" data-an="relLabel" maxlength="60" value="' + esc(a.relLabel) + '"></label>' +
      ta("rel", "Relevance") + ta("ind", "Indicators to watch", "one per line") + ta("gaps", "Intelligence gaps", "one per line") +
      '<div class="osw"><b>Outside sources</b> <small>Sources you cite that OSAP does not hold. Listed after OSAP\'s own and marked as yours; OSAP does not check them.</small></div>' +
      S.outs.map(function (x, i) {
        return '<div class="osrow" data-out="' + i + '"><label class="osw2">Source ' + (i + 1) + ' title<input type="text" id="os-out-' + i + '-title" data-outk="title" maxlength="300" value="' + esc(x.title) + '"></label>' +
          '<label>Link <small>(https://…)</small><input type="url" id="os-out-' + i + '-url" data-outk="url" maxlength="600" value="' + esc(x.url) + '"></label>' +
          '<label>Reliability<select id="os-out-' + i + '-r" data-outk="r" aria-label="Reliability, outside source ' + (i + 1) + '">' + sel(REL, x.r, "—") + "</select></label><span></span>" +
          '<button type="button" class="refresh" data-outdel="' + i + '" aria-label="Remove outside source ' + (i + 1) + '">×</button>' +
          '<label class="osw2">Note <small>(optional)</small><input type="text" id="os-out-' + i + '-note" data-outk="note" maxlength="300" value="' + esc(x.note) + '"></label></div>';
      }).join("") +
      (S.outs.length < MAXROWS ? '<button type="button" class="refresh osadd" id="os-out-add">Add outside source</button>' : "") +
      "</div></details>";
  }
  function bindAn() {
    var each = function (s, f) { Array.prototype.forEach.call(BOX.querySelectorAll(s), f); };
    var det = BOX.querySelector("#os-anx"); if (!det) return;
    det.ontoggle = function () { S.anOpen = det.open; };
    each("[data-an]", function (el) { el.oninput = function () { S.an[el.getAttribute("data-an")] = el.value; }; });
    BOX.querySelector("#os-an-conf").onchange = function () { S.an.conf = this.value; };
    each("[data-cl]", function (row) {
      var c = S.claims[+row.getAttribute("data-cl")], r = row.querySelector('[data-clk="r"]');
      Array.prototype.forEach.call(row.querySelectorAll("[data-clk]"), function (el) { el.oninput = el.onchange = function () { c[el.getAttribute("data-clk")] = el.value; if (el.getAttribute("data-clk") === "src" && r && r.options[0]) r.options[0].textContent = propLabel(el.value); }; });
    });
    each("[data-out]", function (row) { var x = S.outs[+row.getAttribute("data-out")]; Array.prototype.forEach.call(row.querySelectorAll("[data-outk]"), function (el) { el.oninput = el.onchange = function () { x[el.getAttribute("data-outk")] = el.value; }; }); });
    var again = function (focus) { S.anOpen = true; draw(); var f = focus && BOX.querySelector(focus); if (f) f.focus(); };
    var af = BOX.querySelector("#os-ai-fill"); if (af) af.onclick = fillFromAi;
    var ca = BOX.querySelector("#os-cl-add"); if (ca) ca.onclick = function () { S.claims.push({ claim: "", src: "", r: "", c: "", note: "" }); again("#os-cl-" + (S.claims.length - 1) + "-claim"); };
    var oa = BOX.querySelector("#os-out-add"); if (oa) oa.onclick = function () { S.outs.push({ title: "", url: "", r: "", note: "" }); again("#os-out-" + (S.outs.length - 1) + "-title"); };
    each("[data-cldel]", function (b) { b.onclick = function () { S.claims.splice(+b.getAttribute("data-cldel"), 1); again("#os-cl-add"); }; });
    each("[data-outdel]", function (b) { b.onclick = function () { S.outs.splice(+b.getAttribute("data-outdel"), 1); again("#os-out-add"); }; });
  }
  /* read the records for the current choice; a newer choice replaces an older one still being read */
  function refresh() {
    var n = ++S.seq; S.data = null; draw();
    W.OSAP_TLREPORT.data(opts(), function (d) {
      if (n !== S.seq || !BOX || BOX.hidden) return;
      if (S.scope && S.scope !== CT().opt && !d.scopes.some(function (x) { return x.v === S.scope; })) d.scopes.push({ v: S.scope, label: d.scope.label || S.scope });
      if (S.region && S.region !== "@area" && !d.provinces.some(function (p) { return p[0] === S.region; })) d.provinces.push([S.region, 0]);
      S.data = d; draw();
    });
  }
  function switchCountry(cc) {
    if (!cc || cc === S.cc) return;
    try { sessionStorage.setItem(PEND, JSON.stringify({ cc: cc, from: S.from, to: S.to, t: Date.now() })); } catch (e) {}
    BOX.querySelector("#os-note").textContent = "Opening " + ((W.OSAP_COUNTRIES || []).filter(function (c) { return c.id === cc; })[0] || { name: cc }).name + "; this window comes back when it has loaded.";
    location.hash = "#" + (cc === "th" ? "" : cc + "/") + "timeline";
  }
  function open(pre) {
    if (!W.TSAP || !W.OSAP_TLREPORT || !W.OSAP_TLREPORT.data) return false;
    css();
    if (!BOX) {
      BOX = D.createElement("div"); BOX.id = "osirdlg"; BOX.hidden = true; BOX.setAttribute("role", "dialog"); BOX.setAttribute("aria-modal", "true"); BOX.setAttribute("aria-labelledby", "os-h");
      BOX.addEventListener("click", function (e) { if (e.target === BOX) close(); });
      D.body.appendChild(BOX);
    }
    var p = appPeriod(), tl = W.TSAP.timeline ? W.TSAP.timeline() : null, v = (location.hash || "").replace("#", "").split("/").pop();
    S.cc = W.TSAP.country; S.region = areaOn() ? "@area" : ""; S.from = p.from; S.to = p.to; S.subject = ""; S.subjectSet = false; S.summary = ""; S.by = getLS(WHO); anReset(); CT().load(S);
    /* the topic on screen: an open conflict tab, else the open data set, else everything */
    S.scope = tl && tl.cf ? "cf-" + tl.cf : v && v !== "timeline" && v !== "alerts" ? v : "";
    if (pre) { ["from", "to", "scope", "region"].forEach(function (k) { if (pre[k] != null) S[k] = pre[k]; }); }
    BOX.hidden = false; refresh();
    loadAiDraft(function () { if (BOX && !BOX.hidden && aiDraftFor() && S.data) draw(); });
    var f = BOX.querySelector("#os-top"); if (f) f.focus();
    return true;
  }
  function close() { if (BOX) BOX.hidden = true; S.seq++; }

  /* ---------- the report ---------- */
  var EL = null, fpJobs = [], title0 = "";
  /* the period before this one, of the same length (only when both dates are set) */
  function prevPeriod(from, to) {
    if (!from || !to || to < from) return null;
    var f = Date.parse(from + "T00:00:00Z"), t = Date.parse(to + "T00:00:00Z"), n = Math.round((t - f) / 864e5) + 1;
    return { from: iso(f - n * 864e5), to: iso(f - 864e5), days: n };
  }
  /* the Deep South peace tracker (Thailand only), loaded on first use; its lines are claims with their sources */
  function peace(cc, cb) {
    if (cc !== "th") return cb(null);
    if (W.OSAP_DSPEACE) return cb(W.OSAP_DSPEACE);
    var done = false, fin = function () { if (!done) { done = true; cb(W.OSAP_DSPEACE || null); } };
    var sc = D.createElement("script"); sc.src = "data/thailand/deepsouth-peace.js"; sc.onload = sc.onerror = fin; D.head.appendChild(sc); setTimeout(fin, 5000);
  }
  function make() {
    var d = S.data; if (!d || !d.recs.length || S.making) return;
    setLS(WHO, S.by.trim());
    var pp = prevPeriod(S.from, S.to), n = S.seq;
    S.making = true; draw();
    var go = function (base, pc) {
      S.making = false;
      if (n !== S.seq || !BOX || BOX.hidden) return;
      make2(d, base, pc);
    };
    peace(d.cc, function (pc) {
      if (!pp) return go(null, pc);
      var o = opts(); o.from = pp.from; o.to = pp.to;
      W.OSAP_TLREPORT.data(o, function (b) { go({ from: pp.from, to: pp.to, days: pp.days, recs: b.recs, total: b.total }, pc); });
    });
  }
  function make2(d, base, pc) {
    var now = Date.now(), subject = S.subject.trim() || autoSubject(d), prior = versOf(d.cc, subject);
    var html = build(d, { subject: subject, by: S.by.trim(), summary: S.summary.trim(), region: regionText(d), now: now, an: anData(),
      base: base, peace: pc, from: S.from, to: S.to, version: prior.length + 1, supersedes: prior.length ? prior[prior.length - 1].no : "" });
    versAdd(d.cc, subject, "OSIR-" + String(d.cc).toUpperCase() + "-" + dtg(now).replace(/ /g, ""), now);
    close();
    EL = D.getElementById("brief"); if (!EL) return;
    EL.hidden = false; D.documentElement.classList.add("briefing");
    EL.innerHTML = html; EL.scrollTop = 0;
    D.getElementById("osir-close").onclick = closeReport;
    D.getElementById("osir-back").onclick = function () { closeReport(); BOX.hidden = false; draw(); };
    D.getElementById("osir-print").onclick = printIt;
    pageFooter(EL.querySelector(".osir").getAttribute("data-osir"));
    fill(d.recs);
  }
  /* the report number and "page X of Y" in the bottom margin of every printed page (browsers that print page-margin boxes) */
  function pageFooter(no) {
    var st = D.getElementById("osir-page"); if (!st) { st = D.createElement("style"); st.id = "osir-page"; D.head.appendChild(st); }
    var q = String(no).replace(/[^A-Z0-9-]/gi, "");
    st.textContent = "@media print{@page{@bottom-left{content:'" + q + " \\B7  UNCLASSIFIED // OPEN SOURCE';font:8.5px system-ui,sans-serif;color:#55616b}" +
      "@bottom-right{content:'Page ' counter(page) ' of ' counter(pages);font:8.5px system-ui,sans-serif;color:#55616b}}}";
  }
  /* the analyst sections as the report uses them: trimmed, empty rows left out */
  function anData() {
    var a = S.an, t = function (v) { return String(v || "").trim(); };
    return { assess: t(a.assess), alt: t(a.alt), conf: a.conf, confNote: t(a.confNote), relLabel: t(a.relLabel) || "Relevance", rel: t(a.rel), ind: t(a.ind), gaps: t(a.gaps),
      dispo: { assess: dispo("assess", a.assess), alt: dispo("alt", a.alt), conf: dispo("conf", a.conf) || dispo("confNote", a.confNote), ind: dispo("ind", a.ind), gaps: dispo("gaps", a.gaps) },
      aiFrom: S.aiFrom,
      claims: S.claims.filter(claimUsed).map(function (c) { return { claim: t(c.claim), src: t(c.src), r: c.r, c: c.c, note: t(c.note), ai: claimDispo(c) }; }),
      outs: S.outs.filter(outUsed).map(function (x) { return { title: t(x.title) || t(x.url), url: t(x.url), r: x.r, note: t(x.note) }; }) };
  }
  /* change from the previous period: counts by kind and province side by side, and the peace tracker's lines in this period */
  function change(d, o) {
    var b = o.base, pc = o.peace, h = "";
    var rows = function (cur, prev, n) {
      var ks = Object.keys(cur).concat(Object.keys(prev)).filter(function (k, i, a) { return a.indexOf(k) === i; });
      ks.sort(function (x, y) { return ((cur[y] || 0) + (prev[y] || 0)) - ((cur[x] || 0) + (prev[x] || 0)) || x.localeCompare(y); });
      return ks.slice(0, n).map(function (k) { var c = cur[k] || 0, p = prev[k] || 0, dl = c - p; return "<tr><td>" + esc(k) + "</td><td>" + c + "</td><td>" + p + "</td><td>" + (dl > 0 ? "+" : dl < 0 ? "\u2212" : "") + Math.abs(dl) + "</td></tr>"; }).join("");
    };
    var count = function (recs, f) { var o2 = {}; recs.forEach(function (r) { f(r).forEach(function (k) { if (k) o2[k] = (o2[k] || 0) + 1; }); }); return o2; };
    if (b) {
      var cat = function (r) { return [r.cat || "Other"]; };
      var cK = count(d.recs, cat), pK = count(b.recs, cat), cP = count(d.recs, d.provsOf), pP = count(b.recs, d.provsOf);
      var head = "<thead><tr><th></th><th>This period</th><th>Previous</th><th>Change</th></tr></thead>";
      var dt = d.total - b.total;
      h += '<p class="bm" data-osf="change">' + esc(fmtShort(o.from) + " to " + fmtShort(o.to)) + " against the " + b.days + " days before (" + esc(fmtShort(b.from) + " to " + fmtShort(b.to)) + "): " +
        pl(d.total, "record") + " against " + b.total + " (" + (dt > 0 ? "+" : dt < 0 ? "\u2212" : "") + Math.abs(dt) + ")." +
        (d.recs.length < d.total || b.recs.length < b.total ? " The tables count the latest " + d.recs.length + " and " + b.recs.length + " records the report holds." : "") + "</p>" +
        '<div class="osdual"><div><table class="osch" data-osf="change-kind"><caption><b>Table 2.</b> Records by kind</caption>' + head + "<tbody>" + rows(cK, pK, 8) + "</tbody></table></div>" +
        (Object.keys(cP).length || Object.keys(pP).length ? '<div><table class="osch" data-osf="change-prov"><caption><b>Table 3.</b> Records by province</caption>' + head + "<tbody>" + rows(cP, pP, 8) + "</tbody></table></div>" : "") + "</div>";
    }
    if (pc && o.from && o.to) {
      var ln = (pc.rounds || []).filter(function (r) { return r.date >= o.from && r.date <= o.to; });
      h += '<p class="bm" style="margin-bottom:0"><b>Peace talks tracker</b> (OSAP\'s hand-kept Deep South tracker; each line is what an official, a party or an outlet said, with its source). ' + (ln.length ? "Lines dated in this period:" : "No line is dated in this period.") + "</p>" +
        (ln.length ? '<ul class="ospeace" data-osf="change-peace">' + ln.map(function (r) {
          var e = (r.evidence || [])[0] || {}, u = safeUrl(e.src);
          return "<li>" + esc(fmtShort(r.date)) + (r.place ? ", " + esc(r.place) : "") + ": " + esc(r.what) + (u ? ' (<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(e.srcname || host(u)) + "</a>)" : "") + "</li>";
        }).join("") + "</ul>" : "") +
        (pc.status && pc.status.short ? '<p class="bm">Tracker status as of ' + esc(fmtShort(pc.status.asof)) + ": " + esc(pc.status.short) + "</p>" : "");
    }
    return h;
  }
  /* the contributors line for parts that came from the AI draft: how many as drafted, how many edited */
  function aiUsed(an) {
    var D0 = an.dispo || {}, raw = 0, ed = 0;
    Object.keys(D0).forEach(function (k) { if (D0[k] === "ai") raw++; else if (D0[k] === "edited") ed++; });
    an.claims.forEach(function (c) { if (c.ai === "ai") raw++; else if (c.ai === "edited") ed++; });
    if (!raw && !ed) return "";
    var f = an.aiFrom || {};
    return pl(raw + ed, "part") + " filled from a draft by " + esc(f.model || "an AI model") + (f.made ? " (" + esc(f.made) + ")" : "") + " from the OSAP records it cites: " +
      raw + " as drafted, tagged AI generated (a draft, not analyst-approved); " + ed + " edited by the preparer. The Summary is never AI-drafted.";
  }
  function build(d, o) {
    var recs = d.recs, keyEv = d.keyEv, m = d.map, bars = d.barsDay || d.bars, now = o.now;
    var no = "OSIR-" + String(d.cc).toUpperCase() + "-" + dtg(now).replace(/ /g, "");
    /* sources, numbered in order of first appearance (the same numbers as each chronology entry) */
    var srcs = [], sno = {};
    recs.forEach(function (r) { var k = r.src.id || r.src.name; if (!sno[k]) { srcs.push({ s: r.src, n: 0, hosts: {} }); sno[k] = srcs.length; } var x = srcs[sno[k] - 1]; x.n++; var h = host(safeUrl(r.url)); if (h) x.hosts[h] = 1; });
    var days = {}, kinds = { observation: 0, claim: 0, event: 0 }, perProv = {}, perCat = {};
    recs.forEach(function (r) {
      days[r.__tlw.day] = 1; kinds[r.type] = (kinds[r.type] || 0) + 1;
      d.provsOf(r).forEach(function (p) { perProv[p] = (perProv[p] || 0) + 1; });
      if (r.cat) perCat[r.cat] = (perCat[r.cat] || 0) + 1;
    });
    var first = recs[0].__tlw, last = recs[recs.length - 1].__tlw;
    /* automatic summary: counts by fixed rules, no AI */
    var pts = [pl(recs.length, "dated record") + " from " + pl(srcs.length, "source") + ", " + fmtShort(first.day) + " to " + fmtShort(last.day) + ": " +
      pl(kinds.event || 0, "sourced report") + ", " + pl(kinds.claim || 0, "official statement") + (kinds.observation ? ", " + pl(kinds.observation, "instrument reading") : "") + "."];
    if (bars && bars.peakN > 1) pts.push(bars.unit === "day" ? "Busiest day: " + fmtShort(bars.peak) + ", with " + bars.peakN + " records (the daily average is " + (Math.round(bars.mean * 10) / 10) + ")." :
      "Busiest month: " + new Date(bars.peak + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) + ", with " + bars.peakN + " records (the monthly average is " + (Math.round(bars.mean * 10) / 10) + ").");
    var tp = topN(perProv, 3); if (tp.length) pts.push("Most often named province" + (tp.length > 1 ? "s" : "") + ": " + list3(tp) + ".");
    var tc = topN(perCat, 3); if (tc.length) pts.push("Commonest kind" + (tc.length > 1 ? "s" : "") + " of record: " + list3(tc) + ".");
    pts.push(keyEv.length ? pl(keyEv.length, "key event") + " in the main content" + (d.grouped ? ", " + d.grouped + " of them reported by two or more sources" : "") + "." : "No record meets the rules for a key event.");
    var ai = keyEv.filter(function (e) { return e.sum && e.sum.method !== "extract"; }).length, ext = keyEv.filter(function (e) { return e.sum && e.sum.method === "extract"; }).length;
    var tag = function (t, tip) { return ' <span class="aitag" tabindex="0" title="' + esc(tip) + '">' + t + "</span>"; };
    /* analyst sections: each part only when filled in, numbered ahead of OSAP's own key events and map */
    var an = o.an || { claims: [], outs: [] }, sub = 0, ANT = tag("Analyst", "Written by the person who made this report, as typed; OSAP adds no judgment.");
    var DSP = an.dispo || {}, AIM = an.aiFrom && an.aiFrom.model ? " (" + an.aiFrom.model + ", " + an.aiFrom.made + ")" : "";
    var AIT = tag("AI generated", "Drafted by AI" + AIM + " from the OSAP records it cites, and not changed by the analyst: a draft, not analyst-approved.");
    var EDT = tag("Analyst, edited from AI draft", "Drafted by AI" + AIM + ", then changed by the person who made this report.");
    var tagOf = function (k) { return DSP[k] === "ai" ? AIT : DSP[k] === "edited" ? EDT : ANT; };
    var h4 = function (t, osf, k) { sub++; return '<h4 class="oss"' + (osf ? ' data-osf="' + osf + '"' : "") + ">3." + sub + " " + esc(t) + (k === "claims" ? ANT + (an.claims.some(function (c) { return c.ai; }) ? AIT.replace("and not changed by the analyst", "rows marked AI are as drafted") : "") : tagOf(k)) + "</h4>"; };
    var para = function (t, osf) { return '<div class="osanb" data-osf="' + osf + '">' + esc(t) + "</div>"; };
    var lines = function (t, osf) { return '<ul class="osli" data-osf="' + osf + '">' + t.split(/\n+/).map(function (x) { return x.replace(/^\s*[-*•]\s*/, "").trim(); }).filter(Boolean).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; };
    var anMain = (an.claims.length ? h4("Graded claims", "an-claims-h", "claims") + '<table class="oscl" data-osf="an-claims"><caption style="text-align:left;caption-side:top"><b>Table A.</b> Claims as graded by the analyst. Source reliability A–F, information credibility 1–6 (key in the attachments). A claim is what a source said, not a confirmed fact.</caption>' +
        "<thead><tr><th>No.</th><th>Claim</th><th>Source / originator</th><th>Grade</th><th>Corroboration</th></tr></thead><tbody>" +
        an.claims.map(function (c, i) { return "<tr" + (c.ai ? ' data-ai="' + c.ai + '"' : "") + "><td>" + (i + 1) + (c.ai === "ai" ? ' <small title="As drafted by AI; not analyst-approved">AI</small>' : c.ai === "edited" ? ' <small title="Drafted by AI, then changed by the analyst">AI, edited</small>' : "") + "</td><td>" + esc(c.claim) + "</td><td>" + esc(c.src) + '</td><td class="g" title="' + esc((c.r ? c.r + " " + RELN[c.r] : "Reliability not stated") + "; " + (c.c ? c.c + " " + CREDN[c.c] : "credibility not stated")) + '">' + esc(grade(c.r, c.c)) + "</td><td>" + esc(c.note) + "</td></tr>"; }).join("") + "</tbody></table>" : "") +
      (an.assess ? h4("Assessment", "", "assess") + para(an.assess, "an-assess") : "") +
      (an.alt ? h4("Alternative explanations", "", "alt") + para(an.alt, "an-alt") : "") +
      (an.conf || an.confNote ? h4("Analytic confidence", "", "conf") + '<p class="osconf" data-osf="an-conf">' + (an.conf ? "<b>" + esc(an.conf) + "</b>" : "Not stated") + (an.confNote ? ". " + esc(an.confNote) : "") + "</p>" : "") +
      (an.rel ? h4(an.relLabel) + para(an.rel, "an-rel") : "") +
      (an.ind ? h4("Indicators to watch", "", "ind") + lines(an.ind, "an-ind") : "") +
      (an.gaps ? h4("Intelligence gaps", "", "gaps") + lines(an.gaps, "an-gaps") : "");
    var anParts = sub, graded = an.claims.some(function (c) { return c.r || c.c; }) || an.outs.some(function (x) { return x.r; });
    var kNo = "3." + (++sub), wNo = "3." + (++sub), ch = change(d, o), cNo = ch ? "3." + (++sub) : "";
    var period = d.period + (recs.length < d.total ? " (latest " + recs.length + " of " + d.total + " records)" : "");
    var gen = T().dualT(now, { date: true });

    var html = '<div class="bbar noprint tlrbar"><button type="button" class="refresh primary" id="osir-print">Print</button> <button type="button" class="refresh" id="osir-back">Change choices</button> ' +
      '<button type="button" class="refresh" id="osir-close">Close</button> <span class="obs">Use the print dialog\'s "Save as PDF" to keep a copy.</span></div>' +
      '<article class="bpage tlr osir" data-osir="' + esc(no) + '"><div class="osban">UNCLASSIFIED // OPEN SOURCE</div>' +
      '<header class="tlrh"><img src="' + esc((D.querySelector(".brand .logo") || {}).src || "assets/logo.png") + '" alt="AXIOM OSAP"><div class="tlrt"><div class="tlrk">AXIOM OSAP · Open Source Intelligence Report</div><h2>OSIR</h2>' +
      '<div class="tlrsubt">' + esc(no) + "</div></div></header><div class=\"tlrrule\"></div>" +
      /* 1-3: Subject, Date generated, Country/s */
      '<table class="osf"><tbody><tr><th scope="row">Subject</th><td><b data-osf="subject">' + esc(o.subject) + '</b><br><small>Covers ' + esc(d.scope && d.scope.label && S.scope ? d.scope.label : "all reporting") + ", " + esc(period) + (d.scope && d.scope.kw ? '; custom topic: records whose text matches <span data-osf="words">' + esc(d.scope.kw) + "</span>" : "") + "</small></td></tr>" +
      '<tr><th scope="row">Date generated</th><td><span data-osf="generated">' + esc(dtg(now)) + " · " + esc(gen) + '</span><br><small data-osf="version">Version ' + (o.version || 1) + (o.supersedes ? ", supersedes " + esc(o.supersedes) : ", the first on this subject made on this device") + "</small></td></tr>" +
      '<tr><th scope="row">Country/s</th><td data-osf="countries">' + esc(d.country) + (S.region ? " (" + esc(S.region === "@area" ? "drawn area" : S.region) + ")" : "") + "</td></tr></tbody></table>" +
      /* 4: OSINT disclaimer */
      '<h3 class="tls"><span class="no">1</span>OSINT disclaimer</h3><p class="osdisc" data-osf="disclaimer">' + esc(DISCLAIMER) + "</p>" +
      /* 5: Summary */
      '<h3 class="tls"><span class="no">2</span>Summary</h3>' +
      (o.summary ? '<h4 class="oss">Analyst summary' + tag("Analyst", "Written by the person who made this report, as typed.") + '</h4><div class="osan" data-osf="analyst">' + esc(o.summary) + "</div>" +
        '<h4 class="oss">Automatic summary' + tag("Automatic", "Counts by fixed rules from the records in Attachment 1 (no AI), not analyst-approved.") + "</h4>" :
        '<p class="bm" style="margin:0">' + tag("Automatic", "Counts by fixed rules from the records in Attachment 1 (no AI), not analyst-approved.").slice(1) + " Counts by fixed rules from the records in Attachment 1; not a judgment.</p>") +
      '<ul class="tlrpts" data-osf="summary">' + pts.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      /* 6: Main content: key events, where, trend */
      '<h3 class="tls"><span class="no">3</span>Main content</h3>' + anMain +
      '<h4 class="oss">' + kNo + ' Key events' + tag("Automatic", "Picked by fixed rules, not by AI or an analyst: incidents reported by two or more sources first, then single records scored by kind (agreement, strike, clash, closure), casualties, escalation wording and surges in reporting.") + "</h4>" +
      (keyEv.length ? '<table class="tlrkt" data-osf="keyevents"><caption><b>Table 1.</b> Key events in date order; numbers match Figure 1. Each is what its sources reported, not a confirmed fact.</caption><colgroup><col class="ckn"><col class="ckd"><col></colgroup><thead><tr><th>No.</th><th>Date</th><th>Event</th></tr></thead><tbody>' +
        keyEv.map(d.rowHtml).join("") + "</tbody></table>" : '<p class="bm">No record in these dates meets the rules for a key event (a clash, strike, closure, agreement, casualties or a surge in reporting).</p>') +
      (m ? '<h4 class="oss">' + wNo + ' Where</h4><p class="tlrfigc"><b>Figure 1.</b> Records and key events, ' + esc(d.period) + '</p><div class="tlrfig">' + m.svg + '<aside class="tlrside">' + d.legend(m, keyEv) +
        (bars ? "<div><h4>Figure 2. Records per " + (bars.unit || "month") + "</h4>" + bars.svg + "</div>" : "") + "</aside></div>" +
        '<p class="tlrsrcn">' + m.mapped + " records mapped" + (m.unmapped ? "; " + m.unmapped + " have no map position" : "") + (m.outside ? "; " + m.outside + " fall outside this map" : "") +
        ". Positions are as precise as each source allows. Borders and names: Natural Earth (public domain).</p>" : "") +
      (ch ? '<h4 class="oss" data-osf="change-h">' + cNo + " Change from the previous period" + tag("Automatic", "Counts by fixed rules, this period against the one before it of the same length (no AI), not analyst-approved. More or fewer records can mean more or less reporting, not more or less activity.") + "</h4>" + ch : "") +
      /* 7: End of report */
      '<div class="osend" data-osf="end">END OF REPORT</div>' +
      /* 8: Attachments */
      '<section class="osatt tlrann"><h3 class="tls"><span class="no">4</span>Attachments</h3><p class="bm">Attachment 1. Chronology: every record, oldest first, ' + esc(period) + '. Each time is in Zulu and local time; each record keeps its source number, link and SHA-256 fingerprint.</p>' +
      '<div data-osf="attachments">' + recs.map(function (r) { return d.entryHtml(r, sno[r.src.id || r.src.name]); }).join("") + "</div>" +
      (graded ? '<p class="bm" data-osf="gradekey"><b>Attachment 2. Grading key (Admiralty).</b> Source reliability: ' + REL.map(function (k) { return k + " " + RELN[k]; }).join("; ") + ". Information credibility: " + CRED.map(function (k) { return k + " " + CREDN[k]; }).join("; ") + ". Grades are the analyst's own.</p>" : "") +
      "</section>" +
      /* 9: Contributors */
      '<h3 class="tls"><span class="no">5</span>Contributors</h3><ul class="oscon" data-osf="contributors">' +
      "<li><b>Prepared by:</b> " + (o.by ? esc(o.by) : "not stated") + "</li>" +
      "<li><b>Compiled by:</b> AXIOM OSAP on this device, from " + pl(srcs.length, "open source") + "; counts, groupings and key events by fixed rules (no AI).</li>" +
      (ai ? "<li><b>AI:</b> " + pl(ai, "key-event summary", "key-event summaries") + " drafted by " + esc((W.OSAP_EVSUM && W.OSAP_EVSUM.model) || "an AI model") + ", tagged AI generated; drafts, not analyst-approved.</li>" : "") +
      (ext ? "<li><b>Automatic extracts:</b> " + pl(ext, "key-event summary", "key-event summaries") + " taken from the reports by fixed rules (no AI).</li>" : "") +
      (anParts || an.outs.length ? "<li><b>Analyst sections:</b> " + (anParts ? pl(anParts, "part") + " of the main content" : "") + (anParts && an.outs.length ? " and " : "") + (an.outs.length ? pl(an.outs.length, "outside source") : "") + " written by the preparer, as typed, tagged Analyst; OSAP did not check them.</li>" : "") +
      (aiUsed(an) ? '<li data-osf="ai-draft"><b>AI draft:</b> ' + aiUsed(an) + "</li>" : "") +
      "<li><b>Analyst review:</b> " + (o.summary || anParts ? "the analyst summary and analyst sections are the preparer's own; the rest is not analyst-reviewed." : "none recorded.") + "</li></ul>" +
      /* 10: Sources */
      '<h3 class="tls"><span class="no">6</span>Sources</h3><ol class="tlrsrc" data-osf="sources">' + srcs.map(function (x) {
        var u = safeUrl(x.s.url), hs = Object.keys(x.hosts).slice(0, 3);
        return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(x.s.name) + "</a>" : esc(x.s.name)) +
          (x.s.kind ? ", " + esc(x.s.kind) : "") + " · " + pl(x.n, "record") + (hs.length ? " · " + esc(hs.join(", ")) : "") + (x.s.proposed ? " · reliability " + esc(x.s.proposed) + "?" : "") + "</li>";
      }).join("") + "</ol>" +
      (an.outs.length ? '<h4 class="oss">Outside sources' + tag("Analyst", "Cited by the person who made this report. OSAP does not hold or check these sources, and they are not in the report fingerprint.") + '</h4><ol class="tlrsrc" start="' + (srcs.length + 1) + '" data-osf="outside">' + an.outs.map(function (x) {
        var u = safeUrl(x.url);
        return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title) + "</a>" : esc(x.title) + (x.url ? " (" + esc(x.url) + ")" : "")) + (x.r ? " · reliability " + esc(x.r) + " (analyst)" : "") + (x.note ? " · " + esc(x.note) : "") + "</li>";
      }).join("") + "</ol>" : "") +
      '<p class="bm">Reliability letters with a question mark are proposed by the build from the kind of source; none has been set by an analyst, and a reliable source can still be wrong. Sources are linked, not stored.</p>' +
      '<footer class="tlrf">Report fingerprint (SHA-256 over the ' + recs.length + ' record fingerprints in Attachment 1, in order): <span class="mg" id="osir-fp">computing…</span></footer>' +
      '<div class="osban end">UNCLASSIFIED // OPEN SOURCE</div></article>';
    return html;
  }
  /* record fingerprints: fill in as computed, then the report fingerprint over all of them in order */
  function fill(recs) {
    fpJobs = recs.map(function (r) { var h = W.TSAP.fingerprints[r.id]; return h ? Promise.resolve(h) : W.TSAP.fingerprint(r); });
    return Promise.all(fpJobs).then(function (hs) {
      if (!EL || EL.hidden || !EL.querySelector(".osir")) return;
      recs.forEach(function (r, i) { Array.prototype.forEach.call(EL.querySelectorAll('[data-tlfp="' + r.id + '"]'), function (s) { s.textContent = hs[i]; }); });
      if (!(W.crypto && crypto.subtle)) return;
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(hs.join("\n"))).then(function (b) { var f = D.getElementById("osir-fp"); if (f) f.textContent = hex(b); });
    });
  }
  /* print once every fingerprint is on the page; the document title becomes the file name Save as PDF offers */
  function printIt() {
    var a = EL && EL.querySelector(".osir"); if (!a) return;
    Promise.all(fpJobs).catch(function () {}).then(function () {
      title0 = D.title; D.title = a.getAttribute("data-osir");
      var back = function () { D.title = title0; W.removeEventListener("afterprint", back); };
      W.addEventListener("afterprint", back);
      setTimeout(function () { try { W.print(); } catch (e) {} setTimeout(back, 3000); }, 60);
    });
  }
  function closeReport() { var st = D.getElementById("osir-page"); if (st) st.remove(); if (!EL) return; EL.hidden = true; EL.innerHTML = ""; D.documentElement.classList.remove("briefing"); }
  D.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (BOX && !BOX.hidden) close(); else if (EL && !EL.hidden && EL.querySelector(".osir")) closeReport();
  });

  /* back after switching country from the window: open it again with the same dates */
  function resume() {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(PEND) || "null"); sessionStorage.removeItem(PEND); } catch (e) {}
    if (p && p.cc === W.TSAP.country && Date.now() - p.t < 120000) setTimeout(function () { open({ from: p.from, to: p.to, scope: "", region: "" }); }, 2500);
  }
  (function wait(i) { if (W.TSAP && W.OSAP_TLREPORT && W.OSAP_TIME) resume(); else if (i < 240) setTimeout(function () { wait(i + 1); }, 250); })(0);
  W.OSAP_OSIR = { open: open, close: close, _state: function () { return S; }, _build: build };
})();
