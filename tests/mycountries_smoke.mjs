// Headless check of first-run setup, My countries and "new since you last looked" (assets/osap-mycountries.js).
// - First run (nothing saved) on a 390 px phone: the setup sheet shows, fits the phone, its controls are tap-sized; searching
//   finds countries, Done saves them and reloads onto the first one with Today open; the pinned chips show on Today and one
//   tap on a chip switches country. The sheet never shows again.
// - Skip: saved as skipped, and a reload does not show the sheet again.
// - An existing user (a saved OSAP setting) is not shown the sheet, and an automated browser without the test flag is not either.
// - New since: with a stored last look, Today says "N new since" and marks lines New; leaving Today and coming back resets it.
// - Pin from Today puts the chip in the map header; Settings lists "My countries and setup" and opens the sheet.
// - With the empty-news message (assets/osap-empty.js) on Today: the card, chips and new-since line show beside it, no sideways scroll.
// - On the gated (Netlify) site, signed out: the sheet waits behind the sign-in screen and shows once signed in.
// External hosts are blocked. Run from the repo root: node tests/mycountries_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function ctxOf(opts, init, arg) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (init) await ctx.addInitScript(init, arg);
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p, errors };
}
const ready = (p) => p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_MYCC && window.TSAP && window.TSAP.records, null, { timeout: 60000 });
const sheetOpen = (p) => p.evaluate(() => { const s = document.getElementById("mycc-setup"); return !!s && !s.hidden; });
const ls = (p, k) => p.evaluate((k) => localStorage.getItem(k), k);
const testFlag = () => { window.OSAP_SETUP_TEST = 1; };

/* ---------- 1. first run on a phone: setup, Done, pinned chips switch country ---------- */
{
  const { ctx, p, errors } = await ctxOf(PHONE, testFlag);
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForSelector("#mycc-setup:not([hidden])", { timeout: 15000 }).catch(() => {});
  ok(await sheetOpen(p), "first run shows the setup sheet");
  ok(await ls(p, "osap-setup") === "pending", "first run is marked pending until answered");
  ok((await p.textContent("#mcs-h")).trim() === "Welcome to OSAP", "the sheet is the welcome");
  const g = await p.evaluate(() => {
    const s = document.getElementById("mycc-setup"), box = s.querySelector(".mcsbox").getBoundingClientRect();
    const small = [...s.querySelectorAll("button, input")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.textContent.trim() || e.id);
    return { sx: s.scrollWidth - s.clientWidth, dx: document.documentElement.scrollWidth - document.documentElement.clientWidth, l: box.left, r: box.right, small };
  });
  ok(g.sx <= 1 && g.dx <= 1 && g.l >= 0 && g.r <= 390, "the sheet fits a 390 px phone with no sideways scroll", g);
  ok(g.small.length === 0, "every control on the sheet is at least 40 px tall", g.small);
  await p.fill("#mcs-q", "camb");
  ok(await p.locator('#mcs-res [data-mcadd="kh"]').count() === 1, "typing finds Cambodia");
  ok(await p.locator('#mcs-res [data-mcadd="th"]').count() === 0, "and leaves out countries that do not match");
  await p.click('#mcs-res [data-mcadd="kh"]');
  await p.fill("#mcs-q", "viet");
  await p.click('#mcs-res [data-mcadd="vn"]');
  await p.fill("#mcs-q", "zzzz");
  ok(/No country matches/.test(await p.textContent("#mcs-res")), "a search with no match says so");
  await p.fill("#mcs-q", "");
  ok(await p.locator("#mycc-setup .mcsel [data-mcrm]").count() === 2, "two countries chosen");
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/mycc-setup-phone.png" });
  await p.click('#mycc-setup [data-mcrole="team"]');
  ok(await p.evaluate(() => !document.querySelector("#mycc-setup .mcloc").hidden), "Team in country offers Use my location");
  await p.click('#mycc-setup [data-mcrole="traveller"]');
  ok(await p.evaluate(() => document.querySelector("#mycc-setup .mcloc").hidden), "Traveller does not");
  await Promise.all([p.waitForNavigation({ timeout: 60000 }), p.click('#mycc-setup [data-mcs="done"]')]);
  await ready(p);
  await p.waitForFunction(() => window.OSAP_TODAY.isOpen() && document.querySelector("#today .mctoday"), null, { timeout: 30000 });
  ok(await p.evaluate(() => window.TSAP.country) === "kh", "Done opens the first chosen country (Cambodia)");
  ok(await p.evaluate(() => window.OSAP_TODAY.isOpen()), "on Today");
  ok(await ls(p, "osap-setup") === "done", "setup saved as done");
  ok(JSON.parse(await ls(p, "osap-mycc")).role === "traveller", "role saved");
  await p.waitForTimeout(1200);
  ok(!(await sheetOpen(p)), "the sheet does not show again after Done");
  const chips = await p.evaluate(() => [...document.querySelectorAll("#today .mctoday .mcchip")].map((b) => [b.getAttribute("data-mycc"), b.getAttribute("aria-current"), Math.round(b.getBoundingClientRect().height)]));
  ok(chips.length === 2 && chips[0][0] === "kh" && chips[0][1] === "true" && chips[1][0] === "vn", "Today shows the pinned chips, the open one marked", chips);
  ok(chips.every((c) => c[2] >= 40), "chips are at least 40 px tall on a phone", chips);
  const adv = await p.evaluate(() => !!(window.ASAP_ADV && window.ASAP_ADV.items && window.ASAP_ADV.items.kh && window.ASAP_ADV.items.kh.level));
  if (adv) ok(await p.locator("#today .mchead .mcadv").count() === 1, "Traveller: the travel advisory is at the top of Today");
  ok(await p.locator("#today .mccard .mcrow").count() === 2, "Today has a My countries card with a row per pinned country");
  await p.waitForFunction(() => document.querySelectorAll("#today .mccard .mchl").length >= 1 || /could not|No headlines/.test(document.querySelector("#today .mccard").textContent), null, { timeout: 20000 }).catch(() => {});
  ok(!/Loading headlines/.test(await p.textContent("#today .mccard")), "the card fills in each country's newest headline");
  const sx = await p.evaluate(() => { const t = document.getElementById("today"); return { t: t.scrollWidth - t.clientWidth, d: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  ok(sx.t <= 1 && sx.d <= 1, "nothing on Today scrolls sideways on a phone", sx);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/mycc-today-phone.png" });
  await Promise.all([p.waitForNavigation({ timeout: 60000 }), p.click('#today .mctoday .mcchip[data-mycc="vn"]')]);
  await ready(p);
  ok(await p.evaluate(() => window.TSAP.country) === "vn", "one tap on a chip switches country (Vietnam)");
  await p.waitForTimeout(1200);
  ok(!(await sheetOpen(p)), "still no sheet after switching");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

/* ---------- 2. Skip works and never shows again ---------- */
{
  const { ctx, p, errors } = await ctxOf(PHONE, testFlag);
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForSelector("#mycc-setup:not([hidden])", { timeout: 15000 }).catch(() => {});
  ok(await sheetOpen(p), "a fresh device shows the sheet");
  await p.click('#mycc-setup [data-mcs="skip"]');
  ok(!(await sheetOpen(p)), "Skip closes it");
  ok(await ls(p, "osap-setup") === "skipped", "Skip is saved");
  ok(await p.evaluate(() => window.TSAP.country) === "th", "Skip leaves the default country");
  await p.reload({ waitUntil: "domcontentloaded" });
  await ready(p); await p.waitForTimeout(2000);
  ok(!(await sheetOpen(p)), "after Skip a reload does not show the sheet");
  ok(await p.locator("#today .mcchips").count() === 0, "no chips without pinned countries");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

/* ---------- 3. an existing user is never shown it; nor is an automated browser without the test flag ---------- */
{
  const { ctx, p, errors } = await ctxOf(PHONE, () => { window.OSAP_SETUP_TEST = 1; try { localStorage.setItem("osap-last-cc", '"th"'); } catch (e) {} });
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await ready(p); await p.waitForTimeout(2500);
  ok(!(await sheetOpen(p)), "an existing user (saved country) is not shown the sheet");
  ok(await ls(p, "osap-setup") === null, "and is not marked for it");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { ctx, p } = await ctxOf(PHONE, null);
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await ready(p); await p.waitForTimeout(2500);
  ok(!(await sheetOpen(p)) && await ls(p, "osap-setup") === null, "an automated browser without the test flag is not shown it (other checks open as before)");
  await ctx.close();
}

/* ---------- 4. new since you last looked, and its reset ---------- */
let pick = null;
{
  const { ctx, p } = await ctxOf({ viewport: { width: 1280, height: 900 } }, () => { try { localStorage.setItem("osap-home", '"today"'); } catch (e) {} });
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForFunction(() => window.OSAP_TODAY.isOpen(), null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  ok(await p.locator("#today .mcnew").count() === 0, "first look at a country: no count yet");
  const seen1 = JSON.parse(await ls(p, "osap-mycc-seen") || "{}");
  ok(typeof seen1.th === "number", "the look is remembered for Thailand");
  /* a last look before the newest few headlines and warnings */
  pick = await p.evaluate(() => {
    /* just before the newest story Today shows, so at least that line is strictly newer (the newest record overall may not be shown) */
    const R = {}; window.TSAP.records.forEach((r) => { R[r.id] = r; });
    const ms = [...document.querySelectorAll("#today .tdst [data-rec]")].map((b) => R[b.getAttribute("data-rec")]).filter(Boolean)
      .map(window.OSAP_TODAY.recMs).filter((m) => isFinite(m) && m <= Date.now() + 36e5).sort((a, b) => b - a);
    return ms.length ? ms[0] - 60000 : null;
  });
  ok(pick != null, "the page holds timed headlines to count");
  await ctx.close();
}
{
  /* a device whose last look at Thailand was before those (set once, before the page loads: leaving a page counts as a look) */
  const { ctx, p, errors } = await ctxOf({ viewport: { width: 1280, height: 900 } }, (t) => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
    localStorage.setItem("osap-home", '"today"'); localStorage.setItem("osap-mycc-seen", JSON.stringify({ th: t }));
  }, pick);
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForFunction(() => window.OSAP_TODAY.isOpen() && document.querySelector("#today .mcnew"), null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  const s = await p.evaluate(() => ({ txt: document.querySelector("#today .mcnew").textContent, n: window.OSAP_MYCC.newCount(), since: window.OSAP_MYCC.since(),
    tags: document.querySelectorAll("#today .tdtags .mcnewtag, #today .tdal .mcnewtag").length }));
  ok(s.since === pick, "the count starts from the stored last look");
  /* a last look over 20 h back also names the day ("since 24 Oct 2026 1242Z"): the newest story in the snapshot can be that old */
  ok(s.n > 0 && new RegExp("^" + s.n + " new since (?:\\d{1,2} [A-Z][a-z]{2} \\d{4} )?\\d{4}Z").test(s.txt), "Today says \"N new since HHMMZ\"", s.txt);
  /* new lines on the summary carry a New tag; when none of them made the summary the note points to the full lists instead */
  ok(s.tags > 0 ? /marked New below/.test(s.txt) : /All local news and All alerts/.test(s.txt), "new lines carry a New tag, or the note names the full lists", s.tags + " " + s.txt);
  const wrong = await p.evaluate((t) => {
    const R = {}; window.TSAP.records.forEach((r) => { R[r.id] = r; });
    return [...document.querySelectorAll("#today .tdst")].filter((a) => {
      const b = a.querySelector("[data-rec]"); if (!b || !R[b.getAttribute("data-rec")]) return false;
      const ms = window.OSAP_TODAY.recMs(R[b.getAttribute("data-rec")]), tagged = !!a.querySelector(".mcnewtag");
      return tagged !== ms > t;
    }).length;
  }, pick);
  ok(wrong === 0, "only stories timed after the last look are tagged New", wrong);
  await p.evaluate(() => window.OSAP_TODAY.hide());
  await p.waitForTimeout(300);
  await p.evaluate(() => window.OSAP_TODAY.show());
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ txt: (document.querySelector("#today .mcnew") || {}).textContent || "", n: window.OSAP_MYCC.newCount(), tags: document.querySelectorAll("#today .mcnewtag").length }));
  ok(r.n === 0 && /^Nothing new since/.test(r.txt) && r.tags === 0, "after looking, the counter resets", r);
  ok(JSON.parse(await ls(p, "osap-mycc-seen")).th > pick, "the new last look is stored");

  /* pin from Today; the chip shows in the map header; Settings opens the sheet */
  await p.click("#today .mcpin");
  await p.waitForTimeout(300);
  ok(JSON.parse(await ls(p, "osap-mycc")).pins.join() === "th", "the Pin button pins the open country");
  ok((await p.textContent("#today .mcpin")).includes("Pinned"), "and reads Pinned");
  await p.click('#today [data-go="map"]');
  const hdr = await p.evaluate(() => { const h = document.getElementById("mycc-hdr"); const r = h.getBoundingClientRect(); return { chips: h.querySelectorAll(".mcchip").length, vis: r.width > 0 && r.height > 0, dx: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  ok(hdr.vis && hdr.chips === 1, "the map header shows the pinned chip beside the country picker", hdr);
  ok(hdr.dx <= 1, "the header does not push the page sideways", hdr.dx);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/mycc-map-wide.png" });
  await p.evaluate(() => document.getElementById("tidy-set").click());
  const item = p.locator('#tidy-pop [data-tp="@mycc"]');
  ok(await item.count() === 1, "Settings lists My countries and setup");
  await item.click();
  ok(await sheetOpen(p), "it opens the setup sheet again");
  ok((await p.textContent("#mcs-h")).trim() === "My countries and setup" && (await p.textContent('#mycc-setup [data-mcs="skip"]')).trim() === "Cancel", "reopened as My countries and setup, with Cancel");
  await p.click('#mycc-setup [data-mcs="skip"]');
  ok(!(await sheetOpen(p)) && await ls(p, "osap-setup") === null, "Cancel closes it and changes nothing");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

/* ---------- 6. with the empty-news message (assets/osap-empty.js): both show on Today, on a phone ---------- */
{
  const stamp = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString().slice(0, 16);
  const { ctx, p, errors } = await ctxOf(PHONE, (t) => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
    localStorage.setItem("osap-home", '"today"');
    localStorage.setItem("osap-mycc", JSON.stringify({ pins: ["ee", "th"], role: "analyst" }));
    localStorage.setItem("osap-mycc-seen", JSON.stringify({ ee: t }));
  }, Date.now() - 2 * 864e5);
  /* Estonia's newest headline is 4 days old; no history file, so Today has no fresh reporting for it */
  await ctx.route(/\/data\/live\/news\/ee\.js(\?|$)/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.ASAP_NEWS=" + JSON.stringify({ asof: stamp(10).replace("T", " ") + "Z", sources: [],
    items: { ee: [{ title: "Estonia police report border incident near Narva", date: stamp(4 * 1440), outlet: "ERR News", link: "https://news.err.ee/1" }] } }) + ";" }));
  /* and no live Estonian warnings (MeteoAlarm posts real ones most days, which would count as new since the last look) */
  await ctx.route(/\/data\/live\/warnings\.js(\?|$)/, async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()) + "\n;if(window.ASAP_WARN&&window.ASAP_WARN.items)delete window.ASAP_WARN.items.ee;" }); });
  await ctx.route(/\/data\/history\/ee\.js(\?|$)/, (r) => r.fulfill({ contentType: "text/javascript", body: 'window.ASAP_HIST=window.ASAP_HIST||{};window.ASAP_HIST["ee"]={"news":[],"social":[]};' }));
  /* and no official warnings for it: the real MeteoAlarm feed often has a fresh Estonian wind warning */
  await ctx.route(/\/data\/live\/warnings\.js(\?|$)/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.ASAP_WARN=" + JSON.stringify({ asof: stamp(10).replace("T", " ") + "Z", feeds: [], items: {} }) + ";" }));
  await p.goto(base + "#ee/timeline", { waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForFunction(() => window.OSAP_TODAY.isOpen() && document.querySelector("#today .oe-empty") && document.querySelector("#today .mccard"), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const e = await p.evaluate(() => ({ cc: window.TSAP.country, empty: !!document.querySelector("#today .oe-empty"), card: document.querySelectorAll("#today .mccard .mcrow").length,
    ee: ((document.querySelector('#today .mccard [data-mycc="ee"]') || {}).parentNode || {}).textContent || "",
    nw: ((document.querySelector("#today .mcnew") || {}).textContent) || "", chips: document.querySelectorAll("#today .mchead .mcchip").length,
    dx: document.documentElement.scrollWidth - document.documentElement.clientWidth, tw: (document.getElementById("today") || document.body).scrollWidth - (document.getElementById("today") || document.body).clientWidth }));
  ok(e.cc === "ee" && e.empty, "a country with no fresh news shows the empty-news message", e.cc);
  ok(e.card === 2 && /Narva/.test(e.ee), "the My countries card shows beside it, with the country's newest (old) headline", e.ee);
  ok(/^Nothing new since/.test(e.nw), "and Today says nothing is new since the last look", e.nw);
  ok(e.chips === 2, "the chips show above it", e.chips);
  ok(e.dx <= 1 && e.tw <= 1, "nothing scrolls sideways at 390 px", e);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/mycc-empty-phone.png", fullPage: true });
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

/* ---------- 5. phone map header with pinned countries: its own row, no sideways scroll ---------- */
{
  const { ctx, p, errors } = await ctxOf(PHONE, () => { try { localStorage.setItem("osap-home", '"map"'); localStorage.setItem("osap-mycc", JSON.stringify({ pins: ["th", "kh", "vn", "la", "mm"], role: "analyst" })); } catch (e) {} });
  await p.goto(base + "#th/map", { waitUntil: "domcontentloaded" });
  await ready(p); await p.waitForTimeout(1500);
  const g = await p.evaluate(() => {
    const h = document.getElementById("mycc-hdr"), c = h.querySelector(".mcchips"), r = h.getBoundingClientRect();
    return { vis: r.width > 0, right: r.right, chips: c ? c.children.length : 0, inner: c ? c.scrollWidth > c.clientWidth : null,
      dx: document.documentElement.scrollWidth - document.documentElement.clientWidth, hmin: Math.min(...[...h.querySelectorAll("button")].map((b) => b.getBoundingClientRect().height)) };
  });
  ok(g.vis && g.chips === 5, "the phone map header shows the 5 chips", g);
  ok(g.dx <= 1 && g.right <= 391, "the page does not scroll sideways at 390 px (chips scroll inside their row)", g);
  ok(g.hmin >= 40, "chips and Pin are at least 40 px tall on a phone", g.hmin);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/mycc-map-phone.png" });
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

/* ---------- 6. on the Netlify site: not behind the sign-in screen, then once signed in ---------- */
{
  globalThis.Netlify = { env: { get: () => null } };
  const ACCOUNT = (await import("../netlify/functions/osap-account.mjs")).default;
  const out = await (await ACCOUNT(new Request("http://x/api/osap-account"))).json();
  const { ctx, p, errors } = await ctxOf(PHONE, testFlag);
  await ctx.route(/\/api\/osap-account$/, (r) => {
    const signed = !!(r.request().headers().authorization || "");
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...out, signedIn: signed, email: signed ? "a@test" : null }) });
  });
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForSelector("#tierdlg.trwall:not([hidden])", { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2000);
  ok(await p.evaluate(() => !!document.querySelector("#tierdlg.trwall:not([hidden])")), "signed out on the gated site: the sign-in screen shows");
  ok(!(await sheetOpen(p)), "and the setup sheet waits behind it");
  ok(await ls(p, "osap-setup") === "pending", "still pending for after sign-in");
  await p.evaluate(() => localStorage.setItem("osap-auth", JSON.stringify({ access_token: "tok", refresh_token: "r", until: Date.now() + 864e5 })));
  await p.reload({ waitUntil: "domcontentloaded" });
  await ready(p);
  await p.waitForSelector("#mycc-setup:not([hidden])", { timeout: 20000 }).catch(() => {});
  ok(await sheetOpen(p), "signed in, the setup sheet shows");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
