// Who is the owner (Shane 2026-10-18: "As the owner I want to see who is using the app"): an Identity account holding the
// "owner" role (set in Netlify > Identity > the user > Roles), or whose confirmed email is listed in the Netlify environment
// variable OSAP_OWNERS (comma-separated). Only the owner can list accounts (netlify/functions/osap-users.mjs).
export function isOwner(u, ownersCsv) {
  if (!u) return false;
  const roles = [].concat((u.app_metadata || u.appMetadata || {}).roles || []);
  if (roles.includes("owner")) return true;
  const list = String(ownersCsv || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!(u.email && (u.confirmed_at || u.confirmedAt) && list.includes(String(u.email).toLowerCase()));
}
/** The plan an account has: the owner always has everything (Shane 2026-10-18: "I want my account 01shane89@gmail.com to be
    unlocked fully"), whether the owner is set by role or by OSAP_OWNERS; everyone else has what their roles give. */
export function planOf(u, ownersCsv, tierOfRoles) {
  if (!u) return "free";
  if (isOwner(u, ownersCsv)) return "full";
  const m = u.app_metadata || u.appMetadata || {};
  return tierOfRoles(m.roles);
}
/** The row the owner sees for one account: no password, no tokens, nothing but email, times and plan. */
export function userRow(u, tierOfRoles, ownersCsv) {
  const m = u.appMetadata || u.app_metadata || {};
  return {
    email: u.email || "",
    joined: u.createdAt || u.created_at || null,
    confirmed: !!(u.confirmedAt || u.confirmed_at),
    lastSignIn: u.lastSignInAt || u.last_sign_in_at || null,
    lastSeen: m.osap_seen || null,
    tier: planOf(u, ownersCsv, tierOfRoles),
    owner: isOwner(u, ownersCsv),
  };
}
