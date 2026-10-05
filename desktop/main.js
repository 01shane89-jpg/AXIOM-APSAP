// AXIOM OSAP desktop program: a window onto the live OSAP site.
// The site's own service worker (sw.js) keeps the app and its data on the computer, so after the first online
// start it opens offline and updates itself exactly as the website does. This wrapper holds no data of its own.
// Links to any other site open in the computer's normal browser; the window only ever shows OSAP.
"use strict";
const { app, BrowserWindow, shell, session, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// The one place the app's address lives. OSAP_URL overrides it for testing a preview or a local server.
const APP_URL = process.env.OSAP_URL || "https://01shane89-jpg.github.io/AXIOM-APSAP/";
const APP = new URL(APP_URL);
// OSAP_SMOKE=1: load the site, print the page title and quit (exit 1 if it never loads). Used by the build workflow.
const SMOKE = process.env.OSAP_SMOKE === "1";

// Browser features the site uses (Use my location, copy buttons, notifications, keep data offline, full screen).
// Everything else (camera, microphone, USB, ...) is refused, and nothing is granted to any other site.
const ALLOWED = new Set(["geolocation", "clipboard-sanitized-write", "clipboard-read", "notifications", "persistent-storage", "fullscreen", "window-management"]);

function isApp(u) {
  try { const x = new URL(u); return x.origin === APP.origin && x.pathname.startsWith(APP.pathname); } catch { return false; }
}
function sameOrigin(o) {
  try { return new URL(o).origin === APP.origin; } catch { return false; }
}
function openOutside(u) {
  try { const x = new URL(u); if (x.protocol === "https:" || x.protocol === "http:" || x.protocol === "mailto:") shell.openExternal(x.href); } catch {}
}

// Window size and position survive a restart.
const stateFile = () => path.join(app.getPath("userData"), "window.json");
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return {}; } }
function saveState(win) {
  try { fs.writeFileSync(stateFile(), JSON.stringify({ bounds: win.getNormalBounds(), max: win.isMaximized() })); } catch {}
}

// Applied to every page the program creates (web-contents-created below), the main window included.
function harden(contents) {
  // A page inside the window can never navigate it away from OSAP; other addresses go to the normal browser.
  contents.on("will-navigate", (e, u) => { if (!isApp(u)) { e.preventDefault(); openOutside(u); } });
  contents.on("will-redirect", (e, u) => { if (!isApp(u)) { e.preventDefault(); openOutside(u); } });
  contents.setWindowOpenHandler(({ url }) => {
    if (isApp(url) || url === "about:blank" || url.startsWith("blob:" + APP.origin)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: webPrefs() } };
    }
    openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (e) => e.preventDefault());
}

function webPrefs() {
  return { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false };
}

function createWindow() {
  const st = loadState();
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 480, ...(st.bounds || {}),
    title: "AXIOM OSAP", backgroundColor: "#12324a", autoHideMenuBar: true, show: SMOKE ? false : !st.max,
    icon: path.join(__dirname, "build", "icon.png"), webPreferences: webPrefs(),
  });
  if (st.max && !SMOKE) { win.maximize(); win.show(); }
  ["resize", "move", "close"].forEach((ev) => win.on(ev, () => saveState(win)));

  // First start with no internet: the site has not been saved yet, so show a local page that explains and retries.
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3 /* aborted by a newer navigation */) return;
    if (SMOKE) {
      console.error(`OSAP smoke: failed to load ${url}: ${desc} (${code})`);
      if (process.env.OSAP_SMOKE_OUT) try { fs.writeFileSync(process.env.OSAP_SMOKE_OUT, `OSAP smoke: failed ${desc}\n`); } catch {}
      app.exit(1); return;
    }
    win.loadFile(path.join(__dirname, "offline.html"), { query: { u: APP_URL } });
  });
  if (SMOKE) {
    const t = setTimeout(() => { console.error("OSAP smoke: page did not load within 90 s"); app.exit(1); }, 90000);
    win.webContents.once("did-finish-load", async () => {
      clearTimeout(t);
      const title = win.webContents.getTitle();
      const sw = await win.webContents.executeJavaScript("'serviceWorker' in navigator").catch(() => false);
      const line = `OSAP smoke: loaded ${win.webContents.getURL()} title="${title}" serviceWorker=${sw}`;
      console.log(line);
      // Windows GUI programs have no console, so the build workflow reads the result from this file.
      if (process.env.OSAP_SMOKE_OUT) try { fs.writeFileSync(process.env.OSAP_SMOKE_OUT, line + "\n"); } catch {}
      app.exit(/OSAP/.test(title) && sw ? 0 : 1);
    });
  }
  win.loadURL(APP_URL);
  return win;
}

// One copy at a time: starting it again brings the open window to the front.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ALLOWED.has(perm) && isApp(details.requestingUrl || wc.getURL())));
    ses.setPermissionCheckHandler((_wc, perm, origin) => ALLOWED.has(perm) && sameOrigin(origin));
    // Keep the standard Edit/View menus (copy, paste, zoom, full screen, reload) but hide the bar until Alt is pressed.
    if (process.platform !== "darwin") Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      { role: "windowMenu" },
    ]));
    app.on("web-contents-created", (_e, wc) => harden(wc));
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
