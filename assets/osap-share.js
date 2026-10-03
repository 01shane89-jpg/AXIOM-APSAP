/* AXIOM OSAP: share a story or an event.
   Self-contained block loaded after the main page script. It adds a Share button to the head of every open Report (one story)
   and Event (reports grouped as one incident). Share opens a small sheet with:
   - the text that will be sent, always with the source, the link to the original and the "Reported, not verified" label;
     an Event also carries its Summary (from assets/osap-evsum.js) with its "AI generated" or "Automatic" tag and every source link;
   - a link that opens OSAP on that story on the map (the same ?wopen= link watch alerts use, plus s=1 to mark it as shared);
   - a map picture drawn here: the place on the map with a pin, the headline, source and status.
   - a full report (PDF): the map with the story in red and its connected stories as numbered dots, the report, and every connected
     story (or, for an Event, its Summary and every report) with its live source link and SHA-256 fingerprint. Messaging apps such as
     Signal take a PDF as an attachment and a phone opens it with every link tappable, so no account, key or server is involved.
   Send as: Full report (default), Map picture or Message only; the message text always rides along with its own live links.
   Buttons: Share (the device's share menu, Web Share API), Copy message, Copy link, Save report (PDF), Save picture. Nothing leaves the device unless the user picks a share target; OSAP stores nothing about it.
   It never changes a record, an event, a claim status or a summary. The map picture uses the Esri light canvas tiles when the
   browser may draw them into a picture, otherwise the packaged Natural Earth outlines (data/basemap/world-outlines.js).
   Opening a shared link whose story has since dropped out of the feed shows a short note instead of the watch-alert message. */
(function () {
  "use strict";
  var LIVE = "https://osap-app.github.io/";
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
    var rel = relItems(box).filter(function (x) { return x.url; }).slice(0, 8);
    if (rel.length) {
      lines.push("", "Connected stories (matched automatically, not a confirmed link):");
      rel.forEach(function (x) { lines.push("• " + [x.source, x.title].filter(Boolean).join(": ") + "\n    " + x.url); });
    }
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
      var r = rb ? byId(rb.getAttribute("data-ev-rec")) : null;
      members.push({ source: src, title: clean((m.querySelector(".tln") || {}).textContent), when: clean((m.querySelector(".tlt") || {}).textContent), url: a ? safeUrl(a.getAttribute("href")) : "", rec: r });
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
    var ev = box.querySelector(".evsum"), refs = [], tagT = "", blocks = [], note = "";
    if (ev && ev.querySelector(".evstext")) {
      var tag = ev.querySelector(".aitag");
      tagT = tag ? clean(tag.textContent) : "";
      lines.push("", "Summary" + (tagT ? " [" + tagT + (tag.title ? ": " + clean(tag.title).replace(/\.$/, "") : "") + "]" : ""));
      Array.prototype.forEach.call(ev.children, function (el) {
        if (el.classList.contains("evstext")) { lines.push(clean(el.textContent)); blocks.push({ t: "p", text: clean(el.textContent) }); }
        else if (el.tagName === "UL") Array.prototype.forEach.call(el.children, function (li) { lines.push("• " + clean(li.textContent)); blocks.push({ t: "li", text: clean(li.textContent) }); });
        else if (el.tagName === "H5") { lines.push(clean(el.textContent) + ":"); blocks.push({ t: "h", text: clean(el.textContent) }); }
        else if (el.tagName === "P" && /^Not established/.test(clean(el.textContent))) { lines.push(clean(el.textContent)); blocks.push({ t: "p", text: clean(el.textContent) }); }
        else if (el.classList.contains("evsfrom")) Array.prototype.forEach.call(el.querySelectorAll("ol > li"), function (li) {
          var a = li.querySelector("a[href]"); refs.push({ text: clean(li.textContent), url: a ? safeUrl(a.getAttribute("href")) : "" });
        });
      });
      note = /^AI/i.test(tagT) ? "Written by a language model from the reports' headlines and summaries. Statements are what the sources said, not confirmed facts."
        : "Put together by fixed rules (no AI) from each source's own words and figures. Nothing is inferred.";
      lines.push(note);
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
      kind: "event", title: title, text: lines.join("\n"),
      ev: { members: members, refs: refs, blocks: blocks, tag: tagT, note: note, nsrc: nsrc, when: when && when.main ? when.main : "", where: where && !/^No report/.test(where.main) ? where.main : "" }, link: key ? deepLink(key, cc) : base() + "#" + (cc === "th" ? "" : cc + "/") + "timeline",
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
  function pickZoom(pts, zmax, fw, fh) {
    fw = fw || W - 240; fh = fh || H - BAND - 120;
    var main = pts.filter(function (p) { return p.main; })[0] || pts[0];
    var z = Math.min(zmax, main.prec === "province" ? 7 : 9);
    for (; z > 3; z--) {
      var xs = pts.map(function (p) { return merc(p.lat, p.lon, z); });
      var w = Math.max.apply(null, xs.map(function (x) { return x[0]; })) - Math.min.apply(null, xs.map(function (x) { return x[0]; }));
      var h = Math.max.apply(null, xs.map(function (x) { return x[1]; })) - Math.min.apply(null, xs.map(function (x) { return x[1]; }));
      if (w < fw && h < fh) break;
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
  function outlines(ctx, z, ox, oy, land, cw, ch) {
    cw = cw || W; ch = ch || H;
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
          if (maxx < -50 || minx > cw + 50 || maxy < -50 || miny > ch + 50) return;
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
          var room = Math.max(W - mx - 50, mx - 50), right = mx + 34 + ctx.measureText(lab).width <= W - 16 || W - mx >= mx;
          if (ctx.measureText(lab).width > room) { while (lab.length > 4 && ctx.measureText(lab + "…").width > room) lab = lab.slice(0, -1); lab = lab.replace(/[\s,.;:(]+$/, "") + "…"; }
          var lw = ctx.measureText(lab).width, lx = right ? mx + 34 : mx - 34 - lw;
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

  /* ---------- the full report: a PDF file with the map, the report and its connected stories, every link live ----------
     Messaging apps (Signal, WhatsApp, email) take a PDF as an attachment, and a phone opens it with every link tappable, so
     the whole report travels as one file with no account, key or server. Pages are drawn on a canvas (any script, the
     page's own fonts) and wrapped in a small PDF written here; each link becomes a PDF link annotation over its text. */
  var PW = 1240, PH = 1754, PM = 84, PTOP = 150, PBOT = PH - 104, PT = 595.28 / PW;
  var SANS = "system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans',sans-serif", MONO = "ui-monospace,Menlo,Consolas,'Liberation Mono',monospace";
  var MAPW = PW - 2 * PM, MAPH = 600;

  function sha(text) {
    try {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      }, function () { return ""; });
    } catch (e) { return Promise.resolve(""); }
  }
  /* a packaged record carries the page's own record fingerprint; a listing from outside the build gets a hash of what is listed */
  function recFp(r) {
    var T = window.TSAP || {}, F = T.fingerprints || {};
    if (F[r.id]) return Promise.resolve(F[r.id]);
    return T.fingerprint ? T.fingerprint(r).then(null, function () { return ""; }) : Promise.resolve("");
  }
  function itemFp(it) {
    if (it.rec) return recFp(it.rec).then(function (h) { return { fp: h, fpKind: "record" }; });
    return sha([it.title, it.source, it.when, it.url].join("\n")).then(function (h) { return { fp: h, fpKind: "listing" }; });
  }
  function kmBetween(a, b) {
    var R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /* every dt/dd pair of a definition list, as the page shows it */
  function rows(dl) {
    var out = [];
    if (dl) Array.prototype.forEach.call(dl.querySelectorAll("dt"), function (dt) {
      var dd = dt.nextElementSibling; if (!dd || dd.tagName !== "DD") return;
      var c = dd.cloneNode(true), subs = [], a = dd.querySelector("a[href]");
      Array.prototype.forEach.call(c.querySelectorAll(".sub"), function (s) { subs.push(clean(s.textContent)); s.remove(); });
      out.push({ label: clean(dt.textContent), main: clean(c.textContent), subs: subs, url: a ? safeUrl(a.getAttribute("href")) : "" });
    });
    return out;
  }
  /* the Report's own "Related reports" tab and its "Related records" list, in that order, social posts last */
  function relItems(box) {
    var out = [], soc = [], seen = {};
    function add(o, list) { var k = o.rec ? "r" + o.rec.id : o.url || o.title; if (!k || seen[k]) return; seen[k] = 1; list.push(o); }
    var pane = box.querySelector('.pkgpane[data-pane="rel"]');
    if (pane) Array.prototype.forEach.call(pane.querySelectorAll(".relrow"), function (rw) {
      var b = rw.querySelector("[data-id]"), a = rw.querySelector("a.rellink"), rec = b ? byId(b.getAttribute("data-id")) : null;
      var tlt = clean((rw.querySelector(".tlt") || {}).textContent).split(" · "), tls = clean((rw.querySelector(".tls") || {}).textContent).split(" · ");
      var src = rec && rec.src ? rec.src.name : "";
      if (src && tls[0] === src) tls.shift(); else if (!rec && tls.length > 1) src = tls.shift();
      var o = { kind: tlt[0] || "", when: tlt.slice(1).join(" · "), title: clean((rw.querySelector(".tln") || {}).textContent), source: src,
        why: tls.join(" · "), url: a ? safeUrl(a.getAttribute("href")) : rec ? safeUrl(rec.url) : "", rec: rec };
      add(o, /^Social/.test(o.kind) ? soc : out);
    });
    Array.prototype.forEach.call(box.querySelectorAll('.pkgpane[data-pane="rep"] .pkgrel [data-id]'), function (b) {
      var rec = byId(b.getAttribute("data-id")); if (!rec) return;
      add({ kind: "Nearby record", when: clean((b.querySelector(".tlt") || {}).textContent), title: rec.title, source: rec.src ? rec.src.name : "",
        why: "within 25 km and 30 days", url: safeUrl(rec.url), rec: rec }, out);
    });
    return out.slice(0, 16).concat(soc.slice(0, 6));
  }

  /* ---------- map for the report: the story in red, connected items that have a place as numbered dots ---------- */
  function drawMap(pts, w, h) {
    var main = pts.filter(function (p) { return p.main; })[0] || pts[0];
    if (!main) return Promise.resolve(null);
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d"), z, ox, oy;
    function frame(zmax) {
      z = pickZoom(pts, zmax, w - 160, h - 110);
      var xs = pts.map(function (p) { return merc(p.lat, p.lon, z); });
      var cx = (Math.min.apply(null, xs.map(function (x) { return x[0]; })) + Math.max.apply(null, xs.map(function (x) { return x[0]; }))) / 2;
      var cy = (Math.min.apply(null, xs.map(function (x) { return x[1]; })) + Math.max.apply(null, xs.map(function (x) { return x[1]; }))) / 2;
      ox = cx - w / 2; oy = cy - h / 2;
    }
    function bg() { ctx.fillStyle = "#cfdbe6"; ctx.fillRect(0, 0, w, h); }
    function marks(credit) {
      var m = merc(main.lat, main.lon, z), mx = m[0] - ox, my = m[1] - oy, lab = String(main.label || "").split(",")[0].trim(), lx = 0, lw = 0;
      ctx.font = "700 22px " + SANS;
      if (lab) {
        /* the label goes on the side with room, cut short with an ellipsis if even that is too narrow */
        var room = Math.max(w - mx - 52, mx - 52), right = mx + 36 + ctx.measureText(lab).width <= w - 16 || w - mx >= mx;
        if (ctx.measureText(lab).width > room) { while (lab.length > 4 && ctx.measureText(lab + "…").width > room) lab = lab.slice(0, -1); lab = lab.replace(/[\s,.;:(]+$/, "") + "…"; }
        lw = ctx.measureText(lab).width; lx = right ? mx + 36 : mx - 36 - lw;
      }
      /* numbered dots never cover each other, the red pin or its label: a crowded one moves out along a short line from its true place */
      var placed = [{ x: mx, y: my, r: 30 }], boxes = lab ? [{ x0: lx - 6, x1: lx + lw + 6, y0: my - 18, y1: my + 14 }] : [];
      function free(x, y) {
        if (x < 18 || y < 18 || x > w - 18 || y > h - 60) return false;
        for (var i = 0; i < placed.length; i++) if (Math.hypot(placed[i].x - x, placed[i].y - y) < placed[i].r + 18) return false;
        for (var j = 0; j < boxes.length; j++) if (x > boxes[j].x0 - 16 && x < boxes[j].x1 + 16 && y > boxes[j].y0 - 16 && y < boxes[j].y1 + 16) return false;
        return true;
      }
      var spots = pts.filter(function (p) { return p !== main; }).map(function (p) {
        var q = merc(p.lat, p.lon, z), x = q[0] - ox, y = q[1] - oy, px = x, py = y;
        search: for (var d = 0; d <= 240; d += 18) for (var k = 0; k < (d ? 16 : 1); k++) {
          var a = -Math.PI / 2 + k * Math.PI / 8, cx = x + d * Math.cos(a), cy = y + d * Math.sin(a);
          if (free(cx, cy)) { px = cx; py = cy; break search; }
        }
        placed.push({ x: px, y: py, r: 16 });
        return { p: p, x: x, y: y, px: px, py: py };
      });
      ctx.beginPath(); ctx.arc(mx, my, 28, 0, 7); ctx.fillStyle = "rgba(198,40,40,.18)"; ctx.fill();
      spots.forEach(function (s) {
        if (Math.hypot(s.px - s.x, s.py - s.y) < 2) return;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.px, s.py); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(20,27,35,.55)"; ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fillStyle = "#ef6c00"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
      });
      spots.forEach(function (s) {
        ctx.beginPath(); ctx.arc(s.px, s.py, 15, 0, 7); ctx.fillStyle = "#ef6c00"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "700 16px " + SANS; ctx.textAlign = "center"; ctx.fillText(String(s.p.n), s.px, s.py + 6); ctx.textAlign = "left";
      });
      ctx.beginPath(); ctx.arc(mx, my, 13, 0, 7); ctx.fillStyle = "#c62828"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
      if (lab) {
        ctx.font = "700 22px " + SANS; ctx.lineJoin = "round";
        ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.strokeText(lab, lx, my + 8); ctx.fillStyle = "#141b23"; ctx.fillText(lab, lx, my + 8);
      }
      /* scale bar */
      var mpp = 156543.03 * Math.cos(main.lat * Math.PI / 180) / Math.pow(2, z), want = 160 * mpp, nice = [1, 2, 5], d = 1;
      for (var e = 1; e < 8; e++) for (var i = 0; i < 3; i++) { var v = nice[i] * Math.pow(10, e); if (v <= want) d = v; }
      var px = d / mpp, lbl = d >= 1000 ? d / 1000 + " km" : d + " m";
      ctx.fillStyle = "rgba(255,255,255,.88)"; roundRect(ctx, 14, h - 50, px + 90, 36, 6); ctx.fill();
      ctx.fillStyle = "#141b23"; ctx.fillRect(26, h - 30, px, 4); ctx.fillRect(26, h - 38, 3, 12); ctx.fillRect(26 + px - 3, h - 38, 3, 12);
      ctx.font = "600 16px " + SANS; ctx.fillText(lbl, 34 + px, h - 24);
      ctx.font = "400 14px " + SANS; var cw = ctx.measureText(credit).width;
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(w - cw - 20, h - 26, cw + 20, 26); ctx.fillStyle = "#3b4652"; ctx.fillText(credit, w - cw - 10, h - 8);
      return { cv: cv, credit: credit };
    }
    frame(9); bg();
    var x0 = Math.floor(ox / 256), x1 = Math.floor((ox + w) / 256), y0 = Math.floor(oy / 256), y1 = Math.floor((oy + h) / 256), n = Math.pow(2, z), jobs = [];
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
        try { ctx.getImageData(0, 0, 1, 1); outlines(ctx, z, ox, oy, false, w, h); return marks("Map: Esri, Natural Earth"); } catch (e) {}
      }
      cv = document.createElement("canvas"); cv.width = w; cv.height = h; ctx = cv.getContext("2d");
      frame(7); bg(); outlines(ctx, z, ox, oy, true, w, h);
      return marks("Outlines: Natural Earth");
    });
  }

  /* ---------- page layout on canvas ---------- */
  function Doc(label, title) { this.pages = []; this.label = label; this.title = title; this.addPage(); }
  Doc.prototype.addPage = function () {
    var cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
    var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
    this.pg = { cv: cv, ctx: ctx, links: [] }; this.pages.push(this.pg); this.ctx = ctx;
    this.y = this.pages.length === 1 ? PTOP + 20 : PTOP - 40;
  };
  Doc.prototype.need = function (h) { if (this.y + h > PBOT) this.addPage(); };
  function font(r, size) { return (r.bold ? "700 " : r.semi ? "600 " : "400 ") + (r.size || size) + "px " + (r.mono ? MONO : SANS); }
  /* wraps runs of text ({text, url, bold, mono, size, color}) into lines; a long word or link breaks where it must */
  Doc.prototype.text = function (runs, o) {
    o = o || {};
    var ctx = this.ctx, size = o.size || 22, lh = o.lh || Math.round(size * 1.42), x0 = o.x || PM, maxW = o.w || PW - PM - x0;
    var lines = [], cur = [], cw = 0;
    function push() { while (cur.length && /^\s+$/.test(cur[cur.length - 1].s)) cw -= cur.pop().w; lines.push(cur); cur = []; cw = 0; }
    runs.forEach(function (r) {
      ctx.font = font(r, size);
      String(r.text == null ? "" : r.text).split(/(\s+)/).forEach(function (s) {
        if (!s) return;
        if (/^\s+$/.test(s)) { if (cur.length) { var sw = ctx.measureText(" ").width; cur.push({ s: " ", r: r, w: sw }); cw += sw; } return; }
        var tw = ctx.measureText(s).width;
        if (cw + tw > maxW && cur.length && tw <= maxW) push();
        while (ctx.measureText(s).width > maxW - cw) {
          if (cur.length && maxW - cw < 60) { push(); continue; }
          var k = 1; while (k < s.length && ctx.measureText(s.slice(0, k + 1)).width <= maxW - cw) k++;
          var part = s.slice(0, k); cur.push({ s: part, r: r, w: ctx.measureText(part).width }); push(); s = s.slice(k);
        }
        if (s) { tw = ctx.measureText(s).width; cur.push({ s: s, r: r, w: tw }); cw += tw; }
      });
    });
    if (cur.length) push();
    var self = this;
    lines.forEach(function (ln) {
      self.need(lh); var c = self.ctx, x = x0, base = self.y + Math.round(size * 1.08);
      ln.forEach(function (p) {
        c.font = font(p.r, size); c.fillStyle = p.r.url ? "#0b57d0" : p.r.color || o.color || "#141b23"; c.fillText(p.s, x, base);
        if (p.r.url) {
          c.fillRect(x, base + 3, p.w, 1.5);
          var L = self.pg.links, last = L[L.length - 1];
          if (last && last.url === p.r.url && Math.abs(last.y - self.y) < 1 && Math.abs(last.x + last.w - x) < 12) last.w = x + p.w - last.x;
          else L.push({ x: x, y: self.y, w: p.w, h: lh, url: p.r.url });
        }
        x += p.w;
      });
      self.y += lh;
    });
    return this;
  };
  Doc.prototype.gap = function (h) { this.y += h; return this; };
  Doc.prototype.h2 = function (t) {
    this.need(110); this.gap(18);
    var c = this.ctx; c.fillStyle = "#1d5a86"; c.fillRect(PM, this.y, 6, 34);
    this.text([{ text: t, bold: true }], { size: 28, x: PM + 20, lh: 36 }); return this.gap(10);
  };
  Doc.prototype.chips = function (list) {
    this.need(44); var c = this.ctx, x = PM;
    list.forEach(function (ch) {
      c.font = "600 18px " + SANS; var w = c.measureText(ch.text).width + 24;
      c.fillStyle = ch.bg; roundRect(c, x, this.y, w, 32, 16); c.fill(); c.fillStyle = ch.fg; c.fillText(ch.text, x + 12, this.y + 22); x += w + 10;
    }, this);
    this.y += 44; return this;
  };
  /* label: value rows, the grey sub-lines under the value */
  Doc.prototype.kv = function (label, runs, subs) {
    var y0 = this.y, pages = this.pages.length;
    this.need(34);
    if (this.pages.length !== pages) y0 = this.y;
    this.ctx.font = "600 19px " + SANS; this.ctx.fillStyle = "#56626f"; this.ctx.fillText(label, PM, this.y + 23);
    this.text(runs, { x: PM + 250, size: 21 });
    (subs || []).forEach(function (s) { this.text(typeof s === "string" ? [{ text: s }] : s, { x: PM + 250, size: 17, color: "#56626f", lh: 25 }); }, this);
    return this.gap(8);
  };
  Doc.prototype.figure = function (map, caption) {
    if (!map) return this;
    var h = Math.round(map.cv.height * MAPW / map.cv.width);
    this.need(h + 70);
    this.ctx.drawImage(map.cv, PM, this.y, MAPW, h); this.ctx.strokeStyle = "#9aa6b2"; this.ctx.lineWidth = 1; this.ctx.strokeRect(PM + 0.5, this.y + 0.5, MAPW - 1, h - 1);
    this.y += h + 8;
    return this.text(caption, { size: 17, color: "#56626f", lh: 24 }).gap(6);
  };
  /* one connected story: number, headline, what it is, the live source link and its fingerprint */
  Doc.prototype.item = function (it) {
    this.need(120);
    var c = this.ctx, y = this.y;
    c.fillStyle = it.onMap ? "#ef6c00" : "#e3e8ee"; c.beginPath(); c.arc(PM + 17, y + 17, 16, 0, 7); c.fill();
    c.fillStyle = it.onMap ? "#fff" : "#3b4652"; c.font = "700 16px " + SANS; c.textAlign = "center"; c.fillText(String(it.n), PM + 17, y + 23); c.textAlign = "left";
    var X = PM + 46;
    this.text([{ text: it.title || "(no headline)", semi: true }], { x: X, size: 21, lh: 29 });
    this.text([{ text: [it.kind, it.source, it.when].filter(Boolean).join(" · ") + (it.why ? " · matched: " + it.why : "") }], { x: X, size: 17, color: "#56626f", lh: 24 });
    this.text(it.url ? [{ text: "Source: ", color: "#56626f" }, { text: it.url, url: it.url }] : [{ text: "No link to the original is archived.", color: "#56626f" }], { x: X, size: 17, lh: 24 });
    if (it.fp) this.text([{ text: (it.fpKind === "record" ? "Record fingerprint (SHA-256): " : "Listing fingerprint (SHA-256 of the listed headline, source, time and link): "), color: "#56626f" }, { text: it.fp, mono: true, color: "#3b4652" }], { x: X, size: 15, lh: 21 });
    return this.gap(14);
  };
  Doc.prototype.finish = function (made, logoIm) {
    var n = this.pages.length, self = this;
    this.pages.forEach(function (pg, i) {
      var c = pg.ctx;
      if (i === 0) {
        c.fillStyle = "#141b23"; c.fillRect(0, 0, PW, 118);
        if (logoIm) c.drawImage(logoIm, PM, 22, 74, 74);
        var X = logoIm ? PM + 92 : PM;
        c.fillStyle = "#fff"; c.font = "800 34px " + SANS; c.fillText("AXIOM OSAP", X, 56);
        c.fillStyle = "#c9d3dd"; c.font = "400 21px " + SANS; c.fillText(self.label + " · Open Source Awareness Platform", X, 90);
        c.font = "400 18px " + SANS; var t = "Made " + made; c.fillText(t, PW - PM - c.measureText(t).width, 90);
      } else {
        c.fillStyle = "#56626f"; c.font = "600 17px " + SANS;
        var head = "AXIOM OSAP · " + self.label + " · ", ttl = self.title || "";
        while (ttl.length > 8 && c.measureText(head + ttl + "…").width > PW - 2 * PM) ttl = ttl.slice(0, -2);
        c.fillText(head + (ttl === self.title ? ttl : ttl + "…"), PM, 64);
        c.fillStyle = "#c5ced8"; c.fillRect(PM, 80, PW - 2 * PM, 1.5);
      }
      c.fillStyle = "#c5ced8"; c.fillRect(PM, PH - 84, PW - 2 * PM, 1.5);
      c.fillStyle = "#56626f"; c.font = "400 16px " + SANS;
      c.fillText("Reported claims from the named sources, not verified by OSAP or an analyst. Links in this file are live.", PM, PH - 56);
      var p = "Page " + (i + 1) + " of " + n; c.fillText(p, PW - PM - c.measureText(p).width, PH - 56);
    });
    return this;
  };

  /* ---------- PDF: one JPEG page image per page plus link annotations ---------- */
  function pdfStr(s) {
    var h = "FEFF";
    for (var i = 0; i < s.length; i++) h += ("000" + s.charCodeAt(i).toString(16)).slice(-4);
    return "<" + h.toUpperCase() + ">";
  }
  function pdfUri(u) {
    return "(" + String(u).replace(/[^\x21-\x7e]/g, function (c) { return encodeURIComponent(c); }).replace(/[\\()]/g, "\\$&") + ")";
  }
  function pdfBytes(jpgs, links, title) {
    var enc = new TextEncoder(), parts = [], off = 0, xref = [], next = 4;
    function put(x) { var b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); off += b.length; }
    function obj(n, head, stream) {
      xref[n] = off; put(n + " 0 obj\n" + head);
      if (stream) { put("\nstream\n"); put(stream); put("\nendstream"); }
      put("\nendobj\n");
    }
    var W2 = (PW * PT).toFixed(2), H2 = (PH * PT).toFixed(2), kids = [], plan = jpgs.map(function (j, i) {
      var p = { page: next++, content: next++, img: next++, annots: links[i].map(function () { return next++; }) }; kids.push(p.page + " 0 R"); return p;
    });
    put("%PDF-1.4\n"); put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + kids.length + " >>");
    var dt = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    obj(3, "<< /Title " + pdfStr(title) + " /Producer (AXIOM OSAP) /Creator (AXIOM OSAP share) /CreationDate (D:" + dt + "Z) >>");
    plan.forEach(function (p, i) {
      obj(p.page, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W2 + " " + H2 + "] /Resources << /XObject << /Im0 " + p.img + " 0 R >> >> /Contents " + p.content + " 0 R" +
        (p.annots.length ? " /Annots [" + p.annots.map(function (a) { return a + " 0 R"; }).join(" ") + "]" : "") + " >>");
      var cs = "q " + W2 + " 0 0 " + H2 + " 0 0 cm /Im0 Do Q";
      obj(p.content, "<< /Length " + cs.length + " >>", enc.encode(cs));
      obj(p.img, "<< /Type /XObject /Subtype /Image /Width " + PW + " /Height " + PH + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpgs[i].length + " >>", jpgs[i]);
      links[i].forEach(function (l, k) {
        var x1 = l.x * PT, x2 = (l.x + l.w) * PT, y2 = (PH - l.y) * PT, y1 = (PH - l.y - l.h) * PT;
        obj(p.annots[k], "<< /Type /Annot /Subtype /Link /Rect [" + [x1, y1, x2, y2].map(function (v) { return v.toFixed(2); }).join(" ") + "] /Border [0 0 0] /A << /S /URI /URI " + pdfUri(l.url) + " >> >>");
      });
    });
    var xo = off, lines = ["xref", "0 " + next, "0000000000 65535 f "];
    for (var i = 1; i < next; i++) lines.push(("000000000" + xref[i]).slice(-10) + " 00000 n ");
    put(lines.join("\n") + "\ntrailer\n<< /Size " + next + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xo + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }
  function jpeg(cv) {
    return new Promise(function (res, rej) {
      cv.toBlob(function (b) { if (!b) return rej(new Error("no jpeg")); b.arrayBuffer().then(function (a) { res(new Uint8Array(a)); }, rej); }, "image/jpeg", 0.9);
    });
  }

  /* ---------- what goes in the report ---------- */
  function storyReport(box, d) {
    var fpEl = box.querySelector("code.fp[data-fp]"), r = fpEl && byId(fpEl.getAttribute("data-fp"));
    if (!r) return null;
    var dls = box.querySelectorAll('.pkgpane[data-pane="rep"] .pkgdl');
    var items = relItems(box).map(function (x, i) { x.n = i + 1; return x; });
    var main = hasLL(r) ? { lat: +r.lat, lon: +r.lon, main: true, prec: r.prec, label: r.place || r.prov } : null, pts = main ? [main] : [];
    if (main) items.forEach(function (x) {
      if (x.rec && hasLL(x.rec) && kmBetween(main, { lat: +x.rec.lat, lon: +x.rec.lon }) <= 400) { x.onMap = true; pts.push({ lat: +x.rec.lat, lon: +x.rec.lon, n: x.n }); }
    });
    return {
      label: "Story report", title: r.title, rec: r, items: items, pts: pts, link: d.link,
      facts: rows(dls[0]), trace: rows(dls[1]), detail: clean((box.querySelector(".pkgd") || {}).textContent)
    };
  }
  function eventReport(box, d) {
    var e = d.ev; if (!e) return null;
    var items = [], byUrl = {};
    e.members.forEach(function (m) { if (m.url) byUrl[m.url] = m; });
    e.refs.forEach(function (x, i) {
      var m = x.url ? byUrl[x.url] : null;
      items.push({ n: i + 1, cited: true, title: m ? m.title : x.text, source: m ? m.source : "", when: m ? m.when : "", url: x.url, rec: m ? m.rec : null, kind: "Cited in the summary" });
    });
    e.members.forEach(function (m) {
      if (m.url && e.refs.some(function (x) { return x.url === m.url; })) return;
      items.push({ n: items.length + 1, title: m.title, source: m.source, when: m.when, url: m.url, rec: m.rec, kind: "Report in this event" });
    });
    var pts = [], main = null;
    items.forEach(function (x) { if (x.rec && hasLL(x.rec)) { x.onMap = true; pts.push({ lat: +x.rec.lat, lon: +x.rec.lon, n: x.n, prec: x.rec.prec }); } });
    if (pts.length) {
      main = pts.slice().sort(function (a, b) { return (PRANK[b.prec] || 2) - (PRANK[a.prec] || 2); })[0];
      main.main = true; main.label = e.where; pts.forEach(function (p) { if (p !== main && p.lat === main.lat && p.lon === main.lon) p.same = true; });
      pts = pts.filter(function (p) { return !p.same; });
    }
    return { label: "Event report", title: d.title, items: items, pts: pts, link: d.link, ev: e };
  }

  function buildReport(d) {
    var rep = d.kind === "event" ? eventReport(d.box, d) : storyReport(d.box, d);
    if (!rep) return Promise.reject(new Error("nothing to report"));
    return Promise.all([
      Promise.all(rep.items.map(function (x) { return itemFp(x).then(function (f) { x.fp = f.fp; x.fpKind = f.fpKind; }); })),
      rep.rec ? recFp(rep.rec) : Promise.resolve(""),
      drawMap(rep.pts, MAPW, MAPH).then(null, function () { return null; }),
      logo()
    ]).then(function (a) {
      var fp = a[1], map = a[2], doc = new Doc(rep.label, rep.title);
      var made = window.OSAP_TIME ? window.OSAP_TIME.dualT(Date.now(), { date: true }) : new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
      doc.text([{ text: rep.title || "", bold: true }], { size: 40, lh: 52 }).gap(10);
      var chips = [{ text: "Reported, not verified", fg: "#1b1300", bg: "#f5c877" }];
      if (rep.ev) chips.push({ text: "Grouped automatically", fg: "#1d2a36", bg: "#e3e8ee" });
      else { var v = rep.facts.filter(function (f) { return f.label === "Verified?"; })[0]; if (v && v.main) chips.push({ text: "OSAP status: " + v.main, fg: "#1d2a36", bg: "#e3e8ee" }); }
      doc.chips(chips).gap(6);
      var onMap = rep.items.filter(function (x) { return x.onMap; }).length;
      doc.figure(map, [{ text: "Figure 1. " + (rep.ev ? "Red: the event's best-located report. " : "Red: this report" + (rep.rec && rep.rec.prec && rep.rec.prec !== "exact" ? " (place is approximate). " : ". ")) +
        (onMap ? "Orange numbers: " + (rep.ev ? "other reports" : "connected stories") + " below that have a place" + (rep.ev ? "." : " within 400 km.") : "") + " " + (map ? map.credit + "." : "") }]);
      if (!map) doc.text([{ text: "No map: the source gives no place for this " + (rep.ev ? "event." : "report."), color: "#56626f" }], { size: 18 });

      if (rep.ev) {
        var e = rep.ev;
        doc.h2("The event");
        doc.kv("What", [{ text: "One event grouped automatically by OSAP from " + e.members.length + " report" + (e.members.length === 1 ? "" : "s") + " by " + e.nsrc + " source" + (e.nsrc === 1 ? "" : "s") + "." }],
          ["A guess by fixed rules, not a finding. Read each report."]);
        if (e.when) doc.kv("When", [{ text: e.when }], ["First to latest report"]);
        if (e.where) doc.kv("Where", [{ text: e.where }]);
        if (e.blocks.length) {
          doc.h2("Summary");
          if (e.tag) doc.chips([{ text: e.tag, fg: "#3b4652", bg: "#eef1f4" }]);
          e.blocks.forEach(function (b) {
            if (b.t === "h") doc.gap(4).text([{ text: b.text, semi: true }], { size: 20 });
            else if (b.t === "li") doc.text([{ text: "•  " + b.text }], { x: PM + 16, size: 21 });
            else doc.text([{ text: b.text }], { size: 21 }).gap(6);
          });
          doc.gap(4).text([{ text: e.note }], { size: 16, color: "#56626f", lh: 23 });
        }
      } else {
        doc.h2("The report");
        if (rep.detail) doc.text([{ text: rep.detail }], { size: 21 }).gap(10);
        rep.facts.forEach(function (f) { if (f.label !== "Verified?") doc.kv(f.label, [{ text: f.main }], f.subs); else doc.kv(f.label, [{ text: f.main }], f.subs); });
        doc.h2("Source and traceability");
        rep.trace.forEach(function (f) {
          if (f.label === "Original") doc.kv("Original", f.url ? [{ text: f.url, url: f.url }] : [{ text: f.main }]);
          else if (f.label === "Record fingerprint") doc.kv(f.label, [{ text: fp || f.main, mono: true, size: 18 }], f.subs);
          else doc.kv(f.label, [{ text: f.main }], f.subs);
        });
      }
      doc.gap(rep.ev ? 12 : 0).kv("Open in OSAP", [{ text: rep.link, url: rep.link }], ["Opens this " + (rep.ev ? "event" : "story") + " on the live OSAP map"]);

      doc.h2(rep.ev ? "Reports (" + rep.items.length + ")" : "Connected stories (" + rep.items.length + ")");
      doc.text([{ text: rep.ev ? "Numbers 1 to " + rep.ev.refs.length + " are the sources the summary cites. Every item is what its source reported." :
        "Matched automatically by shared words, place and time. A match is not a confirmed link between the stories; read each one. Social media posts are from official agencies and news accounts only and are unverified." }], { size: 17, color: "#56626f", lh: 24 }).gap(8);
      if (!rep.items.length) doc.text([{ text: "No other story shares enough words, place or time with this one." }], { size: 19, color: "#56626f" });
      rep.items.forEach(function (x) { doc.item(x); });
      doc.gap(10).text([{ text: "About this report. ", bold: true }, { text: "Made by AXIOM OSAP on the sender's device from the reports it had loaded. Every item is a claim by the named source, not a confirmed fact, and sources can be wrong. " +
        "Record fingerprints are SHA-256 hashes of each record as packaged in OSAP; they change if any field changes and do not cover the source page. OSAP keeps no copy of what was shared." }], { size: 16, color: "#56626f", lh: 23 });
      doc.finish(made, a[3]);
      var links = doc.pages.map(function (p) { return p.links; });
      return Promise.all(doc.pages.map(function (p) { return jpeg(p.cv); })).then(function (jpgs) {
        var blob = pdfBytes(jpgs, links, "AXIOM OSAP " + rep.label + ": " + (rep.title || "")), day = new Date().toISOString().slice(0, 10);
        var slug = String(rep.title || rep.label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "report";
        return { blob: blob, name: "osap-" + (rep.ev ? "event" : "story") + "-" + slug + "-" + day + ".pdf", pages: doc.pages.length, pageCanvases: doc.pages.map(function (p) { return p.cv; }) };
      });
    });
  }
  window.OSAP_SHARE_REPORT = { build: function (box) { var d = data(box); return d ? buildReport(d) : Promise.reject(new Error("no report")); } };

  /* ---------- the sheet ---------- */
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); return ok;
  }
  function canShareFile(f) { try { return !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
  function download(url, name) { var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function open(d) {
    var old = document.getElementById("oshdlg"); if (old) old.remove();
    var dlg = document.createElement("div"); dlg.id = "oshdlg"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-labelledby", "osh-h");
    var canShare = !!navigator.share, what = d.kind === "event" ? "event" : "story";
    dlg.innerHTML = '<div class="oshbox"><div class="pkghead"><h2 id="osh-h">Share this ' + what + '</h2><button type="button" class="x" aria-label="Close">×</button></div>' +
      '<div class="oshpic"><span class="obs">Drawing the map picture…</span></div>' +
      '<fieldset class="oshas"><legend>Send as</legend>' +
        '<label><input type="radio" name="osh-as" value="pdf" checked> <b>Full report</b> <span class="obs">PDF with the map, the ' + what + ' and its ' + (d.kind === "event" ? "reports" : "connected stories") + ', links live</span></label>' +
        '<label><input type="radio" name="osh-as" value="pic"> <b>Map picture</b> <span class="obs">with the message</span></label>' +
        '<label><input type="radio" name="osh-as" value="txt"> <b>Message only</b></label></fieldset>' +
      '<p class="obs oshrep" role="status" aria-live="polite">Making the full report…</p>' +
      '<label class="oshlbl" for="osh-t">Message</label><textarea id="osh-t" readonly rows="7"></textarea>' +
      '<p class="oshlink"><span class="obs">Opens on the OSAP map:</span> <a target="_blank" rel="noopener" href="' + esc(d.link) + '">' + esc(d.link.replace(/^https?:\/\//, "")) + "</a></p>" +
      '<div class="oshbtns">' + (canShare ? '<button type="button" class="refresh primary oshgo" data-osh="share">Share…</button>' : "") +
        '<button type="button" class="refresh" data-osh="copy">Copy message</button><button type="button" class="refresh" data-osh="link">Copy link</button>' +
        '<button type="button" class="refresh oshpdf" data-osh="savepdf" hidden>Save report (PDF)</button>' +
        '<button type="button" class="refresh oshsave" data-osh="save" hidden>Save picture</button></div>' +
      '<p class="obs oshmsg" role="status" aria-live="polite"></p>' +
      '<p class="obs oshhow"></p>' +
      '<p class="obs">The source, the link to the original and "Reported, not verified" always go with what you share.' + (d.kind === "event" ? " The Summary keeps its " + "“AI generated” or “Automatic” tag." : "") + "</p></div>";
    document.body.appendChild(dlg);
    var ta = dlg.querySelector("textarea"), msg = dlg.querySelector(".oshmsg"), save = dlg.querySelector(".oshsave"), savePdf = dlg.querySelector(".oshpdf");
    var repNote = dlg.querySelector(".oshrep"), how = dlg.querySelector(".oshhow"), radios = dlg.querySelectorAll('input[name="osh-as"]');
    var full = d.text + "\nOpen on the OSAP map: " + d.link;
    ta.value = full;
    var file = null, blobUrl = null, pdf = null, pdfUrl = null, pdfFailed = false, closed = false;
    function close() { closed = true; dlg.remove(); document.removeEventListener("keydown", onKey); if (blobUrl) URL.revokeObjectURL(blobUrl); if (pdfUrl) URL.revokeObjectURL(pdfUrl); }
    function onKey(e) { if (e.key === "Escape") close(); }
    function as() { var v = "txt"; Array.prototype.forEach.call(radios, function (r) { if (r.checked) v = r.value; }); return v; }
    function radio(v) { return dlg.querySelector('input[name="osh-as"][value="' + v + '"]'); }
    function say(t) { msg.textContent = t; }
    if (!canShare) dlg.querySelector(".oshas").hidden = true;
    document.addEventListener("keydown", onKey);
    dlg.addEventListener("click", function (e) { if (e.target === dlg || (e.target.classList && e.target.classList.contains("x"))) close(); });
    /* a browser that cannot hand files to other apps (most desktop browsers) saves the report instead, to attach by hand */
    how.textContent = canShare && canShareFile(new File([""], "x.pdf", { type: "application/pdf" }))
      ? "To send in Signal: pick Full report, tap Share and choose Signal. The PDF opens on the other phone with every link tappable, and the message carries the same links."
      : "This browser cannot attach a file to a share. Save the report (PDF) and attach it in Signal or email; the links in it stay live.";

    drawPicture(d.pic).then(function (cv) {
      return new Promise(function (res) { try { cv.toBlob(function (b) { res({ cv: cv, b: b }); }, "image/png"); } catch (e) { res({ cv: cv, b: null }); } });
    }).then(function (o) {
      var box = dlg.querySelector(".oshpic");
      if (!o.b) { box.innerHTML = '<span class="obs">The map picture could not be made in this browser.</span>'; radio("pic").disabled = true; return; }
      blobUrl = URL.createObjectURL(o.b);
      box.innerHTML = '<img alt="Map picture: ' + esc(d.pic.head) + '" src="' + blobUrl + '">';
      save.hidden = false;
      try { var f = new File([o.b], "osap-" + d.kind + ".png", { type: "image/png" }); if (canShareFile(f)) file = f; } catch (e) {}
    }).catch(function () { dlg.querySelector(".oshpic").innerHTML = '<span class="obs">The map picture could not be made in this browser.</span>'; radio("pic").disabled = true; });

    /* the report is made as soon as the sheet opens: a share menu must open straight from the tap, with the file ready */
    buildReport(d).then(function (o) {
      if (closed) return;
      pdf = new File([o.blob], o.name, { type: "application/pdf" });
      pdfUrl = URL.createObjectURL(o.blob);
      savePdf.hidden = false;
      repNote.textContent = "Full report ready: " + o.pages + " page" + (o.pages === 1 ? "" : "s") + ", " + Math.max(1, Math.round(o.blob.size / 1024)) + " KB.";
    }).catch(function () {
      pdfFailed = true;
      repNote.textContent = "The full report could not be made in this browser. The map picture and message still work.";
      radio("pdf").disabled = true; if (radio("pdf").checked) radio(file ? "pic" : "txt").checked = true;
    });

    dlg.querySelector(".oshbtns").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-osh]"); if (!b) return;
      var k = b.getAttribute("data-osh");
      if (k === "save") { if (blobUrl) download(blobUrl, "osap-" + d.kind + ".png"); }
      else if (k === "savepdf") { if (pdfUrl) { download(pdfUrl, pdf.name); say("Saved " + pdf.name + ". Attach it in Signal, WhatsApp or email."); } }
      else if (k === "copy") copyText(full).then(function (ok) { say(ok ? "Copied the message." : "Could not copy here. Select the message above and copy it."); if (!ok) { ta.focus(); ta.select(); } });
      else if (k === "link") copyText(d.link).then(function (ok) { say(ok ? "Copied the link." : "Could not copy here. Long-press or right-click the link to copy it."); });
      else if (k === "share") {
        var v = as(), p;
        if (v === "pdf") {
          if (!pdf) { say(pdfFailed ? "The full report could not be made here. Pick Map picture or Message only." : "The full report is still being made. Tap Share again in a moment."); return; }
          if (!canShareFile(pdf)) { download(pdfUrl, pdf.name); say("This device cannot attach the PDF to a share, so it was saved instead. Attach it in Signal or email."); return; }
          /* with a file some apps drop the url field, so the link rides in the text too */
          p = { files: [pdf], title: d.title, text: full };
        } else if (v === "pic" && file) p = { files: [file], title: d.title, text: full };
        else p = { title: d.title, text: d.text, url: d.link };
        navigator.share(p).then(function () { say("Shared."); }, function (err) {
          if (err && err.name === "AbortError") return;
          copyText(full).then(function (ok) { say(ok ? "This device could not open its share menu, so the message was copied instead." : "This device could not share or copy. Select the message above and copy it."); });
        });
      }
    });
    var first = dlg.querySelector("[data-osh]"); if (first) first.focus();
  }

  /* ---------- the Share button on every open Report and Event ---------- */
  function data(box) {
    var fp = box.querySelector("code.fp[data-fp]"), r = fp && byId(fp.getAttribute("data-fp"));
    var d = box.querySelector(".evlist") ? eventData(box) : r ? storyData(box, r) : null;
    if (d) d.box = box;
    return d;
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
    ".oshlink{font-size:12px;margin:6px 0;overflow-wrap:anywhere}.oshsave[hidden],.oshpdf[hidden],.oshas[hidden]{display:none!important}" +
    ".oshas{border:1px solid var(--line,#c5ced8);border-radius:4px;margin:8px 0 4px;padding:4px 10px 6px}.oshas legend{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#56626f);padding:0 4px}" +
    ".oshas label{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 6px;font-size:13px;padding:4px 0;cursor:pointer}.oshas label .obs{font-size:12px}.oshas input:disabled + b{opacity:.5}" +
    "html.phone .oshas label{padding:8px 0}.oshrep{margin:2px 0 6px}" +
    ".oshbtns{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px}.oshbtns .oshgo{font-weight:700}" +
    ".oshmsg:empty{display:none}" +
    ".oshgone{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100003;max-width:min(560px,calc(100vw - 32px));display:flex;gap:10px;align-items:flex-start;background:var(--ink,#141b23);color:var(--surface,#fff);padding:10px 14px;border-radius:6px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.35)}" +
    ".oshgone button{background:none;border:none;color:inherit;font-size:18px;line-height:1;cursor:pointer}" +
    "@media (max-width:700px){#oshdlg{padding:0}.oshbox{border-radius:0;min-height:100%}}";
  document.head.appendChild(st);
})();
