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
  if (!uid || typeof uid !== "string" || d.custom_data.osap_team) return null; // a team's subscription: teamEvent
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

/* ---------- Team, Organisation and pilot (tools/teams.mjs, netlify/functions/osap-teams.mjs) ---------- */
// The Paddle prices behind tools/tiers.mjs quote() lines, from Netlify environment variables (one price id each).
export const PRICE_ENV = { team_month: "PADDLE_PRICE_TEAM_MONTH", team_year: "PADDLE_PRICE_TEAM_YEAR", org_base: "PADDLE_PRICE_ORG_BASE", org_seat: "PADDLE_PRICE_ORG_SEAT", pilot: "PADDLE_PRICE_PILOT" };
export function priceIds(get) {
  const out = {};
  for (const [k, v] of Object.entries(PRICE_ENV)) { const id = String(get(v) || "").split(",")[0].trim(); if (id) out[k] = id; }
  return out;
}
/**
 * Which Paddle the server talks to. Sandbox unless the Netlify environment says PADDLE_ENV=live (Shane 2026-10-25: sandbox
 * only until OSAP's own Paddle account exists). A live setting with a sandbox client token, or the other way round, is refused,
 * so a half-switched setup cannot take real money against test prices.
 */
export function paddleEnv(get) {
  const live = String(get("PADDLE_ENV") || "").trim().toLowerCase() === "live";
  const token = String(get("PADDLE_CLIENT_TOKEN") || ""), key = String(get("PADDLE_API_KEY") || "");
  const tokenSandbox = /^test_/.test(token);
  if (!token || !key) return { ok: false, why: "Payments for teams are not switched on yet." };
  if (live === tokenSandbox) return { ok: false, why: "Payments are set up inconsistently (live and sandbox mixed). Nothing was charged." };
  if ((/sdbx/.test(key) && live) || (/_live_/.test(key) && !live)) return { ok: false, why: "Payments are set up inconsistently (live and sandbox mixed). Nothing was charged." };
  return { ok: true, live, base: live ? "https://api.paddle.com" : "https://sandbox-api.paddle.com", key, token };
}
/** One Paddle API call; throws with Paddle's own error code and detail (never the key) when it refuses. */
export async function paddleCall(env, method, path, body, fetchFn = fetch) {
  const r = await fetchFn(env.base + path, { method, headers: { authorization: "Bearer " + env.key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("Paddle: " + ((j.error && (j.error.detail || j.error.code)) || r.status)); e.status = 502; throw e; }
  return j.data;
}
/**
 * What a Paddle event means for a team, or null. prices: priceIds(). Kinds:
 *   pilot         a paid pilot's one-off transaction completed: { team, transaction }
 *   link          a team's first subscription transaction completed: { team, subscription } (so later events find the team)
 *   subscription  subscription.*: { team?, subscription, status, plan, interval, seats, periodEnds, launch, credit }
 */
export function teamEvent(ev, prices) {
  if (!ev || !ev.data) return null;
  const d = ev.data, cd = d.custom_data || {}, type = String(ev.event_type || "");
  const base = { event: ev.event_id || null, at: ev.occurred_at || null, team: typeof cd.osap_team === "string" ? cd.osap_team : null };
  const qty = {};
  for (const i of d.items || []) {
    const id = (i && i.price && i.price.id) || (i && i.price_id);
    for (const [k, p] of Object.entries(prices)) if (id && id === p) qty[k] = (qty[k] || 0) + (Number(i.quantity) || 1);
  }
  if (type === "transaction.completed") {
    if (!base.team) return null;
    if (qty.pilot && !d.subscription_id) return { ...base, kind: "pilot", transaction: d.id || null };
    if (d.subscription_id) return { ...base, kind: "link", subscription: d.subscription_id, transaction: d.id || null };
    return null;
  }
  if (!/^subscription\./.test(type)) return null;
  let plan = null, interval = null, seats = 0;
  if (qty.team_month || qty.team_year) { plan = "team"; interval = qty.team_year ? "year" : "month"; seats = qty.team_year || qty.team_month; }
  else if (qty.org_base) { plan = "org"; interval = "year"; seats = 25 + (qty.org_seat || 0); }
  // only a team's own prices count: a Mid or Full checkout opened by a page with a team id in it changes no team
  if (!plan) return null;
  const per = d.current_billing_period || {};
  return { ...base, kind: "subscription", subscription: d.id || null, status: d.status || null, plan, interval, seats: seats || null,
    periodEnds: per.ends_at || d.next_billed_at || null, launch: cd.osap_launch === "1", credit: cd.osap_credit === "1" };
}
