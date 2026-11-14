/* AXIOM OSAP: Go deeper, a story in layers (Shane 2026-11-14: "I want the news feed to be able to go multiple layers deep on a
   topic ... so someone can make connections ... I want the average person to be able to easily see beyond the headlines").
   Self-contained block loaded before assets/osap-coverage.js, which lists the threads on Today > Story coverage and opens one here
   (window.OSAP_THREADSQ). Reads data/live/threads/<cc>.js (window.OSAP_THREADS, written by tools/news_stories.mjs with
   tools/threads_lib.mjs), fetched only when Story coverage is shown, after the story list.
   One event, in layers, each a plain question:
     What happened / Why it happened / What officials say / Who is affected / What happens next
       -> the stories inside it (headlines in nearly the same words, with how many outlets carried each)
         -> every outlet's own headline, link, owner and base
   plus How it developed (the first report of each story, in time order, Zulu and local) and Connections: the names the thread
   mentions, each with the other headlines (any country) that name them. A connection to a story OSAP has threaded opens that
   story here, one layer deeper, with a trail back. The reader can mark a connection Linked or Not linked: a note kept on this
   device only (localStorage "osap-thread-links", each with what, when and who), never sent anywhere and never shown as fact.
   Everything is word matching by machine, not AI and not an analyst, and the page says so. Officials' lines are their claims.
   Read-only: it never changes a record. */
(function () {
  "use strict";
  var D = document, W = window;
  var KIND = { state: "State media", public: "Public broadcaster", other: "Private or independent" };
  var PART = {
    what: ["What happened", "The first reports and the event itself."],
    why: ["Why it happened", "The cause, as each source tells it. Sources can disagree, and an early cause can turn out wrong."],
    said: ["What officials say", "Statements by officials, agencies and leaders. These are their claims, not established fact."],
    impact: ["Who is affected", "People, places, services and money the reports say were hit."],
    next: ["What happens next", "Follow-ups: lifted or resumed, investigations, hearings, calls for change, what to do."]
  };
  var ORDER = ["what", "why", "said", "impact", "next"];
  var KEY = "osap-thread-links";
  var files = {}, waiting = {}, box = null, trail = [], tab = "parts", nameSel = "";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var TA = D.createElement("textarea");
  function txt(s) { s = String(s == null ? "" : s); for (var k = 0; k < 2 && /&(#x?[0-9a-f]+|[a-z]+);/i.test(s); k++) { TA.innerHTML = s; s = TA.value; } return s.replace(/<\/?[a-z][^>]*>/gi, " "); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function ms(d) { return Date.parse(String(d || "").slice(0, 16) + "Z"); }
  function when(d) { var T = W.OSAP_TIME, t = ms(d); return isFinite(t) && T && T.dualT ? T.dualT(t, { date: true }) : String(d || "").replace("T", " ") + "Z"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  var NAMES = null;
  function cName(id) {
    if (!id) return "";
    if (!NAMES) {
      NAMES = {};
      (W.ASAP_WORLD || []).forEach(function (w) { if (w && w.id) NAMES[w.id] = w.name; });
      Array.prototype.forEach.call(D.querySelectorAll("#country-seg button[data-cc]"), function (b) {
        var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove(); NAMES[b.getAttribute("data-cc")] = c.textContent.trim(); });
    }
    return NAMES[id] || id.toUpperCase();
  }

  /* ---------- the files: one per country, fetched once a session (ten-minute cache key, like the story list) ---------- */
  function get(cc) { var f = files[cc]; return f && f !== 1 && f !== 2 ? f : null; }
  function load(cc, done) {
    if (!/^[a-z]{2,3}$/.test(cc)) { if (done) done(null); return; }
    if (get(cc) || files[cc] === 2) { if (done) done(get(cc)); return; }
    (waiting[cc] = waiting[cc] || []).push(done || function () {});
    if (files[cc] === 1) return;
    files[cc] = 1;
    var prev = W.OSAP_THREADS, s = D.createElement("script");
    W.OSAP_THREADS = null;
    s.src = "data/live/threads/" + encodeURIComponent(cc) + ".js?t=" + Math.floor(Date.now() / 6e5);
    s.async = true;
    s.onload = s.onerror = function () {
      s.remove();
      var v = W.OSAP_THREADS;
      files[cc] = v && v.cc === cc && Array.isArray(v.threads) ? v : 2;
      W.OSAP_THREADS = prev && prev !== v ? prev : v;
      var l = waiting[cc] || []; waiting[cc] = [];
      l.forEach(function (fn) { try { fn(get(cc)); } catch (e) { setTimeout(function () { throw e; }); } });
    };
    D.head.appendChild(s);
  }
  function find(cc, id) { var f = get(cc); if (!f) return null; for (var i = 0; i < f.threads.length; i++) if (f.threads[i].id === id) return f.threads[i]; return null; }
  /** the thread holding a story (by any of its links), for a story card that wants a Go deeper button */
  function ofLinks(cc, links) {
    var f = get(cc); if (!f) return null;
    var L = {}; (links || []).forEach(function (u) { L[u] = 1; });
    for (var i = 0; i < f.threads.length; i++) { var t = f.threads[i]; for (var j = 0; j < t.rows.length; j++) if (L[t.rows[j][5]]) return t; }
    return null;
  }

  /* ---------- link notes on this device ---------- */
  function notes() { try { var v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function noteOf(tk, name, link) { var l = notes(); for (var i = l.length - 1; i >= 0; i--) if (l[i].thread === tk && l[i].name === name && l[i].link === link) return l[i]; return null; }
  function setNote(tk, name, link, title, v) {
    var l = notes().filter(function (n) { return !(n.thread === tk && n.name === name && n.link === link); });
    // a decision record: what was decided, about which pair, when, and by whom (this device: OSAP has no accounts for it)
    if (v) l.push({ thread: tk, name: name, link: link, title: String(title || "").slice(0, 300), decision: v, at: new Date().toISOString(), by: "this device" });
    try { localStorage.setItem(KEY, JSON.stringify(l.slice(-500))); } catch (e) {}
  }

  /* ---------- the view ---------- */
  var CSS = "#thv{position:fixed;inset:0;z-index:6000;display:flex;justify-content:center;background:rgba(0,0,0,.45)}" +
    "#thv .thp{position:relative;display:flex;flex-direction:column;width:min(100%,920px);height:100%;max-height:var(--app-h,100%);background:var(--surface,#fff);color:var(--ink,#111);box-shadow:0 0 30px rgba(0,0,0,.35)}" +
    "#thv .thtop{flex:0 0 auto;padding:10px 14px 8px;border-bottom:1px solid var(--line,#ccc)}" +
    "#thv .thbar{display:flex;align-items:center;gap:8px}#thv .thtrail{flex:1 1 auto;min-width:0;font-size:12px;color:var(--muted,#555);overflow-wrap:anywhere}" +
    "#thv .thtrail button{font:inherit;color:var(--accent,#1f5f99);background:none;border:0;padding:2px 0;cursor:pointer;text-decoration:underline}" +
    "#thv .thx{flex:0 0 auto;min-width:40px;min-height:40px;font-size:22px;line-height:1;background:none;border:1px solid var(--line,#ccc);border-radius:6px;color:var(--ink,#111);cursor:pointer}" +
    "#thv h2{margin:4px 0 2px;font-size:17px;line-height:1.3;overflow-wrap:anywhere}#thv h2 a{color:inherit}" +
    "#thv .thm{font-size:12.5px;color:var(--muted,#555);margin:2px 0}" +
    "#thv .thtabs{display:flex;gap:2px;padding:2px;margin:8px 0 0;background:var(--surface2,#eee);border:1px solid var(--line,#ccc);border-radius:6px}" +
    "#thv .thtabs button{flex:1 1 0;min-width:0;min-height:36px;padding:4px 6px;font:inherit;font-size:13px;font-weight:600;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--muted,#555);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#thv .thtabs button[aria-selected=true]{background:var(--accent-soft,#D6E3EE);color:var(--ink,#111);border-color:var(--accent,#1D5A86)}" +
    "#thv .thbody{flex:1 1 auto;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 14px 24px;font-size:13.5px;line-height:1.45}" +
    "#thv details.thpart{border:1px solid var(--line,#ccc);border-radius:6px;margin:0 0 8px;background:var(--surface,#fff)}" +
    "#thv details.thpart>summary{cursor:pointer;list-style:none;padding:9px 12px;min-height:44px;box-sizing:border-box;display:flex;align-items:center;gap:8px;font-weight:700;font-size:14.5px}" +
    "#thv details.thpart>summary::-webkit-details-marker{display:none}#thv details.thpart>summary::before{content:'\\25B8';color:var(--muted,#555)}#thv details.thpart[open]>summary::before{content:'\\25BE'}" +
    "#thv .thn{margin-left:auto;font-weight:600;font-size:12px;color:var(--muted,#555);white-space:nowrap}" +
    "#thv .thwhy{margin:0 12px 6px;font-size:12.5px;color:var(--muted,#555)}" +
    "#thv ul.ths{list-style:none;margin:0;padding:0 12px 8px}#thv ul.ths>li{padding:7px 0;border-top:1px solid var(--line-soft,var(--line,#ddd));overflow-wrap:anywhere}" +
    "#thv .tht{font-weight:600;color:var(--ink,#111)}#thv a.tht{text-decoration:none}#thv a.tht:hover{text-decoration:underline}" +
    "#thv .tho{display:block;font-size:12px;color:var(--muted,#555)}" +
    "#thv details.threp summary{cursor:pointer;font-size:12px;min-height:28px;padding-top:4px;color:var(--accent,#1f5f99)}" +
    "#thv details.threp ul{list-style:none;margin:2px 0 0;padding:0 0 0 10px;border-left:2px solid var(--line,#ccc)}#thv details.threp li{padding:4px 0;font-size:12.5px}" +
    "#thv .thclaim{display:inline-block;font:700 10px/1.6 inherit;text-transform:uppercase;letter-spacing:.03em;border-radius:3px;padding:0 5px;margin-left:4px;color:#7c2d12;background:#fde7d6;border:1px solid #f3b58b;vertical-align:1px}" +
    "#thv ol.thdev{list-style:none;margin:0;padding:0 0 0 14px;border-left:3px solid var(--accent,#1f5f99)}" +
    "#thv ol.thdev li{position:relative;padding:4px 0 10px 8px;overflow-wrap:anywhere}#thv ol.thdev li::before{content:'';position:absolute;left:-21px;top:9px;width:11px;height:11px;border-radius:50%;background:var(--accent,#1f5f99);border:2px solid var(--surface,#fff)}" +
    "#thv .thwhen{display:block;font-size:12px;font-weight:600;color:var(--muted,#555)}#thv .thtag{display:inline-block;font-size:11px;padding:0 6px;border-radius:9px;border:1px solid var(--line,#ccc);margin-left:6px;color:var(--muted,#555)}" +
    "#thv .thnames{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}" +
    "#thv .thnames button{min-height:34px;padding:3px 11px;font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line,#ccc);border-radius:17px;background:var(--surface2,#eee);color:var(--ink,#111);cursor:pointer}" +
    "#thv .thnames button[aria-pressed=true]{background:var(--accent-soft,#D6E3EE);border-color:var(--accent,#1D5A86)}" +
    "#thv .thnames small{font-weight:400;color:var(--muted,#555);margin-left:4px}" +
    "#thv .thact{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}#thv .thact button{min-height:32px;padding:2px 10px;font:inherit;font-size:12.5px;border:1px solid var(--line,#ccc);border-radius:5px;background:var(--surface,#fff);color:var(--ink,#111);cursor:pointer}" +
    "#thv .thact button[aria-pressed=true]{background:var(--accent-soft,#D6E3EE);border-color:var(--accent,#1D5A86);font-weight:600}#thv .thact .thgo{font-weight:700;color:var(--accent,#1f5f99)}" +
    "#thv .thnote{font-size:12px;color:var(--muted,#555);margin:4px 0 10px;padding:8px 10px;border-radius:6px;background:var(--surface2,#f2f2f2)}" +
    "#thv .thfoot{margin-top:12px;font-size:12px;color:var(--muted,#555)}#thv code{font-size:11.5px;overflow-wrap:anywhere}" +
    "@media (max-width:560px){#thv .thtop{padding:8px 12px 6px}#thv .thbody{padding:8px 12px 24px}#thv h2{font-size:16px}#thv .thtabs button{font-size:12.5px;padding:4px 3px}}";

  function rowLine(r, lead) {
    /* [outlet, kind, home, outlet's country, date, link, headline, machine translated, country inferred] */
    var u = safeUrl(r[5]), place = r[3] ? cName(r[3]) + (r[8] ? " (placed by where its stories are filed)" : "") : "country not known";
    return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(r[0]) + "</b></a>" : "<b>" + esc(r[0]) + "</b>") +
      ' <span class="tho" style="display:inline">· ' + esc(KIND[r[1]] || "") + (r[1] === "state" ? " (a claim)" : "") + " · based in " + esc(place) + " · " + esc(when(r[4])) + "</span>" +
      (r[6] && r[6] !== lead ? '<span class="tho">' + esc(txt(r[6])) + (r[7] ? " (machine translated)" : "") + "</span>" : r[7] ? '<span class="tho">Machine translated headline</span>' : "") + "</li>";
  }
  function storyLine(t, s, key) {
    var ix = s[0], n = s[1], lead = t.rows[ix[0]], u = safeUrl(lead[5]), hl = txt(lead[6]);
    var state = ix.some(function (i) { return t.rows[i][1] === "state"; });
    return "<li>" + (u ? '<a class="tht" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(hl) + "</a>" : '<span class="tht">' + esc(hl) + "</span>") +
      (key === "said" ? '<span class="thclaim" title="What an official or agency says: their claim, not established fact">Claim</span>' : state ? '<span class="thclaim" title="Carried by state media: that government\'s line">State media</span>' : "") +
      '<span class="tho">' + esc(lead[0]) + (n > 1 ? " and " + plural(n - 1, "other outlet") : "") + " · " + esc(when(lead[4])) + "</span>" +
      '<details class="threp"><summary>' + (ix.length > 1 ? "All " + ix.length + " reports" : "Source") + "</summary><ul>" + ix.map(function (i) { return rowLine(t.rows[i], lead[6]); }).join("") + "</ul></details></li>";
  }
  function partsHtml(t) {
    var by = {}; (t.parts || []).forEach(function (p) { by[p[0]] = p[1]; });
    var first = true;
    return '<p class="thnote">The reports on this story, sorted into the questions they answer by the words in each headline. A machine sort, not an analyst: open a report to read it in full.</p>' +
      ORDER.filter(function (k) { return by[k] && by[k].length; }).map(function (k) {
        var L = by[k], n = 0; L.forEach(function (s) { n += s[0].length; });
        var h = '<details class="thpart" data-part="' + k + '"' + (first ? " open" : "") + "><summary>" + esc(PART[k][0]) + '<span class="thn">' + plural(n, "report") + "</span></summary>" +
          '<p class="thwhy">' + esc(PART[k][1]) + '</p><ul class="ths">' + L.map(function (s) { return storyLine(t, s, k); }).join("") + "</ul></details>";
        first = false; return h;
      }).join("");
  }
  function devHtml(t) {
    var part = {}; (t.parts || []).forEach(function (p) { p[1].forEach(function (s) { s[0].forEach(function (i) { part[i] = p[0]; }); }); });
    return '<p class="thnote">How the story developed: the first report of each strand, oldest first, in Zulu and local time. Early reports are often wrong or incomplete.</p>' +
      '<ol class="thdev">' + (t.dev || []).map(function (i) {
        var r = t.rows[i]; if (!r) return ""; var u = safeUrl(r[5]);
        return '<li><span class="thwhen">' + esc(when(r[4])) + (part[i] ? '<span class="thtag">' + esc(PART[part[i]][0]) + "</span>" : "") + "</span>" +
          (u ? '<a class="tht" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(r[6])) + "</a>" : '<span class="tht">' + esc(txt(r[6])) + "</span>") +
          '<span class="tho">' + esc(r[0]) + " · " + esc(KIND[r[1]] || "") + (r[7] ? " · machine translated" : "") + "</span></li>";
      }).join("") + "</ol>";
  }
  function connHtml(t, cc) {
    var N = t.names || [];
    if (!N.length) return '<p class="thnote">No person, body, place or system in these headlines is named often enough elsewhere to follow.</p>';
    if (!nameSel || !N.some(function (n) { return n[0] === nameSel; })) nameSel = N[0][0];
    var cur = N.filter(function (n) { return n[0] === nameSel; })[0], tk = cc + ":" + t.id;
    var lines = (cur[3] || []).map(function (l) {
      /* [country, date, outlet, link, headline, its thread "cc:id" or "", shares this event's words 1/0] */
      var u = safeUrl(l[3]), note = noteOf(tk, cur[0], l[3]), v = note && note.decision;
      return '<li data-link="' + esc(l[3]) + '">' + (u ? '<a class="tht" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(l[4])) + "</a>" : '<span class="tht">' + esc(txt(l[4])) + "</span>") +
        '<span class="tho">' + esc(l[2]) + " · " + esc(cName(l[0])) + " · " + esc(when(l[1])) + (l[6] ? " · looks like this same event, reported there" : " · another story") + "</span>" +
        '<div class="thact">' + (l[5] ? '<button type="button" class="thgo" data-thgo="' + esc(l[5]) + '">Go deeper on that story</button>' : "") +
        '<button type="button" data-thmark="linked" aria-pressed="' + (v === "linked") + '">Linked</button><button type="button" data-thmark="not" aria-pressed="' + (v === "not") + '">Not linked</button>' +
        (v ? '<span class="tho" style="display:inline;align-self:center">Your note, ' + esc(when(note.at)) + "</span>" : "") + "</div></li>";
    }).join("");
    return '<p class="thnote"><b>Names in this story</b> and the other headlines OSAP holds that name them, here and in other countries. Sharing a name is not a link: the same name can be a different person or body. Mark a pair <b>Linked</b> or <b>Not linked</b> to keep your own note on this device.</p>' +
      '<div class="thnames" role="group" aria-label="Names">' + N.map(function (n) {
        return '<button type="button" data-thname="' + esc(n[0]) + '" aria-pressed="' + (n[0] === nameSel) + '">' + esc(n[0]) + "<small>" + plural(n[2], "other headline") + "</small></button>"; }).join("") + "</div>" +
      (lines ? '<ul class="ths" style="padding:0">' + lines + "</ul>" : '<p class="tho">No other headline in the last ' + esc((get(cc) || {}).hours || 72) + " hours names " + esc(cur[0]) + ".</p>") +
      (cur[2] > (cur[3] || []).length ? '<p class="tho">Showing ' + (cur[3] || []).length + " of " + cur[2] + ". Other stories first, then this event as reported elsewhere.</p>" : "");
  }
  function allHtml(t) {
    return '<p class="thnote">Every report in this story, oldest first: each outlet\'s own headline and link, who owns it and where it is based.' + (t.r > t.rows.length ? " " + t.rows.length + " of " + t.r + " are listed: the first and the newest." : "") + '</p><ul class="ths" style="padding:0">' +
      t.rows.map(function (r) { var u = safeUrl(r[5]); return "<li>" + (u ? '<a class="tht" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(r[6])) + "</a>" : esc(txt(r[6]))) +
        '<span class="tho">' + esc(r[0]) + " · " + esc(KIND[r[1]] || "") + (r[1] === "state" ? " (a claim)" : "") + " · based in " + esc(r[3] ? cName(r[3]) : "country not known") + " · " + esc(when(r[4])) + (r[7] ? " · machine translated" : "") + "</span></li>"; }).join("") + "</ul>";
  }
  function render() {
    if (!box) return;
    var top = trail[trail.length - 1], t = top && find(top.cc, top.id), f = top && get(top.cc);
    var p = box.querySelector(".thp"), body = "";
    if (!t) {
      body = '<p class="thnote">' + (top && files[top.cc] === 1 ? "Loading…" : "This story is no longer in the last 72 hours of news, or its file could not be read.") + "</p>";
    } else if (tab === "parts") body = partsHtml(t);
    else if (tab === "dev") body = devHtml(t);
    else if (tab === "conn") body = connHtml(t, top.cc);
    else body = allHtml(t);
    var crumbs = trail.map(function (x, i) {
      var tt = find(x.cc, x.id), lab = (tt ? txt(tt.t) : "Story").slice(0, 48) + (tt && txt(tt.t).length > 48 ? "…" : "");
      return i === trail.length - 1 ? "<span>" + esc(lab) + "</span>" : '<button type="button" data-thback="' + i + '">' + esc(lab) + "</button>";
    });
    var k = t ? t.k || {} : {}, o = t ? t.o || {} : {};
    p.innerHTML = '<div class="thtop"><div class="thbar"><div class="thtrail">' + (trail.length > 1 ? crumbs.join(" › ") : "Go deeper") + "</div>" +
      '<button type="button" class="thx" data-thclose aria-label="Close">×</button></div>' +
      (t ? "<h2>" + (safeUrl(t.u) ? '<a href="' + esc(t.u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(t.t)) + "</a>" : esc(txt(t.t))) + "</h2>" +
        '<p class="thm"><b>' + plural(t.n, "outlet") + "</b>, " + plural(t.r, "report") + " · " + esc(cName(top.cc)) + " · " + esc(when(t.d0)) + " to " + esc(when(t.d)) + "</p>" +
        '<p class="thm">' + [k.state ? k.state + " state media" : "", k.public ? k.public + " public" : "", k.other ? k.other + " private or independent" : ""].filter(Boolean).join(", ") +
          " · " + [o.dom ? o.dom + " based in " + esc(cName(top.cc)) : "", o.out ? o.out + " elsewhere" : ""].filter(Boolean).join(", ") + "</p>" +
        '<div class="thtabs" role="tablist">' + [["parts", "The story"], ["dev", "Timeline"], ["conn", "Connections"], ["all", "All reports"]].map(function (b) {
          return '<button type="button" role="tab" data-thtab="' + b[0] + '" aria-selected="' + (tab === b[0]) + '">' + esc(b[1]) + "</button>"; }).join("") + "</div>" : "") +
      '</div><div class="thbody">' + body +
      (t ? '<div class="thfoot"><p>' + esc(f && f.method || "") + "</p><p>Record fingerprint (SHA-256 of every report link in this story): <code>" + esc(t.fp || "") + "</code></p>" +
        "<p>Built " + esc(when(String(f && f.asof || "").replace(" ", "T"))) + " from the last " + esc(f && f.hours || 72) + " hours of headlines.</p></div>" : "") + "</div>";
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("button");
    if (!b) { if (e.target === box) close(); return; }
    var top = trail[trail.length - 1];
    if (b.hasAttribute("data-thclose")) close();
    else if (b.hasAttribute("data-thtab")) { tab = b.getAttribute("data-thtab"); render(); box.querySelector(".thbody").scrollTop = 0; }
    else if (b.hasAttribute("data-thname")) { nameSel = b.getAttribute("data-thname"); render(); }
    else if (b.hasAttribute("data-thback")) { trail = trail.slice(0, +b.getAttribute("data-thback") + 1); tab = "parts"; nameSel = ""; render(); }
    else if (b.hasAttribute("data-thgo")) {
      var m = String(b.getAttribute("data-thgo")).split(":");
      if (m.length === 2) { trail.push({ cc: m[0], id: m[1] }); tab = "parts"; nameSel = ""; render(); load(m[0], function () { render(); }); }
    } else if (b.hasAttribute("data-thmark") && top) {
      var li = b.closest("li"), link = li && li.getAttribute("data-link"), v = b.getAttribute("data-thmark");
      var cur = noteOf(top.cc + ":" + top.id, nameSel, link), title = li && li.querySelector(".tht") ? li.querySelector(".tht").textContent : "";
      setNote(top.cc + ":" + top.id, nameSel, link, title, cur && cur.decision === v ? "" : v);
      render();
    }
  }
  function onKey(e) { if (e.key === "Escape" && box) { e.preventDefault(); close(); } }
  var back = null;
  function open(cc, id) {
    if (!D.getElementById("thv-css")) { var st = D.createElement("style"); st.id = "thv-css"; st.textContent = CSS; D.head.appendChild(st); }
    back = D.activeElement;
    if (!box) {
      box = D.createElement("div"); box.id = "thv"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Go deeper on a story");
      box.innerHTML = '<div class="thp"></div>';
      box.addEventListener("click", onClick);
      D.body.appendChild(box); D.addEventListener("keydown", onKey);
    }
    trail = [{ cc: cc, id: id }]; tab = "parts"; nameSel = "";
    render(); load(cc, function () { render(); });
    var x = box.querySelector(".thx"); if (x) x.focus();
  }
  function close() {
    if (!box) return;
    box.remove(); box = null; D.removeEventListener("keydown", onKey); trail = [];
    if (back && back.focus) try { back.focus(); } catch (e) {}
  }
  W.OSAP_THREADSQ = { load: load, get: get, find: find, ofLinks: ofLinks, open: open, close: close, isOpen: function () { return !!box; }, PART: PART, notes: notes };
})();
