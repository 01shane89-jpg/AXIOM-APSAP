/* AXIOM OSAP: share a story or an event.
   Self-contained block loaded after the main page script. It adds a Share button to the head of every open Report (one story)
   and Event (reports grouped as one incident). Share opens a small sheet with:
   - the text that will be sent, always with the source, the link to the original and the "Reported, not verified" label;
     an Event also carries its Summary (from assets/osap-evsum.js) with its "AI generated" or "Automatic" tag and every source link;
   - a link that opens OSAP on that story on the map (the same ?wopen= link watch alerts use, plus s=1 to mark it as shared);
   - a map picture drawn here: the place on the map with a pin, the headline, source and status.
   Buttons: Share (the device's share menu, Web Share API, with the picture where the device takes files), Copy text and link,
   Copy link, Save picture. Nothing leaves the device unless the user picks a share target; OSAP stores nothing about it.
   It never changes a record, an event, a claim status or a summary. The map picture uses the Esri light canvas tiles when the
   browser may draw them into a picture, otherwise the packaged Natural Earth outlines (data/basemap/world-outlines.js).
   Opening a shared link whose story has since dropped out of the feed shows a short note instead of the watch-alert message. */
(function () {
  "use strict";
  var LIVE = "https://01shane89-jpg.github.io/AXIOM-APSAP/";
  var ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
  var PRANK = { exact: 3, approx: 2, province: 1 };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function recs() { return (window.TSAP && window.TSAP.records) || []; }
  function pageCC() { return (window.TSAP && window.TSAP.country) || "th"; }
  /* links point at the live site; a copy opened elsewhere (a preview) still hands out a link that works */
  function base() { return /\.github\.io$/.test(location.hostname) ? location.origin + location.pathname : LIVE; }
  function deepLink(key, cc) { return base() + "?wopen=" + encodeURIComponent(key) + "&s=1#" + (cc === "th" ? "" : cc + "/") + "timeline"; }
  /* same key the page gives each record (recKey in index.html), so a link keeps working across rebuilds */
  function recKey(r) {
    if (r.__rk) return r.__rk;
    var s = r.url ? [r.layer, r.url, r.kind, r.cat, String(r.ts).slice(0, 10), r.place].join("|") : [r.layer, r.title, String(r.ts).slice(0, 16), r.lat, r.lon].join("|");
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  function byId(id) { var a = recs(); for (var i = 0; i < a.length; i++) if (String(a[i].id) === String(id)) return a[i]; return null; }
  function hasLL(r) { return r && r.lat != null && r.lon != null && isFinite(r.lat) && isFinite(r.lon); }
  /* a definition-list row as the page shows it: the main line, and the grey sub-lines apart */
  function row(box, label) {
    var dts = box.querySelectorAll(".pkgdl dt");
    for (var i = 0; i < dts.length; i++) if (clean(dts[i].textContent) === label) {
      var dd = dts[i].nextElementSibling; if (!dd) return null;
      var c = dd.cloneNode(true), subs = [];
      Array.prototype.forEach.call(c.querySelectorAll(".sub"), function (s) { subs.push(clean(s.textContent)); s.remove(); });
      return { main: clean(c.textContent), subs: subs };
    }
    return null;
  }

  /* ---------- what gets shared ---------- */
  function storyData(box, r) {
    var when = row(box, "When"), where = row(box, "Where"), ver = row(box, "Verified?"), url = safeUrl(r.url);
    var status = ver ? ver.main + (ver.subs[0] ? ", " + ver.subs[0].replace(/\. No analyst has confirmed it\.?$/, "") : "") : "";
    var src = (r.src && r.src.name) || "Source not named", whenT = when ? when.main : String(r.ts || "");
    var link = deepLink(recKey(r), pageCC());
    var lines = [r.title, src + (whenT ? " · " + whenT : "")];
    if (where && where.main && where.main !== "Not stated") lines.push("Where: " + where.main);
    lines.push("Reported, not verified." + (status ? " OSAP status: " + status + "." : ""));
    lines.push(url ? "Original: " + url : "No link to the original is archived.");
    return {
      kind: "story", title: r.title, text: lines.join("\n"), link: link,
      pic: { head: r.title, sub: src + (whenT ? " · " + whenT : ""), where: where && where.main !== "Not stated" ? where.main : "",
        tag: "Reported, not verified", pts: hasLL(r) ? [{ lat: +r.lat, lon: +r.lon, main: true, prec: r.prec }] : [] }
    };
  }
  function eventData(box) {
    var title = clean((box.querySelector(".pkgt") || {}).textContent), when = row(box, "When"), where = row(box, "Where");
    var members = [], local = [], key = null, cc = pageCC();
    Array.prototype.forEach.call(box.querySelectorAll(".evlist .evm"), function (m) {
      var a = m.querySelector('.evbtns a[target="_blank"]'), rb = m.querySelector("[data-ev-rec]"), xa = m.querySelector('a[href*="wopen="]');
      var src = clean((m.querySelector(".tls") || {}).textContent).split(" · ")[0];
      members.push({ source: src, title: clean((m.querySelector(".tln") || {}).textContent), when: clean((m.querySelector(".tlt") || {}).textContent), url: a ? safeUrl(a.getAttribute("href")) : "" });
      var r = rb ? byId(rb.getAttribute("data-ev-rec")) : null;
      if (r) { local.push(r); if (!key) key = recKey(r); }
      else if (xa && !key) {
        var h = xa.getAttribute("href"), mk = /[?&]wopen=([^&#]+)/.exec(h), mh = /#([a-z]{2,3})\//.exec(h);
        if (mk) { key = decodeURIComponent(mk[1]); cc = mh ? mh[1] : "th"; }
      }
    });
    var nsrc = members.map(function (x) { return x.source; }).filter(function (s, i, a) { return s && a.indexOf(s) === i; }).length;
    var lines = [title, "One event grouped automatically by OSAP from " + members.length + " report" + (members.length === 1 ? "" : "s") + " by " + nsrc + " source" + (nsrc === 1 ? "" : "s") +
      " (a guess by fixed rules, not a finding)."];
    if (when && when.main) lines.push("When: " + when.main);
    if (where && where.main && !/^No report/.test(where.main)) lines.push("Where: " + where.main);

    /* the Summary exactly as the page shows it, with its tag; its numbered sources keep their numbers */
    var ev = box.querySelector(".evsum"), refs = [], tagT = "";
    if (ev && ev.querySelector(".evstext")) {
      var tag = ev.querySelector(".aitag");
      tagT = tag ? clean(tag.textContent) : "";
      lines.push("", "Summary" + (tagT ? " [" + tagT + (tag.title ? ": " + clean(tag.title).replace(/\.$/, "") : "") + "]" : ""));
      Array.prototype.forEach.call(ev.children, function (el) {
        if (el.classList.contains("evstext")) lines.push(clean(el.textContent));
        else if (el.tagName === "UL") Array.prototype.forEach.call(el.children, function (li) { lines.push("• " + clean(li.textContent)); });
        else if (el.tagName === "H5") lines.push(clean(el.textContent) + ":");
        else if (el.tagName === "P" && /^Not established/.test(clean(el.textContent))) lines.push(clean(el.textContent));
        else if (el.classList.contains("evsfrom")) Array.prototype.forEach.call(el.querySelectorAll("ol > li"), function (li) {
          var a = li.querySelector("a[href]"); refs.push({ text: clean(li.textContent), url: a ? safeUrl(a.getAttribute("href")) : "" });
        });
      });
      lines.push(/^AI/i.test(tagT) ? "Written by a language model from the reports' headlines and summaries. Statements are what the sources said, not confirmed facts."
        : "Put together by fixed rules (no AI) from each source's own words and figures. Nothing is inferred.");
    }
    var cited = {};
    if (refs.length) {
      lines.push("", "Sources:");
      refs.forEach(function (x, i) { lines.push("[" + (i + 1) + "] " + x.text + (x.url ? "\n    " + x.url : "")); if (x.url) cited[x.url] = 1; });
    }
    var rest = members.filter(function (m) { return !m.url || !cited[m.url]; });
    if (rest.length) {
      lines.push("", refs.length ? "Other reports in this event:" : "Reports in this event:");
      rest.forEach(function (m) { lines.push("• " + [m.source, m.when, m.title].filter(Boolean).join(" · ") + (m.url ? "\n    " + m.url : "")); });
    }
    lines.push("", "Reported, not verified. Check the originals before relying on it.");

    var pts = local.filter(hasLL).map(function (r) { return { lat: +r.lat, lon: +r.lon, prec: r.prec }; });
    if (pts.length) pts.slice().sort(function (a, b) { return (PRANK[b.prec] || 2) - (PRANK[a.prec] || 2); })[0].main = true;
    return {
      kind: "event", title: title, text: lines.join("\n"), link: key ? deepLink(key, cc) : base() + "#" + (cc === "th" ? "" : cc + "/") + "timeline",
      pic: { head: title, sub: "Event · " + members.length + " reports · " + nsrc + " sources" + (when && when.main ? " · " + when.main : ""),
        where: where && !/^No report/.test(where.main) ? where.main : "", tag: "Reported, not verified", tag2: tagT ? "Summary: " + tagT : "", pts: pts }
    };
  }

  /* ---------- map picture ---------- */
  var W = 1200, H = 630, BAND = 200;
  function merc(lat, lon, z) {
    var s = 256 * Math.pow(2, z), la = Math.max(-85, Math.min(85, lat)), sn = Math.sin(la * Math.PI / 180);
    return [(lon + 180) / 360 * s, (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * s];
  }
  function pickZoom(pts, zmax) {
    var main = pts.filter(function (p) { return p.main; })[0] || pts[0];
    var z = Math.min(zmax, main.prec === "province" ? 7 : 9);
    for (; z > 3; z--) {
      var xs = pts.map(function (p) { return merc(p.lat, p.lon, z); });
      var w = Math.max.apply(null, xs.map(function (x) { return x[0]; })) - Math.min.apply(null, xs.map(function (x) { return x[0]; }));
      var h = Math.max.apply(null, xs.map(function (x) { return x[1]; })) - Math.min.apply(null, xs.map(function (x) { return x[1]; }));
      if (w < W - 240 && h < H - BAND - 120) break;
    }
    return z;
  }
  function loadImg(src, cors, ms) {
    return new Promise(function (res) {
      var im = new Image(), t = setTimeout(function () { res(null); }, ms || 5000);
      if (cors) im.crossOrigin = "anonymous";
      im.onload = function () { clearTimeout(t); res(im); };
      im.onerror = function () { clearTimeout(t); res(null); };
      im.src = src;
    });
  }
  function outlines(ctx, z, ox, oy, land) {
    /* the 28 researched countries sit in COUNTRY_BASE, every other country in WORLD_BASE */
    var fs = [].concat((window.COUNTRY_BASE && window.COUNTRY_BASE.features) || [], (window.WORLD_BASE && window.WORLD_BASE.features) || []);
    if (!fs.length) return false;
    ctx.save(); ctx.lineJoin = "round";
    fs.forEach(function (f) {
      var g = f.geometry; if (!g) return;
      var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      ctx.beginPath();
      var any = false;
      polys.forEach(function (poly) {
        poly.forEach(function (ring) {
          var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, pp = ring.map(function (c) {
            var p = merc(c[1], c[0], z), x = p[0] - ox, y = p[1] - oy;
            if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
            return [x, y];
          });
          if (maxx < -50 || minx > W + 50 || maxy < -50 || miny > H + 50) return;
          any = true;
          pp.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
          ctx.closePath();
        });
      });
      if (!any) return;
      if (land) { ctx.fillStyle = "#eef1f4"; ctx.fill("evenodd"); }
      ctx.strokeStyle = land ? "#9aa6b2" : "rgba(60,72,86,.55)"; ctx.lineWidth = land ? 1.4 : 1.2; ctx.stroke();
    });
    ctx.restore();
    return true;
  }
  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(t).width <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = words[i]; if (lines.length === maxLines) { cur = null; break; } }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines || (cur === null)) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/[\s,.;:]+$/, "") + "…";
    }
    return lines;
  }
  function chip(ctx, x, y, text, fg, bg) {
    ctx.font = "600 19px system-ui,-apple-system,Segoe UI,sans-serif";
    var w = ctx.measureText(text).width + 22;
    ctx.fillStyle = bg; roundRect(ctx, x, y, w, 30, 15); ctx.fill();
    ctx.fillStyle = fg; ctx.fillText(text, x + 11, y + 21);
    return x + w + 10;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawPicture(pic) {
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    var pts = pic.pts || [], main = pts.filter(function (p) { return p.main; })[0] || pts[0];
    var z = pts.length ? pickZoom(pts, 9) : 4, ox = 0, oy = 0;
    function centre() { if (main) { var c = merc(main.lat, main.lon, z); ox = c[0] - W / 2; oy = c[1] - (H - BAND) / 2 - 10; } }
    centre();
    function base0() { ctx.fillStyle = "#cfdbe6"; ctx.fillRect(0, 0, W, H); }
    function finish(credit) {
      if (main) {
        pts.forEach(function (p) {
          if (p === main) return;
          var q = merc(p.lat, p.lon, z);
          ctx.beginPath(); ctx.arc(q[0] - ox, q[1] - oy, 7, 0, 7); ctx.fillStyle = "#ef6c00"; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke();
        });
        var m = merc(main.lat, main.lon, z), mx = m[0] - ox, my = m[1] - oy;
        ctx.beginPath(); ctx.arc(mx, my, 26, 0, 7); ctx.fillStyle = "rgba(198,40,40,.18)"; ctx.fill();
        ctx.beginPath(); ctx.arc(mx, my, 12, 0, 7); ctx.fillStyle = "#c62828"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
        var lab = String(pic.where || "").split(",")[0].trim();
        if (lab) {
          ctx.font = "700 22px system-ui,-apple-system,Segoe UI,sans-serif"; ctx.lineJoin = "round";
          var lw = ctx.measureText(lab).width, lx = mx + 34 + lw > W - 16 ? mx - 34 - lw : mx + 34;
          ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.strokeText(lab, lx, my + 8);
          ctx.fillStyle = "#141b23"; ctx.fillText(lab, lx, my + 8);
        }
      }
      /* text band */
      ctx.fillStyle = "rgba(20,27,35,.92)"; ctx.fillRect(0, H - BAND, W, BAND);
      ctx.fillStyle = "#fff"; ctx.font = "700 34px system-ui,-apple-system,Segoe UI,sans-serif";
      var hl = wrap(ctx, pic.head || "", W - 64, 2), y = H - BAND + 46;
      hl.forEach(function (l) { ctx.fillText(l, 32, y); y += 40; });
      ctx.fillStyle = "#c9d3dd"; ctx.font = "400 20px system-ui,-apple-system,Segoe UI,sans-serif";
      ctx.fillText(wrap(ctx, [pic.sub, pic.where].filter(Boolean).join(" · "), W - 64, 1)[0] || "", 32, y + 2);
      var x = chip(ctx, 32, H - 44, pic.tag, "#1b1300", "#f5c877");
      if (pic.tag2) x = chip(ctx, x, H - 44, pic.tag2, "#e8edf2", "rgba(255,255,255,.16)");
      ctx.fillStyle = "#9fb0c0"; ctx.font = "400 14px system-ui,-apple-system,Segoe UI,sans-serif";
      var cr = credit + " · AXIOM OSAP"; ctx.fillText(cr, W - 24 - ctx.measureText(cr).width, H - 22);
      return logo().then(function (im) {
        ctx.fillStyle = "rgba(255,255,255,.93)"; roundRect(ctx, 20, 18, im ? 232 : 176, 52, 26); ctx.fill();
        if (im) ctx.drawImage(im, 26, 22, 44, 44);
        ctx.fillStyle = "#141b23"; ctx.font = "800 22px system-ui,-apple-system,Segoe UI,sans-serif"; ctx.fillText("AXIOM OSAP", im ? 78 : 36, 52);
        return cv;
      });
    }
    base0();
    if (!main) { outlines(ctx, z, merc(15, 100, z)[0] - W / 2, merc(15, 100, z)[1] - (H - BAND) / 2, true); return finish("Outlines: Natural Earth"); }
    /* live tiles first; a tile the browser will not let a picture use (no CORS) spoils the canvas, so check and fall back */
    var x0 = Math.floor(ox / 256), x1 = Math.floor((ox + W) / 256), y0 = Math.floor(oy / 256), y1 = Math.floor((oy + H) / 256), n = Math.pow(2, z), jobs = [];
    for (var tx = x0; tx <= x1; tx++) for (var ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      (function (tx, ty) {
        var wx = ((tx % n) + n) % n;
        jobs.push(loadImg(ESRI.replace("{z}", z).replace("{y}", ty).replace("{x}", wx), true, 4500).then(function (im) { return { im: im, x: tx * 256 - ox, y: ty * 256 - oy }; }));
      })(tx, ty);
    }
    return Promise.all(jobs).then(function (ts) {
      var got = ts.filter(function (t) { return t.im; });
      if (got.length >= ts.length * 0.6) {
        got.forEach(function (t) { ctx.drawImage(t.im, t.x, t.y, 256, 256); });
        try { ctx.getImageData(0, 0, 1, 1); outlines(ctx, z, ox, oy, false); return finish("Map: Esri, Natural Earth"); }
        catch (e) {}
      }
      cv = document.createElement("canvas"); cv.width = W; cv.height = H; ctx = cv.getContext("2d"); base0();
      z = pickZoom(pts, 6); centre(); outlines(ctx, z, ox, oy, true);
      return finish("Outlines: Natural Earth");
    });
  }
  var logoP = null;
  function logo() {
    if (!logoP) {
      var el = document.querySelector("img.logo") || document.querySelector('img[src*="logo"]');
      logoP = el && el.src ? loadImg(el.src, false, 3000) : Promise.resolve(null);
    }
    return logoP;
  }

  /* ---------- the sheet ---------- */
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); return ok;
  }
  function open(d) {
    var old = document.getElementById("oshdlg"); if (old) old.remove();
    var dlg = document.createElement("div"); dlg.id = "oshdlg"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-labelledby", "osh-h");
    var canShare = !!navigator.share;
    dlg.innerHTML = '<div class="oshbox"><div class="pkghead"><h2 id="osh-h">Share this ' + (d.kind === "event" ? "event" : "story") + '</h2><button type="button" class="x" aria-label="Close">×</button></div>' +
      '<div class="oshpic"><span class="obs">Drawing the map picture…</span></div>' +
      '<label class="oshlbl" for="osh-t">Message</label><textarea id="osh-t" readonly rows="7"></textarea>' +
      '<p class="oshlink"><span class="obs">Opens on the OSAP map:</span> <a target="_blank" rel="noopener" href="' + esc(d.link) + '">' + esc(d.link.replace(/^https?:\/\//, "")) + "</a></p>" +
      '<label class="oshinc" hidden><input type="checkbox" checked> Include the map picture</label>' +
      '<div class="oshbtns">' + (canShare ? '<button type="button" class="refresh primary oshgo" data-osh="share">Share…</button>' : "") +
        '<button type="button" class="refresh" data-osh="copy">Copy text and link</button><button type="button" class="refresh" data-osh="link">Copy link</button>' +
        '<button type="button" class="refresh oshsave" data-osh="save" hidden>Save picture</button></div>' +
      '<p class="obs oshmsg" role="status" aria-live="polite"></p>' +
      '<p class="obs">The source, the link to the original and "Reported, not verified" always go with what you share.' + (d.kind === "event" ? " The Summary keeps its " + "“AI generated” or “Automatic” tag." : "") + "</p></div>";
    document.body.appendChild(dlg);
    var ta = dlg.querySelector("textarea"), msg = dlg.querySelector(".oshmsg"), inc = dlg.querySelector(".oshinc"), save = dlg.querySelector(".oshsave");
    var full = d.text + "\nOpen on the OSAP map: " + d.link;
    ta.value = full;
    var file = null, blobUrl = null;
    function close() { dlg.remove(); document.removeEventListener("keydown", onKey); if (blobUrl) URL.revokeObjectURL(blobUrl); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    dlg.addEventListener("click", function (e) { if (e.target === dlg || (e.target.classList && e.target.classList.contains("x"))) close(); });
    drawPicture(d.pic).then(function (cv) {
      return new Promise(function (res) { try { cv.toBlob(function (b) { res({ cv: cv, b: b }); }, "image/png"); } catch (e) { res({ cv: cv, b: null }); } });
    }).then(function (o) {
      var box = dlg.querySelector(".oshpic");
      if (!o.b) { box.innerHTML = '<span class="obs">The map picture could not be made in this browser.</span>'; return; }
      blobUrl = URL.createObjectURL(o.b);
      box.innerHTML = '<img alt="Map picture: ' + esc(d.pic.head) + '" src="' + blobUrl + '">';
      save.hidden = false;
      try {
        var f = new File([o.b], "osap-" + d.kind + ".png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { file = f; inc.hidden = false; }
      } catch (e) {}
    }).catch(function () { dlg.querySelector(".oshpic").innerHTML = '<span class="obs">The map picture could not be made in this browser.</span>'; });
    function say(t) { msg.textContent = t; }
    dlg.querySelector(".oshbtns").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-osh]"); if (!b) return;
      var k = b.getAttribute("data-osh");
      if (k === "save") { if (blobUrl) { var a = document.createElement("a"); a.href = blobUrl; a.download = "osap-" + d.kind + ".png"; document.body.appendChild(a); a.click(); a.remove(); } }
      else if (k === "copy") copyText(full).then(function (ok) { say(ok ? "Copied the text and link." : "Could not copy here. Select the message above and copy it."); if (!ok) { ta.focus(); ta.select(); } });
      else if (k === "link") copyText(d.link).then(function (ok) { say(ok ? "Copied the link." : "Could not copy here. Long-press or right-click the link to copy it."); });
      else if (k === "share") {
        var withPic = file && inc.querySelector("input").checked;
        /* with a file some apps drop the url field, so the link rides in the text too */
        var p = withPic ? { files: [file], title: d.title, text: full } : { title: d.title, text: d.text, url: d.link };
        navigator.share(p).then(function () { say("Shared."); }, function (err) {
          if (err && err.name === "AbortError") return;
          copyText(full).then(function (ok) { say(ok ? "This device could not open its share menu, so the text and link were copied instead." : "This device could not share or copy. Select the message above and copy it."); });
        });
      }
    });
    var first = dlg.querySelector("[data-osh]"); if (first) first.focus();
  }

  /* ---------- the Share button on every open Report and Event ---------- */
  function data(box) {
    if (box.querySelector(".evlist")) return eventData(box);
    var fp = box.querySelector("code.fp[data-fp]"), r = fp && byId(fp.getAttribute("data-fp"));
    return r ? storyData(box, r) : null;
  }
  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll(".pkghead"), function (h) {
      var box = h.parentNode; if (!box || box.id === "oshdlg" || box.classList.contains("oshbox") || h.querySelector(".osh")) return;
      if (!box.querySelector(".evlist") && !box.querySelector("code.fp[data-fp]")) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "osh"; b.title = "Share"; b.setAttribute("aria-label", "Share " + (box.querySelector(".evlist") ? "this event" : "this story"));
      b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span>Share</span>';
      b.addEventListener("click", function () { var d = data(box); if (d) open(d); });
      var x = h.querySelector(".x"); h.insertBefore(b, x || null);
    });
  }
  var queued = false;
  new MutationObserver(function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan(); }); })
    .observe(document.body, { childList: true, subtree: true });
  scan();

  /* ---------- opening a shared link ---------- */
  if (/[?&]wopen=/.test(location.search) && /[?&]s=1(&|$)/.test(location.search)) {
    var A = window.alert, mine = function (m) {
      if (/no longer in this build/.test(String(m))) { gone(); return; }
      return A.apply(window, arguments);
    };
    window.alert = mine;
    setTimeout(function () { if (window.alert === mine) window.alert = A; }, 60000);
  }
  function gone() {
    var n = document.createElement("div"); n.className = "oshgone"; n.setAttribute("role", "status");
    n.innerHTML = '<span>This shared story has dropped out of OSAP\'s current feed, which keeps recent reports only. The message you were sent has the link to the original.</span><button type="button" aria-label="Close">×</button>';
    document.body.appendChild(n);
    n.querySelector("button").addEventListener("click", function () { n.remove(); });
    setTimeout(function () { if (n.parentNode) n.remove(); }, 15000);
  }

  var st = document.createElement("style");
  st.textContent = ".pkghead .osh{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;font-weight:600;color:var(--accent,#1d5a86);background:none;border:1px solid var(--line,#c5ced8);border-radius:14px;padding:2px 9px;cursor:pointer}" +
    ".pkghead .osh:hover{background:var(--accent-soft,#d6e3ee)}.pkghead .osh + .x{margin-left:6px}" +
    "html.phone .pkghead .osh{min-height:36px;padding:4px 12px;font-size:13px}" +
    "#oshdlg{position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
    ".oshbox{background:var(--surface,#fff);color:var(--ink,#111);max-width:640px;width:100%;border-radius:6px;padding:12px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35)}" +
    ".oshpic{margin:10px 0;min-height:60px;display:flex;align-items:center;justify-content:center;background:var(--surface2,#e7ebf0);border-radius:4px}" +
    ".oshpic img{display:block;width:100%;height:auto;border-radius:4px}" +
    ".oshlbl{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#56626f);margin:6px 0 3px}" +
    "#osh-t{width:100%;box-sizing:border-box;font:12.5px/1.4 system-ui,-apple-system,sans-serif;color:inherit;background:var(--paper,#dee3e9);border:1px solid var(--line,#c5ced8);border-radius:4px;padding:6px 8px;resize:vertical}" +
    ".oshlink{font-size:12px;margin:6px 0;overflow-wrap:anywhere}.oshinc{display:flex;align-items:center;gap:6px;font-size:13px;margin:6px 0}.oshinc[hidden],.oshsave[hidden]{display:none!important}" +
    ".oshbtns{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px}.oshbtns .oshgo{font-weight:700}" +
    ".oshmsg:empty{display:none}" +
    ".oshgone{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100003;max-width:min(560px,calc(100vw - 32px));display:flex;gap:10px;align-items:flex-start;background:var(--ink,#141b23);color:var(--surface,#fff);padding:10px 14px;border-radius:6px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.35)}" +
    ".oshgone button{background:none;border:none;color:inherit;font-size:18px;line-height:1;cursor:pointer}" +
    "@media (max-width:700px){#oshdlg{padding:0}.oshbox{border-radius:0;min-height:100%}}";
  document.head.appendChild(st);
})();
