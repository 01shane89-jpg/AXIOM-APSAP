/* AXIOM OSAP: interface language (Shane 2026-10-06: "I don't see the multi language ui").
   - The browser's own Translate never shows in the iPhone home-screen app, and Safari only offers it for pages that are not
     in the phone's language, so OSAP carries its own picker: Settings (the gear) > Language.
   - Translation is done by Google's free website translator (no key, no account). Its script is loaded only once a language
     other than English is picked, and only then is the text on screen sent to Google. English loads nothing from Google.
   - The map is marked translate="no" (index.html), so map labels, markers and popups stay as drawn (English labels, #294).
     Anything else that must never be rewritten (codes, grid references) can carry class="notranslate" or translate="no".
   - The choice is kept on this device (localStorage "osap-lang") and applied again on the next start. With no signal the
     page stays in English and says so.
   window.OSAP_LANG { open(), close(), cur(), set(code), name(code), list() } */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-lang", SRC = "https://translate.google.com/translate_a/element.js?cb=osapLangReady";

  /* the languages offered first: the countries OSAP covers most, then widely used languages; Google's own codes */
  var LANGS = [["en", "English"], ["th", "ไทย Thai"], ["km", "ខ្មែរ Khmer"], ["lo", "ລາວ Lao"], ["my", "မြန်မာ Burmese"],
    ["vi", "Tiếng Việt Vietnamese"], ["id", "Bahasa Indonesia"], ["ms", "Bahasa Melayu"], ["tl", "Filipino"],
    ["zh-CN", "中文(简体) Chinese, Simplified"], ["zh-TW", "中文(繁體) Chinese, Traditional"], ["ja", "日本語 Japanese"],
    ["ko", "한국어 Korean"], ["mn", "Монгол Mongolian"], ["hi", "हिन्दी Hindi"], ["bn", "বাংলা Bengali"], ["ur", "اردو Urdu"],
    ["ne", "नेपाली Nepali"], ["si", "සිංහල Sinhala"], ["ta", "தமிழ் Tamil"], ["dv", "ދިވެހި Dhivehi"], ["ps", "پښتو Pashto"],
    ["fa", "فارسی Persian"], ["ar", "العربية Arabic"], ["he", "עברית Hebrew"], ["tr", "Türkçe Turkish"], ["ru", "Русский Russian"],
    ["uk", "Українська Ukrainian"], ["pl", "Polski Polish"], ["de", "Deutsch German"], ["fr", "Français French"],
    ["es", "Español Spanish"], ["pt", "Português Portuguese"], ["it", "Italiano Italian"], ["nl", "Nederlands Dutch"],
    ["sw", "Kiswahili Swahili"], ["am", "አማርኛ Amharic"], ["so", "Soomaali Somali"], ["ha", "Hausa"]];

  function get() { try { return W.localStorage.getItem(KEY) || "en"; } catch (e) { return "en"; } }
  function put(v) { try { if (v === "en") W.localStorage.removeItem(KEY); else W.localStorage.setItem(KEY, v); } catch (e) {} }
  function name(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return LANGS[i][1]; return code; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* Google's translator reads this cookie to know the language; it is set for this site only */
  function cookie(code) {
    var v = code === "en" ? "" : "/en/" + code, exp = code === "en" ? "; expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";
    D.cookie = "googtrans=" + v + "; path=/; SameSite=Lax" + exp;
  }

  /* hide Google's own bar and hover boxes; OSAP's Settings is the only control */
  var css = D.createElement("style");
  css.textContent = ".goog-te-banner-frame,.skiptranslate>iframe,#goog-gt-tt,.goog-te-balloon-frame,.goog-tooltip,#google_translate_element{display:none!important}" +
    "body{top:0!important;position:static}font.goog-text-highlight{background:none!important;box-shadow:none!important}" +
    ".olang{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px}" +
    ".olang[hidden]{display:none}.olang .olb{background:var(--surface,#fff);color:var(--ink,#111);border-radius:12px;max-width:420px;width:100%;" +
    "max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(0,0,0,.3)}" +
    ".olang h2{font-size:17px;margin:0;padding:14px 16px 6px}.olang p{margin:0 16px 8px;font-size:13px;opacity:.8}" +
    ".olang .oll{overflow:auto;padding:4px 8px 8px}.olang .oll button{display:block;width:100%;text-align:left;padding:10px 12px;min-height:44px;" +
    "border:0;border-radius:8px;background:none;color:inherit;font:inherit;cursor:pointer}.olang .oll button[aria-pressed=true]{background:var(--ink,#111);color:var(--surface,#fff)}" +
    ".olang .olf{display:flex;justify-content:flex-end;padding:8px 12px 12px}.olang .olf button{min-height:40px;padding:6px 16px}" +
    ".olang .olmsg{color:#b3261e}";
  D.head.appendChild(css);

  var state = "idle", combo = null, want = get();
  function host() {
    var h = D.getElementById("google_translate_element");
    if (!h) { h = D.createElement("div"); h.id = "google_translate_element"; h.setAttribute("aria-hidden", "true"); D.body.appendChild(h); }
    return h;
  }
  /* Google's hidden language box: picking a value there is how its translator switches language without a reload */
  function findCombo() { combo = D.querySelector("select.goog-te-combo"); return combo; }
  function apply(code) {
    if (!findCombo()) return false;
    if (combo.value !== code) { combo.value = code; combo.dispatchEvent(new Event("change")); }
    return true;
  }
  W.osapLangReady = function () {
    try {
      new W.google.translate.TranslateElement({ pageLanguage: "en", autoDisplay: false }, host());
      state = "ready";
      var tries = 0;
      (function wait() { if (apply(want) || ++tries > 40) return; setTimeout(wait, 250); })();
    } catch (e) { fail(); }
  };
  /* the translator could not be had: the page stays in English; a pick made from the picker brings the picker back to say so */
  function fail() { state = "failed"; if (box) { box.hidden = false; draw(); } }
  function load() {
    if (state === "loading" || state === "ready") return;
    if (W.navigator && W.navigator.onLine === false) { fail(); return; }
    state = "loading";
    var s = D.createElement("script"); s.src = SRC; s.async = true;
    s.onerror = function () { fail(); };
    D.head.appendChild(s);
    setTimeout(function () { if (state === "loading") { fail(); } }, 20000);
  }

  function set(code) {
    want = code || "en"; put(want); cookie(want);
    if (want === "en") {
      /* back to the page as written: Google keeps its rewritten text, so a fresh load is the clean way back */
      if (state === "ready" || D.documentElement.classList.contains("translated-ltr") || D.documentElement.classList.contains("translated-rtl")) location.reload();
      return;
    }
    if (state === "ready") apply(want); else load();
  }

  /* ---------- the picker ---------- */
  var box = null;
  function note() {
    if (!box || box.hidden) return;
    var m = box.querySelector(".olmsg");
    if (m) m.textContent = state === "failed" ? "The translator could not be reached (no signal or blocked). OSAP stays in English for now and tries again next time." : "";
  }
  function draw() {
    var cur = get();
    box.innerHTML = '<div class="olb notranslate" translate="no" role="dialog" aria-modal="true" aria-label="Language"><h2>Language</h2>' +
      "<p>Shows OSAP's menus, lists and reports in another language. Machine translation by Google: while a language other than English is on, the text on screen is sent to Google. The map stays in English.</p>" +
      '<p class="olmsg" role="status"></p><div class="oll">' + LANGS.map(function (l) {
        return '<button type="button" data-lang="' + esc(l[0]) + '" aria-pressed="' + (l[0] === cur) + '">' + esc(l[1]) + "</button>";
      }).join("") + '</div><div class="olf"><button type="button" data-lang-close>Close</button></div></div>';
    note();
  }
  function open() {
    if (!box) {
      box = D.createElement("div"); box.className = "olang"; box.hidden = true; D.body.appendChild(box);
      box.addEventListener("click", function (e) {
        if (e.target === box || (e.target.closest && e.target.closest("[data-lang-close]"))) { close(); return; }
        var b = e.target.closest && e.target.closest("[data-lang]"); if (!b) return;
        set(b.getAttribute("data-lang"));
        Array.prototype.forEach.call(box.querySelectorAll("[data-lang]"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        if (state !== "failed") close();
      });
      D.addEventListener("keydown", function (e) { if (e.key === "Escape" && box && !box.hidden) close(); });
    }
    draw(); box.hidden = false;
    var p = box.querySelector("[aria-pressed=true]"); if (p) p.scrollIntoView({ block: "center" });
  }
  function close() { if (box) box.hidden = true; }

  W.OSAP_LANG = { open: open, close: close, cur: get, set: set, name: name, list: function () { return LANGS.slice(); } };
  /* a language picked before: put it back on once the page has drawn */
  if (want !== "en") { cookie(want); if (D.readyState === "complete") load(); else W.addEventListener("load", load); }
})();
