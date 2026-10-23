/* AXIOM OSAP: the sealing for team shared cases (tools/case_vault.mjs says what the server keeps and checks). All of it runs on
   the device with the browser's Web Crypto; the server only ever sees public keys, wrapped keys and sealed bytes.
   - Device key: ECDH P-256, made once per device. The private key is not extractable (kept as a CryptoKey in IndexedDB by
     assets/osap-cases.js); the public key goes to the server as 65 raw bytes in base64url (87 characters).
   - Case key: 32 random bytes per case epoch.
   - Wrap: a fresh ECDH P-256 key with the member device's public key, HKDF-SHA-256 (salt = the fresh public key, info = the
     context below) to an AES-256-GCM key, which seals the case key. Out: fresh public key | IV | sealed case key, base64url.
   - Seal: the value as JSON, gzipped, then AES-256-GCM with the case key, a random 12-byte IV, and the context as associated data, so a bucket cannot be moved
     to another case, epoch or bucket slot without failing to open. Out: IV | sealed bytes, base64.
   Contexts: "osap-case-wrap/1|<case>|<epoch>|<device>" and "osap-case-bucket/1|<case>|<epoch>|<bucket>".
   window.OSAP_CASE_CRYPTO, or module.exports in node: { newDevice, pubOf, newCaseKey, wrap, unwrap, seal, open }. */
(function (G, factory) {
  var api = factory(G.crypto || (typeof require === "function" ? require("node:crypto").webcrypto : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else G.OSAP_CASE_CRYPTO = api;
})(typeof window !== "undefined" ? window : globalThis, function (CR) {
  "use strict";
  var SUB = CR.subtle, te = new TextEncoder(), td = new TextDecoder("utf-8", { fatal: true });
  var EC = { name: "ECDH", namedCurve: "P-256" };
  var MAX_OPEN = 8000000, FMT_GZ = 1;

  function cat(a) { var n = 0, p = 0, o; a.forEach(function (x) { n += x.length; }); o = new Uint8Array(n); a.forEach(function (x) { o.set(x, p); p += x.length; }); return o; }
  function b64(u) { var s = ""; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
  function unb64(s) { var r = atob(s), u = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; }
  function b64u(u) { return b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad");
    s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    return unb64(s);
  }
  function rand(n) { var u = new Uint8Array(n); CR.getRandomValues(u); return u; }
  function wrapInfo(caseId, epoch, dev) { return te.encode("osap-case-wrap/1|" + caseId + "|" + epoch + "|" + dev); }
  function bucketInfo(caseId, epoch, b) { return te.encode("osap-case-bucket/1|" + caseId + "|" + epoch + "|" + b); }

  /* a device key pair; the private key cannot be exported */
  function newDevice() { return SUB.generateKey(EC, false, ["deriveBits"]); }
  function pubOf(pair) { return SUB.exportKey("raw", pair.publicKey).then(function (b) { return b64u(new Uint8Array(b)); }); }
  function newCaseKey() { return rand(32); }

  function kek(priv, pubRaw, salt, info) {
    return SUB.importKey("raw", pubRaw, EC, false, []).then(function (pub) {
      return SUB.deriveBits({ name: "ECDH", public: pub }, priv, 256);
    }).then(function (bits) {
      return SUB.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    }).then(function (ikm) {
      return SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt, info: info }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  /* the case key, sealed for one member device */
  function wrap(caseKey, devPubB64u, caseId, epoch, dev) {
    var info = wrapInfo(caseId, epoch, dev), recip = unb64u(devPubB64u), iv = rand(12), ephPub;
    if (recip.length !== 65 || caseKey.length !== 32) return Promise.reject(new Error("bad key"));
    return SUB.generateKey(EC, false, ["deriveBits"]).then(function (eph) {
      return SUB.exportKey("raw", eph.publicKey).then(function (b) { ephPub = new Uint8Array(b); return kek(eph.privateKey, recip, ephPub, info); });
    }).then(function (k) {
      return SUB.encrypt({ name: "AES-GCM", iv: iv, additionalData: info }, k, caseKey);
    }).then(function (ct) { return b64u(cat([ephPub, iv, new Uint8Array(ct)])); });
  }
  function unwrap(w, devPriv, caseId, epoch, dev) {
    var u = unb64u(w), info = wrapInfo(caseId, epoch, dev);
    if (u.length !== 65 + 12 + 48) return Promise.reject(new Error("bad wrap"));
    var ephPub = u.subarray(0, 65), iv = u.subarray(65, 77), ct = u.subarray(77);
    return kek(devPriv, ephPub, ephPub, info).then(function (k) {
      return SUB.decrypt({ name: "AES-GCM", iv: iv, additionalData: info }, k, ct);
    }).then(function (b) { return new Uint8Array(b); });
  }
  function gzip(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  /* unzips, stopping past "cap" bytes, so a small sealed bucket cannot unpack into a huge one */
  function gunzip(u8, cap) {
    var rd = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(), parts = [], n = 0;
    function step() {
      return rd.read().then(function (r) {
        if (r.done) return cat(parts);
        n += r.value.length; if (n > cap) { rd.cancel(); throw new Error("too large"); }
        parts.push(r.value); return step();
      });
    }
    return step();
  }
  /* one bucket of case content: any JSON value, gzipped and sealed with the case key */
  function seal(caseKey, caseId, epoch, bucket, value) {
    var iv = rand(12), info = bucketInfo(caseId, epoch, bucket), key;
    return SUB.importKey("raw", caseKey, { name: "AES-GCM" }, false, ["encrypt"]).then(function (k) {
      key = k; return gzip(te.encode(JSON.stringify(value)));
    }).then(function (gz) {
      return SUB.encrypt({ name: "AES-GCM", iv: iv, additionalData: info }, key, cat([new Uint8Array([FMT_GZ]), gz]));
    }).then(function (ct) { return b64(cat([iv, new Uint8Array(ct)])); });
  }
  function open(caseKey, caseId, epoch, bucket, data) {
    if (typeof data !== "string" || data.length > 300000) return Promise.reject(new Error("too large"));
    var u = unb64(data), info = bucketInfo(caseId, epoch, bucket);
    if (u.length < 12 + 16 + 1) return Promise.reject(new Error("bad bucket"));
    return SUB.importKey("raw", caseKey, { name: "AES-GCM" }, false, ["decrypt"]).then(function (k) {
      return SUB.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12), additionalData: info }, k, u.subarray(12));
    }).then(function (b) {
      b = new Uint8Array(b);
      if (b[0] !== FMT_GZ) throw new Error("unknown format");
      return gunzip(b.subarray(1), MAX_OPEN);
    }).then(function (pt) { return JSON.parse(td.decode(pt)); });
  }
  return { newDevice: newDevice, pubOf: pubOf, newCaseKey: newCaseKey, wrap: wrap, unwrap: unwrap, seal: seal, open: open, b64u: b64u, unb64u: unb64u };
});
