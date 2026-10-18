// What the page needs for the paywall (assets/osap-tier.js): the tier rules, the signed-in user's plan, and Paddle's public
// checkout settings. Nothing secret: the Paddle client token is a public, checkout-only token.
import { admin } from "@netlify/identity";
import { rulesForPage, tierOfRoles } from "../../tools/tiers.mjs";
import { isOwner, planOf } from "../../tools/owner.mjs";

const ids = (k) => String(Netlify.env.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);

export default async (req) => {
  let tier = "free", email = null, uid = null, signedIn = false, owner = false;
  const auth = req.headers.get("authorization");
  if (auth && /^Bearer\s+\S+$/.test(auth)) {
    const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
    const u = r && r.ok ? await r.json().catch(() => null) : null;
    if (u) {
      signedIn = true; uid = u.id || null; email = u.email || null; tier = planOf(u, Netlify.env.get("OSAP_OWNERS"), tierOfRoles);
      owner = isOwner(u, Netlify.env.get("OSAP_OWNERS"));
      // "last seen" for the owner's Users list: written at most once an hour per account, and only the time
      // (read afresh just before writing, so a plan the Paddle webhook set a moment ago is not written back over)
      const last = Date.parse((u.app_metadata || {}).osap_seen || 0) || 0;
      if (uid && Date.now() - last > 3600e3) {
        await admin.getUser(uid).then((fresh) => admin.updateUser(uid, { app_metadata: { ...(fresh.appMetadata || {}), osap_seen: new Date().toISOString() } })).catch(() => {});
      }
    }
  }
  const token = Netlify.env.get("PADDLE_CLIENT_TOKEN") || null;
  return Response.json({
    gate: true, signedIn, uid, email, tier, owner, rules: rulesForPage(),
    paddle: token ? { token, sandbox: /^test_/.test(token), prices: { mid: ids("PADDLE_PRICE_MID")[0] || null, full: ids("PADDLE_PRICE_FULL")[0] || null } } : null,
  }, { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/osap-account" };
