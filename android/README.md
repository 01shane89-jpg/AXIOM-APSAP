# AXIOM OSAP Android app (Google Play)

A Trusted Web Activity (TWA): the Play Store app opens the live site `https://osap.axiom-intelligence-systems.com/`
full screen in the phone's Chrome. It holds no data or code of its own, so it updates whenever the website does, and the
site's service worker gives it the same offline behavior as the web app. Built with Google's Bubblewrap library.

- Package name: `com.axiomintelligencesystems.osap` (permanent once uploaded to Play; never change it).
- Settings: `twa-manifest.json` (name, colors, icons from the site's `manifest.webmanifest`, notifications and location
  passed through to the site, Android 6.0+, target API 36).
- Site link: `/.well-known/assetlinks.json` in the site lists the signing keys allowed to open the site without a
  browser bar. If a key is missing there, the app still works but shows a small address bar at the top.

## Build

`.github/workflows/android.yml` builds on a free GitHub runner: on any pull request touching `android/`, or from the
Actions tab (Android app > Run workflow) with a version name (`0.1.0`) and a version code (raise it by one for every
Play upload). The run artifact holds `app-release.aab` (unsigned) and `app-debug.apk` (for a quick test install).

Local: `cd android && npm ci && node generate.mjs 0.1.0 1`, then `cd project && ./gradlew bundleRelease` (needs JDK 17
and the Android SDK).

## Sign and upload

The upload key is kept off GitHub (not in the repository, not in Actions secrets). Sign the bundle with it:

```
jarsigner -keystore osap-upload.jks -storepass "$PW" -keypass "$PW" -sigalg SHA256withRSA -digestalg SHA-256 \
  -signedjar osap-0.1.0.aab app-release.aab osap-upload
jarsigner -verify osap-0.1.0.aab
```

Upload key fingerprint (SHA-256), already in `assetlinks.json`:
`41:7D:8E:B5:62:C4:14:D0:2D:65:E0:07:1F:D2:07:98:DF:3C:BE:D8:8D:EC:C2:5A:A9:82:BE:44:48:00:B1:8B`

Play Console uses Play App Signing: Google re-signs the app with its own key for phones. After the first upload, copy
the **App signing key certificate SHA-256** from Play Console (Test and release > App integrity) into
`.well-known/assetlinks.json` next to the upload key, or the store app shows an address bar. If the upload key is ever
lost, Play Console support can reset it; the app itself is not lost.
