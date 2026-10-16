/* AXIOM OSAP: sync my devices (Shane 2026-10-04: "the PC does not have my saved places synced"; picked "Relay sync" 2026-10-16).
   Keeps what the analyst saves the same on each of their own devices, with no account, no key and no server of ours.
   - Pairing: the first device makes a sync code (19 random Crockford base32 characters and a check character, about 95 bits).
     The analyst types it on the other device. Everything else comes from the code: HKDF-SHA-256 gives an AES-256-GCM key,
     a Nostr signing key and a key for the event names. The code is kept on the device (localStorage "osap-sync") and is never
     sent anywhere.
   - Transport: free public Nostr relays (NIP-01 websockets). Each device posts the merged state as encrypted "application
     data" events (kind 30078, NIP-78), one per bucket, signed BIP-340 with the key from the code. A relay keeps only the
     newest event per bucket, so a device that opens later still finds the latest state; the two devices never need to be on
     at the same time. Relays see an anonymous key, scrambled data, its size and timing, and the device's IP address.
     Content is AES-256-GCM with the event's name as associated data, so a relay or anyone else cannot read or change it;
     anything that does not open with the key is ignored.
   - What syncs: every workspace (its name) and its stores, the same stores a workspace holds (assets/osap-ws.js KEYS and the
     drawn areas): map points, drawn areas, NAI/TAI, routes, imported shapes, viewsheds, keyword watches, My work, medical,
     evacuation and comms plans, analyst entities and links. Not synced: photos (they stay on the device they were taken on),
     device settings, caches, the current selection of a route or evacuation plan, watch hits, the hidden areas (the United
     States drawn area and any item marked cc "us") and the hidden-areas lock.
   - Merge: each store is cut into units (each item with an id in a list, each entry of a keyed map, or the whole value),
     every unit carries the time it last changed, and the newest change to each unit wins. A delete leaves a marker so the
     item does not come back from the other device; markers are dropped after 60 days. Nothing is replaced wholesale.
   - Changes to the open workspace are written at the next page load (assets/osap-sync-boot.js, before any feature reads its
     store), so a feature holding the old list in memory cannot save over them; OSAP reloads by itself right after it opens
     or comes back to the screen, otherwise it offers a Reload button. Changes to other workspaces are written straight away.
   window.OSAP_SYNC {open, close, now, status, pair, start, off, core}. */
(function (G, factory) {
  var api = factory(G);
  if (typeof module === "object" && module.exports) module.exports = api.core;
  else if (G.document) api.boot();
})(typeof window !== "undefined" ? window : globalThis, function (W) {
  "use strict";
  var te = new TextEncoder(), td = new TextDecoder();
  var CR = W.crypto, SUB = CR && CR.subtle;

  /* ================= core: pure functions, tested in node (tests/sync.test.mjs) ================= */

  /* ---------- bytes ---------- */
  function hex(u) { var s = ""; for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? "0" : "") + u[i].toString(16); return s; }
  function unhex(s) { var u = new Uint8Array(s.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16); return u; }
  function cat(a) { var n = 0, p = 0, o; a.forEach(function (x) { n += x.length; }); o = new Uint8Array(n); a.forEach(function (x) { o.set(x, p); p += x.length; }); return o; }
  function b64(u) { var s = ""; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
  function unb64(s) { var r = atob(s), u = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; }
  function sha(u) { return SUB.digest("SHA-256", u).then(function (b) { return new Uint8Array(b); }); }
  function rand(n) { var u = new Uint8Array(n); CR.getRandomValues(u); return u; }
  function fnv(s, seed) { var h = seed || 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  /* a 64-bit fingerprint of a string: two FNV-1a passes */
  function fp(s) { return ("0000000" + fnv(s).toString(16)).slice(-8) + ("0000000" + fnv(s, 0x811c9dc5 ^ 0x5bd1e995).toString(16)).slice(-8); }
  /* JSON with object keys sorted, so the same value always gives the same text */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }

  /* ---------- secp256k1 BIP-340 signing (only signing: what comes back is checked by AES-GCM, not by signature) ---------- */
  var P = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F"), N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  var GX = BigInt("0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798"), GY = BigInt("0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8");
  var B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2), B3 = BigInt(3), B8 = BigInt(8);
  function md(a, m) { m = m || P; var r = a % m; return r < B0 ? r + m : r; }
  function pw(b, e, m) { var r = B1; b = md(b, m); while (e > B0) { if (e & B1) r = r * b % m; b = b * b % m; e >>= B1; } return r; }
  function dbl(p) {
    if (p[2] === B0 || p[1] === B0) return [B0, B1, B0];
    var A = p[0] * p[0] % P, Bb = p[1] * p[1] % P, C = Bb * Bb % P, Dd = md(B2 * (md((p[0] + Bb) * (p[0] + Bb) - A - C))), E = B3 * A % P, F = E * E % P;
    var X = md(F - B2 * Dd); return [X, md(E * (Dd - X) - B8 * C), B2 * p[1] * p[2] % P];
  }
  function add(p, q) {
    if (p[2] === B0) return q; if (q[2] === B0) return p;
    var Z1 = p[2] * p[2] % P, Z2 = q[2] * q[2] % P, U1 = p[0] * Z2 % P, U2 = q[0] * Z1 % P, S1 = p[1] * q[2] % P * Z2 % P, S2 = q[1] * p[2] % P * Z1 % P;
    var H = md(U2 - U1), R = md(S2 - S1);
    if (H === B0) return R === B0 ? dbl(p) : [B0, B1, B0];
    var HH = H * H % P, HHH = H * HH % P, V = U1 * HH % P, X = md(R * R - HHH - B2 * V);
    return [X, md(R * (V - X) - S1 * HHH), p[2] * q[2] % P * H % P];
  }
  function mul(k) { var r = [B0, B1, B0], a = [GX, GY, B1]; while (k > B0) { if (k & B1) r = add(r, a); a = dbl(a); k >>= B1; } return r; }
  function aff(p) { var zi = pw(p[2], P - B2, P), z2 = zi * zi % P; return [p[0] * z2 % P, p[1] * z2 % P * zi % P]; }
  function n2b(n) { var s = n.toString(16); while (s.length < 64) s = "0" + s; return unhex(s); }
  function b2n(u) { return BigInt("0x" + (hex(u) || "0")); }
  function tagged(tag, msg) { return sha(te.encode(tag)).then(function (t) { return sha(cat([t, t, msg])); }); }
  function pubOf(sk) { return n2b(aff(mul(b2n(sk)))[0]); }
  function sign(msg, sk, aux) {
    var d0 = b2n(sk); if (d0 <= B0 || d0 >= N) return Promise.reject(new Error("bad key"));
    var Pp = aff(mul(d0)), d = Pp[1] & B1 ? N - d0 : d0, px = n2b(Pp[0]);
    return tagged("BIP0340/aux", aux || new Uint8Array(32)).then(function (h) {
      var t = n2b(d), x = new Uint8Array(32); for (var i = 0; i < 32; i++) x[i] = t[i] ^ h[i];
      return tagged("BIP0340/nonce", cat([x, px, msg]));
    }).then(function (r) {
      var k0 = md(b2n(r), N); if (k0 === B0) throw new Error("bad nonce");
      var R = aff(mul(k0)), k = R[1] & B1 ? N - k0 : k0, rx = n2b(R[0]);
      return tagged("BIP0340/challenge", cat([rx, px, msg])).then(function (e) { return cat([rx, n2b(md(k + md(b2n(e), N) * d, N))]); });
    });
  }

  /* ---------- the sync code ---------- */
  var ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function check(s) { var c = 0; for (var i = 0; i < s.length; i++) c = (c * 7 + ALPHA.indexOf(s[i]) + 1) % 32; return ALPHA[c]; }
  function newCode(bytes) { var u = bytes || rand(19), s = ""; for (var i = 0; i < 19; i++) s += ALPHA[u[i] & 31]; return s + check(s); }
  /* typed code to its 20 characters, or "" when it is not a valid code (Crockford: O is 0, I and L are 1, case and dashes ignored) */
  function cleanCode(s) {
    s = String(s || "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
    if (s.length !== 20 || /[U]/.test(s)) return "";
    return check(s.slice(0, 19)) === s[19] ? s : "";
  }
  function showCode(s) { return s.replace(/(.{4})(?=.)/g, "$1-"); }
  /* everything else comes from the code */
  function keys(code) {
    var ikm = te.encode("osap-sync/1:" + code);
    return SUB.importKey("raw", ikm, "HKDF", false, ["deriveBits", "deriveKey"]).then(function (base) {
      function bits(info) { return SUB.deriveBits({ name: "HKDF", hash: "SHA-256", salt: te.encode("osap-sync"), info: te.encode(info) }, base, 256).then(function (b) { return new Uint8Array(b); }); }
      function nostrKey(i) { return bits("nostr" + (i ? "/" + i : "")).then(function (u) { var n = b2n(u); return n > B0 && n < N ? u : nostrKey(i + 1); }); }
      return Promise.all([
        SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("osap-sync"), info: te.encode("aes") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
        nostrKey(0), bits("name")
      ]).then(function (r) {
        return SUB.importKey("raw", r[2], { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(function (hk) {
          return { aes: r[0], sk: r[1], pk: hex(pubOf(r[1])), hk: hk };
        });
      });
    });
  }
  function dtag(K, name) { return SUB.sign("HMAC", K.hk, te.encode(name)).then(function (b) { return "osap-" + hex(new Uint8Array(b)).slice(0, 32); }); }

  /* ---------- sealing a payload ---------- */
  var canZ = typeof W.CompressionStream === "function" && typeof W.DecompressionStream === "function";
  function stream(u8, ts) { return new Response(new Blob([u8]).stream().pipeThrough(ts)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function seal(K, d, obj) {
    var body = te.encode(JSON.stringify(obj)), iv = rand(12);
    return (canZ ? stream(body, new W.CompressionStream("gzip")) : Promise.resolve(body)).then(function (z) {
      return SUB.encrypt({ name: "AES-GCM", iv: iv, additionalData: te.encode(d) }, K.aes, cat([new Uint8Array([canZ ? 1 : 0]), z]));
    }).then(function (ct) { return "1:" + b64(cat([iv, new Uint8Array(ct)])); });
  }
  function open(K, d, s) {
    if (typeof s !== "string" || s.slice(0, 2) !== "1:" || s.length > 2e6) return Promise.resolve(null);
    var u; try { u = unb64(s.slice(2)); } catch (e) { return Promise.resolve(null); }
    if (u.length < 30) return Promise.resolve(null);
    return SUB.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12), additionalData: te.encode(d) }, K.aes, u.subarray(12)).then(function (pt) {
      pt = new Uint8Array(pt);
      if (pt[0] === 1 && !canZ) return null;
      return (pt[0] === 1 ? stream(pt.subarray(1), new W.DecompressionStream("gzip")) : Promise.resolve(pt.subarray(1))).then(function (b) { return JSON.parse(td.decode(b)); });
    }).then(null, function () { return null; });
  }

  /* ---------- a Nostr event ---------- */
  function event(K, d, content, at) {
    var ev = { pubkey: K.pk, created_at: at, kind: 30078, tags: [["d", d]], content: content };
    return sha(te.encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))).then(function (id) {
      ev.id = hex(id);
      return sign(id, K.sk, rand(32));
    }).then(function (sig) { ev.sig = hex(sig); return ev; });
  }

  /* ---------- stores to units ---------- */
  /* never synced, even inside a workspace: the open selection, per-device watch state, the hidden areas */
  var NOSYNC = ["osap-route-cur", "osap-epe-cur", "asap-watch-hits", "asap-watch-seen", "asap-area-us", "asap-area-us-st"];
  function hidden(x) { return !!x && typeof x === "object" && !Array.isArray(x) && String(x.cc || "").toLowerCase() === "us"; }
  function plain(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function idOf(x) { return plain(x) && (typeof x.id === "string" && x.id && x.id.length <= 200 ? x.id : typeof x.id === "number" && isFinite(x.id) ? String(x.id) : null); }
  function idList(a) { var seen = {}; return Array.isArray(a) && a.every(function (x) { var i = idOf(x); if (i == null || seen["$" + i]) return false; seen["$" + i] = 1; return true; }); }
  function mapLike(o) { return plain(o) && Object.keys(o).every(function (k) { return plain(o[k]); }); }
  /* one store (its raw text) as {path: value}; "~" says how to put it back together */
  function split(raw) {
    var v, u = {};
    try { v = JSON.parse(raw); } catch (e) { u["~"] = "s"; u[""] = raw; return u; }
    if (idList(v)) { u["~"] = "a"; v.forEach(function (x) { if (!hidden(x)) u["[" + idOf(x)] = x; }); return u; }
    if (plain(v)) {
      var kinds = {};
      Object.keys(v).forEach(function (p) {
        var pv = v[p];
        if (Array.isArray(pv) && idList(pv)) { kinds[p] = "a"; pv.forEach(function (x) { if (!hidden(x)) u["." + p + "[" + idOf(x)] = x; }); }
        else if (mapLike(pv)) { kinds[p] = "m"; Object.keys(pv).forEach(function (k) { if (!hidden(pv[k])) u["." + p + "{" + k] = pv[k]; }); }
        else { kinds[p] = "v"; u["." + p] = pv; }
      });
      u["~"] = { o: kinds }; return u;
    }
    u["~"] = "v"; u[""] = v; return u;
  }
  /* units back to the store's text. local = this device's text (keeps its order, and keeps the hidden items it holds) */
  function join(u, local) {
    var kind = u["~"], lv = null;
    if (kind === undefined) return null;
    if (kind === "s") return typeof u[""] === "string" ? u[""] : "";
    if (kind === "v") return JSON.stringify(u[""] === undefined ? null : u[""]);
    try { lv = local == null ? null : JSON.parse(local); } catch (e) { lv = null; }
    function list(pre, old) {
      var out = [], used = Object.create(null);
      (Array.isArray(old) ? old : []).forEach(function (x) {
        var i = idOf(x);
        if (i != null && hidden(x)) { out.push(x); return; }
        if (i != null && u[pre + i] !== undefined && !used[i]) { out.push(u[pre + i]); used[i] = 1; }
      });
      Object.keys(u).forEach(function (k) { if (k.indexOf(pre) === 0) { var i = k.slice(pre.length); if (!used[i] && (pre !== "[" || k[0] === "[")) { out.push(u[k]); used[i] = 1; } } });
      return out;
    }
    function map(pre, old) {
      var out = Object.create(null);
      if (plain(old)) Object.keys(old).forEach(function (k) { if (hidden(old[k])) out[k] = old[k]; else if (u[pre + k] !== undefined) out[k] = u[pre + k]; });
      Object.keys(u).forEach(function (k) { if (k.indexOf(pre) === 0) { var i = k.slice(pre.length); if (!Object.prototype.hasOwnProperty.call(out, i)) out[i] = u[k]; } });
      return out;
    }
    if (kind === "a") return JSON.stringify(list("[", lv));
    if (plain(kind) && plain(kind.o)) {
      var o = {}, lo = plain(lv) ? lv : {};
      Object.keys(kind.o).forEach(function (p) {
        var k = kind.o[p];
        if (k === "a") o[p] = list("." + p + "[", lo[p]);
        else if (k === "m") o[p] = map("." + p + "{", lo[p]);
        else if (u["." + p] !== undefined) o[p] = u["." + p];
      });
      return JSON.stringify(o);
    }
    return null;
  }
  /* the stores of every workspace as units: "W|<ws>" names a workspace, "S|<ws>|<store>|<path>" is a unit of one of its stores */
  function unitsOf(wsList, storesOf, synced) {
    var L = {};
    wsList.forEach(function (w) {
      L["W|" + w.id] = { name: w.name, created: w.created || 0 };
      var S = storesOf(w.id);
      Object.keys(S).forEach(function (k) {
        if (!synced(k) || NOSYNC.indexOf(k) >= 0 || typeof S[k] !== "string") return;
        var u = split(S[k]);
        Object.keys(u).forEach(function (p) { L["S|" + w.id + "|" + k + "|" + p] = u[p]; });
      });
    });
    return L;
  }
  function parseUk(uk) {
    if (uk.slice(0, 2) === "W|") return { ws: uk.slice(2) };
    var a = uk.indexOf("|", 2), b = uk.indexOf("|", a + 1);
    return { ws: uk.slice(2, a), store: uk.slice(a + 1, b), path: uk.slice(b + 1) };
  }

  /* ---------- the merge ----------
     M: the merged state {uk: {t, h, v} or {t, h, d: 1}}; O: what this device held last time {uk: {t, h}}.
     L: this device's units now. A unit changed here when it differs from both; one that was here and is gone was deleted here.
     first: the first sync on a device that just joined, so what it holds is dated old and the other devices win on any clash. */
  var DAY = 864e5, KEEP_DEL = 60 * DAY;
  function stamp(L, O, M, now, first) {
    var S = {};
    Object.keys(L).forEach(function (uk) {
      var h = fp(canon(L[uk])), o = O[uk], m = M[uk], t;
      if (m && !m.d && m.h === h) t = m.t;
      else if (o && o.h === h) t = o.t;
      else t = first ? 1 : Math.max(now, (m ? m.t : 0) + 1);
      S[uk] = { t: t, h: h, v: L[uk] };
    });
    Object.keys(O).forEach(function (uk) { if (!(uk in L) && !(M[uk] && M[uk].d)) S[uk] = { t: Math.max(now, (M[uk] ? M[uk].t : 0) + 1), h: "", d: 1 }; });
    return S;
  }
  function newer(a, b) { return !b || a.t > b.t || (a.t === b.t && (a.d ? 1 : 0) > (b.d ? 1 : 0)) || (a.t === b.t && !!a.d === !!b.d && a.h > b.h); }
  function merge(sets, now) {
    var M = {};
    sets.forEach(function (S) { Object.keys(S || {}).forEach(function (uk) { var x = S[uk]; if (x && typeof x.t === "number" && newer(x, M[uk])) M[uk] = x; }); });
    Object.keys(M).forEach(function (uk) { if (M[uk].d && now - M[uk].t > KEEP_DEL) delete M[uk]; });
    return M;
  }
  /* the stores of one workspace as merged, with this device's texts to keep order and hidden items */
  function storesFrom(M, ws, localStores) {
    var by = {}, out = {};
    Object.keys(M).forEach(function (uk) {
      if (uk.slice(0, 2) !== "S|" || M[uk].d) return;
      var p = parseUk(uk); if (p.ws !== ws) return;
      (by[p.store] = by[p.store] || {})[p.path] = M[uk].v;
    });
    Object.keys(by).forEach(function (k) { var s = join(by[k], localStores[k]); if (s != null) out[k] = s; });
    return out;
  }
  /* buckets: which event carries a unit */
  var NB = 16;
  function bucketOf(uk) { return fnv(uk) % NB; }
  function buckets(M) {
    var B = []; for (var i = 0; i < NB; i++) B.push({});
    Object.keys(M).sort().forEach(function (uk) { var x = M[uk]; B[bucketOf(uk)][uk] = x.d ? [x.t, x.h, 0, 1] : [x.t, x.h, x.v]; });
    return B;
  }
  function fromBucket(b) {
    var S = {}; if (!plain(b)) return S;
    Object.keys(b).forEach(function (uk) {
      var r = b[uk];
      if (!Array.isArray(r) || typeof r[0] !== "number" || typeof r[1] !== "string" || !/^[WS]\|/.test(uk) || uk.length > 600) return;
      S[uk] = r[3] ? { t: r[0], h: r[1], d: 1 } : { t: r[0], h: r[1], v: r[2] };
    });
    return S;
  }
  /* a received unit is checked against its fingerprint, so a damaged one is dropped rather than merged */
  function trusted(S) { Object.keys(S).forEach(function (uk) { if (!S[uk].d && fp(canon(S[uk].v)) !== S[uk].h) delete S[uk]; }); return S; }

  var core = { hex: hex, unhex: unhex, sign: sign, pubOf: pubOf, newCode: newCode, cleanCode: cleanCode, showCode: showCode, keys: keys, dtag: dtag, seal: seal, open: open, event: event,
    split: split, join: join, unitsOf: unitsOf, parseUk: parseUk, stamp: stamp, merge: merge, storesFrom: storesFrom, buckets: buckets, fromBucket: fromBucket, trusted: trusted,
    canon: canon, fp: fp, NOSYNC: NOSYNC, NB: NB };

  /* ================= the page ================= */
  function boot() {
    var D = W.document;
    if (/[?&]watchscan=1(&|$)/.test(W.location.search)) return;
    var CFG = "osap-sync", PEND = "osap-sync-pending", AUTO = "osap-sync-auto", MSG = "osap-sync-msg";
    /* relays that took, kept, replaced and gave back these events from a new key (probe from GitHub Actions 2026-10-16);
       relay.damus.io took them but did not answer reads, offchain.pub and bitcoiner.social refuse new keys, nostr.land is paid */
    var RELAYS = ["wss://relay.primal.net", "wss://nos.lol", "wss://relay.snort.social", "wss://nostr-pub.wellorder.net", "wss://nostr.oxtr.dev"];
    if (W.OSAP_SYNC_RELAYS && W.OSAP_SYNC_RELAYS.length) RELAYS = W.OSAP_SYNC_RELAYS.slice(0, 6);
    var MAX_EVENT = 120000, WAIT = 7000;   /* the smallest relays take messages up to 131,072 bytes */

    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function put(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function json(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
    function when(ms) { return !ms ? "never" : W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
    function ago(ms) { var s = (Date.now() - ms) / 1000; return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; }
    function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
    function cfg() { var c = json(raw(CFG), null); return c && cleanCode(c.code) ? c : null; }
    function devName() {
      var u = navigator.userAgent || "", os = /iPhone/.test(u) ? "iPhone" : /iPad|Macintosh.*Mobile/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows PC" : /Macintosh/.test(u) ? "Mac" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux PC" : "Device";
      var br = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /CriOS|Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
      return os + (br ? " (" + br + ")" : "");
    }

    /* ---------- state kept in IndexedDB "osap-sync": M, O, first ---------- */
    function db() {
      return new Promise(function (res, rej) {
        if (!W.indexedDB) { rej(new Error("no IndexedDB")); return; }
        var r = W.indexedDB.open("osap-sync", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
    }
    function kv(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction("kv", mode), out = fn(t.objectStore("kv"));
          t.oncomplete = function () { d.close(); res(out && "result" in out ? out.result : out); };
          t.onerror = t.onabort = function () { d.close(); rej(t.error || new Error("storage refused")); };
        });
      });
    }
    function loadState() { return kv("readonly", function (s) { return s.get("state"); }).then(function (x) { return x && x.code === cfg().code ? x : { code: cfg().code, M: {}, O: {}, first: true, seen: {} }; }); }
    function saveState(x) { return kv("readwrite", function (s) { s.put(x, "state"); }); }
    function dropState() { return kv("readwrite", function (s) { s.delete("state"); }).then(null, function () {}); }

    /* ---------- the workspaces on this device ---------- */
    var WSKEYS = ["osap-atak-pts", "osap-aoi", "osap-routes", "osap-evac-plans", "osap-cp-pace", "osap-cp-power", "osap-epe-plans", "osap-epe-pkgs", "asap-watches", "osap-work", "osap-shapes", "osap-viewsheds",
      "osap-cp-checks", "osap-cp-traffic", "osap-cp-intf", "osap-cp-loadout", "osap-cp-chan", "osap-cp-comsec", "osap-cp-contacts", "osap-cp-sats", "osap-an-ent", "osap-an-links"];
    var AREA = /^asap-area-[a-z]{2,3}(-st)?$/;
    function synced(k) { return (W.OSAP_WS && W.OSAP_WS.scoped ? W.OSAP_WS.scoped(k) : WSKEYS.indexOf(k) >= 0 || AREA.test(k)) && NOSYNC.indexOf(k) < 0; }
    function reg() { var r = json(raw("osap-ws"), null); return r && Array.isArray(r.list) && r.list.length ? r : null; }
    function liveStores() { var o = {}; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && synced(k)) { var v = raw(k); if (v != null) o[k] = v; } } } catch (e) {} return o; }
    function blob(id) { var d = json(raw("osap-ws-data-" + id), null); return d && plain(d.keys) ? d.keys : {}; }
    function storesOf(r) { return function (id) { return id === r.active ? overlay(liveStores()) : blob(id); }; }
    /* writes waiting for the next page load count as already here */
    function pending() { var p = json(raw(PEND), null); return p && plain(p.keys) ? p : null; }
    function overlay(S) {
      var p = pending(), r = reg(); if (!p || !r || p.ws !== r.active) return S;
      Object.keys(p.keys).forEach(function (k) { var x = p.keys[k]; if (!plain(x) || (S[k] == null ? "" : fp(S[k])) !== x.b) return; if (x.v == null) delete S[k]; else S[k] = x.v; });
      return S;
    }
    function localSig() { var r = reg(); if (!r) return ""; var S = liveStores(); return fp(canon([r.list.map(function (w) { return [w.id, w.name]; }), r.active, Object.keys(S).sort().map(function (k) { return [k, S[k]]; })])); }

    /* a joining device's workspace takes the id of the other device's workspace of the same name, so "Default" meets "Default" */
    function adopt(r, R) {
      var names = {}, have = {}, changed = false;
      r.list.forEach(function (w) { have[w.id] = 1; });
      Object.keys(R).forEach(function (uk) { if (uk.slice(0, 2) === "W|" && !R[uk].d && plain(R[uk].v)) names[String(R[uk].v.name).toLowerCase()] = uk.slice(2); });
      r.list.forEach(function (w) {
        var id = names[String(w.name).toLowerCase()];
        if (!id || id === w.id || have[id] || !/^ws-[a-z0-9]{4,40}$/.test(id)) return;
        if (w.id !== r.active) { var b = raw("osap-ws-data-" + w.id); if (b != null) { put("osap-ws-data-" + id, b); del("osap-ws-data-" + w.id); } }
        else r.active = id;
        have[id] = 1; w.id = id; changed = true;
      });
      if (changed) put("osap-ws", JSON.stringify(r));
    }

    /* ---------- relays ---------- */
    function relayReq(url, K, sub) {
      return new Promise(function (res) {
        var got = [], ws, done = false, id = "s" + Math.random().toString(36).slice(2, 10);
        function end(ok) { if (done) return; done = true; clearTimeout(tm); try { ws.close(); } catch (e) {} res({ url: url, ok: ok, events: got }); }
        var tm = setTimeout(function () { end(got.length > 0); }, WAIT);
        try { ws = new WebSocket(url); } catch (e) { end(false); return; }
        ws.onopen = function () { ws.send(JSON.stringify(["REQ", id, sub])); };
        ws.onmessage = function (m) {
          var a; try { a = JSON.parse(m.data); } catch (e) { return; }
          if (!Array.isArray(a)) return;
          if (a[0] === "EVENT" && a[1] === id && plain(a[2]) && a[2].pubkey === K.pk && a[2].kind === 30078) got.push(a[2]);
          else if (a[0] === "EOSE" && a[1] === id) end(true);
          else if (a[0] === "CLOSED" && a[1] === id) end(false);
        };
        ws.onerror = function () { end(false); };
        ws.onclose = function () { end(got.length > 0); };
      });
    }
    function relayPub(url, evs) {
      return new Promise(function (res) {
        var ws, ok = 0, left = evs.length, done = false, why = "";
        function end() { if (done) return; done = true; clearTimeout(tm); try { ws.close(); } catch (e) {} res({ url: url, ok: ok, of: evs.length, why: why }); }
        var tm = setTimeout(end, WAIT + 3000);
        if (!left) { end(); return; }
        try { ws = new WebSocket(url); } catch (e) { end(); return; }
        ws.onopen = function () { evs.forEach(function (e) { ws.send(JSON.stringify(["EVENT", e])); }); };
        ws.onmessage = function (m) {
          var a; try { a = JSON.parse(m.data); } catch (e) { return; }
          if (Array.isArray(a) && a[0] === "OK") { if (a[2] === true) ok++; else why = String(a[3] || "").slice(0, 120); if (--left <= 0) end(); }
        };
        ws.onerror = ws.onclose = function () { end(); };
      });
    }
    function tagOf(e) { var t = (e.tags || []).filter(function (x) { return Array.isArray(x) && x[0] === "d"; })[0]; return t ? String(t[1]) : ""; }

    /* ---------- one sync ---------- */
    var busy = null, last = { at: 0, ok: false, msg: "", relays: 0, sent: 0, got: 0, devices: [] }, lastSig = "", sentAt = {}, devAt = 0;
    function syncNow(why) {
      if (busy) return busy;
      var c = cfg(); if (!c || !SUB) return Promise.resolve(last);
      var r0 = reg(); if (!r0 || r0.pending) return Promise.resolve(last);
      busy = run(c).then(function (x) { busy = null; render(); return x; }, function (e) {
        busy = null; last.ok = false; last.msg = "Sync failed: " + (e && e.message || e); last.at = Date.now(); render(); return last;
      });
      render();
      return busy;
    }
    function run(c) {
      var K, tags = [], devTag, st, R = {}, fetched = {}, now = Date.now(), reached = 0, devices = [];
      return keys(c.code).then(function (k) {
        K = k; var all = []; for (var i = 0; i < NB; i++) all.push(dtag(K, "bucket/" + i));
        all.push(dtag(K, "device/" + c.dev));
        return Promise.all(all);
      }).then(function (t) {
        devTag = t.pop(); tags = t;
        return Promise.all([loadState(), Promise.all(RELAYS.map(function (u) { return relayReq(u, K, { kinds: [30078], authors: [K.pk], limit: 200 }); }))]);
      }).then(function (x) {
        st = x[0];
        var newest = {};
        x[1].forEach(function (r) { if (r.ok) reached++; r.events.forEach(function (e) { var d = tagOf(e); if (!newest[d] || e.created_at > newest[d].created_at) newest[d] = e; }); });
        return Promise.all(Object.keys(newest).map(function (d) {
          return open(K, d, newest[d].content).then(function (p) {
            if (!plain(p)) return;
            if (p.type === "bucket" && tags.indexOf(d) >= 0) { fetched[d] = fp(canon(p.u || {})); var S = trusted(fromBucket(p.u)); Object.keys(S).forEach(function (uk) { if (newer(S[uk], R[uk])) R[uk] = S[uk]; }); }
            else if (p.type === "device" && d !== devTag && typeof p.name === "string") devices.push({ name: p.name.slice(0, 60), at: +p.at || 0 });
          });
        }));
      }).then(function () {
        if (!reached) throw new Error("could not reach any relay. Check the connection; OSAP will try again.");
        var r = reg(); if (!r) throw new Error("no workspaces yet");
        if (st.first) adopt(r, R);
        r = reg();
        var L = unitsOf(r.list, storesOf(r), synced), S = stamp(L, st.O, st.M, now, st.first && !c.made);
        var M = merge([st.M, S, R], now);
        /* a workspace open here that another device deleted stays, and comes back on the other device */
        var back = false;
        r.list.forEach(function (w) {
          var uk = "W|" + w.id;
          if (w.id === r.active && M[uk] && M[uk].d) { back = true; Object.keys(S).forEach(function (k) { if ((k === uk || k.indexOf("S|" + w.id + "|") === 0) && !S[k].d) M[k] = { t: now + 1, h: S[k].h, v: S[k].v }; }); }
        });
        var changes = writeBack(r, M);
        st.M = M; st.first = false; st.O = {};
        Object.keys(S).forEach(function (uk) { if (!S[uk].d) st.O[uk] = { t: S[uk].t, h: S[uk].h }; });
        /* publish the buckets the relays do not already hold, and this device's name */
        var B = buckets(M), out = [], at = Math.floor(now / 1000), sizes = 0, big = 0;
        return Promise.all(B.map(function (b, i) {
          if (fetched[tags[i]] === fp(canon(b)) || (!Object.keys(b).length && !(tags[i] in fetched))) return null;
          return seal(K, tags[i], { type: "bucket", v: 1, u: b }).then(function (s) { if (s.length > MAX_EVENT) { big++; return null; } sizes += s.length; return event(K, tags[i], s, Math.max(at, (sentAt[tags[i]] || 0) + 1)); });
        })).then(function (evs) {
          out = evs.filter(Boolean);
          if (!out.length && now - devAt < 600000) return null;
          var mine = Object.keys(M).filter(function (uk) { return uk[0] === "S" && !M[uk].d; }).length;
          return seal(K, devTag, { type: "device", name: c.name || devName(), at: now, n: mine }).then(function (s) { return event(K, devTag, s, at); });
        }).then(function (dev) {
          if (dev) { out.push(dev); devAt = now; }
          return Promise.all(RELAYS.map(function (u) { return relayPub(u, out); }));
        }).then(function (res) {
          var okRelays = out.length ? res.filter(function (x) { return x.ok >= out.length; }).length : reached;
          out.forEach(function (e) { sentAt[tagOf(e)] = e.created_at; });
          return saveState(st).then(function () {
            last = { at: Date.now(), ok: okRelays > 0, relays: okRelays, of: RELAYS.length, sent: out.length, got: Object.keys(R).length, devices: devices.sort(function (a, b) { return b.at - a.at; }), changes: changes, big: big,
              msg: okRelays ? "" : "The relays did not take this device's changes" + (res[0] && res[0].why ? " (" + res[0].why + ")" : "") + ". OSAP will try again." };
            if (back) toast("A workspace deleted on another device is open here, so it was kept");
            lastSig = localSig();
            var cfgNow = cfg(); if (cfgNow) { cfgNow.last = last.at; put(CFG, JSON.stringify(cfgNow)); }
            if (changes.live) offerReload(changes);
            else if (changes.other) toast("Synced " + changes.other + " change" + (changes.other > 1 ? "s" : "") + " to other workspaces");
            return last;
          });
        });
      });
    }
    /* merged state into this device: other workspaces now, the open one at the next load */
    function writeBack(r, M) {
      var ch = { live: 0, other: 0, ws: 0 }, ids = {}, list = r.list.slice(), regChanged = false;
      Object.keys(M).forEach(function (uk) { if (uk.slice(0, 2) === "W|") ids[uk.slice(2)] = M[uk]; });
      /* the register: new, renamed and deleted workspaces */
      Object.keys(ids).forEach(function (id) {
        var m = ids[id], w = null; list.forEach(function (x) { if (x.id === id) w = x; });
        if (!/^ws-[a-z0-9]{4,40}$/.test(id)) return;
        if (m.d) { if (w && id !== r.active) { list = list.filter(function (x) { return x.id !== id; }); del("osap-ws-data-" + id); regChanged = true; ch.ws++; } return; }
        var name = plain(m.v) && typeof m.v.name === "string" ? m.v.name.slice(0, 60) : "Workspace";
        if (!w) { list.push({ id: id, name: name, created: +m.v.created || Date.now(), updated: Date.now() }); regChanged = true; ch.ws++; }
        else if (w.name !== name) { w.name = name; regChanged = true; ch.ws++; }
      });
      if (regChanged && list.length) { var r2 = json(raw("osap-ws"), r); r2.list = list; if (!list.some(function (x) { return x.id === r2.active; })) r2.active = r.active; put("osap-ws", JSON.stringify(r2)); }
      /* each workspace's stores */
      var keysP = {};
      list.forEach(function (w) {
        /* the open workspace is compared with what is really stored now (base), not with writes still waiting */
        var live = w.id === r.active, base = live ? liveStores() : blob(w.id), here = live ? overlay(liveStores()) : base, want = storesFrom(M, w.id, here), out = {}, diff = 0;
        Object.keys(base).forEach(function (k) { if (!synced(k)) out[k] = base[k]; });
        Object.keys(want).forEach(function (k) { out[k] = want[k]; });
        var all = {}; Object.keys(base).concat(Object.keys(out)).forEach(function (k) { all[k] = 1; });
        Object.keys(all).forEach(function (k) {
          if (!synced(k)) return;
          var a = base[k] == null ? null : split(base[k]), b = out[k] == null ? null : split(out[k]);
          if (canon(a) === canon(b)) { if (base[k] != null) out[k] = base[k]; else delete out[k]; return; }
          diff++;
          if (live) { var cur = raw(k); keysP[k] = { v: out[k] == null ? null : out[k], b: cur == null ? "" : fp(cur) }; }
        });
        if (!diff) return;
        if (live) ch.live += diff;
        else if (put("osap-ws-data-" + w.id, JSON.stringify({ v: 1, keys: out }))) ch.other += diff;
      });
      if (Object.keys(keysP).length) put(PEND, JSON.stringify({ at: Date.now(), ws: r.active, keys: keysP }));
      else del(PEND);
      return ch;
    }

    /* ---------- bringing the open workspace's changes in: reload now when that will not get in the way ---------- */
    var shownAt = Date.now();
    function quiet() {
      var a = D.activeElement, tag = a && a.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a && a.isContentEditable)) return false;
      return !D.querySelector('[role="dialog"]:not([hidden]):not(#syncdlg)');
    }
    function offerReload(ch) {
      var lastAuto = 0; try { lastAuto = +(sessionStorage.getItem(AUTO) || 0); } catch (e) {}
      if (Date.now() - shownAt < 20000 && quiet() && Date.now() - lastAuto > 120000 && D.visibilityState === "visible") {
        try { sessionStorage.setItem(AUTO, String(Date.now())); sessionStorage.setItem(MSG, "Brought in " + ch.live + " change" + (ch.live > 1 ? "s" : "") + " from your other device"); } catch (e) {}
        W.location.reload(); return;
      }
      bar(ch.live);
    }
    function bar(n) {
      var b = D.getElementById("syncbar");
      if (!b) { b = D.createElement("div"); b.id = "syncbar"; b.setAttribute("role", "status"); D.body.appendChild(b); }
      b.innerHTML = '<span>' + n + " change" + (n > 1 ? "s" : "") + ' from your other device</span><button type="button" data-sy-reload>Show them</button><button type="button" class="x" aria-label="Later" data-sy-later>&times;</button>';
      b.hidden = false;
    }

    /* ---------- when to sync ---------- */
    var timer = null, poll = null;
    function soon(ms, why) { clearTimeout(timer); timer = setTimeout(function () { syncNow(why); }, ms); }
    function start() {
      if (!cfg() || poll) return;
      soon(2500, "open");
      poll = setInterval(function () {
        if (D.visibilityState !== "visible" || busy) return;
        if (localSig() !== lastSig) soon(1500, "change");
        else if (Date.now() - last.at > 60000) soon(0, "poll");
      }, 10000);
    }
    function stop() { clearInterval(poll); poll = null; clearTimeout(timer); }
    D.addEventListener("visibilitychange", function () {
      if (!cfg()) return;
      if (D.visibilityState === "visible") { shownAt = Date.now(); soon(800, "back"); }
      else if (localSig() !== lastSig) syncNow("hide");
    });

    /* ---------- pairing ---------- */
    function pair(code, first) {
      var c = cleanCode(code); if (!c) return Promise.reject(new Error("That is not a sync code. Check it and type it again."));
      var dev = core.hex(rand(8));
      put(CFG, JSON.stringify({ v: 1, code: c, dev: dev, name: devName(), since: Date.now(), made: !!first }));
      return dropState().then(function () { last = { at: 0, ok: false, msg: "", devices: [] }; lastSig = ""; start(); return syncNow("pair"); });
    }
    function off() { stop(); del(CFG); del(PEND); return dropState().then(function () { last = { at: 0, ok: false, msg: "", devices: [] }; render(); }); }

    /* ---------- the panel ---------- */
    var box = D.createElement("div"); box.id = "syncdlg"; box.hidden = true;
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "sync-h");
    D.body.appendChild(box);
    var UI = { msg: "", show: false, join: false, made: "" };
    function openP() { UI.msg = ""; UI.show = false; UI.join = false; UI.made = ""; box.hidden = false; render(); if (cfg() && !busy && Date.now() - last.at > 15000) syncNow("panel"); }
    function closeP() { box.hidden = true; UI.made = ""; UI.show = false; }
    function render() {
      if (box.hidden) return;
      var c = cfg(), h;
      if (!c) {
        h = UI.made ? '<p class="mvok">Your sync code:</p><p class="sycode" data-sy-code>' + esc(showCode(UI.made)) + "</p>" +
            '<div class="mvbtns"><button type="button" data-sy-copy>Copy code</button></div>' +
            "<p>On your other device, open Settings &gt; Sync my devices, choose <b>I have a code</b> and type it. Keep this code private: anyone who has it can read your synced data.</p>" +
            '<div class="mvbtns"><button type="button" class="refresh" data-sy-go>Turn on sync on this device</button><button type="button" data-sy-cancel>Cancel</button></div>'
          : UI.join ? '<label class="mvf">Sync code from your other device<input data-sy-in autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label>' +
            "<p class=\"obs\">What is saved here is kept and joined with what your other device has. Where the same item was changed on both, the other device's version is kept.</p>" +
            '<div class="mvbtns"><button type="button" class="refresh" data-sy-join>Start syncing</button><button type="button" data-sy-cancel>Cancel</button></div>'
          : "<p>Keep your saved points, areas, routes, shapes, watches, plans and workspaces the same on your phone and computer. No account: a sync code you type once links your devices.</p>" +
            '<div class="mvbtns"><button type="button" class="refresh" data-sy-new>Start on this device</button><button type="button" data-sy-havecode>I have a code</button></div>';
      } else {
        var state = busy ? "Syncing…" : !last.at ? "Waiting to sync…" : last.ok ? "Synced " + ago(last.at) + " (" + when(last.at) + ")." : last.msg || "Not synced yet.";
        var devs = (last.devices || []).map(function (d) { return "<li>" + esc(d.name) + ", seen " + esc(ago(d.at)) + "</li>"; }).join("");
        h = '<p class="mvok">Sync is on for this device (' + esc(c.name || devName()) + ").</p>" +
          '<p class="mvmsg" role="status">' + esc(state) + (last.ok && last.relays < last.of ? " " + last.relays + " of " + last.of + " relays answered." : "") + (last.big ? " Some items are too large to sync." : "") + "</p>" +
          (devs ? "<p>Other devices on this code:</p><ul>" + devs + "</ul>" : last.ok ? '<p class="obs">No other device has synced with this code yet.</p>' : "") +
          '<div class="mvbtns"><button type="button" class="refresh" data-sy-now' + (busy ? " disabled" : "") + '>Sync now</button><button type="button" data-sy-show>' + (UI.show ? "Hide code" : "Show code to add a device") + "</button></div>" +
          (UI.show ? '<p class="sycode" data-sy-code>' + esc(showCode(c.code)) + '</p><div class="mvbtns"><button type="button" data-sy-copy>Copy code</button></div>' : "") +
          '<p><button type="button" class="mvlink" data-sy-off>Turn off sync on this device</button></p>';
      }
      box.innerHTML = '<div class="cbox"><div class="chead"><h2 id="sync-h">Sync my devices</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
        (UI.msg ? '<p class="mvwarn" role="alert">' + esc(UI.msg) + "</p>" : "") + h +
        '<details class="mvnote"><summary>What syncs, and how it is protected</summary>' +
        "<p>Syncs: every workspace with its map points, drawn areas, NAI/TAI, routes, imported shapes, viewsheds, keyword watches, saved reports and notes, and medical, evacuation and comms plans. Each item is merged on its own, and the newest change wins. Deleted items stay deleted.</p>" +
        "<p>Stays on each device: photos, map and device settings, offline maps, and the hidden areas.</p>" +
        "<p>Your data is locked with AES-256-GCM before it leaves the device, using a key made from the sync code, and passed through free public Nostr relays. The relays see scrambled data, its size, when it changes and the device's internet address, but cannot read or change it. The relays promise nothing, so keep a backup with Move to another device.</p></details></div>";
    }
    function say(t) { UI.msg = t; render(); }
    function copy(t) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast("Sync code copied"); }, function () {}); }
    box.addEventListener("click", function (e) {
      var t = e.target;
      if (t === box || t.closest(".x")) { closeP(); return; }
      if (t.closest("[data-sy-new]")) { UI.made = newCode(); UI.msg = ""; render(); return; }
      if (t.closest("[data-sy-havecode]")) { UI.join = true; UI.msg = ""; render(); var i = box.querySelector("[data-sy-in]"); if (i) i.focus(); return; }
      if (t.closest("[data-sy-cancel]")) { UI.made = ""; UI.join = false; UI.msg = ""; render(); return; }
      if (t.closest("[data-sy-go]") && UI.made) { var m = UI.made; UI.made = ""; pair(m, true); render(); return; }
      if (t.closest("[data-sy-join]")) {
        var v = box.querySelector("[data-sy-in]").value;
        if (!cleanCode(v)) { say("That is not a sync code. Check it against your other device and type it again."); return; }
        UI.join = false; UI.msg = ""; pair(v, false); render(); return;
      }
      if (t.closest("[data-sy-copy]")) { var cc = UI.made || (cfg() && cfg().code); if (cc) copy(showCode(cc)); return; }
      if (t.closest("[data-sy-show]")) { UI.show = !UI.show; render(); return; }
      if (t.closest("[data-sy-now]")) { syncNow("button"); return; }
      if (t.closest("[data-sy-off]")) {
        if (!confirm("Turn off sync on this device? What is saved here stays. To sync again, type the code from your other device.")) return;
        off(); return;
      }
    });
    D.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("#syncbar"); if (!b) return;
      if (e.target.closest("[data-sy-reload]")) { try { sessionStorage.setItem(MSG, "Brought in the changes from your other device"); } catch (x) {} W.location.reload(); }
      else if (e.target.closest("[data-sy-later]")) b.hidden = true;
    });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) closeP(); });
    var css = D.createElement("style");
    css.textContent = "#syncdlg{position:fixed;inset:0;z-index:100002;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
      "#syncdlg .cbox{max-width:560px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
      "#syncdlg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#syncdlg .chead h2{margin:0;font-size:18px;flex:1}" +
      "#syncdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#syncdlg .obs{color:var(--muted)}" +
      "#syncdlg .mvf{display:flex;flex-direction:column;gap:3px;margin:8px 0;font-weight:600}#syncdlg .mvf input{font:inherit;font-size:16px;font-weight:400;min-height:40px;padding:4px 8px;max-width:100%;box-sizing:border-box;letter-spacing:1px;text-transform:uppercase}" +
      "#syncdlg .mvbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}#syncdlg .mvbtns>*{min-height:38px}" +
      "#syncdlg .mvmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}#syncdlg .mvok{border-left:3px solid #2f9e44;padding:2px 10px}" +
      "#syncdlg .mvwarn{border-left:3px solid #e8590c;padding:2px 10px}#syncdlg .mvlink{background:none;border:none;color:#1c7ed6;text-decoration:underline;cursor:pointer;font:inherit;padding:0;min-height:32px}" +
      "#syncdlg .sycode{font:600 22px/1.3 ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px;word-break:break-all;background:var(--surface2);border-radius:6px;padding:10px 12px;margin:6px 0;user-select:all}" +
      "#syncdlg .mvnote summary{cursor:pointer;font-weight:600;padding:6px 0}#syncdlg ul{margin:4px 0 8px 18px;padding:0}" +
      "#syncbar{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:100001;display:flex;align-items:center;gap:8px;background:var(--ink);color:var(--surface);padding:6px 6px 6px 14px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:calc(100vw - 32px)}" +
      "#syncbar button{min-height:36px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;padding:0 10px;cursor:pointer}#syncbar .x{background:none;border:none;color:var(--surface);font-size:20px;min-width:36px}";
    D.head.appendChild(css);

    /* the line saying what a reload brought in, shown once */
    try {
      var said = sessionStorage.getItem(MSG);
      if (said) { sessionStorage.removeItem(MSG); W.addEventListener("load", function () { setTimeout(function () { toast(said); }, 700); }); }
    } catch (e) {}

    W.OSAP_SYNC = { open: openP, close: closeP, now: syncNow, status: function () { return { on: !!cfg(), busy: !!busy, last: last, pending: pending() }; }, pair: pair, start: start, off: off, core: core };
    start();
  }

  return { core: core, boot: boot };
});
