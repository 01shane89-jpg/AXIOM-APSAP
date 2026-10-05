// Sealed files for hidden areas (assets/osap-lock.js, ADR in the "Hide US Data" thread).
// A sealed file is one JavaScript comment, so a page that loads it as a script runs nothing:
//   /*osap-sealed:v1 {"v":1,"z":"gzip","iv":"…","c":"…","r":[{"f":"…","e":"…","iv":"…","w":"…"}]}*/
// The content is gzipped, then encrypted with a fresh AES-256-GCM key. That key is wrapped once per owner: ECDH P-256 between a
// fresh key pair ("e", its public half) and the owner's public key, HKDF-SHA256 (salt = e, info "osap-seal v1"), AES-256-GCM.
// "f" names the owner key (the first 16 characters of the base64url SHA-256 of its SPKI). "h" is a hash of the file's path and
// plain content, so a job that rebuilds a file unchanged keeps the sealed copy it had instead of committing a new one (without it
// every run would rewrite the 45 MB of US infrastructure); it lets someone confirm an exact guess of a whole file, nothing more.
// Only an owner's private key, which
// lives on the owner's device behind Face ID or Windows Hello, opens it; the jobs that seal can never open what they sealed.
// The service worker (sw.js, unseal()) has the browser half of this.
import { gzipSync, gunzipSync } from "node:zlib";
const { subtle } = globalThis.crypto;
export const PREFIX = "/*osap-sealed:v1 ";
const enc = new TextEncoder();
export const b64u = (b) => Buffer.from(b).toString("base64url");
export const unb64u = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));
const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const ownerPub = (code) => String(code).replace(/^osap-pub:v1:/, "");
export async function fingerprint(pub) { return b64u(await subtle.digest("SHA-256", unb64u(ownerPub(pub)))).slice(0, 16); }
async function kek(priv, pub, salt) {
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const k = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("osap-seal v1") }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export const isSealed = (text) => String(text).startsWith(PREFIX);

export async function contentHash(path, data) {
  const plain = typeof data === "string" ? enc.encode(data) : data, head = enc.encode("osap-seal-h v1\n" + path + "\n");
  const all = new Uint8Array(head.length + plain.length); all.set(head); all.set(plain, head.length);
  return b64u(await subtle.digest("SHA-256", all)).slice(0, 22);
}
/** The envelope of a sealed text (no secrets in it), or null. */
export function envelope(text) {
  if (!isSealed(text)) return null;
  try { return JSON.parse(String(text).slice(PREFIX.length).replace(/\*\/\s*$/, "")); } catch (e) { return null; }
}

/** Seal bytes (or text) for the owners' public keys (setup codes or bare base64url SPKI); path names the file for "h". */
export async function seal(data, owners, path) {
  if (!owners || !owners.length) throw new Error("no owner keys to seal for");
  const plain = typeof data === "string" ? enc.encode(data) : data;
  const cek = rnd(32), iv = rnd(12);
  const ck = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const c = await subtle.encrypt({ name: "AES-GCM", iv }, ck, gzipSync(plain, { level: 9 }));
  const eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const e = new Uint8Array(await subtle.exportKey("spki", eph.publicKey));
  const r = [];
  for (const o of owners) {
    const pub = await subtle.importKey("spki", unb64u(ownerPub(o)), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const wiv = rnd(12), w = await subtle.encrypt({ name: "AES-GCM", iv: wiv }, await kek(eph.privateKey, pub, e), cek);
    r.push({ f: await fingerprint(o), e: b64u(e), iv: b64u(wiv), w: b64u(w) });
  }
  const env = { v: 1, z: "gzip", iv: b64u(iv), c: b64u(c), r };
  if (path) env.h = await contentHash(path, plain);
  return PREFIX + JSON.stringify(env) + "*/\n";
}

/** Open a sealed text with an owner's ECDH private key (a CryptoKey) and its public key; returns the bytes. Tests use this. */
export async function open(text, priv, pub) {
  if (!isSealed(text)) throw new Error("not sealed");
  const env = envelope(text);
  if (!env) throw new Error("unreadable seal");
  const f = await fingerprint(pub), r = env.r.find((x) => x.f === f);
  if (!r) throw new Error("not sealed for this key");
  const e = await subtle.importKey("spki", unb64u(r.e), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const cek = await subtle.decrypt({ name: "AES-GCM", iv: unb64u(r.iv) }, await kek(priv, e, unb64u(r.e)), unb64u(r.w));
  const ck = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(gunzipSync(Buffer.from(await subtle.decrypt({ name: "AES-GCM", iv: unb64u(env.iv) }, ck, unb64u(env.c)))));
}
