/* AXIOM OSAP: Settings > Staying hidden online (Shane 2026-10-20, for users who must stay digitally secure: "Do all of it").
   Plain guidance on hiding who and where you are while using OSAP, and one check: where OSAP's own server sees this device
   connecting from (netlify/edge-functions/osap-seen-from.js, the address and place every website already sees). If that is
   where the person really is, their connection is not hidden. No outside "what is my IP" service is asked, and the answer
   is shown only here, never kept.
   The tips name what OSAP itself offers (Protected mode, Erase this device, location off) and what only the device can do
   (a VPN or Tor Browser, a separate browser, a screen lock). They make no promise: a VPN provider sees what the network did.
   window.OSAP_SAFETY {open, close, check} */
(function () {
  "use strict";
  var W = window, D = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var CSS = "#safedlg{position:fixed;inset:0;z-index:100000;background:rgba(10,14,20,.6);display:flex;align-items:center;justify-content:center;padding:16px}" +
    "#safedlg[hidden]{display:none}#safedlg .sp{background:#fff;color:#15202b;max-width:560px;width:100%;max-height:calc(100vh - 32px);overflow:auto;border-radius:10px;padding:16px 18px;box-shadow:0 10px 40px rgba(0,0,0,.35);font:14px/1.45 'IBM Plex Sans',system-ui,sans-serif;box-sizing:border-box}" +
    "#safedlg h2{margin:0 0 6px;font-size:18px}#safedlg h3{margin:14px 0 4px;font-size:14px}#safedlg p,#safedlg ol{margin:0 0 8px}#safedlg ol{padding-left:20px}#safedlg li{margin:0 0 4px}" +
    "#safedlg .sn{color:#5b6673;font-size:12.5px}#safedlg .sbox{border:1px solid #d5dbe3;border-radius:8px;padding:10px;margin:6px 0 4px}#safedlg .sbad{color:#c92a2a;font-weight:600}#safedlg .sok{color:#1f8a4c;font-weight:600}" +
    "#safedlg button{font:inherit;font-weight:600;border-radius:6px;padding:8px 14px;border:1px solid #c3ccd6;background:#f3f5f8;color:#15202b;cursor:pointer;min-height:40px}" +
    "#safedlg .sb{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}" +
    "@media (prefers-color-scheme:dark){#safedlg .sp{background:#1b2027;color:#e6ebf1}#safedlg .sn{color:#9aa6b3}#safedlg .sbox{border-color:#333c47}#safedlg button{background:#262d36;border-color:#3a4450;color:#e6ebf1}#safedlg .sbad{color:#ff8787}#safedlg .sok{color:#69db7c}}";
  var st = D.createElement("style"); st.textContent = CSS; D.head.appendChild(st);

  var box = null, R = { busy: false, got: null, err: "" };
  function protectOn() { return !!(W.OSAP_PROTECT && W.OSAP_PROTECT.on()); }
  function locOn() { return !!(W.OSAP_LOC && W.OSAP_LOC.on && W.OSAP_LOC.on()); }
  function checkHtml() {
    if (R.busy) return "<p>Asking OSAP's server…</p>";
    if (R.err) return '<p class="sn">' + esc(R.err) + "</p>";
    if (!R.got) return '<p class="sn">Shows the address and place that OSAP\'s server, and so every website and service this device talks to, sees for this connection.</p>';
    var g = R.got, where = [g.city, g.region, g.countryName || g.country].filter(Boolean).join(", ");
    return "<p>OSAP's server sees this device connecting from <b>" + esc(where || "an unknown place") + "</b>" + (g.ip ? ", address <b>" + esc(g.ip) + "</b>" : "") + ".</p>" +
      '<p class="sbad">If that is where you really are, your connection is not hidden.</p>' +
      '<p class="sok">If it shows another country (your VPN\'s or a Tor exit), your address and place are hidden from the sites you visit.</p>';
  }
  function render() {
    if (!box) return;
    box.querySelector(".sp").innerHTML = '<h2 id="safe-h">Staying hidden online</h2>' +
      '<p>OSAP shows what you look at to nobody but you, but the network still sees that this device uses OSAP, and every site you open sees your address. These steps reduce that.</p>' +
      '<h3>Check your connection</h3><div class="sbox" role="status">' + checkHtml() + '</div><div class="sb" style="margin-top:4px"><button type="button" data-safe="check">' + (R.got ? "Check again" : "Check now") + "</button></div>" +
      "<h3>On this device</h3><ol>" +
      "<li><b>Use a VPN or Tor Browser</b> before opening OSAP, every time. A trusted VPN hides your address from OSAP and from the services it uses; Tor Browser hides it from the VPN as well. Turn the VPN's kill switch on so nothing goes out if it drops. Check above that it worked.</li>" +
      "<li><b>Protected mode</b> (Settings): " + (protectOn() ? '<span class="sok">on</span>. ' : '<span class="sbad">off</span>. ') + "With it on, map, weather and search services never see this device, only OSAP's server does.</li>" +
      "<li><b>Use my location</b>: " + (locOn() ? '<span class="sbad">on</span>. Turn it off when you do not need it.' : '<span class="sok">off</span>.') + " OSAP never sends your position anywhere, but leaving it off means the browser never hands it out.</li>" +
      "<li><b>Erase this device</b> (Settings) wipes everything OSAP keeps here in one tap. Bookmark OSAP with <b>#panic</b> on the end of the address to reach it fast.</li>" +
      "<li><b>Use a browser kept for OSAP</b> (or a separate profile), not the one signed in to your own email or social accounts, and lock the device with a PIN and a short screen-lock time.</li>" +
      "<li><b>Do not use Sync my devices or Push to phone</b> where being linked to OSAP is a risk: both talk to outside services (Protected mode turns them off).</li>" +
      "<li><b>Sign in with an email that does not name you.</b> OSAP's server keeps your account email and when you last used OSAP.</li></ol>" +
      '<p class="sn">No setting makes anyone invisible: a VPN provider sees what its network carried, and a phone\'s carrier sees where the phone is. Use these steps alongside your organisation\'s own rules.</p>' +
      '<div class="sb"><button type="button" data-safe="close">Close</button></div>';
  }
  function check() {
    R.busy = true; R.err = ""; render();
    return fetch("/api/osap-seen-from", { cache: "no-store", credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(function (j) { R.got = j; }, function () {
      R.got = null; R.err = "OSAP's server did not answer (offline, or this copy of OSAP is not on its own site). Try again with a connection.";
    }).then(function () { R.busy = false; render(); return R.got; });
  }
  function build() {
    if (box) return box;
    box = D.createElement("div"); box.id = "safedlg"; box.hidden = true;
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "safe-h");
    box.innerHTML = '<div class="sp"></div>';
    D.body.appendChild(box);
    box.addEventListener("click", function (e) {
      if (e.target === box) return close();
      var b = e.target.closest && e.target.closest("[data-safe]"); if (!b) return;
      if (b.getAttribute("data-safe") === "close") close(); else if (!R.busy) check();
    });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && box && !box.hidden) close(); });
    return box;
  }
  function open() { build(); R.got = null; R.err = ""; render(); box.hidden = false; var c = box.querySelector('[data-safe="check"]'); if (c) c.focus(); }
  function close() { if (box) box.hidden = true; }
  W.OSAP_SAFETY = { open: open, close: close, check: check };
})();
