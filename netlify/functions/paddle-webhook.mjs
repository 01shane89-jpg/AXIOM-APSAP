// Paddle tells the site about subscriptions here (Paddle > Developer tools > Notifications, destination
// https://<site>/api/paddle-webhook, subscription.* events). A verified event sets the user's plan role in Netlify Identity,
// which the edge gate (netlify/edge-functions/osap-data.js) reads. Card details never reach OSAP: Paddle holds them.
import { admin } from "@netlify/identity";
import { verifySignature, planFromEvent, applyPlan } from "../../tools/paddle.mjs";

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
  const plan = planFromEvent(ev, { mid: ids("PADDLE_PRICE_MID"), full: ids("PADDLE_PRICE_FULL") });
  if (!plan) return new Response("ignored", { status: 200 });
  let user;
  try { user = await admin.getUser(plan.uid); } catch (e) { return new Response("unknown user", { status: 200 }); }
  const meta = applyPlan(user.appMetadata, plan);
  if (!meta) return new Response("older event", { status: 200 });
  await admin.updateUser(plan.uid, { app_metadata: meta });
  // only ids and the plan are logged, never the event body (it carries the buyer's details)
  console.log("osap plan", plan.uid, plan.tier, plan.status, ev.event_id || "");
  return new Response("ok", { status: 200 });
};

export const config = { path: "/api/paddle-webhook" };
