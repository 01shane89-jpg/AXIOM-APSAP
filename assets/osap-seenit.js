/* AXIOM OSAP · Seen it before? (Shane 2026-11-27, "the wow feature": "If it's not built. Build it."). A regular person pastes,
   drops or picks any photo from their feed, and OSAP says whether that picture has already run in the news it has read: when it
   first ran, in which story and outlet, and how many other stories used it since.
   How it works:
   - Picture prints (rules "prints-v1"): every news picture OSAP reads is fingerprinted by tools/refresh_prints.mjs
     (.github/workflows/refresh-prints.yml): the outlet's picture is downloaded once, shrunk to fit 256 px, turned to grey and
     reduced to two 64-bit perceptual hashes (a DCT hash "p" and a difference hash "d") for four views: whole, centre 90%, centre
     square and centre 4:5 (the crops social apps make). The picture itself is never kept. The prints and each story's line
     (date, country page, outlet, link, headline, English headline, state media, the outlet's picture link) are published on the
     live-prints branch, read here from raw.githubusercontent.com. Both sides use THIS file's pure core, so the browser and the
     job print a picture the same way (checked on 200 real news pictures: same match for all 200).
   - The check runs in this browser: the photo is read on the device (never uploaded), even white or black borders trimmed
     (screenshots), and printed as given, trimmed, at centre 90% and 80%, and mirrored. Each print is compared with every news
     print by Hamming distance (bits that differ out of 64); the first story's own picture is shown beside the user's photo,
     loaded from the outlet as the news list does.
   - Match strength (rules prints-v1): p <= 6 with d <= 16 "near-identical", p <= 10 with d <= 14 "very close", p <= 13 with
     d <= 10 "close". Anything weaker is not shown. Calibrated on 320 real news pictures (27 Nov 2026): no picture matched another
     picture; a copy re-saved at JPEG quality 40, a third of the size, 15% brighter, WebP or mirrored was found 99-100% of the
     time, a screenshot with white or dark app bars 91-97%, a caption band over the bottom fifth 99%, a centre 90%, square or
     4:5 crop 100%, an Instagram-style 4:5 phone screenshot 98%; an off-centre crop is almost always missed.
   - The file's own labels, read from its bytes (written here, no library): Content Credentials (C2PA) present, the app that made
     them, and the IPTC "digital source type" an AI tool or camera writes ("made with AI" / "edited with AI" / "camera"). Labels
     are the file's own claim, not verified here; social apps usually strip them. Camera clock and GPS come from Photo and video
     check's reader (assets/osap-photocheck.js) when it is loaded.
   Doctrine, said on the screen: "seen before" means OSAP holds an earlier news story with this picture; it never says the photo is
   real, fake or misused. "Not seen" only means not in OSAP's archive, which starts on 27 Nov 2026. Nothing is stored or sent:
   display only, and the user's photo stays in this browser.
   API: window.OSAP_SEENIT { open(opts), close(), isOpen(), check(blob, name), core }; window.OSAP_SEENITQ { mount(el) } (Today);
   module.exports = core (tests and the print job). */
(function (root) {
  "use strict";
  var W = root;
  var RULES = "prints-v1", SCHEMA = "osap-prints/1";
  var BASE = 256;          /* both pipelines shrink a picture to fit inside 256 x 256 before the core takes over */
  var N = 32;              /* DCT hash works on 32 x 32 grey */
  var VIEWS = ["whole", "centre 90%", "square", "4:5"];
  var STRONG = 6, STRONG_D = 16, CLOSE_P = 10, CLOSE_D = 14, LOOSE_P = 13, LOOSE_D = 10;

  /* ================= pure core (tests/seenit.test.mjs, tools/refresh_prints.mjs) ================= */
  /* the size to shrink a w x h picture to before printing: fit inside BASE x BASE, never enlarged, at least 1 x 1 */
  function fitSize(w, h) {
    var s = Math.min(1, BASE / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  /* RGBA bytes (alpha laid over white) to grey, Rec. 601 luma, 0..255 */
  function grey(rgba, w, h) {
    var g = new Float64Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) {
      var a = rgba[j + 3] / 255, r = rgba[j] * a + 255 * (1 - a), gr = rgba[j + 1] * a + 255 * (1 - a), b = rgba[j + 2] * a + 255 * (1 - a);
      g[i] = 0.299 * r + 0.587 * gr + 0.114 * b;
    }
    return { g: g, w: w, h: h };
  }
  /* exact area average down to tw x th (each output cell is the mean of the source area it covers, fractions weighted) */
  function area(G, tw, th) {
    var out = new Float64Array(tw * th), sx = G.w / tw, sy = G.h / th;
    for (var ty = 0; ty < th; ty++) {
      var y0 = ty * sy, y1 = y0 + sy;
      for (var tx = 0; tx < tw; tx++) {
        var x0 = tx * sx, x1 = x0 + sx, sum = 0, wt = 0;
        for (var y = Math.floor(y0); y < Math.min(G.h, Math.ceil(y1)); y++) {
          var fy = Math.min(y + 1, y1) - Math.max(y, y0); if (fy <= 0) continue;
          for (var x = Math.floor(x0); x < Math.min(G.w, Math.ceil(x1)); x++) {
            var fx = Math.min(x + 1, x1) - Math.max(x, x0); if (fx <= 0) continue;
            sum += G.g[y * G.w + x] * fx * fy; wt += fx * fy;
          }
        }
        out[ty * tw + tx] = wt ? sum / wt : 0;
      }
    }
    return out;
  }
  var COS = null;
  function cosTable() {
    if (COS) return COS;
    COS = new Float64Array(N * N);
    for (var u = 0; u < N; u++) for (var x = 0; x < N; x++) COS[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    return COS;
  }
  function hex(bits) { var s = ""; for (var i = 0; i < 64; i += 4) s += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16); return s; }
  /* DCT hash: 32 x 32 grey, 2-D DCT-II, the 8 x 8 lowest frequencies, each bit = above the median of those 64 (DC left out of
     the median so a brighter copy prints the same) */
  function pHash(G) {
    var a = area(G, N, N), C = cosTable(), tmp = new Float64Array(8 * N), f = new Float64Array(64);
    for (var u = 0; u < 8; u++) for (var y = 0; y < N; y++) { var s = 0; for (var x = 0; x < N; x++) s += C[u * N + x] * a[y * N + x]; tmp[u * N + y] = s; }
    for (var u2 = 0; u2 < 8; u2++) for (var v = 0; v < 8; v++) { var t = 0; for (var y2 = 0; y2 < N; y2++) t += C[v * N + y2] * tmp[u2 * N + y2]; f[v * 8 + u2] = t; }
    var ac = Array.prototype.slice.call(f, 1).sort(function (p, q) { return p - q; }), med = (ac[31] + ac[32]) / 2, bits = [];
    for (var i = 0; i < 64; i++) bits.push(f[i] > med ? 1 : 0);
    return hex(bits);
  }
  /* difference hash: 9 x 8 grey, each bit = this cell brighter than its right-hand neighbour */
  function dHash(G) {
    var a = area(G, 9, 8), bits = [];
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) bits.push(a[y * 9 + x] > a[y * 9 + x + 1] ? 1 : 0);
    return hex(bits);
  }
  /* a flat picture (one colour, or almost) prints as noise: refuse it rather than match it against every blank picture */
  function flat(G) {
    var a = area(G, 16, 16), m = 0, v = 0, i;
    for (i = 0; i < a.length; i++) m += a[i];
    m /= a.length;
    for (i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
    return Math.sqrt(v / a.length) < 4;
  }
  function print(G) { return { p: pHash(G), d: dHash(G), flat: flat(G) }; }
  /* borders of one even colour (letterbox bars, screenshot margins in light or dark mode): rows and columns from each edge whose
     pixels all sit within 10 grey levels of that edge's colour, vary little, and are near white or near black; up to 45% of a
     side, keeping at least a fifth of the picture. Returns the box as fractions of the picture: { x, y, w, h, trimmed } */
  function trim(G) {
    function lineStats(get, n) { var m = 0, i, v = 0; for (i = 0; i < n; i++) m += get(i); m /= n; for (i = 0; i < n; i++) v += Math.abs(get(i) - m); return { m: m, dev: v / n }; }
    function row(r) { return lineStats(function (i) { return G.g[r * G.w + i]; }, G.w); }
    function col(c) { return lineStats(function (i) { return G.g[i * G.w + c]; }, G.h); }
    function bar(s) { return s.dev < 2.5 && (s.m > 225 || s.m < 45); }
    function even(s, ref) { return s.dev < 2.5 && Math.abs(s.m - ref.m) < 10; }
    var t = 0, b = G.h - 1, l = 0, r = G.w - 1, ref;
    ref = row(0); if (bar(ref)) while (t < G.h * 0.45 && even(row(t), ref)) t++;
    ref = row(G.h - 1); if (bar(ref)) while (b > G.h * 0.55 && even(row(b), ref)) b--;
    ref = col(0); if (bar(ref)) while (l < G.w * 0.45 && even(col(l), ref)) l++;
    ref = col(G.w - 1); if (bar(ref)) while (r > G.w * 0.55 && even(col(r), ref)) r--;
    /* one more row or column each side: the shrink blurs the edge between a bar and the picture */
    if (t > 0) t = Math.min(t + 1, b); if (b < G.h - 1) b = Math.max(b - 1, t); if (l > 0) l = Math.min(l + 1, r); if (r < G.w - 1) r = Math.max(r - 1, l);
    var w = r - l + 1, h = b - t + 1;
    if (w < G.w / 5 || h < G.h / 5 || w < 12 || h < 12) return { x: 0, y: 0, w: 1, h: 1, trimmed: false };
    var tr = l > 0 || t > 0 || r < G.w - 1 || b < G.h - 1;
    return { x: l / G.w, y: t / G.h, w: w / G.w, h: h / G.h, trimmed: tr };
  }
  /* a box inside a box, both as fractions */
  function sub(o, x, y, w, h) { return { x: o.x + x * o.w, y: o.y + y * o.h, w: w * o.w, h: h * o.h }; }
  function centre(o, k) { return sub(o, (1 - k) / 2, (1 - k) / 2, k, k); }
  /* a centred crop of a box with aspect ratio a (width / height) for a picture of pw x ph pixels; null when the box already has
     about that shape */
  function aspectBox(o, pw, ph, a) {
    var bw = o.w * pw, bh = o.h * ph, r = bw / bh;
    if (Math.abs(r - a) / a < 0.06) return null;
    return r > a ? sub(o, (1 - a / r) / 2, 0, a / r, 1) : sub(o, 0, (1 - r / a) / 2, 1, r / a);
  }
  /* the windows a NEWS picture is printed at (rows of the index, in this order): the whole picture, its centre 90%, its centre
     square and its centre 4:5 (the crops social apps make). A shape it already has repeats the whole picture. */
  function indexBoxes(pw, ph) {
    var o = { x: 0, y: 0, w: 1, h: 1 };
    return [o, centre(o, 0.9), aspectBox(o, pw, ph, 1) || o, aspectBox(o, pw, ph, 0.8) || o];
  }
  /* the windows a USER's photo is looked up by: as given and with even borders trimmed (when there are any), each also mirrored,
     and the trimmed picture's centre 90% and 80% (a screenshot can hold a little more than the picture) */
  function queryBoxes(tb) {
    var o = { x: 0, y: 0, w: 1, h: 1 }, out = [{ how: "as given", box: o }];
    if (tb && tb.trimmed) out.push({ how: "borders trimmed", box: tb });
    var base = tb && tb.trimmed ? tb : o;
    out.push({ how: "centre 90%", box: centre(base, 0.9) }, { how: "centre 80%", box: centre(base, 0.8) });
    return out.concat(out.slice(0, tb && tb.trimmed ? 2 : 1).map(function (q) { return { how: q.how + ", mirrored", box: q.box, mirror: true }; }));
  }
  /* pixel box for a fraction box on a pw x ph picture (whole pixels, at least 1 x 1, inside the picture) */
  function px(b, pw, ph) {
    var x = Math.max(0, Math.min(pw - 1, Math.round(b.x * pw))), y = Math.max(0, Math.min(ph - 1, Math.round(b.y * ph)));
    return { x: x, y: y, w: Math.max(1, Math.min(pw - x, Math.round(b.w * pw))), h: Math.max(1, Math.min(ph - y, Math.round(b.h * ph))) };
  }
  var POP = new Uint8Array(256); for (var pi = 0; pi < 256; pi++) POP[pi] = (pi & 1) + POP[pi >> 1];
  function bytesOf(h) { var u = new Uint8Array(8); for (var i = 0; i < 8; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; }
  function ham(a, b) { var A = typeof a === "string" ? bytesOf(a) : a, B = typeof b === "string" ? bytesOf(b) : b, n = 0; for (var i = 0; i < 8; i++) n += POP[A[i] ^ B[i]]; return n; }
  /* match strength for a pair of distances, or "" when too weak to show */
  function strength(dp, dd) {
    if (dp <= STRONG && dd <= STRONG_D) return "near-identical";
    if (dp <= CLOSE_P && dd <= CLOSE_D) return "very close";
    if (dp <= LOOSE_P && dd <= LOOSE_D) return "close";
    return "";
  }
  var RANK = { "near-identical": 3, "very close": 2, close: 1 };
  /* search one shard: buf holds rows of 16 bytes (p then d), VIEWS.length rows per news picture. qs: query prints ({ how, p, d,
     flat }). Returns the best hit per picture: [{ pic, view, dp, dd, how, s }] */
  function searchShard(buf, qs) {
    var u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), n = Math.floor(u.length / 16), per = VIEWS.length, out = [], best = null, cur = -1;
    var Q = qs.filter(function (q) { return !q.flat; }).map(function (q) { return { how: q.how, p: bytesOf(q.p), d: bytesOf(q.d) }; });
    function flush() { if (best) out.push(best); best = null; }
    for (var r = 0; r < n; r++) {
      var pic = Math.floor(r / per); if (pic !== cur) { flush(); cur = pic; }
      var o = r * 16;
      for (var k = 0; k < Q.length; k++) {
        var dp = 0, i; for (i = 0; i < 8; i++) dp += POP[u[o + i] ^ Q[k].p[i]];
        if (dp > LOOSE_P) continue;
        var dd = 0; for (i = 0; i < 8; i++) dd += POP[u[o + 8 + i] ^ Q[k].d[i]];
        var s = strength(dp, dd);
        if (s && (!best || RANK[s] > RANK[best.s] || (RANK[s] === RANK[best.s] && dp + dd < best.dp + best.dd))) best = { pic: pic, view: VIEWS[r % per], dp: dp, dd: dd, how: Q[k].how, s: s };
      }
    }
    flush();
    return out;
  }
  /* a print row as 16 bytes */
  function rowBytes(p, d) { var u = new Uint8Array(16); u.set(bytesOf(p), 0); u.set(bytesOf(d), 8); return u; }
  /* group matched story lines (ref: [date, cc, outlet, link, title, title_en, state]): earliest first, one per story link, with
     how many stories, outlets and country pages, and the strongest match strength */
  function summarise(hits) {
    hits = hits.slice().sort(function (a, b) { return a.ref[0] < b.ref[0] ? -1 : a.ref[0] > b.ref[0] ? 1 : RANK[b.s] - RANK[a.s]; });
    var outlets = {}, ccs = {}, links = {}, best = "";
    var uniq = hits.filter(function (h) { var k = h.ref[3]; if (links[k]) return false; links[k] = 1; return true; });
    uniq.forEach(function (h) { outlets[(h.ref[2] || host(h.ref[3])).toLowerCase()] = 1; if (h.ref[1]) ccs[h.ref[1]] = 1; if (!best || RANK[h.s] > RANK[best]) best = h.s; });
    return { first: uniq[0] || null, stories: uniq.length, outlets: Object.keys(outlets).length, countries: Object.keys(ccs).length, best: best, list: uniq };
  }
  function host(u) { var m = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; }

  /* ----- the file's own labels: Content Credentials (C2PA) and the IPTC digital source type ----- */
  var DST = "digitalsourcetype/";
  var DST_WORDS = {
    trainedalgorithmicmedia: ["ai", "Made with an AI tool"],
    compositewithtrainedalgorithmicmedia: ["ai-edit", "Edited or combined with an AI tool"],
    algorithmicmedia: ["ai", "Made by software, not a camera"],
    compositesynthetic: ["ai-edit", "Combined with computer-made parts"],
    digitalcapture: ["camera", "Taken with a digital camera"],
    computationalcapture: ["camera", "Taken with a phone or camera (computational photo)"],
    negativefilm: ["camera", "Scanned from film"], positivefilm: ["camera", "Scanned from film"], print: ["camera", "Scanned from a print"],
    minorhumanedits: ["edit", "Small edits by a person"], compositecapture: ["edit", "Several photos combined"], composite: ["edit", "Several pictures combined"],
    digitalart: ["art", "Drawn or painted on a computer"], virtualrecording: ["art", "Recorded inside software"], screencapture: ["screen", "A screenshot"]
  };
  function latin1(u, o, n) { var s = "", e = Math.min(u.length, o + n); for (var i = o; i < e; i++) s += String.fromCharCode(u[i]); return s; }
  /* a CBOR text string starting at byte o of the scanned text (head 0x60 + length, or 0x78 + one length byte, 0x79 + two) */
  function cborText(u, o, txt) {
    var h = txt.charCodeAt(o), n = -1, s0 = o + 1;
    if (h >= 0x60 && h <= 0x77) n = h - 0x60; else if (h === 0x78) { n = txt.charCodeAt(o + 1); s0 = o + 2; } else if (h === 0x79) { n = txt.charCodeAt(o + 1) * 256 + txt.charCodeAt(o + 2); s0 = o + 3; }
    if (n < 1 || n > 200) return "";
    return txt.substr(s0, n);
  }
  /* reads the first and last 4 MB of a file's bytes (labels sit in the header; some writers put the C2PA store at the end) */
  function labels(buf) {
    var u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), M = 4194304;
    var txt = u.length <= 2 * M ? latin1(u, 0, u.length) : latin1(u, 0, M) + latin1(u, u.length - M, M);
    var low = txt.toLowerCase(), out = { c2pa: false, by: "", source: [], ai: false };
    out.c2pa = /jumb[\s\S]{0,64}c2pa|c2pa\.claim|c2pa\.manifest|\bcabx\b|urn:(?:uuid|c2pa):[0-9a-f-]{8,}[\s\S]{0,200}c2pa/.test(low) || low.indexOf("c2pa.actions") >= 0 || low.indexOf("c2pa.hash") >= 0;
    if (out.c2pa) {
      /* the app that wrote them: the CBOR text after "claim_generator" (v1) or after "name" inside "claim_generator_info" (v2) */
      var i = txt.indexOf("claim_generator"), by = "";
      if (i >= 0 && txt.substr(i, 20) !== "claim_generator_info") by = cborText(u, i + 15, txt);
      if (!by) { var j = txt.indexOf("claim_generator_info"); if (j >= 0) { var k2 = txt.indexOf("name", j + 20); if (k2 > 0 && k2 - j < 64) by = cborText(u, k2 + 4, txt); } }
      out.by = by.replace(/[^\x20-\x7e]+/g, "").trim().slice(0, 80);
    }
    var seen = {}, re = /digitalsourcetype\/([a-z]+)/g, k;
    while ((k = re.exec(low))) { var w = DST_WORDS[k[1]]; if (w && !seen[k[1]]) { seen[k[1]] = 1; out.source.push({ code: k[1], kind: w[0], text: w[1] }); if (w[0] === "ai" || w[0] === "ai-edit") out.ai = true; } }
    return out;
  }

  var CORE = { RULES: RULES, SCHEMA: SCHEMA, BASE: BASE, fitSize: fitSize, grey: grey, area: area, pHash: pHash, dHash: dHash,
    flat: flat, print: print, trim: trim, VIEWS: VIEWS, indexBoxes: indexBoxes, queryBoxes: queryBoxes, px: px, aspectBox: aspectBox, ham: ham, strength: strength, searchShard: searchShard, rowBytes: rowBytes, summarise: summarise,
    labels: labels, host: host, T: { STRONG: STRONG, STRONG_D: STRONG_D, CLOSE_P: CLOSE_P, CLOSE_D: CLOSE_D, LOOSE_P: LOOSE_P, LOOSE_D: LOOSE_D } };
  if (typeof module === "object" && module.exports) { module.exports = CORE; return; }
  if (!W.document) { W.OSAP_SEENIT = { core: CORE }; return; }

  /* ================= the window ================= */
  var D = document;
  /* the archive: the live-prints branch (live-prints-test with ?prints=test, for a branch's test runs) */
  var BRANCH = /[?&]prints=test\b/.test(location.search) ? "live-prints-test" : "live-prints";
  var SRC = W.OSAP_PRINTS_URL || "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/" + BRANCH + "/";
  var MAX_FILE = 40 * 1024 * 1024;
  var SEARCH = [
    ["Google Lens", "https://lens.google.com/", "Finds look-alike pictures and the pages that carry them."],
    ["Bing Visual Search", "https://www.bing.com/visualsearch", "A second index of the web's pictures."],
    ["TinEye", "https://tineye.com/", "Sorts copies by oldest first: good for finding the first time a picture appeared."]];
  var S = { el: null, open: false, file: null, url: "", sha: "", bmp: null, pw: 0, ph: 0, trimBox: null, crop: null, run: 0, ix: null, ixAt: 0, bins: {}, refs: {}, res: null, lab: null, meta: null, err: "" };

  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString("en-US"); }
  function ccName(c) {
    if (!c) return "";
    var x = (W.OSAP_COUNTRIES || []).filter(function (y) { return y.id === c; })[0] || (W.ASAP_WORLD || []).filter(function (y) { return y.id === c; })[0];
    if (x && x.name) return x.name;
    try { if (/^[a-z]{2}$/.test(c)) return new Intl.DisplayNames(["en"], { type: "region" }).of(c.toUpperCase()); } catch (e) {}
    return c.toUpperCase();
  }
  function refMs(d) { d = String(d || ""); return Date.parse(d.length <= 10 ? d + "T00:00Z" : d.slice(0, 16) + "Z"); }
  function when(d) {
    var ms = refMs(d); if (!isFinite(ms)) return esc(d);
    if (String(d).length <= 10) return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
  }
  function ago(d) { var ms = refMs(d); if (!isFinite(ms)) return ""; var days = Math.floor((Date.now() - ms) / 864e5); return days < 1 ? "today" : days === 1 ? "yesterday" : days < 60 ? days + " days ago" : Math.round(days / 30.4) + " months ago"; }
  function sha256(buf) { try { return W.crypto.subtle.digest("SHA-256", buf).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }, function () { return ""; }); } catch (e) { return Promise.resolve(""); } }

  /* ----- printing in the browser: the same windows as the job, drawn by the canvas instead of libvips ----- */
  function decode(blob) {
    if (W.createImageBitmap) return W.createImageBitmap(blob, { imageOrientation: "from-image" }).catch(function () { return W.createImageBitmap(blob); }).catch(viaImg);
    return viaImg();
    function viaImg() {
      return new Promise(function (ok, no) { var u = URL.createObjectURL(blob), i = new Image(); i.onload = function () { ok(i); setTimeout(function () { URL.revokeObjectURL(u); }, 0); }; i.onerror = function () { URL.revokeObjectURL(u); no(new Error("This file is not a picture this browser can open.")); }; i.src = u; });
    }
  }
  function render(box, mirror) {
    var p = core().px(box, S.pw, S.ph), f = core().fitSize(p.w, p.h), c = D.createElement("canvas"); c.width = f.w; c.height = f.h;
    var x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    x.fillStyle = "#fff"; x.fillRect(0, 0, f.w, f.h);
    if (mirror) { x.translate(f.w, 0); x.scale(-1, 1); }
    x.drawImage(S.bmp, p.x, p.y, p.w, p.h, 0, 0, f.w, f.h);
    return core().grey(x.getImageData(0, 0, f.w, f.h).data, f.w, f.h);
  }
  function core() { return CORE; }
  /* the part of the photo that was checked, as a small picture for the side-by-side view ("" for the whole photo) */
  function thumb(box) {
    if (!box || !S.bmp) return "";
    try {
      var p = core().px(box, S.pw, S.ph), k = Math.min(1, 480 / Math.max(p.w, p.h)), c = D.createElement("canvas");
      c.width = Math.max(1, Math.round(p.w * k)); c.height = Math.max(1, Math.round(p.h * k));
      c.getContext("2d").drawImage(S.bmp, p.x, p.y, p.w, p.h, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.85);
    } catch (e) { return ""; }
  }
  function queryPrints() {
    var base = S.crop || null, tb = S.crop ? null : core().trim(render({ x: 0, y: 0, w: 1, h: 1 }));
    S.trimBox = tb && tb.trimmed ? tb : null;
    var boxes = base ? [{ how: "your crop", box: base }, { how: "your crop, centre 90%", box: { x: base.x + base.w * 0.05, y: base.y + base.h * 0.05, w: base.w * 0.9, h: base.h * 0.9 } }, { how: "your crop, mirrored", box: base, mirror: true }] : core().queryBoxes(tb);
    return boxes.map(function (q) { var g = render(q.box, q.mirror), p = core().print(g); return { how: q.how, p: p.p, d: p.d, flat: p.flat }; });
  }

  /* ----- the archive ----- */
  function getJson(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function getBin(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }); }
  function index() {
    if (S.ix && Date.now() - S.ixAt < 15 * 60e3) return Promise.resolve(S.ix);
    return getJson(SRC + "index.json").then(function (ix) {
      if (!ix || ix.schema !== SCHEMA || !Array.isArray(ix.shards)) throw new Error("the archive file is not in the expected form");
      if (ix.rules !== RULES) throw new Error("the archive uses rules " + ix.rules + "; this page prints with " + RULES + ". Reload the app.");
      if (!S.ix || S.ix.built !== ix.built) { S.bins = {}; S.refs = {}; }
      S.ix = ix; S.ixAt = Date.now(); return ix;
    });
  }
  function shardBin(sh) { var k = sh.id + "@" + sh.n; if (!S.bins[k]) S.bins[k] = getBin(SRC + sh.bin).catch(function (e) { delete S.bins[k]; throw e; }); return S.bins[k]; }
  function refChunk(sh, k) { var key = sh.id + "@" + k + "@" + sh.n; if (!S.refs[key]) S.refs[key] = getJson(SRC + sh.refs + k + ".json").catch(function (e) { delete S.refs[key]; throw e; }); return S.refs[key]; }

  /* the whole check: prints of the photo, every shard newest first, then the story lines of the pictures that matched */
  function runCheck() {
    if (!S.bmp) return;
    var my = ++S.run, qs;
    S.res = null; S.err = "";
    try { qs = queryPrints(); } catch (e) { S.err = "This picture could not be read here (" + (e && e.message || "error") + ")."; paint(); return; }
    S.qs = qs;
    S.thumb = thumb(S.crop || S.trimBox);
    if (qs.every(function (q) { return q.flat; })) { S.res = { flat: true }; paint(); return; }
    status("Loading the news picture archive…"); paint();
    index().then(function (ix) {
      var shards = ix.shards.slice().sort(function (a, b) { return a.id < b.id ? 1 : -1; }), hits = [], done = 0, total = ix.pictures || ix.n;
      status("Checking " + num(total) + " news pictures…");
      function nextShard(i) {
        if (my !== S.run) return null;
        if (i >= shards.length) return Promise.resolve();
        var sh = shards[i];
        return shardBin(sh).then(function (buf) {
          if (my !== S.run) return null;
          searchShard(buf, qs).forEach(function (h) { h.sh = sh; hits.push(h); });
          done += sh.n; status("Checked " + num(Math.min(done, ix.n)) + " of " + num(ix.n) + " news stories with pictures…");
          return nextShard(i + 1);
        });
      }
      return nextShard(0).then(function () {
        if (my !== S.run) return null;
        /* story lines for the matches (at most 200 rows, strongest first) */
        hits.sort(function (a, b) { return RANK[b.s] - RANK[a.s] || (a.dp + a.dd) - (b.dp + b.dd); });
        var use = hits.slice(0, 200), need = {};
        use.forEach(function (h) { var k = Math.floor(h.pic / h.sh.chunk); need[h.sh.id + "|" + k] = [h.sh, k]; });
        return Promise.all(Object.keys(need).map(function (k) { return refChunk(need[k][0], need[k][1]).then(function (rows) { need[k].rows = rows; }); })).then(function () {
          if (my !== S.run) return;
          use.forEach(function (h) { var e = need[h.sh.id + "|" + Math.floor(h.pic / h.sh.chunk)]; h.ref = e.rows[h.pic % h.sh.chunk]; });
          S.res = summarise(use.filter(function (h) { return Array.isArray(h.ref); }));
          S.res.archive = { n: ix.n, pictures: ix.pictures || 0, since: ix.since || "", built: ix.built };
          S.res.how = (use[0] || {}).how || "";
          status(""); paint();
        });
      });
    }).catch(function (e) {
      if (my !== S.run) return;
      S.err = "The news picture archive could not be loaded (" + (e && e.message || "network error") + "). Check the connection and try again.";
      status(""); paint();
    });
  }
  function status(t) { S.status = t; var o = S.el && S.el.querySelector(".snb-status"); if (o) { o.textContent = t; o.hidden = !t; } }

  /* ----- loading a photo ----- */
  function load(blob, name) {
    if (!blob) return;
    if (!/^image\//.test(blob.type || "") && !/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(name || blob.name || "")) { S.err = "That is not a picture. Paste, drop or pick a photo (a screenshot works too)."; S.file = null; paint(); return; }
    if (blob.size > MAX_FILE) { S.err = "That file is over 40 MB. Use a smaller copy or a screenshot."; paint(); return; }
    if (S.url) URL.revokeObjectURL(S.url);
    if (S.bmp && S.bmp.close) try { S.bmp.close(); } catch (e) {}
    S.file = { name: name || blob.name || "photo", size: blob.size, type: blob.type || "" }; S.blob = blob;
    S.url = URL.createObjectURL(blob); S.bmp = null; S.crop = null; S.trimBox = null; S.res = null; S.err = ""; S.sha = ""; S.lab = null; S.meta = null; S.cropping = false; S.thumb = "";
    var my = ++S.run; paint(); status("Reading the picture on this device…");
    blob.arrayBuffer().then(function (buf) {
      try { S.lab = labels(buf); } catch (e) { S.lab = null; }
      try { var PC = W.OSAP_PHOTOCHECK && W.OSAP_PHOTOCHECK.core; S.meta = PC && PC.readMeta ? PC.readMeta(buf) : null; } catch (e) { S.meta = null; }
      sha256(buf).then(function (h) { S.sha = h; paintLabels(); });
      return decode(blob);
    }).then(function (bmp) {
      if (my !== S.run) return;
      S.bmp = bmp; S.pw = bmp.width || bmp.naturalWidth; S.ph = bmp.height || bmp.naturalHeight;
      if (!(S.pw >= 16 && S.ph >= 16)) throw new Error("the picture is too small to check");
      runCheck();
    }).catch(function (e) { if (my !== S.run) return; status(""); S.err = "This picture could not be opened here: " + (e && e.message || "error") + ". Try a screenshot of it."; paint(); });
  }

  /* ----- painting ----- */
  function boxCss(b) { return "left:" + (b.x * 100).toFixed(2) + "%;top:" + (b.y * 100).toFixed(2) + "%;width:" + (b.w * 100).toFixed(2) + "%;height:" + (b.h * 100).toFixed(2) + "%"; }
  function paint() {
    var el = S.el; if (!el) return;
    var o = el.querySelector(".snb-main"), h = "";
    if (!S.file) { o.innerHTML = ""; el.querySelector(".snb-drop").hidden = false; paintErr(); return; }
    el.querySelector(".snb-drop").hidden = true;
    var box = S.crop || S.trimBox;
    h += '<div class="snb-pic"><div class="snb-frame' + (S.cropping ? " snb-cropping" : "") + '"><img src="' + esc(S.url) + '" alt="Your photo" draggable="false">' +
      (box ? '<span class="snb-trim" style="' + boxCss(box) + '"></span>' : "") + (S.cropping ? '<span class="snb-drag" hidden></span>' : "") + "</div>" +
      '<div class="snb-picbar">' + (S.cropping ? '<span class="snb-tip">Drag a box around the photo itself, then let go.</span><button type="button" class="snb-b" data-snb="nocrop">Cancel</button>'
        : '<button type="button" class="snb-b" data-snb="crop">' + (S.crop ? "Crop again" : "Crop to the photo") + "</button>" + (S.crop ? '<button type="button" class="snb-b" data-snb="uncrop">Use the whole picture</button>' : "") +
          '<button type="button" class="snb-b" data-snb="new">Check another photo</button>') + "</div>" +
      (S.trimBox && !S.crop ? '<p class="snb-obs">Even borders were trimmed (the dashed box). If this is a screenshot with app buttons or text around the photo, crop to the photo for a better check.</p>' : "") + "</div>";
    h += '<p class="snb-status" role="status"' + (S.status ? "" : " hidden") + ">" + esc(S.status || "") + "</p>";
    h += '<div class="snb-res" aria-live="polite">' + resultHtml() + "</div>";
    h += '<div class="snb-labels"></div>';
    o.innerHTML = h;
    paintLabels(); paintErr();
  }
  function paintErr() { var e = S.el.querySelector(".snb-err"); e.textContent = S.err || ""; e.hidden = !S.err; }
  function storyLine(hh, big) {
    var r = hh.ref, t = r[5] || r[4], out = r[2] || host(r[3]), cn = ccName(r[1]);
    return (big ? "" : '<span class="snb-when">' + esc(when(r[0])) + "</span> ") + '<b>' + esc(out) + "</b>" + (r[6] ? ' <span class="snb-tag">state media</span>' : "") + (cn ? ' <span class="snb-cc">' + esc(cn) + "</span>" : "") +
      '<br><a href="' + esc(r[3]) + '" target="_blank" rel="noopener noreferrer">' + esc(t || r[3]) + " ↗</a>" +
      (r[5] ? ' <span class="snb-tag" title="Headline translated by machine; the original is: ' + esc(r[4]) + '">machine translated</span>' : "") +
      (big ? "" : ' <span class="snb-m">' + esc(hh.s) + "</span>");
  }
  function okImg(u) { return typeof u === "string" && /^https:\/\/[^\s<>"']{8,600}$/i.test(u); }
  function resultHtml() {
    var R = S.res;
    if (!R) return "";
    if (R.flat) return '<div class="snb-card snb-none"><h3>Nothing to match</h3><p>This picture is almost one even colour, so it cannot be matched reliably. Crop to the photo and try again.</p></div>';
    var A = R.archive || {}, since = A.since ? when(A.since.slice(0, 10)) : "";
    if (!R.first) {
      return '<div class="snb-card snb-none"><h3>Not in OSAP’s news archive</h3><p>OSAP has not seen this picture in the ' + num(A.n) + " news stories with pictures it has read" + (since ? " since " + esc(since) : "") + ".</p>" +
        '<p class="snb-obs">That does not mean the photo is new or real. OSAP only knows pictures from the news it reads, and heavy crops, filters or text over the picture can hide a match. Try the searches below, which cover the wider web.</p>' + searchHtml() + "</div>";
    }
    var f = R.first, recent = Date.now() - refMs(f.ref[0]) < 2 * 864e5;
    var h = '<div class="snb-card snb-hit"><p class="snb-eyebrow">' + (R.stories > 1 ? "Used in " + num(R.stories) + " news stories" : "Found in the news") + "</p>" +
      "<h3>OSAP has seen this picture before</h3>" +
      '<p class="snb-first">First in OSAP’s news: <b>' + esc(when(f.ref[0])) + "</b> <span class=\"snb-ago\">(" + esc(ago(f.ref[0])) + ")</span></p>" +
      (okImg(f.ref[7]) ? '<div class="snb-pair"><figure><img src="' + esc(S.thumb || S.url) + '" alt="Your photo"><figcaption>Your photo</figcaption></figure><figure><img src="' + esc(f.ref[7]) +
        '" alt="The picture in that story" referrerpolicy="no-referrer" loading="lazy" onerror="this.closest(\'figure\').hidden=true"><figcaption>In the news, ' + esc(when(String(f.ref[0]).slice(0, 10))) + "</figcaption></figure></div>" : "") +
      '<div class="snb-story">' + storyLine(f, true) + "</div>" +
      '<p class="snb-facts">' + [num(R.stories) + " stor" + (R.stories === 1 ? "y" : "ies"), num(R.outlets) + " outlet" + (R.outlets === 1 ? "" : "s"), R.countries ? num(R.countries) + " countr" + (R.countries === 1 ? "y page" : "y pages") : ""].filter(Boolean).join(" · ") +
      " · match: <b>" + esc(R.best) + "</b></p>" +
      (recent ? '<p class="snb-obs">OSAP first saw it in the last two days, so this may simply be the photo from today’s news. A picture becomes interesting when its first appearance is older than the event it is said to show.</p>'
        : '<p class="snb-obs">If this photo is being shared as something that happened after ' + esc(when(f.ref[0])) + ", it was already in the news before then. Read the first story to see what it showed at the time.</p>");
    if (R.list.length > 1) h += '<details class="snb-list"' + (R.list.length <= 4 ? " open" : "") + "><summary>Every story OSAP holds with this picture (" + num(R.list.length) + ")</summary><ol>" + R.list.slice(0, 60).map(function (x) { return "<li>" + storyLine(x) + "</li>"; }).join("") + "</ol>" + (R.list.length > 60 ? '<p class="snb-obs">and ' + num(R.list.length - 60) + " more.</p>" : "") + "</details>";
    h += '<p class="snb-obs">“First in OSAP’s news” is the earliest story OSAP holds with this picture (its archive starts ' + esc(since || "27 Nov 2026") + "), not proof of where the photo was first published. OSAP never rules a photo real or fake.</p>";
    return h + "</div>";
  }
  function searchHtml() {
    return '<ul class="snb-srch">' + SEARCH.map(function (x) { return '<li><a class="snb-b" href="' + esc(x[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(x[0]) + ' ↗</a> <span class="snb-obs">' + esc(x[2]) + "</span></li>"; }).join("") +
      '</ul><p class="snb-obs">These open the site in a new tab. Nothing is sent from here: upload the photo there yourself, under that site’s terms.</p>';
  }
  function paintLabels() {
    var o = S.el && S.el.querySelector(".snb-labels"); if (!o || !S.file) return;
    var lab = S.lab || { source: [] }, m = S.meta || {}, rows = [];
    if (lab.ai) rows.push(["warn", "The file says it was " + (lab.source.filter(function (x) { return x.kind === "ai" || x.kind === "ai-edit"; }).map(function (x) { return x.text.toLowerCase(); })[0] || "made with AI") + "."]);
    lab.source.filter(function (x) { return x.kind !== "ai" && x.kind !== "ai-edit"; }).forEach(function (x) { rows.push(["", "The file says: " + x.text.toLowerCase() + "."]); });
    if (lab.c2pa) rows.push(["", "It carries Content Credentials (a signed record of how it was made)" + (lab.by ? ", written by " + lab.by : "") + ". OSAP does not check the signature: open it at <a href=\"https://contentcredentials.org/verify\" target=\"_blank\" rel=\"noopener noreferrer\">contentcredentials.org/verify ↗</a>.", true]);
    if (m.taken) rows.push(["", "Camera clock: " + m.taken + (m.offset ? " (UTC" + m.offset + ")" : "") + "."]);
    if (m.gps) rows.push(["", "GPS position in the file: " + (+m.gps.lat).toFixed(5) + ", " + (+m.gps.lon).toFixed(5) + "."]);
    if (m.make || m.model) rows.push(["", "Camera: " + [m.make, m.model].filter(Boolean).join(" ") + "."]);
    (m.hints || []).forEach(function (x) { rows.push(["", x]); });
    if (!rows.length) rows.push(["", "No camera details, AI label or Content Credentials in this file. That is normal: social apps and screenshots strip them."]);
    o.innerHTML = '<h3>What the file says about itself</h3><ul class="snb-lab">' + rows.map(function (r) { return '<li class="' + r[0] + '">' + (r[2] ? r[1] : esc(r[1])) + "</li>"; }).join("") + "</ul>" +
      '<p class="snb-obs">These are the file’s own labels. Any of them can be removed or faked.</p>' +
      '<div class="snb-btns">' + (W.OSAP_PHOTOCHECK && W.OSAP_PHOTOCHECK.open && W.__asapMap ? '<button type="button" class="snb-b" data-snb="more">More checks: sun, shadows, skyline</button>' : "") +
      '<button type="button" class="snb-b" data-snb="copy">Copy the result</button></div>';
  }
  function resultText() {
    var R = S.res, L = ["Seen it before? (AXIOM OSAP, rules " + RULES + ")", "File: " + (S.file ? S.file.name : "") + (S.sha ? " · SHA-256 " + S.sha : "")];
    if (S.qs) L.push("Prints (DCT/difference, " + (S.crop ? "your crop" : S.trimBox ? "borders trimmed" : "as given") + "): " + S.qs.map(function (q) { return q.how + " " + q.p + "/" + q.d; }).join("; "));
    if (R && R.archive) L.push("Archive: " + R.archive.n + " news stories with pictures, since " + (R.archive.since || "?") + ", built " + R.archive.built);
    if (R && R.first) {
      L.push("Seen before: first in OSAP's news " + R.first.ref[0] + " UTC, " + (R.first.ref[2] || host(R.first.ref[3])) + ": " + (R.first.ref[5] || R.first.ref[4]) + " " + R.first.ref[3]);
      L.push(R.stories + " stories, " + R.outlets + " outlets, best match " + R.best + ".");
      R.list.slice(1, 20).forEach(function (x) { L.push("- " + x.ref[0] + " " + (x.ref[2] || host(x.ref[3])) + " " + x.ref[3] + " (" + x.s + ")"); });
    } else if (R) L.push("Not in OSAP's news archive.");
    if (S.lab) L.push("File labels: " + (S.lab.source.map(function (x) { return x.code; }).join(", ") || "none") + (S.lab.c2pa ? "; Content Credentials present (not verified)" + (S.lab.by ? " by " + S.lab.by : "") : ""));
    L.push("OSAP never rules a photo real or fake. First in OSAP's news is not proof of first publication.");
    return L.join("\n");
  }
  function copy() {
    var t = resultText(), done = function () { var b = S.el.querySelector('[data-snb="copy"]'); if (b) { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy the result"; }, 1500); } };
    try { navigator.clipboard.writeText(t).then(done, fallback); } catch (e) { fallback(); }
    function fallback() { var ta = D.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; D.body.appendChild(ta); ta.select(); try { D.execCommand("copy"); done(); } catch (e) {} ta.remove(); }
  }

  /* ----- cropping: drag a box on the picture ----- */
  function armCrop() {
    var fr = S.el.querySelector(".snb-frame"); if (!fr) return;
    var img = fr.querySelector("img"), dr = fr.querySelector(".snb-drag"), a = null;
    function pt(e) { var r = img.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; }
    function boxOf(p, q) { return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y) }; }
    fr.onpointerdown = function (e) { a = pt(e); try { fr.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); };
    fr.onpointermove = function (e) { if (!a) return; var b = boxOf(a, pt(e)); dr.hidden = false; dr.setAttribute("style", boxCss(b)); };
    fr.onpointerup = function (e) {
      if (!a) return; var b = boxOf(a, pt(e)); a = null;
      if (b.w * S.pw < 24 || b.h * S.ph < 24) { dr.hidden = true; return; }
      S.crop = b; S.cropping = false; paint(); runCheck();
    };
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-snb]"); if (!b) return;
    var k = b.getAttribute("data-snb");
    if (k === "x") close();
    else if (k === "crop") { S.cropping = true; paint(); armCrop(); }
    else if (k === "nocrop") { S.cropping = false; paint(); }
    else if (k === "uncrop") { S.crop = null; paint(); runCheck(); }
    else if (k === "new") { S.run++; S.file = null; S.res = null; S.err = ""; status(""); paint(); var inp = S.el.querySelector("[data-snb-file]"); if (inp) inp.focus(); }
    else if (k === "retry") runCheck();
    else if (k === "copy") copy();
    else if (k === "more" && W.OSAP_PHOTOCHECK && S.blob) { var bl = S.blob, nm = S.file.name; close(); W.OSAP_PHOTOCHECK.open({ blob: bl, name: nm }); }
  }
  function build() {
    if (S.el) return S.el;
    var el = S.el = D.createElement("div"); el.id = "snb"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Seen it before?");
    el.innerHTML = '<div class="snb-box"><div class="snb-head"><h2>Seen it before?</h2><button type="button" class="snb-x" data-snb="x" aria-label="Close">&times;</button></div>' +
      '<p class="snb-lede">Paste, drop or pick any photo from your feed. OSAP checks it against every news picture it has read and tells you if it ran before, when and where.</p>' +
      '<label class="snb-drop" tabindex="0"><input type="file" accept="image/*,.heic,.heif" data-snb-file aria-label="Pick a photo"><span class="snb-dropin"><b>Pick a photo</b><span>or paste one (Ctrl+V), or drop it here. A screenshot works too.</span></span></label>' +
      '<p class="snb-err" role="alert" hidden></p><div class="snb-main"></div>' +
      '<p class="snb-foot">Your photo is checked on this device and never uploaded. OSAP keeps only fingerprints of the news pictures it reads, never the pictures. It never rules a photo real or fake.</p></div>';
    D.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("change", function (e) { var t = e.target; if (t.hasAttribute && t.hasAttribute("data-snb-file")) { var f = t.files && t.files[0]; if (f) load(f, f.name); t.value = ""; } });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    var drop = el.querySelector(".snb-drop");
    ["dragenter", "dragover"].forEach(function (n) { el.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add("snb-over"); }); });
    ["dragleave", "drop"].forEach(function (n) { el.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove("snb-over"); }); });
    el.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) load(f, f.name); });
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    return el;
  }
  function onPaste(e) {
    if (!S.open) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === "file" && /^image\//.test(items[i].type)) { var f = items[i].getAsFile(); if (f) { e.preventDefault(); load(f, f.name || "pasted picture"); return; } }
  }
  D.addEventListener("paste", onPaste);
  /* opts: { blob, name } a photo to check straight away */
  function open(opts) {
    opts = opts || {};
    style(); var el = build();
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen() && !opts.keepToday) W.OSAP_TODAY.hide();
    S.open = true; el.hidden = false; paint();
    if (opts.blob) load(opts.blob, opts.name);
    var x = el.querySelector(opts.blob ? ".snb-x" : ".snb-drop"); if (x) x.focus({ preventScroll: true });
    index().catch(function () {}); /* start loading the archive while the user finds a photo */
  }
  function close() { if (!S.el) return; S.open = false; S.run++; S.el.hidden = true; status(""); }
  W.addEventListener("hashchange", function () { if (S.open) close(); });

  var styled = false;
  function style() {
    if (styled) return; styled = true;
    var s = D.createElement("style");
    s.textContent =
      "#snb:not([hidden]){position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
      "#snb .snb-box{background:var(--surface,#fff);color:var(--ink,#1d2329);width:min(620px,100%);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:0 16px 16px;font-size:14px;line-height:1.5;box-sizing:border-box}" +
      "#snb .snb-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;background:var(--surface,#fff);padding:12px 0 8px}" +
      "#snb h2{flex:1;margin:0;font-size:20px}#snb .snb-x{width:44px;height:44px;border:0;background:none;color:inherit;font-size:26px;cursor:pointer}" +
      "#snb h3{margin:4px 0 6px;font-size:16px}#snb .snb-lede{margin:0 0 12px;font-size:14.5px}#snb .snb-obs{color:var(--muted,#56626f);font-size:12.5px;margin:6px 0}" +
      "#snb .snb-drop{position:relative;display:flex;align-items:center;justify-content:center;min-height:150px;border:2px dashed #0b7285;border-radius:10px;background:rgba(11,114,133,.06);cursor:pointer;text-align:center;padding:16px;box-sizing:border-box}" +
      "#snb .snb-drop[hidden]{display:none}#snb .snb-drop.snb-over,#snb .snb-drop:focus-within,#snb .snb-drop:focus{outline:3px solid rgba(11,114,133,.45);outline-offset:2px}" +
      "#snb .snb-drop input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;font-size:0}" +
      "#snb .snb-dropin{display:flex;flex-direction:column;gap:4px;pointer-events:none}#snb .snb-dropin b{font-size:17px;color:#0b7285}#snb .snb-dropin span{color:var(--muted,#56626f);font-size:13px}" +
      "#snb .snb-err{color:#c92a2a;font-weight:600;margin:8px 0}" +
      "#snb .snb-pic{margin:4px 0 8px}#snb .snb-frame{position:relative;width:fit-content;max-width:100%;margin:0 auto;touch-action:none;user-select:none}#snb .snb-frame img{display:block;max-width:100%;max-height:300px;border-radius:6px}" +
      "#snb .snb-cropping{cursor:crosshair}#snb .snb-trim,#snb .snb-drag{position:absolute;border:2px dashed #ffd43b;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none;box-sizing:border-box}#snb .snb-drag{border-style:solid}" +
      "#snb .snb-picbar,#snb .snb-btns{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:8px 0}#snb .snb-tip{align-self:center;font-weight:600}" +
      "#snb .snb-b{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 12px;border:1px solid var(--line,#c9d0d8);border-radius:6px;background:var(--surface,#fff);color:var(--ink,#1d2329);font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer;text-decoration:none;box-sizing:border-box}" +
      "#snb .snb-status{margin:8px 0;font-weight:600;color:#0b7285}" +
      "#snb .snb-card{border-radius:10px;padding:12px 14px;margin:8px 0;border:1px solid var(--line,#d5dbe1)}" +
      "#snb .snb-hit{border:2px solid #e67700;background:rgba(230,119,0,.07)}#snb .snb-none{background:rgba(11,114,133,.05)}" +
      "#snb .snb-eyebrow{margin:0;text-transform:uppercase;letter-spacing:.06em;font-size:11.5px;font-weight:700;color:#b35c00}" +
      "#snb .snb-first{margin:4px 0;font-size:15px}#snb .snb-ago{color:var(--muted,#56626f)}#snb .snb-story{margin:6px 0;padding:8px 10px;border-radius:6px;background:var(--surface,#fff);border:1px solid var(--line,#d5dbe1);overflow-wrap:anywhere}" +
      "#snb .snb-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}#snb .snb-pair figure{margin:0;min-width:0}#snb .snb-pair figure[hidden]{display:none}#snb .snb-pair img{display:block;width:100%;height:140px;object-fit:contain;background:#000;border-radius:6px}#snb .snb-pair figcaption{font-size:12px;color:var(--muted,#56626f);margin-top:2px}" +
      "#snb .snb-facts{margin:6px 0;font-size:13px}#snb .snb-tag{display:inline-block;font-size:11px;padding:0 5px;border-radius:4px;border:1px solid var(--line,#c9d0d8);color:var(--muted,#56626f);white-space:nowrap}" +
      "#snb .snb-cc{color:var(--muted,#56626f);font-size:12.5px}#snb .snb-when{font-variant-numeric:tabular-nums;color:var(--muted,#56626f);font-size:12.5px}#snb .snb-m{font-size:11px;color:var(--muted,#56626f)}" +
      "#snb .snb-list summary{cursor:pointer;font-weight:600;margin:6px 0}#snb .snb-list ol{margin:4px 0;padding-left:20px}#snb .snb-list li{margin:6px 0;overflow-wrap:anywhere}" +
      "#snb .snb-labels{border-top:1px solid var(--line,#d5dbe1);margin-top:10px;padding-top:6px}#snb .snb-lab{margin:4px 0;padding-left:18px}#snb .snb-lab li{margin:3px 0}#snb .snb-lab li.warn{color:#c92a2a;font-weight:700}" +
      "#snb .snb-srch{list-style:none;padding:0;margin:8px 0}#snb .snb-srch li{display:flex;gap:10px;align-items:center;margin:6px 0}#snb .snb-srch .snb-b{flex:none;min-width:160px}" +
      "#snb .snb-foot{color:var(--muted,#56626f);font-size:12px;border-top:1px solid var(--line,#d5dbe1);margin:12px 0 0;padding-top:8px}" +
      "#snb a{color:#0b7285}" +
      ".snbq-card .snbq-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.snbq-card p{margin:4px 0}.snbq-card .snbq-go{min-height:40px;padding:0 14px;border-radius:6px;border:0;background:#0b7285;color:#fff;font:600 14px system-ui,-apple-system,sans-serif;cursor:pointer}" +
      "@media (max-width:700px){#snb:not([hidden]){padding:0}#snb .snb-box{border-radius:0;min-height:100%}#snb .snb-srch li{flex-direction:column;align-items:flex-start;gap:2px}}";
    D.head.appendChild(s);
  }

  /* Today: a small card with one button */
  function mount(box) {
    if (!box) return;
    style();
    box.hidden = false; box.classList.add("snbq-card");
    box.innerHTML = '<div class="tdh"><h2>Seen it before?</h2></div><div class="snbq-row"><button type="button" class="snbq-go" data-snbq>Check a photo</button>' +
      '<p class="tdobs">Got a dramatic photo in your feed? See if it already ran in the news, and when. On this device, nothing uploaded.</p></div>';
    box.querySelector("[data-snbq]").addEventListener("click", function () { open(); });
  }

  /* Photo and video check: a "Seen it before?" button under a photo or a video frame */
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-phc-seen]"); if (!b) return;
    var st = W.OSAP_PHOTOCHECK && W.OSAP_PHOTOCHECK._state; if (!st || !st.url) return;
    var nm = (st.file && st.file.name) || "photo";
    fetch(st.url).then(function (r) { return r.blob(); }).then(function (bl) { if (W.OSAP_PHOTOCHECK.close) W.OSAP_PHOTOCHECK.close(); open({ blob: bl, name: nm }); }).catch(function () {});
  });

  W.OSAP_SEENIT = { open: open, close: close, isOpen: function () { return !!S.open; }, check: function (blob, name) { open({ blob: blob, name: name }); }, core: CORE, _state: S,
    /* tests: the browser's prints of a photo (the same windows as a check), without the window */
    _printsOf: function (blob) { return decode(blob).then(function (b) { var keep = [S.bmp, S.pw, S.ph, S.crop]; S.bmp = b; S.pw = b.width || b.naturalWidth; S.ph = b.height || b.naturalHeight; S.crop = null; try { return queryPrints(); } finally { S.bmp = keep[0]; S.pw = keep[1]; S.ph = keep[2]; S.crop = keep[3]; } }); } };
  W.OSAP_SEENITQ = { mount: mount };
})(typeof window !== "undefined" ? window : globalThis);
