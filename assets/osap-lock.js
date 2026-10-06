/* AXIOM OSAP: hidden areas (Shane, 2026-10-04: "block the United States for all users but me", "lock it behind my face scan").
   The countries in HIDDEN are left out of the whole app (country picker, US states, Today, the news pool, cameras) unless this
   device has been unlocked with the owner's Face ID (or Touch ID / Windows Hello) in Settings > Hidden areas.
   How the lock works, with no server and no account:
   - Set up (once, on the owner's phone): a passkey is made for this site (platform authenticator, user verification required)
     with the WebAuthn PRF extension. PRF gives a secret that the authenticator only releases after Face ID. A new P-256 key
     pair is made in the browser; its private half is encrypted (AES-GCM, key from PRF via HKDF) and kept in this browser's
     storage only. The public half is shown as a "setup code" to send to Claude: it can only lock data for the owner, never open it.
   - Unlock: Face ID releases the PRF secret, which decrypts the private key. Only then does the app show the hidden areas. The
     unlock lasts STAY hours on this device, across reloads and app restarts (Shane 2026-10-04: "why do i keep having to enter my
     pass key??"), or until Lock now; it is kept in localStorage "osap-lock-open" with its end time.
   - OWNER lists the owners' public keys once they are in the code. From then on only a device holding one of those keys can
     unlock; a passkey made on anyone else's device opens nothing. The hidden countries' data files are being moved to
     encrypted-at-rest form (only the owner's private key can read them); until then this is an in-app lock and the plain files
     in the public repository are still readable on GitHub.
   Loaded first, before any script reads the address: a locked hidden country in the address is replaced by the default view. */
(function () {
  "use strict";
  var W = window, D = document;
  var HIDDEN = ["us"];
  /* the owners' public keys (setup codes, "osap-pub:v1:<base64url SPKI>"), added by hand after setup. Only a device holding the
     private half of one of these can unlock; another owner device (a PC with Windows Hello) is added by its own setup code. */
  var OWNER = [
    /* Shane's iPhone, 2026-10-05 */
    "osap-pub:v1:MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4szScDUlf52qw3rj8u8INzz6Atximq6IwbWPX3vogQtQpdoaj57inC2XVtzVhLyCm9vCEtyaj-tMLIPWfsPPgg"
  ];
  var K_DEV = "osap-lock-dev", K_OPEN = "osap-lock-open", STAY = 12;
  var PRF_SALT_TEXT = "AXIOM OSAP hidden areas v1";

  function sGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  function lGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function dev() { try { var d = JSON.parse(lGet(K_DEV) || "null"); return d && d.cred && d.wrapped && d.pub ? d : null; } catch (e) { return null; } }
  function code(d) { return "osap-pub:v1:" + d.pub; }
  function ownerOk(d) { return !OWNER.length || (!!d && OWNER.indexOf(code(d)) >= 0); }
  /* unlocked = this app session was opened with Face ID, on a device whose key is an owner key */
  /* the unlock on this device: {until, key}, or the session-only flag "1" (tests set that) */
  function held() {
    var r = null; try { r = JSON.parse(lGet(K_OPEN) || "null"); } catch (e) {}
    if (r && r.until > Date.now() && r.key) return r;
    if (r) lSet(K_OPEN, null);
    return sGet(K_OPEN) ? { key: sGet("osap-lock-key") } : null;
  }
  var OPEN = !!held() && ownerOk(dev());
  if (!OPEN) { lSet(K_OPEN, null); sSet(K_OPEN, null); sSet("osap-lock-key", null); }
  function hidden(cc) { return !OPEN && HIDDEN.indexOf(String(cc || "").toLowerCase()) >= 0; }

  /* ---------- the address: a locked hidden country (or one of its states) opens the default view instead ---------- */
  (function () {
    var h = (location.hash || "").replace("#", "").split("/");
    var q = new URLSearchParams(location.search), st = q.get("st"), ch = h.length > 1 && hidden(h[0]);
    if (!ch && !(st && HIDDEN.indexOf("us") >= 0 && hidden("us"))) return;
    q.delete("st");
    try { history.replaceState(null, "", location.pathname + (String(q) ? "?" + q : "") + (ch ? "" : location.hash)); } catch (e) {}
  })();

  /* ---------- base64url and crypto helpers ---------- */
  function b64u(buf) {
    var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(t) {
    var s = atob(String(t).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(t).length + 3) % 4)), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function rnd(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  var SUB = W.crypto && crypto.subtle;
  function prfSalt() { return SUB.digest("SHA-256", new TextEncoder().encode(PRF_SALT_TEXT)); }
  function wrapKey(prf) {
    return SUB.importKey("raw", prf, "HKDF", false, ["deriveKey"]).then(function (k) {
      return SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("osap-lock-wrap"), info: new TextEncoder().encode("v1") },
        k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  /* one Face ID check: returns the PRF secret for this credential */
  function faceId(credId) {
    return prfSalt().then(function (salt) {
      return navigator.credentials.get({ publicKey: {
        challenge: rnd(32), rpId: location.hostname, userVerification: "required", timeout: 60000,
        allowCredentials: [{ type: "public-key", id: unb64u(credId) }],
        extensions: { prf: { eval: { first: salt } } }
      } });
    }).then(function (a) {
      var r = a && a.getClientExtensionResults ? a.getClientExtensionResults() : {};
      var f = r && r.prf && r.prf.results && r.prf.results.first;
      if (!f) throw new Error("noprf");
      return f;
    });
  }
  function canUse() {
    if (!SUB || !W.PublicKeyCredential || !navigator.credentials || !W.isSecureContext) return Promise.resolve(false);
    var p = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    return p ? p.call(PublicKeyCredential).catch(function () { return false; }) : Promise.resolve(false);
  }

  function setup() {
    var cred, salt;
    /* the PRF secret is asked for at creation too: where the passkey gives it straight away (iOS 18+), setup needs one Face ID */
    return prfSalt().then(function (x) { salt = x; return navigator.credentials.create({ publicKey: {
      rp: { name: "AXIOM OSAP", id: location.hostname },
      user: { id: rnd(16), name: "OSAP owner", displayName: "OSAP hidden areas" },
      challenge: rnd(32), timeout: 60000,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
      extensions: { prf: { eval: { first: salt } } }
    } }); }).then(function (c) {
      var r = c && c.getClientExtensionResults ? c.getClientExtensionResults() : {};
      if (!r.prf || r.prf.enabled === false) throw new Error("noprf");
      cred = b64u(c.rawId);
      return r.prf.results && r.prf.results.first ? r.prf.results.first : faceId(cred);
    }).then(function (prf) {
      return Promise.all([wrapKey(prf), SUB.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"])]);
    }).then(function (x) {
      var wk = x[0], kp = x[1], iv = rnd(12);
      return Promise.all([SUB.exportKey("pkcs8", kp.privateKey), SUB.exportKey("spki", kp.publicKey)]).then(function (e) {
        return SUB.encrypt({ name: "AES-GCM", iv: iv }, wk, e[0]).then(function (w) {
          var d = { v: 1, cred: cred, iv: b64u(iv), wrapped: b64u(w), pub: b64u(e[1]), at: new Date().toISOString().slice(0, 16) + "Z" };
          lSet(K_DEV, JSON.stringify(d));
          return d;
        });
      });
    });
  }
  /* Face ID, then decrypt this device's private key: proves the person and the device. Keeps the key for this app session. */
  function unlock() {
    var d = dev(); if (!d) return Promise.reject(new Error("nosetup"));
    if (!ownerOk(d)) return Promise.reject(new Error("notowner"));
    return faceId(d.cred).then(wrapKey).then(function (wk) {
      return SUB.decrypt({ name: "AES-GCM", iv: unb64u(d.iv) }, wk, unb64u(d.wrapped));
    }).then(function (pk) {
      lSet(K_OPEN, JSON.stringify({ until: Date.now() + STAY * 3600e3, key: b64u(pk) })); return true;
    });
  }
  function lock() { lSet(K_OPEN, null); sSet(K_OPEN, null); sSet("osap-lock-key", null); }
  /* the owner's private key (ECDH P-256) while unlocked, for reading the hidden areas' encrypted files */
  function privateKey() {
    var h = OPEN && held(), k = h && h.key; if (!k || !SUB) return Promise.resolve(null);
    return SUB.importKey("pkcs8", unb64u(k), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]);
  }
  function why(e) {
    var m = String(e && (e.message || e.name) || e);
    if (/noprf/.test(m)) return "This device's passkeys cannot give the secret the lock needs (WebAuthn PRF). Use an iPhone on iOS 18 or later in Safari, or a recent Chrome.";
    if (/nosetup/.test(m)) return "Face ID has not been set up on this device yet.";
    if (/notowner/.test(m)) return "This device is not one of the owner's devices, so it cannot unlock hidden areas.";
    if (/NotAllowed|AbortError|cancel/i.test(m)) return "Face ID was cancelled or timed out. Nothing changed.";
    if (/OperationError/.test(m)) return "Face ID worked, but this device's lock key could not be opened. Set up again.";
    if (/InvalidState/.test(m)) return "A passkey for this site already exists on this device. Try Unlock, or delete the old OSAP passkey in Settings > Passwords first.";
    if (/Security/.test(m)) return "This page's address cannot use passkeys. Open the live site (01shane89-jpg.github.io) instead.";
    return "That did not work: " + m;
  }

  /* ---------- Settings > Hidden areas ---------- */
  var box = null, UI = { msg: "", busy: false, ok: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function render() {
    if (!box || box.hidden) return;
    var d = dev(), owner = ownerOk(d), dis = UI.busy ? " disabled" : "";
    var h = '<div class="cbox"><div class="chead"><h2 id="lk-h">Hidden areas</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      '<p class="obs">Some areas are hidden from everyone except the owner. They show only after the owner unlocks this app with Face ID, and stay unlocked on this device for ' + STAY + ' hours or until Lock now.</p>' +
      '<p class="lkmsg" role="status"' + (UI.msg ? "" : " hidden") + ">" + esc(UI.msg) + "</p>";
    if (UI.ok === false) h += '<p class="obs">This browser cannot use Face ID or another built-in lock here.</p>';
    else if (OPEN) h += '<p><b>Unlocked.</b> Hidden areas are showing on this device' + (held() && held().until ? " until " + new Date(held().until).toTimeString().slice(0, 5) + " (this device's time)" : "") + '.</p><div class="lkbtns"><button type="button" class="refresh" data-lk="lock"' + dis + ">Lock now</button></div>";
    else if (d && owner) h += '<div class="lkbtns"><button type="button" class="refresh" data-lk="unlock"' + dis + ">Unlock (Face ID or Windows Hello)</button></div>";
    else if (d) h += '<p class="obs">This device was set up, but it is not one of the owner\'s devices, so it cannot unlock.</p>';
    if (d && !OPEN && !OWNER.length) h += '<p class="obs">Waiting for this device\'s setup code to be added to OSAP. Until then it can unlock, but so could anyone else\'s device.</p>';
    if (d) h += '<details class="lknote"' + (OWNER.length ? "" : " open") + '><summary>Setup code for this device</summary><p class="obs">Send this to Claude in the "Hide US Data" thread. It can only lock data for this device, not open it, so it is safe to share.</p>' +
      '<textarea readonly rows="4" data-lk-code>' + esc(code(d)) + '</textarea><div class="lkbtns"><button type="button" data-lk="copy">Copy setup code</button></div></details>';
    if (!d && UI.ok !== false) h += '<div class="lkbtns"><button type="button" class="refresh" data-lk="setup"' + dis + ">Set up Face ID or Windows Hello on this device</button></div>" +
      '<p class="obs">Makes a passkey for OSAP on this device (Face ID once or twice) and a lock key that only Face ID can open. Nothing leaves the device.</p>';
    if (d && !OPEN) h += '<details class="lknote"><summary>Start again on this device</summary><p class="obs">Forgets this device\'s lock key. Data locked for it can no longer be opened here.</p><div class="lkbtns"><button type="button" data-lk="forget"' + dis + ">Forget this device's key</button></div></details>";
    box.innerHTML = h + "</div>";
  }
  function say(t) { UI.msg = t; render(); }
  function open() {
    if (!box) {
      box = D.createElement("div"); box.id = "lockdlg"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "lk-h");
      box.addEventListener("click", onClick); D.body.appendChild(box);
      var css = D.createElement("style");
      css.textContent = "#lockdlg{position:fixed;inset:0;z-index:100002;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
        "#lockdlg .cbox{max-width:520px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
        "#lockdlg .chead{display:flex;align-items:center;gap:8px}#lockdlg .chead h2{margin:0;font-size:18px;flex:1}" +
        "#lockdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#lockdlg .obs{color:var(--muted)}" +
        "#lockdlg .lkbtns{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}#lockdlg .lkbtns>*{min-height:40px}" +
        "#lockdlg textarea{width:100%;box-sizing:border-box;font:12px/1.3 ui-monospace,monospace;word-break:break-all}" +
        "#lockdlg .lkmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}#lockdlg .lknote summary{cursor:pointer;font-weight:600;padding:6px 0}";
      D.head.appendChild(css);
    }
    UI.msg = ""; box.hidden = false; render();
    canUse().then(function (ok) { UI.ok = ok; render(); });
    var x = box.querySelector(".x"); if (x) x.focus();
  }
  function close() { if (box) { box.hidden = true; box.innerHTML = ""; } }
  /* the page is rebuilt so every list (picker, Today, news) is drawn with or without the hidden areas */
  function reload(toDefault) {
    if (toDefault) { var h = (location.hash || "").replace("#", "").split("/"); if (h.length > 1 && HIDDEN.indexOf(h[0]) >= 0) { location.replace(location.pathname); return; } }
    location.reload();
  }
  function onClick(e) {
    var t = e.target;
    if (t === box || (t.closest && t.closest(".x"))) { close(); return; }
    var b = t.closest && t.closest("[data-lk]"); if (!b || UI.busy) return;
    var k = b.getAttribute("data-lk");
    if (k === "copy") {
      var ta = box.querySelector("[data-lk-code]"), v = ta ? ta.value : "";
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { say("Setup code copied."); },
        function () { if (ta) { ta.focus(); ta.select(); } say("Select the code and copy it."); });
      return;
    }
    if (k === "lock") { lock(); OPEN = false; reload(true); return; }
    if (k === "forget") { if (!confirm("Forget this device's lock key?")) return; lSet(K_DEV, null); lock(); say("Forgotten. You can set up again."); return; }
    UI.busy = true; say(k === "setup" ? "Follow the Face ID prompts…" : "Look at your phone…");
    (k === "setup" ? setup().then(function () { return "Set up. Copy the setup code below and send it to Claude in the \"Hide US Data\" thread."; })
      : unlock().then(function () { OPEN = true; setTimeout(function () { reload(false); }, 600); return "Unlocked. Reloading…"; }))
      .then(function (m) { UI.busy = false; say(m); }, function (err) { UI.busy = false; say(why(err)); });
  }

  W.OSAP_LOCK = {
    hidden: hidden,
    isOpen: function () { return OPEN; },
    list: function () { return HIDDEN.slice(); },
    /* takes the hidden countries out of the world list before the page builds its country list from it */
    prune: function () { if (OPEN || !W.ASAP_WORLD) return; W.ASAP_WORLD = W.ASAP_WORLD.filter(function (w) { return !(w && hidden(w.id)); }); },
    open: open, privateKey: privateKey
  };
})();
