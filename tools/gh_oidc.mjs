// Checks a GitHub Actions OIDC token (the one a workflow job gets with "permissions: id-token: write"), so that a Netlify
// function can trust a request from this repository's own refresh job with no shared secret: GitHub signs the token, and the
// claims say which repository, branch and workflow asked. Used by netlify/functions/osap-push.mjs.
// verifyActionsToken(jwt, { aud, repo, ref, fetchJwks }) -> claims, or throws with a short reason.
const ISS = "https://token.actions.githubusercontent.com";
const JWKS = ISS + "/.well-known/jwks";
let jwksCache = null, jwksAt = 0;

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const json = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

async function keys(fetchJwks) {
  if (fetchJwks) return fetchJwks();
  if (jwksCache && Date.now() - jwksAt < 3600e3) return jwksCache;
  const r = await fetch(JWKS, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("jwks " + r.status);
  jwksCache = await r.json(); jwksAt = Date.now();
  return jwksCache;
}

export async function verifyActionsToken(jwt, { aud, repo, ref, fetchJwks } = {}) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) throw new Error("not a token");
  let head, claims;
  try { head = json(parts[0]); claims = json(parts[1]); } catch { throw new Error("not a token"); }
  if (head.alg !== "RS256" || !head.kid) throw new Error("wrong algorithm");
  const jwk = ((await keys(fetchJwks)).keys || []).find((k) => k.kid === head.kid && k.kty === "RSA");
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("bad signature");
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISS) throw new Error("wrong issuer");
  if (!(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) throw new Error("expired");
  if ([].concat(claims.aud || []).indexOf(aud) < 0) throw new Error("wrong audience");
  if (String(claims.repository || "").toLowerCase() !== String(repo || "").toLowerCase()) throw new Error("wrong repository");
  if (ref && claims.ref !== ref) throw new Error("wrong branch");
  return claims;
}
