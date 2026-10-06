/* AXIOM OSAP: interface language (Shane 2026-09-30: "i need a user interface language option in settings").
   Built 2026-09-30 and shown in the review preview, but it never reached main; restored 2026-10-06 (Shane: "I don't see
   the multi language ui").
   - Settings (the gear) gets a Language menu. The choice is saved on this device only; the default is English.
   - Only the app's own words change: buttons, menus, headings, labels, tooltips. Reports, headlines, place names in
     records, sources and AI drafts stay exactly as published, so nothing an analyst reads as a record is altered.
   - The words come from bundled tables (assets/i18n/<code>.js), one per language, loaded only when that language is
     picked. No translation service is called and nothing leaves the device. A word with no entry stays in English.
   - Country names in the country picker come from the browser's own region names (Intl.DisplayNames), not from AI.
   - Tables drafted by AI carry the small "AI generated" tag in the Language menu (full wording in its tooltip).
   How: every text node and title/aria-label/placeholder/label attribute outside the report areas is looked up as a whole
   (exact English text, spaces trimmed) and swapped; the English is remembered so switching back, or the app changing
   the text later, works. A MutationObserver keeps up with panels the app draws later. English does no work at all. */
(function () {
  "use strict";
  var W = window, D = document;
  var KEY = "osap-lang";
  /* code, name in its own script, name in English, AI-drafted table? */
  var LANGS = [
    ["en", "English", "English", false],
    ["th", "ไทย", "Thai", true],
    ["vi", "Tiếng Việt", "Vietnamese", true],
    ["fil", "Filipino", "Filipino", true],
    ["id", "Bahasa Indonesia", "Indonesian", true],
    ["ms", "Bahasa Melayu", "Malay", true],
    ["zh", "简体中文", "Chinese (Simplified)", true],
    ["ja", "日本語", "Japanese", true],
    ["ko", "한국어", "Korean", true]
  ];
  function info(c) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === c) return LANGS[i]; return null; }
  var DATA = W.OSAP_I18N_DATA = W.OSAP_I18N_DATA || {};
  var lang = "en";
  try { var sv = localStorage.getItem(KEY); if (sv && info(sv)) lang = sv; } catch (e) {}

  /* report areas and anything the app reads back as data: never touched */
  var SKIP = "#rv-list,.rvlist,#rv-pkg,.pkgdl,.leaflet-popup-pane,.leaflet-tooltip-pane,.leaflet-marker-pane,.leaflet-overlay-pane," +
    "#brief,#credits,.bpage,.rep,.asai,script,style,textarea,input,[contenteditable],[data-noi18n],#osap-lang";
  var ATTRS = ["title", "aria-label", "placeholder", "label"];
  var dict = null, tpl = [], regionNames = null;
  var TXT = new WeakMap(), ATT = new WeakMap();

  function build(code) {
    dict = null; tpl = []; regionNames = null;
    if (code === "en") return;
    var t = DATA[code]; if (!t) return;
    dict = t;
    Object.keys(t).forEach(function (k) {
      if (k.indexOf("{0}") < 0) return;
      var p = k.split("{0}").map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
      tpl.push([new RegExp("^" + p[0] + "(.+?)" + p[1] + "$"), t[k]]);
    });
    try { regionNames = new Intl.DisplayNames([code === "zh" ? "zh-Hans" : code], { type: "region" }); } catch (e) {}
  }
  /* one whole string: exact entry, else a {0} pattern whose filler is itself an entry */
  function tr(s) {
    if (!dict || !s) return null;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), core = m[2].replace(/\s+/g, " ");
    if (!core || !/[A-Za-z]/.test(core)) return null;
    var hit = dict[core];
    if (hit == null) for (var i = 0; i < tpl.length; i++) {
      var r = tpl[i][0].exec(core);
      if (r) { var f = dict[r[1]]; if (f != null) { hit = tpl[i][1].replace("{0}", f); break; } }
    }
    return hit == null ? null : m[1] + hit + m[3];
  }
  function skipped(el) { return !el || el.nodeType !== 1 || !!(el.closest && el.closest(SKIP)); }

  function doText(n) {
    var rec = TXT.get(n), cur = n.nodeValue;
    if (rec && cur === rec.out) cur = rec.src; /* still our own words: work from the English */
    var out = tr(cur);
    if (out == null) { if (rec) TXT.delete(n); if (rec && n.nodeValue !== cur) n.nodeValue = cur; return; }
    TXT.set(n, { src: cur, out: out });
    if (n.nodeValue !== out) n.nodeValue = out;
  }
  function doAttrs(el) {
    var recs = ATT.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i]; if (!el.hasAttribute(a)) continue;
      if (a === "label" && el.tagName !== "OPTGROUP" && el.tagName !== "OPTION") continue;
      var cur = el.getAttribute(a), rec = recs && recs[a];
      if (rec && cur === rec.out) cur = rec.src;
      var out = tr(cur);
      if (out == null) { if (rec) { delete recs[a]; if (el.getAttribute(a) !== cur) el.setAttribute(a, cur); } continue; }
      if (!recs) { recs = {}; ATT.set(el, recs); }
      recs[a] = { src: cur, out: out };
      if (el.getAttribute(a) !== out) el.setAttribute(a, out);
    }
  }
  /* country picker: the browser's own region names; the activity dot and the value stay */
  function doCountry(o) {
    var v = o.value, rec = TXT.get(o), cur = o.textContent;
    if (rec && cur === rec.out) cur = rec.src;
    var name = null;
    if (regionNames && /^[a-z]{2}$/.test(v)) { try { name = regionNames.of(v.toUpperCase()); } catch (e) {} }
    var m = /^(\S+\s)?(.*)$/u.exec(cur), pre = m[1] && !/[A-Za-z]/.test(m[1]) ? m[1] : "";
    var out = name && name.toUpperCase() !== v.toUpperCase() ? pre + name : null;
    if (out == null) out = tr(cur);
    if (out == null) { if (rec) { TXT.delete(o); o.textContent = cur; } return; }
    TXT.set(o, { src: cur, out: out }); if (o.textContent !== out) o.textContent = out;
  }
  function isCountryOpt(el) { return el && el.tagName === "OPTION" && !!el.closest("#ph-country"); }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      var p = root.parentNode;
      if (isCountryOpt(p)) doCountry(p); else if (!skipped(p)) doText(root);
      return;
    }
    if (root.nodeType !== 1 || skipped(root)) return;
    var tw = D.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    }), n = root;
    do {
      if (n.nodeType === 3) { if (!isCountryOpt(n.parentNode)) doText(n); }
      else { doAttrs(n); if (isCountryOpt(n)) doCountry(n); }
    } while ((n = tw.nextNode()));
  }

  var obs = null, pend = [], sched = false;
  function flush() {
    sched = false; var list = pend; pend = [];
    if (obs) obs.disconnect();
    list.forEach(walk);
    if (obs) obs.observe(D.body, OBS);
  }
  var OBS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS };
  function watch(on) {
    if (on && !obs && W.MutationObserver) {
      obs = new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var m = ms[i];
          if (m.type === "childList") { for (var j = 0; j < m.addedNodes.length; j++) pend.push(m.addedNodes[j]); }
          else if (m.type === "characterData") pend.push(m.target);
          else if (!skipped(m.target)) doAttrs(m.target);
        }
        if (pend.length && !sched) { sched = true; (W.queueMicrotask || setTimeout)(flush); }
      });
      obs.observe(D.body, OBS);
    } else if (!on && obs) { obs.disconnect(); obs = null; }
  }
  function applyAll() {
    if (obs) obs.disconnect();
    walk(D.body);
    if (obs) obs.observe(D.body, OBS);
    D.documentElement.setAttribute("data-ui-lang", lang);
    syncPicker();
  }

  function load(code, cb) {
    if (code === "en" || DATA[code]) { cb(); return; }
    var s = D.createElement("script"); s.src = "assets/i18n/" + code + ".js"; s.async = true;
    s.onload = cb; s.onerror = function () { cb(); };
    D.head.appendChild(s);
  }
  function set(code) {
    if (!info(code)) code = "en";
    lang = code;
    try { if (code === "en") localStorage.removeItem(KEY); else localStorage.setItem(KEY, code); } catch (e) {}
    load(code, function () {
      if (lang !== code) return;
      if (code !== "en" && !DATA[code]) { lang = "en"; }
      build(lang);
      watch(lang !== "en");
      applyAll();
      if (lang === "en") { TXT = new WeakMap(); ATT = new WeakMap(); }
    });
  }

  /* ---------- the Language menu in Settings ---------- */
  var box = null;
  function picker() {
    if (box) return box;
    box = D.createElement("div"); box.id = "osap-lang"; box.className = "tplang";
    var h = D.createElement("div"); h.className = "tplbl"; h.id = "osap-lang-h"; h.textContent = "Language";
    var sel = D.createElement("select"); sel.id = "osap-lang-sel"; sel.setAttribute("aria-labelledby", "osap-lang-h");
    LANGS.forEach(function (L) {
      var o = D.createElement("option"); o.value = L[0]; o.lang = L[0];
      o.textContent = L[1] + (L[1] !== L[2] ? " · " + L[2] : "") + (L[3] ? " · AI generated" : "");
      sel.appendChild(o);
    });
    var note = D.createElement("p"); note.className = "tplnote";
    note.innerHTML = '<span class="aitag" tabindex="0" title="Draft, AI-generated translation of the app\'s buttons and menus, not checked by a native speaker. Words with no translation stay in English.">AI generated</span> Menus and buttons only. Reports stay in their original language.';
    sel.addEventListener("change", function () { set(sel.value); });
    box.appendChild(h); box.appendChild(sel); box.appendChild(note);
    syncPicker();
    return box;
  }
  function syncPicker() {
    if (!box) return;
    var sel = box.querySelector("select"), L = info(lang);
    if (sel.value !== lang) sel.value = lang;
    /* the heading is shown in both, so someone lost in a language they cannot read still finds it */
    var local = dict && dict.Language;
    box.firstChild.textContent = local && local !== "Language" ? local + " · Language" : "Language";
    box.lastChild.hidden = !(L && L[3]);
  }
  /* the gear's Settings panel (assets/osap-tidy.js) is drawn fresh each time it opens: put Language in it, above Credits */
  function mount() {
    var pop = D.getElementById("tidy-pop"); if (!pop) return false;
    var put = function () {
      var set = pop.querySelector(".tpset"); if (!set) return;
      var p = picker(); if (p.parentNode === set) return;
      set.insertBefore(p, set.querySelector('[data-tp="#credits-btn"]'));
      syncPicker();
    };
    put();
    if (W.MutationObserver) new MutationObserver(put).observe(pop, { childList: true });
    return true;
  }
  if (!mount()) D.addEventListener("DOMContentLoaded", mount);

  var st = D.createElement("style");
  st.textContent =
    "#tidy-pop .tplang{display:flex;flex-direction:column;gap:4px;margin:0 0 4px}" +
    "#tidy-pop .tplang select{margin:0 10px;font:inherit;font-size:14px;min-height:34px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);max-width:calc(100% - 20px)}" +
    "html.phone #tidy-pop .tplang select{font-size:16px}" +
    "#tidy-pop .tplnote{margin:0 10px;font-size:11px;line-height:1.35;color:var(--muted);max-width:240px}#tidy-pop .tplnote[hidden]{display:none}";
  D.head.appendChild(st);

  W.OSAP_I18N = {
    langs: function () { return LANGS.map(function (L) { return { code: L[0], name: L[1], english: L[2], ai: L[3] }; }); },
    lang: function () { return lang; },
    set: set,
    t: function (s) { var o = tr(s); return o == null ? s : o; },
    picker: picker
  };
  if (lang !== "en") set(lang);
})();
