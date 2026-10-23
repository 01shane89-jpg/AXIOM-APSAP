/* AXIOM OSAP: lock my saved work (Shane 2026-10-20, for users who must stay digitally secure: "Do all of it").
   Settings > Lock my saved work. Once set up, the analyst's saved work is kept encrypted on this device whenever OSAP is
   locked, so a lost or seized phone or laptop shows nothing: map points and their photos, drawn areas, routes, watches,
   workspaces, plans, notes, the sync code and the team workspace. Unlocking needs Face ID / Touch ID / Windows Hello (a
   passkey with the WebAuthn PRF extension) or, where the device cannot give that, a passphrase.
   How it works, with no server and no account:
   - Set up makes a random 256-bit data key. It is kept wrapped (AES-GCM) by a key from the passkey's PRF secret (HKDF) or
     from the passphrase (PBKDF2-SHA-256, 600 000 rounds), in localStorage "osap-vault" with the passkey id or the salt.
   - While unlocked, the data key is kept in IndexedDB "osap-vault" as a CryptoKey that cannot be exported, so locking (by
     hand, or automatically after the chosen time away) needs no Face ID; unlocking does.
   - Lock: every saved-work key in localStorage (the same families Move to another device carries, plus the sync and team
     settings) is first moved aside in one synchronous pass under "~v~<key>", so no feature can read it from then on; then
     it is encrypted into IndexedDB "osap-vault" (box "ls"), and so are the IndexedDB databases that hold saved work
     (DBS: photos, sync and team copies; their records with any binary parts kept binary), and only once each encrypted copy
     is written and read back is the plain copy removed. The page's saved copies of data files and map tiles are cleared too
     (they show what was looked at); maps saved for offline use are kept. Then the data key is dropped and the page reloads
     onto the lock screen. A lock cut short (the page closed half way) carries on at the next open, so nothing is lost.
   - Unlock: Face ID or the passphrase unwraps the data key; the localStorage keys are put back as they were (replacing what
     the app wrote while locked), each database is rebuilt with its stores and indexes, and only then are the encrypted
     copies removed. A failed unlock changes nothing.
   - Locked, the app opens empty behind a lock screen that cannot be closed; Erase this device stays reachable from it.
   What it does not cover: the account sign-in (OSAP's server checks it anyway), device-only settings (map colours, units,
   protected mode), maps saved for offline use, and files already exported or shared. The lock screen says so in Settings.
   Loaded first among the page's scripts (index.html, before osap-sync-boot.js) so a locked device has no saved work in
   plain storage by the time any feature reads it.
   window.OSAP_VAULT {state, setup, lock, unlock, off, setAuto, open, close, _keys (tests)} */
(function () {
  "use strict";
  var W = window, D = document;
  var CFG = "osap-vault", AWAY = "osap-vault-away", STASH = "~v~", DB = "osap-vault";
  /* saved work in localStorage: the families Move to another device carries, minus what belongs to this device only */
  var PICK = /^(osap|asap|tsap|tfw|tw|tbw)[-.]/;
  var KEEP = ["osap-vault", "osap-vault-away", "osap-auth", "osap-protect", "osap-offline", "osap-offline-prev", "osap-boot", "osap-boot-t",
    "osap-tile-fail", "osap-tier-reload", "osap-lock-dev", "osap-lock-open", "osap-home", "osap-ai"];
  var KEEP_PRE = /^(asap-xrecs-|osap-today-wx-)/;
  /* IndexedDB databases that hold saved work: photos, the sync and team copies, the import undo copy */
  var DBS = ["osap-points", "osap-sync", "osap-team", "osap-move"];
  /* the page's saved copies that show what was looked at (sw.js): data files and map tiles; "osap-offline" is kept */
  var CACHE_DROP = /^(asap-data|asap-tiles)/;
  var AUTO = [[0, "Only when I lock it"], [1, "As soon as I leave OSAP"], [15, "After 15 minutes away"], [60, "After 1 hour away"], [720, "After 12 hours away"]];
  var SUB = W.crypto && W.crypto.subtle, te = new TextEncoder(), td = new TextDecoder();

  function picked(k) { return typeof k === "string" && PICK.test(k) && KEEP.indexOf(k) < 0 && !KEEP_PRE.test(k); }
  function cfg() { try { var c = JSON.parse(localStorage.getItem(CFG) || "null"); return c && c.v === 1 ? c : null; } catch (e) { return null; } }
  function saveCfg(c) { localStorage.setItem(CFG, JSON.stringify(c)); }
  function stashed() { var o = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(STASH) === 0) o.push(k); } } catch (e) {} return o; }
  function plainKeys() { var o = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (picked(k)) o.push(k); } } catch (e) {} return o; }
  function b64u(b) { b = new Uint8Array(b); var s = ""; for (var i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = atob(s), b = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) b[i] = r.charCodeAt(i); return b; }
  function rnd(n) { var b = new Uint8Array(n); W.crypto.getRandomValues(b); return b; }
  function fail(m) { var e = new Error(m); e.plain = true; return e; }

  /* ---------- the vault's own IndexedDB: "k" holds the data key while unlocked, "box" the encrypted copies ---------- */
  function idb(name, ver, up) {
    return new Promise(function (ok, no) {
      var r = ver ? W.indexedDB.open(name, ver) : W.indexedDB.open(name);
      if (up) r.onupgradeneeded = function (e) { up(r.result, e); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); };
      r.onblocked = function () { no(fail("Close OSAP in the browser's other tabs, then try again.")); };
    });
  }
  function vdb() { return idb(DB, 1, function (d) { if (!d.objectStoreNames.contains("k")) d.createObjectStore("k"); if (!d.objectStoreNames.contains("box")) d.createObjectStore("box"); }); }
  function run(d, store, mode, fn) {
    return new Promise(function (ok, no) {
      var t = d.transaction(store, mode), out; t.oncomplete = function () { ok(out); }; t.onerror = t.onabort = function () { no(t.error || fail("storage")); };
      var r = fn(t.objectStore(store)); if (r && "onsuccess" in r) r.onsuccess = function () { out = r.result; };
    });
  }
  function vget(store, k) { return vdb().then(function (d) { return run(d, store, "readonly", function (s) { return s.get(k); }).then(function (v) { d.close(); return v; }); }); }
  function vput(store, k, v) { return vdb().then(function (d) { return run(d, store, "readwrite", function (s) { s.put(v, k); }).then(function () { d.close(); }); }); }
  function vdel(store, k) { return vdb().then(function (d) { return run(d, store, "readwrite", function (s) { if (k == null) s.clear(); else s.delete(k); }).then(function () { d.close(); }); }); }
  function vkeys(store) { return vdb().then(function (d) { return run(d, store, "readonly", function (s) { return s.getAllKeys(); }).then(function (v) { d.close(); return v || []; }); }); }

  /* ---------- keys ---------- */
  var PRF_SALT = "AXIOM OSAP saved work v1";
  function kekFromPrf(prf) {
    return SUB.importKey("raw", prf, "HKDF", false, ["deriveKey"]).then(function (k) {
      return SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("osap-vault-wrap"), info: te.encode("v1") }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function kekFromPass(pass, salt) {
    return SUB.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (k) {
      return SUB.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: 600000 }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function prf(credId, create) {
    return SUB.digest("SHA-256", te.encode(PRF_SALT)).then(function (salt) {
      if (create) return navigator.credentials.create({ publicKey: {
        rp: { name: "AXIOM OSAP", id: location.hostname }, user: { id: rnd(16), name: "OSAP saved work", displayName: "OSAP saved work" },
        challenge: rnd(32), timeout: 60000, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
        extensions: { prf: { eval: { first: salt } } } } }).then(function (c) {
          var r = c && c.getClientExtensionResults ? c.getClientExtensionResults() : {};
          if (!r.prf || r.prf.enabled === false) throw fail("This device's passkeys cannot give the secret the lock needs. Use a passphrase instead.");
          var id = b64u(c.rawId);
          return r.prf.results && r.prf.results.first ? { id: id, secret: r.prf.results.first } : prf(id).then(function (x) { return { id: id, secret: x.secret }; });
        });
      return navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, userVerification: "required", timeout: 60000,
        allowCredentials: [{ type: "public-key", id: unb64u(credId) }], extensions: { prf: { eval: { first: salt } } } } }).then(function (a) {
          var r = a && a.getClientExtensionResults ? a.getClientExtensionResults() : {};
          var f = r && r.prf && r.prf.results && r.prf.results.first;
          if (!f) throw fail("Face ID did not give the key. Try again.");
          return { id: credId, secret: f };
        });
    });
  }
  function canPasskey() {
    if (!SUB || !W.PublicKeyCredential || !navigator.credentials || !W.isSecureContext) return Promise.resolve(false);
    var p = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    return p ? p.call(PublicKeyCredential).catch(function () { return false; }) : Promise.resolve(false);
  }
  function seal(key, bytes) { var iv = rnd(12); return SUB.encrypt({ name: "AES-GCM", iv: iv }, key, bytes).then(function (ct) { return { iv: iv, ct: ct }; }); }
  function open(key, box) { return SUB.decrypt({ name: "AES-GCM", iv: box.iv }, key, box.ct); }
  /* the data key, from the wrapped copy in the settings, with the key-encrypting key */
  function unwrapDk(c, kek) {
    return SUB.decrypt({ name: "AES-GCM", iv: unb64u(c.iv) }, kek, unb64u(c.wrapped)).then(function (raw) {
      return SUB.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }, function () { throw fail(c.kind === "pass" ? "That passphrase is not the one this lock was set up with." : "This passkey does not open the lock."); });
  }

  /* ---------- IndexedDB databases <-> one encrypted record each (binary parts kept binary) ---------- */
  function flatten(v, bufs) {
    if (v instanceof ArrayBuffer) { bufs.push(v); return { $b: bufs.length - 1 }; }
    if (ArrayBuffer.isView(v)) { bufs.push(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)); return { $b: bufs.length - 1, $t: v.constructor.name }; }
    if (v instanceof Date) return { $d: v.getTime() };
    if (typeof Blob !== "undefined" && v instanceof Blob) throw fail("blob");
    if (v && typeof v === "object") {
      if (typeof CryptoKey !== "undefined" && v instanceof CryptoKey) throw fail("A saved key here cannot be locked.");
      if (Array.isArray(v)) return v.map(function (x) { return flatten(x, bufs); });
      var o = {}; Object.keys(v).forEach(function (k) { o[k === "$b" || k === "$d" || k === "$o" ? "$o" + k : k] = flatten(v[k], bufs); }); return o;
    }
    return v;
  }
  function inflate(v, bufs) {
    if (Array.isArray(v)) return v.map(function (x) { return inflate(x, bufs); });
    if (v && typeof v === "object") {
      if ("$b" in v) { var b = bufs[v.$b]; return v.$t && W[v.$t] ? new W[v.$t](b) : b; }
      if ("$d" in v) return new Date(v.$d);
      var o = {}; Object.keys(v).forEach(function (k) { o[k.indexOf("$o$") === 0 ? k.slice(2) : k] = inflate(v[k], bufs); }); return o;
    }
    return v;
  }
  function dbNames() {
    if (!W.indexedDB || !W.indexedDB.databases) return Promise.resolve(null);
    return W.indexedDB.databases().then(function (a) { return a.map(function (x) { return x.name; }); }, function () { return null; });
  }
  function dump(name) {
    return idb(name).then(function (d) {
      var stores = Array.prototype.slice.call(d.objectStoreNames), out = { name: name, version: d.version, stores: [] };
      return stores.reduce(function (p, sn) {
        return p.then(function () {
          return new Promise(function (ok, no) {
            var t = d.transaction(sn, "readonly"), s = t.objectStore(sn), rec = { name: sn, keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes: [], rows: [] };
            Array.prototype.forEach.call(s.indexNames, function (n) { var ix = s.index(n); rec.indexes.push({ name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry }); });
            var c = s.openCursor(); c.onsuccess = function () { var cur = c.result; if (cur) { rec.rows.push([s.keyPath == null ? cur.key : null, cur.value]); cur.continue(); } };
            t.oncomplete = function () { out.stores.push(rec); ok(); }; t.onerror = t.onabort = function () { no(t.error); };
          });
        });
      }, Promise.resolve()).then(function () { d.close(); return out; }, function (e) { d.close(); throw e; });
    });
  }
  function delDb(name) { return new Promise(function (ok, no) { var r = W.indexedDB.deleteDatabase(name); r.onsuccess = function () { ok(); }; r.onerror = function () { no(r.error); }; r.onblocked = function () { ok(); }; }); }
  function restore(snap) {
    /* the database may have been made again (empty) by the app while locked: add any missing store, then put every record back.
       One that is not there is made at its own version, so the app's next open of it (at that version) finds it as it left it. */
    return dbNames().then(function (have) {
      if (have && have.indexOf(snap.name) < 0) return snap.version;
      return idb(snap.name).then(function (d) {
        var missing = snap.stores.some(function (s) { return !d.objectStoreNames.contains(s.name); }), v = d.version + (missing ? 1 : 0);
        d.close(); return v;
      });
    }).then(function (v) {
      return idb(snap.name, v, function (db, e) {
        var tx = e.target.transaction;
        snap.stores.forEach(function (s) {
          var os = db.objectStoreNames.contains(s.name) ? tx.objectStore(s.name) : db.createObjectStore(s.name, s.keyPath == null ? { autoIncrement: s.autoIncrement } : { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
          s.indexes.forEach(function (ix) { if (!os.indexNames.contains(ix.name)) os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry }); });
        });
      });
    }).then(function (d) {
      return snap.stores.reduce(function (p, s) {
        return p.then(function () { return run(d, s.name, "readwrite", function (os) { os.clear(); s.rows.forEach(function (r) { if (r[0] == null) os.put(r[1]); else os.put(r[1], r[0]); }); }); });
      }, Promise.resolve()).then(function () { d.close(); }, function (e) { d.close(); throw e; });
    });
  }
  function sealDb(key, snap) {
    var bufs = [], json = JSON.stringify(flatten(snap, bufs));
    return seal(key, te.encode(json)).then(function (j) {
      return Promise.all(bufs.map(function (b) { return seal(key, b); })).then(function (bs) { return { json: j, bufs: bs }; });
    });
  }
  function openDb(key, rec) {
    return open(key, rec.json).then(function (j) {
      return Promise.all(rec.bufs.map(function (b) { return open(key, b); })).then(function (bufs) { return inflate(JSON.parse(td.decode(j)), bufs); });
    });
  }

  /* ---------- lock ---------- */
  /* step 1, synchronous: nothing a feature reads from here on holds saved work */
  function moveAside() {
    plainKeys().forEach(function (k) { var v = localStorage.getItem(k); if (v == null) return; localStorage.setItem(STASH + k, v); localStorage.removeItem(k); });
  }
  var locking = null;
  function finishLock() {
    if (locking) return locking;
    locking = vget("k", "dk").then(function (dk) {
      if (!dk) throw fail("This device no longer holds the key to finish locking. Unlock first.");
      var keys = stashed(), obj = {};
      /* what was set aside earlier and already sealed stays sealed: merge, newest wins */
      return vget("box", "ls").then(function (old) { return old ? open(dk, old).then(function (b) { obj = JSON.parse(td.decode(b)); }) : null; }).then(function () {
        keys.forEach(function (k) { obj[k.slice(STASH.length)] = localStorage.getItem(k); });
        return seal(dk, te.encode(JSON.stringify(obj)));
      }).then(function (box) { return vput("box", "ls", box).then(function () { return vget("box", "ls"); }); }).then(function (back) {
        return open(dk, back).then(function () { keys.forEach(function (k) { localStorage.removeItem(k); }); });
      }).then(dbNames).then(function (have) {
        var list = DBS.filter(function (n) { return have && have.indexOf(n) >= 0; });
        return list.reduce(function (p, n) {
          return p.then(function () {
            return dump(n).then(function (snap) { return sealDb(dk, snap); }).then(function (rec) {
              return vput("box", "db:" + n, rec).then(function () { return vget("box", "db:" + n); }).then(function (back) { return openDb(dk, back); });
            }).then(function () { return delDb(n); });
          });
        }, Promise.resolve());
      }).then(function () {
        return W.caches ? W.caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return CACHE_DROP.test(k); }).map(function (k) { return W.caches.delete(k); })); }).catch(function () {}) : null;
      }).then(function () {
        var c = cfg(); if (c) { c.state = "locked"; c.at = Date.now(); saveCfg(c); }
        return vdel("k", "dk");
      });
    });
    locking.then(function () { locking = null; }, function () { locking = null; });
    return locking;
  }
  function lock(opts) {
    var c = cfg(); if (!c) return Promise.reject(fail("Set up the lock first."));
    moveAside();
    c.state = "locking"; saveCfg(c);
    showScreen("Locking…");
    return finishLock().then(function () { if (!(opts && opts.stay)) location.reload(); return true; }, function (e) { showScreen(e.message || "Could not lock."); throw e; });
  }

  /* ---------- unlock ---------- */
  function unlock(pass) {
    var c = cfg(); if (!c) return Promise.reject(fail("There is no lock on this device."));
    var kek = c.kind === "pass" ? (pass ? kekFromPass(pass, unb64u(c.salt)) : Promise.reject(fail("Type the passphrase."))) : prf(c.cred).then(function (x) { return kekFromPrf(x.secret); });
    return kek.then(function (k) { return unwrapDk(c, k); }).then(function (dk) {
      return vget("box", "ls").then(function (box) { return box ? open(dk, box).then(function (b) { return JSON.parse(td.decode(b)); }) : {}; }).then(function (obj) {
        return vkeys("box").then(function (ks) {
          var dbs = ks.filter(function (k) { return String(k).indexOf("db:") === 0; });
          return Promise.all(dbs.map(function (k) { return vget("box", k).then(function (rec) { return openDb(dk, rec); }); })).then(function (snaps) {
            /* everything decrypted before anything is written: a wrong key or a damaged copy changes nothing */
            plainKeys().forEach(function (k) { localStorage.removeItem(k); });
            stashed().forEach(function (k) { if (!(k.slice(STASH.length) in obj)) obj[k.slice(STASH.length)] = localStorage.getItem(k); localStorage.removeItem(k); });
            Object.keys(obj).forEach(function (k) { if (typeof obj[k] === "string") localStorage.setItem(k, obj[k]); });
            return snaps.reduce(function (p, s) { return p.then(function () { return restore(s); }); }, Promise.resolve());
          });
        });
      }).then(function () { return vput("k", "dk", dk); }).then(function () { return vdel("box"); }).then(function () {
        var cc = cfg(); cc.state = "open"; saveCfg(cc); markSeen();
      });
    });
  }

  /* ---------- set up, turn off, auto-lock ---------- */
  function setup(o) {
    o = o || {};
    if (cfg()) return Promise.reject(fail("The lock is already set up."));
    if (!SUB) return Promise.reject(fail("This browser cannot encrypt."));
    return dbNames().then(function (have) {
      if (!have) throw fail("This browser cannot list its saved databases, so the lock could miss saved photos. Use a recent Safari, Chrome, Edge or Firefox.");
      var dk, raw = rnd(32), c = { v: 1, state: "open", auto: AUTO.some(function (a) { return a[0] === +o.auto; }) ? +o.auto : 15, made: Date.now() };
      var kek;
      if (o.pass != null) {
        if (String(o.pass).length < 10) throw fail("Use a passphrase of at least 10 characters.");
        var salt = rnd(16); c.kind = "pass"; c.salt = b64u(salt); kek = kekFromPass(String(o.pass), salt);
      } else { c.kind = "passkey"; kek = prf(null, true).then(function (x) { c.cred = x.id; return kekFromPrf(x.secret); }); }
      return kek.then(function (k) { var iv = rnd(12); c.iv = b64u(iv); return SUB.encrypt({ name: "AES-GCM", iv: iv }, k, raw); }).then(function (w) {
        c.wrapped = b64u(w);
        return SUB.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      }).then(function (k) { dk = k; raw.fill(0); return vput("k", "dk", dk); }).then(function () { saveCfg(c); markSeen(); return c; });
    });
  }
  function off() {
    var c = cfg(); if (!c) return Promise.resolve();
    if (c.state !== "open") return Promise.reject(fail("Unlock first, then turn the lock off."));
    return vdel("k").then(function () { return vdel("box"); }).then(function () { localStorage.removeItem(CFG); localStorage.removeItem(AWAY); });
  }
  function setAuto(m) { var c = cfg(); if (!c) return; c.auto = +m || 0; saveCfg(c); }
  function markSeen() { try { localStorage.setItem(AWAY, String(Date.now())); } catch (e) {} }
  function due(c) { var t = +(localStorage.getItem(AWAY) || 0); return c.auto > 0 && t > 0 && Date.now() - t > c.auto * 60000; }

  /* ---------- the lock screen ---------- */
  var scr = null;
  var CSS = "#vaultscr{position:fixed;inset:0;z-index:2147482000;background:#0f1720;color:#e6ebf1;display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.45 'IBM Plex Sans',system-ui,sans-serif}" +
    "#vaultscr .vb{max-width:400px;width:100%;text-align:center}#vaultscr h2{font-size:20px;margin:0 0 8px}#vaultscr p{margin:0 0 12px;color:#b8c2cc}" +
    "#vaultscr input{font:inherit;width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #3a4450;background:#1b2027;color:#e6ebf1;margin-bottom:10px;min-height:44px}" +
    "#vaultscr button{font:inherit;font-weight:600;border-radius:6px;padding:10px 18px;border:1px solid #6fb6ee;background:#1d5d8f;color:#fff;cursor:pointer;min-height:44px}" +
    "#vaultscr .vmsg{color:#ff8787;min-height:1.4em}#vaultscr a{color:#9ccbf0;font-size:13px}";
  function showScreen(msg) {
    if (!D.body) { D.addEventListener("DOMContentLoaded", function () { showScreen(msg); }, { once: true }); return; }
    var c = cfg();
    if (!scr) {
      var st = D.createElement("style"); st.textContent = CSS; D.head.appendChild(st);
      scr = D.createElement("div"); scr.id = "vaultscr"; scr.setAttribute("role", "dialog"); scr.setAttribute("aria-modal", "true"); scr.setAttribute("aria-labelledby", "vault-h");
      D.body.appendChild(scr);
      scr.addEventListener("submit", function (e) { e.preventDefault(); go(); });
    }
    var busy = /^(Locking|Unlocking)/.test(msg || "");
    scr.innerHTML = '<form class="vb" autocomplete="off"><h2 id="vault-h">OSAP is locked</h2><p>Saved work on this device is encrypted.</p>' +
      (c && c.kind === "pass" && !busy ? '<input type="password" id="vault-pass" aria-label="Passphrase" placeholder="Passphrase" autocomplete="current-password">' : "") +
      '<p class="vmsg" role="status">' + (msg ? String(msg).replace(/[&<>]/g, "") : "") + "</p>" +
      (busy ? "" : '<button type="submit" data-vault-go>' + (c && c.kind === "pass" ? "Unlock" : "Unlock with Face ID") + "</button>") +
      '<p style="margin-top:18px"><a href="#panic">Erase this device</a></p></form>';
    var f = scr.querySelector("#vault-pass") || scr.querySelector("button"); if (f) f.focus();
  }
  function go() {
    var pi = scr && scr.querySelector("#vault-pass"), pass = pi ? pi.value : null;
    if (stashed().length && cfg() && cfg().state !== "locked") return finishLock().then(function () { location.reload(); }, function (e) { showScreen(e.message); });
    showScreen("Unlocking…");
    unlock(pass).then(function () { location.reload(); }, function (e) { showScreen(e && e.plain ? e.message : "Could not unlock. Try again."); });
  }

  /* ---------- at the very start of the page ---------- */
  var c0 = cfg();
  if (c0) {
    if (c0.state === "open" && due(c0)) { moveAside(); c0.state = "locking"; saveCfg(c0); }
    if (c0.state !== "open" || stashed().length) {
      /* locked, or a lock cut short: anything the app wrote while locked is set aside too, then sealed */
      if (c0.state === "locking" || stashed().length) { moveAside(); showScreen("Locking…"); finishLock().then(function () { location.reload(); }, function (e) { showScreen(e.message); }); }
      else showScreen("");
    } else {
      markSeen();
      var beat = setInterval(function () { if (!D.hidden) markSeen(); }, 30000);
      D.addEventListener("visibilitychange", function () {
        var c = cfg(); if (!c || c.state !== "open") return;
        if (D.hidden) { markSeen(); if (c.auto === 1) lock().catch(function () {}); }
        else if (due(c)) lock().catch(function () {}); else markSeen();
      });
      W.addEventListener("pagehide", markSeen);
      void beat;
    }
  }

  /* ---------- Settings > Lock my saved work ---------- */
  var box = null, UI = { msg: "", busy: false };
  var PCSS = "#vaultdlg{position:fixed;inset:0;z-index:100000;background:rgba(10,14,20,.6);display:flex;align-items:center;justify-content:center;padding:16px}#vaultdlg[hidden]{display:none}" +
    "#vaultdlg .vp{background:#fff;color:#15202b;max-width:520px;width:100%;max-height:calc(100vh - 32px);overflow:auto;border-radius:10px;padding:16px 18px;box-sizing:border-box;font:14px/1.45 'IBM Plex Sans',system-ui,sans-serif}" +
    "#vaultdlg h2{margin:0 0 6px;font-size:18px}#vaultdlg p{margin:0 0 8px}#vaultdlg .vn{color:#5b6673;font-size:12.5px}#vaultdlg .vm{color:#c92a2a;font-weight:600;min-height:1.2em}" +
    "#vaultdlg input,#vaultdlg select{font:inherit;padding:8px;border:1px solid #c3ccd6;border-radius:6px;box-sizing:border-box;width:100%;margin:0 0 8px;min-height:40px}" +
    "#vaultdlg button{font:inherit;font-weight:600;border-radius:6px;padding:8px 14px;border:1px solid #c3ccd6;background:#f3f5f8;color:#15202b;cursor:pointer;min-height:40px;margin:0 6px 6px 0}#vaultdlg button.vgo{background:#1d5d8f;border-color:#1d5d8f;color:#fff}" +
    "@media (prefers-color-scheme:dark){#vaultdlg .vp{background:#1b2027;color:#e6ebf1}#vaultdlg .vn{color:#9aa6b3}#vaultdlg input,#vaultdlg select{background:#262d36;color:#e6ebf1;border-color:#3a4450}#vaultdlg button{background:#262d36;border-color:#3a4450;color:#e6ebf1}#vaultdlg button.vgo{background:#1d5d8f;color:#fff}}";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function autoSel(cur) { return '<label class="vn" for="vault-auto">Lock automatically</label><select id="vault-auto">' + AUTO.map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === cur ? " selected" : "") + ">" + a[1] + "</option>"; }).join("") + "</select>"; }
  function render(pk) {
    var c = cfg(), h = '<h2 id="vaultdlg-h">Lock my saved work</h2>';
    if (!c) {
      h += "<p>Keeps your map points, photos, drawn areas, routes, watches, workspaces, plans and notes encrypted on this device while OSAP is locked. A lost or seized device shows nothing without your Face ID or passphrase.</p>" +
        '<p class="vn">If you forget the passphrase (or lose the passkey), the saved work cannot be opened by anyone, OSAP included. Keep a backup with Move to another device.</p>' +
        autoSel(15) +
        (pk ? '<button type="button" class="vgo" data-v="pk">Set up with Face ID / Windows Hello</button>' : "") +
        '<p class="vn" style="margin-top:8px">' + (pk ? "Or with a passphrase" : "With a passphrase (this device cannot use a passkey for it)") + ' (10 or more characters):</p>' +
        '<input type="password" id="vault-p1" placeholder="Passphrase" autocomplete="new-password"><input type="password" id="vault-p2" placeholder="Passphrase again" autocomplete="new-password">' +
        '<button type="button"' + (pk ? "" : ' class="vgo"') + ' data-v="pass">Set up with this passphrase</button>';
    } else {
      h += "<p>On, with " + (c.kind === "pass" ? "a passphrase" : "Face ID / Windows Hello") + ". Saved work is encrypted whenever OSAP is locked.</p>" + autoSel(c.auto) +
        '<button type="button" class="vgo" data-v="lock">Lock now</button><button type="button" data-v="off">Turn the lock off</button>' +
        '<p class="vn">Not covered: your sign-in, this device\'s own settings (map colours, units, Protected mode), maps saved for offline use, and files you exported or shared.</p>';
    }
    h += '<p class="vm" role="status">' + esc(UI.msg) + '</p><button type="button" data-v="close">Close</button>';
    box.querySelector(".vp").innerHTML = h;
  }
  function openPanel() {
    if (!box) {
      var st = D.createElement("style"); st.textContent = PCSS; D.head.appendChild(st);
      box = D.createElement("div"); box.id = "vaultdlg"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "vaultdlg-h");
      box.innerHTML = '<div class="vp"></div>'; D.body.appendChild(box);
      box.addEventListener("change", function (e) { if (e.target.id === "vault-auto" && cfg()) setAuto(e.target.value); });
      box.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-v]"); if (!b || UI.busy) return;
        var a = b.getAttribute("data-v"), auto = +(box.querySelector("#vault-auto") || {}).value || 0;
        var done = function () { UI.busy = false; canPasskey().then(render); }, bad = function (er) { UI.msg = er && er.plain ? er.message : "That did not work: " + ((er && er.message) || "unknown error"); done(); };
        if (a === "close") { box.hidden = true; return; }
        UI.busy = true; UI.msg = "";
        if (a === "pk") setup({ auto: auto }).then(function () { UI.msg = "The lock is on."; done(); }, bad);
        else if (a === "pass") {
          var p1 = box.querySelector("#vault-p1").value, p2 = box.querySelector("#vault-p2").value;
          if (p1 !== p2) { UI.msg = "The two passphrases are not the same."; return done(); }
          setup({ pass: p1, auto: auto }).then(function () { UI.msg = "The lock is on."; done(); }, bad);
        } else if (a === "lock") { box.hidden = true; lock().catch(bad); }
        else if (a === "off") off().then(function () { UI.msg = "The lock is off. Saved work stays on this device, not encrypted."; done(); }, bad);
      });
    }
    UI.msg = ""; box.hidden = false; canPasskey().then(render);
  }

  W.OSAP_VAULT = { state: function () { var c = cfg(); return c ? c.state : "off"; }, setup: setup, lock: lock, unlock: unlock, off: off, setAuto: setAuto,
    open: openPanel, close: function () { if (box) box.hidden = true; }, _keys: { picked: picked, DBS: DBS, STASH: STASH } };
})();
