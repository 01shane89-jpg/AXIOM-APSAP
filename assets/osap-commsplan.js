/* AXIOM OSAP Comms planning (Shane 2026-10-03: a communications planning module for a radio operator, "planning, terrain,
   network status, sustainment and troubleshooting rather than just showing towers on a map"). Window.OSAP_COMMSPLAN.
   The Comms view (Map overlays > Infrastructure > Communications) opens as six tabs:
     Plan       PACE planner: Primary / Alternate / Contingency / Emergency per phase, with device, net, coverage expectation
                and its basis, dependencies, failure trigger and next action
     Coverage   the phone signal check (assets/osap-comms.js) and the route comms corridor (corridor(), shared with the
                evacuation planner); the terrain coverage estimate joins it with the terrain engine
     Link       a free-space link budget, Fresnel zone and radio horizon calculator; the terrain profile joins it later
     Networks   country internet outage signals (IODA, already loaded for Security signals), and the masts, towers and
                providers switches of assets/osap-comms.js
     Equipment  battery and power planner
     Status     network status board for the plan's current phase (GREEN / AMBER / RED / UNKNOWN, last check, note)
   Equipment also holds the loadout, cable and feedline loss, antenna cards and lengths, connector chains, a spectrum
   reference with the operator's channel plan, and COMSEC accountability (administrative status only, never key material).
   Status also holds the comms check log, the message / traffic log, interference reports and a troubleshooting walk-through.
   Everything the operator enters stays on this device, in the active workspace (assets/osap-ws.js), and is never sent anywhere.
   Every answer is labelled with its basis: MODELLED (worked out here), OBSERVED (measured), REPORTED (an outside feed) or
   the operator's own judgement; unknown is never shown as "no". The maths is assets/comms/radio-lib.js (window.OSAP_RADIO). */
(function () {
  "use strict";
  var W = window, D = document;
  var KP = "osap-cp-pace", KW = "osap-cp-power", KL = "osap-cp-link", KT = "osap-cp-tab";
  var TABS = [["plan", "Plan"], ["coverage", "Coverage"], ["link", "Link"], ["networks", "Networks"], ["equipment", "Equipment"], ["status", "Status"]];
  var PACE = [["P", "Primary"], ["A", "Alternate"], ["C", "Contingency"], ["E", "Emergency"]];
  var COV = [["", "Not assessed"], ["likely", "Likely"], ["marginal", "Marginal"], ["unlikely", "Unlikely"], ["unknown", "Unknown"]];
  var BASIS = [["", "Basis?"], ["modelled", "Modelled"], ["observed", "Observed"], ["reported", "Reported"], ["judgement", "Operator judgement"]];
  var ST = { unknown: ["UNKNOWN", "#6c757d"], green: ["GREEN", "#2b8a3e"], amber: ["AMBER", "#e67700"], red: ["RED", "#c92a2a"] };
  var MAXP = 30, MAXPH = 12;
  var S = { ctx: null, tab: null };

  function R() { return W.OSAP_RADIO; }
  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clip(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ").slice(0, n || 160); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function rid(p) { var b = new Uint8Array(5); W.crypto.getRandomValues(b); return p + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return (x % 36).toString(36); }).join(""); }
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function when(ms) { return ms ? (W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z") : ""; }
  function f(v, p) { return isFinite(v) ? (Math.round(v * Math.pow(10, p || 0)) / Math.pow(10, p || 0)).toLocaleString("en-GB") : "–"; }
  function opts(list, cur) { return list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + E(v) + '"' + (String(cur == null ? "" : cur) === String(v) ? " selected" : "") + ">" + E(t) + "</option>"; }).join(""); }
  function mgrs(lat, lon) { try { return (W.OSAP_GEO && W.OSAP_GEO.mgrs(lat, lon)) || ""; } catch (e) { return ""; } }
  function pane() { return S.ctx && S.ctx.rail.querySelector("#cp-pane"); }

  /* ---------- PACE plans (localStorage osap-cp-pace, part of the active workspace) ---------- */
  function emptyRow() { return { method: "", device: "", net: "", cov: "", cov_src: "", deps: "", trigger: "", action: "", status: "unknown", checked: 0, snote: "" }; }
  function newPhase(name) { var r = {}; PACE.forEach(function (p) { r[p[0]] = emptyRow(); }); return { id: rid("ph"), name: name, rows: r }; }
  function loadPace() {
    var d = get(KP, null); if (!d || !Array.isArray(d.plans)) d = { v: 1, plans: [], cur: "" };
    d.plans = d.plans.filter(function (p) { return p && p.id && Array.isArray(p.phases); });
    return d;
  }
  function savePace(d) { if (!put(KP, d)) note("This device's storage is full: the plan could not be saved."); }
  function curPlan(d) { for (var i = 0; i < d.plans.length; i++) if (d.plans[i].id === d.cur) return d.plans[i]; return d.plans[0] || null; }
  function phaseOf(p, id) { for (var i = 0; i < p.phases.length; i++) if (p.phases[i].id === id) return p.phases[i]; return null; }
  function makePlan(d) {
    var n = d.plans.length + 1, now = Date.now();
    var p = { id: rid("pace"), type: "pace-plan", name: "PACE plan " + (n < 10 ? "0" : "") + n, mission: "", team: "", area: null, notes: "",
      phases: [newPhase("Infiltration"), newPhase("Actions"), newPhase("Exfiltration")], created: now, updated: now };
    p.cur_phase = p.phases[0].id; return p;
  }
  function note(msg) { var el = S.ctx && S.ctx.rail.querySelector("#cp-msg"); if (el) el.textContent = msg; }

  function rowFields(ph, k, r) {
    var at = ' data-cpp="' + E(ph.id) + '" data-cpr="' + k + '" data-cpk=';
    return '<div class="cprow"><label>Method<select' + at + '"method">' + opts([["", "Choose…"]].concat(R().METHODS), r.method) + "</select></label>" +
      '<label>Device / callsign<input' + at + '"device" value="' + E(r.device) + '" maxlength="80"></label>' +
      '<label>Net / channel name<input' + at + '"net" value="' + E(r.net) + '" maxlength="80"></label>' +
      '<label class="cpw">Coverage expected<span class="cpduo"><select' + at + '"cov">' + opts(COV, r.cov) + "</select><select" + at + '"cov_src" aria-label="Basis of the coverage expectation">' + opts(BASIS, r.cov_src) + "</select></span></label>" +
      '<label class="cpw">Depends on<input' + at + '"deps" value="' + E(r.deps) + '" maxlength="160" placeholder="power, relay, line of sight, a network…"></label>' +
      '<label class="cpw">Failure trigger<input' + at + '"trigger" value="' + E(r.trigger) + '" maxlength="160" placeholder="e.g. two missed comms checks"></label>' +
      '<label class="cpw">Then<input' + at + '"action" value="' + E(r.action) + '" maxlength="160" placeholder="e.g. move to Alternate on the next window"></label></div>';
  }
  function renderPlan() {
    var el = pane(), d = loadPace(), p = curPlan(d);
    if (!p) {
      el.innerHTML = '<div class="sec cpsec"><h3>PACE plan</h3><p class="obs">Build a Primary, Alternate, Contingency and Emergency communications plan for each phase of the mission: method, device, net, the coverage you expect and why, what it depends on, and what makes you move to the next one.</p>' +
        '<div class="cpbtns"><button type="button" class="cpgo" data-cpa="new">New PACE plan</button></div><p class="obs">Kept on this device in the active workspace. Nothing is sent anywhere.</p></div>';
      return;
    }
    var a = p.area, ar = a ? "Centre <code>" + E(mgrs(a.lat, a.lon)) + "</code> (" + f(a.lat, 4) + ", " + f(a.lon, 4) + "), radius" : "No area set. Area lets other tools (medical plan, evacuation) find this plan.";
    var h = '<div class="sec cpsec"><div class="cpbtns"><select data-cpa="pick" aria-label="PACE plan">' + d.plans.map(function (x) { return '<option value="' + E(x.id) + '"' + (x.id === p.id ? " selected" : "") + ">" + E(x.name) + "</option>"; }).join("") + "</select>" +
      '<button type="button" data-cpa="new">New</button><button type="button" data-cpa="copy">Copy</button><button type="button" data-cpa="print">Print</button><button type="button" data-cpa="text">Copy as text</button><button type="button" class="cpdel" data-cpa="del">Delete</button></div>' +
      '<div class="cprow"><label class="cpw">Plan name<input data-cpf="name" value="' + E(p.name) + '" maxlength="80"></label>' +
      '<label class="cpw">Mission<input data-cpf="mission" value="' + E(p.mission) + '" maxlength="160"></label>' +
      '<label class="cpw">Team / stations<input data-cpf="team" value="' + E(p.team) + '" maxlength="160"></label></div>' +
      '<p class="cparea"><b>Area</b> ' + ar + (a ? ' <input type="number" min="1" max="2000" step="1" data-cpf="radius" value="' + E(a.radius_km) + '" aria-label="Radius in km"> km' : "") +
      ' <button type="button" data-cpa="here">' + (a ? "Move to map centre" : "Use map centre") + "</button>" + (a ? ' <button type="button" data-cpa="noarea">Clear</button>' : "") + "</p>" +
      '<label class="cpw cpnotes">Notes<textarea data-cpf="notes" rows="2" maxlength="1000">' + E(p.notes) + "</textarea></label>" +
      '<p class="obs" id="cp-msg">Last changed ' + E(when(p.updated)) + ". Kept on this device in the active workspace; nothing is sent anywhere.</p></div>";
    p.phases.forEach(function (ph, i) {
      h += '<details class="sec cpsec cpph" open><summary><b>Phase ' + (i + 1) + "</b> " + E(ph.name) + "</summary>" +
        '<div class="cpbtns"><label>Phase name <input data-cpph="' + E(ph.id) + '" value="' + E(ph.name) + '" maxlength="60"></label>' +
        (p.phases.length > 1 ? '<button type="button" class="cpdel" data-cpa="delph" data-id="' + E(ph.id) + '">Remove phase</button>' : "") + "</div>";
      PACE.forEach(function (k) { h += '<fieldset class="cpp cpp' + k[0] + '"><legend><span class="cpl">' + k[0] + "</span> " + k[1] + "</legend>" + rowFields(ph, k[0], ph.rows[k[0]] || emptyRow()) + "</fieldset>"; });
      h += "</details>";
    });
    h += '<div class="sec cpsec"><div class="cpbtns">' + (p.phases.length < MAXPH ? '<button type="button" data-cpa="addph">Add a phase</button>' : "") + "</div>" +
      '<p class="obs">Coverage expected: say what it rests on. <b>Modelled</b> = worked out (Coverage or Link tab), <b>Observed</b> = measured (phone tests, a comms check), <b>Reported</b> = an outside source, <b>Operator judgement</b> = your own call. Not assessed and Unknown are never read as "no coverage".</p></div>';
    el.innerHTML = h;
  }
  function planText(p) {
    var o = ["PACE PLAN: " + p.name, p.mission ? "Mission: " + p.mission : "", p.team ? "Team / stations: " + p.team : "",
      p.area ? "Area: " + mgrs(p.area.lat, p.area.lon) + " radius " + p.area.radius_km + " km" : "", p.notes ? "Notes: " + p.notes : "",
      "Printed " + when(Date.now()) + ". Planning document; coverage expectations carry their basis."];
    p.phases.forEach(function (ph, i) {
      o.push("", "PHASE " + (i + 1) + ": " + ph.name);
      PACE.forEach(function (k) {
        var r = ph.rows[k[0]] || emptyRow(), c = COV.filter(function (x) { return x[0] === r.cov; })[0], b = BASIS.filter(function (x) { return x[0] === r.cov_src; })[0];
        o.push(" " + k[0] + " " + k[1] + ": " + (r.method || "(not set)") + (r.device ? " | " + r.device : "") + (r.net ? " | net " + r.net : ""),
          "   Coverage expected: " + (c ? c[1] : "Not assessed") + (r.cov_src && b ? " (" + b[1] + ")" : ""),
          r.deps ? "   Depends on: " + r.deps : "", r.trigger ? "   Failure trigger: " + r.trigger : "", r.action ? "   Then: " + r.action : "");
      });
    });
    return o.filter(function (x) { return x !== ""; }).join("\n");
  }
  function printPlan(p) {
    var pr = D.getElementById("cp-print"); if (!pr) { pr = D.createElement("div"); pr.id = "cp-print"; D.body.appendChild(pr); }
    var h = "<h1>PACE plan: " + E(p.name) + "</h1><p>" + (p.mission ? "Mission: " + E(p.mission) + ". " : "") + (p.team ? "Team / stations: " + E(p.team) + ". " : "") +
      (p.area ? "Area: " + E(mgrs(p.area.lat, p.area.lon)) + ", radius " + E(p.area.radius_km) + " km. " : "") + "Printed " + E(when(Date.now())) + ".</p>" + (p.notes ? "<p>" + E(p.notes) + "</p>" : "");
    p.phases.forEach(function (ph, i) {
      h += "<h2>Phase " + (i + 1) + ": " + E(ph.name) + "</h2><table><thead><tr><th></th><th>Method</th><th>Device / callsign</th><th>Net</th><th>Coverage expected</th><th>Depends on</th><th>Failure trigger</th><th>Then</th></tr></thead><tbody>";
      PACE.forEach(function (k) {
        var r = ph.rows[k[0]] || emptyRow(), c = COV.filter(function (x) { return x[0] === r.cov; })[0], b = BASIS.filter(function (x) { return x[0] === r.cov_src; })[0];
        h += "<tr><td><b>" + k[0] + "</b></td><td>" + E(r.method) + "</td><td>" + E(r.device) + "</td><td>" + E(r.net) + "</td><td>" + E(c ? c[1] : "Not assessed") + (r.cov_src && b ? " (" + E(b[1]) + ")" : "") + "</td><td>" + E(r.deps) + "</td><td>" + E(r.trigger) + "</td><td>" + E(r.action) + "</td></tr>";
      });
      h += "</tbody></table>";
    });
    pr.innerHTML = h + "<p>Planning document made in OSAP on this device. Coverage expectations are estimates with their basis shown, not guarantees.</p>";
    D.documentElement.classList.add("cpprinting");
    var done = function () { D.documentElement.classList.remove("cpprinting"); W.removeEventListener("afterprint", done); };
    W.addEventListener("afterprint", done);
    try { W.print(); } catch (e) {}
    setTimeout(done, 1500);
  }
  function planAction(a, t) {
    var d = loadPace(), p = curPlan(d), now = Date.now();
    if (a === "new") { if (d.plans.length >= MAXP) { note("Up to " + MAXP + " plans per workspace: delete one first."); return; } p = makePlan(d); d.plans.push(p); d.cur = p.id; }
    else if (a === "pick") d.cur = t.value;
    else if (!p) return;
    else if (a === "copy") { if (d.plans.length >= MAXP) { note("Up to " + MAXP + " plans per workspace: delete one first."); return; } var c = JSON.parse(JSON.stringify(p)); c.id = rid("pace"); c.name = clip(p.name + " (copy)", 80); c.created = c.updated = now; c.phases.forEach(function (ph) { var o = ph.id; ph.id = rid("ph"); if (c.cur_phase === o) c.cur_phase = ph.id; }); d.plans.push(c); d.cur = c.id; }
    else if (a === "del") { if (!W.confirm("Delete the plan \"" + p.name + "\" from this device?")) return; d.plans = d.plans.filter(function (x) { return x.id !== p.id; }); d.cur = d.plans[0] ? d.plans[0].id : ""; }
    else if (a === "here") { var m = S.ctx.map.getCenter(); p.area = { lat: Math.round(m.lat * 1e5) / 1e5, lon: Math.round(W.OSAP_GEO && W.OSAP_GEO.wrap ? W.OSAP_GEO.wrap(m.lng) * 1e5 : m.lng * 1e5) / 1e5, radius_km: p.area ? p.area.radius_km : 25 }; p.updated = now; }
    else if (a === "noarea") { p.area = null; p.updated = now; }
    else if (a === "addph") { if (p.phases.length < MAXPH) { p.phases.push(newPhase("Phase " + (p.phases.length + 1))); p.updated = now; } }
    else if (a === "delph") { var id = t.getAttribute("data-id"), ph = phaseOf(p, id); if (!ph || !W.confirm("Remove the phase \"" + ph.name + "\"?")) return; p.phases = p.phases.filter(function (x) { return x.id !== id; }); if (p.cur_phase === id) p.cur_phase = p.phases[0].id; p.updated = now; }
    else if (a === "print") { printPlan(p); return; }
    else if (a === "text") { var tx = planText(p); if (W.navigator.clipboard) W.navigator.clipboard.writeText(tx).then(function () { note("Plan copied as text."); }, function () { note("Copy was refused by the browser."); }); return; }
    savePace(d); render();
  }
  function planInput(t) {
    var d = loadPace(), p = curPlan(d); if (!p) return;
    var k = t.getAttribute("data-cpf"), ph, v;
    if (k) {
      if (k === "radius") { if (p.area) p.area.radius_km = Math.min(2000, Math.max(1, num(t.value, 25))); }
      else p[k] = clip(t.value, k === "notes" ? 1000 : k === "name" ? 80 : 160);
    } else if (t.hasAttribute("data-cpph")) { ph = phaseOf(p, t.getAttribute("data-cpph")); if (ph) ph.name = clip(t.value, 60); }
    else if ((ph = phaseOf(p, t.getAttribute("data-cpp")))) {
      var r = ph.rows[t.getAttribute("data-cpr")]; k = t.getAttribute("data-cpk"); if (!r || !(k in r)) return;
      v = clip(t.value, 160);
      if (k === "method" && v && R().METHODS.indexOf(v) < 0) return;
      if (k === "cov" && !COV.some(function (x) { return x[0] === v; })) return;
      if (k === "cov_src" && !BASIS.some(function (x) { return x[0] === v; })) return;
      r[k] = v;
    } else return;
    p.updated = Date.now(); savePace(d);
  }

  /* ---------- Status board (the plan's current phase) ---------- */
  function renderBoard(el) {
    var d = loadPace(), p = curPlan(d);
    if (!p) { el.innerHTML = '<div class="sec cpsec"><h3>Network status</h3><p class="obs">Make a PACE plan first (Plan tab): the status board shows each of its nets.</p><div class="cpbtns"><button type="button" data-cptab="plan">Open the Plan tab</button></div></div>'; return; }
    var ph = phaseOf(p, p.cur_phase) || p.phases[0];
    var h = '<div class="sec cpsec"><h3>Network status</h3><div class="cpbtns"><label>Plan <b>' + E(p.name) + '</b></label><label>Phase <select data-cps="phase">' +
      p.phases.map(function (x) { return '<option value="' + E(x.id) + '"' + (x.id === ph.id ? " selected" : "") + ">" + E(x.name) + "</option>"; }).join("") + "</select></label></div>" +
      '<p class="obs">The status is what the team records here after a comms check. OSAP does not test any network.</p></div>';
    var down = null;
    PACE.forEach(function (k, i) {
      var r = ph.rows[k[0]] || emptyRow(), s = ST[r.status] ? r.status : "unknown", c = COV.filter(function (x) { return x[0] === r.cov; })[0], b = BASIS.filter(function (x) { return x[0] === r.cov_src; })[0];
      if (s === "red" && !down) down = { k: k, r: r, next: PACE[i + 1] ? { k: PACE[i + 1], r: ph.rows[PACE[i + 1][0]] || emptyRow() } : null };
      h += '<div class="sec cpsec cpst" style="border-left:5px solid ' + ST[s][1] + '"><div class="cpsth"><span class="cpl">' + k[0] + "</span> <b>" + E(r.method || "Method not set") + "</b>" + (r.device ? " · " + E(r.device) : "") + (r.net ? " · net " + E(r.net) : "") +
        ' <span class="cpbadge" style="background:' + ST[s][1] + '">' + ST[s][0] + "</span></div>" +
        '<div class="cpbtns" role="group" aria-label="' + k[1] + ' status">' + ["green", "amber", "red", "unknown"].map(function (x) { return '<button type="button" data-cpst="' + x + '" data-cpr="' + k[0] + '" aria-pressed="' + (x === s) + '">' + ST[x][0] + "</button>"; }).join("") +
        '<button type="button" data-cpchk="' + k[0] + '">Checked now</button></div>' +
        '<p class="obs">Last check: ' + (r.checked ? E(when(r.checked)) : "none recorded") + ". Coverage expected: " + E(c ? c[1] : "Not assessed") + (r.cov_src && b ? " (" + E(b[1]) + ")" : "") + (r.deps ? ". Depends on: " + E(r.deps) : "") + ".</p>" +
        '<label class="cpw">Note<input data-cpsn="' + k[0] + '" value="' + E(r.snote) + '" maxlength="160" placeholder="known outage, problem, corrective action"></label></div>';
    });
    el.innerHTML = h + (down ? '<div class="sec cpsec cpwarn"><b>' + down.k[1] + " is RED.</b> " + (down.r.trigger ? "Your failure trigger: " + E(down.r.trigger) + ". " : "") + (down.r.action ? "Your plan says: " + E(down.r.action) + ". " : "") +
      (down.next ? "Next in the plan: " + down.next.k[1] + " (" + E(down.next.r.method || "method not set") + ")." : "") + "</div>" : "");
  }
  function boardAct(t) {
    var d = loadPace(), p = curPlan(d); if (!p) return;
    var ph = phaseOf(p, p.cur_phase) || p.phases[0], k, r;
    if (t.getAttribute("data-cps") === "phase") { p.cur_phase = t.value; savePace(d); render(); return; }
    if ((k = t.getAttribute("data-cpst"))) { r = ph.rows[t.getAttribute("data-cpr")]; if (!r || !ST[k]) return; r.status = k; r.checked = Date.now(); }
    else if ((k = t.getAttribute("data-cpchk"))) { r = ph.rows[k]; if (!r) return; r.checked = Date.now(); }
    else if ((k = t.getAttribute("data-cpsn"))) { r = ph.rows[k]; if (!r) return; r.snote = clip(t.value, 160); p.updated = Date.now(); savePace(d); return; }
    else return;
    p.updated = Date.now(); savePace(d); render();
  }

  /* ---------- Status tab: board, comms check log, message / traffic log, interference reports, troubleshooting ----------
     All entries are what the operator records; OSAP tests, listens to and collects nothing. Kept on this device in the active
     workspace (osap-cp-checks, osap-cp-traffic, osap-cp-intf), newest first, capped so storage cannot fill. */
  var KC = "osap-cp-checks", KM = "osap-cp-traffic", KI = "osap-cp-intf", KS = "osap-cp-sub", MAXLOG = 500;
  var SUBS = [["board", "Board"], ["checks", "Check log"], ["traffic", "Traffic"], ["intf", "Interference"], ["fix", "Troubleshoot"]];
  var RES = [["ok", "OK", "green"], ["weak", "Weak / broken", "amber"], ["fail", "Failed", "red"], ["none", "No contact", "red"]];
  var PREC = ["Routine", "Priority", "Immediate", "Flash"];
  var SEV = [["low", "Low"], ["moderate", "Moderate"], ["severe", "Severe"]];
  var IMP = [["none", "No effect"], ["degraded", "Degraded"], ["lost", "Comms lost"]];
  var FIX = [
    ["power", "Power", ["Battery charged and seated; the right battery for the set", "Power switch on, indicator lit, voltage normal", "Cold: warm the battery or swap in a warm one", "Spare battery or other power source tried"]],
    ["antenna", "Antenna", ["Right antenna for the band, fully connected", "Not damaged, bent or shorted against metal or ground", "Orientation and polarisation match the other station", "HF: counterpoise or ground laid out"]],
    ["cable", "Cable and connectors", ["Connectors clean, dry and tight", "No crushed, kinked or cut cable", "Right adapters in the chain", "Spare cable tried"]],
    ["prog", "Programming", ["Right frequency, channel or net loaded", "Right mode, bandwidth and power setting", "Fill or keying status current and matching the other station (status only, never key data)", "Time synchronised where the system needs it", "Volume and squelch set"]],
    ["net", "Network and schedule", ["Other station is on and inside its comms window", "Right callsigns, net and schedule", "Net control or gateway reachable by another means", "Satellite or cellular service active on this device"]],
    ["path", "Line of sight and distance", ["Within the planned range (Link tab)", "No hill or ridge between the stations", "Moved to higher ground or raised the antenna", "Relay or retrans available"]],
    ["intf", "Interference", ["Noise or a carrier heard on the channel", "Generators, vehicles or electronics close to the antenna", "Alternate channel or frequency tried"]],
    ["ext", "Outside infrastructure", ["Internet outage reported for the country (Networks tab)", "Mast, repeater or gateway reported down", "Weather or space weather affecting the band"]]];
  var FS = { step: 0, res: {}, note: "" };

  function logs(k) { var v = get(k, []); return Array.isArray(v) ? v : []; }
  function saveLog(k, v) { if (v.length > MAXLOG) v.length = MAXLOG; if (!put(k, v)) note("This device's storage is full: the entry was not saved."); }
  function fv(sel) { var el = S.ctx.rail.querySelector(sel); return el ? el.value : ""; }
  /* a typed time "0630" or "06:30" is read as today in Zulu (yesterday if that is still ahead); blank is now */
  function zTime(s) {
    var m = /^\s*(\d{1,2}):?(\d{2})\s*z?\s*$/i.exec(s || ""); if (!m || +m[1] > 23 || +m[2] > 59) return Date.now();
    var d = new Date(); d.setUTCHours(+m[1], +m[2], 0, 0); var t = d.getTime(); if (t > Date.now() + 60000) t -= 86400000; return t;
  }
  function zT(ms) { var d = new Date(ms); return ("0" + d.getUTCDate()).slice(-2) + " " + ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2) + "Z"; }
  function nets() {
    var p = curPlan(loadPace()), o = []; if (!p) return o;
    var ph = phaseOf(p, p.cur_phase) || p.phases[0];
    PACE.forEach(function (k) { var r = ph.rows[k[0]]; if (r && (r.net || r.method)) o.push([k[0], k[0] + " · " + (r.net || r.method)]); });
    return o;
  }

  function renderStatus() {
    var el = pane(), sub = S.sub || "board";
    var h = '<div class="cpsub" role="group" aria-label="Status views">' + SUBS.map(function (s) { return '<button type="button" data-cpsub="' + s[0] + '" aria-pressed="' + (s[0] === sub) + '">' + s[1] + (s[0] === "traffic" ? pendingBadge() : "") + "</button>"; }).join("") + "</div><div id=\"cp-sub\"></div>";
    el.innerHTML = h;
    var box = el.querySelector("#cp-sub");
    if (sub !== "intf") intfLayerOff();
    if (sub === "board") renderBoard(box); else if (sub === "checks") renderChecks(box); else if (sub === "traffic") renderTraffic(box); else if (sub === "intf") renderIntf(box); else renderFix(box);
  }
  function pendingBadge() { var n = logs(KM).filter(function (m) { return m.ack === "pending"; }).length; return n ? ' <span class="cpbadge" style="background:#e67700">' + n + "</span>" : ""; }
  function statusAct(t) {
    var s = t.getAttribute("data-cpsub");
    if (s) { S.sub = s; try { localStorage.setItem(KS, s); } catch (e) {} render(); return; }
    var sub = S.sub || "board";
    if (sub === "board") boardAct(t); else if (sub === "checks") checksAct(t); else if (sub === "traffic") trafficAct(t); else if (sub === "intf") intfAct(t); else fixAct(t);
  }

  /* comms check log */
  function renderChecks(box) {
    var L = logs(KC), nl = nets();
    box.innerHTML = '<div class="sec cpsec"><h3>Comms check log</h3><div class="cprow">' +
      '<label>Time (Z)<input id="cpcl-t" placeholder="now, or 0630" maxlength="6"></label><label>Station<input id="cpcl-st" maxlength="60" placeholder="callsign"></label>' +
      '<label>Net / channel<input id="cpcl-net" maxlength="60"></label><label>Result<select id="cpcl-r">' + opts(RES.map(function (r) { return [r[0], r[1]]; }), "ok") + "</select></label>" +
      '<label>Signal<input id="cpcl-q" maxlength="12" placeholder="e.g. 5x5, 4/3"></label><label>Operator<input id="cpcl-op" maxlength="40"></label>' +
      '<label class="cpw">Problem<input id="cpcl-pb" maxlength="160"></label><label class="cpw">Corrective action<input id="cpcl-ca" maxlength="160"></label>' +
      (nl.length ? '<label class="cpw">Update the status board<select id="cpcl-row">' + opts([["", "No"]].concat(nl), "") + "</select></label>" : "") + "</div>" +
      '<div class="cpbtns"><button type="button" class="cpgo" data-cl="add">Log the check</button>' + (L.length ? '<button type="button" data-cl="text">Copy log as text</button>' : "") + "</div>" +
      '<p class="obs" id="cp-msg">' + (L.length ? L.length + " entr" + (L.length === 1 ? "y" : "ies") + ", newest first." : "No checks logged yet.") + " Kept on this device in the active workspace.</p>" +
      (L.length ? '<div class="cpscroll"><table class="rttab cplog"><thead><tr><th>Time</th><th>Station / net</th><th>Result</th><th>Problem / action</th><th></th></tr></thead><tbody>' +
        L.slice(0, 100).map(function (c) {
          var r = RES.filter(function (x) { return x[0] === c.result; })[0] || RES[0];
          return "<tr><td>" + E(zT(c.t)) + "</td><td>" + E(c.station) + (c.net ? "<br><small>" + E(c.net) + "</small>" : "") + '</td><td><span class="cpbadge" style="background:' + ST[r[2]][1] + '">' + E(r[1]) + "</span>" + (c.q ? "<br><small>" + E(c.q) + "</small>" : "") +
            "</td><td>" + E(c.problem) + (c.action ? "<br><small>→ " + E(c.action) + "</small>" : "") + (c.op ? "<br><small>Op " + E(c.op) + "</small>" : "") + '</td><td><button type="button" class="cpx" data-cl="del" data-id="' + E(c.id) + '" aria-label="Delete entry">×</button></td></tr>';
        }).join("") + "</tbody></table></div>" : "") + "</div>";
  }
  function checksAct(t) {
    var a = t.getAttribute("data-cl"); if (!a) return;
    var L = logs(KC);
    if (a === "add") {
      var c = { id: rid("ck"), type: "comms-check", t: zTime(fv("#cpcl-t")), station: clip(fv("#cpcl-st"), 60), net: clip(fv("#cpcl-net"), 60), result: fv("#cpcl-r"), q: clip(fv("#cpcl-q"), 12),
        problem: clip(fv("#cpcl-pb"), 160), action: clip(fv("#cpcl-ca"), 160), op: clip(fv("#cpcl-op"), 40), created: Date.now() };
      if (!RES.some(function (x) { return x[0] === c.result; })) c.result = "ok";
      if (!c.station && !c.net) { note("Enter the station or the net."); return; }
      L.unshift(c); L.sort(function (x, y) { return y.t - x.t; }); saveLog(KC, L);
      var row = fv("#cpcl-row");
      if (row) { var d = loadPace(), p = curPlan(d), ph = p && (phaseOf(p, p.cur_phase) || p.phases[0]), r = ph && ph.rows[row]; if (r) { r.status = RES.filter(function (x) { return x[0] === c.result; })[0][2]; r.checked = c.t; if (c.problem) r.snote = c.problem; p.updated = Date.now(); savePace(d); } }
    } else if (a === "del") { if (!W.confirm("Delete this log entry?")) return; L = L.filter(function (x) { return x.id !== t.getAttribute("data-id"); }); saveLog(KC, L); }
    else if (a === "text") { copyText(["COMMS CHECK LOG (Zulu)"].concat(L.map(function (c) { var r = RES.filter(function (x) { return x[0] === c.result; })[0] || RES[0]; return zT(c.t) + " | " + c.station + (c.net ? " | " + c.net : "") + " | " + r[1] + (c.q ? " " + c.q : "") + (c.problem ? " | " + c.problem : "") + (c.action ? " -> " + c.action : "") + (c.op ? " | op " + c.op : ""); })).join("\n")); return; }
    render();
  }
  function copyText(tx) { if (W.navigator.clipboard) W.navigator.clipboard.writeText(tx).then(function () { note("Copied as text."); }, function () { note("Copy was refused by the browser."); }); }

  /* message / traffic log */
  function renderTraffic(box) {
    var L = logs(KM), only = !!S.pendOnly, show = only ? L.filter(function (m) { return m.ack === "pending"; }) : L;
    box.innerHTML = '<div class="sec cpsec"><h3>Message and traffic log</h3><p class="obs">Track messages sent and received by any means, and which still wait for an acknowledgement. The messages themselves travel outside OSAP.</p><div class="cprow">' +
      '<label>Time (Z)<input id="cptl-t" placeholder="now, or 0630" maxlength="6"></label><label>Direction<select id="cptl-d">' + opts([["out", "Sent"], ["in", "Received"]], "out") + "</select></label>" +
      '<label>From<input id="cptl-f" maxlength="60"></label><label>To<input id="cptl-to" maxlength="60"></label>' +
      '<label>Method<select id="cptl-m">' + opts(R().METHODS, "") + '</select></label><label>Precedence<select id="cptl-p">' + opts(PREC, "Routine") + "</select></label>" +
      '<label class="cpw">Subject<input id="cptl-s" maxlength="120" placeholder="short subject or message number"></label>' +
      '<label class="cpw">Pending action<input id="cptl-a" maxlength="160" placeholder="what has to happen next, if anything"></label>' +
      '<label class="cpchk"><input type="checkbox" id="cptl-ack" checked> Needs an acknowledgement</label></div>' +
      '<div class="cpbtns"><button type="button" class="cpgo" data-tl="add">Log the message</button><button type="button" data-tl="pend" aria-pressed="' + only + '">Awaiting acknowledgement only</button>' + (L.length ? '<button type="button" data-tl="text">Copy log as text</button>' : "") + "</div>" +
      '<p class="obs" id="cp-msg">' + L.filter(function (m) { return m.ack === "pending"; }).length + " awaiting acknowledgement, " + L.length + " logged. Kept on this device in the active workspace.</p>" +
      (show.length ? '<div class="cpscroll"><table class="rttab cplog"><thead><tr><th>Time</th><th>Message</th><th>Ack</th><th></th></tr></thead><tbody>' +
        show.slice(0, 100).map(function (m) {
          return "<tr><td>" + E(zT(m.t)) + "<br><small>" + (m.dir === "in" ? "Received" : "Sent") + "</small></td><td><b>" + E(m.prec) + "</b> " + E(m.subject) + "<br><small>" + E(m.from) + " → " + E(m.to) + (m.method ? " · " + E(m.method) : "") + "</small>" + (m.action ? "<br><small>Pending: " + E(m.action) + "</small>" : "") + "</td><td>" +
            (m.ack === "pending" ? '<button type="button" data-tl="ack" data-id="' + E(m.id) + '">Acknowledged</button>' : m.ack === "done" ? '<span class="cpbadge" style="background:#2b8a3e">ACK</span><br><small>' + E(zT(m.ackt)) + "</small>" : "<small>not needed</small>") +
            '</td><td><button type="button" class="cpx" data-tl="del" data-id="' + E(m.id) + '" aria-label="Delete entry">×</button></td></tr>';
        }).join("") + "</tbody></table></div>" : "") + "</div>";
  }
  function trafficAct(t) {
    var a = t.getAttribute("data-tl"); if (!a) return;
    var L = logs(KM), id = t.getAttribute("data-id");
    if (a === "add") {
      var ack = S.ctx.rail.querySelector("#cptl-ack");
      var m = { id: rid("msg"), type: "traffic", t: zTime(fv("#cptl-t")), dir: fv("#cptl-d") === "in" ? "in" : "out", from: clip(fv("#cptl-f"), 60), to: clip(fv("#cptl-to"), 60), method: R().METHODS.indexOf(fv("#cptl-m")) >= 0 ? fv("#cptl-m") : "",
        prec: PREC.indexOf(fv("#cptl-p")) >= 0 ? fv("#cptl-p") : "Routine", subject: clip(fv("#cptl-s"), 120), action: clip(fv("#cptl-a"), 160), ack: ack && ack.checked ? "pending" : "none", created: Date.now() };
      if (!m.subject) { note("Enter a subject or message number."); return; }
      L.unshift(m); L.sort(function (x, y) { return y.t - x.t; }); saveLog(KM, L);
    } else if (a === "ack") { L.forEach(function (m) { if (m.id === id) { m.ack = "done"; m.ackt = Date.now(); } }); saveLog(KM, L); }
    else if (a === "del") { if (!W.confirm("Delete this log entry?")) return; saveLog(KM, L.filter(function (m) { return m.id !== id; })); }
    else if (a === "pend") S.pendOnly = !S.pendOnly;
    else if (a === "text") { copyText(["MESSAGE / TRAFFIC LOG (Zulu)"].concat(L.map(function (m) { return zT(m.t) + " | " + (m.dir === "in" ? "IN" : "OUT") + " | " + m.prec + " | " + m.from + " -> " + m.to + (m.method ? " | " + m.method : "") + " | " + m.subject + " | " + (m.ack === "pending" ? "AWAITING ACK" : m.ack === "done" ? "ACK " + zT(m.ackt) : "no ack needed") + (m.action ? " | pending: " + m.action : ""); })).join("\n")); return; }
    render();
  }

  /* interference reports: what the operator observed; OSAP groups reports that are close in place, band and time, and does
     not locate, identify or attribute any source */
  var intfLayer = null;
  function intfLayerOff() { if (intfLayer && S.ctx) { S.ctx.layer.removeLayer(intfLayer); intfLayer = null; } }
  function near(a, L) { return L.filter(function (b) { return b.id !== a.id && b.band === a.band && Math.abs(b.t - a.t) <= 86400000 && R().hav_km([a.lat, a.lon], [b.lat, b.lon]) <= 10; }).length; }
  function renderIntf(box) {
    var L = logs(KI), c = S.ctx.map.getCenter();
    box.innerHTML = '<div class="sec cpsec"><h3>Interference reports</h3><p class="obs">Record interference you observed. OSAP groups reports close in place, band and time; it does not listen, locate or attribute a source.</p><div class="cprow">' +
      '<label>Time (Z)<input id="cpif-t" placeholder="now, or 0630" maxlength="6"></label><label>Band<select id="cpif-b">' + opts(R().BANDS.map(function (b) { return [b.id, b.label]; }).concat([["other", "Other"]]), "vhf") + "</select></label>" +
      '<label>About (MHz)<input id="cpif-f" type="number" step="any" min="0" placeholder="optional"></label><label>Severity<select id="cpif-s">' + opts(SEV, "moderate") + "</select></label>" +
      '<label>Impact<select id="cpif-i">' + opts(IMP, "degraded") + '</select></label><label class="cpw">What was observed<input id="cpif-n" maxlength="160" placeholder="noise, tone, carrier, pulsing…"></label></div>' +
      '<p class="cparea">Place: the map centre, <code>' + E(mgrs(c.lat, c.lng)) + '</code>. Move the map to where it was observed.</p>' +
      '<div class="cpbtns"><button type="button" class="cpgo" data-if="add">Record the report</button></div><p class="obs" id="cp-msg">' + L.length + " report" + (L.length === 1 ? "" : "s") + ". Kept on this device in the active workspace.</p>" +
      (L.length ? '<div class="cpscroll"><table class="rttab cplog"><thead><tr><th>Time</th><th>Report</th><th>Nearby</th><th></th></tr></thead><tbody>' +
        L.slice(0, 100).map(function (r) {
          var b = R().BANDS.filter(function (x) { return x.id === r.band; })[0], n = near(r, L), sv = SEV.filter(function (x) { return x[0] === r.sev; })[0], im = IMP.filter(function (x) { return x[0] === r.impact; })[0];
          return "<tr><td>" + E(zT(r.t)) + '</td><td><b>' + E(b ? b.label : "Other band") + "</b>" + (r.f ? " ~" + E(r.f) + " MHz" : "") + "<br><small>" + E(sv ? sv[1] : "") + " · " + E(im ? im[1] : "") + " · <code>" + E(mgrs(r.lat, r.lon)) + "</code></small>" + (r.note ? "<br><small>" + E(r.note) + "</small>" : "") +
            "</td><td>" + (n ? "<b>" + n + "</b> other" + (n === 1 ? "" : "s") + " within 10 km and 24 h, same band" : "<small>none</small>") + '</td><td><button type="button" class="cpx" data-if="del" data-id="' + E(r.id) + '" aria-label="Delete report">×</button></td></tr>';
        }).join("") + "</tbody></table></div>" : "") + "</div>";
    drawIntf(L);
  }
  function drawIntf(L) {
    intfLayerOff(); if (!W.L || !L.length) return;
    intfLayer = W.L.layerGroup();
    var col = { low: "#e67700", moderate: "#d9480f", severe: "#c92a2a" };
    L.slice(0, 200).forEach(function (r) {
      if (!isFinite(r.lat) || !isFinite(r.lon)) return;
      W.L.circleMarker([r.lat, r.lon], { radius: 7, color: "#fff", weight: 1.5, fillColor: col[r.sev] || "#c92a2a", fillOpacity: 0.9 })
        .bindPopup("<b>Interference (operator report)</b><br>" + E(zT(r.t)) + " · " + E((R().BANDS.filter(function (x) { return x.id === r.band; })[0] || { label: "Other band" }).label) + (r.note ? "<br>" + E(r.note) : "")).addTo(intfLayer);
    });
    S.ctx.layer.addLayer(intfLayer);
  }
  function intfAct(t) {
    var a = t.getAttribute("data-if"); if (!a) return;
    var L = logs(KI);
    if (a === "add") {
      var c = S.ctx.map.getCenter(), f = parseFloat(fv("#cpif-f")), b = fv("#cpif-b");
      L.unshift({ id: rid("if"), type: "interference-report", t: zTime(fv("#cpif-t")), band: R().BANDS.some(function (x) { return x.id === b; }) ? b : "other", f: isFinite(f) && f > 0 ? Math.round(f * 1000) / 1000 : null,
        sev: SEV.some(function (x) { return x[0] === fv("#cpif-s"); }) ? fv("#cpif-s") : "moderate", impact: IMP.some(function (x) { return x[0] === fv("#cpif-i"); }) ? fv("#cpif-i") : "degraded",
        note: clip(fv("#cpif-n"), 160), lat: Math.round(c.lat * 1e5) / 1e5, lon: Math.round((W.OSAP_GEO && W.OSAP_GEO.wrap ? W.OSAP_GEO.wrap(c.lng) : c.lng) * 1e5) / 1e5, created: Date.now() });
      L.sort(function (x, y) { return y.t - x.t; }); saveLog(KI, L);
    } else if (a === "del") { if (!W.confirm("Delete this report?")) return; saveLog(KI, L.filter(function (r) { return r.id !== t.getAttribute("data-id"); })); }
    render();
  }

  /* troubleshooting: a fixed order of checks; it points to where to look and never claims a cause */
  function renderFix(box) {
    var i = FS.step, h = '<div class="sec cpsec"><h3>Troubleshooting</h3><p class="obs">Work through the checks in order: power, antenna, cable, programming, network, line of sight, interference, outside infrastructure. The checks point to where to look; they do not prove the cause.</p>' +
      '<ol class="cpfixs">' + FIX.map(function (f, j) { var r = FS.res[f[0]]; return '<li class="' + (j === i ? "cur" : "") + '">' + E(f[1]) + (r ? ' <span class="cpbadge" style="background:' + (r === "ok" ? "#2b8a3e" : r === "bad" ? "#c92a2a" : "#6c757d") + '">' + (r === "ok" ? "OK" : r === "bad" ? "PROBLEM" : "SKIPPED") + "</span>" : "") + "</li>"; }).join("") + "</ol></div>";
    if (i < FIX.length) {
      var f = FIX[i];
      h += '<div class="sec cpsec"><h3>' + (i + 1) + ". " + E(f[1]) + "</h3><ul class=\"cpfixl\">" + f[2].map(function (c) { return "<li>" + E(c) + "</li>"; }).join("") + "</ul>" +
        '<div class="cpbtns"><button type="button" class="cpgo" data-fx="ok">All fine</button><button type="button" data-fx="bad">Found a problem</button><button type="button" data-fx="skip">Skip</button>' + (i ? '<button type="button" data-fx="back">Back</button>' : "") + "</div></div>";
    }
    var bad = FIX.filter(function (f) { return FS.res[f[0]] === "bad"; });
    if (bad.length || i >= FIX.length) {
      h += '<div class="sec cpsec' + (bad.length ? " cpwarn" : "") + '">' + (bad.length ? "<b>Look first at:</b> " + bad.map(function (f) { return E(f[1]); }).join(", ") + "." : "<b>No problem found in these checks.</b> The fault may be at the other station or outside what these checks cover; record what you tried.") +
        '<label class="cpw">What you changed<input id="cpfx-n" maxlength="160" value="' + E(FS.note) + '"></label><div class="cpbtns"><button type="button" data-fx="log">Add to the check log</button><button type="button" data-fx="reset">Start again</button></div></div>';
    }
    box.innerHTML = h;
  }
  function fixAct(t) {
    var a = t.getAttribute("data-fx"); if (!a) return;
    var n = S.ctx.rail.querySelector("#cpfx-n"); if (n) FS.note = clip(n.value, 160);
    if (a === "ok" || a === "bad" || a === "skip") { FS.res[FIX[FS.step][0]] = a; FS.step++; }
    else if (a === "back") FS.step = Math.max(0, FS.step - 1);
    else if (a === "reset") FS = { step: 0, res: {}, note: "" };
    else if (a === "log") {
      var bad = FIX.filter(function (f) { return FS.res[f[0]] === "bad"; }).map(function (f) { return f[1]; });
      var L = logs(KC); L.unshift({ id: rid("ck"), type: "comms-check", t: Date.now(), station: "Troubleshooting", net: "", result: bad.length ? "fail" : "ok", q: "", problem: bad.length ? "Checks found a problem in: " + bad.join(", ") : "No problem found in the checks", action: FS.note, op: "", created: Date.now() });
      saveLog(KC, L); S.sub = "checks"; try { localStorage.setItem(KS, "checks"); } catch (e) {}
    }
    render();
  }

  /* ---------- Link: free-space link budget ---------- */
  var LDEF = { band: "vhf", f_mhz: 155, d_km: 10, ptx_w: 20, gtx_dbi: 2, ltx_db: 1, grx_dbi: 2, lrx_db: 1, sens_dbm: -110, fade_db: 10, ha_m: 2, hb_m: 2, k: 1.333 };
  function linkIn() { var o = get(KL, {}), r = {}; Object.keys(LDEF).forEach(function (k) { r[k] = k === "band" ? (typeof o.band === "string" ? o.band : LDEF.band) : num(o[k], LDEF[k]); }); return r; }
  function renderLink() {
    var el = pane(), L = linkIn(), Rd = R();
    var fld = function (k, lab, step, unit) { return '<label>' + lab + '<span class="cpu"><input type="number" step="' + step + '" data-cpl="' + k + '" value="' + E(L[k]) + '">' + (unit ? " " + unit : "") + "</span></label>"; };
    el.innerHTML = '<div class="sec cpsec"><h3>Radio link (free space)</h3>' +
      '<div class="cprow"><label>Band<select data-cpl="band">' + opts(Rd.BANDS.map(function (b) { return [b.id, b.label]; }).concat([["custom", "Custom"]]), L.band) + "</select></label>" +
      fld("f_mhz", "Frequency", "any", "MHz") + fld("d_km", "Distance", "any", "km") + fld("ptx_w", "Transmit power", "any", "W") +
      fld("gtx_dbi", "Tx antenna gain", "any", "dBi") + fld("ltx_db", "Tx cable + connectors", "any", "dB") + fld("grx_dbi", "Rx antenna gain", "any", "dBi") + fld("lrx_db", "Rx cable + connectors", "any", "dB") +
      fld("sens_dbm", "Rx sensitivity", "any", "dBm") + fld("fade_db", "Fade margin wanted", "any", "dB") + fld("ha_m", "Antenna A height", "any", "m") + fld("hb_m", "Antenna B height", "any", "m") + fld("k", "k-factor", "0.01", "") + "</div>" +
      '<div id="cp-lout" aria-live="polite"></div>' +
      '<p class="obs"><b>MODELLED: free space over a smooth Earth.</b> Hills, buildings, trees, weather, interference and the ionosphere are not included. The terrain link (ground profile between two points, what blocks it, and how much antenna height clears it) joins this tab with the terrain engine.</p></div>';
    linkOut();
  }
  function linkOut() {
    var el = S.ctx && S.ctx.rail.querySelector("#cp-lout"); if (!el) return;
    var L = linkIn(), Rd = R(), b = Rd.linkBudget({ ptx_w: L.ptx_w, gtx_dbi: L.gtx_dbi, ltx_db: L.ltx_db, grx_dbi: L.grx_dbi, lrx_db: L.lrx_db, sens_dbm: L.sens_dbm, d_km: L.d_km, f_mhz: L.f_mhz, fade_db: L.fade_db });
    var m = b.margin_db, cls = !isFinite(m) ? "unknown" : m >= Math.max(0, L.fade_db) ? "likely" : m >= 0 ? "marginal" : "unlikely", d_m = L.d_km * 1000;
    var hz = Rd.horizon_km(L.ha_m, L.k) + Rd.horizon_km(L.hb_m, L.k), fr = Rd.fresnel_m(d_m / 2, d_m / 2, L.f_mhz), bu = Rd.bulge_m(d_m / 2, d_m / 2, L.k);
    var band = Rd.BANDS.filter(function (x) { return x.id === L.band; })[0];
    var col = { likely: "#2b8a3e", marginal: "#e67700", unlikely: "#c92a2a", unknown: "#6c757d" }[cls];
    var word = { likely: "MARGIN MET", marginal: "BELOW WANTED FADE MARGIN", unlikely: "NO MARGIN", unknown: "UNKNOWN" }[cls];
    el.innerHTML = '<p class="cpres" style="border-left:5px solid ' + col + '"><b>' + word + "</b> (modelled): " + (isFinite(b.margin_db) ? f(b.margin_db, 1) + " dB above the receiver's sensitivity, " + (cls === "likely" ? "at least" : "against") + " the " + f(L.fade_db, 0) + " dB you want in hand." : "enter the numbers above.") + "</p>" +
      '<table class="rttab"><tbody>' +
      "<tr><th>EIRP</th><td>" + f(b.eirp_dbm, 1) + " dBm (" + f(Rd.dbmToW(b.eirp_dbm), 1) + " W)</td></tr>" +
      "<tr><th>Free-space loss</th><td>" + f(b.fspl_db, 1) + " dB over " + f(L.d_km, 2) + " km</td></tr>" +
      "<tr><th>Received</th><td>" + f(b.prx_dbm, 1) + " dBm</td></tr>" +
      "<tr><th>Free-space range</th><td>" + (b.fs_range_km > hz ? "more than the radio horizon: the horizon (" + f(hz, 1) + " km) and terrain limit this link, not power" : f(b.fs_range_km, 1) + " km keeping " + f(L.fade_db, 0) + " dB in hand") + "</td></tr>" +
      "<tr><th>Radio horizon</th><td>" + f(hz, 1) + " km for these antenna heights (k " + f(L.k, 2) + ")" + (L.d_km > hz ? ' <b class="cpbad">: the link is beyond it, so terrain-free line of sight is impossible</b>' : "") + "</td></tr>" +
      "<tr><th>1st Fresnel zone</th><td>" + f(fr, 1) + " m radius at mid-path; keep " + f(fr * 0.6, 1) + " m (60%) clear</td></tr>" +
      "<tr><th>Earth bulge</th><td>" + f(bu, 1) + " m at mid-path</td></tr></tbody></table>" +
      (band && band.note ? '<p class="obs">' + E(band.note) + "</p>" : "");
  }
  function linkInput(t) {
    var k = t.getAttribute("data-cpl"); if (!k) return;
    var o = linkIn();
    if (k === "band") { o.band = t.value; var b = R().BANDS.filter(function (x) { return x.id === t.value; })[0]; if (b) { o.f_mhz = b.f_mhz; var fi = S.ctx.rail.querySelector('[data-cpl="f_mhz"]'); if (fi) fi.value = b.f_mhz; } }
    else { var v = parseFloat(t.value); if (!isFinite(v)) return; o[k] = v; if (k === "f_mhz") { o.band = "custom"; var bs = S.ctx.rail.querySelector('[data-cpl="band"]'); if (bs) bs.value = "custom"; } }
    put(KL, o); linkOut();
  }

  /* ---------- Equipment: battery and power planner (localStorage osap-cp-power, part of the workspace) ---------- */
  function loadPower() {
    var p = get(KW, null), Rd = R();
    if (!p || !Array.isArray(p.devices)) p = { devices: [dev(Rd.DEVICES[0]), dev(Rd.DEVICES[6])], battery: JSON.parse(JSON.stringify(Rd.BATTERIES[0])), days: 3, spare_pct: 20, temp_c: 20, solar_w: 0, sun_h: 4, charger_w: 0, charger_eff: 0.8, gen_lph: 0, slots: 2, charge_h: 0 };
    return p;
  }
  function dev(t) { var d = JSON.parse(JSON.stringify(t)); d.qty = 1; d.id = rid("dv"); return d; }
  function renderPower(box) {
    var el = box || pane(), p = loadPower(), Rd = R();
    var n = function (k, v, step, w) { return '<input type="number" step="' + (step || "any") + '" min="0" data-cpw="' + k + '" value="' + E(v) + '"' + (w ? ' style="width:' + w + 'px"' : "") + ">"; };
    var h = '<div class="sec cpsec"><h3>Battery and power</h3><p class="obs">Typical figures to start from: change them to your own equipment\'s (check its manual). Duty cycle is transmit : receive : standby.</p>' +
      '<div class="cpdevs">';
    p.devices.forEach(function (d, i) {
      var pre = ' data-cpdv="' + i + '" data-cpk=', ni = function (k, lab, unit, w) { return "<label>" + lab + '<span class="cpu"><input type="number" step="any" min="0"' + pre + '"' + k + '" value="' + E(d[k]) + '"' + (w ? ' style="width:' + w + 'px"' : "") + ">" + (unit ? " " + unit : "") + "</span></label>"; };
      h += '<div class="cpdv"><div class="cpdvh"><input' + pre + '"name" value="' + E(d.name) + '" maxlength="60" aria-label="Device"><button type="button" class="cpx" data-cpa="rmdev" data-i="' + i + '" aria-label="Remove ' + E(d.name) + '">×</button></div><div class="cpdvf">' +
        ni("qty", "Qty", "", 46) + (d.tx_w != null ? ni("tx_w", "Transmit", "W", 52) + ni("rx_w", "Receive", "W", 52) + ni("sb_w", "Standby", "W", 52) +
        '<label>Duty<span class="cpu"><input' + pre + '"duty" value="' + E((d.duty || [1, 1, 8]).join(":")) + '" style="width:58px" aria-label="Duty cycle transmit:receive:standby"></span></label>' : ni("avg_w", "Average", "W", 52)) +
        ni("hours", "Hours a day", "", 46) + "</div></div>";
    });
    h += '</div><div class="cpbtns"><select data-cpa="adddev" aria-label="Add a device"><option value="">Add a device…</option>' + Rd.DEVICES.map(function (d) { return '<option value="' + E(d.id) + '">' + E(d.name) + "</option>"; }).join("") + "</select></div>" +
      '<div class="cprow"><label>Battery type<select data-cpa="bat">' + opts([["", "Choose a preset…"]].concat(Rd.BATTERIES.map(function (b) { return [b.id, b.name]; })), "") + "</select></label>" +
      "<label>Capacity" + '<span class="cpu">' + n("bat.wh", p.battery.wh) + " Wh</span></label><label>Weight<span class=\"cpu\">" + n("bat.kg", p.battery.kg) + " kg</span></label><label>Usable share<span class=\"cpu\">" + n("bat.usable", p.battery.usable, "0.05") + "</span></label></div>" +
      '<div class="cprow"><label>Mission days<span class="cpu">' + n("days", p.days) + '</span></label><label>Spares<span class="cpu">' + n("spare_pct", p.spare_pct, "1") + ' %</span></label><label>Coldest temperature<span class="cpu"><input type="number" step="any" data-cpw="temp_c" value="' + E(p.temp_c) + '"> °C</span></label></div>' +
      '<div class="cprow"><label>Solar panel<span class="cpu">' + n("solar_w", p.solar_w) + ' W</span></label><label>Peak sun<span class="cpu">' + n("sun_h", p.sun_h) + ' h/day</span></label>' +
      '<label>Charger from generator<span class="cpu">' + n("charger_w", p.charger_w) + ' W</span></label><label>Charger efficiency<span class="cpu">' + n("charger_eff", p.charger_eff, "0.05") + '</span></label><label>Generator fuel<span class="cpu">' + n("gen_lph", p.gen_lph) + " L/h</span></label>" +
      '<label>Charger slots<span class="cpu">' + n("slots", p.slots, "1") + '</span></label><label>Charge time<span class="cpu">' + n("charge_h", p.charge_h) + " h per battery</span></label></div>" +
      '<div id="cp-pout" aria-live="polite"></div></div>';
    el.innerHTML = h; powerOut();
  }
  function powerOut() {
    var el = S.ctx && S.ctx.rail.querySelector("#cp-pout"); if (!el) return;
    var p = loadPower(), r = R().powerPlan(p);
    var rows = r.rows.map(function (x) { return "<tr><td>" + E(x.name) + (x.qty !== 1 ? " ×" + x.qty : "") + "</td><td>" + f(x.avg_w, 1) + "</td><td>" + f(x.wh_day, 0) + "</td><td>" + f(x.bat_day, 1) + "</td></tr>"; }).join("");
    el.innerHTML = '<table class="rttab"><thead><tr><th>Device</th><th>Average W</th><th>Wh a day</th><th>Batteries a day</th></tr></thead><tbody>' + rows +
      "<tr><th>Total</th><th></th><th>" + f(r.wh_day, 0) + "</th><th>" + f(r.wh_day / r.wh_per_battery, 1) + "</th></tr></tbody></table>" +
      '<table class="rttab"><tbody>' +
      "<tr><th>Each battery gives</th><td>" + f(r.wh_per_battery, 0) + " Wh" + (r.cold_factor < 1 ? " (cold: about " + f(r.cold_factor * 100, 0) + "% of rated)" : "") + "</td></tr>" +
      (r.solar_wh_day > 0 ? "<tr><th>Solar a day</th><td>about " + f(r.solar_wh_day, 0) + " Wh (75% of panel × peak sun)</td></tr>" : "") +
      "<tr><th>Batteries for the mission</th><td><b>" + f(r.batteries_mission, 0) + "</b> (" + f(p.days, 1) + " days + " + f(p.spare_pct, 0) + "% spares" + (r.solar_wh_day > 0 ? ", after solar" : "") + "), " + f(r.weight_kg, 1) + " kg</td></tr>" +
      (isFinite(r.generator_h_day) ? "<tr><th>Generator</th><td>" + f(r.generator_h_day, 1) + " h a day to put back a day's use" + (isFinite(r.fuel_l_day) && r.fuel_l_day > 0 ? ", about " + f(r.fuel_l_day, 1) + " L fuel a day" : "") + "</td></tr>" : "") +
      (isFinite(r.charge_h_day) ? "<tr><th>Charging</th><td>" + f(r.charge_batteries_day, 0) + " batteries a day in " + f(p.slots, 0) + " slots: about " + f(r.charge_h_day, 1) + " h of charging a day" + (r.charge_h_day > 24 ? ' <b class="cpbad">: more than a day, add slots or batteries</b>' : "") + "</td></tr>" : "") +
      "</tbody></table>" +
      '<p class="obs"><b>Planning estimate.</b> Real draw depends on power setting, talk time, temperature, battery age and the equipment itself. Cold derating is a rule of thumb for lithium batteries.</p>';
  }
  function powerAct(t, ev) {
    var p = loadPower(), Rd = R(), a = t.getAttribute("data-cpa"), k = t.getAttribute("data-cpw"), i = t.getAttribute("data-cpdv"), rer = false;
    if (a === "adddev") { var d0 = Rd.DEVICES.filter(function (x) { return x.id === t.value; })[0]; if (!d0 || p.devices.length >= 30) return; p.devices.push(dev(d0)); rer = true; }
    else if (a === "rmdev" && ev === "click") { p.devices.splice(+t.getAttribute("data-i"), 1); rer = true; }
    else if (a === "bat") { var b0 = Rd.BATTERIES.filter(function (x) { return x.id === t.value; })[0]; if (!b0) return; p.battery = JSON.parse(JSON.stringify(b0)); rer = true; }
    else if (k) { var v = parseFloat(t.value); if (!isFinite(v)) return; if (k.indexOf("bat.") === 0) p.battery[k.slice(4)] = Math.max(0, v); else p[k] = k === "temp_c" ? v : Math.max(0, v); }
    else if (i != null) {
      var d = p.devices[+i], dk = t.getAttribute("data-cpk"); if (!d) return;
      if (dk === "name") d.name = clip(t.value, 60);
      else if (dk === "duty") { var m = String(t.value).split(/[:/ ]+/).map(Number); if (m.length !== 3 || m.some(function (x) { return !isFinite(x) || x < 0; })) return; d.duty = m; }
      else { var nv = parseFloat(t.value); if (!isFinite(nv)) return; d[dk] = Math.max(0, dk === "hours" ? Math.min(24, nv) : nv); }
    } else return;
    if (!put(KW, p)) { var o = S.ctx.rail.querySelector("#cp-pout"); if (o) o.insertAdjacentHTML("afterbegin", '<p class="obs">This device\'s storage is full: the power plan was not saved.</p>'); }
    if (rer) render(); else powerOut();
  }

  /* ---------- Equipment tab: power, loadout, cable and feedline, antennas, connectors, spectrum, COMSEC ----------
     Loadout, channel plan and COMSEC records are the operator's own, kept on this device in the active workspace
     (osap-cp-loadout, osap-cp-chan, osap-cp-comsec). Reference cards and figures are generic planning aids. */
  var KE = "osap-cp-esub", KLO = "osap-cp-loadout", KCB = "osap-cp-cable", KCH = "osap-cp-chan", KCS = "osap-cp-comsec";
  var ESUBS = [["power", "Power"], ["loadout", "Loadout"], ["cable", "Cable and feedline"], ["antennas", "Antennas"], ["connectors", "Connectors"], ["spectrum", "Spectrum"], ["comsec", "COMSEC"]];
  var LOCATS = ["Radio", "Antenna", "Cable", "Battery", "Adapter", "Charger / power", "Spare", "Fill device", "Tool", "Consumable", "Other"];
  var CSTYPES = ["Key material (by short title)", "Fill device", "Crypto equipment", "Other"];
  var CSSTAT = ["On hand", "Issued", "Loaded", "Superseded", "Destroyed", "Turned in"];
  var ANT = [
    ["Whip / vertical (quarter wave)", "Vertical", "All round (omni) in the horizontal plane", "about 0 to 2 dBi", "Vehicle and manpack VHF/UHF. Needs a ground plane: the vehicle roof or the radio body and operator. Keep it upright and clear of metal; height helps more than anything else."],
    ["Half-wave dipole", "Horizontal or vertical, as mounted", "Figure of eight broadside to the wire (horizontal)", "about 2.1 dBi", "Fixed VHF/UHF and HF stations. Feed in the centre; keep the two legs straight and the feedline at right angles to them."],
    ["Inverted-V / NVIS dipole (HF)", "Mostly horizontal", "Low and flat (NVIS): energy goes up and comes back down within about 0 to 400 km", "low gain, wide coverage", "Short-range HF over hills where line of sight fails. Low mast (2 to 6 m), legs sloping down; choose frequencies low enough for near-vertical reflection."],
    ["Sloping wire / end-fed long wire (HF)", "Mixed", "Favours the direction the wire slopes down toward", "varies with length", "Quick HF setup from a tree or mast. Needs a tuner or matching unit and a counterpoise or ground."],
    ["Yagi", "Linear, as mounted", "Directional: one main lobe", "about 6 to 12 dBi", "Point-to-point and relay links. Aim it (bearing on the Link tab); match polarisation with the far end."],
    ["Log-periodic", "Linear", "Directional over a wide frequency range", "about 5 to 8 dBi", "Wide-band directional use when frequencies change. Aim like a Yagi."],
    ["Patch / panel", "Linear or circular", "Directional, broad beam", "about 6 to 14 dBi", "Data links, sector coverage. Mount rigidly; small aiming errors matter at higher gain."],
    ["Helix / crossed dipole (SATCOM)", "Circular", "Upward and toward the satellite", "about 6 to 14 dBi", "Satellite terminals. Point to the azimuth and elevation of the satellite; keep the sky view clear of trees, walls and terrain."],
    ["Discone", "Vertical", "All round, very wide frequency range", "about 0 to 2 dBi", "Wide-band receive or monitoring of your own channels, base stations. Mount high and clear."]
  ];
  function esub() { return S.esub || "power"; }
  function renderEquip() {
    var el = pane(), sub = esub();
    el.innerHTML = '<div class="cpsub" role="group" aria-label="Equipment views">' + ESUBS.map(function (s) { return '<button type="button" data-cpesub="' + s[0] + '" aria-pressed="' + (s[0] === sub) + '">' + s[1] + "</button>"; }).join("") + '</div><div id="cp-esub"></div>';
    var box = el.querySelector("#cp-esub");
    if (sub === "power") renderPower(box); else if (sub === "loadout") renderLoadout(box); else if (sub === "cable") renderCable(box); else if (sub === "antennas") renderAntennas(box);
    else if (sub === "connectors") renderConn(box); else if (sub === "spectrum") renderSpectrum(box); else renderComsec(box);
  }
  function equipClick(t) {
    var s = t.getAttribute("data-cpesub");
    if (s) { S.esub = s; try { localStorage.setItem(KE, s); } catch (e) {} render(); return; }
    var sub = esub();
    if (sub === "power") { if (t.hasAttribute("data-cpa")) powerAct(t, "click"); }
    else if (sub === "loadout") loAct(t); else if (sub === "cable") cableAct(t); else if (sub === "spectrum") chanAct(t); else if (sub === "comsec") csAct(t); else if (sub === "connectors") connOut();
  }
  function equipInput(t, type) {
    var sub = esub();
    if (sub === "power") { if (type === "change" || t.tagName !== "SELECT") powerAct(t, type); }
    else if (sub === "loadout") loInput(t); else if (sub === "cable") cableOut(); else if (sub === "antennas") antOut(); else if (sub === "connectors") connOut(); else if (sub === "spectrum") specOut(); else if (sub === "comsec") csInput(t);
  }

  /* loadout */
  function loadLo() { var v = get(KLO, null); return v && Array.isArray(v.items) ? v : { items: [] }; }
  function renderLoadout(box) {
    var lo = loadLo(), tot = 0, byCat = {}, byWho = {};
    lo.items.forEach(function (x) { var w = num(x.qty, 0) * num(x.kg, 0); tot += w; byCat[x.cat] = (byCat[x.cat] || 0) + w; var k = x.who || "Not assigned"; byWho[k] = (byWho[k] || 0) + w; });
    var h = '<div class="sec cpsec"><h3>Equipment loadout</h3><p class="obs">Radios, antennas, cables, batteries, adapters, chargers, spares, fill devices (as items only), tools and consumables, with who carries them.</p>';
    lo.items.forEach(function (x, i) {
      var pre = ' data-lo="' + i + '" data-cpk=';
      h += '<div class="cpdv"><div class="cpdvh"><input' + pre + '"name" value="' + E(x.name) + '" maxlength="60" aria-label="Item"><button type="button" class="cpx" data-loa="rm" data-i="' + i + '" aria-label="Remove ' + E(x.name) + '">×</button></div><div class="cpdvf">' +
        "<label>Type<select" + pre + '"cat">' + opts(LOCATS, x.cat) + "</select></label>" +
        '<label>Qty<input type="number" min="0" step="1"' + pre + '"qty" value="' + E(x.qty) + '" style="width:50px"></label>' +
        '<label>Each (kg)<input type="number" min="0" step="any"' + pre + '"kg" value="' + E(x.kg) + '" style="width:60px"></label>' +
        "<label>Carried by<input" + pre + '"who" value="' + E(x.who) + '" maxlength="30" style="width:90px"></label></div></div>';
    });
    h += '<div class="cpbtns"><button type="button" class="cpgo" data-loa="add">Add an item</button><button type="button" data-loa="bats">Add batteries from the power plan</button>' + (lo.items.length ? '<button type="button" data-loa="text">Copy as text</button>' : "") + "</div>" +
      '<div id="cp-loout">' + loTotals(tot, byCat, byWho) + '</div><p class="obs" id="cp-msg">Kept on this device in the active workspace.</p></div>';
    box.innerHTML = h;
  }
  function loTotals(tot, byCat, byWho) {
    var rows = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).map(function (k) { return "<tr><td>" + E(k) + "</td><td>" + f(o[k], 1) + " kg</td></tr>"; }).join(""); };
    return tot > 0 ? '<table class="rttab"><tbody><tr><th>Total</th><th>' + f(tot, 1) + " kg</th></tr>" + rows(byCat) + '</tbody></table><table class="rttab"><thead><tr><th>Carried by</th><th></th></tr></thead><tbody>' + rows(byWho) + "</tbody></table>" : "";
  }
  function loAct(t) {
    var a = t.getAttribute("data-loa"); if (!a) return;
    var lo = loadLo();
    if (a === "add") { if (lo.items.length >= 200) return; lo.items.push({ id: rid("lo"), cat: "Radio", name: "", qty: 1, kg: 0, who: "" }); }
    else if (a === "rm") lo.items.splice(+t.getAttribute("data-i"), 1);
    else if (a === "bats") { var p = loadPower(), r = R().powerPlan(p); if (!isFinite(r.batteries_mission)) return; lo.items.push({ id: rid("lo"), cat: "Battery", name: p.battery.name || "Battery", qty: r.batteries_mission, kg: num(p.battery.kg, 0), who: "" }); }
    else if (a === "text") { copyText(["EQUIPMENT LOADOUT"].concat(lo.items.map(function (x) { return x.cat + " | " + x.name + " | qty " + x.qty + " | " + f(num(x.qty, 0) * num(x.kg, 0), 2) + " kg" + (x.who ? " | " + x.who : ""); })).join("\n")); return; }
    put(KLO, lo); render();
  }
  function loInput(t) {
    var i = t.getAttribute("data-lo"); if (i == null) return;
    var lo = loadLo(), x = lo.items[+i], k = t.getAttribute("data-cpk"); if (!x) return;
    if (k === "name") x.name = clip(t.value, 60); else if (k === "who") x.who = clip(t.value, 30); else if (k === "cat") { if (LOCATS.indexOf(t.value) < 0) return; x.cat = t.value; }
    else { var v = parseFloat(t.value); if (!isFinite(v)) return; x[k] = Math.max(0, k === "qty" ? Math.round(v) : v); }
    put(KLO, lo);
    var tot = 0, byCat = {}, byWho = {}; lo.items.forEach(function (y) { var w = num(y.qty, 0) * num(y.kg, 0); tot += w; byCat[y.cat] = (byCat[y.cat] || 0) + w; var kk = y.who || "Not assigned"; byWho[kk] = (byWho[kk] || 0) + w; });
    var o = S.ctx.rail.querySelector("#cp-loout"); if (o) o.innerHTML = loTotals(tot, byCat, byWho);
  }

  /* cable and feedline */
  var CBDEF = { cable: "lmr400", f_mhz: 155, len_m: 10, connectors: 2, conn_db: 0.15, ptx_w: 20, gain_dbi: 2 };
  function cableIn() { var o = get(KCB, {}), r = {}; Object.keys(CBDEF).forEach(function (k) { r[k] = k === "cable" ? (R().CABLES.some(function (c) { return c.id === o.cable; }) ? o.cable : CBDEF.cable) : num(o[k], CBDEF[k]); }); return r; }
  function renderCable(box) {
    var c = cableIn(), fld = function (k, lab, unit, st) { return "<label>" + lab + '<span class="cpu"><input type="number" step="' + (st || "any") + '" min="0" data-cb="' + k + '" value="' + E(c[k]) + '">' + (unit ? " " + unit : "") + "</span></label>"; };
    box.innerHTML = '<div class="sec cpsec"><h3>Cable and feedline loss</h3><div class="cprow"><label>Cable<select data-cb="cable">' + opts(R().CABLES.map(function (x) { return [x.id, x.name]; }), c.cable) + "</select></label>" +
      fld("f_mhz", "Frequency", "MHz") + fld("len_m", "Length", "m") + fld("connectors", "Connectors and adapters", "", "1") + fld("conn_db", "Loss each", "dB", "0.05") + fld("ptx_w", "Transmit power", "W") + fld("gain_dbi", "Antenna gain", "dBi") + "</div>" +
      '<div id="cp-cbout" aria-live="polite"></div><div class="cpbtns"><button type="button" data-cb="use">Use these in the Link tab</button></div>' +
      '<p class="obs"><b>Planning estimate</b> from typical datasheet figures for each cable class; your cable\'s datasheet and its condition (water, crushing, old connectors) can make it much worse.</p></div>';
    cableOut();
  }
  function cableOut() {
    var o = {}; S.ctx.rail.querySelectorAll("[data-cb]").forEach(function (i) { var k = i.getAttribute("data-cb"); if (k !== "use") o[k] = k === "cable" ? i.value : parseFloat(i.value); });
    var c = cableIn(); Object.keys(o).forEach(function (k) { if (k === "cable" || isFinite(o[k])) c[k] = o[k]; }); put(KCB, c);
    var r = R().feedline(c), el = S.ctx.rail.querySelector("#cp-cbout"); if (!el) return;
    el.innerHTML = '<table class="rttab"><tbody><tr><th>Cable</th><td>' + f(r.db_per_100m, 1) + " dB per 100 m at " + f(c.f_mhz, 0) + " MHz: " + f(r.cable_db, 2) + " dB over " + f(c.len_m, 1) + " m</td></tr>" +
      "<tr><th>Connectors</th><td>" + f(r.connector_db, 2) + " dB</td></tr><tr><th>Total loss</th><td><b>" + f(r.total_db, 2) + " dB</b>: " + f(r.lost_pct, 0) + "% of the power is lost</td></tr>" +
      "<tr><th>At the antenna</th><td>" + f(r.w_at_antenna, 1) + " W of " + f(c.ptx_w, 1) + " W</td></tr><tr><th>EIRP</th><td>" + f(r.eirp_dbm, 1) + " dBm (" + f(R().dbmToW(r.eirp_dbm), 1) + " W)</td></tr></tbody></table>";
  }
  function cableAct(t) {
    if (t.getAttribute("data-cb") !== "use") return;
    var c = cableIn(), r = R().feedline(c), L = linkIn();
    L.f_mhz = c.f_mhz; L.ptx_w = c.ptx_w; L.gtx_dbi = c.gain_dbi; L.ltx_db = Math.round(r.total_db * 100) / 100; L.band = "custom"; put(KL, L);
    setTab("link");
  }

  /* antennas */
  function renderAntennas(box) {
    box.innerHTML = '<div class="sec cpsec"><h3>Antenna lengths</h3><div class="cprow"><label>Frequency<span class="cpu"><input type="number" step="any" min="0" id="cpant-f" value="' + E(linkIn().f_mhz) + '"> MHz</span></label></div><div id="cp-antout"></div>' +
      '<p class="obs">Wire lengths include a 5% shortening for end effect; trim while checking the match (SWR).</p></div>' +
      ANT.map(function (a) { return '<div class="sec cpsec cpant"><h3>' + E(a[0]) + '</h3><table class="rttab"><tbody><tr><th>Polarisation</th><td>' + E(a[1]) + "</td></tr><tr><th>Pattern</th><td>" + E(a[2]) + "</td></tr><tr><th>Typical gain</th><td>" + E(a[3]) + "</td></tr></tbody></table><p>" + E(a[4]) + "</p></div>"; }).join("") +
      '<div class="sec cpsec"><p class="obs">Generic reference cards. Use your equipment\'s own manuals and your unit\'s procedures; polarisation must match at both ends (a mismatch can cost 20 dB or more).</p></div>';
    antOut();
  }
  function antOut() {
    var i = S.ctx.rail.querySelector("#cpant-f"), el = S.ctx.rail.querySelector("#cp-antout"); if (!i || !el) return;
    var fm = parseFloat(i.value), Rd = R();
    el.innerHTML = fm > 0 ? '<table class="rttab"><tbody><tr><th>Full wave (free space)</th><td>' + f(Rd.antennaLen_m(fm, 1, 1), 2) + " m</td></tr><tr><th>Half-wave dipole, total</th><td>" + f(Rd.antennaLen_m(fm, 0.5), 2) + " m (each leg " + f(Rd.antennaLen_m(fm, 0.25), 2) + " m)</td></tr><tr><th>Quarter-wave whip</th><td>" + f(Rd.antennaLen_m(fm, 0.25), 2) + " m</td></tr><tr><th>5/8-wave whip</th><td>" + f(Rd.antennaLen_m(fm, 0.625), 2) + " m</td></tr></tbody></table>" : "";
  }

  /* connectors */
  function renderConn(box) {
    var C = R().CONNECTORS, sel = function (id, def) { return '<select id="' + id + '">' + opts(C.map(function (c) { return [c.id, c.name]; }), def) + "</select>"; }, gen = function (id, def) { return '<select id="' + id + '">' + opts([["f", "female (socket)"], ["m", "male (pin)"]], def) + "</select>"; };
    box.innerHTML = '<div class="sec cpsec"><h3>Connector and adapter chain</h3><p class="obs">The connector on each device\'s port, as it is on the device.</p><div class="cprow">' +
      "<label>Device A port" + sel("cpcn-a", "bnc") + "</label><label>Device A gender" + gen("cpcn-ag", "f") + "</label><label>Device B port" + sel("cpcn-b", "n") + "</label><label>Device B gender" + gen("cpcn-bg", "f") + "</label>" +
      '<label>Frequency<span class="cpu"><input type="number" id="cpcn-f" step="any" min="0" value="' + E(linkIn().f_mhz) + '"> MHz</span></label></div><div id="cp-cnout" aria-live="polite"></div>' +
      '<p class="obs">Assumes 50-ohm RF ports and a cable with the opposite gender at each end, or an adapter. Each adapter adds loss and a failure point: fewer is better.</p></div>';
    connOut();
  }
  function connOut() {
    var g = function (id) { var e = S.ctx.rail.querySelector("#" + id); return e ? e.value : ""; }, el = S.ctx.rail.querySelector("#cp-cnout"); if (!el) return;
    var r = R().adapterChain({ type: g("cpcn-a"), gender: g("cpcn-ag") }, { type: g("cpcn-b"), gender: g("cpcn-bg") }, parseFloat(g("cpcn-f")));
    if (!r) { el.innerHTML = ""; return; }
    el.innerHTML = '<p class="cpres" style="border-left:5px solid ' + (r.direct ? "#2b8a3e" : "#e67700") + '">' + (r.direct ? "<b>Direct fit:</b> these two mate without an adapter." : "<b>Needs:</b> " + r.parts.map(function (p) { return E(p.name) + " (about " + f(p.db, 2) + " dB)"; }).join(", ") + ", or a cable with these two ends.") + "</p>" +
      r.notes.map(function (n) { return '<p class="obs cpbad">' + E(n) + "</p>"; }).join("");
  }

  /* spectrum reference + the operator's own channel plan */
  function loadChan() { var v = get(KCH, []); return Array.isArray(v) ? v : []; }
  function renderSpectrum(box) {
    var reg = R().ituRegion(S.ctx.cc), ch = loadChan();
    box.innerHTML = '<div class="sec cpsec"><h3>Spectrum reference</h3><p>' + E(S.ctx.name || "") + " is in <b>ITU Region " + reg + "</b>.</p>" +
      '<div class="cprow"><label>Look up a frequency<span class="cpu"><input type="number" step="any" min="0" id="cpsp-f" placeholder="MHz"> MHz</span></label></div><div id="cp-spout" aria-live="polite"></div>' +
      '<table class="rttab"><thead><tr><th>MHz</th><th>Common use</th></tr></thead><tbody>' + R().SPECTRUM.map(function (s) { var r = s.r && s.r[reg], lo = r ? r[0] : s.lo, hi = r ? r[1] : s.hi; return "<tr" + (s.kind === "distress" ? ' class="cpdis"' : "") + "><td>" + f(lo, 3) + (hi !== lo ? "–" + f(hi, 3) : "") + "</td><td>" + E(s.name) + "</td></tr>"; }).join("") + "</tbody></table>" +
      '<p class="obs">A reference summary of common civil uses, not an allocation table or a licence. Host-nation rules and your unit\'s frequency assignment decide what you may use.</p></div>' +
      '<div class="sec cpsec"><h3>Channel plan</h3><p class="obs">Channels you have been assigned, entered by you.</p><div class="cprow"><label>Name<input id="cpch-n" maxlength="30"></label><label>Frequency<span class="cpu"><input type="number" step="any" min="0" id="cpch-f"> MHz</span></label>' +
      '<label>Mode<input id="cpch-m" maxlength="20" placeholder="FM, USB, data…"></label><label>Net<input id="cpch-net" maxlength="40"></label><label class="cpw">Note<input id="cpch-note" maxlength="120"></label></div>' +
      '<div class="cpbtns"><button type="button" class="cpgo" data-ch="add">Add the channel</button>' + (ch.length ? '<button type="button" data-ch="text">Copy as text</button>' : "") + '</div><p class="obs" id="cp-msg">Kept on this device in the active workspace.</p>' +
      (ch.length ? '<table class="rttab cplog"><thead><tr><th>Channel</th><th>MHz</th><th>Notes</th><th></th></tr></thead><tbody>' + ch.map(function (c) {
        var hit = R().spectrumAt(c.f, reg), dis = hit.some(function (s) { return s.kind === "distress"; });
        return "<tr><td><b>" + E(c.name) + "</b>" + (c.net ? "<br><small>" + E(c.net) + "</small>" : "") + "</td><td>" + f(c.f, 4) + (c.mode ? "<br><small>" + E(c.mode) + "</small>" : "") + "</td><td>" + E(c.note) + (dis ? '<br><small class="cpbad">Distress, emergency or navigation frequency: check this entry.</small>' : hit.length ? "<br><small>" + E(hit[hit.length - 1].name) + "</small>" : "") +
          '</td><td><button type="button" class="cpx" data-ch="del" data-id="' + E(c.id) + '" aria-label="Delete channel">×</button></td></tr>';
      }).join("") + "</tbody></table>" : "") + "</div>";
  }
  function specOut() {
    var i = S.ctx.rail.querySelector("#cpsp-f"), el = S.ctx.rail.querySelector("#cp-spout"); if (!i || !el) return;
    var hit = R().spectrumAt(parseFloat(i.value), R().ituRegion(S.ctx.cc));
    el.innerHTML = i.value === "" ? "" : hit.length ? "<ul>" + hit.map(function (s) { return "<li" + (s.kind === "distress" ? ' class="cpbad"' : "") + ">" + E(s.name) + "</li>"; }).join("") + "</ul>" : '<p class="obs">Not in this short reference. That says nothing about whether it is free to use.</p>';
  }
  function chanAct(t) {
    var a = t.getAttribute("data-ch"); if (!a) return;
    var ch = loadChan();
    if (a === "add") {
      var fq = parseFloat(fv("#cpch-f")), nm = clip(fv("#cpch-n"), 30);
      if (!nm || !(fq > 0)) { note("Enter a name and a frequency."); return; }
      if (ch.length >= 200) return;
      ch.push({ id: rid("ch"), name: nm, f: fq, mode: clip(fv("#cpch-m"), 20), net: clip(fv("#cpch-net"), 40), note: clip(fv("#cpch-note"), 120) });
      ch.sort(function (x, y) { return x.f - y.f; });
    } else if (a === "del") { if (!W.confirm("Delete this channel?")) return; ch = ch.filter(function (c) { return c.id !== t.getAttribute("data-id"); }); }
    else if (a === "text") { copyText(["CHANNEL PLAN"].concat(ch.map(function (c) { return c.name + " | " + c.f + " MHz" + (c.mode ? " | " + c.mode : "") + (c.net ? " | " + c.net : "") + (c.note ? " | " + c.note : ""); })).join("\n")); return; }
    if (!put(KCH, ch)) { note("This device's storage is full: not saved."); return; }
    render();
  }

  /* COMSEC accountability: administrative status only */
  function loadCs() { var v = get(KCS, []); return Array.isArray(v) ? v : []; }
  function dayMs(s) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function csState(x) {
    if (x.status === "Destroyed" || x.status === "Turned in" || x.status === "Superseded") return ["CLOSED", "#6c757d"];
    var e = dayMs(x.expires), now = Date.now(); if (!isFinite(e)) return ["NO EXPIRY SET", "#6c757d"];
    if (e + 86400000 <= now) return ["EXPIRED", "#c92a2a"];
    if (e - now <= 7 * 86400000) return ["EXPIRES SOON", "#e67700"];
    return ["CURRENT", "#2b8a3e"];
  }
  function renderComsec(box) {
    var L = loadCs();
    box.innerHTML = '<div class="sec cpsec"><h3>COMSEC accountability</h3><p class="cpres" style="border-left:5px solid #c92a2a"><b>Administrative tracking only.</b> Never enter key material, key values, fill data or passwords. Entries that look like key data are refused.</p><div class="cprow">' +
      '<label>Short title / designator<input id="cpcs-st" maxlength="40"></label><label>Edition<input id="cpcs-ed" maxlength="20"></label><label>Type<select id="cpcs-ty">' + opts(CSTYPES, CSTYPES[0]) + "</select></label>" +
      '<label>Assigned to equipment<input id="cpcs-eq" maxlength="40" placeholder="radio or device"></label><label>Custodian / holder<input id="cpcs-cu" maxlength="40"></label>' +
      '<label>Effective<input type="date" id="cpcs-ef"></label><label>Expires<input type="date" id="cpcs-ex"></label><label>Status<select id="cpcs-sts">' + opts(CSSTAT, "On hand") + "</select></label>" +
      '<label class="cpw">Action required<input id="cpcs-ac" maxlength="120" placeholder="e.g. supersede on expiry, destruction with witness"></label></div>' +
      '<div class="cpbtns"><button type="button" class="cpgo" data-cs="add">Add the record</button></div><p class="obs" id="cp-msg">' + L.length + " record" + (L.length === 1 ? "" : "s") + ". Kept on this device in the active workspace; protect the device as your unit requires.</p>" +
      (L.length ? '<table class="rttab cplog"><thead><tr><th>Item</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>' + L.map(function (x) {
        var s = csState(x);
        return "<tr><td><b>" + E(x.st) + "</b>" + (x.ed ? " ed. " + E(x.ed) : "") + "<br><small>" + E(x.ty) + (x.eq ? " · " + E(x.eq) : "") + (x.cu ? " · " + E(x.cu) : "") + "</small>" + (x.ac ? "<br><small>Action: " + E(x.ac) + "</small>" : "") +
          "</td><td><small>" + (x.ef ? "From " + E(x.ef) + "<br>" : "") + (x.expires ? "To " + E(x.expires) : "") + '</small></td><td><span class="cpbadge" style="background:' + s[1] + '">' + s[0] + '</span><br><select data-csst="' + E(x.id) + '" aria-label="Status">' + opts(CSSTAT, x.status) + "</select>" +
          (x.changed ? "<br><small>" + E(zT(x.changed)) + "</small>" : "") + '</td><td><button type="button" class="cpx" data-cs="del" data-id="' + E(x.id) + '" aria-label="Delete record">×</button></td></tr>';
      }).join("") + "</tbody></table>" : "") + "</div>";
  }
  function csAct(t) {
    var a = t.getAttribute("data-cs"); if (!a) return;
    var L = loadCs();
    if (a === "add") {
      var x = { id: rid("cs"), type: "comsec-record", st: clip(fv("#cpcs-st"), 40), ed: clip(fv("#cpcs-ed"), 20), ty: CSTYPES.indexOf(fv("#cpcs-ty")) >= 0 ? fv("#cpcs-ty") : "Other", eq: clip(fv("#cpcs-eq"), 40), cu: clip(fv("#cpcs-cu"), 40),
        ef: /^\d{4}-\d\d-\d\d$/.test(fv("#cpcs-ef")) ? fv("#cpcs-ef") : "", expires: /^\d{4}-\d\d-\d\d$/.test(fv("#cpcs-ex")) ? fv("#cpcs-ex") : "", status: CSSTAT.indexOf(fv("#cpcs-sts")) >= 0 ? fv("#cpcs-sts") : "On hand", ac: clip(fv("#cpcs-ac"), 120), created: Date.now(), changed: Date.now() };
      if (!x.st) { note("Enter the short title or designator."); return; }
      if ([x.st, x.ed, x.eq, x.cu, x.ac].some(R().looksLikeKey)) { note("Refused: an entry looks like key data. Enter administrative details only."); return; }
      if (L.length >= 200) return;
      L.unshift(x);
    } else if (a === "del") { if (!W.confirm("Delete this record?")) return; L = L.filter(function (y) { return y.id !== t.getAttribute("data-id"); }); }
    if (!put(KCS, L)) { note("This device's storage is full: not saved."); return; }
    render();
  }
  function csInput(t) {
    var id = t.getAttribute("data-csst"); if (!id || CSSTAT.indexOf(t.value) < 0) return;
    var L = loadCs(); L.forEach(function (x) { if (x.id === id) { x.status = t.value; x.changed = Date.now(); } }); put(KCS, L); render();
  }

  /* ---------- Coverage: route comms corridor ----------
     corridor(segments, opts) is shared with the evacuation planner: segments = [{ id, coords: [[lat, lon], ...], km_from, km_to }]
     (lon may run past 180). Per segment it resolves { id, status: good | degraded | none | unknown, sources: [{ kind: observed |
     mapped | modelled | reported, label, time }], reason, km_from, km_to, levels }. No panel or map changes; opts.signal stops it;
     opts.cc adds the country's IODA outage signal. A segment where nothing could be read is "unknown" with the reason. */
  var KCR = "osap-cp-corr", CSTAT = { good: ["Good", "#2b8a3e"], degraded: ["Degraded", "#e67700"], none: ["Likely none", "#c92a2a"], unknown: ["Unknown", "#868e96"] };
  var LIB_SRC = ["assets/comms/radio-lib.js", "assets/osap-comms.js"];
  function ensureComms() {
    if (W.OSAP_COMMSTAB && W.OSAP_COMMSTAB.evaluate && W.OSAP_RADIO) return Promise.resolve();
    LIB_SRC.forEach(function (src) {
      if (D.querySelector('script[src="' + src + '"]')) return;
      var sc = D.createElement("script"); sc.src = src; sc.async = false; D.head.appendChild(sc);
    });
    return new Promise(function (res, rej) {
      var n = 0; (function wait() { if (W.OSAP_COMMSTAB && W.OSAP_COMMSTAB.evaluate && W.OSAP_RADIO) res(); else if (++n > 400) rej(new Error("The coverage check did not load")); else setTimeout(wait, 50); })();
    });
  }
  function ioda(cc) {
    var I = W.ASAP_IODA, o = I && I.items && cc ? I.items[cc === "oki" ? "jp" : cc] : null;
    if (!I || !cc) return null;
    return { kind: "reported", label: o ? "IODA: " + o.events + " internet outage signal" + (o.events === 1 ? "" : "s") + " in the country since " + (I.from || "the last week") : "IODA: no internet outage signal in the country since " + (I.from || "the last week"), time: I.asof || "", events: o ? o.events : 0 };
  }
  function corridor(segments, opts) {
    opts = opts || {};
    var sig = opts.signal, out = [], i = 0;
    return ensureComms().then(function () {
      var src = W.OSAP_COMMSTAB.sources(), rep = ioda(opts.cc);
      function one(sg) {
        var base = { id: sg.id, km_from: sg.km_from, km_to: sg.km_to };
        var pts = (sg.coords || []).filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); }).map(function (p) { return [p[0], ((p[1] + 180) % 360 + 360) % 360 - 180]; });
        if (pts.length < 2) return Promise.resolve(Object.assign(base, { status: "unknown", sources: [], reason: "The segment has fewer than two points.", levels: [] }));
        return W.OSAP_COMMSTAB.evaluate(pts, { signal: sig }).then(function (r) {
          var lv = r.samples.map(function (x) { return x.v ? x.v.level : 0; }), measOk = r.samples.some(function (x) { return x.meas && x.meas.ok; }), sources = [];
          if (measOk) sources.push({ kind: "observed", label: "Speedtest by Ookla measured tests (all networks)", time: src.cov });
          if (r.mastsOk) sources.push({ kind: "mapped", label: "OpenStreetMap masts and towers", time: src.masts || "live" });
          if (r.mastsOk && !r.big) sources.push({ kind: "modelled", label: "Terrain line of sight to the nearest masts", time: "" });
          if (rep) sources.push({ kind: rep.kind, label: rep.label, time: rep.time });
          var status = measOk || r.mastsOk ? R().segStatus(lv) : "unknown", c = [0, 0, 0, 0];
          lv.forEach(function (l) { c[l]++; });
          var pc = function (k) { return Math.round(c[k] / (lv.length || 1) * 100); };
          var reason = !measOk && !r.mastsOk ? "Neither measured coverage nor masts could be loaded, so OSAP cannot say." :
            pc(3) + "% likely, " + pc(2) + "% possible, " + pc(1) + "% no sign" + (c[0] ? ", " + pc(0) + "% unknown" : "") + " at " + lv.length + " points." +
            (!measOk ? " Measured coverage could not be loaded." : "") + (!r.mastsOk ? " Masts could not be loaded." : r.big ? " Too long for the mast line-of-sight estimate." : "") +
            (rep && rep.events ? " The country has recent internet outage signals." : "");
          return Object.assign(base, { status: status, sources: sources, reason: reason, levels: lv });
        }, function (e) {
          if (e && e.name === "AbortError") throw e;
          return Object.assign(base, { status: "unknown", sources: rep ? [{ kind: rep.kind, label: rep.label, time: rep.time }] : [], reason: "The check could not be finished for this segment.", levels: [] });
        });
      }
      function next() {
        if (sig && sig.aborted) return Promise.reject(new DOMException("Stopped", "AbortError"));
        if (i >= segments.length) return Promise.resolve();
        var k = i++;
        return one(segments[k]).then(function (r) { out[k] = r; if (opts.progress) opts.progress(out.filter(Boolean).length, segments.length); return next(); });
      }
      return Promise.all([next(), next()]).then(function () { return out; });
    });
  }

  /* the Coverage tab's corridor section: the planned route cut into segments, a strip along it, the stretches that are not
     good, and the operator's PACE plans for the area. Kept on the device: the segment length; the answer is not stored. */
  var corrLayer = null, corrAbort = null;
  function corrLayerOff() { if (corrLayer && S.ctx) { S.ctx.layer.removeLayer(corrLayer); corrLayer = null; } }
  function plannedRoute() {
    var rt = W.OSAP_ROUTETAB, c = rt && rt.line && rt.line();
    if (c && c.length >= 2) return c;
    var cur = get("osap-route-cur", null);
    return cur && Array.isArray(cur.wps) && cur.wps.length >= 2 ? cur.wps.map(function (w) { return [+w.lat, +w.lon]; }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }) : null;
  }
  function segKm() { var v = num(get(KCR, {}).seg_km, 2); return Math.min(20, Math.max(0.5, v)); }
  function renderCoverage() {
    var el = pane(); if (!el) return;
    el.innerHTML = '<div class="sec cpsec"><h3>Route comms corridor</h3>' +
      '<p class="obs">The planned route from the Route tab, cut into segments, each rated Good, Degraded, Likely none or Unknown for phone and data coverage, with why.</p>' +
      '<div class="cpbtns"><label class="cpu">Segments of <input type="number" id="cpcr-seg" min="0.5" max="20" step="0.5" value="' + E(segKm()) + '"> km</label>' +
      '<button type="button" class="cpgo" data-cpcr="run">Check the planned route</button></div><div id="cp-crout" aria-live="polite"></div></div>';
    if (S.corr) paintCorr();
  }
  function corrRun() {
    var pts = plannedRoute(), out = S.ctx.rail.querySelector("#cp-crout");
    if (!pts) { S.corr = null; corrLayerOff(); if (out) out.innerHTML = '<p class="cpres" style="border-left:5px solid #6c757d">There is no planned route yet. Plan one on the Route tab, then check it here (or press <b>Comms along route</b> there).</p>'; return; }
    if (corrAbort) corrAbort.abort();
    var ac = W.AbortController ? new AbortController() : null; corrAbort = ac;
    var segs = R().splitLine(pts, segKm(), "route-L1"), tok = {};
    S.corr = { busy: true, tok: tok, pts: pts, segs: segs };
    if (out) out.innerHTML = '<p class="obs" id="cpcr-prog">Checking ' + segs.length + " segments…</p>" + '<div class="cpbtns"><button type="button" data-cpcr="stop">Stop</button></div>';
    /* after the page has fitted the country (opening from the Route tab), zoom to the route */
    setTimeout(function () { if (S.corr && S.corr.tok === tok) S.ctx.map.fitBounds(W.L.latLngBounds(pts).pad(0.15), { maxZoom: 13 }); }, 0);
    if (out && out.scrollIntoView) out.scrollIntoView({ block: "nearest" });
    corridor(segs, { signal: ac && ac.signal, cc: S.ctx.cc, progress: function (n, of) { var p = S.ctx && S.ctx.rail.querySelector("#cpcr-prog"); if (p) p.textContent = "Checking segment " + n + " of " + of + "…"; } })
      .then(function (res) { if (!S.corr || S.corr.tok !== tok) return; S.corr = { pts: pts, segs: segs, res: res, when: Date.now() }; paintCorr(); var o = S.ctx.rail.querySelector("#cp-crout"); if (o && o.scrollIntoView) o.scrollIntoView({ block: "nearest" }); },
        function (e) { if (!S.corr || S.corr.tok !== tok) return; S.corr = null; var o = S.ctx.rail.querySelector("#cp-crout"); if (o) o.innerHTML = '<p class="obs">' + (e && e.name === "AbortError" ? "Stopped." : "The check could not be finished: " + E(e && e.message || "error") + ".") + "</p>"; });
  }
  function stretches(res) {
    var out = [];
    res.forEach(function (r) { var l = out[out.length - 1]; if (l && l.status === r.status) { l.km_to = r.km_to; l.n++; } else out.push({ status: r.status, km_from: r.km_from, km_to: r.km_to, first: r, n: 1 }); });
    return out;
  }
  function paintCorr() {
    var o = S.ctx && S.ctx.rail.querySelector("#cp-crout"), c = S.corr; if (!o || !c || !c.res) return;
    var res = c.res, total = res.length ? res[res.length - 1].km_to : 0, km = { good: 0, degraded: 0, none: 0, unknown: 0 };
    res.forEach(function (r) { km[r.status] += r.km_to - r.km_from; });
    var bad = stretches(res).filter(function (s) { return s.status !== "good"; });
    var pts = c.pts, bb = { s: 90, w: 180, n: -90, e: -180 }; pts.forEach(function (p) { bb.s = Math.min(bb.s, p[0]); bb.n = Math.max(bb.n, p[0]); bb.w = Math.min(bb.w, p[1]); bb.e = Math.max(bb.e, p[1]); });
    var plans = paceFor(bb), srcs = {};
    res.forEach(function (r) { r.sources.forEach(function (s) { srcs[s.kind + s.label] = s; }); });
    o.innerHTML = '<div class="cpstrip" role="img" aria-label="Coverage along the route">' + res.map(function (r) { return '<span style="flex:' + Math.max(0.01, r.km_to - r.km_from) + ";background:" + CSTAT[r.status][1] + '" title="km ' + f(r.km_from, 1) + "–" + f(r.km_to, 1) + ": " + CSTAT[r.status][0] + '"></span>'; }).join("") + "</div>" +
      '<div class="cpstripk"><span>0 km</span><span>' + f(total, 1) + " km</span></div>" +
      '<table class="rttab"><tbody>' + ["good", "degraded", "none", "unknown"].map(function (k) { return '<tr><th><span class="cpbadge" style="background:' + CSTAT[k][1] + '">' + CSTAT[k][0] + "</span></th><td>" + f(km[k], 1) + " km (" + f(total ? km[k] / total * 100 : 0, 0) + "%)</td></tr>"; }).join("") + "</tbody></table>" +
      (bad.length ? "<p><b>Stretches that are not good</b></p><ul class=\"cpcrl\">" + bad.slice(0, 30).map(function (s) {
        var p = s.first.id && c.segs.filter(function (x) { return x.id === s.first.id; })[0], at = p ? p.coords[0] : null;
        return '<li><span class="cpbadge" style="background:' + CSTAT[s.status][1] + '">' + CSTAT[s.status][0] + "</span> km " + f(s.km_from, 1) + "–" + f(s.km_to, 1) + (at ? ' from <code>' + E(mgrs(at[0], at[1])) + "</code>" : "") + "<br><small>" + E(s.first.reason) + (s.n > 1 ? " (first segment of " + s.n + ")" : "") + "</small></li>";
      }).join("") + "</ul>" : "<p>Every segment is rated good.</p>") +
      "<p><b>PACE</b>: " + (plans.length ? "your plan" + (plans.length === 1 ? " " : "s ") + plans.map(function (p) { return "<b>" + E(p.name || "Untitled") + "</b>"; }).join(", ") + " cover" + (plans.length === 1 ? "s" : "") + " this route's area. Check the alternates for the stretches above." :
        'no PACE plan covers this route\'s area. <button type="button" class="linkish" data-cpcr="plan">Make one on Plan</button>') + "</p>" +
      '<p class="obs">Sources: ' + Object.keys(srcs).map(function (k) { var s = srcs[k]; return '<span class="cptag">' + E(s.kind.toUpperCase()) + "</span> " + E(s.label) + (s.time ? " (" + E(s.time) + ")" : ""); }).join("; ") + ". " +
      "A planning estimate for phones and data on public networks, not a promise: it cannot see which network you use, outages, jamming, buildings or trees. Radio links are worked out on the Link tab.</p>" +
      '<div class="cpbtns"><button type="button" data-cpcr="zoom">Zoom to the route</button><button type="button" data-cpcr="text">Copy as text</button><button type="button" data-cpcr="clear">Clear</button></div>';
    drawCorr();
  }
  function drawCorr() {
    corrLayerOff();
    var c = S.corr; if (!c || !c.res || !S.ctx || S.tab !== "coverage") return;
    corrLayer = W.L.layerGroup();
    c.res.forEach(function (r, k) {
      var sg = c.segs[k]; if (!sg) return;
      W.L.polyline(sg.coords, { color: CSTAT[r.status][1], weight: 7, opacity: 0.85, dashArray: r.status === "unknown" ? "6 6" : null })
        .bindPopup("<b>" + E(CSTAT[r.status][0]) + "</b> km " + f(r.km_from, 1) + "–" + f(r.km_to, 1) + "<br>" + E(r.reason)).addTo(corrLayer);
    });
    S.ctx.layer.addLayer(corrLayer);
  }
  function corrAct(t) {
    var a = t.getAttribute("data-cpcr"); if (!a) return;
    if (a === "run") corrRun();
    else if (a === "stop") { if (corrAbort) corrAbort.abort(); }
    else if (a === "clear") { if (corrAbort) corrAbort.abort(); S.corr = null; corrLayerOff(); var o = S.ctx.rail.querySelector("#cp-crout"); if (o) o.innerHTML = ""; }
    else if (a === "zoom") { if (S.corr && S.corr.pts) S.ctx.map.fitBounds(W.L.latLngBounds(S.corr.pts).pad(0.15), { maxZoom: 13 }); }
    else if (a === "plan") setTab("plan");
    else if (a === "text" && S.corr && S.corr.res) copyText(["ROUTE COMMS CORRIDOR (" + zT(S.corr.when) + ")"].concat(S.corr.res.map(function (r, k) { var at = S.corr.segs[k].coords[0]; return "km " + f(r.km_from, 1) + "-" + f(r.km_to, 1) + " | " + CSTAT[r.status][0].toUpperCase() + " | " + mgrs(at[0], at[1]) + " | " + r.reason; })).join("\n"));
  }
  function corrInput(t) {
    if (t.id !== "cpcr-seg") return;
    var v = parseFloat(t.value); if (!(v >= 0.5 && v <= 20)) return;
    put(KCR, { seg_km: v });
  }
  /* "Comms along route" on the Route tab opens Comms planning on Coverage and runs the corridor */
  function routeCorridor() { setTab("coverage"); corrRun(); }

  /* ---------- Networks: internet outage signals for the country (IODA, loaded at start as window.ASAP_IODA) ---------- */
  var SRC = { bgp: "Routing (BGP)", "ping-slash24": "Active probing", "merit-nt": "Telescope traffic", gtr: "Google traffic" };
  function renderNetworks() {
    var el = pane(), I = W.ASAP_IODA, cc = S.ctx.cc, o = I && I.items ? I.items[cc === "oki" ? "jp" : cc] : null, name = S.ctx.name || "";
    var h = '<div class="sec cpsec"><h3>Internet outages <span class="cptag">REPORTED</span></h3>';
    if (!I) h += '<p class="cpres" style="border-left:5px solid #6c757d"><b>UNKNOWN</b>: the outage feed has not loaded, so OSAP cannot say whether ' + E(name) + " has an outage.</p>";
    else if (!o) h += '<p class="cpres" style="border-left:5px solid #2b8a3e">No IODA outage signal for ' + E(name) + " since " + E(I.from || "the last week") + " (as of " + E(I.asof || "?") + "). No signal is not proof that every network works.</p>";
    else {
      h += '<p class="cpres" style="border-left:5px solid #c92a2a"><b>' + o.events + " outage signal" + (o.events === 1 ? "" : "s") + "</b> for " + E(name) + " since " + E(I.from || "") + " (as of " + E(I.asof || "?") + ").</p>" +
        '<table class="rttab"><thead><tr><th>Started (UTC)</th><th>Lasted</th><th>Seen by</th><th>Area</th></tr></thead><tbody>' +
        (o.list || []).slice(-12).reverse().map(function (x) { var m = num(x.minutes, 0); return "<tr><td>" + E(String(x.start || "").replace("T", " ")) + "Z</td><td>" + (m >= 120 ? f(m / 60, 1) + " h" : f(m, 0) + " min") + "</td><td>" + E(SRC[x.source] || x.source) + "</td><td>" + E(x.region) + "</td></tr>"; }).join("") + "</tbody></table>";
    }
    h += '<p class="obs">IODA (Georgia Tech) detects drops automatically from routing, active probing and traffic data. A drop can be a power cut, a cable fault or a shutdown; IODA does not say which. <a href="https://ioda.inetintel.cc.gatech.edu/country/' + E((cc === "oki" ? "JP" : String(cc).toUpperCase())) + '" target="_blank" rel="noopener">IODA dashboard</a></p></div>' +
      '<div class="sec cpsec"><h3>Masts, towers and providers <span class="cptag">MAPPED</span> <span class="cptag">OBSERVED</span></h3><p class="obs">Masts come from OpenStreetMap and are incomplete in many places: no mapped mast does not mean no mast. Phone coverage shading is measured speed tests.</p></div>';
    el.innerHTML = h;
  }

  /* ---------- tabs ---------- */
  function render() {
    if (!S.ctx) return;
    var el = pane(), t = S.tab, cm = S.ctx.rail.querySelector("#cp-comms");
    S.ctx.rail.querySelectorAll("[data-cptab]").forEach(function (b) { if (b.closest(".cptabs")) b.setAttribute("aria-selected", String(b.getAttribute("data-cptab") === t)); });
    if (cm) { cm.hidden = !(t === "coverage" || t === "networks"); cm.setAttribute("data-part", t); }
    if (t !== "status") intfLayerOff();
    if (t !== "coverage") corrLayerOff();
    if (el) el.setAttribute("data-tab", t);
    if (t === "plan") renderPlan(); else if (t === "status") renderStatus(); else if (t === "link") renderLink(); else if (t === "equipment") renderEquip(); else if (t === "networks") renderNetworks();
    else { renderCoverage(); drawCorr(); }
  }
  function setTab(t) { if (!TABS.some(function (x) { return x[0] === t; })) t = "coverage"; S.tab = t; try { localStorage.setItem(KT, t); } catch (e) {} render(); }

  function show(ctx) {
    S.ctx = ctx;
    var r = ctx.rail;
    r.innerHTML = '<div class="cp"><div class="cptabs" role="tablist" aria-label="Comms planning">' + TABS.map(function (t) { return '<button type="button" role="tab" data-cptab="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>" +
      '<div id="cp-pane"></div><div id="cp-comms"></div></div>';
    var cm = r.querySelector("#cp-comms");
    W.OSAP_COMMSTAB.show(Object.assign({}, ctx, { rail: cm }));
    r.querySelector(".cp").addEventListener("click", function (e) {
      var tb = e.target.closest("[data-cptab]"); if (tb) { setTab(tb.getAttribute("data-cptab")); return; }
      var b = e.target.closest("button"); if (!b || !e.target.closest("#cp-pane")) return;
      if (S.tab === "plan" && b.hasAttribute("data-cpa")) planAction(b.getAttribute("data-cpa"), b);
      else if (S.tab === "status") statusAct(b);
      else if (S.tab === "equipment") equipClick(b);
      else if (S.tab === "coverage") corrAct(b);
    });
    var onIn = function (e) {
      var t = e.target; if (!t.closest || !t.closest("#cp-pane") || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.type === "input" && t.tagName === "SELECT") return;
      if (S.tab === "plan") { if (t.getAttribute("data-cpa") === "pick") { if (e.type === "change") planAction("pick", t); } else planInput(t); }
      else if (S.tab === "status") { if (e.type === "change" || t.hasAttribute("data-cpsn")) statusAct(t); }
      else if (S.tab === "link") linkInput(t);
      else if (S.tab === "equipment") equipInput(t, e.type);
      else if (S.tab === "coverage") corrInput(t);
    };
    r.querySelector(".cp").addEventListener("input", onIn);
    r.querySelector(".cp").addEventListener("change", function (e) { if (e.target.tagName === "SELECT" || e.target.type === "number") onIn(e); });
    var t0 = null; try { t0 = localStorage.getItem(KT); S.sub = localStorage.getItem(KS) || "board"; } catch (e) {}
    if (!SUBS.some(function (x) { return x[0] === S.sub; })) S.sub = "board";
    try { S.esub = localStorage.getItem(KE) || "power"; } catch (e) { S.esub = "power"; }
    if (!ESUBS.some(function (x) { return x[0] === S.esub; })) S.esub = "power";
    intfLayer = null; corrLayer = null; if (corrAbort) corrAbort.abort(); S.corr = null;
    if (W.OSAP_COMMSPLAN_WANT === "route") { W.OSAP_COMMSPLAN_WANT = null; routeCorridor(); } else setTab(t0 || "coverage");
  }

  /* Other tools (medical plan, evacuation) read the operator's PACE plans for a place: read-only copies of every plan whose
     area covers the point {lat, lon} or overlaps the box {s, w, n, e}. */
  function paceFor(q) {
    var d = loadPace(), Rd = R(); if (!Rd || !q) return [];
    return d.plans.filter(function (p) { return Rd.covers(p.area, q); }).map(function (p) { return JSON.parse(JSON.stringify(p)); });
  }

  var st = D.createElement("style");
  st.textContent =
    /* on Coverage the corridor sits between the phone signal check and its explanation */
    ".cp{display:flex;flex-direction:column}.cp>#cp-pane[data-tab=coverage]{order:2}#cp-comms:not([hidden]){display:contents}#cp-comms>[data-cppart]{order:3}#cp-comms>[data-cppart]:first-child{order:1}" +
    ".cpstrip{display:flex;height:16px;border-radius:3px;overflow:hidden;margin:8px 0 2px;border:1px solid var(--line)}.cpstrip span{min-width:1px}" +
    ".cpstripk{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:6px}.cpcrl{list-style:none;padding:0;margin:4px 0 8px}.cpcrl li{margin:4px 0;font-size:12.5px}.cpcrl .cpbadge{margin:0 4px 0 0}" +
    ".cptabs{display:grid;grid-template-columns:repeat(3,1fr);gap:0 2px;border-bottom:1px solid var(--line)}" +
    ".cptabs button{font:inherit;font-size:12.5px;font-weight:600;border:0;border-bottom:3px solid transparent;background:none;color:var(--muted);padding:9px 8px;min-height:40px;cursor:pointer}" +
    ".cptabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--accent)}" +
    "#cp-comms[data-part=coverage] [data-cppart=networks],#cp-comms[data-part=networks] [data-cppart=coverage]{display:none}" +
    ".cpsec h3{margin:0 0 6px}.cpbtns{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0;font-size:12.5px}" +
    ".cpbtns button,.cparea button{font:inherit;font-size:12.5px;font-weight:600;border:1px solid var(--line);background:var(--surface2,var(--surface));color:var(--ink);border-radius:4px;padding:5px 9px;min-height:32px;cursor:pointer}" +
    ".cpbtns button.cpgo{background:var(--accent);color:var(--on-accent,#fff);border-color:var(--accent)}.cpbtns button.cpdel{color:#c92a2a}" +
    ".cpbtns button[aria-pressed=true]{background:var(--ink);color:var(--surface,#fff)}.cpbtns button[data-cpst=green][aria-pressed=true]{background:#2b8a3e;border-color:#2b8a3e;color:#fff}" +
    ".cpbtns button[data-cpst=amber][aria-pressed=true]{background:#e67700;border-color:#e67700;color:#fff}.cpbtns button[data-cpst=red][aria-pressed=true]{background:#c92a2a;border-color:#c92a2a;color:#fff}" +
    ".cpbtns select,.cprow input,.cprow select,.cpnotes textarea,.cparea input,.cpbtns input,.cpst input{font:inherit;font-size:12.5px;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);max-width:100%;box-sizing:border-box}" +
    ".cprow{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 10px;margin:6px 0;font-size:12px}.cprow label,.cpw{display:flex;flex-direction:column;gap:2px;color:var(--muted);font-size:11.5px}" +
    ".cprow label input,.cprow label select{width:100%;color:var(--ink)}.cprow .cpw{grid-column:1/-1}.cpnotes{margin:6px 0}.cpnotes textarea{width:100%;resize:vertical}" +
    ".cpduo{display:flex;gap:4px}.cpduo select{flex:1;min-width:0}.cpu{display:flex;align-items:center;gap:4px;color:var(--ink)}.cpu input{width:80px}" +
    ".cparea{font-size:12.5px;margin:6px 0}.cparea input{width:70px}" +
    "fieldset.cpp{border:1px solid var(--line);border-radius:6px;margin:8px 0;padding:4px 8px}fieldset.cpp legend{font-size:12.5px;font-weight:700;padding:0 4px}" +
    ".cpl{display:inline-block;min-width:18px;text-align:center;border-radius:3px;background:var(--ink);color:var(--surface,#fff);font:700 11px/18px 'IBM Plex Mono',monospace}" +
    ".cppP .cpl{background:#1864ab}.cppA .cpl{background:#2b8a3e}.cppC .cpl{background:#e67700}.cppE .cpl{background:#c92a2a}" +
    "details.cpph>summary{cursor:pointer;font-size:13px;padding:2px 0}" +
    ".cpst{padding-left:10px}.cpsth{font-size:13px}.cpbadge{display:inline-block;color:#fff;font:700 10.5px/16px system-ui,sans-serif;padding:0 6px;border-radius:3px;margin-left:4px}" +
    ".cpwarn{border-left:5px solid #c92a2a;padding-left:10px;font-size:13px}.cpres{padding:6px 8px;margin:6px 0;font-size:13px;background:var(--surface2,transparent)}.cpbad{color:#c92a2a}" +
    ".cptag{display:inline-block;font:700 9.5px/15px system-ui,sans-serif;letter-spacing:.04em;border:1px solid var(--line);border-radius:3px;padding:0 4px;color:var(--muted);vertical-align:2px}" +
    ".cpdv{border:1px solid var(--line);border-radius:6px;padding:4px 6px;margin:6px 0}.cpdvh{display:flex;gap:4px;align-items:center}.cpdvh input{flex:1;min-width:0;font-weight:600}" +
    ".cpdvf{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px}.cpdvf label{display:flex;flex-direction:column;gap:1px;color:var(--muted);font-size:11px}" +
    ".cpdv input{font:inherit;font-size:12.5px;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);box-sizing:border-box}" +
    ".cpx{font:inherit;font-size:16px;border:0;background:none;color:var(--muted);cursor:pointer;min-width:28px;min-height:28px}" +
    "#cp-print{display:none}@media print{html.cpprinting body>*:not(#cp-print){display:none!important}html.cpprinting #cp-print{display:block!important;font:10pt/1.35 system-ui,sans-serif;color:#000;background:#fff}" +
    "html.cpprinting #cp-print h1{font-size:15pt;margin:0 0 4px}html.cpprinting #cp-print h2{font-size:12pt;margin:12px 0 4px}html.cpprinting #cp-print table{border-collapse:collapse;width:100%}" +
    "html.cpprinting #cp-print td,html.cpprinting #cp-print th{border-bottom:1px solid #ccc;padding:2px 6px 2px 0;text-align:left;vertical-align:top}}" +
    ".cpsub{display:flex;flex-wrap:wrap;gap:4px;padding:8px 0 2px}.cpsub button{font:inherit;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--surface2,var(--surface));color:var(--ink);border-radius:14px;padding:4px 10px;min-height:32px;cursor:pointer}" +
    ".cpsub button[aria-pressed=true]{background:var(--ink);color:var(--surface,#fff)}table.cplog td{font-family:system-ui,sans-serif;font-size:12px}table.cplog small{color:var(--muted)}" +
    "tr.cpdis td{color:#c92a2a}.cpant p{font-size:13px;line-height:1.45;margin:6px 0 0}" +
    ".cpchk{display:flex;align-items:center;gap:6px;grid-column:1/-1;font-size:12.5px;color:var(--ink)}ol.cpfixs{margin:6px 0;padding-left:20px;font-size:12.5px}ol.cpfixs li.cur{font-weight:700}ul.cpfixl{margin:4px 0;padding-left:18px;font-size:13px;line-height:1.5}" +
    "@media (pointer:coarse){.cp input,.cp select,.cp textarea{font-size:16px!important}}";
  D.head.appendChild(st);

  W.OSAP_COMMSPLAN = { version: "osap-commsplan/1", show: show, paceFor: paceFor, corridor: corridor, routeCorridor: function () { if (S.ctx) routeCorridor(); }, tab: function (t) { setTab(t); }, state: function () { return { tab: S.tab, pace: loadPace(), power: loadPower(), link: linkIn() }; } };
  if (W.OSAP_COMMS_WAIT && D.documentElement.getAttribute("data-view") === "comms") W.OSAP_COMMS_WAIT();
})();
