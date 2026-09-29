/* AXIOM OSAP: your own map points with a name, a note and photos.
   - opens from the Point tool on the map toolbar, from Point on the long-press menu, from a point's "Edit, photos" button,
     and from the pencil beside a point in the Overlay Manager (assets/osap-atak.js owns the points themselves);
   - photos are taken with the camera or picked from the library and stay on this device only, in IndexedDB "osap-points";
     nothing is uploaded anywhere;
   - each photo is kept byte for byte as it came from the camera or library (the original), with its SHA-256 fingerprint,
     its size and type, the camera clock time read from the photo when it has one, the file time, and when it was added;
   - a point's name and note live with the point (localStorage "osap-atak-pts"); its photo count is kept there too so the
     map label can show it without opening the photo store.
   Points and photos are the analyst's own notes, not reports and not evidence. */
(function () {
  "use strict";
  var W = window, D = document, A = W.OSAP_ATAK, map = W.__asapMap, L = W.L;
  if (!A || !A.pts || !map || !L) return;
  var P = A.pts, mapEl = map.getContainer();
  var MAX_PHOTOS = 24, MAX_BYTES = 30 * 1024 * 1024;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(t) { if (A.toast) A.toast(t); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + "Z"; }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  /* ---------- photo store: IndexedDB, originals kept as the bytes that came in ---------- */
  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (res, rej) {
        if (!W.indexedDB) { rej(new Error("This browser cannot keep photos (no IndexedDB).")); return; }
        var r = W.indexedDB.open("osap-points", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid"); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error || new Error("Photo store would not open.")); };
        r.onblocked = function () { rej(new Error("Photo store is busy in another tab.")); };
      });
      dbp.catch(function () { dbp = null; });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction("photos", mode), out = fn(t.objectStore("photos"));
        t.oncomplete = function () { res(out && "result" in out ? out.result : out); };
        t.onerror = t.onabort = function () { rej(t.error || new Error("Photo store error.")); };
      });
    });
  }
  function photosOf(pid) { return tx("readonly", function (s) { return s.index("pid").getAll(pid); }).then(function (a) { return (a || []).sort(function (x, y) { return x.added - y.added; }); }); }
  function photo(id) { return tx("readonly", function (s) { return s.get(id); }); }
  function forget(pid) { return tx("readwrite", function (s) { var r = s.index("pid").openKeyCursor(IDBKeyRange.only(pid)); r.onsuccess = function () { var c = r.result; if (c) { s.delete(c.primaryKey); c.continue(); } }; }).catch(function () {}); }
  function hex(b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
  function sha256(buf) { try { return W.crypto.subtle.digest("SHA-256", buf).then(hex, function () { return ""; }); } catch (e) { return Promise.resolve(""); } }
  function blobOf(r) { return new Blob([r.buf], { type: r.type }); }

  /* the camera's own clock, read from the photo's EXIF block (JPEG only); left blank when the photo has none */
  function exifTime(buf) {
    try {
      var v = new DataView(buf), o = 2;
      if (v.getUint16(0) !== 0xFFD8) return "";
      while (o + 10 < v.byteLength) {
        var m = v.getUint16(o), len = v.getUint16(o + 2);
        if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) return "";
        if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return tiffTime(v, o + 10);
        o += 2 + len;
      }
    } catch (e) {}
    return "";
  }
  function tiffTime(v, t) {
    var le = v.getUint16(t) === 0x4949;
    function u16(p) { return v.getUint16(p, le); }
    function u32(p) { return v.getUint32(p, le); }
    function find(p, tag) { for (var i = 0, n = u16(p); i < n && i < 400; i++) { var e = p + 2 + i * 12; if (u16(e) === tag) return e; } return 0; }
    function str(e) { var n = u32(e + 4), off = n > 4 ? t + u32(e + 8) : e + 8, s = ""; for (var i = 0; i < n - 1 && i < 40; i++) s += String.fromCharCode(v.getUint8(off + i)); return s.replace(/\0.*$/, ""); }
    var i0 = t + u32(t + 4), ex = find(i0, 0x8769), dt = "", tz = "";
    if (ex) { var ep = t + u32(ex + 8), e1 = find(ep, 0x9003), e2 = find(ep, 0x9011); if (e1) dt = str(e1); if (e2) tz = str(e2); }
    if (!dt) { var e3 = find(i0, 0x0132); if (e3) dt = str(e3); }
    var mm = /^(\d{4}):(\d\d):(\d\d) (\d\d:\d\d:\d\d)/.exec(dt);
    return mm ? mm[1] + "-" + mm[2] + "-" + mm[3] + " " + mm[4] + (/^[+-]\d\d:\d\d$/.test(tz) ? " UTC" + tz : " camera local time") : "";
  }

  function addFiles(pid, files) {
    var list = Array.prototype.slice.call(files || []), pt = find(pid);
    if (!pt || !list.length) return Promise.resolve(0);
    var room = MAX_PHOTOS - (pt.ph || 0), done = 0, skipped = [];
    if (W.navigator.storage && W.navigator.storage.persist) W.navigator.storage.persist().catch(function () {});
    return list.reduce(function (chain, f) {
      return chain.then(function () {
        if (!/^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i.test(f.type || "")) { skipped.push(f.name + " (not a photo)"); return; }
        if (f.size > MAX_BYTES) { skipped.push(f.name + " (over 30 MB)"); return; }
        if (done >= room) { skipped.push(f.name + " (" + MAX_PHOTOS + " photos per point)"); return; }
        return f.arrayBuffer().then(function (buf) {
          return sha256(buf).then(function (h) {
            var r = { id: "ph" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), pid: pid, buf: buf, type: f.type, size: buf.byteLength,
              name: String(f.name || "photo").slice(0, 120), sha256: h, camera: exifTime(buf), file: f.lastModified ? iso(f.lastModified) : "", added: Date.now() };
            return tx("readwrite", function (s) { s.add(r); }).then(function () { done++; });
          });
        });
      });
    }, Promise.resolve()).then(function () {
      return photosOf(pid).then(function (a) { setPt(pid, { ph: a.length }); });
    }).then(function () {
      if (skipped.length) toast("Not added: " + skipped.join(", "));
      else if (done) toast(done === 1 ? "Photo added" : done + " photos added");
      return done;
    }, function (e) {
      toast(/quota/i.test(e && e.name + e.message) ? "Not enough room on this device for that photo" : "Photo not saved: " + (e && e.message || "error"));
      return photosOf(pid).then(function (a) { setPt(pid, { ph: a.length }); return done; }, function () { return done; });
    });
  }
  function dropPhoto(pid, id) {
    return tx("readwrite", function (s) { s.delete(id); }).then(function () { return photosOf(pid); }).then(function (a) { setPt(pid, { ph: a.length }); });
  }

  /* ---------- the point record (owned by osap-atak.js) ---------- */
  function find(id) { return P.all().filter(function (p) { return p.id === id; })[0] || null; }
  function setPt(id, ch) {
    var a = P.all(), hit = false;
    a.forEach(function (p) { if (p.id === id) { for (var k in ch) { if (ch[k] === "" || ch[k] === 0) delete p[k]; else p[k] = ch[k]; } p.u = Date.now(); hit = true; } });
    if (hit) { P.save(a); P.draw(); P.paint(); }
  }

  /* ---------- thumbnails: object URLs, let go of when their holder is redrawn or closed ---------- */
  function revoke(el) { (el && el._urls || []).forEach(function (u) { URL.revokeObjectURL(u); }); if (el) el._urls = []; }
  function thumbs(el, pid, withDel) {
    if (!el) return Promise.resolve();
    return photosOf(pid).then(function (a) {
      revoke(el); el._urls = [];
      el.innerHTML = a.map(function (r) {
        var u = URL.createObjectURL(blobOf(r)); el._urls.push(u);
        return '<span class="pt-th"><button type="button" data-ph="' + esc(r.id) + '" title="' + esc(r.name) + '"><img alt="Photo ' + esc(r.name) + '" src="' + u + '"></button>' +
          (withDel ? '<button type="button" class="pt-thx" data-phx="' + esc(r.id) + '" aria-label="Delete this photo">\u00d7</button>' : "") + "</span>";
      }).join("");
      el.setAttribute("data-pid", pid);
    }, function (e) { el.innerHTML = '<p class="obs">' + esc(e && e.message || "Photos are not available in this browser.") + "</p>"; });
  }
  map.on("popupclose", function (e) { var el = e.popup.getElement && e.popup.getElement(); if (el) Array.prototype.forEach.call(el.querySelectorAll(".atk-pph"), revoke); });
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".atk-pph [data-ph]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); view(b.getAttribute("data-ph"));
  }, true);

  /* ---------- the editor: a side sheet on wide screens, a bottom sheet on phones ---------- */
  var ed = D.createElement("aside"); ed.id = "pt-ed"; ed.className = "leaflet-control"; ed.hidden = true;
  ed.setAttribute("role", "dialog"); ed.setAttribute("aria-label", "Point: name, note and photos");
  ed.innerHTML = '<div class="pt-h"><h2>Point</h2><button type="button" class="pt-ic" data-pe="x" aria-label="Close">\u00d7</button></div>' +
    '<div class="pt-b"><label class="pt-f"><span>Name</span><input id="pt-n" maxlength="60" autocomplete="off"></label>' +
    '<div class="pt-grid"></div>' +
    '<label class="pt-f"><span>Note</span><textarea id="pt-note" rows="3" maxlength="2000" placeholder="What is here, what you saw"></textarea></label>' +
    '<h3>Photos <span class="obs pt-cnt"></span></h3><div class="pt-phs"></div>' +
    '<div class="pt-add"><label class="pt-btn pri"><input type="file" accept="image/*" capture="environment" data-pf="cam">Take photo</label>' +
    '<label class="pt-btn"><input type="file" accept="image/*" multiple data-pf="lib">Add from library</label></div>' +
    '<p class="obs">Photos stay on this device only and are never uploaded. Each original is kept unchanged with its SHA-256 fingerprint. Clearing this site\'s data in the browser removes them.</p></div>' +
    '<div class="pt-foot"><button type="button" class="pt-btn dng" data-pe="del">Delete point</button><button type="button" class="pt-btn pri" data-pe="x">Done</button></div>';
  L.DomEvent.disableClickPropagation(ed); L.DomEvent.disableScrollPropagation(ed);
  var cur = null, saveT = 0;
  function edPaint() {
    var p = find(cur); if (!p) { edClose(); return; }
    ed.querySelector("h2").textContent = p.n;
    ed.querySelector(".pt-grid").innerHTML = "<code>" + esc(A.fmt(p.lat, p.lon, "mgrs")) + "</code> <code>" + esc(A.fmt(p.lat, p.lon, "dd")) + "</code>";
    ed.querySelector(".pt-cnt").textContent = p.ph ? "(" + p.ph + ")" : "";
    thumbs(ed.querySelector(".pt-phs"), p.id, true);
  }
  function edit(id) {
    var p = find(id); if (!p) return;
    flush(); cur = id; map.closePopup();
    ed.querySelector("#pt-n").value = p.n || ""; ed.querySelector("#pt-note").value = p.note || "";
    ed.hidden = false; edPaint();
  }
  function flush() {
    if (!cur || !saveT) return; clearTimeout(saveT); saveT = 0;
    var n = ed.querySelector("#pt-n").value.trim().slice(0, 60), note = ed.querySelector("#pt-note").value.slice(0, 2000), p = find(cur);
    if (p) setPt(cur, { n: n || p.n, note: note.trim() ? note : "" });
  }
  function edClose() { flush(); ed.hidden = true; cur = null; revoke(ed.querySelector(".pt-phs")); ed.querySelector(".pt-phs").innerHTML = ""; }
  ed.addEventListener("input", function (e) {
    if (e.target.id !== "pt-n" && e.target.id !== "pt-note") return;
    clearTimeout(saveT); saveT = setTimeout(function () { flush(); if (cur) ed.querySelector("h2").textContent = (find(cur) || {}).n || ""; }, 400);
  });
  ed.addEventListener("change", function (e) {
    var f = e.target.getAttribute && e.target.getAttribute("data-pf"); if (!f || !cur) return;
    var id = cur, files = e.target.files; flush();
    addFiles(id, files).then(function () { e.target.value = ""; if (cur === id) edPaint(); });
  });
  ed.addEventListener("click", function (e) {
    var t = e.target, b;
    if ((b = t.closest("[data-phx]"))) { if (W.confirm("Delete this photo from this device?")) { var id = cur; dropPhoto(id, b.getAttribute("data-phx")).then(function () { if (cur === id) edPaint(); }); } return; }
    if ((b = t.closest("[data-ph]"))) { view(b.getAttribute("data-ph")); return; }
    if ((b = t.closest("[data-pe]"))) {
      var k = b.getAttribute("data-pe");
      if (k === "x") edClose();
      else if (k === "del") { var p = find(cur); if (p && W.confirm("Delete " + p.n + (p.ph ? " and its " + p.ph + " photo" + (p.ph > 1 ? "s" : "") : "") + " from this device?")) { var pid = cur; saveT = 0; edClose(); P.del(pid); } }
    }
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (!vw.hidden) viewClose(); else if (!ed.hidden) edClose(); } });

  /* ---------- the photo viewer: the original, full size, with its fingerprint and times ---------- */
  var vw = D.createElement("div"); vw.id = "pt-view"; vw.hidden = true; vw.setAttribute("role", "dialog"); vw.setAttribute("aria-label", "Photo");
  vw.innerHTML = '<div class="pt-vimg"></div><div class="pt-vmeta"></div><div class="pt-vbar"><a class="pt-btn" data-pv="save" download>Save original</a><button type="button" class="pt-btn dng" data-pv="del">Delete</button><button type="button" class="pt-btn pri" data-pv="x">Close</button></div>';
  var vwCur = null;
  function view(id) {
    photo(id).then(function (r) {
      if (!r) return;
      viewClose(); vwCur = r;
      var u = URL.createObjectURL(blobOf(r)); vw._urls = [u];
      vw.querySelector(".pt-vimg").innerHTML = '<img alt="' + esc(r.name) + '" src="' + u + '">';
      var p = find(r.pid) || {};
      vw.querySelector(".pt-vmeta").innerHTML = "<b>" + esc(p.n || "Point") + "</b> \u00b7 " + esc(r.name) + " \u00b7 " + esc(kb(r.size)) + " \u00b7 " + esc(r.type) +
        "<br>Taken: " + esc(r.camera || "not in the photo") + (r.file ? " \u00b7 File time: " + esc(r.file) : "") + " \u00b7 Added: " + esc(iso(r.added)) +
        '<br>SHA-256: <code>' + esc(r.sha256 || "not available in this browser") + "</code>" +
        '<br><span class="obs">Original, unchanged, on this device only. Your own photo, not a report.</span>';
      var a = vw.querySelector('[data-pv="save"]'); a.href = u; a.setAttribute("download", r.name || "photo");
      vw.hidden = false;
      var x = vw.querySelector('[data-pv="x"]'); if (x) x.focus({ preventScroll: true });
    });
  }
  function viewClose() { vw.hidden = true; revoke(vw); vw.querySelector(".pt-vimg").innerHTML = ""; vwCur = null; }
  vw.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pv]");
    if (!b) { if (e.target === vw) viewClose(); return; }
    var k = b.getAttribute("data-pv");
    if (k === "x") viewClose();
    else if (k === "del" && vwCur && W.confirm("Delete this photo from this device?")) {
      var r = vwCur; viewClose(); dropPhoto(r.pid, r.id).then(function () { if (cur === r.pid) edPaint(); });
    }
  });

  /* ---------- styles ---------- */
  var st = D.createElement("style");
  st.textContent =
    "#pt-ed{position:absolute;top:0;right:0;bottom:30px;z-index:1005;width:min(360px,92%);display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--ink,#222);box-shadow:-4px 0 18px rgba(0,0,0,.3);font-size:13px}" +
    "#pt-ed[hidden],#pt-view[hidden]{display:none!important}" +
    "#pt-ed .pt-h{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 6px 14px;border-bottom:1px solid var(--line)}#pt-ed h2{font-size:15px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    "#pt-ed .pt-b{flex:1;overflow:auto;padding:10px 14px}#pt-ed h3{font-size:13px;margin:12px 0 6px}#pt-ed .obs{color:var(--muted);font-size:11.5px;font-weight:400}" +
    ".pt-ic{width:36px;height:36px;border:0;border-radius:6px;background:none;color:inherit;font-size:22px;line-height:1;cursor:pointer}" +
    ".pt-f{display:flex;flex-direction:column;gap:3px;margin:0 0 8px}.pt-f span{font-weight:600;font-size:12px}" +
    ".pt-f input,.pt-f textarea{font:inherit;font-size:14px;padding:7px 8px;border:1px solid var(--line);border-radius:5px;background:var(--surface,#fff);color:var(--ink,#222);box-sizing:border-box;width:100%;resize:vertical}" +
    "@media (pointer:coarse){.pt-f input,.pt-f textarea{font-size:16px}}" +
    ".pt-grid code{font:12px/1.5 'IBM Plex Mono',monospace;display:inline-block;margin:0 8px 6px 0}" +
    ".pt-phs,.atk-pph{display:flex;flex-wrap:wrap;gap:6px}.atk-pph{margin:6px 0;min-height:58px}" +
    ".pt-th{position:relative;display:inline-block}.pt-th [data-ph]{display:block;padding:0;border:1px solid var(--line);border-radius:5px;background:#000;cursor:zoom-in;overflow:hidden}" +
    ".pt-th img{display:block;width:76px;height:76px;object-fit:cover}.atk-pph .pt-th img{width:56px;height:56px}" +
    ".pt-thx{position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:#c92a2a;color:#fff;font:700 15px/1 system-ui,sans-serif;cursor:pointer;padding:0}" +
    ".pt-add{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 6px}" +
    ".pt-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border:1px solid var(--line);border-radius:6px;background:var(--surface,#fff);color:var(--ink,#222);font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer;text-decoration:none;overflow:hidden}" +
    ".pt-btn.pri{background:#0b7285;border-color:#0b7285;color:#fff}.pt-btn.dng{color:#c92a2a;border-color:#c92a2a}" +
    ".pt-btn input[type=file]{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;font-size:0}" +
    "#pt-ed .pt-foot{display:flex;justify-content:space-between;gap:8px;padding:8px 14px;border-top:1px solid var(--line)}" +
    "#pt-view{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.92);color:#eee;display:flex;flex-direction:column;font:13px/1.45 system-ui,-apple-system,sans-serif}" +
    "#pt-view .pt-vimg{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px}#pt-view img{max-width:100%;max-height:100%;object-fit:contain}" +
    "#pt-view .pt-vmeta{padding:6px 14px;word-break:break-all}#pt-view code{font:11.5px 'IBM Plex Mono',monospace;color:#8fd3e0}#pt-view .obs{color:#aaa}" +
    "#pt-view .pt-vbar{display:flex;gap:8px;justify-content:flex-end;padding:8px 14px calc(8px + env(safe-area-inset-bottom))}#pt-view .pt-btn{background:#222;color:#eee;border-color:#555}#pt-view .pt-btn.pri{background:#0b7285;border-color:#0b7285}#pt-view .pt-btn.dng{color:#ff8787;border-color:#ff8787}" +
    ".atk-pt .atk-cam{vertical-align:-1px}" +
    "@media (max-width:700px){#pt-ed{left:0;right:0;top:auto;width:auto;max-height:80%;border-radius:12px 12px 0 0;box-shadow:0 -4px 18px rgba(0,0,0,.3)}}";
  D.head.appendChild(st);
  mapEl.appendChild(ed); D.body.appendChild(vw);
  W.addEventListener("hashchange", function () { if (!ed.hidden) edClose(); });

  W.OSAP_POINTS = { edit: edit, close: edClose, thumbs: function (el, pid) { return thumbs(el, pid, false); }, forget: forget, add: addFiles, photos: photosOf, view: view };
  /* osap-atak.js drew the points before this file loaded: draw again so their popups get the photo strip and Edit */
  P.draw(); P.paint();
})();
