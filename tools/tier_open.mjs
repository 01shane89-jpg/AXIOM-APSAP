// Opening a sealed file (tools/seal_lib.mjs format) on the server, with Web APIs only, so the Netlify edge gate
// (Deno) and the Node tests share it. The paid tiers' data will be sealed in the public repository for the server's tier
// key; the private half lives only in the Netlify environment variable OSAP_TIER_KEY (a PKCS#8 key, base64url), and the
// edge gate opens a file only for a signed-in user whose tier allows it. A file not sealed for that key (plain data, or
// the hidden areas' files sealed for the owner's devices) is passed on unchanged.
const PREFIX = "/*osap-sealed:v1 ";
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
function unb64u(s) {
  const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
function b64u(u) {
  let s = "";
  for (const x of new Uint8Array(u)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const isSealed = (text) => String(text).startsWith(PREFIX);
export async function fingerprintOf(spkiB64u) { return b64u(await subtle.digest("SHA-256", unb64u(spkiB64u))).slice(0, 16); }

/** The server key from OSAP_TIER_KEY: { priv, fp } or null when it is not set. */
export async function loadTierKey(pkcs8B64u, spkiB64u) {
  if (!pkcs8B64u || !spkiB64u) return null;
  const priv = await subtle.importKey("pkcs8", unb64u(pkcs8B64u), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { priv, fp: await fingerprintOf(spkiB64u) };
}

async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** The plain bytes of a file sealed for this key, or null when the text is not sealed for it. */
export async function openForTier(text, key) {
  if (!key || !isSealed(text)) return null;
  let env;
  try { env = JSON.parse(String(text).slice(PREFIX.length).replace(/\*\/\s*$/, "")); } catch (e) { return null; }
  const r = (env.r || []).find((x) => x.f === key.fp);
  if (!r) return null;
  const e = await subtle.importKey("spki", unb64u(r.e), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: e }, key.priv, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const kek = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: unb64u(r.e), info: enc.encode("osap-seal v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const cek = await subtle.decrypt({ name: "AES-GCM", iv: unb64u(r.iv) }, kek, unb64u(r.w));
  const ck = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  return gunzip(new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: unb64u(env.iv) }, ck, unb64u(env.c))));
}
