/* AXIOM OSAP: Team workspace (Shane picked "Team link" 2026-10-19: the team key lives only on members' devices; OSAP's server
   never holds it). A workspace in My work can be shared with a team. Built on Sync my devices (assets/osap-sync.js): the same
   sealing (AES-256-GCM, the event name as associated data), BIP-340 signed Nostr events of kind 30078 on free public relays,
   the same cutting of stores into units and the same per-item merge (newest change wins, deletes leave a marker).
   - Keys: each team has its own random key material, not taken from the device sync code: an AES-256 key, an HMAC key for the
     event names and a Nostr signing key. It is kept only on members' devices (localStorage "osap-team").
   - Joining is by link or code only. The secret is in the address after "#" (never "?"), so the browser never sends it to a
     server; assets/osap-sync-boot.js takes it off the address at once. Opening a link offers "Join team"; it never joins silently.
     An editor link carries the AES key, the name key and the signing key. A viewer link carries the AES key, the name key and
     the team's public key, not the signing key. Viewers can read but cannot publish, and that is the keys' doing, not only the
     buttons': an event needs the signing key's signature, relays refuse a bad one, and every member's device takes only events
     from the team's public key whose BIP-340 signature checks out and whose AES-GCM opens. A viewer's own changes in the team
     workspace stay on their device.
   - Shared: the stores Sync shares (assets/osap-ws.js KEYS and the drawn areas, less osap-sync.js NOSYNC): points, drawn areas,
     NAI/TAI, routes, imported shapes, viewsheds, keyword watches, My work, plans, analyst entities and links. Not shared: photos
     (a point's photo count is kept per device), device settings, the hidden areas (the United States drawn area and any item
     marked cc "us", also dropped when they come in). A team holds up to about 2 MB of sealed data; past that, new changes wait
     on the device with a clear message.
   - Who added what: each member sets a call sign when joining (free text, up to 24 characters; an email address is refused,
     never used or shown). An item a member adds gets addedBy (the call sign) and addedAt (ms) as attributes on the item itself;
     "by" and "at" were not used because My work items already have "at" and some plans use "by". An item keeps the call sign
     of whoever added it, whoever changes it later. Whole-value stores (a drawn area is a list of corners) carry no attribution.
   - Team items are the analysts' own work: never auto-approved and never graded by OSAP; a source grade on a My work item
     (assets/osap-grade.js) travels unchanged.
   - Removing someone: the owner (whoever created the team on that device) can Make new team links: fresh key material, the
     current state published under it, and a final sealed "moved" note under the old key (no new key inside), readable only by
     old members. The owner then sends the new links to those who stay.
   - Plan: creating or joining a team needs the Full plan (tools/tiers.mjs FEATURES.team); the owner always has Full.
   - Relay content is hostile data: messages and events are size-capped, signatures and ids checked, payloads capped when
     unpacked, unit names and stores checked. Keys and links are never logged.
   window.OSAP_TEAM {open, create, join, syncNow, rekey, leave, status, list, wsHtml, syncHtml, core}. */
(function (G, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(G, require("./osap-sync.js")).core;
  else if (G.document && G.OSAP_SYNC_CORE) factory(G, G.OSAP_SYNC_CORE).boot();
})(typeof window !== "undefined" ? window : globalThis, function (W, C) {
  "use strict";
  var te = new TextEncoder(), tdf = new TextDecoder("utf-8", { fatal: true });
  var CR = W.crypto, SUB = CR && CR.subtle;
  var CAP = 2000000, NBT = 24, MAX_EVENT = 120000, MAX_OPEN = 8e6, CALL_MAX = 24, NAME_MAX = 40, MAX_UNIT = 400000;
  var PTS = "osap-atak-pts", STORE_RE = /^(osap|asap)-[a-z0-9.-]{2,60}$/;

  /* ================= core: pure functions, tested in node (tests/team.test.mjs) ================= */
  function cat(a) { var n = 0, p = 0, o; a.forEach(function (x) { n += x.length; }); o = new Uint8Array(n); a.forEach(function (x) { o.set(x, p); p += x.length; }); return o; }
  function b64u(u) { var s = ""; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad");
    s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    var r = atob(s), u = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u;
  }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function cleanName(s) { return clean(s, NAME_MAX); }
  /* a call sign: free text up to 24 characters, never an email address */
  function cleanCall(s) { var c = clean(s, 60); if (/@/.test(c)) return ""; return c.slice(0, CALL_MAX).trim(); }
  function okSk(sk) { var n = C.b2n(sk); return n > BigInt(0) && n < C.N; }
  /* fresh key material for a new team */
  function newMaterial() {
    var sk; do { sk = C.rand(32); } while (!okSk(sk));
    return { aes: C.rand(32), hk: C.rand(32), sk: sk, pk: C.hex(C.pubOf(sk)) };
  }
  /* the code after "#team=": role, the keys, the team's name and a check, "E1.<keys>.<name>.<check>" or "V1.…" */
  function encode(mat, role, name) {
    var last = role === "e" ? mat.sk : C.unhex(mat.pk);
    if (!last || last.length !== 32) throw new Error("no key");
    var body = (role === "e" ? "E1" : "V1") + "." + b64u(cat([mat.aes, mat.hk, last])) + "." + b64u(te.encode(cleanName(name)));
    return body + "." + C.fp(body).slice(0, 6);
  }
  /* a link or a code to its keys, or null. A link's part after "#team=" is used; anything else in it is ignored. */
  function decode(s) {
    s = String(s == null ? "" : s).trim();
    var m = /(?:^|#|&)team=([A-Za-z0-9._-]+)/.exec(s); if (m) s = m[1];
    s = s.replace(/\s+/g, "");
    if (s.length < 20 || s.length > 600) return null;
    var p = s.split(".");
    if (p.length !== 4 || (p[0] !== "E1" && p[0] !== "V1")) return null;
    if (C.fp(p.slice(0, 3).join(".")).slice(0, 6) !== p[3]) return null;
    var k, nm;
    try { k = unb64u(p[1]); nm = tdf.decode(unb64u(p[2])); } catch (e) { return null; }
    if (k.length !== 96) return null;
    var o = { role: p[0] === "E1" ? "e" : "v", aes: k.slice(0, 32), hk: k.slice(32, 64), name: cleanName(nm) };
    if (o.role === "e") { o.sk = k.slice(64); if (!okSk(o.sk)) return null; o.pk = C.hex(C.pubOf(o.sk)); }
    else { var pk = k.slice(64); if (!C.okPub(pk)) return null; o.pk = C.hex(pk); }
    return o;
  }
  /* the viewer code for a team: the same team, without the signing key */
  function viewerCode(code) { var m = decode(code); return m ? encode(m, "v", m.name) : ""; }
  function linkFor(base, code) { return String(base || "").split("#")[0].split("?")[0] + "#team=" + code; }
  /* keys in the shape assets/osap-sync.js seal/open/dtag/event take; a viewer's has no sk, so event() refuses it */
  function teamKeys(mat) {
    return Promise.all([
      SUB.importKey("raw", mat.aes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
      SUB.importKey("raw", mat.hk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    ]).then(function (r) { return { aes: r[0], hk: r[1], pk: mat.pk, sk: mat.sk || null }; });
  }
  /* call signs on items: a unit that is one item (in a list or a keyed map) gets addedBy and addedAt. An item the team already
     has keeps the call sign it has there, so editing or a feature saving without the field never changes who added it. */
  function itemUnit(uk) { if (uk.slice(0, 2) !== "S|") return false; var p = C.parseUk(uk).path; return p[0] === "[" || /^\.[^[{]+[[{]/.test(p); }
  function stampBy(L, M, call, now) {
    var n = 0;
    Object.keys(L).forEach(function (uk) {
      var v = L[uk]; if (!itemUnit(uk) || !C.plain(v)) return;
      var m = M[uk], mv = m && !m.d && C.plain(m.v) && typeof m.v.addedBy === "string" ? m.v : null;
      if (mv && v.addedBy === mv.addedBy && v.addedAt === mv.addedAt) return;
      if (!mv && typeof v.addedBy === "string" && v.addedBy) return;
      var c = Object.assign({}, v);
      if (mv) { c.addedBy = mv.addedBy; if (mv.addedAt != null) c.addedAt = mv.addedAt; else delete c.addedAt; }
      else { if (!call) return; c.addedBy = call; c.addedAt = now; n++; }
      L[uk] = c;
    });
    return n;
  }
  /* the cap on one team's sealed data */
  function capCheck(sizes) { var t = 0; sizes.forEach(function (s) { t += s; }); return { total: t, cap: CAP, full: t > CAP, pct: Math.min(100, Math.round(t / CAP * 100)) }; }
  /* the last note under an old key: the team moved. It says when, never where: no key inside. */
  function movedNote(at) { return { type: "moved", v: 1, at: at }; }
  function isMoved(p) { return C.plain(p) && p.type === "moved"; }
  /* what is shared of a store: a point's photo count stays on each device */
  function shareText(k, text) {
    if (k !== PTS || typeof text !== "string") return text;
    var a; try { a = JSON.parse(text); } catch (e) { return text; }
    if (!Array.isArray(a)) return text;
    return JSON.stringify(a.map(function (p) { if (!C.plain(p) || !("ph" in p)) return p; var q = Object.assign({}, p); delete q.ph; return q; }));
  }
  function localText(k, text, mine) {
    if (k !== PTS || typeof text !== "string") return text;
    var have = {}, a;
    try { (JSON.parse(mine || "[]") || []).forEach(function (p) { if (C.plain(p) && p.id != null && p.ph) have["$" + p.id] = p.ph; }); } catch (e) {}
    try { a = JSON.parse(text); } catch (e) { return text; }
    if (!Array.isArray(a)) return text;
    return JSON.stringify(a.map(function (p) { if (C.plain(p) && have["$" + p.id]) { var q = Object.assign({}, p); q.ph = have["$" + p.id]; return q; } return p; }));
  }
  /* units that came in: only this team's workspace, only stores a workspace shares, no hidden items, no oversized values */
  function okUnits(S, synced) {
    Object.keys(S).forEach(function (uk) {
      var keep = false, x = S[uk];
      if (uk === "W|T") keep = x.d || C.plain(x.v);
      else if (uk.slice(0, 4) === "S|T|") {
        var p = C.parseUk(uk);
        keep = p.ws === "T" && STORE_RE.test(p.store) && C.NOSYNC.indexOf(p.store) < 0 && (!synced || synced(p.store)) && (x.d || !C.hidden(x.v));
        if (keep && !x.d) { try { keep = JSON.stringify(x.v === undefined ? null : x.v).length <= MAX_UNIT; } catch (e) { keep = false; } }
      }
      if (!keep) delete S[uk];
    });
    return S;
  }
  /* the newest event per name from what the relays sent, keeping only those signed by the team's key (checked here, not
     trusted to the relays); "limit" bounds the signature checks a flood of junk can cost */
  function pickSigned(events, pk, limit) {
    var seen = {}, by = {}, list = events.filter(function (e) { if (!C.plain(e) || typeof e.id !== "string" || seen[e.id]) return false; seen[e.id] = 1; return e.pubkey === pk; });
    list.sort(function (a, b) { return (+b.created_at || 0) - (+a.created_at || 0); });
    var checks = 0;
    return list.reduce(function (pr, e) {
      return pr.then(function () {
        var d = C.tagOf(e); if (!d || by[d] || checks >= (limit || 200)) return;
        checks++;
        return C.checkEvent(e, pk, MAX_EVENT + 2000).then(function (ok) { if (ok && !by[d]) by[d] = e; });
      });
    }, Promise.resolve()).then(function () { return by; });
  }

  var core = { encode: encode, decode: decode, viewerCode: viewerCode, linkFor: linkFor, newMaterial: newMaterial, teamKeys: teamKeys, cleanCall: cleanCall, cleanName: cleanName,
    stampBy: stampBy, capCheck: capCheck, movedNote: movedNote, isMoved: isMoved, shareText: shareText, localText: localText, okUnits: okUnits, pickSigned: pickSigned,
    CAP: CAP, NBT: NBT, MAX_EVENT: MAX_EVENT, MAX_OPEN: MAX_OPEN, CALL_MAX: CALL_MAX };

  /* ================= the page ================= */
  function boot() {
    var D = W.document;
    if (/[?&]watchscan=1(&|$)/.test(W.location.search)) return;
    var CFG = "osap-team", TPEND = "osap-team-pending", LINK = "osap-team-link", WAIT = 7000;
    function relays() { var r = W.OSAP_TEAM_RELAYS || W.OSAP_SYNC_RELAYS; return (r && r.length ? r : C.RELAYS).slice(0, 6); }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function put(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function json(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
    function when(ms) { return !ms ? "never" : W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
    function ago(ms) { var s = (Date.now() - ms) / 1000; return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; }
    function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
    function mb(n) { return n < 1e5 ? Math.max(1, Math.round(n / 1000)) + " kB" : (n / 1e6).toFixed(1) + " MB"; }
    function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function sdel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

    /* ---------- this device's teams ---------- */
    function okTeam(t) { return C.plain(t) && /^tm-[0-9a-f]{8,32}$/.test(t.id || "") && typeof t.code === "string" && !!decode(t.code) && (t.role === "e" || t.role === "v"); }
    function cfg() { var c = json(raw(CFG), null); if (!C.plain(c) || !Array.isArray(c.teams)) c = { v: 1, teams: [] }; c.teams = c.teams.filter(okTeam); return c; }
    function saveCfg(c) { if (!c.teams.length) { del(CFG); return true; } return put(CFG, JSON.stringify(c)); }
    function team(id) { return cfg().teams.filter(function (x) { return x.id === id; })[0] || null; }
    function edit(id, fn) { var c = cfg(), t = c.teams.filter(function (x) { return x.id === id; })[0]; if (!t) return null; fn(t); saveCfg(c); return t; }
    function teamOfWs(ws) { return cfg().teams.filter(function (x) { return x.ws === ws; })[0] || null; }
    function need() { return (W.OSAP_TIER && W.OSAP_TIER.need && W.OSAP_TIER.need("team")) || "full"; }
    /* the plan check: off the Netlify site there is no paywall; the owner has Full */
    function allowed() { var T = W.OSAP_TIER; if (!T || !T.on || !T.on()) return true; if (T.owner && T.owner()) return true; return !!(T.allows && T.allows(need())); }
    var UPGRADE = "Team workspace needs the Full plan. Your own workspaces and Sync my devices keep working.";

    /* ---------- workspaces (assets/osap-ws.js) ---------- */
    function synced(k) { return !!(W.OSAP_WS && W.OSAP_WS.scoped && W.OSAP_WS.scoped(k)) && C.NOSYNC.indexOf(k) < 0; }
    function reg() { var r = json(raw("osap-ws"), null); return r && Array.isArray(r.list) && r.list.length ? r : null; }
    function wsOf(r, id) { return r ? r.list.filter(function (w) { return w.id === id; })[0] || null : null; }
    function liveStores() { var o = {}; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && synced(k)) { var v = raw(k); if (v != null) o[k] = v; } } } catch (e) {} return o; }
    function blob(id) { var d = json(raw("osap-ws-data-" + id), null); return d && C.plain(d.keys) ? d.keys : {}; }
    function tpending() { var p = json(raw(TPEND), null); return p && C.plain(p.keys) ? p : null; }
    function overlay(S, ws) {
      var p = tpending(); if (!p || p.ws !== ws) return S;
      Object.keys(p.keys).forEach(function (k) { var x = p.keys[k]; if (!C.plain(x) || (S[k] == null ? "" : C.fp(S[k])) !== x.b) return; if (x.v == null) delete S[k]; else S[k] = x.v; });
      return S;
    }
    /* the bound workspace's shared stores as this device holds them now (writes waiting for the reload count as here) */
    function storesOf(ws, stored) {
      var r = reg(), w = wsOf(r, ws); if (!w) return null;
      var S = w.id === r.active ? (stored ? liveStores() : overlay(liveStores(), ws)) : blob(ws), o = {};
      Object.keys(S).forEach(function (k) { if (synced(k) && typeof S[k] === "string") o[k] = S[k]; });
      return o;
    }
    function wsSig(ws) { var S = storesOf(ws); return S ? C.fp(C.canon(S)) : ""; }

    /* ---------- per team state in IndexedDB "osap-team", keyed by the team's public key ---------- */
    function db() {
      return new Promise(function (res, rej) {
        if (!W.indexedDB) { rej(new Error("no IndexedDB")); return; }
        var r = W.indexedDB.open("osap-team", 1);
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
    function loadState(pk) { return kv("readonly", function (s) { return s.get(pk); }).then(function (x) { return x && x.pk === pk ? x : { pk: pk, M: {}, O: {}, first: true }; }); }
    function saveState(x) { return kv("readwrite", function (s) { s.put(x, x.pk); }); }
    function dropState(pk) { return kv("readwrite", function (s) { s.delete(pk); }).then(null, function () {}); }

    /* ---------- the merged state into the bound workspace: other workspaces now, the open one at the next load ---------- */
    function writeTeam(t, M) {
      var r = reg(), w = wsOf(r, t.ws); if (!r || r.pending) return { live: 0, other: 0 };
      if (!w) return { live: 0, other: 0, gone: 1 };
      var live = w.id === r.active, base = live ? liveStores() : blob(w.id), here = live ? overlay(Object.assign({}, base), w.id) : base, sh = {};
      Object.keys(here).forEach(function (k) { if (synced(k)) sh[k] = shareText(k, here[k]); });
      var want = C.storesFrom(M, "T", sh), out = {}, diff = 0, keysP = {}, all = {};
      Object.keys(base).forEach(function (k) { if (!synced(k)) out[k] = base[k]; });
      Object.keys(want).forEach(function (k) { if (synced(k)) out[k] = localText(k, want[k], here[k]); });
      Object.keys(base).concat(Object.keys(out)).forEach(function (k) { all[k] = 1; });
      Object.keys(all).forEach(function (k) {
        if (!synced(k)) return;
        var a = base[k] == null ? null : C.split(base[k]), b = out[k] == null ? null : C.split(out[k]);
        if (C.canon(a) === C.canon(b)) { if (base[k] != null) out[k] = base[k]; else delete out[k]; return; }
        diff++;
        if (live) { var cur = raw(k); keysP[k] = { v: out[k] == null ? null : out[k], b: cur == null ? "" : C.fp(cur) }; }
      });
      if (live) { if (Object.keys(keysP).length) put(TPEND, JSON.stringify({ at: Date.now(), ws: w.id, keys: keysP })); else del(TPEND); return { live: diff, other: 0 }; }
      if (diff && !put("osap-ws-data-" + w.id, JSON.stringify({ v: 1, keys: out }))) return { live: 0, other: 0, full: 1 };
      return { live: 0, other: diff };
    }

    /* ---------- one team's sync ---------- */
    var LAST = {}, busy = {}, sentAt = {}, memAt = {}, sigs = {};
    function tags(K) {
      var a = []; for (var i = 0; i < NBT; i++) a.push(C.dtag(K, "bucket/" + i));
      a.push(C.dtag(K, "moved"));
      return Promise.all(a).then(function (t) { return { b: t.slice(0, NBT), moved: t[NBT] }; });
    }
    function fetchAll(K) {
      return Promise.all(relays().map(function (u) { return C.relayReq(u, { kinds: [30078], authors: [K.pk], limit: 300 }, WAIT, function (e) { return e.pubkey === K.pk && e.kind === 30078; }); }));
    }
    function devId() { var d = raw("osap-team-dev"); if (!/^[0-9a-f]{16}$/.test(d || "")) { d = C.hex(C.rand(8)); put("osap-team-dev", d); } return d; }
    function syncTeam(id) {
      if (busy[id]) return busy[id];
      var t = team(id); if (!t || !SUB) return Promise.resolve(null);
      if (t.closed) return Promise.resolve(LAST[id] || null);
      busy[id] = run(t).then(function (x) { delete busy[id]; render(); return x; }, function (e) {
        delete busy[id];
        LAST[id] = Object.assign({}, LAST[id] || {}, { at: Date.now(), ok: false, msg: "Team sync failed: " + String(e && e.message || e).slice(0, 160) });
        render(); return LAST[id];
      });
      render();
      return busy[id];
    }
    function run(t) {
      var mat = decode(t.code), K, T, st, R = {}, fetched = {}, now = Date.now(), reached = 0, members = [], moved = false, memTag;
      return teamKeys(mat).then(function (k) { K = k; return Promise.all([tags(K), C.dtag(K, "member/" + devId())]); }).then(function (x) {
        T = x[0]; memTag = x[1];
        return Promise.all([loadState(K.pk), fetchAll(K)]);
      }).then(function (x) {
        st = x[0];
        var evs = []; x[1].forEach(function (r) { if (r.ok) reached++; evs = evs.concat(r.events); });
        return pickSigned(evs, K.pk, 200);
      }).then(function (by) {
        return Promise.all(Object.keys(by).map(function (d) {
          return C.open(K, d, by[d].content, MAX_OPEN).then(function (p) {
            if (!C.plain(p)) return;
            if (p.type === "bucket" && T.b.indexOf(d) >= 0) {
              fetched[d] = C.fp(C.canon(p.u || {}));
              var S = okUnits(C.trusted(C.fromBucket(p.u)), synced);
              Object.keys(S).forEach(function (uk) { if (C.newer(S[uk], R[uk])) R[uk] = S[uk]; });
            } else if (d === T.moved && isMoved(p)) moved = true;
            else if (p.type === "member" && d !== memTag && typeof p.call === "string" && members.length < 60) members.push({ call: cleanCall(p.call) || "?", at: +p.at || 0 });
          });
        }));
      }).then(function () {
        if (!reached) throw new Error("could not reach any relay. Check the connection; OSAP will try again.");
        if (moved) {
          edit(t.id, function (x) { x.closed = { at: now }; });
          LAST[t.id] = { at: now, ok: true, closed: true, msg: "" };
          return LAST[t.id];
        }
        var S0 = storesOf(t.ws);
        if (!S0) { LAST[t.id] = { at: now, ok: false, gone: true, msg: "The workspace for this team was deleted on this device." }; return LAST[t.id]; }
        var sh = {}; Object.keys(S0).forEach(function (k) { sh[k] = shareText(k, S0[k]); });
        var L = C.unitsOf([{ id: "T", name: t.name, created: 0 }], function () { return sh; }, synced);
        if (t.role === "e") stampBy(L, C.merge([st.M, R], now), t.call, now);
        var S = C.stamp(L, st.O, st.M, now, st.first && !t.owner), M = C.merge([st.M, S, R], now);
        var ch = writeTeam(t, M);
        st.M = M; st.first = false; st.O = {};
        /* "held" is what is really stored here, not writes still waiting for the reload: a waiting item the page then
           saves over (its old copy, without that item) was never here, so it is not counted as deleted here */
        var Sb = storesOf(t.ws, true) || {}, shb = {}; Object.keys(Sb).forEach(function (k) { shb[k] = shareText(k, Sb[k]); });
        var Lb = C.unitsOf([{ id: "T", name: t.name, created: 0 }], function () { return shb; }, synced);
        Object.keys(S).forEach(function (uk) { if (!S[uk].d && uk in Lb) st.O[uk] = { t: S[uk].t, h: C.fp(C.canon(Lb[uk])) }; });
        var B = C.buckets(M, NBT), at = Math.floor(now / 1000);
        return Promise.all(B.map(function (b, i) { return C.seal(K, T.b[i], { type: "bucket", v: 1, u: b }); })).then(function (sealed) {
          var cap = capCheck(sealed.map(function (s) { return s.length; })), out = [], big = 0;
          if (t.role !== "e" || cap.full) return { cap: cap, out: out, big: 0 };
          return Promise.all(B.map(function (b, i) {
            if (fetched[T.b[i]] === C.fp(C.canon(b)) || (!Object.keys(b).length && !(T.b[i] in fetched))) return null;
            if (sealed[i].length > MAX_EVENT) { big++; return null; }
            return C.event(K, T.b[i], sealed[i], Math.max(at, (sentAt[T.b[i]] || 0) + 1));
          })).then(function (evs) {
            out = evs.filter(Boolean);
            if (!out.length && now - (memAt[t.id] || 0) < 600000) return null;
            return C.seal(K, memTag, { type: "member", v: 1, call: t.call, at: now }).then(function (s) { return C.event(K, memTag, s, at); });
          }).then(function (m) { if (m) { out.push(m); memAt[t.id] = now; } return { cap: cap, out: out, big: big }; });
        }).then(function (P) {
          return Promise.all(P.out.length ? relays().map(function (u) { return C.relayPub(u, P.out, WAIT); }) : []).then(function (res) {
            var okR = P.out.length ? res.filter(function (x) { return x.ok >= P.out.length; }).length : reached;
            P.out.forEach(function (e) { sentAt[C.tagOf(e)] = e.created_at; });
            return saveState(st).then(function () {
              var msg = !okR ? "The relays did not take this device's changes" + (res[0] && res[0].why ? " (" + res[0].why + ")" : "") + ". OSAP will try again." : "";
              LAST[t.id] = { at: Date.now(), ok: okR > 0, relays: okR, of: relays().length, sent: P.out.length, size: P.cap.total, full: P.cap.full && t.role === "e", big: P.big,
                members: members.sort(function (a, b) { return b.at - a.at; }), changes: ch, msg: msg };
              sigs[t.id] = wsSig(t.ws);
              edit(t.id, function (x) { x.last = LAST[t.id].at; });
              if (ch.live) bar(ch.live);
              else if (ch.other) toast("Team " + t.name + ": " + ch.other + " change" + (ch.other > 1 ? "s" : "") + " brought in");
              return LAST[t.id];
            });
          });
        });
      });
    }

    /* ---------- making, joining, new links, leaving ---------- */
    function create(ws, name, call) {
      if (!allowed()) return Promise.reject(new Error(UPGRADE));
      call = cleanCall(call); if (!call) return Promise.reject(new Error("Type a call sign (up to 24 characters, not an email address)."));
      var r = reg(), w = wsOf(r, ws); if (!w) return Promise.reject(new Error("That workspace is not on this device."));
      if (teamOfWs(ws)) return Promise.reject(new Error("This workspace is already shared with a team."));
      if (W.OSAP_CASES && W.OSAP_CASES.caseOf && W.OSAP_CASES.caseOf(ws)) return Promise.reject(new Error("This workspace is a team case. Use another workspace for a team link."));
      var mat = newMaterial(), c = cfg(), t = { id: "tm-" + C.hex(C.rand(6)), name: cleanName(name) || cleanName(w.name) || "Team", role: "e", owner: true, ws: ws, call: call, since: Date.now() };
      t.code = encode(mat, "e", t.name);
      c.teams.push(t);
      if (!saveCfg(c)) return Promise.reject(new Error("This browser would not save the team (storage full)."));
      return syncTeam(t.id).then(function () { return t; });
    }
    function join(code, call, into) {
      if (!allowed()) return Promise.reject(new Error(UPGRADE));
      var m = decode(code); if (!m) return Promise.reject(new Error("That is not a team link or code. Check it and paste it again."));
      call = cleanCall(call); if (!call) return Promise.reject(new Error("Type a call sign (up to 24 characters, not an email address)."));
      var c = cfg(), same = c.teams.filter(function (x) { var d = decode(x.code); return d && d.pk === m.pk; })[0];
      if (same && !same.closed) {
        if (same.role === "v" && m.role === "e") { edit(same.id, function (x) { x.role = "e"; x.code = encode(m, "e", m.name || x.name); x.call = call; }); return syncTeam(same.id).then(function () { return team(same.id); }); }
        return Promise.reject(new Error("This device is already in the team \"" + same.name + "\"."));
      }
      var ws = into && wsOf(reg(), into) ? into : null;
      if (!ws) {
        var w = W.OSAP_WS && W.OSAP_WS.create ? W.OSAP_WS.create(m.name || "Team") : null;
        if (!w) return Promise.reject(new Error("A workspace for the team could not be made on this device."));
        ws = w.id;
      }
      c = cfg();
      c.teams.forEach(function (x) { if (x.ws === ws && x.closed) { var o = decode(x.code); if (o) dropState(o.pk); delete LAST[x.id]; } });
      c.teams = c.teams.filter(function (x) { return !(x.ws === ws && x.closed); });
      var t = { id: "tm-" + C.hex(C.rand(6)), name: m.name || "Team", role: m.role, owner: false, ws: ws, call: call, code: encode(m, m.role, m.name), since: Date.now() };
      c.teams.push(t);
      if (!saveCfg(c)) return Promise.reject(new Error("This browser would not save the team (storage full)."));
      return syncTeam(t.id).then(function () { return t; });
    }
    /* the owner's way to remove someone: new keys, the current state under them, and a "moved" note under the old ones */
    function rekey(id) {
      var t = team(id); if (!t || !t.owner || t.role !== "e" || t.closed) return Promise.reject(new Error("Only the team's owner can make new team links."));
      var old = decode(t.code), mat = newMaterial(), Ko, Kn, Tn, To, st;
      return syncTeam(id).then(function () { return Promise.all([teamKeys(old), teamKeys(mat)]); }).then(function (k) {
        Ko = k[0]; Kn = k[1]; return Promise.all([tags(Ko), tags(Kn), loadState(Ko.pk)]);
      }).then(function (x) {
        To = x[0]; Tn = x[1]; st = x[2];
        var B = C.buckets(st.M, NBT), at = Math.floor(Date.now() / 1000);
        return Promise.all(B.map(function (b, i) {
          if (!Object.keys(b).length) return null;
          return C.seal(Kn, Tn.b[i], { type: "bucket", v: 1, u: b }).then(function (s) { return s.length > MAX_EVENT ? null : C.event(Kn, Tn.b[i], s, at); });
        })).then(function (evs) {
          evs = evs.filter(Boolean);
          return Promise.all(relays().map(function (u) { return C.relayPub(u, evs, WAIT); })).then(function (res) {
            if (evs.length && !res.some(function (r) { return r.ok >= evs.length; })) throw new Error("The relays did not take the new team copy, so nothing was changed. Try again.");
            return C.seal(Ko, To.moved, movedNote(Date.now()));
          });
        }).then(function (s) { return C.event(Ko, To.moved, s, at + 1); }).then(function (ev) {
          return Promise.all(relays().map(function (u) { return C.relayPub(u, [ev], WAIT); }));
        });
      }).then(function () {
        return saveState({ pk: Kn.pk, M: st.M, O: st.O, first: false });
      }).then(function () {
        edit(id, function (x) { x.code = encode(mat, "e", x.name); x.rekeyed = Date.now(); });
        delete LAST[id];
        return dropState(Ko.pk);
      }).then(function () { return syncTeam(id); }).then(function () { return team(id); });
    }
    function leave(id) {
      var t = team(id); if (!t) return Promise.resolve();
      var d = decode(t.code), c = cfg();
      c.teams = c.teams.filter(function (x) { return x.id !== id; }); saveCfg(c);
      delete LAST[id];
      var p = tpending(); if (p && p.ws === t.ws) del(TPEND);
      return d ? dropState(d.pk) : Promise.resolve();
    }

    /* ---------- the team's changes to the open workspace: a bar offers the reload ---------- */
    function bar(n) {
      var b = D.getElementById("teambar");
      if (!b) { b = D.createElement("div"); b.id = "teambar"; b.setAttribute("role", "status"); D.body.appendChild(b); }
      b.innerHTML = "<span>" + n + " change" + (n > 1 ? "s" : "") + ' from your team</span><button type="button" data-tm-reload>Show them</button><button type="button" class="x" aria-label="Later" data-tm-later>&times;</button>';
      b.hidden = false;
    }

    /* ---------- when to sync: on open, on a change in a team's workspace, and every minute while the page is shown ---------- */
    var timer = null, poll = null, chain = Promise.resolve();
    function active() { return cfg().teams.filter(function (t) { return !t.closed; }); }
    function syncAll() { active().forEach(function (t) { chain = chain.then(function () { return syncTeam(t.id); }).then(null, function () {}); }); return chain; }
    function soon(ms) { clearTimeout(timer); timer = setTimeout(syncAll, ms); }
    function start() {
      if (poll || !active().length) return;
      soon(3000);
      poll = setInterval(function () {
        if (D.visibilityState !== "visible") return;
        var due = active().some(function (t) { return !busy[t.id] && (wsSig(t.ws) !== sigs[t.id] || Date.now() - ((LAST[t.id] && LAST[t.id].at) || 0) > 60000); });
        if (due) soon(1500);
      }, 10000);
    }
    D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible" && active().length) soon(1000); });

    /* ---------- the team panel ---------- */
    var box = D.createElement("div"); box.id = "teamdlg"; box.hidden = true;
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "team-h");
    D.body.appendChild(box);
    var UI = { view: "", id: "", ws: "", link: "", msg: "", ok: "" };
    function openP(view, arg) {
      UI.view = view || "list"; UI.msg = ""; UI.ok = ""; UI.id = ""; UI.ws = ""; UI.link = "";
      if (view === "team") UI.id = arg; else if (view === "create") UI.ws = arg; else if (view === "join") UI.link = arg;
      box.hidden = false; render();
      var f = box.querySelector("input:not([readonly]),.x"); if (f && f.focus) f.focus();
      if (view === "team" && team(arg) && !busy[arg] && Date.now() - ((LAST[arg] && LAST[arg].at) || 0) > 15000) syncTeam(arg);
    }
    function closeP() { box.hidden = true; box.innerHTML = ""; if (UI.view === "join") sdel(LINK); UI.view = ""; repaintHosts(); }
    function repaintHosts() {
      var ws = D.getElementById("wsdlg"); if (ws && !ws.hidden && W.OSAP_WS) W.OSAP_WS.open();
      var sy = D.getElementById("syncdlg"); if (sy && !sy.hidden && W.OSAP_SYNC) { sy.hidden = true; W.OSAP_SYNC.open(); }
    }
    function base() { return W.location.origin + W.location.pathname; }
    function roleTxt(t) { return t.role === "e" ? (t.owner ? "Owner (editor)" : "Editor") : "Viewer"; }
    function wsName(id) { var w = wsOf(reg(), id); return w ? w.name : ""; }
    function stateTxt(t) {
      var L = LAST[t.id];
      if (t.closed) return "This team has moved to new links.";
      if (busy[t.id]) return "Syncing…";
      if (!L) return t.last ? "Last synced " + ago(t.last) + " (" + when(t.last) + ")." : "Waiting to sync…";
      if (L.gone) return L.msg;
      return L.ok ? "Synced " + ago(L.at) + " (" + when(L.at) + ")." + (L.relays < L.of ? " " + L.relays + " of " + L.of + " relays answered." : "") : L.msg || "Not synced yet.";
    }
    function linkBox(kind, code) {
      var url = linkFor(base(), code);
      return '<div class="tmlink"><input readonly aria-label="' + (kind === "e" ? "Editor link" : "Viewer link") + '" value="' + esc(url) + '" data-tm-sel><button type="button" class="refresh" data-tm-copy="' + kind + '">' + (kind === "e" ? "Copy editor link" : "Copy viewer link") + "</button></div>";
    }
    function gateHtml() { return '<p class="mvwarn" data-tm-gate>' + esc(UPGRADE) + "</p>" + (W.OSAP_TIER && W.OSAP_TIER.on && W.OSAP_TIER.on() ? '<div class="mvbtns"><button type="button" data-tm-plans>See plans</button></div>' : ""); }
    function callInput(v) { return '<label class="mvf">Your call sign<input data-tm-call maxlength="' + CALL_MAX + '" autocomplete="off" spellcheck="false" placeholder="e.g. RAVEN 2" value="' + esc(v || "") + '"></label><p class="obs">Shown beside the items you add, with the time. Up to ' + CALL_MAX + " characters. Not your email: an email address is never used or shown.</p>"; }
    function render() {
      if (box.hidden) return;
      /* what the analyst has typed survives a redraw (a message, a sync finishing) */
      var typed = {};
      ["data-tm-name", "data-tm-call", "data-tm-paste"].forEach(function (a) { var i = box.querySelector("[" + a + "]"); if (i && box.getAttribute("data-v") === UI.view + UI.id) typed[a] = i.value; });
      var h = "", title = "Team workspace", t = UI.id ? team(UI.id) : null;
      if (UI.view === "create") {
        var wn = wsName(UI.ws); title = "Share with a team";
        h = !allowed() ? gateHtml() :
          "<p>Share the workspace <b>" + esc(wn) + "</b> with your team. Everyone in the team sees the same points, areas, NAI/TAI, routes, shapes, viewsheds, watches, saved reports and notes, plans and analyst entities, and each item shows who added it and when.</p>" +
          '<label class="mvf">Team name<input data-tm-name maxlength="' + NAME_MAX + '" autocomplete="off" value="' + esc(wn) + '"></label>' + callInput(raw("osap-team-call")) +
          '<div class="mvbtns"><button type="button" class="refresh" data-tm-make>Create team</button><button type="button" data-tm-cancel>Cancel</button></div>' +
          '<p class="obs">OSAP makes a new team key on this device. You then send an editor link (can add and change items) or a viewer link (can only look) to each member. OSAP\'s server never sees the key.</p>';
      } else if (UI.view === "paste") {
        title = "Join a team";
        h = !allowed() ? gateHtml() : '<label class="mvf">Team link or code<input data-tm-paste autocomplete="off" spellcheck="false" placeholder="Paste the link you were sent"></label>' +
          '<div class="mvbtns"><button type="button" class="refresh" data-tm-read>Continue</button><button type="button" data-tm-cancel>Cancel</button></div>';
      } else if (UI.view === "join") {
        var m = decode(UI.link); title = "Join team";
        if (!m) h = '<p class="mvwarn">That is not a team link or code. Ask the person who sent it for a new one.</p><div class="mvbtns"><button type="button" data-tm-notnow>Close</button></div>';
        else {
          var into = cfg().teams.filter(function (x) { return x.closed; })[0];
          h = "<p>You were sent a link to the team <b>" + esc(m.name || "Team") + "</b>.</p>" +
            (m.role === "e" ? '<p class="mvok">Editor link: you can see, add and change the team\'s items.</p>' : '<p class="mvok">Viewer link: you can see the team\'s items but cannot add or change them.</p>') +
            (!allowed() ? gateHtml() : callInput(raw("osap-team-call")) +
              (into ? '<label class="tmchk"><input type="checkbox" data-tm-into="' + esc(into.id) + '"> Put it in the workspace of the moved team "' + esc(into.name) + '"</label>' : "") +
              '<p class="obs">Joining makes a new workspace "' + esc(m.name || "Team") + '" on this device for the team\'s items. Nothing is joined until you press Join team.</p>' +
              '<div class="mvbtns"><button type="button" class="refresh" data-tm-join>Join team</button><button type="button" data-tm-notnow>Not now</button></div>');
        }
      } else if (UI.view === "team" && t) {
        var L = LAST[t.id] || {}, used = L.size || 0, mem = (L.members || []).map(function (x) { return esc(x.call) + " (" + esc(ago(x.at)) + ")"; }).join(", "), isAct = reg() && reg().active === t.ws;
        title = "Team: " + t.name;
        h = '<p class="mvok">' + esc(roleTxt(t)) + " · call sign <b>" + esc(t.call) + "</b> · workspace <b>" + esc(wsName(t.ws) || "deleted") + "</b></p>" +
          '<p class="mvmsg" role="status" data-tm-state>' + esc(stateTxt(t)) + "</p>";
        if (t.closed) {
          h += "<p>The owner made new team links, so this team's old key is closed. What you already have stays in your workspace. Ask the owner for the new link and paste it here, or leave the team.</p>" +
            '<label class="mvf">New team link<input data-tm-paste autocomplete="off" spellcheck="false"></label><div class="mvbtns"><button type="button" class="refresh" data-tm-read>Continue</button></div>';
        } else {
          h += (used ? '<div class="tmcap"><div class="tmbar"><i style="width:' + Math.max(1, Math.min(100, Math.round(used / CAP * 100))) + '%"></i></div><span>' + esc(mb(used)) + " of " + esc(mb(CAP)) + " used</span></div>" : "") +
            (L.full ? '<p class="mvwarn" role="alert" data-tm-full>This team is full (about 2 MB). New changes stay on this device until there is room: delete items the team no longer needs, such as old routes, viewsheds or imported shapes.</p>' : "") +
            (L.big ? '<p class="mvwarn">Some items are too large to share.</p>' : "") +
            (t.role === "v" ? '<p class="obs" data-tm-ro>You joined with a viewer link: you can see the team\'s items but cannot add or change them. Changes you make in this workspace stay on this device.</p>' : "") +
            (mem ? "<p>Editors seen: " + mem + "</p>" : "") +
            '<div class="mvbtns"><button type="button" class="refresh" data-tm-now' + (busy[t.id] ? " disabled" : "") + ">Sync now</button>" + (isAct || !wsName(t.ws) ? "" : '<button type="button" data-tm-sw>Open the team workspace</button>') + "</div>" +
            "<h3>Invite</h3>" +
            (t.role === "e" ? "<p>Editor link: can see, add, change and delete the team's items.</p>" + linkBox("e", t.code) : "") +
            "<p>Viewer link: can see the team's items, cannot change them.</p>" + linkBox("v", viewerCode(t.code)) +
            '<p class="obs">Anyone with a link is in the team, so send it only to members, in a private message. The key is in the part after #, which browsers never send to a server.</p>' +
            (t.owner && t.role === "e" ? "<h3>Remove someone</h3><p>A link cannot be taken back, so to remove someone, make new team links. OSAP makes a new team key, copies the team's items to it, and leaves a last note under the old key saying the team has moved (with no new key in it). Then send the new links to the members who stay. Whoever does not get a new link keeps what they already had, but sees nothing new and cannot add to the team.</p>" +
              '<div class="mvbtns"><button type="button" data-tm-rekey>Make new team links</button></div>' : "") +
            "<h3>Your call sign</h3>" + '<div class="tmlink"><input data-tm-call maxlength="' + CALL_MAX + '" autocomplete="off" value="' + esc(t.call) + '"><button type="button" data-tm-setcall>Save</button></div>';
        }
        h += '<p><button type="button" class="mvlink" data-tm-leave>Leave this team on this device</button></p>';
      } else {
        title = "Teams";
        h = syncHtml(true);
      }
      box.innerHTML = '<div class="cbox"><div class="chead"><h2 id="team-h">' + esc(title) + '</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
        (UI.msg ? '<p class="mvwarn" role="alert">' + esc(UI.msg) + "</p>" : "") + (UI.ok ? '<p class="mvok" role="status">' + esc(UI.ok) + "</p>" : "") + h +
        '<details class="mvnote"><summary>How a team is kept private</summary>' +
        "<p>The team's items are locked with AES-256-GCM on each member's device, using a team key that only members' devices hold, and passed through free public Nostr relays, the same way as Sync my devices. Relays see scrambled data, its size and timing, and each device's internet address. OSAP's server never holds the key.</p>" +
        "<p>Every change is signed with the team's signing key, which only editor links carry. Each device takes only changes with a valid signature, so a viewer cannot change the team even by going around the app. Photos and the hidden areas are never shared. A team holds about 2 MB. Items are the members' own work: nothing is approved or graded by OSAP.</p></details></div>";
      box.setAttribute("data-v", UI.view + UI.id);
      Object.keys(typed).forEach(function (a) { var i = box.querySelector("[" + a + "]"); if (i) i.value = typed[a]; });
    }
    function say(t) { UI.msg = t; UI.ok = ""; render(); }
    function copy(text, what) {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(what + " copied"); UI.ok = what + " copied. Send it in a private message."; UI.msg = ""; render(); }, function () { say("Copy did not work here. Select the link and copy it."); });
      else say("Copy did not work here. Select the link and copy it.");
    }
    function val(sel) { var i = box.querySelector(sel); return i ? i.value : ""; }
    function fail(e) { say(String(e && e.message || e).slice(0, 200)); }
    D.addEventListener("click", function (e) {
      var t = e.target, b = t.closest ? t.closest("[data-tm-share],[data-tm-open],[data-tm-list],[data-tm-paste-open],[data-tm-reload],[data-tm-later]") : null;
      if (b) {
        if (b.hasAttribute("data-tm-share")) openP("create", b.getAttribute("data-tm-share"));
        else if (b.hasAttribute("data-tm-open")) openP("team", b.getAttribute("data-tm-open"));
        else if (b.hasAttribute("data-tm-paste-open")) openP("paste");
        else if (b.hasAttribute("data-tm-list")) openP("list");
        else if (b.hasAttribute("data-tm-reload")) W.location.reload();
        else if (b.hasAttribute("data-tm-later")) b.closest("#teambar").hidden = true;
        return;
      }
      if (!box.contains(t)) return;
      var tm = UI.id ? team(UI.id) : null;
      if (t === box || t.closest(".x")) { closeP(); return; }
      if (t.closest("[data-tm-cancel]")) { closeP(); return; }
      if (t.closest("[data-tm-plans]")) { if (W.OSAP_TIER) W.OSAP_TIER.open(); return; }
      if (t.closest("[data-tm-notnow]")) { sdel(LINK); closeP(); return; }
      if (t.closest("[data-tm-sel]")) { t.select(); return; }
      if (t.closest("[data-tm-make]")) {
        var call = cleanCall(val("[data-tm-call]")); if (!call) { say("Type a call sign (up to 24 characters, not an email address)."); return; }
        put("osap-team-call", call);
        UI.msg = ""; UI.ok = "Making the team…"; render();
        create(UI.ws, val("[data-tm-name]"), call).then(function (x) { start(); UI.view = "team"; UI.id = x.id; UI.ok = "Team made. Send the editor or viewer link below to each member."; render(); }, fail);
        return;
      }
      if (t.closest("[data-tm-read]")) {
        var v = val("[data-tm-paste]"); if (!decode(v)) { say("That is not a team link or code. Check it and paste it again."); return; }
        UI.view = "join"; UI.link = v; UI.msg = ""; UI.ok = ""; render(); return;
      }
      if (t.closest("[data-tm-join]")) {
        var c2 = cleanCall(val("[data-tm-call]")); if (!c2) { say("Type a call sign (up to 24 characters, not an email address)."); return; }
        put("osap-team-call", c2);
        var ib = box.querySelector("[data-tm-into]"), into = ib && ib.checked ? (team(ib.getAttribute("data-tm-into")) || {}).ws : null;
        UI.msg = ""; UI.ok = "Joining…"; render();
        join(UI.link, c2, into).then(function (x) { sdel(LINK); start(); UI.view = "team"; UI.id = x.id; UI.link = ""; UI.ok = "You are in the team. Its items are in the workspace \"" + wsName(x.ws) + "\"."; render(); }, fail);
        return;
      }
      if (!tm) return;
      if (t.closest("[data-tm-now]")) { syncTeam(tm.id); return; }
      if (t.closest("[data-tm-sw]")) { if (W.OSAP_WS) W.OSAP_WS.switchTo(tm.ws); return; }
      if ((b = t.closest("[data-tm-copy]"))) { var k = b.getAttribute("data-tm-copy"); copy(linkFor(base(), k === "e" ? tm.code : viewerCode(tm.code)), k === "e" ? "Editor link" : "Viewer link"); return; }
      if (t.closest("[data-tm-setcall]")) { var c3 = cleanCall(val("[data-tm-call]")); if (!c3) { say("Type a call sign (up to 24 characters, not an email address)."); return; } edit(tm.id, function (x) { x.call = c3; }); put("osap-team-call", c3); UI.ok = "Call sign saved. It is shown on items you add from now on."; UI.msg = ""; render(); return; }
      if (t.closest("[data-tm-rekey]")) {
        if (!confirm("Make new team links for \"" + tm.name + "\"? The old links stop working for new changes. You then send the new links to the members who stay.")) return;
        UI.ok = "Making new team links…"; UI.msg = ""; render();
        rekey(tm.id).then(function () { UI.ok = "New team links made. The old links are closed. Send the new editor or viewer link to each member who stays."; render(); }, fail);
        return;
      }
      if (t.closest("[data-tm-leave]")) {
        if (!confirm("Leave the team \"" + tm.name + "\" on this device? The workspace and its items stay here; they stop syncing with the team." + (tm.owner ? " You are the owner: the team goes on without you, and no one can make new team links." : ""))) return;
        leave(tm.id).then(function () { UI.view = "list"; UI.id = ""; UI.ok = "You left the team. The workspace stays on this device."; render(); });
      }
    });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) closeP(); });

    /* ---------- what the workspace panel and the Sync panel show ---------- */
    function wsHtml(ws) {
      var t = teamOfWs(ws);
      if (t) return '<div class="tmws" data-tm-ws><span><b>Team: ' + esc(t.name) + '</b> <i class="obs">' + esc(roleTxt(t)) + " · " + esc(t.call) + " · " + esc(t.closed ? "moved to new links" : stateTxt(t)) + "</i>" +
        (t.role === "v" ? '<i class="obs">Read-only for you: viewer link.</i>' : "") + '</span><button type="button" class="refresh" data-tm-open="' + esc(t.id) + '">Team</button></div>';
      return '<div class="tmws" data-tm-ws><span><b>Team</b> <i class="obs">Share this workspace with your team: everyone sees the same items, with who added each one.</i></span><button type="button" class="refresh" data-tm-share="' + esc(ws) + '">Share with a team</button></div>';
    }
    function tag(ws) { var t = teamOfWs(ws); return t ? "team " + t.name + (t.role === "v" ? " (viewer)" : "") : ""; }
    function syncHtml(inTeam) {
      var L = cfg().teams;
      return '<section class="tmsy" data-tm-sync>' + (inTeam ? "" : "<h3>Team workspaces</h3>") +
        (L.length ? "<ul>" + L.map(function (t) { return "<li><span><b>" + esc(t.name) + '</b> <i class="obs">' + esc(roleTxt(t)) + " · " + esc(wsName(t.ws) || "workspace deleted") + " · " + esc(t.closed ? "moved to new links" : stateTxt(t)) + '</i></span><button type="button" data-tm-open="' + esc(t.id) + '">Open</button></li>'; }).join("") + "</ul>"
          : '<p class="obs">No teams on this device. Share a workspace from My work &gt; Workspaces, or join with a link you were sent.</p>') +
        (allowed() ? '<div class="mvbtns"><button type="button" data-tm-paste-open>Join a team with a link or code</button></div>' : '<p class="obs">' + esc(UPGRADE) + "</p>") + "</section>";
    }

    var css = D.createElement("style");
    css.textContent = "#teamdlg{position:fixed;inset:0;z-index:100004;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
      "#teamdlg .cbox{max-width:600px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
      "#teamdlg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#teamdlg .chead h2{margin:0;font-size:18px;flex:1;overflow-wrap:anywhere}" +
      "#teamdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#teamdlg .obs{color:var(--muted)}#teamdlg h3{font-size:14px;margin:14px 0 4px}" +
      "#teamdlg .mvf{display:flex;flex-direction:column;gap:3px;margin:8px 0;font-weight:600}#teamdlg input:not([type=checkbox]){font:inherit;font-size:16px;font-weight:400;min-height:40px;padding:4px 8px;max-width:100%;box-sizing:border-box}" +
      "#teamdlg .mvbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}#teamdlg button{min-height:40px}#teamdlg .x{min-height:44px}" +
      "#teamdlg .mvmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}#teamdlg .mvok{border-left:3px solid #2f9e44;padding:2px 10px}" +
      "#teamdlg .mvwarn{border-left:3px solid #e8590c;padding:2px 10px}#teamdlg .mvlink{background:none;border:none;color:#1c7ed6;text-decoration:underline;cursor:pointer;font:inherit;padding:0}" +
      "#teamdlg .tmlink{display:flex;gap:6px;margin:4px 0 8px}#teamdlg .tmlink input{flex:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px}#teamdlg .tmlink button{flex:none}" +
      "#teamdlg .tmcap{display:flex;align-items:center;gap:8px;margin:6px 0}#teamdlg .tmbar{flex:1;height:8px;border-radius:4px;background:var(--surface2);overflow:hidden}#teamdlg .tmbar i{display:block;height:100%;background:#1c7ed6}" +
      "#teamdlg .tmchk{display:flex;gap:8px;align-items:center;margin:6px 0;min-height:40px}#teamdlg .mvnote summary{cursor:pointer;font-weight:600;padding:6px 0}" +
      "#teamdlg ul,.tmsy ul{list-style:none;margin:4px 0;padding:0}#teamdlg li,.tmsy li{display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--line-soft)}#teamdlg li>span,.tmsy li>span{flex:1;min-width:0;overflow-wrap:anywhere}" +
      "#teamdlg li i,.tmsy li i{font-style:normal;font-size:12px;display:block}.tmsy li button{min-height:38px}" +
      ".tmws{display:flex;align-items:center;gap:8px;margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px}.tmws>span{flex:1;min-width:0;overflow-wrap:anywhere}.tmws i{font-style:normal;font-size:12px;display:block}.tmws button{flex:none;min-height:38px}" +
      "#teambar{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:100001;display:flex;align-items:center;gap:8px;background:var(--ink);color:var(--surface);padding:6px 6px 6px 14px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:calc(100vw - 32px)}" +
      "#teambar button{min-height:36px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;padding:0 10px;cursor:pointer}#teambar .x{background:none;border:none;color:var(--surface);font-size:20px;min-width:36px}";
    D.head.appendChild(css);

    W.OSAP_TEAM = { open: openP, close: closeP, create: create, join: join, syncNow: syncTeam, syncAll: syncAll, rekey: rekey, leave: leave, list: function () { return cfg().teams.map(function (t) { return { id: t.id, name: t.name, role: t.role, owner: !!t.owner, ws: t.ws, call: t.call, closed: !!t.closed }; }); },
      status: function (id) { return { busy: !!busy[id], last: LAST[id] || null }; }, teamOf: function (ws) { var t = teamOfWs(ws); return t ? { id: t.id, name: t.name, role: t.role } : null; },
      link: function (id, kind) { var t = team(id), c = !t ? "" : kind === "e" ? (t.role === "e" ? t.code : "") : viewerCode(t.code); return c ? linkFor(base(), c) : ""; },
      wsHtml: wsHtml, tag: tag, syncHtml: function () { return syncHtml(false); }, allowed: allowed, core: core,
      /* the workspace side of a team sync, for team cases (assets/osap-cases.js): which stores are shared, a workspace's shared
         stores now, and writing a merged state back (the open workspace through the reload bar) */
      engine: { synced: synced, storesOf: storesOf, wsSig: wsSig, writeTeam: writeTeam, stampBy: stampBy, okUnits: okUnits, shareText: shareText, localText: localText, bar: bar, wsName: wsName, NBT: NBT, CAP: CAP } };
    start();
    /* a team link opened in this tab (kept by assets/osap-sync-boot.js): offer to join once the plan is known */
    var pend = sget(LINK);
    if (pend) {
      var show = function () { setTimeout(function () { openP("join", pend); }, 400); };
      if (W.OSAP_TIER && W.OSAP_TIER.ready && W.OSAP_TIER.ready.then) W.OSAP_TIER.ready.then(show, show); else show();
    }
  }

  return { core: core, boot: boot };
});
