// OSAP's own push notifications (tools/webpush.mjs, netlify/functions/osap-webpush.mjs, tools/push_lib.mjs validate).
// 1. Only a browser maker's push service is accepted as an endpoint (no address someone typed: no SSRF from OSAP's server).
// 2. A message encrypted for a device decrypts with that device's keys (RFC 8291), and the VAPID token verifies (RFC 8292).
// 3. The function: anyone reads the public key (made once, the same on every call); only this repository's main-branch job
//    sends; a withdrawn subscription is reported gone; nothing else is accepted.
// Run from the repo root: node tests/webpush.test.mjs
import { endpointOk, subOk, genVapid, vapidAuth, encrypt, b64u, unb64u } from "../tools/webpush.mjs";
import { validate } from "../tools/push_lib.mjs";
import { memoryStore } from "./codes_store.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const te = new TextEncoder(), td = new TextDecoder();

// ---------- 1. endpoints ----------
ok(endpointOk("https://fcm.googleapis.com/fcm/send/abc:def"), "Chrome's push service (FCM) is accepted");
ok(endpointOk("https://web.push.apple.com/QGx1Y2t5"), "Safari's push service is accepted");
ok(endpointOk("https://updates.push.services.mozilla.com/wpush/v2/gAAA"), "Firefox's push service is accepted");
ok(endpointOk("https://wns2-par02p.notify.windows.com/w/?token=x"), "Windows' push service is accepted");
ok(!endpointOk("http://fcm.googleapis.com/fcm/send/x"), "plain http is refused");
ok(!endpointOk("https://evil.example/fcm.googleapis.com"), "any other host is refused");
ok(!endpointOk("https://fcm.googleapis.com.evil.example/x"), "a look-alike host is refused");
ok(!endpointOk("https://169.254.169.254/latest"), "an internal address is refused");
ok(!endpointOk("https://fcm.googleapis.com:8443/x"), "another port is refused");
ok(!endpointOk("https://user@fcm.googleapis.com/x"), "an address with a user name is refused");

// a real device key pair, as a browser makes it
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)), authS = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/test123", keys: { p256dh: b64u(uaPub), auth: b64u(authS) }, expirationTime: null };
ok(!!subOk(sub) && !("expirationTime" in subOk(sub)), "a browser's subscription checks and is cut to what sending needs");
ok(!subOk({ ...sub, keys: { p256dh: "short", auth: sub.keys.auth } }), "a broken device key is refused");
ok(!subOk({ ...sub, endpoint: "https://example.com/x" }), "a subscription to another host is refused");

// ---------- 2. encryption and VAPID ----------
async function hk(salt, ikm, info, n) { const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, n * 8)); }
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
/* the device's side of RFC 8291 */
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hk(authS, ecdh, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const p = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, ct));
  return { text: td.decode(p.slice(0, p.length - 1)), last: p[p.length - 1], rs: new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0) };
}
const enc = await encrypt('{"t":"FLASH · test"}', sub);
const dec = await decrypt(enc);
ok(dec.text === '{"t":"FLASH · test"}' && dec.last === 2 && dec.rs === 4096, "the device decrypts exactly what was sent (aes128gcm, one record)");
const enc2 = await encrypt('{"t":"FLASH · test"}', sub);
ok(b64u(enc) !== b64u(enc2), "the same alert encrypts differently each time (fresh salt and key)");
const other = { ...sub, keys: { ...sub.keys, auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
ok(await decrypt(await encrypt("x", other)).then(() => false, () => true), "a message for another device's secret does not decrypt here");

const V = await genVapid();
ok(unb64u(V.pub).length === 65 && V.priv.d, "a VAPID key pair: a 65-byte public point and a private JWK");
const hdr = await vapidAuth(sub.endpoint, V, Date.UTC(2026, 10, 8));
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(hdr);
const claims = m && JSON.parse(td.decode(unb64u(m[2])));
const vk = await crypto.subtle.importKey("raw", unb64u(V.pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
ok(!!m && m[4] === V.pub && claims.aud === "https://fcm.googleapis.com" && claims.exp === Date.UTC(2026, 10, 8) / 1000 + 43200 && /^mailto:/.test(claims.sub), "the VAPID token names the push service's origin, 12 hours, a contact");
ok(!!m && await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk, unb64u(m[3]), te.encode(m[1] + "." + m[2])), "the VAPID token verifies with OSAP's public key");

// ---------- 3. the function ----------
globalThis.Netlify = { env: { get: () => "" } };
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pj = await crypto.subtle.exportKey("jwk", kp.publicKey), JWKS = { keys: [{ kty: "RSA", kid: "k1", n: pj.n, e: pj.e, alg: "RS256" }] };
async function token(over = {}) {
  const now = Math.floor(Date.now() / 1000), bu = (o) => b64u(te.encode(JSON.stringify(o)));
  const data = bu({ alg: "RS256", kid: "k1", typ: "JWT" }) + "." + bu({ iss: "https://token.actions.githubusercontent.com", aud: "osap-push", repository: "01shane89-jpg/AXIOM-APSAP", ref: "refs/heads/main", iat: now, nbf: now, exp: now + 300, ...over });
  return data + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, te.encode(data)));
}
const store = memoryStore(), calls = [];
const fakePush = async (u, o) => { calls.push({ u, o }); return new Response("", { status: /gone/.test(u) ? 410 : 201 }); };
const F = await import("../netlify/functions/osap-webpush.mjs");
F._test(store, async () => JWKS, fakePush);
const get = async () => (await F.default(new Request("https://x/api/osap-webpush"))).json();
const k1 = (await get()).key, k2 = (await get()).key;
ok(unb64u(k1).length === 65 && k1 === k2, "the public key is made once and the same on every call");
const post = async (body, headers) => F.default(new Request("https://x/api/osap-webpush", { method: "POST", headers, body: JSON.stringify(body) }));
const SENDS = { sends: [{ sub, msg: { title: "FLASH · Test", body: "First report.", url: "https://axiom-osap.netlify.app/#jp/timeline", flash: true } }, { sub: { ...sub, endpoint: "https://fcm.googleapis.com/fcm/send/gone1" }, msg: { title: "x" } }, { sub: { ...sub, endpoint: "https://evil.example/x" }, msg: { title: "x" } }] };
ok((await post(SENDS, {})).status === 401, "no token: nothing is sent");
ok((await post(SENDS, { authorization: "Bearer " + (await token()) })).status === 401, "a token without the push check's caller mark: nothing is sent");
ok((await post(SENDS, { authorization: "Bearer " + (await token({ ref: "refs/heads/claude/x" })), "x-osap-caller": "actions" })).status === 403, "a feature branch's job cannot send");
ok((await post(SENDS, { authorization: "Bearer " + (await token({ repository: "someone/else" })), "x-osap-caller": "actions" })).status === 403, "another repository's job cannot send");
ok(!calls.length, "refused calls reached no push service");
const r = await post(SENDS, { authorization: "Bearer " + (await token()), "x-osap-caller": "actions" });
const res = (await r.json()).results;
ok(r.status === 200 && res[0].ok && res[1].gone && !res[1].ok && res[2].gone && !res[2].ok, "main's job sends; a withdrawn subscription is gone; a bad endpoint is never asked");
ok(calls.length === 2 && calls.every((c) => /^https:\/\/fcm\.googleapis\.com\//.test(c.u)), "only the browser maker's push service was asked");
const c0 = calls[0].o, h0 = c0.headers;
ok(h0["content-encoding"] === "aes128gcm" && h0.urgency === "high" && /^vapid t=.+, k=/.test(h0.authorization) && h0.authorization.endsWith("k=" + k1), "sent with aes128gcm, high urgency for a flash, signed with OSAP's key");
const got = JSON.parse((await decrypt(new Uint8Array(c0.body))).text);
ok(got.t === "FLASH · Test" && got.f === 1 && got.u === "https://axiom-osap.netlify.app/#jp/timeline", "the device reads the alert's title, link and flash mark");

// ---------- 4. the push check's own check of a watch ----------
const base = { id: "wtest-1", cc: "jp", topic: "osap-0123456789abcdef01", minSev: 1 };
ok(validate({ ...base, wp: sub, ntfy: false }).watch.wp.endpoint === sub.endpoint && validate({ ...base, wp: sub, ntfy: false }).watch.ntfy === false, "a watch with a subscription keeps it, and can leave ntfy out");
ok(!!validate({ ...base, wp: { ...sub, endpoint: "https://evil.example/x" } }).error, "a watch with a subscription to another host does not check");
ok(validate({ ...base, ntfy: false }).watch.ntfy === undefined, "without a subscription, ntfy is always used");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
