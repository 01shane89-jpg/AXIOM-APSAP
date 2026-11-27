// Picture prints for "Seen it before?" (assets/osap-seenit.js, rules prints-v1): the job's side of printing a picture.
// The hashing itself is the page's own pure core (assets/osap-seenit.js), so a picture prints the same in the job and in the
// browser. This file only decodes and shrinks a picture with sharp (libvips; installed by the workflow, never committed):
//   upright -> at most 1024 px -> window -> shrink to fit inside 256 x 256 (lanczos3) -> RGBA -> the core's grey -> pHash + dHash.
// Untrusted input: every picture is an outlet's file from the open web. Limits: 12 MB, 40 megapixels, first frame only,
// sharp's failOn "error"; a picture that cannot be decoded is skipped, never retried past PRINT_TRIES.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const C = require("../assets/osap-seenit.js");
export const MAX_BYTES = 12 * 1024 * 1024, MAX_PIXELS = 40e6, PRINT_TRIES = 2, PRE = 1024;

// sharp loads lazily: the tests that only use the pure helpers need no native module
let SHARP = null;
export function useSharp(s) { SHARP = s; }
async function sharp() {
  if (!SHARP) { const m = await import(process.env.SHARP_PATH || "sharp"); SHARP = m.default || m; }
  return SHARP;
}

// decode once: { w, h, rgba } of the upright picture at full size is too big for a 40 MP file, so keep the decoded handle and
// cut each window from it. Returns { w, h, render(box) -> grey picture of that window shrunk to fit 256 }.
export async function source(buf) {
  if (!buf || buf.length > MAX_BYTES) throw new Error("picture too large");
  const S = await sharp();
  // upright, then at most 1024 on the long side (every window is cut from this and shrunk again to 256, so detail is kept
  // while a 40 MP file costs no more than a small one)
  const { data, info } = await S(buf, { failOn: "error", limitInputPixels: MAX_PIXELS, pages: 1 }).rotate()
    .resize(PRE, PRE, { fit: "inside", withoutEnlargement: true, kernel: "lanczos3" }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  if (w < 16 || h < 16) throw new Error("picture too small");
  const raw = { raw: { width: w, height: h, channels: 4 } };
  async function render(box, mirror) {
    const p = C.px(box, w, h), s = C.fitSize(p.w, p.h);
    let im = S(data, raw).extract({ left: p.x, top: p.y, width: p.w, height: p.h });
    if (mirror) im = im.flop();
    const out = await im.resize(s.w, s.h, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
    return C.grey(out.data, out.info.width, out.info.height);
  }
  return { w, h, render };
}

// the index rows of one news picture: C.VIEWS.length prints [{ p, d }] in C.VIEWS order, and flat (one even colour: not indexed)
export async function indexPrints(buf) {
  const src = await source(buf);
  const rows = [];
  for (const b of C.indexBoxes(src.w, src.h)) rows.push(C.print(await src.render(b)));
  return { w: src.w, h: src.h, flat: rows[0].flat, rows: rows.map((r) => ({ p: r.p, d: r.d })) };
}

// what the browser does with a user's photo, in Node (tests and calibration): trim, then every query window
export async function queryPrints(buf) {
  const src = await source(buf);
  const tb = C.trim(await src.render({ x: 0, y: 0, w: 1, h: 1 }));
  const out = [];
  for (const q of C.queryBoxes(tb)) { const g = await src.render(q.box, q.mirror); const p = C.print(g); out.push({ how: q.how, p: p.p, d: p.d, flat: p.flat }); }
  return out;
}
