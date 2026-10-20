// Reviews of OSAP (tools/reviews.mjs). Shown reviews are for everyone, the sign-in screen too; writing needs an account;
// showing, hiding and reading every review is the owner's (tools/owner.mjs).
//   GET                              anyone: shown reviews (stars, words, date), count, average. Signed in: also "mine".
//                                    The owner: also "all", every review with its email and status.
//   POST {review:{stars,text}}       signed in: saves the account's review; it waits for the owner
//   POST {remove:"mine"}             signed in: deletes the account's own review
//   POST {status:{id,to}}            owner: "shown", "hidden" or "waiting"
//   POST {remove:id}                 owner: deletes a review
// Records are in the Netlify Blobs store "osap-reviews". The words are never logged.
import { getStore } from "@netlify/blobs";
import { isOwner } from "../../tools/owner.mjs";
import { readPublic, getMine, mineOf, saveReview, listAll, ownerRow, setStatus, removeReview, reviewId } from "../../tools/reviews.mjs";

const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
let storeFor = () => getStore({ name: "osap-reviews", consistency: "strong" });
/** tests only: a stand-in for Netlify Blobs */
export function useStore(f) { storeFor = f; }

async function who(req) {
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+\S+$/.test(auth)) return null;
  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
  return r && r.ok ? await r.json().catch(() => null) : null;
}

export default async (req) => {
  const me = await who(req), store = storeFor();
  const owner = !!me && isOwner(me, Netlify.env.get("OSAP_OWNERS"));
  try {
    if (req.method === "GET") {
      const out = { ...(await readPublic(store)) };
      if (me) out.mine = mineOf(await getMine(store, me));
      if (owner) out.all = (await listAll(store)).map(ownerRow);
      return json(out);
    }
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (!me) return json({ error: "Sign in first." }, 401);
    const raw = await req.text();
    if (raw.length > 4096) return json({ error: "too large" }, 413);
    let b;
    try { b = JSON.parse(raw) || {}; } catch (e) { return json({ error: "bad json" }, 400); }
    if (b.review) {
      const rec = await saveReview(store, me, b.review);
      console.log("osap review saved", rec.id.slice(0, 8), rec.stars);
      return json({ mine: mineOf(rec) });
    }
    if (b.remove === "mine") {
      await removeReview(store, await reviewId(me.id));
      return json({ mine: null });
    }
    if (!owner) return json({ error: "owner only" }, 403);
    if (b.status) {
      const rec = await setStatus(store, String(b.status.id), String(b.status.to));
      console.log("osap review", rec.id.slice(0, 8), rec.status);
      return json({ row: ownerRow(rec) });
    }
    if (b.remove != null) {
      await removeReview(store, String(b.remove));
      return json({ ok: true });
    }
    return json({ error: "nothing to do" }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 400);
  }
};

export const config = { path: "/api/osap-reviews" };
