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
  [/^data\/live\/(evsum|aiwatch)\.js$/, "full"],
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
export const SETS = { news: "free", alerts: "free", flood: "free", hazards: "free", weather: "free", timeline: "free" };
export const SETS_DEFAULT = "mid";
// Features inside a tool. team: Team workspace (assets/osap-team.js), creating or joining a team; the owner always has Full.
// Like every lock on the page it is a sign only: a team's data never passes through OSAP's server.
export const FEATURES = { team: "full" };

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
  return { tiers: TIERS, names: NAMES, prices: PRICES, trialDays: TRIAL_DAYS, tools: TOOLS, sets: SETS, setsDefault: SETS_DEFAULT, features: FEATURES,
    data: DATA.map(([re, t]) => [re.source, t]), dataDefault: DATA_DEFAULT };
}
