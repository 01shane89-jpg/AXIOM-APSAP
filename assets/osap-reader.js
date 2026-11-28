/* In-app reader for open-licence articles (Shane 17 Nov 2026: "Free-to-reuse sources only").
   tools/refresh_fulltext.mjs stores the full text of articles whose publisher's licence allows republishing (The Conversation,
   CC BY-ND 4.0; GOV.UK, Open Government Licence v3.0) in data/live/fulltext/<shard>.js; data/live/fulltext/index.js lists the
   publishers, their licences and the address patterns. Every other outlet stays a link: OSAP never copies its text.
   OSAP_READER.can(url)  true when the address is one of those publishers' articles
   OSAP_READER.open(url, { title, src })  opens the reader over the page: the article as published (text only, unedited), the
     authors and institutions, the licence, the original's link, and how OSAP read it (time, SHA-256 of the page bytes). */
(function () {
  "use strict";
  var W = window, D = document, IX = null, rules = [], wait = [];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function web(u) { u = String(u || ""); return /^https:\/\/[^\s"<>]+$/i.test(u) ? u : ""; }
  /* an article address: https, or plain http for a publisher the index marks http (ruleFor checks which) */
  function art(u) { u = String(u || ""); return /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : ""; }
  function out(u, text, cls) { return '<a' + (cls ? ' class="' + cls + '"' : "") + ' href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + text + "</a>"; }
  var ARROW = ' <span aria-hidden="true">↗</span>';
  /* the same FNV-1a shard as tools/fulltext_lib.mjs */
  function fnv(s) { var h = 0x811c9dc5; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
  function shardOf(u) { var k = (fnv(u) % ((IX && IX.shards) || 64)).toString(16); return k.length < 2 ? "0" + k : k; }
  function ready() {
    IX = W.OSAP_FTIX || null;
    rules = ((IX && IX.rules) || []).map(function (r) { var re = null; try { re = new RegExp(r.path, "i"); } catch (e) {} return { r: r, re: re }; });
    var w = wait; wait = []; w.forEach(function (f) { try { f(); } catch (e) {} });
    try { D.dispatchEvent(new CustomEvent("osap:reader")); } catch (e) {}
  }
  function ruleFor(url) {
    var u; try { u = new URL(String(url)); } catch (e) { return null; }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.port) return null;
    var host = u.hostname.toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      var x = rules[i];
      if (x.re && x.r.hosts.some(function (h) { return h === host || "www." + h === host; }) && x.re.test(u.pathname)) return u.protocol === "https:" || x.r.http ? x.r : null;
    }
    return null;
  }
  function loadIndex() {
    if (W.OSAP_FTIX) { ready(); return; }
    if (!/^https?:$/.test(location.protocol)) return;
    var s = D.createElement("script"); s.src = "data/live/fulltext/index.js"; s.async = true;
    s.onload = ready; s.onerror = function () {}; D.head.appendChild(s);
  }
  var shardP = {};
  function loadShard(k) {
    if (W.OSAP_FT && W.OSAP_FT[k]) return Promise.resolve(W.OSAP_FT[k]);
    if (shardP[k]) return shardP[k];
    shardP[k] = new Promise(function (res) {
      var s = D.createElement("script"); s.src = "data/live/fulltext/" + k + ".js";
      s.onload = function () { res((W.OSAP_FT || {})[k] || {}); };
      s.onerror = function () { delete shardP[k]; res(null); };
      D.head.appendChild(s);
    });
    return shardP[k];
  }
  function when(t) { var T = W.OSAP_TIME; return t ? (T && T.asofT ? T.asofT(t) : String(t).replace("T", " ").slice(0, 16) + "Z") : ""; }
  function host(u) { return String(u).replace(/^https?:\/\/(www\.)?/i, "").split(/[\/?#]/)[0]; }
  function partsHtml(s) {
    return (s || []).map(function (p) {
      if (typeof p === "string") return esc(p);
      var u = web(p && p[1]); return u ? out(u, esc(p[0])) : esc(p && p[0]);
    }).join("");
  }
  function bodyHtml(B) {
    var h = "", list = false;
    (B || []).forEach(function (b) {
      if (b.k === "li") { if (!list) { h += "<ul>"; list = true; } h += "<li>" + partsHtml(b.s) + "</li>"; return; }
      if (list) { h += "</ul>"; list = false; }
      var tag = b.k === "h" ? "h3" : b.k === "hs" ? "h4" : b.k === "q" ? "blockquote" : "p";
      h += "<" + tag + ">" + partsHtml(b.s) + "</" + tag + ">";
    });
    return h + (list ? "</ul>" : "");
  }
  var box = null, lastFocus = null;
  function close() {
    if (!box) return;
    box.remove(); box = null; D.documentElement.classList.remove("ftopen");
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  function frame(inner) {
    close();
    lastFocus = D.activeElement;
    box = D.createElement("div"); box.id = "ft-reader"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Article reader");
    box.innerHTML = '<div class="ftback" data-ftclose></div><div class="ftsheet"><div class="fthead"><b>Reader</b><span class="fttag">Publisher\'s text, open licence</span>' +
      '<button type="button" class="ftx" data-ftclose aria-label="Close the reader">×</button></div><div class="ftbody" tabindex="-1">' + inner + "</div></div>";
    D.body.appendChild(box); D.documentElement.classList.add("ftopen");
    box.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-ftclose]")) close(); });
    var b = box.querySelector(".ftbody"); b.scrollTop = 0; try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
    return box;
  }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && box) close(); });
  function open(url, o) {
    o = o || {};
    var u = art(url), rule = u && ruleFor(u);
    if (!rule) { if (u) W.open(u, "_blank", "noopener,noreferrer"); return false; }
    frame('<h2 class="ftt">' + esc(o.title || "") + '</h2><p class="ftobs">Loading the article…</p>');
    var mine = box;
    loadShard(shardOf(u)).then(function (S) {
      if (box !== mine) return;
      var e = S && S[u];
      var orig = '<p class="ftorig">' + out(u, "Read it at " + esc(rule.name) + ARROW, "ftbtn") + '<span class="ftsub">The original at ' + esc(host(u)) + ", in a new tab, with its pictures.</span></p>";
      if (!e || e.miss || !e.blocks) {
        box.querySelector(".ftbody").innerHTML = '<h2 class="ftt">' + esc(o.title || "") + "</h2>" +
          '<p class="ftobs">' + (S == null ? "The article store could not be loaded. Check the connection, or your plan if OSAP asked you to upgrade." : "OSAP has not read this article yet. New articles are read within the hour, unless the publisher refused the read.") + "</p>" + orig;
        return;
      }
      var by = (e.by || []).map(function (a) { return "<b>" + esc(a.n) + "</b>" + (a.r ? ", " + esc(a.r) : ""); }).join("; ");
      var dates = [e.pub ? "Published " + esc(when(e.pub)) : "", e.mod && e.mod !== e.pub ? "Updated " + esc(when(e.mod)) : ""].filter(Boolean).join(" · ");
      box.querySelector(".ftbody").innerHTML =
        '<p class="ftsrc">' + esc(rule.name) + (o.src && o.src.indexOf(rule.name) < 0 ? " · via " + esc(o.src) : "") + "</p>" +
        '<h2 class="ftt">' + esc(e.title || o.title || "") + "</h2>" +
        (by ? '<p class="ftby">' + (rule.id === "govuk" || rule.from ? "From " : "By ") + by + "</p>" : "") +
        (dates ? '<p class="ftsub">' + dates + "</p>" : "") +
        (e.change ? '<p class="ftsub">Latest change: ' + esc(e.change) + "</p>" : "") +
        '<p class="ftlic">' + (rule.id === "conversation" ? "This article is republished from " + out(u, "The Conversation") + " under a " + out(rule.licUrl, esc(rule.lic)) + " licence. Read the " + out(u, "original article") + "."
          : rule.credit ? esc(rule.credit) + " " + out(rule.licUrl, "Licence") + ". " + out(u, "Original at " + esc(rule.name)) + "."
          : "Contains public sector information licensed under the " + out(rule.licUrl, esc(rule.lic)) + ". " + out(u, "Original on GOV.UK") + ".") + "</p>" +
        orig + '<div class="fttext">' + bodyHtml(e.blocks) + "</div>" +
        '<div class="ftprov"><h4>Where this text comes from</h4>' +
          "<p>" + esc(rule.note) + "</p>" +
          "<p>Read by OSAP on " + esc(when(e.at)) + " from " + (e.read && e.read !== u ? "the " + esc(rule.apiName || host(e.read)) : esc(host(u))) +
          ", turned into plain text by fixed rules (" + esc(e.x || "") + "), not by AI. Images and embedded media are left out; the publisher's own links are kept.</p>" +
          '<p>SHA-256 of what OSAP read: <code class="ftsha">' + esc(e.sha || "") + "</code></p>" +
          (rule.http ? "<p>Read over plain http: the publisher's https site does not answer OSAP's servers, so the copy could not be protected in transit. The SHA-256 is of what arrived.</p>" : "") +
          "<p>It is the publisher's account or opinion, not an OSAP finding, and no analyst has checked it." + (rule.nd ? " It is not translated: the licence does not allow translations." : "") + "</p>" +
          '<p><a href="' + esc(rule.terms) + '" target="_blank" rel="noopener noreferrer">The publisher\'s reuse terms' + ARROW + "</a></p></div>";
      box.querySelector(".ftbody").scrollTop = 0;
    });
    return true;
  }
  W.OSAP_READER = {
    can: function (url) { return !!(art(url) && ruleFor(url)); },
    open: open, close: close,
    whenReady: function (f) { if (IX) f(); else wait.push(f); },
    _ruleFor: ruleFor, _shardOf: shardOf
  };
  var css = D.createElement("style");
  css.textContent =
    "#ft-reader{position:fixed;inset:0;z-index:100500;display:flex;align-items:stretch;justify-content:center}" +
    "#ft-reader .ftback{position:absolute;inset:0;background:rgba(10,16,22,.55)}" +
    "#ft-reader .ftsheet{position:relative;display:flex;flex-direction:column;width:min(760px,100%);max-height:100%;margin:auto;height:min(100%,920px);background:var(--surface,#fff);color:var(--ink,#141b23);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden}" +
    "#ft-reader .fthead{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line,#ccd3da);font-size:13px}" +
    "#ft-reader .fttag{font-size:11px;color:var(--muted,#5b6670);border:1px solid var(--line,#ccd3da);border-radius:10px;padding:1px 8px}" +
    "#ft-reader .ftx{margin-left:auto;font:inherit;font-size:24px;line-height:1;background:none;border:none;color:var(--muted,#5b6670);cursor:pointer;min-width:40px;min-height:40px}" +
    "#ft-reader .ftbody{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 20px 32px;outline:none;overflow-wrap:anywhere}" +
    "#ft-reader .ftsrc{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5b6670);margin:0 0 4px}" +
    "#ft-reader .ftt{font-size:22px;line-height:1.25;margin:0 0 8px}" +
    "#ft-reader .ftby{font-size:14px;margin:0 0 4px}" +
    "#ft-reader .ftsub{display:block;font-size:12px;color:var(--muted,#5b6670);margin:2px 0}" +
    "#ft-reader .ftlic{font-size:12.5px;background:var(--surface2,#eef2f5);border-left:3px solid var(--accent,#1D5A86);padding:8px 10px;margin:10px 0}" +
    "#ft-reader .ftorig{margin:8px 0 14px}" +
    "#ft-reader .ftbtn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:8px 14px;border-radius:6px;background:var(--accent,#1D5A86);color:var(--on-accent,#fff)!important;font-weight:600;font-size:13px;text-decoration:none}" +
    "#ft-reader .fttext{font-size:16px;line-height:1.65}" +
    "#ft-reader .fttext p,#ft-reader .fttext ul,#ft-reader .fttext blockquote{margin:0 0 14px}" +
    "#ft-reader .fttext h3{font-size:18px;margin:22px 0 8px}#ft-reader .fttext h4{font-size:16px;margin:18px 0 6px}" +
    "#ft-reader .fttext blockquote{border-left:3px solid var(--line,#ccd3da);padding-left:12px;color:var(--muted,#5b6670)}" +
    "#ft-reader a{color:var(--accent,#1D5A86);text-decoration:underline;text-underline-offset:2px}" +
    "#ft-reader .ftprov{margin-top:24px;padding-top:10px;border-top:1px solid var(--line,#ccd3da);font-size:12px;color:var(--muted,#5b6670)}" +
    "#ft-reader .ftprov h4{font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px}#ft-reader .ftprov p{margin:0 0 6px}" +
    "#ft-reader .ftsha{word-break:break-all;font-size:11px}" +
    "#ft-reader .ftobs{color:var(--muted,#5b6670)}" +
    "@media (max-width:700px){#ft-reader .ftsheet{width:100%;height:100%;border-radius:0}#ft-reader .ftbody{padding:14px 16px 40px}}" +
    "html.ftopen,html.ftopen body{overflow:hidden}";
  D.head.appendChild(css);
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", loadIndex); else loadIndex();
})();
