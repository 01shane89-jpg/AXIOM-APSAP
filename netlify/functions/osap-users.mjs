// The owner's Users list (Settings > Users, assets/osap-tier.js): every account's email, when it joined, when it last
// signed in and was last seen, and its plan. Only the owner (tools/owner.mjs) gets it; everyone else gets 403.
import { admin } from "@netlify/identity";
import { tierOfRoles } from "../../tools/tiers.mjs";
import { isOwner, userRow } from "../../tools/owner.mjs";

export default async (req) => {
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+\S+$/.test(auth)) return new Response("sign in", { status: 401 });
  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
  const me = r && r.ok ? await r.json().catch(() => null) : null;
  if (!me) return new Response("sign in", { status: 401 });
  if (!isOwner(me, Netlify.env.get("OSAP_OWNERS"))) return new Response("owner only", { status: 403 });
  const rows = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await admin.listUsers({ page, perPage: 100 });
    rows.push(...batch.map((u) => userRow(u, tierOfRoles, Netlify.env.get("OSAP_OWNERS"))));
    if (batch.length < 100) break;
  }
  rows.sort((a, b) => String(b.lastSeen || b.lastSignIn || "").localeCompare(String(a.lastSeen || a.lastSignIn || "")));
  return Response.json({ count: rows.length, users: rows }, { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/osap-users" };
