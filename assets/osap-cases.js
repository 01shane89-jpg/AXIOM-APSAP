/* AXIOM OSAP: team shared cases, on the page (Shane 2026-10-23 picked "Server-checked, sealed cases"; thread "Team shared cases").
   A case is a workspace shared by OSAP account, with a role per person: Lead (invites, removes, changes roles), Analyst (adds and
   changes items) or Viewer (reads only). OSAP's server checks every request against the case's members and roles
   (netlify/functions/osap-cases.mjs, tools/cases.mjs) and keeps the case content sealed (tools/case_vault.mjs). It cannot read it.
   - This device: an ECDH P-256 key pair made once (private key not extractable, IndexedDB "osap-cases"); its public key is
     registered on the account. Sealing is assets/osap-case-crypto.js.
   - The case key: a lead's device makes it, wraps it for every member device and hands the wrapped copies to the server. When a
     member is removed the server moves the case to a new epoch; the next lead to open the case makes a new key for the members
     left, so content saved after that is sealed under a key the removed person never had.
   - The items: the same shared stores, units, per-item merge and "who added it" stamp as the Team workspace (assets/osap-team.js
     engine, assets/osap-sync.js core), in 24 sealed buckets of about 2 MB together. A bucket this device cannot open (sealed
     under a key it was never given) is never written over.
   - Only on the Netlify site, signed in: cases need accounts. Creating a case needs the Full plan; joining needs an invite to the
     account's confirmed email. A workspace is either a team-link workspace or a case, never both.
   - Nothing here approves anything: items are the analysts' own work. Lead approval of analyst work is milestone 3.
   window.OSAP_CASES {open, list, syncNow, caseOf, wsHtml, tag}. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(W.location.search)) return;
  var API = "api/osap-cases", CFG = "osap-cases", DEVF = "osap-case-dev", CALL_MAX = 24, NAME_MAX = 60;
  var ROLE = { lead: "Lead", analyst: "Analyst", viewer: "Viewer" };
  var C, E, CC;
  function ready() { C = W.OSAP_SYNC_CORE; E = W.OSAP_TEAM && W.OSAP_TEAM.engine; CC = W.OSAP_CASE_CRYPTO; return !!(C && E && CC && W.crypto && W.crypto.subtle && W.indexedDB); }
  function T() { return W.OSAP_TIER; }
  /* cases need an account: only on the Netlify site, signed in */
  function on() { var t = T(); return !!(t && t.on && t.on() && t.signedIn && t.signedIn()) && ready(); }
  function allowed() { var t = T(); if (!t || !t.on || !t.on()) return false; if (t.owner && t.owner()) return true; return !!(t.allows && t.allows((t.need && t.need("team")) || "full")); }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function json(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function ago(ms) { var s = (Date.now() - ms) / 1000; return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; }
  function when(iso) { var ms = Date.parse(iso || ""); return !isFinite(ms) ? "" : W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function hex(n) { var u = new Uint8Array(n); W.crypto.getRandomValues(u); return Array.prototype.map.call(u, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
  function opId() { return "op-" + Date.now().toString(36) + "-" + hex(8); }
  function cleanCall(s) { var c = String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim(); return /@/.test(c) ? "" : c.slice(0, CALL_MAX).trim(); }

  /* ---------- the service ---------- */
  function api(body, query) {
    var t = T(), tok = t && t.token ? t.token() : Promise.resolve(null);
    return tok.then(function (a) {
      if (!a) throw Object.assign(new Error("Sign in again first."), { status: 401 });
      var h = { authorization: "Bearer " + a }; if (body) h["content-type"] = "application/json";
      return fetch(API + (query || ""), body ? { method: "POST", headers: h, body: JSON.stringify(body), cache: "no-store" } : { headers: h, cache: "no-store" });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || "The cases service did not answer (" + r.status + ")."), { status: r.status }); return j; });
    }, function (e) { if (e && e.status) throw e; throw new Error("Could not reach the cases service. Check your connection; OSAP will try again."); });
  }
  function cmd(c, body) { return api(Object.assign({ cmd: c, op: opId() }, body || {})); }

  /* ---------- this device's key pair, IndexedDB "osap-cases" ---------- */
  function db() {
    return new Promise(function (res, rej) {
      var r = W.indexedDB.open("osap-cases", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function kv(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction("kv", mode), out = fn(t.objectStore("kv"));
        t.oncomplete = function () { d.close(); res(out && "result" in out ? out.result : out); };
        t.onerror = t.onabort = function () { d.close(); rej(t.error || new Error("storage refused")); };
      });
    });
  }
  var devP = null;
  function device() {
    if (devP) return devP;
    devP = kv("readonly", function (s) { return s.get("dev"); }).then(function (d) {
      if (d && /^[0-9a-f]{32}$/.test(d.id || "") && d.pair && d.pub) return d;
      return CC.newDevice().then(function (pair) {
        return CC.pubOf(pair).then(function (pub) { var n = { id: hex(16), pair: pair, pub: pub }; return kv("readwrite", function (s) { s.put(n, "dev"); }).then(function () { return n; }); });
      });
    }).then(function (d) {
      if (raw(DEVF) === d.id) return d;
      return cmd("device", { device: { id: d.id, pub: d.pub } }).then(function () { put(DEVF, d.id); return d; });
    });
    devP.then(null, function () { devP = null; });
    return devP;
  }
  function loadState(id) { return kv("readonly", function (s) { return s.get("st/" + id); }).then(function (x) { return x && x.id === id ? x : { id: id, M: {}, O: {}, first: true }; }); }
  function saveState(x) { return kv("readwrite", function (s) { s.put(x, "st/" + x.id); }); }
  function dropState(id) { return kv("readwrite", function (s) { s.delete("st/" + id); }).then(null, function () {}); }

  /* ---------- which workspace on this device holds which case: localStorage "osap-cases" ---------- */
  function cfg() { var c = json(raw(CFG), null); if (!c || typeof c.bind !== "object" || !c.bind) c = { v: 1, bind: {} }; return c; }
  function saveCfg(c) { return put(CFG, JSON.stringify(c)); }
  function bound(id) { return cfg().bind[id] || null; }
  function bind(id, ws, extra) { var c = cfg(); c.bind[id] = Object.assign({ ws: ws, since: Date.now() }, extra || {}); return saveCfg(c); }
  function unbind(id) { var c = cfg(); delete c.bind[id]; saveCfg(c); }
  function caseOf(ws) { var c = cfg().bind; for (var id in c) if (c[id] && c[id].ws === ws) return id; return null; }
  function reg() { var r = json(raw("osap-ws"), null); return r && Array.isArray(r.list) ? r : null; }
  function wsExists(ws) { var r = reg(); return !!(r && r.list.some(function (w) { return w.id === ws; })); }

  /* ---------- one case's sync ---------- */
  var LAST = {}, VIEW = {}, busy = {}, sigs = {}, MINE = null;
  function syncCase(id) {
    if (busy[id]) return busy[id];
    if (!bound(id) || !on()) return Promise.resolve(null);
    busy[id] = runSync(id, 0).then(function (x) { delete busy[id]; render(); return x; }, function (e) {
      delete busy[id];
      if (e && e.status === 404) { LAST[id] = { at: Date.now(), ok: false, gone: true, msg: "You are no longer a member of this case. What you had stays in the workspace on this device." }; }
      else LAST[id] = Object.assign({}, LAST[id] || {}, { at: Date.now(), ok: false, msg: "Case sync failed: " + String(e && e.message || e).slice(0, 160) });
      render(); return LAST[id];
    });
    render();
    return busy[id];
  }
  function runSync(id, tries) {
    var b = bound(id), dev, K, view, data, st, keys = {}, now = Date.now(), R = {}, fetched = {}, unread = 0;
    return device().then(function (d) {
      dev = d;
      return Promise.all([api(null, "?case=" + encodeURIComponent(id) + "&keys=" + d.id), api(null, "?case=" + encodeURIComponent(id) + "&data=1"), api(null, "?case=" + encodeURIComponent(id)), loadState(id)]);
    }).then(function (x) {
      K = x[0]; data = x[1]; view = x[2].case; st = x[3]; VIEW[id] = view;
      /* every case key this device was given, by epoch */
      return Promise.all(K.wraps.map(function (w) {
        return CC.unwrap(w.wrap, dev.pair.privateKey, id, w.epoch, dev.id).then(function (k) { keys[w.epoch] = k; }, function () {});
      }));
    }).then(function () {
      /* a lead hands the current key to member devices still waiting; a new epoch's key is made here if no device has it yet */
      if (K.role !== "lead" || !K.need || !K.need.length) return;
      if (!keys[K.epoch] && K.keyed) return;
      if (!keys[K.epoch]) keys[K.epoch] = CC.newCaseKey();
      return Promise.all(K.need.map(function (n) { return CC.wrap(keys[K.epoch], n.pub, id, K.epoch, n.device).then(function (w) { return { device: n.device, wrap: w }; }); }))
        .then(function (wraps) { return api({ cmd: "wrap", case: id, epoch: K.epoch, wraps: wraps.slice(0, 60) }); });
    }).then(function () {
      return Promise.all(data.buckets.map(function (bk) {
        fetched[bk.bucket] = { rev: bk.rev, epoch: bk.epoch, h: null };
        if (!keys[bk.epoch]) { unread++; return; }
        return CC.open(keys[bk.epoch], id, bk.epoch, bk.bucket, bk.data).then(function (p) {
          if (!p || p.type !== "bucket" || typeof p.u !== "object") { unread++; return; }
          fetched[bk.bucket].h = C.fp(C.canon(p.u || {}));
          var S = E.okUnits(C.trusted(C.fromBucket(p.u)), E.synced);
          Object.keys(S).forEach(function (uk) { if (C.newer(S[uk], R[uk])) R[uk] = S[uk]; });
        }, function () { unread++; });
      }));
    }).then(function () {
      if (!wsExists(b.ws)) { LAST[id] = { at: now, ok: false, gone: true, msg: "The workspace for this case was deleted on this device." }; return LAST[id]; }
      var me = (view.members || []).filter(function (m) { return m.me; })[0] || {}, writer = K.role === "lead" || K.role === "analyst";
      var S0 = E.storesOf(b.ws) || {}, sh = {}; Object.keys(S0).forEach(function (k) { sh[k] = E.shareText(k, S0[k]); });
      var L = C.unitsOf([{ id: "T", name: view.name, created: 0 }], function () { return sh; }, E.synced);
      if (writer) E.stampBy(L, C.merge([st.M, R], now), me.call || "", now);
      var S = C.stamp(L, st.O, st.M, now, st.first && !b.creator), M = C.merge([st.M, S, R], now);
      var ch = writer || Object.keys(R).length ? E.writeTeam({ ws: b.ws }, M) : { live: 0, other: 0 };
      st.M = M; st.first = false; st.O = {};
      var Sb = E.storesOf(b.ws, true) || {}, shb = {}; Object.keys(Sb).forEach(function (k) { shb[k] = E.shareText(k, Sb[k]); });
      var Lb = C.unitsOf([{ id: "T", name: view.name, created: 0 }], function () { return shb; }, E.synced);
      Object.keys(S).forEach(function (uk) { if (!S[uk].d && uk in Lb) st.O[uk] = { t: S[uk].t, h: C.fp(C.canon(Lb[uk])) }; });
      var B = C.buckets(M, E.NBT), ep = K.epoch, key = keys[ep], size = 0;
      var send = (!writer || !key) ? Promise.resolve([]) : Promise.all(B.map(function (u, i) {
        var f = fetched[i];
        if (f && f.h == null) return null; // sealed under a key this device lacks: never written over
        if (f && f.h === C.fp(C.canon(u)) && f.epoch === ep) { size += 0; return null; }
        if (!f && !Object.keys(u).length) return null;
        return CC.seal(key, id, ep, i, { type: "bucket", v: 1, u: u }).then(function (s) { return { bucket: i, epoch: ep, rev: f ? f.rev : 0, data: s }; });
      })).then(function (a) { return a.filter(Boolean); });
      return send.then(function (out) {
        if (!out.length) return null;
        out.forEach(function (o) { size += o.data.length; });
        return api({ cmd: "put", case: id, buckets: out });
      }).then(function (saved) {
        return saveState(st).then(function () {
          var total = 0; data.buckets.forEach(function (bk) { total += (bk.data || "").length; });
          LAST[id] = { at: Date.now(), ok: true, role: K.role, epoch: ep, keyless: !key, unread: unread, sent: saved && saved.saved ? saved.saved.length : 0, size: total, changes: ch, msg: "" };
          sigs[id] = E.wsSig(b.ws);
          var c2 = cfg(); if (c2.bind[id]) { c2.bind[id].last = LAST[id].at; c2.bind[id].name = view.name; c2.bind[id].role = K.role; saveCfg(c2); }
          if (ch.live) E.bar(ch.live);
          else if (ch.other) toast("Case " + view.name + ": " + ch.other + " change" + (ch.other > 1 ? "s" : "") + " brought in");
          return LAST[id];
        });
      }, function (e) {
        /* someone saved the case a moment ago: read it again and merge, once */
        if (e && e.status === 409 && tries < 2) return saveState(st).then(function () { return runSync(id, tries + 1); });
        throw e;
      });
    });
  }

  /* ---------- making, joining, leaving ---------- */
  function refreshMine() { return api().then(function (j) { MINE = j; render(); return j; }); }
  function create(ws, name, call) {
    if (!allowed()) return Promise.reject(new Error("Team cases need the Full plan."));
    if (W.OSAP_TEAM && W.OSAP_TEAM.teamOf && W.OSAP_TEAM.teamOf(ws)) return Promise.reject(new Error("This workspace is shared by team link. Use another workspace for a case."));
    if (caseOf(ws)) return Promise.reject(new Error("This workspace is already a case."));
    return device().then(function () { return cmd("create", { name: name, call: call }); }).then(function (j) {
      bind(j.case.id, ws, { creator: true, name: j.case.name, role: "lead" });
      return syncCase(j.case.id).then(function () { refreshMine(); start(); return j.case; });
    });
  }
  function accept(id, name, call) {
    return device().then(function () { return cmd("accept", { case: id, call: call }); }).then(function (j) {
      var w = W.OSAP_WS && W.OSAP_WS.create ? W.OSAP_WS.create(name || "Case") : null;
      if (!w) throw new Error("A workspace for the case could not be made on this device.");
      bind(id, w.id, { name: j.case.name, role: j.case.role });
      return syncCase(id).then(function () { refreshMine(); start(); return j.case; });
    });
  }
  /* a case this account is in but this device does not hold yet: a new workspace for it */
  function openHere(id, name) {
    var w = W.OSAP_WS && W.OSAP_WS.create ? W.OSAP_WS.create(name || "Case") : null;
    if (!w) return Promise.reject(new Error("A workspace for the case could not be made on this device."));
    bind(id, w.id, { name: name });
    return syncCase(id).then(function () { start(); });
  }
  function forget(id) { unbind(id); delete LAST[id]; delete VIEW[id]; return dropState(id); }

  /* ---------- when to sync: on open, on a change in a case's workspace, and every minute while the page is shown ---------- */
  var timer = null, poll = null, chain = Promise.resolve();
  function active() { return Object.keys(cfg().bind).filter(function (id) { return !(LAST[id] && LAST[id].gone); }); }
  function syncAll() { active().forEach(function (id) { chain = chain.then(function () { return syncCase(id); }).then(null, function () {}); }); return chain; }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(syncAll, ms); }
  function start() {
    if (poll || !active().length || !on()) return;
    soon(3000);
    poll = setInterval(function () {
      if (D.visibilityState !== "visible") return;
      var due = active().some(function (id) { var b = bound(id); return b && !busy[id] && (E.wsSig(b.ws) !== sigs[id] || Date.now() - ((LAST[id] && LAST[id].at) || 0) > 60000); });
      if (due) soon(1500);
    }, 10000);
  }
  D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible" && poll) soon(1000); });

  /* ---------- the case panel ---------- */
  var box = D.createElement("div"); box.id = "casedlg"; box.hidden = true;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "case-h");
  var UI = { view: "", id: "", ws: "", msg: "", ok: "", log: null };
  function openP(view, arg) {
    if (!box.parentNode) D.body.appendChild(box);
    UI.view = view || "list"; UI.msg = ""; UI.ok = ""; UI.id = ""; UI.ws = ""; UI.log = null;
    if (view === "case" || view === "invite") UI.id = arg; else if (view === "new") UI.ws = arg;
    box.hidden = false; render();
    var f = box.querySelector("input,.x"); if (f && f.focus) f.focus();
    if (on()) refreshMine().then(null, function (e) { say(e.message); });
    if (view === "case" && bound(arg) && !busy[arg] && Date.now() - ((LAST[arg] && LAST[arg].at) || 0) > 15000) syncCase(arg);
  }
  function closeP() { box.hidden = true; box.innerHTML = ""; UI.view = ""; var ws = D.getElementById("wsdlg"); if (ws && !ws.hidden && W.OSAP_WS) W.OSAP_WS.open(); }
  function stateTxt(id) {
    var L = LAST[id], b = bound(id);
    if (busy[id]) return "Syncing…";
    if (!L) return b && b.last ? "Last synced " + ago(b.last) + "." : "Waiting to sync…";
    if (!L.ok) return L.msg;
    return "Synced " + ago(L.at) + "." + (L.keyless ? " Waiting for a lead to hand this device the case key." : "") + (L.unread ? " " + L.unread + " part" + (L.unread > 1 ? "s" : "") + " sealed under a key this device was never given." : "");
  }
  var ACT = { create: "made the case", rename: "renamed the case", invite: "invited someone", uninvite: "cancelled an invite", accept: "joined", decline: "declined an invite", call: "set a call sign", role: "changed a role", remove: "removed a member", leave: "left the case" };
  function logLine(d, calls) {
    var who = calls[d.actor] || "a former member", what = ACT[d.action] || d.action, det = d.detail || {};
    if (d.action === "role") what += " (" + (calls[d.target.id] || "someone") + ": " + (ROLE[det.from] || det.from) + " to " + (ROLE[det.to] || det.to) + ")";
    else if (d.action === "invite") what += " as " + (ROLE[det.role] || det.role);
    else if (d.action === "remove") what += " (" + (calls[d.target.id] || "a former member") + ")";
    return "<li><span><b>" + esc(who) + "</b> " + esc(what) + (d.reason ? ': "' + esc(d.reason) + '"' : "") + '<i class="obs">' + esc(when(d.at)) + " · version " + esc(d.version) + "</i></span></li>";
  }
  function callInput(v) { return '<label class="mvf">Your call sign<input data-cs-call maxlength="' + CALL_MAX + '" autocomplete="off" spellcheck="false" placeholder="e.g. RAVEN 2" value="' + esc(v || raw("osap-team-call") || "") + '"></label><p class="obs">Shown to the case\'s members and beside the items you add. Not your email.</p>'; }
  function render() {
    if (box.hidden) return;
    var typed = {};
    ["data-cs-name", "data-cs-call", "data-cs-email", "data-cs-reason"].forEach(function (a) { var i = box.querySelector("[" + a + "]"); if (i && box.getAttribute("data-v") === UI.view + UI.id) typed[a] = i.value; });
    var h = "", title = "Team cases";
    if (!on()) h = '<p class="obs">Team cases need an OSAP account: sign in on the OSAP site to use them.</p>';
    else if (UI.view === "new") {
      title = "Share as a team case";
      var wn = E.wsName(UI.ws);
      h = !allowed() ? '<p class="mvwarn">Team cases need the Full plan.</p>' :
        "<p>Make the workspace <b>" + esc(wn) + "</b> a team case. You are its lead: you invite people by their OSAP account email and give each a role.</p>" +
        '<label class="mvf">Case name<input data-cs-name maxlength="' + NAME_MAX + '" autocomplete="off" value="' + esc(wn) + '"></label>' + callInput() +
        '<div class="mvbtns"><button type="button" class="refresh" data-cs-make>Create case</button><button type="button" data-cs-cancel>Cancel</button></div>';
    } else if (UI.view === "invite") {
      var inv = MINE && (MINE.invites || []).filter(function (x) { return x.id === UI.id; })[0];
      title = "Join a case";
      h = !inv ? '<p class="obs">Checking the invite…</p>' :
        "<p>You are invited to the case <b>" + esc(inv.name) + "</b> as <b>" + esc(ROLE[inv.role] || inv.role) + "</b>.</p>" + callInput() +
        '<p class="obs">Joining makes a new workspace "' + esc(inv.name) + '" on this device for the case\'s items.</p>' +
        '<div class="mvbtns"><button type="button" class="refresh" data-cs-accept>Join case</button><button type="button" data-cs-decline>Decline</button><button type="button" data-cs-cancel>Not now</button></div>';
    } else if (UI.view === "case" && UI.id) {
      var v = VIEW[UI.id], b = bound(UI.id), lead = v && v.role === "lead";
      title = "Case: " + ((v && v.name) || (b && b.name) || "");
      h = '<p class="mvmsg" role="status">' + esc(stateTxt(UI.id)) + "</p>";
      if (v) {
        var calls = {}; v.members.forEach(function (m) { calls[m.uid] = m.call || "(no call sign)"; });
        h += '<p class="mvok">Your role: <b>' + esc(ROLE[v.role]) + "</b>" + (b ? " · workspace <b>" + esc(E.wsName(b.ws) || "deleted") + "</b>" : "") + "</p>" +
          (v.role === "viewer" ? '<p class="obs">Viewers can read the case. Changes you make in this workspace stay on this device.</p>' : "") +
          '<div class="mvbtns"><button type="button" class="refresh" data-cs-now' + (busy[UI.id] ? " disabled" : "") + ">Sync now</button>" + (b && reg() && reg().active !== b.ws ? '<button type="button" data-cs-sw>Open the case workspace</button>' : "") + "</div>" +
          "<h3>Members</h3><ul>" + v.members.map(function (m) {
            return "<li><span><b>" + esc(m.call || "(no call sign)") + "</b>" + (m.me ? " (you)" : "") + '<i class="obs">' + esc(ROLE[m.role]) + (m.email ? " · " + esc(m.email) : "") + "</i></span>" +
              (lead && !m.me ? '<select data-cs-role="' + esc(m.uid) + '" aria-label="Role">' + ["lead", "analyst", "viewer"].map(function (r) { return '<option value="' + r + '"' + (r === m.role ? " selected" : "") + ">" + ROLE[r] + "</option>"; }).join("") + '</select><button type="button" data-cs-remove="' + esc(m.uid) + '">Remove</button>' : "") + "</li>";
          }).join("") + "</ul>" +
          (lead ? "<h3>Invite</h3>" + (v.invites && v.invites.length ? '<ul>' + v.invites.map(function (i) { return "<li><span>" + esc(i.email) + '<i class="obs">' + esc(ROLE[i.role]) + " · invited " + esc(when(i.at)) + '</i></span><button type="button" data-cs-uninvite="' + esc(i.email) + '">Cancel</button></li>'; }).join("") + "</ul>" : "") +
            '<label class="mvf">OSAP account email<input data-cs-email type="email" autocomplete="off" spellcheck="false"></label>' +
            '<div class="mvbtns"><select data-cs-irole aria-label="Role"><option value="analyst">Analyst</option><option value="viewer">Viewer</option><option value="lead">Lead</option></select><button type="button" class="refresh" data-cs-invite>Invite</button></div>' +
            '<p class="obs">They see the invite when they sign in to OSAP with that email (it must be confirmed). Removing someone takes effect at once, and new items are sealed under a new key they never get.</p>' : "") +
          '<label class="mvf">Reason (kept in the case record, optional)<input data-cs-reason maxlength="300" autocomplete="off"></label>' +
          "<h3>Your call sign</h3><div class=\"tmlink\"><input data-cs-call maxlength=\"" + CALL_MAX + '" value="' + esc(calls[(v.members.filter(function (m) { return m.me; })[0] || {}).uid] || "") + '"><button type="button" data-cs-setcall>Save</button></div>' +
          "<h3>Case record</h3>" + (UI.log ? "<ul>" + UI.log.map(function (d) { return logLine(d, calls); }).join("") + "</ul>" : '<div class="mvbtns"><button type="button" data-cs-log>Show who did what</button></div>');
      }
      h += '<p><button type="button" class="mvlink" data-cs-leave>Leave this case</button> · <button type="button" class="mvlink" data-cs-forget>Stop syncing it on this device</button></p>';
    } else {
      var mine = MINE || { cases: [], invites: [] }, here = cfg().bind;
      h = (mine.invites.length ? "<h3>Invites</h3><ul>" + mine.invites.map(function (i) { return "<li><span><b>" + esc(i.name) + '</b><i class="obs">as ' + esc(ROLE[i.role]) + '</i></span><button type="button" class="refresh" data-cs-inv="' + esc(i.id) + '">Open</button></li>'; }).join("") + "</ul>" : "") +
        "<h3>Your cases</h3>" + (mine.cases.length ? "<ul>" + mine.cases.map(function (c) {
          return "<li><span><b>" + esc(c.name) + '</b><i class="obs">' + esc(ROLE[c.role]) + " · " + esc(c.members) + " member" + (c.members > 1 ? "s" : "") + (here[c.id] ? " · " + esc(stateTxt(c.id)) : " · not on this device") + "</i></span>" +
            (here[c.id] ? '<button type="button" data-cs-open="' + esc(c.id) + '">Open</button>' : '<button type="button" data-cs-here="' + esc(c.id) + '" data-cs-hname="' + esc(c.name) + '">Open on this device</button>') + "</li>";
        }).join("") + "</ul>" : '<p class="obs">' + (MINE ? "No cases yet. Share a workspace as a team case from My work &gt; Workspaces." : "Loading…") + "</p>");
    }
    box.innerHTML = '<div class="cbox"><div class="chead"><h2 id="case-h">' + esc(title) + '</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      (UI.msg ? '<p class="mvwarn" role="alert">' + esc(UI.msg) + "</p>" : "") + (UI.ok ? '<p class="mvok" role="status">' + esc(UI.ok) + "</p>" : "") + h +
      '<details class="mvnote"><summary>How a team case is kept private</summary>' +
      "<p>OSAP's server checks every request against the case's members and roles. Anyone not in the case gets the same answer as for a case that does not exist. Every change to members and roles is kept in the case record with who made it, why and when.</p>" +
      "<p>The case's items are sealed with AES-256-GCM on members' devices. The case key is handed from a lead's device to each member's device, locked to that device's own key, so OSAP's server stores only sealed data it cannot open. Photos and the hidden areas are never shared. Items are the members' own work: nothing is approved or graded by OSAP.</p></details></div>";
    box.setAttribute("data-v", UI.view + UI.id);
    Object.keys(typed).forEach(function (a) { var i = box.querySelector("[" + a + "]"); if (i) i.value = typed[a]; });
  }
  function say(t) { UI.msg = t; UI.ok = ""; render(); }
  function fail(e) { say(String(e && e.message || e).slice(0, 200)); }
  function val(sel) { var i = box.querySelector(sel); return i ? i.value : ""; }
  function reason() { return val("[data-cs-reason]"); }
  function afterChange(j, ok) { if (j && j.case) VIEW[UI.id] = j.case; UI.log = null; UI.ok = ok; UI.msg = ""; render(); refreshMine(); }
  D.addEventListener("click", function (e) {
    var t = e.target, b = t.closest ? t.closest("[data-cs-share],[data-cs-case],[data-cs-list]") : null;
    if (b) {
      if (b.hasAttribute("data-cs-share")) openP("new", b.getAttribute("data-cs-share"));
      else if (b.hasAttribute("data-cs-case")) openP("case", b.getAttribute("data-cs-case"));
      else openP("list");
      return;
    }
    if (!box.contains(t)) return;
    if (t === box || t.closest(".x") || t.closest("[data-cs-cancel]")) { closeP(); return; }
    if ((b = t.closest("[data-cs-open]"))) { openP("case", b.getAttribute("data-cs-open")); return; }
    if ((b = t.closest("[data-cs-inv]"))) { openP("invite", b.getAttribute("data-cs-inv")); return; }
    if ((b = t.closest("[data-cs-here]"))) { var hid = b.getAttribute("data-cs-here"); UI.ok = "Opening the case on this device…"; render(); openHere(hid, b.getAttribute("data-cs-hname")).then(function () { openP("case", hid); }, fail); return; }
    if (t.closest("[data-cs-make]")) {
      var call = cleanCall(val("[data-cs-call]")); if (!call) { say("Type a call sign (up to 24 characters, not an email address)."); return; }
      put("osap-team-call", call); UI.ok = "Making the case…"; UI.msg = ""; render();
      create(UI.ws, val("[data-cs-name]"), call).then(function (c) { UI.view = "case"; UI.id = c.id; UI.ok = "Case made. Invite members below by their OSAP account email."; render(); }, fail);
      return;
    }
    if (t.closest("[data-cs-accept]")) {
      var c2 = cleanCall(val("[data-cs-call]")); if (!c2) { say("Type a call sign (up to 24 characters, not an email address)."); return; }
      put("osap-team-call", c2);
      var inv = MINE && (MINE.invites || []).filter(function (x) { return x.id === UI.id; })[0];
      UI.ok = "Joining…"; render();
      accept(UI.id, inv && inv.name, c2).then(function () { UI.view = "case"; UI.ok = "You are in the case. Its items are in a new workspace on this device."; render(); }, fail);
      return;
    }
    if (t.closest("[data-cs-decline]")) { cmd("decline", { case: UI.id }).then(function () { UI.view = "list"; UI.id = ""; afterChange(null, "Invite declined."); }, fail); return; }
    if (!UI.id) return;
    var id = UI.id;
    if (t.closest("[data-cs-now]")) { syncCase(id); return; }
    if (t.closest("[data-cs-sw]")) { var bb = bound(id); if (bb && W.OSAP_WS) W.OSAP_WS.switchTo(bb.ws); return; }
    if (t.closest("[data-cs-log]")) { api(null, "?case=" + encodeURIComponent(id) + "&log=1&limit=50").then(function (j) { UI.log = j.log; render(); }, fail); return; }
    if (t.closest("[data-cs-invite]")) {
      var em = val("[data-cs-email]").trim(); if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(em)) { say("Type the email address of their OSAP account."); return; }
      cmd("invite", { case: id, email: em, role: val("[data-cs-irole]"), reason: reason() }).then(function (j) { afterChange(j, "Invited " + em + ". They see it when they sign in to OSAP."); }, fail);
      return;
    }
    if ((b = t.closest("[data-cs-uninvite]"))) { cmd("uninvite", { case: id, email: b.getAttribute("data-cs-uninvite"), reason: reason() }).then(function (j) { afterChange(j, "Invite cancelled."); }, fail); return; }
    if ((b = t.closest("[data-cs-remove]"))) {
      if (!confirm("Remove this member from the case? They lose access at once, and new items are sealed under a new key they never get. What they already saw stays on their devices.")) return;
      cmd("remove", { case: id, member: b.getAttribute("data-cs-remove"), reason: reason() }).then(function (j) { afterChange(j, "Removed. This device makes the new case key on the next sync."); syncCase(id); }, fail);
      return;
    }
    if (t.closest("[data-cs-setcall]")) { var c3 = cleanCall(val("[data-cs-call]")); if (!c3) { say("Type a call sign (up to 24 characters, not an email address)."); return; } cmd("call", { case: id, call: c3 }).then(function (j) { afterChange(j, "Call sign saved."); }, fail); return; }
    if (t.closest("[data-cs-leave]")) {
      if (!confirm("Leave this case? You lose access to it at once. The workspace and what you already have stay on this device.")) return;
      cmd("leave", { case: id, reason: reason() }).then(function () { return forget(id); }).then(function () { UI.view = "list"; UI.id = ""; afterChange(null, "You left the case. The workspace stays on this device."); }, fail);
      return;
    }
    if (t.closest("[data-cs-forget]")) {
      if (!confirm("Stop syncing this case on this device? You stay a member and can open it again from Team cases.")) return;
      forget(id).then(function () { UI.view = "list"; UI.id = ""; afterChange(null, "This device no longer syncs the case. The workspace stays here."); });
    }
  });
  D.addEventListener("change", function (e) {
    var s = e.target.closest && e.target.closest("[data-cs-role]"); if (!s || !box.contains(s) || !UI.id) return;
    cmd("role", { case: UI.id, member: s.getAttribute("data-cs-role"), role: s.value, reason: reason() }).then(function (j) { afterChange(j, "Role changed."); }, function (er) { fail(er); render(); });
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) closeP(); });

  /* ---------- what My work > Workspaces shows for a workspace ---------- */
  function wsHtml(ws) {
    if (!on()) return "";
    var id = caseOf(ws);
    if (id) {
      var b = bound(id);
      return '<div class="tmws" data-cs-ws><span><b>Case: ' + esc(b.name || "") + '</b> <i class="obs">' + esc(ROLE[b.role] || "") + " · " + esc(stateTxt(id)) + '</i></span><button type="button" class="refresh" data-cs-case="' + esc(id) + '">Case</button></div>';
    }
    if (W.OSAP_TEAM && W.OSAP_TEAM.teamOf && W.OSAP_TEAM.teamOf(ws)) return "";
    return '<div class="tmws" data-cs-ws><span><b>Team case</b> <i class="obs">Share with named OSAP accounts, each with a role: lead, analyst or viewer.</i></span>' +
      (allowed() ? '<button type="button" class="refresh" data-cs-share="' + esc(ws) + '">Share as a case</button>' : "") + '<button type="button" data-cs-list>Team cases</button></div>';
  }
  function tag(ws) { var id = caseOf(ws), b = id && bound(id); return b ? "case " + (b.name || "") + (b.role === "viewer" ? " (viewer)" : "") : ""; }

  var css = D.createElement("style");
  css.textContent = "#casedlg{position:fixed;inset:0;z-index:100004;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#casedlg .cbox{max-width:600px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#casedlg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#casedlg .chead h2{margin:0;font-size:18px;flex:1;overflow-wrap:anywhere}" +
    "#casedlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#casedlg .obs{color:var(--muted)}#casedlg h3{font-size:14px;margin:14px 0 4px}" +
    "#casedlg .mvf{display:flex;flex-direction:column;gap:3px;margin:8px 0;font-weight:600}#casedlg input,#casedlg select{font:inherit;font-size:16px;font-weight:400;min-height:40px;padding:4px 8px;max-width:100%;box-sizing:border-box}" +
    "#casedlg .mvbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}#casedlg button{min-height:40px}" +
    "#casedlg .mvmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}#casedlg .mvok{border-left:3px solid #2f9e44;padding:2px 10px}" +
    "#casedlg .mvwarn{border-left:3px solid #e8590c;padding:2px 10px}#casedlg .mvlink{background:none;border:none;color:#1c7ed6;text-decoration:underline;cursor:pointer;font:inherit;padding:0}" +
    "#casedlg .tmlink{display:flex;gap:6px;margin:4px 0 8px}#casedlg .tmlink input{flex:1;min-width:0}#casedlg .mvnote summary{cursor:pointer;font-weight:600;padding:6px 0}" +
    "#casedlg ul{list-style:none;margin:4px 0;padding:0}#casedlg li{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--line-soft)}#casedlg li>span{flex:1;min-width:140px;overflow-wrap:anywhere}#casedlg li i{font-style:normal;font-size:12px;display:block}";
  D.head.appendChild(css);

  W.OSAP_CASES = { open: openP, list: function () { return MINE; }, syncNow: syncCase, caseOf: caseOf, wsHtml: wsHtml, tag: tag, on: on };
  var go = function () { if (on()) start(); };
  if (T() && T().ready && T().ready.then) T().ready.then(go, function () {}); else go();
})();
