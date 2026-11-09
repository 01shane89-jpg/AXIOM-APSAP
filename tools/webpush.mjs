// OSAP's own push notifications (standard Web Push: RFC 8030 delivery, RFC 8291 message encryption, RFC 8292 VAPID), with
// WebCrypto only, so the same code runs in a Netlify function and in Node 18+. No account, no key held by a person: the
// signing key pair is made once by netlify/functions/osap-webpush.mjs and kept in its private store.
// A subscription ({ endpoint, keys: { p256dh, auth } }) comes from the phone or browser that allowed OSAP's notifications;
// its endpoint is a URL at the browser maker's push service, so only those hosts are accepted (endpointOk), never an
// address someone typed. Endpoints and keys are capability secrets: never logged.
const te = new TextEncoder();
export const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

// the browser makers' push services (Chrome/Edge/Opera/Samsung via FCM, Firefox, Safari on iPhone/iPad/Mac, Windows)
const HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function endpointOk(u) {
  let url; try { url = new URL(String(u || "")); } catch (e) { return false; }
  return url.protocol === "https:" && !url.port && !url.username && !url.password && String(u).length <= 600 && HOSTS.some((h) => h.test(url.hostname));
}
/* a subscription as the page sends it, checked and cut down to what sending needs; null when it does not check */
export function subOk(s) {
  if (!s || typeof s !== "object" || !endpointOk(s.endpoint)) return null;
  const k = s.keys || {}, p = String(k.p256dh || ""), a = String(k.auth || "");
  if (!/^[A-Za-z0-9_-]{86,88}$/.test(p) || !/^[A-Za-z0-9_-]{21,24}$/.test(a)) return null;
  try { if (unb64u(p).length !== 65 || unb64u(p)[0] !== 4 || unb64u(a).length !== 16) return null; } catch (e) { return null; }
  return { endpoint: String(s.endpoint), keys: { p256dh: p, auth: a } };
}

/* a new VAPID key pair: { pub: base64url of the 65-byte public point (the page's applicationServerKey), priv: JWK } */
export async function genVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), priv: await crypto.subtle.exportKey("jwk", kp.privateKey) };
}
/* the Authorization header for one push service (RFC 8292): a 12-hour ES256 token for the endpoint's origin */
export async function vapidAuth(endpoint, vapid, now = Date.now(), sub = "mailto:support@axiom-intelligence-systems.com") {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub })));
  const key = await crypto.subtle.importKey("jwk", { ...vapid.priv, key_ops: ["sign"], ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.pub}`;
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}
/* RFC 8291 aes128gcm: the body to POST to the endpoint, in one record */
export async function encrypt(payload, sub, opts = {}) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = opts.asKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(te.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const plain = cat(typeof payload === "string" ? te.encode(payload) : payload, new Uint8Array([2]));
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, plain));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([65]), asPub, ct);
}
/* send one notification. msg: { title, body, url, tag, flash }; returns { ok, status, gone } (gone: the browser
   withdrew the subscription, 404/410, so it should be dropped) */
export async function sendPush(sub, msg, vapid, { fetchImpl = fetch, ttl = 86400 } = {}) {
  const s = subOk(sub); if (!s) return { ok: false, status: 0, gone: true };
  const payload = JSON.stringify({ t: String(msg.title || "").slice(0, 120), b: String(msg.body || "").slice(0, 700), u: String(msg.url || "").slice(0, 600), g: String(msg.tag || "").slice(0, 64), f: msg.flash ? 1 : 0 });
  const body = await encrypt(payload, s);
  const r = await fetchImpl(s.endpoint, { method: "POST", body, signal: AbortSignal.timeout(10000), headers: {
    authorization: await vapidAuth(s.endpoint, vapid), "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
    ttl: String(ttl), urgency: msg.flash ? "high" : "normal" } });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
}
