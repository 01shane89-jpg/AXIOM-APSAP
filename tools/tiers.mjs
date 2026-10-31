// OSAP subscription tiers (paywall thread, Shane 2026-10-17: "a free portion and then a mid portion and the full version").
// One list, read by the Netlify edge gate (netlify/edge-functions/osap-data.js), the account function
// (netlify/functions/osap-account.mjs) and, through that function, the page (assets/osap-tier.js).
// The page only shows locks; the edge gate is what refuses a file. On GitHub Pages there is no gate and everything stays open.
// Order matters: the first rule that matches a path wins. A data path no rule names needs DATA_DEFAULT.
export const TIERS = ["free", "mid", "full"];
export const NAMES = { free: "Free", mid: "Mid", full: "Full" };
// Shown on the plans sheet. Proposed 2026-10-17; the charge itself is whatever the Paddle price says, so change both together.
// Shane 2026-10-18: "start at 100$/year for full access and tier the rest off that with a 14 day free trial". The prices
// charged are set in Paddle, which also lowers them by the buyer's billing country; these are the US-dollar prices shown.
export const PRICES = { free: "US$0, free account", mid: "US$50 a year or US$5 a month", full: "US$100 a year or US$10 a month" };
export const TRIAL_DAYS = 14;
export const DATA_DEFAULT = "mid";

// Data and source files, by path from the site root.
export const DATA = [
  // Full: the analyst's material and the AI-written summaries
  [/^data\/(claims|captures|decisions|sof)\//, "full"],
  [/^data\/live\/(evsum|evsum_ai|aiwatch)\.js$/, "full"],
  // the bundle AXIOM Analyst Work Station imports (tools/axiom_bundle.mjs)
  [/^data\/axiom\//, "full"],
  // Chinese, Russian and Iranian presence for every country (tools/refresh_cnpresence.mjs, refresh_ruirpresence.mjs;
  // Shane 2026-10-31: "Full only please")
  [/^data\/(cnpresence|rupresence|irpresence)\//, "full"],
  [/^data\/live\/daily(\/|\.js$)/, "full"],
  [/^source\/sof\//, "full"],
  // Free: the map itself, the country picker, weather, warnings and headline news
  [/^data\/(basemap|places)\//, "free"],
  // the default view's flood map (Thailand): flooding is a warning, like the weather
  [/^data\/thailand\/(flood-live-snapshot|flood-exposure|province-alerts)\.js$/, "free"],
  [/^data\/live\/(news|news-index|wx-forecast|warnings|advisories|quakes|national-quakes|tsunami|storms|gdacs|volcano|eonet)\.js$/, "free"],
  [/^data\/live\/(news|news-index)\//, "free"],
  [/^data\/live\/(health|social-relevance|translation-cache)\.json$/, "free"],
  [/^source\/countries\//, "free"],
];

// Toolbar tools (data-atk in assets/osap-atak.js). A tool not listed is free.
export const TOOLS = {
  overlays: "mid", route: "mid", area: "mid", medplan: "mid", evac: "mid", comms: "mid", point: "mid", watch: "mid", "3d": "mid",
  mine: "full",
};
// Data sets (the ids in Data sets). A data set not listed needs SETS_DEFAULT.
export const SETS = { news: "free", alerts: "free", flood: "free", hazards: "free", weather: "free", timeline: "free", presence: "full", rupresence: "full", irpresence: "full" };
export const SETS_DEFAULT = "mid";
// Features inside a tool. team: Team workspace (assets/osap-team.js), creating or joining a team; the owner always has Full.
// Like every lock on the page it is a sign only: a team's data never passes through OSAP's server.
export const FEATURES = { team: "full" };
// Push alerts (netlify/functions/osap-push.mjs, assets/osap-push.js): how many push watches each plan may keep on OSAP's server.
// Free has none, as the Watch tool itself needs Mid. The refresh job (tools/push_watches.mjs) checks each watch with only the
// data its plan opens, so a push never carries what the plan cannot see in the app.
export const PUSH = { free: 0, mid: 5, full: 25 };
// all accounts' push watches together, the most one refresh job checks (oldest kept first)
export const PUSH_TOTAL = 3000;

// Team, Organisation and the paid pilot (Shane 2026-10-25, the approved 90-day launch plan). These are ways to pay, not more
// tiers: every seat holder gets Full, for as long as the team has paid (tools/teams.mjs, netlify/functions/osap-teams.mjs).
// US dollars, before the launch offer. As with PRICES, the charge is the Paddle price, so change both together.
//   team   US$39 a seat a month or US$390 a seat a year, 3 seats at least
//   org    US$12,000 a year for 25 seats, US$400 a year for each seat over 25
//   pilot  US$2,500 once for 60 days and up to 25 seats; the US$2,500 comes off the first Organisation year
export const BUSINESS = {
  team: { name: "Team", intervals: ["month", "year"], seat: { month: 39, year: 390 }, minSeats: 3, maxSeats: 500 },
  org: { name: "Organisation", intervals: ["year"], base: 12000, included: 25, extraSeat: 400, minSeats: 25, maxSeats: 500 },
  pilot: { name: "Paid pilot", intervals: ["once"], price: 2500, days: 60, seats: 25, credit: 2500, creditDays: 30 },
};
// the launch offer: the first 10 Team or Organisation customers get 30% off their first year in return for a short testimonial
export const LAUNCH = { percent: 30, customers: 10, plans: ["team", "org"] };
// a seat stays open this many days past the paid-through date, so a card renewal a day late does not lock a team out
export const SEAT_GRACE_DAYS = 3;
const cents = (usd) => Math.round(usd * 100);
/**
 * What a Team, Organisation or pilot costs, in US cents: { plan, interval, seats, lines: [{ key, qty, unit }], subtotal,
 * discount: { cents, percent, recurIntervals, parts }, total }, or null when the plan, interval or seats are not allowed.
 * lines[].key names the Paddle price (tools/paddle.mjs priceIds). launch: the launch offer applies; credit: the pilot's
 * US$2,500 is still unused (Organisation only). "First year" is 12 monthly charges or one yearly one.
 */
export function quote(plan, interval, seats, { launch = false, credit = false } = {}) {
  const P = BUSINESS[plan];
  if (!P || !P.intervals.includes(interval)) return null;
  const n = plan === "pilot" ? P.seats : Math.floor(Number(seats));
  if (plan !== "pilot" && (!Number.isFinite(n) || n < P.minSeats || n > P.maxSeats)) return null;
  const lines = plan === "team" ? [{ key: "team_" + interval, qty: n, unit: cents(P.seat[interval]) }]
    : plan === "org" ? [{ key: "org_base", qty: 1, unit: cents(P.base) }, ...(n > P.included ? [{ key: "org_seat", qty: n - P.included, unit: cents(P.extraSeat) }] : [])]
    : [{ key: "pilot", qty: 1, unit: cents(P.price) }];
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit, 0);
  const parts = [];
  const offer = launch && LAUNCH.plans.includes(plan), pilotCredit = credit && plan === "org";
  if (offer) parts.push({ kind: "launch", cents: Math.round(subtotal * LAUNCH.percent / 100) });
  if (pilotCredit) parts.push({ kind: "pilot", cents: Math.min(cents(BUSINESS.pilot.credit), subtotal - (parts[0] ? parts[0].cents : 0)) });
  const off = parts.reduce((s, x) => s + x.cents, 0);
  // a monthly Team keeps the launch percentage for 12 charges; anything yearly or once takes it off the first charge only
  const discount = off ? { cents: off, percent: offer && !pilotCredit ? LAUNCH.percent : null, recurIntervals: interval === "month" ? 12 : 1, parts } : null;
  return { plan, interval, seats: n, lines, subtotal, discount, total: subtotal - off };
}

export const rank = (t) => Math.max(0, TIERS.indexOf(t));
export const allows = (have, need) => rank(have) >= rank(need);
/** The tier a path needs ("data/…" or "/data/…"); null for anything that is not data. */
export function tierOfPath(p) {
  const rel = String(p).replace(/^\/+/, "");
  if (!/^(data|source)\//.test(rel)) return null;
  for (const [re, t] of DATA) if (re.test(rel)) return t;
  return DATA_DEFAULT;
}
/** A signed-in user's tier from their Identity roles (set by the Paddle webhook): the highest tier role they hold.
 *  The owner role (tools/owner.mjs) has everything. */
export function tierOfRoles(roles) {
  const rs = new Set([].concat(roles || []));
  return rs.has("full") || rs.has("owner") ? "full" : rs.has("mid") ? "mid" : "free";
}
/** What the page needs to draw its locks (no secrets). data is DATA as [pattern, tier] strings, so the page can leave out the
 *  files the plan cannot open instead of asking for each and being refused (assets/osap-datagate.js applies them like tierOfPath). */
export function rulesForPage() {
  return { tiers: TIERS, names: NAMES, prices: PRICES, trialDays: TRIAL_DAYS, business: BUSINESS, launch: LAUNCH, tools: TOOLS, sets: SETS, setsDefault: SETS_DEFAULT, features: FEATURES, push: PUSH,
    data: DATA.map(([re, t]) => [re.source, t]), dataDefault: DATA_DEFAULT };
}
