// Beta tester codes (tools/codes.mjs). The owner makes, lists and turns off codes; any signed-in account uses one.
//   GET                          owner: every code (note, last four characters, dates, who used it)
//   POST {make:{note,until}}     owner: a new code, returned once
//   POST {off:id}                owner: turns a code off, and takes Full away from the account that used it
//   POST {use:code}              any signed-in account: Full until the code's end date
// Records are in the Netlify Blobs store "osap-codes", keyed by the code's hash. Codes are never logged.
import { admin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { isOwner } from "../../tools/owner.mjs";
import { makeCode, listCodes, redeemCode, revokeCode, codeRow } from "../../tools/codes.mjs";

const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
let storeFor = () => getStore({ name: "osap-codes", consistency: "strong" });
/** tests only: a stand-in for Netlify Blobs */
export function useStore(f) { storeFor = f; }

export default async (req) => {
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+\S+$/.test(auth)) return json({ error: "Sign in first." }, 401);
  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
  const me = r && r.ok ? await r.json().catch(() => null) : null;
  if (!me) return json({ error: "Sign in first." }, 401);
  const owner = isOwner(me, Netlify.env.get("OSAP_OWNERS")), store = storeFor();
  if (req.method === "GET") {
    if (!owner) return json({ error: "owner only" }, 403);
    return json({ codes: (await listCodes(store)).map((c) => codeRow(c)) });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: "too large" }, 413);
  let b;
  try { b = JSON.parse(raw) || {}; } catch (e) { return json({ error: "bad json" }, 400); }
  try {
    if (b.use != null) {
      const rec = await redeemCode(store, String(b.use), me);
      const fresh = await admin.getUser(me.id);
      await admin.updateUser(me.id, { app_metadata: { ...(fresh.appMetadata || {}), osap_beta: { id: rec.id, until: rec.until, at: rec.usedAt } } });
      console.log("osap code used", rec.id.slice(0, 8), me.id);
      return json({ ok: true, until: rec.until });
    }
    if (!owner) return json({ error: "owner only" }, 403);
    if (b.make) {
      const { code, rec } = await makeCode(store, b.make);
      console.log("osap code made", rec.id.slice(0, 8));
      return json({ code, row: codeRow(rec) });
    }
    if (b.off != null) {
      const rec = await revokeCode(store, String(b.off));
      if (rec.usedBy && rec.usedBy.uid) {
        const u = await admin.getUser(rec.usedBy.uid).catch(() => null), m = (u && u.appMetadata) || {};
        if (u && m.osap_beta && m.osap_beta.id === rec.id) {
          const { osap_beta, ...rest } = m;
          await admin.updateUser(rec.usedBy.uid, { app_metadata: { ...rest, osap_beta: null } });
        }
      }
      console.log("osap code off", rec.id.slice(0, 8));
      return json({ row: codeRow(rec) });
    }
    return json({ error: "nothing to do" }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 400);
  }
};

export const config = { path: "/api/osap-codes" };
