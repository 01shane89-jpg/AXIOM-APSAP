/* AXIOM OSAP: Ask about this country, on Today under the daily summary (Shane 2026-11-18 chose Claude Haiku 5.5 behind his key).
   Self-contained block loaded before assets/osap-today.js, which mounts it (window.OSAP_ASKQ.mount).
   - The question goes to OSAP's own server (netlify/functions/osap-ask.mjs) with the country code, nothing else. The server
     answers only from that country's daily summary sources, every sentence cited, and saves nothing (tools/ask_lib.mjs).
   - The answer is a draft: it carries the small "AI generated" tag, its sources are listed with their links, and it never
     changes a record, a finding or the summary. Sources are outlets' and governments' claims, shown as such.
   - Hidden until the server says answers are switched on; the owner sees one line saying it is off until the key is added.
     Netlify site only: on GitHub Pages (no server) the card stays hidden. */
(function () {
  "use strict";
  var D = document, W = window, API = "api/osap-ask", el = null, CC = "", NAME = "", st = { on: null, busy: false, res: null, err: "", q: "" };
  var CSS = ".askrow{display:flex;gap:6px;flex-wrap:wrap}.askrow input{flex:1 1 220px;min-width:0;min-height:36px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg,inherit);font:inherit}" +
    ".askrow button{min-height:36px;padding:4px 14px;font-weight:600}.askans{margin:10px 0 0;padding:0;list-style:none}.askans li{margin:0 0 6px;line-height:1.45}" +
    ".askans sup a{font-size:11px;text-decoration:none;margin-left:2px}.asksrc{margin:8px 0 0;padding-left:18px;font-size:12.5px}.asksrc li{margin:2px 0}" +
    ".askfoot{margin-top:8px;font-size:12px;color:var(--muted)}.askerr{color:var(--warn,#9a4b00)}";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function T() { return W.OSAP_TIER; }
  function call(body) {
    var t = T(), tok = t && t.token ? t.token() : Promise.resolve(null);
    return tok.then(function (a) {
      var h = { "content-type": "application/json" }; if (a) h.authorization = "Bearer " + a;
      return fetch(API, body ? { method: "POST", headers: h, body: JSON.stringify(body), cache: "no-store" } : { headers: h, cache: "no-store" });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function answerHtml(r) {
    var h = "";
    if (r.sentences && r.sentences.length) {
      h += '<ul class="askans">' + r.sentences.map(function (s) {
        /* the source check (tools/ground.mjs): a traced sentence says so, with which source holds each name and number it checked;
           a sentence naming someone or somewhere its sources don't is shown with that name, in the open */
        var g = s.g, m = (g && g.m) || [], tr = ((g && g.t) || []).map(function (x) { return x[0] + " [" + (x[1] || []).join("][") + "]"; }).join(" · ");
        return "<li>" + esc(s.text) + " <sup>" + s.refs.map(function (n) { return '<a href="#ask-src-' + n + '" aria-label="source ' + n + '">[' + n + "]</a>"; }).join("") + "</sup>" +
          (g ? ' <span class="tdobs" title="' + esc(tr ? "In its sources: " + tr : "Checked against the sources it cites") + '">' + (m.length ? "Partly traced" : "Traced") + "</span>" : "") +
          (m.length ? '<span class="tdobs" style="display:block;border-left:2px solid var(--l2,#C2792B);padding-left:6px">' + esc(m.map(function (y) { return (y[0] === "outlet" ? "Credits an outlet it doesn't cite: " : "Not in its sources: ") + y[1]; }).join("; ")) + "</span>" : "") + "</li>";
      }).join("") + "</ul>";
      if (r.ground && r.ground.dropped) h += '<p class="tdobs">' + r.ground.dropped + " sentence" + (r.ground.dropped === 1 ? " was" : "s were") + " removed: a number, casualty or date its sources don't give.</p>";
      h += '<ol class="asksrc">' + (r.sources || []).map(function (s) {
        var u = safeUrl(s.url);
        return '<li id="ask-src-' + s.n + '" value="' + s.n + '">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(s.headline) + "</a>" : esc(s.headline)) +
          ' <span class="tdobs">' + esc(s.outlet) + (s.time ? " · " + esc(s.time.replace("T", " ")) + "Z" : "") + " · " + esc(s.kind) + "</span></li>";
      }).join("") + "</ol>";
    }
    if (r.note) h += '<p class="tdobs">' + esc(r.note) + "</p>";
    return h;
  }
  function render() {
    if (!el) return;
    var t = T();
    if (st.on === false && !(t && t.owner && t.owner())) { el.hidden = true; return; }
    if (st.on === null) { el.hidden = true; return; }
    el.hidden = false;
    var h = '<div class="tdh"><h2>Ask about ' + esc(NAME) + '</h2><span class="aitag" tabindex="0" title="Draft, AI-generated from the cited sources, not analyst-approved">AI generated</span></div>';
    if (st.on === false) { el.innerHTML = h + '<p class="tdobs">Off until the Anthropic key is added in Netlify (ANTHROPIC_API_KEY). Only you see this line.</p>'; return; }
    if (t && t.allows && !t.allows("full")) { el.innerHTML = h + '<p class="tdobs">Ask is part of the Full plan.</p>'; return; }
    h += '<form class="askrow" data-askf><input type="text" maxlength="300" placeholder="e.g. What happened near the border today?" aria-label="Your question about ' + esc(NAME) + '" value="' + esc(st.q) + '">' +
      '<button type="submit"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Asking..." : "Ask") + "</button></form>";
    if (st.err) h += '<p class="tdobs askerr" role="alert">' + esc(st.err) + "</p>";
    if (st.res) h += '<div aria-live="polite">' + answerHtml(st.res) + "</div>";
    h += '<p class="askfoot">Answers come only from the sources in today\'s summary for ' + esc(NAME) + ", each sentence cited. Outlet and government statements are their claims. It's a draft, never a finding." +
      (st.res && st.res.left != null ? " " + st.res.left + " questions left today." : "") + "</p>";
    el.innerHTML = h;
  }
  function ask(q) {
    q = String(q || "").trim(); st.q = q;
    if (q.length < 3) { st.err = "Ask a question of 3 to 300 characters."; render(); return; }
    st.busy = true; st.err = ""; render();
    call({ cc: CC, q: q }).then(function (r) {
      st.busy = false;
      if (r._status !== 200) { st.err = r.error || "No answer this time. Try again later."; st.res = null; }
      else st.res = r;
      render();
    }).catch(function () { st.busy = false; st.err = "No connection to OSAP's server."; render(); });
  }
  function mount(box, cc, name) {
    el = box; CC = cc; NAME = name || cc; el.hidden = true;
    if (!D.getElementById("ask-css")) { var s = D.createElement("style"); s.id = "ask-css"; s.textContent = CSS; D.head.appendChild(s); }
    el.addEventListener("submit", function (e) {
      var f = e.target.closest && e.target.closest("form[data-askf]"); if (!f) return;
      e.preventDefault(); ask(f.querySelector("input").value);
    });
    var t = T();
    if (!t || !t.on || !t.on() || cc === "ww") return;   // no server (GitHub Pages), or World: no card
    call(null).then(function (r) { st.on = !!r.on; render(); }).catch(function () {});
  }
  W.OSAP_ASKQ = { mount: mount };
})();
