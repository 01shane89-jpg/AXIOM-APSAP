// Who is the owner (Shane 2026-10-18: "As the owner I want to see who is using the app"): an Identity account holding the
// "owner" role (set in Netlify > Identity > the user > Roles), or whose confirmed email is listed in the Netlify environment
// variable OSAP_OWNERS (comma-separated). Only the owner can list accounts (netlify/functions/osap-users.mjs).
export function isOwner(u, ownersCsv) {
  if (!u) return false;
  const roles = [].concat((u.app_metadata && u.app_metadata.roles) || []);
  if (roles.includes("owner")) return true;
  const list = String(ownersCsv || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!(u.email && u.confirmed_at && list.includes(String(u.email).toLowerCase()));
}
/** The row the owner sees for one account: no password, no tokens, nothing but email, times and plan. */
export function userRow(u, tierOfRoles) {
  const m = u.appMetadata || u.app_metadata || {};
  return {
    email: u.email || "",
    joined: u.createdAt || u.created_at || null,
    confirmed: !!(u.confirmedAt || u.confirmed_at),
    lastSignIn: u.lastSignInAt || u.last_sign_in_at || null,
    lastSeen: m.osap_seen || null,
    tier: tierOfRoles(m.roles),
    owner: [].concat(m.roles || []).includes("owner"),
  };
}
