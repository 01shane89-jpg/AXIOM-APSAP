/* AXIOM OSAP: carry saved work from the old address to the new one (Shane 2026-11-04: "I just lost all my saved places when it
   changed the address").
   Saved work lives in the browser's storage, and a browser keeps a separate store for each web address. Everything saved on
   the old address (01shane89-jpg.github.io/AXIOM-APSAP) is still on that device, but the old address now sends people to
   axiom-osap.netlify.app, which started empty. This file is the one-time hand-off between the two.
   - Old address: before it moves the page on, it collects the saved work (the same localStorage families Move to another
     device carries, every workspace, and the map points' photos), compresses it, and sends it to the new address in the
     part of the address after "#", which the browser never sends to any server. A large set goes in parts: the new address
     keeps each part and sends the page back for the next one. Nothing on the old address is changed or deleted; it only
     remembers which set the new address confirmed, so it does not send the same set again.
   - New address: checks the set against its SHA-256, keeps a copy of what was here before (IndexedDB "osap-carry", "before")
     and the set itself ("kept"), then merges the set in. Nothing is replaced wholesale: an item already here (same id, or the
     same map entry) stays as it is here, and an item from the old address that is not here is added. Workspaces of the same
     name are merged, others are added. Photos are added when this device does not have them. Then the page goes back to the
     old address once, to confirm, and opens here with a note of what came across.
   - The set is the user's own data but it arrives in an address, so it is handled as untrusted: only accepted when the page
     came from the old address (or the user says so), only the store families OSAP uses, sizes capped, and the features that
     show it escape it as they always do. Sign-in, lock, sync and team settings never travel.
   Loaded first in index.html's head, before anything reads the stores. On any other address it adds nothing.
   - A chain of old addresses (2026-11-05, the move to the company's own address, osap.axiom-inteligence-systems.com):
     github.io still hands on to axiom-osap.netlify.app, and once the app moves, axiom-osap.netlify.app is kept alive by a
     stand-in copy of the app (old-address/netlify.toml) whose index.html names where it hands on to (<meta name="osap-carry-to">,
     written by tools/netlify_build.mjs). That copy receives from github.io as before, then hands everything it holds on to the
     new address. Each old address in SENDERS has a tag (~n after the set; none means github.io, as sets were sent before), so
     the new address knows which address sent it, checks the page really came from there, and confirms back to it. The app
     itself (no meta) never sends anything, so this file can go live before the move.
   window.OSAP_CARRY {state, undo} in the browser; the merge core is exported for node (tests/carry.test.mjs). */
(function (G, factory) {
  var api = factory(G);
  if (typeof module === "object" && module.exports) module.exports = api.core;
  else if (G.document) api.boot();
})(typeof window !== "undefined" ? window : globalThis, function (W) {
  "use strict";
  var OLD_HOST = "01shane89-jpg.github.io", OLD = "https://01shane89-jpg.github.io/AXIOM-APSAP/", NEW = "https://axiom-osap.netlify.app/";
  var HOME = "https://osap.axiom-inteligence-systems.com/";
  /* the old addresses that hand saved work on (tag -> where they are); github.io hands on to NEW, the others to their page's
     osap-carry-to, which must be one of TARGETS */
  var SENDERS = { g: OLD, n: NEW }, TARGETS = [NEW, HOME];
  var PICK = /^(osap|asap|tsap|tfw|tw|tbw)[-.]/;
  /* never carried: this device's own state, sign-in, lock, sync and team settings, caches */
  var SKIP = ["osap-offline", "osap-offline-prev", "osap-loc", "osap-loc-go", "osap-boot", "osap-boot-t", "osap-tile-fail", "osap-ws-msg", "osap-ws-go", "osap-rt-link", "osap-ai",
    "osap-sync", "osap-sync-pending", "osap-team", "osap-team-pending", "osap-team-dev", "osap-vault", "osap-vault-away", "osap-move-msg", "osap-auth", "osap-tier-reload", "osap-newpw",
    "osap-lock-dev", "osap-lock-open", "osap-carry-done", "osap-carry-last"];
  var SKIP_PRE = /^(asap-xrecs-|osap-today-wx-|osap-carry)/;
  var SCOPED = ["osap-atak-pts", "osap-aoi", "osap-routes", "osap-route-cur", "osap-evac-plans", "osap-cp-pace", "osap-cp-power", "osap-epe-plans", "osap-epe-cur", "osap-epe-pkgs", "asap-watches",
    "asap-watch-hits", "asap-watch-seen", "osap-work", "osap-shapes", "osap-viewsheds", "osap-cp-checks", "osap-cp-traffic", "osap-cp-intf", "osap-cp-loadout", "osap-cp-chan", "osap-cp-comsec",
    "osap-cp-contacts", "osap-cp-sats", "osap-an-ent", "osap-an-links", "osap-an-auto-rej", "osap-places", "osap-rulers"]; /* assets/osap-ws.js KEYS */
  var AREA_ANY = /^asap-area-[a-z]{2,3}(-st)?$/;
  var REG = "osap-ws", DATA = "osap-ws-data-", MAX_WS = 30;
  var PART = 1000000, MAX_PARTS = 40, MAX_KEY = 120, MAX_STORE = 8 * 1048576, MAX_PHOTOS = 2000;

  /* ================= core: pure, tested in node ================= */
  function picked(k) { return typeof k === "string" && k.length <= MAX_KEY && PICK.test(k) && SKIP.indexOf(k) < 0 && !SKIP_PRE.test(k); }
  function scoped(k) { return SCOPED.indexOf(k) >= 0 || AREA_ANY.test(k); }
  function json(s) { try { return JSON.parse(s); } catch (e) { return undefined; } }
  function plain(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function idOf(x) { return !plain(x) ? null : typeof x.id === "string" && x.id ? x.id : typeof x.id === "number" && isFinite(x.id) ? "#" + x.id : null; }
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  /* two lists of items with ids: everything here, then each old item whose id is not here. A list whose items have no ids
     (a drawn area's corners, a plan's rows) is one value: this device's stays, and the old one is used only when this one is empty */
  function mergeList(here, old) {
    var withIds = function (a) { return a.every(function (x) { return idOf(x) != null; }); };
    if (!withIds(here) || !withIds(old)) return here.length || !old.length ? { v: here, added: 0 } : { v: old, added: 1 };
    var seen = Object.create(null), out = here.slice(), added = 0;
    here.forEach(function (x) { seen[idOf(x)] = 1; });
    old.forEach(function (x) { var i = idOf(x); if (!seen[i]) { seen[i] = 1; out.push(x); added++; } });
    return { v: out, added: added };
  }
  function mergeVal(here, old, depth) {
    if (Array.isArray(here) && Array.isArray(old)) return mergeList(here, old);
    if (plain(here) && plain(old) && depth < 3) {
      var out = {}, added = 0;
      Object.keys(here).forEach(function (k) { out[k] = here[k]; });
      Object.keys(old).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(out, k)) { out[k] = old[k]; added++; return; }
        var m = mergeVal(out[k], old[k], depth + 1); out[k] = m.v; added += m.added;
      });
      return { v: out, added: added };
    }
    return { v: here, added: 0 }; /* a plain value: this device's stays */
  }
  /* one store's text: here (this device, may be null) and old (from the old address). Returns the text to keep. */
  function mergeStore(here, old) {
    if (here == null) return { text: old, added: 1 };
    if (old == null || here === old) return { text: here, added: 0 };
    var h = json(here), o = json(old);
    if (h === undefined || o === undefined) return { text: here, added: 0 };
    var m = mergeVal(h, o, 0);
    return { text: m.added ? JSON.stringify(m.v) : here, added: m.added };
  }
  /* merge stores (key -> text) from the old address into get/set (this device: localStorage, or a workspace blob) */
  function mergeInto(src, get, set) {
    var n = 0;
    Object.keys(src).forEach(function (k) { var r = mergeStore(get(k), src[k]); if (r.added && r.text != null) { set(k, r.text); n++; } });
    return n;
  }
  function blobKeys(text) { var d = json(text); return plain(d) && plain(d.keys) ? d.keys : {}; }
  function okWs(w) { return plain(w) && typeof w.id === "string" && /^ws-[a-z0-9]{4,40}$/.test(w.id) && typeof w.name === "string"; }
  /* the whole merge. C: stores from the old address. ls: {get(k), set(k, v), keys()} for this device. Returns how many stores changed. */
  function mergeAll(C, ls) {
    var R = json(C[REG]), L = json(ls.get(REG)), changed = 0;
    var oldList = plain(R) && Array.isArray(R.list) ? R.list.filter(okWs) : [];
    var hereList = plain(L) && Array.isArray(L.list) ? L.list.filter(okWs) : [];
    /* stores outside workspaces (settings, plans), and everything when either side has no workspaces yet */
    var flat = {};
    Object.keys(C).forEach(function (k) {
      if (!picked(k) || typeof C[k] !== "string" || C[k].length > MAX_STORE) return;
      if (k === REG || k.indexOf(DATA) === 0) return;
      if (scoped(k) && oldList.length && hereList.length) return;
      flat[k] = C[k];
    });
    changed += mergeInto(flat, ls.get, ls.set);
    if (!oldList.length) return changed;
    if (!hereList.length) {
      /* nothing here has workspaces yet: the old register and its packed workspaces come across as they are */
      oldList.forEach(function (w) { var k = DATA + w.id; if (w.id !== R.active && typeof C[k] === "string" && ls.get(k) == null) { ls.set(k, C[k]); changed++; } });
      ls.set(REG, JSON.stringify({ v: 1, list: oldList.slice(0, MAX_WS), active: R.active, sig: "" })); changed++;
      return changed;
    }
    var regChanged = false;
    oldList.forEach(function (w) {
      var src = {};
      if (w.id === R.active) Object.keys(C).forEach(function (k) { if (scoped(k) && typeof C[k] === "string" && C[k].length <= MAX_STORE) src[k] = C[k]; });
      else src = blobKeys(C[DATA + w.id]);
      var t = null, nm = String(w.name).toLowerCase();
      hereList.forEach(function (x) { if (!t && String(x.name).toLowerCase() === nm) t = x; });
      if (t && t.id === L.active) { changed += mergeInto(src, ls.get, ls.set); return; }
      if (t) {
        var b = blobKeys(ls.get(DATA + t.id)), n = mergeInto(src, function (k) { return b[k] == null ? null : b[k]; }, function (k, v) { b[k] = v; });
        if (n) { ls.set(DATA + t.id, JSON.stringify({ v: 1, keys: b })); changed += n; t.updated = Date.now(); regChanged = true; }
        return;
      }
      if (hereList.length >= MAX_WS || !Object.keys(src).length) return;
      var id = w.id, taken = function (i) { return hereList.some(function (x) { return x.id === i; }); };
      while (taken(id)) id = "ws-" + Math.random().toString(36).slice(2, 12);
      ls.set(DATA + id, JSON.stringify({ v: 1, keys: src }));
      hereList.push({ id: id, name: w.name, created: w.created || Date.now(), updated: Date.now() });
      regChanged = true; changed++;
    });
    if (regChanged) { L.list = hereList; ls.set(REG, JSON.stringify(L)); }
    return changed;
  }
  function originOf(u) { var m = /^(https:\/\/[a-z0-9.-]+)(\/|$)/i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; }
  /* which old address this page is, and where it hands on to: {tag, at, to}, or null on the app itself. host: this page's
     hostname, own: its origin + "/", metaTo: its <meta name="osap-carry-to"> (empty when none) */
  function role(host, own, metaTo) {
    if (host === OLD_HOST || /\.github\.io$/.test(host)) return { tag: "g", at: OLD, to: NEW };
    if (!metaTo || TARGETS.indexOf(metaTo) < 0 || originOf(metaTo) === originOf(own)) return null;
    for (var k in SENDERS) if (k !== "g" && SENDERS[k] === own) return { tag: k, at: SENDERS[k], to: metaTo };
    return null;
  }
  function arrLen(s) { var v = json(s); return Array.isArray(v) ? v.length : 0; }
  /* what the set holds, in plain words (the open workspace's items, plus workspaces and photos) */
  function describe(C, photos) {
    var c = [[arrLen(C["osap-atak-pts"]), "map point", "map points"], [photos || 0, "photo", "photos"], [arrLen(C["osap-routes"]), "route", "routes"], [arrLen(C["osap-aoi"]), "NAI/TAI area", "NAI/TAI areas"],
      [arrLen(C["osap-shapes"]), "imported shape", "imported shapes"], [arrLen(C["asap-watches"]), "keyword watch", "keyword watches"]];
    var pl = json(C["osap-places"]); if (plain(pl) && Array.isArray(pl.folders)) c.push([pl.folders.length, "folder", "folders"]);
    var areas = 0; Object.keys(C).forEach(function (k) { if (AREA_ANY.test(k) && arrLen(C[k]) > 2) areas++; }); c.push([areas, "drawn area", "drawn areas"]);
    var o = c.filter(function (x) { return x[0] > 0; }).map(function (x) { return x[0] + " " + (x[0] === 1 ? x[1] : x[2]); });
    var r = json(C[REG]); if (plain(r) && Array.isArray(r.list) && r.list.length > 1) o.push(r.list.length + " workspaces");
    return o.length ? o.join(", ") : "your settings";
  }
  var core = { picked: picked, scoped: scoped, mergeStore: mergeStore, mergeAll: mergeAll, describe: describe, canon: canon, PART: PART, MAX_PARTS: MAX_PARTS, OLD: OLD, NEW: NEW, HOME: HOME, SENDERS: SENDERS, TARGETS: TARGETS, role: role, originOf: originOf };

  /* ================= browser ================= */
  function boot() {
    var D = W.document, host = location.hostname, H = location.hash || "", own = location.origin + "/";
    var mt = D.querySelector ? D.querySelector('meta[name="osap-carry-to"]') : null;
    var R = role(host, own, mt ? mt.getAttribute("content") || "" : ""), isOld = !!R;
    /* SELF: this old address; TO: where it hands on to */
    var SELF = R ? R.at : own, TO = R ? R.to : own;
    var m = /^#osap-carry=([0-9a-f]{64})\.(\d{1,2})\.(\d{1,2})\.([A-Za-z0-9_-]+)(?:~([a-z]))?$/.exec(H);
    var done = /^#osap-carried=([0-9a-f]{64})$/.exec(H);
    W.OSAP_CARRY = { state: "idle", undo: undo };
    if (!isOld && !m && !done) return;
    var te = new TextEncoder(), td = new TextDecoder();
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function hex(b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
    function sha(u8) { return W.crypto.subtle.digest("SHA-256", u8).then(hex); }
    function b64u(u) { var s = ""; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
    function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = atob(s), u = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; }
    function zip(u8, how) { return new Response(new Blob([u8]).stream().pipeThrough(how)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
    function idb(name, setup) {
      return new Promise(function (res, rej) {
        if (!W.indexedDB) { rej(new Error("no IndexedDB")); return; }
        var r = W.indexedDB.open(name, 1);
        r.onupgradeneeded = function () { setup(r.result); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.onblocked = function () { rej(new Error("blocked")); };
      });
    }
    function tx(dbp, store, mode, fn) {
      return dbp.then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction(store, mode), out = fn(t.objectStore(store));
          t.oncomplete = function () { d.close(); res(out && "result" in out ? out.result : out); };
          t.onerror = t.onabort = function () { d.close(); rej(t.error); };
        });
      });
    }
    function photoDb() { return idb("osap-points", function (d) { d.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid"); }); }
    function carryDb() { return idb("osap-carry", function (d) { d.createObjectStore("kv"); }); }
    function vaultLocked() { var v = json(lsGet("osap-vault")); return plain(v) && v.state === "locked"; }
    /* a plain screen while the hand-off runs: the rest of the page is not loaded, so nothing reads or writes the stores.
       The rest of the page is turned into hidden text first (<plaintext>), then loading stops: window.stop() alone, in the
       head, leaves Chromium with a page it never paints. */
    var halted = false;
    function halt() {
      if (halted) return; halted = true;
      if (D.readyState === "loading") try { D.write('<plaintext style="display:none">'); } catch (e) {}
      try { W.stop(); } catch (e) {}
    }
    function screen(msg, buttons) {
      halt();
      var b = D.body || D.documentElement.appendChild(D.createElement("body"));
      b.setAttribute("style", "margin:0;font:16px/1.45 system-ui,-apple-system,sans-serif;background:#0f2433;color:#eef4f8;display:flex;min-height:100vh;align-items:center;justify-content:center");
      b.innerHTML = '<div style="max-width:30em;padding:24px;text-align:center"><p style="font-size:20px;font-weight:600;margin:0 0 10px">OSAP</p><p id="carry-msg" style="margin:0 0 16px"></p><div id="carry-btns"></div></div>';
      D.getElementById("carry-msg").textContent = msg;
      (buttons || []).forEach(function (x) {
        var e = D.createElement("button"); e.textContent = x[0]; e.onclick = x[1];
        e.setAttribute("style", "font:inherit;margin:4px;padding:10px 16px;border-radius:8px;border:1px solid #8fb3c9;background:" + (x[2] ? "#2a6f97" : "transparent") + ";color:#fff");
        D.getElementById("carry-btns").appendChild(e);
      });
    }
    function go(u) { location.replace(u); }
    /* the old address's own move (as index.html does it), without this file's markers */
    function plainMove() {
      var q = ""; try { var u = new URLSearchParams(location.search); u.delete("osap-stay"); u.delete("osap-unlock"); if (u.get("from") === "pages") u.delete("from"); /* added once below */ q = String(u); } catch (e) {}
      go(TO + (q ? "?" + q + "&" : "?") + "from=pages" + (/^#osap-/.test(H) ? "" : H));
    }

    /* ---------- old address: send ---------- */
    function collect() {
      var keys = {};
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (picked(k)) { var v = localStorage.getItem(k); if (v != null && v.length <= MAX_STORE) keys[k] = v; } } } catch (e) {}
      var sorted = {}; Object.keys(keys).sort().forEach(function (k) { sorted[k] = keys[k]; });
      return tx(photoDb(), "photos", "readonly", function (s) { return s.getAll(); }).then(null, function () { return []; }).then(function (P) {
        var photos = (P || []).filter(function (r) { return r && typeof r.id === "string" && typeof r.pid === "string" && r.buf; }).slice(0, MAX_PHOTOS).map(function (r) {
          return { id: r.id, pid: r.pid, type: r.type, name: r.name, sha256: r.sha256 || "", camera: r.camera || "", file: r.file, added: r.added, b: b64u(new Uint8Array(r.buf)) };
        });
        return { schema: "osap-carry/1", stores: sorted, photos: photos };
      });
    }
    function send(part) {
      screen("Bringing your saved places and work to OSAP's new address…");
      return collect().then(function (set) {
        if (!Object.keys(set.stores).length && !set.photos.length) { plainMove(); return; }
        var text = te.encode(JSON.stringify(set));
        return sha(text).then(function (id) {
          if (lsGet("osap-carry-done") === id && part == null) { plainMove(); return; }
          return zip(text, new CompressionStream("gzip")).then(function (z) {
            var s = b64u(z), n = Math.ceil(s.length / PART);
            if (n > MAX_PARTS) {
              /* too big to carry in the address: leave the photos behind and say so */
              if (set.photos.length) {
                set.photos = []; set.left = 1; text = te.encode(JSON.stringify(set));
                return sha(text).then(function (id2) { lsSet("osap-carry-alias", id + " " + id2); return zip(text, new CompressionStream("gzip")).then(function (z2) { return [id2, b64u(z2)]; }); });
              }
              throw new Error("too big");
            }
            return [id, s];
          }).then(function (r) {
            if (!r) return;
            var id2 = r[0], s2 = r[1], n2 = Math.ceil(s2.length / PART), i = part && part.id === id2 ? part.i : 0;
            if (i >= n2) i = 0;
            /* github.io's sets carry no tag, as before, so an app not yet updated still takes them */
            go(TO + "#osap-carry=" + id2 + "." + i + "." + n2 + "." + s2.slice(i * PART, (i + 1) * PART) + (R.tag === "g" ? "" : "~" + R.tag));
          });
        });
      }).then(null, function () {
        screen("OSAP could not bring your saved work across automatically. It is still safe here. Use Settings > Move to another device on this address to make a backup file, then open it on the new address.",
          [["Stay on the old address", function () { go(SELF + "?osap-stay=1"); }, true], ["Go to the new address", plainMove]]);
      });
    }
    /* a set arriving on an old address that is itself a step in the chain (the stand-in netlify.app copy, from github.io):
       taken in first, as on the app; once confirmed, github.io comes back here and this address hands everything on */
    if (isOld && !(m && SENDERS[m[5] || "g"] && SENDERS[m[5] || "g"] !== SELF)) {
      W.OSAP_CARRY.state = "old";
      if (!(W.crypto && W.crypto.subtle && W.CompressionStream && W.TextEncoder)) {
        /* old browser: on github.io index.html's own move runs; elsewhere the plain move, so the user still gets in */
        if (R.tag !== "g") plainMove();
        return;
      }
      W.OSAP_CARRY.handled = true; /* index.html and assets/osap-tier.js leave the move to this file */
      /* ?osap-stay=1: open the app here after all (chosen on the screen below when the hand-off failed, to make a backup file) */
      if (/[?&]osap-stay=1(&|$)/.test(location.search)) { W.OSAP_CARRY.state = "stay"; return; }
      var ok = /^#osap-carry-ok=([0-9a-f]{64})$/.exec(H), nx = /^#osap-carry-next=([0-9a-f]{64})\.(\d{1,2})$/.exec(H);
      /* a locked saved-work vault can only open here (its passkey belongs to this address): open the app to unlock first */
      if (vaultLocked()) {
        /* ?osap-unlock=1: the app opens here on its lock screen; once unlocked it reloads and the hand-off below runs */
        if (/[?&]osap-unlock=1(&|$)/.test(location.search)) { W.OSAP_CARRY.state = "stay"; return; }
        W.OSAP_CARRY.state = "locked";
        screen("Your saved work on this old address is locked. Unlock it here first; OSAP then brings it to the new address.",
          [["Unlock here", function () { go(SELF + "?osap-unlock=1"); }, true], ["Go to the new address", plainMove]]);
        return;
      }
      if (ok) {
        var al = (lsGet("osap-carry-alias") || "").split(" ");
        W.OSAP_CARRY.state = "confirmed"; lsSet("osap-carry-done", al[1] === ok[1] ? al[0] : ok[1]); screen("Done. Opening OSAP…"); go(TO + "?from=pages#osap-carried=" + ok[1]); return; }
      W.OSAP_CARRY.state = "sending";
      send(nx ? { id: nx[1], i: +nx[2] } : null);
      return;
    }

    /* ---------- new address: receive ---------- */
    if (done) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      var last = json(lsGet("osap-carry-last"));
      if (plain(last) && last.id === done[1]) note("Brought across from OSAP's old address: " + last.what + ". The old address still has its copy.");
      return;
    }
    W.OSAP_CARRY.state = "receiving";
    var id = m[1], i = +m[2], n = +m[3], data = m[4], FROM = SENDERS[m[5] || "g"];
    if (!(FROM && FROM !== SELF && n >= 1 && n <= MAX_PARTS && i < n && data.length <= PART)) { clean(); return; }
    clean();
    /* only the page that address sent counts as "from the old address" (the browser gives its origin as the referrer) */
    var fromOld = !!originOf(D.referrer) && originOf(D.referrer) === originOf(FROM);
    var prev = json(lsGet("osap-carry-last"));
    if (plain(prev) && prev.id === id) { screen("Already brought across. Opening OSAP…"); go(FROM + "#osap-carry-ok=" + id); return; }
    if (vaultLocked()) { screen("OSAP is locked on this device. Unlock it, then open the old address again to bring your saved work across.", [["Open OSAP", function () { go(own); }, true]]); return; }
    var said = ""; try { said = sessionStorage.getItem("osap-carry-yes") || ""; } catch (e) {}
    if (fromOld || said === id) receive();
    else screen("Bring saved places and work from OSAP's old address into this device? Only do this if you just came from the old OSAP address.",
      [["Bring them in", function () { try { sessionStorage.setItem("osap-carry-yes", id); } catch (e) {} receive(); }, true], ["No", function () { go(own); }]]);

    function clean() { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }
    function receive() {
      screen("Bringing your saved places and work across from OSAP's old address" + (n > 1 ? " (part " + (i + 1) + " of " + n + ")" : "") + "…");
      tx(carryDb(), "kv", "readwrite", function (s) { s.put(data, "part/" + id + "/" + i); }).then(function () {
        return tx(carryDb(), "kv", "readonly", function (s) { return s.getAllKeys(); });
      }).then(function (keys) {
        var have = {}; (keys || []).forEach(function (k) { var p = /^part\/([0-9a-f]{64})\/(\d+)$/.exec(k); if (p && p[1] === id) have[+p[2]] = 1; });
        for (var j = 0; j < n; j++) if (!have[j]) { go(FROM + "#osap-carry-next=" + id + "." + j); return null; }
        return tx(carryDb(), "kv", "readonly", function (s) { var r = []; for (var j = 0; j < n; j++) r.push(s.get("part/" + id + "/" + j)); return { get result() { return r.map(function (q) { return q.result; }); } }; }).then(finish);
      }).then(null, failed);
    }
    function finish(parts) {
      return zip(unb64u(parts.join("")), new DecompressionStream("gzip")).then(function (text) {
        return sha(text).then(function (h) {
          if (h !== id) throw new Error("damaged");
          var set = json(td.decode(text));
          if (!plain(set) || set.schema !== "osap-carry/1" || !plain(set.stores)) throw new Error("damaged");
          var C = {}; Object.keys(set.stores).forEach(function (k) { if (picked(k) && typeof set.stores[k] === "string") C[k] = set.stores[k]; });
          var photos = Array.isArray(set.photos) ? set.photos.slice(0, MAX_PHOTOS) : [];
          /* keep what is here now, and the set itself, before changing anything */
          var before = {}; try { for (var q = 0; q < localStorage.length; q++) { var k = localStorage.key(q); if (picked(k) || k === REG) before[k] = localStorage.getItem(k); } } catch (e) {}
          return tx(carryDb(), "kv", "readwrite", function (s) { s.put({ at: Date.now(), id: id, stores: before }, "before"); s.put({ at: Date.now(), id: id, text: td.decode(text) }, "kept"); }).then(function () {
            var full = false;
            mergeAll(C, { get: lsGet, set: function (k, v) { if (!lsSet(k, v)) full = true; } });
            if (full) throw new Error("full");
            return addPhotos(photos);
          }).then(function (np) {
            lsSet("osap-carry-last", JSON.stringify({ id: id, at: Date.now(), what: describe(C, photos.length) + (set.left ? " (photos were too big to bring and are still on the old address)" : ""), photos: np }));
            return tx(carryDb(), "kv", "readwrite", function (s) { for (var j = 0; j < n; j++) s.delete("part/" + id + "/" + j); }).then(null, function () {});
          }).then(function () { W.OSAP_CARRY.state = "done"; go(FROM + "#osap-carry-ok=" + id); });
        });
      });
    }
    function addPhotos(list) {
      if (!list.length) return Promise.resolve(0);
      return tx(photoDb(), "photos", "readonly", function (s) { return s.getAllKeys(); }).then(function (have) {
        var h = {}; (have || []).forEach(function (k) { h[k] = 1; });
        var add = list.filter(function (p) { return plain(p) && typeof p.id === "string" && p.id.length <= 80 && typeof p.pid === "string" && /^image\/[a-z0-9.+-]+$/i.test(p.type || "") && typeof p.b === "string" && !h[p.id]; });
        return Promise.all(add.map(function (p) { var u = unb64u(p.b); return (p.sha256 ? sha(u) : Promise.resolve("")).then(function (x) { return x === (p.sha256 || "") ? { p: p, u: u } : null; }); })).then(function (ok) {
          ok = ok.filter(Boolean);
          return tx(photoDb(), "photos", "readwrite", function (s) {
            ok.forEach(function (x) { var p = x.p; s.put({ id: p.id, pid: p.pid, buf: x.u.buffer, type: p.type, size: x.u.length, name: p.name, sha256: p.sha256, camera: p.camera || "", file: p.file, added: +p.added || Date.now() }); });
          }).then(function () { return ok.length; });
        });
      });
    }
    function failed(e) {
      W.OSAP_CARRY.state = "failed";
      screen((e && e.message === "full" ? "This device's storage is full, so " : "") + "OSAP could not bring your saved work across. Nothing was lost: it is still on the old address. Try again, or use Settings > Move to another device there.",
        [["Try again", function () { go(FROM); }, true], ["Open OSAP", function () { go(own); }]]);
    }
  }
  /* a note at the top of the page once it has loaded */
  function note(t) {
    var D = W.document;
    function show() {
      var e = D.createElement("div"); e.id = "carry-note"; e.setAttribute("role", "status"); e.textContent = t;
      e.setAttribute("style", "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483000;max-width:min(560px,calc(100% - 32px));background:#12324a;color:#fff;padding:10px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);font:14px/1.4 system-ui,-apple-system,sans-serif");
      e.onclick = function () { e.remove(); };
      D.body.appendChild(e); setTimeout(function () { if (e.parentNode) e.remove(); }, 15000);
    }
    if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", show); else show();
  }
  /* put this device's stores back as they were before the last hand-off (kept in IndexedDB "osap-carry", "before") */
  function undo() {
    return new Promise(function (res, rej) {
      var r = W.indexedDB.open("osap-carry", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onerror = function () { rej(r.error); };
      r.onsuccess = function () {
        var d = r.result, t = d.transaction("kv", "readonly"), g = t.objectStore("kv").get("before");
        t.oncomplete = function () {
          d.close(); var b = g.result; if (!b || !plain(b.stores)) { res(false); return; }
          try {
            var now = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (picked(k) || k === REG) now.push(k); }
            now.forEach(function (k) { if (!(k in b.stores)) localStorage.removeItem(k); });
            Object.keys(b.stores).forEach(function (k) { localStorage.setItem(k, b.stores[k]); });
            localStorage.removeItem("osap-carry-last");
          } catch (e) { rej(e); return; }
          res(true);
        };
      };
    });
  }
  return { core: core, boot: boot };
});
