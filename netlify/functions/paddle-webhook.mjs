// Paddle tells the site about subscriptions here (Paddle > Developer tools > Notifications, destination
// https://<site>/api/paddle-webhook, subscription.* events). A verified event sets the user's plan role in Netlify Identity,
// which the edge gate (netlify/edge-functions/osap-data.js) reads. Card details never reach OSAP: Paddle holds them.
import { admin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { verifySignature, planFromEvent, applyPlan, teamEvent, priceIds } from "../../tools/paddle.mjs";
import { applyBilling, writeSeats } from "../../tools/teams.mjs";

let teamStore = () => getStore({ name: "osap-teams", consistency: "strong" });
let identity = () => admin;
/** tests only: stand-ins for Netlify Blobs and the Identity admin API */
export function useStore(f) { teamStore = f; }
export function useIdentity(f) { identity = f; }
const ids = (k) => String(Netlify.env.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);

export default async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  if (raw.length > 1 << 20) return new Response("too large", { status: 413 });
  if (!(await verifySignature(raw, req.headers.get("paddle-signature"), Netlify.env.get("PADDLE_WEBHOOK_SECRET")))) {
    return new Response("bad signature", { status: 401 });
  }
  let ev;
  try { ev = JSON.parse(raw); } catch (e) { return new Response("bad json", { status: 400 }); }
  // a Team, Organisation or pilot (tools/teams.mjs): the team's status, seats and paid-through date, then every member's seat
  const te = teamEvent(ev, priceIds((k) => Netlify.env.get(k)));
  if (te) {
    const res = await applyBilling(teamStore(), te);
    const n = res ? await writeSeats(identity(), res.seats) : 0;
    console.log("osap team billing", te.kind, (te.team || "").slice(5, 13), te.status || "", res ? "applied, seats " + n : "no change", ev.event_id || "");
    return new Response("ok", { status: 200 });
  }
  const plan = planFromEvent(ev, { mid: ids("PADDLE_PRICE_MID"), full: ids("PADDLE_PRICE_FULL") });
  if (!plan) return new Response("ignored", { status: 200 });
  let user;
  try { user = await identity().getUser(plan.uid); } catch (e) { return new Response("unknown user", { status: 200 }); }
  const meta = applyPlan(user.appMetadata, plan);
  if (!meta) return new Response("older event", { status: 200 });
  await identity().updateUser(plan.uid, { app_metadata: meta });
  // only ids and the plan are logged, never the event body (it carries the buyer's details)
  console.log("osap plan", plan.uid, plan.tier, plan.status, ev.event_id || "");
  return new Response("ok", { status: 200 });
};

export const config = { path: "/api/paddle-webhook" };
