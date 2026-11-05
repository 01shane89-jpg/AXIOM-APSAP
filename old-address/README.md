# The old netlify.app address after the move (2026-11-05)

OSAP moves to **https://osap.axiom-inteligence-systems.com/**. A browser keeps saved work (map points, routes, workspaces,
photos) separately for each address, so the old address has to keep running long enough to hand every user's saved work on.
Once a custom domain is the app project's primary domain, Netlify answers `axiom-osap.netlify.app` with its own redirect
before any page runs, so the old address is kept alive by a **second Netlify project**: this folder.

How it works: `tools/netlify_build.mjs` builds the normal app copy with `<meta name="osap-carry-to">` in index.html (from
`OSAP_OLD_TO` in `old-address/netlify.toml`). `assets/osap-carry.js` sees it and hands everything on to the new address, then
moves the user there. github.io still hands on to netlify.app, which hands on again, so work made on either old address
arrives. The app's own build has no meta, so nothing moves until this project exists.

## The switch, in order

1. Merge the PR that adds this folder (inert until step 4).
2. DNS (Squarespace): `CNAME osap -> axiom-osap.netlify.app`.
3. Netlify, project **axiom-osap** (the app): Domain management, add `osap.axiom-inteligence-systems.com` as the primary
   domain and wait for HTTPS. From here netlify.app redirects to the new address (the hand-off gap starts; nothing is lost,
   the saved work stays in each browser under the old address).
4. Same project: Project configuration, change the project name to **axiom-osap-app** (frees the netlify.app name).
5. Create a new project from the same repository, base directory `old-address`, production branch `main`, then name it
   **axiom-osap**. Its first build serves the hand-off (the gap ends).
6. DNS: change the CNAME to `axiom-osap-app.netlify.app` (the old name now belongs to the stand-in).
7. Check from a device that has saved work on the old address: open `https://axiom-osap.netlify.app/`; it should land on
   the new address with the "Brought across from OSAP's old address" note.

Steps 3 to 5 should run back to back (a few minutes).

## Outside the repository (Shane)

- Paddle: approve the domain `osap.axiom-inteligence-systems.com`; change the webhook URL to
  `https://osap.axiom-inteligence-systems.com/api/paddle-webhook` (the stand-in passes the old URL on meanwhile).
- Esri (ArcGIS Location Platform): add `https://osap.axiom-inteligence-systems.com` to the key's allowed referrers, or the
  Esri base maps stop on the new address.
- Users sign in once more on the new address: the sign-in is per address and is never carried.

## After the switch (follow-up PR)

Point the remaining hard-coded `axiom-osap.netlify.app` addresses at the new one: `tools/push_lib.mjs` PUSH_API,
`assets/osap-share.js` LIVE, `assets/osap-tier.js` MOVE_TO, `desktop/main.js` APP_URL, the user agents in
`netlify/edge-functions/osap-px.js` and `osap-air.js`, and `index.html`'s github.io fallback line (only once github.io can
hand on straight to the new address without skipping netlify.app's own saved work).
