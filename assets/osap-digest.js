/* AXIOM OSAP: report digests.
   Self-contained block loaded after the main page script. When a Report card is open, it adds a short digest of the article under the
   headline, if the refresh job has drafted one (data/live/digest.js, written by tools/refresh_digest.mjs on the Actions runner's own
   open model: the article is read there and only the digest is kept).
   - The digest is a draft, AI-generated, not analyst-approved: a small "AI generated" tag says so, the full wording is in its tooltip.
     It never changes the record, its status or its figures.
   - Claims stay claims: each shows who makes it and its status (alleged, under investigation, ...).
   - Matched to the open report by its original link. The file is fetched only when a Report card is first opened. */
(function () {
  "use strict";
  var FILE = "data/live/digest.js", state = 0, cbs = [];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(cb) {
    if (state === 2) return cb();
    cbs.push(cb); if (state === 1) return;
    state = 1;
    var s = document.createElement("script");
    s.src = FILE + "?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () { state = 2; var l = cbs; cbs = []; l.forEach(function (f) { try { f(); } catch (e) {} }); };
    document.head.appendChild(s);
  }
  window.OSAP_DIGEST_FOR = function (url) { var d = window.OSAP_DIGEST; return d && d.items && url ? d.items[url] || null : null; };

  function html(d, label) {
    var cap = function (s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
    var rows = [];
    if (d.where) rows.push("<dt>Where</dt><dd>" + esc(d.where) + "</dd>");
    if (d.when) rows.push("<dt>When</dt><dd>" + esc(d.when) + "</dd>");
    if (d.who && d.who.length) rows.push("<dt>Who</dt><dd>" + esc(d.who.join("; ")) + "</dd>");
    if (d.figures && d.figures.length) rows.push("<dt>Figures</dt><dd>" + d.figures.map(function (f) { return "<b>" + esc(f.value) + "</b> " + esc(f.of); }).join("<br>") +
      '<span class="sub">As the article gives them</span></dd>');
    var claims = (d.claims || []).map(function (c) {
      return "<li>" + esc(c.text) + (c.by ? ' <span class="dgby">(' + esc(c.by) + ")</span>" : "") + (c.status ? ' <span class="dgst">' + esc(cap(c.status)) + "</span>" : "") + "</li>";
    }).join("");
    return '<h4 class="pkgh">Digest <span class="aitag" title="' + esc(label || "Draft, AI-generated, not analyst-approved") + ". Written by " + esc(d.model || "an open model") +
      " from the article; the article itself is not stored.\">AI generated</span></h4>" +
      '<p class="dgwhat">' + esc(d.what) + "</p>" +
      (rows.length ? '<dl class="pkgdl dgdl">' + rows.join("") + "</dl>" : "") +
      (claims ? '<p class="dgh">Claims, not confirmed</p><ul class="dgclaims">' + claims + "</ul>" : "") +
      (d.next ? '<p class="dgnext"><b>Next:</b> ' + esc(d.next) + "</p>" : "");
  }
  function linkOf(pane) {
    var a = null;
    Array.prototype.some.call(pane.querySelectorAll("dl.pkgdl dt"), function (dt) { if (dt.textContent.trim() === "Original") { a = dt.nextElementSibling && dt.nextElementSibling.querySelector("a[href]"); return true; } });
    return a ? a.getAttribute("href") : "";
  }
  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll('.pkgpane[data-pane="rep"]'), function (pane) {
      var t = pane.querySelector(".pkgt"); if (!t) return;
      var url = linkOf(pane); if (!url) return;
      if (pane.__dgUrl === url) return;
      pane.__dgUrl = url;
      load(function () {
        if (pane.__dgUrl !== url) return;
        var d = window.OSAP_DIGEST_FOR(url), old = pane.querySelector(".dgsum"); if (old) old.remove();
        if (!d || !d.what) return;
        var sec = document.createElement("section"); sec.className = "dgsum"; sec.innerHTML = html(d, (window.OSAP_DIGEST || {}).label);
        var at = pane.querySelector(".pkgd") || t;
        at.parentNode.insertBefore(sec, at.nextSibling);
      });
    });
  }
  var queued = false;
  new MutationObserver(function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan(); }); })
    .observe(document.body, { childList: true, subtree: true });
  var st = document.createElement("style");
  st.textContent = ".dgsum{margin:8px 0 6px;padding:8px 10px;border:1px solid var(--line,#c9d1d9);border-radius:4px}" +
    ".dgsum .pkgh{margin-top:0;display:flex;gap:8px;align-items:center}.dgwhat{margin:4px 0 6px;font-size:13.5px;line-height:1.45}" +
    ".dgdl{margin:4px 0}.dgh{font-size:12px;font-weight:600;margin:8px 0 2px}.dgclaims{margin:2px 0;padding-left:18px;font-size:12.5px}" +
    ".dgclaims li{margin:2px 0}.dgby{color:var(--muted,#56626F)}.dgst{font-size:10.5px;border:1px solid currentColor;border-radius:8px;padding:0 5px;color:var(--warn,#8a5a00);white-space:nowrap}" +
    ".dgnext{font-size:12.5px;margin:6px 0 0}";
  document.head.appendChild(st);
})();
