/* AXIOM OSAP · Share this trail (Shane 2026-11-18: build what the Instagram data favors; OSAP's brand is following the reporting
   trail, and posts had 0 shares). One tap in Go deeper (assets/osap-threads.js) makes a vertical picture (1080 x 1920, a phone
   story) of one story's reporting trail and hands it to the device's share menu, or saves it where there is none:
     the first report OSAP holds (outlet, owner, base, time, headline), who repeated it and when, the headlines that deny or
     dispute it, figures that differ between reports, the sources' sites, and a link back to the full trail in OSAP.
   Situational awareness only, never a verdict: every line is a source's claim and is labeled so; state media lines say "a claim";
   "deny or dispute" is a fixed word match on the headlines (DISPUTE below), not an analyst's or an AI's judgment, and the picture
   says so; OSAP never rates the story true or false. Machine-translated headlines are marked. Built in this browser from the
   story's file (data/live/threads/<cc>.js); nothing is sent anywhere unless the person picks a share target.
   The link (?trail=<cc>:<id>) opens OSAP on that story's Go deeper; a story older than the 72-hour window says it has dropped out.
   API: window.OSAP_TRAIL { model(thread, cc, file, now), draw(model) -> Promise<canvas>, share(cc, id, button), link(cc, id) } */
(function () {
  "use strict";
  var W = window, D = W.document;
  var LIVE = "https://osap.axiom-intelligence-systems.com/", WD = 1080, HT = 1920;
  var KIND = { state: "State media", public: "Public broadcaster", other: "Private or independent" };
  // headlines that deny or dispute: the words only, in English (or the machine translation OSAP holds)
  var DISPUTE = /\b(den(y|ies|ied|ying|ial|ials)|reject(s|ed|ing)?|refut\w*|rebut\w*|dismiss(es|ed|ing)?|disput\w*|contradict\w*|false(ly)?|fake|hoax|debunk\w*|no evidence|baseless|untrue|misleading|fabricat\w*|not true)\b/i;

  function txt(s) {
    s = String(s == null ? "" : s);
    if (D && /&(#x?[0-9a-f]+|[a-z]+);/i.test(s)) { var ta = D.createElement("textarea"); for (var k = 0; k < 2 && /&(#x?[0-9a-f]+|[a-z]+);/i.test(s); k++) { ta.innerHTML = s; s = ta.value; } }
    return s.replace(/<\/?[a-z][^>]*>/gi, " ").replace(/\s+/g, " ").trim();
  }
  function ms(d) { return Date.parse(String(d || "").slice(0, 16) + "Z"); }
  function zulu(t) { return isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z" : ""; }
  function host(u) { var m = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function cName(id) {
    if (!id) return "";
    var w = (W.ASAP_WORLD || []).filter(function (x) { return x && x.id === id; })[0];
    if (w) return w.name;
    var b = D && D.querySelector && D.querySelector('#country-seg button[data-cc="' + id + '"]');
    if (b) { var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove(); return c.textContent.trim(); }
    return id.toUpperCase();
  }
  function base() { var h = (W.location && W.location.hostname) || ""; return /\.netlify\.app$|^osap\.axiom-intelligence-systems\.com$/.test(h) ? W.location.origin + W.location.pathname : LIVE; }
  function link(cc, id) { return base() + "?trail=" + encodeURIComponent(cc + ":" + id) + "#" + (cc === "th" ? "" : cc + "/") + "timeline"; }

  /* ---------- what the picture says (pure: a thread from data/live/threads/<cc>.js) ----------
     rows: [outlet, kind, home, outlet's country, date, link, headline, machine translated, country inferred] */
  function words(s) { var o = {}; String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).forEach(function (w) { if (w.length >= 4) o[w] = 1; }); return o; }
  /* the claim the picture follows: the story (headlines in nearly the same words, thread.parts) that holds the story's own
     headline link; failing that, the story sharing most words with the title (at least two); failing that, every row */
  function claimRows(t, rows) {
    var groups = []; (t.parts || []).forEach(function (p) { (p[1] || []).forEach(function (s) { if (Array.isArray(s[0]) && s[0].length) groups.push(s[0]); }); });
    var lead = -1; (t.rows || []).forEach(function (r, i) { if (lead < 0 && r[5] === t.u) lead = i; });
    var g = lead >= 0 ? groups.filter(function (x) { return x.indexOf(lead) >= 0; })[0] : null;
    if (!g) {
      var tw = words(txt(t.t)), best = 1;
      groups.forEach(function (x) {
        var u = {}; x.forEach(function (i) { var r = (t.rows || [])[i]; if (r) Object.keys(words(txt(r[6]))).forEach(function (w) { u[w] = 1; }); });
        var n = Object.keys(tw).filter(function (w) { return u[w]; }).length; if (n > best) { best = n; g = x; }
      });
    }
    if (!g) return { rows: rows, whole: true };
    var ix = {}; g.forEach(function (i) { ix[i] = 1; });
    return { rows: rows.filter(function (r) { return ix[r.i]; }), whole: false };
  }
  function model(t, cc, file, now) {
    var rows = (t.rows || []).map(function (r, i) { return { i: i, outlet: String(r[0] || ""), kind: r[1], cc: r[3] || "", t: ms(r[4]), link: String(r[5] || ""), head: txt(r[6]), mt: !!r[7] }; })
      .filter(function (r) { return isFinite(r.t) && r.outlet; })
      .sort(function (a, b) { return a.t - b.t || a.i - b.i; });
    var cl = claimRows(t, rows), cr = cl.rows.length ? cl.rows : rows;
    var first = cr[0] || null, seen = {}, repeats = [];
    if (first) { seen[first.outlet] = 1; seen[host(first.link)] = 1; }
    cr.slice(1).forEach(function (r) { var h = host(r.link); if (seen[r.outlet] || (h && seen[h])) return; seen[r.outlet] = 1; if (h) seen[h] = 1; repeats.push(r); });
    var disputes = rows.filter(function (r) { return DISPUTE.test(r.head); });
    var said = 0; (t.parts || []).forEach(function (p) { if (p[0] === "said") (p[1] || []).forEach(function (x) { said += (x[0] || []).length; }); });
    var figs = (t.fig || []).map(function (f) {
      var vals = (f[2] || []).map(function (x) { return +x[0]; }).filter(isFinite);
      return vals.length ? { what: String(f[1] || ""), lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals), n: vals.length } : null;
    }).filter(function (f) { return f && f.lo !== f.hi; });
    var hosts = [], hs = {}; cr.concat(rows).forEach(function (r) { var h = host(r.link); if (h && !hs[h]) { hs[h] = 1; hosts.push(h); } });
    var ctry = {}; rows.forEach(function (r) { if (r.cc) ctry[r.cc] = 1; });
    var co = {}; cr.forEach(function (r) { co[r.outlet] = 1; });
    var k = t.k || {}, span = first && cr.length > 1 ? cr[cr.length - 1].t - first.t : 0;
    return {
      title: txt(t.t), cc: cc, country: cName(cc), id: t.id, fp: String(t.fp || ""),
      n: t.n || 0, r: t.r || rows.length, listed: rows.length, k: { state: k.state || 0, public: k.public || 0, other: k.other || 0 }, countries: Object.keys(ctry).length,
      claim: { whole: cl.whole, outlets: Object.keys(co).length, reports: cr.length },
      spanH: Math.round(span / 36e5), first: first, repeats: repeats, disputes: disputes, said: said, figs: figs, hosts: hosts,
      built: zulu(now || Date.now()), asof: file && file.asof ? String(file.asof) : "", link: link(cc, t.id)
    };
  }

  /* ---------- drawing ---------- */
  var FONT = "system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans','Noto Sans Thai','Noto Sans Arabic',sans-serif";
  var C = { bg: "#0b1622", panel: "#12212f", ink: "#f2f5f8", muted: "#9fb0c0", line: "#2a3b4c", first: "#f59e0b", rep: "#5aa9e6", dis: "#ef6461", fig: "#e8c547", src: "#8fd19e", state: "#fdba74" };
  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    // words longer than the line (no spaces, as in Thai) are cut by characters
    var parts = [];
    words.forEach(function (w) {
      if (ctx.measureText(w).width <= maxW) { parts.push(w); return; }
      var s = ""; for (var i = 0; i < w.length; i++) { if (ctx.measureText(s + w[i]).width > maxW && s) { parts.push(s); s = ""; } s += w[i]; } if (s) parts.push(s);
    });
    for (var i = 0; i < parts.length; i++) {
      var tt = cur ? cur + " " + parts[i] : parts[i];
      if (ctx.measureText(tt).width <= maxW || !cur) cur = tt;
      else { lines.push(cur); cur = parts[i]; if (lines.length === maxLines) { cur = null; break; } }
    }
    if (cur) lines.push(cur);
    if (cur === null || lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/[\s,.;:]+$/, "") + "…";
    }
    return lines;
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function loadImg(src) {
    return new Promise(function (ok) { var im = new Image(), tm = setTimeout(function () { ok(null); }, 3000); im.onload = function () { clearTimeout(tm); ok(im); }; im.onerror = function () { clearTimeout(tm); ok(null); }; im.src = src; });
  }
  function draw(m) {
    var cv = D.createElement("canvas"); cv.width = WD; cv.height = HT;
    var ctx = cv.getContext("2d"), X = 72, R = WD - 72, TX = X + 56, TW = R - TX;
    return loadImg("assets/logo.png").then(function (logo) {
      // drawn twice: once to measure, then again with the spare height shared between the sections, so a short trail does not
      // leave a gap above the footer
      // and fitted: fewer repeats (down to one), then one denial, until everything ends above the footer
      var maxRep = 9, maxDis = 2, used = paint(0);
      while (used > HT - 330 && maxRep > 1) { maxRep--; used = paint(0); }
      if (used > HT - 330) { maxDis = 1; used = paint(0); }
      var gap = Math.max(0, Math.min(70, Math.floor((HT - 330 - used) / 6)));
      if (gap > 8) used = paint(gap);
      return cv;
    function paint(G) {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, WD, HT);
      ctx.textBaseline = "alphabetic";
      // header
      if (logo) { ctx.save(); rr(ctx, X, 64, 96, 96, 20); ctx.clip(); ctx.drawImage(logo, X, 64, 96, 96); ctx.restore(); }
      ctx.fillStyle = C.ink; ctx.font = "800 46px " + FONT; ctx.fillText("THE REPORTING TRAIL", X + 120, 112);
      ctx.fillStyle = C.muted; ctx.font = "500 28px " + FONT; ctx.fillText("AXIOM OSAP · " + m.country + " · " + m.built, X + 120, 152);
      var y = 236;
      // the story
      ctx.fillStyle = C.ink; ctx.font = "700 52px " + FONT;
      wrap(ctx, m.title, R - X, 3).forEach(function (l) { ctx.fillText(l, X, y); y += 64; });
      ctx.fillStyle = C.state; ctx.font = "600 28px " + FONT;
      ctx.fillText("Claims as reported, not verified. OSAP does not rate stories true or false.", X, y + 4); y += 56 + G;
      // the trail line
      var LIM = HT - 330, dots = [];
      function dot(col, yy) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X + 18, yy - 12, 14, 0, 7); ctx.fill(); }
      function head(col, label, yy) { dots.push([col, yy]); ctx.fillStyle = col; ctx.font = "800 30px " + FONT; ctx.fillText(label, TX, yy); return yy + 46; }
      function line(text, font, col, yy, maxL) {
        ctx.font = font; ctx.fillStyle = col; var L = wrap(ctx, text, TW, maxL || 2), lh = parseInt(font.split(" ")[1], 10) * 1.3;
        L.forEach(function (l) { if (yy < LIM) { ctx.fillText(l, TX, yy); } yy += lh; }); return yy;
      }
      function who(r) { return r.outlet + " · " + (KIND[r.kind] || "Outlet") + (r.kind === "state" ? " (a claim)" : "") + (r.cc ? " · " + cName(r.cc) : ""); }
      // one line a repeat: private or independent outlets carry no label (the line above gives the split)
      function whoShort(r) { return r.outlet + (r.cc ? " · " + cName(r.cc) : "") + (r.kind === "state" ? " · state media, a claim" : r.kind === "public" ? " · public broadcaster" : ""); }
      // first report
      if (m.first) {
        y = head(C.first, "FIRST REPORT OSAP HOLDS", y + 10);
        y = line(zulu(m.first.t) + " · " + who(m.first), "600 30px " + FONT, C.ink, y, 2);
        y = line("“" + m.first.head + "”" + (m.first.mt ? " (machine translated)" : ""), "400 32px " + FONT, C.ink, y + 4, 4);
        y = line(host(m.first.link), "500 26px " + FONT, C.muted, y + 2, 1) + 22 + G;
      }
      // repeated by
      y = head(C.rep, "REPEATED BY", y);
      var kk = [m.k.state ? m.k.state + " state media" : "", m.k.public ? m.k.public + " public" : "", m.k.other ? m.k.other + " private or independent" : ""].filter(Boolean).join(", ");
      if (!m.claim.whole) y = line(plural(m.claim.outlets, "outlet") + " carried this headline in nearly the same words" + (m.spanH ? " over " + plural(m.spanH, "hour") : "") + ".", "600 30px " + FONT, C.ink, y, 2);
      y = line((m.claim.whole ? "" : "The wider story: ") + plural(m.n, "outlet") + ", " + plural(m.r, "report") + " in " + plural(m.countries, "country", "countries") + (m.claim.whole && m.spanH ? " over " + plural(m.spanH, "hour") : "") + (kk ? " (" + kk + ")" : "") + ".",
        (m.claim.whole ? "600 30px " : "400 27px ") + FONT, m.claim.whole ? C.ink : C.muted, y, 2) + 6;
      var shownR = 0;
      m.repeats.forEach(function (r) {
        if (shownR >= maxRep) return; shownR++;
        y = line(zulu(r.t).slice(5) + "  " + whoShort(r), "500 28px " + FONT, r.kind === "state" ? C.state : C.ink, y, 1);
      });
      if (m.repeats.length > shownR) y = line("and " + (m.repeats.length - shownR) + " more outlets", "500 26px " + FONT, C.muted, y, 1);
      y = line("Many outlets repeat one agency's report: more outlets is not more evidence.", "400 25px " + FONT, C.muted, y + 2, 2) + 22 + G;
      // denied or disputed
      {
        y = head(C.dis, "DENIED OR DISPUTED", y);
        if (m.disputes.length) {
          m.disputes.slice(0, maxDis).forEach(function (r) {
            y = line(r.outlet + " · " + zulu(r.t), "600 27px " + FONT, C.ink, y, 1);
            y = line("“" + r.head + "”" + (r.mt ? " (machine translated)" : ""), "400 28px " + FONT, C.ink, y, 2) + 4;
          });
          y = line("Found by words such as deny, reject or false in the headlines: read each in full.", "400 25px " + FONT, C.muted, y, 2);
        } else y = line("No headline OSAP holds for this story denies or disputes it (matched by words such as deny or false).", "400 27px " + FONT, C.ink, y, 2);
        if (m.said) y = line(plural(m.said, "report") + " carry officials' statements: those are claims too.", "400 25px " + FONT, C.muted, y + 2, 2);
        y += 22 + G;
      }
      // figures that differ
      if (m.figs.length) {
        y = head(C.fig, "FIGURES DIFFER", y);
        m.figs.slice(0, 2).forEach(function (f) { y = line(f.what.charAt(0).toUpperCase() + f.what.slice(1) + ": " + f.lo.toLocaleString("en-US") + " to " + f.hi.toLocaleString("en-US") + " across " + plural(f.n, "report"), "600 28px " + FONT, C.ink, y, 1); });
        y += 22 + G;
      }
      // sources
      {
        y = head(C.src, "SOURCES", y);
        y = line(m.hosts.slice(0, 6).join(" · ") + (m.hosts.length > 6 ? " and " + (m.hosts.length - 6) + " more" : ""), "500 27px " + FONT, C.ink, y, 2);
      }
      var contentEnd = y;
      // the trail line from the first heading's dot to the last, then the dots on top of it
      if (dots.length > 1) { ctx.strokeStyle = C.line; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(X + 18, dots[0][1] - 12); ctx.lineTo(X + 18, dots[dots.length - 1][1] - 12); ctx.stroke(); }
      dots.forEach(function (d) { dot(d[0], d[1]); });
      // footer
      var fy = HT - 290;
      ctx.fillStyle = C.panel; rr(ctx, X - 16, fy, R - X + 32, 230, 22); ctx.fill();
      ctx.fillStyle = C.ink; ctx.font = "700 34px " + FONT; ctx.fillText("Every link, in order, in OSAP:", X + 12, fy + 56);
      ctx.fillStyle = C.rep; ctx.font = "700 34px " + FONT; ctx.fillText("osap.axiom-intelligence-systems.com", X + 12, fy + 102);
      ctx.fillStyle = C.muted; ctx.font = "400 24px " + FONT;
      wrap(ctx, "Today > Story coverage > Go deeper. Built from " + plural(m.listed, "report") + " OSAP holds" + (m.r > m.listed ? " (the first and the newest of " + m.r + ")" : "") +
        ". Situational awareness only: who reported what, and when. Record SHA-256 " + m.fp.slice(0, 16) + "…", R - X - 24, 3).forEach(function (l, i) { ctx.fillText(l, X + 12, fy + 146 + i * 32); });
      return contentEnd;
    }
    });
  }
  /* ---------- share or save ---------- */
  function canShareFile(f) { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
  function slug(s) { return String(s || "story").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "story"; }
  function share(cc, id, btn) {
    var Q = W.OSAP_THREADSQ, t = Q && Q.find(cc, id), f = Q && Q.get(cc);
    if (!t) return Promise.resolve(false);
    var m = model(t, cc, f), label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Making the picture…"; }
    var done = function (msg) { if (btn) { btn.disabled = false; btn.textContent = msg || label; if (msg) setTimeout(function () { btn.textContent = label; }, 2500); } };
    return draw(m).then(function (cv) {
      return new Promise(function (ok) { cv.toBlob(ok, "image/png"); });
    }).then(function (blob) {
      if (!blob) { done("Could not make the picture"); return false; }
      var name = "osap-trail-" + slug(m.title) + ".png", file = null;
      try { file = new File([blob], name, { type: "image/png" }); } catch (e) {}
      var text = "The reporting trail: " + m.title + ". Claims as reported, not verified. Every link in order: " + m.link;
      W.OSAP_TRAIL.last = { name: name, size: blob.size, text: text, model: m };
      if (file && canShareFile(file)) {
        return navigator.share({ files: [file], title: "The reporting trail", text: text }).then(function () { done("Shared"); return true; }, function () { done(); return false; });
      }
      var u = URL.createObjectURL(blob), a = D.createElement("a"); a.href = u; a.download = name; D.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
      done("Saved the picture"); return true;
    }, function () { done("Could not make the picture"); return false; });
  }

  /* ---------- a shared link: ?trail=<cc>:<id> opens that story's Go deeper ---------- */
  function openFromLink() {
    var q; try { q = new URLSearchParams(W.location.search); } catch (e) { return; }
    var v = q.get("trail"), m = /^([a-z]{2,3}):([0-9a-f]{6,40})$/.exec(v || ""); if (!m) return;
    var tries = 0;
    (function wait() {
      var Q = W.OSAP_THREADSQ;
      if (!Q || !W.TSAP) { if (++tries < 80) setTimeout(wait, 250); return; }
      Q.open(m[1], m[2]);
      // the parameter is used once: a reload or a later share does not open it again
      try { q.delete("trail"); history.replaceState(null, "", W.location.pathname + (String(q) ? "?" + q : "") + W.location.hash); } catch (e) {}
    })();
  }
  if (D && D.readyState) { if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", openFromLink); else openFromLink(); }
  W.OSAP_TRAIL = { model: model, draw: draw, share: share, link: link, DISPUTE: DISPUTE };
})();
