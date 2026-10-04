/* AXIOM OSAP Comms planning (Shane 2026-10-03: a communications planning module for a radio operator, "planning, terrain,
   network status, sustainment and troubleshooting rather than just showing towers on a map"). Window.OSAP_COMMSPLAN.
   The Comms view (Map overlays > Infrastructure > Communications) opens as six tabs:
     Plan       PACE planner: Primary / Alternate / Contingency / Emergency per phase, with device, net, coverage expectation
                and its basis, dependencies, failure trigger and next action
     Coverage   the phone signal check (assets/osap-comms.js); the terrain coverage estimate joins it with the terrain engine
     Link       a free-space link budget, Fresnel zone and radio horizon calculator; the terrain profile joins it later
     Networks   country internet outage signals (IODA, already loaded for Security signals), and the masts, towers and
                providers switches of assets/osap-comms.js
     Equipment  battery and power planner
     Status     network status board for the plan's current phase (GREEN / AMBER / RED / UNKNOWN, last check, note)
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
  function renderPower() {
    var el = pane(), p = loadPower(), Rd = R();
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
    if (rer) renderPower(); else powerOut();
  }

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
    if (t === "plan") renderPlan(); else if (t === "status") renderStatus(); else if (t === "link") renderLink(); else if (t === "equipment") renderPower(); else if (t === "networks") renderNetworks();
    else el.innerHTML = "";
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
      else if (S.tab === "equipment" && b.hasAttribute("data-cpa")) powerAct(b, "click");
    });
    var onIn = function (e) {
      var t = e.target; if (!t.closest || !t.closest("#cp-pane") || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.type === "input" && t.tagName === "SELECT") return;
      if (S.tab === "plan") { if (t.getAttribute("data-cpa") === "pick") { if (e.type === "change") planAction("pick", t); } else planInput(t); }
      else if (S.tab === "status") { if (e.type === "change" || t.hasAttribute("data-cpsn")) statusAct(t); }
      else if (S.tab === "link") linkInput(t);
      else if (S.tab === "equipment") { if (e.type === "change" || t.tagName !== "SELECT") powerAct(t, e.type); }
    };
    r.querySelector(".cp").addEventListener("input", onIn);
    r.querySelector(".cp").addEventListener("change", function (e) { if (e.target.tagName === "SELECT" || e.target.type === "number") onIn(e); });
    var t0 = null; try { t0 = localStorage.getItem(KT); S.sub = localStorage.getItem(KS) || "board"; } catch (e) {}
    if (!SUBS.some(function (x) { return x[0] === S.sub; })) S.sub = "board";
    intfLayer = null;
    setTab(t0 || "coverage");
  }

  /* Other tools (medical plan, evacuation) read the operator's PACE plans for a place: read-only copies of every plan whose
     area covers the point {lat, lon} or overlaps the box {s, w, n, e}. */
  function paceFor(q) {
    var d = loadPace(), Rd = R(); if (!Rd || !q) return [];
    return d.plans.filter(function (p) { return Rd.covers(p.area, q); }).map(function (p) { return JSON.parse(JSON.stringify(p)); });
  }

  var st = D.createElement("style");
  st.textContent =
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
    ".cpchk{display:flex;align-items:center;gap:6px;grid-column:1/-1;font-size:12.5px;color:var(--ink)}ol.cpfixs{margin:6px 0;padding-left:20px;font-size:12.5px}ol.cpfixs li.cur{font-weight:700}ul.cpfixl{margin:4px 0;padding-left:18px;font-size:13px;line-height:1.5}" +
    "@media (pointer:coarse){.cp input,.cp select,.cp textarea{font-size:16px!important}}";
  D.head.appendChild(st);

  W.OSAP_COMMSPLAN = { version: "osap-commsplan/1", show: show, paceFor: paceFor, tab: function (t) { setTab(t); }, state: function () { return { tab: S.tab, pace: loadPace(), power: loadPower(), link: linkIn() }; } };
  if (W.OSAP_COMMS_WAIT && D.documentElement.getAttribute("data-view") === "comms") W.OSAP_COMMS_WAIT();
})();
