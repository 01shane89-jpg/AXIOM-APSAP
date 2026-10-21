// "Where does OSAP see me connecting from?" for Settings > Staying hidden online (assets/osap-safety.js). It answers with
// the address and place Netlify's edge already sees on every request, so the user can tell whether a VPN or Tor is hiding
// them, without asking any outside "what is my IP" service. Nothing is logged or kept, and the answer is never cached.
export default async (req, context) => {
  if (req.method !== "GET") return new Response("method", { status: 405 });
  const g = (context && context.geo) || {};
  const body = {
    ip: (context && context.ip) || "",
    country: (g.country && g.country.code) || "", countryName: (g.country && g.country.name) || "",
    region: (g.subdivision && g.subdivision.name) || "", city: g.city || "", tz: g.timezone || "",
  };
  return Response.json(body, { headers: { "cache-control": "no-store, private" } });
};

export const config = { path: "/api/osap-seen-from" };
