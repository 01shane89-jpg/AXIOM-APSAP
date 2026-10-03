/* Move to another device (Shane 2026-10-02: "OSAP accounts. I want to be able to save my data from one device to another").
   No account and no server: everything the analyst has saved on this device goes into one file locked with a passphrase they
   choose, which they carry to the other device themselves (AirDrop, Files, email, the Share button) and open there.
   - What moves: every OSAP store in this browser (map points, drawn areas, NAI/TAI, routes, imported shapes, every workspace,
     keyword watches and push topics, My work, medical and evacuation plans, map and device settings) plus the point photos
     (IndexedDB "osap-points", original bytes with their SHA-256). Stores are picked by name (osap-, asap-, tsap-, tfw-, tw-,
     tbw-), so a new feature's store moves without a change here. Left out: caches that refill by themselves, the list of
     offline map downloads (the maps themselves stay on the old device), this device's "Use my location" choice, and
     one-visit notes.
   - The lock: PBKDF2-SHA-256 (600,000 rounds, random 16-byte salt) turns the passphrase into an AES-256-GCM key; the file is
     sealed with a random 12-byte nonce and the file's own header as associated data, so a wrong passphrase, a damaged file
     or an edited header is refused before anything is read. The passphrase never leaves the page and is never stored.
   - Bringing a file in REPLACES what this device has saved (it is a move, not a merge). What was here is kept aside in
     IndexedDB "osap-move" so "Put back what was here before" can undo the last import. Photos are checked against their
     SHA-256 and only image types are accepted; store names outside the OSAP ones are ignored. The file is untrusted data: it
     is parsed as JSON only and nothing in it is run.
   File: "OSAPMOVE" + version byte + 2-byte header length + header JSON + sealed body. The body (gzip when the browser has it)
   is a 4-byte manifest length, the manifest JSON (schema osap-move/1: stores, photo list with offsets) and the photo bytes.
   window.OSAP_MOVE {open, close, make, read, apply, undo, hasUndo, names, picked}. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var MAGIC = "OSAPMOVE", VER = 1, ITER = 600000, MIN_PASS = 8, MAX_FILE = 500 * 1048576, MAX_PHOTOS = 5000, MSG = "osap-move-msg";
  var PICK = /^(osap|asap|tsap|tfw|tw|tbw)[-.]/;
  var SKIP = ["osap-offline", "osap-offline-prev", "osap-loc", "osap-loc-go", "osap-boot", "osap-boot-t", "osap-tile-fail", "osap-ws-msg", "osap-ws-go", "osap-rt-link", MSG];
  var SKIP_PRE = /^(asap-xrecs-|osap-today-wx-)/;
  var te = new TextEncoder(), td = new TextDecoder();

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mb(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }
  function when(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function picked(k) { return typeof k === "string" && PICK.test(k) && SKIP.indexOf(k) < 0 && !SKIP_PRE.test(k); }
  function names() { var o = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (picked(k)) o.push(k); } } catch (e) {} return o.sort(); }
  function stores() { var o = {}; names().forEach(function (k) { try { var v = localStorage.getItem(k); if (v != null) o[k] = v; } catch (e) {} }); return o; }
  function hex(b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
  function sha256(u8) { return W.crypto.subtle.digest("SHA-256", u8).then(hex); }
  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var r = atob(s), u = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; }
  function rand(n) { var u = new Uint8Array(n); W.crypto.getRandomValues(u); return u; }
  function cat(parts) { var n = 0, o, p = 0; parts.forEach(function (x) { n += x.length; }); o = new Uint8Array(n); parts.forEach(function (x) { o.set(x, p); p += x.length; }); return o; }
  function fail(m) { var e = new Error(m); e.user = true; return e; }

  /* ---------- IndexedDB: the point photos, and the copy kept for undo ---------- */
  function idb(name, store, setup) {
    return new Promise(function (res, rej) {
      if (!W.indexedDB) { rej(fail("This browser has no IndexedDB, so photos cannot be moved.")); return; }
      var r = W.indexedDB.open(name, 1);
      r.onupgradeneeded = function () { setup(r.result); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(fail("OSAP is open in another tab. Close it and try again.")); };
    });
  }
  function photoDb() { return idb("osap-points", "photos", function (d) { d.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid"); }); }
  function undoDb() { return idb("osap-move", "kv", function (d) { d.createObjectStore("kv"); }); }
  function run(dbp, store, mode, fn) {
    return dbp.then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), out = fn(t.objectStore(store));
        t.oncomplete = function () { d.close(); res(out && "result" in out ? out.result : out); };
        t.onerror = t.onabort = function () { d.close(); rej(t.error || fail("The device's storage refused the change.")); };
      });
    });
  }
  function allPhotos() { return run(photoDb(), "photos", "readonly", function (s) { return s.getAll(); }).then(function (a) { return a || []; }, function () { return []; }); }

  /* ---------- gzip when the browser has it ---------- */
  var canZ = typeof W.CompressionStream === "function" && typeof W.DecompressionStream === "function";
  function stream(u8, ts) { return new Response(new Blob([u8]).stream().pipeThrough(ts)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }

  /* ---------- the key from the passphrase ---------- */
  function keyFor(pass, salt, iter) {
    return W.crypto.subtle.importKey("raw", te.encode(pass.normalize ? pass.normalize("NFC") : pass), "PBKDF2", false, ["deriveKey"]).then(function (k) {
      return W.crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iter }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }

  /* ---------- make the file ---------- */
  function make(pass, prog) {
    prog = prog || function () {};
    if (!W.crypto || !W.crypto.subtle) return Promise.reject(fail("This browser cannot lock files (it needs a secure https page)."));
    if (typeof pass !== "string" || pass.length < MIN_PASS) return Promise.reject(fail("Use a passphrase of at least " + MIN_PASS + " characters."));
    var keys = stores(), made = Date.now();
    prog("Collecting photos…");
    return allPhotos().then(function (P) {
      var list = [], bufs = [], off = 0;
      P.forEach(function (r) {
        if (!r || typeof r.id !== "string" || !r.buf) return;
        var u = new Uint8Array(r.buf);
        list.push({ id: r.id, pid: r.pid, type: r.type, size: u.length, name: r.name, sha256: r.sha256 || "", camera: r.camera || "", file: r.file, added: r.added, off: off, len: u.length });
        bufs.push(u); off += u.length;
      });
      return Promise.all(list.map(function (x, i) { return x.sha256 ? x.sha256 : sha256(bufs[i]).then(function (h) { x.sha256 = h; }); })).then(function () {
        var man = te.encode(JSON.stringify({ schema: "osap-move/1", made_utc: new Date(made).toISOString(), stores: keys, photos: list }));
        var len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, man.length);
        var body = cat([len, man].concat(bufs));
        prog("Locking with your passphrase…");
        return (canZ ? stream(body, new CompressionStream("gzip")) : Promise.resolve(body)).then(function (z) {
          var salt = rand(16), iv = rand(12);
          var head = te.encode(JSON.stringify({ kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), cipher: "AES-256-GCM", iv: b64(iv), z: canZ ? "gzip" : "", made_utc: new Date(made).toISOString(),
            n: { stores: Object.keys(keys).length, photos: list.length } }));
          var pre = cat([te.encode(MAGIC), new Uint8Array([VER, head.length >> 8, head.length & 255]), head]);
          return keyFor(pass, salt, ITER).then(function (k) { return W.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: pre }, k, z); }).then(function (ct) {
            var blob = new Blob([pre, new Uint8Array(ct)], { type: "application/octet-stream" });
            return { blob: blob, name: "osap-backup-" + new Date(made).toISOString().slice(0, 10) + ".osap", stores: Object.keys(keys).length, photos: list.length, bytes: blob.size };
          });
        });
      });
    });
  }

  /* ---------- open a file: checks everything, changes nothing ---------- */
  function read(file, pass) {
    if (!W.crypto || !W.crypto.subtle) return Promise.reject(fail("This browser cannot open locked files (it needs a secure https page)."));
    if (!file || file.size > MAX_FILE) return Promise.reject(fail("That file is too big to be an OSAP backup."));
    return (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer()).then(function (ab) {
      var u = new Uint8Array(ab);
      if (u.length < 12 || td.decode(u.subarray(0, 8)) !== MAGIC) throw fail("That is not an OSAP backup file. Pick the .osap file made with Move to another device.");
      if (u[8] !== VER) throw fail("This backup was made by a newer OSAP. Update OSAP on this device (reload it) and try again.");
      var hl = (u[9] << 8) | u[10], pre = u.subarray(0, 11 + hl), head;
      try { head = JSON.parse(td.decode(u.subarray(11, 11 + hl))); } catch (e) { throw fail("The backup file is damaged."); }
      if (!head || head.kdf !== "PBKDF2-SHA256" || head.cipher !== "AES-256-GCM" || !(head.iter >= 100000 && head.iter <= 5000000)) throw fail("The backup file is damaged.");
      if (head.z && !canZ) throw fail("This browser is too old to open the backup. Update it and try again.");
      return keyFor(pass || "", unb64(head.salt), head.iter).then(function (k) {
        return W.crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(head.iv), additionalData: pre }, k, u.subarray(11 + hl));
      }).then(null, function () { throw fail("Wrong passphrase, or the file was damaged on the way."); }).then(function (pt) {
        pt = new Uint8Array(pt);
        return head.z === "gzip" ? stream(pt, new DecompressionStream("gzip")) : pt;
      }).then(function (body) { return unpack(body, head); });
    });
  }
  function unpack(body, head) {
    var ml = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0), man;
    try { man = JSON.parse(td.decode(body.subarray(4, 4 + ml))); } catch (e) { throw fail("The backup file is damaged."); }
    if (!man || man.schema !== "osap-move/1" || !man.stores || typeof man.stores !== "object") throw fail("The backup file is damaged.");
    var keys = {}, data = body.subarray(4 + ml), photos = [];
    Object.keys(man.stores).forEach(function (k) { if (picked(k) && typeof man.stores[k] === "string") keys[k] = man.stores[k]; });
    (Array.isArray(man.photos) ? man.photos : []).slice(0, MAX_PHOTOS).forEach(function (x) {
      if (!x || typeof x.id !== "string" || x.id.length > 80 || typeof x.pid !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(x.type || "")) return;
      if (!(x.off >= 0 && x.len > 0 && x.off + x.len <= data.length)) return;
      photos.push({ meta: x, buf: data.slice(x.off, x.off + x.len) });
    });
    return Promise.all(photos.map(function (p) { return sha256(p.buf).then(function (h) { p.ok = h === p.meta.sha256; }); })).then(function () {
      var good = photos.filter(function (p) { return p.ok; });
      return { made: Date.parse(man.made_utc || head.made_utc) || 0, stores: keys, photos: good, badPhotos: photos.length - good.length, items: count(keys) };
    });
  }
  /* a plain-language list of what a set of stores holds */
  function arrLen(s) { try { var v = JSON.parse(s); return Array.isArray(v) ? v.length : 0; } catch (e) { return 0; } }
  function count(keys) {
    var c = { points: arrLen(keys["osap-atak-pts"]), areas: 0, aoi: arrLen(keys["osap-aoi"]), routes: arrLen(keys["osap-routes"]), shapes: arrLen(keys["osap-shapes"]), watches: arrLen(keys["asap-watches"]), plans: 0, workspaces: 1, work: 0 };
    Object.keys(keys).forEach(function (k) { if (/^asap-area-[a-z]{2,3}(-st)?$/.test(k) && arrLen(keys[k]) > 2) c.areas++; if (/^osap-medplan-/.test(k)) c.plans++; });
    try { c.workspaces = Math.max(1, JSON.parse(keys["osap-ws"]).list.length); } catch (e) {}
    try { var it = JSON.parse(keys["osap-work"]).items; c.work = Object.keys(it).filter(function (k) { var x = it[k]; return x && (x.saved || x.note || x.reviewed); }).length; } catch (e) {}
    return c;
  }
  function describe(c, photos) {
    var L = [[c.points, "map point", "map points"], [photos, "photo", "photos"], [c.areas, "drawn area", "drawn areas"], [c.aoi, "NAI/TAI area", "NAI/TAI areas"], [c.routes, "route", "routes"],
      [c.shapes, "imported shape", "imported shapes"], [c.watches, "keyword watch", "keyword watches"], [c.plans, "medical plan", "medical plans"], [c.work, "saved report or note", "saved reports and notes"]];
    var o = L.filter(function (x) { return x[0] > 0; }).map(function (x) { return x[0] + " " + (x[0] === 1 ? x[1] : x[2]); });
    if (c.workspaces > 1) o.push(c.workspaces + " workspaces");
    return o.length ? o.join(", ") : "settings only";
  }

  /* ---------- bring it in: replaces this device's saved data, keeping a copy for undo ---------- */
  function writeKeys(keys) {
    names().forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    var ok = true;
    Object.keys(keys).forEach(function (k) { if (ok) try { localStorage.setItem(k, keys[k]); } catch (e) { ok = false; } });
    return ok;
  }
  function apply(got) {
    var before = stores();
    return allPhotos().then(function (had) {
      var hadIds = {}; had.forEach(function (r) { hadIds[r.id] = 1; });
      var added = got.photos.filter(function (p) { return !hadIds[p.meta.id]; });
      return run(undoDb(), "kv", "readwrite", function (s) { s.put({ at: Date.now(), stores: before, added: added.map(function (p) { return p.meta.id; }) }, "undo"); }).then(function () {
        return run(photoDb(), "photos", "readwrite", function (s) {
          added.forEach(function (p) { var m = p.meta; s.put({ id: m.id, pid: m.pid, buf: p.buf.buffer, type: m.type, size: p.buf.length, name: m.name, sha256: m.sha256, camera: m.camera || "", file: m.file, added: +m.added || Date.now() }); });
        });
      }).then(function () {
        if (!writeKeys(got.stores)) { writeKeys(before); throw fail("This device ran out of room for the stores, so nothing was changed."); }
        try { sessionStorage.setItem(MSG, "Brought in: " + describe(got.items, got.photos.length)); } catch (e) {}
      });
    });
  }
  function undoRec() { return run(undoDb(), "kv", "readonly", function (s) { return s.get("undo"); }).then(null, function () { return null; }); }
  function hasUndo() { return undoRec().then(function (u) { return u ? u.at : 0; }); }
  function undo() {
    return undoRec().then(function (u) {
      if (!u) throw fail("There is nothing to put back.");
      if (!writeKeys(u.stores || {})) throw fail("This device ran out of room, so it could not put the old data back.");
      return run(photoDb(), "photos", "readwrite", function (s) { (u.added || []).forEach(function (id) { s.delete(id); }); }).then(null, function () {}).then(function () {
        return run(undoDb(), "kv", "readwrite", function (s) { s.delete("undo"); });
      }).then(function () { try { sessionStorage.setItem(MSG, "Put back what was on this device before the import"); } catch (e) {} });
    });
  }

  /* ---------- the panel ---------- */
  var box = D.createElement("div"); box.id = "movedlg"; box.hidden = true;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "move-h");
  D.body.appendChild(box);
  var UI = { busy: "", msg: "", made: null, got: null, file: null, undoAt: 0 };
  function open() { UI.msg = ""; UI.busy = ""; UI.got = null; UI.file = null; if (UI.made && UI.made.url) URL.revokeObjectURL(UI.made.url); UI.made = null; box.hidden = false; render();
    /* redraw only when there is something to put back: a redraw replaces the file box, and a file chosen in that moment was lost */
    hasUndo().then(function (t) { if (t !== UI.undoAt) { UI.undoAt = t; render(); } }); }
  function close() { box.hidden = true; if (UI.made && UI.made.url) URL.revokeObjectURL(UI.made.url); UI.made = null; UI.got = null; }
  function canShareFile(f) { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
  function render() {
    var here = count(stores()), busy = UI.busy, m = UI.made, g = UI.got;
    var send = m ? '<p class="mvok">Backup ready: ' + esc(m.name) + ", " + mb(m.bytes) + ". Send it to the other device, then open Move to another device there and choose it.</p>" +
        '<div class="mvbtns">' + (m.share ? '<button type="button" class="refresh" data-mv-share>Share or AirDrop</button>' : "") + '<a class="mvbtn' + (m.share ? "" : " refresh") + '" href="' + esc(m.url) + '" download="' + esc(m.name) + '">Save file</a></div>'
      : '<label class="mvf">Passphrase<input type="password" data-mv-p1 autocomplete="new-password" minlength="' + MIN_PASS + '" placeholder="at least ' + MIN_PASS + ' characters"></label>' +
        '<label class="mvf">Type it again<input type="password" data-mv-p2 autocomplete="new-password"></label>' +
        '<p class="obs">Four or more random words make a strong passphrase. If it is forgotten the file cannot be opened; OSAP never sees or keeps it.</p>' +
        '<div class="mvbtns"><button type="button" class="refresh" data-mv-make' + (busy ? " disabled" : "") + ">Make backup file</button></div>";
    var bring = g ? '<p class="mvok">Backup from ' + esc(g.made ? when(g.made) : "an unknown date") + ": " + esc(describe(g.items, g.photos.length)) + "." +
        (g.badPhotos ? " " + g.badPhotos + " damaged photo" + (g.badPhotos > 1 ? "s" : "") + " will be left out." : "") + "</p>" +
        '<p class="mvwarn">This replaces everything saved on this device (' + esc(describe(here, 0)) + "). You can put it back afterwards.</p>" +
        '<div class="mvbtns"><button type="button" class="refresh" data-mv-apply' + (busy ? " disabled" : "") + '>Replace and reload</button><button type="button" data-mv-cancel>Cancel</button></div>'
      : '<label class="mvf">Backup file' + (UI.file ? ' <span class="obs">' + esc(UI.file.name) + "</span>" : "") + '<input type="file" data-mv-file></label>' +
        '<label class="mvf">Passphrase<input type="password" data-mv-p3 autocomplete="current-password"></label>' +
        '<div class="mvbtns"><button type="button" class="refresh" data-mv-read' + (busy ? " disabled" : "") + ">Open backup</button></div>";
    box.innerHTML = '<div class="cbox"><div class="chead"><h2 id="move-h">Move to another device</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      '<p class="obs">No account and no server: your saved data goes into one file locked with your passphrase, and you carry it to the other device yourself.</p>' +
      '<p class="mvmsg" role="status"' + (busy || UI.msg ? "" : " hidden") + ">" + esc(busy || UI.msg) + "</p>" +
      '<section class="mvsec"><h3>Send from this device</h3><p class="obs">On this device: ' + esc(describe(here, 0) === "settings only" ? "settings only, nothing saved yet" : describe(here, 0) + ", plus photos and settings") + ".</p>" + send + "</section>" +
      '<section class="mvsec"><h3>Bring in from another device</h3>' + bring + "</section>" +
      (UI.undoAt ? '<p class="obs">Last import: ' + esc(when(UI.undoAt)) + '. <button type="button" class="mvlink" data-mv-undo>Put back what was here before</button></p>' : "") +
      '<details class="mvnote"><summary>What moves, and how it is protected</summary>' +
      "<p>Moves: map points and their photos, drawn areas, NAI/TAI, routes, imported shapes, every workspace, keyword watches and push alerts, saved reports and notes, medical and evacuation plans, and your map and device settings.</p>" +
      "<p>Stays here: offline map downloads (download them again on the new device), Use my location, and data OSAP fetches again by itself.</p>" +
      "<p>The file is locked with AES-256-GCM using a key made from your passphrase (PBKDF2-SHA-256, 600,000 rounds). Without the passphrase it is unreadable, so it is safe to send by email or a cloud drive. A wrong passphrase or a damaged file is refused and nothing changes.</p></details></div>";
  }
  function say(t) { UI.busy = ""; UI.msg = t; render(); }
  function err(e) { say(e && e.user ? e.message : "Something went wrong: " + (e && e.message || e)); }
  box.addEventListener("click", function (e) {
    var t = e.target;
    if (t === box || t.closest(".x")) { close(); return; }
    if (t.closest("[data-mv-make]")) {
      var p1 = box.querySelector("[data-mv-p1]").value, p2 = box.querySelector("[data-mv-p2]").value;
      if (p1.length < MIN_PASS) { say("Use a passphrase of at least " + MIN_PASS + " characters."); return; }
      if (p1 !== p2) { say("The two passphrases are not the same."); return; }
      UI.busy = "Making the backup…"; render();
      make(p1, function (s) { UI.busy = s; var m = box.querySelector(".mvmsg"); if (m) { m.hidden = false; m.textContent = s; } }).then(function (r) {
        var f = null; try { f = new File([r.blob], r.name, { type: "application/octet-stream" }); } catch (x) {}
        r.file = f; r.share = !!f && canShareFile(f); r.url = URL.createObjectURL(r.blob); UI.made = r; say("");
      }, err);
      return;
    }
    if (t.closest("[data-mv-share]") && UI.made) { navigator.share({ files: [UI.made.file], title: UI.made.name }).catch(function () {}); return; }
    if (t.closest("[data-mv-read]")) {
      var f = UI.file, pw = box.querySelector("[data-mv-p3]").value;
      if (!f) { say("Choose the backup file first."); return; }
      if (!pw) { say("Type the passphrase the backup was made with."); return; }
      UI.busy = "Unlocking…"; render();
      read(f, pw).then(function (g) { UI.got = g; say(""); }, err);
      return;
    }
    if (t.closest("[data-mv-cancel]")) { UI.got = null; say(""); return; }
    if (t.closest("[data-mv-apply]") && UI.got) {
      UI.busy = "Bringing it in…"; render();
      apply(UI.got).then(function () { location.reload(); }, err);
      return;
    }
    if (t.closest("[data-mv-undo]")) {
      if (!confirm("Put back what was saved on this device before the last import? What the import brought in is removed.")) return;
      UI.busy = "Putting it back…"; render();
      undo().then(function () { location.reload(); }, err);
    }
  });
  /* the chosen file is kept while the panel redraws, so a mistyped passphrase does not mean choosing it again */
  box.addEventListener("change", function (e) { if (e.target.hasAttribute("data-mv-file")) UI.file = e.target.files && e.target.files[0] || null; });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });
  var css = D.createElement("style");
  css.textContent = "#movedlg{position:fixed;inset:0;z-index:100002;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#movedlg .cbox{max-width:560px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#movedlg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#movedlg .chead h2{margin:0;font-size:18px;flex:1}" +
    "#movedlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#movedlg .obs{color:var(--muted)}" +
    "#movedlg h3{font-size:14px;margin:6px 0 4px}#movedlg .mvsec{border:1px solid var(--line);border-radius:8px;padding:6px 12px 10px;margin:10px 0}" +
    "#movedlg .mvf{display:flex;flex-direction:column;gap:3px;margin:8px 0;font-weight:600}#movedlg .mvf input{font:inherit;font-weight:400;min-height:38px;padding:4px 8px;max-width:100%;box-sizing:border-box}" +
    "#movedlg .mvbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}#movedlg .mvbtns>*{min-height:38px}" +
    "#movedlg .mvbtn{display:inline-flex;align-items:center;padding:0 14px;border:1px solid var(--line);border-radius:6px;color:inherit;text-decoration:none;background:var(--surface2)}" +
    "#movedlg .mvmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}#movedlg .mvok{border-left:3px solid #2f9e44;padding:2px 10px}" +
    "#movedlg .mvwarn{border-left:3px solid #e8590c;padding:2px 10px}#movedlg .mvlink{background:none;border:none;color:#1c7ed6;text-decoration:underline;cursor:pointer;font:inherit;padding:0;min-height:32px}" +
    "#movedlg .mvnote summary{cursor:pointer;font-weight:600;padding:6px 0}";
  D.head.appendChild(css);

  /* the line saying what an import or undo did, shown once after the reload */
  try {
    var said = sessionStorage.getItem(MSG);
    if (said) {
      sessionStorage.removeItem(MSG);
      W.addEventListener("load", function () {
        setTimeout(function () {
          if (W.OSAP_ATAK && W.OSAP_ATAK.toast) { W.OSAP_ATAK.toast(said); return; }
          var d = D.createElement("div"); d.setAttribute("role", "status"); d.textContent = said;
          d.style.cssText = "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:100001;background:var(--ink);color:var(--surface);padding:8px 14px;border-radius:8px;font-size:13px";
          D.body.appendChild(d); setTimeout(function () { d.remove(); }, 5000);
        }, 600);
      });
    }
  } catch (e) {}

  W.OSAP_MOVE = { open: open, close: close, make: make, read: read, apply: apply, undo: undo, hasUndo: hasUndo, names: names, picked: picked, count: count, describe: describe };
})();
