# AXIOM OSAP desktop program

A small Electron program that opens the live OSAP site (`APP_URL` in `main.js`) in its own window. It holds no data of its
own: the site's service worker saves the app and its data on the computer, so after one start with internet it opens
offline, and it updates itself whenever the website does. Rebuild the program only when this folder changes.

- Links to other sites open in the normal browser; the window only ever shows OSAP.
- OSAP may use location, clipboard, notifications, offline storage and full screen; every other permission is refused.
- First start with no internet shows `offline.html`, which retries when the connection is back.

## Build and release

`.github/workflows/desktop.yml` builds Windows (`.exe`), Mac (`.dmg`, Apple silicon and Intel) and Linux (`.AppImage`,
`.deb`) on free GitHub runners. To publish a release, push a tag: `git tag desktop-v0.1.0 && git push origin desktop-v0.1.0`.
A tag with a hyphen (`desktop-v0.1.0-preview.1`) makes a pre-release. The installers are not code-signed, so Windows and
macOS warn on first start (the release notes say how to get past it).

## Local

```
cd desktop && npm ci && npm start                          # run against the live site
OSAP_URL=http://127.0.0.1:8000/ npm start                  # run against a local copy (python3 -m http.server in the repo root)
xvfb-run -a node test.mjs                                  # checks: links, permissions, offline start (Linux)
npx electron-builder --linux --publish never               # build installers into desktop/dist/
```
