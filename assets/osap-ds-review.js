/* Deep South incident review (Conflict Coverage plan, Phase 2), a section on the Deep South conflict tab (under Recent reports,
   added through window.OSAP_CF_HOOKS like the other tab extras). Shows the machine's suggestions of
   which reports describe the same incident (data/live/ds-incidents.json, tools/incident_lib.mjs) and lets the analyst decide:
   "Same incident", "Not this incident", or an assessment of one claim (corroborated, confirmed, disputed, withdrawn). A decision is
   never made here: each button opens a ready-filled GitHub issue that the analyst checks, gives a reason and submits. The refresh
   job records only issues the repository owner opened (tools/decision_lib.mjs), answers and closes them, and the next file shows
   the result. Nothing on this page changes a report, a claim or a suggestion by itself. */
(function () {
  if (window.OSAP_DS_REVIEW) return;
  var REPO = "https://github.com/01shane89-jpg/AXIOM-APSAP", FILE = "data/live/ds-incidents.json";
  var css = document.createElement("style");
  css.textContent =
    ".dsr-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.dsr-tabs button{font:inherit;font-size:12px;padding:4px 9px;border:1px solid var(--line);" +
    "border-radius:999px;background:var(--surface);color:var(--ink);cursor:pointer;min-height:28px}.dsr-tabs button[aria-pressed=true]{background:var(--ink);color:var(--surface);border-color:var(--ink)}" +
    ".dsr-c{border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:8px 0}.dsr-c h3{margin:0 0 2px;font-size:13px}" +
    ".dsr-st{display:inline-block;font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin-left:4px}" +
    ".dsr-st.ok{border-color:#1F8A4C;color:#1F8A4C}.dsr-r{margin:6px 0 0;padding:6px 0 0;border-top:1px dashed var(--line);font-size:12.5px}" +
    ".dsr-r a{color:inherit}.dsr-cl{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.dsr-cl label{font-size:11.5px;display:inline-flex;align-items:center;gap:4px;" +
    "border:1px solid var(--line);border-radius:4px;padding:2px 4px}.dsr-cl select{font:inherit;font-size:11.5px;max-width:9em}" +
    ".dsr-b{font:inherit;font-size:12px;padding:4px 9px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer;min-height:28px;margin:6px 6px 0 0}" +
    ".dsr-a{font-weight:600}.dsr-a.corroborated,.dsr-a.confirmed{color:#1F8A4C}.dsr-a.disputed,.dsr-a.withdrawn{color:var(--bad,#C0392B)}";
  document.head.appendChild(css);

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function when(t) { t = String(t || ""); return t ? t.slice(0, 16).replace("T", " ") + "Z" : ""; }
  function kindName(k) { return k ? String(k).replace(/_/g, " ") : "kind not stated"; }
  function link(u) { return /^https?:\/\//.test(u || "") ? u : ""; }
  var PRED = { event_type: "kind", location: "place", killed: "killed", injured: "injured" };
  var ASSESS = [["", "Assess…"], ["corroborated", "Corroborated"], ["confirmed", "Confirmed"], ["disputed", "Disputed"], ["withdrawn", "Withdrawn"], ["unassessed", "Back to unassessed"]];

  var data = null, tab = "review", box = null;
  // Opens a new GitHub issue filled in with the decision; the analyst reviews it, adds a reason and submits.
  function decide(summary, what, block) {
    block.osap_decision = 1;
    block.seen = { asof: data && data.asof || "", status: block.seen_status || "" }; delete block.seen_status;
    var body = "Reason: \n\n" +
      "Write why on the Reason line above, then press Submit. The OSAP refresh job records this decision, answers and closes this issue. " +
      "Only issues opened by the app's owner count; anyone else's are ignored.\n\n" +
      "What this decides: " + what + "\n\n```json\n" + JSON.stringify(block, null, 1) + "\n```\n";
    var url = REPO + "/issues/new?title=" + encodeURIComponent(("OSAP decision: " + summary).slice(0, 120)) + "&body=" + encodeURIComponent(body);
    window.open(url, "_blank", "noopener");
  }
  function repLine(r) {
    var t = r.title_en || r.title || "", u = link(r.url);
    return "<b>" + esc(r.outlet || "Unknown outlet") + "</b> · " + esc(when(r.time)) + (r.time_basis === "first seen" ? " (first seen)" : "") +
      (r.copy_of ? ' <span class="dsr-st">copy of an earlier report</span>' : "") + (r.discovery ? ' <span class="dsr-st">unvetted source</span>' : "") +
      "<br>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>" : esc(t));
  }
  function claimsHtml(r) {
    var cs = (r.claims || []).filter(function (c) { return PRED[c.predicate]; });
    if (!cs.length) return "";
    return '<div class="dsr-cl">' + cs.map(function (c) {
      var a = c.assessment, lab = PRED[c.predicate] + ": " + (c.predicate === "event_type" ? kindName(c.value) : c.value);
      return "<label>" + esc(lab) + (a ? ' <span class="dsr-a ' + esc(a.assessment) + '" title="' + esc("Analyst, " + when(a.decided_at) + (a.reason ? ": " + a.reason : "")) + '">' + esc(a.assessment) + "</span>" : ' <span class="obs">unassessed</span>') +
        ' <select data-claim="' + esc(c.claim_id) + '" data-lab="' + esc(lab) + '" data-cap="' + esc(r.capture_id) + '" aria-label="' + esc("Assess the claim " + lab) + '">' +
        ASSESS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + "</select></label>";
    }).join("") + "</div>";
  }
  function candHtml(c) {
    var ok = /^analyst/.test(c.status), place = c.place_name ? c.place_name + (c.province_name ? ", " + c.province_name : "") : (c.places || []).join(", ") || "place not settled";
    var fig = [c.contradictions && c.contradictions.length ? "figures differ (" + c.contradictions.join("; ") + ")" : "",
      c.originators < c.reports.length ? c.originators + " originating report" + (c.originators === 1 ? "" : "s") : ""].filter(Boolean).join(" · ");
    return '<div class="dsr-c" data-cand="' + esc(c.candidate_id) + '"><h3>' + esc(kindName(c.kind)) + " · " + esc(place) +
      '<span class="dsr-st' + (ok ? " ok" : "") + '">' + (ok ? "analyst-confirmed" : "machine suggestion, not reviewed") + "</span></h3>" +
      '<p class="obs">' + esc(when(c.first) + (c.last !== c.first ? " to " + when(c.last) : "") + " · " + c.reports.length + " report" + (c.reports.length === 1 ? "" : "s")) + (fig ? " · " + esc(fig) : "") + "</p>" +
      (c.kept_apart ? '<p class="obs">' + c.kept_apart.length + " report pair" + (c.kept_apart.length === 1 ? "" : "s") + " kept apart by the analyst.</p>" : "") +
      c.reports.map(function (r) {
        return '<div class="dsr-r">' + repLine(r) + claimsHtml(r) +
          (c.reports.length > 1 ? '<br><button type="button" class="dsr-b" data-notsame="' + esc(r.capture_id) + '">Not this incident</button>' : "") + "</div>";
      }).join("") +
      (!ok && c.reports.length > 1 ? '<button type="button" class="dsr-b" data-same="1">Same incident</button>' : "") + "</div>";
  }
  function looseHtml(u, byId) {
    return '<div class="dsr-c" data-loose="' + esc(u.capture_id) + '"><h3>' + esc(kindName(u.kind)) + '<span class="dsr-st">' + esc(u.why || "") + "</span></h3>" +
      '<div class="dsr-r">' + repLine(u) + claimsHtml(u) + "</div>" +
      ((u.could_match || []).filter(function (id) { return byId[id]; }).map(function (id) {
        var c = byId[id];
        return '<button type="button" class="dsr-b" data-join="' + esc(id) + '">' + esc("Same as " + kindName(c.kind) + ", " + (c.place_name || "?") + ", " + when(c.first)) + "</button>";
      }).join("")) + "</div>";
  }
  function render() {
    if (!box || !data) return;
    var C = data.candidates || [], U = data.unplaced || [], byId = {};
    C.forEach(function (c) { byId[c.candidate_id] = c; });
    var groups = {
      review: C.filter(function (c) { return !/^analyst/.test(c.status) && c.reports.length > 1; }),
      confirmed: C.filter(function (c) { return /^analyst/.test(c.status); }),
      single: C.filter(function (c) { return !/^analyst/.test(c.status) && c.reports.length === 1; }),
      loose: U };
    var names = { review: "To review", confirmed: "Confirmed", single: "Single reports", loose: "Province only" };
    var list = groups[tab] || [];
    box.querySelector(".dsr-body").innerHTML =
      '<p class="obs">Suggestions as of ' + esc(data.asof || "") + ". " + esc((data.totals || {}).decisions || 0) + " decision" + ((data.totals || {}).decisions === 1 ? "" : "s") + " recorded so far.</p>" +
      '<div class="dsr-tabs" role="group" aria-label="Which suggestions">' + Object.keys(groups).map(function (k) {
        return '<button type="button" data-tab="' + k + '" aria-pressed="' + (k === tab) + '">' + names[k] + " " + groups[k].length + "</button>"; }).join("") + "</div>" +
      (list.length ? list.slice(0, 25).map(function (x) { return tab === "loose" ? looseHtml(x, byId) : candHtml(x); }).join("") +
        (list.length > 25 ? '<p class="obs">Showing the newest 25 of ' + list.length + ".</p>" : "")
        : '<p class="obs">Nothing here.</p>');
  }
  function onClick(ev) {
    var t = ev.target, b;
    if ((b = t.closest("[data-tab]"))) { tab = b.getAttribute("data-tab"); render(); return; }
    var cardEl = t.closest("[data-cand]"), c = null;
    if (cardEl) (data.candidates || []).some(function (x) { if (x.candidate_id === cardEl.getAttribute("data-cand")) { c = x; return true; } return false; });
    if (t.closest("[data-same]") && c) {
      decide("same incident, " + kindName(c.kind) + ", " + (c.place_name || "") + ", " + when(c.first),
        "these " + c.reports.length + " reports describe one incident.", { action: "same_event", reports: c.reports.map(function (r) { return r.capture_id; }), seen_status: c.status });
    } else if ((b = t.closest("[data-notsame]")) && c) {
      var id = b.getAttribute("data-notsame"), r = c.reports.filter(function (x) { return x.capture_id === id; })[0] || {};
      decide("not the same incident, " + (r.outlet || "report") + ", " + when(r.time),
        "the report from " + (r.outlet || "this outlet") + " (" + when(r.time) + ") is a different incident from the other " + (c.reports.length - 1) + " report(s) in this suggestion.",
        { action: "not_same_event", report: id, from: c.reports.map(function (x) { return x.capture_id; }).filter(function (x) { return x !== id; }), seen_status: c.status });
    } else if ((b = t.closest("[data-join]"))) {
      var le = t.closest("[data-loose]"), lid = le && le.getAttribute("data-loose"), tgt = null;
      (data.candidates || []).some(function (x) { if (x.candidate_id === b.getAttribute("data-join")) { tgt = x; return true; } return false; });
      if (!lid || !tgt) return;
      decide("same incident, " + kindName(tgt.kind) + ", " + (tgt.place_name || "") + ", " + when(tgt.first),
        "this province-only report describes the same incident as the " + tgt.reports.length + " report(s) placed in " + (tgt.place_name || "the district") + ".",
        { action: "same_event", reports: [lid].concat(tgt.reports.map(function (r) { return r.capture_id; })), seen_status: tgt.status });
    }
  }
  function onChange(ev) {
    var s = ev.target; if (!s.matches || !s.matches("select[data-claim]") || !s.value) return;
    var v = s.value, lab = s.getAttribute("data-lab");
    s.value = "";
    decide("claim " + v + ", " + lab, "the claim \"" + lab + "\" in this report is " + v + (v === "unassessed" ? " again (the earlier assessment is cleared)" : "") + ".",
      { action: "assess_claim", claim_id: s.getAttribute("data-claim"), assessment: v, seen_status: "claim in " + s.getAttribute("data-cap") });
  }
  function load() {
    var body = box.querySelector(".dsr-body");
    body.innerHTML = '<p class="obs">Loading…</p>';
    fetch(FILE + "?fresh=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { data = j; render(); })
      .catch(function (e) { body.innerHTML = '<p class="obs">Could not load the suggestions (' + esc(e.message) + "). They need a connection.</p>"; });
  }
  function mount(el) {
    if (!el) return;
    box = el;
    el.innerHTML = "<h2>Incident review</h2>" +
      '<p class="sub">Machine suggestions of which reports describe the same incident, and the claims each report makes. Nothing here is reviewed until you decide. ' +
      "Each button opens a GitHub issue filled in with your decision: add a reason and submit it. Only issues the app's owner opens count; the next refresh records them.</p>" +
      '<details class="dsr"><summary>Open the review list</summary><div class="dsr-body"></div></details>';
    var d = el.querySelector("details");
    d.addEventListener("toggle", function () { if (d.open) load(); });
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
  }
  window.OSAP_DS_REVIEW = { mount: mount };
  (window.OSAP_CF_HOOKS = window.OSAP_CF_HOOKS || []).push({ render: function (c, d, rail) {
    if (!c || c.id !== "thailand-deep-south" || !rail) return;
    var reps = rail.querySelector("#cf-reps"), sec = document.createElement("div");
    sec.className = "sec"; sec.id = "ds-review";
    if (reps && reps.nextSibling) reps.parentNode.insertBefore(sec, reps.nextSibling); else rail.appendChild(sec);
    data = null; tab = "review"; mount(sec);
  } });
})();
