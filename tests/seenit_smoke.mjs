// Seen it before? (assets/osap-seenit.js) in a real browser. A made-up news picture archive stands in for the live-prints branch
// (window.OSAP_PRINTS_URL); its prints are made in this browser from three made-up pictures, one of them used by two stories.
// Every outside host is blocked.
//   - Today shows the "Seen it before?" card; its button opens the window.
//   - A screenshot of picture B (white app bars above and below) is trimmed and found: "OSAP has seen this picture before", the
//     first story is the earlier of B's two stories, "Used in 2 news stories", the machine-translated tag, state media tag.
//   - The first story's own picture is shown beside the user's photo.
//   - A mirrored, square-cropped copy of picture A (the crops social apps make) is found too.
//   - A picture OSAP never read: "Not in OSAP's news archive", with the reverse-search links.
//   - A file carrying an IPTC "made with AI" label and Content Credentials says so under "What the file says about itself".
//   - Crop to the photo: a dragged box checks again on that box.
//   - Copy the result copies the provenance record (rules, SHA-256, prints, archive build time).
//   - The archive cannot be reached: a plain error, no spinner left running.
//   - Photo and video check offers "Seen it before?" under a photo and hands the photo over.
//   - A 390 px phone: nothing scrolls sideways. No page errors. OUT=dir saves screenshots.
// Run from the repo root: node tests/seenit_smoke.mjs   (playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { crc32 } from "node:zlib";
const C = createRequire(import.meta.url)("../assets/osap-seenit.js");
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd();
const FIX = new Map(); // the made-up archive, served under /__prints/
let archiveDown = false;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path.startsWith("__prints/")) {
    const k = path.slice(9);
    if (archiveDown || !FIX.has(k)) { res.writeHead(archiveDown ? 503 : 404); return res.end(); }
    res.writeHead(200, { "Content-Type": k.endsWith(".json") ? "application/json" : "application/octet-stream" }); return res.end(FIX.get(k));
  }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function start(vp) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: vp || { width: 1360, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const logo = await readFile(join(root, "assets/logo.png"));
  await ctx.route("https://pics.example.org/**", (r) => r.fulfill({ contentType: "image/png", body: logo })); // the outlet's picture
  await ctx.addInitScript((u) => { window.OSAP_PRINTS_URL = u; try { localStorage.setItem("osap-home", "today"); } catch (e) {} }, base + "__prints/");
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_SEENIT && window.OSAP_SEENIT._printsOf && window.TSAP, null, { timeout: 60000 });
  return { p, ctx, errors };
}

// ---------- the made-up pictures, drawn in the page: smooth shapes on a gradient ----------
const DRAW = (spec) => {
  const [w, h, seed, opt] = spec; const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "rgb(" + (rnd() * 255 | 0) + ",80,140)"); g.addColorStop(1, "rgb(30," + (rnd() * 255 | 0) + ",90)"); x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) { x.beginPath(); x.fillStyle = "rgb(" + (rnd() * 255 | 0) + "," + (rnd() * 255 | 0) + "," + (rnd() * 255 | 0) + ")"; x.ellipse(rnd() * w, rnd() * h, 20 + rnd() * w / 3, 20 + rnd() * h / 3, rnd() * 3, 0, 7); x.fill(); }
  const src = c;
  let out = c;
  if (opt && opt.bars) { const o = document.createElement("canvas"); o.width = w; o.height = h + 300; const y = o.getContext("2d"); y.fillStyle = "#fff"; y.fillRect(0, 0, o.width, o.height); y.drawImage(src, 0, 110); out = o; }
  if (opt && opt.sqmirror) { const sq = Math.min(w, h), o = document.createElement("canvas"); o.width = sq; o.height = sq; const y = o.getContext("2d"); y.translate(sq, 0); y.scale(-1, 1); y.drawImage(src, (w - sq) / 2, (h - sq) / 2, sq, sq, 0, 0, sq, sq); out = o; }
  if (opt && opt.box) { const b = opt.box, o = document.createElement("canvas"); o.width = Math.round(b.w * w); o.height = Math.round(b.h * h); o.getContext("2d").drawImage(src, Math.round(b.x * w), Math.round(b.y * h), o.width, o.height, 0, 0, o.width, o.height); out = o; }
  return new Promise((ok) => out.toBlob((bl) => bl.arrayBuffer().then((a) => ok(Array.from(new Uint8Array(a)))), "image/png"));
};
const PA = [900, 600, 11], PB = [800, 800, 22], PN = [700, 500, 33];
const RA = ["2026-11-20T08:00", "ua", "Kyiv Independent", "https://example.org/a", "Strike damage in Kharkiv", "", 0];
const RB1 = ["2026-11-25T09:30", "tr", "TRT World", "https://example.org/b1", "Deprem bölgesinde son durum", "Latest from the quake zone", 1, "https://pics.example.org/b1.png"];
const RB2 = ["2026-11-26T12:00", "sy", "Example Daily", "https://example.org/b2", "Aftermath photos", "", 0];
async function png(p, spec) { return Buffer.from(await p.evaluate(DRAW, spec)); }
async function prints(p, buf) { return p.evaluate(async (a) => window.OSAP_SEENIT._printsOf(new Blob([new Uint8Array(a)], { type: "image/png" })), Array.from(buf)); }
// index rows: the browser's "as given" print of each index view, cut from the picture
async function indexRows(p, spec) {
  const rows = [];
  for (const box of C.indexBoxes(spec[0], spec[1])) { const b = await png(p, [spec[0], spec[1], spec[2], { box }]); rows.push((await prints(p, b))[0]); }
  return rows;
}

{
  const { p, ctx, errors } = await start();
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelector("#td-seen [data-snbq]"), null, { timeout: 30000 }).catch(() => {});
  ok(await p.evaluate(() => { const s = document.getElementById("td-seen"); return !!s && !s.hidden && /Seen it before\?/.test(s.textContent); }), "Today shows the Seen it before? card");

  // the made-up archive: A (one story), B (two stories, B2 a copy of B1's rows), in one shard
  const rowsA = await indexRows(p, PA), rowsB = await indexRows(p, PB), other = await indexRows(p, [600, 400, 77]);
  const pics = [[other, ["2026-11-21T00:00", "fr", "Other", "https://example.org/o", "Other", "", 0]], [rowsA, RA], [rowsB, RB2], [rowsB, RB1]];
  const bin = Buffer.alloc(pics.length * 64); pics.forEach(([rows], i) => rows.forEach((r, j) => Buffer.from(C.rowBytes(r.p, r.d)).copy(bin, (i * 4 + j) * 16)));
  FIX.set("index.json", JSON.stringify({ schema: C.SCHEMA, rules: C.RULES, built: "2026-11-27T05:00Z", since: "2026-11-20T00:00Z", views: C.VIEWS, n: pics.length, pictures: 3, shards: [{ id: "2026-11", n: pics.length, bin: "p/2026-11.bin", refs: "r/2026-11/", chunk: 1000 }] }));
  FIX.set("p/2026-11.bin", bin); FIX.set("r/2026-11/0.json", JSON.stringify(pics.map((x) => x[1])));

  await p.click("#td-seen [data-snbq]"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.OSAP_SEENIT.isOpen() && !document.getElementById("snb").hidden), "the card's button opens Seen it before?");
  ok(/Paste, drop or pick/.test(await p.textContent("#snb .snb-lede")), "the window says how to give it a photo");

  async function check(buf, name) {
    await p.setInputFiles("#snb input[data-snb-file]", { name, mimeType: "image/png", buffer: buf });
    await p.waitForFunction(() => { const r = document.querySelector("#snb .snb-res"); return r && r.textContent.length > 20; }, null, { timeout: 20000 }).catch(() => {});
    return p.textContent("#snb .snb-res");
  }
  // B as a screenshot with white bars
  let t = await check(await png(p, [...PB, { bars: true }]), "screenshot.png");
  ok(/OSAP has seen this picture before/.test(t), "a screenshot of B (white bars) is found");
  ok(/TRT World/.test(await p.textContent("#snb .snb-story")) && /Latest from the quake zone/.test(await p.textContent("#snb .snb-story")), "the first story is B's earlier one, with its English headline");
  ok(/Used in 2 news stories/.test(t) && /2 stories · 2 outlets · 2 countr/.test(t), "it says the picture ran in 2 stories by 2 outlets in 2 countries");
  ok(/state media/.test(t) && /machine translated/.test(t), "state media and machine translation are tagged");
  ok(await p.evaluate(() => { const f = document.querySelectorAll("#snb .snb-pair figure:not([hidden]) img"); return f.length === 2 && f[1].complete && f[1].naturalWidth > 0; }), "the first story's own picture is shown beside the user's photo");
  ok(await p.evaluate(() => !!document.querySelector("#snb .snb-trim")), "the trimmed borders are drawn on the photo");
  ok(/never rules a photo real or fake/.test(t), "it says OSAP never rules a photo real or fake");
  if (OUT) await p.screenshot({ path: OUT + "/seenit-hit.png", fullPage: false });

  // copy the result
  await p.click('#snb [data-snb="copy"]'); await p.waitForTimeout(200);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  ok(/rules prints-v1/.test(clip) && /SHA-256 [0-9a-f]{64}/.test(clip) && /built 2026-11-27T05:00Z/.test(clip) && /https:\/\/example.org\/b1/.test(clip), "Copy the result copies rules, SHA-256, archive build and the first story");

  // A, mirrored and cropped square
  await p.click('#snb [data-snb="new"]');
  t = await check(await png(p, [...PA, { sqmirror: true }]), "square.png");
  ok(/OSAP has seen this picture before/.test(t) && /Kyiv Independent/.test(t), "a mirrored square crop of A is found");

  // a picture OSAP never read
  await p.click('#snb [data-snb="new"]');
  t = await check(await png(p, PN), "new.png");
  ok(/Not in OSAP.s news archive/.test(t) && /4 news stories/.test(t) && /Google Lens/.test(t), "an unseen picture: not in the archive, with the count and the search links");

  // crop to the photo: drag a box over the left half of the picture
  await p.click('#snb [data-snb="crop"]'); await p.waitForTimeout(150);
  const r = await p.evaluate(() => { const b = document.querySelector("#snb .snb-frame img").getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await p.mouse.move(r.x + 4, r.y + 4); await p.mouse.down(); await p.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.6, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => { const s = window.OSAP_SEENIT._state; return !!s.crop && s.crop.w > 0.4 && s.crop.w < 0.6; }) && /Use the whole picture/.test(await p.textContent("#snb .snb-picbar")), "a dragged box becomes the crop and the photo is checked again");

  // AI label and Content Credentials in the file's own bytes (a PNG text chunk)
  await p.click('#snb [data-snb="new"]');
  const plain = await png(p, [300, 200, 5]), label = Buffer.from("Iptc4xmpExt:DigitalSourceType=\"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia\" jumb c2pa c2pa.claim claim_generator\x6cTestAI 1.0.0");
  const iend = plain.length - 12, body = Buffer.concat([Buffer.from("tEXt"), Buffer.from("Comment\0"), label]), crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0); const len = Buffer.alloc(4); len.writeUInt32BE(body.length - 4); const chunk = Buffer.concat([len, body, crc]);
  await check(Buffer.concat([plain.subarray(0, iend), chunk, plain.subarray(iend)]), "ai.png");
  const lab = await p.textContent("#snb .snb-labels");
  ok(/made with an ai tool/i.test(lab) && /Content Credentials/.test(lab) && /TestAI 1\.0\.0/.test(lab) && /does not check the signature/.test(lab), "the file's AI label and Content Credentials are shown, signature not checked");

  // archive down
  archiveDown = true; await p.evaluate(() => { window.OSAP_SEENIT._state.ix = null; });
  await p.click('#snb [data-snb="new"]');
  await p.setInputFiles("#snb input[data-snb-file]", { name: "x.png", mimeType: "image/png", buffer: await png(p, PN) });
  await p.waitForFunction(() => !document.querySelector("#snb .snb-err").hidden, null, { timeout: 15000 }).catch(() => {});
  ok(/could not be loaded/.test(await p.textContent("#snb .snb-err")) && await p.evaluate(() => document.querySelector("#snb .snb-status").hidden), "archive unreachable: a plain error and no status left running");
  archiveDown = false;

  // Photo and video check hands a photo over
  await p.click('#snb [data-snb="x"]');
  await p.evaluate(() => { if (window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
  await p.evaluate(() => window.OSAP_PHOTOCHECK.open()); await p.waitForTimeout(300);
  await p.setInputFiles("#phc input[data-phc-file]", { name: "b.png", mimeType: "image/png", buffer: await png(p, PB) }); await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!document.querySelector("#phc [data-phc-seen]")), "Photo and video check offers Seen it before? under a photo");
  await p.click("#phc [data-phc-seen]");
  await p.waitForFunction(() => /OSAP has seen this picture before/.test((document.querySelector("#snb .snb-res") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  ok(/OSAP has seen this picture before/.test(await p.textContent("#snb .snb-res")), "the photo is handed over and found");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}

// a phone
{
  const { p, ctx, errors } = await start({ width: 390, height: 844 });
  await p.evaluate(() => window.OSAP_SEENIT.open()); await p.waitForTimeout(300);
  await p.setInputFiles("#snb input[data-snb-file]", { name: "b.png", mimeType: "image/png", buffer: await png(p, [...PB, { bars: true }]) });
  await p.waitForFunction(() => /OSAP has seen this picture before/.test((document.querySelector("#snb .snb-res") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  ok(/OSAP has seen this picture before/.test(await p.textContent("#snb .snb-res")), "phone: the check works");
  ok(await p.evaluate(() => { const b = document.querySelector("#snb .snb-box"); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= 391; }), "phone: nothing scrolls sideways");
  if (OUT) await p.screenshot({ path: OUT + "/seenit-phone.png", fullPage: true });
  ok(errors.length === 0, "phone: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
