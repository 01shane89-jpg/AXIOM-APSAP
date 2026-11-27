// Seen it before? (assets/osap-seenit.js, rules prints-v1): the picture prints, the match rules, the trim of even borders, the
// windows a news picture and a user's photo are printed at, the shard search, the grouping of matched stories, and the file's
// own labels (Content Credentials, IPTC digital source type) on bytes built here. The print job's archive round trip
// (tools/refresh_prints.mjs) and its story list from news files built here. No network, no native modules.
// Run: node tests/seenit.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../assets/osap-seenit.js");
const P = await import("../tools/refresh_prints.mjs");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// ---------- a made-up picture: smooth shapes and a gradient, as RGBA ----------
function picture(w, h, seed, opts = {}) {
  const u = new Uint8ClampedArray(w * h * 4);
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const blobs = Array.from({ length: 6 }, () => [rnd() * w, rnd() * h, (0.08 + rnd() * 0.25) * Math.max(w, h), rnd() * 255, rnd() * 255, rnd() * 255]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 40 + 120 * y / h, g = 60 + 80 * x / w, b = 120;
    for (const [bx, by, br, cr, cg, cb] of blobs) { const d = Math.hypot(x - bx, y - by); if (d < br) { const k = 1 - d / br; r = r * (1 - k) + cr * k; g = g * (1 - k) + cg * k; b = b * (1 - k) + cb * k; } }
    const j = (y * w + x) * 4; u[j] = r * (opts.bright || 1); u[j + 1] = g * (opts.bright || 1); u[j + 2] = b * (opts.bright || 1); u[j + 3] = 255;
  }
  return u;
}
// shrink by area average to fit inside 256 (stands in for libvips / the canvas)
function shrinkTo(rgba, w, h, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4), sx = w / tw, sy = h / th;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const acc = [0, 0, 0, 0]; let n = 0;
    for (let y = Math.floor(ty * sy); y < Math.min(h, Math.floor((ty + 1) * sy)); y++) for (let x = Math.floor(tx * sx); x < Math.min(w, Math.floor((tx + 1) * sx)); x++) { const j = (y * w + x) * 4; for (let c = 0; c < 4; c++) acc[c] += rgba[j + c]; n++; }
    for (let c = 0; c < 4; c++) out[(ty * tw + tx) * 4 + c] = n ? acc[c] / n : 0;
  }
  return out;
}
function printOf(rgba, w, h, box = { x: 0, y: 0, w: 1, h: 1 }) {
  const p = C.px(box, w, h), sub = new Uint8ClampedArray(p.w * p.h * 4);
  for (let y = 0; y < p.h; y++) sub.set(rgba.subarray(((p.y + y) * w + p.x) * 4, ((p.y + y) * w + p.x + p.w) * 4), y * p.w * 4);
  const f = C.fitSize(p.w, p.h);
  return C.print(C.grey(shrinkTo(sub, p.w, p.h, f.w, f.h), f.w, f.h));
}

// ---------- sizes, hashes, distances ----------
ok(JSON.stringify(C.fitSize(1200, 800)) === '{"w":256,"h":171}', "1200 x 800 shrinks to 256 x 171");
ok(JSON.stringify(C.fitSize(100, 50)) === '{"w":100,"h":50}', "a small picture is never enlarged");
ok(C.ham("0000000000000000", "ffffffffffffffff") === 64 && C.ham("0f00000000000000", "0000000000000000") === 4, "Hamming distance counts differing bits");
const A = picture(900, 600, 7), pa = printOf(A, 900, 600);
ok(/^[0-9a-f]{16}$/.test(pa.p) && /^[0-9a-f]{16}$/.test(pa.d) && !pa.flat, "a picture prints as two 64-bit hex hashes");
ok(JSON.stringify(printOf(A, 900, 600)) === JSON.stringify(pa), "printing is deterministic");
const pb = printOf(picture(900, 600, 7, { bright: 1.1 }), 900, 600);
ok(C.ham(pa.p, pb.p) <= 4, "a 10% brighter copy prints almost the same (DCT distance " + C.ham(pa.p, pb.p) + ")");
const half = shrinkTo(A, 900, 600, 450, 300), ph = printOf(half, 450, 300);
ok(C.ham(pa.p, ph.p) <= 4 && C.ham(pa.d, ph.d) <= 6, "a half-size copy prints almost the same (" + C.ham(pa.p, ph.p) + "/" + C.ham(pa.d, ph.d) + ")");
let far = 0; for (let k = 1; k <= 30; k++) { const q = printOf(picture(300, 200, 1000 + k), 300, 200); if (C.strength(C.ham(pa.p, q.p), C.ham(pa.d, q.d))) far++; }
ok(far === 0, "30 different made-up pictures never match (" + far + ")");
const flatPic = new Uint8ClampedArray(200 * 100 * 4).fill(200);
ok(printOf(flatPic, 200, 100).flat, "an even one-colour picture is flagged flat (never matched)");

// ---------- match rules ----------
ok(C.strength(0, 0) === "near-identical" && C.strength(6, 16) === "near-identical", "p <= 6 with d <= 16 is near-identical");
ok(C.strength(4, 30) === "", "a close DCT hash with a far difference hash is not a match (text cards on one template)");
ok(C.strength(9, 14) === "very close" && C.strength(9, 15) === "", "p <= 10 needs d <= 14 for very close");
ok(C.strength(13, 10) === "close" && C.strength(14, 0) === "", "p <= 13 needs d <= 10 for close; p 14 never matches");

// ---------- trim ----------
{
  const w = 300, h = 500, u = new Uint8ClampedArray(w * h * 4).fill(255), inner = picture(300, 200, 3);
  for (let y = 0; y < 200; y++) u.set(inner.subarray(y * w * 4, (y + 1) * w * 4), (y + 100) * w * 4);
  const f = C.fitSize(w, h), G = C.grey(shrinkTo(u, w, h, f.w, f.h), f.w, f.h), t = C.trim(G);
  ok(t.trimmed && Math.abs(t.y - 0.2) < 0.02 && Math.abs(t.h - 0.4) < 0.03 && t.x === 0 && t.w === 1, "white bars above and below are trimmed (y " + t.y.toFixed(3) + ", h " + t.h.toFixed(3) + ")");
  const p1 = printOf(u, w, h, t), p0 = printOf(inner, 300, 200);
  ok(C.strength(C.ham(p1.p, p0.p), C.ham(p1.d, p0.d)) === "near-identical", "the trimmed screenshot prints like the picture inside it (" + C.ham(p1.p, p0.p) + "/" + C.ham(p1.d, p0.d) + ")");
  const fA = C.fitSize(900, 600), GA = C.grey(shrinkTo(A, 900, 600, fA.w, fA.h), fA.w, fA.h);
  ok(!C.trim(GA).trimmed, "a picture with no bars is not trimmed");
}

// ---------- windows ----------
{
  const b = C.indexBoxes(1600, 900);
  ok(b.length === C.VIEWS.length && C.VIEWS.join() === "whole,centre 90%,square,4:5", "a news picture is printed whole, centre 90%, square and 4:5");
  ok(Math.abs(b[2].w * 1600 - 900) < 1 && b[2].h === 1, "the square view of a 16:9 picture is its centre 900 x 900");
  ok(Math.abs(b[3].w * 1600 - 720) < 1, "the 4:5 view of a 16:9 picture is 720 wide");
  const sq = C.indexBoxes(1000, 1000); ok(sq[2] === sq[0], "a square picture's square view is the whole picture");
  const q = C.queryBoxes({ x: 0, y: 0.2, w: 1, h: 0.4, trimmed: true });
  ok(q.map((x) => x.how).join("|") === "as given|borders trimmed|centre 90%|centre 80%|as given, mirrored|borders trimmed, mirrored", "a trimmed photo is looked up six ways");
  ok(C.queryBoxes(null).length === 4, "an untrimmed photo is looked up four ways");
  const px = C.px({ x: 0.999, y: 0, w: 0.5, h: 1 }, 100, 50); ok(px.x === 99 && px.w === 1, "a window is kept inside the picture");
  // a square crop of a news picture finds it through the index's square view
  const W0 = 900, H0 = 600, rows = C.indexBoxes(W0, H0).map((bx) => printOf(A, W0, H0, bx));
  const sqBox = C.indexBoxes(W0, H0)[2], cp = C.px(sqBox, W0, H0), sub = new Uint8ClampedArray(cp.w * cp.h * 4);
  for (let y = 0; y < cp.h; y++) sub.set(A.subarray(((cp.y + y) * W0 + cp.x) * 4, ((cp.y + y) * W0 + cp.x + cp.w) * 4), y * cp.w * 4);
  const shard = new Uint8Array(16 * 4 * 3);
  rows.forEach((r, i) => shard.set(C.rowBytes(r.p, r.d), (4 + i) * 16)); // picture 1
  const other = C.indexBoxes(300, 200).map((bx) => printOf(picture(300, 200, 99), 300, 200, bx));
  other.forEach((r, i) => { shard.set(C.rowBytes(r.p, r.d), i * 16); shard.set(C.rowBytes(r.p, r.d), (8 + i) * 16); }); // pictures 0 and 2
  const qp = printOf(sub, cp.w, cp.h), hits = C.searchShard(shard, [{ how: "as given", p: qp.p, d: qp.d }]);
  ok(hits.length === 1 && hits[0].pic === 1 && hits[0].view === "square" && hits[0].s === "near-identical", "a square crop is found as picture 1 through its square view");
  ok(C.searchShard(shard, [{ how: "x", p: qp.p, d: qp.d, flat: true }]).length === 0, "flat query prints are never searched");
}

// ---------- grouping ----------
{
  const R = (d, cc, o, l, st) => ({ s: st || "near-identical", ref: [d, cc, o, l, "t", "", 0] });
  const g = C.summarise([R("2026-12-01T10:00", "ua", "Kyiv Post", "https://a/1"), R("2026-11-28T08:00", "tr", "Daily Sabah", "https://b/2", "close"), R("2026-12-01T10:00", "ua", "Kyiv Post", "https://a/1"), R("2026-11-30", "", "", "https://c.example.com/3", "very close")]);
  ok(g.first.ref[3] === "https://b/2" && g.stories === 3 && g.outlets === 3 && g.countries === 2, "matches group by story, earliest first, with outlets and countries counted");
  ok(g.best === "near-identical", "the strongest match strength is kept");
}

// ---------- the file's own labels ----------
{
  const enc = (s) => new TextEncoder().encode(s);
  const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), u = new Uint8Array(n); let o = 0; for (const x of a) { u.set(x, o); o += x.length; } return u; };
  const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xeb, 0x00, 0x40]);
  const c2 = cat(jpegHead, enc("JP\0\0jumb\0\0\0\x1ejumdc2pa\0\x11\0\x10"), enc("c2pa.claim\0\x6fclaim_generator\x78\x1cAdobe_Firefly c2pa-rs/0.32.0"), enc("c2pa.actions digitalSourceType http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"));
  const L1 = C.labels(c2);
  ok(L1.c2pa, "Content Credentials found in a JUMBF c2pa box");
  ok(L1.by === "Adobe_Firefly c2pa-rs/0.32.0", "the app that wrote them is read from its CBOR text (" + L1.by + ")");
  const v2 = C.labels(cat(jpegHead, enc("jumbdc2pa c2pa.claim.v2 \x72claim_generator_info\x81\xa2\x64name\x6cChatGPT\x20(AI)\x67version")));
  ok(v2.c2pa && v2.by === "ChatGPT (AI)", "a version 2 claim names its app inside claim_generator_info (" + v2.by + ")");
  ok(L1.ai && L1.source[0].code === "trainedalgorithmicmedia" && /AI tool/.test(L1.source[0].text), "an IPTC 'trained algorithmic media' label says made with AI");
  const xmp = cat(jpegHead, enc('<x:xmpmeta><rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"/></x:xmpmeta>'));
  const L2 = C.labels(xmp);
  ok(!L2.c2pa && L2.ai && L2.source[0].kind === "ai-edit", "an XMP 'composite with AI' label says edited with AI, without Content Credentials");
  const cam = C.labels(cat(jpegHead, enc("digitalsourcetype/digitalCapture")));
  ok(!cam.ai && cam.source[0].kind === "camera", "a 'digital capture' label is a camera, not AI");
  const none = C.labels(cat(jpegHead, enc("just a photo with c2 and pa nearby, nothing else")));
  ok(!none.c2pa && !none.ai && none.source.length === 0, "a plain file has no labels");
  const big = new Uint8Array(9 * 1048576); big.set(enc("digitalsourcetype/trainedAlgorithmicMedia"), big.length - 100);
  ok(C.labels(big).ai, "a label at the end of a large file is still read");
}

// ---------- the print job: story list and archive round trip ----------
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prints-"));
  fs.mkdirSync(path.join(root, "data/live/news/us-states"), { recursive: true });
  const items = { th: [
    { title: "ข่าว", title_en: "News one", date: "2026-11-27T03:49", link: "https://a.example/1", outlet: "A", img: "https://a.example/1.jpg", state: false },
    { title: "Two", date: "2026-11-26T01:00", link: "https://b.example/2", outlet: "B", img: "https://a.example/1.jpg", state: true },
    { title: "No picture", date: "2026-11-26T02:00", link: "https://c.example/3", outlet: "C" },
    { title: "Bad picture link", date: "2026-11-26T02:00", link: "https://c.example/4", outlet: "C", img: "javascript:alert(1)" }] };
  fs.writeFileSync(path.join(root, "data/live/news/th.js"), "window.ASAP_NEWS=" + JSON.stringify({ asof: "x", items }) + ";");
  fs.writeFileSync(path.join(root, "data/live/news/us-states/ca.js"), "window.ASAP_NEWS=" + JSON.stringify({ items: { "us-ca": [{ title: "CA", date: "2026-11-25T00:00", link: "https://d.example/5", outlet: "D", img: "https://d.example/5.png" }] } }));
  fs.writeFileSync(path.join(root, "data/live/news-pics.json"), JSON.stringify({ "https://e.example/6": ["https://e.example/6.webp", "2026-11-20"], "https://a.example/1": ["https://x/dup.jpg", "2026-11-27"], "https://f.example/7": ["", "2026-11-27"] }));
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  fs.writeFileSync(path.join(root, "tools/hidden-areas.json"), JSON.stringify({ hidden: ["us"] }));
  ok(!P.stories(root).some((s) => s.ref[1] === "us-ca"), "stories of a hidden area are left out (the archive is published plainly)");
  fs.writeFileSync(path.join(root, "tools/hidden-areas.json"), JSON.stringify({ hidden: [] }));
  const st = P.stories(root);
  ok(st.some((s) => s.ref[1] === "us-ca"), "a US state page's stories are read when no area is hidden");
  ok(st.length === 4, "stories: four stories with a usable picture (" + st.length + ")");
  ok(st[0].ref[3] === "https://a.example/1" && st[0].ref[5] === "News one" && st[0].ref[1] === "th", "newest first, with the English headline and the country page");
  ok(st.find((s) => s.ref[3] === "https://b.example/2").ref[6] === 1, "state media is marked");
  ok(st.find((s) => s.ref[3] === "https://e.example/6").ref[2] === "e.example", "a picture-cache story gets its site as the outlet");
  ok(!st.some((s) => /javascript/.test(s.img)), "a picture link that is not https is never fetched");

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "prints-out-"));
  const arch = { shards: new Map(), state: P.emptyState() };
  const rows = C.VIEWS.map((v, i) => ({ p: ("0123456789abcdef" + i).slice(-16), d: "fedcba987654321" + i }));
  const at = P.addPicture(arch, "2026-11", rows, st[0].ref); arch.state.pics.k1 = at;
  P.addPicture(arch, "2026-11", P.rowsOf(arch, at), st[1].ref);
  P.addPicture(arch, "2026-12", rows, st[2].ref);
  const ix = P.writeArchive(arch, out, { built: "2026-11-27T05:00Z", run: { printed: 2 } });
  ok(ix.schema === C.SCHEMA && ix.rules === C.RULES && ix.n === 3 && ix.shards.length === 2 && ix.views.length === 4, "index: schema, rules, views and two shards");
  ok(fs.statSync(path.join(out, "p/2026-11.bin")).size === 2 * 64, "a shard holds 64 bytes per picture");
  const back = P.loadArchive(out);
  ok(back.shards.get("2026-11").refs.length === 2 && JSON.stringify(P.rowsOf(back, [ "2026-11", 1 ])) === JSON.stringify(rows), "the archive reads back: story lines and print rows");
  const shard = fs.readFileSync(path.join(out, "p/2026-11.bin")), hits = C.searchShard(shard, [{ how: "as given", p: rows[2].p, d: rows[2].d }]);
  ok(hits.length === 2 && hits[0].view === "square", "a copied picture (seen again in a new story) is found in both stories");
  const refs = JSON.parse(fs.readFileSync(path.join(out, "r/2026-11/0.json"), "utf8"));
  ok(refs[1][3] === "https://b.example/2", "story lines are stored in row order");
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify({ ...ix, rules: "prints-v0" }));
  ok(P.loadArchive(out).shards.size === 0, "an archive printed with other rules starts fresh");
}

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
