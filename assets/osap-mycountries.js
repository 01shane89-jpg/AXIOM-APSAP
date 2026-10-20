/* AXIOM OSAP: first-run setup, My countries and "new since you last looked" (Shane 2026-10-19).
   - First-run setup: the first time OSAP opens on a device (no OSAP setting of any kind in localStorage yet) a short sheet
     asks for up to 5 countries (search as you type over the app's own country list) and how the person uses OSAP: Analyst,
     Team in country or Traveller. Skip or Done, it never shows again; Settings > "My countries and setup" opens it again.
     On the Netlify site it waits until the person is signed in (the sign-in screen reloads the page, and it shows then).
     Done opens Today on the first chosen country. A role only picks defaults that already exist in the app: Team in country
     offers "Use my location" (assets/osap-locate.js); Traveller shows the U.S. State Department advisory at the top of Today.
     An existing user (any saved OSAP setting) is never shown it: this file runs before any other script writes a setting.
   - My countries: up to 5 pinned countries, as one-tap chips on Today and in the map header (a row of its own that scrolls
     sideways on a phone), with a Pin button beside the country picker. Today also gets a "My countries" card: one row per
     pinned country with its newest headline (data/live/news/<cc>.js, read once per page load) and how many are new.
   - New since you last looked: when the person last viewed Today for each country is kept on this device. Today then says
     "N new since <time>" (headlines and official warnings timed after that) and marks those lines "New". The baseline moves
     on each time Today is left, so the count resets once they have looked.
   Kept in localStorage: "osap-setup" (pending, done or skipped), "osap-mycc" {pins, role}, "osap-mycc-seen" {cc: ms}.
   Automated browsers (navigator.webdriver) are not shown the first-run sheet, so the other headless checks open as before;
   tests/mycountries_smoke.mjs sets window.OSAP_SETUP_TEST to see it.
   window.OSAP_MYCC { pins, role, isPinned, togglePin, go, openSetup, headHtml, pinHtml, cardHtml, isNew, newCount, since } */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var K_SETUP = "osap-setup", K_MY = "osap-mycc", K_SEEN = "osap-mycc-seen", K_LOC = "osap-mycc-loc", MAX = 5;
  var PRIOR = /^(osap|asap|tsap|tfw|tw|tbw)[-.]/;
  function lsRaw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  var BOT = !!navigator.webdriver && !W.OSAP_SETUP_TEST;

  /* ---------- first run: decided now, before any other script saves a setting ---------- */
  if (!BOT && lsRaw(K_SETUP) == null) {
    var prior = false;
    try { for (var i = 0; i < localStorage.length; i++) if (PRIOR.test(localStorage.key(i) || "")) { prior = true; break; } } catch (e) { prior = true; }
    if (!prior) lsSet(K_SETUP, "pending");
  }

  /* ---------- saved choices ---------- */
  var ROLES = [
    ["analyst", "Analyst", "The full Today screen for each of your countries."],
    ["team", "Team in country", "Also offers Use my location, so OSAP starts on the country you are in."],
    ["traveller", "Traveller", "Today opens with the U.S. State Department travel advisory at the top."]
  ];
  function my() {
    var m = lsGet(K_MY) || {}, p = Array.isArray(m.pins) ? m.pins.filter(function (c) { return typeof c === "string" && /^[a-z]{2,3}$/.test(c); }) : [];
    return { pins: p.slice(0, MAX), role: ROLES.some(function (r) { return r[0] === m.role; }) ? m.role : "" };
  }
  function save(m) { lsSet(K_MY, { pins: m.pins.slice(0, MAX), role: m.role || "" }); }
  function cc() { return (W.TSAP && W.TSAP.country) || "th"; }
  function countries() {
    var out = [], seen = {};
    Array.prototype.forEach.call(D.querySelectorAll("#country-seg button[data-cc]"), function (b) {
      var id = b.getAttribute("data-cc"); if (seen[id]) return; seen[id] = 1;
      var c = b.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll(".n,.actdot"), function (n) { n.remove(); });
      out.push({ id: id, name: c.textContent.trim() || id.toUpperCase() });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  var NAMES = null;
  function nameOf(id) {
    if (!NAMES) { NAMES = {}; countries().forEach(function (c) { NAMES[c.id] = c.name; }); }
    return NAMES[id] || String(id).toUpperCase();
  }
  function T() { return W.OSAP_TIME || null; }
  function when(ms, date) { var t = T(); return t ? t.dualT(ms, { date: !!date }) : new Date(ms).toISOString().slice(11, 16).replace(":", "") + "Z"; }
  function ago(ms) {
    if (!isFinite(ms)) return ""; var m = Math.round((Date.now() - ms) / 6e4);
    return m < 0 ? "" : m < 2 ? "just now" : m < 60 ? m + " min ago" : m < 48 * 60 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  }

  /* ---------- open another country: the same reload the country picker uses ---------- */
  function go(to) {
    if (!to || to === cc()) return;
    var td = !!(W.OSAP_TODAY && W.OSAP_TODAY.isOpen()), h = (location.hash || "").replace("#", "").split("/");
    var view = td ? "timeline" : (h.length > 1 ? h[1] : h[0]) || "timeline";
    ssSet("osap-today", td ? "1" : "0");
    if (W.OSAP_BOOT) W.OSAP_BOOT.show(to, "", nameOf(to));
    var q = new URLSearchParams(location.search); q.delete("st");
    var s = String(q) ? "?" + q : "", hash = "#" + (to === "th" ? "" : to + "/") + view;
    if (s !== location.search) { location.href = location.pathname + s + hash; return; }
    location.hash = hash; location.reload();
  }
  function togglePin(id) {
    var m = my(), k = m.pins.indexOf(id);
    if (k >= 0) m.pins.splice(k, 1); else if (m.pins.length < MAX) m.pins.push(id); else return false;
    save(m); paint(); return true;
  }

  /* ---------- new since you last looked ---------- */
  var view = { cc: null, base: null };
  function seenAll() { var s = lsGet(K_SEEN); return s && typeof s === "object" ? s : {}; }
  function markSeen(id) { var s = seenAll(); s[id] = Date.now(); lsSet(K_SEEN, s); }
  /* the first draw of Today for a country takes the stored time as this look's baseline, and stores now */
  function enter(id) {
    if (view.cc === id) return;
    var s = seenAll(); view.cc = id; view.base = typeof s[id] === "number" && isFinite(s[id]) ? s[id] : null;
    markSeen(id);
  }
  function leave() { if (view.cc) { markSeen(view.cc); view.cc = null; } }
  function recMs(r) { var f = W.OSAP_TODAY && W.OSAP_TODAY.recMs; var ms = f ? f(r) : Date.parse(r.ts); return isFinite(ms) ? ms : NaN; }
  /* what Today shows: headlines, and official warnings and live hazards */
  function counted(r) { return r && (r.news || (r.live && !r.social && (r.sev || 0) >= 2)); }
  function newCount(base) {
    if (base == null) return null;
    var now = Date.now() + 36e5;
    return ((W.TSAP && W.TSAP.records) || []).filter(function (r) { if (!counted(r)) return false; var ms = recMs(r); return ms > base && ms <= now; }).length;
  }
  /* the same window as newCount(): a story dated over an hour ahead (a feed's wrong time zone) is never New, or it would stay New */
  function isNew(id, ms) { return view.cc === id && view.base != null && isFinite(ms) && ms > view.base && ms <= Date.now() + 36e5; }

  /* ---------- headlines for the My countries card ---------- */
  var news = {}, newsBusy = {};
  function newsOf(id) {
    if (id === cc() && W.ASAP_NEWS && W.ASAP_NEWS.items) return W.ASAP_NEWS.items[id] || [];
    if (news[id]) return news[id];
    if (!newsBusy[id] && W.fetch && /^[a-z]{2,3}$/.test(id)) {
      newsBusy[id] = 1;
      fetch("data/live/news/" + id + ".js").then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) {
        var j = JSON.parse(t.replace(/^\s*window\.ASAP_NEWS\s*=\s*/, "").replace(/;\s*$/, ""));
        news[id] = (j && j.items && j.items[id]) || [];
      }).catch(function () { news[id] = []; news[id].failed = 1; }).then(function () { if (W.OSAP_TODAY && W.OSAP_TODAY.refresh) W.OSAP_TODAY.refresh(); });
    }
    return null;
  }
  function itemMs(i) { var d = String(i.date || ""); return /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(d) ? Date.parse(d.slice(0, 16) + ":00Z") : NaN; }
  function summary(id) {
    var L = newsOf(id); if (!L) return null;
    var s = seenAll(), base = id === view.cc ? view.base : typeof s[id] === "number" ? s[id] : null, top = null, n = 0, now = Date.now() + 36e5;
    L.forEach(function (i) {
      if (!i || i.left_out || !(i.title_en || i.title)) return;
      var ms = itemMs(i); if (!isFinite(ms) || ms > now) return;
      if (!top || ms > top.ms) top = { ms: ms, t: i.title_en || i.title, u: safeUrl(i.link), o: i.outlet || "" };
      if (base != null && ms > base) n++;
    });
    return { top: top, n: base == null ? null : n, failed: !!L.failed };
  }

  /* ---------- Today: pin button, chips, the new-since line, the advisory for travellers, the card ---------- */
  function chips(cur, cls) {
    var P = my().pins; if (!P.length) return "";
    return '<div class="mcchips ' + (cls || "") + '" role="group" aria-label="My countries">' + P.map(function (id) {
      return '<button type="button" class="mcchip" data-mycc="' + esc(id) + '"' + (id === cur ? ' aria-current="true"' : "") + ">" + esc(nameOf(id)) + "</button>";
    }).join("") + "</div>";
  }
  function pinHtml(id) {
    var m = my(), on = m.pins.indexOf(id) >= 0, full = !on && m.pins.length >= MAX;
    return '<button type="button" class="mcpin" data-mypin="' + esc(id) + '" aria-pressed="' + on + '"' + (full ? " disabled" : "") +
      ' title="' + (on ? "Unpin " + esc(nameOf(id)) + " from My countries" : full ? "Up to 5 countries can be pinned: unpin one first" : "Pin " + esc(nameOf(id)) + " to My countries") + '">' +
      (on ? "★ Pinned" : "☆ Pin") + "</button>";
  }
  function headHtml(id) {
    if (D.documentElement.classList.contains("td-on")) enter(id);
    var h = chips(id, "mctoday"), n = newCount(view.base);
    if (n != null) h += '<p class="mcnew" role="status">' + (n ? "<b>" + n + " new</b>" : "Nothing new") + " since " + esc(when(view.base, Date.now() - view.base > 20 * 36e5)) +
      (n ? ' <span class="mcsub">headlines and warnings, marked New below</span>' : "") + "</p>";
    var a = my().role === "traveller" && W.ASAP_ADV && W.ASAP_ADV.items ? W.ASAP_ADV.items[id] : null;
    if (a && a.level) {
      var link = safeUrl(a.link) || "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html";
      h += '<a class="tdadv tdl' + esc(a.level) + ' mcadv" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer"><span class="tdlvl">Level ' + esc(a.level) + "</span><span><b>" + esc(a.level_text || "") +
        '</b><span class="tdsub">U.S. State Department travel advisory, a government statement' + (a.date ? ", issued " + esc(a.date) : "") + "</span></span></a>";
    }
    return h ? '<div class="mchead">' + h + "</div>" : "";
  }
  function cardHtml(id) {
    var P = my().pins; if (!P.length) return "";
    var h = '<section class="tdcard mccard" aria-label="My countries"><div class="tdh"><h2>My countries</h2><span class="tdcount">newest headline in each</span></div>';
    P.forEach(function (c) {
      var S = summary(c), here = c === id;
      h += '<div class="mcrow"><button type="button" class="mcrowh" data-mycc="' + esc(c) + '"' + (here ? ' aria-current="true"' : "") + "><b>" + esc(nameOf(c)) + "</b>" +
        (S && S.n ? ' <span class="tdtag mcnewtag">' + S.n + " new</span>" : "") + (here ? ' <span class="mcsub">open now</span>' : "") + "</button>" +
        (!S ? '<span class="mcsub">Loading headlines…</span>'
          : S.top ? (S.top.u ? '<a class="mchl" href="' + esc(S.top.u) + '" target="_blank" rel="noopener noreferrer">' + esc(S.top.t) + "</a>" : '<span class="mchl">' + esc(S.top.t) + "</span>") +
            '<span class="mcsub">' + esc(S.top.o) + " · " + esc(ago(S.top.ms) || when(S.top.ms, true)) + (S.n == null ? " · not opened on this device yet" : "") + "</span>"
          : '<span class="mcsub">' + (S.failed ? "Headlines could not be read just now." : "No headlines held for this country yet.") + "</span>") + "</div>";
    });
    return h + '<p class="tdsrc">Pin or unpin with the star beside the country picker. Up to 5.</p></section>';
  }
  function newTag(id, ms) { return isNew(id, ms) ? '<span class="tdtag mcnewtag">New</span>' : ""; }

  /* ---------- the map header: Pin and the chips, beside the country picker ---------- */
  var bar = null;
  function paint() {
    if (bar) {
      var id = cc(), P = my().pins;
      bar.innerHTML = pinHtml(id) + chips(id, "mcmap");
      bar.classList.toggle("mcempty", !P.length);
    }
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen() && W.OSAP_TODAY.refresh) W.OSAP_TODAY.refresh();
  }

  /* ---------- the setup sheet ---------- */
  var sheet = null, draft = null;
  function openSetup(first) {
    if (!sheet) {
      sheet = D.createElement("div"); sheet.id = "mycc-setup"; sheet.hidden = true;
      sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "mcs-h");
      D.body.appendChild(sheet);
      sheet.addEventListener("click", onSheet);
      sheet.addEventListener("input", function (e) { if (e.target.id === "mcs-q") drawRes(); });
      sheet.addEventListener("change", function (e) { if (e.target.id === "mcs-loc") draft.loc = e.target.checked; });
      sheet.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); finish("skip"); }
        else if (e.key === "Enter" && e.target.id === "mcs-q") { e.preventDefault(); var b = sheet.querySelector(".mcres button:not([disabled])"); if (b) b.click(); }
      });
    }
    var m = my();
    draft = { pins: m.pins.slice(), role: m.role || "analyst", loc: false, first: !!first };
    sheet.innerHTML = '<div class="mcsbox"><img src="assets/logo.png" alt="" width="40" height="40" class="mcslogo">' +
      '<h2 id="mcs-h">' + (first ? "Welcome to OSAP" : "My countries and setup") + "</h2>" +
      '<p class="mcsub">' + (first ? "Two quick choices so OSAP opens on what you follow. " : "") + "Kept on this device only. You can change them any time in Settings.</p>" +
      '<h3>Your countries <span class="mcsub">up to 5</span></h3><div class="mcsel" aria-live="polite"></div>' +
      '<input type="search" id="mcs-q" placeholder="Search countries" autocomplete="off" spellcheck="false" aria-label="Search countries" aria-controls="mcs-res">' +
      '<div class="mcres" id="mcs-res" role="group" aria-label="Matching countries"></div>' +
      '<h3>How you use OSAP</h3><div class="mcroles" role="radiogroup" aria-label="How you use OSAP"></div>' +
      '<label class="mcloc" hidden><input type="checkbox" id="mcs-loc"> Use my location<span class="mcsub">The browser asks first. Your position stays on this device.</span></label>' +
      '<div class="mcbtns"><button type="button" data-mcs="skip">' + (first ? "Skip" : "Cancel") + '</button><button type="button" data-mcs="done" class="mcprimary">Done</button></div></div>';
    drawSel(); drawRes(); drawRoles();
    sheet.hidden = false; D.documentElement.classList.add("mcs-on");
    var q = sheet.querySelector("#mcs-q"); try { q.focus({ preventScroll: true }); } catch (e) {}
  }
  function drawSel() {
    sheet.querySelector(".mcsel").innerHTML = draft.pins.length ? draft.pins.map(function (id, i) {
      return '<button type="button" class="mcchip" data-mcrm="' + esc(id) + '" aria-label="Remove ' + esc(nameOf(id)) + '">' + (i === 0 ? "<b>" + esc(nameOf(id)) + "</b>" : esc(nameOf(id))) + ' <span aria-hidden="true">×</span></button>';
    }).join("") + (draft.pins.length > 1 ? '<span class="mcsub">OSAP opens on the first one.</span>' : "") : '<span class="mcsub">None chosen yet. Type a name below.</span>';
  }
  function drawRes() {
    var q = (sheet.querySelector("#mcs-q").value || "").trim().toLowerCase(), full = draft.pins.length >= MAX, C = countries();
    var hit = q ? C.filter(function (c) { return c.name.toLowerCase().indexOf(q) >= 0 || c.id === q; }) : [];
    hit.sort(function (a, b) { return (a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) || a.name.localeCompare(b.name); });
    sheet.querySelector(".mcres").innerHTML = !q ? "" : !hit.length ? '<span class="mcsub">No country matches "' + esc(q) + '".</span>' :
      (full ? '<span class="mcsub">5 chosen: remove one to add another.</span>' : "") + hit.slice(0, 8).map(function (c) {
        var on = draft.pins.indexOf(c.id) >= 0;
        return '<button type="button" data-mcadd="' + esc(c.id) + '"' + (on || full ? " disabled" : "") + ">" + esc(c.name) + (on ? " ✓" : "") + "</button>";
      }).join("");
  }
  function drawRoles() {
    sheet.querySelector(".mcroles").innerHTML = ROLES.map(function (r) {
      return '<button type="button" role="radio" data-mcrole="' + r[0] + '" aria-checked="' + (draft.role === r[0]) + '"><b>' + esc(r[1]) + '</b><span class="mcsub">' + esc(r[2]) + "</span></button>";
    }).join("");
    var l = sheet.querySelector(".mcloc"), team = draft.role === "team" && !!W.OSAP_LOC && !W.OSAP_LOC.on();
    l.hidden = !team; if (team && draft.loc == null) draft.loc = true;
    sheet.querySelector("#mcs-loc").checked = !!draft.loc;
  }
  function onSheet(e) {
    var b = e.target.closest ? e.target.closest("button") : null; if (!b) return;
    var v;
    if ((v = b.getAttribute("data-mcadd"))) { if (draft.pins.indexOf(v) < 0 && draft.pins.length < MAX) draft.pins.push(v); var q = sheet.querySelector("#mcs-q"); q.value = ""; drawSel(); drawRes(); q.focus(); }
    else if ((v = b.getAttribute("data-mcrm"))) { draft.pins = draft.pins.filter(function (x) { return x !== v; }); drawSel(); drawRes(); }
    else if ((v = b.getAttribute("data-mcrole"))) { if (v === "team" && draft.role !== "team") draft.loc = null; draft.role = v; drawRoles(); }
    else if ((v = b.getAttribute("data-mcs"))) finish(v);
  }
  function close() { if (sheet) sheet.hidden = true; D.documentElement.classList.remove("mcs-on"); }
  function finish(how) {
    var first = draft && draft.first;
    if (how !== "done") { if (first) lsSet(K_SETUP, "skipped"); close(); return; }
    lsSet(K_SETUP, "done");
    save({ pins: draft.pins, role: draft.role });
    var loc = draft.role === "team" && draft.loc && W.OSAP_LOC && !W.OSAP_LOC.on();
    close(); paint();
    var to = draft.pins[0];
    if (to && to !== cc()) {
      if (loc) ssSet(K_LOC, "1");
      ssSet("osap-today", "1"); lsSet("osap-last-cc", JSON.stringify(to));
      if (W.OSAP_BOOT) W.OSAP_BOOT.show(to, "", nameOf(to));
      location.hash = (to === "th" ? "" : to + "/") + "timeline"; location.reload(); return;
    }
    if (loc) W.OSAP_LOC.use();
    if (W.OSAP_TODAY && !W.OSAP_TODAY.isOpen()) W.OSAP_TODAY.show();
  }

  var CSS = "#mycc-setup{position:fixed;inset:0;z-index:6000;background:rgba(10,20,30,.55);display:flex;align-items:flex-start;justify-content:center;overflow:auto;-webkit-overflow-scrolling:touch;padding:max(16px,env(safe-area-inset-top)) 16px 16px;box-sizing:border-box}" +
    "#mycc-setup[hidden]{display:none}html.mcs-on body{overflow:hidden}" +
    ".mcsbox{background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#ccd);border-radius:12px;padding:16px;width:100%;max-width:480px;box-sizing:border-box;margin:auto 0;font-size:14px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.25)}" +
    ".mcslogo{border-radius:50%;float:right;margin-left:8px}.mcsbox h2{margin:0 0 4px;font-size:20px}.mcsbox h3{margin:14px 0 6px;font-size:15px}" +
    ".mcsub{font-size:12px;color:var(--muted,#667);font-weight:400}.mcsbox .mcsub{display:block}.mcsbox h3 .mcsub{display:inline}" +
    ".mcsel{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}" +
    "#mcs-q{width:100%;box-sizing:border-box;min-height:44px;font:inherit;font-size:16px;padding:6px 10px;border:1px solid var(--line,#ccd);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#111)}" +
    ".mcres{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.mcres button,.mcroles button,.mcbtns button,.mcchip,.mcpin{font:inherit;cursor:pointer;border:1px solid var(--line,#ccd);background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;min-height:40px;padding:6px 12px}" +
    ".mcres button[disabled],.mcpin[disabled]{opacity:.5;cursor:default}" +
    ".mcroles{display:flex;flex-direction:column;gap:6px}.mcroles button{text-align:left;display:flex;flex-direction:column;padding:8px 12px}" +
    ".mcroles button[aria-checked=true]{border-color:var(--accent,#1a73e8);box-shadow:inset 0 0 0 1px var(--accent,#1a73e8)}" +
    ".mcloc{display:block;margin-top:8px;padding:8px 10px;border:1px solid var(--line,#ccd);border-radius:8px;min-height:40px;box-sizing:border-box}.mcloc[hidden]{display:none}.mcloc input{width:20px;height:20px;vertical-align:-4px;margin-right:6px}" +
    ".mcbtns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.mcbtns button{min-width:96px;min-height:44px}" +
    ".mcprimary{background:var(--accent,#1a73e8)!important;border-color:var(--accent,#1a73e8)!important;color:var(--on-accent,#fff)!important;font-weight:600}" +
    ".mcchip{white-space:nowrap;flex:none;padding:4px 12px;font-size:14px;border-radius:20px}.mcchip[aria-current=true]{background:var(--ink,#111);color:var(--surface,#fff);border-color:var(--ink,#111)}" +
    ".mcpin{flex:none;white-space:nowrap;padding:4px 10px;font-size:13px}.mcpin[aria-pressed=true]{border-color:var(--accent,#1a73e8);color:var(--accent,#1a73e8)}" +
    /* the chips stay on one line and scroll sideways inside their own row, never the page */
    ".mcchips{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:thin;min-width:0;max-width:100%;padding-bottom:2px}" +
    ".mchead{display:flex;flex-direction:column;gap:6px;margin:-4px 0 12px;min-width:0}.mcnew{margin:0;font-size:13px}.mcnew .mcsub{display:inline}" +
    ".mcadv{margin-bottom:0}.mcnewtag{color:var(--accent,#1a73e8)!important;border-color:currentColor!important;background:none!important;font-weight:700!important}" +
    ".mcrow{display:flex;flex-direction:column;gap:2px;padding:6px 0;border-top:1px solid var(--line-soft,var(--line,#ccd));min-width:0}.mcrow:first-of-type{border-top:0}" +
    ".mcrowh{background:none;border:0;padding:4px 0;text-align:left;font:inherit;color:var(--ink,#111);cursor:pointer;min-height:40px}.mcrowh[aria-current=true]{cursor:default}" +
    ".mchl{font-size:13px;color:var(--ink,#111);overflow-wrap:anywhere}.mcrow .mcsub{display:block}" +
    "#mycc-hdr{order:9;display:flex;gap:6px;align-items:center;min-width:0;max-width:100%;box-sizing:border-box}#mycc-hdr .mcchips{flex:0 1 auto}" +
    "#mycc-hdr .mcchip,#mycc-hdr .mcpin{min-height:32px;padding:2px 10px;font-size:12.5px}" +
    "html.phone #mycc-hdr{order:10;flex:1 1 100%}html.phone #mycc-hdr.mcempty{display:none}html.phone #mycc-hdr .mcchip,html.phone #mycc-hdr .mcpin{min-height:40px}";

  /* ---------- start ---------- */
  function wireClicks() {
    D.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var b = t.closest("[data-mycc]"); if (b && !(sheet && sheet.contains(b))) { go(b.getAttribute("data-mycc")); return; }
      b = t.closest("[data-mypin]"); if (b && !b.disabled) togglePin(b.getAttribute("data-mypin"));
    });
  }
  function start() {
    var st = D.createElement("style"); st.textContent = CSS; D.head.appendChild(st);
    wireClicks();
    /* beside the country picker: the drop-down (#phone-nav, on every screen size once the header is tidied) or the region menus */
    var seg = D.getElementById("phone-nav") || D.getElementById("country-seg");
    if (seg && seg.parentNode) { bar = D.createElement("div"); bar.id = "mycc-hdr"; seg.parentNode.insertBefore(bar, seg.nextSibling); }
    paint();
    /* Today leaving: the look is over, so the next count starts from now */
    if (W.MutationObserver) new MutationObserver(function () { if (!D.documentElement.classList.contains("td-on")) leave(); })
      .observe(D.documentElement, { attributes: true, attributeFilter: ["class"] });
    /* the timeline in view when the app is put away counts as a look too */
    D.addEventListener("visibilitychange", function () {
      if (D.visibilityState !== "hidden") return;
      var v = D.querySelector('#view-seg button[aria-selected="true"]');
      if (view.cc || (v && v.getAttribute("data-view") === "timeline")) markSeen(cc());
    });
    /* Team in country chose Use my location, and the page reloaded onto their first country */
    if (ssGet(K_LOC) === "1") { ssSet(K_LOC, null); if (W.OSAP_LOC && !W.OSAP_LOC.on()) setTimeout(function () { W.OSAP_LOC.use(); }, 400); }
    if (BOT || lsRaw(K_SETUP) !== "pending") return;
    /* on the Netlify site, only once signed in: the sign-in screen reloads the page, and the sheet shows then */
    var TR = W.OSAP_TIER, ready = TR && TR.ready && TR.ready.then ? TR.ready : Promise.resolve();
    ready.then(function () {
      setTimeout(function () {
        if (lsRaw(K_SETUP) !== "pending") return;
        if (TR && TR.on && TR.on() && (!lsRaw("osap-auth") || D.querySelector("#tierdlg.trwall:not([hidden])"))) return;
        openSetup(true);
      }, 400);
    }, function () {});
  }

  W.OSAP_MYCC = {
    pins: function () { return my().pins; }, role: function () { return my().role; },
    isPinned: function (id) { return my().pins.indexOf(id) >= 0; }, togglePin: togglePin, go: go,
    openSetup: function () { openSetup(false); }, isSetupOpen: function () { return !!sheet && !sheet.hidden; },
    headHtml: headHtml, pinHtml: pinHtml, cardHtml: cardHtml, newTag: newTag, isNew: isNew,
    newCount: function () { return newCount(view.base); }, since: function () { return view.base; }
  };
  (function wait(n) { if (W.TSAP && W.TSAP.records && W.OSAP_TODAY && D.body) start(); else if (n < 400) setTimeout(function () { wait(n + 1); }, 50); else if (W.TSAP && D.body) start(); })(0);
})();
