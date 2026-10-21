// Panic wipe, the server's half (assets/osap-wipe.js): after the page has erased what it can reach, this answer has the
// browser clear everything else OSAP's site keeps on the device (storage, caches, service worker, cookies). It reads and
// stores nothing. Only a POST carrying the x-osap-wipe header is answered with the clear: another site's link or form
// cannot set that header, so it cannot wipe anyone's device.
export default async (req) => {
  if (req.method !== "POST" || req.headers.get("x-osap-wipe") !== "1") return new Response("not here", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(null, { status: 204, headers: { "clear-site-data": '"cache", "cookies", "storage"', "cache-control": "no-store" } });
};

export const config = { path: "/api/osap-wipe" };
