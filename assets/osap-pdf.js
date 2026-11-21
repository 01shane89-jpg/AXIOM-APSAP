/* AXIOM OSAP: one way to export any report as a PDF (Shane 2026-10-25: "Any report from OSAP needs to be able to be exported as
   a PDF. And perfectly formatted." and "Preserve the source hyperlinks in the reports").
   Every report's "Export PDF" button calls OSAP_PDF.print({ title, root, ... }). It uses the browser's own print engine, so the
   PDF keeps real text and live links, needs no key, account or server, and works offline:
   - every page gets a running header and footer in the page margins: the report title, when it was exported (Zulu and local
     time), "Includes AI-generated parts" when the report holds any part tagged AI generated, and "Page X of Y";
   - bare web addresses in the report become links first, so every source stays clickable in the PDF;
   - shared page rules keep table rows, figures and maps whole, repeat table headings on each page and keep headings with
     the text that follows; nothing sets the paper size, so A4 and US Letter both come from the print dialog's choice
     (tests/pdf_export_smoke.mjs renders every report on both and fails on anything wider than the page);
   - folded sections (<details>) print open;
   - the document title becomes the report's file name, which "Save as PDF" offers;
   - print() runs inside the tap itself (Safari on iPhone and iPad ignores one started later), and when no print dialog opens
     at all (an app opened from the iPhone Home Screen, a browser inside another app) a message says so and how to get the
     PDF, so the button never seems dead (tests/pdf_print_open_smoke.mjs);
   - it waits for the browser's afterprint before tidying up (a phone's print sheet returns at once; the print-only rules
     change nothing on screen, so they stay until the next export or until the page reloads).
   Browsers that do not print page-margin boxes (Firefox, Safari at the time of writing) get the same header once, at the top of
   the report, and their own page numbers. Nothing here changes a record or what a report says. */
(function () {
  "use strict";
  var W = window, D = document;
  var cur = null;   /* the export in progress: { done } */

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* text for a CSS content string */
  function cssStr(s) { return '"' + String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function stamp(ms) {
    var T = W.OSAP_TIME;
    return T && T.dualT ? T.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
  }
  /* Chromium 131 and later (Chrome, Edge, Opera, Samsung Internet, the desktop app) print @page margin boxes */
  function marginBoxes(win) {
    var ua = (win.navigator && win.navigator.userAgent) || "";
    if (/Firefox\//.test(ua)) return false;
    var m = /(?:Chrome|Chromium|CriOS)\/(\d+)/.exec(ua);
    return !!m && +m[1] >= 131 && !/CriOS/.test(ua);
  }
  /* file name: letters, digits, spaces and a few marks; the export time in Zulu at the end */
  function fileName(title, ms) {
    var d = new Date(ms), p = function (n) { return ("0" + n).slice(-2); };
    var z = d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + p(d.getUTCMinutes()) + "Z";
    return clip("OSAP " + String(title || "report").replace(/[\\/:*?"<>|#%{}~&]+/g, " "), 110) + " " + z;
  }

  /* shared print rules: only while an export is on (html.pdfx), only on paper */
  var CSS = "@media print{" +
    "html.pdfx{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "html.pdfx body{background:#fff!important}" +
    "html.pdfx .pdfx-root thead{display:table-header-group}html.pdfx .pdfx-root tfoot{display:table-footer-group}" +
    "html.pdfx .pdfx-root tr,html.pdfx .pdfx-root figure,html.pdfx .pdfx-root img,html.pdfx .pdfx-root canvas,html.pdfx .pdfx-root .pdfx-keep{break-inside:avoid;page-break-inside:avoid}" +
    "html.pdfx .pdfx-root svg{break-inside:avoid}" +
    "html.pdfx .pdfx-root :is(h1,h2,h3,h4,h5){break-after:avoid;page-break-after:avoid}" +
    /* a caption or heading stays with the map, figure or table under it; a table's first row may split, so its heading row and
       caption never sit alone at the foot of a page */
    "html.pdfx .pdfx-root :is(h1,h2,h3,h4,h5,h6,p,figcaption):has(+ :is(figure,table,svg,img,canvas,.tlrfig,.arpfig,.arpmap,.pdfx-keep)){break-after:avoid;page-break-after:avoid}" +
    "html.pdfx .pdfx-root :is(.tlrfig,.arpfig){break-inside:avoid}" +
    "html.pdfx .pdfx-root tbody>tr:first-child{break-inside:auto}" +
    "html.pdfx .pdfx-root :is(p,li,dd){orphans:2;widows:2}" +
    "html.pdfx .pdfx-root :is(img,canvas,video){max-width:100%!important}" +
    "html.pdfx .pdfx-root table{max-width:100%}" +
    "html.pdfx .pdfx-root :is(a,code){overflow-wrap:anywhere}" +
    "html.pdfx .pdfx-root .pdfx-hide,html.pdfx .pdfx-root [data-pdf-hide]{display:none!important}" +
    "html.pdfx .pdfx-root a.pdfx-a{color:inherit;text-decoration:none}" +
    ".pdfx-head{display:none}" +
    "html.pdfx-sheet body>*:not(#pdfx-sheet){display:none!important}" +
    "html.pdfx-sheet,html.pdfx-sheet body{height:auto!important;overflow:visible!important;position:static!important}" +
    "#pdfx-sheet{display:block!important;color:#111;background:#fff;font:10.5pt/1.4 system-ui,-apple-system,'Segoe UI',sans-serif}" +
    "#pdfx-sheet h1{font-size:17pt;margin:0 0 4px}#pdfx-sheet h2{font-size:13pt;margin:10px 0 4px}#pdfx-sheet h4{font-size:11pt;margin:8px 0 3px}" +
    "#pdfx-sheet a{color:#12324a}#pdfx-sheet .obs{color:#444}" +
    "html.pdfx.pdfx-nomb .pdfx-root .pdfx-head{display:block;font:8.5px/1.35 system-ui,sans-serif;color:#55616b;border-bottom:1px solid #c9d0d6;padding:0 0 3px;margin:0 0 6px}" +
    "}#pdfx-sheet{display:none}";
  function sheet(doc) {
    if (doc.getElementById("osap-pdf-css")) return;
    var s = doc.createElement("style"); s.id = "osap-pdf-css"; s.textContent = CSS; (doc.head || doc.documentElement).appendChild(s);
  }

  /* bare http(s) addresses in the report's text become links, so they stay clickable in the PDF */
  var URL_RE = /https?:\/\/[^\s<>"'`]+/g;
  function linkify(root) {
    if (!root || !root.ownerDocument) return 0;
    var doc = root.ownerDocument, n = 0, list = [];
    var tw = doc.createTreeWalker(root, 4 /* text */, { acceptNode: function (t) {
      if (!t.nodeValue || t.nodeValue.indexOf("http") < 0) return 2;
      for (var e = t.parentNode; e && e !== root.parentNode; e = e.parentNode) if (/^(A|SCRIPT|STYLE|TEXTAREA|OPTION|SELECT|BUTTON|TITLE)$/.test(e.nodeName)) return 2;
      return 1;
    } });
    while (tw.nextNode()) list.push(tw.currentNode);
    list.forEach(function (t) {
      var s = t.nodeValue, frag = doc.createDocumentFragment(), last = 0, m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(s))) {
        var u = m[0].replace(/[).,;:!?\]]+$/, ""); if (u.length < 12) continue;
        if (m.index > last) frag.appendChild(doc.createTextNode(s.slice(last, m.index)));
        var a = doc.createElement("a"); a.href = u; a.className = "pdfx-a"; a.rel = "noopener noreferrer"; a.target = "_blank"; a.textContent = u;
        frag.appendChild(a); last = m.index + u.length; n++;
      }
      if (!last) return;
      if (last < s.length) frag.appendChild(doc.createTextNode(s.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
    return n;
  }
  /* a part tagged AI generated (the .aitag chip also marks "Automatic" text, which is not AI) */
  function hasAi(root) {
    if (!root) return false;
    if (root.querySelector("[data-ai-generated]")) return true;
    return Array.prototype.some.call(root.querySelectorAll(".aitag"), function (t) { return /\bAI\b/.test(t.textContent); });
  }

  /* the @page rule: margins and the running header and footer */
  function pageCss(o, when, ai) {
    var f = "font:7.5px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;color:#55616b;";
    var m = o.margin || "14mm 12mm";
    var top = "Exported " + when + (ai ? " · Includes AI-generated parts, marked" : "");
    var foot = o.footer || "AXIOM OSAP · open-source situational awareness; sources are linked in the report";
    return "@media print{@page{" + (o.landscape ? "size:landscape;" : "") + "margin:" + m + ";" +
      "@top-left{content:" + cssStr(clip(o.title, 90)) + ";" + f + "font-weight:600;color:#12324a;vertical-align:bottom;padding-bottom:2mm}" +
      "@top-right{content:" + cssStr(top) + ";" + f + "text-align:right;vertical-align:bottom;padding-bottom:2mm}" +
      "@bottom-left{content:" + cssStr(clip(foot, 140)) + ";" + f + "vertical-align:top;padding-top:2mm}" +
      "@bottom-right{content:'Page ' counter(page) ' of ' counter(pages);" + f + "text-align:right;vertical-align:top;padding-top:2mm}}}";
  }

  function rootOf(o, doc) {
    var r = o.root;
    if (typeof r === "string") r = doc.querySelector(r);
    if (!r && doc.documentElement.classList.contains("briefing")) r = doc.getElementById("brief");
    return r || doc.body;
  }

  /* ---------- when the device opens no print dialog ----------
     Some places give a web page no print dialog at all, and print() then does nothing: an app opened from the iPhone or iPad
     Home Screen, and the browsers inside other apps (Instagram, Gmail, LinkedIn). The page then says so and how to get the
     PDF, instead of leaving a button that seems dead. */
  var NOT_OPENED_MS = 1500;
  function ios(win) { var n = win.navigator || {}, ua = n.userAgent || ""; return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (n.maxTouchPoints || 0) > 1); }
  function homeScreen(win) {
    var n = win.navigator || {};
    try { return n.standalone === true || !!(win.matchMedia && (win.matchMedia("(display-mode: standalone)").matches || win.matchMedia("(display-mode: fullscreen)").matches)); } catch (e) { return false; }
  }
  function advice(win) {
    if (ios(win) && homeScreen(win)) return "The iPhone and iPad do not open a print sheet for apps on the Home Screen. Open OSAP in Safari " +
      "(osap.axiom-intelligence-systems.com), open the same report and press Export PDF there. In the print sheet, tap the share button and pick Save to Files, or pinch out on the preview to get the PDF.";
    if (ios(win)) return "In Safari: tap the share button at the bottom of the screen, pick Print, then tap the share button in the print sheet and pick Save to Files. " +
      "If you opened OSAP from a link inside another app, open it in Safari first.";
    if (homeScreen(win)) return "This installed app did not open a print dialog. Open OSAP in your browser and press Export PDF there, or use the browser menu: Print, then Save as PDF.";
    return "Your browser did not open a print dialog. Try once more, or use the browser menu (Ctrl+P on Windows, Cmd+P on a Mac) and pick Save as PDF. " +
      "If you opened OSAP from a link inside another app, open it in your browser first.";
  }
  function notOpened(win, o) {
    var doc = win.document, box = doc.getElementById("pdfx-noprint");
    if (!box) {
      box = doc.createElement("div"); box.id = "pdfx-noprint"; box.setAttribute("role", "alertdialog"); box.setAttribute("aria-live", "assertive");
      box.className = "noprint";
      box.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;width:min(520px,calc(100vw - 32px));" +
        "box-sizing:border-box;background:#fff;color:#111;border:1px solid #c9d0d6;border-left:4px solid #b45309;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);" +
        "padding:12px 14px;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif";
      (doc.body || doc.documentElement).appendChild(box);
      box.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-pdfx]"); if (!b) return;
        box.hidden = true;
        if (b.getAttribute("data-pdfx") === "again" && box.__o) print(box.__o);
      });
    }
    box.__o = o;
    box.innerHTML = "<b>No print dialog opened.</b><p style=\"margin:6px 0 10px\">" + esc(advice(win)) + "</p>" +
      '<button type="button" class="refresh primary" data-pdfx="again" style="min-height:40px;margin-right:6px">Try again</button>' +
      '<button type="button" class="refresh" data-pdfx="close" style="min-height:40px">Close</button>';
    box.hidden = false;
    W.__pdfNoSheet = (W.__pdfNoSheet || 0) + 1;
  }

  /* o: { title, root (element or selector), file, ai (true/false; found from .aitag when left out), footer, landscape, margin,
         bare (no header or footer: a slide deck that sets its own page), win (another window, e.g. a package page) }
     returns a promise that settles once the print dialog is done with (afterprint) */
  function run(o) {
    if (cur) cur.done();
    var win = o.win || W, doc = win.document, html = doc.documentElement, now = Date.now();
    var root = rootOf(o, doc), title = o.title || (root.querySelector("h1,h2") || {}).textContent || doc.title || "Report";
    sheet(doc);
    var links = linkify(root), ai = o.ai != null ? !!o.ai : hasAi(root), when = stamp(now);
    var page = null, head = null, nomb = !o.bare && !marginBoxes(win);
    if (!o.bare) {
      page = doc.createElement("style"); page.id = "osap-pdf-page"; page.textContent = pageCss({ title: clip(title, 90), footer: o.footer, landscape: o.landscape, margin: o.margin }, when, ai);
      (doc.head || html).appendChild(page);
      if (nomb && root !== doc.body) {
        head = doc.createElement("div"); head.className = "pdfx-head";
        head.innerHTML = "<b>" + esc(clip(title, 120)) + "</b> · Exported " + esc(when) + (ai ? " · Includes AI-generated parts, marked" : "") + " · " + esc(o.footer || "AXIOM OSAP");
        root.insertBefore(head, root.firstChild);
      }
    }
    /* folded sections print open (a closed <details> prints only its summary line), and close again afterwards */
    var shut = Array.prototype.filter.call(root.querySelectorAll("details:not([open])"), function (d) { return !d.closest("[data-pdf-hide],.noprint"); });
    shut.forEach(function (d) { d.open = true; });
    root.classList.add("pdfx-root"); html.classList.add("pdfx"); if (nomb) html.classList.add("pdfx-nomb");
    var t0 = doc.title; doc.title = o.file || fileName(title, now);
    var info = { title: title, file: doc.title, ai: ai, links: links, when: when, bare: !!o.bare, landscape: !!o.landscape, root: root, marginBoxes: !nomb };
    var me = {}, finished = false, resolve;
    var p = new Promise(function (r) { resolve = r; });
    me.done = function () {
      if (finished) return; finished = true;
      win.removeEventListener("afterprint", me.done);
      if (page && page.parentNode) page.parentNode.removeChild(page);
      if (head && head.parentNode) head.parentNode.removeChild(head);
      shut.forEach(function (d) { d.open = false; });
      root.classList.remove("pdfx-root"); html.classList.remove("pdfx", "pdfx-nomb");
      if (doc.title === info.file) doc.title = t0;
      if (cur === me) cur = null;
      resolve(info);
    };
    cur = me;
    /* a held export (tests) renders PDFs itself, and each of those sends afterprint */
    if (typeof W.__pdfHold === "function") {
      /* tests hold the export open here to render it (tests/pdf_export_smoke.mjs) */
      setTimeout(function () { Promise.resolve(W.__pdfHold(info)).then(me.done, me.done); }, 60);
      return p;
    }
    win.addEventListener("afterprint", me.done);
    /* print() runs inside the tap itself, never after a timer: Safari on iPhone and iPad drops a print() that is not part of
       the tap, so the button looked dead (Shane 2026-11-21: "Export to pdf in the weather brief is not responding"). The
       print rules above are plain style changes, which the browser applies when it lays the page out for printing. */
    var opened = false, onBefore = function () { opened = true; };
    win.addEventListener("beforeprint", onBefore); win.addEventListener("afterprint", onBefore);
    var t = Date.now();
    try { win.focus(); win.print(); } catch (e) { win.removeEventListener("beforeprint", onBefore); me.done(); notOpened(win, o); return p; }
    if (Date.now() - t >= 400) opened = true;   /* print() held the page while its dialog was open: it opened */
    /* print() returned straight away (a phone's print sheet): put the page title back after a pause; afterprint, the next
       export or a reload clears the rest */
    if (Date.now() - t < 400) setTimeout(function () { if (!finished && doc.title === info.file) doc.title = t0; }, 4000);
    /* a print dialog that never opened (an iPhone Home Screen app, an in-app browser) says so instead of doing nothing */
    setTimeout(function () {
      win.removeEventListener("beforeprint", onBefore); win.removeEventListener("afterprint", onBefore);
      if (opened || finished) return;   /* a dialog opened, or a newer export took over */
      /* a stand-in print() (another test's) is not a device without a print dialog; tests/pdf_print_open_smoke.mjs opts in */
      if (!W.__pdfCheckDialog && !/\[native code\]/.test(String(win.print))) return;
      if (cur === me) me.done();
      notOpened(win, o);
    }, NOT_OPENED_MS);
    return p;
  }
  function print(o) {
    o = o || {};
    try { return run(o); }
    catch (e) {
      /* never block an export: a page this cannot prepare still prints as it is */
      var win = o.win || W;
      try { win.focus(); win.print(); } catch (x) {}
      return Promise.resolve({ fallback: true });
    }
  }

  /* a panel on screen (an area or tab summary) printed on its own: a copy without its buttons and form fields, with the panel's
     own heading as the first line */
  function panel(el, o) {
    o = o || {};
    var s = D.getElementById("pdfx-sheet"); if (!s) { s = D.createElement("div"); s.id = "pdfx-sheet"; D.body.appendChild(s); }
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll("button,input,select,textarea,[data-pdf-hide],.noprint"), function (x) { x.parentNode.removeChild(x); });
    Array.prototype.forEach.call(c.querySelectorAll("[id]"), function (x) { x.removeAttribute("id"); });
    s.innerHTML = "<h1>" + esc(o.title || "Report") + "</h1>"; s.appendChild(c);
    D.documentElement.classList.add("pdfx-sheet");
    return print({ title: o.title, root: s, ai: o.ai }).then(function (r) { D.documentElement.classList.remove("pdfx-sheet"); s.innerHTML = ""; return r; });
  }

  W.OSAP_PDF = { print: print, panel: panel, linkify: linkify, fileName: fileName, _pageCss: pageCss, _marginBoxes: marginBoxes };
})();
