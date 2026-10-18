// Paddle Billing webhooks for the paywall (netlify/functions/paddle-webhook.mjs). Web Crypto only, so tests run it in Node.
// Paddle signs each delivery: header Paddle-Signature "ts=<unix seconds>;h1=<hex HMAC-SHA256 of `${ts}:${raw body}`>",
// keyed with the notification destination's secret (Netlify environment variable PADDLE_WEBHOOK_SECRET).
const enc = new TextEncoder();
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** true when the delivery is Paddle's: a matching h1 and a timestamp within `tolerance` seconds of now. */
export async function verifySignature(raw, header, secret, now = Date.now() / 1000, tolerance = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(";").map((p) => p.trim().split("=")).filter((p) => p.length === 2));
  const ts = Number(parts.ts);
  if (!ts || !parts.h1 || Math.abs(now - ts) > tolerance) return false;
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return same(hex(await crypto.subtle.sign("HMAC", k, enc.encode(ts + ":" + raw))), String(parts.h1).toLowerCase());
}
// a subscription in these states keeps its plan; any other (canceled, paused) drops the user to Free
const LIVE = new Set(["active", "trialing", "past_due"]);
/**
 * What a subscription event means for the user: { uid, tier, subscription, status, at } or null for events that change no
 * plan. prices = { mid: [price ids], full: [price ids] }. The page puts the user's Identity id in custom_data.osap_uid.
 */
export function planFromEvent(ev, prices) {
  if (!ev || !/^subscription\./.test(ev.event_type || "")) return null;
  const d = ev.data || {}, uid = d.custom_data && d.custom_data.osap_uid;
  if (!uid || typeof uid !== "string") return null;
  const ids = (d.items || []).map((i) => i && i.price && i.price.id).filter(Boolean);
  const has = (t) => ids.some((id) => (prices[t] || []).includes(id));
  const paid = has("full") ? "full" : has("mid") ? "mid" : null;
  return { uid, tier: paid && LIVE.has(d.status) ? paid : "free", subscription: d.id || null, status: d.status || null, at: ev.occurred_at || null };
}
/** The user's new app_metadata: other roles kept, the plan role replaced. An event older than the last one applied is ignored. */
export function applyPlan(appMeta, plan) {
  const m = appMeta || {}, last = m.osap_plan && m.osap_plan.at;
  if (last && plan.at && plan.at < last) return null;
  const roles = [].concat(m.roles || []).filter((r) => r !== "mid" && r !== "full");
  if (plan.tier !== "free") roles.push(plan.tier);
  return { ...m, roles, osap_plan: { tier: plan.tier, subscription: plan.subscription, status: plan.status, at: plan.at } };
}
