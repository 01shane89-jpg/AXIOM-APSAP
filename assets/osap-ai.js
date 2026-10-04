/* AXIOM OSAP: on-device AI for the AI summaries (Shane 2026-10-04: "Why isn't there AI?" on an iPhone; "I have LM Studio on my phone").
   The area, tab and route summaries (assets/osap-areasum.js) first use a model the browser ships itself (Chrome's built-in Prompt
   or Summarizer API). Most browsers have none, so this adds two more, both with no key and no account, picked in this order:
   1. An AI server the analyst runs on this computer or their own network (LM Studio, Ollama, llama.cpp: any OpenAI-compatible
      /v1 address). Off until an address is saved. Only loopback, private-network and .local/.lan/.ts.net addresses are accepted,
      so reports are never sent to a public service. Phone apps such as LM Studio's iPhone app cannot be used this way: they
      run no server other apps can call, and iOS pauses them while OSAP is on screen.
   2. OSAP's own model, run inside this browser with WebGPU (Safari on iOS 26 and later, recent Chrome and Edge): Llama 3.2 1B
      Instruct (4-bit) through WebLLM 0.2.85 (Apache-2.0, kept in assets/vendor), in a worker (assets/osap-ai-worker.js) so the
      page never freezes. The weights (under 1 GB, Hugging Face mlc-ai) download once, only when the analyst taps Download,
      and stay in this browser's storage; nothing about the reports leaves the device. Unloaded after two idle minutes.
   Settings live on this device only (localStorage "osap-ai"; Move to another device leaves them out).
   Whatever writes it, the text stays a draft: assets/osap-areasum.js tags it "AI generated", keeps only sentences that cite
   listed items, and passes the reports to the model as data, never as instructions. Nothing here changes a record.
   window.OSAP_AI {open, close, provider, prefs, okHost, webgpu} */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-ai", LIB = "assets/vendor/web-llm-0.2.85.js", WORKER = "assets/osap-ai-worker.js";
  var MODELS = { f16: "Llama-3.2-1B-Instruct-q4f16_1-MLC", f32: "Llama-3.2-1B-Instruct-q4f32_1-MLC" };
  var MODEL_NAME = "Llama 3.2 1B Instruct", WEB_REFS = 20, LOCAL_REFS = 30, IDLE_MS = 120000, LOCAL_WAIT = 180000;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function prefs(p) {
    var cur = {}; try { cur = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { cur = {}; }
    if (p) { Object.keys(p).forEach(function (k) { if (p[k] == null) delete cur[k]; else cur[k] = p[k]; }); try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} }
    return cur;
  }

  /* ---------- an AI server on this computer or network ---------- */
  function okHost(u) {
    var x; try { x = new URL(u); } catch (e) { return false; }
    if (!/^https?:$/.test(x.protocol) || x.username || x.password) return false;
    var h = x.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "localhost" || h === "::1" || /\.(localhost|local|lan|home\.arpa|internal|ts\.net)$/.test(h)) return true;
    var m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); if (!m) return false;
    var a = +m[1], b = +m[2];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  function normUrl(u) {
    u = String(u || "").trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) u = "http://" + u;
    try { var x = new URL(u); if (x.pathname === "/" || x.pathname === "") u = x.origin + "/v1"; } catch (e) {}
    return u.replace(/\/(chat\/completions|models)$/, "");
  }
  function timed(url, opt, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = ac ? setTimeout(function () { ac.abort(); }, ms) : 0;
    if (ac) opt.signal = ac.signal;
    return fetch(url, opt).then(function (r) { clearTimeout(t); return r; }, function (e) {
      clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : "could not reach it (" + (e && e.message || e) + ")");
    });
  }
  function localModels(base) {
    return timed(base + "/models", { method: "GET", mode: "cors", credentials: "omit", cache: "no-store" }, 8000).then(function (r) {
      if (!r.ok) throw new Error("it answered " + r.status);
      return r.json();
    }).then(function (j) { return ((j && j.data) || []).map(function (m) { return String(m && m.id || ""); }).filter(Boolean); });
  }
  function localChat(L, sys, user) {
    return timed(L.url + "/chat/completions", { method: "POST", mode: "cors", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: L.model || undefined, temperature: 0.2, max_tokens: 700, stream: false, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) }, LOCAL_WAIT)
      .then(function (r) { if (!r.ok) throw new Error("the AI server answered " + r.status); return r.json(); })
      .then(function (j) { var c = j && j.choices && j.choices[0]; return String(c && (c.message && c.message.content || c.text) || ""); });
  }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return u; } }

  /* ---------- OSAP's own model, in this browser ---------- */
  function webgpu() { return !!(navigator.gpu && typeof navigator.gpu.requestAdapter === "function" && W.Worker); }
  var ENG = null, ENG_ID = "", IDLE = 0, LOADING = null, LIBP = null;
  function lib() { return LIBP || (LIBP = import(new URL(LIB, location.href).href)); }
  function pickModel() {
    return navigator.gpu.requestAdapter().then(function (ad) {
      if (!ad) throw new Error("this device's graphics cannot run it");
      return ad.features && ad.features.has("shader-f16") ? MODELS.f16 : MODELS.f32;
    });
  }
  function unload() {
    clearTimeout(IDLE); var e = ENG; ENG = null; ENG_ID = "";
    if (e) { Promise.resolve(e.unload && e.unload()).catch(function () {}).then(function () { try { e.__w.terminate(); } catch (x) {} }); }
  }
  function idleLater() { clearTimeout(IDLE); IDLE = setTimeout(unload, IDLE_MS); }
  /* onProgress(fraction, label) while it downloads or loads */
  function engine(onProgress) {
    if (ENG) { idleLater(); return Promise.resolve(ENG); }
    if (LOADING) return LOADING;
    var had = !!prefs().web;
    LOADING = Promise.all([lib(), pickModel()]).then(function (r) {
      var L = r[0], id = r[1], w = new Worker(new URL(WORKER, location.href), { type: "module" });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      return L.CreateWebWorkerMLCEngine(w, id, { initProgressCallback: function (p) {
        if (onProgress) onProgress(p && p.progress || 0, (had ? "Loading the AI model… " : "Downloading the AI model… ") + Math.round((p && p.progress || 0) * 100) + "%");
      } }, { context_window_size: 4096 }).then(function (e) {
        e.__w = w; ENG = e; ENG_ID = id; prefs({ web: { model: id, at: Date.now() } }); idleLater(); return e;
      }, function (err) { try { w.terminate(); } catch (x) {} throw err; });
    });
    LOADING.then(function () { LOADING = null; }, function () { LOADING = null; });
    return LOADING;
  }
  function webChat(sys, user, onProgress) {
    return engine(onProgress).then(function (e) {
      if (onProgress) onProgress(1, "Writing…");
      clearTimeout(IDLE);
      return e.chat.completions.create({ messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.2, max_tokens: 450 })
        .then(function (r) { idleLater(); var c = r && r.choices && r.choices[0]; return String(c && c.message && c.message.content || ""); }, function (err) { idleLater(); throw err; });
    });
  }
  function removeWeb() {
    unload(); var p = prefs().web, id = p && p.model;
    prefs({ web: null });
    if (!id) return Promise.resolve();
    return lib().then(function (L) { return L.deleteModelAllInfoInCache(id); }).catch(function () {});
  }

  /* the next writer after the browser's own: the analyst's AI server when one is saved, otherwise OSAP's model where WebGPU runs.
     {kind: "chat", name, max (items it reads), privacy, dlNote, avail() -> "available" | "downloadable" | "unavailable", write(sys, user, onProgress)} */
  function provider() {
    var P = prefs();
    if (P.local && P.local.url) {
      var L = P.local;
      return { kind: "chat", id: "local", name: "your AI server at " + hostOf(L.url) + (L.model ? " (" + L.model + ")" : ""), max: LOCAL_REFS,
        privacy: "Sent only to your AI server at " + hostOf(L.url) + "; no key or account.",
        avail: function () { return Promise.resolve(okHost(L.url) ? "available" : "unavailable"); },
        write: function (sys, user) { return localChat(L, sys, user); } };
    }
    if (!webgpu()) return null;
    return { kind: "chat", id: "web", name: "OSAP's AI model (" + MODEL_NAME + ", running in this browser)", max: WEB_REFS,
      privacy: "No key or account; nothing is sent anywhere.",
      dlNote: "The model is under 1 GB and downloads once, the first time (Wi-Fi is best). After that it works offline.",
      avail: function () { return Promise.resolve(prefs().web ? "available" : "downloadable"); },
      write: webChat };
  }

  /* ---------- Settings → On-device AI ---------- */
  var box = D.createElement("div"); box.id = "aidlg"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "ai-h");
  var UI = { msg: "", busy: "", pct: 0, builtin: "", models: null };
  function builtinState() {
    var o = W.LanguageModel || W.Summarizer;
    if (!o || typeof o.availability !== "function") return Promise.resolve("none");
    return Promise.resolve(o.availability()).then(function (v) { return String(v || "unavailable"); }, function () { return "unavailable"; });
  }
  function open() {
    UI.msg = ""; UI.models = null; box.hidden = false; if (!box.parentNode) D.body.appendChild(box);
    render(); builtinState().then(function (s) { UI.builtin = s; render(); });
    var x = box.querySelector(".x"); if (x) x.focus();
  }
  function close() { box.hidden = true; box.innerHTML = ""; }
  function render() {
    if (box.hidden) return;
    var P = prefs(), L = P.local || {}, web = P.web, gpu = webgpu();
    var bi = UI.builtin === "none" ? "This browser has no AI model of its own." : UI.builtin === "unavailable" ? "This browser has an AI interface, but its model cannot run on this device." :
      UI.builtin ? "This browser has its own AI model, and summaries use it first." : "Checking…";
    box.innerHTML = '<div class="cbox"><div class="chead"><h2 id="ai-h">On-device AI</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      '<p class="obs">The AI summaries (Route, drawn areas, tabs) need an AI model with no key or account. They use the first of these that works. Everything here is kept on this device only.</p>' +
      '<p class="aimsg" role="status"' + (UI.msg ? "" : " hidden") + ">" + esc(UI.msg) + "</p>" +
      '<section class="aisec"><h3>1. This browser\'s own model</h3><p class="obs">' + esc(bi) + "</p></section>" +
      '<section class="aisec"><h3>2. Your AI server</h3>' +
      '<p class="obs">LM Studio, Ollama or llama.cpp running on this computer or your own network. Only addresses on this device or a private network are accepted, so reports never go to an outside service.</p>' +
      '<label class="airow"><span>Address</span><input type="url" data-ai-url inputmode="url" autocomplete="off" spellcheck="false" placeholder="http://localhost:1234/v1" value="' + esc(L.url || "") + '"></label>' +
      '<label class="airow"><span>Model</span><input type="text" data-ai-model autocomplete="off" spellcheck="false" placeholder="the server\'s first model" value="' + esc(L.model || "") + '"' + (UI.models && UI.models.length ? ' list="ai-models"' : "") + "></label>" +
      (UI.models && UI.models.length ? '<datalist id="ai-models">' + UI.models.map(function (m) { return '<option value="' + esc(m) + '">'; }).join("") + "</datalist>" : "") +
      '<div class="aibtns"><button type="button" class="refresh" data-ai-test' + (UI.busy ? " disabled" : "") + ">Test and save</button>" + (L.url ? '<button type="button" data-ai-clear>Stop using it</button>' : "") + "</div>" +
      '<details class="ainote"><summary>How to turn the server on</summary>' +
      "<p><b>LM Studio</b> (Mac, Windows, Linux): Developer tab, Start server, and turn on Enable CORS. Address http://localhost:1234/v1 on the same computer.</p>" +
      "<p><b>Ollama</b>: start it with OLLAMA_ORIGINS set to " + esc(location.origin) + ". Address http://localhost:11434/v1.</p>" +
      "<p>From another device, the live site can only reach an https address (a browser blocks plain http from an https page), for example a Tailscale https name ending in .ts.net.</p>" +
      "<p>Phone apps (LM Studio's iPhone app and similar) cannot be used: they run no server that other apps can call, and iOS pauses them while OSAP is on screen. Use OSAP's own model below instead.</p></details></section>" +
      '<section class="aisec"><h3>3. OSAP\'s own model, in this browser</h3>' +
      (gpu ? '<p class="obs">' + esc(MODEL_NAME) + " (4-bit), run on this device's graphics chip. Under 1 GB, downloaded once from Hugging Face when you tap Download, then kept in this browser and usable offline. Nothing about the reports leaves the device.</p>" +
        (web ? '<p class="obs">Downloaded ' + esc(new Date(web.at).toISOString().slice(0, 16).replace("T", " ")) + "Z (" + esc(web.model) + ").</p>" : "") +
        (UI.busy === "web" ? '<div class="aiprog"><progress max="1" value="' + UI.pct + '"></progress><span>' + Math.round(UI.pct * 100) + "%</span></div>" :
          '<div class="aibtns"><button type="button" class="refresh" data-ai-dl' + (UI.busy ? " disabled" : "") + ">" + (web ? "Check it works" : "Download") + "</button>" + (web ? '<button type="button" data-ai-rm>Remove</button>' : "") + "</div>")
        : '<p class="obs">This browser cannot run it: it needs WebGPU (Safari on iOS 26 or later, or a recent Chrome or Edge).</p>') +
      "</section></div>";
  }
  function say(t) { UI.msg = t; render(); }
  box.addEventListener("click", function (e) {
    var t = e.target;
    if (t === box || t.closest(".x")) { close(); return; }
    if (t.closest("[data-ai-test]")) {
      var url = normUrl(box.querySelector("[data-ai-url]").value), model = box.querySelector("[data-ai-model]").value.trim();
      if (!url) { say("Type the server's address first, for example http://localhost:1234/v1."); return; }
      if (!okHost(url)) { say("Not saved: " + url + " is not on this device or a private network. Use localhost, a private address (192.168…, 10…), or a .local, .lan or .ts.net name."); return; }
      UI.busy = "local"; say("Testing " + url + "…");
      localModels(url).then(function (ms) {
        UI.busy = ""; UI.models = ms;
        if (model && ms.length && ms.indexOf(model) < 0) { say("The server answered, but has no model called " + model + ". Pick one of: " + ms.slice(0, 8).join(", ") + "."); return; }
        prefs({ local: { url: url, model: model || ms[0] || "" } });
        say("Saved. The server answered with " + (ms.length ? ms.length + " model" + (ms.length === 1 ? "" : "s") : "no model list") + "; summaries will use " + (model || ms[0] || "its loaded model") + ".");
      }, function (err) {
        UI.busy = "";
        var mixed = location.protocol === "https:" && /^http:/.test(url) && !/^http:\/\/(localhost|127\.|\[::1\])/.test(url);
        say("Not saved: " + (err && err.message || err) + ". " + (mixed ? "This browser blocks plain http addresses from the live site; use localhost on the same computer or an https address." :
          "Check the server is running and that CORS is turned on (LM Studio: Enable CORS; Ollama: OLLAMA_ORIGINS)."));
      });
      return;
    }
    if (t.closest("[data-ai-clear]")) { prefs({ local: null }); UI.models = null; say("Your AI server is no longer used."); return; }
    if (t.closest("[data-ai-rm]")) {
      if (!confirm("Remove OSAP's AI model from this device? It downloads again if you use it later.")) return;
      UI.busy = "rm"; say("Removing…"); removeWeb().then(function () { UI.busy = ""; say("Removed from this device."); }); return;
    }
    if (t.closest("[data-ai-dl]")) {
      UI.busy = "web"; UI.pct = 0; say(prefs().web ? "Loading the model to check it works…" : "Downloading. Keep OSAP open; this can take several minutes.");
      var t0 = Date.now();
      webChat("Reply with one word.", "Say OK.", function (f, label) {
        UI.pct = f; var p = box.querySelector(".aiprog"); if (p) { p.querySelector("progress").value = f; p.querySelector("span").textContent = label; }
      }).then(function () {
        UI.busy = ""; say("Ready. The model works on this device (" + ((Date.now() - t0) / 1000).toFixed(0) + " s). AI summaries can use it now, also offline.");
      }, function (err) {
        UI.busy = ""; say("The model could not run on this device: " + String(err && err.message || err).slice(0, 200) + ". The automatic summaries still work.");
      });
    }
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });
  var css = D.createElement("style");
  css.textContent = "#aidlg{position:fixed;inset:0;z-index:100002;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#aidlg .cbox{max-width:620px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#aidlg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#aidlg .chead h2{margin:0;font-size:18px;flex:1}" +
    "#aidlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#aidlg .obs{color:var(--muted)}" +
    "#aidlg h3{font-size:14px;margin:4px 0}#aidlg .aisec{border:1px solid var(--line);border-radius:8px;padding:8px 12px 10px;margin:10px 0}" +
    "#aidlg .airow{display:flex;gap:8px;align-items:center;margin:6px 0}#aidlg .airow>span{flex:none;width:58px}#aidlg .airow input{font:inherit;flex:1;min-width:0;min-height:36px;padding:4px 8px}" +
    "#aidlg .aibtns{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}#aidlg .aibtns>*{min-height:38px}" +
    "#aidlg .aiprog{display:flex;flex-direction:column;gap:4px;margin:8px 0}#aidlg .aiprog progress{width:100%;height:12px}" +
    "#aidlg .aimsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}#aidlg .ainote summary{cursor:pointer;font-weight:600;padding:6px 0}";
  D.head.appendChild(css);

  W.OSAP_AI = { open: open, close: close, provider: provider, prefs: prefs, okHost: okHost, webgpu: webgpu, _normUrl: normUrl, _unload: unload };
})();
