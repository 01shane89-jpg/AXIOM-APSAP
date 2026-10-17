// What the page needs for the paywall (assets/osap-tier.js): the tier rules, the signed-in user's plan, and Paddle's public
// checkout settings. Nothing secret: the Paddle client token is a public, checkout-only token.
import { rulesForPage, tierOfRoles } from "../../tools/tiers.mjs";

const ids = (k) => String(Netlify.env.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);

export default async (req) => {
  let tier = "free", email = null, uid = null, signedIn = false;
  const auth = req.headers.get("authorization");
  if (auth && /^Bearer\s+\S+$/.test(auth)) {
    const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
    const u = r && r.ok ? await r.json().catch(() => null) : null;
    if (u) { signedIn = true; uid = u.id || null; email = u.email || null; tier = tierOfRoles(u.app_metadata && u.app_metadata.roles); }
  }
  const token = Netlify.env.get("PADDLE_CLIENT_TOKEN") || null;
  return Response.json({
    gate: true, signedIn, uid, email, tier, rules: rulesForPage(),
    paddle: token ? { token, sandbox: /^test_/.test(token), prices: { mid: ids("PADDLE_PRICE_MID")[0] || null, full: ids("PADDLE_PRICE_FULL")[0] || null } } : null,
  }, { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/osap-account" };
